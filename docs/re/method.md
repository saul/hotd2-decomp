# Method — how to work on this project

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
| Compression codec | 14 candidate sliding-window sites triaged, all wrong (Session 3) | traced the loader's `ReadFile` buffer to its consumer — found in one pass |
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
   aggregates and dump the raw records of the outliers (Session 9/10).
3. **A filter wider than the program's own test manufactures anomalies.** The
   `evt/` "span problem" was entirely an artefact of filtering `0x0Cxxxxxx`
   when the loader tests a window 32x narrower.
4. **Try both id spaces before believing either.** `pol/` file indices are
   assigned alphabetically, so *any* run of consecutive integers decodes into a
   plausible sequence of related filenames. That produced a convincing, wrong
   "stage segment table" in Session 11.
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
sample:

- `lz` — 793/793 files decompress to exactly the declared size
- `texbank` — 303/303 banks resolve with mean coverage 1.000
- `cam` — 100.0000 % byte coverage on all 24 files
- `evt` — 17,150 instructions decode with zero errors, no stub opcodes reached
- asset slots — 326/326 EXE entry counts equal the container model count

Pick a metric that *collapses* when the interpretation is wrong. Byte coverage
is ideal: a wrong stride desynchronises a linear walk immediately. "It did not
crash" is not a metric.

`tools/verify_*.py` are the runnable form of this. Add to them.

### Corollary: appearance has no such metric

Coverage and decode-error counts collapse when a *parsing* interpretation is
wrong. Nothing equivalent exists for a change that alters which pixels get
sampled. A UV change that flattened the texture off a whole wall moved mean
luminance by 0.0001 (0.3194 → 0.3193) and passed every numeric check in the
repo.

**So: any change affecting appearance gets a before/after render through a game
camera, looked at, before it is committed as the default.**

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender_camview.py \
    -- extract/stage2/stage2.gltf cp_st2_50_cam 90
```

### Corollary 2: the renderer you check with is part of the experiment

Blender's glTF importer cannot put two different wrap modes on an Image
Texture node, so it sets `extension = EXTEND` and emulates the real modes with
shader math nodes. **Workbench does not evaluate shader nodes.** Under
Workbench every material with a clamped or mirrored axis therefore renders
clamped on *both* axes — one row or column of texels smeared across the face,
and solid black wherever the UVs run negative.

That is indistinguishable from a UV bug in the exporter, and Session 13 spent
hours on it. Before concluding anything from a render, know what the renderer
is faking.

**And it recurred.** Session 18 rendered a reconstructed rig with a hand-rolled
Workbench script and shipped the image as evidence. The car's rear read as a
stretched smear — which the user spotted, not the checks. The export was
correct: several body materials set `flip_uv = 2` → `wrapS = MIRROR`, and
Workbench was faking it.

Writing the corollary down was not enough, because the trap is in the *next*
script, not the one that was fixed. So the rule is carried by the tools now:
`blender_camview.py`, `blender_check.py` and `blender_nodeview.py` all default
to EEVEE for unlit files and print which engine they used. **Do not hand-roll
another render script — use one of those.**

### Corollary 3: when a face looks wrong, bisect the pipeline, don't stare

Three cheap, decisive tools, in the order they should be used:

1. `tools/blender_probe.py <gltf> <cam> <frame> <sx> <sy> …` — raycast a pixel
   and print the object, material, image, the face's UVs and its world-units
   per texel. `--sweep` ranks the whole frame by texel aspect. Reading pixel
   coordinates off a screenshot by eye is guesswork; this is not.
2. `export_level.py --uv-check` — replace every texture with a checkerboard.
   Distinguishes "the UVs are degenerate" from "the texture decoded wrong" in
   one render.
3. **Turn one thing off.** Forcing every sampler to `REPEAT` and re-rendering
   located Session 13's bug in a single step, after a long time spent probing
   UV values that were correct all along.

---

## Rule 4: the session log is the deliverable

`session-log.md` is the handoff. Record **dead ends with the same weight as
results** — a documented wrong turn is worth more than an undocumented right
one, because it is the thing the next session would otherwise repeat.

When a previously-documented claim turns out to be wrong, **correct it in place
and say so in the log.** Several entries in `formats/` were confidently wrong
for multiple sessions.
