# How the pieces fit together

`pol/`, `tex/`, `cam/`, `evt/` and a stage are four different things joined by
two id spaces and one job queue. This page is the map. Each claim is marked:

- **[proved]** — read out of the binary and cross-checked against the data
- **[measured]** — a statistic over all shipped files
- **[open]** — not established; stated so it is not mistaken for a finding

---

## The two id spaces

Almost every number in an event script is one of these. Confusing them is the
single easiest way to produce a plausible-looking wrong answer.

| Space | Range | Meaning | Lookup |
|---|---|---|---|
| **pol/tex file index** | 0–397 | one file in `pol/` or `tex/` | `0x004D0EF4` / `0x004D1410` → filename |
| **asset slot id** | 0–~8400 | one *model* inside a pol file | `0x004E83B4` → owning file; `0x004E794C` → position within it |

A `pol/` file is a bundle of numbered slots. `pol/st2_07.bin` holds 14 models,
which are slots 5024, 5029, 5030, 5045, 6129, 6131, … in container order.

**[proved]** The mapping is four parallel tables in `Hod2.exe`:

```
0x004D0EF4  ptr  file index -> filename
0x004E803C  u16  file index -> entry count
0x004E794C  ptr  file index -> s16[count], slot id of each entry in order
0x004E83B4  u16  slot id    -> owning file index
```

**[measured]** For all **326** live pol files the EXE's entry count equals the
model count the container parser finds — 326/326, zero mismatches. Indices
≥ 328 are a second copy of the name list with a count of 0: the `pol_`-prefixed
duplicates, which are therefore *disabled table entries*, not spare data.

Exposed as `ExeTables.pol_files()` and `ExeTables.asset_slots()`.

> **Trap.** pol file indices are assigned in alphabetical order, so *any* run of
> consecutive integers decodes through that table into a plausible-looking
> sequence of related filenames. A run that reads `st2_01, st2_02, st2_03 …` is
> not evidence that the numbers are file indices. Always check the same run
> against the slot table too; see the note at the end of this page for a case
> where this produced a wrong answer.

---

## The asset job queue

**[proved]** Loading is asynchronous, through a 64-entry ring buffer at
`0x007DA220`, write cursor `0x007D9E1C` (masked `& 0x3F`). Each job is 16 bytes:

```
+0x00  u32 kind     index into the handler table at 0x00588C20
+0x08  u32 arg      slot id, or pol/tex file index, depending on kind
+0x0C  u32 state    sub-step; also selects the sub-handler for kinds 0/1/3
```

`FUN_0041D5A0(i)` runs job `i & 0x3F` as `handler[kind](job)`.

Handler table `0x00588C20`:

| kind | Fn | Role |
|---|---|---|
| 0, 1 | `0x00418B80` | sub-dispatch on `job.state` via `0x0057A29C` |
| 2 | `0x00418BA0` | **unload one slot** — unlink, free buffer, clear state |
| 3 | `0x00419000` | sub-dispatch via `0x0057A2A4` (whole-file load) |
| 4 | `0x00419020` | **release a whole pol file** and mark its slots absent |
| 5 | `0x00418780` | free everything (shutdown) |
| 6 | `0x0041CCA0` | texture bank setup |
| 7 | `0x0041CD00` | texture bank teardown |

Sub-handler table `0x0057A29C`:

| # | Fn | Role |
|---|---|---|
| 0 | `0x00418820` | **load one slot** — read the file's offset table, find the slot's entry, `SetFilePointer`, read just that model |
| 2 | `0x00418C20` | read a whole pol file into the staging buffer |
| 3 | `0x00418D20` | LZ-decompress staging into a fresh buffer |
| 4 | `0x00418D80` | read a tex file into staging |
| 5 | `0x00418E40` | bank setup |
| 6 | `0x00418EC0` | register each model in the bank (emits `Texture Skipped.`) |

Slot state lives in a 16-byte record at `0x009A66A0`:

```
+0x00  u32  raw allocation pointer
+0x04  u32  data pointer (32-aligned) -- the NL1 model
+0x08  s16  prev        doubly-linked active list
+0x0A  s16  next
+0x0C  u16  flags       bits 1-3 = state: 0 free, 2 loading, 4 loaded, 6/8 banked
```

So slot-granular streaming genuinely exists: `FUN_00418820` seeks into a pol
file and reads one model, without loading the rest.

---

## What the event script actually does

**[proved]** Event opcodes `0x50`–`0x57` are the asset vocabulary. Each pushes
one job:

