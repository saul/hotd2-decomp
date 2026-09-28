/**
 * How opaque the damage overlay is on screen, measured off the page's pixels.
 *
 * `DamageOverlayUpdateAndDraw` (`FUN_00417300`) draws one `common.bin` model
 * with a plain `AssetDrawSlot` (`FUN_00418560`): no alpha of its own, so what
 * reaches the screen is the texture's alpha times the mesh's base alpha,
 * which is 1.0 in all eleven -- see `docs/formats/combat.md`, *How opaque it
 * is*. This asks the running port the same question with nothing but
 * screenshots:
 *
 * * Two driven runs on one seed, in step: one draws the overlay, and the
 *   other leaves it out of exactly the frames that are shot, by pointing the
 *   record's kind past the slot table for that one frame. The draw then finds
 *   no slot and skips it, and nothing in the game reads the kind after the
 *   spawn, so both runs reach the same frame with the same world -- the two
 *   pictures differ by the overlay and nothing else -- which is why the
 *   coverage it prints is a few percent of the canvas and not most of it.
 *   It cannot be done in one run: under `?drive=1` an `advance(0)` redraws
 *   the scene graph as the last tick posed it, and the render layers pose in
 *   the tick, so a record changed between ticks reaches no picture (L69).
 * * Two moments of the overlay's life, early and late. The overlay rides the
 *   camera, so it covers the same pixels at both while the world behind it
 *   moves with the shake. Two backgrounds under one pixel give its alpha
 *   exactly -- `a = 1 - (P1 - P2) / (B1 - B2)`, on the channel where the
 *   backgrounds differ most.
 *
 * It prints the alpha histogram over the pixels the overlay covers, the share
 * that are fully opaque, and whether those pixels hold the same colour at
 * both moments, which a fade would not.
 *
 *   node tools/hurt_alpha.mjs --headless
 *   node tools/hurt_alpha.mjs --headless --url '?stage=1&mode=play&block=4&step=0&op=0' --out s1
 *
 * Screenshots: `web/shots/hurt-<tag>-<frames left>-{on,off}.png`.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { openPlayer, waitForLoad, SHOTS } from "./lib/player.mjs";

const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const flag = (n) => args.includes(`--${n}`);
const where = opt("url", "?stage=2&mode=play&entry=0&block=16&step=5&op=9");
const tag = opt("out", "s2");
const BUDGET = Number(opt("budget", "3000"));
/** Frames left on the record at which to measure: early, and late. */
const AT = opt("at", "57,30").split(",").map(Number);
/** A kind past `g_damage_overlay_slots`' eleven rows: the draw skips it. */
const NO_SLOT = 0x7f;

/** One driven run: get hit, then shoot the frames with `AT` frames left. */
async function run(hide) {
  const { page, close } = await openPlayer({
    url: `${where}&drive=1&seed=${opt("seed", "1")}`,
    size: opt("size", "1280x800"), headless: flag("headless"),
    quiet: !flag("loud"), debug: false,
  });
  const drive = (n) =>
    page.evaluate((k) => globalThis.__hotd2Drive.advance(k), n);
  const record = () => page.evaluate(async () => {
    const { G } = await import("/src/game/globals.ts");
    return { ...G.g_damage_overlays[0], lives: G.g_player_lives[0],
             invuln: G.g_player_invuln_frames[0] };
  });
  const setKind = (v) => page.evaluate(async (k) => {
    const { G } = await import("/src/game/globals.ts");
    G.g_damage_overlays[0].kind = k;
  }, v);
  try {
    await waitForLoad(page);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Space");
    const box = await page.evaluate(() => {
      const r = document.querySelector("#viewport canvas")
        .getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y),
               width: Math.floor(r.width), height: Math.floor(r.height) };
    });
    // A strike: the window re-opening with a life gone (L47).
    let prev = await record();
    let hit = false;
    for (let done = 0; done < BUDGET && !hit; done += 1) {
      await drive(1);
      const r = await record();
      hit = r.invuln > prev.invuln && r.lives < prev.lives;
      prev = r;
    }
    if (!hit) throw new Error("nothing hit the player in the budget");
    for (let k = 0; k < 4 && !(await record()).active; k++) await drive(1);
    if (!(await record()).active) {
      throw new Error("hit, but no overlay was spawned");
    }
    const shots = [];
    for (const left of AT) {
      const r = await record();
      if (r.frames > left + 1) await drive(r.frames - left - 1);
      const kind = (await record()).kind;
      if (hide) await setKind(NO_SLOT);
      await drive(1);
      const now = await record();
      if (hide) await setKind(kind);
      const png = await page.screenshot({ clip: box });
      writeFileSync(join(SHOTS,
        `hurt-${tag}-${now.frames}-${hide ? "off" : "on"}.png`), png);
      shots.push({ frames: now.frames, active: now.active, kind, png });
    }
    return { box, shots, page, close };
  } catch (e) {
    await close();
    throw e;
  }
}

