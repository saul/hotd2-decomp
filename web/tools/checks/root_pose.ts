/**
 * A clip's root translation moves the object or offsets the pose, and both are
 * drawn at the character's size.
 *
 *     node tools/run_ts.mjs tools/checks/root_pose.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * `SkeletonApplyRootMotion` (`FUN_00410C50`) is handed a pointer to the
 * current frame's three root floats and tests `model+0x64` bit 1 **twice**,
 * and Ghidra's pseudocode shows neither test whole (`L37`):
 *
 *     00410d2f  TEST byte ptr [ECX + 0x64],0x2     ; move the object?
 *               ... delta = root - baseline, through
 *               ... T(obj+0x40) Rz Ry Rx(obj+0x6C..0x64) S(model+0x116C),
 *               ... written back to obj+0x40 / obj+0x48
 *     00410e5f  MOV EAX,[0x009ca0a0]               ; the arm does NOT return:
 *     00410e69  MOV [EAX+0x1160],EDX               ;   baseline = root, and
 *     00410e93  CALL dword ptr [ECX + 0x115c]      ;   fall into the shared tail
 *               ... T(obj+0x40); the actor's rotation; S(model+0x116C)
 *     00411005  TEST byte ptr [ECX + 0x64],0x2     ; pose which part of it?
 *     00411009  JZ   0x00411020
 *     0041100b  PUSH 0 / [ESI+4] / 0               ;   set -> T(0, root.y, 0)
 *     00411020  PUSH [ESI+8] / [ESI+4] / [ESI]     ;   clear -> T(root)
 *
 * So a clip's root translation **either moves the object or offsets the pose,
 * never both and never neither**, and one bit decides which. The port reads
 * that bit as `MotionFlag.RootMotion` (`game/actor.ts`); `game/root_motion.ts`
 * takes the moving arm and `render/characters/pose.ts` the posing one.
 *
 * What this asserts, and what only this can see:
 *
 *  * **The bytes.** Each instruction the reading rests on, quoted as hex at its
 *    address: the two gate tests, the fall-through Ghidra hides, the two
 *    `MatrixTranslate` argument pushes, `ActorBuildSkinnedModel`'s
 *    unconditional `model+0x64 = 3`, `RescueTargetInit`'s `AND EDX,0xFFFFFFFD`
 *    that takes bit 1 straight back out, the draw tail's
 *    `MatrixScale(model+0x116C)` between the actor's rotation and the pose
 *    translate, the head of `ActorBuildSkinnedModel`'s size switch and its 1.0
 *    arm, and `SkeletonWalkNode`'s radius store -- the bone's hit radius is
 *    the sphere table's times the size, at build. A different build, or an
 *    address off by one, fails here rather than quietly agreeing. The port's
 *    `MotionFlag.RootMotion` is held to the bit both gates test and the mask
 *    clears.
 *  * **The size, decoded rather than quoted.** `ActorBuildSkinnedModel`
 *    (`FUN_00410440`) writes `model+0x116C` from the character type alone,
 *    through `MOV CL,[EAX+0x410568]; JMP [ECX*4+0x41055C]`, each arm a
 *    `MOV dword ptr [ESI+0x116C], imm32`. Every one of the 27 switch types is
 *    decoded to its float and held to the port's `ActorModelScale`
 *    (`game/root_motion.ts`), imported, bit for bit; and every other `MOVSX`
 *    type, which the unsigned `JA` sends to the 1.0 arm, is held to that arm's
 *    float in the port too.
 *  * **The population.** The posing arm can only move an actor whose clip has
 *    a non-zero **absolute** horizontal root, so every motion block in the
 *    game is decoded through `hod2lib/mot.ts` -- each bank that
 *    `DAT_004E2C40` names, each block at the stride its own size implies --
 *    and counted: 1058 blocks, 992 of them exactly zero on frame 0. Class
 *    0x21's clip `0x3E6` (the port's `CLASS21_MOTION_IDLE`) holds a constant
 *    root of `(0, 15.692, 11.943)`, so the frame-to-frame delta never takes
 *    it and the pose must.
 *  * **Who else the posing arm reaches.** Class 0x10 is the only thing besides
 *    class 0x21 that clears the bit: `CivilianRunScript` (`FUN_0048B9E0`)
 *    copies bit `0x00100000` of the wait word that opened a block into
 *    `model+0x64` bit 1 on every clip change. Every clip the shipped class-0x10
 *    scripts (`ExeTables.civilianScripts`) set is paired with the wait word
 *    that governs it, and the clips set with the gate clear **and** a
 *    horizontal root over 0.5 units are exactly `people.bin`'s 596, 598 and
 *    600, all at `(-0.104, 0.805, -2.880)`. The port's `CivilianWait.RootMotion`
 *    and `CivilianOp.Wait` / `SetMotion` / `SetMotionFrom` are held to the
 *    word and ops this pairing reads.
 *  * **Who poses them, at what size.** Every class-0x10 spawn in the six
 *    stages (`hod2lib/stage.ts`, `hod2lib/evt.ts`) carries `{i8 char_type;
 *    i8 script}` at the descriptor's `+0x24`; `civilianMotionIds`
 *    (`hod2lib/actorscript.ts`) closes each script over its reachable clips.
 *    Every spawn that can reach a posed clip is a person at the switch's 0.9,
 *    and so draws **2.593 units of the 2.882 authored** -- and the port's
 *    `ActorModelScale` gives it the same size.
 *
 * The population half names every actor in the shipped game the posing arm
 * can move. Nothing else in the repository enumerates it.
 */
