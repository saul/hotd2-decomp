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
 * `g_shot_requests`, and `ProcessShotRequests` drains it at the head of
 * `GameUpdate`. That is the shape the engine already has — `BuildShotRay`
 * (`FUN_00406110`) writes the per-player shot record and the game loop reads
 * it — and it buys the thing the plan has wanted since the beginning: the
 * queue **is** an input log: it is plain data in the snapshot, so recording it
 * per frame gives a session that can be replayed. What is *not* here yet is
 * the other half of that — a `pickShot` a headless run can answer, which needs
 * the skeleton's forward kinematics in `game/`. See
 * docs/PLAYER_ARCHITECTURE.md, "Input intent".
 *
 * ## What a bullet does
 *
 * `ShotTestSphere` (`FUN_00404630`) is the fork. It tests a sphere at the
 * actor's registered point with radius `obj+0x124`, and only descends into the
 * skeleton — `ShotTestSkeleton` (`FUN_00404700`) — when `obj+0x34` bit `0x80`
 * is set and the character has bones. A class-0x10 civilian never has that bit:
 * none of the 136 command streams raises it. So a civilian is a ten-unit ball
 * with no hit table, no damage and no gore, and the hit does not go through
 * `ResolveHit` at all.
 *
 * What it goes through instead is this: the sort picks the nearest candidate
 * and marks it, and the actor's own update decides what being marked means.
 * For a civilian that is a life, two hundred points and the on-shot script.
 *
 * ## The score, from `FUN_00409430`
 *
 * ```
 * any hit not on the head     +10
 * a hit on bone 2, the head   +120, then a per-player combo that grows by 10
 * HP reaching zero            +80
 * ```
 *
 * The head combo is added *before* it increments, so consecutive headshots pay
 * 120, 130, 140 …, and **any non-head hit resets it to zero**. That reset is
 * the whole reason the counter exists, so it is reproduced exactly. It lives
 * in `g_head_combo_bonus`, which `ResetSceneOnEnter` zeroes; a second private
 * copy in `render/shooting.ts` used to shadow it, and only one of the two was
 * ever in a snapshot.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { ActorFlag, type Actor } from "../actor";
import { MarkBodyCreatureShot } from "../body_creature";
import { BreakablePropTakeShot } from "../class41/prop";
import { ColiTraceSegmentAllSets } from "../coli";
import { PlayerShotEffectSpawn } from "../effects/shot_effects";
import { SpawnPropHitSpark } from "../effects/sprite";
import { ActorShotFeedback, SpawnWorldImpact } from "./feedback";
import { ActorByAt, G } from "../globals";
import type { GameHost, ShotRay } from "../host";
import { g_class_handlers } from "../registry";
import type { SpawnClass } from "../spawn_class";
import { DispatchHit, HitResultCode } from "./resolve_hit";
import { ScoreAddForPlayer } from "./score";

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
 * to this table when that entry is zero. `ResetOriginalModeLoadout`
 * (`FUN_0048A0D0`) writes that index 0, entry 0 of the weapon table is 0, and
 * no instruction in the image writes `0x009A224A` — so on the reading so far
 * every gunshot in the shipped game is one of these two. The weapon table is
 * therefore not ported.
 */
export const g_gunshot_sound_ids: readonly number[] = [0x003416a9, 0x003316a9];

/** `ScoreAddForPlayer` constants, from `FUN_00409430`. */
const SCORE_HIT = 10;
const SCORE_HEAD = 120;
const SCORE_HEAD_COMBO_STEP = 10;
const SCORE_KILL = 80;

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
  });
}

/**
 * The yaw the directional death compares against.
 *
 * `FUN_00403AC0` builds the game's camera yaw from `eye - target`, so it is
 * the camera's own local **+Z** — its backward axis, not its forward one.
 * `g_camera_yaw_bams` as the port fills it is the *forward* axis, because
 * `CameraFrame.place` takes it from `getWorldDirection`, and class 0x31's leap
 * aside reads it that way. The two are half a turn apart and which of them the
 * engine's single global really holds is `[open]`, so the port keeps both
 * readings rather than quietly merging them; this is the one the death picker
 * has always been handed. `ChooseDeathMotionDirectional` masks to 16 bits, so
 * the unwrapped sum is fine.
 */
function CameraBackYawBams(): number {
  return G.g_camera_yaw_bams + 0x8000;
}

/**
 * Drain the shot queue.
 *
 * `[port-only]` — the loop around the engine's per-frame shot test, which has
 * no queue to drain. Everything inside it is transcribed.
 *
 * The queue is taken and replaced rather than shifted, so a class that fires
 * during its own update (nothing does yet) queues for the next frame instead
 * of extending this one.
 */
