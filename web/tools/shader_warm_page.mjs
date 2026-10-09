/**
 * Once the loading screen lifts, play compiles no shader program -- not when
 * the torch comes on, goes off and comes back, and not when a stage's script
 * sets its first fog.
 *
 * three.js compiles a program the first time a material is drawn under a
 * combination of defines it has not seen, synchronously, in that frame, and
 * the number of lights and whether the scene has a fog are among the defines
 * of **every** program. Stage 2's torch used to compile nineteen programs in
 * its first frames (805 ms in one frame, cold, on a desktop) and stage 1's
 * first fogged frame twelve. `Player.warmShaders` and `programsLinked` now
 * build everything at load, the gun lights stay in the scene at intensity 0
 * when off, and the fog stays on it past the far plane (`render/gunlights.ts`,
 * `render/fog.ts`).
 *
 * The count is the page's own: `createProgram` on the WebGL contexts, wrapped
 * before the app's first line (as `tools/pacing.mjs` wraps rAF), read back
 * after the overlay goes and after each stop. The torch's state is read from
 * `G` (L44). Frame times are printed, not asserted: a program's cost depends
 * on the driver's cache, and the count does not.
 *
 *   node tools/shader_warm_page.mjs --headless
 */
import { openPlayer, requireBundle, waitForLoad } from "./lib/player.mjs";

requireBundle("shader_warm_page");

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);

/** Counts every program the page creates, and times each frame's callback. */
const init = () => {
  const w = globalThis;
  w.__programs = 0;
  w.__worstFrame = 0;
  for (const C of [w.WebGL2RenderingContext, w.WebGLRenderingContext]) {
    if (!C) continue;
    const create = C.prototype.createProgram;
    C.prototype.createProgram = function (...a) {
      w.__programs++;
      return create.apply(this, a);
    };
  }
  const raf = w.requestAnimationFrame.bind(w);
  w.requestAnimationFrame = (cb) => raf((ts) => {
    const t = performance.now();
    try { cb(ts); } finally {
      w.__worstFrame = Math.max(w.__worstFrame, performance.now() - t);
    }
  });
};

const failures = [];
const check = (ok, what, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(what);
};

/**
 * One stage from a deep link: the programs the load made, then each leg run
 * to its stop -- `torch` true for "a gun light on", false for "off", a number
 * for that many frames -- with the programs and the worst frame of each.
 */
async function run(address, legs) {
  const { page, close } = await openPlayer({
    url: `?${address}&drive=1&seed=1`, size: "1280x800",
    headless: flag("headless"), quiet: !flag("loud"), init,
  });
  try {
    await waitForLoad(page);
    const atLoad = await page.evaluate(() => globalThis.__programs);
    console.log(`\n?${address}`);
    check(atLoad > 0, "the load compiled the stage's programs",
          `${atLoad} programs`);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Space");
    for (const leg of legs) {
      const r = await page.evaluate(async ({ leg, budget }) => {
        const { G } = await import("/src/game/globals.ts");
        const { GUN_LIGHT_FIRST } = await import("/src/game/scene_lights.ts");
        const torch = () => G.g_scene_lighting !== 0
          && !!G.g_entity_lights[GUN_LIGHT_FIRST]?.enabled;
        const before = globalThis.__programs;
        globalThis.__worstFrame = 0;
        const frames = await globalThis.__hotd2Drive.advance(
          typeof leg === "number" ? leg : budget,
          typeof leg === "number" ? undefined : () => torch() === leg);
        // The frame the stop lands on is drawn after the condition: draw it.
        await globalThis.__hotd2Drive.advance(2);
        return {
          frames, torch: torch(),
          programs: globalThis.__programs - before,
          worst: globalThis.__worstFrame,
          at: globalThis.__hotd2Drive.now().a,
        };
      }, { leg, budget: 900 });
      const what = typeof leg === "number" ? `${leg} frames of play`
        : leg ? "the torch coming on" : "the torch going off";
      if (typeof leg !== "number") {
        check(r.torch === leg, `${leg ? "the torch comes on" : "the torch goes off"}`
              + " within 900 frames", `driven frame ${r.frames}, at ${r.at}`);
      }
      check(r.programs === 0, `no program is compiled through ${what}`,
            `${r.programs} compiled; worst frame ${r.worst.toFixed(1)} ms`);
    }
  } finally {
    await close();
  }
}

let code = 1;
try {
  // Stage 3 block 11 step 1: op 51 turns the gun lights on, 75 off, 81 on
  // again, a few hundred frames apart.
  await run("stage=3&block=11&step=1&op=0", [true, false, true]);
  // Stage 1 from its entry: the script's first fog op is in the first frames.
  await run("stage=1", [300]);
  code = failures.length ? 1 : 0;
  console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
} catch (e) {
  console.log(`FAIL  ${e?.stack ?? e}`);
}
process.exit(code);
