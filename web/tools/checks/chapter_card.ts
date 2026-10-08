/**
 * The chapter card -- the title at the top of every stage -- against the exe.
 *
 *     node tools/run_ts.mjs tools/checks/chapter_card.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * `ChapterCardInstall` (0x004342E0), `ChapterTitleReset` (0x00436A30),
 * `ChapterTitleDraw` (0x00436AD0), `BossModeChapterCardUpdate` (0x00434920)
 * and `AttractScene11ChapterCardUpdate` (0x00434DA0) are ported in
 * `src/game/class60/`. The port holds three kinds of number from them: the
 * story card's immediates, as constants; `ChapterTitleDraw`'s `.rdata`
 * floats, as constants named with their address; and the variant arms'
 * `.rdata` tables, through the bundle. What this asserts, and what only this
 * can see:
 *
 * * **Every sprite id, anchor point, dwell and model word the port transcribes
 *   is the immediate at its instruction** -- read out of the instruction bytes
 *   through the routine's own two jump tables, not typed in twice.
 * * **Every float `title.ts` names by an `.rdata` address is the float there**
 *   -- each `// [0x...]` beside a constant in the source, parsed.
 * * **The title's sprites can be drawn**: each resolves through
 *   `g_screen_sprite_bank` to its scene's `scr_chapter_st1..6`, a PAL4 image,
 *   and `TexBankPaletteIndex`'s arm for those six banks is the constant the
 *   exporter uses (byte table `0x0041CB90` -> jump entry 16 -> `MOV EAX, 0xB`).
 * * **The variant arms' tables are where their instructions read them**, and
 *   `ExeTables.chapterCardTables` is those bytes.
 * * With a bundle (`HOTD2_BUNDLE` or `extract/player`): each story stage
 *   carries its scene's eight title sprites and the `chapter_card` block, and
 *   stage 6 carries slot `0x1730`'s model in `slots_effect`. Without one, those
 *   are skipped and it says so; the rest still asserts.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Checker, f32Bits, gameDirOrSkip, hex, openGame } from "../lib/exe_check";
import { BUNDLE_ROOT, repoRoot } from "../lib/bundle_root";
import { BANK_PALETTE_CONST } from "../../src/hod2lib/exetab";
import {
  CHAPTER_CARD_FRAMES, CHAPTER_CARD_SKIPPABLE_BELOW, PAD_SKIP_PLAYER0,
  PAD_SKIP_PLAYER1,
} from "../../src/game/class60/index";
import {
  CHAPTER_CAPTION_SPRITE_FIRST, CHAPTER_CARD_FLAG, CHAPTER_CARD_MODEL_SLOT,
  CHAPTER_TITLE_ORIGINS, CHAPTER_TITLE_SPRITES,
} from "../../src/game/class60/state";
import { ATTRACT11_CARD_FRAMES } from "../../src/game/class60/attract";

/** `ChapterCardInstall`'s three jump tables: setup, draw, texbank free. */
const SETUP_ARMS = 0x004348d8;
const DRAW_ARMS = 0x004348f0;
const FREE_ARMS = 0x00434908;
const TITLE_DRAW = 0x00436ad0;
const TITLE_RESET = 0x00436a30;
const SCENES = 6;

const CLASS60 = join(repoRoot(), "web", "src", "game", "class60");

/** The JSON chunk of a `.glb`. */
function glbJson(path: string): { nodes?: { name?: string }[] } {
  const b = readFileSync(path);
  let off = 12;
  while (off + 8 <= b.length) {
    const len = b.readUInt32LE(off);
    if (b.readUInt32LE(off + 4) === 0x4e4f534a) {
      return JSON.parse(b.subarray(off + 8, off + 8 + len).toString("utf8"));
    }
    off += 8 + len;
  }
  throw new Error(`${path}: no JSON chunk`);
}

