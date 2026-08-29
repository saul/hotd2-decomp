/**
 * Scene fog.
 *
 * The values are the game's. The *shape* of the falloff is not, by choice.
 *
 * **Where the numbers come from.** Fog lives in the scene light block that evt
 * opcodes `0x20`–`0x27` drive: channel 0 is near, 1 is far, 2/3/4 the colour
 * components as 0–255 ints, and 5 sets all three at once. The near/far
 * operands are pointers to float constants inside the evt file, which is why
 * they read as unattributed residue until they are dereferenced. Whether an
 * individual mesh is fogged at all is per-mesh: TSP bit 23 maps to
 * `D3DRENDERSTATE_FOGENABLE` **inverted**, so fog is on when the bit is clear.
 *
 * **Depth vs range.** D3D7 computes its fog factor from view-space Z by
 * default — planar fog — and offers `D3DRENDERSTATE_RANGEFOGENABLE` for true
 * distance. three.js does the same thing as the D3D default: its `fog_vertex`
 * chunk is `vFogDepth = -mvPosition.z`. Planar fog has a visible artefact:
 * because the fog factor ignores how far off-axis a fragment is, the amount of
 * fog on a wall changes as you *turn* the camera, and the screen corners fog
 * less than the centre at the same true distance.
 *
 * `RADIAL` patches that one line to use `length(mvPosition.xyz)` instead, so
 * the fog factor is real distance from the eye. The near/far range stays
 * exactly as the script sets it — only the quantity being compared changes.
 * `PLANAR` is kept so the two can be compared against each other and against
 * the game.
 */

import { Color, Fog, Scene, ShaderChunk, type Material, type Mesh } from "three";

export type FogMode = "off" | "planar" | "radial";

let patched = false;

/**
 * Replace three.js's fog depth with true distance, once, globally.
 *
 * Done by string-patching the shared shader chunk rather than per material:
 * a stage has ~2200 materials, and `onBeforeCompile` on each would defeat
 * three.js's program cache.
 */
function patchShaderChunk(): void {
  if (patched) return;
  patched = true;
  const original = ShaderChunk.fog_vertex;
  if (!original.includes("vFogDepth")) {
    console.warn("three.js fog chunk is not the expected shape; " +
                 "radial fog falls back to planar");
    return;
  }
  ShaderChunk.fog_vertex = original.replace(
    /vFogDepth\s*=\s*-\s*mvPosition\.z\s*;/,
    "vFogDepth = vFogRadial > 0.5 ? length( mvPosition.xyz ) : - mvPosition.z;",
  );
  ShaderChunk.fog_pars_vertex =
    "uniform float vFogRadial;\n" + ShaderChunk.fog_pars_vertex;
}

/**
 * three.js has no uniform hook for a custom fog term, so the mode travels as
 * a uniform injected into every fogged program. Simpler than it sounds: one
 * shared object, mutated in place.
 */
const radialUniform = { value: 1 };

export class SceneFog {
  private readonly scene: Scene;
  private readonly fog = new Fog(0x000000, 65000, 65001);
  private mode: FogMode = "radial";
  private last = "";

  constructor(scene: Scene) {
    patchShaderChunk();
    this.scene = scene;
  }

  /**
   * Tag every material so the patched chunk compiles, and honour the per-mesh
   * fog bit. A material with `fog = false` is never fogged, which is what
   * `ModelForceFogControlNone`'s four patched asset slots rely on.
   */
  prepare(root: { traverse: (f: (o: unknown) => void) => void }): void {
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!m) continue;
        const mat = m as Material & { fog?: boolean };
        mat.fog = fogEnabledFor(mat);
        // Inject the mode uniform. onBeforeCompile is per *program*, not per
        // material, so the cost is one call per distinct shader.
        mat.onBeforeCompile = (shader) => {
          shader.uniforms.vFogRadial = radialUniform;
        };
        mat.needsUpdate = true;
      }
    });
  }

  setMode(mode: FogMode): void {
    this.mode = mode;
    radialUniform.value = mode === "radial" ? 1 : 0;
    this.apply();
  }

  get fogMode(): FogMode {
    return this.mode;
  }

  /** Push the walker's fog state into the scene. */
  update(near: number, far: number, rgb: [number, number, number],
         active: boolean): void {
    const key = `${this.mode}|${active}|${near}|${far}|${rgb.join(",")}`;
    if (key === this.last) return;
    this.last = key;
    this.fog.near = near;
    this.fog.far = far;
    this.fog.color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
    this.activeRange = active && far > near && near < 8000;
    this.apply();
  }

  private activeRange = false;

  private apply(): void {
    const on = this.mode !== "off" && this.activeRange;
    this.scene.fog = on ? this.fog : null;
    // Distant geometry should fade into the fog, not into a void. When fog is
    // off the background goes back to the neutral dark the viewport uses.
    (this.scene.background as Color | null)?.set(
      on ? this.fog.color : new Color(0x05070a));
  }

  get describe(): string {
    if (this.mode === "off" || !this.activeRange) return "off";
    const c = this.fog.color;
    return `${this.mode} ${this.fog.near.toFixed(0)}..${this.fog.far.toFixed(0)} ` +
      `#${c.getHexString()}`;
  }
}

/**
 * Whether a material is fogged, from the raw PowerVR2 state the exporter
 * preserves.
 *
 * Prefers the decoded `fog_enabled` flag; falls back to bit 23 of the TSP word
 * so a bundle built before that flag existed still behaves correctly rather
 * than fogging everything.
 */
function fogEnabledFor(mat: Material): boolean {
  const pvr2 = (mat.userData as { pvr2?: Record<string, unknown> })?.pvr2;
  if (!pvr2) return true;
  if (typeof pvr2.fog_enabled === "boolean") return pvr2.fog_enabled;
  const tsp = typeof pvr2.tsp_instruction === "string"
    ? Number.parseInt(pvr2.tsp_instruction, 16)
    : NaN;
  // TSP bit 23 is *disable*; the PC port inverts it into FOGENABLE.
  return Number.isNaN(tsp) ? true : ((tsp >> 23) & 1) === 0;
}