export function ProcessShotRequests(host: GameHost, rng: Rng,
                                    events?: Events): void {
  const queued = G.g_shot_requests;
  if (!queued.length) return;
  // **`req.frame` is read, which is what makes the queue a log rather than a
  // list.** It was written on every request and consulted by nothing, so the
  // claim that recording the queue per frame gives an input log for free was
  // half true: the data was there and no code path could re-time to it.
  //
  // A request is resolved on the frame it was pulled on, or on the first frame
  // after it. Live play never exercises the second half — a click arrives on a
  // DOM event and is stamped with the current `g_frame`, so it is always due —
  // but a replay feeds the log in ahead of the clock, and this is the line
  // that makes the shots land where they landed rather than all at once on the
  // frame the log was loaded.
  const now = Math.round(G.g_frame);
  const due = queued.filter((r) => r.frame <= now);
  G.g_shot_requests = queued.filter((r) => r.frame > now);
  for (const req of due) ResolveShotRequest(req, host, rng, events);
}

/**
 * One request, from segment to score. `[port-only]` — see above.
 *
 * ## The firing gate is the first thing it asks
 *
 * `PlayerFireAndReloadUpdate` (`FUN_00414940`) is shaped
 *
 * ```c
 * if (trigger_latch) {
 *   if (magazine empty)          { auto-refill }
 *   else if (g_nFiringGate != 0) { ammo--; shots++; BuildShotRay();
 *                                  PlayerShotEffectSpawn(); gunshot(); }
 * }
 * ```
 *
 * so a trigger pulled while the gate is down does **nothing at all** — it
 * returns before the ammo decrement, before the shot counter, before
 * `BuildShotRay` and before `PlayerShotEffectSpawn`, which is why a shutter
 * that is closed for a cutscene produces no muzzle flash and no tracer either.
 * That distinction is the whole behaviour, so the test is here, above
 * `g_nPlayerFired` and above the effect spawn, and not at the pointer.
 *
 * The request is **dropped**, not held: the engine polls the trigger once a
 * frame and a blocked poll is simply a frame in which nothing happened. A
 * queue that saved the click for later would fire it when the shutter opened,
 * which the engine never does. `ProcessShotRequests` has already taken every
 * due request off the queue by the time this runs, so returning is the drop.
 *
 * What is **not** gated, because the engine does not gate it: reloading. Both
 * the auto-refill-when-empty path and the reload button run with the gate
 * down, and only `PlayerRefillMagazine`'s sound is held back (`0x00414B75`).
 * The port has no ammo and no magazine, so there is nothing here to exempt —
 * see `docs/PLAYER_PROGRESS.md`.
 */
