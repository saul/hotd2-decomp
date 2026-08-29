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
| `0x30` | `queue_event` | push a scripted action onto a 16-slot ring; `FUN_00402320` dispatches it through a two-level table at `0x005776EC`. The selector's **high nibble is the operand count** |
| `0x40`–`0x47` | `wait_*` | the blocking opcodes; they set the yield flag and do not advance `pc` until their condition holds |
| `0x49`/`0x4A`/`0x4B` | `variant_*` | pick one of several operand lists by a global — difficulty or player count |
| `0x4D` | `checkpoint` | resets view state and records progress |
| `0x4F` | `end_block` | hands control to the route table |

The `0x20`–`0x27` family targets one of two **view structs** (`DAT_009A3540`,
`DAT_009A59E0` — one per player) via a 0x24-dword tween block laid out as
`{enabled, from, to, rate}` per channel. Channels 5 and 9 are "all three axes at
once" forms of 2/3/4 and 6/7/8.

## Spawn descriptor

Header is 0x24 bytes, identical for opcodes `0x09`, `0x0B`, `0x0C`, `0x0D`
(`FUN_004088A0`, `FUN_00408A20`, `FUN_00408BC0`):

```
+0x00  u32  class index   selects the object size from DAT_009A2280
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

78.8 % of `evt/` bytes are reached by walking root → blocks → steps → bytecode
→ `0x09`-family descriptors. The remainder is operand data behind opcodes whose
targets are not yet followed — chiefly the behaviour tails of `0x0B`/`0x0C`
descriptors and the float constants that the tween opcodes point at.

## Open questions

1. What do the `queue_event` selectors mean? The two-level table at
   `0x005776EC` names 100+ scripted actions; decoding it would give the
   cutscene vocabulary.
2. Which opcode selects a `cam/` path slot? See `cam.md`.
3. Semantics of the ~40 opcodes currently named only by the global they write.
4. `+0x14` / `+0x1C` of the spawn descriptor.
5. What are the two "no file" scenes (7 and 8)? Scene 7 runs an inline stub
   inside `comevtbl` and is used as the fallback when a scene's route table
   ends (`FUN_0045F000` calls `EvtGetEntry(7, 0, 0)`).
