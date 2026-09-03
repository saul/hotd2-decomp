/**
 * The **other** death: the body is thrown before it is a corpse.
 *
 * Class 0x30 has two death states, not one. `ZombieOnShot` (`FUN_00453EB0`)
 * picks state 9 over state 6 for an actor that is in state 0x34, carries
 * {@link ZombieFlag2.Carried}, or has body condition 5 or 6 — **44 shipped
 * spawns across the six stages carry condition 5 or 6 alone.** They share a
 * terminus with state 6, `ZombieEnterCorpseState`, and they share
 * `ChooseDeathMotion` and `ZombieReleasePermitAndUntrack`; what state 9 adds
 * in front of all three is a throw.
 *
 * The throw is built in the **camera's own matrix**:
 *
 * ```
 * 004551f1  MOV  ECX, [0x009c6f00]            ; g_camera_index
 * 00455206  LEA  EAX, [EDX*0x4 + 0x9a6040]    ; g_camera_blocks + i * 0x1A4
 * 0045520e  CALL 004a9230                     ; MatrixLoad
 * 00455290  CALL 004a8a80                     ; MatrixTransformPoint
 * ```
 *
 * bracketed by `MatrixStackPush(0)` at 0x0045511B and `MatrixStackPop(1)` at
 * 0x004552FE — which is exactly the bracket `GameHost.viewPoint` is the seam
 * for. `ThrowerBeginKnockbackArc` (`FUN_0044D120`) is the same eight
 * instructions for class 0x31, down to the `ActorArcBeginToAtSpeed` it ends
 * on, so this state and that one are twins with different offsets.
 *
 * **It drives the shared arc engine.** `ActorArcBeginToAtSpeed`
 * (`FUN_0044DB50`) fills the arc record at `obj+0x13C0`/`+0x13CC`/`+0x1330`/
 * `+0x1334`, and sub 1 rides it with {@link ActorArcVelocityY}, which is
 * `ActorArcVelocity`'s (`FUN_0044DE80`) case 0 with the axis selector taken
 * out. What it does *not* use is `ActorArcStep` (`FUN_0044D860`) or the
 * three-stage motion script: `ChooseDeathMotion` picks one clip and it plays
 * through the whole flight.
 *
 * Then sub 2 lets go of the arc and integrates: gravity, a ground query with a
 * **water case** — surfaces 5 and 0x37 read their height from
 * `g_camera_fixed_eye_y` rather than from the trace — and a bounce at a
 * quarter of the impact speed until the body settles or 0x78 frames pass.
 */
import type { Rng } from "../../core/rng";
import { ActorFlag, ZombieFlag2, type Actor } from "../actor";
import { ActorArcBeginToAtSpeed, ARC_GRAVITY_HALF } from "../class31/arc";
import { QueryGroundHeightAt } from "../coli";
import { G } from "../globals";
import type { GameHost } from "../host";
import { MotionPlayFrame, MotionPlayLength } from "../tables";
import { vec3 } from "../vec";
import {
  ChooseDeathMotion, ZombieEnterCorpseState, ZombieReleasePermitAndUntrack,
} from "./death";
import { GAME_HZ } from "./states";

/** `obj+0x130C` — the body conditions the landing point branches on. */
const COND_FOUR = 4;
const COND_FIVE = 5;
const COND_SIX = 6;

/**
 * `FCOMP [0x0055d2c8]` — `0000c8c1` = -25.0f, against `obj+0x78`.
 *
 * Camera space has **−z in front** — `ThrowerPickLandingPoint`'s literal
 * `-15.5` is the precedent and `GameHost.viewSpaceOf` hands the field over in
 * the engine's own sign — so this is *further than twenty-five units away*.
 */
const FAR_DEPTH = -25.0;
/** ...a body that far off is pulled 1.5 units **back toward** the camera. */
const DEPTH_FAR = 1.5;
/** `0xc0a00000` = -5.0f: one nearer than that is pushed five units away. */
const DEPTH_NEAR = -5.0;
/** `0xc0e00000` = -7.0f — conditions 5 and 6 are thrown further, and always
 *  away, with no near/far test at all. */
const DEPTH_COND56 = -7.0;
/** `0x40e00000` = 7.0f — condition 6 alone is thrown seven units higher up
 *  the camera's own y before the divisor. */
const COND6_DROP = 7.0;
/** `0x40800000` = 4.0f — every other condition divides all three offsets by
 *  four, which is what keeps the ordinary knockback small. Conditions 4, 5
 *  and 6 leave it at `0x3f800000` = 1.0f. */
