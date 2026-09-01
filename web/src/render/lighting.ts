/**
 * The scene light the script drives, and the D3D fixed-function setup it feeds.
 *
 * Level geometry ships with **no light sources of its own** and bakes most of
 * its illumination into textures and the per-mesh base colour — which is why
 * unlit is the default and the faithful baseline. But the renderer does apply
 * one directional light on top of that, and the script sets it: opcodes
 * `0x18`/`0x19` set the direction, `0x17` slerps it, and the `0x20`–`0x27`
 * tween channels 6/7/8 set its colour and 10 the ambient.
 *
 * `SetLightingDefaultSingle` (`0x004AA120`) is the whole setup, and it is
 * short enough to transcribe exactly:
 *
 * ```c
 * SetRenderState(D3DRENDERSTATE_AMBIENT, pack_argb(ambient));
 * light.diffuse  = light_colour * 1.4;
 * light.specular = light.diffuse;
 * light.ambient  = light_colour * 0.3;
 * light.direction = g_render_light_dir;      // negated on the way in
 * SetLight(0, &light);  LightEnable(0, TRUE);
 * for (i = 1; i < 16; i++) LightEnable(i, FALSE);
 * ```
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
 * and `FUN_004AA0E0` negates it, so `dir` is the direction the light *comes
 * from*. Both angles are BAMS: the rotators multiply by `9.58738e-05`, which
 * is 2*pi/65536.
 *
 * **What is approximate here.** D3D fixed-function lighting and three.js's
 * Lambert model are not the same shader, and the game's material ambient and
 * specular terms are not modelled. This reproduces the *inputs* faithfully —
 * direction, colour, the 1.4 and 0.3 scalings, the global ambient — and
 * accepts that the response curve is three.js's. It is off by default for
 * that reason.
 */

import {
  AmbientLight,
  SpotLight,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  Scene,
  Vector3,
  type Material,
} from "three";
import type { System } from "../core/system";
import type { RenderContext } from "./context";

/** 2*pi / 65536 — the constant both matrix rotators multiply by. */

/** `SetLightingDefaultSingle`'s two scalings of the scene light colour. */
export const DIFFUSE_SCALE = 1.4;
export const LIGHT_AMBIENT_SCALE = 0.3;

export type LightingMode = "unlit" | "scene";

/**
 * `BuildEntitySpotlightArray` (`0x00480AC0`), reached from evt opcode `0x15`
 * and only while `0x14` is on.
 *
 * Despite the name it is not one light per enemy: the loop runs over the
 * array at `0x009A5C74` with a `0x130` stride and a `0x009A5ED4` bound —
 * **two entries**, the two players. Each light is positioned at the world
 * point the player's crosshair projects to at view-space `z = -1`
 * (`aim / g_projection_distance_px`), and aimed along `eye -> that point`.
 * It is the gun light.
 *
 * The player has no gun and no aim, so the crosshair is taken as centred,
 * which places the light one unit in front of the camera pointing forward.
 *
 * The constants are verbatim: `theta = phi = 0.3926991` (pi/8, and D3D's cone
 * angles are full angles, so three.js's half-angle is pi/16), falloff 1,
 * attenuation0 0.5, diffuse white, range effectively infinite.
 */
export const GUN_LIGHT_CONE = Math.PI / 8;
export const GUN_LIGHT_ATTEN0 = 0.5;

export interface SceneLightState {
  /** Light colour, 0..1 per component, from tween channels 6/7/8. */
  rgb: [number, number, number];
  /** Global ambient, from channel 10. */
  ambient: number;
  /**
   * Direction the light comes from. The script stores BAMS; `hod2lib.script`
   * converts to degrees on the way out, so that is what travels.
   */
  pitchDeg: number;
  yawDeg: number;
}

