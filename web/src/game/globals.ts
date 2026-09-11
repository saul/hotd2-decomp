/**
 * The data segment.
 *
 * Every mutable global the port touches, named exactly as
 * `ghidra/annotations/globals.tsv` names it, with its address. `G.x = 1` where
 * the exe writes `x`; nothing is passed as an argument to be tidier and
 * nothing is hidden in a class to be idiomatic.
 *
 * One object rather than a file of `export let`, because a `let` binding
 * cannot be enumerated and a save state of one would be a hand-maintained list
 * that rots the first time somebody adds a global. `G.g_enemies_alive` still
 * reads as the exe reads and still greps as `g_enemies_alive`.
 *
 * **This object and the actors inside it are the entire game state.** If
 * something survives a frame and is not reachable from here, the snapshot is
 * wrong and so is the port.
 */
import type { BloodSpray, PointBloodSpray } from "./effects/blood";
import type { BodyCreature } from "./body_creature";
import type { SeveredHead } from "./effects/severed_head";
import type { ShotFlash, ShotTracer, ShotWeaponEffect }
  from "./effects/shot_effects";
import { makeShotFlashRing, makeShotTracerRing, makeShotWeaponRing }
  from "./effects/shot_effects";
import type { SpriteEffect } from "./effects/sprite";
import type { Actor } from "./actor";
import type { BreakableProp } from "./class41/prop_state";
import type { ShotRequest } from "./combat/shot";
import { GameMode } from "./game_mode";
import { vec3, type Vec3 } from "./vec";

/**
 * `g_app_state` (`0x009C8E98`) — the game's top-level screen, and something
 * the engine really does `switch` on: `FUN_004043C0` has arms for 3 and for
 * 5/9/0x0A/0x0B.
 *
 * Only the members the port has evidence for are here; the shell's other
 * screens stay unnamed rather than guessed. `CommitAppState` (`FUN_0040E860`)
 * is the writer a state *request* goes through, and it applies the request at
 * `g_app_state_pending` (`0x007C17A0`) at the end of the frame.
 */
export enum AppState {
  /**
   * The attract demo. `RunAttractDemo` (`FUN_00426800`) advances only while
   * this is the state, and it is `IsPlayerAttackable`'s (`FUN_00409DC0`)
   * unconditional-attack override — the demo has no real player, so its
   * `g_player_state` is never 5 and nothing would ever attack it.
   */
  Attract = 5,
  /**
   * A stage, being played. `FUN_00414FC0` requests exactly this on the start
   * press that spends a credit, and `CommitAppState` leaves `g_player_state`
   * alone only for 6 and 7 — so 6 and 7 are the only two states with live
   * players in them, and 7 is the game-over arm. `[proved]`.
   *
   * **This is where the port lives.** `ResolveHit` (`FUN_00409430`) reads
   * `g_app_state` twice and both reads ask "is it 6": at anything else it
   * suppresses gore, dismemberment and the hit result outright.
   */
  InPlay = 6,
  /**
   * Boot. Stamped once, by `FUN_0040E4A0`, whose only caller is the startup
   * routine `FUN_0049E4A0` — the one that reads `Hod2.ini` — and which resets
   * the whole data segment (`FUN_0040A920`, `g_app_state = 0`) before setting
   * it. The main loop `FUN_0049E220` draws nothing while it holds
   * (`0049E3DC`), so it is the state the game is in before the first screen.
   *
   * `[proved]`, and it is not a shutdown: `FUN_0040E4A0` has exactly one
   * xref and it is on the way in, not the way out.
   */
  Boot = 0x10,
}

/**
 * One rain drop, in the camera's own space.
 *
 * Three floats, which is exactly what the exe's array holds: 12 bytes a
 * particle over `0x007C1EB8 .. 0x007C2114`.
 */
export interface RainParticle {
  x: number;
  y: number;
  z: number;
}

/** One weapon in flight — the pool `ThrownWeaponUpdate` walks. */
export interface ThrownWeapon {
  /** Unique and stable; the renderer binds its node to this, not to an index. */
  id: number;
  /** The thrower's spawn address, so the renderer can source the model. */
  from: number;
  /** The asset slot of the projectile model. */
  slot: number;
  pos: Vec3;
  /** Units per 60 Hz frame. */
  vel: Vec3;
  /** Frames of flight left. */
  ttl: number;
  /**
   * BAMS per frame. `[diverges]` — see {@link ThrownWeapon.spinAngle}, which
   * carries the whole of why this number is the port's own.
   */
  spin: number;
  /**
   * Which axis the tumble turns about, and it is **not the same for both
   * throwing families**.
   *
   * Both draw the weapon the same way — `ThrownWeaponUpdate` (`FUN_00450780`)
   * and `ZombieThrownWeaponUpdate` (`FUN_0045A4F0`) each emit
   * `Rz(obj+0x6C) * Ry(obj+0x68) * Rx(obj+0x1364 + obj+0x64)` — but they
   * accumulate the tumble into **different terms**:
   *
   * | family | flight step | term | axis |
   * |---|---|---|---|
   * | class 0x31 | `ThrownWeaponFlyToTarget` (`FUN_0044FD40`), `0x0044FDE9` | `obj+0x68` | **Y** |
   * | class 0x30 | `ZombieThrownWeaponStateStraight` (`FUN_00459690`), `0x00459731` | `obj+0x64` | **X** |
   *
   * `[proved]`. Class 0x31 also negates the step unless the throwing hand
   * `obj+0x1358` is bone 5; class 0x30 has no such test and adds it plainly.
   * The port turned **everything** about Y, so a class-0x30 thrower's axe
   * cartwheeled while a class-0x31 thrower's looked right — which is exactly
   * how it was reported: *the spin depends on which zombie is throwing*.
   *
   * `axis` is the port's way of carrying the difference to the renderer
   * without giving the record two nearly-identical angle fields.
   */
  axis: "x" | "y";
  /**
   * The accumulated tumble — `obj+0x68` for class 0x31, `obj+0x64` for class
   * 0x30. See {@link ThrownWeapon.axis}.
   *
   * `[diverges]` **The rate is the port's invention, because the engine's is
   * uninitialised memory.** Neither launcher writes the projectile's
   * `obj+0x135C`: `SpawnThrownWeapon` (`FUN_004504E0`) writes only the model
   * and `obj+0x1364`, and `ZombieThrowHandWeapon` (`FUN_0045A240`) only the
   * model and the position. `ThrowerReleaseAttackPermit`'s sibling writes on
   * `+0x135C` are all onto the *thrower*, where the field holds the hand bone.
   * And the allocator does not clear it: `FUN_004A6FA0` zeroes exactly the
   * first 0xD dwords — the task header — and `FUN_004A7400` is a free-list
   * split that hands back the block as it stands. So every field from
   * `obj+0x34` up is whatever the previous occupant of that arena block left,
   * and the tumble rate with it. `[proved]` for the two zeroing bounds; the
   * consequence is stated as a reading, not measured against a running game.
   *
   * The port has no arena to recycle, so there is no faithful value to copy.
   * It picks a stable one instead and says so here.
   */
  spinAngle: number;
  /**
   * `obj+0x1364` — a **constant** added to the X term at draw time, per
   * character type: `0x600` for `zsass` (0x16) and 0 for 0x18, both written by
   * `SpawnThrownWeapon` (`FUN_004504E0`). Class 0x30's launcher never writes
   * it at all, so it is 0 there.
   *
   * It is a fixed tilt and **not** a rate, which is what the port had been
   * using it as: `THROWER_SLOTS[0x16].spin = 0x600` drove the Y tumble with a
   * number the engine adds once, to X.
   */
  tilt: number;
  /** Frames spent in the stick-and-blink tail once the flight is done. */
  after: number;
  hit: boolean;
  stickFrames: number;
  blinkFrames: number;
  /** The renderer hides it on alternate frames once it is blinking. */
  visible: boolean;
  /**
   * Constant acceleration, for the one throw that arcs.
   *
   * Class 0x31's weapon always flies straight, so this is zero for every one
   * of its throws. `ZombieThrownWeaponStateArc` (`FUN_004598F0`) is the other
   * family: char type 1 lobs its weapon with `±0.009` on whichever of X and Z
   * `ZombieThrownWeaponBeginArc` picks, and the axe throwers do not.
   */
  acc?: Vec3;
  /**
   * The damage kind `PlayerTakeDamage` is given on arrival — 4 for a flat
   * throw and 6 for an arced one. Absent means class 0x31's, which passes 0.
   */
  hitKind?: number;
}

