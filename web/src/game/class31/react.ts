/**
 * Flinching, getting up, and being knocked off a wall.
 *
 * Three states, and which one a shot produces is decided in `ThrowerOnShot`:
 * a `zslman` always tumbles, anything else standing on the ground in the hub
 * stumbles, and anything else at all falls over.
 *
 * State 17 is the odd one. It is reachable *only after a decapitation* — the
 * head-model swap in `ThrowerShotFeedback` is the only thing in the class that
 * raises the knocked-down bit — so a thrower plays its get-up exactly when you
 * have taken its head off and it has not died of it.
 */
import type { Rng } from "../../core/rng";
import { ActorFlag, ThrowerFlag, type Actor } from "../actor";
import { ThrowerReleaseSlotOnDeath } from "../combat/counts";
import { G } from "../globals";
import type { GameHost } from "../host";
import { MotionOf, T } from "../tables";
import { GAME_HZ } from "../class30/states";
import { ActorClipFrame, ActorClipLength } from "./arc";
import { ThrowerPickNextState } from "./router";
import { ThrowerState } from "./states";
import { Class31SetOf, ThrowerStanceOf } from "./tables";
import { ThrowerEnterCorpseState, FALL_GRAVITY, SURFACE_KILL } from "./death";
import { vec3, type Vec3 } from "../vec";
import { ThrowerBeginKnockbackArc } from "./death";
import { TraceActorSurfaceContactPoint } from "./surface";

/** `g_bone_reaction_group` has sixteen entries, so the bone clamps here. */
const REACT_BONE_MAX = 15;
/** Bones below this cross-fade over 0x14 frames; 9 and up hard-cut. */
const REACT_HARD_SET_BONE = 9;
const REACT_FADE = 0x14;
/** `ThrowerStateGetUp`'s clip — a `szom.bin` one, for every character type. */
const GET_UP_CLIP = 0x127;
/** The knock and get-up clips state 33 picks by stance. */
const TUMBLE_BY_STANCE = [0x215, 0x1fe, 0x1f4, 0x206];
const TUMBLE_UP_BY_STANCE = [0x216, 0x1ff, 0x1f5, 0x207];
/** The tumble settles below this speed, or after this many frames regardless. */
const SETTLE_SPEED = 0.15;
const TUMBLE_FRAME_CAP = 0x78;
/** It stands off a wall by this much, and gets up after a 20-frame cooldown. */
const TUMBLE_STANDOFF = 4.5;
const TUMBLE_COOLDOWN = 0x14;

function playOnce(obj: Actor, motion: number): void {
  if (!MotionOf(obj, motion)) return;
  obj.action = { motion, ticks: 0, loop: false };
  obj.rootActionFrame = -1;
}

/**
 * `ThrowerStateHitReaction` — `FUN_0044A360`, class 0x31 state 1.
 *
 * The stumble, and its clip is a two-level lookup the same shape as class
 * 0x30's: the bone that was hit picks a reaction *group* through
 * `g_bone_reaction_group`, and the group picks the motion out of
 * `g_class31_hit_reactions[set]`. Bones 9 and up — the pelvis and the legs —
 * **hard-cut** rather than blend, so a leg shot reads as a buckle where an arm
 * shot reads as a flinch.
 */
export function ThrowerStateHitReaction(obj: Actor, eye: Vec3, rng: Rng,
                                        host: GameHost): void {
  const bone = Math.min(REACT_BONE_MAX, Math.max(0, obj.reactBone));
  const group = T.chars?.reaction_groups?.[bone] ?? 0;
  const motion = Class31SetOf(obj)?.reactions?.[group];

  if (obj.sub === 0) {
    obj.vel.x = obj.vel.y = obj.vel.z = 0;
    obj.accY = 0;
    if (motion !== undefined && MotionOf(obj, motion)) {
      obj.react = { motion, ticks: 0, blend: bone < REACT_HARD_SET_BONE
                                          ? REACT_FADE : 0,
                    hard: bone >= REACT_HARD_SET_BONE };
      playOnce(obj, motion);
    }
    obj.sub = 1;
  }

  const len = ActorClipLength(obj, obj.action?.motion ?? 0);
  if (obj.action && ActorClipFrame(obj) < len - 1) return;

  const knocked = obj.flags2 & ThrowerFlag.KnockedDown;
  obj.flags &= ~ActorFlag.Reacting;
  obj.flags2 &= ~ThrowerFlag.ReactReentry;
  if (knocked) {
    obj.state = ThrowerState.GetUp;
    obj.sub = 0;
    return;
  }
  ThrowerPickNextState(obj, eye, rng, host);
}

