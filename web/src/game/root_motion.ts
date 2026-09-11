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
 * [diverges] The engine rotates the delta by the full `Rz · Ry · Rx`; this
 * rotates by yaw alone. That is exact for anything standing upright and wrong
 * for a class-0x31 actor on a wall or a ceiling, whose pitch and roll are not
 * zero — which is `[open]` until something needs it, because the clips those
 * stances play carry no root translation.
 */
import type { BakedMotion } from "../bundle";
import { MotionFlag, type Actor } from "./actor";

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
 * The root translation between two frames of a clip, wrapping across the loop.
 *
 * `prev` is the frame the delta was last taken at, `-1` on the first call.
 * Returns the delta in the clip's own space, which the caller rotates by the
 * actor's yaw.
 *
 * **The engine's baseline is a field, not a remembered frame index**, and the
 * difference is worth stating because it is what this port nearly got wrong.
 * `model+0x1160..0x1168` holds the root translation the last delta was taken
 * at, and `ActorSetMotion` (`FUN_00411930`) seeds it from the **new clip's
 * frame 0** whenever the gate is set (`TEST AL,2` at `0x00411966`), while
 * `ActorSetMotionBlended` (`FUN_004119A0`) leaves `track+0x37` in the state
 * that makes `SkeletonApplyRootMotion` reset it to the current root outright.
 * So neither a cut nor a fade ever turns a clip's **absolute** root into a
 * step, and `prev < 0` here — no delta on the first call — is that same
 * statement. `[proved]`
 */
export function rootDelta(m: BakedMotion, prev: number, next: number):
    { x: number; z: number } {
  const n = m.frames;
  if (n <= 1 || prev < 0 || prev === next) return { x: 0, z: 0 };
  const at = (f: number): [number, number] =>
    [m.root[f * 3] ?? 0, m.root[f * 3 + 2] ?? 0];
  const [px, pz] = at(Math.min(prev, n - 1));
  const [nx, nz] = at(Math.min(next, n - 1));
  if (next > prev) return { x: nx - px, z: nz - pz };
  // **The loop wrap is damped, not stitched.** `SkeletonApplyRootMotion` tests
  // `|frame - previous| > play_length / 4` and, when it trips, resets the
  // baseline to `root + (root - baseline) / play_length` instead of taking the
  // delta — so the wrap frame contributes very nearly nothing and a looping
  // walk does not lurch once a cycle. Summing "finish the cycle, then start
  // the next" as this used to gives the wrap frame a whole clip's worth of
  // translation in one tick.
  const [sx, sz] = at(0);
  return { x: (nx - sx) / n, z: (nz - sz) / n };
}

/**
 * Apply a clip-space root delta to the actor, rotated into world space by its
 * own yaw. The clips walk along their local -Z, which is the actor's forward.
 */
export function ApplyRootMotion(obj: Actor, dx: number, dz: number): void {
  // `if ((*(byte *)(model + 100) & 2) != 0)`, which is the whole of
  // `SkeletonApplyRootMotion`'s gate. `ActorBuildSkinnedModel` leaves it set
  // on every skeletal actor, so classes 0x30 and 0x31 are unaffected by the
  // test; **class 0x10's script turns it on and off per block** — see
  // `CivilianWait.RootMotion`. Without this the port carried every civilian
  // wherever her clip's root went, in the 297 of 596 shipped blocks whose wait
  // word does not ask for it just as much as in the 289 that do.
  if ((obj.motionFlags & MotionFlag.RootMotion) === 0) return;
  if (dx === 0 && dz === 0) return;
  // `MatrixScale(model+0x116C)`, in the same matrix as the rotation.
  dx *= obj.scale;
  dz *= obj.scale;
  const a = obj.yaw * ((Math.PI * 2) / 65536);
  const s = Math.sin(a);
  const c = Math.cos(a);
  const nx = obj.pos.x + dx * c + dz * s;
  const nz = obj.pos.z + dz * c - dx * s;

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