| Op | Name | kind | Operand |
|---|---|---|---|
| `0x50` | `asset_load_slot` | 0/1 | slot id |
| `0x51` | `asset_unload_slot` | 2 | slot id |
| `0x52` | `asset_load_polfile` | 3 | pol file index |
| `0x53` | `asset_free_polfile` | 4 | pol file index |
| `0x54` | `asset_load_texbank` | 6 | tex file index |
| `0x55` | `asset_free_texbank` | 7 | tex file index |
| `0x56` | `asset_job_8` | 8 | tex file index |
| `0x57` | `asset_job_9` | 9 | tex file index |

These were previously guessed to be voice/sound calls. They are not.

**[measured]** In `st2evtbl.bin`, 405 slot operations and 794 file operations
resolve to real filenames with **zero** unresolved ids. The traffic is enemies,
props, effects, character models and HUD texture banks — paged in and out
around the blocks that need them, e.g. `znsam2.bin` loaded and freed 29/13
times across the stage.

`tools/dump_stage_script.py --assets` prints this per stage.

---

## Stage geometry: regions — SOLVED

**[proved]** A stage is divided into **regions**. The current region id lives in
`DAT_009A2224`. Each region names a small set of asset slots, and that set is
used for **both drawing and streaming**:

| Fn | Role |
|---|---|
| `RegionDrawResidentSet` `0x00401260` | for each slot in the current region: bounding sphere → frustum cull → draw |
| `RegionLoadDelta` `0x00401510` | load **(new region \ old region)** |
| `RegionUnloadDelta` `0x004015A0` | free **(old region \ new region)** |
| `RegionBindSceneTables` `0x004014C0` | point the region tables at the current scene |

Two event opcodes drive it — they were previously mis-named as BGM control:

| Op | Name | Effect |
|---|---|---|
| `0x29` | `region_enter` | `prev = cur; cur = arg;` then `RegionUnloadDelta(prev, cur)` |
| `0x28` | `region_load` | `RegionLoadDelta(arg, cur)` — preload a region's assets |

Tables, per scene:

```
0x00576A2C  ptr  scene -> region table, 0x18 bytes per region,
                 s16 slot-list ids terminated by -1 (max 12)
0x00576A5C  ptr  scene -> id table, 4 bytes: {s16 asset_slot, s16 draw_mode}
0x00576A8C / 0x00576ABC     the same pair for game mode 1
```

The count is not stored: each table ends where the next-highest begins.

`RegionBindSceneTables` (`0x004014C0`) picks the pair:

```c
if (g_GameMode /* 0x009CA08C */ == 1) { region = mode1_rt[scene]; ids = mode1_it[scene]; }
else                                  { region = rt[scene];       ids = it[scene];       }
```

**[measured]** Bounded that way, the region counts are 13 / 59 / 26 / 39 / 10 /
14 for stages 1–6 — and the largest region id any script passes to opcode
`0x28`/`0x29` is exactly `count - 1` for **every** stage, with no operand out of
range. An exact fit on six independent tables.

### Why stage geometry overlaps but is never seen to

Consecutive regions share most of their models and swap one or two — a sliding
window along the rail. Stage 2:

```
region  5 : st2_10[0], st2_10[1], st2_10[2]
region  6 : st2_04[0], st2_04[2], st2_10[1], st2_10[2], st2_11[0]
region  7 : st2_04[0], st2_04[2], st2_07[1], st2_10[2], st2_11[0], st2_07[7]
region  8 : st2_04[2], st2_07[1], st2_10[2], st2_11[0], st2_07[7]
```

Only one region is ever resident and drawn, so segments that interpenetrate in
a whole-stage export are never on screen together. `export_level.py` writes a
`<stage>_regions.json` sidecar and tags every model node with
`extras.hod2_regions` so the sets can be told apart.

### `draw_mode` — how a region entry is submitted

**[proved]** The second `s16` of a region id entry selects one of three paths in
`RegionDrawResidentSet`.

| Mode | Count | Path |
|---|---|---|
| 0 | 470 | `AssetDrawSlot` → `RenderSubmitModelDefaultLight`, draw command flags `0` |
| 1 | 90 | when the opcode-`0x14` toggle `DAT_009A2BB4` is set: `SubmitSlotWithSceneLightArray` → `RenderSubmitModelSceneLights`, flags `0x04000000`. Falls back to mode 0 when clear |
| 2 | 4 | mode-0 draw bracketed by `SetDrawLayerNibble(7)` / `SetDrawLayerNibble(8)` |

