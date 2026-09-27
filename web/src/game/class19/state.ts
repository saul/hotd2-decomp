/**
 * Class 0x19's state block -- the 0xA4 bytes `Boss4Init` (`FUN_004917E0`)
 * allocates and hangs off `obj+0x1310` -- and the numbers the class is built
 * from.
 *
 * Every routine in this class reaches the block through one global,
 * `0x007DD0AC`, which `Boss4Update` (`FUN_004919D0`) republishes at the top of
 * each frame beside three more -- `0x009A26A0` (the actor), `0x007DD0B0`
 * (`obj+0x40`, its transform) and `0x007DD0A8` (`obj+0x194`, its model block).
 * The port has no such globals: there is one of these actors at a time, but a
 * global that is only correct while one particular update is running is one
 * something will read at the wrong moment. The block is a field on the actor,
 * the way class 0x10's `CivilianState` is, and every routine takes it as an
 * argument.
 *
 * Offsets are the engine's, so the block can be read next to Ghidra. The
 * whole layout, with the writer of every field, is in
 * `docs/re/boss-strength.md` §2.
 *
 * ## `.rdata` and `.text`
 *
 * The seven tables the class indexes are `.rdata` and travel in the bundle's
 * `script.json` `boss4` block (`T.boss4`, see {@link Boss4Tables}); the
 * numbers compiled into the routines -- thresholds, seats, clip ids, sound
 * ids, frame cues -- are `.text` and are named constants beside their
 * routines, each with its instruction. `docs/formats/bundle.md`'s rule.
 */
import type { Boss4TablesJson } from "../../bundle/stage";
import type { Actor } from "../actor";
import { ActorSetMotionBlended } from "../class30/motion_cue";
import { G } from "../globals";
import { T } from "../tables";
import { vec3, type Vec3 } from "../vec";

/**
 * `g_class19_states` -- `0x00597298`. Twenty-four entries, dispatched by
 * `Boss4Update` (`FUN_004919D0`) on the byte at `state+0x04`:
 * `CALL dword ptr [EAX*0x4 + 0x597298]` at `0x00491A26`.
 *
 * Entries 0 and 2 are the same routine and entries 1 and 3 are another; each
 * pair tells itself apart by reading the state index back.
 */
export enum Boss4State {
  /** `Boss4StateEntranceCarried` (`FUN_004938B0`), riding the carrier. */
  EntranceCarriedWait = 0,
  /** `Boss4StateEntranceDropped` (`FUN_00493B40`), the second arena's. */
  EntranceDroppedWait = 1,
  /** `Boss4StateEntranceCarried` (`FUN_004938B0`), already on the ground. */
  EntranceCarriedPlaced = 2,
  /** `Boss4StateEntranceDropped` (`FUN_00493B40`), already on the ground. */
  EntranceDroppedPlaced = 3,
  /** `Boss4StateApproachCamera` (`FUN_00493DC0`). */
  ApproachCamera = 4,
  /** `Boss4StateChooseAction` (`FUN_00494010`). */
  ChooseAction = 5,
  /** `Boss4StateHoldThenApproach` (`FUN_004943B0`). */
  HoldThenApproach = 6,
  /**
   * `Boss4StateFaceCamera` (`FUN_004944A0`) -- the state the entrance hands
   * over to on the frame it raises `g_script_flags[31]`, and the state most
   * reactions come back to.
   */
  FaceCamera = 7,
  /** `Boss4StatePlayArrivalClip` (`FUN_004945A0`). */
  PlayArrivalClip = 8,
  /** `Boss4StateTurnToStoredPoint` (`FUN_00494610`). */
  TurnToStoredPoint = 9,
  /** `Boss4StateTurnClipThenApproach` (`FUN_00494730`). */
  TurnClipThenApproach = 0x0a,
  /** `Boss4StateWalkToPoint` (`FUN_004958F0`). */
  WalkToPoint = 0x0b,
  /** `Boss4StateWithdrawAndAdvancePhase` (`FUN_00495A20`). */
  WithdrawAndAdvancePhase = 0x0c,
  /** `Boss4StateWaitForPlayer` (`FUN_00495D30`). */
  WaitForPlayer = 0x0d,
  /** `Boss4StateHoldUntilPlayerFree` (`FUN_00495D90`). */
  HoldUntilPlayerFree = 0x0e,
  /** `Boss4StateStrikeClip65` (`FUN_00494A80`). */
  StrikeClip65 = 0x0f,
  /** `Boss4StateStrikeClip7A` (`FUN_00494B80`). */
  StrikeClip7A = 0x10,
  /**
   * `Boss4StateStrikeClip7B` (`FUN_00494C70`). Unreachable in the shipped
   * data: `g_boss4_approach_picks` holds no 2. Ported anyway, because the
   * table is data and this is the code it would reach.
   */
  StrikeClip7B = 0x11,
  /** `Boss4StateThrowHeldProp` (`FUN_00494D60`). */
  ThrowHeldProp = 0x12,
  /** `Boss4StateChargePastCamera` (`FUN_00495070`). */
  ChargePastCamera = 0x13,
  /** `Boss4StateFlinch` (`FUN_00495340`) -- a head hit with a foot down. */
  Flinch = 0x14,
  /** `Boss4StateKnockDown` (`FUN_00495570`) -- a head hit in the air. */
  KnockDown = 0x15,
  /** `Boss4StateDeath` (`FUN_00495770`), and `g_script_flags[32]`. */
  Death = 0x16,
  /** `Boss4StateDebugFreeMove` (`FUN_00495E20`). Nothing enters it. */
  DebugFreeMove = 0x17,
}

