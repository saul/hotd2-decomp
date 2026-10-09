/**
 * A trigger pull, from intent to consequence.
 *
 * ## Why there is a queue
 *
 * The renderer owns the pointer, the crosshair and the camera the ray is
 * unprojected through, so it is where a click becomes a segment. Everything
 * *after* that is the game: which of the candidates along the segment counts,
 * what the hit does to the actor, and what it is worth. Those decisions used
 * to be made in `render/shooting.ts` — `ResolveHit`, `MarkActorShot`,
 * `BreakablePropTakeShot` and `ScoreAddForPlayer` were all called from a
 * pointer handler — which put a chunk of the game where `test:port` could not
 * reach it and no snapshot could describe it.
 *
 * So the click becomes **input**: `QueueShotRequest` puts a segment on
 * `g_shot_requests`, and `TakeDueShotRequests` drains it from the player's own task in
 * `GameUpdate`. That is the shape the engine already has — `BuildShotRay`
 * (`FUN_00406110`) writes the per-player shot record and the game loop reads
 * it — and it buys the thing the plan has wanted since the beginning: the
 * queue **is** an input log: it is plain data in the snapshot, so recording it
 * per frame gives a session that can be replayed. What is *not* here yet is
 * the other half of that — a `pickShot` a headless run can answer, which needs
 * the skeleton's forward kinematics in `game/`. See
 * docs/PLAYER.md, "Input intent".
 *
 * ## What a bullet does
 *
 * `ShotTestSphere` (`FUN_00404630`) is the fork. It tests a sphere at the
 * actor's registered point with radius `obj+0x124`, and only descends into the
 * skeleton — `ShotTestSkeleton` (`FUN_00404700`) — when `obj+0x34` bit `0x80`
 * is set and the character has bones. That bit is raised by the skeleton
 * build every skinned `Init` runs, a civilian's included (see
 * `ActorFlag.ShootPerBone`), so a civilian is a ten-unit ball first and a set
 * of bone spheres inside it. It still has no hit table, no damage and no
 * gore: its hit does not go through `ResolveHit` at all.
 *
 * What it goes through instead is this: the sort picks the nearest candidate
 * and marks it, and the actor's own update decides what being marked means.
 * For a civilian that is a life, two hundred points and the on-shot script.
 *
 * The classes that register the engine's way are tested by
 * `combat/shot_test.ts`; the rest are still picked by `render/`. See
 * {@link MergeShotPicks} for how the two answers meet.
 *
 * ## The score, from `FUN_00409430`
 *
 * ```
 * any hit not on the head     +10, unless the hit reported result 5
 * a hit on bone 2, the head   +120, then a per-player combo that grows by 10
 * HP reaching zero            +80
 * ```
 *
 * All three are paid inside `ResolveHit`, which is also what counts the hit
 * into `g_player_hit_count` for the accuracy grade; this file only reports
 * what it paid.
 *
 * The head combo is added *before* it increments, so consecutive headshots pay
 * 120, 130, 140 …, and **any non-head hit resets it to zero**. That reset is
 * the whole reason the counter exists, so it is reproduced exactly. It lives
 * in `g_head_combo_bonus`, which `ResetSceneOnEnter` zeroes; a second private
 * copy in `render/shooting.ts` used to shadow it, and only one of the two was
 * ever in a snapshot.
 *
 * "Any non-head hit" means any hit a routine that keeps the combo scores, and
 * there are four: `ResolveHit` here, and the updates of classes 0x10, 0x20
 * and 0x21, which each write it out again. Nothing else in the image writes
 * it but the scene and join resets. A shot that is only marked -- a prop, a
 * thrown weapon, a body creature, any other class that owns its result --
 * leaves it running.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { ActorFlag, type Actor } from "../actor";
import { MarkBodyCreatureShot } from "../body_creature";
import { MarkCarriedPropShot } from "../carried_prop";
import { MarkThrownWeaponShot } from "../thrown_weapon";
import { BreakablePropTakeShot } from "../class41/prop";
import { PropFamily } from "../class41/prop_state";

/**
 * The prop families whose routine never calls `SpawnPropHitSpark`
 * (`FUN_00465860`) — read off that function's nine call sites, none of which
 * is in `PropUpdateType38`, `PropUpdateType39`, `PropUpdateType40`,
 * `PropUpdateType44` or `FallingContainerUpdate` -- the container's knock
 * calls `SpawnPropHitEffectScaled` at one and a half size instead, and its
 * break calls neither.
 */
const NO_PROP_SPARK: ReadonlySet<PropFamily> = new Set([
  PropFamily.Type38, PropFamily.Type39, PropFamily.Type40, PropFamily.Type44,
  PropFamily.Falling,
]);
import { ColiTraceSegmentAllSets } from "../coli";
import { OriginalWeaponKind, PlayerShotEffectSpawn }
  from "../effects/shot_effects";
import { SpawnPropHitSpark, SpawnSpriteEffect, SpriteEffectKind }
  from "../effects/sprite";
