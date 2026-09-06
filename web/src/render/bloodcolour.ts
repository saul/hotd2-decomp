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
 * ## Why a channel swap rather than a second set of textures
 *
 * The two banks are the same art twice. **[measured]** 27 of the 39 textures
 * are an exact `R <-> G` transposition of each other, byte for byte; the other
 * twelve differ only in a few units of blue on the green side — `(131, 0, 0)`
 * against `(0, 131, 8)` on the worst texel of the worst one. So swapping the
 * two channels in the shader reproduces the other bank to within a difference
 * nothing can see, and costs no extra image in the bundle.
 *
 * [diverges] Those twelve textures are therefore approximated rather than
 * exported. Carrying both banks would be exact and would double the blood
 * images; if that ever matters, the marking is already per-material and the
 * swap here becomes a map assignment instead.
 *
 * The default is **red**, which is what the exporter binds nothing for: the
 * bundle carries whatever bank the model's own `pol/` file names, and for the
 * blood models that is green. So "red" is the swap and "green" is the bundle
 * as it stands — the opposite way round from how the option reads, which is
 * why this is a `mode` and not a boolean.
 */
import type { Material, Mesh, WebGLProgramParametersWithUniforms }
  from "three";
import type { System } from "../core/system";

/** Which of the game's two blood banks the player is looking at. */
export type BloodColour = "red" | "green";

/** The bundle's own colour: `tex/common.bin` ships the green images. */
export const BUNDLE_BLOOD: BloodColour = "green";

/** What the marking looks like once `GLTFLoader` has delivered it. */
interface BloodMaterial extends Material {
  userData: { hod2_blood?: boolean };
  customProgramCacheKey: () => string;
}

export class BloodColourLayer implements System {
  readonly id = "render.bloodcolour";
  private mode: BloodColour = "red";
  /** Every marked material in the current stage. Cleared with the stage. */
  private readonly seen = new Set<BloodMaterial>();

  get colour(): BloodColour { return this.mode; }

  /**
   * A stage has loaded: collect the marked materials.
   *
   * Called beside `texFilter.prepare`, and for the same reason — the
   * materials only exist once the glTF has been parsed.
   */
  prepare(root: { traverse: (f: (o: unknown) => void) => void }): void {
    this.seen.clear();
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const bm = m as BloodMaterial;
        if (bm?.userData?.hod2_blood) this.seen.add(bm);
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
    for (const m of this.seen) this.applyOne(m);
  }

  /**
   * One material.
   *
   * `needsUpdate` is the load-bearing line: `onBeforeCompile` runs when the
   * program is built, so changing it on a material three.js has already
   * compiled does nothing at all until the program is invalidated.
   */
  private applyOne(m: BloodMaterial): void {
    const swap = this.mode !== BUNDLE_BLOOD;
    m.onBeforeCompile = swap
      ? (shader: WebGLProgramParametersWithUniforms) => {
          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <map_fragment>",
            "#include <map_fragment>\n\tdiffuseColor.rg = diffuseColor.gr;");
        }
      : () => {};
    // Two materials that differ only in this must not share a program.
    m.customProgramCacheKey = () => (swap ? "hod2_blood_swap" : "hod2_blood");
    m.needsUpdate = true;
  }

  /** What the panel says. */
  get describe(): string {
    if (!this.seen.size) return "no blood materials in this bundle";
    return `${this.mode}, ${this.seen.size} materials`;
  }
}
