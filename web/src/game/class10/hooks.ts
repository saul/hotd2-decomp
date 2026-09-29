/**
 * The two hook slots class 0x10 installs into, and the routines that fill them.
 *
 * They are different slots and it is worth keeping them apart. `sub+0x5C` is
 * the **frame hook**, and it takes two routines to fill: op 0x10's operand
 * names an *install* routine ({@link CivilianHookInstall}), which both VMs
 * call and which writes a *step* ({@link CivilianFrameHook}) into the slot for
 * `CivilianUpdate` to call once a frame. `PoseHookGrowAndPushOutOfWorld` at
 * `0x0048D070` is the **pose hook**, installed once by `CivilianInit`
 * (`FUN_0048A3E0`) and one of only two in the whole program.
 *
 * Four installs and four steps, one function each, as the exe has them. They
 * were once three steps short: this file ran the fall step for three of the
 * installs, which it believed "differ only in the velocity they take out of
 * the command". Two of the three install a step of their own, with no gravity
 * and no ground -- see {@link CivilianHookStartMoveY} and
 * {@link CivilianHookStartMoveLocal}.
 */
import { ActorFlag, type Actor } from "../actor";
import { ColiTestSphereAgainstFullSet, QueryGroundHeightAt } from "../coli";
import { G } from "../globals";
import { MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ,
         MatrixTransformPoint, MatrixTranslate } from "../matrix";
import { vec3 } from "../vec";
import { AsFloat, CivilianFrameHook, CivilianHookInstall, CivilianWait }
  from "./ops";
import { CivilianHookRideChildrenStep } from "./children";

/**
 * `MOV dword ptr [EDX + 0x1C], 0xBCDF0123` at `0x0048DA13`: the dword
 * `CivilianHookStartFall` stores into `obj+0x5C`, -0.027222222 as a float.
 * Kept as the bits because the store is a `MOV` of an immediate, not a float
 * the port may round: the old `-0.02722` was off in the sixth figure.
 */
const START_FALL_ACCEL_BITS = 0xbcdf0123;
/** `FADD float ptr [0x004C43B0]` at `0x0048DA2D`: 100.0, the probe's lift. */
const FALL_PROBE = 100;

/**
 * `CivilianHookStartFall` — `FUN_0048D9F0`.
 *
 * `sub+0x5C = CivilianHookFallStep`, `obj+0x50` (the y velocity) = 0 and
 * `obj+0x5C` = {@link START_FALL_ACCEL_BITS}, in that order, and it returns
 * `cmd + 2` untouched: no operand.
 */
export function CivilianHookStartFall(obj: Actor): void {
  const sub = obj.civ;
  if (!sub) return;
  sub.hook = CivilianFrameHook.FallStep;
  obj.vel.y = 0;
  obj.accY = AsFloat(START_FALL_ACCEL_BITS);
}

/**
 * `CivilianHookFallStep` — `FUN_0048DA20`.
 *
 * The ground is asked for **first**, at the position the actor had before this
 * frame's move: `QueryGroundHeightAt(x, y + 100, z)` at `0x0048DA39`. Then
 * `obj+0x50 += obj+0x5C`, `obj+0x44 += obj+0x50` -- the y axis and nothing
 * else. `FCOM` / `TEST AH, 1` / `JNZ` at `0x0048DA63`: while the ground is
 * below the new height (or the compare is unordered) that is all. Otherwise
 * `y` is snapped to the ground, `sub+0x18` goes up -- wait bit 0x400's
 * condition -- and the slot goes back to `NoOpStub`.
 *
 * **The velocity is left as it landed.** The port used to zero all three
 * words on landing, move `x` and `z` by the velocity as well, and scale every
 * term by the frame count; none of that is in the routine.
 */
export function CivilianHookFallStep(obj: Actor): void {
  const sub = obj.civ;
  if (!sub) return;
  const ground = QueryGroundHeightAt(obj.pos.x,
                                     Math.fround(obj.pos.y + FALL_PROBE),
                                     obj.pos.z);
  obj.vel.y = Math.fround(obj.accY + obj.vel.y);
  obj.pos.y = Math.fround(obj.vel.y + obj.pos.y);
  if (!(ground >= obj.pos.y)) return;
  obj.pos.y = Math.fround(ground);
  sub.hookDone = 1;
  sub.hook = CivilianFrameHook.None;
}

/**
 * `CivilianHookRideChildren` — `FUN_0048DA90`.
 *
 * `sub+0x5C = CivilianHookRideChildrenStep` and nothing else; `cmd + 2` back.
 */
export function CivilianHookRideChildren(obj: Actor): void {
  const sub = obj.civ;
  if (!sub) return;
  sub.hook = CivilianFrameHook.RideChildrenStep;
}

