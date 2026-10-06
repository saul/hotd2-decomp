/**
 * Every branch trigger names a route the block actually has.
 *
 *     node tools/run_ts.mjs tools/checks/branches.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * A branching stage works like this. A route record whose `kind` is 1 sends
 * the script to `next[g_script_branch_var]`, and `g_script_branch_var`
 * (`0x009C88A4`) is written by **gameplay** -- never by the script. So the
 * question "which way does the stage go?" is answered by an actor, and the
 * answer is a small integer that has to be a slot the record actually fills.
 *
 * That gives a check the reading can fail. For every branch block in the six
 * shipped stages, this works out what the actors spawned in it can write, and
 * asserts that every value names a **live** slot of that block's own route
 * record. A route record has three slots and unused ones hold `-1`; getting
 * the civilian operand wrong, the class 0x52 subtype table backwards, or the
 * class 0x53 block gate missing all put a write on a hole, which ends the
 * scene instead of taking a route.
 *
 * The writers attached to a spawned actor:
 *
 * * **class 0x10**, the civilian -- `CivilianRunScript` op 0x19
 *   (`SetRouteBranch`) stores the s16 at `cmd+4`. The spawn's descriptor tail
 *   picks an entry, the entry picks a stream, and streams reach further
 *   streams through the pointer operands of ops 0x0E/0x0F/0x1E/0x1F, so the
 *   whole reachable set is walked.
 * * **class 0x21** -- `FUN_00451980` writes 1 when its last part is shot off,
 *   beside the rescue counters and the +400.
 * * **class 0x52** subtypes 2, 3 and 4 -- `MouseBranchTriggerUpdate` writes
 *   the signed byte at `0x00564442 + subtype`, which is 2, 1, 2.
 * * **class 0x53** subtype >= 2 -- `CatBranchTriggerUpdate` writes 2, and
 *   **only while `g_evt_block_index == 8`**. That gate is load-bearing: stage
 *   2 spawns one of these in blocks 3, 5, 8 and 11, and only block 8's record
 *   has a slot 2 to go to.
 *
 * The **props** are the second half, and they answer the same question. Nine
 * class-0x41 types and one class-0x44 selector write the variable from inside
 * their own update routine, each behind a gate of its own: a block index, a
 * script flag, a scene, or an Original Mode item. Their values have to name a
 * live slot too, and the block they name has to be a block their placement
 * can reach.
 *
 * The third half is the selectors `spawn_simple` places with no actor to
 * speak of: **class 0x64**, `ScoreRouteSelect64`, in stage 6's blocks 3, 5
 * and 9, which writes from the run's score and rescues.
 *
 * Not modelled: `PropUpdateType69`, which does not choose a route but
 * **promotes** one -- it turns an existing 1 into a 2 -- so it has no value of
 * its own to check.
 *
 * **What this check does not discriminate**, said plainly: types 14 and 19
 * write `1 - obj+0x11C` and both shipped spawns carry 0, so writing
 * `obj+0x11C` instead would give 0, which is also a live slot in both their
 * blocks. The subtraction is proved by the disassembly and not by the data.
 * Everything else here is discriminated -- flip the class 0x52 subtype table,
 * drop the cat's block gate, or change `PropUpdateType25`'s 1 to a 2, and a
 * write lands on a hole.
 *
 * What only this check can see: a branch writer whose value, or whose gate,
 * sends a stage onto a route slot its block's record does not fill.
 */
import { Checker, gameDirOrSkip, openGame } from "../lib/exe_check";
import * as evt from "../../src/hod2lib/evt";
import { ExeTables } from "../../src/hod2lib/exetab";
import type { CivCommand } from "../../src/hod2lib/exetab";
import { Stage } from "../../src/hod2lib/stage";

const STAGES = [1, 2, 3, 4, 5, 6];

/**
 * `MouseBranchTriggerUpdate`: the signed bytes at `0x00564442 + subtype`.
 * Subtypes 0 and 1 are the wanderers and write nothing.
 */
const CLASS52_BRANCH: Record<number, number> = { 2: 2, 3: 1, 4: 2 };
/** `CatBranchTriggerUpdate` writes 2, and only in this event block. */
const CLASS53_BLOCK = 8;
const CLASS53_BRANCH = 2;
/** `FUN_00451980` pays the rescue and writes this. */
const CLASS21_BRANCH = 1;

