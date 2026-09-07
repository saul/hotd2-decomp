/**
 * The camera's two halves run together, or not at all.
 *
 * A camera frame is two systems either side of the game phase:
 * `CameraSeatSystem` writes the block from the rail, and
 * `CameraTrackEnemiesTick` — inside `GameSystem` — eases that block's aim onto
 * whatever the fight wants. `render/camera.ts` says so at the top, and has
 * since it was written.
 *
 * What nothing checked is that they actually run **together**. `Player.frame`
 * draws once per `requestAnimationFrame` and ticks at a fixed 60 Hz, so on a
 * display faster than that most frames owe no tick and take the `tickStopped`
 * path — which runs the whole tick order with `Loop.idle`. The seat had no
 * guard, `GameSystem` did, and the frame that resulted was half a camera
 * frame: the block back on the rail, the ease skipped, and that drawn. One
 * frame eased, the next on the rail, at the refresh rate.
 *
 * It is invisible at 60 Hz, which is the whole reason it needs a test: the
 * measurement below puts it at 785 flicker frames in 1200 on a 120 Hz panel
 * and **zero** on a 60 Hz one.
 *
 * So this drives the real `Loop`, the real `Walker`, the real `CameraRig` and
 * the real `CameraTrackEnemiesTick` against the shipped stage 1 bundle, at two
 * refresh rates, and asserts the property the bug broke: **what is drawn is a
 * function of game frames, not of how often the browser drew.**
 *
 * Run with `npm run test:camera`. Skips cleanly when no bundle is built.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PerspectiveCamera, Scene, Vector3 } from "three";
import { Walker, type WalkerHost } from "../src/script/walker";
import { CamPaths } from "../src/game/camera/curve";
import { CameraDrawSystem, CameraRig } from "../src/render/camera";
import { CameraSeatSystem } from "../src/app/systems";
import { G, ResetGameGlobals } from "../src/game/globals";
import { SetGameTables } from "../src/game/tables";
import { ActorSpawn, GameUpdate } from "../src/game/director";
import { SpawnClass } from "../src/game/spawn_class";
import { NULL_HOST } from "../src/game/host";
import { syncPortGlobals } from "../src/app/systems";
import { Loop, TICK } from "../src/app/loop";
import { Rng } from "../src/core/rng";
import { Events } from "../src/core/events";
import { CameraFrame } from "../src/core/camera";
import type { Tick } from "../src/core/system";
import type { CamJson, ScriptJson } from "../src/bundle";
import { BUNDLE_ROOT, skipNoBundle } from "../tools/lib/bundle_root";

const ROOT = BUNDLE_ROOT;

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok    ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
}

const dir = join(ROOT, "stage1");
const scriptPath = join(dir, "stage1.script.json");
if (!existsSync(scriptPath)) skipNoBundle("camera");
const script = JSON.parse(readFileSync(scriptPath, "utf8")) as ScriptJson;
const camJson = JSON.parse(
  readFileSync(join(dir, "stage1.cam.json"), "utf8")) as CamJson;

/** Records nothing: the drawn camera is what is compared. */
const mkHost = (): WalkerHost => ({
  enterRegion: () => undefined,
  loadSlot: () => undefined, unloadSlot: () => undefined,
  startCamera: () => undefined,
  onFeed: () => undefined, onBranch: () => undefined,
  playSound: () => undefined, aliveEnemies: () => null,
  presentEnemies: () => null,
  aliveCivilians: () => null, cameraFree: () => null,
  scriptFlagRaised: () => null,
  showMessage: () => null, endDialogue: () => undefined,
});

const DRIVEN: Tick = { dt: TICK, frames: 1, wall: TICK, frozen: false };

/** One drawn frame's camera: the forward vector, which is what you see. */
type Fwd = [number, number, number];

interface Run {
  /** One entry per *drawn* frame. */
  drawn: Fwd[];
  /** Ticks that frame owed. Zero is the `tickStopped` path. */
  ran: number[];
  ticks: number;
  idles: number;
  at: string;
}

/**
 * `Player.frame`, at a given display rate.
 *
 * `spawnAt` registers one enemy for the camera to track. Without one
 * `SelectCameraLookAtTarget` writes the path's own target, the ease is a
 * no-op, and the two halves cannot be told apart — which is exactly why the
 * bug survived: the flicker only shows once the camera *wants* to look
 * somewhere the rail does not.
 */