**Mode 1 is a lighting selector.** The two submit routines are byte-for-byte
identical except for the command's flag word. `RenderEnqueueCommand` tests
bit `0x04000000` and installs one of two D3D7 light setups:

```c
if ((flags ^ prev) & 0x0C000000) {
    if (!(flags & 0x04000000)) SetLightingDefaultSingle();  /* 1 dir light  */
    else                       SetLightingSceneArray();     /* up to 16     */
}
```

- `SetLightingDefaultSingle` — `SetRenderState(D3DRENDERSTATE_AMBIENT, …)`,
  `SetLight(0, …)`, `LightEnable(0, TRUE)`, then `LightEnable(1..15, FALSE)`.
  One directional light, colour scaled ×1.4 with a ×0.3 secondary term.
- `SetLightingSceneArray` — walks an array of up to **16** light structures at
  `0x007E7AA8`, enabling each per a parallel flag array. **[proved]** the stride
  is `0x1A` dwords = **104 bytes**, exactly `sizeof(D3DLIGHT7)`.

Device vtable offsets used, identified from that stride and the 0–15 loop:
`+0x48` `SetLight`, `+0x50` `SetRenderState`, `+0xB0` `LightEnable`.
Render-state *numbers* other than `0x8B` (`D3DRENDERSTATE_AMBIENT`) are not yet
mapped — that needs the DX7 GDT, still deferred from Phase 1.

**Mode 2 is a draw-order override.** `SetDrawLayerNibble(n)` stores `n & 0xF`,
which `RenderEnqueueCommand` ORs into the command header alongside
`0x40000000`. `RenderInitStates` sets the default to **8**, so bracketing with
7 puts the model in an *earlier* layer. Only four entries in the whole game use
it, all in stage 1 (`st1_01b[0]`, `st1_05[0]`).

Exported as `extras.hod2_draw_mode` on every model node. Stage 2 has 9 mode-1
models (`st2_13[0..3]`, `st2_12[0..1]`, `st2_06[3..4]`, `st2_02b[1]`) and no
mode-2.

### Game mode 1 is Original Mode — [proved]

`g_GameMode` (`0x009CA08C`) is the mode-select menu index, written in
`FUN_00496960` from the cursor `DAT_009A2226` for entries 0–3 and reset to 0
everywhere a game starts from elsewhere.

**Mode 1 shares the region tables and changes only the id tables.** Region
membership — which id each region names — is byte-identical between the two
modes on every scene; four scenes reuse the mode-0 id table outright. What the
mode-1 id table changes is which *asset slot* an id resolves to:

| Scene | Stage | ids differing | substituted models |
|---|---|---|---|
| 0 | 1 | 2 of 17 | `st1_03[0]→st1_03[1]`, `st1_03c[0]→st1_1[0]` |
| 1 | 2 | 2 of 59 | `st2_03[2]`, `st2_10[0]` → `st_org00[0..1]` |
| 2 | 3 | 2 of 28 | `st3_08[1]`, `st3_08[5]` → `st_org01[0..1]` |
| 3 | 4 | 9 of 39 | `st4_*` → `st_org02[1,2,5,6,8]` |
| 5 | 6 | 1 of 12 | `st6_01b[7]` → `st_org03[0]` |
| 4, 6–11 | — | none | mode-1 pointer equals the mode-0 one |

`st_org00`–`st_org03` — **st**age, **org**inal mode — are drawn by no region in
mode 0, which is why globbing `st<N>_*` never found them. `draw_mode` is
preserved by every substitution; only the slot changes.

**[measured]** Every substituted model's bounding box lies strictly inside the
mode-0 geometry bounding box of the same stage, on all five stages. A wrong
id→slot mapping would put a model somewhere else in the world.

`FUN_004040A0` gives a second, independent tell: while loading a scene's slot
list it appends slot `0x16` to every entry **only when `g_GameMode == 1`**. And
the `pol/` directory carries a whole `_org` family (`car_org`, `eff_org*`)
alongside the four `st_org*` files.

Export it with `export_level.py --original`; output lands in
`extract/stage<N>_original/` and the sidecar records `"game_mode": 1`.

### The projection matrix and the field of view — SOLVED

**[proved]** `SetupSceneProjection` (`0x004184C0`), called from the per-frame
scene update, builds the game's one 3D projection through an OpenGL-style
matrix API:

```c
SetMatrixMode(3);                                   /* PROJECTION */
MatrixLoadIdentity();
MatrixTranslate(g_screen_offset_x, g_screen_offset_y, 0);   /* both 0 */
BuildPerspectiveProjection(0x1D3B, 4.0f/3.0f, 0.8f, 8000.0f);
SetMatrixMode(1);                                   /* commits it */
```

