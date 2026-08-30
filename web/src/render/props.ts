/**
 * Scripted scenery: the doors, shutters and van doors the script opens.
 *
 * The exporter has placed the geometry — a prop is one model at a pose, so it
 * goes through the rig writer with a fixed placement, and the glTF arrives with
 * each prop already standing where it belongs. What is left is the two things
 * that only the running script knows: whether a prop is still there, and how
 * far its hinge has swung.
 *
 * ## The hinge, from `FUN_00473CF0`
 *
 * ```c
 * if (remove_flag >= 0 && g_script_flags[remove_flag]) { despawn(); }
 * if (g_script_flags[open_flag]) {
 *     f = frame++;                          // clamped at 59, or 129 on curve 4
 *     rx = curve[f].rx; ry = curve[f].ry; rz = curve[f].rz;
 *     obj.rz  = base_rz + rz;
 *     obj.rx  = base_rx + side * rx;
 *     obj.yaw = ry * swing_scale * (side < 1 ? -1 : +1);
 * }
 * Translate(pos); RotY(base_yaw); RotZ(obj.rz); RotY(obj.yaw); RotX(obj.rx);
 * ```
 *
 * The two Y rotations with a Z between them are the point: the **mounting**
 * angle and the **swing** are separate, which is what lets four baked curves
 * serve doors hung at any angle in the level. `side` mirrors the swing, so one
 * curve opens a pair of doors outward.
 *
 * That composite is applied here as `qY(base) · qZ(rz) · qY(swing) · qX(rx)` —
 * written as four axis-angle quaternions in that order rather than as an Euler,
 * for the same reason as the character bones: the multiplication is obvious and
 * the equivalence is not.
 *
 * ## The curves
 *
 * Baked keyframes, not a spring, and the bundle carries them per frame in BAMS
 * so nothing has to be approximated. Curve 2 is the van: 179 degrees by frame
 * 12, settling back to 137 — a door thrown hard enough to rebound.
 *
 * `FUN_00473CF0` also swings a prop when it is *shot*, one damped sine over 16
 * frames. There is no shooting here, so that is not run.
 */

import { Object3D, Quaternion, Vector3 } from "three";
import type { PropsJson, PropHinge, PropStatic } from "../bundle";

const BAMS_TO_RAD = (Math.PI * 2) / 65536;
const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);

interface Live {
  node: Object3D;
  hinge: PropHinge | null;
  stat: PropStatic | null;
  /** BAMS `[rx, ry, rz]` per frame; empty for a static prop. */
  curve: number[][];
  /** `obj+0x2A8` — advances only while the open flag is set. */
  frame: number;
}

export class PropLayer {
  private live: Live[] = [];
  private json: PropsJson | null = null;
  private enabled = true;
  private readonly q = new Quaternion();
  private readonly qa = new Quaternion();

  attach(root: Object3D, json: PropsJson | undefined): void {
    this.detach();
    this.json = json ?? null;
    if (!json) return;

    const byName = new Map<string, Live>();
    for (const h of json.hinges) {
      byName.set(h.name, { node: root, hinge: h, stat: null,
                           curve: json.curves[String(h.curve)] ?? [],
                           frame: 0 });
    }
    for (const s of json.statics) {
      byName.set(s.name, { node: root, hinge: null, stat: s, curve: [],
                           frame: 0 });
    }

    root.traverse((o) => {
      const x = o.userData as { hod2_kind?: string; hod2_rig?: string };
      if (x?.hod2_kind !== "rig") return;
      const entry = x.hod2_rig ? byName.get(x.hod2_rig) : undefined;
      if (!entry || entry.node !== root) return;    // first instance only
      entry.node = o;
      this.live.push(entry);
    });
  }

  detach(): void {
    this.live = [];
    this.json = null;
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    for (const l of this.live) l.node.visible = v;
  }

  /**
   * `flags` is the walker's script-flag set, written by `set_script_flag`
   * (0x48). `frames` is elapsed 60 Hz frames the walker advanced — the swing
   * counter is game frames, so a paused player holds a half-open door open.
   */
  update(flags: ReadonlySet<number>, frames: number): void {
    if (!this.live.length) return;
    for (const l of this.live) {
      const p = l.hinge ?? l.stat!;
      // Both kinds vanish on their remove flag; a static one has no other
      // state, so this is all it does.
      const gone = p.remove_flag >= 0 && flags.has(p.remove_flag);
      l.node.visible = this.enabled && !gone;
      if (!l.hinge || gone || !l.curve.length) continue;

      if (flags.has(l.hinge.open_flag)) {
        l.frame = Math.min(l.curve.length - 1, l.frame + frames);
      }
      const k = l.curve[Math.floor(l.frame)];
      if (!k) continue;
      const side = l.hinge.side;
      const rx = side * k[0];
      const ry = side < 1 ? -k[1] : k[1];
      const rz = k[2];

      // RotY(base); RotZ(rz); RotY(swing); RotX(rx) -- the engine's order.
      this.q.setFromAxisAngle(AXIS_Y, l.hinge.base_yaw * BAMS_TO_RAD);
      this.qa.setFromAxisAngle(AXIS_Z, rz * BAMS_TO_RAD);
      this.q.multiply(this.qa);
      this.qa.setFromAxisAngle(AXIS_Y, ry * BAMS_TO_RAD);
      this.q.multiply(this.qa);
      this.qa.setFromAxisAngle(AXIS_X, rx * BAMS_TO_RAD);
      this.q.multiply(this.qa);
      l.node.quaternion.copy(this.q);
    }
  }

  /** Reset the swing counters, for a seek or a stage change. */
  reset(): void {
    for (const l of this.live) l.frame = 0;
  }

  get describe(): string {
    if (!this.json) return "—";
    const n = this.live.length;
    if (!n) return `0 / ${this.json.hinges.length + this.json.statics.length}`;
    const open = this.live.filter((l) => l.hinge && l.frame > 0).length;
    const shown = this.live.filter((l) => l.node.visible).length;
    return `${shown} up, ${open} swinging`;
  }
}
