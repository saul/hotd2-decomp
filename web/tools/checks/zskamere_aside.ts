/**
 * Can a `zskamere` (class 0x31, character type 0x17) reach the leap aside?
 *
 *     node tools/run_ts.mjs tools/checks/zskamere_aside.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * `ThrowerStateLeapAside` (`FUN_0044B880`, state 10) picks its arc script by
 * character type, and type 0x17's arm is `JZ 0x0044BAE7` -- past the
 * `MOVSD.REP` every other arm ends in -- so the script it hands
 * `ActorArcBeginToWaypoint` is twelve dwords of a stack local nothing on that
 * path writes. The port cannot copy the stack, installs no script there, and
 * calls that arm unreachable (`game/class31/pounce.ts`, `LeapAsideScript`).
 * That is several claims about the EXE and the data, and this check holds
 * each, with a control beside every negative one (`L32`):
 *
 * 1. **The arm is what the reading says**: `g_class31_states[10]` is the
 *    routine, and the bytes at `0x0044BA6D` are `DEC EAX; JZ 0x0044BAE7` with
 *    the `MOVSD.REP` at `0x0044BAE5`, two bytes before the target.
 * 2. **State 10 is stored by three instructions in class 0x31's code**:
 *    `ThrowerStateLeapDown`'s exit, `ThrowerStateFallToSurface`'s and the dead
 *    `ThrowerStateLeapStrike`'s.
 * 3. **A `zskamere` never pounces**: `g_class31_action_picks` set 2 offers
 *    nothing but 7 in bands 1 and 2 (set 0 offers 12 and 13 there, the
 *    control), and `ThrowerStateWaitForPermit`'s jump table sends type 0x17
 *    to its own arm, which stores 0x20 or 0x18 and never 9.
 * 4. **A `zskamere` never falls out of a retreat**: `obj+0x34` bit
 *    `0x20000000`, which sends `ThrowerStateFallToSurface` to state 10, is
 *    raised in class 0x31 by two `OR`s -- the leap aside's and
 *    `ThrowerStateWithdraw`'s -- and state 11 is stored by one instruction,
 *    in `ThrowerFindSurfaceUnderfoot`, whose one caller is
 *    `ThrowerSnapToSurface`, whose one caller is `ThrowerPushOutOfWorld`
 *    behind a test for states 7 and 8. (The withdraw's exit and
 *    `ThrowerOnShot` clear the bit; the TSV row has the addresses.)
 * 5. **Its attack picks never name 3**, so the arm that would give it the
 *    attack-3 script first cannot either.
 * 6. **The data**: every class-0x31 descriptor of type 0x17 is set 2 and
 *    starts in state 18 or 20 -- and the census finds them (the control).
 */
import { Checker, gameDirOrSkip, hex, openGame } from "../lib/exe_check";
import { ExeTables } from "../../src/hod2lib/exetab";
import * as evt from "../../src/hod2lib/evt";
import { sweep } from "./lib_x86";

const G_CLASS31_STATES = 0x00592960;
const LEAP_ASIDE = 0x0044b880;
const G_ACTION_PICKS = 0x00592a60;
const G_ATTACK_PICKS = 0x00592a20;
const CLASS31_CODE: [number, number] = [0x00449620, 0x00451720];
const ZSKAMERE = 0x17;
const ZSKAMERE_SET = 2;
/** The three literal stores of state 10 the reading names. */
const STATE10_STORES = [0x0044b84f, 0x0044be9a, 0x0044e804];
/** ...and the one of state 11, inside `ThrowerFindSurfaceUnderfoot`. */
const STATE11_STORES = [0x0044c9df];
/** The two `OR`s of `0x20000000`: `OR EDI` and `OR EAX`. */
const RETREAT_BIT = 0x20000000;
const RETREAT_WRITERS = [0x0044b8ba, 0x0044ec9f];
const PICKS = 80;

const u32At = (d: Uint8Array, o: number): number =>
  (d[o]! | (d[o + 1]! << 8) | (d[o + 2]! << 16) | (d[o + 3]! << 24)) >>> 0;

/** Every virtual address in class 0x31's code where `pat` starts. */
function findInCode(exe: ExeTables, pat: number[]): number[] {
  const [lo, hi] = CLASS31_CODE;
  const r = exe.v2r(lo)!;
  const out: number[] = [];
  outer: for (let i = r; i + pat.length <= r + (hi - lo); i++) {
    for (let j = 0; j < pat.length; j++) {
      if (exe.data[i + j] !== pat[j]) continue outer;
    }
    out.push(lo + (i - r));
  }
  return out;
}

/** `E8 rel32` call sites between `lo` and `hi` that land on `target`. */
function callersOf(exe: ExeTables, target: number, lo: number, hi: number):
    number[] {
  const r = exe.v2r(lo)!;
  const out: number[] = [];
  for (let i = r; i + 5 <= r + (hi - lo); i++) {
    if (exe.data[i] !== 0xe8) continue;
    const rel = u32At(exe.data, i + 1) | 0;
    const at = lo + (i - r);
    if (((at + 5 + rel) >>> 0) === target) out.push(at);
  }
  return out;
}

