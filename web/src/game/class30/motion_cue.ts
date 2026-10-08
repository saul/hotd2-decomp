/**
 * `ZombieSetMotionIfIdle` — `FUN_00454770`.
 *
 * Start a motion unless it is already playing -- and not over a stumble:
 *
 * ```
 * 0045477b  TEST DH, 0x20 / JNZ ret          ; obj+0x136C: a cut reaction holds
 * 00454785  CMP [obj+0x1b4], motion / JZ ret ; already playing
 * 00454790  TEST DH, 0x10                    ; a reaction on the overlay?
 * 004547a6  CALL ActorSetMotionBlendedUnderOverlay   ; yes: the legs only
 * 004547b5  CALL ActorSetMotionBlended               ; no
 * ```
 *
 * with this routine's own four arguments either way. The port called neither
 * and had neither test, so a stumble on the overlay ran on regardless and a
 * leg-hit clip on the base track was replaced by the next state's idle on the
 * frame after it started. `ActorPlayHitReaction` sets the two bits and
 * `ZombieClearHitReactionWhenDone` takes them down.
 *
 * **The start frame is random**, and that is not a detail. Every caller passes
 * one: `ZombieStateApproach` and `ZombieStateAttackRun` pass
 * `rand() % clip_length`, and `ZombieStateHoldAtRange`, `ZombieStateBackOff`
 * and `ZombieStateWaitTurn` pass `rand() % 5`. Starting every actor at frame
 * zero, as this did, makes a crowd move in lockstep — two zombies given the
 * same order at the same moment take exactly the same steps at exactly the
 * same time, which is the one thing a crowd of shambling corpses never does.
 *
 * **The draw is a play cursor**, because it goes straight into
 * `ActorSetMotionBlended`'s start (`0x004547B5`, the third argument passed
 * through). "`clip_length`" is `g_motion_play_length[motion]` -- `MOVSX ECX,
 * word ptr [EDI*2 + 0x4E07D0]` / `CDQ` / `IDIV ECX` / `PUSH EDX` at
 * `0x00457A07` (`ZombieStateApproach`), `0x0045550C` (`ZombieStateAttackRun`)
 * and every other `"clip"` caller -- so the start is any cursor from 0 to one
 * short of the play length, odd ones included. This drew an authored frame
 * and doubled it, which reached only even cursors, and the spreads of 5 and
 * 10 twice as far in as the exe's.
 */
import type { Rng } from "../../core/rng";
import { ZombieFlag2, type Actor } from "../actor";
import { MotionOf, MotionPlayLength } from "../tables";
import { MotionFade } from "./states";
import { SkeletonModelSetMotion, SkeletonModelSetMotionBlended }
  from "../skeleton";

export function ZombieSetMotionIfIdle(obj: Actor, motion: number | undefined,
                                     rng: Rng, spread: number | "clip",
                                     fade: MotionFade = MotionFade.Normal): void {
  if (motion === undefined) return;
  const m = MotionOf(obj, motion);
  if (!m) return;
  // A one-shot the state machine started -- a strike, a lunge -- owns the
  // actor until it ends, and the reaction runs on its own track.
  if (obj.action) return;
  if (obj.flags2 & ZombieFlag2.HitClipBase) return;
  if (obj.motion === motion) return;
  const start = rng.int(spread === "clip"
    ? MotionPlayLength(obj, motion) : spread);
  if (obj.flags2 & ZombieFlag2.HitClipOverlay) {
    ActorSetMotionBlendedUnderOverlay(obj, motion, start, fade);
    return;
  }
  ActorSetMotionBlended(obj, motion, start, fade);
}

/**
 * `ActorSetMotion` — `FUN_00411930`. Start a clip at frame zero, no fade.
 *
 * The other half of the pair: `ActorSetMotionBlended` (`FUN_004119A0`) takes a
 * fade length and this one does not, and the annotation on that address says
 * which is used where — this is the one for **the scripted cues that are meant
 * to cut**. It clears the track outright, `track[0]`, `track[2]`, `track[4]`
 * and `track[6]` together with the two fade bytes at `+0x36`/`+0x37`, so there
 * is nothing left of the outgoing clip to blend from.
 */