export const G = {
  // -- the object pool ---------------------------------------------------
  /**
   * Every live actor. The engine keeps a linked pool reached from
   * `g_cur_actor` (0x009A26A0); a list is the same thing with an index.
   */
  g_object_list: [] as Actor[],
  /** `g_enemies_alive` — 0x009C904A. */
  g_enemies_alive: 0,
  /**
   * `g_enemies_present` — 0x009C7006. The looser of the two counts: what the
   * evt's enemy waits and class 0x10's wait bit 0 test against.
   */
  g_enemies_present: 0,
  /**
   * `g_civilians_alive` — 0x009CA0E8. Every class-0x10 civilian raises this in
   * its Init and drops it when it leaves, unless its wait word carries
   * `0x08000000` (uncounted) — and one wait bit blocks a script until the
   * count has fallen far enough, which is how a stage paces its rescues.
   */
  g_civilians_alive: 0,
  /**
   * `g_players_in_play` — 0x009C8E80. **How many players are in play**, and
   * not the two-player flag its old name claimed.
   *
   * `FUN_004147E0` does `INC word [009C8E80]` once per player as it enters —
   * beside a *separate* `INC` of `g_max_attackers` on a different slot bit —
   * and `FUN_00413F42` does the matching `DEC` when one drops out. So an
   * ordinary single-player game runs at **1**, and 0 means nobody has started
   * yet.
   *
   * That distinction is load-bearing: `ZombieStateLeapToPoint` and
   * `ZombieStateDelayedStrikeInPlace` both refuse to strike while this is 0,
   * so leaving it at the old default would have parked all nine of those
   * spawns for ever. Anything that wants "are there two players" reads
   * `g_max_attackers`, which is what the thrown weapon latches.
   */
  g_players_in_play: 1,

  // -- attack permits ----------------------------------------------------
  /**
   * `g_attack_permits` — 0x009A2BA0, one per player. `-1` is free, otherwise
   * the `at` of the actor holding it. `TryClaimAttackSlot` offers
   * `g_max_attackers` of them, so with one player exactly one enemy is
   * committed at a time — which is the game's feel.
   */
  g_attack_permits: [-1] as number[],
  /** `g_max_attackers` — 0x009C8E84. */
  g_max_attackers: 1,
  /**
   * `g_attack_committed` — 0x009A34F0. One enemy off camera may hold a
   * permit; while it does, **nobody else may claim one at all**.
   *
   * Both claim functions read it first and give up, and both set it when the
   * actor they are about to grant is off screen. It is cleared by the two
   * release functions and by `ZombieStateHoldAtRange`, each gated on the
   * actor's own bit — `obj+0x136C` bit 0x20000 for class 0x30, bit 0x8000 for
   * class 0x31.
   *
   * The port used to have neither half: it **refused** an off-screen claim
   * outright, so an enemy that ended up level with the camera could never take
   * a permit, never attack, never run the state that retreats, and stood there
   * for good.
   */
  g_attack_committed: 0,

  // -- the approach rings, copied from the defaults by the scene reset ----
  /** `g_enemy_approach_rings` — 0x009A2BE0, the inner radius per ring set. */
  g_enemy_approach_rings: [] as number[],
  /** `g_enemy_approach_ring_mid` — 0x009A2BE4. */
  g_enemy_approach_ring_mid: [] as number[],
  /** `g_enemy_approach_ring_outer` — 0x009A2BE8. */
  g_enemy_approach_ring_outer: [] as number[],
  /** `g_enemy_approach_steps` — 0x009C8E40. The queue depth allowed inside mid. */
  g_enemy_approach_steps: 0,
  /** `g_enemy_approach_steps_mid` — 0x009C8E44. */
  g_enemy_approach_steps_mid: 0,
  /** `g_enemy_approach_steps_outer` — 0x009C8E48. */
  g_enemy_approach_steps_outer: 0,

  // -- the player --------------------------------------------------------
  /** `g_player_lives` — 0x009A5C66 + player*0x98. */
  g_player_lives: [2, 2],
  /** `g_player_invuln_frames` — 0x009C8E08. */
  g_player_invuln_frames: 0,
  /** `g_player_was_hit` — 0x009A5CD0 + player*0x98. */
  g_player_was_hit: [0, 0],
  /** `g_player_hit_motion` — 0x009A5CD2 + player*0x130. */
  g_player_hit_motion: [0, 0],
  /** `g_player_hit_count` — 0x009A5C86 + player*0x98. Hits that scored. */
  g_player_hit_count: [0, 0],
  /** `g_head_combo_bonus` — 0x009A5C82 + player*0x98. */
  g_head_combo_bonus: [0, 0],
  /**
   * `g_one_hit_target_kills` — 0x009A244A. Stepped by `OneHitTargetUpdate`
   * (`FUN_00449020`) the frame a class-0x20 actor is shot.
   *
   * What reads it is `[open]`: `FUN_00497640` writes it and `FUN_004525C0`
   * reads and writes it, and neither has been read. It is kept because the
   * class writes it and a snapshot has to carry every word the port writes —
   * and it is **not** `g_enemies_alive`, which class 0x20 never touches.
   */
  g_one_hit_target_kills: 0,
  /**
   * The running score. `[open]` — it is in the same +player*0x98 block as
   * `g_player_lives` (0x009A5C66) but its offset has not been read out, so
   * this carries no address rather than a guessed one.
   */
  g_player_score: [0, 0],
  /** `g_nPlayerFired` — 0x009A5C78. Shots taken, for the accuracy grade. */
  g_nPlayerFired: [0, 0],
  /**
   * `g_nFiringGate` — `0x009C8E00`. Non-zero and the trigger works; zero and
   * it does nothing at all.
   *
   * **It is not "the shutter is open".** `HudDrawShutterState`
   * (`FUN_00413970`) is its only writer inside a stage, and it raises it in
   * states 0, 1 and 6 and drops it in state 5 and at the end of a state-3
   * close — so states 0 and 5 both draw a *closed* shutter and set it to 1 and
   * 0 respectively. A boss intro can be letterboxed and still let you shoot.
   * The state machine that drives it is `script/state/shutter.ts`, which is
   * the only writer here too.
   *
   * The rule it enforces is `PlayerFireAndReloadUpdate`'s (`FUN_00414940`),
   * where the whole fire block sits under `else if (g_nFiringGate != 0)` at
   * `0x004149BE`: with the gate down there is no ammo decrement, no shot
   * count, no `BuildShotRay`, no `PlayerShotEffectSpawn` and no gunshot — the
   * routine returns before all of it. `combat/shot.ts` is where the port does
   * the same.
   *
   * **In `G` rather than on the walker, because the exe has one word and the
   * port must have one field.** The shutter's own three fields are script
   * state and stay with the script; this one is read by the player's fire
   * routine, so it lives where the rest of the data segment does and
   * `script/state/shutter.ts` reaches it through an accessor. `Walker`'s save
   * slice still carries it under the old name, but only as a copy taken from
   * here at save time — the script slice is restored before the game slice, so
   * this is what a load ends up holding either way.
   *
   * BSS, so it starts **down**, and `ResetSceneOnEnter` puts it back down on
   * every scene: nothing raises it until the script's first `hud_shutter_state`
   * of 0, 1 or 6. All eleven shipped `evt/` tables issue those — 87 ones and
   * 104 sixes across the game — so gating on it does not lock the player out.
   */
  g_nFiringGate: 0,
  /**
   * `g_bHudShutterState` — `0x009CA0F4`. The HUD letterbox, states 0..8.
   *
   * **Here for exactly the reason `g_nFiringGate` above is here**, and it is
   * the same argument one step on: routines in `game/` now read and write it,
   * so a copy kept on the walker and mirrored across would be the second
   * owner of one byte. `BossIntroBannerUpdate` (`FUN_00437AC0`) sets it to 1
   * at `0x00437F1E` — the only instruction in the image that puts the shutter
   * into state 1 from inside a stage — and **both bosses read it to decide
   * that their fight has started**: `Boss4StateEntranceCarried`
   * (`FUN_004938B0`) at `0x004938F6`, and every one of class 0x14's
   * entrances, `Class14StateEntranceA` (`FUN_00478160`) at `0x0047834E`.
   * None of the three is script code.
   *
   * `script/state/shutter.ts` remains the machine: `evt 0x1F` and the
   * 40-frame slide are its, and it reaches this byte through an accessor. The
   * two fields that stay with it, `g_bHudShutterPrev` and the draw task's
   * counter, nothing outside the script reads.
   *
   * 2 rather than the engine's 5 at reset, which is the standing `[diverges]`
   * that file already carries and names.
   */
  g_bHudShutterState: 2,
  /**
   * The trigger pulls this frame has not resolved yet.
   *
   * `[port-only]`, and it is the one piece of *input* the data segment holds.
   * The engine has no queue — `BuildShotRay` (`FUN_00406110`) writes the
   * per-player shot record from the gun hardware and the game loop reads it on
   * the same frame — but the player's click arrives on a DOM event with no
   * game frame around it, so the intent is recorded here and
   * `ProcessShotRequests` drains it at the head of `GameUpdate`.
   *
   * Two things fall out of that, and both are the point of it. The renderer
   * stops making gameplay decisions: it hands over a segment and the port
   * decides what the segment means. And because the queue is plain data in the
   * snapshot, **it is an input log** — record it per frame and a session
   * replays into a headless run, which is the regression harness this player
   * has never had.
   *
   * Normally empty by the end of the frame that read it.
   */
  g_shot_requests: [] as ShotRequest[],
  /**
   * `[port-only]` — the heads the 1-in-4 headshot burst has thrown.
   *
   * The engine allocates each one as a task with its own per-frame routine
   * (`SpawnSeveredHead`, `FUN_0040A130`); this port has a fixed object pool and
   * a snapshot that must survive `clonePlain`, so they are plain records here
   * and `SeveredHeadsTick` steps them. Same shape and same reason as
   * `g_shot_requests` above.
   */
  g_severed_heads: [] as SeveredHead[],
  /** `[port-only]` — see {@link SeveredHead.id}. */
  g_severed_head_seq: 0,
  /**
   * `[port-only]` — the creatures `znjoe` has released.
   *
   * `SpawnBodyCreature` (`FUN_0043E720`) allocates each one as a task running
   * `BodyCreatureUpdate` (`FUN_0043E880`), with no class id at all, so the
   * same reasoning as `g_severed_heads` above applies and for the same two
   * reasons: a fixed object pool, and a snapshot that goes through
   * `clonePlain`. Unlike the heads these are **countable enemies** —
   * `BodyCreatureInit` raises both enemy counts — so an emptied list is not a
   * cosmetic difference. See `game/body_creature.ts`.
   */
  g_body_creatures: [] as BodyCreature[],
  /** `[port-only]` — see {@link BodyCreature.id}. */
  g_body_creature_seq: 0,
  /**
   * `[port-only]` — the blood `SpawnBloodSprayAtPoint` (`FUN_00430C50`) has
   * put at a point rather than on a bone. `game/effects/blood.ts`.
   */
  g_point_blood_sprays: [] as PointBloodSpray[],
  /** `[port-only]` — see {@link PointBloodSpray.id}. */
  g_point_blood_spray_seq: 0,
  /**
   * `[port-only]` — the sprite-effect objects `SpawnSpriteEffectFromParams`
   * (`FUN_004073B0`) has allocated: impacts, ricochets, splashes and the
   * boss bursts. Plain records for the same reason as `g_severed_heads`.
   */
  g_sprite_effects: [] as SpriteEffect[],
  /** `[port-only]` — see {@link SpriteEffect.id}. */
  g_sprite_effect_seq: 0,
  /**
   * `[port-only]` — the blood `SpawnBloodSpray` (`FUN_00407310`) and
   * `SpawnBoneHitSprite` (`FUN_00407200`) have allocated. Each one holds an
   * actor and a bone, not a position, because the engine re-reads the bone
   * every frame it draws.
   */
  g_blood_sprays: [] as BloodSpray[],
  /** `[port-only]` — see {@link BloodSpray.id}. */
  g_blood_spray_seq: 0,

  // -- what leaves the gun -----------------------------------------------
  /** `g_shot_flash_ring` — 0x009A2960, six records a player. */
  g_shot_flash_ring: makeShotFlashRing() as ShotFlash[],
  /** `g_shot_tracer_ring` — 0x009A2460, the round itself. */
  g_shot_tracer_ring: makeShotTracerRing() as ShotTracer[],
  /** `g_shot_weapon_ring` — 0x009A2700, Original Mode weapon kind 4 only. */
  g_shot_weapon_ring: makeShotWeaponRing() as ShotWeaponEffect[],
  /** `g_shot_effect_cursor` — 0x009CA09C, which ring slot the next shot fills. */
  g_shot_effect_cursor: [0, 0] as number[],
  /**
   * `g_shot_hit_something` — 0x009C9010. Written by `ProcessPlayerShots`
   * (`FUN_00404570`) when this frame's shot found any candidate; its one
   * reader kills the tracer on its second frame.
   */
  g_shot_hit_something: [0, 0] as number[],
  /**
   * `g_original_weapon_kind` — 0x009A2249, +0x09 of the per-player Original
   * Mode block. `ResetOriginalModeLoadout` (`FUN_0048A0D0`) seeds it with 0
   * and the port has no pickup that changes it, so every arm behind it is
   * transcribed and unreached. See {@link OriginalWeaponKind}.
   */
  g_original_weapon_kind: [0, 0] as number[],

  // -- difficulty --------------------------------------------------------
  /** `g_difficulty` — 0x009C8E94. Scales spawn HP only. */
  g_difficulty: 2,
  /** `g_damage_rank` — 0x009C8E96. The adaptive per-shot damage bonus. */
  g_damage_rank: 2,
  /** `g_hit_result` — 0x009A58F8. What the last shot did; the score reads it. */
  g_hit_result: 0,

  // -- the camera --------------------------------------------------------
  /**
   * `g_camera_is_tracking` — 0x0059C988. Zeroed by `SelectCameraLookAtTarget`
   * when no enemy is registered. It picks the *turn rate*, not whether the
   * camera turns: the ease runs either way.
   */
  g_camera_is_tracking: 0,
  /**
   * `g_camera_lookat_target` — 0x009C6FA8. The point the camera **wants** to
   * look at this frame: a single attacking enemy, the midpoint of two, or —
   * with nothing registered — the path's own target.
   *
   * This is the *desired* point, not where the camera is aimed. Where it is
   * aimed is {@link Globals.g_camera_block_target}, which eases onto this one.
   */
  g_camera_lookat_target: vec3(),
  /**
   * `g_camera_block_target` — 0x009A60D8, the camera block's `+0xD8`: where
   * the camera is actually looking, right now.
   *
   * This is the state that makes the camera smooth. `CameraTrackEnemiesTick`
   * eases it onto `g_camera_lookat_target` every frame and never assigns it —
   * so when the last enemy dies and the desired point falls back to the
   * path's own target, the aim *swings* back onto the rail over about thirty
   * frames instead of cutting to it.
   */
  g_camera_block_target: vec3(),
  /**
   * `g_cam_path_target` — 0x009C70D8. The look-at `CamEvalPath7` evaluates
   * from the active path's target channels, and the fallback
   * `SelectCameraLookAtTarget` uses when nothing is registered.
   *
   * [diverges] The engine writes this only from the deferred-rail hooks
   * (`CameraStepRailTick`, `CameraPlayStashedPath`, `CameraArmStashedPath`),
   * so after an ordinary `cam_play` action retires it can hold the target of
   * whichever shot last ran through one of those. The port keeps it current
   * with the playing path every frame. In the case that motivated this —
   * stage 2 block 17 step 5, where `finish_sequence 6` had just run the
   * 121..150 range through `CameraPlayStashedPath` — the two agree exactly.
   */
  g_cam_path_target: vec3(),
  /**
   * `g_camera_turn_rate` — 0x009C6F36, and `g_camera_turn_curve` — 0x009C6F38.
   *
   * The rate `TurnLookAtToward` divides by, refreshed at the *end* of every
   * `CameraTrackEnemiesTick` and therefore one frame old when the ease reads
   * it. That lag is the engine's, not an accident of the port.
   */
  g_camera_turn_rate: 0,
  g_camera_turn_curve: 1,
  /**
   * `g_camera_settled` — 0x009C6F2F. Raised once the eased look-at has caught
   * up with the desired one (|dot| > 0.99999). `EvtOpWaitTargetsClear47`
   * gates on it, which is why the ease has to exist for op 0x47 to mean
   * anything.
   */
  g_camera_settled: 0,
  /**
   * `g_camera_free` — 0x009C6F2D. **The gate on every room-clear wait.**
   *
   * `wait_enemies_present` (0x43), `wait_enemies_alive` (0x44) and
   * `wait_scripted_actors` (0x46) all require this on top of their counter, so
   * a room does not hand over the moment the last enemy dies — it hands over
   * once the camera has swung back onto its rail.
   *
   * The engine computes it across two per-frame camera drivers:
   * `FUN_00402E00` raises it when no `g_enemy_slots` entry is claimed, and
   * `FUN_00402650` clears it on every frame the camera mode is not
   * "return to path" — a mode it only picks when `g_enemies_alive == 0` *and*
   * no slot is claimed. Inside that mode `CameraTurnOntoPathTarget` latches it
   * when the eased look-at catches the path target.
   *
   * This port has one camera routine rather than that pair, so what it keeps
   * is the conjunction the two of them compute between them: no slot claimed,
   * no enemy alive, and the aim converged. [diverges]
   */
  g_camera_free: 0,
  /**
   * `g_evt_wait_alive_hysteresis` — 0x007DCCA8. The extra frame
   * `wait_enemies_alive` (0x44) costs, and nothing else in the program reads
   * or writes it — `0045FC42` reads, `0045FC4B` and `0045FC60` write, and
   * those three are every reference there is.
   *
   * `EvtOpWaitEnemiesAlive44` (`FUN_0045FC10`) requires `0 < this` before it
   * will pass, zeroes it when it does, and increments it on every frame it
   * does not. It is **not** reset when the count condition fails, so the
   * handler does not require the condition to hold twice running: it requires
   * that this instance of the instruction has already been evaluated once and
   * refused. On top of `g_evt_yield`'s first-visit yield, that makes 0x44 the
   * only wait in the VM that cannot pass until its third frame on the program
   * counter — and 0x43, the same handler without this term, the only other
   * one that reads a counter this port also keeps.
   */
  g_evt_wait_alive_hysteresis: 0,
  /**
   * `g_enemy_slots` — 0x009A5EC0. The actors the camera considers, nearest
   * first; slots 0 and 1 are the permit holders. Holds `at`, not pointers.
   */
  g_enemy_slots: [] as number[],

  // -- the water, class 0x16/0x17's plane and class 0x51's four slots -----
  /**
   * `g_water_level` — 0x007DCBB0. The height of the water plane.
   *
   * A data initialiser puts -24.90 there, and it is **rewritten by every
   * class-0x51 group header**: a descriptor whose `tail+0x0E` is 6 is not a
   * fish at all, it is the surface, and `FishInit` (`FUN_00438540`) copies its
   * `tail+0x00` float here before killing itself. Class 0x16 records the same
   * plane for the wave field.
   */
  g_water_level: -24.9,
  /**
   * `g_water_attack_slots` — 0x009A2C20, four dwords.
   *
   * The only thing that lets a class-0x51 fish leave the surface, and the
   * reason four of them can be in the air at once and no more.
   * `FishClaimSlotAndLunge` (`FUN_00438850`) claims one and the index is also
   * *where* the fish leaps to — the four are points in the camera's own space.
   * `SpawnFishAt` (`FUN_00438640`) refuses to place one at all while any slot
   * is taken, which is what paces the stage-2 boss's summoning rounds.
   */
  g_water_attack_slots: [0, 0, 0, 0],
  /**
   * `[port-only]` — the next spawn address to give an actor **nothing placed**.
   *
   * The port identifies an actor by the evt offset of the descriptor it came
   * from, and `SpawnFishAt` (`FUN_00438640`) has no descriptor at all: the
   * stage-2 boss calls it with three floats. Negative, and counting down, so
   * such an actor can never collide with a real descriptor offset and
   * `ActorByAt` still answers.
   */
  g_summoned_actor_at: -1,
  /**
   * `[port-only]` — the spawn addresses `SpawnSlotActors` has already built.
   *
   * There is no such list in the engine, and there cannot be: the spawn opcode
   * builds an object once, in the step that holds it, and never looks again.
   * The port materialises slot-drawn actors from the walker's live spawn list
   * every frame, so it needs to remember which of them it has made — otherwise
   * an actor that despawns under its own state machine comes straight back.
   * An entry is dropped when the script stops listing that spawn.
   */
  g_slot_actors_built: [] as number[],

  // -- the owls, class 0x43 ----------------------------------------------
  /**
   * `g_class43_attack_token` — 0x008111E0. **-1 means nobody is attacking.**
   *
   * One permit for a whole flock, and the reason owls come at you in turn
   * rather than all at once: `OwlStateWaitLaunchDelay` and
   * `OwlStateCircleHoldingPoint` refuse to begin a run-in unless they read -1,
   * the launch stamps the owl's own member index into it, and the pull-out and
   * the death give it back. It is **not** `g_attack_permits`: class 0x43 never
   * touches that array at all.
   */
  g_class43_attack_token: -1,

  // -- breakable props, class 0x41 ---------------------------------------
  /**
   * Every live breakable prop. The engine allocates each as its own 0x378
   * object in the same pool the actors live in; a separate list is the same
   * thing with the layout kept honest, since a prop shares no field offsets
   * with an `Actor`.
   */
  g_breakable_props: [] as BreakableProp[],
  /**
   * `g_breakable_members` — 0x007DCDD4. `group * 9 + member` -> the live
   * prop's `id`, or 0 once it is destroyed. Stride 9 because the largest
   * group has nine members, and `BreakablePropUpdate` reads it to find the
   * props a member supports so a stack collapses from the bottom.
   */
  g_breakable_members: [] as number[],
  /**
   * `g_item_set_countdown` — 0x009C7010. How many more props of an item set
   * must break before its item drops. `PlaceBreakableGroup` seeds it with
   * `rand() % n + 1`, so *which* break releases the item is random — it is
   * not the last one.
   */
  g_item_set_countdown: [] as number[],
  /** Hands out `BreakableProp.id`. State, so ids never collide across a load. */
  g_breakable_next_id: 1,

  // -- the camera the script is playing ----------------------------------
  /**
   * `g_active_cam_path` — 0x009A2D78, the `cp_` slot currently playing, and
   * `g_cam_path_frame` — 0x009A6110, how far into it the camera is.
   *
   * Class 0x24's set-pieces are driven entirely by these: every one of its six
   * states is removed when the camera reaches a named path at a named frame,
   * and the freeze/unfreeze cues are the same pair again. A set-piece is a
   * thing that happens *at a point in a camera move*, not at a point in time.
   */
  g_active_cam_path: -1,
  g_cam_path_frame: 0,
  /**
   * `g_scene_state_major_entered` — 0x009C6F08. The copy of the scene state's
   * major that only a full `EvtEnterSceneState` (`FUN_00403BD0`) stamps.
   *
   * **`IsPlayerAttackable` requires it to be 2** — the `cam/` path camera row
   * of `g_scene_state_table` — so no enemy commits an attack while the follow
   * camera or a scripted view-angle turn is driving. Pushed from the walker's
   * own `sceneState`, which already tracks it.
   */
  g_scene_state_major_entered: 0,
  /**
   * `g_app_state` — 0x009C8E98. Which of the game's top-level screens is
   * running. **The port sits at {@link AppState.InPlay}, 6**, because that
   * is the state the engine is in while a stage is being played, and the port
   * is never anything else.
   *
   * It used to sit at 0 with a comment calling every clause that reads it
   * inert. That was wrong in a way that only bites once something transcribes
   * the *other* read: `ResolveHit` (`FUN_00409430`) raises `obj+0x34 |= 0xE00`
   * on the actor it hits whenever this is **not** 6, and those three bits stop
   * the part swap, the dismemberment and the hit result. At 0 that fires on
   * every shot in the game.
   *
   * **Why 6 is in play**, `[proved]`, two ways:
   *
   * 1. `FUN_00414FC0` — the start-button-with-a-credit path — calls
   *    `RequestAppState(6)` (`FUN_0040E850`) and sets the player's state.
   *    Pressing Start *is* the transition into 6.
   * 2. `CommitAppState` (`FUN_0040E860`) ends with
   *    `if (pending < 6 || pending > 7) g_player_state = 9` for both players.
   *    6 and 7 are the only states it leaves a live player alone in, and 7 is
   *    the game-over arm `FUN_00460530` requests when the continue countdown
   *    expires.
   *
   * A third, independent one: `FUN_0049F380` stores **6 directly** —
   * `MOV dword ptr [0x009c8e98], 0x6` (`c705988e9c0006000000`) at
   * `0x0049F546`, beside `[0x009C7019] = 1`.
   *
   * That third one is also why `CommitAppState` is **not** the only writer,
   * which an earlier reading of this global claimed. `g_app_state` has five
   * writers across six sites — `FUN_0049F380` twice, `CommitAppState`,
   * `FUN_0040E4A0`, `FUN_0040A920` and `FUN_0041E1D0` — and at least two of
   * them store a literal straight into the word rather than going through
   * `RequestAppState`. So a state change does **not** always land on a frame
   * boundary, and code that assumes it does would be wrong.
   *
   * The other values the port has any use for: **5 is the attract demo** —
   * `RunAttractDemo` (`FUN_00426800`) only advances while it is 5, and that is
   * `IsPlayerAttackable`'s override — and **0x10 is boot**, before which
   * nothing is drawn. 3, 4, 9, 0x0A, 0x0B, 0x0C and 0x0F are the shell's other
   * screens and what each one *is* stays `[open]`.
   *
   * There is no `g_app_state_pending` (0x007C17A0) here: the port has no
   * screen to change to, so the request/commit pair has nothing to do.
   */
  g_app_state: AppState.InPlay as number,
  /**
   * `g_player_state` — 0x009A5C62 + player*0x98, s16. 5 is *in play*, and
   * `IsPlayerAttackable`'s third clause. `AdvanceToNextScene` (`FUN_0045FFF0`)
   * puts a player at 5 back to 2 for the duration of a scene load, and 8, 9
   * and 4 are the name-entry, not-participating and credit states.
   *
   * [diverges] **The port never writes 5.** Everything that does is the game's
   * shell — attract, continue, name entry, game over — reached through the
   * per-player hook the scene-state table installs at `_DAT_009A5CDC`, which
   * is an indirect call and not a routine the port has. So this stays at its
   * initial value and `IsPlayerAttackable` falls back to the stand-in below.
   */
  g_player_state: [0, 0] as number[],
  /**
   * `g_script_flags` — 0x009C7200. The byte array `set_script_flag` (evt 0x48)
   * writes and the set-pieces read for their other removal trigger.
   */
  g_script_flags: [] as number[],
  /**
   * `g_carrier_object` — 0x009A5C34, the object the player is riding.
   *
   * `ZombieStateRideCarrier` (state 29) adds this object's position to its own
   * spawn offset every frame, and leaves when the carrier raises `obj+0x34`
   * bit 0x10000000. `ZombieStateDelayedStrikeInPlace` (state 32) watches the
   * same object's bit 0x40000000 and gives up 0x14 frames after it appears.
   *
   * [diverges] **The port has no rideable object.** Every class that writes
   * this one — `St1VehicleUpdate` (`FUN_0048E600`) among them — is unported,
   * so it stays -1 and the two states above take their no-carrier arms. See
   * `class30/entrance.ts`.
   */
  g_carrier_object: -1,

  // -- the ground plane --------------------------------------------------
  /**
   * `g_camera_fixed_eye_y` — 0x009C8E58, also labelled `g_ground_plane_y`.
   *
   * **The name is wrong and is kept only because it is the one in the Ghidra
   * database.** It is a *ground plane*, not an eye height: `EvtOpSetGroundPlaneY1A`
   * (evt opcode 0x1A) writes it, `PlaceBreakableGroup` puts a group's floor at
   * `this - 0.1`, `BreakablePropGroundContact` tests against the same value,
   * `ActorDrawGroundShadow` draws on it, and `QueryGroundHeightAt` returns it
   * when the `coli/` trace misses. Its one camera use is conditional on
   * `g_camera_use_fixed_y`, which is where the name came from and which is the
   * minority of its readers. Renaming it is a fifty-site sweep across the
   * port, the docs, the tools and the database, so it is written down here
   * rather than done half-way.
   */
  g_camera_fixed_eye_y: 0,
  /**
   * `g_camera_block_eye` — 0x009A60C0: the eased eye position of the camera
   * block `g_camera_index` selects, at `g_camera_blocks + 0x80`.
   *
   * Not the same thing as `g_camera_fixed_eye_y`, which is a *ground plane*
   * the script sets. This is where the camera actually is, after
   * `FUN_00402EF0` has eased it toward the pose the path evaluated —
   * `FUN_00403B00` reads it as the eye when it measures the angle to the
   * look-at target, which is what proves the three words are a position.
   *
   * Only one camera block is ever active in this port, so the array collapses
   * to one entry.
   */
  g_camera_block_eye: vec3(),
  /**
   * `g_camera_yaw_bams` — 0x009C71F0. Which way the camera is pointing, in
   * BAMS, beside the eye at `g_camera_eye_x/y/z` (0x009C71E0).
   *
   * Class 0x31 needs the *yaw alone* rather than the whole camera matrix:
   * `ThrowerStateLeapAside` builds its landing point with a Y rotation only,
   * and `ThrowerFindWallBeside` refuses to leap unless the actor is facing
   * within 0x2000 of it. The host writes it once a frame.
   */
  g_camera_yaw_bams: 0,
  /**
   * `g_coli_hit_surface` — 0x009CAC40. The material id of whatever the last
   * collision trace hit, and a **side output**: every caller reads it straight
   * after its own trace rather than being handed it.
   *
   * Class 0x31 latches it into `obj+0x1350` where it lands, because `0x5A`
   * kills whatever touches it.
   */
  g_coli_hit_surface: 0,
  /**
   * `g_coli_hit_x/y/z` — 0x009CAC54 / 0x009CAC58 / 0x009CAC50 — and the
   * normal. Every collision query reports through these rather than returning
   * a point: the return value only says whether there *was* a hit.
   */
  g_coli_hit_x: 0,
  g_coli_hit_y: 0,
  g_coli_hit_z: 0,
  g_coli_hit_normal: [0, 1, 0] as number[],
  /** How far inside the surface a sphere test found the centre. */
  g_coli_hit_depth: 0,
  /**
   * The two script-selected collision sets, as `"<file>:<offset>"` blob keys.
   *
   * evt `0x10` fills the **full** set, which both the segment and the sphere
   * test consult; `0x11` fills the **ray-only** set, which only the segment
   * test does — `[likely]` scenery that stops a bullet but not movement. Each
   * instruction *replaces* the set it names.
   *
   * This is state, not table data: the script changes it as the stage runs, so
   * it goes in the snapshot and the blobs themselves do not.
   */
  g_coli_full_set: [] as string[],
  g_coli_ray_set: [] as string[],
  /**
   * `g_active_player` — 0x009C7000, from `FUN_00414F40`: -1 nobody, 0 or 1
   * that player alone, 2 both. `TryClaimAttackSlot` offers a permit
   * accordingly when `g_max_attackers` is 1.
   */
  g_active_player: 0,

  // -- game mode ---------------------------------------------------------
  /**
   * `g_GameMode` — 0x009CA08C. See {@link GameMode}.
   *
   * Class 0x41 branches on it both ways: Original releases the member's own
   * `storyItem` and can drop an extra life from every prop, Arcade turns
   * selected members into one-shot targets and pays no score for them.
   *
   * The bundle carries the same numbers — `script.game_mode` *is* this field,
   * and `main.ts` copies it straight across.
   */
  g_GameMode: GameMode.Arcade as GameMode,
  /**
   * `g_prop_target_set` — 0x009C9118. Which of four member sets
   * `PlaceBreakableGroup` turns into one-shot targets while `g_GameMode` is 2.
   */
  g_prop_target_set: 0,
  /**
   * `g_scene_index` — 0x009A1A08. Which scene is loaded, zero-based:
   * `ColiLoadForScene` indexes its file list with it, so scene 1 is stage 2.
   * Class 0x41's routines branch on it for the per-stage sound sets and for
   * `PropExpireByStepLifetime`'s scene-1 sweep.
   */
  g_scene_index: 0,
  /**
   * `g_evt_step_index` — 0x009A2BB0. The event VM's **step index**, and the
   * walker's cursor: `Walker.step` is an accessor over this field, because the
   * engine has one global here and both halves of the game read it.
   *
   * `EvtAdvanceStepOrRoute` increments it at the top and assigns it `1` in the
   * route branch, so it runs 1..k within a block and drops back to 1 on a
   * block change — it is **not** monotonic and **not** a block count.
   * `FUN_0045EBC0` seeds it with 0, 1 or 5 by game mode.
   *
   * A prop's lifetime is measured in changes to this, not in frames, which is
   * why a prop outlives a slow player and not a fast one. It used to be a
   * monotonic per-block counter here and props lived about four times too
   * long — blocks average 3.99 steps.
   */
  g_evt_step_index: 0,
  /**
   * `g_evt_block_index` — 0x009A2BC0, s16. Which event block is running.
   *
   * `Walker.block` is an accessor over this, the same arrangement
   * {@link g_evt_step_index} has, because **nine of the sixteen writers of
   * `g_script_branch_var` gate on it**: a shootable trigger that opens a
   * route in one block is inert in every other. `CatBranchTriggerUpdate` only
   * answers in block 8, `ChainSegmentUpdate` only in 0x16, `PropUpdateType73`
   * only in 7. Without it in `G` the port could place those triggers and
   * would have no way to say when they are live.
   */
  g_evt_block_index: 0,
  /**
   * `g_branch_prop_shot_count` — 0x007DCF18.
   *
   * How many of `PropUpdateType40`'s sub-kind-9 props have been broken.
   * The routine increments it on each break while `g_GameMode` is 1, and at
   * **2** — both of them — with `g_script_flags[0x11]` raised it writes
   * `g_script_branch_var = 2` and stores `-1` here so the route opens once.
   */
  g_branch_prop_shot_count: 0,
  /**
   * `g_original_item_slots` — 0x009A2240, stride 0x14, two slots a player.
   *
   * Original Mode's inventory. `PlayerHoldsOriginalItem` (`FUN_00461C70`)
   * reads it, and three branch triggers only open their route while the
   * player is carrying the right id.
   *
   * [diverges] **Nothing in the port ever fills it.** The pickup path is
   * `FUN_00475E40`, which is unported, so every slot stays at -1 and the
   * three key-gated routes are unreachable — as they would be for a player
   * who had not found the key. That is the honest state, not a stub: the
   * alternative is to pretend the player is carrying something.
   */
  g_original_item_slots: [[-1, -1], [-1, -1]] as number[][],
  /**
   * `g_chain_segments` — 0x007DCD18, `[group * 0x14 + segment]`.
   *
   * The twenty-segment chains `PlaceChainSegments` builds, by prop id rather
   * than by pointer. `ChainSegmentUpdate` re-registers into it every frame,
   * and segment 0 of a group carries the latch that stops the group opening
   * its route twice.
   */
  g_chain_segments: [] as number[],
  /**
   * `g_script_branch_var` — 0x009C88A4, s16. **Which route a branch takes.**
   *
   * `EvtAdvanceStepOrRoute` (`FUN_0045F000`) reads it as
   * `block = route.next[g_script_branch_var]` for a `kind == 1` record, and
   * `CameraArmStashedPath` (`FUN_00403DB0`) indexes the `store_six` preview
   * pairs with the same value — which is the check that the preview and the
   * route it previews are keyed identically.
   *
   * It is here, in `G`, and not on the walker, because **the engine keeps one
   * global and both halves of the game touch it**: the event VM reads it, and
   * every writer in the binary is gameplay code. `Walker.branchChoice` is an
   * accessor over this field, the same arrangement `g_evt_step_index` has.
   *
   * **It is reset to 0 on every *step* advance, not on every block change.**
   * The store is on `EvtAdvanceStepOrRoute`'s normal return path, after
   * `pc = EvtGetStep(...)`, so it fires whether or not the step list ran out.
   * That is a much stronger claim than the one three documents and this port
   * used to make, and it is what makes the shipped data legible: almost every
   * branch block spawns the actor that decides its branch in the block's
   * **last** step, because a write made earlier would be cleared by the next
   * step boundary.
   *
   * The port writes it from exactly one place, `CivilianOp.SetRouteBranch`,
   * which is the only writer arcade mode reaches whose class is ported. See
   * the global's row in `ghidra/annotations/globals.tsv` for the full
   * inventory of the sixteen writers and which are Original-Mode-only.
   */
  g_script_branch_var: 0,

  // -- thrown weapons ----------------------------------------------------
  g_thrown_weapons: [] as ThrownWeapon[],
  /** Hands out `ThrownWeapon.id`. Part of the state, so ids never collide. */
  g_thrown_next_id: 1,

  /**
   * `g_rain_particles` — `0x007C1EB8`. The rain, as fifty positions.
   *
   * The array runs `0x007C1EB8 .. 0x007C2114` at 12 bytes a particle, which is
   * **50** — the count is not stored anywhere, it is the extent of the array.
   * Camera-relative: `DrawRainParticles` turns each one into a world position
   * with `RotY(camera_yaw) * p + camera_eye` at draw time.
   */
  g_rain_particles: [] as RainParticle[],

  /** 60 Hz frames since the scene reset. Not an exe global; the port's clock. */
  g_frame: 0,
};