function play(hz: number, rafs: number, spawnAt: number): Run {
  ResetGameGlobals();
  SetGameTables(script.characters, script.breakables, script.set_pieces,
                script.humanoids, script.coli, script.civilians);
  const w = new Walker(script, mkHost());
  const rig = new CameraRig();
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 10000);
  const ctx = {
    scene: new Scene(), camera, view: new CameraFrame(), events: new Events(),
    rng: new Rng(1), walker: w, paths: new CamPaths(camJson),
    scope: null, session: null, stage: 1, frame: 0,
  } as unknown as Parameters<CameraRig["draw"]>[0];

  // The three systems `app/main.ts` registers, in the order it registers
  // them: seat in `script`, `GameSystem` in `game`, draw first in `render`.
  const seat = new CameraSeatSystem(rig);
  const draw = new CameraDrawSystem(rig);
  const world = (t: Tick): void => {
    seat.update(ctx, t);
    if (!t.frozen && t.dt > 0) {
      const e = camera.position;
      GameUpdate({ x: e.x, y: e.y, z: e.z }, t.dt, NULL_HOST, ctx.rng,
                 ctx.events);
    }
    draw.update(ctx);
  };

  const loop = new Loop();
  loop.running = true;
  loop.start(0);
  const wall = 1 / hz;
  const out: Run = { drawn: [], ran: [], ticks: 0, idles: 0, at: "" };
  const fwd = new Vector3();

  for (let i = 0; i < rafs; i++) {
    if (i === spawnAt) {
      const z = ActorSpawn(0x7000, SpawnClass.Zombie, 10, "camera probe");
      if (z) {
        // Off to one side of where the rail is pointing, so the ease has
        // somewhere to go.
        const e = G.g_camera_block_eye, t = G.g_camera_block_target;
        z.pos.x = t.x + (t.z - e.z) * 0.06;
        z.pos.y = t.y;
        z.pos.z = t.z - (t.x - e.x) * 0.06;
        z.visible = true;
        z.dead = false;
      }
    }
    const ran = loop.advance(wall, () => {
      if (!w.finished && !w.branch) w.tick(TICK);
      syncPortGlobals(w, false, camera.position);
      world(DRIVEN);
      return !w.finished;
    }).frames;
    out.ticks += ran;
    if (ran === 0) {
      // `Player.tickStopped`: the whole order, on a tick with no time in it.
      out.idles += 1;
      syncPortGlobals(w, false, camera.position);
      world(loop.idle(wall));
    }
    if (w.finished) break;
    camera.getWorldDirection(fwd);
    out.drawn.push([fwd.x, fwd.y, fwd.z]);
    out.ran.push(ran);
  }
  out.at = `${w.block}/${w.step}/${w.opIndex}`;
  return out;
}

const deg = (a: Fwd, b: Fwd): number =>
  Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])))
  * 180 / Math.PI;

/**
 * Frames where the aim swung and came straight back.
 *
 * A pan moves and stays moved; a flicker moves and returns to where it was
 * two frames ago. The threshold is a twentieth of a degree, which is far
 * below anything the shipped paths do in one frame and far above float noise.
 */
function flickers(drawn: Fwd[]): { n: number; worst: number; at: number } {
  let n = 0, worst = 0, at = -1;
  for (let i = 2; i < drawn.length; i++) {
    const swing = deg(drawn[i - 1], drawn[i]);
    const back = deg(drawn[i - 2], drawn[i]);
    if (swing > 0.05 && back < swing * 0.25) {
      n++;
      if (swing > worst) { worst = swing; at = i; }
    }
  }
  return { n, worst, at };
}

console.log("\ncamera: one drawn pose per game frame, whatever the display");

// 1200 rAFs at 120 Hz and 600 at 60 Hz are the same 600 game frames.
const fast = play(120, 1200, 200);
const slow = play(60, 600, 100);

{
  const f = flickers(fast.drawn);
  check("a 120 Hz display draws no frame that swings and comes straight back",
        f.n === 0,
        `${f.n} of ${fast.drawn.length}, worst ${f.worst.toFixed(2)} deg`
        + ` at frame ${f.at}`);
  check("...and it really did draw more frames than it ticked",
        fast.idles > 0 && fast.ticks > 0,
        `${fast.ticks} ticks, ${fast.idles} idle`);
}

{
  const f = flickers(slow.drawn);
  check("a 60 Hz display draws none either, and owes every frame a tick",
        f.n === 0 && slow.idles === 0,
        `${f.n} flickers, ${slow.idles} idle`);
}

{
  // The property, stated directly: a frame that owes no tick has nothing new
  // to show, so it must draw the pose the last tick left. Anything else is
  // half a camera frame on screen.
  let moved = 0, worst = 0;
  for (let i = 1; i < fast.drawn.length; i++) {
    if (fast.ran[i] !== 0) continue;
    // A thousandth of a degree. `getWorldDirection` recomposes the matrix
    // and `acos` of a dot product at 1 carries a few 1e-8 of noise; the
    // flicker this exists to catch was four *tenths* of a degree at its
    // quietest and ten degrees at its worst.
    const d = deg(fast.drawn[i - 1], fast.drawn[i]);
    if (d > 1e-3) { moved++; worst = Math.max(worst, d); }
  }
  check("a frame that owes no tick draws the pose the last tick left",
        moved === 0,
        `${moved} of ${fast.idles} idle frames moved, worst`
        + ` ${worst.toFixed(3)} deg`);

  // Both runs advanced the same 600 game frames; the fast one simply drew
  // twice as often, so it must end in the same place.
  const a = fast.drawn[fast.drawn.length - 1];
  const b = slow.drawn[slow.drawn.length - 1];
  check("and the same game frames leave the same pose and address",
        fast.ticks === slow.ticks && deg(a, b) < 1e-6 && fast.at === slow.at,
        `${fast.ticks} vs ${slow.ticks} ticks, ${deg(a, b).toFixed(4)} deg,`
        + ` ${fast.at} vs ${slow.at}`);
}

{
  // The guard against "fixing" it by never seating at all: the camera still
  // has to move. Stage 1's opening shots pan a long way.
  let travel = 0;
  for (let i = 1; i < slow.drawn.length; i++) {
    travel += deg(slow.drawn[i - 1], slow.drawn[i]);
  }
  check("the camera still moves", travel > 90, `${travel.toFixed(1)} deg`);
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