export function ActorSetMotion(obj: Actor, motion: number): void {
  // An actor that carries the engine's own model block gets the engine's own
  // body -- see `game/skeleton.ts`. Class 0x14 is the only one today.
  if (obj.skel) {
    SkeletonModelSetMotion(obj, obj.skel, motion);
    return;
  }
  // The cut takes the swing with it — see {@link ActorEndOneShot}. This one
  // leaves nothing to blend from, so the swing is dropped rather than faded.
  obj.action = null;
  obj.rootActionCursor = -1;
  // `model+0x36 = 0; SkeletonAssignSubtreeTrack(0, 0)` (`0x00411950`..): the
  // whole skeleton back on track 0, so a stumble on the overlay ends here.
  obj.react = null;
  obj.motion = motion;
  obj.playTicks = 0;
  obj.fadeFrom = null;
  obj.fadeInto = null;
  obj.fade = 0;
  obj.fadeLen = 0;
  obj.rootCursor = -1;
}

/**
 * **There is only one track**, and this is what that costs the port.
 *
 * `ZombieStateStrike` (`FUN_00455A40`) plays its lunge and its swing on the
 * actor's *ordinary* motion:
 *
 * ```
 * 00455b3d  6a0a 6a00              PUSH 0xa ; PUSH 0x0         ; fade, start
 * 00455b49  e8e276ffff             SetCurrentActorMotionBlended(obj+0x194,
 *                                    entry->lunge, 0, 10)
 * 00455b57  6a05 6a00              PUSH 0x5 ; PUSH 0x0
 * 00455b63  e838befbff             FUN_004119A0(obj+0x194, entry->strike, 0, 5)
 * 00455c02  0fbf144dd0074e00       MOVSX EDX, [g_motion_play_length + 0x1B4*2]
 * ```
 *
 * — `obj+0x1B4` and the play cursor at `obj+0x19C`, the same pair every other
 * state reads. The port gives the swing a channel of its own (`obj.action`,
 * `[port-only]`) because the poser needs it at full weight while the walk
 * keeps its clock; the engine needs no such thing, because writing the motion
 * **is** ending the swing. The lunge is not on that channel: it is an
 * ordinary motion to the engine, and the port plays it as one, through
 * {@link SetCurrentActorMotionBlended}.
 *
 * (This listing used to put the lunge's call at `0x00455B54`, which is the
 * strike branch's first instruction, and the strike's at `0x00455B8A`, which
 * is the `ActorPlayHitVoice` call after it.)
 *
 * So both primitives that write that track end the one-shot, which is the
 * whole of **B5**: `ZombieOnShot` (`FUN_00453EB0`) sets state 6 on the frame
 * the actor dies, `ZombieStateDeath6` calls `ChooseDeathMotion`, and in the
 * engine the death clip lands on top of the swing. Without this the port left
 * `obj.action` running, `render/characters/pose.ts` kept posing the strike
 * over the death state, and the actor finished its swing and only then fell —
 * which is exactly what was reported.
 *
 * The fade is out of **what is on screen**, which while a one-shot runs is the
 * one-shot and not `obj.motion`: that is `ZombieStateStrike`'s own `endStrike`
 * reasoning, and it is here so that every caller gets it.
 */
function ActorEndOneShot(obj: Actor, fade: number): void {
  const act = obj.action;
  if (!act) return;
  obj.action = null;
  obj.rootActionCursor = -1;
  ActorStartFade(obj, act.motion, act.ticks, fade);
}

/**
 * `ActorSetMotionBlended` — `FUN_004119A0`. Start a clip at a play cursor,
 * over a cross-fade.
 *
 * The engine's own primitive, and the one the whole captor-script family calls
 * — a script entry is `{motion, frame, loops, mode}`, and its frame is a
 * literal, not a random spread. `ZombieSetMotionIfIdle` above is the *other*
 * caller shape: the one that draws the start frame, because a crowd must not
 * move in lockstep.
 *
 * **`start` is a play cursor, as the engine takes it:**
 *
 * ```
 * 004119a4  MOV EAX, [ESP+0xC]        ; start
 * 004119ad  MOV [ECX+0x8], EAX        ; track[2] = start      -- obj+0x19C
 * 004119b2  CDQ / SUB EAX, EDX / SAR EAX, 1
 * 004119bb  MOV [ECX+0x18], EAX       ; track[6] = start / 2  -- authored
 * ```
 *
 * and `MotionStartOnTrack` (`FUN_004119F0`) picks the pose it loads by the
 * start's parity and reads the authored frame from `track[6]`. Nothing in the
 * routine converts, and no caller does either: of its 367 call sites (352
 * direct -- Ghidra's xref list stops at 332 -- 9 through
 * `SetCurrentActorMotionBlended` and 6 through `ZombieSetMotionIfIdle`, a byte
 * scan for `E8` with each start `PUSH` walked back to its source) every one
 * pushes a value in that unit -- a literal (288 of them 0; 5, 8, 10, 12, 15,
 * 17, 25, 26, 30, 35 and 61 elsewhere), `rand() % 5`, `rand() % 10`,
 * `rand() % g_motion_play_length[m]`, a script's start word,
 * `g_motion_play_length[m] - 1`, a table word, or a cursor another routine
 * computed. This took an authored frame and doubled it for as long as it
 * existed, so every nonzero start in class 0x30's scripts landed twice as far
 * in -- the bin captor's burst (967 from 33) began at 66, past its own
 * flag-34 cue at 63 -- and six callers had worked round it: four halved the
 * exe's word on the way in, two called with 0 and wrote the cursor after.
 *
 * Not clamped: class 0x25's `op 3` passes `-1` in eighteen shipped commands,
 * which holds the cursor at -1 for the fade and so plays the clip from 0 when
 * it lets go (`track[0] = track[2] + 1`).
 */
