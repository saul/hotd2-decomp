# `evt/` event tables

**Status:** solved structurally. The relocation scheme, the container, the
routing graph and the bytecode are all recovered; 16,991 instructions across all
13 files decode with zero errors. What remains is *semantics* — most opcodes are
identified only by which global they touch.

Implemented in [`tools/hod2lib/evt.py`](../../tools/hod2lib/evt.py); checked by
`tools/verify_phase6.py`.

The files are raw Dreamcast RAM images. They are not serialised: they contain
absolute SH-4 pointers, and the PC port patches them at load.

## The fixup — solved

`FUN_00413120` at `0x00413120`, called on the whole buffer right after
`ReadFile`:

```c
void evt_relocate(u32 *p, int n_dwords) {
    for (; n_dwords; n_dwords--, p++)
        if ((*p & 0xFFF80000) == 0x0CE80000)
            *p += 0xF3AC1A00;            /* i.e. -= 0x0C53E600 */
}
```

That is the entire scheme. **Any dword in the 512 KB window
`0x0CE80000..0x0CEFFFFF` is a pointer; everything else is payload.** There is no
relocation table and no tagging — the format simply relies on no genuine
non-pointer ever landing in that window.

This is what the earlier analysis could not have guessed from the data: the
`0x0Cxxxxxx` heuristic in the old notes was far too wide. The exact mask cuts
the candidate set down to something that is **99.95 % dword-aligned** (6619 of
6622 across all files) — a coincidence rate that confirms the mask is right.

Two buffers receive event data at fixed PC addresses:

| Buffer | PC address | Dreamcast address |
|---|---|---|
| `comevtbl.bin` | `0x00977200` | `0x0CEB5800` |
| the current scene's table | `0x00977400` | `0x0CEB5A00` |

So a pointer maps to a file offset by subtracting the DC base of its buffer.
`comevtbl` gets 0x200 bytes immediately before the scene table, and scene tables
**do** point back into it (offsets as low as −460), which answers the old
question about whether the two link: they do.

### The "span problem" was an artefact

The old note recorded pointer spans of 4× and 160× the file size. Those were
computed over all `0x0Cxxxxxx`-looking dwords. Under the real mask every
in-range dword in every file resolves to a sane offset, and the walk closes.

## Loader

| Address | Role |
|---|---|
| `0x00413070` | loads `comevtbl.bin` into `0x00977200`, relocates, then loads the scene table |
| `0x00413160` | loads `evt\<scene table>` into `0x00977400`, relocates; early-outs if already loaded |
| `0x00413120` | the relocation pass |

Filenames come from the table at `0x004D1C7C`, indexed through a
scene → file-index table at `0x00579928`.

## Scenes

Everything is keyed by a small **scene id** in `DAT_009A1A08`:

| Scene | evt file | Blocks |
|---|---|---|
| 0 | `st1evtbl.bin` | 17 |
| 1 | `st2evtbl.bin` | 42 |
| 2 | `st3evtbl.bin` | 18 |
| 3 | `st4evtbl.bin` | 30 |
| 4 | `st5evtbl.bin` | 10 |
| 5 | `st6evtbl.bin` | 15 |
| 6 | `trnevtbl.bin` | 20 |
| 7 | — (inline stub inside `comevtbl`) | — |
| 8 | — | 1 |
| 9 | `endevtbl.bin` | 8 |
| 10 | `advevtbl.bin` | 1 |
| 11 | `adv2evtbl.bin` | 1 |

`st1evtbl - Copy.bin` is a stray duplicate and is not referenced.

## Container

Three levels of indirection, read by `FUN_0045EB60/70/90`:

```
comevtbl[scene]            -> block table for that scene   (FUN_0045EB60)
block_table[block]         -> step table                   (FUN_0045EB70)
step_table[step]           -> bytecode stream              (FUN_0045EB90)
```

The first 12 dwords of `comevtbl.bin` are the per-scene roots. For a scene with
its own file the entry is `0x0CEB5A00` — the start of the scene buffer — so the
scene table *begins* with its block-pointer array.

**`-1` in the root array is a hole, not a terminator.** A scene whose route
graph never visits block *i* stores `-1` there. Sizing the array by stopping at
the first `-1` loses blocks (17 → 15 for stage 1). Two independent ways to get
the real count, which agree on all 10 files:

- scan while entries are pointer-or-hole (what `hod2lib` does by default);
- read the length of the scene's route table out of `Hod2.exe`.

## Stage routing

`0x00597890` is a scene-indexed pointer to a **route table** — the flow graph
between blocks, and the mechanism behind the game's branching paths. Read by
`FUN_0045F000` when a block's step list runs out. Records are 8 bytes:

```
+0x00  s16 kind      0 = go to next[0]
                     1 = branch, take next[branch_choice]
                     2 = end of scene
+0x02  s16 next[0]
+0x04  s16 next[1]
+0x06  s16 next[2]
```

`branch_choice` is `DAT_009C88A4`, reset to 0 on every block change. Stage 2 has
42 route nodes with 15 branch points — comfortably the most branch-heavy stage,
which matches the game.

Exposed as `ExeTables.scene_routes(scene)`.

## Bytecode

`FUN_0045ECC0` is the interpreter:

```c
do {
    op = *pc;
    dispatch[op]();          /* 96 handlers at 0x005931D8 */
} while (!yield);
```

Everything is dword-granular: an instruction is one opcode dword followed by
operands. Each handler advances `pc` itself, so operand length is per-opcode.
The full table is transcribed in `evt.OPCODES`; the length classes are:

| Class | Encoding |
|---|---|
| `fix` | fixed number of dwords |
| `list` | `[op][arg …][-1]` |
| `var` | several `-1`-separated lists, whole run closed by `-2`; a global picks which list runs |
| `queue` | `[op][selector][args]`, length `2 + (selector >> 4)` dwords |
| `set` / `tween` | `[op][sub-op][…]`, length depends on the sub-opcode |
| `halt` / `next` | terminators |

Five dispatch slots (`0x00`, `0x2A`, `0x34`, `0x3C`, `0x4C`) point at an empty
stub. **No shipped file ever encodes one** — a useful integrity check, since a
mis-sized instruction would land on a stub or an out-of-range opcode almost
immediately. 76 distinct opcodes are actually used.

### Notable opcodes

| Op | Name | Notes |
|---|---|---|
| `0x09` | `spawn_placed` | list of pointers to spawn descriptors — the main enemy placement opcode |
| `0x0B`/`0x0C` | `spawn_obj` | same descriptor, different object base class |
| `0x20`/`0x24` | `view_set` | set a view channel immediately (sub-opcode picks the channel) |
| `0x21`/`0x25` | `view_tween_rate` | tween a channel at a given rate |
| `0x23`/`0x27` | `view_tween_time` | tween a channel over a given duration; the handler pre-divides to a per-frame step |
| `0x22`/`0x26` | `view_stop` | clear a channel's tween |
| `0x30` | `queue_event` | push a scripted action onto a 16-slot ring; `EvtRunQueuedActions` (`0x00402320`) dispatches it through a two-level table at `0x005776EC`. The selector's **high nibble is both the operand count and the group index** — see below |
| `0x40`–`0x47` | `wait_*` | the blocking opcodes; they set the yield flag and do not advance `pc` until their condition holds |
| `0x49`/`0x4A`/`0x4B` | `variant_*` | pick one of several operand lists by a global — difficulty or player count |
| `0x4D` | `checkpoint` | resets view state and records progress |
| `0x50`–`0x57` | `asset_*` | **asset load/unload.** Each pushes a job onto the 64-entry ring at `0x007DA220`; `0x50`/`0x51` take an asset *slot* id, `0x52`–`0x57` a pol/tex *file* index. See [`pipeline.md`](pipeline.md) |
| `0x4F` | `end_block` | hands control to the route table |

The `0x20`–`0x27` family targets one of two **view structs** (`DAT_009A3540`,
`DAT_009A59E0` — one per player) via a 0x24-dword tween block laid out as
`{enabled, from, to, rate}` per channel. Channels 5 and 9 are "all three axes at
once" forms of 2/3/4 and 6/7/8.

## `queue_event` — the scripted-action table, SOLVED

**[proved]** `EvtRunQueuedActions` copies an action's operands into the scratch
block at `0x009A6184` and fetches its handler from

```c
handler = table[selector >> 4][selector & 0xF];      /* table = 0x005776EC */
```

