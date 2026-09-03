/**
 * The civilian's row in the debug sidebar.
 *
 * No exe function behind any of it. It is what `ClassHandler.debug` asks a
 * class for, and the whole argument for that hook is that the class answers in
 * its own vocabulary rather than the panel guessing from outside.
 */
import type { Actor } from "../actor";
import { G } from "../globals";
import type { ActorDebug } from "../registry";
import { MotionPlayFrame } from "../tables";
import { CivilianTarget, CivilianWait } from "./ops";
import { HeadingError } from "./turn";

/**
 * The civilian VM, for the debug sidebar.
 *
 * The wait word is the whole story: `CivilianStepScript` only enters its loop
 * when the word has a bit in `Any` or the timer is running, so a word made
 * only of high bits is parked until something outside the VM moves it — which
 * is what stage 1's hostage does while it waits to be killed. Spelling the
 * bits out, next to the counter or cue each one is actually waiting on, is the
 * difference between reading that and staring at a hex value.
 */
const WAIT_BIT_NAMES: [number, string][] = [
  [CivilianWait.EnemiesPresent, "enemies-present"],
  [CivilianWait.EnemiesAlive, "enemies-alive"],
  [CivilianWait.ChildrenAlive, "children-alive"],
  [CivilianWait.CiviliansAlive, "civilians-alive"],
  [CivilianWait.Reach, "reach"], [0x20, "face"], [0x40, "in-front"],
  [0x80, "camera-cue"],
  [CivilianWait.MotionLoops, "motion-loops"],
  [CivilianWait.MotionFrame, "motion-frame"],
  [0x400, "hook"], [CivilianWait.Free, "free"],
  [CivilianWait.CameraSettled, "camera-settled"],
  [CivilianWait.ScriptFlag, "script-flag"],
  [CivilianWait.LeaveCountNow, "leave-count"],
  [CivilianWait.PushOutOfWorld, "push-out"],
  [CivilianWait.RemoveOffCamera, "remove-off-camera"],
  [CivilianWait.Uncounted, "uncounted"],
  [CivilianWait.Rescued, "rescued"],
  [CivilianWait.InPlay, "in-play"],
];

/**
 * One civilian, for the sidebar.
 *
 * [port-only] There is no such routine in the exe and there could not be. The
 * wait word is the whole story: `CivilianStepScript` (`FUN_0048B1E0`) only
 * enters its loop when the word has a bit in `Any` or the timer is running, so
 * a word made only of high bits is parked until something outside the VM moves
 * it — which is what stage 1's hostage does while it waits to be killed.
 * Spelling the bits out, next to the counter or cue each one is actually
 * waiting on, is the difference between reading that and staring at a hex
 * value.
 */
export function CivilianDebug(obj: Actor): ActorDebug {
  const sub = obj.civ;
  if (!sub) return { summary: "no VM state", hot: true };
  const word = sub.wait >>> 0;
  const parked = (word & CivilianWait.Any) === 0 && sub.timer < 0;
  const bits = WAIT_BIT_NAMES.filter(([b]) => word & b).map(([, n]) => n);

  // What each set bit is actually waiting on, beside its current value: a
  // script held by a counter reads differently from one waiting on a cue that
  // has already gone by, and only the second is a bug.
  const on: string[] = [];
  if (word & CivilianWait.EnemiesAlive) {
    on.push(`enemies>${sub.enemiesGoal} (${G.g_enemies_alive})`);
  }
  if (word & CivilianWait.CiviliansAlive) {
    on.push(`civilians>${sub.civiliansGoal} (${G.g_civilians_alive})`);
  }
  if (word & CivilianWait.ChildrenAlive) {
    on.push(`children>${sub.childrenGoal} (${sub.childCount})`);
  }
  if (word & CivilianWait.MotionLoops) on.push(`loops ${sub.loops}`);
  if (word & CivilianWait.MotionFrame) {
    on.push(`frame ${MotionPlayFrame(obj)}==${sub.motionCompare}`);
  }
  if (word & 0x80) {
    on.push(`cue (${sub.cuePath},${sub.cueFrame}) now `
      + `(${G.g_active_cam_path},${G.g_cam_path_frame})`);
  }
  if (sub.timer >= 0) on.push(`timer ${sub.timer}`);

  const detail = [
    `script ${sub.script} · pc ${sub.pc} · cursor ${sub.cursor}`
      + ` · motion ${obj.motion}`,
    `wait 0x${word.toString(16)}${bits.length ? " · " + bits.join(" ") : ""}`,
  ];
  // The turn-and-reach bits are the ones that read as "nothing is happening":
  // the actor stands still whether it is out of range, facing the wrong way,
  // or turning at a rate of zero and so never facing anything. The numbers
  // that separate those cannot be inferred from the row without them.
  if (word & (CivilianWait.Reach | CivilianWait.Face | CivilianWait.InFront)) {
    const t = sub.target;
    on.push(`target ${sub.targetMode < 0 ? CivilianTarget[sub.targetMode]
             ?? sub.targetMode : `(${t.x.toFixed(0)},${t.z.toFixed(0)})`}`
      + ` · d=${Math.hypot(obj.pos.x - t.x, obj.pos.z - t.z).toFixed(0)}`
      + `/${sub.radius} · heading err ${HeadingError(obj, t)}`
      + ` · turn ${sub.turnRate}`);
  }
  if (on.length) detail.push(`on ${on.join(" · ")}`);
  if (parked) {
    detail.push("no loop bit and no timer — parked until something "
      + "outside the VM moves it");
  }
  detail.push(`removal (${sub.removePath},${sub.removeFrame})`
    + ` delay ${sub.removeDelay} · children ${sub.childCount}`
    + ` · onShot ${sub.onShotScript}`);
  return {
    summary: (obj.dead ? "dead · " : "")
      + (parked ? "parked" : bits.length ? bits.join(" ") : "running"),
    detail,
    hot: parked && !obj.dead,
  };
}