/**
 * What the shipped data holds. A change here is a change in the reading.
 *
 * 14 rather than 16 because two of stage 2's class 0x53 spawns -- blocks 3
 * and 5 -- are excluded by {@link CLASS53_BLOCK}, so nothing is claimed to
 * write in those blocks at all. Drop that gate and this becomes 16 with block
 * 5 failing, which is the check earning its keep: block 5's record is
 * `[21, 6, -1]` and a 2 there would end the scene.
 */
const EXPECT_BLOCKS = 14;
const EXPECT_CIVILIAN_WRITERS = 11;

/**
 * The prop writers, as `type -> [value, blocks, scenes]`.
 *
 * `value` of null means "1 minus the descriptor's +0x11C", which is how types
 * 14 and 19 let the level author name the default route. `blocks` of null
 * means the routine has no block gate and fires wherever its object is
 * standing, so the spawn's own block is used. `scenes` of null means no scene
 * gate.
 */
const PROP_WRITERS: Record<number,
  [number | null, readonly number[] | null, readonly number[] | null]> = {
  0x0e: [null, null, null],        // PropUpdateType14
  0x13: [null, null, null],        // PropUpdateType19
  0x19: [1, [0x17], null],         // PropUpdateType25
  0x38: [2, [9], null],            // PropUpdateType56
  0x46: [2, [4], [2]],             // OriginalItemPropUpdate
  0x47: [2, [4], [2]],             // OriginalItemPropUpdate
  0x49: [2, [7], null],            // PropUpdateType73
  0x4c: [2, [5, 0x0e], null],      // PropUpdateType76
};

/** `PropUpdateType40`: the sub-kind whose pair opens a route, and its value. */
const FRAGMENT_SUBKIND = 9;
const FRAGMENT_BRANCH = 2;
/** `ChainSegmentUpdate`: the chain group, its block, and its value. */
const CHAIN_GROUP = 1;
const CHAIN_BLOCK = 0x16;
const CHAIN_BRANCH = 2;
/** `StoryModeSwitchUpdate`'s scene-and-block table, and the 2 every arm writes. */
const STORY_SWITCH_ROUTES: readonly [number, number][] =
  [[0, 4], [1, 1], [1, 3], [1, 0x0c], [4, 4]];
const STORY_SWITCH_BRANCH = 2;
/** What the shipped data holds for the prop half. */
const EXPECT_PROP_WRITES = 31;

/**
 * `ScoreRouteSelect64` (`FUN_00435FB0`), class 0x64 by `spawn_simple`: every
 * arm writes 0 and then, by its record's `hp`, may write these. It has no
 * block gate -- it decides the block it is spawned in.
 */
const CLASS64_BRANCH: Record<number, readonly number[]> = {
  0: [0, 1, 2], 1: [0, 1, 2], 2: [0, 1],
};
/** Stage 6 blocks 3, 5 and 9: what the shipped data holds. */
const EXPECT_SIMPLE_WRITERS = 3;

type Route = [number, number, number, number];
type Civ = { entries: number[]; scripts: CivCommand[][] };

/**
 * Every value the stream this spawn's tail selects can write.
 *
 * Follows the pointer operands, because a civilian's on-shot and resume
 * streams are part of what she can run.
 */
function civilianWrites(civ: Civ, slot: number): number[] {
  if (!(slot >= 0 && slot < civ.entries.length)) return [];
  const seen = new Set<number>();
  const todo = [civ.entries[slot]!];
  const out: number[] = [];
  while (todo.length) {
    const i = todo.pop()!;
    if (seen.has(i) || !(i >= 0 && i < civ.scripts.length)) continue;
    seen.add(i);
    for (const cmd of civ.scripts[i]!) {
      if (cmd.op === 0x19) out.push(cmd.args[0]!);
      todo.push(...(cmd.scripts ?? []));
    }
  }
  return out;
}

/** Every spawn descriptor reachable from one block's programs. */
function blockSpawns(evtf: evt.EvtFile, blk: evt.Block): evt.Spawn[] {
  const out: evt.Spawn[] = [];
  for (const prog of blk.programs) {
    for (const ins of prog) {
      if (!evt.SPAWN_OPCODES.includes(ins.opcode)) continue;
      for (const word of ins.raw) {
        const off = evtf.toOffset(word);
        if (off === null || !(off >= 0 && off <= evtf.raw.length - evt.SPAWN_HEADER)) {
          continue;
        }
        out.push(evt.readSpawn(evtf, off, ins.opcode));
      }
    }
  }
  return out;
}

