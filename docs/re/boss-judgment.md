# JUDGMENT — spawn classes 0x22 and 0x23, read for transcription

Stage 1's boss, and its re-appearance in stage 5 before the Magician. Two
spawn classes that only work as a pair:

| class | handler | what it is | evidence |
|---|---|---|---|
| `0x22` | `Class22Init` (`FUN_0049B0D0`) | **the small flier** — character type `0x45`, the only one of the two that takes damage, flies, has the health bar and the banner | skeleton scale (node 2 at `y +2.90` against `+10.29`), `HABATAK1/HABATAKI2` ("flapping") sounds, the player line *"The small one must be the brain!?"* (group `0x1C`) is played by this class, and every one of its voice files ends `_ZE` / `_ZEA` (`ST1\30_ZE.WAV`, `ST5\337_ZE.WAV`, `ST1\33_ZEA.WAV`) |
| `0x23` | `Class23Init` (`FUN_0048FD90`) | **the large walker** — character type `0x44`, cannot be hurt in Arcade, strikes the player, transfers every hit it takes to class 0x22 | skeleton scale, `AXE_44K`/`AXE_22` on its strike frames, `BOS_WALK1/3` footsteps, hits on it play `BULLET_OTH1/SND1` (ricochet) and add nothing to its own damage |

**Names.** "Zeal" for class 0x22 is `[likely]`: the `_ZE`/`_ZEA` voice-file
suffix follows the speaker-suffix convention the other voice files use
(`_J`, `_GA`, `_Y_M`, `_OLD_W`). Nothing in the binary names class 0x23
"Kuarl"; this document calls it **the companion** (it is `obj+0x1394` on both
sides). "Wings" for the class-0x22 sub-actor (character type `0x46`) is
`[likely]` — two mirrored three-node chains off one root, a flap clip chosen
from the flight speed, and `boss1z_wing.bin` loaded beside `boss1z.bin` by
every block that spawns the class — so the routines call it the **sub-actor**.

Everything below is `[proved]` from the instruction stream unless it says
otherwise. Floats are quoted as the hex the instruction or `.rdata` holds.
Ghidra truncated four of these routines at a `MatrixStackPop` it believes does
not return (`L35`): `Class22DrawAndPoseSubActor`, `Class22FightPhase1`,
`Class22Death` and `Class22Phase1TakeShots`. Every tail below was read with
`disassemble_bytes` past the end Ghidra gives.

---

## 1. Where it spawns, and how the tail reaches `obj+0x1390`

`dump_stage_script.py` prints evt opcode **`0x0B` as `spawn_obj`** and opcode
`0x09` as `spawn_placed`. The evt dispatch table at `0x005931D8` (96 dwords,
read from memory) has entry 9 = `0x004088A0` (`EvtOpSpawnPlaced09`, no tail
pointer) and entry `0xB` = `0x00408AA0` (`EvtOpSpawnObj0B`), which calls
`SpawnFromDescriptor` (`FUN_00408A20`) at `0x00408ABB` — and that is what
writes `obj+0x1390 = descriptor + 0x24`. So there is no contradiction with
`spawns.md`: every class-0x22 spawn is opcode `0x0B`. The nested class-0x23
descriptor is spawned by `SpawnFromDescriptor` directly (`0x0049B6FA`,
`0x0049CE42`), so it gets `obj+0x1390` too.

| stage | block | instr | descriptor | class | variant / subtype | hp (`+0x22`) |
|---|---|---|---|---|---|---|
| 1 | 0 step 1 | `0x0001FC` | `0x794` | 0x22 | variant **0** | 500 (unused) |
| 1 | 14 step 1 | `0x005944` | `0x6174` | 0x22 | variant **1** | 300 |
| 1 | 16 step 2 | `0x006AD8` | `0x6174` (same) | 0x22 | variant **1** | 300 |
| 5 | 1 step 1 | `0x001388` | `0x14AC` | 0x22 | variant **2** | 300 |
| 1 | — | nested at `0x61AC` | tail+0x10 of `0x6174` | 0x23 | subtype **0** | 90 |
| 5 | — | nested at `0x14E4` | tail+0x10 of `0x14AC` | 0x23 | subtype **1** | 90 |
| training | `trnevtbl.bin` block 9 | 10200 | `0x2A34` | 0x23 | subtype 2 | 90 |
| attract | `advevtbl.bin` block 0 | 1768 | `0x1C00` | 0x22 | variant 3 | 0 |

A whole-file scan of all twelve scene scripts for 0x22/0x23 headers followed by
a `0x44`/`0x45` character byte finds only these (three more header-shaped hits
in `st1`/`st2`/`st3` are not referenced by any spawn opcode or pointer).
Variant 3 and subtype 2 are outside stages 1–5 and are read here only far
enough to name them.

### Descriptor bytes

```
st1 0x794  (variant 0)
  22000000 00000000 [pos 0,0,0] [rot 0,0,0] 0000 f401
  tail: 45 00 1504 0000 2200 9001 ffff      <- 12 bytes; a class-0x30 header follows at 0x7C4

st1 0x6174 (variant 1)
  22000000 00000000 [pos 0,0,0] [rot 0,0,0] 0000 2c01
  tail: 45 01 0b04 0000 3100 9001 2c01 d200 5a00 acbbeb0c | nested 0x23 descriptor at 0x61AC

st5 0x14AC (variant 2)
  tail: 45 02 0b04 0000 cf00 8c00 2c01 d200 5a00 e46eeb0c | nested at 0x14E4

nested 0x23 (st1 0x61AC / st5 0x14E4)
  23000000 00000000 [pos 0] [rot 0] 0000 5a00
  tail: 44 00|01 8d03 0000 3100|cf00 9001|8c00 ffff
```

### Class 0x22 tail (`obj+0x1390`)

| off | type | v0 | v1 | v2 | reader |
|---|---|---|---|---|---|
| +0x00 | u8 | 0x45 | 0x45 | 0x45 | **unread** — `Class22Init` stores the literal 0x45 |
| +0x01 | s8 | 0 | 1 | 2 | `Class22Init` → `obj+0x130C`, the variant |
| +0x02 | s16 | 0x415 | 0x40B | 0x40B | `Class22Init` → `obj+0x1B4`, the first clip |
| +0x04 | s16 | 0 | 0 | 0 | `Class22Init` → `obj+0x194`, the clip frame counter |
| +0x06 | s16 | 0x22 | 0x31 | 0xCF | despawn cam path (`RideAndLeave`, `PoseUntilCameraCue`, `Death`) |
| +0x08 | s16 | 0x190 | 0x190 | 0x8C | despawn frame, `g_cam_path_frame >=` |
| +0x0A | s16 | -1 | 300 | 300 | hit points seated when it joins the fight |
| +0x0C | s16 | — | 210 | 210 | at or below: `obj+0x1320 = 1` (second hp stage) |
| +0x0E | s16 | — | 90 | 90 | phase-1 floor; hp re-seated to it on entering phase 2 |
| +0x10 | ptr | — | nested | nested | `SpawnFromDescriptor(tail+0x10)` |

### Class 0x23 tail (its own nested descriptor's)

| off | type | value | reader |
|---|---|---|---|
| +0x00 | u8 | 0x44 | unread — `Class23Init` stores the literal 0x44 at `0x0048FDD9` |
| +0x01 | s8 | 0 / 1 / 2 | `obj+0x130C`, the subtype |
| +0x02 | s16 | 0x38D | unread — `Class23Init` stores the literal 0x38D |
| +0x06 | s16 | 0x31 / 0xCF | despawn cam path (`Class23LieUntilCameraCue`) |
| +0x08 | s16 | 0x190 / 0x8C | despawn frame |

---

## 2. Object fields

`obj+0x194` is the embedded skinned-model record (`char`). `char+0x00`
(`obj+0x194`) is the **clip frame counter**: every class-0x22/0x23 state
increments it itself after drawing (`INC` after `Class22DrawAndPoseSubActor` /
`Class23Draw`), and a state that returns without incrementing holds the pose.
`char+0x08` (`obj+0x19C`) is the play cursor, `char+0x20` (`obj+0x1B4`) the
clip, `char+0x5D` (`obj+0x1F1`) the byte `SkeletonAdvancePlayCursor` sets when
the cursor reaches the play length.

