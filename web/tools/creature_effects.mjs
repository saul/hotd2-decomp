/**
 * Do the owl's and the fish's effects reach the screen?
 *
 * `test/port.test.ts` asserts the pools. This loads the real page on a block
 * that places the creature, plays it under `?drive=1`, shoots the first one
 * the shot-test list puts on the screen -- a real pull, through the real shot
 * test -- and reads the pools back out of the page's own `G`, then takes
 * screenshots a few frames apart. What each pool holds is a signal only that
 * death can produce: nothing else in the image spawns a feather, a blood
 * cloud or the fish's splash (`L47`).
 *
 *   node tools/creature_effects.mjs --headless
 *   node tools/creature_effects.mjs --headless --which fish
 *
 * Screenshots go to `web/shots/`, which is gitignored.
 */
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { openPlayer, pull, waitForLoad, SHOTS } from "./lib/player.mjs";

const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const flag = (n) => args.includes(`--${n}`);

/** Where each creature is placed, and its class. */
const WHERE = {
  owl: { url: "?stage=2&block=5&step=1&op=3", cls: 0x43 },
  // The owl's other two flocks: sub-type 2's box and stair, sub-type 3's
  // water. `--at` overrides the address for any of them.
  owl2: { url: "?stage=2&block=14", cls: 0x43 },
  owl3: { url: "?stage=3&block=7", cls: 0x43 },
  fish: { url: "?stage=2&block=16&step=8&op=3", cls: 0x51 },
};
const which = opt("which", "owl");
const at = WHERE[which]
  && { ...WHERE[which], url: opt("at", WHERE[which].url) };
if (!at) throw new Error(`--which owl|owl2|owl3|fish, not ${which}`);
const BUDGET = Number(opt("budget", "3000"));

const { page, close } = await openPlayer({
  url: `${at.url}&drive=1&seed=${opt("seed", "1")}`,
  size: "1280x800", headless: flag("headless"), quiet: !flag("loud"),
});

let failed = true;
try {
  await waitForLoad(page);
  mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press("Space");
  const advance = (n) =>
    page.evaluate((k) => globalThis.__hotd2Drive.advance(k), n);
  const box = await page.locator("#view").boundingBox();
  const pools = () => page.evaluate(async () => {
    const { G } = await import("/src/game/globals.ts");
    return {
      feathers: G.g_owl_feathers.length,
      pointBlood: G.g_point_blood_sprays.length,
      clouds: G.g_fish_blood_clouds.length,
      splashes: G.g_fish_water_splashes.length,
      surfaceRings: G.g_fish_surface_rings.length,
      rings: G.g_ring_effects.length,
      // The owl corpse's landings, and what only they make.
      corpses: G.g_object_list.filter((o) => o.cls === 0x43 && !o.despawned
        && o.owl?.state === 6).map((o) =>
        [o.owl.subtype, +o.pos.y.toFixed(3), o.owl.settled]),
      owlRings: G.g_owl_ground_rings.map((r) =>
        [+r.x.toFixed(2), +r.y.toFixed(3), +r.z.toFixed(2)]),
      owlSplashes: G.g_owl_water_splashes.length,
      dead: G.g_object_list.filter((o) => o.dead).map((o) => o.cls),
    };
  });

  // The shot. A class on the shot-test list gets a real pull at the point it
  // published (the owl registers the engine's way); one the port still tests
  // by its own sphere (the fish) is marked hit the way that test marks it --
  // `obj+0x34` bits 3 and 1, player 0 --
  // once it is inside `NEAR` units of the eye, which is on the screen for
  // every approach these blocks make.
  const NEAR = Number(opt("near", "30"));
  let shotAt = -1;
  for (let done = 0; done < BUDGET && shotAt < 0; done += 5) {
    await advance(5);
    const targets = await page.evaluate(
      () => globalThis.__hotd2Drive.shotTargets?.() ?? []);
    const t = targets.find((x) => x.cls === at.cls && Math.abs(x.x) < 0.8
      && Math.abs(x.y) < 0.8 && x.z >= -1 && x.z <= 1);
    if (t) {
      await page.screenshot({ path: join(SHOTS, `${which}-fx-aim.png`) });
      for (let k = 0; k < 3; k += 1) {
        await pull(page, box.x + ((t.x + 1) / 2) * box.width,
                   box.y + ((1 - t.y) / 2) * box.height);
        await advance(1);
        const p = await pools();
        if (p.feathers || p.clouds) { shotAt = done; break; }
      }
      continue;
    }
    const marked = await page.evaluate(async ({ cls, near }) => {
      const { G } = await import("/src/game/globals.ts");
      const { ActorFlag } = await import("/src/game/actor.ts");
      const e = G.g_camera_block_eye;
      const o = G.g_object_list.find((a) => a.cls === cls && !a.dead
        && !a.despawned && a.visible
        && Math.hypot(a.pos.x - e.x, a.pos.y - e.y, a.pos.z - e.z) < near);
      if (!o) return false;
      o.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
      return true;
    }, { cls: at.cls, near: NEAR });
    if (!marked) continue;
    await page.screenshot({ path: join(SHOTS, `${which}-fx-aim.png`) });
    await advance(1);
    const p = await pools();
    if (p.feathers || p.clouds) shotAt = done;
  }
  if (shotAt < 0) {
    console.log(`FAIL  no ${which} came onto the screen to be shot`);
  } else {
    const seen = [];
    for (const [n, tag] of [[2, "a"], [10, "b"], [30, "c"], [90, "d"]]) {
      await advance(n);
      const p = await pools();
      seen.push(p);
      console.log(`+${String(n).padStart(2)}  ${JSON.stringify(p)}`);
      await page.screenshot({ path: join(SHOTS, `${which}-fx-${tag}.png`) });
    }
    if (which.startsWith("owl")) {
      failed = !(seen[0].feathers >= 40 && seen[0].pointBlood >= 1);
      console.log(failed ? "FAIL  the owl's death left no feathers"
        : "ok    the shot owl shed its feathers and bled");
      // Whether the corpse reaches its ground inside its 121 frames depends
      // on how high it was shot, so this reports rather than fails.
      const landed = seen.some((p) => p.owlRings.length || p.owlSplashes);
      console.log(landed ? "ok    the corpse landed and left its ring or splash"
        : "note  the corpse did not reach its ground in its 121 frames");
    } else {
      failed = !(seen[0].clouds >= 1 && seen[0].splashes + seen[0].rings >= 1);
      console.log(failed ? "FAIL  the fish's death left nothing"
        : "ok    the shot fish left its cloud and its splash");
    }
  }
} finally {
  await close();
}
process.exit(failed ? 1 : 0);
