/**
 * The options screen and the profile against the exe.
 *
 *     node tools/run_ts.mjs tools/checks/options.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * The options screen (app state 0x0C, `OptionsRunPhase` at 0x004869E0) and the
 * profile it edits are read in `docs/re/options-screen.md` and ported in
 * `src/game/options/`, `profile.ts` and `options_data.ts`. Most of what the
 * port does there is a number the exe pushes or copies -- a sprite id, a
 * position, a factory byte -- and a few of the reading's claims are negatives
 * that decide what the port may leave out. Those are what this holds.
 *
 * What this asserts, and what only this can see:
 *
 * * **The profile reading is right, on the user's own save.** The install's
 *   four disguised files (`g_profile_file_names`) are read -- never written --
 *   deciphered with the key `ProfileCipher` (`FUN_004A06F0`) builds on its
 *   stack, taken out of the instruction stream rather than typed in, and the
 *   block's byte sum is checked against the dword at `0x009CA068` and its
 *   version against 7. A wrong key, stride or order reads garbage, and the sum
 *   says so. The key's reader knows only the instruction forms that routine
 *   uses and fails on any other, so it cannot fall out of step silently (L22).
 * * **Blood Color is dead in this build**: every instruction in `.text` that
 *   names the row's gate `0x007DD030` is a `MOV`, and the one store stores
 *   `BL`, which `XOR EBX, EBX` zeroed; the only instruction naming
 *   `0x009C9F22` that is not a store into it is the screen's own copy. Both
 *   are searches for the address's bytes, which finds an operand naming it in
 *   every addressing mode (L32).
 * * **The port's factory tables are the `.data` `OptionsFactoryReset`
 *   copies** -- the four option bytes, the sight speed, all forty binding
 *   masks and the eight calibration dwords -- and `g_start_lives_by_option`,
 *   imported from `options_data.ts`, so the values checked are the port's.
 * * **The sprite ids and background bases the port pushes are the
 *   immediates**, at the instruction that pushes each, and every sprite the
 *   screen draws resolves to a bank at the size the reading gives.
 * * **The glyph table is 96 entries from 0x0056AF10**: the SE test's table
 *   ends exactly there, so `[char*2 + 0x0056AED0]` below a space would read
 *   sound ids.
 * * With a bundle (`HOTD2_BUNDLE` or `extract/player`), its `options` block is
 *   `ExeTables.optionsTables`, field for field. Without one that part is
 *   skipped and says so; the rest still asserts.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Checker, gameDirOrSkip, hex, openGame } from "../lib/exe_check";
import { BUNDLE_ROOT } from "../lib/bundle_root";
import type { ExeTables } from "../../src/hod2lib/exetab";
import {
  GUN_CALIBRATION_FACTORY, INPUT_BINDINGS_DEFAULT, OPTION_9F28_FACTORY,
  OPTIONS_BACKGROUND_BASES, OPTIONS_FACTORY, OptionsSprite, SIGHT_SPEED_FACTORY,
  START_LIVES_BY_OPTION,
} from "../../src/game/options_data";

const PROFILE = 0x009c9120;
const PROFILE_LEN = 0xf4c;
const PROFILE_SUMMED = 0xf48;
const PROFILE_FILES = 0x005985c4;
const PROFILE_PART = 0x3db;
const CIPHER = 0x004a06f0;
const CIPHER_KEY_END = 0x004a0b29;
const KEY_LEN = 0xb0;
const BLOOD_ROW_SHOWN = 0x007dd030;
const BLOOD_COLOR = 0x009c9f22;

function le32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

function hexBytes(b: ArrayLike<number>): string {
  return Array.from(b, (x) => (x & 0xff).toString(16).padStart(2, "0")).join("");
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

/**
 * The 176 bytes `ProfileCipher` stores on its stack before its loop: its
 * `MOV byte ptr [ESP + n], imm8 / r8` stores, with the `MOV r8, imm8` loads
 * that feed them and the pushes that move ESP between them. The span
 * `0x004A06F0..0x004A0B29` is straight-line code of nine instruction forms;
 * any other form is refused with its address rather than skipped, so the
 * walk cannot drift out of step.
 */
