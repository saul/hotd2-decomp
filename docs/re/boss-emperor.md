# Class 0x2D — the stage-6 final boss ("the Emperor")

`g_class_handler_pairs` maps class 0x2D to `Class2DClassHandler`
(`0x00426A70`). The name is the boss's own: its intro banner's name sprite,
`0xBF`, reads **EMPEROR**, and `0xCD` beside it reads **Type α**
(`g_class2d_banner_record`, `0x005898C8`). The port is `web/src/game/class2D/`
(`SpawnClass.Emperor`), and every routine below is named in
`ghidra/annotations/functions.tsv` under the name given here. Everything is
`[proved]` -- read in the disassembly -- unless it says otherwise.

## What it is

One class id runs everything the fight is made of, each an
`ActorAlloc(routine, 0x13F4)` object sharing the same `obj+0x1320..0x13C8`
words, read differently by each routine (L3):

| object | made by | routine at `obj+0x00` | model |
|---|---|---|---|
| the boss | the script (`spawn_obj`) | `Class2DClassHandler`, then `Class2DUpdate` or `Class2DSubtype0Update` | `boss6.bin`, type 0x4C, 16 bones |
| 8 satellites | the handler | `Class2DSatelliteInit`, then `Class2DSatelliteUpdate` | slot `0x72C` (no skeleton) |
| 1 child at a time | `Class2DState4` | kind 0..3 init, then update | 0x4D `b6boss1z`, 0x4F `b6boss2`, 0x50 `b6boss3`, 0x51 `b6boss4` |
| kind 0's wing | `Class2DChildKind0Init` (`ActorAllocSub`) | none -- a block, posed and drawn by kind 0's draw | 0x4E `b6boss1z_wing` |
| small tasks | the routines below | the task's own update | slots |

The port keeps the words in `Class2DTail` (`class2D/state.ts`): the boss's,
a satellite's and a child's blocks, with the offsets on the fields.

### The descriptor tail, `obj+0x1390`

| offset | type | meaning |
|---|---|---|
| `+0x00` | u8 | 0x4C (the handler writes the type as a literal anyway) |
| `+0x01` | s8 | the sub-type: 0 the cameo, 1 the fight (anything else: the handler stays installed) |
| `+0x02` | s16 | the first clip |
| `+0x04` | s16 | the counter the clip starts at |
| `+0x06`, `+0x08` | s16 | the cameo's camera path and frame to go on |
| `+0x0A` | s16 | the fight's hit points |
| `+0x0C`, `+0x0E` | s16 | the hit points rounds 1 and 2 end at or below |

Two spawns in the game:

* **stage 6, evt `0x4DB8`** (blocks 12 and 14): `4C 01 A1 00 00 00 E3 00 00
  00 90 01 04 01 8C 00` -- the fight, clip 0xA1, 400 hit points, rounds at
  260 and 140. Block 12 spawns it at op 122 during camera path 223 (0xDF);
  block 14 is Boss Mode's entry to the same fight.
* **stage 5, evt `0xF0C`** (block 0 op 43, hp 0): `4C 00 A0 00 00 00 CC 00
  00 00 FF FF` -- **sub-type 0, the cameo in stage 5's opening cut**, standing
  at `(752.875, 2595.0, -9872.09)`, angles `(0x8000, 0xFAA8, 0)`, on clip 0xA0
  frame 0 (its counter is never stepped), drawn unless
  `g_screen_furniture_flags & 0x20`, and gone (`ActorKill`) the frame camera
  path 0xCC (`cp_st5` path 1) plays -- the moment the stage's play starts.
  Goldman stands beside it ("Our Emperor shall awaken soon...").

## Dispatch tables (read from memory, L38)

| table | address | entries |
|---|---|---|
| `g_class2d_states` | `0x005898A8` | 7: `0x426C50`, `0x426D70`, `0x426E60`, `0x426FD0`, `0x427D40`, `0x428400`, `0x428AE0`; a zero follows |
| `g_class2d_satellite_states` | `0x00589908` | 9: `0x429D50` .. `0x42BB60`; `g_bat_body_motions` follows |
| child inits by kind | `0x004283E4` | 5: kinds 0, 1, 2, 3, 3 |
| State3 subs / sub 3 steps | `0x00427D10` / `0x00427D20` | 4 / 6 |
| State5 steps | `0x00428AC0` | 6 |
| State6 subs | `0x00428CC0` | 4 |

