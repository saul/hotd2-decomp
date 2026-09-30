/**
 * The stage-5 boss's fight, in the page: arrive, fight, hurt and be hurt,
 * die, and the script on to the block's end.
 *
 *     node tools/boss5_page.mjs --headless
 *     node tools/boss5_page.mjs --headless --shots      # and the screenshots
 *     node tools/boss5_page.mjs --headless --shoot 6 --frames 12000
 *
 * `tools/boss5_fight.mjs` plays the same fight headless in node, with the
 * shots written onto the actor. This one is the player: `?drive=1` at stage
 * 5 block 7 step 1, the page's own walker, render and shot test, and the
 * shots are **pulls** -- the mouse clicked where one of the four bones
 * `Class32ChargeShotBone` (`FUN_0047CE10`) charges is on the canvas, through
 * `g_camera_view_to_world` and the page's 41.1-degree camera, as
 * `tools/humanoid_shot_page.mjs` aims. A projectile is aimed at through
 * `shotTargets`. Every other attack round is let through, so the
 * projectiles and the lunge reach the player; the players cannot lose
 * (`g_player_no_damage`), and a strike is counted where
 * `PlayerTakeDamage` re-opens the invulnerability window.
 *
 * ## How it is fast
 *
 * The page runs one driven rAF per `advance`, and a rAF is a vsync: this
 * check used to book two frames at a time through the fight, fifteen outside
 * it, and read the state back after each, which was 2,500 vsyncs and 5,000
 * round trips -- a minute alone and ten under a loaded verify. Now it books
 * the whole remaining run each time with a **stop condition**
 * (`app/harness.ts`'s `advance(n, until)`), and the condition is this
 * check's watcher, in the page, asked after **every** frame:
 *
 * * it records what the fight did on every frame rather than on every
 *   second or fifteenth, so no state, phase or strike can fall between two
 *   samples;
 * * it stops the pump on the frame a pull is due -- the aim on a bone, the
 *   gun's gate up, the boss not shot-immune -- or a projectile is on the
 *   screen to be shot, and node then makes the pull with real pointer events;
 * * it stops on the frame each thing to be drawn first appears -- every task
 *   routine, the lit nodes, the hit flash -- so the render draws that frame,
 *   and what is asserted as drawn is read back *after* the render it reached.
 *
 * So the vsyncs are the pulls, and the pulls are the ones that can hurt it.
 *
 * Screenshots (`--shots`): `web/shots/boss5-<moment>.png` -- the banner, the
 * fight, a volley in flight, the lunge with its afterimages and hands, the
 * final barrage's body loop, the hit flash, the death bursts and the exit
 * effect, each on the frame the moment happens. Look at them: the checks
 * below say the moments happened, not what they looked like. The verify
 * run takes none.
 */
import { join } from "node:path";
import { openPlayer, pull, requireBundle, SHOTS, waitForLoad }
  from "./lib/player.mjs";

requireBundle("boss5_page");

const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const flag = (n) => args.includes(`--${n}`);
const FRAMES = Number(opt("frames", "12000"));
const SHOOT = Number(opt("shoot", "6"));
const SHOTS_ON = flag("shots");
const URL = "?stage=5&block=7&step=1&op=0&drive=1&seed=1";

const failures = [];
const check = (ok, what, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(what);
};

const t0 = performance.now();
const { page, state, close } = await openPlayer({
  url: URL, size: opt("size", "1280x800"), headless: flag("headless"),
  quiet: !flag("loud"), debug: false,
});

/**
 * The watcher, installed in the page as `globalThis.__boss5`: `step` is the
 * stop condition (one call per driven frame), `boundary` reads what the
 * render just drew, `report` hands everything back.
 */