/** The shape of the whole data segment, for the snapshot's type. */
export type Globals = typeof G;

/**
 * Put every global back to what the scene reset leaves it at.
 *
 * **Call `SetGameTables` after this, never before.** This clears the approach
 * rings, which are table-derived; doing it the other way round leaves them at
 * zero, every enemy reads the outermost band for ever, and nothing reaches
 * striking range.
 */
/**
 * `ResetSceneOnEnter` — `FUN_0045EDD0`. Everything a scene starts clean.
 *
 * Called once per scene, from the scene load (`FUN_00460030`), which
 * `ResetGameOnStart` (`FUN_0045FEF0`) reaches at the start of a run. The
 * nesting matters and is kept here: the run totals are zeroed *there* and the
 * per-scene ones *here*, which is what makes `g_civilians_rescued_total` a run
 * figure and `g_civilians_rescued_by_scene` a stage one.
 *
 * **A scene is not quite a stage.** `g_scene_index` names a loadable unit:
 * scenes 0..5 are the six playable stages — `g_attract_demo_playlist`
 * (0x00589828) proves it by naming scene 0, 1 and 3 for its demos of stages 1,
 * 2 and 4 — scene 6 is the entry `ResetGameOnStart` picks for `g_GameMode` 2,
 * and scenes 10 and 11 are the two attract screens. In the port one bundle is
 * one stage is one scene, and `w.script.scene` carries the index, so a stage
 * enter *is* a scene enter for the scenes the port has.
 *
 * **Where it is called from, on both sides.** Three direct callers in the
 * engine, and every one of them is the same act:
 *
 * | engine | port |
 * |---|---|
 * | `LoadSceneAndReset` (`FUN_00460030`) | `app/stage_load.ts` →
 *   `world.attach` → `GameSystem.attach` → {@link ResetGameGlobals} → here.
 *   That is the only path into a stage. |
 * | `FUN_0041F9B0`, attract scene 10 | — the port has no attract mode |
 * | `FUN_0041FB00`, attract scene 11 | — likewise |
 *
 * `LoadSceneAndReset` is itself reached three ways, and the port has an
 * equivalent for one of them: `ResetGameOnStart` for the first scene of a run,
 * `AdvanceToNextScene` (`FUN_0045FFF0`) for each stage transition — which is
 * the port's stage load — and `RunAttractDemo` (`FUN_00426800`) for the demo
 * playlist. **The demo enters a stage scene at an arbitrary block**, which is
 * structurally what the port's seek does.
 *
 * So the port has one caller the engine does not: a **seek**, in `main.ts`. It
 * rebuilds the world from a replay and so must start from a scene as clean as
 * a fresh load. A snapshot *load* deliberately does not reset — it restores
 * the whole data segment, counters and all, which a reset would undo.
 *
 * `[open]` The port has no equivalent of `ResetGameOnStart`, because it has no
 * *run*: every stage load is a fresh start. Nothing is silently wrong — the
 * run totals that reset owns (`g_civilians_seen_total`,
 * `g_civilians_rescued_total`) are not in `G` either — but the run/scene split
 * only half exists here, and a port that grows a continue sequence will need
 * the other half.
 *
 * **The engine's body, line for line, and what the port does with each.** This
 * is a partial transcription and the list is how you can tell which part:
 *
 * | engine | port |
 * |---|---|
 * | `g_enemies_alive = 0`, `g_enemies_present = 0` | ✅ |
 * | `g_civilians_alive = 0` | ✅ |
 * | the whole 0x100-byte `g_script_flags` | ✅ |
 * | per player: `g_head_combo_bonus`, `g_player_hit_count` | ✅ |
 * | per player: `g_player_shot_count` (0x009A5C84) | ❌ not in `G` — nothing
 *   in the port counts shots, so there is no accuracy denominator to zero.
 *   `EvtOpAwardAccuracyBonus2B` (`FUN_0045FE40`) is what reads the pair. |
 * | `g_civilians_seen_by_scene`, `g_civilians_rescued_by_scene` | ❌ neither
 *   tally exists; the port raises a `civilian.rescued` event instead. |
 * | `g_hit_slots` — the 14-slot table `ActorClaimHitSlot` claims | ❌ the port
 *   has no `obj+0x3C` slot index and never claims one. |
 * | `g_bHudShutterState` back to 5 | ◑ written, as 2 -- see the field, and `Shutter.reset` |
 * | `g_bHudShutterPrev` back to 5 | ❌ the walker owns that one |
 * | `g_backdrop_mode = 0`, `g_rain_enabled = 0` | ❌ neither global exists |
 * | `g_nFiringGate = 0` | ✅ |
 * | the scene light block, via `FUN_0040E140` | ❌ |
 * | `ColiLoadForScene`, `AssetDrainAllJobs` and three loader calls | ❌ the
 *   port loads collision and assets from the bundle, not from here |
 * | five unread words: `DAT_009A2BAC`, `DAT_009C8E8C`, `DAT_009C6F1C`,
 *   `DAT_009C6F20`, `DAT_009C71C0`, `DAT_009CA098`, `DAT_009A5C30`,
 *   `DAT_009A34DC = 1` | `[open]` |
 *
 * Seven of thirteen. The name is the engine's and the omissions are itemised on
 * purpose: a partial transcription that says which part is a work list, and
 * one that does not is a lie waiting to be believed.
 */
