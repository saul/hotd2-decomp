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
 * **Depth vs range: the game is planar, and that is now proved rather than
 * assumed.** `InitD3DDeviceAndTextureStages` picks the fog stage off the
 * device caps at `0x004A4FE3`: if `D3DPRASTERCAPS_FOGTABLE` is present it sets
 * `D3DRENDERSTATE_FOGTABLEMODE` (0x23) to 3, and only if that is missing does
 * it fall back to `D3DRENDERSTATE_FOGVERTEXMODE` (0x8C) = 3. Both 3s are
 * `D3DFOG_LINEAR`. So on anything the game shipped against it is **per-pixel
 * table fog**, and `D3DRENDERSTATE_RANGEFOGENABLE` (0x30) is never set
 * anywhere in the binary — it would not apply to table fog if it were.
 * `FOGSTART`/`FOGEND` arrive as 42..1014 rather than a 0..1 device range,
 * which is what says the depth is eye-space W and not post-projection Z.
 *
 * three.js's default is the same quantity: `fog_vertex` is
 * `vFogDepth = -mvPosition.z`. So `PLANAR` **is** the game, and it is the
 * default here.
 *
 * `RADIAL` [diverges]: it patches that line to `length(mvPosition.xyz)` so the
 * factor is true distance from the eye. Planar fog fogs the screen corners
 * less than the centre at the same real distance, and the fog on a wall
 * changes as you *turn* — an artefact of the original, not of the port. Radial
 * is offered because it is the thing people reach for when they see that, and
 * keeping it next to `planar` is what makes the difference legible. It is not
 * more correct.
 *
 * **Three things had to be corrected before it matched the game.**
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
 *
 * 3. **The colour is sRGB and the blend is in sRGB**, which is the one that
 *    made the fog visibly the wrong colour rather than merely the wrong
 *    density. `PushSceneFogColour` (`FUN_0040D5B0`) packs channels 2/3/4 into
 *    a `0x00RRGGBB` D3DCOLOR and `SetFogColour` (`FUN_004ABDD0`) hands it
 *    straight to `D3DRENDERSTATE_FOGCOLOR`. Those bytes are framebuffer
 *    bytes. Two consequences, and the port had both wrong:
 *
 *    * `Color.setRGB(r, g, b)` defaults to `ColorManagement.workingColorSpace`
 *      — **linear-sRGB** — so it took the game's bytes as already-linear and
 *      the renderer then encoded them again on the way out. Stage 3's
 *      `RGB(10, 10, 20)` reached the screen as `RGB(56, 56, 79)`: four times
 *      too bright, and the blue washed out of it, because the sRGB curve
 *      compresses a 2:1 ratio into 1.4:1. Passing `SRGBColorSpace` is the fix.
 *    * D3D7's fog blend runs on those encoded bytes —
 *      `C = f*C_pixel + (1-f)*C_fog` in gamma space, there being no sRGB write
 *      path in DX7 at all. three.js mixes in linear and encodes afterwards,
 *      which is a different sum: over a dark surface at half fog it lands
 *      about 10/255 too bright. The fragment chunk encodes, mixes, and decodes
 *      so the displayed result is the lerp the hardware did.
 */

import {
  Color, Fog, Scene, ShaderChunk, SRGBColorSpace,
  type Material, type Mesh,
} from "three";
import type { Context, System } from "../core/system";

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
  if (!frag.includes("smoothstep( fogNear, fogFar, vFogDepth )")
      || !frag.includes("mix( gl_FragColor.rgb, fogColor, fogFactor )")) {
    console.warn("three.js fog_fragment is not the expected shape; " +
                 "fog stays smoothstep and blends in linear space");
    return;
  }
  ShaderChunk.fog_fragment = frag
    .replace(
      "smoothstep( fogNear, fogFar, vFogDepth )",
      "clamp( ( vFogDepth - fogNear ) / ( fogFar - fogNear ), 0.0, 1.0 )",
    )
    // The blend is the D3D7 one: encode, lerp, decode. See note 3 above --
    // `SetFogColour` hands D3D framebuffer bytes and the fixed-function
    // blend runs on framebuffer bytes, so the lerp belongs in sRGB. The
    // renderer re-encodes on the way out, which is why this has to decode
    // again rather than stop at the encoded value.
    .replace(
      "gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );",
      "gl_FragColor.rgb = hod2SrgbDecode( mix(\n"
      + "\t\thod2SrgbEncode( gl_FragColor.rgb ),\n"
      + "\t\thod2SrgbEncode( fogColor ), fogFactor ) );",
    );
  ShaderChunk.fog_pars_fragment = SRGB_TRANSFER_GLSL
    + ShaderChunk.fog_pars_fragment;
}

