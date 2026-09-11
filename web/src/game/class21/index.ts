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
 * * `RescueTargetDraw` (`FUN_00451FF0`) and `FUN_00451F40`. The renderer's:
 *   the first loads the view matrix, transforms `obj+0x40` into camera space
 *   and draws only if the result is nearer than `float[0x004C436C]`.
 *
 * Two of that group **are** here, because they are not drawing at all:
 * {@link RescueTargetPoseFromRoute} (`FUN_00451E50`) and
 * {@link RescueTargetPoseFromRouteWithVelocity} (`FUN_00451EB0`) write
 * `obj+0x40`..`obj+0x6C` from an object path, and that is where the actor is
 * in the world. They were read as draw helpers and left out, which is how the
 * one actor that answers stage 2's first branch came to be standing at the
 * world origin.
 * * `RescueTargetFreedState`'s hand-off at `0x00451DF0` and the ground-ring
 *   effect. Both are drawing.
 * * The rescue tallies. `g_civilians_rescued_total` and
 *   `g_civilians_rescued_by_scene` are not in `G` — see `ResetSceneOnEnter`'s
 *   table — so the port raises `civilian.rescued`, which is what class 0x10's
 *   rescue already does.
 */
import type { Rng } from "../../core/rng";
import type { Actor } from "../actor";
import { ActorFlag, MotionFlag } from "../actor";
import { ScoreAddForPlayer } from "../combat/score";
import { ActorDespawn } from "../despawn";
import { G } from "../globals";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";
import { RescueTargetState, type RescueTargetTail } from "./state";

export { RescueTargetState } from "./state";

/**
 * `g_class21_hp_by_rank` — `0x00565F0C`. `obj+0x11C` at spawn, indexed by
 * `g_damage_rank` — `0x009C8E96`, which runs 0..15.
 *
 * **Sixteen rows, not five.** `RescueTargetInit` does
 * `iVar3 = FUN_0040A8A0(); obj+0x11C = (s16)[0x00565F0C + iVar3 * 2]`, and
 * `FUN_0040A8A0` is a one-line `return g_damage_rank`. This table read
 * `[1, 1, 2, 2, 2]` with a comment saying it "gives 1 or 2 by difficulty",
 * which is L6: the extent was guessed from the wrong index source, so the
 * target took one hit at rank 5 where the engine wants two and one at rank 14
 * where it wants four. The real extent is bounded by abutment —
 * `g_st2car_asset_variants` — `0x00565F2C` begins exactly sixteen `s16` later
 * — and the bytes are
 * `0100 0100 0100 0100 0200 0200 0200 0200 0200 0200 0300 0300 0300 0300
 * 0400 0400`. `[proved]`
 */
export const CLASS21_HP_BY_RANK =
  [1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4];

/**
 * `g_st2car_path_table` — `0x00565EF4`. The `op_` object-path slot an instance
 * of the stage-2 car — or of the actor riding it — takes its pose from, by
 * instance index.
 *
 * Eleven `s16`, bounded by abutment: {@link CLASS21_HP_BY_RANK}'s table
 * begins at `0x00565F0C`, one zero word past the last of them. Rows 0, 1 and 2
 * are the three shots of the opening — `op_st2` `0x148`, `0x14E` and `0x14D`,
 * the same three `FUN_004521B0` selects by camera path `0x38`/`0x39`/`0x3A` —
 * and rows 3..10 are the eight `op_train` paths the traffic instances ride,
 * which are in no numbered stage.
 *
 * Class 0x21 reads row `obj+0x1350` through it, which is why the rescue target
 * is **on the car** and not at a place of its own: same table, same frame,
 * same curve. `[proved]` — `FUN_00451E50` and `FUN_00451EB0` both index it.
 */
export const g_st2car_path_table = [
  0x148, 0x14e, 0x14d, 0x19a, 0x19b, 0x19c, 0x19d, 0x19e, 0x19f, 0x1a0, 0x1a1,
];

/** The clip `RescueTargetInit` installs, and the one the rescue swaps to. */
export const CLASS21_MOTION_IDLE = 0x3e6;
export const CLASS21_MOTION_FREED = 0x3cc;

/** `RescueTargetRideInState`'s two camera-frame cues. */
export const CLASS21_RIDE_HANDOVER = 0x31;
export const CLASS21_HELD_HANDOVER = 0xbd;

/**
 * The camera frame the drop-in offset reaches zero on — `50.0`, the double at
 * `0x00565FC0` that `RescueTargetRideInState` does `FILD g_cam_path_frame;
 * FSUBR double ptr [0x00565FC0]` against at `0x004518EF`–`0x004518FF`.
 *
 * The same 50 in both the y and the z of the point, and one frame past it
 * `obj+0x1312` steps and the offset stops being applied at all.
 */
