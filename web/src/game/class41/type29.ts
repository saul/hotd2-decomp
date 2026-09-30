/**
 * Class 0x41 constructor 29 -- nine `tokei_gear.bin` models turning in stage 2's
 * clock tower, seven of them drawn.
 *
 * One spawn in the game: stage 2 block 21 step 3, evt `0xECE4`, lifetime 4
 * steps. The descriptor stands at the origin; every object's point is a row
 * of `g_type29_prop_xyz`, which the exporter reads out of the image. `[likely]`
 * gears, from the file name (`tokei` is a clock); the port names nothing for
 * it.
 *
 * ## The routines `[proved]`
 *
 * `PlaceTable29Props` (`0x00463270`), `g_class41_constructors[29]`, from the
 * disassembly (`0x00463270`..`0x004632EA`):
 *
 * ```c
 * for (i = 0, row = g_type29_prop_xyz; i < 9; i++, row++) {
 *     obj = ActorAlloc(PropUpdateType29, 0x378); ActorClearGameFields(obj);
 *     obj->+0x290 = i;  obj->+0x19C..+0x1A4 = row;
 *     obj->+0x196 = (u8)g_evt_step_index;  obj->+0x197 = 0;
 *     obj->+0x11C = placer->+0x11C;
 * }
 * ```
 *
 * No flag word, no radius: nothing registers it and nothing can shoot it.
 *
 * `PropUpdateType29` (`0x0046A030`), from `0x0046A030`..`0x0046A0E5`:
 *
 * ```c
 * PropExpireByStepLifetime(obj);
 * if (i == 4 || i == 5) obj->+0x1D0 -= 0x80;  else obj->+0x1CC -= 0x80;
 * if (i != 3 && i != 7) {
 *     Push(0); T(x + 17.0f, y - 5.0f, z); Rz(+0x1D4); Ry(+0x1D0); Rx(+0x1CC);
 *     AssetDrawSlot(0x1A3A + i); Pop;
 * }
 * ```
 *
 * Nothing here touches an enemy counter.
 */
import { G } from "../globals";
import { T } from "../tables";
import { PropExpireByStepLifetime } from "./lifetime";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush, PropMatrixTRzRyRx }
  from "./prop_draw";
import { makeBreakableProp, PropFamily, type BreakableProp }
  from "./prop_state";
import { TYPE29_FIRST_SLOT, TYPE29_UNDRAWN } from "./type29_slots";

/** `CMP AX, 4` / `CMP AX, 5` -- the two that turn about Y. */
export const TYPE29_YAW_OBJECTS: readonly number[] = [4, 5];
/** `ADD dword [ESI+0x1D0 or 0x1CC], -0x80` -- BAMS a frame. */
export const TYPE29_TURN = -0x80;
/** `FADD float [0x005690DC]` and `FSUB float [0x0055D2B4]` -- 17.0, 5.0. */
export const TYPE29_DRAW_DX = 17.0;
export const TYPE29_DRAW_DY = -5.0;

/**
 * `PlaceTable29Props` — `FUN_00463270`. `g_class41_constructors[29]`.
 * The rows are `g_type29_prop_xyz`, which the bundle carries
 * (`breakables.type29_xyz`); `lifetime` is the placer's `+0x11C`.
 */
export function PlaceTable29Props(at: number,
                                  lifetime: number): BreakableProp[] {
  return (T.breakables?.type29_xyz ?? []).map((row, i) => {
    const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
    p.family = PropFamily.Type29;
    p.at = at;
    p.kind = i;                                   // +0x290
    p.x = Math.fround(row[0]);
    p.y = Math.fround(row[1]);
    p.z = Math.fround(row[2]);
    p.lastStepIndex = G.g_evt_step_index;
    p.stepsElapsed = 0;
    // `+0x11C`, which `PropExpireByStepLifetime` counts against.
    p.lifetime = lifetime;
    // `ActorClearGameFields` (`FUN_004A73D0`) left the flag word, the radius
    // and the rest at zero.
    p.flags = 0;
    p.hitRadius = 0;
    p.storyItem = 0;
    p.removeFlag = 0;
    return p;
  });
}

/** `PropUpdateType29` — `FUN_0046A030`. One object, one 60 Hz frame. */
export function PropUpdateType29(p: BreakableProp): void {
  PropDrawBegin(p);
  if (PropExpireByStepLifetime(p)) return;
  const i = (p.kind << 16) >> 16;
  if (TYPE29_YAW_OBJECTS.includes(i)) p.yaw = (p.yaw + TYPE29_TURN) | 0;
  else p.pitch = (p.pitch + TYPE29_TURN) | 0;
  if (TYPE29_UNDRAWN.includes(i)) return;
  const m = PropMatrixPush();
  // `FLD; FADD/FSUB float; FSTP float` -- each pushed as a float.
  PropMatrixTRzRyRx(m, Math.fround(p.x + TYPE29_DRAW_DX),
                    Math.fround(p.y + TYPE29_DRAW_DY), p.z,
                    p.pitch, p.yaw, p.roll);
  PropDrawSlot(p, m, TYPE29_FIRST_SLOT + i);
}
