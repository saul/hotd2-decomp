/**
 * In the real page: **a story-mode switch is kicked open by a click on its
 * door, through its mesh, and opens its branch.**
 *
 *     HOTD2_BUNDLE=... node tools/story_switch_page.mjs --headless [--shot]
 *
 * Stage 5 in Original Mode, block 4. Step 0 places the gateway's two leaves
 * (`0x1F14`, `0x1F5C`) -- class 0x44 selector 17, `PlaceStoryModeSwitch`
 * (`FUN_00473A70`), keyless, each naming a collision blob, sides -1 and +1 --
 * and step 2 raises `g_script_flags[16]`, the flag they wait on. Block 4's
 * route is `{5, -1, 6}`: a thrown switch writes `g_script_branch_var = 2`
 * while it stands in scene 4 block 4. Every shipped switch is shot through
 * `ShotTestMesh` (`FUN_00404A00`); before `class44/story_switch.ts` the prop
 * pool had no mesh test and gave these a hit radius of 0, so no shipped
 * switch could be shot and none of the five routes they answer was reached.
 *
 * Two loads of the same address on the same seed. One **clicks** at a leaf
 * where the page's own `shotTargets` puts it -- the middle of its blob
 * through its `obj+0x150`, projected by the camera the click is unprojected
 * through -- until a leaf is thrown; the other clicks nothing. Both play
 * until step 2 has raised flag 16 and stood a second. The verdict is what only
 * a thrown switch writes there (`L47`): `g_script_branch_var` 2 and a leaf's
 * `obj+0x2A0` spent to -1, against 0 and 16 in the unclicked run -- and both
 * leaves thrown by one click, through `g_story_switch_thrown`.
 *
 * `--shot` writes `shots/story_switch_{shut,swing,open}.png`: the frame of
 * the click that threw the gate, and thirty and sixty frames after the throw.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  openPlayer, pull, requireBundle, SHOTS, WEB, waitForLoad,
} from "./lib/player.mjs";

requireBundle("story_switch_page");
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const BLOCK = 4;
// Step 1: a seek does not stop on a block's step 0, and the replay of step 0
// leaves both placers in the pool for the first frame to build.
const URL = `?stage=5&original=1&block=${BLOCK}&step=1&op=0&drive=1&seed=1`;
/** Frames to play before giving up on the flag. */
const BUDGET = 4000;
/** Frames to stand once step 2 has raised flag 16. */
const AFTER_FLAG = 60;
/** The step, and the op past its `set_script_flag 16`. */
const FLAG_STEP = 2;
const FLAG_OP = 3;
/** Block 4's route record: slot 2, which only a written 2 takes. */
const ROUTED = 6;
/** Frames between two clicks at a leaf. */
const CLICK_EVERY = 12;

