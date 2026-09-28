/**
 * What a class-0x30 death leaves on the screen, in the real page.
 *
 * Opens a block under `?drive=1`, plays until an enemy is up, kills every
 * enemy the way the debug button does (`ActorKillAll`, which routes class
 * 0x30 through its own death chain), and then steps frame by frame, reading
 * the page's own `G`: the dust and splash sprites `ZombieDeathEffectCueTick`
 * and `ZombieDeathLandingEffect` spawn (kinds 0x46 and 0x61), the water rings
 * `SpawnWaterRing` puts down, and the ring `SpawnGroundRingEffect` opens
 * under each corpse. It screenshots the first frame each of those appears on,
 * the ring at the middle of its spread, at its hold and while it fades.
 *
 *   node tools/death_fx.mjs --headless
 *   node tools/death_fx.mjs --headless --url '?stage=3&mode=play&block=2&step=4&op=0' --out s3
 *
 * Screenshots go to `web/shots/deathfx-<tag>-*.png`. Exits 1 if no ground
 * ring was ever drawn, which is the one effect every class-0x30 corpse makes.
 */
import { join } from "node:path";
import { openPlayer, waitForLoad, SHOTS } from "./lib/player.mjs";

const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const flag = (n) => args.includes(`--${n}`);
const where = opt("url", "?stage=1&mode=play");
const tag = opt("out", "s1");
const BUDGET = Number(opt("budget", "3000"));
/** Kill when the nearest class-0x30 enemy is this close to the eye. */
const NEAR = Number(opt("near", "60"));

const { page, close } = await openPlayer({
  url: `${where}&drive=1&seed=${opt("seed", "1")}`,
  size: "1280x800", headless: flag("headless"), quiet: !flag("loud"),
});

/** The page's own pools, via the module graph the dev server already built. */
const pools = () => page.evaluate(async () => {
  const { G } = await import("/src/game/globals.ts");
  return {
    enemies: G.g_object_list.filter((a) => a.cls === 0x30 && a.visible
                                     && !a.dead).length,
    nearest: Math.min(...G.g_object_list
      .filter((a) => a.cls === 0x30 && a.visible && !a.dead)
      .map((a) => Math.hypot(a.pos.x - G.g_camera_block_eye.x,
                             a.pos.z - G.g_camera_block_eye.z))),
    corpses: G.g_object_list.filter((a) => a.cls === 0x30 && a.dead).length,
    sprites: G.g_sprite_effects.filter((e) => e.kind === 0x46 || e.kind === 0x61)
      .map((e) => ({ kind: e.kind, slot: e.slot,
                     at: [e.pos.x, e.pos.y, e.pos.z].map((v) => +v.toFixed(1)),
                     scale: +e.scale.x.toFixed(2) })),
    water: G.g_water_rings.map((r) => ({ size: +r.size.toFixed(3),
                                         alpha: +r.alpha.toFixed(3) })),
    // What each ring's routine drew this frame: four cels is the spread,
    // one at full alpha the hold, one fading the fade.
    rings: G.g_ring_effects.map((r) => ({
      drawn: r.drawnStrips.length === 4 ? 0 : r.drawnAlpha < 1 ? 2 : 1,
      frames: r.count, fade: r.fade, at: [r.x, r.y, r.z]
                                            .map((v) => +v.toFixed(1)) })),
    eye: [G.g_camera_block_eye.x, G.g_camera_block_eye.y,
          G.g_camera_block_eye.z].map((v) => +v.toFixed(1)),
    rain: G.g_rain_enabled,
  };
});

