/**
 * The head aim: the one bone the engine turns toward the player.
 *
 * Everything else a zombie or a thrower does with its body is the whole actor
 * turning (`obj+0x68`) and the clip it plays. Bone 2 -- the head, which is a
 * leaf under bone 1 in every class-0x30 and class-0x31 skeleton, character
 * types 0 to 0x19 -- is turned as well, by the node draw hook, while it is
 * drawn:
 *
 * ```
 * ZombieDrawBonePart  (FUN_004534A0)  004534d9  CMP word ptr [EDI+0x14], 0x2
 *                                     004534e0  TEST [ESI+0x34], 0x40000
 *                                     004534ea  CALL 0x00453be0
 * ThrowerDrawBonePart (FUN_00449F90)  00449fbf  TEST AH, 0x1 / TEST AL, 0x20
 *                                     00449fc8  CMP word ptr [EBX+0x14], 0x2
 *                                     00449fcf  TEST [EDI+0x34], 0x40000
 *                                     00449fd9  CALL 0x00453be0
 * ```
 *
 * `[proved]`, and those are the routine's only two callers: an `E8 rel32`
 * scan of `.text` finds no other. Ghidra had no function at `0x00453BE0`, so
 * both calls were in no cross-reference list (`L35`) and `docs/formats/
 * combat.md` recorded, for a long time, that zombies do not aim their heads.
 *
 * ## Where each half lives
 *
 * The routine does two things, and they are on two sides of the layer line:
 *
 * * **It steps two angles** -- `obj+0x1320` (pitch) and `obj+0x1324` (yaw) --
 *   by at most `0xC0` a draw toward the camera, and keeps each inside `0x4000`
 *   of straight ahead. That is state: it carries from frame to frame, so it is
 *   here, in {@link HeadAimWords} on the class's arm, and a snapshot has it.
 * * **It turns the matrix** the hook then draws bone 2 with --
 *   `MatrixRotateY(-centre); MatrixRotateY(yaw); MatrixRotateX(pitch)` on the
 *   copy the hook pushed. That is drawing, and it is
 *   `render/characters/head_aim.ts`, which reads the two angles and
 *   {@link HeadAimWords.headAimed}.
 *
 * Only bone 2's **own** draw turns. The hook pushed the matrix it rotates, so
 * the stored node matrix at `+0x28` -- which `ActorDrawAttachedParts` hangs
 * hair and hats from -- and the hit-sphere centre at `+0x68` both stay where
 * the pose put them.
 *
 * ## One word, two readings
 *
 * `obj+0x1320` is also class 0x30's `ZombieTail.scriptMotion`, the motion id
 * eleven captor states read and write. The engine keeps them apart with
 * `ActorFlag.NoHeadAim`, a spawn-record bit nothing writes: every shipped
 * spawn that can reach one of those states carries it, so the head of an actor
 * that ever holds a motion id there is never aimed. The port gives the two
 * readings two names, as `ZombieTail` does for its other intra-class aliases,
 * and the flag is the measured reason that is safe -- see its doc.
 */
import { ActorFlag, MotionFlag, ThrowerFlag, type Actor } from "../actor";
import { AngleWithinTolerance, TurnAngleToward } from "../actor_turn";
import { G } from "../globals";
import type { GameHost } from "../host";
import {
  FtolS16, MatIdentity, MatrixRotateY, MatrixTransformPoint, MatrixTranslate,
  type Mat,
} from "../matrix";
import { DrawRecordSlot } from "../model_draw";
import type { ClassFrame } from "../registry";
import { VecToAngles, vec3, type Vec3 } from "../vec";
import type { HeadAimWords } from "./state";

/** `CMP word ptr [EDI + 0x14], 0x2` at `0x004534D9`: the head. */
export const HEAD_AIM_BONE = 2;
/** `PUSH 0xc0` (`68c0000000`) before all four `TurnAngleToward` calls. */
export const HEAD_AIM_RATE = 0xc0;
/**
 * `PUSH 0x4000` (`6800400000`) at `0x00453CB6` and `0x00453D07`: how far
 * either angle may stray from straight ahead -- a quarter turn.
 */
