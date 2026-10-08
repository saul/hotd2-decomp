/**
 * Class 0x33 sub-handler **3** — one sprite, thrown on the object's first
 * update, and gone.
 *
 * ```
 * ScriptedEffectOnFirstFrame33   FUN_00433AC0   the whole of it
 * ```
 *
 * `ScriptedSceneryDispatch33` (`FUN_00432FF0`) installs it from entry 2 of
 * the jump table at `0x004330C4`: `0x00433035`, `PUSH EAX` / `MOV dword ptr
 * [EAX], 0x433ac0` / `CALL 0x00409270`. That arm is the only reference to
 * `0x00433AC0` in the image -- the little-endian word is at `0x00433038` and
 * nowhere else, and no `CALL` or `JMP` targets it -- so no other class
 * installs it.
 *
 * ## What it is
 *
 * The routine is fifteen instructions, `0x00433AC0`..`0x00433AFA`, with no
 * branch: it copies the object's position into a parameter block, throws one
 * sprite of kind 0x62 -- {@link SpriteEffectKind.SplashLarge}, slots
 * `0x1339..0x1356` (`common.bin` 307..336) at base scale 1.5, the switch's
 * `case 0x62:` -- facing the camera, and despawns. It reads **no descriptor
 * tail**, no camera frame and no flag, so it goes off on the first frame it
 * runs, whatever that frame is. It draws nothing itself and plays nothing
 * itself: the sound is the sprite's own, `PlayImpactSoundForMaterial`'s
 * `BOMB2_16`, the last line of `SpawnSpriteEffectFromParams` (`FUN_004073B0`).
 * `[proved]`
 *
 * The records are tail-less too: each shipped selector-3 descriptor is `0x24`
 * bytes, and the next record starts at `desc+0x24` -- stage 2's `0x5574` is
 * followed by `0x5598`, another selector 3, and that by `0x55BC`, a class
 * 0x25. Fourteen spawns over both modes: stage 1's `0x37E8` (block 4 step 1
 * op 21), stage 2's `0x5574` and `0x5598` (block 9 step 5, ops 10, 13 and 23)
 * and `0xA4D0` and `0xA4F4` (block 16 step 7, ops 10, 13 and 22). What the
 * splash run depicts here is the render's, not a reading: it is the strip
 * the bat, the owl and the fish splash with.
 */
import { ActorDespawn } from "../despawn";
import { SpawnSpriteEffect, SpriteEffectKind } from "../effects/sprite";
import type { ScriptedSceneryActor } from "../actor";
import type { ClassFrame } from "../registry";
import { vec3 } from "../vec";

/**
 * `PUSH 0x1` at `0x00433ACA` -- `SpawnSpriteEffect`'s third argument, the
 * face-camera mode, which lands at `params[10]`. Not zero and not 2, so
 * `SpawnSpriteEffectFromParams` aims both `params[3]` and `params[4]` back
 * along the line to the camera block's eye.
 */
const EFFECT_FACE_CAMERA = 1;

/** `PUSH -0x1` at `0x00433AC8` -- the fourth argument, `params[11]`. */
const EFFECT_NO_PLAYER = -1;

/**
 * `params[3]` and `params[4]`, which the routine **never writes**: its block
 * is the six words `SUB ESP, 0x18` makes, `SpawnSpriteEffect` copies all six,
 * and only the first three are stored (`0x00433AD5`, `0x00433AE0`,
 * `0x00433AE4`). The face
 * mode above overwrites both before either is read (`0x004073B0`'s
 * `VecToAngles` into `param_1 + 3` and `param_1 + 4`), so what the stack held
 * never reaches the effect, and zero stands for it here.
 */
const EFFECT_PITCH_UNREAD = 0;
const EFFECT_YAW_UNREAD = 0;

/**
 * `ScriptedEffectOnFirstFrame33` — `FUN_00433AC0`. The object's one frame.
 *
 * ```
 * 00433AC4  MOV  ESI, [ESP + 0x20]            obj
 * 00433AC8  PUSH -0x1 ; PUSH 0x1
 * 00433ACC  MOV  EAX/ECX/EDX, [ESI + 0x40/0x44/0x48]
 * 00433AD5  params[0..2] = obj+0x40..0x48
 * 00433ADD  PUSH 0x62 ; PUSH &params
 * 00433AE8  CALL SpawnSpriteEffect
 * 00433AEE  CALL ActorDespawn(obj)
 * ```
 *
 * `ActorDespawn` (`FUN_00409CC0`) ends in `ActorKill`, which does not return
 * (`L72`); there is nothing after it to run.
 */
export function ScriptedEffectOnFirstFrame33(obj: ScriptedSceneryActor,
                                             f: ClassFrame): void {
  SpawnSpriteEffect(vec3(obj.pos.x, obj.pos.y, obj.pos.z),
                    EFFECT_PITCH_UNREAD, EFFECT_YAW_UNREAD,
                    SpriteEffectKind.SplashLarge, EFFECT_FACE_CAMERA,
                    EFFECT_NO_PLAYER, f.host, f.events);
  ActorDespawn(obj);
}
