/**
 * Rain, drawn — the draw half of `DrawRainParticles` (`FUN_004136A0`).
 *
 * **The simulation is not here.** The fifty positions and the fall live in
 * `game/effects/rain.ts` against `G.g_rain_particles`, which is where the
 * engine keeps them (`0x007C1EB8`) and what puts them in the snapshot. This
 * is the part that needs a camera: the camera-relative transform, the
 * per-drop facing, and the nodes.
 *
 * The routine, for reference — every number in both halves is read out of it,
 * not chosen:
 *
 * ```c
 * if (rain_enabled == 1) {
 *   SetDrawLayerNibble(0xE);
 *   for (p = 0x007C1EB8; p < 0x007C2114; p += 3 floats) {
 *     p.y -= 2.0;
 *     if (p.y <= -7.0) {                      // respawn
 *       p.x = rand() % 0x14 - 10.0;           // [-10,  9]
 *       p.y = rand() % 0x32 - 25.0;           // [-25, 24]
 *       p.z = rand() % 0x19 - 35.0;           // [-35,-11]
 *     }
 *     world = RotY(camera_yaw) * p + camera_eye;
 *     yaw   = angle_of(world - camera_eye with dy forced to 0);
 *     Translate(world); RotateY(yaw); RotateZ(0x100); Scale(1.5, 3.5, 1.0);
 *     AssetDrawSlotAlpha(0x53, 0.5);
 *   }
 *   SetDrawLayerNibble(8);
 * }
 * ```
 *
 * The array runs `0x007C1EB8 .. 0x007C2114` at 12 bytes a particle, which is
 * **50** — the count is not stored anywhere, it is the extent of the array.
 *
 * Three things are worth pointing out because they are not what a
 * from-scratch particle system would do:
 *
 * - The volume is rotated by the camera's **yaw only** and then offset by its
 *   eye, so it follows where the camera looks horizontally while staying
 *   world-vertical. Rain never falls at an angle when you look up.
 * - The spawn box is 20 x 50 x 25 sitting **in front of** the camera
 *   (z from -35 to -11), so drops are only ever created ahead of the view.
 * - Each drop is yawed to face the camera and then rolled by `0x100` BAMS —
 *   1.40625 degrees — so the streaks are very slightly off vertical.
 *
 * `rand()` is the CRT one, which `checkpoint` reseeds with 0 during gameplay
 * so a run is deterministic. A seeded generator is used here for the same
 * reason.
 */

import { Euler, Group, Mesh, Object3D, Vector3, type Material } from "three";
import type { RainJson } from "../bundle";
import { G } from "../game/globals";
import type { System } from "../core/system";
import type { RenderContext } from "./context";
import { BAMS_TO_RAD } from "../core/bams";

/** One drawn drop. Its *position* is `G.g_rain_particles[i]`, not here. */
interface Drop {
  node: Object3D;
}

export class Rain implements System<RenderContext> {
  readonly id = "render.rain";
  readonly group = new Group();
  private drops: Drop[] = [];
  private cfg: RainJson | null = null;
  private template: Object3D | null = null;
  private home: Object3D | null = null;
  private enabled = true;
  private on = false;
  private readonly _e = new Euler();
  private readonly _v = new Vector3();
  private readonly _fwdW = new Vector3();

  constructor() {
    this.group.name = "rain";
    this.group.visible = false;
    // Draw layer 0xE against a default of 8: late, and over most things.
    this.group.renderOrder = 900;
  }

