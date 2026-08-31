/**
 * Class 0x24 — the scripted non-combat set-piece prop. 48 spawns.
 *
 * Not an enemy and not a container: a skinned actor that plays one animation
 * and is choreographed against the **camera**. Every one of its six states is
 * removed when the camera reaches a named path at a named frame, and the
 * freeze/unfreeze cues are the same pair again. A set-piece is a thing that
 * happens at a point in a camera move rather than at a point in time, which is
 * why nothing here has a clock of its own.
 *
 * `spawns.md` had it as "not damageable, awards nothing, plays no sound at
 * all" — `[proved]` negatively across all 496 `PlaySoundId` call sites. That
 * still holds: nothing below scores, damages or makes a noise.
 *
 * ## The handler is an Init
 *
 * `SetPiecePropInit` (`FUN_00482CE0`) is not an update. It builds the actor,
 * then **installs one of six state routines as the object's own entry point**
 * and never runs again — the same trick the container families use, and the
 * reason `state` here is the selector rather than a state machine's position.
 *
 * ## Everything is in the parameter tail
 *
 * ```
 * tail+0x00  u32  the model handle FUN_0045EBB0 resolves
 * tail+0x04  s8   character type      -> obj+0x1F4
 * tail+0x05  s8   state selector      -> obj+0x130C
 * tail+0x06  s16  removal: cam path, or a script-flag index
 * tail+0x08  s16  removal: cam frame threshold
 * tail+0x0A  s16  motion id           -> obj+0x1B4
 * tail+0x0C  s16  hold frames (selector 0 only)
 * tail+0x0E  s16  cue path — or a motion id, in the hold state
 * tail+0x10  s16  cue frame
 * tail+0x12  s16  second cue path (selector 2)
 * tail+0x14  s16  second cue frame
 * ```
 *
 * And `obj+0x11C` is an **animation phase seed**, not hit points: `-1` draws a
 * random start frame, anything else starts the clock there. That is how a row
 * of identical set-pieces avoids moving in lockstep — the same problem that
 * had the crowd marching in step earlier in this project, solved in the data.
 */
import type { Rng } from "../../core/rng";
import type { Actor } from "../actor";
import { G } from "../globals";
import type { ClassFrame, ClassHandler } from "../registry";
import { T } from "../tables";

/** `obj+0x130C` for this class — which state routine the Init installs. */
export enum SetPieceState {
  /** `SetPieceStateIdle`, or `SetPieceStateHoldThenPlay` if `hold` is set. */
  Idle = 0,
  /** `SetPieceStateFreezeOnCue` — plays, then holds on a camera cue. */
  FreezeOnCue = 1,
  /** `SetPieceStateStartAndStopOnCues` — starts frozen, two cues. */
  StartAndStopOnCues = 2,
  /** `SetPieceStateDropToGround` — starts frozen and falls. */
  DropToGround = 3,
  /** `SetPieceStateSlide` — slides along a fixed heading, then stops. */
  Slide = 4,
  /** `SetPieceStateDelayedDrift` — holds, then drifts gently down. */
  DelayedDrift = 5,
}

/** `obj+0x34` bit the removal test switches on. */
export const SETPIECE_FLAG_REMOVE_ON_SCRIPT_FLAG = 0x2000000;

/** `SetPieceStateDropToGround` — the same half-gravity `ActorArcVelocity` uses. */
export const DROP_GRAVITY = 0.027222222;
/** `SetPieceStateDelayedDrift` — an eighth of it, and it waits first. */
export const DRIFT_GRAVITY = 0.0034027777;
export const DRIFT_START_FRAME = 0x32;

/** `SetPieceStateSlide` — a fixed heading, held for a fixed count. */
export const SLIDE_VX = 0.646266;
export const SLIDE_VZ = 0.613497;
export const SLIDE_FRAMES = 0x27;
export const SLIDE_HOLD_FRAMES = 0x19;

/** The descriptor tail, as the exporter hands it over. */
export interface SetPieceParams {
  /** `tail+0x05`. */
  selector: number;
  /** `tail+0x06` / `tail+0x08` — the removal trigger. */
  removePath: number;
  removeFrame: number;
  /** `tail+0x0C` — non-zero turns selector 0 into the hold-then-play variant. */
  hold: number;
  /** `tail+0x0E` / `tail+0x10`. A camera cue, or a motion id in the hold state. */
  cuePath: number;
  cueFrame: number;
  /** `tail+0x12` / `tail+0x14` — selector 2's second cue. */
  cue2Path: number;
  cue2Frame: number;
  /** `tail+0x0A` — the motion the Init installs. */
  motion: number;
  /** `obj+0x11C`. A start frame, or `-1` for a random one. Not hit points. */
  phase: number;
}

