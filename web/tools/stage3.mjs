/**
 * Stage 3's opening, in a real browser, checked against what the scene holds.
 *
 * Two defects were reported together — *"we're starting completely in fog"*
 * and *"the boat isn't moving with the characters"* — and both of them are
 * invisible to every headless check in the tree, because both are about where
 * something ended up **after** a renderer had its turn. So this drives the
 * page, on the driven clock, and reads back the two facts that would have
 * caught them:
 *
 * * **the resolved fog range, and the camera transform it is measured
 *   against.** `D3DFOG_LINEAR`'s `FOGSTART`/`FOGEND` are eye-space depths
 *   (`SetFogRange` — `FUN_004ABDF0`), so the fog is relative to whatever view
 *   matrix drew the frame; the failure mode is a frame drawn from a camera
 *   that has not been placed yet, which puts every wall past `fogFar` and
 *   fills the screen with fog colour. The assertion is that the eye the fog
 *   was computed from is the eye of the shot the script is playing — not the
 *   origin, not the last stage's.
 * * **the boat's world position against its passengers'.** Not "the layer
 *   says it drew something": the node's own translation, out of
 *   `SlotModelLayer.describe`, against the two class-0x25 actors' positions
 *   out of the drive harness. Those two came from different halves of the
 *   player and they have to agree to within a boat.
 *
 *     node tools/stage3.mjs             # headed, watch it
 *     node tools/stage3.mjs --headless
 *
 * Exits 1 on a failed assertion, 0 otherwise. Booting Chrome is
 * `tools/lib/player.mjs`, shared with `shot.mjs` and `playthrough.mjs`.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { openPlayer, waitForLoad, SHOTS } from "./lib/player.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

/**
 * Frames of stage 3's *opening* to look at, for the fog checks.
 *
 * The canal marks used to be absolute too -- `400,700,1000,1200` -- and that
 * was a latent trap rather than a shortcut. Honouring `wait_script_flag`
 * moved every one of stage 3's shots later on the wall clock, and four checks
 * failed reporting a missing boat when what had actually happened is that
 * frame 400 was still inside the flashback interior, where there is no boat
 * and no canal. **A check pinned to a frame number is a check pinned to the
 * pacing of the build it was written against.** The canal is found by its
 * camera slot now and sampled relative to where it starts.
 */
const MARKS = (opt("at", "1,15,30,120")).split(",").map(Number);

/** `cp_st3` 122 is the canal; 121 is the flashback interior before it. */
const CANAL_SLOT = "122";
/** Frames past the canal's first frame to sample at. */
const CANAL_OFFSETS = [0, 250, 500, 750];
/** How far to look for the canal before giving up. */
const CANAL_SEARCH_FRAMES = 4000;
const CANAL_SEARCH_STEP = 20;

/** The two class-0x25 passengers, by script address, and the boat's spawn. */
const RIDERS = [4128, 4252];
/** Class 0x25 as the spawn table numbers it. */
const CLASS_SCRIPTED_HUMANOID = 37;
/**
 * How far the boat may be from the midpoint of its passengers.
 *
 * They ride the same `op_st3` path 340 at the same frame, so the only thing
 * between them is `g_class25_path_offsets` — records 4 and 5, which are
 * `(4.62, -8.0, 1.42)` and `(-4.78, -8.0, 0.86)`. Ten units is that, with
 * room for the seat.
 */
const CARRY_TOLERANCE = 12;

