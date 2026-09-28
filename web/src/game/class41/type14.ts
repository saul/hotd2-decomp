/**
 * Class 0x41 type 14 — a route-branch trigger that is also an enemy standing
 * still.
 *
 * One shipped spawn: stage 2 block 5 step 7 (evt `0x1DD8`), `+0x11C` 0, pitch
 * `0x4000`, yaw `0x1000`, `desc+0x24` 2. The step it is placed in is
 *
 * ```
 * spawn_placed (this); cam_play 91..220 on path 61; wait_camera_path_frame 122;
 * wait_queued_events_done; wait_enemies_alive 0; advance_step
 * ```
 *
 * and the block's route record is `{21, 6, -1}`. So the object **holds the
 * block**: its arm counts it into `g_enemies_alive`, and the step cannot
 * advance until the routine counts it back out — at frame `0xD1` if nobody
 * shoots it, or when it has fallen over if somebody does. The shot is what
 * writes `g_script_branch_var = 1 - obj+0x11C`, so unshot the block goes on to
 * `next[0]` = 21 and shot it goes to `next[1]` = 6, where the routine kills
 * itself (`g_evt_block_index == 6`). `[proved]` from the code and the script.
 *
 * What it is, `[open]`: `AssetDrawSlot(0x10D2)` at a scale of 0.4, lying at
 * pitch `0x4000`, lit by a light whose pitch turns `0x400` a frame for as
 * long as it is standing. The arm puts it at y = 36.0 whatever the spawn says
 * (the spawn says 36.25; the block's ground plane is 35.88).
 *
 * ## `PlaceGenericProp` case 0x0E — the arm at `0x00461F32`
 *
 * ```
 * 00461f32  MOV dword [ESI+0x1a0], 0x42100000   ; y = 36.0, the spawn's y is lost
 * 00461f3c  MOV AL, byte [EBP+0x1f4]            ; the placer's s8 at desc+0x24
 * 00461f42  MOV dword [ESI+0x124], 0x40000000   ; radius 2.0
 * 00461f4c  MOV CX, word [ESI+0x11c]
 * 00461f53  MOV byte [ESI+0x199], AL            ; ...which nothing here reads
 * 00461f59  INC word [0x009c904a]               ; g_enemies_alive++
 * 00461f63  MOV word [0x009c88a4], CX           ; g_script_branch_var = +0x11C
 * 00461f6b  RET
 * ```
 *
 * ## The routine, `0x00468180`..`0x00468635`
 *
 * Ghidra's pseudocode stops at the hit arm's `PlaySoundId` (no-return in the
 * database) and at the landing loop's `MatrixStackPop`; everything after them
 * — the rest of the hit arm, the shot-test registration, the light restore —
 * is from `disassemble_bytes` over the whole routine (`L35`, `L37`).
 *
 * ```c
 * if (++obj->+0x2A0 == 0xD1 && obj->+0x192 == 0) {      // 0x0046819B
 *     g_enemies_alive--;  obj->+0x34 |= 0x40000000;      // the timeout
 * }
 * if (g_evt_block_index == 6 || obj->+0x2A0 > 0x1C1) { ActorKill(); }
 * if ((obj->+0x34 & 8) && !(obj->+0x34 & 0x40000000)) {  // 0x004681DC
 *     BreakablePropAwardHit(obj->+0x34, 0);
 *     g_script_branch_var = 1 - (s16)obj->+0x11C;
 *     PlaySoundId(0x1116A9);
 *     obj->+0x34 |= 0x40000000;
 *     obj->+0x1C4 = 0.45;                                // 0x3EE66666
 *     obj->+0x2C0 = -0.02722;                            // 0xBCDEFC7A, its gravity
 *     obj->+0x192 = 1;
 *     obj->+0x1D8 = rand() % 0x81 + 0xC0;                // BAMS a frame
 *     SpawnPropHitEffectScaled(obj, !(obj->+0x34 & 2), 0.7);   // 0x3F333333
 * }
 * s = obj->+0x192;
 * if (s > 0) {
 *     if (s == 1) { vy = obj->+0x2C0 + obj->+0x1C4; obj->+0x1C4 = vy; y += vy; }
 *     obj->+0x1CC += obj->+0x1D8;
 * }
 * if (s == 1) {
 *     if (obj->+0x1C4 <= 0.0) {                          // 0x004C436C
 *         Push; LoadIdentity; RotY(+0x1D0); RotZ(+0x1D4); RotX(+0x1CC);
 *         for (i = -1, latch = &obj->+0x2A0; i < 3; i += 2, latch += 2) {
 *             out = M * (0, i * 0.96, 0);                // 0x00569094
 *             if (out.y + y < 36.0 && *latch == 0) {     // 0x0055CC58
 *                 obj->+0x192 = 2;
 *                 obj->+0x1D8 = obj->+0x1CC > 0x4000 ? -0x600 : 0x600;
 *                 obj->+0x1A8 = out.x + x;  obj->+0x1AC = 36.0;
 *                 obj->+0x290 = i;          obj->+0x1B0 = out.z + z;
 *                 *latch = 1;  obj->+0x2C0 = 0;  obj->+0x1C4 = 0;
 *             }
 *         }
 *         Pop;
 *     }
 * } else if (s == 2 && ((+0x1D8 > 0 && +0x1CC > 0x4000) || (+0x1D8 < 0 && +0x1CC < 0x4000))) {
 *     obj->+0x1CC = 0x4000; obj->+0x1D8 = 0; obj->+0x1AC = 36.0;
 *     obj->+0x192 = 3;  g_enemies_alive--;               // the other give-back
 * }
 * if (obj->+0x192 == 0) {                                // 0x0046843A
 *     obj->+0x1F4 += 0x400;
 *     BuildSceneLightDirection(obj->+0x1F4, 0, &world, &view);
 *     SetRenderLightDirection(&world);
 * }
 * if (obj->+0x192 <= 1) {                                // 0x00468477
 *     Push; Translate(x, y, z); RotY(+0x1D0); RotZ(+0x1D4); RotX(+0x1CC);
 *     Scale(0.4, 0.4, 0.4); NoOpStub(0.4); AssetDrawSlot(0x10D2); Pop;
 *     obj->+0x70 = view * (x, y, z); RegisterForShotTest(obj);   // 0x0046853C
 * } else {
 *     Push; Translate(+0x1A8, +0x1AC, +0x1B0); RotY(+0x1D0); RotZ(+0x1D4); RotX(+0x1CC);
 *     Translate(0, (s16)obj->+0x290 * -0.96, 0);         // 0x00569090
 *     (x, y, z) = MatrixGetTranslation();
 *     Scale(0.4, 0.4, 0.4); NoOpStub(0.4); AssetDrawSlot(0x10D2); Pop;
 * }
 * if (obj->+0x192 == 0) SetRenderLightDirection(&g_scene_light_dir_view);
 * ```
 *
 * No `PropExpireByStepLifetime`, no `AND` on `obj+0x34` anywhere: the hit bits
 * are never cleared, and the `0x40000000` latch is what stops a second hit
 * arm. `PoseHookNone` is not called here; `NoOpStub` (`0x0041EBB0`) is a bare
 * `RET` and is not transcribed.
 *
 * ## `g_enemies_alive` goes back exactly once, or not at all
 *
 * `[proved]` from the code: the frame-`0xD1` give-back needs state 0 and sets
 * the latch, which is the hit arm's gate, so after it the object can never
 * leave state 0; the state-3 give-back needs state 2, which only the landing
 * reaches, which only the hit reaches, which needs the latch clear — and a
 * shot object is not in state 0 at frame `0xD1`. State 3 has no way out. So
 * at most one of the two fires. **The path with none is `ActorKill` first**:
 * `g_evt_block_index == 6`, or frame `0x1C2`, before either — and in the
 * shipped script neither can happen, because block 5's own
 * `wait_enemies_alive 0` holds the route to block 6 until one of them has, and
 * a shot object is on its end some fifty frames after the shot, long before
 * frame `0x1C2` `[likely]`, from the constants: the rise lasts
 * `0.45 / 0.02722` frames and the swing at most `0x3200 / 0x600`.
 *
 * ## The landing only ever happens on the `+1` end
 *
 * `[proved]` The latch the loop tests for end `i` is the dword at
 * `obj+0x2A0 + 8k` — `EBP` is `&obj+0x2A0` from `0x00468195` and
 * `ADD EBP,8` steps it. For `i = -1` that is the **frame counter**, which the
 * head has incremented from zero before anything reads it, so it is never 0
 * here and the `-1` end never lands. For `i = +1` it is `obj+0x2A8`, zero
 * until the landing sets it. The port keeps both reads as the engine makes
 * them.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { SpawnPropHitEffectScaled } from "../effects/sprite";
import { G } from "../globals";
import {
  MatrixGetTranslation, MatrixLoadIdentity, MatrixRotateX, MatrixRotateY,
  MatrixRotateZ, MatrixScale, MatrixTransformPoint, MatrixTranslate,
} from "../matrix";
import { vec3 } from "../vec";
import { PROP_BRANCH_ANSWERED } from "./branch";
import { ActorKillProp, BreakablePropAwardHit } from "./prop";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush } from "./prop_draw";
import { BreakableFlag, type BreakableProp } from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";
import { PropWords } from "./words";

/** `obj+0x192` as `PropUpdateType14` switches on it. */
export enum Type14Phase {
  /** Untouched, lit by the turning light, registered for the shot test. */
  Standing = 0,
  /** Shot: rising and falling under `obj+0x2C0`, pitching by `obj+0x1D8`. */
  Tumbling = 1,
  /** Landed on an end: pivoting about it toward pitch `0x4000`. */
  Pivoting = 2,
  /** At pitch `0x4000`. Nothing leaves this state. */
  Rest = 3,
}

