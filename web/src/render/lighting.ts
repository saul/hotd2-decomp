/**
 * The scene light the script drives, and the D3D fixed-function setup it feeds.
 *
 * Level geometry ships with **no light sources of its own** and bakes most of
 * its illumination into textures and the per-mesh base colour. But the
 * renderer does apply one directional light on top of that -- which is why
 * "+ scene light" is the default and unlit, the bake alone, is the
 * comparison -- and the script sets it: opcodes
 * `0x18`/`0x19` set the direction, `0x17` slerps it, and the `0x20`–`0x27`
 * tween channels 6/7/8 set its colour and 10 the ambient. The two light
 * blocks they write are `G`'s -- `g_scene_light_block0/1`,
 * `game/light_block.ts` -- and this reads them there.
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
 * **What the device does with it: the whole of D3D7's fixed-function light
 * equation, per vertex, on framebuffer bytes.** `[proved]` from the states the
 * exe sets and the ones it never touches. `D3DRENDERSTATE_LIGHTING` is never
 * written, so it keeps D3D7's default of on and every mesh draw is lit;
 * `SPECULARENABLE` is 1 from `RenderInitStates` (`0x004A7630`) and nothing
 * turns it off; `COLORVERTEX` is 0 and every material source is
 * `D3DMCS_MATERIAL`; `LOCALVIEWER` and `NORMALIZENORMALS` are never written
 * and keep their defaults (on, off); and every one of the 278,807 strips in
 * `pol/` sets bit `0x40`, which `WalkMeshChainAndDraw` turns into
 * `D3DSHADE_GOURAUD`. (The device pointer `0x007DEB74` is read by 25
 * routines and those are all of them.) The material is the mesh's own:
 * `WalkMeshChainAndDraw` (`FUN_004A7EF0`) calls `SetMaterial` per mesh with
 *
 * ```
 * diffuse  = base colour (+0x30..+0x38), alpha = base alpha (+0x2C)
 * ambient  = base colour * +0x28                     // `tex_ambient`
 * specular = offset colour (+0x40..+0x48) when power != 0, else 0
 * power    = shading (+0x24) < 1 ? 0 : 1 << shading
 * emissive = 0                                       // never written
 * ```
 *
 * so one vertex comes out of the device as
 *
 * ```
 * N.L    = dot(N, L)              N not renormalised, L toward the light
 * colour = clamp(Ma * (Ga + La) + (N.L > 0 ? Md * Ld * N.L : 0))
 * spec   = clamp(N.L > 0 && N.H > 0 ? Ms * Ls * N.H^P : 0)
 *          H = normalize(L + normalize(eye - vertex))
 * ```
 *
 * with `Ga` the packed `D3DRENDERSTATE_AMBIENT` and `La`, `Ld`, `Ls` the
 * light's three colours above; both are Gouraud-interpolated, and the pixel
 * is `texel * colour + spec` (`COLOROP MODULATE` against `DIFFUSE`, then the
 * specular add), and then the fog. Every one of those numbers is a fraction of
 * a framebuffer byte -- DX7 has no other kind -- so the program here computes
 * exactly that in the vertex shader, encodes the texel back to the byte the
 * file holds, and decodes the result so that three.js's output encode lands
 * it on the byte D3D wrote. The `N.L > 0` gate on the highlight is the
 * reference rasteriser's and not something the exe chooses: `[likely]`.
 *
 * Three things the port had wrong before this, all of them brightness:
 *
 * * three.js's `BRDF_Lambert` divides by pi and nothing put it back, so the
 *   scene light and ambient were each drawn at a third of their strength.
 *   (`render/gunlights.ts` feeds its lights in times pi for this reason.)
 * * The base colour was taken as linear light -- glTF's `baseColorFactor` is
 *   linear by the spec, and `GLTFLoader` adopts it so -- where the device
 *   multiplies the byte. A base colour of 0.5, the commonest dark value in the
 *   stages, drew at 0.73 of the texel instead of 0.5: the baked lighting of a
 *   fifth of the game's meshes came out washed out.
 * * The light was summed per pixel in linear light and never clamped, with no
 *   material ambient and no highlight. The engine saturates per vertex: under
 *   `LightBlockInit`'s ambient of 0.7 a lit face of a white mesh is the texel
 *   itself and an unlit one is `tex_ambient` (0.75 on 35,372 meshes) of it.
 */

