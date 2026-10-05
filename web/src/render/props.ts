/**
 * Scripted scenery drawn from the spawn's own pose: class 0x33 selector 2
 * (`FUN_00433A10`), a model shown until a script flag or a camera frame
 * removes it -- the van body stage 2's rear doors hang off is one.
 *
 * The exporter has placed the geometry -- a prop is one model at a pose, so it
 * goes through the rig writer with a fixed placement, and the glTF arrives with
 * each prop already standing where it belongs. What is left is whether it is
 * still there.
 *
 * **The doors, shutters and van doors are not here.** Class 0x44's hinges
 * (selectors 1, 2 and 4) are game objects: `game/class44/hinge.ts` runs
 * `HingeUpdate` (`FUN_00473CF0`) and records its draw, and
 * `render/breakables.ts` shows it. This layer used to pose them itself from a
 * copy of the curve, which is the two-copies shape `L16` is about.
 */

import {
  Box3, BoxGeometry, BufferAttribute, BufferGeometry, EdgesGeometry, Group,
  LineBasicMaterial, LineSegments, Object3D, Sprite, SpriteMaterial, Vector3,
} from "three";
import type { PropsJson, PropStatic } from "../bundle";
import { IDLE_TICK, type Context, type System, type Tick }
  from "../core/system";
import type { Scope } from "../core/scope";
import { attachTo } from "./scope3d";
import { LabelCache } from "./overlays";
import { G } from "../game/globals";

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

interface Live {
  node: Object3D;
  stat: PropStatic;
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
  /** The `Prop boxes` switch. Off by default — see `setDebugVisible`. */
  private debugEnabled = false;
  private live: Live[] = [];
  private json: PropsJson | null = null;
  private enabled = true;
  private markers: Marker[] = [];
  /** Everything this layer built for the current stage. */
  private scope: Scope | null = null;
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
    const labels = this.labels = new LabelCache();
    this.scope.defer(() => {
      for (const m of this.markers) {
        m.box.geometry.dispose();
        m.cross.geometry.dispose();
      }
      // ...and the label textures, which nothing disposed at all: a stage
      // switch built a fresh set beside the old one and the page kept both.
      labels.dispose();
      this.markers = [];
      this.debug.clear();
      this.live = [];
      this.json = null;
      this.scope = null;
    });
    this.json = json ?? null;
    if (!json) return;

    const byName = new Map<string, Live>();
    for (const s of json.statics) {
      byName.set(s.name, { node: root, stat: s, bound: false });
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
    this.debug.visible = v && this.debugEnabled;
    for (const l of this.live) if (l.bound) l.node.visible = v;
  }

  /**
   * The overlay, on its own switch.
   *
   * It used to ride on `Props`, which meant the only way to see the props
   * without a box, a cross and a label on each of them was to stop drawing
   * them. A debug overlay is never what somebody wants to look at the scene
   * through, so it defaults off and `Props` keeps only the props.
   */
  setDebugVisible(v: boolean): void {
    this.debugEnabled = v;
    this.debug.visible = v && this.enabled;
  }

  /**
   * The flags are `G.g_script_flags` — 0x009C7200 — which is what
   * `set_script_flag` (0x48) writes and what the class-0x33 routine reads. A
   * prop is shown until its remove flag is up.
   */
  update(ctx: Context, _t: Tick): void {
    const w = ctx.walker;
    if (!w) return;
    const raised = (i: number) => (G.g_script_flags[i] ?? 0) !== 0;
    if (!this.live.length) return;
    for (const l of this.live) {
      if (!l.bound) continue;
      const gone = l.stat.remove_flag >= 0 && raised(l.stat.remove_flag);
      l.node.visible = this.enabled && !gone;
    }
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
    this.debug.visible = this.enabled && this.debugEnabled;
    if (!this.enabled || !this.debugEnabled) {
      for (const m of this.markers) m.node.visible = false;
      return;
    }
    this.live.forEach((l, i) => {
      const m = this.marker(i);
      const p = l.stat;

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

  /**
   * The label textures, capped and owned by the stage scope.
   *
   * Module-level and never disposed until now: a stage switch built a fresh
   * set beside the old one and the page kept both. `SpawnLayer` fixed this
   * shape first; this layer and `debug.ts` did not follow it.
   */
  private labels = new LabelCache();

  private setLabel(m: Marker, text: string): void {
    const key = `${m.colour.toString(16)}|${text}`;
    if (m.label.userData.text === key) return;
    const tex = this.labels.get(
      key, text, `#${m.colour.toString(16).padStart(6, "0")}`);
    (m.label.material as SpriteMaterial).map = tex;
    (m.label.material as SpriteMaterial).needsUpdate = true;
    const img = tex.image as HTMLCanvasElement;
    m.label.scale.set(img.width / 22, 44 / 22, 1);
    m.label.userData.text = key;
  }

  /** A load restored the flag set; the visibility follows it. */
  resync(ctx: Context): void {
    this.update(ctx, IDLE_TICK);
  }

  get describe(): string {
    if (!this.json) return "—";
    const n = this.live.length;
    if (!n) return `0 / ${this.json.statics.length}`;
    const now = this.live.map((l) => this.stateOf(l));
    const by = (st: PropDebugState) => now.filter((x) => x === st).length;
    // Anything that is not simply drawn is worth naming in the status line --
    // "38 up" reads like success when six are quietly missing.
    const bad = [
      [by(PropDebugState.Hidden), "hidden"],
      [by(PropDebugState.Empty), "no geometry"],
      [by(PropDebugState.Missing), "no node"],
    ] as const;
    const tail = bad.filter(([c]) => c > 0)
                    .map(([c, name]) => `${c} ${name}`).join(", ");
    return `${by(PropDebugState.Shown)}/${n} up` + (tail ? ` — ${tail}` : "");
  }
}
