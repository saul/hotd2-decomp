/**
 * The two per-frame halves of a class-0x30 stumble, which `EnemyZombieUpdate`
 * (`FUN_004533F0`) runs first thing, before `ZombieOnShot` and the state:
 * `CALL 0x004547C0` at `0x00453402`, `CALL 0x00454660` at `0x00453408`.
 *
 * `ActorPlayHitReaction` (`FUN_004544C0`) starts a stumble and raises three
 * bits: `obj+0x136C` 0x1000 for a clip on the overlay (track 1, over bone 1's
 * subtree) or 0x2000 for one cut onto the base track, and `obj+0x34`
 * 0x40000000 for either. The states read the first two through
 * `ZombieSetMotionIfIdle` and the third themselves; these take them down.
 */
import { ActorFlag, ZombieFlag2, type ZombieActor } from "../actor";
import { HitResultCode } from "../combat/resolve_hit";
import { MotionCrossFadeAlt, OverlayCursor } from "../motion";
import { MotionPlayFrame, MotionPlayLength, MotionRowOf } from "../tables";

/** `MOV ECX, [EAX + EDX*4 + 0x10]` -- motion row entry 4 + the zone. */
const ALT_ROW = 4;
/** `MotionCrossFadeAlt(obj+0x194, 1, clip, 0, 5)`. */
const ALT_BONE = 1;
const ALT_FADE_IN = 5;
/** `TEST [ESI+0x34], 0x50000000` -- a reaction, or an attack under way. */
const ALT_BLOCKED = ActorFlag.Reacting | ActorFlag.Committed;

/** `(len + (len >> 31 & 3)) >> 2` -- a quarter, truncated toward zero. */
function Quarter(len: number): number {
  return Math.trunc(len / 4);
}

/**
 * `ZombieClearHitReactionWhenDone` — `FUN_00454660`.
 *
 * ```
 * if (!(obj+0x34 & 0x40000000)) return
 * if (obj+0x1364 == 3) {                                   ; severed
 *   if ((obj+0x136C & 0x1000) && !obj+0x1CA) obj+0x136C &= ~0x1000
 *   if ((obj+0x136C & 0x2000) && obj+0x1F1)  obj+0x136C &= ~0x2000
 * } else {
 *   if ((obj+0x136C & 0x1000) && (!obj+0x1CA
 *        || len[obj+0x1B8] / 4 <= obj+0x1A0))            obj+0x136C &= ~0x1000
 *   if ((obj+0x136C & 0x2000) && (obj+0x1F1
 *        || len[obj+0x1B4] / 4 <= obj+0x19C))            obj+0x136C &= ~0x2000
 * }
 * if (!(obj+0x136C & 0x3000)) obj+0x34 &= ~0x40000000
 * ```
 *
 * `obj+0x1CA` is the model's track count, 1 while the overlay runs --
 * {@link ZombieActor.react} not null; `obj+0x1F1` is the byte the base
 * track's sampler raises once its cursor has reached the play length. So
 * after an ordinary hit a state may change the legs' clip under a stumble a
 * quarter of the way in, and a leg-hit clip on the base track holds a quarter
 * of its length; a severing hit holds both to the end.
 */
export function ZombieClearHitReactionWhenDone(obj: ZombieActor): void {
  if (!(obj.flags & ActorFlag.Reacting)) return;
  const baseAtEnd = MotionPlayFrame(obj) >= MotionPlayLength(obj);
  if (obj.zom.hitResult === HitResultCode.Severed) {
    if ((obj.flags2 & ZombieFlag2.HitClipOverlay) && !obj.react) {
      obj.flags2 &= ~ZombieFlag2.HitClipOverlay;
    }
    if ((obj.flags2 & ZombieFlag2.HitClipBase) && baseAtEnd) {
      obj.flags2 &= ~ZombieFlag2.HitClipBase;
    }
  } else {
    if ((obj.flags2 & ZombieFlag2.HitClipOverlay)
        && (!obj.react || Quarter(MotionPlayLength(obj, obj.react.motion))
                          <= OverlayCursor(obj, obj.react))) {
      obj.flags2 &= ~ZombieFlag2.HitClipOverlay;
    }
    if ((obj.flags2 & ZombieFlag2.HitClipBase)
        && (baseAtEnd
            || Quarter(MotionPlayLength(obj)) <= MotionPlayFrame(obj))) {
      obj.flags2 &= ~ZombieFlag2.HitClipBase;
    }
  }
  if (!(obj.flags2 & (ZombieFlag2.HitClipOverlay | ZombieFlag2.HitClipBase))) {
    obj.flags &= ~ActorFlag.Reacting;
  }
}

/**
 * `ZombieTickAltHitReaction` — `FUN_004547C0`.
 *
 * ```
 * if ((obj+0x136C & 0x100) && (obj+0x136C & 0x200) && !(obj+0x34 & 0x50000000)) {
 *   m = row[4 + obj+0x1319]
 *   if (obj+0x1B8 == m && obj+0x1CA) {
 *     if (len[obj+0x1B4] / 2 <= obj+0x19C) obj+0x34 &= ~0x2000
 *   } else MotionCrossFadeAlt(obj+0x194, 1, m, 0, 5)
 * }
 * ```
 *
 * The zone-indexed stumble that keeps itself going, and lets the actor be
 * staggered again once the **base** clip is half played. Nothing in the
 * shipped game raises `obj+0x136C` 0x100 (`ZombieFlag2.HitReactionAlt`), so
 * this never acts; it is transcribed so that stays a fact about the data.
 */
export function ZombieTickAltHitReaction(obj: ZombieActor): void {
  if (!(obj.flags2 & ZombieFlag2.HitReactionAlt)
      || !(obj.flags2 & ZombieFlag2.HitReactionPending)
      || (obj.flags & ALT_BLOCKED)) return;
  const m = MotionRowOf(obj)[ALT_ROW + obj.lastHitZone] ?? 0;
  if (obj.react && obj.react.motion === m) {
    if (Math.trunc(MotionPlayLength(obj) / 2) <= MotionPlayFrame(obj)) {
      obj.flags &= ~ActorFlag.NoHitReaction;
    }
    return;
  }
  MotionCrossFadeAlt(obj, ALT_BONE, m, 0, ALT_FADE_IN);
}
