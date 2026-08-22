/* pkhex-mcp Inspector polling + rendering (spec section 11).
 * Polls GET /state every 500ms, forever. Values flash on change; tabular
 * numerals keep layout from jumping. Torn slots that stay degraded for
 * >5s get an amber outline (degradation itself heals invisibly server-side).
 */
"use strict";

const POLL_MS = 500;
const DEGRADED_TINT_AFTER_MS = 5000;

const $ = (id) => document.getElementById(id);
const grid = $("party-grid");

const MCP_SNIPPET = `opencode.json ->
"mcp": { "pkhex": { "type": "remote",
  "url": "http://127.0.0.1:8941/mcp" } }`;
$("mcp-snip").textContent = MCP_SNIPPET.replace("opencode.json ->\n", "");

$("copy-snip").addEventListener("click", () => {
  navigator.clipboard?.writeText($("mcp-snip").innerText).then(() => {
    const btn = $("copy-snip");
    const old = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = old), 1200);
  });
});

let prevState = null; // last GameState for flash diffing
/** slot index -> first-seen time of continuous degradation */
const degradedSince = new Map();

function hpClass(cur, max) {
  if (!max) return "";
  const r = cur / max;
  return r <= 0.25 ? "low" : r <= 0.5 ? "mid" : "";
}

function statusChip(member) {
  if (!member || !member.statusCondition) return "";
  const label = member.statusCondition.toUpperCase();
  return `<span class="status-chip">${label}</span>`;
}

function render(state) {
  // Trainer strip
  const t = state.trainerMeta;
  $("trainer-name").textContent = t.playerName;
  $("trainer-ids").textContent = `TID ${t.tid} / SID ${t.sid}`;
  $("trainer-playtime").textContent =
    `${t.playtime.hours}:${String(t.playtime.minutes).padStart(2, "0")} played`;
  $("trainer-location").textContent = "📍 " + (t.locationName ?? `map ${t.mapId}`);

  // Health strip (spec section 8 copy)
  const health = $("health");
  health.className = "";
  if (state.sync.state === "live") {
    health.textContent = "● LIVE";
    health.classList.add("health-live");
  } else if (state.sync.state === "stale") {
    health.textContent = `● STALE · ${Math.round(state.sync.ageMs / 1000)}s`;
    health.classList.add("health-stale");
  } else {
    renderDisconnected(health);
  }

  // Party cards
  grid.innerHTML = "";
  state.slots.forEach((member, i) => {
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.slot = String(i);

    if (member === null) {
      card.innerHTML = `<div class="placeholder">empty slot</div>`;
      degradedSince.delete(i);
      grid.appendChild(card);
      return;
    }

    const prev = prevState?.slots?.[i] ?? null;
    const flashIf = (changed) => (changed ? "flash num" : "num");

    const types = member.types
      .map((ty) => `<span class="type">${ty.toUpperCase()}</span>`)
      .join("");
    const hpPct = Math.max(0, Math.min(100, (100 * member.hpCur) / member.hpMax));
    const moves = member.moves
      .map((mv) =>
        mv === null
          ? "<span></span>"
          : `<span><b>${mv.moveName}</b><i class="num">${mv.ppCur}/${mv.ppMax}</i></span>`
      )
      .join("");
    const statKeys = [
      ["ATK", "attack"],
      ["DEF", "defense"],
      ["SPA", "spAttack"],
      ["SPD", "spDefense"],
      ["SPE", "speed"],
    ];
    const statRow = statKeys
      .map(([label, key]) => {
        const changed = prev?.stats?.[key] !== member.stats[key];
        return `<div><b class="${flashIf(changed)}">${member.stats[key]}</b>${label}</div>`;
      })
      .join("");

    card.innerHTML = `
      <div class="top"><span class="name">${member.speciesName}</span>${types}<span class="lv num">Lv. ${member.level}</span></div>
      <div class="hpline">
        <span class="num ${flashIf(prev?.hpCur !== member.hpCur)}">${member.hpCur}</span>/<span class="num">${member.hpMax}</span>
        <div class="hpbar ${hpClass(member.hpCur, member.hpMax)}"><i style="width:${hpct(hpPct)}%"></i></div>
        ${statusChip(member)}
      </div>
      <div class="meta"><span>${member.natureName} nature</span>·<span class="item">◈ ${member.itemName ?? "—"}</span>·<span>${member.abilityName}</span></div>
      <div class="moves">${moves}</div>
      <div class="statsrow">${statRow}</div>`;
    grid.appendChild(card);
  });

  prevState = state;
}

function hpct(pct) {
  return pct.toFixed(1);
}

async function pollOnce() {
  try {
    const res = await fetch("/state");
    if (res.status === 503) {
      renderDisconnected();
      return;
    }
    if (res.ok) render(await res.json());
  } catch {
    renderDisconnected();
  }
}

function renderDisconnected(healthEl = $("health")) {
  healthEl.className = "";
  healthEl.textContent = "● DISCONNECTED — start your emulator with the bridge script running";
  healthEl.classList.add("health-disconnected");
}

async function pollIntegrity() {
  try {
    const res = await fetch("/debug/sync-integrity");
    if (!res.ok) return;
    const report = await res.json();
    const now = Date.now();
    for (const slot of report.lastSyncTornSlots) {
      const idx = slot - 1;
      if (!degradedSince.has(idx)) degradedSince.set(idx, now);
    }
    for (const [idx, since] of degradedSince) {
      const card = grid.querySelector(`article[data-slot="${idx}"]`);
      if (!card) {
        degradedSince.delete(idx);
        continue;
      }
      const isStillTorn = report.lastSyncTornSlots.includes(idx + 1);
      if (!isStillTorn) {
        degradedSince.delete(idx);
        card.classList.remove("degraded");
      } else if (now - since > DEGRADED_TINT_AFTER_MS) {
        card.classList.add("degraded");
      }
    }
  } catch {
    /* debug surface is best-effort */
  }
}

pollOnce();
setInterval(pollOnce, POLL_MS);
setInterval(pollIntegrity, POLL_MS);
