/**
 * The continue screen -- its draws, its timer and its gate -- against the exe.
 *
 *     node tools/run_ts.mjs tools/checks/continue_screen.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * When the last life goes, `RunPhaseContinueCountdown` (`FUN_00460530`) draws
 * "CONTINUE?" and a countdown digit over a scene that keeps running, each
 * player's task draws its own share (`PlayerContinueCountdown`,
 * `FUN_00414280`: the small CONTINUE? of a two-player game, and the credit
 * line), and every wait opcode of the script holds while nobody is in play.
 * The port has it in `src/game/run_phase.ts`, `continue_readout.ts`,
 * `credit_prompt.ts`, `hud_sprites.ts`, `player_shell.ts` and
 * `script/waits/`. Everything it draws is a sprite id at a position the exe
 * pushes as an immediate or keeps in a small `.rdata` table, so a wrong
 * reading is a picture in the wrong place, or no picture at all, and nothing
 * else notices.
 *
 * What this asserts, and what only this can see:
 *
 * * **The port's positions, scales, sprite ids and timer constants are the
 *   exe's immediates**, read as instruction bytes at the address each one is
 *   pushed or compared from: the run's CONTINUE? and digit, the small ones,
 *   the small GAME OVER, `0x9FFF`, `0x2D`, `0x8000`, the digit base `0x4F`
 *   and the continue buttons `4` / `0x40000`. The exported constants are
 *   imported, so the values checked are the values the port runs; the two
 *   module-private timer constants are read out of their source text.
 * * **The `.rdata` tables** the credit line and the small prompts read --
 *   `g_credit_prompt_pos`, `g_credit_prompt_messages`,
 *   `g_credit_count_layout`, `g_continue_prompt_x`, `g_player_game_over_x`
 *   and `g_app_state_press_start` -- equal the port's tables row for row.
 * * **Only one credit-line drawer can run.** Every store into
 *   `g_credits_to_start` / `g_credits_to_continue` in `.text` is the pair in
 *   `CreditsBootReset` and it stores 1, so `CreditPromptDraw`'s "costs more
 *   than one" entries are unreachable -- which is why the port has only the
 *   first.
 * * **Every sprite the port draws resolves** through the exe's sprite tables
 *   to `scr_common.bin` at the size the port's comments give, and is in the
 *   exporter's list, `CONTINUE_SCREEN_SPRITES`.
 * * **Every wait opcode reads the gameplay gate.** The eight handlers
 *   `0x40..0x47` of the evt dispatch table each name `g_evt_gameplay_live`
 *   (`0x007DCCA4`) -- the reading behind the script standing still on the
 *   continue screen. `wait_camera_path_frame` is among them.
 *
 * Reads the exe only; no bundle.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Checker, f32Bits, gameDirOrSkip, hex, openGame } from "../lib/exe_check";
import { repoRoot } from "../lib/bundle_root";
import {
  RUN_CONTINUE_DIGIT_X, RUN_CONTINUE_DIGIT_Y, RUN_CONTINUE_X, RUN_CONTINUE_Y,
} from "../../src/game/run_phase";
import {
  CONTINUE_DIGIT_DX, CONTINUE_DIGIT_Y, CONTINUE_PROMPT_LAYER, CONTINUE_PROMPT_SX,
  CONTINUE_PROMPT_SY, CONTINUE_PROMPT_X, CONTINUE_PROMPT_Y, PLAYER_GAME_OVER_SX,
  PLAYER_GAME_OVER_SY, PLAYER_GAME_OVER_X, PLAYER_GAME_OVER_Y, SCORE_CHEAT_ON,
  SCORE_CHEAT_Y, SCORE_DIGIT_STEP,
} from "../../src/game/continue_readout";
import { APP_STATE_PRESS_START, CREDIT_PROMPT_POS } from "../../src/game/credit_prompt";
import {
  CONTINUE_SCREEN_SPRITES, CREDIT_COUNT_LAYOUT, CREDIT_PROMPT_MESSAGES, ContinueSprite,
  HudSprite, type CreditPromptRow,
} from "../../src/game/hud_sprites";

const EVT_DISPATCH = 0x005931d8;
const GAMEPLAY_LIVE = 0x007dcca4;
const CREDITS_TO_START = 0x009c8e78;
const CREDITS_TO_CONTINUE = 0x009c8e7c;

const GAME_SRC = join(repoRoot(), "web", "src", "game");

/**
 * `const NAME = <literal>;` in a port source, for a constant the module does
 * not export. Null when the declaration is not there in that shape.
 */