function cipherKey(exe: ExeTables): Uint8Array | string {
  const r = exe.v2r(CIPHER);
  if (r === null) return `${hex(CIPHER, 8)} is not in the image`;
  const code = exe.data.subarray(r, r + (CIPHER_KEY_END - CIPHER));
  const regs = new Map<number, number>();   // 0 AL, 1 CL, 2 DL, 3 BL
  const key = new Map<number, number>();
  let esp = 0;
  let p = 0;
  /** ModRM with an `[ESP + disp8/disp32]` or a register operand: its length and parts. */
  const modrm = (q: number): { len: number; reg: number; mod: number; rm: number; disp: number } | null => {
    const m = code[q]!;
    const mod = m >> 6, reg = (m >> 3) & 7, rm = m & 7;
    if (mod === 3) return { len: 1, reg, mod, rm, disp: 0 };
    if (rm !== 4 || code[q + 1] !== 0x24) return null;
    if (mod === 1) return { len: 3, reg, mod, rm, disp: code[q + 2]! };
    if (mod === 2) {
      const d = code[q + 2]! | (code[q + 3]! << 8) | (code[q + 4]! << 16) | (code[q + 5]! << 24);
      return { len: 6, reg, mod, rm, disp: d };
    }
    return null;
  };
  while (p < code.length) {
    const op = code[p]!;
    const m = op === 0x88 || op === 0x8b || op === 0xc6 || op === 0x33 || op === 0x3b
      ? modrm(p + 1) : null;
    if (op === 0x81 && code[p + 1] === 0xec) {            // SUB ESP, imm32
      if ((code[p + 2]! | (code[p + 3]! << 8)) === KEY_LEN && !code[p + 4] && !code[p + 5]) esp = 0;
      p += 6;
    } else if (op >= 0x50 && op <= 0x57) {                  // PUSH r32
      esp -= 4;
      p += 1;
    } else if (op >= 0xb0 && op <= 0xb3) {                  // MOV r8, imm8
      regs.set(op - 0xb0, code[p + 1]!);
      p += 2;
    } else if ((op === 0x33 || op === 0x3b) && m?.mod === 3) {  // XOR / CMP r32, r32
      if (op === 0x33 && m.reg === m.rm && m.reg < 4) regs.set(m.reg, 0);
      p += 2;
    } else if (op === 0xc6 && m && m.mod !== 3 && m.reg === 0) {  // MOV byte [ESP+n], imm8
      key.set(esp + m.disp, code[p + 1 + m.len]!);
      p += 2 + m.len;
    } else if (op === 0x88 && m && m.mod !== 3 && m.reg < 4) {    // MOV byte [ESP+n], r8
      const v = regs.get(m.reg);
      if (v === undefined) return `a store of an unloaded register at ${hex(CIPHER + p, 8)}`;
      key.set(esp + m.disp, v);
      p += 1 + m.len;
    } else if (op === 0x8b && m && m.mod !== 3) {           // MOV r32, [ESP+n]
      if (m.reg < 4) regs.delete(m.reg);
      p += 1 + m.len;
    } else {
      return `an instruction the key reader does not know at ${hex(CIPHER + p, 8)}`
        + ` (${hexBytes(code.subarray(p, p + 8))})`;
    }
  }
  if (p !== code.length) return `the walk ran past ${hex(CIPHER_KEY_END, 8)}`;
  const out = new Uint8Array(KEY_LEN);
  for (let i = 0; i < KEY_LEN; i++) {
    const v = key.get(i);
    if (v === undefined) return `no store of key byte ${i}`;
    out[i] = v;
  }
  if (key.size !== KEY_LEN) return `${key.size} stores, not ${KEY_LEN}`;
  return out;
}

/**
 * Every instruction in `.text` naming `addr` as a literal operand -- every
 * occurrence of its four bytes -- as the instruction's address and what it
 * does with it: a `MOV` into it (`A2`/`A3`, or `88`/`89`/`C6`/`C7` with a
 * `[disp32]` ModRM), a `MOV` out of it (`A0`/`A1`, `8A`/`8B`), or anything
 * else, which is reported at the operand's own address.
 */
