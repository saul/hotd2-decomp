/**
 * The stage-4 boss's attacks -- states 0xF to 0x13: the three chainsaw
 * strikes, the throw of a carried prop, and the charge past the camera -- and
 * `Boss4SpawnHeldProp`, the prop the throw takes into its hand.
 *
 * Every attack costs the player one life through `PlayerTakeDamage(target, 1,
 * 8)` (`FUN_00415300`) -- the strikes on one exact clip frame unless an arena
 * transition is pending, the charge on its frame `0x47` always, and the throw
 * through the prop, whose arrival does `PlayerTakeDamage(target, 1, 1)`
 * (`CarriedPropThrowAtCamera`, `game/carried_prop.ts`). `target` is
 * `obj+0x121`, which `ActorPickTargetPlayer` wrote; the port's field for it is
 * `attackPermit`, and it is a target, not a claim.
 */
import type { Actor } from "../actor";
import { ActorFlag } from "../actor";
import { ActorPickTargetPlayer } from "../actor_target";
import { ActorTurnTowardXZ } from "../actor_turn";
import {
  CARRIED_PROP_HELD, CarriedPropAlloc, CarriedPropById, CarriedPropRoutine,
  g_carried_prop_types,
} from "../carried_prop";
import { ActorSetMotion, ActorSetMotionBlended } from "../class30/motion_cue";
import { PlayerTakeDamage } from "../combat/player";
import { G } from "../globals";
import { MatrixTransformPoint } from "../matrix";
import type { ClassFrame } from "../registry";
import { MotionPlayFrame, MotionPlayLength } from "../tables";
import { vec3 } from "../vec";
import { Boss4ResumeAfterHit } from "./death";
import {
  BOSS4_CAMERA_RISE, BOSS4_HAND_BONE, Boss4Clip, Boss4Enter, Boss4Flag,
  Boss4NoPlayerFree, Boss4Sound, Boss4State, Boss4Tables,
} from "./state";
import type { Boss4Block as Blk } from "./state";
import { BOSS4_HAND_EMPTY, BOSS4_HAND_HOLDING } from "./slots";

/** `PlayerTakeDamage(target, 1, 8)` -- the latch and the overlay every attack passes. */
const HIT_LATCH = 1;
const HIT_OVERLAY = 8;

/**
 * `obj+0x34` with `0xEFFFDFFF` -- the strike's armed bit `0x2000` and
 * `0x10000000` down together, as every attack's end writes it.
 */
const ATTACK_END_MASK = ~(ActorFlag.NoHitReaction | ActorFlag.Committed);

/** One strike's clip, turn window and frames. */
interface Strike {
  clip: Boss4Clip;
  /** The cursor window the turn runs in, inclusive. */
  turnFrom: number;
  turnTo: number;
  /** `obj+0x34 |= 0x2000` on this cursor. */
  arm: number;
  /** The hit, and `&= ~0x2000`, on this one. */
  hit: number;
}

/**
 * The strikes' own `.text` numbers: `FUN_00494A80` (`0x65`, turn `0x28..0x32`,
 * arm `0x32`, hit `0x37`), `FUN_00494B80` (`0x7A`, `0x1E..0x28`, `0x2B`,
 * `0x30`) and `FUN_00494C70` (`0x7B`, `0x14..0x1E`, `0x21`, `0x26`).
 */
const STRIKE_65: Strike = {
  clip: Boss4Clip.Strike65, turnFrom: 0x28, turnTo: 0x32, arm: 0x32, hit: 0x37,
};
const STRIKE_7A: Strike = {
  clip: Boss4Clip.Strike7A, turnFrom: 0x1e, turnTo: 0x28, arm: 0x2b, hit: 0x30,
};
const STRIKE_7B: Strike = {
  clip: Boss4Clip.Strike7B, turnFrom: 0x14, turnTo: 0x1e, arm: 0x21, hit: 0x26,
};

/** The strike turn's steps: `ADD ECX, 0x60` / `-0x60`, and state 0xF's `0xC0`. */
const STRIKE_TURN = 0x60;
const STRIKE65_TWO_PLAYER_TURN = 0xc0;

/**
 * `Boss4StateStrikeClip65` — `FUN_00494A80`. State 0xF.
 *
 * ```
 * sub 0: blend(0x65, 0, 10) -- unguarded; sub++, and on into sub 1
 * sub 1: 0x28 <= cursor <= 0x32:
 *            g_max_attackers != 2: yaw += 0x60
 *            else: obj+0x121 == 1: yaw += 0xC0
 *        then the common strike tail
 * ```
 */