export const CLASS21_DROP_IN_FRAMES = 50;

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
 * obj->+0x1F8 &= ~2;                      // root motion OFF
 * obj->+0x1FC = 5;                        // the rotation order
 * obj->+0x1B4 = 0x3E6;                    // the idle clip
 * obj->+0x194 = rand() % 10;              // its start frame
 * g_enemies_present += 1;  g_enemies_alive += 1;
 * if (g_GameMode != 2) obj->+0x11C = g_class21_hp_by_rank[rank];  // not Training
 * *obj = RescueTargetRideInState;
 * ```
 *
 * **Both counters**, which is what makes this actor a `wait_enemies_alive`
 * gate's business as well as a branch's — a stage that waits for the room to
 * clear waits for this too.
 *
 * The rank table is `g_class21_hp_by_rank` (`0x00565F0C`) and gives 1 to 4 —
 * see {@link CLASS21_HP_BY_RANK} — so the target dies to that many part hits
 * and never to a damage row.
 *
 * **And it turns root motion off, one instruction after the build turned it
 * on.** `ActorBuildSkinnedModel` writes `model+0x64 = 3` unconditionally;
 * `MOV EDX,[EDI+0x64]; AND EDX,0xFFFFFFFD; MOV [EDI+0x64],EDX` at
 * `0x00451753`–`0x00451760` (bytes `8b5764 83e2fd 895764`) takes bit 1 straight
 * back out. Class 0x21 is one of exactly two things in the game that clear it,
 * the other being class 0x10's script. `[proved]`
 *
 * That is not bookkeeping: it is how the actor gets posed at all. With the bit
 * clear, `SkeletonApplyRootMotion` (`FUN_00410C50`) puts the clip root's
 * **whole** translation on the draw matrix instead of only its y — see
 * `RootHorizontalGoesToPose` in `game/root_motion.ts` — and motion `0x3E6`'s
 * root is the constant `(0, 15.692, 11.943)`. Without this line the port took
 * the y-only arm and the rider sat 11.943 units along its own `+Z`, out over
 * the car's bonnet. It is also why the route's absolute pose is safe to write
 * every frame: nothing is stepping the object underneath it.
 */
export function RescueTargetInit(obj: Actor, rng?: Rng): void {
  const t = Tail(obj);
  if (!t) return;
  t.state = RescueTargetState.RideIn;
  t.sub = 0;
  obj.motionFlags &= ~MotionFlag.RootMotion;
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
 * `RescueTargetPoseFromRoute` — `FUN_00451E50`. **The whole of "it is on the
 * car".**
 *
 * ```c
 * CamEvalObjectPath6(g_st2car_path_table[obj+0x1350], g_cam_path_frame, &p);
 * obj+0x40 = p.x;  obj+0x44 = p.y;  obj+0x48 = p.z;
 * obj+0x64 = p.rx; obj+0x68 = p.ry; obj+0x6C = p.rz;
 * ```
 *
 * Six words, no offset and no bias: the actor is *at* the car's own pose on
 * the car's own object path, sampled on the camera's frame. Both sub-states of
 * {@link RescueTargetRideInState} open with this and
 * {@link RescueTargetHeldState} runs {@link RescueTargetPoseFromRouteWithVelocity},
 * so the rescue target is on the route for every frame it is alive.
 *
 * All three angles are written, not the yaw alone: `CharacterLayer.objectPath`
 * publishes the whole `{pitch, yaw, roll}` triple out of `op_` channels 3, 4
 * and 5, so there is nothing to leave out here. Whether a *skinned* actor is
 * drawn with its pitch and roll is `render/characters.ts`'s question and not
 * this file's — it poses from the yaw today.
 */
export function RescueTargetPoseFromRoute(obj: Actor, f: ClassFrame): boolean {
  const t = Tail(obj);
  if (!t) return false;
  const slot = g_st2car_path_table[t.route];
  if (slot === undefined) return false;
  const p = f.host.objectPath?.(slot, G.g_cam_path_frame);
  if (!p) return false;
  obj.pos.x = p.x;
  obj.pos.y = p.y;
  obj.pos.z = p.z;
  if (p.pitch !== undefined) obj.pitch = p.pitch;
  if (p.yaw !== undefined) obj.yaw = p.yaw;
  if (p.roll !== undefined) obj.roll = p.roll;
  return true;
}

/**
 * `RescueTargetPoseFromRouteWithVelocity` — `FUN_00451EB0`.
 *
 * {@link RescueTargetPoseFromRoute} with one more write: the new pose minus
 * the old one, into `obj+0x13CC`/`+0x13D0`/`+0x13D4`, **before** the position
 * is replaced. The two routines are otherwise instruction for instruction the
 * same, which is why they are a pair rather than one with a flag.
 *
 * Nothing in the class reads the delta back — see
 * {@link RescueTargetTail.delta} — but it is written because the routine
 * writes it, and a word the port silently drops is a word the next reader has
 * to rediscover.
 */
export function RescueTargetPoseFromRouteWithVelocity(
    obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  const was = { x: obj.pos.x, y: obj.pos.y, z: obj.pos.z };
  if (!RescueTargetPoseFromRoute(obj, f)) return;
  t.delta.x = obj.pos.x - was.x;
  t.delta.y = obj.pos.y - was.y;
  t.delta.z = obj.pos.z - was.z;
}

/**
 * `RescueTargetRideInState` — `FUN_00451860`.
 *
 * ```c
 * if (obj->+0x1312 == 0) {
 *     RescueTargetPoseFromRoute(obj);
 *     MatrixLoadIdentity(); MatrixTranslate(obj->pos); MatrixRotateY(obj->+0x68);
 *     MatrixTransformPoint((0, 50 - g_cam_path_frame, 50 - g_cam_path_frame),
 *                          &obj->pos);
 *     if (g_cam_path_frame >= 0x32) obj->+0x1312 += 1;
 * } else if (obj->+0x1312 == 1) {
 *     RescueTargetPoseFromRoute(obj);
 *     if (g_cam_path_frame != 0x5A && g_cam_path_frame != 0x8C
 *         && g_cam_path_frame >= 0xBE) { obj->+0x1350 = 1; *obj = RescueTargetHeldState; }
 * }
 * RescueTargetDraw(obj);
 * obj->+0x194 += 1;
 * if (g_cutscene_skipping) { obj->+0x1350 = 1; *obj = RescueTargetHeldState; }
 * ```
 *
 * **Sub 0 is a drop-in onto the car, not a place of its own.** The pose comes
 * from the route first, and the `(0, d, d)` point is then rotated by the
 * route's own yaw and added to it — `T(pos) · Ry(yaw) · p`, the stack
 * post-multiplying — so the offset shrinks to nothing exactly as the camera
 * frame reaches 50 and the actor is on the car from there on. The port read
 * this as an absolute position built from the yaw alone, with the route never
 * sampled at all and the `d` in y dropped: the actor sat 40 units from the
 * world origin, 1,600 units from the car, for the whole of both shots.
 *
 * The two excluded frames, `0x5A` and `0x8C`, are the engine's and are kept:
 * they are the only reason a hand-over can miss on one frame and take on the
 * next.
 *
 * `obj+0x1350` is written on the way out, and it is not bookkeeping: it is the
 * route the *next* state poses from — row 1, `op_st2` `0x14E`, which is the
 * car's route for camera path `0x39`.
 */
export function RescueTargetRideInState(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  const frame = G.g_cam_path_frame;
  if (t.sub === 0) {
    RescueTargetPoseFromRoute(obj, f);
    // `T(pos) · Ry(yaw) · (0, d, d)`. Ry's own signs are the engine's, the
    // same pair `class25`'s path offset uses: `x' = x·cos + z·sin`,
    // `z' = -x·sin + z·cos`, and y passes through.
    const d = CLASS21_DROP_IN_FRAMES - frame;
    const r = obj.yaw * ((Math.PI * 2) / 65536);
    obj.pos.x += Math.sin(r) * d;
    obj.pos.y += d;
    obj.pos.z += Math.cos(r) * d;
    if (frame > CLASS21_RIDE_HANDOVER) t.sub += 1;
  } else if (t.sub === 1) {
    RescueTargetPoseFromRoute(obj, f);
    if (frame !== 0x5a && frame !== 0x8c && frame > CLASS21_HELD_HANDOVER) {
      t.route = 1;
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

  // `FUN_00451EB0(obj); FUN_00451FF0(obj); obj+0x194 += 1;` at
  // `0x00451B2A`-`0x00451B39`, between the hit-point test above and the
  // abandon test below. The order is the engine's: an actor rescued this frame
  // never reaches the pose, which is why the freed clip plays where the shot
  // landed rather than one frame further down the route.
  RescueTargetPoseFromRouteWithVelocity(obj, f);

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
    case RescueTargetState.RideIn: RescueTargetRideInState(obj, f); break;
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