const install = (cfg) => page.evaluate(async (cfg) => {
  const { G } = await import("/src/game/globals.ts");
  const drive = globalThis.__hotd2Drive;
  /** The four bones `Class32ChargeShotBone` charges. */
  const DAMAGE_BONES = [4, 6, 11, 13];
  const S = { Death: 2, Cast: 7, Lunge: 9, Barrage: 10 };
  const T = { Afterimage: 0, BodyLoop: 1, Hands: 2, Burst: 4, Exit: 5 };
  /** `ActorFlag.ShotImmune`: a pull then only sparks. */
  const SHOT_IMMUNE = 0x100;
  const start = drive.frames();
  const r = document.querySelector("#viewport canvas").getBoundingClientRect();
  const toPage = (nx, ny) => ({ x: r.left + (nx + 1) / 2 * r.width,
                                y: r.top + (1 - ny) / 2 * r.height });
  /** A world point through the camera the trigger casts through. */
  const project = (p) => {
    const m = G.g_camera_index === 2 ? G.g_camera_block2_view_to_world
      : G.g_camera_view_to_world;
    const d = [p[0] - m[12], p[1] - m[13], p[2] - m[14]];
    const col = (c) => d[0] * m[4 * c] + d[1] * m[4 * c + 1]
      + d[2] * m[4 * c + 2];
    const qx = col(0), qy = col(1), qz = col(2);
    const t = Math.tan((41.1 * Math.PI) / 360);
    const nx = qx / -qz / (t * (r.width / r.height));
    const ny = qy / -qz / t;
    return { ...toPage(nx, ny),
             ok: qz < 0 && Math.abs(nx) < 0.95 && Math.abs(ny) < 0.95 };
  };
  const findBoss = () => G.g_object_list.find((o) => o.cls === 0x32
    && !o.despawned && o.boss5.routine === 0) ?? null;
  const drawing = () => {
    const tasks = {};
    for (const t of G.g_class32_tasks) {
      if (t.draw) tasks[t.routine] = (tasks[t.routine] ?? 0) + 1;
    }
    return tasks;
  };
  const nodeDraws = (b) => Object.values(b.boss5.nodeDraws).flat();

  const seen = {
    boss: false, banner: -1, fight: -1, dead: -1, flag30: -1, despawn: -1,
    gate: -1, end: -1, states: [], phases: [], minHp: null, firstHp: null,
    strikes: 0, projectiles: [], tasks: {}, lit: 0, flashes: 0,
    // What the render drew: read after the rAF a stop handed it.
    drawn: { tasks: {}, lit: 0, flash: 0, boss: 0 },
    address: "-",
  };
  const states = new Set();
  const phases = new Set();
  const projectiles = new Set();
  /** Kinds seen once already, so a first sighting stops the pump once. */
  const firsts = new Set();
  const moments = new Set();
  let rounds = 0, roundState = -1, prevInvuln = 0;
  let lastBossPull = -Infinity, lastProjectilePull = -Infinity, bossPulls = 0;
  let due = null;

  const firstTime = (k) => {
    if (firsts.has(k)) return false;
    firsts.add(k);
    return true;
  };

  /** One frame's worth of watching. True stops the pump on this frame. */
  const step = () => {
    const f = drive.frames() - start;
    const b = findBoss();
    const tasks = drawing();
    let stop = false;
    if (b) {
      seen.boss = true;
      states.add(b.state);
      phases.add(b.boss5.phase);
      seen.firstHp ??= b.hp;
      seen.minHp = Math.min(seen.minHp ?? b.hp, b.hp);
      const lit = nodeDraws(b).filter((d) => d.light !== null).length;
      if (lit) seen.lit += 1;
      if (b.boss5.flash > 0) seen.flashes += 1;
      if (b.motionFlags & 1 && firstTime("drawn")) stop = true;
      if (lit && firstTime("lit")) stop = true;
      if (b.boss5.flash > 0 && firstTime("flash")) stop = true;
      if ((b.state === S.Cast || b.state === S.Lunge) && b.state !== roundState) {
        rounds += 1;
        roundState = b.state;
      } else if (b.state !== S.Cast && b.state !== S.Lunge) {
        roundState = -1;
      }
    }
    for (const o of G.g_object_list) {
      if (o.cls === 0x32 && !o.despawned && o.boss5.routine === 1) {
        projectiles.add(o.at);
      }
    }
    for (const [k, n] of Object.entries(tasks)) {
      seen.tasks[k] = (seen.tasks[k] ?? 0) + n;
      if (firstTime(`task${k}`)) stop = true;
    }
    const invuln = G.g_player_invuln_frames[0];
    if (invuln > prevInvuln) seen.strikes += 1;
    prevInvuln = invuln;
    const flags = [22, 23, 30].map((i) => G.g_script_flags[i] ?? 0);
    if (seen.banner < 0 && flags[0]) seen.banner = f;
    if (seen.fight < 0 && flags[1]) seen.fight = f;
    if (seen.flag30 < 0 && flags[2]) seen.flag30 = f;
    if (seen.despawn < 0 && seen.boss && !b) seen.despawn = f;
    if (seen.dead < 0 && b && b.hp <= 0) seen.dead = f;
    if (seen.flag30 >= 0) {
      // The walker's address, which only the harness's row carries -- and
      // only from flag 30 on, where it is the question.
      seen.address = drive.now().a;
      const [blk, at, op] = seen.address.split("/").map((x) => Number(x));
      if (seen.gate < 0 && (blk !== 7 || at === 5)) seen.gate = f;
      // Step 5's last instructions, as `tools/boss5_fight.mjs` reads them.
      if (seen.gate >= 0 && (blk !== 7 || op >= 40)) {
        seen.end = f;
        return true;
      }
    }

    // The moments, for the screenshots, each on the frame it happens.
    if (cfg.shots) {
      const moment = (name, when) => {
        if (!when || moments.has(name)) return;
        moments.add(name);
        due = { ...due, moments: [...due?.moments ?? [], name] };
        stop = true;
      };
      const drawnProjectiles = G.g_object_list.filter((o) => o.cls === 0x32
        && !o.despawned && o.boss5.routine === 1 && o.boss5.draw).length;
      moment("banner", seen.banner >= 0 && f >= seen.banner + 90);
      moment("fight", seen.fight >= 0 && f >= seen.fight + 30);
      moment("volley", drawnProjectiles >= 3);
      moment("lunge", b?.state === S.Lunge && (tasks[T.Afterimage] ?? 0) >= 3);
      moment("hands", (tasks[T.Hands] ?? 0) > 0);
      moment("barrage", b?.state === S.Barrage
        && (tasks[T.BodyLoop] ?? 0) > 0 && nodeDraws(b).some((d) => d.light));
      moment("flash", b !== null && b.boss5.flash > 0 && b.boss5.flash % 2 === 1
        && b.state !== S.Death);
      moment("burst", (tasks[T.Burst] ?? 0) >= 3);
      moment("exit", (tasks[T.Exit] ?? 0) > 0 && !((b?.motionFlags ?? 0) & 1));
    }

    // The trigger: a damaging bone every `shoot` frames while it can be
    // hurt, and a projectile every fourth -- except in every other attack
    // round, which is let through to the player.
    if (!G.g_nFiringGate) return stop;
    const holdFire = b && rounds % 2 === 1
      && (b.state === S.Cast || b.state === S.Lunge || b.boss5.liveProjectiles > 0);
    if (b && flags[1] && b.hp > 0 && !holdFire && !(b.flags & SHOT_IMMUNE)
        && f - lastBossPull >= cfg.shoot) {
      const bone = DAMAGE_BONES[bossPulls % DAMAGE_BONES.length];
      const hit = b.skel?.bones[bone]?.hit;
      const aim = hit ? project(hit) : null;
      if (aim?.ok) {
        lastBossPull = f;
        bossPulls += 1;
        due = { ...due, pull: { x: aim.x, y: aim.y, boss: true } };
        return true;
      }
    }
    if (f - lastProjectilePull >= 4 && b?.boss5.liveProjectiles > 0) {
      const t = drive.shotTargets().find((s) => s.cls === 0x32
        && s.at !== b.at && s.z < 1 && Math.abs(s.x) < 0.95
        && Math.abs(s.y) < 0.95 && (s.at & 3) === 0);
      if (t) {
        lastProjectilePull = f;
        due = { ...due, pull: { ...toPage(t.x, t.y), boss: false } };
        return true;
      }
    }
    return stop;
  };

  /** What the rAF that ran the stop frame drew. */
  const boundary = () => {
    const b = findBoss();
    for (const [k, n] of Object.entries(drawing())) {
      seen.drawn.tasks[k] = (seen.drawn.tasks[k] ?? 0) + n;
    }
    if (b) {
      if (b.motionFlags & 1) seen.drawn.boss += 1;
      if (nodeDraws(b).some((d) => d.light !== null)) seen.drawn.lit += 1;
      if (b.boss5.flash > 0) seen.drawn.flash += 1;
    }
  };

  globalThis.__boss5 = {
    /** Run until something is due or `max` frames; say what. */
    async run(max) {
      due = null;
      await drive.advance(max, step);
      boundary();
      return { due, frame: drive.frames() - start, end: seen.end >= 0 };
    },
    report() {
      return { ...seen, states: [...states], phases: [...phases],
               projectiles: projectiles.size, frames: drive.frames() - start };
    },
  };
}, cfg);

