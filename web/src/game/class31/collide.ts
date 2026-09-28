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
 * **Only the third was ported.** The two push-outs were left out, declared a
 * divergence on the grounds that the engine's penetration depth had not been
 * read; it had, and `ColiTestSphereAgainstFullSet` in `game/coli.ts` has been
 * writing `g_coli_hit_depth` and `g_coli_hit_normal` for class 0x30 all along.
 * So a thrower was tested against the world at its **origin** and nowhere else,
 * and its body stood as far into a wall as its radius allowed.
 */
import { ThrowerFlag, type Actor } from "../actor";
import { ColiTestSphereAgainstActors, ColiTestSphereAgainstFullSet }
  from "../coli";
import { ActorByAt, G } from "../globals";
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
/** `CMP word ptr [ESI + 0x1f4], 0x18` at `0x00449D7F`: `zslman` is always pushed. */
const CHAR_ZSLMAN = 0x18;
/**
 * `TEST dword ptr [ECX + 0x34], 0x200000` at `0x00449D8F`, on the object the
 * crowd test found -- {@link ActorFlag.FireLoop} on the one class known to
 * raise it. See {@link ThrowerPushOutOfWorld}. A literal because a top-level
 * read of `actor.ts`'s enum from inside its import cycle is a page that does
 * not start (L56).
 */
const HIT_OBJECT_KNOCKS_OFF = 0x200000;

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
  obj.sphereCentre.x = obj.pos.x;
  obj.sphereCentre.z = obj.pos.z;
  if (obj.flags2 & ThrowerFlag.Ceiling) {
    obj.sphereCentre.y = obj.pos.y - obj.bodyRadius * SPHERE_LIFT;
  } else if (!(obj.flags2 & (ThrowerFlag.WallA | ThrowerFlag.WallB))) {
    obj.sphereCentre.y = obj.pos.y + obj.bodyRadius * SPHERE_LIFT;
  } else {
    obj.sphereCentre.y = obj.pos.y;
  }
}

/**
 * `ThrowerPushOutOfWorld` — `FUN_00449D40`. The per-frame collision hook.
 *
 * The actor half moves by a **tenth** of the penetration and the world half by
 * **all** of it, which is the same asymmetry class 0x30 has: two actors ease
 * apart over several frames, a wall does not negotiate.
 *
 * **The actor half has a case of its own** (`0x00449D7F`..`0x00449DBF`):
 * unless this thrower is `zslman` (character type 0x18), an object found whose
 * `obj+0x34` carries `0x200000` does not push it. Instead, if the thrower is
 * {@link ThrowerFlag.OffGround} and not already in
 * {@link ThrowerState.FallAndLand}, it is put there, sub 0 -- a thrower on a
 * wall or a ceiling that something with that bit runs into falls off.
 * `[proved]`. The one class known to raise the bit on `obj+0x34` is 0x33's
 * burning car ({@link ActorFlag.FireLoop}); `L3` applies to anything else.
 */
export function ThrowerPushOutOfWorld(obj: Actor): void {
  ThrowerPlaceCollisionSphere(obj);

  if (obj.flags2 & ThrowerFlag.CollideActors) {
    if (ColiTestSphereAgainstActors(obj, obj.sphereCentre.x, obj.sphereCentre.y,
                                    obj.sphereCentre.z,
                                    obj.bodyRadius * ACTOR_RADIUS_SCALE)) {
      // `CMP word [ESI+0x1F4], 0x18` then `TEST dword [g_coli_hit_object +
      // 0x34], 0x200000` (`0x00449D7F`, `0x00449D8F`).
      const hit = ActorByAt(G.g_coli_hit_object);
      if (obj.charType === CHAR_ZSLMAN || !hit
          || !(hit.flags & HIT_OBJECT_KNOCKS_OFF)) {
        const f = G.g_coli_hit_depth * ACTOR_PUSH_FRACTION;
        // x and z only, exactly as the engine writes it: `obj+0x40` and
        // `obj+0x48` are assigned and `obj+0x44` is not.
        obj.pos.x += (G.g_coli_hit_normal[0] ?? 0) * f;
        obj.pos.z += (G.g_coli_hit_normal[2] ?? 0) * f;
        ThrowerPlaceCollisionSphere(obj);
      } else if (obj.state !== ThrowerState.FallAndLand
                 && (obj.flags2 & ThrowerFlag.OffGround)) {
        obj.state = ThrowerState.FallAndLand;
        obj.sub = 0;
      }
    }
  }

  // The port's own, and the only thing here the exe has no line for:
  // `worldPushDepth` is what `render/stuck_debug.ts` draws, a port-only field
  // whose divergence is declared on `Actor.worldPushDepth`. It is cleared
  // whether or not the push runs, so an actor that stops colliding stops
  // being marked -- the same reasoning as class 0x30's.
  obj.worldPushDepth = 0;
  if (obj.flags2 & ThrowerFlag.CollideWorld) {
    if (ColiTestSphereAgainstFullSet(obj.sphereCentre.x, obj.sphereCentre.y,
                                     obj.sphereCentre.z, obj.bodyRadius)) {
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
