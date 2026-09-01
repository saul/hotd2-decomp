/**
 * Debug boxes: what the port is not simulating, and what it has committed to.
 *
 * Three overlays, all of them derived from game state every frame and none of
 * them owning anything:
 *
 * * **Unported classes.** An empty box wherever the script has spawned an
 *   actor whose class has no module in `g_class_handlers`. The box is the
 *   honest picture: something is there, the game would be running a state
 *   machine for it, and this player is not. 1046 of the 1383 placements
 *   `spawns.md` counts are in that state.
 * * **The permit holder.** `g_attack_permits` names one actor per player, and
 *   that actor is the one about to swing *and* the one the camera is aiming
 *   at. Seeing which one it is turns "why is the camera looking over there"
 *   into a one-glance answer.
 * * **The enemies the script is waiting for.** `wait_enemies_alive` blocks
 *   until the count falls; these are the actors keeping it blocked.
 * * **The approach rings**, on the ground at the camera. `TestApproachRing`
 *   turns the distance to these into the band that decides everything —
 *   whether an actor may close, whether it may attack, whether it is too
 *   close and must retreat. Drawing them turns "why is it doing that" into
 *   one glance, and an empty ring table into three missing circles rather
 *   than an afternoon.
 */
import {
  Box3, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture,
  EdgesGeometry, Group, LineBasicMaterial, LineLoop, LineSegments,
  Sprite, SpriteMaterial, Vector3,
} from "three";
import type { ActiveSpawn } from "../script/walker";
import type { System } from "../core/system";
import type { RenderContext } from "./context";
import type { Actor } from "../game/actor";
import { ZombieState } from "../game/class30/states";
import { ThrowerState } from "../game/class31/states";
import { G } from "../game/globals";
import { dist2d } from "../game/vec";
import { g_class_handlers } from "../game/registry";
import { SpawnClass } from "../game/spawn_class";
import { labelTexture } from "./overlays";

/**
 * Magenta: the port is not simulating this one.
 *
 * Deliberately a colour nothing else in the scene uses. The level's own
 * palette is browns, greys and sodium orange, the rails are cyan, amber and
 * green, and a grey box read as scenery — which is exactly the wrong
 * impression for a marker whose whole job is "this is missing".
 */
const UNPORTED = 0xff3df0;
/** Amber: holds an attack permit — about to swing, and on camera. */
const PERMIT = 0xffb02e;
/** Green: alive, and the script is blocked until it is not. */
const AWAITED = 0x4dff8c;
/** Cyan: picked out by a sidebar panel, whatever it is doing. */
const SELECTED = 0x26d9ff;
/** The three rings: inner is strike range, then mid, then outer. */
const RING_COLOURS = [0xff6b6b, 0xffd166, 0x6bcBff];

/**
 * Label textures, cached by colour and text. A permit moving between actors
 * flips a label twice a second, and a fresh `CanvasTexture` per flip is a leak.
 */
const LABELS = new Map<string, CanvasTexture>();

/** Segments in a drawn ring, and how far under the eye it sits. */
const RING_SEGMENTS = 64;
const RING_DROP = 14;

/** The descriptor offset, as it is written everywhere else in this project. */
const hex = (at: number): string => `0x${at.toString(16).toUpperCase()}`;

/** The state name, for the classes whose state table has been read. */
function stateOf(a: Actor): string {
  if (a.cls === SpawnClass.Zombie) {
    return `${ZombieState[a.state] ?? a.state}/${a.sub}`;
  }
  if (a.cls === SpawnClass.Thrower) {
    return `${ThrowerState[a.state] ?? a.state}/${a.sub}`;
  }
  return `state ${a.state}`;
}

/** A stand-in body for a spawn with nothing assembled: 1.6 wide, 3.6 tall. */
const STAND_IN = new Vector3(1.6, 3.6, 1.6);

/** What the character layer answers for a box that fits a real actor. */
export interface BoundsSource {
  boundsOf(at: number, out: Box3): boolean;
}

interface Boxed {
  node: Group;
  lines: LineSegments;
  label: Sprite;
  colour: number;
}

/**
 * Whatever is deciding which actors to box.
 *
 * Structural rather than an import: the thing that answers this lives in
 * `hud/`, and `render` may not depend on `ui`. The sidebar hands its choice
 * over by *being* one of these.
 */
export interface HighlightSource {
  readonly highlight: ReadonlySet<number>;
}

const EMPTY: ReadonlySet<number> = new Set<number>();

export class DebugBoxLayer implements System<RenderContext> {
  readonly id = "render.debug_boxes";
  readonly group = new Group();
  /** Empty boxes for spawned classes with no module. */
  showUnported = false;
  /** The permit holder, and whoever the script is waiting on. */
  showBoxes = false;
  /**
   * Actors the sidebar's debug panels have asked for by `at`.
   *
   * Independent of `showBoxes`: the panels box exactly what they list, so
   * ticking "box" next to a row is the same question as reading the row.
   */
  panels: HighlightSource | null = null;
  source: BoundsSource | null = null;

