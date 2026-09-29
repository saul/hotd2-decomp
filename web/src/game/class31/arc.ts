/**
 * The arc — how a class-0x31 actor moves.
 *
 * Nothing in this class walks. Every move it makes is a **ballistic arc to a
 * named point over a named number of frames**, with a three-stage motion
 * script laid over it: a windup played on the spot, a flight, and a landing.
 * The pounce, the leap onto a wall, the leap back out of your face and the
 * scripted drop are all the same machine with different destinations and
 * different scripts.
 *
 * The arc itself is a closed form rather than an integrator, which is worth
 * knowing because it means the actor cannot drift: `ActorArcInterpolate`
 * computes the absolute position for frame *n* from the endpoints every time.
 */
import type { ArcStage } from "../../bundle/characters";
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { ActorFlag, ThrowerFlag, type Actor, type ThrowerActor }
  from "../actor";
import { ActorSetOneShotBlended } from "../class30/motion_cue";
import { GAME_HZ } from "../class30/states";
import type { GameHost } from "../host";
import { MotionOf, MotionPlayFrame, SecondsToTicks } from "../tables";
import { dist2d, vec3, type Vec3 } from "../vec";
import { GroundDustCode, ThrowerEmitGroundDust } from "./ground_dust";
import {
  ARC_MIN_FRAMES, ARC_MIN_FRAMES_FAST, ARC_SPEED_UNITS, ThrowerState,
} from "./states";
import { ThrowerLoadAttackArcScript, ThrowerPickAttack } from "./tables";

/**
 * Half the gravity `ThrowerStateFallAndLand` puts in `obj+0x5C`, and the
 * literal `ActorArcInterpolate` carries. Confirmed from the disassembly at
 * `0x00565E1C`: `23 01 df 3c` = `0x3CDF0123`.
 */
export const ARC_GRAVITY_HALF = 0.027222222;

/** `ActorArcBegin` — `FUN_0044DC10`. Record an arc of a known length. */
export function ActorArcBegin(obj: Actor, dest: Vec3, frames: number): void {
  obj.arcFrom = { x: obj.pos.x, y: obj.pos.y, z: obj.pos.z };
  obj.arcTo = { x: dest.x, y: dest.y, z: dest.z };
  obj.arcFrames = 0;
  obj.arcTotal = Math.max(1, Math.trunc(frames));
}

/**
 * `ActorArcBeginTo` — `FUN_0044DC70`. An arc whose length comes from the
 * **2D** distance: `n = (int)(dist2d * step)`, duration `n - n % step`.
 *
 * `[proved]` from the listing, because Ghidra drops the FPU argument to
 * `__ftol` here and shows the distance as nothing at all (`L1`):
 *
 * ```
 * 0044dc70  FLD  src.x; FSUB dst.x; FLD src.z; FSUB dst.z
 * 0044dc88  dz*dz + dx*dx; FSQRT                      ; x and z only
 * 0044dcdd  FIMUL dword ptr [ESP + 0x20]              ; * step, the 7th arg
 * 0044dce1  CALL __ftol                               ; n, truncated
 * 0044dce8  CDQ; IDIV step; SUB ECX, EDX              ; n - n % step
 * 0044dcef  MOV [ESI + 0x1334], ECX                   ; the duration
 * ```
 *
 * **`step` is the rate the arc is flown at, not a speed.** `ActorArcStep`
 * hands the same number to `ActorArcInterpolate`, which advances `obj+0x1330`
 * by it every frame, so a leg lasts `n / step` frames -- about **one frame per
 * unit of horizontal distance whatever the step** -- and what a bigger step
 * buys is height: the parabola is solved over `T = dist * step` parameter
 * frames, so its apex rises with `step` squared. Stage 2's rooftop route flies
 * four of its five legs at step 3.
 *
 * [diverges] The duration is floored at `step`. The engine's is not: a leg
 * shorter than one unit gives `T = 0`, and `ActorArcInterpolate`'s
 * `(dst - src) / T * n` is then `0 / 0` -- a NaN position for the one frame
 * it runs. The floor keeps the port's position finite; the shipped routes'
 * shortest leg is eight units, so it is never reached by the path follow.
 */
