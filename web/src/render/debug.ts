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
 */
import {
  Box3, BoxGeometry, CanvasTexture, EdgesGeometry, Group, LineBasicMaterial,
  LineSegments,
  Sprite, SpriteMaterial, Vector3,
} from "three";
import type { ActiveSpawn } from "../script/walker";
import { G } from "../game/globals";
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

/**
 * Label textures, cached by their text. A permit moving between actors flips a
 * label twice a second, and a fresh `CanvasTexture` per flip is a leak.
 */
const LABELS = new Map<string, CanvasTexture>();

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

export class DebugBoxLayer {
  readonly group = new Group();
  /** Empty boxes for spawned classes with no module. */
  showUnported = false;
  /** The permit holder, and whoever the script is waiting on. */
  showBoxes = false;
  source: BoundsSource | null = null;

  private readonly pool: Boxed[] = [];
  private readonly unit = new EdgesGeometry(new BoxGeometry(1, 1, 1));
  private readonly _box = new Box3();
  private readonly _size = new Vector3();
  private readonly _mid = new Vector3();
  private used = 0;

  constructor() {
    this.group.name = "debug-boxes";
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
    b.node.position.copy(centre);
    b.lines.scale.copy(size);
    b.label.position.set(0, size.y / 2 + 0.6, 0);
    if (b.label.userData.text !== text) {
      let tex = LABELS.get(text);
      if (!tex) LABELS.set(text, (tex = labelTexture(text)));
      (b.label.material as SpriteMaterial).map = tex;
      (b.label.material as SpriteMaterial).needsUpdate = true;
      const img = tex.image as HTMLCanvasElement;
      b.label.scale.set(img.width / 22, 44 / 22, 1);
      b.label.userData.text = text;
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
   * `spawns` is the walker's live list — the same one the markers use, so the
   * two can never disagree about who is present. `waiting` is true while the
   * interpreter is parked on an enemy-count wait.
   */
  update(spawns: readonly ActiveSpawn[], waiting: boolean): void {
    this.used = 0;
    this.group.visible = this.showUnported || this.showBoxes;
    if (!this.group.visible) {
      for (const b of this.pool) b.node.visible = false;
      return;
    }

    if (this.showUnported) {
      for (const s of spawns) {
        if (g_class_handlers[s.class as SpawnClass] !== undefined) continue;
        const name = SpawnClass[s.class] ?? "unread class";
        this.fit(s.at, new Vector3(s.pos[0], s.pos[1], s.pos[2]));
        this.place(this.acquire(UNPORTED), this._mid, this._size,
                   `0x${s.class.toString(16).toUpperCase()} ${name}`);
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
        this.place(this.acquire(holder ? PERMIT : AWAITED),
                   this._mid, this._size,
                   holder ? `permit · ${a.name}` : a.name);
      }
    }

    for (let i = this.used; i < this.pool.length; i++) {
      this.pool[i].node.visible = false;
    }
  }

  /** The nodes belong to the scene, which is rebuilt on a stage change. */
  detach(): void {
    for (const b of this.pool) b.node.removeFromParent();
    this.pool.length = 0;
    this.used = 0;
  }
}
