/**
 * Class 0x41 type 5 — a static model that `g_script_flags[0x13]` takes away.
 *
 * Four shipped spawns, all stage 2, each drawing the model its descriptor's
 * `+0x11C` names (`GENERIC_DESCRIPTOR_SLOT`). The whole routine,
 * `0x00466820`..`0x00466890` `[proved]`:
 *
 * ```
 * 00466820  MOV AL,[0x009c7213] ; TEST AL,AL ; JZ draw
 * 00466829  JMP ActorKill                          ; 0x004A7040, a tail call
 * 0046682f  PUSH 0 ; CALL MatrixStackPush
 *           MatrixTranslate(+0x19C, +0x1A0, +0x1A4)
 *           MatrixRotateZ(+0x1D4); MatrixRotateY(+0x1D0); MatrixRotateX(+0x1CC)
 * 00466878  MOVSX EAX,word [ESI+0x28c] ; CALL AssetDrawSlot
 * 00466885  PUSH 1 ; CALL MatrixStackPop ; RET
 * ```
 *
 * **No lifetime prologue at all.** The port used to run every generic type
 * through `PropExpireByStepLifetime`, which for this type is wrong twice: it
 * charged the model slot (`0x1D8` and up) as a step lifetime, which is
 * harmless only because no stage has that many steps, and it applied the
 * prologue's scene-1 sweep — `g_script_flags[0x77]` despawning every prop that
 * runs it — to a type whose four spawns are all in stage 2, which is scene 1.
 * The only exit this routine has is flag `0x13`, and it takes it with
 * `ActorKill`, not `ActorDespawn`.
 *
 * No `RegisterForShotTest` and no `AND` on `obj+0x34`: nothing in
 * `PlaceGenericProp` gives type 5 a radius and nothing here would test one.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { G } from "../globals";
import { ActorKillProp } from "./prop";
import {
  PropDrawBegin, PropDrawSlot, PropMatrixPush, PropMatrixTRzRyRx,
} from "./prop_draw";
import type { BreakableProp } from "./prop_state";

/** `g_script_flags[0x13]` (`0x009C7213`) — while it is up, the prop is gone. */
export const SCRIPT_FLAG_TYPE5_REMOVE = 0x13;

/**
 * `PropDrawOnlyType5` — `FUN_00466820`. `g_class41_updates[5]`.
 *
 * `(s16)obj+0x28C` under `T . Rz . Ry . Rx` of the spawn's own pose, until
 * `g_script_flags[0x13]` kills it.
 */
export function PropDrawOnlyType5(p: BreakableProp, rng: Rng,
                                  events?: Events): void {
  void rng; void events;
  PropDrawBegin(p);
  if ((G.g_script_flags[SCRIPT_FLAG_TYPE5_REMOVE] ?? 0) !== 0) {
    ActorKillProp(p);
    return;
  }
  const m = PropMatrixPush();
  PropMatrixTRzRyRx(m, p.x, p.y, p.z, p.pitch, p.yaw, p.roll);
  PropDrawSlot(p, m, p.slot);
}