export function ActorArcBeginTo(obj: Actor, dest: Vec3, step: number): void {
  const n = Math.trunc(dist2d(obj.pos, dest) * step);
  ActorArcBegin(obj, dest, Math.max(step, n - (n % step)));
}

/**
 * `ActorArcBeginToAtSpeed` — `FUN_0044DB50`. The variant character type 0x19
 * takes, and the one that gives `zstin` its pace.
 *
 * The duration is the horizontal distance at a fixed **30 world units per
 * `minFrames`** — 2.0 units a frame ordinarily, 3.0 in the fast case —
 * clamped up to `minFrames`, so a short hop still takes a quarter of a second
 * and a long one is not instant. The divisor 30.0 is `0x0055CCD4`.
 *
 * **`minFrames` is 10 or 15, and the routine chooses it itself:**
 *
 * ```
 * 0044dbaa  TEST EAX, 0x2000000    a900000002   ; EAX = obj+0x136C
 * 0044dbc9  JZ   0044dbda                       ; clear -> 15
 * 0044dbce  MOV  EDI, 0xa                       ; set   -> 10 ...
 * 0044dbd3  TEST EAX, 0x44000000   a900000044   ; ... EAX = obj+0x34
 * 0044dbd8  JZ   0044dbdf                       ;     unless dead or reacting
 * 0044dbda  MOV  EDI, 0xf                       ;     -> 15
 * ```
 *
 * `[proved]`. `ThrowerShotFeedback` (`FUN_00449B20`) raises
 * {@link ThrowerFlag.LowSphere} as half of `OR EDX, 0x6000000` on the head
 * shot that knocks a thrower down, so a live knocked-down thrower takes the
 * **10**-frame branch -- 3 units of travel a frame rather than 2. Class 0x30's
 * `ZombieFlag2.LowSphere` is the same bit of the same word, so the one test
 * serves both classes' callers. The test used to be a `fast` argument that no
 * caller passed, with the fall's knockback carrying its own copy of the
 * routine to get the 10 (`L11`: the test belongs to this function).
 *
 * The divisor is a `FILD`/`FDIVR` pair the decompiler drops entirely --
 * `FILD [ESP+0xc]` (`db44240c`) then `FDIVR [0x0055ccd4]` (`d83dd4cc5500`)
 * at 0x0044DBE3.
 */
export function ActorArcBeginToAtSpeed(obj: Actor, dest: Vec3): void {
  const min = (obj.flags2 & ThrowerFlag.LowSphere)
              && !(obj.flags & (ActorFlag.Dead | ActorFlag.Reacting))
    ? ARC_MIN_FRAMES_FAST : ARC_MIN_FRAMES;
  const n = Math.trunc(dist2d(obj.pos, dest) / (ARC_SPEED_UNITS / min));
  ActorArcBegin(obj, dest, Math.max(min, n));
}

/**
 * `InstallArcMotionScript` — `FUN_0044DA60`.
 *
 * The engine copies the twelve dwords into `g_arc_scripts[obj+0x3C]`, one slot
 * per enemy slot. It copies rather than points, so the script is per-actor
 * state; the port keeps it on the actor, which is what puts it in a snapshot.
 */
export function InstallArcMotionScript(obj: Actor,
                                       script: ArcStage[] | null): void {
  // The engine copies the twelve dwords, and the copy matters: the timing fit
  // below **rewrites** them. Pointing at the bundle's own array instead would
  // have the first leap of the stage permanently re-time every later one.
  obj.arcScript = script && script.length
    ? script.map((st) => ({ ...st })) : null;
}

