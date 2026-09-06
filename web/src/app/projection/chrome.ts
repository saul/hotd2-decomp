/**
 * The four small projections the chrome reads.
 *
 * Each is a read of the player's own state turned into plain values: the
 * transport's slider range and label, the audio strip, the skip offer and the
 * branch question. They sit beside `buildProjection` because they are the same
 * kind of thing — and out of `main.ts` because a composition root that also
 * formats strings is doing two jobs.
 */
import { SnapshotRing } from "../ring";
import type { Player } from "../main";
import type {
  BranchProjection, SkipProjection, SoundProjection, TransportProjection,
} from "../../ui/projection";

/**
 * The skip bar, shown under the game's own condition.
 *
 * `Walker.canSkip` is `DAT_009A2D7C != 0 && g_nFiringGate == 0` -- the exact
 * test both player-update routines make before looking at Start. So the bar
 * appears precisely where the game would have accepted a skip, which is
 * something the retail build never shows you, its skip being one assignment
 * short of working.
 *
 * Unlike the branch bar this is an offer, not a question: playback is not
 * waiting on it and ignoring it changes nothing.
 */
export function skipProjection(p: Player): SkipProjection | null {
  const w = p.walker;
  // The bar follows the region, not the offer. `canSkip` adds the firing
  // gate, and gating *visibility* on that made the whole feature invisible
  // whenever the gate happened to be up -- which is not worth the fidelity,
  // since the region is the thing the script actually declares. So the bar
  // shows for the region and the button carries the gate.
  if (!w?.skippable) return null;
  const can = w.canSkip;
  const held = w.wait?.blocksOn;
  return {
    canSkip: can,
    // On the rare frame a branch point is live too, sit above it.
    stacked: !!w.branch,
    sub: !can
      ? "region open, but the shutter's firing gate is up — the game would "
        + "not poll Start here"
      : held
        ? `holding on ${held} — skips every wait until the region closes`
        : "skips every wait until set_skippable_region closes",
  };
}

/**
 * The branch bar's contents.
 *
 * **The game has already decided.** `b.choice` is `g_script_branch_var` as it
 * stood when the step list ran out, and the bar's job is to say which route
 * that is and give a viewer a moment to take the other one -- not to ask a
 * question the engine never asks. The countdown label has three states, each
 * saying what it means: running, frozen because the pointer is over the bar,
 * or simply waiting because only Play mode runs the window at all.
 */
export function branchProjection(p: Player): BranchProjection | null {
  const b = p.walker?.branch;
  if (!b) return null;
  const route = p.walker?.currentBlock?.route;
  const taking = route?.next[b.choice] ?? -1;
  return {
    sub: `block ${b.block} → ${b.targets.join(" or ")}`,
    options: b.targets.map((t) => {
      const choice = route ? route.next.indexOf(t) : -1;
      // The arcade shows a preview of each route before you commit. Those
      // shots are the `store_six` operands, indexed by `branch_choice`.
      // Unused choices are stored as slot 0 / frame 0 and resolve to no
      // path; those get no preview rather than a shot of somewhere else.
      const shot = b.preview?.find((q) => q.choice === choice && q.cam);
      const chosen = t === taking;
      return {
        target: t,
        label: `→ ${t}`,
        title: chosen
          ? "The route the game itself is taking, because "
            + `g_script_branch_var is ${b.choice}. Nothing has to be clicked.`
          : `Override: take route to block ${t} instead`
            + (choice >= 0 ? ` (branch_choice ${choice})` : ""),
        chosen,
        preview: shot ? { slot: shot.slot, frame: shot.frame } : null,
      };
    }),
    countdown: !p.playing
      ? "waiting -- Play runs the window"
      : p.branchHover
        ? "window paused"
        : taking >= 0
          ? `taking → ${taking} in ${Math.max(0, b.countdown).toFixed(1)} s`
          : `ending the scene in ${Math.max(0, b.countdown).toFixed(1)} s`,
    paused: p.playing && p.branchHover,
  };
}

/**
 * How much history the ring is holding, as a sentence.
 *
 * The button's own step is a cadence rather than a promise -- the newest slot
 * can be anything up to one cadence old -- so the label says the step it is
 * aiming at and then the window it has, which is the number that decides
 * whether a rewind can reach the thing you want to see again.
 */
function rewindLabel(p: Player): string {
  const h = p.history;
  if (!h.depth) return "nothing to rewind to yet";
  const step = (SnapshotRing.EVERY / 60).toFixed(1);
  return `back ~${step} s  ·  ${(h.frames / 60).toFixed(0)} s of history`
    + ` in ${h.depth} slot${h.depth === 1 ? "" : "s"}`;
}

/** The camera slider's range and label, which follow the current shot. */
export function transportProjection(p: Player): TransportProjection {
  const w = p.walker;
  const cam = w?.cam;
  const path = cam ? p.paths?.paths.get(cam.slot) : undefined;
  const base = {
    playing: p.playing, mode: p.state.mode, speed: p.speed,
    frozen: !!p.state.freeze,
    canRewind: p.history.depth > 0,
    rewindLabel: rewindLabel(p),
  };
  if (!cam || !path) {
    return { ...base, hasPath: false, camFrame: 0, camFrameLo: 0,
             camFrameHi: 1, camLabel: "no camera path" };
  }
  const lo = Math.min(cam.startFrame, cam.endFrame);
  const hi = Math.max(cam.startFrame, cam.endFrame, lo + 1);
  return {
    ...base,
    hasPath: true,
    camFrame: cam.frame,
    camFrameLo: Math.floor(lo),
    camFrameHi: Math.ceil(hi),
    camLabel: `${path.file}[${path.index}] slot ${cam.slot}  `
      + `frame ${cam.frame.toFixed(0)} / ${hi.toFixed(0)}`
      + (cam.isStatic ? "  (static pose)" : ""),
  };
}

export function soundProjection(p: Player): SoundProjection {
  const bs = p.bgm.current;
  const on = !p.bgm.muted;
  return {
    muted: p.bgm.muted,
    volume: Math.round(p.bgm.volume * 100),
    blocked: bs.blocked,
    // The button states what it currently IS, not what pressing it does.
    text: on ? (bs.playing ? "Sound on" : "Sound on…") : "Muted",
    label: !bs.file
      ? "no bgm"
      : bs.blocked && on
        ? "click 🔇 to allow audio"
        : `${bs.file}${bs.source === "stage" ? " (stage)" : ""}`,
  };
}
