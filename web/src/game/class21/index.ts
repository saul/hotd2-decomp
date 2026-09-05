/**
 * Class 0x21 — the **rescue target**, and the one branch writer arcade reaches
 * whose class is an enemy.
 *
 * One spawn in the whole game: stage 2, block 0, step 2. That block's route
 * record is `{kind 1, next = 11, 1, -1}` — the first fork of the stage — and
 * this actor is what answers it. Kill it and `g_script_branch_var` becomes 1
 * and the stage takes block 1; leave it and the variable stays 0 and the stage
 * takes block 11. Until this class was ported the port could not reach block 1
 * at all, which is half of stage 2.
 *
 * It is called a rescue target because that is what its death pays for:
 * `RescueTargetHeldState` increments `g_civilians_rescued_total` and
 * `g_civilians_rescued_by_scene[scene]`, records `0x36` in the per-scene
 * rescue list at `0x009C8EC0`, and awards **80 + 400** — the same 400 a
 * civilian's rescue pays. So the thing being shot is holding somebody.
 *
 * ## The four entry points
 *
 * The engine swaps the object's first word rather than keeping a state
 * number, the same way class 0x20 does:
 *
 * ```
 * RescueTargetInit             0x00451720  skinned model, both enemy counters
 * RescueTargetRideInState      0x00451860  rides in on the camera path
 * RescueTargetHeldState        0x00451980  live: sixteen parts, and the branch
 * RescueTargetFreedState       0x00451D80  after the rescue
 * RescueTargetAbandonedState   0x00451D20  the camera left it behind
 * ```
 *
 * {@link RescueTargetState} is that pointer as a value.
 *
 * ## What is not ported, by name
 *
 * * The **sixteen body parts**. The engine walks `obj+0x280 + part*0x90` and
 *   charges one hit point per part carrying bit 3, so a frame can take more
 *   than one; the port's shot model is one `pendingHit` an actor, which is the
 *   same divergence class 0x20 declares and for the same reason.
 * * `FUN_00451E50`, `FUN_00451EB0`, `FUN_00451F40` and `FUN_00451FF0` — the
 *   four draw and pose helpers. The renderer's.
 * * `RescueTargetFreedState`'s hand-off at `0x00451DF0` and the ground-ring
 *   effect. Both are drawing.
 * * The rescue tallies. `g_civilians_rescued_total` and
 *   `g_civilians_rescued_by_scene` are not in `G` — see `ResetSceneOnEnter`'s
 *   table — so the port raises `civilian.rescued`, which is what class 0x10's
 *   rescue already does.
 */
import type { Rng } from "../../core/rng";
import type { Actor } from "../actor";
import { ActorFlag } from "../actor";
import { ScoreAddForPlayer } from "../combat/score";
import { ActorDespawn } from "../despawn";
import { G } from "../globals";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";
import { RescueTargetState, type RescueTargetTail } from "./state";

export { RescueTargetState } from "./state";

/** `obj+0x11C` after `ActorInitHitPoints`, from `g_class21_hp_by_rank`. */
export const CLASS21_HP_BY_RANK = [1, 1, 2, 2, 2];

/** The clip `RescueTargetInit` installs, and the one the rescue swaps to. */
export const CLASS21_MOTION_IDLE = 0x3e6;
export const CLASS21_MOTION_FREED = 0x3cc;

/** `RescueTargetRideInState`'s two camera-frame cues. */
export const CLASS21_RIDE_HANDOVER = 0x31;
export const CLASS21_HELD_HANDOVER = 0xbd;

/** The camera path and frame that abandon it, and the one that despawns it. */
export const CLASS21_ABANDON_PATH = 0x39;
export const CLASS21_ABANDON_FRAME = 0x121;

/** What a part hit and the rescue pay. Part 2 is the head. */
export const CLASS21_HEAD_PART = 2;
export const CLASS21_SCORE_HEAD = 0x78;
export const CLASS21_SCORE_HIT = 10;
export const CLASS21_SCORE_HEAD_COMBO_STEP = 10;
export const CLASS21_SCORE_FREED = 0x50;
export const CLASS21_SCORE_RESCUE = 400;

/** `g_script_flags[0]` — every one of the four states opens by testing it. */
export const CLASS21_CLEAR_FLAG = 0;

