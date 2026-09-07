# Class 0x10's civilian scripts

Every civilian in the game is a **program**, and the program is compiled into
`Hod2.exe` rather than authored in the stage's evt. That makes this the only
gameplay "format" in the project that lives entirely in `.rodata`.

`CivilianInit` (`FUN_0048A3E0`) reads a byte at the spawn tail's `+0x01` and
indexes `g_civilian_scripts` (`0x005702A8`) with it. The 67 pointers there run
into `0x0056B980 .. 0x005702A8`; four of the opcodes carry pointers to further
streams, which live in the gaps between the table's own entries. Following
them all gives **136 streams and 1,967 commands**, and 17,684 of the region's
18,728 bytes are command; the rest is the operand data those commands point
at.

`tools/verify_civilian_scripts.py` is the check. A command is a dword and its
length is per-opcode, so one wrong length desynchronises the stream and the
next opcode is a pointer or a float — out of range at once. It also asserts
that every stream ends in exactly one `0x2D`, that no byte is claimed by two
different commands, and that the region is mostly command.

## The command stream

```
cmd+0x00  s32  opcode
cmd+0x04  s32  operand 0
cmd+0x08  s32  operand 1     (only for the three- and four-word opcodes)
```

Lengths, in dwords, from `CivilianRunScript`'s own switch. Everything not
listed is **two**, which is that switch's fall-through `piVar8 = param_2 + 2`:

| Length | Opcodes |
|---|---|
| 3 | `0x00` `0x05` `0x0D` `0x13` `0x16` `0x1A` `0x1F` `0x21` `0x24` `0x25` `0x26` |
| 4 | `0x01` |
| 6 | `0x2B` |
| 1 | `0x2D` (the terminator carries nothing) |
| — | `0x10`: **the installed hook decides**, see below |

## Blocks, and what a wait word means

A stream is a run of **blocks**, each led by a `Wait` (`0x2C`) and followed by
its actions.

* `CivilianRunScript` (`FUN_0048B9E0`) executes opcodes `0x00..0x2C` and stops
  before the first opcode above `0x2B`, parking the cursor at `sub+0x48`.
* `CivilianStepScript` (`FUN_0048B1E0`) runs once a frame and decides whether
  the parked wait is over. When it is, `CivilianUpdate` re-enters the VM at the
  cursor.

**The wait word leads its block and governs the wait that follows it.** That is
why every shipped stream opens with a `0x2C`: the VM runs its first command
whatever it is, so the opening wait loads a word, the block runs, and the actor
then waits on that word.

Every bit of the word is a **reason to keep waiting** — which makes
`CivilianStepScript`'s conjunction read inverted. It returns 0 while the
reasons hold.

| Bit | Waits until |
|---|---|
| `0x00000001` | `g_enemies_present` has fallen to `sub+0x22` |
| `0x00000002` | `g_enemies_alive` has fallen to `sub+0x22` |
| `0x00000004` | fewer than `sub+0x20` of this civilian's children are alive |
| `0x00000008` | `g_civilians_alive` has fallen to `sub+0x24` |
| `0x00000010` | the actor is within `sub+0x3C` of its target, in 2D |
| `0x00000020` | the actor's heading error to the target rounds to zero |
| `0x00000040` | the target is in front — local `z` above zero |
| `0x00000080` | camera path `sub+0x10` reaches frame `sub+0x12` |
| `0x00000100` | the clip's remaining loop count reaches zero |
| `0x00000200` | the clip frame equals `sub+0x16` |
| `0x00000400` | the installed frame hook raises `sub+0x18` |
| `0x00000800` | **never** — this bit makes the conjunction fail outright |
| `0x00001000` | the camera's eased look-at has caught up |
| `0x00002000` | `g_script_flags[sub+0x1A]` is raised |
| `0x40000000` | two players are in play |

and the high bits, which are not waits at all:

| Bit | Meaning | of 596 |
|---|---|---:|
| `0x00008000` | `CivilianApplyMotionPose`: with `0x10000` it enters the bone-direction turn; on its own it selects the counter-rotation arm. Not ported. `[open]` | 28 |
| `0x00010000` | `CivilianApplyMotionPose`: without `0x8000`, write the frame's rotation into `model+0x7C/0x80/0x84`. Not ported. `[open]` | 4 |
| `0x00020000` | `CivilianApplyMotionPose`: **the other translation** — place the actor from the frame's root plus the pol file's root-bone offset, both scaled by `model+0x116C`. Not ported. `[open]` | 16 |
| `0x00080000` | leave `g_civilians_alive` now rather than on removal | 125 |
| `0x00100000` | **this block's clip carries her** — the root-motion gate, below | 289 |
| `0x00200000` | `CivilianApplyMotionPose`: skip the whole rotation arm. `[open]` | 75 |
| `0x02000000` | may be removed when off camera | 90 |
| `0x08000000` | uncounted: no `g_civilians_alive`, and worth no score | 9 |
| `0x10000000` | **rescued** — pay 400 and clear the bit | 37 |

