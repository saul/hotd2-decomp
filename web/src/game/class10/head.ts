/**
 * A civilian's head: where it looks, and its mouth.
 *
 * Both are one routine. `CivilianInit` (`FUN_0048A3E0`) installs
 * `CivilianDrawBonePart`, the routine at `0x0048D1F0`, as the per-node draw
 * hook (`MOV dword ptr [EAX + 0x1158], 0x48d1f0` at `0x0048A60B`), and its
 * bone-2 arm does two things before it draws the head.
 *
 * **It turns the head.** While `sub+0x8C` names a target -- the camera, her
 * captor's head, a point -- the arm finds the angles that would face it from
 * bone 1's frame, clamps them to what a neck can do, eases the head toward
 * them `0x100` a frame and **stores the turned matrix over bone 2's record**.
 * That last part is what sets it apart from class 0x30's head aim
 * (`class30/head_aim.ts`), whose hook turns only its own push: here the
 * hit centre `SkeletonEmitNode` takes after the hook, every attachment hung
 * from the record and the head's own draw all turn with it. Her script points
 * it, with ops `0x23` and `0x24`.
 *
 * **It moves the mouth.** Nothing in a civilian's motion does: her face is a
 * model, and for bone 2 the hook submits the bone's record slot **plus a
 * cel** -- a small number read out of one of six lists,
 * `g_civilian_mouth_tables` (`0x0056B950`), stepping once per drawn frame.
 * The `hito_kao_*` faces are laid out for it, twenty consecutive slots a
 * face, and `slot + cel` is the same head with the lower face moved: `0x0C6A`
 * against `0x0C6C`, two cels apart in `hito_kao_gal.bin`, differ in 62 of 149
 * vertices, every one of them below the eyes and on the front. Op `0x25`
 * (`CivilianOp.SetMouth`) stores how many frames, which list, and a zero
 * cursor; the shipped streams name lists 0, 1, 2 and 5. List 2 hands over to
 * list 3 when its frames run out, and list 3's last cel holds.
 *
 * ## Where each half of the turn lives
 *
 * The angles are state -- they carry from frame to frame, and the mode they
 * drop back to is what the next op reads over -- so they are here, on
 * `CivilianState`. The matrix is drawing, and it is
 * `render/characters/civilian_head.ts`, which rebuilds bone 2 from the
 * angles while {@link CivilianState.headLookTurned} says this frame's hook
 * rewrote the record.
 */
import { ActorFlag, type Actor } from "../actor";
import { CarrierMatrixCompose } from "../carrier";
import { ActorByAt, G } from "../globals";
import {
  FtolS16, MatCopy, MatIdentity, MatrixGetAngles, MatrixGetTranslation,
  MatrixInvert, MatrixLoadIdentity, MatrixMultiply, MatrixRotateX,
  MatrixRotateY, MatrixRotateZ, MatrixTransformPoint, MatrixTranslate,
  type Mat, type Rot3,
} from "../matrix";
import type { ClassFrame } from "../registry";
import { T } from "../tables";
import { VecToAngles, vec3 } from "../vec";
import { CivilianHeadLook } from "./ops";
import { CIVILIAN_MOUTH_NONE, type CivilianState } from "./state";

/** The bone the hook's `case 2:` arm draws: the head. */
export const CIVILIAN_HEAD_BONE = 2;
/**
 * The bone the head look measures from: `ADD EAX, 0xb8` on
 * `g_skeleton_node_out` at `0x0048D4E5` and `0x0048D569`, record 1's `+0x28`.
 * Bone 2's parent in every character skeleton that has a bone 2
 * (`ExeTables.characterSkeleton`, types 0 to 0x55 but 0x1E, which has none).
 */
export const CIVILIAN_HEAD_LOOK_FRAME_BONE = 1;

/**
 * `CMP dword ptr [...+0xa8], 0x2` in the countdown's zero arm: the list that
 * hands over rather than parking, and the list it hands over to.
 */
