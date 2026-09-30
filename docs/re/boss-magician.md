# Class 0x32 — the stage-5 boss, the Magician: a transcription-grade reading

Read from `Hod2.exe` over the Ghidra MCP; the port is `web/src/game/class32/`
and its drawing `web/src/render/characters/boss5.ts` and
`web/src/render/slotmodels.ts`. Every routine in `0x0047C960..0x00480880` was
read in full, the two state tables and every jump table inside a routine
were read out of memory (L38), and the arms that fall through into the next
were checked on the listing (L53). Every routine is named in
`ghidra/annotations/functions.tsv`, every table in `globals.tsv`.

Evidence marks: `[proved]` read in the code; `[likely]` inference with the
evidence stated; `[open]` undetermined.

## 0. What this boss is, and where it appears

**Identity.** Class `0x32`, character type `0x4B`, 450 hit points `[proved]`
(the one descriptor, evt `0x3D84`). Its fifteen skeleton nodes are models of
**two** pol files -- eleven `boss5.bin`, four `boss5b.bin` -- through the slot
table, which is why the exporter resolves a node's model from its own slot
rather than from one file per type (`ExeTables.characterAssetFiles`)
`[proved]`. It carries one vertex-blended part, `boss5.bin`'s `0x4C5` over
bones 1 and 9 `[proved]` (the type's `g_pCharacterExtraParts` row).

**The name.** The banner its `Init` spawns, record `0x00596AC0`, draws the
name cards `0xBE` and `0xCC`, which read **MAGICIAN** and **Type 0** on
screen `[proved]` (the record, `game/boss_banner_records.ts`; the page,
`tools/boss5_page.mjs --shots`'s `boss5-banner.png`). The repo's other documents
already call it that.

**Where it spawns** `[proved]`: stage 5 block 7 (the route's end block) and
block 9, the Boss Mode entry, in both mode sets. Block 7:

```
step 2: spawn at op 38 (pose frozen at the origin); cam path 211 from 420
        cam frames 0x1A4..0x256 -> ride object path 0x180 down (state 0)
step 3: set_script_flag 22 -> the banner flies cam path 212 (300 frames)
        set_script_flag 23 -> state 1: glide to the mark, the health bar
step 4: finish_sequence (2,4); wait_enemies_alive 0  <- state 3
        goto_scene_state_when_alive 3; cam path 213 frames 0..170
        wait_script_flag 30  <- state 4
step 5: to the stage's end
```

In Boss Mode (`g_GameMode == 3`) `Class32Init` starts the boss at object path
`0x180`'s frame 598 in state 0 sub 3 and raises flag 22 itself `[proved]`.

## 1. Globals and tables

| address | name | what |
|---|---|---|
| `0x00596738` | `g_class32_states` | 13 dwords, dispatched at `0x0047C9E1`; `[10]` and `[11]` are both `Class32StateFinalBarrage`, `[12]` a bare `RET` |
| `0x00596770` | `g_class32_phases` | `{s32 state, f32 floor}` x 6: (6, 8.5), (8, 7.5), (6, 6.0), (8, 5.0), (10, 0.0), (-1, -1.0) |
| `0x005967A0` | `g_class32_hop_offsets` | four eye offsets state 6 hops to |
| `0x005967D0` | `g_class32_hop_frames` | 17 by rank: 25 .. 25, 20 |
| `0x00596818` | `g_class32_circle_offsets` | four offsets round the eye, state 8 |
| `0x00596848` | `g_class32_rank_rows` | `{circle_frames, circle_hold, circle_laps, lunge_frames}` x 17 |
| `0x00596958` | `g_class32_projectile_frames` | 17 by rank: 90 .. 60, 50 -- a cast projectile's flight |
| `0x005969A0` | `g_class32_barrage_rows` | `{scatter_base, scatter_spread, max_live, aimed_count}` x 17 |
| `0x00596AB0` | `g_class32_projectile_states` | the projectile's four states |

All of them travel in the bundle (`characters.class32`, `hod2lib/class32.ts`)
`[proved]`. The rank (`obj+0x131E`) starts at `g_damage_rank` when the fight
does, moves by `Class32AdjustRank` (clamped 0..15), and is forced to 16 after
18000 frames of `Class32Update`'s clock `[proved]`.

The descriptor tail, `obj+0x1390`, as the shipped spawn has it `[proved]`:
character type 75, state 0, damage 10, projectile hit points 1, trail
interval 8, projectile radius 1.7, afterimage interval 1, held trail interval
2, burst frames 60, burst brightness 70, retire speed 2.0, death frames 145,
death burst interval 8. `CharacterPlacement.class32` names the offsets.

## 2. The update and the state machine

`Class32Update` (`0x0047C960`) `[proved]`: publishes `g_boss_hp_fraction`,
steps the clock, runs `Class32OnShot`, the state, integrates velocity, turns
the boss to face **away** from `g_camera_eye` (every frame, after the state),
draws (`Class32DrawAndAdvance`) and registers its camera point. A state that
despawns the boss ends the update there.

| # | routine | what |
|---|---|---|
| 0 | `Class32StateWaitCamAndFlags` `0x00480050` | the pose frozen (`obj+0x34 \|= 0x4000`); rides `0x180` by `g_cam_path_frame` past `0x1A3`; waits for flags 22 and 23 |
| 1 | `Class32StateMoveToFixedPoint` `0x0047D120` | the health bar at (320, 35), glides to (579, -65, -8832) over `0x91` frames, takes the rank, engages the boss, and enters phase 0's state |
| 2 | `Class32StateDeathSequence` `0x00480140` | hang 60, the death clip `0x8F`, bursts every `tail+0x34` frames for `tail+0x2C` |
| 3 | `Class32StateDeathRetire` `0x00480290` | both counters back, the camera slot freed, the body to (580, -35, -8832.86) |
| 4 | `Class32StateRaiseFlagAndLeave` `0x00480470` | flag 24; ride `0x181` on the outro camera; the exit effect at its frame 0xAA; flag 30 and `ActorDespawn` 299 frames on |
| 5 | `Class32StateHitReaction` `0x0047CA50` | the reaction clip, then back to the round or on to the next phase |
| 6 | `Class32StateHopNearCamera` `0x0047D220` | hop to one of four points beside the eye, then claim a permit and cast |
| 7 | `Class32StateCastProjectiles` `0x0047D410` | two or four projectiles from the hands on the clip's cue |
| 8 | `Class32StateCircleCamera` `0x0047D5E0` | circle the eye for the rank row's laps, then claim a permit and lunge |
| 9 | `Class32StateLungeAtCamera` `0x0047D890` | fly at the eye with a projectile held in the right hand; hurts every attackable player on arrival |
| 10, 11 | `Class32StateFinalBarrage` `0x0047DD50` | rise to (580, -3, -8677), the body loop, gather and scatter projectiles |
| 12 | `0x0041EBB0` | `RET` |

Facts the port relies on, each `[proved]`:

* **The subs fall through** in states 0, 2, 4, 6, 8 and 10: an arm that
  finishes goes on into the next in the same frame. State 4's are at
  `0x0048054F` and `0x00480573`, which is why flag 30 comes 299 frames after
  the frame the camera reads 0xAA and not 300.
* The phase ladder is `hp < (maxHp / 10) * floor`, integer division first
  (`IMUL 0x66666667; SAR EDX, 2`): phase 0 reacts under 382.5.
* In the circling round (`obj+0x131A == 1`) a reaction waits for
  `obj+0x1368` hits instead of a floor.
* Every clip's end is `g_motion_play_length[clip] - 2`
  (`MOVSX EAX, word ptr [EDX*2 + 0x4E07D0]; SUB EAX, 2`), state 4's reading
  `[0x004E08EE]`, clip `0x8F`'s, directly.
* `obj+0x132C` is written only with 0, so state 7's clip-`0x82` arm is
  unreachable; `obj+0x136C` bit 4 is never set; state 3's
  sub 1 is unreachable.
* The permit (`g_attack_permits`) is claimed by `Class32TryClaimAttackPermit`
  (`0x0047FE90`) and released by `Class32ReleaseAttackPermit` (`0x0047FFE0`)
  on every way out of states 7 and 9.

## 3. Being shot

`Class32OnShot` (`0x0047CC20`), `Class32ResolvePlayerShots` (`0x0047CD40`) and
`Class32ChargeShotBone` (`0x0047CE10`) `[proved]`:

* The byte map at `0x0047D108` into the jump table at `0x0047D0FC`: bones
  **4, 6, 11, 13** charge; bone 0 does nothing; every other bone, and any
  past 13, throws sprite kind 0x35 and takes nothing.
* A charge: sprite kind 0x50, `PlaySoundId(0x1E16A9)`, ten points, and
  `tail+4` (10) of hit points -- times `0.7f` with two players in play, the
  Original Mode weapon scale on top -- truncated once off the FPU.
* The kill: `obj+0x34 |= 0x4000000`, 1500 points, `obj+0x131C` the shooter,
  `g_boss_engaged = 0`; `Class32OnShot` then lights the flash and enters
  state 2 in the same call, which is the only write of state 2 in the image.
* While `obj+0x34` bit 8 is up (reacting, dying, entering) every hit sparks.

## 4. The draw and the node hook

`Class32DrawAndAdvance` (`0x0047FE40`): `LightsUseSecondarySet`,
`DrawSkinnedModelAndShadow`, `LightsRestoreScene`, and the block's counter
stepped unless `obj+0x34 & 0x4000` `[proved]`. The boss carries the engine's
model block for the reason class 0x14 does: its routines read the pose the
draw made (the hands, the death bursts, the exit effect), and `model+0x64`
bit 3 blends an odd cursor by swing-twist.

`Class32Init` installs `Class32DrawBonePart` (`0x0047F780`) as the node hook
at `model+0x1158`; `SkeletonEmitNode` calls it **in place of** the node's own
draw. It switches on the node's slot `[proved]`:

* `0x44A 0x49B 0x4C6 0x5B8 0x636 0x65F 0x689 0x6B2`: the slot, then a cel of
  the next slot's forty-model run, `g_frame_counter % 40`;
* `0x53F`: the same, after counting `obj+0x1334` (the hit flash) down;
* `0x4EF 0x568 0x5E6 0x6DB` -- the four damaging bones: two cels, the node's
  own model replaced;
* any other slot: itself.

Each model goes through `Class32DrawNodeSlot` (`0x0047FC50`) `[proved]`: in
state 9, and in state 10 past sub 3, it aims the scene light from the node
toward bone 8's point -- `g_scene_light_pitch_bams`/`_yaw_bams` and block 1's
pair through `BuildSceneLightDirection` -- and sets the warm colour (1.0,
0.781, 0.565); while the flash is up it sets `(odd ? 1 : 0, 0, 0)`. The light
colour is global state, so a node draws under what the last node set, and
`SkeletonDrawWalk` (`0x004110D0`) draws the vertex-blended part **after**
every node, under whatever the last node left (`DrawCharacterPartSlot` sets
none for this type).

## 5. The projectiles

Actors of the same class, made by `Class32SpawnProjectile` (`0x0047EE30`),
each frame `Class32ProjectileDispatchAndDraw` (`0x0047EFA0`) `[proved]`:
bursts every projectile when its boss reacts or dies, runs
`g_class32_projectile_states`, draws `AssetDrawSlot(0xB02..0xB33)` under
`SetRenderLightColour(1, v, v)`, registers for the shot test and emits a trail
on a cadence.

| # | routine | what |
|---|---|---|
| 0 | `Class32ProjectileStateGather` `0x0047E440` | grows on its hand (bones 5 and 8 through the draw's records) |
| 1 | `Class32ProjectileStateFlyAtCamera` `0x0047E810` | `g_class32_projectile_frames[rank]` to a point in front of the eye (`Class32ProjectilePickCameraTarget`), then strikes |
| 2 | `Class32ProjectileStateScatter` `0x0047E980` | the barrage's, to `Class32ProjectilePickScatterTarget`; strikes if still on screen (`Class32ProjectileIsOnScreen`) |
| 3 | `Class32ProjectileStateBurst` `0x0047ED10` | fades from 255 to `tail+0x20` over `tail+0x1C` frames -- an eighth of that for a projectile that struck nobody or a shot barrage one |

`Class32ProjectileStrikePlayer` (`0x0047F320`) hurts the player on the
projectile's side of the screen with two attackers, both with one, through
`PlayerTakeDamage(p, 1, 7)`, and lowers the rank by 3 when a life went
`[proved]`.

## 6. The tasks

Draw-only objects `ActorAlloc` links after their maker `[proved]`:

| spawn | tick | draws |
|---|---|---|
| `Class32SpawnAfterimage` `0x0047DB50` | `Class32AfterimageTick` `0x0047DC30` | `0x5E5` (`boss5.bin` 206), fading, blue, red or white by the attack and the rank |
| `Class32SpawnBodyLoopEffect` `0x0047E0D0` | `Class32BodyLoopEffectTick` `0x0047E130` | `0xB4..0xC7` over the boss at alpha `a * 0.5`, layer 9, while `obj+0x136C` bit 5 |
| `Class32SpawnHandsEffect` `0x0047E250` | `Class32HandsEffectTick` `0x0047E2B0` | `0x127A..0x1299` between the hands, light (1.0, 9.5, 0.54) |
| `Class32EmitProjectileTrail` `0x0047F400` | `Class32ProjectileTrailTick` `0x0047F4A0` | the projectile's slot, rising and shrinking |
| `Class32SpawnDeathBurst` `0x004805C0` | `Class32DeathBurstTick` `0x00480700` | `0xC54..0xC68` on a random bone; strobes the boss's `obj+0x34` bit 3 |
| `Class32SpawnExitEffect` `0x004807B0` | `Class32ExitEffectTick` `0x00480810` | `0x7F4` shrinking for 33 frames, 15 frames' wait, then hides the boss and runs `0x7EF..0x815` one cel every three frames |

The death burst and the exit effect set no light colour of their own
`[proved]`; they draw under whatever the draw before them left, which in
the pool's order is `[likely]` the body loop's orange for the bursts.

## 7. What the port does not follow

Both are the same missing piece: the scene's two light blocks (direction,
colour, ambient) live on the script's `Walker` (`script/state/channels.ts`),
which `game/` cannot reach.

* `Class32DrawNodeSlot`'s light **direction** write is computed
  (`Boss5Tail.lightAngles`) and not made, so in states 9 and 10 the warm
  light shines from block 1's own direction.
* The light **colour register** is followed within the boss's own draw and
  per task draw, but not across routines: the two tasks with no colour of
  their own draw under the scene's colour rather than the one the previous
  draw left.