export function Boss4StateStrikeClip65(obj: Actor, b: Blk,
                                       f: ClassFrame): void {
  if (!Boss4StrikeEnter(obj, b, STRIKE_65)) return;
  const c = MotionPlayFrame(obj);
  if (c >= STRIKE_65.turnFrom && c <= STRIKE_65.turnTo) {
    if (G.g_max_attackers !== 2) {
      obj.yaw = (obj.yaw + STRIKE_TURN) | 0;
    } else if (((obj.attackPermit << 24) >> 24) === 1) {
      obj.yaw = (obj.yaw + STRIKE65_TWO_PLAYER_TURN) | 0;
    }
  }
  Boss4StrikeTail(obj, b, f, STRIKE_65);
}

/**
 * `Boss4StateStrikeClip7A` — `FUN_00494B80`. State 0x10: the turn only with
 * two attackers, `-0x60` at player 0 and `+0x60` at player 1, cursor
 * `0x1E..0x28`.
 */
export function Boss4StateStrikeClip7A(obj: Actor, b: Blk,
                                       f: ClassFrame): void {
  if (!Boss4StrikeEnter(obj, b, STRIKE_7A)) return;
  Boss4StrikeTwoPlayerTurn(obj, STRIKE_7A);
  Boss4StrikeTail(obj, b, f, STRIKE_7A);
}

/**
 * `Boss4StateStrikeClip7B` — `FUN_00494C70`. State 0x11: 0x10 with clip `0x7B`
 * and its own frames. Unreachable in the shipped data (no approach pick is
 * 2); ported because the table is data.
 */
export function Boss4StateStrikeClip7B(obj: Actor, b: Blk,
                                       f: ClassFrame): void {
  if (!Boss4StrikeEnter(obj, b, STRIKE_7B)) return;
  Boss4StrikeTwoPlayerTurn(obj, STRIKE_7B);
  Boss4StrikeTail(obj, b, f, STRIKE_7B);
}

/**
 * Sub 0 and the sub test the three strike routines each open with.
 * `[port-only]` as a function: three copies in the exe, identical but for the
 * clip. False when the sub is neither 0 nor 1.
 */
function Boss4StrikeEnter(obj: Actor, b: Blk, s: Strike): boolean {
  if (b.sub === 0) {
    ActorSetMotionBlended(obj, s.clip, 0, 10);
    b.sub += 1;
    return true;
  }
  return b.sub === 1;
}

/** States 0x10 and 0x11's turn: `g_max_attackers == 2` only. `[port-only]` as a function. */
function Boss4StrikeTwoPlayerTurn(obj: Actor, s: Strike): void {
  if (G.g_max_attackers !== 2) return;
  const c = MotionPlayFrame(obj);
  if (c < s.turnFrom || c > s.turnTo) return;
  obj.yaw = (obj.yaw + (obj.attackPermit === 0 ? -STRIKE_TURN : STRIKE_TURN))
    | 0;
}

/**
 * The three strikes' common tail. `[port-only]` as a function.
 *
 * ```
 * cursor == arm:     obj+0x34 |= 0x2000; return
 * cursor == hit:     unless flag 8 { PlayerTakeDamage((s8)obj+0x121, 1, 8); obj+0x34 &= ~0x2000 }; return
 * cursor == len - 1: state 5; sub 0; obj+0x34 &= 0xEFFFDFFF
 * ```
 *
 * The `&= ~0x2000` after the hit is **inside** the flag-8 test (`JNZ` past
 * both at `0x00494B46`): a strike that lands while an arena transition is
 * pending leaves the bit up until the clip's last frame.
 */
function Boss4StrikeTail(obj: Actor, b: Blk, f: ClassFrame, s: Strike): void {
  const c = MotionPlayFrame(obj);
  if (c === s.arm) {
    obj.flags |= ActorFlag.NoHitReaction;
    return;
  }
  if (c === s.hit) {
    if (!(b.flags & Boss4Flag.Transition)) {
      PlayerTakeDamage((obj.attackPermit << 24) >> 24, HIT_LATCH, HIT_OVERLAY,
                       f.events, obj, "strike");
      obj.flags &= ~ActorFlag.NoHitReaction;
    }
    return;
  }
  if (c === MotionPlayLength(obj) - 1) {
    Boss4Enter(b, Boss4State.ChooseAction);
    obj.flags &= ATTACK_END_MASK;
  }
}