/**
 * `FitArcScriptByFadeLength` — `FUN_0044D5F0`. The timing fit every
 * character type but 0x19 takes.
 *
 * The script is authored against one clip; the arc it is laid over is however
 * long the distance made it. This reconciles them by **growing the fades** of
 * stages 1 and 2, and a fade is a hold (`ActorSetOneShotBlended`), so a long
 * leap holds the flight pose through the air rather than playing it slowly.
 * `[proved]` from the listing, `0x0044D5F0`..`0x0044D77C`:
 *
 * ```
 * slack = s1.start - s1.until + T                    ; 0044d606..d614
 * slack == 0  ->  nothing
 * slack >  0  ->  while (s1.fade + s2.fade < slack)  ; 0044d638
 *                   s1.fade++, s2.fade++
 *                 if (slack < s1.fade + s2.fade) s1.fade--   ; 0044d68f
 *                 each fade clamped at 0x7F                  ; 0044d6af, d6cf
 * slack <  0  ->  s1.fade = s2.fade = 1                      ; 0044d6f1, d700
 *                 until (s1.fade + s2.fade - s1.start + s1.until <= T
 *                        and s1.until - s1.start <= 1):
 *                   s1.start++, s1.until--                   ; 0044d735
 *                 if (s1.until - s1.start < 1) s1.start--    ; 0044d772
 * ```
 *
 * `ActorArcStep` passes the step as a second argument (`PUSH EDI; PUSH ESI` at
 * `0x0044D8D2`); the routine reads only the first.
 *
 * This used to be one function for both routines, with the zstin routine's
 * slack -- which subtracts both fades -- and its halved `k` applied to every
 * type, and the tight branch replaced by a closed form. The sums agree when
 * both slacks are positive, but the odd frame went to stage 1's fade where
 * the engine gives it to stage 2's (the rooftop route's first leg, `T = 19`:
 * 6 and 5 against the engine's 5 and 6), a slack the authored fades already
 * covered took the tight branch where the engine at most takes one frame off
 * stage 1's fade, and the tight branch did not reset both fades to 1.
 */
export function FitArcScriptByFadeLength(obj: Actor): void {
  const s = obj.arcScript;
  if (!s || s.length < 3) return;
  const T = obj.arcTotal;
  const slack = s[1].start - s[1].until + T;
  if (slack === 0) return;
  if (slack > 0) {
    while (s[1].fade + s[2].fade < slack) {
      s[1].fade++;
      s[2].fade++;
    }
    if (slack < s[1].fade + s[2].fade) s[1].fade--;
    if (s[1].fade > FADE_MAX) s[1].fade = FADE_MAX;
    if (s[2].fade > FADE_MAX) s[2].fade = FADE_MAX;
    return;
  }
  s[1].fade = 1;
  s[2].fade = 1;
  while (s[2].fade + s[1].fade - s[1].start + s[1].until > T
         || s[1].until - s[1].start > 1) {
    s[1].start++;
    s[1].until--;
  }
  if (s[1].until - s[1].start < 1) s[1].start--;
}

/**
 * `FitArcScriptByStartFrame` — `FUN_0044E140`. Character type 0x19's fit,
 * which gives the other end: a short leap **skips into the middle** of its
 * clip rather than holding it. `[proved]`, `0x0044E140`..`0x0044E293`:
 *
 * ```
 * slack = T - s2.fade - s1.fade - s1.until + s1.start   ; 0044e170..e17a
 * k     = __ftol(|slack * 0.5|)                         ; 0044e186..e1a1
 * slack >  0  ->  s1.fade += k; s2.fade += k
 *                 rest = slack - s2.fade - s1.fade; if (rest > 0) s1.fade += rest
 * slack <= 0  ->  s1.start = min(s1.start + k, s1.until)
 *                 s2.start = min(s2.start + k, s2.until)
 *                 rest = |slack| - s2.start - s1.start
 *                 if (rest > 0) s1.start = min(s1.start + rest, s1.until)
 * ```
 *
 * The 0.5 is `float ptr [0x004C43AC]` = `0x3F000000` and the sign flip
 * `[0x004C4C64]` = `-1.0`; Ghidra drops both, because they feed `__ftol`.
 * Unlike {@link FitArcScriptByFadeLength} **nothing here clamps a fade**.
 */
export function FitArcScriptByStartFrame(obj: Actor): void {
  const s = obj.arcScript;
  if (!s || s.length < 3) return;
  const T = obj.arcTotal;
  const slack = T - s[2].fade - s[1].fade - s[1].until + s[1].start;
  const k = Math.trunc(Math.abs(slack * 0.5));
  if (slack > 0) {
    s[1].fade += k;
    s[2].fade += k;
    const rest = slack - s[2].fade - s[1].fade;
    if (rest > 0) s[1].fade += rest;
    return;
  }
  s[1].start = Math.min(s[1].until, s[1].start + k);
  s[2].start = Math.min(s[2].until, s[2].start + k);
  const rest = -slack - s[2].start - s[1].start;
  if (rest > 0) s[1].start = Math.min(s[1].until, s[1].start + rest);
}