/**
 * `PropUpdateType14`'s words beyond the shared fields. `+0x2A0` is
 * {@link BreakableProp.storyItem} (the frame counter), `+0x2A8`
 * {@link BreakableProp.cueCursorB} (the `+1` end's landing latch), `+0x2C0`
 * {@link BreakableProp.shake} (its gravity), `+0x1A8/1AC/1B0`
 * {@link BreakableProp.restX}/`restY`/`restZ` (the pivot), `+0x1D8`
 * {@link BreakableProp.spin} and `+0x192` {@link BreakableProp.routinePhase}.
 */
export interface Type14Words {
  /** `obj+0x199` — the placer's `+0x1F4` byte, written by the arm and read by nothing in this routine. */
  o199: number;
  /** `obj+0x1F4` — the pitch of the light it is drawn under, `+0x400` a frame while standing. */
  o1F4: number;
  /** `obj+0x290` — the end it landed on, `-1` or `+1`, as the s16 the pivot translate multiplies. */
  o290: number;
}
const TYPE14_WORDS_ZERO: Type14Words = { o199: 0, o1F4: 0, o290: 0 };

/**
 * 36.0 — `MOV [ESI+0x1A0],0x42100000` in the arm (`0x00461F32`), the landing
 * test's `FCOMP [0x0055CC58]` (`0x00468398`) and both stores of `obj+0x1AC`
 * (`0x004682F0`, `0x004683E3`). One number in four places: the height it
 * stands at, the floor an end lands on, and the pivot's height.
 */