import { gameDirOrSkip, openGame, Checker, hex, f32Bits } from "../lib/exe_check";
import type { ExeTables } from "../../src/hod2lib/exetab";
import type { AssetSource } from "../../src/hod2lib/io";
import { f32, i8, i16, u16, u32 } from "../../src/hod2lib/bytes";
import * as evt from "../../src/hod2lib/evt";
import * as mot from "../../src/hod2lib/mot";
import { Stage } from "../../src/hod2lib/stage";
import { civilianMotionIds } from "../../src/hod2lib/actorscript";
import { ActorModelScale } from "../../src/game/root_motion";
import { MotionFlag } from "../../src/game/actor";
import { CivilianOp, CivilianWait } from "../../src/game/class10/ops";
import { CLASS21_MOTION_IDLE } from "../../src/game/class21/index";

/**
 * The instruction stream, address -> [hex bytes, what it is]. Every one was
 * read off the disassembly; none came from the pseudocode, which shows the
 * gated arm returning where it in fact falls through.
 */
const INSTRUCTIONS: [number, string, string][] = [
  [0x00410d2f, "f6416402",
   "SkeletonApplyRootMotion's gate: TEST [ECX+0x64],2"],
  [0x00410e5f, "a1a0a09c00",
   "the gated arm does not return -- MOV EAX,[g_skeleton_model]"],
  [0x00410e69, "899060110000",
   "...baseline = root: MOV [EAX+0x1160],EDX"],
  [0x00410e93, "ff915c110000",
   "...and into the shared tail: CALL [ECX+0x115C]"],
  [0x00411005, "f6416402", "the same gate again, for the pose translate"],
  [0x00411009, "7415", "JZ to the whole-root arm"],
  [0x0041100b, "8b5604", "gate SET: MOV EDX,[ESI+4], pushed as (0, y, 0)"],
  [0x00411020, "8b4608", "gate CLEAR: MOV EAX,[ESI+8], the first of (x,y,z)"],
  [0x004104c5, "c7466403000000",
   "ActorBuildSkinnedModel: MOV [ESI+0x64],3 -- on for everyone"],
  [0x00451759, "83e2fd",
   "RescueTargetInit: AND EDX,0xFFFFFFFD -- and off for class 0x21"],
  // -- the size both translates are drawn at -------------------------------
  [0x00410fea, "8b826c110000",
   "the draw tail: MOV EAX,[EDX+0x116C], the model's size"],
  [0x00410ff0, "505050", "...pushed three times"],
  [0x00410ff7, "e8c48c0900",
   "...into MatrixScale (0x004A9CC0), before the pose translate"],
  [0x00410451, "0fbf4660",
   "ActorBuildSkinnedModel: MOVSX EAX,[ESI+0x60], the type"],
  [0x00410455, "83c0e2", "...ADD EAX,-0x1E"],
  [0x00410458, "83f81a", "...CMP EAX,0x1A: types 30..56 take the table"],
  [0x0041045b, "7733", "...and the rest JA to the 1.0 arm"],
  [0x00410490, "c7866c1100000000803f",
   "the 1.0 arm: MOV [ESI+0x116C],0x3F800000"],
  [0x00410837, "d98100130000",
   "SkeletonWalkNode: FLD [ECX+0x1300], g_cur_actor's size"],
  [0x0041083d, "d848fc", "...FMUL [EAX-4], the sphere row's radius"],
  [0x00410840, "d95e78", "...FSTP [ESI+0x78], the record's radius"],
];