// -- the throw ------------------------------------------------------------

/** `MOV dword [EAX+0x74], 1` -- the hold the refused throw falls back to. */
const THROW_REFUSED_HOLDS = 1;
/** `LEA EBP, [EDX - 5]` -- the throw sound, five frames before the release. */
const THROW_SOUND_LEAD = 5;
/** The prop's flight mode on release -- `MOV dword [EAX+0x10], 4`. */
const THROW_MODE = CarriedPropRoutine.ThrowAtCamera;

/**
 * `Boss4StateThrowHeldProp` — `FUN_00494D60`. State 0x12, phases 3 and 13.
 *
 * ```
 * sub 0: g_players_in_play <= 0 || (== 1 && g_attack_permits[g_active_player] != 0):
 *            state 6; sub 0; state+0x74 = 1; return
 *        state+0x74 = -1; n = rand() % state+0x09 + 1
 *        do { state+0x74++; if (!(state+0x0A & 1 << state+0x74)) n-- } while (n)
 *        rec = g_boss4_held_props[state+0x74]; blend(rec.clip, 0, 10); sub++, and on
 * sub 1: c == rec.take:     Boss4SpawnHeldProp(obj); obj+0x34 |= 0x10002000
 *                           bone 8's slot = 0x442; state+0x0A |= 1 << i; state+0x09--
 *        c == rec.throw - 5: PlaySoundId(0x1BA9)
 *        c == rec.throw:    prop = state+0x94; prop mode = 4; ActorPickTargetPlayer(prop)
 *                           obj+0x34 &= 0xEFFFDFFF; bone 8's slot = 0x441
 *                           g_attack_permits[prop+0x121] = 1
 *        c == len - 1:      state 5; sub 0
 *        rec.take < c < rec.throw: turn(pos - eye, 0x200)
 * ```
 *
 * `rand() % state+0x09` divides by the props left, and the routine is only
 * reached with one to throw (state 5 sends phases 3 and 13 back to the
 * approach only while `state+0x09 != 0`).
 */
export function Boss4StateThrowHeldProp(obj: Actor, b: Blk,
                                        f: ClassFrame): void {
  const recs = Boss4Tables().held_props;
  if (b.sub === 0) {
    const players = G.g_players_in_play;
    if (players <= 0 || (players === 1
        && (G.g_attack_permits[G.g_active_player] ?? -1) !== -1)) {
      Boss4Enter(b, Boss4State.HoldThenApproach);
      b.w74 = THROW_REFUSED_HOLDS;
      return;
    }
    b.w74 = -1;
    let n = f.rng.int(b.propsLeft) + 1;
    do {
      b.w74 += 1;
      if (!(b.propsUsed & (1 << b.w74))) n -= 1;
    } while (n !== 0);
    const rec = recs[b.w74];
    if (rec) ActorSetMotionBlended(obj, rec.clip, 0, 10);
    b.sub += 1;
  } else if (b.sub !== 1) {
    return;
  }

  const rec = recs[b.w74];
  if (!rec) return;
  const c = MotionPlayFrame(obj);
  if (c === rec.take) {
    Boss4SpawnHeldProp(obj, b);
    obj.flags |= ActorFlag.Committed | ActorFlag.NoHitReaction;
    Boss4SetHandSlot(obj, f, BOSS4_HAND_HOLDING);
    b.propsUsed |= 1 << b.w74;
    b.propsLeft -= 1;
  } else if (c === rec.throw - THROW_SOUND_LEAD) {
    f.events?.emit("sound.play", { id: Boss4Sound.Axe });
  } else if (c === rec.throw) {
    const prop = CarriedPropById(b.heldProp);
    if (prop) {
      prop.mode = THROW_MODE;
      prop.player = ActorPickTargetPlayer(f.rng);
    }
    obj.flags &= ATTACK_END_MASK;
    Boss4SetHandSlot(obj, f, BOSS4_HAND_EMPTY);
    // `MOV dword ptr [EDX*4 + 0x9a2ba0], 1` -- the permit written as a
    // literal 1, not the thrower's pointer, as class 0x30's scripted throws
    // write it (`class30/scripted.ts`). The prop gives it back when it is
    // done: `CarriedPropStuckToScreen` after a hit, `CarriedPropCheckShot`'s
    // shared tail when it is shot out of the air.
    if (prop && prop.player >= 0) G.g_attack_permits[prop.player] = 1;
  } else if (c === MotionPlayLength(obj) - 1) {
    Boss4Enter(b, Boss4State.ChooseAction);
  }
  if (rec.take < c && c < rec.throw) {
    ActorTurnTowardXZ(obj, obj.pos.x - f.eye.x, obj.pos.z - f.eye.z, 0x200);
  }
}

