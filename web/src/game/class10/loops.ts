/**
 * The clip's loop counter — the arm of `CivilianUpdate` (`FUN_0048A920`) that
 * decides whether the play cursor may come round again.
 *
 * The clock itself is `ActorAdvanceMotion`'s; this is the part class 0x10
 * owns, and wait bit 0x100 is what blocks on it.
 */
import type { Actor } from "../actor";
import { MotionOf, MotionPlayFrame, MotionPlayLength } from "../tables";
import { CivilianWait } from "./ops";

/**
 * Op 0x00's loop counter, which wait bit 0x100 blocks on.
 *
 * [port-only] The loop arm of `CivilianUpdate` (`FUN_0048A920`), which has no
 * routine of its own: the engine advances `model+0x00` inline while the count
 * allows and simply stops when it does not.
 */
export function CivilianCountMotionLoops(obj: Actor): void {
  const sub = obj.civ;
  if (!sub) return;
  const m = MotionOf(obj, obj.motion);
  if (!m) return;

  // `(short)sub+0x0C`, **signed**: negative means play for ever, and the
  // engine's `if (0 < loops)` skips the whole arm at zero — a clip with no
  // loops left does not advance at all.
  const loops = sub.loops;
  if (loops < 0) return;
  if (loops === 0) { CivilianHoldLastFrame(obj); return; }

  const cur = MotionPlayFrame(obj);
  if (sub.frameLimit === 0) {
    // `model[2] < g_motion_play_length[model[8]]` — the **play** length. The
    // cursor wraps at `play + 1`, so this is false on exactly one frame of
    // each play-through, which is what makes a loop cost one play rather than
    // one frame. Reading `m.frames` here spent a loop halfway through instead.
    if (cur < MotionPlayLength(obj)) return;
    sub.loops -= 1;
    if (sub.loops !== 0) return;      // more to play: keep advancing
    CivilianHoldLastFrame(obj);
    return;
  }
  // The frame-limit form: stop at `sub+0x08` rather than at the clip's end,
  // and rewind only when the wait word asks for another loop.
  if (cur < sub.frameLimit) return;
  if (sub.wait & CivilianWait.MotionLoops) {
    sub.loops -= 1;
    if (sub.loops !== 0) {
      obj.playTicks = 0;
      obj.rootFrame = -1;
      return;
    }
  }
  CivilianHoldLastFrame(obj);
}

/**
 * Stop the play cursor where it is.
 *
 * **This is what the engine does by simply not incrementing it.**
 * `CivilianUpdate`'s loop arm advances `model+0x00` only while the loop count
 * allows; when it runs out nothing touches the cursor again and the clip sits
 * on its last frame for as long as the actor lives. The port's clock is
 * advanced unconditionally by `ActorAdvanceMotion` and wrapped by the
 * renderer, so "stop incrementing" has to be said out loud — otherwise a
 * civilian killed in a set piece plays its dying clip over and over, which is
 * exactly what it did.
 *
 * The cursor is pinned at the play length rather than at the clip's last
 * authored frame because that is where the engine's leaves it: the increment
 * is refused on the first frame that reaches it.
 */
function CivilianHoldLastFrame(obj: Actor): void {
  const m = MotionOf(obj, obj.motion);
  if (!m?.fps) return;
  // The cursor is at the play length when the last loop is spent -- the one
  // value that wraps to zero on the next tick -- so pinning it there is
  // exactly the engine's "stop incrementing `model[0]`". Both sides are cursor
  // ticks now, which is what `g_motion_play_length` was always counted in;
  // this used to divide by `fps * 2` to reach the seconds the clock was kept
  // in, and that conversion is the one this whole change deletes.
  const hold = MotionPlayLength(obj);
  if (obj.playTicks > hold) obj.playTicks = hold;
}
