/**
 * Which `wait_script_flag` gates each shipped bundle can open, and which it
 * still has to excuse.
 *
 *     cd web && node tools/run_ts.mjs tools/flag_gates.ts
 *     HOTD2_BUNDLE=../extract/player node tools/run_ts.mjs tools/flag_gates.ts
 *
 * `script/waits/flag.ts` declares a standing `[diverges]`: a gate on a flag
 * nothing this port runs can raise passes instead of parking the stage for
 * ever. The set it passes on is *derived*, so the only way to know how big the
 * divergence is — and whether it has quietly grown — is to run the derivation
 * over the twelve real bundles. That is this.
 *
 * It exits non-zero on the one thing that would make the derivation a lie
 * rather than merely incomplete: a stage claiming it can raise a flag when
 * nothing it places actually can. The case that matters today is class 0x41,
 * because `raisesScriptFlag` used to be a number per *class* and 441 of the six
 * stages' spawns are class 0x41 — so a class-wide answer would put flag 20 in
 * every stage's set, and stage 4's gate would be right by accident while the
 * rest were wrong on purpose. Stage 5 places 44 class-0x41 props and **none**
 * of them is the type-75 object, so stage 5 is the control: flag 20 must not
 * appear in its set.
 *
 * ## The route pass
 *
 * The derived set is per **bundle**, and a bundle is not a route. Stage 3's
 * `wait_script_flag 0x15` in block 2 is "held" by that set because block 1
 * step 5 sets the flag — and block 1 is only on the entry-0 route, while the
 * entry-7 route reaches the same block 2 through blocks 7 and 8 with the flag
 * never set. So a second pass walks `entries` -> `route.next` and names every
 * gate that no `set_script_flag` **on the route to it** can open. Those are
 * the gates an actor holds, which is what makes them interesting: each one is
 * a routine the port has to run for the stage to advance.
 *
 * That is printed as a work-list for all twelve bundles and asserted for the
 * one this pass was written for. The other half of that assertion lives in
 * `web/test/port.test.ts`: this says the shipped data puts the switch on the
 * route, and that says the port's switch raises the flag when it is there.
 *
 * `[port-only]`. The engine needs none of this; every writer of
 * `g_script_flags` is code it is running.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { ScriptJson } from "../src/bundle";
import { SetGameTables } from "../src/game/tables";
import { ScriptFlagsThisBundleCanRaise } from "../src/script/waits/flag";
import { PROP75_SCRIPT_FLAG } from "../src/game/class41";
import { STORY_SWITCH_SCRIPT_FLAG } from "../src/game/class41/branch";
import "../src/game/classes";

/** The stage whose class-0x41 spawns include the one type-75 placement. */
const STAGE_WITH_TYPE_75 = "stage4";
/** A stage with plenty of class-0x41 spawns and no type-75 among them. */
const STAGE_WITHOUT_TYPE_75 = "stage5";
/**
 * The stage with the flag-21 gate, and the block it is in.
 *
 * Stage 3 has two entry blocks, 0 and 7, and its block 2 is on both routes.
 * Only the entry-0 route passes through block 1, which is the only
 * `set_script_flag 0x15` in the stage.
 */
const STAGE_WITH_FLAG_21_GATE = "stage3";
const FLAG_21_GATE_BLOCK = 2;

// `cd web && node tools/run_ts.mjs tools/flag_gates.ts` is the documented
// invocation and the one `verify_all.py` makes, and there a bare
// `extract/player` is `web/extract/player` with nothing in it. `import.meta`
// cannot help: `run_ts.mjs` bundles this file into a temp directory, so the
// module's own URL is not in the repo at all. So: try both, cwd first.
const root = resolve(process.env.HOTD2_BUNDLE
  ?? (existsSync(resolve("extract/player"))
      ? "extract/player" : "../extract/player"));
// **The missing directory is a skip, not a failure** — `L14`. A fresh
// worktree has no `extract/` at all, so `readdirSync` throws ENOENT and an
// uncaught throw is exit 1, which reads as "this check found something wrong"
// when it asserted nothing. `verify_all.py` counts a 3 separately and names
// it; that is the whole point of the code.
const names = existsSync(root)
  ? readdirSync(root).filter((n) => n.startsWith("stage")).sort() : [];
if (names.length === 0) {
  console.error(`no bundles under ${root} -- run \`npm run export\``);
  process.exit(3);
}

let failed = 0;
const raisesFlag20 = new Map<string, boolean>();

/**
 * One `wait_script_flag` gate no `set_script_flag` on the route to it can
 * open — so it is held by an **actor** and nothing else.
 *
 * The derived set in `ScriptFlagsThisBundleCanRaise` is per *bundle*, and a
 * bundle is not a route. Stage 3's flag-21 gate is the whole reason this
 * second pass exists: `set_script_flag 0x15` is in block 1 step 5, block 1 is
 * only on the entry-0 route, and the entry-7 route reaches the gate through
 * blocks 7 and 8 with the flag never set. The bundle-wide set says "held" for
 * both routes and is right about only one of them, which is how a stage came
 * to park on that instruction for 1,110 frames with every check green.
 */