/**
 * `char+0x4F8 = slot` -- bone 8's record `+0x00`, the hand's model. The port
 * keeps a bone's slot on the actor and tells the renderer. `[port-only]` as a
 * function.
 */
function Boss4SetHandSlot(obj: Actor, f: ClassFrame, slot: number): void {
  obj.boneSlot[String(BOSS4_HAND_BONE)] = slot;
  f.host.setBoneSlot(obj.at, BOSS4_HAND_BONE, slot);
}

/** `g_carried_prop_types[2]` -- the boss's prop. */
const HELD_PROP_TYPE = 2;
/** `MOV dword [ESI+0x48], 0x40333333` -- 2.8 out along the hand. */
const HELD_PROP_Z = Math.fround(2.8);
/** `MOV dword [ESI+0x64], 0x4000` -- the pitch it is held at. */
const HELD_PROP_PITCH = 0x4000;
/** `0x42480000` -- the flight's frame count, 50.0, in `obj+0x4C`. */
const HELD_PROP_FLIGHT_FRAMES = 50.0;
/** `0xBD6147AE` in phase 3, `0xBD23D70A` otherwise -- the flight's gravity. */
const HELD_PROP_ARC_PHASE3 = Math.fround(-0.055);
const HELD_PROP_ARC = Math.fround(-0.04);
/** `0xBCDF0123` -- the gravity it is created with. */
const HELD_PROP_GRAVITY = -0.027222221717238426;
/** `MOV dword [EDI+0x2C], 0x1C00` -- its spin about X. */
const HELD_PROP_SPIN_X = 0x1c00;

/**
 * `Boss4SpawnHeldProp` — `FUN_00494F70`. The prop the throw takes into its
 * hand, as a carried prop running behaviour 2:
 *
 * ```
 * prop = ActorAlloc(g_prop_behaviours[2], 0x19C); state+0x94 = prop
 * ActorClearGameFields(prop); sub = ActorAllocRaw(0xE0); attach; prop+0x34 |= 0x100
 * sub+0x00 = obj; +0x04 = 0; +0x08 = 2; +0x0C = type.slots[type.hp] (0x396); +0x10 = 0x0A
 * pos = (0, 0, 2.8); rx = 0x4000; ry = rz = 0
 * +0x4C = 50.0; +0x50 = phase 3 ? -0.055 : -0.04; +0x5C = -0.0272
 * spin = (0x1C00, 0, 0); radius, body radius, hp from the type; +0x121 = -1; +0x3C = -1
 * ```
 *
 * The port's pool record is built by `CarriedPropAlloc` and then written as
 * the exe writes the object; its routine is installed at allocation, as
 * `ActorAlloc` installs it, so `CarriedPropInit` never runs for it.
 */
export function Boss4SpawnHeldProp(obj: Actor, b: Blk): void {
  const id = CarriedPropAlloc(obj, {});
  const p = CarriedPropById(id);
  b.heldProp = id;
  if (!p) return;
  const type = g_carried_prop_types[HELD_PROP_TYPE];
  p.routine = CarriedPropRoutine.HeldInBone8;
  p.flags |= ActorFlag.ShotImmune;
  p.target = 0;
  p.type = HELD_PROP_TYPE;
  p.slot = type.slots[type.hp] ?? 0;
  p.mode = CARRIED_PROP_HELD;
  p.pos.x = 0; p.pos.y = 0; p.pos.z = HELD_PROP_Z;
  p.rx = HELD_PROP_PITCH; p.ry = 0; p.rz = 0;
  p.vel.x = HELD_PROP_FLIGHT_FRAMES;
  p.vel.y = b.phase === 3 ? HELD_PROP_ARC_PHASE3 : HELD_PROP_ARC;
  p.gravity = HELD_PROP_GRAVITY;
  p.spin = [HELD_PROP_SPIN_X, 0, 0];
  p.radius = type.radius;
  p.bodyRadius = type.bodyRadius;
  p.hp = type.hp;
  p.player = -1;
}

