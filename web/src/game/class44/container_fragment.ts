/**
 * `FallingContainerFragmentUpdate` — one of the two pieces a falling
 * container breaks into.
 *
 * `FallingContainerUpdate` (`FUN_0046A580`) allocates them into the object
 * pool its container lives in, as 0x378 objects with the container's own
 * layout: position at `+0x19C`, velocity at `+0x1C0`, the three angles at
 * `+0x1CC`/`+0x1D0`/`+0x1D4` and their spins at `+0x1D8`/`+0x1E0`, state at
 * `+0x192`, floor at `+0x2E0`. So they are {@link BreakableProp} records in
 * `g_breakable_props`, family {@link PropFamily.ContainerFragment}, and their
 * draw is recorded the way the container's is.
 *
 * `obj+0x2A0` is this routine's frame count -- another reading of the word
 * `storyItem` holds (`L3`); `ActorClearGameFields` zeroed it at the spawn.
 *
 * Nothing registers for the shot test and nothing reads the piece back: it
 * tumbles, lands with a sound, lies there, blinks and goes. The sound's coin
 * flip is a `rand()`, which is the one thing about it the rest of the game can
 * feel.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { G } from "../globals";
import { T } from "../tables";
import { MatrixTranslate } from "../matrix";
import {
  PropDrawBegin, PropDrawSlot, PropMatrixPush, PropMatrixTRzRyRx,
  PropSubmitSlotWithSceneLightArray,
} from "../class41/prop_draw";
import { MsvcRand } from "../class41/group";
import { ActorKillProp } from "../class41/prop";
import { BreakableState, type BreakableProp } from "../class41/prop_state";
import {
  FALLING_GRAVITY, FallingContainerGroundContact, SFX_FALLING_LAND_A,
  SFX_FALLING_LAND_B,
} from "./container";

/**
 * `CMP EAX, 0xB4` on the count **before** the increment (`0x0046AD2B`): the
 * piece steps 0..0xB4 -- 181 frames -- and the 182nd `ActorKill`s it.
 */
export const FRAGMENT_LIFE_FRAMES = 0xb4;
/**
 * Past this count a settled piece is drawn on even counts only
 * (`CMP EAX, 0x96` then `AND EAX, 0x80000001` at `0x0046AF38`): it blinks for
 * its last half-second before it goes.
 */
export const FRAGMENT_BLINK_AFTER = 0x96;
/** The easing both spins use: `spin -= (angle + spin) / 32`, toward zero. */
const FRAGMENT_SPIN_EASE = 32;

/**
 * `FallingContainerFragmentUpdate` — `FUN_0046AD20`.
 *
 * ```
 * if (obj+0x2A0++ > 0xB4) { ActorKill(); return; }
 * if (state == 1) {
 *     vy -= 0.05444;  x += vx;
 *     spin -= (pitch + spin) / 32;  y += vy;  pitch += spin;
 *     roll += rollSpin;  z += vz;
 *     if (FallingContainerGroundContact(obj, g_container_fragment_hull_points,
 *                                       0x37) && vy < 0) {
 *         state = 2;  spin = -spin;  PlaySoundId(rand() & 1 ? 0x1816A9 : 0x1916A9);
 *     }
 * } else if (state == 2) {
 *     spin -= (pitch + spin) / 32;  pitch += spin;
 *     rollSpin -= (roll + rollSpin) / 32;  roll += rollSpin;
 *     FallingContainerGroundContact(obj, g_container_fragment_hull_points, 0x37);
 * }
 * ```
 *
 * Unlike the container, the piece moves in x and z, and its pitch spin eases
 * toward a level piece even in the air -- only the roll tumbles freely. The
 * `/ 32` is `SAR 5` behind the `AND EDX, 0x1F` sign fixup, so it rounds toward
 * zero: `Math.trunc`.
 */
export function FallingContainerFragmentUpdate(p: BreakableProp, rng: Rng,
                                               events?: Events): void {
  PropDrawBegin(p);
  const was = p.storyItem;
  p.storyItem = was + 1;
  if (was > FRAGMENT_LIFE_FRAMES) { ActorKillProp(p); return; }

  const hull = T.breakables?.fragment_hull ?? [];
  if (p.state === BreakableState.Falling) {
    p.vy -= FALLING_GRAVITY;
    p.x += p.vx;
    p.spin -= Math.trunc((p.pitch + p.spin) / FRAGMENT_SPIN_EASE);
    p.y += p.vy;
    p.pitch += p.spin;
    p.roll += p.rollSpin;
    p.z += p.vz;
    if (FallingContainerGroundContact(p, hull) && p.vy < 0) {
      p.state = BreakableState.Settled;
      p.spin = -p.spin;
      events?.emit("prop.settled", {
        id: p.id,
        sound: (MsvcRand(rng) & 1) === 0
          ? SFX_FALLING_LAND_A : SFX_FALLING_LAND_B,
      });
    }
  } else if (p.state === BreakableState.Settled) {
    p.spin -= Math.trunc((p.pitch + p.spin) / FRAGMENT_SPIN_EASE);
    p.pitch += p.spin;
    p.rollSpin -= Math.trunc((p.roll + p.rollSpin) / FRAGMENT_SPIN_EASE);
    p.roll += p.rollSpin;
    FallingContainerGroundContact(p, hull);
  }

  // The draw (`0x0046AE8A`..), recorded where it is made. Settled: past count
  // 0x96 an odd count -- the one just stored -- returns before it; else
  // `T(rest) . Rz . Ry . Rx . T(hull[contact] * -0.001f)`, the draw, and
  // `MatrixStore(+0x2E4)` -- so the frame a piece lands is drawn re-seated on
  // the corner that touched. In the air: `T(x, y, z) . Rz . Ry . Rx`. Both
  // submit through the scene light array while `g_scene_lighting` is up
  // (`0x0046AF08`, `0x0046B00E`).
  if (p.state === BreakableState.Settled) {
    if (p.storyItem > FRAGMENT_BLINK_AFTER && (p.storyItem & 1) !== 0) return;
    const m = PropMatrixPush();
    PropMatrixTRzRyRx(m, p.restX, p.restY, p.restZ, p.pitch, p.yaw, p.roll);
    const [cx, cy, cz] = hull[p.contact] ?? [0, 0, 0];
    MatrixTranslate(m, -cx, -cy, -cz);
    if (G.g_scene_lighting !== 0) PropSubmitSlotWithSceneLightArray(p, m, p.slot);
    else PropDrawSlot(p, m, p.slot);
    p.drawMatrix = m.slice(0, 16);
    return;
  }
  const m = PropMatrixPush();
  PropMatrixTRzRyRx(m, p.x, p.y, p.z, p.pitch, p.yaw, p.roll);
  if (G.g_scene_lighting !== 0) PropSubmitSlotWithSceneLightArray(p, m, p.slot);
  else PropDrawSlot(p, m, p.slot);
}
