/**
 * The scene light the script drives, and the D3D fixed-function setup it feeds.
 *
 * Level geometry ships with **no light sources of its own** and bakes most of
 * its illumination into textures and the per-mesh base colour. But the
 * renderer does apply one directional light on top of that -- which is why
 * "+ scene light" is the default and unlit, the bake alone, is the
 * comparison -- and the script sets it: opcodes
 * `0x18`/`0x19` set the direction, `0x17` slerps it, and the `0x20`–`0x27`
 * tween channels 6/7/8 set its colour and 10 the ambient.
 *
 * `SetLightingDefaultSingle` (`0x004AA120`) is the whole setup. The
 * decompiler drops every FPU argument in it — `__ftol()` with no arguments,
 * `unaff_EDI` — so this is from the disassembly, with `255.0`, `1.4` and
 * `0.3` read out of the image at `0x00570F5C`, `0x00565DE4` and `0x004C4D10`:
 *
 * ```c
 * t = light_colour * ambient;                       // [esp+0xC/0x10/0x14]
 * SetRenderState(D3DRENDERSTATE_AMBIENT, 0xFF000000 | pack(t * 255));
 * light.diffuse  = t * 1.4;
 * light.specular = light.diffuse;
 * light.ambient  = light_colour * 0.3;              // NOT scaled by ambient
 * light.direction = g_render_light_dir;             // negated on the way in
 * SetLight(0, &light);  LightEnable(0, TRUE);
 * for (i = 1; i < 16; i++) LightEnable(i, FALSE);
 * ```
 *
 * **The ambient channel is a master brightness, not a separate ambient
 * term**, and this port had it as one. Channel 10 multiplies the light colour
 * into the D3D ambient render state *and* into the light's diffuse, so
 * turning it down dims the directional light with it; only `light.ambient`
 * escapes it. And the render-state ambient is `colour * ambient` — **tinted**,
 * never a neutral grey. The port summed an untinted scalar with `colour*0.3`,
 * which against the engine's own `(1.0, 0.2, 0.1)` light is a near-white
 * ambient where the engine has a deep orange one.
 *
 * In D3D's fixed-function sum the two ambients add:
 * `material.ambient * (D3DRENDERSTATE_AMBIENT + light.ambient)`, one light and
 * no attenuation, so the total is `colour * (ambient + 0.3)` — one
 * `AmbientLight`, which is why the sum is kept and only the tint corrected.
 *
 * **The direction.** `FUN_0040E0B0(pitch, yaw, world_out, view_out)` builds it
 * by rotating `(0, 0, 1)`:
 *
 * ```
 * MatrixLoadIdentity(); MatrixRotateY(yaw); MatrixRotateX(pitch);
 * ```
 *
 * `MatrixRotateY`/`X` pre-multiply (`M <- R x M`) and the vector transform is
 * D3D's row-vector form, so the pitch is applied first and the yaw second —
 * the natural order. Working it through with the matrices as the disassembly
 * stores them gives
 *
 * ```
 * dir = ( cos(pitch) * sin(yaw), -sin(pitch), cos(pitch) * cos(yaw) )
 * ```
 *
 * and it is negated on the way to the device, so `dir` is the direction the
 * light *comes from*. Both angles are BAMS: the rotators multiply by
 * `9.58738e-05`, which is 2*pi/65536.
 *
 * `BuildSceneLightDirection` produces the vector twice, in world space and in
 * view space, and `UpdateSceneViewAndLight` (`0x00401F40`) sends the **view**
 * one to D3D — because D3D7 wants a light direction already in view space.
 * three.js does that transform itself, so the port keeps the **world** vector
 * and places the light with it. Reaching for the view vector to "match the
 * exe" here would transform it twice.
 *
 * **The colour space, and why the multiplier converts.** These are the same
 * framebuffer-encoded quantities the fog colour is (see `render/fog.ts`):
 * D3D multiplies them against gamma-encoded texels. Writing `L` for the
 * engine's multiplier and `L'` for a linear-space one, matching
 * `tex^γ · L' == (tex · L)^γ` gives `L' = L^γ` — so the linear-space
 * equivalent of a gamma-space multiply is the multiplier put through
 * sRGB→linear. `setRGB`'s default is the linear working space, so the port
 * was using `L` where it needed `L'`: the engine's `(1.0, 0.2, 0.1)` was
 * being applied about three times too weakly in green and blue, which reads
 * as a light that is far less saturated than the game's.
 *
 * The whole product `colour · ambient · 1.4` goes through the transfer, not
 * just the colour, because the scalars are gamma-space scalars too — an
 * `ambient` of 0.5 is a 0.22 multiplier in linear light, not a 0.5 one.
 *
 * **What is still approximate.** D3D fixed-function lighting and three.js's
 * Lambert model are not the same shader, and the game's material ambient and
 * specular terms are not modelled — `MeshLambertMaterial` has no specular at
 * all, so `light.specular` goes nowhere. The equality above is exact for the
 * *multiplicative* part and not for `N·L`, which stays three.js's. This
 * reproduces the inputs faithfully and accepts that the response curve
 * diverges; it is off by default for that reason.
 */