/**
 * `ThrowerStateGetUp` — `FUN_0044C2E0`, class 0x31 state 17.
 *
 * Only a decapitation gets here. It raises `obj+0x34` bit 0x100 for the length
 * of the clip, which is a real invulnerability window — shots ricochet off a
 * thrower that is getting up.
 *
 * [open] Motion `0x127` is a `szom.bin` clip and the routine has no
 * character-type branch, so `zskamere` — the one type on `kame.bin`'s
 * skeleton, and one that can reach this state — asks here for a clip its own
 * rig does not have. The port's motion lookup returns nothing and the state
 * ends immediately, which is the least-wrong reading of an engine bug.
 */
export function ThrowerStateGetUp(obj: Actor, eye: Vec3, rng: Rng,
                                  host: GameHost): void {
  if (obj.sub === 0) {
    obj.flags |= ActorFlag.ShotImmune;
    playOnce(obj, GET_UP_CLIP);
    obj.sub = 1;
  }
  const len = ActorClipLength(obj, obj.action?.motion ?? 0);
  if (obj.action && ActorClipFrame(obj) < len - 1) return;
  obj.flags &= ~ActorFlag.ShotImmune;
  obj.flags2 &= ~ThrowerFlag.KnockedDown;
  ThrowerPickNextState(obj, eye, rng, host);
}

/**
 * `SelectActorGravityAxis`'s six kinds — which way gravity pulls, from the
 * surface the actor is stuck to. `ActorArcVelocity` switches on the same word.
 */
export enum ThrowerArcKind {
  Floor = 0,
  Ceiling = 1,
  WallPlusX = 2,
  WallMinusX = 3,
  WallMinusZ = 4,
  WallPlusZ = 5,
}

/**
 * `SelectActorGravityAxis` — `FUN_00450CF0`. Which axis a body falls along.
 *
 * [diverges] The engine snaps the actor's yaw to the nearest cardinal within
 * 0x2000 first and maps *that* to the axis; the port takes the same four
 * cardinals off the yaw directly, which is the same answer wherever the snap
 * would have succeeded and a floor fall where it would not.
 */
export function SelectActorGravityAxis(obj: Actor): ThrowerArcKind {
  if (obj.flags2 & ThrowerFlag.Ceiling) return ThrowerArcKind.Ceiling;
  if (!(obj.flags2 & (ThrowerFlag.WallA | ThrowerFlag.WallB))) {
    return ThrowerArcKind.Floor;
  }
  const right = (obj.flags2 & ThrowerFlag.WallA) !== 0;
  const q = Math.round(obj.yaw / 0x4000) & 3;   // 0 +Z, 1 +X, 2 -Z, 3 -X
  const side = (q + (right ? 1 : 3)) & 3;
  return [ThrowerArcKind.WallPlusZ, ThrowerArcKind.WallPlusX,
          ThrowerArcKind.WallMinusZ, ThrowerArcKind.WallMinusX][side];
}

/** Which position component and sign each arc kind bounces on. */
const AXIS_OF: Record<number, "x" | "y" | "z"> = {
  [ThrowerArcKind.Floor]: "y", [ThrowerArcKind.Ceiling]: "y",
  [ThrowerArcKind.WallPlusX]: "x", [ThrowerArcKind.WallMinusX]: "x",
  [ThrowerArcKind.WallMinusZ]: "z", [ThrowerArcKind.WallPlusZ]: "z",
};

