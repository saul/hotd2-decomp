/**
 * How a zombie closes the distance: the clips carry it.
 *
 * This was `[open]` for a long time and the answer was in the data all along.
 * None of the five ported class-0x30 states writes `obj+0x4C`, and
 * `ZombieStateWalkDistance` *measures* how far the actor has travelled from a
 * remembered point — which only makes sense if something other than the state
 * is moving it. Measured on `char_adv02`'s own motion row:
 *
 * ```
 * walk      motion 270   31 frames   net  +0.023   in place
 * run       motion 264   16 frames   net -19.333   1.289 per frame, 77 u/s
 * back away motion 256   36 frames   net +15.000   0.429 per frame
 * ```
 *
 * So the approach genuinely does not move — it plays an in-place walk while it
 * waits for its turn in the queue — and the attack run closes fast. An earlier
 * revision of this port invented `CLOSING_SPEED = 6` units per second and
 * applied it to every state, which was both the wrong shape and thirteen times
 * too slow.
 *
 * **The mechanism is `SkeletonApplyRootMotion` (`FUN_00410C50`)**, and it was
 * `[open]` here for a long time. It does not go through `obj+0x4C` at all: the
 * draw walk reaches it as `ActorAdvanceMotion` -> `DrawSkinnedModelAndShadow`
 * -> `SkeletonDrawWalk` -> `SkeletonPoseRootFrame`, and it writes the rotated
 * delta straight onto `g_cur_actor`'s position. Its gate is motion-block
 * `+0x64` bit 1 — which is `obj+0x1F8`, and `ActorBuildSkinnedModel` sets it
 * to 3 unconditionally for **every skeletal actor in the game**. So root
 * motion is on from frame one for class 0x30 and class 0x31 alike; there is
 * no per-state or per-class switch, and nothing carries an actor but its
 * clips.
 *
 * **One class does operate that switch, and this note used to say none did.**
 * `CivilianRunScript` (`FUN_0048B9E0`) writes `model+0x64` bit 1 on every clip
 * *change*, from bit `0x00100000` of the wait word that opened the block — see
 * `CivilianWait.RootMotion` in `game/class10/ops.ts`. "Set once at build and
 * never touched" was true of the two classes that had been read and false of
 * the third: the port carried every civilian wherever her clip's root went —
 * in the 297 of 596 shipped blocks whose wait word does not ask for it just as
 * much as in the 289 that do. `[proved]`
 *
 * **The gate has a second arm, and it is a pose.** One `if` in
 * `SkeletonApplyRootMotion` decides both halves: with `model+0x64` bit 1 set
 * the frame-to-frame delta moves the object and the draw matrix gets
 * `MatrixTranslate(0, root.y, 0)`; with it **clear** nothing moves and the
 * draw matrix gets `MatrixTranslate(root.x, root.y, root.z)` — the whole
 * translation, as a pose offset in the actor's own rotated frame. A clip's
 * root translation therefore either moves the object or offsets the pose,
 * never both and never neither. `[proved]` from the bytes, because the
 * decompiler shows neither half of it (`L37`):
 *
 * ```asm
 * 00410d2f  TEST byte ptr [ECX + 0x64],0x2   ; the gate -- move the object?
 * 00410e5f  ...                              ; the SET arm does NOT return;
 * 00410e93  CALL dword ptr [ECX + 0x115c]    ;   it falls into the shared tail
 * 00411005  TEST byte ptr [ECX + 0x64],0x2   ; the same gate -- pose which part?
 * 00411009  JZ   0x00411020
 * 0041100b  PUSH 0 / PUSH [ESI+4] / PUSH 0   ; MatrixTranslate(0, y, 0)
 * 00411020  PUSH [ESI+8] / [ESI+4] / [ESI]   ; MatrixTranslate(x, y, z)
 * ```
 *
 * `render/characters/pose.ts` is the port's other arm, and it reads the same
 * {@link MotionFlag.RootMotion} bit inline — the engine's test is one `TEST`
 * and not a routine, and an engine *function* called from `render/` is a
 * layer violation (`render-drives-the-port`).
 *
 * Only two things in the shipped game ever clear the bit: `RescueTargetInit`
 * (`FUN_00451720`) once, at spawn, and `CivilianRunScript` (`FUN_0048B9E0`)
 * on every clip change, from its block's wait word. So the y-only arm is the
 * ordinary case, and the other one has to be looked for.
 *
 * **And the delta is scaled by the character's own size.**
 * `SkeletonApplyRootMotion` runs `MatrixScale(model+0x116C)` into the same
 * matrix it rotates the delta through, so a character drawn at 0.9 covers 0.9
 * of the ground its clip authored. `ActorBuildSkinnedModel` (`FUN_00410440`)
 * sets that field from the character type alone — see {@link ActorModelScale}.
 *
 * This port applied 1.0 to everything, and the note here called the field
 * "drawing only". The place it showed is stage 1's block-1 rescue: the
 * civilian (type 38, scale 0.9) flees at 0.6885 units an authored frame and
 * her captor (type 8, scale 1.0) walks at 0.800. Unscaled the gap closes at
 * 0.112 a frame; scaled, at 0.180. Both are small, and **the ratio between two
 * small numbers is not small** — 1.6x — so the grab landed 244 ticks after the
 * spawn instead of 158, long after its camera shot had cut away.
 *
 * **It scales the pose offset too, and the port scales neither that nor the
 * model.** `SkeletonApplyRootMotion`'s pose translate is pushed *after*
 * `MatrixScale(model+0x116C)`, so a character drawn at 0.9 offsets by 0.9 of
 * what its clip authored. `render/characters/pose.ts` applies the offset
 * unscaled -- deliberately, because nothing in this port scales a drawn
 * character at all: neither `hod2lib.characters` nor `render/characters.ts`
 * writes that field to a node, so every skinned actor is drawn at 1.0 --
 * except class 0x46's bat and wing, whose roots `render/characters/bat.ts`
 * scales whole (pose offset included, as the engine's stack does), because
 * `BatWingUpdate` seats the wing through the body's scaled node matrix.
 * Scaling the offset alone would be worse than leaving it, because the offset
 * would shrink while the model it offsets did not.
 *
 * The honest size of it, from `tools/verify_root_pose.py`: of the four actors
 * whose clip root reaches the pose at all, the three `people.bin` clips 596,
 * 598 and 600 belong to `scale 0.9` types, so the engine's offset is **2.594
 * units and the port's is 2.882**. The fourth is class 0x21 at character type
 * 7, scale 1.0, where the two agree exactly. Making it faithful means scaling
 * every skinned actor's drawn size, which is a change to how the whole game
 * looks and not to this arithmetic. [diverges]
 *
 * **The delta is turned by all three angles**, in the one order the gated
 * arm hard-codes, whatever the model's own draw order is:
 *
 * ```asm
 * 00410d3b  MatrixStackPush(0); MatrixLoadIdentity()
 * 00410d56  MatrixTranslate(obj+0x40, obj+0x44, obj+0x48)
 * 00410d64  MatrixRotateZ(obj+0x6C)          ; roll
 * 00410d73  MatrixRotateY(obj+0x68)          ; yaw
 * 00410d82  MatrixRotateX(obj+0x64)          ; pitch
 * 00410d9b  MatrixScale(model+0x116C) x3
 * 00410dde  MatrixTransformPoint(&delta, &out)
 * ```
 *
 * This used to turn by yaw alone, which is the same thing for every upright
 * actor, and it was written down as waiting "until something needs it,
 * because the clips those stances play carry no root translation". Something
 * did: stage 2 block 21's two `zstin` are *spawned* rolled onto a wall --
 * orient `(0, 0xC000, 0xC000)` -- and climb down it on motion 310, whose root
 * runs along its own -Z. Only the roll turns that into world -Y, so yaw alone
 * walked them 8.7 units out from the wall along +X instead, a hundred units
 * up in mid-air. See {@link ApplyRootMotion}.
 */
