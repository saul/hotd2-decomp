/**
 * How a zombie closes the distance: the clips carry it.
 *
 * This was an open question for a long time, and the answer was in the data
 * all along.
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
 * an open question here for a long time. It does not go through `obj+0x4C` at
 * all: the draw walk reaches it as `ActorAdvanceMotion` ->
 * `DrawSkinnedModelAndShadow` -> `SkeletonDrawWalk` -> `SkeletonPoseRootFrame`,
 * and it writes the rotated delta straight onto `g_cur_actor`'s position. Its
 * gate is motion-block `+0x64` bit 1 — which is `obj+0x1F8`, and
 * `ActorBuildSkinnedModel` sets it to 3 unconditionally for **every skeletal
 * actor in the game**. So root motion is on from frame one for class 0x30 and
 * class 0x31 alike; there is no per-state or per-class switch, and nothing
 * carries an actor but its clips.
 *
 * **One class does operate that switch, and this note used to say none did.**
 * `CivilianRunScript` (`FUN_0048B9E0`) writes `model+0x64` bit 1 on every clip
 * *change*, from bit `0x00100000` of the wait word that opened the block — see
 * `CivilianWait.RootMotion` in `game/class10/ops.ts`. "Set once at build and
 * never touched" was true of the two classes that had been read and false of
 * the third: the port carried every civilian wherever her clip's root went —
 * in the 307 of 596 shipped blocks whose wait word does not ask for it just as
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
 * **And the same factor sizes the whole drawn model.** The draw half of
 * `SkeletonApplyRootMotion` pushes `MatrixScale(model+0x116C)` between the
 * actor's rotation and the pose translate (`MOV EAX,[EDX+0x116C]; PUSH EAX`
 * x3; `CALL MatrixScale` at `0x00410FEA`..`0x00410FF7`), and every bone the
 * walk then emits hangs from that matrix. So one number, at one place on the
 * stack, decides the size of the character, the pose offset (a character at
 * 0.9 offsets by 0.9 of what its clip authored), where every bone is -- the
 * attachments, the held items, the gore and the camera point ride the bones
 * -- and where every hit centre is, because `SkeletonEmitNode` puts the
 * centre through the same node matrix. The radius is the one part of a
 * sphere the matrix does not reach, and `SkeletonWalkNode` (`FUN_004107E0`)
 * scales it at build instead -- see `ActorBuildSkinnedModel` in
 * `game/spawn.ts`.
 *
 * `render/characters.ts` draws every skinned actor under `Actor.scale` in
 * that same place -- the root node carries `T R S` and the pose group below
 * it the pose translate -- so the three agree by construction: the size, the
 * offset and the bones. The people are what it shows on: character types 32
 * to 56 are all 0.9, and they are the people, whichever class runs them --
 * 0x10, 0x24, 0x25 or 0x45 in the shipped placements. The three `people.bin`
 * clips 596, 598 and 600, which pose their root rather than walk it, sit
 * 2.593 units off it and not 2.882 (`web/tools/checks/root_pose.ts`). The port
 * drew every one of them at 1.0 -- every skinned actor but the bat, which
 * was drawn at its own size as a special case of what is the general rule.
 *
 * Nothing else reads the field as a size. Its other readers
 * (`SkeletonDrawNodeSlot`, `ActorDrawAttachedParts`, `DrawCharacterPartSlot`,
 * `CivilianDrawHeldItems`'s model) pass it to `NoOpStub` (`FUN_0041EBB0`) and
 * nothing more: the size reaches their draws through the bone matrix alone.
 * `CivilianApplyMotionPose` multiplies it into a placement of its own, the
 * bone-1 hold at a clip change (`class10/pose.ts`).
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

/** `0x3f19999a`, stored at `0x00410478` for character type 30. */
const MODEL_SCALE_BAT = Math.fround(0.6);
/** `0x3f333333`, stored at `0x00410484` for character type 31. */
const MODEL_SCALE_BAT_WING = Math.fround(0.7);
/** `0x3f666666`, stored at `0x0041046C` for character types 32..56. */
const MODEL_SCALE_PEOPLE = Math.fround(0.9);