export const TYPE14_FLOOR_Y = 36.0;
/** `MOV [ESI+0x124],0x40000000` — the arm's shot radius. */
export const TYPE14_RADIUS = 2.0;
/** `CMP EAX,0xD1` — the frame an untouched one counts itself out of `g_enemies_alive`. */
export const TYPE14_TIMEOUT_FRAME = 0xd1;
/** `CMP [EBP],0x1C1; JG` — past this frame count the routine kills it. */
export const TYPE14_LAST_FRAME = 0x1c1;
/** `CMP word [g_evt_block_index],6` — the block it kills itself in. */
export const TYPE14_KILL_BLOCK = 6;
/** `PUSH 0x1116A9; CALL PlaySoundId` — the hit. */
export const SFX_TYPE14_HIT = 0x1116a9;
/** `MOV [ESI+0x1C4],0x3EE66666` — the pop the hit gives it. */
export const TYPE14_POP_VY = Math.fround(0.45);
/** `MOV [ESI+0x2C0],0xBCDEFC7A` — its gravity, added to `+0x1C4` a frame. */
export const TYPE14_GRAVITY = Math.fround(-0.02722);
/** `MOV ECX,0x81; IDIV ECX; ADD EDX,0xC0` — the tumble rate, BAMS a frame. */
export const TYPE14_SPIN_JITTER = 0x81;
export const TYPE14_SPIN_BASE = 0xc0;
/** `PUSH 0x3F333333` — `SpawnPropHitEffectScaled`'s scale. */
export const TYPE14_HIT_EFFECT_SCALE = Math.fround(0.7);
/** `FMUL [0x00569094]` — the two ends sit this far along its local Y. */
export const TYPE14_END = Math.fround(0.96);
/** `FMUL [0x00569090]` — the pivot translate, -0.96 times the landed end. */
export const TYPE14_END_BACK = Math.fround(-0.96);
/** The pitch it pivots to, and the swing's rate in BAMS a frame. */
export const TYPE14_UPRIGHT = 0x4000;
export const TYPE14_PIVOT_RATE = 0x600;
/** `PUSH 0x3ECCCCCD` x3 — `MatrixScale` before both draws. */
export const TYPE14_SCALE = Math.fround(0.4);
/** `PUSH 0x10D2; CALL AssetDrawSlot` — the one model. */
export const TYPE14_SLOT = 0x10d2;
/** `ADD EBP,0x400` — the light's pitch step while it stands. */
export const TYPE14_LIGHT_STEP = 0x400;