/** An actor already narrowed to class 0x21. */
type RescueTargetActor = Actor & { rescue: RescueTargetTail };

function Tail(obj: Actor): RescueTargetTail | null {
  return (obj as RescueTargetActor).rescue ?? null;
}

/**
 * `RescueTargetInit` — `FUN_00451720`.
 *
 * ```c
 * obj->+0x3C = -1;  obj->+0x120 = -1;
 * ActorBuildSkinnedModel(obj+0x194, obj+0x40, obj+0x20C);
 * obj->+0x1B4 = 0x3E6;                    // the idle clip
 * obj->+0x194 = rand() % 10;              // its start frame
 * g_enemies_present += 1;  g_enemies_alive += 1;
 * if (g_GameMode != 2) obj->+0x11C = g_class21_hp_by_rank[rank];
 * *obj = RescueTargetRideInState;
 * ```
 *
 * **Both counters**, which is what makes this actor a `wait_enemies_alive`
 * gate's business as well as a branch's — a stage that waits for the room to
 * clear waits for this too.
 *
 * The rank table is `g_class21_hp_by_rank` (`0x00565F0C`) and gives 1 or 2, so
 * the target dies to one or two hits and never to a damage row.
 */
export function RescueTargetInit(obj: Actor, rng?: Rng): void {
  const t = Tail(obj);
  if (!t) return;
  t.state = RescueTargetState.RideIn;
  t.sub = 0;
  obj.motion = CLASS21_MOTION_IDLE;
  obj.playTicks = 0;
  // `IDIV 10` on the `rand()` return — a start frame, so a row of these would
  // not animate in lockstep. One ships, and it still draws.
  obj.rootFrame = -1;
  void rng?.int(10);
  obj.hp = CLASS21_HP_BY_RANK[G.g_damage_rank] ?? 1;
  G.g_enemies_present += 1;
  G.g_enemies_alive += 1;
}

/**
 * `RescueTargetRideInState` — `FUN_00451860`.
 *
 * ```c
 * if (obj->+0x1312 == 0) {
 *     ...pose...
 *     obj->pos = Ry(obj->+0x68) * (0, 50 - g_cam_path_frame, 50 - g_cam_path_frame);
 *     if (g_cam_path_frame > 0x31) obj->+0x1312 += 1;
 * } else if (obj->+0x1312 == 1) {
 *     ...pose...
 *     if (g_cam_path_frame != 0x5A && g_cam_path_frame != 0x8C
 *         && g_cam_path_frame > 0xBD) { obj->+0x4D4 = 1; *obj = RescueTargetHeldState; }
 * }
 * if (g_cutscene_skipping) { obj->+0x4D4 = 1; *obj = RescueTargetHeldState; }
 * ```
 *
 * The position is rebuilt from the camera frame every frame rather than
 * integrated, so the target's approach is exactly as long as the shot that
 * carries it — and a skipped cutscene hands over at once, wherever it is.
 *
 * The two excluded frames, `0x5A` and `0x8C`, are the engine's and are kept:
 * they are the only reason a hand-over can miss on one frame and take on the
 * next.
 */
export function RescueTargetRideInState(obj: Actor): void {
  const t = Tail(obj);
  if (!t) return;
  const frame = G.g_cam_path_frame;
  if (t.sub === 0) {
    const d = 50 - frame;
    const r = obj.yaw * ((Math.PI * 2) / 65536);
    obj.pos = { x: -Math.sin(r) * d, y: obj.pos.y, z: -Math.cos(r) * d };
    if (frame > CLASS21_RIDE_HANDOVER) t.sub += 1;
  } else if (t.sub === 1) {
    if (frame !== 0x5a && frame !== 0x8c && frame > CLASS21_HELD_HANDOVER) {
      t.state = RescueTargetState.Held;
    }
  }
  // [open] `g_cutscene_skipping` (0x009A2230) hands over at once wherever the
  // ride has got to. It is not in `G` — the port's skip is the walker's
  // `skipRequested`, which is a different global — so a skipped cutscene here
  // simply finishes the ride. The one shipped spawn's block is not skippable.
}

