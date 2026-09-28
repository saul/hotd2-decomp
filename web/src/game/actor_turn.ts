/**
 * Turning.
 *
 * Actors turn their **whole body**: every routine here steps `obj+0x68`, the
 * yaw, and `SkeletonWalkNode` reads every bone rotation straight from the
 * motion bank. **One bone is aimed, though, and it is not ported.** The
 * class-0x30 and class-0x31 per-bone draw hooks, `ZombieDrawBonePart`
 * (`FUN_004534A0`, at `004534ea`) and `ThrowerDrawBonePart` (`FUN_00449F90`,
 * at `00449fd9`), call the routine at `0x00453BE0` for bone 2 unless
 * `obj+0x34` bit `0x40000` is up, and it steps `obj+0x1320`/`obj+0x1324`
 * toward the camera with {@link TurnAngleToward} at `0xC0` a call before
 * rotating the bone by them -- the head following you. Ghidra has no function
 * at that address, so its four calls to `FUN_00409E00` are in no xref list
 * (L35); a byte scan for `E8` finds them. Class 0x25's
 * `ScriptedHumanoidBoneDrawHook` has a twin at `0x00485BA0`. `[proved]` that
 * they call the turn; the rest of the two routines is unread.
 *
 * **The exe turns once per 60 Hz frame and the port's tick may be several**
 * (`Tick.dt` is `frames * TICK`). Every wrapper below takes the tick's `dt`,
 * turns it into whole frames with `SecondsToTicks` -- the same edge every
 * per-frame counter in `game/` crosses -- and steps the exe's own routine that
 * many times, which is what that many engine frames do to the yaw.
 */
import { SecondsToTicks } from "./tables";
import type { Actor } from "./actor";
import { VecToAngles, bamsWrap, type Vec3 } from "./vec";
import {
  FtolS16, MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ,
  MatrixTransformPoint, MatrixTranslate, RADIANS_TO_BAMS,
} from "./matrix";

/**
 * `TurnAngleToward` — `FUN_00409E00`. Step an angle toward another by at most
 * *rate* BAMS, and return the new angle. `[proved]`, the whole routine:
 *
 * ```
 * 00409e0b  AND EAX, 0xffff            ; a = cur & 0xffff
 * 00409e10  AND EDI, 0xffff            ; b = want & 0xffff
 * 00409e16  ESI = a - b; EBX = |a - b|             ; the direct way
 * 00409e24  EDX = b - a + 0x10000                  ; up, through 0xFFFF -> 0
 *           (if negative: a - b - 0x10000)
 * 00409e38  ESI = a - b + 0x10000                  ; down, through 0 -> 0xFFFF
 *           (if negative: b - a - 0x10000)
 * 00409e4c  CMP EBX, rate; JLE ->b     ; any of the three within the rate:
 * 00409e50  CMP EDX, rate; JLE ->b     ;   land on the target, masked
 * 00409e54  CMP ESI, rate; JLE ->b
 * 00409e58  CMP EAX, EDI; JL           ; a < b: EBX > ESI ? a - rate : a + rate
 * 00409e5c  CMP EBX, EDX; JG           ; a >= b: EBX > EDX ? a + rate : a - rate
 * ```
 *
 * All comparisons signed. What that makes it:
 *
 * * **A rate limit, not an ease**: the step is the rate, whatever is left.
 * * **The short way round**, with the tie -- exactly 0x8000 apart -- going
 *   up when `a < b` and down when `a > b`.
 * * **A negative rate turns away.** No distance is ever `<=` a negative rate,
 *   so it never lands; and the step `a ± rate` goes the long way. The yaw
 *   runs toward the opposite heading at `|rate|` a frame and then dithers
 *   `±|rate|` about it for as long as the caller keeps calling -- nothing in
 *   the routine settles it. `ZombieStateBackOff` (-0x40) and class 0x31's
 *   `ThrowerStateLeapAside` and `ThrowerStateWithdraw` (-0x100) are the three
 *   callers that use it.
 * * **The result is not wrapped.** `a + rate` from `0xFFF0` is `0x10030` and
 *   `a - rate` from 0x10 is negative; the caller stores it as it is and the
 *   next call masks it. So does the port.
 *
 * The two `if negative` fallbacks cannot fire: both sums are at least 1 for
 * masked inputs. They are transcribed anyway, because they are there.
 *
 * It used to be `|rate| * frames` toward `bamsDelta` with the result wrapped,
 * which is the same for a positive rate and nothing like it for a negative
 * one; the one negative caller then added 0x8000 to its target to make up the
 * difference, and snapped where the engine dithers.
 */