/**
 * `CMP EDX, 0x7f` / `MOV dword ptr [EAX], 0x7f` at `0x0044D6AF` and
 * `0x0044D6CF`: `FitArcScriptByFadeLength`'s ceiling on both fades.
 */
const FADE_MAX = 0x7f;
/** The character type that takes `FitArcScriptByStartFrame`. */
const CHAR_ZSTIN = 0x19;

/**
 * `&DAT_007DCC70` -- the address `ThrowerStateLeapDown` passes
 * `ActorArcBeginToWaypoint` for its script (`PUSH 0x7dcc70` at `0x0044B6A6`),
 * and the one the routine compares against (`CMP EAX, 0x7dcc70` at
 * `0x0044D7E0`). Those are its only two references. It is not read as a
 * script: the compare sends the routine to its own attack draw instead.
 *
 * A symbol and not `null`, because `null` already means something else in the
 * port -- a named script the bundle does not carry -- and the two must not
 * meet: a missing path script taking this arm would roll an attack.
 */
export const ARC_SCRIPT_DRAW_ATTACK: unique symbol =
  Symbol("&DAT_007DCC70");

/**
 * `ActorArcBeginToWaypoint` — `FUN_0044D780`.
 *
 * Begins the arc and installs a script in one call. Character type 0x19
 * takes `ActorArcBeginToAtSpeed` and ignores `step` entirely; everything else
 * takes `ActorArcBeginTo`. `[proved]`, the whole routine:
 *
 * ```
 * 0044d785  type == 0x19 ? ActorArcBeginToAtSpeed(obj+0x40.., dest..)
 *                        : ActorArcBeginTo(obj+0x40.., dest.., step)
 * 0044d7e0  if (script != &DAT_007DCC70) {
 *             InstallArcMotionScript(script); obj+0x1360 = 0; return }
 * 0044d7fc  obj+0x131A = g_class31_attack_picks[obj+0x130C]
 *                          [(rand() >> 4) % 10 + (obj+0x1318 & 7) * 10]
 * 0044d839  if (type == 0x18) obj+0x131A = 3
 * 0044d843  ThrowerLoadAttackArcScript(obj); obj+0x1360 = 0
 * ```
 *
 * **The draw is this routine's, and it is taken for `zslman` too**, which
 * then overwrites it with 3: the `rand()` still moves the stream. The port
 * used to hand the draw back to the caller as a callback, and
 * `ThrowerStateLeapDown`'s skipped it for type 0x18.
 *
 * `rng` is `rand()`, and only the draw arm reads it; the overloads make the
 * one caller that takes that arm pass it.
 */
export function ActorArcBeginToWaypoint(
  obj: ThrowerActor, dest: Vec3, script: typeof ARC_SCRIPT_DRAW_ATTACK,
  step: number, rng: Rng): void;
export function ActorArcBeginToWaypoint(
  obj: ThrowerActor, dest: Vec3, script: ArcStage[] | null,
  step: number): void;
export function ActorArcBeginToWaypoint(
  obj: ThrowerActor, dest: Vec3,
  script: ArcStage[] | null | typeof ARC_SCRIPT_DRAW_ATTACK,
  step: number, rng?: Rng): void {
  if (obj.charType === CHAR_ZSTIN) ActorArcBeginToAtSpeed(obj, dest);
  else ActorArcBeginTo(obj, dest, step);
  if (script !== ARC_SCRIPT_DRAW_ATTACK) {
    InstallArcMotionScript(obj, script);
    obj.arcPhase = ArcPhase.Windup;
    return;
  }
  // `CALL rand; SAR EAX, 4; CDQ; IDIV 10` -- `Rng.int` is the port's `% n`,
  // and the shift before it changes which value comes up, not how many draws.
  obj.attack = ThrowerPickAttack(obj, (rng as Rng).int(10));
  if (obj.charType === CHAR_ZSLMAN) obj.attack = ZSLMAN_ATTACK;
  ThrowerLoadAttackArcScript(obj);
  obj.arcPhase = ArcPhase.Windup;
}