/**
 * The bits of the block's own flag word at `state+0x00` -- not `obj+0x34`,
 * which this class uses beside it for other things.
 */
export enum Boss4Flag {
  /**
   * Riding the carrier. `Boss4Init` sets it for entrances 0 and 1 and
   * latches `g_civilian_carrier` beside it; the entrance's sub 1 clears it
   * on the frame the boss drops off.
   */
  OnCarrier = 0x01,
  /**
   * Fenced: while it is up `Boss4Update` runs the four `Boss4KeepInsideEdge`
   * calls behind `0x00491A5B` and the boss cannot leave the phase's quad.
   * The entrance and `Boss4ArmPhaseWhenInsideArena` raise it; the death,
   * `Boss4StateChooseAction`'s phase-3 exit, the withdraw and every arena
   * seat drop it.
   */
  Fenced = 0x02,
  /**
   * Cycles bone 5's model `0x444..0x447` in
   * `Boss4AdvanceMotionAndDrawHeldProps`. Nothing in the image sets it (an
   * image-wide `OR ..., 0x4` sweep); kept because the read is real.
   */
  CycleBlade = 0x04,
  /**
   * An arena transition is pending: `Boss4AdvanceArenaWaypoint`'s gate
   * (`0x004928DA`), and what makes the strikes land harmlessly.
   */
  Transition = 0x08,
  /** Footfalls armed -- `Boss4FootfallShake`'s gate. */
  Footfalls = 0x10,
  /** `Boss4TrackWhenInsideArena` (`FUN_004922C0`)'s gate. */
  TrackPending = 0x20,
  /** `Boss4ArmPhaseWhenInsideArena` (`FUN_00492350`)'s gate. */
  ArmPending = 0x40,
  /** A camera cue is queued -- `Boss4QueueCameraCue` raises it. */
  CueQueued = 0x80,
  /** Bone 15's foot is raised, `Boss4FootfallShake`'s hysteresis. */
  FootARaised = 0x100,
  /** Bone 12's foot is raised. */
  FootBRaised = 0x200,
  /** The chainsaw loop is running -- `Boss4ChainsawOn`/`Off`. */
  Chainsaw = 0x400,
}

/**
 * The clips the class plays, by the exe's own ids, named for the state that
 * plays each rather than for what the model does in it.
 */
