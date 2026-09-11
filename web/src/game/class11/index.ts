/**
 * Class 0x11 — **the frog**.
 *
 * Settled three ways rather than guessed. Its descriptor tail's first word is
 * a **character type**, `0x1B` in all four shipped spawns, and
 * `g_character_skeletons` (`0x004E0430`) resolves that to **`frog.bin`**, 15
 * bones. Every draw slot the class writes — `0xB90`..`0xBB2` — is an entry of
 * the same file. And `FrogStateIdleAndCroak` plays `COMMON\KAERU4_22.WAV`;
 * *kaeru* is Japanese for frog.
 *
 * **One shot kills it.** There is no hit-point arithmetic anywhere in the
 * class: `obj+0x11C`, which the descriptor sets to 1, is stored zero once and
 * never compared. It is worth 80 points and it counts into both enemy
 * counters, so a `wait_enemies_alive` cannot come down while one is on screen.
 *
 * ## Four spawns, and they are all in one place
 *
 * Stage 1, block 3, step 1, from a single `spawn_obj_tail` (0x0C)
 * instruction. Each waits for camera path 41 to reach a frame of its own,
 * turns to a fixed heading, runs at most one further command, and then falls
 * into the autonomous chooser for ever.
 *
 * ## The command list is the class
 *
 * `tail+0x0A` is a list of s16 opcodes terminated by `0xFFFF`, and the opcode
 * **is the state** — its low byte is written straight into `sub+0x04`. Three
 * of the eight take operands. When the list runs out the cursor stops on the
 * terminator and `FrogReadNextScriptCommand` switches to choosing states
 * itself: inside fifty units of the camera it claims an attack permit and
 * leaps, and outside it rolls a new way to hop about.
 *
 * ## What is not ported
 *
 * `[diverges]` **The wedge clamp reads the wrong camera yaw.** The engine's
 * `FrogStateHopWithinScreenWedge` clamps its chosen heading against two
 * screen-edge rays built from **camera block 2's** yaw, the s32 at
 * `0x009A6418` — `g_camera_blocks + 2 * 0x1A4 + 0x90` — while the same class's
 * state 0 waits on **camera block 0's** path frame. The port has one camera
 * yaw, `g_camera_yaw_bams`, so it uses that for both. Why the engine is
 * asymmetric is `[open]`; nothing in the class explains it.
 *
 * `[diverges]` **The head-look fix-up is not ported.** After each 45° turn the
 * engine counter-rotates bone 1 through `MatrixDecomposeEuler` so the head
 * keeps its world orientation while the body turns. That works on
 * `part+0x10C..0x114`, per-bone Euler angles the port has no field for; the
 * same gap stops class 0x30's equivalent.
 *
 * `[diverges]` **`FrogPushOutOfActorCollision` is not ported.** It transforms
 * `part+0x130` through the camera-block matrix and adds the collision normal
 * to the **world** position, and whether that point is view space or world
 * space is `[open]` — the matrix chain says one and the use says the other.
 * Porting it under the wrong reading would push frogs the wrong way, which is
 * worse than not pushing them.
 */
import type { Rng } from "../../core/rng";
import type { Events } from "../../core/events";
import { ActorFlag, type Actor } from "../actor";
import { ActorSetMotionBlended } from "../class30/motion_cue";
import { PlayerTakeDamage } from "../combat/player";
import { ScoreAddForPlayer } from "../combat/score";
import { ActorDespawn } from "../despawn";
import { SpawnBoneHitSprite } from "../effects/blood";
import { G } from "../globals";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";
import { MotionPlayFrame, MotionPlayLength } from "../tables";
import { FrogFlag, FrogState, type FrogTail } from "./state";

export { FrogFlag, FrogState } from "./state";
export type { FrogTail } from "./state";

/** BAMS to radians, and back — the engine's own two constants. */
const BAMS = (Math.PI * 2) / 65536;
const TO_BAMS = 65536 / (Math.PI * 2);

// -- the numbers the routines spell as literals ----------------------------

/** `frog.bin` is character type 0x1B, and every shipped spawn carries it. */
export const FROG_CHAR_TYPE = 0x1b;
/** `obj+0x5C` — the gravity `FrogIntegrateVelocityAndGravity` adds. */
export const FROG_GRAVITY = -0.0272222;
/** `obj+0x124` — `g_actor_radius_by_char[0x1B]`, the shot sphere. */
export const FROG_HIT_RADIUS = 10.0;
/** `obj+0x128` — the actor-versus-actor radius. */
export const FROG_BODY_RADIUS = 3.0;
/** `ScoreAddForPlayer(p, 0x50)`. */
export const FROG_SCORE = 0x50;

/** The nine motions of bank 14, which is also named `frog.bin`. */
export enum FrogMotion {
  /** The leap, 119 ticks. */
  Leap = 0x13e,
  /** The death clip, 10 ticks. */
  Death = 0x13f,
  /** The travelling hop, 60 ticks. */
  Hop = 0x140,
  /** Idle, 59 ticks — the descriptor default and the landing pose. */
  Idle = 0x141,
  /** Turn left, 30 ticks, worth +45° a pass. */
  TurnLeft = 0x142,
  /** Turn right, 30 ticks, worth -45°. */
  TurnRight = 0x143,
  /** The stationary hop, 59 ticks. */
  HopInPlace = 0x144,
}