import type { BakedMotion } from "../bundle";
import { MotionFlag, type Actor } from "./actor";
import {
  MatIdentity, MatrixLoadIdentity, MatrixRotateX, MatrixRotateY,
  MatrixRotateZ, MatrixScale, MatrixTransformPoint, MatrixTranslate, type Mat,
} from "./matrix";
import type { Vec3 } from "./vec";

/**
 * The character's size, as `ActorBuildSkinnedModel` (`FUN_00410440`) sets it.
 *
 * `[port-only]` — one arm of that routine rather than the whole of it: the
 * engine writes `model+0x116C` inline while building the model, and this port
 * has no model-build function to write it from.
 *
 * Written to `model+0x116C` from the character type and nothing else, by a
 * jump table over types 30..56 with everything outside it at 1.0.
 * `[proved]` from the raw bytes at `0x00410451`: `MOVSX EAX,[ESI+0x60]`,
 * `ADD EAX,-0x1e`, `CMP EAX,0x1a`, `JA` to the 1.0 arm, then an index byte
 * table at `0x00410568` of `00 01 02 02 02 ...` selecting between
 * `0x3f19999a`, `0x3f333333` and `0x3f666666`.
 *
 * It scales the drawn model *and* the root motion, which is the same statement
 * twice: a smaller character takes smaller steps.
 */