export enum Boss4Clip {
  /** `Boss4StateStrikeClip65`'s. */
  Strike65 = 0x65,
  /** The two throws, from `g_boss4_held_props[0/1].clip`. */
  Throw67 = 0x67,
  Throw68 = 0x68,
  /** `Boss4StateDeath`'s. */
  Die = 0x69,
  /** The state-7 idle: the entrance ends in it, and most returns. */
  Idle = 0x6b,
  /** `Boss4StateChooseAction`'s ordinary clip. */
  Choose = 0x6c,
  /** The approach's and the last phases' clip. */
  Walk6D = 0x6d,
  /** `Boss4StateChooseAction`'s clip in phases 8 and 17. */
  ChooseLast = 0x6e,
  /** `Boss4StateFlinch`'s when it interrupted {@link Boss4State.FaceCamera}. */
  FlinchIdle = 0x6f,
  /** `Boss4StateChargePastCamera`'s. */
  Charge = 0x70,
  /** `Boss4StateKnockDown`'s. */
  KnockDown = 0x71,
  /** `Boss4StatePlayArrivalClip`'s. */
  Arrival = 0x72,
  /** `Boss4StateFlinch`'s ordinary reaction. */
  Flinch = 0x73,
  /** The clip entrance sub 2 blends into on frame 0x5A of {@link Land}. */
  Settle = 0x74,
  /** The drop off the carrier, and what sub 2 waits on. */
  Land = 0x75,
  /** `Boss4StateTurnClipThenApproach`'s turn. */
  Turn = 0x76,
  /** The approach's walk, and the state-9 turn's. */
  Walk78 = 0x78,
  /** `Boss4StateStrikeClip7A`'s. */
  Strike7A = 0x7a,
  /** `Boss4StateStrikeClip7B`'s. */
  Strike7B = 0x7b,
  /** The clip `Boss4Init` seats, and the hold states' ordinary clip. */
  Entrance = 0x7c,
  /** `Boss4StateHoldThenApproach`'s clip in phases 8 and 17. */
  HoldLast = 0x7d,
}

/** The sounds, by `PlaySoundId` id, resolved through `g_se_name_list`. */
export enum Boss4Sound {
  /** `COMMON2\CHAIN_SAW_22.wav` -- `Boss4ChainsawOn`. */
  ChainsawOn = 0x4d17a9,
  /** `COMMON2\CHAIN_SAW_22_OFF.wav` -- `Boss4ChainsawOff`. */
  ChainsawOff = 0x4e17a9,
  /** `STAGE4_SE\BOS_WALK1_44.wav` -- `Boss4FootfallShake`. */
  Footfall = 0x151ba9,
  /** `COMMON\BLOOD02_16.WAV` -- a flesh hit. */
  Blood02 = 0x216a9,
  /** `COMMON\BLOOD03_16.WAV` -- a head hit that does damage. */
  Blood03 = 0x316a9,
  /** `STAGE4_SE\BOSS4_HASHIRI1.wav` -- the entrance drop and the holds. */
  Hashiri = 0x231ba9,
  /** `STAGE4_SE\BOSS4_YARARE3.wav` -- the last phases' hold. */
  Yarare3 = 0x271ba9,
  /** `STAGE4_SE\BOSS4_YARARE4.wav` -- the flinch and the knock-down. */
  Yarare4 = 0x281ba9,
  /** `STAGE4_SE\BOSS4_TAORE_A.wav` -- the death. */
  Taore = 0x241ba9,
  /** `COMMON\BOMB1_11.WAV` -- the body landing, frame 0x82 of the death. */
  Bomb = 0xb16a9,
  /** `STAGE4_SE\AXE_44K.wav` -- five frames before a throw leaves the hand. */
  Axe = 0x1ba9,
}

