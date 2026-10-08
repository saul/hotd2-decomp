/**
 * The compiled-in and evt-borne actor scripts, decoded whole: class 0x10's
 * command streams, class 0x30's captor scripts and their kill cues, class
 * 0x25's command blocks -- and, with a bundle, every clip a scripted class can
 * put on an actor, baked for that actor.
 *
 *     node tools/run_ts.mjs tools/checks/script_corpus.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * Each of these is a stream of commands whose lengths the reader has to get
 * right, and a wrong length does not fail loudly: the cursor lands mid-command
 * and what comes out is a pointer or a float read as an opcode, a list that
 * never terminates, or a jump into the middle of something. So the checks
 * are the ones a desync cannot pass -- every stream terminates, no byte is two
 * commands, every edge lands on a command -- plus the corpus totals the docs
 * quote. Everything is read through `hod2lib/` (`ExeTables.civilianScripts`,
 * `actorscript.ts`, `charmotion.ts`, `evt.ts`), the code the exporter runs.
 *
 * What this asserts, and the statement each assertion guards:
 *
 *  * **Class 0x10's streams** (`docs/formats/civilians.md`, the opening
 *    section; `game/class10/index.ts`; `game/tables.ts`): the 67 table
 *    entries lead to 136 streams and 1,967 commands; every stream ends in
 *    exactly one `0x2D`; re-walked by address with `ExeTables`' own length
 *    tables, no byte is claimed by two commands, none runs into the table,
 *    and 17,684 of the 18,728 bytes from `0x0056B980` up to the table are
 *    command.
 *  * **Op `0x18` copies six dwords**, three floats and three BAMS integers:
 *    five poses, yawing `0xC000`, `0x2D00`, `0x4000`, `0x6000` and `0x7000`
 *    (`civilians.md`'s opcode table), the first stage 1's bin civilian at
 *    `(-698, _, -541)` (`exetab.ts`'s note in `civilianScripts`).
 *  * **The 596 wait words**, bit by bit, as `civilians.md`'s "of 596" table
 *    and the paragraph under it count them -- `0x00080000` in 125,
 *    `0x02000000` in 90, the root-motion bit in 289 (also `class10/ops.ts`'s
 *    `RootMotion`, `game/root_motion.ts`) -- and the port's `CivilianWait`
 *    names for the bits the table describes. Of the 126 streams that end in
 *    themselves -- ten hand over with op `0x1E`/`0x1F` -- 87 end on a
 *    `0x02000000` word (`civilians.md`, `CivilianUpdate`'s four arms;
 *    `class10/update.ts`'s `CivilianCheckRemoval`).
 *  * **Class 0x30's captor scripts** (`civilians.md`, "The two scripts";
 *    `actorscript.ts`'s `TARGET_SCRIPT_SHAPE` and `targetScript`): the header
 *    shapes are the doc's table; a civilian's children are 60 -- 57 class
 *    0x30 and 3 class 0x18, at stage 2's `0xA174` and stage 3's `0xC00` and
 *    `0x71D0` (`civilians.md`, "The rescue, and what the class is"); every
 *    script a spawn reaches -- through the state its civilian's op `0x1A`
 *    orders when its own is 39 -- has both pointers in the evt and decodes,
 *    every list terminates inside 64 entries on motions that are ids, and
 *    every leap header off a carrier reads as one. 76 spawns reach a script
 *    and 117 scripts decode.
 *  * **Kill cues count in the play clock** (`game/tables.ts`'s
 *    `MotionPlayFrame`, `docs/formats/mot.md`'s cursor section): every cue a
 *    captor list names is inside its clip's `g_motion_play_length`; stage 1's
 *    maul cues -- the lists states 34 and 35 step -- are 24, 30, 62 and 64
 *    against clips of 41, 26, 43 and 46 frames, and only the 24 is inside
 *    its clip counted in authored frames.
 *  * **Class 0x25's blocks** (`game/class25/index.ts`'s module note,
 *    `charmotion.ts`'s `humanoidSkipTarget` and `humanoidCommandOffsets`,
 *    `bundle.ts`'s `scriptedHumanoidsJson`): all 137 blocks decode with every
 *    opcode in 0..18 or -1; every command but 15, 18 and -1 falls through to
 *    the next command the walk emits, so the flat list's `pc += 1` is the
 *    engine's cursor; every `op 10` test's forward scan for `-2` lands on a
 *    command, none runs off the file; every `op 15` jumps to a command.
 *  * **Class 0x20** (`docs/formats/spawns.md`'s class table,
 *    `game/class20/index.ts`): all 36 spawns are character type 7, and 8 of
 *    them name no motion.
 *  * **With a bundle, every clip a scripted class can reach is baked, with
 *    frames, for the spawn's own character type**, in every stage the bundle
 *    holds: a class-0x25 block's header motion and every `op 2`/`op 3`
 *    operand, and class 0x20's four `g_class20_idle_motions`, motion 988 and
 *    the tail's `+0x06` (`characters.ts` beside the bake list;
 *    `charmotion.ts`'s `CLASS20_IDLE_MOTIONS`). A clip with no frames parks a
 *    class-0x25 program on its `op 1` mode 2 wait for the rest of the stage.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gameDirOrSkip, openGame, Checker, hex } from "../lib/exe_check";
import { bundleDir } from "./lib_d3d";
import { ExeTables } from "../../src/hod2lib/exetab";
import type { AssetSource } from "../../src/hod2lib/io";
import * as evt from "../../src/hod2lib/evt";
import { i16, u32 } from "../../src/hod2lib/bytes";
import { Stage } from "../../src/hod2lib/stage";
import { loadBank, type MotionBank } from "../../src/hod2lib/mot";
import {
  civilianOrderedStates, TARGET_SCRIPT_SHAPE, targetScript, type TargetScript,
} from "../../src/hod2lib/actorscript";
import {
  CLASS20_DEATH_MOTION, CLASS20_IDLE_MOTIONS, humanoidBlockOffset, humanoidCmdLen,
  humanoidCommandOffsets, humanoidMotionIds, humanoidSkipTarget,
} from "../../src/hod2lib/charmotion";
import { CivilianOp, CivilianWait } from "../../src/game/class10/ops";

// -- class 0x10 -------------------------------------------------------------

/** `civilians.md`: what the shipped exe holds. */
const CIV_ENTRIES = 67;
const CIV_STREAMS = 136;
const CIV_COMMANDS = 1967;
const CIV_REGION_START = 0x0056b980;
const CIV_REGION_BYTES = 18728;
const CIV_COMMAND_BYTES = 17684;