import {
  Color,
  Mesh,
  MeshBasicMaterial,
  Matrix4,
  MeshLambertMaterial,
  Object3D,
  Vector3,
  type Material,
  type Scene,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { BAMS_TO_RAD } from "../core/bams";
import type { System } from "../core/system";
import { G } from "../game/globals";
import {
  CH_AMBIENT, CH_LIGHT_R, type LightBlock,
} from "../game/light_block";
import type { RenderContext } from "./context";
import {
  applyForcedAlphaBlend, copyDrawState, fadedCopy, setUnfadedMaterial, unfadedMaterial,
} from "./draw_order";
import { SRGB_TRANSFER_GLSL } from "./srgb_glsl";

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
 * lit by block 1. `[proved]` Both blocks are `G`'s; which actors are under
 * block 1 is the port's answer, which `app/` hands across
 * (`ActorDrawsUnderSecondaryLights`).
 *
 * Only this module's "+ scene light" view -- the default -- draws with
 * either; the unlit view shows no difference.
 */
export interface SecondaryLightSource {
  /** Is the actor at this spawn address drawn under block 1? */
  secondary(at: number): boolean;
}

/**
 * One light set as the device holds it after `SetLightingDefaultSingle`, in
 * the engine's own numbers -- fractions of a framebuffer byte, no colour
 * space conversion -- as the uniforms every twin drawn under it shares.
 */
interface DeviceLight {
  /** `D3DRENDERSTATE_AMBIENT` plus `light.ambient`: `Ga + La`. */
  ambient: { value: Color };
  /** `light.diffuse`, which `light.specular` is a copy of. */
  color: { value: Color };
  /** Toward the light, unit, in **view** space: rewritten every frame. */
  dirView: { value: Vector3 };
}

function deviceLight(): DeviceLight {
  return { ambient: { value: new Color(0, 0, 0) },
           color: { value: new Color(0, 0, 0) },
           dirView: { value: new Vector3(0, 0, 1) } };
}

/**
 * `SetLightingDefaultSingle`'s `D3DRENDERSTATE_AMBIENT` word
 * (`0x004AA15E`..`0x004AA19D`): each of `colour * ambient * 255.0` through
 * `__ftol`, which truncates, packed as
 *
 * ```
 * MOV EBX, r;  OR EBX, 0xFFFFFF00;  SHL EBX, 8
 * OR  EBX, g;  SHL EBX, 8;  OR EBX, b
 * ```
 *
 * so alpha is `0xFF` and nothing is clamped: a product past 1.0 carries its
 * high bits into the next byte up, as the hardware would see it.
 */
export function PackRenderAmbient(r: number, g: number, b: number): number {
  const ftol = (x: number) => Math.trunc(x * 255) | 0;
  let ebx = (ftol(r) | 0xffffff00) << 8;
  ebx = (ebx | ftol(g)) << 8;
  ebx |= ftol(b);
  return ebx >>> 0;
}

/**
 * One light set's colour terms from its block's colour and ambient scalar:
 * `SetLightingDefaultSingle`'s
 *
 * ```
 * t = colour * ambient
 * D3DRENDERSTATE_AMBIENT = PackRenderAmbient(t)      -> Ga
 * light.diffuse  = t * 1.4                           -> Ld (and Ls)
 * light.ambient  = colour * 0.3                      -> La
 * ```
 *
 * The device sums the two ambients before the material multiplies them, so
 * the set carries `Ga + La` as one.
 */
function fillDeviceLight(out: DeviceLight, rgb: readonly number[],
                         a: number): void {
  const [r, g, b] = [rgb[0]!, rgb[1]!, rgb[2]!];
  const ga = PackRenderAmbient(r * a, g * a, b * a);
  out.ambient.value.setRGB(
    ((ga >>> 16) & 0xff) / 255 + r * LIGHT_AMBIENT_SCALE,
    ((ga >>> 8) & 0xff) / 255 + g * LIGHT_AMBIENT_SCALE,
    (ga & 0xff) / 255 + b * LIGHT_AMBIENT_SCALE);
  out.color.value.setRGB(r * a * DIFFUSE_SCALE, g * a * DIFFUSE_SCALE,
                         b * a * DIFFUSE_SCALE);
}

/**
 * The per-mesh half of the equation: what `WalkMeshChainAndDraw` hands
 * `SetMaterial` besides the base colour, read off the exporter's
 * `extras.pvr2` (`tex_ambient`, `specular`, `specular_power`).
 *
 * A material without them is one the port made rather than one the game
 * loaded -- nothing in `pol/` lacks the words -- and is drawn with an ambient
 * scale of 1 and no highlight, the material the D3D defaults would give it.
 */
function materialTerms(m: Material): { amb: number; spec: Vector3;
                                       power: number } {
  const pvr2 = (m.userData as { pvr2?: { tex_ambient?: number;
    specular?: number[]; specular_power?: number } })?.pvr2;
  const s = pvr2?.specular;
  return {
    amb: pvr2?.tex_ambient ?? 1,
    spec: new Vector3(s?.[0] ?? 0, s?.[1] ?? 0, s?.[2] ?? 0),
    power: pvr2?.specular_power ?? 0,
  };
}

/** The program every scene-lit twin is drawn with, block 0, 1 or its own. */
const D3D_LIT_KEY = "d3dlit";

const D3D_VERTEX_PARS = /* glsl */`
uniform vec3 diffuse;
uniform vec3 d3dLightAmbient;
uniform vec3 d3dLightColor;
uniform vec3 d3dLightDir;
uniform float d3dTexAmbient;
uniform vec3 d3dSpecular;
uniform float d3dPower;
varying vec3 vD3dColour;
varying vec3 vD3dSpecular;
`;

/**
 * The equation in the module comment, once a vertex. `objectNormal` is the
 * normal after skinning and morphing, put through `normalMatrix` -- the
 * inverse transpose of the modelview, which is the matrix D3D7 transforms
 * normals by -- and **not renormalised**, because `NORMALIZENORMALS` is off:
 * the dome's 1.2 scale dims its light exactly as it did the engine's.
 * `transformedNormal` is not used because three flips it for a back-sided
 * material, which the device never does.
 */
const D3D_VERTEX_MAIN = /* glsl */`
{
	vec3 d3dN = normalMatrix * objectNormal;
	float d3dNL = dot( d3dN, d3dLightDir );
	vec3 d3dC = d3dTexAmbient * diffuse * d3dLightAmbient;
	vec3 d3dS = vec3( 0.0 );
	if ( d3dNL > 0.0 ) {
		d3dC += diffuse * d3dLightColor * d3dNL;
		if ( d3dPower > 0.0 ) {
			vec3 d3dH = normalize( d3dLightDir + normalize( - mvPosition.xyz ) );
			float d3dNH = dot( d3dN, d3dH );
			if ( d3dNH > 0.0 ) d3dS = d3dSpecular * d3dLightColor * pow( d3dNH, d3dPower );
		}
	}
	vD3dColour = clamp( d3dC, 0.0, 1.0 );
	vD3dSpecular = clamp( d3dS, 0.0, 1.0 );
}
`;

const D3D_FRAGMENT_PARS = SRGB_TRANSFER_GLSL + /* glsl */`
varying vec3 vD3dColour;
varying vec3 vD3dSpecular;
`;

/**
 * `COLOROP MODULATE` of the texel by the lit colour, then the specular add, on
 * bytes. Untextured, the texel is white (`DrawSpriteQuadCommand`'s untextured
 * arm is the only place the exe swaps the colour argument, and that is not a
 * mesh). Alpha is untouched: it is `diffuseColor.a` as the material built it.
 */
const D3D_OUTGOING = /* glsl */`
#ifdef USE_MAP
	vec3 d3dTexel = hod2SrgbEncode( sampledDiffuseColor.rgb );
#else
	vec3 d3dTexel = vec3( 1.0 );
#endif
	vec3 outgoingLight = hod2SrgbDecode(
		clamp( d3dTexel * vD3dColour + vD3dSpecular, 0.0, 1.0 ) );`;

const STOCK_OUTGOING = "vec3 outgoingLight = reflectedLight.directDiffuse + "
  + "reflectedLight.indirectDiffuse + totalEmissiveRadiance;";

/**
 * Rewrite a Lambert program into the device's equation. Every replacement is
 * checked: a three.js upgrade that moves a chunk would otherwise draw the
 * stock Lambert -- divided by pi, in linear light -- without a word.
 */
function patchD3dLit(shader: WebGLProgramParametersWithUniforms): void {
  const v = shader.vertexShader;
  const f = shader.fragmentShader;
  const swaps: [string, string, string][] = [
    ["vertex", "#include <common>", "#include <common>\n" + D3D_VERTEX_PARS],
    ["vertex", "#include <fog_vertex>", "#include <fog_vertex>\n" + D3D_VERTEX_MAIN],
    ["fragment", "#include <common>", "#include <common>\n" + D3D_FRAGMENT_PARS],
    ["fragment", "#include <lights_fragment_begin>", ""],
    ["fragment", "#include <lights_fragment_maps>", ""],
    ["fragment", "#include <lights_fragment_end>", ""],
    ["fragment", STOCK_OUTGOING, D3D_OUTGOING],
  ];
  let vs = v;
  let fs = f;
  for (const [stage, from, to] of swaps) {
    const src = stage === "vertex" ? vs : fs;
    if (!src.includes(from)) {
      console.warn(`lighting: ${stage} shader has no "${from}"; `
                   + "the scene light is three.js's Lambert, not the device's");
      return;
    }
    if (stage === "vertex") vs = src.replace(from, to);
    else fs = src.replace(from, to);
  }
  shader.vertexShader = vs;
  shader.fragmentShader = fs;
}

/**
 * A light colour one draw is made under -- `SetRenderLightColour`
 * (`FUN_004AA0A0`) just before an `AssetDrawSlot` and `LightsRestoreScene`
 * (`FUN_0041DCC0`) just after it, as `Class26Subtype67Draw` (`FUN_0048FB40`)
 * brackets `common.bin[135]`. The call changes the colour and nothing else,
 * so the draw is lit by the scene's block 0 -- its ambient, its direction --
 * through `SetLightingDefaultSingle` with that colour in place of the
 * block's: the same three terms {@link fillDeviceLight} computes for the
 * block's own colour.
 *
 * A node carries it as `userData.hod2_light_colour`, `[r, g, b]` in the
 * engine's 0..1, and every mesh under it is drawn with a twin whose uniforms
 * are this set's. The program is every scene-lit twin's; only the values
 * differ. A tag of `null` is the block's own colour again, for a node whose
 * parent carries a colour it does not share -- class 0x32's bones, each drawn
 * under the colour its own draw was made with.
 *
 * **Under block 1 when the actor is.** A draw between `LightsUseSecondarySet`
 * and `LightsRestoreScene` that changes the colour keeps block 1's ambient
 * and direction -- `Class32DrawNodeSlot` (`FUN_0047FC50`)'s flash and warm
 * light -- so a set is keyed by its block as well as its colour.
 *
 * `LightsUseCustomSet` (`FUN_0041DC10`) changes the other two terms as well:
 * `SetRenderAmbient(ambient)` and the direction from its own pitch and yaw,
 * through the same `SetLightingDefaultSingle`. A node carries that as
 * `userData.hod2_light_set`, {@link LightSet}, and is lit the same way with
 * the set's ambient, direction and colour where it names them and its
 * block's where it does not -- class 0x32's boss names only the direction
 * its draw was made under.
 */
interface ColouredLight extends DeviceLight {
  /** The colour, or null for the block's. */
  rgb: [number, number, number] | null;
  /** Block 1's ambient and direction rather than block 0's. */
  secondary: boolean;
  /** `SetRenderAmbient`'s scalar, or null for the block's. */
  ambientScalar: number | null;
  /** The world direction the light comes from, or null for the block's. */
  dir: [number, number, number] | null;
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

/**
 * One draw's light set, as the game recorded it with the draw: the ambient
 * scalar, the world direction the light comes from, and the colour in the
 * engine's 0..1 (`LightSetRecord`, `game/light_block.ts`) -- each `null` for
 * the draw's block's own. See `ColouredLight`.
 */
export interface LightSet {
  /** `SetRenderAmbient`'s scalar, or `null` for the block's. */
  ambient: number | null;
  dir: readonly number[] | null;
  rgb: readonly number[] | null;
}

export interface SceneLightState {
  /** Light colour, 0..1 per component, channels 6/7/8 (`+0x240`). */
  rgb: [number, number, number];
  /** The ambient scalar, channel 10 (`+0x24C`). */
  ambient: number;
  /** Direction the light comes from, the block's BAMS pitch and yaw. */
  pitch: number;
  yaw: number;
}

export const DEFAULT_LIGHT: SceneLightState = {
  rgb: [1, 1, 1],
  ambient: 0.7,                     // LightBlockInit's
  pitch: 0,
  yaw: 0,
};

/**
 * One of `G`'s light blocks as this module draws it: channels 6..8 and 10,
 * and the angles `BuildSceneLightDirection` builds the direction from.
 */
function blockLight(b: LightBlock): SceneLightState {
  const c = b.channels;
  return { rgb: [c[CH_LIGHT_R], c[CH_LIGHT_R + 1], c[CH_LIGHT_R + 2]],
           ambient: c[CH_AMBIENT], pitch: b.pitch, yaw: b.yaw };
}

/**
 * The world-space direction the light comes from, from a BAMS pitch/yaw pair
 * -- `BuildSceneLightDirection`'s world vector. See the derivation in the
 * module comment.
 */
export function lightDirection(pitch: number, yaw: number,
                               out = new Vector3()): Vector3 {
  const p = pitch * BAMS_TO_RAD;
  const y = yaw * BAMS_TO_RAD;
  const cp = Math.cos(p);
  return out.set(cp * Math.sin(y), -Math.sin(p), cp * Math.cos(y));
}


export class SceneLighting implements System<RenderContext> {
  readonly id = "render.lighting";
  /**
   * "+ scene light" by default: the script's light block drawn, which is
   * what the stages look like with their light. `unlit` is the baked
   * textures alone, one switch away in the Scene panel.
   */
  private mode: LightingMode = "scene";
  private state: SceneLightState = { ...DEFAULT_LIGHT };
  /** Block 0's device light, shared by every block-0 twin. */
  private readonly block0 = deviceLight();
  /** Block 1's, the same way. */
  private readonly block1 = deviceLight();
  /** Block-0 twins of the unlit materials, built once and reused. */
  private readonly lit = new Map<Material, Material>();
  /** Block-1 twins, the same way. */
  private readonly litSecondary = new Map<Material, Material>();
  /** Twins under a draw's own light colour, by colour -- see `ColouredLight`. */
  private readonly coloured = new Map<string, ColouredLight>();
  /** The layers whose meshes are not under the stage root. */
  private readonly extraRoots: Object3D[] = [];
  source: SecondaryLightSource = { secondary: () => false };
  private root: Object3D | null = null;

  /**
   * Takes the scene for the signature every layer has; the device light is
   * uniforms on the twins and puts nothing in it.
   */
  constructor(_scene: Scene) {
    this.refresh();
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
    this.applyMaterials();
  }

  private lastKey = "";

  /** Called every frame while a tween runs, so it no-ops when unchanged. */
  set(state: Partial<SceneLightState>): void {
    const next = { ...this.state, ...state };
    const key = `${next.rgb.join(",")}|${next.ambient}|` +
      `${next.pitch}|${next.yaw}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.state = next;
    this.refresh();
  }

  get current(): SceneLightState {
    return this.state;
  }

  /**
   * Light block 0, every tick, because the script ramps the colour over
   * frames rather than switching it; `set` no-ops when nothing moved. The
   * directions are rewritten every tick whatever moved: they are in view
   * space, and the camera moves.
   */
  update(ctx: RenderContext): void {
    this.set(blockLight(G.g_scene_light_block0));
    if (this.mode !== "scene") return;
    this.viewInverse.copy(ctx.camera.matrixWorldInverse);
    lightDirection(this.state.pitch, this.state.yaw, this.block0.dirView.value)
      .transformDirection(this.viewInverse);
    this.refreshSecondary();
    for (const set of this.coloured.values()) this.fillColoured(set);
  }

  /** The camera's world-to-view matrix as the last update saw it. */
  private readonly viewInverse = new Matrix4();

  /**
   * One set's uniforms, from its own terms and its block's for the ones it
   * does not name. Run for every set each tick, and at once for a set made
   * or re-aimed on the frame it is drawn, so no draw goes out with the
   * zeroes a fresh set starts at.
   */
  private fillColoured(set: ColouredLight): void {
    const l = set.secondary ? blockLight(G.g_scene_light_block1) : this.state;
    fillDeviceLight(set, set.rgb ?? l.rgb, set.ambientScalar ?? l.ambient);
    if (set.dir) set.dirView.value.fromArray(set.dir);
    else lightDirection(l.pitch, l.yaw, set.dirView.value);
    set.dirView.value.transformDirection(this.viewInverse);
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
   * block-0 and the block-1 one -- so neither is compiled on the frame a mesh
   * first needs it.
   *
   * The twins are made lazily, as meshes come into view. A program depends on
   * the material's kind and the mesh's (skinned, sides, alpha), not on the
   * texture or the light set -- every twin is the one `d3dlit` program -- so
   * one mesh of each kind stands for all of them: a few dozen compiles, where
   * twins for every one of a stage's five thousand materials would be memory
   * a phone does not have.
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
   * Block 1's uniforms, from `G`, by the same arithmetic `refresh` applies to
   * block 0 -- `SetLightingDefaultSingle` is one routine and both blocks go
   * through it. The direction is built from the block's angles as
   * `LightsUseSecondarySet` builds it at every character's draw.
   */
  private refreshSecondary(): void {
    const l = blockLight(G.g_scene_light_block1);
    fillDeviceLight(this.block1, l.rgb, l.ambient);
    lightDirection(l.pitch, l.yaw, this.block1.dirView.value)
      .transformDirection(this.viewInverse);
  }

  /**
   * What this view draws a stage material with: its block-0 twin under
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

  /** Block 0's colour terms, from the state `set` last took. */
  private refresh(): void {
    fillDeviceLight(this.block0, this.state.rgb, this.state.ambient);
  }

  /**
   * Swap between the exported unlit materials and the device-lit twins.
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
                   light: LightSet | null): void => {
      if (visibleOnly && !o.visible) return;
      const x = o.userData as { hod2_spawn_at?: number; hod2_actor_at?: number;
                                hod2_light_colour?: number[] | null;
                                hod2_light_set?: LightSet };
      const own = x?.hod2_actor_at ?? x?.hod2_spawn_at;
      const here = own !== undefined ? own : at;
      // A light set is the whole of a draw's light. A colour tag of `null`
      // is the block's own colour, not "inherit".
      const colour = x?.hod2_light_colour;
      const lit = x?.hod2_light_set
        ?? (colour !== undefined
          ? (colour ? { ambient: null, dir: null, rgb: colour } : null)
          : light);
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

  /** The exported unlit material behind any twin. */
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
   * The one program, with the colour set's own uniform objects.
   */
  private colouredTwinOf(m: Material, spec: LightSet,
                         secondary: boolean): Material {
    if (!(m instanceof MeshBasicMaterial)) return m;
    const rgb = spec.rgb;
    const amb = spec.ambient;
    const dir: [number, number, number] | null =
      spec.dir ? [spec.dir[0]!, spec.dir[1]!, spec.dir[2]!] : null;
    // A set that names its own direction is keyed on having one, not on its
    // value: the directions the callers name move with the camera (class
    // 0x2D's) or with the boss's pose (class 0x32's), and a set per
    // direction would be a material per frame. The set takes the direction
    // it was last asked for.
    const key = `${secondary ? "block1|" : ""}`
      + `${rgb ? `${rgb[0]},${rgb[1]},${rgb[2]}` : "block"}`
      + `|${amb}|${dir ? "dir" : "block"}`;
    let set = this.coloured.get(key);
    if (set && dir && (!set.dir || set.dir[0] !== dir[0]
                       || set.dir[1] !== dir[1] || set.dir[2] !== dir[2])) {
      set.dir = dir;
      this.fillColoured(set);
    }
    if (!set) {
      set = {
        ...deviceLight(),
        rgb: rgb ? [rgb[0]!, rgb[1]!, rgb[2]!] : null, secondary,
        ambientScalar: amb, dir,
        twins: new Map(),
      };
      this.coloured.set(key, set);
      this.fillColoured(set);
    }
    let twin = set.twins.get(m);
    if (!twin) {
      twin = d3dLitTwin(m, set, { lightColour: key });
      set.twins.set(m, twin);
      set.twins.set(twin, m);
    }
    return twin;
  }

  /** The block-1 twin: the one program, under block 1's device light. */
  private secondaryTwinOf(m: Material): Material {
    if (!(m instanceof MeshBasicMaterial)) return m;
    let twin = this.litSecondary.get(m);
    if (!twin) {
      twin = d3dLitTwin(m, this.block1, { secondaryLit: true });
      this.litSecondary.set(m, twin);
      this.litSecondary.set(twin, m);
    }
    return twin;
  }

  /** The block-0 twin of an unlit material, built once and cached both ways. */
  private twinOf(m: Material): Material {
    if (!(m instanceof MeshBasicMaterial)) return m;
    let twin = this.lit.get(m);
    if (!twin) {
      twin = d3dLitTwin(m, this.block0, {});
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
      `pitch ${(this.state.pitch * 360 / 65536).toFixed(0)}° `
      + `yaw ${(this.state.yaw * 360 / 65536).toFixed(0)}°`;
  }
}

/** Every device-lit twin's unlit base, whichever set the twin is under. */
const TWIN_BASE = new WeakMap<Material, Material>();

/**
 * The unlit material behind a device-lit twin, or the material itself.
 *
 * **A layer that clones a mesh's material to change it clones this, not what
 * the mesh is wearing.** A twin's light lives in `onBeforeCompile` and its
 * program key, and `Material.clone` carries neither, so a clone of a twin is a
 * stock `MeshLambertMaterial` -- lit by three.js's lights, of which this
 * module puts none in the scene: black. And the lighting swap does not twin
 * it again, because it is not an unlit material any more. The canal tiles
 * went black exactly so: `render/water_surfaces.ts` cloned each tile's
 * material for its bilinear filter after the swap had put the twin on it.
 * A clone of the base is an unlit material like any other, which the next
 * swap gives a twin of its own, the clone's changes and all.
 */
export function unlitMaterial(m: Material): Material {
  return TWIN_BASE.get(m) ?? m;
}

/**
 * A device-lit twin of an unlit material: a `MeshLambertMaterial` for the
 * normals and the chunks it brings, with the light loop replaced by the
 * device's equation (`patchD3dLit`), drawn under `light`'s uniforms and its
 * own mesh's material terms.
 *
 * `diffuse` is the material's colour, which is the exporter's base colour
 * **as the number the mesh file holds**: `GLTFLoader` adopts
 * `baseColorFactor` as linear, which is to say unconverted, so the shader
 * reads exactly `D3DMATERIAL7.diffuse`.
 */
function d3dLitTwin(m: MeshBasicMaterial, light: DeviceLight,
                    tag: Record<string, unknown>): Material {
  const twin = new MeshLambertMaterial({
    map: m.map,
    color: m.color,
    transparent: m.transparent,
    opacity: m.opacity,
    alphaTest: m.alphaTest,
    alphaMap: m.alphaMap,
    side: m.side,
    depthWrite: m.depthWrite,
    depthTest: m.depthTest,
    blending: m.blending,
    vertexColors: m.vertexColors,
    fog: m.fog,
    name: m.name,
  });
  // The depth function and blend factors `TranslatePvr2StateToD3D`
  // decided, which the constructor above does not take.
  copyDrawState(m, twin);
  twin.userData = { ...m.userData, ...tag };
  const terms = materialTerms(m);
  const own = {
    d3dTexAmbient: { value: terms.amb },
    d3dSpecular: { value: terms.spec },
    d3dPower: { value: terms.power },
  };
  // Keep the fog uniform hook the fog module installed.
  const inner = m.onBeforeCompile;
  twin.onBeforeCompile = (shader, renderer) => {
    inner?.call(m, shader, renderer);
    shader.uniforms.d3dLightAmbient = light.ambient;
    shader.uniforms.d3dLightColor = light.color;
    shader.uniforms.d3dLightDir = light.dirView;
    Object.assign(shader.uniforms, own);
    patchD3dLit(shader);
  };
  twin.customProgramCacheKey = () => D3D_LIT_KEY;
  TWIN_BASE.set(twin, m);
  return twin;
}