/**
 * `CivilianHookStartMoveY` — `FUN_0048DB90`.
 *
 * `sub+0x5C = CivilianHookMoveYStep`; the one operand, verbatim, into
 * `obj+0x50`; `obj+0x34 |= 0x80000`; and `cmd + 3` back. It does **not**
 * write `obj+0x5C`, and its step reads no gravity -- the port ran the fall
 * step here with the fall's gravity, so what the exe moves at a constant speed
 * for ever the port accelerated and stopped on the floor.
 *
 * The flag bit is the one `ActorDrawShadow` tests before drawing the ground
 * disc, {@link ActorFlag.NoShadow}; that is its reader, not a claim about
 * what the install means by it.
 *
 * The shared table uses it three times, streams 61, 67 and 71, each with
 * -0.2 and each after a clip change: a steady sink. Each of those is the
 * on-shot stream of 62, 68 or 72, and no spawn the bundle carries runs any of
 * the three.
 */
export function CivilianHookStartMoveY(obj: Actor,
                                       operands: readonly number[]): void {
  const sub = obj.civ;
  if (!sub) return;
  sub.hook = CivilianFrameHook.MoveYStep;
  obj.vel.y = AsFloat(operands[0] ?? 0);
  obj.flags |= ActorFlag.NoShadow;
}

/**
 * `CivilianHookMoveYStep` — `FUN_0048DBC0`.
 *
 * `FLD [xform + 0x10]; FADD [xform + 4]; FSTP [xform + 4]; RET` -- `y +=
 * vel.y`, every frame, until op 0x10 installs something else. No gravity, no
 * ground, no uninstall, and `sub+0x18` never goes up, so a wait on bit 0x400
 * never ends on this one.
 */
export function CivilianHookMoveYStep(obj: Actor): void {
  obj.pos.y = Math.fround(obj.vel.y + obj.pos.y);
}

/**
 * `CivilianHookStartMoveLocal` — `FUN_0048DBD0`.
 *
 * `sub+0x5C = CivilianHookMoveLocalStep` and the three operands, verbatim,
 * into `obj+0x4C..0x54`; `cmd + 5` back. No gravity written here either.
 *
 * Its one use in the shared table is stream 72's command 4, `(0, 0, -0.05)`,
 * which a later op 0x10 with a null operand takes back out.
 */
export function CivilianHookStartMoveLocal(obj: Actor,
                                           operands: readonly number[]): void {
  const sub = obj.civ;
  if (!sub) return;
  sub.hook = CivilianFrameHook.MoveLocalStep;
  obj.vel.x = AsFloat(operands[0] ?? 0);
  obj.vel.y = AsFloat(operands[1] ?? 0);
  obj.vel.z = AsFloat(operands[2] ?? 0);
}

/**
 * `CivilianHookMoveLocalStep` — `FUN_0048DC10`.
 *
 * The velocity turned by the actor's own rotation and added to its position:
 *
 * ```
 * 0048dc13  PUSH 0 / CALL MatrixStackPush
 * 0048dc1a  CALL MatrixLoadIdentity
 * 0048dc2f  CALL MatrixTranslate(obj+0x40, obj+0x44, obj+0x48)
 * 0048dc3e  CALL MatrixRotateX(obj+0x64)
 * 0048dc4c  CALL MatrixRotateZ(obj+0x6C)
 * 0048dc5b  CALL MatrixRotateY(obj+0x68)
 * 0048dc84  CALL MatrixTransformPoint(&vel, &out)
 * 0048dc94  FSTP [obj+0x40] ... [obj+0x48]           ; pos = out
 * 0048dcb0  PUSH 1 / CALL MatrixStackPop
 * 0048dcb5  ADD ESP, 0x40 / RET
 * ```
 *
 * Ghidra marks the pop no-return and ends the body before the last line
 * (L35); the disassembly past it is the stack cleanup and nothing else. No
 * gravity, no ground and no uninstall, the same as the y step.
 */
export function CivilianHookMoveLocalStep(obj: Actor): void {
  // `MatrixStackPush(0)` and `MatrixLoadIdentity`: a fresh identity on top,
  // popped again at the end, so nothing outlives the routine.
  const m = MatIdentity();
  MatrixTranslate(m, obj.pos.x, obj.pos.y, obj.pos.z);
  MatrixRotateX(m, obj.pitch);
  MatrixRotateZ(m, obj.roll);
  MatrixRotateY(m, obj.yaw);
  const out = vec3();
  MatrixTransformPoint(m, obj.vel, out);
  obj.pos.x = Math.fround(out.x);
  obj.pos.y = Math.fround(out.y);
  obj.pos.z = Math.fround(out.z);
}

/**
 * Op 0x10's `CALL ECX`, with the operand as the pointer and `(obj, cmd + 2)`
 * as the arguments -- `0x0048BD8D` in `CivilianRunScript`, `0x0048B923` in
 * `CivilianReapplyWaitCommand`. Neither VM calls it for a null operand.
 *
 * [port-only] The engine calls the address; this is the port's spelling of
 * that call, one arm per routine the exporter will decode. The pointer each
 * routine returns -- the next command -- is not modelled: the exporter has
 * already cut the stream at the length each one returns, so `operands` is
 * exactly the dwords the routine reads.
 */