const OTHER_SCALE = 4.0;
/** `FMUL [0x004c43ac]` — `0000003f` = 0.5f, on both random offsets. */
const HALF = 0.5;
/** `FADD [0x004c49c0]` — `00004040` = 3.0f, the fixed part of the lift. */
const RISE = 3.0;
/** `rand() % 5` and `rand() % 5 + 1` — the two spreads. */
const SPREAD = 5;
/** `SHL EBX, 0x8` — condition 4 also spins `obj+0x64` by whole 0x100 BAMS. */
const PITCH_STEP = 0x100;

/**
 * `obj+0x136C` bit 0x10, which vetoes the arc-target override at 0x004552BA.
 *
 * `[open]` — **no writer was found**, over two sweeps of the whole image.
 * There is no memory-form `OR`/`AND` on that offset with an immediate carrying
 * bit 4: a byte search for `6C 13 00 00 10` returns nothing, and the seven
 * `OR`s and four `AND`s written straight to `obj+0x136C` are all other bits.
 * Nor is one built in a register: of the twelve `OR reg32, 0x10` in the image
 * (`83 C8..CF 10`), the two on an actor write `obj+0x1368` (0x0045C0ED, in
 * `ZombieStateDragTarget`) and `obj+0x1F8` (0x0044E863), and the rest are
 * globals. `OR r8, 0x10` and a computed mask are not ruled out. Written as a
 * literal rather than named, on the same terms as `class30/death.ts`'s
 * condition-4 bit: a bit the port reads and nothing in the port sets.
 */
const ARC_TARGET_VETO = 0x10;

/**
 * `obj+0x34 |= 0x80000` at 0x0045546A — the same bit both corpse states raise,
 * and `[likely]` the ground-decal suppressor. See `class30/death.ts`'s
 * `CORPSE_NO_DECAL_BIT`, which cites the one reader found.
 */
const NO_DECAL_BIT = 0x80000;

/** `g_coli_hit_surface` — the two wet materials, which have no ground height
 *  of their own and no bounce. */
const SURFACE_WATER = 5;
const SURFACE_WATER_ALT = 0x37;

/** `obj+0x5C` for conditions 4 and 5 — `0xbcdf0123` = -0.027222222f, which is
 *  the arc engine's own half-gravity, negated. */
const ARC_FALL_GRAVITY = -ARC_GRAVITY_HALF;
/** ...and `0xbd16872b` = -0.03675f for every other condition, which is the
 *  gravity `ZombieStateDeathFallAndBounce` uses. */
const KNOCK_GRAVITY = -0.03675;
/** `FMUL [0x004c4d0c]` — `000080be` = -0.25f. */
const BOUNCE_NORMAL = -0.25;
/** `FCOMP [0x004c4d08]` — `9a99193e` = 0.15f: below this it has settled. */
const SETTLE_SPEED = 0.15;
/** `CMP EAX, 0x78` on `obj+0x1334` — and after two seconds it settles anyway. */
const FALL_FRAME_CAP = 0x78;
/** `FADD [0x004c4c8c]` — `0000a041` = 20.0f, `ZombieDeathLandingEffect`'s own
 *  probe rise. */
const LANDING_PROBE_RISE = 20.0;

const _view = vec3();
const _dest = vec3();

/**
 * `ClearCurrentActorVelocityAndAccel` — `FUN_0044E120`. Acceleration first
 * (`obj+0x58/5C/60`), then velocity (`obj+0x4C/50/54`).
 *
 * Its natural home is beside the other whole-actor helpers rather than in one
 * class's folder; `class30/death.ts` and `class31/death.ts` both inline it
 * today, and collapsing all three onto this one is a tidy-up of its own.
 */
export function ClearCurrentActorVelocityAndAccel(obj: Actor): void {
  obj.accX = obj.accY = obj.accZ = 0;
  obj.vel.x = obj.vel.y = obj.vel.z = 0;
}

/**
 * `ActorArcVelocityY` — `FUN_0044DDE0`. One frame of the shared arc, as a
 * velocity, with the parabola on **y**.
 *
 * It is `ActorArcVelocity` (`FUN_0044DE80`) case 0 with the axis selector
 * removed — the same closed form, the same `obj+0x1330` advance, the same
 * `false` once `obj+0x1330` reaches `obj+0x1334`. Its only two callers are
 * `ThrowerStateFallAndLand` (0x0044A561) and this state (0x0045534C).
 *
 * The velocity is computed for the frame *after* the advance — `iVar1 = t + 1`
 * at 0x0044DDF6 — while the test that ends the arc uses the frame before it.
 * Nothing integrates here: `EnemyZombieUpdate` adds `vel` to `pos` after the
 * state runs, which is where the flight actually happens.
 */
