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
 * RescueTargetSinkAndDespawnState 0x00451DF0  the freed clip is over
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
 * * The pose and the triangles of `RescueTargetDraw` (`FUN_00451FF0`), which
 *   are the renderer's. What the draw decides is here -- see
 *   {@link RescueTargetDraw}.
 *
 * Three routines that were once listed here as drawing **are** here, because
 * they are not drawing at all: {@link RescueTargetPoseFromRoute}
 * (`FUN_00451E50`) and {@link RescueTargetPoseFromRouteWithVelocity}
 * (`FUN_00451EB0`) write `obj+0x40`..`obj+0x6C` from an object path, and
 * {@link RescueTargetFreedDrift} (`FUN_00451F40`) moves the freed body off the
 * car. They were read as draw helpers and left out, which is how the one actor
 * that answers stage 2's first branch came to be standing at the world origin,
 * and how its death came to leave no ground ring: the ring is
 * `RescueTargetFreedState`'s, on the frame the draw reports its clip over.
 */
import type { Rng } from "../../core/rng";
import type { Actor } from "../actor";
import { ActorFlag, MotionFlag } from "../actor";
import { ReleaseCameraEnemySlot } from "../camera/slots";
import { MatrixGetAngles, RotZYX } from "../carrier";
import { ActorSetMotionBlended } from "../class30/motion_cue";
import { ScoreAddForPlayer } from "../combat/score";
import { ActorPlayHitVoice, ActorVoice } from "../combat/voice";
import { ActorDespawn } from "../despawn";
import { SpawnGroundRingEffect } from "../effects/ring_effect";
import { G, HIT_SLOT_NONE } from "../globals";
import { DrawSkinnedModelAndShadow } from "../skeleton";
import { ActorFreeHitSlot } from "../hit_slots";
import { RecordRescue, RESCUE_TARGET_CHAR_TYPE } from "../rescue";
import { ActorAdvanceMotion } from "../motion";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
  type ReplaySpawnRecord,
} from "../registry";
import { SpawnClass } from "../spawn_class";
import { MotionPlayFrame, MotionPlayLength } from "../tables";
import { LerpAngleShortWay, LerpWeighted, vec3 } from "../vec";
import { St2CarSpawn } from "./car";
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
/**
 * `ActorSetMotionBlended(model, 0x3CC, 0xF, 5)` at `0x00451BC0` --
 * `PUSH 0x5; PUSH 0xf; PUSH 0x3cc` (`6a05 6a0f 68cc030000`). The start is a
 * **play cursor**, 15, which is the unit the port's setter takes.
 */
export const CLASS21_FREED_START_CURSOR = 0xf;
export const CLASS21_FREED_FADE = 5;
/** `MOV dword ptr [ESI+0x1338], 0x78` -- the sink's two seconds. */
export const CLASS21_SINK_FRAMES = 0x78;
/** `FSUB [0x004C4D04]` (`0ad7233d`, 0.04f) -- the sink's step a frame. */
export const CLASS21_SINK_STEP = Math.fround(0.04);
/**
 * `RescueTargetFreedDrift`'s window: `10 < n && n < 0x15`, and in it the
 * car's velocity is weighed `LerpWeighted(v, 0, 1, 20 - n)` -- nine tenths at
 * frame 11, a half at 19, nothing at 20.
 */
export const CLASS21_DRIFT_BLEED_FIRST = 11;
export const CLASS21_DRIFT_BLEED_END = 0x15;
export const CLASS21_DRIFT_BLEED_BASE = 0x14;
/** `LerpWeighted(y, g_camera_fixed_eye_y, 1, 3)` -- a quarter of the way a frame. */
export const CLASS21_DRIFT_FALL_DEN = 3;
/** `FUN_00401EC0(roll, 0, 1, 1)` -- half the roll off a frame. */
export const CLASS21_DRIFT_LEVEL_DEN = 1;

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
/**
 * `CMP dword ptr [0x009A6110], 0x181` at `0x00451D49`: the frame of path
 * `0x39` `RescueTargetAbandonedState` despawns on. An equality there.
 */
export const CLASS21_ABANDONED_DESPAWN_FRAME = 0x181;
/**
 * The `g_script_branch_var` the rescue writes (`0x00451AE9`), and so the slot
 * of block 0's route `{11, 1}` that only a rescue can send the stage down.
 */