## The boss

### `Class2DClassHandler` — `0x00426A70`

`g_cur_actor = obj`; state and sub 0; no hit slot, no enemy slot;
`+0x130C = (s8)tail[1]`; the model: type 0x4C, clip `(s16)tail[2]`,
`ActorBuildSkinnedModel`, order 5, `model+0x64 |= 0xC`, node hook
`Class2DNodeDrawHook`, counter `(s16)tail[4]`; `+0x1370` (alpha) and the
three colour words `+0x1344..+0x134C` 1.0; `+0x124 =
g_actor_radius_by_char[0x4C]` (31); `+0x1374 = 2.0` (the weak point's
radius); cue `+0x136C = 0`.

* sub-type 0: `Class2DSubtype0Update` once, installed.
* sub-type 1: `BossIntroBannerSpawn(0x005898C8)`, eight satellites
  (`+0x131B = i`, `+0x1394 = obj`), and in **Boss Mode** (`g_GameMode == 3`)
  the intro skipped: seated on object path 0x185 at 1810, clip 0xA3,
  `g_script_flags[0x32] = 1`, `+0x1330 = 0`, cue 1, state 2. Then
  `Class2DUpdate` once, installed.

`Class2DUpdate` (`0x00426C30`) is `g_class2d_states[(s16)state](obj)`.

### The states

