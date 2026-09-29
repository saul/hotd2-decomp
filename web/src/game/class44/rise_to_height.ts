/**
 * Class 0x44 selector 13 — an object that rises on a script flag until it
 * stands a whole-number height above where it was placed.
 *
 * Thirteen spawns in the game, none of them before stage 5:
 *
 * * **stage 5**, descriptor `0x16F4`, slot `0x1892` = `st5.bin[1]`, at
 *   `(583.0, -70.9, -1340.2)`: the object behind block 1's fight with
 *   JUDGMENT, spawned at step 1 op 26 and again at block 2 step 0. It rises
 *   48 on flag 4 and is removed on flag 23. The model is 105 wide and 54
 *   tall, and renders as a rusted panelled gate that fills the tunnel mouth
 *   behind the fight: `[likely]` a gate, on the model and where it stands.
 * * **stage 6**, twelve descriptors between `0x18C8` and `0x4738`, each 32
 *   high, on flags 6 to 13 and 44/45.
 *
 * Until this file existed the port had no builder for the selector, so
 * `PropPlacerDispatch44` ran nothing and the object never existed; the model
 * was on screen only because `render/stagescene.ts` drew every slot the script
 * loaded with opcode 0x50 at the model's own origin (`L54`) -- the world's
 * `(0, 0, 0)`, fourteen hundred units from the fight.
 *
 * ## The two routines `[proved]`
 *
 * The constructor, at `0x00473640`, from its disassembly:
 *
 * ```c
 * obj = ActorAlloc(RiseToHeightUpdate, 0x378); ActorClearGameFields(obj);
 * obj->+0x19C..0x1A4 = desc->+0x40..0x48;          // the position
 * obj->+0x1D0 = desc->+0x68;                        // the yaw the draw uses
 * obj->+0x68  = desc->+0x68;                        // ...and the root's
 * obj->+0x34 |= 0x51;
 * obj->+0x28C = (u16)tail->+0x04;                   // the slot
 * obj->+0x14C = tail->+0x08;                        // a coli blob, or -1
 * obj->+0x2A0 = (s8)tail->+0x20;                    // the rise flag
 * obj->+0x2A4 = (s8)tail->+0x21;                    // the remove flag
 * obj->+0x2C0 = (float)(int)tail->+0x14 + desc->+0x44;   // the ceiling
 * ```
 *
 * The update, at `0x004757F0`:
 *
 * ```c
 * if (g_script_flags[obj->+0x2A4] == 1) {
 *     if (obj->+0x14C == -1) ActorKill(); else ActorDespawn(obj);
 *     return;
 * }
 * if (g_active_cam_path == 0xDD && g_cam_path_frame == 0x35C) {
 *     ActorKill(); return;
 * }
 * if (g_script_flags[obj->+0x2A0] == 1 && obj->+0x1A0 < obj->+0x2C0)
 *     obj->+0x1A0 += 1.0f;
 * MatrixStackPush(0);
 * MatrixTranslate(obj->+0x19C, obj->+0x1A0, obj->+0x1A4);
 * MatrixRotateY(obj->+0x1D0);
 * AssetDrawSlot((s16)obj->+0x28C);
 * MatrixStore(obj->+0x150);
 * MatrixStackPop(1);
 * if (obj->+0x14C != -1) RegisterForShotTest(obj);
 * ```
 *
 * Four things in it are worth stating outright.
 *
 * **It is not selector 11.** `RisingDoorUpdate` accelerates from a literal
 * speed towards one of two literal ceilings picked by comparing the slot with
 * `0xA58`; this one climbs at a constant `1.0` (`FADD [0x004C4380]`) to a
 * ceiling the descriptor gives, so the height is data and travels in the
 * bundle as `rise`.
 *
 * **The test is before the step, and it is `<`.** `FLD y; FCOMP ceiling;
 * TEST AH, 1; JZ` at `0x00475846` steps only while `y` is strictly below the
 * ceiling, so the object stops on the first `y` at or past it. The ceiling is
 * a whole number of units above the start and both are `f32` stores, and in
 * `f32` stage 5's lands on it exactly after 48 frames and stage 6's after 32;
 * a `<=` would take each one unit further.
 *
 * **Two exits, chosen by `obj+0x14C`.** The remove flag ends in `ActorKill`
 * (`FUN_004A7040`) when there is no blob and in `ActorDespawn`
 * (`FUN_00409CC0`) when there is; a camera path/frame pair kills it
 * unconditionally. The `>= 0` test `HingeUpdate` puts on its remove flag is
 * not here: the byte is used as it stands.
 *
 * **One draw.** No shadow, no rattle, no lifetime prologue and no second
 * `AssetDrawSlot`, so the draw is recorded where the routine makes it
 * (`class41/prop_draw.ts`) and `render/breakables.ts` decides nothing.
 *
 * ## What the prop does not carry
 *
 * `obj+0x68` and `MatrixStore(obj+0x150)` are read by nothing but the mesh
 * shot test and the two collision passes, and those reach the object only
 * through `obj+0x14C` -- which is `-1` in all thirteen shipped spawns
 * (`web/tools/checks/rise_to_height.ts` holds every one to it). The prop
 * struct carries the draw's yaw (`+0x1D0`) and the draw's matrix is in the
 * recorded draw; the blob word itself is kept, because both exits and the
 * registration branch on it.
 */
import type { BreakablePlacement } from "../../bundle";
import { G } from "../globals";
import { MatrixRotateY, MatrixTranslate } from "../matrix";
import { ActorDespawnProp, ActorKillProp } from "../class41/prop";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush }
  from "../class41/prop_draw";
