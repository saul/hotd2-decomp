/**
 * Class 0x41 type 19 — a route-branch trigger that holds its step until it
 * is shot or has knocked four times.
 *
 * One shipped spawn: stage 2 block 7 step 2 (evt `0x3178`), at
 * `(-568.54, 33.70, -1299.30)`, `+0x11C` 0, yaw `0x4000`. The step is
 *
 * ```
 * spawn_placed (this); cam_play 136..250 on path 64; wait_queued_events_done;
 * wait_enemies_present 0; advance_step
 * ```
 *
 * and the block's route record is `{8, 25, -1}`. The arm counts the object
 * into `g_enemies_present`, so the step waits for it: a shot counts it out at
 * once and writes `g_script_branch_var = 1 - obj+0x11C` (route 25); four
 * knocks unshot count it out about 192 frames after it was placed (route 8).
 * Block 25's step 1 then raises `g_script_flags[0x21]`, which swings the body
 * open on hinge curve 0 for sixty frames, and the step after that is the
 * third step change, which despawns it. `[proved]` from the code and the
 * script.
 *
 * What it is, `[open]`: two models — `AssetDrawSlot(0x1CE)`, the body, which
 * knocks on a sine and later swings on `g_pHingeCurvesXYZ[0]`, and
 * `(s16)obj+0x28C` = `0x10D3` hung from it, which drops away once shot. The
 * knock is `COMMON\DAMAGE3_22.WAV`, the sound `PropUpdateType35` knocks with.
 *
 * ## `PlaceGenericProp` case 0x13 — the arm at `0x00461FA3`
 *
 * ```
 * 00461fa3  obj+0x40/+0x44/+0x48 = placer+0x40/+0x44/+0x48   ; its position, again
 * 00461fad  MOV DX,[ESI+0x11c] ; MOV [0x009c88a4],DX         ; g_script_branch_var
 * 00461fc4  MOV [ESI+0x124],0x3fc00000                       ; radius 1.5
 * 00461fce  MOV word [ESI+0x28c],0x10d3                      ; the hung part
 * 00461fd7  INC word [0x009c7006]                            ; g_enemies_present++
 * ```
 *
 * ## The routine, `0x00468F00`..`0x00469371`
 *
 * The pseudocode stops at the first `PlaySoundId` (no-return in the
 * database), which hides the rest of the hit arm — the latch, the hit effect
 * and the give-back — and everything after the shot of the knock; the three
 * draws and the registration are after the first `MatrixStackPop`. All of it
 * is from `disassemble_bytes` (`L35`, `L37`).
 *
 * ```c
 * if ((s16)g_evt_step_index != (s8)obj->+0x196) {       // inline, no sweep
 *     if (++obj->+0x197 > 2) { ActorDespawn(obj); return; }
 *     obj->+0x192 = 2;  obj->+0x196 = g_evt_step_index;
 * }
 * if (obj->+0x2AC++ == 0x14) PlaySoundId(0x2000001F);
 * if ((obj->+0x34 & 8) && !(obj->+0x34 & 0x40000000) && obj->+0x192 < 2) {
 *     BreakablePropAwardHit(obj->+0x34, 0);
 *     g_script_branch_var = 1 - (s16)obj->+0x11C;
 *     PlaySoundId(0xF16A9);
 *     obj->+0x34 |= 0x40000000;
 *     SpawnPropHitEffectScaled(obj, !(obj->+0x34 & 2), 0.75);   // 0x3F400000
 *     g_enemies_present--;                               // 0x00468FD2
 * }
 * if (obj->+0x34 & 0x40000000) { vy = obj->+0x1C4 - 0.02722; obj->+0x1C4 = vy; obj->+0x1AC += vy; }
 * if (g_script_flags[0x21] == 1 && obj->+0x2B0 == 0) {
 *     obj->+0x192 = 3;  obj->+0x2B0 = 1;  PlaySoundId(0x2116A9);  PoseHookNone(3, 0x14);
 * }
 * switch (obj->+0x192) {
 * case 0: if (++obj->+0x2A0 == 0x1E || obj->+0x2A0 == 0x46) {
 *             obj->+0x192 = 1;  if (obj->+0x2A0 == 0x46) obj->+0x2A0 = 0;
 *             PlaySoundId(0x1C16A9);  PoseHookNone(1, 0x14);
 *         } break;
 * case 1: h = obj->+0x1E8 += obj->+0x1E8 < 0x4000 ? 0x1000 : 0x800;
 *         obj->+0x68  = ftol(sin(h * 2pi/65536) * 1536.0);            // 0x005690B0
 *         obj->+0x1E4 = ftol(sin((h - 0x2000) * 2pi/65536) * -4096.0); // 0x005690A8
 *         if (h > 0x8000) {
 *             obj->+0x1E8 = 0;  obj->+0x68 = 0;  obj->+0x192 = 0;
 *             if (++obj->+0x2A4 > 3) {
 *                 if (g_enemies_present > 0) g_enemies_present--;       // 0x0046913D
 *                 obj->+0x192 = 2;  PlaySoundId(0x20000015);
 *                 g_civilians_seen_total++;                             // 0x00469161
 *             }
 *         } break;
 * case 3: if (obj->+0x2A8 < 0x3C) {
 *             k = g_pHingeCurvesXYZ[0][obj->+0x2A8++];
 *             obj->+0x6C = k.rz + obj->+0x1D4;  obj->+0x64 = k.rx + obj->+0x1CC;
 *             obj->+0x68 = k.ry;
 *         }
 * }
 * Push; Translate(+0x40); RotY(0xC000); RotZ(+0x6C); RotY(+0x68); RotX(+0x64);
 * AssetDrawSlot(0x1CE); Pop;
 * Push; LoadIdentity; RotY(0xC000); RotZ(+0x6C); RotY(+0x68); RotX(+0x64); RotX(+0x1E4);
 * Translate(0, -2, 0); pt = M * (-9, 11, 0.5); Pop;               // 0x00469265
 * Push; Translate(+0x40); RotY(0xC000); RotZ(+0x6C); RotY(+0x68); RotX(+0x64);
 * Translate(-9, obj->+0x1AC + 11.0, 0.5); RotX(+0x1E4); Translate(0, -2, 0);
 * AssetDrawSlot((s16)obj->+0x28C); Pop;
 * (x, y, z) = pt + obj->+0x40;  obj->+0x70 = view * (x, y, z);  RegisterForShotTest(obj);
 * ```
 *
 * The descriptor's yaw (`obj+0x1D0`) is never read: the body faces the literal
 * `RotY(0xC000)` and turns on `obj+0x68`. The registration is every frame, in
 * every state; the latch alone is what makes the second shot do nothing. No
 * `AND` on `obj+0x34`, so the hit bits are never cleared. `PoseHookNone`
 * (`FUN_00420810`) is a bare `RET` and is not transcribed.
 *
 * **The shot point is not on the hung part.** It is `(-9, 11, 0.5)` pushed
 * down by `(0, -2, 0)` *inside* the part's swing `RotX(obj+0x1E4)` — the part
 * itself hangs *below* its pivot — and it ignores `obj+0x1AC`, so it stays up
 * where the part was after the part has dropped. That is the exe's own
 * inconsistency, transcribed as it is.
 *
 * ## `g_enemies_present`: once on the shipped path, twice or never off it
 *
 * `[proved]` from the code. Two give-backs: the hit's, unconditional and
 * behind the `0x40000000` latch, so at most once; and the fourth knock's,
 * behind `g_enemies_present > 0`, at most once because it leaves state 2,
 * which no arm leaves back to 0 or 1. They are **independent**: a shot object
 * keeps knocking (the hit arm does not touch `obj+0x192`), so an object shot
 * before its fourth knock and still in the step when that knock ends gives
 * back twice — the second only if some other enemy is present to take it
 * from. And one that sees a step change (state 2) or flag 0x21 (state 3)
 * before either gives back nothing, for the rest of the scene
 * (`ResetSceneOnEnter` is the only other writer that lowers it). In the
 * shipped script the step's own `wait_enemies_present 0` holds it until the
 * first give-back, and flag 0x21 is raised only in block 25, after the step
 * change `[proved]`; with nothing else present, the wait passes on the frame
 * the count reaches 0, the step change that follows retires the object before
 * its next knock can end, and a knock that ends on the hit's own frame finds
 * the count already 0 and leaves it `[likely]` — so exactly once.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { BAMS_TO_RAD_F64 } from "../../core/bams";
import { SpawnPropHitEffectScaled } from "../effects/sprite";
import { G } from "../globals";
import {
  MatrixLoadIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ,
  MatrixTransformPoint, MatrixTranslate,
} from "../matrix";
import { vec3 } from "../vec";
import { PROP_BRANCH_ANSWERED } from "./branch";
import { ActorDespawnProp, BreakablePropAwardHit } from "./prop";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush } from "./prop_draw";
import { BreakableFlag, type BreakableProp } from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";
import { HingeCurveXYZFrame } from "./type56";
import { PropWords } from "./words";

/** `obj+0x192` as `PropUpdateType19` switches on it. */
export enum Type19Phase {
  /** Counting frames to the next knock in `obj+0x2A0`. */
  Idle = 0,
  /** One knock: `obj+0x1E8` sweeps to past `0x8000`. */
  Knock = 1,
  /** Retired: four knocks done, or a step change seen. No hit, no knock. */
  Retired = 2,
  /** Flag 0x21: the body swings on hinge curve 0 for sixty frames. */
  Opening = 3,
}