let failed = false;
const drawn = await run(false);
await drawn.close();
const hidden = await run(true);
try {
  const at = [0, 1].map((i) => ({
    frames: drawn.shots[i].frames, kind: drawn.shots[i].kind,
    on: drawn.shots[i].png.toString("base64"),
    off: hidden.shots[i].png.toString("base64"),
  }));
  console.log(`hit: kind ${at[0].kind}; measured at ${at[0].frames} and `
    + `${at[1].frames} frames left`);
  for (const i of [0, 1]) {
    if (drawn.shots[i].frames !== hidden.shots[i].frames
        || !drawn.shots[i].active || !hidden.shots[i].active) {
      console.log("FAIL  the two runs are not at the same frame of a live overlay");
      failed = true;
    }
  }

  const res = await hidden.page.evaluate(async (s) => {
    const load = (b64) => new Promise((ok, fail) => {
      const im = new Image();
      im.onload = () => ok(im);
      im.onerror = fail;
      im.src = `data:image/png;base64,${b64}`;
    });
    const px = async (b64) => {
      const im = await load(b64);
      const c = document.createElement("canvas");
      c.width = im.width; c.height = im.height;
      const g = c.getContext("2d");
      g.drawImage(im, 0, 0);
      return g.getImageData(0, 0, im.width, im.height).data;
    };
    const [p1, b1, p2, b2] = await Promise.all(
      [s[0].on, s[0].off, s[1].on, s[1].off].map(px));
    const n = p1.length / 4;
    const bins = new Array(11).fill(0);
    let covered = 0, both = 0, measured = 0, opaque = 0, opaqueSame = 0;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      let d1 = 0, d2 = 0;
      for (let c = 0; c < 3; c++) {
        d1 = Math.max(d1, Math.abs(p1[o + c] - b1[o + c]));
        d2 = Math.max(d2, Math.abs(p2[o + c] - b2[o + c]));
      }
      if (d1 === 0 && d2 === 0) continue;
      covered++;
      // The overlay is on the same pixels at both moments; a pixel that
      // differs at only one of them is a texel whose colour happened to
      // match what was behind it -- or the two runs out of step.
      if (d1 > 0 && d2 > 0) both++;
      let best = -1, db = 0;
      for (let c = 0; c < 3; c++) {
        const v = Math.abs(b1[o + c] - b2[o + c]);
        if (v > db) { db = v; best = c; }
      }
      if (db < 48) continue;
      measured++;
      const alpha = 1 - (p1[o + best] - p2[o + best])
        / (b1[o + best] - b2[o + best]);
      const a = Math.min(1, Math.max(0, alpha));
      bins[Math.min(10, Math.floor(a * 10 + 1e-9))]++;
      if (a >= 0.98) {
        opaque++;
        if (p1[o] === p2[o] && p1[o + 1] === p2[o + 1]
            && p1[o + 2] === p2[o + 2]) opaqueSame++;
      }
    }
    return { n, covered, both, measured, opaque, opaqueSame, bins };
  }, at);

  const pct = (x, of) => `${(100 * x / Math.max(1, of)).toFixed(1)}%`;
  console.log(`\n${where}: canvas ${drawn.box.width}x${drawn.box.height}`);
  console.log(`  overlay covers ${res.covered} pixels (${pct(res.covered, res.n)}),`
    + ` ${pct(res.both, res.covered)} of them at both moments;`
    + ` ${res.measured} sit on backgrounds that differ enough to measure`);
  console.log("  alpha, in tenths (the last bin is exactly 1.0):");
  console.log("    " + res.bins.map((v) => pct(v, res.measured)).join("  "));
  console.log(`  alpha >= 0.98: ${res.opaque} (${pct(res.opaque, res.measured)}),`
    + ` ${pct(res.opaqueSame, res.opaque)} of them the same colour at both`
    + " moments");
  // The marks' non-zero texels cover about a tenth of the frame (8-10% in the
  // two views above), the same tenth at both moments; a run that fell out of
  // step differs nearly everywhere, and in a different place each time.
  if (res.covered > res.n * 0.3 || res.both < res.covered * 0.9) {
    console.log("FAIL  the two runs differ over most of the frame -- they "
      + "are not in step, and nothing above is a measurement");
    failed = true;
  }
  if (res.measured < 500) {
    console.log("FAIL  too few measurable pixels to say anything");
    failed = true;
  }
} finally {
  await hidden.close();
}
process.exit(failed ? 1 : 0);