/**
 * `PlaceGenericProp` case 0x0E.
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x00461F32`
 * of `PlaceGenericProp`'s switch. Everything the arm writes, in its order.
 */
export function PlaceGenericPropType14(p: BreakableProp,
                                       pl: BreakablePlacement,
                                       rng: Rng): void {
  void rng;
  p.y = TYPE14_FLOOR_Y;
  p.hitRadius = TYPE14_RADIUS;
  // `MOV AL,[EBP+0x1F4]; MOV [ESI+0x199],AL` -- the low byte, signed.
  PropWords(p, TYPE14_WORDS_ZERO).o199 = ((pl.field_1f4 ?? 0) << 24) >> 24;
  G.g_enemies_alive += 1;
  // `MOV CX,[ESI+0x11C]` -- the word the prologue copied from the placer.
  G.g_script_branch_var = p.lifetime;
}

/**
 * `PropUpdateType14` — `FUN_00468180`. `g_class41_updates[14]`.
 */
export function PropUpdateType14(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  PropDrawBegin(p);
  const w = PropWords(p, TYPE14_WORDS_ZERO);

  p.storyItem += 1;
  if (p.storyItem === TYPE14_TIMEOUT_FRAME
      && p.routinePhase === Type14Phase.Standing) {
    G.g_enemies_alive -= 1;
    p.flags |= PROP_BRANCH_ANSWERED;
  }
  if (G.g_evt_block_index === TYPE14_KILL_BLOCK
      || p.storyItem > TYPE14_LAST_FRAME) {
    ActorKillProp(p);
    return;
  }

  if ((p.flags & BreakableFlag.Hit) !== 0
      && (p.flags & PROP_BRANCH_ANSWERED) === 0) {
    BreakablePropAwardHit(p.flags, false, rng);
    G.g_script_branch_var = ((1 - p.lifetime) << 16) >> 16;
    events?.emit("sound.play", { id: SFX_TYPE14_HIT });
    p.flags |= PROP_BRANCH_ANSWERED;
    p.vy = TYPE14_POP_VY;
    const r = rng.int(TYPE14_SPIN_JITTER);
    p.shake = TYPE14_GRAVITY;
    p.routinePhase = Type14Phase.Tumbling;
    p.spin = r + TYPE14_SPIN_BASE;
    // `TEST AL,2` on the flag word it has just stored: player 0's bit picks
    // player 0's crosshair. The port resolved the aim at shot time.
    if (p.hitAim) {
      SpawnPropHitEffectScaled(p.hitAim.x, p.hitAim.y, p.z,
                               TYPE14_HIT_EFFECT_SCALE);
    }
  }

  const s = p.routinePhase;
  if (s > Type14Phase.Standing) {
    if (s === Type14Phase.Tumbling) {
      // `FLD +0x2C0; FADD +0x1C4; FST +0x1C4; FADD +0x1A0; FSTP +0x1A0`: the
      // FST rounds the stored speed, and the unrounded sum goes on into y.
      const vy = p.shake + p.vy;
      p.vy = Math.fround(vy);
      p.y = Math.fround(vy + p.y);
    }
    p.pitch = (p.pitch + p.spin) | 0;
  }
  if (s === Type14Phase.Tumbling) {
    if (p.vy <= 0) Type14Land(p, w);
  } else if (s === Type14Phase.Pivoting) {
    if ((p.spin > 0 && p.pitch > TYPE14_UPRIGHT)
        || (p.spin < 0 && p.pitch < TYPE14_UPRIGHT)) {
      p.pitch = TYPE14_UPRIGHT;
      p.spin = 0;
      p.restY = TYPE14_FLOOR_Y;
      p.routinePhase = Type14Phase.Rest;
      G.g_enemies_alive -= 1;
    }
  }

  if (p.routinePhase === Type14Phase.Standing) {
    w.o1F4 = (w.o1F4 + TYPE14_LIGHT_STEP) | 0;
    // [diverges] `BuildSceneLightDirection(obj+0x1F4, 0, &world, &view)`
    // (`FUN_0040E0B0`) and `SetRenderLightDirection(&world)` (`FUN_004AA0E0`)
    // around the draw, then `SetRenderLightDirection(&g_scene_light_dir_view)`
    // after it: while it stands, the model is lit by a light pitched by this
    // word -- a turn every 64 frames -- and it is the *world* vector that is
    // handed over where the scene's own update hands the view one. A
    // `PropDrawCall` carries a slot, a matrix and a layer and no light, so the
    // angle is kept and the override is not drawn.
  }

  if (p.routinePhase <= Type14Phase.Tumbling) {
    const m = PropMatrixPush();
    MatrixTranslate(m, p.x, p.y, p.z);
    MatrixRotateY(m, p.yaw);
    MatrixRotateZ(m, p.roll);
    MatrixRotateX(m, p.pitch);
    MatrixScale(m, TYPE14_SCALE, TYPE14_SCALE, TYPE14_SCALE);
    PropDrawSlot(p, m, TYPE14_SLOT);
    // `obj+0x70 = view * (+0x19C, +0x1A0, +0x1A4)` at `0x00468521`, after the
    // pop: its own position, and only in states 0 and 1.
    PropRegisterForShotTest(p, p.x, p.y, p.z);
  } else {
    const m = PropMatrixPush();
    MatrixTranslate(m, p.restX, p.restY, p.restZ);
    MatrixRotateY(m, p.yaw);
    MatrixRotateZ(m, p.roll);
    MatrixRotateX(m, p.pitch);
    MatrixTranslate(m, 0, Math.fround(w.o290 * TYPE14_END_BACK), 0);
    // [diverges] `MatrixGetTranslation` (`FUN_004A8CC0`) reads the top of a
    // stack that starts on the camera's world-to-view, so the engine writes a
    // **view-space** point into `obj+0x19C..0x1A4` here; the port's stack
    // starts on the identity and writes the world point. Nothing reads those
    // three words again once the object is in state 2 -- the draw uses the
    // pivot and the shot test is skipped -- so no behaviour follows from it.
    const t = vec3();
    MatrixGetTranslation(m, t);
    p.x = Math.fround(t.x);
    p.y = Math.fround(t.y);
    p.z = Math.fround(t.z);
    MatrixScale(m, TYPE14_SCALE, TYPE14_SCALE, TYPE14_SCALE);
    PropDrawSlot(p, m, TYPE14_SLOT);
  }
}

