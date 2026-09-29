/**
 * Can anything the shipped game runs cut a class-0x30 actor in two?
 *
 *     node tools/run_ts.mjs tools/checks/split_unreachable.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * `ZombieSplitInTwo` (`FUN_0045D9F0`) allocates a second `EnemyZombieUpdate`
 * actor and gives it one of the skeleton's two roots, and the port does **not**
 * transcribe it, on the reading that nothing reaches it. It has three callers,
 * and that reading is three separate claims about the EXE and the data. This
 * check holds each of them, with a positive control beside every negative one
 * so that a search which finds nothing cannot pass by being broken (`L32`):
 *
 * 1. **`ActorReactToHit`'s arm needs `g_hit_result == 4`, and nothing writes
 *    4.** Every instruction that names `g_hit_result` (`0x009A58F8`) is found
 *    by its address bytes, classified by the two bytes in front of them, and
 *    every `MOV [reg*4 + 0x009A58F8], imm32` must store one of 0/1/2/3/5. The
 *    second player's slot, `0x009A58FC`, must not appear at all, and the one
 *    `LEA` of the array -- `ZombieOnShot`'s at `0x00453F0D` -- is the only way
 *    to hold a pointer to it.
 * 2. **The other two callers need `obj+0x136C` bit `0x1000000`, and only state
 *    0x35 raises it.** A linear sweep of class 0x30's code
 *    (`0x00452DA0`..`0x0045ECC0`) finds every `OR` with a 32-bit immediate
 *    carrying the bit, and there must be exactly one:
 *    `ZombieStateCollapseToCondition4` at `0x0045E6A2`.
 * 3. **Nothing enters state 0x35.** No `MOV word [reg + 0x1310], 0x35` in the
 *    image (0x34 and 0x32 each have exactly one, as controls); no class-0x30
 *    spawn descriptor in any scene names 0x32..0x35 as its initial or attack
 *    state (the attack state is also where the entry tails and the
 *    stand-and-throw exit come from); no civilian op-0x1A order names one; and
 *    no class-0x30 descriptor's `+0x20` word has bit 15, which is what would
 *    sign-extend into the high half of `obj+0x136C`.
 *
 * And the half that **is** reached, as the control on the data side: body
 * condition 4 is carried by character type 0xC and nothing else, which is
 * what sends `znkager` through `ZombieInitHalved` (`FUN_0045DA10`) and into
 * `ZombieStateLeapStrike` (`FUN_0045E330`).
 *
 * It also re-reads `g_class30_states` (`0x00592AE8`) at 0x31..0x36, so the
 * state numbers above are the table's and not the port's (`L38`).
 *
 * Ported from the branch's `tools/verify_split_unreachable.py`, which read the
 * game through the Python library and capstone; the sweep here is
 * `lib_x86.ts`'s, and the descriptors are the exporter's own
 * (`hod2lib/evt.ts`), civilian captors included.
 */
import { Checker, gameDirOrSkip, hex, openGame } from "../lib/exe_check";
import { ExeTables } from "../../src/hod2lib/exetab";
import * as evt from "../../src/hod2lib/evt";
import { sweep } from "./lib_x86";

const G_HIT_RESULT = 0x009a58f8;
const G_CLASS30_STATES = 0x00592ae8;
/** `g_class30_states[0x31..0x36]`, read out of the table. */
const STATE_TABLE: Record<number, number> = {
  0x31: 0x0041ebb0,   // NoOpStub, the filler
  0x32: 0x0045e010,   // ZombieStateSplitLaunch
  0x33: 0x0045ded0,   // ZombieStateSplitHalfCollapse
  0x34: 0x0045e330,   // ZombieStateLeapStrike
  0x35: 0x0045e660,   // ZombieStateCollapseToCondition4
  0x36: 0x00456920,   // ActorCheckWaterEntry
};
/** The half-body family's states, none of which the data may name. */
const SPLIT_STATES = new Set([0x32, 0x33, 0x34, 0x35]);
const CLASS30_CODE: [number, number] = [0x00452da0, 0x0045ecc0];
const SPLIT_ARMED = 0x1000000;
const SPLIT_ARMED_WRITER = 0x0045e6a2;
/** The two bytes in front of `0x009A58F8`, by what the instruction does. */
const HIT_RESULT_FORMS: Record<string, string> = {
  "c704": "store",     // MOV dword ptr [reg*4 + disp32], imm32
  "833c": "compare",
  "8b04": "load",
  "8d1c": "lea",
};
const HIT_RESULTS_WRITTEN = [0, 1, 2, 3, 5];

function le32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

/** Every file offset at which `pat` starts. */
function findAll(data: Uint8Array, pat: number[]): number[] {
  const out: number[] = [];
  outer: for (let i = 0; i + pat.length <= data.length; i++) {
    for (let j = 0; j < pat.length; j++) {
      if (data[i + j] !== pat[j]) continue outer;
    }
    out.push(i);
  }
  return out;
}

const u32At = (d: Uint8Array, o: number): number =>
  (d[o]! | (d[o + 1]! << 8) | (d[o + 2]! << 16) | (d[o + 3]! << 24)) >>> 0;

