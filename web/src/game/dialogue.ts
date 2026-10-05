/**
 * evt `0x2D`, `play_dialogue`: the voice, and the subtitle the game draws for
 * it, glyph by glyph.
 *
 * ```
 * EvtOpPlayDialogue2D        FUN_00435B80   pick the variant, play its voice,
 *                                           allocate the subtitle task
 * DrawDialogueSubtitleTask   FUN_00435AA0   count down, step the line, draw it
 * DrawTextCentred            FUN_00436850   one line, as screen sprites
 * ```
 *
 * The script's opcode is one caller; the civilians' op `0x1D` and three
 * bosses call the same routine (`class10/script.ts`, `class14/fight.ts`,
 * `class22/`, `class45/body.ts`). The task is an `ActorAlloc`'d object the
 * scene walk reaches after the actors, so it is stepped where the port steps
 * its other tasks, and it lives in `G` -- a snapshot carries the line on
 * screen and how long it has left.
 *
 * The text goes through `DrawScreenSprite` (`FUN_0041C6D0`) like every other
 * 2D draw, so the HUD layer draws it from the bundle's images of the glyph
 * sprites. Before this module the countdown lived on the walker, stepped in
 * wall time, always took the one-player variant, and the HUD set the line in
 * the browser's own font.
 */
import type { Events } from "../core/events";
import type { MessageVariant } from "../bundle/sound";
import { CAPTION_MODE } from "./credit_prompt";
import { SUBTITLE_TILDE_SPRITE } from "./dialogue_data";
import { G } from "./globals";
import { DrawScreenSprite } from "./screen_sprite";
import { T } from "./tables";

/** `ActorAlloc(DrawDialogueSubtitleTask, 0x3C)` -- the task's size. */
export const DIALOGUE_TASK_SIZE = 0x3c;

/**
 * `CMP EAX,0xa` / `CMP EAX,0xb` at `0x00435B86` -- the two `g_app_state`
 * values that take player configuration 0 whatever `g_active_player` says.
 * What the two states are is `[open]`; neither is one the port enters.
 */
const CFG0_APP_STATES: readonly number[] = [0xa, 0xb];

/** `PUSH 0x43c00000` at `0x00435B64` -- the baseline the task draws on. */
export const SUBTITLE_BASELINE_Y = 384.0;

/** `DAT_004c49cc` -- f32 320, the screen's centre. */
const TEXT_CENTRE_X = 320.0;
/** `DAT_0055e19c` -- f32 5.6, half an advance a character. */
const TEXT_HALF_ADVANCE = Math.fround(5.6);
/** `DAT_0055e198` -- f32 11.2, the advance. */
const TEXT_ADVANCE = Math.fround(11.2);
/** `PUSH 0x3f333333` twice -- each glyph drawn at 0.7 of its sprite. */
const GLYPH_SCALE = Math.fround(0.7);
/** `PUSH 0x3f800000` -- depth 1.0. */
const GLYPH_DEPTH = 1.0;

/**
 * The lowercase letters' drop below the baseline, from the jump table at
 * `0x004369BC` (indexed `c - 'a'`) and the constants each arm loads: `b i l`
 * 1.0, `f j t` 2.0, `g` 4.0, `p q y` 5.0, `d h k` 0.0, every other letter
 * 3.0 (`0x004368E0`).
 */
const LOWERCASE_DROP: Readonly<Record<string, number>> = {
  a: 3, b: 1, c: 3, d: 0, e: 3, f: 2, g: 4, h: 0, i: 1, j: 2, k: 0, l: 1,
  m: 3, n: 3, o: 3, p: 5, q: 5, r: 3, s: 3, t: 2, u: 3, v: 3, w: 3, x: 3,
  y: 5, z: 3,
};

/**
 * The subtitle task's words. `[port-only]` as a record: the engine's is the
 * 0x3C-byte object `EvtOpPlayDialogue2D` allocates.
 */
export interface DialogueTask {
  /** `[port-only]` -- the engine's identity is the task pointer. */
  id: number;
  /** `+0x34` -- the variant id, `g_screen_message_records[variant]`. */
  variant: number;
  /** `+0x36` -- frames left, a signed word, counted down before the test. */
  frames: number;
  /** `+0x38` -- which of the variant's subtitle lines is on screen. */
  line: number;
}

/** `(s16)` of a word. */
const s16 = (v: number): number => (v << 16) >> 16;

/**
 * `g_pDialogueVariants[index]` -- `u16[group * 3 + cfg]` -- as the bundle
 * carries it, three to a group. Null for a variant id of 0.
 */
function DialogueVariantAt(index: number): MessageVariant | null {
  const group = Math.floor(index / 3);
  const cfg = index - group * 3;
  return T.dialogue?.[String(group)]?.[cfg] ?? null;
}

/**
 * `EvtOpPlayDialogue2D` — `FUN_00435B80`. The task it made, or null.
 *
 * ```
 * cfg = (g_app_state == 10 || g_app_state == 11) ? 0 : g_active_player;
 * variant = g_pDialogueVariants[group * 3 + cfg];
 * if (variant == 0) return;
 * if (g_nEvtSkipFlag || g_cutscene_skipping) return;
 * rec = g_screen_message_records[variant];
 * if (rec.voice) PlaySoundId(rec.voice);
 * task = ActorAlloc(DrawDialogueSubtitleTask, 0x3C);
 * task+0x34 = variant; task+0x36 = rec.frames; task+0x38 = 0;
 * ```
 *
 * `g_active_player` is 0 or 1 for one player alone and 2 for both, so the
 * two-player variant is a different line ("Get them!" where one player hears
 * "Get him!").
 */