`0x04000000` is masked off as the word is loaded (`operand & 0xFBFFFFFF`).
`0x00040000` (315), `0x00800000` (11), `0x01000000` (25), `0x04000000` (21)
and `0x20000000` (3) also appear in the shipped words. `0x00040000` is the
**camera-track** bit and it is written *inverted*: op 0x2C does
`if ((word & 0x40000) == 0) obj+0x34 |= 0x10000; else obj+0x34 &= ~0x10000`,
and `obj+0x34` bit `0x10000` is *excluded from `RegisterForCameraTracking`* —
so the wait bit set means tracked. `0x01000000` is the world push and
`0x20000000` gates op 0x1D's dialogue on `DAT_009A2230`. The counts are of the
596 `Wait` commands in the 136 shipped streams.

### The root-motion gate — `0x00100000`

**The engine's civilians are carried by their clips, through the same routine
everyone else's are.** `SkeletonApplyRootMotion` (`FUN_00410C50`) tests one
thing before it touches a position — `if ((*(byte *)(model + 100) & 2) != 0)`
— and `model + 100` is `model+0x64`, which is `obj+0x1F8`.
`ActorBuildSkinnedModel` (`FUN_00410440`) writes
`MOV dword ptr [ESI + 0x64], 0x3` at `0x004104C5`, unconditionally, so every
skeletal actor in the game is *built* with it on. `[proved]`

Class 0x10 is the only class that changes it afterwards, and it does so from
the wait word, on every clip **change** — ops 0x00 and 0x01 of
`CivilianRunScript` (`FUN_0048B9E0`):

```c
if (*(int *)(g_cur_actor_model + 0x20) != param_2[1]) {   // a different clip
  *(int *)(g_cur_actor_model + 0x20) = param_2[1];
  if ((*g_cur_civilian & 0x100000) == 0)
    uVar7 = *(uint *)(g_cur_actor_model + 100) & 0xfffffffd;   // clear
  else
    uVar7 = *(uint *)(g_cur_actor_model + 100) | 2;            // set
  *(uint *)(g_cur_actor_model + 100) = uVar7;
  CivilianApplyMotionPose(param_1, uVar3, ...);
}
```

`*g_cur_civilian` is the wait word that opened the block, so the answer to
*"does this civilian walk or does she animate in place"* is per block and it is
in the script. **289 of the 596 shipped wait commands set the bit and 297 do
not.** `[proved]`

The same bit decides the *draw* at the end of that routine: with it set the
clip's horizontal root translation has already moved the object, so the pose is
placed with `MatrixTranslate(0, root.y, 0)` instead of the full root. The
translation either moves the object or moves the pose, never both.

`CivilianReapplyWaitCommand` (`FUN_0048B760`) deliberately does **not** write
either `model+0x20` or `model+0x64`, so a skipped block leaves the gate where
the last real clip change put it.

**The delta is scaled by `model+0x116C`**, which `SkeletonApplyRootMotion` runs
`MatrixScale` with. `ActorBuildSkinnedModel` sets it from the character type
alone — 0.6 for type 30, 0.7 for 31, 0.9 for 32..56, 1.0 otherwise — and
**op 0x27 is the only command in the class that changes it**, storing its
operand verbatim into that float field. One command in the whole game runs it,
with `0x42480000` = 50.0.

Two consequences worth knowing, both the engine's:

* **A block whose own wait is already satisfied is skipped.** Once the parked
  wait clears, the step loop loads the *cursor's* word and tests that too; if
  it passes as well the loop advances again and the block it walked past never
  runs its actions. `CivilianReapplyWaitCommand` (`FUN_0048B760`) is what makes
  that safe: a second, smaller VM that re-applies only the opcodes a wait
  condition reads — the clip and its loop count, the target, the timer, the
  three count goals, the camera cue, the frame hook and the flag index.
* **`SetTimer` (op 0x09) does not delay its own block.** The step loop clears
  the timer on every resume, so the value that survives is the one the reapply
  walk reads out of the block *ahead*. A timer of `n` costs `n + 1` frames,
  because the test reads the value before the decrement.

## The opcodes

