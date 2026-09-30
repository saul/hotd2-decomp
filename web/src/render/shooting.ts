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
 * `game/combat/shot.ts` and docs/PLAYER.md, "Input intent".
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
 * camera yaw is the camera block's own, `g_camera_block_yaw_bams`, which the
 * port's camera keeps and `ChooseDeathMotionDirectional` reads for itself;
 * nothing here measures it.
 *
 * ## Feedback — `ActorShotFeedback` and `FUN_00407950`
 *
 * Every shot makes a noise, and which noise is a table, not a guess. The
 * exporter carries both, with the filenames `g_se_name_list` resolves:
 *
 * ```
 * alive, result != 5   one of BLOOD02/03/04/06, BONE01   + the hurt voice
 * dead, not the head   the same five                     + the kill voice
 * dead, the head       BLOOD01 or BLOOD05                + the kill voice again
 * result 5             BULLET_MET3 — it bounced off
 * miss                 the surface's BULLET_SND/MET/OTH/WAT/WOD
 * ```
 *
 * "Dead" is dead and not yet latched: a corpse says so once. Kind 2's voice
 * pair is kind 1's, so a head kill differs only in its impact.
 * `game/combat/feedback.ts` carries the disassembly and the checks. The
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
 * whatever happened to be drawn. That open question is answered.
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

/**
 * A pointer, twice over: `x`/`y` in the viewport's pixels, for the crosshair,
 * and `nx`/`ny` in the 4:3 frame's normalised coordinates, for the ray and the
 * aim. `inside` is whether it is on the frame at all -- off it, the gun is
 * pointed off the screen.
 */