/**
 * The sRGB transfer pair, spelled out rather than taken from three's
 * `colorspace_pars_fragment`.
 *
 * That chunk has the encode half (`sRGBTransferOETF`) and no decode half, and
 * whether it is in scope at `fog_fragment` is an ordering detail of a file
 * this code does not own. Two twelve-line functions are cheaper than that
 * coupling. The constants are three's own, so the round trip is exact.
 *
 * `max(x, 0)` guards `pow`: a negative component is undefined behaviour there,
 * and one can arrive from a material that subtracts.
 */
const SRGB_TRANSFER_GLSL = /* glsl */`
vec3 hod2SrgbEncode( vec3 c ) {
	c = max( c, vec3( 0.0 ) );
	return mix( pow( c, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ),
	            c * 12.92, vec3( lessThanEqual( c, vec3( 0.0031308 ) ) ) );
}
vec3 hod2SrgbDecode( vec3 c ) {
	c = max( c, vec3( 0.0 ) );
	return mix( pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ),
	            c / 12.92, vec3( lessThanEqual( c, vec3( 0.04045 ) ) ) );
}
`;

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
const radialUniform = { value: 0 };

/**
 * Put the fog state on **one** material: the per-mesh fog bit, and the uniform
 * the patched chunk needs.
 *
 * Exported because `prepare` is not the only place materials appear. It runs
 * once per stage, over the tree the loader just built -- and then `Backdrop`
 * and `Rain` *clone* materials out of that tree, because the dome must not
 * write depth and a drop must not occlude the drop behind it. `Material.copy`
 * copies `fog` and `userData` and does **not** copy `onBeforeCompile`, so the
 * clones compiled without `vFogRadial` and fell back to planar fog while the
 * stage around them fogged radially: the sky banded differently as the camera
 * turned, which reads as a shading bug and is a lifetime one.
 *
 * Anything that clones a material after the stage loads calls this on the
 * clone. It is idempotent.
 */
export function prepareFogMaterial(m: Material | null | undefined): void {
  if (!m) return;
  const mat = m as Material & { fog?: boolean };
  mat.fog = fogEnabledFor(mat);
  // Inject the mode uniform. onBeforeCompile is per *program*, not per
  // material, so the cost is one call per distinct shader.
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.vFogRadial = radialUniform;
  };
  mat.needsUpdate = true;
}

export class SceneFog implements System {
  readonly id = "render.fog";
  private readonly scene: Scene;
  private readonly fog = new Fog(0x000000, 65000, 65001);
  /** Planar, because that is what table fog does. See the note above. */
  private mode: FogMode = "planar";
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
      for (const m of mats) prepareFogMaterial(m);
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

  /**
   * Push the walker's fog state into the scene.
   *
   * The script ramps fog over frames rather than switching it, so this runs
   * every tick and no-ops on the key when nothing actually moved. It is also
   * the whole of the rebuild after a load: the ramp's current value came back
   * with the walker.
   */
  update(ctx: Context): void {
    const w = ctx.walker;
    if (!w) return;
    const { near, far, rgb } = w.fog;
    const active = w.fogSet;
    const key = `${this.mode}|${active}|${near}|${far}|${rgb.join(",")}`;
    // near/far arrive as the script set them; the doubling happens below.
    if (key === this.last) return;
    this.last = key;
    this.fog.near = near * FOG_RANGE_SCALE;
    this.fog.far = far * FOG_RANGE_SCALE;
    // **`SRGBColorSpace` is load-bearing.** These are the bytes
    // `PushSceneFogColour` (`FUN_0040D5B0`) packs into a D3DCOLOR, so they are
    // sRGB; `setRGB`'s default is the linear-sRGB working space, which took
    // `RGB(10, 10, 20)` to the screen as `RGB(56, 56, 79)`.
    this.fog.color.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255,
                          SRGBColorSpace);
    this.activeRange = active && far > near && near * FOG_RANGE_SCALE < 8000;
    this.apply();
  }

  resync(ctx: Context): void {
    this.update(ctx);
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