import { GameMode } from "../game_mode";
import { ActorShotFeedback, SpawnWorldImpact } from "./feedback";
import { ActorByAt, G } from "../globals";
import { CameraBlockViewToWorld } from "../camera/view";
import { MatrixTransformPoint, MatrixTransformVector } from "../matrix";
import { PROJECTION_DISTANCE_PX } from "../scene_lights";
import type { GameHost, ShotPick, ShotRay } from "../host";
import { vec3, type Vec3 } from "../vec";
import { g_class_handlers } from "../registry";
import type { SpawnClass } from "../spawn_class";
import { DispatchHit, HitResultCode } from "./resolve_hit";
import { ProcessPlayerShotsTestList, type ShotCandidate } from "./shot_test";

/**
 * One queued trigger pull.
 *
 * Plain data on purpose: it goes in `G`, so a snapshot carries any request the
 * frame has not drained yet, and `clonePlain` has to be able to copy it.
 */
export interface ShotRequest {
  /** Which player fired. The engine keeps a shot record per player. */
  player: number;
  /** `g_frame` when the trigger was pulled — what a replay log re-times to. */
  frame: number;
  ray: ShotRay;
  /**
   * `g_aim_on_screen` (`0x009C8FD0`) at the pull: 1 for a click on the
   * scene, 0 for a pull **outside the screen**. The port's pointer is the PC
   * mouse, which `InputMapDevicesToMaple` (`FUN_0041E530`) makes a *gun*
   * (input modes 5 and 6), and a gun reloads by shooting off the screen --
   * `MouseGunResolvePull` (`FUN_0041EB30`) turns the mouse's right button
   * into exactly that. See {@link QueueOffscreenPull}.
   */
  onScreen: number;
}

/**
 * `g_gunshot_sound_ids` — `0x004EC8BC`. One u32 per player, read out of the
 * data segment as `a9163400 a9163300`: `0x003416A9` is `COMMON\GUN5_22.WAV`
 * and `0x003316A9` is `COMMON\GUN4_22.WAV`. Player 0 and player 1 fire
 * different guns, and that is the only difference between them.
 *
 * `PlayerFireAndReloadUpdate` (`FUN_00414940`) plays
 * `g_gunshot_sound_ids[player]` as the last thing it does on a shot, after
 * `PlayerShotEffectSpawn` — so the gun is heard whatever the round goes on to
 * hit, and a shot that hits nothing is as loud as one that does.
 *
 * Original Mode fires through `PlayerFireOriginalModeWeapon`
 * (`FUN_00414B90`) instead, which prefers
 * `g_original_weapon_gunshot_ids[g_original_weapon_sound_kind]` and falls back
 * to this table when that entry is zero: entry 0, which the bare gun, the
 * POWER UPs and the CHAMBERs keep. The seven guns the items give each have
 * their own (`original_mode.gunshot_ids`, set by `OriginalItemsApply`).
 */
export const g_gunshot_sound_ids: readonly number[] = [0x003416a9, 0x003316a9];

/**
 * `BuildShotRay` — `FUN_00406110`, the ray half: the crosshair at `(x, y)`
 * pixels from the centre, `+y` up, unprojected at `g_projection_distance_px`
 * -- `Vec3Normalize(x, y, -640.2)` -- then through the camera block
 * `g_camera_index` names (`MatrixStackSetTopFromArray(g_camera_blocks +
 * g_camera_index * 0x1A4)`): the record's `+0x28` point for the origin, and
 * the direction with the translation cleared. `+0x28` has no writer in the
 * image (`[likely]` zero from the boot's clear), so the origin is the eye.
 * The angles and their sines the routine also leaves in the record are
 * `ShotRayAnglesFromView`'s, taken where the shot is tested.
 *
 * The port's pulls arrive with this ray already built by the page, from the
 * same crosshair; the routines that fire with no pull -- Original Mode's
 * owed rounds and its recoil spread -- build it here, as the engine builds
 * every one.
 */
export function BuildShotRay(x: number, y: number): ShotRay {
  const len = Math.hypot(x, y, PROJECTION_DISTANCE_PX);
  const view = { x: x / len, y: y / len, z: -PROJECTION_DISTANCE_PX / len };
  const m = CameraBlockViewToWorld(G.g_camera_index);
  const origin = { x: 0, y: 0, z: 0 };
  MatrixTransformPoint(m, { x: 0, y: 0, z: 0 }, origin);
  const dir = { x: 0, y: 0, z: 0 };
  MatrixTransformVector(m, view, dir);
  return { origin, dir };
}

/**
 * Put one trigger pull on the queue.
 *
 * `[port-only]`. The engine has no queue: `BuildShotRay` (`FUN_00406110`)
 * writes the per-player shot record straight from the gun hardware and the
 * game loop reads it on the same frame. Here the click arrives on a DOM event
 * with no game frame around it, so the intent is recorded and the frame
 * consumes it — which is also what makes it recordable.
 */