function checkStateTable(c: Checker, exe: ExeTables): void {
  const wrong: string[] = [];
  const got: string[] = [];
  for (const [i, want] of Object.entries(STATE_TABLE)) {
    const v = exe.ru32(G_CLASS30_STATES + Number(i) * 4);
    got.push(hex(v ?? 0, 8));
    if (v !== want) wrong.push(`[${hex(Number(i))}] = ${hex(v ?? 0, 8)}`);
  }
  c.ok(!wrong.length,
       `g_class30_states[0x31..0x36] is ${got.join(" ")}`
       + (wrong.length ? ` -- differs from the reading at ${wrong.join(", ")}` : ""));
}

function checkHitResult(c: Checker, exe: ExeTables): void {
  const data = exe.data;
  const stores = new Set<number>();
  const kinds = new Map<string, number>();
  const leas: number[] = [];
  const unknown: string[] = [];
  const hits = findAll(data, le32(G_HIT_RESULT));
  for (const at of hits) {
    const key = [data[at - 3]!, data[at - 2]!]
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    const form = HIT_RESULT_FORMS[key];
    if (!form) {
      unknown.push(`${hex(at)}: ${key}`);
      continue;
    }
    kinds.set(form, (kinds.get(form) ?? 0) + 1);
    if (form === "store") stores.add(u32At(data, at + 4));
    if (form === "lea") leas.push(at);
  }
  c.note(`g_hit_result is named ${hits.length} times: `
         + [...kinds].sort().map(([k, n]) => `${k} x${n}`).join(", ")
         + `; the stores write ${[...stores].sort((a, b) => a - b).join(", ")}`);
  c.ok(!unknown.length,
       "every instruction naming g_hit_result is a store, compare, load or LEA"
       + (unknown.length ? ` -- unrecognised at ${unknown.join("; ")}` : ""));
  c.ok(stores.size > 0,
       "the search finds stores to g_hit_result (the control: an empty search "
       + "is broken, not clean)");
  c.ok(!stores.has(4), "nothing stores 4 to g_hit_result");
  c.ok([...stores].every((v) => HIT_RESULTS_WRITTEN.includes(v))
       && HIT_RESULTS_WRITTEN.every((v) => stores.has(v)),
       `the stores write exactly ResolveHit's results 0/1/2/3/5 `
       + `(${[...stores].sort((a, b) => a - b).join("/")})`);
  const leaAt = exe.v2r(0x00453f0d + 3);
  c.ok(leas.length === 1 && leas[0] === leaAt,
       `the one LEA of g_hit_result is ZombieOnShot's at 0x00453F0D `
       + `(${leas.length} found)`);
  const second = findAll(data, le32(G_HIT_RESULT + 4)).length;
  c.eq(second, 0, `player 1's slot, ${hex(G_HIT_RESULT + 4, 8)}, is never named`);
}

function checkStateLiterals(c: Checker, exe: ExeTables): void {
  // `MOV word ptr [reg + 0x1310], imm16`: the displacement starts three bytes
  // into the instruction (66 c7 86 | 10 13 00 00 | imm16).
  const sites = (state: number): number[] =>
    findAll(exe.data, [0x10, 0x13, 0x00, 0x00, state & 0xff, state >> 8]);
  const n32 = sites(0x32);
  const n34 = sites(0x34);
  const n35 = sites(0x35);
  c.note(`literal state stores: 0x32 x${n32.length}, 0x34 x${n34.length}, `
         + `0x35 x${n35.length}`);
  // The controls: `ZombieSplitUpdateSelf` writes 0x32 at 0x0045DA76 and
  // `ZombieStateHoldAtRange` 0x34 at 0x0045587C.
  c.ok(n32.length === 1 && n32[0] === exe.v2r(0x0045da76 + 3)
       && n34.length === 1 && n34[0] === exe.v2r(0x0045587c + 3),
       "the literal-state search finds its controls: 0x32 at 0x0045DA76 "
       + "alone, 0x34 at 0x0045587C alone");
  c.eq(n35.length, 0, "state 0x35 is never stored as a literal");
}

function checkSplitArmedWriters(c: Checker, exe: ExeTables): void {
  const [lo, hi] = CLASS30_CODE;
  const r = exe.v2r(lo)!;
  const code = exe.data.subarray(r, r + (hi - lo));
  const hits: number[] = [];
  const ins = sweep(code, lo);
  for (const i of ins) {
    // A 32-bit immediate field only: `83 /1 ib` sign-extends, and
    // `OR EAX, -2` is the `rand()` normalising idiom, not a flag.
    const b0 = code[i.address - lo]!;
    const isOr = b0 === 0x0d
      || (b0 === 0x81 && ((code[i.address - lo + 1]! >> 3) & 7) === 1);
    if (isOr && i.imms.some((v) => (v >>> 0) & SPLIT_ARMED)) {
      hits.push(i.address);
    }
  }
  c.note(`class 0x30's code, ${ins.length} instructions: an OR of 0x1000000 at `
         + hits.map((a) => hex(a, 8)).join(", "));
  c.ok(hits.length === 1 && hits[0] === SPLIT_ARMED_WRITER,
       `obj+0x136C bit 0x1000000 is raised only at ${hex(SPLIT_ARMED_WRITER, 8)}`
       + ` (${hits.map((a) => hex(a, 8)).join(", ") || "none found"})`);
}

