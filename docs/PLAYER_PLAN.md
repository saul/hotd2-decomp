# Browser stage player — plan

**Deliverable:** a web client that renders a HOTD2 stage and lets you step, play
and free-roam through it, driven by the game's own event script — including its
branching paths, enemy encounters and per-keyframe events.

**Status:** not started. This document is the plan only.

Related: [`PLAN.md`](PLAN.md) (the RE plan), [`formats/pipeline.md`](formats/pipeline.md)
(how the formats relate — read this first), [`formats/cam.md`](formats/cam.md),
[`formats/evt.md`](formats/evt.md).

---

## Architecture decision: Python pre-processes, the browser consumes

The client does **not** parse `pol/`, `tex/`, `cam/`, `evt/` or `Hod2.exe`. A
Python tool produces a static bundle; the client loads it.

The alternative — extraction in the browser, so the user just points at their
install directory — needs roughly 2500 lines of TypeScript re-implementing
`lz`, `container`, `nl1`, `texbank`, `exetab`, `cam`, `evt` and the PowerVR2
decoder, plus a golden-file harness to stop the two implementations drifting.
That is the largest single cost and the largest single risk in the project, and
it buys only convenience.

**The cost of this choice, stated plainly:** the user runs

```sh
python3 tools/export_player.py --game-dir "/path/to/THE HOUSE OF THE DEAD 2" --all
```

once, then opens the bundle. That is a real regression from "open the install
directory and go", and it is the price of having exactly one implementation of
every format.

### What still has to live in the client

The **event VM**. It is stateful — branch choice, flags, live enemy count — and
the `wait_*` opcodes gate on conditions that only exist at runtime.
Pre-flattening the timeline would mean materialising every branch combination;
stage 2 has 15 branch points. So the client interprets the script. That is
~300 lines, and it is the interesting part.

Everything else in the client is `GLTFLoader`, a ~20-line cubic Hermite
evaluator, region visibility, and UI.

---

## Library refactor — R0

Today the CLI scripts hold logic the bundle builder needs.
`export_level.stage_geometry()` resolves the region-derived geometry set;
`dump_stage_script.py` holds all operand → filename resolution. Duplicating
either would recreate exactly the divergence problem this architecture was
chosen to avoid.

**Every exporter becomes a library in `hod2lib`; every `tools/*.py` becomes a
thin argparse shell over it.**

| New module | Absorbs | Consumers |
|---|---|---|
| `hod2lib/stage.py` | `export_level.stage_geometry()`, `load_asset()`, `load_cam_paths()` | `export_level.py`, `export_player.py` |
| `hod2lib/script.py` | `dump_stage_script.py`'s operand resolution, as a structured `Program` | `dump_stage_script.py` (text), `bundle.py` (JSON) |
| `hod2lib/campaths.py` | slot-keyed path resolution, `{global_slot: Path}` | `gltf.py`, `bundle.py` |
| `hod2lib/bundle.py` | new — writes the web bundle | `export_player.py` |

`Stage` becomes the single "what is a stage" abstraction: scene id, game mode,
evt file, route table, regions, geometry slot set, parts, texture banks, cam
files, slot → path map, draw modes.

The payoff beyond deduplication: **the JSON the browser eats and the text a
human reads come from one decoder.** An operand-resolution bug shows up in
both, so `dump_stage_script.py` remains a valid oracle for the bundle.

### The refactor must be proved behaviour-preserving

Before touching anything, capture:

- `dump_stage_script.py --full` and `--assets` for all six stages
- `export_level.py --stage N` glTF node / material / texture / triangle counts,
  for both Arcade and `--original`

After the refactor both must be **byte-identical**, and `verify_lz.py`,
`verify_nl1.py`, `verify_walk.py` and `verify_phase6.py` must still pass. R0 is
not done until that holds.

---

## Bundle format

```
extract/player/
  manifest.json                    stages present, tool version, source SHA-256s
  stage2/
    stage2.gltf + .bin + textures/     (GLB at E2)
    stage2.cam.json
    stage2.script.json
  stage2_original/                 game mode 1, same shape
```

