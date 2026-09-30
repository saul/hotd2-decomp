/**
 * The stage-5 boss's fight, in the page: arrive, fight, hurt and be hurt,
 * die, and the script on to the block's end -- with a screenshot of each
 * thing the class draws.
 *
 *     node tools/boss5_page.mjs --headless
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
 * Screenshots: `web/shots/boss5-<moment>.png` -- the banner, the fight, a
 * volley in flight, the lunge with its afterimages and hands, the final
 * barrage's body loop, the hit flash, the death bursts and the exit effect.
 * Look at them: the checks below say the moments happened, not what they
 * looked like.
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
const URL = "?stage=5&block=7&step=1&op=0&drive=1&seed=1";
/** The four bones `Class32ChargeShotBone` charges. */
const DAMAGE_BONES = [4, 6, 11, 13];
const S = { Hit: 2, Death: 2, Retire: 3, Leave: 4, Cast: 7, Circle: 8,
            Lunge: 9, Barrage: 10 };
const T = { Afterimage: 0, BodyLoop: 1, Hands: 2, Trail: 3, Burst: 4,
            Exit: 5 };

const failures = [];
const check = (ok, what, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(what);
};

const { page, state, close } = await openPlayer({
  url: URL, size: opt("size", "1280x800"), headless: flag("headless"),
  quiet: !flag("loud"), debug: false,
});
const advance = (n) =>
  page.evaluate((k) => globalThis.__hotd2Drive.advance(k), n);

/**
 * The boss, its projectiles and tasks, the script's gates, and where bone
 * `bone`'s hit centre is on the page.
 */
const read = (bone) => page.evaluate(async (bone) => {
  const { G } = await import("/src/game/globals.ts");
  const now = globalThis.__hotd2Drive.now();
  const boss = G.g_object_list.find((o) => o.cls === 0x32 && !o.despawned
    && o.boss5.routine === 0);
  const projectiles = G.g_object_list.filter((o) => o.cls === 0x32
    && !o.despawned && o.boss5.routine === 1);
  const tasks = {};
  for (const t of G.g_class32_tasks) {
    if (t.draw) tasks[t.routine] = (tasks[t.routine] ?? 0) + 1;
  }
  const r = document.querySelector("#viewport canvas").getBoundingClientRect();
  const m = G.g_camera_index === 2 ? G.g_camera_block2_view_to_world
    : G.g_camera_view_to_world;
  const project = (p) => {
    const d = [p[0] - m[12], p[1] - m[13], p[2] - m[14]];
    const col = (c) => d[0] * m[4 * c] + d[1] * m[4 * c + 1]
      + d[2] * m[4 * c + 2];
    const qx = col(0), qy = col(1), qz = col(2);
    const t = Math.tan((41.1 * Math.PI) / 360);
    const nx = qx / -qz / (t * (r.width / r.height));
    const ny = qy / -qz / t;
    return { x: r.left + (nx + 1) / 2 * r.width,
             y: r.top + (1 - ny) / 2 * r.height,
             ok: qz < 0 && Math.abs(nx) < 0.95 && Math.abs(ny) < 0.95 };
  };
  const hit = boss?.skel?.bones[bone]?.hit ?? null;
  const targets = globalThis.__hotd2Drive.shotTargets()
    .filter((s) => s.cls === 0x32 && s.at !== boss?.at && s.z < 1
      && Math.abs(s.x) < 0.95 && Math.abs(s.y) < 0.95)
    .map((s) => ({ at: s.at, x: r.left + (s.x + 1) / 2 * r.width,
                   y: r.top + (1 - s.y) / 2 * r.height }));
  return {
    address: now.a, frame: now.f,
    boss: boss ? {
      at: boss.at, state: boss.state, sub: boss.sub, hp: boss.hp,
      phase: boss.boss5.phase, flash: boss.boss5.flash,
      live: boss.boss5.liveProjectiles, drawn: (boss.motionFlags & 1) !== 0,
      nodes: Object.values(boss.boss5.nodeDraws).flat().length,
      lit: Object.values(boss.boss5.nodeDraws).flat()
        .filter((d) => d.light !== null).length,
    } : null,
    projectiles: projectiles.map((p) => p.at),
    drawnProjectiles: projectiles.filter((p) => p.boss5.draw).length,
    tasks, aim: hit ? project(hit) : null, targets,
    flags: [22, 23, 24, 30].map((i) => G.g_script_flags[i] ?? 0),
    invuln: G.g_player_invuln_frames[0],
    gate: G.g_nFiringGate,
  };
}, bone);

const shot = async (name) => {
  await page.screenshot({ path: join(SHOTS, `boss5-${name}.png`) });
  console.log(`  shot boss5-${name}.png`);
};

