# Method — how to work on this project

> The **operating procedure** — the loop, the commands, the pre-commit
> checklist — is the `/decomp` skill at `.claude/skills/decomp/SKILL.md`.
> This document is the *reasoning* underneath it: why each rule exists, and
> what going against it cost.

One rule dominates everything else here.

---

## Rule 1: read the code before you read the data

**Always try to recover the routine that produces or consumes a structure
before inferring the structure from the bytes.** Statistics over a data file
can only ever *suggest* a layout. The binary *states* it.

This is not a stylistic preference. Every significant result in this project
came from the binary, and every significant dead end came from reasoning about
data:

| Problem | Guessing from data | Reading the code |
|---|---|---|
| Compression codec | 14 candidate sliding-window sites triaged, all wrong | traced the loader's `ReadFile` buffer to its consumer — found in one pass |
| `evt/` relocation | "pointer spans are 4x and 160x the file size, this format may be unrecoverable" | `FUN_00413120` is nine lines and answers it completely |
| `cam/` container | "u32 offset table, presumably a keyframe struct" — wrong on both counts | `FUN_004041E0` gives the exact channel layout in one read |
| Stage asset sets | a table decoded into a perfect per-stage segment list — and was not one | still open, but only code will settle it |

The pattern in the failures is identical: **a decoding that cannot fail is not
a decoding.** If your interpretation would look plausible whatever the bytes
said, you have learned nothing.

### Corollaries

1. **Before proposing a layout, ask "what function reads this?"** If you cannot
   name it, you are guessing. Say so explicitly.
2. **Aggregate statistics hide tails.** A 5 % artefact does not move a median.
   When aggregate health contradicts a specific report, stop computing
   aggregates and dump the raw records of the outliers.
3. **A filter wider than the program's own test manufactures anomalies.** The
   `evt/` "span problem" was entirely an artefact of filtering `0x0Cxxxxxx`
   when the loader tests a window 32x narrower.
4. **Try both id spaces before believing either.** `pol/` file indices are
   assigned alphabetically, so *any* run of consecutive integers decodes into a
   plausible sequence of related filenames. That produced a convincing, wrong
   "stage segment table".
5. **Do not name a function from its neighbours.** `0x52`/`0x53` were labelled
   `voice_a`/`voice_b` because their handlers sat near sound code. They are
   asset load/free.
6. **Offer candidates as candidates.** Mark every claim **[proved]**,
   **[measured]** or **[open]**, as `formats/pipeline.md` does. A plausible
   candidate stated as a finding costs the next session more than saying
   nothing.

### When data-first *is* legitimate

- Validating a layout already recovered from code, across the whole corpus.
- Locating a candidate *site* to then read (e.g. "which functions touch this
  buffer") — a search heuristic, not a conclusion.
- Confirming an invariant the code implies (curve counts are powers of two).

---

## Rule 2: dispatch tables are free function inventories

This binary is built out of jump tables, and each one converts directly into
named entry points and code coverage:

| Table | Entries | What it names |
|---|---|---|
| `0x005931D8` | 96 | `evt/` bytecode opcode handlers |
| `0x00593358` | 56 | spawn class handlers (`{class_id, handler}` pairs) |
| `0x00588C20` | 8 | asset job kinds |
| `0x0057A29C` | 7 | asset job sub-steps |
| `0x005776EC` | 2-level | `queue_event` scripted actions |

Ghidra's auto-analysis cannot reach a function whose only reference is an entry
in a table it did not recognise — that is most of the "30 % of `.text` that
will not form function bodies" from Phase 1. Feeding it the tables fixes that.
`ghidra/scripts/ApplyKnownTables.java` does this and is the first thing to run
after a fresh import.

---

## Rule 3: prove it against the whole corpus

Every format claim in `docs/formats/` is backed by an exhaustive check, not a
sample (`web/tools/checks/corpus.ts` asserts each of these):

- `lz` — 793/793 files decompress to exactly the declared size
- `texbank` — 303/303 banks resolve with mean coverage 1.000
- `cam` — 100.0000 % byte coverage on all 23 files
- `evt` — 17,150 instructions decode with zero errors, no stub opcodes reached
- asset slots — 326/326 EXE entry counts equal the container model count

Pick a metric that *collapses* when the interpretation is wrong. Byte coverage
is ideal: a wrong stride desynchronises a linear walk immediately. "It did not
crash" is not a metric.

The checks `web/tools/verify_all.ts` runs are the runnable form of this. Add to
them: a check against the installed game goes under `web/tools/checks/`, reads
through `web/src/hod2lib/`, and gets a row in `verify_all.py`.

### Corollary: appearance has no such metric

Coverage and decode-error counts collapse when a *parsing* interpretation is
wrong. Nothing equivalent exists for a change that alters which pixels get
sampled. A UV change that flattened the texture off a whole wall moved mean
luminance by 0.0001 (0.3194 → 0.3193) and passed every numeric check in the
repo.

**So: any change affecting appearance gets a before/after render through a game
camera, looked at, before it is committed as the default.** The player is the
renderer: a deep link poses the camera on any path and frame, and
`web/tools/shot.mjs` captures it headless.

```sh
cd web && node tools/shot.mjs --url '?stage=2&slot=59&frame=170&freeze=1' --out before
```

### Corollary 2: the renderer you check with is part of the experiment

A viewer that fakes a sampler mode, a blend or a light produces a wrong picture
that is indistinguishable from an exporter bug. Before concluding anything from
a render, know what the renderer is faking. The player's own switches (the
Scene panel's light, fog and filtering) are there to turn one thing off at a
time.

### Corollary 3: when a face looks wrong, bisect the pipeline, don't stare

**Turn one thing off.** Forcing every sampler to one mode and re-rendering
locates a UV bug in a single step, where probing UV values that are correct
all along does not. Then find which stage of the pipeline — decode, bundle,
material translation, draw — first differs from the game.

---

## Rule 4: the wrong turns are part of the result

Record **dead ends with the same weight as results** — in the commit message
that closes the work — because a documented wrong turn is the thing the next
session would otherwise repeat.

When a previously-documented claim turns out to be wrong, **correct it in
place**, and say so in the commit message. Several entries in `formats/` were confidently wrong
for multiple sessions.