`manifest.json` records the SHA-256 of every source file consumed. A bundle
built from a different game build is then detectable rather than mysteriously
wrong — the same principle as `manifest.csv`.

### `stage2.cam.json`

Keyed by **global slot id**, because that is what a `queue_event` sel `0x40`
operand is. Raw Hermite curves rather than baked samples: the client evaluates
exactly at any frame, and can highlight the active `start..end` sub-range on
the rail. Baked `LINEAR` glTF animations cannot express that.

```json
{ "fps": 60,
  "paths": {
    "55": { "file": "cp_st2", "index": 0, "duration": 300.0,
            "channels": { "eye_x":    [[t, v, tan_out, tan_in], "..."],
                          "eye_y":    ["..."], "eye_z": ["..."],
                          "target_x": ["..."], "target_y": ["..."], "target_z": ["..."],
                          "roll":     ["..."] } } },
  "object_paths": { "328": { "...": "..." } } }
```

`cp_st2.bin` is 127 KB binary and lands around 600 KB as JSON, which gzips
hard. If that becomes a problem the fallback is a binary sidecar plus a JSON
index.

The player bundle exports geometry with `--no-cameras`; rails are drawn
client-side from these curves so they can be coloured by playback state.

### `stage2.script.json`

The structure `dump_stage_script.py` already resolves, with operand decoding
folded in so the client never sees an opcode table.

```json
{"index": 1, "ops": [
  {"name": "checkpoint"},
  {"name": "queue_event", "action": "cam_play",
   "start": 0, "end": 300, "slot": 55,
   "cam": {"file": "cp_st2", "path": 0}, "flags": 0},
  {"name": "spawn_placed",
   "spawns": [{"class": 65, "pos": [1.0, 2.0, 3.0], "yaw_deg": 90.0, "hp": 3}]},
  {"name": "wait_cond_b", "arg": 0, "blocks_on": "enemy_count <= 0"},
  {"name": "region_enter", "region": 7},
  {"name": "asset_load_polfile", "file": "znsam2.bin"}
]}
```

Top level also carries the route table, the region tables, and the block/step
tree.

This artifact is worth having **independently of the player**: a readable,
diffable dump of the game's entire scripting, which serves the project's
documentation goal directly.

---

## What the client renders

### Regions, not whole stages

> *"Only one region is ever resident and drawn, so segments that interpenetrate
> in a whole-stage export are never on screen together."*
> — [`formats/pipeline.md`](formats/pipeline.md)

The client tracks `region_enter` (`0x29`) and `region_load` (`0x28`) and draws
**only the current region's models**. Stage 2 has 59 regions of 1–8 models
each, against 18 whole segments loaded at once. Correct occlusion, a fraction
of the draw calls, and a "show all regions" toggle that makes the overlap
legible as a deliberate mechanism rather than an export bug.

Frustum culling per `RegionDrawResidentSet` — bounding sphere, then test —
falls out of Three.js for free.

### Materials

The PowerVR2 → Direct3D 7 translation is decoded
([`formats/materials.md`](formats/materials.md)), and `extras.pvr2` carries the
raw state words, so materials can be exact rather than approximated. Unlit
throughout: the game bakes all illumination into textures and the per-mesh base
colour and ships no light sources.

`extras.hod2_draw_mode` is surfaced in the inspector. Mode 1 selects the scene
light array, whose *source* is still untraced, so unlit remains the default
rather than a guess at those lights.

### Original Mode

Game mode 1 shares the region tables and changes which asset slot a few ids
resolve to, pulling in the `st_org*` models Arcade never draws. The bundle
builder emits both, and the client offers an **Arcade / Original** toggle that
swaps bundles.

---

## The event VM

Faithful to `EvtInterpreterLoop`, `EvtRunQueuedActions` and
`EvtAdvanceBlockOrRoute`.

Blocks are entered at **step 1** — `EvtAdvanceBlockOrRoute` sets the step index
to 1 on every block change, so step 0 is reached only through the checkpoint
path. It is presented as "checkpoint state" rather than run inline. *(The
block-change behaviour is confirmed from the binary; the checkpoint reading is
inference — verify in W3.)*

### Camera