| Op | Name | Operands |
|---|---|---|
| `0x00` | `SetMotion` | motion, loops (negative loops for ever) |
| `0x01` | `SetMotionFrom` | motion, loops, starting frame |
| `0x02` | `SetFrameLimit` | stop the clip on this frame |
| `0x03` | `SetTurnRate` | BAMS per frame; the Init's default is 10 |
| `0x04` | `SetMotionFrame` | the frame wait bit `0x200` looks for |
| `0x05` | `SetTarget` | point pointer or mode, arrival radius |
| `0x06` | `SetTargetPoint` | point pointer, always dereferenced |
| `0x07` | `SetTargetHeading` | BAMS; the point is 100 units along it |
| `0x08` | `SetYaw` | |
| `0x09` | `SetTimer` | frames |
| `0x0A` | `SetEnemiesGoal` | |
| `0x0B` | `SetChildrenGoal` | |
| `0x0C` | `SetCiviliansGoal` | |
| `0x0D` | `SetCameraCue` | path, frame |
| `0x0E` | `SetOnShot` | **script pointer; zero means unshootable** |
| `0x0F` | `SetOnShotKilled` | script pointer |
| `0x10` | `SetHook` | native routine — see below |
| `0x11` | `SetSkipCount` | wait commands to skip on the next resume |
| `0x12` | `SetRemoveDelay` | frames |
| `0x13` | `AddHeldItem` | item record, value |
| `0x14` | `AddPickedItem` | value |
| `0x15` | `PickHeldItem` | weighted table |
| `0x16` | `SetRadiusRamp` | target radius, frames |
| `0x17` | `SetCameraPointMode` | which point the shot test registers |
| `0x18` | `SetPose` | pointer to six floats |
| `0x19` | `SetRouteBranch` | **[proved]** `g_script_branch_var = (s16)cmd[1]` — the selector `EvtAdvanceStepOrRoute` indexes a route record's `next[]` with, so **this is how the game decides which way a branching stage goes**. Eleven streams run it, all eleven pass 1, and all eleven put it after the `SetOnShot 0` that makes the civilian safe. See [evt.md](evt.md#how-a-branch-is-decided) |
| `0x1A` | `SetChildCue` | applied only while children survive |
| `0x1B` | `SetGlobalB` | `DAT_009CA0F4`. `[open]` |
| `0x1C` | `SetScriptFlag` | **[proved]** `g_script_flags[cmd[1]] = 1` (`0x0048BF2A`) — the *same* 0x100-byte array at `0x009C7200` that the evt's `set_script_flag` (0x48) writes and `wait_script_flag` (0x45) reads. **This is how a hostage tells the stage script she is done**, and it is the only way most of them can: across the six shipped scripts every `wait_script_flag` gate but two names a flag no `set_script_flag` in that stage ever raises. Twenty-eight commands in the 136 streams, on flags 0..7, 18, 29, 30, 35, 36, 53 and 54. See *The rescue* below |
| `0x1D` | `PlayDialogue` | group — `EvtOpPlayDialogue2D` |
| `0x1E` | `SetResume` | script pointer |
| `0x1F` | `SetResumeByMode` | two script pointers |
| `0x20` | `SetFlagIndex` | |
| `0x21` | `QueueSound` | id, delay |
| `0x22` | `QueueSoundList` | pointer to `(id, delay)` pairs, `0xFFFFFFFF`-terminated |
| `0x23` | `SetAttachMode` | `[open]` |
| `0x24` | `SetAttachTarget` | `[open]` |
| `0x25` | `SetPairA` | `[open]` |
| `0x26` | `MoveOverFrames` | point (or `< 1` for the camera), frames |
| `0x27` | `SetScale` | `model+0x116C` |
| `0x28` | `SetCameraBone` | |
| `0x29` | `SetActorFlags` | OR'd into `obj+0x34` |
| `0x2A` | `SetDeathVoice` | or `0xFF` to pick by character type |
| `0x2B` | `InPlayOnly` | taken only while `g_app_state == 6`, which is **in play** — so this is the ordinary path, not a debug one. Writes `cmd+4` (s16) to the script context's `+0xBC` and `&cmd[8]` to its `+0xC0`; what those are is `[open]` |
| `0x2C` | `Wait` | the wait word |
| `0x2D` | `End` | |

### Op 0x10's length

`CivilianRunScript` calls the hook as `next = hook(obj, cmd + 2)` and takes the
pointer it returns, so **the hook decides how many dwords the command has**.
Four appear in the shipped scripts:

| Hook | Dwords | What it does |
|---|---|---|
| `0` | 2 | uninstall (`NoOpStub`) |
| `0x0048D9F0` | 2 | zero the y velocity and start falling at `-0.02722` |
| `0x0048DA90` | 2 | ride the surviving children |
| `0x0048DB90` | 3 | take a launch y speed, raise `obj+0x34` bit `0x80000`, then fall |
| `0x0048DBD0` | 5 | take a whole launch velocity, then fall |

The fall step (`0x0048DA20`) accelerates, moves, and stops the frame
`QueryGroundHeightAt(x, y + 100, z)` is at or above the new height — snapping
to it, raising `sub+0x18` (which wait bit `0x400` waits for) and uninstalling
itself.

## What the civilian looks like

`CivilianInit` writes `model+0x20 = 0x294` — motion **660**, from
`people.bin` — before it runs a line of script, and op 0x00 takes over from
there. That literal is the class's `MOTION_RULES` entry: without it the 47
civilians resolved to a character with no motion and the client drew none of
them. The bake list is the transitive closure of the entry stream's ops 0x00
and 0x01, following ops 0x0E/0x0F/0x1E/0x1F, because a civilian that is shot
spends the rest of its life in another stream.