export function ActorModelScale(charType: number): number {
  if (charType === 30) return 0.6;
  if (charType === 31) return 0.7;
  if (charType >= 32 && charType <= 56) return 0.9;
  return 1.0;
}

/**
 * The root translation of frame `f` of a clip, clamped into it: the first
 * three floats of the frame record `MotionFrameAddress` (`FUN_00412F50`) hands
 * back. `[port-only]` as a function -- the engine reads them through the
 * pointer it is given.
 */
function FrameRootInto(m: BakedMotion, f: number, out: Vec3): void {
  const i = Math.max(0, Math.min(m.frames - 1, f)) * 3;
  out.x = m.root[i] ?? 0;
  out.y = m.root[i + 1] ?? 0;
  out.z = m.root[i + 2] ?? 0;
}

/**
 * `[port-only]` as a function: what `SkeletonBuildAndPose` (`FUN_00410590`)
 * and `ActorSetMotion` (`FUN_00411930`) leave in the two fields the baseline
 * arithmetic reads -- `model+0x10 = 0`, and `model+0x1160..0x1168` = the root
 * of **frame 0** of `m`.
 *
 * The build stores it unconditionally (`0x00410704`..`0x00410719`, from the
 * clip already in `model+0x20`); `ActorSetMotion` only under the gate
 * (`TEST AL,2` at `0x00411966`), and leaves the old baseline where it is
 * otherwise -- so its caller tests {@link MotionFlag.RootMotion}, and the
 * build's callers do not. `[proved]`
 *
 * It is the seed and not a reset because the clip need not start at frame 0:
 * `OneHitTargetInit` and `Class22Init` write the counter after the build, and
 * class 0x25's op 2 after `ActorSetMotion`, so the first draw measures its
 * frame against frame 0's root -- a jump, or the damper's one step, as
 * {@link RootMotionStep} decides.
 */
export function ActorSeedRootBaseline(obj: { rootFrame: number;
                                             rootBase: Vec3 },
                                      m: BakedMotion | null | undefined):
    void {
  obj.rootFrame = 0;
  if (m && m.frames > 0) FrameRootInto(m, 0, obj.rootBase);
  else { obj.rootBase.x = 0; obj.rootBase.y = 0; obj.rootBase.z = 0; }
}