/**
 * `RescueTargetHeldState` — `FUN_00451980`. **The branch writer.**
 *
 * ```c
 * if (g_script_flags[0] == 1) { ...give both counters back...; ActorDespawn; }
 * if (obj->+0x34 & 8) {
 *     for (part = 0; part < 16; part++)
 *         if (obj->part[part].flags & 8) { obj->+0x11C -= 1; ...score...; }
 * }
 * if (obj->+0x11C < 1) {
 *     g_script_branch_var = 1;                    // THE ROUTE
 *     g_civilians_rescued_total += 1;
 *     g_civilians_rescued_by_scene[g_scene_index] += 1;
 *     ScoreAddForPlayer(who, 0x50);
 *     ScoreAddForPlayer(who, 400);
 *     g_enemies_alive -= 1;  g_enemies_present -= 1;
 *     obj->motion = 0x3CC;
 *     *obj = RescueTargetFreedState;
 *     return;
 * }
 * if (g_active_cam_path == 0x39 && g_cam_path_frame > 0x121) {
 *     ...both counters back...;  *obj = RescueTargetAbandonedState;
 * }
 * ```
 *
 * **The order is the whole point.** The parts are charged first and the hit
 * points are tested afterwards, in the *same* frame — so the shot that empties
 * the last point is the shot that writes the route. Moving the test above the
 * loop would cost a frame, and a frame here is a step boundary away from being
 * a different road.
 *
 * Who is paid: `obj+0x34` bits 1 and 2, one alone naming that player and
 * neither or both drawing `rand() & 1`. That is the engine's own rule
 * (`(param_1[0xd] & 6) == 2` gives 0, `== 4` gives 1), not the port's.
 */
export function RescueTargetHeldState(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  if ((G.g_script_flags[CLASS21_CLEAR_FLAG] ?? 0) === 1) {
    RescueTargetRetire(obj);
    ActorDespawn(obj);
    return;
  }

  if ((obj.flags & ActorFlag.Hit) !== 0) {
    // [diverges] One part a frame, not sixteen — the port records a single
    // `pendingHit`. Class 0x20 declares the same thing for the same reason.
    const part = obj.pendingHit?.bone ?? 0;
    const p0 = (obj.flags & ActorFlag.HitByPlayer0) !== 0;
    const p1 = (obj.flags & ActorFlag.HitByPlayer1) !== 0;
    const who = p0 && !p1 ? 0 : p1 && !p0 ? 1 : f.rng.int(2);
    obj.hp -= 1;
    if (part === CLASS21_HEAD_PART) {
      ScoreAddForPlayer(who, CLASS21_SCORE_HEAD);
      ScoreAddForPlayer(who, G.g_head_combo_bonus[who] ?? 0);
      G.g_head_combo_bonus[who] =
        (G.g_head_combo_bonus[who] ?? 0) + CLASS21_SCORE_HEAD_COMBO_STEP;
    } else {
      ScoreAddForPlayer(who, CLASS21_SCORE_HIT);
      G.g_head_combo_bonus[who] = 0;
    }
    G.g_player_hit_count[who] = (G.g_player_hit_count[who] ?? 0) + 1;
    obj.flags &= ~ActorFlag.Hit;
    obj.pendingHit = null;
  }

  if (obj.hp < 1) {
    RescueTargetRescued(obj, f);
    return;
  }

  if (G.g_active_cam_path === CLASS21_ABANDON_PATH
      && G.g_cam_path_frame > CLASS21_ABANDON_FRAME) {
    RescueTargetRetire(obj);
    t.state = RescueTargetState.Abandoned;
  }
}

/**
 * The rescue itself — the tail of `RescueTargetHeldState`, split out because
 * it is the half worth asserting on.
 *
 * [port-only] as a *function*: the engine has this inline from `0x00451AE0`.
 */