/**
 * The landing test, `0x00468324`..`0x00468437`: both ends of the object's
 * local Y axis under its rotation alone, and the first whose world height is
 * below the floor while its latch is clear becomes the pivot.
 *
 * `[port-only]` as a function; the engine has the loop inline.
 */
function Type14Land(p: BreakableProp, w: Type14Words): void {
  const m = PropMatrixPush();
  MatrixLoadIdentity(m);
  MatrixRotateY(m, p.yaw);
  MatrixRotateZ(m, p.roll);
  MatrixRotateX(m, p.pitch);
  const out = vec3();
  for (let end = -1; end < 3; end += 2) {
    MatrixTransformPoint(m, vec3(0, Math.fround(end * TYPE14_END), 0), out);
    const ox = Math.fround(out.x);
    const oy = Math.fround(out.y);
    const oz = Math.fround(out.z);
    // `MOV ECX,[EBP]` -- the dword at `obj+0x2A0 + 8k`: the frame counter
    // for the -1 end, `obj+0x2A8` for the +1 end.
    const latch = end < 0 ? p.storyItem : p.cueCursorB;
    if (oy + p.y < TYPE14_FLOOR_Y && latch === 0) {
      p.routinePhase = Type14Phase.Pivoting;
      p.spin = p.pitch > TYPE14_UPRIGHT
        ? -TYPE14_PIVOT_RATE : TYPE14_PIVOT_RATE;
      p.restX = Math.fround(ox + p.x);
      p.restY = TYPE14_FLOOR_Y;
      w.o290 = end;
      p.restZ = Math.fround(oz + p.z);
      if (end < 0) p.storyItem = 1;
      else p.cueCursorB = 1;
      p.shake = 0;
      p.vy = 0;
    }
  }
}