/**
 * `ThrowerStateKnockedTumbling` — `FUN_00450E40`, class 0x31 state 33.
 *
 * `zslman`'s reaction to being shot, and the one that reads as a ragdoll: it
 * is thrown off whatever it was standing on and **bounces along the axis its
 * stance names** — off the floor, off the ceiling, off either wall — halving
 * the two tangential components and reversing the normal one each time, until
 * the speed on that axis drops below 0.15 or two seconds pass.
 *
 * The re-entry is what makes shooting it repeatedly feel different from
 * shooting anything else: a second hit while it is still tumbling hard-cuts
 * the clip and spends one of its two knockback arcs.
 *
 * The surface it bounces off comes from `TraceActorSurfaceContactPoint`, the
 * engine's own probe, against the game's own `coli/` quads — so a wall bounce
 * finds the wall rather than settling on the frame cap.
 */
export function ThrowerStateKnockedTumbling(obj: Actor, host: GameHost,
                                            dt: number, rng: Rng): void {
  const frames = dt * GAME_HZ;
  const stance = ThrowerStanceOf(obj) & 3;

  if (obj.sub === 0) {
    const reentry = (obj.flags2 & ThrowerFlag.ReactReentry) !== 0;
    obj.flags2 |= 0x180000;
    obj.flags &= ~ActorFlag.PoseFrozen;
    const clip = TUMBLE_BY_STANCE[stance] ?? TUMBLE_BY_STANCE[0];
    if (!reentry) {
      obj.vel.x = obj.vel.y = obj.vel.z = 0;
      obj.accY = 0;
      obj.knockCount = 0;
    } else {
      obj.knockCount += 1;
    }
    playOnce(obj, clip);
    if (!(obj.flags & ActorFlag.ArcSpent) && obj.knockCount < 2) {
      ThrowerBeginTumbleArc(obj, host);
    } else {
      obj.flags |= ActorFlag.ArcSpent;
    }
    obj.arcKind = SelectActorGravityAxis(obj);
    // As `ThrowerStateFallAndLand`'s own sub 0: the alive count falls when the
    // actor is knocked off its feet, not when the body settles.
    ThrowerReleaseSlotOnDeath(obj);
    obj.sinceLanding = 0;
    obj.sub = 1;
  }

  if (obj.sub === 1) {
    if (ActorClipFrame(obj) >= 0x2b) obj.flags |= ActorFlag.PoseFrozen;
    if (obj.arcFrames < obj.arcTotal) {
      obj.arcFrames += frames;
      obj.pos.x += obj.vel.x * frames;
      obj.pos.y += obj.vel.y * frames;
      obj.pos.z += obj.vel.z * frames;
      return;
    }
    obj.sinceLanding = 0;
    obj.flags &= ~ActorFlag.PoseFrozen;
    obj.sub = 2;
  }

  if (obj.sub === 2) {
    if (ActorClipFrame(obj) >= 0x2b) obj.flags |= ActorFlag.PoseFrozen;
    obj.sinceLanding += frames;
    const axis = AXIS_OF[obj.arcKind] ?? "y";
    const pull = obj.arcKind === ThrowerArcKind.Ceiling
              || obj.arcKind === ThrowerArcKind.WallPlusX
              || obj.arcKind === ThrowerArcKind.WallPlusZ
      ? -FALL_GRAVITY : FALL_GRAVITY;
    obj.vel[axis] += pull * frames;
    obj.pos.x += obj.vel.x * frames;
    obj.pos.y += obj.vel.y * frames;
    obj.pos.z += obj.vel.z * frames;

    const contact = ThrowerTumbleContact(obj, axis);
    const past = pull < 0 ? obj.pos[axis] <= contact : obj.pos[axis] >= contact;
    if (!past && obj.sinceLanding < TUMBLE_FRAME_CAP) return;

    obj.pos[axis] = contact;
    obj.landSurface = G.g_coli_hit_surface;
    for (const k of ["x", "y", "z"] as const) {
      obj.vel[k] *= k === axis ? -0.5 : 0.5;
    }
    if (Math.abs(obj.vel[axis]) > SETTLE_SPEED
        && obj.sinceLanding < TUMBLE_FRAME_CAP) {
      obj.flags &= ~ActorFlag.PoseFrozen;
      return;
    }
    obj.vel.x = obj.vel.y = obj.vel.z = 0;
    obj.accY = 0;
    obj.flags = (obj.flags & ~(ActorFlag.ArcSpent | ActorFlag.PoseFrozen))
              | ActorFlag.ShotImmune;
    // `AND CH, 0xbf` (`80e5bf`) on `obj+0x136C` at 0x004512F3, in the same
    // breath as `AND DH, 0xdf` / `OR DH, 0x1` on `obj+0x34`: the body has
    // settled, so the next landing may puff again.
    obj.flags2 &= ~ThrowerFlag.LandingDustEmitted;
    obj.slideTimer = (rng.int(10) + 1) * 3;
    obj.sub = 3;
  }

  if (obj.sub === 3) {
    if (obj.dead || obj.landSurface === SURFACE_KILL) {
      if (obj.action) return;               // wait the tumble clip out
      ThrowerEnterCorpseState(obj);
      return;
    }
    obj.slideTimer -= frames;
    if (obj.slideTimer > 0) return;
    playOnce(obj, TUMBLE_UP_BY_STANCE[stance] ?? TUMBLE_UP_BY_STANCE[0]);
    obj.flags &= ~ActorFlag.PoseFrozen;
    obj.sub = 4;
  }

  const len = ActorClipLength(obj, obj.action?.motion ?? 0);
  if (obj.action && ActorClipFrame(obj) < len - 2) return;
  obj.flags2 &= ~(ThrowerFlag.ReactReentry | ThrowerFlag.BandLatched);
  obj.flags = (obj.flags & ~(ActorFlag.Reacting | 0x200000))
            | ActorFlag.ShotImmune;
  obj.cooldown = TUMBLE_COOLDOWN;
  obj.state = ThrowerState.StandAndDecide;
  obj.sub = 0;
}

