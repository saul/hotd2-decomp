/**
 * The game-over screen's world: the players' bodies on the fly-over, the
 * route map's figures, discs and footprints -- and nothing else.
 *
 * Phase 0 of `GameOverRunPhase` (`FUN_00460960`) releases the stage -- every
 * pol slot back to the resident common set, every cam file out -- and every
 * task list the screen builds afterwards draws only its own things. So from
 * then until the next stage load nothing of the level is on screen.
 * `G.g_stage_unloaded` says when.
 *
 * The port keeps the stage in memory, because the page's restart buttons
 * reload it, so "unloaded" here means **not drawn**: every node that is not
 * one of this layer's or an ancestor of one is hidden for as long as the flag
 * is up, and put back as it was when it drops.
 *
 * * **The bodies** (`game/player_body.ts`): world space, drawn on the frames
 *   `PlayerHookDrawBodyUntilMotionEnd` drew them.
 * * **The route map** (`game/route_map.ts`): view space. The figures, their
 *   ground discs (slot `0x145B`, turned a quarter about X and scaled 3) and the
 *   footprints (scaled 0.2) all sit about 100 in front of the eye, so they are
 *   drawn in a group that rides the camera. A figure is the same character
 *   type as a body -- `0x39` or `0x3A` -- and uses that body's hierarchy; on the
 *   route map a body is behind the camera anyway (it stands at the origin, the
 *   eye at z -7 looking down -Z), so lending it costs nothing that shows.
 *
 * The fog goes with the stage. `CameraBlocksReset` (`FUN_004021D0`) runs
 * `LightBlockInit` (`FUN_0041DBA0`) over both light blocks, which is fog at
 * (65535, 65536) -- none -- in colour 0. `[proved]` So no fog and a black
 * background, whatever the stage had.
 */
import { Color, Group, type Fog, type FogExp2, type Object3D, type Scene }
  from "three";
import type { System } from "../core/system";
import type { Scope } from "../core/scope";
import { BAMS_TO_RAD } from "../core/bams";
import { MotionFlag } from "../game/actor";
import { G } from "../game/globals";
import { PLAYER_BODY_AT, ROUTE_FIGURE_SHADOW_SLOT }
  from "../game/player_body_data";
import type { CharacterLayer } from "./characters";
import type { Instance } from "./characters/instance";
import { Poser } from "./characters/pose";
import type { RenderContext } from "./context";
import type { EffectLayer } from "./effects";

type Body = Pick<Instance, "type" | "root" | "pivot" | "bones">;

const BLACK = new Color(0);
/** The disc: `MatrixRotateX(0x4000)`, `MatrixScale(3, 3, 3)`. */
const DISC_PITCH = 0x4000;
const DISC_SCALE = 3;
/** A footprint: `MatrixScale(0.2, 0.2, 0.2)`. */
const MARK_SCALE = 0.2;

export class GameOverScene implements System<RenderContext> {
  readonly id = "render.game_over";
  private readonly poser = new Poser();
  /** Each body hierarchy, claimed from the character layer, and its type. */
  private bodies: (Body | null)[] = [];
  private homes: (Object3D | null)[] = [];
  /** The route map's group: camera space. */
  private readonly view = new Group();
  private discs: Object3D[] = [];
  private marks: Object3D[] = [];
  private markSlot = -1;
  /** Nodes this hid, and whether each was visible before. */
  private readonly hid = new Map<Object3D, boolean>();
  private fog: Fog | FogExp2 | null = null;
  private background: Scene["background"] = null;
  private active = false;
  private effects: EffectLayer | null = null;

  constructor(private readonly scene: Scene) {
    this.view.name = "game_over_view";
    this.view.matrixAutoUpdate = false;
    scene.add(this.view);
  }

  /**
   * After the character layer has adopted the stage's hierarchies: take the
   * two bodies out of it, hidden until something draws them.
   */
  build(scope: Scope, chars: CharacterLayer, effects: EffectLayer): void {
    this.effects = effects;
    this.bodies = PLAYER_BODY_AT.map((at) => chars.claim(at));
    this.homes = this.bodies.map((b) => b?.root.parent ?? null);
    for (const b of this.bodies) if (b) b.root.visible = false;
    scope.child("game-over").defer(() => {
      this.leave();
      this.clearView();
      this.bodies = [];
      this.homes = [];
      this.effects = null;
    });
  }