export function ResetSceneOnEnter(): void {
  G.g_enemies_alive = 0;
  G.g_enemies_present = 0;
  G.g_civilians_alive = 0;
  // `for (i = 0x40; i--;) *p++ = 0` over `g_script_flags` — all 0x100 bytes.
  G.g_script_flags = [];
  // The per-player shot statistics, so the accuracy grade is per scene rather
  // than per run. The third of the triple, `g_player_shot_count`, has no
  // counterpart in `G`.
  G.g_head_combo_bonus = [0, 0];
  G.g_player_hit_count = [0, 0];
  // `g_nFiringGate = 0` at 0x0045EEAC, the last write but one in the engine's
  // body. A scene starts with the trigger dead and the script raises the gate;
  // it is not a value the port may default to "on" for convenience, because a
  // stage that never issues `hud_shutter_state 1` or `6` is a stage the engine
  // would not let you shoot in either.
  G.g_nFiringGate = 0;
  // `MOV [0x009ca0f4], AL` at `0x0045EE5F`, with `AL` 5 -- and `g_bHudShutterPrev`
  // beside it, which is `script/state/shutter.ts`'s and stays there.
  //
  // The port writes **2**, not 5, and that is `Shutter.reset`'s standing
  // `[diverges]` seen from the other side rather than a second one: a 5 draws
  // the closed bars and hands over to 4, and the port's shutter machine has no
  // per-frame collapse of 0, 5 and 6 into 4 and 2, so a 5 here would leave the
  // bars shut for good. It is written at all only because the byte moved into
  // `G` for class 0x19 -- until then the walker owned it and this routine
  // could not reach it.
  G.g_bHudShutterState = 2;
}

