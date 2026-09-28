/**
 * Two exe behaviours, observed in the running player on stage 6.
 *
 * **`zslman`'s blades trail afterimages.** `ThrownWeaponUpdate`
 * (`FUN_00450780`) calls `ZslmanBladeEmitAfterimage` (`FUN_00450930`) for a
 * character-type-0x18 weapon in the air, and each afterimage is a task running
 * `ZslmanBladeAfterimageFade` (`FUN_00450A30`). This plays block 0 from the
 * step that places the class-0x31 throwers, reads every record in
 * `G.g_thrown_weapons` every frame, shoots the first blade the shot-test list
 * offers, and checks what only the afterimage routine can produce (`L47`):
 * records of the third routine, drawing `0x1FE4`/`0x1FE5`, a fifteenth dimmer
 * a frame, never ten at once behind one blade, and none left alive the frame
 * after their blade has landed. Screenshots go to `web/shots/`.
 *
 * **A zombie that has been shot runs.** `ZombieOnShot` (`FUN_00453EB0`) raises
 * `obj+0x34` bit `0x8000000` for every shot that lands. This plays block 0
 * from the step that places three `znele` walkers whose spawn records do
 * *not* set it, pulls the trigger over a grid until one of them is hit and
 * survives -- class 0x30 is picked by bone sphere and is never on
 * `shotTargets` -- and reads the bit back; then follows it, and reports the
 * run clip it takes against the one it would have taken unshot.
 *
 *   node tools/afterimages.mjs --headless              # both
 *   node tools/afterimages.mjs --headless --which blades
 *   node tools/afterimages.mjs --headless --which sprint
 *
 * Needs a bundle exported with the afterimage models (`HOTD2_BUNDLE`).
 */
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { openPlayer, pull, requireBundle, waitForLoad, SHOTS }
  from "./lib/player.mjs";

requireBundle("tools/afterimages.mjs");

const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const flag = (n) => args.includes(`--${n}`);
const WHICH = opt("which", "both");
const SEED = opt("seed", "1");

