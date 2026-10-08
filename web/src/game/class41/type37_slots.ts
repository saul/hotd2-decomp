/**
 * Class 0x41 constructor 37's immediates, as data with no module-scope side
 * effect -- the exporter places the constructor's spawns, reads its table and
 * carries its models and its effect. See `class41/type37.ts`.
 */

/** `g_class41_constructors[37]` (`0x00593614`) is `PlaceType37PropPair`. */
export const TYPE37_CONSTRUCTOR = 37;

/** `MOV word [ESI+0x28C], 0x17A9` -- `komono_1.bin[114]`, both objects. */
export const TYPE37_SLOT = 0x17a9;
/**
 * `MOV dword [ESI+0x324], 7` and `MOV dword [ESI+0x328], 0x1D5` -- the break
 * effect a hit object draws, and the motion it plays.
 */
export const TYPE37_EFFECT = 7;
export const TYPE37_MOTION = 0x1d5;
/**
 * `ADD EDX, 0x93` on `+0x2A4`, drawn while `0 < +0x2A4 < 0x10` -- the landing
 * strip, `common.bin[25]`..`[39]` (`0x94`..`0xA2`).
 */
export const TYPE37_STRIP_BASE = 0x93;
export const TYPE37_STRIP_END = 0x10;

/**
 * `g_type37_hull_points` -- `0x00593E40`, eight `{s16 x, y, z}` corners. The
 * routine walks it with `MOV EDI, 0x593E42` and stops at `CMP EDI, 0x593E72`:
 * eight by the loop's own bound (`L6`), and `g_prop_table38` begins where they
 * end. The exporter reads the corners; the `* 0.001` is the routine's.
 */
export const TYPE37_HULL = 0x00593e40;
export const TYPE37_HULL_POINTS = 8;

/**
 * `[port-only]` Every slot the constructor's objects draw outside their
 * effect, for the exporter to carry: the model and the strip.
 */
export function Type37DrawSlots(): number[] {
  const out = [TYPE37_SLOT];
  for (let n = 1; n < TYPE37_STRIP_END; n++) out.push(TYPE37_STRIP_BASE + n);
  return out;
}
