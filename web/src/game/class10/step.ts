/**
 * `CivilianStepScript` — `FUN_0048B1E0`, and the wait tests it is made of.
 *
 * The second of class 0x10's two halves: it runs every frame and decides
 * whether the parked wait is over. **Every bit of the wait word is a reason to
 * keep waiting**, which is why the conjunction reads inverted.
 *
 * The four helpers below have no addresses: `FUN_0048B1E0` is one function and
 * they are its arms, named because `LAB_0048B52E` — the tail three of them
 * fall into — is the piece splitting got wrong once already.
 */
import type { Actor } from "../actor";
import { CamPathCueReached } from "../camera/path";
import { G } from "../globals";
import type { ClassFrame } from "../registry";
import { MotionPlayFrame } from "../tables";
import { CivilianOp, CivilianTarget, CivilianWait, CmdAt } from "./ops";
import { CivilianReapplyWaitCommand } from "./script";
import { CivilianTargetPoint, HeadingError } from "./turn";

/**
 * `CivilianStepScript` — `FUN_0048B1E0`.
 *
 * Returns true when the parked wait is over and the VM should run. **Every bit
 * of the wait word is a reason to keep waiting**, so the engine's conjunction
 * reads inverted at first glance: it breaks out (returns false) when all the
 * reasons still hold, and falls through to the resume when one of them does
 * not.
 *
 * The resume is not simply "the next command". `sub.skipCount` (op 0x11) says
 * how many wait commands to walk past first, and each is walked by
 * `CivilianReapplyWaitCommand`, which re-applies the state the *skipped*
 * block's wait conditions read without running its actions.
 */
export function CivilianStepScript(obj: Actor, f: ClassFrame): boolean {
  const sub = obj.civ;
  if (!sub || sub.script < 0) return false;

  // The engine saves the fields `CivilianReapplyWaitCommand` may clobber and
  // puts them back before returning false, so a frame that does not resume
  // leaves the sub-block exactly as it found it.
  const saved = {
    loops: sub.loops, childrenGoal: sub.childrenGoal,
    enemiesGoal: sub.enemiesGoal, civiliansGoal: sub.civiliansGoal,
    cuePath: sub.cuePath, cueFrame: sub.cueFrame,
    motionCompare: sub.motionCompare, flagIndex: sub.flagIndex,
  };
  let word = sub.wait;
  let pc = sub.cursor;
  let ran = false;

  for (let guard = 0; guard < 256; guard++) {
    if (!((word & CivilianWait.Any) !== 0 || sub.timer >= 0)) break;
    if (word & CivilianWait.Blocked) break;

    if (CivilianWaitStillHolds(obj, word)
        && CivilianArrived(obj, word, f) === "wait") break;

    sub.timer = -1;
    ran = true;
    sub.hookBusy = 0;
    let at = pc;
    if (sub.resumeScript >= 0) {
      sub.script = sub.resumeScript;
      at = 0;
      sub.resume = 0;
      sub.resumeScript = -1;
    } else {
      while (sub.skipCount !== 0) {
        at = CivilianReapplyWaitCommand(obj, sub.script, at);
        sub.skipCount -= 1;
      }
    }
    const here = CmdAt(sub.script, at);
    word = here?.args?.[0] ?? 0;
    sub.cursor = at;
    pc = CivilianReapplyWaitCommand(obj, sub.script, at);
    if (CmdAt(sub.script, pc)?.op === CivilianOp.End) break;
  }

  if (!ran) Object.assign(sub, saved);
  return ran;
}

/** True while the wait word's counters and gates still hold the script. */
function CivilianWaitStillHolds(obj: Actor, word: number): boolean {
  const sub = obj.civ;
  if (!sub) return false;
  if ((word & CivilianWait.EnemiesPresent)
      && !(sub.enemiesGoal < G.g_enemies_present)) return false;
  if ((word & CivilianWait.EnemiesAlive)
      && !(sub.enemiesGoal < G.g_enemies_alive)) return false;
  if ((word & CivilianWait.CiviliansAlive)
      && !(sub.civiliansGoal < G.g_civilians_alive)) return false;
  if ((word & CivilianWait.ChildrenAlive)
      && !(sub.childrenGoal < sub.childCount)) return false;
  if ((word & CivilianWait.MotionLoops) && sub.loops === 0) return false;
  if ((word & CivilianWait.MotionFrame)
      // `*(int *)(model + 8)` is `obj+0x19C`, the **play** cursor, not the
      // authored frame index — the same clock every other cue is counted in.
      && MotionPlayFrame(obj) === sub.motionCompare) return false;
  if ((word & CivilianWait.Hook) && sub.hookBusy !== 0) return false;
  if (word & CivilianWait.Free) return false;
  if ((word & CivilianWait.CameraSettled)
      && !(G.g_camera_settled === 0)) return false;
  // `?? 0` and not a bare read: a flag the script has never set is absent from
  // the array, and `undefined !== 0` would have ended the wait on frame one.
  if ((word & CivilianWait.ScriptFlag)
      && (G.g_script_flags[sub.flagIndex] ?? 0) !== 0) return false;
  return true;
}

