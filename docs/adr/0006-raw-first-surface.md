# Raw-first tool surface: read, decode, orient

- **Status:** Accepted
- **Date:** 2026-08-24

The v0.3 tool surface collapses to **three tools plus reference resources**, per
player direction: `read_raw_region` (unchanged 1024-byte base64 cap) is the
primary exploration primitive; `decode_pokemon_record` accepts an ARRAY of
base64 records (236-byte party or 136-byte stored) and returns decrypted fields
batch-wise — whole boxes fit in one call; `get_save_info` replaces
`get_section_map` with sidecar-style self-description (active partition,
reason/warnings, file size, capability limits). The eleven v0.2 scanner tools
are removed without a deprecation window (breaking; single-user project).
Interpretation knowledge moves into **resources invoked at inference time**: the
field guide now teaches the raw-first workflow and the gotchas that previously
lived as scanner logic (terminator masking, stale slot gating, box-number
off-by-one).

## Acceptance bar change

Answers must be **correct within three tool interactions per question**
(measured as tool calls, not model turns). Batch decoding exists precisely so a
30-slot box stays inside that budget: one raw window + one array decode = two
calls.

## Considered Options

- **Keep the eleven scanners** — rejected by player decision: deterministic
  answers were purchased with a hand-maintained offset treadmill; raw-first
  makes the LLM's reasoning the product and shrinks the surface to what fits in
  one page of documentation.
- **PKHeX.Core-backed scanners** — see ADR-0005; rejected for v0.3.

## Consequences

- Per-question token cost rises (multi-window reads + table joins) and
  reliability becomes probabilistic at the margins — mitigated by the field
  guide, the three-interaction grading rule, and deterministic decode for
  everything encrypted.
- The curated name lists (badge order, notable flags, map ids) become
  first-class data files; they are the only "offsets-adjacent" knowledge left
  in-repo, each carrying its corroboration citation.
- `read_raw_region` responses carry both `base64` and spaced `hex` — hex is the
  inference-friendly rendering; base64 stays for programmatic use.