export const HEAD_AIM_REACH = 0x4000;
/**
 * `SUB EDI, 0x8000` at `0x00453C03`. Straight ahead for the head is the body's
 * yaw half a turn round, because an actor's facing is the reverse of the
 * direction it looks: `TurnActorTowardCamera` turns `obj+0x68` toward
 * `VecToAngles(obj - camera)`, and the head's target is `VecToAngles(camera -
 * head)`.
 */
export const HEAD_AIM_FACING = 0x8000;
/**
 * `FADD double ptr [0x00565DD8]` -- `0x402E000000000000`, 15.0. The head looks
 * at a point this far above the camera eye, and the two `Init`s seed it
 * toward the same one.
 */
export const HEAD_AIM_RISE = 15.0;
/**
 * The two-attacker target, `((1 - 2*permit) * -1.2, 15.0, -1.5)` in the
 * camera block's heading: `FMUL float ptr [0x00565DFC]` (`0xBF99999A`,
 * -1.2) at `0x00453E10`, `c744242800007041` (15.0) and `c744242c0000c0bf`
 * (-1.5) at `0x00453E00`/`0x00453E08`.
 */
const HEAD_AIM_SHOULDER = Math.fround(-1.2);
const HEAD_AIM_TWO_RISE = 15.0;
const HEAD_AIM_AHEAD = -1.5;

/**
 * The aim's seed, which the two combat `Init`s carry inline and identically:
 *
 * ```
 * EnemyZombieInit  (FUN_00452DA0)  00452eab  TEST EAX, 0x40000   ; obj+0x34
 * EnemyThrowerInit (FUN_00449620)  004496fe  TEST [ESI+0x34], 0x40000
 *   VecToAngles(g_camera_eye_x - obj.x, (g_camera_eye_y + 15.0) - obj.y,
 *               g_camera_eye_z - obj.z, &pitch, &yaw)
 *   obj+0x1320 = pitch & 0xFFFF; obj+0x1324 = yaw & 0xFFFF
 * ```
 *
 * `[proved]`. From the actor's origin, not from its head: there is no pose yet.
 *
 * [port-only] as a function -- the engine has no routine for it, and the two
 * copies are one transcription here so they cannot drift apart.
 */
export function HeadAimSeed(obj: Actor, aim: HeadAimWords): void {
  if ((obj.flags & ActorFlag.NoHeadAim) !== 0) return;
  const e = G.g_camera_eye;
  const a = VecToAngles(Math.fround(e.x - obj.pos.x),
                        Math.fround((e.y + HEAD_AIM_RISE) - obj.pos.y),
                        Math.fround(e.z - obj.pos.z));
  aim.headPitch = FtolS16(a.pitch) & 0xffff;
  aim.headYaw = FtolS16(a.yaw) & 0xffff;
}

const _aim = vec3();

/**
 * `ActorHeadAimAngles` — `FUN_00453D70`. The pitch and yaw from `pt` to the
 * point the head looks at, as `VecToAngles` leaves them: `s16`s.
 *
 * ```
 * if (g_max_attackers == 2 && (s8)obj+0x121 != -1) {
 *   MatrixLoadIdentity(); MatrixTranslate(g_camera_eye);
 *   MatrixRotateY(g_camera_block_yaw_bams[g_camera_index]);
 *   target = MatrixTransformPoint(((1 - 2*permit) * -1.2, 15.0, -1.5));
 * } else {
 *   target = (eye.x, eye.y + 15.0, eye.z);
 * }
 * VecToAngles(target - pt, &pt->pitch, &pt->yaw);
 * ```
 *
 * `[proved]`. With one attacker, 15 units above the eye. With two, a point
 * 1.5 in front of the camera, 15 up and 1.2 to one side for the player whose
 * permit the actor holds -- the head looks at *its* player.
 *
 * The heading is the camera block's own yaw, `0x9A60D0 + g_camera_index *
 * 0x1A4` read at `0x00453DD1` `[proved]`. `UpdateSceneViewAndLight` builds
 * the view as `T(eye) Ry(yaw) Rx Rz` looking down its own -z, so the `-1.5` is
 * in front of the camera, which is the reading that makes the point one the
 * head can see.
 *
 * The eye is `g_camera_eye` (`0x009C71E0`, both branches); the callers pass
 * `ClassFrame.eye`, which is still the camera the renderer last drew rather
 * than the gameplay eye the scene state's hook writes. They coincide on a
 * path (the hook's eye is the pose's, fifteen units down, and the target here
 * is fifteen up) but not under a fixed eye height or while the eye eases.
 */
