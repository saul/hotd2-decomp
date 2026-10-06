/**
 * In the real page: **a class-0x44 hinge is shot through its own mesh, and
 * is in the moving-object collision passes.**
 *
 *     HOTD2_BUNDLE=... node tools/hinge_page.mjs --headless [--shot]
 *
 * Stage 1, block 3 step 3 op 13 places evt `0x2C2C` -- class 0x44 selector
 * 1, `PropBuildHinge` (`FUN_00472BD0`): the single door (slot `0x17D7`)
 * whose descriptor's `+0x08` names `coli1.bin:3040`. `HingeUpdate`
 * (`FUN_00473CF0`) stores its draw's matrix at `obj+0x150` and, with that
 * blob, `RegisterForShotTest`s; the builder's `0x51` sends it to the mesh
 * arm. Before `class44/hinge.ts` filed it, the port gave it a sphere of
 * radius 0, which nothing hits, and no prop was in the collision passes.
 *
 * Two loads of the same address on the same seed. One **clicks** where the
 * page's own `shotTargets` puts the door (the middle of its blob through
 * `obj+0x150`) until its wobble starts; the other clicks nothing. The verdict
 * is what only a shot on the door's mesh writes: `obj+0x34` bit 30, the
 * wobble `HingeUpdate` starts on a hit (`L47`) -- and, in both runs, the door
 * in `g_coli_dynamic_list`, the list the ground probes, the body push and the
 * world trace walk.
 *
 * `--shot` writes `shots/hinge_{shut,wobble}.png`: the click that landed,
 * and eight frames after it.
 */
import { join } from "node:path";
import {
  openPlayer, pull, requireBundle, SHOTS, waitForLoad,
} from "./lib/player.mjs";

requireBundle("hinge_page");
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const AT = 0x2c2c;
const URL = "?stage=1&block=3&step=3&op=14&drive=1&seed=1";
/** Frames to play, and the frames between two clicks. */
const BUDGET = 900;
const CLICK_EVERY = 6;
/** `obj+0x34` bit 30, `HINGE_WOBBLE`. */
const WOBBLE = 0x40000000;

let failures = 0;
const check = (what, ok, note = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${note ? ` -- ${note}` : ""}`);
  if (!ok) failures += 1;
};

/** The door as the page's pool holds it, and the two lists it is in. */
const door = (page, at) => page.evaluate(async (a) => {
  const { G } = await import("/src/game/globals.ts");
  const p = G.g_breakable_props.find((q) => q.at === a && !q.dead);
  if (!p) return null;
  return {
    id: p.id, flags: p.flags, blob: p.coliBlob, m: !!p.coliMatrix,
    o1e8: p.words?.o1e8 ?? 0, o68: p.words?.o68 ?? 0,
    filed: G.g_shot_test_list.some((e) => e.prop === p.id),
    published: G.g_coli_dynamic_list.some((e) => e.prop === p.id),
  };
}, at);

async function play(shoot) {
  const { page, state, close } = await openPlayer({
    url: URL, size: "1280x800", headless: flag("headless"),
    quiet: !flag("loud"),
  });
  const out = { placed: false, mesh: false, published: false, clicks: 0,
                wobble: -1, swing: [], faults: 0, at: "" };
  try {
    await waitForLoad(page);
    if (await page.evaluate(() => globalThis.__hotd2Drive?.version ?? null)
        === null) {
      throw new Error("no drive seam -- is ?drive=1 wired up?");
    }
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Space");
    const canvas = await page.locator("canvas").first().boundingBox();
    const advance = (n) =>
      page.evaluate((k) => globalThis.__hotd2Drive.advance(k), n);
    for (let f = 0; f < BUDGET; f += 2) {
      await advance(2);
      out.at = await page.evaluate(() => globalThis.__hotd2Drive.now().a);
      const d = await door(page, AT);
      if (!d) continue;
      out.placed = true;
      if (d.filed && d.flags === 0x51 && d.blob === "coli1.bin:3040" && d.m) {
        out.mesh = true;
      }
      if (d.published) out.published = true;
      if (out.wobble < 0 && (d.flags & WOBBLE) !== 0) out.wobble = f;
      if (out.wobble >= 0 && out.swing.length < 8) out.swing.push(d.o68);
      if (shoot && flag("shot") && out.wobble >= 0 && f === out.wobble + 8) {
        await page.screenshot({ path: join(SHOTS, "hinge_wobble.png") });
      }
      if (shoot && out.wobble < 0 && f % CLICK_EVERY === 0 && canvas) {
        const t = (await page.evaluate(
          () => globalThis.__hotd2Drive.shotTargets?.() ?? []))
          .find((x) => x.prop === d.id && Math.abs(x.x) <= 1
                && Math.abs(x.y) <= 1 && x.z >= -1 && x.z <= 1);
        if (t) {
          if (flag("shot")) {
            await page.screenshot({ path: join(SHOTS, "hinge_shut.png") });
          }
          await pull(page, canvas.x + ((t.x + 1) / 2) * canvas.width,
                     canvas.y + ((1 - t.y) / 2) * canvas.height);
          out.clicks += 1;
        }
      }
      if (out.published && (!shoot || out.wobble >= 0)
          && (!shoot || out.swing.length >= 8)) {
        if (!shoot && f < 300) continue;
        break;
      }
    }
    out.faults = state.faults;
  } finally {
    await close();
  }
  return out;
}

console.log(`\nstage 1, from ${URL}:\n`);
const shot = await play(true);
console.log(`  clicked:     ${JSON.stringify(shot)}`);
const quiet = await play(false);
console.log(`  not clicked: ${JSON.stringify(quiet)}\n`);

check("block 3 places the door at 0x2C2C, and it files itself in the "
      + "shot-test list as a mesh object (0x51, coli1.bin:3040, its matrix)",
      shot.placed && shot.mesh);
check("...and it is in g_coli_dynamic_list, the moving-object passes' list",
      shot.published && quiet.published);
check("a click on the door lands on its mesh and starts its wobble",
      shot.wobble >= 0 && shot.swing.some((y) => y !== 0),
      `${shot.clicks} clicks, wobble at ${shot.wobble}, yaw ${shot.swing}`);
check("with no click it never wobbles", quiet.placed && quiet.wobble < 0,
      `${quiet.wobble}`);
check("the page raised no fault in either run",
      shot.faults === 0 && quiet.faults === 0,
      `${shot.faults} and ${quiet.faults}`);
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