/** The 0xA4-byte block at `obj+0x1310`. Plain data: it goes through `clonePlain`. */
export interface Boss4Block {
  /** `+0x00` -- {@link Boss4Flag}. */
  flags: number;
  /** `+0x04` -- the index into {@link Boss4State}'s dispatch table. */
  state: number;
  /** `+0x05` -- the state's own sub-state. */
  sub: number;
  /** `+0x06` -- the state a reaction interrupted. */
  savedState: number;
  /** `+0x07` -- that state's sub. */
  savedSub: number;
  /** `+0x08` -- the arena phase, 0..8 and 9..17; `0xFF` until the entrance. */
  phase: number;
  /** `+0x09` -- carried props not yet thrown (2 at Init). */
  propsLeft: number;
  /** `+0x0A` -- the ones thrown, a bit per `g_boss4_held_props` record. */
  propsUsed: number;
  /** `+0x0B` -- s8, the rank 0..15, seeded from `GetDamageRank`. */
  rank: number;
  /** `+0x0C` -- head hits since the rank last moved. */
  headHits: number;
  /** `+0x0D`, `+0x0E` -- each player's lives as the rank last saw them. */
  lives: [number, number];
  /** `+0x10` -- the carrier, latched from `g_civilian_carrier`; an `at`. */
  carrierAt: number;
  /** `+0x14` -- f32, the running camera cue's frame. */
  cueFrame: number;
  /** `+0x18` -- f32, its end frame. */
  cueEnd: number;
  /** `+0x1C` -- f32, its step; **0.0 means no cue is running**. */
  cueStep: number;
  /** `+0x20` -- s16, its `cp_` path. */
  cuePath: number;
  /** `+0x22` -- s16, the cue queued to start, -1 none. */
  cueQueued: number;
  /**
   * `+0x24` -- f32, this phase's hit-point floor, stored rounded
   * (`FSTP float`) by the entrance and `Boss4ArmPhaseWhenInsideArena`.
   * `Boss4ResolveShot` compares against it; the arena and the choice state
   * form the product afresh ({@link Boss4PhaseFloor}).
   */
  phaseHpFloor: number;
  /**
   * `+0x28..+0x6F` -- P0..P5, the phase's arena, y = `pos.y` at the load.
   * P0 is a facing point, P1 the point `Boss4StateFaceCamera` tests, P2..P5
   * the fence's quad.
   */
  arena: Vec3[];
  /** `+0x70` -- f32, `ActorRegisterCameraPoint`'s rise: 6.0, -15.0 mid-charge. */
  cameraRise: number;
  /**
   * `+0x74` -- s32, one slot the states use for different things (`L3`): the
   * next state (approach, turn), the hold's countdown, the charge's start
   * frame, the held-prop index, the flinch's saved clip, the death's dwell.
   */
  w74: number;
  /** `+0x78` -- s32, the charge's tracked-again camera frame. */
  w78: number;
  /** `+0x84` -- f32, the approach range, **or** the stored turn point's x. */
  f84: number;
  /** `+0x88` -- f32, the stored turn point's z. */
  f88: number;
  /**
   * `+0x94` -- the carried prop being thrown. The engine keeps the object's
   * pointer; the port keeps its `g_carried_props` id, -1 for none.
   */
  heldProp: number;
  /**
   * `[port-only]` -- this frame's `AssetDrawSlot(0x396)` calls in
   * `Boss4AdvanceMotionAndDrawHeldProps`: the props not yet thrown, each with
   * its world matrix. Render reads it; nothing reads it back.
   */
  propDraws: { slot: number; m: number[] }[];
}

/**
 * A fresh block, as `Boss4Init` leaves it. `[port-only]` as a constructor:
 * `ActorAllocSub` zero-fills 0xA4 bytes and the Init writes its fields one at
 * a time -- the non-zero ones are listed with their addresses in `Boss4Init`.
 */
export function Boss4BlockNew(): Boss4Block {
  return {
    flags: 0, state: 0, sub: 0, savedState: 0, savedSub: 0,
    phase: 0, propsLeft: 0, propsUsed: 0, rank: 0, headHits: 0,
    lives: [0, 0], carrierAt: -1,
    cueFrame: 0, cueEnd: 0, cueStep: 0, cuePath: 0, cueQueued: 0,
    phaseHpFloor: 0,
    arena: [vec3(), vec3(), vec3(), vec3(), vec3(), vec3()],
    cameraRise: 0, w74: 0, w78: 0, f84: 0, f88: 0, heldProp: -1,
    propDraws: [],
  };
}

/**
 * The seven `.rdata` tables, from the bundle. An empty set stands in for a
 * pre-format-13 bundle, which can place the boss and cannot run his fight.
 * `[port-only]` as an accessor.
 */
export function Boss4Tables(): Boss4TablesJson {
  return T.boss4 ?? EMPTY_TABLES;
}

const EMPTY_TABLES: Boss4TablesJson = {
  phase_hp_fraction: [], head_damage: [], held_props: [], camera_cues: [],
  phase_arenas: [], head_slot_by_bar: [], approach_picks: [],
};

