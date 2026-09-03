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
import { BreakablePropTakeShot } from "../class41/prop";
import { ActorByAt, G } from "../globals";
import type { GameHost, ShotRay } from "../host";
import { g_class_handlers } from "../registry";
import type { SpawnClass } from "../spawn_class";
import { HitResultCode, ResolveHit } from "./resolve_hit";
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
  G.g_shot_requests = [];
  for (const req of queued) ResolveShotRequest(req, host, rng, events);
}

/** One request, from segment to score. `[port-only]` — see above. */
function ResolveShotRequest(req: ShotRequest, host: GameHost, rng: Rng,
                            events?: Events): void {
  const player = req.player;
  // `g_nPlayerFired` — the accuracy denominator. Counted here rather than
  // where the click landed, so it counts shots the *game* saw.
  G.g_nPlayerFired[player] = (G.g_nPlayerFired[player] ?? 0) + 1;
  const pick = host.pickShot?.(req.ray) ?? null;

  if (!pick) {
    // A miss resets nothing -- the game only clears the head combo on a hit
    // that is not a head.
    events?.emit("shot.resolved", { player, kind: "miss", ray: req.ray,
                                    points: 0 });
    return;
  }
  if (pick.kind === "prop") return ResolveShotOnProp(req, pick, events);

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

  const out = ResolveHit(obj, pick.bone, CameraBackYawBams(), host, rng);
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
                           events?: Events): void {
  const prop = G.g_breakable_props.find((p) => p.id === pick.propId);
  if (!prop) return;
  BreakablePropTakeShot(prop, req.player);
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
