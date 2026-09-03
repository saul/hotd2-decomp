/**
 * `CivilianUpdate` — `FUN_0048A920` — and the three tails it runs inline.
 *
 * The camera-point switch, the removal countdown and the leave have no
 * addresses of their own: the engine writes them out at the bottom of the
 * update. They are here with it rather than in files of their own for exactly
 * that reason.
 */
import type { Actor } from "../actor";
import { CamPathCueReached } from "../camera/path";
import { ActorDespawn } from "../despawn";
import { G } from "../globals";
import type { ClassFrame } from "../registry";
import { T } from "../tables";
import { CivilianPruneDeadChildren } from "./children";
import { CivilianRunFrameHook, PoseHookGrowAndPushOutOfWorld } from "./hooks";
import { CivilianCountMotionLoops } from "./loops";
import { CivilianTarget } from "./ops";
import { CivilianRunScript } from "./script";
import { CivilianCheckShot } from "./shot";
import { CivilianStepScript } from "./step";
import { CivilianStepTurnToTarget } from "./turn";

/**
 * `CivilianUpdate` — `FUN_0048A920`. One frame of a civilian.
 *
 * The order is the engine's: prune, hook, turn, interpolate, advance the clip,
 * step the script, then the shot branch, the sound queue and the removal. The
 * shot branch runs **after** the script step on purpose — a shot taken this
 * frame switches the script the step just resumed.
 */
export function CivilianUpdate(obj: Actor, f: ClassFrame): void {
  const sub = obj.civ;
  if (!sub) return;
  const frames = f.dt * 60;

  CivilianPruneDeadChildren(obj);
  CivilianRunFrameHook(obj, frames);
  if (sub.targetMode !== CivilianTarget.None) CivilianStepTurnToTarget(obj, f);

  // Op 0x26's move, which the engine steps by a per-frame delta and then snaps.
  if (sub.moveFrames !== 0) {
    sub.moveFrames -= 1;
    if (sub.moveFrames === 0) {
      obj.pos = { ...sub.moveTo };
    } else {
      obj.pos.x += obj.vel.x;
      obj.pos.y += obj.vel.y;
      obj.pos.z += obj.vel.z;
    }
  }

  // The loop counter. The clip clock itself is `ActorAdvanceMotion`'s; this is
  // the part class 0x10 owns — how many more times it may come round.
  CivilianCountMotionLoops(obj);

  if (CivilianStepScript(obj, f)) {
    CivilianRunScript(obj, sub.script, sub.cursor, f);
  }

  CivilianCheckShot(obj, f);

  // The queued sound, and the list op 0x22 left behind it.
  if (sub.soundDelay !== 0) {
    sub.soundDelay -= 1;
    if (sub.soundDelay === 0) {
      f.events?.emit("sound.play", { id: sub.soundId });
      const next = sub.sounds.shift();
      if (next) { sub.soundId = next[0]; sub.soundDelay = next[1]; }
    }
  }

  // `ActorRegisterCameraPoint(4.0)` (`FUN_00409B70`) goes here in the engine:
  // it transforms `obj+0x100` into view space, appends the actor to the
  // per-frame gunshot list and raises `obj+0x104` by its argument.
  //
  // [diverges] Every part of that is the draw's. `obj+0x100` is written by
  // `SkeletonEmitNode` as the skeleton is walked, and the port has no
  // skeleton — `render/characters.ts`'s `trackLookAt` is that writer here, and
  // it already applies the same 4.0 rise. The shot test is the renderer's too,
  // for the same reason: the ray is the mouse's. What the port owns is the
  // sphere's *radius*, `obj+0x124`, which `CivilianInit` sets.
  CivilianWriteCameraPoint(obj);
  PoseHookGrowAndPushOutOfWorld(obj);
  CivilianCheckRemoval(obj);
}

/**
 * The camera-point switch at the tail of `CivilianUpdate`: `sub+0x80` (op
 * 0x17) picks which point goes to `obj+0x12C`.
 *
 * [open] Only mode 0 is ported. Modes 1, 2 and 3 multiply the camera matrix by
 * a matrix inside the model block (`model+0x70`, `model+0x4C`, and the
 * midpoint of `model+0x244` and `model+0x1D8`) and those are not bone records
 * — they are matrices the pose leaves behind, which `game/` cannot reach.
 * Eight of the shipped streams ask for mode 1, four for mode 2, two for mode 3.
 */
function CivilianWriteCameraPoint(obj: Actor): void {
  if (obj.civ?.cameraPointMode !== 0) return;
  obj.camPoint.x = obj.pos.x;
  obj.camPoint.y = obj.pos.y;
  obj.camPoint.z = obj.pos.z;
}

/**
 * The removal cue: camera path `removePath` reaching frame `removeFrame`
 * starts a countdown, and the actor leaves when it runs out.
 */
function CivilianCheckRemoval(obj: Actor): void {
  const sub = obj.civ;
  if (!sub) return;
  if (sub.removeDelay === 0) {
    if (CamPathCueReached(sub.removePath, sub.removeFrame)) {
      sub.removeDelay = Math.max(1, T.civilians?.spawns?.[String(obj.at)]
        ?.removeDelay ?? 0);
    }
    return;
  }
  sub.removeDelay -= 1;
  if (sub.removeDelay !== 0) return;
  // A civilian still holding children does not leave: the engine restarts the
  // countdown instead, which is what keeps a hostage on stage until rescued.
  if (sub.childCount !== 0) { sub.removeDelay = 1; return; }
  CivilianLeaveField(obj);
}

/**
 * Class 0x10's leave: the tail `CivilianUpdate` (`FUN_0048A920`) runs inline
 * rather than in a routine of its own, which is why this has no address.
 *
 * [port-only] For that reason and no other — the code is the engine's, the
 * function is the port's, and `ClassHandler.leave` needs something to name.
 *
 * `if ((sub+0x04 & 1) == 0) g_civilians_alive--;` and then the despawn. Bit 0
 * is the "already left the count" stamp op 0x2C's `LeaveCountNow` sets, so a
 * civilian that took itself out early is not taken out twice.
 *
 * [open] The engine also frees the actor's hit slot —
 * `g_hit_slots[obj+0x3C] = 0` — and the draw record at `model+0x45C`. Neither
 * is modelled by this port at all, so neither is here.
 */
export function CivilianLeaveField(obj: Actor): void {
  const sub = obj.civ;
  if (sub && !(sub.flags2 & 1)) G.g_civilians_alive -= 1;
  ActorDespawn(obj);
}