function literalRefs(body: Uint8Array, textVa: number, addr: number):
    { at: number; kind: "store" | "load" | "other"; bytes: string }[] {
  return findAll(body, le32(addr)).map((k) => {
    const b1 = body[k - 1]!;
    const b2 = body[k - 2]!;
    const inst = (start: number, kind: "store" | "load") =>
      ({ at: textVa + start, kind, bytes: hexBytes(body.subarray(start, k + 4)) });
    if (b1 === 0xa2 || b1 === 0xa3) return inst(k - 1, "store");
    if (b1 === 0xa0 || b1 === 0xa1) return inst(k - 1, "load");
    if ((b1 & 0xc7) === 0x05 && [0x88, 0x89, 0xc6, 0xc7].includes(b2)) return inst(k - 2, "store");
    if ((b1 & 0xc7) === 0x05 && [0x8a, 0x8b].includes(b2)) return inst(k - 2, "load");
    return { at: textVa + k, kind: "other", bytes: hexBytes(body.subarray(k - 2, k + 4)) };
  });
}

/** `v` with every object's keys in order, so two JSON trees compare as text. */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v).sort()
      .map((k) => [k, canon((v as Record<string, unknown>)[k])]));
  }
  return v;
}

const sameJson = (a: unknown, b: unknown): boolean =>
  JSON.stringify(canon(a)) === JSON.stringify(canon(b));

const gameDir = gameDirOrSkip("options");
const { exe, source } = await openGame(gameDir);
const c = new Checker("options");
const raw = exe.data;

const at = (va: number): number => {
  const r = exe.v2r(va);
  if (r === null) throw new Error(`${hex(va)} is not in the image`);
  return r;
};
const mem = (va: number, n: number): Uint8Array => raw.subarray(at(va), at(va) + n);
const u32 = (va: number): number => exe.ru32(va)!;
const holds = (va: number, want: readonly number[]): boolean =>
  hexBytes(mem(va, want.length)) === hexBytes(want);

// -- the profile, on the install's own save ------------------------------------
const key = cipherKey(exe);
c.ok(typeof key !== "string",
     `ProfileCipher's key: ${KEY_LEN} stack bytes out of ${hex(CIPHER, 8)}`
     + (typeof key === "string" ? ` -- ${key}` : ""));
const names = [0, 1, 2, 3].map((i) => exe.cstr(u32(PROFILE_FILES + i * 4)));
c.ok(JSON.stringify(names) === JSON.stringify([
  "pol/bg_adv19.bin", "tex/scr_tod_itm_itamidome2.bin", "pol/komono_0.bin", "pol/tv2.bin"]),
  `g_profile_file_names: ${JSON.stringify(names)}`);
const partsThere = names.every((n) => n !== null)
  && (await Promise.all(names.map((n) => source.exists(n!)))).every(Boolean);
if (typeof key !== "string" && partsThere) {
  const parts = await Promise.all(names.map((n) => source.read(n!)));
  c.ok(parts.every((p) => p.length === PROFILE_PART),
       `each profile file is ${hex(PROFILE_PART)} bytes: ${parts.map((p) => hex(p.length)).join(", ")}`);
  const blob = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { blob.set(p, o); o += p.length; }
  const buf = blob.slice(0, PROFILE_LEN);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = buf[i]! ^ ((key[i % KEY_LEN]! * (i & 0xff) - 0x24) & 0xff);
  }
  let sum = 0;
  for (let i = 0; i < PROFILE_SUMMED; i++) sum += buf[i]!;
  const csum = (-sum) >>> 0;
  const stored = (buf[PROFILE_SUMMED]! | (buf[PROFILE_SUMMED + 1]! << 8)
    | (buf[PROFILE_SUMMED + 2]! << 16) | (buf[PROFILE_SUMMED + 3]! << 24)) >>> 0;
  c.ok(csum === stored,
       `the deciphered profile's byte sum ${hex(csum)} is the one it stores, ${hex(stored)}`);
  const version = buf[0x009ca05f - PROFILE]!;
  c.eq(version, 7, "the profile's version byte");
  const opt = buf.subarray(0x009c9f20 - PROFILE, 0x009c9f26 - PROFILE);
  c.note(`the install's profile: difficulty ${opt[0]}, life ${opt[1]}, credits `
         + `${(opt[5]! << 24) >> 24}, unlocks ${buf[0x009c9f5e - PROFILE]! & 7}`);
} else {
  c.note("no profile files in the install: the save half unchecked");
}

