/**
 * The handover from one stage to the next: where a scene ends, and where the
 * ending it reached opens the scene after it.
 *
 *     node tools/run_ts.mjs tools/checks/scene_exits.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * **A terminal route record's `next[0]` is the next scene's starting block.**
 * `EvtAdvanceStepOrRoute` (`FUN_0045F000`) ends a scene by walking onto a hole
 * and then reads, at `0x0045F0DA`,
 *
 * ```c
 * g_evt_block_index = *(s16 *)(g_scene_routes[scene] + g_evt_block_index * 8 - 6);
 * ```
 *
 * `block * 8 - 6` is route record `block - 1` at `+0x02`, which is `next[0]`
 * of the record the walk just left. Nothing between there and `FUN_0045EBC0`
 * writes the block index again -- not `AdvanceToNextScene`, not
 * `LoadSceneAndReset`, not `ResetSceneOnEnter` -- so that value is what the
 * next scene opens on.
 *
 * That reading makes four claims the shipped data can refute, and this is the
 * only check that looks at any of them:
 *
 * 1. **A hole follows every reachable terminal record.** A `kind == 2` record
 *    does not end a scene by itself -- it does `block + 1` and the scene ends
 *    because the block it lands on does not exist. A terminal record followed
 *    by a live block would mean the reading is wrong and the scene would keep
 *    running.
 * 2. **The `-6` read lands on a real record**, which is the same thing as
 *    saying no reachable terminal record sits at block 0.
 * 3. **Every handover names a live block of the next scene** -- one the evt
 *    file supplies and the route table does not hole. A stage cannot open on
 *    nothing.
 * 4. **`ExeTables.sceneEntryBlocks` and `ExeTables.sceneExits`** -- what the
 *    exporter writes as `entries` and `exits` -- agree with a walk done here
 *    from the route tables alone, for both game modes.
 *
 * Claim 3 is the one with teeth. Read `next[1]` instead of `next[0]` and stage
 * 2's block 37 hands stage 3 a `-1`; read the record after the hole rather
 * than the one before it and every stage hands over a `-1` as well. Take slot
 * 2 out of the reachable walk and nothing changes, which is itself worth
 * recording: **Arcade and Original Mode reach the same set of endings in all
 * six stages**, so the two entries stage 3 and stage 4 each have are open to
 * both modes.
 */
import { Checker, gameDirOrSkip, openGame } from "../lib/exe_check";
import { ExeTables } from "../../src/hod2lib/exetab";
import { Stage } from "../../src/hod2lib/stage";

const STAGES = [1, 2, 3, 4, 5, 6];

/**
 * What the shipped tables say, by scene. A change here is a change in the
 * reading, and the two stages with a choice are the whole point of the file.
 */
const EXPECTED_ENTRIES: Record<number, number[]> = {
  0: [0], 1: [0], 2: [0, 7], 3: [0, 4], 4: [0], 5: [0],
};
const EXPECTED_EXITS: Record<number, [number, number][]> = {
  0: [[14, 0]],
  1: [[35, 0], [37, 7]],
  2: [[11, 0], [13, 4]],
  3: [[23, 0], [25, 0]],
  4: [[7, 0]],
  5: [[12, 0]],
};

type Route = [number, number, number, number];

/** Reachable terminal records, following only the branch slots in `slots`. */
function walk(routes: readonly Route[], entries: readonly number[],
              slots: readonly number[]): [number, number][] {
  const seen = new Set<number>();
  const stack = [...entries];
  const ends = new Map<number, number>();
  while (stack.length) {
    const b = stack.pop()!;
    if (seen.has(b) || b < 0 || b >= routes.length) continue;
    seen.add(b);
    const [kind, ...next] = routes[b]!;
    if (kind === ExeTables.ROUTE_GOTO) {
      stack.push(next[0]!);
    } else if (kind === ExeTables.ROUTE_BRANCH) {
      for (const i of slots) if (i < 3 && next[i]! >= 0) stack.push(next[i]!);
    } else if (kind === ExeTables.ROUTE_END) {
      ends.set(b, next[0]!);
    }
  }
  return [...ends.entries()].sort((a, b) => a[0] - b[0]);
}

