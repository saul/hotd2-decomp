/**
 * The gun lights — the torch on each player's gun in the dark stretches of
 * stages 2, 3 and 4 — drawn as real spotlights with shadows.
 *
 * ## What is the engine's and what is not
 *
 * **Everything that decides anything is `game/scene_lights.ts`.** Whether a
 * light is on, where it is and which way it points are
 * `BuildEntitySpotlightArray` (`FUN_00480AC0`) writing `g_entity_lights`, and
 * which meshes it may light is `g_scene_lighting` plus two draw-path bits
 * (`ActorDrawsSceneLit`) and a region entry's `draw_mode`. This layer reads
 * those and owns nothing a snapshot would need.
 *
 * What the engine draws is D3D7 fixed-function lighting: per **vertex**, the
 * entry's `D3DLIGHT7` plus a render-state ambient, with the vertex colour
 * clamped to 1 and then modulating the texture. For the objects that opt in
 * — `SubmitSlotWithSceneLightArray`, and only those — the whole light is
 *
 * ```
 * clamp(ambient + sum(spot_i * 2 * N.L), 0, 1) * texel        (gamma space)
 * ```
 *
 * `ambient` is `g_light_array_ambient` (evt `0x16`), `2` is `1 /
 * attenuation0`, and the spot factor is 1 inside `theta = pi/8` and 0 outside.
 * That is what the `makeGunLitMaterial` shader computes, per pixel, and it
 * converts the clamped factor to linear before the multiply, which is the
 * same `L' = L^gamma` argument `render/lighting.ts` makes for the scene light.
 *
 * ## What is the user's upgrade, and says so
 *
 * [diverges] **Shadows.** D3D7 has no shadow maps and neither does the game;
 * a three.js shadow map is the reason this module exists, asked for by the
 * user. Everything the stage draws — lit or not, characters included — casts
 * into the light's shadow map, and the lit set receives it.
 *
 * [diverges] **The light leaves the gun, not the eye.** The engine puts it at
 * the crosshair's point one unit in front of the eye and points it along the
 * eye's own ray, so every shadow it could cast lies exactly behind the thing
 * casting it, as seen from the eye: a shadow map there would be invisible.
 * The lamp is moved `GUN_OFFSET` units right and down in the camera's frame —
 * where a gun held at the hip would carry it — and keeps the engine's
 * direction, so at any distance the beam is centred within `GUN_OFFSET` of
 * where the engine's is, and shadows fall visibly up and to the left.
 *
 * [diverges] **Per-pixel, with a soft edge.** The engine's hard cone is
 * evaluated at vertices, so on the stage's large quads its edge smears across
 * whole triangles. Per pixel the same hard cone would be a razor-edged disc,
 * which is not what the game looks like either; `PENUMBRA` softens the rim
 * and is presentation only.
 *
 * No shadow map is rendered unless a gun light is live -- each light's
 * `shadow.autoUpdate` is whether it is on -- and the materials are swapped
 * back when the last light goes out.
 *
 * ## Every light is in the scene all the time, at intensity 0 when off
 *
 * **A light that comes and goes is a recompile of every program in sight**
 * (`L117`).
 * three.js writes the number of point, spot and shadowed spot lights into
 * every material's program key -- the unlit ones' and the device-lit twins'
 * included, which never read them -- and counts only the lights that are
 * `visible`. Toggling `visible` here made the torch's first frames on stage 2
 * compile nineteen programs: the device-lit twins again under the new counts,
 * the gun-lit twins, the shadow pass's depth programs -- 805 ms in one frame,
 * cold, on a desktop, and many times that through Metal's translator on iOS.
 * So the lights' number, kinds and `castShadow` never change for the life of
 * the page, an off light only has its intensity at zero, and
 * {@link GunLights.warm} compiles the programs the torch adds while the
 * loading screen is up. The gun-lit program skips a light whose colour is
 * zero ({@link skipDarkLights}), so the dark ones cost a uniform test each.
 */