// -- Blood Color is dead -----------------------------------------------------------
const text = textSection(raw);
const body = raw.subarray(text.ra, text.ra + text.rs);
const show = (rs: { at: number; bytes: string }[]): string =>
  rs.map((r) => `${hex(r.at, 8)} ${r.bytes}`).join(", ") || "none";
const rowRefs = literalRefs(body, text.va, BLOOD_ROW_SHOWN);
const rowStores = rowRefs.filter((r) => r.kind === "store");
c.ok(rowStores.length === 1 && rowStores[0]!.at === 0x00486b14 && rowStores[0]!.bytes === "881d30d07d00",
     `g_options_blood_row_shown's one store is MOV byte ptr [0x7DD030], BL at 0x00486B14: ${show(rowStores)}`);
const rowOther = rowRefs.filter((r) => r.kind === "other");
c.ok(rowOther.length === 0,
     `every instruction naming 0x007DD030 is a MOV into or out of it (${rowRefs.length}); `
     + `others: ${show(rowOther)}`);
c.ok(holds(0x00486a9e, [0x33, 0xdb]), "EBX is zeroed (XOR EBX, EBX at 0x00486A9E) before that store");
const colourRefs = literalRefs(body, text.va, BLOOD_COLOR);
const reads = colourRefs.filter((r) => r.kind !== "store");
c.ok(reads.length === 1 && reads[0]!.at === 0x00486ac1 && reads[0]!.kind === "load",
     `0x009C9F22's readers are the arm's copy alone, 0x00486AC1: ${show(reads)}`);
const writes = colourRefs.filter((r) => r.kind === "store").map((r) => r.at).sort((a, b) => a - b);
c.ok(JSON.stringify(writes) === JSON.stringify([0x004010a0, 0x0040a99b, 0x00487301, 0x00487313]),
     `0x009C9F22's writers: ${writes.map((w) => hex(w, 8)).join(", ")}`);

// -- the port's factory tables are the .data OptionsFactoryReset copies --------------
const fac = [OPTIONS_FACTORY.difficulty, OPTIONS_FACTORY.lives, OPTIONS_FACTORY.credits,
             OPTIONS_FACTORY.sightGraphic];
c.ok(holds(0x004c42a0, fac),
     `OPTIONS_FACTORY ${JSON.stringify(fac)} is 0x004C42A0's four bytes ${JSON.stringify([...mem(0x004c42a0, 4)])}`);
c.eq(SIGHT_SPEED_FACTORY, exe.rf32(0x004c42a4)!, "SIGHT_SPEED_FACTORY is the float at 0x004C42A4");
c.eq(OPTION_9F28_FACTORY, raw[at(0x004c4368)]!, "OPTION_9F28_FACTORY is the byte at 0x004C4368");
const bindings = INPUT_BINDINGS_DEFAULT.flat(2);
const exeBindings = Array.from({ length: 40 }, (_u, i) => u32(0x004c42a8 + i * 4));
c.ok(JSON.stringify(bindings) === JSON.stringify(exeBindings),
     `INPUT_BINDINGS_DEFAULT is g_input_bindings_default's 40 dwords (${bindings.length} in the port)`);
const exeCal = Array.from({ length: 8 }, (_u, i) => u32(0x004c4348 + i * 4));
c.ok(JSON.stringify([...GUN_CALIBRATION_FACTORY]) === JSON.stringify(exeCal),
     "GUN_CALIBRATION_FACTORY is 0x004C4348's eight dwords");
const exeLives = Array.from({ length: 5 }, (_u, i) => (exe.ru16(0x004d0edc + i * 2)! << 16) >> 16);
c.ok(JSON.stringify([...START_LIVES_BY_OPTION]) === JSON.stringify(exeLives),
     `START_LIVES_BY_OPTION is g_start_lives_by_option ${JSON.stringify(exeLives)}`);
// `OptionsFactoryReset`'s loads: the table addresses as its operands.
for (const [va, want] of [
  [0x00401130, "a0a0424c00"], [0x00401135, "8a15a2424c00"], [0x0040113b, "8a0da1424c00"],
  [0x0040114c, "8a1da3424c00"], [0x00401176, "8b0da4424c00"],
] as const) {
  c.ok(hexBytes(mem(va, want.length / 2)) === want, `OptionsFactoryReset's load at ${hex(va, 8)}: ${want}`);
}

