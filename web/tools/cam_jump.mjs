/**
 * The camera, frame by frame, in a real browser: does it ever stall and then
 * jump?
 *
 * Reported against stage 3 as *"the camera seems to jump quite a bit just
 * shortly after `?stage=3&mode=play&block=2&step=4&op=24&frame=1551`"*. The
 * jump was 109 frames later, on the frame `cam_play 1430..1660` reached its
 * end: the eye held still for a frame and then moved 3.6 units where it had
 * been moving 1.25, and the aim flicked 9.6 degrees out and back.
 *
 * `test:camera` is the assertion that catches it and it is the one in
 * `verify_all.py`, because it is exact -- it recomputes the rail from the
 * bundle and compares. This is the other half, and it is here for the reason
 * `stage3.mjs` is here: **it measures the camera a viewer is actually looking
 * through.** The headless check drives the seat, the ease and the draw, but
 * nothing downstream of `applyPose`; this reads the Camera panel's own
 * readouts off the live page, which is `camera.position` and
 * `g_camera_block_target` after the frame was drawn.
 *
 * The two things it asserts, both on that pair and neither on any layer's
 * account of itself:
 *
 * * **no stall.** A frame on which the published camera frame advanced by one
 *   and the eye did not move, with the frames either side of it moving. A path
 *   may legitimately park the eye -- stage 1's slot 32 does at its last frame
 *   -- so a *bracketed* stall is the signature, not a still frame.
 * * **no flick.** An aim that swings and returns to within a quarter of the
 *   swing two frames later. A cut moves and stays moved.
 *
 *     node tools/cam_jump.mjs                       # headed, watch it
 *     node tools/cam_jump.mjs --headless
 *     node tools/cam_jump.mjs --url "?stage=1&mode=play" --n 900
 *
 * Exits 1 on a failed assertion. Needs a bundle and playwright, like
 * `stage3.mjs`, so it is not in `verify_all.py`.
 */
import { openPlayer, waitForLoad } from "./lib/player.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

/** The reported address, with the driven clock added. */
const URLQ = opt("url",
  "?stage=3&mode=play&block=2&step=4&op=24&frame=1551") + "&drive=1";
const N = Number(opt("n", "420"));

/**
 * The eye is printed to one decimal, so anything under this is "did not move".
 * The shots here travel about 1.25 units a frame.
 */
const STILL = 0.05;
/** What the frames either side of a stall have to be doing for it to count. */
const MOVING = 0.5;