import {
  BackSide,
  DoubleSide,
  FrontSide,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshLambertMaterial,
  RGBADepthPacking,
  WebGLRenderTarget,
  Object3D,
  Scene,
  ShaderChunk,
  SpotLight,
  PointLight,
  Group,
  Color,
  Matrix4,
  Vector3,
  type Camera,
  type Side,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from "three";
import { G } from "../game/globals";
import { GUN_LIGHT_FIRST, RenderLightType } from "../game/scene_lights";
import type { System } from "../core/system";
import type { RenderContext } from "./context";
import {
  applyForcedAlphaBlend, copyDrawState, fadedCopy, setUnfadedMaterial,
  unfadedMaterial,
} from "./draw_order";
import { programKind, unlitMaterial, type SceneLighting } from "./lighting";

/**
 * The two questions this layer asks the port, answered by `app/`.
 *
 * Whether an entry is submitted (`EntityLightLive`) and whether an actor draws
 * through the light array (`ActorDrawsSceneLit`) are the port's decisions, so
 * this layer does not call them: `app/main.ts` hands it these two, the same
 * way `Shooting` is handed `onFire` the other way round. The default answers
 * "no" to both, which is a stage with no torch.
 */
export interface GunLightSource {
  live(entry: number): boolean;
  litActor(at: number): boolean;
}

/** Presentation: the soft rim, as a fraction of the cone. See the header. */
const PENUMBRA = 0.3;
/** Shadow map resolution. One map per live light; two players is two. */
const SHADOW_MAP_SIZE = 1024;
/**
 * The shadow camera's far plane, in stage units. The light's range is
 * unbounded (`GUN_LIGHT_RANGE`); a shadow frustum cannot be. A stage room is a
 * few hundred units across and the eye sits fifteen above the path, so
 * anything past this is fogged out long before its shadow would read.
 */
const SHADOW_FAR = 1200;
const SHADOW_NEAR = 0.5;
/** Depth bias and normal-offset bias, tuned by eye against stage 4's floor. */
const SHADOW_BIAS = -0.0004;
const SHADOW_NORMAL_BIAS = 0.25;

/**
 * Presentation: where the lamp sits relative to the engine's, in the camera's
 * own axes (right, up), in stage units. The eye is fifteen units above the
 * path it rides, so this is roughly a hand's width below and beside it.
 */
const GUN_OFFSET_RIGHT = 2.5;
const GUN_OFFSET_UP = -2.5;

/** How many gun lights there are — one per player. */
const GUN_LIGHTS = 2;

/** The side `WebGLShadowMap` draws a caster's depth with: the far one. */
const SHADOW_SIDE: Record<Side, Side> = {
  [FrontSide]: BackSide, [BackSide]: FrontSide, [DoubleSide]: DoubleSide,
};

const LIGHTS_BEGIN = patchLightsBegin(ShaderChunk.lights_fragment_begin);

/**
 * The lights the rest of `g_entity_lights` can hold, from entry 3 up, each
 * claimed through `EntityLightAcquireSlot`: points -- class 0x41 type 48's
 * lamp, class 0x2B selector 0 -- and spots -- class 0x2B selectors 1 and 2,
 * stage 4 block 10's and stage 5 block 0's (`game/class2B/`). Each entry
 * gets one of each kind here and shows the one its `type` names.
 */
const ENTITY_POINT_FIRST = 3;

/**
 * `lights_fragment_begin`, with only the spot and point lights left in it and
 * the ambient replaced by the array path's own.
 *
 * The engine's array path enables the sixteen `g_entity_lights` entries and
 * nothing else — `RenderLightsResetAll` (`FUN_004AA830`) switches the default
 * directional light off before it — so a gun-lit surface must not also take
 * the "+ scene light" directional or ambient when that view is on.
 */
function patchLightsBegin(src: string): string {
  let out = src
    .replace("( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )", "0")
    .replace("( NUM_HEMI_LIGHTS > 0 )", "0")
    .replace("getAmbientLightIrradiance( ambientLightColor )",
             "gunAmbient * PI");
  if (out === src) console.warn("gunlights: lights_fragment_begin not patched");
  for (const kind of ["point", "spot"]) {
    const guarded = skipDarkLights(out, kind);
    if (guarded === out) console.warn(`gunlights: the ${kind} loop is not guarded`);
    out = guarded;
  }
  return out;
}

/**
 * One light loop's body, run only for a light whose colour is not zero.
 *
 * Every light is in the scene all the time (see the header), so the loops
 * run over all thirteen entity points, all fifteen spots and both shadow maps
 * whatever is lit, and an off light's contribution is exactly zero: skipping
 * it changes no pixel. The test is on a uniform, the same for every fragment,
 * which costs a GPU next to nothing. three.js unrolls the loop from its `{` to
 * the `}` before `#pragma unroll_loop_end`, so the guard opens once the light
 * is read and closes after its `RE_Direct`, inside that pair.
 */
function skipDarkLights(src: string, kind: string): string {
  const read = `${kind}Light = ${kind}Lights[ i ];`;
  const at = src.indexOf(read);
  const end = at < 0 ? -1 : src.indexOf("#pragma unroll_loop_end", at);
  if (end < 0) return src;
  const body = src.slice(at + read.length, end);
  const last = body.lastIndexOf("RE_Direct(");
  const close = last < 0 ? -1 : body.indexOf(";", last);
  if (close < 0) return src;
  return src.slice(0, at) + read
    + `\n\t\tif ( any( greaterThan( ${kind}Light.color, vec3( 0.0 ) ) ) ) {`
    + body.slice(0, close + 1) + "\n\t\t}" + body.slice(close + 1)
    + src.slice(end);
}

const OUTGOING = "vec3 outgoingLight = reflectedLight.directDiffuse + "
  + "reflectedLight.indirectDiffuse + totalEmissiveRadiance;";

/**
 * `D3D: colour = clamp(light) * texel`, in gamma space, re-expressed in the
 * linear space three.js shades in. The lights are fed in with a factor of PI
 * that three.js's `BRDF_Lambert` divides back out (see {@link GunLights}), so
 * `direct + indirect` is `light * diffuse` channel by channel and dividing
 * the diffuse back out recovers the engine's light factor exactly; clamp it,
 * put it through the sRGB transfer, multiply. A texel channel at zero stays
 * zero whatever the division makes of it.
 */
const OUTGOING_CLAMPED = `
  vec3 gunLight = ( reflectedLight.directDiffuse + reflectedLight.indirectDiffuse )
    / max( diffuseColor.rgb, vec3( 1e-5 ) );
  gunLight = clamp( gunLight, 0.0, 1.0 );
  gunLight = mix( pow( gunLight * 0.9478672986 + 0.0521327014, vec3( 2.4 ) ),
                  gunLight * 0.0773993808,
                  vec3( lessThanEqual( gunLight, vec3( 0.04045 ) ) ) );
  vec3 outgoingLight = diffuseColor.rgb * gunLight + totalEmissiveRadiance;`;

/** The ambient, shared by every gun-lit program — one uniform object. */
const gunAmbient = { value: new Color(0.5, 0.5, 0.5) };

/**
 * A Lambert twin of an unlit stage material that shades the way the engine's
 * scene-light-array path does. Everything the PowerVR2 translation decided —
 * texture, colour, blend, alpha test, culling, fog — is carried over.
 */
function makeGunLitMaterial(base: Material): Material {
  const b = base as MeshBasicMaterial;
  const m = new MeshLambertMaterial({
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
  copyDrawState(b, m);
  m.userData = { ...base.userData, gunLit: true };
  const inner = base.onBeforeCompile;
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms,
                       renderer: WebGLRenderer) => {
    inner?.call(base, shader, renderer);
    shader.uniforms.gunAmbient = gunAmbient;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 gunAmbient;")
      .replace("#include <lights_fragment_begin>", LIGHTS_BEGIN)
      .replace(OUTGOING, OUTGOING_CLAMPED);
  };
  m.customProgramCacheKey = () => "gunlit";
  return m;
}

/** Is this material one the scene-light-array path could reasonably take? */
function lightable(m: Material): boolean {
  return m instanceof MeshBasicMaterial || m instanceof MeshLambertMaterial;
}

export class GunLights implements System<RenderContext> {
  readonly id = "render.gunlights";
  readonly group = new Group();
  source: GunLightSource = { live: () => false, litActor: () => false };
  private readonly spots: SpotLight[] = [];
  /** Entries 3..15 of `g_entity_lights` that are D3D point lights. */
  private readonly points: PointLight[] = [];
  /** Entries 3..15 of `g_entity_lights` that are D3D spot lights. */
  private readonly entitySpots: SpotLight[] = [];
  /** Meshes under a `draw_mode` 1 region node. */
  private regionLit: Mesh[] = [];
  /**
   * Every character hierarchy the stage carries, by spawn address, so the
   * per-frame test can ask the port about the actor behind it. A stage has
   * a hundred and more; only the few with a live actor are ever looked at.
   */
  private characters = new Map<number, Object3D>();
  /** The spawn addresses whose meshes the light holds now. */
  private litCharacters = new Set<number>();
  /**
   * Nodes another layer draws through the scene light array this frame --
   * `AssetDrawSlotWithAlphaSceneLights` (`FUN_00418620`) and its twin are
   * the light's, whichever routine makes the call. `render/type26_ripple.ts`
   * hands its water in; the app wires it.
   */
  sceneLitNodes: () => readonly Object3D[] = () => [];
  /** The nodes from {@link sceneLitNodes} the light holds now. */
  private litNodes = new Set<Object3D>();
  /** Unlit material -> its gun-lit twin, built once per stage. */
  private readonly twins = new Map<Material, Material>();
  /** Mesh -> the material it had before the gun light took it. */
  private readonly saved = new Map<Mesh, Material | Material[]>();
  private active = false;
  /** Can this stage's script light anything? See {@link build}. */
  private canLight = true;
  /** Which gun lights are on: the lights themselves are never hidden. */
  private readonly gunOn: boolean[] = new Array(GUN_LIGHTS).fill(false);
  /** The camera this layer last saw, for {@link stale}. */
  private readonly lastCamera = new Matrix4();
  private cameraMoved = false;
  private readonly _right = new Vector3();
  private readonly _up = new Vector3();

  constructor(private readonly scene: Scene,
              private readonly lighting: SceneLighting) {
    this.group.name = "gun_lights";
    for (let i = 0; i < GUN_LIGHTS; i++) {
      const sp = new SpotLight(0xffffff, 0, 0, Math.PI / 16, PENUMBRA, 0);
      sp.name = `gun_light_${i + 1}`;
      // In the scene and casting for good, dark and unmapped until it is on:
      // see the header for why it is never hidden.
      sp.castShadow = true;
      sp.shadow.autoUpdate = false;
      sp.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
      sp.shadow.camera.near = SHADOW_NEAR;
      sp.shadow.camera.far = SHADOW_FAR;
      sp.shadow.bias = SHADOW_BIAS;
      sp.shadow.normalBias = SHADOW_NORMAL_BIAS;
      this.spots.push(sp);
      this.group.add(sp, sp.target);
    }
    for (let i = ENTITY_POINT_FIRST; i < 16; i++) {
      // No shadow: a cube map per lamp is six passes, and the two point lights
      // the game ships hang in rooms the torch already shadows.
      const pt = new PointLight(0xffffff, 0, 0, 2);
      pt.name = `entity_light_${i}`;
      this.points.push(pt);
      this.group.add(pt);
      // No shadow either, for the same reason, and the gun lights' hard cone
      // with its presentation-only soft rim (see the header).
      const sp = new SpotLight(0xffffff, 0, 0, Math.PI / 16, PENUMBRA, 0);
      sp.name = `entity_spot_${i}`;
      this.entitySpots.push(sp);
      this.group.add(sp, sp.target);
    }
    scene.add(this.group);
  }

  /**
   * Index the stage: which meshes are `draw_mode` 1 region models, and where
   * each character hierarchy is. Every opaque mesh casts; the cost is nil
   * until a gun light is on and its `shadow.autoUpdate` with it.
   *
   * `canLight` is whether the stage's script ever turns the light array on;
   * a stage that never does has nothing for {@link warm} to compile.
   */
  build(root: Object3D, canLight = true): void {
    this.canLight = canLight;
    this.restoreAll();
    this.twins.clear();
    this.saved.clear();
    this.regionLit = [];
    this.characters = new Map();
    this.litCharacters = new Set();
    const visit = (o: Object3D, drawMode: number): void => {
      const x = o.userData as {
        hod2_draw_mode?: number; hod2_kind?: string; hod2_rig?: string;
        hod2_spawn_at?: number;
      };
      if (x?.hod2_kind === "rig" && x.hod2_rig?.startsWith("chr_")
          && x.hod2_spawn_at !== undefined) {
        this.characters.set(x.hod2_spawn_at, o);
      }
      const mode = x?.hod2_draw_mode ?? drawMode;
      const mesh = o as Mesh;
      if (mesh.isMesh) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const opaque = mats.every((m) => !m.transparent && m.depthWrite);
        mesh.castShadow = opaque;
        mesh.receiveShadow = true;
        if (mode === 1) this.regionLit.push(mesh);
      }
      for (const c of o.children) visit(c, mode);
    };
    visit(root, 0);
  }

  /** Is any gun light on this frame? */
  get live(): boolean {
    return this.active;
  }

  /**
   * Does the light owe one more frame?
   *
   * The port builds it from `ctx.view`, which is the camera **as last drawn**
   * (`CameraTakeSystem`), so on the frame the camera moves the light is one
   * frame behind it. While the game runs the next frame catches up; with the
   * transport stopped there is no next frame, and a deep link or a seek lands
   * with the torch built from the camera before the one on screen. So the
   * pacer asks this, and it is true for exactly the one frame that fixes it.
   */
  get stale(): boolean {
    return this.active && this.cameraMoved;
  }

  /**
   * Place the lights from `g_entity_lights`, and hand the lit set its
   * materials. A mesh the light lets go of gets back whatever the current
   * lighting view draws it with, which is `SceneLighting.viewMaterial`.
   */
  update(ctx: RenderContext): void {
    const base = (m: Material): Material => this.lighting.viewMaterial(m);
    this.cameraMoved = !ctx.camera.matrixWorld.equals(this.lastCamera);
    this.lastCamera.copy(ctx.camera.matrixWorld);
    let any = false;
    for (let i = 0; i < GUN_LIGHTS; i++) {
      const sp = this.spots[i];
      const idx = GUN_LIGHT_FIRST + i;
      const on = this.source.live(idx);
      this.gunOn[i] = on;
      sp.shadow.autoUpdate = on;
      if (!on) {
        sp.intensity = 0;
        continue;
      }
      any = true;
      const e = G.g_entity_lights[idx];
      // The engine's position, moved to the gun (see the header), and the
      // engine's direction unchanged.
      this._right.set(1, 0, 0).applyQuaternion(ctx.camera.quaternion);
      this._up.set(0, 1, 0).applyQuaternion(ctx.camera.quaternion);
      sp.position.set(e.pos.x, e.pos.y, e.pos.z)
        .addScaledVector(this._right, GUN_OFFSET_RIGHT)
        .addScaledVector(this._up, GUN_OFFSET_UP);
      sp.target.position.set(sp.position.x + e.dir.x, sp.position.y + e.dir.y,
                             sp.position.z + e.dir.z);
      sp.target.updateMatrixWorld();
      // D3D's cone angles are full angles; three.js takes the half-angle.
      sp.angle = e.theta / 2;
      // `1 / attenuation0`, in the engine's units, times PI because
      // three.js's Lambert divides by it. See the header.
      sp.intensity = (Math.PI * e.diffuse[0]) / Math.max(e.att0, 1e-6);
      sp.distance = 0;
      sp.decay = 0;
    }
    // The point lights. D3D attenuates by `1 / (att0 + att1 d + att2 d^2)`;
    // three.js's physical point light is `I / d^2` with `decay = 2`, so
    // `I = diffuse / att2` matches it everywhere `att0` is small beside
    // `att2 d^2` -- past two units for the lamp's `0.15` against `0.02`, and
    // inside that the vertex colour is saturated in both. [diverges] that
    // near field, declared here. Colour is the diffuse's ratio; the flicker is
    // `att2`, so it lands on the intensity. PI as for the spots.
    for (let k = 0; k < this.points.length; k++) {
      const pt = this.points[k];
      const idx = ENTITY_POINT_FIRST + k;
      const e = G.g_entity_lights[idx];
      const on = !!e && e.type === RenderLightType.Point && this.source.live(idx);
      if (!on) {
        pt.intensity = 0;
        continue;
      }
      any = true;
      const peak = Math.max(e.diffuse[0], e.diffuse[1], e.diffuse[2], 1e-6);
      pt.color.setRGB(e.diffuse[0] / peak, e.diffuse[1] / peak,
                      e.diffuse[2] / peak);
      pt.intensity = (Math.PI * peak) / Math.max(e.att2, 1e-6);
      pt.distance = e.range;
      pt.decay = 2;
      pt.position.set(e.pos.x, e.pos.y, e.pos.z);
    }
    // ...and the spots. Class 0x2B's two write `att0` and nothing past it,
    // `theta` and not `phi`, a grey diffuse and a 65536 range: the gun
    // light's terms exactly, so the gun light's mapping -- the half-angle,
    // `diffuse / att0` and no fall with distance.
    for (let k = 0; k < this.entitySpots.length; k++) {
      const sp = this.entitySpots[k];
      const idx = ENTITY_POINT_FIRST + k;
      const e = G.g_entity_lights[idx];
      const on = !!e && e.type === RenderLightType.Spot && this.source.live(idx);
      if (!on) {
        sp.intensity = 0;
        continue;
      }
      any = true;
      const peak = Math.max(e.diffuse[0], e.diffuse[1], e.diffuse[2], 1e-6);
      sp.color.setRGB(e.diffuse[0] / peak, e.diffuse[1] / peak,
                      e.diffuse[2] / peak);
      sp.intensity = (Math.PI * peak) / Math.max(e.att0, 1e-6);
      sp.angle = e.theta / 2;
      sp.distance = 0;
      sp.decay = 0;
      sp.position.set(e.pos.x, e.pos.y, e.pos.z);
      sp.target.position.set(e.pos.x + e.dir.x, e.pos.y + e.dir.y,
                             e.pos.z + e.dir.z);
      sp.target.updateMatrixWorld();
    }
    const [r, g, b] = G.g_light_array_ambient;
    gunAmbient.value.setRGB(r, g, b);

    if (!any) {
      if (this.active) this.restoreAll(base);
      this.active = false;
      this.litCharacters.clear();
      this.litNodes.clear();
      return;
    }
    if (!this.active) {
      for (const mesh of this.regionLit) this.light(mesh);
    }
    this.active = true;
    // Characters every frame, but only the live ones: which actors are lit
    // can change (a civilian spawned, an actor despawned) and a lit one's
    // meshes can too -- a gore swap clones a part onto a bone.
    const want = new Set<number>();
    for (const obj of G.g_object_list) {
      if (this.characters.has(obj.at) && this.source.litActor(obj.at)) {
        want.add(obj.at);
      }
    }
    for (const at of this.litCharacters) {
      if (want.has(at)) continue;
      this.characters.get(at)?.traverse((o) => {
        if ((o as Mesh).isMesh) this.restore(o as Mesh, base);
      });
    }
    for (const at of want) {
      this.characters.get(at)?.traverse((o) => {
        if ((o as Mesh).isMesh) this.light(o as Mesh);
      });
    }
    this.litCharacters = want;
    // ...and the nodes another layer drew through the light array, the same
    // way: every frame, the ones it hands over now.
    const nodes = new Set(this.sceneLitNodes());
    for (const n of this.litNodes) {
      if (nodes.has(n)) continue;
      n.traverse((o) => {
        if ((o as Mesh).isMesh) this.restore(o as Mesh, base);
      });
    }
    for (const n of nodes) {
      n.traverse((o) => {
        if ((o as Mesh).isMesh) this.light(o as Mesh);
      });
    }
    this.litNodes = nodes;
  }

  /**
   * The gun-lit twin of what a mesh wears -- built from its **unlit** base,
   * never from the scene-lit twin "+ scene light" has on it. That twin keeps
   * the device equation in its `onBeforeCompile` (`render/lighting.ts`),
   * which strips `lights_fragment_begin`, where three.js evaluates the spots
   * and their shadows: chained under this one's patch it left the patch
   * nothing to replace, and every gun-lit mesh drew the plain scene light
   * under the `gunlit` program key -- no torch, no shadow (`L110`).
   */
  private twinOf(worn: Material): Material {
    if (worn.userData?.gunLit) return worn;
    const m = unlitMaterial(worn);
    if (!lightable(m)) return worn;
    let t = this.twins.get(m);
    if (!t) {
      t = makeGunLitMaterial(m);
      this.twins.set(m, t);
    }
    return t;
  }

  /**
   * Under any fade the draw has put on the mesh: the light array is which
   * material a faded draw fades (`AssetDrawSlotWithAlphaSceneLights`,
   * `FUN_00418620`), so the twin goes underneath and the fade stays on top.
   * See `setUnfadedMaterial` in `render/draw_order.ts`.
   */
  private light(mesh: Mesh): void {
    const cur = unfadedMaterial(mesh);
    const isLit = Array.isArray(cur)
      ? cur.every((m) => m.userData?.gunLit)
      : !!cur.userData?.gunLit;
    if (isLit) return;
    this.saved.set(mesh, cur);
    setUnfadedMaterial(mesh, Array.isArray(cur)
      ? cur.map((m) => this.twinOf(m)) : this.twinOf(cur));
  }

  private restore(mesh: Mesh, base?: (m: Material) => Material): void {
    const prev = this.saved.get(mesh);
    if (!prev) return;
    this.saved.delete(mesh);
    const back = (m: Material): Material => (base ? base(m) : m);
    setUnfadedMaterial(mesh, Array.isArray(prev) ? prev.map(back) : back(prev));
  }

  private restoreAll(base?: (m: Material) => Material): void {
    for (const mesh of [...this.saved.keys()]) this.restore(mesh, base);
  }

  /**
   * Compile, now, every program the torch can add to the stage: each kind of
   * drawable's gun-lit twin, plain and faded, and the shadow pass's depth
   * program for each kind of caster. Called by `Player.warmShaders` while the
   * loading screen is up, after `SceneLighting.warm`.
   *
   * The lights are already in the scene in the only configuration they have
   * (see the header), so what is compiled here is exactly what the first lit
   * frame asks for. One mesh stands for its kind, as in `SceneLighting.warm`;
   * the twins made here are the ones {@link light} hands out later, since
   * {@link twinOf} keeps them for the stage. The copies are dropped and their
   * programs stay (`render/program_pins.ts`).
   */
  warm(drawables: readonly Object3D[], renderer: WebGLRenderer,
       camera: Camera): void {
    if (!this.canLight) return;
    const compile = (o: Object3D): void => {
      renderer.compile(o, camera, this.scene);
    };
    const meshes = drawables.filter((o): o is Mesh =>
      (o as Mesh).isMesh === true && !!(o as Mesh).material
      && !Array.isArray((o as Mesh).material));
    const lit = new Set<string>();
    for (const mesh of meshes) {
      const base = unlitMaterial(unfadedMaterial(mesh) as Material);
      if (!lightable(base)) continue;
      const kind = programKind(mesh, base);
      if (lit.has(kind)) continue;
      lit.add(kind);
      const was = mesh.material;
      const twin = this.twinOf(base);
      mesh.material = twin;
      compile(mesh);
      const faded = fadedCopy(twin);
      applyForcedAlphaBlend(faded, 0.5, twin.opacity);
      mesh.material = faded;
      compile(mesh);
      mesh.material = was;
    }
    // The depth pass, as `WebGLShadowMap` draws it: into a render target,
    // which makes the program's output linear and untonemapped, with no fog
    // (it hands `renderBufferDirect` no scene), and with
    // `MeshDepthMaterial`'s RGBA packing, the caster's map, alpha map and
    // alpha test, and the opposite side to the caster's.
    const target = new WebGLRenderTarget(1, 1);
    const wasTarget = renderer.getRenderTarget();
    const fog = this.scene.fog;
    this.scene.fog = null;
    renderer.setRenderTarget(target);
    try {
      const cast = new Set<string>();
      for (const mesh of meshes) {
        const m = mesh.material as MeshBasicMaterial;
        if (m.transparent || !m.depthWrite) continue;
        const g = mesh.geometry;
        const kind = [
          (mesh as { isSkinnedMesh?: boolean }).isSkinnedMesh ? "skin" : "",
          g?.morphAttributes && Object.keys(g.morphAttributes).length ? "morph" : "",
          m.side, m.map ? `map${m.map.channel}` : "", m.alphaMap ? "amap" : "",
          m.alphaTest > 0 ? "atest" : "",
        ].join("|");
        if (cast.has(kind)) continue;
        cast.add(kind);
        const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
        depth.side = SHADOW_SIDE[m.side];
        depth.map = m.map;
        depth.alphaMap = m.alphaMap;
        depth.alphaTest = m.alphaTest;
        const was = mesh.material;
        mesh.material = depth;
        compile(mesh);
        mesh.material = was;
      }
    } finally {
      renderer.setRenderTarget(wasTarget);
      this.scene.fog = fog;
      target.dispose();
    }
  }

  /** Everything here is derived from `G`; a load rebuilds it by updating. */
  resync(ctx: RenderContext): void {
    this.update(ctx);
  }

  get describe(): string {
    if (!this.active) return "off";
    const n = this.gunOn.filter((on) => on).length;
    return `${n} gun light${n === 1 ? "" : "s"}, ${this.saved.size} meshes lit`;
  }
}
