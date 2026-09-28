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
 * **The wedge clamp reads camera block 2's yaw.** The engine's
 * `FrogStateHopWithinScreenWedge` clamps its chosen heading against two
 * screen-edge rays built from `g_camera_block2_yaw_bams`, the s32 at
 * `0x009A6418` — `g_camera_blocks + 2 * 0x1A4 + 0x90` — while the same class's
 * state 0 waits on **camera block 0's** path frame. Block 2 is not the view:
 * `EvtRunQueuedActionsSyncViewBlock` copies block 0's pose into it only while
 * a scripted view-angle turn, scene state (1, 3), is running, so on a rail it
 * holds the last such turn's heading, or zero after `CameraBlocksReset`. The
 * port read `g_camera_yaw_bams` here, a heading the scene state's hooks write
 * every frame, and now reads block 2's as the engine does. Why the frog's
 * author reached for block 2 is `[open]`; nothing in the class explains it.
 *
 * ## Bone 1, and the two matrix chains that read it
 *
 * `frog.bin`'s skeleton hangs every other bone off **bone 1** (`bone01_0b90`,
 * at the root's own origin), and the clips that turn the frog — `0x142`
 * and `0x143` — carry their 45° in the **root record**, bone 0. Two routines
 * work on bone 1's draw record, and both used to be declared unported here;
 * both are now transcribed, and the notes that declared them were wrong about
 * what they do:
 *
 * * the turn's fix-up is not a head look. It counter-rotates **bone 1, and so
 *   the whole skeleton**, by the turn it has just folded into the yaw, through
 *   `MatrixToEulerZYX`
 *   (`FUN_004019E0`) — there is no `MatrixDecomposeEuler` — so that the blend
 *   out of the turn clip starts from the pose on screen. See
 *   {@link FrogRebaseBone1ForTurn}. Class 0x30 has no such fix-up: neither
 *   Euler decomposition is called from any class-0x30 routine.
 * * the push-out's point is **world** space, and nothing about the chain says
 *   otherwise: `g_camera_blocks` is the block's `+0x40` matrix, view to world,
 *   and `part+0x130` is a record the draw stores in view space. See
 *   {@link FrogPushOutOfActorCollision}.
 */
import { ActorRegisterCameraPoint } from "../camera/track";
import type { Rng } from "../../core/rng";
import type { Events } from "../../core/events";
import { ActorFlag, MotionFlag, type Actor } from "../actor";
import { MotionFrameOf } from "../actor_pose";
import { ActorSetMotionBlended } from "../class30/motion_cue";
import { ColiTestSphereAgainstActors } from "../coli";
import { ChooseHitPlayerOrder } from "../combat/hit_order";
import { PlayerTakeDamage } from "../combat/player";
import { ScoreAddForPlayer } from "../combat/score";
import { ActorDespawn } from "../despawn";
import { SpawnBoneHitSprite } from "../effects/blood";
import { SpawnGroundRingEffect } from "../effects/ring_effect";
import { G, HIT_SLOT_NONE } from "../globals";
import type { GameHost } from "../host";
import {
  MatCopy, MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ,
  MatrixToEulerZYX, type Mat,
} from "../matrix";
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
/**
 * `PUSH 0x2; PUSH 0x3D; PUSH 0x13E` at `0x0043B7CC`: the recovery resumes
 * the leap clip at **play cursor** `0x3D`, one past the connect frame, over
 * a fade of 2. `ActorSetMotionBlended`'s third argument is the start cursor
 * and its fourth the fade (`param_1[2] = param_3; *(char *)(param_1 + 0xC)
 * = param_4 + 1`). This was read as a 61-frame fade from the clip's start.
 */
export const FROG_LEAP_RECOVER_CURSOR = 0x3d;
/** ...and every fade the class asks for. */
export const FROG_FADE = 2;
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
/** Bone 1's model once the frog is dead: `MOV [EDX+0x108], 0xB91`. */
export const FROG_CORPSE_SLOT = 0xb91;
/**
 * Bone 2 -- the throat, whose thirty-model run the croak cycles. The kill
 * blanks its slot (`part+0x198`) and zeroes its hit radius (`part+0x210`,
 * the record's `+0x78`), and the blood goes on it.
 */
export const FROG_BONE2 = 2;
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
/**
 * `part+0x130` is record **1**'s matrix — records are `0x90` apart from
 * `part+0x78`, the matrix sits at `+0x28` — and record `n` is bone `n`.
 */
export const FROG_BONE1 = 1;
/**
 * `FrogPushOutOfActorCollision`'s travel bands: below `[0x004C4CC8]` 0.1 the
 * push is the depth times `[0x004C4C88]` 0.05; up to `[0x0055E1D4]` 0.6 it is
 * the depth times the travel times `[0x004C4D10]` 0.3; above, the depth
 * times 0.3.
 */
export const FROG_PUSH_SLOW_TRAVEL = 0.1;
export const FROG_PUSH_SLOW_SCALE = 0.05;
export const FROG_PUSH_FAST_TRAVEL = 0.6;
export const FROG_PUSH_SCALE = 0.3;

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

/**
 * Has the current clip finished? `part+0x08 >= g_motion_play_length[part+0x20]`
 * -- the cursor the last draw left ({@link FrogTail.playCursor}), against the
 * length of the clip playing now.
 */
function ClipDone(obj: Actor, sub: FrogTail): boolean {
  return sub.playCursor >= MotionPlayLength(obj, obj.motion);
}

/**
 * `if (part[0x20] != m) ActorSetMotionBlended(part, m, cursor, 2)` — the whole
 * class, and every call but the leap's recovery starts at cursor 0.
 *
 * The engine's third argument is the **play cursor** (`param_1[2] = param_3`,
 * with `param_3 / 2` as the authored frame); the port's primitive takes the
 * authored frame and rebuilds the cursor from it, so the cursor is halved on
 * the way in. `frog.bin` is authored at 30 Hz, which makes that exact. The
 * write to `part+0x08` is the one a state reads back before the next draw
 * ({@link FrogTail.playCursor}).
 */