export function ActorSetMotionBlended(obj: Actor, motion: number,
                                      start: number, fade: number): void {
  // The model block's arm: that block keeps the engine's cursor, counter and
  // fade bytes. See `SkeletonModelSetMotionBlended`.
  if (obj.skel) {
    SkeletonModelSetMotionBlended(obj, obj.skel, motion, start, fade);
    return;
  }
  const m = MotionOf(obj, motion);
  if (!m) return;
  // `MotionStartOnTrack(model, 0, motion, 0)` writes `model+0x36 = 0` and
  // puts the whole skeleton back on track 0 (`SkeletonAssignSubtreeTrack(0,
  // 0)`), so a stumble on the overlay ends with any change of clip -- and so
  // does the play-out of a stumble a state never waited for.
  obj.react = null;
  BlendBaseTrack(obj, motion, start, fade);
}

/**
 * `ActorSetMotionBlendedUnderOverlay` — `FUN_00411AC0`. The same stores as
 * {@link ActorSetMotionBlended}, but `MotionStartOnTrack(model, 9, motion, 0)`
 * and `model+0x36` put back to 1 when it was 1:
 *
 * ```
 * 00411ac0  track[2] = start; track[6] = start / 2; track[10] = track[0] - 1
 *           track[8] = motion; track+0x30 = fade + 1; track+0x37 = (& 0xDF) | 1
 *           if (model+0x36 == 1) { MotionStartOnTrack(model, 9, motion, 0);
 *                                  model+0x36 = 1; return }
 *           MotionStartOnTrack(model, 9, motion, 0)
 * ```
 *
 * Only bone 9's subtree -- pelvis and legs, which never left track 0 -- is
 * handed to the new clip, and a stumble on bone 1's subtree plays on over it.
 * `ZombieSetMotionIfIdle`'s bit-0x1000 arm is its one caller.
 */
export function ActorSetMotionBlendedUnderOverlay(obj: Actor, motion: number,
                                                  start: number,
                                                  fade: number): void {
  if (!MotionOf(obj, motion)) return;
  BlendBaseTrack(obj, motion, start, fade);
}

/**
 * `[port-only]` -- the stores `ActorSetMotionBlended` and
 * `ActorSetMotionBlendedUnderOverlay` share, and `MotionStartOnTrack`'s
 * (`FUN_004119F0`) slot-A snapshot and slot-B load for track 0, in the port's
 * encoding of the base track. The two routines differ only in which subtree
 * they hand to track 0, which is the overlay's to keep or lose.
 */
function BlendBaseTrack(obj: Actor, motion: number, start: number,
                        fade: number): void {
  // One track: writing it ends whatever one-shot was on it. See
  // {@link ActorEndOneShot} — this is the edge B5 was missing.
  ActorEndOneShot(obj, fade);
  // **No same-clip test.** `ActorSetMotionBlended` (`FUN_004119A0`) has none:
  // it writes the start, the fade counters and the fade bit, and
  // `MotionStartOnTrack` (`FUN_004119F0`) snapshots the drawn pose into slot
  // A, whatever clip is on the track. A clip set over itself fades from where
  // it is to its new start like any other. The same-clip tests are the
  // callers' -- `ZombieSetMotionIfIdle` (`0x00454785`) and
  // `ThrowerStateWaitForPermit` (`0x0044B4C8`) each make one. This had one of
  // its own, so a clip re-set over itself jumped to the new start with no
  // fade at all.
  if (obj.fadeFrom && obj.fade > 0) {
    ActorRestartFade(obj, fade);
  } else {
    ActorStartFade(obj, obj.motion, obj.playTicks, fade);
  }
  obj.motion = motion;
  obj.playTicks = start;                         // `track[2] = start`
  obj.cursorStore = null;                        // ...over any store to it
  obj.rootCursor = -1;
}

