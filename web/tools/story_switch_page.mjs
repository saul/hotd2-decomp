/**
 * In the real page: **a story-mode switch opens its branch when it is shot,
 * through its mesh.**
 *
 *     node tools/story_switch_page.mjs --headless
 *
 * Stage 5 in Original Mode, block 4. Step 0 places the gateway's two doors
 * (`0x1F14`, `0x1F5C`) -- class 0x44 selector 17, `PlaceStoryModeSwitch`
 * (`FUN_00473A70`), keyless, each naming a collision blob, swing signs -1 and
 * 1 -- and step 2 raises `g_script_flags[16]`, the flag they wait on. Block
 * 4's route is `{5, -1, 6}`: a thrown switch writes `g_script_branch_var = 2`
 * while it stands in scene 4 block 4, and when the block ends the walker goes
 * to block 6 instead of 5. Every shipped switch is shot through `ShotTestMesh`
 * (`FUN_00404A00`), which the port could not do for the prop pool, so no
 * shipped switch could be shot and no such route reached.
 *
 * Two loads of the same address on the same seed. One pulls the trigger at
 * a door's own mesh -- the ray the pointer handler queues, from the drawn
 * eye through the centre of the door's blob as its draw stored it at
 * `obj+0x150`, reloading every six -- until a door is thrown; the other pulls
 * nothing. Both play until step 2 has raised flag 16 and stood a second. The
 * verdict is what only a thrown switch can write there (`L47`):
 * `g_script_branch_var` 2, the value block 4's route record `{5, -1, 6}`
 * sends to block 6, and the door's `obj+0x2A0` spent to -1 so it fires once
 * -- against 0 and 16 in the unshot run.
 *
 * It does not play on to the end of the block: step 2 then waits on
 * `g_enemies_alive` twice, and from this deep link the count stays at 1 after
 * every actor in the pool is dead, debug clear or not -- a fault of the seek's
 * rebuild or of the room, separate from the switch, and reported as such.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openPlayer, requireBundle, WEB, waitForLoad } from "./lib/player.mjs";

requireBundle("story_switch_page");
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const BLOCK = 4;
// Step 1: a seek does not stop on a block's step 0, and the replay of step 0
// leaves both door placers in the pool for the first frame to build.
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
/** Frames between two pulls at a door. */
const DOOR_EVERY = 12;

