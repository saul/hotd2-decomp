/**
 * Shooting: the trigger, the feedback, the crosshair.
 *
 * **What this layer decides about a shot is now exactly two things**: where
 * the segment points, and what the impact looks and sounds like. Between them
 * sits the port. `fire` hands the segment to `onFire`, which `app/main.ts`
 * wires to `QueueShotRequest`; `ProcessShotRequests` drains the queue at the
 * head of `GameUpdate` and decides everything — which candidate along the
 * segment counts, what the hit does to the actor, what it is worth — and the
 * `shot.resolved` event brings the answer back here to be drawn.
 *
 * It used to do all of it inside the `pointerdown` handler: `ResolveHit`,
 * `MarkActorShot`, `BreakablePropTakeShot`, `ScoreAddForPlayer` and a private
 * head-combo counter that shadowed `g_head_combo_bonus`. None of that could be
 * reached by `test:port` and none of it was in a snapshot. See
 * `game/combat/shot.ts` and docs/PLAYER_ARCHITECTURE.md, "Input intent".
 *
 * The hit test itself is `characters.ts`, because that is where the bones are
 * and the spheres ride them — the port asks for it by name across
 * `GameHost.pickShot`.
 *
 * Read out of the binary; the full account is in `docs/formats/combat.md`.
 *
 * ## The ray
 *
 * `FUN_00406110` unprojects the crosshair with the game's own projection
 * distance — `640.21 = 240 / tan(41.1° / 2)` — and transforms it by the camera
 * matrix. Doing that here with the same camera three.js is already rendering
 * through gives the identical ray, so `Raycaster.setFromCamera` is used rather
 * than re-deriving it: the projection matrix it reads *is* the game's.
 *
 * The game's segment is 1000 units. Nothing here needs the bound — the bone
 * spheres are all well inside it — but it is applied so a shot past everything
 * behaves the same way.
 *
 * ## Dying
 *
 * A kill runs `FUN_004560B0`'s directional pick — `camera_yaw − actor_yaw`
 * against four ±45° arcs — and the body plays that clip once and stays. The
 * game's camera yaw is the direction from target to eye, which is the camera's
 * own local **+Z**, so that is what is measured here.
 *
 * ## Feedback — `ActorShotFeedback` and `FUN_00407950`
 *
 * Every shot makes a noise, and which noise is a table, not a guess. The
 * exporter carries both, with the filenames `g_se_name_list` resolves:
 *
 * ```
 * hit, actor alive   one of BLOOD02/03/04/06, BONE01   + the hurt voice
 * hit, actor killed  the same five                     + the kill voice
 * headshot kill      BLOOD01 or BLOOD05                + the head voice
 * hit, no effect     BULLET_MET3 — it bounced off
 * miss               the surface's BULLET_SND/MET/OTH/WAT/WOD
 * ```
 *
 * The voice comes in two sets and `combat.voice_set_a_types` says which set a
 * character type takes; that split is `ActorPlayHitVoice`'s own switch.
 *
 * The **sprite** is `FUN_00407230` for a flesh hit: 25 frames at 60 Hz, drawn
 * at the bone, scaled `(-view_z * 0.0375 + 0.25) * 0.3` and then by the
 * severity of the hit — 0.5 damaged, 0.75 damaged and swapped, 1.0 severed.
 * That geometry and timing are transcribed; the *artwork* is asset slots
 * `0x3A..0x52`, which the bundle does not carry, so a radial splat stands in
 * for it. Marked `[open]` in docs/formats/combat.md rather than pretended.
 *
 * ## What this does not do
 *
 * No ammo, no reload, no civilians. `FUN_004560B0`'s *special* deaths — the
 * ones for a particular destroyed part — are not implemented, so a character
 * whose arm has come off still plays a directional death. What happens after
 * the clip is `FUN_00456740`, which is unread, so the corpse simply stays.
 *
 * A **miss** has no material here: `FUN_00405260` takes it from the collision
 * triangle `ColiSegmentVsMesh` hit, and the collision meshes are not in the
 * bundle. The visible geometry gives the impact *point*, and material 3 —
 * the game's own "other" catch-all — gives the sound. `[open]`, and said so.
 */

