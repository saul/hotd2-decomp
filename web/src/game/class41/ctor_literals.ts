/**
 * The immediates of class 0x41 constructors 42, 52, 55, 61 and 65 that the
 * exporter needs too -- which constructor a placement is, which asset slots
 * its task draws, which clips its figures stand in -- as data with no
 * module-scope side effect, so `hod2lib/` can import them without pulling in
 * the pool. The same arrangement as `type47_slots.ts`.
 *
 * The routines are `type42.ts`, `type52.ts`, `type55.ts`, `type61.ts` and
 * `type65.ts`. The two tables these constructors read out of `.rdata` are
 * not here: they travel in the bundle, on the placement.
 */

/** `g_class41_constructors[42]` (`0x00593628`) is `PlaceType42Prop`. */
export const TYPE42_CONSTRUCTOR = 42;
/** `PUSH 0x1823` at `0x0046CE8F` -- `komono_boss2.bin[7]`. */
export const TYPE42_SLOT = 0x1823;

/** `g_class41_constructors[52]` is `PlaceType52VanDoors`. */
export const TYPE52_CONSTRUCTOR = 52;
/**
 * `LEA EDX, [EBP + 0x1794]` at `0x00463DCB`, `EBP` counting 0 and 1:
 * `char_adv04.bin[95]` and `[96]`.
 */
export const TYPE52_SLOT = 0x1794;
/** `CMP EBX, 3` at `0x00463E03`, `EBX` stepping -1 and +1 by 2: two. */
export const TYPE52_OBJECTS = 2;

/** `g_class41_constructors[55]` is `PlaceType55Particles`. */
export const TYPE55_CONSTRUCTOR = 55;
/** `ADD EDX, 0x19D` at `0x0046F058` -- `eff_4.bin[0]`. */
export const TYPE55_SLOT = 0x19d;
/** `MOV ECX, 0x30; IDIV` at `0x0046F04B`: `eff_4.bin[0..47]` by particle. */
export const TYPE55_SLOT_SPAN = 0x30;
/**
 * `CMP ESI, 0x30` at `0x00464042` and `MOV ECX, 0x30; IDIV` at `0x0046404D`
 * -- the rows of `g_type55_particle_offsets` the constructor can index, which
 * is how many the exporter carries (`L6`).
 */
export const TYPE55_ROWS = 0x30;

/** `g_class41_constructors[61]` is `PlaceType61Figures`. */
export const TYPE61_CONSTRUCTOR = 61;
/** `CMP EBP, 9` at `0x0046432E`. */
export const TYPE61_FIGURES = 9;
/** `MOV dword ptr [EDI + 0x20], 0x2F6` at `0x004642AF` -- every other type's clip. */
export const TYPE61_CLIP = 0x2f6;
/** `CMP byte ptr [EBP + 0x59504C], 0x13` at `0x004642B6`... */
export const TYPE61_TYPE_A = 0x13;
/** ...`MOV dword ptr [EDI + 0x20], 0x3EA` at `0x004642BF`. */
export const TYPE61_CLIP_A = 0x3ea;
/** `CMP byte ptr [EBP + 0x59504C], 0x16` at `0x004642CD`... */
export const TYPE61_TYPE_B = 0x16;
/** ...`MOV dword ptr [EDI + 0x20], 0x3DA` at `0x004642D6`. */
export const TYPE61_CLIP_B = 0x3da;

/**
 * The clip `PlaceType61Figures` gives a figure of character type `type`:
 * the two `CMP`/`JNZ` pairs at `0x004642B6` and `0x004642CD` over the
 * `0x2F6` written before them. `[port-only]` as a function; the exporter
 * bakes exactly these and the constructor writes exactly these.
 */
export function Type61FigureClip(type: number): number {
  if (type === TYPE61_TYPE_A) return TYPE61_CLIP_A;
  if (type === TYPE61_TYPE_B) return TYPE61_CLIP_B;
  return TYPE61_CLIP;
}

/**
 * `[port-only]` -- the spawn address figure `i` of the constructor-61 placer
 * at `placerAt` is known by: bits 28 **and** 27, the figure in bits 20..23
 * and the placer's own address below. The engine keys nothing on an address;
 * the port's pool and the character layer do, and the exporter writes a
 * synthetic row at exactly this address for each figure
 * (`hod2lib/characters.ts`). The horde's members set bit 28 alone
 * (`HordeMemberAt`) and `znele`'s twins bit 27 alone (`ZombieTwinAt`), so
 * no other synthetic address has both.
 */
export function Type61FigureAt(placerAt: number, i: number): number {
  return (0x18000000 | ((i & 0xf) << 20) | (placerAt & 0xfffff)) >>> 0;
}

/** `g_class41_constructors[65]` is `PlaceType65Particles`. */
export const TYPE65_CONSTRUCTOR = 65;
/** `ADD EDX, 0xCA5` at `0x0046FDC0` -- `garasu.bin[0]`. */
export const TYPE65_SLOT = 0xca5;
/** `MOV ECX, 0x48; IDIV` at `0x0046FDB8`: `garasu.bin[0..71]` by particle. */
export const TYPE65_SLOT_SPAN = 0x48;
