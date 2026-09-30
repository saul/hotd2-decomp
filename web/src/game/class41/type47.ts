/**
 * Class 0x41 constructor 47 — a flat disc, drawn faded, until a flag or a step.
 *
 * One spawn in the game: stage 2 evt `0x14990` at `(-1355.0, -28.0,
 * -2020.0)`. Slot `0x1384` is `etc_1.bin[64]`, a 134-unit flat disc, which
 * the routine lays flat and draws at 0.4 scale -- 54 units across. `[open]`
 * what it is.
 *
 * ## The two routines `[proved]`
 *
 * `PlaceType47Prop` (`FUN_00463AE0`), `g_class41_constructors[47]`:
 *
 * ```c
 * obj = ActorAlloc(PropUpdateType47, 0x48); ActorClearGameFields(obj);
 * obj->+0x34..0x3C = desc->+0x40..0x48;  (byte)obj->+0x40 = 0;
 * ```
 *
 * -- a 0x48-byte task rather than a 0x378 prop, so its position lives at the
 * offsets a prop keeps its flag word and hit data in. Nothing else of the
 * descriptor is read.
 *
 * `PropUpdateType47` (`FUN_0046DD40`), `g_class41_updates[47]`:
 *
 * ```c
 * if (g_script_flags[0x11] == 1 || (s16)g_evt_step_index == 2) { ActorKill(); return; }
 * Push(0); Translate(obj->+0x34, +0x38, +0x3C); RotX(0xC000);
 * Scale(0.4, 0.4, 0.4); NoOpStub(0.4);
 * AssetDrawSlotWithAlpha(0x1384, sin(obj->+0x44 * 2PI/65536) * 0.2 + 0.8);
 * Pop(1);
 * ```
 *
 * `obj+0x44` is zeroed by `ActorClearGameFields` and written by neither
 * routine, and nothing else holds the task, so the sine is of zero and the
 * alpha is 0.8 on every frame. `[likely]`: no writer was found; the port
 * keeps the word and computes the alpha from it, so a writer found later is
 * one line.
 */
import type { BreakablePlacement } from "../../bundle";
import { G } from "../globals";
import { MatrixRotateX, MatrixScale, MatrixTranslate } from "../matrix";
import { ActorKillProp } from "./prop";
import { PropDrawBegin, PropDrawSlotWithAlpha, PropMatrixPush }
  from "./prop_draw";
import {
  BreakableState, makeBreakableProp, PropFamily, type BreakableProp,
} from "./prop_state";
import { PropWords } from "./words";
import { TYPE47_SLOT } from "./type47_slots";

/** `CMP byte ptr [0x009C7211], 1` — `g_script_flags[0x11]`. */
export const TYPE47_KILL_FLAG = 0x11;
/** `CMP word ptr [0x009A2BB0], 2` — `g_evt_step_index`. */
export const TYPE47_KILL_STEP = 2;
/** `PUSH 0xC000` into `MatrixRotateX`: a quarter turn, lying flat. */
export const TYPE47_PITCH = 0xc000;
/** `PUSH 0x3ECCCCCD` three times into `MatrixScale`. */
export const TYPE47_SCALE = Math.fround(0.4);
/** `FMUL [0x004D1D24]` and `FADD [0x004C43A8]` — `0.2` and `0.8`. */
export const TYPE47_ALPHA_SWING = Math.fround(0.2);
export const TYPE47_ALPHA_MID = Math.fround(0.8);
/** `FMUL double [0x004C4370]` — BAMS to radians. */
const BAMS_TO_RADIANS = 9.587379924285257e-05;

/** The one word of the task the port keeps beside the position. */
export interface Type47Words {
  /** `obj+0x44` — the sine's argument; see the file comment. */
  o44: number;
}
const TYPE47_WORDS: Type47Words = { o44: 0 };

/** `PlaceType47Prop` — `FUN_00463AE0`. `g_class41_constructors[47]`. */
export function PlaceType47Prop(pl: BreakablePlacement): BreakableProp {
  const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  p.family = PropFamily.Type47;
  p.at = pl.at;
  p.state = BreakableState.Standing;
  p.flags = 0;
  // `obj+0x34..0x3C` in the engine's 0x48-byte task; the port's prop keeps a
  // position where every other family does.
  p.x = Math.fround(pl.pos?.[0] ?? 0);
  p.y = Math.fround(pl.pos?.[1] ?? 0);
  p.z = Math.fround(pl.pos?.[2] ?? 0);
  p.slot = TYPE47_SLOT;
  PropWords(p, TYPE47_WORDS).o44 = 0;
  p.hitRadius = 0;
  return p;
}

/** `PropUpdateType47` — `FUN_0046DD40`. `g_class41_updates[47]`. */
export function PropUpdateType47(p: BreakableProp): void {
  if (G.g_script_flags[TYPE47_KILL_FLAG] === 1
      || ((G.g_evt_step_index << 16) >> 16) === TYPE47_KILL_STEP) {
    ActorKillProp(p);
    return;
  }
  const w = PropWords(p, TYPE47_WORDS);
  PropDrawBegin(p);
  const m = PropMatrixPush();
  MatrixTranslate(m, p.x, p.y, p.z);
  MatrixRotateX(m, TYPE47_PITCH);
  MatrixScale(m, TYPE47_SCALE, TYPE47_SCALE, TYPE47_SCALE);
  const alpha = Math.sin(w.o44 * BAMS_TO_RADIANS) * TYPE47_ALPHA_SWING
    + TYPE47_ALPHA_MID;
  PropDrawSlotWithAlpha(p, m, TYPE47_SLOT, Math.fround(alpha));
}
