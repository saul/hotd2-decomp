/**
 * Screenshots of the meshes whose texture alpha the exporter used to strip.
 *
 * Driven (`?drive=1`), so a frame count names the same picture before and
 * after a change to the bundle. Each view is a URL and the frames to shoot at;
 * the character types on screen are printed beside each shot so a frame with
 * nothing of interest in it reads as such rather than as "no change".
 *
 *   HOTD2_BUNDLE=../extract/player_before node tools/texalpha_look.mjs \
 *       --headless --tag old
 *   node tools/texalpha_look.mjs --headless --tag after --only zslman \
 *       --size 2560x1600 --frames 170 --clip 880,720,640,360
 *   node tools/shot_diff.mjs shots/texalpha-zslman-170-old-clip.png \
 *       shots/texalpha-zslman-170-after-clip.png --out shots/zslman-diff.png
 *
 * The bundle to compare against is the same stages exported by the old
 * exporter into a directory of their own, served through `HOTD2_BUNDLE`.
 *
 * Output: `web/shots/texalpha-<view>-<frame>-<tag>.png` (gitignored).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openPlayer, waitForLoad, SHOTS } from "./lib/player.mjs";

const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const flag = (n) => args.includes(`--${n}`);

/**
 * Where each model the change touches is on screen.
 *
 * * `zslman` (character type 0x18): bones `0x1FEF` and `0x1FF3` are additive
 *   meshes with `IgnoreTexAlpha` and `UseAlpha` both set, on an ARGB4444
 *   texture 82% of whose texels are below full alpha.
 * * `zndina` (type 3): bones `0x1BEB` and `0x1BED`, the same.
 * * `ladder`: the other side of it -- opaque-pass meshes on textures with
 *   transparent texels (`komono_tokeidai` 0 is 68% alpha 0, and the player
 *   bodies in the shot carry more), which must come out the same.
 */
const VIEWS = {
  zslman: { url: "?stage=6&block=0&step=4&op=8", frames: [30, 90, 150, 240] },
  zndina: { url: "?stage=6&block=0&step=5&op=12", frames: [60, 150, 240, 360] },
  ladder: { url: "?stage=2&block=21&step=4&op=6", frames: [60, 200] },
};

const tag = opt("tag", "shot");
const only = opt("only");
/** `--frames 150,165,180` overrides the view's list. */
const frames = opt("frames")?.split(",").map(Number) ?? null;
/** `--clip x,y,w,h`, in page pixels: a second, cropped file beside each shot. */
const clip = opt("clip")?.split(",").map(Number) ?? null;
mkdirSync(SHOTS, { recursive: true });

for (const [name, v] of Object.entries(VIEWS)) {
  if (only && only !== name) continue;
  const { page, close } = await openPlayer({
    url: `${v.url}&drive=1&seed=1`, size: opt("size", "1280x800"),
    headless: flag("headless"), quiet: !flag("loud"),
  });
  try {
    await waitForLoad(page);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Space");
    let at = 0;
    for (const f of frames ?? v.frames) {
      await page.evaluate((k) => globalThis.__hotd2Drive.advance(k), f - at);
      at = f;
      const seen = await page.evaluate(async () => {
        const { G } = await import("/src/game/globals.ts");
        return G.g_object_list
          .filter((o) => !o.despawned && !o.dead)
          .map((o) => `${o.cls.toString(16)}/${(o.charType ?? -1).toString(16)}`);
      });
      const out = join(SHOTS, `texalpha-${name}-${f}-${tag}.png`);
      await page.screenshot({ path: out });
      if (clip) {
        const [x, y, width, height] = clip;
        await page.screenshot({ path: out.replace(/\.png$/, "-clip.png"),
                                clip: { x, y, width, height } });
      }
      console.log(`${name} f${f}: ${out}  [${[...new Set(seen)].join(" ")}]`);
    }
  } finally {
    await close();
  }
}