/**
 * `PropUpdateType19`'s words beyond the shared fields. The rest:
 * `+0x40/44/48` {@link BreakableProp.hitPos} (where both models hang from),
 * `+0x1AC` {@link BreakableProp.restY} (the part's drop), `+0x1C4`
 * {@link BreakableProp.vy}, `+0x1E4` {@link BreakableProp.restPitch} (the
 * part's swing), `+0x1E8` {@link BreakableProp.hingeB} (the knock's phase),
 * `+0x2A0` {@link BreakableProp.storyItem} (frames to the knock), `+0x2A4`
 * {@link BreakableProp.removeFlag} (knocks done), `+0x2A8`
 * {@link BreakableProp.cueCursorB} (the hinge frame) and `+0x192`
 * {@link BreakableProp.routinePhase}.
 */
export interface Type19Words {
  /** `obj+0x64` — the body's X turn: curve `rx` plus `obj+0x1CC` while opening. */
  o64: number;
  /** `obj+0x68` — the body's second Y turn: the knock's sine, or curve `ry`. */
  o68: number;
  /** `obj+0x6C` — the body's Z turn: curve `rz` plus `obj+0x1D4` while opening. */
  o6C: number;
  /** `obj+0x2AC` — frames since placement, for its one line at frame `0x14`. */
  o2AC: number;
  /** `obj+0x2B0` — flag 0x21 has been answered. */
  o2B0: number;
}
const TYPE19_WORDS_ZERO: Type19Words = {
  o64: 0, o68: 0, o6C: 0, o2AC: 0, o2B0: 0,
};