/** `civilians.md`'s opcode table: op 0x18's five yaws, in stream order. */
const POSE_YAWS = [0xc000, 0x2d00, 0x4000, 0x6000, 0x7000];
/** Stage 1's bin civilian: `(-698, _, -541)`, yaw `0xC000`. */
const BIN_CIVILIAN: [number, number, number] = [-698, -541, 0xc000];

/** `civilians.md`'s "of 596" table and the paragraph under it. */
const WAITS = 596;
const WAIT_BITS: [number, number][] = [
  [0x00008000, 28], [0x00010000, 4], [0x00020000, 16], [0x00080000, 125],
  [0x00100000, 289], [0x00200000, 75], [0x02000000, 90], [0x08000000, 9],
  [0x10000000, 37], [0x00040000, 315], [0x00800000, 11], [0x01000000, 25],
  [0x04000000, 21], [0x20000000, 3],
];
/** The port's names for the bits the table describes. */
const WAIT_NAMES: [number, number, string][] = [
  [CivilianWait.TurnKeepBones, 0x00008000, "TurnKeepBones"],
  [CivilianWait.TurnTakeRoot, 0x00010000, "TurnTakeRoot"],
  [CivilianWait.HoldBone1, 0x00020000, "HoldBone1"],
  [CivilianWait.LeaveCountNow, 0x00080000, "LeaveCountNow"],
  [CivilianWait.Cut, 0x00200000, "Cut"],
  [CivilianWait.RemoveOffCamera, 0x02000000, "RemoveOffCamera"],
  [CivilianWait.Uncounted, 0x08000000, "Uncounted"],
  [CivilianWait.Rescued, 0x10000000, "Rescued"],
  [CivilianWait.CameraTrack, 0x00040000, "CameraTrack"],
  [CivilianWait.GiveItem, 0x00800000, "GiveItem"],
  [CivilianWait.PushOutOfWorld, 0x01000000, "PushOutOfWorld"],
];
/** `civilians.md` and `class10/update.ts`: `[end in themselves, hand over, of those on 0x02000000]`. */
const STREAM_ENDS: [number, number, number] = [126, 10, 87];

