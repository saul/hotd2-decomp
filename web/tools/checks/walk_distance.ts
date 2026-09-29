/**
 * The scripted walk-in's distance is a float at descriptor tail `+0x04`, in
 * every spawn that starts in it.
 *
 *     node tools/run_ts.mjs tools/checks/walk_distance.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * `ZombieStateWalkDistance` (`FUN_00457220`, class 0x30 state 15) and
 * `ThrowerStateWalkDistance` (`FUN_0044E2A0`, class 0x31 state 18) latch the
 * float at tail `+0x04` and walk until the 2D distance from where they
 * started reaches it. The reading is worth something only if that word is a
 * distance in every record that starts in the state: a wrong offset, or a
 * state index that means something else for one of the classes, reads as
 * garbage floats rather than as a crash. So every spawn in the six stages'
 * evts (`hod2lib/evt.ts`) whose initial state -- tail `+0x02` -- is one of the
 * two has its tail `+0x04` read, and the strict test is that **every one is
 * an exact integer**: a misread offset does not produce that. The word after
 * it, tail `+0x08`, is the next descriptor's, and is reported as the contrast.
 *
 * What this asserts, and the statement each assertion guards:
 *
 *  * **The states are 15 for class 0x30 and 18 for class 0x31**, in the
 *    exporter's `WALK_DISTANCE_STATES` (`hod2lib/placement.ts`) and in the
 *    port's `ZombieState.WalkDistance` and `ThrowerState.WalkDistance`.
 *    `placement.ts`'s note on the table; `docs/formats/combat.md`'s class
 *    0x31 state table, row 18.
 *  * **Every such spawn's distance is an exact integer, one to two hundred
 *    units.** `placement.ts`'s note ("every one of them an exact integer") and
 *    `game/class30/walk_distance.ts` ("all ... of them exact integers").
 *  * **Class 0x30 has 63 of them, three to forty units**, measured over the
 *    evts with every spawn opcode `evt.SPAWN_OPCODES` reads, the
 *    player-count-gated ones included.
 */
import { gameDirOrSkip, openGame, Checker, hex } from "../lib/exe_check";
import * as evt from "../../src/hod2lib/evt";
import { Stage } from "../../src/hod2lib/stage";
import { WALK_DISTANCE_STATES } from "../../src/hod2lib/placement";
import { ZombieState } from "../../src/game/class30/states";
import { ThrowerState } from "../../src/game/class31/states";

/** Nothing in the shipped data walks less than a pace or further than a room. */
const MIN_WALK = 1;
const MAX_WALK = 200;

/**
 * Class 0x30's walk-ins over the six stages, measured with every spawn
 * opcode read: `[count, shortest, longest]`.
 */
const CLASS30: [number, number, number] = [63, 3, 40];

interface Row { stage: number; cls: number; at: number; d: number | null; next: number | null }

async function main(): Promise<void> {
  const dir = gameDirOrSkip("walk_distance");
  const { source } = await openGame(dir);
  const c = new Checker("walk_distance");

  c.eq(JSON.stringify(WALK_DISTANCE_STATES), JSON.stringify({ 0x30: [15], 0x31: [18] }),
       "WALK_DISTANCE_STATES is class 0x30 state 15 and class 0x31 state 18");
  c.eq(ZombieState.WalkDistance as number, 15, "ZombieState.WalkDistance is 15");
  c.eq(ThrowerState.WalkDistance as number, 18, "ThrowerState.WalkDistance is 18");

  const rows: Row[] = [];
  for (let n = 1; n <= 6; n++) {
    const ev = await (await Stage.create(source, { stage: n })).evt();
    if (!c.ok(ev !== null, `stage ${n} has an evt`) || !ev) continue;
    for (const rec of evt.spawns(ev)) {
      const want = WALK_DISTANCE_STATES[rec.cls] ?? [];
      if (!want.includes(rec.param(2, "i8") ?? -1)) continue;
      rows.push({ stage: n, cls: rec.cls, at: rec.offset,
                  d: rec.param(4, "f32"), next: rec.param(8, "f32") });
    }
  }

  for (const cls of [0x30, 0x31]) {
    const mine = rows.filter((r) => r.cls === cls);
    const where = (r: Row) => `stage ${r.stage} ${hex(r.at)}: ${r.d}`;
    c.ok(mine.length > 0, `class ${hex(cls, 2)}: ${mine.length} spawns start in a walk-distance state`);
    const out = mine.filter((r) => r.d === null || !Number.isFinite(r.d)
                                   || r.d < MIN_WALK || r.d > MAX_WALK);
    c.ok(!out.length, `class ${hex(cls, 2)}: every distance is in [${MIN_WALK}, ${MAX_WALK}]`
         + (out.length ? `; not ${out.slice(0, 6).map(where).join("; ")}` : ""));
    const frac = mine.filter((r) => r.d !== null && Number.isFinite(r.d) && !Number.isInteger(r.d));
    c.ok(!frac.length, `class ${hex(cls, 2)}: every distance is an exact integer`
         + (frac.length ? `; not ${frac.slice(0, 6).map(where).join("; ")}` : ""));
    const vals = [...new Set(mine.map((r) => r.d!))].sort((a, b) => a - b);
    c.note(`class ${hex(cls, 2)} distances: ${vals.join(", ")}`);
  }

  const z = rows.filter((r) => r.cls === 0x30).map((r) => r.d!);
  c.eq(z.length, CLASS30[0], "class 0x30 spawns that start in state 15");
  c.eq(Math.min(...z), CLASS30[1], "class 0x30's shortest walk-in");
  c.eq(Math.max(...z), CLASS30[2], "class 0x30's longest walk-in");

  // Evidence about the *next* record rather than a failure: a neighbour that
  // happens to start with a small float is possible without the reading
  // being wrong.
  const plausible = rows.filter((r) => r.next !== null && Number.isFinite(r.next)
                                       && r.next >= MIN_WALK && r.next <= MAX_WALK);
  c.note(`tail+0x08 -- the next descriptor -- reads as a plausible distance in `
         + `${plausible.length} of ${rows.length}`);

  c.finish();
}

await main();
