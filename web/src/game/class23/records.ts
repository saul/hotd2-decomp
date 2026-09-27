/**
 * Class 0x23's `.rdata` — the walker's tables, `0x005703C0`..`0x0057048F`,
 * as cited constants.
 *
 * Data only, and imported by the exporter for the clip list. The same call as
 * `class22/records.ts`: one class's own tables, read by nothing else, kept as
 * the bytes the image holds and read out of them. 0xD0 bytes from
 * `0x005703C0`, read with Ghidra's `read_memory`; `g_boss4_phase_hp_fraction`
 * starts at the next byte.
 */

const CLASS23_RDATA_HEX =
  "930394039303940383038403900391038e038f038e038f03880389038b038c03"
  + "8303a40000004842950004008403840000004842780004008503960000003442"
  + "8b00040085039600000034428b000400af008d001c0017003c0031009a99193f"
  + "0000003f0000003fcdcccc3ecdcccc3ecdcccc3e9a99993e9a99993e9a99993e"
  + "9a99993e9a99993ecdcc4c3ecdcc4c3ecdcccc3d0000000000000000cd0c8143"
  + "9a1973439a1964439a1955439a1946430000fac30000e7c3000082c4000096c4"
  + "008018440080094400008c42006088c4";

const CLASS23_RDATA_BASE = 0x005703c0;

const RDATA: DataView = (() => {
  const n = CLASS23_RDATA_HEX.length / 2;
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    b[i] = parseInt(CLASS23_RDATA_HEX.slice(i * 2, i * 2 + 2), 16);
  }
  return new DataView(b.buffer);
})();

function s16(va: number): number {
  return RDATA.getInt16(va - CLASS23_RDATA_BASE, true);
}
function s8(va: number): number {
  return RDATA.getInt8(va - CLASS23_RDATA_BASE);
}
function f32(va: number): number {
  return RDATA.getFloat32(va - CLASS23_RDATA_BASE, true);
}

/**
 * `g_class23_motion_ids` — `0x005703C0`, sixteen s16s: the walk
 * (0x393/0x394, twice, at `+0` and `+4`), the strikes' first clips
 * (0x383/0x384), the post-strike clip (0x390/0x391), the back-off
 * (0x38E/0x38F, twice), the react (0x388/0x389) and the react's follow-on
 * (0x38B/0x38C). Every pair is indexed by the hit-point stage `obj+0x1320`,
 * and `Class23FightBesideCompanion` sub 6 indexes the whole table by
 * `stage + saved_sub * 2`.
 */
export const CLASS23_MOTION_IDS: readonly number[] =
  Array.from({ length: 16 }, (_u, i) => s16(0x005703c0 + i * 2));

/** `g_class23_motion_ids` by the address each reader loads. */
export const CLASS23_WALK = 0x005703c4;
export const CLASS23_AFTER_STRIKE = 0x005703cc;
export const CLASS23_BACK_OFF = 0x005703d0;
export const CLASS23_REACT = 0x005703d8;
export const CLASS23_REACT_FOLLOW = 0x005703dc;

/** One s16 of the table at `va + stage * 2` — `MOVSX EAX, word ptr [va + stage*2]`. `[port-only]` as a function. */
export function Class23Motion(va: number, stage: number): number {
  return s16(va + stage * 2);
}

/**
 * `g_class23_strikes` — `0x005703E0`, four 12-byte records indexed by
 * `stage + strike * 2`: `{s16 motion, s16 hit frame, f32 range, s16 sound
 * frame, s8 overlay kind}`. Read as `{0x383, 164, 50.0, 149, 4}`,
 * `{0x384, 132, 50.0, 120, 4}`, `{0x385, 150, 45.0, 139, 4}` twice.
 */
export interface Class23Strike {
  motion: number;
  hitFrame: number;
  range: number;
  soundFrame: number;
  overlay: number;
}
export const CLASS23_STRIKES: readonly Class23Strike[] =
  Array.from({ length: 4 }, (_u, i) => {
    const va = 0x005703e0 + i * 12;
    return {
      motion: s16(va), hitFrame: s16(va + 2), range: f32(va + 4),
      soundFrame: s16(va + 8), overlay: s8(va + 0xa),
    };
  });

/**
 * `g_class23_blend_start_frames` — `0x00570410`, three s16 pairs by stage:
 * 175/141 the walk's, 28/23 the post-strike clip's, 60/49 the post-react one.
 */
export const CLASS23_BLEND_WALK = 0x00570410;
export const CLASS23_BLEND_AFTER_STRIKE = 0x00570414;
export const CLASS23_BLEND_AFTER_REACT = 0x00570418;
/** `[port-only]` as a function. */
export function Class23BlendStart(va: number, stage: number): number {
  return s16(va + stage * 2);
}

/**
 * `g_class23_knockback_by_rank` — `0x0057041C`, sixteen floats by
 * `GetDamageRank()`: 0.6 0.5 0.5 0.4 0.4 0.4 0.3 0.3 0.3 0.3 0.3 0.2 0.2 0.1 0 0.
 */
export const CLASS23_KNOCKBACK_BY_RANK: readonly number[] =
  Array.from({ length: 16 }, (_u, i) => f32(0x0057041c + i * 4));

/** `g_class23_training_x_by_lesson` — `0x0057045C`, five floats. */
export const CLASS23_TRAINING_X_BY_LESSON: readonly number[] =
  Array.from({ length: 5 }, (_u, i) => f32(0x0057045c + i * 4));

/**
 * The arena clamps `Class23FightBesideCompanion`'s tail applies, and the
 * back-off distance: `[0x00570470]` -500, `[0x00570474]` -462,
 * `[0x00570478]` -1040, `[0x0057047C]` -1200, `[0x00570480]` 610,
 * `[0x00570484]` 550, `[0x00570488]` 70.0, `[0x0057048C]` -1091.
 */
export const ARENA0_Z_MIN = f32(0x00570470);
export const ARENA0_Z_MAX = f32(0x00570474);
export const ARENA0_X_MIN = f32(0x00570478);
export const ARENA1_Z_MIN = f32(0x0057047c);
export const ARENA1_X_MAX = f32(0x00570480);
export const ARENA1_X_MIN = f32(0x00570484);
/** `[0x00570488]` 70.0 — also `Class22CutsceneHoldUntilChapterCard`'s cue frame. */
export const BACK_OFF_DISTANCE = f32(0x00570488);
export const LIE_X_MAX = f32(0x0057048c);

/** `0x44` — the walker's character type, a literal (`0x0048FDD9`). */
export const CLASS23_CHAR_TYPE = 0x44;
/** `0x38D` — the clip `Class23Init` seats, a literal (`0x0048FDDF`). */
export const CLASS23_FIRST_CLIP = 0x38d;

/**
 * Every clip the walker's states name, in `mot/boss1.bin` (bank 4), for the
 * exporter: 0x383..0x394. 0x387 and 0x392 are in the range and named by no
 * state of this class; `bake` is offered the range whole.
 */
export const CLASS23_MOTIONS: readonly number[] =
  Array.from({ length: 0x394 - 0x383 + 1 }, (_u, i) => 0x383 + i);