export function CivilianCallHookInstall(obj: Actor, hook: number,
                                        operands: readonly number[]): void {
  switch (hook as CivilianHookInstall) {
    case CivilianHookInstall.StartFall:
      CivilianHookStartFall(obj);
      break;
    case CivilianHookInstall.RideChildren:
      CivilianHookRideChildren(obj);
      break;
    case CivilianHookInstall.StartMoveY:
      CivilianHookStartMoveY(obj, operands);
      break;
    case CivilianHookInstall.StartMoveLocal:
      CivilianHookStartMoveLocal(obj, operands);
      break;
  }
}

/**
 * `sub+0x5C`, called once a frame: `PUSH ESI; CALL dword ptr [EAX + 0x5C]` at
 * `0x0048A961`, straight after the child prune and before anything else moves
 * the actor.
 *
 * [port-only] The engine calls the pointer; this is the port's spelling of
 * that call. `sub.hook` holds the **step's** address, which is what the slot
 * holds -- see {@link CivilianFrameHook}. `NoOpStub` is a bare `RET`.
 */
export function CivilianRunFrameHook(obj: Actor): void {
  const sub = obj.civ;
  if (!sub) return;
  switch (sub.hook as CivilianFrameHook) {
    case CivilianFrameHook.FallStep:
      CivilianHookFallStep(obj);
      break;
    case CivilianFrameHook.RideChildrenStep:
      CivilianHookRideChildrenStep(obj);
      break;
    case CivilianFrameHook.MoveYStep:
      CivilianHookMoveYStep(obj);
      break;
    case CivilianFrameHook.MoveLocalStep:
      CivilianHookMoveLocalStep(obj);
      break;
    case CivilianFrameHook.None:
      break;
  }
}

/**
 * `PoseHookGrowAndPushOutOfWorld` — `FUN_0048D070`.
 *
 * The class's per-frame pose hook, and one of only two in the program. It does
 * two things and neither is a bone: it steps `obj+0x128` — the **body radius**
 * — toward the target op 0x16 set, by that op's per-frame step, clamping at
 * the target from whichever side it approaches; then, if the civilian's wait
 * word carries {@link CivilianWait.PushOutOfWorld}, it traces that sphere
 * against the full collision set and moves the actor out along the hit normal
 * by the **whole** penetration.
 *
 * **The sphere it traces is `obj+0x12C` as it stands**: `LEA EDX, [ESI+0x12C];
 * PUSH ECX (obj+0x128); PUSH EDX; CALL ColiTestSphereAgainstFullSet` at
 * `0x0048D0F2`..`0x0048D100`. `[proved]` Nothing here derives a centre. The
 * port used to rebuild one first with `ActorUpdateBoundingSphere`
 * (`FUN_00454AC0`) — class 0x30's feet-plus-radius-plus-one, which no
 * civilian has — so the push measured a point the civilian never publishes.
 *
 * And as it stands **at the draw**, which is before this frame's switch
 * writes it: the engine calls the hook through `model+0x115C` from
 * `SkeletonApplyRootMotion` (`FUN_00410C50`, `CALL [ECX+0x115C]` at
 * `0x00410E93`, which both of its arms reach — the root-motion arm past the
 * `MatrixStackPop` Ghidra marks no-return, L35), inside
 * `DrawSkinnedModelAndShadow` (`FUN_00411090`) at the top of
 * `CivilianUpdate`. So the sphere is the one the switch wrote on the
 * previous frame, and a radius op 0x16 set this frame is ramped on the next.
 * `CivilianUpdate` calls this where the draw is for that reason.
 *
 * The engine runs it from the pose walk; the port runs it from the update,
 * for the same reason `ActorAdvanceMotion` lives in `game/` — a hook that only
 * fires while something is drawing is a hook that a headless run and a
 * restored save both lose.
 */
export function PoseHookGrowAndPushOutOfWorld(obj: Actor): void {
  const sub = obj.civ;
  if (!sub) return;
  if (sub.scaleTarget !== obj.bodyRadius) {
    obj.bodyRadius += sub.scaleStep;
    // Clamp from whichever side it is closing: growing overshoots upward,
    // shrinking overshoots downward, and a zero step never arrives at all.
    if (sub.scaleStep > 0 && obj.bodyRadius > sub.scaleTarget) {
      obj.bodyRadius = sub.scaleTarget;
    } else if (sub.scaleStep < 0 && obj.bodyRadius < sub.scaleTarget) {
      obj.bodyRadius = sub.scaleTarget;
    }
  }
  if (!(sub.wait & CivilianWait.PushOutOfWorld)) return;
  if (!ColiTestSphereAgainstFullSet(obj.sphereCentre.x, obj.sphereCentre.y,
                                    obj.sphereCentre.z, obj.bodyRadius)) {
    return;
  }
  const d = G.g_coli_hit_depth;
  obj.pos.x += (G.g_coli_hit_normal[0] ?? 0) * d;
  obj.pos.y += (G.g_coli_hit_normal[1] ?? 0) * d;
  obj.pos.z += (G.g_coli_hit_normal[2] ?? 0) * d;
}
