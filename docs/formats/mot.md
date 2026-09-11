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

## What the root translation is for

Each frame begins with three floats, and they are **one absolute track with two
consumers**. `SkeletonApplyRootMotion` (`FUN_00410C50`) is handed a pointer to
them and tests `model+0x64` bit 1 twice:

* **bit set** — the frame-to-frame delta, `root - model+0x1160`, is rotated by
  the actor's own `Rz Ry Rx`, scaled by `model+0x116C` and added to the
  object's position (`obj+0x40` and `obj+0x48`; also `obj+0x44` when bit `0x10`
  is set as well). The draw matrix then gets `MatrixTranslate(0, root.y, 0)` —
  the **height only**, because the horizontal part has already walked the
  object.
* **bit clear** — nothing moves, and the draw matrix gets
  `MatrixTranslate(root.x, root.y, root.z)`, the **whole** translation, as a
  pose offset inside `T(obj+0x40) R(obj+0x64..0x6C) S(model+0x116C)`.

So it is never both and never neither, and *neither half is relative to the
other*: the delta and the offset are two readings of the same absolute number.
`[proved]`, and from the bytes: Ghidra ends the gated arm at its
`MatrixStackPop(1)` and shows a `return`, while `0x00410E5F`–`0x00410E93` write
the baseline and fall into the shared tail that does the pose translate
(`L37`). `SkeletonPoseRootFrame` (`FUN_00410920`) emits no translate of its own
at all — it writes the frame's root to `model+0x6C..0x74`, hands the pointer
on, and then pushes bone 0's `RotZ; RotY; RotX`.

`model+0x1160..0x1168` is the baseline, and nothing lets it turn a clip's
**absolute** root into a step: `ActorSetMotion` (`FUN_00411930`) seeds it from
the new clip's frame 0 whenever the gate is set, `ActorSetMotionBlended`
(`FUN_004119A0`) leaves the `track+0x37` flag pair that makes the routine reset
it to the current root, and a loop wrap is *damped* —
`baseline = root + (root - baseline)/play_length` when the frame index has
jumped by more than a quarter of the clip — rather than taken.

Two things in the shipped game ever clear the bit, and everything else runs
with it set from `ActorBuildSkinnedModel`'s unconditional `model+0x64 = 3`:
`RescueTargetInit` (`FUN_00451720`) at spawn, and `CivilianRunScript`
(`FUN_0048B9E0`) on every clip change, from bit `0x00100000` of the wait word
that opened the block.

**It matters for far fewer clips than it sounds.** 992 of the 1058 blocks have
an *exactly zero* horizontal root on frame 0, so the two arms draw in the same
place for all but 64 of them. The largest are `komono_niwa.bin` 471 at 361.7
units and `komono_bridge.bin` 472 at 47.9; `zom.bin` 998, the one clip class
0x21 plays, is a **constant** `(0, 15.692, 11.943)` over all sixteen frames,
which means its delta is zero on every frame and only the pose arm can place
it. `tools/verify_root_pose.py` asserts all of this.

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

**And an effect's motion is not read at this stride at all.** The effect system
(`docs/formats/spawns.md`) has its own sampler:
`EffectFrameTranslations` (`FUN_0040E040`) and `EffectFrameRotations`
(`FUN_0040E070`) compute `(g_effect_bone_counts[effect] * 0x12 - 0xF) & ~3`,
which **truncates** rather than rounding up, and a frame is `n-1` translations
of three floats followed by `n-1` rotations of three BAMS shorts — three
*floats* per bone where a character has none, because an effect's node tree
carries no bind offsets and its translations come per frame. `mot.py` and
`mot.ts` both expose it as `effect_frame_stride` / `effectFrameStride`, and
`tools/verify_effects.py` holds all 13 `(effect, motion)` pairs against it.
Reading one of those blocks at the character stride is a third of a frame out
per frame, and it decodes without complaint.

### The four bytes the engine skips

The `+ 4` in the sampler steps over a `u32` the loader never reads. It is the
**frame count**: for every one of the 1058 blocks in the game it equals
`(next_block - this_block - 4) / stride` exactly. The file states its own
length; the engine simply does not need it, because the scripts drive playback
from `g_motion_play_length` instead.