`queue_event` sel `0x40 (start, end, slot, flags)` plays cam path `slot` from
frame `start` to `end`, one frame per tick at 60 Hz. `start == end` is a static
pose; `flags & 2` continues from the current frame. Sel `0x21` (444 uses) hands
control back from a path. Sel `0x20` (2 uses) sets a fixed pose from the table
at `0x00576CF0`. Sel `0x60` (13 uses) is the branch-preview candidate.

### Blocking opcodes

| Op | Resolves when |
|---|---|
| `0x40` `wait_pending` | the camera command queue drains |
| `0x41` `wait_cond_a N` | `N == 0`: current move complete. `N > 0`: path frame > `N` |
| `0x42` `wait_frames N` | `N` ticks elapsed |
| `0x43` `wait_cond_b N` | **live enemy count ≤ `N`** — the combat gate |
| `0x44` / `0x46` | secondary counters ≤ `N` |
| `0x45` `wait_flag N` | flag `N` set by `set_flag` (`0x48`) |
| `0x47` `wait_ready` | camera settled |

### Enemies and branching

Enemies are simulated at **1 s each** (tunable: 0.5 s / 1 s / 2 s / instant),
driving the enemy-count waits. Branch points pause playback, offer the valid
non-`-1` route targets, run a **5-second arcade countdown** and pick randomly on
timeout — from a **seeded** RNG, so playback is reproducible for tests.

---

## UI

Three modes over one scene and one VM.

- **Step** — block → step → op tree; every op seekable; a frame slider within a
  camera move.
- **Play** — 60 Hz with a speed control; pauses at branches.
- **Free roam** — orbit/fly, detached from the rail.

Always on: camera rails with the active sub-range highlighted, `op_` object
rails, spawn markers oriented by BAMS yaw and labelled with class and HP, a
route-graph minimap, and a HUD reading block / step / region / cam slot / frame
/ live enemies / branch choice.

**Event feed** — a scrolling log of ops as they execute, categorised camera /
spawn / audio / view / flow / assets / region, each entry clickable to seek.
Opcodes that are still only named by the global they touch show **raw
operands** rather than a guessed label.

- **Enemies are markers.** The class → model mapping is genuinely unsolved
  (the class table holds handler code addresses, not model ids). Real models
  are a follow-on once that is traced.
- **BGM plays; SE and voice are shown only.**

**All state is URL-addressable** — `?stage=2&block=3&step=1&op=14`, or
`&slot=59&frame=170`. This is a user-facing deep-link feature *and* the hook the
visual tests need, so it is built in W1 rather than bolted on later.

---

## Phases

| # | Deliverable | Done when |
|---|---|---|
| **R0** | Library refactor | pre/post output byte-identical; all `verify_*` pass |
| **E1** | `tools/export_player.py`, `hod2lib/bundle.py`, cam + script serialisers | stage 2 bundle validates against a JSON schema |
| **E2** | GLB packaging in `gltf.py` | one file replaces `.gltf` + `.bin` + ~1300 PNGs |
| **W1** | Vite + TS + Three scaffold, bundle loader, static render, URL state | stage 2 matches the `--unlit` glTF export |
| **W2** | Hermite eval, rails, free-roam camera | `cp_st2` slot 110 at frame 90 reproduces the known Venice plaza shot |
| **W3** | Event VM, region visibility, step mode | every op reachable and seekable; only the current region drawn |
| **W4** | Play mode, branching, enemy simulation | stage 2 plays end to end through all 15 branch points |
| **W5** | BGM, route minimap, Arcade/Original toggle, polish | — |
| **W6** | Visual regression harness | below — **deferred; W1–W5 ship without it** |

---

## W6 — Chrome visual regression

**Playwright + Chromium.** Navigate to a URL-addressed state, wait for a
rendered frame, assert.

```
web/test/visual/stage2.spec.ts
  → /?stage=2&block=3&step=1&op=14&freeze=1
```

### Determinism

Fixed canvas size; `--use-angle=swiftshader` so output does not vary with the
GPU driver; seeded branch RNG; a `freeze=1` parameter that halts the tick loop
and renders exactly one frame; an explicit wait on a render-complete promise
rather than a timeout.

### What may be committed

