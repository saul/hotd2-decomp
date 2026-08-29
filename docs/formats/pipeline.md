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