/** `0x1555` — 65536/12, thirty degrees: the turn that wants a turn clip. */
export const FROG_TURN_THRESHOLD = 0x1555;
/** ...and `0x1000` for the leap, which is fussier about its aim. */
export const FROG_LEAP_TURN_THRESHOLD = 0x1000;
/** What one pass of a turn clip is worth. */
export const FROG_TURN_PER_CLIP = 0x2000;
/** ...and what one frame of the stationary hop is worth. */
export const FROG_TURN_PER_FRAME = 0x40;
/** The frames the travelling hop launches and lands on. */
export const FROG_HOP_LAUNCH_FRAME = 0x12;
export const FROG_HOP_STOP_FRAME = 0x2c;
/** ...and the leap's three. */
export const FROG_LEAP_LAUNCH_FRAME = 0x1e;
export const FROG_LEAP_CONNECT_FRAME = 0x3c;
export const FROG_LEAP_RECOVER_FADE = 0x3d;
/** `PlayerTakeDamage(player, 1, 9)` — the frog's damage kind. */
export const FROG_DAMAGE_KIND = 9;
/** The leap's flight, and the gravity pre-compensation `(n - 1) / 2`. */
export const FROG_LEAP_FRAMES = 30;
export const FROG_LEAP_GRAVITY_COMP = 14.5;
/** How far in front of the camera the leap lands, and its two offsets. */
export const FROG_LEAP_DEPTH = -12.5;
export const FROG_LEAP_SIDE = 3.0;
export const FROG_LEAP_NUDGE = 3.0;
/** The three camera distances the autonomous chooser reads. */
export const FROG_LEAP_RANGE = 50.0;
export const FROG_FACING_RANGE = 53.0;
export const FROG_APPROACH_RANGE = 76.0;
/** `FrogStateHopWithinScreenWedge`: where state 2 stops, and where it slows. */
export const FROG_STOP_SHORT = 26.0;
export const FROG_SLOW_RANGE = 40.0;
/** The heading window's two widths, and the clamp on the result. */
export const FROG_WINDOW_HALF = 0x1800;
export const FROG_WINDOW_FULL = 0x3000;
export const FROG_HEADING_CLAMP = 0x2000;
/** `-0x200` — the margin taken off the half-FOV for the default wedge. */
export const FROG_WEDGE_MARGIN = 0x200;
/**
 * `g_projection_distance_px` — 0x009A2D70, against a 640x480 frame, so the
 * half-FOV is `atan2(320, this)`.
 */
export const PROJECTION_DISTANCE_PX = 640.2;
/** The bone-2 model run: thirty entries over a fifty-nine tick triangle. */
export const FROG_BONE2_FIRST_SLOT = 0xb94;
export const FROG_BONE2_MODELS = 30;
export const FROG_BONE2_PERIOD = 0x3b;
/** Bone 1's model once the frog is dead. */
export const FROG_CORPSE_SLOT = 0xb91;
/** The corpse: how hard it is thrown, how it bounces, and how long it sinks. */
export const FROG_DEATH_KICK = -0.5;
export const FROG_BOUNCE = -0.3;
export const FROG_FRICTION = 0.6;
export const FROG_FRICTION_FLAT = 0.8;
export const FROG_REST_SPEED = 0.05;
export const FROG_SINK_SPEED = -0.035;
export const FROG_SINK_FRAMES = 0xb4;
/** The idle's two draws: 64..89 frames, croaking 0..25 frames before the end. */
export const FROG_IDLE_BASE = 0x40;
export const FROG_IDLE_SPREAD = 0x1a;

/** `COMMON\BLOOD07_16.WAV`, and `COMMON\KAERU4_22.WAV`. */
export const SND_FROG_KILLED = 0x716a9;
export const SND_FROG_CROAK = 0x3716a9;

function Tail(obj: Actor): FrogTail | null {
  return (obj as Actor & { frog?: FrogTail }).frog ?? null;
}

function play(events: Events | undefined, id: number): void {
  events?.emit("sound.play", { id });
}

/** Sign-extend to the s16 the engine keeps every angle in. */
function s16(v: number): number {
  return (v << 16) >> 16;
}

/** `ftol(atan2(x, z) * 10430.378)` — the engine's angle, in BAMS. */
function BamsOf(x: number, z: number): number {
  return Math.trunc(Math.atan2(x, z) * TO_BAMS);
}

/**
 * The heading from the frog to a point, **in the frog's own frame**.
 *
 * The engine builds `RotY(-ry) * RotZ(-rz) * RotX(-rx)`, applies it to
 * `pos - target` and takes `atan2(d.x, d.z)`. A frog's `rx` and `rz` are never
 * written, so that whole product is a rotation by `-ry` and the result is the
 * world angle less the frog's own yaw. Written that way here because the port
 * has no roll field to be wrong about.
 */
function FrogHeadingTo(obj: Actor, tx: number, tz: number): number {
  return s16(BamsOf(obj.pos.x - tx, obj.pos.z - tz) - obj.yaw);
}

/**
 * `FrogReadGroundPlaneY` — `FUN_0043A990`.
 *
 * Two instructions — `FLD float ptr [g_camera_fixed_eye_y]` and `RET` — and it
 * **ignores all three of its arguments**, which its four callers all fill with
 * the actor's position. It is a constant, not a terrain query, whatever the
 * decompiler's three-float signature says.
 *
 * `g_camera_fixed_eye_y` — `0x009C8E58`.
 */
export function FrogReadGroundPlaneY(): number {
  return G.g_camera_fixed_eye_y;
}

/** Has the current clip finished? `part+0x08 >= g_motion_play_length`. */
function ClipDone(obj: Actor): boolean {
  return MotionPlayFrame(obj) >= MotionPlayLength(obj, obj.motion);
}

/** `if (part[0x20] != m) ActorSetMotionBlended(part, m, 0, 2)` — the whole class. */
function FrogPlay(obj: Actor, m: number, fade = 2): void {
  if (obj.motion !== m) ActorSetMotionBlended(obj, m, 0, fade);
}

// -- the Init --------------------------------------------------------------

/**
 * `FrogArmScriptFromDescriptorTail` — `FUN_0043A670`. One caller, `FrogInit`.
 *
 * ```c
 * sub->+0x04 = 0;  sub->+0x05 = 0;
 * sub->+0x18 = tail->+0x04;      // the camera path state 0 waits for
 * sub->+0x1C = tail->+0x06;      // ...and the frame
 * sub->+0x20 = 0x141;
 * sub->+0x10 = tail->+0x08 ? tail->+0x08
 *            : -0x200 - ftol(atan2(320.0, g_projection_distance_px) * -10430.378);
 * sub->+0x0C = tail + 0x0A;
 * ```
 *
 * The default wedge is the horizontal half-FOV less `0x200`, about 2.8°. Two
 * of the four shipped frogs take it and two carry `0x0D80`, nineteen degrees.
 */