`tests/README.md` sets the policy: tests assert against *"hashes and derived
metrics … never against embedded asset content."* A screenshot of stage 2 **is**
derived game art, so it cannot be committed. Therefore:

- **Committed:** compact numeric signatures — mean luminance over a 16×16 tile
  grid (256 floats), plus draw-call count, visible region id, camera position
  and orientation, and spawn-marker count at that op. No asset content, small,
  diffable.
- **Local only, gitignored:** the full PNGs, for human diffing when a signature
  fails.

This mirrors existing practice — `blender_camview.py` already prints mean
luminance so *"it rendered black"* is a measurement rather than an impression.

### Cheap assertions first

Draw-call count, region id, camera pose and marker count are exact, fast, and
catch most regressions with no image at all. Pixel signatures catch the rest.

### Cross-implementation oracle

Render the same camera path frame two ways: through Blender via
`blender_camview.py` on the glTF, and through the browser. They should agree on
mean luminance and on what the camera is aimed at.

That checks the new renderer against the **established-good export** rather than
against itself, and it reuses a tool that already exists. It is the strongest
check available here.

---

## Consumes from the RE effort; does not block on it

| Item | Effect if unresolved |
|---|---|
| **sel `0x40` `args[1]` is the end frame.** `cam.md` records the layout as `[t][?][slot][flags]`. `FUN_00403510` loads the frame counter `+0x144` from `args[0]` and the terminator `+0x148` from `args[1]`; `FUN_004035E0` increments until it reaches it. Shipped data confirms — consecutive commands tile a path exactly (`0→50`, `51→89`, `90→169`, `170→205`, `206→300`, `301→465`, all slot 59) | **blocks W3** — camera segments have no terminator without it. Needs folding into `cam.md` and the serialiser |
| sel `0x60` = three `(slot, frame)` pairs indexed by branch choice, read back by `FUN_00403DB0` as `&DAT_009C6FDC + branch*8` — i.e. the arcade branch-preview shots. `cam.md` currently calls it "a six-component pose". **Hypothesis, not a finding** | branch UI shows route targets without preview shots |
| Field of view. The unread 8th `cp_` curve index is **constant 0.833 across all 239 camera paths in the game**, so it is not a per-path FOV. (0.833 rad = 47.7°, suspicious enough to keep as a lead.) The projection matrix construction has not been located | FOV slider plus an "is a guess" badge |
| `bgm_set` operand → `sound/bgm/*.wav` | BGM events shown, not played |
| Scene light array source — 16 × `D3DLIGHT7` at `0x007E7AA8`, populated at runtime from an untraced source | unlit stays the default; `draw_mode` shown in the inspector |
| Spawn class → model | enemies stay markers |
| Global handedness. The game is D3D and likely left-handed; a mirrored render is still "recognisable" and would not have been caught by the Venice plaza check | check a texture with legible signage; one flip at load if mirrored |

Resolved since this plan was first drafted, and no longer risks:

- **16-bit UVs** — the bit marks an untextured mesh and does not change the
  vertex layout. No meshes were ever mis-parsed.
- **Stage geometry set** — regions supersede globbing `st<N>_*`.
- **Original Mode** — solved, and now a client feature rather than a gap.

---

## Risks

| Risk | Mitigation |
|---|---|
| Refactor silently changes exporter behaviour | byte-identical output capture before/after; R0 gated on it |
| `cam.json` size (~600 KB per stage) | gzip; binary sidecar fallback |
| ~1300 texture requests before E2 | HTTP/2, or bring GLB forward |
| Play-mode pacing (1 s/enemy) is a guess | tunable; validate against footage |
| Step-0 semantics are inferred | explicit W3 verification before it shapes the timeline UI |
| Visual baselines drift with Chromium versions | pin the Playwright browser build; signatures are tolerance-banded, not exact |
| Two docs disagree as RE lands underneath | the bundle records source hashes and tool version; `dump_stage_script.py` stays the oracle |

---

## Open decision

**GLB at E2, or E1?** Loose files need no exporter changes and are much easier
to debug during W1; GLB is one file and no fetch storm. Recommendation: loose
files through W1, GLB at E2 once the bundle shape has settled.