export const CLASS21_RESCUE_ARM = 1;

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
 * St2CarSpawn(0);                          // the car it rides -- car.ts
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
  // `obj+0x194 = rand() % 10` (`IDIV ECX` with `ECX = 10` at `0x00451778`,
  // `MOV [EDI], EDX` into the model at `0x0045177A`) -- the model's
  // **counter**, `model[0]`, which is the port's `playTicks`: the clip starts
  // up to nine frames in, so a row of these would not animate in lockstep.
  // The port drew the number and threw it away; the class steps its own
  // counter now (`advancesOwnMotion`), so the start is the engine's.
  obj.rootCursor = -1;
  obj.playTicks = rng ? rng.int(10) : 0;
  obj.hp = CLASS21_HP_BY_RANK[G.g_damage_rank] ?? 1;
  G.g_enemies_present += 1;
  G.g_enemies_alive += 1;
  // `INC word [0x009A21BA]` at `0x004517E8`, in the arm that is not
  // Training's: the rider counts as a civilian the run has seen.
  G.g_civilians_seen_total = (G.g_civilians_seen_total + 1) & 0xffff;
  // **The car.** `PUSH 0x0` at `0x004517F6`, `CALL 0x00452120` at
  // `0x00451800`: this Init is the only thing in the game that allocates the
  // stage-2 car, so the car exists from the frame class 0x21 does and not
  // before -- see `game/class21/car.ts`. The Training arm passes `obj+0x11C`
  // instead (`0x0045183B`); that arm, `RescueTargetTrainingWaitState`
  // (`FUN_00452540`), is not ported.
  St2CarSpawn(0);
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
  // `RescueTargetDraw(obj); obj+0x194 += 1;` -- every frame of the ride, the
  // hand-over's included.
  RescueTargetDraw(obj, f);
  ActorAdvanceMotion(obj, f.dt);
  // `g_cutscene_skipping` (0x009A2230) hands over at once wherever the ride
  // has got to.
  if (G.g_cutscene_skipping !== 0) {
    t.route = 1;
    t.state = RescueTargetState.Held;
  }
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
 *     n = g_civilians_rescued_by_scene[g_scene_index]++;
 *     g_rescued_char_types[g_scene_index * 10 + n] = 0x36;
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
  // `0x00451C1B`-`0x00451C31`, between the hit-point test above and the
  // abandon test below. The order is the engine's: an actor rescued this frame
  // never reaches the pose, which is why the freed clip plays where the shot
  // landed rather than one frame further down the route.
  RescueTargetPoseFromRouteWithVelocity(obj, f);
  RescueTargetDraw(obj, f);
  ActorAdvanceMotion(obj, f.dt);

  if (G.g_active_cam_path === CLASS21_ABANDON_PATH
      && G.g_cam_path_frame > CLASS21_ABANDON_FRAME) {
    RescueTargetRetire(obj);
    // **And both slots**, which this arm used to keep. `0x00451C5B`..
    // `0x00451C7F`, `[proved]`:
    //
    // ```
    // 00451c5b  MOV AL, byte ptr [ESI + 0x120] / OR EBX, -1 / CMP AL, BL
    // 00451c66  JZ  / PUSH ESI / CALL 0x004092b0   ; ReleaseCameraEnemySlot
    // 00451c71  CMP dword ptr [ESI + 0x3c], EBX
    // 00451c74  JZ  / PUSH ESI / CALL 0x004092d0   ; ActorFreeHitSlot
    // 00451c7f  MOV dword ptr [ESI], 0x451d20      ; RescueTargetAbandonedState
    // ```
    //
    // `ActorFreeHitSlot` (`FUN_004092D0`) tests nothing, so the index test
    // is the caller's, here as at `0x00451C71`.
    if (obj.cameraSlot >= 0) ReleaseCameraEnemySlot(obj);
    if (obj.hitSlot !== HIT_SLOT_NONE) ActorFreeHitSlot(obj);
    t.state = RescueTargetState.Abandoned;
  }
}