export function QueueShotRequest(player: number, ray: ShotRay): void {
  G.g_shot_requests.push({
    player,
    frame: Math.round(G.g_frame),
    ray: {
      origin: { x: ray.origin.x, y: ray.origin.y, z: ray.origin.z },
      dir: { x: ray.dir.x, y: ray.dir.y, z: ray.dir.z },
    },
    onScreen: 1,
  });
}

/**
 * Put one trigger pull **outside the screen** on the queue.
 *
 * `[port-only]` as a queue entry, like {@link QueueShotRequest}; what it
 * stands for is the engine's. On PC the mouse is a gun
 * (`InputMapDevicesToMaple`, `FUN_0041E530`, input modes 5 and 6), its right
 * button raises `g_mouse_gun_offscreen_pull` (`0x007DB7C8`), and
 * `MouseGunResolvePull` (`FUN_0041EB30`) turns that into a shot at
 * `(0xFFFF, 0xFFFF)` -- a pull with the aim off the screen. The gun arm of
 * `PlayerFireAndReloadUpdate` (`FUN_00414940`) fires nothing for it and
 * refills the magazine instead, which is the only way a gun reloads: the
 * gun's binding set in `g_input_bindings_default` (`0x004C42A8`) has no reload
 * bit. The ray is never built, so it is left at the origin.
 */
export function QueueOffscreenPull(player: number): void {
  G.g_shot_requests.push({
    player,
    frame: Math.round(G.g_frame),
    ray: { origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: -1 } },
    onScreen: 0,
  });
}

/**
 * Whether a trigger pull of `player` falls due this frame.
 *
 * `[port-only]` -- the engine polls a trigger bit (`+0x14` of the aim record,
 * `g_trigger_down`); the port's trigger is the queue, so the bit is derived
 * from it once a frame before the player tasks run.
 */
export function ShotRequestDue(player: number): boolean {
  const now = Math.round(G.g_frame);
  return G.g_shot_requests.some((r) => r.player === player && r.frame <= now);
}

/**
 * The first of `player`'s pulls that falls due this frame, or null.
 *
 * `[port-only]` -- what the engine's `PollPlayerAimInput` (`FUN_0040CBB0`)
 * would have read off the device this frame: whether the trigger is down,
 * and whether the aim is on the screen.
 */
export function FirstDueShotRequest(player: number): ShotRequest | null {
  const now = Math.round(G.g_frame);
  return G.g_shot_requests.find((r) => r.player === player && r.frame <= now)
    ?? null;
}

/**
 * Take `player`'s due trigger pulls off the queue, in the order they were
 * made.
 *
 * `[port-only]` -- the loop around the engine's per-frame trigger poll, which
 * has no queue to drain. `PlayerFireAndReloadUpdate` (`FUN_00414940`) runs its
 * trigger block once for each, so a click and an off-screen pull made on the
 * same frame -- a harness's volley with its reloads between -- land in order.
 * **Only the player's own task calls it**, from `PlayerUpdateInPlay`
 * (`FUN_00413E90`) while it has a life, or `PlayerStateFireOnly`
 * (`FUN_00414740`): a player out of lives, in the continue countdown or out
 * of the game does not fire at all, which is the engine's shape.
 *
 * **`req.frame` is read, which is what makes the queue a log rather than a
 * list.** A request is resolved on the frame it was pulled on, or on the first
 * frame after it. Live play never exercises the second half -- a click arrives
 * on a DOM event and is stamped with the current `g_frame`, so it is always due
 * -- but a replay feeds the log in ahead of the clock, and this is the line
 * that makes the shots land where they landed rather than all at once on the
 * frame the log was loaded.
 */
export function TakeDueShotRequests(player: number): ShotRequest[] {
  const queued = G.g_shot_requests;
  if (!queued.length) return [];
  const now = Math.round(G.g_frame);
  const due = queued.filter((r) => r.player === player && r.frame <= now);
  if (due.length) G.g_shot_requests = queued.filter((r) => !due.includes(r));
  return due;
}

/**
 * `[port-only]` -- the pulls no player's task took this frame are gone: the
 * engine polls the trigger once a frame and a poll nobody makes is simply a
 * frame in which nothing happened. A queue that kept them would fire them the
 * moment the player came back into play, which the engine never does.
 */
export function DropDueShotRequests(): void {
  const now = Math.round(G.g_frame);
  G.g_shot_requests = G.g_shot_requests.filter((r) => r.frame > now);
}

/**
 * `[port-only]` The nearer of the two picks a trigger pull gets.
 *
 * The engine has one candidate list and one sort, `MarkActorShot`
 * (`FUN_00404DB0`)'s, keyed on each candidate's view-space depth. The port
 * has that list for the classes that register the engine's way
 * (`combat/shot_test.ts`, which sorts it exactly) and `render/`'s own pick for
 * the rest, which answers with the nearest thing by distance along the ray.
 *
 * [diverges] Between the two, the nearer **along the ray** wins, which is the
 * order `render/` has always merged its own sources in. The engine would
 * compare `__ftol(-z * 10)` depths and break ties by registration order, so
 * two candidates within a tenth of a unit of the same depth, one from each
 * side, can land differently. The rule goes when the last class is converted
 * -- see `docs/formats/combat.md`, "The shot test", for what that takes.
 */
