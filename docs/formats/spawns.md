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
allocation size differ. `hod2lib.evt.Spawn.param(k, kind)` reads it with the
same `k` a handler writes as `obj+0x1390 + k`.

`obj+0x1316` — the header's `+0x20` word — is the seed of the combat classes'
flag word `obj+0x136C`, and it is **not** the "always 0" this document and the
exporter both used to claim: 23 of 51 class-0x31 and 76 of 345 class-0x30
descriptors set it. It reaches the bundle as `desc_flags`. See
[evt.md](evt.md#0x20--the-class-flag-word-and-the-reading-that-was-wrong).

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

Treat the name `hp` in `hod2lib.evt.Spawn` as historical.

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
| `0x41` | `PropContainerPlacerUpdate` (`FUN_00461CD0`) | 441 | **Breakable-prop / item-container placer.** A transient stub: dispatches on `obj+0x130C` through `g_class41_constructors`, 79 entries at `0x00593580`, builds child actors, then `ActorKill`s itself. Never drawn, never damaged. Type 0 is the breakable group (8 spawns) and is **ported**; type 4 (`PlaceKindedProp`, 70 spawns) reads `obj+0x6C` as an object kind; type 32 is the **lift** (`LiftUpdate`) and is ported. The retail stages reach 74 of the 79. See *The generic props' `+0x11C`* below. | `[proved]` |
| `0x30` | `FUN_00452DA0` | 288 | **The zombie.** HP, per-body-part damage zones, 80 points on kill / 10 per hit / 120 + combo on a head hit, a 54-state machine at `0x00592AE8`. Increments `g_enemies_alive`. State 2 (`FUN_00455720`) plays `COMMON2\ZOMBIE_041_16.wav`; the type-2 setup plays `CHAIN_SAW_22.wav` and a later state `KNIFE1_44.wav`. | `[proved]`, by the game's own sound record **Eleven of the 54 states never look at the camera**: they work on `obj+0x1394`, the object the actor was built for, and for 47 of the 59 spawns that reach one that is the class-0x10 civilian whose `CivilianInit` built them. See docs/formats/civilians.md. |
| `0x44` | `PropPlacerDispatch44` (`FUN_00472B10`) | 204 | **Prop placer.** Same shape as 0x41: dispatches on `obj+0x11C` through `g_class44_subtypes`, 18 entries at `0x00595AB8`, builds a child, `ActorKill`s. Selectors 0 (`PropBuildScriptFlagEffect`), 16 (`PlaceFallingContainer`) and 17 (`PlaceStoryModeSwitch`) are read and ported; 1, 2 and 4 are hinges read by `props.md`; the rest are unread. | `[proved]` |
| `0x25` | `ScriptedHumanoidInit` (`FUN_004840D0`) | 142 | **Script-driven humanoid actor.** A bytecode VM (`FUN_004842A0`) drives a skinned character. Not an enemy, not damageable, awards nothing — shots land in its hit slot and nothing consumes them. **It is also how the game draws the player's own body in a cut scene** — see *`op 10` is an `if`* below. | `[proved]` |
| `0x10` | `CivilianInit` | 51 | **Civilian / rescuable victim. Ported** (`game/class10/`) — a bytecode VM whose 136 command streams are compiled into the **exe**, not the evt. Each civilian is held by class-0x30 captors its own Init builds from descriptors nothing in the script points at; killing them all pays **+400**. Shooting the civilian costs a **life** and −100 twice. Proved by voice records: `COM\220_Y_M.WAV`, `COM\209_M.WAV`, `COM\190_Y_W.WAV`, `COM\207_OLD_W.WAV`, `COM\200_C.WAV` — young man, man, young woman, old woman, child. Its face and its hair are an **attachment list** at the spawn tail's `+0x08`, not part of its skeleton — 52 of the 65 spawns carry one. See docs/formats/civilians.md. | `[proved]` |
| `0x31` | `EnemyThrowerInit` (`0x00449620`) | 49 | **The wall-crawler**, four character types (`0x16`-`0x19`) over one 35-state machine and four **behaviour sets**, the set taken from the descriptor's byte +1 rather than from the model. Set 1 (`zsass`) stands out of reach and throws; set 0 (`zstin`) climbs the walls and the ceiling at 40-50 units and **arcs onto the camera with a knife** inside 30, connecting on a frame of the leap clip rather than on any range test, then leaps back out to one side. The whole repertoire is a pick table, `g_class31_action_picks`. **Ported.** See [`combat.md` §12](combat.md). Ricochet SFX by subtype: `BULLET_WOD1_16.WAV` (wood) for `0x17`, `BULLET_MET2_16.WAV` (metal) for `0x19`. | `[proved]` |
| `0x24` | `SetPiecePropInit` (`FUN_00482CE0`) | 48 | **Scripted non-combat set-piece prop.** Not damageable, awards nothing, plays no sound at all (all 496 `PlaySoundId` xrefs checked). A skinned actor choreographed against the **camera**: six state selectors covering idle, a delayed motion change, freeze/unfreeze cues, two gravity drops and a slide, and every one of them is removed when the camera reaches a named path at a named frame. `obj+0x11C` is an animation phase seed. **Ported.** | `[proved]` |
| `0x33` | `ScriptedSceneryDispatch33` (`FUN_00432FF0`) | 44 | **Generic scripted scenery**, eleven sub-handlers on `obj+0x11C` plus a twelfth at 99. Selector 8 is the bridge collapse (`BRIDGE_CRASH1_22.wav`), 9 a car fire (`CAR_FIRE_22.wav`), 11 the **ending-branch selector** — it picks `ENDL.WAV` or `ENDS.WAV` from the player's score rank. Selector 4 is a *kickable* prop: shootable, but a hit only imparts an impulse. Selector 2 (`ScriptedPropDrawUntilFlag`, `FUN_00433A10`) is a static prop drawn until a camera frame or a script flag, and its ten spawns reach the player through `props`. **Selector 1 is ported** (`game/class33/`): `ScriptedCarrierUpdate33` (`FUN_004331D0`) and `ScriptedCarrierStepPath33` (`FUN_00433860`) — a vehicle that rides an `op_` path from `g_cam_path_frame - 1`, and it is **the** `g_carrier_object`. The four sounds settle what it is: `DRIVE_DEAD2_22.wav` seated, `DRIVE_DEAD2_22_OFF.wav` at its effect frame, `CAR_FIRE_22.wav` twenty frames later and `CAR_FIRE_22_OFF.wav` as it leaves — two loops with their off halves, so it drives in and then burns. It raises two `obj+0x34` bits and each is another class's way out: `0x10000000` ends `ZombieStateRideCarrier` (class 0x30 state 29) and `0x40000000` ends `ZombieStateDelayedStrikeInPlace` (state 32). Three shipped spawns — stage 2 `0x4FD0` and `0x12590`, stage 5 `0x1CE4`. Not ported: the ten other sub-handlers, `RegisterForShotTest` (`FUN_00405160`) at `0x004334D0`, and the drawing from `0x00433463` to `0x0043382F`, which is `tools/hod2lib/rigs.py`'s `obj_4331d0`. | `[proved]` |
| `0x51` | `FUN_00438540` | 28 | **Water enemy.** Rises from the water plane, bobs on the surface, claims one of four attack slots and lunges to bite for 1 damage inside 8.0 units. Dies to a single hit, worth 80 points. Splashes play `COMMON\SIBUKI2_16.WAV` / `SIBUKI3` (*shibuki*, "splash"); death plays `BLOOD07_16.WAV`, so it is organic. | `[proved]` |
| `0x26` | `Class26InstallSubtypeUpdate` (`FUN_0048E290`) | 25 | **Vehicle-and-scenery family**, 8 subtypes, no combat role at all. The handler is an *installer*: it switches on the s16 at `obj+0x11C` and writes the chosen update into `obj+0x00`, so it runs once per spawn. Only subtype 2 is shootable, and it is indestructible — it sparks and nothing decrements. Subtypes 0/1/4 draw a four-wheeled vehicle with hinged doors, a steering wheel, axles that spin only while moving, and a shattering windscreen; subtype 1 is `St1VehicleUpdate`. Subtype 2 is `Class26Subtype2Update` (`FUN_0048EAD0`), which rides one of nine `op_` paths picked by `g_active_cam_path`, sets `g_carrier_object` and draws asset slot `0x1A37` — stage 3's boat, the same model class 0x25's draw variant 3 puts under its passengers. | `[proved]` |
| `0x43` | `FUN_00445DB0` | 14 | **Flying enemy.** Plays `COMMON2\HABATAKI6_16.wav` (*habataki*, "wing-flap"); increments both enemy counters and picks a target player. | `[proved]` flying enemy; species `[open]` |
| `0x2D` | `FUN_00426A70` | 3 | **Large multi-part creature**, boss-shaped: spawns 8 sub-part actors each carrying `+0x131B = i`. In Boss Mode it puts itself on object path `0x185`. | `[proved]` |
| `0x42` | `FUN_0042F9B0` | 3 | **Batch of falling shootable breakables** — 6–15 depending on player count, one flagged special at random. They fall under gravity and break into halves. | `[proved]` mechanism; what they *are* `[open]` |
| `0x21` | `RescueTargetInit` (`FUN_00451720`) | 1 | **The rescue target**, and the branch writer that decides stage 2's first fork. Rank-scaled hit points from `g_class21_hp_by_rank` (`0x00565F0C`), 1 or 2. Rides in on the camera path, then `RescueTargetHeldState` charges one point per body part shot; the last one writes `g_script_branch_var = 1`, counts a rescue, pays 80 + 400 and gives both enemy counters back. Its one spawn is stage 2 block 0, whose record is `{11, 1, -1}` — so killing it takes block 1 and leaving it takes block 11. **Ported** (`game/class21/`). | `[proved]` |
| `0x2B` | `FUN_00438060` | 4 | **Scripted dynamic light source.** Claims a slot in the entity-light array (stride `0x1D` dwords at `0x009A1A88`) and releases it on a stop condition chosen by `obj+0x11C`. | `[proved]` |
| `0x29` | `FUN_00432C80` | 3 | **Static scenery batch** — draws a fixed list of instances, `{int slot; float x,y,z; int rotY; float scale}` at stride `0x18`, from one of three lists chosen by `obj+0x11C`. | `[proved]` |
| `0x16`/`0x17` | `00442290`/`004422D0` | 6/8 | **The water-wave field.** `0x16` creates the manager and records the water plane Y; `0x17` adds one wave source, `obj+0x11C` selecting travelling or circular, with `{amplitude, wavelength, speed}` from its tail. | `[proved]` |
| `0x15` | `FUN_00441750` | 4 | **Row spawner for floating props** — N copies spaced by a delta vector, each sampling the wave field. | `[proved]` |
| `0x52` | `MouseInit` (`FUN_0043F4C0`) | 10 | **The mouse.** Its ten draw slots `0x1385`..`0x138E` are `mouse.bin` entries 0 to 9 — an asset filename, which is one of the binary's two name tables and settles a species this section had as `[open]` on the grounds that the class plays no sound. Subtypes 0 and 1 run `MouseWanderUpdate` (`FUN_0043F5C0`): 0.4 units a frame along the spawn yaw, a 40% chance every hundredth frame to hold for 60 and turn by the difference of two twelve-bit draws, and a despawn at 600 frames. Subtypes 2–4 run `MouseBranchTriggerUpdate` (`FUN_0043F720`), a **shootable route-branch trigger**: the first hit writes `g_script_branch_var` from the signed byte at `0x00564442 + subtype` — **2, 1, 2** for subtypes 2, 3, 4 — and it then runs the strip and flees until it passes its own bound. **Only in Original Mode**: the Init despawns subtypes 2–4 outright unless `g_GameMode == 1`. Stage 4 block 10 is the clean case, `next = [12, 18, 19]` with one subtype-3 and one subtype-4 mouse in it. **Ported** (`game/class52/`), drawn and shot through `render/slotmodels.ts` and `ShotTestSphere`. | `[proved]` |
| `0x53` | `CatInit` (`FUN_00431250`) | 4 | **Skinned NPC.** Subtype ≥2 runs `CatBranchTriggerUpdate` (`FUN_00431430`), a shootable branch trigger that writes `g_script_branch_var = 2` — but **only in event block 8, and only while the variable is still 0** — then reacts and runs away. **Only in Original Mode.** All four spawns are stage 2, in blocks 3, 5, 8 and 11; the block gate is what keeps the three outside block 8 from writing a 2 into a record that has no slot 2, and `tools/verify_branches.py` fails if it is dropped. **Ported** (`game/class53/`). | `[proved]` |
| `0x40` | `PlaceHorde` (`FUN_0043BD30`) | 9 | **Horde spawner — a flock of enemies, not scenery.** Allocates N members running `HordeMemberInit` (`FUN_0043BEF0`) into `g_horde_members` (0x007DCC20, 10 slots), each carrying its index at `+0x131B`, then `ActorKill`s itself. `obj+0x130C`: 0 → one; 1 → 8, or 10 with two players, 6 in evt blocks 0x0E/0x12 (8 with two players) and 4 in block 0x19; 2 → not a spawner at all. Every member is character type **0x1D = `mol.bin`**, a six-segment chain; each increments *both* enemy counters (except variant 2), dies to one shot for **80 points** playing `STAGE1_SE`/`STAGE2_SE` `PDMG_MORR1/2_44.wav`, and casts a ground shadow at slot `0x10D0`. `HordeMemberUpdate` (`FUN_0043C440`) is a seven-state machine: fly in along a six-segment spline from `g_horde_formation` (0x0055E200), wander a per-variant box (0x0055E568/0x0055E574) avoiding neighbours inside 6.0 units, wind up, dive at the camera, pull out. **Not ported** — an enemy AI of zombie scale. | `[proved]` mechanism; species `[open]` |
| `0x11`, `0x14`, `0x32` | — | 4/5/2 | **Enemies**, all incrementing both enemy counters. | `[proved]` |
| `0x19` | `Boss4Init` (`FUN_004917E0`) | 4 | **The stage-4 boss.** Character type **`0x4A` = `boss4.bin`**, fifteen nodes, 300 hit points, and the four spawns in the game are stage 4's blocks 23, 25, 27 and 29 — one per entrance. Its tail is `+0x00` the character type, `+0x01` the entrance state (0..3, one of each), `+0x04`..`+0x3C` **fifteen per-bone model pointers** written into `char + i*0x90 + 0x100` for `i = 1..15`, and `+0x40`/`+0x42` the camera path and frame it despawns on. A 0xA4-byte state block at `obj+0x1310` carries a 24-entry state index (`g_class19_states`, `0x00597298`), a sub-state, and a **nine-phase arena counter** whose `g_boss4_phase_hp_fraction` share of the bar is a floor under the damage: `Boss4ResolveShot` (`FUN_00491B40`) takes hit points only on **bone 2** (or a `0x3D` surface) and refuses every shot below the floor until the arena moves the phase on. The gates: the entrance raises `g_script_flags[31]` (`0x0049390C`, `0x00493B99`) once its own intro banner (`BossIntroBannerUpdate`, `FUN_00437AC0`) has run 300 frames and set the shutter to 1, and `Boss4StateDeath` raises `g_script_flags[32]` (`0x004958C7`) on frame 0x46 of the death clip. **Partly ported** (`game/class19/`): Init, the dispatch, the four entrance states, the banner, the shot, the flinch and the death; the seventeen fight states and the arena progression are not. | `[proved]` |
| `0x14` | `Class14Init` (`FUN_00475E90`) | 5 | **The stage-2 boss.** Character type `0x47` = `boss2.bin`, fought over water on `sanbasi.bin`'s pier. Init allocates a **0xBC-byte behaviour block** (`ActorAllocSub`) at `obj+0x1310` and points `g_class14_state` at it, increments both enemy counters, seats a 30-unit shot sphere at `obj+0x124`, and installs `Class14Update` (`FUN_00476150`). The update dispatches `g_class14_states` (`0x00596218`), **21 handlers**, and steers the boss inside a quad of water the descriptor gives it. `tail+0x01` is the state it starts in and is the only thing that tells the five spawns apart: **stage 2 blocks 35, 37, 39 and 41 are four alternative endings** (states 0, 1, 3, 4) and stage 5 block 3 is a cameo (state 2). `Class14AdvancePhase` (`FUN_00477E60`) walks `state+0x08` as the hit points fall past `g_class14_phase_hp_frac`, and that phase is the whole of **which of `g_script_flags` 10..17 and 31 the boss raises** — twelve writers, more than any other class in the game, and 21 of the game's 61 `wait_script_flag` gates. `Class14ResolveShotBone` (`FUN_00476270`) and `Class14ApplyBoneDamage` (`FUN_004763E0`) are its **own** damage path: `g_class14_bone_damage[rank][players-1]`, doubled and capped at 33, and no `ResolveHit`. **Ported** (`game/class14/`) — the machine, the phases, the damage and every flag; the sounds, the two dialogue lines, the water enemies it summons (class 0x51) and the camera it drives in the between-rounds cut are not. | `[proved]` |
| `0x11`, `0x19`, `0x32` | — | 4/4/2 | **Enemies**, all incrementing both enemy counters. `0x19` takes ~15 per-bone model slots straight from its tail. | `[proved]` |
| `0x12`, `0x13` | `0043F9D0`/`0043FE10` | 3/23 | **Script-driven animated props**, sharing a 10-entry behaviour table at `0x005926A8`. | `[proved]` |
| `0x22` | `FUN_0049B0D0` | 4 | Enemy with four behaviour variants plus a companion actor. | `[proved]` |
| `0x27`, `0x28` | `004329D0`/`00432610` | 2/6 | **Path-riding vehicles/props**; `0x27` swaps model and lights a flame at path frame `0xBE`. | `[proved]` |
| `0x20` | `OneHitTargetInit` (`FUN_00448ED0`) | 36 | **The one-hit target.** A skinned actor — all 36 are character type 7, `char_adv00.bin` — that **dies to any single hit**: nothing in the class subtracts from `obj+0x11C`, so the branch on `obj+0x34` bit 3 is the whole damage model. Scores like the combat classes — 10 a bone, 120 + `g_head_combo_bonus` on bone 2, 80 for the kill — then plays motion 988, holds its last frame and sinks 0.04 a frame for 120 frames before despawning. Not an enemy: the Init increments no counter, so no `wait_enemies_alive` gate sees one. Un-shot it is removed when the camera reaches `tail+0x02` at frame `tail+0x04`. `obj+0x130C` is a sub-type: 0 stands (7 spawns), 1 spins ±0x40 BAMS a frame with `obj+0x11C` as the direction (5), 2 is clamped into an x/z box at `tail+0x08`..`+0x14` and turns 0x100 away at each wall (24). Motion comes from `tail+0x06`, and **0 there means `g_class20_idle_motions[rand() & 3]`**. **Ported** (`game/class20/`). | `[proved]` |
| `0x2A` | `FUN_00432D40` | 4 | **Dead class** — the whole handler is `JMP ActorKill`. | `[proved]` |
| `0x60` | `ChapterCardInstall` (`FUN_004342E0`) | 8 | **The chapter card**, and the actor `wait_script_flag 0xF8` waits for. Placed by `spawn_simple` (0x0A), not by a placement descriptor: its whole record is `{class 0x60, hp 0}` in `comevtbl.bin` at `0x00977234`, so it has no position at all. An installer first — `g_GameMode == 3` and `g_app_state == 0x0B` each swap in a different update — then a two-sub card: sub 0 seats the lights and the eight text slots at `0x007DCBA0` and latches `obj+0x11C = 0xB4`, sub 1 draws and counts it down, and at zero it raises **`g_script_flags[0xF8]`** at `0x004348C1` and `ActorKill`s. That one instruction is the only literal writer of flag 248 in the image. A pad press (`g_pad_state` bit 2) cuts the dwell short once it is below `0xA0`. **Ported** (`game/class60/`) — the lifetime and the flag; the card itself is screen furniture the player does not draw. | `[proved]` |
| `0x61` | `ResultCardInstall` (`FUN_00434EF0`) | 5 | **The stage-clear card**, and `wait_script_flag 0xFE`'s only opener: a whole-image byte search for `0x009C72FE` finds exactly one instruction, `MOV byte ptr [0x009C72FE], 0x1` at `0x0043567C`, and it is this actor's last act. Sub 0 drops `g_nFiringGate`, latches `obj+0x11C = 0x1A4` (420 frames) and falls into the tally; sub 1 hands over to the score count-up once the dwell is at or below `0x78`; every arm ends on the same decrement. **Ported** (`game/class61/`), on the same terms as 0x60. | `[proved]` |
| `0x62` | `ResultCardTally` (`FUN_00435930`) | 5 | The result card's companion, placed by `spawn_simple 0x00977244` immediately before it. Loads texbank `0x16A` and sound `0x7C`, then walks the per-scene rescue list at `0x0055DF50` against `g_civilians_rescued_by_scene`. **Writes no script flag** — every writer in the image falls outside its range — so the port names it and gives it no module. | `[proved]` |
| `0x63` | `InitCutsceneSkipWatcher` (`FUN_00435F20`) | 45 | The commonest `spawn_simple` record (`0x0097724C`), at the top of most steps in every stage. Installs `CheckCutsceneSkipRequest` from the task table at `0x005934E4`; the installed update `ActorKill`s outright while `DAT_009A2D7C` is zero. **Writes no script flag.** | `[proved]` |
| `0x45`, `0x46` | — | 37/27 | Not reached. | `[open]` |

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
  `op 8` and `op 4` mode 4 are; no shipped arm contains one, and
  `tools/verify_scripted_clips.py` is what says so.

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
`tools/verify_scripted_clips.py` prints how many `op 10` tests the six stages
carry, and follows every one of them.

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
| 33 | `FUN_00472950` | `obj+0x28C + n`, a strip played as an animation |

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

**[proved]** Types **70, 71, 72 and 77** open with
`if (g_GameMode != 1) { ActorDespawn(obj); return; }` — they are Original
Mode's collectibles and are gone on their first frame of an Arcade run.

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
and blend the neighbouring keys, and 2 additionally slerps through matrices
when any axis differs by more than `0x3000`.

**[proved] by the slot names.** Every node of an effect resolves to one
`komono_*.bin` — *komono*, "small items", the same family as the breakable
props:

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

**The node tree and the effect stride are now read**, and
`tools/verify_effects.py` holds both against the whole corpus: all 29 trees
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
tail+0x00  s8   character type   (Boss Mode remaps 0x39/0x3A to the player's)
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
| 9 | swap the model in a hand, from `0x004EC9E0` | 114 |
| 10 | skip an arm unless the player count matches | 100 |
| 1 | as 0, with the mark set to 1 | 88 |
| -1 | leave the VM for the idle routine | 69 |
| 18 | `ActorKill` | 68 |
| 11 | ride an `op_` object path | 24 |
| 13 | `PlaySoundId` | 14 |
| 8 | set the position | 13 |
| 17 | hand the object to another routine | 12 |
| 2 | set the motion | 10 |
| 16 | swap one bone's draw slot | 8 |
| 6 | stop turning, or face the camera | 8 |
| 7 | face a point once | 4 |
| 5 | turn by a fixed amount over N frames | 1 |

The condition modes opcodes 0, 1 and 4 share: `0` a frame count, `1` the camera
reaching a path at a frame, `2` a motion frame (`-1` for the clip's last), `3` a
script flag, `4` "am I closer to this point than I was last frame", `-1`
unconditional.

**A command that cannot proceed does not advance the cursor.** It falls through
to the per-frame tail and is retried next frame, so a run of setup commands all
take effect at once and only a wait costs a frame. `op 11` evaluates its path
at the **camera's** frame, which is what keeps a scripted actor in step with
the shot it belongs to.

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

`ExeTables.character_skeleton()` and `character_asset_file()` decode it.

**The skeleton is not the whole character.** Two more tables add parts to it,
and both were missing from the port until the "civilians' hair doesn't render"
report was chased:

* `g_actor_attachment_table` (`0x004EC748`) — 81 `{s32 bone; s32 slot}` records
  named by a **per-spawn list** at `model+0x1170`. Ids below `0x24` replace a
  bone's model with a `hito_kao_*` face; ids at or above it draw an
  `etc_komono_*` accessory — hair, hats, bags, shoes — on top of it. 97 of the
  game's spawns carry a list, across classes `0x10`, `0x24` and `0x25`.
  `ExeTables.attachment_records()` decodes it. See
  [civilians.md](civilians.md#the-face-and-the-hair-are-not-in-the-skeleton).
* `g_pCharacterExtraParts` (`0x0052ED08`) — one or two **vertex-blended** parts
  per character type, the waist and the skirt: one bone per vertex and weight
  1, over up to four bones, re-transformed every frame. 45 of the 54 character
  types a bundle poses have one. `ExeTables.character_parts()` decodes it, and
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

### 2. Sound records

The sound records at **`0x005845F8`**:
`{u32 id; char name[48]}`, stride `0x34`, terminated by `id == 0xFFFF` —
**324 records**. `PlaySoundId` (`0x0041CFD0`) switches on `id >> 28` through
the 9-entry table at `0x0041D324`; category 0 resolves here, category 1 through
a string-pointer table at `0x00580354`.

`ExeTables.sound_records()` decodes it. It identifies *behaviour* where the
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
  `x < -478` — it runs away along X.
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
`0x1385`..`0x138E` resolve through `ExeTables.asset_slots()` to `mouse.bin`
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
In `g_GameMode == 2` the members `g_prop_target_set` (`0x009C9118`) selects
instead get `+0x11C = 1` and asset `0x1A0F`.

**Only the destroying shot pays.** `BreakablePropAwardHit` (`FUN_004650F0`)
takes an `award` flag: the crack passes 0 and the destroy passes 1, so
cracking a prop is worth nothing and breaking it is worth 10. Both count
toward `g_player_hit_count`, and neither pays in `g_GameMode == 2`.

**Destroying and toppling are different things**, and it is easy to conflate
them:

* A prop at stack level 0 that is destroyed has its object entry point
  overwritten with `BreakableEffectUpdate` (`FUN_00465500`) — it becomes a
  puff for `0x48` frames and is gone. It does not fall.
* A prop **above** level 0 that is destroyed bursts through
  `BreakablePropSpawnShatter` (`FUN_00465170`) into 15 fragments and dies.
* A prop only *falls* when the members it names as supports have all gone. It
  then drops under `0.01361` a frame, spinning by at least `0x80`, until
  `BreakablePropGroundContact` (`FUN_00465590`) finds one of the 96 points of
  `g_breakable_hull_points` below the floor — at which point it settles onto
  that corner. That is the whole stack collapse: nothing pushes anything, and
  each prop only ever checks what it is standing on.

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

`ExeTables.breakable_groups()` and `ExeTables.breakable_hull_points()` decode
all of this. `export_level.py` emits the groups a stage actually places into
`<stage>_objects.json`, and `hod2lib.bundle.breakables_json` emits all nine
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
| `FallingContainerUpdate` (`FUN_0046A580`) | 0x44 sel 16 | 2 | 2 | 2 |
| `FUN_0046B5F0` | 0x41 type 37 | 3 | — | `[open]`, unread |
| `FUN_0046FB50` | `[open]` | — | — | `[open]`, unread |

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
| 3 | **The golden frog** — a full `0x13F4` actor of character type `0x1C`, whose skeleton slots all resolve to `frog_gold.bin`. | `SpawnGoldenFrog` (`FUN_004722A0`) |
| 2, 5–8 | A **score pickup** of that kind. | `SpawnScorePickup` (`FUN_004723F0`) → `ScorePickupUpdate` (`FUN_004724A0`) |

Set 4 has no arm and no shipped member uses it. Which sets the data actually
places: group 0 → set 6, group 5 → set 1 (the extra life), groups 6 and 7 →
set 2. Groups 6 and 7 **share** set 2, and `g_item_set_countdown` is one
global per set, so whichever is placed second overwrites the other's
countdown.

The pickup actor is `FUN_004724A0`. On being shot it plays `PlaySoundId(0x416A9)`
or `0x3B17A9`, awards `ScoreAddForPlayer(p, *(s16*)(0x0059505A + kind*0xC))` from
a per-kind score table of stride `0xC`, swaps its model to a floating score
sprite (`0x116A` / `0x119C`), fades over `0x31` frames and despawns. It draws
itself with `AssetDrawSlot(obj+0x28C)` plus a ground shadow `AssetDrawSlot(0x10D0)`.
`[proved]`

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
| 70, 71 | `OriginalItemPropUpdate` | `(0, 1.5, 0)` | 3 | y is live on the bobbing one |
| 72 | `FUN_00470750` | `(0, 1.5, 0)` | 3 | while falling only |
| 73 | `PropUpdateType73` | `(0, 8.0, 0)` | 12 | the draw adds `+0x1C8` to z; this does not |
| 74 | `FUN_00470E20` | `(0, r·0.5 − 2, 0)` | 9 | the only one that reads its own radius |
| 75 | `FUN_004710C0` | `(0, 0, 0)` | 3 | the model flies a path, **the sphere stays** |
| 76 | `PropUpdateType76` | `(−2.5, −30.0, −17.5)` | 3 | world axes; the draw applies them rotated |
| 77 | `FUN_004717A0` | `pos + RotY · path` | 6 | |

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
no distance law — but the same flipbook shape. `FUN_00465950` steps the cursor
**before** it draws, so the slot it is seeded with (`0x904`) is never seen and
the drawn run is `0x905..0x919`, the tail of the wood strip.

## Getting spawns into a renderer

`hod2lib.spawnres` resolves a spawn to its character type and asset file, and
`export_level.py` emits one glTF node per spawn under a `spawns` root, carrying
class, character type, node count and asset filename in `extras`. The browser
player consumes the same glTF, so it gets them without a bundle change.

**562 of 1225 spawns are identified**, across 52 distinct characters. Only
classes whose handler has actually been read get a rule; there is deliberately
**no** guess-from-the-descriptor fallback. Adding one looked attractive —
opcode `0x09` really does copy `desc+0x24` into `obj+0x1F4` — and it "resolved"
962 of 1225, but most of the extra hits were `char_adv02` purely because class
`0x41` uses that field as a prop lifetime and a lifetime of 0 is character type
0. Fewer, correct identifications beat more, wrong ones.

**The nodes carry no geometry, and cannot yet.** Every part model in `cat.bin`
and `hito_manbest.bin` is authored about its own origin — the per-part
centroids are all within a unit of zero — so the rest pose is not in the
models. It lives in the motion data, and `mot/` is the last undecoded format.
Until then a consumer can place and label a character but not assemble it. The
single-model prop classes are unaffected and draw exactly.

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
