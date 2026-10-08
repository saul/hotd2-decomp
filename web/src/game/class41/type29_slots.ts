/**
 * Class 0x41 constructor 29's immediates, as data with no module-scope side
 * effect -- the exporter places the constructor's spawn, reads its table and
 * carries its models. See `class41/type29.ts`.
 */

/** `g_class41_constructors[29]` (`0x005935F4`) is `PlaceTable29Props`. */
export const TYPE29_CONSTRUCTOR = 29;

/**
 * `g_type29_prop_xyz` -- `0x00593D38`, nine `{f32 x, y, z}` rows. The
 * constructor walks it with `MOV EDI, 0x593D3C` (the first `y`) and stops at
 * `CMP EDI, 0x593DA8`: nine rows by the loop's own bound (`L6`), and
 * `g_water_surface_slots` begins where they end.
 */
export const TYPE29_ROWS = 0x00593d38;
export const TYPE29_ROW_COUNT = 9;

/**
 * `ADD ECX, 0x1A3A` on `+0x290` -- `tokei_gear.bin[i]` for object `i`.
 * Objects 3 and 7 are never drawn (`CMP AX, 3` / `CMP AX, 7`), so their two
 * models are not what the routine draws.
 */
export const TYPE29_FIRST_SLOT = 0x1a3a;
export const TYPE29_UNDRAWN: readonly number[] = [3, 7];

/**
 * `[port-only]` Every slot the constructor's objects draw, for the exporter to
 * carry: the seven the routine's two `CMP`s let through.
 */
export function Type29DrawSlots(): number[] {
  const out: number[] = [];
  for (let i = 0; i < TYPE29_ROW_COUNT; i++) {
    if (!TYPE29_UNDRAWN.includes(i)) out.push(TYPE29_FIRST_SLOT + i);
  }
  return out;
}