/**
 * The character's size, as `ActorBuildSkinnedModel` (`FUN_00410440`) sets it.
 *
 * `[port-only]` — one arm of that routine rather than the whole of it: the
 * engine writes `model+0x116C` inline while building the model, and
 * `ActorBuildSkinnedModel` in `game/spawn.ts` does the same with this; it is a
 * function of its own because `makeActor` and the player's body
 * (`game/player_body.ts`) need the same number without a build.
 *
 * Written to `model+0x116C` from the character type and nothing else, by a
 * jump table over types 30..56 with everything outside it at 1.0.
 * `[proved]` from the raw bytes at `0x00410451`: `MOVSX EAX,[ESI+0x60]`,
 * `ADD EAX,-0x1e`, `CMP EAX,0x1a`, `JA` to the 1.0 arm (`0x00410490`), then
 * the index byte table at `0x00410568` -- `00 01` and twenty-five `02`s --
 * into the jump table at `0x0041055C`, whose three arms store `0x3f19999a`
 * (`0x00410478`), `0x3f333333` (`0x00410484`) and `0x3f666666`
 * (`0x0041046C`). Those are floats, and so is this: `fround`, so that the 0.9
 * the renderer draws with and the root motion steps by is the engine's
 * 0.89999998, not a double the engine never had. `web/tools/checks/root_pose.ts`
 * holds the bytes.
 *
 * | types | scale | who |
 * |---|---|---|
 * | 30 | 0.6 | `zabat`, the bat (class 0x46) |
 * | 31 | 0.7 | `zabat_wing`, its wing |
 * | 32..56 | 0.9 | the people: every one of them, whichever class runs it |
 * | anything else | 1.0 | the zombies, the throwers, the bosses, the animals |
 *
 * It scales the drawn model *and* the root motion, which is the same statement
 * twice: a smaller character takes smaller steps.
 */
export function ActorModelScale(charType: number): number {
  if (charType === 30) return MODEL_SCALE_BAT;
  if (charType === 31) return MODEL_SCALE_BAT_WING;
  if (charType >= 32 && charType <= 56) return MODEL_SCALE_PEOPLE;
  return 1.0;
}


/**
 * `[port-only]` -- the authored frame track 0 reads at play cursor `c`, which
 * `SkeletonAdvancePlayCursor` (`FUN_004111A0`) stores at `model+0x18`:
 * `c / 2`, and on the one odd cursor that **is** the play length, the frame
 * after it (`piVar1[6] = iVar3 + 1`). Every other odd cursor keeps `c / 2`
 * here and blends it with the next -- see {@link TrackRootAtCursor}.
 */
export function TrackFrameAtCursor(c: number, play: number): number {
  const f = Math.trunc(c / 2);
  return (c % 2 !== 0 && c === play) ? f + 1 : f;
}

/**
 * `[port-only]` -- the root translation track 0 poses at play cursor `c`, the
 * triple `SkeletonPoseRootFrame` (`FUN_00410920`) hands
 * `SkeletonApplyRootMotion` (`FUN_00410C50`). The frame choice is
 * `SkeletonAdvancePlayCursor`'s (`FUN_004111A0`):
 *
 * ```
 * c = counter % (play + 1);  f = c / 2
 * if (c odd && c != play) {                 ; between two authored frames
 *   a = f;  b = f + 1
 *   if (a < 0) a = play / 2;  if (play / 2 < b) b = 0
 *   slot 1 = frame a;  slot 2 = frame b;  track+0x37 |= 0x20
 *   track+0x28 = counter - 1;  track+0x30 = 2
 * } else {
 *   if (c odd) f += 1                        ; the play length itself
 *   slot 0 = frame f
 * }
 * ```
 *
 * and `SkeletonPoseRootFrame` then lerps slot A to slot B by
 * `g_motion_fade_weight`, which `SkeletonResolveTrackFrames` (`FUN_00410BD0`)
 * computes as `(counter - track+0x28) / track+0x30` -- **one half** on an odd
 * cursor. So a clip authored at 30 Hz moves its root every 60 Hz frame, by
 * half a frame's travel on each, where a cursor rounded down to `c / 2`
 * moved it every other frame by a whole frame's. It is the same sampler
 * `game/skeleton.ts` runs for an actor carrying the engine's model block;
 * this is its root half for every actor that does not.
 */