let code = 1;
const time = { open: (performance.now() - t0) / 1000, load: 0, fight: 0,
               stops: 0, pulls: 0, projectilePulls: 0, shots: 0 };
try {
  let t = performance.now();
  await waitForLoad(page);
  time.load = (performance.now() - t) / 1000;
  if (await page.evaluate(() => globalThis.__hotd2Drive?.version ?? null)
      === null) {
    throw new Error("no drive seam -- is ?drive=1 wired up?");
  }
  await page.evaluate(async () => {
    const { G } = await import("/src/game/globals.ts");
    G.g_player_no_damage = [1, 1];
  });
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press("Space");
  await page.evaluate(() => globalThis.__hotd2Drive.advance(1));
  const landed = await page.evaluate(() => globalThis.__hotd2Drive.now().a);
  console.log(`\n${URL}: landed at ${landed}`);
  await install({ shoot: SHOOT, shots: SHOTS_ON });

  t = performance.now();
  for (let f = 0; f < FRAMES;) {
    const r = await page.evaluate((n) => globalThis.__boss5.run(n), FRAMES - f);
    time.stops += 1;
    f = r.frame;
    if (r.end) break;
    for (const name of r.due?.moments ?? []) {
      const s = performance.now();
      await page.screenshot({ path: join(SHOTS, `boss5-${name}.png`) });
      time.shots += (performance.now() - s) / 1000;
      console.log(`  shot boss5-${name}.png  (f${f})`);
    }
    if (r.due?.pull) {
      await pull(page, r.due.pull.x, r.due.pull.y);
      if (r.due.pull.boss) time.pulls += 1;
      else time.projectilePulls += 1;
    }
  }
  time.fight = (performance.now() - t) / 1000;
  const seen = await page.evaluate(() => globalThis.__boss5.report());

  const tasks = JSON.stringify(seen.tasks);
  const drawn = JSON.stringify(seen.drawn.tasks);
  console.log(`  states ${seen.states.sort((a, b) => a - b).join(",")};`
    + ` phases ${seen.phases.sort().join(",")}; hp ${seen.firstHp}`
    + ` -> ${seen.minHp}`);
  console.log(`  pulls at the boss ${time.pulls}, at projectiles`
    + ` ${time.projectilePulls}; projectiles ${seen.projectiles};`
    + ` player struck ${seen.strikes}`);
  console.log(`  task frames ${tasks}, drawn at stops ${drawn}; lit node`
    + ` frames ${seen.lit} (drawn ${seen.drawn.lit}); flash frames`
    + ` ${seen.flashes} (drawn ${seen.drawn.flash})`);
  console.log(`  banner f${seen.banner}, fight f${seen.fight}, dead`
    + ` f${seen.dead}, flag 30 f${seen.flag30}, despawn f${seen.despawn},`
    + ` step 5 f${seen.gate}, its end f${seen.end}; at ${seen.address}`);
  console.log(`  ${seen.frames} frames in ${time.stops} stops: open`
    + ` ${time.open.toFixed(1)}s, load ${time.load.toFixed(1)}s, fight`
    + ` ${time.fight.toFixed(1)}s${SHOTS_ON ? ` (shots ${time.shots.toFixed(1)}s)` : ""}`);
  check(seen.boss && seen.drawn.boss > 0,
        "the boss is placed and drawn by its hook");
  check(seen.banner >= 0, "flag 22 raises the banner");
  check(seen.fight >= 0, "flag 23 starts the fight");
  check(seen.minHp < (seen.firstHp ?? 0), "the page's pulls hurt it",
        `${seen.firstHp} -> ${seen.minHp}`);
  check([0, 1, 2, 3, 4].every((p) => seen.phases.includes(p)),
        "the fight walks all five phase rows");
  check([7, 8, 9, 10].every((x) => seen.states.includes(x)),
        "it casts, circles, lunges and barrages");
  check(seen.projectiles > 0, "it throws projectiles");
  check(seen.strikes > 0, "the player is struck");
  check([0, 1, 2, 3, 4, 5].every((k) => (seen.drawn.tasks[k] ?? 0) > 0),
        "every task routine draws", `drawn at stops ${drawn}`);
  check(seen.drawn.flash > 0 && seen.drawn.lit > 0,
        "the hook lights its nodes");
  check(seen.dead >= 0 && seen.flag30 >= 0 && seen.despawn >= 0,
        "it dies, raises flag 30 and despawns");
  check(seen.gate >= 0, "the walker gets past wait_script_flag 30");
  check(seen.end >= 0, "...and reaches the end of block 7's last step");
  check(state.faults === 0, "no console errors", state.faultLines.join("; "));
  console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
  code = failures.length ? 1 : 0;
} catch (e) {
  console.log(`FAIL  ${e.message}`);
} finally {
  await close();
}
process.exit(code);