let failures = 0;
let ran = 0;
function check(what, ok, detail = "") {
  ran++;
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? `  ${detail}` : ""}`);
}

const { page, close } = await openPlayer({
  url: "?stage=3&mode=play&drive=1",
  size: opt("size", "1280x800"),
  headless: flag("headless"),
  quiet: true,
  // The two groups this reads are folded by default, and **a folded group
  // renders no rows at all** — `ui/panels/Panel.tsx` mounts its children only
  // when open, so a reader that scrapes a closed panel sees an empty string
  // and cannot tell it from a layer with nothing to say. Seeding the
  // persisted fold before the first render is the fix; clicking the summary
  // afterwards is not, because that leaves it focused and the next Space goes
  // to the disclosure rather than to the transport.
  init: () => {
    for (const id of ["panel-camera", "panel-scene", "panel-props"]) {
      localStorage.setItem(`hod2.ui.${id}`, "true");
    }
  },
});

/**
 * Requests that did not arrive, minus the one that never does.
 *
 * `openPlayer`'s own `faults` counter is deliberately not the exit condition
 * here. Headless Chrome will not autoplay audio, so the `<audio>` element for
 * the stage track is torn down mid-fetch and the run always carries one
 * `net::ERR_ABORTED` on `/bgm/...` plus the console line the browser writes
 * for it. The route itself is fine -- `curl` returns 200 and 6.7 MB -- so
 * failing on it would make this check cry wolf on every machine. **Everything
 * else still fails the run**, which is the part worth keeping: a 404 on a
 * bundle file is a stale export or a path the player should not have asked
 * for.
 */
const badRequests = [];
const isBgm = (url) => new URL(url).pathname.startsWith("/bgm/");
page.on("response", (r) => {
  if (r.status() >= 400 && !isBgm(r.url())) {
    badRequests.push(`${r.status()} ${r.url()}`);
  }
});
page.on("requestfailed", (r) => {
  if (!isBgm(r.url())) {
    badRequests.push(`failed ${r.url()} (${r.failure()?.errorText ?? "?"})`);
  }
});
page.on("pageerror", (e) => badRequests.push(`threw: ${e.message}`));

/** One labelled row out of a sidebar group, by the label the table uses. */
const row = (panel, label) => page.evaluate(([p, k]) => {
  const lines = (document.getElementById(p)?.innerText ?? "").split("\n");
  const i = lines.indexOf(k);
  return i >= 0 ? lines[i + 1] : null;
}, [panel, label]);

try {
  await waitForLoad(page);
  // The walker only advances while the transport is running, driven clock or
  // not — `Player.stepOneFrame` tests `this.playing`. Blur first: Space on a
  // just-clicked control goes to the control.
  await page.keyboard.press("Space");
  await page.evaluate(() => document.activeElement?.blur?.());

  let at = 0;
  const seen = [];
  for (const f of MARKS) {
    if (f > at) {
      await page.evaluate((n) => window.__hotd2Drive.advance(n), f - at);
      at = f;
    }
    const [fog, eye, slot, camFrame, slotModels, rigs] = await Promise.all([
      row("panel-scene", "fog"),
      row("panel-camera", "eye"),
      row("panel-camera", "slot"),
      row("panel-camera", "frame"),
      row("panel-props", "slot models"),
      row("panel-props", "rigs"),
    ]);
    const now = await page.evaluate(() => window.__hotd2Drive.now());
    seen.push({ f, fog, eye, slot, camFrame, slotModels, rigs, now });
  }

  // Advance until the canal shot is actually on, then sample relative to it.
  let canalStart = null;
  for (let n = 0; n < CANAL_SEARCH_FRAMES && canalStart === null;
       n += CANAL_SEARCH_STEP) {
    await page.evaluate((k) => window.__hotd2Drive.advance(k),
                        CANAL_SEARCH_STEP);
    at += CANAL_SEARCH_STEP;
    if (await row("panel-camera", "slot") === CANAL_SLOT) canalStart = at;
  }
  check("the canal shot is reached at all",
        canalStart !== null,
        canalStart === null
          ? `no cp_st3 ${CANAL_SLOT} within ${CANAL_SEARCH_FRAMES} frames`
          : `cp_st3 ${CANAL_SLOT} from frame ${canalStart}`);

  for (const off of canalStart === null ? [] : CANAL_OFFSETS) {
    const want = canalStart + off;
    if (want > at) {
      await page.evaluate((n) => window.__hotd2Drive.advance(n), want - at);
      at = want;
    }
    const [fog, eye, slot, camFrame, slotModels, rigs] = await Promise.all([
      row("panel-scene", "fog"),
      row("panel-camera", "eye"),
      row("panel-camera", "slot"),
      row("panel-camera", "frame"),
      row("panel-props", "slot models"),
      row("panel-props", "rigs"),
    ]);
    // The shot's own length is data, not a constant: stop sampling the moment
    // the camera leaves the canal rather than asserting a boat on a frame the
    // boat is not in. This is the same trap as the absolute marks, one level in.
    if (slot !== CANAL_SLOT) break;
    const now = await page.evaluate(() => window.__hotd2Drive.now());
    seen.push({ f: at, canal: true, fog, eye, slot, camFrame, slotModels,
                rigs, now });
  }

  // ---- the fog -----------------------------------------------------------

  console.log("\nthe fog range, and the camera it is measured from:");
  for (const s of seen) {
    console.log(`  f${String(s.f).padStart(4)}  ${s.fog}`
      + `   cam ${s.slot} @ ${s.camFrame}  eye ${s.eye}`);
  }
  // A fog range at all, once the script has set one. Before the fix the port
  // had an invented `far > near` gate that turned fog off wherever the script
  // parked `near` on or past `far` — which is the fade every stage opens and
  // closes with, and stage 5's whole 1228..2944 band.
  const withFog = seen.filter((s) => s.f > 0);
  check("every frame past the first has a fog range",
        withFog.every((s) => /^(planar|radial) /.test(s.fog ?? "")),
        withFog.map((s) => `f${s.f} ${s.fog}`).join(" | "));

  // The camera the fog is measured against. An unplaced camera sits at the
  // origin, and stage 3's canal is 2,200 units from it: everything would be
  // past `fogFar` and the frame would be a flat fill of the fog colour.
  const xyz = (t) => (t ?? "").split(",").map((v) => Number(v.replace("−", "-")));
  for (const s of seen) {
    const [x, y, z] = xyz(s.eye);
    check(`f${s.f}: the eye the fog is measured from is placed`,
          Number.isFinite(x) && Math.hypot(x, y, z) > 1, s.eye ?? "(no eye)");
  }
  // ...and it is the shot's own camera, not a stale one. `cp_st3` 121 is the
  // flashback interior and 122 the canal; they are 2,200 units apart, so a
  // frame drawn from the wrong one of the two cannot pass this.
  const canal = seen.filter((s) => s.canal);
  check("the canal frames are drawn from the canal shot",
        canal.every((s) => s.slot === "122"),
        canal.map((s) => `f${s.f} slot ${s.slot}`).join(" | "));
  check("...and the eye is 2,000+ units from the flashback's",
        canal.every((s) => xyz(s.eye)[2] < -1500),
        canal.map((s) => `f${s.f} ${s.eye}`).join(" | "));

  // ---- the boat ----------------------------------------------------------

  console.log("\nthe boat, against the passengers riding it:");
  for (const s of canal) {
    // `SlotModelLayer.describe`: "... — 1020 slot 0x1a37 at x, y, z".
    const m = /slot 0x1a37 at (-?[\d.]+), (-?[\d.]+), (-?[\d.]+)/
      .exec(s.slotModels ?? "");
    const riders = s.now.o
      .filter((o) => RIDERS.includes(Number(o.split(" ")[0]))
                     && o.includes(`c${CLASS_SCRIPTED_HUMANOID} `))
      .map((o) => /@(-?\d+),(-?\d+),(-?\d+)/.exec(o))
      .filter(Boolean)
      // The harness quantises to 1/4096 of a unit; see `app/harness.ts`.
      .map((g) => [Number(g[1]) / 4096, Number(g[2]) / 4096,
                   Number(g[3]) / 4096]);

    check(`f${s.f}: the boat is drawn`, !!m, s.slotModels ?? "(no row)");
    check(`f${s.f}: both passengers are live`, riders.length === 2,
          `${riders.length}`);
    if (!m || riders.length !== 2) continue;

    const boat = [Number(m[1]), Number(m[2]), Number(m[3])];
    const mid = [0, 1, 2].map((i) => (riders[0][i] + riders[1][i]) / 2);
    const d = Math.hypot(boat[0] - mid[0], boat[1] - mid[1], boat[2] - mid[2]);
    check(`f${s.f}: ...and it is under them`, d <= CARRY_TOLERANCE,
          `d=${d.toFixed(1)}  boat ${boat.map((v) => v.toFixed(1))}`
          + `  mid ${mid.map((v) => v.toFixed(1))}`);
  }

  // It has to *move*: a boat parked in the canal while the passengers sail
  // past is exactly the bug, and every per-frame check above would pass for a
  // boat that never moved if the passengers never moved either.
  const track = canal
    .map((s) => /slot 0x1a37 at (-?[\d.]+), (-?[\d.]+), (-?[\d.]+)/
      .exec(s.slotModels ?? ""))
    .filter(Boolean).map((m) => [Number(m[1]), Number(m[3])]);
  const travelled = track.length < 2 ? 0
    : Math.hypot(track.at(-1)[0] - track[0][0], track.at(-1)[1] - track[0][1]);
  if (canal.length >= 2) {
    check("the boat travels down the canal rather than parking",
          travelled > 100, `${travelled.toFixed(0)} units`);
  }

  // ---- and the boat that is *not* the boat -------------------------------

  // `Class26Subtype2Update` (`FUN_0048EAD0`) draws the same model, and its
  // `g_active_cam_path` switch does not name 121, 122 or 123. Its `default:`
  // arm writes no pose at all, so through the whole opening the engine has it
  // wherever the spawn left it -- descriptor 3244, `(0, 0, 0)`. The port used
  // to place it from `op_st3` 342 at frame 0, which is in the canal, a
  // hundred-odd units off the shot: a second boat, parked, while the
  // passengers sailed past it. That is what "the boat isn't moving" looked
  // like from the passenger seat.
  console.log("\nthe class-0x26 rig, which is not posed during these shots:");
  for (const s of canal) {
    const m = /obj_48ead0 (unposed )?at (-?[\d.]+), (-?[\d.]+), (-?[\d.]+)/
      .exec(s.rigs ?? "");
    check(`f${s.f}: the rig is at its spawn pose, not on a path`,
          !!m && m[1] === "unposed "
            && Math.hypot(Number(m[2]), Number(m[3]), Number(m[4])) < 1,
          s.rigs ?? "(no row)");
  }

  check("nothing else the page asked for went missing",
        badRequests.length === 0, badRequests.join(" | "));

  // ---- the fade to black, which is fog with no width -------------------

  // Block 11 step 2 tweens `fog_rgb -> (0,0,0)`, `fog_near -> 1` and
  // `fog_far -> 1` over 30 frames and then **waits**, so the pair sits on
  // `near == far` for as long as the step lasts. Under `D3DFOG_LINEAR` that
  // is a zero-width ramp -- everything past it is 100% fog colour, which at
  // that moment is black -- and it is how every stage in the game fades out.
  // The port used to read `far > near` as "fog is on", so at the exact frame
  // the fade completed the screen jumped back to fully lit.
  console.log("\nthe fade to black holds, rather than switching fog off:");
  await page.goto(page.url().replace(/\?.*/, "")
    + "?stage=3&block=11&step=2&mode=play&drive=1",
    { waitUntil: "domcontentloaded" });
  await waitForLoad(page);
  await page.keyboard.press("Space");
  await page.evaluate(() => document.activeElement?.blur?.());

  // **Sample inside the block's own lifetime.** This used to advance 30
  // frames at a time and take whatever it found; once `wait_script_flag`
  // started holding, block 11 ran out and the walker *restarted the stage*
  // and parked on an enemy gate that a harness which never shoots can never
  // open -- so the loop was reading a different part of the game entirely and
  // reported "never reached". A 30-frame stride can also step straight over a
  // fade. 10 frames, and stop at the block boundary.
  // **The assertion is the property, not one frame's value.** It used to
  // require the literal `planar 2..2`, which is the range on one particular
  // frame of the tween: a stride that steps over that frame, or any change to
  // the pacing, fails it while the fade is perfectly correct. Honouring
  // `wait_script_flag` changed the pacing and it failed exactly that way,
  // having watched the range narrow 2584 -> 18 and the colour reach #000001.
  //
  // What the bug was about is the *other* half of this line: `render/fog.ts`
  // had an invented `far > near` on/off test the engine does not have (L27),
  // so the port switched fog **off** on the frame the fade completed and
  // snapped a black screen back to a lit one. So: the range must converge
  // toward zero, and fog must never go off while it does.
  const fogsSeen = [];
  for (let n = 0; n < 180; n++) {
    await page.evaluate(() => window.__hotd2Drive.advance(5));
    const [fog, addr] = await Promise.all([
      row("panel-scene", "fog"),
      page.evaluate(() => window.__hotd2Drive.now().a),
    ]);
    if (fog && fogsSeen[fogsSeen.length - 1] !== fog) fogsSeen.push(fog);
    // The block is over; anything past here is the next scene, or a restart.
    if (!/^11\//.test(addr ?? "")) break;
  }
  const width = (f) => {
    const m = /^planar (-?[\d.]+)\.\.(-?[\d.]+)/.exec(f ?? "");
    return m ? Math.abs(Number(m[2]) - Number(m[1])) : null;
  };
  const widths = fogsSeen.map(width).filter((w) => w !== null);
  const last = widths[widths.length - 1];
  check("the fade narrows the fog range toward zero",
        widths.length >= 3 && last !== undefined && last <= 25
          && last < widths[0] / 10,
        widths.length ? `${widths[0]} -> ${last} over ${widths.length} steps`
                      : "no planar fog rows at all");
  check("...and fog is never switched off while it fades",
        fogsSeen.length > 0 && fogsSeen.every((f) => /^planar /.test(f)),
        fogsSeen.filter((f) => !/^planar /.test(f)).join(" | ")
          || `all ${fogsSeen.length} samples planar`);

  if (flag("shot")) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: resolve(SHOTS, "stage3.png") });
  }
} finally {
  await close();
}

console.log(`\n${ran} checks, ${failures} failed`);
process.exit(failures ? 1 : 0);
