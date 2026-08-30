# `mot/` — skeletal animation

**SOLVED.** Read out of the loader and the sampler, then checked against every
shipped bank: 1058 of 1058 motion blocks are consistent.

## Where a pose actually comes from

The important structural fact, because it is the opposite of what an earlier
revision of `spawns.md` claimed:

* **The skeleton is in the EXE.** `PTR_DAT_004E0430[char_type]` gives a node
  tree whose nodes carry a **bone offset** (`+0x04..+0x0C`, floats), an asset
  slot and a bone index. See [`spawns.md`](spawns.md).
* **`mot/` carries only rotations**, plus one root translation per frame.

So a character assembles from the EXE alone. It will not *look* right — every
bone offset runs along its own local X and the rest orientation comes from the
animation — but the hierarchy, the parts and the proportions are all there
without opening a single motion file.

## Loading

`MotionRequestBankLoad` (`0x0041D860`) enqueues **asset job kind 8** for a bank
id. The job's three sub-steps are at `0x00579914`:

| Sub-step | Function | What it does |
|---|---|---|
| 0 | `MotionJobOpenFile` (`0x00412C10`) | `wsprintfA(path, "mot\%s", g_asset_bank_names[bank])`, `CreateFileA`, `GetFileSize`, allocate `size + 0x20`, round the buffer up to a 32-byte boundary |
| 1 | `MotionJobReadFile` (`0x00412D40`) | one `ReadFile` of the whole file |
| 2 | `MotionJobBindOffsets` (`0x00412D90`) | the entire parse (below) |

There is **no decompression** — unlike `pol/`, a `mot/` file is raw on disk.
The three entries after the sub-step pointers are the format string itself,
which is why `0x00579914` looks like a 7-entry table and is really a 3-entry
one followed by `"mot\%s"`.

## File format

`MotionJobBindOffsets` is short enough to give in full:

```c
p = buf;
for each motion id m in g_motion_bank_ids[bank]:   /* count from g_motion_bank_count */
    g_motion_slots[m].base  = *p++ + buf;
    g_motion_slots[m].state = 2;
```

That is the whole header: **one `int32` offset per motion in the bank**, in the
bank's own id order, each relative to the file start. Nothing else is parsed —
the engine never reads a magic, a version or a count, because the count comes
from the EXE.

```
mot/<bank>.bin
  +0x00   s32 offset[n]        n = g_motion_bank_count[bank]
  ...
  at offset[i]:
    +0x00 u32 frame_count      the engine SKIPS this; see below
    +0x04 frame[0], frame[1], ...
```

### The frame record

`MotionFrameAddress` (`0x00412F50`) is the sampler:

```c
return ((g_character_bone_counts[char_type] * 6 + 15) & ~3) * frame
       + 4 + g_motion_slots[motion_id].base;
```

so the stride is `(bones * 6 + 15) & ~3` and frames begin 4 bytes in.
`SkeletonBuildAndPose` reads the record as three floats then a `short *` at
`+0x0C`, and `SkeletonWalkNode` takes bone *i*'s triple at `+0x0C + i*6`:

```
+0x00  f32 root translation x
+0x04  f32 root translation y
+0x08  f32 root translation z
+0x0C  s16 bone[0].rx, .ry, .rz      <- applied at the object root
+0x12  s16 bone[1].rx, .ry, .rz      <- bone index from the skeleton node
...
padded to a multiple of 4
```

Rotations are BAMS and are applied `RotZ; RotY; RotX`, the same order as every
other transform in this engine. Bone 0 is the object root; skeleton nodes carry
1-based indices, which is why `g_character_bone_counts` is one more than the
highest index in the tree.

**The stride is a property of the character, not the file.** The same bytes
read against a different skeleton would be read at a different stride, so a
motion is only meaningful with the character it was authored for — and
`g_motion_bank_of` is what ties a motion id to its bank, not to a character.

### The four bytes the engine skips

The `+ 4` in the sampler steps over a `u32` the loader never reads. It is the
**frame count**: for every one of the 1058 blocks in the game it equals
`(next_block - this_block - 4) / stride` exactly. The file states its own
length; the engine simply does not need it, because the scripts drive playback
from `g_motion_play_length` instead.

`[open]`: `g_motion_play_length[motion_id]` (`0x004E07D0`) is what the scripts
compare against — the class-0x25 VM uses `-1` to mean "last frame of the
motion" — and it runs at roughly **twice** the frame count: 25 frames against
48, 41 against 79, 51 against 99. That fits an animation clock ticking once per
60 Hz frame over data authored at 30 Hz with the odd values interpolated, but
it is not exactly `2n - 2` for every motion and has not been pinned down.

## Banks

47 named banks hold 967 motion ids; `verify_mot.py` walks 49 (two hold props
whose bone counts are not in the character table).

`g_asset_bank_names` is **shared with the camera-path filenames**, so an entry
is a motion bank only when it also has an id list in `g_motion_bank_ids`. That
is what separates `people.bin` from `cp_st1.bin`, and skipping the check makes
a scan pick up nine camera files.

A sample, with the characters they serve:

| Bank | Motions | For |
|---|---|---|
| `people.bin` | 200 | the `hito_*` civilians, 16 bones |
| `szom.bin` | 46 | zombies, 16 bones |
| `lsr.bin` | 50 | |
| `boss1`–`boss6.bin` | 21–42 each | the bosses |
| `player.bin`, `player1`–`player6.bin` | 4–41 each | |
| **`nya.bin`** | 12 | **`cat.bin`**, 19 bones — *nya* is a cat's meow |
| `frog.bin` | 9 | `frog.bin`, 15 bones |
| `bat.bin` | 2 | `zabat.bin`, 2 bones |
| `komono*.bin` | 1–8 each | animated props, bone counts outside the character table |

## Verification

`tools/verify_mot.py` checks every bank. It deliberately does **not** assume a
bank belongs to a known character: it tests the format's own arithmetic, that
the block size divided by the declared frame count is a stride the formula
`(n*6+15) & ~3` can actually produce. A wrong stride would almost never divide
exactly, so this is a real test rather than a restatement.

```
49 banks, 1058 motions, 1058 blocks
blocks whose declared frame count matches the block size at a real stride: 1058/1058
bone counts implied by the files: 1..430 (25 distinct)
clean
```

## Tools

* `ExeTables.character_skeleton(type)` — the node tree, parents resolved.
* `ExeTables.character_bone_count(type)`, `motion_banks()`, `motion_bank_of(id)`.
* `hod2lib.mot.load_bank()` / `MotionBank.frames(id, bone_count)`.
* `tools/export_character.py <type> [--motion N --frame F]` — assembles a
  character and writes it as a posed glTF hierarchy, reusing the rig writer
  because a skeleton *is* a rig: a tree of named parts each with a translation,
  a BAMS triple and an asset slot.

`python3 tools/export_character.py 0x1A --motion 762` produces a cat, mid-stride.
