/**
 * The game-over screen's world: the players' bodies, and nothing else.
 *
 * Phase 0 of `GameOverRunPhase` (`FUN_00460960`) releases the stage -- every
 * pol slot back to the resident common set, every cam file out -- and builds a
 * task list whose only drawing is the players' bodies, through
 * `PlayerHookDrawBodyUntilMotionEnd` (`FUN_004151D0`). So from then until the
 * next stage load the screen is those bodies against the clear colour, and
 * from the logo on it is the clear colour alone. `G.g_stage_unloaded` says
 * when; `G.g_player_bodies` says where each body is, on which clip and cursor,
 * and whether its hook drew it this frame.
 *
 * The port keeps the stage in memory, because the page's restart buttons
 * reload it, so "unloaded" here means **not drawn**: every node that is not a
 * body or one of its ancestors is hidden for as long as the flag is up, and
 * put back as it was when it drops.
 *
 * The fog goes with it. `CameraBlocksReset` (`FUN_004021D0`) runs
 * `LightBlockInit` (`FUN_0041DBA0`) over both light blocks, which is fog at
 * (65535, 65536) -- none -- in colour 0. `[proved]` So no fog and a black
 * background, whatever the stage had.
 */
import { Color, type Fog, type FogExp2, type Object3D, type Scene }
  from "three";
import type { Context, System } from "../core/system";
import type { Scope } from "../core/scope";
import { BAMS_TO_RAD } from "../core/bams";
import { MotionFlag } from "../game/actor";
import { G } from "../game/globals";
import { PLAYER_BODY_AT } from "../game/player_body_data";
import type { CharacterLayer } from "./characters";
import type { Instance } from "./characters/instance";
import { Poser } from "./characters/pose";

type Body = Pick<Instance, "type" | "root" | "pivot" | "bones">;

const BLACK = new Color(0);

export class GameOverScene implements System {
  readonly id = "render.game_over";
  private readonly poser = new Poser();
  /** Each player's body hierarchy, claimed from the character layer. */
  private bodies: (Body | null)[] = [];
  /** Nodes this hid, and whether each was visible before. */
  private readonly hid = new Map<Object3D, boolean>();
  private fog: Fog | FogExp2 | null = null;
  private background: Scene["background"] = null;
  private active = false;

  constructor(private readonly scene: Scene) {}

  /**
   * After the character layer has adopted the stage's hierarchies: take the
   * two bodies out of it, hidden until a hook draws them.
   */
  build(scope: Scope, chars: CharacterLayer): void {
    this.bodies = PLAYER_BODY_AT.map((at) => chars.claim(at));
    for (const b of this.bodies) if (b) b.root.visible = false;
    scope.child("game-over").defer(() => {
      this.leave();
      this.bodies = [];
    });
  }

  update(_ctx: Context): void {
    if (G.g_stage_unloaded === 0) {
      this.leave();
      return;
    }
    this.enter();
    for (let p = 0; p < this.bodies.length; p++) {
      const node = this.bodies[p];
      if (!node) continue;
      const b = G.g_player_bodies[p];
      const show = !!b && b.drawn !== 0
        && this.poser.poseHeld(node, b.motion, b.playTicks,
                               (b.motionFlags & MotionFlag.RootMotion) !== 0);
      node.root.visible = show;
      if (!show || !b) continue;
      node.root.position.set(b.pos.x, b.pos.y, b.pos.z);
      node.root.rotation.set(0, b.yaw * BAMS_TO_RAD, 0);
    }
  }

  /** Hide the world, keep the bodies and the lights. Every frame, idempotent. */
  private enter(): void {
    if (!this.active) {
      this.active = true;
      this.fog = this.scene.fog;
      this.background = this.scene.background;
    }
    this.scene.fog = null;
    this.scene.background = BLACK;
    const keep = new Set<Object3D>();
    for (const b of this.bodies) {
      for (let o: Object3D | null = b?.root ?? null; o; o = o.parent) {
        keep.add(o);
      }
    }
    const walk = (parent: Object3D): void => {
      for (const c of parent.children) {
        if (keep.has(c)) {
          if (!this.bodies.some((b) => b?.root === c)) walk(c);
          continue;
        }
        // Lights stay: the bodies are drawn under whatever the lighting
        // layer has, and a light draws nothing of its own. A group holding
        // one is walked into rather than hidden, because a light under an
        // invisible parent lights nothing.
        if ((c as { isLight?: boolean }).isLight) continue;
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

  /** Put back what `enter` took away. */
  private leave(): void {
    if (!this.active) return;
    this.active = false;
    for (const [o, v] of this.hid) o.visible = v;
    this.hid.clear();
    this.scene.fog = this.fog;
    this.scene.background = this.background;
    this.fog = null;
    this.background = null;
    for (const b of this.bodies) if (b) b.root.visible = false;
  }
}