The high nibble is *both* the group index and the operand count — the groups
are organised by arity, which is why the instruction length is
`2 + (selector >> 4)` dwords. The index table has seven slots, four of them
null, and the sub-tables are laid out immediately **before** it:

| Group | Sub-table | Handlers | Selectors |
|---|---|---|---|
| 1 | `0x005776C4` | 6 | `0x10`–`0x15` |
| 2 | `0x005776DC` | 2 | `0x20`–`0x21` |
| 4 | `0x005776E4` | 1 | `0x40` |
| 6 | `0x005776E8` | 1 | `0x60` |

> ⚠️ **Correction.** An earlier revision of this document said the table "names
> 100+ scripted actions". It names **ten**. The estimate came from the size of
> the surrounding region, not from reading the table.

| Sel | Name | Effect |
|---|---|---|
| `0x10` | `set_player_flag` | `DAT_009A5EBC` bit 0 = op0, mirrored to `DAT_009A5D8C` |
| `0x11` | `scene_state` | `EvtEnterSceneState(current_major, op0)` — a transition in the 2-D state table at `0x00576C14` |
| `0x12` | `set_update_routine` | `DAT_009A5CE0 = PTR_FUN_00579E90[op0]` (two routines exist) |
| `0x13` | `set_continuation` | per-player continuation = `op0 ? LAB_00403290 : FUN_00420810`. **Defined but never used in shipped data** |
| `0x14` | `set_global` | `DAT_009C6F00 = op0` |
| `0x15` | `set_flag` | `DAT_009C6F33 = 1`; the operand is ignored |
| `0x20` | `hold_camera_preset` | op0 is a frame countdown; each frame copies 6 dwords from `0x00576CF0 + op1 * 0x18` into the player's camera block |
| `0x21` | `finish_sequence` | `EvtEnterSceneState(2, op0)`; sets `DAT_009A5900 \| 1` |
| `0x40` | **`cam_play`** | **plays a `cam/` path** — see below |
| `0x60` | `store_six` | copies six operands to `DAT_009C6FD8`… |

**[measured]** Across stages 1–6 the only selectors that occur are exactly
those ten, minus `0x13`:

```
0x10 x3   0x11 x4   0x12 x2   0x14 x2   0x15 x6
0x20 x1   0x21 x418   0x40 x751   0x60 x13
```

### `0x40` — this is the `evt` → `cam` link

```
queue_event 0x40, start_frame, end_frame, path_index, flags
```

`EvtActionCamPlay40` (`0x00403360`) → `CamStartPathPlayback` (`0x00403510`) →
`CamAdvancePathFrame` (`0x004035E0`), which each frame calls

```c
CamEvalPath7(g_active_cam_path, (float)frame, &eye, &lookat, &roll, &_);
```

and increments the frame counter until it passes `end_frame`.

| Operand | Meaning |
|---|---|
| 0 | start frame; **`-1` means resume from the current frame** rather than seek |
| 1 | end frame |
| 2 | **path index** — written to `g_active_cam_path` (`0x009A2D78`) |
| 3 | flags: bit 1 defer (stash into `DAT_009C70AC/B0` for a later `0x40`), bit 2 consume the stashed values |

When `start_frame == end_frame` the handler calls `CamEvalStaticPose` instead —
a held camera rather than a moving one.

#### The path index is global across every `cam/` file

`CamEvalPath7` indexes `DAT_0059C9F8 + path * 8` for the descriptor and
`DAT_004C479C[path]` for which loaded file it belongs to. `DAT_004C479C` is one
byte per global path, exactly as long as the total path count and with no
terminator.

**[measured]** 23 `cam/` files, 418 paths, and the table resolves to **23 file
ids with no id occurring twice** — one contiguous run per file, `cp_*` first
then `op_*`:

| Global range | File | Paths |
|---|---|---|
| 0–17 | `cp_demo` | 18 |
| 18–28 | `cp_demo2` | 11 |
| 29, 30, 31 | single-path files | 1 each |
| **32–54** | **`cp_st1`** | 23 |
| **55–120** | **`cp_st2`** | 66 |
| **121–162** | **`cp_st3`** | 42 |
| **163–202** | **`cp_st4`** | 40 |
| **203–216** | **`cp_st5`** | 14 |
| **217–232** | **`cp_st6`** | 16 |
| 233+ | `cp_end`, `cp_train`, … then every `op_*` | |

