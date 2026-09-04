/**
 * The camera-following backdrop dome — the game's sky.
 *
 * Two opcodes drive it: `0x1B` picks a preset, `0x1C` sets the mode (0 off,
 * 2 drawn but frozen, anything else drawn and animating). The presets are a
 * 12 × 16-byte table at `0x00579968`:
 *
 * ```
 * +0x00  s16  asset slot A   the dome that is spun
 * +0x02  s16  asset slot B   a second model, drawn flat around the camera
 * +0x04  f32  dy             Y offset from the camera, 0 .. -3000
 * +0x08  s32  spin           BAMS added to the angle every frame
 * +0x0C  s32  angle0         BAMS the angle resets to when the preset changes
 * ```
 *
 * The draw is `DrawBackdropDome` at `0x004132D0`, and transcribes to:
 *
 * ```
 * if (preset != last_preset) angle = angle0
 * if (mode == 0) return                     // 0x0041331A
 * push
 *   translate(camera.x, camera.y + dy, camera.z)
 *   if (mode != 2) angle += spin
 *   if (preset == 5) { rotateZ(180 deg); rotateY(-angle); }
 *   else               rotateY(angle)
 *   scale(1.2, 1.2, -1.2)
 *   AssetDrawSlot(slot_a)
 * pop
 * if (slot_b != 0) {                        // 0x0041345E
 *   push
 *     translate(camera.x, camera.y + dy, camera.z)
 *     AssetDrawSlot(slot_b)                 // no rotation, no scale
 *   pop
 * }
 * last_preset = preset
 * ```
 *
 * Three details matter and are easy to miss. It follows the camera in **all
 * three axes**, not just horizontally — so it can never be reached. The
 * **Z scale is negative**, which turns the dome inside out: it is modelled to
 * be seen from within. And **`slot_b` is a second draw of its own**, after
 * the dome and outside its push, with the translate and nothing else: the
 * preset's spin and its inside-out scale do not apply to it.
 *
 * `slot_b` used to be ignored here, and that is not the same as it being
 * absent. It is an ordinary node of the stage's glTF, with an asset slot the
 * script loads with `0x50` and no region, so `StageScene` drew it **in place**
 * — at its authored position, from the frame its slot loaded, for the whole
 * stage, whatever the mode said. Every one of stages 1–4 uses a preset with a
 * non-zero `slot_b`; stage 3's is `st1_1` entry 39. So the bug read as a piece
 * of backdrop stuck in the wrong place and visible when the sky was off, and
 * both halves are the one omission: it is adopted here now, like `slot_a`.
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
import { IDLE_TICK, type System, type Tick }
  from "../core/system";
import type { RenderContext } from "./context";
import { BAMS_TO_RAD } from "../core/bams";
import type { Scope } from "../core/scope";
import { prepareFogMaterial } from "./fog";

/** The scale the draw applies. Negative Z is deliberate. */
const DOME_SCALE = new Vector3(1.2, 1.2, -1.2);

export class Backdrop implements System<RenderContext> {
  readonly id = "render.backdrop";
  readonly group = new Group();
  /**
   * The two draws, as two nodes, because they are two matrices.
   *
   * `slot_a` is pushed, translated, spun and scaled inside out; `slot_b` is
   * pushed again after the pop and only translated. A single group cannot
   * carry both, and parenting B under A would give it A's spin and A's
   * negative Z.
   */
  private readonly domeGroup = new Group();
  private readonly flatGroup = new Group();
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
  /** The `slot_b` node of the current preset, if it has one. */
  private currentFlat: Object3D | null = null;