export function FrogArmScriptFromDescriptorTail(obj: Actor): void {
  const sub = Tail(obj);
  const p = obj.class11;
  if (!sub || !p) return;
  sub.state = FrogState.WaitForCamera;
  sub.sub = 0;
  sub.a = p.cam_path;
  sub.b = p.cam_frame;
  sub.motion = FrogMotion.Idle;
  sub.wedge = p.wedge !== 0 ? p.wedge
    : s16(-FROG_WEDGE_MARGIN
          - Math.trunc(Math.atan2(320.0, PROJECTION_DISTANCE_PX) * -TO_BAMS));
  sub.cursor = 0;
}

/**
 * `FrogInit` — `FUN_0043A080`. Class 0x11's handler.
 *
 * ```c
 * sub = ActorAllocSub(0x38);  obj->+0x1310 = sub;  sub->+0x00 = 0;
 * FrogArmScriptFromDescriptorTail(obj);
 * sub->+0x0A = 0;  sub->+0x08 = 0;
 * obj->y = FrogReadGroundPlaneY();          // it ignores the position it is given
 * obj->+0x5C = -0.0272222;
 * obj->+0x1F4 = tail->+0x00;                // 0x1B, frog.bin
 * obj->+0x1B4 = tail->+0x02;                // 0x141 in all four
 * ActorBuildSkinnedModel(...);
 * obj->+0x124 = g_actor_radius_by_char[0x1B];   // 10.0
 * obj->+0x128 = 3.0;
 * g_enemies_present++;  g_enemies_alive++;
 * obj->+0x121 = -1;
 * *obj = FrogUpdate;
 * ```
 *
 * It never touches `obj+0x11C` or `+0x11E`: the spawn allocator has already
 * put the descriptor's `+0x22` in both, and nothing reads either again.
 */
export function FrogInit(obj: Actor, _rng?: Rng): void {
  const sub = Tail(obj);
  const p = obj.class11;
  if (!sub || !p) return;
  sub.flags = 0;
  FrogArmScriptFromDescriptorTail(obj);
  sub.boneCycle = 0;
  sub.boneSlot = 0;
  obj.pos.y = FrogReadGroundPlaneY();
  obj.accY = FROG_GRAVITY;
  obj.motion = p.motion;
  obj.playTicks = 0;
  obj.hitRadius = FROG_HIT_RADIUS;
  obj.bodyRadius = FROG_BODY_RADIUS;
  G.g_enemies_present += 1;
  G.g_enemies_alive += 1;
  obj.attackPermit = -1;
}

// -- being shot ------------------------------------------------------------

/**
 * `FrogAwardKillAndEnterDeath` — `FUN_0043A2E0`. Run first, every frame.
 *
 * The whole damage model, and there is no arithmetic in it. `obj+0x11C` is
 * stored zero as a **u16**, which takes `obj+0x11E` with it, and neither is
 * read again — so the first shot that raises `obj+0x34` bit 3 kills.
 * `obj+0x34` bit `0x4000000` is the latch that stops a second shot in the same
 * frame paying twice.
 *
 * The corpse model goes on here rather than in the death state: bone 1 takes
 * `frog.bin` 3 and bones 2 and 3 are blanked.
 */
export function FrogAwardKillAndEnterDeath(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  if (!(obj.flags & ActorFlag.Hit)) return;
  obj.hp = 0;
  obj.maxHp = 0;
  if (obj.flags & ActorFlag.Dead) return;
  obj.flags |= ActorFlag.Dead;
  sub.state = FrogState.Die;
  sub.sub = 0;
  sub.flags &= ~FrogFlag.WantCommand;
  obj.flags |= ActorFlag.ShotImmune;
  obj.boneSlot["1"] = FROG_CORPSE_SLOT;
  obj.boneSlot["2"] = 0;
  obj.boneSlot["3"] = 0;
  f.host.setBoneSlot(obj.at, 1, FROG_CORPSE_SLOT);
  f.host.setBoneSlot(obj.at, 2, 0);
  f.host.setBoneSlot(obj.at, 3, 0);
  SpawnBoneHitSprite(obj.at, 2);
  const byP0 = (obj.flags & ActorFlag.HitByPlayer0) !== 0;
  const byP1 = (obj.flags & ActorFlag.HitByPlayer1) !== 0;
  const who = byP0 && !byP1 ? 0 : byP1 && !byP0 ? 1 : f.rng.int(2);
  ScoreAddForPlayer(who, FROG_SCORE, f.events);
  G.g_player_hit_count[who] = (G.g_player_hit_count[who] ?? 0) + 1;
  play(f.events, SND_FROG_KILLED);
}

// -- the command reader, and the AI behind it ------------------------------

/**
 * `FrogReadNextScriptCommand` — `FUN_0043A710`. Class 0x11's whole mind.
 *
 * It runs every frame and does nothing unless a state has raised
 * {@link FrogFlag.WantCommand}. While the descriptor's list has commands left
 * it takes one; the **low byte of the opcode is the new state**, and only
 * commands 0 and 3 carry operands. Command 3's is an *absolute* heading, and
 * it is stored as the signed difference from the frog's current yaw.
 *
 * Past the `0xFFFF` terminator the cursor stops for good — nothing rewinds it
 * — and the second half takes over:
 *
 * * **inside fifty units** it goes for the leap, and that means claiming
 *   `g_attack_permits`. Which player depends on how many are in play and which
 *   permits are already out; if the one it picked is taken it falls back to
 *   idling rather than leaping without a permit.
 * * **outside fifty** it rolls a new way to hop, then downgrades a travelling
 *   hop to a stationary one inside fifty-three units and to the approaching
 *   kind inside seventy-six.
 */