let failures = 0;
const check = (what, ok, note = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${note ? ` -- ${note}` : ""}`);
  if (!ok) failures += 1;
};

/** The leaves, as the page's pool holds them, and whether each is filed. */
const leaves = (page) => page.evaluate(async () => {
  const { G } = await import("/src/game/globals.ts");
  const { PropFamily } = await import("/src/game/class41/prop_state.ts");
  return {
    branch: G.g_script_branch_var,
    thrown: G.g_story_switch_thrown,
    list: G.g_breakable_props
      .filter((p) => !p.dead && p.family === PropFamily.StoryModeSwitch)
      .map((p) => ({
        id: p.id, at: p.at, flags: p.flags, phase: p.routinePhase,
        blob: p.coliBlob, m: !!p.coliMatrix, branchFlag: p.storyItem,
        filed: G.g_shot_test_list.some((e) => e.prop === p.id),
      })),
  };
});

/** Play from `URL` until step 2 has raised flag 16, clicking a leaf or not. */
async function play(shoot) {
  const { page, state, close } = await openPlayer({
    url: URL, size: "1280x800", headless: flag("headless"),
    quiet: !flag("loud"),
  });
  const out = { placed: false, filed: false, mesh: false, thrown: -1,
                both: false, clicks: 0, branch: 0, spent: null, flagged: -1,
                faults: 0, at: "" };
  try {
    await waitForLoad(page);
    if (await page.evaluate(() => globalThis.__hotd2Drive?.version ?? null)
        === null) {
      throw new Error("no drive seam -- is ?drive=1 wired up?");
    }
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Space");
    const canvas = await page.locator("canvas").first().boundingBox();
    const advance = (n) =>
      page.evaluate((k) => globalThis.__hotd2Drive.advance(k), n);
    const where = () => page.evaluate(() => globalThis.__hotd2Drive.now().a);
    for (let f = 0; f < BUDGET; f += 2) {
      await advance(2);
      const a = await where();
      out.at = a;
      const [block, step, op] = a.split("/").map(Number);
      if (!Number.isInteger(block)) continue;
      if (out.flagged < 0 && (block !== BLOCK || step > FLAG_STEP
                              || (step === FLAG_STEP && op >= FLAG_OP))) {
        out.flagged = f;
      }
      const s = await leaves(page);
      const ds = s.list;
      if (ds.length) out.placed = true;
      if (ds.some((d) => d.filed)) out.filed = true;
      if (ds.some((d) => d.filed && d.flags === 0x51 && d.blob && d.m)) {
        out.mesh = true;
      }
      if (out.thrown < 0 && ds.some((d) => d.phase === 1)) out.thrown = f;
      if (ds.length === 2 && ds.every((d) => d.phase === 1)) out.both = true;
      out.spent = ds.map((d) => d.branchFlag);
      out.branch = s.branch;
      if (shoot && flag("shot") && out.thrown >= 0
          && f === out.thrown + 30) {
        await page.screenshot({ path: join(SHOTS, "story_switch_swing.png") });
      }
      if (shoot && flag("shot") && out.thrown >= 0
          && f === out.thrown + 60) {
        await page.screenshot({ path: join(SHOTS, "story_switch_open.png") });
      }
      if (shoot && out.thrown < 0 && f % CLICK_EVERY === 0 && canvas) {
        const t = (await page.evaluate(
          () => globalThis.__hotd2Drive.shotTargets?.() ?? []))
          .find((x) => x.prop !== undefined && Math.abs(x.x) <= 1
                && Math.abs(x.y) <= 1 && x.z >= -1 && x.z <= 1);
        if (t) {
          // Overwritten by every click, so it is the frame of the one that
          // threw (most clicks land while a cut-scene holds the gun).
          if (flag("shot")) {
            await page.screenshot({
              path: join(SHOTS, "story_switch_shut.png") });
          }
          await pull(page, canvas.x + ((t.x + 1) / 2) * canvas.width,
                     canvas.y + ((1 - t.y) / 2) * canvas.height);
          out.clicks += 1;
        }
      }
      if (out.flagged >= 0 && f - out.flagged >= AFTER_FLAG
          && (!shoot || !flag("shot") || (out.thrown >= 0
                                          && f > out.thrown + 60))) {
        break;
      }
    }
    out.faults = state.faults;
  } finally {
    await close();
  }
  return out;
}

/** Block 4's route record, out of the same bundle the page played. */
function routeOfBlock4() {
  const root = process.env.HOTD2_BUNDLE ?? join(WEB, "..", "extract", "player");
  const script = JSON.parse(readFileSync(
    join(root, "stage5_original", "stage5_original.script.json"), "utf8"));
  return script.blocks.find((b) => b.index === BLOCK)?.route?.next
    ?? script.routes?.[BLOCK]?.next ?? null;
}

console.log(`\nstage 5, Original Mode, from ${URL}:\n`);
const shot = await play(true);
console.log(`  clicked:     ${JSON.stringify(shot)}`);
const quiet = await play(false);
console.log(`  not clicked: ${JSON.stringify(quiet)}\n`);

check("block 4 places the gateway's leaves, and each files itself in the "
      + "shot-test list as a mesh object (0x51, its blob, its matrix)",
      shot.placed && shot.filed && shot.mesh);
const route = routeOfBlock4();
check(`block 4's route record sends a 2 to block ${ROUTED}`,
      Array.isArray(route) && route[2] === ROUTED, JSON.stringify(route));
check("a click on a leaf throws it, and the other with it",
      shot.thrown >= 0 && shot.both, `${shot.clicks} clicks`);
check("...and once step 2 raises flag 16 the route is written, once: "
      + "g_script_branch_var 2 and the leaves' +0x2A0 spent to -1",
      shot.flagged >= 0 && shot.branch === 2 && shot.spent?.includes(-1),
      `flag at frame ${shot.flagged}, var ${shot.branch}, `
      + `+0x2A0 ${JSON.stringify(shot.spent)}`);
check("with no click the same frames write no route, and both leaves still "
      + "wait on flag 16",
      quiet.flagged >= 0 && quiet.thrown < 0 && quiet.branch === 0
      && quiet.spent?.length === 2 && quiet.spent.every((x) => x === 16),
      `flag at frame ${quiet.flagged}, thrown ${quiet.thrown}, `
      + `var ${quiet.branch}, +0x2A0 ${JSON.stringify(quiet.spent)}`);
check("the page raised no fault in either run",
      shot.faults === 0 && quiet.faults === 0,
      `${shot.faults} and ${quiet.faults}`);
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