/**
 * `[port-only]` — `ActorSetMotionBlended`'s (`FUN_004119A0`) body on the
 * one-shot channel, {@link Actor.action}, with `start` in the engine's own unit:
 * a **play cursor**, as the engine takes it.
 *
 * The engine has one track, and class 0x31's arc plays its three stages on it:
 * `ActorArcStep` (`FUN_0044D860`) makes the call directly, not through
 * {@link SetCurrentActorMotionBlended} -- `CALL 0x004119a0` at `0x0044D901`,
 * `0x0044D94D` and `0x0044D9C9`, each with the stage's `{motion, start, fade}`.
 * The port keeps those stages on `obj.action`, and what the call does to the
 * cursor has to come with them:
 *
 * ```
 * 004119a0  track[2] = start; track[6] = start / 2        ; obj+0x19C, outright
 *           track[10] = track[0] - 1; track+0x30 = fade + 1
 *           track+0x37 = (track+0x37 & 0xDF) | 1           ; the fade bit
 * 004111a0  while bit 0 is up the cursor is NOT recomputed from the counter;
 *           when counter - track[10] reaches fade + 2:
 *             track[0] = track[2] + 1; bit 0 down          ; plays on from start+1
 * ```
 *
 * So a routine reading `obj+0x19C` sees the start frame for the whole fade, and
 * every threshold the arc script and the attack entries name is measured
 * against that. The port's channel used to start the clip running at once, so
 * a stage change consumed its start frame unseen: `ThrowerStateDelayedPounce`'s
 * `cursor > 66` test fired first at 68, because stage 2 started at 67 on the
 * frame the cursor reached 66.
 *
 * The fade is the actor's own ({@link ActorStartFade}), out of whatever is on
 * screen -- the one-shot if one is running, as {@link ActorEndOneShot} takes
 * it, else the base clip or the fade already dissolving from it, as
 * {@link ActorSetMotionBlended} does -- and `held` has `ActorAdvanceMotion`
 * hold this clip through it rather than the base. The hold is the base
 * track's, `fade + 1` frames on the start frame counting the frame of the
 * call; see {@link ActorRestartFade}. That is the engine's count of **draws**
 * on the start frame. Its states see it once more, `fade + 2` times, because
 * `EnemyThrowerUpdate` runs the state before `ThrowerAdvanceMotion` draws --
 * and `EnemyZombieUpdate` (`FUN_004533F0`) its state at `0x00453434` before
 * `ZombieAdvanceMotion` at `0x00453457`, for the swing `ZombieStateStrike`
 * sets through this, whose hit waits `fade + 1` frames on it -- so
 * a state reads the cursor the previous frame's draw computed -- where the
 * port advances its clocks before its states. That puts every cursor a port
 * state reads one tick ahead of the engine's on every frame but the one that
 * set it, held or not; it is the port's phase, not this channel's.
 *
 * [diverges] `track+0x30` is a byte, and a fade of `0x7F` stores `0x80`: read
 * back as `s8` the hold's limit is `-127`, so the engine drops the bit on the
 * first draw and recomputes the cursor from a counter this call never reset.
 * The channel keeps no counter apart from its cursor, so this holds `0x80`
 * frames instead. Only the arc's fits can produce a fade that large --
 * `FitArcScriptByFadeLength` clamps at `0x7F`, and zstin's
 * `FitArcScriptByStartFrame` does not clamp at all, so it can go past -- and
 * either only for a leap of about 250 frames or more, which no shipped spawn
 * has been shown to make. `[open]` whether one does.
 */
export function ActorSetOneShotBlended(obj: Actor, motion: number,
                                       start: number, fade: number): void {
  const act = obj.action;
  if (act) {
    ActorStartFade(obj, act.motion, act.ticks, fade);
  } else if (obj.fadeFrom && obj.fade > 0) {
    ActorRestartFade(obj, fade);
  } else {
    ActorStartFade(obj, obj.motion, obj.playTicks, fade);
  }
  // The engine's call is `ActorSetMotionBlended`, and it ends a stumble on
  // the overlay as that one does.
  obj.react = null;
  obj.action = { motion, ticks: start, held: true };
  obj.rootActionCursor = -1;
}