interface ActorHeldGate {
  entry: number;
  block: number;
  flag: number;
}

/**
 * Every block reachable from `entry`, and for each one the flags some
 * `set_script_flag` on a path to it has raised.
 *
 * A flat union rather than a per-path set: a flag raised on *any* path to the
 * block is enough to make the gate route-openable, and the question here is
 * the other one — which gates **no** path can open. Over-approximating the
 * raisers is the safe direction for that.
 */
function flagsRaisedByRouteTo(script: ScriptJson, entry: number):
    Map<number, Set<number>> {
  const byBlock = new Map<number, Set<number>>();
  const setsIn = (b: number): number[] => {
    const out: number[] = [];
    const blk = (script.blocks ?? []).find((q) => q.index === b);
    for (const st of blk?.steps ?? []) {
      for (const op of st.ops ?? []) {
        if (op.op === 0x48 && op.flag !== undefined) out.push(op.flag);
      }
    }
    return out;
  };
  // Breadth-first, and a block is re-queued when the incoming set grows: a
  // stage's routes rejoin (stage 3's blocks 1 and 8 both go to block 2) and
  // the first visit's answer is not the final one.
  const queue: number[] = [entry];
  byBlock.set(entry, new Set());
  while (queue.length) {
    const b = queue.shift() as number;
    const here = new Set(byBlock.get(b));
    for (const f of setsIn(b)) here.add(f);
    const blk = (script.blocks ?? []).find((q) => q.index === b);
    // `end` hands the *next scene* a block, so it is not an edge in this one.
    if (blk?.route?.kind === "end") continue;
    for (const n of blk?.route?.next ?? []) {
      if (n < 0) continue;
      const prev = byBlock.get(n);
      const merged = prev ? new Set([...prev, ...here]) : new Set(here);
      if (!prev || merged.size > prev.size) {
        byBlock.set(n, merged);
        queue.push(n);
      }
    }
  }
  return byBlock;
}

