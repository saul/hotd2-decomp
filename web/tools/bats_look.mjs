/**
 * The bats in the running page: every sub-type drawn, their wings alive for
 * as long as their bodies, and the splash a shot one leaves in the water.
 *
 *     node tools/bats_look.mjs --headless
 *     node tools/bats_look.mjs --headless --url '?stage=4&block=7&step=3&op=0'
 *
 * Stage 3 block 2 step 4 is the default because it is the one step that
 * places both runtime-child sub-types -- the scatter's twenty-five and a
 * swarm -- over water. Under `?drive=1` it advances until they are up,
 * screenshots them (the frame and a crop round the nearest), then fires at
 * whatever class-0x46 entry `g_shot_test_list` holds until a corpse reaches
 * the water plane, and screenshots the splash's frames.
 *
 * What it asserts it reads out of the page's own `G` and its own layer text,
 * never out of its arguments (`L44`): the sub-types seen, bodies against wings
 * each frame, the character layer's "up" count, and a splash record whose
 * frame advances one a tick. Screenshots go to `web/shots/bats-look-*.png`.
 */
import { join } from "node:path";
import { openPlayer, pull, waitForLoad, SHOTS } from "./lib/player.mjs";

const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const where = opt("url", "?stage=3&block=2&step=4&op=15");
const tag = opt("out", "bats-look");
const BUDGET = Number(opt("budget", "1800"));

