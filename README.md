# hotd2-decomp

Reverse-engineering of **The House of the Dead 2** (Windows PC port, 2001) — focused on
its asset and render pipeline.

## Goal

Understand enough of the game's implementation that its levels, textures, models,
camera paths and event scripts can be imported into a modern engine.

The output is:

- **Specifications** for every on-disk format (`docs/formats/`)
- **`hod2lib`** — a pure-Python library that parses them (`tools/hod2lib/`)
- **A glTF 2.0 exporter** with JSON sidecars for non-geometry data (`tools/hod2export.py`)
- **Readable C** reimplementing the RE'd subsystems (`src/`)

## Scope

This is **not** a byte-matching decompilation of `Hod2.exe`. The target is a
documented reimplementation of the asset + render pipeline: loaders, the
compression codec, the NaomiLib model parser, the texture decoder, and the
PowerVR2 → Direct3D 7 material translation.

## What the game is

The PC release is a direct port of the NAOMI / Dreamcast build. It ships native
PowerVR2 data — NaomiLib models, twiddled/VQ textures, and event tables that are
still full of absolute Dreamcast SH-4 RAM pointers — and translates them to
Direct3D 7 at runtime.

That translation layer is the Rosetta stone for this project: because the port
had to convert every PowerVR2 ISP/TSP register word into a D3D7 render state, the
binary contains an authoritative, complete mapping. Material behaviour can be
recovered exactly rather than inferred.

| Component | Detail |
|---|---|
| `Hod2.exe` | PE32 i386, MSVC 6.0, linked 2001-05-09, imagebase `0x400000` |
| `.text` | `0xC2520` (~795 KB) |
| Renderer | Direct3D 7 via `DirectDrawCreateEx` + QI, using the DX7 SDK `d3du`/D3DX utility library |
| Input | DirectInput 7, plus `SEGAJOY.VXD` for arcade gun hardware |
| Audio | DirectSound; BGM/SE/voice ship as plain `.wav` |

## Legal

No game assets are included or redistributed here. You must supply your own copy
of the game. `manifest.csv` records SHA-256 hashes so tooling can be validated
against a known-good input set; it contains no asset content.

## Status

Phases 0-2 and 4 complete. Phase 6 solved `evt/` and `cam/`; `mot/` and `coli/`
remain. Phases 3, 5 and 8 have known gaps.

- [`docs/re/session-log.md`](docs/re/session-log.md) — **start here when
  resuming.** Where the last session stopped and what to do next.
- [`docs/PROGRESS.md`](docs/PROGRESS.md) — phase checklist
- [`docs/PLAN.md`](docs/PLAN.md) — the full plan

## Usage

### Export a level to glTF

```sh
# one whole stage merged into a single file (recommended)
python3 tools/export_level.py --game-dir "/path/to/THE HOUSE OF THE DEAD 2" --stage 2

# ...with unlit materials, so a Rendered view is not black (see Lighting below)
python3 tools/export_level.py --game-dir "..." --stage 2 --unlit

# a single segment
python3 tools/export_level.py --game-dir "..." --name st2_01

# list available level assets
python3 tools/export_level.py --game-dir "..." --list
```

Output lands in `extract/stage2/`:

```
stage2.gltf          the scene
stage2.bin           geometry buffer
textures/st2_01/*.png   PNGs, one folder per segment
```

### Stage geometry and regions