export function FrogReadNextScriptCommand(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  const p = obj.class11;
  if (!sub || !p) return;
  if (!(sub.flags & FrogFlag.WantCommand)) return;
  sub.flags &= ~FrogFlag.WantCommand;

  const cmd = p.commands[sub.cursor];
  if (cmd !== undefined) {
    sub.cursor += 1;
    sub.state = (cmd.op & 0xff) as FrogState;
    if (sub.state === FrogState.WaitForCamera) {
      sub.a = cmd.args[0] ?? 0;
      sub.b = cmd.args[1] ?? 0;
      sub.motion = cmd.args[2] ?? 0;
    } else if (sub.state === FrogState.HopToHeading) {
      let t = (cmd.args[0] ?? 0) - s16(obj.yaw);
      t &= 0xffff;
      if (t >= 0x8000) t -= 0x10000;
      sub.a = t;
    }
    sub.sub = 0;
    return;
  }

  if (sub.camDist < FROG_LEAP_RANGE) {
    sub.state = FrogState.LeapAtPlayer;
    // **The engine's free value for `g_attack_permits` is zero**, not -1:
    // `ReleaseAttackSlot` (`FUN_00456520`) opens with `XOR EDX, EDX` and
    // writes that, and this routine tests `!= 0` for "taken" and writes a
    // literal 1 to claim. The port's array holds -1 for free and the holder's
    // `at` otherwise — a `[port-only]` choice `globals.ts` records, made
    // because a pointer is not an `at` — so the tests below are in the port's
    // spelling. The behaviour is the engine's; only the sentinel differs.
    if (G.g_players_in_play === 1) {
      obj.attackPermit = G.g_active_player;
    } else if (G.g_players_in_play === 2) {
      if (G.g_attack_permits[0] !== -1) obj.attackPermit = 1;
      else if (G.g_attack_permits[1] !== -1) obj.attackPermit = 0;
      else obj.attackPermit = f.rng.int(2);
    } else {
      sub.state = FrogState.IdleAndCroak;
    }
    if (sub.state === FrogState.LeapAtPlayer) {
      const who = obj.attackPermit;
      if (G.g_attack_permits[who] !== -1) {
        sub.state = FrogState.IdleAndCroak;
        obj.attackPermit = -1;
      } else {
        G.g_attack_permits[who] = obj.at;
      }
    }
    sub.sub = 0;
    return;
  }

  switch (sub.state) {
    case FrogState.WaitForCamera:
    case FrogState.HopInPlace:
    case FrogState.IdleAndCroak:
      sub.state = FrogState.HopAcross;
      break;
    case FrogState.HopAcross:
    case FrogState.HopToHeading: {
      const r = f.rng.int(0x8000) % 6;
      if (r === 0) sub.state = FrogState.IdleAndCroak;
      else if (r <= 2) sub.state = FrogState.HopInPlace;
      else sub.state = FrogState.HopAcross;
      break;
    }
    default:
      break;
  }
  if (sub.state === FrogState.HopAcross) {
    if (sub.camDist < FROG_FACING_RANGE) sub.state = FrogState.HopInPlaceFacing;
    else if (sub.camDist < FROG_APPROACH_RANGE) sub.state = FrogState.HopToward;
  }
  sub.sub = 0;
}

// -- the states ------------------------------------------------------------

/**
 * `FrogStateWaitForCamPathFrame` — `FUN_0043A9A0`. State 0.
 *
 * Substate 0 starts `sub+0x20` and falls **straight through** into substate
 * 1's test, so a frog whose cue has already passed leaves on its first frame.
 */
export function FrogStateWaitForCamPathFrame(obj: Actor): void {
  const sub = Tail(obj);
  if (!sub) return;
  if (sub.sub === 0) {
    FrogPlay(obj, sub.motion);
    sub.sub += 1;
  } else if (sub.sub !== 1) return;
  if (G.g_active_cam_path === sub.a && G.g_cam_path_frame >= sub.b) {
    sub.flags |= FrogFlag.WantCommand;
  }
}

/**
 * The heading window states 1 and 2 start from, before the wedge clamp.
 *
 * `obj+0x70` and `obj+0x78` are the frog's tracked point in the camera's own
 * space, so the tests are "which side of the screen am I on" and the offsets
 * turn the hop across the view rather than out of it. State 1 has three arms
 * and state 2 two, and the widths are `0x1800` except for state 1's middle
 * arm, which is the full `0x3000`.
 */
function FrogHeadingWindow(state: FrogState, aim: number,
                           view: { x: number; z: number }):
                           { base: number; width: number } {
  if (state === FrogState.HopAcross) {
    if (-view.z * 0.25 < view.x) {
      return { base: aim - FROG_WINDOW_HALF, width: FROG_WINDOW_HALF };
    }
    if (view.z * 0.25 >= view.x) {
      return { base: aim - FROG_WINDOW_HALF, width: FROG_WINDOW_FULL };
    }
    return { base: aim, width: FROG_WINDOW_HALF };
  }
  if (view.x > 0) {
    return { base: aim - FROG_WINDOW_HALF, width: FROG_WINDOW_HALF };
  }
  return { base: aim, width: FROG_WINDOW_HALF };
}

/**
 * The clamp that keeps the hop on screen, from `0x0043AC1B` and `0x0043AC8A`.
 *
 * Two rays leave the camera at `±sub+0x10` from its yaw. For each, the frog's
 * perpendicular distance is measured, and when that is under twenty-six units
 * the window's end is pulled in by `asin(distance / 26)` — so a frog already
 * on the edge is clamped exactly to the edge and one well inside is not
 * clamped at all.
 *
 * `[likely] asin` — `0x004AD0B0` is an FPU intrinsic thunk with no Ghidra
 * function, and `asin` is the only reading under which the correction
 * vanishes at the boundary. `[open]` between `asin` and `acos` from the code.
 *
 * The two blocks' `10430.378` multiplies have **opposite signs**, which is why
 * this is written out twice rather than looped.
 */