import {
  AmbientLight,
  Color,
  SRGBColorSpace,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  Scene,
  ShaderChunk,
  Vector3,
  type Material,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from "three";
import type { System } from "../core/system";
import type { RenderContext } from "./context";
import {
  applyForcedAlphaBlend, copyDrawState, fadedCopy, setUnfadedMaterial, unfadedMaterial,
} from "./draw_order";

/**
 * What of a mesh and its material goes into its twins' programs, as far as
 * this layer's materials vary: the program three.js builds depends on these
 * and not on which texture or colour. Generous rather than exact -- a kind
 * split too finely costs a compile that hits the cache.
 */
function programKind(mesh: Mesh, m: Material): string {
  const b = m as MeshBasicMaterial;
  const g = mesh.geometry;
  const colour = g?.attributes.color;
  return [
    (mesh as { isSkinnedMesh?: boolean }).isSkinnedMesh ? "skin" : "",
    g?.morphAttributes && Object.keys(g.morphAttributes).length ? "morph" : "",
    colour ? `col${colour.itemSize}` : "", g?.attributes.normal ? "n" : "",
    m.type, b.map ? `map${b.map.colorSpace}` : "", b.alphaMap ? "amap" : "",
    m.alphaTest > 0 ? "atest" : "", m.transparent ? "tr" : "", m.blending,
    m.vertexColors ? "vc" : "", m.side, b.fog ? "fog" : "", m.premultipliedAlpha ? "pma" : "",
    m.customProgramCacheKey(),
  ].join("|");
}

/** 2*pi / 65536 — the constant both matrix rotators multiply by. */

/** `SetLightingDefaultSingle`'s two scalings of the scene light colour. */
export const DIFFUSE_SCALE = 1.4;
export const LIGHT_AMBIENT_SCALE = 0.3;

export type LightingMode = "unlit" | "scene";

/**
 * The two light sets, as `LightsUseSecondarySet` (`FUN_0041DC70`) and
 * `LightsRestoreScene` (`FUN_0041DCC0`) switch between them.
 *
 * Every draw in the default path is lit by whatever `SetRenderAmbient`,
 * `SetRenderLightDirection` and `SetRenderLightColour` last left, and
 * `RenderEnqueueCommand` re-installs the light the moment one of them marks it
 * dirty. The world draws under **light block 0**. Forty-four routines --
 * `ZombieAdvanceMotion`'s very first instruction among them -- switch to
 * **light block 1** before they draw and back after, so every character is
 * lit by block 1. `[proved]` The port keeps both blocks in the walker and asks
 * `app/` which actors are under block 1 (`ActorDrawsUnderSecondaryLights`).
 *
 * Only this module's "+ scene light" view -- the default -- draws with
 * either; the unlit view shows no difference.
 */
export interface SecondaryLightSource {
  /** Block 1, as the walker holds it. Null before a stage. */
  light(): SceneLightState | null;
  /** Is the actor at this spawn address drawn under block 1? */
  secondary(at: number): boolean;
}

/** Block 1's three terms, shared by every secondary-lit program. */
const secAmbient = { value: new Color(0, 0, 0) };
const secColor = { value: new Color(0, 0, 0) };
/** Toward the light, in **view** space: rewritten every frame. */
const secDirView = { value: new Vector3(0, 0, 1) };

const SECONDARY_LIGHTS = (() => {
  const src = ShaderChunk.lights_fragment_begin;
  const out = src
    .replace("( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )", "0")
    .replace("( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )", "0")
    .replace("( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )", "0")
    .replace("( NUM_HEMI_LIGHTS > 0 )", "0")
    .replace("getAmbientLightIrradiance( ambientLightColor )", "secAmbient");
  if (out === src) console.warn("lighting: lights_fragment_begin not patched");
  // Block 1's one directional light, in place of the scene's.
  return out + `
  {
    float secNL = saturate( dot( geometryNormal, secDirView ) );
    reflectedLight.directDiffuse += secNL * secColor
      * BRDF_Lambert( material.diffuseColor );
  }`;
})();

/**
 * A light colour one draw is made under -- `SetRenderLightColour`
 * (`FUN_004AA0A0`) just before an `AssetDrawSlot` and `LightsRestoreScene`
 * (`FUN_0041DCC0`) just after it, as `Class26Subtype67Draw` (`FUN_0048FB40`)
 * brackets `common.bin[135]`. The call changes the colour and nothing else,
 * so the draw is lit by the scene's block 0 -- its ambient, its direction --
 * through `SetLightingDefaultSingle` with that colour in place of the
 * block's: the same three terms, `colour * ambient * 1.4` diffuse and
 * `colour * (ambient + 0.3)` ambient, as {@link SceneLighting} computes for
 * the block's own colour.
 *
 * A node carries it as `userData.hod2_light_colour`, `[r, g, b]` in the
 * engine's 0..1, and every mesh under it is drawn with a twin whose uniforms
 * are this set's. The twin's program is block 1's (`secondarylit`): the
 * shader is the same one light and one ambient from uniforms, and only the
 * values differ. A tag of `null` is the block's own colour again, for a node
 * whose parent carries a colour it does not share -- class 0x32's bones,
 * each drawn under the colour its own draw was made with.
 *
 * **Under block 1 when the actor is.** A draw between `LightsUseSecondarySet`
 * and `LightsRestoreScene` that changes the colour keeps block 1's ambient
 * and direction -- `Class32DrawNodeSlot` (`FUN_0047FC50`)'s flash and warm
 * light -- so a set is keyed by its block as well as its colour.
 */
interface ColouredLight {
  rgb: [number, number, number];
  /** Block 1's ambient and direction rather than block 0's. */
  secondary: boolean;
  ambient: { value: Color };
  color: { value: Color };
  dirView: { value: Vector3 };
  /** Twin by base material, and base by twin. */
  twins: Map<Material, Material>;
}

/*
 * The gun lights — `BuildEntitySpotlightArray` (`FUN_00480AC0`), evt `0x15`
 * under `0x14` — used to be two `SpotLight`s here, placed one unit in front of
 * the camera and shown only in this module's "+ scene light" view, on every
 * surface. They are `render/gunlights.ts` now, placed from `g_entity_lights`
 * and drawn in every view on exactly the surfaces the engine lights with
 * them. Both swap the same meshes' materials, so the rig asks
 * {@link SceneLighting.viewMaterial} what to put back and this module leaves a
 * gun-lit mesh alone.
 */

export interface SceneLightState {
  /** Light colour, 0..1 per component, from tween channels 6/7/8. */
  rgb: [number, number, number];
  /** Global ambient, from channel 10. */
  ambient: number;
  /**
   * Direction the light comes from. The script stores BAMS; `hod2lib/script.ts`
   * converts to degrees on the way out, so that is what travels.
   */
  pitchDeg: number;
  yawDeg: number;
}

export const DEFAULT_LIGHT: SceneLightState = {
  rgb: [1, 1, 1],
  ambient: 0.7,                     // LightBlockInit's
  pitchDeg: 0,
  yawDeg: 0,
};

/**
 * The world-space direction the light comes from, from a BAMS pitch/yaw pair.
 * See the derivation in the module comment.
 */
export function lightDirection(pitchDeg: number, yawDeg: number,
                               out = new Vector3()): Vector3 {
  const p = (pitchDeg * Math.PI) / 180;
  const y = (yawDeg * Math.PI) / 180;
  const cp = Math.cos(p);
  return out.set(cp * Math.sin(y), -Math.sin(p), cp * Math.cos(y));
}

export class SceneLighting implements System<RenderContext> {
  readonly id = "render.lighting";
  readonly group = new Group();
  private readonly dir = new DirectionalLight(0xffffff, DIFFUSE_SCALE);
  private readonly amb = new AmbientLight(0xffffff, 1);
  /**
   * "+ scene light" by default: the script's light block drawn, which is
   * what the stages look like with their light. `unlit` is the baked
   * textures alone, one switch away in the Scene panel.
   */
  private mode: LightingMode = "scene";
  private intensity = 1;
  private state: SceneLightState = { ...DEFAULT_LIGHT };
  /** Lambert twins of the unlit materials, built once and reused. */
  private readonly lit = new Map<Material, Material>();
  /** Block-1 twins, the same way. */
  private readonly litSecondary = new Map<Material, Material>();
  /** Twins under a draw's own light colour, by colour -- see `ColouredLight`. */
  private readonly coloured = new Map<string, ColouredLight>();
  /** The layers whose meshes are not under the stage root. */
  private readonly extraRoots: Object3D[] = [];
  source: SecondaryLightSource = { light: () => null, secondary: () => false };
  private root: Object3D | null = null;
  private readonly _v = new Vector3();

  constructor(scene: Scene) {
    this.group.name = "scene_lights";
    this.group.add(this.dir, this.dir.target, this.amb);
    this.group.visible = this.mode === "scene";
    scene.add(this.group);
  }

  /** Remember the stage root so materials can be swapped in place. */
  build(root: Object3D): void {
    this.root = root;
    this.lit.clear();
    this.litSecondary.clear();
    this.coloured.clear();
    if (this.mode === "scene") this.applyMaterials();
  }

  get lightingMode(): LightingMode {
    return this.mode;
  }

  setMode(mode: LightingMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.group.visible = mode === "scene";
    this.applyMaterials();
  }

  setIntensity(v: number): void {
    this.intensity = v;
    this.refresh();
  }

  private lastKey = "";

  /** Called every frame while a tween runs, so it no-ops when unchanged. */
  set(state: Partial<SceneLightState>): void {
    const next = { ...this.state, ...state };
    const key = `${next.rgb.join(",")}|${next.ambient}|` +
      `${next.pitchDeg}|${next.yawDeg}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.state = next;
    this.refresh();
  }

  get current(): SceneLightState {
    return this.state;
  }

  /**
   * The script's light block, every tick, because the script ramps the colour
   * over frames rather than switching it; `set` no-ops when nothing moved.
   */
  update(ctx: RenderContext): void {
    const w = ctx.walker;
    if (!w) return;
    this.set(w.light);
    if (this.mode !== "scene") return;
    this.refreshSecondary(ctx);
    this.refreshColoured(ctx);
  }

  /**
   * Each draw-colour set's uniforms: block 0's ambient and direction with the
   * draw's colour, by `SetLightingDefaultSingle`'s arithmetic -- `refresh`'s,
   * with the colour swapped.
   */
  private refreshColoured(ctx: RenderContext): void {
    const block1 = this.source.light() ?? DEFAULT_LIGHT;
    for (const set of this.coloured.values()) {
      const l = set.secondary ? block1 : this.state;
      const a = l.ambient;
      const amb = a + LIGHT_AMBIENT_SCALE;
      const [r, g, b] = set.rgb;
      set.color.value.setRGB(r * a * DIFFUSE_SCALE, g * a * DIFFUSE_SCALE,
                             b * a * DIFFUSE_SCALE, SRGBColorSpace)
        .multiplyScalar(this.intensity);
      set.ambient.value.setRGB(r * amb, g * amb, b * amb, SRGBColorSpace)
        .multiplyScalar(this.intensity);
      lightDirection(l.pitchDeg, l.yawDeg, set.dirView.value)
        .transformDirection(ctx.camera.matrixWorldInverse);
    }
  }

  /**
   * The material swap for the frame about to be drawn: every **visible**
   * mesh gets the twin this view and its actor's light block want.
   *
   * Once a frame, just before the render, and down the visible branches
   * only. It ran from `update` -- every tick -- over the whole stage graph,
   * twelve thousand nodes in stage 1 of which under two thousand are drawn,
   * and "+ scene light" cost 4.8 ms a frame on a desktop for it. A hidden
   * mesh's material is not read by anything until it is shown, and it is
   * swapped on the frame it is: this runs after every system has decided
   * what is visible. Called by `app/`'s `endFrame`.
   */
  beforeRender(): void {
    if (this.mode === "scene") this.applyMaterials(true);
  }

  /**
   * Compile, now, both twins every kind of drawable can be given -- the
   * primary Lambert and the block-1 one -- so neither is compiled on the
   * frame a mesh first needs it.
   *
   * The twins are made lazily, as meshes come into view, and the block-1
   * twin carries its own shader (`secondarylit`): the stage's warm-up never
   * saw one, and every character first met in a block-1 region compiled one
   * or two programs as it appeared -- stage 1's boss at the start, a civilian
   * and the partner half a minute in. A program depends on the material's
   * kind and the mesh's (skinned, vertex colours, sides, alpha), not on the
   * texture, so one mesh of each kind stands for all of them: a few dozen
   * compiles, where twins for every one of a stage's five thousand materials
   * would be memory a phone does not have.
   *
   * Each twin faded too, as `render/draw_order.ts` draws a character fading
   * in or out: its own blended copy, which three.js compiles without
   * `OPAQUE`. The copies are dropped here, and their programs stay, being
   * pinned (`render/program_pins.ts`) -- or, never disposed, simply still in
   * use as far as three.js can tell.
   */
  warm(drawables: readonly Object3D[], compile: (o: Object3D) => void): void {
    if (this.mode !== "scene") return;
    const seen = new Set<string>();
    for (const o of drawables) {
      const mesh = o as Mesh;
      if (!mesh.isMesh || !mesh.material || Array.isArray(mesh.material)) continue;
      const base = this.baseOf(unfadedMaterial(mesh) as Material);
      if (base.userData?.gunLit) continue;
      const kind = programKind(mesh, base);
      if (seen.has(kind)) continue;
      seen.add(kind);
      const was = mesh.material;
      for (const twin of [this.twinOf(base), this.secondaryTwinOf(base)]) {
        mesh.material = twin;
        compile(mesh);
        const faded = fadedCopy(twin);
        applyForcedAlphaBlend(faded, 0.5, twin.opacity);
        mesh.material = faded;
        compile(mesh);
      }
      mesh.material = was;
    }
  }

  /** A layer that clones its own meshes outside the stage root. */
  addRoot(o: Object3D): void {
    if (!this.extraRoots.includes(o)) this.extraRoots.push(o);
  }

  /**
   * Block 1's uniforms, from the walker, by the same arithmetic `refresh`
   * applies to block 0 -- `SetLightingDefaultSingle` is one routine and both
   * blocks go through it.
   */
  private refreshSecondary(ctx: RenderContext): void {
    const l = this.source.light() ?? DEFAULT_LIGHT;
    const [r, g, b] = l.rgb;
    const a = l.ambient;
    secColor.value.setRGB(r * a * DIFFUSE_SCALE, g * a * DIFFUSE_SCALE,
                          b * a * DIFFUSE_SCALE, SRGBColorSpace)
      .multiplyScalar(this.intensity);
    const amb = a + LIGHT_AMBIENT_SCALE;
    secAmbient.value.setRGB(r * amb, g * amb, b * amb, SRGBColorSpace)
      .multiplyScalar(this.intensity);
    lightDirection(l.pitchDeg, l.yawDeg, secDirView.value)
      .transformDirection(ctx.camera.matrixWorldInverse);
  }

  /**
   * What this view draws a stage material with: its Lambert twin under
   * "+ scene light", the exported unlit one otherwise. Either can come in.
   */
  viewMaterial(m: Material): Material {
    const base = this.baseOf(m);
    if (this.mode === "scene") return this.twinOf(base);
    return base;
  }

  resync(ctx: RenderContext): void {
    this.update(ctx);
  }

  private refresh(): void {
    const [r, g, b] = this.state.rgb;
    const a = this.state.ambient;

    // `light.diffuse = colour * ambient * 1.4`. The ambient channel is a
    // master brightness and scales this too -- leaving it out is what made
    // the directional light twice as bright as the engine's at the default
    // ambient of 0.5.
    this.dir.color.setRGB(r * a * DIFFUSE_SCALE, g * a * DIFFUSE_SCALE,
                          b * a * DIFFUSE_SCALE, SRGBColorSpace);
    this.dir.intensity = this.intensity;

    // `D3DRENDERSTATE_AMBIENT + light.ambient` = `colour * (ambient + 0.3)`.
    // Tinted by the light colour on both terms; the port used to add an
    // untinted `ambient` to `colour * 0.3`.
    const amb = a + LIGHT_AMBIENT_SCALE;
    this.amb.color.setRGB(r * amb, g * amb, b * amb, SRGBColorSpace);
    this.amb.intensity = this.intensity;

    // A directional light shines from its position toward its target, and the
    // vector above is the direction the light comes *from*.
    lightDirection(this.state.pitchDeg, this.state.yawDeg, this._v);
    this.dir.position.copy(this._v).multiplyScalar(4000);
    this.dir.target.position.set(0, 0, 0);
    this.dir.target.updateMatrixWorld();
  }

  /**
   * Swap between the exported unlit materials and Lambert twins.
   *
   * The bundle is exported `KHR_materials_unlit`, which three.js loads as
   * `MeshBasicMaterial` — a material no light can reach. Lighting therefore
   * needs a different material class, not just a light in the scene. The
   * twins keep every other property the PowerVR2 translation decided:
   * texture, base colour, blend mode, alpha test, culling, fog.
   */
  private applyMaterials(visibleOnly = false): void {
    if (!this.root) return;
    const visit = (o: Object3D, at: number | null,
                   light: readonly number[] | null): void => {
      if (visibleOnly && !o.visible) return;
      const x = o.userData as { hod2_spawn_at?: number; hod2_actor_at?: number;
                                hod2_light_colour?: number[] | null };
      const own = x?.hod2_actor_at ?? x?.hod2_spawn_at;
      const here = own !== undefined ? own : at;
      // A tag of `null` is the block's own colour, not "inherit".
      const lit = x?.hod2_light_colour !== undefined
        ? x.hod2_light_colour : light;
      const mesh = o as Mesh;
      if (mesh.isMesh && mesh.material) {
        const second = this.mode === "scene" && here !== null
          && this.source.secondary(here);
        const swap = (m: Material): Material => {
          // A mesh the gun light holds keeps its gun-lit twin; the rig puts
          // back whatever this view wants when the light goes out.
          if (m.userData?.gunLit) return m;
          const base = this.baseOf(m);
          if (this.mode !== "scene") return base;
          if (lit) return this.colouredTwinOf(base, lit, second);
          return second ? this.secondaryTwinOf(base) : this.twinOf(base);
        };
        // Under any fade the draw has put on it, which stays on top: see
        // `setUnfadedMaterial` in `render/draw_order.ts`.
        const cur = unfadedMaterial(mesh);
        setUnfadedMaterial(mesh, Array.isArray(cur) ? cur.map(swap) : swap(cur));
      }
      for (const c of o.children) visit(c, here, lit);
    };
    visit(this.root, null, null);
    for (const r of this.extraRoots) visit(r, null, null);
    this.refresh();
  }

  /** The exported unlit material behind either twin. */
  private baseOf(m: Material): Material {
    let back = this.lit.get(m) ?? this.litSecondary.get(m);
    if (!back) {
      for (const set of this.coloured.values()) {
        back = set.twins.get(m);
        if (back) break;
      }
    }
    return back && back instanceof MeshBasicMaterial ? back : m;
  }

  /**
   * The twin a draw under its own light colour takes -- see `ColouredLight`.
   * Built like the block-1 twin, on the block-1 program, with the colour
   * set's own uniform objects, which three.js keeps per material.
   */
  private colouredTwinOf(m: Material, rgb: readonly number[],
                         secondary: boolean): Material {
    if (!(m instanceof MeshBasicMaterial)) return m;
    const key = `${secondary ? "block1|" : ""}${rgb[0]},${rgb[1]},${rgb[2]}`;
    let set = this.coloured.get(key);
    if (!set) {
      set = {
        rgb: [rgb[0], rgb[1], rgb[2]], secondary,
        ambient: { value: new Color(0, 0, 0) },
        color: { value: new Color(0, 0, 0) },
        dirView: { value: new Vector3(0, 0, 1) },
        twins: new Map(),
      };
      this.coloured.set(key, set);
    }
    let twin = set.twins.get(m);
    if (!twin) {
      const w = this.twinOf(m) as MeshLambertMaterial;
      const t = w.clone();
      t.userData = { ...m.userData, lightColour: key };
      const inner = m.onBeforeCompile;
      const u = set;
      t.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms,
                           renderer: WebGLRenderer) => {
        inner?.call(m, shader, renderer);
        shader.uniforms.secAmbient = u.ambient;
        shader.uniforms.secColor = u.color;
        shader.uniforms.secDirView = u.dirView;
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nuniform vec3 "
                   + "secAmbient;\nuniform vec3 secColor;\nuniform vec3 secDirView;")
          .replace("#include <lights_fragment_begin>", SECONDARY_LIGHTS);
      };
      t.customProgramCacheKey = () => "secondarylit";
      twin = t;
      set.twins.set(m, twin);
      set.twins.set(twin, m);
    }
    return twin;
  }

  /**
   * The block-1 twin: a Lambert material whose shader takes block 1's
   * direction, colour and ambient from uniforms and none of the scene's
   * lights.
   */
  private secondaryTwinOf(m: Material): Material {
    if (!(m instanceof MeshBasicMaterial)) return m;
    let twin = this.litSecondary.get(m);
    if (!twin) {
      const w = this.twinOf(m) as MeshLambertMaterial;
      const t = w.clone();
      t.userData = { ...m.userData, secondaryLit: true };
      const inner = m.onBeforeCompile;
      t.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms,
                           renderer: WebGLRenderer) => {
        inner?.call(m, shader, renderer);
        shader.uniforms.secAmbient = secAmbient;
        shader.uniforms.secColor = secColor;
        shader.uniforms.secDirView = secDirView;
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nuniform vec3 "
                   + "secAmbient;\nuniform vec3 secColor;\nuniform vec3 secDirView;")
          .replace("#include <lights_fragment_begin>", SECONDARY_LIGHTS);
      };
      t.customProgramCacheKey = () => "secondarylit";
      twin = t;
      this.litSecondary.set(m, twin);
      this.litSecondary.set(twin, m);
    }
    return twin;
  }

  /** The Lambert twin of an unlit material, built once and cached both ways. */
  private twinOf(m: Material): Material {
    let twin = this.lit.get(m);
    if (!twin) {
      const b = m as MeshBasicMaterial;
      twin = new MeshLambertMaterial({
        map: b.map,
        color: b.color,
        transparent: b.transparent,
        opacity: b.opacity,
        alphaTest: b.alphaTest,
        alphaMap: b.alphaMap,
        side: b.side,
        depthWrite: b.depthWrite,
        depthTest: b.depthTest,
        blending: b.blending,
        vertexColors: b.vertexColors,
        fog: b.fog,
        name: b.name,
      });
      // The depth function and blend factors `TranslatePvr2StateToD3D`
      // decided, which the constructor above does not take.
      copyDrawState(b, twin);
      twin.userData = m.userData;
      // Keep the fog uniform hook the fog module installed.
      twin.onBeforeCompile = m.onBeforeCompile;
      this.lit.set(m, twin);
      this.lit.set(twin, m);        // reverse, for the swap back
    }
    return twin;
  }

  get describe(): string {
    if (this.mode === "unlit") return "unlit (baked)";
    const [r, g, b] = this.state.rgb;
    const c = new Color(r, g, b).getHexString();
    return `#${c} x${DIFFUSE_SCALE} amb ${this.state.ambient.toFixed(2)} ` +
      `pitch ${this.state.pitchDeg.toFixed(0)}° yaw ${this.state.yawDeg.toFixed(0)}°`;
  }
}