/** The two gate tests' immediate, and `RescueTargetInit`'s mask, by address. */
const GATE_TESTS = [0x00410d2f, 0x00411005];
const GATE_MASK = 0x00451759;

/**
 * `ActorBuildSkinnedModel`'s switch: the index bytes, one per type from 30,
 * and the jump table they index. Decoded below, not quoted.
 */
const SCALE_FIRST_TYPE = 30;
const SCALE_TYPES = 27;
const SCALE_INDEX = 0x00410568;
const SCALE_JUMPS = 0x0041055c;
/** The 1.0 arm the `JA` takes, and its float at `+6`. */
const SCALE_DEFAULT_ARM = 0x00410490;
/** `MOV dword ptr [ESI+0x116C], imm32` without its immediate. */
const STORE_116C = "c7866c110000";

/**
 * The size of every character that can pose {@link CIVILIAN_POSED_CLIPS}, and
 * the offset the engine therefore draws. `[proved]` by enumeration below.
 */
const CIVILIAN_POSED_SCALE = Math.fround(0.9);
const CIVILIAN_POSED_DRAWN = 2.5935;

/**
 * Bit `0x00100000` of the wait word that opened the block, which
 * `CivilianRunScript` (`FUN_0048B9E0`) copies into `model+0x64` bit 1 on every
 * clip *change*.
 */
const CIVILIAN_ROOT_MOTION = 0x00100000;

/** Op 0x2C is the wait; ops 0x00 and 0x01 are the two clip changes. */
const CIV_OP_WAIT = 0x2c;
const CIV_OPS_SET_MOTION = [0x00, 0x01];

/** `DAT_004D1B00` names, `DAT_004E2B14` ids, `DAT_004E2BDC` counts. */
const BANK_NAME = 0x004d1b00;
const BANK_IDS = 0x004e2b14;
const BANK_COUNT = 0x004e2bdc;
/** `DAT_004E2C40`: the bank of each motion id. */
const MOTION_BANK_OF = 0x004e2c40;

/**
 * A clip root this far off the origin is a real offset rather than authoring
 * noise. Nothing in the game lands between 0.0 and 0.5: the 1058 blocks are
 * 992 at exactly zero, two at 0.06 and 0.43, and 64 above 2.8.
 */
const OFFSET_UNITS = 0.5;

/** `RescueTargetInit` (`FUN_00451720`) installs this clip as a literal. */
const CLASS21_MOTION = 0x3e6;
const CLASS21_ROOT: [number, number, number] = [0.0, 15.692, 11.943];

/**
 * Every motion the shipped class-0x10 scripts set inside a block whose wait
 * word does **not** ask for root motion, and whose absolute horizontal root is
 * therefore posed rather than walked. `[proved]` by enumeration below; three
 * clips, one `people.bin` root, 2.882 units of it.
 */
const CIVILIAN_POSED_CLIPS = [596, 598, 600];
const CIVILIAN_POSED_ROOT: [number, number, number] = [-0.104, 0.805, -2.880];

/** What the whole game holds, so the two halves cannot drift apart silently. */
const EXPECT_BLOCKS = 1058;
const EXPECT_ZERO = 992;

/** How close a decoded root has to come to one written here. */
const ROOT_TOLERANCE = 5e-4;

interface Block {
  bank: string;
  root: [number, number, number];
  /** `hypot(root.x, root.z)` on frame 0. */
  horizontal: number;
  /** The horizontal root is the same on every frame. */
  constant: boolean;
}