function FrogClampToWedge(obj: Actor, eye: { x: number; z: number },
                          wedge: number, win: { base: number; width: number }):
                          void {
  const camYaw = G.g_camera_yaw_bams;
  const dx = obj.pos.x - eye.x;
  const dz = obj.pos.z - eye.z;
  const halfFov = Math.trunc(Math.atan2(320.0, PROJECTION_DISTANCE_PX)
                             * TO_BAMS);
  const perp = (ang: number): number => {
    const r = s16(ang) * BAMS;
    return Math.abs(Math.cos(r) * dx - Math.sin(r) * dz);
  };
  const e1 = perp(camYaw + wedge - 0x8000);
  const e2 = perp(camYaw - wedge - 0x8000);
  if (e1 < FROG_STOP_SHORT) {
    const t = Math.trunc(Math.asin(e1 / FROG_STOP_SHORT) * -TO_BAMS);
    const v = s16(halfFov - t - s16(obj.yaw) + camYaw + 0x4000);
    if (v > win.base) {
      win.base = v;
      if (win.width <= 0) win.width = 0;
    }
  }
  if (e2 < FROG_STOP_SHORT) {
    const t = Math.trunc(Math.asin(e2 / FROG_STOP_SHORT) * TO_BAMS);
    const v = s16(-halfFov - t - s16(obj.yaw) + camYaw - 0x4000);
    if (v < win.base + win.width) {
      if (v >= win.base) win.width = v - win.base;
      else { win.base = v; win.width = 0; }
    }
  }
}

/** Draw a heading out of `[base, base+width]`, clamped to ±0x2000. */
function FrogPickHeading(base: number, width: number, rng: Rng): number {
  const C = FROG_HEADING_CLAMP;
  if (base > C) return base;
  if (base + width > C) return base + rng.int(C + 1 - base);
  if (base + width < -C) return base + width;
  if (base < -C) return rng.int(base + width + C + 1) - C;
  return base + rng.int(width + 1);
}

/**
 * `FrogStateHopWithinScreenWedge` — `FUN_0043AA10`. States 1, 2 and 3.
 *
 * Five substates. **State 3 skips the aiming**: command 3 has already put an
 * absolute turn in `sub+0x18` and the routine goes straight to the turn
 * selector, which is why one routine serves three states.
 *
 * The turn is taken 45° at a time, one pass of clip `0x142` or `0x143` each,
 * until what is left fits inside 45°; then clip `0x140` runs and the launch is
 * on its frame 18, the stop on frame 44. The residual is **halved every
 * frame** through the flight, so the frog keeps turning as it travels.
 *
 * State 2's speed is the only one that is not a draw: it falls linearly to
 * zero as the camera distance reaches forty, so the frog stops twenty-six
 * units short rather than landing on the player.
 *
 * ⚠ Ghidra drops 687 bytes of this function at `0x0043AAC8`..`0x0043AD76` and
 * 42 more at `0x0043AF04`..`0x0043AF2D` — read literally the pseudocode says
 * the frog never picks a heading. See `docs/LESSONS.md`.
 */
export function FrogStateHopWithinScreenWedge(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  switch (sub.sub) {
    case 0: {
      if (sub.state !== FrogState.HopToHeading) {
        const aim = FrogHeadingTo(obj, f.eye.x, f.eye.z);
        const view = { x: 0, z: 0 };
        const p = { x: 0, y: 0, z: 0 };
        if (f.host.viewSpaceOf(obj.at, p)) { view.x = p.x; view.z = p.z; }
        const win = FrogHeadingWindow(sub.state, aim, view);
        FrogClampToWedge(obj, f.eye, sub.wedge, win);
        sub.a = FrogPickHeading(win.base, win.width, f.rng);
      }
      if (sub.a > FROG_TURN_THRESHOLD) {
        FrogPlay(obj, FrogMotion.TurnLeft);
        sub.sub = 1;
      } else if (sub.a < -FROG_TURN_THRESHOLD) {
        FrogPlay(obj, FrogMotion.TurnRight);
        sub.sub = 1;
      } else {
        FrogPlay(obj, FrogMotion.Hop);
        sub.sub = 2;
      }
      return;
    }
    case 1: {
      if (!ClipDone(obj)) return;
      const delta = obj.motion === FrogMotion.TurnLeft
        ? FROG_TURN_PER_CLIP : -FROG_TURN_PER_CLIP;
      obj.yaw = s16(obj.yaw + delta);
      sub.a -= delta;
      if (Math.abs(sub.a) <= FROG_TURN_PER_CLIP) {
        FrogPlay(obj, FrogMotion.Hop);
        sub.sub = 2;
      }
      return;
    }
    case 2: {
      if (MotionPlayFrame(obj) !== FROG_HOP_LAUNCH_FRAME) return;
      const th = s16(obj.yaw + sub.a) * BAMS;
      const s = Math.sin(th);
      const c = Math.cos(th);
      let speed: number;
      if (sub.state === FrogState.HopToward) {
        const ddx = obj.pos.x - s * FROG_STOP_SHORT - f.eye.x;
        const ddz = obj.pos.z - c * FROG_STOP_SHORT - f.eye.z;
        speed = Math.hypot(ddx, ddz) >= FROG_SLOW_RANGE
          ? -1.0 : (sub.camDist - FROG_SLOW_RANGE) / -FROG_STOP_SHORT;
      } else if (sub.state === FrogState.HopToHeading) {
        speed = -1.0;
      } else {
        speed = (10 - f.rng.int(5)) * -0.1;
      }
      obj.vel.x = speed * s;
      obj.vel.z = speed * c;
      sub.sub = 3;
      return;
    }
    case 3: {
      if (sub.a !== 0) {
        obj.yaw = s16(obj.yaw + Math.trunc(sub.a / 2));
        sub.a = Math.trunc(sub.a / 2);
      }
      if (MotionPlayFrame(obj) !== FROG_HOP_STOP_FRAME) return;
      obj.vel.x = 0;
      obj.vel.z = 0;
      sub.sub = 4;
      return;
    }
    default:
      if (ClipDone(obj)) sub.flags |= FrogFlag.WantCommand;
  }
}

