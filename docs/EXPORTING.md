# Exporting assets, and looking at what came out

How to get geometry, textures and camera paths out of the game and into
Blender, and how to tell an exporter bug from a viewer setting. Extracted from
the top-level `README.md`, which is the front door and should stay one.

The browser player is the *other* consumer of the same library and has its own
document, [`../web/README.md`](../web/README.md).

## Export a level to glTF

```sh
# one whole stage merged into a single file (recommended)
python3 tools/export_level.py --game-dir "/path/to/THE HOUSE OF THE DEAD 2" --stage 2

# ...with unlit materials, so a Rendered view is not black (see Lighting below)
python3 tools/export_level.py --game-dir "..." --stage 2 --unlit

# Original Mode geometry (game mode 1) instead of Arcade -- same regions, but
# a few slots resolve to the st_org* models Arcade never draws
python3 tools/export_level.py --game-dir "..." --stage 2 --unlit --original

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

## Stage geometry and regions

The set of models a stage draws comes from the **region tables in `Hod2.exe`**,
not from globbing `st<N>_*` — which misses files (stage 3's `st3.bin`, all of
stage 6's reused `st5_*`) and includes entries no region draws.

A stage is a sequence of overlapping **regions**; only one is resident and drawn
at a time. That is why a whole-stage export shows segments interpenetrating that
the game never displays together. Every model node carries
`extras.hod2_regions`, and `<stage>_regions.json` lists each region's contents.

`--glob-geometry` restores the old behaviour for comparison.

The game has a **second** set of region id tables, selected when the mode-select
index is 1 — **Original Mode**. Region membership is identical; a handful of
ids resolve to different models, bringing in `st_org00`–`st_org03`, which no
region draws in Arcade mode. `--original` exports that variant.

## Camera paths

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

## Lighting: why a Rendered view is black

HOTD2 bakes all illumination into its textures and per-mesh base colour, and
level geometry ships with **no light sources at all**. So:

- **Material Preview** works out of the box — it uses Blender's built-in HDRI.
- **Rendered** is black unless you export with `--unlit`, which marks materials
  `KHR_materials_unlit`. That is the faithful model for this game, not a
  workaround.

## Open it in Blender

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

## Diagnosing a visual problem

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

`tools/blender_probe.py` is the headless equivalent: give it the pixel you are
suspicious about and it tells you which mesh is there.

```sh
# what is at 8% across, 60% down, in this camera's view?
/Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender_probe.py \
    -- extract/stage2/stage2.gltf cp_st2_50_cam 90 0.08 0.60

# rank the whole frame by texel aspect ratio, worst first
/Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender_probe.py \
    -- extract/stage2/stage2.gltf cp_st2_50_cam 90 0 0 --sweep
```

To verify an export without opening the GUI:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender_check.py \
    -- extract/stage2/stage2.gltf --render

# render through one of the game's own camera paths
/Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender_camview.py \
    -- extract/stage2/stage2.gltf cp_st2_50_cam 90
```

Exported cameras carry the game's real projection — **41.1° vertical FOV**,
4:3, near 0.8, far 8000 — recovered from `SetupSceneProjection`. It is a
compile-time constant: the game has no zoom and no per-camera FOV.

`blender_camview.py` reports what the camera is aimed at and the mean luminance
of the result, so "it came out black" is a measurement rather than an
impression — and it distinguishes a lighting problem from a camera pointing at
nothing.

> ⚠️ **Render unlit exports with EEVEE, which is now the default.** Blender's
> glTF importer cannot put two different wrap modes on an Image Texture node,
> so it sets `extension = EXTEND` and emulates the real modes with shader
> nodes. Workbench does not evaluate shader nodes, so under Workbench every
> material with a clamped or mirrored axis renders clamped on *both* — one row
> of texels smeared across the face, and solid black where the UVs go
> negative. It looks exactly like a UV bug in the exporter and is not one.
> `--engine workbench` is still right for geometry-only checks.

## Regenerate the baseline CSVs

```sh
python3 tools/baseline.py --game-dir "/path/to/THE HOUSE OF THE DEAD 2"
```

