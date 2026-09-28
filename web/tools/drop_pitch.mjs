/**
 * The camera through stage 2 block 5 step 6: two `zsass` leap off the ledge at
 * y = 87 while the stashed rail plays, and the aim has to climb after them.
 *
 * Reported as *"when the two zombies with knives drop down ... the camera
 * doesn't really pitch up much. in the real game, it pitches much more."*
 * The step is
 *
 *     6  spawn_obj            two class 0x31, state 20 (ThrowerStateLeapToPoint)
 *     7  cam_play 44..90      flags 2: CamStashPathRange -- stashed, not played
 *     8  finish_sequence 6    scene state (2,6), driver CameraDriverSelectMode
 *     9  wait_camera_path_frame
 *
 * and under (2,6) nothing writes the camera block from the rail.
 * `CameraStepRailTick` (`FUN_0040C790`) evaluates the path into the deferred
 * pose block (`g_cam_path_eye`, `g_cam_path_target`) and stops there; the
 * block's aim moves only by `TurnLookAtToward` (`FUN_00403C00`) inside
 * `CameraTrackEnemiesTick` (`FUN_00402890`), mode 3 of the driver, so it
 * **accumulates** toward the leaping pair frame after frame. `[proved]`
 *
 * So this asserts the rule rather than a picture: on every frame of op 9 with
 * the pair registered, the block's aim is the exe's turn of the previous
 * frame's aim toward this frame's `g_camera_lookat_target`, at the rate
 * `ComputeLookAtAngleError` (`FUN_00403B00`) left in `g_camera_turn_rate` --
 * recomputed here from the definition, not from the port's routine. A seat
 * that snaps the aim back onto the rail fails it by about two and a half
 * degrees a frame. And, for the human reading the output, that the aim gets
 * at least half way to where the pair is at its highest.
 *
 * Measured on 2026-09-28 (driven clock, `seed=1`): `main` at 98627e9 peaks at
 * 2.66 degrees of pitch against a wanted 44.76 and breaks the rule by up to
 * 2.5 degrees a frame -- `seatCamera` (`app/systems.ts`) re-seats the block's
 * eye and aim from a stashed play, the divergence `game/camera/rail.ts`
 * declares. `fix/camera-faithful` at 13341b0 peaks at 27.96 and follows the
 * rule to 0.005 degrees; merged with `main` at 39a7065, 28.38.
 *
 * **Start before op 6.** The reported address, `op=10&frame=90`, lands after
 * the rail has finished: the seek makes the pair on its first live frame, so
 * they leap under a parked camera and neither branch pitches past 20 there.
 * The engine has no seek; at that address its pair has long since landed.
 *
 *     node tools/drop_pitch.mjs --headless
 *
 * Exits 1 on a failed assertion. Needs a bundle and playwright, like
 * `cam_jump.mjs`, so it is not in `verify_all.py`.
 */
import { openPlayer, waitForLoad } from "./lib/player.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const URLQ = opt("url", "?stage=2&original=1&mode=play&block=5&step=6&op=0")
  + "&drive=1&seed=1";
const N = Number(opt("n", "160"));
/** The walker address of `wait_camera_path_frame`, the rail's whole run. */
const RAIL_AT = "5/6/9";
/** A frame's turn and the recomputed one agree to this, in degrees. */
const TOLERANCE_DEG = 0.05;

/** `ComputeLookAtAngleError`'s curve, `g_camera_turn_rate_curves[1]` (0x00576B44). */
const CURVE1 = [...Array(26).fill(64), 63, 56, 50, 43, 36, 29, 22,
                ...Array(31).fill(16)];
const B = 65536 / (2 * Math.PI);