/**
 * `[port-only]` -- a replay's question, `ClassHandler.outlivedByReplay`:
 * has the replay gone past one of this target's ways out, so that at the
 * landing address the engine's object is gone and must not be rebuilt?
 *
 * A seek rebuilds every spawn still listed at its `Init`, and this one's
 * `Init` counts it into both enemy counters and starts the ride-in. Its ways
 * out all come **before** any room gate on either road, so no gate a replay
 * steps over could say it was gone, and a reload anywhere past them rebuilt
 * it counted: stage 2 block 11 step 2's civilian `0x6830` then sat sobbing in
 * front of two dead captors, because her rescue waits on a camera cue that
 * only plays after `wait_enemies_alive 0`, and the rebuilt target held that
 * gate in `RescueTargetRideInState` -- which hands over only at frame
 * `>= 0xBE`, and that step's shot never gets past 30.
 *
 * The three the replay can see, each read in the exe `[proved]`:
 *
 * * **`g_script_flags[0]`.** `RescueTargetHeldState` (`0x00451980`),
 *   `RescueTargetFreedState` (`0x00451D80`), the sink (`0x00451DF0`) and
 *   `RescueTargetAbandonedState` (`0x00451D20`) each open
 *   `MOV AL, [0x009C7200]; CMP AL, 1` and despawn -- the held one giving its
 *   counters back first. The ride-in does not test it, and does not need to:
 *   stage 2 raises flag 0 only at 3/3/10 and 11/2/27, a road past the
 *   ride-in's hand-over at block 0's `cam_play 10..190` either way.
 * * **Camera path `0x39` at frame `0x181`.** The held state is abandoned at
 *   `>= 0x122` on that path, counters back, and the abandoned state despawns
 *   at `== 0x181`. A replay jumps frames where play steps them, so "at or
 *   past" is the frame play would have gone through -- the rule the civilian
 *   removal cue takes in `Walker.civilianCuesSeen`. The only shots on `0x39`
 *   in the shipped data are block 0's `0..90` and `91..289` and block 11's
 *   `290..405`, so the frame is reached on the one shot that also passes
 *   `0x122` on the way. A landing between the two is left to the target:
 *   rebuilt there it hands over and is abandoned on its own first frames.
 * * **Route slot 1 out of its own block.** `g_script_branch_var = 1` at
 *   `0x00451AE9` is the rescue, and block 0 of stage 2 has no other writer of
 *   a 1 (`L45`): a replay that took that slot is a replay past the rescue,
 *   after which the freed body plays its clip out, sinks for `0x78` frames and
 *   despawns. What the replay cannot tell is how far into those frames it
 *   has landed, so a landing inside them loses the sinking body early -- the
 *   one window this answers early rather than exactly.
 */
export function RescueTargetOutlivedByReplay(rec: ReplaySpawnRecord): boolean {
  if ((G.g_script_flags[CLASS21_CLEAR_FLAG] ?? 0) === 1) return true;
  if (G.g_active_cam_path === CLASS21_ABANDON_PATH
      && G.g_cam_path_frame >= CLASS21_ABANDONED_DESPAWN_FRAME) {
    return true;
  }
  return rec.armOut === CLASS21_RESCUE_ARM;
}

/**
 * The rescue itself — the tail of `RescueTargetHeldState`, split out because
 * it is the half worth asserting on.
 *
 * [port-only] as a *function*: the engine has this inline from `0x00451AE2`
 * to the `RET` at `0x00451C1A`, and most of it is past a `MatrixStackPop` the
 * decompiler stops at (L35) -- the clip, the slots, the counters and the
 * three calls that make the first freed frame.
 *
 * ```
 * 00451ae9  g_script_branch_var = 1; ActorPlayHitVoice(obj, 1)
 * 00451aff  the rescue tallies; who = obj+0x34 bits, or rand() & 1
 * 00451b56  ScoreAddForPlayer(who, 0x50); ScoreAddForPlayer(who, 400)
 * 00451b66  Push; Identity; RotZ(+0x6C); RotY(+0x68); RotX(+0x64)
 * 00451b98  MatrixGetAngles(&+0x64, &+0x68, &+0x6C); obj+0x1FC = 2; Pop
 * 00451bba  obj+0x1334 = 0; ActorSetMotionBlended(model, 0x3CC, 0xF, 5)
 * 00451bcb  g_hit_slots[obj+0x3C] = 0; obj+0x3C = -1
 * 00451bd8  g_enemies_alive--; g_enemies_present--
 * 00451be6  if (obj+0x120 != -1) ReleaseCameraEnemySlot(obj)
 * 00451bfa  RescueTargetFreedDrift(obj); RescueTargetDraw(obj); obj+0x194++
 * 00451c0d  *obj = RescueTargetFreedState
 * ```
 *
 * The angles are **re-derived**: the pose the route wrote was composed
 * `RotZ RotY RotX`, and `MatrixGetAngles` reads the same rotation back as the
 * `RotY RotX RotZ` triple, with `obj+0x1FC` -- the model's rotation order --
 * set to 2 to match. The order byte has no field here: nothing in `game/`
 * composes a rotation from it, and the renderer poses this class by its yaw.
 * The yaw it poses by, and the one the ground ring later takes, is the
 * re-derived one. The port used to cut straight to the clip at frame 0 and
 * stop there, so the body never left the car and never left a ring.
 */
