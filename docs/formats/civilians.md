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

and four that are not waits at all:

| Bit | Meaning |
|---|---|
| `0x00080000` | leave `g_civilians_alive` now rather than on removal |
| `0x02000000` | may be removed when off camera |
| `0x08000000` | uncounted: no `g_civilians_alive`, and worth no score |
| `0x10000000` | **rescued** — pay 400 and clear the bit |

`0x04000000` is masked off as the word is loaded (`operand & 0xFBFFFFFF`).

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
| `0x19` | `SetGlobalA` | `DAT_009C88A4`. `[open]` |
| `0x1A` | `SetChildCue` | applied only while children survive |
| `0x1B` | `SetGlobalB` | `DAT_009CA0F4`. `[open]` |
| `0x1C` | `SetScriptFlag` | index |
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
| `0x2B` | `DebugOnly` | taken only while `g_app_state == 6` |
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