export function TrackRootAtCursor(m: BakedMotion, play: number, c: number,
                                  out: Vec3): void {
  const at = (f: number, k: number): number =>
    m.root[Math.min(Math.max(f, 0), m.frames - 1) * 3 + k] ?? 0;
  const half = Math.trunc(play / 2);
  const f = Math.trunc(c / 2);
  if (c % 2 !== 0 && c !== play) {
    const fa = f < 0 ? half : f;
    const fb = half < f + 1 ? 0 : f + 1;
    out.x = at(fa, 0) + (at(fb, 0) - at(fa, 0)) * 0.5;
    out.y = at(fa, 1) + (at(fb, 1) - at(fa, 1)) * 0.5;
    out.z = at(fa, 2) + (at(fb, 2) - at(fa, 2)) * 0.5;
    return;
  }
  const g = TrackFrameAtCursor(c, play);
  out.x = at(g, 0); out.y = at(g, 1); out.z = at(g, 2);
}

/**
 * The step `SkeletonApplyRootMotion` (`FUN_00410C50`) takes the object by,
 * from play cursor `prev` to play cursor `next` of one clip, in the clip's own
 * space -- {@link ApplyRootMotion} turns it by the actor's three angles.
 *
 * `[port-only]` as a function. The engine keeps a **baseline**, the root it
 * last stepped from (`model+0x1160..0x1168`), and the frame it was at
 * (`model+0x10`); while the gate is up the baseline is always the previous
 * draw's root, so the port keeps the previous cursor instead
 * (`Actor.rootCursor`) and resamples it. `prev < 0` is a baseline just
 * re-seeded -- a clip set, a fade holding -- and steps nothing, which is
 * what `ActorSetMotion` (`FUN_00411930`, seeding from the new clip's frame 0)
 * and a fade (`track+0x37` bit 0 without 0x20: baseline = root, every frame)
 * both come to. `[proved]`
 *
 * **A wrap is damped, not stitched.** When the frame jumps by more than a
 * quarter of the play length -- `|model+0x10 - model+0x18| > play / 4` --
 * the baseline is first set to `root + (root - baseline) / play`, so the step
 * is `(baseline - root) / play`: one play-length's share of the jump,
 * backwards, where a stitched loop would have taken a whole clip's travel in
 * one frame.
 */
export function rootDelta(m: BakedMotion, play: number, prev: number,
                          next: number): Vec3 {
  if (m.frames <= 1 || prev < 0 || prev === next) return { x: 0, y: 0, z: 0 };
  TrackRootAtCursor(m, play, prev, _was);
  TrackRootAtCursor(m, play, next, _now);
  const jump = Math.abs(TrackFrameAtCursor(prev, play)
                        - TrackFrameAtCursor(next, play));
  if (play > 0 && jump > Math.trunc(play / 4)) {
    return { x: (_was.x - _now.x) / play, y: (_was.y - _now.y) / play,
             z: (_was.z - _now.z) / play };
  }
  return { x: _now.x - _was.x, y: _now.y - _was.y, z: _now.z - _was.z };
}
const _was: Vec3 = { x: 0, y: 0, z: 0 };
const _now: Vec3 = { x: 0, y: 0, z: 0 };

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
  // wherever her clip's root went, in the 307 of 596 shipped blocks whose wait
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