const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);
const show = (v: unknown): string => JSON.stringify(v);

const c = new Checker("scene_exits");
const { source, exe } = await openGame(gameDirOrSkip("scene_exits"));

const stages = new Map<number, Stage>();
for (const n of STAGES) stages.set(n, await Stage.create(source, { stage: n }));

// Live blocks per scene, from the evt file the scene ships. The route table
// says how many records there are; the file says which of them are holes, and
// a handover has to name one that is not.
const live = new Map<number, Set<number>>();
for (const st of stages.values()) {
  const routes = st.routes;
  const evtf = await st.evt();
  live.set(st.scene, new Set(
    (evtf?.blocks ?? [])
      .filter((b) => b.programs.length > 0 && routes[b.index]![0] !== -1)
      .map((b) => b.index)));
}

for (const [stage, st] of stages) {
  const scene = st.scene;
  const routes = st.routes;
  const entries = exe.sceneEntryBlocks(scene);
  const ends = walk(routes, entries, [0, 1, 2]);
  const arcade = walk(routes, entries, [0, 1]);

  // 4: ExeTables, and a walk done here from the tables alone.
  c.ok(same(entries, EXPECTED_ENTRIES[scene]),
       `stage ${stage}: entered at ${show(entries)}`
       + (same(entries, EXPECTED_ENTRIES[scene]) ? ""
         : `, expected ${show(EXPECTED_ENTRIES[scene])}`));
  c.ok(same(ends, EXPECTED_EXITS[scene]),
       `stage ${stage}: exits ${show(ends)}`
       + (same(ends, EXPECTED_EXITS[scene]) ? ""
         : `, expected ${show(EXPECTED_EXITS[scene])}`));
  c.ok(same(exe.sceneExits(scene), ends),
       `stage ${stage}: ExeTables.sceneExits agrees with this file's walk`
       + (same(exe.sceneExits(scene), ends) ? ""
         : ` -- it says ${show(exe.sceneExits(scene))}`));
  // The recorded fact, not an accident: both modes end the same way.
  c.ok(same(arcade, ends),
       `stage ${stage}: Arcade (slots 0, 1) and Original (slots 0, 1, 2) `
       + `reach the same endings`
       + (same(arcade, ends) ? ""
         : ` -- Arcade ${show(arcade)}, Original ${show(ends)}`));

  for (const [block, entry] of ends) {
    // 2: the -6 read is `routes[block]`, reached as `(block+1)*8 - 6`.
    c.ok(block !== 0,
         block !== 0
           ? `stage ${stage} block ${block}: the -6 read at 0x0045F0DA lands on `
             + `a real record`
           : `stage ${stage}: scene ends at block 0, so the -6 read at `
             + `0x0045F0DA would go off the front of the route table`);
    // 1: the hole is what ends the scene.
    const after = block + 1 < routes.length ? routes[block + 1]! : null;
    if (after === null) {
      c.fail(`stage ${stage} block ${block}: the terminal record is the last `
             + "in the table, so `block+1` reads past it");
    } else {
      c.ok(after[0] === -1,
           after[0] === -1
             ? `stage ${stage} block ${block}: record ${block + 1} is a hole, `
               + "which is what ends the scene"
             : `stage ${stage} block ${block}: record ${block + 1} is `
               + `${show(after)}, not a hole -- a kind-2 record ends a scene `
               + "only because `block+1` lands on nothing");
    }
    // 3: the handover names a live block of the next scene.
    const nextScene = scene + 1;
    if (nextScene > ExeTables.LAST_STAGE_SCENE) continue;  // training follows
    const opens = live.get(nextScene)?.has(entry) ?? false;
    c.ok(opens,
         `stage ${stage} block ${block} hands stage ${stage + 1} block ${entry}`
         + (opens ? ", a live block of it" : ", which is not a live block of it"));
  }
}

const two = STAGES.filter((s) => EXPECTED_ENTRIES[s - 1]!.length > 1);
c.note(`${two.length} stages have more than one entry (`
       + two.map((s) => `stage ${s} at ${show(EXPECTED_ENTRIES[s - 1])}`)
         .join(", ") + ")");
c.finish();
