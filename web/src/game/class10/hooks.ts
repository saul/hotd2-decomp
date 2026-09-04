/**
 * The two hook slots class 0x10 installs into, and the routines that fill them.
 *
 * They are different slots and it is worth keeping them apart. `sub+0x5C` is
 * the **frame hook**, installed by op 0x10 out of the script and re-chosen as
 * often as the stream likes: five of them, each deciding its own command
 * length, which is why the exporter has to know them by address to decode the
 * stream at all. `PoseHookGrowAndPushOutOfWorld` (`FUN_0048D070`) is the
 * **pose hook**, installed once by `CivilianInit` (`FUN_0048A3E0`) and one of
 * only two in the whole program.
 */
import { type Actor, ActorUpdateBoundingSphere } from "../actor";
import { ColiTestSphereAgainstFullSet, QueryGroundHeightAt } from "../coli";
import { G } from "../globals";
import { CivilianHook, CivilianWait } from "./ops";
import { CivilianHookRideChildrenStep } from "./children";

/** `sub+0x5C`'s own constants — the fall step at 0x0048DA20. */
export const FALL_ACCEL = -0.02722;
const FALL_PROBE = 100;

/**
 * `CivilianHookFallStep` — `FUN_0048DA20`.
 *
 * `obj+0x50 += obj+0x5C`, `obj+0x44 += obj+0x50`, and when
 * `QueryGroundHeightAt(x, y + 100, z)` is at or above the new height, snap to
 * it, raise `sub+0x18` — which wait bit 0x400 waits for — and uninstall.
 *
 * It is the step for three of the five hooks: `CivilianHookStartFall`
 * (`FUN_0048D9F0`), `CivilianHookLaunchUp` (`FUN_0048DB90`) and
 * `CivilianHookLaunch` (`FUN_0048DBD0`) differ only in the velocity they take
 * out of the command before installing this.
 */
export function CivilianHookFallStep(obj: Actor, frames: number): void {
  const sub = obj.civ;
  if (!sub) return;
  obj.vel.y += obj.accY * frames;
  const ground = QueryGroundHeightAt(obj.pos.x, obj.pos.y + FALL_PROBE,
                                     obj.pos.z);
  obj.pos.x += obj.vel.x * frames;
  obj.pos.y += obj.vel.y * frames;
  obj.pos.z += obj.vel.z * frames;
  if (ground < obj.pos.y) return;
  obj.pos.y = ground;
  obj.vel = { x: 0, y: 0, z: 0 };
  sub.hookBusy = 1;
  sub.hook = CivilianHook.None;
}

/**
 * `sub+0x5C`, called once a frame before anything else moves the actor.
 *
 * [port-only] The engine calls the pointer; there is no dispatcher to port.
 * `sub.hook` holds the **install** routine's address rather than the step's,
 * because that is the number op 0x10's operand carries and the one a save
 * state can name — see {@link CivilianHook}.
 */
export function CivilianRunFrameHook(obj: Actor, frames: number): void {
  const sub = obj.civ;
  if (!sub) return;
  switch (sub.hook as CivilianHook) {
    case CivilianHook.Fall:
    case CivilianHook.LaunchUp:
    case CivilianHook.Launch:
      CivilianHookFallStep(obj, frames);
      break;
    case CivilianHook.RideChildren:
      CivilianHookRideChildrenStep(obj);
      break;
    case CivilianHook.None:
    default:
      break;
  }
}

/**
 * `PoseHookGrowAndPushOutOfWorld` — `FUN_0048D070`.
 *
 * The class's per-frame pose hook, and one of only two in the program. It does
 * two things and neither is a bone: it steps `obj+0x128` — the **body radius**
 * — toward the target op 0x16 set, by that op's per-frame step, clamping at
 * the target from whichever side it approaches; then, if the civilian's wait
 * word carries {@link CivilianWait.PushOutOfWorld}, it traces that sphere
 * against the full collision set and moves the actor out along the hit normal
 * by the **whole** penetration.
 *
 * The engine runs it from the pose walk; the port runs it from the update,
 * for the same reason `ActorAdvanceMotion` lives in `game/` — a hook that only
 * fires while something is drawing is a hook that a headless run and a
 * restored save both lose.
 */
export function PoseHookGrowAndPushOutOfWorld(obj: Actor): void {
  const sub = obj.civ;
  if (!sub) return;
  if (sub.scaleTarget !== obj.bodyRadius) {
    obj.bodyRadius += sub.scaleStep;
    // Clamp from whichever side it is closing: growing overshoots upward,
    // shrinking overshoots downward, and a zero step never arrives at all.
    if (sub.scaleStep > 0 && obj.bodyRadius > sub.scaleTarget) {
      obj.bodyRadius = sub.scaleTarget;
    } else if (sub.scaleStep < 0 && obj.bodyRadius < sub.scaleTarget) {
      obj.bodyRadius = sub.scaleTarget;
    }
  }
  if (!(sub.wait & CivilianWait.PushOutOfWorld)) return;
  ActorUpdateBoundingSphere(obj);
  if (!ColiTestSphereAgainstFullSet(obj.sphereCentre.x, obj.sphereCentre.y,
                                    obj.sphereCentre.z, obj.bodyRadius)) {
    return;
  }
  const d = G.g_coli_hit_depth;
  obj.pos.x += (G.g_coli_hit_normal[0] ?? 0) * d;
  obj.pos.y += (G.g_coli_hit_normal[1] ?? 0) * d;
  obj.pos.z += (G.g_coli_hit_normal[2] ?? 0) * d;
}
