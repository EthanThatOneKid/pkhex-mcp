# No external decode engine — TypeScript helpers over the validated codec

* **Status:** Accepted
* **Date:** 2026-08-24

v0.3 charting proposed adopting PKHeX.Core as the decode foundation behind a
C# sidecar or managed binding. Player-directed simplification instead keeps
decoding **in this repo**: the existing TypeScript codec (`crypto.ts`,
validated 12/12 against both save partitions during research) already
implements everything the battery needs — LCG stream cipher, block
unshuffling, Add16 checksums — so `decode_pokemon_record` ships as a thin
tool over it and **no sidecar, binding, wasm module, or .NET runtime is
introduced**. The PKHeX.Core adoption research (#34/#35) is preserved as an
offline corroboration archive: its coverage matrix doubles as independent
validation that our offsets and semantics match upstream, and its sidecar
analysis remains the entry point if multi-game scope ever revives the idea.

## Considered Options

* **NativeAOT self-contained sidecar** — technically sound (research
  recommended it) but adds a second language, a release channel, and a
  process boundary to serve eight questions our own codec already answers.
* **pkhex-wasm managed binding** — disqualified for v0.3 regardless:
  browser-only hosting verdict, unpublished, surface lacks bag/dex/badges.
* **Raw-only, no decode helper at all** — rejected on evidence: party/box
  records are encrypted at rest, so inference over raw bytes cannot answer
  the PC-box or IV/EV battery questions. One deterministic decode helper is
  the irreducible code floor.

## Consequences

* The deterministic-helper boundary (ADR-0003) survives in stronger form:
  decryption AND field extraction stay in code; the model interprets results.
* Multi-game support now costs only new offset/research data plus possibly
  revisiting this ADR — no cross-language build matrix.
* PKHeX.Core research stays archived (`docs/research/v03-*`) as the
  corroboration archive and as the ready-made plan should scope ever demand
  upstream-grade breadth.