/** `CMP word ptr [ESI + 0x1f4], 0x18` at `0x0044D815`. */
const CHAR_ZSLMAN = 0x18;
/** `MOV byte ptr [ESI + 0x131a], 0x3` at `0x0044D83B`. */
const ZSLMAN_ATTACK = 3;

/**
 * `ActorArcInterpolate` — `FUN_0044DD00`. The position at frame *n*, exactly.
 *
 * ```
 * x = src.x + (dst.x - src.x) / T * n
 * z = src.z + (dst.z - src.z) / T * n
 * y = src.y + (T*T*g2 + 2*dy) * n / (2T)  -  g2 * n * n * 0.5
 * ```
 *
 * Flat on x and z, a parabola on y that arrives exactly on time. Returns false
 * once the arc is over, which is how the leap states know they have landed.
 *
 * `[proved]` from the listing, `0x0044DD00`..`0x0044DDD2`: the test is
 * `CMP EDX, EDI` with `EDI = T + step`, the position is taken at `n` and the
 * counter then advanced **by `step`**, not by one (`ADD EDX, ESI` at
 * `0x0044DD85`). `g2` is `float ptr [0x00565E1C]` = `0x3CDF0123` and the 0.5
 * `[0x004C43AC]`, both re-read in the listing because the pseudocode folds
 * them (`L1`).
 */
export function ActorArcInterpolate(obj: Actor, step: number): boolean {
  const T = obj.arcTotal;
  const n = obj.arcFrames;
  if (n >= T + step) return false;
  const dy = obj.arcTo.y - obj.arcFrom.y;
  obj.pos.x = obj.arcFrom.x + ((obj.arcTo.x - obj.arcFrom.x) / T) * n;
  obj.pos.z = obj.arcFrom.z + ((obj.arcTo.z - obj.arcFrom.z) / T) * n;
  obj.pos.y = obj.arcFrom.y
            + ((T * T * ARC_GRAVITY_HALF + dy + dy) * n) / (T * 2)
            - n * n * ARC_GRAVITY_HALF * 0.5;
  obj.arcFrames = n + step;
  return true;
}

/**
 * `ActorArcVelocityY` — `FUN_0044DDE0`. One frame of the shared arc, as a
 * velocity, with the parabola on **y**: the same arc as the interpolation
 * above, for the states that integrate rather than interpolate.
 *
 * `vel.y = -g2*n + (T*T*g2 + 2*dy) / (2*T)` is the derivative of that
 * routine's y term, which is why the two agree. It is `ActorArcVelocity`'s
 * (`FUN_0044DE80`) case 0 with the axis selector taken out -- the same closed
 * form, the same `obj+0x1330` advance, the same `false` once `obj+0x1330` has
 * reached `obj+0x1334`. Its only two callers are `ThrowerStateFallAndLand`
 * (0x0044A561) and `ZombieStateDeathKnockbackArc` (0x0045534C); both classes
 * share the arc record, so it lives here beside the rest of it.
 *
 * The velocity is computed for the frame *after* the advance -- `iVar1 = t + 1`
 * at 0x0044DDF6 -- while the test that ends the arc uses the frame before it.
 * Nothing integrates here: the class's update adds `vel` to `pos` after the
 * state runs, which is where the flight actually happens.
 *
 * The class-0x31 fall used to call a one-axis copy of `FUN_0044DE80` instead,
 * which read the velocity at `t` rather than `t + 1` and left the advance to
 * its caller: every knockback rode an arc one frame of gravity higher than the
 * engine's, and the copy had no caller once the fall was put right.
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
 * `ClearCurrentActorVelocityAndAccel` — `FUN_0044E120`. Acceleration first
 * (`obj+0x58/5C/60`), then velocity (`obj+0x4C/50/54`).
 *
 * Eighteen call sites across classes 0x30 and 0x31, and it sits in the image
 * between the arc routines above and the class-0x31 states, so it lives with
 * the arc record here. The thrower's fall and stumble used to clear the
 * velocity and `obj+0x5C` by hand, which left `obj+0x58` and `obj+0x60`
 * standing: harmless only while nothing else wrote them.
 */
export function ClearCurrentActorVelocityAndAccel(obj: Actor): void {
  obj.accX = obj.accY = obj.accZ = 0;
  obj.vel.x = obj.vel.y = obj.vel.z = 0;
}