export function MergeShotPicks(picked: ShotPick | null,
                               registered: ShotCandidate | null):
                               ShotPick | null {
  if (!registered) return picked;
  if (picked && (picked.t ?? Infinity) <= registered.t) return picked;
  const radius = registered.radius !== undefined
    ? { radius: registered.radius } : {};
  if (registered.thrown !== undefined) {
    return { kind: "thrown", thrownId: registered.thrown,
             point: registered.point, t: registered.t, ...radius };
  }
  if (registered.prop !== undefined) {
    return { kind: "prop", propId: registered.prop, point: registered.point,
             ...(registered.mesh ? { mesh: registered.mesh } : {}),
             t: registered.t, ...radius };
  }
  return { kind: "actor", at: registered.at, bone: registered.bone,
           whole: registered.whole, point: registered.point,
           ...(registered.mesh ? { mesh: registered.mesh } : {}),
           t: registered.t, ...radius };
}

/**
 * One shot, from `BuildShotRay` to the score -- the fire block of
 * `PlayerFireAndReloadUpdate` (`FUN_00414940`) from its `g_nPlayerFired` on,
 * and what `ProcessPlayerShots` (`FUN_00404570`) then does with the ray.
 * `[port-only]` as a function; its caller has already taken the round and
 * passed the firing gate, and every line inside is transcribed.
 *
 * ## The firing gate, and the magazine, are the caller's
 *
 * `PlayerFireAndReloadUpdate` is shaped
 *
 * ```c
 * if (trigger) {
 *   if (!on_screen || ammo == 0) { a gun off the screen reloads }
 *   else if (g_nFiringGate != 0) { ammo--; fired; shots++; BuildShotRay();
 *                                  PlayerShotEffectSpawn(); gunshot(); }
 * }
 * ```
 *
 * so a trigger pulled while the gate is down does **nothing at all** — no
 * round, no shot counter, no `BuildShotRay`, no `PlayerShotEffectSpawn`, which
 * is why a shutter that is closed for a cutscene produces no muzzle flash and
 * no tracer either -- and a trigger pulled on an empty gun does nothing either.
 * Both tests are in `game/player_gun.ts` now, where the routine is.
 */