let failures = 0;
let ran = 0;
function check(what, ok, detail = "") {
  ran++;
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? `  ${detail}` : ""}`);
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
                         a[0] * b[1] - a[1] * b[0]];
/** `VecAngleBetween` (`FUN_00401D70`): atan2(|a x b|, a.b), `__ftol`'d to BAMS. */
const bams = (a, b) => Math.trunc(Math.atan2(Math.hypot(...cross(a, b)), dot(a, b)) * B);
const degBetween = (a, b) =>
  Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b))))) * 180 / Math.PI;
const pitch = (d) => Math.atan2(d[1], Math.hypot(d[0], d[2])) * 180 / Math.PI;

/**
 * `TurnLookAtToward(eye, desired, current, out, 1, rate)`: the current
 * direction turned toward the desired one, in their plane, by
 * `trunc(angle * 1 / (1 + rate))` whole BAMS. Returned as a direction; the
 * exe re-emits it 100 units from the eye, which no angle here depends on.
 */
function turn(eye, desired, current, rate) {
  const u = unit(sub(current, eye));
  const w = sub(desired, eye);
  const angle = bams(u, unit(w));
  if (angle === 0) return u;
  const along = dot(w, u);
  const perp = unit([w[0] - along * u[0], w[1] - along * u[1], w[2] - along * u[2]]);
  const a = Math.trunc(angle / (1 + rate)) / B;
  return [0, 1, 2].map((i) => Math.cos(a) * u[i] + Math.sin(a) * perp[i]);
}

const { page, close } = await openPlayer({
  url: URLQ, size: opt("size", "1280x800"), headless: flag("headless"),
  quiet: true,
});

try {
  await waitForLoad(page);
  await page.evaluate(async () => {
    const { G } = await import("/src/game/globals.ts");
    window.__dropG = G;
  });
  // The URL does not start the clock; blur first, or Space goes to a control.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press("Space");

  const read = () => page.evaluate(() => {
    const G = window.__dropG;
    const v = (p) => [p.x, p.y, p.z];
    // `g_enemy_slots` is a list of `at` on one side of the camera rewrite and
    // sixteen `{occupied, at}` on the other; count what holds an actor.
    const held = G.g_enemy_slots
      .filter((s) => typeof s === "number" || s.occupied).length;
    return {
      at: window.__hotd2Drive.now().a,
      fc: G.g_frame_counter,
      eye: v(G.g_camera_block_eye), aim: v(G.g_camera_block_target),
      want: v(G.g_camera_lookat_target),
      rate: G.g_camera_turn_rate, tracking: G.g_camera_is_tracking, held,
    };
  });

  const seen = [];
  for (let i = 0; i < N; i++) {
    seen.push(await read());
    await page.evaluate(() => window.__hotd2Drive.advance(1));
  }

  console.log(`\n${URLQ}: ${seen.length} frames, `
    + `${seen[0].at} fc ${seen[0].fc} -> ${seen.at(-1).at} fc ${seen.at(-1).fc}`);
  check("the game ran: the frame counter moved by one a driven frame",
        seen.at(-1).fc - seen[0].fc === N - 1,
        `${seen.at(-1).fc - seen[0].fc} for ${N - 1}`);

  const rail = seen.filter((r) => r.at === RAIL_AT);
  const registered = rail.filter((r) => r.held >= 2 && r.tracking === 1);
  check(`the rail ran with the pair registered (${RAIL_AT})`,
        registered.length >= 20,
        `${registered.length} of ${rail.length} rail frames`);

  let pairs = 0, worst = 0, worstAt = -1;
  for (let i = 1; i < seen.length; i++) {
    const p = seen[i - 1], q = seen[i];
    if (q.at !== RAIL_AT || p.at !== RAIL_AT || q.fc !== p.fc + 1) continue;
    if (p.tracking !== 1 || q.tracking !== 1) continue;
    const predicted = turn(q.eye, q.want, p.aim, p.rate);
    const off = degBetween(predicted, sub(q.aim, q.eye));
    pairs++;
    if (off > worst) { worst = off; worstAt = q.fc; }
  }
  check("on every rail frame the aim moved only by TurnLookAtToward",
        pairs >= 20 && worst <= TOLERANCE_DEG,
        `${pairs} frames, worst ${worst.toFixed(3)} deg at fc ${worstAt}`);

  const peak = Math.max(...seen.map((r) => pitch(sub(r.aim, r.eye))));
  const wanted = Math.max(...registered.map((r) => pitch(sub(r.want, r.eye))));
  check("...so it climbs at least half way to the pair at their highest",
        peak >= wanted / 2,
        `peak pitch ${peak.toFixed(2)} deg, wanted ${wanted.toFixed(2)}`);
} finally {
  await close();
}

console.log(`\n${ran} checks, ${failures} failed`);
process.exit(failures ? 1 : 0);