  /**
   * What the sidebar asked to be boxed, as of its **last** tick.
   *
   * `render` runs before `hud`, so ticking a box next to a row shows up on the
   * following frame. Sixteen milliseconds on a debug overlay, and the
   * alternative is `render` reaching into `ui`.
   */
  private get highlight(): ReadonlySet<number> {
    return this.panels?.highlight ?? EMPTY;
  }

  private readonly pool: Boxed[] = [];
  private readonly rings: LineLoop[] = [];
  private readonly unit = new EdgesGeometry(new BoxGeometry(1, 1, 1));
  private readonly _box = new Box3();
  private readonly _size = new Vector3();
  private readonly _mid = new Vector3();
  private readonly _eye = new Vector3();
  private used = 0;

  constructor() {
    this.group.name = "debug-boxes";
  }

  /**
   * `g_enemy_approach_rings` and its two siblings, drawn flat at the camera.
   *
   * Ring set 0 is what almost everything uses; character type 0 uses set 2.
   * Only the set the live actors actually measure against is drawn, so the
   * circles mean something rather than being a diagram.
   */
  private updateRings(eye: Vector3): void {
    const live = G.g_object_list.filter((o) => o.visible && !o.dead);
    const set = live.find((o) => o.cls === SpawnClass.Zombie)?.ringSet ?? 0;
    const radii = [
      G.g_enemy_approach_rings[set] ?? G.g_enemy_approach_rings[0] ?? 0,
      G.g_enemy_approach_ring_mid[set] ?? G.g_enemy_approach_ring_mid[0] ?? 0,
      G.g_enemy_approach_ring_outer[set] ?? G.g_enemy_approach_ring_outer[0] ?? 0,
    ];
    radii.forEach((r, i) => {
      let loop = this.rings[i];
      if (!loop) {
        const pts: number[] = [];
        for (let a = 0; a < RING_SEGMENTS; a++) {
          const t = (a / RING_SEGMENTS) * Math.PI * 2;
          pts.push(Math.cos(t), 0, Math.sin(t));
        }
        const g = new BufferGeometry();
        g.setAttribute("position",
                       new BufferAttribute(new Float32Array(pts), 3));
        loop = new LineLoop(g, new LineBasicMaterial({
          color: RING_COLOURS[i], transparent: true, opacity: 0.55,
          depthTest: false,
        }));
        this.group.add(loop);
        this.rings[i] = loop;
      }
      // A zero radius is the tell that the ring table never loaded.
      loop.visible = r > 0;
      loop.scale.set(r, 1, r);
      loop.position.set(eye.x, eye.y - RING_DROP, eye.z);
    });
  }

  private acquire(colour: number): Boxed {
    let b = this.pool[this.used];
    if (!b) {
      const node = new Group();
      const lines = new LineSegments(
        this.unit,
        new LineBasicMaterial({ transparent: true, opacity: 0.9,
                                depthTest: false }));
      const label = new Sprite(new SpriteMaterial({ depthTest: false }));
      node.add(lines, label);
      this.group.add(node);
      this.pool[this.used] = (b = { node, lines, label, colour: -1 });
    }
    this.used++;
    b.node.visible = true;
    if (b.colour !== colour) {
      (b.lines.material as LineBasicMaterial).color.setHex(colour);
      b.colour = colour;
    }
    return b;
  }

  private place(b: Boxed, centre: Vector3, size: Vector3, text: string): void {
    // The label takes the box's colour, so magenta text is the signal that
    // this actor has no module -- readable without finding its box first.
    const key = `${b.colour.toString(16)}|${text}`;
    b.node.position.copy(centre);
    b.lines.scale.copy(size);
    b.label.position.set(0, size.y / 2 + 0.6, 0);
    if (b.label.userData.text !== key) {
      let tex = LABELS.get(key);
      if (!tex) {
        LABELS.set(key, (tex = labelTexture(
          text, `#${b.colour.toString(16).padStart(6, "0")}`)));
      }
      (b.label.material as SpriteMaterial).map = tex;
      (b.label.material as SpriteMaterial).needsUpdate = true;
      const img = tex.image as HTMLCanvasElement;
      b.label.scale.set(img.width / 22, 44 / 22, 1);
      b.label.userData.text = key;
    }
  }

  /** A box that fits the assembled actor, or the stand-in if there is none. */
  private fit(at: number, fallback: Vector3): boolean {
    if (this.source?.boundsOf(at, this._box) && !this._box.isEmpty()) {
      this._box.getSize(this._size);
      this._box.getCenter(this._mid);
      return true;
    }
    this._size.copy(STAND_IN);
    this._mid.copy(fallback).setY(fallback.y + STAND_IN.y / 2);
    return false;
  }