/**
 * `SetCurrentActorMotionBlended` — `FUN_0044D230`. The **unconditional** one.
 *
 * A thunk: the engine's body reads its first argument, the motion block, and
 * never uses it — it always drives `DAT_009A26A0 + 0x194`, the actor the sweep
 * is on, and every caller passes `obj+0x194` anyway. Then it calls
 * `ActorSetMotionBlended` (`FUN_004119A0`) with the other three. There is no
 * "already playing" test, no reaction latch, nothing.
 *
 * **It is the only way class 0x31 ever sets a motion**, and that is the point
 * of naming it here rather than inlining the call. Nine call sites go through
 * it — `ThrowerStateFallAndLand` at `0x0044A78E`, `ThrowerStateStandAndDecide`
 * at `0x0044B29E`, `ThrowerStateWaitForPermit` at `0x0044B4E0`,
 * `ThrowerStateLeapAside` at `0x0044BB84`, `ThrowerStateGetUp` at
 * `0x0044C30F`, `ThrowerStateWalkDistance` at `0x0044E358`,
 * `ThrowerStateWithdraw` at `0x0044ECDF`, `ThrowerStateRestoreBothHands` at
 * `0x0044F98E`, and `ZombieStateStrike`'s lunge at `0x00455B49` — while
 * {@link ZombieSetMotionIfIdle}, which *does* test, has six callers and all
 * six are class 0x30.
 *
 * Class 0x31 calling class 0x30's conditional routine is what parked stage 4's
 * nine state-20 `zskamere` in the pose they were spawned holding: the hub's
 * one frame of sub 0 arrived while a one-shot was still on
 * {@link Actor.action}, the guard returned, and nothing set the walk ever
 * again. `L11` — do not move a test across a function boundary — with the
 * whole function being the wrong one.
 *
 * `start` is a start inside the clip, not a blend length, and it is a play
 * cursor, as {@link ActorSetMotionBlended} takes it: the thunk passes its
 * third argument through untouched (`0x0044D24A`).
 */
export function SetCurrentActorMotionBlended(obj: Actor, motion: number,
                                             start: number,
                                             fade: number): void {
  ActorSetMotionBlended(obj, motion, start, fade);
}

/**
 * Begin a cross-fade out of whatever is showing.
 *
 * The engine holds two motions on one track and fades between them;
 * `MotionCrossFadeTo` (`FUN_00411B70`) is the same operation for the stumble,
 * which this port already does. This is it for an ordinary motion change.
 *
 * `fromTicks` is where the outgoing clip **stops**: the engine snapshots the
 * last drawn pose into slot A (`MotionLoadPoseSlot`, `FUN_00411C20`, mode
 * 0xC) and nothing advances it, so `ActorAdvanceMotion` leaves
 * `fadeFrom.ticks` alone for the whole fade.
 */
export function ActorStartFade(obj: Actor, fromMotion: number,
                               fromTicks: number, frames: number): void {
  if (frames <= 0 || !MotionOf(obj, fromMotion)) {
    obj.fadeFrom = null;
    obj.fadeInto = null;
    obj.fade = 0;
    return;
  }
  obj.fadeFrom = { motion: fromMotion, ticks: fromTicks };
  ActorRestartFade(obj, frames);
}

/**
 * Set the fade counters, as `ActorSetMotionBlended` (`FUN_004119A0`) does.
 *
 * `[port-only]` as a function: the engine writes `track+0x30 = fade + 1` and
 * `track+0x28 = counter - 1` inline, and `SkeletonResolveTrackFrames`
 * (`FUN_00410BD0`) weighs the incoming pose by `(counter - track+0x28) /
 * track+0x30` -- `1 / (fade + 1)` on the frame of the call, one on the fade's
 * last held frame, and on the frame after that `SkeletonAdvancePlayCursor`
 * (`FUN_004111A0`) lets the clip move again.
 *
 * So the length is `fade + 1` and the count starts at `fade`, not at the
 * length: the port advances the clocks **before** the state runs, so the
 * frame of the call is drawn with the counter as it is set here, and the
 * weight the renderer takes, `1 - fade / fadeLen`, is `1 / (fade + 1)`.
 * `ActorAdvanceMotion` counts {@link Actor.fade} down and holds the incoming
 * clip until it goes below zero -- `fade + 1` frames on its start frame, as
 * the engine holds it.
 *
 * The mid-fade restart keeps the snapshot it already has -- the pose the
 * outgoing fade was dissolving from -- and only rearms the counter. Either
 * way slot B is loaded afresh, from the clip the caller is about to write, so
 * a slot B left by a store under the old fade goes ({@link Actor.fadeInto}).
 */
function ActorRestartFade(obj: Actor, frames: number): void {
  obj.fade = frames;
  obj.fadeLen = frames + 1;
  obj.fadeInto = null;
}
