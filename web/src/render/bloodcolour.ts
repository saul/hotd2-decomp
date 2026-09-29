/**
 * Red blood or green: the two banks the game ships.
 *
 * `tex/scr_blood_red.bin` and `tex/scr_blood_green.bin` hold the same 39
 * images at the same global texture slots as the ordinary banks that ship
 * them. The options screen has a Blood Color row -- the string is at
 * `0x005971C4`, beside `"  Red"` and `"Green"` -- **but in this build the row
 * is never shown and its setting is never read**: `g_options_blood_row_shown`
 * has one store, a 0, and `g_option_blood_color` (`0x009C9F22`) no reader
 * but the screen's own copy, which the boot overwrites with 1
 * (`docs/re/options-screen.md`, `tools/verify_options.py`). What loads the
 * red bank, and when, is `[open]`. So this switch is the page's, between two
 * sets of art the game carries; it was described as the game's option until
 * the options screen was read.
 *
 * The exporter marks every material that draws one of those slots with
 * `extras.hod2_blood`, which `GLTFLoader` delivers as `material.userData`.
 * That is 27 `pol/` files' worth, and most of it is **not** the spray: it is
 * the gore parts a zombie swaps in when a limb comes off, and the decals. A
 * setting that only recoloured the flipbook would leave green stumps on a red
 * corpse.
 *
 * ## Why a channel swap, and why it is done to the texture
 *
 * The two banks are the same art twice. **[measured]** 27 of the 39 textures
 * are an exact `R <-> G` transposition of each other, byte for byte; the other
 * twelve differ only in a few units of blue on the green side — `(131, 0, 0)`
 * against `(0, 131, 8)` on the worst texel of the worst one. So transposing
 * the two channels reproduces the other bank to within a difference nothing
 * can see, and costs no extra image in the bundle.
 *
 * [diverges] Those twelve are therefore approximated rather than exported.
 * Carrying both banks would be exact and would double the blood images.
 *
 * **The first cut did the transpose in the fragment shader, through
 * `onBeforeCompile`, and it did not work.** The swap landed on whichever
 * state a blood material happened to compile in and never moved again: the
 * measured pixel counts were red under *both* settings, with green never
 * appearing at all. Setting `needsUpdate` and varying `customProgramCacheKey`
 * did not rebuild it. So the transpose is done to the **texture** instead —
 * a second texture built once per distinct map, and the toggle assigns
 * `material.map`. Reassigning a map is a path three.js takes every frame for
 * every video texture in the world, and it cannot be cached past.
 *
 * ## Why the pixels are read back through WebGL and not a 2D canvas
 *
 * The images carry the alpha the bank stores, because the game's textures
 * do (`DecodeTextureToSurface`, `FUN_004AC270`), and 904 of the blood meshes
 * are gore parts drawn in the **opaque** pass on ARGB1555/4444 textures with
 * transparent texels. That pass ignores alpha and shows the colour under it.
 * A 2D canvas stores premultiplied, so `getImageData` hands back black for
 * every texel at alpha 0 and a colour rounded to the alpha's own steps for
 * the rest -- a transpose made that way turns those texels black on screen.
 * This used to be harmless because the exporter stripped the alpha of every
 * opaque-pass texture; it no longer does. A texture uploaded to WebGL with
 * premultiplication off and read back with `readPixels` is the file's bytes
 * exactly, so that is how the transpose gets them.
 */
import {
  DataTexture, RGBAFormat, UnsignedByteType,
  type Material, type Mesh, type Texture,
} from "three";
import type { System } from "../core/system";

/** Which of the game's two blood banks the player is looking at. */
export type BloodColour = "red" | "green";

/** The bundle's own colour: `tex/common.bin` ships the green images. */
export const BUNDLE_BLOOD: BloodColour = "green";

/** What the marking looks like once `GLTFLoader` has delivered it. */
interface BloodMaterial extends Material {
  userData: { hod2_blood?: boolean };
  map?: Texture | null;
}

/** The two maps for one material: what the bundle carried, and the transpose. */
interface Pair {
  bundle: Texture;
  swapped: Texture;
}

export class BloodColourLayer implements System {
  readonly id = "render.bloodcolour";
  private mode: BloodColour = "red";
  /** Every marked material in the current stage, with both of its maps. */
  private readonly seen = new Map<BloodMaterial, Pair>();
  /**
   * One transpose per distinct source texture.
   *
   * 153 materials in stage 1 share far fewer maps than that, and a texture
   * per material would upload the same image many times.
   */
  private readonly swaps = new Map<Texture, Texture>();
  /** The readback context, for the length of one `prepare`. */
  private reader: WebGLRenderingContext | null = null;
  /** Said once: a headless run has no `document` and cannot build one. */
  private warned = false;

  get colour(): BloodColour { return this.mode; }