export function TurnAngleToward(cur: number, want: number, rate: number): number {
  const a = cur & 0xffff;
  const b = want & 0xffff;
  const direct = a - b < 0 ? b - a : a - b;             // EBX
  let up = b - a + 0x10000;                             // EDX
  if (up < 0) up = a - b - 0x10000;
  let down = a - b + 0x10000;                           // ESI
  if (down < 0) down = b - a - 0x10000;
  if (direct <= rate || up <= rate || down <= rate) return b;
  if (a < b) return direct > down ? a - rate : a + rate;
  return direct > up ? a + rate : a - rate;
}

/**
 * {@link TurnAngleToward} applied once per engine frame the tick covers, with
 * the same target each time. `[port-only]`: the exe calls it once a frame and
 * has no ticks. For a caller that turns an angle directly rather than through
 * one of the wrappers below -- `ZombieStateDragTarget`'s settle,
 * `ThrowerStateDelayedPounce`'s roll.
 */
export function TurnAngleTowardFrames(cur: number, want: number, rate: number,
                                      frames: number): number {
  let a = cur;
  for (let i = 0; i < frames; i++) a = TurnAngleToward(a, want, rate);
  return a;
}

/**
 * The target yaw `VecToAngles` hands the turn routines: `atan2(dx, dz)` to
 * BAMS, truncated by `__ftol` and stored as an `s16` (`*param_6 =
 * (int)(short)ftol(...)` at the end of `FUN_004016B0`). `[port-only]` as a
 * function; the exe does it inside `VecToAngles`.
 */
function YawOf(dx: number, dy: number, dz: number): number {
  return FtolS16(VecToAngles(dx, dy, dz).yaw);
}

/** `MOV [ESP+0x30], 0x3fc00000` at `0x00409F24`: the point `(0, 0, 1.5)`. */
const TOWARD_CAMERA_POINT: Readonly<Vec3> = { x: 0, y: 0, z: 1.5 };
const _p: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * `TurnActorTowardCamera` — `FUN_00409ED0`. `obj+0x68` toward a point 1.5
 * units from the camera eye, at *rate* BAMS a frame. `[proved]`, from the
 * listing -- the pseudocode stops at `MatrixStackPop` and shows none of the
 * turn:
 *
 * ```
 * 00409ed4  MatrixStackPush(0); MatrixLoadIdentity()
 * 00409ef4  MatrixTranslate(g_camera_eye_x, g_camera_eye_y, g_camera_eye_z)
 * 00409ef9  FLD float ptr [0x009c71e4]              ; g_camera_eye_y
 * 00409eff  CALL __ftol; PUSH EAX; CALL MatrixRotateY
 * 00409f24  MatrixTransformPoint({0, 0, 0x3fc00000}, &p); MatrixStackPop(1)
 * 00409f61  VecToAngles(obj+0x40 - p.x, 0, obj+0x48 - p.z, &pitch, &yaw)
 * 00409f74  obj+0x68 = TurnAngleToward(obj+0x68, yaw, [ESP+0x40])  ; arg 2
 * ```
 *
 * **The rotation is by the eye's *height*, not by any angle.** `0x009C71E4`
 * is `g_camera_eye_y` -- the same dword the translate pushed as its second
 * argument -- and the camera's yaw is `g_camera_yaw_bams` at `0x009C71F0`,
 * which this does not read. So the point is 1.5 units along world +Z from the
 * eye, turned by a few dozen BAMS at the heights the stages use: not "in front
 * of the camera", which is what this and `ACTOR_FACE_OFFSET` both said.
 *
 * The angle is **actor minus point**, as every turn here takes it, because
 * the actor's facing is the reverse of the direction it walks.
 *
 * Its only callers are the two in `ZombieStateAttackRun` (`0045559d`,
 * `00455642`), which pass `ftol((bit27 * 1.5 + 1.0) * 416.0)`.
 */
export function TurnActorTowardCamera(obj: Actor, eye: Vec3, rate: number,
                                      dt: number): void {
  const m = MatIdentity();
  MatrixTranslate(m, eye.x, eye.y, eye.z);
  MatrixRotateY(m, Math.trunc(eye.y));
  MatrixTransformPoint(m, TOWARD_CAMERA_POINT, _p);
  obj.yaw = TurnAngleTowardFrames(obj.yaw,
    YawOf(obj.pos.x - _p.x, 0, obj.pos.z - _p.z), rate, SecondsToTicks(dt));
}

/**
 * `TurnActorTowardCameraEye` — `FUN_00409E80`. The same turn with no offset:
 * `VecToAngles(obj+0x40 - g_camera_eye_x, 0, obj+0x48 - g_camera_eye_z)`, then
 * {@link TurnAngleToward} at the caller's rate. `[proved]`
 */