let failures = 0;
const check = (what, ok, note = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${note ? ` -- ${note}` : ""}`);
  if (!ok) failures += 1;
};

/** The doors, as the page's pool holds them, and whether each is filed. */
const doors = (page) => page.evaluate(async () => {
  const { G } = await import("/src/game/globals.ts");
  const { PropFamily } = await import("/src/game/class41/prop_state.ts");
  return G.g_breakable_props
    .filter((p) => !p.dead && p.family === PropFamily.StoryModeSwitch)
    .map((p) => ({
      id: p.id, flags: p.flags, phase: p.routinePhase, blob: p.coliBlob,
      m: !!p.coliMatrix, branchFlag: p.storyItem,
      filed: G.g_shot_test_list.some((e) => e.prop === p.id),
    }));
});

/**
 * One pull at the centre of a door's mesh: the blob's box through
 * `obj+0x150`, from the eye of the block the frame was drawn from, queued as
 * the pointer handler queues a click -- after an off-screen pull, the gun's
 * reload, every sixth.
 */
const pullAtDoor = (page, id, reload) => page.evaluate(async ([doorId, r]) => {
  const { G } = await import("/src/game/globals.ts");
  const { T } = await import("/src/game/tables.ts");
  const { CameraBlockViewToWorld } = await import("/src/game/camera/view.ts");
  const { QueueOffscreenPull, QueueShotRequest } =
    await import("/src/game/combat/shot.ts");
  const p = G.g_breakable_props.find((q) => q.id === doorId);
  const blob = p?.coliBlob ? T.coli?.blobs?.[p.coliBlob] : null;
  const m = p?.coliMatrix;
  if (!blob || !m) return false;
  const c = [0, 1, 2].map((i) => (blob.min[i] + blob.max[i]) / 2);
  const w = {
    x: m[0] * c[0] + m[1] * c[1] + m[2] * c[2] + m[3],
    y: m[4] * c[0] + m[5] * c[1] + m[6] * c[2] + m[7],
    z: m[8] * c[0] + m[9] * c[1] + m[10] * c[2] + m[11],
  };
  const v = CameraBlockViewToWorld(G.g_camera_index);
  const eye = { x: v[12], y: v[13], z: v[14] };
  const d = { x: w.x - eye.x, y: w.y - eye.y, z: w.z - eye.z };
  const l = Math.hypot(d.x, d.y, d.z);
  if (!(l > 0)) return false;
  if (r) QueueOffscreenPull(0);
  QueueShotRequest(0, { origin: eye,
                        dir: { x: d.x / l, y: d.y / l, z: d.z / l } });
  return true;
}, [id, reload]);

/** Play from `URL` until step 2 has raised flag 16, shooting a door or not. */
async function play(shoot) {
  const { page, state, close } = await openPlayer({
    url: URL, size: "1280x800", headless: flag("headless"), quiet: !flag("loud"),
  });
  const out = { placed: false, filed: false, mesh: false, thrown: -1,
                doorPulls: 0, branch: 0, spent: null, flagged: -1,
                faults: 0, at: "" };
  try {
    await waitForLoad(page);
    if (await page.evaluate(() => globalThis.__hotd2Drive?.version ?? null)
        === null) {
      throw new Error("no drive seam -- is ?drive=1 wired up?");
    }
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Space");
    const advance = (n) =>
      page.evaluate((k) => globalThis.__hotd2Drive.advance(k), n);
    const where = () => page.evaluate(() => globalThis.__hotd2Drive.now().a);
    for (let f = 0; f < BUDGET; f += 2) {
      await advance(2);
      const a = await where();
      out.at = a;
      // `-` until the stage's walker is up.
      const [block, step, op] = a.split("/").map(Number);
      if (!Number.isInteger(block)) continue;
      if (out.flagged < 0 && (block !== BLOCK || step > FLAG_STEP
                              || (step === FLAG_STEP && op >= FLAG_OP))) {
        out.flagged = f;
      }
      const ds = await doors(page);
      if (ds.length) out.placed = true;
      if (ds.some((d) => d.filed)) out.filed = true;
      if (ds.some((d) => d.filed && d.flags === 0x51 && d.blob && d.m)) {
        out.mesh = true;
      }
      if (out.thrown < 0 && ds.some((d) => d.phase === 1)) out.thrown = f;
      out.spent = ds.map((d) => d.branchFlag);
      out.branch = await page.evaluate(async () => {
        const { G } = await import("/src/game/globals.ts");
        return G.g_script_branch_var;
      });
      // Any door its draw has stored a matrix for -- filed or not, so that a
      // page which leaves the doors out of the list is seen to be pulled at
      // and not thrown.
      const door = ds.find((x) => x.m);
      if (shoot && out.thrown < 0 && door && f % DOOR_EVERY === 0) {
        if (await pullAtDoor(page, door.id, out.doorPulls % 6 === 5)) {
          out.doorPulls += 1;
        }
      }
      if (out.flagged >= 0 && f - out.flagged >= AFTER_FLAG) break;
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
console.log(`  shot:      ${JSON.stringify(shot)}`);
const quiet = await play(false);
console.log(`  not shot:  ${JSON.stringify(quiet)}\n`);

check("block 4 places the gateway's doors, and each files itself in the "
      + "shot-test list as a mesh object (0x51, its blob, its matrix)",
      shot.placed && shot.filed && shot.mesh);
const route = routeOfBlock4();
check(`block 4's route record sends a 2 to block ${ROUTED}`,
      Array.isArray(route) && route[2] === ROUTED, JSON.stringify(route));
check("a pull at a door's mesh throws it", shot.thrown >= 0,
      `${shot.doorPulls} pulls`);
check("...and once step 2 raises flag 16 the route is written, once: "
      + "g_script_branch_var 2 and a door's +0x2A0 spent to -1",
      shot.flagged >= 0 && shot.branch === 2 && shot.spent?.includes(-1),
      `flag at frame ${shot.flagged}, var ${shot.branch}, `
      + `+0x2A0 ${JSON.stringify(shot.spent)}`);
check("with no pull at the doors the same frames write no route, and both "
      + "doors still wait on flag 16",
      quiet.flagged >= 0 && quiet.thrown < 0 && quiet.branch === 0
      && quiet.spent?.length === 2 && quiet.spent.every((x) => x === 16),
      `flag at frame ${quiet.flagged}, thrown ${quiet.thrown}, `
      + `var ${quiet.branch}, +0x2A0 ${JSON.stringify(quiet.spent)}`);
check("the page raised no fault in either run",
      shot.faults === 0 && quiet.faults === 0,
      `${shot.faults} and ${quiet.faults}`);
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
