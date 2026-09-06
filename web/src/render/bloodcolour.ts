/**
 * Red blood or green, which is a **setting the game itself has**.
 *
 * `tex/scr_blood_red.bin` and `tex/scr_blood_green.bin` hold the same 39
 * images at the same global texture slots as the ordinary banks that ship
 * them, and the Blood Color option — the string is at `0x005971C4`, beside
 * `"  Red"` and `"Green"` — loads one bank over the other. So this is not an
 * invention: it is the option, offered where the player can reach it.
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
 * a second `CanvasTexture` built once per distinct map, and the toggle
 * assigns `material.map`. Reassigning a map is a path three.js takes every
 * frame for every video texture in the world, and it cannot be cached past.
 */
import { CanvasTexture, type Material, type Mesh, type Texture } from "three";
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
   * 153 materials in stage 1 share far fewer maps than that, and a
   * `CanvasTexture` per material would upload the same image many times.
   */
  private readonly swaps = new Map<Texture, Texture>();
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
    if (typeof document === "undefined") {
      if (!this.warned) {
        this.warned = true;
        console.warn("[bloodcolour] no document: blood stays as exported");
      }
      return null;
    }
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    if (!g) return null;
    g.drawImage(img as CanvasImageSource, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < d.data.length; i += 4) {
      const r = d.data[i];
      d.data[i] = d.data[i + 1];
      d.data[i + 1] = r;
    }
    g.putImageData(d, 0, 0);
    const out = new CanvasTexture(c);
    out.colorSpace = src.colorSpace;
    out.wrapS = src.wrapS;
    out.wrapT = src.wrapT;
    out.magFilter = src.magFilter;
    out.minFilter = src.minFilter;
    out.anisotropy = src.anisotropy;
    out.flipY = src.flipY;
    out.needsUpdate = true;
    this.swaps.set(src, out);
    return out;
  }

  /**
   * Give the transposes back.
   *
   * They are `CanvasTexture`s this layer minted, so nothing else will free
   * them, and a stage change makes every one of them unreachable.
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
