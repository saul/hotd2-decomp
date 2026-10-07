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

The walk is a measurement, not only a reading. A command is a dword and its
length is per-opcode, so one wrong length desynchronises the stream and the
next opcode is a pointer or a float — out of range at once. Walked, every
stream ends in exactly one `0x2D`, no byte is claimed by two different
commands, and the region is mostly command.

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
| `0x00000400` | `sub+0x18` is raised -- by `CivilianHookFallStep` on landing, the only writer of a 1 |
| `0x00000800` | **never** — this bit makes the conjunction fail outright |
| `0x00001000` | the camera's eased look-at has caught up |
| `0x00002000` | `g_script_flags[sub+0x1A]` is raised |
| `0x40000000` | two players are in play |

and the high bits, which are not waits at all:

| Bit | Meaning | of 596 |
|---|---|---:|
| `0x00008000` | `CivilianApplyMotionPose` (see *The clip change* below): this or `0x10000` turns the actor by the heading her drawn pose has and the new clip's first frame lacks; this one then rebases records 1 and 9 by the same, so the body does not swing. `[proved]` | 28 |
| `0x00010000` | `CivilianApplyMotionPose`: the same turn; without `0x8000`, record 0 (`model+0x7C/0x80/0x84`) takes the new frame's angles. `[proved]` | 4 |
| `0x00020000` | `CivilianApplyMotionPose`: **hold bone 1** — move the actor so bone 1 of the new clip's first frame lands where the last draw put it, both translations scaled by `model+0x116C`. How a clip that climbs down hands the height to the next. `[proved]` | 16 |
| `0x00080000` | leave `g_civilians_alive` now rather than on removal | 125 |
| `0x00100000` | **this block's clip carries her** — the root-motion gate, below | 289 |
| `0x00200000` | `CivilianApplyMotionPose`: **cut** — start the clip with no fade, and skip the record rewrites and the `0x100000` root hand-off. `[proved]` | 75 |
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

**The camera-track bit is how the room waits for her.** `[proved]`
`CivilianUpdate` (`FUN_0048A920`) ends every path that does not despawn at
`0x0048AD97` and runs `PUSH 0x40800000; CALL ActorRegisterCameraPoint` at
`0x0048ADAB`; `ActorRegisterCameraPoint` (`FUN_00409B70`) ends
`PUSH ESI; CALL 0x00408EC0` at `0x00409C03`, and `RegisterForCameraTracking`
tests nothing but `obj+0x34` bit `0x10000` and the list being full. So in every
block whose word carries `0x40000` the civilian is in `g_enemy_slots`, the
camera looks at her, `CameraDriverSelectMode` (`FUN_00402650`) stays in mode 3
and `g_camera_free` stays 0 -- and `wait_enemies_alive`,
`wait_enemies_present`, `wait_scripted_actors` and `wait_targets_clear` all
need that flag. A rescue script keeps the bit through the closed shutter and
her lines and drops it in the block that opens the shutter again (stage 4's
stream 75: tracked from command 0 to the `0x2188000` at command 41, which is
followed by `SetHudShutterState 1`). None of the 16 wait words carrying
`0x1000` (camera settled) also carries `0x40000`, which is consistent: a
tracked camera never raises `g_camera_settled`, so a script untracks her before
it waits for the camera.

### Where the target is — and on a carrier, which frame

Bits `0x10` and `0x20`, and the turn `CivilianUpdate` runs while `sub+0x40` is
non-zero, resolve one point by three rules `[proved]`:

| `sub+0x40` | The point |
|---|---|
| `-1` | the gameplay eye, `g_camera_eye` (`0x009C71E0`) |
| other negative | the actor's position mirrored through the eye in `x` and `z`, the eye's `y` |
| `>= 0` | `sub+0x30..0x38`, raw |

Bit `0x40` does not resolve anything: it reads `sub+0x30..0x38` raw whatever
the mode, through the actor's inverse orientation, and holds while the local
`z` is not above `0.0` (`0x004C436C`).

**On a carrier, a camera point is taken into the carrier's frame** -- the frame
her position is kept in, since `CivilianUpdateOnCarrier` (`FUN_0048B140`) runs
the whole update under the carrier's matrix. Both copies test
`CMP dword ptr [EAX], 0x48b140` after resolving a negative mode, push, make the
carrier's `Translate(+0x40); RotX(+0x64); RotZ(+0x6C); RotY(+0x68)`, invert and
transform the point. A fixed point is never transformed. **The two copies
differ by one instruction**:

| | Composes onto | Gets |
|---|---|---|
| `CivilianStepTurnToTarget` (`FUN_0048C850`) | `MatrixLoadIdentity` at `0x0048C8D4` | `C⁻¹·eye`, the camera in her frame |
| `CivilianStepScript` (`FUN_0048B1E0`) | the pushed copy of the top (`0x0048B3B0`, straight to `MatrixTranslate` at `0x0048B3C0`) | `(V·C·C)⁻¹·eye` |