interface FramePoint {
  x: number;
  y: number;
  nx: number;
  ny: number;
  inside: boolean;
}

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
   * game was between stages, which is not what `g_player_shot_count` counts.
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
   * root turns it into input the port owns. See docs/PLAYER.md,
   * "Input intent".
   */
  onFire: (ray: { origin: Vector3; dir: Vector3 }) => void = () => {};
  /**
   * The right button, or a press in the bars beside the 4:3 frame: a trigger
   * pull with the aim outside the screen, which is how the exe's mouse-gun
   * reloads (`MouseGunResolvePull`, `FUN_0041EB30`). No ray -- the engine
   * builds none for it. Wired by `app/main.ts`.
   */
  onOffscreenPull: () => void = () => {};
  /**
   * Where the pointer is aiming, in the frame's normalised device coordinates,
   * on every move and every press. The same shape as {@link onFire} and for the same reason: the aim is
   * input the port owns (`g_crosshair_x`, which the gun lights are built
   * from), so this layer reports it and `app/` writes it.
   */
  onAim: (ndcX: number, ndcY: number) => void = () => {};
  /**
   * What made the last press or move: `PointerEvent.pointerType`, `"mouse"`,
   * `"touch"` or `"pen"`, before the press itself is reported. Which device
   * that is to the game -- the mouse or the light gun, and so whether it has
   * a crosshair -- is the port's, and `app/` writes it (`app/device.ts`).
   */
  onPointerKind: (pointerType: string) => void = () => {};

  private combat: CombatJson | null = null;
  /**
   * The viewport, the canvas and the crosshair are React's, and arrive
   * through `UiHost`. The canvas is here for its rectangle: it is the 4:3
   * frame the ray is cast through, which the viewport is not.
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
              private readonly canvas: HTMLElement,
              private readonly dot: HTMLElement,
              private readonly chars: CharacterLayer,
              scope: Scope,
              events: Events) {
    // The feedback for a shot comes back from the port, because the port is
    // what decides what the shot did. Owned by the app scope, like everything
    // else this layer holds that outlives a stage.
    scope.defer(events.on("shot.resolved", (r) => this.onResolved(r)));
    // The context menu would take the right button, which is the reload --
    // and on a phone, a finger held still, which is a shot.
    viewport.addEventListener("contextmenu", (e) => e.preventDefault());
    viewport.addEventListener("pointerdown", (e) => {
      // The device first: a tap is the light gun's pull, and the game should
      // hear it as one on the tick that takes the shot.
      this.onPointerKind(e.pointerType);
      if (e.button === 2) {
        e.preventDefault();
        this.onOffscreenPull();
        return;
      }
      // A finger, a pen and the left button all arrive here as button 0.
      if (e.button !== 0) return;
      // **A second finger is a reload.** With the frame filling a phone there
      // are no black bars to tap, and the flick (`app/device.ts`) needs motion
      // sensors a browser may not grant -- plain `http://` on a LAN, or a
      // refused permission prompt. The first finger is the trigger; one put
      // down while it is still on the glass is a pull off the screen.
      if (e.pointerType === "touch") {
        const second = this.touches.size > 0;
        this.touches.add(e.pointerId);
        if (second) {
          e.preventDefault();
          this.onOffscreenPull();
          return;
        }
      }
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
      const f = this.pointerAt(e);
      this.follow(f);
      // **Off the frame is off the screen.** With the 4:3 frame on there are
      // black bars beside it -- and a gun pointed there is pointed off the
      // screen, which is how the arcade gun reloads (`MouseGunResolvePull`,
      // `FUN_0041EB30`). Filling the window, there is nowhere off the frame
      // to press and this never fires.
      if (!f.inside) {
        this.onOffscreenPull();
        return;
      }
      this.fire(f);
    });
    viewport.addEventListener("pointermove", (e) => {
      this.onPointerKind(e.pointerType);
      this.follow(this.pointerAt(e));
    });
    // A finger lifting, or taken by the browser, is no longer down.
    const lift = (e: PointerEvent) => { this.touches.delete(e.pointerId); };
    viewport.addEventListener("pointerup", lift);
    viewport.addEventListener("pointercancel", lift);
  }

  /** The fingers on the glass right now, by pointer id. */
  private readonly touches = new Set<number>();

  /** The crosshair onto the pointer, and the aim with it. */
  private follow(f: FramePoint): void {
    this.dot.style.left = `${f.x}px`;
    this.dot.style.top = `${f.y}px`;
    // A press, not only a move: a finger lands where it lands without having
    // moved there first, and the gun lights follow the aim.
    this.onAim(f.nx, f.ny);
  }

  /**
   * Where the pointer is: in the viewport's pixels for the crosshair, and in
   * the **frame's** normalised coordinates for the ray.
   *
   * The two are different rectangles. The canvas is the 4:3 frame, centred in
   * the viewport with bars beside or above it, and the camera's projection is
   * the canvas's. The ray used to be built against the viewport's rectangle,
   * which is the same thing only when the window happens to be 4:3 -- on a
   * wide window every shot landed nearer the middle than the crosshair, by as
   * much as a third of the frame on a phone held sideways.
   *
   * **A locked pointer has no position**, only deltas: `clientX` and `clientY`
   * stay frozen at wherever the lock was taken. Free roam captures the pointer
   * to the canvas (`render/freeroam.ts`), so the crosshair would stick to the
   * spot that was clicked and every shot would leave from it. A locked pointer
   * is at the centre of the element it is locked to, which is where the
   * reticle of anything that locks a pointer sits -- and the canvas is centred
   * in the viewport, so that is the middle of the frame as well.
   *
   * `document.pointerLockElement` is read rather than imported: it is a fact
   * about the document, and this layer asking another layer whether it has the
   * pointer would be `render/` importing `render/` sideways for a value the
   * browser already publishes.
   */
  private pointerAt(e: PointerEvent): FramePoint {
    const v = this.viewport.getBoundingClientRect();
    if (document.pointerLockElement
        && this.viewport.contains(document.pointerLockElement)) {
      return { x: v.width / 2, y: v.height / 2, nx: 0, ny: 0, inside: true };
    }
    const c = this.canvas.getBoundingClientRect();
    const nx = c.width > 0 ? ((e.clientX - c.left) / c.width) * 2 - 1 : 0;
    const ny = c.height > 0 ? -((e.clientY - c.top) / c.height) * 2 + 1 : 0;
    return {
      x: e.clientX - v.left, y: e.clientY - v.top, nx, ny,
      inside: Math.abs(nx) <= 1 && Math.abs(ny) <= 1,
    };
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
  private fire(f: FramePoint): void {
    if (!this._camera) return;
    this.ndc.set(f.nx, f.ny);
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
   * from `game/combat/feedback.ts`, on the engine's own rule: dead and not
   * latched, then the head bone or not.
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
      // spawns its own `SpawnBoneHitSprite`, and a civilian's shot arm its
      // `SpawnCivilianHitMarker` (`game/class10/hit_marker.ts`).
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