/**
 * Every spawn descriptor in *f*, **and** the ones only a civilian points at.
 *
 * `CivilianInit` (`FUN_0048A3E0`) spawns its captors from an array of
 * descriptor pointers at tail `+0x10`, count at `+0x0C`, which no evt
 * instruction points at -- so `evt.spawns` never returns them, and three of
 * the twenty `znkager` are among them. The same walk as `characters.ts`'s.
 */
function withCivilianChildren(f: evt.EvtFile): evt.Spawn[] {
  const recs = new Map<number, evt.Spawn>();
  for (const r of evt.spawns(f)) recs.set(r.offset, r);
  for (const rec of [...recs.values()]) {
    if (rec.cls !== 0x10) continue;
    const n = rec.param(0x0c, "i32") || 0;
    for (let k = 0; k < Math.max(0, Math.min(n, 32)); k++) {
      const w = rec.param(0x10 + k * 4, "u32");
      const off = w ? f.toOffset(w) : null;
      if (off === null || recs.has(off) || off > f.raw.length - 0x24) continue;
      recs.set(off, evt.readSpawn(f, off, 0x0b));
    }
  }
  return [...recs.values()];
}

async function checkData(c: Checker, exe: ExeTables,
                         source: Awaited<ReturnType<typeof openGame>>["source"]):
    Promise<void> {
  const named: string[] = [];
  const bit15: string[] = [];
  const cond4 = new Map<number, number>();
  let records = 0;
  const com = evt.parse(await source.read("evt/comevtbl.bin"), "comevtbl.bin");
  for (let scene = 0; scene < ExeTables.SCENE_COUNT; scene++) {
    const name = exe.sceneEvtFile(scene);
    if (!name || !(await source.exists(`evt/${name}`))) continue;
    const f = evt.parse(await source.read(`evt/${name}`), name,
                        exe.sceneBlockCount(scene), com);
    for (const rec of withCivilianChildren(f)) {
      if (rec.cls !== 0x30) continue;
      records++;
      const where = `scene ${scene} ${hex(rec.offset)}`;
      const char = rec.param(0, "i8") ?? 0;
      const cond = rec.param(1, "i8") ?? 0;
      const init = rec.param(2, "i8") ?? 0;
      const attack = rec.param(3, "i8") ?? 0;
      if (SPLIT_STATES.has(init) || SPLIT_STATES.has(attack)) {
        named.push(`${where}: states ${init}/${attack}`);
      }
      if (rec.descFlags & 0x8000) bit15.push(where);
      if (cond === 4) cond4.set(char, (cond4.get(char) ?? 0) + 1);
    }
  }
  const orders = new Map<number, number>();
  for (const script of exe.civilianScripts().scripts) {
    for (const cmd of script) {
      if (cmd.op === 0x1a && cmd.args.length && typeof cmd.args[0] === "number") {
        orders.set(cmd.args[0], (orders.get(cmd.args[0]) ?? 0) + 1);
      }
    }
  }
  c.note(`${records} class-0x30 descriptors across every scene; body condition `
         + `4 on ${[...cond4].map(([t, n]) => `type ${hex(t)} x${n}`).join(", ")}`);
  c.note(`civilian op-0x1A orders: ${[...orders].sort((a, b) => a[0] - b[0])
    .map(([s, n]) => `${hex(s)} x${n}`).join(", ")}`);
  c.ok(records > 0 && orders.size > 0,
       "the census read class-0x30 descriptors and civilian orders (an empty "
       + "census is broken, not clean)");
  c.ok(!named.length,
       "no class-0x30 descriptor names a half-body state as initial or attack"
       + (named.length ? ` -- ${named.slice(0, 4).join("; ")}` : ""));
  const ordered = [...orders.keys()].filter((s) => SPLIT_STATES.has(s));
  c.ok(!ordered.length, "no civilian orders a half-body state"
       + (ordered.length ? ` -- ${ordered.map((s) => hex(s)).join(", ")}` : ""));
  c.ok(!bit15.length,
       "no class-0x30 descriptor sets bit 15 of its +0x20 word"
       + (bit15.length ? ` -- ${bit15.slice(0, 4).join("; ")}` : ""));
  // The control: the reached half is reached, by znkager and by nothing else.
  c.ok(cond4.size === 1 && cond4.has(0xc),
       `body condition 4 is character type 0xC's alone `
       + `(${[...cond4.keys()].map((t) => hex(t)).join(", ") || "none"})`);
}

async function main(): Promise<void> {
  const dir = gameDirOrSkip("split_unreachable");
  const { source, exe } = await openGame(dir);
  const c = new Checker("split_unreachable");
  checkStateTable(c, exe);
  checkHitResult(c, exe);
  checkStateLiterals(c, exe);
  checkSplitArmedWriters(c, exe);
  await checkData(c, exe, source);
  c.finish();
}

await main();
