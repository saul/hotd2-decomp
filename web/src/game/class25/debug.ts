/**
 * One scripted humanoid, for the sidebar.
 *
 * [port-only] There is no such routine in the exe. It exists because the
 * panel's answer for this class was the literal string *"ported, but the class
 * says nothing"* — `actorsProjection` prints that for any actor whose handler
 * has no `debug`, and class 0x25's had none — which is indistinguishable from
 * a class nobody has read, and was reported as a bug twice.
 *
 * What it has to be able to tell apart is the three ways a class-0x25 actor
 * stands still, because they are three different bugs:
 *
 * * **parked on a command whose condition is not met** — the normal way the VM
 *   waits, and the line names the condition and the value it is waiting on;
 * * **out of the VM** (`pc < 0`) — `ScriptedHumanoidIdle` (`FUN_00484D40`) is
 *   running, which does nothing but the removal test, so the actor is
 *   *supposed* to stand there;
 * * **holding a pose** (`frozen`) — `obj+0x1324`, written by `op 1`, which
 *   stops `ActorAdvanceMotion` where it stands.
 *
 * And one that is not the port's at all: a clip with no baked frames. That is
 * a **bundle** gap, not a state, and it looks exactly like the second and
 * third from outside — so it is called out by name, because it is what B13
 * turned out to be.
 */
import type { Actor, HumanoidActor } from "../actor";
import { authoredFrameOfTicks } from "../../core/play_cursor";
import { G } from "../globals";
import type { ActorDebug } from "../registry";
import { T } from "../tables";
import {
  HumanoidCond, HumanoidOp, HumanoidProgramOf, HumanoidTurn, type HumanoidCmd,
} from "./index";
import { HumanoidPath } from "./state";

/** What a command's condition is waiting on, in the condition's own terms. */
function CondText(obj: HumanoidActor, c: HumanoidCmd): string {
  switch (c.mode) {
    case HumanoidCond.Frames:
      return `stall ${obj.hum.stallFrames}==${c.a}`;
    case HumanoidCond.CameraAt:
      return `cam (${c.a},${c.b}) now (${G.g_active_cam_path},`
        + `${G.g_cam_path_frame})`;
    case HumanoidCond.MotionFrame:
      return c.a === -1 ? "last motion frame" : `motion frame ==${c.a}`;
    case HumanoidCond.ScriptFlag:
      return `script flag ${c.a}`;
    case HumanoidCond.FartherThanBefore:
      return `farther from (${(c.f0 ?? 0).toFixed(0)},`
        + `${(c.f1 ?? 0).toFixed(0)}) than last frame`;
    case HumanoidCond.Always:
      return "unconditional";
    default:
      return `mode ${c.mode} — no arm, so it never proceeds`;
  }
}

/**
 * `ScriptedHumanoidDebug` — [port-only], see the file comment.
 *
 * Read-only by contract: it runs every frame the panel is open, so it draws
 * from no `Rng`, advances no clock and writes nothing to `G`.
 */
export function ScriptedHumanoidDebug(a: Actor): ActorDebug {
  const obj = a as HumanoidActor;
  const p = HumanoidProgramOf(obj);
  if (!p) return { summary: "no program in the bundle", hot: true };

  const m = T.types[String(obj.charType)]?.motions[String(obj.motion)];
  // The gap that produced B13. `MotionFrame` divides by `m.frames`, so a clip
  // with none pins the frame at 0 and a `MotionFrame` wait on it can never be
  // met — the VM parks and the renderer holds one pose for the rest of the
  // stage. It is the bundle's fault and not the state's, so say which.
  const clip = m
    ? `motion ${obj.motion} frame `
      + `${authoredFrameOfTicks(obj.playTicks, m.fps, m.frames)}/${m.frames}`
    : `motion ${obj.motion} **not baked** — no frames in this bundle`;

  const detail: string[] = [];
  let summary: string;
  let hot = !m;

  if (obj.hum.pc < 0) {
    summary = "program ended · idle";
  } else {
    const c = p.cmds[obj.hum.pc];
    if (!c) {
      summary = `pc ${obj.hum.pc} past the end of ${p.cmds.length} commands`;
      hot = true;
    } else {
      const op = HumanoidOp[c.op] ?? `op ${c.op}`;
      const waits = c.op === HumanoidOp.WaitThenPlay
                 || c.op === HumanoidOp.WaitThenHold
                 || c.op === HumanoidOp.WaitUntil;
      summary = `pc ${obj.hum.pc}/${p.cmds.length} ${op}`
        + (waits ? ` · ${CondText(obj, c)}` : "");
      detail.push(`cmd {op ${c.op} mode ${c.mode} a ${c.a} b ${c.b}}`);
    }
  }

  detail.push(`${clip}${obj.frozen ? " · frozen (op 1 holds the pose)" : ""}`);
  if (obj.hum.turnMode === HumanoidTurn.Over) {
    detail.push(`turning to 0x${(obj.hum.turnTarget & 0xffff).toString(16)}`
      + ` · ${obj.hum.turnFrames} frames left`);
  } else if (obj.hum.turnMode === HumanoidTurn.FaceCamera) {
    detail.push("facing the camera every frame");
  }
  if (obj.hum.pathMode !== HumanoidPath.None) {
    detail.push(`riding object path ${obj.hum.pathSlot}`
      + ` (${HumanoidPath[obj.hum.pathMode] ?? obj.hum.pathMode})`
      + (obj.hum.pathOffsetRecord
         ? ` · offset record ${obj.hum.pathOffsetRecord}` : ""));
  }
  // Both removal triggers, because a scripted actor that outlives its shot is
  // the other half of what this panel gets opened for.
  detail.push(`removed at cam path ${p.removePath} frame ${p.removeFrame}`);

  return { summary, detail, hot };
}