`SetMatrixMode` (`0x004A9250`) is the whole mechanism: the projection is built
on the same matrix stack used for object transforms, and installed on the
3 → 1 transition —

```c
if (mode == 1 && current == 3) {
    SetTransform(D3DTRANSFORMSTATE_PROJECTION, g_MatrixStackTop);
    memcpy(g_projection_matrix_cache, g_MatrixStackTop, 64);
}
```

— which is the only place `D3DTRANSFORMSTATE_PROJECTION` is ever set.

`BuildPerspectiveProjection(fov_bams, aspect, znear, zfar)` (`0x004ABD40`)
takes the **full vertical FOV in BAMS**, halves it through `__ftol` (so the
halving truncates), and builds a left-handed D3D matrix:

```
half = (int)(fov_bams * 0.5)
cot  = cot(half * 2*PI/65536)
m00 = cot/aspect   m11 = cot
m22 = zf/(zf-zn)   m23 = 1   m32 = -zn*zf/(zf-zn)
```

It has **exactly two call sites**, `SetupSceneProjection` and
`SetProjectionNearPlane(zn)` (`0x004194C0`, used for HUD/overlay layers with a
near plane of 1e-5 or 0.001), and **both pass the same FOV and aspect**. So:

| | |
|---|---|
| vertical FOV | `0x1D3B` BAMS = **41.100°** = 0.7173277659 rad |
| horizontal FOV | **53.115°** |
| aspect | 4:3 |
| near / far | 0.8 / 8000.0 |

There is no zoom and no per-camera FOV anywhere in the game.

**Confirmed independently.** The same function also computes
`g_projection_distance_px = 240.0 / tan(0.35866388296751145)` = 640.21 — the
projection distance in pixels for a 480-tall viewport, `(480/2)/tan(fovY/2)` —
and `0.35866388296751145` is *bit for bit* `3741 * 2π/65536`, the halved BAMS
angle. Two constants, one FOV.

> ⚠️ **A 60° red herring.** `InitD3DDeviceAndTextureStages` builds a second
> perspective matrix from `DAT_00598778` = 60.0 degrees, aspect 0.9, near 1.0,
> far 6000.0, into `DAT_007DE5C8`. That matrix is never handed to the device —
> `DAT_007DE5C8` has exactly one xref, the call that fills it, and
> `DAT_00598778` has exactly one read. It is stock `d3du` sample scaffolding
> and is dead code. The exporter's earlier 60° placeholder matched it by
> coincidence.

The matrix API, all angles in BAMS (65536 = 360°):

| Address | Name |
|---|---|
| `0x004A9250` | `SetMatrixMode` |
| `0x004A9880` / `0x004A9840` | `MatrixStackPush` / `MatrixStackPop` |
| `0x004A9E10` | `MatrixLoadIdentity` (from `g_identity_matrix`, `0x00571210`) |
| `0x004A9D80` | `MatrixTranslate` |
| `0x004A99F0` / `0x004A9AE0` | `MatrixRotateX` / `MatrixRotateY` |
| `0x004A92A0` | `MatrixMultiply` (top = top × M) |
| `0x004ABD40` | `BuildPerspectiveProjection` |

### The draw command — 0x1D dwords

`AssetDrawSlot` → `RenderSubmitModelDefaultLight` builds a 116-byte command on
the stack and hands it to `RenderEnqueueCommand`, which copies it into a ring
buffer and appends a pointer to a sort list. `RenderFlushCommandList`
(`0x004A88E0`) sorts that list and replays it.

| Offset | Dwords | Field |
|---|---|---|
| `+0x00` | 1 | flags — `0x04000000` scene lights, `0x20000000` sprite, `0x40000000` model, low nibble = draw layer |
| `+0x04` | 1 | sort depth; seeded from the world matrix's `_43` and refined to the nearest mesh Z by the walker |
| `+0x0C` | 1 | **model pointer** |
| `+0x10` | 1 | alpha multiplier, used only by `DrawModelWithForcedAlphaBlend` |
| `+0x14` | 4 | fog / ambient parameters |
| `+0x24` | 1 | light-set generation id |
| `+0x28` | 3 | fog colour |
| `+0x34` | 16 | **4×4 world matrix**, installed with `SetTransform(D3DTRANSFORMSTATE_WORLD, …)` |

