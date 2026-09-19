/**
 * Stage 2 block 0x19's sheet, in the page: run from the step that places the
 * horde, screenshot every `--every` frames until the members are under the
 * sheet, and print where the script and the members are at each one.
 *
 *     node tools/horde_sheet_look.mjs --headless [--frames 3000 --every 300]
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openPlayer, pull, waitForLoad, SHOTS } from "./lib/player.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const frames = Number(opt("frames", "3000"));
const every = Number(opt("every", "300"));
const url = `?stage=2&mode=play&block=25&step=${opt("step", "1")}&drive=1`;
mkdirSync(SHOTS, { recursive: true });
const { page, state, close } = await openPlayer({
  url, size: "1280x800", headless: args.includes("--headless"), quiet: true,
});
await waitForLoad(page);
await page.keyboard.press("Space");
const advance = (n) => page.evaluate((k) => globalThis.__hotd2Drive.advance(k), n);
const now = () => page.evaluate(() => globalThis.__hotd2Drive.now());
const box = await page.locator("#viewport").boundingBox();
/**
 * Step 1's room has an ordinary enemy in it, and step 2 -- the one that lets
 * the horde in -- is behind it. `--shoot` fires a volley across the frame
 * whenever an enemy is counted and the horde is not (`L45`: printed).
 */
const shoot = args.includes("--shoot");
let volleys = 0;
for (let f = 0; f < frames; f += every) {
  for (let k = 0; k < every; k += 20) {
    await advance(20);
    const r = await now();
    const horde = r.o.some((l) => l.includes(" c64 ") && / s[1-5]\./.test(l));
    if (shoot && !horde && /^e[1-9]/.test(r.c) && r.a.startsWith("25/1/")) {
      volleys += 1;
      for (let y = 0; y < 4; y += 1) {
        for (let x = 0; x < 6; x += 1) {
          await pull(page, box.x + box.width * (x + 0.5) / 6,
                                 box.y + box.height * (y + 0.5) / 4);
        }
      }
    }
  }
  const row = await now();
  const ms = row.o.filter((l) => l.includes(" c64 ")
    && Number(l.split(" ")[0]) >= 0x10000000);
  if (row.f >= Number(opt("from", "0"))) {
    const p = join(SHOTS, `horde-sheet-${String(row.f).padStart(5, "0")}.png`);
    await page.screenshot({ path: p });
  }
  console.log(`${row.f} ${row.a} ${row.c} | ${ms.slice(0, 5).join(" ; ")}`);
}
console.log(`faults ${state.faults}; volleys (override) ${volleys}`);
await close();