import {
  AdditiveBlending, CanvasTexture, Raycaster, Sprite, SpriteMaterial, Vector2,
  Vector3, type Camera, type Object3D,
} from "three";
import type { CharacterLayer } from "./characters";
import type { CombatJson } from "../bundle";
import type { Events, EventMap } from "../core/events";
import type { Context, System, Tick } from "../core/system";
import { G } from "../game/globals";
import { HitResultCode } from "../game/combat/resolve_hit";
import { Rng } from "../core/rng";
import type { Scope } from "../core/scope";

/** `FUN_00404AD0` builds its segment as origin + direction * 1000. */
/**
 * The seed the voice picker starts every stage from.
 *
 * Any constant would do; what matters is that it is one, and that `reset`
 * puts it back. A stage played twice sounds the same.
 */
const SOUND_PICK_SEED = 0x50554e43;

const SHOT_RANGE = 1000;

const BAMS = 65536 / (Math.PI * 2);

/**
 * `FUN_00407230`: the blood sprite runs 25 asset slots, one per game frame.
 */
const BLOOD_FRAMES = 25;
/** ...and the material impact sprites are frame-per-frame too. */
const IMPACT_HZ = 60;
/** `FUN_00405260` has no material here — 3 is the game's "other" surface. */
const MISS_MATERIAL = 3;

export interface ShotResult {
  hit: boolean;
  bone?: number;
  head?: boolean;
  damage?: number;
  killed?: boolean;
  hp?: number;
  /** `g_hit_result`. */
  result?: HitResultCode;
  points: number;
}

/**
 * The impact sprites, pooled.
 *
 * `FUN_00407230` draws its 25 frames in **view space** at the bone's position
 * with an explicit scale, which is why the size law is reproduced rather than
 * left to perspective: the sprite is near-constant on screen out to 20 units
 * and fixed in the world beyond that.
 */
class ImpactSprites {
  private readonly pool: { s: Sprite; t: number; life: number; k: number }[] = [];
  private readonly tex = ImpactSprites.splat();

  constructor(private readonly scene: Object3D) {}

  /** A radial splat — a stand-in for asset slots 0x3A..0x52. */
  private static splat(): CanvasTexture {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, "rgba(255,240,220,0.95)");
    rg.addColorStop(0.35, "rgba(220,70,50,0.65)");
    rg.addColorStop(1, "rgba(120,10,10,0)");
    g.fillStyle = rg;
    g.fillRect(0, 0, 64, 64);
    return new CanvasTexture(c);
  }

  /** *scale* is the game's severity factor; *viewZ* the hit's view-space z. */
  spawn(at: Vector3, viewZ: number, scale: number, frames: number): void {
    // `FUN_00407230`: 1.0 past 20 units, otherwise -z*0.0375 + 0.25, then the
    // 0.3 the non-wide path applies, then the severity.
    const depth = viewZ < -20 ? 1.0 : -viewZ * 0.0375 + 0.25;
    const k = Math.max(0.05, depth * 0.3 * scale);
    let e = this.pool.find((x) => x.life <= 0);
    if (!e) {
      const sp = new Sprite(new SpriteMaterial({
        map: this.tex, transparent: true, depthTest: false,
        depthWrite: false, blending: AdditiveBlending,
      }));
      sp.renderOrder = 900;
      this.scene.add(sp);
      e = { s: sp, t: 0, life: 0, k: 1 };
      this.pool.push(e);
    }
    e.s.position.copy(at);
    e.t = 0;
    e.k = k;
    e.life = frames / IMPACT_HZ;
    e.s.visible = true;
    e.s.scale.setScalar(k * 8);
  }

  /** Is any sprite still alive? `Player.wantsFrame` is the reader. */
  get busy(): boolean {
    return this.pool.some((e) => e.life > 0);
  }

  update(dt: number): void {
    for (const e of this.pool) {
      if (e.life <= 0) continue;
      e.t += dt;
      if (e.t >= e.life) { e.life = 0; e.s.visible = false; continue; }
      // The sprite is a flipbook in the game; here the stand-in fades and
      // grows over the same span, so the timing still reads correctly.
      const u = e.t / e.life;
      e.s.scale.setScalar(e.k * 8 * (1 + u * 1.6));
      (e.s.material as SpriteMaterial).opacity = 1 - u;
    }
  }

  clear(): void {
    for (const e of this.pool) { e.life = 0; e.s.visible = false; }
  }

  /**
   * Give the pool back.
   *
   * The sprites are added to the scene and the splat is a `CanvasTexture`
   * built here, so all of it is this object's -- and none of it was ever
   * freed, because nothing owned this object. It is on the app scope now, so
   * "for the life of the page" is a *statement about the scope* rather than
   * about a `new` nobody wrote down.
   */
  dispose(): void {
    for (const e of this.pool) {
      e.s.removeFromParent();
      (e.s.material as SpriteMaterial).dispose();
    }
    this.pool.length = 0;
    this.tex.dispose();
  }
}