function RescueTargetRescued(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  // **The route.** Everything below it is the payment.
  G.g_script_branch_var = 1;
  ActorPlayHitVoice(obj, ActorVoice.Killed, f.rng,
                    (id) => f.events?.emit("sound.play", { id }));
  // The two tallies and the rescued type, `0x00451AFF`..`0x00451B21` --
  // this class's type is the literal `0x36`, not the actor's.
  RecordRescue(RESCUE_TARGET_CHAR_TYPE);

  const bits = obj.flags & (ActorFlag.HitByPlayer0 | ActorFlag.HitByPlayer1);
  const who = bits === ActorFlag.HitByPlayer0 ? 0
    : bits === ActorFlag.HitByPlayer1 ? 1 : f.rng.int(2);
  ScoreAddForPlayer(who, CLASS21_SCORE_FREED);
  ScoreAddForPlayer(who, CLASS21_SCORE_RESCUE);

  const r = MatrixGetAngles(RotZYX(obj.roll, obj.yaw, obj.pitch));
  obj.pitch = r.x;
  obj.yaw = r.y;
  obj.roll = r.z;
  t.freedFrames = 0;
  ActorSetMotionBlended(obj, CLASS21_MOTION_FREED,
                        CLASS21_FREED_START_CURSOR, CLASS21_FREED_FADE);
  // `MOV [EAX*4 + 0x9c88c0], EBX` with no test of `obj+0x3C` first: an actor
  // that found the table full writes the word before it. `[port-only]` guard,
  // since the port's table has no word before it; class 0x21 claims in its
  // `Init`, so the index is the claim's.
  if (obj.hitSlot !== HIT_SLOT_NONE) G.g_hit_slots[obj.hitSlot] = HIT_SLOT_NONE;
  obj.hitSlot = HIT_SLOT_NONE;
  RescueTargetRetire(obj);
  if (obj.cameraSlot >= 0) ReleaseCameraEnemySlot(obj);
  RescueTargetFreedDrift(obj);
  RescueTargetDraw(obj, f);
  ActorAdvanceMotion(obj, f.dt);
  obj.dead = true;
  obj.killedBy = who;
  t.state = RescueTargetState.Freed;
  // `[port-only]` -- what class 0x10's rescue also raises, for the feed.
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
 * `RescueTargetFreedDrift` — `FUN_00451F40`. The freed body's own motion, one
 * frame of it:
 *
 * ```c
 * n = obj+0x1334;
 * if (10 < n && n < 0x15) {                  // frames 11..20
 *     obj+0x13CC = LerpWeighted(obj+0x13CC, 0, 1, 20 - n);
 *     obj+0x13D4 = LerpWeighted(obj+0x13D4, 0, 1, 20 - n);
 * }
 * obj+0x40 += obj+0x13CC;
 * obj+0x44  = LerpWeighted(obj+0x44, g_camera_fixed_eye_y, 1, 3);
 * obj+0x48 += obj+0x13D4;
 * obj+0x6C  = LerpAngleShortWay(obj+0x6C, 0, 1, 1);
 * obj+0x1334 += 1;
 * ```
 *
 * `[proved]`. The x and z step is the car's last frame of travel, which
 * `RescueTargetPoseFromRouteWithVelocity` (`FUN_00451EB0`) left in
 * `obj+0x13CC`/`+0x13D4`: the body goes on at the car's speed for ten frames
 * and bleeds it away over the next ten. The height falls a quarter of the way
 * to `g_camera_fixed_eye_y` -- the ground plane -- each frame, and the roll
 * halves toward level. The port read this as part of the draw and left it
 * out, which kept the freed body riding the car's last pose and would have put
 * its ground ring at the car's height. Every word it writes is stored as a
 * float, so each is rounded as it is stored.
 */
export function RescueTargetFreedDrift(obj: Actor): void {
  const t = Tail(obj);
  if (!t) return;
  const n = t.freedFrames;
  if (n >= CLASS21_DRIFT_BLEED_FIRST && n < CLASS21_DRIFT_BLEED_END) {
    const den = CLASS21_DRIFT_BLEED_BASE - n;
    t.delta.x = Math.fround(LerpWeighted(t.delta.x, 0, 1, den));
    t.delta.z = Math.fround(LerpWeighted(t.delta.z, 0, 1, den));
  }
  obj.pos.x = Math.fround(t.delta.x + obj.pos.x);
  obj.pos.y = Math.fround(LerpWeighted(obj.pos.y, G.g_camera_fixed_eye_y, 1,
                                       CLASS21_DRIFT_FALL_DEN));
  obj.pos.z = Math.fround(t.delta.z + obj.pos.z);
  obj.roll = LerpAngleShortWay(obj.roll, 0, 1, CLASS21_DRIFT_LEVEL_DEN);
  t.freedFrames = n + 1;
}

const _view = vec3();

/**
 * `RescueTargetDraw` — `FUN_00451FF0`. What the class's draw decides.
 *
 * ```
 * 00452004  Push; SetTop(g_camera_world_to_view[g_camera_index])
 * 00452049  v = MatrixTransformPoint(obj+0x40); Pop
 * 00452055  FLD v.z; FCOMP [0x004C436C]      ; 0.0
 * 00452067  JZ past the draw unless v.z < 0  ; -z is in front
 * 00452074  DrawSkinnedModelAndShadow(obj+0x194, obj+0x40, obj+0x20C)
 * ```
 *
 * The pose and the triangles are the renderer's. What is the game's is the
 * byte the draw leaves in the model: `SkeletonAdvancePlayCursor`
 * (`FUN_004111A0`), inside the draw, clears `model+0x5D` and raises it when
 * the play cursor has reached the play length, and `RescueTargetFreedState`
 * reads it on the next line. So this records {@link RescueTargetTail.clipEnded}
 * from the cursor at the point the draw is made -- the counter as the last
 * `obj+0x194++` left it, which is the port's `playTicks` here because the
 * class steps it itself -- and records nothing when the actor is behind the
 * camera, where the engine does not draw and the byte keeps what the last
 * draw left.
 *
 * `[port-only]`: a host with no camera answers `viewSpaceOfPoint` false or
 * not at all, and then the actor is taken as drawn. The engine always has a
 * camera; a headless run never does, and the other choice would leave every
 * headless freed body standing for ever.
 */
export function RescueTargetDraw(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  if (f.host.viewSpaceOfPoint?.(obj.pos, _view) && !(_view.z < 0)) return;
  t.clipEnded = MotionPlayFrame(obj) >= MotionPlayLength(obj) ? 1 : 0;
  // ...and the draw's ground shadow, under `g_cur_actor`, which every state
  // that draws points at the body first.
  DrawSkinnedModelAndShadow(obj);
}

/**
 * `RescueTargetFreedState` — `FUN_00451D80`.
 *
 * ```
 * 00451d80  if (g_script_flags[0] == 1) { ActorDespawn(obj); return; }
 * 00451da0  RescueTargetFreedDrift(obj); RescueTargetDraw(obj)
 * 00451dab  if (obj+0x1F1) {
 * 00451db9      obj+0x1338 = 0x78; SpawnGroundRingEffect(obj);
 * 00451dcb      *obj = 0x00451DF0; return;       // no obj+0x194++
 *           }
 * 00451dd3  obj+0x194 += 1
 * ```
 *
 * The body drifts off the car and plays the freed clip out; on the frame the
 * draw reports the clip at its end it opens the ground ring under itself --
 * `SpawnGroundRingEffect` (`FUN_00407DA0`), at the tracked bone's x and z
 * and, because `RescueTargetInit` leaves `MotionFlag.TraceGround` down, at
 * its own height -- and hands over to the sink **without** stepping the
 * counter, so the clip holds its last frame from then on.
 */
function RescueTargetFreedState(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  if ((G.g_script_flags[CLASS21_CLEAR_FLAG] ?? 0) === 1) {
    ActorDespawn(obj);
    return;
  }
  RescueTargetFreedDrift(obj);
  RescueTargetDraw(obj, f);
  if (t.clipEnded) {
    t.sinkFrames = CLASS21_SINK_FRAMES;
    SpawnGroundRingEffect(obj);
    t.state = RescueTargetState.Sinking;
    return;
  }
  ActorAdvanceMotion(obj, f.dt);
}

/**
 * `RescueTargetSinkAndDespawnState` — `FUN_00451DF0`. `RescueTargetFreedState`'s
 * hand-off, reached only through the `MOV dword ptr [ESI], 0x451df0` at
 * `0x00451DCB` -- which is why Ghidra had no function there until this read
 * made one.
 *
 * ```
 * 00451df0  if (g_script_flags[0] == 1) { ActorDespawn(obj); return; }
 * 00451e14  obj+0x44 -= 0.04
 * 00451e20  RescueTargetDraw(obj)
 * 00451e2e  if (--obj+0x1338 == 0) ActorDespawn(obj)
 * ```
 *
 * `[proved]`. Two seconds of sinking on the freed clip's last frame -- there
 * is no `obj+0x194++` in it -- while the ring the freed state opened spreads
 * and fades around it.
 */
function RescueTargetSinkAndDespawnState(obj: Actor, f: ClassFrame): void {
  const t = Tail(obj);
  if (!t) return;
  if ((G.g_script_flags[CLASS21_CLEAR_FLAG] ?? 0) === 1) {
    ActorDespawn(obj);
    return;
  }
  obj.pos.y = Math.fround(obj.pos.y - CLASS21_SINK_STEP);
  RescueTargetDraw(obj, f);
  t.sinkFrames -= 1;
  if (t.sinkFrames === 0) ActorDespawn(obj);
}

/**
 * `RescueTargetAbandonedState` — `FUN_00451D20`.
 *
 * The same despawn flag, and one more way out: the camera reaching path
 * `0x39` frame `0x181`. That is the shot leaving the scene, and it is an
 * **equality** in the engine rather than a `>=`, so a frame skipped over it
 * leaves the actor standing. Transcribed as written.
 *
 * Until then it **rides on**: `RescueTargetPoseFromRouteWithVelocity`,
 * `RescueTargetDraw` and `obj+0x194++` at `0x00451D60`..`0x00451D76`, the
 * held state's own three lines. The port stopped the actor where the camera
 * left it.
 */
function RescueTargetAbandonedState(obj: Actor, f: ClassFrame): void {
  if ((G.g_script_flags[CLASS21_CLEAR_FLAG] ?? 0) === 1) {
    ActorDespawn(obj);
    return;
  }
  if (G.g_active_cam_path === CLASS21_ABANDON_PATH
      && G.g_cam_path_frame === CLASS21_ABANDONED_DESPAWN_FRAME) {
    ActorDespawn(obj);
    return;
  }
  RescueTargetPoseFromRouteWithVelocity(obj, f);
  RescueTargetDraw(obj, f);
  ActorAdvanceMotion(obj, f.dt);
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
    case RescueTargetState.Freed: RescueTargetFreedState(obj, f); break;
    case RescueTargetState.Abandoned: RescueTargetAbandonedState(obj, f); break;
    case RescueTargetState.Sinking:
      RescueTargetSinkAndDespawnState(obj, f);
      break;
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
  // Every routine steps `obj+0x194` itself, after its draw -- and two do not
  // step it at all: `RescueTargetFreedState` on the frame its clip ends and
  // the sink after it, which is what holds the body on the clip's last frame.
  advancesOwnMotion: true,
  // The class reads `obj+0x34` bit 3 itself and charges one hit point a part;
  // `ResolveHit` would look up a damage row it has no entry in.
  ownsShotResult: true,
  outlivedByReplay: RescueTargetOutlivedByReplay,
  debug: RescueTargetDebug,
};

registerClass(SpawnClass.RankScaledEnemy, RescueTargetHandler);