The set of models a stage draws comes from the **region tables in `Hod2.exe`**,
not from globbing `st<N>_*` — which misses files (stage 3's `st3.bin`, all of
stage 6's reused `st5_*`) and includes entries no region draws.

A stage is a sequence of overlapping **regions**; only one is resident and drawn
at a time. That is why a whole-stage export shows segments interpenetrating that
the game never displays together. Every model node carries
`extras.hod2_regions`, and `<stage>_regions.json` lists each region's contents.

`--glob-geometry` restores the old behaviour for comparison.

### Camera paths

Stage exports include the stage's `cam/` data, grouped under three parent nodes:

| Node | Contents |
|---|---|
| `camera_rails` | one polyline per camera path — cyan is where the camera goes, orange is what it looks at |
| `cameras` | one animated perspective camera per path (`cp_st2_00_cam`, …) |
| `object_rails` | `op_` object paths, green. Translation only — their rotation encoding is not settled |

The rails are ordinary edge-only meshes, so the whole camera layout is visible
in the viewport without playing anything. To fly a path, pick its camera in the
Outliner, `Ctrl+Numpad0` to make it active, and scrub.

Two things to know:

- **glTF animation time is in seconds, and Blender's scene defaults to 24 fps.**
  The game runs at 60. Set the scene to 60 fps (Output Properties > Frame Rate)
  and Blender frame numbers line up with game frame numbers.
- Camera keys are baked every 2 game frames by default. `--cam-step 1` gives
  exact 60 Hz; `--no-cameras` skips the whole thing.

Field of view is **not** recovered yet — the exported cameras use a neutral 60°.
Each camera node carries `extras.hod2_yfov_is_a_guess`.

### Lighting: why a Rendered view is black

HOTD2 bakes all illumination into its textures and per-mesh base colour, and
level geometry ships with **no light sources at all**. So:

- **Material Preview** works out of the box — it uses Blender's built-in HDRI.
- **Rendered** is black unless you export with `--unlit`, which marks materials
  `KHR_materials_unlit`. That is the faithful model for this game, not a
  workaround.

### Open it in Blender

**File > Import > glTF 2.0**, pick `extract/stage2/stage2.gltf`.

Keep the `.bin` and `textures/` folder next to the `.gltf` — they are referenced
by relative path.

Notes:

- Each stage segment (`st2_01`, `st2_02`, ...) is a **parent empty** with its
  models as children, so segments can be shown or hidden independently in the
  Outliner.
- Segments are already positioned in **world space**; no manual placement is
  needed.
- Switch the viewport to **Material Preview** to see textures. Game interiors
  carry no lights of their own, so Rendered view looks almost black until you
  add one.
- Levels are large (stage 2 spans ~6700 units). If geometry clips, raise the
  viewport **End** clip distance in the N-panel > View.
- UVs deliberately run outside 0..1; the game relies on texture REPEAT.

### Diagnosing a visual problem

```sh
# replace all textures with a UV checkerboard -- if it still looks wrong,
# the problem is NOT the textures
python3 tools/export_level.py --game-dir "..." --stage 2 --uv-check

# everything known about one material, from its Blender name
python3 tools/inspect_material.py --game-dir "..." --material st2_07_tex12_lambert
```

Paste `tools/blender_whatsthis.py` into Blender's Scripting tab with a face
selected (Tab for Edit Mode, 3 for face select) to dump that face's UVs, area
and texel density to `~/hod2_whatsthis.txt`.

To verify an export without opening the GUI:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender_check.py \
    -- extract/stage2/stage2.gltf --render

# render through one of the game's own camera paths
/Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender_camview.py \
    -- extract/stage2/stage2.gltf cp_st2_50_cam 90
```

`blender_camview.py` reports what the camera is aimed at and the mean luminance
of the result, so "it came out black" is a measurement rather than an
impression — and it distinguishes a lighting problem from a camera pointing at
nothing.

### Regenerate the baseline CSVs

```sh
python3 tools/baseline.py --game-dir "/path/to/THE HOUSE OF THE DEAD 2"
```

## Layout

```
docs/formats/   byte-exact format specs
docs/re/        session log, annotated addresses, anomalies, build provenance
ghidra/         headless driver + GhidraScripts (project DB is not committed)
tools/hod2lib/  the format library
tools/emu/      Unicorn-based function harness (Phase 2)
src/            readable C reference implementations
tests/          golden-file regression suite
extract/        gitignored scratch space for extracted assets
```