`g_motion_play_length[motion_id]` (`0x004E07D0`, `s16` per id) is what the
scripts compare against, and **every cue expressed in clip frames is in its
units, not in `frames`**: `ZombieStateTargetMotionScript`'s kill frame,
`ZombieStateMotionCue21`'s exit, class 0x24's `0x32` drift cue, the class-0x25
VM's `-1` for "the last frame".

It runs at about **twice** the frame count, which fits an animation clock
ticking once per 60 Hz frame over data authored at 30 Hz. Measured across the
220 motions the shipped bundles bake it is `2n - 2` for 91 of them and
`2n - 3` for the other 129, and never anything else — `[open]` which of the two
a given motion gets. Because there is no rule, the bundle **carries the exe's
value** rather than deriving one: `BakedMotion.play`.

`FUN_004111A0`, the sampler, says exactly how the clock is used and settles the
"odd values interpolated" guess:

```c
model[2] = model[0] % (g_motion_play_length[model[8]] + 1);   /* the cursor */
model[6] = model[2] / 2;                                      /* the frame  */
```

* `model[0]` (`obj+0x194`) is the **tick**, incremented by the owning class;
* `model[2]` (`obj+0x19C`) is the **play cursor**, and it *wraps* at
  `play_length + 1`, so it takes every value from 0 to the play length
  inclusive and then returns to zero;
* `model[6]` is the authored frame, the cursor halved — and an odd cursor
  blends the two neighbouring frames on tracks 1 and 2, which is the
  interpolation.

Two consequences the port depends on. A class holds a clip on its last frame by
simply **not incrementing `model[0]`** — there is no "stop" flag. And a cue
compared for equality against the cursor comes round once per play-through
rather than being true for ever, which is what makes a loop count cost one
play: `CivilianUpdate` spends one only on the single frame where
`model[2] == play_length`.

Reading a cue against the authored frame count instead loses every cue past
halfway, silently. That is what left the civilians alive under their captors:
stage 1's four maul cues are 24, 30, 62 and 64 against clips of 41, 26, 43 and
46 frames, so only the 24 ever fired.

### And a clip nothing names is a clip nothing carries

`g_motion_play_length` is a table of 1058 entries; a bundle carries a few
hundred. The exporter bakes only what something it has **read** names — there
is no fallback, for the reason `charmotion`'s module docstring gives — so the
bake set is an inventory of routines that have been read, and a routine nobody
read is a clip nobody carries.

The port's answer for a clip that is not there is `MotionPlayFrame` returning
**0**, and what that does depends on the shape of the wait the state is on:

| the state's exit | with no clip | what it looks like |
|---|---|---|
| `cursor >= play_length - 1` | true on the **first** frame, because `play_length` is 0 too | a state that ends instantly. A condition-4 crawler with no `0x404` snapped straight to a corpse. |
| `cursor >= <a literal>` | **never** true | an actor parked for the rest of the stage |

The second is a hang and reads as a transcription bug rather than as a missing
asset, which is why it has cost this project a session twice. Class 0x30's
state 12 is `if (obj+0x19C < 0x3C) return;` against
`g_motion_play_length[0x3F9]`, which is **85** — and `0x3F9` was baked for no
character type in any of the twelve bundles, so nothing in the port could
leave state 12 anywhere in the game and every actor that entered it held
`g_enemies_present` for ever. `PLAYER_HANGS.md` 22.

Three checks stand where the reading used to: `verify_scripted_clips.py` for
what a class-0x25 program and a class-0x20 descriptor name,
`verify_death_clips.py` for what `ChooseDeathMotion` names, and
`tools/entrances.mjs` for whether the twelve entrance states end. The first
asks the exporter and the second reads a real bundle, deliberately: the
TypeScript half is the only writer of a bundle, and asking the Python half
would go green on a fix that reached no byte the player loads (`L24`).

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

`tools/verify_root_pose.py` checks what the root translation is *for* — the
two arms of `model+0x64` bit 1, quoted as bytes at their addresses because the
decompiler shows neither whole, and then the population: every block measured
for an absolute horizontal root, and every clip the class-0x10 scripts can play
with the gate clear enumerated against it. It is the only place the set of
actors a clip root can reposition is written down as a fact rather than a
guess.

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