export class Shooting implements System {
  readonly id = "render.shooting";
  private readonly ray = new Raycaster();
  private readonly ndc = new Vector2();

  private enabled = false;
  /**
   * The running score is a global — `G.g_player_score` — because
   * `PlayerTakeDamage` also writes it, and two counters that both call
   * themselves the score is how they drift. So is the head combo, which used
   * to have a second private copy here: `g_head_combo_bonus` is the engine's
   * and `ResetSceneOnEnter` zeroes it, and only one of the two was ever in a
   * snapshot.
   *
   * `shots` and `hits` are the display's own tally and stay here: `shots`
   * counts clicks the *viewer* made, including one aimed at nothing while the
   * game was between stages, which is not what `g_nPlayerFired` counts.
   */
  get score(): number { return G.g_player_score[0]; }
  shots = 0;
  hits = 0;

  /** Called with a one-line description of each shot, for the event feed. */
  onShot: (r: ShotResult, note: string) => void = () => {};
  /**
   * A trigger pull, handed to whoever queues it.
   *
   * `app/main.ts` wires this to `QueueShotRequest`. It is a callback rather
   * than a call into `game/` because **a renderer does not get to change
   * engine state**, and a `.push` onto `g_shot_requests` from here is that
   * violation wearing a different verb — `no-engine-writes-in-render` only
   * greps for `G.x =`, but the rule is about who decides, not about the
   * spelling. So this layer says *what the viewer did* and the composition
   * root turns it into input the port owns. See docs/PLAYER_ARCHITECTURE.md,
   * "Input intent".
   */
  onFire: (ray: { origin: Vector3; dir: Vector3 }) => void = () => {};
  /** Wired to the bundle's sound player; ids are `g_se_name_list` ids. */
  playSound: (id: number) => void = () => {};

  private combat: CombatJson | null = null;
  private impacts: ImpactSprites | null = null;
  /** Draw-time noise only — see `pickOne`. Reseeded by `reset`. */
  private readonly rng = new Rng(SOUND_PICK_SEED);
  private readonly _v = new Vector3();
  /**
   * The resolved shot's point, held apart from `_v`.
   *
   * `viewZ` transforms **into** `_v`, so handing it the same vector as the hit
   * point would leave the point in view space by the time the sprite is placed
   * — a scratch aliasing itself, which reads as an impact drawn a few hundred
   * units behind the camera.
   */
  private readonly _at = new Vector3();