export const DEFAULT_LIGHT: SceneLightState = {
  rgb: [1, 1, 1],
  ambient: 0.5,
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
  /** The two players' gun lights, from evt 0x15. */
  private readonly guns: SpotLight[] = [];
  private gunsOn = false;
  private sceneLightingOn = false;
  private mode: LightingMode = "unlit";
  private intensity = 1;
  private state: SceneLightState = { ...DEFAULT_LIGHT };
  /** Lambert twins of the unlit materials, built once and reused. */
  private readonly lit = new Map<Material, Material>();
  private root: Object3D | null = null;
  private readonly _v = new Vector3();
  private readonly _fwd = new Vector3();

  constructor(scene: Scene) {
    this.group.name = "scene_lights";
    this.group.add(this.dir, this.dir.target, this.amb);
    for (let i = 0; i < 2; i++) {
      // D3D cone angles are full angles; three.js `angle` is the half-angle.
      // theta == phi, so the edge is hard and penumbra is 0.
      const sp = new SpotLight(0xffffff, 1, 0, GUN_LIGHT_CONE / 2, 0, 0);
      sp.visible = false;
      this.guns.push(sp);
      this.group.add(sp, sp.target);
    }
    this.group.visible = false;
    scene.add(this.group);
  }

  /** Remember the stage root so materials can be swapped in place. */
  build(root: Object3D): void {
    this.root = root;
    this.lit.clear();
    if (this.mode === "scene") this.applyMaterials();
  }

  get lightingMode(): LightingMode {
    return this.mode;
  }

  setMode(mode: LightingMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.group.visible = mode === "scene";
    this.refreshGuns();
    this.applyMaterials();
  }

  /**
   * evt `0x15` (gun lights) and `0x14` (scene lighting), which gates it.
   * `BuildEntitySpotlightArray` only fills the array while `0x14` is set.
   */
  setGunLights(on: boolean): void {
    this.gunsOn = on;
    this.refreshGuns();
  }

  setSceneLighting(on: boolean): void {
    this.sceneLightingOn = on;
    this.refreshGuns();
  }

  private refreshGuns(): void {
    const on = this.mode === "scene" && this.gunsOn && this.sceneLightingOn;
    for (const g of this.guns) g.visible = on;
  }

  /** Place the gun lights for the current view. Aim is taken as centred. */
  updateGunLights(eye: Vector3, forward: Vector3): void {
    if (!this.guns[0]?.visible) return;
    for (const g of this.guns) {
      // The light sits at the crosshair's world point, one unit ahead.
      g.position.copy(forward).multiplyScalar(1).add(eye);
      g.target.position.copy(forward).multiplyScalar(2).add(eye);
      g.target.updateMatrixWorld();
      g.intensity = this.intensity;
      g.decay = 0;                     // attenuation1/2 are both 0
      g.distance = 0;                  // range is effectively infinite
    }
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
   * The script's light block, the two evt gates, and the gun lights' place in
   * the world — all four every tick, because the script ramps the colour over
   * frames rather than switching it. `set` and `refreshGuns` no-op when
   * nothing actually moved.
   */
  update(ctx: RenderContext): void {
    const w = ctx.walker;
    if (!w) return;
    this.set(w.light);
    this.setGunLights(w.gunLights);
    this.setSceneLighting(w.sceneLighting);
    this.updateGunLights(ctx.camera.position,
                         ctx.camera.getWorldDirection(this._fwd));
  }

  resync(ctx: RenderContext): void {
    this.update(ctx);
  }

  private refresh(): void {
    const [r, g, b] = this.state.rgb;
    // light.diffuse = colour * 1.4. three.js splits colour and intensity, so
    // the 1.4 rides on the intensity and the colour stays in gamut.
    this.dir.color.setRGB(r, g, b);
    this.dir.intensity = DIFFUSE_SCALE * this.intensity;

    // The global D3DRENDERSTATE_AMBIENT plus the light's own ambient term.
    this.amb.color.setRGB(
      this.state.ambient + r * LIGHT_AMBIENT_SCALE,
      this.state.ambient + g * LIGHT_AMBIENT_SCALE,
      this.state.ambient + b * LIGHT_AMBIENT_SCALE,
    );
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
  private applyMaterials(): void {
    if (!this.root) return;
    const want = this.mode === "scene";
    this.root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const swap = (m: Material): Material => {
        if (want) {
          if (m instanceof MeshLambertMaterial) return m;
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
            twin.userData = m.userData;
            // Keep the fog uniform hook the fog module installed.
            twin.onBeforeCompile = m.onBeforeCompile;
            this.lit.set(m, twin);
            this.lit.set(twin, m);        // reverse, for the swap back
          }
          return twin;
        }
        // Back to unlit: the reverse mapping was stored alongside.
        const back = this.lit.get(m);
        return back && back instanceof MeshBasicMaterial ? back : m;
      };
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(swap)
        : swap(mesh.material);
    });
    this.refresh();
  }

  get describe(): string {
    if (this.mode === "unlit") return "unlit (baked)";
    const [r, g, b] = this.state.rgb;
    const c = new Color(r, g, b).getHexString();
    return `#${c} x${DIFFUSE_SCALE} amb ${this.state.ambient.toFixed(2)} ` +
      `pitch ${this.state.pitchDeg.toFixed(0)}° yaw ${this.state.yawDeg.toFixed(0)}°`;
  }
}