/** `ActorArcStep`'s five phases, at `obj+0x1360`. */
export enum ArcPhase {
  /** Play stage 0 and hold: the windup happens on the spot. */
  Windup = 0,
  /** Stage 0 is running; the actor has not left the ground. */
  Crouched = 1,
  /** Stage 1, and the flight. */
  Flight = 2,
  /** Stage 2, and the rest of the flight. */
  Landing = 3,
  /** Down. Waiting for the clip to finish. */
  Settled = 4,
}

/**
 * `obj+0x19C` — the clip's frame counter, **at the engine's 60 Hz**, or -1
 * when no one-shot is running.
 *
 * This is the unit every threshold in this class is written in: the attack
 * entries' hit frames, the arc script's stage thresholds, and the clip lengths
 * in `g_motion_play_length`. `mot/` is authored at 30 Hz, so the baked clip's
 * own frame index is half of it — reading the baked index here is why the
 * pounce never connected: attack 0's hit frame is 62 and clip 303 bakes to 34
 * keys, so the test could never come true.
 */
export function ActorClipFrame(obj: Actor): number {
  return obj.action ? obj.action.ticks : -1;
}

/** ...and the same clip's length, in the same units. */
export function ActorClipLength(obj: Actor, motion: number): number {
  const m = MotionOf(obj, motion);
  return m ? (m.frames / Math.max(1, m.fps)) * GAME_HZ : 0;
}

/**
 * `obj+0x19C` whichever clip is on the track: the one-shot's cursor while one
 * runs, the base motion's otherwise.
 *
 * `[port-only]` The engine has one track and one cursor, so a routine that
 * reads `obj+0x19C` gets whatever was last set on it. The port keeps the arc's
 * stages on `obj.action` and everything else on the base motion, so where a
 * routine reads the cursor across that boundary -- `ThrowerStateDelayedPounce`
 * does, on the frame its wait clip hands to the arc -- this is the one field
 * the engine would have read. {@link ActorClipFrame} is the reading for a
 * routine that only ever sees its own one-shot.
 */
export function ActorPlayCursor(obj: Actor): number {
  return obj.action ? obj.action.ticks : MotionPlayFrame(obj);
}

/**
 * `obj+0x1B4` -- the motion on the track, for the same reason and on the same
 * terms as {@link ActorPlayCursor}: the one-shot's while one runs, the base
 * clip's otherwise. `g_motion_play_length[obj+0x1B4]` is how long the clip
 * whose cursor that is runs.
 *
 * `[port-only]`, a lookup: the engine reads the word.
 */
export function ActorPlayMotion(obj: Actor): number {
  return obj.action ? obj.action.motion : obj.motion;
}

/**
 * One stage of the script onto the clip: `ActorSetMotionBlended(obj+0x194,
 * stage.motion, stage.start, stage.fade)`, on the channel the port keeps the
 * arc on -- see {@link ActorSetOneShotBlended} for what the call does to the
 * cursor, which is the whole reason it is not a plain assignment.
 *
 * `[port-only]` A stage whose clip the bundle does not carry is skipped,
 * leaving the stage before it playing; the engine loads every clip it names.
 */
function playStage(obj: Actor, stage: ArcStage | undefined): void {
  if (!stage || stage.motion <= 0) return;
  if (!MotionOf(obj, stage.motion)) return;
  ActorSetOneShotBlended(obj, stage.motion, stage.start, stage.fade);
}

/**
 * `(short)obj+0x1F4` in `0x16..0x19` -- `CMP EAX, 0x16 / JL` then
 * `CMP EAX, 0x19 / JG`, three times over in `ActorArcStep`: the four class-0x31
 * character types (`zsass`, `zskamere`, `zslman`, `zstin`), whose arcs raise
 * and drop the flags below. The routine is shared with class 0x30, whose
 * types fall outside the range.
 */
function ArcTypeTakesFlags(obj: Actor): boolean {
  return obj.charType >= 0x16 && obj.charType <= 0x19;
}

