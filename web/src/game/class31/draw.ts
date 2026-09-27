/**
 * Class 0x31's node draw hook: what a thrower's draw writes back.
 *
 * `EnemyThrowerInit` (`FUN_00449620`) installs `ThrowerDrawBonePart` at
 * `obj+0x12EC` (`model+0x1158`), and `SkeletonEmitNode` (`FUN_004114C0`)
 * calls it for every node that has a slot, while `MotionFlag.Drawn`
 * is up and the node is not vetoed. `ThrowerAdvanceMotion` (`FUN_00449EF0`)
 * is where that walk happens: the last act of `EnemyThrowerUpdate`
 * (`FUN_00449910`) but the camera point, after the state and the integration.
 *
 * Most of the hook is drawing, which is the renderer's. Two things it does
 * are state, and they are why it is ported here rather than left to
 * `render/`: it **grows the hand back** — `ThrowerStateRestoreBothHands`
 * sets a latch and waits, and only this clears it — and on one slot it
 * **writes** `obj+0x138C`. The third thing kept is which alpha each bone was
 * drawn at, for the renderer to draw with.
 */
import { ActorFlag, ThrowerFlag, type Actor } from "../actor";
import { G } from "../globals";
import { SpawnClass } from "../spawn_class";

/** Character type 0x18, `zslman` — the one whose hands grow back. */
const CHAR_ZSLMAN = 0x18;

/**
 * The two bare-hand slots the regrow arm admits — `SUB ECX, 0x1fed` / `JZ`
 * and `SUB ECX, 0x4` / `JNZ` at `0x0044A127..0x0044A132`: `0x1FED` is bone
 * 8's bare hand and `0x1FF1` bone 5's, the two `ThrowerStateRestoreBothHands`
 * swaps back.
 */
const REGROW_SLOTS: readonly number[] = [0x1fed, 0x1ff1];
/**
 * The weapon grows back by this much **per regrowing node drawn**.
 *
 * `[0x004C4CB0]` = `cdcccc3c` = 0.025f, the `FADD` at `0x0044A150`; the clamp
 * it is compared against, `[0x004C4380]` = `0000803f`, is 1.0f. `[proved]`
 *
 * Per node, not per frame: the hook runs once for each node it is handed, so
 * a `zslman` with both hands bare grows twice as fast as one with one.
 *
 * And it is **41 nodes, not 40**. The sum is stored back as an f32 every
 * time (`FST float ptr [EDI + 0x1384]`), and forty f32 additions of 0.025f
 * come to 0.99999958 — below 1.0 whether the `FCOMP` sees the stored value
 * or the unrounded `ST0` beside it, and whether the FPU runs at 24 bits (as
 * Direct3D leaves it) or 64. The forty-first reaches 1.0249996. The port
 * accumulates in `Math.fround` for that reason; in doubles the fortieth
 * already passes, which is what the old counter in the state did.
 */
export const REGROW_PER_NODE = Math.fround(0.025);
/** ...and the value {@link ThrowerTail.handRegrow} stops at. */
export const REGROW_FULL = 1.0;

/**
 * The slot whose draw **writes** the alpha: `SUB EAX, 0x1fb9` / `JZ` at
 * `0x0044A001`. Every other type's arm reads `obj+0x138C`; this one sets it.
 */
const PULSE_SLOT = 0x1fb9;
/** `g_blink_frame_counter % 0x78` — `MOV ECX, 0x78` / `DIV` at `0x0044A0BA`. */
const PULSE_PERIOD = 0x78;
/** `CMP EDX, 0x3c` at `0x0044A0C5`: from here the ramp runs back down. */
const PULSE_HALF = 0x3c;
/** `FMUL [0x0055CB80]` = `8988883c` = 1/60 as an f32. */
const PULSE_STEP = Math.fround(1 / 60);
/**
 * The two slots drawn as a 50-cel cycle rather than as themselves —
 * `SUB EAX, 0x5d` and `SUB EAX, 0x34` after `0x1FB9`, so `0x2016` and
 * `0x204A`, drawing `0x2017 + n % 0x32` and `0x204B + n % 0x32`. Solid.
 */
const CYCLE_SLOTS: readonly number[] = [0x2016, 0x204a];

