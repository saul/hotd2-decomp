/**
 * Class 0x33 sub-handler **2** — one model, drawn at the object's own pose
 * until a camera frame or a script flag takes it away.
 *
 * ```
 * ScriptedPropDrawUntilFlag   FUN_00433A10   the whole of it
 * ```
 *
 * `ScriptedSceneryDispatch33` (`FUN_00432FF0`) installs it from entry 1 of
 * the jump table at `0x004330C4`: `0x00433027`, `PUSH EAX` / `MOV dword ptr
 * [EAX], 0x433a10` / `CALL 0x00409270`. That arm is the only reference to
 * `0x00433A10` in the image -- a byte search for `103a4300` finds
 * `0x0043302A` and nothing else -- so no other class installs it.
 *
 * ## What it is
 *
 * The routine ends at `0x00433ABB` and there is nothing else to it: a seed
 * that copies the draw slot, a test of two ways out, and the draw. No sphere,
 * no `RegisterForShotTest`, no sound, no state beyond the seed. `[proved]`
 *
 * Ten descriptors, fifty-six spawns over both modes, all drawing three models
 * of `char_adv04.bin` -- slots `0x36`, `0x37` and `0x1793`, entries 11, 12
 * and 94. Stage 1's five (`0x5FE8`..`0x60C8`) leave on script flag 1, which
 * block 14 step 1 raises at op 83; stage 2's five (`0x668`..`0x748`) on flag
 * 0, raised at block 3 step 3 and block 11 step 2. Every shipped camera frame
 * word is `-1`. Rendered in stage 1's block 5 they are the car parked in
 * the piazza, seen through the arch, and gone with flag 1 raised -- which is
 * the picture, not a reading; the annotation once called them "the stage-2
 * van bodies", and nothing in the routine says that either.
 *
 * ## What stood in for it
 *
 * Before this the exporter wrote each descriptor's model into the glTF as a
 * rig with a fixed pose, and a render layer (`render/props.ts`) hid it once
 * the flag was non-zero. So every one of them stood in the world from the
 * stage's first frame -- spawned or not -- came back if the flag fell, never
 * left on the camera frame, and was drawn at one pose per descriptor however
 * many times the script spawned it. That layer and the exporter's `props`
 * block are gone; the object is this routine's now, and its draw is the one
 * it records (`render/slotmodels.ts`).
 */
import { ActorDespawn } from "../despawn";
import { G } from "../globals";
import type { ScriptedSceneryActor } from "../actor";
import {
  MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixScale,
  MatrixTranslate,
} from "../matrix";

/**
 * `PUSH 0x3f800000` three times at `0x00433A85`..`0x00433A8F` -- the scale
 * the routine hands `MatrixScale`, which is the identity.
 */
const DRAW_SCALE = 1.0;

/**
 * `ScriptedPropDrawUntilFlag` — `FUN_00433A10`. One frame of the object.
 *
 * ```
 * 00433A15  MOV  AX, [ESI + 0x1312]           the seed word
 * 00433A1C  MOV  ECX, [ESI + 0x1390]          the descriptor tail
 * 00433A22  TEST AX, AX / JNZ 0x00433A37
 * 00433A27  MOV  EDX, [ECX]; INC EAX          tail+0x00, and 0 + 1
 * 00433A2A  MOV  [ESI + 0x13F0], EDX; MOV [ESI + 0x1312], AX
 * 00433A37  MOV  EAX, [ECX + 0xC]             tail+0x0C
 * 00433A40  CMP  EAX, [0x009a6110] / JZ despawn        g_cam_path_frame
 * 00433A46  MOV  DL, [ECX + 0x11]             tail+0x11
 * 00433A49  CMP  byte ptr [EDX + 0x9c7200], 1 / JZ despawn
 * 00433A52  Push; Translate(+0x40..0x48); RotZ(+0x6C); RotY(+0x68);
 *           RotX(+0x64); Scale(1, 1, 1); AssetDrawSlot(+0x13F0); Pop
 * 00433AB1  ActorDespawn(obj)
 * ```
 *
 * The seed is gated on the word and not on a first-frame bit, and it writes
 * `AX + 1` with `AX` the zero it just tested, so the word is 1 afterwards and
 * the copy runs once.
 *
 * The camera test is an **integer equality on block 0's frame alone** -- the
 * routine names `0x009A6110` and nothing else, where selector 5's names block
 * 2's as well. So it is one frame, not a threshold. Every shipped spawn
 * carries `-1` there, and it is compared all the same.
 *
 * The flag is `g_script_flags[tail+0x11] == 1` with the byte used raw: no
 * "none" test in front of it, as selector 1's and selector 4's flags have
 * none. A flag at 2 is not raised, for this routine.
 *
 * `ActorDespawn` (`FUN_00409CC0`) ends in `ActorKill`, which does not return
 * (`L72`), so a frame that takes either way out draws nothing.
 *
 * The draw is recorded on `obj.scenery.draws` with the matrix the stack held,
 * as selector 1's are, and `render/slotmodels.ts` places it. `[port-only]`:
 * the list is cleared first, so a frame that draws nothing leaves nothing.
 */
export function ScriptedPropDrawUntilFlag(obj: ScriptedSceneryActor): void {
  const t = obj.class33Prop;
  const s = obj.scenery;
  if (!t) return;
  s.draws.length = 0;

  if (obj.sub === 0) {
    s.slot = t.slot;
    obj.sub += 1;
  }

  if (t.despawn_frame === G.g_cam_path_frame
      || G.g_script_flags[t.despawn_flag] === 1) {
    ActorDespawn(obj);
    return;
  }

  const m = MatIdentity();
  MatrixTranslate(m, obj.pos.x, obj.pos.y, obj.pos.z);
  MatrixRotateZ(m, obj.roll);
  MatrixRotateY(m, obj.yaw);
  MatrixRotateX(m, obj.pitch);
  MatrixScale(m, DRAW_SCALE, DRAW_SCALE, DRAW_SCALE);
  s.draws.push({ slot: s.slot, m: m.slice(0, 16) });
}
