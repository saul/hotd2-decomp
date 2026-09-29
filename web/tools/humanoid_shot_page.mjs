/**
 * A scripted humanoid cannot be shot, in the real page.
 *
 * `?stage=2&block=16&step=15&op=0` spawns four class-0x25 humanoids at the
 * jetty. Two are zombies (`0xAA40` and `0xAADC`, character type 15) that
 * hold on the jetty until camera path 79 reaches frame 100, then fall back
 * into the canal; the gun is live until op 8 closes the shutter. Class 0x25
 * calls `RegisterForShotTest` nowhere, so in the exe no bullet touches them
 * (`game/class25/index.ts`'s handler). Of the class's spawns only these two
 * and block 20's pair leave bit `0x8000` clear in their record, so they are
 * the ones the render pick could find -- and it did, through the corner of
 * the building they stand behind.
 *
 * Each frame this projects a point on the first zombie's body through the
 * camera the trigger casts through (see `read`), pulls there once (L50),
 * advances one frame and reads both zombies back out of the page's own `G`
 * (L44). They must stay alive, unhurt and unreacting. A pull that could not
 * have reached them is no evidence, so it also requires that the pulls fired
 * live rounds (`g_player_shot_count` counts only a pull the gate let
 * through) and that every aim point was on the canvas and in front of the
 * lens, and it prints how many pulls found anything at all
 * (`g_shot_hit_something`).
 *
 * Driven on one seed, the run is the same every time, and it is the run in
 * which, before the fix, the **first** pull (`16/15/4` f47) found `0xAA40`:
 * dead, hit points 0 to -20, death clip 991, and ninety points to player 1.
 * After it, sixty pulls find nothing. The projection was checked against the
 * page's own (`DriveTarget.projectWorld`, through `shotTargets`) to three
 * places. An aim that took the canvas for 4:3 -- it is 920 by 800 here, not
 * pillarboxed -- fell short of the zombie toward the centre, and passed this
 * check on the unfixed port; that is why the pulls that found something are
 * counted and printed.
 *
 *   node tools/humanoid_shot_page.mjs --headless
 */
import { join } from "node:path";
import { openPlayer, pull, requireBundle, waitForLoad, SHOTS }
  from "./lib/player.mjs";

requireBundle("humanoid_shot_page");

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const ADDRESS = "stage=2&block=16&step=15&op=0";
/** The two jetty zombies, `spawn_obj` at `16/15/0`, flags word `0`. */
const ZOMBIES = [43584, 43740];
/** Pulls, one a frame, once the zombie is in shot. */
const PULLS = 60;
/** Frames to wait for it to come into shot. */
const WAIT = 150;

const { page, close } = await openPlayer({
  url: `?${ADDRESS}&drive=1&seed=1`,
  size: "1280x800", headless: flag("headless"), quiet: !flag("loud"),
});

const failures = [];
const check = (ok, what, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(what);
};
const advance = (n) =>
  page.evaluate((k) => globalThis.__hotd2Drive.advance(k), n);

/**
 * Both zombies, the shot counter, and where aim point `k` on the first one is
 * on the page -- through `g_camera_view_to_world` (or block 2's, as
 * `render/camera.ts` reads it), the 41.1-degree camera `app/main.ts` builds
 * and the canvas the trigger measures against, whose own rectangle is the
 * camera's aspect (4:3 only when the page pillarboxes).
 *
 * At 300 units a bone sphere is a few pixels across, so the aim walks a
 * lattice over the body rather than one point: ten heights from the root
 * (`Actor.pos`) up to the tracked bone (`Actor.lookAt`, which the director
 * records for every visible skinned actor), each at three offsets along the
 * camera's right axis.
 */
