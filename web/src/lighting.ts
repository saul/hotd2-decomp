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

/** 2*pi / 65536 — the constant both matrix rotators multiply by. */
export const BAMS_TO_RAD = 9.58738e-5;

/** `SetLightingDefaultSingle`'s two scalings of the scene light colour. */
export const DIFFUSE_SCALE = 1.4;
export const LIGHT_AMBIENT_SCALE = 0.3;

export type LightingMode = "unlit" | "scene";

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

export class SceneLighting {
  readonly group = new Group();
  private readonly dir = new DirectionalLight(0xffffff, DIFFUSE_SCALE);
  private readonly amb = new AmbientLight(0xffffff, 1);
  private mode: LightingMode = "unlit";
  private intensity = 1;
  private state: SceneLightState = { ...DEFAULT_LIGHT };
  /** Lambert twins of the unlit materials, built once and reused. */
  private readonly lit = new Map<Material, Material>();
  private root: Object3D | null = null;
  private readonly _v = new Vector3();

  constructor(scene: Scene) {
    this.group.name = "scene_lights";
    this.group.add(this.dir, this.dir.target, this.amb);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** Remember the stage root so materials can be swapped in place. */
  attach(root: Object3D): void {
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