  /**
   * Adopt the particle model out of the stage and clone it 50 times.
   *
   * The model is in the bundle as its own part with an empty region list --
   * no region draws it and no asset opcode loads it, because the effect
   * routine names the slot as a literal. Taking it out of the stage tree stops
   * the region logic from ever showing the single authored copy.
   */
  /**
   * No `detach`. The stage scope puts the borrowed particle model back and
   * drops the clones, which is the whole of what the teardown ever did.
   */
  build(ctx: RenderContext, root: Object3D,
        cfg: RainJson | undefined): void {
    ctx.scope.child("rain").defer(() => {
      for (const d of this.drops) this.group.remove(d.node);
      this.drops = [];
      // The template is *borrowed* from the stage tree, not made here, so it
      // goes home rather than being disposed.
      if (this.template && this.home) this.home.add(this.template);
      this.template = null;
      this.home = null;
      this.group.visible = false;
    });
    this.cfg = cfg ?? null;
    if (!cfg || !cfg.enabled_by_script) return;

    const hits: Object3D[] = [];
    root.traverse((o) => {
      const slot = (o.userData as { hod2_slot?: number })?.hod2_slot;
      if (slot === cfg.slot) hits.push(o);
    });
    const found = hits[0];
    if (!found) return;

    this.template = found;
    this.home = found.parent;
    found.visible = false;
    this.home?.remove(found);

    for (let i = 0; i < cfg.count; i++) {
      const node = found.clone(true);
      node.visible = true;
      node.traverse((c: Object3D) => {
        const mesh = c as Mesh;
        if (!mesh.isMesh) return;
        mesh.renderOrder = 900;
        const mats = Array.isArray(mesh.material)
          ? mesh.material : [mesh.material];
        const swap = mats.map((m) => {
          // AssetDrawSlotAlpha(0x53, 0.5) is the forced-alpha-blend path, and
          // it must not write depth or the drops occlude each other.
          const clone = (m as Material).clone();
          clone.transparent = true;
          clone.opacity = cfg.alpha;
          clone.depthWrite = false;
          return clone;
        });
        mesh.material = Array.isArray(mesh.material) ? swap : swap[0];
      });
      node.scale.set(cfg.scale[0], cfg.scale[1], cfg.scale[2]);
      this.group.add(node);
      this.drops.push({ node });
    }

  }





  setEnabled(v: boolean): void {
    this.enabled = v;
    this.group.visible = v && this.on;
  }

  /**
   * Draw the pool. evt `0x1D`'s flag decides whether it is shown; the
   * positions come from `G.g_rain_particles`, which `RainSystem` advanced in
   * the game phase.
   *
   * The yaw is read off the camera here rather than handed in. It used to
   * come from a vector `main.ts` filled *after* this ran, so the volume's
   * rotation was always one frame behind the shot it is meant to sit in.
   */
  update(ctx: RenderContext): void {
    const on = ctx.walker?.rain ?? false;
    const camEye = ctx.camera.position;
    ctx.camera.getWorldDirection(this._fwdW);
    const camYawRad = Math.atan2(-this._fwdW.x, -this._fwdW.z);
    this.on = on;
    const show = on && this.enabled && this.drops.length > 0;
    this.group.visible = show;
    if (!show || !this.cfg) return;

    const c = this.cfg;
    const cy = Math.cos(camYawRad);
    const sy = Math.sin(camYawRad);
    const roll = c.roll_bams * BAMS_TO_RAD;

    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      const p = G.g_rain_particles[i];
      if (!p) break;

      // RotY(camera_yaw) applied to the local offset, then the camera eye.
      // Matching MatrixRotateY's row-vector form: x' = x*cos + z*sin,
      // z' = -x*sin + z*cos.
      const rx = p.x * cy + p.z * sy;
      const rz = -p.x * sy + p.z * cy;
      this._v.set(camEye.x + rx, camEye.y + p.y, camEye.z + rz);
      d.node.position.copy(this._v);

      // The yaw the routine computes from the horizontal offset alone -- the
      // vertical component is passed as a literal 0, so a drop's facing never
      // changes as it falls.
      const yaw = Math.atan2(rx, rz);
      d.node.quaternion.setFromEuler(this._e.set(0, yaw, roll, "ZYX"));
    }
  }

  get describe(): string {
    if (!this.cfg?.enabled_by_script) return "—";
    if (!this.drops.length) return "no model in this bundle";
    return this.on ? `${this.drops.length} drops` : "off";
  }
}
