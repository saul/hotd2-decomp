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

import {
  Box3, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture,
  EdgesGeometry, Group, LineBasicMaterial, LineSegments, Object3D, Quaternion,
  Sprite, SpriteMaterial, Vector3,
} from "three";
import type { PropsJson, PropHinge, PropStatic } from "../bundle";
import { IDLE_TICK, type Context, type System, type Tick }
  from "../core/system";
import type { Scope } from "../core/scope";
import { attachTo } from "./scope3d";
import { labelTexture } from "./overlays";
import { BAMS_TO_RAD } from "../core/bams";

const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);

/**
 * Why a prop is or is not on screen — the whole point of the overlay.
 *
 * A prop that is simply absent looks identical to one that was never in the
 * bundle, to one whose model came out empty, and to one another layer has
 * hidden. Naming the four states is what makes "a lot of the props aren't
 * rendering" a question with an answer.
 */
export enum PropDebugState {
  /** Bound to a node with geometry, and on screen. */
  Shown = 0,
  /** Bound and drawable, but something has it hidden this frame. */
  Hidden = 1,
  /** Bound to a node whose subtree has no drawable geometry. */
  Empty = 2,
  /** In `props.json`, but no glTF node carries its name. */
  Missing = 3,
}

/** Green: drawn. Amber: hidden. Magenta: nothing to draw. Red: no node. */
const STATE_COLOUR: Record<PropDebugState, number> = {
  [PropDebugState.Shown]: 0x4dff8c,
  [PropDebugState.Hidden]: 0xffb02e,
  [PropDebugState.Empty]: 0xff3df0,
  [PropDebugState.Missing]: 0xff4d4d,
};

const STATE_NAME: Record<PropDebugState, string> = {
  [PropDebugState.Shown]: "shown",
  [PropDebugState.Hidden]: "hidden",
  [PropDebugState.Empty]: "no geometry",
  [PropDebugState.Missing]: "no node",
};

/**
 * Whether an object really draws — its own flag **and** every parent's.
 *
 * `node.visible` alone is not the question: three.js visibility is
 * hierarchical, so a prop can be flagged visible inside a region group that
 * the streaming has switched off, and read as "up" while nothing of it reaches
 * the screen. That is precisely the case this overlay exists to catch, so the
 * walk to the root is the measurement, not a detail.
 */
function onScreen(o: Object3D): boolean {
  for (let n: Object3D | null = o; n; n = n.parent) if (!n.visible) return false;
  return true;
}

/** Half-length of the origin cross, in world units. */
const ORIGIN_ARM = 2.5;
/** The box drawn for a prop that has no measurable bounds. */
const STAND_IN = 3;
/** Label textures, cached by colour and text — one per flip is a leak. */
const LABELS = new Map<string, CanvasTexture>();

interface Live {
  node: Object3D;
  hinge: PropHinge | null;
  stat: PropStatic | null;
  /** BAMS `[rx, ry, rz]` per frame; empty for a static prop. */
  curve: number[][];
  /** `obj+0x2A8` — advances only while the open flag is set. */
  frame: number;
  /** False until a glTF node claims this prop's name. */
  bound: boolean;
}

/** One prop's marker: a bounding box, an origin cross and a label. */
interface Marker {
  node: Group;
  box: LineSegments;
  cross: LineSegments;
  label: Sprite;
  colour: number;
}

export class PropLayer implements System {
  readonly id = "render.props";
  /** Bounding boxes and origin crosses, one per prop the bundle names. */
  readonly debug = new Group();
  private live: Live[] = [];
  private json: PropsJson | null = null;
  private enabled = true;
  private markers: Marker[] = [];
  /** Everything this layer built for the current stage. */
  private scope: Scope | null = null;
  private readonly q = new Quaternion();
  private readonly qa = new Quaternion();
  private readonly unitBox = new EdgesGeometry(new BoxGeometry(1, 1, 1));
  private readonly _box = new Box3();
  private readonly _size = new Vector3();
  private readonly _mid = new Vector3();

  constructor() {
    this.debug.name = "prop-debug";
  }

