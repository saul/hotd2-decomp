/**
 * Which enemies are wedged in the level, drawn.
 *
 * `ZombiePushOutOfWorldAndActors` (`FUN_00454900`) runs every frame for every
 * class-0x30 actor: it traces the body sphere at `obj+0x12C` with radius
 * `obj+0x128` against the script's collision set and, on a hit, moves the
 * actor out along the normal by the whole penetration. One frame of that is
 * an actor brushing a wall and is entirely normal. **Hundreds in a row is an
 * actor that cannot get where its state is trying to take it**, and until now
 * the only symptom was an enemy that stood still or slid along something.
 *
 * So this draws the second question the collision overlay leaves open. `#show-coli`
 * says *what the engine can feel*; this says *who is stuck in it*, which is
 * the pair you want when an enemy is somewhere it should not be.
 *
 * Two deliberate choices:
 *
 * * **It waits before accusing.** An actor has to be pushed for
 *   {@link STUCK_FRAMES} consecutive frames before it is drawn, because the
 *   push firing once is the system working, not failing.
 * * **It only counts the *world* push.** The engine raises one flag bit for
 *   both halves of that routine, so "wedged in a wall" and "shouldering past
 *   another zombie" are indistinguishable from it — and the second is what a
 *   crowd does all the time. `Actor.worldPushDepth` is the port's own field
 *   for exactly this, and it is why the overlay does not simply read `flags2`.
 *
 * The counter itself lives here rather than on the actor: it is derived from
 * state the snapshot already carries, which is the rule every renderer follows
 * — `resync` rebuilds it from the actors within {@link STUCK_FRAMES} frames.
 */
import {
  BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments,
  Mesh, MeshBasicMaterial, SphereGeometry, type Object3D,
} from "three";
import { G } from "../game/globals";
import { SpawnClass } from "../game/spawn_class";
import type { System } from "../core/system";

/** How long the world push has to keep firing before an actor counts as stuck. */
const STUCK_FRAMES = 30;
/** Red, and deliberately not one of the collision overlay's two colours. */
const STUCK_COLOUR = 0xff3355;
/** How far the marker's pillar rises, so a wedged actor is findable from afar. */
const PILLAR = 40;

interface Marker { mesh: Mesh; pillar: LineSegments }

export class StuckDebugLayer implements System {
  readonly id = "render.stuck_debug";
  private root: Group | null = null;
  private enabled = false;
  /** Consecutive frames of world push, per spawn address. */
  private readonly runs = new Map<number, number>();
  private readonly markers = new Map<number, Marker>();
  private stuck = 0;
  private deepest = 0;

  build(parent: Object3D): void {
    this.detach();
    this.root = new Group();
    this.root.name = "stuck_debug";
    this.root.visible = this.enabled;
    parent.add(this.root);
  }

  detach(): void {
    for (const m of this.markers.values()) {
      m.mesh.geometry.dispose();
      (m.mesh.material as MeshBasicMaterial).dispose();
      m.pillar.geometry.dispose();
      (m.pillar.material as LineBasicMaterial).dispose();
    }
    this.markers.clear();
    this.runs.clear();
    this.root?.removeFromParent();
    this.root = null;
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (this.root) this.root.visible = v;
  }

  /**
   * Advance the counters and place the markers.
   *
   * The counters run whether or not the overlay is showing, so switching it on
   * does not restart every run from zero and hide what is already stuck.
   */
  update(): void {
    this.stuck = 0;
    this.deepest = 0;
    const live = new Set<number>();

    for (const o of G.g_object_list) {
      if (o.cls !== SpawnClass.Zombie || o.despawned || o.dead) continue;
      const run = o.worldPushDepth > 0 ? (this.runs.get(o.at) ?? 0) + 1 : 0;
      if (run === 0) this.runs.delete(o.at);
      else this.runs.set(o.at, run);
      if (run < STUCK_FRAMES) continue;

      this.stuck += 1;
      this.deepest = Math.max(this.deepest, o.worldPushDepth);
      live.add(o.at);
      if (!this.enabled || !this.root) continue;

      let m = this.markers.get(o.at);
      if (!m) {
        m = this.makeMarker(o.bodyRadius);
        this.root.add(m.mesh, m.pillar);
        this.markers.set(o.at, m);
      }
      // The sphere the push actually tests is the *body* sphere at
      // `obj+0x12C`, not the actor's feet -- drawing it at `pos` would put the
      // marker below whatever the actor is wedged in.
      m.mesh.position.set(o.camPoint.x, o.camPoint.y, o.camPoint.z);
      m.pillar.position.copy(m.mesh.position);
    }

    for (const [at, m] of this.markers) {
      if (live.has(at)) continue;
      m.mesh.removeFromParent();
      m.pillar.removeFromParent();
      m.mesh.geometry.dispose();
      (m.mesh.material as MeshBasicMaterial).dispose();
      m.pillar.geometry.dispose();
      (m.pillar.material as LineBasicMaterial).dispose();
      this.markers.delete(at);
    }
  }

  private makeMarker(radius: number): Marker {
    const mesh = new Mesh(
      new SphereGeometry(Math.max(0.5, radius), 12, 8),
      new MeshBasicMaterial({ color: STUCK_COLOUR, wireframe: true,
                              transparent: true, opacity: 0.9,
                              depthTest: false }));
    mesh.renderOrder = 999;
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(
      new Float32Array([0, 0, 0, 0, PILLAR, 0]), 3));
    const pillar = new LineSegments(
      g, new LineBasicMaterial({ color: STUCK_COLOUR, transparent: true,
                                 opacity: 0.6, depthTest: false }));
    pillar.renderOrder = 999;
    return { mesh, pillar };
  }

  get describe(): string {
    if (!this.stuck) return "none wedged";
    return `${this.stuck} wedged in the level`
         + ` · deepest ${this.deepest.toFixed(1)}u`;
  }
}