function portConst(src: string, name: string): number | null {
  const m = new RegExp(`\\b(?:export )?const ${name}(?:: number)? = `
    + `(?:Math\\.fround\\()?(-?0x[0-9a-fA-F]+|-?[\\d.]+)\\)?;`).exec(src);
  return m ? Number(m[1]) : null;
}

function le32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

/** `PUSH imm32` of a float, as the exe encodes it. */
const pushF = (v: number): number[] => [0x68, ...le32(f32Bits(v))];
/** `PUSH imm32`. */
const pushI = (v: number): number[] => [0x68, ...le32(v)];

function hexBytes(b: ArrayLike<number>): string {
  return Array.from(b, (x) => (x & 0xff).toString(16).padStart(2, "0")).join("");
}

/** `.text`'s file span and virtual address, from the PE section table. */
function textSection(data: Uint8Array): { va: number; ra: number; rs: number } {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const pe = dv.getUint32(0x3c, true);
  const n = dv.getUint16(pe + 6, true);
  let off = pe + 24 + dv.getUint16(pe + 20, true);
  for (let i = 0; i < n; i++, off += 40) {
    const name = String.fromCharCode(...data.subarray(off, off + 8)).replace(/\0.*$/, "");
    if (name === ".text") {
      return { va: 0x00400000 + dv.getUint32(off + 12, true),
               ra: dv.getUint32(off + 20, true), rs: dv.getUint32(off + 16, true) };
    }
  }
  throw new Error("no .text section");
}

/** Every offset of `needle` in `hay`. */
function findAll(hay: Uint8Array, needle: readonly number[]): number[] {
  const out: number[] = [];
  outer: for (let k = 0; k + needle.length <= hay.length; k++) {
    for (let j = 0; j < needle.length; j++) if (hay[k + j] !== needle[j]) continue outer;
    out.push(k);
  }
  return out;
}