  /**
   * The viewport and the crosshair are React's, and arrive through `UiHost`.
   *
   * This layer used to build `.crosshair` and append it into `#viewport`,
   * which put a node React had never heard of inside the element React
   * renders — and left where it landed in the paint order to whichever of
   * React's conditional overlays had mounted first. It is rendered by
   * `ui/panels/Viewport.tsx` now and handed over here, and what this layer
   * writes onto it is what it always really wanted: a `left` and a `top`
   * following the pointer.
   */
  constructor(private readonly viewport: HTMLElement,
              private readonly dot: HTMLElement,
              private readonly chars: CharacterLayer,
              private readonly scope: Scope,
              events: Events) {
    // The feedback for a shot comes back from the port, because the port is
    // what decides what the shot did. Owned by the app scope, like everything
    // else this layer holds that outlives a stage.
    scope.defer(events.on("shot.resolved", (r) => this.onResolved(r)));
    viewport.addEventListener("pointerdown", (e) => {
      if (!this.enabled || e.button !== 0) return;
      e.preventDefault();
      this.fire(e);
    });
    viewport.addEventListener("pointermove", (e) => {
      if (!this.enabled) return;
      const r = viewport.getBoundingClientRect();
      this.dot.style.left = `${e.clientX - r.left}px`;
      this.dot.style.top = `${e.clientY - r.top}px`;
    });
  }

  setEnabled(v: boolean, camera?: Camera, scene?: Object3D): void {
    this.enabled = v;
    // Neither the `shooting` class on the viewport nor the crosshair's
    // `hidden` is set here any more. Both are React's elements and
    // `p.toggles.shoot` is the same fact this is called with, so both are
    // rendered rather than toggled -- two layers writing one attribute is the
    // bug this whole arc is about, and `paused` was the other writer. The flag
    // itself stays: it gates the pointer handlers above and `walker_host`
    // reads it through `isEnabled` to decide whether the live-enemy counts
    // mean anything, and neither of those is a pixel.

    this._camera = camera ?? this._camera;
    this._scene = scene ?? this._scene;
    if (this._scene && !this.impacts) {
      // Owned, not merely made: the pool and its splat texture live as long as
      // the page and that is a decision, so it is written down where the
      // disposal tree can show it.
      this.impacts = this.scope.own(new ImpactSprites(this._scene));
    }
  }

  get isEnabled(): boolean { return this.enabled; }

  /**
   * The camera yaw the directional death compares against, in BAMS.
   *
   * `FUN_00403AC0` builds the game's camera yaw from `eye - target`, so it is
   * the camera's own local **+Z** — its backward axis, not its forward one.
   */
  get cameraYawBams(): number {
    if (!this._camera) return 0;
    this._back.set(0, 0, 1).applyQuaternion(this._camera.quaternion);
    return Math.atan2(this._back.x, this._back.z) * BAMS;
  }

  /** The proved sound and sprite tables, from the stage bundle. */
  setTables(combat: CombatJson | undefined): void {
    this.combat = combat ?? null;
  }

  /**
   * Advance the impact sprites.
   *
   * Wall time, not game time: they are feedback for a click, not part of the
   * script's clock, so a paused player still sees them out.
   */
  update(_ctx: Context, t: Tick): void {
    this.impacts?.update(t.wall);
  }

  /**
   * Is there still feedback in flight?
   *
   * A paused player stops asking for frames, and a shot fired while it is
   * paused would otherwise leave its sprite hanging in the air. This is what
   * keeps the loop awake until the last one has gone.
   */
  get busy(): boolean {
    return this.impacts?.busy ?? false;
  }

  /**
   * One of a table's entries, from the layer's **own** seeded generator.
   *
   * Not `ctx.rng`: which impact grunt plays is feedback, not state, and drawing
   * from the world generator would make the port's next draw depend on how many
   * shots the viewer had fired — two loads of one snapshot would then diverge
   * on the first swing, which is the exact failure `core/rng.ts` exists to
   * prevent. Not `Math.random()` either: a driven run has to replay, and an
   * ambient draw is the one thing a replay cannot reproduce. Seeded per stage,
   * carried by nothing.
   */
  private pickOne<T>(xs: T[] | undefined): T | undefined {
    return xs?.length ? xs[this.rng.int(xs.length)] : undefined;
  }

