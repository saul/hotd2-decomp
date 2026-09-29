/**
 * The page's icons -- the favicon and the Home Screen's -- made when they are
 * asked for, from the install's own `Hod2.exe`.
 *
 * **The exe's icon is David's face** `[likely]`: its one icon group (resource
 * 101) holds a 32x32 and a 16x16 of a bald, torn zombie head with one eye
 * bulging, which is how the fan wiki describes David, the game's commonest
 * zombie; nothing in the exe names it. That is game data like the bundle and the
 * sounds, so it is never in the repository (`.gitignore` refuses every PNG):
 * the dev server makes the icons from the install the bundle's manifest names
 * (`vite.config.ts`), and `tools/site.ts` writes them into a staged site. With
 * no install to read, the icon is a red reticle drawn here.
 *
 * The 32x32 is scaled by whole pixels -- 5x for the 180 px iPhone icon, 6x
 * and 16x for Android's two -- on the page's own near-black, because a
 * smoothed 32 px face is a blur and an iOS icon with transparent corners is
 * drawn on black anyway.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

/** Every icon the page names (`index.html`, `manifest.webmanifest`), and its size. */
export const APP_ICONS: Readonly<Record<string, number>> = {
  "favicon.png": 32,
  "apple-touch-icon.png": 180,
  "icon-192.png": 192,
  "icon-512.png": 512,
};

/** `#05070a`, the loading screen's colour, behind a scaled icon. */
const BACK = [5, 7, 10, 255] as const;

interface Rgba {
  w: number;
  h: number;
  px: Uint8Array;
}

/** The named icon as a PNG, from the exe in `gameDir` where there is one. */
export function appIcon(name: string, gameDir: string | null): Buffer | null {
  const size = APP_ICONS[name];
  if (size === undefined) return null;
  let face: Rgba | null = null;
  if (gameDir) {
    try {
      face = exeIcon(readFileSync(join(gameDir, "Hod2.exe")));
    } catch { /* no install here, or not one this can read */ }
  }
  // The favicon keeps its own transparent corners; a Home Screen icon is opaque.
  const img = face ? scaled(face, size, name !== "favicon.png") : reticle(size);
  return png(img);
}

// -- the exe's icon ------------------------------------------------------------

/**
 * The largest, deepest image of the exe's first icon group, decoded. A PE's
 * resources are a three-level tree -- type, name, language -- and an icon is
 * two types: `RT_GROUP_ICON` (14) lists the images, `RT_ICON` (3) holds each
 * one as a DIB with its AND mask after it.
 */
export function exeIcon(exe: Uint8Array): Rgba | null {
  const dv = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const pe = dv.getUint32(0x3c, true);
  const nsec = dv.getUint16(pe + 6, true);
  const opt = pe + 24;
  const optSize = dv.getUint16(pe + 20, true);
  // The resource directory is data directory 2, after the PE32 header's 96 bytes.
  const rsrcRva = dv.getUint32(opt + 96 + 2 * 8, true);
  const secs: [number, number, number][] = [];
  for (let i = 0; i < nsec; i++) {
    const o = opt + optSize + i * 40;
    const vsize = dv.getUint32(o + 8, true), va = dv.getUint32(o + 12, true);
    const rsize = dv.getUint32(o + 16, true), raw = dv.getUint32(o + 20, true);
    secs.push([va, Math.max(vsize, rsize), raw]);
  }
  const off = (rva: number): number => {
    for (const [va, size, raw] of secs) if (rva >= va && rva < va + size) return rva - va + raw;
    throw new Error(`rva ${rva.toString(16)} is in no section`);
  };
  const base = off(rsrcRva);
  const entries = (dir: number): [number, number][] => {
    const n = dv.getUint16(dir + 12, true) + dv.getUint16(dir + 14, true);
    const out: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      out.push([dv.getUint32(dir + 16 + i * 8, true), dv.getUint32(dir + 20 + i * 8, true)]);
    }
    return out;
  };
  /** The first leaf under a subdirectory: its data, as a view. */
  const firstLeaf = (target: number): Uint8Array => {
    while (target & 0x80000000) target = entries(base + (target & 0x7fffffff))[0][1];
    const rva = dv.getUint32(base + target, true), size = dv.getUint32(base + target + 4, true);
    return exe.subarray(off(rva), off(rva) + size);
  };
  const icons = new Map<number, number>();
  let group: Uint8Array | null = null;
  for (const [type, target] of entries(base)) {
    if (!(target & 0x80000000)) continue;
    for (const [id, sub] of entries(base + (target & 0x7fffffff))) {
      if (type === 3) icons.set(id, sub);
      else if (type === 14 && !group) group = firstLeaf(sub);
    }
  }
  if (!group) return null;
  const g = new DataView(group.buffer, group.byteOffset, group.byteLength);
  let best: { w: number; bpp: number; id: number } | null = null;
  for (let i = 0; i < g.getUint16(4, true); i++) {
    const e = 6 + i * 14;
    const w = g.getUint8(e) || 256, bpp = g.getUint16(e + 6, true), id = g.getUint16(e + 12, true);
    if (!best || w > best.w || (w === best.w && bpp > best.bpp)) best = { w, bpp, id };
  }
  const leaf = best && icons.get(best.id);
  return leaf === undefined || leaf === null ? null : dib(firstLeaf(leaf));
}

