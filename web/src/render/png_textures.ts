/**
 * The stage's textures, decoded by the page and not by the browser.
 *
 * **Why.** The bundle's images carry the bank's alpha, and the game shows the
 * colour under a transparent texel wherever a mesh draws in the opaque pass:
 * 3,147 opaque-pass meshes sit on textures with transparent texels
 * (`docs/formats/materials.md`, "Texture alpha"). `GLTFLoader`'s
 * `ImageBitmapLoader` asks for `premultiplyAlpha: "none"`, and Chrome honours
 * it to the byte. **WebKit does not**: Safari decodes a PNG into a
 * premultiplied buffer and un-premultiplies afterwards, so a texel at alpha 0
 * has no colour left to give back and arrives black. Stage 1's dead civilian
 * (`hito_marioaa`, evt 5448) is the case that was reported -- his trouser legs,
 * `tex_003` and `tex_004`, carry 617 and 827 such texels on bones 10/13 and
 * 11/14, and drew black knees in Safari alone.
 *
 * So every image is decoded here, by `decodeRgba`, into a `DataTexture` of the
 * file's own bytes, in every browser -- one path, so the headless checks in
 * Chrome exercise exactly what Safari draws. A PNG that is not the shape the
 * exporter writes falls through to the `ImageBitmapLoader` it replaces.
 *
 * It is the loader `GLTFLoader` calls from `loadImageSource`: `load(url,
 * onLoad, onProgress, onError)`, where a loader that is not an
 * `ImageBitmapLoader` hands `onLoad` the finished texture. The URL is the blob
 * URL the parser made of the image's buffer view.
 */
import {
  DataTexture, ImageBitmapLoader, RGBAFormat, Texture, UnsignedByteType,
} from "three";
import type { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/** The part of a three.js loader `GLTFLoader` reaches for. */
interface TextureSourceLoader {
  load(url: string, onLoad: (t: Texture) => void,
       onProgress?: unknown, onError?: (e: unknown) => void): void;
  setCrossOrigin(v: string): unknown;
  setRequestHeader(h: Record<string, string>): unknown;
}

export class StraightPngLoader implements TextureSourceLoader {
  /** Not an `ImageBitmapLoader`: `onLoad` takes the texture itself. */
  readonly isImageBitmapLoader = false;
  /**
   * The loader this stands in for, as `GLTFLoader` makes it: three's
   * `ImageBitmapLoader` at its defaults, `premultiplyAlpha: "none"`.
   */
  private readonly fallback = new ImageBitmapLoader();

  setCrossOrigin(v: string): this {
    this.fallback.setCrossOrigin(v);
    return this;
  }

  setRequestHeader(h: Record<string, string>): this {
    this.fallback.setRequestHeader(h);
    return this;
  }

  load(url: string, onLoad: (t: Texture) => void, _onProgress?: unknown,
       onError?: (e: unknown) => void): void {
    void (async () => {
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      const img = await decodeRgba(bytes);
      if (img) {
        const t = new DataTexture(img.data, img.width, img.height, RGBAFormat,
                                  UnsignedByteType);
        t.needsUpdate = true;
        onLoad(t);
        return;
      }
      this.fallback.load(url, (bitmap) => {
        const t = new Texture(bitmap);
        t.needsUpdate = true;
        onLoad(t);
      }, undefined, onError);
    })().catch((e) => onError?.(e));
  }
}

/**
 * A `GLTFLoader` whose parser decodes images with {@link StraightPngLoader}.
 *
 * `parser.textureLoader` is set in the parser's constructor, inside `parse`,
 * and the plugin factories are called on the new parser straight after it --
 * before any texture is asked for -- so a factory is where it can be swapped.
 */
export function useStraightPngTextures(loader: GLTFLoader): GLTFLoader {
  return loader.register((parser) => {
    (parser as unknown as { textureLoader: TextureSourceLoader })
      .textureLoader = new StraightPngLoader();
    return { name: "hod2_straight_png" };
  });
}

/** What {@link decodeRgba} hands back: straight RGBA8888, rows top first. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array<ArrayBuffer>;
}

/** The one zlib stream every `IDAT` of a PNG is a piece of, inflated. */
async function inflate(z: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate");
  const out = new Response(new Blob([z as Uint8Array<ArrayBuffer>]).stream()
    .pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

/**
 * Decode a PNG of the shape `encodeRgba` (`hod2lib/png.ts`) writes -- 8-bit RGBA, not
 * interlaced -- into its **straight** bytes, alpha and the colour under a
 * transparent texel both exactly as stored. Every row filter is undone, not
 * only the 0 this file writes, so an image re-encoded by another tool still
 * reads. Anything else (a palette, 16 bits, Adam7) is null, and the caller
 * keeps whatever decoder it had.
 *
 * Here and not beside the encoder in `hod2lib/`, because everything in that
 * directory is the exporter's digest (`tools/gen/builder_hash.ts`), and a
 * decoder the exporter never runs would re-stamp every bundle.
 */
export async function decodeRgba(png: Uint8Array): Promise<RgbaImage | null> {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.length < 8 || SIG.some((b, i) => png[i] !== b)) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let width = 0, height = 0, ok = false;
  const idat: Uint8Array[] = [];
  for (let p = 8; p + 12 <= png.length;) {
    const len = view.getUint32(p);
    const tag = String.fromCharCode(png[p + 4], png[p + 5], png[p + 6], png[p + 7]);
    const body = png.subarray(p + 8, p + 8 + len);
    if (tag === "IHDR") {
      width = view.getUint32(p + 8);
      height = view.getUint32(p + 12);
      // Bit depth 8, colour type 6 (RGBA), compression 0, filter 0,
      // interlace 0: the one shape this reads.
      ok = body[8] === 8 && body[9] === 6 && body[10] === 0 && body[11] === 0
        && body[12] === 0;
    } else if (tag === "IDAT") {
      idat.push(body);
    } else if (tag === "IEND") {
      break;
    }
    p += 12 + len;
  }
  if (!ok || !width || !height || !idat.length) return null;
  const z = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of idat) { z.set(c, at); at += c.length; }
  const raw = await inflate(z);
  const stride = width * 4;
  if (raw.length < height * (stride + 1)) return null;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = y * stride;
    if (f === 0) { data.set(src, row); continue; }
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? data[row + x - 4] : 0;
      const b = y > 0 ? data[row - stride + x] : 0;
      const c = x >= 4 && y > 0 ? data[row - stride + x - 4] : 0;
      let v: number;
      switch (f) {
        case 1: v = a; break;
        case 2: v = b; break;
        case 3: v = (a + b) >> 1; break;
        case 4: {
          const pa = Math.abs(b - c), pb = Math.abs(a - c),
            pc = Math.abs(a + b - 2 * c);
          v = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: return null;
      }
      data[row + x] = (src[x] + v) & 0xff;
    }
  }
  return { width, height, data };
}