  constructor() {
    this.group.name = "backdrop";
    this.domeGroup.name = "backdrop_dome";
    this.flatGroup.name = "backdrop_flat";
    this.group.add(this.domeGroup, this.flatGroup);
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
  /**
   * No `detach`. The dome models are *adopted* out of the stage tree rather
   * than made here, so the scope's job is to put them back where they came
   * from -- which is exactly what the teardown did.
   */
  build(root: Object3D, stage: Scope, backdrop: BackdropJson | undefined): void {
    stage.child("backdrop").defer(() => {
      for (const [node, parent] of this.home) {
        node.visible = true;
        parent.add(node);
      }
      this.home.clear();
      this.bySlot.clear();
      this.current = null;
      this.currentFlat = null;
      this.preset = -1;
    });
    this.presets = backdrop?.presets ?? [];
    if (!this.presets.length) return;

    // **Both slots.** `slot_b` is a draw of its own and has to leave the stage
    // tree for the same reason `slot_a` does -- see the header.
    const wanted = new Set<number>();
    for (const p of this.presets) {
      wanted.add(p.slot_a);
      // 0 is the table's "no second model", and `AssetDrawSlot(0)` draws
      // nothing (`FUN_00418560`'s first test).
      if (p.slot_b) wanted.add(p.slot_b);
    }
    // Which group a node belongs in. No slot in the shipped table is both, and
    // if one ever were the spun draw is the one that has to own the node.
    const domeSlots = new Set(this.presets.map((p) => p.slot_a));
    const flatSlots = new Set(this.presets.map((p) => p.slot_b)
      .filter((s) => s && !domeSlots.has(s)));

    const found: Object3D[] = [];
    root.traverse((o) => {
      const slot = (o.userData as { hod2_slot?: number })?.hod2_slot;
      if (slot !== undefined && slot !== null && wanted.has(slot)) found.push(o);
    });
    for (const node of found) {
      const slot = (node.userData as { hod2_slot: number }).hod2_slot;
      const flat = flatSlots.has(slot);
      if (node.parent) this.home.set(node, node.parent);
      this.bySlot.set(slot, node);
      node.visible = false;
      (flat ? this.flatGroup : this.domeGroup).add(node);
      // Sky never occludes: draw first and leave the depth buffer alone.
      // `slot_b` goes after `slot_a`, which is the order the two draws run in.
      node.traverse((c) => {
        const mesh = c as Mesh;
        if (!mesh.isMesh) return;
        mesh.renderOrder = flat ? -999 : -1000;
        const mats = Array.isArray(mesh.material)
          ? mesh.material : [mesh.material];
        for (const m of mats) {
          if (!m) continue;
          // Cloned, because these materials are shared with ordinary geometry
          // and the depth change must not leak into it.
          const clone = (m as Material).clone();
          clone.depthWrite = false;
          // The clone is made *after* `sceneFog.prepare` has walked the stage
          // tree, and `Material.copy` does not carry `onBeforeCompile` -- so
          // without this the dome fogs planar while the stage fogs radial.
          prepareFogMaterial(clone);
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

  setEnabled(v: boolean): void {
    this.enabled = v;
    this.group.visible = v && this.mode !== 0 && this.current !== null;
  }

  /**
   * Apply the script's state and advance the spin.
   *
   * `frames` is the number of 60 Hz frames the tick actually advanced,
   * matching the per-frame `angle += spin` the draw does.
   *
   * It used to be `t.wall * 60` — wall-clock seconds — with a note saying that
   * kept the dome turning while the script was stepped an instruction at a
   * time. That is a clock the port does not have: the same run at a different
   * frame rate, or at any transport speed but 1x, put the sky at a different
   * angle, and a driven run could not be compared against itself. The rule
   * that `render/` reads the engine's clock and never its own is the same rule
   * `verify_layers` enforces as `performance`/`Date` in `engine`; this was the
   * one place above the line that broke it.
   */
  update(ctx: RenderContext, t: Tick): void {
    const w = ctx.walker;
    if (!w) return;
    const preset = w.backdropPreset;
    const mode = w.backdropMode;
    const camera = ctx.camera.position;
    const frames = t.frozen ? 0 : t.frames;
    const p = this.presets[preset];
    this.mode = mode;

    if (preset !== this.preset) {
      // The draw resets the angle whenever the preset changes.
      this.preset = preset;
      this.angleBams = p ? p.angle0_bams : 0;
      if (this.current) this.current.visible = false;
      if (this.currentFlat) this.currentFlat.visible = false;
      this.current = p ? this.bySlot.get(p.slot_a) ?? null : null;
      this.currentFlat = p && p.slot_b
        ? this.bySlot.get(p.slot_b) ?? null : null;
    }

    // `mode == 0` returns before the first push, so neither draw happens.
    const on = this.enabled && mode !== 0 && !!p && !!this.current;
    this.group.visible = on;
    if (this.current) this.current.visible = on;
    if (this.currentFlat) this.currentFlat.visible = on;
    if (!on || !p) return;

    // Mode 2 is "drawn but frozen".
    if (mode !== 2) this.angleBams += p.spin_bams * frames;

    // Both draws start from the same translate.
    this.domeGroup.position.set(camera.x, camera.y + p.dy, camera.z);
    this.flatGroup.position.copy(this.domeGroup.position);
    const a = this.angleBams * BAMS_TO_RAD;
    if (preset === 5) {
      this.domeGroup.rotation.set(0, -a, Math.PI, "ZYX");
    } else {
      this.domeGroup.rotation.set(0, a, 0, "ZYX");
    }
    this.domeGroup.scale.copy(DOME_SCALE);
  }

  /**
   * The spin angle is the one thing here that is not a function of the
   * restored script state, and the draw resets it whenever the preset
   * changes — so a load re-seats it from the preset rather than carrying a
   * rotation that belongs to wherever the player was before the seek.
   */
  resync(ctx: RenderContext): void {
    this.preset = -1;
    this.update(ctx, IDLE_TICK);
  }

  get describe(): string {
    if (this.preset < 0) return "—";
    const p = this.presets[this.preset];
    if (!p) return `preset ${this.preset} (no entry)`;
    const state = this.mode === 0 ? "off" : this.mode === 2 ? "frozen" : "spin";
    const have = this.current ? "" : " — model not in this bundle";
    const two = this.currentFlat ? " + flat" : "";
    return `preset ${this.preset} ${state} dy ${p.dy.toFixed(0)}${two}${have}`;
  }
}