/**
 * `g_boss4_phase_hp_fraction[phase]` (`0x00570490`), 0 past the table.
 * `[port-only]` as an accessor.
 */
export function Boss4PhaseFraction(phase: number): number {
  return Boss4Tables().phase_hp_fraction[phase] ?? 0;
}

/**
 * `obj+0x11E * g_boss4_phase_hp_fraction[phase]` -- the product every reader
 * forms inline (`FILD obj+0x11E; FMUL [phase*4 + 0x570490]`). Kept in the
 * FPU's precision and compared unrounded, as they compare it. `[port-only]`
 * as a function.
 */
export function Boss4PhaseFloor(maxHp: number, phase: number): number {
  return maxHp * Boss4PhaseFraction(phase);
}

/** `g_boss_shot_damage_cap` -- `0x0055E1B4`, 33.0f. */
export const BOSS4_SHOT_DAMAGE_CAP = 33;

/**
 * The damage a flesh hit does -- `FLD float ptr [0x004c4380]` at
 * `0x00491E2B`, 1.0f.
 */
export const BOSS4_BODY_DAMAGE = 1;

/** The weak bone -- `CMP EBX, 0x2` at `0x00491DCE`. */
export const BOSS4_WEAK_BONE = 2;

/** The collision surface that is flesh -- `CMP EAX, 0x3D` at `0x00491D5E`. */
export const BOSS4_FLESH_SURFACE = 0x3d;

/** The surface that does nothing at all -- `CMP EAX, 0x35` at `0x00491D86`. */
export const BOSS4_SILENT_SURFACE = 0x35;

/** The two feet -- bones 15 and 12, `char+0x910` and `char+0x760`. */
export const BOSS4_FOOT_A = 15;
export const BOSS4_FOOT_B = 12;

/** The camera rise `Boss4Init` seats and every return restores -- 6.0f. */
export const BOSS4_CAMERA_RISE = 6;

/** The hands the throw swaps on bone 8, and bone 5's blade. */
export const BOSS4_HAND_BONE = 8;
export const BOSS4_BLADE_BONE = 5;

/**
 * "Unless playing `clip`, blend to it" -- `CMP dword ptr [char+0x20], clip;
 * JZ` around `ActorSetMotionBlended(char, clip, 0, fade)` (`FUN_004119A0`),
 * the guard almost every clip change in this class is written with. The
 * engine's primitive has no guard of its own, and the port's does not either,
 * so the test is here where the exe has it. `[port-only]` as a function.
 */
export function Boss4BlendUnlessPlaying(obj: Actor, clip: number,
                                        fade: number): void {
  if (obj.motion === clip) return;
  ActorSetMotionBlended(obj, clip, 0, fade);
}

/**
 * `|pos - (x, z)|` in x/z -- the distance every range test in the class forms
 * inline (`FLD pos.z; FSUB z; FLD pos.x; FSUB x; ...; FSQRT`). `[port-only]`
 * as a function.
 */
export function Boss4DistanceXZ(obj: Actor, x: number, z: number): number {
  const dz = obj.pos.z - z;
  const dx = obj.pos.x - x;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * No player can be attacked: none in play, or the only one holds a taken
 * attack permit on his last life. `Boss4StateChooseAction`'s phase-3 and
 * phase-13 arms (`0x00494173`) and `Boss4StateHoldUntilPlayerFree`'s sub 1
 * (`0x00495DA3`) test exactly this inline:
 *
 * ```
 * g_players_in_play == 0
 * || (g_players_in_play == 1 && g_attack_permits[g_active_player] != 0
 *     && g_player_lives[g_active_player] == 1)
 * ```
 *
 * The engine's free permit is 0 and the port's -1. `[port-only]` as a
 * function.
 */
export function Boss4NoPlayerFree(): boolean {
  if (G.g_players_in_play === 0) return true;
  if (G.g_players_in_play !== 1) return false;
  const p = G.g_active_player;
  return (G.g_attack_permits[p] ?? -1) !== -1
    && (G.g_player_lives[p] ?? 0) === 1;
}

/**
 * `state = n; sub = 0` -- the two byte stores every transition makes.
 * `[port-only]` as a function.
 */
export function Boss4Enter(b: Boss4Block, state: Boss4State): void {
  b.state = state;
  b.sub = 0;
}
