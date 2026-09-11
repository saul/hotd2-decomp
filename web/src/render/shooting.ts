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
 * ## There is no Shoot switch
 *
 * There was, it was **off by default**, and off it took the game with it: the
 * live-enemy gates ask `WalkerHost.aliveEnemies`, which answered null while
 * shooting was off, and a null count is not a condition -- so `wait_enemies_
 * alive` and `wait_enemies_present` passed on their timeouts and the script
 * walked through every fight in the game without stopping for one. That reads
 * as a broken port, not as a switch nobody had found, and it was reported as
 * one.
 *
 * Shooting is what the game *is*. It is on, it is not a setting, and the
 * counts the gates read are always the real ones.
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
 * alive, result != 5   one of BLOOD02/03/04/06, BONE01   + the hurt voice
 * dead, result != 2    the same five                     + the kill voice
 * dead, result == 2    BLOOD01 or BLOOD05                + the kill voice again
 * result 5             BULLET_MET3 — it bounced off
 * miss                 the surface's BULLET_SND/MET/OTH/WAT/WOD
 * ```
 *
 * That table used to be written here as *alive / killed / headshot kill*, and
 * it was wrong about the engine on both of the last two rows: the kind is the
 * hit-result code, nothing tests the bone, and kind 2's voice pair is kind 1's
 * pair. `game/combat/feedback.ts` carries the disassembly and the checks. The
 * split into two voice sets is `ActorPlayHitVoice`'s own switch over the
 * character type, and `combat.voice_set_a_types` is the exporter's copy of it.
 *
 * None of it is raised from this file any more.
 *
 * The **sprites are not here any more.** `ActorShotFeedback` (`FUN_00454050`),
 * `SpawnWorldImpact` (`FUN_00405260`), `SpawnBloodSpray` (`FUN_00407310`) and
 * the three per-shot rings of `PlayerShotEffectSpawn` (`FUN_00416F70`) are all
 * transcribed in `game/effects/` and `game/combat/feedback.ts`, and
 * `render/effects.ts` draws them from the game's own asset slots. What used to
 * be here was a canvas gradient standing in for twenty-five models, no muzzle
 * flash and no tracer at all.
 *
 * The **voices have gone too.** They were here on the argument that the pick
 * was seeded in this layer and the tables came from the bundle, and both
 * halves of that were reasons to move rather than reasons to stay: the pick is
 * the engine's `rand()` and belongs in the snapshot, and `game/tables.ts`
 * reads the same bundle. `ActorPlayHitVoice` (`FUN_0040A6F0`) exists once, in
 * `game/combat/voice.ts`.
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

import { Raycaster, Vector2, Vector3, type Camera } from "three";
import type { CharacterLayer } from "./characters";
import type { CombatJson } from "../bundle";
import type { Events, EventMap } from "../core/events";
import type { System } from "../core/system";
import { G } from "../game/globals";
import { HitResultCode } from "../game/combat/resolve_hit";
import type { Scope } from "../core/scope";

/** `FUN_00404AD0` builds its segment as origin + direction * 1000. */
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

  private combat: CombatJson | null = null;
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
      if (e.button !== 0) return;
      // `preventDefault` stops the drag-select a click on the scene would
      // otherwise start. It also stops the **focus change** the browser would
      // have made, and that half has to be done by hand: without it a click on
      // the game does not take the keyboard back off the script filter, so W
      // goes on going to the text box and the free camera never moves. That
      // was invisible while shooting was a toggle, because the toggle was off
      // and this handler returned before `preventDefault` ever ran.
      e.preventDefault();
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body) active.blur?.();
      this.fire(e);
    });
    viewport.addEventListener("pointermove", (e) => {
      const p = this.pointerAt(e);
      this.dot.style.left = `${p.x}px`;
      this.dot.style.top = `${p.y}px`;
    });
  }

  /**
   * Where the pointer is, in the viewport's own pixels.
   *
   * **A locked pointer has no position**, only deltas: `clientX` and `clientY`
   * stay frozen at wherever the lock was taken. Free roam captures the pointer
   * to the canvas (`render/freeroam.ts`), so with shooting also on the
   * crosshair would stick to the spot that was clicked and every shot would
   * leave from it. A locked pointer is at the centre of the element it is
   * locked to, which is where the reticle of anything that locks a pointer
   * sits, so that is what both the crosshair and the ray are given.
   *
   * `document.pointerLockElement` is read rather than imported: it is a fact
   * about the document, and this layer asking another layer whether it has the
   * pointer would be `render/` importing `render/` sideways for a value the
   * browser already publishes.
   */
  private pointerAt(e: PointerEvent): { x: number; y: number } {
    const r = this.viewport.getBoundingClientRect();
    if (document.pointerLockElement
        && this.viewport.contains(document.pointerLockElement)) {
      return { x: r.width / 2, y: r.height / 2 };
    }
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /**
   * The camera to cast the ray through.
   *
   * Called once, from `app/main.ts`, as soon as there is one. It used to be
   * half of `setEnabled(on, camera, scene)`, whose only caller was the
   * **Shoot toggle** -- so until somebody found that checkbox this layer had
   * no camera and a click did nothing at all. There is no toggle now; see the
   * note at the top of this file.
   *
   * The `scene` that travelled beside the camera is gone with it. It had been
   * stored and never read since the hit test moved to `characters.ts`, and it
   * only type-checked because the old setter's `scene ?? this._scene` read the
   * field it was writing.
   */
  castThrough(camera: Camera): void {
    this._camera = camera;
  }

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

  private readonly _back = new Vector3();
  private _camera: Camera | null = null;

  reset(): void {
    this.shots = 0;
    this.hits = 0;
    this.chars.revive();
    // No `ScoreResetAll` here any more. The score is engine state and this is
    // a renderer; both callers of `reset` (the seek and the stage load) run
    // `ResetGameGlobals` around it, which zeroes `g_player_score` and
    // `g_head_combo_bonus` the way `ResetSceneOnEnter` does. There is no voice
    // generator to reseed either: the pick is the world's `rand()`, and
    // `World.reset` is what puts that back.
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
    const p = this.pointerAt(e);
    this.ndc.set((p.x / r.width) * 2 - 1, -(p.y / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this._camera as never);
    this.ray.far = SHOT_RANGE;
    this.shots++;
    this.onFire({ origin: this.ray.ray.origin, dir: this.ray.ray.direction });
  }

  /**
   * What the port did with a shot, in the feed and in the voice.
   *
   * **Every sprite this used to draw is the port's now, and so is every
   * sound.** What is left is the half that is genuinely nobody's but the
   * player's: the event feed. `ActorPlayHitVoice` (`FUN_0040A6F0`) is raised
   * from `game/combat/feedback.ts`, on the engine's own hit-result rule, which
   * is not the `killed`/`head` rule this method used to apply.
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
    const acc = this.shots ? Math.round((this.hits / this.shots) * 100) : 0;
    return `${this.score} pts · ${this.hits}/${this.shots} (${acc}%)`
      + (G.g_head_combo_bonus[0]
         ? ` · head +${G.g_head_combo_bonus[0]}` : "");
  }
}