import {
  BreakableState, makeBreakableProp, PropFamily, type BreakableProp,
} from "../class41/prop_state";
import { PropRegisterForShotTest } from "../class41/shot_test";
import { PropWords } from "../class41/words";

/** `FADD float ptr [0x004C4380]` — `1.0f`, the climb per frame. */
export const RISE_TO_HEIGHT_STEP = 1.0;

/**
 * `CMP dword ptr [0x009A2D78], 0xDD` and `CMP dword ptr [0x009A6110], 0x35C`
 * at `0x00475818`/`0x00475824`: the camera path and frame that kill every one
 * of these that is still alive.
 */
export const RISE_TO_HEIGHT_KILL_PATH = 0xdd;
export const RISE_TO_HEIGHT_KILL_FRAME = 0x35c;

/** `obj+0x34 \|= 0x51` — live, the mesh shot path (bit `0x10`) and `0x40`. */
const RISE_TO_HEIGHT_FLAGS = 0x51;

/**
 * The one word of the 0x378-byte object this family keeps that no field of
 * {@link BreakableProp} carries.
 */
export interface RiseToHeightWords {
  /**
   * `obj+0x14C` — the tail's `+0x08`: a collision blob, or `-1` for none.
   * `ActorClearGameFields` zeroes it, and the constructor always writes it.
   */
  o14c: number;
}

/** `ActorClearGameFields` (`FUN_004A73D0`) leaves the word at zero. */
const RISE_TO_HEIGHT_WORDS: RiseToHeightWords = { o14c: 0 };

/**
 * `PropBuildRiseToHeight` — `FUN_00473640`. `g_class44_subtypes[13]`.
 *
 * The ceiling is formed the way the FPU forms it: the tail's `+0x14` is an
 * **integer** (`FILD`), added to the descriptor's `y` as the `f32` it is
 * stored as (`FADD float ptr [EAX+0x44]`), and stored back as an `f32`.
 */
export function PropBuildRiseToHeight(pl: BreakablePlacement): BreakableProp {
  const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  p.family = PropFamily.RiseToHeight;
  p.at = pl.at;
  p.state = BreakableState.Standing;
  p.flags = RISE_TO_HEIGHT_FLAGS;
  // `obj+0x19C..0x1A4`, the descriptor's position.
  p.x = Math.fround(pl.pos?.[0] ?? 0);
  p.y = Math.fround(pl.pos?.[1] ?? 0);
  p.z = Math.fround(pl.pos?.[2] ?? 0);
  // `obj+0x1D0`, the descriptor's orientation *b*. See the file comment for
  // `obj+0x68`, which the constructor writes with the same word.
  p.yaw = pl.yaw ?? 0;
  // `obj+0x28C` — the u16 at tail+0x04.
  p.slot = pl.slot ?? 0;
  PropWords(p, RISE_TO_HEIGHT_WORDS).o14c = pl.coli ?? -1;
  // `obj+0x2A0` and `obj+0x2A4`, the two signed bytes of the tail.
  p.storyItem = pl.open_flag ?? 0;
  p.removeFlag = pl.remove_flag ?? -1;
  // `obj+0x2C0` — `FILD [ECX+0x14]; FADD [EAX+0x44]; FSTP [ESI+0x2C0]`.
  p.shake = Math.fround((pl.rise ?? 0) + p.y);
  // No `obj+0x124` is written, so there is no sphere to shoot.
  p.hitRadius = 0;
  return p;
}

/**
 * `RiseToHeightUpdate` — `FUN_004757F0`. One object, one 60 Hz frame.
 *
 * Called directly by the pool rather than through the generic prologue: the
 * routine has no `PropExpireByStepLifetime`, and its remove flag and camera
 * cue are its whole lifetime.
 */
export function RiseToHeightUpdate(p: BreakableProp): void {
  const w = PropWords(p, RISE_TO_HEIGHT_WORDS);
  // `CMP byte ptr [EAX + 0x9C7200], 1` with `EAX = obj+0x2A4`, unguarded.
  if (G.g_script_flags[p.removeFlag] === 1) {
    // `CMP [ESI+0x14C], -1; JZ` to the `ActorKill` at 0x00475830.
    if (w.o14c === -1) ActorKillProp(p);
    else ActorDespawnProp(p);
    return;
  }
  if (G.g_active_cam_path === RISE_TO_HEIGHT_KILL_PATH
      && G.g_cam_path_frame === RISE_TO_HEIGHT_KILL_FRAME) {
    ActorKillProp(p);
    return;
  }
  // `FLD [ESI+0x1A0]; FCOMP [ESI+0x2C0]; TEST AH, 1; JZ` — strictly below.
  if (G.g_script_flags[p.storyItem] === 1 && p.y < p.shake) {
    p.y = Math.fround(p.y + RISE_TO_HEIGHT_STEP);
  }
  PropDrawBegin(p);
  const m = PropMatrixPush();
  MatrixTranslate(m, p.x, p.y, p.z);
  MatrixRotateY(m, p.yaw);
  PropDrawSlot(p, m, p.slot);
  // `MatrixStore(obj+0x150); MatrixStackPop(1)` -- see the file comment.
  // `RegisterForShotTest` only with a blob. The routine never writes
  // `obj+0x70..0x78`, so the point it files is the one the object was
  // cleared with, and the `0x10` it raised sends the engine to the mesh.
  if (w.o14c !== -1) PropRegisterForShotTest(p, p.shotX, p.shotY, p.shotZ);
}