export function ActorArcVelocityY(obj: Actor, step: number): boolean {
  const t = obj.arcFrames;
  obj.arcFrames = t + step;
  const total = obj.arcTotal;
  if (t >= total) return false;
  const n = t + step;
  const dy = obj.arcTo.y - obj.arcFrom.y;
  obj.vel.x = (obj.arcTo.x - obj.arcFrom.x) / total;
  obj.vel.y = n * -ARC_GRAVITY_HALF
            + (total * total * ARC_GRAVITY_HALF + dy + dy) / (total * 2);
  obj.vel.z = (obj.arcTo.z - obj.arcFrom.z) / total;
  return true;
}

/**
 * `ZombieStateDeathKnockbackArc` — `FUN_004550E0`, class 0x30 state 9.
 *
 * Three subs, and the first two **fall through** the way `ZombieStateDeath6`'s
 * do: `INC word [ESI+0x1312]` at 0x0045531D runs straight on into sub 1's body
 * at 0x0045532A, and sub 1's `INC` at 0x0045537A into sub 2's at 0x0045538B.
 * So the throw is armed, ridden for one frame, and — if the arc were empty —
 * fallen from, all on the frame the shot lands.
 *
 * The landing point, read from the disassembly because the decompiler shows
 * the divisor as the routine's own `float param_1` (it reuses its argument
 * slot for the scale) and drops both `FMUL`s:
 *
 * ```
 * in.x = view.x + (±0.5)                  / scale
 * in.y = view.y - ((r % 5 + 1) * 0.5 + drop + 3.0) / scale
 * in.z = view.z + depth                   / scale
 * ```
 *
 * with `drop`, `depth` and `scale` from the body condition. `MatrixTransform`
 * takes that back to world space, and unless the actor was shot next to an arc
 * target it was already flying at, that is where the body goes.
 *
 * [diverges] The sub-2 landing hook `PTR_FUN_00592BC8` —
 * `ZombieDeathLandingEffect` (`FUN_00456B70`), which is `g_class30_states[0x38]`
 * — spawns a splash on the wet surfaces and a dust puff otherwise, and the
 * port draws neither. Its two effects on *state* are ported here rather than
 * skipped: the once-only latch {@link ZombieFlag2.OneShotFired}, and the
 * ground query twenty units above the body whose `g_coli_hit_surface` the
 * bounce test below then reads — the hook runs between the two reads of that
 * global at 0x004553D4 and 0x00455411, so dropping it would silently change
 * which surface the bounce is decided on.
 */