export function FireShotRequest(req: ShotRequest, host: GameHost, rng: Rng,
                                events?: Events,
                                gunshot: number =
                                  g_gunshot_sound_ids[req.player] ?? 0): void {
  const player = req.player;
  // `g_crosshair_x/y`, as the ray `BuildShotRay` makes of them -- see
  // `G.g_crosshair_ray`.
  G.g_crosshair_ray[player] = {
    origin: { ...req.ray.origin }, dir: { ...req.ray.dir } };
  // `g_nPlayerFired[p] = 1`, then the accuracy denominator unless the boss
  // block has suppressed it: `CMP word [0x009a5c48], 0` / `INC` at
  // `0x00414A15` (`0x00414CC5` in the Original twin, which calls this too).
  G.g_nPlayerFired[player] = 1;
  if (G.g_accuracy_stats_suppressed === 0) G.g_player_shot_count[player] += 1;
  // **The muzzle flash and the round leave the gun before anything is tested.**
  // `PlayerFireAndReloadUpdate` (`FUN_00414940`) spawns them at the trigger,
  // between `BuildShotRay` and the gunshot sound, and `ProcessPlayerShots`
  // runs afterwards; so a shot that hits nothing still throws a tracer.
  PlayerShotEffectSpawn(player, req.ray, host, () => rng.int(0x10000));
  // ...and the gunshot is the line after it, which is where this one is. The
  // whole of `PlayerFireAndReloadUpdate`'s tail is `BuildShotRay`,
  // `PlayerShotEffectSpawn`, `PlaySoundId(g_gunshot_sound_ids[player])`, in
  // that order. The Original Mode twin picks its own id first, which is why
  // the caller hands it in.
  events?.emit("sound.play", { id: gunshot });
  // Two answers to one question: the classes that register the engine's way,
  // through `g_shot_test_list`, and everything else through `render/`.
  const pick = MergeShotPicks(host.pickShot?.(req.ray) ?? null,
                              ProcessPlayerShotsTestList(req.ray, host));
  // `ProcessPlayerShots` writes the fired flag back to 0 once the shot is
  // tested, before `MarkActorShot` (`FUN_00404570`, `*piVar1 = 0`).
  G.g_nPlayerFired[player] = 0;
  // `g_shot_hit_something` — 0x009C9010, written by `ProcessPlayerShots`
  // (`FUN_00404570`) as `count > 0`. Its one reader kills the tracer on its
  // second frame, which is what makes a hit a stub of streak and a miss a
  // full second of one.
  G.g_shot_hit_something[player] = pick ? 1 : 0;

  if (!pick) {
    // A miss resets nothing -- the game only clears the head combo on a hit
    // that is not a head.
    const world = ShotHitWorld(req, host, events);
    if (world) {
      MarkActorShotBlast(player, { x: G.g_coli_hit_x, y: G.g_coli_hit_y,
                                   z: G.g_coli_hit_z }, undefined, host,
                         events);
    }
    events?.emit("shot.resolved", {
      player, kind: "miss", ray: req.ray, points: 0,
      point: world ? { x: G.g_coli_hit_x, y: G.g_coli_hit_y,
                       z: G.g_coli_hit_z } : undefined,
      surface: world ? G.g_coli_hit_surface : undefined,
    });
    return;
  }
  if (pick.kind === "prop") return ResolveShotOnProp(req, pick, host, events);
  if (pick.kind === "creature") {
    // `MarkActorShot` and nothing else: the score, the sound and the blood
    // are `BodyCreatureUpdate`'s, on the next frame, which is where the
    // engine puts them. See `game/body_creature.ts`. No head-combo reset
    // either -- `BodyCreatureUpdate` (`FUN_0043E880`) pays and counts the hit
    // and never touches `g_head_combo_bonus`.
    const c = G.g_body_creatures.find((x) => x.id === pick.creatureId);
    if (!c) {
      events?.emit("shot.resolved", { player, kind: "miss", ray: req.ray,
                                      points: 0 });
      return;
    }
    MarkBodyCreatureShot(c, player);
    MarkActorShotBlast(player, pick.point, pick.radius, host, events);
    events?.emit("shot.resolved", {
      player, kind: "marked", ray: req.ray, point: pick.point, points: 0,
    });
    return;
  }

  if (pick.kind === "carried") {
    // `MarkActorShot` and nothing else, as for the creature: what the hit
    // costs the prop is `CarriedPropCheckShot`'s, on its next update. No head
    // combo reset -- that is `ResolveHit`'s, and a prop never reaches it.
    const c = G.g_carried_props.find((x) => x.id === pick.carriedId);
    if (c) {
      MarkCarriedPropShot(c, player);
      MarkActorShotBlast(player, pick.point, pick.radius, host, events);
    }
    events?.emit("shot.resolved", {
      player, kind: c ? "marked" : "miss", ray: req.ray,
      point: c ? pick.point : undefined, points: 0,
    });
    return;
  }

  if (pick.kind === "thrown") {
    // `MarkActorShot` and nothing else. What being hit does to a thrown
    // weapon -- the spark, the ricochet, the permit given back, the hit
    // counted -- is its own routine's, on its next update: `ThrownWeaponUpdate`
    // (`FUN_00450780`) or `ZombieThrownWeaponUpdate` (`FUN_0045A4F0`). No
    // score and no head-combo reset, both of which are `ResolveHit`'s.
    const w = G.g_thrown_weapons.find((x) => x.id === pick.thrownId);
    if (w) {
      MarkThrownWeaponShot(w, player);
      MarkActorShotBlast(player, pick.point, pick.radius, host, events);
    }
    events?.emit("shot.resolved", {
      player, kind: w ? "marked" : "miss", ray: req.ray,
      point: w ? pick.point : undefined, points: 0,
    });
    return;
  }

  const obj = ActorByAt(pick.at);
  if (!obj) {
    events?.emit("shot.resolved", { player, kind: "miss", ray: req.ray,
                                    points: 0 });
    return;
  }

  // A class that reads `obj+0x34` bit 3 itself takes the shot as the engine
  // delivers it -- marked, and nothing else. `CivilianUpdate` is what a hit on
  // a civilian *means*: a life, two hundred points and the on-shot script.
  // Scoring it here would be a second implementation of that rule.
  //
  // **The head combo is the class's too.** `MarkActorShot` does not write
  // `g_head_combo_bonus`, and of the nineteen owning classes only three
  // routines do: `CivilianUpdate`, `OneHitTargetUpdate` and
  // `RescueTargetHeldState` (classes 0x10, 0x20, 0x21), each in its own
  // update and each ported there. A pull on class 0x12's boarded door, an
  // owl, a bat or a boss leaves it as it was.
  if (g_class_handlers[obj.cls as SpawnClass]?.ownsShotResult) {
    MarkActorShot(obj, player, pick.bone, pick.whole ?? false,
                  pick.mesh ? { point: pick.point, ...pick.mesh } : undefined,
                  host, events);
    MarkActorShotBlast(player, pick.point,
                       pick.mesh ? undefined : pick.radius, host, events);
    events?.emit("shot.resolved", {
      player, kind: "marked", ray: req.ray, point: pick.point,
      at: obj.at, bone: pick.bone, who: obj.name, charType: obj.charType,
      points: 0,
    });
    return;
  }

  // A bone hit on its collision mesh -- class 0x30's weapon hands -- first
  // gets what `MarkActorShot` (`FUN_00404DB0`) gives one at the moment of the
  // shot, before the class drains it: `SpawnWorldImpact` (`FUN_00405260`) on
  // the winning quad, the spark of that surface's kind. The owning classes
  // above get it inside their `MarkActorShot`.
  if (pick.mesh) {
    SpawnWorldImpact(player, pick.point, pick.mesh.normal, pick.mesh.surface,
                     host, events);
  }
  MarkActorShotBlast(player, pick.point, pick.mesh ? undefined : pick.radius,
                     host, events);
  // Through `DispatchHit` (`FUN_004092F0`) and never straight into
  // `ResolveHit`: the engine has exactly one call to the damage tables and it
  // is behind the shot-immune gate. `null` is that refusal, and it is a
  // **ricochet**, not a miss — the shot marked the actor, so the feedback
  // routine still runs, with the result the class's own copy forces.
  const out = DispatchHit(obj, pick.bone, host, rng, player);
  if (!out) {
    // `ThrowerShotFeedback` (`FUN_00449B20`) opens
    // `if (obj+0x34 & 0x100) g_hit_result[p] = 5;` — class 0x31's own copy of
    // `ActorShotFeedback`, and the only routine in the image that says what a
    // refused hit reports.
    //
    // [diverges] `ZombieOnShot` (`FUN_00453EB0`) reaches the shared
    // `ActorShotFeedback` with `g_hit_result` **left over from the last
    // resolved hit**, because `DispatchHit` writes the bone and not the
    // result. The port has one merged feedback call site (see
    // `combat/feedback.ts`) and will not model an uninitialised read: every
    // class gets class 0x31's answer, which is the ricochet the player
    // already sees and hears off a downed body.
    G.g_hit_result = HitResultCode.NoEffect;
    ActorShotFeedback(obj, pick.bone, pick.point, host, rng, events);
    // No `ScoreAddForPlayer` and no `g_head_combo_bonus`: both of those are
    // inside `ResolveHit`, which did not run.
    events?.emit("shot.resolved", {
      player, kind: "actor", ray: req.ray, point: pick.point,
      at: obj.at, bone: pick.bone, who: obj.name, charType: obj.charType,
      head: false, killed: false, damage: 0, hp: Math.max(0, obj.hp),
      result: HitResultCode.NoEffect, severed: false, gore: false, points: 0,
    });
    return;
  }
  // `ActorShotFeedback` (`FUN_00454050`) — the blood, the ricochet sprite and
  // the ricochet sound, all of which read `g_hit_result`, so it runs after
  // `ResolveHit` has written it. See `combat/feedback.ts` for why it is here
  // rather than in each class's own on-shot routine.
  G.g_hit_result = out.result;
  ActorShotFeedback(obj, pick.bone, pick.point, host, rng, events);
  // The score, the head combo and the hit count are `ResolveHit`'s own tail
  // (`0x004097D7`), paid inside the call above; `out.points` is what it paid.
  const points = out.points;

  events?.emit("shot.resolved", {
    player, kind: "actor", ray: req.ray, point: pick.point,
    at: obj.at, bone: pick.bone, who: obj.name, charType: obj.charType,
    head: out.head, killed: out.killed, damage: out.damage, hp: out.hp,
    result: out.result, severed: out.severed, gore: out.gore,
    react: out.react, death: out.death, points,
  });
}

