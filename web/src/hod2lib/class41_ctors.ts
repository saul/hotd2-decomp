/**
 * The two `.rdata` tables class 0x41 constructors 55 and 61 read, as the
 * bundle carries them on their placements.
 *
 * Both are indexed by an immediate of their constructor's, and exactly that
 * many rows travel -- never "until the next table" (`L6`): the forty-eight
 * rows `PlaceType55Particles` (`FUN_00463FE0`) can reach and the nine types
 * `PlaceType61Figures` (`FUN_004641F0`) loops over. The counts are in
 * `game/class41/ctor_literals.ts` with the other immediates.
 */
import { TYPE55_ROWS, TYPE61_FIGURES } from "../game/class41/ctor_literals";
import type { ExeTables } from "./exetab";

/** `g_type55_particle_offsets` — 48 rows of s16 `x, y, z`. */
export const TYPE55_PARTICLE_OFFSETS = 0x00594f2a;
/** A row is three s16s: `LEA ESI, [ESI + ESI*2]; SHL ESI, 1` at `0x0046407D`. */
const TYPE55_ROW_BYTES = 6;

/** `g_type61_figure_types` — nine s8 character types. */
export const TYPE61_FIGURE_TYPES = 0x0059504c;

function s16(v: number): number {
  return (v << 16) >> 16;
}

/**
 * `g_type55_particle_offsets`, as the constructor's three `MOVSX` read it
 * (`0x00464082`, `0x004640A0`, `0x004640C3`). Null when the image does not
 * have it.
 */
export function type55ParticleOffsets(tables: ExeTables):
    [number, number, number][] | null {
  const out: [number, number, number][] = [];
  for (let j = 0; j < TYPE55_ROWS; j++) {
    const at = TYPE55_PARTICLE_OFFSETS + j * TYPE55_ROW_BYTES;
    const x = tables.ru16(at), y = tables.ru16(at + 2), z = tables.ru16(at + 4);
    if (x === null || y === null || z === null) return null;
    out.push([s16(x), s16(y), s16(z)]);
  }
  return out;
}

/**
 * `g_type61_figure_types`, as `MOVSX CX, byte ptr [EBP + 0x59504C]` at
 * `0x004642A3` reads it. Null when the image does not have it.
 */
export function type61FigureTypes(tables: ExeTables): number[] | null {
  const out: number[] = [];
  for (let i = 0; i < TYPE61_FIGURES; i++) {
    const w = tables.ru16(TYPE61_FIGURE_TYPES + i);
    if (w === null) return null;
    out.push(((w & 0xff) << 24) >> 24);
  }
  return out;
}