`V` is the world-to-view `UpdateSceneViewAndLight` leaves on the stack for
every draw (`0x00402136`), and the first `C` is `CivilianUpdateOnCarrier`'s own
push. So the step's reach and facing tests measure against a point that is not
the camera in any frame, while the turn faces the camera correctly. The calls
are `[proved]`; that the top is `V` when `CivilianUpdate` starts is `[likely]`,
from `CivilianUpdate`'s sphere switch, which gets world points back out of the
draw's records by multiplying by the view-to-world matrix. The step's
pseudocode stops at this arm's `MatrixStackPop` (`0x0048B429`) and hides the
store and the tests after it (L35).

The shipped inputs: stage 3's `0x0BC0`, riding the boat, runs script 25 --
`SetTarget(-1, 18)` at command 5 and a reach word at command 6 -- and stage 4's
four riders (scripts 65 and 66) set mode `-1` behind a counter wait and turn to
the camera until a later `SetTarget(0, 0)`. Of the seven riders (every script
each can switch to followed), none uses the mirrored mode and `0x0BC0` is the
only one with a reach or face word.

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
in the script. **289 of the 596 shipped wait commands set the bit and 307 do
not.** `[proved]` `web/tools/checks/script_corpus.ts` counts them.

The same bit decides the *draw* at the end of that routine: with it set the
clip's horizontal root translation has already moved the object, so the pose is
placed with `MatrixTranslate(0, root.y, 0)` instead of the full root. The
translation either moves the object or moves the pose, never both.

`CivilianReapplyWaitCommand` (`FUN_0048B760`) deliberately does **not** write
either `model+0x20` or `model+0x64`, so a skipped block leaves the gate where
the last real clip change put it. Its ops 0x00 and 0x01 write `model+0x08` --
the **cursor**, 0 or op 0x01's start as the operand has it (`0x0048B794`,
`0x0048B7BA`) -- and not the counter at `model+0x00`. `[proved]` The next
draw's `SkeletonAdvancePlayCursor` (`FUN_004111A0`) recomputes the cursor from
the counter unless a fade holds it, so the store reaches the step loop's own
`0x200` test (`CMP [model+0x8], sub+0x16`) and nothing after: a block that
re-states the playing clip does not restart it, and a block that changes clip
hands `CivilianApplyMotionPose` the pose the outgoing clip was **drawn** in,
because that routine reads the draw records. The port has one clock for both
words; `ActorStorePlayCursor` in `game/motion.ts` is how the store lands.
Writing the clock instead is what made stage 1's fountain man (`0x1828`) turn
145 degrees on his change to 377 -- see *The clip change* below.

### The clip change — `CivilianApplyMotionPose`

`uVar3` above is `EBX`, the word loaded at `0x0048B9EA` **before** the VM's
loop: the word the block now ending ran under. Everything else the routine
reads is the new block's word. `[proved]`, from the listing, because the
pseudocode stops at the `0x8000` arm's `MatrixStackPop(1)` (`0x0048C767`) and
returns there, which it does not (L35): the bytes run on through record 9's
rewrite and `JMP 0x0048C7F9` into the blend like every other arm.

```
f = MotionFrameAddress(type, new clip, start / 2)
if (new & 0x18000)   yaw += heading(drawn records 0, 1) - heading(f's 0, 1)
if (new & 0x20000) { pos += bone 1 drawn - bone 1 under f  (scaled by +0x116C)
                     model+0x6C..0x74 = f.root }
if (new & 0x200000)  ActorSetMotionBlended(model, clip, start, 0)
else {
  if (new & 0x8000)        records 1, 9 rebased by -turn about record 0
  else if (new & 0x10000)  record 0 = f's record 0
  if (old & 0x100000)      model+0x6C = f.root.x;  model+0x74 = f.root.z
  ActorSetMotionBlended(model, clip, start, sub+0xE)
}
```

What the arms write into `model+0x6C` and the angle records is what the
blend's snapshot (`MotionLoadPoseSlot` mode 0xC) copies into slot A, so it is
what the fade dissolves from; the port carries it on `Actor.fadeFrom`.
**Stage 1's bin civilian** (`0x3C38`, block 6, stream 13) is the scene that
needed it: she falls onto the bin on 619 after `SetPose` (whose yaw the
bundle read as a denormal float, so she fell the wrong way), climbs down on
611, whose root ends 15.4 units below its start, and the next block's
`0x160100` carries `0x20000`, which moves her down onto the ground -- she
walked the rest of the scene at the height of the bin lid without it.
`web/src/game/class10/pose.ts` is the port.

**The delta is scaled by `model+0x116C`**, which `SkeletonApplyRootMotion` runs
`MatrixScale` with. `ActorBuildSkinnedModel` sets it from the character type
alone — 0.6 for type 30, 0.7 for 31, 0.9 for 32..56, 1.0 otherwise — and
**op 0x27 is the only command in the class that changes it**, storing its
operand verbatim into that float field. One command in the whole game runs it,
with `0x42480000` = 50.0.