/** This draw's root, reused. */
const _root: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * The baseline half of `SkeletonApplyRootMotion` (`FUN_00410C50`),
 * `0x00410C50`..`0x00410D29`, and its store at `0x00410E5F`, for a body
 * that does not carry the model block. `[port-only]` as a function: the
 * gated arm it feeds is {@link ApplyRootMotion}, and class 0x14's whole
 * routine is in `game/skeleton.ts`.
 *
 * `base` is `model+0x1160..0x1168`, `prev` the channel's `model+0x10` and `f`
 * the authored frame this draw poses; `play` is `g_motion_play_length` of the
 * clip. Returns whether the gate is up, with the clip-space delta in `out`.
 * The caller then stores `f` as its `+0x10`, as the shared tail at
 * `0x00410E99` does whichever arm ran.
 *
 * ```
 * 00410c59  d = |model+0x10 - model+0x18|; L = g_motion_play_length[model+0x20]
 * 00410c82  if (d > L/4)                           ; CDQ/AND 3/SAR 2: truncated
 * 00410c8a    base = (root - base) / L + root      ; FSUB, FIDIV, FADD
 * 00410cf8  if (model+0x37 & 1 && !(model+0x37 & 0x20))
 * 00410d03    base = root                           ; the fade's reset
 * 00410d2f  if (model+0x64 & 2) {
 * 00410da8    delta = root - base                   ; -> ApplyRootMotion
 * 00410e64    base = root                           ; after the pop (L37)
 *           }
 * ```
 *
 * **The loop wrap is not free, and this used to say it was.** The damper does
 * not stop the wrap from moving the actor; it sets the baseline to
 * `root + (root - base) / L`, and the ordinary delta after it is then
 * `root - base'` = **`(base - root) / L`**: the old baseline is the root at
 * the last frame drawn, the new root is the clip's start, so that is the
 * clip's whole travel divided by its play length -- **one average step, in the
 * direction the clip walks**. A looping clip therefore carries its actor
 * `(root[last] - root[0]) * (1 + 1/L)` a pass. The port used to hand back
 * `(root[next] - root[0]) / frames` instead, which is **zero** on the usual
 * wrap onto frame 0, under a comment calling the reset's contribution "very
 * nearly nothing": every looping clip lost `1/L` of its travel a pass. On the
 * exported data that is 0.29 of the cat's 12.73 units a pass on clip `0x2FD`
 * (play length 44) and 0.67 of `char_adv02`'s 19.33 on its attack run `0x108`
 * (play length 29). `[proved]`
 *
 * The test is on **frames** and the baseline is a **position**, and the two
 * together are what let a class change the clip under the baseline: the
 * port's baseline was a frame index, so `CatMotionListUpdate` (`FUN_00431340`),
 * which writes `obj+0x1B4` and the counter outright, had the old clip's last
 * frame looked up in the new clip's table. The engine takes the old clip's
 * root from `+0x1160` and damps it the same way.
 *
 * `prev < 0` is the port's pending reset (see {@link Actor.rootFrame}), and
 * lands on the same arm as `fading`: the engine's test at `0x00410CF8` runs
 * after the damper and overrides it, so a reset draw takes no step whatever
 * the frames say.
 */
export function RootMotionStep(base: Vec3, prev: number, m: BakedMotion,
                               play: number, f: number, fading: boolean,
                               gate: boolean, out: Vec3): boolean {
  const r = _root;
  FrameRootInto(m, f, r);
  if (prev < 0 || fading) {
    base.x = r.x; base.y = r.y; base.z = r.z;
  } else if (play > 0 && Math.abs(prev - f) > Math.trunc(play / 4)) {
    // `[port-only]` `play > 0`: a clip the bundle does not carry has no
    // length, and every motion the engine plays is loaded. The x87 runs at
    // single precision under Direct3D, hence a `fround` per operation, as
    // `game/skeleton.ts` has it.
    base.x = Math.fround(Math.fround(Math.fround(r.x - base.x) / play) + r.x);
    base.y = Math.fround(Math.fround(Math.fround(r.y - base.y) / play) + r.y);
    base.z = Math.fround(Math.fround(Math.fround(r.z - base.z) / play) + r.z);
  }
  if (!gate) {
    out.x = 0; out.y = 0; out.z = 0;
    return false;
  }
  out.x = Math.fround(r.x - base.x);
  out.y = Math.fround(r.y - base.y);
  out.z = Math.fround(r.z - base.z);
  base.x = r.x; base.y = r.y; base.z = r.z;
  return true;
}