const { page, state, close } = await openPlayer({
  url: `${where}&drive=1&seed=${opt("seed", "1")}`,
  size: opt("size", "1920x1200"), headless: args.includes("--headless"), quiet: true,
});

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok || !detail ? "" : ` -- ${detail}`}`);
};

try {
  await waitForLoad(page);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press("Space");
  const advance = (n) =>
    page.evaluate((k) => globalThis.__hotd2Drive.advance(k), n);
  const targets = () => page.evaluate(
    () => globalThis.__hotd2Drive.shotTargets().filter((t) => t.cls === 0x46));
  /** The bats in the page's pool, and the splashes, off its own `G`. */
  const census = () => page.evaluate(async () => {
    const { G } = await import("/src/game/globals.ts");
    const live = G.g_object_list.filter((o) => o.cls === 0x46 && !o.despawned);
    const by = (wing, sub) => live.filter(
      (o) => !!o.bat?.isWing === wing && o.bat?.subtype === sub).length;
    return {
      bodies: [0, 1, 2].map((s) => by(false, s)),
      wings: [0, 1, 2].map((s) => by(true, s)),
      splashes: G.g_bat_splashes.map((s) => ({ drawn: s.drawn, x: s.x,
                                                y: s.y, z: s.z })),
      score: G.g_player_score[0],
    };
  });
  const box = await page.locator("#viewport").boundingBox();
  const shot = async (name, clip, quiet = false) => {
    const path = join(SHOTS, `${tag}-${name}.png`);
    await page.screenshot({ path, ...(clip ? { clip } : {}) });
    if (!quiet) console.log(`  shot ${path}`);
  };
  /** A 480-pixel crop round an NDC point, inside the viewport. */
  const cropAt = (t) => {
    const w = 480, h = 360;
    const cx = box.x + ((t.x + 1) / 2) * box.width;
    const cy = box.y + ((1 - t.y) / 2) * box.height;
    return {
      x: Math.max(box.x, Math.min(box.x + box.width - w, cx - w / 2)),
      y: Math.max(box.y, Math.min(box.y + box.height - h, cy - h / 2)),
      width: w, height: h,
    };
  };

  const seen = [0, 0, 0];
  let unmatched = 0;
  const step = async (n) => {
    for (let k = 0; k < n; k += 1) {
      await advance(1);
      const c = await census();
      for (let s = 0; s < 3; s += 1) {
        seen[s] = Math.max(seen[s], c.bodies[s]);
        // A wing goes the frame after its body's slot empties, so a frame can
        // hold a wing more than bodies, never a body more than wings.
        if (c.bodies[s] > c.wings[s]) unmatched += 1;
      }
    }
    return census();
  };
  const inView = (t) => t.z < 1 && Math.abs(t.x) < 0.95 && Math.abs(t.y) < 0.95;
  const centroid = (ts) => ({
    x: ts.reduce((a, t) => a + t.x, 0) / ts.length,
    y: ts.reduce((a, t) => a + t.y, 0) / ts.length,
  });

  // The scatter bursts out of the tunnel ahead and climbs past the lens: the
  // picture is the frame the flock is highest while still all in view.
  let f = 0;
  let c = await census();
  while (f < BUDGET && c.bodies.every((n) => n === 0)) {
    c = await step(5);
    f += 5;
  }
  if (c.bodies[1] > 0) {
    let best = null;
    for (let k = 0; k < 120 && c.bodies[1] > 0; k += 2) {
      c = await step(2);
      const ts = (await targets()).filter((t) => inView(t));
      const depth = ts.reduce((a, t) => a + t.z, 0) / (ts.length || 1);
      // The nearest the flock comes with most of it still in the frame.
      if (ts.length >= 8 && (!best || depth < best.depth)) {
        best = { ...centroid(ts), n: ts.length, k, depth };
        // Overwritten until the flock is nearest; named once below.
        await shot("sub1", null, true);
        await shot("sub1-near", cropAt(best), true);
      }
    }
    if (best) {
      console.log(`  shot ${join(SHOTS, `${tag}-sub1.png`)} and -near: `
        + `${best.n} in view, centroid (${best.x.toFixed(2)}, `
        + `${best.y.toFixed(2)})`);
    }
  }
  // The swarm orbits its point and peels off at the lens one at a time, and a
  // diving bat homes on it after its spline: the picture is the first one
  // most of the way in.
  let closeShot = false;
  for (; f < BUDGET && !closeShot; f += 2) {
    c = await step(2);
    if (c.bodies[0] === 0 && c.bodies[2] === 0) continue;
    const near = await page.evaluate(async () => {
      const { G } = await import("/src/game/globals.ts");
      const m = G.g_object_list.filter((o) => o.cls === 0x46 && !o.despawned
        && !o.bat.isWing && o.bat.state === 1
        && (o.bat.subtype === 2 || o.bat.segment >= 2));
      const top = m.sort((a, b) => b.bat.t - a.bat.t)[0];
      return top ? { t: top.bat.t, sub: top.bat.subtype } : null;
    });
    if (!near || near.t < 0.5) continue;
    const t = (await targets()).filter((x) => inView(x))
      .sort((a, b) => a.z - b.z)[0];
    await shot(`sub${near.sub}`);
    if (t) await shot(`sub${near.sub}-near`, cropAt(t));
    closeShot = true;
  }
  const text = await page.evaluate(() => document.body.innerText);
  const upText = (text.match(/\d+ of \d+ up, \d+ types/) ?? [""])[0];
  console.log(`\n${where}: bodies seen by sub-type ${seen.join("/")}; `
    + `characters layer "${upText}"`);
  check("bats are placed", seen.some((n) => n > 0), seen.join("/"));
  check("...and every live body has a live wing, every frame",
        unmatched === 0, `${unmatched} frames short`);

  // Shoot the nearest bat the engine's list holds until one reaches the water.
  let splash = null;
  let aim = null;
  const score0 = (await census()).score;
  const frames = [];
  for (let v = 0; v < 300 && !splash; v += 1) {
    const t = (await targets()).filter((x) => inView(x))
      .sort((a, b) => a.z - b.z)[0];
    if (t) {
      aim = t;
      await pull(page, box.x + ((t.x + 1) / 2) * box.width,
                 box.y + ((1 - t.y) / 2) * box.height);
    }
    c = await step(2);
    if (c.splashes.length) splash = c.splashes[0];
  }
  const score1 = (await census()).score;
  // Score, not a counter: an arrival gives the counters back as a kill does
  // (L47), and only a kill pays.
  if (aim) check("a shot bat scores", score1 > score0, `${score0} -> ${score1}`);
  else console.log("  (no bat left in view to shoot at)");
  // Only the scatter's and the swarm's corpses fall to the water; a diving
  // bat's lasts eighty frames and goes.
  if (seen[1] + seen[2] > 0) {
    check("a shot bat that reaches the water leaves a splash on the plane",
          !!splash && splash.y === -25, JSON.stringify(splash));
  }
  if (splash) {
    for (let k = 0; k < 4; k += 1) {
      const s = (await census()).splashes[0];
      if (!s) break;
      frames.push(s.drawn);
      await shot(`splash-${String(s.drawn).padStart(2, "0")}`);
      if (aim) {
        await shot(`splash-${String(s.drawn).padStart(2, "0")}-near`,
                   cropAt({ x: aim.x, y: aim.y - 0.25 }));
      }
      await advance(6);
    }
    check("...whose frame advances one model a tick",
          frames.length >= 3 && frames.every((d, i) => i === 0
            || d > frames[i - 1]), frames.join(","));
    await advance(40);
    const c = await census();
    check("...and is gone after its thirtieth", c.splashes.length === 0,
          `${c.splashes.length}`);
  }
  check("the page raised nothing", state.faults === 0,
        state.faultLines.join(" | "));
} finally {
  await close();
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