export const CIVILIAN_MOUTH_HANDOFF_FROM = 2;
export const CIVILIAN_MOUTH_HANDOFF_TO = 3;

/**
 * `FADD float ptr [0x004C4398]` at `0x0048D2DD`: 15.0 on the camera eye's
 * `y`, the same rise class 0x30's head aim adds.
 */
const HEAD_LOOK_EYE_RISE = 15.0;
/**
 * `FSUB float ptr [0x004C4CB8]` at `0x0048D5D7`: 1.5 off the direction's
 * `y`, in bone 1's frame, before the angles are taken.
 */
const HEAD_LOOK_DROP = 1.5;
/**
 * `CMP AX, 0x1800` / `CMP AX, 0xe000` at `0x0048D618`/`0x0048D625`: the
 * pitch's range, `-0x2000..0x1800`, compared as s16.
 */
const HEAD_LOOK_PITCH_MAX = 0x1800;
const HEAD_LOOK_PITCH_MIN = -0x2000;
/** `CMP CX, 0x3800` / `CMP CX, 0xc800` at `0x0048D634`/`0x0048D642`. */
const HEAD_LOOK_YAW_MAX = 0x3800;
const HEAD_LOOK_YAW_MIN = -0x3800;
/** `PUSH 0x100` before all three `AngleApproachInPlace` calls. */
const HEAD_LOOK_RATE = 0x100;
/**
 * `TEST byte ptr [ECX + 0x34], 0x1` at `0x0048D328`: the captor's flags bit
 * 0, which `ActorDespawn` (`FUN_00409CC0`) clears (`AND AL, 0xFE`). Clear, the
 * head goes home. Every `Init` this port has read raises it; what else
 * lowers it is `[open]`.
 */
const HEAD_LOOK_CAPTOR_BIT = 0x1;

/**
 * `AngleApproachInPlace` — `FUN_0048D9B0`. Step `cur` toward `want` by at
 * most `rate`, the short way round, and return it.
 *
 * ```
 * d = (u16)(want - (u16)*angle)        ; MOV AX,[ESP+8]; SUB AX,[ECX]; AND EAX,0xFFFF
 * if (d == 0) return;
 * if (d > 0x8000) d -= 0x10000;
 * if (d > rate)       *angle += rate;
 * else if (d < -rate) *angle -= rate;
 * else                *angle += d;
 * ```
 *
 * `[proved]`. The difference is sixteen bits and the add is to the whole
 * dword, so the angle is unwrapped: it can leave `0..0xFFFF`, and a later
 * test against zero reads the int. Its three callers are all
 * {@link CivilianDrawBonePart}'s.
 */
export function AngleApproachInPlace(cur: number, want: number,
                                     rate: number): number {
  let d = (want - cur) & 0xffff;
  if (d === 0) return cur;
  if (d > 0x8000) d -= 0x10000;
  if (d > rate) return (cur + rate) | 0;
  if (d < -rate) return (cur - rate) | 0;
  return (cur + d) | 0;
}

/**
 * The 3x3 of a matrix in `g_MatrixStackTop`'s layout as `game/matrix.ts`'s
 * `Rot3`, which keeps it transposed. `[port-only]`: the engine hands
 * `MatrixGetAngles` the stack top.
 */