**That one command puts Goldman on the arena's screen.** It is script 133,
reached from table entry 64, which stage 4's two `player_gold` spawns (type 61,
`0x8B74` and `0x9C3C`, blocks 23 and 25) run: wait a frame, clip 335 for ever,
wait 95 frames, `SetScale 50.0`, then his dialogue lines. The same field is the
`MatrixScale` of the whole draw (`SkeletonApplyRootMotion`, `0x00410FEA`), so
at 50 he is a figure the size of the jumbotron the camera is looking at, and
the port -- which drew every skinned actor at 1.0 until it drew them at this
field -- showed a blank screen through the whole speech. `[likely]` that this is
the effect it is for: the evidence is the size, the character, the timing
against his lines, and what the port draws with it; nothing in the exe names
it. The hit radii do not follow it: `SkeletonWalkNode` scaled them once, at
build.

Two consequences worth knowing, both the engine's:

* **A block whose own wait is already satisfied is skipped.** Once the parked
  wait clears, the step loop loads the *cursor's* word and tests that too; if
  it passes as well the loop advances again and the block it walked past never
  runs its actions. `CivilianReapplyWaitCommand` (`FUN_0048B760`) is what makes
  that safe: a second, smaller VM that re-applies only the opcodes a wait
  condition reads — the clip's loop count and play cursor (never the clip),
  the target, the timer, the three count goals, the camera cue and the flag
  index. Op 0x10 is the exception: it calls the install routine, whose
  velocity and gravity writes land, and then puts `NoOpStub` back in the slot
  (see *Op 0x10* below).
* **…and eight of those are put back before the step returns.** The loop
  count, the three goals, the camera cue's path and frame, the frame compare
  and the flag index (`sub+0x0C`, `+0x20`, `+0x22`, `+0x24`, `+0x10`, `+0x12`,
  `+0x16`, `+0x1A`) are saved on entry and restored at `0x0048B6DC`, which
  every exit reaches -- the arms Ghidra shows returning after a
  `MatrixStackPop` run on past it (L35). So the walks' writes serve the loop's
  own tests and nothing after: a block the loop passed, or one op `0x11`
  skipped, leaves none of the eight behind, and `CivilianRunScript` sets what
  the cursor's block sets. The target, mode, radius, timer and hook are not
  restored. `[proved]` The port restored only on the exit where nothing had
  resumed -- the one exit with nothing to undo -- until 2026-09-29.
* **`SetTimer` (op 0x09) does not delay its own block.** The step loop clears
  the timer on every resume, so the value that survives is the one the reapply
  walk reads out of the block *ahead*. A timer of `n` costs `n + 1` frames,
  because the test reads the value before the decrement.

## The opcodes

| Op | Name | Operands |
|---|---|---|
| `0x00` | `SetMotion` | motion, loops (negative loops for ever) |
| `0x01` | `SetMotionFrom` | motion, loops, start **cursor** (`model+0x08` takes it as it is) |
| `0x02` | `SetFrameLimit` | stop the clip on this frame |
| `0x03` | `SetMotionBlend` | the fade of the next clip change, `sub+0xE`; the Init's default is 10. Its one reader is `CivilianApplyMotionPose`. It was `SetTurnRate`, which nothing read supported |
| `0x04` | `SetMotionFrame` | the frame wait bit `0x200` looks for |
| `0x05` | `SetTarget` | point pointer or mode, arrival radius |
| `0x06` | `SetTargetPoint` | point pointer, kept at `sub+0x44`; the point goes to `sub+0x30..0x38` and **the mode at `sub+0x40` is not written** (`0x0048BC93`, `0x0048B84E`), so it turns nobody. All eleven shipped sit in a block waiting on `0x40`, the in-front test that reads `sub+0x30` raw. `[proved]` Nothing in the class reads `sub+0x44` but these two arms: every instruction naming `g_cur_civilian` (a byte scan for `a0d07d00`) lies in `0x0048A41C..0x0048DDD3`, which the operand sweep for `[r + 0x44]` covered. The other road to the sub-block, `obj+0x1310`, has 416 operand hits in 216 functions of other classes, where the field is their own (L3), so "nothing outside the class" is `[likely]`. |
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
| `0x13` | `AddHeldItem` | item record, the wait-word bits its routine gives on (`0x800000` in every stream) |
| `0x14` | `AddPickedItem` | the same bits; the record is op 0x15's pick |
| `0x15` | `PickHeldItem` | weighted table |
| `0x16` | `SetRadiusRamp` | target radius, frames |
| `0x17` | `SetSphereCentreMode` | **[proved]** the low byte of `cmd[1]` to `sub+0x80` (`0x0048BE5B`), which picks the collision-sphere centre `CivilianUpdate` writes to `obj+0x12C` -- see *The collision sphere* below. It was `SetCameraPointMode`; the camera's point is `obj+0x100` and this never reaches it |
| `0x18` | `SetPose` | pointer to six dwords, copied: three floats into `obj+0x40..0x48`, three BAMS **integers** into `obj+0x64..0x6C`. The five shipped yaws are `0xC000`, `0x2D00`, `0x4000`, `0x6000`, `0x7000` |
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
| `0x23` | `SetHeadLook` | where the head looks, `sub+0x8C`; a 2 also takes the first child as the target, `sub+0x90`, or writes 0 with none (`0x0048C044`). Read by `CivilianDrawBonePart`'s head turn, which is not ported. It was `SetAttachMode` |
| `0x24` | `SetHeadLookTarget` | the same, with the target given: `sub+0x8C`, `sub+0x90` (`0x0048C08C`). It was `SetAttachTarget` |
| `0x25` | `SetMouth` | **she talks**: frames into `sub+0xA4`, a mouth row into `sub+0xA8`, and `sub+0xA0 = 0` (`0x0048C0B0`) -- see *The mouth* below. It was `SetPairA`, "which nothing read reads" |
| `0x26` | `MoveOverFrames` | point (or `< 1` for the camera), frames |
| `0x27` | `SetScale` | `model+0x116C` |
| `0x28` | `SetCameraBone` | |
| `0x29` | `SetActorFlags` | OR'd into `obj+0x34` |
| `0x2A` | `SetDeathVoice` | or `0xFF` to pick by character type |
| `0x2B` | `InPlayOnly` | taken only while `g_app_state == 6`, which is **in play** — so this is the ordinary path, not a debug one. Writes `cmd+4` (s16) to the script context's `+0xBC` and `&cmd[8]` to its `+0xC0`; what those are is `[open]` |
| `0x2C` | `Wait` | the wait word |
| `0x2D` | `End` | |