  /**
   * `ActorPlayHitVoice` (`FUN_0040A6F0`): a flesh impact plus a voice, with
   * the voice taken from set A or set B by character type.
   */
  private voice(charType: number, kind: "hurt" | "kill" | "head"): void {
    const c = this.combat;
    if (!c) return;
    const impact = kind === "head"
      ? this.pickOne(c.head_impact) : this.pickOne(c.impact);
    if (impact) this.playSound(impact.id);
    const set = c.voice_set_a_types.includes(charType) ? 0 : 1;
    const v = c.voice[kind]?.[set];
    if (v) this.playSound(v.id);
  }

  /** View-space z of a world point, which is what the sprite scale reads. */
  private viewZ(at: Vector3): number {
    if (!this._camera) return -20;
    return this._v.copy(at).applyMatrix4(this._camera.matrixWorldInverse).z;
  }

  private readonly _back = new Vector3();
  private _camera: Camera | null = null;
  private _scene: Object3D | null = null;

  reset(): void {
    this.shots = 0;
    this.hits = 0;
    this.impacts?.clear();
    this.chars.revive();
    // No `ScoreResetAll` here any more. The score is engine state and this is
    // a renderer; both callers of `reset` (the seek and the stage load) run
    // `ResetGameGlobals` around it, which zeroes `g_player_score` and
    // `g_head_combo_bonus` the way `ResetSceneOnEnter` does.
    // A stage always starts from the same voice line, so two runs of the same
    // stage sound the same.
    this.rng.reseed(SOUND_PICK_SEED);
  }