The skins are what the class is: `hito_gal`, `hito_galjk` (a schoolgirl),
`hito_man`, `hito_baba` and `hito_babann` (an old woman), `hito_oyaji`,
`hito_oyajiaa` and `hito_oyajisagyo` (old men, one in work clothes),
`deka_musume`, `hitoc`, `char_adv0*` and `player_gold`.

### The face and the hair are not in the skeleton

**A civilian's head model is a shell that is open at the back.** `hito_gal`'s
bone 2 is slot `0x0EAF`, 149 vertices spanning `z 0.18..1.38`, and **four** of
those 149 vertex normals point backwards (`n.z < -0.5`) against 89 pointing
forwards. Every zombie head in the game has fifteen to forty. Rendered on its
own it is a face bowl on a neck, and that is exactly what the port drew until
the attachment list below was ported. `[proved]`

What closes it is `model+0x1170`, the **attachment list**. `CivilianInit`
parks the spawn tail's `+0x08` pointer there and calls `ActorBindPartList`
(`FUN_00412440`); `SkeletonDrawWalk` then runs `ActorDrawAttachedParts`
(`FUN_004124F0`) through the hook at `model+0x1174` after every skeleton node.
The list is an `s16[]` of ids terminated by a negative, and the id indexes
`g_actor_attachment_table` (`0x004EC748`) — 81 pointers into
`g_actor_attachment_records` (`0x004EC4C0`), each `{s32 bone; s32 asset_slot}`.
The count is arithmetic, not a scan: the record array runs
`0x004EC4C0..0x004EC748` at eight bytes each and the pointer table begins where
it ends.

**The ids split at `0x24` and the two halves do opposite things.** `[proved]`

| Ids | Files | What happens |
|---|---|---|
| `0x00`–`0x23` | `hito_kao_*`, `etc_*_kao` | `ActorBindPartList` writes the record's slot **over** `bone_records[bone].slot`. All 36 are bone 2. *Kao* (顔) is **face**: `hito_kao_gal.bin` alone holds 60 heads of the same 149 vertices and 234 triangles as `hito_gal`'s own, differing only in texture — three skins × twenty mouth positions. The skeleton's head is the default, not the character. |
| `0x24`–`0x50` | `etc_komono_*` | `ActorDrawAttachedParts` draws the record's slot **as well**, in the matrix of the record's bone. *Komono* (小物) is **small item**: hair and hats on bone 2, bags and aprons on bone 1, shoes on bones 12 and 15. |

`ActorDrawAttachedParts` also scales bone 2 by `1.5, 1.0, 1.5` and bones 5, 8,
12 and 15 by `2.0, 1.0, 2.0` while `g_GameMode == 1` (Original Mode) and
`DAT_009C88AC` is set. What that byte is is `[open]`, and the scale is not
ported.

**The list is not class 0x10's.** `ActorBindPartList` has six callers and the
tail offset is polymorphic (L3):

| Class | Init | Offset | Spawns with a list |
|---|---|---|---|
| `0x10` | `CivilianInit` (`FUN_0048A3E0`) | `tail+0x08` | 52 of 65 |
| `0x25` | `ScriptedHumanoidInit` (`FUN_004840D0`) | `tail+0x08` | 5 of 169 |
| `0x24` | `SetPiecePropInit` (`FUN_00482CE0`) | `tail+0x00` | 40 of 67 |

`FUN_004613C0`, `FUN_004617F0` and `FUN_0049A760` are the other three callers
and are unread, so their classes and offsets are `[open]`.

Reading the wrong offset for a class would not fail loudly — the bytes are some
other field and the ids that come out are small numbers. What says these three
are right is that **every one of the 97 lists names its own character's
family**, with no exceptions: type `0x2E` (`hito_man`) takes `etc_komono_man`,
`0x31` (`hito_mario`) takes `etc_komono_mario`, `0x22` (`hito_babann`) takes
`etc_komono_baba`, `0x26` (`hito_gal`) takes `hito_kao_gal` and
`etc_komono_gal`, `0x36` takes `etc_oyaji_kao`. `[proved]`

`ActorReleasePartList` (`FUN_004124B0`) is the undo, and it releases the loads
only — the overwritten bone slots are not put back, because the object is
being torn down.

### The waist and the skirt are not in the skeleton either

Beside the attachment list there is a second set of parts the skeleton does not
name: `g_pCharacterExtraParts` (`0x0052ED08`), one or two per character type,
built by `BuildCharacterPart` (`FUN_00419520`) and drawn by
`DrawCharacterPart` (`FUN_0041A300`) through `g_character_part_drawers`
(`0x004EDAEC`). **45 of the 54 character types a bundle poses have at least
one**, so this is nearly every character in the game and not a civilian
speciality.

A descriptor is 14 dwords:

```
+0x00  u32  asset slot -- the model the whole part draws as
+0x04  u32  mesh info  -> the per-vertex map, below
+0x08  (u32 count, u32 src_verts, u32 assign) x4     the four VERTEX GROUPS
```

**It is skinning, and the assignment is hard.** `[proved]`
`DeformCharacterPartGroup` (`FUN_00419980`) is called once per group. It
composes `inverse(draw bone) * (group bone)`, walks the part's rows, and for
every row whose **signed byte** in that group's assign array is `>= 0`
transforms that group's source point and normal and writes them over every copy
of the vertex in the loaded model. A negative byte means the row belongs to
another group. There are no weights anywhere in the record and no accumulation
in the writers -- `WriteCharacterPartVertexPos` (`FUN_0041A480`) stores, it does
not add. Measured over `hito_gal`'s waist and skirt and `hito_baba`'s skirt:
**no row is claimed by two groups and none by none.**

So each vertex has one bone and weight 1 -- which is exactly what glTF
skinning says, and is why the port emits a glTF `skin` rather than a per-frame
transform of its own. It **cannot** be reduced to one rigid mesh per bone:
every triangle straddles two groups (20 of 20, 24 of 24, 36 of 56 on those
three parts), so splitting would tear all of them.

The source vertices are in the **group bone's own local space**, and the draw
bone's matrix that `DrawCharacterPartSlot` (`FUN_00419B40`) sets is exactly the
one the deform pre-multiplied the inverse of. The two cancel, so a vertex ends
up at `group_bone_matrix * source_vertex` and nothing else -- an inverse bind
matrix of identity. Corroborated numerically: for `hito_gal`'s waist, the group
whose bone *is* the draw bone has source vertices equal to the pol model's
stored ones to 8e-4 (the low mantissa bit `WriteCharacterPartVertexPos` ORs into
x to keep the PowerVR2 vertex control word set), while the group on bone 1
differs from the stored version by 0.424 in y, which is the bind-pose offset
between bone 1 and bone 9.

`g_character_part_bones` (`0x004ED1E0`) is five `s32` per part: the four group
bones, then **the bone the part is drawn in**. The default table's part 0 is
`{1, 1, 9, 0}` drawn at 9 -- the upper body and the pelvis, which is the
**waist**; part 1 is `{9, 9, 10, 13}` drawn at 9 -- the pelvis and both thighs,
which is a **skirt**. Per-character-type tables replace it for types `0x0E`,
`0x1F`/`0x46`/`0x4E`, `0x41`, `0x4C` and `0x53`.

The **mesh info** block gives the per-vertex map, which
`BuildCharacterPartVertexMap` (`FUN_0041A320`) copies and relocates:

```
+0x04  u32  offset to blob 1        0x14 bytes per row. Read by nothing.
+0x08  u32  size of blob 1
+0x0C  u32  offset to blob 2        the rows
+0x10  u32  size of blob 2
+0x14  s16  head length, in u16s
+0x16  s16  pointers per row
```

A row of blob 2 is `{s16 head[]; s32 vertex_offset[]}`, the pointer list
terminated by `-1` and the offsets relative to the model's own start. **A row is
one logical vertex** and the pointers are every copy of it in the display list:
`hito_gal`'s waist has 20 rows and 24 pointers onto 24 distinct vertex records,
its skirt 24 rows onto 28. `[open]`: the head is six `s16` row indices and
**nothing in this build reads it** -- the runtime record's `+0x08` is exactly
its size and the deform and both writers start past it. Blob 1 is one 0x14-byte
record per row and is likewise unread.

Four drawers ship, and which one a part gets says which groups it deforms:

| Drawer | Groups |
|---|---|
| `DrawCharacterPartGroup0` (`FUN_00419E90`) and its byte-identical twin `DrawCharacterPartGroup0Thunk` (`FUN_00419EA0`) | 0 |
| `DrawCharacterPartGroup2` (`FUN_00419E40`) | 2 |
| `DrawCharacterPartAllGroups` (`FUN_004198B0`) | 0, 1, 2, 3 |
| `DrawCharacterPartSubparts` (`FUN_0041A020`) | character type `0x17`'s part 1 only -- a different mechanism, see below |

A group the drawer does not touch keeps whatever the model stores, and that is
correct rather than sloppy: such a group's bone *is* the draw bone, so its
transform is the identity and the stored geometry already is the answer.

### The rigid twin, and the veto

Part 1's asset slot **is the pelvis model** -- the same slot bone 9 draws. So
ten character types would draw it twice, once rigid and once soft.
`SkeletonNodeDrawSuppressed` (`FUN_004122E0`) is what stops that:
`SkeletonEmitNode` (`FUN_004114C0`) asks it before the node draw hook and takes
the draw only on a zero. Read out of the disassembly rather than the
decompiler's switch:

```
if (charType == 0x17) return node.bone >= 0x10;      /* SETGE */
if (node.bone != 9)   return false;
return bone_records[9].slot in { 0xE3C 0xE4D 0xEA2 0xEB6 0xEC6
                                 0xED6 0xEF6 0xF06 0xF83 0x15B0 };
```

Those ten literals -- enumerated from the jump table at `0x00412360` and its
byte map at `0x00412368`, not from the decompiler -- are exactly the bone-9
slots of the ten types whose part 1 draws that slot: `0x21`, `0x22`, `0x26`,
`0x28`, `0x29`, `0x2A`, `0x2C`, `0x2D`, `0x35`, `0x3B`. One for one, no stray
either way. **It tests the slot bone 9 is *currently* drawing**, so a swap
changes the answer and it cannot be baked into an export. `[proved]`

The `0x17` arm is the same rule for a different replacement:
`BuildCharacterPartSubparts` (`FUN_00419EB0`) builds **eight** sub-parts from
`g_class17_subpart_records` (`0x0052EA38`, `{s32 bone; s32 slot; u32 mesh_info;
u32 draw_info}` x8) with bones 16 and up, which is exactly the range the veto
covers for that type.

`[open]` and `[diverges]`, both about type `0x17` (`zskamere`, two bundles):
the eight sub-parts are unported, so the port does **not** take the `0x17` arm
of the veto -- suppressing eight bones without the replacement would delete
them. Its part 1 is described in the bundle with `supported: false` and no
geometry, because the descriptor's slot word `0x0009` is a real `komono_4.bin`
model and is *not* what that drawer draws.

`[open]` Character type `0x4C`'s parts write each deformed vertex a second time
0x82C0 bytes further into the model, with the normal negated --
`WriteCharacterPartVertexPosTwin` (`FUN_0041A520`) and
`WriteCharacterPartVertexNormalTwin` (`FUN_0041A580`). A mirrored twin of the
whole model at a fixed offset. Unported; `0x4C` reaches no bundle.

### Held items

Ops 0x13, 0x14 and 0x15 put a model in a civilian's hand, and
`CivilianDrawHeldItems` (`FUN_0048CD10`) draws it. The record is 0x7C bytes —
the routine copies all 31 dwords onto its stack and reads them back, so the
layout is the copy's:

```
rec+0x00  u32       bone the item hangs off (5, a hand, on every record read)
rec+0x04  u32       asset slot drawn there
rec+0x08  s32       kind; 3-10 and 0x0E-0x12 draw a second, fixed slot
rec+0x0C  s32       rotate X, BAMS
rec+0x10  s32       rotate Y
rec+0x14  s32       rotate Z
rec+0x18  fn        per-frame callback, run after the draw. [open]
rec+0x1C  f32[6][4] per attach set: translate x/y/z, then a uniform scale
```

The rotations are applied **X, then Z, then Y**, and the translate follows
them. The attach set is `sub+0x82`, which `CivilianInit` picks from the
character type:

| Attach set | Character types |
|---|---|
| 0 | `0x20`, `0x23` |
| 1 | `0x26`, `0x29`-`0x2D`, `0x38` |
| 2 | `0x27`, `0x28` |
| 3 | `0x2E`-`0x30` |
| 4 | `0x24`, `0x25`, `0x31`-`0x33` |
| 5 | everything else |

So one record serves every skin that can hold it, with a different offset and
scale in a child's hand than in an old man's. Fourteen records exist; their
models are in `etc_1.bin` and `common.bin`, and the kinds' second slots are
effect billboards (`0x10A3` is a soft flame quad).

Op 0x15 picks between records with a weighted `rand()`: a `{weight, record}`
list terminated by weight `-1`, `rand() % total`, walked down subtracting.
`CivilianAddPickedItem` (op 0x14) then appends whatever it chose. The draw is
the same for both.

### Being shot

A civilian has no hit table and no hit points, and the shot never reaches
`ResolveHit`. `ShotTestSphere` (`FUN_00404630`) tests a sphere at the actor's
registered point with radius `obj+0x124` — `g_actor_radius_by_char`, **ten
units** for every civilian type — and descends into `ShotTestSkeleton` only
when `obj+0x34` bit `0x80` is set. No class-0x10 script ever sets it. What
lands is `MarkActorShot` (`FUN_00404DB0`): `obj+0x34 |= (1 << (player + 1)) |
8`, and `CivilianUpdate` reads those bits back on its next frame.

## The rescue, and what the class is

`CivilianInit` reads a **child count** at tail `+0x0C` and an array of
descriptor pointers at `+0x10`, and calls `SpawnFromDescriptor` on each,
parenting every one at `child+0x1394` and scaling its hit points by
`g_hp_percent_by_rank`. Those children are the zombies holding the civilian:
**47 of them across the six stages, all class 0x30** (plus three class-0x18
that resolve to no character), and *nothing in the evt's instruction stream
points at their descriptors* — so a walk of the script never returns them.