// -- the immediates the port pushes ---------------------------------------------
const sprites = OptionsSprite as unknown as Record<string, number | undefined>;
const pushes: [string, number][] = [
  ["Options", 0x00486e21], ["Exit", 0x004871fb], ["Tilde", 0x00487e64],
  ["Tag1P", 0x0048767d], ["Tag2P", 0x0048774c], ["OptionsSlash", 0x00488494],
  ["SightSpeed", 0x004884bb], ["ASlow", 0x004887b7], ["BFast", 0x004887de],
  ["PressStartToEnter", 0x00488808],
];
for (const [name, va] of pushes) {
  const v = sprites[name];
  c.ok(v !== undefined && holds(va, [0x68, ...le32(v)]),
       `OptionsSprite.${name} (${v === undefined ? "missing" : hex(v)}) is the PUSH at ${hex(va, 8)}`);
}
const baseVas = [0x0048818f, 0x00488121, 0x004880b3];
OPTIONS_BACKGROUND_BASES.slice(0, 3).forEach((base, i) => {
  c.ok(holds(baseVas[i]!, [0xbe, ...le32(base)]),
       `background base ${hex(base)} is the MOV ESI at ${hex(baseVas[i]!, 8)}`);
});
c.eq(OPTIONS_BACKGROUND_BASES.length, 3, "three background bases");
// The EXIT and title positions and flags, and the grid.
const f32le = (v: number): number[] => {
  const b = new DataView(new ArrayBuffer(4));
  b.setFloat32(0, v, true);
  return [0, 1, 2, 3].map((i) => b.getUint8(i));
};
for (const [va, want, what] of [
  [0x004871f6, [0x68, ...f32le(320)], "EXIT's x 320"],
  [0x00486e1c, [0x68, ...f32le(344)], "the title's x 344"],
  [0x00486e17, [0x68, ...f32le(16)], "the title's y 16"],
  [0x00486e04, [0x6a, 0x06], "the title's flags 6"],
  [0x004871c4, [0x68, 0x0a, 0x20, 0x00, 0x00], "EXIT's flags 0x200A"],
  [0x00487db9, [0x68, 0x00, 0x20, 0x00, 0x00], "a glyph's flags 0x2000"],
] as const) {
  c.ok(holds(va, want), `${what} at ${hex(va, 8)}`);
}
for (const [va, v, what] of [
  [0x0055dcf0, 16, "the column, 16"], [0x004ecb84, 24, "the line, 24"],
  [0x005644fc, 7, "lower case's drop, 7"], [0x004c49c0, 3, "C and G's kern, 3"],
  [0x004c4ca0, 4, "EXIT's lift, 4"],
] as const) {
  c.eq(exe.rf32(va), v, `${what} at ${hex(va, 8)}`);
}
// The lit bit: SubmitScreenSpriteQuad's `TEST DH, 0x20`.
c.ok(holds(0x004ace27, [0xf6, 0xc6, 0x20]),
     "SubmitScreenSpriteQuad tests flags bit 0x2000 at 0x004ACE27");
// The sub-screens' gates the port has: input mode 6.
c.ok(holds(0x00485fbd, [0xb9, 0x06, 0x00, 0x00, 0x00])
     && holds(0x00486c4a, [0x83, 0x7c, 0x24, 0x0c, 0x06]),
     "Gun Calibration's gate compares the input mode with 6");
// HudDrawCrosshair's sprite is the sight graphic, not the binding set.
c.ok(holds(0x004169f3, [0x8d, 0x14, 0x8d, 0x60, 0x9f, 0x9c, 0x00])
     && holds(0x00416ac8, [0x0f, 0xbe, 0x12])
     && holds(0x00416ad8, [0x0f, 0xbf, 0x14, 0x4d, 0x58, 0x9f, 0x57, 0x00]),
     "HudDrawCrosshair reads +0x00 of the options record and indexes g_crosshair_sprites with it");