/** `MOV [ESI+0x124],0x3FC00000` — the arm's shot radius. */
export const TYPE19_RADIUS = 1.5;
/** `MOV word [ESI+0x28C],0x10D3` — the arm's hung part, drawn as `(s16)obj+0x28C`. */
export const TYPE19_PART_SLOT = 0x10d3;
/** `PUSH 0x1CE; CALL AssetDrawSlot` — the body. */
export const TYPE19_BODY_SLOT = 0x1ce;
/** `CMP AL,2; JLE` — it despawns on its third step change. */
export const TYPE19_STEP_LIMIT = 2;
/** `CMP EAX,0x14` on the pre-increment `obj+0x2AC` — its line's frame. */
export const TYPE19_LINE_FRAME = 0x14;
/** `PUSH 0x2000001F; CALL PlaySoundId`. */
export const SFX_TYPE19_LINE = 0x2000001f;
/** `PUSH 0xF16A9; CALL PlaySoundId` — the hit. */
export const SFX_TYPE19_HIT = 0xf16a9;
/** `PUSH 0x3F400000` — `SpawnPropHitEffectScaled`'s scale. */
export const TYPE19_HIT_EFFECT_SCALE = 0.75;
/** `FSUB [0x0055CB10]` — the part's gravity once shot. */
export const TYPE19_GRAVITY = Math.fround(0.02722);
/** `g_script_flags[0x21]` (`0x009C7221`) — swing the body open. */
export const SCRIPT_FLAG_TYPE19_OPEN = 0x21;
/** `PUSH 0x2116A9; CALL PlaySoundId` — the swing. */
export const SFX_TYPE19_OPEN = 0x2116a9;
/** The two frame counts that start a knock; the second resets the count. */
export const TYPE19_KNOCK_FIRST = 0x1e;
export const TYPE19_KNOCK_SECOND = 0x46;
/** `PUSH 0x1C16A9` — `COMMON\DAMAGE3_22.WAV`, the knock. */
export const SFX_TYPE19_KNOCK = 0x1c16a9;
/** The knock's phase steps, BAMS: fast to the top, half speed after. */
export const TYPE19_STEP_OUT = 0x1000;
export const TYPE19_STEP_BACK = 0x800;
export const TYPE19_STEP_TURN = 0x4000;
export const TYPE19_KNOCK_END = 0x8000;
/** `FMUL double [0x005690B0]` — the body's knock, BAMS. */
export const TYPE19_KNOCK_YAW = 1536.0;
/** `FMUL double [0x005690A8]` — the part's swing, BAMS, a quarter turn behind. */
export const TYPE19_KNOCK_PART = -4096.0;
export const TYPE19_KNOCK_PART_LAG = 0x2000;
/** `CMP EAX,3; JLE` — the fourth knock retires it. */
export const TYPE19_KNOCKS = 3;
/** `PUSH 0x20000015; CALL PlaySoundId` — after the fourth knock. */
export const SFX_TYPE19_GIVE_UP = 0x20000015;
/** `g_pHingeCurvesXYZ[0]` — `MOV EDX,[0x005960B4]`, the table's first entry. */
export const TYPE19_HINGE_CURVE = 0;
/** `CMP ECX,0x3C; JGE` — sixty frames of it. */
export const TYPE19_HINGE_FRAMES = 0x3c;
/** `PUSH 0xC000; CALL MatrixRotateY` — the body's facing, a literal. */
export const TYPE19_FACING = 0xc000;
/**
 * The hung part's pivot, `(-9.0, 11.0, 0.5)`: `PUSH 0xC1100000`, `FADD double
 * [0x005690A0]` (the draw) or `MOV [ESP+0x28],0x41300000` (the shot point),
 * and `PUSH 0x3F000000`.
 */
