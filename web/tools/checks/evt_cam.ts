/**
 * The event scripts' queued actions against the tables that dispatch them:
 * which path a camera play names, and which state a transition enters.
 *
 *     node tools/run_ts.mjs tools/checks/evt_cam.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * `EvtRunQueuedActions` (`0x00402320`) dispatches an opcode-`0x30` action
 * through a two-level table, `handler = table[sel >> 4][sel & 0xF]`, and two of
 * its ten handlers carry an index into something else: selector `0x40` names a
 * **global** `cam/` path slot, and selectors `0x11` and `0x21` call
 * `EvtEnterSceneState(major, minor)` (`0x00403BD0`), which jumps into a 6 x 9
 * table whose unused cells are `SceneStateInvalidHang` (`0x00402710`),
 * `while(1);`. Each of those is a place a misread operand collapses, and this
 * reads the tables out of `Hod2.exe` and every operand out of the scripts
 * through `src/hod2lib/evt.ts`:
 *
 * 1. **The action table has ten handlers.** The index at `0x005776EC` has
 *    seven slots; the four live ones point at sub-tables laid out immediately
 *    before it, and their lengths give selectors `0x10`..`0x15`, `0x20`,
 *    `0x21`, `0x40` and `0x60` -- exactly `evt.QUEUE_ACTIONS`.
 * 2. **Stages 1-6 use nine of them, as many times as `formats/evt.md` says**:
 *    `0x10` x3, `0x11` x4, `0x12` x2, `0x14` x2, `0x15` x6, `0x20` x1,
 *    `0x21` x418, `0x40` x751, `0x60` x13, and never `0x13`.
 * 3. **751 of 751 camera plays in stages 1-6 name a path of their own stage's
 *    `cp_` file**, by the slot range the exe's cam tables give that file. A
 *    wrong operand order scatters them over all 418 slots.
 * 4. **The live cells of the state table** are, row by row, `{0}`,
 *    `{1,2,3}`, `{4,5,6,7}`, none, `{0..5, 8}` and `{0,3,4,6,7,8}` -- read
 *    from the 54 dwords at `0x00576C14`, a cell being live when it is neither
 *    the hang loop nor null.
 * 5. **Every transition in the game lands on a live cell**: selector `0x21`'s
 *    444 operands are only 4, 6 and 7, all live in row 2, which is the row it
 *    always passes; selector `0x11`'s are 1 and 3, live in row 1.
 * 6. **The deferred-play idiom holds without exception**: flags are only 0
 *    (677 plays) or 2 (208), and all 208 plays with bit 1 set are followed
 *    within three queued actions by a `0x21` into state 6 or 7 -- the two
 *    camera states that play the stashed range.
 *
 * Claims 2 and 3 are over stages 1-6 and claims 5 and 6 over every scene file,
 * because that is how `formats/evt.md` states them.
 *
 * Exit 0 when everything held, 1 when anything did not, 3 with no game
 * directory.
 */
import { Checker, gameDirOrSkip, hex, openGame } from "../lib/exe_check";
import * as evt from "../../src/hod2lib/evt";
import { ExeTables } from "../../src/hod2lib/exetab";

/** `g_evt_action_table`: seven group pointers, `sel >> 4`. */
const ACTION_TABLE = 0x005776ec;
const ACTION_GROUPS = 7;

/** `g_scene_state_table`, `[major * 9 + minor]`. */
const STATE_TABLE = 0x00576c14;
const STATE_ROWS = 6;
const STATE_COLS = 9;
const STATE_HANG = 0x00402710;          // SceneStateInvalidHang

/** `formats/evt.md`'s table of live cells, by major. */
const LIVE: number[][] = [
  [0], [1, 2, 3], [4, 5, 6, 7], [], [0, 1, 2, 3, 4, 5, 8], [0, 3, 4, 6, 7, 8],
];

/** `formats/evt.md`: the selector histogram over stages 1-6. */
const STAGE_SELECTORS: Record<number, number> = {
  0x10: 3, 0x11: 4, 0x12: 2, 0x14: 2, 0x15: 6, 0x20: 1, 0x21: 418, 0x40: 751,
  0x60: 13,
};

