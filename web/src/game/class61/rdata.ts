/**
 * The result card's `.rdata`, read the way the exe reads it: by address.
 *
 * `ResultCardInstall` (`FUN_00434EF0`) and `ResultCardTally`
 * (`FUN_00435930`) walk a scene's figure records with no bound
 * (`docs/re/stage-end.md`, section 3), and `ResultCardFigureInit`
 * (`FUN_004356A0`) indexes the attachment lists by character type with none
 * either. A decoded table would answer a read past its end with nothing,
 * where the exe answers with the next table's bytes -- so the bundle carries
 * the whole span, `0x0055DD80..0x0055E074`, and every read here names the
 * address the instruction does. The addresses themselves are immediates in
 * the routines (`MOV ESI, 0x55dff8` and so on) and stay here.
 *
 * A read outside the span answers `null`. Inside the shipped data nothing
 * reaches it: the longest unbounded read is ten records from scene 3's list
 * at `0x0055DF00`, which ends at `0x0055DFC8`.
 */
import { T } from "../tables";

/** `g_result_figure_records` — `0x0055DD80`, 0x14 bytes each. */
export const RESULT_FIGURE_RECORD_SIZE = 0x14;

/** `g_result_figure_attachments` — `0x0055DF68`, s16[3] per type from 0x20. */
export const G_RESULT_FIGURE_ATTACHMENTS = 0x0055df68;
/** The first character type the table has a list for: `SUB EAX, 0x20`. */
export const RESULT_FIGURE_FIRST_TYPE = 0x20;
/** `LEA EAX, [EAX + EAX*0x2]` then `*2`: six bytes a type. */
export const RESULT_FIGURE_ATTACHMENT_STRIDE = 6;

/** `g_result_glyphs_rescued` — `0x0055DFF8`, nine slots (`CMP ESI, 0x55e00a`). */
export const G_RESULT_GLYPHS_RESCUED = 0x0055dff8;
export const RESULT_GLYPHS_RESCUED_END = 0x0055e00a;
/** `g_result_glyphs_life_bonus` — `0x0055E00C`, twelve (`CMP ESI, 0x55e024`). */
export const G_RESULT_GLYPHS_LIFE_BONUS = 0x0055e00c;
export const RESULT_GLYPHS_LIFE_BONUS_END = 0x0055e024;
/** `g_result_glyphs_score` — `0x0055E024`, seven (`CMP ESI, 0x55e032`). */
export const G_RESULT_GLYPHS_SCORE = 0x0055e024;
export const RESULT_GLYPHS_SCORE_END = 0x0055e032;
/**
 * `g_result_glyphs_accuracy` — `0x0055E034`, eight: `CMP ESI, 0x55e042` and
 * `JLE`, so `0x0055E042` itself is drawn.
 */
export const G_RESULT_GLYPHS_ACCURACY = 0x0055e034;
export const RESULT_GLYPHS_ACCURACY_LAST = 0x0055e042;
/** `g_result_life_bonus` — `0x0055E044`, u8[6][8]. */
export const G_RESULT_LIFE_BONUS = 0x0055e044;
/** The row index's cap: `CMP CX, 0x8; JL`, else `[scene*8 + 0x55e04b]`. */
export const RESULT_LIFE_BONUS_ROW = 8;

/** One figure record as the exe reads it. */
export interface ResultFigureRecord {
  /** `+0x00`, s16: the character type, -1 ending a list. */
  type: number;
  /** `+0x02`, s16: the motion a rescued figure plays. */
  motion: number;
  /** `+0x04`, `+0x08`, `+0x0C`, f32. */
  x: number;
  y: number;
  z: number;
  /** `+0x10`, s32 BAMS: the yaw. */
  yaw: number;
}

/** `[port-only]` -- the span's bytes, decoded once per bundle block. */
let decoded: { hex: string; view: DataView } | null = null;

/** `[port-only]` -- the span as a `DataView`, or null with no block. */
function Span(): { base: number; view: DataView } | null {
  const rc = T.resultCard;
  if (!rc) return null;
  if (!decoded || decoded.hex !== rc.bytes) {
    const n = rc.bytes.length >> 1;
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      bytes[i] = Number.parseInt(rc.bytes.slice(i * 2, i * 2 + 2), 16);
    }
    decoded = { hex: rc.bytes, view: new DataView(bytes.buffer) };
  }
  return { base: rc.base, view: decoded.view };
}

/** `[port-only]` -- `n` bytes at `va` are inside the span. */
function Inside(va: number, n: number): { off: number; view: DataView } | null {
  const s = Span();
  if (!s) return null;
  const off = va - s.base;
  if (off < 0 || off + n > s.view.byteLength) return null;
  return { off, view: s.view };
}

/** `[port-only]` -- an s16 at `va`, as `MOVSX` reads it. */
export function RdataS16(va: number): number | null {
  const r = Inside(va, 2);
  return r ? r.view.getInt16(r.off, true) : null;
}

/** `[port-only]` -- a u16 at `va`, as `MOV CX, word ptr [ESI]` reads it. */
export function RdataU16(va: number): number | null {
  const r = Inside(va, 2);
  return r ? r.view.getUint16(r.off, true) : null;
}

/** `[port-only]` -- an s8 at `va`, as `MOV AL, byte ptr` and `MOVSX` read it. */
export function RdataS8(va: number): number | null {
  const r = Inside(va, 1);
  return r ? r.view.getInt8(r.off) : null;
}

/** `[port-only]` -- figure record `i` of the list at `list`. */
export function ResultFigureRecordAt(list: number, i: number):
    ResultFigureRecord | null {
  const va = list + i * RESULT_FIGURE_RECORD_SIZE;
  const r = Inside(va, RESULT_FIGURE_RECORD_SIZE);
  if (!r) return null;
  const v = r.view;
  return {
    type: v.getInt16(r.off, true),
    motion: v.getInt16(r.off + 2, true),
    x: v.getFloat32(r.off + 4, true),
    y: v.getFloat32(r.off + 8, true),
    z: v.getFloat32(r.off + 12, true),
    yaw: v.getInt32(r.off + 16, true),
  };
}

/**
 * `[port-only]` -- `g_result_figure_lists[scene]` (`0x0055DF50`), the
 * address of the scene's first record, or null with no block.
 */
export function ResultFigureList(scene: number): number | null {
  return T.resultCard?.lists[scene] ?? null;
}

/**
 * `[port-only]` -- the attachment list a result figure of `type` wears:
 * `g_result_figure_attachments + (type - 0x20) * 6`, read up to its first
 * negative the way `ActorBindPartList` walks it. `first` is the word
 * `ResultCardFigureInit` tests against -1 before binding.
 */
export function ResultFigureAttachmentsOf(type: number):
    { first: number | null; list: number[] } {
  const va = G_RESULT_FIGURE_ATTACHMENTS
    + (type - RESULT_FIGURE_FIRST_TYPE) * RESULT_FIGURE_ATTACHMENT_STRIDE;
  const list: number[] = [];
  for (let a = va; ; a += 2) {
    const id = RdataS16(a);
    if (id === null || id < 0) break;
    list.push(id);
  }
  return { first: RdataS16(va), list };
}

/**
 * `[port-only]` -- `g_accuracy_bonus_table[i]` (`0x00567990`), 0 past its
 * eleven entries or with no block.
 */
export function AccuracyBonusAt(i: number): number {
  return T.resultCard?.accuracy_bonus[i] ?? 0;
}