export const TYPE19_PIVOT_X = -9.0;
export const TYPE19_PIVOT_Y = 11.0;
export const TYPE19_PIVOT_Z = 0.5;
/** `PUSH 0xC0000000` — the part hangs this far below its pivot. */
export const TYPE19_HANG = -2.0;

/**
 * `PlaceGenericProp` case 0x13.
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x00461FA3`
 * of `PlaceGenericProp`'s switch. Everything the arm writes, in its order.
 */
export function PlaceGenericPropType19(p: BreakableProp,
                                       pl: BreakablePlacement,
                                       rng: Rng): void {
  void rng;
  p.hitPos = { x: pl.pos?.[0] ?? 0, y: pl.pos?.[1] ?? 0, z: pl.pos?.[2] ?? 0 };
  G.g_script_branch_var = p.lifetime;
  p.hitRadius = TYPE19_RADIUS;
  p.slot = TYPE19_PART_SLOT;
  G.g_enemies_present += 1;
  // [port-only] `obj+0x2A4` is the knock count, and `ActorClearGameFields`
  // (`FUN_004A73D0`) left it 0; the port's constructor leaves the struct's
  // -1 there for a generic prop.
  p.removeFlag = 0;
}

/**
 * `PropUpdateType19` — `FUN_00468F00`. `g_class41_updates[19]`.
 */