const read = (k = 0) => page.evaluate(async ([ats, k]) => {
  const { G } = await import("/src/game/globals.ts");
  const now = globalThis.__hotd2Drive.now();
  const zs = ats.map((at) => {
    const o = G.g_object_list.find((x) => x.at === at);
    if (!o) return { at, absent: true };
    return {
      at, cls: o.cls, name: o.name, dead: o.dead, visible: o.visible,
      hp: o.hp, death: o.death ?? null, react: o.react ?? null,
      flags: o.flags, hitSlot: o.hitSlot,
      pos: { x: o.pos.x, y: o.pos.y, z: o.pos.z },
      look: { x: o.lookAt.x, y: o.lookAt.y, z: o.lookAt.z },
    };
  });
  const m = G.g_camera_index === 2 ? G.g_camera_block2_view_to_world
    : G.g_camera_view_to_world;
  const r = document.querySelector("#viewport canvas").getBoundingClientRect();
  let screen = null;
  const z0 = zs[0];
  if (!z0.absent) {
    // A rigid view-to-world matrix, column-major: its inverse is the
    // transpose of the turn applied to the offset from the eye.
    const up = ((k % 10) + 1) / 10;
    const side = (Math.floor(k / 10) % 3 - 1) * 1.5;
    const aim = [0, 1, 2].map((i) => {
      const a = ["x", "y", "z"][i];
      return z0.pos[a] + (z0.look[a] - z0.pos[a]) * up + m[i] * side;
    });
    const d = [aim[0] - m[12], aim[1] - m[13], aim[2] - m[14]];
    const col = (c) => d[0] * m[4 * c] + d[1] * m[4 * c + 1] + d[2] * m[4 * c + 2];
    const qx = col(0), qy = col(1), qz = col(2);
    const t = Math.tan((41.1 * Math.PI) / 360);
    const nx = qx / -qz / (t * (r.width / r.height));
    const ny = qy / -qz / t;
    screen = { x: r.left + (nx + 1) / 2 * r.width,
               y: r.top + (1 - ny) / 2 * r.height,
               inFront: qz < 0, onCanvas: Math.abs(nx) < 1 && Math.abs(ny) < 1 };
  }
  return { address: now.a, frame: now.f, zs, screen,
           path: G.g_active_cam_path, pathFrame: G.g_cam_path_frame,
           shots: G.g_player_shot_count[0], score: G.g_player_score[0],
           gate: G.g_nFiringGate, hitSomething: G.g_shot_hit_something[0] };
}, [ZOMBIES, k]);

const hurtOf = (z, first) => !z.absent && (z.dead || z.hp !== first.hp
  || z.death !== null || z.react !== null);

let code = 1;
try {
  await waitForLoad(page);
  if (await page.evaluate(() => globalThis.__hotd2Drive?.version ?? null)
      === null) {
    throw new Error("no drive seam -- is ?drive=1 wired up?");
  }
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press("Space");
  await advance(1);
  const first = await read();
  console.log(`\n?${ADDRESS}, landed at ${first.address} f${first.frame}`);
  check(first.zs.every((z) => !z.absent && z.cls === 0x25 && z.visible
                       && !z.dead && (z.flags & 0x8000) === 0),
        "both jetty zombies are placed, drawn and alive: class 0x25, spawn "
        + "flags without 0x8000",
        first.zs.map((z) => z.absent ? `${z.at} absent`
          : `${z.at} cls 0x${z.cls.toString(16)} ${z.name} visible `
            + `${z.visible} flags 0x${z.flags.toString(16)}`).join("; "));

  // Path 79 opens looking down the alley; the jetty swings into the right
  // of the frame about seventy frames in. Wait for it without pulling.
  let s = first;
  let waited = 0;
  while (!(s.screen?.inFront && s.screen.onCanvas) && waited < WAIT) {
    await advance(1);
    waited += 1;
    s = await read();
  }
  console.log(`  the zombie is in shot at ${s.address} f${s.frame}, path `
    + `${s.path} frame ${s.pathFrame}, after ${waited} frames`);
  check(s.gate !== 0, "the firing gate is up", `g_nFiringGate ${s.gate}`);
  await page.screenshot({ path: join(SHOTS, "humanoid-shot-before.png") });

  let pulls = 0;
  let offscreen = 0;
  let hurt = null;
  let found = 0;
  const shotsBefore = s.shots;
  for (let i = 0; i < PULLS && !hurt; i++) {
    if (!s.screen?.inFront || !s.screen.onCanvas) offscreen += 1;
    else {
      await pull(page, s.screen.x, s.screen.y);
      pulls += 1;
    }
    await advance(1);
    s = await read(i + 1);
    if (s.hitSomething) found += 1;
    for (let k = 0; k < ZOMBIES.length && !hurt; k++) {
      if (hurtOf(s.zs[k], first.zs[k])) hurt = { ...s.zs[k], i, s };
    }
  }
  await page.screenshot({ path: join(SHOTS, "humanoid-shot-after.png") });
  const fired = s.shots - shotsBefore;
  check(offscreen === 0,
        "every aim point on the first zombie was on the canvas, in front of "
        + "the lens", `${offscreen} frames off it`);
  check(fired > 0 && fired >= pulls - 1,
        "the pulls were live: the gate let them through as rounds",
        `${fired} rounds for ${pulls} pulls`);
  check(hurt === null,
        "no pull touched either zombie: alive, hit points as spawned, no "
        + "reaction and no death clip",
        hurt ? `${hurt.at} after pull ${hurt.i + 1} at ${hurt.s.address} `
          + `f${hurt.s.frame}: dead ${hurt.dead} hp ${hurt.hp} death `
          + `${JSON.stringify(hurt.death)} react ${JSON.stringify(hurt.react)} `
          + `score ${first.score} -> ${hurt.s.score}`
          : `${pulls} pulls, ${found} of them found something, ending at ${s.address} f${s.frame}`);
  code = failures.length ? 1 : 0;
  console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
} finally {
  await close();
}
process.exit(code);