/**
 * `ThrowerDrawBonePart` — `FUN_00449F90`. One node of a thrower's skeleton,
 * drawn; the state it writes, and the alpha it drew at.
 *
 * For character type 0x18 (`CMP word ptr [EAX + 0x1f4], 0x18` at
 * `0x00449FE6`, on `g_cur_actor`):
 *
 * * a node on `0x1FED` or `0x1FF1` **while `ThrowerFlag.Regrowing` is up**
 *   adds 0.025 to `obj+0x1384` and, once that is no longer below 1.0, pins it
 *   at 1.0 and drops the latch (`AND ECX, 0xf7ffffff` at `0x0044A169`); then
 *   draws the bare hand solid, `MatrixScale(1.0, obj+0x1384, 1.0)`, and the
 *   growing piece. That piece is `0x1FF4` for both hands — the arm that would
 *   draw `0x1FF0` compares the slot against `0x1FEE` (`CMP EAX, 0x1fee` at
 *   `0x0044A1A2`), which the guard never lets through;
 * * every other node goes to `ThrowerDrawPartAlphaIfBlinking` (`FUN_0044A280`):
 *   at `obj+0x138C` while `ThrowerFlag.Blinking` is up, solid otherwise.
 *
 * For every other type, a node is drawn solid while `obj+0x34` has
 * `0x4000000` (`TEST dword ptr [EAX + 0x34], 0x4000000` at `0x00449FF4`);
 * otherwise `0x1FB9` sets `obj+0x138C` to a 120-frame ramp up and down and
 * draws at it while the blink bit is up (and solid as itself while it is
 * not), `0x2016` and `0x204A` draw a cel of a 50-cel cycle, and anything else
 * is drawn at `obj+0x138C` under the blink bit, solid without it. `[proved]`,
 * from the disassembly at `0x00449F90..0x0044A1FC`.
 *
 * What is not here, and why:
 *
 * * `[open]` for bone 2 — while `obj+0x136C` has `0x100` or lacks `0x20`,
 *   and `obj+0x34` lacks `0x40000` — the hook first calls the unnamed
 *   `0x00453BE0`, which reads the bone's record and the camera block and
 *   carries on past
 *   the `MatrixStackPop` its decompilation stops at (`L35`). What it does to
 *   the head is unread; nothing in it has been seen to write the actor.
 * * The draws themselves, the scale and the cels are `render/`'s, and it does
 *   not draw `0x1FF4`, the cycles or a fractional alpha. It is handed the
 *   alpha in {@link ThrowerTail.boneDrawAlpha} and draws a bone whose alpha
 *   is 0 as not drawn, which is every alpha the shipped game gives a bone:
 *   the three blinking states write 0 and 1, and the ramp is reachable only
 *   under the blink bit on a `0x1FB9` node, which no shipped `zskamere` has
 *   — all fifteen carry a `+0x20` word of 1, so bit 2 is never up.
 */
export function ThrowerDrawBonePart(obj: Actor, bone: number,
                                    slot: number): void {
  if (obj.cls !== SpawnClass.Thrower) return;
  const t = obj.thr;
  let alpha = 1;
  const blinking = (obj.flags2 & ThrowerFlag.Blinking) !== 0;
  if (obj.charType === CHAR_ZSLMAN) {
    if (REGROW_SLOTS.includes(slot)
        && (obj.flags2 & ThrowerFlag.Regrowing) !== 0) {
      t.handRegrow = Math.fround(t.handRegrow + REGROW_PER_NODE);
      if (!(t.handRegrow < REGROW_FULL)) {
        t.handRegrow = REGROW_FULL;
        obj.flags2 &= ~ThrowerFlag.Regrowing;
      }
    } else if (blinking) {
      alpha = obj.alpha;
    }
  } else if ((obj.flags & ActorFlag.Dead) === 0) {
    if (slot === PULSE_SLOT) {
      if (blinking) {
        const n = G.g_blink_frame_counter % PULSE_PERIOD;
        let a = n * PULSE_STEP;
        if (n >= PULSE_HALF) a = 1 - (a - 1);
        obj.alpha = Math.fround(a);
        alpha = obj.alpha;
      }
    } else if (!CYCLE_SLOTS.includes(slot) && blinking) {
      alpha = obj.alpha;
    }
  }
  t.boneDrawAlpha[bone] = alpha;
}