/**
 * The tumble's launch, which is the **same routine** the fall uses:
 * `ThrowerStateKnockedTumbling` and `FUN_0044A450` are the only two callers of
 * `ThrowerBeginKnockbackArc` (`FUN_0044D120`). This was a second copy of the
 * formula, so it carried the same inverted direction; now it is the one
 * function plus the velocity this state steps the arc with, which the fall
 * derives another way.
 */
function ThrowerBeginTumbleArc(obj: Actor, host: GameHost): void {
  ThrowerBeginKnockbackArc(obj, host);
  // The tumble keeps its own height and steps the arc from a velocity rather
  // than through `ActorArcVelocity`.
  obj.arcTo.y = obj.pos.y;
  obj.vel.x = (obj.arcTo.x - obj.arcFrom.x) / obj.arcTotal;
  obj.vel.z = (obj.arcTo.z - obj.arcFrom.z) / obj.arcTotal;
  obj.vel.y = 0;
}

/**
 * Where the surface the tumble bounces off is, on the axis it bounces on.
 *
 * `TraceActorSurfaceContactPoint` answers for all four attachments — the
 * floor, either wall and the ceiling — so this is the engine's own query and
 * not a floor special case any more. The `4.5` standoff is the engine's, and
 * its sign follows the axis the arc kind names.
 */
function ThrowerTumbleContact(obj: Actor, axis: "x" | "y" | "z"): number {
  if (!TraceActorSurfaceContactPoint(obj, _contact)) {
    return obj.pos[axis] + (obj.vel[axis] >= 0 ? TUMBLE_STANDOFF
                                               : -TUMBLE_STANDOFF);
  }
  if (axis === "y") return _contact.y;
  // A wall's contact point stands off by 4.5 the way the actor came at it.
  const away = obj.arcKind === ThrowerArcKind.WallPlusX
            || obj.arcKind === ThrowerArcKind.WallPlusZ;
  return _contact[axis] + (away ? -TUMBLE_STANDOFF : TUMBLE_STANDOFF);
}

const _contact = vec3();