const SEL_SCENE_STATE = 0x11;
const SEL_FINISH = 0x21;
const SEL_CAM_PLAY = 0x40;
/** `EvtActionFinishSequence21` always passes this major. */
const FINISH_MAJOR = 2;
/** The camera states that play a stashed range. */
const STASH_STATES = [6, 7];
const DEFER = 2;

/** `1,234` rather than the checker's hex. */
function stated(c: Checker, got: number, want: number, what: string,
                doc = "formats/evt.md"): boolean {
  return c.ok(got === want, got === want ? `${what}: ${got}`
    : `${what}: ${got}, where ${doc} states ${want}`);
}

function hist(m: Map<number, number>): string {
  return [...m].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${hex(k, 2)} x${v}`).join(", ");
}

async function main(): Promise<void> {
  const dir = gameDirOrSkip("evt_cam");
  const { source, exe } = await openGame(dir);
  const c = new Checker("evt_cam");

  // -- 1. the action table ----------------------------------------------------
  console.log("\nthe queued-action table");
  const groups: [number, number][] = [];
  for (let g = 0; g < ACTION_GROUPS; g++) {
    const p = exe.ru32(ACTION_TABLE + g * 4) ?? 0;
    if (p) groups.push([g, p]);
  }
  // Each group's handlers run up to the next group's start, and the last
  // group's to the index table itself.
  const byStart = [...groups].sort((a, b) => a[1] - b[1]);
  const handlers: number[] = [];
  byStart.forEach(([g, start], i) => {
    const end = i + 1 < byStart.length ? byStart[i + 1]![1] : ACTION_TABLE;
    for (let k = 0; k < (end - start) / 4; k++) handlers.push(g * 16 + k);
  });
  handlers.sort((a, b) => a - b);
  const named = Object.keys(evt.QUEUE_ACTIONS).map(Number).sort((a, b) => a - b);
  c.ok(groups.length === 4 && handlers.join() === named.join(),
       `${groups.length} live groups of ${ACTION_GROUPS} give ${handlers.length} selectors, `
       + `${handlers.map((x) => hex(x, 2)).join(" ")}`
       + (handlers.join() === named.join() ? ", exactly evt.QUEUE_ACTIONS"
         : `; evt.QUEUE_ACTIONS names ${named.map((x) => hex(x, 2)).join(" ")}`));

  // -- 4. the state table ------------------------------------------------------
  console.log("\nthe scene state table");
  const live: Set<number>[] = [];
  for (let major = 0; major < STATE_ROWS; major++) {
    const row = new Set<number>();
    for (let minor = 0; minor < STATE_COLS; minor++) {
      const cell = exe.ru32(STATE_TABLE + (major * STATE_COLS + minor) * 4) ?? 0;
      if (cell !== 0 && cell !== STATE_HANG) row.add(minor);
    }
    live.push(row);
    const got = [...row].join(",");
    c.ok(got === LIVE[major]!.join(","),
         `row ${major} is live at {${got}}`
         + (got === LIVE[major]!.join(",") ? "" : `; formats/evt.md states {${LIVE[major]!.join(",")}}`));
  }

  // -- the scripts ---------------------------------------------------------------
  const cps = exe.camPathSlots();
  const stageSel = new Map<number, number>();
  const flags = new Map<number, number>();
  let plays = 0, own = 0, deferred = 0, followed = 0, finishes = 0;
  const finishMinors = new Map<number, number>();
  const stateMinors = new Map<number, number>();
  const stray: string[] = [];
  const unfollowed: string[] = [];
  const hang: string[] = [];
  for (let scene = 0; scene < ExeTables.SCENE_COUNT; scene++) {
    const name = exe.sceneEvtFile(scene);
    if (!name || !(await source.exists(`evt/${name}`))) continue;
    const stage = scene <= 5;
    const stem = `cp_st${scene + 1}.bin`;
    const f = evt.parse(await source.read(`evt/${name}`), name, exe.sceneBlockCount(scene));
    for (const b of f.blocks) {
      if (b.offset < 0) continue;
      for (const prog of b.programs) {
        const queued = prog.filter((ins) => ins.opcode === 0x30 && ins.raw.length);
        queued.forEach((ins, k) => {
          const sel = ins.raw[0]!;
          const where = `${name} ${hex(ins.offset)}`;
          if (stage) stageSel.set(sel, (stageSel.get(sel) ?? 0) + 1);
          if (sel === SEL_FINISH && ins.raw.length > 1) {
            const minor = ins.raw[1]!;
            finishes++;
            finishMinors.set(minor, (finishMinors.get(minor) ?? 0) + 1);
            if (!live[FINISH_MAJOR]!.has(minor)) hang.push(`${where}: (2, ${minor})`);
          }
          if (sel === SEL_SCENE_STATE && ins.raw.length > 1) {
            const minor = ins.raw[1]!;
            stateMinors.set(minor, (stateMinors.get(minor) ?? 0) + 1);
            if (!live[1]!.has(minor)) hang.push(`${where}: (1, ${minor})`);
          }
          if (sel !== SEL_CAM_PLAY || ins.raw.length < 5) return;
          const [, , path, fl] = ins.raw.slice(1) as [number, number, number, number];
          flags.set(fl, (flags.get(fl) ?? 0) + 1);
          if (fl & DEFER) {
            deferred++;
            const next = queued.slice(k + 1, k + 4)
              .filter((j) => j.raw[0] === SEL_FINISH && j.raw.length > 1)
              .map((j) => j.raw[1]!);
            if (next.some((m) => STASH_STATES.includes(m))) followed++;
            else unfollowed.push(where);
          }
          if (!stage) return;
          plays++;
          const rec = cps.get(path);
          if (rec && rec[0] === stem) own++;
          else stray.push(`${where}: slot ${path} is ${rec ? rec[0] : "no file's"}, not ${stem}'s`);
        });
      }
    }
  }

  // -- 2. and 3. stages 1-6 ------------------------------------------------------
  console.log("\nstages 1-6");
  const want = new Map(Object.entries(STAGE_SELECTORS).map(([k, v]) => [Number(k), v]));
  c.ok(hist(stageSel) === hist(want),
       `selectors used: ${hist(stageSel)}`
       + (hist(stageSel) === hist(want) ? "" : `; formats/evt.md states ${hist(want)}`));
  const unhandled = [...stageSel.keys()].filter((s) => !handlers.includes(s));
  c.ok(unhandled.length === 0,
       `every selector used has a handler in the table`
       + (unhandled.length ? `; not ${unhandled.map((x) => hex(x, 2)).join(", ")}` : ""));
  stated(c, plays, 751, "camera plays (selector 0x40)", "formats/evt.md and formats/cam.md");
  stated(c, own, 751, "...naming a slot of their own stage's cp_ file",
         "formats/evt.md and formats/cam.md");
  c.ok(stray.length === 0, stray.length ? `strays: ${stray.slice(0, 6).join("; ")}`
    : "no camera play names another file's path");

  // -- 5. and 6. every scene file ------------------------------------------------
  console.log("\nevery scene file");
  stated(c, finishes, 444, "selector 0x21 operands");
  c.ok([...finishMinors.keys()].sort().join() === "4,6,7",
       `...entering states ${[...finishMinors.keys()].sort().join(", ")} of row 2`);
  c.ok([...stateMinors.keys()].sort().join() === "1,3",
       `selector 0x11 enters states ${[...stateMinors.keys()].sort().join(", ")} of row 1`);
  c.ok(hang.length === 0, hang.length ? `transitions onto the hang loop: ${hang.slice(0, 6).join("; ")}`
    : "every transition lands on a live cell");
  c.ok(hist(flags) === hist(new Map([[0, 677], [DEFER, 208]])),
       `camera-play flags: ${[...flags].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k} x${v}`).join(", ")}`
       + (hist(flags) === hist(new Map([[0, 677], [DEFER, 208]])) ? ""
         : "; formats/evt.md states 0 x677, 2 x208"));
  stated(c, deferred, 208, "deferred plays (flags & 2)");
  stated(c, followed, 208, "...followed within three queued actions by 0x21 into state 6 or 7");
  c.ok(unfollowed.length === 0,
       unfollowed.length ? `not followed: ${unfollowed.slice(0, 6).join("; ")}`
         : "no deferred play is left without the state that plays it");

  c.finish();
}

await main();