/**
 * A shot that landed on a breakable prop.
 *
 * All this does is set the hit bits, because that is all the engine's shot
 * test does: `BreakablePropUpdate` reads `obj+0x34` on its next frame and is
 * what cracks the prop, pays the ten points through `BreakablePropAwardHit`
 * and releases whatever it was hiding.
 */
function ResolveShotOnProp(req: ShotRequest,
                           pick: { propId: number; point: Vec3;
                                   mesh?: { surface: number; normal: Vec3 } },
                           host: GameHost, events?: Events): void {
  const prop = G.g_breakable_props.find((p) => p.id === pick.propId);
  if (!prop) return;
  BreakablePropTakeShot(prop, req.player);
  // A mesh candidate (`ShotPushMeshObjectCandidate`, `FUN_00404B50`: the
  // object's word with `0x50` raised) takes `MarkActorShot`'s whole-object
  // arm and then, for the `0x10`, `SpawnWorldImpact` (`FUN_00405260`) at the
  // quad, and GRENADE's blast at the hit point -- the order an actor's mesh
  // hit takes them in.
  if (pick.mesh) {
    SpawnWorldImpact(req.player, pick.point, pick.mesh.normal,
                     pick.mesh.surface, host, events);
    MarkActorShotBlast(req.player, pick.point, undefined, host, events);
  }
  // `SpawnPropHitSpark` (`FUN_00465860`): the crosshair unprojected to the
  // prop's own camera depth, with `z` then replaced by the prop's `+0x1A4`.
  // The prop routines call it themselves on the frame they read the hit bit;
  // it is here because the port's props do not each carry a shot response.
  // [diverges] in where it is called from, not in what it does.
  const spark = PropSparkPoint(prop, req.ray, host);
  prop.hitAim = spark ? { x: spark.x, y: spark.y } : null;
  // Types 38, 39, 40 and 44 call no `SpawnPropHitSpark` at all -- the first
  // three and 44 call `SpawnPropHitEffectScaled` from their own hit arm with
  // the point above, and 40 calls neither -- so the stand-in stays off them.
  // So does every routine transcribed whole: one that records its own draws
  // (`class41/prop_draw.ts`) also makes its own hit effect, where and if its
  // routine makes one, from the point left on the prop here.
  // Nor does it reach the group props: `BreakablePropUpdate` sparks from its
  // own crack and destroy arms (`0x00464781`, `0x00464877`), so a shot its
  // hit gate refuses -- group 4, scene 1's held block -- sparks nothing.
  if (spark && !NO_PROP_SPARK.has(prop.family) && prop.draws === null
      && prop.family !== PropFamily.Group) {
    SpawnPropHitSpark(spark.x, spark.y, prop.z);
  }
  events?.emit("shot.resolved", {
    player: req.player, kind: "prop", ray: req.ray, point: pick.point,
    propGroup: prop.group, propMember: prop.member, propHp: prop.hp,
    points: 0,
  });
}

