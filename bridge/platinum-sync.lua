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

local CHECKSUM_OFFSET = 0x06        -- in-slot: Add16 checksum word

-- --------------------------------- state -----------------------------------
local warnedGamecode = false
domainSwept = false
diagnosed = false
diagCount = 0
otNameDiag = false
p1ProbeCounter = 0
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
        return memory.read_u32_le(address, "ARM9 System Bus")
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
        return memory.read_bytes_as_array(address, count, "ARM9 System Bus")
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

--- Decode an OT name stored as Gen-4 charcode u16s into ASCII (subset).
local GEN4_ASCII = {
    [0x00] = " ",
    [0x121] = "0",
    [0x122] = "1",
    [0x123] = "2",
    [0x124] = "3",
    [0x125] = "4",
    [0x126] = "5",
    [0x127] = "6",
    [0x128] = "7",
    [0x129] = "8",
    [0x12a] = "9",
    [0x12b] = "A",
    [0x12c] = "B",
    [0x12d] = "C",
    [0x12e] = "D",
    [0x12f] = "E",
    [0x130] = "F",
    [0x131] = "G",
    [0x132] = "H",
    [0x133] = "I",
    [0x134] = "J",
    [0x135] = "K",
    [0x136] = "L",
    [0x137] = "M",
    [0x138] = "N",
    [0x139] = "O",
    [0x13a] = "P",
    [0x13b] = "Q",
    [0x13c] = "R",
    [0x13d] = "S",
    [0x13e] = "T",
    [0x13f] = "U",
    [0x140] = "V",
    [0x141] = "W",
    [0x142] = "X",
    [0x143] = "Y",
    [0x144] = "Z",
    [0x145] = "a",
    [0x146] = "b",
    [0x147] = "c",
    [0x148] = "d",
    [0x149] = "e",
    [0x14a] = "f",
    [0x14b] = "g",
    [0x14c] = "h",
    [0x14d] = "i",
    [0x14e] = "j",
    [0x14f] = "k",
    [0x150] = "l",
    [0x151] = "m",
    [0x152] = "n",
    [0x153] = "o",
    [0x154] = "p",
    [0x155] = "q",
    [0x156] = "r",
    [0x157] = "s",
    [0x158] = "t",
    [0x159] = "u",
    [0x15a] = "v",
    [0x15b] = "w",
    [0x15c] = "x",
    [0x15d] = "y",
    [0x15e] = "z",
}