/** An icon's DIB: `BITMAPINFOHEADER`, palette, colours bottom-up, AND mask. */
function dib(d: Uint8Array): Rgba | null {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const hdr = v.getUint32(0, true);
  const w = v.getInt32(4, true), h = v.getInt32(8, true) / 2;
  const bpp = v.getUint16(14, true);
  if (v.getUint32(16, true) !== 0 || ![1, 4, 8, 24, 32].includes(bpp)) return null;
  const colours = bpp <= 8 ? (v.getUint32(32, true) || 1 << bpp) : 0;
  const pal = hdr;
  const xor = pal + colours * 4;
  const xorRow = Math.ceil((w * bpp) / 32) * 4;
  const and = xor + xorRow * h;
  const andRow = Math.ceil(w / 32) * 4;
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = xor + (h - 1 - y) * xorRow;
    for (let x = 0; x < w; x++) {
      let b: number, gr: number, r: number, a = 255;
      if (bpp <= 8) {
        const bit = x * bpp;
        const idx = (d[row + (bit >> 3)] >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        b = d[pal + idx * 4]; gr = d[pal + idx * 4 + 1]; r = d[pal + idx * 4 + 2];
      } else {
        const p = row + x * (bpp / 8);
        b = d[p]; gr = d[p + 1]; r = d[p + 2];
        if (bpp === 32) a = d[p + 3];
      }
      if (bpp !== 32) {
        const m = and + (h - 1 - y) * andRow;
        if ((d[m + (x >> 3)] >> (7 - (x & 7))) & 1) a = 0;
      }
      px.set([r, gr, b, a], (y * w + x) * 4);
    }
  }
  return { w, h, px };
}

/** `src` by the largest whole factor that fits `size`, centred; opaque on `BACK` if asked. */
function scaled(src: Rgba, size: number, opaque: boolean): Rgba {
  const k = Math.max(1, Math.floor(size / Math.max(src.w, src.h)));
  const ox = Math.floor((size - src.w * k) / 2), oy = Math.floor((size - src.h * k) / 2);
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = Math.floor((x - ox) / k), sy = Math.floor((y - oy) / k);
      const o = (y * size + x) * 4;
      const inside = x >= ox && y >= oy && sx < src.w && sy < src.h;
      const s = inside ? (sy * src.w + sx) * 4 : -1;
      const a = s >= 0 ? src.px[s + 3] / 255 : 0;
      for (let c = 0; c < 3; c++) {
        const fg = s >= 0 ? src.px[s + c] : 0;
        px[o + c] = opaque ? Math.round(fg * a + BACK[c] * (1 - a)) : fg;
      }
      px[o + 3] = opaque ? 255 : Math.round(a * 255);
    }
  }
  return { w: size, h: size, px };
}

// -- without an install ------------------------------------------------------------

/** A red reticle on `BACK`, four samples a side a pixel. */
function reticle(size: number): Rgba {
  const px = new Uint8Array(size * size * 4);
  const u = size / 512;
  const red = [0xd0, 0x14, 0x2c];
  const hit = (x: number, y: number): boolean => {
    const dx = x - 256, dy = y - 256, r = Math.hypot(dx, dy);
    if (Math.abs(r - 150) <= 13 || r <= 18) return true;
    const along = (a: number, b: number) => Math.abs(a) <= 13 && Math.abs(b) >= 76 && Math.abs(b) <= 196;
    return along(dx, dy) || along(dy, dx);
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let n = 0;
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 4; i++) if (hit((x + (i + 0.5) / 4) / u, (y + (j + 0.5) / 4) / u)) n++;
      }
      const a = n / 16, o = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) px[o + c] = Math.round(red[c] * a + BACK[c] * (1 - a));
      px[o + 3] = 255;
    }
  }
  return { w: size, h: size, px };
}

// -- PNG ------------------------------------------------------------------------------

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** 8-bit RGBA, every row unfiltered. */
export function png(img: Rgba): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((img.w * 4 + 1) * img.h);
  for (let y = 0; y < img.h; y++) {
    raw.set(img.px.subarray(y * img.w * 4, (y + 1) * img.w * 4), y * (img.w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0)),
  ]);
}
