/**
 * Class 0x44 selector 14 — a model its descriptor names, drawn at the
 * spawn's pose at a scale the descriptor gives, for a lifetime in event
 * steps.
 *
 * Twelve spawns in the arcade tables (Original Mode's repeat them): stage 2's
 * two at `0x11F90`/`0x11FC8` (`komono_bar.bin` 8 and 6), stage 3's three and
 * stage 4's two that draw `st1_1.bin[2]` (slot `0x10AE`) stretched along x,
 * and stage 4's five that draw `komono_st4.bin` 2 and 6. Until this file
 * existed the selector had no builder, `PropPlacerDispatch44` ran nothing, and
 * the objects never existed (`L83`); the one model of theirs the script loads
 * with opcode `0x50`, `0x10AE`, was on screen only through the stage's
 * "loaded, so drawn" rule, at the world's origin (`L54`) -- which is what had
 * made it look drawn by nothing: no instruction names it, because the slot is
 * the descriptor tail's `+0x04` (`L39`).
 *
 * ## The two routines `[proved]`
 *
 * The constructor, `g_class44_subtypes[14]` (`0x00595AF0`), at `0x004736D0`:
 *
 * ```c
 * obj = ActorAlloc(PropDrawOnlySelector14, 0x378); ActorClearGameFields(obj);
 * obj->+0x19C..0x1A4 = placer->+0x40..0x48;          // the position
 * obj->+0x1CC..0x1D4 = placer->+0x64..0x6C;          // pitch, yaw, roll
 * obj->+0x196 = (u8)g_evt_step_index; obj->+0x197 = 0;
 * obj->+0x11C = (u16)tail->+0x00;                    // the lifetime, in steps
 * obj->+0x28C = (u16)tail->+0x04;                    // the slot
 * obj->+0x1A8..0x1B0 = tail->+0x08..0x10;            // the scale, three f32
 * ```
 *
 * The update, at `0x004758E0`:
 *
 * ```c
 * PropExpireByStepLifetime(obj);                     // never returns if it retires
 * MatrixStackPush(0);
 * MatrixTranslate(+0x19C, +0x1A0, +0x1A4 + +0x1C8);
 * MatrixRotateZ(+0x1D4); MatrixRotateY(+0x1D0); MatrixRotateX(+0x1CC);
 * MatrixScale(+0x1A8, +0x1AC, +0x1B0);
 * MaxOfThreeToNoOpStub(+0x1A8, +0x1AC, +0x1B0);      // dead
 * if (g_GameMode != 2 && g_scene_lighting != 0)
 *     SubmitSlotWithSceneLightArray((s16)+0x28C);
 * else AssetDrawSlot((s16)+0x28C);
 * MatrixStackPop(1);
 * ```
 *
 * **It is `PropDrawOnlyType12` (`FUN_00467E50`) without the camera cue**:
 * the same prologue, the same product, the same dead call and the same pair of
 * draws, instruction for instruction, less the `0x2F`/`0x96` despawn -- so the
 * scale is the descriptor's rather than type 12's constant 1.0, and nothing
 * but the lifetime ends it. `+0x1C8` is never written and is zero.
 *
 * No `RegisterForShotTest`, no radius, no `AND` on `obj+0x34`: it is drawn and
 * nothing else.
 */
import type { BreakablePlacement } from "../../bundle";
import { G } from "../globals";
import { MatrixScale } from "../matrix";
import { PropExpireByStepLifetime } from "../class41/lifetime";
import {
  PropDrawBegin, PropDrawSlot, PropMatrixPush, PropMatrixTRzRyRx,
  PropSubmitSlotWithSceneLightArray,
} from "../class41/prop_draw";
import {
  BreakableState, makeBreakableProp, PropFamily, type BreakableProp,
} from "../class41/prop_state";
import { GameMode } from "../game_mode";

/**
 * `PropBuildDrawOnlySelector14` — `FUN_004736D0`. `g_class44_subtypes[14]`.
 *
 * The scale travels in {@link BreakableProp.restX}/`restY`/`restZ` -- the
 * `+0x1A8`..`+0x1B0` those fields carry, as type 12's does -- and the
 * lifetime in {@link BreakableProp.lifetime}, `+0x11C`, counted from the step
 * the object was built on (`+0x196`).
 */