function hexBytes(b: Uint8Array): string {
  return [...b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** `n` bytes at *va*, or fewer where the image ends; empty when unmapped. */
function at(exe: ExeTables, va: number, n: number): Uint8Array {
  const r = exe.v2r(va);
  if (r === null) return new Uint8Array(0);
  return exe.data.subarray(r, Math.min(r + n, exe.data.length));
}

/** A float as `%.8g` spells it. */
function g8(v: number): string {
  return String(Number(v.toPrecision(8)));
}

function rootText(r: readonly number[]): string {
  return `(${r.map((v) => v.toFixed(3)).join(", ")})`;
}

function near(a: readonly number[], b: readonly number[]): boolean {
  return a.every((v, i) => Math.abs(v - b[i]!) <= ROOT_TOLERANCE);
}

/**
 * Every motion block in the game, decoded at its own implied stride: each bank
 * `DAT_004E2C40` names, in bank order, a later bank's block replacing an
 * earlier one's under the same id.
 */
async function loadAllBlocks(source: AssetSource,
                             exe: ExeTables): Promise<Map<number, Block>> {
  const raw = exe.data;
  const out = new Map<number, Block>();
  const fn = exe.v2r(BANK_NAME);
  const ids = exe.v2r(BANK_IDS);
  const cnt = exe.v2r(BANK_COUNT);
  const mb = exe.v2r(MOTION_BANK_OF);
  if (fn === null || ids === null || cnt === null || mb === null) return out;
  const banks = new Set<number>();
  for (let m = 0; m < 2048; m++) {
    if (mb + m < raw.length && raw[mb + m]! < 64) banks.add(raw[mb + m]!);
  }
  for (const b of [...banks].sort((x, y) => x - y)) {
    const p = u32(raw, fn + b * 4);
    const name = p ? exe.cstr(p) : null;
    const n = u16(raw, cnt + b * 2);
    if (!name || !(n > 0 && n <= 4096)) continue;
    const io = exe.v2r(u32(raw, ids + b * 4));
    if (io === null || !(await source.exists(`mot/${name}`))) continue;
    const mids: number[] = [];
    for (let k = 0; k < n; k++) mids.push(i16(raw, io + k * 2));
    const bank = await mot.loadBank(source, name, mids);
    if (bank === null) continue;
    for (const m of mids) {
      const bones = bank.impliedBoneCount(m);
      if (!bones) continue;
      const frames = bank.frames(m, bones);
      if (!frames.length) continue;
      const r0 = frames[0]!.root;
      const constant = frames.every((f) =>
        Math.abs(f.root[0] - r0[0]) < 1e-6 && Math.abs(f.root[2] - r0[2]) < 1e-6);
      out.set(m, { bank: name, root: r0, horizontal: Math.hypot(r0[0], r0[2]),
                   constant });
    }
  }
  return out;
}

/** Each clip the scripts set, against the gate of the block that set it. */
function civilianGateByClip(exe: ExeTables):
    { byClip: Map<number, Set<boolean>>; on: number; off: number } {
  const byClip = new Map<number, Set<boolean>>();
  let on = 0;
  let off = 0;
  for (const cmds of exe.civilianScripts().scripts) {
    let wait = 0;
    for (const c of cmds) {
      if (c.op === CIV_OP_WAIT && c.args.length) {
        wait = (c.args[0] as number) >>> 0;
        if (wait & CIVILIAN_ROOT_MOTION) on++;
        else off++;
      } else if (CIV_OPS_SET_MOTION.includes(c.op) && c.args.length) {
        const m = c.args[0] as number;
        const gates = byClip.get(m) ?? new Set<boolean>();
        gates.add((wait & CIVILIAN_ROOT_MOTION) !== 0);
        byClip.set(m, gates);
      }
    }
  }
  return { byClip, on, off };
}

async function main(): Promise<void> {
  const dir = gameDirOrSkip("root_pose");
  const { source, exe } = await openGame(dir);
  const c = new Checker("root_pose");

  // -- the bytes -----------------------------------------------------------
  for (const [va, want, what] of INSTRUCTIONS) {
    const got = hexBytes(at(exe, va, want.length / 2));
    c.ok(got === want, `${hex(va, 8)} ${what}`
         + (got === want ? "" : `: expected ${want}, found ${got || "<unmapped>"}`));
  }
  for (const va of GATE_TESTS) {
    const imm = at(exe, va + 3, 1)[0] ?? -1;
    c.eq(MotionFlag.RootMotion as number, imm,
         `MotionFlag.RootMotion is the bit ${hex(va, 8)} tests`);
  }
  const mask = at(exe, GATE_MASK + 2, 1)[0] ?? -1;
  c.eq(MotionFlag.RootMotion as number, ~(mask | 0xffffff00) >>> 0,
       `MotionFlag.RootMotion is the bit RescueTargetInit's AND clears`);

  // -- the size, decoded from the switch rather than quoted ----------------
  // `MOV CL,[EAX+0x410568]; JMP [ECX*4+0x41055C]`, and each arm a
  // `MOV dword ptr [ESI+0x116C], imm32` -- `c7 86 6c 11 00 00` and the float.
  const index = at(exe, SCALE_INDEX, SCALE_TYPES);
  c.eq(index.length, SCALE_TYPES, `the size switch's index at ${hex(SCALE_INDEX, 8)} is mapped`);
  const jumps: number[] = [];
  for (let i = 0; i <= Math.max(0, ...index); i++) {
    const b = at(exe, SCALE_JUMPS + 4 * i, 4);
    jumps.push(b.length === 4 ? u32(b, 0) : 0);
  }
  const scale = new Map<number, number>();
  index.forEach((k, i) => {
    const t = SCALE_FIRST_TYPE + i;
    const arm = at(exe, jumps[k]!, 10);
    const store = arm.length === 10 && hexBytes(arm.subarray(0, 6)) === STORE_116C;
    if (!c.ok(store, `type ${t}: jump arm ${hex(jumps[k]!, 8)} is a store to +0x116C`
              + (store ? "" : ` (${hexBytes(arm)})`))) return;
    const v = f32(arm, 6);
    scale.set(t, v);
    const port = ActorModelScale(t);
    c.ok(f32Bits(port) === f32Bits(v),
         `type ${t}: the switch stores ${g8(v)}, ActorModelScale says ${g8(port)}`);
  });
  const runs = new Map<number, number[]>();
  for (const [t, v] of [...scale].sort((a, b) => a[0] - b[0])) {
    const l = runs.get(v) ?? [];
    l.push(t);
    runs.set(v, l);
  }
  c.note(`ActorBuildSkinnedModel's size switch, types ${SCALE_FIRST_TYPE}..`
         + `${SCALE_FIRST_TYPE + SCALE_TYPES - 1}: `
         + [...runs].map(([v, ts]) => `${g8(v)} for ${Math.min(...ts)}..${Math.max(...ts)}`)
           .join(", "));

  // Every other type the `MOVSX` can load takes the `JA` -- an unsigned
  // compare of `type - 30` against 26 -- to the 1.0 arm.
  const defaultArm = at(exe, SCALE_DEFAULT_ARM, 10);
  const one = defaultArm.length === 10 ? f32(defaultArm, 6) : NaN;
  const offSwitch: number[] = [];
  for (let t = -0x8000; t < 0x8000; t++) {
    if (((t - SCALE_FIRST_TYPE) >>> 0) <= SCALE_TYPES - 1) continue;
    if (f32Bits(ActorModelScale(t)) !== f32Bits(one)) offSwitch.push(t);
  }
  c.ok(offSwitch.length === 0,
       `every type outside the switch is ${g8(one)} in ActorModelScale, as the `
       + `arm at ${hex(SCALE_DEFAULT_ARM, 8)} stores`
       + (offSwitch.length ? `; not ${offSwitch.slice(0, 8).join(", ")}` : ""));

  // -- the population ------------------------------------------------------
  const blocks = await loadAllBlocks(source, exe);
  const zero = [...blocks.values()].filter((b) => b.horizontal === 0).length;
  const offset = [...blocks.values()].filter((b) => b.horizontal > OFFSET_UNITS).length;
  c.eq(blocks.size, EXPECT_BLOCKS, "motion blocks decoded");
  c.eq(zero, EXPECT_ZERO, "blocks with an exactly zero horizontal root on frame 0");
  c.note(`${blocks.size} motion blocks: ${zero} have an exactly zero horizontal `
         + `root on frame 0, ${offset} are over ${OFFSET_UNITS} units off it`);

  // Class 0x21's own clip.
  c.eq(CLASS21_MOTION_IDLE, CLASS21_MOTION,
       "CLASS21_MOTION_IDLE is the clip RescueTargetInit installs");
  const c21 = blocks.get(CLASS21_MOTION);
  if (c.ok(c21 !== undefined, `motion ${hex(CLASS21_MOTION)} decodes`) && c21) {
    c.ok(c21.constant, `motion ${hex(CLASS21_MOTION)}'s horizontal root is constant `
         + "-- the delta never takes it");
    c.ok(near(c21.root, CLASS21_ROOT),
         `motion ${hex(CLASS21_MOTION)} in ${c21.bank}: root ${rootText(c21.root)}`
         + `, expected ${rootText(CLASS21_ROOT)}; `
         + `${c21.horizontal.toFixed(3)} units of horizontal pose offset`);
  }

  // -- and who else the posing arm can move --------------------------------
  c.eq(CivilianWait.RootMotion as number, CIVILIAN_ROOT_MOTION,
       "CivilianWait.RootMotion is the wait word's root-motion bit");
  c.eq(CivilianOp.Wait as number, CIV_OP_WAIT, "CivilianOp.Wait is op 0x2C");
  c.eq([CivilianOp.SetMotion, CivilianOp.SetMotionFrom].join(","),
       CIV_OPS_SET_MOTION.join(","),
       "CivilianOp.SetMotion and SetMotionFrom are the two clip changes");
  const { byClip, on, off } = civilianGateByClip(exe);
  const posed = [...byClip].filter(([m, gates]) => gates.has(false)
    && (blocks.get(m)?.horizontal ?? 0) > OFFSET_UNITS).map(([m]) => m)
    .sort((a, b) => a - b);
  c.note(`class 0x10: ${on} wait words ask for root motion and ${off} do not; `
         + `of the ${byClip.size} clips the scripts set, ${posed.length} can be `
         + "posed with a non-zero horizontal root");
  c.eq(posed.join(","), CIVILIAN_POSED_CLIPS.join(","),
       "the clips class 0x10 poses a horizontal root for");
  for (const m of posed) {
    const b = blocks.get(m)!;
    c.ok(near(b.root, CIVILIAN_POSED_ROOT),
         `motion ${m} in ${b.bank}: root ${rootText(b.root)}, expected `
         + `${rootText(CIVILIAN_POSED_ROOT)}; ${b.horizontal.toFixed(3)} units`);
  }

  // -- ...and who poses them, at what size ---------------------------------
  // Every class-0x10 spawn in the six stages: `{i8 char_type; i8 script}` at
  // the descriptor's `+0x24`, and the script's reachable clips. The offset the
  // engine draws is the clip's times that character's size.
  const civ = exe.civilianScripts();
  const posedSet = new Set(posed);
  const authored = Math.max(0, ...posed.map((m) => blocks.get(m)!.horizontal));
  const players: [number, number, number][] = [];
  for (let n = 1; n <= 6; n++) {
    const ev = await (await Stage.create(source, { stage: n })).evt();
    if (!c.ok(ev !== null, `stage ${n} has an evt`) || ev === null) continue;
    for (const rec of evt.spawns(ev)) {
      if (rec.cls !== 0x10 || rec.offset + 0x26 > ev.raw.length) continue;
      const ct = i8(ev.raw, rec.offset + 0x24);
      const entry = i8(ev.raw, rec.offset + 0x25);
      if (civilianMotionIds(civ, entry).some((m) => posedSet.has(m))) {
        players.push([n, rec.offset, ct]);
      }
    }
  }
  c.ok(players.length > 0, `${players.length} class-0x10 spawns reach a posed clip`);
  for (const [n, off, ct] of players) {
    const size = scale.get(ct) ?? 1.0;
    const drawn = size * authored;
    const where = `stage ${n} spawn ${hex(off)}, character type ${ct}`;
    c.ok(f32Bits(size) === f32Bits(CIVILIAN_POSED_SCALE),
         `${where}: the switch's size ${g8(size)}`);
    c.ok(Math.abs(drawn - CIVILIAN_POSED_DRAWN) <= ROOT_TOLERANCE,
         `${where}: ${drawn.toFixed(4)} units drawn of the ${authored.toFixed(4)} `
         + `authored, expected ${CIVILIAN_POSED_DRAWN}`);
    c.ok(f32Bits(ActorModelScale(ct)) === f32Bits(size),
         `${where}: ActorModelScale draws it at ${g8(ActorModelScale(ct))}`);
  }

  c.finish();
}

await main();