**[proved by measurement]** All **751 / 751** selector-`0x40` instructions in
stages 1–6 name a path inside their own stage's range. A wrong operand order
would scatter those indices across the whole 418-path space, so this is a
metric that collapses. `tools/verify_evt_cam.py`.

## The scene state machine — SOLVED

**[proved]** Selectors `0x11` and `0x21` both call `EvtEnterSceneState(major,
minor)` (`0x00403BD0`), which records the state and jumps straight into a cell
of a 6 × 9 table at `0x00576C14`:

```c
g_scene_state_minor = minor;
g_scene_state_major = major;
goto g_scene_state_table[major * 9 + minor];
```

The `* 9` is from the disassembly (`LEA ECX,[ECX+EAX*8]; ADD EAX,ECX`), not
from the decompiler. `0x21` always passes `major = 2`; `0x11` passes the
*current* major.

A cell does no work of its own — it **installs the hooks for that phase**:

| Global | Role |
|---|---|
| `g_camera_update_hook` (`0x009C7080`) | camera update, run every frame by `CameraUpdateTick` |
| `_DAT_009A5CDC` / `_DAT_009A5E0C` | per-player update (P1 / P2, 0x130 apart) |
| `_DAT_009A5CE0` / `_DAT_009A5E10` | per-player sub-routine — **also writable from script**, via `queue_event` selector `0x12` |

> **Unused cells point at `SceneStateInvalidHang` (`0x00402710`), which is
> `while(1);`.** An invalid transition deliberately locks the game up, so the
> live cells are an exact statement of which states exist — not a guess.

| major | live minors | what it installs |
|---|---|---|
| 0 | 0 | no camera hook |
| 1 | 1, 2, 3 | player-relative cameras |
| 2 | 4, 5, 6, 7 | `cam/` path cameras |
| 3 | *none* | every cell hangs — major 3 does not exist |
| 4 | 0–5 (no-op), 8 | |
| 5 | 0, 3, 4, 6, 7, 8 | |

### The camera modes

All of them write the same six globals — `g_camera_eye_x/y/z` and
`g_camera_pitch/yaw/roll_bams` (`0x009C71E0`…`0x009C71F4`):

| State | Routine | Behaviour |
|---|---|---|
| (0,0) | — | no camera hook |
| (1,1) | `CameraFollowPlayerMidpoint` | midpoint of the two players, or player `DAT_009C7000` alone when `DAT_009C8E80 == 1` |
| (1,2) | — | no camera hook; installs the player-B sub-routine |
| (1,3) | `CameraFromViewAngles` | pose built from the view struct: `RotateY(yaw-0x8000)`, `RotateX(-pitch)`, roll, then a `(0,-15,0)` translate |
| (2,4) | `CameraSnapToPathEye` | snap to the path eye, then re-install itself as `0x0040C470` |
| (2,5) | `CameraPathWithImpulseShake` | path pose plus a 30-frame decaying impulse, gated on `_DAT_009C9028 & 0x20000` |
| (2,6) | `CameraStepDeferredRailWithFrameExport` | plays the stashed path, publishing the current frame |
| (2,7) | `CameraPlayStashedPath` | same, `<` instead of `<=` on the end frame |

### How `0x40` and the state machine fit together

(2,6) and (2,7) call `CamEvalPath7(g_active_cam_path, frame, …)` themselves,
stepping `g_stashed_path_frame` toward `g_stashed_path_end_frame` — and those
are exactly the globals `EvtActionCamPlay40`'s `flags & 2` branch stashes. So a
deferred camera play is a two-instruction idiom:

```
queue_event 0x40, start, end, path, 2     ; stash the range
queue_event 0x21, 6 (or 7)                ; enter the state that plays it
```

**[measured]** All **208 / 208** deferred (`flags & 2`) camera plays in the
game are followed within three queued actions by a `0x21` to state 6 or 7.
Zero exceptions. Flags are only ever 0 (677 uses) or 2 (208).

### Two script opcodes fixed by this

Three camera hooks share this line:

```c
if (g_camera_use_fixed_y == 1) eye.y = g_camera_fixed_eye_y;
else                           eye.y = path.y - 15.0f;
```