export function EvtOpPlayDialogue2D(group: number,
                                    events?: Events): DialogueTask | null {
  const cfg = CFG0_APP_STATES.includes(G.g_app_state) ? 0 : G.g_active_player;
  const v = DialogueVariantAt(group * 3 + cfg);
  if (!v) return null;
  if (G.g_nEvtSkipFlag !== 0 || G.g_cutscene_skipping !== 0) return null;
  if (v.voice !== 0) events?.emit("sound.play", { id: v.voice });
  const t: DialogueTask = {
    id: ++G.g_dialogue_task_seq, variant: v.variant, frames: s16(v.frames),
    line: 0,
  };
  G.g_dialogue_tasks.push(t);
  return t;
}

/**
 * `DrawDialogueSubtitleTask` — `FUN_00435AA0`. One frame of the subtitle;
 * false when the task kills itself.
 *
 * ```
 * if (--frames == 0 || g_nEvtSkipFlag || g_cutscene_skipping) ActorKill();
 * if (g_wCaptionMode == 1) {
 *     rec = g_screen_message_records[variant];
 *     if (rec.sprite == 0) ActorKill();
 *     DrawScreenSprite(rec.sprite, rec.x, rec.y, 1, 1, 1, 0, 7);
 *     return;
 * }
 * if (frames < line_rec[lines[variant * 4 + line]].end_frame) line++;
 * DrawTextCentred(line_rec[...].x_offset, 384.0, line_rec[...].text);
 * ```
 *
 * The countdown is the line's clock: `end_frame` is the frames still left
 * when a line gives way, and the last line's is 0, so it holds to the end
 * and the index never passes it. The sprite arm is the build's other caption
 * mode; `g_wCaptionMode` is 2 here (`credit_prompt.ts`), so it is never
 * taken, and the line is always drawn as text.
 */
export function DrawDialogueSubtitleTask(t: DialogueTask): boolean {
  t.frames = s16(t.frames - 1);
  if (t.frames === 0 || G.g_nEvtSkipFlag !== 0
      || G.g_cutscene_skipping !== 0) {
    return false;
  }
  const v = T.dialogueVariants[t.variant];
  if (!v) return false;
  if (CAPTION_MODE === 1) {
    if (v.sprite === 0) return false;
    DrawScreenSprite(v.sprite, v.x, v.y, 1, 1, 1, 7, 0);
    return true;
  }
  const lines = v.lines ?? [];
  const cur = lines[t.line];
  if (cur && t.frames < s16(cur.end_frame)) t.line = s16(t.line + 1);
  const l = lines[t.line];
  if (l) DrawTextCentred(l.x_offset, SUBTITLE_BASELINE_Y, l.text);
  return true;
}

/**
 * `DrawTextCentred` — `FUN_00436850`. One line of text as screen sprites,
 * centred on the 640-wide screen.
 *
 * ```
 * x = 320 - strlen(text) * 5.6 + x_offset;            // stored as f32
 * for each c:
 *     a..z  DrawScreenSprite(glyphs[c], x, y + drop[c], 1, .7, .7, 0, 0)
 *     A..Z  DrawScreenSprite(glyphs[c], x, y, ...)
 *     '~'   DrawScreenSprite(0x62D, x, y, ...)
 *     else  if (glyphs[c]) DrawScreenSprite(glyphs[c], x, y, ...)
 *     x += 11.2;
 * ```
 *
 * Only the last arm tests the glyph for 0; a letter draws whatever the table
 * holds. `(x, y)` is each glyph's top-left corner (flags 0). The table is
 * indexed by the character's signed byte; every shipped line is ASCII, so the
 * bundle carries `0..0x7F` (`ExeTables.subtitleGlyphs`).
 */
export function DrawTextCentred(xOffset: number, baselineY: number,
                                text: string): void {
  const glyphs = T.subtitleGlyphs;
  if (!glyphs) return;
  let x = Math.fround(TEXT_CENTRE_X - text.length * TEXT_HALF_ADVANCE + xOffset);
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    const drop = LOWERCASE_DROP[ch];
    if (drop !== undefined) {
      DrawScreenSprite(glyphs[c] ?? 0, x, Math.fround(drop + baselineY),
                       GLYPH_DEPTH, GLYPH_SCALE, GLYPH_SCALE, 0, 0);
    } else if (ch >= "A" && ch <= "Z") {
      DrawScreenSprite(glyphs[c] ?? 0, x, baselineY,
                       GLYPH_DEPTH, GLYPH_SCALE, GLYPH_SCALE, 0, 0);
    } else if (ch === "~") {
      DrawScreenSprite(SUBTITLE_TILDE_SPRITE, x, baselineY,
                       GLYPH_DEPTH, GLYPH_SCALE, GLYPH_SCALE, 0, 0);
    } else if ((glyphs[c] ?? 0) !== 0) {
      DrawScreenSprite(glyphs[c], x, baselineY,
                       GLYPH_DEPTH, GLYPH_SCALE, GLYPH_SCALE, 0, 0);
    }
    x = Math.fround(x + TEXT_ADVANCE);
  }
}

/**
 * `[port-only]` -- the subtitle tasks `EvtOpPlayDialogue2D` allocated, once a
 * frame, in allocation order. A task that ends leaves the list.
 */
export function DialogueTasksTick(): void {
  if (!G.g_dialogue_tasks.length) return;
  G.g_dialogue_tasks = G.g_dialogue_tasks.filter(DrawDialogueSubtitleTask);
}
