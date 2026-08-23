-- ============================================================================
-- pkhex-mcp Bridge Script (ticket #15 / spec section 3 / ADR-0002)
--
-- Host: BizHawk (NDS core = melonDS). Reads live Pokemon Platinum (US) state
-- and pushes SyncPayload snapshots to the local server every ~500ms.
--
-- Load via: Tools -> Lua Console -> Add New Script
-- Requires: pkhex-mcp server running on http://127.0.0.1:8941
-- ============================================================================

-- ------------------------------ configuration ------------------------------
local SERVER_URL = "http://127.0.0.1:8941/sync"
local POLL_INTERVAL_MS = 500
local GAMECODE_CPUE = 0x45555043 -- "CPUE" little-endian = Platinum US

-- --------------------------- verified Pt-US map ----------------------------
local ANCHOR_P1 = 0x02101D2C        -- party-container pointer (MKDasher anchor)
local PARTY_COUNT_OFF = 0xD090      -- P1-relative: party count byte
local PARTY_BASE_OFF = 0xD094       -- P1-relative: slot 0 base
local SLOT_STRIDE = 0xEC            -- 236-byte PK4-party slots
local SAVE_DELTA = 0xCFE0           -- P2 (save wrapper) = P1 + SAVE_DELTA
local OFF_OTNAME = 0x7C             -- P2-relative: OT name, Gen-4 charcode u16[8]
local OFF_TIDSID = 0x8C             -- P2-relative: u32 TID(lo16) | SID(hi16)
local OFF_PLAYTIME_H = 0x9E         -- P2-relative: playtime hours (u16)
local OFF_PLAYTIME_M = 0xA0         -- minutes (u8)
local OFF_PLAYTIME_S = 0xA1         -- seconds (u8)
local OFF_MAP_ID = 0x1294           -- P2-relative: current map id (u16)

local FLAGS_OFFSET = 0x04           -- in-slot: flags word (bit0 = partyDecrypted)
local CHECKSUM_OFFSET = 0x06        -- in-slot: Add16 checksum word

-- --------------------------------- state -----------------------------------
local warnedGamecode = false
diagnosed = false
local lastOk = nil                  -- nil = no post attempted yet
local lastPostClockMs = 0

-- Diagnostics tee: mirror console lines into bridge.log so the server-side
-- session can read Lua status without touching the BizHawk UI.
local LOG_PATH = [[C:\Users\ethan\Documents\GitHub\pkhex-mcp\bridge\bridge.log]]
local function log(msg)
    console.log(msg)
    pcall(function()
        local f = io.open(LOG_PATH, "a")
        if f ~= nil then
            f:write(os.date("%Y-%m-%d %H:%M:%S "), msg, "\n")
            f:close()
        end
    end)
end

-- ------------------------------- utilities ---------------------------------

--- Read a u32 through whichever domain works; returns value or nil.
local function try_read_u32(address)
    local ok, value = pcall(function()
        return memory.read_u32_le(address, "Main RAM")
    end)
    if ok then return value end
    local ok2, value2 = pcall(function()
        return memory.read_u32_le(address, "ARM9 System Bus")
    end)
    if ok2 then return value2 end
    return nil
end

--- Read `count` bytes as a table of numbers; returns table or nil.
local function try_read_bytes(address, count)
    local ok, bytes = pcall(function()
        return memory.read_bytes_as_array(address, count, "Main RAM")
    end)
    if ok and bytes ~= nil then return bytes end
    local ok2, bytes2 = pcall(function()
        return memory.read_bytes_as_array(address, count, "ARM9 System Bus")
    end)
    if ok2 then return bytes2 end
    return nil
end

local function read_u16_at(bytes, index)
    return bytes[index] + bytes[index + 1] * 256 -- 0-indexed tables from read_bytes_as_array
end

--- Base64 (RFC 4648) over a table of byte values.
local B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

local function b64_sextets(triple)
    local c1 = B64_ALPHABET:sub(math.floor(triple / 262144) % 64 + 1, math.floor(triple / 262144) % 64 + 1)
    local c2 = B64_ALPHABET:sub(math.floor(triple / 4096) % 64 + 1, math.floor(triple / 4096) % 64 + 1)
    local c3 = B64_ALPHABET:sub(math.floor(triple / 64) % 64 + 1, math.floor(triple / 64) % 64 + 1)
    local c4 = B64_ALPHABET:sub(triple % 64 + 1, triple % 64 + 1)
    return c1, c2, c3, c4
end

local function base64_encode(bytes)
    local out = {}
    local n = #bytes
    for i = 1, n - 2, 3 do
        local triple = bytes[i] * 65536 + bytes[i + 1] * 256 + bytes[i + 2]
        local c1, c2, c3, c4 = b64_sextets(triple)
        out[#out + 1] = c1 .. c2 .. c3 .. c4
    end
    local rem = n % 3
    if rem == 1 then
        local c1, c2, _, _ = b64_sextets(bytes[n] * 65536)
        out[#out + 1] = c1 .. c2 .. "=="
    elseif rem == 2 then
        local triple = bytes[n - 1] * 65536 + bytes[n] * 256
        local c1, c2, c3, _ = b64_sextets(triple)
        out[#out + 1] = c1 .. c2 .. c3 .. "="
    end
    return table.concat(out)
end

--- Percent-encode every byte outside the unreserved set (RFC 3986).
local function urlencode(value)
    local out = {}
    for i = 1, #value do
        local byte = value:byte(i)
        if (byte >= 48 and byte <= 57)       -- 0-9
            or (byte >= 65 and byte <= 90)   -- A-Z
            or (byte >= 97 and byte <= 122)  -- a-z
            or byte == 45 or byte == 46 or byte == 95 or byte == 126 then -- - _ . ~
            out[#out + 1] = string.char(byte)
        else
            out[#out + 1] = string.format("%%%02X", byte)
        end
    end
    return table.concat(out)
end

--- Decode an OT name stored as Gen-4 charcode u16s into ASCII (subset).
local GEN4_ASCII = {
    [0x00] = " ",
    [0xA1] = "0", [0xA2] = "1", [0xA3] = "2", [0xA4] = "3", [0xA5] = "4",
    [0xA6] = "5", [0xA7] = "6", [0xA8] = "7", [0xA9] = "8", [0xAA] = "9",
    [0xBB] = "A", [0xBC] = "B", [0xBD] = "C", [0xBE] = "D", [0xBF] = "E",
    [0xC0] = "F", [0xC1] = "G", [0xC2] = "H", [0xC3] = "I", [0xC4] = "J",
    [0xC5] = "K", [0xC6] = "L", [0xC7] = "M", [0xC8] = "N", [0xC9] = "O",
    [0xCA] = "P", [0xCB] = "Q", [0xCC] = "R", [0xCD] = "S", [0xCE] = "T",
    [0xCF] = "U", [0xD0] = "V", [0xD1] = "W", [0xD2] = "X", [0xD3] = "Y",
    [0xD4] = "Z",
    [0xD5] = "a", [0xD6] = "b", [0xD7] = "c", [0xD8] = "d", [0xD9] = "e",
    [0xDA] = "f", [0xDB] = "g", [0xDC] = "h", [0xDD] = "i", [0xDE] = "j",
    [0xDF] = "k", [0xE0] = "l", [0xE1] = "m", [0xE2] = "n", [0xE3] = "o",
    [0xE4] = "p", [0xE5] = "q", [0xE6] = "r", [0xE7] = "s", [0xE8] = "t",
    [0xE9] = "u", [0xEA] = "v", [0xEB] = "w", [0xEC] = "x", [0xED] = "y",
    [0xEE] = "z",
}

local function decode_ot_name(base_address)
    local chars = {}
    for i = 0, 7 do
        local code = memory.read_u16_le(base_address + i * 2, "Main RAM")
        if code == 0xFFFF then break end
        local ch = GEN4_ASCII[code]
        if ch then chars[#chars + 1] = ch end
    end
    local name = table.concat(chars)
    if #name == 0 then return "?" end
    return name
end

-- ------------------------------ Sync producer ------------------------------

local ZERO_SLOT_BYTES = {} -- normalized vacated-slot payload
for _ = 1, 236 do ZERO_SLOT_BYTES[#ZERO_SLOT_BYTES + 1] = 0 end

--- Build the SyncPayload JSON string (spec section 5), or nil while unreadable.
local function build_snapshot_json()
    local p1 = try_read_u32(ANCHOR_P1)
    if p1 == nil or p1 < 0x02000000 then return nil end
    local p2 = p1 + SAVE_DELTA

    local partyCount = memory.read_u8(p1 + PARTY_COUNT_OFF, "Main RAM") or 0
    if partyCount > 6 then partyCount = 6 end

    -- Torn-read protocol: copy each slot, verify PID stable before/after.
    local slots = {}
    for slotIndex = 0, 5 do
        if slotIndex < partyCount then
            local slotBase = p1 + PARTY_BASE_OFF + SLOT_STRIDE * slotIndex
            -- Torn-read protocol (research doc): bracket the kept copy with
            -- PID reads; retry until the PID is stable across the copy.
            local attempt, pidBefore, pidAfter
            for _ = 1, 3 do
                pidBefore = memory.read_u32_le(slotBase, "Main RAM")
                attempt = try_read_bytes(slotBase, SLOT_STRIDE)
                pidAfter = memory.read_u32_le(slotBase, "Main RAM")
                if attempt ~= nil and pidBefore == pidAfter then break end
            end
            if attempt == nil then
                slots[#slots + 1] = { bytes = string.rep("A", 315) .. "=", decryptedInPlace = false }
            else
                -- normalize to 0-indexed-friendly list for read_u16_at
                local flagsWord = read_u16_at(attempt, FLAGS_OFFSET)
                local decryptedInPlace = (math.floor(flagsWord / 1) % 2) == 1
                slots[#slots + 1] = {
                    bytes = base64_encode(attempt),
                    decryptedInPlace = decryptedInPlace,
                }
            end
        else
            slots[#slots + 1] = {
                bytes = base64_encode(ZERO_SLOT_BYTES),
                decryptedInPlace = false,
            }
        end
    end

    local playerName = decode_ot_name(p2 + OFF_OTNAME)
    local tidSid = memory.read_u32_le(p2 + OFF_TIDSID, "Main RAM") or 0
    local tid = tidSid % 65536
    local sid = math.floor(tidSid / 65536)
    local hours = memory.read_u16_le(p2 + OFF_PLAYTIME_H, "Main RAM") or 0
    local minutes = memory.read_u8(p2 + OFF_PLAYTIME_M, "Main RAM") or 0
    local seconds = memory.read_u8(p2 + OFF_PLAYTIME_S, "Main RAM") or 0
    local mapId = memory.read_u16_le(p2 + OFF_MAP_ID, "Main RAM") or 0

    local slotJsonParts = {}
    for _, s in ipairs(slots) do
        slotJsonParts[#slotJsonParts + 1] = string.format(
            '{"bytes":"%s","decryptedInPlace":%s}',
            s.bytes, tostring(s.decryptedInPlace)
        )
    end

    return string.format(
        '{"trainerMeta":{"tid":%d,"sid":%d,"playerName":"%s",' ..
        '"playtime":{"hours":%d,"minutes":%d,"seconds":%d},"mapId":%d},' ..
        '"slots":[%s]}',
        tid, sid, playerName,
        hours, minutes, seconds, mapId,
        table.concat(slotJsonParts, ",")
    )
end

local function push_snapshot()
    -- one-shot diagnostics
    if not diagnosed then
        diagnosed = true
        local okD, domains = pcall(function() return table.concat(memory.getmemorydomainlist(), ", ") end)
        log("domains: " .. tostring(okD and domains or "getdomainlist failed"))
        local p1probe = try_read_u32(ANCHOR_P1)
        log(string.format("P1 probe: %s", tostring(p1probe)))
    end

    local snapshotJson = build_snapshot_json()
    if snapshotJson == nil then return false end
    local ok, err = pcall(function()
        comm.httpPost(SERVER_URL, "snapshot=" .. urlencode(snapshotJson))
    end)
    if not ok then
        log("httpPost error: " .. tostring(err))
        return false
    end
    return true
end

local function gamecodeOk()
    -- ROM-identity gate via BizHawk's gameinfo API (no memory-domain games):
    -- matches the US Platinum cartridge by display name.
    local ok, name = pcall(function() return gameinfo.getromname() end)
    if not ok or name == nil then return false end
    return name:lower():find("platinum") ~= nil
end

-- ----------------------------- frame hook loop -----------------------------
-- Wall-clock accumulator: os.clock() is monotonic elapsed time in the host
-- runtime, immune to turbo/fast-forward, so bursts never occur. Pause simply
-- re-sends identical state (idempotent full-replace server-side).

event.onframeend(function()
    local nowMs = os.clock() * 1000
    if nowMs - lastPostClockMs < POLL_INTERVAL_MS then return end
    lastPostClockMs = nowMs

    if not gamecodeOk() then
        if not warnedGamecode then
            warnedGamecode = true
            log("pkhex-mcp: waiting for Pokemon Platinum (US, CPUE)...")
        end
        return
    end

    local ok = push_snapshot()
    if ok ~= lastOk then
        lastOk = ok
        if ok then
            log("pkhex-mcp: syncing Live State to " .. SERVER_URL)
        else
            log("pkhex-mcp: server unreachable; will retry next tick")
        end
    end
end)

log("pkhex-mcp bridge loaded (Platinum US -> " .. SERVER_URL .. ")")