`g_camera_fixed_eye_y` (`0x009C8E58`) is written by opcode **`0x1A`** and
`g_camera_use_fixed_y` (`0x009C70F4`) by opcode **`0x36`**. So `0x1A` sets a
fixed camera eye height and `0x36` selects it over the default
"path height minus 15".

### Validation

**[measured]** Every state transition in the shipped scripts lands on a live
cell. Selector `0x21`'s 444 operands across all stages are only 4, 6 and 7 —
inside row 2's live set `{4,5,6,7}`. Selector `0x11`'s are 1 and 3 — inside
row 1's `{1,2,3}`. A wrong row width would drop these onto the hang loop.

## Spawn descriptor

Header is 0x24 bytes, identical for opcodes `0x09`, `0x0B`, `0x0C`, `0x0D`
(`FUN_004088A0`, `FUN_00408A20`, `FUN_00408BC0`):

```
+0x00  u32  class index   selects the handler from the class table (below)
+0x04  u32  init flags    OR'd with 1 into object +0x34   (always 0 in shipped data)
+0x08  f32  position x    -> object +0x40
+0x0C  f32  position y    -> object +0x44
+0x10  f32  position z    -> object +0x48
+0x14  s32  orientation a -> object +0x64
+0x18  s32  orientation b -> object +0x68
+0x1C  s32  orientation c -> object +0x6C
+0x20  u16  (always 0)
+0x22  u16  hit points    -> object +0x11C *and* +0x11E
+0x24  ...  variable behaviour tail
```

The tail is class-specific: `0x0B`/`0x0C` store its address in the object
(+0x1390 / +0x130C) and leave interpretation to the class, while `0x09` reads
two bytes from it inline. `0x09` records are laid out contiguously at a **0x28**
stride in every shipped file, i.e. a two-byte tail.

Tails are **not** self-terminating and their length is **not** a function of the
class: the gap between consecutive descriptors of the same class varies (class
48, for instance, appears with 40, 44, 48, 52, 56 and 60 byte spacing). Tails
also contain further relocated pointers, so there is a second layer below them.
Sizing a tail requires the consuming class handler.

## Class table

Spawn objects are allocated by `FUN_004A6FA0(handler, size)`, which stores
*handler* at object +0x00 — a vtable-less virtual. The size is a literal at the
call site (`0x13F4` for `0x09`/`0x0B`, `0x1314` for `0x0C`); the **handler**
comes from a 112-entry table at `0x009A2280`, indexed by the descriptor's class
field.

`FUN_0040AC90` builds it: fill all 112 slots with the empty stub
`FUN_0041EBB0`, then apply a `{class_id, handler}` pair list terminated by a
negative id. The shipped list lives at `0x00593358` — immediately after the
opcode dispatch table — and has 56 entries:

| Class | Handler | Class | Handler | Class | Handler |
|---|---|---|---|---|---|
| 16 | `0x0048A3E0` | 38 | `0x0048E290` | 70 | `0x0042D9C0` |
| 17 | `0x0043A080` | 39 | `0x004329D0` | 71 | `0x0043BE60` |
| 18 | `0x0043F9D0` | 40 | `0x00432610` | 72 | `0x0042E0F0` |
| 19 | `0x0043FE10` | 41 | `0x00432C80` | 80 | `0x004997E0` |
| 20 | `0x00475E90` | 42 | `0x00432D40` | 81 | `0x00438540` |
| 21 | `0x00441750` | 43 | `0x00438060` | 82 | `0x0043F4C0` |
| 22 | `0x00442290` | 44 | `0x00432D50` | 83 | `0x00431250` |
| 23 | `0x004422D0` | 45 | `0x00426A70` | 84 | `0x00431780` |
| 24 | `0x0045CD60` | 48 | `0x00452DA0` | 85 | `0x00431C90` |
| 25 | `0x004917E0` | 49 | `0x00449620` | 86 | `0x00431BF0` |
| 26 | `0x00498FF0` | 50 | `0x0047F5F0` | 96 | `0x004342E0` |
| 27 | `0x00499420` | 51 | `0x00432FF0` | 97 | `0x00434EF0` |
| 32 | `0x00448ED0` | 64 | `0x0043BD30` | 98 | `0x00435930` |
| 33 | `0x00451720` | 65 | `0x00461CD0` | 99 | `0x00435F20` |
| 34 | `0x0049B0D0` | 66 | `0x0042F9B0` | 100 | `0x00435FB0` |
| 35 | `0x0048FD90` | 67 | `0x00445DB0` | 101 | `0x00436140` |
| 36 | `0x00482CE0` | 68 | `0x00472B10` | 102 | `0x00435A10` |
| 37 | `0x004840D0` | 69 | `0x0041FC00` | 108 | `0x00425010` |
| | | | | 109 | `0x00496BA0` |
| | | | | 110 | `0x00488820` |