/** The camera cue and the player-count gate, which sit past the timer. */
function CivilianCueMet(obj: Actor, word: number): boolean {
  const sub = obj.civ;
  if (!sub) return false;
  if ((word & CivilianWait.CameraCue)
      && CamPathCueReached(sub.cuePath, sub.cueFrame)) return true;
  if ((word & CivilianWait.InPlay) && G.g_players_in_play >= 1) return true;
  return false;
}

/**
 * Wait bits 0x10 / 0x20 / 0x40, and the tail all three share.
 *
 * **`LAB_0048b52e` is one label reached from three places**, and splitting it
 * is what broke this. In `CivilianStepScript` (`FUN_0048B1E0`) the in-front
 * test, the camera cue and the timer sit together at the bottom, and the
 * arrival arms *fall into* them: a word with neither `Reach` nor `Face` jumps
 * straight there, `Face` goes there when the heading error is not yet zero,
 * and `Reach` goes there while the actor is still outside its radius.
 *
 * The port had that tail written out twice, with the in-front test in only one
 * copy — so a word carrying `InFront` **alone** never ran it and could be
 * released by nothing but its timer. Stage 2's `0x138BC hito_oyajiaa` has such
 * a word and no timer: she held `g_civilians_alive` at one, two hundred units
 * out, and `wait_scripted_actors` at block 30 never came down. The other copy
 * dropped the cue and the timer instead, so an actor that had not arrived
 * skipped both.
 */
function CivilianArrived(obj: Actor, word: number,
                         f: ClassFrame): "advance" | "wait" {
  const sub = obj.civ;
  if (!sub) return "wait";

  /** `LAB_0048b52e` — in front, or the cue, or the timer. */
  const tail = (): "advance" | "wait" => {
    if (CivilianInFront(obj, word)) {
      sub.targetMode = CivilianTarget.None;          // `LAB_0048b67e`
      return "advance";
    }
    if (CivilianCueMet(obj, word)) return "advance";
    const t = sub.timer;
    if (t < 0) return "wait";
    sub.timer = t - 1;
    return t !== 0 ? "wait" : "advance";
  };

  if ((word & (CivilianWait.Reach | CivilianWait.Face)) === 0) return tail();

  const to = CivilianTargetPoint(obj, f);
  if ((word & CivilianWait.Reach) === 0) {
    // Turn only: arrived the frame the heading error rounds to zero.
    if (HeadingError(obj, to) === 0) {
      sub.targetMode = CivilianTarget.None;
      return "advance";
    }
    return tail();
  }
  if (sub.radius < Math.hypot(obj.pos.x - to.x, obj.pos.z - to.z)) return tail();
  if (sub.targetMode > 0 && sub.radius <= 1) {
    obj.pos.x = to.x;
    obj.pos.z = to.z;
  }
  sub.targetMode = CivilianTarget.None;
  return "advance";
}

/**
 * Wait bit 0x40, which can end the wait on its own.
 *
 * It reads `sub+0x30..0x38` **raw**, not the target the mode resolves to: the
 * engine computes the mode-resolved point into locals for the reach and turn
 * tests and then transforms `civ[0xC..0xE]` here regardless. For a positive
 * `targetMode` the two are the same point, and for a negative one they are not.
 *
 * [diverges] The engine builds the full inverse orientation — `-ry`, `-rz`,
 * `-rx` — and transforms the delta through it. This rotates by yaw alone,
 * which is exact for anything standing upright and wrong only for a civilian
 * that is not, and none of them is.
 */
function CivilianInFront(obj: Actor, word: number): boolean {
  if ((word & CivilianWait.InFront) === 0) return false;
  const sub = obj.civ;
  if (!sub) return false;
  const a = obj.yaw * ((Math.PI * 2) / 65536);
  const dx = sub.target.x - obj.pos.x;
  const dz = sub.target.z - obj.pos.z;
  // The rotated delta's z: positive is in front of the actor.
  return dz * Math.cos(a) - dx * Math.sin(a) > 0;
}
