# Spawns: enemies, items and props

What the event script puts in a stage, and what each thing *is*. Everything
here was read out of the code first; the data was then used to check it, never
to guess from. Where a class could not be identified from code, it is marked
`[open]` rather than named.

The descriptor format itself is in [`evt.md`](evt.md). This document is about
the **classes** — what the handler behind each class id actually does.

## The three spawn allocators

| Opcode | Function | Object size | Tail pointer |
|---|---|---|---|
| `0x09` | `FUN_004088A0` | `0x13F4` | none — reads `+0x24`/`+0x25` inline into `obj+0x1F4` / `obj+0x130C` |
| `0x0B`, `0x0D` | `FUN_00408A20` | `0x13F4` | `obj+0x1390 = descriptor + 0x24`; also `obj+0x1316` from `desc+0x20` |
| `0x0C` | `FUN_00408BC0` | `0x1314` | `obj+0x130C = descriptor + 0x24` |

All three end with `= descriptor + 9` on an `int *`, so the **parameter tail is
at `descriptor + 0x24`** in every case; only the object field and the
allocation size differ. `Spawn.param(k, kind)` (`web/src/hod2lib/evt.ts`)
reads it with the same `k` a handler writes as `obj+0x1390 + k`.

`obj+0x1316` — the header's `+0x20` word — is the seed of the combat classes'
flag word `obj+0x136C`, and it is **not** the "always 0" this document and the
exporter both used to claim: 23 of 51 class-0x31 and 76 of 345 class-0x30
descriptors set it. It reaches the bundle as `desc_flags`. See
[evt.md](evt.md#0x20--the-class-flag-word-and-the-reading-that-was-wrong).

`FUN_00408A20` copies the header's orientation whole, too: `desc+0x14`,
`+0x18` and `+0x1C` to `obj+0x64`, `+0x68` and `+0x6C` — pitch, yaw and roll
(`0x00408A61`..`0x00408A70`). `[proved]` A character placement carried the yaw
alone for a long time; it now carries `pitch` and `roll` beside it whenever
either is not zero. Across the six stages, including the class-0x10 civilians'
children, that is two character placements: stage 2 block 21 step 2's
class-0x31 `zstin`, placed at `(0, 0xC000, 0xC000)` on their sides against the
clock face they climb down.

**All three allocators do the same**, for every class: `FUN_00408BC0` (opcode
0x0C) at `0x00408C01`..`0x00408C10`, and `FUN_004088A0` (0x09) at
`0x00408925`..`0x00408934`, after its byte tail. `[proved]` The port's spawn
sites all take the three from the placement through one helper,
`PlacementOrientation` in `game/descriptor.ts`.

**Class 0x13** comes through `FUN_00408BC0`, and five stage-2 records carry a
pitch -- the only class-0x13 records in the six stages with a pitch or a roll:

| evt | slot | orient `(pitch, yaw, roll)` | where |
|---|---|---|---|
| 48896 | `0x1237` `komono_st1.bin[3]` | `(0x1000, 0xC000, 0)` | block 17 step 1, `(-602.5, 50.5, -1526.5)` |
| 48952 | `0x1237` | `(0x2800, 0xC000, 0)` | block 17 step 1, `(-602.5, 49.5, -1529.5)` |
| 49008 | `0x1237` | `(0xF000, 0xC000, 0)` | block 17 step 1, `(-602.5, 50.5, -1554.5)` |
| 49064 | `0x1237` | `(0xEC00, 0xC000, 0)` | block 17 step 1, `(-602.5, 50.5, -1553.1)` |
| 84232 | `0x1383` `etc_1.bin[63]`, scale 15 | `(0x2800, 0, 0)` | blocks 16, 20, 35, 39, `(-1600, 1400, -2750)` |

All five take behaviour 0, and `g_prop_behaviours[0]` is `NoOpStub`, a bare
`RET` at `0x0041EBB0`; `ScriptedPropInit13` (`FUN_0043FE10`) stores nothing at
`+0x64`/`+0x68`/`+0x6C`; `ScriptedPropUpdate13` (`FUN_0043FE90`) calls no
motion routine and draws `MatrixTranslate; MatrixRotateX(+0x64);
MatrixRotateZ(+0x6C); MatrixRotateY(+0x68); MatrixScale` -- each call
pre-multiplies the stack top, so the product is `T·Rx·Rz·Ry·S`, a three.js
`Euler` in order `"XZY"`. `[proved]` So a static prop wears the record's three
angles for its whole life, and the pitch is drawn.

**A carrier (behaviour 8) never draws them**, bar one routine. The update calls
the behaviour at `0x0043FEC9` and only then draws, and every routine
`CarrierPropSelectRoutine` installs falls from state 0 into
`PropSeatOnObjectPath` (`FUN_00440130`), which overwrites all three, on that
first call: selector 0 at `0x0044028F`, 1 at `0x00440440`, 2 at
`0x00440969`/`0x00440997` and 9 at `0x004408E6`, 4 at `0x00440CE4` and 7 at
`0x00440C7C`, 5 at `0x004410B7` and 8 at `0x0044105C`, 6 at `0x00441430`. The
exception is selector 3's routine, `CarrierPropRoutine3` (`FUN_00440AD0`),
which never calls it and stores nothing to the object at all
(`0x00440AD0`..`0x00440BFD`), so it draws the record's angles for life as
behaviour 0 does. `[proved]` Its one record, stage 4 evt 35916, is
`(0, 0, 0)`, and no carrier record in the eleven `evt/*.bin` has a pitch or a
roll -- read off the disc, sixteen class-0x13 descriptors in all, the
sixteenth `trnevtbl.bin` 21504 on behaviour 9. The port runs all ten selectors
the same way and `test/port/` holds it; the exporter still keeps the model of
any selector `CARRIER_SELECTORS_PORTED` lacks out of the bundle, so the port
would draw none at its descriptor.

What `komono_st1.bin[3]` is, is `[open]`: a 0.9 x 5.5 x
4.2 wooden two-part model, four of them against the far wall of the room the
block-17 fight holds on. `etc_1.bin[63]` is two blended quads, 82 and 134
units square, whose textures show a lit crescent over a lunar surface and a
halo -- the moon `[likely]`, from its texture; tipped `0x2800` about x, its
face turns down toward the ground.

**`g_prop_behaviours` (`0x005926A8`), all ten entries**, read from the table's
forty bytes: 0 `NoOpStub`, 1 `CarriedPropHeldUpdate`, 2
`CarriedPropHeldInBone8Update`, 3 `CarriedPropThrowAtTarget`, 4
`CarriedPropThrowAtCamera`, 5 `CarriedPropRollAtCamera`, 6
`PropBehaviourLaunchWithAccel` (`0x0043FFC0`), 7 `PropBehaviourRideObjectPath`
(`0x004400D0`), 8 `CarrierPropSelectRoutine`, 9 `TrainingPropKeepAloft`
(`0x00445050`). Five instructions read it, each `MOV reg, [idx*4 +
0x5926A8]`: `ScriptedPropInit12` and `13`, `FloatingPropRowSpawn`,
`CarriedPropInit` (the state-37 script's `+0x04`) and `CarriedPropRelease`
(its `+0x08`); no entry's address appears in the image outside the table.
`[proved]` What selects each, from every class-0x12, 0x13 and 0x15
descriptor any `evt/` word points at and every class-0x30 or 0x18 head whose
state bytes name 37, spawned by an opcode or not:

| entry | selected by |
|---|---|
| 0 | the static props (classes 0x12, 0x13, 0x15) |
| 1 then 3 | stage 1's barrel man (`st1evtbl` `0x3C7C`, through its civilian), `advevtbl` `0x21B0`, `trnevtbl` `0xD54` and `0xE38` |
| 1 then 4 | stage 2's `0x2BC0`, stage 3's five drummers |
| 1 then 5 | stage 2's `0x131B8` and `0x13250`, the rolled barrels |
| 2 then 4 | `Boss4SpawnHeldProp`, by immediate |
| 6, 7 | nothing |
| 8 | the carriers |
| 9 | `trnevtbl` `0x5400` alone, Training's object (slot `0x10B3`, scale 5.0) |

6 is a launch: velocity and acceleration from the operand block's two
vectors, turned by the record's `RotX; RotZ; RotY`, then `pos += vel; vel +=
acc` for ever. 7 seats the prop on the `op_` path the operand block's first
dword names at `g_cam_path_frame` until the frame reaches the path's length.
Both run first from `ScriptedPropInit13`'s own call, and both are ported
(`game/class13/index.ts`), their inputs carried by the class-0x13 placement
(`bundle.md`).
9 is the object Training has the player keep in the air by shooting it --
`g_training_out = 1` if it falls to `g_camera_fixed_eye_y`, `g_script_flags[3]`
once the lesson's frame limit (1200..3000 by `g_training_lesson`) runs out,
with `DrawSecondsLeftReadout` (`FUN_00498C10`) showing what is left.

**Other classes with a non-zero pitch or roll in a record**, all six stages:
class 0x41 (113 of 316 records), 0x44 (21 of 123), 0x33 (2 of 24) and 0x31 (the
two above). The port carries every one it spawns: class 0x41's generic props
take `pitch`/`roll` from the breakables placement, and its kinded (type 4)
and falling (type 34) records use the two words as a kind and a set size,
which the placement carries under those names; class 0x44's selector 16
likewise, and selector 14 carries all three angles as the angles they are.
Not spawned by the port at all, and so not checked: class 0x41 type 37 (3
records), class 0x44 selectors 10 and 15 (5 and 9), and class 0x33
selectors 8 and 9 (stage 5, pitch `0x3800` each).

The handler itself comes from the 112-slot array at `0x009A2280`, built by
`FUN_0040AC90` from the `{class_id, handler}` pairs at `0x00593358` — 56
entries, of which **35 are used** by the shipped stages.

## `+0x11C` and `+0x11E` are polymorphic

Both receive the u16 at `desc+0x22`. What that means depends entirely on the
class:

* **Combat actors** run `FUN_0040A8B0`, which adds a difficulty delta from
  `0x005776B0` (`{-30, -15, 0, 0, 0}`) to `+0x11E`, clamps to `[1, 300]`, then
  copies it to `+0x11C`. Damage (`FUN_004098C0`) decrements **only `+0x11C`**.
  So `+0x11E` = max HP after difficulty, `+0x11C` = current HP. `[proved]`
* **Class 0x44** uses it as a sub-type index into the 18-entry table at
  `0x00595AB8`. `[proved]`
* **Class 0x41** uses it as an *asset slot id*, or a group id for type 0.
  `[proved]`
* **Class 0x10** uses it as a mode flag: 0 = free-standing, non-zero =
  parented. `[proved]`
* **Class 0x24** uses it as an animation phase seed, `-1` meaning random.
  `[proved]`

Treat the name `hp` in `evt.ts`'s `Spawn` as historical.

> ⚠️ The three orientation words are the same story. All three allocators copy
> them to `obj+0x64/+0x68/+0x6C`, so *angles* is the right default — but class
> 0x41 type 4 (`FUN_00462E10`) reads `obj+0x6C` as an object **kind** and
> `obj+0x64` as a **group size**. Check the class before trusting the outer two.

## What the classes are

Identification is by code, and where possible by sound-effect filename — this
binary has no name table for assets, but `PlaySoundId` ids resolve to records
holding paths like `COM\220_Y_M.WAV`, which is decisive.

| Class | Handler | Spawns | What it is | Confidence |
|---|---|---|---|---|
| `0x41` | `PropContainerPlacerUpdate` (`FUN_00461CD0`) | 441 | **Breakable-prop / item-container placer.** A transient stub: dispatches on `obj+0x130C` through `g_class41_constructors`, 79 entries at `0x00593580`, builds child actors, then `ActorKill`s itself. Never drawn, never damaged. Type 0 is the breakable group (8 spawns) and is **ported**; **type 1** (`PlaceWaterSurface`, `FUN_00462F70`, 15 spawns) is not a prop at all but the task that draws and ripples a canal water tile, `WaterSurfaceUpdate` (`FUN_0046E3A0`) -- the tile is `g_water_surface_slots[+0x1F4]` (`0x00593DA4`) and `+0x11C` a step lifetime -- and is **ported**, see `docs/formats/water.md` §2; type 4 (`PlaceKindedProp`, 70 spawns) and **type 43** (`PropUpdateType43`, 7) both read `obj+0x6C` as an object kind; type 32 is the **lift** (`LiftUpdate`) and is ported; type 13 (`PropUpdateType13`, `FUN_00467F50`) is the part that drops out of stage 2's clock tower on script flag `0x6D`, and type 35 (`PropUpdateType35`, `FUN_0046B320`) the double door stage 2's block-5 civilian stands behind, drawn at **literal world coordinates** whatever its placement -- both ported. Types **38, 39 and 44** (`PlaceTable38Props`, `PlaceTable39Stacks`, `PlaceTable44Props`) and **40** (`PlaceFragmentProps` / `PropUpdateType40`, all twenty sub-kinds) build their objects from tables in the image and are ported whole — see *Stage 1's church* below — as are **50** (`PlaceTable50Props`, six tables of scenery: stage 1's bin-scene crate, stage 2 block 17's furniture) and **66** (`PlaceTable66Props` / `PropUpdateType66`, the `komono_kanban.bin` signs), see *Class 0x41 constructors 50 and 66*; **47** (`PlaceType47Prop` / `PropUpdateType47`) is stage 2's faded disc, see *Class 0x44 selectors 9 and 12*. Constructor 24, `PlaceChainSegments` (`FUN_00463160`), is **the hanging chain**: twenty 0x200-byte links running `ChainSegmentUpdate` (`FUN_00469510`), each drawn as slot `0x1234` on the matrix the link above stored 1.5 lower and turned its own `i << 14`; a shot gives every link from two above the hit downward a swing rate (`rand() % 0x51 - (rand() & 1) * 0x180 + 0x98`, falling off by distance) that springs back in sixteen bits, and in Original Mode any link of group 1 shot in block `0x16` writes `g_script_branch_var = 2` and makes segment 0 drop an item from row 4 (`SpawnChainItemDrop`, `FUN_004699C0`) under its foot at `y = 18`. Ported whole in `class41/chain.ts`; the bundle carries `0x1234` and row 4 for every `chain` placement. Before it the links were generic props of type 0, drawn as the generic family's slot -- a stack of wooden posts where stage 2 block 22's chain hangs -- with no swing, and only group 1 ran any of the routine. **Every constructor a script places is ported** -- see *Class 0x41's constructors: which are ported* (constructor 26, `PlaceType26RippleTask`, the warehouse water, is ported in `class41/type26.ts`; constructor 68, `PlaceGoldenFrogFromLessonTable`, is Training's golden frog and is ported with item set 3's, see *The golden frog*; constructor 3, `PlaceType3UvScrollTask`, the stage-1 car's moving reflection, is ported in `class41/type03.ts`); 16, 17, 29 and 37 are in *Class 0x41 constructors 16, 17, 29 and 37*, and 42, 52, 55, 61 and 65 in *Class 0x41 constructors 42, 52, 55, 61 and 65*. The 44 types `PlaceGenericProp` serves share one constructor and a jump table — `g_place_generic_prop_arm_index` at `0x00462978` and `g_place_generic_prop_arms` at `0x004628D4`, indexed `type - 6` — so which arm sets what is read and not guessed. The retail stages reach 74 of the 79. See *The generic props' `+0x11C`* below. | `[proved]` |
| `0x30` | `FUN_00452DA0` | 288 | **The zombie.** HP, per-body-part damage zones, 80 points on kill / 10 per hit / 120 + combo on a head hit, a 54-state machine at `0x00592AE8`. Increments `g_enemies_alive`. State 2 (`FUN_00455720`) plays `COMMON2\ZOMBIE_041_16.wav`; the type-2 setup plays `CHAIN_SAW_22.wav` and a later state `KNIFE1_44.wav`. State 37, `ZombieStateCarryProp`, carries a **classless prop** (`CarriedPropInit`, `FUN_00442740`) typed by its script's `+0x00` out of `g_carried_prop_types` and throws it through `g_prop_behaviours` 1/3/4/5 -- stage 3's drums and stage 1's barrel; see `game/carried_prop.ts`. | `[proved]`, by the game's own sound record **Eleven of the 54 states never look at the camera**: they work on `obj+0x1394`, the object the actor was built for, and for 55 of the 70 spawns that reach one that is the class-0x10 civilian whose `CivilianInit` built them. See docs/formats/civilians.md. |
| `0x44` | `PropPlacerDispatch44` (`FUN_00472B10`) | 204 | **Prop placer.** Same shape as 0x41: dispatches on `obj+0x11C` through `g_class44_subtypes`, 18 entries at `0x00595AB8`, builds a child, `ActorKill`s. **All eighteen are read and ported.** Selectors 0 (`PropBuildScriptFlagEffect`), 11 (`PropBuildRisingDoor`), 13 (`PropBuildRiseToHeight`, `0x00473640` -- stage 5's gate behind JUDGMENT, see below), 16 (`PlaceFallingContainer`) and 17 (`PlaceStoryModeSwitch`); 9 (`PropBuildFlagLiftedProp`, `0x00473300`, one stage-3 spawn that rises on a flag) and 12 (`PropBuildSlideOnFlag`, `0x004734A0`, eight stage-6 spawns that slide on a flag), see *Class 0x44 selectors 9 and 12*; 14 (`PropBuildDrawOnlySelector14`, `0x004736D0`, twelve spawns over stages 2 to 4 -- a descriptor-named model at a descriptor scale), see *Class 0x44 selector 14*; and the hinges 1, 2 and 4 (`HingeUpdate`) with 3, 5, 6, 7, 8, 10 and 15 round them, see *Class 0x44's hinges, and selectors 3 to 8, 10 and 15*. | `[proved]` |
| `0x25` | `ScriptedHumanoidInit` (`FUN_004840D0`) | 142 | **Script-driven humanoid actor.** A bytecode VM (`FUN_004842A0`) drives a skinned character. Not an enemy, not damageable, awards nothing, and never filed for the shot test, so no shot reaches it (it holds a hit slot, from the model build, as every skinned actor does) — see [combat.md](combat.md), *A class that never registers*. **It is also how the game draws the player's own body in a cut scene** — see *`op 10` is an `if`* below. | `[proved]` |
| `0x10` | `CivilianInit` | 51 | **Civilian / rescuable victim. Ported** (`game/class10/`) — a bytecode VM whose 136 command streams are compiled into the **exe**, not the evt. Each civilian is held by class-0x30 captors its own Init builds from descriptors nothing in the script points at; killing them all pays **+400**. Shooting the civilian costs a **life** and −100 twice. Proved by voice records: `COM\220_Y_M.WAV`, `COM\209_M.WAV`, `COM\190_Y_W.WAV`, `COM\207_OLD_W.WAV`, `COM\200_C.WAV` — young man, man, young woman, old woman, child. Its face and its hair are an **attachment list** at the spawn tail's `+0x08`, not part of its skeleton — 52 of the 65 spawns carry one. See docs/formats/civilians.md. | `[proved]` |
| `0x31` | `EnemyThrowerInit` (`0x00449620`) | 49 | **The wall-crawler**, four character types (`0x16`-`0x19`) over one 36-state machine and four **behaviour sets**, the set taken from the descriptor's byte +1 rather than from the model. Set 1 (`zsass`) stands out of reach and throws; set 0 (`zstin`) climbs the walls and the ceiling at 40-50 units and **arcs onto the camera with a knife** inside 30, connecting on a frame of the leap clip rather than on any range test, then leaps back out to one side. The whole repertoire is a pick table, `g_class31_action_picks`. **Ported.** See [`combat.md` §12](combat.md). Ricochet SFX by subtype: `BULLET_WOD1_16.WAV` (wood) for `0x17`, `BULLET_MET2_16.WAV` (metal) for `0x19`. | `[proved]` |
| `0x24` | `SetPiecePropInit` (`FUN_00482CE0`) | 48 | **Scripted non-combat set-piece prop.** Not damageable, awards nothing, plays no sound at all (all 496 `PlaySoundId` xrefs checked). A skinned actor choreographed against the **camera**: six state selectors covering idle, a delayed motion change, freeze/unfreeze cues, two gravity drops and a slide, and every one of them is removed when the camera reaches a named path at a named frame. `obj+0x11C` is an animation phase seed. **Ported.** | `[proved]` |
| `0x33` | `ScriptedSceneryDispatch33` (`FUN_00432FF0`) | 44 | **Generic scripted scenery**, eleven sub-handlers on `obj+0x11C` plus a twelfth at 99. **Selectors 6 to 11 and 99 are ported** (`game/class33/cues.ts`, `game/class33/strips.ts`), carried by the bundle's `class33_sub` block, which names its selector: 6 `ScriptedSpriteEffectOnce33` (`FUN_00433E30`) throws one sprite from the object's position and pitch/yaw with kind, face mode and player at `tail+0x0C/+0x10/+0x14`, and despawns; 7 `ScriptedSoundCues33` (`FUN_00433E90`) plays a list of 8-byte `{s16 mode, s16 frame, u32 sound}` records, mode 0 on a frame count at `obj+0x1330` and mode 1 on `g_cam_path_frame`, moving `obj+0x1390` itself on by 8 per cue -- its despawn tests the record just played for `-1` and so never runs, and the list ends by parking on a record of any other mode -- and nothing else removes the object, since a task leaves the list only by `ActorKill` of the **current** task or by `TaskListBuild`'s `TaskTreeUnlink` / `ArenaReset` at a phase start, so it stands until the stage ends and plays any record whose frame a later path publishes (a seek rebuilds it on the record the replay's camera has run it to, `ClassHandler.followReplayCamera`); 10 `ScriptedSoundAndFlagAtCue33` (`FUN_00433F40`) is one such record plus `g_script_flags[tail+0x08] = 1` and a despawn; 8 `ScriptedBridgeCrashStrip33` (`FUN_00433FE0`) plays `STAGE5_SE\BRIDGE_CRASH1_22.wav`, `COMMON\GRASS7_16.WAV` twenty frames later, and draws `eff_shop.bin`'s sixty models `0x174A..0x1785` one a frame at scale 10, 300 below the object under `T RotY RotX RotZ`, then despawns (the collapse is `[likely]`, from the sound name); 9 `ScriptedFireLoopUntilCue33` (`FUN_00434100`) plays the looped `CAR_FIRE_22.wav`, draws the carrier's fire loop `0x1AAB..0x1AD2` at scale 10 until its record's cue, then `CAR_FIRE_22_OFF.wav` and a despawn; 11 `ScriptedEndingTrackSelect33` (`FUN_00434260`) plays BGM `0x1000000C` (`ENDL`) when a player in play has `ScoreRankForPlayer` (`FUN_00436200`) rank 0 -- a score of 80000 or more -- and `0x1000000D` (`ENDS`) otherwise, and despawns: it chooses music and writes no branch; 99 `ScriptedStaticSlotDraw33` (`FUN_00433160`) draws `tail+0x00` under `T RotZ RotY RotX` every frame, for good. Spawned: 7 at stage 5 block 2 step 2 (`0x1E7C`, `CAR_SRIP_22` at camera frames 505, 760, 820, `BRAKE_22` at 990), 8 and 9 at stage 5 block 7 step 2 (`0x3D10`, `0x3D34`, cue 360 frames), 11 only by `endevtbl.bin` (scene 9) blocks 0..2 step 1 (`0x4A0`), which no stage bundle carries; 6, 10 and 99 by no opcode in any `evt/` file (one orphan descriptor each for 6 and 10, `st4evtbl.bin 0xEC8` and `st5evtbl.bin 0xA38`, whose tails agree with these readings). Selector 4 (`ScriptedPushableUpdate33`, `FUN_00433B70`) is **a piece of scenery an actor shoves aside**, and the impulse has nothing to do with being shot — this row said "shootable, but a hit only imparts an impulse" and both halves were wrong. It reads the tail at `obj+0x1390`: `+0x00` the draw slot, `+0x04` a shot mesh **or `-1`**, and when it is `-1` `obj+0x124 = obj+0x128 = ` the `f32` at `+0x08` so the object gets a *body* sphere rather than a shot mesh; `+0x0C` a script flag that clears `obj+0x34` bit `0x8000` and `+0x0D` one that calls `ActorDespawn`. Bit `0x8000` is the freeze, and it is the same bit `ColiTestSphereAgainstActors` skips on (`0x80008000`) — so a frozen one is not a push target either. While it is clear, `ScriptedPushableApplyPush33` (`FUN_00433CE0`) applies whatever `ColiTestSphereAgainstActors` recorded at `obj+0x138`/`+0x13C`/`+0x140`: a tenth of the penetration along the reversed normal, `1.8x` if the **pusher** carries either bit of `0x18000000` (its strike's commit or the sprint bit), then a re-resolve against the actors and against the full collision set, with `ScriptedPushableSyncSphere33` (`FUN_00433E00`) re-seating the sphere after each move. That is `ZombiePushOutOfWorldAndActors`' own arithmetic, so an enemy walking into one displaces it at exactly the speed it would displace another enemy. `RegisterForShotTest` — the call that puts it in the dynamic list a push can find — is at `0x00433CC6`, **past the end of the body Ghidra gives the function** (`L35`). Stage 1's two, `0x1A40` and `0x1A74`, are asset slot 4196 = `komono_7.bin` part 0, **a chair**; both spawn with descriptor flags `0x8000` set and block 1 step 3's `set_script_flag 32` is what arms them, one instruction before it spawns the `char_adv00` at `0x16D8` that walks through them. **Ported** (`game/class33/pushable.ts`), drawn through `render/slotmodels.ts` and carried by the bundle's `class33_push` block: `slotDrawnSpawn` emits a placement for selector 4 as well as selector 1, and the two blocks are mutually exclusive because they are two handlers' readings of the same bytes — `web/tools/repo/port.ts` asserts that, and that the draw slot reached the glTF. The mesh shot test (`tail+0x04 != -1`) is not ported and neither shipped spawn takes it. Selector 2 (`ScriptedPropDrawUntilFlag`, `FUN_00433A10`) seeds `obj+0x13F0` from `tail+0x00` once (on `obj+0x1312` = 0, which it then steps to 1), then each frame despawns if `tail+0x0C == g_cam_path_frame` (an integer equality on block 0's frame only) or `g_script_flags[tail.u8(0x11)] == 1`, and otherwise draws the slot under `T RotZ RotY RotX Scale(1)` -- no sphere, no sound. Its tail is `0x14` bytes and nothing else in it is read. Ten descriptors, 56 spawns over both modes: stage 1's `0x5FE8`..`0x60C8` (blocks 5, 11, 14, 16; flag 1, raised at block 14 step 1) and stage 2's `0x668`..`0x748` (blocks 0-3 and 11; flag 0), all drawing `char_adv04.bin` 11, 12 and 94 (slots `0x36`, `0x37`, `0x1793`); every frame word is `-1`. Rendered, they are the car parked in stage 1's piazza, seen through the arch in block 5. **Ported** (`game/class33/draw_until_flag.ts`), carried as `class33_prop` and drawn by `render/slotmodels.ts` from the draw it records. Before that the exporter wrote each descriptor's model as a fixed-pose rig in a `props` block and `render/props.ts` hid it on a non-zero flag: drawn from the stage's first frame whether spawned or not, back whenever the flag fell, never gone on the frame word. Both are deleted. Selector 3 (`ScriptedEffectOnFirstFrame33`, `FUN_00433AC0`) reads **no tail** (its records are `0x24` bytes): on its first update it throws one sprite of kind `0x62` -- slots `0x1339..0x1356`, `common.bin` 307..336, at base scale 1.5, with `BOMB2_16` -- at its own position in face mode 1 (pitch and yaw toward the camera block's eye), and despawns. 14 spawns over both modes: stage 1's `0x37E8` (block 4), stage 2's `0x5574`/`0x5598` (block 9) and `0xA4D0`/`0xA4F4` (block 16); rendered at block 9, it is the splash a creature leaps out of the canal through. **Ported** (`game/class33/effect_first_frame.ts`); its placement carries no block, and the director takes the selector itself for that one. A replay retires both (`outlivedByReplay`): selector 2 once its flag reads 1, selector 3 always. Selector 5 (`ScriptedEffectAtCameraCue33`, `FUN_00433B00`) draws nothing: on the frame `g_cam_path_frame` or `g_cam_path_frame_2` equals `tail+0x00` it throws one sprite of kind `0x44` -- slots `0xFD4..0x1031`, all of `eff_dokan.bin` -- at its own position and despawns. One spawn, stage 2's `0x12568`, cue 340, whose tail is that one word. **Ported** (`game/class33/effect_cue.ts`), carried as `class33_cue`. Every arm of the dispatch, and its default, ends in `ActorClaimHitSlot`, and the port's dispatch claims too. **Selector 1 is ported** (`game/class33/`): `ScriptedCarrierUpdate33` (`FUN_004331D0`) and `ScriptedCarrierStepPath33` (`FUN_00433860`) — a vehicle that rides an `op_` path from `g_cam_path_frame - 1`, and it is **the** `g_carrier_object`. The four sounds settle what it is: `DRIVE_DEAD2_22.wav` seated, `DRIVE_DEAD2_22_OFF.wav` at its effect frame, `CAR_FIRE_22.wav` twenty frames later and `CAR_FIRE_22_OFF.wav` as it leaves — two loops with their off halves, so it drives in and then burns. It raises two `obj+0x34` bits and each is another class's way out: `0x10000000` ends `ZombieStateRideCarrier` (class 0x30 state 29) and `0x40000000` ends `ZombieStateDelayedStrikeInPlace` (state 32). Three shipped spawns — stage 2 `0x4FD0` and `0x12590`, stage 5 `0x1CE4`. The draw is ported too (`0x004332DA`..`0x0043382F`): the fire loop `0x1AAB..0x1AD2` at the descriptor's effect point, which does **not** return early -- a burning carrier rides on and leaves on its cue with `CAR_FIRE_22_OFF` -- then the model `tail+0x00` under `T RotZ RotY RotX Scale(obj+0x118)` (2.5 for stage 2's boats `0x1A35`/`0x1A36`), then stage 5's five car parts or, while the ride runs, the two sprite loops `0x24A..0x25F` and `0x260..0x275`. `game/class33/` records each `AssetDrawSlot` with its matrix and `render/slotmodels.ts` places them; the bundle carries the slots per descriptor (`sceneryDrawSlots`). Before that nothing drew the carrier, and stage 2 block 9's boat was missing. The draw's `MatrixStore(obj+0x150)` (`0x00433457`), the view-space point at `obj+0x70` and `RegisterForShotTest` (`0x004334D0`) are ported too: stage 2's boats take the mesh arm with their blobs (`class33.shot_blob`, `coli2.bin:31784` and `:40456`) and stage 5's car the 0.1 sphere; the seat's `0x80000001` keeps every carrier out of the moving-object passes and the crowd push, and a hit only marks it. | `[proved]` |
| `0x51` | `FishInit` (`FUN_00438540`) | 28 | **The fish.** Its twenty-frame swim strip `0x1156`..`0x1169` is `fish.bin` entries 3 to 22, and the three death slots `0xB6F`/`0xB70`/`0xB71` are entries 0, 1 and 2 — an asset filename, which is one of the binary's two name tables and settles a species this row had as "water enemy". It rises from the water plane, bobs on the surface, claims one of the four `g_water_attack_slots` and lunges to bite for 1 damage inside 8.0 units. **No hit points**: `obj+0x11C` is never read, so one bullet kills, for 80 points. Shot above the water it is flung and tumbles; below it, it surfaces and sinks. **A descriptor whose `tail+0x0E` is 6 is not a fish at all** — it is the water: `FishInit` clears the four slots, copies `tail+0x00` into `g_water_level` and kills the actor, which is why seven of the twenty-eight sit at the world origin. Splashes play `COMMON\SIBUKI2_16.WAV` / `SIBUKI3` (*shibuki*, "splash"); death plays `BLOOD07_16.WAV`. Sub-types 1 and 2 exist only for the stage-2 boss's `SpawnWaterEnemyAt` (`FUN_00438640`), which builds the fish with no descriptor and puts it **straight into the lunge** (`FishClaimSlotAndLunge`): round A's sub-type 1 bobs `sin * 6.0` along its lunge and falls to a floor when flung, round B's sub-type 2 swings ±2 across it. `SpawnWaterEnemyAt` refuses while any of the four slots is held, which is what paces a round to one fish in the air. **Drawn by its sub-block's angles, never by `obj+0x68`**: `FishDraw` (`FUN_00439860`) turns the model `RotY(sub+0x50)` and `RotX` of `sub+0x58` or of the lunge's progress, at scale 0.3, and a fish drawn solid below the surface also casts a flattened silhouette on it; a fish that found no slot runs `FishSwimAwayTick` (`FUN_00439C20`) alone, whose silhouette shrinks 0.01 a frame after 0x3C frames and which despawns it at zero -- 100 ticks. **Ported** (`game/class51/`, drawn by `render/fish.ts`). | `[proved]` |
| `0x26` | `Class26InstallSubtypeUpdate` (`FUN_0048E290`) | 25 | **Vehicle-and-scenery family**, 8 subtypes, no combat role at all. The handler is an *installer*: it switches on the s16 at `obj+0x11C` and writes the chosen update into `obj+0x00`, so it runs once per spawn. Only subtype 2 is shootable, and it is indestructible — it sparks and nothing decrements. Subtypes 0/1/4 draw a four-wheeled vehicle with hinged doors, a steering wheel, axles that spin only while moving, and a shattering windscreen; subtype 1 is `St1VehicleUpdate`. Subtype 2 is `Class26Subtype2Update` (`FUN_0048EAD0`), which rides one of nine `op_` paths picked by `g_active_cam_path`, sets `g_carrier_object` and draws asset slot `0x1A37` — stage 3's boat, the same model class 0x25's draw variant 3 puts under its passengers. Its first frame also seats `obj+0x14C` from `tail+0x00`, a relocated pointer to a `coli/` blob (`coli3.bin+0x9C08`, the foredeck), and raises `obj+0x34 \|= 0x51`, which makes the boat a floor for every collision query (`coli.md`). **Subtype 2 is ported** (`game/class26/`). **Subtypes 6 and 7 are ported** (`game/class26/subtype67.ts`): `Class26Subtype67Update` (`FUN_0048F930`) poses each on object path `0x183`/`0x184` (`g_class26_path_by_selector`, `0x005703B4`) by the camera path playing -- held at frame 1310 plus half a unit on `0xDD` and early `0xDF`, ridden at the camera's frame on `0xDF` `0x51E`..`0x628`, parked at y 2781.1 from `0x629` -- and hands the frame to `Class26Subtype67Draw` (`FUN_0048FB40`) or, in Boss Mode and on `0xE9`..`0xEB`, `Class26Subtype67DrawOrKill` (`FUN_0048FD00`), which `ActorKill`s on `0xEC`. Subtype 6 draws `0x1915`, `0xD36` 153 along x and `common.bin[135]` (`0x9A8`) under `SetRenderLightColour(0.05, 0.01, 0)` until `obj+0x1320` is raised at `0xDF` frame `0x578`, then `0x1914` alone, with a second `0x1914` sliding along z from `0x56E`; subtype 7 draws `0x190C` and, at `(752.8753, y, -9872.09)`, `0x7E9` until `g_script_flags[0x31]` and `0x7EB` after, unless `g_accuracy_stats_suppressed` is up. Two spawns, stage 6 block 12 step 1 op 57 (`0x46A8`, `0x46CC`); the draws are recorded and drawn by `render/slotmodels.ts`. Subtypes 1, 3, 4 and 5 are drawn by `render/rigs.ts` with no actor. | `[proved]` |
| `0x43` | `PlaceOwlFlockMember` (`FUN_00445DB0`) | 14 | **The owl.** Settled twice over: `OwlDrawBodyChain` (`FUN_00447C20`) draws sixteen slots and every one lies in `0x0BBD`..`0x0C26`, which is `owl.bin` entries 0 to 105, and the death sound is `COMMON2\FUKUROU1_22.wav` / `FUKUROU2` — *fukurō*. The neighbouring `KOUMORI` (bat) records exist and this class does not play them. `HABATAKI6_16.wav` is real but it is the **launch** cue, not an identification. The handler is a **placer**: it allocates a 0x2A0-byte object — no skeleton, no motion — and `ActorKill`s itself. Both enemy counters, no hit points, 80 points, a sphere of radius 1.5, and one life at five units from the eye. A flock of four shares one `g_class43_attack_token`, so they come in turn; a one-player game keeps only members 0 and 1 (member 0 alone for sub-type 0). Its loop is dive → orbit → dive **for ever**: an owl only leaves by being shot. A sub-type-0 owl is invulnerable until `g_cam_path_frame` passes 682. **Ported** (`game/class43/`), the corpse's four per-sub-type landings and the ring and splash they leave included; the body chain is `render/owl.ts`. | `[proved]` |
| `0x2D` | `Class2DClassHandler` (`FUN_00426A70`) | 3 | **The stage-6 final boss, the Emperor** (`boss6.bin`, type 0x4C; its banner's name sprite reads EMPEROR, Type α). Sub-type 1 (stage 6 blocks 12 and 14, one descriptor, `0x4DB8`) is the fight: an intro rise on object paths 0x184/0x185 to flag 50, 400 hit points over three rounds (to 260 and 140) with eight satellites (`ActorAlloc`, `+0x131B = i`) that fly at the camera, pair into beams and ride its children, four child kinds one at a time in round 2 (`b6boss1z`..`b6boss4`), and a death on camera path 0xE2; it holds block 12's `wait_enemies_alive 0`. In Boss Mode it seats itself on object path `0x185` and skips the intro. Sub-type 0 (stage 5 block 0, `0xF0C`, hp 0) is the cameo in stage 5's opening cut, gone when camera path 0xCC plays. **Ported** (`game/class2D/`; [`docs/re/boss-emperor.md`](../re/boss-emperor.md)). | `[proved]` |
| `0x42` | `PlaceWormBatch` (`FUN_0042F9B0`) | 3 | **The worm**, settled by its kill sound, `STAGE2_SE\WORM_TUBU1_44.wav` / `WORM_TUBU2_44.wav`, and drawn from `buyo.bin` 0..53. A placer on `desc+0x25`: sub-type 0 six worms (eight with two players) that ride stage 2 block 21's cog, sub-type 1 one uncounted worm that drops past, sub-type 2 ten (fifteen) in block 26. Each batch member is in **both** enemy counters from its placement, drops, crawls to the camera, and takes its turn (`g_worm_leaper`) to leap at it for a life; one bullet kills, for 80, and one shot before it has landed splits in two. The three shipped spawns are sub-types 1, 0 and 2. **Ported** (`game/class42/`; `docs/re/worm.md`). | `[proved]` |
| `0x21` | `RescueTargetInit` (`FUN_00451720`) | 1 | **The rescue target**, and the branch writer that decides stage 2's first fork. Rank-scaled hit points from `g_class21_hp_by_rank` (`0x00565F0C`), 1 or 2. Rides in on the camera path, then `RescueTargetHeldState` charges one point per body part shot; the last one writes `g_script_branch_var = 1`, counts a rescue, pays 80 + 400 and gives both enemy counters back. Its one spawn is stage 2 block 0, whose record is `{11, 1, -1}` — so killing it takes block 1 and leaving it takes block 11. **Ported** (`game/class21/`). | `[proved]` |
| `0x2B` | `DynamicLightInit` (`FUN_00438060`) | 4 | **A scripted light**: one `g_entity_lights` entry held for a stretch of a scene. The Init switches on `(s16)obj+0x11C` (`desc+0x22`, a selector -- L3) and calls the routine once, then installs it as the update; a selector past 2 leaves the Init installed. Each routine claims an entry with `EntityLightAcquireSlot` on its first call (`obj+0x131B`, `obj+0x1312` 0 -> 1), rewrites the whole light every frame while `g_scene_lighting == 1` and only clears its enabled word (`+0x68`, the `g_entity_light_array` label, stride `0x1D` dwords) otherwise, and on its stop condition clears it, releases it (both only for an entry from 3 up) and `ActorKill`s. No draw, no tail, no position of its own. Selector 0, `DynamicLightFlickerPoint` (`FUN_004380B0`), stage 2 evt 27716 (blocks 11 step 7 and 12 step 0): a point light at `(-896.8, 4.1, -1071.4)`, diffuse `(0.2, 0.6, 8.0)`, `att0` 0.1, range 100, `att2 = (rand() % 8) * 1e-4` redrawn every `rand() % 16 + 3` lit frames; stops on `g_script_flags[225]` (block 12 step 1). Selector 1, `DynamicLightSpotDown` (`FUN_00438230`), stage 4 evt 25684 (block 10 step 3): a spot at `(-125, -25, -670)` aimed straight down, diffuse 10, `att0` 0.1, range 65536, `theta` pi/8; stops on camera path `0xAF` from frame `0x6E` or `0xB2` from `0x82`. Selector 2, `DynamicLightSpotTilted` (`FUN_004383C0`), stage 5 evt 3900 (block 0 step 1): a spot at `(762.2, 2616, -9778.5)` aimed `RotY(0x400) RotX(0x6F00)`, diffuse 4, `att0` 0.5, range 65536, `theta` pi/16; stops on camera path `0xCC`. None writes `phi` or the falloff. **Ported** (`game/class2B/`); the bundle carries the selector as the placement's `hp`. `render/gunlights.ts` draws entries from 3 up as point lights only, so selectors 1 and 2 reach `g_entity_lights` and not the screen. Stage 2's block 12 re-spawns evt 27716 while block 11's is alive, and the port's slot-actor builder makes one object per address, so the engine's second light is not built. | `[proved]` |
| `0x29` | `SceneryBatchUpdate29` (`FUN_00432C80`) | 3 | **Floor decals** — the handler itself, no `Init`. It `ActorKill`s once `g_active_cam_path == (s16)tail+0` and `g_cam_path_frame >= (s16)tail+2`, else draws one of three lists picked by `obj+0x11C` — `g_class29_list0..2` at `0x00589AF0`, `0x00589BE0`, `0x00589C88`, `{i32 slot; f32 x,y,z; i32 yaw; f32 scale}` at stride `0x18`, ended by slot `-1` — each record under `T RotY Scale`. Every record is slot `0x93C` or `0x93D`, the shot blood's flat quads: stage 1 block 3 step 3 (list 0, until path 41 frame 660; the blood under "G's bloodstains"), stage 1 block 8 step 3 (list 1, until 44/770) and stage 2 block 11 step 5 (list 2, until 70/745, beside the dead `hito_mario`). A selector outside 0..2 walks the object's own memory as records; no shipped descriptor carries one (`web/tools/checks/prop_tables.ts`). **Ported** (`game/class29/`), drawn through `DrawSlotInWorld`, the tail carried as `class29`. Stage 2's list sits at `y = -6.75`, 0.028 **below** the floor model it lies on (`st2_02b.bin[0]`, flat at `-6.722`; the script's ground plane there is `-6.76`), so the depth test hides it; stage 1's lie 0.002–0.016 above theirs and show. | `[proved]` |
| `0x16`/`0x17` | `WaterFieldCreate` (`FUN_00442290`) / `WaterWaveSourceAdd` (`FUN_004422D0`) | 6/8 | **The water-wave field.** `0x16` allocates the 0x2C-byte field `g_water_wave_field` points at, with its spawn's own `y` as the plane, and kills itself; `0x17` hangs one 0x68-byte wave-source task in the field's first free slot (a full field leaves the spawn alive to try again), `obj+0x11C` selecting travelling (`WaveEvalTravelling`, `FUN_00442110`) or circular (`WaveEvalCircular`, `FUN_00442210`), `{amplitude, wavelength, speed}` from its tail and the orientation from the spawn. `WaterFieldSampleHeight` (`FUN_00442390`) is the plane plus every ticked source's wave. Stage 2's boss blocks alone place them -- blocks 16, 20, 35 and 39 (evt 83976, the two run-ups into the arena and the arena) at `y = -25.5007` with two travelling sources, 37 and 41 at `-25.0` with none -- and the stage-2 boss and class 0x15's planks are what read them: the boss's fish are seated 1 (round A) or 10 (round B) under the surface, its breaks and deaths ride it, and the planks float on it. **Ported** (`game/class16/`, `game/class17/`). | `[proved]` |
| `0x15` | `FloatingPropRowSpawn` (`FUN_00441750`) | 4 | **A row of floating planks** in stage 2's boss arena, `komono_boss2.bin[6]` (slot `0x16E0`). The handler is a placer: `(s8)tail+0x24` planks, plank `i` at `i * tail+0x18..+0x20` from the spawn, each an `ActorAlloc(FloatingPropUpdate, 0x1314)` with the spawn's `obj+0x34` (`0x51`), angles and tail pointer, `obj+0x3C = i`, `obj+0x1F4 = tail+0x00`, `obj+0x14C = tail+0x04` (a blob in `coli2.bin`, so a moving collision mesh) and a 0x34-byte block (`ActorAllocRaw`, tied by `TaskSetUserBlock`, `FUN_004A7260`): `g_prop_behaviours[tail+0x08]`, the kill cue `tail+0x0A/+0x0C`, two unread words, the flag `tail+0x12`, and a delay -- `-1` for the last `(s8)tail+0x25`, else `0, s, 2s ...` with `s = tail+0x26` from the first allocated. Then it zeroes the four `g_class14_foot_contacts` strengths and `ActorKill`s. `FloatingPropUpdate` (`FUN_004418C0`): killed on the camera cue; once the flag is up it counts its delay and leaves, every third (`(N - i) % 3 == 1`) throwing `SpawnPropStripEffect` kind 1 (`sanbasi.bin[12..90]`) at 0.7 with a 6-frame shake; otherwise it samples `WaterFieldSampleHeight + 2.5` at `(x +- 20, z +- 5)`, turns at most `0x60` a frame toward the normal of the highest corner's triangle (writing the mean as its `y` only on a frame it turns), tips and sinks under any foot contact within `z +- 5` -- tilt `dist * strength * 0.65536` BAMS, sink `strength * 0.005` eased by a quarter -- and swings back as `cos(+0x400 a frame)` times what it held, a decay gated on the cosine being exactly 0.0 that never fires; drawn at `T(x, mean - sink, z) RotX RotZ RotY` and the tilt, `MatrixStore(obj+0x150)`, `RegisterForShotTest` (mesh arm). Two descriptors: evt 84156 (30 planks 10 apart along -z, 24 leaving on flag 8 ten frames apart) at blocks 16 step 14, 20 step 2 and 35 step 0, and evt 91256 (6, none leaving) at block 39 step 1, each two ops after the class-0x16 field. **Ported** (`game/class15/`), carried as the placement's `class15`; the plank draws through `DrawSlotInWorld` and the bundle's `slots_effect`, the strip through `slots_actor`. Block 35's re-spawn of evt 84156 finds the address already built, so the port keeps block 16's or block 20's row and does not add the engine's second. | `[proved]` |
| `0x52` | `MouseInit` (`FUN_0043F4C0`) | 10 | **The mouse.** Its ten draw slots `0x1385`..`0x138E` are `mouse.bin` entries 0 to 9 — an asset filename, which is one of the binary's two name tables and settles a species this section had as `[open]` on the grounds that the class plays no sound. Subtypes 0 and 1 run `MouseWanderUpdate` (`FUN_0043F5C0`): 0.4 units a frame along the spawn yaw, a 40% chance every hundredth frame to hold for 60 and turn by the difference of two twelve-bit draws, and a despawn at 600 frames. Subtypes 2–4 run `MouseBranchTriggerUpdate` (`FUN_0043F720`), a **shootable route-branch trigger**: the first hit writes `g_script_branch_var` from the signed byte at `0x00564442 + subtype` — **2, 1, 2** for subtypes 2, 3, 4 — and it then runs the strip and flees until it passes its own bound. **Only in Original Mode**: the Init despawns subtypes 2–4 outright unless `g_GameMode == 1`. Stage 4 block 10 is the clean case, `next = [12, 18, 19]` with one subtype-3 and one subtype-4 mouse in it. **Ported** (`game/class52/`), drawn and shot through `render/slotmodels.ts` and `ShotTestSphere`. | `[proved]` |
| `0x53` | `CatInit` (`FUN_00431250`) | 4 | **The cat** (character type `0x1A`, `cat.bin`). Subtypes 0 and 1 run `CatMotionListUpdate` (`FUN_00431340`): the set's row of `g_cat_motions` (`0x00589A64`), each clip repeated per `g_cat_motion_repeats` (`0x00589AA0`), and a despawn once 1000 frames have passed — the last clip of four of the six rows is `0x2FD`, whose root motion is what carries the cat out of the room. Subtype ≥2 runs `CatBranchTriggerUpdate` (`FUN_00431430`), a shootable branch trigger that writes `g_script_branch_var = 2` — but **only in event block 8, and only while the variable is still 0** — then runs on `0x2FD` until `x < -478`. **The trigger only in Original Mode.** All four spawns are stage 2, in blocks 3, 5, 8 and 11; the block gate is what keeps the three outside block 8 from writing a 2 into a record that has no slot 2, and `web/tools/checks/branches.ts` fails if it is dropped. **Ported** (`game/class53/`). See [the cat's two routines](#the-cats-two-routines). | `[proved]` |
| `0x40` | `PlaceHorde` (`FUN_0043BD30`) | 9 | **The horde — worms (`[likely]`, from the model) that come up out of the street, and the prop they push aside.** A placer on `obj+0x130C` (the opcode-0x09 descriptor's `+0x25`): **1** allocates N `0x13F4`-byte members running `HordeMemberInit` (`FUN_0043BEF0`) into `g_horde_members` (`0x007DCC20`, 10 slots) — 8, or 10 with two players; 6/8 in evt blocks 0x0E/0x12; 4 in block 0x19 — each carrying its index at `+0x131B`, then `ActorKill`s itself; **2** is `SpawnHordeEmergeProp` (`FUN_0043DC30`), a `0x1F8`-byte prop at `(x, -9.2769, -538.8)` drawing `komono_st1b.bin` 12 twice (`HordeEmergePropUpdate`, `FUN_0043DD00`); **0** builds one member (unshipped). Seven descriptors, nine spawn instructions: five selector 1 (stage 1 blocks 3, 8; stage 2 blocks 0x0E, 0x12, 0x19) and four selector 2 (stage 1 blocks 3, 7, 8, 12) — this row used to say all nine were hordes. Every member is character type **0x1D = `mol.bin`**, drawn by the side-block **sub-model** (`SubModelInit`, `FUN_0040EAE0`, and its family), formation (`side+0x68`) and skin (`obj+0x1350`, a row of `g_submodel_bone_slots`) chosen from `g_evt_block_index`. `HordeMemberUpdate` (`FUN_0043C440`): hold, walk the `g_horde_formation` spline, wander a grid (`g_horde_wander_origin`/`_cell`) avoiding members inside 6.0, and — one member at a time, by `g_horde_diver`, 90 frames apart, on screen (`HordeTryStartDive`, `FUN_0043D4F0`) — wind up, leap and **bite** (`PlayerTakeDamage(p, 1, 10)`), pull out. Both enemy counters (formation 2 only once `g_script_flags[94]` rises); one shot, 80 points, `PDMG_MORR1/2_44.wav` from `STAGE1_SE`/`STAGE2_SE`, a splash (`SpawnHordeDeathSplash`, `FUN_0043E4C0`) and a sixty-frame corpse (`HordeCorpseSinkUpdate`, `FUN_0043DA20`). Ghidra truncates both updates at a `MatrixStackPop` (`L35`). **Ported** (`game/class40/`) — all of it, including formation 2's rug the first three members crawl under (`SpawnHordeDeformedProp`, `FUN_0043EF70`; its reshape in `render/horde.ts`). `web/tools/checks/horde.ts` checks every table against the EXE. | `[proved]` mechanism; species `[likely]` |
| `0x11` | `FrogInit` (`FUN_0043A080`) | 4 | **The frog**, and three things say so: the descriptor tail's character type is `0x1B`, which `g_character_skeletons` resolves to **`frog.bin`** (15 bones); every draw slot it writes, `0xB90`..`0xBB2`, is a `frog.bin` entry; and `FrogStateIdleAndCroak` plays `COMMON\KAERU4_22.WAV` — *kaeru*. Both enemy counters, **no hit points** (`obj+0x11C` is stored once and never read), 80 points. A ten-entry state machine at `g_class11_states` (`0x00592660`) driven by a **command list in the descriptor tail**, `tail+0x0A` onward, whose opcode *is* the state; past its `0xFFFF` terminator the class chooses for itself — inside fifty units of the camera it claims an attack permit and leaps, and outside it hops about. The leap's hit is **timed**, on motion frame 60, and a frog that lands one despawns without ever dying or scoring. Shot, it dies in `FrogStateDieTumbleAndSink` (`FUN_0043B990`): thrown half a unit along the camera's own -Z, bounced, and on the frame it has settled on the death clip's last cursor it opens `SpawnGroundRingEffect` (`FUN_00407DA0`) and sinks for 181 frames; the alive count comes down on the kill and the present count on the despawn. All four spawns are stage 1 block 3. **Ported** (`game/class11/`). | `[proved]` |
| `0x19` | `Boss4Init` (`FUN_004917E0`) | 4 | **The stage-4 boss.** Character type **`0x4A` = `boss4.bin`**, fifteen nodes, 300 hit points, and the four spawns in the game are stage 4's blocks 23, 25, 27 and 29 — one per entrance. Its tail is `+0x00` the character type, `+0x01` the entrance state (0..3, one of each), `+0x04`..`+0x3C` **fifteen per-bone `coli4.bin` collision meshes** (ten of them; -1 keeps the bone's sphere) written to each bone record's `+0x88` with `+0x74 |= 0x51`, and `+0x40`/`+0x42` the camera path and frame it despawns on. Entrances 0 and 1 ride a class-0x13 transport (selector 2, `CarrierPropRoutine2`) and jump down on `g_script_flags[30]`. A 0xA4-byte state block at `obj+0x1310` carries a 24-entry state index (`g_class19_states`, `0x00597298`), a sub-state, and a **nine-phase arena counter** per arena whose `g_boss4_phase_hp_fraction` share of the bar is a floor under the damage: `Boss4ResolveShot` (`FUN_00491B40`) takes hit points only on **bone 2** (head damage by rank and player count) or a flesh (`0x3D`) surface, and refuses every shot below the floor until the boss's own camera cue has run and the arena seats him for the next phase. He approaches and strikes, charges past the camera, and in phases 3 and 13 throws the two props he carries (`g_prop_behaviours[2]`). The gates: the entrance raises `g_script_flags[31]` (`0x0049390C`, `0x00493B99`) once its own intro banner (`BossIntroBannerUpdate`, `FUN_00437AC0`) has run 300 frames and set the shutter to 1, and `Boss4StateDeath` raises `g_script_flags[32]` (`0x004958C7`) on frame 0x46 of the death clip. **Ported** (`game/class19/`, every state; `docs/re/boss-strength.md`), and `web/tools/boss4_fight.mjs` plays both routed arenas to flag 32. | `[proved]` |
| `0x14` | `Class14Init` (`FUN_00475E90`) | 5 | **The stage-2 boss** (the Hierophant). Character type `0x47` = `boss2.bin`, fought over water on `sanbasi.bin`'s pier. Init allocates a **0xBC-byte behaviour block** (`ActorAllocSub`) at `obj+0x1310` and points `g_class14_state` at it, raises `obj+0x34 \| 0x8000` (out of the shot test until the fight), builds the skinned model, increments both enemy counters, seats a 30-unit shot sphere at `obj+0x124` and a 6.0 camera rise, and installs `Class14Update` (`FUN_00476150`): the shot, the state, **then** the pose and the clock (`Class14AdvanceMotionAndPublishPoints`, `FUN_00476AD0`: the feet, a ±0.3 y-follow onto the ground under the planted foot, a two-bone leg IK, and two flipbooks on bone 1 -- B's frame is the weak point's damage window), the route steering, the phase ladder, `ActorRegisterCameraPoint(state+0x0C)` (which registers it for the shot test) and the adaptive rank. `g_class14_states` (`0x00596218`), **21 handlers**; `tail+0x01` is the one it starts in and the only thing that tells the five spawns apart: **stage 2 blocks 35, 37, 39 and 41 are four alternative endings** (states 0, 1, 3, 4) and stage 5 block 3 is a cameo (state 2). Entrances A and B spawn the **boss-name banner** (records `0x005966B8`/`0x005966F8`) and raise flag 9, the banner opens the shutter 300 frames later, and the hand-over raises flag 10, spawns the health bar at (320, 35) and sets `g_boss_engaged`. Only **bone 1** damages it, only through a 3.5 sphere four units up the bone, only with flipbook B at least 19 frames open and the shot inside that frame's cone (`g_class14_damage_cones`); damage `g_class14_bone_damage[rank][players-1]`, multiplied only in Original Mode, capped at 33. `Class14AdvancePhase` (`FUN_00477E60`) walks `state+0x08` as the hit points fall past `g_class14_phase_hp_frac`, and that phase is the whole of **which of `g_script_flags` 10..17 and 31 the boss raises** -- 21 of the game's `wait_script_flag` gates. Two summoning rounds call class-0x51 fish (sub-types 1 and 2) under the wave field's surface; the scripted breaks take the camera for a 161-frame `cp_` cut through `g_camera_driver_held`. **Ported whole** (`game/class14/`), with the engine's own model block (`game/skeleton.ts`) so every bone the class reads is this frame's. See `docs/re/boss-hierophant.md`. | `[proved]` |
| `0x32` | `Class32Init` (`FUN_0047F5F0`) | 2 | **The stage-5 boss.** Character type **`0x4B`**: fifteen nodes, eleven of them `boss5.bin` models and four `boss5b.bin` (bones 3, 4, 10, 11), 450 hit points. One descriptor (evt `0x3D84`), spawned twice: stage 5's block 7 and block 9, the Boss Mode entry. The tail is read through `obj+0x1390`: `+0x00` the type, `+0x02` the state it starts in (0), `+0x04` the damage a hit does (10), `+0x10`/`+0x12`/`+0x14`/`+0x1A` its projectiles' hit points, trail interval, radius factor and held trail interval, `+0x19` the afterimage interval, `+0x1C`/`+0x20` the projectiles' burst, `+0x28` an unreachable steering speed, `+0x2C`/`+0x34` the death sequence's length and burst interval. Both enemy counters, from the `Init` to state 3. Twelve states (`g_class32_states`, `0x00596738`) walked by a five-row phase ladder (`g_class32_phases`): hop beside the camera and cast projectiles, circle the camera and lunge, twice each, then a final barrage; only bones 4, 6, 11 and 13 take damage. Its projectiles are `0x13F4`-byte actors of their own (`Class32SpawnProjectile`, `FUN_0047EE30`) that register for the shot test; six more task kinds only draw. It raises `g_script_flags[22]` (Boss Mode), `[24]` and `[30]` -- the last on the 299th frame counting the outro camera's frame 170, the gate both of stage 5's `wait_script_flag 30`s wait on. **Ported** (`game/class32/`; `docs/re/boss-magician.md`). | `[proved]` |
| `0x12`, `0x13` | `ScriptedPropInit12` (`FUN_0043F9D0`)/`ScriptedPropInit13` (`FUN_0043FE10`) | 3/23 | **Script-driven animated props**, sharing the 10-entry `g_prop_behaviours` at `0x005926A8`. **Class 0x12 is a slot strip a script flag starts** (`ScriptedPropUpdate12`, `FUN_0043FA60`): its Init fills a 0x1C-byte block from the tail -- `+0x00` the slot it waits on, `+0x02` a delay, `+0x04` a shot-mesh `coli` pointer into `obj+0x14C`, `+0x08` the behaviour, `+0x0A`/`+0x0C` the despawn camera path and frame, `+0x0E`/`+0x10` the strip's first and last slots, `+0x12` the script flag, `+0x14` the cursor's step, `+0x18` the scale -- and the update draws `AssetDrawSlot(__ftol(cursor))` under class 0x13's `T; RotX; RotZ; RotY` until the flag is up, counts the delay down, jumps to the first slot and leaves the shot test (`0x8000`), then steps the cursor and despawns undrawn once it is past the last. Three spawns: **stage 1's `door_1.bin[41]`, the boards across the doorway the bin captor (`0x3D24`) bursts out of on flag 34, then `[42..95]` flying apart** (evt `0x3D88`, block 6 step 1), and `sanbasi.bin[12..90]` at half a slot a frame in stage 2 block 37 (flag 95) and stage 5 block 3 (flag 11). **Ported** (`game/class12/`); `web/tools/checks/flag_strips.ts` holds the tail's offsets to the Init's instructions. Class 0x13's Init fills a 0x1C-byte block from the opcode-0x0C descriptor tail -- `+0x00` the draw slot into `obj+0x1F4`, `+0x08`/`+0x0A` a camera path and frame that despawn it, `+0x0C` a uniform scale, `+0x10` the behaviour index, `+0x14` onward the behaviour's own operands -- and then **calls the behaviour once**, which is how entry 8 gets to install a routine before the first update. `ScriptedPropUpdate13` (`FUN_0043FE90`) draws `Translate; RotX; RotZ; RotY` plus the scale, which is a three.js Euler in `"XZY"`. Fifteen descriptors, 23 spawn instructions: five descriptors (eight instructions) take behaviour 0 (`NoOpStub`) and are static; the other ten (fifteen instructions) take 8, `CarrierPropSelectRoutine` (`FUN_00440190`), which sets `g_civilian_carrier` and swaps itself for one of seven routines by the first dword of the operand block. **Selector 1, `CarrierPropRoutine1` (`FUN_004403D0`), is stage 3's arriving boat** and is ported: eight states riding `op_` paths 350 and 351, forking at path frame `0x500` on `g_civilians_alive` -- with one alive it moors, with none it runs past. **Selector 0, `CarrierPropRoutine0` (`FUN_00440210`), is stage 2's boat** (block 16 step 11, slot `0x1A36`) and is ported: it rides `op_` path 337 from the camera's frame, strikes the wall at ride frame `0x276` (`SIBUKI2_16.WAV` and a 94-frame `eff_dokan.bin` strip at a fixed world point) and coasts to `g_carrier_routine0_ride_end` (710). **Selector 6, `CarrierPropRoutine6` (`FUN_004413C0`), is stage 3 block 7's boat** (evt 29240, a civilian and its class-0x18 captor aboard) and is ported: routine 1's machine on `op_` paths 352/353, forking at `0x635`, with the run-past arm rearranged (fade at `0x668`, splash at `0x6A4`, `obj+0x34 \|= 0x400000` with the state change at the path's end). Both routines' draws are ported: the wakes (`CarrierDrawGroundWake`, `FUN_00440770`, for selector 1), selector 0's splash, selector 1's state-5/6 strip and its bow effect (`SpawnPropStripEffect`, `FUN_0043FCA0`, kind 3). `game/class13/`. **Selectors 2 and 9, `CarrierPropRoutine2` (`FUN_004408A0`), are the stage-4 boss's transport** and are ported. **Selectors 4/7 and 5/8, `CarrierPropRoutine4` (`FUN_00440C20`) and `CarrierPropRoutine5` (`FUN_00441000`), are stage 4's two set models round the boss's entrances**, `st4_09.bin[0]` and `[2]` (slots `0x954`/`0x956`, authored in world space), and are ported: seven states that ride `op_` path `0x176`/`0x177` at the camera's frame (7 and 8 arrive seated at its end) less three literals that put the last key on the origin, shake the screen and draw a camera-facing strip (`eff_colo.bin[36..45]`) while they ride, then wait for a camera path and frame and play effect `0x15`/`0x18` (`eff_colo.bin`'s two eighteen-part trees) through `EffectDrawUnlit` on motions `0x1CC` and `0x1CD` of `komono_colo.bin`, one then the other; selector 4 writes `0x954` into `obj+0x1F4` at camera frame `0x38E`. `web/tools/checks/carrier_routines.ts` holds them. **Selector 3, `CarrierPropRoutine3` (`FUN_00440AD0`), is stage 4's monitor** (`[likely]`, from `colo_monitor.bin[14]`, slot `0x966`, and `STAGE4_SE\MONITOR3.wav`), and is ported: one descriptor, evt 35916 at `(318.28, 0, -353.92)`, spawned at blocks 23 and 25 step 1 op 10 and blocks 27 and 29 step 1 op 47 (despawn cue camera path 180 frame 0). It never moves: eight states through the jump table at `0x00440C00` play `MONITOR3`, step a cursor over `0x958..0x95D` that nothing draws, take the draw alpha `sub+0x18` from 1.0 to 0.7 by 0.03 a frame, wait for camera frame `0x1DF` and `0xBA` more, bring the alpha back, step the cursor down and `ActorKill`; from its second frame the prop is drawn in layer 9 (`SetDrawLayerNibble(9)` before `ScriptedPropUpdate13`'s draw). Routines 1 and 6 leave state 6 through `CarriedPropIsOnScreen` (`FUN_004459C0`) -- the sphere of radius `obj+0x124` (40) at the view-space point the update's draw left in `obj+0x70` the frame before, projected at `g_projection_distance_px` against 640x480 -- raising `0x4000000` and going to state 7, which despawns; ported. The table's other entries are listed under the class-0x13 orientation notes above. | `[proved]` |
| `0x18` | `CarriedZombieInit18` (`FUN_0045CD60`) | 3 | **A zombie that rides a carrier.** The Init is `EnemyZombieInit` plus `obj+0x13B0 = g_civilian_carrier`, so the actor *is* a class-0x30 zombie -- same tail, same 54-state machine, same counters -- whose descriptor position is relative to the carrier. `CarriedZombieUpdate18` (`FUN_0045CD90`) pushes `Translate; RotX; RotZ; RotY` off the carrier around the whole ordinary update. Two exits: while the camera is on path `tail+0x0C` and **before** frame `tail+0x0E` (`JGE` past the arm at `0x0045CE07`), it is sent to state `0x2E` from the state at `tail[3]`, and reaching state 7 sub 1 with `obj+0x1330 == 2` bakes the carrier transform into the position and puts the plain `EnemyZombieUpdate` back -- the zombie stepping off. The three script spawns are stage 3 block 0 step 6 on the boat above, and civilians' captors are class 0x18 too (3072, 29136), character type 5 (`znnick`). Its update runs `EnemyZombieUpdate` and so `ZombieOnShot`, which is how a shot rider dies. Its initial clip is class 0x30's, 0x3BC — without that `MOTION_RULES` row the exporter emitted the spawns as markers and no rider was ever built. When its script ends it enters its descriptor's attack state (`tail[3]`), and the class's own cue picks between two outcomes: short of the cue frame it holds aboard facing the camera (`ZombieStateHoldOnCarrier`, state 46, `FUN_0045CFC0`); past it, it leaps off (`ZombieStateLeapOffCarrierForward`, 47, `FUN_0045D120`, or aimed at a mark on the bank, `ZombieStateLeapOffCarrierAtMark`, 48, `FUN_0045D500`), baking the carrier's matrix into its own pose with `CarrierBakeWorldPose` (`FUN_0045D920`). The cue fires while `g_cam_path_frame < tail+0x0E`, not after it. Stage 2 block 16's boat rider (evt `0xA174`, state 47) is the fourth spawn. **Ported** (`game/class18/`, `game/class30/carrier_rider.ts`); the same carrier transform serves `CivilianUpdateOnCarrier` (`FUN_0048B140`), which is the seven civilians whose `obj+0x11C` is non-zero. | `[proved]` |
| `0x22` | `Class22Init` (`FUN_0049B0D0`) | 4 | **JUDGMENT's flier, stage 1's boss and stage 5's re-appearance.** Character type `0x45` (literal; the tail's byte `+0x00` is unread), plus a character-type-`0x46` sub-actor at `obj+0x13B0` seated on node 1 every frame. `tail+0x01` is the variant and picks the table base `obj+0x1310` is relative to (`g_class22_states`, `0x00598000`): **0** stage 1 block 0's cutscene cameo (rides `op_st1` 0x100..0x102, waits `g_script_flags[0xF8]`, no counters); **1** stage 1 blocks 14/16 (banner, ride-in on `op_st1` 0x103, fight, death raises **`g_script_flags[3]`** at `0x0049CC95`); **2** stage 5 block 1 (descent on `op_st5` 0x17F, fight, death raises **`g_script_flags[0]`** at `0x0049CC85`); **3** only in `advevtbl.bin`. Variants 1/2 spawn the class-0x23 companion from the nested descriptor at `tail+0x10` and fight in two phases: 300 hit points, phase 1 riding `op_st1` paths 0x104..0x13F in the companion's frame down to `tail+0x0E` (90), phase 2 flying camera-relative paths 0x140..0x144. Its own damage model (`Class22ChargeShots`: 30 a hit, 25 with both players attackable, 120/10 points, 1500 for the kill), `BossHpBarSpawn(320, 35)` and `g_boss_hp_fraction` every fight frame. **Ported** (`game/class22/`, all four variants), drawn by `render/characters/judgment.ts` (object rotation order 5, the sub-actor's seat, node 1's two extra models) and registered for the shot test at the exe's two sites. See [`docs/re/boss-judgment.md`](../re/boss-judgment.md). | `[proved]` |
| `0x23` | `Class23Init` (`FUN_0048FD90`) | 3 | **JUDGMENT's walker, the flier's companion.** (Two of the three are nested descriptors no spawn opcode names, the third is Training's.) Character type `0x44` (literal), 90 hit points it never loses outside Training. Spawned only by class 0x22's `SpawnFromDescriptor(tail+0x10)` (stage 1 `0x61AC` subtype 0, stage 5 `0x14E4` subtype 1) and directly by `trnevtbl.bin` block 9 (subtype 2). Walks at the camera by root motion, strikes with `PlayerTakeDamage(p, 1, 4)`, and every hit it takes adds 1 to the flier's `obj+0x132C` (`Class23TakeShots`) -- the only way it hurts the flier. Holds both enemy counters from spawn; collapses (alive -1, then present -1) the frame the flier's hit points fall to its own, which is the flier entering phase 2. **Ported** (`game/class23/`) for subtypes 0 and 1, with the landing ring (`Class23LandingRingUpdate`) drawn by `render/slotmodels.ts`; Training's subtype 2 is read but not ported, because no bundle carries `trnevtbl.bin`. See [`docs/re/boss-judgment.md`](../re/boss-judgment.md). | `[proved]` |
| `0x27`, `0x28` | `004329D0`/`00432610` | 2/6 | **Path-riding objects.** `0x27` is `PathRidingVehicleUpdate` (`FUN_004329D0`): stage 2 block 0 step 2's one `spawn_placed` (evt 1060) names two descriptors, 1920 (`obj+0x11C` 0) and 1960 (1), at the origin. With no `Init`, its first frame writes `obj+0x13F0 = 0x2B` (`char_adv04.bin` 0) and every frame poses it at `CamEvalObjectPath6(dword [0x00589AE8 + obj+0x11C*4], (float)g_cam_path_frame)` -- rows 2 and 3 of `g_class28_route_table` read as dwords, `op_st2` `0x149` and `0x14A` -- with no camera-path test; the first frame `g_cam_path_frame >= 0xBE` (the last of the step's `cp_st2` 1 play, the car's shot) it raises `obj+0x1324`, writes `0x13F0 = 0x33` (`char_adv04.bin` 8) and installs `PathRidingVehicleHeldUpdate` (`0x00432AF0`), which never poses again and `ActorKill`s on `g_script_flags[0] == 1` (stage 2 block 3 step 3). A skip does the same after that frame's draw, posed at 190.0. `PathRidingVehicleDraw` (`0x00432B10`) draws `0x13F0` under `T Rz Ry Rx` and, while `obj+0x1324` is up and `obj+0x11C < 2`, steps `obj+0x1320` and draws `0x1433 + n % 0x28` (`n < 0x28`) or `0x1AAB + n % 0x28` at `y + 5.0` turned to the camera block's eye, then `0xB67 + n % 8` 5.0 further along that yaw at five times its size. **Ported** (`game/class27/`), drawn by `render/view_slots.ts`. `0x28` is `PathRidingPropUpdate` (`FUN_00432610`), stage 1's two burning cars: `spawn_placed` (opcode 9, no tail) in blocks 5, 11 and 14 with `obj+0x11C` 0 and 1, the index into `g_class28_route_table` (`0x00589AE0`, `{s16 op_ slot, s16 freeze frame}`: `{0x145, 671}`, `{0x146, 667}`, `{0x149, 0}`, `{0x14A, 0}`). `obj+0x1312` 0 writes `obj+0x13F0 = 0x33`, `obj+0x1320 = 0` and poses the object once at `CamEvalObjectPath6(slot, freeze)`; 1 launches (`obj+0x1320 = 1`) the first frame `g_active_cam_path == 0x2F` and `freeze <= g_cam_path_frame`; 2 `ActorKill`s once `g_cam_path_length[slot] <= g_cam_path_frame` (725, 765), with no camera test; while launched the pose is the path at `g_cam_path_frame`. In `g_app_state` 10 the first frame instead copies a literal pose from `g_class28_fixed_poses` (`0x0055DD18`) and installs `PathRidingPropFixedPoseUpdate` (`0x00432810`, killed on camera path 8). `PathRidingPropDraw` (`0x00432840`) draws slot `0x33` under the pose and, until the launch, two camera-facing sprite loops. **Ported** (`game/class28/`), drawn by `render/rigs.ts` from the actor. | `[proved]` |
| `0x20` | `OneHitTargetInit` (`FUN_00448ED0`) | 36 | **The one-hit target.** A skinned actor — all 36 are character type 7, `char_adv00.bin` — that **dies to any single hit**: nothing in the class subtracts from `obj+0x11C`, so the branch on `obj+0x34` bit 3 is the whole damage model. Scores like the combat classes — 10 a bone, 120 + `g_head_combo_bonus` on bone 2, 80 for the kill — then plays motion 988, holds its last frame and sinks 0.04 a frame for 120 frames before despawning. Not an enemy: the Init increments no counter, so no `wait_enemies_alive` gate sees one. Un-shot it is removed when the camera reaches `tail+0x02` at frame `tail+0x04`. `obj+0x130C` is a sub-type: 0 stands (7 spawns), 1 spins ±0x40 BAMS a frame with `obj+0x11C` as the direction (5), 2 is clamped into an x/z box at `tail+0x08`..`+0x14` and turns 0x100 away at each wall (24). Motion comes from `tail+0x06`, and **0 there means `g_class20_idle_motions[rand() & 3]`**. **Ported** (`game/class20/`). | `[proved]` |
| `0x2A` | `Class2AHandlerKill` (`FUN_00432D40`) | 4 | **Dead class** — the whole handler is `JMP ActorKill` (`0x004A7040`): the object dies on its first walk having done nothing. Stage 2 spawns four (blocks 8, 11, 12, 25). The port builds no object for the class, which comes to the same thing, so there is nothing to port. | `[proved]` |
| `0x60` | `ChapterCardInstall` (`FUN_004342E0`) | 8 | **The chapter card**, and the actor `wait_script_flag 0xF8` waits for. Placed by `spawn_simple` (0x0A), not by a placement descriptor: its whole record is `{class 0x60, hp 0}` in `comevtbl.bin` at `0x00977234`, so it has no position at all. An installer first — `g_GameMode == 3` and `g_app_state == 0x0B` each swap in a different update — then a two-sub card: sub 0 seats the lights and the eight text slots at `0x007DCBA0` and latches `obj+0x11C = 0xB4`, sub 1 draws and counts it down, and at zero it raises **`g_script_flags[0xF8]`** at `0x004348C1` and `ActorKill`s. That one instruction is the only literal writer of flag 248 in the image. A pad press (`g_pad_state` bit 2) cuts the dwell short once it is below `0xA0`, and bit `0x20000` cuts it at any time (`0x00434802`–`0x00434826`: the dwell is set to 1 and the decrement straight after takes it to zero). While it is up, bit `0x20` of `g_screen_furniture_flags` is set, and `RegionDrawResidentSet`, `ScriptedHumanoidDraw`, `SetPiecePropDrawAndTick`, `St1VehicleUpdate` and `Class22CutsceneHoldUntilChapterCard` all test it — the card is a full screen with the world stopped behind it. **Ported** (`game/class60/`) — the lifetime, the flag and the furniture bit (`OR AL, 0x20` at `0x0043436B` in sub 0 and in both installer arms, `AND AL, 0xDF` at `0x004348C7` after the flag); the card itself is screen furniture the player does not draw, and by the user's decision the port takes the `0x20000` skip on every card, so the flag is up on the card's first update — and bit `0x20` goes up and down inside that one update, as it does in the exe for a player who skips on the first frame, so no reader ever sees it. | `[proved]` |
| `0x61` | `ResultCardInstall` (`FUN_00434EF0`) | 5 | **The stage-clear card**, and `wait_script_flag 0xFE`'s only opener: a whole-image byte search for `0x009C72FE` finds exactly one instruction, `MOV byte ptr [0x009C72FE], 0x1` at `0x0043567C`, and it is this actor's last act. Sub 0 plays bgm 3 (`CLR.WAV`), drops `g_nFiringGate`, raises bit `0x10` of `g_screen_furniture_flags`, latches `obj+0x11C = 0x1A4` (420 frames) and allocates one **figure** per rescue in the scene -- the rescued civilian's type at the scene's `g_result_figure_records` place (`ResultCardFigureInit` / `ResultCardFigureUpdate`, `FUN_004356A0` / `FUN_00435760`) -- or, with none rescued, the scene's own list; sub 1 waits for the dwell to reach `0x78`; sub 2 adds `g_result_life_bonus[scene][min(rescues, 7)]` to both players' lives, capped. Every frame draws the `scr_result` frame and the `result.bin` glyphs (rescues counted up, the life bonus, each player's score and accuracy) and counts the dwell down; at 0 the flag, the bit down, `ActorKill`. `HudDrawShutterState` (state 4) and `HudDrawLives` stand aside for the bit. The whole sequence is [`docs/re/stage-end.md`](../re/stage-end.md). **Ported** (`game/class61/`), whole: the figures, the life bonus, the frame, the glyphs, the score and the accuracy, drawn by `render/view_slots.ts`, `render/screen_sprites_deep.ts` and the character layer's figure templates. | `[proved]` |
| `0x62` | `ResultCardTally` (`FUN_00435930`) | 5 | **The result card's loader**, placed by `spawn_simple 0x00977244` immediately before it and waited for by the `asset_wait_tex_pol_jobs` between them: `scr_result` (texbank `0x16A`), `result.bin` (pol `0x7C`), and each figure's model file (pol `type + 0x85`) and attachment models; then `ActorKill`, on its first frame. **Writes no script flag.** Ported (`game/class62/`): the loads are the bundle's, and the kill takes it out of the pool on its first frame. | `[proved]` |
| `0x63` | `InitCutsceneSkipWatcher` (`FUN_00435F20`) | 45 | The commonest `spawn_simple` record (`0x0097724C`), at the top of most steps in every stage. Installs `CheckCutsceneSkipRequest` from the task table at `0x005934E4`; the installed update `ActorKill`s outright while `g_nEvtSkippableRegion` (`0x009A2D7C`) is zero, and on `g_nSkipRequested` (`0x009A1A18`, Start in a region with the firing gate down) ends the camera move where it stands, raises `g_nEvtSkipFlag` and `g_cutscene_skipping` and installs `FinishCutsceneSkip`, which clears the latter on its next run and dies. **Writes no script flag.** **Ported** (`game/class63/`); `Walker.requestSkip` raises the request. | `[proved]` |
| `0x64` | `ScoreRouteSelect64` (`FUN_00435FB0`) | 3 | **Stage 6's route selector**, `spawn_simple` in blocks 3, 5 and 9 (`{0x64, 0/1/2}`), and the whole object: run on its first walk, it writes `g_script_branch_var` 0 and then, by `obj+0x11C`: 0 → 1 when `(u16)g_civilians_rescued_total == g_civilians_seen_total` (every civilian the run created was rescued), else 2 in Original Mode at 70000 points; 1 (Original Mode only) → 1 at 100000, else 2 at 70000; 2 → 1 under 100000, in either mode. Two players in play (`g_active_player == 2`) weigh their summed score. `ActorKill` on every path. `g_civilians_seen_total` (`0x009A21BA`) is raised by `CivilianInit`, `RescueTargetInit` and `PropUpdateType19` and read by nothing else. **Ported** (`game/class64/`); before it the three blocks always left by `next[0]`. | `[proved]` |
| `0x65` | `EndingRouteSelect65` (`FUN_00436140`) | 1 | **The ending's route selector**, `spawn_simple` in `endevtbl.bin`: route 1 when a player's `ScoreRankForPlayer` is 0, else 2 when the score is a multiple of 10, else 0; `ActorKill`. Not ported -- the port has no ending scene. | `[proved]` |
| `0x6E` | `ItemSelectUpdate` (`FUN_00488820`) | 1 | **Original Mode's trunk**, the item select at the start of stage 1: one `spawn_simple` record, in `stage1_original`'s block 0 step 5, behind `asset_load_polfile 0x49` (`car_org.bin`, the trunk and its lid) and followed by `wait_enemies_present 0`, which it holds by writing `g_enemies_present = 1`. It copies the saved items into `g_original_items_taken`, opens the lid under camera path `0x36`, runs the two-column menu for each player in play on the pad word, and on its last frame (`ItemSelectFinish`, `FUN_004895C0`) applies the items (`ItemSelectApplyToPlayers`, `FUN_0048A140`) and points the script at step 1, instruction 0. **Ported** (`game/class6e/`), with a `[port-only]` hit test that turns a tap or a click on a row, a held item, END or a scroll mark into the pad bits. See [`docs/re/original-mode.md`](../re/original-mode.md). | `[proved]` |
| `0x46` | `PlaceBats` (`FUN_0042D9C0`) | 27 | **The bat**, and two things say so: character type `0x1E` is `zabat.bin` and the wing actor's `0x1F` is `zabat_wing.bin`, and every death plays `COMMON2\KOUMORI1_22.wav` or `KOUMORI2_22.wav` — *kōmori*. (These are the records the owl row notes as existing and unplayed by class `0x43`; this is the class that plays them.) A **placer**: every path through the handler ends in `ActorKill`. `obj+0x130C`, the opcode-0x09 descriptor's `+0x25`, picks one of three flights, and each member is a `0x13D8`-byte actor with clip `0x407`, a 4.0 shot sphere, `BatDrawBoneSlot` at `obj+0x12EC` and a separate wing actor from `SpawnBatWings`. **Sub-type 0** (24 spawns, four flights of six) is one bat per descriptor running `BatDiveUpdate`; **sub-type 1** (1 spawn) builds 25 running `BatScatterUpdate`; **sub-type 2** (2 spawns) builds 6, or 8 with two players, running `BatSwarmUpdate`. Sub-types 0 and 2 increment **both** enemy counters and give them back on despawn; sub-type 1 touches neither. 80 points, no hit points at all — `obj+0x11C` is a member index, not health. **Ported** (`game/class46/`) — all three sub-types, the wing actor, the shot and the splash, and every bat and wing is drawn: the exporter emits a synthetic row at the address the port's placer gives each runtime child (`BatChildAt`, `BatWingAt`), parented to the placer's descriptor — one wing row per sub-type-0 descriptor, 25 bodies and 25 wings behind the scatter's, 8 and 8 behind each swarm's. See *The bat's four flights* below. | `[proved]` |
| `0x45` | `Boss3ClassHandler` (`FUN_0041FC00`) | 37 | **The stage-3 boss** ("the Tower"): `boss3.bin` (`0x49`) and `boss3l.bin` (`0x48`), sounds `STAGE3_SE\BOSS3_n` / `STAGE6_SE\BOSS3_n`. `desc+0x25` is a subtype (jump table `0x0041FD8C`): 0 the opening head and 1 its bystander (blocks 11/13), **2 the five heads** (`desc+0x22` = index 0..4; idx 2 is the big `boss3l` head and the only one that counts), 3 two held bystanders, 5 **the body** that swims a path, drives the camera and lunges; 4 is `NoOpStub`. `g_boss3_variant` from the block: stage 3 blocks 11/15 → 0, 13/17 → 1, stage 6 block 2 → 2 (heads only). Writes **no** script flag; reads 0–4. Opens the `wait_enemies_present 0` gates: head idx 2 decrements both counters 180 frames after the heads fall, the body at its death. Heads 45 hp (30 in stage 6) on the weak bone with the jaw open; the body 120 hp. `BossHpBarSpawn(320, 35)` twice per stage-3 fight. Read in full, not ported: [`docs/re/boss-tower.md`](../re/boss-tower.md). | `[proved]` |

The row above used to read *"`0x20`, `0x45`, `0x46` … Not reached. `0x20`
has a call to the HP scaler at `0x0044964A`, so it is `[likely]` a combat
actor."* **Both halves were wrong**, and in the same way — `0x0044964A` is
inside `EnemyThrowerInit` (`0x00449620`), which is class 0x31's handler, not
class 0x20's. Class 0x20's handler is `0x00448ED0`, and the two are only
adjacent in the file. That is the adjacent-array trap in its function-pointer
form: the handler was found by looking near where it ought to be rather than
by reading `g_class_handler_pairs`, which names it outright. Class 0x20 is
reached in four of the six stages, has no hit points at all, and is written
out in full below.

### The bat's four flights, and where they come from

**[proved]** The twenty-four sub-type-0 descriptors all sit at the world
origin with a yaw of `0x8000` and differ only in two bytes, because the bat's
whole path is in the EXE rather than in the script:

* `+0x11C` is `1`..`6`, the **member index** plus one. `PlaceBats` writes
  `obj+0x1377 = +0x11C - 1`, and in a **one-player game members 5 and 6 are
  never built** — the guard is `1 < g_players_in_play || +0x11C < 5`.
* `desc+0x24` is the **flight group**, `0`..`3`, one per site.

The two select a row of `g_bat_spline_points` (`0x00589944`, `s16 pts[12][4][3]`)
as `group * 3 + member % 3`, so the six members of a flight share three paths
two apiece. `BatDiveUpdate` walks it as a **uniform quadratic B-spline** —
`BatSplineWeights` (`FUN_0042DFD0`) gives `(1-t)²/2`, `(1-t)t + ½`, `t²/2`,
which is why a bat starts at the midpoint of the first two control points and
not at the first — over two segments, `t` stepping `0.05` a frame, so 40
frames of scripted flight after a launch delay of `member * 20`.

| Group | Where | Spline slots |
|---|---|---|
| 0 | stage 4 block 0 step 6 | 0, 1, 2 |
| 1 | stage 3 block 4 step 5 | 3, 4, 5 |
| 2 | stage 4 block 2 step 6 | 6, 7, 8 |
| 3 | stage 4 block 10 step 1 | 9, 10, 11 |

Past the spline the bat **homes on `g_camera_block_eye`**, `obj+0x13A4` running
0 to 1 at `0.015` a frame — about 67 frames — with a sideways sine wobble whose
amplitude damps to nothing over the last fifth. On arrival it calls
`PlayerTakeDamage(player, 1, 9)` if either `g_player_state` is 5 (read bare,
not through `IsPlayerAttackable`; `PlayerEnterPlay`, `FUN_00414770`, is what
puts a player at 5), hands both enemy counters back and despawns. **There is no range test and no attack
permit: an unshot bat always connects, and always leaves.** That is also why
the `wait_enemies_present 0` at the end of each of these steps cannot deadlock
— the flight ends itself.

A diving bat takes a hit only while `obj+0x1376` is 1 — the test is
`!= 2 && != 0` (`0x0042E294`..`0x0042E29F`) — so it **cannot die during its
launch delay; but it is registered for the shot test in every state**, and
bit 3 of `obj+0x34` is cleared only by the arm that takes the hit
(`AND AL, 0xF7` at `0x0042E2A5`). A shot that lands while it waits is still
standing on its first flying frame, and kills it then. Sub-type 2 gates only
on `!= 2`, so a swarm bat *is* killable while it is still orbiting. The
scatter has no test at all: it takes its hit **inside** its flying arm, which
then runs on — the kill frame is still a flying frame — and it registers for
the shot test at the end of that arm alone (`0x0042ED16`), so a waiting or
falling scatter bat cannot be hit.

The wing is a second skinned actor, not a part of the body. `BatWingUpdate`
(`FUN_0042F660`) finds its body each frame in `g_bat_members`
(`0x007DC918`, 25 slots per sub-type), seats itself at
`g_camera_blocks[cur] * body+0x2C4 * (0, 1, 2)` — `body+0x2C4` being node 1's
draw record `+0x28`, the matrix `SkeletonEmitNode` (`FUN_004114C0`) stores
after the node's own translate and turn, so the seat carries the body's pitch
and roll, its 0.6 model scale, the clip's root height and both of the clip's
rotations — takes `obj+0x64 = 0xE800` and `obj+0x68 = body+0x68 + 0x8000`,
copies the body's motion frame counter, and **despawns the frame its body's
slot goes empty**. It never registers for the shot test or the camera: the
routine ends on its draw (`0x0042F7D8`). Its clip comes from a paired lookup in
`g_bat_body_motions` / `g_bat_wing_motions`, both of which ship five identical
rows, so the answer is always `0x406`.

Every body and every wing builds its model (`ActorBuildSkinnedModel`, so each
claims a `g_hit_slots` entry in build order), is drawn in rotation order 5
(`obj+0x1FC = 5`: `Rz Ry Rx` after the translate) and at its character type's
size (0.6 for `0x1E`, 0.7 for `0x1F`).

**The splash** `[proved]`: a scatter or swarm corpse that falls past
`y = -25` calls `SpawnBatSplash` (`FUN_0042F980`) with its own `x, y, z`,
which allocates a `0x50`-byte task running `BatSplashUpdate` (`FUN_0042F930`)
at `(x, -25.0, z)` — the `y` argument is not read. The task draws
`AssetDrawSlot(0x1339 + n)` under a bare `MatrixTranslate`, `n` running 0 to
`0x1D` one a frame from the frame it is made, and kills itself after the
thirtieth: `common.bin` 307..336, the same run the owl's and the fish's water
splashes use. The sound (`SIBUKI8`) is the caller's, and the swarm plays it in
stage 3 only.

`web/tools/checks/bats.ts` asserts the whole chain — the 24/1/2 sub-type split,
the four complete flights, the twelve spline slots they reach, both motion
tables and both character types.

### Class 0x25's `op 10` is an `if`, and it is not a player *count*

**[proved]** `ScriptedHumanoidUpdate` (`FUN_004842A0`) case 10 at `0x0048478C`
is the VM's only branch that is not a jump, and it is the mechanism by which
**the player's own character stands in a third-person cut scene**.

```
0048478C  MOV EAX,ESI                    ; the command
0048478E  MOV [EDI+0x1320],EBX           ; stallFrames = 0
00484794  ADD ESI,0x8                    ; and, by default, step one command
00484797  MOVSX EAX,word ptr [EAX+0x2]   ; the mode
0048479B  SUB EAX,EBX  / JZ 00484809     ; mode 0
0048479F  DEC EAX      / JZ 004847D9     ; mode 1
004847A2  DEC EAX      / JNZ 0048435D    ; anything else: nothing more to do
004847A9  CMP dword ptr [0x009c7000],0x2 ; mode 2
004847B0  JZ 0048435D                    ; it matches -- fall into the arm
004847B6  MOV CX,word ptr [ESI+0x2]      ; ...it does not: scan for the marker
004847BA  ADD ESI,0x8
004847BD  CMP CX,-0x2 / JZ 0048435D
004847C7  MOV DX,word ptr [ESI+0x2]      ; ...and again, eight bytes at a time
004847CB  ADD ESI,0x8
004847CE  CMP DX,-0x2 / JNZ 004847C7
```

Three facts, each of which the port had wrong:

* **`0x009c7000` is `g_active_player`, not `g_players_in_play`.**
  `SelectAttackablePlayer` (`FUN_00414F40`) writes -1 for nobody, 0 or 1 for
  that player alone and 2 for both — and for one player in play it picks 1
  unless `g_player_state` is 5 or 7, so an ordinary single-player game on slot
  0 sits at **0**. The opcode is `if (g_active_player == mode)`, and the
  distinction matters in exactly the case it exists for: which of the two
  player characters is standing there.
* **Mode `-2` is the `endif` marker**, not a fourth comparison. The chain above
  tests 0, 1 and 2 and steps the cursor for everything else, so an `op 10 mode
  -2` reached by falling through the taken arm costs one step and nothing else.
* **The skip's stride is a literal 8.** It reads the second `s16` of each
  eight-byte window, taking no notice of the sixteen-byte commands `op 7`,
  `op 8` and `op 4` mode 4 are; no shipped arm contains one.

Stage 3's block 2 step 5 is the clean case. It spawns four class-0x25
humanoids, and two of them share one point: character type `0x39`
(`gameover_player.bin`) and `0x3A` (`char_adv05.bin`), whose programs at
`st3evtbl.bin` `0x33B4` and `0x3498` are the same shape —

```
op 0  mode -1            wait, then play
op 9  mode 1  a 0|1      the hand model, one per character
op 10 mode 1|0           if the active player is the *other* one:
op 18                        ActorKill
op 10 mode -2            endif
op 10 mode 0|2           if the active player is this one (or both):
  ... the performance ...
op -1                        end
op 10 mode -2            endif
  ... the two-player arm ...
```

So the pair is *one* character on screen, chosen at run time, and each stage-3
cut scene that shows the player has a pair of its own — `0x3378`/`0x345C`,
`0x54F0`/`0x55A4`, `0x69C8`/`0x6A5C` and `0x6C98`/`0x6D14`.

**The second of a pair can share the first one's tail.** In stages 2, 4, 5 and
6 the player-2 figure's program (`0x3A`) ends in an `op 15` that jumps back
into the commands stored *before* its own block -- player 1's performance --
rather than repeating them. `ScriptedHumanoidInit` (`FUN_004840D0`) points the
cursor at its own block's first command, `blk + 8` (`MOV [ESI+0x1394], EBP`
at `0x00484282`), and the bundle lists a program's commands in address order,
so for these the first command listed is player 1's and not the program's
start. `script.json`'s humanoid programs therefore carry **`entry`**, the
index of `blk + 8`; it is not 0 for 13 of the 137 programs, every one a
player-2 figure (`web/tools/checks/script_corpus.ts` counts them). The port
started every program at index 0 until 2026-10-05, so each of those figures
ran player 1's tail from the top, never reached its own `op 10`, and stood in
the shot on top of player 1 -- stage 4 block 4's corridor
(`?stage=4&original=1&entry=4&block=4&step=2&op=37`) is one.

### The generic props' `+0x11C`: a lifetime that is *sometimes also* a slot

**[proved]** `PlaceGenericProp` (`FUN_00461CF0`) — the constructor 44 of class
0x41's 79 types share — writes the spawn descriptor's `+0x11C` into **two**
fields of the object it builds:

```c
obj->+0x28C = placer->+0x11C;     /* the asset slot */
obj->+0x11C = placer->+0x11C;     /* the lifetime, in event blocks */
```

`PropExpireByStepLifetime` (`FUN_00466640`), which **25** of the update
routines open with, reads `obj+0x11C` as a lifetime and despawns the prop once
`g_evt_step_index` has **changed** more times than it. That counter is the event
VM's *step* index, not a block count, so `obj+0x11C` is a lifetime in event
steps — blocks average 3.99 of them. Only **three** of the routines ever
draw `obj+0x28C`:

| Type | Routine | What it draws |
|---|---|---|
| 5 | `FUN_00466820` | `obj+0x28C`; killed by script flag 0x13 |
| 12 | `FUN_00467E50` | `obj+0x28C`, scaled; removed at cam path 0x2F frame 0x96 |
| 33 | `FUN_00472950` | `obj+0x28C + n`, `n` = 0..`obj+0x2A4` (the descriptor's roll word), then `ActorKill`; it is **not** one of the 25 -- no lifetime prologue, and it draws before it steps |

Every other type hardcodes its model, or takes it from the constructor's own
switch arm, or draws no static model at all (18, 25 and 28 draw only an effect
at `obj+0x324`).

**[measured]** The two meanings never overlap in the shipped data. The distinct
`+0x11C` values stage 2's 67 generic props carry are

```
0, 1, 2, 3, 4, 5,   then   0x1D8, 0x1FA, 0xFD2, 0xFD3, 0x13B5, 0x16A6, 0x173D, …
```

— nothing between 6 and 0x1D7 — and the types carrying the high values are
exactly 5, 12 and 33. Reading all 67 as slots resolved 46 of them to
`char_adv03.bin`, `eff_boss4.bin` and `bg_adv10.bin`: characters and effects
standing in for scenery.

### Types 70 to 77: Original Mode's collectibles and their neighbours

**[proved]** Types 70, 71, 72, 76 and 77 leave on their first Arcade frame
(`if (g_GameMode != 1) ActorDespawn`, 77 with `PlaySoundId(0x800A9)` too);
types 74 and 75 raise a script flag on the way out — `g_script_flags[0x13]`
and `[0x14]`. Each is ported whole and records its own draws, as its
`g_class41_updates` row (`game/class41/original_item.ts`, `flag_prop.ts`,
`type72.ts`..`type77.ts`, registered in `generic_routines.ts`):

| type | routine | spawns | what it is |
|---|---|---:|---|
| 70, 71 | `OriginalItemPropUpdate` (`FUN_004675A0`) | 20 | a collectible: turns (70) or bobs and tumbles (71); shot, it pays a hit, counts into `g_original_items_taken`, raises `SpawnOriginalItemBanner` (`FUN_00475E40`) and plays a 49-frame pickup strip from `0x116A`/`0x119C` while the item fades |
| 72 | `PropUpdateType72` (`FUN_00470750`) | 1 | the same collectible, thrown up out of stage 2's canal at camera path `0x4E` frame `0x276` — if `g_script_flags[0x12]` is up, which stage 2's script never raises |
| 74 | `PropUpdateType74` (`FUN_00470E20`) | 1 | three shots and it drops a story item at `(-286.6, -17.3, -302.5)`, then falls; draws `0xA64` |
| 75 | `PropUpdateType75` (`FUN_004710C0`) | 1 | draws `0xA6B` at `op_` path `0x178`'s pose; shot, it rides the path 290 frames |
| 76 | `PropUpdateType76` (`FUN_00471330`) | 2 | a door (`0xA6D`) or a pair of leaves (`0xA67`/`0xA68`) that a shot swings open on hinge curve 0, and route 2 |
| 77 | `PropUpdateType77` (`FUN_004717A0`) | 24 | item 31's own model, `0x10AB`, flying `op_` path `0x195` at twice size while item 0x1F is held; shot, 2000 points |

**The collectibles' model is not the descriptor's word.** Cases 0x46, 0x47
and 0x48 call `PickOriginalModeItem` (`FUN_004629C0`) with the placer's
`desc+0x24` byte as a row of `g_original_item_tables[g_scene_index]`, and it
writes the drawn item's `g_original_item_records` model over `obj+0x28C`. So
the `+0x11C` word is a lifetime for 70 and 71 and nothing at all for 72. The
same function makes the model of every other Original Mode item: the story
item `SpawnStoryModeItem` (`FUN_00467B90`) allocates -- the same object, run by
`g_class41_updates[70]`'s routine -- type 7's drop and type 43's break (both
row 0). The bundle carries the rows the stage's placements name and the
records those rows name (`breakables.original_items`); the banner's pictures
are one-picture tex banks `0x193..0x1B4`, palette `0x14`
(`TexBankPaletteIndex`'s entry 2).

### Stage 1's church: class 0x41 types 38, 39, 40 and 44 build from tables

**[proved]** Block 1 step 2 op 16/17 of stage 1 (both modes) runs four
placers whose descriptors all stand at the origin — evt `0x1994`, `0x19BC`,
`0x19E4` and `0x1B48`, types 38, 39, 40 (sub-kind 0) and 44, each `+0x11C = 4`.
The descriptor contributes only that lifetime: every object comes out of a
table in the image. Until 2026-09-18 the port had no constructor for 38, 39 or
44 and put every type-40 object at the placer's own point with slot 0, which is
why the church had bare pews (new bug 8) and the humanoid in step 5 had its arm
round nothing (new bug 9).

| type | constructor | update | objects | draws | shot |
|---|---|---|---|---|---|
| 38 | `PlaceTable38Props` (`FUN_00463420`) | `PropUpdateType38` (`FUN_0046BCC0`) | 9, `g_prop_table38` (`0x00593E70`) | `komono_st1.bin[3]` → `[2]` once shot | r 3.0 at y−1, every frame; pays 0 |
| 39 | `PlaceTable39Stacks` (`FUN_00463510`) | `PropUpdateType39` (`FUN_0046C240`) | 8 stacks, `g_prop_table39` (`0x00593F48`) | up to 8 × `0x1237`, 0.926 apart | r 5.0 at y+3 until shot; pays 10 |
| 40 | `PlaceFragmentProps` (`FUN_004636A0`) | `PropUpdateType40` (`FUN_0046C570`) | `g_class41_fragment_counts[sk]` | `obj+0x1E0`, +1 once shot, and 40 `garasu.bin` pieces | r 5.5, rise by slot; pays 10 |
| 44 | `PlaceTable44Props` (`FUN_004639F0`) | `PropUpdateType44` (`FUN_0046D850`) | 7, `g_prop_table44` (`0x005946F8`) | rows 0–1 effect 0x13 on motion 468, rows 2–6 `komono_7.bin[0]`, all a shadow `0x10D1` ×(8,1,8) | r 5.0 at y+5 until shot; pays 10 |

* **Angles in degrees.** Tables 38 and 39 and sub-kind 1's poses store
  `{f32 x, y, z; f32 rx, ry, rz}` with the angles in degrees, turned into BAMS
  by `__ftol(deg * 182.0444)` (`0x00569010`) — truncation, not rounding.
* **Type 39's heights are computed**: `__ftol(8.0 - row * 0.4f)` after a
  32-bit store, so 8, 7, 7, 6, 6, 6, 5, 5. Row 5 is six only because the
  product goes through a `float` before `__ftol`.
* **Type 44 is chairs, by asset**: `0x1064` is `komono_7.bin[0]`, the model
  class 0x33 selector 4's pushable chairs draw, and effect 0x13's ten nodes
  are `komono_7.bin[11..20]`. Row 6, lying on its side at (−22.3, 9.06,
  −97.86), is the chair the step-5 humanoid lies against — a screenshot of
  `?stage=1&original=1&block=1&step=5&op=12&frame=500` shows his arm over it.
* **Type 40 sub-kind 0** is placed by
  `T(16.473, 16.821, 4.749) . RotY(0x278D) . T(x, 0, z)` of each row of
  `g_fragment_subkind0_offsets` and the translation read back. Sub-kind 1
  uses `g_fragment_subkind1_intact` (`0x007DCDB8`), a per-game latch: a
  sub-kind-1 object once broken is built as `0x17C7` and refuses the next hit
  until `ResetFragmentSubkind1Intact` (`FUN_00463680`). Sub-kinds 2–19 read
  `g_fragment_pose_tables[sk]` and `g_fragment_slots[sk]`, then a switch
  through the jump table at `0x00463998` (sub-kinds below 6 wrap past it on an
  unsigned `JA`). Sub-kind 11's third row is at z = −107367 in the shipped
  table; transcribed, not corrected.
* **Traps**: the decompiler ends `PlaceFragmentProps`' sub-kind-0 arm, both
  table routines' draw tails and `PropUpdateType44`'s shadow at the first
  `MatrixStackPop` (L35), and drops every `__ftol` multiplier (L1). Every
  constant here was re-read with `disassemble_bytes`.
* **`0x009A4684` is `g_motion_slots[468].state`**, the residency word the
  type-44 effect draw is gated on — the same literal-address idiom
  `ScriptFlagEffectUpdate` uses for 471.
* **The hit effect** all three table routines call is
  `SpawnPropHitEffectScaled` (`FUN_004666B0`) — effect strip `0xE25`, drawn
  `0xE26`..`0xE33` by `PropHitEffectScaledUpdate` (`FUN_004667A0`) at
  `scale * 1.5`, at the crosshair unprojected to the prop's depth. 23 call
  sites against `SpawnPropHitSpark`'s 9, and **none of types 38, 39, 40 or 44
  calls the spark**. Both ported.
* **Effect 0x13 is interpolation mode 2**, and `EffectPoseNode`'s matrix arm
  is reached on 12 node-frames of motion 468: `MatrixInterpolateSwingTwist`
  (`FUN_00412750`) — see the effect system section below. Ported.

`web/tools/checks/prop_tables.ts` compares every table word the port carries as a
literal against the image.

### Class 0x41 constructors 50 and 66: scenery and signs out of tables

**[proved]** from `PlaceTable50Props` (`FUN_00463BA0`),
`PlaceTable66Props` (`FUN_00464500`) and `PropUpdateType66` (`FUN_0046FE00`),
all read in the disassembly. Both descriptors stand at the origin; `+0x1F4`
(the s8 at `desc+0x24`) names the table and `+0x11C` is the step lifetime every
object copies. Unported until 2026-09-29, when stage 1's bin-scene crate was
empty, stage 2 block 17's four `komono_st1.bin[3]` models hung in the air and
no sign in either stage was drawn.

| ctor | update | tables | shipped |
|---|---|---|---|
| 50 | `PropDrawOnlyType12` (`FUN_00467E50`), handed to `ActorAlloc` directly — `g_class41_updates[50]` is `NoOpStub` | `g_prop_table50_ptrs` (`0x00594F08`) → six tables of 28-byte rows `{u16 slot; pad; f32 x,y,z; s32 rx,ry,rz}`, counts `g_prop_table50_counts` (`0x00594F20`) 7, 11, 4, 5, 6, 5; table 5's Z scale `g_prop_table50_scale_z` (`0x00594EF0`) | table 5 stage 1 blocks 3, 8 (evt `0x2D9C`); **table 3 stage 1 block 4 step 3 (`0x3B14`), lifetime 4 — the five `komono_st1b.bin` models on the bin-scene crate**, alive at block 6 step 1; table 4 stage 2 block 7 (`0x3580`); table 1 block 8 (`0x43DC`); **table 2 block 17 step 1 (`0xBE60`) — `komono_suimonie.bin[5]`, `[6]`, `[7]` twice, the last two under the four class-0x13 models**; table 0 block 25 (`0x116C0`); table 3 again in training block 1 |
| 66 | `PropUpdateType66` (`FUN_0046FE00`) = `g_class41_updates[66]` | `g_prop_table66_a` (`0x00595158`), 20 rows, or `g_prop_table66_b` (`0x005953D8`), 29, when `+0x1F4 > 0`; 32-byte rows `{s16 slot; pad; f32 x,y,z; s32 yaw; f32 sx,sy,sz}`; counts are `MOV` immediates at `0x00464505`/`0x00464519` | table a stage 1 blocks 6, 14, 16 (`0x6884`) and stage 2 block 0 (`0x0C64`); table b stage 2 block 3 (`0x2554`), lifetime 8 |

* **Constructor 50's objects** are `+0x290` the table, `+0x2A0` the row,
  unit scale except table 5's Z, no radius and `+0x34` left 0 by
  `ActorClearGameFields`. They are the routine generic type 12 runs — the
  shared lifetime prologue with its scene-1 sweep, the camera cue at path
  `0x2F` frame `0x96`, `T(x, y, z + obj+0x1C8) . Rz . Ry . Rx . S`.
* **Constructor 66's objects** draw `komono_kanban.bin[0..11]` and
  `komono_uemiti.bin[0..1]` (signs, `[likely]` from the file name). Radius 4.0
  with the sphere 3.5 below the origin (`+0x2C0`), 6.5 and 5.0 for slot
  `0x10DC`; slot `0x10B1` is laid back `-0x4000`; `+0x34 = 0x80000001`. Table
  b's row 11 stands at x **+740.193**, the only positive x in either table.
* **`PropUpdateType66`**: an inline step lifetime with no sweep that ends in
  `ActorKill`, not `ActorDespawn`. Only slots `0x10DC`, `0x10DD` and `0x10DE`
  do more: a hit clears bit 3, `BreakablePropAwardHit(award 0)`,
  `SpawnPropHitEffectScaled(1.0)`, `PlaySoundId(0x1116A9)` and a swing rate
  `+0x1D8 = rand() % 0x201 + 0x600`; in scene 0 with `g_screen_shake_frames`
  at `0x17` or `0x2F` the rate becomes `±(rand() % 0x201 + frames * 32)`;
  then `rate -= (pitch + rate) / 24; pitch += rate` and the sphere is
  registered. `0x10DE` swings about `(0, 1.5, 0)`. Ghidra's decompile stops at
  the `PlaySoundId` (`L72`); the rate write after it is in the listing only.

Ported in `game/class41/type50.ts` and `type66.ts`; the exporter places them as
`table50`/`table66` with `field_1f4`, and carries every slot the chosen table's
rows name. `web/tools/checks/prop_tables.ts` holds all eight tables to the
image, and `web/tools/checks/prop_slots.ts` holds each bundle to the port's rows.

### Class 0x41's constructors: which are ported

`g_class41_constructors` (`0x00593580`) read entry by entry. **50 of the 79**
are `PlaceGenericProp` (`FUN_00461CF0`), which is ported with a routine for
every type it serves (`GENERIC_ROUTINES` and `GENERIC_FAMILY` in
`game/class41/`). Five — 2, 15, 22, 23 and 46 — are `NoOpStub`
(`0x0041EBB0`) and no script places them. Of the other twenty-four,
every one is ported: 0, 1, 3, 4, 16, 17, 24, 26, 29, 37, 38, 39, 40, 42, 44,
47, 48, 50, 52, 55, 61, 65, 66 and 68 -- 68 the Training lesson's golden
frog (*The golden frog* below), 26 the warehouse water (below), and 42, 52,
55, 61 and 65 in *Class 0x41 constructors 42, 52, 55, 61 and 65*.

The spawn columns count every script instruction that reaches the descriptor,
from `web/src/hod2lib/script.ts` over scenes 0–11; scenes 6 (training), 9 and 10
are not bundled stages. A class the port has no module for is in no list here
either (`L83`) — this one is the constructors of a class that has one.

**Constructor 3 is ported** (`game/class41/type03.ts`, drawn by
`render/uv_scroll.ts`): the stage-1 car's moving reflection. The walks change
every full vertex of a slot by the same amount, so the port keeps one `u`/`v`
transform a slot and applies it to the authored UVs, and the rig's parts
already say which primitives are slots `0x157E`, `0x157D` and `0x157B`
(`hod2_slots` and `hod2_model`) -- the exporter baking them beside their
neighbours was no obstacle. Two departures are declared there: the per-vertex
float rounding and `| 1` on `v`, and the residency test, the slots taken as
resident while the task lives (`char_adv00.bin` is stage 1's from its first
step). The skip kill (`g_cutscene_skipping`) is left out as four other classes
leave theirs.

**Constructor 26 is ported** (`game/class41/type26.ts`, drawn by
`render/type26_ripple.ts`): the warehouse water the six constructor-16 drums
stand in, `komono_souko.bin[9]` (`0x197F`), placed at stage 2 block 24 step 1
(`0x109A8`) with a lifetime of 3. `[proved]` from the listings of
`PlaceType26RippleTask` and `Type26RippleUpdate`:

* the constructor allocates a `0x44`-byte task and writes only `+0x35` (the
  placer's `+0x11C`), `+0x36` (the step index) and `+0x37 = 0`;
* each frame: stage 2's prop sweep (flag `0x77`), the step lifetime
  (`+0x37` against `+0x35`), then -- while the slot is resident -- the walk:
  every header's TSP word `| 0x2000`, every full vertex's `y = (f32)(sin(
  ftol(((x + 472.5158)^2 + (z + 1230.6945)^2) * 400 + +0x3C) BAMS) * 0.1 -
  4.805454)` -- rings about (-472.5, -1230.7), among the drums -- and `u +=
  sin(((tick * 0x180 + ftol(x) * 600) & 0xFFFF) BAMS) * 0.0004`, `v += cos(...
  ftol(z) ...) * 0.0004 | 1`; then `AssetDrawSlotWithAlphaSceneLights(0x197F,
  0.5)`, which draws nothing without the resident bit either, and `+0x3C +=
  0x200`. Constants `0x005690C0`..`0x005690D8` and `0x005643D8`. The
  decompiler takes `u`'s phase off the centred `x`; the stack (two `FSTP ST0`
  at `0x00469D57` before the `__ftol` at `0x00469D90`) gives the raw one.

**The resident bit is what the port had to grow.** The slot's file is
loaded by the script (`asset_load_polfile` 112, from block 22) and **freed at
block 24 step 3 op 48** with the task still alive, so from that instruction
the engine walks and draws nothing. Opcodes `0x52`/`0x53` now keep the state
of each file they load and free in `G.g_pol_file_state` -- the state byte of
`g_pol_file_records` (`0x009C7320`) -- through `EvtOpAssetLoadPolfile52`
(`FUN_0045F500`), `EvtOpAssetFreePolfile53` (`FUN_0045F580`),
`PolFileQueueLoad` and `PolFileQueueFree` (`FUN_0041D690`), and a slot of a
whole-file load is resident exactly while its file is loaded (the load's
last state sets the bit slot by slot, the free's first clears it for every
slot of the file: `docs/formats/pipeline.md`). The placement carries the
file (`pol`), resolved from `g_pol_file_slot_lists`. Two departures are
declared: the asset job completes where it is queued (the engine's runs
over `4 + slots` steps behind whatever the ring holds), and the UV adds are
kept as closed-form sums, without the per-vertex float rounding and the `|
1` on `v`, as the water's and constructor 3's are. Constructor 3 and the
canal water still take their slots as resident: their files come by loads
the port does not track (the scene's own, opcode `0x50`'s single slots).
The draw is under the gun lights when they are up (the scene light array,
`render/gunlights.ts`'s `sceneLitNodes`).

### Class 0x41 constructors 16, 17, 29 and 37

**[proved]** from the disassembly of the four constructors and their four
routines (`game/class41/type16.ts`, `type17.ts`, `type29.ts`, `type37.ts`,
each with its listing). None of the eight writes `g_enemies_alive` or
`g_enemies_present`, so none holds an enemy gate. Unported until 2026-09-30.

| ctor | constructor | routine | objects | shot | shipped |
|---|---|---|---|---|---|
| 16 | `PlaceTable16Props` (`FUN_00462FE0`) | `PropUpdateType16` (`FUN_00468640`) | six, x/z from `g_type16_prop_xz` (`0x00593D20`) × 0.1, y −1.9, `dolam.bin[0]` | r 8.0 at the origin | stage 2 block 24 step 1 (`0x10980`), lifetime 3 |
| 17 | `PlaceType17Props` (`FUN_004630B0`) | `PropUpdateType17` (`FUN_00468D10`) | three `bridge.bin[4..6]` at 1/20 scale; 0 and 2 at the placer, 1 at (+5, +4, +5) | r 2.0 at the origin | stage 2 block 21 step 2 (`0xECBC`), no lifetime |
| 29 | `PlaceTable29Props` (`FUN_00463270`) | `PropUpdateType29` (`FUN_0046A030`) | nine at `g_type29_prop_xyz` (`0x00593D38`), `tokei_gear.bin[i]`, 3 and 7 undrawn | none | stage 2 block 21 step 3 (`0xECE4`), lifetime 4 |
| 37 | `PlaceType37PropPair` (`FUN_004632F0`) | `PropUpdateType37` (`FUN_0046B5F0`) | two `komono_1.bin[114]`, the second 7.197 up | r 6.0 at y + 6, every frame | stage 2 blocks 4 and 30 (`0x24DC`, set 6 of 1), 14 (`0x812C`, set 3 of 2), 25/26/27 (`0x1296C`, set 1 of 1) |

* **16** (`[likely]` drums, from `dolam`): the first shot swaps to
  `dolam.bin[1]`, turns it to the camera block and starts a rattle
  (`(rand() % 201 − 100) × r × 0.01` on x and z, `r` × 0.9 a frame), and pays
  nothing; the second swaps to `[6]`, pays ten, leaves `[5]` at `(x, −7.5, z)`
  and launches it at `(sin, 0.5 + rand() % 4 × 0.1, cos)` of the camera yaw +
  `0x8000` (× 0.1 across), spinning. Below y −5.0 it lands: a 29-frame
  `common.bin[308..336]` strip (`SpawnType16DropStrip`, `FUN_00468C50`;
  `Type16DropStripUpdate`, `FUN_00468CA0`), sound `0x4616A9`, and a bob
  `y = sin(phase) × a − 5.0` at `0x800` a frame, `a` from 1.5 × 0.35 each
  cycle, the spins sprung back by /48. A shot afloat re-seeds the bob at
  0.5. The step lifetime is inline, against the byte `+0x199`, and runs
  **before** the scene-1 sweep.
* **17**: falls from `vy = −0.1` by 0.05444 a frame and despawns below
  `g_camera_fixed_eye_y`; every hit scores ten and bounces it at 0.3. Only
  bit 3 of `+0x34` is cleared, so the player bits stay set.
* **29** (`[likely]` gears, from `tokei`): objects 4 and 5 turn −`0x80` a
  frame about Y, the rest about X, drawn at `(x + 17, y − 5, z)`; nothing
  registers them. Stage 2 block 21 step 5 shows the drawn ones filling the
  mechanism left of the stair.
* **37**: object 0 shot while `g_type37_hits_left` (`0x007DCD05`) is 2 knocks
  object 1 (`g_type37_pair[1]`, `0x007DCDC8`) off with spins ±(`rand() % 0x81 +
  0x80`); it falls at 0.02722 a frame until a corner of `g_type37_hull_points`
  (`0x00593E40`, ±3.9 × 0/7.197 × ±3.9) under `Ry Rz Rx` is below the floor
  (`+0x1B8`), then pivots about that corner with the spins × −1.5 until both
  angles cross zero, then stands with a 15-frame `common.bin[25..39]` strip.
  A hit breaks either one (effect 7 on motion `0x1D5`, stepped by two,
  despawned at `0x46`); the second break lets out the pair's item at the
  floor -- Original Mode item `0x1E` (`g_original_first_aid`,
  `0x009C88AA`) makes it the extra life. The hit bit is never cleared, and
  the broken object stays a target until it goes.

The three tables travel raw in `breakables.type16_xz`, `type29_xyz` and
`type37_hull` (`hod2lib/class41_rows.ts`); their row counts are the
constructors' own loop bounds.
### Class 0x41 constructors 42, 52, 55, 61 and 65

**[proved]** from each constructor and each routine it hands `ActorAlloc`,
read in the disassembly; three of the routines were not Ghidra functions
until named here. `web/tools/checks/class41_ctors.ts` holds every immediate
and float below to the image, and the bundle to the spawns.

| ctor | constructor | routine | what it is | shipped |
|---|---|---|---|---|
| 42 | `PlaceType42Prop` (`FUN_004639D0`), a `0x48`-byte task | `PropDrawOnlyType42` (`FUN_0046CE80`) = `g_class41_updates[42]` | `komono_boss2.bin[7]` drawn with **no push** -- at its own world coordinates -- until `(s16)g_evt_step_index == 2` takes it (`ActorKill`) | stage 2 block 35 step 1 (`0x14968`) |
| 52 | `PlaceType52VanDoors` (`FUN_00463D20`) | `PropDrawOnlyType12` (`FUN_00467E50`), handed over directly | two objects, slots `0x1794`/`0x1795` (`char_adv04.bin[95..96]`), at `T(pos) . Ry(yaw)` of `(∓9.29, 11.5, 22.68)`, the second turned `0x8000`, lifetime the placer's `+0x11C` | stage 1 block 14 step 1 (`0x68AC`, lifetime 0); stage 5 block 0 step 2 (`0x0DD4`, lifetime 4) |
| 55 | `PlaceType55Particles` (`FUN_00463FE0`), `0x8500` bytes | `PropUpdateType55Particles` (`FUN_0046EEB0`) | 800 `eff_4.bin[i % 48]` pieces round the placer, waiting on `g_script_flags[0x31]`; then 141 frames of gravity 0.05444 with a bounce off y 2782.09, drawn at alpha 0.5 for the first 110 | stage 6 block 12 step 1 (`0x4780`); op 161 raises the flag |
| 61 | `PlaceType61Figures` (`FUN_004641F0`) | `Type61FigureUpdate` (`FUN_004729E0`) | nine `0x13F4` skinned actors, types from `g_type61_figure_types` (`0x0059504C`), in two rows, each holding frame 0 of its clip until `g_script_flags[0] == 1` | stage 6 block 2 step 1 (`0x2058`); op 75 raises the flag |
| 65 | `PlaceType65Particles` (`FUN_00464360`), `0x8500` bytes | `PropUpdateType65Particles` (`FUN_0046FCC0`) | 300 `garasu.bin[i % 72]` pieces from `(580, 2200, -9149) ± 5` -- literals, not the placer's point, though they equal it -- falling at 0.10888 for 301 frames | stage 5 block 7 step 2 (`0x3D5C`) |

* **42 draws on the view the task walk left on the stack.** No
  `MatrixStackPush`, no transform: the model's own coordinates, which put it
  at x -1392..-1248, y -69.6..-25.9, z -2128..-1978 -- just under the water
  plane class 0x16 lays at -25.5 in the boss arena. Drawn with the water taken
  away it is the footing of the arena's piers (`[likely]`, from the picture).
  No lifetime: a route that left the block before step 2 would leave it
  drawing, and the engine has no other test.
* **52 is not `PropBuildVanDoors`** (`FUN_00472C90`, class 0x44 selector 2),
  though the slots, offsets and half turn are the same: that one installs
  `HingeUpdate` and fills the hinge from its tail, this one type 12's draw.
  "Van" is `[likely]`: stage 5's spawn stands at the pose of a type-51 object
  drawing `0x1793`, the model before them in `char_adv04.bin`.
* **55's first 48 pieces are never given a scale.** The constructor takes row
  `i` for `i < 0x30` and `rand() % 0x30` after, and its `JL` at `0x00464045`
  steps over the only store to `+0x7240 + 4i`, so those 48 keep
  `ActorClearGameFields`' zero and are drawn collapsed: 752 of 800 are seen.
  `g_type55_particle_offsets` (`0x00594F2A`, 48 rows of s16 x, y, z) scales
  by 0.001 into both the start and the outward speed; `rand()` is drawn `j`,
  scale, `vx`, `vz`, `vy`, three spin rates. The draw window is `+0x1A0 <=
  0x6E || g_scene_tick_counter == 0`, so the last 31 frames run unseen.
* **61's `AND 0x7F; OR 0x80080000` is on the placer**, not the figure (`EAX`
  loaded from the argument at `0x004642FD`) -- the build's `0x80` stays on
  each figure, which registers for no shot test that would read it.
  `Type61FigureUpdate` never steps `obj+0x194`, so every figure stands on
  frame 0: clip `0x3EA` for type `0x13`, `0x3DA` for `0x16`, `0x2F6` for the
  rest. It draws under light block 1 with a direction of its own,
  `BuildSceneLightDirection(0, 0x4000)` handed to `SetRenderLightDirection` as
  the **world** vector (`LEA EDX, [ESP+0x18]` at `0x00472A28`, the first
  output) where `UpdateSceneViewAndLight` and the `Lights*` routines hand it
  the view one, so the light is fixed to the screen, from +X.
  `TaskListSaveCurrent` (`FUN_0041DB70`) and
  `TaskListCurrentIgnoringSaved` (`FUN_0041DB90`) bracket the build and change
  nothing. The types, by file: `tutorial`, `znkage`, `zstin`, `znjoe`,
  `char_adv00`, `znkagex`, `znebi3`, `zsass`, `znele`; they stand in the
  scene's specimen tanks.
* **None of the five** registers for the shot test, touches an enemy counter
  or raises a flag.

The port: `game/class41/type42.ts`, `type52.ts`, `type55.ts`, `type61.ts` and
`type65.ts`. 42, 55 and 65 are prop-pool families of their own, 52 builds
constructor 50's kind of object, and 61 builds actors filed under class 0x41
with a tail naming the routine (`class41/placer_state.ts`), linked by
`SpawnFromDescriptor` with no `Init` to run -- the engine's figure has none.
The figure's light goes through the port's `SetRenderLightDirection`, which
takes the world vector whose view image the device is handed: `(1, 0, 0)`
taken back through the drawing block's view-to-world, left on the tail as
`drawDir`, and tagged on the model by `render/characters/type61_figure.ts`
for `render/lighting.ts`, which turns it back into view-space `(1, 0, 0)`.
The placer's own `+0x34` takes the `AND`/`OR`, as in the exe. The exporter
places each as `type42`..`type65` with the descriptor's position, yaw and
`+0x11C`; 55's placement carries the 48 offset rows and 61's the nine types,
and 61's figures each get a synthetic character row at `Type61FigureAt`,
parented to the placer, with the type built and the clip baked.

### Class 0x41 type 4: seven of the eleven kinds are effects, not models

**[proved]** `PlaceKindedProp` (`FUN_00462E10`) sets `obj+0x28C = 0xFFFF` and
then overrides it for **four** kinds only — 2 → `0x17A9`, 3 → `0x19E8`,
8 → `0x17AA`, 9 → `0x17AB`. `KindedPropUpdate`'s draw is

```c
if (obj->+0x32C == 0 && obj->+0x28C != -1) AssetDrawSlot(obj->+0x28C);
else if (obj->+0x194 == 4 || g_scene_index == 3) FUN_0040DFA0(obj + 0x324);
else                                            FUN_0040DD90(obj + 0x324);
```

so kinds 0, 1, 4, 5, 6, 7 and 10 have **no static model in the engine either**:
they are animated effects, `obj+0x324`/`+0x328` coming from
`g_prop_kind_params`. A spawn marker with nothing under it for one of those
kinds is not a missing export — it is a renderer the player does not have.

### The effect system: what the model-less props actually draw

**[proved]** An "effect" is a small **rigged object animated by an ordinary
motion**. Three contiguous tables in the EXE describe all 29 of them:

```
0x004D5390   void *[29]   g_effect_trees          root node per effect id
0x004D5404   s16  [29]    g_effect_bone_counts    bones its motion carries
0x004D5440   u8   [29]    g_effect_interp_mode    0 = one key a frame
```

A node — and the root the table points at is one — is

```
+0x00  u32  asset slot            0 on the root, so the root never draws
+0x04  s16  bone index, 1-based
+0x06  u16  child count
+0x08  u32  children[]
```

which is `g_character_skeletons`' struct **minus the bind offsets**, because an
effect's translations are per-frame rather than a rest pose.

`EffectDrawUnlit` (`FUN_0040DD90`) takes a 4-int state block that lives inside
the owning object — `obj+0x324` for a class-0x41 prop — holding
`{effect id, motion id, frame, previous frame}`. `EffectDrawTree` wraps the
frame and walks the children; `EffectDrawNode` pushes, poses, draws its slot
and recurses.

**The animation is a plain motion.** `EffectFrameTranslations`
(`FUN_0040E040`) resolves to

```
g_motion_slots[motion].base + 4 + frame * align4(bones * 0x12 - 0xF)
                            + bone * 0xC          /* 3 floats  */
```

with the rotations following at `bone * 6` (three BAMS shorts, X then Y then
Z), so `mot.md`'s decoder already reads the data — only the node tree is new.
`g_effect_interp_mode` picks the rate: 0 is one key per frame, 1 and 2 halve it
and blend the neighbouring keys. **Mode 2**, on an odd cursor past 1 and only
when **all three** angles differ by more than `0x3000` (Z, then Y, then X, as
plain integer differences), builds both keys' `Rz . Ry . Rx` and hands them to
`MatrixInterpolateSwingTwist` (`FUN_00412750`) at `t = 0.5`: with
`R = A^-1 . B`, the swing `s` is the angle `R` turns Y through, about
`c = Y x R.Y`, and the twist `b` is what is left about Y; the result is
`A . Rot(c, trunc(s t)) . RotY(trunc(b t))`, both angles `(s16)__ftol`'d from
`atan2 * 32768/pi` (`g_rad_to_bams`, `0x004C4378`). Its `c = (1,0,0)` arm for
a half-turn swing is unreachable — the swing is sign-extended before it is
compared with `0x8000`. The five matrix routines it rests on are
`MatrixSetTop3x4`/`MatrixGetTop3x4` (`FUN_004A9ED0`/`FUN_004A9E30`),
`MatrixInvert`, `MatrixMultiply`, `MatrixRotateAxis` and `MatrixRotateY`.

**[proved] by the slot names.** Every node of an effect resolves to one file,
and for the 11 effects `g_prop_kind_params` names that file is a
`komono_*.bin` — *komono*, "small items", the same family as the breakable
props. The other effects draw from `komono_*` files too, or from `bridge.bin`,
`door_1.bin`, `garasu.bin` and the like. `web/tools/checks/effects.ts` holds
this and the table:

| Effect | Prop kind | Nodes | File |
|---|---|---|---|
| 5 | 0 | 13 | `komono_3.bin` |
| 17 | 1 | 18 | `komono_6.bin` |
| 20 | 6 | 11 | `komono_3.bin` |
| 22 | 5 | 11 | `komono_7.bin` |

and each tree's node count is exactly its `g_effect_bone_counts` entry — a
check that would fail if the struct or the table bound were wrong.

So a class-0x41 kinded prop of a kind with no asset slot is **not missing**: it
is a multi-part `komono` prop whose parts and pose come through this system.
`g_prop_kind_params` already carries the `(effect, motion)` pair per kind, and
the player already decodes motions and already exports per-slot templates.

**The node tree and the effect stride are now read**, and both hold against
the whole corpus: all 29 trees
walk to exactly their `g_effect_bone_counts` entry, every bone index in a tree
is used once (0 for the root, 1..n-1 below it), and all 13 `(effect, motion)`
pairs the two consumers name divide exactly by that count's stride. What is
still missing is a renderer that walks a *general* tree: the player draws the
one class whose trees are flat, below.

#### The stride is the node count's, not a character's

`EffectFrameTranslations` (`FUN_0040E040`) and `EffectFrameRotations`
(`FUN_0040E070`) compute

```
(g_effect_bone_counts[effect] * 0x12 - 0xF) & 0xFFFFFFFC
```

and that mask **truncates**. The node count includes the root, which carries no
animation, so one frame is `n - 1` translations of three floats followed by
`n - 1` rotations of three BAMS shorts, and the rotations begin exactly where
the translations end — the engine's `+4` in the translation address and its
`-8` in the rotation address cancel against `n * 0xC`. Reading an effect's
block at `mot.md`'s character stride is a third of a frame out per frame.

### Class 0x44 selector 0: an effect placed by a script flag

**[proved]** `PropBuildScriptFlagEffect` (`FUN_00472B30`) is the only selector
of the class that builds an **effect** rather than a model at a pose, and the
only one whose child never calls `MatrixTranslate` at all: the spawn's own
position is never copied to `obj+0x19C`, and the parts are placed by the
motion, in world coordinates. Two spawns in the game, both stage 1's window
halves at evt `0x1580` and `0x15CC`; motion 471 frame 0 seats them at
`(±13.762, 0, −361.5/−362.8)`, which is those descriptors' positions to three
decimals.

```
tail+0x04  u32  == 0x13F5 -> effect 2, capture bone 2, cue list A
                  else       effect 3, capture bone 1, cue list B
                  (its low half also goes to obj+0x28C, which the family
                   never draws through)
tail+0x08  s32  -> obj+0x14C
                  literals: obj+0x328 = 471, obj+0x124 = 40.0f,
                            obj+0x34 |= 0x51
```

`ScriptFlagEffectUpdate` (`FUN_00473B90`) is three script-flag rules and a
draw: `g_script_flags[0x13]` despawns it, `g_script_flags[0x12]` steps
`obj+0x32C` while it is below `g_motion_play_length[471] - 2`, and the frame it
lands on is matched **for equality** against a cue list —
`g_script_flag_effect_cues_a` (0x005961F0) for effect 2 through the cursor at
`obj+0x2A4`, `g_script_flag_effect_cues_b` (0x00596204) otherwise through
`obj+0x2A8` — each hit playing `PlaySoundId(0x1816A9)` and wrapping the cursor
at the list's `-1`. The draw is `EffectDrawWithCapture` (`FUN_0040DFD0`), which
is `EffectDrawUnlit` plus a capture bone and a slot override; the captured
node's matrix lands in `obj+0x338` and is copied on to `obj+0x150`.

The draw is gated on `g_motion_slots[471].state == 2` — the literal word at
`0x009A469C`, which is that record's state half. Six sibling routines carry the
same test as a literal address for their own motion.

### Class 0x44 selector 11: a door that slides straight up

**[proved]** `PropBuildRisingDoor` (`FUN_00473410`) and `RisingDoorUpdate`
(`FUN_004753F0`). Two spawns in the whole game and both are a shutter the
zombies come out from under: stage 3's evt `0x23F4` at `(-356.6, -16.1,
-3047.8)` and stage 5's evt `0x0C2C` at `(275.4, 12.0, -89.6)`.

```
tail+0x04  u16  -> obj+0x28C   the asset slot it draws
tail+0x08  u32  -> obj+0x14C   -1 in both shipped spawns
tail+0x20  s8   -> obj+0x2A0   the script flag that starts the rise
tail+0x21  s8   -> obj+0x2A4   the script flag that deletes it
                  header: position -> obj+0x19C.., orient b -> obj+0x1D0,
                          obj+0x68 = 0, obj+0x34 |= 0x51
```

The whole routine, and there is no curve and no table in it:

```c
if (g_script_flags[obj->+0x2A4] == 1) { ActorKill(); return; }
dx = dz = 0;
if ((s16)obj->+0x28C == 0xA58 && g_script_flags[obj->+0x2A0] == 0) {
    if (obj->+0x2C0 < 0.001) { obj->+0x2C0 = 1.0f; PoseHookNone(2, 0x14); }
    dx = (rand() % 0x191 - 200.0) * obj->+0x2C0 * 0.01;
    dz = (rand() % 0x65  -  50.0) * obj->+0x2C0 * 0.01;
    obj->+0x2C0 *= 0.95;
}
if (g_script_flags[obj->+0x2A0] == 1) {
    if (obj->+0x2A8 == 0) { obj->+0x2A8 = 1; obj->+0x1C4 = 0.5f; }
    ceiling = (s16)obj->+0x28C == 0xA58 ? 20.0 : 35.0;
    step    = (s16)obj->+0x28C == 0xA58 ?  0.1 :  0.01;
    if (obj->+0x1A0 < ceiling) { obj->+0x1C4 += step; obj->+0x1A0 += obj->+0x1C4; }
}
Translate(dx + obj->+0x19C, obj->+0x1A0, dz + obj->+0x1A4);
RotateY(obj->+0x1D0); AssetDrawSlot((s16)obj->+0x28C);
```

Four details that are not what a from-scratch door would do:

* **the ceiling and the rate are a slot comparison**, `CMP word ptr
  [ESI+0x28C], 0xA58`, and nothing about the model decides them. Stage 3's
  door is that slot and clears 36.1 units in 22 frames; stage 5's climbs 23 at
  a hundredth a frame and takes 35;
* **past the ceiling the routine stops writing `y`** — two `JGE`s jump to the
  draw — so the door holds one frame's worth *above* it, not on it;
* **the rattle reseeds itself.** `obj+0x2C0` decays to below 0.001 in about
  135 frames and is then reset to 1.0, so a door waiting on its flag judders
  in bursts. Only slot `0xA58` rattles at all;
* `FUN_00420810(2, 0x14)` in the rattle is `PoseHookNone`, the empty stub.

The two models are `etc_door.bin[2]` (slot `0xA58`) and `st5.bin[9]` (slot
`0x189A`), and both render as a corrugated ribbed metal panel. `[likely]` a
roller shutter, on the model, the `etc_door` filename and the vertical rise
together.

### Class 0x44 selector 13: rises to a height the descriptor gives

**[proved]** `PropBuildRiseToHeight` (`FUN_00473640`, not a Ghidra function
until it was created for this) and `RiseToHeightUpdate` (`FUN_004757F0`),
`g_class44_subtypes[13]`. Thirteen descriptors: stage 5's evt `0x16F4`
(spawned at block 1 step 1 op 26 and again at block 2 step 0) and twelve in
stage 6, `0x18C8`..`0x4738`.

```
tail+0x04  u16  -> obj+0x28C   the asset slot it draws
tail+0x08  i32  -> obj+0x14C   a coli blob; -1 in all thirteen
tail+0x14  i32  FILD, + desc y -> obj+0x2C0 (f32)   the ceiling
tail+0x20  s8   -> obj+0x2A0   the script flag that starts the rise
tail+0x21  s8   -> obj+0x2A4   the script flag that removes it
                  header: position -> obj+0x19C.., orient b -> obj+0x1D0
                          AND obj+0x68, obj+0x34 |= 0x51
```

```c
if (g_script_flags[obj->+0x2A4] == 1) {
    if (obj->+0x14C == -1) ActorKill(); else ActorDespawn(obj); return;
}
if (g_active_cam_path == 0xDD && g_cam_path_frame == 0x35C) { ActorKill(); return; }
if (g_script_flags[obj->+0x2A0] == 1 && obj->+0x1A0 < obj->+0x2C0)
    obj->+0x1A0 += 1.0f;
Push; Translate(obj->+0x19C, obj->+0x1A0, obj->+0x1A4); RotateY(obj->+0x1D0);
AssetDrawSlot((s16)obj->+0x28C); MatrixStore(obj->+0x150); Pop;
if (obj->+0x14C != -1) RegisterForShotTest(obj);
```

Not selector 11 with other numbers: the climb is a constant unit a frame (the
`1.0f` at `0x004C4380`), the ceiling is data (`tail+0x14` is 48 in stage 5 and
32 in all of stage 6), and there is no rattle. Stage 5's is `st5.bin[1]`, slot
`0x1892`, at `(583.0, -70.9, -1340.2)`: 105 units wide and 54 tall, the width
of the tunnel mouth behind block 1's fight, and it renders as a rusted
panelled gate filling that mouth. It rises on flag 4, which block 2 step 2
op 22 raises after the fight (48 frames, landing exactly on `-22.9`), and
goes on flag 23. `[likely]` a gate, on the model and where it stands.

No instruction in the image names `0x1892`, `0x1899` or `0x189A` (an operand
search and a byte search for each; the only hits are the `st5.bin` slot list
at `0x004E76EE`): all three reach `AssetDrawSlot` only through the descriptor
tails of selector 13, the hinge and selector 11. `web/tools/checks/
rise_to_height.ts` holds the tail layout, the constants and every shipped spawn.

### Class 0x44 selector 14: a model at its descriptor's pose and scale

**[proved]** `PropBuildDrawOnlySelector14` (`0x004736D0`,
`g_class44_subtypes[14]`) and `PropDrawOnlySelector14` (`0x004758E0`),
`game/class44/draw_only.ts`. The tail:

```
tail+0x00  u16  -> obj+0x11C         the lifetime, in event steps
tail+0x04  u16  -> obj+0x28C         the slot
tail+0x08  f32  -> obj+0x1A8         the scale, x
tail+0x0C  f32  -> obj+0x1AC         ...y
tail+0x10  f32  -> obj+0x1B0         ...z
placer+0x40..0x48 -> obj+0x19C..0x1A4, placer+0x64..0x6C -> obj+0x1CC..0x1D4
```

The update is `PropDrawOnlyType12` (`0x00467E50`) without its camera cue:
`PropExpireByStepLifetime`, `T(x, y, z + obj+0x1C8)`, `Rz Ry Rx`, the scale,
the dead `MaxOfThreeToNoOpStub`, and the lit or unlit draw of `obj+0x28C`.
Twelve arcade spawns: stage 2's two (`komono_bar.bin` 8 and 6, scale 0.7),
stage 3's three and stage 4's two that draw `st1_1.bin[2]` -- slot `0x10AE`
-- stretched along x (1.7 to 3.46), and stage 4's five (`komono_st4.bin` 2
and 6). **This is what draws `0x10AE`**: the slot is a descriptor word, which
is why no instruction in the image names it and it was listed as drawn by
nothing (`L39`). Before the selector was ported none of the twelve existed
(`L83`). `web/tools/checks/draw_only_14.ts` holds the table entry, every
tail load and store byte for byte, the update's calls and every shipped
spawn.

### Class 0x44 selectors 9 and 12, and class 0x41 constructor 47

The three objects the stage's old "loaded, so drawn" rule stood in for
(`L54`, `L96`), each read whole and ported one routine to one function.
`web/tools/checks/flag_props.ts` holds the table entries, every tail load
byte for byte, the constants and every shipped spawn.

**[proved] Selector 12**, `PropBuildSlideOnFlag` (`0x004734A0`) and
`SlideOnFlagUpdate` (`0x004755B0`), `game/class44/slide_on_flag.ts`. Eight
spawns, all stage 6, in pairs that part:

```
tail+0x04  u16  -> obj+0x28C   the slot (the DWORD is what the car test reads)
tail+0x08  i32  -> obj+0x14C   a coli blob, or -1
tail+0x10  i32  FIMUL by sin/cos(PI/2) -> vx, vz (f32)   the slide per frame
tail+0x14  i32  FILD -> obj+0x1A8                         the slide length
tail+0x20  s8   the flag that slides it; tail+0x21 s8 the flag that removes it
```

The running distance is summed before it is tested, so a 21-unit leaf at one
unit a frame moves twenty times. Slots `0xAFC`..`0xAFF` are parts the
`FUN_0048F560` rig also draws (`[likely]` the lift car's doors): their descriptors are in the car's frame, and the constructor carries
them to where block 0, or any later block, parks the car --
`T(557.5, -57.8 or 2492.2, -9880.2) . Ry(0x7555)` -- and slides them along the
car's x. Only `0x0B00` and `0x0B48` carry a blob (`coli6.bin:0` and `:104`),
so those two are shot through their meshes and are walls to the collision
passes, as the hinges are.
The model patch the update makes once (strip-control bit 30) is `[open]`, and
the second draw for slot `0x189C` (`0x1730` under the scene light) is taken by
no spawn.

**[proved] Selector 9**, `PropBuildFlagLiftedProp` (`0x00473300`) and
`FlagLiftedPropUpdate` (`0x00474EA0`), `game/class44/flag_lifted.ts`. One
spawn, stage 3 evt `0x0D24`: slot `0x1986`, 81 by 57, which the page shows
filling the arch block 0's camera path ends at (`[likely]` a gate, on the model
and where it stands). It rises `0.8f` a frame while
flag 5 is up and `y < 10.0`, so from `-25.4` it takes 45 frames and stops at
10.6; flag 10 kills it. No collision, no yaw. Block 1 step 2 raises flag 10
and block 3 step 2 raises flag 5.

**[proved] Constructor 47**, `PlaceType47Prop` (`0x00463AE0`) and
`PropUpdateType47` (`0x0046DD40`), `game/class41/type47.ts`. One spawn, stage 2
evt `0x14990`: slot `0x1384`, a 134-unit flat disc, drawn lying flat at 0.4
scale through `AssetDrawSlotWithAlpha` at `sin(obj+0x44) * 0.2 + 0.8`, and
killed by script flag `0x11` or step index 2. `[likely]` the alpha is the
constant 0.8: nothing found writes `obj+0x44`.

### Class 0x44's hinges, and selectors 3 to 8, 10 and 15

**[proved]** Every builder and routine, `game/class44/`, one exe function to
one TS function; `web/tools/checks/class44_builders.ts` holds the table
entries, each builder's allocation, the literals and every spawn's placement.
Until these were ported, 1, 2 and 4 were posed by the renderer from a copy of
the curves (`L16`) and the rest were never built (`L83`).

```
selector  builder                      routine                 tail (+0x24 on)                         spawns
1         PropBuildHinge 0x00472BD0    HingeUpdate 0x00473CF0  +00 u16 curve  +04 u16 slot  +08 i32 coli  37 (stages 1, 2, 4, 5, 6)
                                                               +10 i32 side  +14 i32 wobble phase
                                                               +20 s8 open flag  +21 s8 remove flag
2         PropBuildVanDoors 0x00472C90 HingeUpdate             +08, +14, +20, +21; two doors 0x1794+i    3 (stage 2, stage 5 x2)
                                                               at (+/-9.29, 11.5, 22.68), sides -1/+1, curve 2
4         PropBuildHingeScaled 0x00472EB0 HingeUpdate          +00 curve  +04 slot  +08 coli  +0C side    13 (stage 2)
                                                               +10/+11 flags  +14..+1C f32 scale
3         PropBuildFlagSlotEffect      FlagSlotEffectUpdate    +08 coli  +20/+21 flags; effect 0xB on      2
          0x00472E00                   0x00474120              0x1D6, slot 0x17EE (scene 0) / 0x197C
5         PropBuildEffectHandoff       EffectHandoffUpdate     selector 1's; effect 0xC on 0x1CE          1 (stage 2)
          0x00472F80                   0x00474240
6         PropBuildSwingThenBreak      SwingThenBreakUpdate    selector 4's, +12 s8; effects 0xD/0xE/0xF  1 (stage 2)
          0x00473060                   0x00474470
7         PropBuildScaledSlotEffect    ScaledSlotEffectUpdate  selector 4's, +12 s8; effect 0xF on 0x1CA  1 (stage 2)
          0x00473170                   0x00474770
8         PropBuildEffectCollapse      EffectCollapseUpdate    +10 s8 flag  +11 s8 lifetime  +14 scale    2 (stage 2)
          0x00473260 (0xD14 bytes)     0x004748C0              effect 0x10 on 0x1D3
10        PropBuildSlotStripLoop       PropDrawOnlyType31      +00 u16 lifetime  +04 u16 slot             5 (stage 3)
          0x00473370                   0x0046A1C0              +14 scale; desc+0x6C the strip's last cursor
15        PropBuildKindedProp          KindedPropUpdate        +00 u16 lifetime  +04 s8 item set          9
          0x00473770                   0x00465FB0              +08 i32 story item; desc+0x6C kind, +0x64 set size
```

**The hinge** swings through `g_pHingeCurvesXYZ` (curves 0, 2, 3) or the
yaw-only, zero-extended `g_pHingeCurvesYaw` (1, 4) while its open flag is up,
60 frames or 130 on curve 4; `obj+0x1DC` is read for its sign by the swing and
as the amplitude of the damped wobble a shot starts. Slot `0xA60` answers
flags 0x36 and 0x23; slot `0x1866` in scene 3 blocks 1 and 7 plays
`0x361BA9` once on flag 2 or 4; slots `0x1817`/`0x1816` are drawn at x scale
1.05. Selector 5 draws `0x17D7` until flag 0x62, then plays its effect and
allocates, once, a `HingeUpdate` object from its own words (not its wobble
phase). Selector 6 swings on curve 1 until flag 0x63, then draws the strip
`0x170`..`0x174` under effects 0xD and 0xE while its yaw spins down by 0.85f a
frame, and on flag 0x64 restarts on effect 0xF. Selectors 3 and 7 draw every
node of their effect tree as one slot (the override `EffectDrawWithCapture`
and `EffectDrawWithSlot`, `0x0040E010`, set). Selector 8 plays effect 0x10 to
frame 0x23 on its flag, then lets its 72 parts fall and bounce off
`ftol((ground - y) + sy * 5.0)`, three `rand()`s a bounce -- and its physics
runs before the flag too, from the origin, so the parts bounce and consume
`rand()` while nothing is drawn. It copies 73 entries of an effect with 72
bones, so its last part starts from the key's rotation shorts read as floats;
the two keys travel raw on the placement (`collapse_keys`). Selector 10 is
class 0x41 type 31's object from a class-0x44 descriptor, and its stage-3
block-11 spawns are the ones that reach `PropDrawOnlyType31`'s scene-2
block-11 strip. Selector 15 is `PlaceKindedProp` with the item set and the
Original Mode story item from the tail, and builds nothing outside Original
Mode in scene 1 block 0x15, scene 2 blocks 1, 4 and 8, and scene 5 block 1.

Their `obj+0x34 |= 0x51` and `obj+0x14C` send each one with a blob to the
mesh shot test and into the moving-object collision passes, and the port
files them so -- `MatrixStore(obj+0x150)` where each routine makes it, and
`RegisterForShotTest`'s mesh arm (`class41/shot_test.ts`). Selectors 0 and
3's `obj+0x150` is the node matrix their effect draw captures, and their
`obj+0x64..0x6C` are `EffectFrameRotations` of the raw cursor at entry
`obj+0x2A0` (selector 3's open flag): those three shorts per play cursor
travel raw on the placement as `rotation_entries`
(`MotionBank.effectRotationEntry`), `null` where the read leaves the bank's
file; see `docs/formats/combat.md`, "The shot test".

### Class 0x24's parameter tail

`SetPiecePropInit` reads everything a set-piece does out of the tail at
`desc+0x24`, and the six state routines read nothing else:

```
+0x00  u32  the model handle FUN_0045EBB0 resolves
+0x04  s8   character type      -> obj+0x1F4
+0x05  s8   state selector      -> obj+0x130C
+0x06  s16  removal: cam path, or a script-flag index
+0x08  s16  removal: cam frame threshold
+0x0A  s16  motion id           -> obj+0x1B4
+0x0C  s16  hold frames (selector 0 only)
+0x0E  s16  cue path — or a motion id, in the hold state
+0x10  s16  cue frame
+0x12  s16  second cue path (selector 2)
+0x14  s16  second cue frame
```

The handler is an **Init**: it installs one of six routines as the object's own
entry point and never runs again.

| Sel | Routine | What it does |
|---|---|---|
| 0 | `SetPieceStateIdle` | plays its motion and waits to be removed |
| 0 | `SetPieceStateHoldThenPlay` | taken when `+0x0C` is non-zero: hold that many frames, then install motion `+0x0E` |
| 1 | `SetPieceStateFreezeOnCue` | plays, then holds on a camera cue |
| 2 | `SetPieceStateStartAndStopOnCues` | starts frozen; one cue starts it, another stops it |
| 3 | `SetPieceStateDropToGround` | starts frozen and falls at 0.027222222 to the ground plane, then plays |
| 4 | `SetPieceStateSlide` | slides at a fixed (0.646266, 0, 0.613497) for 0x27 frames, then holds 0x19 |
| 5 | `SetPieceStateDelayedDrift` | waits for motion frame 0x32, then drifts down at 0.0034027777 |

`obj+0x1324` is a **freeze flag**: `SetPiecePropDrawAndTick` advances the motion
frame only while it is zero. Selectors 3, 4 and 5 freeze again on the clip's
last frame, `g_motion_play_length[motion] - 1`.

`obj+0x11C` is an **animation phase seed**, not hit points: `-1` draws a random
start frame, anything else is a literal one — which is how a row of identical
set-pieces avoids animating in lockstep. No shipped spawn uses `-1`; all 28 the
six stages reach carry a literal frame.

### Class 0x25's bytecode

`ScriptedHumanoidInit` is an Init like class 0x24's: it installs
`ScriptedHumanoidUpdate` and never runs again. The tail points at a **command
block**:

```
tail+0x00  s8   character type   (Original Mode remaps 0x39/0x3A through g_original_character)
tail+0x02  s16  removal: cam path, or a script-flag index
tail+0x04  s16  removal: cam frame threshold
tail+0x08  u32  a model handle
tail+0x0C  u32  -> the command block

blk+0x02   s16  == 2: start with the draw flag set
blk+0x04   s16  the motion it opens in
blk+0x06   s16  phase seed, -1 for rand() % 10
blk+0x08   ...  the commands
```

A command is `{s16 op, s16 mode, s16 a, s16 b}` — eight bytes, or sixteen when
it carries a point (`op 7`, `op 8`, and `op 4 mode 4`). **The length rule is
the check on the whole reading**: one wrong length desynchronises the stream
and the opcodes go out of range at once, and all 137 blocks the six stages
reach decode with every opcode in `0..18` or `-1`.

| Op | What it does | Count |
|---|---|---|
| 4 | wait for a condition | 357 |
| 3 | set the motion, with a blend | 195 |
| 14 | set the draw mode | 155 |
| 0 | wait, and record which condition released it | 145 |
| 9 | bone 5's draw slot from `g_player_hand_slots` (`0x004EC9E0`) — see below | 117 |
| 10 | skip an arm unless the player count matches | 100 |
| 1 | as 0, with the mark set to 1 | 88 |
| -1 | leave the VM for the idle routine | 69 |
| 18 | `ActorKill` | 68 |
| 11 | ride an `op_` object path | 24 |
| 13 | `PlaySoundId` | 14 |
| 8 | set the position | 13 |
| 17 | by mode: install one of three routines (0, 1, 4), or spawn a sprite and run on (2, 3) — see below | 12 |
| 2 | set the motion | 10 |
| 16 | blood on bone `a`, then its draw slot from the effect table — see below | 8 |
| 6 | stop turning, or face the camera | 8 |
| 7 | face a point once | 4 |
| 5 | turn by a fixed amount over N frames | 1 |

The condition modes: `0` a frame count, `1` the camera reaching a path at a
frame, `2` the play cursor `obj+0x19C` **equal** to `a` (`-1` for
`g_motion_play_length - 1`) -- the engine's 60 Hz cursor, not an authored frame:
`a=66` ships on a 35-frame clip whose play length is 68 -- `3` a script flag,
`4` "am I **farther** from this point than I was last frame", `-1`
unconditional. The two switches differ `[proved]`: `op 0`/`op 1` take 0, 1, 2,
3 and -1 and block on anything else (so no mode 4), and `op 0` never proceeds
on mode 2 (`CMP BP, BX; JZ` at `0x004843CD` tests the opcode); `op 4` takes 0 to 4 and blocks on -1.
An opcode outside -1..18 parks the VM (`JA 0x00484a8d` at `0x0048436B`).

**A command that cannot proceed does not advance the cursor.** It falls through
to the per-frame tail and is retried next frame, so a run of setup commands all
take effect at once and only a wait costs a frame. `op 11` evaluates its path
at the **camera's** frame, which is what keeps a scripted actor in step with
the shot it belongs to.

`op 2` is `ActorSetMotion` and then a write to the **counter** `obj+0x194`: `b`,
or `rand() % 10` for -1, the same as the Init's `blk+0x06`; its mode 1 clears
`obj+0x1F8` bit 4 and mode 2 raises it (the Init raises it for `blk+0x02 == 2`).
`op 3` is `ActorSetMotionBlended(obj+0x194, a, b, mode)` -- `b` the start
cursor, `mode` the fade length.

**`op 17` is five things by mode** (`0x004849CE`, jump table `0x00484D20`),
all shipped:

| Mode | What it does | Users |
|---|---|---|
| 0 | installs `ScriptedHumanoidFallAndSplash` (`FUN_00484DF0`) and ends the frame: `vel.y -= 0.02` a frame from rest, the freeze raised on the last cursor, and at `y <= -27.9998` a kind-0x61 splash at `(x, -24.9998, z)`, the hit slot freed, `ActorKill` | stage 2's four jetty zombies, evt 43584/43740 (block 16), 55372/55536 (block 20) |
| 1 | installs `ScriptedHumanoidLaunchAndDrop` (`FUN_00484EA0`): `vel = (x - 231.5, 20)`, then a gravity that grows by 0.027222222 a frame, dead below y = 0 | stage 2 block 37's five, on script flag 95 |
| 2 | calls `ScriptedHumanoidSpawnFixedImpact` (`FUN_00484F50`): kind 0x34 at `(-999.5, 3.24, -1296.2)`, yaw `0xC000`, and runs on | stage 2 evt 65768, 66004, three each |
| 3 | kind 0x41 at `(-189.3, -24.9, -1505.0)` in evt block 9, `(-1264.0, -24.9, -1353.0)` elsewhere, faced by yaw, and runs on | stage 2 evt 21948, 42264, twice each |
| 4 | `vel.y = -0.40833333`, installs `ScriptedHumanoidFallTimed` (`FUN_00484F90`): the same gravity step, dead past 200 frames | stage 6 evt 18820 |

The three installed routines run no removal test and never read the command
block again. A mode above 4 (or negative) steps past the command and ends the
frame. Ported in `game/class25/`.

**`op 9` and `op 16` write a bone's draw record, and nothing else** `[proved]`
(`0x00484739`, `0x00484972`). Both run on into the next command in the same
frame.

* `op 9` stores `g_player_hand_slots[3*row + mode]` (`s16`, `0x004EC9E0`) into
  `obj+0x4DC`, bone 5's `+0x00`, unconditionally. `row` is `a`, except in
  Original Mode (`g_GameMode == 1`), where an `a` of 0 or 1 is
  `g_original_character[a]` (`0x009A2242 + p*0x14`) -- which its one writer,
  `ResetOriginalModeLoadout`, sets to the player index, so the row is the same.
  The table is ten rows of three, one per character the byte can name (0..7
  are types 0x39..0x40, 8 is 0x21, 9 is 0x34), and `PlayerBodySetHandSlot`
  (`FUN_00416810`) is its other reader. Each character's own skeleton slot
  for bone 5 is in its row (variant 1 for rows 0-3, variant 0 for row 4).
  117 commands in 114 programs, in all six stages, name rows 0 to 4; stage 3
  block 11's James takes row 0's variant 2 (`0x1592`) for the closing scene.
* `op 16` calls `SpawnBloodSpray(obj, a, 0.75)` and then reads the character's
  effect table (`g_pBoneEffectSlots`, `0x004C7160`) at `6*a + b`, storing it
  into bone `a`'s record only when it is above 2 -- 0, 1 and 2 are the table's
  control codes. It is **not** `ActorSwapDamagedPart`: no `NoPartSwap` test,
  no hit sphere, no step counter, no zone bit. 8 commands, all in stage 2's four
  jetty zombies (type 0xF, `znebi2`): 43584 and 55372 take the head, `0x1BFA`
  and then `0x1BFB`; 43740 and 55536 take bone 3, `0x1C00`, then the head.

The bundle carries the hand table as `characters.player_hand_slots`, and every
slot either command can write rides the character's hidden template
(`humanoidModelSlots` in `web/src/hod2lib/characters.ts`).

## Two name tables, not none

> ⚠️ An earlier revision of this document said flatly that the binary has no
> asset name table and that sound records were the only naming evidence. That
> was wrong, and it cost real time: three of the four class-survey agents
> reported identities as `[open]` on that basis. There are **two** name tables.

### 1. Character skeletons → pol filenames

`FUN_00410590` reads `PTR_DAT_004E0430[type]` for a character type. The block
holds a node count at `+0x16` and that many node pointers at `+0x18`; each node
is `{u32 asset_slot; …; u16 index @+0x14; u16 child_count @+0x16; u32 children[]}`
and recurses. Every slot resolves through the asset slot table to a **pol
filename**, and for 85 of the types all of a skeleton's slots agree on one file.

That is a complete character bestiary, and it names things the sound records
never could:

| Types | Files |
|---|---|
| `0x01`–`0x14` | the zombie variants — `znassb`, `znchain`, `zndina`, `zngold`, `znnick`, `znjoe`, `znkage`, `znken`, `znebi2/3/4`, `znele`, `znonoopa`, `znjikken1` |
| `0x1A`–`0x1F` | the small creatures — **`cat.bin`**, `frog.bin`, `frog_gold.bin`, `mol.bin`, `zabat.bin`, `zabat_wing.bin` |
| `0x20`–`0x38` | the civilians — `hito_baba`, `hito_gal`, `hito_man`, `hito_oyaji`, `hito_manbest`, `deka_musume`, … (*hito* = person) |
| `0x3E`–`0x43` | named characters — `hou`, `logan`, `curien`, and their HOD1 variants |
| `0x47`–`0x55` | the bosses — `boss2`–`boss6`, `b6boss1z`–`b6boss5` |

`ExeTables.characterSkeleton()` and `characterAssetFile()` decode it.

**The skeleton is not the whole character.** Two more tables add parts to it,
and both were missing from the port until the "civilians' hair doesn't render"
report was chased:

* `g_actor_attachment_table` (`0x004EC748`) — 81 `{s32 bone; s32 slot}` records
  named by a **per-spawn list** at `model+0x1170`. Ids below `0x24` replace a
  bone's model with a `hito_kao_*` face; ids at or above it draw an
  `etc_komono_*` accessory — hair, hats, bags, shoes — on top of it. 97 of the
  game's spawns carry a list, across classes `0x10`, `0x24` and `0x25`.
  `ExeTables.attachmentRecords()` decodes it. See
  [civilians.md](civilians.md#the-face-and-the-hair-are-not-in-the-skeleton).
* `g_pCharacterExtraParts` (`0x0052ED08`) — one or two **vertex-blended** parts
  per character type, the waist and the skirt: one bone per vertex and weight
  1, over up to four bones, re-transformed every frame. 52 of the 64 character
  types a bundle poses have one. `ExeTables.characterParts()` decodes it, and
  `g_character_part_bones` (`0x004ED1E0`) says which bones — four groups, then
  the bone the part is drawn in. Part 1's slot is the pelvis model itself, and
  `SkeletonNodeDrawSuppressed` (`FUN_004122E0`) is what stops bone 9 drawing it
  a second time. See
  [civilians.md](civilians.md#the-waist-and-the-skirt-are-not-in-the-skeleton-either).

A civilian's own head model is a shell open at the back: `hito_gal`'s
`0x0EAF` has four backward-facing vertex normals out of 149, where every zombie
head has fifteen to forty. Rendered without its attachment it is a face on a
neck.

**The cat is `[proved]`.** Class `0x53` stores character type `0x1A`, whose
eighteen skeleton nodes all land in `cat.bin`. It spawns four times, in stage 2
only, at evt `0x21F4`, `0x221C`, `0x44A4` and `0x6E98` — and `0x21F4`/`0x221C`
sit immediately after the flying-creature block, which is `zabat.bin`, the
bats. Rendering the eighteen parts corroborates it: each is about two units
across, and they read as head, torso, hips, limb segments and tail.

### The cat's two routines

`CatInit` (`FUN_00431250`) reads two s16s off the tail — an **animation set**
and a **sub-type** — seats `obj+0x1B4 = g_cat_motions[set * 5]`, and installs
one of two updates for good. `[proved]`, every line of all three read.

| Spawn | Block | Set | Sub-type | Routine | What it plays |
|---|---|---|---|---|---|
| `0x21F4` | 3 | 2 | 0 | `CatMotionListUpdate` | `0x301`×2, `0x304`, `0x2FA`, `0x2FC`, then `0x2FD` for ever |
| `0x221C` | 5 | 4 | 0 | `CatMotionListUpdate` | `0x2FC` for ever |
| `0x44A4` | 8 | 0 | 2 | `CatBranchTriggerUpdate` | `0x305`; `0x2FA` at 200 frames; `0x2FD` when shot; `0x305` past `x = -478` |
| `0x6E98` | 11 | 5 | 1 | `CatMotionListUpdate` | `0x305`×2, `0x2FC`, then `0x2FD` for ever |

**`CatMotionListUpdate` (`FUN_00431340`)** draws, steps `model[0]` and its
life counter `sub+0x12`, and when `model[0]` reaches
`g_motion_play_length[clip] - 1` resets it and counts a pass in `sub+0x1E`.
When `g_cat_motion_repeats[set * 5 + i]` is not `-2` and equals the passes, the
index `sub+0x1C` steps — wrapping on a `-1` — and the next clip is **written
straight into `obj+0x1B4`**: no `ActorSetMotion`, no fade. Past 1000 frames of
life, `ActorDespawn`. Sub-type 1 also raises `obj+0x38` bit 3, the scene-lit
draw. It never registers for the shot test, so this cat cannot be shot.

**Nothing in either routine writes the cat's position.** It moves because
`SkeletonApplyRootMotion` (`FUN_00410C50`) runs from the draw on every skinned
actor and `0x2FD` carries 12.7 units of root translation a pass (22 authored
frames, play length 44) — against 2.6 for `0x2FC` and none for `0x305`. So the
block-11 cat stands for 114 frames, creeps for 78, and runs about 230 units
before it is taken away at frame 1001.

The two tables are six rows of five s16s each, and the length is the code's,
not the data's: the routine names both bases, `0x00589A64` and `0x00589AA0`,
0x3C bytes apart. The repeat table ends at `0x00589ADB`; `g_class28_route_table`
starts at `0x00589AE0`.

**`CatBranchTriggerUpdate` (`FUN_00431430`)** despawns on
`g_script_flags[0x83]` (stage 2 raises flag 131 in block 8, the line after it
frees `cat.bin`), keeps its state in `sub+0x10` — the same word the list cat
keeps its set in (`L3`) — and ends in `ActorRegisterOriginInViewSpace`
(`FUN_0043F950`): the actor's own origin through the camera into `obj+0x70`,
then `RegisterForShotTest`, a call Ghidra's pseudocode drops because it follows
the `MatrixStackPop` it believes does not return (`L35`). So the trigger is hit
as one 4.0 sphere about its feet (`obj+0x124`, `CatInit`), and **nothing clears
its `obj+0x34` bit 3** once a shot has raised it.

The exporter bakes every clip the table names for character type `0x1A`
(`CAT_CLIPS`, `game/class53/records.ts`). It used to bake entry 0 of each
spawn's set alone — `0x2FC`, `0x2FF`, `0x301` and `0x305` — so `0x2FD` was
in no bundle, and a playlist stepping on to it would have found no frames and no
play length: the block-11 cat crept 2.7 units on `0x2FC` and stopped.

### 2. Sound records

The sound records at **`0x005845F8`**:
`{u32 id; char name[48]}`, stride `0x34`, terminated by `id == 0xFFFF` —
**324 records**. `PlaySoundId` (`0x0041CFD0`) switches on `id >> 28` through
the 9-entry table at `0x0041D324`; category 0 resolves here, category 1 through
a string-pointer table at `0x00580354`.

`ExeTables.soundRecords()` decodes it. It identifies *behaviour* where the
skeleton table identifies *models*: a `PlaySoundId` id is very often the only evidence for
what an object is. It is how the stage-2 vehicle was proved to be a car, how
class 0x51 was proved to live in water, and how class 0x30 was proved to be a
zombie rather than assumed to be one.

Records by directory: `COMMON` 61, `STAGE6_SE` 46, `COMMON2` 36, `STAGE5_SE`
32, `STAGE3_SE` 31, `STAGE1_SE` 28, `DC_SE` 27, `STAGE2_SE` 27, `STAGE4_SE` 22,
plus `COMM3`, `ETC`, `DAMEGE_GA`, `DAMEGE_JMS`, `START_COIN`.

### On animals

The creatures the sound records name are a **frog** (`KAERU`), an **owl**
(`FUKUROU`), a **bat** (`KOUMORI`), a **worm** (`WORM_TUBU`) and wing-flap
(`HABATAKI`). There is no cat sound in any of the 324 records — which is
consistent with the report that the cat is silent, and is exactly why the
sound table alone could not identify it. The skeleton table could.

### Hunting the cat

A user report gave two sightings in stage 2: near the start after the car on
the non-crash branch, and around the flying creatures. It moves and makes no
sound. That is a locality question, so it can be chased in the data without
guessing at names.

Ruled out by position: class `0x52` (the mouse) spawns twice in
stage 2, but at evt `0xDBCC`/`0xDBF4` — deep in the script, near neither place.
Classes `0x12`/`0x13` (the animated props) resolve to `komono_boat`,
`komono_st1`, `etc_1` and `sanbasi`, also elsewhere.

**The lead is class `0x53`** (`FUN_00431250`), and it fits on every axis the
report gives:

* **Stage 2 only**, four instances — evt `0x21F4`, `0x221C`, `0x44A4`, `0x6E98`
  — each with a different animation set (2, 4, 0, 5) and mode (0, 0, 2, 1).
* **`0x21F4` and `0x221C` sit immediately after the flying-creature block**
  (`0x1FF8`–`0x20C0`), which is one of the two reported sightings.
* **It moves**: `FUN_00431430` runs motion `0x2FD`, then swaps to `0x305` once
  `x < -478` — it runs away along X. (And the other three run too — see
  [the cat's two routines](#the-cats-two-routines).)
* **It makes no sound** — no `PlaySoundId` in its range.
* **It is branch machinery**, which is what "non-crash branch" points at:
  `if ((obj+0x34 & 8) && g_script_branch_var == 0 && DAT_009A2BC0 == 8)
  g_script_branch_var = 2;` — shooting it sets the route branch variable.
* It is a **skinned character of type `0x1A`**, so a small animated creature
  rather than a prop.

> **Since settled**, and this section is kept for the reasoning rather than the
> verdict. `g_character_skeletons` (`0x004E0430`) is the resolution it asks
> for: character type `0x1A`'s **eighteen nodes all land in `cat.bin`**, which
> is one of the binary's two name tables and is decisive. The functions are
> named `CatInit` and `CatBranchTriggerUpdate` on that basis.

`[open]` at the time, and deliberately so — nothing *in the code* named it.
What would settle it is resolving character type `0x1A` through the
skinned-model part pipeline (`FUN_00410590` / `FUN_00412440`) to its actual
models and rendering them. The obvious shortcut does not work: the first int of
`PTR_DAT_0052ED08[type]` is 1 or 2 for **every** character type, so it is a
variant count, not a bone count, and cannot separate a quadruped from a human.

Class `0x52` was a second candidate on shape alone — it wanders, it is small,
its model is `0x1385 + rand() % 10`. **It is a mouse**, settled the same way:
`0x1385`..`0x138E` resolve through `ExeTables.assetSlots()` to `mouse.bin`
entries 0 to 9, so the ten values that looked like a random model are the ten
frames of one animation strip. Its stage-2 positions did not match either
sighting, and now there is no need for them to.

## Item placement — SOLVED

**The items are not placed; the containers are.** Spawn class `0x41` type 0
(`PlaceBreakableGroup`, `FUN_00462A80`) places a *group* of shootable props.
The spawn's `+0x11C` is the group id.

> ⚠️ An earlier revision of this section said the item is released **when the
> last prop of an item-set is broken**. It is not. The constructor seeds
> `g_item_set_countdown` (`0x009C7010`) with `rand() % n + 1` over the `n`
> props of the set, and each break of a set member decrements it; the item
> comes out when it reaches zero. So it is a **random** one of the set's
> breaks — first, last or middle — and two runs of the same stage pay out at
> different times. `[proved]` from the constructor's tail and the destroy
> branch of `BreakablePropUpdate`.

Two tables in the EXE, not in the evt:

* `0x00593D14` — nine member counts: `{4, 2, 3, 9, 5, 3, 3, 6, 7}` = **42 props**.
* `0x00593CF0` — nine pointers to the member records.

Each member record is **10 bytes**:

```
+0x00  s16  x * 0.1
+0x02  s16  z * 0.1
+0x04  u8   item-set id
+0x05  s8   g_GameMode == 1 item kind, -1 for none
+0x06  s8   stack level; y = level * 7.540296 above the floor
+0x07  u8   number of supporting members
+0x08  u8   supporting member index a
+0x09  u8   supporting member index b
```

The support list is what makes a stack topple when a prop beneath it breaks.
**[proved] by self-consistency**: across all 42 members of all nine groups,
every member at level *n* names supports that are all at level *n−1*, and every
ground-level member names none — 42/42, no exceptions. That is a real check,
because a wrong field offset would not produce a consistent height ordering.

> ⚠️ `+0x05` was previously called an *asset variant*. It is not: the
> constructor writes the asset slot **unconditionally** (`0x19E8`, or `0x1A0F`
> for a mode-2 target) and puts this byte in `obj+0x2A0`, whose only reader is
> `SpawnStoryModeItem` (`FUN_00467B90`) and only while `g_GameMode == 1`.
> 39 of the 42 records hold `-1`; the three that do not — group 0 member 0
> (kind 2) and group 7 members 3 and 4 (kind 5) — all hide an ordinary item
> set as well, so mode 1 substitutes its own drop for theirs. `[proved]` from
> the one consumer.

The floor is `g_camera_fixed_eye_y - 0.1`, added by the constructor, so the
`y` in the record is relative — except **group 7**, which the constructor
gives a flat floor of `level * 7.540296 - 14.9` off its own pointer at
`0x00593D0C`.

Per prop: `+0x11C` = 2, i.e. **two shots** — the first plays
`PlaySoundId(0x1D16A9)`, swaps the model to `0x19E6` and shakes every member
that names this one as a support; the second plays `0x1A16A9` and destroys it.
In `g_GameMode == 2` -- **Training**, not Arcade -- the members
`g_training_lesson` (`0x009C9118`) selects instead get `+0x11C = 1` and asset
`0x1A0F`. The four "sets" that byte chooses between are the four training
lessons: `PreloadScreenAssetList` (`FUN_00412FD0`) indexes a per-lesson asset
list with the same byte at training block 3, and both readers sit behind the
same `g_GameMode == 2`.

**Only the destroying shot pays.** `BreakablePropAwardHit` (`FUN_004650F0`)
takes an `award` flag: the crack passes 0 and the destroy passes 1, so
cracking a prop is worth nothing and breaking it is worth 10. Both count
toward `g_player_hit_count`, and neither pays in `g_GameMode == 2`
(Training).

**Destroying and toppling are different things**, and it is easy to conflate
them:

* A prop at stack level 0 that is destroyed has its object entry point
  overwritten with `BreakableEffectUpdate` (`FUN_00465500`) — it becomes a
  puff for `0x48` frames and is gone. It does not fall.
* A prop **above** level 0 that is destroyed bursts through
  `BreakablePropSpawnShatter` (`FUN_00465170`) into 15 fragments and dies
  (`ActorKill`, not `ActorDespawn`). See *The shatter* below.
* A prop only *falls* when the members it names as supports have all gone. It
  then drops under `0.01361` a frame, spinning by at least `0x80`, until
  `BreakablePropGroundContact` (`FUN_00465590`) finds one of the 96 points of
  `g_breakable_hull_points` below the floor — at which point it settles onto
  that corner. That is the whole stack collapse: nothing pushes anything, and
  each prop only ever checks what it is standing on.

**Group 4 is broken by the script, never by a shot.** The hit block skips it,
and while `g_script_flags[0x65]` reads 1 every standing group-4 member breaks
by itself: a stacked one shatters, a ground one becomes the puff with effect
variant `0x1D9` — no score, no sound, no item (`0x004648FE`). `[proved]`

**The hit gate has one more exception:** in scene 1 (stage 2), block `0x11`,
a shot does nothing until `g_script_flags[0x28]` is raised; and in scene 1
`g_script_flags[0x77]` despawns every group prop, the same sweep
`PropExpireByStepLifetime` makes for the generic props. `[proved]`

#### The shatter

`BreakablePropSpawnShatter` allocates **one** `0x2B4` object running
`BreakablePropShatterUpdate` (`FUN_004653B0`), with the fifteen pieces as
parallel arrays inside it — not fifteen objects. Read from the disassembly:
Ghidra ends both bodies at the `MatrixStackPop` it believes is no-return, so
the pseudocode shows piece 0 and no loop (`L37`). `[proved]`

* Piece `i` starts at `MatrixInvert(0) * prop+0x2E4 * Translate(
  g_shatter_fragment_offsets[i] * 0.001) * Rz Ry Rx(g_shatter_fragment_angles[i])`,
  read back with `MatrixGetTranslation` and `MatrixToEulerZYX`. `prop+0x2E4` is
  what each of `BreakablePropUpdate`'s three draw blocks `MatrixStore`s — the
  model on top of the view it was drawn under — so the pieces start where the
  prop was *last drawn*, rattle included, and a camera that moved since carries
  them by that frame's motion.
* Velocity `(sin b, 1.0, cos b)` with `b = i * 0x1000` and a horizontal speed of
  `rand() % 0x15 * 0.01 + 0.1`, drawn separately for x and z; spins
  `rand() % 0x801 - 0x400` on each axis. **75 `rand()`s per shatter.**
* Each frame: `vy -= 0.06805`, move, add the spins as 16-bit words, and below
  `g_camera_fixed_eye_y + 1.0` sit on that plane with `vy *= -0.8` — unless the
  object's `+0x35` (the prop's group) is `0x63`, which no shipped group is.
  Drawn `Translate; RotZ; RotY; RotX` with `g_shatter_fragment_slots_a[i]`
  (`0x19EA`..`0x19F8`) or, when the prop's `+0x324` is non-zero — Training's
  one-shot targets — `_b[i]` (`0x1A11`..`0x1A1F`).
* The count is tested **before** the increment: 73 frames drawn, killed on the
  74th. No shot test, no `rand()` after the spawn.

A second caller, `FUN_004702E0` (`0x004704DD`), shatters with its group forced
to 99 first — the no-floor case. It is not in `g_class41_updates` and is
unported; what allocates it is `[open]`.

**Lifetime is measured in event-script blocks, not frames.** Each prop keeps
`obj+0x199` from `desc+0x24`, and despawns once the evt block counter
`0x009A2BB0` has advanced that many times past the one it spawned in.

Which stage uses which group, `[proved]` from the descriptors:

| Stage | Groups |
|---|---|
| 1 | 0 |
| 2 | 1, 2, 3, 4, 5, 6, 7 |
| 3–6 | none |

Group **8 is defined but never spawned** by any shipped stage. `[open]` whether
it is cut content or reached by a path not walked here.

`ExeTables.breakableGroups()` and `ExeTables.breakableHullPoints()` decode
all of this, and `breakablesJson` (`web/src/hod2lib/bundle.ts`) emits all nine
groups plus the hull into the player bundle's `breakables` block — the port
places them from the exe tables, so a stage-filtered list would not do.

### Three container families, one countdown

The group placer is not the only thing that hands out items. Traced by xref
from the three release routines, **five** routines call them, and every one
releases on the shot that destroys the container — there is no container that
is opened rather than broken.

| Routine | Class | Spawns | Shots | Hide an item |
|---|---|---|---|---|
| `BreakablePropUpdate` (`FUN_00464620`) | 0x41 type 0 | 8 groups, 42 props | 2 | 7 props |
| `KindedPropUpdate` (`FUN_00465FB0`) | 0x41 type 4 | **70** | 1, or 2 for a `0x19E8` crate | **37** |
| `PropUpdateType43` (`FUN_0046CEA0`) | 0x41 type 43 | **7**, all stage 3 | 1 for a kind 2, 2 for a kind 3, **and a third for the item** | 4 (a life each) |
| `FallingContainerUpdate` (`FUN_0046A580`) | 0x44 sel 16 | 2 | 2 | 2 |
| `FUN_0046B5F0` | 0x41 type 37 | 3 | — | `[open]`, unread |
| `FUN_0046FB50` | `[open]` | — | — | `[open]`, unread |

**Type 43 is the exception to the sentence above**, and it is the reason it
needed its own module rather than a row in `KindedPropUpdate`'s tables. It is
the **third** object built from `g_prop_kind_params` — `PlaceKindedProp`
(`FUN_00462E10`) and `PropBuildKindedProp` (`FUN_00473770`) build the other two
— and the item does **not** come out on the shot that destroys it. The
wreckage stays standing and a further shot into it is what pays:
`GrantExtraLife` for item set 1, an Original Mode item for set 2, and the prop
then wears the pickup's own model (`0x116A + 50 * player`). Its set is
`obj+0x194`, one byte below the `obj+0x195` the other three use, and it runs
through no `g_item_set_countdown` at all — so a type-43 prop is the one
shootable object in the game whose item is its own and not the set's.

Its **kind is the spawn descriptor's third orientation word**, `desc+0x6C`,
which the arm at `0x00462250` copies to `obj+0x290`; the same word is a roll
for most of the generic family and a slot-strip length for types 31 and 33.
The arm then zeroes `obj+0x1CC` and `obj+0x1D4`, so the descriptor's pitch and
roll are discarded and the prop bobs on a sine and tumbles on a damped spring
instead. Four of the seven are kind 3 — `0x19E8`, the ordinary breakable, two
shots — and three are kind 2, which draws no body at all and bursts in one
because its `g_prop_kind_params` effect id is non-zero. See
`game/class41/type43.ts`.

**The falling container breaks into two pieces, not three.** Its destroy arm's
loop counts `1, -1` and stops at `-3` (`0x0046A7E2`..`0x0046A95D`), allocating
each piece as a 0x378 object in the container's own pool with the container's
layout, running `FallingContainerFragmentUpdate` (`FUN_0046AD20`) and drawing
`0xA55`. One goes each way along x and z at `rand() % 11 * 0.01 + 0.1`, up at
`rand() % 0x15 * 0.01 + i * 0.5 + 1.5` from the floor `+ 2i`, a half-turn
apart in pitch — ten `rand()`s. It tumbles under `0.05444` (its pitch spin
easing toward level, its roll free), settles on the 55-point
`g_container_fragment_hull_points` through the same
`FallingContainerGroundContact` (`FUN_0046B040`) the container uses with its
48, plays `0x1916A9`/`0x1816A9`, blinks on odd counts past `0x96`, and is
killed after 181 frames. Not shootable. `FallingContainerGroundContact` also
holds a wall in scene 1 block `0x12`: a hull point past `x = -840` pushes the
object back and negates `vx`. The container itself is despawned by the scene-1
`0x77` sweep and by camera path `0x2F` at frame `0x96`, and its knock turns it
to `g_camera_block_yaw_bams` and calls `SpawnPropHitEffectScaled(obj, p, 1.5)`
rather than the spark. `[proved]`

**They all decrement the same `g_item_set_countdown`,** so an item set is not
owned by a class. Stage 2's set 2 is spread across the group placer, seven
type-4 props and the class-0x44 container, and whichever of them the player
breaks last is what pays out. That is why the three cannot sensibly be ported
apart.

The two one-prop-per-spawn families carry their payload in the descriptor's
*orientation* words rather than in a table: `desc+0x1C` is the object kind and
`desc+0x14` the item-set **size**, which is what seeds the countdown. So an
item set there is N separate spawns sharing an id, and each placement re-seeds
the countdown — the last one placed decides which break pays.

`KindedPropUpdate` also has two release-height tweaks the others do not: set 6
lifts the drop by 0.5 for kinds 2, 8 and 9, and set 7 by 0.9 for a prop wearing
`0x17AB`. And item set **4** has no arm in the switch at all: its countdown
runs down, nothing comes out, and the prop is left standing rather than
despawned. Six stage-2 props are in it; whether that is deliberate is `[open]`.

### The items themselves — what each set releases

`BreakablePropUpdate` switches on the item-set id once the countdown empties.
Three arms, `[proved]` from the switch:

| Set | Releases | Via |
|---|---|---|
| 1 | **An extra life.** `GrantExtraLife` (`FUN_00415630`) adds one to `g_player_lives`, or pays 300 points if the player is already at the cap. | `SpawnExtraLifePickup` (`FUN_00471BD0`) → `ExtraLifePickupUpdate` (`FUN_00471CC0`), drawn as slot `0x10C3` |
| 3 | **The golden frog** — a full `0x13F4` actor of character type `0x1C`, whose skeleton slots all resolve to `frog_gold.bin`. | `SpawnGoldenFrog` (`FUN_004722A0`) → `GoldenFrogUpdate` (`FUN_00471FA0`), node hook `GoldenFrogDrawBonePart` (`FUN_00463F90`) |
| 2, 5–8 | A **score pickup** of that kind. | `SpawnScorePickup` (`FUN_004723F0`) → `ScorePickupUpdate` (`FUN_004724A0`) |

Set 4 has no arm and no shipped member uses it. Which sets the data actually
places: group 0 → set 6, group 5 → set 1 (the extra life), groups 6 and 7 →
set 2. Groups 6 and 7 **share** set 2, and `g_item_set_countdown` is one
global per set, so whichever is placed second overwrites the other's
countdown.

#### The score pickup

**[proved]** from the listings of `SpawnScorePickup` and `ScorePickupUpdate`;
ported whole in `game/class41/items.ts` (filed as a generic prop of the
port's routine number `0x101`, beside the extra life's `0x100`). Unported
until 2026-10-06: the release was an `item.released` event and nothing else.

Its record is `g_item_pickup_slot` (`0x00595058`), `0xC` bytes a kind --
`u16 slot`, `s16 score` (`g_item_score_table`, `+2`), `f32 scale`
(`g_item_pickup_scale`, `+4`), `f32` release height
(`g_item_pickup_y_offset`, `+8`). Only the five kinds the release switch
hands it are read, and they travel raw in `breakables.item_pickups`:

| kind | slot | score | scale | height | drawn |
|---|---|---|---|---|---|
| 2 | `0x10B3` | 100 | 1.5 | 0.9 | turning, laid flat (`Rx(0x4000)`) |
| 5 | `0x1578` | 400 | 1.5 | 1.0 | square to the screen (`MatrixClearRotation`), never turned |
| 6 | `0x10B4` | 600 | 1.5 | 1.8 | turning |
| 7 | `0x0A4F` | **-400** | 1.5 | 2.0 | never turned; its own sound (`0x416A9`) and no strip |
| 8 | `0x10B2` | 800 | 1.0 | 0.0 | turning, UVs from its normals (`AssetSlotUVsFromViewNormals(0x10B2)`), shot 1.5 higher |

The object is `0x378` bytes: `+0x194` the kind, `+0x34 = 0x80000001`, the
prop's point raised by the row's height, the prop's step counters and
`+0x11C` (so it ages on the prop's clock), a 3.0 sphere. Each frame:
`PropExpireByStepLifetime`; on a shot (bit 3, not yet bit 30) no prop's ten
points, bit 30, the sound, `ScoreAddForPlayer` of the row's score to whoever
fired, and that player's strip; then `+0x2A0` counts the strip's frames and
past `0x31` the object goes. Kinds other than 5 and 7 turn `0x200` a frame.
The model is drawn under light block 1 (`LightsUseSecondarySet` ..
`LightsRestoreScene`) at the row's scale, solid to strip frame `0x18` and
then at `1 - n * 0.02`; while untaken it stands over the ground shadow
`0x10D0` (`Scale(3, 1, 3)`, 0.1 above the prop); once taken (and not kind 7)
the strip `+0x2A4 - 1 + n` is drawn 2.5 below it, turned with it.

**The arm for a shot both players landed on one frame is the engine's own
oddity**: `rand() % 2` picks who is paid, and the strip's base `who * 50 +
0x116A` is written into the *model*, `+0x28C`, while `+0x2A4` keeps
`ActorClearGameFields`' zero -- so the pickup draws the strip's first frame
as its model and the strip below it is `AssetDrawSlot(n - 1)`, slots 0..0x30,
which the bundle does not carry. The single-player arms write `+0x2A4` and
leave the model alone. The port records exactly that.

#### The golden frog

**[proved]** from the listings of `SpawnGoldenFrog`, constructor 68
(`PlaceGoldenFrogFromLessonTable`, `FUN_00463E50`), `GoldenFrogUpdate` and
`GoldenFrogDrawBonePart`; ported whole in `game/class41/golden_frog.ts`.
Unported until 2026-10-06.

Both allocators make a `0x13F4` actor with no class id: character type
`0x1C` on clip `0x140`, its hit slot claimed by the build, `+0x34 = 1` after
the build -- so one 4.0 sphere, not the bones -- and the parent's `+0x34`
`& ~0x80 | 0x80080000`: **the `AND` is on the word of the object handed in**
(the prop, or constructor 68's placer), not the frog's. `SpawnGoldenFrog`
puts it at the prop, turned to the camera block's eye (`atan2` in BAMS, no
half turn; 0 in stage 6 outside Training); constructor 68 at one of three
places `g_training_lesson` picks out of `g_golden_frog_lesson_xz`
(`0x0059579C`, fifteen `{s16 x, z}` rows × 0.1, `rand() % 3` drawn before the
allocation), at the placer's height, turned `0x9200`. The exporter places
constructor 68 as a `golden_frog` placement carrying the fifteen rows raw in
`xz`, with the placer's `+0x11C` as its lifetime.

Each frame: a step lifetime against `+0x11C` (the prop's, copied), counted
in `+0x1334`; gone in scene 0 block `0xE`; the light turned (`+0x1338 +=
0x300`, `+0x133C -= 0x180`) and set as the draw's direction unless Training
holds it (script flags `0xF1` up and `0xF2` down let it, as for the water);
the draw, after which the scene's direction goes back. Shot (bit 3 while
`+0x1310` is 0): no points of its own, clip `0x13F` (fade 4), `0x3B17A9`,
1000 to whoever fired and their strip base in `+0x13F0`. When the draw finds
the shot clip at its play length (`model+0x5D`) `+0x1310` is 2 and the clip
holds; the strip `+0x13F0 + +0x1350` is drawn at its feet for 50 frames, the
hook drawing every node faded from frame 25 (`1 - n * 0.02`), and then it
goes. Its sphere is bone 1's point (`SkeletonEmitNode`'s `obj+0x100`) 0.25
lower.

The port files it under class 0x41 with its own routine on the actor's tail
(`class41/placer_state.ts`) and draws it from a hidden template row of type
`0x1C` (`ResultFigureTemplateAt(0x1C)`), which the exporter emits with both
clips and both players' strips wherever a placement can let one out
(`stageMakesGoldenFrog`): stages 2, 3 and 6 of the six.

## How a prop is shot — a sphere, and never a model

**[proved]** Nothing in the engine's shot test looks at geometry.
`RegisterForShotTest` (`FUN_00405160`) publishes a point and `obj+0x124`;
`ShotTestSphere` (`FUN_00404630`) tests that sphere and, only for an object
with `obj+0x34` bit 7 **and** a character skeleton, descends into the bones. A
prop has no skeleton, so a prop is always one sphere, whole — and whether it
draws anything is beside the point. Three of the class-0x41 types that carry a
shot radius draw no static model at all.

Which of the three tests an object gets is `obj+0x34` bit 4:

| bit 4 | routine | what it measures |
|---|---|---|
| clear | `ShotTestSphere` (`FUN_00404630`) | `obj+0x70..0x78`, radius `obj+0x124` |
| set | `ShotTestMesh` (`FUN_00404A00`) | the volume at `obj+0x14C` / `obj+0x150` |

### Where the sphere is

Each routine builds the point itself, at its tail, and **they all differ**. The
twenty that were read, as an offset from the object's own position:

| type | routine | offset | radius | note |
|---|---|---|---:|---|
| 7 | `FUN_00466930` | `(0, −57.0, 0)` | 12 | 57 units **below** its origin |
| 11 | `FUN_00467C80` | `(0, 0, 0)` | 2 | its *draw* orbits; the sphere does not |
| 14 | `PropUpdateType14` | `(0, 0, 0)` | 2 | states 0 and 1 only |
| 19 | `PropUpdateType19` | derived | 1.5 | a rotated pivot the port does not run |
| 20 | `FUN_00469380` | `(0, −1.0, 0)` | 7 | |
| 25 | `PropUpdateType25` | `(0, 12.0, 0)` | 12 | **draws nothing at all** |
| 40 | `PropUpdateType40` | `(0, 0/2.5/5/8, 0)` | 5.5 | picked from the draw slot |
| 41 | `FUN_0046CC50` | `(0, 5.0, 0)` | 7 | one sphere however far the hinge opens |
| 49 | `FUN_0046E6E0` | `(0, 1.0, 0)` | 5 | on a position the tumble rewrites |
| 56 | `PropUpdateType56` | `(4.8, −0.55, −10.5)` | 1.5 | |
| 57 | `FUN_0046F350` | a world constant | 5 | never reads its own position |
| 58, 60 | `FUN_0046F580`, `FUN_0046F840` | `(0, 0, 0)` | 3, 2 | |
| 69 | `PropUpdateType69` | `(0, 1.5, 0)` | 4 | |
| 70, 71 | `OriginalItemPropUpdate` | `(0, 1.5, 0)` | 3 | y is live on the bobbing one; 6 for a scene-4 row-1 prop |
| 72 | `PropUpdateType72` | `(0, 1.5, 0)` | 3 | while falling only |
| 73 | `PropUpdateType73` | `(0, 8.0, 0)` | 12 | the draw adds `+0x1C8` to z; this does not |
| 74 | `PropUpdateType74` | `(0, r·0.5 − 2, 0)` | 9 | the only one that reads its own radius |
| 75 | `PropUpdateType75` | `(0, 0, 0)` | 3 | the model flies a path, **the sphere stays** |
| 76 | `PropUpdateType76` | `(−2.5, −30.0, −17.5)` | 3 | the single door, on world axes; the pair's is its plate |
| 77 | `PropUpdateType77` | `pos + RotY · path` | 6 | on an odd blink frame, whatever the stack held |

The group props are half a stack level up (`3.770148`) while standing and at
their raw origin once toppling, with a radius of 5; the kinded props take both
numbers from `g_prop_kind_params`; the falling containers register their raw
origin at a radius of 8.

### `StoryModeSwitchUpdate` never writes a point

**[proved]** `FUN_00474F30` calls `RegisterForShotTest` unconditionally and
writes `obj+0x70..0x78` **nowhere**. `PlaceStoryModeSwitch` decides which
consumer sees it, from the descriptor's `+0x08`:

* not `-1` — `obj+0x34 |= 0x51`, bit 4 **set**, so it goes to `ShotTestMesh`
  against the volume at `obj+0x14C`. All **nine** shipped switches are this.
* `-1` — bit 4 clear, radius 8, and the centre is still `(0, 0, 0)` because
  nothing ever wrote it. `RayTestSphere` is a perpendicular-distance test with
  no divide, so a centre at the origin is distance zero from every ray: the
  switch would answer **any shot fired anywhere**. Whether that is intentional
  is `[open]`; no shipped switch takes the path.

The port files the mesh arm in the shot-test list and traces the shot against
the blob through the draw's matrix (`game/class44/story_switch.ts`); before
that it gave the arm a radius of 0, and no shipped switch could be shot. The
routine never clears the hit bits, so a keyed door shot by a player with none
of its four items throws on the first frame one is held, and the first door
thrown throws every other one standing through `g_story_switch_thrown`
(`0x009A26EC`).

### The spark is at the crosshair, and the blood is not

`SpawnPropHitSpark` (`FUN_00465860`) is the one effect in the whole shot path
that lands where the shot was **aimed** rather than at the middle of what it
hit. Its position is the crosshair unprojected to the prop's own camera depth:

```c
x = -(g_crosshair_x[player] * obj[0x78]) / g_projection_distance_px;
y = -(g_crosshair_y[player] * obj[0x78]) / g_projection_distance_px;
z =   obj[0x78];
transform by the camera matrix;                 /* into the world */
z = obj[0x1A4];                                 /* ...and then z is replaced */
```

The last line is two `MOV [ESI+0x3C]` in a row at `0046592B` and `00465936`,
so the transformed `z` is written and immediately thrown away.

**[proved]** `obj+0x1A4` is the prop's world **z**: `FUN_0046F350` writes the
literal `0xC4044F9E` into it, which is `-529.244`, and that is the third
component of the fixed world point the same prop type registers for its shot
test. Six class-0x41 routines write world-scale negative literals there and
nothing else does.

Its object is its own type, not a sprite effect — no kind switch, no sound and
no distance law — but the same flipbook shape. `PropHitSparkUpdate`
(`FUN_00465950`) steps the cursor
**before** it draws, so the slot it is seeded with (`0x904`) is never seen and
the drawn run is `0x905..0x919`, the tail of the wood strip.

## Getting spawns into a renderer

`resolveSpawn` (`web/src/hod2lib/spawnres.ts`) resolves a spawn to its
character type and asset file, and `web/src/hod2lib/characters.ts` builds the
characters the bundle carries from that. The glTF holds no node per spawn: the
spawns travel in `<stage>.script.json`, and the characters as rigs placed at
them.

**562 of 1225 spawns are identified**, across 52 distinct characters. Only
classes whose handler has actually been read get a rule; there is deliberately
**no** guess-from-the-descriptor fallback. Adding one looked attractive —
opcode `0x09` really does copy `desc+0x24` into `obj+0x1F4` — and it "resolved"
962 of 1225, but most of the extra hits were `char_adv02` purely because class
`0x41` uses that field as a prop lifetime and a lifetime of 0 is character type
0. Fewer, correct identifications beat more, wrong ones.

**The part models carry no pose.** Every part model in `cat.bin` and
`hito_manbest.bin` is authored about its own origin — the per-part centroids
are all within a unit of zero — so where each part sits is the skeleton's, from
the EXE, and the motion data's (`mot/`), which is how `characters.ts`
assembles a character. The single-model prop classes draw from the model
alone.

## Open questions

* The sound-id encoding looks like `(record << 8) | 0xA9`. Several records were
  resolved to filenames (`COM\…`, `COMMON\…`, `STAGE2_SE\…`) via the tables at
  `0x005845F8` and `0x00584834`; the general index has not been written down
  here yet.
* Class 0x30's state slots `0x16`–`0x35` are enumerated but mostly unread, and
  whether any of them touches a tail offset above `+0x20` is unknown — so its
  descriptor size is a **lower** bound of `0x48`, not a ceiling.
* No descriptor size is encoded anywhere: the opcode handlers read a
  `-1`-terminated list of absolute descriptor *addresses*, so a packed-list
  walk is not something the engine ever does. The only bound available per
  class is the highest tail offset its handler dereferences.