export function PropBuildDrawOnlySelector14(
    pl: BreakablePlacement): BreakableProp {
  const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  p.family = PropFamily.DrawOnlySelector14;
  p.at = pl.at;
  p.state = BreakableState.Standing;
  // `obj+0x19C..0x1A4` and `+0x1CC..0x1D4`, the placer's position and three
  // angles.
  p.x = Math.fround(pl.pos?.[0] ?? 0);
  p.y = Math.fround(pl.pos?.[1] ?? 0);
  p.z = Math.fround(pl.pos?.[2] ?? 0);
  p.pitch = pl.pitch ?? 0;
  p.yaw = pl.yaw ?? 0;
  p.roll = pl.roll ?? 0;
  // `MOV CL, [0x009A2BB0]; MOV [ESI+0x196], CL; MOV byte [ESI+0x197], 0`.
  p.lastStepIndex = G.g_evt_step_index;
  p.stepsElapsed = 0;
  // `MOV DX, [EAX]; MOV [ESI+0x11C], DX` and `MOV CX, [EAX+4]; MOV
  // [ESI+0x28C], CX`: the tail's two words.
  p.lifetime = pl.lifetime_evt_steps;
  p.slot = pl.slot ?? 0;
  // The tail's three floats at `+0x08`, `+0x0C`, `+0x10`.
  p.restX = Math.fround(pl.scale?.[0] ?? 0);
  p.restY = Math.fround(pl.scale?.[1] ?? 0);
  p.restZ = Math.fround(pl.scale?.[2] ?? 0);
  p.hitRadius = 0;
  return p;
}

/**
 * `PropDrawOnlySelector14` — `FUN_004758E0`. One object, one 60 Hz frame.
 *
 * Called directly by the pool: the prologue is its own first call.
 */
export function PropDrawOnlySelector14(p: BreakableProp): void {
  PropDrawBegin(p);
  if (PropExpireByStepLifetime(p)) return;
  const m = PropMatrixPush();
  // `FLD +0x1C8; FADD +0x1A4; FSTP` — a float32 sum on its way to the stack.
  PropMatrixTRzRyRx(m, p.x, p.y, Math.fround(p.vz + p.z), p.pitch, p.yaw,
                    p.roll);
  MatrixScale(m, p.restX, p.restY, p.restZ);
  // `g_GameMode != 2 && g_scene_lighting` (`0x0047596F`) submits through the
  // scene light array, else `AssetDrawSlot`.
  if (G.g_GameMode !== GameMode.Training && G.g_scene_lighting !== 0) {
    PropSubmitSlotWithSceneLightArray(p, m, p.slot);
  } else {
    PropDrawSlot(p, m, p.slot);
  }
}

/**
 * `PropBuildSlotStripLoop` — `FUN_00473370`. `g_class44_subtypes[10]`.
 *
 * Five spawns, all stage 3's (`0x9164`..`0x9274`, blocks 11 and 15): the
 * object class 0x41 type 31 builds, from a class-0x44 descriptor --
 * `ActorAlloc(PropDrawOnlyType31, 0x378)`, so it runs
 * `class41/draw_only.ts`'s routine, a slot strip played as a loop.
 *
 * ```c
 * obj->+0x19C..0x1A4 = desc->+0x40..0x48;  obj->+0x1D0 = desc->+0x68;
 * obj->+0x196 = (u8)g_evt_step_index;  obj->+0x197 = 0;
 * obj->+0x2A4 = desc->+0x6C;                          // the strip's last cursor
 * obj->+0x11C = (u16)tail->+0x00;                     // the lifetime, in steps
 * obj->+0x28C = (u16)tail->+0x04;                     // the strip's first slot
 * obj->+0x1A8..0x1B0 = tail->+0x14..0x1C;             // the scale, three f32
 * ```
 *
 * `[proved]`. Unlike `PlaceGenericProp`'s arm for type 31 it writes neither
 * `obj+0x1CC` nor `obj+0x1D4`, so the pitch and roll the routine rotates by
 * stay zero, and the scale is the descriptor's rather than 1.0. The shipped
 * five draw `0x1874`..`0x1891` with a lifetime of 0 -- gone at the first step
 * boundary. All five are placed in block 11 (and again in block 15), and in
 * scene 2's block 11 the routine draws its second strip,
 * `0x1797`..`0x179D`, twice more.
 */
export function PropBuildSlotStripLoop(pl: BreakablePlacement): BreakableProp {
  const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  p.family = PropFamily.DrawOnlyType31;
  p.at = pl.at;
  p.state = BreakableState.Standing;
  p.x = Math.fround(pl.pos?.[0] ?? 0);
  p.y = Math.fround(pl.pos?.[1] ?? 0);
  p.z = Math.fround(pl.pos?.[2] ?? 0);
  p.yaw = pl.yaw ?? 0;
  p.lastStepIndex = G.g_evt_step_index;
  p.stepsElapsed = 0;
  // `obj+0x2A4` is the strip's last cursor here, and `obj+0x2A0` its cursor
  // -- the fields `PropDrawOnlyType31` reads as `removeFlag`/`storyItem`.
  p.removeFlag = pl.roll ?? 0;
  p.storyItem = 0;
  p.lifetime = pl.lifetime_evt_steps;
  p.slot = pl.slot ?? 0;
  p.restX = Math.fround(pl.scale?.[0] ?? 0);
  p.restY = Math.fround(pl.scale?.[1] ?? 0);
  p.restZ = Math.fround(pl.scale?.[2] ?? 0);
  p.hitRadius = 0;
  return p;
}