/** Every block reachable from `from`, itself included. */
function blocksReachableFrom(script: ScriptJson, from: number): Set<number> {
  const seen = new Set<number>([from]);
  const queue = [from];
  while (queue.length) {
    // The `shift` is its own statement on purpose: inside a `find` predicate
    // it runs once per element of `blocks`, which walks one edge and then
    // compares `undefined` against the other seventeen.
    const at = queue.shift() as number;
    const blk = (script.blocks ?? []).find((q) => q.index === at);
    if (blk?.route?.kind === "end") continue;
    for (const n of blk?.route?.next ?? []) {
      if (n < 0 || seen.has(n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return seen;
}

/** The gates on `entry`'s routes that no `set_script_flag` on them can open. */
function actorHeldGates(script: ScriptJson, entry: number): ActorHeldGate[] {
  const raised = flagsRaisedByRouteTo(script, entry);
  const out: ActorHeldGate[] = [];
  for (const [block, before] of raised) {
    const blk = (script.blocks ?? []).find((q) => q.index === block);
    // Walked in order so that a `set_script_flag` earlier in the same block
    // counts and a later one does not — which is the difference between
    // stage 3's block 2 opening its own flag-21 gate and not.
    const own = new Set(before);
    for (const st of blk?.steps ?? []) {
      for (const op of st.ops ?? []) {
        if (op.op === 0x48 && op.flag !== undefined) own.add(op.flag);
        if (op.op !== 0x45) continue;
        const flag = op.arg ?? 0;
        if (!own.has(flag)) out.push({ entry, block, flag });
      }
    }
  }
  return out;
}

const actorHeld = new Map<string, ActorHeldGate[]>();
/** Which blocks each bundle spawns a class-0x44 selector-17 switch in. */
const switchBlocks = new Map<string, number[]>();
/** Each bundle's script, kept so the assertions below can walk its routes. */
const reach = new Map<string, ScriptJson>();

for (const name of names) {
  const raw = JSON.parse(
    readFileSync(resolve(root, name, `${name}.script.json`), "utf8"));
  const script = raw as ScriptJson;
  // The same tables the player installs, so class 0x41's per-record answer has
  // the placements to resolve against.
  SetGameTables(raw.characters, raw.breakables, undefined, undefined,
                undefined, raw.civilians);
  const canRaise = ScriptFlagsThisBundleCanRaise(script);
  raisesFlag20.set(name, canRaise.has(PROP75_SCRIPT_FLAG));

  const gates = new Set<number>();
  for (const b of script.blocks ?? []) {
    for (const st of b.steps ?? []) {
      for (const op of st.ops ?? []) {
        if (op.op === 0x45) gates.add(op.arg ?? 0);
      }
    }
  }
  const asc = (a: number, b: number) => a - b;
  const held = [...gates].filter((g) => canRaise.has(g)).sort(asc);
  const excused = [...gates].filter((g) => !canRaise.has(g)).sort(asc);
  console.log(`${name.padEnd(17)} ${gates.size} gates: `
    + `held {${held.join(",")}}  excused {${excused.join(",")}}`);

  // ...and the route pass. `entries` is every block the previous stage can
  // hand this one; stage 3 and stage 4 have two each and every other stage
  // one, so for ten of the twelve bundles this asks the same question twice.
  const entries = script.entries?.length
    ? script.entries : [script.entry_block];
  const held2: ActorHeldGate[] = [];
  for (const e of entries) held2.push(...actorHeldGates(script, e));
  actorHeld.set(name, held2);
  for (const g of held2) {
    console.log(`  ${" ".repeat(15)} entry ${g.entry} -> block ${g.block}: `
      + `wait_script_flag 0x${g.flag.toString(16)} has no `
      + "`set_script_flag` on the route -- an actor holds it");
  }

  // Which blocks place a class-0x44 selector-17 switch. Only `spawn_placed`
  // and `spawn_obj` records carry an address for the placement table to be
  // keyed on; `spawn_simple`'s two-word record has none, and no switch is
  // placed that way.
  const blocksWithSwitch: number[] = [];
  for (const b of script.blocks ?? []) {
    for (const st of b.steps ?? []) {
      for (const op of st.ops ?? []) {
        for (const r of op.spawns ?? []) {
          const pl = raw.breakables?.placements?.find(
            (q: { at: number; container?: string }) => q.at === r.at);
          if (r.class === 0x44 && pl?.container === "story_switch") {
            blocksWithSwitch.push(b.index);
          }
        }
      }
    }
  }
  switchBlocks.set(name, [...new Set(blocksWithSwitch)].sort((a, b) => a - b));
  reach.set(name, script);
}

const check = (what: string, ok: boolean, detail = ""): void => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? ` -- ${detail}` : ""}`);
  if (!ok) failed++;
};

console.log("");
for (const suffix of ["", "_original"]) {
  const yes = STAGE_WITH_TYPE_75 + suffix;
  const no = STAGE_WITHOUT_TYPE_75 + suffix;
  if (raisesFlag20.has(yes)) {
    check(`${yes} can raise flag ${PROP75_SCRIPT_FLAG}: it places the type-75 `
      + "prop", raisesFlag20.get(yes) === true);
  }
  if (raisesFlag20.has(no)) {
    check(`${no} cannot: its class-0x41 spawns are all something else`,
          raisesFlag20.get(no) === false);
  }
}

// The route pass's own assertion. It is about the *shipped data*, not about
// the port: it says that stage 3's block-2 gate really does depend on an
// actor, and that the actor which raises its flag is placed on the same route.
// `web/test/port.test.ts` is the other half — that the port's class-0x44
// selector 17 raises `g_script_flags[0x15]` when it stands there.
for (const suffix of ["", "_original"]) {
  const name = `${STAGE_WITH_FLAG_21_GATE}${suffix}`;
  const gates = actorHeld.get(name);
  if (!gates) continue;
  const g = gates.find((q) => q.flag === STORY_SWITCH_SCRIPT_FLAG
                           && q.block === FLAG_21_GATE_BLOCK);
  check(`${name}'s block ${FLAG_21_GATE_BLOCK} gate on `
    + `0x${STORY_SWITCH_SCRIPT_FLAG.toString(16)} is opened by no `
    + "`set_script_flag` on its route", g !== undefined,
    g ? `entry ${g.entry}` : `${gates.length} actor-held gates`);
  const script = reach.get(name);
  const blocks = switchBlocks.get(name) ?? [];
  // Placed *on that route*, and not merely somewhere in the stage: stage 3
  // has two switches, and the one in blocks 3 and 9 is on the other branch.
  // A switch block counts when the gate's entry can reach it and it can
  // reach the gate's block.
  const onRoute = g && script
    ? blocks.filter((b) => blocksReachableFrom(script, g.entry).has(b)
        && blocksReachableFrom(script, b).has(FLAG_21_GATE_BLOCK))
    : [];
  check("...and the class-0x44 selector-17 switch that raises it is placed "
    + "on that route, before the gate's own block", onRoute.length > 0,
    `on-route blocks {${onRoute.join(",")}} of {${blocks.join(",")}}`);
  // The gate must NOT be actor-held on the other entry, because block 1's
  // `set_script_flag 0x15` opens it there — which is the asymmetry that hid
  // the bug and the thing most likely to change under an exporter edit.
  const other = (actorHeld.get(name) ?? []).filter(
    (q) => q.flag === STORY_SWITCH_SCRIPT_FLAG);
  check("...and only on ONE of the stage's two entries, which is why the "
    + "entry-0 route never showed it", other.length === 1,
    other.map((q) => `entry ${q.entry}`).join(" "));
}

process.exit(failed === 0 ? 0 : 1);