  /**
   * The trigger, and the whole of what this layer decides about a shot.
   *
   * `BuildShotRay` (`FUN_00406110`) unprojects the crosshair with the game's
   * own projection distance and `ShotBuildSegment` (`FUN_00404AD0`) turns it
   * into a 1000-unit segment; that is a camera question, so it is answered
   * here. Everything after it — which candidate along the segment counts, what
   * the hit does, what it is worth — is the port's, and reaches it as a queued
   * request. See `game/combat/shot.ts`.
   */
  private fire(e: PointerEvent): void {
    if (!this._camera) return;
    const r = this.viewport.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1,
                 -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this._camera as never);
    this.ray.far = SHOT_RANGE;
    this.shots++;
    this.onFire({ origin: this.ray.ray.origin, dir: this.ray.ray.direction });
  }

  /**
   * What the port did with a shot, drawn.
   *
   * `ActorShotFeedback`: a result-5 hit is a ricochet, everything else is
   * blood at the bone, scaled by how bad the hit was. None of it is state and
   * none of it is a decision — the decision arrived in the payload.
   */
  private onResolved(r: EventMap["shot.resolved"]): void {
    if (r.kind === "miss") return this.drawMiss(r);
    this.hits++;
    if (r.kind === "prop") return this.drawPropHit(r);
    const point = this._at.set(r.point?.x ?? 0, r.point?.y ?? 0,
                               r.point?.z ?? 0);

    if (r.kind === "marked") {
      // `ActorShotFeedback` still runs: it is flesh, so it is blood at the
      // shot point, at the "damaged" severity -- there is no hit result to
      // scale by.
      const scale = this.combat?.blood_scale["1"] ?? 0.5;
      this.impacts?.spawn(point, this.viewZ(point), scale, BLOOD_FRAMES);
      this.onShot({ hit: true, bone: r.bone, points: 0 },
                  `${r.who} · marked, its own class scores it`);
      return;
    }

    const c = this.combat;
    if (r.result === HitResultCode.NoEffect) {
      const ric = c?.no_effect.sound;
      if (ric) this.playSound(ric.id);
      const sp = c?.impact_sprite[String(c.no_effect.material)];
      if (sp && this.impacts) {
        this.impacts.spawn(point, this.viewZ(point), sp[2],
                           Math.max(1, sp[1] - sp[0] + 1));
      }
    } else {
      this.voice(r.charType ?? 0,
                 r.killed ? (r.head ? "head" : "kill") : "hurt");
      const scale = c?.blood_scale[String(r.result)] ?? 0.5;
      this.impacts?.spawn(point, this.viewZ(point), scale, BLOOD_FRAMES);
    }

    const note = `${r.who} bone ${r.bone}${r.head ? " (head)" : ""}` +
      ` −${r.damage} hp${r.killed ? ", killed" : ` → ${r.hp}`}` +
      (r.severed ? " · limb severed" : r.gore ? " · part swapped" : "") +
      (r.result === HitResultCode.NoEffect ? " · no effect (ricochet)" : "") +
      (r.react ? ` · stagger ${r.react}` : "") +
      (r.death !== undefined ? ` · death ${r.death}` : "") +
      `  +${r.points}`;
    this.onShot({ hit: true, bone: r.bone, head: r.head, damage: r.damage,
                  killed: r.killed, hp: r.hp, result: r.result,
                  points: r.points }, note);
  }

  /**
   * A shot that hit nothing the port knows about.
   *
   * `FUN_00405260` takes the material from the collision triangle; there is
   * none here, so the visible geometry gives the point and material 3
   * ("other") gives the sound. The ray comes back with the event because this
   * is the one impact point only the renderer can find.
   */
  private drawMiss(r: EventMap["shot.resolved"]): void {
    this.ray.ray.origin.set(r.ray.origin.x, r.ray.origin.y, r.ray.origin.z);
    this.ray.ray.direction.set(r.ray.dir.x, r.ray.dir.y, r.ray.dir.z);
    this.ray.far = SHOT_RANGE;
    const where = this._scene
      ? this.ray.intersectObject(this._scene, true).find((h) => h.object.visible)
      : undefined;
    const mat = String(MISS_MATERIAL);
    const ric = this.combat?.ricochet[mat];
    if (ric) this.playSound(ric.id);
    if (where && this.impacts) {
      const sp = this.combat?.impact_sprite[mat]
        ?? this.combat?.impact_sprite_default;
      const frames = sp ? Math.max(1, sp[1] - sp[0] + 1) : BLOOD_FRAMES;
      this.impacts.spawn(where.point, this.viewZ(where.point),
                         sp ? sp[2] : 1, frames);
    }
    this.onShot({ hit: false, points: 0 },
                `miss${ric ? ` · ${ric.file.split("\\").pop()}` : ""}`);
  }

  /**
   * A shot that landed on a breakable prop.
   *
   * A prop is not flesh: the impact is the hard-surface spark, which is what
   * `SpawnPropHitSpark` (`FUN_00465860`) puts at the shot point. `propHp` is
   * still what it was when the shot landed — `BreakablePropUpdate` consumes
   * the hit on its next frame — so this says what the shot is about to do
   * rather than what it did.
   */
  private drawPropHit(r: EventMap["shot.resolved"]): void {
    const point = this._at.set(r.point?.x ?? 0, r.point?.y ?? 0,
                               r.point?.z ?? 0);
    const c = this.combat;
    const sp = c?.impact_sprite[String(MISS_MATERIAL)]
      ?? c?.impact_sprite_default;
    if (sp && this.impacts) {
      this.impacts.spawn(point, this.viewZ(point), sp[2],
                         Math.max(1, sp[1] - sp[0] + 1));
    }
    this.onShot({ hit: true, points: 0 },
                `breakable group ${r.propGroup} member ${r.propMember}`
                + ((r.propHp ?? 0) > 1 ? " · cracked" : " · broken"));
  }

  get describe(): string {
    if (!this.enabled) return "off";
    const acc = this.shots ? Math.round((this.hits / this.shots) * 100) : 0;
    return `${this.score} pts · ${this.hits}/${this.shots} (${acc}%)`
      + (G.g_head_combo_bonus[0]
         ? ` · head +${G.g_head_combo_bonus[0]}` : "");
  }
}