function FrogPlay(obj: Actor, m: number, cursor = 0): void {
  if (obj.motion === m) return;
  ActorSetMotionBlended(obj, m, cursor / 2, FROG_FADE);
  const sub = Tail(obj);
  if (sub && obj.motion === m) sub.playCursor = cursor;
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
 * part[0] = 0;  part+0x08 = 0;              // the counter and the cursor
 * ActorBuildSkinnedModel(part, obj+0x40, part+0x78);
 * part+0x64 |= 4;  part+0x68 = 1;           // 0x0043A170, 0x0043A17C
 * obj->+0x12C..0x134 = obj->+0x40..0x48;    // the published sphere, at the feet
 * obj->+0x124 = g_actor_radius_by_char[0x1B];   // 10.0
 * obj->+0x128 = 3.0;
 * g_enemies_present++;  g_enemies_alive++;
 * obj->+0x121 = -1;
 * *obj = FrogUpdate;
 * ```
 *
 * `part+0x64 |= 4` is {@link MotionFlag.TraceGround}: the ground ring the
 * corpse leaves, and the shadow, stand on the collision under the frog rather
 * than at its own height. The port did not raise it, and nothing showed until
 * the corpse's ring was ported. `part+0x68 = 1` is the rotation order, which
 * a frog -- yaw only -- cannot show.
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
  sub.playCursor = 0;
  obj.motionFlags |= MotionFlag.TraceGround;
  obj.sphereCentre.x = obj.pos.x;
  obj.sphereCentre.y = obj.pos.y;
  obj.sphereCentre.z = obj.pos.z;
  obj.hitRadius = FROG_HIT_RADIUS;
  obj.bodyRadius = FROG_BODY_RADIUS;
  G.g_enemies_present += 1;
  G.g_enemies_alive += 1;
  obj.attackPermit = -1;
}

// -- being shot ------------------------------------------------------------

/**
 * `FrogAwardKillAndEnterDeath` — `FUN_0043A2E0`. Run first, every frame.
 * `[proved]`, every line of it from the listing (`0x0043A2E0`..`0x0043A3C7`):
 *
 * ```
 * if (!(obj+0x34 & 8)) return
 * (u16) obj+0x11C = 0                          ; MOV word ptr [ESI+0x11C], BX
 * if (obj+0x34 & 0x4000000) return
 * obj+0x34 |= 0x4000000
 * sub+0x04 = 8;  sub+0x05 = 0;  sub+0x00 &= ~1
 * obj+0x34 |= 0x8000                           ; OR DH, 0x80
 * ChooseHitPlayerOrder()
 * part+0x108 = 0xB91;  part+0x198 = 0;  part+0x210 = 0
 * SpawnBoneHitSprite(obj, 2)
 * p = (obj+0x34 & 6) == 2 ? 0 : == 4 ? 1 : rand() % 2
 * ScoreAddForPlayer(p, 0x50);  g_player_hit_count[p]++
 * PlaySoundId(0x716A9)                         ; COMMON\BLOOD07_16.WAV
 * ```
 *
 * The whole damage model, and there is no arithmetic in it: `obj+0x11C` is
 * zeroed and never read again, so the first shot that raises `obj+0x34` bit 3
 * kills, and bit `0x4000000` is the latch that stops a second paying twice.
 * The store is a **word** and it stops there -- `obj+0x11E` is not touched.
 *
 * Four things were ported wrongly here, each now pinned by a check:
 *
 * * the bit is `0x8000`, {@link ActorFlag.NoShotTest} -- `RegisterForShotTest`
 *   stops filing the corpse, so a bullet goes through it to whatever is
 *   behind. The port raised `0x100`, which only `DispatchHit` reads, and the
 *   corpse went on stopping bullets for as long as it lay there;
 * * `part+0x210` is not bone 3's slot. Records are `0x90` apart from
 *   `part+0x78`, so it is **bone 2's record at `+0x78`, its hit radius** --
 *   and bone 3's model, `0xBB2`, stays on the corpse. The port blanked it;
 * * `ChooseHitPlayerOrder` was not called, and with both players in it is a
 *   draw from the stream the shooter coin then takes the next of;
 * * `obj+0x11E` was zeroed with `obj+0x11C`.
 *
 * The bone-hit sprite is spawned **after** the radius goes to zero, so the
 * blood sits on bone 2's centre rather than on the near face of its sphere
 * (`BoneHitSpriteDrawAndTick` adds `+0x284` to the depth). The corpse model
 * goes on here rather than in the death state.
 */
export function FrogAwardKillAndEnterDeath(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  if (!(obj.flags & ActorFlag.Hit)) return;
  obj.hp = 0;
  if (obj.flags & ActorFlag.Dead) return;
  obj.flags |= ActorFlag.Dead;
  sub.state = FrogState.Die;
  sub.sub = 0;
  sub.flags &= ~FrogFlag.WantCommand;
  obj.flags |= ActorFlag.NoShotTest;
  ChooseHitPlayerOrder(f.rng);
  obj.boneSlot[String(FROG_BONE1)] = FROG_CORPSE_SLOT;
  f.host.setBoneSlot(obj.at, FROG_BONE1, FROG_CORPSE_SLOT);
  obj.boneSlot[String(FROG_BONE2)] = 0;
  f.host.setBoneSlot(obj.at, FROG_BONE2, 0);
  obj.boneRadius[String(FROG_BONE2)] = 0;
  SpawnBoneHitSprite(obj.at, FROG_BONE2);
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
 *
 * State 1's arms are three bands across the screen, with `-z` the depth: right
 * of the `x = -z/4` line, the window is `[aim - 0x1800, aim]`; left of the
 * `x = z/4` line, `[aim, aim + 0x1800]`; between the two, both. The middle
 * test is `0x0043AB16`..`0x0043AB2F` —
 *
 * ```
 * FLD [ESP+0x10]; FMUL [0x004C4D0C]   ; -z * -0.25
 * FCOMP [EBX+0x30]; TEST AH,0x41      ; against x
 * JZ 0x0043AB41                       ; z/4 > x: [aim, +0x1800]
 * MOV EDI,0x3000; JMP 0x0043AAF6      ; else:    [aim - 0x1800, +0x3000]
 * ```
 *
 * — and it was ported the wrong way round, giving the frog on the left the
 * full window and the one in the middle a half.
 */
function FrogHeadingWindow(state: FrogState, aim: number,
                           view: { x: number; z: number }):
                           { base: number; width: number } {
  if (state === FrogState.HopAcross) {
    if (-view.z * 0.25 < view.x) {
      return { base: aim - FROG_WINDOW_HALF, width: FROG_WINDOW_HALF };
    }
    if (view.z * 0.25 > view.x) {
      return { base: aim, width: FROG_WINDOW_HALF };
    }
    return { base: aim - FROG_WINDOW_HALF, width: FROG_WINDOW_FULL };
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
 * the window's end is moved by `acos(distance / 26)`.
 *
 * **`acos`, `[proved]`.** `CrtAcos` (`FUN_004AD0B0`) is the C runtime's: its
 * body is `FLD1; FADD ST0,ST1; FLD1; FSUB ST0,ST2; FMULP; FSQRT; FXCH;
 * FPATAN` — `atan2(sqrt(1 - x²), x)` — and its `|x| == 1` arm loads `FLDZ`
 * for `+1` and `FLDPI` for `-1`. This read `asin`, as a guess made because
 * `asin` was "the only reading under which the correction vanishes at the
 * boundary"; the code does not care what vanishes where. So the move is a
 * quarter turn for a frog standing on a ray and nothing for one twenty-six
 * units off it.
 *
 * The two blocks' `10430.378` multiplies have **opposite signs**, which is why
 * this is written out twice rather than looped.
 */
function FrogClampToWedge(obj: Actor, eye: { x: number; z: number },
                          wedge: number, win: { base: number; width: number }):
                          void {
  // `MOV EBP, [0x009A6418]` at `0x0043AB62`: camera block 2's yaw.
  const camYaw = G.g_camera_block2_yaw_bams;
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
    const t = Math.trunc(Math.acos(e1 / FROG_STOP_SHORT) * -TO_BAMS);
    const v = s16(halfFov - t - s16(obj.yaw) + camYaw + 0x4000);
    if (v > win.base) {
      win.base = v;
      if (win.width <= 0) win.width = 0;
    }
  }
  if (e2 < FROG_STOP_SHORT) {
    const t = Math.trunc(Math.acos(e2 / FROG_STOP_SHORT) * TO_BAMS);
    const v = s16(-halfFov - t - s16(obj.yaw) + camYaw - 0x4000);
    if (v < win.base + win.width) {
      if (v >= win.base) win.width = v - win.base;
      else { win.base = v; win.width = 0; }
    }
  }
}

/**
 * `[port-only]` as a function: the turn's fix-up, which both turning states
 * inline after they fold a pass of the turn clip into the yaw — `0x0043AE2E`..`0x0043AEFF` in
 * `FrogStateHopWithinScreenWedge` and `0x0043B557`..`0x0043B628` in
 * `FrogStateLeapAtPlayer`, the same forty-four instructions:
 *
 * ```
 * MatrixStackPush(0); MatrixLoadIdentity()
 * RotX(-r0x) RotY(-r0y) RotZ(-r0z)       ; r0 = part+0x7C/80/84, the root record
 * RotY(-turn)                            ; the pass just added to obj+0x68
 * RotZ(r0z) RotY(r0y) RotX(r0x)
 * RotZ(r1z) RotY(r1y) RotX(r1x)          ; r1 = part+0x10C/110/114, bone 1's
 * MatrixToEulerZYX(&r1x, &r1y, &r1z); MatrixStackPop(1)
 * ```
 *
 * The yaw has turned the whole frog by `turn`; this turns bone 1 back by the
 * same amount **in the root's frame**, so that bone 1 — the node every other
 * bone of `frog.bin` hangs from — is drawn where it was. It matters only
 * because of what comes next. Every draw rewrites bone 1's record from the
 * clip (`SkeletonPoseNode` (`FUN_00411700`) stores all three of its arms'
 * angles at `record+0x04`), so on
 * a frame that plays on the record is gone before anyone sees it; but when
 * the turn is done the state calls `ActorSetMotionBlended`, whose
 * `MotionLoadPoseSlot` (`FUN_00411C20`) mode `0xC` snapshots the records **as
 * they stand** into the fade's slot A. The fade then dissolves from the
 * rewritten pose into the next clip facing the new way.
 *
 * `frog.bin`'s turn clips carry their 45° in the root record's `ry` and leave
 * bone 1 at zero, so the rewrite is `(0, -turn, 0)` in practice. Without it
 * the snapshot is the clip's last pose under the turned yaw — 45° past where
 * the frog was drawn — and the blend swings the whole frog back through it.
 *
 * The drawn records are the clip's frame at the cursor the last draw left
 * ({@link FrogTail.playCursor}), as `Boss4StateTurnClipThenApproach`
 * (`FUN_00494730`) reads them in the port: the port draws whole authored
 * frames. Null for a clip the bundle did not bake, which leaves the blend to
 * snapshot the clip as it always has.
 */
function FrogRebaseBone1ForTurn(obj: Actor, sub: FrogTail, turn: number):
    [number, number, number] | null {
  const drawn = MotionFrameOf(obj, obj.motion, sub.playCursor >> 1);
  if (!drawn) return null;
  const r0 = drawn.rot(0);
  const r1 = drawn.rot(FROG_BONE1);
  const m: Mat = MatIdentity();
  MatrixRotateX(m, -r0[0]);
  MatrixRotateY(m, -r0[1]);
  MatrixRotateZ(m, -r0[2]);
  MatrixRotateY(m, -turn);
  MatrixRotateZ(m, r0[2]);
  MatrixRotateY(m, r0[1]);
  MatrixRotateX(m, r0[0]);
  const t = MatCopy(MatIdentity(), m);
  MatrixRotateZ(t, r1[2]);
  MatrixRotateY(t, r1[1]);
  MatrixRotateX(t, r1[0]);
  const e = MatrixToEulerZYX(t);
  return [e.rx, e.ry, e.rz];
}

/**
 * `[port-only]` as a function. One pass of a turn clip has ended: fold it into
 * the yaw, rebase bone 1, and
 * hand to `clip` once what is left is within `settle`. The shape both turning
 * states' substate 1 share, `0x0043ADE6` and `0x0043B50F`.
 *
 * ```
 * if (part+0x08 < g_motion_play_length[part+0x20]) return
 * turn = part+0x20 == 0x142 ? 0x2000 : -0x2000
 * obj+0x68 += turn;  sub+0x18 -= turn
 * (the fix-up above)
 * if (|sub+0x18| > settle) return
 * if (part+0x20 != clip) ActorSetMotionBlended(part, clip, 0, 2);  sub+0x05 = 2
 * ```
 *
 * The rewritten record rides the blend's snapshot as `Actor.fadeFrom`'s
 * `records`, which `render/characters/pose.ts` already dissolves from. With a
 * pass still to go there is no blend, and the rewrite has nothing to ride:
 * the draw overwrites it the same frame, in the engine as here.
 */
function FrogFinishTurnPass(obj: Actor, sub: FrogTail, settle: number,
                            clip: FrogMotion): void {
  if (!ClipDone(obj, sub)) return;
  const turn = obj.motion === FrogMotion.TurnLeft
    ? FROG_TURN_PER_CLIP : -FROG_TURN_PER_CLIP;
  obj.yaw = s16(obj.yaw + turn);
  sub.a -= turn;
  const bone1 = FrogRebaseBone1ForTurn(obj, sub, turn);
  if (Math.abs(sub.a) > settle) return;
  if (obj.motion !== clip) {
    FrogPlay(obj, clip);
    if (bone1 && obj.motion === clip && obj.fadeFrom) {
      obj.fadeFrom.records = [{ record: FROG_BONE1, rot: bone1 }];
    }
  }
  sub.sub = 2;
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
 * until what is left fits inside 45°; each pass is folded into the yaw with
 * bone 1 turned back to match ({@link FrogFinishTurnPass}). Then clip `0x140`
 * runs and the launch is on its frame 18, the stop on frame 44. The residual
 * is **halved every frame** through the flight, the launch frame included, so
 * the frog keeps turning as it travels.
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
  // The gameplay eye, `g_camera_eye`, by address in the exe.
  const eye = G.g_camera_eye;
  const sub = Tail(obj);
  if (!sub) return;
  switch (sub.sub) {
    case 0: {
      if (sub.state !== FrogState.HopToHeading) {
        const aim = FrogHeadingTo(obj, eye.x, eye.z);
        const view = { x: 0, z: 0 };
        const p = { x: 0, y: 0, z: 0 };
        if (f.host.viewSpaceOf(obj.at, p)) { view.x = p.x; view.z = p.z; }
        const win = FrogHeadingWindow(sub.state, aim, view);
        FrogClampToWedge(obj, G.g_camera_eye, sub.wedge, win);
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
    case 1:
      FrogFinishTurnPass(obj, sub, FROG_TURN_PER_CLIP, FrogMotion.Hop);
      return;
    case 2: {
      if (sub.playCursor !== FROG_HOP_LAUNCH_FRAME) return;
      const th = s16(obj.yaw + sub.a) * BAMS;
      const s = Math.sin(th);
      const c = Math.cos(th);
      let speed: number;
      if (sub.state === FrogState.HopToward) {
        const ddx = obj.pos.x - s * FROG_STOP_SHORT - eye.x;
        const ddz = obj.pos.z - c * FROG_STOP_SHORT - eye.z;
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
      // **Not a return.** `0x0043B031`..`0x0043B03E` bump the substate and run
      // straight on into substate 3's code at `0x0043B044`, so the launch
      // frame halves the residual turn too. This returned, and every hop
      // turned one halving short.
      FrogHopInFlight(obj, sub);
      return;
    }
    case 3:
      FrogHopInFlight(obj, sub);
      return;
    default:
      if (ClipDone(obj, sub)) sub.flags |= FrogFlag.WantCommand;
  }
}

/**
 * `[port-only]` as a function: `FrogStateHopWithinScreenWedge`'s substate 3,
 * from `0x0043B044` — its own
 * jump-table arm, and where substate 2 runs on to on the launch frame. The
 * residual turn is halved into the yaw every frame of the flight, and the
 * velocity is zeroed on frame `0x2C`.
 */
function FrogHopInFlight(obj: Actor, sub: FrogTail): void {
  if (sub.a !== 0) {
    obj.yaw = s16(obj.yaw + Math.trunc(sub.a / 2));
    sub.a = Math.trunc(sub.a / 2);
  }
  if (sub.playCursor !== FROG_HOP_STOP_FRAME) return;
  obj.vel.x = 0;
  obj.vel.z = 0;
  sub.sub = 4;
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
export function FrogStateHopInPlace(obj: Actor, _f: ClassFrame): void {
  // The gameplay eye, `g_camera_eye`, by address in the exe.
  const eye = G.g_camera_eye;
  const sub = Tail(obj);
  if (!sub) return;
  if (sub.sub === 0) {
    sub.a = sub.state === FrogState.HopInPlaceFacing
      ? FrogHeadingTo(obj, eye.x, eye.z) : 0;
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
  if (ClipDone(obj, sub)) sub.flags |= FrogFlag.WantCommand;
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
 * The turn passes fold into the yaw with bone 1 turned back to match, as the
 * hop's do ({@link FrogFinishTurnPass}). The launch is a thirty-frame
 * ballistic solve: horizontal velocity is the displacement over thirty, and
 * the vertical adds `-gravity * 14.5` so the constant `-0.0272222` brings it
 * back to the target height twenty-nine frames later.
 *
 * Substate 4 holds the frog on the player's face until the bone-2 cycle
 * wraps, then **resumes the leap clip where it connected** — play cursor
 * `0x3D`, over a fade of 2 ({@link FROG_LEAP_RECOVER_CURSOR}) — so what plays
 * is the fall back to the ground and not the take-off again.
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
    case 1:
      FrogFinishTurnPass(obj, sub, FROG_LEAP_TURN_THRESHOLD, FrogMotion.Leap);
      return;
    case 2: {
      if (sub.playCursor !== FROG_LEAP_LAUNCH_FRAME) return;
      const n = 1 / FROG_LEAP_FRAMES;
      obj.vel.x = (sub.targetX - obj.pos.x) * n;
      obj.vel.z = (sub.targetZ - obj.pos.z) * n;
      obj.vel.y = (sub.targetY - obj.pos.y) * n
        - obj.accY * FROG_LEAP_GRAVITY_COMP;
      sub.flags |= FrogFlag.CycleRunning;
      sub.sub = 3;
      // Runs on into substate 3 (`0x0043B6E5`..`0x0043B6F2`, then the arm at
      // `0x0043B6F7`), as the hop's launch does.
      FrogLeapInFlight(obj, sub, f);
      return;
    }
    case 3:
      FrogLeapInFlight(obj, sub, f);
      return;
    case 4: {
      if (!(sub.flags & FrogFlag.CycleWrapped)) return;
      sub.flags &= ~(FrogFlag.CycleRunning | FrogFlag.CycleWrapped
                     | FrogFlag.NoGravity);
      FrogPlay(obj, FrogMotion.Leap, FROG_LEAP_RECOVER_CURSOR);
      sub.sub = 5;
      return;
    }
    default: {
      // `0x0043B7EB`..`0x0043B853`.
      if (obj.pos.y > FrogReadGroundPlaneY()) return;
      if (obj.attackPermit !== -1) G.g_attack_permits[obj.attackPermit] = -1;
      obj.attackPermit = -1;
      G.g_enemies_alive -= 1;
      G.g_enemies_present -= 1;
      // `if (obj+0x3C != -1) g_hit_slots[obj+0x3C] = 0` at `0x0043B83A`, ahead
      // of `ActorDespawn`'s own release of the same slot.
      if (obj.hitSlot !== HIT_SLOT_NONE) G.g_hit_slots[obj.hitSlot] = HIT_SLOT_NONE;
      ActorDespawn(obj);
    }
  }
}

/**
 * `[port-only]` as a function: `FrogStateLeapAtPlayer`'s substate 3, from
 * `0x0043B6F7` — its own arm, and
 * where substate 2 runs on to on the launch frame. The residual turn is
 * halved into the yaw every frame, and on frame `0x3C` the frog stops dead in
 * the air, turns gravity off, cuts to the idle clip and hurts the player it
 * holds the permit for, whether or not it got there.
 */
function FrogLeapInFlight(obj: Actor, sub: FrogTail, f: ClassFrame): void {
  if (sub.a !== 0) {
    obj.yaw = s16(obj.yaw + Math.trunc(sub.a / 2));
    sub.a = Math.trunc(sub.a / 2);
  }
  if (sub.playCursor !== FROG_LEAP_CONNECT_FRAME) return;
  obj.vel.x = 0;
  obj.vel.y = 0;
  obj.vel.z = 0;
  sub.flags |= FrogFlag.NoGravity;
  FrogPlay(obj, FrogMotion.Idle);
  PlayerTakeDamage(obj.attackPermit, 1, FROG_DAMAGE_KIND, f.events, obj,
                   "strike");
  sub.sub = 4;
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
 * `FrogStateDieTumbleAndSink` — `FUN_0043B990`. State 8, entered only from
 * `FrogAwardKillAndEnterDeath`'s `sub+0x04 = 8`. `[proved]` from the listing,
 * `0x0043B990`..`0x0043BD23`, with the 39 bytes at `0x0043BB68`..`0x0043BB8E`
 * that Ghidra leaves out after the `MatrixStackPop` call it marks no-return
 * (L35):
 *
 * ```
 * ground = FrogReadGroundPlaneY()
 * switch (sub+0x05) {                                  ; 0, 1, 2; else nothing
 * case 0:
 *   part+0x20 = 0x13F;  MotionFrameAddress(part+0x60, 0x13F, 0)
 *   ActorSetMotionBlended(part, 0x13F, 0, 2)           ; a blend, not a cut
 *   obj+0x34 &= ~0x4000
 *   if (!(obj+0x34 & 0x800000) || g_enemies_alive != 1) obj+0x34 |= 0x10000
 *   g_enemies_alive--
 *   vel = (0, 0, -0.5) through the camera block's rows, translation zeroed
 *   sub+0x00 = 0                                       ; gravity back on, cycle off
 *   if (obj+0x121 != -1) g_attack_permits[obj+0x121] = 0
 *   sub+0x05++                                         ; 0x0043BB8C, and on into case 1
 * case 1:
 *   if (pos.y <= ground) {
 *     pos.y = ground
 *     if (vel.y == 0) vel.xz *= 0.8
 *     else { vel.y *= -0.3; vel.xz *= 0.6; if (vel.y < 0.05) vel.y = 0 }
 *     if (|vel.x| < 0.05) vel.x = 0;  if (|vel.z| < 0.05) vel.z = 0
 *     if (vel == 0 && part+0x08 == g_motion_play_length[part+0x20]) {
 *       SpawnGroundRingEffect(obj)                     ; 0x0043BCD4
 *       vel.y = -0.035;  sub+0x18 = 0xB4;  sub+0x05++
 *     }
 *   }
 *   if (part+0x08 == g_motion_play_length[part+0x20] - 1) obj+0x34 |= 0x4000
 *   return
 * case 2:
 *   if (sub+0x18-- == 0) {
 *     g_enemies_present--
 *     if (obj+0x3C != -1) g_hit_slots[obj+0x3C] = 0
 *     ActorDespawn(obj)
 *   }
 * }
 * ```
 *
 * The corpse is **thrown away from the camera**, bounced on the ground plane,
 * and when it has settled on the last frame of the death clip it leaves the
 * ground ring and sinks at 0.035 a frame for 181 frames. The alive count comes
 * down on the frame it dies and the present count when it goes, and that gap
 * is the whole reason the two counters exist.
 *
 * What the port had wrong, each now pinned by a check that fails without it:
 *
 * * **The corpse never went.** Substate 1 freezes the clip when it reads
 *   `len - 1` and waits to read `len`. In the engine the draw after the
 *   freeze computes `len` and the state reads it next frame; the port's
 *   states read the counter the director had already advanced, so the freeze
 *   stopped it on `len - 1` for good. Stage 1's frog room stood on two frogs
 *   in `Die/1` holding `g_enemies_present`. The class now reads `part+0x08`
 *   as the engine's states do -- {@link FrogTail.playCursor}.
 * * **Substate 0 runs on into substate 1** (L53): `INC byte ptr [EAX+5]` at
 *   `0x0043BB8C` is followed by `0x0043BB8F`, which is case 1's first
 *   instruction. So the kick is damped by the first bounce on the frame of
 *   the kill. The port returned.
 * * **The clip is blended in.** The engine writes `part+0x20` itself and then
 *   calls `ActorSetMotionBlended`, which is unconditional -- it snapshots the
 *   pose last drawn whatever `part+0x20` holds. The port's primitive keys that
 *   snapshot on `obj.motion`, so writing it first left nothing to fade from
 *   and the death cut. The engine's own write feeds only `MotionFrameAddress`,
 *   whose answer it throws away (a bank-residency request), and the
 *   argument, which is `0x13F` either way.
 * * **`SpawnGroundRingEffect` was never called.**
 * * The kick subtracted `ClassFrame.eye` from a camera point; the engine
 *   builds the rotation alone (`MatrixGetTranslation` of an identity into the
 *   translation row), so it is the difference of two camera points here.
 */
export function FrogStateDieTumbleAndSink(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  const ground = FrogReadGroundPlaneY();
  if (sub.sub === 0) {
    ActorSetMotionBlended(obj, FrogMotion.Death, 0, FROG_FADE);
    sub.playCursor = 0;
    obj.flags &= ~ActorFlag.PoseFrozen;
    if (!(obj.flags & ActorFlag.KeepCameraWhenLast) || G.g_enemies_alive !== 1) {
      obj.flags |= ActorFlag.NoCameraTrack;
    }
    G.g_enemies_alive -= 1;
    FrogDeathKick(obj, f.host);
    sub.flags = 0;
    // `MOV [EDX*4 + 0x9A2BA0], EDI` with `EDI` zero, and `obj+0x121` is left
    // as it was: the engine's free value is 0, the port's -1.
    if (obj.attackPermit !== -1) G.g_attack_permits[obj.attackPermit] = -1;
    sub.sub = 1;
    // No return: on into substate 1, this frame.
  } else if (sub.sub === 2) {
    const t = sub.a;
    sub.a = t - 1;
    if (t !== 0) return;
    G.g_enemies_present -= 1;
    if (obj.hitSlot !== HIT_SLOT_NONE) G.g_hit_slots[obj.hitSlot] = HIT_SLOT_NONE;
    ActorDespawn(obj);
    return;
  } else if (sub.sub !== 1) {
    return;
  }
  const len = MotionPlayLength(obj, obj.motion);
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
        && sub.playCursor === len) {
      SpawnGroundRingEffect(obj);
      obj.vel.y = FROG_SINK_SPEED;
      sub.a = FROG_SINK_FRAMES;
      sub.sub = 2;
    }
  }
  if (sub.playCursor === len - 1) obj.flags |= ActorFlag.PoseFrozen;
}

const _kick = { x: 0, y: 0, z: 0 };
const _kickFrom = { x: 0, y: 0, z: 0 };

/**
 * `[port-only]` as a function: the throw, `0x0043BA6B`..`0x0043BB63`.
 *
 * ```
 * MatrixStackPush(0); MatrixLoadIdentity(); MatrixGetTranslation(&t)   ; t = 0
 * m = { block[+0x40], [+0x44], [+0x48],  [+0x50], [+0x54], [+0x58],
 *       [+0x60], [+0x64], [+0x68],  t }                                ; g_camera_index's
 * MatrixSetTop3x4(m); MatrixTransformPoint((0, 0, -0.5), &obj+0x4C)
 * ```
 *
 * `g_camera_blocks` (`0x009A6040`) is the block's `+0x40` matrix, view to
 * world, and its translation is replaced by the identity's zero: the
 * corpse's velocity is the camera's own `-Z`, half a unit long -- away from
 * the eye and into the screen. `GameHost.viewPoint` is that matrix with its
 * translation, so the rotation alone is two of its points apart. A host with
 * no camera answers neither, and the kick is zero.
 */
function FrogDeathKick(obj: Actor, host: GameHost): void {
  _kick.x = _kick.y = _kick.z = 0;
  _kickFrom.x = _kickFrom.y = _kickFrom.z = 0;
  host.viewPoint(0, 0, FROG_DEATH_KICK, _kick);
  host.viewPoint(0, 0, 0, _kickFrom);
  obj.vel.x = _kick.x - _kickFrom.x;
  obj.vel.y = _kick.y - _kickFrom.y;
  obj.vel.z = _kick.z - _kickFrom.z;
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
 * The routine's last line is the clip's clock, `if (!(obj+0x34 & 0x4000))
 * part[0]++` (`0x0043A4CB`..`0x0043A4D8`), after the draw. The port's director
 * makes that step as `ActorAdvanceMotion` at the top of the next frame, under
 * the same {@link ActorFlag.PoseFrozen} gate, which is why the cursor the
 * draw computed has to be kept for the states ({@link FrogTail.playCursor}).
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
  // `DrawSkinnedModelAndShadow(part, obj+0x40, part+0x78)` at `0x0043A494`,
  // on every frame, dead or alive -- and what it leaves on the actor: the
  // play cursor its `SkeletonAdvancePlayCursor` computed, which is what every
  // state reads next frame (`FrogTail.playCursor`), and bone 1's record. The
  // port's director has already stepped the counter this draw reads, so this
  // frame's cursor is the one the renderer poses.
  sub.playCursor = MotionPlayFrame(obj);
  FrogStoreBone1Record(sub, obj, f.host);
  if (obj.flags & ActorFlag.Dead) return;
  const slot = FROG_BONE2_FIRST_SLOT + sub.boneSlot;
  if (obj.boneSlot["2"] === slot) return;
  obj.boneSlot["2"] = slot;
  f.host.setBoneSlot(obj.at, 2, slot);
}

const _bone1World = { x: 0, y: 0, z: 0 };
const _bone1View = { x: 0, y: 0, z: 0 };

/**
 * `[port-only]` — the one thing the draw leaves on the actor that this class
 * reads back: bone 1's record, `part+0x130`, which `SkeletonEmitNode`
 * (`FUN_004114C0`) stores with `MatrixStore(record + 0x28)` as it walks the
 * skeleton **under the camera**, so in view space. Only its translation is
 * ever read, and that is what {@link FrogTail.bone1View} keeps.
 *
 * The pose is the renderer's, so the bone is where it was last drawn — the
 * reading `ActorRegisterCameraPoint` and `JudgmentEmitTrackedBone` take at
 * the same point of their classes' frames — and it goes into view space
 * through the camera this frame reads, which is where the engine's draw puts
 * it. With no pose, or no camera, the record keeps what it had, as a record
 * the draw did not reach does.
 */
function FrogStoreBone1Record(sub: FrogTail, obj: Actor, host: GameHost): void {
  if (!host.boneWorld(obj.at, FROG_BONE1, _bone1World)) return;
  if (!host.viewSpaceOfPoint?.(_bone1World, _bone1View)) return;
  sub.bone1View = { x: _bone1View.x, y: _bone1View.y, z: _bone1View.z };
}

/**
 * `MatrixStackPush(0); MatrixStackSetTopFromArray(g_camera_blocks[g_camera_index]);
 * MatrixMultiply(part+0x130); MatrixGetTranslation(out); MatrixStackPop(1)` —
 * the chain `FrogUpdate` and `FrogPushOutOfActorCollision` both open with
 * (`0x0043A233`..`0x0043A293`, `0x0043A504`..`0x0043A563`).
 *
 * **World space, `[proved]`.** `g_camera_blocks` (`0x009A6040`) is the
 * block's `+0x40` matrix, the inverse of `g_camera_world_to_view`: view to
 * world. `part+0x130` is bone 1's record, which the draw stores in view space.
 * The product's translation is bone 1 in the world — the chain
 * `ActorShiftToHoldBone1Position` (`FUN_0045CE70`) reads the same way, and
 * the one the push then adds a world normal to. `GameHost.viewPoint` is that
 * matrix: a camera-space point in world coordinates.
 *
 * False before the first draw the host could pose.
 */
function FrogBone1World(sub: FrogTail, host: GameHost,
                       out: { x: number; y: number; z: number }): boolean {
  const v = sub.bone1View;
  if (!v) return false;
  host.viewPoint(v.x, v.y, v.z, out);
  return true;
}

const _bone1 = { x: 0, y: 0, z: 0 };

/**
 * `FrogPushOutOfActorCollision` — `FUN_0043A500`. The last thing a frog does
 * each frame: keep out of other actors, and publish where it is for them.
 *
 * ```
 * p = translation(g_camera_blocks[cur] * part+0x130)      ; bone 1, just drawn
 * if (sub+0x04 != 6 && ColiTestSphereAgainstActors(&p, obj+0x128)) {
 *     d = |p - g_frog_bone1_on_entry| in x and z          ; this frame's travel
 *     k = d < 0.1 ? g_coli_hit_depth * 0.05
 *       : g_coli_hit_depth * (d <= 0.6 ? d : 1) * 0.3
 *     obj+0x40 += g_coli_hit_normal_x * k;  obj+0x48 += g_coli_hit_normal_z * k
 *     p.x      += g_coli_hit_normal_x * k;  p.z      += g_coli_hit_normal_z * k
 * }
 * obj+0x12C..0x134 = p
 * ```
 *
 * **The point is bone 1 in the world** — see {@link FrogBone1World} — so the
 * normal is added to two world points, and there was never a reading under
 * which it pushed frogs the wrong way. The test is skipped during the leap,
 * the one state that means to end up inside the player's space, but the point
 * is written on every frame, and `RegisterForShotTest` (`FUN_00405160`)
 * records it, at `ActorRegisterCameraPoint` on the next frame, as the sphere
 * other actors test against one frame after that
 * (`ColiPublishDynamicList`, `FUN_00405360`).
 *
 * The push is **scaled by how far bone 1 moved** since the last draw, not by
 * the overlap alone: a frog sitting still is nudged at a twentieth of the
 * depth and one hopping at speed at three tenths of it. `d` measures between
 * two readings of the same record through the **same** camera block, the one
 * before this frame's draw and the one after, so it is bone 1's travel
 * relative to the camera — a still frog under a moving camera travels.
 *
 * `[port-only]` in one respect: with no draw record there is no point, and
 * the frog is neither tested nor published. The engine draws every frame; a
 * headless host never does.
 */
export function FrogPushOutOfActorCollision(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  if (!FrogBone1World(sub, f.host, _bone1)) return;
  if (sub.state !== FrogState.LeapAtPlayer
      && ColiTestSphereAgainstActors(obj, _bone1.x, _bone1.y, _bone1.z,
                                     obj.bodyRadius)) {
    // `FST [ESP+0x20]`: the travel is stored as a float before it is compared.
    const on = G.g_frog_bone1_on_entry;
    const d = Math.fround(Math.hypot(_bone1.x - on.x, _bone1.z - on.z));
    let k = G.g_coli_hit_depth;
    if (d < FROG_PUSH_SLOW_TRAVEL) {
      k *= FROG_PUSH_SLOW_SCALE;
    } else {
      if (d <= FROG_PUSH_FAST_TRAVEL) k *= d;
      k *= FROG_PUSH_SCALE;
    }
    const nx = G.g_coli_hit_normal[0];
    const nz = G.g_coli_hit_normal[2];
    obj.pos.x += nx * k;
    obj.pos.z += nz * k;
    _bone1.x += nx * k;
    _bone1.z += nz * k;
  }
  obj.sphereCentre.x = _bone1.x;
  obj.sphereCentre.y = _bone1.y;
  obj.sphereCentre.z = _bone1.z;
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
 * Between the distance and the shot, `0x0043A233`..`0x0043A293` take bone 1
 * where the **last** draw left it into the world through this frame's camera
 * and park it in `g_frog_bone1_on_entry` — `0x007DCBB8` — which nothing but
 * the push reads: it is where the frame's travel is measured from.
 *
 * `ActorRegisterCameraPoint` takes **1.0** here, against 4.0 for a class-0x30
 * zombie and 0 for a class-0x31 thrower — the height the camera looks at.
 */
export function FrogUpdate(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  // `g_camera_eye_z` and `_x` by address, `0x0043A212` and `0x0043A21A`, as
  // every eye in this class is (`0x0043AA97..AB2`, `0x0043AB8C`, `0x0043AFCF`,
  // `0x0043B1DC..1F6`): the gameplay eye.
  const eye = G.g_camera_eye;
  sub.camDist = Math.hypot(obj.pos.z - eye.z, obj.pos.x - eye.x);
  if (!FrogBone1World(sub, f.host, G.g_frog_bone1_on_entry)) {
    // `[port-only]`: no draw the host could pose has left a record yet. What
    // the engine's record holds before its first draw is `[open]` -- zero is
    // what a cleared block would give, and it keeps another frog's reading
    // from standing in for this one's.
    G.g_frog_bone1_on_entry.x = 0;
    G.g_frog_bone1_on_entry.y = 0;
    G.g_frog_bone1_on_entry.z = 0;
  }
  FrogAwardKillAndEnterDeath(obj, f);
  FrogReadNextScriptCommand(obj, f);
  g_class11_states[sub.state]?.(obj, f);
  FrogIntegrateVelocityAndGravity(obj);
  FrogDrawAndCycleBone2Slot(obj, f);
  // `PUSH 0x3F800000; CALL 0x00409b70` at `0x0043A2C2`, straight after the
  // draw and on every path, and before the push-out.
  ActorRegisterCameraPoint(obj, f.host, FROG_CAMERA_RISE);
  FrogPushOutOfActorCollision(obj, f);
}

/** `PUSH 0x3F800000` at `0x0043A2C2`: `ActorRegisterCameraPoint`'s 1.0. */
export const FROG_CAMERA_RISE = 1.0;

// -- the class -------------------------------------------------------------

/**
 * `[port-only]` -- give back a permit this frog still holds, for the two
 * routes out the engine does not have (a script that stops listing the
 * spawn, and the port's sweep).
 *
 * **Only if it still holds it.** The death state frees `g_attack_permits`
 * and leaves `obj+0x121` as it was, as the engine does, so for as long as
 * the corpse lies and sinks the frog still names a permit that may since
 * have gone to another actor. This used to free it again on the way
 * out, from under whoever had it.
 */
function FrogRelease(obj: Actor): void {
  const p = obj.attackPermit;
  if (p !== -1 && G.g_attack_permits[p] === obj.at) G.g_attack_permits[p] = -1;
  obj.attackPermit = -1;
}

const handler: ClassHandler = {
  init: FrogInit,
  update: FrogUpdate,
  updatesWhenDead: true,
  ownsShotResult: true,
  // `[port-only]`: `RetireUnlistedActor`'s route out. A frog gives back what
  // it still holds -- `g_enemies_alive` only until its death state has run,
  // which drops it on the frame of the kill; the corpse retired while it
  // sinks used to be counted out of the room twice.
  leave(obj: Actor): void {
    if (Tail(obj)?.state !== FrogState.Die) G.g_enemies_alive -= 1;
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