export function TurnActorTowardCameraEye(obj: Actor, eye: Vec3,
                                         rate: number, dt = 1 / 60): void {
  obj.yaw = TurnAngleTowardFrames(obj.yaw,
    YawOf(obj.pos.x - eye.x, 0, obj.pos.z - eye.z), rate, SecondsToTicks(dt));
}

/**
 * `TurnActorAwayFromPoint` — `FUN_00409F90`. `(obj, x, z, rate)`:
 * `VecToAngles(obj+0x40 - x, 0, obj+0x48 - z)` and {@link TurnAngleToward}.
 * `[proved]`, and that is all of it.
 *
 * "Away" is the heading from the point to the actor, which is the heading an
 * actor has when it is *facing* the point, for the reason
 * {@link TurnActorTowardCamera} gives. With a negative rate the turn itself
 * goes the other way -- see {@link TurnAngleToward}.
 *
 * Two things this used to add, neither of which the routine has: 0x8000 on
 * the target for a negative rate, which stood in for the long-way step the
 * routine really takes; and an early return when the actor stood on the
 * point. `VecToAngles(0, 0, 0)` is `atan2(0, 0)`, zero, and the engine turns
 * toward it.
 */
export function TurnActorAwayFromPoint(obj: Actor, p: Vec3, rate: number,
                                     dt: number): void {
  obj.yaw = TurnAngleTowardFrames(obj.yaw,
    YawOf(obj.pos.x - p.x, 0, obj.pos.z - p.z), rate, SecondsToTicks(dt));
}

/**
 * `TurnActorAwayFromPointTestArrival` — `FUN_00409FE0`.
 * `(obj, x, y, z, rate, tolerance)`: {@link TurnActorAwayFromPoint} with the
 * height in the `VecToAngles` call, and then
 * `AngleWithinTolerance(new yaw, target, tolerance)` -- whose answer is the
 * routine's own, falling out through `EAX` although Ghidra types it `void`.
 * `[proved]`
 */
export function TurnActorAwayFromPointTestArrival(obj: Actor, p: Vec3,
                                                  rate: number,
                                                  tolerance: number,
                                                  dt: number): boolean {
  const want = YawOf(obj.pos.x - p.x, obj.pos.y - p.y, obj.pos.z - p.z);
  obj.yaw = TurnAngleTowardFrames(obj.yaw, want, rate, SecondsToTicks(dt));
  return AngleWithinTolerance(obj.yaw, want, tolerance);
}

/**
 * `AngleWithinTolerance` — `FUN_0040A040`. Is *angle* within *tolerance* of
 * *centre*, the short way round? `[proved]`:
 *
 * ```
 * 0040a048  c = centre & 0xffff
 * 0040a050  lo = c - tol + 0x10000; hi = c + tol + 0x10000
 * 0040a05e  CMP; JBE                   ; unsigned: swap if lo > hi
 * 0040a06c  a = angle & 0xffff
 * 0040a072  CMP ECX, EAX; JAE          ; unsigned: a < lo? then
 * 0040a076  a += ((lo - a + 0xffff) >> 16) << 16   ;   lift it by whole turns
 * 0040a085  CMP EDX, ECX; SBB EAX, EAX; INC EAX   ; hi >= a
 * ```
 *
 * Both ends inclusive. It has other readers --
 * `ZombieShouldStandAndThrow`'s facing window and the cardinal snap in class
 * 0x31's surface code among them -- which still carry their own spelling of
 * it.
 */
export function AngleWithinTolerance(angle: number, centre: number,
                                     tolerance: number): boolean {
  const c = centre & 0xffff;
  let lo = c - tolerance + 0x10000;
  let hi = c + tolerance + 0x10000;
  if ((lo >>> 0) > (hi >>> 0)) { const t = lo; lo = hi; hi = t; }
  let a = angle & 0xffff;
  if ((a >>> 0) < (lo >>> 0)) {
    a += Math.floor((lo - a + 0xffff) / 0x10000) * 0x10000;
  }
  return (hi >>> 0) >= (a >>> 0);
}

/**
 * `ActorFacePlayerTarget` — `FUN_00455F40`. Snap the yaw straight at the
 * player — no easing — and remember where that player was.
 *
 * With one attacker the target is the camera eye. With two it is a shoulder
 * offset from it, per permit index, which is why the point is stored on the
 * actor rather than recomputed: the strike's lunge and the retreat both
 * measure against the same remembered spot.
 */