async function main(): Promise<void> {
  const dir = gameDirOrSkip("continue_screen");
  const { exe } = await openGame(dir);
  const c = new Checker("continue_screen");
  const raw = exe.data;

  const at = (va: number): number => {
    const r = exe.v2r(va);
    if (r === null) throw new Error(`${hex(va)} is not in the image`);
    return r;
  };
  const mem = (va: number, n: number): Uint8Array => raw.subarray(at(va), at(va) + n);
  const u32 = (va: number): number => exe.ru32(va)!;
  const fl = (va: number): number => exe.rf32(va)!;

  const rp = readFileSync(join(GAME_SRC, "run_phase.ts"), "utf8");
  const ps = readFileSync(join(GAME_SRC, "player_shell.ts"), "utf8");
  const rpStart = portConst(rp, "CONTINUE_TIMER_START") ?? 0;
  const rpStep = portConst(rp, "CONTINUE_TIMER_STEP") ?? 0;
  const psStart = portConst(ps, "CONTINUE_TIMER_START") ?? 0;
  const psStep = portConst(ps, "CONTINUE_TIMER_STEP") ?? 0;

  // -- the immediates ------------------------------------------------------
  // [instruction address, the bytes the port's value encodes, what the port
  // calls it]
  const imms: [number, number[], string][] = [
    // RunPhaseContinueCountdown
    [0x00460617, pushI(ContinueSprite.Continue), "ContinueSprite.Continue"],
    [0x00460612, pushF(RUN_CONTINUE_X), "RUN_CONTINUE_X"],
    [0x0046060d, pushF(RUN_CONTINUE_Y), "RUN_CONTINUE_Y"],
    [0x0046064d, pushF(RUN_CONTINUE_DIGIT_X), "RUN_CONTINUE_DIGIT_X"],
    [0x00460645, pushF(RUN_CONTINUE_DIGIT_Y), "RUN_CONTINUE_DIGIT_Y"],
    [0x0046064a, [0x83, 0xc0, ContinueSprite.BigDigit0], "ContinueSprite.BigDigit0"],
    [0x00460587, [0xba, ...le32(rpStart)], "run_phase CONTINUE_TIMER_START"],
    [0x0046068a, [0x83, 0xe8, rpStep], "run_phase CONTINUE_TIMER_STEP"],
    [0x004605c8, [0x83, 0xe0, 0x04], "the player-0 continue button, g_pad_state & 4"],
    [0x004605d9, [0x81, 0xe1, ...le32(0x40000)], "the player-1 continue button, & 0x40000"],
    [0x004605e5, [0x81, 0xfa, ...le32(0x8000)], "the knock's ceiling, CMP EDX, 0x8000"],
    // PlayerStateArmContinue / PlayerContinueCountdown
    [0x00414304, [0xc7, 0x46, 0x68, ...le32(psStart)], "player_shell CONTINUE_TIMER_START"],
    [0x00414344 + 3, [0x83, 0xc1, -psStep & 0xff],
     "player_shell CONTINUE_TIMER_STEP (ADD ECX, -0x2D)"],
    [0x00414334, [0x3d, ...le32(0x8000)], "the per-player knock's ceiling"],
    // HudDrawContinuePrompt / HudDrawContinueDigit
    [0x004168a6, pushI(ContinueSprite.Continue), "HudDrawContinuePrompt's sprite"],
    [0x004168a0, pushF(CONTINUE_PROMPT_Y), "CONTINUE_PROMPT_Y"],
    [0x00416896, pushF(CONTINUE_PROMPT_SX), "CONTINUE_PROMPT_SX"],
    [0x00416891, pushF(CONTINUE_PROMPT_SY), "CONTINUE_PROMPT_SY"],
    [0x00416884, [0x6a, CONTINUE_PROMPT_LAYER], "CONTINUE_PROMPT_LAYER"],
    [0x004168e6, pushF(CONTINUE_DIGIT_Y), "CONTINUE_DIGIT_Y"],
    [0x004168f0, [0x83, 0xc1, ContinueSprite.BigDigit0], "HudDrawContinueDigit's digit base"],
    // HudDrawPlayerGameOver
    [0x00416924, pushI(ContinueSprite.GameOver), "ContinueSprite.GameOver"],
    [0x0041691e, pushF(PLAYER_GAME_OVER_Y), "PLAYER_GAME_OVER_Y"],
    [0x00416914, pushF(PLAYER_GAME_OVER_SX), "PLAYER_GAME_OVER_SX"],
    [0x00416908, pushF(PLAYER_GAME_OVER_SY), "PLAYER_GAME_OVER_SY"],
    // HudDrawScoreCheat
    [0x00413fb0, [0x83, 0x3d, ...le32(0x009c87fc), SCORE_CHEAT_ON], "SCORE_CHEAT_ON"],
    [0x00413fc6, pushF(SCORE_CHEAT_Y), "SCORE_CHEAT_Y"],
    // CreditBlinkTick's attract prompt
    [0x00406842, [0xc7, 0x05, ...le32(0x005a4ce8), ...le32(ContinueSprite.PressStartAttract)],
     "ContinueSprite.PressStartAttract"],
  ];
  for (const [va, want, what] of imms) {
    const got = mem(va, want.length);
    const same = want.every((b, i) => got[i] === b);
    c.ok(same, same
      ? `${what}: ${hex(va, 8)} holds ${hexBytes(want)}`
      : `${what}: the exe at ${hex(va, 8)} is ${hexBytes(got)}, `
        + `the port's reading encodes ${hexBytes(want)}`);
  }
  c.ok(portConst(rp, "CONTINUE_TIMER_START") === 0x9fff
       && portConst(ps, "CONTINUE_TIMER_START") === 0x9fff,
       "the two continue timers both start at 0x9FFF");
  // The small digit's x step and the score digits' step are floats in .rdata.
  c.eq(CONTINUE_DIGIT_DX, fl(0x004ecb6c), "CONTINUE_DIGIT_DX is the exe's float at 0x004ECB6C");
  c.eq(SCORE_DIGIT_STEP, fl(0x004d1d20), "SCORE_DIGIT_STEP is the exe's float at 0x004D1D20");
  c.eq(u32(0x00413ffd), f32Bits(0.99), "the score record's depth is 0x3F7D70A4 (0.99)");

  // -- the tables ----------------------------------------------------------
  const pos = [0, 1].map((p) => [fl(0x00577620 + 8 * p), fl(0x00577624 + 8 * p)]);
  const portPos = CREDIT_PROMPT_POS.map((r) => [r.x, r.y]);
  c.ok(JSON.stringify(portPos) === JSON.stringify(pos),
       `g_credit_prompt_pos is ${JSON.stringify(pos)}; the port's `
       + `CREDIT_PROMPT_POS ${JSON.stringify(portPos)}`);

  // `{f32 dx, f32 dy, f32 scale, u32 id}`: dx and dy as values, the scale as
  // the port's number rounded to the record's float.
  const rows = (va: number): number[][] => Array.from({ length: 4 }, (_u, i) =>
    [fl(va + 16 * i), fl(va + 16 * i + 4), fl(va + 16 * i + 8), u32(va + 16 * i + 12)]);
  const portRows = (t: readonly CreditPromptRow[]): number[][] =>
    t.map((r) => [r.dx, r.dy, Math.fround(r.scale), r.id]);
  for (const [va, name, table] of [
    [0x004c4b10, "CREDIT_PROMPT_MESSAGES", CREDIT_PROMPT_MESSAGES],
    [0x004c4a40, "CREDIT_COUNT_LAYOUT", CREDIT_COUNT_LAYOUT],
  ] as const) {
    const e = rows(va);
    const p = portRows(table);
    c.ok(JSON.stringify(e) === JSON.stringify(p),
         `${name} is the exe's four rows at ${hex(va, 8)}`
         + (JSON.stringify(e) === JSON.stringify(p) ? ""
           : `: the port's ${JSON.stringify(p)}, the exe's ${JSON.stringify(e)}`));
  }
  for (const [va, name, arr] of [
    [0x00579f68, "CONTINUE_PROMPT_X", CONTINUE_PROMPT_X],
    [0x00579f70, "PLAYER_GAME_OVER_X", PLAYER_GAME_OVER_X],
  ] as const) {
    const e = [fl(va), fl(va + 4)];
    c.ok(JSON.stringify([...arr]) === JSON.stringify(e),
         `${name} ${JSON.stringify(arr)} is the exe's ${JSON.stringify(e)} at ${hex(va, 8)}`);
  }
  const press = Array.from({ length: 17 }, (_u, a) => {
    const v = exe.ru16(0x004c4b90 + 4 * a)!;
    return v >= 0x8000 ? v - 0x10000 : v;
  });
  c.ok(JSON.stringify([...APP_STATE_PRESS_START]) === JSON.stringify(press),
       `APP_STATE_PRESS_START is g_app_state_press_start's ${JSON.stringify(press)}`);
  c.ok(press[6] === 0 && press[7] === 0,
       "the attract PRESS START is not marked for app state 6 or 7");
  c.note(`the PRESS START screens: ${JSON.stringify(
    press.flatMap((v, a) => (v ? [a] : [])))}`);

  // -- only one credit-line drawer -------------------------------------------
  const text = textSection(raw);
  const body = raw.subarray(text.ra, text.ra + text.rs);
  const stores: number[] = [];
  for (const addr of [CREDITS_TO_START, CREDITS_TO_CONTINUE]) {
    for (const k of findAll(body, le32(addr))) {
      const op1 = body[k - 1]!;
      const op2 = body[k - 2]!;
      // `MOV [moffs32], EAX`, or a ModRM `[disp32]` operand of an
      // instruction that writes its memory operand.
      const direct = op1 === 0xa3
        || ([0x89, 0xc7, 0x83, 0x81, 0xff, 0x01, 0x29, 0x09, 0x21, 0x31].includes(op2)
            && (op1 & 0xc7) === 0x05);
      if (direct) stores.push(text.va + k - (op1 === 0xa3 ? 1 : 2));
    }
  }
  stores.sort((a, b) => a - b);
  c.ok(JSON.stringify(stores) === JSON.stringify([0x004066d7, 0x004066dc]),
       `the stores into the credit costs are CreditsBootReset's two, at `
       + `${stores.map((s) => hex(s, 8)).join(", ")}`);
  c.ok(hexBytes(mem(0x004066d0, 5)) === "b801000000",
       "CreditsBootReset loads 1 (MOV EAX, 1 at 0x004066D0) before storing the costs");
  const drawers = [0, 1, 2].map((i) => u32(0x00577640 + 4 * i));
  c.eq(drawers[0], 0x00406860, "g_credit_prompt_drawers[0] is CreditPromptDrawSingle");
  c.note(`drawers: ${drawers.map((d) => hex(d, 8)).join(", ")}; the costs are stored `
         + "only by CreditsBootReset, as 1 -- entry 0 is the only one");

  // -- the sprites resolve -----------------------------------------------------
  const sizes: Record<string, [number, number]> = {
    Continue: [512, 64], Credits: [128, 32], FreePlay: [128, 32],
    GameOver: [512, 64], InsertCoins: [256, 32], InsertMoreCoins: [256, 32],
    PressStart: [128, 16], PressStartAttract: [512, 32],
  };
  const ids = new Map<string, number>();
  for (const [name, v] of Object.entries(ContinueSprite)) {
    if (typeof v === "number" && name !== "BigDigit0") ids.set(name, v);
  }
  for (let d = 0; d < 10; d++) ids.set(`BigDigit${d}`, ContinueSprite.BigDigit0 + d);
  for (const [name, sid] of ids) {
    const want = sizes[name] ?? [64, 128];
    const hit = exe.screenSprite(sid);
    if (hit === null) {
      c.fail(`ContinueSprite ${name} ${hex(sid)} resolves to no texture`);
      continue;
    }
    const [bank, e] = hit;
    c.ok(bank === "scr_common" && e.width === want[0] && e.height === want[1],
         `${name} ${hex(sid)} is ${bank} ${e.width}x${e.height}; the port says `
         + `scr_common ${want[0]}x${want[1]}`);
  }
  c.eq(HudSprite.Digit0, 0x59, "the credit count's digits are HudSprite.Digit0, 0x59");
  const exporter = readFileSync(join(repoRoot(), "web", "src", "hod2lib", "bundle.ts"), "utf8");
  c.ok(exporter.includes("CONTINUE_SCREEN_SPRITES"),
       "the exporter puts CONTINUE_SCREEN_SPRITES in the bundle");
  const missing = [...ids].filter(([, sid]) => !CONTINUE_SCREEN_SPRITES.includes(sid));
  c.ok(missing.length === 0,
       `CONTINUE_SCREEN_SPRITES holds all ${ids.size} ids`
       + (missing.length ? `; not ${missing.map(([n, s]) => `${n} ${hex(s)}`).join(", ")}` : ""));

  // -- every wait opcode reads the gate -----------------------------------------
  const handlers = Array.from({ length: 9 }, (_u, i) => u32(EVT_DISPATCH + 4 * (0x40 + i)));
  const live = le32(GAMEPLAY_LIVE);
  for (let i = 0; i < 8; i++) {
    const lo = handlers[i]!;
    const hi = handlers[i + 1]!;
    c.ok(lo < hi && findAll(mem(lo, hi - lo), live).length > 0,
         `wait opcode ${hex(0x40 + i)}'s handler ${hex(lo, 8)} names `
         + `g_evt_gameplay_live (${hex(GAMEPLAY_LIVE, 8)})`);
  }

  c.finish();
}

await main();