async function main(): Promise<void> {
  const dir = gameDirOrSkip("chapter_card");
  const { exe } = await openGame(dir);
  const c = new Checker("chapter_card");
  const u8 = (va: number): number => exe.data[exe.v2r(va)!]!;
  const u16 = (va: number): number => u8(va) | (u8(va + 1) << 8);
  const u32 = (va: number): number => (u16(va) | (u16(va + 2) << 16)) >>> 0;
  const f32 = (va: number): number => {
    const d = new DataView(new ArrayBuffer(4));
    d.setUint32(0, u32(va), true);
    return d.getFloat32(0, true);
  };
  /** The target of the `CALL rel32` at `va`, or null if it is not one. */
  const callAt = (va: number): number | null =>
    u8(va) === 0xe8 ? (va + 5 + (u32(va + 1) | 0)) >>> 0 : null;

  // -- the story card's immediates ------------------------------------------
  for (let scene = 0; scene < SCENES; scene++) {
    const arm = u32(SETUP_ARMS + scene * 4);
    c.eq(callAt(arm), TITLE_RESET,
         `scene ${scene}'s setup arm (${hex(arm)}) opens with ChapterTitleReset`);
    const ids: number[] = [];
    let ok = true;
    for (let i = 0; i < 8; i++) {
      const va = arm + 5 + i * 9;              // MOV word ptr [imm32], imm16
      ok &&= u8(va) === 0x66 && u8(va + 1) === 0xc7 && u8(va + 2) === 0x05
        && u32(va + 3) === 0x007dcba0 + i * 2;
      ids.push(u16(va + 7));
    }
    c.ok(ok, `scene ${scene}'s arm writes 0x007DCBA0..AE with eight MOVs`);
    c.eq(ids.join(","), CHAPTER_TITLE_SPRITES[scene].join(","),
         `scene ${scene}'s eight title sprites are the port's`);
  }
  for (let scene = 0; scene < SCENES; scene++) {
    const arm = u32(DRAW_ARMS + scene * 4);
    // The four PUSH imm32 straight before the arm's CALL ChapterTitleDraw.
    let call = -1;
    for (let va = arm; va < arm + 0x80; va++) {
      if (callAt(va) === TITLE_DRAW) { call = va; break; }
    }
    if (!c.ok(call > 0, `scene ${scene}'s draw arm calls ChapterTitleDraw`)) continue;
    const pushed: number[] = [];
    for (let k = 1; k <= 4; k++) {
      const va = call - k * 5;
      pushed.push(u8(va) === 0x68 ? f32(va + 1) : Number.NaN);
    }
    // PUSHed last is the first argument.
    c.eq(pushed.join(","), CHAPTER_TITLE_ORIGINS[scene].join(","),
         `scene ${scene}'s anchor points are the four floats it pushes`);
    // Its caption: PUSH 0x42B + scene before the CALL ScreenSpriteDraw.
    let caption = -1;
    for (let va = call; va < call + 0x60; va++) {
      if (u8(va) === 0x68 && u32(va + 1) >= 0x42b && u32(va + 1) <= 0x430) {
        caption = u32(va + 1);
        break;
      }
    }
    c.eq(caption, CHAPTER_CAPTION_SPRITE_FIRST + scene,
         `scene ${scene}'s caption sprite is 0x42B + scene`);
  }
  // The dwell, `MOV word ptr [ESI + 0x11c], 0xb4` at 0x004345AB.
  c.eq(u8(0x004345ab) === 0x66 && u8(0x004345ac) === 0xc7 ? u16(0x004345b2) : -1,
       CHAPTER_CARD_FRAMES, "the dwell is the word the latch stores");
  c.eq(u8(0x00434810) === 0x66 ? u16(0x00434817) : -1,
       CHAPTER_CARD_SKIPPABLE_BELOW,
       "player 0's skip needs the dwell below CMP word ptr [ESI+0x11c], 0xa0");
  c.eq(u8(0x0043481c), PAD_SKIP_PLAYER0, "player 0's skip is TEST AL, 0x2");
  c.eq(u32(0x00434820), PAD_SKIP_PLAYER1, "player 1's is TEST EAX, 0x20000");
  c.eq(u32(0x004348c3), 0x009c7200 + CHAPTER_CARD_FLAG,
       "the flag the countdown raises is g_script_flags[0xF8]");
  c.eq(u32(0x004347a3), CHAPTER_CARD_MODEL_SLOT, "scene 5 draws slot 0x1730");
  c.eq(f32(0x0043476d), -30, "...30 ahead of the eye (PUSH 0xC1F00000)");
  c.eq(u32(0x0043477b), 0x8000, "...turned MatrixRotateY(0x8000)");
  c.eq(f32(0x00434785), 2, "...at scale 2");
  for (let scene = 0; scene < SCENES; scene++) {
    const arm = u32(FREE_ARMS + scene * 4);
    const bank = scene === 5 ? u32(arm + 0x0b) : u32(arm + 1);
    c.eq(bank, 0x18c + scene, `scene ${scene} frees texbank 0x18C + scene`);
  }
  c.eq(u16(0x00434dc0 + 7), ATTRACT11_CARD_FRAMES,
       "app state 0x0B's dwell is MOV word ptr [EBP+0x11c], 0xc8");

  // -- ChapterTitleDraw's .rdata, as title.ts names it ----------------------
  const title = readFileSync(join(CLASS60, "title.ts"), "utf8");
  const named = [...title.matchAll(
    /const (\w+) = (?:f32\()?([0-9.]+)\)?;\s*\/\/ \[0x([0-9A-Fa-f]{8})\]/g)];
  c.ok(named.length >= 20, `title.ts names ${named.length} .rdata floats`);
  for (const m of named) {
    const va = Number.parseInt(m[3]!, 16);
    c.eq(f32Bits(Math.fround(Number(m[2]))), f32Bits(f32(va)),
         `${m[1]} is the float at ${hex(va)} (${f32(va)})`);
  }

  // -- the title's sprites, and the palette they are drawn with -------------
  for (let bank = 0x18c; bank <= 0x191; bank++) {
    const byte = u8(0x0041cb90 + bank - 0x147);
    const target = u32(0x0041cb38 + byte * 4);
    const movEax = u8(target) === 0xb8 ? u32(target + 1) : -1;
    c.eq(movEax, BANK_PALETTE_CONST.get(bank) ?? -2,
         `TexBankPaletteIndex(${hex(bank)}) is ${hex(movEax)} (entry ${byte}), `
         + "as the exporter binds it");
  }
  for (let scene = 0; scene < SCENES; scene++) {
    for (const id of CHAPTER_TITLE_SPRITES[scene]) {
      const hit = exe.screenSprite(id);
      c.ok(hit !== null && hit[0] === `scr_chapter_st${scene + 1}`
           && hit[2] !== null,
           `sprite ${hex(id)} is a paletted image of scr_chapter_st${scene + 1}`
           + (hit ? ` (${hit[0]} ${hit[1].width}x${hit[1].height})` : ""));
    }
  }

  // -- the variant arms' tables ---------------------------------------------
  c.eq(u32(0x004349cc + 4), 0x0055dd50,
       "Boss Mode's backdrop ids are read at 0x0055DD50");
  c.eq(u32(0x00434a28 + 2), 0x0055dd5c, "...its flags at 0x0055DD5C");
  c.eq(u32(0x00434e61 + 4), 0x0055dd64, "app state 0x0B's frames at 0x0055DD64");
  c.eq(u32(0x00434e24 + 4), 0x0055dd70, "...its flash frames at 0x0055DD70");
  const tables = exe.chapterCardTables() as Record<string, number[]>;
  const s16 = (va: number) => (u16(va) << 16) >> 16;
  c.eq(tables.boss_mode_backdrop_sprites.join(","),
       Array.from({ length: 6 }, (_u, i) => s16(0x0055dd50 + i * 2)).join(","),
       "chapterCardTables' backdrop ids are the exe's");
  c.eq(tables.boss_mode_backdrop_flags.join(","),
       Array.from({ length: 6 }, (_u, i) => u8(0x0055dd5c + i)).join(","),
       "...its flags");
  c.eq(tables.attract11_frames.join(",") + ";" + tables.attract11_flash_frames.join(","),
       Array.from({ length: 5 }, (_u, i) => s16(0x0055dd64 + i * 2)).join(",") + ";"
       + Array.from({ length: 5 }, (_u, i) => s16(0x0055dd70 + i * 2)).join(","),
       "...and app state 0x0B's frames");

  // -- the bundle -----------------------------------------------------------
  const manifestPath = join(BUNDLE_ROOT, "manifest.json");
  if (!existsSync(manifestPath)) {
    c.note(`no bundle at ${BUNDLE_ROOT}: the stages' sprites, block and model `
           + "were not checked");
    c.finish();
  }
  const entries = (JSON.parse(readFileSync(manifestPath, "utf8")) as {
    stages: { name: string; script: string; geometry: string }[] }).stages;
  for (const e of entries) {
    const m = /^stage(\d)(_original)?$/.exec(e.name);
    if (!m) continue;
    const scene = Number(m[1]) - 1;
    const script = JSON.parse(readFileSync(join(BUNDLE_ROOT, e.name, e.script),
                                           "utf8")) as {
      screen_sprites?: Record<string, unknown>;
      chapter_card?: Record<string, number[]>;
    };
    const missing = CHAPTER_TITLE_SPRITES[scene]
      .filter((id) => !(String(id) in (script.screen_sprites ?? {})));
    c.ok(missing.length === 0, `${e.name} carries its scene's eight title sprites`
         + (missing.length ? `; not ${missing.map((x) => hex(x)).join(",")}` : ""));
    c.eq(JSON.stringify(script.chapter_card ?? null), JSON.stringify(tables),
         `${e.name}'s chapter_card block is the exe's`);
    if (scene === 5) {
      const nodes = glbJson(join(BUNDLE_ROOT, e.name, e.geometry)).nodes ?? [];
      c.ok(nodes.some((n) => /^slots_effect_.*_slot_1730$/.test(n.name ?? "")),
           `${e.name} carries slot 0x1730's model for the card to draw`);
    }
  }
  c.finish();
}

await main();