function RotationOf(m: ArrayLike<number>): Rot3 {
  return [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
}

const _head: Mat = MatIdentity();
const _frame: Mat = MatIdentity();
const _r: Mat = MatIdentity();
const _w2v: Mat = MatIdentity();
const _v2w: Mat = MatIdentity();
const _at = vec3();
const _to = vec3();
const _d = vec3();

/**
 * `CivilianDrawBonePart` — `FUN_0048D1F0`. The node draw hook.
 *
 * ```
 * case 2:
 *   if (sub+0x8C != 0) {
 *     Push; head = Translation(top) -> world               ; the record, as posed
 *     switch (sub+0x8C) {                                    ; the target, world
 *       1: t = (eye.x, eye.y + 15.0, eye.z)
 *       2: if (sub+0x1E && (sub+0x90)->+0x34 & 0x4000000) sub+0x90 = sub+0x60[0]
 *          if (!((sub+0x90)->+0x34 & 1)) sub+0x8C = 6
 *          else t = Translation((sub+0x90)->+0x354) -> world
 *       3: t = g_camera_lookat_target
 *       4: t = *(vec3 *)sub+0x90
 *       5: t = [carrier T Rx Rz Ry] T(obj+0x40) Rx(+64) Rz(+6C) Ry(+68) * *(vec3 *)sub+0x90
 *       default: t = the head's view-space translation
 *     }
 *     P = MatrixGetAngles(inverse(record1) * record2)        ; the pose, bone 1's frame
 *     if (sub+0x8C == 6) { want = (P.x, P.y) }
 *     else { d = rotation(bone 1)^-1 (t - head); want = VecToAngles(d.x, d.y - 1.5, d.z) }
 *     Pop
 *     want.x = clamp(want.x, -0x2000, 0x1800); want.y = clamp(want.y, -0x3800, 0x3800)
 *     AngleApproachInPlace(sub+0x94, want.x - P.x, 0x100)
 *     AngleApproachInPlace(sub+0x98, want.y - P.y, 0x100)
 *     AngleApproachInPlace(sub+0x9C, 0, 0x100)
 *     if (all three == 0) sub+0x8C = 0
 *     else { top = [record1's 3x3 | head]; RotY(sub+0x98 + P.y); RotX(sub+0x94 + P.x);
 *            RotZ(sub+0x9C + P.z); MatrixStore(record2 + 0x28) }
 *   }
 *   if (sub+0xA8 != 6) {
 *     cel = (s8)mouth_tables[sub+0xA8].cels[sub+0xA0 % mouth_tables[..].count];
 *     if (sub+0xA4 != 0) {
 *       if (--sub+0xA4 == 0) {
 *         if (sub+0xA8 == 2) { sub+0xA8 = 3; sub+0xA4 = count[3]; sub+0xA0 = 0; }
 *         else sub+0xA0 = count[sub+0xA8] - 1;
 *       } else sub+0xA0 += 1;
 *     }
 *   }
 *   [Original Mode: MatrixScale(1.5, 1.0, 1.5)]
 *   AssetDrawSlot(record + cel);        // or the scene-light twin
 * default:
 *   AssetDrawSlot(record);
 * ```
 *
 * `[proved]` from the listing, `0x0048D244..0x0048D7DA` for the turn.
 *
 * ## The turn
 *
 * The **target** is in the world in every arm the scripts reach. A captor's
 * is the matrix at its `obj+0x354`, which is `obj+0x20C + 2*0x90 + 0x28`: the
 * draw record array starts at `obj+0x20C` (`model+0x78`, the model block at
 * `obj+0x194`), records are `0x90` apart, and `+0x28` is the node matrix
 * `SkeletonEmitNode` stores -- **bone 2's**, the captor's head, in view
 * space, which the arm takes into the world under the camera block. The
 * captor is re-picked as the first child when it has died and another
 * remains, and when its flags word has lost bit 0 the head goes home. Op
 * `0x24`'s two point modes read three floats at `sub+0x90`; in mode 5 they
 * are in her own frame, under the carrier's when her update is still
 * `CivilianUpdateOnCarrier` (`CMP dword ptr [ECX], 0x48b140` at
 * `0x0048D41A`). A mode the switch has no cell for -- 6, or anything past
 * it -- keeps the head's own **view-space** position as the target, which
 * mode 6 never reads and no stream writes a 7 to use.
 *
 * The **angles** are bone 1's frame's. `MatrixGetAngles` of `record1^-1 *
 * record2` is bone 2's pose relative to bone 1 -- its parent in every
 * skeleton -- and the target's direction is taken into bone 1's rotation the
 * same way, with 1.5 off its height. So the head looks from where bone 1
 * holds it, and the limits are a neck's: up `0x1800`, down `0x2000`, either
 * side `0x3800`. Roll is never aimed: its offset only ever eases home.
 *
 * The **offsets** are what is eased, not the angles: `sub+0x94`/`0x98`/`0x9C`
 * step toward `want - pose`, so a head that has reached its target keeps
 * facing it while the clip moves the neck under it, and a clip that turns the
 * head toward the target already needs less offset. **Mode 6 is a return,
 * not a hold**: it wants the pose's own angles, so its offsets ease to zero,
 * and the frame all three are zero the mode drops to 0 and the record is left
 * as the clip posed it. The clamp is applied to mode 6's pose too, so a clip
 * that bends the head past a limit keeps an offset there and never drops.
 *
 * The **rebuild** keeps bone 1's 3x3 and the head's translation and turns by
 * pose plus offset in `MatrixGetAngles`' own order, so with zero offsets it
 * is the pose again. It is stored over the record, and the stack top it
 * leaves is what the mouth's draw, the hit centre and bone 2's children use.
 *
 * ## The seam
 *
 * **The records are the renderer's**, as everywhere else in this class --
 * `CivilianWriteSphereCentre` in `update.ts` says why and what would close
 * it. So the pose this reads is the one the renderer last drew, before its
 * own turn (`GameHost.bonePoseMatrix`), and bone 1 and the captor's head the
 * same frame's; the engine's are this frame's. Space is the world throughout,
 * which the engine reaches by the camera block's view-to-world and the port
 * starts in; the one view-space value, the target past the switch, is taken
 * back out through `GameHost.cameraMatrices`. `[port-only]` A host that cannot
 * give all three -- a headless run, a spawn the renderer has not adopted yet
 * -- has no pose for the arm to read, and the head look holds: nothing in
 * the game reads its words but this arm and the draw.
 *
 * The rebuild is the renderer's (`render/characters/civilian_head.ts`); this
 * raises {@link CivilianState.headLookTurned} for it.
 *
 * ## The mouth
 *
 * The cel is read **before** the step, so the frame op 0x25 lands on draws
 * the list's first cel. The zero arm reads the count through the row it has
 * just written, so list 2 runs list 3 for its own thirteen frames, and every
 * other list parks its cursor on its last cel and holds it until the next op
 * 0x25 -- a 0, the face's own slot, for every list but 3, whose last is 9.
 * `% count` is `IDIV`, but the cursor never goes negative: op 0x25 zeroes it
 * and only this steps it. The record's slot is left alone; the cel is what
 * this draw submits, and that goes to {@link Actor.nodeDrawSlot}.
 *
 * The hook runs once per frame the head is drawn -- `SkeletonEmitNode`'s
 * gate, `ActorRunNodeDrawHooks` -- so both the turn's and the mouth's clocks
 * stop while she is not drawn, and both count drawn frames.
 *
 * Not here: the Original Mode scales on bones 2, 5, 8, 12 and 15, which
 * `ActorDrawAttachedParts` has the twin of and which are not ported either,
 * and the choice of `SubmitSlotWithSceneLightArray` over `AssetDrawSlot`,
 * which is the renderer's.
 */
export function CivilianDrawBonePart(obj: Actor, bone: number, slot: number,
                                     f: ClassFrame): void {
  const sub = obj.civ;
  if (bone !== CIVILIAN_HEAD_BONE || !sub) {
    obj.nodeDrawSlot[bone] = slot;
    return;
  }
  const host = f.host;
  if (sub.headLook !== CivilianHeadLook.Off
      && host.bonePoseMatrix?.(obj.at, CIVILIAN_HEAD_BONE, _head)
      && host.boneMatrix?.(obj.at, CIVILIAN_HEAD_LOOK_FRAME_BONE, _frame)
      && host.cameraMatrices?.(_w2v, _v2w)) {
    MatrixGetTranslation(_head, _at);
    if (CivilianHeadLookTarget(obj, sub, f)) {
      // `MatrixStackSetTopFromArray(record1)`, `MatrixInvert(0)`,
      // `MatrixMultiply(record2)`, `MatrixGetAngles` at `0x0048D4E0..511`.
      MatCopy(_r, _frame);
      MatrixInvert(_r);
      MatrixMultiply(_r, _head);
      const pose = MatrixGetAngles(RotationOf(_r));
      let pitch: number, yaw: number;
      if (sub.headLook === CivilianHeadLook.Home) {
        pitch = pose.x;
        yaw = pose.y;
      } else {
        // Bone 1's rotation alone: `MatrixSetTranslation(0, 0, 0)` and
        // `MatrixInvert(0)` at `0x0048D592..599`, then the difference, each
        // axis `FSTP`'d to a float.
        MatCopy(_r, _frame);
        _r[12] = 0; _r[13] = 0; _r[14] = 0;
        MatrixInvert(_r);
        _d.x = Math.fround(_to.x - _at.x);
        _d.y = Math.fround(_to.y - _at.y);
        _d.z = Math.fround(_to.z - _at.z);
        MatrixTransformPoint(_r, _d, _d);
        const a = VecToAngles(Math.fround(_d.x),
                              Math.fround(Math.fround(_d.y) - HEAD_LOOK_DROP),
                              Math.fround(_d.z));
        // `VecToAngles` (`FUN_004016B0`) stores `(s16)ftol(yaw)` and
        // `-(s16)ftol(elevation)`: the negation is after the truncation.
        yaw = FtolS16(a.yaw);
        pitch = -FtolS16(-a.pitch);
      }
      // The clamps compare the low words (`CMP AX` / `CMP CX`) and keep the
      // whole dword when it is inside.
      const p16 = (pitch << 16) >> 16;
      if (p16 > HEAD_LOOK_PITCH_MAX) pitch = HEAD_LOOK_PITCH_MAX;
      else if (p16 < HEAD_LOOK_PITCH_MIN) pitch = HEAD_LOOK_PITCH_MIN;
      const y16 = (yaw << 16) >> 16;
      if (y16 > HEAD_LOOK_YAW_MAX) yaw = HEAD_LOOK_YAW_MAX;
      else if (y16 < HEAD_LOOK_YAW_MIN) yaw = HEAD_LOOK_YAW_MIN;
      sub.headLookPitch = AngleApproachInPlace(sub.headLookPitch,
                                               pitch - pose.x, HEAD_LOOK_RATE);
      sub.headLookYaw = AngleApproachInPlace(sub.headLookYaw,
                                             yaw - pose.y, HEAD_LOOK_RATE);
      // The roll's want is the pose's own (`local_64 = local_58` at
      // `0x0048D608`), so its offset only ever eases home.
      sub.headLookRoll = AngleApproachInPlace(sub.headLookRoll, 0,
                                              HEAD_LOOK_RATE);
      if (sub.headLookPitch === 0 && sub.headLookYaw === 0
          && sub.headLookRoll === 0) {
        sub.headLook = CivilianHeadLook.Off;
      } else {
        sub.headLookTurned = true;
      }
    }
  }
  let cel = 0;
  if (sub.mouthTable !== CIVILIAN_MOUTH_NONE) {
    const tables = T.chars?.civilian_mouth_tables ?? [];
    const row = tables[sub.mouthTable] ?? [];
    // [port-only] A bundle older than the tables, or a row the exe would
    // read out of whatever follows `0x0056B980`: the engine has a cel and a
    // count for every value op 0x25 stores, and the shipped operands are
    // 0, 1, 2 and 5. No row is no cel and no step.
    if (row.length) {
      cel = row[sub.mouthFrame % row.length] ?? 0;
      if (sub.mouthFrames !== 0) {
        sub.mouthFrames -= 1;
        if (sub.mouthFrames === 0) {
          if (sub.mouthTable === CIVILIAN_MOUTH_HANDOFF_FROM) {
            sub.mouthTable = CIVILIAN_MOUTH_HANDOFF_TO;
            sub.mouthFrames = tables[sub.mouthTable]?.length ?? 0;
            sub.mouthFrame = 0;
          } else {
            sub.mouthFrame = row.length - 1;
          }
        } else {
          sub.mouthFrame += 1;
        }
      }
    }
  }
  obj.nodeDrawSlot[bone] = slot + cel;
}

/**
 * The head look's switch, `0x0048D2C0..0x0048D4DC`: the target into `_to`,
 * from the head's world position in `_at`.
 *
 * [port-only] as a function -- the switch is inline in the hook -- and in its
 * answer: false is a target the renderer cannot place (a captor it has not
 * posed), for which the arm holds as it does with no pose of its own.
 */
function CivilianHeadLookTarget(obj: Actor, sub: CivilianState,
                                f: ClassFrame): boolean {
  switch (sub.headLook as CivilianHeadLook) {
    case CivilianHeadLook.CameraEye: {
      const e = G.g_camera_eye;
      _to.x = e.x;
      _to.y = Math.fround(e.y + HEAD_LOOK_EYE_RISE);
      _to.z = e.z;
      return true;
    }
    case CivilianHeadLook.Captor: {
      // [port-only] A child the pool no longer holds left by `ActorDespawn`,
      // which leaves bit 0 clear and does not raise the dead bit -- the word
      // the engine would read in the freed block. A captor that died is
      // re-picked on the first drawn frame after, while it is still in the
      // pool playing its death.
      let kid = ActorByAt(sub.headLookTarget);
      if (sub.childCount !== 0 && ((kid?.flags ?? 0) & ActorFlag.Dead) !== 0) {
        sub.headLookTarget = sub.children[0];
        kid = ActorByAt(sub.headLookTarget);
      }
      if (!kid || (kid.flags & HEAD_LOOK_CAPTOR_BIT) === 0) {
        sub.headLook = CivilianHeadLook.Home;
        return true;
      }
      return f.host.boneWorld(kid.at, CIVILIAN_HEAD_BONE, _to);
    }
    case CivilianHeadLook.CameraTarget: {
      const t = G.g_camera_lookat_target;
      _to.x = t.x; _to.y = t.y; _to.z = t.z;
      return true;
    }
    case CivilianHeadLook.Point:
      _to.x = sub.headLookPoint.x;
      _to.y = sub.headLookPoint.y;
      _to.z = sub.headLookPoint.z;
      return true;
    case CivilianHeadLook.LocalPoint: {
      // `MatrixLoadIdentity` at `0x0048D40F`, the carrier's four calls while
      // her update is `CivilianUpdateOnCarrier` -- which `CivilianInit`
      // installs exactly when it gives her a carrier -- then her own.
      // [port-only] A carrier the pool no longer holds composes nothing, as
      // `CivilianTargetPoint` (`class10/turn.ts`) treats one.
      const m = _r;
      MatrixLoadIdentity(m);
      const carrier = obj.carrierAt >= 0 ? ActorByAt(obj.carrierAt) : undefined;
      if (carrier) CarrierMatrixCompose(m, carrier);
      MatrixTranslate(m, obj.pos.x, obj.pos.y, obj.pos.z);
      MatrixRotateX(m, obj.pitch);
      MatrixRotateZ(m, obj.roll);
      MatrixRotateY(m, obj.yaw);
      MatrixTransformPoint(m, sub.headLookPoint, _to);
      _to.x = Math.fround(_to.x);
      _to.y = Math.fround(_to.y);
      _to.z = Math.fround(_to.z);
      return true;
    }
    default:
      // `JA 0x0048D4E0`: past the switch with `local_78` as the first
      // `MatrixGetTranslation` left it -- the head, in view space.
      MatrixTransformPoint(_w2v, _at, _to);
      return true;
  }
}