export function ActorHeadAimAngles(obj: Actor, pt: Vec3, eye: Vec3):
    { pitch: number; yaw: number } {
  let tx: number, ty: number, tz: number;
  if (G.g_max_attackers === 2 && obj.attackPermit !== -1) {
    const m = MatIdentity();
    MatrixTranslate(m, eye.x, eye.y, eye.z);
    MatrixRotateY(m, G.g_camera_block_yaw_bams);
    _aim.x = Math.fround((1 - 2 * obj.attackPermit) * HEAD_AIM_SHOULDER);
    _aim.y = HEAD_AIM_TWO_RISE;
    _aim.z = HEAD_AIM_AHEAD;
    MatrixTransformPoint(m, _aim, _aim);
    tx = Math.fround(_aim.x);
    ty = Math.fround(_aim.y);
    tz = Math.fround(_aim.z);
  } else {
    tx = eye.x;
    ty = eye.y + HEAD_AIM_RISE;
    tz = eye.z;
  }
  const a = VecToAngles(Math.fround(tx - pt.x), Math.fround(ty - pt.y),
                        Math.fround(tz - pt.z));
  return { pitch: FtolS16(a.pitch), yaw: FtolS16(a.yaw) };
}

const _w2v: Mat = MatIdentity();
const _v2w: Mat = MatIdentity();
const _pt = vec3();

/**
 * `ActorAimHeadAtCamera` — `FUN_00453BE0`. Step the head's two angles toward
 * the camera: the state half of the routine.
 *
 * ```
 * centre = (obj+0x68 - 0x8000) & 0xFFFF
 * MatrixStackPush(0)
 * MatrixStackSetTopFromArray(g_camera_blocks + g_camera_index * 0x1A4)
 * pt = MatrixTransformPoint(record[bone] + 0x68)   ; view space -> world
 * MatrixStackPop(1)
 * ActorHeadAimAngles(&pt)
 * t = TurnAngleToward(obj+0x1320, pt.pitch & 0xFFFF, 0xC0)
 * obj+0x1320 = AngleWithinTolerance(t, 0, 0x4000) == 1
 *            ? t : TurnAngleToward(obj+0x1320, 0, 0xC0)
 * t = TurnAngleToward(obj+0x1324, pt.yaw & 0xFFFF, 0xC0)
 * obj+0x1324 = AngleWithinTolerance(t, centre, 0x4000) == 1
 *            ? t : TurnAngleToward(obj+0x1324, centre, 0xC0)
 * MatrixRotateY(-centre); MatrixRotateY(obj+0x1324); MatrixRotateX(obj+0x1320)
 * ```
 *
 * `[proved]`, from the listing at `0x00453BE0..0x00453D67`. A target the head
 * cannot reach does not pin it at the limit either: a step that would leave
 * the quarter turn is thrown away and the head steps **back** toward straight
 * ahead instead, and on the next frame the step toward the target is inside
 * again and is taken. So a head whose player has gone round behind it walks
 * out to the edge and then alternates across the last `0xC0` of it, a frame
 * each way, for as long as the target stays out of reach.
 *
 * The last line is the renderer's -- see the file comment -- and
 * {@link HeadAimWords.headAimed} is how it is told to draw it.
 *
 * The camera block's matrix is `host.cameraMatrices`' view-to-world, which is
 * the camera the renderer last drew with; the record is in that space too
 * (see {@link HeadAimBeginDraw}), so a fresh record comes back as exactly the
 * point the renderer posed. A host with no camera -- a headless run -- cannot
 * place the head at all, and the aim holds: no routine in the game reads
 * these two angles but the draw.
 */