**This is the route to the remaining 20 % of the bytes.** Each handler reads its
descriptor tail through object +0x1390 (`0x0B`) or +0x130C (`0x0C`), so the tail
layout is recoverable one class at a time. Ten classes account for most of the
data: 65 (347 descriptors), 48 (283), 37 (169), 68 (132).

**Confirmed:**

- Position is float and in level space. Sampled against the bounding box of the
  matching `pol/` geometry, **1216 of 1216** stage-1/2/4/5/6 spawns fall inside
  their own stage. That is the strongest available check that the offsets are
  right.
- `+0x22` is hit points: it is written to *both* a current and a maximum field,
  and takes values 0–18 across 1410 descriptors.
- `+0x18` is a BAMS yaw — its range covers ±65536 (`0x4000` = 90°), while the
  other two orientation words are almost always 0 with a small integer tail.

**Not confirmed:** the exact meaning of `+0x14` and `+0x1C`. They reach object
+0x64 and +0x6C, and are plausibly the other two Euler angles, but their value
distributions (mostly 0, otherwise 1–10) do not look like angles. Do not export
them as rotations without checking.

1410 descriptors are reachable; class ids fall in the bands 16–27, 32–51, 64–70,
80–86 and 109, with class 65 accounting for 347 of them.

## Coverage

79.4 % of `evt/` bytes are reached by walking root → blocks → steps → bytecode →
spawn descriptor headers. The uncovered 20.6 % (60,296 bytes) attributes as:

| Source | Bytes | Share of residue |
|---|---|---|
| `0x0B` `spawn_obj` behaviour tails | 43,178 | 71.6 % |
| `0x0C` `spawn_obj_c` behaviour tails | 11,464 | 19.0 % |
| `0x20`/`0x24` `view_set` float constants | 1,888 | 3.1 % |
| `0x23` `view_tween_time` float constants | 916 | 1.5 % |
| `0x0D`, `0x03`, `0x04`, `0x07`, `0x09`, `0x0A` descriptors | 1,522 | 2.5 % |
| `0x1A` `set_g_8e58` operands | 532 | 0.9 % |
| no pointer within 1 KB — unexplained | 796 | 1.3 % |

So **90.6 % of the residue is spawn behaviour tails**, and the class table above
is the way in. The float-constant pools are trivially markable; the 796
unexplained bytes are the only part with no identified owner.

### A trap worth knowing

A step-table entry that resolves *outside* the file is an external reference,
not a terminator. `st1evtbl.bin` block 0 hands control to a stream in the shared
`comevtbl` buffer, and stopping at it silently drops the four steps that follow
— 159 instructions and 9 spawn descriptors, about 7 % of that file. Only one
block in the corpus does this, which is exactly why it is easy to miss.

## Open questions

1. What loads a stage's geometry segments? The event script references only 2
   of stage 2's 18 `st2_*` files, so it is not the main path. See
   [`pipeline.md`](pipeline.md).
2. ~~What do the `queue_event` selectors mean?~~ **SOLVED** — there are ten
   handlers, not 100+, and they are tabulated above.
3. ~~Which opcode selects a `cam/` path slot?~~ **SOLVED** — `queue_event`
   selector `0x40`, operand 2, a global path index. 751/751 verified.
4. Semantics of the ~30 opcodes still named only by the global they write.
5. `+0x14` / `+0x1C` of the spawn descriptor.
6. What are the two "no file" scenes (7 and 8)? Scene 7 runs an inline stub
   inside `comevtbl` and is used as the fallback when a scene's route table
   ends (`FUN_0045F000` calls `EvtGetEntry(7, 0, 0)`).