// -- the tables the bundle carries ------------------------------------------------
const opts = exe.optionsTables() as {
  rows: { col: number; row: number; label: string }[];
  glyphs: number[]; crosshair_sprites: number[]; se_test: number[]; music_test: number[];
};
c.ok(0x00569798 + 0x2ef * 8 === 0x0056af10, "the SE test's 751 records end at 0x0056AF10");
const labels = opts.rows.map((r) => r.label);
c.ok(JSON.stringify(labels) === JSON.stringify([
  "Difficulty", "Life", "Continue", "Blood Color", "Sight Graphic", "Sight Speed",
  "Sound Test Special Effects", "Sound Test Music", "Gun Calibration", "Default", "EXIT"]),
  `the rows: ${JSON.stringify(labels)}`);
const grid = opts.rows.map((r) => [r.col, r.row]);
c.ok(JSON.stringify(grid) === JSON.stringify(
  [...Array.from({ length: 10 }, (_u, i) => [2, 3 + i]), [15, 18]]),
  "the rows' columns and lines");
c.ok(u32(0x00569680 + 4) === 0x005971f0 && exe.cstr(0x005971f0) === "OPTIONS"
     && findAll(raw, le32(0x00569680)).length === 0,
     "the 'OPTIONS' record at 0x00569680 is named by nothing");
const glyphs = opts.glyphs;
c.ok(glyphs[0x30 - 0x20] === 0x76c && glyphs[0x41 - 0x20] === 0x776
     && glyphs[0x54 - 0x20] === 0x7a3 && glyphs[0x61 - 0x20] === 0x789
     && glyphs[0] === 0 && glyphs[0x2e - 0x20] === 0,
     "the glyph table: 0x76C for '0', 0x776 'A', 0x7A3 'T', 0x789 'a', none for ' ' or '.'");
// 16x32 each, but for `W` (0x7A6), 32x32: drawn over its right-hand
// neighbour's first half, since every character advances 16.
for (const gid of [...new Set(glyphs.filter((g) => g))].sort((a, b) => a - b)) {
  const hit = exe.screenSprite(gid);
  const want = gid === 0x7a6 ? [32, 32] : [16, 32];
  c.ok(hit !== null && hit[0] === "scr_opt_moji05"
       && hit[1].width === want[0] && hit[1].height === want[1],
       `glyph ${hex(gid)} is scr_opt_moji05, ${want[0]}x${want[1]}`);
}
for (const [sid, bank, w, h] of [
  [0xb31, "scr_dc_option", 256, 64], [0x803, "scr_dc_option", 128, 64],
  [0x7f2, "scr_opt_moji01", 16, 32], [0x7a, "scr_back2", 128, 128],
  [0xa7d, "scr_back4", 128, 128], [0x8e, "scr_back3", 128, 128],
  [0xaa8, "scr_common", 32, 32],
] as const) {
  const hit = exe.screenSprite(sid);
  c.ok(hit !== null && hit[0] === bank && hit[1].width === w && hit[1].height === h,
       `sprite ${hex(sid)} is ${bank} ${w}x${h}`);
}
c.ok(JSON.stringify(opts.crosshair_sprites)
     === JSON.stringify([0xaa8, 0xaaa, 0xaab, 0xaac, 0xaa9, 0xaad, 0xaae, 0xaaf]),
     `g_crosshair_sprites: ${opts.crosshair_sprites.map((s) => hex(s)).join(", ")}`);
c.ok(opts.se_test[0] === 0x80000000 && opts.music_test[0] === 0x80000000,
     "both sound tests open on the music's stop");

// -- with a bundle, its options block ----------------------------------------------
const scripts = existsSync(BUNDLE_ROOT)
  ? readdirSync(BUNDLE_ROOT).flatMap((d) => {
    const sub = join(BUNDLE_ROOT, d);
    if (!statSync(sub).isDirectory()) return [];
    return readdirSync(sub).filter((f) => f.endsWith(".script.json")).map((f) => join(sub, f));
  }).sort()
  : [];
if (scripts.length) {
  const first = scripts[0]!;
  const name = first.slice(first.lastIndexOf("/") + 1);
  const block = (JSON.parse(readFileSync(first, "utf8")) as { options?: unknown }).options;
  c.ok(block !== undefined, `${name} has an options block`);
  if (block !== undefined) {
    c.ok(sameJson(block, opts), `${name}'s options block is ExeTables.optionsTables'`);
  }
} else {
  c.note(`no bundle under ${BUNDLE_ROOT}: the exported block unchecked`);
}

c.finish();
