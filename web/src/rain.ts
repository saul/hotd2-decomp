/**
 * Rain — evt `0x1D`, transcribed from `FUN_004136A0`.
 *
 * Every number here is read out of that routine, not chosen:
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
import type { RainJson } from "./bundle";
import { mulberry32 } from "./walker";

const BAMS_TO_RAD = (Math.PI * 2) / 65536;

interface Drop {
  node: Object3D;
  x: number;
  y: number;
  z: number;
}

export class Rain {
  readonly group = new Group();
  private drops: Drop[] = [];
  private cfg: RainJson | null = null;
  private template: Object3D | null = null;
  private home: Object3D | null = null;
  private enabled = true;
  private on = false;
  private rand = mulberry32(1);
  private readonly _e = new Euler();
  private readonly _v = new Vector3();

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
  attach(root: Object3D, cfg: RainJson | undefined): void {
    this.detach();
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
      this.drops.push({ node, ...this.spawn() });
    }
  }

  detach(): void {
    for (const d of this.drops) this.group.remove(d.node);
    this.drops = [];
    if (this.template && this.home) this.home.add(this.template);
    this.template = null;
    this.home = null;
    this.group.visible = false;
  }

  private spawn(): { x: number; y: number; z: number } {
    const c = this.cfg!;
    const pick = (m: number, off: number) =>
      Math.floor(this.rand() * m) + off;
    return {
      x: pick(c.spawn.x[0], c.spawn.x[1]),
      y: pick(c.spawn.y[0], c.spawn.y[1]),
      z: pick(c.spawn.z[0], c.spawn.z[1]),
    };
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    this.group.visible = v && this.on;
  }

  /**
   * `on` is evt `0x1D`'s flag; `frames` is elapsed 60 Hz frames, matching the
   * routine's per-frame `y -= 2.0`.
   */
  update(on: boolean, camEye: Vector3, camYawRad: number, frames: number): void {
    this.on = on;
    const show = on && this.enabled && this.drops.length > 0;
    this.group.visible = show;
    if (!show || !this.cfg) return;

    const c = this.cfg;
    const cy = Math.cos(camYawRad);
    const sy = Math.sin(camYawRad);
    const roll = c.roll_bams * BAMS_TO_RAD;

    for (const d of this.drops) {
      d.y -= c.fall_per_frame * frames;
      if (d.y <= c.respawn_below) Object.assign(d, this.spawn());

      // RotY(camera_yaw) applied to the local offset, then the camera eye.
      // Matching MatrixRotateY's row-vector form: x' = x*cos + z*sin,
      // z' = -x*sin + z*cos.
      const rx = d.x * cy + d.z * sy;
      const rz = -d.x * sy + d.z * cy;
      this._v.set(camEye.x + rx, camEye.y + d.y, camEye.z + rz);
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
