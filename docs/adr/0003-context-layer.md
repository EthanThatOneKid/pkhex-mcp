# The v0.2 context layer: scanner tools over a file-source, raw reads as escape hatch

- **Status:** Accepted
- **Date:** 2026-08-23

v0.1 exposed five curated tools over live party state; the product goal for v0.2
is open-ended question answering ("what's in my bag?", "have I caught X?")
without pre-declaring every feature. We decided on a **hybrid context layer**:
_Scanner tools_ that read known save regions server-side and return decoded
answers are the primary surface; `read_raw_region` — capped at 1 KB, compact
base64, explicit rejection when over cap (never silent truncation) — exists as
the escape hatch for questions no scanner covers yet. Reference lookup tables
ship as pinnable MCP resources under `pkhex://reference/<name>`; all
crypto/arithmetic (checksums, LCG, bit-order) stays in deterministic code — the
model interprets, it never computes. New tools follow the existing verb
conventions (`get_*`, `find_*`, `is_*`), and every call auto-detects the active
save slot via the General-footer counter rule with an optional `slot` override.

## Considered Options

- **Live-RAM raw reads via a bridge command channel** — rejected for v0.2: the
  save-file source covers every acceptance-battery region while needing zero new
  transport; the wired BizHawk SaveRAM copy refreshes on every in-game save, so
  freshness costs nothing. Revisit as its own effort if second-level freshness
  for arbitrary regions becomes a real demand.
- **Whole-file dumps into model context** — rejected: 512 KB ≈ 700K tokens;
  spike measurements showed server-side scanning answers cost ~150–300 tokens
  versus seven figures for dumps.
- **Model-side decoding of checksums/bit-ordering** — rejected: arithmetic is
  where models hallucinate; the spike's dex mystery (a 0xFF terminator byte
  skewing popcounts) is the cautionary tale.

## Consequences

- Freshness of context-layer answers is bounded by in-game saves, not wall clock
  — docs must say so plainly to avoid "stale bag" confusion with the live-party
  surfaces.
- Every new battery question should first look for a scanner; reaching for
  `read_raw_region` repeatedly on the same region is the signal to promote a new
  scanner instead.
- The five v0.1 tools remain untouched; they are convenience views over the same
  substrate, not a competing API.