Node records are `obj+0x20C + node*0x90` (`g_skeleton_node_out` while drawing):
`+0x00` the node's draw slot, `+0x28` its matrix, `+0x68..+0x70` its
view-space sphere centre, `+0x78` its extent (`Class23TakeShots` adds it to the
centre's z). So `obj+0x2C4` is node 1's matrix, `obj+0x32C` node 2's slot and
`obj+0x3A4` node 2's extent.

### Class 0x22 (`obj` = the flier)

| offset | meaning | writers |
|---|---|---|
| +0x34 | flags: bit 3 shot this frame, bits 1/2 which player, `0x100` set with every flinch (phase 2: not a shot or camera point while up), `0x40000000` reacting to a hit | TakeShots, FightPhase1/2 |
| +0x3C / +0x120 | hit slot / camera slot (-1 / 0xFF from Init) | Init, Death |
| +0x40..+0x48 | position | every state |
| +0x50 / +0x5C | vertical velocity / acceleration (phase 2 rise, death fall) | FightPhase2, Death |
| +0x64/+0x68/+0x6C | rotation (BAMS) | paths, `Class22FaceCamera` |
| +0x70..+0x78 | view-space shot centre (from `+0x100`) | FightPhase1 tail |
| +0x100..+0x108 | node 1's world point, written by `SkeletonEmitNode` (char types above 0x14 track bone 1) | the draw |
| +0x11C / +0x11E | hit points / maximum (`SpawnFromDescriptor` seeds both from `+0x22`) | RideIn/Descend, TakeShots |
| +0x124 | `g_actor_radius_by_char[0x45]` | Init |
| +0x12EC | per-bone hook = `Class22DrawBonePart` (`model+0x1158`) | Init |
| +0x130C | variant 0..3 | Init |
| +0x1310 | state, **relative** to the variant's table base (§3) | every state |
| +0x1312 | sub-state | every state |
| +0x1320 | hp stage: 1 once hp <= tail+0x0C | Phase1TakeShots; RideIn/Descend clear |
| +0x1324 / +0x1328 | v0: sub-actor clip runs; v1: hint pause on / countdown (0x78) | CutsceneHold, FightPhase1 |
| +0x132C | damage transferred by class 0x23 this frame (s16 read) | `Class23TakeShots` adds; FightPhase1 zeroes every frame |
| +0x1330 | frame counter (ride-in, descent, phase 2, death orbit) | several |
| +0x1334 / +0x1344 | ease frames left / per-frame path-frame step | `Class22EaseToNearestPathKey` |
| +0x1338 / +0x133C | node-2 cycle mode (0/1/2) / its counter | cutscenes, Death; `Class22DrawBonePart` counts |
| +0x1340 | path frame (float) | FightPhase1, pickers |
| +0x1348 | cue counter (float) | FightPhase1 sub 7 |
| +0x1350 | current path index (phase 1: 0..59; phase 2: 0..3); reused as a lerp counter in `Descend` sub 3 | pickers |
| +0x1354 | aggression 0..15, seeded 8 | StepAggression, TakeShots |
| +0x1358 | "a hit was charged this frame" | ChargeShots |
| +0x135C | hits taken by the companion, counted mod 8 | `Class23TakeShots` |
| +0x1360 | companion landed a strike | `Class23FightBesideCompanion` |
| +0x1364 | hits charged on this actor, ever | ChargeShots |
| +0x1368 | strikes the companion has landed | StepAggression |
| +0x136C | taunt latch | StepAggression, FightPhase1 |
| +0x1370 | companion's XZ distance to the camera eye (float) | `Class23FightBesideCompanion` |
| +0x1390 | tail | SpawnFromDescriptor |
| +0x1394 | the companion | RideIn/Descend |
| +0x13B0 | the sub-actor (`ActorAllocSub(0x13F4)`) | Init |
| +0x13C0..+0x13C8 | path target / offset | path evaluators |
| +0x13C0..+0x13D4 | saved camera block eye + target (death only) | Death |

**The sub-actor** (`obj+0x13B0`): char type 0x46, clip 0x10, `+0x34 |= 0x88000`
(bit `0x8000` keeps it out of the shot and push lists), `+0x1350` wanted clip
index, `+0x1354` current clip index (both 1 from Init). No update of its own:
`Class22DrawAndPoseSubActor` seats, clips, draws and advances it.

### Class 0x23 (`obj` = the companion)

| offset | meaning |
|---|---|
| +0x34 | bit 3 shot, bits 1/2 player, `0x8000` frozen after the collapse, `0x10000000` **striking** (class 0x22 waits on it), `0x40000000` reacting |
| +0x130C | subtype 0/1/2 |
| +0x1310 / +0x1312 | state (absolute, §3) / sub |
| +0x131A | strike variant, `rand() & 1` (s8) |
| +0x1320 | hp stage copied from the companion by `Class23LatchCompanionHpStage` |
| +0x1330 | frame counter (subtype 1 entrance) |
| +0x1350 | the sub saved when a companion hit interrupted it |
| +0x1394 | class 0x22 |
| +0x13C0 | x - 50.0, set on entering state 1 (`[open]`: no reader found in the class) |

---

## 3. Dispatch tables (read from memory)

**`g_class22_states`, `0x00598000`**, ten entries:

```
[0] 0049B280 Class22CutsceneHoldUntilChapterCard   [5] 0049C910 Class22Death
[1] 0049B3F0 Class22CutsceneRideAndLeave           [6] 0049CE10 Class22DescendAndJoinFight
[2] 0049B640 Class22RideInAndJoinFight             [7] 0049B850 = [3]
[3] 0049B850 Class22FightPhase1                    [8] 0049C190 = [4]
[4] 0049C190 Class22FightPhase2                    [9] 0049C910 = [5]
0x00598028 = 00000001 (not a pointer); 0x00597FF0..FF: 1, 1, 2, 0 (not pointers)
```

The three updates index it from different bases, so `obj+0x1310` is relative:

| variant | update | `CALL [ECX*4 + …]` | 0 | 1 | 2 | 3 |
|---|---|---|---|---|---|---|
| 0 | `Class22RunFromCutsceneEntrance` `0x0049B260` | `0x598000` | CutsceneHold | RideAndLeave | | |
| 1 | `Class22RunFromRideIn` `0x0049B620` | `0x598008` | RideIn | FightPhase1 | FightPhase2 | Death |
| 2 | `Class22RunFromDescent` `0x0049CDF0` | `0x598018` | Descend | FightPhase1 | FightPhase2 | Death |
| 3 | `Class22PoseUntilCameraCue` `0x0049B5B0` | none | | | | |

That is why `FightPhase1` tests `obj+0x1310 == 2` and `Phase2TakeShots` writes
`obj+0x1310 = 3` for both variants. `Class22Init`'s variant switch is the jump
table `0x0049B248` = `{0x0049B1EB, 0x0049B1FF, 0x0049B21D, 0x0049B231}`.

**Class 0x23:** `g_class23_states_subtype0` `0x00597268` = `{0x0048FEB0
Class23Subtype0Entrance, 0x00490150 Class23FightBesideCompanion, 0x00490B00
Class23Collapse, 0x00490C50 Class23LieUntilCameraCue}`;
`g_class23_states_subtype1` `0x00597278` = `{0x00490D00 Class23Subtype1Entrance,
…same three}`; `g_class23_states_training` `0x00597288` = `{0x00490EB0,
0x00490FD0, 0x00490B00, 0x00490C50}`. `g_class19_states` starts at `0x00597298`.
Here `obj+0x1310` is absolute.

---

## 4. Class 0x22, routine by routine

### `Class22Init` — `FUN_0049B0D0` (handler; called from the task walk once)

```
tail = obj+0x1390                                   ; 0x0049B0DC
g_cur_actor = obj; obj+0x1310 = obj+0x1312 = 0      ; u16
obj+0x3C = -1; obj+0x120 = 0xFF
obj+0x130C = (s8)tail[1]                            ; 0x0049B10A
char type obj+0x1F4 = 0x45                          ; MOV word [EDI+0x60],0x45 @0x0049B113
obj+0x1B4 = (s16)tail[2]
ActorBuildSkinnedModel(obj+0x194, obj+0x40, obj+0x20C)   ; 0x00410440
obj+0x1FC = 5 (byte); obj+0x1F8 |= 4
obj+0x12EC = 0x0049D980  (Class22DrawBonePart)      ; MOV [EDI+0x1158] @0x0049B134
obj+0x194 = (s16)tail[4]
obj+0x124 = g_actor_radius_by_char[0x45]            ; [EDX*4+0x4C4D28]
obj+0x32C = 0x2A9    (node 2's slot)                ; MOV [EDI+0x198],0x2A9 @0x0049B162
obj+0x1338 = obj+0x133C = 0
sub = ActorAllocSub(0x13F4) -> obj+0x13B0; g_cur_actor = sub
sub+0x3C = -1; sub+0x120 = 0xFF; sub+0x1F4 = 0x46; sub+0x1B4 = 0x10
ActorBuildSkinnedModel(sub+0x194, sub+0x40, sub+0x20C)
sub+0x1FC = 5; sub+0x34 |= 0x88000; sub+0x1350 = sub+0x1354 = 1
switch variant (JA past 3 -> return):
  0: Class22RunFromCutsceneEntrance(obj); obj+0 = it
  1: BossIntroBannerSpawn(0x00570EC8); Class22RunFromRideIn(obj); obj+0 = it
  2: Class22RunFromDescent(obj); obj+0 = it
  3: Class22PoseUntilCameraCue(obj); obj+0 = it
```
Increments **no** enemy counter; the flier joins the counters only when its
entrance ends.

### `Class22CutsceneHoldUntilChapterCard` — `FUN_0049B280`, `g_class22_states[0]`

Stage 1 block 0 only. `sub` = the sub-actor. Jump table `0x0049B3DC`.

| sub | code |
|---|---|
| 0 `0x0049B2AC` | pos = (`C3CB0000` -406.0, `43188000` 152.5, `430E6666` 142.4); `obj+0x68 = 0x717F`; `+0x6C = +0x64 = 0`; `obj+0x1324 = 0`; `sub+0x1350 = 2`; sub++ **and fall into 1** |
| 1 `0x0049B2E5` | if `(float)g_cam_path_frame == [0x00570488]` (`428C0000` 70.0): `ActorSetMotionBlended(char, 0x40F, 0, 5)`, `PlaySoundId(0x004317A9)` (`COMMON2\HABATAK1_16`), `obj+0x1324 = 1`, sub++ |
| 2 `0x0049B33F` | pos.x = -406.0, pos.z = 142.4; if cursor == `g_motion_play_length[clip]-1`: `ActorSetMotion(char, [0x00570BE0]=0x40B)`, sub++ |
| 3 `0x0049B373` | if frame == `[0x00570F1C]` (`432A0000` 170.0): `PlaySoundId(0x004517A9)` (`HABATAKI2_16`), sub++; **otherwise return without drawing** (`JZ 0x0049B33B`) |
| 4 `0x0049B395` | `Class22PlaceOnObjectPath(obj, 0x100, (float)g_cam_path_frame)`; if `g_script_flags[0xF8] == 1` (`0x0049B3AA`): `sub+0x1350 = 1`, `obj+0x1310++`, sub = 0, **return without drawing** |

Common tail `0x0049B324`: if `!(g_screen_furniture_flags & 0x20)`:
`Class22DrawAndPoseSubActor(obj)`, `obj+0x194++`. (The chapter card holds bit
`0x20` while it shows; the flier is neither drawn nor advanced under it.)

### `Class22CutsceneRideAndLeave` — `FUN_0049B3F0`, `g_class22_states[1]`

```
if g_active_cam_path == (s16)tail[6] && g_cam_path_frame >= (s16)tail[8]:   ; 0x22, 400
    if obj+0x3C != -1: ActorFreeHitSlot; if obj+0x120 != 0xFF: ReleaseCameraEnemySlot
    ActorKill()                                                              ; 0x004A7040
switch g_active_cam_path:
  0x21: Class22PlaceOnObjectPath(obj, 0x101, frame)
        frame == [0x00570F20] 250.0 (437A0000): blend [0x00570BE2]=0x411 fade 8
        frame == [0x005691CC] 280.0 (438C0000): obj+0x1338 = 1, obj+0x133C = 0,
                                               blend [0x00570BF0]=0x416 fade 3
  0x22: Class22PlaceOnObjectPath(obj, 0x102, frame)
        frame == [0x00570A5C] 180.0 (43340000): obj+0x1338 = 0, PlaySoundId(0x004317A9)
        frame == [0x004C49C8] 240.0 (43700000): blend 0x412 fade 3
  else: return (no draw)
if clip == 0x416 && cursor == len(0x416)-1: blend 0x411 fade 3
if clip == 0x412 && cursor == [0x004E0FF4]-1 (len(0x412)-1): blend 0x411 fade 3
Class22DrawAndPoseSubActor(obj); obj+0x194++
```
`g_cam_path_length[0x22]` is 470, so the tail cue (0x22, 400) is reached in
the shipped block. Counters are never touched.

### `Class22PoseUntilCameraCue` — `FUN_0049B5B0` (variant 3)

`g_cur_actor = obj`; the same tail-cue `ActorKill`; else draw and
`obj+0x194++`. Used only by `advevtbl.bin` (cam path 8, frame 0).

### `Class22RideInAndJoinFight` — `FUN_0049B640`, `g_class22_states[2]` (variant 1)

| sub | code |
|---|---|
| 0 `0x0049B6F6` | `comp = SpawnFromDescriptor(tail[0x10])`; `comp+0x1394 = obj`; `obj+0x1394 = comp`. **Boss Mode** (`g_GameMode == 3`): `ActorSetMotion(char, 0x411)`, `g_script_flags[2] = 1` (`0x0049B726`), pos = (`C483C000` -1054.0, `41F00000` 30.0, `C3EF8CCD` -479.1), yaw `0xC6DD`, `+0x6C = +0x64 = 0`, `obj+0x1330 = 0`, sub = 2, draw, `obj+0x194++`, return. Otherwise sub++ and **fall into 1** |
| 1 `0x0049B777` | `Class22PlaceOnObjectPath(obj, 0x103, (float)g_cam_path_frame)`; `obj+0x68 = 0xC6DD`; frame == `[0x00570F2C]` 310.0 (`439B0000`): blend 0x411 fade 8; frame == `[0x00570F28]` 410.0 (`43CD0000`): `obj+0x1338 = 1`, `+0x133C = 0`; frame == `[0x00570F24]` 591.0 (`4413C000`): `obj+0x1338 = 0`; **int** `g_cam_path_frame == [0x00576DF4]` (`g_cam_path_length[0x2F]` = 830): `g_script_flags[2] = 1` (`0x0049B809`), pos = (-1054.0, 30.0, -479.1), sub++, `obj+0x1330 = 0` |
| 2 `0x0049B672` | `obj+0x1330++`; while below `[0x00576DF8]` (`g_cam_path_length[0x30]` = 300) just draw. Then: `obj+0x11C = (s16)tail[0xA]`; `obj+0x1320 = 0`; **`BossHpBarSpawn(320.0 (43A00000), 35.0 (420C0000))`** at `0x0049B6A8`; `INC g_enemies_present` `0x0049B6B4`; `INC g_enemies_alive` `0x0049B6BB`; blend `[0x00570BE4]`=0x410 fade 3; **`g_boss_engaged = 1`** `0x0049B6CF`; `obj+0x1310++`; sub = 0; draw; `obj+0x194++` |

Every path ends `Class22DrawAndPoseSubActor` + `obj+0x194++`. Note the
comparisons: 310/410/591 are `FILD; FCOMP` equality on the camera frame, the
hand-over at 830 is an integer compare, and none of them tests the camera
path. `g_script_flags[2]` is the flag `g_class22_intro_banner` waits on, so
the banner's 300 frames run in parallel with sub 2's 300.

### `Class22DescendAndJoinFight` — `FUN_0049CE10`, `g_class22_states[6]` (variant 2)

Jump table `0x0049D16C`.

| sub | code |
|---|---|
| 0 `0x0049CE3E` | `comp = SpawnFromDescriptor(tail[0x10])`, cross-link `+0x1394`; sub++; fall into 1 |
| 1 `0x0049CE5D` | `Class22PlaceOnObjectPath(obj, 0x17F, (float)frame)`; `obj+0x68 += 0x8000` (dead: the tail's `Class22FaceCamera` overwrites it); int frame == `[0x00577070]` (`g_cam_path_length[0xCE]` = 445): sub++, `obj+0x1330 = 0` |
| 2 `0x0049CEA9` | `n = ++obj+0x1330`; n == 120 or 400: `obj+0x1338 = 1`, `+0x133C = 0`; n == 380 or 560: `obj+0x1338 = 0`; n == 600: `+0x1338 = 1`, `+0x133C = 0`, blend 0x412 fade 3. Then if clip == 0x412 && cursor == len(0x412)-1: blend 0x411 fade 8; `Class22EvalObjectPathOffset(obj, 0x104, 0.0)`; `obj+0x13C0 = T(comp.pos) RotY(comp.yaw + 0x8000) · obj+0x13C0`; sub++; `obj+0x1350 = 0` |
| 3 `0x0049D005` | `obj+0x1330++`; pos = `LerpWeighted(pos, obj+0x13C0, 1, 60 - obj+0x1350)` per axis; `k = obj+0x1350++`; if k > 60: pos = `obj+0x13C0`, sub++, `obj+0x1350 = 0` |
| 4 `0x0049D0C4` | `if (++obj+0x1330 == 840)`: `obj+0x11C = tail[0xA]`, `obj+0x1320 = 0`, **`BossHpBarSpawn(320.0, 35.0)`** `0x0049D0F8`, `INC g_enemies_present` `0x0049D104`, `INC g_enemies_alive` `0x0049D10B`, blend 0x410 fade 3, `obj+0x1310++`, `+0x1330 = 0`, sub = 0 |

Tail `0x0049D133`: `Class22FaceCamera(x, z, eye.x, eye.z, &obj+0x68)`, draw,
`obj+0x194++`. **Variant 2 never writes `g_boss_engaged`** (the only writers in
the class are `0x0049B6CF` and `0x0049D507`; byte search `eaa09c00`).

### `Class22FightPhase1` — `FUN_0049B850`, `g_class22_states[3]/[7]`

The companion is `comp = obj+0x1394`. Head:

```
if variant == 1 && obj+0x1324:                          ; hint pause
    old = obj+0x1328; obj+0x1328 = old - 1
    if old <= 0: obj+0x1324 = 0; g_bHudShutterState = 1     ; 0x0049B899
Class22StepAggression(obj); Class22Phase1TakeShots(obj)
if (s16)obj+0x1310 == 2: return            ; phase 2 was entered; skip the tail
obj+0x132C = 0
switch sub (jump table 0x0049C158; > 13 -> tail)
```

`f` = `obj+0x1340`, `P` = `obj+0x1350`, `end`/`key` =
`g_class22_path_keys[P % 33]` (`+0` / `+4`), `ride` =
`Class22EvalObjectPathOffset(obj, 0x104 + P, f)`,
`react` = `obj+0x34 & 0x40000000`, `done` = `char+0x5D` (`obj+0x1F1`).

| sub | entry | code |
|---|---|---|
| 0 | `0x0049B8DE` | zero `+0x132C +0x1328 +0x1324 +0x1350 +0x1358 +0x135C +0x1360 +0x1364 +0x1368 +0x136C +0x1340`; `+0x1354 = 8`; `Class22PickPhase1Path`; ride; sub++; fall into 1 |
| 1 | `0x0049B953` | if react: nothing. ride; `f += g_class22_path_speed[GetDamageRank() + 16*obj+0x1320]`. If `comp+0x1312 == 2` (companion mid-strike): `f < end` → `Class22EaseToNearestPathKey`, sub = 5, `+0x136C = 0`; else `obj+0x34 &= 0xBFFFFEFF`, `Class22PickCompanionStrikePath`, sub = 7, `+0x136C = 0`. Otherwise `f >= end` → `Class22PickPhase1Path` |
| 2 | `0x0049BA31` | ride; cursor == len-1: `obj+0x34 &= ~0x40000000`, blend 0x410 fade 3, `Class22EaseToNearestPathKey`, sub = 3 |
| 3 | `0x0049BA97` | `obj+0x1334 <= 0` → `Class22PickPhase1Path`, sub = 4. Else ride at `f`, `+0x1334--`, `f += obj+0x1344` |
| 4 | `0x0049BAE4` | ride; `!(comp+0x34 & 0x40000000)` → sub = 1, `obj+0x34 &= ~0x100` |
| 5 | `0x0049BB29` | if react: nothing. `+0x1334 == 0` → `obj+0x34 &= 0xBFFFFEFF`, `Class22PickCompanionStrikePath`, `+0x1348 = 0`, sub = 7. Else as sub 3's glide |
| 6 | `0x0049BB7D` | ride; done && react → clear react, blend 0x410 fade 3, sub = 3 |
| 7 | `0x0049BBDC` | if react: nothing. `+0x1348 == g_class22_cue_frames[+0x1320]` (15.0 / 1.0) → blend `g_class22_cue_motions[+0x1320]` (0x413 / 0x414) fade 3 and voice `0x20000085` (`ST1\30_ZE.WAV`, v1) / `0x20000192` (`ST5\337_ZE.WAV`, v2). Clip is that cue motion at len-1 → blend 0x410. ride; `f += (+0x1320 ? 1.3 (0x00565EEC) : 1.0 (0x004C4380))`; `f >= end` → `Class22PickPhase1Path`, sub = 10. `+0x1348 += 1.0` |
| 8 | `0x0049BCFD` | ride; done && react → clear react, blend 0x410, sub++ (9) |
| 9 | `0x0049BD4A` | `f < end` → ride at `f`, `f += 2.0` (`0x004E30F0`); else `Class22PickPhase1Path`, sub = 4 |
| 10 | `0x0049BD80` | ride; wait while `comp+0x34 & 0x10000000` (companion striking). Then `obj+0x34 &= ~0x100`; `+0x136C == 0` → sub = 1. Else **taunt**: blend `[0x00570BEC]`=0x40E fade 3, sound `0x003018A9` (`STAGE1_SE\WARAI_22`, v1) / `0x003323A9` (`STAGE5_SE\WARAI_22`, v2), `+0x136C = 0`, `Class22PickTauntPath`, sub = 11; **variant 1 and `+0x1364 == 0`** (never hit): `+0x1368 == 1` → `+0x1324 = 1`, `+0x1328 = 0x78`, `g_bHudShutterState = 5` (`0x0049BE49`), `EvtOpPlayDialogue2D(0x1B)` (*"Is he invincible?"*); `+0x1368 == 2` → same with `0x0049BE7B` and line `0x1C` (*"The small one must be the brain!?"*) |
| 11 | `0x0049BE8F` | if react: nothing. clip 0x40E at len-1 → blend 0x410. ride; `f += 1.0`; `f >= end` → blend 0x410, `Class22PickPhase1Path`, sub = 1 |
| 12 | `0x0049BF45` | ride; done && react → clear react, blend 0x410, sub++ (13) |
| 13 | `0x0049BFA0` | as 9 |

Tail `0x0049C003` (past the `MatrixStackPop` at `0x0049C093` Ghidra stops at):

```
Class22FaceCamera(x, z, eye.x, eye.z, &obj+0x68)             ; yaw from the OLD position
push; identity; T(comp.pos); RotY(comp+0x68 + 0x8000)
pos = M · obj+0x13C0; pop                                   ; the flier rides the companion's frame
g_boss_hp_fraction = (float)obj+0x11C / (float)obj+0x11E     ; FSTP [0x009C8E10] @0x0049C0B7
Class22DrawAndPoseSubActor(obj); obj+0x194++
push; SetTop(g_camera_world_to_view[g_camera_index]); obj+0x70..78 = M · obj+0x100; pop
obj+0x34 &= 0xFFFFFFF1
RegisterForShotTest(obj)                                    ; 0x00405160, never a camera candidate
```

### `Class22Phase1TakeShots` — `FUN_0049D220`

Gate: `(sub - 1)` through the byte table `0x0049D498` =
`00 01 01 01 00 01 00 01 01 01 00` into `{0x0049D253 run, 0x0049D48C return}`
— it runs only in **subs 1, 5, 7 and 11**; sub 0 and 12–13 return.

```
obj+0x11C -= (s16)obj+0x132C
if (obj+0x34 & 8) && !(obj+0x34 & 0x40000000):
    Class22ChargeShots(obj)
    if hp > (s16)tail[0xE]:
        if obj+0x1320 == 0 && hp <= (s16)tail[0xC]: obj+0x1320 = 1
        obj+0x34 |= 0x40000100
        blend g_class22_flinch_motions[rand() & 1] fade 3         ; 0x408 / 0x409
        PlaySoundId(v1 0x002A18A9 SMALL_BOSS_4 st1 | v2 0x002F23A9 st5)
        sub++; return                                            ; no draw here
    -> PHASE CHANGE
else if hp > tail[0xE]: return
PHASE CHANGE: obj+0x34 |= 0x40000100; flinch as above; sound as above
    obj+0x1310++ (relative 2); sub = 0
    Class22FaceCamera(...); obj+0x11C = tail[0xE]
    g_boss_hp_fraction = hp / max                                ; 0x0049D478
    Class22DrawAndPoseSubActor(obj); obj+0x194++
```

The transferred damage (`+0x132C`) lands only in subs 1, 5, 7, 11; in every
other sub `FightPhase1` zeroes it unused.

### `Class22FightPhase2` — `FUN_0049C190`, `g_class22_states[4]/[8]`

Head: clamp `+0x1354` into 0..15; `Class22Phase2TakeShots`; relative state 3 →
return. `n` = `obj+0x1330`, `P` = `obj+0x1350`, `cam(p, t)` =
`Class22EvalCameraRelativePath(obj, 0x140 + p, t)`,
`pick` = `rand() % 10` then `P = g_class22_phase2_picks[g_class22_phase2_pick_rows[aggr]*10 + that]`,
`lerp(k)` = pos = `LerpWeighted(pos, obj+0x13C0, 1, k)` per axis. Jump table
`0x0049C8DC`; `ECX = 0x3E19999A` (0.15) is loaded for every arm.

| sub | code |
|---|---|
| 0 `0x0049C1F7` | `n = 0`; `obj+0x5C = 0.15`; `obj+0x50 = 0`; sub++; fall into 1 |
| 1 `0x0049C20A` | `obj+0x50 += obj+0x5C`; `y += obj+0x50`; `y >= [0x00564420]` 60.0: `+0x5C = 0.15`, `+0x50 = 0`, `n = 0`, pick, `cam(P, 0.0)`, sub++ |
| 2 `0x0049C28A` | `lerp(60 - n)`; `if (n++ > 60)`: snap to `+0x13C0`, blend `[0x00570BEE]`=0x40D fade 3, `obj+0x34 &= ~0x40000000`, `RegisterEnemySlot(obj)` `0x0049C347`, `n = 0`, sub = 7 |
| 3 `0x0049C363` | `cam(P, (float)n)`; pos = `+0x13C0`; `++n`; `n == g_cam_path_length[0x140+P] - 5` (`[P*4 + 0x577238]`): **strike** — `g_active_player` 0 → `PlayerTakeDamage(0, 1, 7)`; 1 → `(1, 1, 7)`; 2 → both; `+0x1354 += 4` (also for -1, with no damage). Else `n > length`: `n = 0`, pick, `cam(P, 0.0)`, sub = 5 |
| 4 `0x0049C47E` | `n = 0`, then sub 6's code |
| 5 `0x0049C4A1` | `lerp(60 - n)`; `if (n++ > 60)`: snap, blend `[0x00570BF0]`=0x416 fade 3, `n = 0`, sub = 7 |
| 6 `0x0049C484` | `cam(4, 0.0)` (path 0x144); sub = 9 |
| 7 `0x0049C568` | if `g_active_player >= 0` and `n++ >= 100`: blend `[0x00570BE6]`=0x40C fade 3, clear `0x100` if set, `n = 0`, sub = 3, `PlaySoundId(0x004317A9)` |
| 8 `0x0049C5CF` | blend 0x40D fade 3; `obj+0x34 &= 0xBFFFFEFF`; `n = 0`; `cam(4, 0.0)`; sub = 10 |
| 9 `0x0049C60F` | `lerp(60 - n)`; `if (n++ > 60)`: snap, blend 0x40D, sub++ (10), clear `0x40000100`, `n = 0` |
| 10 `0x0049C6E0` | `cam(4, (float)n)`; pos = it; `if (n++ > 60)`: blend 0x40C fade 3, `obj+0x34 |= 0x40000100`, then 11's tail |
| 11 `0x0049C745` | blend 0x40C fade 3; `n = 0`; pick; `cam(P, 0.0)`; sub = 12 |
| 12 `0x0049C7B4` | `lerp(10 - n)`; `if (n++ > 10)`: snap, `n = 0`, `obj+0x34 &= 0xBFFFFEFF`, sub = 3 |

Tail `0x0049C869`: `Class22FaceCamera`; `g_boss_hp_fraction = hp/max`
(`0x0049C8A6`); draw; `obj+0x194++`; `obj+0x34 &= 0xFFFFFFF1`; if
`!(obj+0x34 & 0x100)`: `ActorRegisterCameraPoint(2.0 (40000000))` at
`0x0049C8CE` (shot list **and** camera candidate). Phase 1's `0x40000100` is
still up when phase 2 begins; sub 2 clears only `0x40000000`, so the flier is
out of the shot list until sub 7 hands to sub 3.

### `Class22Phase2TakeShots` — `FUN_0049D4B0`

Jump table `0x0049D61C` on `sub - 3` = `{run, ret, run, ret, run, ret, run,
run}` — runs in **subs 3, 5, 7, 9, 10**; and only when `obj+0x34 & 8` and not
`0x40000000`.

```
last = Class22ChargeShots(obj)
if hp <= 0:
    g_boss_engaged = 0                                          ; 0x0049D507
    ScoreAddForPlayer(last == 2 ? rand() & 1 : last, 0x5DC)     ; 1500
    BossModeRecordGrade()                                       ; 0x00425F40
    blend g_class22_flinch_motions[rand() & 1] fade 3
    PlaySoundId(v1 0x002818A9 SMALL_BOSS_13 st1 | v2 0x002D23A9 st5)
    obj+0x1310 = 3; obj+0x34 |= 0x40000100; sub = 0
    Class22DrawAndPoseSubActor(obj); obj+0x194++; return
obj+0x34 |= 0x40000100; flinch; SMALL_BOSS_4 sound; sub++; obj+0x1354 -= 2
```

`last` is -1 when bit 3 was up with no part code; the engine then pays player
-1 (`MOVSX EAX, AX`). `[open]` whether that can happen.

### `Class22ChargeShots` — `FUN_0049D640`

```
last = -1
for p in 0, 1:                                   ; rec = 0x009A224C + p*0x14
    bit = 1 << (p+1); part = 0
    if (obj+0x34 & bit) && (part = (s8)obj+0x190[p]) != 0:
        last = last + p + 1                      ; 0, 1, or 2 for both
        ScoreAddForPlayer(p, part == 2 ? 0x78 : 0x0A)    ; 120 / 10
        SpawnBoneHitSprite(obj, part)                    ; 0x00407200
        dmg = (g_active_player != 2) ? 30 : 25           ; SUB 2; NEG; SBB; AND 5; ADD 0x19
        if g_GameMode == 1:                              ; Original Mode
            f = (float)dmg; f = (*rec == -1.0f) ? f + f : f * *rec; dmg = __ftol(f)
        obj+0x11C -= dmg; obj+0x1358++; obj+0x1364++
    obj+0x190[p] = 0
    part_record(part).flags (obj+0x280 + part*0x90) &= ~bit & ~8   ; part 0's when none
return (s16)last
```

`0x009A224C` is `g_original_item_slots + 0x0C`, a per-player Original Mode
float `[likely]` the weapon's damage multiplier (`-1.0` doubles).

### `Class22StepAggression` — `FUN_0049D180`

```
if +0x1358: +0x1358 = 0; +0x1354 -= 1
if +0x135C >= 8: +0x1354 += 1; +0x135C -= 8
if +0x1360: +0x1354 += 3; +0x1360 = 0; +0x1368 += 1; +0x136C = 1
clamp +0x1354 to 0..15
```

### `Class22Death` — `FUN_0049C910`, `g_class22_states[5]/[9]`

```
if g_active_cam_path == tail[6] && g_cam_path_frame >= tail[8]: ActorDespawn(obj); return
Class22DrawAndPoseSubActor(obj)                  ; draws BEFORE the switch
switch sub (jump table 0x0049CDCC)
```

| sub | code |
|---|---|
| 0 `0x0049C970` | `g_boss_hp_fraction = 0` (`0x0049C974`); `NoOpStub(obj, 2)`; `SpawnBoneHitSprite(obj, 2)`; `DEC g_enemies_alive` `0x0049C98E`; `DEC g_enemies_present` `0x0049C995`; release camera/hit slots of obj **and of the sub-actor**; sub++; `+0x1330 = 0`; fall into 1 |
| 1 `0x0049C9F9` | `obj+0x194++`; if `g_camera_free == 1`: `g_bHudShutterState = 5` (`0x0049CA16`), `ActorSetMotion(char, [0x00570BE8]=0x40A)`, sub++; v1: pos = (`C4854666` -1066.2, `42200000` 40.0, `C3F5199A` -490.2); v2: y = 40.0, z < `[0x00570F48]` -1238.0 → -1238.0 (`C49AC000`), z > `[0x00570F44]` -1180.0 → -1180.0 (`C4938000`) |
| 2 `0x0049CA99` | `+0x1330 = 0`; **`[0x009CA094] = 1`** (`0x0049CAAD`); save `g_camera_block_eye` → `+0x13C0..C8`, `g_camera_block_target` → `+0x13CC..D4`; sub++; into 3 |
| 3 `0x0049CAF3` | `obj+0x194 >= 0x1C`: v1 `EvtOpPlayDialogue2D(0x1D)` (*"Sir Go-l-d..."*, `ST1\33_ZEA.WAV`); `+0x1338 = 2`; `+0x50 = +0x5C = 0`; sub++. `obj+0x194++` |
| 4 `0x0049CB2D` | `obj+0x194 < 0x84` → ++. If `g_camera_fixed_eye_y + 7.4 ([0x00570F40] 40ECCCCD) < y`: `+0x5C -= [0x00570F38]` (double 1.3611111e-4), `+0x50 += +0x5C`, `y += +0x50`. Else: `obj+0x194 < 0x8D` → `y = ground + float[0x00570C78 + obj+0x194*4]`; `if (++obj+0x194 == 0x92)`: `ActorAlloc(Class22ImpactFlipbookUpdate, 0x13F4)` at pos with `+0x1320 = 0`, `PlaySoundId(0x002A16A9)` (`COMMON\ENE_WALK7_22`); `obj+0x194 == g_motion_play_length[clip]` → sub++, `+0x1338 = 0`. Then either way `y = max(y, ground + 1.1 ([0x00570F30]))` |
| 5 `0x0049CC14` | `+0x1330 >= 300`: `[0x009CA094] = 0`; **Arcade only** (`g_GameMode == 0`): restore `g_camera_block_eye/target` from `+0x13C0..D4`; v1: **`g_script_flags[3] = 1`** (`MOV byte [0x009C7203],1` at `0x0049CC95`); v2: **`g_script_flags[0] = 1`** (`MOV byte [0x009C7200],1` at `0x0049CC85`); sub++ |
| ≥ 6 | nothing (drawn each frame until the tail cue) |

After the switch, for `2 <= sub <= 5` (sub read **after** the switch):

```
+0x1330++
push; identity; T(pos); RotY(obj+0x68 + obj+0x1330*8)
g_camera_block_eye    = M · (10.0 (41200000), 0, -20.0 (C1A00000))
g_camera_block_target = M · (0, 0, 0)
g_camera_block_eye.y  = v1 30.0 (41F00000) | v2 -32.6 (C2026666)
pop
CamBlockSetAnglesFromLookAt(&g_camera_block_eye, &g_camera_block_target, 0)   ; 0x0049CDBC
```

`[0x009CA094]` is unnamed; `CameraDriverSelectMode` (`0x004026AB`) forces
`g_camera_mode` 6 (`PoseHookNone`, the camera stops) while it is 1, which is
what lets this routine write the camera block by hand.

`g_class22_landing_bounce` (`0x00570E88`) is `float[0x00570C78 + frame*4]` at
frames `0x84..0x8C`: 7.4 6.6 4.55 4.0 3.1 2.8 2.4 1.8 1.3. The counter is
held at `0x84` while falling and sub 4 starts with it at `0x1D` (reset to 0 by
`ActorSetMotion(0x40A)` in sub 1, counted through sub 3), so it reaches `0x84`
after 103 frames. The fall from y 40 is `a·n(n+1)(n+2)/6` with
`a = 1.3611e-4`: to `ground + 7.4` it takes about **122 frames in stage 1**
(ground -8.31, `set_ground_plane_y 0x0097D394` in block 14) and about **166 in
stage 5** (ground -70.9, `0x0097889C` in block 1), so both land on index
`0x84` = exactly 7.4 — arithmetic on shipped data, not a claim about the
routine. A landing before `0x84` would index `g_class22_path_keys` and
`g_class22_path_speed` as floats; the port should transcribe the base
arithmetic over the bytes `0x00570C78..0x00570EAB`, not a nine-entry table.

The stage-1 tail cue (path 0x31, frame 400) is never reached: `g_cam_path_length[0x31]` is 230
and the block plays 0x31 over frames 0..0xE6, so the corpse stays in the pool
until the stage ends. Stage 5's (0xCF, 140) is.

### `Class22DrawAndPoseSubActor` — `FUN_0049D770`

Called by every state; **not** an advance (the old name said so).

```
LightsUseSecondarySet()                                   ; 0x0041DC70
g_cur_actor = obj
DrawSkinnedModelAndShadow(obj+0x194, obj+0x40, obj+0x20C) ; 0x00411090: pose, root motion, obj+0x100
sub = obj+0x13B0
push; SetTop(g_camera_blocks[g_camera_index])            ; 0x009A6040 + idx*0x1A4, view->world
MatrixMultiply(obj+0x2C4)                                  ; node 1's matrix
MatrixGetTranslation(&sub+0x40)
MatrixToEulerZYX(&sub+0x64, &sub+0x68, &sub+0x6C); pop
g_cur_actor = sub
DrawSkinnedModelAndShadow(sub+0x194, sub+0x40, sub+0x20C)
switch variant (jump table 0x0049D968):
  0: if sub+0x1354 != sub+0x1350: ActorSetMotion(subchar, g_class22_subactor_motions[sub+0x1350]); sub+0x1354 = sub+0x1350
     if obj+0x1324: subchar+0 ++
  1, 2: if (s16)obj+0x11C > 0:
          s = g_class22_path_speed[GetDamageRank() + 16*obj+0x1320]
          sub+0x1350 = s > 2.5 ? 4 : s > 2.0 ? 3 : s > 1.5 ? 2 : s > 1.0 ? 1 : 0   ; doubles 0x00569160 0x0055CAF8 0x0055D7D0 0x004ECB70
          re-clip as in 0; subchar+0 ++
  3: subchar+0 ++
LightsRestoreScene(); g_cur_actor = obj
```

`g_class22_path_speed` spans 0.8..2.0, so the shipped range of `+0x1350` is 0..3.

### `Class22DrawBonePart` — `FUN_0049D980` (per-bone hook, `model+0x1158`)

```
rec = g_skeleton_node_out + node*0x90; a = g_cur_actor
if node == 2:
    a+0x133C++
    slot = a+0x1338 == 1 ? 0x2A5 + g_class22_node2_cycle_a[a+0x133C % 10]
         : a+0x1338 == 2 ? 0x2A5 + g_class22_node2_cycle_b[a+0x133C % 6]
         : rec[0]
else slot = rec[0]
AssetDrawSlot(slot)
if rec[0] == 0x2BB:                                   ; node 1's slot
    push; Translate(-0.778 (BF47381D), 1.49 (3FBEAB36), 0)
      RotZ(trunc(9102 * a[0x3C8] / 26396)); RotX(trunc(21845 * a[0x3C0] / 32768)); AssetDrawSlot(0x2B5); pop
    push; Translate(+0.778 (3F47381D), 1.49, 0)
      RotZ(trunc(9102 * a[0x578] / 26396)); RotX(trunc(21845 * a[0x570] / 32768)); AssetDrawSlot(0x2B4); pop
```

`a[0x3C0]/a[0x3C8]` are node 3's record words `+0x04/+0x0C`, `a[0x570]/a[0x578]`
node 6's (`[likely]` rotations the sampler wrote). The divide is the magic
`0x9EE633C1` with `SAR 14`, i.e. by 26396; the other is `x*21845 >> 15` with
round-to-zero. Render-only.

### Helpers

| routine | code |
|---|---|
| `Class22PlaceOnObjectPath` `0x0049DB40` | `CamEvalObjectPath6(slot, frame, &p)`; pos = p.xyz; `+0x64/+0x68/+0x6C` = p.rx/ry/rz |
| `Class22EvalObjectPathOffset` `0x0049DB90` | `+0x13C0 = p.x`, `+0x13C4 = p.y - 3.0 (0x004C49C0)`, `+0x13C8 = p.z` |
| `Class22EvalCameraRelativePath` `0x0049DBE0` | `+0x13C0 = T(g_camera_eye) RotY(g_camera_yaw_bams + 0x8000) T(0, 0, -10.0 (C1200000)) · p` |
| `Class22PickPhase1Path` `0x0049DC90` | `r1 = rand()`; `near = +0x1370 <= 60.0` (double `0x00570F50`); `hot = r1%100 >= g_class22_aggression_roll[+0x1354]`; `r2 = rand()%10`; `P = g_class22_phase1_path_picks[(near + 2*hot)*10 + r2]`; `r3 = rand()&1`; `+0x1340 = 0`; `+0x1350 = P + 33*r3`. **Three draws in that order.** |
| `Class22PickCompanionStrikePath` `0x0049DD30` | `+0x1340 = 0`; `+0x1350 = 27 + rand()%3` |
| `Class22PickTauntPath` `0x0049DD60` | `+0x1340 = 0`; `+0x1350 = 30 + rand()%3` |
| `Class22EaseToNearestPathKey` `0x0049DD90` | `f < key`: `key*0.5 > f` → step `f * -0.05` (toward 0) else `(key - f) * 0.05`; `f >= key`: `(key+end)*0.5 > f` → `(f - key) * -0.05` else `(end - f) * 0.05`; `+0x1334 = 20` (0.5 `0x004C43AC`, -0.05 `0x0056B180`, 0.05 `0x0055CBB8`) |
| `Class22FaceCamera` `0x0049DE60` | `(x, z, ex, ez, &out)`: `VecToAngles(x-ex, 0, z-ez, &_, &yaw)`; `*out = yaw & 0xFFFF` |
| `Class22ImpactFlipbookUpdate` `0x0049DEA0` | draws slot `0x94 + frame` (common.bin 25..39) at pos; `frame++`; `ActorKill` after 14 |

Phase-1 object paths are `0x104 + P`, `P` in 0..59 — `op_st1` slots 0x104..0x13F,
where `P` and `P + 33` share a `g_class22_path_keys` row. Phase-2 paths are
0x140..0x143 and 0x144.

---

## 5. Class 0x23, routine by routine

### `Class23Init` — `FUN_0048FD90`

```
g_cur_actor = obj; +0x1310 = +0x1312 = 0; +0x3C = -1; +0x120 = 0xFF
+0x130C = (s8)tail[1]
char type 0x44 (0x0048FDD9); clip 0x38D (0x0048FDDF); ActorBuildSkinnedModel
+0x1FC = 1; +0x1F8 |= 4; +0x124 = g_actor_radius_by_char[0x44]
+0x32C = 0 (node 2's slot); +0x3A4 = 0 (node 2's extent)       ; node 2 is neither drawn nor shootable
INC g_enemies_present 0x0048FE16; INC g_enemies_alive 0x0048FE1D
+0x121 = 0xFF; +0x131D = 0xFF; RegisterEnemySlot(obj); +0x1320 = 0
subtype 0/1/2 -> run and install Class23UpdateSubtype0/1/2
```

So the companion holds `g_enemies_alive` from the flier's sub 0 onward; that
is what holds `wait_enemies_alive 0` shut before the flier joins.

### `Class23Subtype0Entrance` — `FUN_0048FEB0` (stage 1)

Jump table `0x0049013C`.

| sub | code |
|---|---|
| 0 `0x0048FEDE` | Boss Mode: `ActorSetMotion(0x38D)`, pos = (`C482599A` -1042.8, `g_camera_fixed_eye_y`, `C3EDD99A` -475.7), yaw 0xC6DD, sub = 4, draw, ++, return. Else **return undrawn** while `g_active_cam_path == 0x2F && g_cam_path_frame < 0x203`; then pos = (`C484A000` -1061.0, ground, `C3EE0000` -476.0), yaw 0xC6DD, sub++, into 1 |
| 1 `0x0048FF82` | path 0x2F and frame `>= 0x259`: blend 0x386 fade 2, sub++, draw, ++, return |
| 2 `0x0048FFC8` | cursor 0x32: sound `0x000018A9` (`STAGE1_SE\AXE_44K`) / subtype 1 `0x002423A9`. cursor 0x46: `ActorAlloc(Class23LandingRingUpdate, 0x13F4)` at pos with `+0x1320 = 1`, `g_screen_shake_frames = 0x30`, sounds `0x002316A9` (`DOORKICK3_22K`) and `0x002B16A9` (`GRASS1_22`). cursor `== len - 0x19`: blend 0x38E fade 5, sound `0x000417A9` (`COMMON2\ZOMBIE_007_16`), sub++, draw, ++, return |
| 3 `0x0049008F` | path 0x2F and frame `== g_cam_path_length[0x2F]` (830): `ActorSetMotion(0x38D)`, pos = (-1042.8, ground, -475.7), sub++, draw, ++, return |
| 4 `0x004900E8` | `comp+0x1310 == 1`: `+0x13C0 = pos - (50.0 (0x0055D2AC), 0, 0)`, state 1, sub 0 |

Tail: `Class23Draw`, `obj+0x194++`.

### `Class23Subtype1Entrance` — `FUN_00490D00` (stage 5)

Jump table `0x00490E74`. Sub 0: **undrawn** while path 0xCE and frame < 0xB4;
then pos = (`44120000` 584.0, `C28DCCCD` -70.9, `C4924000` -1170.0), yaw 0x8000,
into 1. Sub 1: frame `== [0x00577070]` (445): sub++, `+0x1330 = 0`, draw, ++.
Sub 2: `+++0x1330 == 700` → blend 0x38E fade 2, sound 0x000417A9; clip 0x38E at
`[0x004E0EEC]-1` → blend 0x38D fade 10, sub++, draw, ++. Sub 3 as subtype 0's
sub 4.

### `Class23FightBesideCompanion` — `FUN_00490150`, state 1

```
d = |(x, z) - (eye.x, eye.z)|;  comp+0x1370 = d                 ; FSTP [EBX+0x1370] @0x0049018A
g_cur_actor = obj; Class23TakeShots(obj)
if comp.hp <= obj.hp:                                             ; JG @0x004901AC
    DEC g_enemies_alive (0x004901AE); blend 0x38A fade 3; state 2; sub 0
    Class23Draw; +0x194++; +0x34 &= ~8; RegisterForShotTest; return
if (comp+0x34 & 0x40000000) && !(obj+0x34 & 0x40000000):
    obj+0x34 |= 0x40000000; blend g_class23_motion_ids[0x18/2 + stage] fade 3   ; 0x388 / 0x389
    +0x1350 = sub; sub = 6
switch sub (jump table 0x00490924, 7 entries)
```

`stage` = `obj+0x1320`; `rec` = `g_class23_strikes[stage + 2*obj+0x131A]`;
`walkfx(frame)` = if `g_screen_shake_frames == 0` → `= 0x18`; sound
`0x000218A9` (`BOS_WALK1_44`, subtype 0) / `0x002523A9` (subtype 1).

| sub | code |
|---|---|
| 0 `0x0049025A` | `+0x131A = rand() & 1`; blend walk `[0x005703C4 + stage*2]` (0x393/0x394) fade 5; sub++; into 1 |
| 1 `0x00490294` | `Class22FaceCamera`; clip 0x393 at cursor 0x37/0x81/0xCF/0x11A (byte table `0x00490A08` from 0x37) or 0x394 at 0x2D/0x67/0xA7/0xE1 (table `0x00490948` from 0x2D): walkfx. If `d <= rec.range` and not reacting: blend `rec.motion` fade 5, walkfx, sub++, `obj+0x34 |= 0x10000000` |
| 2 `0x004903CE` | cursor == `rec.soundFrame` and not reacting: sound `0x000018A9` / `0x002423A9` (AXE). cursor == `rec.hitFrame` and not reacting: `comp+0x1360++`; `g_active_player` 0 → `PlayerTakeDamage(0, 1, rec.motion)`; 1 → `(1, …)`; 2 → both; else nothing. `char+0x5D` set: `obj+0x34 &= ~0x10000000`; blend `[0x005703CC+stage*2]` (0x390/0x391) from `[0x00570414+stage*2]` (28/23) fade 5; sub++ |
| 3 `0x00490546` | clip 0x390 at 0x4B/0xA6 or 0x391 at 0x3C/0x84: shake, sound `0x000418A9`/`0x002723A9` (BOS_WALK3). `d >= 70.0 (0x00570488)` and not reacting: blend `[0x005703D0+stage*2]` (0x38E/0x38F) fade 5, sound 0x000417A9, sub++ |
| 4 `0x004905FD` | clip 0x38E at cursor 0x72, or 0x38F at 0x5B: sub++ |
| 5 `0x0049063C` | `g_active_player >= 0`: `+0x131A = rand() & 1`; `Class23LatchCompanionHpStage`; blend walk from `[0x00570410+stage*2]` (175/141) fade 15; sub = 1 |
| 6 `0x0049068E` | clip 0x388 at 0x39/0x5A or 0x389 at 0x2F/0x48: shake + BOS_WALK3 sound. clip 0x38B at 0x0F/0x1E/0x28 or 0x38C at 0x0D/0x18/0x1E: sound `0x003C16A9` (`SWORD11_22`). clip 0x388/9 at len-1 → blend 0x38B/0x38C fade 5. clip 0x38B/C at len-1: `obj+0x34 &= ~0x40000000`; saved sub (jump table `0x00490AEC`): 1 or 5 → blend `[0x005703C0 + (stage + saved*2)*2]` fade 5, sub = saved; 2 or 3 → `obj+0x34 &= ~0x10000000`, blend 0x390/0x391 from `[0x00570418+stage*2]` (60/49) fade 20, sub = 3; 4 → blend walk fade 5, sub = 1 |

Tail `0x0049085F`: arena clamp — subtype 0: `x < -1040` → -1040
(`[0x00570478]`, `C4820000`); `z > -462` → -462 (`0x00570474`); `z < -500` →
-500 (`0x00570470`); subtype 1: `x < 550` → 550 (`0x00570484`, `44098000`);
`x > 610` → 610 (`0x00570480`, `44188000`); `z < -1200` → -1200
(`0x0057047C`, `C4960000`). Then `Class23Draw`; `obj+0x194++`;
`obj+0x34 &= ~8`; `ActorRegisterCameraPoint(6.0 (40C00000))` at `0x00490917`.

The walk moves by **root motion** (`ActorBuildSkinnedModel` sets
`model+0x64` bit 1); nothing in the state writes the position except the clamp.

### `Class23TakeShots` — `FUN_00491420`

```
acc = 0.0 (the argument slot, reused)
comp = obj+0x1394 unless Training
if !(obj+0x34 & 8): return
if !Training && state == 1 && sub == 1:                        ; knockback, then CONTINUE
    v = RotY(obj+0x68 + 0x8000) · (0, 0, -1.0)
    x += v.x * g_class23_knockback_by_rank[rank]; z += v.z * the same   ; rank = GetDamageRank() twice
for p in 0, 1:                                                  ; EBX = 0x009A224C + p*0x14
    part = (s8)obj+0x190[p]
    if part:
        if Training: obj+0x11C -= 1
        else:
            ScoreAddForPlayer(p, 10)
            if state == 1:
                comp+0x135C++
                acc += g_GameMode == 1 ? (*EBX == -1.0 ? 2.0 : *EBX) : 1.0
        push; SetTop(g_camera_blocks[idx])
        pt = (rec+0x68, rec+0x6C, rec+0x70 + rec+0x78)    ; rec = obj+0x20C + part*0x90
        FUN_00407BC0(&M·pt, part in {1,2,3,4,6,7,9,11,14} ? 0x5A : 0x5C, p)  ; byte table 0x004916C0
        PlaySoundId(same split: 0x001216A9 BULLET_OTH1 | 0x001316A9 BULLET_SND1); pop
    obj+0x190[p] = 0
    rec(part).flags (obj+0x280 + part*0x90) &= ~(1 << (p+1)) & ~8
    obj+0x34 &= ~(1 << (p+1))
if !Training: comp+0x132C += __ftol(acc)                         ; 0x004916AB
```

Bit 3 itself is cleared by the caller's tail (`obj+0x34 &= ~8`).

### `Class23Collapse` — `FUN_00490B00`, state 2

Not Training → `Class23TakeShots`. `Class23Draw`. cursor 0x68:
`g_screen_shake_frames = 0x18`, sound `0x002216A9` (`DOORKICK3_22K_1`).
**cursor == `g_motion_play_length[clip]`** (not len-1):
`DEC g_enemies_present` `0x00490B5C`, free hit and camera slots,
`obj+0x34 |= 0x8000`, state 3, sub 0, return. Otherwise `obj+0x194++` and
(not Training) `obj+0x70..78 = g_camera_world_to_view · obj+0x100`,
`obj+0x34 &= ~8`, `RegisterForShotTest`.

### `Class23LieUntilCameraCue` — `FUN_00490C50`, state 3

Tail cue (its own tail: 0x31/0x190, 0xCF/0x8C) → `ActorDespawn`. `Class23Draw`
without advancing. Sub 0, not Training, `comp` in relative state 3 sub 2:
`x > -1091.0` (`0x0057048C`) → `x = -1091.0` (`C4886000`); sub++. For stage 5's
companion (x ≈ 584) this moves it to x = -1091 when the death orbit starts.

### Small routines

| routine | code |
|---|---|
| `Class23UpdateSubtype0/1/2` | `CALL [obj+0x1310*4 + table]` |
| `Class23LatchCompanionHpStage` `0x004913F0` | `comp+0x1320 == 1` → `obj+0x1320 = 1` |
| `Class23Draw` `0x004916D0` | `g_cur_actor = obj`; `LightsUseSecondarySet`; `DrawSkinnedModelAndShadow`; `LightsRestoreScene` |
| `Class23LandingRingUpdate` `0x00491700` | T(pos); `+0x68 += 8`; RotY; `CamEvalPath7(0x147, (float)+0x1320, …)` as scale and alpha; `MatrixScale`; `AssetDrawSlotWithAlpha(0x17C8 = boss1q.bin[94], 1 - a)`; `+0x1320++`; `ActorKill` after 0x50 |
| `Class23TrainingEntrance` `0x00490EB0`, `Class23TrainingFightAlone` `0x00490FD0` | Training only; read from the decompilation, not re-verified against the bytes. The second writes `g_boss_hp_fraction` at `0x00491040` (0) and `0x004912CB` (hp/max) and the first calls `BossHpBarSpawn(320.0, 35.0)` |

Not class 0x23: `FUN_0048FD00` belongs to `FUN_0048F930`'s family (its only
reference is `0x0048FAFF`); `FUN_0049B050` is referenced only from data at
`0x00597BF4`; `0x0049DF00`/`0x0049DF20` are `BossModeClockStart/Read`.

---

## 6. Tables (`.rdata`, read from memory)

| address | name | contents |
|---|---|---|
| `0x00570BE0` | `g_class22_motion_ids` | s16: +0 0x40B, +2 0x411, +4 0x410, +6 0x40C, +8 0x40A, +0xC 0x40E, +0xE 0x40D, +0x10 0x416 |
| `0x00570BF4` | `g_class22_cue_motions` | {0x413, 64} {0x414, 46} (motion, play length), stride 4 |
| `0x00570BFC` | `g_class22_flinch_motions` | 0x408 0x409 |
| `0x00570C00` | `g_class22_subactor_motions` | 0x12 0x10 0x0F 0x13 0x14 |
| `0x00570C0C` | `g_class22_path_keys` | 33 × {f32 end, f32 key}: 130/65 90/90 120/60 110/110 110/110 120/60 120/60 130/65 120/60 115/115 80/80 80/80 115/60 115/60 95/95 90/90 130/65 90/90 110/110 110/110 120/60 120/60 130/65 115/115 80/80 80/80 95/65 93/93 93/93 93/93 99/99 99/99 99/99 |
| `0x00570D14` | `g_class22_phase1_path_picks` | row 0 `0 2 5 6 7 8 12 13 14 15`; row 1 `16 20 21 22 26 16 20 21 22 26`; row 2 `1 3 4 9 10 11 1 3 4 9`; row 3 `17 18 19 23 24 25 17 18 19 23` |
| `0x00570D64` | `g_class22_aggression_roll` | 100 90 80 70 60 50 50 40 40 30 30 20 20 10 10 0 |
| `0x00570D84` | `g_class22_path_speed` | stage 0: 0.8 0.8 0.9 0.9 1.0 1.0 1.0 1.0 1.0 1.1 1.2 1.2 1.3 1.3 1.4 1.4; stage 1: 1.0 1.1 1.2 1.3 1.4 1.5 1.5 1.5 1.6 1.6 1.7 1.7 1.8 1.9 2.0 2.0 |
| `0x00570E04` | `g_class22_phase2_pick_rows` | 0 0 0 0 1 1 1 2 2 2 3 3 3 4 4 4 |
| `0x00570E24` | `g_class22_phase2_picks` | `0 1 2 2 2 2 3 3 3 3` / `0 0 1 1 2 2 2 3 3 3` / `0 0 0 1 1 1 2 2 3 3` / `0 0 0 0 1 1 1 1 2 3` / `0 0 0 0 0 1 1 1 1 1` |
| `0x00570E88` | `g_class22_landing_bounce` | 7.4 6.6 4.55 4.0 3.1 2.8 2.4 1.8 1.3 (then 1.1 ×4) |
| `0x00570EBC` | `g_class22_cue_frames` | 15.0 1.0 |
| `0x00570EC8` | `g_class22_intro_banner` | `0200 3000 2c01 1d18` + `ec51383e 295c8fbd 000080bf 8fc2753d 0ad7233c 000080bf`: flag 2, cam path 0x30, end frame 300, 0x181D (= asset slot `boss1z.bin[33]`), floats 0.18 -0.07 -1.0 0.06 0.01 -1.0 |
| `0x00570F08` | `g_class22_node2_cycle_a` | 4 5 6 7 6 5 4 3 2 3 |
| `0x00570F14` | `g_class22_node2_cycle_b` | 9 10 11 12 13 14 |
| `0x005703C0` | `g_class23_motion_ids` | s16 pairs: 0x393/0x394 (+0, +4), 0x383/0x384 (+8), 0x390/0x391 (+0xC), 0x38E/0x38F (+0x10, +0x14), 0x388/0x389 (+0x18), 0x38B/0x38C (+0x1C) |
| `0x005703E0` | `g_class23_strikes` | {0x383, hit 164, 50.0, sound 149, dmg-motion 4} {0x384, 132, 50.0, 120, 4} {0x385, 150, 45.0, 139, 4} ×2 |
| `0x00570410` | `g_class23_blend_start_frames` | 175 141 / 28 23 / 60 49 |
| `0x0057041C` | `g_class23_knockback_by_rank` | 0.6 0.5 0.5 0.4 0.4 0.4 0.3 0.3 0.3 0.3 0.3 0.2 0.2 0.1 0 0 |
| `0x0057045C` | `g_class23_training_x_by_lesson` | 258.1 243.1 228.1 213.1 198.1 |

Scalars inside `.text`/`.rdata` the port keeps as named constants: 70.0
`0x00570488`, 170.0 `0x00570F1C`, 250.0 `0x00570F20`, 591.0 `0x00570F24`, 410.0
`0x00570F28`, 310.0 `0x00570F2C`, 1.1 `0x00570F30`, 1.3611e-4 `0x00570F38`
(double), 7.4 `0x00570F40`, -1180 `0x00570F44`, -1238 `0x00570F48`, 60.0
`0x00570F50` (double) and `0x00564420`, 180.0 `0x00570A5C`, 240.0 `0x004C49C8`,
280.0 `0x005691CC`, 3.0 `0x004C49C0`, 50.0 `0x0055D2AC`, 1.3 `0x00565EEC`,
1.0 `0x004C4380`, 2.0 `0x004E30F0`, the clamps `0x00570470..0x0057048C`.

Camera path lengths used as frames (`g_cam_path_length`, `0x00576D38 + slot*4`,
the compiler folded the index): `[0x2F]` 830 at `0x00576DF4`, `[0x30]` 300 at
`0x00576DF8`, `[0xCE]` 445 at `0x00577070`, `[0x140+P]` at `0x00577238 + P*4`
(130, 120, 90, 90 for P 0..3; 0x144 is 70).

---

## 7. Damage model, score, two players

* **Flier.** Any bone. `Class22ChargeShots` takes **30** hit points a hit, **25**
  when `g_active_player == 2` (both players attackable); Original Mode
  multiplies by the per-player float at `0x009A224C + p*0x14` (−1.0 doubles).
  **120** points for part 2, **10** otherwise; **1500** to the killer (a coin
  flip when both players hit on the killing frame). Hits land only in phase-1
  subs 1/5/7/11 and phase-2 subs 3/5/7/9/10, and only with `0x40000000` down.
* **Phase gates.** 300 → at or below 210 the hp stage flag (faster paths, the
  second clip column) → at or below 90 phase 2, hit points re-seated to exactly
  90 → 0 death. Phase 1 cannot overshoot 90.
* **Companion.** Never loses hit points outside Training. In its fight state
  each player-hit adds 1.0 (or the Original multiplier) to an accumulator that
  becomes the flier's `+0x132C` — so shooting the companion **does** hurt the
  flier, one point a hit, but only on frames the flier is in a damage-taking
  sub. 10 points per hit. Every 8 hits raise the flier's aggression by 1.
* **Strikes on the player.** Companion: `PlayerTakeDamage(p, 1, 4)` on the
  record's hit frame, both players when `g_active_player == 2`. Flier in phase
  2: `PlayerTakeDamage(p, 1, 7)` five frames before its attack path ends.
  Each landed companion strike: flier aggression +3, `+0x1368++`, taunt latch.
* **Aggression** (`+0x1354`, 0..15, starts 8): −1 per frame a hit was charged,
  −2 per phase-2 flinch, +1 per 8 companion hits, +3 per companion strike, +4
  per phase-2 attack pass. It picks phase-1 path rows (roll against
  `g_class22_aggression_roll`) and phase-2 rows.
* **Randomness.** `rand()` calls, in order: `Class22PickPhase1Path` (3),
  `Class22PickCompanionStrikePath`/`TauntPath` (1), flinch pick (1), phase-2
  pick (1), kill coin flip (1, both players only), companion strike variant (1).

## 8. Every global write

| global | value | where |
|---|---|---|
| `g_boss_hp_fraction` `0x009C8E10` | hp/max | `0x0049C0B7` (phase 1 tail), `0x0049C8A6` (phase 2 tail), `0x0049D478` (entering phase 2) |
| | 0 | `0x0049C974` (death sub 0) |
| | (Training) | `0x00491040` 0, `0x004912CB` hp/max |
| `g_boss_engaged` `0x009CA0EA` | 1 / 0 | `0x0049B6CF` (variant 1 joins), `0x0049D507` (killing blow). Variant 2 never sets it |
| `g_script_flags[2]` | 1 | `0x0049B809` (camera frame 830), `0x0049B726` (Boss Mode) |
| `g_script_flags[3]` | 1 | `0x0049CC95` (variant 1 death sub 5) |
| `g_script_flags[0]` | 1 | `0x0049CC85` (variant 2 death sub 5) — the only literal writer in the image (byte search `c60500729c00`) |
| `g_enemies_present` | +1 / −1 | `0x0048FE16` companion init; `0x0049B6B4`, `0x0049D104` flier joins; `0x0049C995` flier death; `0x00490B5C` companion collapse end |
| `g_enemies_alive` | +1 / −1 | `0x0048FE1D`; `0x0049B6BB`, `0x0049D10B`; `0x0049C98E`; `0x004901AE` companion collapse start |
| `g_bHudShutterState` | 1 / 5 | `0x0049B899` (hint pause over), `0x0049BE49`/`0x0049BE7B` (hint lines), `0x0049CA16` (death) |
| `g_screen_shake_frames` | 0x30 / 0x18 | `0x00490026`; `0x00490314 0x0049038E 0x00490581 0x004906E0` (only if 0), `0x00490B34` |
| `g_camera_block_eye/target` | orbit / restore | `0x0049CD2F..0x0049CD7E`, `0x0049CD93`/`0x0049CD9F` (eye.y), `0x0049CC43..0x0049CC74` (Arcade restore) |
| `[0x009CA094]` | 1 / 0 | `0x0049CAAD`, `0x0049CC29` |

## 9. Boss health bar and banner

* `BossHpBarSpawn` (`0x00435E50`) is called with **`(320.0, 35.0)`** —
  `PUSH 0x420C0000; PUSH 0x43A00000` — at `0x0049B6A8` (variant 1) and
  `0x0049D0F8` (variant 2), in both cases on the frame the flier joins the
  counters. (Training: `Class23TrainingEntrance`.)
* `BossIntroBannerSpawn` (`0x00437A70`) is called **only for variant 1**, from
  `Class22Init` at `0x0049B204`, with `g_class22_intro_banner` (`0x00570EC8`):
  flag **2**, cam path **0x30**, end frame **300**, and `0x181D` at `+0x06`
  (the field class 0x19's port calls `message`; here it is asset slot
  `boss1z.bin[33]`). The banner waits for `g_script_flags[2]`, which the flier
  raises at camera frame 830. Variant 2 (stage 5) shows no banner.

## 10. The gates

| block | gate (op, offset) | opened by |
|---|---|---|
| st1 0 | `wait_script_flag 0xF8` `0x000304` | the chapter card (class 0x60), not this class. Variant 0 *reads* 0xF8 to leave state 0 |
| st1 14 | `wait_enemies_alive 0` `0x005A50` | companion `+1` at spawn (`0x0048FE1D`) holds it before the flier joins; flier `+1` at `0x0049B6BB`; closes to 0 at the companion's collapse (`0x004901AE`) and the flier's death (`0x0049C98E`), plus whatever else the block spawned |
| st1 14 | `wait_script_flag 3` `0x005A70` | **`0x0049CC95`** in `Class22Death` sub 5, 300 orbit frames after the camera freed. The other literal writer of flag 3, `0x00445976` (`FUN_00445050`), belongs to another class `[open]` whether it runs here |
| st1 16 | `wait_enemies_alive 0` `0x006B30`, `wait_script_flag 3` `0x006B50` | the same (block 16 is the continue restart: the camera is put straight to path 0x2F frame 0x33E, so the ride-in hands over on its first frame) |
| st5 1 | `wait_enemies_alive 0` `0x00146C` | companion `0x0048FE1D`/`0x004901AE`; flier `0x0049D10B`/`0x0049C98E` |
| st5 1 | `wait_script_flag 0` `0x001484` | **`0x0049CC85`** in `Class22Death` sub 5 |

Script timing it lines up with: block 14 plays path 0x2F to 0x33C, then
0x33D..0x33E, waits 300 frames and sets the shutter to 1 — the flier's sub 2
counts the same 300 (`g_cam_path_length[0x30]`) and the banner raises the
shutter at its own frame 300. Stage 5 plays path 0xCE to 0x1BD (445) and then
waits 120+280+200+100+140 = **840** frames before `set_hud_shutter_state 1` —
exactly `Class22DescendAndJoinFight`'s 840.

## 11. What the bundle exporter must carry

* **Nested descriptors.** For a class-0x22 placement with variant 1 or 2,
  `tail+0x10` → the class-0x23 descriptor (header + tail) as a linked
  placement the class can spawn; class 0x10's children in `characters.ts` are
  the precedent. `spawnres` needs a class-0x23 rule (literal 0x44).
* **Character types** 0x44, 0x45, 0x46 — all three resolve through
  `g_character_skeletons` into `char_adv04.bin` slots per the asset-slot table
  (16/16/7 nodes). `[open]` The blocks load `boss1z.bin` (34 entries),
  `boss1z_wing.bin` (8) and `boss1q.bin` (95) and not `char_adv04.bin`;
  `boss1z.bin`'s 34 matches the 33 slots `0x2A0..0x2C0` plus `0x181D`, and
  `boss1z_wing.bin`'s 8 matches `0x2C1..0x2C8`, but the slot table names
  `char_adv04.bin` for those slots. Which file the game draws is not settled.
* **Motions**, all in `mot/boss1.bin` (bank 4): flier 0x408..0x416; companion
  0x383..0x391, 0x393, 0x394 (0x387, 0x392 unused by these classes); sub-actor
  0x0F, 0x10, 0x12, 0x13, 0x14; with `g_motion_play_length` for each.
* **Per-instance model overrides:** the flier's node 2 cycles slots
  0x2A7..0x2B3 (`0x2A5 + 2..14`); node 1 draws extra slots 0x2B4/0x2B5; the
  companion's node 2 has slot 0 and extent 0 (not drawn, not shootable).
  Effects: `boss1q.bin[94]` (0x17C8), `common.bin` 25..39 (0x94..0xA2).
* **Object paths** from `op_st1`: 0x100..0x103 (stage 1 cutscene/ride-in),
  0x104..0x13F (phase 1), 0x140..0x144 (phase 2), 0x147 (ring curve); from
  `op_st5`: 0x17F. **Stage 5 needs `op_st1.bin`**: the engine's per-scene cam
  list (`FUN_004040A0`, `PTR 0x004C4990[g_scene_index]`) loads files
  `{10, 20, 16}` = `cp_st5`, `op_st5`, **`op_st1`** for scene 4. The web
  loader (`hod2lib/stage.ts loadCamPaths`) loads `cp_st5`, `op_st5`,
  `cp_gmovr` only. Original Mode also loads file 0x16 (`op_org`) per entry.
* **Tables:** every row of §6 (they are `.rdata`).
* **Sounds and lines:** the ids in §4–5; lines 0x1B, 0x1C, 0x1D.

## 12. What the port will need

* **`GameHost`:** `objectPath` (`CamEvalObjectPath6`) for every path above;
  node 1's **world matrix** of the flier (position *and* ZYX Euler) to seat the
  sub-actor — `boneWorld` returns a position only; node 1's world point for
  `obj+0x100` (both classes: shot centre and camera point); the view-space
  sphere of a hit part (`Class23TakeShots`' spark point) — render-only, can be
  dropped; `CamEvalPath7` for the ring — render-only.
* **Camera:** `Class22Death` drives `g_camera_block_eye/target` itself under
  `[0x009CA094] = 1` (camera mode 6) and calls `CamBlockSetAnglesFromLookAt`.
  `game/camera/mode.ts` records that override as not modelled. The faithful
  port needs mode 6 in the camera driver and the block eye/target as the
  camera's source of truth during the orbit; this is shared with class 0x14's
  scripted break and the banner (`BossIntroBannerUpdate` writes the same
  global).
* **Shot results:** both classes own their shot result (`ownsShotResult`):
  part code per player at `obj+0x190+p`, bits 1/2/3 of `obj+0x34`. The port's
  one-`pendingHit` model drops the both-players arms (`g_active_player == 2`
  damage 25, the kill coin flip).
* **Clocks:** `obj+0x194` advanced by the state after the draw; root motion
  (companion walk) happens in the draw, so the port's `ActorAdvanceMotion`
  equivalent must run where `Class23Draw` / `Class22DrawAndPoseSubActor` are
  called, including the frames a state returns *without* drawing (none drawn,
  none advanced).
* **Layers:** the sub-actor has no gameplay role (frozen bit, no shot, no
  counters) but its clip choice depends on game state; keeping `+0x1350/+0x1354`
  in the actor and posing it in `render/` needs a render-side hook for "seat
  on the parent's node 1", which `render/` may compute itself from the parent's
  skeleton — no layer rule is broken by that. `Class22DrawBonePart` is
  render-only.

## 13. Open questions

1. `char_adv04.bin` vs `boss1z/boss1q/boss1z_wing.bin` — which pol file
   supplies the drawn models (§11).
2. `[0x009CA094]` has no name; its only reader is `CameraDriverSelectMode`.
   Shared with the banner, class 0x14 and class 0x19 — the coordinator's call.
3. `obj+0x13C0` on class 0x23 (x − 50) has no reader found in the class.
4. `FUN_00445050` also writes `g_script_flags[3]` literally; which class it is
   and whether it runs in stage 1 blocks 14/16.
5. `Class22Phase2TakeShots` with bit 3 up and no part code would pay player −1.
6. The Training subtype-2 routines were read from the decompilation only.
7. `char+0x68` (`obj+0x1FC` = 5 flier, 1 companion) and sub-actor bit
   `0x80000` — meaning not read.