function ResolveShotRequest(req: ShotRequest, host: GameHost, rng: Rng,
                            events?: Events): void {
  const player = req.player;
  // `g_nFiringGate` — `0x009C8E00`. The test is at 0x004149BE in the arcade
  // routine and at 0x00414C2D in the Original Mode twin at 0x00414B90, which
  // is the same shape with a per-weapon magazine and a recoil spread.
  if (G.g_nFiringGate === 0) return;
  // `g_nPlayerFired` — the accuracy denominator. Counted here rather than
  // where the click landed, so it counts shots the *game* saw.
  G.g_nPlayerFired[player] = (G.g_nPlayerFired[player] ?? 0) + 1;
  // **The muzzle flash and the round leave the gun before anything is tested.**
  // `PlayerFireAndReloadUpdate` (`FUN_00414940`) spawns them at the trigger,
  // between `BuildShotRay` and the gunshot sound, and `ProcessPlayerShots`
  // runs afterwards; so a shot that hits nothing still throws a tracer.
  PlayerShotEffectSpawn(player, req.ray, host, () => rng.int(0x10000));
  // ...and the gunshot is the line after it, which is where this one is. The
  // whole of `PlayerFireAndReloadUpdate`'s tail is `BuildShotRay`,
  // `PlayerShotEffectSpawn`, `PlaySoundId(g_gunshot_sound_ids[player])`, in
  // that order, and the port had the first two.
  //
  // [diverges] The engine reaches that line only with a round in the magazine
  // and `g_nFiringGate` open, and plays nothing at all on a dry trigger — the
  // empty magazine goes to `PlayerRefillMagazine` (`FUN_00414B30`) and its
  // `0x3E16A9` `COMMON\RELOAD1_44.WAV` instead. The port has neither ammo nor
  // the gate (`g_player_ammo` and `g_nFiringGate` are both listed as absent in
  // `globals.ts`), so every request that reaches here fires. That is the same
  // divergence `PlayerShotEffectSpawn` on the line above already carries, and
  // not a second one: the reload sound has nowhere to be played from until the
  // magazine is ported. [open]
  events?.emit("sound.play", { id: g_gunshot_sound_ids[player] ?? 0 });
  const pick = host.pickShot?.(req.ray) ?? null;
  // `g_shot_hit_something` — 0x009C9010, written by `ProcessPlayerShots`
  // (`FUN_00404570`) as `count > 0`. Its one reader kills the tracer on its
  // second frame, which is what makes a hit a stub of streak and a miss a
  // full second of one.
  G.g_shot_hit_something[player] = pick ? 1 : 0;

  if (!pick) {
    // A miss resets nothing -- the game only clears the head combo on a hit
    // that is not a head.
    const world = ShotHitWorld(req, host, events);
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
    // engine puts them. See `game/body_creature.ts`.
    const c = G.g_body_creatures.find((x) => x.id === pick.creatureId);
    if (!c) {
      events?.emit("shot.resolved", { player, kind: "miss", ray: req.ray,
                                      points: 0 });
      return;
    }
    MarkBodyCreatureShot(c, player);
    G.g_head_combo_bonus[player] = 0;
    events?.emit("shot.resolved", {
      player, kind: "marked", ray: req.ray, point: pick.point, points: 0,
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
  if (g_class_handlers[obj.cls as SpawnClass]?.ownsShotResult) {
    MarkActorShot(obj, player, pick.bone);
    G.g_head_combo_bonus[player] = 0;
    events?.emit("shot.resolved", {
      player, kind: "marked", ray: req.ray, point: pick.point,
      at: obj.at, bone: pick.bone, who: obj.name, charType: obj.charType,
      points: 0,
    });
    return;
  }

  // Through `DispatchHit` (`FUN_004092F0`) and never straight into
  // `ResolveHit`: the engine has exactly one call to the damage tables and it
  // is behind the shot-immune gate. `null` is that refusal, and it is a
  // **ricochet**, not a miss — the shot marked the actor, so the feedback
  // routine still runs, with the result the class's own copy forces.
  const out = DispatchHit(obj, pick.bone, CameraBackYawBams(), host, rng,
                          player);
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
  let points = 0;
  if (out.head) {
    points += SCORE_HEAD + (G.g_head_combo_bonus[player] ?? 0);
    G.g_head_combo_bonus[player] =
      (G.g_head_combo_bonus[player] ?? 0) + SCORE_HEAD_COMBO_STEP;
  } else {
    points += SCORE_HIT;
    G.g_head_combo_bonus[player] = 0;
  }
  if (out.killed) points += SCORE_KILL;
  // `ResolveHit` scores nothing at all for a result-5 hit.
  if (out.result === HitResultCode.NoEffect) points = 0;
  // Through `ScoreAddForPlayer`, not `G.g_player_score[0] += points`. Every
  // award and penalty in the game goes through that one routine. No `events`
  // argument, because this path never emitted `player.score` and making it do
  // so now would be a behaviour change smuggled in with a refactor.
  ScoreAddForPlayer(player, points);

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
function ResolveShotOnProp(req: ShotRequest, pick: { propId: number;
                                                     point: { x: number;
                                                              y: number;
                                                              z: number } },
                           host: GameHost, events?: Events): void {
  const prop = G.g_breakable_props.find((p) => p.id === pick.propId);
  if (!prop) return;
  BreakablePropTakeShot(prop, req.player);
  // `SpawnPropHitSpark` (`FUN_00465860`): the crosshair unprojected to the
  // prop's own camera depth, with `z` then replaced by the prop's `+0x1A4`.
  // The prop routines call it themselves on the frame they read the hit bit;
  // it is here because the port's props do not each carry a shot response.
  // [diverges] in where it is called from, not in what it does.
  const spark = PropSparkPoint(prop, req.ray, host);
  if (spark) SpawnPropHitSpark(spark.x, spark.y, prop.z);
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
 * [diverges] The engine's version also runs the blood effect and, in Original
 * Mode, the item-drop test. Neither is state, and both are the renderer's.
 */
export function MarkActorShot(obj: Actor, player: number, bone = 0): void {
  obj.flags |= (1 << ((player + 1) & 0x1f)) | ActorFlag.Hit;
  obj.pendingHit = { bone, result: 0 };
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