`CivilianPruneDeadChildren` (`FUN_0048CA60`) drops a child when it dies and
remembers that child's `obj+0x131C`, the player who killed it. Wait bit `0x04`
blocks until the list is shorter than `sub+0x20`, and the block it unblocks
ends with a wait word carrying `0x10000000` — which is where
`ScoreAddForPlayer` pays **400**, to that player or, when it is `-1`, to both.

### …and how the stage script finds out

**[proved]** A civilian's stream ends by raising a `g_script_flags` byte with
op `0x1C`, and the evt waits on that byte with `wait_script_flag` (0x45).
That is the whole handshake, and it is the reason the two halves have to share
one array.

Stage 3's boat hostage is the clean case. Her spawn is
`spawn_obj_c 0x0097A608` — script address 12808 — at block 2 step 3 op 27, and
step 3's **last blocking instruction, op 35, is `wait_script_flag 0x1E`**:
flag 30. Nothing in stage 3's script sets flag 30. She does:

* her tail's script selector is `27`, and that indexes
  **`g_civilian_scripts` (0x005702A8)**, not the stream table —
  `entries[27] = 64`;
* **stream 64 command 17** is `SetScriptFlag 30`, in the block behind the wait
  word `0x00080000` (*leave `g_civilians_alive` now*), so it fires once she has
  been **rescued**;
* **stream 63 command 12** is the same command, and 63 is stream 64's
  `SetOnShot` target — which `CivilianCheckShot`'s killed branch also runs when
  a captor mauls her.

So the gate opens whichever way the encounter ends, and the stage cannot hang
on it. Reading the selector as a direct index into `scripts` instead of
through `entries` gives stream 27, which carries no `0x1C` at all and makes
the flag look unraisable; the indirection is `CiviliansJson.entries` in
`bundle/scene.ts`.

### Letting the captors go

`CivilianUpdate` ends at `LAB_0048B0CE`, the tail every path out of it falls
into except the two that despawn. It is four instructions of gate and a loop:

```
0048b0ce  TEST  dword ptr [ESI + 0x34], 0x4000000   ; f7463400000004 -- dead?
0048b0d5  JZ    return
0048b0d7  MOV   DX, word ptr [ECX + 0x1e]           ; ECX = g_cur_civilian
0048b0db  CMP   DX, BX / JZ return                  ; BX = 0
0048b0e5  JLE   return
0048b0e7  MOV   EDX, 0xfeffffff                     ; ~0x1000000
0048b0ec  MOV   ECX, [ECX + 0x60] / MOV ECX, [ECX + EAX*4]     ; child = arr[i]
0048b0f2  MOV   EBX, [ECX + 0x34] / AND EBX, EDX / MOV [ECX + 0x34], EBX
0048b106  MOV   ESI, [ECX + 0x136c] / OR ESI, EDI / MOV [ECX + 0x136c], ESI
0048b121  JL    0048b0ec                            ; EDI = 1, from 0x0048AF7D
```

Once the civilian is **dead** — `obj+0x34` bit `0x4000000`, which the shot
branch sets — every surviving captor gets `obj+0x34` bit `0x1000000` **cleared**
and `obj+0x136C` bit `0x1` **set**, on every frame for as long as the body is
still in play. `[proved]`

* `obj+0x34` bit `0x1000000` is "this actor is holding something". Class 0x30's
  death-motion picker `ChooseDeathMotion` (`FUN_004560B0`) reads it at
  0x004560DD — `TEST dword ptr [ESI + 0x34], 0x1000000`, bytes
  `f7463400000001` — and takes motion `0x3F9` ahead of every other branch while
  it is set. Clearing it is what gives a released captor its ordinary death
  clip back. A sweep for `TEST r/m32, 0x1000000` finds that site and 0x00430C88
  and no others.
* `obj+0x136C` bit `0x1` selects **the scene light array** at draw time. Its
  only readers are class 0x31's two part-draw wrappers, `ThrowerDrawPart`
  (`FUN_0044A200`) and `ThrowerDrawPartWithAlpha` (`FUN_0044A240`):
  `TEST byte ptr [EAX + 0x136C], 0x1`, bytes `f6806c13000001`, at 0x0044A205
  and 0x0044A245, choosing `SubmitSlotWithSceneLightArray` (`FUN_004185E0`)
  over `AssetDrawSlot` (`FUN_00418560`) when the array at 0x009A2BB4 — written
  by `EvtOpSetSceneLighting14` — is non-null. A byte-pattern sweep of the image
  finds those two and no others, and the dword form finds none.

  `[open]`: **the captors are class 0x30**, so in the shipped game nothing
  reads the bit that is set on them. The write is transcribed because the
  engine makes it, not because an effect can be pointed at.

Shooting the civilian instead is the mirror. `sub+0x4C` is the gate: with no
on-shot script the hit bits are cleared every frame and the actor cannot be
hurt at all. With one, a survivable hit calls `PlayerTakeDamageTimed` — which
costs a **life** and 100 points of its own — and then charges another 100, so
the shooter is down 200; a *killing* shot charges 100 to **both** players and
no life. Either way the civilian switches to its on-shot script and cries out.