/**
 * `FrogStateHopInPlace` — `FUN_0043B0E0`. States 4 and 5.
 *
 * Clip `0x144` and no velocity at all, so neither state translates. The only
 * difference is the turn: state 5 aims at the camera, state 4 keeps what it
 * had, and both turn `0x40` a frame — about a third of a degree — until the
 * clip runs out.
 *
 * ⚠ 37 bytes dropped at `0x0043B212`..`0x0043B236`, and they are the ones that
 * make state 5 aim.
 */
export function FrogStateHopInPlace(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  if (sub.sub === 0) {
    sub.a = sub.state === FrogState.HopInPlaceFacing
      ? FrogHeadingTo(obj, f.eye.x, f.eye.z) : 0;
    FrogPlay(obj, FrogMotion.HopInPlace);
    sub.sub += 1;
    return;
  }
  const t = sub.a;
  if (t !== 0) {
    if (t > FROG_TURN_PER_FRAME) {
      obj.yaw = s16(obj.yaw + FROG_TURN_PER_FRAME);
      sub.a -= FROG_TURN_PER_FRAME;
    } else if (t < -FROG_TURN_PER_FRAME) {
      obj.yaw = s16(obj.yaw - FROG_TURN_PER_FRAME);
      sub.a += FROG_TURN_PER_FRAME;
    } else {
      obj.yaw = s16(obj.yaw + t);
      sub.a = 0;
    }
  }
  if (ClipDone(obj)) sub.flags |= FrogFlag.WantCommand;
}

/**
 * `FrogStateLeapAtPlayer` — `FUN_0043B270`. State 6, the attack.
 *
 * Six substates, and the shape is the travelling hop's with three
 * differences: it aims at a point in the camera's own space rather than at a
 * heading, it hands over to the leap clip within 22.5° instead of 45°, and it
 * **connects on a motion frame rather than on a range test** — nothing checks
 * whether the frog got there.
 *
 * The launch is a thirty-frame ballistic solve: horizontal velocity is the
 * displacement over thirty, and the vertical adds `-gravity * 14.5` so the
 * constant `-0.0272222` brings it back to the target height twenty-nine frames
 * later.
 *
 * Substate 5 is the exit, and it is not a death: a frog that lands its attack
 * gives the permit back, drops both enemy counters and despawns, scoring
 * nothing.
 *
 * ⚠ Ghidra drops 288 bytes at `0x0043B3F2`..`0x0043B50E` and 75 more at
 * `0x0043B62D`..`0x0043B677`; read literally, substate 0 never advances.
 */
export function FrogStateLeapAtPlayer(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  switch (sub.sub) {
    case 0: {
      const side = G.g_max_attackers === 1
        ? 0 : (obj.attackPermit * 2 - 1) * FROG_LEAP_SIDE;
      const drop = (f.rng.int(3) - 1) * FROG_LEAP_SIDE - FROG_LEAP_SIDE;
      const t = { x: 0, y: 0, z: 0 };
      f.host.viewPoint(side, drop, FROG_LEAP_DEPTH, t);
      sub.targetX = t.x;
      sub.targetY = t.y;
      sub.targetZ = t.z;
      sub.a = FrogHeadingTo(obj, sub.targetX, sub.targetZ);
      const th = s16(obj.yaw + sub.a) * BAMS;
      sub.targetX += FROG_LEAP_NUDGE * Math.sin(th);
      sub.targetZ += FROG_LEAP_NUDGE * Math.cos(th);
      if (sub.a > FROG_LEAP_TURN_THRESHOLD) {
        FrogPlay(obj, FrogMotion.TurnLeft);
        sub.sub = 1;
      } else if (sub.a < -FROG_LEAP_TURN_THRESHOLD) {
        FrogPlay(obj, FrogMotion.TurnRight);
        sub.sub = 1;
      } else {
        FrogPlay(obj, FrogMotion.Leap);
        sub.sub = 2;
      }
      return;
    }
    case 1: {
      if (!ClipDone(obj)) return;
      const delta = obj.motion === FrogMotion.TurnLeft
        ? FROG_TURN_PER_CLIP : -FROG_TURN_PER_CLIP;
      obj.yaw = s16(obj.yaw + delta);
      sub.a -= delta;
      if (Math.abs(sub.a) <= FROG_LEAP_TURN_THRESHOLD) {
        FrogPlay(obj, FrogMotion.Leap);
        sub.sub = 2;
      }
      return;
    }
    case 2: {
      if (MotionPlayFrame(obj) !== FROG_LEAP_LAUNCH_FRAME) return;
      const n = 1 / FROG_LEAP_FRAMES;
      obj.vel.x = (sub.targetX - obj.pos.x) * n;
      obj.vel.z = (sub.targetZ - obj.pos.z) * n;
      obj.vel.y = (sub.targetY - obj.pos.y) * n
        - obj.accY * FROG_LEAP_GRAVITY_COMP;
      sub.flags |= FrogFlag.CycleRunning;
      sub.sub = 3;
      return;
    }
    case 3: {
      if (sub.a !== 0) {
        obj.yaw = s16(obj.yaw + Math.trunc(sub.a / 2));
        sub.a = Math.trunc(sub.a / 2);
      }
      if (MotionPlayFrame(obj) !== FROG_LEAP_CONNECT_FRAME) return;
      obj.vel.x = 0;
      obj.vel.y = 0;
      obj.vel.z = 0;
      sub.flags |= FrogFlag.NoGravity;
      FrogPlay(obj, FrogMotion.Idle);
      PlayerTakeDamage(obj.attackPermit, obj, FROG_DAMAGE_KIND, f.events,
                       "strike");
      sub.sub = 4;
      return;
    }
    case 4: {
      if (!(sub.flags & FrogFlag.CycleWrapped)) return;
      sub.flags &= ~(FrogFlag.CycleRunning | FrogFlag.CycleWrapped
                     | FrogFlag.NoGravity);
      FrogPlay(obj, FrogMotion.Leap, FROG_LEAP_RECOVER_FADE);
      sub.sub = 5;
      return;
    }
    default: {
      if (obj.pos.y > FrogReadGroundPlaneY()) return;
      if (obj.attackPermit !== -1) G.g_attack_permits[obj.attackPermit] = -1;
      obj.attackPermit = -1;
      G.g_enemies_alive -= 1;
      G.g_enemies_present -= 1;
      ActorDespawn(obj);
    }
  }
}

