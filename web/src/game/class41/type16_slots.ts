/**
 * Class 0x41 constructor 16's immediates, as data with no module-scope side
 * effect -- the exporter places the constructor's spawn, reads its table and
 * carries its models. See `class41/type16.ts`.
 */

/** `g_class41_constructors[16]` (`0x005935C0`) is `PlaceTable16Props`. */
export const TYPE16_CONSTRUCTOR = 16;

/**
 * `g_type16_prop_xz` -- `0x00593D20`, six `{s16 x; s16 z}` rows. The
 * constructor walks it with `MOV EDI, 0x593D22` (the first `z`) and stops at
 * `CMP EDI, 0x593D3A`, so the row count is the loop's own and not a scan for
 * the table's end (`L6`). The exporter reads the rows; the `* 0.1` is the
 * routine's.
 */
export const TYPE16_ROWS = 0x00593d20;
export const TYPE16_ROW_COUNT = 6;

/**
 * The four models `PropUpdateType16` switches between, `dolam.bin[0]`,
 * `[1]`, `[6]` and `[5]`: whole (`MOV word [ESI+0x28C], 0xA50` in the
 * constructor), the first hit's (`0xA51`), the second's (`0xA56`) and the
 * base the second leaves behind (`PUSH 0xA55`).
 */
export const TYPE16_WHOLE_SLOT = 0xa50;
export const TYPE16_CRACKED_SLOT = 0xa51;
export const TYPE16_LAUNCHED_SLOT = 0xa56;
export const TYPE16_BASE_SLOT = 0xa55;

/**
 * `Type16DropStripUpdate`'s strip: `+0x48 = 0x1339` in `SpawnType16DropStrip`,
 * stepped before each draw, and `CMP EAX, 0x1356` the last one drawn --
 * `common.bin[308]`..`[336]`.
 */
export const TYPE16_STRIP_FIRST = 0x1339;
export const TYPE16_STRIP_LAST = 0x1356;

/**
 * `[port-only]` Every slot the constructor's objects can draw, for the
 * exporter to carry: the four pushes above and the strip, gathered.
 */
export function Type16DrawSlots(): number[] {
  const out = [TYPE16_WHOLE_SLOT, TYPE16_CRACKED_SLOT, TYPE16_LAUNCHED_SLOT,
               TYPE16_BASE_SLOT];
  for (let s = TYPE16_STRIP_FIRST + 1; s <= TYPE16_STRIP_LAST; s++) out.push(s);
  return out;
}
