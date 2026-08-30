/**
 * The camera-following backdrop dome — the game's sky.
 *
 * Two opcodes drive it: `0x1B` picks a preset, `0x1C` sets the mode (0 off,
 * 2 drawn but frozen, anything else drawn and animating). The presets are a
 * 12 × 16-byte table at `0x00579968`:
 *
 * ```
 * +0x00  s16  asset slot A   the dome that is drawn
 * +0x02  s16  asset slot B   a second slot, used by the variant paths
 * +0x04  f32  dy             Y offset from the camera, 0 .. -3000
 * +0x08  s32  spin           BAMS added to the angle every frame
 * +0x0C  s32  angle0         BAMS the angle resets to when the preset changes
 * ```
 *
 * The draw is the block at `0x004132D0` (which Ghidra leaves undefined), and
 * transcribes to:
 *
 * ```
 * translate(camera.x, camera.y + dy, camera.z)
 * if (mode != 2) angle += spin
 * if (preset == 5) { rotateZ(180 deg); rotateY(-angle); }
 * else               rotateY(angle)
 * scale(1.2, 1.2, -1.2)
 * AssetDrawSlot(slot_a)
 * ```
 *
 * Two details matter and are easy to miss. It follows the camera in **all
 * three axes**, not just horizontally — so it can never be reached. And the
 * **Z scale is negative**, which turns the dome inside out: it is modelled to
 * be seen from within.
 *
 * The models need no special export. Every preset a stage uses is already in
 * the bundle because the script loads its asset slot with opcode `0x50`, and
 * the glTF nodes carry `hod2_slot`, so they can be found by id.
 *
 * Presets 8, 10 and 11 take separate draw paths that also scroll texture V by
 * −0.005/frame; that scroll is not reproduced here.
 */

import { Group, Mesh, Object3D, Vector3, type Material } from "three";
import type { BackdropJson, BackdropPreset } from "../bundle";

/** BAMS -> radians, the constant the matrix rotators use. */
const BAMS_TO_RAD = 9.58738e-5;

/** The scale the draw applies. Negative Z is deliberate. */
const DOME_SCALE = new Vector3(1.2, 1.2, -1.2);

export class Backdrop {
  readonly group = new Group();
  private presets: BackdropPreset[] = [];
  /** asset slot -> the node that draws it. */
  private readonly bySlot = new Map<number, Object3D>();
  /** Where each dome node came from, so it can be put back. */
  private readonly home = new Map<Object3D, Object3D>();
  private preset = -1;
  private mode = 0;
  private angleBams = 0;
  private enabled = true;
  private current: Object3D | null = null;

  constructor() {
    this.group.name = "backdrop";
    // The dome is behind everything and must not occlude it.
    this.group.renderOrder = -1000;
  }

  /**
   * Adopt the dome models out of the stage.
   *
   * They are moved rather than cloned: a dome is scenery no region draws, so
   * leaving it in the stage tree would let the region logic show it in place
   * — at its authored position rather than around the camera.
   */
  attach(root: Object3D, backdrop: BackdropJson | undefined): void {
    this.detach();
    this.presets = backdrop?.presets ?? [];
    if (!this.presets.length) return;

    const wanted = new Set<number>();
    for (const p of this.presets) wanted.add(p.slot_a);

    const found: Object3D[] = [];
    root.traverse((o) => {
      const slot = (o.userData as { hod2_slot?: number })?.hod2_slot;
      if (slot !== undefined && slot !== null && wanted.has(slot)) found.push(o);
    });
    for (const node of found) {
      const slot = (node.userData as { hod2_slot: number }).hod2_slot;
      if (node.parent) this.home.set(node, node.parent);
      this.bySlot.set(slot, node);
      node.visible = false;
      this.group.add(node);
      // Sky never occludes: draw first and leave the depth buffer alone.
      node.traverse((c) => {
        const mesh = c as Mesh;
        if (!mesh.isMesh) return;
        mesh.renderOrder = -1000;
        const mats = Array.isArray(mesh.material)
          ? mesh.material : [mesh.material];
        for (const m of mats) {
          if (!m) continue;
          // Cloned, because these materials are shared with ordinary geometry
          // and the depth change must not leak into it.
          const clone = (m as Material).clone();
          clone.depthWrite = false;
          if (Array.isArray(mesh.material)) {
            mesh.material[mesh.material.indexOf(m)] = clone;
          } else {
            mesh.material = clone;
          }
        }
      });
    }
  }

  /** Return the models to the stage tree. */
  detach(): void {
    for (const [node, parent] of this.home) {
      node.visible = true;
      parent.add(node);
    }
    this.home.clear();
    this.bySlot.clear();
    this.current = null;
    this.preset = -1;
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    this.group.visible = v && this.mode !== 0 && this.current !== null;
  }

  /**
   * Apply the script's state and advance the spin.
   *
   * `frames` is the elapsed time in 60 Hz frames, matching the per-frame
   * `angle += spin` the draw does.
   */
  update(preset: number, mode: number, camera: Vector3, frames: number): void {
    const p = this.presets[preset];
    this.mode = mode;

    if (preset !== this.preset) {
      // The draw resets the angle whenever the preset changes.
      this.preset = preset;
      this.angleBams = p ? p.angle0_bams : 0;
      if (this.current) this.current.visible = false;
      this.current = p ? this.bySlot.get(p.slot_a) ?? null : null;
    }

    const on = this.enabled && mode !== 0 && !!p && !!this.current;
    this.group.visible = on;
    if (this.current) this.current.visible = on;
    if (!on || !p) return;

    // Mode 2 is "drawn but frozen".
    if (mode !== 2) this.angleBams += p.spin_bams * frames;

    this.group.position.set(camera.x, camera.y + p.dy, camera.z);
    const a = this.angleBams * BAMS_TO_RAD;
    if (preset === 5) {
      this.group.rotation.set(0, -a, Math.PI, "ZYX");
    } else {
      this.group.rotation.set(0, a, 0, "ZYX");
    }
    this.group.scale.copy(DOME_SCALE);
  }

  get describe(): string {
    if (this.preset < 0) return "—";
    const p = this.presets[this.preset];
    if (!p) return `preset ${this.preset} (no entry)`;
    const state = this.mode === 0 ? "off" : this.mode === 2 ? "frozen" : "spin";
    const have = this.current ? "" : " — model not in this bundle";
    return `preset ${this.preset} ${state} dy ${p.dy.toFixed(0)}${have}`;
  }
}