let failed = false;
try {
  await waitForLoad(page);
  if (await page.evaluate(() => globalThis.__hotd2Drive?.version ?? null)
      === null) {
    throw new Error("no drive seam -- is ?drive=1 wired up?");
  }
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press("Space");
  const advance = (n) =>
    page.evaluate((k) => globalThis.__hotd2Drive.advance(k), n);

  // Play until something is up to kill.
  let p = await pools();
  for (let done = 0; done < BUDGET && !(p.nearest <= NEAR); done += 5) {
    await advance(5);
    p = await pools();
  }
  if (!(p.nearest <= NEAR)) {
    throw new Error(`no class-0x30 enemy came within ${NEAR} units`);
  }
  console.log(`an enemy is ${p.nearest.toFixed(1)} from the eye`);
  await page.screenshot({ path: join(SHOTS, `deathfx-${tag}-0-alive.png`) });
  const killed = await page.evaluate(async () => {
    const { ActorKillAll } = await import("/src/game/combat/resolve_hit.ts");
    const { Rng } = await import("/src/core/rng.ts");
    return ActorKillAll(new Rng(5));
  });
  console.log(`killed ${JSON.stringify(killed)}, rain ${p.rain}`);

  const shot = async (name) => {
    const f = join(SHOTS, `deathfx-${tag}-${name}.png`);
    await page.screenshot({ path: f });
    console.log(`  -> ${f}`);
  };
  let sawSprite = false, sawWater = false, sawRing = false;
  let spread = false, hold = false, fade = false;
  let maxSprites = 0, maxRings = 0, maxWater = 0;
  for (let f = 0; f < 600; f++) {
    await advance(1);
    p = await pools();
    maxSprites = Math.max(maxSprites, p.sprites.length);
    maxRings = Math.max(maxRings, p.rings.length);
    maxWater = Math.max(maxWater, p.water.length);
    if (!sawSprite && p.sprites.length) {
      sawSprite = true;
      console.log(`f${f}: dust/splash ${JSON.stringify(p.sprites)} eye ${p.eye}`);
      await advance(3);
      await shot(`1-dust-f${f}`);
    }
    if (!sawWater && p.water.length) {
      sawWater = true;
      console.log(`f${f}: water rings ${JSON.stringify(p.water)}`);
      await advance(10);
      await shot(`2-water-f${f}`);
    }
    if (!sawRing && p.rings.length) {
      sawRing = true;
      console.log(`f${f}: ground rings ${JSON.stringify(p.rings)}`);
    }
    const r = p.rings[0];
    if (r && !spread && r.drawn === 0 && r.frames <= 60) {
      spread = true;
      console.log(`f${f}: spreading ${JSON.stringify(r)} eye ${p.eye}`);
      await shot(`3-spread-f${f}`);
    }
    if (r && !hold && r.drawn === 1) {
      hold = true;
      console.log(`f${f}: holding ${JSON.stringify(r)}`);
      await shot(`4-hold-f${f}`);
    }
    if (r && !fade && r.drawn === 2 && r.fade >= 15) {
      fade = true;
      console.log(`f${f}: fading ${JSON.stringify(r)}`);
      await shot(`5-fade-f${f}`);
    }
    if (sawRing && !p.rings.length && !p.water.length && !p.sprites.length) {
      console.log(`f${f}: every effect has run out`);
      break;
    }
  }
  // Staged: every picture at once, in front of the camera, so the draw can be
  // looked at whatever the stage's own camera was doing when they died. The
  // records go in through the port's own spawners; only the three rings'
  // phases are set by hand, one per phase, left to right.
  if (flag("staged")) {
    const placed = await page.evaluate(async () => {
      const { G } = await import("/src/game/globals.ts");
      const { QueryGroundHeightAt } = await import("/src/game/coli.ts");
      const { SpawnGroundRingEffect, RingEffectPhase } =
        await import("/src/game/effects/ring_effect.ts");
      const { SpawnWaterRing } = await import("/src/game/effects/water_ring.ts");
      const { SpawnSpriteEffect } = await import("/src/game/effects/sprite.ts");
      const { Rng } = await import("/src/core/rng.ts");
      const e = G.g_camera_block_eye, t = G.g_camera_block_target;
      const fx = t.x - e.x, fz = t.z - e.z;
      const n = Math.hypot(fx, fz) || 1;
      const [ux, uz] = [fx / n, fz / n];
      const [rx, rz] = [-uz, ux];
      const at = (side, ahead) => {
        const x = e.x + ux * ahead + rx * side, z = e.z + uz * ahead + rz * side;
        return { x, y: QueryGroundHeightAt(x, e.y + 20, z), z };
      };
      G.g_ring_effects = [];
      G.g_water_rings = [];
      const phases = [
        { side: -12, set: (r) => { r.count = 61; } },
        { side: 0, set: (r) => { r.phase = RingEffectPhase.Hold; r.count = 5; } },
        { side: 12, set: (r) => {
          r.phase = RingEffectPhase.FadeOut; r.fade = 19; r.alpha = 0.55;
        } },
      ];
      for (const ph of phases) {
        const p = at(ph.side, 60);
        SpawnGroundRingEffect({ pos: p, lookAt: p, yaw: 0, motionFlags: 4 });
        ph.set(G.g_ring_effects[G.g_ring_effects.length - 1]);
      }
      const w = at(0, 45);
      const rng = new Rng(9);
      SpawnWaterRing(w, 1.0, rng);
      SpawnWaterRing(w, 0.5, rng);
      SpawnSpriteEffect(at(-8, 40), 0, 0, 0x46, 2, -1);
      SpawnSpriteEffect(at(8, 40), 0, 0, 0x61, 1, -1);
      return { eye: [e.x, e.y, e.z].map((v) => +v.toFixed(1)),
               target: [t.x, t.y, t.z].map((v) => +v.toFixed(1)),
               ring: [G.g_ring_effects[1].x, G.g_ring_effects[1].y,
                      G.g_ring_effects[1].z].map((v) => +v.toFixed(1)),
               rings: G.g_ring_effects.length };
    });
    console.log(`staged ${JSON.stringify(placed)}`);
    await advance(1);
    await page.waitForTimeout(300);
    await shot("6-staged");
    // The effect layer's own account of itself, from the Shooting panel.
    await page.getByText("Shooting", { exact: true }).click();
    await page.waitForTimeout(200);
    const text = await page.evaluate(() => document.body.innerText);
    const line = text.split("\n").find((l) => l.includes("templates"));
    console.log(`effect layer: ${line ?? "(no line)"}`);
  }
  console.log(`\n${where}: most at once -- ${maxSprites} dust/splash, `
    + `${maxWater} water rings, ${maxRings} ground rings`);
  if (!sawRing) {
    console.log("FAIL  no corpse opened a ground ring");
    failed = true;
  } else {
    console.log("ok    the corpses opened their rings");
  }
} finally {
  await close();
}
process.exit(failed ? 1 : 0);
