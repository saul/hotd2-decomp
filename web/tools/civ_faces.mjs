/**
 * Look at every civilian's head, in a real browser, through the player's own
 * loader.
 *
 * `docs/BUGS.md` carries a report that says "civilians' hair doesn't render",
 * and the only way to answer a report about a picture is to look at the
 * picture -- L19 and L25. This prints the four views of one rig part for every
 * class-0x10 character type in a stage, side by side, and the material state
 * three.js ended up with for each primitive it drew.
 *
 * `--part whole` photographs the whole rig instead of one of its parts, which
 * is what a vertex-blended part -- the waist, the skirt -- has to be looked at
 * inside. The exporter bakes a motion frame into the hierarchy, so a whole rig
 * is an assembled, posed character and not the heap a bind pose would be.
 *
 *   node tools/civ_faces.mjs [--stage 2] [--part bone02|whole]
 *                            [--rig hito_gal] [--out civ_heads] [--bare]
 *
 * Output goes to `web/shots/`, which is gitignored -- a picture of a civilian
 * is derived game art and this repository commits none.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openPlayer, waitForLoad, SHOTS } from "./lib/player.mjs";

const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const flag = (n) => args.includes(`--${n}`);

const stage = Number(opt("stage", "2"));
const part = opt("part", "bone02");
const out = opt("out", "civ_heads");
const rig = opt("rig", "");
/** Leave the attachments off, for the before half of a pair. */
const bare = flag("bare");

const { page, state, close } = await openPlayer({
  url: `?stage=${stage}&freeze=1`, size: "800x600",
  headless: flag("headless"),
});

try {
  await waitForLoad(page);
  const shots = await page.evaluate(async ([st, pr, rg, at]) => {
    const m = await import("/tools/civ_faces_page.ts");
    return await m.run(st, pr, rg, at);
  }, [stage, part, rig, !bare]);

  mkdirSync(SHOTS, { recursive: true });
  for (const s of shots) {
    console.log(`${s.rig} ${s.part}`);
    for (const p of s.prims) {
      console.log(`    ${p.name.padEnd(30)} v=${String(p.verts).padStart(4)} `
        + `transparent=${p.transparent} opacity=${p.opacity} `
        + `alphaTest=${p.alphaTest} depthWrite=${p.depthWrite} `
        + `side=${p.side}`);
    }
    s.views.forEach((d, i) => {
      const png = Buffer.from(d.split(",")[1], "base64");
      const path = resolve(SHOTS, `${out}_${s.rig}_${i * 90}.png`);
      writeFileSync(path, png);
    });
  }
  console.log(`\n${shots.length} rigs, ${shots.length * 4} views -> ${SHOTS}`);
} finally {
  await close();
}
process.exit(state.faults ? 1 : 0);