  /** No `detach`: the stage scope owns the marker geometry and the debug group. */
  build(root: Object3D, stage: Scope, json: PropsJson | undefined): void {
    this.scope = stage.child("props");
    this.scope.defer(() => {
      for (const m of this.markers) {
        m.box.geometry.dispose();
        m.cross.geometry.dispose();
      }
      this.markers = [];
      this.debug.clear();
      this.live = [];
      this.json = null;
      this.scope = null;
    });
    this.json = json ?? null;
    if (!json) return;

    const byName = new Map<string, Live>();
    for (const h of json.hinges) {
      byName.set(h.name, { node: root, hinge: h, stat: null,
                           curve: json.curves[String(h.curve)] ?? [],
                           frame: 0, bound: false });
    }
    for (const s of json.statics) {
      byName.set(s.name, { node: root, hinge: null, stat: s, curve: [],
                           frame: 0, bound: false });
    }

    root.traverse((o) => {
      const x = o.userData as { hod2_kind?: string; hod2_rig?: string };
      if (x?.hod2_kind !== "rig") return;
      const entry = x.hod2_rig ? byName.get(x.hod2_rig) : undefined;
      if (!entry || entry.bound) return;            // first instance only
      entry.node = o;
      entry.bound = true;
    });

    // **Every** prop the bundle names, bound or not. Dropping the unbound ones
    // is what made a missing prop indistinguishable from a prop that was never
    // exported -- the overlay's whole job is to tell those apart, so they stay
    // in the list and are drawn as `Missing`.
    this.live = [...byName.values()];
    attachTo(this.scope, root, this.debug);
  }


  /**
   * The Props checkbox drives the geometry **and** the overlay together, which
   * is what was asked for: tick Props and you see every prop the bundle knows
   * about, whether or not it is drawing.
   */
  setEnabled(v: boolean): void {
    this.enabled = v;
    this.debug.visible = v;
    for (const l of this.live) if (l.bound) l.node.visible = v;
  }

  /**
   * `flags` is the walker's script-flag set, written by `set_script_flag`
   * (0x48). `frames` is elapsed 60 Hz frames the walker advanced — the swing
   * counter is game frames, so a paused player holds a half-open door open.
   */
  update(ctx: Context, t: Tick): void {
    const w = ctx.walker;
    if (!w) return;
    const flags = w.flags;
    const frames = t.dt * 60;
    if (!this.live.length) return;
    for (const l of this.live) {
      if (!l.bound) continue;              // nothing to pose
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
    // After the poses, so a box fits where the prop actually ended up.
    this.updateDebug();
  }

  /**
   * Which of the four states a prop is in, measured now.
   *
   * Computed rather than cached: a stored answer is whatever was true when the
   * stage loaded — which is *before* the first frame, when nothing has been
   * measured and every prop still looks missing. That read exactly once as
   * "44 no node" for a set of props that were all bound and fine.
   */
  private stateOf(l: Live): PropDebugState {
    if (!l.bound) return PropDebugState.Missing;
    this._box.setFromObject(l.node);
    if (this._box.isEmpty()) return PropDebugState.Empty;
    return onScreen(l.node) ? PropDebugState.Shown : PropDebugState.Hidden;
  }

  /**
   * One marker per prop: a box round whatever it draws, a cross at its origin
   * and a label saying which of the four states it is in.
   */
  private updateDebug(): void {
    this.debug.visible = this.enabled;
    if (!this.enabled) {
      for (const m of this.markers) m.node.visible = false;
      return;
    }
    this.live.forEach((l, i) => {
      const m = this.marker(i);
      const p = l.hinge ?? l.stat!;

      const state = this.stateOf(l);   // leaves the bounds in `this._box`

      // An unbound prop has no node and so no position: the bundle carries no
      // placement of its own, it lives in the glTF node's transform. Say so
      // with a marker at the origin rather than inventing somewhere to put it.
      if (state === PropDebugState.Missing || this._box.isEmpty()) {
        this._size.setScalar(STAND_IN);
        if (l.bound) l.node.getWorldPosition(this._mid);
        else this._mid.set(0, 0, 0);
      } else {
        this._box.getSize(this._size);
        this._box.getCenter(this._mid);
      }

      // The box is computed in world space; the group may sit under a
      // transformed root, so bring it back into the group's own frame.
      this.debug.worldToLocal(this._mid);
      m.node.position.copy(this._mid);
      m.box.scale.copy(this._size);
      m.label.position.set(0, this._size.y / 2 + 1.2, 0);

      const colour = STATE_COLOUR[state];
      if (m.colour !== colour) {
        (m.box.material as LineBasicMaterial).color.setHex(colour);
        (m.cross.material as LineBasicMaterial).color.setHex(colour);
        m.colour = colour;
      }
      this.setLabel(m, `${p.name} · ${STATE_NAME[state]}`);
      m.node.visible = true;
    });
    for (let i = this.live.length; i < this.markers.length; i++) {
      this.markers[i].node.visible = false;
    }
  }

  private marker(i: number): Marker {
    let m = this.markers[i];
    if (m) return m;
    const node = new Group();
    const box = new LineSegments(this.unitBox, new LineBasicMaterial({
      transparent: true, opacity: 0.85, depthTest: false }));
    // A three-armed cross through the prop's own origin, so a prop drawn at
    // the wrong place can be told from one drawn at the wrong scale.
    const pts = new Float32Array([
      -ORIGIN_ARM, 0, 0, ORIGIN_ARM, 0, 0,
      0, -ORIGIN_ARM, 0, 0, ORIGIN_ARM, 0,
      0, 0, -ORIGIN_ARM, 0, 0, ORIGIN_ARM,
    ]);
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(pts, 3));
    const cross = new LineSegments(g, new LineBasicMaterial({
      transparent: true, opacity: 1, depthTest: false }));
    const label = new Sprite(new SpriteMaterial({ depthTest: false }));
    node.add(box, cross, label);
    this.debug.add(node);
    this.markers[i] = (m = { node, box, cross, label, colour: -1 });
    return m;
  }

