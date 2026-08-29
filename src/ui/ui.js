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
    setTimeout(() => btn.textContent = old, 1200);
  });
});

/* --- Embedded chat (ADR-0007, BYO OpenAI-compatible) ------------------- */

const chatMessages = $("chat-messages");
const chatForm = $("chat-form");
const chatInput = $("chat-input");
const chatSend = $("chat-send");
const chatFallback = $("chat-fallback");
const chatLive = $("chat-live");
const chatToggle = $("chat-toggle");
const chatPanel = $("chat-panel");
let chatHistory = []; // { role, content }
let chatBusy = false;

chatToggle.addEventListener("click", () => {
  chatPanel.classList.toggle("collapsed");
  chatToggle.textContent = chatPanel.classList.contains("collapsed") ? "▴" : "▾";
});

async function initChat() {
  try {
    const res = await fetch("/chat/config");
    if (!res.ok) return;
    const cfg = await res.json();
    if (cfg.enabled) {
      chatFallback.hidden = true;
      chatLive.hidden = false;
      chatInput.focus();
    }
  } catch {
    /* chat stays in fallback mode */
  }
}

function appendChatMsg(role, text, meta) {
  const div = document.createElement("div");
  div.className = `chat-msg ${role}`;
  div.textContent = text;
  if (meta) {
    const m = document.createElement("div");
    m.className = "meta";
    m.textContent = meta;
    div.appendChild(m);
  }
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = chatInput.value.trim();
  if (!msg || chatBusy) return;

  chatInput.value = "";
  chatBusy = true;
  chatSend.disabled = true;

  chatHistory.push({ role: "user", content: msg });
  appendChatMsg("user", msg);

  // Remove the empty-state placeholder on first message
  const empty = chatMessages.querySelector(".chat-empty");
  if (empty) empty.remove();

  // Create the assistant message div for progressive rendering
  const assistantDiv = document.createElement("div");
  assistantDiv.className = "chat-msg assistant";
  assistantDiv.textContent = "";
  chatMessages.appendChild(assistantDiv);
  let fullText = "";
  let metaParts = [];

  try {
    const res = await fetch("/chat/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: chatHistory }),
    });

    if (!res.ok) {
      const data = await res.json();
      assistantDiv.remove();
      appendChatMsg("error", data.error || "Request failed");
    } else {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const events = buffer.split("\n\n");
        buffer = events.pop(); // Keep incomplete chunk

        for (const block of events) {
          let eventType = "";
          let eventData = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("event: ")) eventType = line.slice(7);
            else if (line.startsWith("data: ")) eventData = line.slice(6);
          }
          if (!eventData) continue;

          try {
            const parsed = JSON.parse(eventData);
            switch (eventType) {
              case "text":
                fullText += parsed;
                assistantDiv.textContent = fullText;
                chatMessages.scrollTop = chatMessages.scrollHeight;
                break;
              case "tool-call":
                metaParts.push(`${parsed.toolName}()`);
                break;
              case "done":
                if (parsed.toolCalls > 0)
                  metaParts.push(`${parsed.toolCalls} tool calls`);
                if (parsed.steps > 1)
                  metaParts.push(`${parsed.steps} steps`);
                break;
              case "error":
                assistantDiv.remove();
                appendChatMsg("error", parsed);
                break;
            }
          } catch {
            /* skip malformed JSON */
          }
        }
      }

      // Append metadata line if any
      if (metaParts.length) {
        const m = document.createElement("div");
        m.className = "meta";
        m.textContent = metaParts.join(" · ");
        assistantDiv.appendChild(m);
      }

      chatHistory.push({ role: "assistant", content: fullText });
    }
  } catch (err) {
    assistantDiv.remove();
    appendChatMsg("error", `Network error: ${err.message}`);
  } finally {
    chatBusy = false;
    chatSend.disabled = false;
    chatInput.focus();
  }
});

initChat();

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