### Op 0x10: an install routine, and the step it installs

The operand is a pointer to an **install** routine, and both VMs *call* it:
`next = hook(obj, cmd + 2)` (`CALL ECX` at `0x0048BD8D` in
`CivilianRunScript`, at `0x0048B923` in `CivilianReapplyWaitCommand`). The
routine writes a **step** into `sub+0x5C`, which `CivilianUpdate` calls once a
frame (`CALL [EAX + 0x5C]` at `0x0048A962`, straight after the child prune),
and returns the next command -- so **the install routine decides how many
dwords the command has**. The exporter has to know each by address
(`CIVILIAN_HOOK_LEN`) to decode the stream at all. Five operands appear in the
shipped scripts:

| Operand | Dwords | Install | Step it writes into `sub+0x5C` |
|---|---|---|---|
| `0` | 2 | none | -- |
| `0x0048D9F0` | 2 | `CivilianHookStartFall`: `vel.y = 0`, `obj+0x5C = 0xBCDF0123` (-0.027222) | `CivilianHookFallStep` (`0x0048DA20`) |
| `0x0048DA90` | 2 | `CivilianHookRideChildren` | `CivilianHookRideChildrenStep` (`0x0048DAB0`) |
| `0x0048DB90` | 3 | `CivilianHookStartMoveY`: `vel.y` = the operand, `obj+0x34 \|= 0x80000` | `CivilianHookMoveYStep` (`0x0048DBC0`) |
| `0x0048DBD0` | 5 | `CivilianHookStartMoveLocal`: `vel` = the three operands | `CivilianHookMoveLocalStep` (`0x0048DC10`) |

The steps, all `[proved]` from their disassembly:

* **`CivilianHookFallStep`** asks `QueryGroundHeightAt(x, y + 100, z)` at the
  position *before* the move, then `vel.y += obj+0x5C; y += vel.y` -- the y
  axis only. The frame the ground is at or above the new `y` it snaps `y` to
  it, raises `sub+0x18` (wait bit `0x400`'s condition) and writes `NoOpStub`
  back. The velocity is left as it landed.
* **`CivilianHookRideChildrenStep`** turns the civilian toward the mean of her
  captors at up to `0x80` BAMS a frame, and writes `NoOpStub` once she is dead.
* **`CivilianHookMoveYStep`** is `y += vel.y` and nothing else: no gravity, no
  ground, no uninstall, and `sub+0x18` never goes up.
* **`CivilianHookMoveLocalStep`** adds the velocity turned by the actor's own
  rotation -- `Translate(pos); RotateX(obj+0x64); RotateZ(obj+0x6C);
  RotateY(obj+0x68); TransformPoint(vel)` -- every frame; likewise no gravity,
  no ground and no uninstall.

The two VMs handle the operand differently:

* **`CivilianRunScript`** (`0x0048BD81`): `0` writes `NoOpStub` to `sub+0x5C`
  and nothing else; anything else is called and then `sub+0x18 = 0`.
* **`CivilianReapplyWaitCommand`** (`0x0048B913`): `0` writes **nothing**, so
  the step already installed stands; anything else is called -- its velocity,
  gravity and flag writes all land -- and then `sub+0x5C = NoOpStub` takes the
  step straight back out. `sub+0x18` is not touched.

Where they are used, in the shared table: `StartFall` once (stream 30, which
stage 3's two spawns at `0x701C` and `0x70EC` run), `RideChildren` twice
(stream 35, stage 4's `0x23F8`, and stream 58, which no spawn reaches),
`StartMoveY` three times (streams 61, 67 and 71, each with -0.2, each the
on-shot stream of 62, 68 or 72) and `StartMoveLocal` once (stream 72,
`(0, 0, -0.05)`). **No spawn the bundle carries runs 58, 62, 68 or 72**, so
neither move step is reached in the six stages as exported; `[open]` whether
anything the exporter does not see spawns them.

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
`web/tools/checks/attachments.ts` holds the table.

| Ids | Files | What happens |
|---|---|---|
| `0x00`–`0x23` | `hito_kao_*`, `etc_*_kao`; `0x02`, `0x03` and `0x0E` are `char_adv02`, `char_adv01` and `char_adv07` | `ActorBindPartList` writes the record's slot **over** `bone_records[bone].slot`. All 36 are bone 2. *Kao* (顔) is **face**: `hito_kao_gal.bin` alone holds 60 heads of the same 149 vertices and 234 triangles as `hito_gal`'s own -- three faces of twenty slots each, and the slots after a face are its mouth shapes: `CivilianDrawBonePart` draws the face's slot **plus a cel** of 0 to 9 while she talks (see *The mouth*), and `0x0C6A` against `0x0C6C` moves 62 of the 149 vertices, all in the lower front of the face. What slots ten to nineteen of a face are is `[open]`: no table reaches them. The skeleton's head is the default, not the character. |
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

### The mouth

**Nothing in a civilian's motion moves her mouth.** `CivilianInit` installs
`CivilianDrawBonePart` (`FUN_0048D1F0`) as the node draw hook (`MOV dword ptr
[EAX + 0x1158], 0x48d1f0` at `0x0048A60B`), and for bone 2 it draws the head's
record slot **plus a cel** out of `g_civilian_mouth_tables` (`0x0056B950`),
six `{s8 *cels; s32 count}` rows. `[proved]`

```
if (sub+0xA8 != 6) {                      // CivilianInit writes 6
    cel = rows[sub+0xA8].cels[sub+0xA0 % rows[sub+0xA8].count];
    if (sub+0xA4 != 0) {
        if (--sub+0xA4 == 0) {
            if (sub+0xA8 == 2) { sub+0xA8 = 3; sub+0xA4 = count[3]; sub+0xA0 = 0; }
            else sub+0xA0 = count[sub+0xA8] - 1;
        } else sub+0xA0 += 1;
    }
}
AssetDrawSlot(record + cel);
```

Op `0x25` writes the frames, the row and a zero cursor; the shipped streams
name rows 0, 1, 2 and 5. The cel is read **before** the step. Row 2 hands over
to row 3 -- `5 5 5 6 6 6 7 7 7 8 8 8 9` -- for its own thirteen frames, and
every other row, row 3 included, parks its cursor on its last cel and holds it
until the next op `0x25`: rows 0, 1, 4 and 5 end on 0, the face's own slot,
and row 3 on 9. The count is of **drawn** frames: the hook runs only for a
node `SkeletonEmitNode` draws. The record itself is never written.

| Row | At | Count | Cels |
|---|---|---|---|
| 0 | `0x0056B88C` | 21 | `1 2 3 3 2 1 0 0 1 2 2 1 2 3 4 4 3 2 1 0 0` |
| 1 | `0x0056B8A4` | 38 | `1 1 2 2 3 3 3 3 2 2 1 1 1 1 2 2 2 2 1 1 2 2 3 3 4 4 4 4 3 3 2 2 1 1 0 0 0 0` |
| 2 | `0x0056B8CC` | 34 | `1 1 1 2 2 2 3 3 3 3 2 2 2 1 1 1 1 2 2 2 2 1 1 1 2 2 2 3 3 3 4 4 4 4`, then row 3 |
| 3 | `0x0056B8F0` | 13 | `5 5 5 6 6 6 7 7 7 8 8 8 9` |
| 4 | `0x0056B900` | 20 | `1` ten times, then `0` ten times |
| 5 | `0x0056B914` | 56 | `1 1 2 2 3 3 3 3 2 2 1 1 1 1 2 2 2 2 1 1 0 0 0 0 1 1 2 2 3 3 4 4 5 5 6 6 7 7 7 7 6 6 5 5 4 4 3 3 2 2 1 1 0 0 0 0` |

The bundle carries the rows as `characters.civilian_mouth_tables`, and the
exporter puts every `record + cel` a spawn's script can reach on her type's
hidden template. Ported in `game/class10/mouth.ts`.

The same hook turns the head before it draws it -- `sub+0x8C`, ops `0x23` and
`0x24`, toward the camera's eye, a child, the camera's target or a point,
clamped and eased `0x100` a frame -- and that turn is not ported.

### The waist and the skirt are not in the skeleton either

Beside the attachment list there is a second set of parts the skeleton does not
name: `g_pCharacterExtraParts` (`0x0052ED08`), one or two per character type,
built by `BuildCharacterPart` (`FUN_00419520`) and drawn by
`DrawCharacterPart` (`FUN_0041A300`) through `g_character_part_drawers`
(`0x004EDAEC`). **52 of the 64 character types a bundle poses have at least
one**, so this is nearly every character in the game and not a civilian
speciality; `web/tools/checks/parts.ts` holds every bundle's part table to the
exe's.

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

Ops 0x13, 0x14 and 0x15 put an item in a civilian's hand, and
`CivilianDrawHeldItems` (`FUN_0048CD10`) — which `CivilianUpdate` calls at
`0x0048AF89`, after the sphere switch — draws it **and gives it**. The array
at `sub+0x70` (length `sub+0x6E`) holds 8-byte `{record, operand}` pairs; ops
0x13 and 0x14 append the op's two operands (op 0x14's record is what op 0x15
last picked, `sub+0x74`). The record is 0x7C bytes — the routine copies all 31
dwords onto its stack and reads them back, so the layout is the copy's:

```
rec+0x00  u32       bone the item hangs off (5, a hand, on every record read)
rec+0x04  u32       asset slot drawn there
rec+0x08  s32       kind: an Original Mode item id, or -1; 3-10 and 0x0E-0x12
                    draw a second, fixed slot
rec+0x0C  s32       rotate X, BAMS
rec+0x10  s32       rotate Y
rec+0x14  s32       rotate Z
rec+0x18  fn        the routine the draw calls after the item [proved]
rec+0x1C  f32[6][4] per attach set: translate x/y/z, then a uniform scale
```

**The pose.** Per item, `MatrixStackSetTopFromArray(model + 0xA0 +
bone*0x90)`, then `RotX(rec+0xC) RotZ(rec+0x14) RotY(rec+0x10) T(set.xyz)`
and `Scale(set.w)` unless it is 1.0, then `AssetDrawSlot(rec+4)`. Every call
post-multiplies, so the translate is along the **turned** axes: the item's
origin is at `Rx Rz Ry t` in the bone's frame, not at `t`. `[proved]` from the
listing; the pseudocode drops every FPU argument (L1). Kinds 3–6 draw their
second slot in the same matrix; kinds 7–10 (lift 6.5) and 0x0E, 0x0F, 0x10,
0x12 (lift 2.0) draw it facing the camera — `T(0, h, 0)`, keep the
translation, `MatrixLoadIdentity`, `T(p) Scale(set.w * model+0x116C) T(0,
-h, 0)`. The attach set is `sub+0x82`, which `CivilianInit` picks from the
character type:

| Attach set | Character types |
|---|---|
| 0 | `0x20`, `0x23` |
| 1 | `0x26`, `0x29`-`0x2D`, `0x38` |
| 2 | `0x27`, `0x28` |
| 3 | `0x2E`-`0x30` |
| 4 | `0x24`, `0x25`, `0x31`-`0x33` |
| 5 | everything else |

**The give.** After drawing an item the routine calls `rec+0x18(obj)`. Two
routines appear in the fourteen records `[proved]`:

* `CivilianHeldItemGrantLife` (`FUN_0048DCC0`) — record `0x0056B190` alone
  (`g_civilian_item_record_life`: slot `0x10C3`, kind -1, `X 0x4000 Z
  0xC000`, `t = (0, 1, 1)` in every set). Five spawns hold it: stage 1
  `0x3C38`, stage 2 `0x51AC`, `0x9FE8` and `0x12714`, stage 4 `0x10FC`.
* `CivilianHeldItemGrantOriginalItem` (`FUN_0048DD60`) — the other thirteen,
  whose kind is an Original Mode item id.

Both open the same way: when `entry.operand & wait word` is non-zero they
clear those bits from the word, raise `0x400000`, and name the player in
`sub+0x6C` — `g_active_player` when `g_players_in_play == 1`, else `rand() %
2` only if `sub+0x6C` is still -1 (so, in two-player, the killer of the last
captor, which `CivilianPruneDeadChildren` copied there). Every shipped op
0x13/0x14 passes operand `0x800000`, and in all eleven streams that append
an item the very next wait word is `0x940100` — so the item is held for the
rest of the block that appends it (the clip playing on to the op 4 frame
that block sets — frames 10 to 45 of clip `0x238` for stage 1's `0x3C38`) and given on
the first frame of the next. Then:

* **the life**: `GrantExtraLife(p)` — +1 unless `g_player_lives[p]` has
  reached the cap (`g_max_lives`, `0x009A2440`, 5, outside Original Mode;
  `g_original_life_cap[p]`, `0x009A2245 + p*0x14`, 5, in it), in which case
  `ScoreAddForPlayer(p, 300)`. On a life, `SpawnLifeGrantedMarker(p)`
  (`FUN_0048DF10`): slot `0x1256 + p` drawn in camera space at `z = -1`, 120 px
  below centre, 32 px a unit, centred when `g_max_attackers` is 1 and ±160 px
  otherwise, for 120 frames, the last five faded (`LifeGrantedMarkerUpdate`,
  `FUN_0048DFE0`). **No sound** anywhere on this path.
* **an Original Mode item**, in any mode: `g_original_items_taken[kind]++`
  below 0x63, both slots unloaded, `SpawnOriginalItemBanner` with the sprite
  `g_original_item_bank_sprite` (`0x0056B0F4`, `{s16 texbank, s16 sprite}`
  per id) holds for the kind, and a `DelayedTexbankFreeUpdate` task
  (`FUN_0048DEE0`) that frees the kind's texbank 150 frames later.

The draw answers `0x400000` by clearing it, zeroing that entry's record and
decrementing `sub+0x6E`; after the loop it reallocates the array to the
survivors in order (`0x0048CFAB`..`0x0048D01E`, past the `MatrixStackPop`
where Ghidra's pseudocode stops — L35). The loop count is taken once, and
`sub+0x70` itself is the cursor the callback reads its own entry through.
**One word gives one item**: the first routine that sees `0x800000` clears
it, so a second held item waits for another word — no shipped stream holds
two.

Op 0x15 picks between records with a weighted `rand()`: a `{weight, record}`
list terminated by weight `-1`, `rand() % total`, walked down subtracting, and
preloads the record's slots and the kind's texbank.

Four of the thirteen Original Mode items (stage 2 `0x8510`, `0x1158C`,
`0x12098`, stage 4 `0x23F8`) are only reached through the second arm of an op
0x1F, which `CivilianRunScript` takes when `DAT_009A2226` equals the switch's
`DX` (`0x0048BF79`). `[open]`; the port takes the first arm, and those four
leave without their item.

### Being shot

A civilian has no hit table and no hit points, and the shot never reaches
`ResolveHit`. `ShotTestSphere` (`FUN_00404630`) tests a sphere at the actor's
registered point with radius `obj+0x124` — `g_actor_radius_by_char`, **ten
units** for every civilian type — and descends into `ShotTestSkeleton` only
when `obj+0x34` bit `0x80` is set. No class-0x10 script ever sets it. What
lands is `MarkActorShot` (`FUN_00404DB0`): `obj+0x34 |= (1 << (player + 1)) |
8`, and `CivilianUpdate` reads those bits back on its next frame.

## The collision sphere

`CivilianUpdate` ends by writing `obj+0x12C..0x134`, the centre
`RegisterForShotTest` publishes and `ColiTestSphereAgainstActors` measures
every other actor's push against, from a four-arm switch on `sub+0x80`
(`0x0048ADB5`..`0x0048AF83`, jump table `0x0048B12C`). **[proved]**

| `sub+0x80` | Arm | Point |
|---|---|---|
| 0 | `0x0048ADDB` | `obj+0x40`, the actor's position (carrier-relative on a carrier) |
| 1 | `0x0048ADFC` | bone 2: `model+0x1C0` |
| 2 | `0x0048AE60` | bone 1: `model+0x130` -- **`CivilianInit` writes this mode** |
| 3 | `0x0048AEC4` | halfway between bone 15 (`model+0x910`) and bone 12 (`model+0x760`) |
| other | | nothing is written (`CMP EAX,3; JA`, on a `MOVSX` byte) |

`model` is `g_cur_actor_model`, `obj+0x194`, and `model+0xA0 + bone*0x90` is
the matrix `SkeletonEmitNode` stores in a bone's draw record
(`obj+0x20C + bone*0x90 + 0x28`) as it walks the skeleton under the camera.
Each bone arm is `MatrixStackSetTopFromArray(g_camera_blocks[cam])` (view to
world), `MatrixMultiply(record)`, `MatrixGetTranslation`: the bone's origin in
the world, drawn a few lines earlier in the same update. Bone 1 is the root node
of every civilian skeleton; bone 2 its child five-odd units up; 12 and 15 the
children of 11 and 14, 4.76 below them (`[likely]` the two legs' lower joints --
from the tree, not from a name).

Mode 1 is set by streams 5, 6, 18, 24, 31, 43, 45 and 89; mode 2 by 5, 28, 31
and 89; mode 3 by 28 and 30; mode 0 by 38 alone. Through `entries`, the spawns
whose streams reach them are: mode 1, stage 1's `0x4AE4`, stage 2's `0x51AC`,
`0x8510`, `0x8620`, `0xBBA8`, `0xEA54` and `0xEA8C`, and stage 4's `0x59C8`;
mode 3, stage 2's `0x8598`; mode 0, stage 2's `0xA134`. Every civilian no
stream has told otherwise is on mode 2.

The two readers are the actor push (through the registration list, so a sphere
published this frame is the one written on the previous) and
`PoseHookGrowAndPushOutOfWorld`, which the draw calls through `model+0x115C` --
before the switch, so it too reads the previous frame's centre. The gunshot
does not read it: `ShotTestSphere` measures `obj+0x70`, the camera point in view
space.

## How a civilian leaves

`CivilianUpdate` ends (`0x0048AF8E..0x0048B0C8`) with four arms, in this
order. `[proved]`

| Arm | Condition | Effect |
|---|---|---|
| skip | `g_cutscene_skipping` and the word lacks `0x20000000` | `sub+0x2A = 1` |
| countdown | `sub+0x2A != 0` | count down; at zero despawn, or `sub+0x2A = 1` again while children remain |
| cue | `g_active_cam_path == sub+0x26 && g_cam_path_frame == sub+0x28` | `sub+0x2A = tail+0x06` |
| off camera | the word has `0x2000000`, `ActorBoundsOnScreen` (`FUN_0045CA60`) says no, `g_scene_state_major_entered != 2`, no children | despawn now |

Every despawn frees the hit slot, runs `ActorReleasePartList`, leaves
`g_civilians_alive` unless `sub+0x04` bit 0 says she already did, and calls
`ActorDespawn`. Of the 126 streams that end in themselves (ten hand over with
op 0x1E/0x1F), 87 end on a `0x2000000` word, and `goto_scene_state` taking the
major to 1 after a room is the first moment that arm can fire. The port had
the countdown and the cue only; the off-camera arm is in
`game/class10/update.ts` now and the skip arm is `[open]` (no
`g_cutscene_skipping` in `G`).

**A seek has to reproduce this**, because it replays the evt with no actor
running and would otherwise rebuild every earlier civilian at her first
command. `web/src/script/civilian_life.ts` applies the arms a replay can see:
the cue exactly (the replay's camera plays her path past her frame, once her
room is played), and the off-camera arm at the first `goto_scene_state` after
her room's gate when her rescue path ends on `0x2000000` -- `[likely]`, since
a replay has no pose to test the screen against.

**...and so does every counted actor she waits behind.** Many of her kind
wait on `g_enemies_alive` or `g_enemies_present` (wait bits `0x2`/`0x1`) or on
a camera cue the script plays only past a room gate, so a replay that
rebuilds any actor holding either counter leaves her sobbing in front of dead
captors. Two did: stage 2's class-0x21 rescue target, whose ways out all come
before any gate (`RescueTargetOutlivedByReplay` in `game/class21/index.ts`),
and stage 3's class-0x18 boat riders, which the walker's gate list had left
out.

## The rescue, and what the class is

`CivilianInit` reads a **child count** at tail `+0x0C` and an array of
descriptor pointers at `+0x10`, and calls `SpawnFromDescriptor` on each,
parenting every one at `child+0x1394` and scaling its hit points by
`g_hp_percent_by_rank`. Those children are the zombies holding the civilian:
**60 of them across the six stages: 57 class 0x30 and three class 0x18**
(stage 2's `0xA174`, stage 3's `0xC00` and `0x71D0`, placed since 902de88a
gave class 0x18 a character-type rule), and *nothing in the evt's instruction
stream points at their descriptors* — so a walk of the script never returns them.

`CivilianPruneDeadChildren` (`FUN_0048CA60`) drops a child when it dies and
remembers that child's `obj+0x131C`, the player who killed it. "Dies" is
exactly `child+0x34 & 0x4000000` `[proved]` — the loop reads nothing else, so a
captor that leaves by `ActorDespawn` (`FUN_00409CC0`, which ORs `0x80018000`)
is still held; `ZombieRetireAndCredit` (`FUN_0045BA40`, `0x4008001`) and
`ResolveHit`'s kill raise the bit and are. `ResolveHit` (`FUN_00409430`)
writes the shooter into `obj+0x131C` on that kill (`0x004097D1`, `MOV byte
ptr [EDI + 0x131c], CL`) `[proved]`; the port left it at -1 until 2026-09-29,
so every shot-earned rescue paid both players. Wait bit `0x04`
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
what writes the civilian there. 70 class-0x30 spawns across the game reach one
(76 with class 0x18's), and 55 of them are among the 57 class-0x30 captors the
civilians name; `web/tools/checks/script_corpus.ts` holds the 76 and the 57.

| State | Name | What it does |
|---|---|---|
| 34 | `ZombieStateWalkToTarget` | Walk at the civilian until inside the script's radius, then grab |
| 35 | `ZombieStateTargetMotionScript` | The maul: steps a motion list and kills on a cue frame |
| 36 | `ZombieStateTargetScriptWithFlag` | The same, raising a `g_script_flags` byte on the cue |
| 37 | `ZombieStateCarryProp` | Carries a prop (`CarriedPropInit`, no class id) turned to the camera, claims a permit and throws it on a cue frame; see `game/carried_prop.ts` |
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
maul a half-walked list. All 117 blobs the six stages' 76 captor spawns reach
decode and terminate, which `web/tools/checks/script_corpus.ts` asserts.

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