let failures = 0;
let ran = 0;
function check(what, ok, detail = "") {
  ran++;
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? `  ${detail}` : ""}`);
}

const { page, close } = await openPlayer({
  url: URLQ,
  size: opt("size", "1280x800"),
  headless: flag("headless"),
  quiet: true,
  // A folded group renders no rows at all -- `ui/panels/Panel.tsx` mounts its
  // children only when open -- and clicking the summary afterwards leaves it
  // focused, so the Space that starts the transport toggles the disclosure
  // instead. Seed the persisted fold before the first render.
  init: () => localStorage.setItem("hod2.ui.panel-camera", "true"),
});

try {
  await waitForLoad(page);
  // Selecting play mode in the URL does not start the clock: `stepOneFrame`
  // tests `this.playing`. Blur first, or Space goes to the control.
  await page.keyboard.press("Space");
  await page.evaluate(() => document.activeElement?.blur?.());

  /** The Camera panel, as a label -> value record, plus the walker address. */
  const read = () => page.evaluate(() => {
    const lines = (document.getElementById("panel-camera")?.innerText ?? "")
      .split("\n");
    const row = {};
    for (let i = 0; i + 1 < lines.length; i += 2) row[lines[i]] = lines[i + 1];
    return { row, at: window.__hotd2Drive.now().a };
  });

  const seen = [];
  for (let i = 0; i < N; i++) {
    seen.push(await read());
    await page.evaluate(() => window.__hotd2Drive.advance(1));
  }

  // The panel writes a minus sign, not a hyphen, for negative numbers.
  const xyz = (t) => (t ?? "").split(",").map((v) => Number(v.replace("−", "-")));
  const frames = seen.map(({ row, at }) => {
    const eye = xyz(row.eye);
    const target = xyz(row["block target"]);
    const d = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
    const L = Math.hypot(d[0], d[1], d[2]) || 1;
    return {
      at,
      slot: row.slot,
      // "1660.0 / 1660" -- the published frame is the left half.
      cf: Number((row.frame ?? "").split("/")[0]),
      eye,
      aim: d.map((v) => v / L),
    };
  });

  const step = (a, b) =>
    Math.hypot(b.eye[0] - a.eye[0], b.eye[1] - a.eye[1], b.eye[2] - a.eye[2]);
  const turn = (a, b) => Math.acos(Math.min(1, Math.max(-1,
    a.aim[0] * b.aim[0] + a.aim[1] * b.aim[1] + a.aim[2] * b.aim[2])))
    * 180 / Math.PI;

  // ---- the stall ---------------------------------------------------------

  const stalls = [];
  let advancing = 0;
  for (let i = 2; i < frames.length - 1; i++) {
    const [a, b, c] = [frames[i - 1], frames[i], frames[i + 1]];
    // Only where the shot itself says it moved on by one frame of its path.
    if (b.slot !== a.slot || b.cf !== a.cf + 1) continue;
    advancing++;
    if (step(a, b) < STILL
        && step(frames[i - 2], a) > MOVING && step(b, c) > MOVING) {
      stalls.push(`i${i} cf=${b.cf} slot=${b.slot} ${b.at}`
        + ` (${step(a, b).toFixed(2)} between ${step(frames[i - 2], a)
          .toFixed(2)} and ${step(b, c).toFixed(2)})`);
    }
  }
  console.log(`\n${URLQ}: ${frames.length} frames`);
  check("no frame holds the eye still while its shot moves on",
        stalls.length === 0, stalls.join(" | "));
  // The rest of the run is the camera parked at a finished shot while
  // `wait_enemies_alive` holds, which is most of a fight and is not what this
  // is about -- so the bar is "enough advancing frames to have crossed the
  // shot boundaries", not a fraction of the run.
  check("...and the camera was advancing along a path to begin with",
        advancing > 100, `${advancing} of ${frames.length}`);

  // ---- the flick ---------------------------------------------------------

  let flicks = 0, worst = 0, at = -1;
  for (let i = 2; i < frames.length; i++) {
    const swing = turn(frames[i - 1], frames[i]);
    const back = turn(frames[i - 2], frames[i]);
    // A degree, not the headless check's twentieth: these numbers come off a
    // three-decimal readout of a unit vector, which is about 0.06 degrees of
    // quantisation, and the flick this exists to catch was ten.
    if (swing > 1 && back < swing * 0.25) {
      flicks++;
      if (swing > worst) { worst = swing; at = i; }
    }
  }
  check("no frame swings the aim out and straight back",
        flicks === 0,
        `${flicks}, worst ${worst.toFixed(2)} deg at frame ${at}`
        + (at >= 0 ? ` (cf ${frames[at].cf}, ${frames[at].at})` : ""));

  // The largest single-frame move, for the record: a cut between two shots is
  // a real one and this does not fail on it.
  let big = 0, bigAt = -1;
  for (let i = 1; i < frames.length; i++) {
    const d = step(frames[i - 1], frames[i]);
    if (d > big) { big = d; bigAt = i; }
  }
  console.log(`  largest single-frame eye move: ${big.toFixed(2)} units`
    + ` at frame ${bigAt} (cf ${frames[bigAt]?.cf}, ${frames[bigAt]?.at})`);
} finally {
  await close();
}

console.log(`\n${ran} checks, ${failures} failed`);
process.exit(failures ? 1 : 0);