  private setLabel(m: Marker, text: string): void {
    const key = `${m.colour.toString(16)}|${text}`;
    if (m.label.userData.text === key) return;
    let tex = LABELS.get(key);
    if (!tex) {
      LABELS.set(key, (tex = labelTexture(
        text, `#${m.colour.toString(16).padStart(6, "0")}`)));
    }
    (m.label.material as SpriteMaterial).map = tex;
    (m.label.material as SpriteMaterial).needsUpdate = true;
    const img = tex.image as HTMLCanvasElement;
    m.label.scale.set(img.width / 22, 44 / 22, 1);
    m.label.userData.text = key;
  }

  /** Reset the swing counters, for a seek or a stage change. */
  reset(): void {
    for (const l of this.live) l.frame = 0;
  }

  /**
   * A load restored the flag set but not how long ago each flag was raised,
   * and the swing counter is elapsed frames. So the doors go back to shut and
   * swing again from there — which is exactly what a seek already does, and
   * the two disagreeing would be worse than either.
   *
   * `[diverges]` — the engine has no seek, so it never has to answer this.
   */
  resync(ctx: Context): void {
    this.reset();
    this.update(ctx, IDLE_TICK);
  }

  get describe(): string {
    if (!this.json) return "—";
    const n = this.live.length;
    if (!n) return `0 / ${this.json.hinges.length + this.json.statics.length}`;
    const now = this.live.map((l) => this.stateOf(l));
    const by = (st: PropDebugState) => now.filter((x) => x === st).length;
    const open = this.live.filter((l) => l.hinge && l.frame > 0).length;
    // Anything that is not simply drawn is worth naming in the status line --
    // "38 up" reads like success when six are quietly missing.
    const bad = [
      [by(PropDebugState.Hidden), "hidden"],
      [by(PropDebugState.Empty), "no geometry"],
      [by(PropDebugState.Missing), "no node"],
    ] as const;
    const tail = bad.filter(([c]) => c > 0)
                    .map(([c, name]) => `${c} ${name}`).join(", ");
    return `${by(PropDebugState.Shown)}/${n} up, ${open} swinging`
           + (tail ? ` — ${tail}` : "");
  }
}