/** The gated arm's matrix, rebuilt from identity on every call. */
const _m: Mat = MatIdentity();
const _delta: Vec3 = { x: 0, y: 0, z: 0 };
const _out: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Apply a clip-space root delta to the actor: `SkeletonApplyRootMotion`'s
 * (`FUN_00410C50`) gated arm, `0x00410D39`..`0x00410E58`. The clips walk
 * along their local -Z, which is the actor's forward.
 *
 * The delta goes through `T(obj+0x40..0x48) · Rz(roll) · Ry(yaw) · Rx(pitch)
 * · S(model+0x116C)` -- all three angles, in that order for every actor; the
 * model's own order at `model+0x68` is for the draw's matrix and not this one
 * -- and the point that comes out is the actor's new position. `[proved]`
 *
 * `dy` is the root's **height** delta, and the transformed point's height is
 * written back only while {@link MotionFlag.RootMotionY} is up:
 * `TEST [model+0x64], 0x10` at `0x00410DB0` picks between an arm that stores
 * `out.x` and `out.z` (`0x00410DF0`, `0x00410DFD`) and one that stores all
 * three (`0x00410E3C`, `0x00410E48`, `0x00410E55`). Its one writer read so far
 * is `ThrowerStateDelayedPounce` (`FUN_0044E830`), for the wait clip -- and
 * that wait is a climb only because the actor is rolled onto a wall, where the
 * clip's forward is world down.
 */
export function ApplyRootMotion(obj: Actor, dx: number, dz: number,
                                dy = 0): void {
  // `if ((*(byte *)(model + 100) & 2) != 0)`, which is the whole of
  // `SkeletonApplyRootMotion`'s gate. `ActorBuildSkinnedModel` leaves it set
  // on every skeletal actor, so classes 0x30 and 0x31 are unaffected by the
  // test; **class 0x10's script turns it on and off per block** — see
  // `CivilianWait.RootMotion`. Without this the port carried every civilian
  // wherever her clip's root went, in the 297 of 596 shipped blocks whose wait
  // word does not ask for it just as much as in the 289 that do.
  if ((obj.motionFlags & MotionFlag.RootMotion) === 0) return;
  // [port-only] A zero delta transforms to the position itself, bit for bit
  // -- the rotations touch rows 0..2 and the translation is row 3 -- so this
  // skips building a matrix that would change nothing.
  if (dx === 0 && dy === 0 && dz === 0) return;
  const m = _m;
  MatrixLoadIdentity(m);
  MatrixTranslate(m, obj.pos.x, obj.pos.y, obj.pos.z);
  MatrixRotateZ(m, obj.roll);
  MatrixRotateY(m, obj.yaw);
  MatrixRotateX(m, obj.pitch);
  MatrixScale(m, obj.scale, obj.scale, obj.scale);
  _delta.x = dx; _delta.y = dy; _delta.z = dz;
  MatrixTransformPoint(m, _delta, _out);
  const nx = _out.x;
  const nz = _out.z;
  if (obj.motionFlags & MotionFlag.RootMotionY) obj.pos.y = _out.y;

  // The bite's floor -- see `Actor.strikeFloor`. Zero means no floor.
  if (obj.strikeFloor > 0) {
    const tx = nx - obj.target.x;
    const tz = nz - obj.target.z;
    const d = Math.hypot(tx, tz);
    if (d < obj.strikeFloor) {
      if (d < 1e-4) return;
      const k = obj.strikeFloor / d;
      obj.pos.x = obj.target.x + tx * k;
      obj.pos.z = obj.target.z + tz * k;
      return;
    }
  }
  obj.pos.x = nx;
  obj.pos.z = nz;
}
