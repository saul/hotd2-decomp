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
 * The **sprites are not here any more.** `ActorShotFeedback` (`FUN_00454050`),
 * `SpawnWorldImpact` (`FUN_00405260`), `SpawnBloodSpray` (`FUN_00407310`) and
 * the three per-shot rings of `PlayerShotEffectSpawn` (`FUN_00416F70`) are all
 * transcribed in `game/effects/` and `game/combat/feedback.ts`, and
 * `render/effects.ts` draws them from the game's own asset slots. What used to
 * be here was a canvas gradient standing in for twenty-five models, no muzzle
 * flash and no tracer at all.
 *
 * The **voices** stay, because the pick is seeded here and the tables the ids
 * come from are the bundle's.
 *
 * ## What this does not do
 *
 * No ammo, no reload, no civilians. `FUN_004560B0`'s *special* deaths — the
 * ones for a particular destroyed part — are not implemented, so a character
 * whose arm has come off still plays a directional death. What happens after
 * the clip is `FUN_00456740`, which is unread, so the corpse simply stays.
 *
 * A **miss** has a material now. `game/coli.ts` traces the shot segment
 * against the game's own collision sets, so the impact point, the normal and
 * the surface id are the engine's numbers rather than a raycast against
 * whatever happened to be drawn. That `[open]` is closed.
 */

import { Raycaster, Vector2, Vector3, type Camera, type Object3D } from "three";
import type { CharacterLayer } from "./characters";
import type { CombatJson } from "../bundle";
import type { Events, EventMap } from "../core/events";
import type { System } from "../core/system";
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
  /** Draw-time noise only — see `pickOne`. Reseeded by `reset`. */
  private readonly rng = new Rng(SOUND_PICK_SEED);
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
              scope: Scope,
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
   * Is there still feedback in flight?
   *
   * The effects are **game state** now: they are pools in `G` and
   * `ShotEffectsTick` steps them at the head of `GameUpdate`, so this asks
   * the port rather than a pool of its own. `wantsFrame` tests `freeze`
   * before it gets here, which is what stops a frozen transport being asked
   * for frames it would never step.
   */
  get busy(): boolean {
    return G.g_sprite_effects.length > 0
      || G.g_blood_sprays.length > 0
      || G.g_shot_tracer_ring.some((t) => t.live)
      || G.g_shot_flash_ring.some((f) => f.live);
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

  private readonly _back = new Vector3();
  private _camera: Camera | null = null;
  private _scene: Object3D | null = null;

  reset(): void {
    this.shots = 0;
    this.hits = 0;
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
   * What the port did with a shot, in the feed and in the voice.
   *
   * **Every sprite this used to draw is the port's now.** What is left is the
   * half that is genuinely the renderer's: `ActorPlayHitVoice`
   * (`FUN_0040A6F0`) picks from a table with a seeded generator this layer
   * owns, and the event feed is the player's, not the game's.
   */
  private onResolved(r: EventMap["shot.resolved"]): void {
    if (r.kind === "miss") return this.noteMiss(r);
    this.hits++;
    if (r.kind === "prop") {
      this.onShot({ hit: true, points: 0 },
                  `breakable group ${r.propGroup} member ${r.propMember}`
                  + ((r.propHp ?? 0) > 1 ? " · cracked" : " · broken"));
      return;
    }

    if (r.kind === "marked") {
      // The class scores it and the class draws it: `OneHitTargetUpdate`
      // spawns its own `SpawnBoneHitSprite`. A civilian's own effect is
      // `SpawnCivilianBloodPool` (`FUN_0048E080`), a decal object that is
      // still unported -- [open].
      this.onShot({ hit: true, bone: r.bone, points: 0 },
                  `${r.who} · marked, its own class scores it`);
      return;
    }

    if (r.result !== HitResultCode.NoEffect) {
      this.voice(r.charType ?? 0,
                 r.killed ? (r.head ? "head" : "kill") : "hurt");
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
   * A shot that hit nothing but the level.
   *
   * The impact and its sound are `SpawnWorldImpact` (`FUN_00405260`) in the
   * port; what is left here is the feed line, and it can name the surface now
   * because the port traced the game's own collision and put the material in
   * the event.
   */
  private noteMiss(r: EventMap["shot.resolved"]): void {
    const ric = r.surface === undefined
      ? undefined : this.combat?.ricochet[String(r.surface)];
    this.onShot({ hit: false, points: 0 },
                `miss${ric ? ` · ${ric.file.split("\\").pop()}` : ""}`);
  }

  get describe(): string {
    if (!this.enabled) return "off";
    const acc = this.shots ? Math.round((this.hits / this.shots) * 100) : 0;
    return `${this.score} pts · ${this.hits}/${this.shots} (${acc}%)`
      + (G.g_head_combo_bonus[0]
         ? ` · head +${G.g_head_combo_bonus[0]}` : "");
  }
}