function RescueTargetRescued(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  // **The route.** Everything below it is the payment.
  G.g_script_branch_var = 1;

  const bits = obj.flags & (ActorFlag.HitByPlayer0 | ActorFlag.HitByPlayer1);
  const who = bits === ActorFlag.HitByPlayer0 ? 0
    : bits === ActorFlag.HitByPlayer1 ? 1 : f.rng.int(2);
  ScoreAddForPlayer(who, CLASS21_SCORE_FREED);
  ScoreAddForPlayer(who, CLASS21_SCORE_RESCUE);

  RescueTargetRetire(obj);
  obj.motion = CLASS21_MOTION_FREED;
  obj.playTicks = 0;
  obj.rootFrame = -1;
  obj.dead = true;
  obj.killedBy = who;
  t.state = RescueTargetState.Freed;
  // The engine's two tallies are not in `G`; this is what class 0x10's rescue
  // raises and the HUD already listens for.
  f.events?.emit("civilian.rescued",
                 { at: obj.at, player: who, score: CLASS21_SCORE_RESCUE });
}

/**
 * `g_enemies_alive -= 1; g_enemies_present -= 1` — the three lines every way
 * out of `RescueTargetHeldState` runs, and it runs them **once**.
 *
 * [port-only] as a *function*: three copies of the same three lines in the
 * engine, one per exit. One here, because a counter given back twice is a
 * gate that opens a room early.
 */
function RescueTargetRetire(obj: Actor): void {
  const t = Tail(obj);
  if (!t || t.state !== RescueTargetState.Held) return;
  G.g_enemies_alive -= 1;
  G.g_enemies_present -= 1;
}

/**
 * `RescueTargetFreedState` — `FUN_00451D80`.
 *
 * Opens with the `g_script_flags[0]` despawn every state in this class opens
 * with, then plays the freed clip out. What is not here: the hand-off at
 * `0x00451DF0` once `obj+0x1F1` rises, its 0x78-frame countdown, and the
 * ground-ring effect — all drawing, and the effect allocates its own task.
 */
function RescueTargetFreedState(obj: Actor): void {
  if ((G.g_script_flags[CLASS21_CLEAR_FLAG] ?? 0) === 1) ActorDespawn(obj);
}

/**
 * `RescueTargetAbandonedState` — `FUN_00451D20`.
 *
 * The same despawn flag, and one more way out: the camera reaching path
 * `0x39` frame `0x181`. That is the shot leaving the scene, and it is an
 * **equality** in the engine rather than a `>=`, so a frame skipped over it
 * leaves the actor standing. Transcribed as written.
 */
function RescueTargetAbandonedState(obj: Actor): void {
  if ((G.g_script_flags[CLASS21_CLEAR_FLAG] ?? 0) === 1) {
    ActorDespawn(obj);
    return;
  }
  if (G.g_active_cam_path === CLASS21_ABANDON_PATH
      && G.g_cam_path_frame === 0x181) {
    ActorDespawn(obj);
  }
}

/**
 * [port-only] The engine has no such function: it swaps `*obj` between the
 * four routines and calls through it. This is that indirect call written as a
 * `switch`, the same shape class 0x20's update has.
 */
export function RescueTargetUpdate(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  switch (t.state) {
    case RescueTargetState.RideIn: RescueTargetRideInState(obj); break;
    case RescueTargetState.Held: RescueTargetHeldState(obj, f); break;
    case RescueTargetState.Freed: RescueTargetFreedState(obj); break;
    case RescueTargetState.Abandoned: RescueTargetAbandonedState(obj); break;
  }
}

function RescueTargetDebug(obj: Actor): ActorDebug {
  const t = Tail(obj);
  if (!t) return { summary: "no class 0x21 tail", hot: true };
  return {
    summary: `${RescueTargetState[t.state]} · ${obj.hp} hp`,
    detail: [
      t.state === RescueTargetState.RideIn
        ? `riding in, sub ${t.sub}, cam frame ${G.g_cam_path_frame}`
        : `g_script_branch_var ${G.g_script_branch_var}`,
    ],
    hot: t.state === RescueTargetState.Held,
  };
}

export const RescueTargetHandler: ClassHandler = {
  init: RescueTargetInit,
  update: RescueTargetUpdate,
  // The freed and abandoned states play out after `dead` is set, the same
  // reason class 0x20 and class 0x31 have this.
  updatesWhenDead: true,
  // The class reads `obj+0x34` bit 3 itself and charges one hit point a part;
  // `ResolveHit` would look up a damage row it has no entry in.
  ownsShotResult: true,
  debug: RescueTargetDebug,
};

registerClass(SpawnClass.RankScaledEnemy, RescueTargetHandler);