export function ActorAimHeadAtCamera(obj: Actor, aim: HeadAimWords,
                                     f: ClassFrame): void {
  if (!f.host.cameraMatrices?.(_w2v, _v2w)) return;
  const centre = (obj.yaw - HEAD_AIM_FACING) & 0xffff;
  MatrixTransformPoint(_v2w, aim.headRecord, _pt);
  _pt.x = Math.fround(_pt.x);
  _pt.y = Math.fround(_pt.y);
  _pt.z = Math.fround(_pt.z);
  const want = ActorHeadAimAngles(obj, _pt, f.eye);
  const pitch = want.pitch & 0xffff;
  const yaw = want.yaw & 0xffff;
  const p = TurnAngleToward(aim.headPitch, pitch, HEAD_AIM_RATE);
  aim.headPitch = AngleWithinTolerance(p, 0, HEAD_AIM_REACH)
    ? p : TurnAngleToward(aim.headPitch, 0, HEAD_AIM_RATE);
  const y = TurnAngleToward(aim.headYaw, yaw, HEAD_AIM_RATE);
  aim.headYaw = AngleWithinTolerance(y, centre, HEAD_AIM_REACH)
    ? y : TurnAngleToward(aim.headYaw, centre, HEAD_AIM_RATE);
  aim.headAimed = true;
}

/**
 * Does this thrower's hook aim its head? The gate in front of the call in
 * `ThrowerDrawBonePart`, which class 0x30's hook does not have:
 *
 * ```
 * 00449fb6  MOV  EAX, [EDI + 0x136c]
 * 00449fbf  TEST AH, 0x1 / JNZ  -> aim     ; the ceiling
 * 00449fc4  TEST AL, 0x20 / JNZ -> skip    ; off the ground: a wall
 * ```
 *
 * `[proved]`. So a thrower on the ground or on the ceiling looks at you, and
 * one on a wall does not.
 *
 * [port-only] as a function: two tests in the hook, named once for the hook
 * and its test.
 */
export function ThrowerHeadAims(obj: Actor): boolean {
  return (obj.flags2 & ThrowerFlag.Ceiling) !== 0
    || (obj.flags2 & ThrowerFlag.OffGround) === 0;
}

const _world = vec3();

/**
 * What the last frame's draw left in bone 2's record, taken; and this frame's
 * draw, not yet turned.
 *
 * [port-only]. The engine's `SkeletonEmitNode` (`FUN_004114C0`) writes the
 * record inside the draw; the port's draw is the renderer's, and the point it
 * would have written is the hit-sphere centre of the pose it drew --
 * `host.boneSphere`, `obj + bone*0x90 + 0x274` -- brought into the view that
 * draw used, which is `host.cameraMatrices`' world-to-view. Called once a
 * frame, before the node walk, by both classes' updates.
 *
 * Only when {@link HeadAimWords.headRecordDue} says the engine's draw would
 * have written it. Otherwise the record keeps what it had, which is the
 * engine's stale point and not an approximation of it.
 */
export function HeadAimBeginDraw(obj: Actor, aim: HeadAimWords,
                                 host: GameHost): void {
  aim.headAimed = false;
  if (!aim.headRecordDue) return;
  aim.headRecordDue = false;
  const r = host.boneSphere?.(obj.at, HEAD_AIM_BONE, _world);
  if (r === null || r === undefined) return;
  if (!host.cameraMatrices?.(_w2v, _v2w)) return;
  MatrixTransformPoint(_w2v, _world, aim.headRecord);
  aim.headRecord.x = Math.fround(aim.headRecord.x);
  aim.headRecord.y = Math.fround(aim.headRecord.y);
  aim.headRecord.z = Math.fround(aim.headRecord.z);
}

/**
 * Whether this frame's draw writes bone 2's record: the latch
 * {@link HeadAimBeginDraw} reads next frame.
 *
 * [port-only]. `SkeletonEmitNode` writes `+0x68` after the hook under the
 * node's slot and `MotionFlag.Drawn` -- not under the veto, which only takes
 * the hook away -- and only while `obj+0x34` lacks `0x8000`:
 *
 * ```
 * 004114f7  TEST EAX, EAX / JZ 0x004116cc    ; the record's slot
 * 00411505  TEST byte ptr [ECX + 0x64], 0x1  ; MotionFlag.Drawn
 * 00411685  TEST AH, 0x80 / JNZ 0x004116cc   ; obj+0x34 & 0x8000
 * 004116c3  MOV  [ESI + 0x68], ECX           ; ...+0x6C, +0x70
 * ```
 *
 * `[proved]`. Called after the node walk, by both classes' updates.
 */
export function HeadAimEndDraw(obj: Actor, aim: HeadAimWords): void {
  aim.headRecordDue = DrawRecordSlot(obj, HEAD_AIM_BONE) !== 0
    && (obj.motionFlags & MotionFlag.Drawn) !== 0
    && (obj.flags & ActorFlag.NoShotTest) === 0;
}