export function ActorFacePlayerTarget(obj: Actor, eye: Vec3): void {
  obj.target.x = eye.x;
  obj.target.y = eye.y;
  obj.target.z = eye.z;
  obj.yaw = bamsWrap(
    VecToAngles(obj.pos.x - eye.x, 0, obj.pos.z - eye.z).yaw);
}

const _heading: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * `ActorHeadingErrorTo` — `FUN_00426090`. The signed BAMS heading of an x/z
 * offset **in the actor's own frame**: `(dx, 0, dz)` through the inverse of
 * the actor's rotation, then `atan2(x, z)`.
 *
 * ```
 * MatrixStackPush(0); MatrixLoadIdentity()
 * MatrixRotateY(-obj+0x68); MatrixRotateZ(-obj+0x6C); MatrixRotateX(-obj+0x64)
 * MatrixTransformPoint({dx, 0, dz}, &out); MatrixStackPop(1)
 * 004260f3  FLD [out.x]; FLD [out.z]; FPATAN        ; atan2(x', z')
 * 00426100  FMUL double ptr [0x004c4378]            ; * 65536/2pi
 * 00426106  CALL __ftol; MOVSX EAX, AX
 * ```
 *
 * The tail after `MatrixStackPop` is where the answer is computed, and
 * Ghidra's listing stops at the pop (L35). The pitch and roll are part of the
 * transform: a class whose actor is tilted gets the heading in its tilted
 * frame, which a plain `atan2` of the offset against the yaw does not give.
 */
export function ActorHeadingErrorTo(obj: Actor, dx: number, dz: number): number {
  const m = MatIdentity();
  MatrixRotateY(m, -obj.yaw);
  MatrixRotateZ(m, -obj.roll);
  MatrixRotateX(m, -obj.pitch);
  MatrixTransformPoint(m, { x: dx, y: 0, z: dz }, _heading);
  return FtolS16(Math.atan2(_heading.x, _heading.z) * RADIANS_TO_BAMS);
}

/**
 * `ActorTurnTowardXZ` — `FUN_00426120`. Turn the yaw toward an x/z offset by
 * at most `step` BAMS:
 *
 * ```
 * e = ActorHeadingErrorTo(obj, dx, dz)
 * 0042613c  CMP EAX, ECX; JLE      ; e >  step: yaw += step
 * 0042614e  CMP EAX, EDX; JGE      ; e < -step: yaw -= step
 *           otherwise               ;            yaw += e
 * ```
 *
 * The yaw is an `int` and is not wrapped -- `ADD`/`SUB` on the dword -- so
 * neither is it here.
 */
export function ActorTurnTowardXZ(obj: Actor, dx: number, dz: number,
                                  step: number): void {
  const e = ActorHeadingErrorTo(obj, dx, dz);
  if (e > step) { obj.yaw = (obj.yaw + step) | 0; return; }
  if (e < -step) { obj.yaw = (obj.yaw - step) | 0; return; }
  obj.yaw = (obj.yaw + e) | 0;
}

const _ahead: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * `ActorPointIsAhead` — `FUN_0045BC10`. Is the point in front of the actor?
 *
 * ```
 * MatrixStackPush(0); MatrixLoadIdentity()
 * MatrixRotateY(-angles[1]); MatrixRotateZ(-angles[2]); MatrixRotateX(-angles[0])
 * MatrixTransformPoint(p - pos, &out); MatrixStackPop(1)
 * 0045bc7e  FLD [out.z]; FCOMP 0.0; TEST AH, 0x41; JNZ -> 0     ; z > 0
 * ```
 *
 * The inverse of **all three** angles, as {@link ActorHeadingErrorTo} takes
 * them -- the arguments are pointers to `obj+0x64` and `obj+0x40`. It lived in
 * `class30/target.ts` as the yaw alone, which is the same number for an
 * upright actor and every zombie is one; the stage-4 boss is a second caller,
 * so there is one copy of it here now. `z` alone for the yaw-only case is
 * `dx·sin(yaw) + dz·cos(yaw)`, the inverse rotation -- the sign that stage 1's
 * block-1 captor found.
 */
export function ActorPointIsAhead(obj: Pick<Actor, "pos" | "yaw" | "pitch"
                                           | "roll">, p: Vec3): boolean {
  const m = MatIdentity();
  MatrixRotateY(m, -obj.yaw);
  // `|| 0`: a caller holding an upright actor may hand over one with no
  // pitch or roll fields at all, and those are zero.
  MatrixRotateZ(m, -(obj.roll || 0));
  MatrixRotateX(m, -(obj.pitch || 0));
  MatrixTransformPoint(m, { x: p.x - obj.pos.x, y: p.y - obj.pos.y,
                            z: p.z - obj.pos.z }, _ahead);
  return _ahead.z > 0;
}