// -- class 0x30's captors ---------------------------------------------------

/** `civilians.md`'s header table: `[header bytes, shorts per entry]`. */
const SHAPES: Record<number, [number, number]> = {
  34: [10, 4], 35: [0, 4], 36: [0, 5], 38: [20, 4], 40: [16, 4], 41: [16, 4], 43: [4, 0],
};
/** `civilians.md`: a civilian's children, and the class-0x18 ones by stage. */
const CHILDREN: [number, number, number] = [60, 57, 3];
const CHILD_RIDERS: [number, number][] = [[2, 0xa174], [3, 0x0c00], [3, 0x71d0]];
/** Captor spawns that reach a script, and the scripts they reach. */
const CAPTOR_SPAWNS = 76;
const CAPTOR_SCRIPTS = 117;
const ENTRY_CAP = 64;
/** `mot.md` and `game/tables.ts`: stage 1's maul, `[cue, frames]`. */
const STAGE1_MAUL: [number, number][] = [[24, 41], [30, 26], [62, 43], [64, 46]];
const MAUL_STATES = [34, 35];

// -- class 0x25 and class 0x20 ---------------------------------------------

/** `class25/index.ts`. */
const HUMANOID_BLOCKS = 137;
/**
 * The programs whose own first command (`blk + 8`, where
 * `ScriptedHumanoidInit` points the cursor) is not the first one the
 * address-ordered list emits, because an `op 15` jumps back into commands
 * stored before the block: every one a player-2 figure (type `0x3A`) sharing
 * player 1's tail. The bundle's `entry` is what starts them in the right
 * place.
 */
const HUMANOID_ENTRY_NOT_FIRST = 13;
/** `charmotion.ts`: the `op 10` modes that test; `-2` closes an arm. */
const IF_MODES = [0, 1, 2];
/** `spawns.md` and `class20/index.ts`. */
const CLASS20: [number, number, number] = [36, 7, 8];

interface Captor {
  stage: number;
  at: number;
  cls: number;
  scripts: TargetScript[];
}

/** A count, compared and printed in decimal. */
function count(c: Checker, got: number, want: number, what: string): boolean {
  return c.ok(got === want, `${what}: ${got}` + (got === want ? "" : `, expected ${want}`));
}