  /**
   * A stage has loaded: collect the marked materials and build the transposes.
   *
   * Called beside `texFilter.prepare`, and for the same reason — the
   * materials only exist once the glTF has been parsed, and by then
   * `GLTFLoader` has decoded every image it references.
   */
  prepare(root: { traverse: (f: (o: unknown) => void) => void }): void {
    this.dispose();
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const bm = m as BloodMaterial;
        if (!bm?.userData?.hod2_blood || this.seen.has(bm)) continue;
        const bundle = bm.map;
        if (!bundle) continue;
        const swapped = this.transpose(bundle);
        if (swapped) this.seen.set(bm, { bundle, swapped });
      }
    });
    this.releaseReader();
    this.applyAll();
  }

  setColour(mode: BloodColour): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.applyAll();
  }

  private applyAll(): void {
    const swap = this.mode !== BUNDLE_BLOOD;
    for (const [m, pair] of this.seen) {
      m.map = swap ? pair.swapped : pair.bundle;
      m.needsUpdate = true;
    }
  }

  /**
   * One texture with its red and green channels exchanged.
   *
   * Everything else is copied off the source, `colorSpace` included: getting
   * that wrong is a gamma shift on the blood alone, which reads as the wrong
   * shade rather than as a bug.
   */
  private transpose(src: Texture): Texture | null {
    const hit = this.swaps.get(src);
    if (hit) return hit;
    const img = src.image as
      { width?: number; height?: number } | null | undefined;
    if (!img?.width || !img.height) return null;
    const px = this.straightPixels(img as TexImageSource, img.width, img.height);
    if (!px) return null;
    transposeRedGreen(px);
    const out = new DataTexture(px, img.width, img.height, RGBAFormat,
                                UnsignedByteType);
    out.colorSpace = src.colorSpace;
    out.wrapS = src.wrapS;
    out.wrapT = src.wrapT;
    out.magFilter = src.magFilter;
    out.minFilter = src.minFilter;
    out.anisotropy = src.anisotropy;
    // `readPixels` returns rows in the order the upload below put them in,
    // which is the source's with `flipY` off: the same order for the same
    // flag. Mipmaps as the canvas texture this replaced had them, so that a
    // forced trilinear filter (`texfilter.ts`) finds a complete texture.
    out.flipY = src.flipY;
    out.generateMipmaps = true;
    out.needsUpdate = true;
    this.swaps.set(src, out);
    return out;
  }

  /**
   * The image's RGBA bytes exactly as the file holds them, alpha and the
   * colour under a transparent texel included -- or null, said once, where
   * there is no WebGL to ask (a headless run).
   *
   * `GLTFLoader`'s `ImageBitmapLoader` decodes with `premultiplyAlpha: "none"`,
   * so an upload with `UNPACK_PREMULTIPLY_ALPHA_WEBGL` off and no colour-space
   * conversion puts the file's bytes in the texture, and a framebuffer over it
   * reads them back.
   */
  private straightPixels(img: TexImageSource, w: number,
                         h: number): Uint8Array<ArrayBuffer> | null {
    const gl = this.readerContext();
    if (!gl) return null;
    const tex = gl.createTexture();
    const fb = gl.createFramebuffer();
    try {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
                              gl.TEXTURE_2D, tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER)
          !== gl.FRAMEBUFFER_COMPLETE) {
        return null;
      }
      const out = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return out;
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb);
      gl.deleteTexture(tex);
    }
  }

  /** The one context the readback uses, made on first need. */
  private readerContext(): WebGLRenderingContext | null {
    if (this.reader) return this.reader;
    const canvas = typeof document === "undefined"
      ? null : document.createElement("canvas");
    this.reader = canvas?.getContext("webgl", { premultipliedAlpha: false })
      ?? null;
    if (!this.reader && !this.warned) {
      this.warned = true;
      console.warn("[bloodcolour] no WebGL to read the images back: blood "
        + "stays as exported");
    }
    return this.reader;
  }

  /** Let the readback context go: `prepare` is done with it. */
  private releaseReader(): void {
    this.reader?.getExtension("WEBGL_lose_context")?.loseContext();
    this.reader = null;
  }

  /**
   * Give the transposes back.
   *
   * They are textures this layer minted, so nothing else will free them, and
   * a stage change makes every one of them unreachable.
   */
  dispose(): void {
    for (const t of this.swaps.values()) t.dispose();
    this.swaps.clear();
    this.seen.clear();
  }

  /** What the panel says. */
  get describe(): string {
    if (!this.seen.size) return "no blood materials in this bundle";
    // The count is what each material is **actually holding**, not what the
    // mode says it should be: a material the layer marked but whose map some
    // other layer replaced is exactly the failure this has to be able to show.
    let swapped = 0;
    for (const [m, pair] of this.seen) if (m.map === pair.swapped) swapped++;
    return `${this.mode}, ${swapped}/${this.seen.size} swapped, `
      + `${this.swaps.size} maps`;
  }
}

/**
 * Exchange the red and green bytes of every RGBA texel, in place, and touch
 * nothing else: the alpha and the blue stay the file's, and so does the
 * colour under a transparent texel, which the opaque pass shows.
 */
export function transposeRedGreen(rgba: Uint8Array): void {
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const r = rgba[i];
    rgba[i] = rgba[i + 1];
    rgba[i + 1] = r;
  }
}