let failures = 0;
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? `  ${detail}` : ""}`);
};

/** `ThrownWeaponRoutine.ZslmanAfterimage`, `ThrownWeaponFlag.Landed`. */
const AFTERIMAGE = 2;
const LANDED = 0x4000;
const ZSLMAN = 0x18;
/** `ZOMBIE_SPRINTS`, `obj+0x34` bit 0x8000000. */
const SPRINTS = 0x08000000;

async function scene(url) {
  const opened = await openPlayer({
    url: `${url}&drive=1&seed=${SEED}`, size: "1280x800",
    headless: flag("headless"), quiet: !flag("loud"),
  });
  await waitForLoad(opened.page);
  mkdirSync(SHOTS, { recursive: true });
  await opened.page.evaluate(() => document.activeElement?.blur?.());
  await opened.page.keyboard.press("Space");
  const advance = (n) => opened.page.evaluate(
    (k) => globalThis.__hotd2Drive.advance(k), n);
  const box = await opened.page.locator("#view").boundingBox();
  const aim = (t) => pull(opened.page, box.x + ((t.x + 1) / 2) * box.width,
                          box.y + ((1 - t.y) / 2) * box.height);
  return { ...opened, advance, aim };
}

async function blades() {
  console.log("stage 6 block 0: zslman's blades");
  const { page, close, state, advance, aim } =
    await scene("?stage=6&block=0&step=4&op=2");
  try {
    const budget = Number(opt("frames", "2400"));
    /** Per afterimage id: frames seen, the lights it drew with, its slot. */
    const trail = new Map();
    /** Per blade id: the frame it landed, the most it ever had out. */
    const blade = new Map();
    let drawnWithout = 0;
    let aliveAfterLanding = [];
    let shotBlade = null;
    let shots = 0;
    let frame = 0;
    for (; frame < budget; frame++) {
      await advance(1);
      const rows = await page.evaluate(async () => {
        const { G } = await import("/src/game/globals.ts");
        return {
          gate: G.g_nFiringGate,
          w: G.g_thrown_weapons.map((w) => ({
            id: w.id, r: w.routine, slot: w.slot, ct: w.charType,
            st: w.state, sub: w.sub, fl: w.flags >>> 0, n: w.afterimages,
            wp: w.weapon, t: w.timer, l: w.light,
            lc: w.lightColour, d: w.draw !== null, gone: w.despawned,
          })),
        };
      });
      for (const w of rows.w) {
        if (w.r === AFTERIMAGE) {
          let a = trail.get(w.id);
          if (!a) trail.set(w.id, a = { first: frame, weapon: w.wp,
                                        slot: w.slot, lights: [], at: [],
                                        drawn: 0 });
          if (w.d) {
            a.drawn++;
            a.lights.push(w.l);
            a.at.push(frame);
            if (!w.lc || w.lc[0] !== w.l || w.lc[2] !== w.l) drawnWithout++;
          }
          const b = blade.get(w.wp);
          if (b && b.landed >= 0 && b.landed < frame && !w.gone) {
            aliveAfterLanding.push(w.id);
          }
        } else if (w.ct === ZSLMAN) {
          let b = blade.get(w.id);
          if (!b) blade.set(w.id, b = { landed: -1, most: 0, slot: w.slot,
                                        deflected: false });
          b.most = Math.max(b.most, w.n);
          if (b.landed < 0 && (w.fl & LANDED)) b.landed = frame;
          if (w.st === 1) b.deflected = true;
        }
      }
      const live = rows.w.filter((w) => w.r === AFTERIMAGE && w.d);
      // Two pictures of one trail, three frames apart. The frames between are
      // not sampled, which the light check allows for by frame number.
      if (live.length >= 3 && !trail.shot) {
        trail.shot = true;
        await page.screenshot({ path: join(SHOTS, "afterimages-trail.png") });
        await advance(3);
        frame += 3;
        await page.screenshot({ path: join(SHOTS, "afterimages-trail-3.png") });
        continue;
      }
      // Shoot the first blade the shot-test list offers, once it has a trail.
      if (!shotBlade && rows.gate && live.length >= 2 && shots < 12) {
        const targets = await page.evaluate(
          () => globalThis.__hotd2Drive.shotTargets?.() ?? []);
        const t = targets.find((x) => x.thrown !== undefined
          && Math.abs(x.x) < 0.95 && Math.abs(x.y) < 0.95);
        if (t) {
          shots++;
          await aim(t);
          // The pull is queued; the next frame's `ProcessShotRequests` marks
          // the weapon and the frame after deflects it. Read the state, not
          // the mark, which the weapon's own routine consumes.
          await advance(2);
          frame += 2;
          const hit = await page.evaluate(async (id) => {
            const { G } = await import("/src/game/globals.ts");
            const w = G.g_thrown_weapons.find((x) => x.id === id);
            return w ? w.state === 1 : false;
          }, t.thrown);
          if (hit) shotBlade = t.thrown;
          continue;
        }
      }
      if (frame > 600 && blade.size >= 2 && shotBlade
          && [...blade.values()].some((b) => b.landed >= 0)
          && trail.size > 40) break;
    }
    const all = [...trail.values()];
    const slots = [...new Set(all.map((a) => a.slot.toString(16)))].sort();
    console.log(`  ${frame} frames; ${blade.size} zslman blades, `
      + `${all.length} afterimages; slots ${slots.join(",")}; `
      + `shot blade ${shotBlade ?? "none"}`);
    for (const [id, b] of blade) {
      const mine = all.filter((a) => a.weapon === id);
      const firsts = mine.map((a) => a.first).sort((x, y) => x - y);
      const gaps = firsts.slice(1).map((f, i) => f - firsts[i]);
      console.log(`    blade ${id} (${b.slot.toString(16)}): `
        + `${mine.length} afterimages, most out ${b.most}, `
        + `${b.landed >= 0 ? `landed f${b.landed}` : "did not land"}`
        + `${b.deflected ? ", shot down" : ""}; gaps ${JSON.stringify(gaps)}`);
    }
    const full = all.find((a) => a.lights.length >= 12);
    if (full) {
      console.log(`    one afterimage's lights: `
        + full.lights.map((l) => l.toFixed(3)).join(" "));
    }
    check("zslman threw, and its blades trailed afterimages",
          blade.size > 0 && all.length > 0,
          `${blade.size} blades, ${all.length} afterimages`);
    check("...drawing 0x1FE4 and 0x1FE5 and nothing else",
          all.length > 0 && all.every((a) => a.slot === 0x1fe4
                                             || a.slot === 0x1fe5),
          slots.join(","));
    const step = Math.fround(1 / 15);
    const fades = all.filter((a) => a.lights.length >= 2);
    check("...each a fifteenth dimmer every frame it draws, from 0.75",
          fades.length > 0 && fades.every((a) => a.lights.every((l, i) =>
            i === 0 || Math.abs(a.lights[i - 1]
              - (a.at[i] - a.at[i - 1]) * step - l) < 1e-5))
          && all.filter((a) => a.first > 0).every((a) =>
            !a.lights.length || Math.abs(a.lights[0] - (0.75 - step)) < 1e-6),
          `${fades.length} checked`);
    check("...lit grey, in the record the renderer reads",
          drawnWithout === 0, `${drawnWithout} draws without it`);
    check("...never more than fifteen draws each",
          all.every((a) => a.drawn <= 15),
          `${Math.max(0, ...all.map((a) => a.drawn))} at most`);
    // `CMP [EBP+0x1368], 0xA` / `JGE`: the count reaches ten and stops.
    check("...never more than ten counted behind one blade",
          [...blade.values()].every((b) => b.most <= 10),
          `${Math.max(0, ...[...blade.values()].map((b) => b.most))} at most`);
    check("...and a shot-down blade's count climbs to ten and stays, since "
          + "its afterimages give nothing back",
          [...blade.values()].filter((b) => b.deflected).every((b) =>
            b.most === 10), [...blade.values()].filter((b) => b.deflected)
            .map((b) => b.most).join(","));
    check("...and none alive after its blade has landed",
          aliveAfterLanding.length === 0,
          `${aliveAfterLanding.length} seen`);
    check("a blade was shot down, and its trail went on after",
          shotBlade !== null && all.some((a) => a.weapon === shotBlade
            && a.first > 0) && blade.get(shotBlade)?.deflected === true,
          `blade ${shotBlade}`);
    if (state.faults) console.log(`  page faults: ${state.faults}`);
    check("the page raised no faults", state.faults === 0);
  } finally {
    await close();
  }
}