let code = 1;
try {
  await waitForLoad(page);
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
  await advance(1);

  const seen = {
    boss: false, banner: -1, fight: -1, dead: -1, flag30: -1, despawn: -1,
    gate: -1, end: -1, states: new Set(), phases: new Set(), minHp: Infinity,
    firstHp: null, strikes: 0, pulls: 0, projectilePulls: 0,
    projectiles: new Set(), tasks: {}, lit: 0, flashes: 0,
  };
  const taken = new Set();
  let rounds = 0;
  let roundState = -1;
  let prevInvuln = 0;
  let s = await read(DAMAGE_BONES[0]);
  console.log(`\n${URL}: landed at ${s.address} f${s.frame}`);
  // Frames per read: fifteen while nobody can shoot -- the ride in, the
  // banner, the death -- and two while the gun is up, which is fine enough
  // for a pull every `SHOOT` frames and one at a projectile every four.
  const fighting = (x) => x.boss !== null && x.flags[1] !== 0 && x.boss.hp > 0;
  for (let f = 0, step = 1; f < FRAMES; f += step) {
    const b = s.boss;
    if (b) {
      seen.boss = true;
      seen.states.add(b.state);
      seen.phases.add(b.phase);
      seen.firstHp ??= b.hp;
      seen.minHp = Math.min(seen.minHp, b.hp);
      if (b.lit) seen.lit += 1;
      if (b.flash > 0) seen.flashes += 1;
      if ((b.state === S.Cast || b.state === S.Lunge) && b.state !== roundState) {
        rounds += 1;
        roundState = b.state;
      } else if (b.state !== S.Cast && b.state !== S.Lunge) {
        roundState = -1;
      }
    }
    for (const at of s.projectiles) seen.projectiles.add(at);
    for (const [k, n] of Object.entries(s.tasks)) {
      seen.tasks[k] = (seen.tasks[k] ?? 0) + n;
    }
    if (s.invuln > prevInvuln) seen.strikes += 1;
    prevInvuln = s.invuln;
    if (seen.banner < 0 && s.flags[0]) seen.banner = f;
    if (seen.fight < 0 && s.flags[1]) seen.fight = f;
    if (seen.flag30 < 0 && s.flags[3]) seen.flag30 = f;
    if (seen.despawn < 0 && seen.boss && !b) seen.despawn = f;
    if (seen.dead < 0 && b && b.hp <= 0) seen.dead = f;

    // The moments, once each.
    const moment = async (name, when) => {
      if (!when || taken.has(name)) return;
      taken.add(name);
      await shot(name);
    };
    await moment("banner", seen.banner >= 0 && f >= seen.banner + 90);
    await moment("fight", seen.fight >= 0 && f >= seen.fight + 30);
    await moment("volley", s.drawnProjectiles >= 3);
    await moment("lunge", b?.state === S.Lunge && (s.tasks[T.Afterimage] ?? 0) >= 3);
    await moment("hands", (s.tasks[T.Hands] ?? 0) > 0);
    await moment("barrage", b?.state === S.Barrage && (s.tasks[T.BodyLoop] ?? 0) > 0
      && b.lit > 0);
    await moment("flash", b !== null && b.flash > 0 && b.flash % 2 === 1
      && b.state !== S.Death);
    await moment("burst", (s.tasks[T.Burst] ?? 0) >= 3);
    await moment("exit", (s.tasks[T.Exit] ?? 0) > 0 && !(b?.drawn ?? false));

    // The trigger: a damaging bone, and every fourth frame a projectile.
    const holdFire = b && rounds % 2 === 1
      && (b.state === S.Cast || b.state === S.Lunge || b.live > 0);
    step = fighting(s) ? 2 : 15;
    if (b && s.flags[1] && b.hp > 0 && !holdFire && f % SHOOT < step
        && s.aim?.ok && s.gate) {
      await pull(page, s.aim.x, s.aim.y);
      seen.pulls += 1;
    } else if (f % 4 < step && s.targets.length && s.gate) {
      const t = s.targets.find((x) => (x.at & 3) === 0);
      if (t) {
        await pull(page, t.x, t.y);
        seen.projectilePulls += 1;
      }
    }
    await advance(step);
    const bone = DAMAGE_BONES[Math.floor(f / SHOOT) % DAMAGE_BONES.length];
    s = await read(bone);
    if (seen.flag30 >= 0 && s.address) {
      const [blk, at, op] = s.address.split("/").map((x) => Number(x));
      if (seen.gate < 0 && (blk !== 7 || at === 5)) seen.gate = f;
      // Step 5's last instructions, as `tools/boss5_fight.mjs` reads them.
      if (seen.gate >= 0 && (blk !== 7 || op >= 40)) seen.end = f;
    }
    if (seen.end >= 0) break;
  }

  console.log(`  states ${[...seen.states].sort((a, b) => a - b).join(",")};`
    + ` phases ${[...seen.phases].sort().join(",")}; hp ${seen.firstHp}`
    + ` -> ${seen.minHp}`);
  console.log(`  pulls at the boss ${seen.pulls}, at projectiles`
    + ` ${seen.projectilePulls}; projectiles ${seen.projectiles.size};`
    + ` player struck ${seen.strikes}`);
  console.log(`  task draws ${JSON.stringify(seen.tasks)}; lit node frames`
    + ` ${seen.lit}; flash frames ${seen.flashes}`);
  console.log(`  banner f${seen.banner}, fight f${seen.fight}, dead`
    + ` f${seen.dead}, flag 30 f${seen.flag30}, despawn f${seen.despawn},`
    + ` step 5 f${seen.gate}, its end f${seen.end}; at ${s.address}`);
  check(seen.boss, "the boss is placed and drawn by its hook");
  check(seen.banner >= 0, "flag 22 raises the banner");
  check(seen.fight >= 0, "flag 23 starts the fight");
  check(seen.minHp < (seen.firstHp ?? 0), "the page's pulls hurt it",
        `${seen.firstHp} -> ${seen.minHp}`);
  check([0, 1, 2, 3, 4].every((p) => seen.phases.has(p)),
        "the fight walks all five phase rows");
  check([7, 8, 9, 10].every((x) => seen.states.has(x)),
        "it casts, circles, lunges and barrages");
  check(seen.projectiles.size > 0, "it throws projectiles");
  check(seen.strikes > 0, "the player is struck");
  check([0, 1, 2, 3, 4, 5].every((k) => (seen.tasks[k] ?? 0) > 0),
        "every task routine draws", JSON.stringify(seen.tasks));
  check(seen.flashes > 0 && seen.lit > 0, "the hook lights its nodes");
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