/** The tail for one spawn, from the bundle. */
export function SetPieceParamsOf(a: Actor): SetPieceParams | null {
  return T.setPieces?.[String(a.at)] ?? null;
}

/**
 * `SetPiecePropInit` — `FUN_00482CE0`.
 *
 * The parts of the Init that survive into the port: the phase seed, the
 * selector, and the freeze that selectors 2 and 3 start under. The skeleton
 * build (`FUN_00410440`) and the model resolve (`FUN_0045EBB0`) are the
 * renderer's — the character layer already assembles a spawn from its
 * character type, which is what this class is.
 */
export function SetPiecePropInit(obj: Actor, rng?: Rng): void {
  const p = SetPieceParamsOf(obj);
  obj.state = p?.selector ?? SetPieceState.Idle;
  obj.sub = 0;
  obj.frozen = 0;
  obj.holdFrames = 0;
  obj.slideTimer = 0;
  obj.accY = 0;
  obj.vel = { x: 0, y: 0, z: 0 };
  // Selectors 2 and 3 open frozen; a camera cue or the landing releases them.
  if (obj.state === SetPieceState.StartAndStopOnCues
      || obj.state === SetPieceState.DropToGround) {
    obj.frozen = 1;
  }
  if (p) {
    obj.motion = p.motion;
    const m = T.types[String(obj.charType)]?.motions[String(p.motion)];
    obj.clock = SetPiecePhaseSeconds(p, m?.fps ?? 30, m?.frames ?? 1,
                                     rng ?? FALLBACK_RNG);
  }
}

/**
 * The Init runs from `ActorSpawn`, which has no generator to hand. Nothing
 * shipped takes the random arm, so a fixed one keeps the snapshot honest
 * without threading an `Rng` through a signature the engine does not have.
 */
const FALLBACK_RNG = { int: (n: number) => (n >> 1) } as unknown as Rng;

/**
 * The phase seed the Init draws, as a clock offset in seconds.
 *
 * `obj+0x11C` is not hit points here: `-1` means "start anywhere in the clip"
 * and anything else is a literal start frame. The port folds it into
 * `clock`, which is what the renderer poses from.
 *
 * No shipped spawn actually uses `-1` — all 28 the six stages reach carry a
 * literal frame — so the random arm is transcribed and unexercised.
 */
export function SetPiecePhaseSeconds(p: SetPieceParams, fps: number,
                                     frames: number, rng: Rng): number {
  const frame = p.phase === -1 ? rng.int(Math.max(1, frames)) : p.phase;
  return frame / Math.max(1, fps);
}

/**
 * The removal test every state opens with.
 *
 * `obj+0x34` bit 0x2000000 chooses which trigger: a script flag, or the camera
 * reaching a path at a frame. Selector 5 is the one exception — it has no
 * flag variant and is always the camera.
 */
export function SetPieceShouldRemove(obj: Actor, p: SetPieceParams): boolean {
  const byFlag = (obj.flags & SETPIECE_FLAG_REMOVE_ON_SCRIPT_FLAG) !== 0
    && obj.state !== SetPieceState.DelayedDrift;
  if (byFlag) return G.g_script_flags[p.removePath] === 1;
  return G.g_active_cam_path === p.removePath
      && G.g_cam_path_frame >= p.removeFrame;
}

/** Whether the camera has reached a cue. */
function AtCue(path: number, frame: number): boolean {
  return G.g_active_cam_path === path && G.g_cam_path_frame >= frame;
}

/**
 * `SetPiecePropUpdate` — the six states, dispatched on the selector the Init
 * installed. The engine installs the routine directly; the port switches,
 * which is the same call made once removed.
 */
export function SetPiecePropUpdate(obj: Actor, f: ClassFrame): void {
  const p = SetPieceParamsOf(obj);
  if (!p) return;

  if (SetPieceShouldRemove(obj, p)) {
    obj.dead = true;
    obj.visible = false;
    f.events?.emit("setpiece.removed", { at: obj.at });
    return;
  }

  switch (obj.state) {
    case SetPieceState.Idle:
      if (p.hold > 0) SetPieceStateHoldThenPlay(obj, p);
      break;
    case SetPieceState.FreezeOnCue:
      // Plays from the start and holds the moment the camera reaches the cue.
      if (AtCue(p.cuePath, p.cueFrame)) obj.frozen = 1;
      break;
    case SetPieceState.StartAndStopOnCues:
      // The order is the engine's: the start cue is tested first, so a frame
      // on which both are true leaves it frozen.
      if (AtCue(p.cue2Path, p.cue2Frame)) obj.frozen = 0;
      if (AtCue(p.cuePath, p.cueFrame)) obj.frozen = 1;
      break;
    case SetPieceState.DropToGround:
      SetPieceStateDropToGround(obj);
      break;
    case SetPieceState.Slide:
      SetPieceStateSlide(obj);
      break;
    case SetPieceState.DelayedDrift:
      SetPieceStateDelayedDrift(obj);
      break;
  }

  // `SetPiecePropDrawAndTick`'s tail — `if (obj+0x1324 == 0) obj+0x194++` —
  // is `ActorAdvanceMotion`, which returns early on `frozen`. Nothing to do
  // here but leave the flag where the states put it.

  // Three of the six freeze again on the motion's last frame.
  if (obj.state === SetPieceState.DropToGround
      || obj.state === SetPieceState.Slide
      || obj.state === SetPieceState.DelayedDrift) {
    if (SetPieceAtLastFrame(obj)) obj.frozen = 1;
  }
}