/** Every `{class, hp}` record a `spawn_simple` in this block names. */
function blockSimpleSpawns(evtf: evt.EvtFile, blk: evt.Block):
    evt.SimpleSpawn[] {
  const out: evt.SimpleSpawn[] = [];
  for (const prog of blk.programs) {
    for (const ins of prog) {
      if (!evt.SIMPLE_SPAWN_OPCODES.includes(ins.opcode)) continue;
      for (const word of ins.raw) {
        if (word === 0xffffffff) break;
        const rec = evt.readSimpleSpawn(evtf, word);
        if (rec) out.push(rec);
      }
    }
  }
  return out;
}

const liveSlots = (rec: Route): number[] =>
  [0, 1, 2].filter((i) => rec[1 + i]! >= 0);
const next = (rec: Route): string => JSON.stringify(rec.slice(1));
const i8 = (b: Uint8Array, off: number): number => (b[off]! << 24) >> 24;

const c = new Checker("branches");
const { source, exe } = await openGame(gameDirOrSkip("branches"));
const civ = exe.civilianScripts();

const stages: [number, Stage, evt.EvtFile][] = [];
for (const n of STAGES) {
  const st = await Stage.create(source, { stage: n });
  const evtf = await st.evt();
  if (evtf === null) {
    c.fail(`stage ${n}: no evt file, so nothing here can be asserted of it`);
    continue;
  }
  stages.push([n, st, evtf]);
}

// -- the civilian streams ------------------------------------------------
const withOp19 = civ.scripts.filter((s) => s.some((cmd) => cmd.op === 0x19));
c.eq(withOp19.length, EXPECT_CIVILIAN_WRITERS,
     `${withOp19.length} of ${civ.scripts.length} civilian streams run op 0x19 `
     + "(SetRouteBranch)");
const values = [...new Set(civ.scripts.flatMap(
  (s) => s.filter((cmd) => cmd.op === 0x19).map((cmd) => cmd.args[0])))]
  .sort((a, b) => (a ?? 0) - (b ?? 0));
c.ok(values.length === 1 && values[0] === 1,
     values.length === 1 && values[0] === 1
       ? "and every one of them passes 1"
       : `the reading has a civilian only ever ask for route 1, and they pass `
         + JSON.stringify(values));

// -- the actors spawned in a branch block --------------------------------
let checked = 0;
for (const [stage, st, evtf] of stages) {
  const routes = st.routes;
  for (const blk of evtf.blocks) {
    if (blk.offset < 0 || routes[blk.index]![0] !== ExeTables.ROUTE_BRANCH) {
      continue;
    }
    const rec = routes[blk.index]!;
    const live = liveSlots(rec);
    const writes = new Map<number, string>();
    for (const sp of blockSpawns(evtf, blk)) {
      if (sp.cls === 0x10) {
        const slot = sp.param(1, "i8");
        if (slot === null) {
          c.fail(`stage ${stage} block ${blk.index}: a class 0x10 spawn at `
                 + `0x${sp.offset.toString(16)} carries no parameter tail, so `
                 + "its script entry cannot be read");
          continue;
        }
        for (const v of civilianWrites(civ, slot)) {
          writes.set(v, "civilian op 0x19");
        }
      } else if (sp.cls === 0x21) {
        writes.set(CLASS21_BRANCH, "class 0x21 rescue");
      } else if (sp.cls === 0x52) {
        const sub = sp.param(0, "i16");
        if (sub !== null && sub in CLASS52_BRANCH) {
          writes.set(CLASS52_BRANCH[sub]!, `class 0x52 sub ${sub}`);
        }
      } else if (sp.cls === 0x53 && blk.index === CLASS53_BLOCK) {
        writes.set(CLASS53_BRANCH, "class 0x53");
      }
    }
    if (!writes.size) continue;
    checked++;
    const order = [...writes.keys()].sort((a, b) => a - b);
    const names = order.map((v) => `${v}=${writes.get(v)}`).join(", ");
    const holes = order.filter((v) => !live.includes(v));
    c.ok(holes.length === 0,
         `stage ${stage} block ${blk.index}: next=${next(rec)}, ${names}`
         + (holes.length ? ` -- ${JSON.stringify(holes)} name no route` : ""));
  }
}
c.eq(checked, EXPECT_BLOCKS,
     `${checked} branch blocks have a trigger spawned in them (a trigger class `
     + "or a route record has moved if this changes)");