async function sprint() {
  console.log("stage 6 block 0: a walker that is shot comes on at a run");
  const { page, close, state, advance, aim } =
    await scene("?stage=6&block=0&step=2&op=19");
  try {
    // Class 0x30 is not on the shot-test list -- the port picks it by bone
    // sphere -- so `shotTargets` never offers one. A grid of real pulls over
    // the middle of the view, one a frame, until one lands on a walker that
    // was not sprinting and does not kill it.
    const walkers = () => page.evaluate(async () => {
      const { G } = await import("/src/game/globals.ts");
      return G.g_object_list.filter((q) => q.cls === 0x30 && !q.despawned
                                          && !q.dead && q.visible)
        .map((q) => ({ at: q.at, flags: q.flags >>> 0, hp: q.hp,
                       type: q.charType }));
    });
    let at = null;
    let before = null;
    const grid = [];
    for (let y = 0.15; y <= 0.85; y += 0.1) {
      for (let x = 0.15; x <= 0.85; x += 0.07) grid.push([x, y]);
    }
    const view = await page.locator("#view").boundingBox();
    await advance(150);
    for (let i = 0; i < grid.length * 3 && at === null; i++) {
      const gate = await page.evaluate(async () =>
        (await import("/src/game/globals.ts")).G.g_nFiringGate);
      const was = await walkers();
      if (!gate || !was.some((w) => !(w.flags & SPRINTS))) {
        await advance(5);
        continue;
      }
      const [gx, gy] = grid[i % grid.length];
      await pull(page, view.x + gx * view.width, view.y + gy * view.height);
      await advance(1);
      const now = await walkers();
      for (const w of was) {
        const n = now.find((q) => q.at === w.at);
        if (n && !(w.flags & SPRINTS) && n.hp < w.hp) {
          at = w.at;
          before = w;
          break;
        }
      }
      if (at !== null) {
        await page.screenshot({ path: join(SHOTS, "sprint-shot.png") });
      }
    }
    if (at === null) {
      check("a pull landed on a walker that was not sprinting, and left it "
            + "alive", false);
      return;
    }
    const after = await page.evaluate(async (a) => {
      const { G } = await import("/src/game/globals.ts");
      const x = G.g_object_list.find((q) => q.at === a);
      return { flags: x.flags >>> 0, hp: x.hp, dead: x.dead, state: x.state };
    }, at);
    console.log(`  walker ${at} (type 0x${before.type.toString(16)}): flags `
      + `0x${before.flags.toString(16)} hp `
      + `${before.hp} -> flags 0x${after.flags.toString(16)} hp ${after.hp}`
      + `${after.dead ? " (dead)" : ""}`);
    check("the shot landed and did not kill it",
          after.hp < before.hp && !after.dead);
    check("...and it is sprinting now, where its spawn record did not ask to",
          (before.flags & SPRINTS) === 0 && (after.flags & SPRINTS) !== 0);
    // Follow it: which of the run pair does `ZombieStateAttackRun` play?
    const runs = new Map();
    for (let f = 0; f < 600; f += 2) {
      await advance(2);
      const s = await page.evaluate(async (a) => {
        const { G } = await import("/src/game/globals.ts");
        const { MotionRowOf } = await import("/src/game/tables.ts");
        const x = G.g_object_list.find((q) => q.at === a && !q.despawned);
        if (!x || x.dead || x.state !== 1) return null;
        const row = MotionRowOf(x);
        return { motion: x.motion, jog: row?.[2], sprint: row?.[3],
                 sprinting: (x.flags & 0x08000000) !== 0 };
      }, at);
      if (!s) continue;
      const k = `${s.motion} (jog ${s.jog}, sprint ${s.sprint})`;
      runs.set(k, (runs.get(k) ?? 0) + 1);
    }
    console.log(`  its AttackRun clips: ${JSON.stringify([...runs])}`);
    // Reported rather than required: whether it reaches `ZombieStateAttackRun`
    // in the window is the room's business, not the shot's.
    if (runs.size) {
      check("...and when it runs at the camera it runs the sprint clip",
            [...runs.keys()].every((k) => {
              const m = /^(\d+) \(jog (\d+), sprint (\d+)\)$/.exec(k);
              return m && m[1] === m[3];
            }), [...runs.keys()].join("; "));
    }
    if (state.faults) console.log(`  page faults: ${state.faults}`);
    check("the page raised no faults", state.faults === 0);
  } finally {
    await close();
  }
}

if (WHICH === "blades" || WHICH === "both") await blades();
if (WHICH === "sprint" || WHICH === "both") await sprint();
console.log(failures ? `\n${failures} failed` : "\nclean");
process.exit(failures ? 1 : 0);