/** `SetPieceStateHoldThenPlay` — hold, then swap to the second motion. */
function SetPieceStateHoldThenPlay(obj: Actor, p: SetPieceParams): void {
  if (obj.holdFrames >= p.hold) return;
  obj.holdFrames += 1;
  if (obj.holdFrames >= p.hold && p.cuePath > 0) {
    // The one state where `tail+0x0E` is a motion id rather than a path.
    obj.motion = p.cuePath;
    obj.clock = 0;
  }
}

/** `SetPieceStateDropToGround` — falls, lands, then plays. */
function SetPieceStateDropToGround(obj: Actor): void {
  if (obj.sub === 0) {
    obj.accY = 0;
    obj.vel.y = 0;
    obj.sub = 1;
    return;
  }
  if (obj.sub !== 1) return;
  obj.accY -= DROP_GRAVITY;
  obj.vel.y += obj.accY;
  obj.pos.y += obj.vel.y;
  if (obj.pos.y <= G.g_camera_fixed_eye_y) {
    obj.pos.y = G.g_camera_fixed_eye_y;
    obj.sub = 2;
    // Landing is what starts the animation.
    obj.frozen = 0;
  }
}

/** `SetPieceStateSlide` — a fixed heading for 0x27 frames, then a 0x19 hold. */
function SetPieceStateSlide(obj: Actor): void {
  if (obj.sub === 0) {
    obj.slideTimer = SLIDE_FRAMES;
    obj.vel.x = SLIDE_VX;
    obj.vel.z = SLIDE_VZ;
    obj.sub = 1;
  } else if (obj.sub !== 1) {
    if (obj.sub === 2 && obj.slideTimer-- < 1) obj.sub = 3;
    return;
  }
  obj.pos.x += obj.vel.x;
  obj.pos.z += obj.vel.z;
  if (obj.slideTimer-- < 1) {
    obj.sub += 1;
    obj.slideTimer = SLIDE_HOLD_FRAMES;
  }
}

/** `SetPieceStateDelayedDrift` — waits for frame 0x32, then eases down. */
function SetPieceStateDelayedDrift(obj: Actor): void {
  if (obj.sub === 0) {
    if (SetPieceFrame(obj) < DRIFT_START_FRAME) return;
    obj.accY = 0;
    obj.vel.y = 0;
    obj.sub = 1;
  } else if (obj.sub !== 1) {
    return;
  }
  obj.accY -= DRIFT_GRAVITY;
  obj.vel.y += obj.accY;
  obj.pos.y += obj.vel.y;
  if (obj.pos.y <= G.g_camera_fixed_eye_y) {
    obj.pos.y = G.g_camera_fixed_eye_y;
    obj.sub = 2;
  }
}

/** The motion frame the renderer is showing, from the seconds-based clock. */
export function SetPieceFrame(obj: Actor): number {
  const m = T.types[String(obj.charType)]?.motions[String(obj.motion)];
  return Math.floor(obj.clock * (m?.fps ?? 30));
}

/**
 * Whether the clip has reached its last frame.
 *
 * The engine compares against `g_motion_play_length[motion] - 1`. That table
 * is not in the bundle, but the baked clip carries its own frame count, and
 * `mot.md` records that the play length runs at about twice the frames — so
 * the *clip's* last frame is the honest reading of "the animation has
 * finished" and does not need a second table to say it.
 */
export function SetPieceAtLastFrame(obj: Actor): boolean {
  const m = T.types[String(obj.charType)]?.motions[String(obj.motion)];
  if (!m?.frames) return false;
  return SetPieceFrame(obj) >= m.frames - 1;
}

export const SetPiecePropHandler: ClassHandler = {
  init: SetPiecePropInit,
  update: SetPiecePropUpdate,
};