export function ZombieStateDeathKnockbackArc(obj: Actor, dt: number, rng: Rng,
                                             host: GameHost): void {
  const frames = dt * GAME_HZ;

  if (obj.sub === 0) {
    // `OR EDX, 0x20000` at 0x0045510B — off the floor, so the ground snap in
    // `ZombiePushOutOfWorldAndActors` does not put the body back every frame.
    obj.flags |= ActorFlag.Airborne;
    // The alive count falls here, exactly as it does in state 6 — one death,
    // one teardown, whichever of the two states runs it.
    ZombieReleasePermitAndUntrack(obj);

    // [diverges] The engine always has a camera; a headless host has none.
    // With no view-space point there is no landing point to build, so the
    // throw collapses to the actor's own position and the state runs the rest
    // of its course — the fall, the bounce and the corpse — from where it
    // stood. The random draws are made either way, so a host that answers and
    // one that does not consume the same stream.
    const hasView = host.viewSpaceOf(obj.at, _view);
    if (!hasView) { _view.x = 0; _view.y = 0; _view.z = 0; }

    let drop = 0;              // `[ESP+0x4]`
    let scale = 1.0;           // `[ESP+0x34]`, the argument slot it reuses
    let depth: number;         // `[ESP+0x14]`
    if (obj.condition === COND_FOUR) {
      // `rand() & 0x80000001` normalised, `1 - 2n`, times `rand() % 5`, times
      // 0x100, onto `obj+0x64` — the pitch of the rotation triple whose y is
      // {@link Actor.yaw}. The two draws are in this order, with the depth
      // compare between them; the compare consumes nothing.
      const spin = 1 - 2 * rng.int(2);
      obj.pitch += spin * rng.int(SPREAD) * PITCH_STEP;
      depth = _view.z <= FAR_DEPTH ? DEPTH_FAR : DEPTH_NEAR;
    } else if (obj.condition === COND_FIVE) {
      depth = DEPTH_COND56;
    } else if (obj.condition === COND_SIX) {
      drop = COND6_DROP;
      // `AND EAX, 0xdfffffff` at 0x0045517B — condition 6 stops being pushed
      // out of the world for the whole flight.
      obj.flags2 &= ~ZombieFlag2.CollideWorld;
      depth = DEPTH_COND56;
    } else {
      scale = OTHER_SCALE;
      depth = _view.z <= FAR_DEPTH ? DEPTH_FAR : DEPTH_NEAR;
    }

    const sway = 1 - 2 * rng.int(2);
    const px = _view.x + (sway * HALF) / scale;
    const py = _view.y - ((rng.int(SPREAD) + 1) * HALF + drop + RISE) / scale;
    const pz = _view.z + depth / scale;
    if (hasView) host.viewPoint(px, py, pz, _dest);
    else { _dest.x = obj.pos.x; _dest.y = obj.pos.y; _dest.z = obj.pos.z; }

    // `TEST AL, 0x8` then `TEST AL, 0x10` at 0x004552AE — an actor shot
    // within eighteen units of the arc target it was already flying at keeps
    // that target instead. `ZombieOnShot` is what raises the bit, and the
    // point it reads back is the arc record's own `obj+0x13CC`.
    if ((obj.flags2 & ZombieFlag2.ShotNearArcTarget)
        && !(obj.flags2 & ARC_TARGET_VETO)) {
      _dest.x = obj.arcTo.x;
      _dest.y = obj.arcTo.y;
      _dest.z = obj.arcTo.z;
    }
    // `FUN_0044DB50`'s own `minFrames` test is `obj+0x136C & 0x2000000` and
    // **not** `obj+0x34 & 0x44000000`; every path into state 9 runs through
    // `ZombieOnShot`'s dead arm, so `ActorFlag.Dead` is always up here and the
    // fifteen-frame branch is the only reachable one. `[proved]`
    ActorArcBeginToAtSpeed(obj, _dest);
    ChooseDeathMotion(obj, rng);
    ClearCurrentActorVelocityAndAccel(obj);
    obj.sub += 1;
    // `AND ECX, 0xfffeffff` at 0x00455317 — this death's own landing may puff
    // even if an earlier one already did.
    obj.flags2 &= ~ZombieFlag2.OneShotFired;
  }

  if (obj.sub === 1) {
    if (MotionPlayFrame(obj) >= MotionPlayLength(obj) - 1) {
      obj.flags |= ActorFlag.PoseFrozen;
    }
    if (ActorArcVelocityY(obj, frames)) return;
    // `CMP EAX, 0x4 / JL` then `CMP EAX, 0x5 / JG` at 0x00455360 — conditions
    // 4 and 5 fall at the arc's own rate, everything else at state 12's.
    obj.accY = obj.condition >= COND_FOUR && obj.condition <= COND_FIVE
      ? ARC_FALL_GRAVITY : KNOCK_GRAVITY;
    obj.sub += 1;
    // **`obj+0x1334` is one word.** The arc engine's duration slot becomes the
    // fall's frame counter the moment the arc is spent; the port's
    // `backoffFrames` is the same address under class 0x30's other name for
    // it, and `arcTotal` is the name the arc gave it.
    obj.arcTotal = 0;
  }
  if (obj.sub !== 2) return;

  if (MotionPlayFrame(obj) >= MotionPlayLength(obj) - 1) {
    obj.flags |= ActorFlag.PoseFrozen;
  }
  obj.arcTotal += frames;
  obj.vel.y += obj.accY * frames;

  let ground = QueryGroundHeightAt(obj.pos.x, obj.pos.y, obj.pos.z);
  if (G.g_coli_hit_surface === SURFACE_WATER
      || G.g_coli_hit_surface === SURFACE_WATER_ALT) {
    // `g_camera_fixed_eye_y` — 0x009C8E58. Water has no traced height of its
    // own; the script's ground plane is the surface the body lands on.
    ground = G.g_camera_fixed_eye_y;
  }
  if (obj.pos.y + obj.vel.y > ground) return;

  obj.pos.y = ground;
  // The landing hook, and the probe it makes — see the `[diverges]` above.
  if (!(obj.flags2 & ZombieFlag2.OneShotFired)) {
    QueryGroundHeightAt(obj.pos.x, obj.pos.y + LANDING_PROBE_RISE, obj.pos.z);
    obj.flags2 |= ZombieFlag2.OneShotFired;
  }
  const water = G.g_coli_hit_surface === SURFACE_WATER
             || G.g_coli_hit_surface === SURFACE_WATER_ALT;
  if (obj.arcTotal < FALL_FRAME_CAP && !water
      && Math.abs(obj.vel.y) > SETTLE_SPEED) {
    obj.vel.y *= BOUNCE_NORMAL;
    return;
  }
  if (water) obj.flags |= NO_DECAL_BIT;
  ClearCurrentActorVelocityAndAccel(obj);
  ZombieEnterCorpseState(obj);
}