The world matrix is copied from the top of a matrix stack at `g_MatrixStackTop`
(`0x007E7990`), 16 dwords per level, pushed by `MatrixStackPush` (`0x004A9880`)
and popped by `MatrixStackPop` (`0x004A9840`).

`RenderFlushCommandList` picks the walker from the command flags: bit
`0x20000000` selects `DrawSpriteQuadCommand`, otherwise
`WalkMeshChainAndDraw`, except that flag `0x20000000` on a *model* command
routes to `DrawModelWithForcedAlphaBlend` (`0x004A8440`). That variant is the
mesh walker with two overrides: it rewrites each mesh's TSP as
`(tsp & 0x03FFFF7F) | 0x94000080` — forcing `SRCBLEND = SRC_ALPHA`,
`DESTBLEND = INV_SRC_ALPHA` — and multiplies the material alpha by the
command's `+0x10` word. It is the fade / ghost path.

**[proved]** `RegionDrawResidentSet` brackets every slot draw with
`MatrixStackPush(NULL)` / `MatrixStackPop(1)` and modifies nothing in between —
a push that duplicates the top. **So region scenery is drawn with an unmodified
scene-root matrix; placed geometry carries no per-model transform**, and
exporting its vertices as-is is correct.

### The real stage geometry set

**Globbing `st<N>_*` is wrong in both directions.** The authoritative set is

> the union of every asset slot named by any of the scene's regions, plus every
> slot the event script loads with opcode `0x50`.

Whole-file loads (`0x52`) are excluded — those are spawnable actors, not placed
scenery.

**[measured]** Spawn positions checked against the bounding box of the geometry
set, per stage:

| Stage | glob | region set |
|---|---|---|
| 1 | 100 % | 100 % |
| 2 | 512/513 | **513/513** |
| 3 | **77 %** | **100 %** |
| 4 | 199/201 | **201/201** |
| 5 | 100 % | 100 % |
| 6 | 100 % | 100 % |

Stage 3's long-standing 77 % was the glob missing `st3.bin`. Stage 6 draws
`st5_01`, `st5_01b`, `st5_02`, `st5_02b` — it genuinely reuses stage 5
geometry, which no `st6_*` glob can find.

`ExeTables.scene_regions()`, `.scene_geometry_slots()`,
`.scene_geometry_files()`.

## Camera, script and geometry during play

```
       scene id  (DAT_009A1A08)          0..11, one per stage/cutscene
            |
            +-- evt file        0x00579928 -> 0x004D1C7C -> evt/<name>.bin
            |     |
            |     +-- block table (root array in the evt file)
            |            |
            |            +-- step -> bytecode stream, run by FUN_0045ECC0
            |                   |
            |                   +-- 0x09/0x0B/0x0C  spawn enemies at world coords
            |                   +-- 0x50..0x57      load/unload assets
            |                   +-- 0x40..0x47      block until a condition holds
            |                   +-- 0x20..0x27      drive the view struct
            |                   +-- 0x4F            end block -> route table
            |
            +-- route table     0x00597890 -> {kind, next[3]} per block
                                kind 1 = branch on DAT_009C88A4
```

**[proved]** The event script is the stage's timeline. Blocks run in an order
chosen by the route table, which is where the game's branching paths live —
stage 2 has 42 blocks with 15 branch points. A block's steps are bytecode
streams; the `wait_*` opcodes are what make it a timeline rather than a batch
script, since they set the yield flag and stop the interpreter until their
condition holds.

**[open] How a `cam/` path is selected has not been traced.** The camera is
evaluated by `FUN_004041E0(slot, t, …)` reading a global path slot; what writes
that slot is not yet found. Opcodes `0x18`/`0x19` were an earlier guess and are
**wrong** — they write view+0x18/+0x1C, which `FUN_00401F40` passes to
`FUN_0040E0B0` as *rotation angles*, not path ids.

What is certain is that the camera and the script share a world space: **[measured]**
1216/1216 stage-1/2/4/5/6 spawn positions and 90–100 % of sampled camera eye
positions fall inside the bounding box of the matching `pol/` geometry.

---

## Practical summary

| Asset | Chosen by | Granularity |
|---|---|---|
| `pol/` models | event opcodes `0x50`–`0x53`, plus an untraced stage-init path | one model, or one whole file |
| `tex/` banks | event opcodes `0x54`–`0x57` | one bank |
| `evt/` table | scene id, at stage start | one file, whole |
| `cam/` paths | untraced | one path slot |
| enemy placement | event opcode `0x09`/`0x0B`/`0x0C` + descriptor | one object |
| stage routing | route table in `Hod2.exe`, not the file | one block |
