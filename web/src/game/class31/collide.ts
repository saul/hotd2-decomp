/**
 * Where a thrower's body actually is, and what stops it standing in a wall.
 *
 * Class 0x31 installs `ThrowerPushOutOfWorld` at `obj+0x12F0` —
 * `EnemyThrowerInit`'s `param_1[0x4bc] = ThrowerPushOutOfWorld` — which is the
 * same hook class 0x30 fills with `ZombiePushOutOfWorldAndActors`. It runs
 * every frame for every thrower, and it does three things: push the body
 * sphere out of other actors, push it out of the world, and — in the two
 * standing states only — snap the actor back onto whatever surface it is
 * clinging to.
 *
 * **Only the third was ported.** The two push-outs were left out with a
 * `[diverges]` saying the engine's penetration depth had not been read; it
 * had, and `ColiTestSphereAgainstFullSet` in `game/coli.ts` has been writing
 * `g_coli_hit_depth` and `g_coli_hit_normal` for class 0x30 all along. So a
 * thrower was tested against the world at its **origin** and nowhere else,
 * and its body stood as far into a wall as its radius allowed.
 */
import { ThrowerFlag, type Actor } from "../actor";
import { ColiTestSphereAgainstActors, ColiTestSphereAgainstFullSet }
  from "../coli";
import { G } from "../globals";
import { ThrowerSnapToSurface } from "./surface";
import { ThrowerState } from "./states";

/**
 * How far above the actor's origin the sphere sits, in radii.
 *
 * `FUN_00449E80`'s own literal, and it is a *lift* on the ground and a *drop*
 * on the ceiling: the body hangs below the point it is attached by.
 */
const SPHERE_LIFT = 1.4;

/** Two thirds of the radius for the actor-versus-actor test. `FUN_00449D40`. */
const ACTOR_RADIUS_SCALE = 0.6666667;
/** ...and a tenth of the depth is how far that push moves. */
const ACTOR_PUSH_FRACTION = 0.1;

/**
 * `ThrowerPlaceCollisionSphere` — `FUN_00449E80`.
 *
 * Class 0x31's answer to `ActorUpdateBoundingSphere` (`FUN_00454AC0`), and it
 * is not the same answer: the lift is a multiple of the radius rather than the
 * radius plus a constant, and **which way it lifts depends on the stance.** A
 * thrower on the ceiling hangs *below* its attachment point, and one on a wall
 * has its sphere level with it.
 */
export function ThrowerPlaceCollisionSphere(obj: Actor): void {
  obj.camPoint.x = obj.pos.x;
  obj.camPoint.z = obj.pos.z;
  if (obj.flags2 & ThrowerFlag.Ceiling) {
    obj.camPoint.y = obj.pos.y - obj.bodyRadius * SPHERE_LIFT;
  } else if (!(obj.flags2 & (ThrowerFlag.WallA | ThrowerFlag.WallB))) {
    obj.camPoint.y = obj.pos.y + obj.bodyRadius * SPHERE_LIFT;
  } else {
    obj.camPoint.y = obj.pos.y;
  }
}

/**
 * `ThrowerPushOutOfWorld` — `FUN_00449D40`. The per-frame collision hook.
 *
 * The actor half moves by a **tenth** of the penetration and the world half by
 * **all** of it, which is the same asymmetry class 0x30 has: two actors ease
 * apart over several frames, a wall does not negotiate.
 *
 * [diverges] The actor half's `zslman` special case is not here. The engine
 * reads `g_coli_hit_object`'s own `obj+0x34` bit `0x200000` and, for anything
 * but character type 0x18, knocks *this* actor into state 2 rather than
 * pushing it — a thrower shouldered by a falling body falls too. The port has
 * no `g_coli_hit_object`, so it always pushes. `[open]`
 */
export function ThrowerPushOutOfWorld(obj: Actor): void {
  ThrowerPlaceCollisionSphere(obj);

  if (obj.flags2 & ThrowerFlag.CollideActors) {
    if (ColiTestSphereAgainstActors(obj, obj.camPoint.x, obj.camPoint.y,
                                    obj.camPoint.z,
                                    obj.bodyRadius * ACTOR_RADIUS_SCALE)) {
      const f = G.g_coli_hit_depth * ACTOR_PUSH_FRACTION;
      // x and z only, exactly as the engine writes it: `obj+0x40` and
      // `obj+0x48` are assigned and `obj+0x44` is not.
      obj.pos.x += (G.g_coli_hit_normal[0] ?? 0) * f;
      obj.pos.z += (G.g_coli_hit_normal[2] ?? 0) * f;
      ThrowerPlaceCollisionSphere(obj);
    }
  }

  // [diverges] The port's own, and the only thing here the exe has no line
  // for: `worldPushDepth` is what `render/stuck_debug.ts` draws. It is
  // cleared whether or not the push runs, so an actor that stops colliding
  // stops being marked -- the same reasoning as class 0x30's.
  obj.worldPushDepth = 0;
  if (obj.flags2 & ThrowerFlag.CollideWorld) {
    if (ColiTestSphereAgainstFullSet(obj.camPoint.x, obj.camPoint.y,
                                     obj.camPoint.z, obj.bodyRadius)) {
      const d = G.g_coli_hit_depth;
      obj.worldPushDepth = d;
      obj.pos.x += (G.g_coli_hit_normal[0] ?? 0) * d;
      obj.pos.y += (G.g_coli_hit_normal[1] ?? 0) * d;
      obj.pos.z += (G.g_coli_hit_normal[2] ?? 0) * d;
      ThrowerPlaceCollisionSphere(obj);
    }
  }

  // The surface snap, and only in the two standing states: it is what holds a
  // wall-crawler on its wall while it waits, and what lets go the moment the
  // wall is not there any more. The engine's test reads
  // `(s == 7 || s == 8) && s != 0xB`, whose second half can never fail.
  if (obj.state === ThrowerState.StandAndDecide
      || obj.state === ThrowerState.WaitForPermit) {
    ThrowerSnapToSurface(obj);
    ThrowerPlaceCollisionSphere(obj);
  }
}