// -- the props, which write from inside their own routines ---------------
//
// A write into a block that is not a branch at all is skipped rather than
// failed: the variable is cleared at the next step boundary and nothing ever
// reads it, which is what most of the 28 `PropUpdateType40` placements are
// doing.
let propChecked = 0;
for (const [stage, st, evtf] of stages) {
  const routes = st.routes;
  const raw = evtf.raw;
  const scene = st.scene;
  for (const blk of evtf.blocks) {
    if (blk.offset < 0) continue;
    for (const sp of blockSpawns(evtf, blk)) {
      const writes: [number, number, string][] = [];
      if (sp.cls === 0x41) {
        const ctor = i8(raw, sp.offset + 0x25);
        const word = i8(raw, sp.offset + 0x24);
        const writer = PROP_WRITERS[ctor];
        if (writer) {
          const [value, blocks, scenes] = writer;
          if (scenes !== null && !scenes.includes(scene)) continue;
          const v = value ?? 1 - sp.hp;
          for (const b of blocks ?? [blk.index]) {
            writes.push([b, v, `class41 type 0x${ctor.toString(16).padStart(2, "0")}`]);
          }
        } else if (ctor === 40 && word === FRAGMENT_SUBKIND) {
          writes.push([blk.index, FRAGMENT_BRANCH, "PropUpdateType40 sub-kind 9"]);
        } else if (ctor === 24 && word === CHAIN_GROUP) {
          writes.push([CHAIN_BLOCK, CHAIN_BRANCH, "ChainSegmentUpdate group 1"]);
        }
      } else if (sp.cls === 0x44 && sp.hp === 17) {
        for (const [s, b] of STORY_SWITCH_ROUTES) {
          if (s === scene) {
            writes.push([b, STORY_SWITCH_BRANCH, "StoryModeSwitchUpdate"]);
          }
        }
      }
      for (const [block, value, who] of writes) {
        if (!(block >= 0 && block < routes.length)) continue;
        const rec = routes[block]!;
        if (rec[0] !== ExeTables.ROUTE_BRANCH) continue;  // nothing reads it
        propChecked++;
        const ok = liveSlots(rec).includes(value);
        c.ok(ok, ok
          ? `stage ${stage} block ${block}: next=${next(rec)}, ${value}=${who}`
          : `stage ${stage} block ${block}: next=${next(rec)} but ${who} `
            + `writes ${value}, which names no route`);
      }
    }
  }
}
c.eq(propChecked, EXPECT_PROP_WRITES,
     `${propChecked} prop writes land in a branch block (a gate or a route `
     + "record has moved if this changes)");

// -- the selectors `spawn_simple` places ---------------------------------
let simpleChecked = 0;
for (const [stage, st, evtf] of stages) {
  const routes = st.routes;
  for (const blk of evtf.blocks) {
    if (blk.offset < 0) continue;
    for (const rec of blockSimpleSpawns(evtf, blk)) {
      if (rec.cls !== 0x64) continue;
      const values = CLASS64_BRANCH[rec.hp];
      const route = routes[blk.index]!;
      if (!values || route[0] !== ExeTables.ROUTE_BRANCH) {
        c.fail(`stage ${stage} block ${blk.index}: class 0x64 selector `
               + `${rec.hp} in a block whose route reads no branch`);
        continue;
      }
      simpleChecked++;
      const holes = values.filter((v) => !liveSlots(route).includes(v));
      c.ok(holes.length === 0,
           `stage ${stage} block ${blk.index}: next=${next(route)}, `
           + `${values.join("/")}=ScoreRouteSelect64 ${rec.hp}`
           + (holes.length ? ` -- ${JSON.stringify(holes)} name no route` : ""));
    }
  }
}
c.eq(simpleChecked, EXPECT_SIMPLE_WRITERS,
     `${simpleChecked} class-0x64 selectors decide a branch block`);
c.finish();