function stateStores(exe: ExeTables, state: number): number[] {
  // `MOV word ptr [reg + 0x1310], imm16` -- `66 c7 <modrm> 10 13 00 00 ii 00`;
  // the address reported is the instruction's, three bytes before.
  return findInCode(exe, [0x10, 0x13, 0x00, 0x00, state & 0xff, state >> 8])
    .filter((a) => {
      const r = exe.v2r(a - 3)!;
      return exe.data[r] === 0x66 && exe.data[r + 1] === 0xc7;
    })
    .map((a) => a - 3);
}

const list = (xs: number[]): string => xs.map((a) => hex(a, 8)).join(", ")
  || "none";
const same = (a: number[], b: number[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

function checkArm(c: Checker, exe: ExeTables): void {
  c.eq(exe.ru32(G_CLASS31_STATES + 10 * 4), LEAP_ASIDE,
       "g_class31_states[10] is ThrowerStateLeapAside");
  c.eq(exe.ru32(G_CLASS31_STATES + 9 * 4), 0x0044b670,
       "...with ThrowerStateLeapDown beside it at [9] (the table is not adrift)");
  const r = exe.v2r(0x0044ba6d)!;
  const arm = [...exe.data.subarray(r, r + 3)];
  c.ok(arm[0] === 0x48 && arm[1] === 0x74
       && 0x0044ba6e + 2 + (arm[2]! << 24 >> 24) === 0x0044bae7,
       `type 0x17's arm is DEC EAX; JZ 0x0044BAE7 at 0x0044BA6D `
       + `(${arm.map((b) => b.toString(16).padStart(2, "0")).join(" ")})`);
  const m = exe.v2r(0x0044bae5)!;
  c.ok(exe.data[m] === 0xf3 && exe.data[m + 1] === 0xa5,
       "...which lands two bytes past the MOVSD.REP at 0x0044BAE5 (f3 a5)");
}

function checkStores(c: Checker, exe: ExeTables): void {
  const s10 = stateStores(exe, 0x0a);
  c.ok(same(s10, STATE10_STORES),
       `state 10 is stored in class 0x31's code at ${list(STATE10_STORES)} and `
       + `nowhere else (${list(s10)})`);
  const s11 = stateStores(exe, 0x0b);
  c.ok(same(s11, STATE11_STORES),
       `state 11 is stored once, in ThrowerFindSurfaceUnderfoot (${list(s11)})`);
  const [lo, hi] = CLASS31_CODE;
  const underfoot = callersOf(exe, 0x0044c640, lo, hi);
  const snap = callersOf(exe, 0x0044c600, lo, hi);
  c.ok(same(underfoot, [0x0044c60f]) && same(snap, [0x00449e66]),
       `ThrowerFindSurfaceUnderfoot's one caller is ThrowerSnapToSurface `
       + `(${list(underfoot)}) and that one's is ThrowerPushOutOfWorld `
       + `(${list(snap)})`);
  const g = exe.v2r(0x00449e54)!;
  const gate = [...exe.data.subarray(g, g + 12)];
  c.ok(gate[0] === 0x66 && gate[1] === 0x83 && gate[3] === 0x07
       && gate[6] === 0x66 && gate[7] === 0x83 && gate[9] === 0x08,
       "...behind CMP SI, 7 and CMP SI, 8 at 0x00449E54");
  // The pounce's way in: `ThrowerStateWaitForPermit`'s table by type.
  const tab = [0, 1, 2, 3].map((i) => exe.ru32(0x0044b600 + i * 4) ?? 0);
  c.ok(tab[0] === 0x0044b526 && tab[2] === 0x0044b526 && tab[3] === 0x0044b526
       && tab[1] === 0x0044b54d,
       `WaitForPermit sends 0x16, 0x18 and 0x19 to 0x0044B526 and 0x17 to its `
       + `own arm at 0x0044B54D (${list(tab)})`);
  const s9 = stateStores(exe, 0x09).filter((a) => a >= 0x0044b3e0
                                                 && a < 0x0044b670);
  const s18 = stateStores(exe, 0x18).filter((a) => a >= 0x0044b54d
                                                  && a < 0x0044b5c8);
  const s20 = stateStores(exe, 0x20).filter((a) => a >= 0x0044b54d
                                                  && a < 0x0044b5c8);
  c.ok(same(s9, [0x0044b53c]) && same(s18, [0x0044b5bb])
       && same(s20, [0x0044b58b]),
       `...where the shared arm stores 9 (${list(s9)}) and type 0x17's stores `
       + `0x18 (${list(s18)}) or 0x20 (${list(s20)})`);
}

function checkRetreatBit(c: Checker, exe: ExeTables): void {
  const [lo, hi] = CLASS31_CODE;
  const r = exe.v2r(lo)!;
  const code = exe.data.subarray(r, r + (hi - lo));
  const hits: number[] = [];
  let ors = 0;
  for (const i of sweep(code, lo)) {
    const b0 = code[i.address - lo]!;
    const isOr = b0 === 0x0d
      || (b0 === 0x81 && ((code[i.address - lo + 1]! >> 3) & 7) === 1);
    if (!isOr) continue;
    ors++;
    if (i.imms.some((v) => (v >>> 0) & RETREAT_BIT)) hits.push(i.address);
  }
  c.ok(ors > 0, `the sweep finds ${ors} ORs with a 32-bit immediate in class `
       + "0x31's code (an empty sweep is broken, not clean)");
  c.ok(same(hits, RETREAT_WRITERS),
       `obj+0x34 bit 0x20000000 is raised only by the leap aside and the `
       + `withdraw (${list(hits)})`);
  // A byte-wide `OR byte ptr [reg + 0x37], imm8` would raise it too.
  const bytewise = findInCode(exe, [0x37, 0x20])
    .filter((a) => {
      const q = exe.v2r(a - 2)!;
      return exe.data[q] === 0x80 && ((exe.data[q + 1]! >> 3) & 7) === 1;
    });
  c.eq(bytewise.length, 0, "...and no byte-wide OR of +0x37 raises it");
}

function picksOf(exe: ExeTables, set: number, band: number): Set<number> {
  const bands = exe.ru32(G_ACTION_PICKS + set * 4)!;
  const row = exe.ru32(bands + band * 4)!;
  const out = new Set<number>();
  for (let k = 0; k < PICKS; k++) out.add(exe.ru32(row + k * 4)!);
  return out;
}

function checkPicks(c: Checker, exe: ExeTables): void {
  const fmt = (s: Set<number>): string => [...s].sort((a, b) => a - b).join("/");
  const b1 = picksOf(exe, ZSKAMERE_SET, 1);
  const b2 = picksOf(exe, ZSKAMERE_SET, 2);
  c.ok(b1.size === 1 && b1.has(7) && b2.size === 1 && b2.has(7),
       `g_class31_action_picks set 2 offers only 7 in bands 1 and 2 `
       + `(${fmt(b1)}; ${fmt(b2)})`);
  const c1 = picksOf(exe, 0, 1);
  const c2 = picksOf(exe, 0, 2);
  c.ok(c1.has(12) && c2.has(13),
       `...where set 0 offers the pounces 12 and 13 (the control: ${fmt(c1)}; `
       + `${fmt(c2)})`);
  const atk = new Set<number>();
  const row = exe.ru32(G_ATTACK_PICKS + ZSKAMERE_SET * 4)!;
  for (let k = 0; k < PICKS; k++) atk.add(exe.ru32(row + k * 4)! & 0xff);
  c.ok(atk.size > 0 && !atk.has(3),
       `set 2's attack picks never name attack 3 (${fmt(atk)})`);
}

async function checkData(c: Checker, exe: ExeTables,
                         source: Awaited<ReturnType<typeof openGame>>["source"]):
    Promise<void> {
  const com = evt.parse(await source.read("evt/comevtbl.bin"), "comevtbl.bin");
  let n = 0;
  const odd: string[] = [];
  const starts = new Map<number, number>();
  for (let scene = 0; scene < ExeTables.SCENE_COUNT; scene++) {
    const name = exe.sceneEvtFile(scene);
    if (!name || !(await source.exists(`evt/${name}`))) continue;
    const f = evt.parse(await source.read(`evt/${name}`), name,
                        exe.sceneBlockCount(scene), com);
    for (const rec of evt.spawns(f)) {
      if (rec.cls !== 0x31 || (rec.param(0, "i8") ?? 0) !== ZSKAMERE) continue;
      n++;
      const set = rec.param(1, "i8") ?? -1;
      const init = rec.param(2, "i8") ?? -1;
      starts.set(init, (starts.get(init) ?? 0) + 1);
      if (set !== ZSKAMERE_SET || (init !== 18 && init !== 20)) {
        odd.push(`scene ${scene} ${hex(rec.offset)}: set ${set} state ${init}`);
      }
    }
  }
  c.note(`type-0x17 class-0x31 descriptors: ${n}, starting in `
         + [...starts].map(([s, k]) => `${s} x${k}`).join(", "));
  c.ok(n > 0, "the census finds zskamere descriptors (an empty census is "
       + "broken, not clean)");
  c.ok(!odd.length, "every zskamere is set 2 and starts in state 18 or 20"
       + (odd.length ? ` -- ${odd.slice(0, 4).join("; ")}` : ""));
}

async function main(): Promise<void> {
  const dir = gameDirOrSkip("zskamere_aside");
  const { source, exe } = await openGame(dir);
  const c = new Checker("zskamere_aside");
  checkArm(c, exe);
  checkStores(c, exe);
  checkRetreatBit(c, exe);
  checkPicks(c, exe);
  await checkData(c, exe, source);
  c.finish();
}

await main();
