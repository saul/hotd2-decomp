/**
 * Class 0x33 sub-handler **5** — a sprite effect that goes off when the camera
 * reaches a frame.
 *
 * ```
 * ScriptedEffectAtCameraCue33   FUN_00433B00   the whole of it
 * ```
 *
 * `ScriptedSceneryDispatch33` (`FUN_00432FF0`) reaches it through the byte
 * table at `0x004330F8` (identity for 1..11, so selector 5 is index 4) and the
 * jump table at `0x004330C4`, whose entry 4 is `0x00433051`: `PUSH EAX` /
 * `MOV dword ptr [EAX], 0x433b00` / `CALL 0x00409270`. That is the only
 * reference to `0x00433B00` in the image -- a byte search for `003b4300` finds
 * `0x00433054` and nothing else -- so no other class installs it.
 *
 * ## What it is
 *
 * The routine ends at `0x00433B61` and there is nothing else to it: it reads
 * one word of the descriptor tail, compares it with two camera frames,
 * and on a match throws one {@link SpriteEffectKind.Dokan} sprite at the
 * object's own position and despawns. On every other frame it returns having
 * done nothing. It **draws nothing**, registers no sphere, keeps no state of
 * its own on the object, and plays no sound -- the sound is the sprite's own,
 * `PlayImpactSoundForMaterial`'s `BOMB1_11.WAV` for kind 0x44, which is the
 * last line of `SpawnSpriteEffectFromParams` (`FUN_004073B0`).
 *
 * `[proved]` One shipped spawn, both modes of stage 2: evt `0x12568`, block
 * 27 step 1 op 19, at `(-367.08, -10.67, -1532.01)` with cue 340. The same
 * `spawn_obj` makes the selector-1 carrier at `0x12590`; the camera then plays
 * `cp_st2` path 42 from 205 to 420 (op 21), which passes 340. The script
 * loads `eff_dokan.bin` at op 5 of the same step and frees it at step 2 op 0.
 *
 * The descriptor's tail is **one word long**: the next record starts at
 * `0x12590`, four bytes after this one's tail at `0x1258C`, so `tail+0x04`
 * reads that record's class (51). `L6` -- the bundle carries `tail+0x00` and
 * nothing past it.
 */
import { ActorDespawn } from "../despawn";
import { SpawnSpriteEffect, SpriteEffectKind } from "../effects/sprite";
import { G } from "../globals";
import type { ScriptedSceneryActor } from "../actor";
import type { ClassFrame } from "../registry";
import { vec3 } from "../vec";

/**
 * `PUSH EAX` at `0x00433B3F` with `EAX` zeroed by `XOR EAX, EAX` at
 * `0x00433B2F` -- `SpawnSpriteEffect`'s third argument, the face-camera mode,
 * which lands at `params[10]`. Zero keeps `params[3]` and `params[4]`.
 */
const EFFECT_FACE_NONE = 0;

/** `PUSH -0x1` at `0x00433B31` -- the fourth argument, `params[11]`. */
const EFFECT_NO_PLAYER = -1;

/**
 * `params[3]` and `params[4]` -- the same zeroed `EAX`, stored at
 * `0x00433B33` and `0x00433B37`. `params[5]`, at `0x00433B3B`, is zeroed too
 * and read by nothing.
 */
const EFFECT_PITCH = 0;
const EFFECT_YAW = 0;

/**
 * `ScriptedEffectAtCameraCue33` — `FUN_00433B00`. One frame of the object.
 *
 * ```
 * 00433B03  MOV  ECX, [0x009a6110]          g_cam_path_frame
 * 00433B0E  MOV  EAX, [ESI + 0x1390]        the descriptor tail
 * 00433B14  MOV  EAX, [EAX]                 tail+0x00, the cue
 * 00433B16  CMP  ECX, EAX  / JZ  spawn
 * 00433B1A  CMP  [0x009a6458], EAX / JNZ  return    g_cam_path_frame_2
 * 00433B22  ...  params = {obj+0x40, +0x44, +0x48, 0, 0, 0}
 * 00433B4F  CALL SpawnSpriteEffect(&params, 0x44, 0, -1)
 * 00433B55  CALL ActorDespawn(obj)
 * ```
 *
 * Both compares are **integer** equality on the raw words, so the cue is one
 * frame and not a threshold -- the same shape as `CamCueHit` in
 * `class30/entrance.ts`, and the same two blocks by address. Block 2's frame
 * is always 0 (see `G.g_cam_path_frame_2`), so the second compare is "the cue
 * is 0", which the one shipped spawn's 340 is not. It is transcribed as
 * written.
 *
 * `ActorDespawn` (`FUN_00409CC0`) ends in `ActorKill`, which does not return
 * (`L72`), so nothing of this routine runs after it; there is nothing after it
 * to run.
 */
export function ScriptedEffectAtCameraCue33(obj: ScriptedSceneryActor,
                                            f: ClassFrame): void {
  const t = obj.class33Cue;
  if (!t) return;

  if (G.g_cam_path_frame !== t.cue && G.g_cam_path_frame_2 !== t.cue) return;

  // `PUSH 0x44` at `0x00433B44` -- `SpawnSpriteEffect`'s second argument,
  // which it stores at `params[9]` and `SpawnSpriteEffectFromParams` switches
  // on. The position is the object's own, copied into the block at
  // `0x00433B22`..`0x00433B4B`.
  SpawnSpriteEffect(vec3(obj.pos.x, obj.pos.y, obj.pos.z),
                    EFFECT_PITCH, EFFECT_YAW, SpriteEffectKind.Dokan,
                    EFFECT_FACE_NONE, EFFECT_NO_PLAYER, f.host, f.events);
  ActorDespawn(obj);
}