/**
 * `MarkActorShot` — `FUN_00404DB0`.
 *
 * `obj+0x34 |= (1 << (player + 1)) | 8`. Bit 3 says a hit is pending; bits 1
 * and 2 say which player fired, and the class reads them back to decide who
 * pays. `obj+0x190 + player` also takes the bone, which is why the same
 * function serves the skeleton path.
 *
 * **A bone hit on a collision mesh** (`mesh`, the bone record's `+0x74` bit
 * `0x10`) goes on to `SpawnWorldImpact` (`FUN_00405260`) with the winning
 * quad -- the `CALL` at the end of the bone arm -- which spawns the impact
 * sprite of that surface's kind and leaves the point, surface and normal in
 * `g_shot_hit_records[player]`. The stage-4 boss has such bones, and its
 * `Boss4ResolveShot` reads the record back; so do class 0x30's weapon hands,
 * which do not come through here (`ResolveShot` spawns their impact).
 *
 * Its last arm, Original Mode's GRENADE blast, is {@link MarkActorShotBlast}.
 *
 * [diverges] The bone arm also ORs the shooter bit and `8` into the bone
 * record's `+0x74` (`0x00404E21`); the port's bone records keep no such word.
 */
export function MarkActorShot(obj: Actor, player: number, bone = 0,
                              whole = false,
                              mesh?: { point: Vec3; surface: number;
                                       normal: Vec3 },
                              host?: GameHost, events?: Events): void {
  obj.flags |= (1 << ((player + 1) & 0x1f)) | ActorFlag.Hit;
  obj.pendingHit = { bone, result: 0 };
  // `MOV byte ptr [ECX + EAX + 0x190], ...` -- the bone's own index for a
  // bone hit (the node's `+0x14`), and a literal 1 for an actor hit whole.
  if (player >= 0 && player < obj.shotBones.length) {
    obj.shotBones[player] = whole ? 1 : bone;
    // `[port-only]` The pull that wrote the byte -- see `Actor.shotRays`.
    obj.shotRays[player] = G.g_crosshair_ray[player] ?? null;
  }
  if (mesh && host) {
    SpawnWorldImpact(player, mesh.point, mesh.normal, mesh.surface, host,
                     events);
  }
}

/**
 * `MarkActorShot`'s last arm, `0x00404E87`..`0x00404F52`: in Original Mode,
 * a hit with weapon kind 3 -- GRENADE -- throws sprite effect 0x53, the blast,
 * `SpawnSpriteEffect(&at, 0x53, -1, player)` at `0x00404F43`.
 *
 * Where depends on the winning candidate's flags (`+0x2C`):
 *
 * * **Bit `0x10`**, a collision-mesh hit -- a bone's, a mesh object's or the
 *   world's -- takes the hit point itself, the candidate's `+0x00..0x08`.
 *   `radius` is `undefined` for these.
 * * **Anything else** is a sphere, and the candidate's `+0x0C..0x14` is its
 *   centre in view space (`obj+0x70..0x78`, `ShotTestSphere`'s `0x004046B3`;
 *   `rec+0x68..0x70` for a bone). The routine adds `radius - 1.0` to the
 *   depth (`FLD` the radius, `FSUB [0x004C4380]`, `FADD` z, at `0x00404EED`)
 *   -- the radius it wrote into its own argument slot from `obj+0x124` or
 *   `rec+0x78` -- and takes the point back to the world through
 *   `g_camera_blocks[g_camera_index]` (`0x009A6040`, view to world). So the
 *   blast sits on the sphere's near side, a unit inside it.
 *
 * The facing is `-1`, a full billboard, which overwrites the two angles
 * before anything reads them; the routine leaves them as stack garbage.
 *
 * `[port-only]` as a function of its own. The engine runs this arm once, for
 * the one winning candidate, inside `MarkActorShot`; the port reaches that
 * routine's equivalent along one path per kind of pick, and each calls this
 * where `MarkActorShot` would have reached it -- after the world impact.
 * A breakable prop's sphere pick (`render/`'s) carries no radius, since which
 * arm the engine's candidate for one takes is `[open]`, and so throws no
 * blast; a prop shot through its mesh is a bit-`0x10` candidate and takes
 * the hit-point arm, as any mesh hit does.
 */
