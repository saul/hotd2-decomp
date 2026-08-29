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
 * the fog factor is real distance from the eye. `PLANAR` is kept so the two
 * can be compared against each other and against the game.
 *
 * **Two things had to be corrected before the density matched the game.**
 *
 * 1. The game **doubles** both values before handing them to D3D.
 *    `FUN_004ABDF0` is, from the disassembly:
 *
 *    ```
 *    [esp+4] = near + near;  [esp+8] = far + far;
 *    if (near*2 < far*2) { FOGSTART = near*2; FOGEND = far*2; }
 *    else                { FOGSTART = far*2;  FOGEND = near*2; }   // swap guard
 *    ```
 *
 *    So stage 2's `near 21, far 507` is really `42 .. 1014`. Using the raw
 *    values halves the ramp and the fog comes out far too thick.
 *
 * 2. three.js's fog factor is `smoothstep(near, far, depth)`. D3D's
 *    `D3DFOG_LINEAR` is a straight ramp, `(end - d) / (end - start)`.
 *    smoothstep is an S-curve, so it saturates well before the far plane.
 *    The fragment chunk is patched to the linear form.
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

  // D3DFOG_LINEAR is a straight ramp; three.js uses smoothstep, which
  // saturates far too early against the same near/far pair.
  const frag = ShaderChunk.fog_fragment;
  if (frag.includes("smoothstep( fogNear, fogFar, vFogDepth )")) {
    ShaderChunk.fog_fragment = frag.replace(
      "smoothstep( fogNear, fogFar, vFogDepth )",
      "clamp( ( vFogDepth - fogNear ) / ( fogFar - fogNear ), 0.0, 1.0 )",
    );
  } else {
    console.warn("three.js fog_fragment is not the expected shape; " +
                 "fog falloff stays smoothstep rather than linear");
  }
}

/**
 * The game doubles the near and far plane before setting FOGSTART/FOGEND.
 * See the note above -- this is the single biggest reason fog looked wrong.
 */
export const FOG_RANGE_SCALE = 2;

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
    // near/far arrive as the script set them; the doubling happens below.
    if (key === this.last) return;
    this.last = key;
    this.fog.near = near * FOG_RANGE_SCALE;
    this.fog.far = far * FOG_RANGE_SCALE;
    this.fog.color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
    this.activeRange = active && far > near && near * FOG_RANGE_SCALE < 8000;
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
