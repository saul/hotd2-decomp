/**
 * Pixel-diff two screenshots: how many pixels differ, by how much, and where.
 *
 * Decoded in a headless Chrome canvas because this repository carries no PNG
 * decoder. A screenshot has no alpha channel, so the canvas's premultiplied
 * storage costs nothing here.
 *
 *   node tools/shot_diff.mjs a.png b.png [--region x,y,w,h] [--out diff.png]
 *
 * `--out` writes the differing pixels in red over a darkened copy of `a`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const opt = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : null;
};
const [a, b] = args.filter((x, i) => !x.startsWith("--")
  && !(i > 0 && args[i - 1].startsWith("--")));
const region = opt("region")?.split(",").map(Number) ?? null;
const out = opt("out");

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  const url = (p) => `data:image/png;base64,${readFileSync(p).toString("base64")}`;
  const res = await page.evaluate(async ({ ua, ub, region, wantOut }) => {
    const load = (u) => new Promise((ok, fail) => {
      const im = new Image();
      im.onload = () => ok(im);
      im.onerror = fail;
      im.src = u;
    });
    const [ia, ib] = await Promise.all([load(ua), load(ub)]);
    if (ia.width !== ib.width || ia.height !== ib.height) {
      return { error: `sizes differ: ${ia.width}x${ia.height} vs ${ib.width}x${ib.height}` };
    }
    const [x, y, w, h] = region ?? [0, 0, ia.width, ia.height];
    const px = (im) => {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const g = c.getContext("2d");
      g.drawImage(im, -x, -y);
      return [c, g, g.getImageData(0, 0, w, h)];
    };
    const [ca, ga, da] = px(ia);
    const [, , db] = px(ib);
    let n = 0, max = 0, sum = 0;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let i = 0; i < w * h; i++) {
      const d = Math.max(Math.abs(da.data[i * 4] - db.data[i * 4]),
                         Math.abs(da.data[i * 4 + 1] - db.data[i * 4 + 1]),
                         Math.abs(da.data[i * 4 + 2] - db.data[i * 4 + 2]));
      if (d > 0) {
        n++; sum += d; max = Math.max(max, d);
        const px_ = i % w, py = Math.floor(i / w);
        x0 = Math.min(x0, px_); x1 = Math.max(x1, px_);
        y0 = Math.min(y0, py); y1 = Math.max(y1, py);
        if (wantOut) {
          da.data[i * 4] = 255; da.data[i * 4 + 1] = 0; da.data[i * 4 + 2] = 0;
        }
      } else if (wantOut) {
        for (let k = 0; k < 3; k++) da.data[i * 4 + k] >>= 2;
      }
    }
    let png = null;
    if (wantOut) {
      ga.putImageData(da, 0, 0);
      png = ca.toDataURL("image/png");
    }
    return { total: w * h, n, max, mean: n ? sum / n : 0,
             box: n ? [x + x0, y + y0, x1 - x0 + 1, y1 - y0 + 1] : null, png };
  }, { ua: url(a), ub: url(b), region, wantOut: !!out });
  if (res.error) throw new Error(res.error);
  if (out && res.png) {
    writeFileSync(out, Buffer.from(res.png.split(",")[1], "base64"));
  }
  console.log(`${res.n} of ${res.total} pixels differ `
    + `(${(100 * res.n / res.total).toFixed(3)}%), max ${res.max}, `
    + `mean ${res.mean.toFixed(1)}, box ${JSON.stringify(res.box)}`
    + (out ? `, map ${out}` : ""));
} finally {
  await browser.close();
}