/**
 * The port's own reset: the object pools, the camera and the tables that have
 * no single owner in the engine, **plus** `ResetSceneOnEnter` for the half
 * that does.
 *
 * Not an exe function, and it should not pretend to be one. `SpawnFromDescriptor`
 * builds actors one at a time and the engine has no "empty the pool" call at
 * all, because its pool is a fixed array it walks; the port keeps a list, so
 * emptying it is a thing that has to happen somewhere.
 */
export function ResetGameGlobals(): void {
  G.g_object_list = [];
  ResetSceneOnEnter();
  G.g_attack_permits = new Array(G.g_max_attackers).fill(-1);
  G.g_attack_committed = 0;
  G.g_enemy_approach_rings = [];
  G.g_enemy_approach_ring_mid = [];
  G.g_enemy_approach_ring_outer = [];
  G.g_enemy_approach_steps = 0;
  G.g_enemy_approach_steps_mid = 0;
  G.g_enemy_approach_steps_outer = 0;
  // The scene reset re-arms the player: `ResetSceneCombatState`
  // (`FUN_0045EEC0`) calls into the player init, and without it a replay or a
  // seek starts with however many lives the last run ended on. That went
  // unnoticed until `TryClaimAttackSlot` grew its `IsPlayerAttackable` gate,
  // at which point a zero-life player made every enemy stop attacking.
  // `main.ts` overwrites this from the bundle's `start_lives` immediately
  // after, which is the engine's order too.
  G.g_player_lives = [2, 2];
  G.g_player_invuln_frames = 0;
  G.g_player_was_hit = [0, 0];
  G.g_player_hit_motion = [0, 0];
  // `g_player_hit_count` and `g_head_combo_bonus` are `ResetSceneOnEnter`'s.
  // [diverges] `g_one_hit_target_kills` is **not**: nothing read so far
  // clears it, and it is deliberately outside the `ResetSceneOnEnter`
  // transcription above so that list stays a faithful one. It is cleared here,
  // in the port's own reset, because a counter that outlives a stage reload
  // makes a snapshot the port cannot reproduce from a fresh run. If a reader
  // of `FUN_00497640` or `FUN_004525C0` turns out to want the running total,
  // this is the line that is wrong.
  G.g_one_hit_target_kills = 0;
  G.g_player_score = [0, 0];
  G.g_nPlayerFired = [0, 0];
  // Input, and a scene that is starting has none pending. A seek that left a
  // click queued would otherwise fire it into the replayed world.
  G.g_shot_requests = [];
  G.g_severed_heads = [];
  G.g_severed_head_seq = 0;
  G.g_sprite_effects = [];
  G.g_sprite_effect_seq = 0;
  G.g_blood_sprays = [];
  G.g_blood_spray_seq = 0;
  G.g_point_blood_sprays = [];
  G.g_point_blood_spray_seq = 0;
  G.g_body_creatures = [];
  G.g_body_creature_seq = 0;
  G.g_shot_flash_ring = makeShotFlashRing();
  G.g_shot_tracer_ring = makeShotTracerRing();
  G.g_shot_weapon_ring = makeShotWeaponRing();
  G.g_shot_effect_cursor = [0, 0];
  G.g_shot_hit_something = [0, 0];
  G.g_original_weapon_kind = [0, 0];
  G.g_camera_is_tracking = 0;
  G.g_camera_lookat_target = vec3();
  G.g_camera_block_target = vec3();
  G.g_cam_path_target = vec3();
  G.g_camera_turn_rate = 0;
  G.g_camera_turn_curve = 1;
  G.g_camera_settled = 0;
  G.g_camera_free = 0;
  // Not in `ResetSceneOnEnter` — the engine's copy is only ever zeroed by the
  // wait that owns it. It is here because this is the port's "nothing is
  // half-done" call, and a seek that lands mid-`wait_enemies_alive` would
  // otherwise carry the previous scene's count of refused frames into the
  // first gate of the new one.
  G.g_evt_wait_alive_hysteresis = 0;
  G.g_enemy_slots = [];
  G.g_water_level = -24.9;
  G.g_water_attack_slots = [0, 0, 0, 0];
  G.g_summoned_actor_at = -1;
  G.g_slot_actors_built = [];
  G.g_class43_attack_token = -1;
  G.g_thrown_weapons = [];
  G.g_rain_particles = [];
  G.g_thrown_next_id = 1;
  G.g_breakable_props = [];
  G.g_breakable_members = [];
  G.g_item_set_countdown = [];
  G.g_breakable_next_id = 1;
  G.g_evt_step_index = 0;
  G.g_evt_block_index = 0;
  G.g_script_branch_var = 0;
  G.g_branch_prop_shot_count = 0;
  G.g_original_item_slots = [[-1, -1], [-1, -1]];
  G.g_chain_segments = [];
  G.g_scene_index = 0;
  G.g_camera_block_eye = vec3();
  G.g_active_cam_path = -1;
  G.g_scene_state_major_entered = 0;
  G.g_app_state = AppState.InPlay;
  G.g_player_state = [0, 0];
  G.g_cam_path_frame = 0;
  G.g_coli_full_set = [];
  G.g_coli_ray_set = [];
  G.g_coli_hit_surface = 0;
  G.g_carrier_object = -1;
  G.g_frame = 0;
}

/** Write a saved data segment back over the live one, field by field. */
export function RestoreGameGlobals(saved: Globals): void {
  Object.assign(G, saved);
}

/** Find an actor by its spawn address. */
export function ActorByAt(at: number): Actor | undefined {
  return G.g_object_list.find((o) => o.at === at);
}