  /**
   * A name you can say out loud: `block/step/n`, plus the descriptor offset.
   *
   * `at` is the evt file offset of the spawn descriptor, and it is the
   * identity every layer of this project keys on — the walker, the exporter,
   * the annotations and `G.g_object_list` all agree on it, so quoting it names
   * an actor unambiguously all the way back to the binary. The block/step
   * prefix is the readable half: it is where in the script the spawn happened,
   * which is how the timeline is addressed everywhere else.
   */
  private labels(spawns: readonly ActiveSpawn[]): Map<number, string> {
    const out = new Map<number, string>();
    const seen = new Map<string, number>();
    for (const s of spawns) {
      const step = `${s.block}/${s.step}`;
      const n = seen.get(step) ?? 0;
      seen.set(step, n + 1);
      out.set(s.at, `${step}/${n}`);
    }
    return out;
  }

  /**
   * `spawns` is the walker's live list — the same one the markers use, so the
   * two can never disagree about who is present. `waiting` is true while the
   * interpreter is parked on an enemy-count wait.
   */
  update(ctx: RenderContext): void {
    const w = ctx.walker;
    const spawns = w?.spawns ?? [];
    const waiting = w?.wait?.policy.kind === "enemies";
    this._eye.copy(ctx.camera.position);
    this.used = 0;
    this.group.visible = this.showUnported || this.showBoxes
                      || this.highlight.size > 0;
    if (!this.group.visible) {
      for (const b of this.pool) b.node.visible = false;
      for (const r of this.rings) r.visible = false;
      return;
    }
    if (this.showBoxes) this.updateRings(this._eye);
    else for (const r of this.rings) r.visible = false;

    const id = this.labels(spawns);

    if (this.showUnported) {
      for (const s of spawns) {
        if (g_class_handlers[s.class as SpawnClass] !== undefined) continue;
        const name = SpawnClass[s.class] ?? "unread class";
        this.fit(s.at, new Vector3(s.pos[0], s.pos[1], s.pos[2]));
        this.place(this.acquire(UNPORTED), this._mid, this._size,
                   `${id.get(s.at) ?? "?"} ${hex(s.at)} `
                   + `0x${s.class.toString(16).toUpperCase()} ${name}`);
      }
    }

    if (this.showBoxes) {
      const permits = new Set(G.g_attack_permits.filter((p) => p !== -1));
      for (const a of G.g_object_list) {
        if (!a.visible || a.dead) continue;
        const holder = permits.has(a.at);
        // Everything alive is what the wait is counting; the permit holder is
        // called out whether or not anything is waiting on it.
        if (!holder && !waiting) continue;
        this.fit(a.at, new Vector3(a.pos.x, a.pos.y, a.pos.z));
        // The distance and the band are what every decision turns on, so
        // they go on the label next to the state.
        const d = dist2d(a.pos, { x: this._eye.x, y: this._eye.y,
                                  z: this._eye.z });
        const who = `${id.get(a.at) ?? "?"} ${hex(a.at)} ${a.name}`
          + ` d=${d.toFixed(0)} r${a.rank}/${a.allowance} q${a.queueRank}`;
        this.place(this.acquire(holder ? PERMIT : AWAITED),
                   this._mid, this._size,
                   holder ? `${who} · permit · ${stateOf(a)}`
                          : `${who} · ${stateOf(a)}`);
      }
    }

    // The panels' own selection, drawn whether or not `Boxes` is on and
    // whether or not anything is waiting -- it is the panel's list, made
    // visible.
    if (this.highlight.size) {
      const permits = new Set(G.g_attack_permits.filter((p) => p !== -1));
      for (const a of G.g_object_list) {
        if (!this.highlight.has(a.at) || a.despawned) continue;
        // Already drawn by the block above; a second box would z-fight it.
        if (this.showBoxes && (waiting || permits.has(a.at))) continue;
        this.fit(a.at, new Vector3(a.pos.x, a.pos.y, a.pos.z));
        const d = dist2d(a.pos, { x: this._eye.x, y: this._eye.y,
                                  z: this._eye.z });
        this.place(this.acquire(permits.has(a.at) ? PERMIT : SELECTED),
                   this._mid, this._size,
                   `${id.get(a.at) ?? "?"} ${hex(a.at)} ${a.name}`
                   + ` d=${d.toFixed(0)} · ${stateOf(a)}`);
      }
    }

    for (let i = this.used; i < this.pool.length; i++) {
      this.pool[i].node.visible = false;
    }
  }

  /** The nodes belong to the scene, which is rebuilt on a stage change. */
  /**
   * A stage has loaded. The pool and the range rings are grown on demand and
   * hang off this layer's own group, so the stage scope empties them.
   */
  attach(ctx: RenderContext): void {
    ctx.scope.child("debug_boxes").defer(() => {
      for (const b of this.pool) b.node.removeFromParent();
      for (const r of this.rings) r.removeFromParent();
      this.pool.length = 0;
      this.rings.length = 0;
      this.used = 0;
    });
  }

  /** The boxes are a pure function of the restored actor list. */
  resync(ctx: RenderContext): void {
    this.update(ctx);
  }
}