* **0 `Class2DState0`** — the intro rise, while camera path 0xDF plays: below
  frame 0x51E at `op` path 0x184's height at 1310 + 41.263; from 0x51E to
  0x628 on path 0x184 at `min(frame, 1630)` + 40.763; from 0x629 on, at
  0x667 the intro flipbook task, and once `g_script_flags[0x31]` is up
  (the script's op 161) `y -= 38`, angles `(0, 0x8A20, 0)`, state 1. Always
  `Class2DDraw`; the counter is not stepped.
* **1 `Class2DState1`** — on path 0xDF: 0xA1's last cursor blends to 0xA3;
  at frame 1810 (`g_class2d_intro_end_frame`) flag 50 (`0x32`), state 2,
  cue 1; rides object path 0x185 at `min(frame, 1810)`.
* **2 `Class2DState2`** — 300 frames (`g_class2d_join_frames`), sounds at
  0xA0 and 0xF0; then the fight: hp `tail+0x0A`, `BossHpBarSpawn(320, 35)`,
  `g_enemies_present++`, `g_enemies_alive++`, `RegisterEnemySlot`,
  `g_boss_engaged = 1`, `obj+0x34 |= 0x100`, state 3, the rank from
  `GetDamageRank`, at waypoint 0 gliding to waypoint 1.
* **3 `Class2DState3`** — round 1 (to `tail+0x0C`). Sub 0 glides 40 frames
  to the waypoint; sub `+0x1320` picks the attack:
  1. 0xA4 (at its last frame bones 3 and 4's hit-sphere radii -- `model+0x2A0`
     and `+0x330` -- zeroed and `0x100` cleared), 0xA5 (cue 2 at cursor 0x37;
     at its end `Class2DSortSatelliteRecords`, the nearest 4 -- 6 with
     `g_active_player == 2` -- activated, cue 3), 0x97 with the 0xB0 flinch;
     when every satellite is idle cue 1, the radii back from
     `g_character_part_tables` (2.25, 1.4), `0x100` set, 0xA6 -- the
     satellites fly at the camera;
  2. the same on 0xA7 (cue 2 at 0x1E), 0x99, 0xA8, no activation -- the
     pair beams;
  3. 0xAA (cue 2 at 0xB; bone 5's glow), a charge at the eye on 0x9B over
     `g_class2d_charge_steps[rank]` that `g_class2d_stagger_hits[players]`
     hits stop (0xB0), the strike at 0x9B cursor 0x2A (`PlayerTakeDamage(p,
     1, 5)`, rank -3), back over 40 frames, 0xA9.

  Every attack ends on 0xA3's twentieth frame: above `tail+0x0C` the next
  attack is `g_class2d_attack_picks[rank][(rand() >> 4) % 10] + 1`; else state
  4 with `+0x1320 = g_class2d_child_kind_picks[rand() % 4][rand() % 10]`.
* **4 `Class2DState4`** — round 2 (to `tail+0x0E`): per waypoint one child
  (below), with 0xA4, 0xAB (cue 2, records active), 0xAD until idle, cue 3
  and 0xAE with `obj+0x34 |= 0x10000`, 0xAF with the flinch, until every
  satellite is idle again; cue 1, 0xAC, the hover decides: the next kind or
  state 5 sub 5.
* **5 `Class2DState5`** — round 3 on the object paths `0x188 + i`
  (`g_class2d_path_segments[i]`, eight rows `{step, advance, strike, end,
  words}`): step 0 targets the path at frame 60 through
  `Class2DTargetOnPathFromEye`, the weak point radius to 1.6, **and falls
  into step 1** (L53); the glide; 0xA4, 0x9D (bone 1's core flipbook on),
  0x9E fading `+0x1370` to 0 over sixty frames with every sphere but bone
  1's zeroed, 0xA2; then the ride: the frame by `step`, `+0x1358` (the
  satellites' warning flare) from `end - 18`, at `strike` the players
  (`1, 7`, rank -3, `+0x135C`, the beam), a knock-back to the next path when
  the round's hits reached the row's count. **`hp <= 0` is the kill**:
  `g_boss_engaged = 0`, `g_screen_furniture_flags &= ~2`,
  `ScoreAddForPlayer(+0x133C, or rand() % 2 for both, 0x9C4)`; in Original
  Mode `g_option_unlocks |= 1`, entry 24 of `g_original_items_taken` counted
  (capped at 0x63, a signed byte) and copied to `g_profile_original_items`,
  and `g_profile_original_boss6_beaten = 1`; `BossModeRecordGrade`;
  `obj+0x34 |= 0x100`, state 6, clip 0x9F, cue 3, `PlaySoundId(0x325A9)`.
* **6 `Class2DState6`** — the death: the alpha back up by 0.02; sub 0 both
  counts down, the bar's fraction 0, `g_camera_free = 1`, the slots freed,
  **falling into** sub 1 (waits for camera path 0xE2, `cp_st6` path 9) and
  sub 2: frame 100 blends 0xA1; 0xA1 cursor 0x20 holds the counter; frames
  0..200 ride object path 0x186; at 200 the death burst at the position, sub
  3: thirty frames, cue 4, `ActorDespawn`.

### The weak point and the shot

`Class2DResolveShot` (`0x00428DA0`), first in states 3, 4 and 5, only in
subs 1..5 with bit 3 up and `0x40000000` clear: per player, bone 1 in reach
(`Class2DWeakPointInReach`, `0x00428F00`: `RayTestSphere(p, bone 1 *
T(2.3121, 0.1097, 0), +0x1374) >= 0`) and `0x100` clear costs
`g_class2d_hit_damage[g_players_in_play]` -- **12 with one player, 7 with
two** -- raises the rank by 1 (`Class2DAdjustRank`, clamped 0..15), flashes
the colour words to (1, 0.25, 0.5), sparks (`Class2DSpawnHitSpark`) and
sounds 0x1625A9; anything else ricochets (0x1216A9, not in sub 5). The
shooter goes to `+0x133C` (0, 1, or 2 for both), which the kill pays.

### The draw

`Class2DDraw` (`0x00428F70`): the colour words step back up by 0.01;
`LightsUseCustomSet(0.7, the scene light's pitch and yaw, +0x1344, +0x1348,
+0x1348)` -- the second colour word twice; `DrawSkinnedModelAndShadow`;
`LightsRestoreScene`.

`Class2DNodeDrawHook` (`0x00429040`) draws every node itself:
`AssetSlotUVsFromViewNormals` and `AssetDrawSlotWithAlpha(slot, +0x1370)` --
except bone 5 while the glow is on -- then by `slot - 0x7B2` through the byte
map at `0x0042950C` the node's shell `slot + 0x1B`; bone 1 (`0x7C3`) adds
`0x7E6` and the core `0x791` at `T(2.3121, 0.1097, 0) RotX(0x4000)
RotZ(spin)` with its flipbook `0x792 + g_frame_counter % 30` while `+0x1364`;
bone 5 (`0x7C8`) is `0x7E3`, or the glow `0x755 + +0x1338` growing to 0x3B
with the flare `0x19B3 - g_blink_frame_counter % 24` scaled by it, or
shrinking. `DrawCharacterPartSlot`'s type-0x4C arm (`0x00419C82`) draws parts
0..5 and their shells from the pair table at `0x004EDA50`, and parts 6..17, all
with UVs from normals at `+0x1370`.

## The satellites

`Class2DSatelliteInit` (`0x00429D00`): `obj+0x34 = 1`, radius 1.8, state 0.
Nine states (`0x00589908`); each reads the boss's cue `+0x136C` and sub.

* **0 WaitForParent** — once the cue is not 0, seated on the orbit point.
* **1 Appear** — 240 frames: the flash `0x19BC - n % 33` from 10, the beam
  `0x1633 + n % 24` from 200 to 230, the model growing 0.05 a frame from 200.
* **2 OrbitAndPick** — the ring: `Class2DSatelliteOrbitPoint`
  (`0x0042BCD0`) puts it 15 from the weak point, around the ring by
  `((index << 4) + step) << 9`, tilted by `(a - 0x4000) * 1.75 + 4096` (the
  first arm, `(a + 0x4000) * 0.25 - 4096`, is behind `a < 0x4000 && a >=
  0xC000`, which nothing passes). On cue 2 the boss's sub picks the move:
  1 FlyAtCamera, 2 PairBeam, 3 AbsorbAtBone5, 4 RideChild, 5
  OrbitWithTrail; on cue 4 Despawn.
* **3 FlyAtCamera** — on cue 3 an active record launches after
  `order * g_class2d_launch_gap[rank]` frames at the screen plane `z = -2.5`
  (the aim `v * -2.5 / v.z`, spread x 0.5, y 1/3) over
  `g_class2d_flight_frames[rank]`, with a trail; two frames short of the end
  `PlayerTakeDamageIfOnScreen(view point, 1, 7)` and the rank -3; a hit sends
  it home (30 frames).
* **4 PairBeam** — the even satellite and the odd after it join, the even
  one draws the beam `0x72D + n` to its partner for 40 frames, then as the
  pair (`0x754`, radius 2.7) flies at the screen over
  `g_class2d_pair_flight_frames[rank]` (spread 1/3, 1/4).
* **5 AbsorbAtBone5** — into bone 5 over 40 frames, out one by one on cue 1.
* **6 RideChild** — to its record's point, which the child's node hook writes
  from the bone that carries it (`g_class2d_child_bone_satellite`,
  `g_class2d_child2_bone_satellite`); home when `g_class2d_child_busy` drops.
* **7 OrbitWithTrail** — round 3: the ring with a trail, faster on cue 2;
  the warning flare while `+0x1358`, the beam while `+0x135C`.
* **8 Despawn** — the trail's flag and `ActorDespawn`.

`PlayerTakeDamageIfOnScreen` (`0x00415500`): the view point projected
through `g_projection_distance_px`, inside `-304 < x' < 304`, `-224 < y' <
224`, charges player `x' < 0 ? 0 : 1` (two in play) or `g_active_player` a
life and 100 more points, then floors both players' lives off the path
camera.

## The children

`Class2DState4` sub 0 makes one at `Translate(eye) RotY(yaw) RotX(pitch) *
g_class2d_child_offsets[kind]` with `obj+0x34 |= 1`, `+0x1394 = boss`,
angles `(-pitch, yaw + 0x8000, 0)`, and `g_class2d_child_busy = 1`. Every
kind waits for cue 3, takes `g_attack_permits[0]` and an enemy slot, and
leaves by `parent+0x34 &= ~0x10000`, the permit back, the busy flag down,
`ActorDespawn`. A hit through a child costs the boss
`g_class2d_hit_damage[g_players_in_play]` and raises the rank by 1; a strike
lowers it by 3.

| kind | init / update | model, clip | how it attacks | its weak point |
|---|---|---|---|---|
| 0 | `0x0042C0B0` / `0x0042C1A0` | 0x4D on 0x40C, wing 0x4E on 0xF | rides object path `0x192 + rand() % 2` from frame 70/56 in front of the eye (`Class2DChildKind0TargetOnPath`: the path in a frame at the eye facing along boss-to-eye, ten back); four frames before the path's end (130/120) strikes `(1, 7)` | any bone after fifteen frames on the path (0x3425A9) |
| 1 | `0x0042C830` / `0x0042C8D0` | 0x4F on 0x33 | thrown on cursor 0x23 -- `vel.y = 4`, gravity -0.0680556, `(d - 10) / -130` along its yaw; below `eye.y + 22` strikes `(1, 6)` | bone 1 at `T(0, 4, 1)`, radius 3.5, after 0x32 frames (0x1117A9) |
| 2 | `0x0042CD30` / `0x0042CDD0` | 0x50 on 0x3B, counter from 11 | glides at the eye by `g_class2d_child2_approach[rank]` to within 130; the swing's flash on bone 24 (`0x97A`, `0x199C`); strikes `(1, 9)` at cursor 0x32 | bone 24 from cursor 0x12 (0x3E25A9) |
| 3 | `0x0042D490` / `0x0042D530` | 0x51 on 0x79 | glides at the eye by `g_class2d_child3_approach[rank]` to within 50; strikes `(1, 8)` at cursor 0x2C | bone 2 (0x316A9) |

A child is hidden (`+0x1324 == 0`) until cue 3: its hook then draws only a
flare (`0x199C + g_blink_frame_counter % 24`, `MatrixClearRotation RotZ(0x8000)
Scale(10)`) on bone 1 (kind 2: bone 22). Kind 0's draw
(`Class2DChildKind0Draw`) seats the wing on its bone 1 with that bone's
angles (`MatrixToEulerZYX`) and steps the wing's counter with its own; the
other three draw through `Class2DChildDraw` (`0x0042D930`), which shows part
0 only while shown.

## The small tasks

| task | spawner / update | what |
|---|---|---|
| hit spark | `Class2DSpawnHitSpark` / `Class2DHitSparkUpdate` (`0x00429760`) | `0x276 + n`, 25 cels on bone 1's view point, sized by depth |
| intro flipbook | (state 0 at 0x667) / `Class2DIntroFlipbookUpdate` (`0x00429830`) | `0x161B + n / 2` at `T(0, 0, -8.6) RotX(0xF000)`; the screen shakes 0x30 at 15 |
| death burst | (state 6 at 200) / `Class2DDeathBurstUpdate` (`0x004298C0`) | on `op_st6` curves 0x190/0x191: `0x16B6` (its UVs scrolled by `Class2DScrollBurstModelUVs`), `0xB00`, the flare, `0x18C4`/`0x18C5`, `0x190D + n`; sounds at 5 and 0x1A; fades from 0x50; ends past 0x60 |
| satellite spark | `Class2DSatelliteSpawnHitSpark` / `0x0042BE90` | `0x17B0..0x17B4` at the view point, z + 1 |
| trail | `Class2DSatelliteSpawnTrail` / `Class2DSatelliteTrailUpdate` (`0x0042BF30`) | `0x72B` at points 1, 4, 10 and 18 of twenty, alpha `0.8 - i * 0.1` |

## Light sets and UVs

`LightsUseCustomSet` (`0x0041DC10`) is `SetRenderAmbient`,
`BuildSceneLightDirection(pitch, yaw)`, `SetRenderLightColour` with the values
handed in; the class draws the boss under (0.7, the scene light's direction,
its colour words) and everything else under (1.0, the camera block's pitch and
yaw, white). `AssetSlotUVsFromViewNormals` (`0x00418660`) and
`ModelUVsFromViewNormals` (`0x004AA400`) are described in
[`docs/formats/nl1.md`](../formats/nl1.md) (strip bit 8).

## The gate, and what ends the game

The fight holds block 12's `wait_enemies_alive 0` (op 210): state 2 counts
the boss in, state 6 out. Past it block 12 plays the ending cut (camera paths
226..228, dialogue, `award_accuracy_bonus`, a blackout) and its route is
**end**: `EvtAdvanceStepOrRoute` calls `MarkSceneOver`, run phase 5
(`RunPhaseArmSceneAdvance`) and 6 (`RunPhaseStepToNextScene`), which with
`g_scene_index` past the last stage hands the run to **phase 7,
`RunPhaseEndingEnter`** (`0x00431550`): scene 9 (the ending), block 2 with two
players in play else `g_active_player != 0`, its assets, every player not at
9 to state 7, `EndingTaskListCreate` (`0x00431740`, a stage's own task list on
scene 9's program), and phase 8, **`RunPhaseEnding`** (`0x00431660`), which
runs it until `MarkSceneOver`'s flag, then in Original Mode saves the item
tally and the profile, and goes to the name entry (phase 9, `0x00480D90`) or
through `AppStateAdvanceByTable`.

**The port stops before phase 7.** `app/main.ts`'s `advanceScene` has no
stage after 6, and scene 9 is not in the bundle; the ending is `[open]` work
of its own (an export of scene 9 and the run phases 7..10), not this class's.

## Tables

| global | address | shape |
|---|---|---|
| `g_class2d_charge_arrive_dist` | `0x0055CCD4` | f32 30.0 |
| `g_class2d_hit_damage` | `0x0055CCD6` | s16[3] by players: (junk), 12, 7 |
| `g_class2d_waypoints` | `0x0055CCE0` | vec3[5] |
| `g_class2d_attack_picks` | `0x0055CD1C` | s32[16][10] by rank |
| `g_class2d_stagger_hits` | `0x0055CF9A` | s16[3] by players: 0, 1, 2 |
| `g_class2d_charge_steps` | `0x0055CFA0` | s16[16] by rank |
| `g_class2d_child_kind_picks` | `0x0055CFC0` | s32[4][10] |
| `g_class2d_path_segments` | `0x0055D060` | 8 x 0x18 |
| `g_class2d_child_offsets` | `0x0055D120` | vec3[5] |
| `g_class2d_launch_gap` | `0x0055D1B8` | s16[16] |
| `g_class2d_flight_frames` | `0x0055D1D8` | s16[16] |
| `g_class2d_pair_flight_frames` | `0x0055D1F8` | s16[16] |
| `g_class2d_child0_path_start` | `0x0055D234` | s16[2]: 70, 56 |
| `g_class2d_child_bone_satellite` | `0x0055D238` | u8[16] |
| `g_class2d_child2_approach` | `0x0055D248` | s16[16] |
| `g_class2d_child2_bone_satellite` | `0x0055D268` | u8[28] |
| `g_class2d_child3_approach` | `0x0055D284` | s16[16] |
| `g_class2d_intro_end_frame`, `_join_frames`, `_rise_end_frame`, `_path185_end_frame`, `_child0_path_end` | `0x005770B4`, `0x005770BC`, `0x00577348`, `0x0057734C`, `0x00577380` | .data, no writer |
| `g_class2d_child_busy` | `0x009A2448` | u8 |
| `g_class2d_satellite_records` | `0x009A5F40` | 8 x 0x14 `{s8 index, u8 active, u8 order, vec3 point, f32 viewZ}` |
| `g_class2d_satellite_order` | `0x009C8D60` | the sorted copy |

The `.rdata` tables travel in `script.json`'s `class2d` block
([`docs/formats/bundle.md`](../formats/bundle.md)).

## In the port

* The draws: every `AssetDrawSlot` of the class is a `Class2DSlotDraw` in
  `G.g_class2d_draws` (`class2D/draw.ts`), drawn by
  `render/class2d_draws.ts`; the skeletons by
  `render/characters/emperor.ts`.
* Tests: `web/test/port/class2D.test.ts`. The fight, end to end against the
  stage's own script and paths: `tools/boss6_fight.mjs` (`npm run
  boss6_fight`).