/**
 * `FrogStateIdleAndCroak` — `FUN_0043B880`. State 7.
 *
 * Two draws arm it: 64 to 89 frames of idling, and a croak 0 to 25 frames
 * before the end of that. The croak starts the bone-2 cycle and plays
 * `COMMON\KAERU4_22.WAV`, which is the sound that names the class.
 */
export function FrogStateIdleAndCroak(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  if (sub.sub === 0) {
    FrogPlay(obj, FrogMotion.Idle);
    sub.a = f.rng.int(FROG_IDLE_SPREAD) + FROG_IDLE_BASE;
    sub.b = sub.a - f.rng.int(FROG_IDLE_SPREAD);
    sub.sub = 1;
  }
  if (!(sub.flags & FrogFlag.CycleRunning)) {
    if (sub.a === sub.b) {
      sub.flags |= FrogFlag.CycleRunning;
      FrogPlay(obj, FrogMotion.Idle);
      play(f.events, SND_FROG_CROAK);
    }
  } else if (sub.flags & FrogFlag.CycleWrapped) {
    sub.flags &= ~(FrogFlag.CycleRunning | FrogFlag.CycleWrapped);
    FrogPlay(obj, FrogMotion.Idle);
  }
  const t = sub.a;
  sub.a = t - 1;
  if (t === 0) sub.flags |= FrogFlag.WantCommand;
}

/**
 * `FrogStateDieTumbleAndSink` — `FUN_0043B990`. State 8.
 *
 * The corpse is **thrown away from the camera** — `(0, 0, -0.5)` rotated
 * through the camera basis — then bounced on the ground plane at thirty per
 * cent restitution with sixty per cent friction, eighty once it is flat, each
 * axis snapping to zero below 0.05. When it has settled on the last frame of
 * the death clip it sinks at 0.035 a frame for exactly 180 frames and goes.
 *
 * The alive count comes down here and the present count 180 frames later, and
 * that gap is the whole reason the two counters exist.
 *
 * ⚠ 39 bytes dropped at `0x0043BB68`..`0x0043BB8E`, and they are the ones that
 * zero the flag word — which also turns gravity back on — and release the
 * attack permit.
 */
export function FrogStateDieTumbleAndSink(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  const ground = FrogReadGroundPlaneY();
  if (sub.sub === 0) {
    obj.motion = FrogMotion.Death;
    ActorSetMotionBlended(obj, FrogMotion.Death, 0, 2);
    obj.flags &= ~ActorFlag.PoseFrozen;
    if (!(obj.flags & ActorFlag.KeepCameraWhenLast) || G.g_enemies_alive !== 1) {
      obj.flags |= ActorFlag.NoCameraTrack;
    }
    G.g_enemies_alive -= 1;
    // `(0, 0, -0.5)` through rows 0..2 of the camera block matrix with a zero
    // translation: the corpse is thrown along the camera's own -Z, which is
    // away from the eye and into the screen.
    const away = { x: 0, y: 0, z: 0 };
    f.host.viewPoint(0, 0, FROG_DEATH_KICK, away);
    obj.vel.x = away.x - f.eye.x;
    obj.vel.y = away.y - f.eye.y;
    obj.vel.z = away.z - f.eye.z;
    sub.flags = 0;
    if (obj.attackPermit !== -1) G.g_attack_permits[obj.attackPermit] = -1;
    sub.sub = 1;
    return;
  }
  if (sub.sub === 1) {
    if (obj.pos.y <= ground) {
      obj.pos.y = ground;
      if (obj.vel.y === 0) {
        obj.vel.x *= FROG_FRICTION_FLAT;
        obj.vel.z *= FROG_FRICTION_FLAT;
      } else {
        obj.vel.y *= FROG_BOUNCE;
        obj.vel.x *= FROG_FRICTION;
        obj.vel.z *= FROG_FRICTION;
        if (obj.vel.y < FROG_REST_SPEED) obj.vel.y = 0;
      }
      if (Math.abs(obj.vel.x) < FROG_REST_SPEED) obj.vel.x = 0;
      if (Math.abs(obj.vel.z) < FROG_REST_SPEED) obj.vel.z = 0;
      if (obj.vel.x === 0 && obj.vel.y === 0 && obj.vel.z === 0
          && MotionPlayFrame(obj) === MotionPlayLength(obj, obj.motion)) {
        obj.vel.y = FROG_SINK_SPEED;
        sub.a = FROG_SINK_FRAMES;
        sub.sub = 2;
      }
    }
    if (MotionPlayFrame(obj) === MotionPlayLength(obj, obj.motion) - 1) {
      obj.flags |= ActorFlag.PoseFrozen;
    }
    return;
  }
  const t = sub.a;
  sub.a = t - 1;
  if (t !== 0) return;
  G.g_enemies_present -= 1;
  ActorDespawn(obj);
}

// -- the frame -------------------------------------------------------------

/**
 * `FrogIntegrateVelocityAndGravity` — `FUN_0043A3D0`.
 *
 * The y is integrated **before** the gravity test, and gravity is added only
 * while the frog is above the ground plane and {@link FrogFlag.NoGravity} is
 * clear.
 */