## The captors, and what they are actually doing

They are not attacking the player. Eleven of the 54 states in
`g_class30_states` never look at the camera at all — they work on
**`obj+0x1394`**, the object the actor was built for, and `CivilianInit` is
what writes the civilian there. 59 class-0x30 spawns across the game reach one,
and 47 of them are a civilian's captors.

| State | Name | What it does |
|---|---|---|
| 34 | `ZombieStateWalkToTarget` | Walk at the civilian until inside the script's radius, then grab |
| 35 | `ZombieStateTargetMotionScript` | The maul: steps a motion list and kills on a cue frame |
| 36 | `ZombieStateTargetScriptWithFlag` | The same, raising a `g_script_flags` byte on the cue |
| 37 | `ZombieStateCarryProp` | Carries a companion object and turns toward the camera |
| 38 | `ZombieStateRetireOffScreen` | Leaves once it is off camera, or once its loops run out |
| 39 | `ZombieStateAwaitCivilianOrder` | Waits on the civilian's own script — see below |
| 40 | `ZombieStateWalkPastPoint` | Walk until a point is behind it, then maul |
| 41 | `ZombieStateWalkToPoint` | Walk to within 5.0 of a point, then maul |
| 43 | `ZombieStateDragTarget` | Glued to the civilian: copies its position *and* rotation |
| 44 | `ZombieStatePounceOnTarget` | Leaps at it, one zombie at a time |
| 45 | `ZombieStateTargetLostPause` | Where it goes when the civilian dies under it |

### The two scripts

`ZombieScriptForState` (`FUN_0045CA10`) picks the descriptor tail's `+0x08`
blob while the actor is in the tail's attack state (`tail+0x03`), and the
`+0x04` blob otherwise. Each opens with a header shaped by the state that
*entered* it and continues as a list of `s16[4]` `{motion, frame, loops, mode}`
entries; the cursor at `obj+0x1398` is shared, which is how the walk hands the
maul a half-walked list. All 86 blobs the six stages reach decode and
terminate — `tools/verify_captor_scripts.py`.

| Entering state | Header |
|---|---|
| 34 | `{f32 arrive_dist; u16 loops; u16 motion; u16 frame}` |
| 35, 36 | none — straight into the entries (36's are `s16[5]`) |
| 38 | `{f32 x, y, z; s16 motion, frame; s16 loops, mode}` |
| 40, 41 | `{f32 x, y, z; s16 motion, frame}` |
| 43 | `{s16 loops; s16 cue_frame}` |

A list ends on the first entry whose motion is below 1, and then
`ZombieScriptEnded` (`FUN_0045C8D0`) **flips the roles**: initial state →
attack state, attack state → `AttackRun`. That last transition is the first
moment one of these zombies turns on the player, and it is the shape of the
whole set piece — deal with the civilian, then come for the camera.

### Two signals, both polled

Neither is a callback. Each is one actor writing a field the other reads, which
is why both survive a snapshot with no wiring at all.

* **Arrival unblocks the civilian.** `ZombieStateWalkToTarget` raises `0x800`
  in the civilian's own wait word the frame it gets close enough — the `Free`
  bit — and the civilian's script has been parked on it waiting to be grabbed.
* **The civilian orders its captors.** Op 0x1A writes a class-0x30 state id to
  `sub+0x2C` and a countdown to `sub+0x2E`, and
  `ZombieStateAwaitCivilianOrder` is the captor sitting on it. `0x31` means
  die, and the zombie takes its killer from the civilian's `sub+0x6C` — so the
  player who earned the rescue is credited with the captors that gave up.

And the kill goes the other way: the maul raises `0x4000000` on the
**civilian's** `obj+0x34`, the same bit a killing shot raises. `CivilianUpdate`
runs its killed branch, charges both players 100 and plays the death voice.
Failing to rescue costs exactly what a bad shot does.

`ZombieStatePounceOnTarget` also claims the civilian's `sub+0x64`, so a
civilian held by three is mauled by one at a time;
`CivilianPruneDeadChildren` clears that slot when the holder dies.

That cry is what proves the class. `CivilianPlayDeathVoice` (`FUN_0048D140`)
picks by character type: `0x24`/`0x25`/`0x2E`/`0x31`–`0x33` → `0x2000001A`,
`0x21`/`0x22` → `0x20000011`, `0x26`–`0x2C` → `0x2000000B`,
`0x20`/`0x23`/`0x2D` → `0x2000000D`, everything else `0x20000012` — which
resolve to `COM\220_Y_M.WAV`, `COM\209_M.WAV`, `COM\190_Y_W.WAV`,
`COM\207_OLD_W.WAV` and `COM\200_C.WAV`: a young man, a man, a young woman, an
old woman and a child.