  update(ctx: RenderContext): void {
    if (G.g_stage_unloaded === 0) {
      this.leave();
      return;
    }
    this.enter();
    this.view.matrix.copy(ctx.camera.matrixWorld);
    this.view.matrixWorldNeedsUpdate = true;

    // The route map's figures, each on its type's hierarchy.
    const lent = new Set<number>();
    const figures = G.g_route_figures;
    for (let i = 0; i < figures.length; i++) {
      const fig = figures[i];
      const k = this.bodies.findIndex((b) => b?.type.type === fig.charType);
      const node = k >= 0 ? this.bodies[k] : null;
      if (!node) continue;
      lent.add(k);
      if (node.root.parent !== this.view) this.view.add(node.root);
      const w = fig.fadeFrom && fig.fadeLen > 0
        ? 1 - fig.fade / fig.fadeLen : 1;
      const shown = this.poser.poseLooped(node, fig.motion, fig.playTicks,
                                          true, fig.fadeFrom, w);
      node.root.visible = shown;
      node.root.position.set(fig.view.x, fig.view.y, fig.view.z);
      node.root.rotation.set(fig.pitch * BAMS_TO_RAD, fig.yaw * BAMS_TO_RAD,
                             0, "XYZ");
      const disc = this.disc(i);
      if (disc) {
        disc.visible = true;
        disc.position.set(fig.disc.x, fig.disc.y, fig.disc.z);
        disc.rotation.set(DISC_PITCH * BAMS_TO_RAD, 0, 0);
        disc.scale.setScalar(DISC_SCALE);
      }
    }
    for (let i = figures.length; i < this.discs.length; i++) {
      this.discs[i].visible = false;
    }

    // The bodies, where no figure has borrowed them.
    for (let p = 0; p < this.bodies.length; p++) {
      if (lent.has(p)) continue;
      const node = this.bodies[p];
      if (!node) continue;
      const home = this.homes[p];
      if (home && node.root.parent !== home) home.add(node.root);
      const b = G.g_player_bodies[p];
      const show = !!b && b.drawn !== 0
        && this.poser.poseHeld(node, b.motion, b.playTicks,
                               (b.motionFlags & MotionFlag.RootMotion) !== 0);
      node.root.visible = show;
      if (!show || !b) continue;
      node.root.position.set(b.pos.x, b.pos.y, b.pos.z);
      node.root.rotation.set(0, b.yaw * BAMS_TO_RAD, 0);
    }

    this.drawMarks();
  }

  /** The footprints, one clone each, re-made if the slot changes. */
  private drawMarks(): void {
    const slot = G.g_route_map.markSlot;
    if (slot !== this.markSlot) {
      for (const m of this.marks) m.removeFromParent();
      this.marks = [];
      this.markSlot = slot;
    }
    const marks = G.g_route_marks;
    let n = 0;
    for (const mk of marks) {
      if (mk.drawn === 0) continue;
      const pt = mk.view;
      let node = this.marks[n];
      if (!node) {
        const c = this.effects?.cloneSlot(slot) ?? null;
        if (!c) break;
        this.view.add(c);
        this.marks.push(c);
        node = c;
      }
      node.visible = true;
      node.position.set(pt.x, pt.y, pt.z);
      node.scale.setScalar(MARK_SCALE);
      n += 1;
    }
    for (let i = n; i < this.marks.length; i++) this.marks[i].visible = false;
  }

  private disc(i: number): Object3D | null {
    let d = this.discs[i];
    if (d) return d;
    const c = this.effects?.cloneSlot(ROUTE_FIGURE_SHADOW_SLOT) ?? null;
    if (!c) return null;
    this.view.add(c);
    this.discs[i] = c;
    d = c;
    return d;
  }

  private clearView(): void {
    for (const o of [...this.discs, ...this.marks]) o.removeFromParent();
    this.discs = [];
    this.marks = [];
    this.markSlot = -1;
  }

  /** Hide the world, keep this layer's nodes and the lights. Idempotent. */
  private enter(): void {
    if (!this.active) {
      this.active = true;
      this.fog = this.scene.fog;
      this.background = this.scene.background;
    }
    this.scene.fog = null;
    this.scene.background = BLACK;
    const keep = new Set<Object3D>([this.view]);
    for (const b of this.bodies) {
      for (let o: Object3D | null = b?.root ?? null; o; o = o.parent) {
        keep.add(o);
      }
    }
    const walk = (parent: Object3D): void => {
      for (const c of parent.children) {
        if (keep.has(c)) {
          if (c !== this.view && !this.bodies.some((b) => b?.root === c)) {
            walk(c);
          }
          continue;
        }
        // Lights stay: the bodies are drawn under whatever the lighting
        // layer has, and a light draws nothing of its own. A group holding
        // one is walked into rather than hidden, because a light under an
        // invisible parent lights nothing.
        if ((c as { isLight?: boolean }).isLight) continue;
        // A layer that draws what this screen's own tasks draw -- the deep
        // screen sprites, the route map's tiles -- says so.
        if (c.userData.keepOnGameOver) continue;
        if (!c.visible) continue;
        if (c.getObjectByProperty("isLight", true)) {
          walk(c);
          continue;
        }
        if (!this.hid.has(c)) this.hid.set(c, c.visible);
        c.visible = false;
      }
    };
    walk(this.scene);
  }

  /** Put back what `enter` took away, and the bodies where they came from. */
  private leave(): void {
    if (!this.active) return;
    this.active = false;
    for (const [o, v] of this.hid) o.visible = v;
    this.hid.clear();
    this.scene.fog = this.fog;
    this.scene.background = this.background;
    this.fog = null;
    this.background = null;
    this.bodies.forEach((b, p) => {
      if (!b) return;
      const home = this.homes[p];
      if (home && b.root.parent !== home) home.add(b.root);
      b.root.visible = false;
    });
    for (const o of [...this.discs, ...this.marks]) o.visible = false;
  }
}