export function FrogIntegrateVelocityAndGravity(obj: Actor): void {
  const sub = Tail(obj);
  if (!sub) return;
  obj.pos.x += obj.vel.x;
  obj.pos.z += obj.vel.z;
  obj.pos.y += obj.vel.y;
  if (FrogReadGroundPlaneY() < obj.pos.y && !(sub.flags & FrogFlag.NoGravity)) {
    obj.vel.y += obj.accY;
  }
}

/**
 * `FrogDrawAndCycleBone2Slot` — `FUN_0043A440`, the state half of it.
 *
 * A free-running counter, a triangle wave over fifty-nine ticks, and bone 2's
 * draw slot is `0xB94 + n` for `n` in 0..29 — `frog.bin` entries 6 to 35,
 * ending exactly where bone 3's own model begins. The wrap raises
 * {@link FrogFlag.CycleWrapped}, which is what the croak and the leap wait on.
 *
 * `[diverges]` in shape: the engine draws and cycles in one routine because a
 * task is its own renderer. `game/` may not draw, so this is the cycle and
 * `render/characters.ts` reads the slot.
 */
export function FrogDrawAndCycleBone2Slot(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  if (sub.flags & FrogFlag.CycleRunning) {
    sub.boneCycle = s16(sub.boneCycle + 1);
    const q = sub.boneCycle % FROG_BONE2_PERIOD;
    if (q === FROG_BONE2_PERIOD - 1) {
      sub.flags |= FrogFlag.CycleWrapped;
      sub.boneSlot = 0;
    } else {
      sub.flags &= ~FrogFlag.CycleWrapped;
      sub.boneSlot = q < FROG_BONE2_MODELS ? q : FROG_BONE2_PERIOD - 1 - q;
    }
  }
  if (obj.flags & ActorFlag.Dead) return;
  const slot = FROG_BONE2_FIRST_SLOT + sub.boneSlot;
  if (obj.boneSlot["2"] === slot) return;
  obj.boneSlot["2"] = slot;
  f.host.setBoneSlot(obj.at, 2, slot);
}

/** `g_class11_states` — 0x00592660. Ten cells, and the tenth is unreachable. */
const g_class11_states: Record<number, (obj: Actor, f: ClassFrame) => void> = {
  [FrogState.WaitForCamera]: (o) => FrogStateWaitForCamPathFrame(o),
  [FrogState.HopAcross]: FrogStateHopWithinScreenWedge,
  [FrogState.HopToward]: FrogStateHopWithinScreenWedge,
  [FrogState.HopToHeading]: FrogStateHopWithinScreenWedge,
  [FrogState.HopInPlace]: FrogStateHopInPlace,
  [FrogState.HopInPlaceFacing]: FrogStateHopInPlace,
  [FrogState.LeapAtPlayer]: FrogStateLeapAtPlayer,
  [FrogState.IdleAndCroak]: FrogStateIdleAndCroak,
  [FrogState.Die]: FrogStateDieTumbleAndSink,
  // `g_class11_states[9]` is `NoOpStub` (`FUN_0041EBB0`) and is unreachable.
};

/**
 * `FrogUpdate` — `FUN_0043A1E0`. Ghidra had no function there.
 *
 * ```c
 * sub->+0x14 = hypot(pos.z - eye.z, pos.x - eye.x);   // 2-D: y is ignored
 * FrogAwardKillAndEnterDeath(obj);
 * FrogReadNextScriptCommand(obj);
 * g_class11_states[sub->+0x04](obj);
 * FrogIntegrateVelocityAndGravity(obj);
 * FrogDrawAndCycleBone2Slot(obj);
 * ActorRegisterCameraPoint(1.0f);
 * FrogPushOutOfActorCollision(obj);
 * ```
 *
 * The order is load-bearing. The shot is consumed **before** the state runs,
 * so the frame a frog is hit is the first frame of its death; the state sets
 * velocity and the integrator applies it afterwards; and the actor-versus-actor
 * push is last, after the draw.
 *
 * `ActorRegisterCameraPoint` takes **1.0** here, against 4.0 for a class-0x30
 * zombie and 0 for a class-0x31 thrower — the height the camera looks at.
 */
export function FrogUpdate(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  sub.camDist = Math.hypot(obj.pos.z - f.eye.z, obj.pos.x - f.eye.x);
  FrogAwardKillAndEnterDeath(obj, f);
  FrogReadNextScriptCommand(obj, f);
  g_class11_states[sub.state]?.(obj, f);
  FrogIntegrateVelocityAndGravity(obj);
  FrogDrawAndCycleBone2Slot(obj, f);
}

// -- the class -------------------------------------------------------------

/** Give back what a frog holds — the pair its two exits run. */
function FrogRelease(obj: Actor): void {
  if (obj.attackPermit !== -1) {
    G.g_attack_permits[obj.attackPermit] = -1;
    obj.attackPermit = -1;
  }
}

const handler: ClassHandler = {
  init: FrogInit,
  update: FrogUpdate,
  updatesWhenDead: true,
  ownsShotResult: true,
  leave(obj: Actor): void {
    G.g_enemies_alive -= 1;
    G.g_enemies_present -= 1;
    FrogRelease(obj);
    ActorDespawn(obj);
  },
  onDeadSweep(obj: Actor): void {
    FrogRelease(obj);
  },
  debug(obj: Actor): ActorDebug {
    const sub = Tail(obj);
    if (!sub) return { summary: "frog" };
    return {
      summary: `${FrogState[sub.state]}/${sub.sub}`,
      detail: [
        `cmd ${sub.cursor} · d=${sub.camDist.toFixed(1)} · turn ${sub.a}`,
        `permit ${obj.attackPermit} · flags 0x${sub.flags.toString(16)}`,
      ],
      hot: obj.attackPermit !== -1,
    };
  },
};

registerClass(SpawnClass.Frog, handler);