function sameList(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function civilianStreams(c: Checker, exe: ExeTables): void {
  const blk = exe.civilianScripts();
  const cmds = blk.scripts.reduce((n, s) => n + s.length, 0);
  count(c, blk.entries.length, CIV_ENTRIES, "g_civilian_scripts entries");
  count(c, blk.scripts.length, CIV_STREAMS, "civilian streams");
  count(c, cmds, CIV_COMMANDS, "civilian commands");
  const badEnd = blk.scripts.filter((s) => s.at(-1)?.op !== CivilianOp.End).length;
  const inner = blk.scripts.filter((s) => s.slice(0, -1).some((x) => x.op === CivilianOp.End)).length;
  count(c, badEnd, 0, "streams that do not end in 0x2D");
  count(c, inner, 0, "streams with a 0x2D before their last command");

  // Re-walk by address for the overlap and coverage. The low bound comes
  // from the walk: a stream only an op-0x0E operand names starts before the
  // first table entry.
  const hi = ExeTables.CIVILIAN_SCRIPT_TABLE;
  const owner = new Map<number, number>();
  const seen = new Set<number>();
  const pending: number[] = [];
  for (let i = 0; i < blk.entries.length; i++) pending.push(exe.ru32(hi + 4 * i)!);
  let overlaps = 0;
  const past: string[] = [];
  while (pending.length) {
    const va = pending.shift()!;
    if (seen.has(va)) continue;
    seen.add(va);
    for (let p = va; ;) {
      const op = exe.ri32(p) ?? -1;
      let n = op === CivilianOp.End ? 1 : ExeTables.CIVILIAN_CMD_LEN[op] ?? 2;
      if (op === CivilianOp.SetHook) n = ExeTables.CIVILIAN_HOOK_LEN[exe.ru32(p + 4) ?? 0] ?? 2;
      if (p + 4 * n > hi) { past.push(hex(p, 8)); break; }
      for (let k = 0; k < 4 * n; k++) {
        const o = owner.get(p + k);
        if (o === undefined) owner.set(p + k, p);
        else if (o !== p) overlaps++;
      }
      if (op === CivilianOp.End) break;
      for (const j of ExeTables.CIVILIAN_SCRIPT_OPS[op] ?? []) {
        const t = exe.ru32(p + 4 * j);
        if (t) pending.push(t);
      }
      p += 4 * n;
    }
  }
  const lo = Math.min(...owner.keys());
  c.ok(!past.length, "no command runs into g_civilian_scripts"
       + (past.length ? `; ${past.slice(0, 4).join(", ")} do` : ""));
  count(c, overlaps, 0, "bytes claimed by two different commands");
  c.eq(lo, CIV_REGION_START, "the streams begin at 0x0056B980");
  count(c, hi - lo, CIV_REGION_BYTES, "bytes from the first stream up to the table");
  count(c, owner.size, CIV_COMMAND_BYTES, "of them, bytes that are command");

  // Op 0x18: three floats, then three BAMS integers.
  const poses = blk.scripts.flatMap((s) => s.filter((x) => x.op === CivilianOp.SetPose && x.pose)
    .map((x) => x.pose!));
  const bams = poses.every((p) => p.slice(3).every((v) => Number.isInteger(v)
                                                     && (v as number) > -0x10000 && (v as number) < 0x10000));
  c.ok(bams, `op 0x18's poses carry three BAMS integers after the position`);
  c.ok(sameList(poses.map((p) => p[4] as number), POSE_YAWS),
       `op 0x18's ${poses.length} yaws are ${POSE_YAWS.map((v) => hex(v)).join(", ")}: `
       + poses.map((p) => hex(p[4] as number)).join(", "));
  const [bx, bz, byaw] = BIN_CIVILIAN;
  c.ok(poses.some((p) => p[0] === bx && p[2] === bz && p[4] === byaw),
       `stage 1's bin civilian's pose (${bx}, _, ${bz}) at yaw ${hex(byaw)} is one of them`);

  // The wait words.
  const words = blk.scripts.flatMap((s) => s.filter((x) => x.op === CivilianOp.Wait)
    .map((x) => (x.args[0] as number) >>> 0));
  count(c, words.length, WAITS, "wait commands");
  for (const [bit, n] of WAIT_BITS) {
    count(c, words.filter((w) => (w & bit) >>> 0).length, n, `wait words carrying ${hex(bit, 8)}`);
  }
  for (const [v, bit, name] of WAIT_NAMES) c.eq(v as number, bit, `CivilianWait.${name} is ${hex(bit, 8)}`);
  c.note(`${words.filter((w) => !(w & CivilianWait.RootMotion)).length} of the ${words.length}`
         + " wait words do not carry the root-motion bit");

  const handOver = blk.scripts.filter((s) => s.some((x) => x.op === CivilianOp.SetResume
                                                       || x.op === CivilianOp.SetResumeByMode));
  const own = blk.scripts.filter((s) => !handOver.includes(s));
  const offCam = own.filter((s) => {
    const w = s.filter((x) => x.op === CivilianOp.Wait).at(-1);
    return !!w && ((w.args[0] as number) & CivilianWait.RemoveOffCamera) !== 0;
  });
  c.ok(own.length === STREAM_ENDS[0] && handOver.length === STREAM_ENDS[1]
       && offCam.length === STREAM_ENDS[2],
       `${own.length} streams end in themselves and ${handOver.length} hand over; `
       + `${offCam.length} end on a 0x02000000 word`);
}

/** Every captor spawn in the six stages, with the scripts it reaches. */
function captors(c: Checker, exe: ExeTables, evts: evt.EvtFile[]): Captor[] {
  const civ = exe.civilianScripts();
  const out: Captor[] = [];
  let children = 0, children30 = 0, children18 = 0;
  const riders: string[] = [];
  evts.forEach((ev, i) => {
    const stage = i + 1;
    const recs = new Map<number, evt.Spawn>(evt.spawns(ev).map((r) => [r.offset, r]));
    // The civilians' captors are not in the instruction stream; they exist
    // only as pointers in a class-0x10 tail.
    const parent = new Map<number, evt.Spawn>();
    for (const r of [...recs.values()]) {
      if (r.cls !== 0x10) continue;
      const cnt = r.param(0x0c, "i32") ?? 0;
      for (let k = 0; k < Math.max(0, Math.min(cnt, 32)); k++) {
        const w = r.param(0x10 + k * 4, "u32");
        const off = w ? ev.toOffset(w) : null;
        if (off === null) continue;
        if (!recs.has(off)) recs.set(off, evt.readSpawn(ev, off, 0x0b));
        parent.set(off, r);
      }
    }
    for (const off of parent.keys()) {
      const cls = recs.get(off)!.cls;
      children++;
      if (cls === 0x30) children30++;
      if (cls === 0x18) { children18++; riders.push(`${stage}:${hex(off)}`); }
    }
    for (const rec of recs.values()) {
      if (rec.cls !== 0x30 && rec.cls !== 0x18) continue;
      let init = rec.param(2, "i8") ?? 0;
      const atk = rec.param(3, "i8") ?? 0;
      // A captor started in state 39 is put into a state by its civilian's
      // op 0x1A, and that state reads the tail+0x04 blob.
      if (!(init in TARGET_SCRIPT_SHAPE) && parent.has(rec.offset)) {
        const ordered = civilianOrderedStates(civ, parent.get(rec.offset)!.param(1, "i8") ?? 0);
        init = ordered.find((s) => s in TARGET_SCRIPT_SHAPE) ?? init;
      }
      if (!(init in TARGET_SCRIPT_SHAPE) && !(atk in TARGET_SCRIPT_SHAPE)) continue;
      const cap: Captor = { stage, at: rec.offset, cls: rec.cls, scripts: [] };
      for (const [state, at] of [[init, 4], [atk, 8]] as [number, number][]) {
        if (!(state in TARGET_SCRIPT_SHAPE)) continue;
        const where = `stage ${stage} ${hex(rec.offset)} state ${state}`;
        const w = rec.param(at, "u32");
        const off = w ? ev.toOffset(w) : null;
        if (!c.ok(off !== null, `${where}: tail+${hex(at, 2)} is an evt offset`)) continue;
        const s = targetScript({ evt: ev }, off, state);
        if (!c.ok(s !== null, `${where}: the script decodes`) || !s) continue;
        cap.scripts.push(s);
      }
      out.push(cap);
    }
  });
  c.ok(children === CHILDREN[0] && children30 === CHILDREN[1] && children18 === CHILDREN[2],
       `a civilian's children: ${children}, ${children30} class 0x30 and ${children18} class 0x18`);
  c.eq(riders.join(" "), CHILD_RIDERS.map(([s, a]) => `${s}:${hex(a)}`).join(" "),
       "the class-0x18 children");
  return out;
}

async function frameCounter(source: AssetSource, exe: ExeTables): Promise<(m: number) => Promise<number>> {
  const banks = exe.motionBanks();
  const cache = new Map<string, MotionBank | null>();
  return async (m: number) => {
    const b = exe.motionBankOf(m);
    if (b === null || !banks.has(b)) return 0;
    const [name, ids] = banks.get(b)!;
    if (!cache.has(name)) cache.set(name, await loadBank(source, name, ids));
    return cache.get(name)?.frameCount(m) ?? 0;
  };
}

async function captorScripts(c: Checker, source: AssetSource, exe: ExeTables,
                             evts: evt.EvtFile[]): Promise<void> {
  for (const [st, shape] of Object.entries(SHAPES)) {
    c.eq(JSON.stringify(TARGET_SCRIPT_SHAPE[Number(st)]), JSON.stringify(shape),
         `TARGET_SCRIPT_SHAPE[${st}] is civilians.md's header`);
  }
  const caps = captors(c, exe, evts);
  const scripts = caps.flatMap((k) => k.scripts.map((s) => ({ k, s })));
  count(c, caps.length, CAPTOR_SPAWNS, "captor spawns that reach a script");
  count(c, scripts.length, CAPTOR_SCRIPTS, "captor scripts decoded");
  const runaway = scripts.filter(({ s }) => s.entries.length >= ENTRY_CAP);
  c.ok(!runaway.length, `every captor list ends inside ${ENTRY_CAP} entries`
       + (runaway.length ? `; not ${runaway.map(({ k, s }) => `${k.stage}:${hex(k.at)}/${s.state}`).join(", ")}` : ""));
  const notMotion = scripts.flatMap(({ k, s }) => s.entries.filter((e) => !(e.motion! > 0 && e.motion! < 4096))
    .map((e) => `${k.stage}:${hex(k.at)}/${s.state} names ${e.motion}`));
  c.ok(!notMotion.length, "every captor entry names a motion id"
       + (notMotion.length ? `; ${notMotion.slice(0, 4).join(", ")}` : ""));
  for (const { k, s } of scripts.filter(({ s }) => s.state === 47 || s.state === 48)) {
    const h = s.head as { motion: number; release: number; flag_frame: number; vy: number };
    c.ok(h.motion > 0 && h.motion < 4096 && h.release >= 0 && h.release < 1000
         && h.flag_frame >= 0 && h.flag_frame < 1000 && Math.abs(h.vy) < 100,
         `stage ${k.stage} ${hex(k.at)}: state ${s.state}'s leap header reads as one `
         + `(motion ${h.motion}, release ${h.release}, flag ${h.flag_frame}, vy ${h.vy})`);
  }

  // -- the kill cues, in the play clock ---------------------------------
  const framesOf = await frameCounter(source, exe);
  let cues = 0, lateInFrames = 0;
  const outside: string[] = [];
  const stage1 = new Map<string, [number, number]>();
  for (const { k, s } of scripts) {
    for (const e of s.entries) {
      if (e.mode! < 0) continue;                       // a negative mode kills nothing
      cues++;
      const play = exe.motionPlayLength(e.motion!) ?? 0;
      const frames = await framesOf(e.motion!);
      if (!(e.mode! < play)) outside.push(`${k.stage}:${hex(k.at)} motion ${e.motion} cue ${e.mode} of ${play}`);
      if (frames > 0 && e.mode! >= frames) lateInFrames++;
      if (k.stage === 1 && MAUL_STATES.includes(s.state)) stage1.set(`${e.mode}/${frames}`, [e.mode!, frames]);
    }
  }
  c.ok(cues > 0 && !outside.length, `all ${cues} cues are inside their clip's play length`
       + (outside.length ? `; not ${outside.slice(0, 4).join(", ")}` : ""));
  c.note(`${lateInFrames} of the ${cues} would never be reached counted in authored frames`);
  const got = [...stage1.values()].sort((a, b) => a[0] - b[0]);
  c.eq(JSON.stringify(got), JSON.stringify(STAGE1_MAUL),
       "stage 1's maul cues against their clips' frames");
  c.eq(got.filter(([cue, fr]) => cue < fr).map(([cue]) => cue).join(), "24",
       "of them, the ones inside their clip counted in frames");
}

function humanoidFlow(c: Checker, evts: evt.EvtFile[]): void {
  let blocks = 0, cmds = 0, tests = 0, jumps = 0, notFirst = 0;
  const lostEntry: string[] = [];
  const badOp: string[] = [], holes: string[] = [], skips: string[] = [], gotos: string[] = [];
  evts.forEach((ev, i) => {
    const raw = ev.raw;
    for (const rec of evt.spawns(ev)) {
      if (rec.cls !== 0x25) continue;
      const where = `stage ${i + 1} ${hex(rec.offset)}`;
      if (humanoidBlockOffset(ev, rec) === null) continue;
      blocks++;
      const offs = humanoidCommandOffsets(ev, rec);
      const seen = new Set(offs);
      const entry = humanoidBlockOffset(ev, rec)! + 8;
      if (!seen.has(entry)) lostEntry.push(where);
      else if (offs[0] !== entry) notFirst++;
      offs.forEach((off, k) => {
        cmds++;
        const op = i16(raw, off);
        const mode = i16(raw, off + 2);
        if (!((op >= 0 && op <= 18) || op === -1)) badOp.push(`${where} ${hex(off)} op ${op}`);
        if (op !== 15 && op !== 18 && op !== -1 && offs[k + 1] !== off + humanoidCmdLen(op, mode)) {
          holes.push(`${where} cmd ${k} (op ${op})`);
        }
        if (op === 10 && IF_MODES.includes(mode)) {
          tests++;
          const t = humanoidSkipTarget(raw, off);
          if (t === null || !seen.has(t)) skips.push(`${where} cmd ${k} -> ${t === null ? "end of file" : hex(t)}`);
        }
        if (op === 15) {
          jumps++;
          const t = ev.toOffset(u32(raw, off + 4));
          if (t === null || !seen.has(t)) gotos.push(`${where} cmd ${k}`);
        }
      });
    }
  });
  count(c, blocks, HUMANOID_BLOCKS, "class-0x25 command blocks");
  c.ok(!lostEntry.length, "every block's first command is in its own list"
       + (lostEntry.length ? `; not ${lostEntry.slice(0, 4).join(", ")}` : ""));
  count(c, notFirst, HUMANOID_ENTRY_NOT_FIRST,
        "programs that start after the first command listed");
  c.ok(!badOp.length, `every one of their ${cmds} commands is op 0..18 or -1`
       + (badOp.length ? `; ${badOp.slice(0, 4).join(", ")}` : ""));
  c.ok(!holes.length, "every command but 15, 18 and -1 falls through to the next one emitted"
       + (holes.length ? `; not ${holes.slice(0, 4).join(", ")}` : ""));
  c.ok(tests > 0 && !skips.length, `all ${tests} op 10 tests skip to a command`
       + (skips.length ? `; not ${skips.slice(0, 4).join(", ")}` : ""));
  c.ok(!gotos.length, `all ${jumps} op 15 jumps land on a command`
       + (gotos.length ? `; not ${gotos.slice(0, 4).join(", ")}` : ""));
}

function class20(c: Checker, evts: evt.EvtFile[]): void {
  const recs = evts.flatMap((ev) => evt.spawns(ev).filter((r) => r.cls === 0x20));
  count(c, recs.length, CLASS20[0], "class-0x20 spawns");
  c.eq(recs.filter((r) => r.param(0, "i8") !== CLASS20[1]).length, 0,
       "class-0x20 spawns of a character type other than 7");
  c.eq(recs.filter((r) => !((r.param(6, "i16") ?? 0) > 0)).length, CLASS20[2],
       "class-0x20 spawns that name no motion");
}

/** Every clip class `cls` can put on *rec*. */
function clipsFor(ev: evt.EvtFile, rec: evt.Spawn): number[] {
  if (rec.cls === 0x25) return humanoidMotionIds(ev, rec);
  const authored = rec.param(0x06, "i16") ?? 0;
  return [...CLASS20_IDLE_MOTIONS, CLASS20_DEATH_MOTION, ...(authored > 0 ? [authored] : [])];
}

interface Manifest { stages: { stage: number; name: string; script: string }[] }
interface Chars {
  types: Record<string, { name?: string; motions: Record<string, { frames: number }> }>;
  placements: { at: number }[];
}

async function bakedClips(c: Checker, source: AssetSource): Promise<void> {
  const bd = bundleDir();
  if (!bd) {
    c.note("no bundle: the clips the exporter baked are unchecked");
    return;
  }
  const manifest = JSON.parse(readFileSync(join(bd, "manifest.json"), "utf8")) as Manifest;
  let stages = 0;
  for (const entry of manifest.stages) {
    const path = join(bd, entry.name, entry.script);
    if (!c.ok(existsSync(path), `${entry.name}: the manifest's script is there`)) continue;
    stages++;
    const chars = (JSON.parse(readFileSync(path, "utf8")) as { characters: Chars }).characters;
    const placed = new Set(chars.placements.map((p) => p.at));
    const ev = await (await Stage.create(source, { stage: entry.stage,
                                                   original: entry.name.endsWith("_original") })).evt();
    if (!c.ok(ev !== null, `${entry.name}: its evt reads`) || !ev) continue;
    let pairs = 0;
    const missing: string[] = [];
    for (const rec of evt.spawns(ev)) {
      if ((rec.cls !== 0x20 && rec.cls !== 0x25) || !placed.has(rec.offset)) continue;
      const ct = rec.param(0, "i8") ?? -1;
      const type = chars.types[String(ct)];
      for (const m of new Set(clipsFor(ev, rec))) {
        pairs++;
        if (!((type?.motions[String(m)]?.frames ?? 0) > 0)) {
          missing.push(`${hex(rec.offset)} class ${hex(rec.cls, 2)} type ${ct}: motion ${m}`);
        }
      }
    }
    c.ok(pairs > 0 && !missing.length,
         `${entry.name}: ${pairs - missing.length} of ${pairs} (spawn, clip) pairs baked with frames`
         + (missing.length ? `; not ${missing.slice(0, 5).join("; ")}` : ""));
  }
  c.ok(stages > 0, `${stages} stage bundles read`);
}

async function main(): Promise<void> {
  const dir = gameDirOrSkip("script_corpus");
  const { source, exe } = await openGame(dir);
  const c = new Checker("script_corpus");

  const evts: evt.EvtFile[] = [];
  for (let n = 1; n <= 6; n++) {
    const ev = await (await Stage.create(source, { stage: n })).evt();
    if (c.ok(ev !== null, `stage ${n} has an evt`) && ev) evts.push(ev);
  }

  civilianStreams(c, exe);
  await captorScripts(c, source, exe, evts);
  humanoidFlow(c, evts);
  class20(c, evts);
  await bakedClips(c, source);

  c.finish();
}

await main();