local function decode_ot_name(base_address)
    local chars = {}
    for i = 0, 7 do
        local code = memory.read_u16_le(base_address + i * 2, "ARM9 System Bus")
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

    local partyCount = memory.read_u8(p1 + PARTY_COUNT_OFF, "ARM9 System Bus") or 0
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
                pidBefore = memory.read_u32_le(slotBase, "ARM9 System Bus")
                attempt = try_read_bytes(slotBase, SLOT_STRIDE)
                pidAfter = memory.read_u32_le(slotBase, "ARM9 System Bus")
                if attempt ~= nil and pidBefore == pidAfter then break end
            end
            if attempt == nil then
                slots[#slots + 1] = { bytes = string.rep("A", 315) .. "=", decryptedInPlace = false }
            else
                -- Wire bytes are raw ENCRYPTED captures: BizHawk bulk-reads the
                -- party struct verbatim (verified offline against all six live
                -- slots, 2026-08-23). The in-game decrypted-in-place flag does
                -- NOT describe these bytes; the decoder must always decrypt.
                slots[#slots + 1] = {
                    bytes = base64_encode(attempt),
                    decryptedInPlace = false,
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
    if not otNameDiag then
        otNameDiag = true
        local codes = {}
        for i = 0, 7 do
            codes[#codes + 1] = string.format("%04X",
                memory.read_u16_le(p2 + OFF_OTNAME + i * 2, "ARM9 System Bus") or 0)
        end
        log("OT name u16 codes: " .. table.concat(codes, " "))
    end
    local tidSid = memory.read_u32_le(p2 + OFF_TIDSID, "ARM9 System Bus") or 0
    local tid = tidSid % 65536
    local sid = math.floor(tidSid / 65536)
    local hours = memory.read_u16_le(p2 + OFF_PLAYTIME_H, "ARM9 System Bus") or 0
    local minutes = memory.read_u8(p2 + OFF_PLAYTIME_M, "ARM9 System Bus") or 0
    local seconds = memory.read_u8(p2 + OFF_PLAYTIME_S, "ARM9 System Bus") or 0
    local mapId = memory.read_u16_le(p2 + OFF_MAP_ID, "ARM9 System Bus") or 0

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

local function gamecodeOk()
    -- ROM-identity gate via BizHawk's gameinfo API (no memory-domain games):
    -- matches the US Platinum cartridge by display name.
    local ok, name = pcall(function() return gameinfo.getromname() end)
    if not ok or name == nil then
        if diagCount < 3 then
            diagCount = diagCount + 1
            log("gate: gameinfo error -> " .. tostring(name))
        end
        return false
    end
    local pass = name:lower():find("platinum") ~= nil
    if not pass and diagCount < 3 then
        diagCount = diagCount + 1
        log("gate: romname='" .. tostring(name) .. "'")
    end
    return pass
end

local function push_snapshot()
    -- recurring P1 probe (debug): log every ~30s while it reads as 0/nil
    p1ProbeCounter = (p1ProbeCounter or 0) + 1
    local p1probe = try_read_u32(ANCHOR_P1)
    if p1probe == nil or p1probe < 0x02000000 then
        -- ONE-SHOT domain sweep: find where (or whether) the anchor lives
        if not domainSwept and gamecodeOk() then
            domainSwept = true
            local okList, list = pcall(function() return memory.getmemorydomainlist() end)
            if okList and type(list) == "table" then
                for _, domain in ipairs(list) do
                    local okR, val = pcall(function()
                        return memory.read_u32_le(ANCHOR_P1, domain)
                    end)
                    log(string.format("sweep [%s] @%08X -> %s",
                        tostring(domain), ANCHOR_P1, tostring(val)))
                end
            else
                log("domain list unavailable: " .. tostring(list))
            end
            -- also probe P2 anchor + gamecode mirror across the same sweep next tick
        end
        if p1ProbeCounter % 60 == 1 then
            log(string.format("P1 probe: %s (waiting for save load)", tostring(p1probe)))
        end
        return false
    end
    if not diagnosed then
        diagnosed = true
        log(string.format("P1 anchor live: 0x%08X", p1probe))
    end

    local snapshotJson = build_snapshot_json()
    if snapshotJson == nil then return false end
    local ok, resp = pcall(function()
        -- Pass RAW compact JSON: comm.httpPost form-encodes its argument itself,
    -- under BizHawk's literal `payload` key (verified on the wire, 2.11.1).
    return comm.httpPost(SERVER_URL, snapshotJson)
    end)
    if not ok then
        log("httpPost error: " .. tostring(resp)) -- debug: always surface failures
        return false
    end
    -- comm.httpPost returns nil for ANY non-2xx response (see HttpCommunication.Post),
    -- so a nil result means the server errored/rejected: treat it as failure, not success.
    if type(resp) ~= "string" then
        log("post returned no body (non-2xx?): " .. tostring(resp))
        return false
    end
    if resp:find('"error"') then
        log("server rejected payload: " .. resp:sub(1, 300))
        return false
    end
    if lastOk ~= true then
        log("Sync posted successfully (" .. #snapshotJson .. " byte payload)")
    end
    return true
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

pcall(function() comm.httpSetPostUrl(SERVER_URL) end) -- optional pre-registration; never fatal
log("pkhex-mcp bridge loaded (Platinum US -> " .. SERVER_URL .. ")")