/**
 * `ActorArcStep` — `FUN_0044D860`. One frame of an arc, script and all.
 * Returns false once the whole thing — flight *and* clip — is over.
 *
 * `[proved]` from the listing. The phase at `obj+0x1360` is a five-way jump
 * table (`0x0044DA4C`) whose arms **fall into each other** -- each ends by
 * incrementing `obj+0x1360` and runs straight on into the next -- so a stage
 * whose start is already past its threshold hands on in the same frame:
 *
 * ```
 * 0  0044d886  type 0x16..0x19 and state != 10 (the leap aside):
 *                if (obj+0x34 & 0x100) obj+0x136C |= 0x200; obj+0x34 |= 0x100
 *    0044d8c1  type 0x19 ? FitArcScriptByStartFrame : FitArcScriptByFadeLength
 *    0044d901  ActorSetMotionBlended(obj+0x194, stage 0)      ; phase 1, on
 * 1  0044d925  if (obj+0x19C < stage0.until) return 1
 *    0044d94d  ActorSetMotionBlended(obj+0x194, stage 1)
 *    0044d95c  type 0x16..0x19: if (!(obj+0x136C & 0x200)) obj+0x34 &= ~0x100
 *                               obj+0x136C &= ~0x200            ; phase 2, on
 * 2  0044d98a  ActorArcInterpolate(step)             ; its result is ignored
 *    0044d9a1  if (obj+0x19C < stage1.until) return 1
 *    0044d9c9  ActorSetMotionBlended(obj+0x194, stage 2)
 *    0044d9dd  obj+0x1330 -= step                               ; phase 3, on
 * 3  0044d9ed  if (ActorArcInterpolate(step) == 1) return 1
 *    0044d9fc  ThrowerEmitGroundDust(0x50)                      ; phase 4, on
 * 4  0044da20  if (obj+0x19C < stage2.until) return 1
 *    0044da39  type 0x16..0x19: obj+0x136C |= 0x180000
 *    0044da43  return 0
 * ```
 *
 * **The windup cannot be shot.** Phase 0 raises `obj+0x34` bit `0x100`, which
 * makes `ThrowerShotFeedback` force every hit to a ricochet, and the takeoff
 * drops it again -- unless it was already up, which `obj+0x136C` bit `0x200`
 * remembers, so a state that holds it for its own reasons (the leap to a
 * point) keeps it. The leap aside does not raise it, but its takeoff still
 * drops it.
 *
 * **Phase 2 flies whether or not the arc is over.** `ActorArcInterpolate` only
 * refuses to move once the frame count passes the duration, so an arc that
 * lands before the clip reaches stage 1's threshold waits there for the clip,
 * and the landing clip still plays. `obj+0x1330 -= step` then gives back the
 * frame phase 2 just flew, because phase 3 flies it again on the same frame.
 *
 * The step is per frame, and the port's `dt` may be several:
 * `SecondsToTicks(dt) * step` stands in for the engine's calls one frame at a
 * time.
 *
 * **The landing is where the dust goes up**: `ThrowerEmitGroundDust(0x50)`
 * (`FUN_0044D260`) for every class, which answers only a leaping thrower and
 * then runs `zsass`'s trail. `host` and `events` are what its sprites need to
 * face the camera and to make their sound; the arc itself reads neither.
 */
