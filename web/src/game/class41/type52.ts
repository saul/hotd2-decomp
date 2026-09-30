/**
 * Class 0x41 constructor 52 — the van's two rear doors, drawn shut.
 *
 * Two shipped spawns: stage 1 block 14 step 1 (evt `0x68AC`) at
 * `(-870.1, -7.0, -464.8)` turned `0xB433` with a lifetime of 0, and stage 5
 * block 0 step 2 (`0x0DD4`) at `(362.5, -0.1, -262.8)` with a lifetime of 4.
 * The two models are `char_adv04.bin[95]` and `[96]`. "Van" is `[likely]`:
 * stage 5's spawn stands at exactly the pose of a type-51 object drawing
 * `0x1793`, `char_adv04.bin[94]`, the model before them in the file, and
 * class 0x44 selector 2 swings the same two slots open at the same offsets.
 *
 * ## The routine `[proved]`
 *
 * `PlaceType52VanDoors` (`FUN_00463D20`), `g_class41_constructors[52]`, read
 * in the disassembly (`0x00463D20`..`0x00463E44`):
 *
 * ```c
 * MatrixStackPush(0); MatrixLoadIdentity();
 * MatrixTranslate(placer->+0x40, +0x44, +0x48); MatrixRotateY(placer->+0x68);
 * for (k = 0, i = -1; i < 3; k++, i += 2) {             // CMP EBX, 3
 *     obj = ActorAlloc(PropDrawOnlyType12, 0x378);  ActorClearGameFields(obj);
 *     MatrixTransformPoint((i * 9.29f, 11.5f, 22.68f), &p);  // 0x00569018
 *     obj->+0x19C/1A0/1A4 = p;
 *     obj->+0x1D0 = placer->+0x68 + k * 0x8000;
 *     obj->+0x28C = 0x1794 + k;                         // word
 *     obj->+0x11C = placer->+0x11C;                     // word
 *     obj->+0x196 = (u8)g_evt_step_index;  obj->+0x197 = 0;
 *     obj->+0x1A8 = obj->+0x1AC = obj->+0x1B0 = 1.0f;
 * }
 * MatrixStackPop(1);
 * ```
 *
 * **Not the same routine as `PropBuildVanDoors`** (`FUN_00472C90`), class
 * 0x44 selector 2's builder, though it places the same two slots at the same
 * two offsets half a turn apart: that one hands `ActorAlloc` `HingeUpdate` and
 * fills the hinge's axis, curve and flags from its descriptor tail; this one
 * hands it `PropDrawOnlyType12` (`FUN_00467E50`) and writes nothing a hinge
 * reads. The objects are constructor 50's kind -- type 12's routine run
 * directly, `g_class41_updates[52]` being `NoOpStub` -- so they stand still,
 * go at the step lifetime or at camera path `0x2F` frame `0x96`, register no
 * shot sphere and count toward nothing.
 */
import { G } from "../globals";
import {
  MatIdentity, MatrixRotateY, MatrixTransformPoint, MatrixTranslate,
} from "../matrix";
import type { Vec3 } from "../vec";
import { makeBreakableProp, PropFamily, type BreakableProp }
  from "./prop_state";
import { TYPE52_OBJECTS, TYPE52_SLOT } from "./ctor_literals";

/** `FMUL [0x00569018]` (`0x4114A3D7`) — the doors' x, times -1 and +1. */
export const TYPE52_DOOR_X = Math.fround(9.29);
/** `MOV [ESP+0x2C], 0x41380000` at `0x00463D8B`. */
export const TYPE52_DOOR_Y = 11.5;
/** `MOV [ESP+0x30], 0x41B570A4` at `0x00463D93`. */
export const TYPE52_DOOR_Z = Math.fround(22.68);
/** `ADD EAX, 0x8000` at `0x00463DFE` — the second door is turned half round. */
export const TYPE52_DOOR_TURN = 0x8000;
/** `MOV ECX, 0x3F800000` at `0x00463DF8` — the scale, all three axes. */
export const TYPE52_SCALE = 1.0;

/**
 * `PlaceType52VanDoors` — `FUN_00463D20`. `g_class41_constructors[52]`.
 *
 * `pos` and `yaw` are the placer's `+0x40..+0x48` and `+0x68`, `lifetime`
 * its `+0x11C`.
 */
export function PlaceType52VanDoors(at: number, pos: Vec3, yaw: number,
                                    lifetime: number): BreakableProp[] {
  const m = MatIdentity();
  MatrixTranslate(m, pos.x, pos.y, pos.z);
  MatrixRotateY(m, yaw);
  const out: BreakableProp[] = [];
  for (let k = 0, i = -1; k < TYPE52_OBJECTS; k++, i += 2) {
    const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
    p.family = PropFamily.DrawOnlyType12;
    p.at = at;
    // `FILD [ESP+0x3C]; FMUL [0x00569018]; FSTP float` -- the product is
    // stored as a float before the transform reads it.
    const src = { x: Math.fround(i * TYPE52_DOOR_X), y: TYPE52_DOOR_Y,
                  z: TYPE52_DOOR_Z };
    const dst = { x: 0, y: 0, z: 0 };
    MatrixTransformPoint(m, src, dst);
    p.x = Math.fround(dst.x);
    p.y = Math.fround(dst.y);
    p.z = Math.fround(dst.z);
    p.yaw = (yaw + k * TYPE52_DOOR_TURN) | 0;
    // `LEA EDX, [EBP + 0x1794]; MOV word ptr [ESI+0x28C], DX`.
    p.slot = ((TYPE52_SLOT + k) << 16) >> 16;
    // `MOV CX, [EDI+0x11C]; MOV [ESI+0x11C], CX` -- a word copy, which
    // `PropExpireByStepLifetime` compares signed.
    p.lifetime = (lifetime << 16) >> 16;
    // `MOV DL, byte ptr [g_evt_step_index]; MOV [ESI+0x196], DL`.
    p.lastStepIndex = G.g_evt_step_index & 0xff;
    p.stepsElapsed = 0;
    p.restX = TYPE52_SCALE;                          // +0x1A8
    p.restY = TYPE52_SCALE;                          // +0x1AC
    p.restZ = TYPE52_SCALE;                          // +0x1B0
    // `ActorClearGameFields` (`FUN_004A73D0`) zeroed the rest -- the pitch,
    // the roll, `+0x1C8` and the flag word -- and nothing writes them back.
    p.flags = 0;
    p.removeFlag = 0;
    out.push(p);
  }
  return out;
}