// -- the charge -----------------------------------------------------------

/** The charge's turn window -- `CMP EAX, 0x1E` / `0x46`. */
const CHARGE_TURN_FROM = 0x1e;
const CHARGE_TURN_TO = 0x46;
/** The camera rise drops to -15.0 on cursor `0x23` (`0xC1700000`)... */
const CHARGE_DIP_FRAME = 0x23;
const CHARGE_DIP_RISE = -15.0;
/** ...and comes back to 6.0 on `0x47`, with the hit. */
const CHARGE_HIT_FRAME = 0x47;
/** The view-space points the charge runs at: one attacker, player 0, player 1. */
const CHARGE_AIM_ONE = 5.0;      // 0x40A00000
const CHARGE_AIM_P0 = 2.5;       // 0x40200000
const CHARGE_AIM_P1 = 7.5;       // 0x40F00000

const _w2v = new Array<number>(16).fill(0);
const _v2w = new Array<number>(16).fill(0);

/**
 * `Boss4StateChargePastCamera` — `FUN_00495070`. State 0x13, the charge the
 * arena seats phases 5, 7, 11 and 16 into.
 *
 * ```
 * sub 0: ActorSetMotion(0x70); obj+0x34 |= 0x4000; sub++, and on into sub 1
 * sub 1: g_cam_path_frame >= state+0x74: obj+0x34 &= ~0x4000; ActorPickTargetPlayer(obj); sub++; return
 *        g_cam_path_frame == state+0x78: obj+0x34 &= ~0x10000
 * sub 2: c == len - 1: Boss4ResumeAfterHit(); return
 *        0x1E <= c <= 0x46: q = g_camera_blocks[block] * (g_max_attackers == 1 ? (5,0,0)
 *                               : obj+0x121 == 0 ? (2.5,0,0) : (7.5,0,0)); turn(pos - q, 0x200)
 *        c == 0x23: state+0x70 = -15.0
 *        c == 0x47: state+0x70 = 6.0; PlayerTakeDamage((s8)obj+0x121, 1, 8)
 * ```
 *
 * `g_camera_blocks` is the view-to-world matrix, `GameHost.cameraMatrices`'
 * second; with no camera the turn has no point to turn at and is skipped.
 */
export function Boss4StateChargePastCamera(obj: Actor, b: Blk,
                                           f: ClassFrame): void {
  if (b.sub === 0) {
    ActorSetMotion(obj, Boss4Clip.Charge);
    obj.flags |= ActorFlag.PoseFrozen;
    b.sub += 1;
  }
  if (b.sub === 1) {
    if (G.g_cam_path_frame >= b.w74) {
      obj.flags &= ~ActorFlag.PoseFrozen;
      obj.attackPermit = ActorPickTargetPlayer(f.rng);
      b.sub += 1;
      return;
    }
    if (G.g_cam_path_frame === b.w78) obj.flags &= ~ActorFlag.NoCameraTrack;
    return;
  }
  if (b.sub !== 2) return;
  const c = MotionPlayFrame(obj);
  if (c === MotionPlayLength(obj) - 1) {
    Boss4ResumeAfterHit(obj, b, f);
    return;
  }
  if (c >= CHARGE_TURN_FROM && c <= CHARGE_TURN_TO
      && f.host.cameraMatrices?.(_w2v, _v2w)) {
    const x = G.g_max_attackers === 1 ? CHARGE_AIM_ONE
      : ((obj.attackPermit << 24) >> 24) === 0 ? CHARGE_AIM_P0 : CHARGE_AIM_P1;
    const q = vec3();
    MatrixTransformPoint(_v2w, { x, y: 0, z: 0 }, q);
    ActorTurnTowardXZ(obj, obj.pos.x - q.x, obj.pos.z - q.z, 0x200);
  }
  if (c === CHARGE_DIP_FRAME) {
    b.cameraRise = CHARGE_DIP_RISE;
  } else if (c === CHARGE_HIT_FRAME) {
    b.cameraRise = BOSS4_CAMERA_RISE;
    PlayerTakeDamage((obj.attackPermit << 24) >> 24, HIT_LATCH, HIT_OVERLAY,
                     f.events, obj, "strike");
  }
}