export function ActorArcStep(obj: Actor, step: number, dt: number,
                             host?: GameHost, events?: Events): boolean {
  const script = obj.arcScript;
  // `[port-only]` The engine's slot always holds twelve dwords, zeros for the
  // `&DAT_007DCC70` sentinel; the port's is null when the bundle has none.
  if (!script || script.length < 3) return false;
  const frames = SecondsToTicks(dt) * step;

  if (obj.arcPhase === ArcPhase.Windup) {
    if (ArcTypeTakesFlags(obj) && obj.state !== ThrowerState.LeapAside) {
      if (obj.flags & ActorFlag.ShotImmune) {
        obj.flags2 |= ThrowerFlag.ArcSuppressedShotImmune;
      }
      obj.flags |= ActorFlag.ShotImmune;
    }
    // The fit runs *before* the first stage plays, so the windup, the flight
    // and the landing span the leap however long the distance made it.
    // `CMP CX, 0x19` at `0x0044D8C1`, `CX` being the character type.
    if (obj.charType === CHAR_ZSTIN) FitArcScriptByStartFrame(obj);
    else FitArcScriptByFadeLength(obj);
    playStage(obj, script[0]);
    obj.arcPhase = ArcPhase.Crouched;
  }
  if (obj.arcPhase === ArcPhase.Crouched) {
    if (ActorClipFrame(obj) < script[0].until) return true;
    playStage(obj, script[1]);
    if (ArcTypeTakesFlags(obj)) {
      if (!(obj.flags2 & ThrowerFlag.ArcSuppressedShotImmune)) {
        obj.flags &= ~ActorFlag.ShotImmune;
      }
      obj.flags2 &= ~ThrowerFlag.ArcSuppressedShotImmune;
    }
    obj.arcPhase = ArcPhase.Flight;
  }
  if (obj.arcPhase === ArcPhase.Flight) {
    ActorArcInterpolate(obj, frames);
    if (ActorClipFrame(obj) < script[1].until) return true;
    playStage(obj, script[2]);
    obj.arcFrames -= frames;
    obj.arcPhase = ArcPhase.Landing;
  }
  if (obj.arcPhase === ArcPhase.Landing) {
    if (ActorArcInterpolate(obj, frames)) return true;
    // `[port-only]` Onto the point the arc named. A one-frame step's last
    // flight frame is that point already; a `dt` of several frames can step
    // past it, and the parabola keeps falling.
    obj.pos.x = obj.arcTo.x;
    obj.pos.y = obj.arcTo.y;
    obj.pos.z = obj.arcTo.z;
    // `0x0044D9FC`. After the snap rather than before it, so that the puff
    // and the trail point are where a one-frame step would have left the
    // actor -- the engine's own position here -- whatever `dt` was.
    ThrowerEmitGroundDust(obj, GroundDustCode.ArcLanding, host, events);
    obj.arcPhase = ArcPhase.Settled;
  }
  if (obj.arcPhase === ArcPhase.Settled) {
    // `[port-only]` `obj.action !== null`: the port's channel ends a one-shot
    // at twice its authored frame count, past `g_motion_play_length + 1` where
    // the engine's cursor wraps, so a threshold the clip never reaches -- or a
    // stage the bundle has no clip for -- cannot park the actor here. No
    // shipped script names one (`web/tools/checks/combat.ts` check 16), so on real data
    // this is the engine's own test.
    if (obj.action !== null && ActorClipFrame(obj) < script[2].until) {
      return true;
    }
    if (ArcTypeTakesFlags(obj)) obj.flags2 |= ThrowerFlag.Collide;
    return false;
  }
  // `JA 0x0044da45` with `EBX = 1`: a phase past 4 does nothing and reports
  // the arc still running.
  return true;
}

/**
 * `MatrixTranslate(p); MatrixRotateY(yaw); MatrixTransformPoint(x, y, z)`.
 *
 * A yaw of `t` is the direction `(sin t, 0, cos t)` — the same convention
 * `VecToAngles` inverts — so `(0, 0, d)` is `d` units *forward*.
 */
export function ActorLocalPoint(p: Vec3, yaw: number, x: number, y: number,
                                z: number, out: Vec3): Vec3 {
  const a = (yaw * Math.PI * 2) / 65536;
  const c = Math.cos(a), s = Math.sin(a);
  out.x = p.x + x * c + z * s;
  out.y = p.y + y;
  out.z = p.z - x * s + z * c;
  return out;
}

/**
 * `MatrixTranslate(p); MatrixRotateX(rx); MatrixRotateY(ry); TransformPoint(v)`.
 *
 * The stack post-multiplies, so the composed transform is `T · Rx · Ry` and
 * **Y applies first**. Only the surface probes need the pitch; everything else
 * in the class uses `ActorLocalPoint`.
 */
export function ActorLocalPointPitched(p: Vec3, rx: number, ry: number,
                                       x: number, y: number, z: number,
                                       out: Vec3): Vec3 {
  const b = (ry * Math.PI * 2) / 65536;
  const cb = Math.cos(b), sb = Math.sin(b);
  const px = x * cb + z * sb;
  const py = y;
  const pz = -x * sb + z * cb;
  const a = (rx * Math.PI * 2) / 65536;
  const ca = Math.cos(a), sa = Math.sin(a);
  out.x = p.x + px;
  out.y = p.y + py * ca - pz * sa;
  out.z = p.z + py * sa + pz * ca;
  return out;
}

/** A scratch destination, so the arc helpers allocate nothing per frame. */
export const arcScratch: Vec3 = vec3();
