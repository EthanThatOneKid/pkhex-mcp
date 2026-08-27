/* pkhex-mcp Inspector — save-file edition (post-descope).
 * Polls GET /save/summary every 2s and renders the decoded save: trainer
 * strip, per-member audit cards (IVs/EVs/nature/moves), dex chip. Values
 * flash on change; tabular numerals keep layout stable.
 */
"use strict";

const POLL_MS = 2000;

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
    setTimeout(btn.textContent = old, 1200);
  });
});

let prevState = null; // last summary for flash diffing

function render(summary) {
  // Trainer strip
  const t = summary.trainerCard;
  $("trainer-name").textContent = t.playerName;
  $("trainer-ids").textContent = `TID ${t.tid} / SID ${t.sid}`;
  $("trainer-playtime").textContent = `${t.playtime.hours}:${
    String(t.playtime.minutes).padStart(2, "0")
  } played · $${t.money}`;
  $("trainer-location").textContent = `🏅 ${t.badgeCount} badges`;

  const health = $("health");
  health.className = "";
  health.textContent = "● SAVE FILE";
  health.classList.add("health-live");

  const dexChip = $("dex-chip");
  if (dexChip) {
    dexChip.textContent =
      `Dex: ${summary.dex.seen} seen / ${summary.dex.caught} caught`;
  }

  // Party audit cards
  grid.innerHTML = "";
  summary.partyDetail.forEach((member, i) => {
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.slot = String(i);

    const prev = prevState?.partyDetail?.[i] ?? null;
    const flashIf = (changed) => (changed ? "flash num" : "num");

    if (member.speciesName === null) {
      card.innerHTML = `<div class="placeholder">${
        member.torn ? "⚠ torn slot" : "empty slot"
      }</div>`;
      grid.appendChild(card);
      return;
    }

    const moves = member.moves
      .map((
        mv,
      ) => (mv === null ? "<span></span>" : `<span><b>${mv}</b></span>`))
      .join("");
    const ivRow = [
      ["HP", member.ivs.hp],
      ["ATK", member.ivs.atk],
      ["DEF", member.ivs.def],
      ["SPE", member.ivs.spe],
      ["SPA", member.ivs.spa],
      ["SPD", member.ivs.spd],
    ].map(([label, v]) =>
      `<div><b class="${
        flashIf(prev?.ivs?.[label] !== v)
      } num">${v}</b>${label}</div>`
    ).join("");
    const evRow = [
      ["HP", member.evs.hp],
      ["ATK", member.evs.atk],
      ["DEF", member.evs.def],
      ["SPE", member.evs.spe],
    ].map(([label, v]) =>
      `<div><b class="${
        flashIf(prev?.evs?.[label] !== v)
      } num">${v}</b>${label}EV</div>`
    ).join("");

    card.innerHTML = `
      <div class="top"><span class="name">${member.speciesName}</span><span class="lv num">Lv. ${member.level}</span></div>
      <div class="meta"><span>${member.natureName} nature</span>${
      member.torn ? '<span class="status-chip">TORN</span>' : ""
    }</div>
      <div class="statsrow">${ivRow}</div>
      <div class="statsrow">${evRow}</div>
      <div class="moves">${moves}</div>`;
    grid.appendChild(card);
  });

  prevState = summary;
}

async function pollOnce() {
  try {
    const res = await fetch("/save/summary");
    if (!res.ok) return;
    render(await res.json());
  } catch {
    /* transient */
  }
}

pollOnce();
setInterval(pollOnce, POLL_MS);
