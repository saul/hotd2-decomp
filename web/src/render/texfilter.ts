/**
 * Texture filtering, as an **override** of what the game asked for.
 *
 * This is not a setting the player invents. Every mesh in the game carries its
 * own filter in its TSP word, and the exporter already honours it: `gltf.py`'s
 * `get_sampler` emits one glTF sampler per `(wrapS, wrapT, filter)` triple,
 * with `NEAREST` when the mesh's `filter_mode` is 0 and `LINEAR` otherwise, and
 * the wrap modes off the `clamp_uv` / `flip_uv` bits. So the bundle that comes
 * off the disc already says, per mesh, how it wants to be sampled — and
 * `GLTFLoader` applies it.
 *
 * That is why `"asset"` is the default and every other mode is a **forced**
 * one. The original hardware did bilinear with no mipmaps, so trilinear and
 * anisotropic are not more faithful, they are nicer: the game is full of long
 * floors and walls seen at grazing angles, which is exactly what anisotropy is
 * for, and exactly where an unmipmapped texture shimmers.
 *
 * **Restoring `"asset"` needs the original remembered.** Once a mode has
 * overwritten `minFilter`, what the sampler said is gone, so the first sight of
 * each texture records it. The map is keyed on the texture object and holds
 * nothing else, so a stage change drops the entries with the textures.
 *
 * Only the stage's own root is walked. The label and splat `CanvasTexture`s the
 * debug layers mint are not part of the scene the game describes, and forcing
 * nearest on a text label would only make it unreadable.
 */
import {
  LinearFilter, LinearMipmapLinearFilter, NearestFilter,
  type MagnificationTextureFilter, type Mesh, type MinificationTextureFilter,
  type Texture, type WebGLRenderer,
} from "three";
import type { System } from "../core/system";

/**
 * The modes offered, and what each one is.
 *
 * `asset` is not a filter: it is "put back whatever the mesh asked for",
 * which for this game is per-mesh nearest or bilinear.
 */
export type TextureFilterMode =
  | "asset" | "nearest" | "bilinear" | "trilinear" | "aniso";

/** What the glTF sampler said, before anything overrode it. */
interface Original {
  min: MinificationTextureFilter;
  mag: MagnificationTextureFilter;
  aniso: number;
}

export class TextureFilter implements System {
  readonly id = "render.texfilter";
  private mode: TextureFilterMode = "asset";
  /**
   * Every texture this layer has touched, and what it looked like first.
   *
   * A plain `Map` rather than a `WeakMap`: `clear()` on a stage change is what
   * releases them, and being able to walk the set is what lets a mode change
   * reach textures whose mesh is currently hidden by the region visibility.
   */
  private readonly seen = new Map<Texture, Original>();
  private maxAniso = 1;

  /**
   * The renderer's anisotropy ceiling. Hardware-dependent — 16 on anything
   * current, but it is asked for rather than assumed, because requesting more
   * than the limit is silently clamped and would make the label a lie.
   */
  setRenderer(renderer: WebGLRenderer): void {
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
  }

  /** How far anisotropy can actually go, for the control's label. */
  get anisotropyLimit(): number {
    return this.maxAniso;
  }

  get filterMode(): TextureFilterMode {
    return this.mode;
  }

  /**
   * A stage has loaded: collect its textures and apply the current mode.
   *
   * Called from `stage_load.ts` beside `sceneFog.prepare`, and for the same
   * reason — the materials only exist once the glTF has been parsed.
   */
  prepare(root: { traverse: (f: (o: unknown) => void) => void }): void {
    this.seen.clear();
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        // Only the colour map. Normal and roughness maps would want the same
        // treatment, and this bundle has neither.
        const tex = (m as { map?: Texture | null }).map;
        if (!tex || this.seen.has(tex)) continue;
        this.seen.set(tex, {
          min: tex.minFilter, mag: tex.magFilter, aniso: tex.anisotropy,
        });
      }
    });
    this.applyAll();
  }

  setMode(mode: TextureFilterMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.applyAll();
  }

  private applyAll(): void {
    for (const [tex, was] of this.seen) this.applyOne(tex, was);
  }

  /**
   * One texture.
   *
   * `needsUpdate` is the load-bearing line. Changing `minFilter` to a mipmap
   * variant does not build the mip chain on its own — the texture has to be
   * re-uploaded for three.js to generate it, and without this the trilinear
   * and anisotropic modes look exactly like bilinear.
   */
  private applyOne(tex: Texture, was: Original): void {
    const before = `${tex.minFilter}|${tex.magFilter}|${tex.anisotropy}`;
    switch (this.mode) {
      case "asset":
        tex.minFilter = was.min;
        tex.magFilter = was.mag;
        tex.anisotropy = was.aniso;
        break;
      case "nearest":
        tex.minFilter = NearestFilter;
        tex.magFilter = NearestFilter;
        tex.anisotropy = 1;
        break;
      case "bilinear":
        tex.minFilter = LinearFilter;
        tex.magFilter = LinearFilter;
        tex.anisotropy = 1;
        break;
      case "trilinear":
        tex.minFilter = LinearMipmapLinearFilter;
        tex.magFilter = LinearFilter;
        tex.anisotropy = 1;
        break;
      case "aniso":
        tex.minFilter = LinearMipmapLinearFilter;
        tex.magFilter = LinearFilter;
        tex.anisotropy = this.maxAniso;
        break;
    }
    // `generateMipmaps` follows the filter: a non-mipmap `minFilter` with
    // mipmaps still on wastes the upload, and a mipmap one without them draws
    // black.
    tex.generateMipmaps = tex.minFilter === LinearMipmapLinearFilter;
    if (`${tex.minFilter}|${tex.magFilter}|${tex.anisotropy}` !== before) {
      tex.needsUpdate = true;
    }
  }
}