export function PropUpdateType19(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  PropDrawBegin(p);
  const w = PropWords(p, TYPE19_WORDS_ZERO);

  // Its own step lifetime: a literal 2 and not `obj+0x11C`, no scene-1
  // sweep, and every step change it survives retires it.
  if (G.g_evt_step_index !== p.lastStepIndex) {
    p.stepsElapsed += 1;
    if (p.stepsElapsed > TYPE19_STEP_LIMIT) {
      ActorDespawnProp(p);
      return;
    }
    p.routinePhase = Type19Phase.Retired;
    p.lastStepIndex = G.g_evt_step_index;
  }

  const said = w.o2AC;
  w.o2AC = said + 1;
  if (said === TYPE19_LINE_FRAME) {
    events?.emit("sound.play", { id: SFX_TYPE19_LINE });
  }

  if ((p.flags & BreakableFlag.Hit) !== 0
      && (p.flags & PROP_BRANCH_ANSWERED) === 0
      && p.routinePhase < Type19Phase.Retired) {
    BreakablePropAwardHit(p.flags, false, rng);
    G.g_script_branch_var = ((1 - p.lifetime) << 16) >> 16;
    events?.emit("sound.play", { id: SFX_TYPE19_HIT });
    p.flags |= PROP_BRANCH_ANSWERED;
    if (p.hitAim) {
      SpawnPropHitEffectScaled(p.hitAim.x, p.hitAim.y, p.z,
                               TYPE19_HIT_EFFECT_SCALE);
    }
    G.g_enemies_present -= 1;
  }

  if ((p.flags & PROP_BRANCH_ANSWERED) !== 0) {
    // `FLD +0x1C4; FSUB [0x0055CB10]; FST +0x1C4; FADD +0x1AC; FSTP +0x1AC`.
    const vy = p.vy - TYPE19_GRAVITY;
    p.vy = Math.fround(vy);
    p.restY = Math.fround(vy + p.restY);
  }

  if ((G.g_script_flags[SCRIPT_FLAG_TYPE19_OPEN] ?? 0) === 1 && w.o2B0 === 0) {
    p.routinePhase = Type19Phase.Opening;
    w.o2B0 = 1;
    events?.emit("sound.play", { id: SFX_TYPE19_OPEN });
  }

  switch (p.routinePhase as Type19Phase) {
    case Type19Phase.Idle: {
      const n = p.storyItem + 1;
      p.storyItem = n;
      if (n === TYPE19_KNOCK_FIRST || n === TYPE19_KNOCK_SECOND) {
        p.routinePhase = Type19Phase.Knock;
        if (n === TYPE19_KNOCK_SECOND) p.storyItem = 0;
        events?.emit("sound.play", { id: SFX_TYPE19_KNOCK });
      }
      break;
    }
    case Type19Phase.Knock: {
      const h = p.hingeB
        + (p.hingeB < TYPE19_STEP_TURN ? TYPE19_STEP_OUT : TYPE19_STEP_BACK);
      p.hingeB = h;
      // `FILD; FMUL double [0x004C4370]; FSIN; FMUL double; CALL __ftol` --
      // no float store between, and `__ftol` truncates toward zero.
      w.o68 = Math.trunc(Math.sin(h * BAMS_TO_RAD_F64) * TYPE19_KNOCK_YAW);
      p.restPitch = Math.trunc(
        Math.sin((h - TYPE19_KNOCK_PART_LAG) * BAMS_TO_RAD_F64)
        * TYPE19_KNOCK_PART);
      if (h > TYPE19_KNOCK_END) {
        p.hingeB = 0;
        const knocks = p.removeFlag + 1;
        w.o68 = 0;
        p.routinePhase = Type19Phase.Idle;
        p.removeFlag = knocks;
        if (knocks > TYPE19_KNOCKS) {
          if (G.g_enemies_present > 0) G.g_enemies_present -= 1;
          p.routinePhase = Type19Phase.Retired;
          events?.emit("sound.play", { id: SFX_TYPE19_GIVE_UP });
          // `INC word [0x009A21BA]` -- `g_civilians_seen_total`, the run
          // tally `CivilianInit` also raises, and class 0x64's route reads.
          G.g_civilians_seen_total = (G.g_civilians_seen_total + 1) & 0xffff;
        }
      }
      break;
    }
    case Type19Phase.Opening: {
      const f = p.cueCursorB;
      if (f < TYPE19_HINGE_FRAMES) {
        // A bundle that does not carry the curve leaves the pose where it
        // was; the frame still advances, as the engine's does.
        const k = HingeCurveXYZFrame(TYPE19_HINGE_CURVE, f);
        if (k) {
          w.o6C = k[2] + p.roll;
          w.o64 = k[0] + p.pitch;
          w.o68 = k[1];
        }
        p.cueCursorB = f + 1;
      }
      break;
    }
    case Type19Phase.Retired:
      break;
  }

  // The body.
  const body = PropMatrixPush();
  MatrixTranslate(body, p.hitPos.x, p.hitPos.y, p.hitPos.z);
  Type19BodyTurn(body, w);
  PropDrawSlot(p, body, TYPE19_BODY_SLOT);

  // The shot point, under the rotations alone.
  const m = PropMatrixPush();
  MatrixLoadIdentity(m);
  Type19BodyTurn(m, w);
  MatrixRotateX(m, p.restPitch);
  MatrixTranslate(m, 0, TYPE19_HANG, 0);
  const pt = vec3();
  MatrixTransformPoint(m, vec3(TYPE19_PIVOT_X, TYPE19_PIVOT_Y, TYPE19_PIVOT_Z),
                       pt);

  // The hung part.
  const part = PropMatrixPush();
  MatrixTranslate(part, p.hitPos.x, p.hitPos.y, p.hitPos.z);
  Type19BodyTurn(part, w);
  MatrixTranslate(part, TYPE19_PIVOT_X,
                  Math.fround(p.restY + TYPE19_PIVOT_Y), TYPE19_PIVOT_Z);
  MatrixRotateX(part, p.restPitch);
  MatrixTranslate(part, 0, TYPE19_HANG, 0);
  PropDrawSlot(p, part, p.slot);

  // `FLD [pt]; FADD [ESI+0x40]; FST [ESI+0x19C]` and so on: the point is
  // written over the object's own position every frame, then registered.
  p.x = Math.fround(Math.fround(pt.x) + p.hitPos.x);
  p.y = Math.fround(Math.fround(pt.y) + p.hitPos.y);
  p.z = Math.fround(Math.fround(pt.z) + p.hitPos.z);
  PropRegisterForShotTest(p, p.x, p.y, p.z);
}

/**
 * `MatrixRotateY(0xC000); MatrixRotateZ(+0x6C); MatrixRotateY(+0x68);
 * MatrixRotateX(+0x64)` — the four calls every one of the routine's three
 * matrices opens with. `[port-only]` as a function.
 */
function Type19BodyTurn(m: number[], w: Type19Words): void {
  MatrixRotateY(m, TYPE19_FACING);
  MatrixRotateZ(m, w.o6C);
  MatrixRotateY(m, w.o68);
  MatrixRotateX(m, w.o64);
}