function MarkActorShotBlast(player: number, point: Vec3,
                            radius: number | undefined, host?: GameHost,
                            events?: Events): void {
  if (G.g_GameMode !== GameMode.Original) return;
  if (G.g_original_weapon_kind[player] !== OriginalWeaponKind.Grenade) return;
  const at = vec3(point.x, point.y, point.z);
  if (radius !== undefined) {
    const v = vec3();
    if (!host?.viewSpaceOfPoint?.(point, v)) return;
    v.z = (Math.fround(radius) - 1.0) + v.z;
    MatrixTransformPoint(CameraBlockViewToWorld(G.g_camera_index), v, at);
  }
  SpawnSpriteEffect(at, 0, 0, SpriteEffectKind.OriginalBlast, -1, player,
                    host, events);
}

/**
 * A shot that found no candidate at all — `FUN_00404B80`'s pass, and then
 * `SpawnWorldImpact` (`FUN_00405260`).
 *
 * `[port-only]` as a wrapper; both halves inside it are transcribed. The
 * engine traces the shot segment against every blob in the two script-selected
 * collision sets **from the far end back toward the eye**, which is the
 * argument order that makes the nearest wall to the camera win, and takes the
 * material, the point and the normal from what it hit.
 *
 * `render/shooting.ts` used to answer this by raycasting the drawn geometry
 * and calling every surface material 3, because there was no collision in the
 * bundle. There is now.
 *
 * [diverges] **The engine does not wait for a miss.** `ProcessPlayerShots`
 * (`FUN_00404570`) calls `ShotTestWorld` (`FUN_00404B80`) on every trigger
 * pull, after the objects, and each blob it hits is pushed into the same
 * candidate list (`0x00404C80`: flags `0x10`, no object, key
 * `__ftol(-z * 10)` of the hit point). The sort then decides, and a wall
 * nearer than the zombie behind it wins: `MarkActorShot` sees flag `0x10`
 * without `0x40`, marks nobody, and throws the impact. Here the world is
 * traced only when nothing was picked, so a shot through a wall still finds
 * what is behind it. It is also traced against the moving objects' blobs,
 * which the engine reaches through `ShotTestMesh` from the registration list
 * instead. Folding the world into the one sort is part of converting the
 * remaining classes -- see `docs/formats/combat.md`, "The shot test".
 */
function ShotHitWorld(req: ShotRequest, host: GameHost,
                      events?: Events): boolean {
  const o = req.ray.origin;
  const d = req.ray.dir;
  const fx = o.x + d.x * SHOT_RANGE;
  const fy = o.y + d.y * SHOT_RANGE;
  const fz = o.z + d.z * SHOT_RANGE;
  if (!ColiTraceSegmentAllSets(fx, fy, fz, o.x, o.y, o.z)) return false;
  SpawnWorldImpact(req.player,
                   { x: G.g_coli_hit_x, y: G.g_coli_hit_y, z: G.g_coli_hit_z },
                   { x: G.g_coli_hit_normal[0], y: G.g_coli_hit_normal[1],
                     z: G.g_coli_hit_normal[2] },
                   G.g_coli_hit_surface, host, events);
  return true;
}

/** `ShotBuildSegment` (`FUN_00404AD0`) — origin plus direction times this. */
const SHOT_RANGE = 1000;

/**
 * Where `SpawnPropHitSpark` puts its spark: the point on this shot's own ray
 * at the prop's camera-space depth.
 *
 * `[port-only]` in spelling. The engine has the crosshair in pixels and the
 * depth in `obj+0x78`, and divides one by `g_projection_distance_px`; the two
 * together are the same point on the same line. `z` is not taken from here —
 * the routine overwrites it with the prop's own field.
 */
function PropSparkPoint(prop: { shotX: number; shotY: number; shotZ: number },
                        ray: ShotRay, host: GameHost):
                        { x: number; y: number } | null {
  const a = { x: 0, y: 0, z: 0 };
  const b = { x: 0, y: 0, z: 0 };
  const p = { x: 0, y: 0, z: 0 };
  if (!host.viewSpaceOfPoint?.(ray.origin, a)) return null;
  if (!host.viewSpaceOfPoint?.(
        { x: ray.origin.x + ray.dir.x, y: ray.origin.y + ray.dir.y,
          z: ray.origin.z + ray.dir.z }, b)) return null;
  if (!host.viewSpaceOfPoint?.(
        { x: prop.shotX, y: prop.shotY, z: prop.shotZ }, p)) return null;
  const dz = b.z - a.z;
  if (dz === 0) return null;
  const t = (p.z - a.z) / dz;
  return { x: ray.origin.x + ray.dir.x * t, y: ray.origin.y + ray.dir.y * t };
}
