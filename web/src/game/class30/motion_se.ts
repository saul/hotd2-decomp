/**
 * The footfalls and the swishes: a class-0x30 actor's sounds on exact frames
 * of the clip it is playing.
 */
import type { Events } from "../../core/events";
import type { ZombieActor } from "../actor";
import { MotionPlayFrame } from "../tables";

/** `PUSH 0x2616A9` — `COMMON\ENE_WALK3_16.WAV`. */
export const SE_ENE_WALK3 = 0x2616a9;
/** `PUSH 0x2916A9` — `COMMON\ENE_WALK6_22.WAV`. */
export const SE_ENE_WALK6 = 0x2916a9;
/** `PUSH 0x3C16A9` — `COMMON\SWORD11_22.WAV`. */
export const SE_SWORD11 = 0x3c16a9;
/** `PUSH 0x3D16A9` — `COMMON\SWORD11_22_1.WAV`. */
export const SE_SWORD11_1 = 0x3d16a9;

/**
 * `ZombiePlayMotionFrameSe`'s switch on `obj+0x1B4`: each clip, the play
 * cursors it sounds on, and the sound. Read off the compare chain and the
 * byte-indexed jump table at `0x00452C80`/`0x00452C94` (motions `0xB`,
 * `0xB3`, `0xC3` and `0x108` are its four cases; `0xC3` shares `0x114`'s
 * arm, `0x00452ACE`), and every arm reads `obj+0x19C` against its own
 * immediates.
 */
export const MOTION_FRAME_SE:
    Readonly<Record<number, { frames: readonly number[]; se: number }>> = {
  0x00b: { frames: [0xa, 0x14, 0x1e, 0x1], se: SE_ENE_WALK3 },
  0x0b3: { frames: [0x9, 0x1b], se: SE_ENE_WALK3 },
  0x0c3: { frames: [0x6, 0x24], se: SE_ENE_WALK6 },
  0x108: { frames: [0x7, 0x12], se: SE_ENE_WALK6 },
  0x114: { frames: [0x6, 0x24], se: SE_ENE_WALK6 },
  0x1ae: { frames: [0x6, 0x15], se: SE_ENE_WALK3 },
  0x1c1: { frames: [0x2, 0x1a], se: SE_ENE_WALK6 },
  0x1c3: { frames: [0x1e], se: SE_SWORD11 },
  0x1c4: { frames: [0x11, 0x32], se: SE_SWORD11_1 },
  0x2b5: { frames: [0x4, 0x14], se: SE_ENE_WALK3 },
  0x307: { frames: [0x28], se: SE_SWORD11 },
  0x30a: { frames: [0x28], se: SE_SWORD11 },
  0x310: { frames: [0x8, 0x1b], se: SE_ENE_WALK6 },
  0x3b0: { frames: [0x8, 0x20], se: SE_ENE_WALK3 },
  0x3b1: { frames: [0x2, 0x1a], se: SE_ENE_WALK3 },
  0x3c8: { frames: [0x6, 0x25], se: SE_ENE_WALK3 },
};

/**
 * `ZombiePlayMotionFrameSe` — `FUN_00452A10`. `EnemyZombieUpdate`'s last
 * call (`0x00453494`), after the draw and after `g_class30_states[0x36]`,
 * and skipped while {@link Zombie1368Flag.InWater} is up.
 *
 * ```
 * m = obj+0x1B4;  c = obj+0x19C
 * hit, id = <the arm for m>             ; no arm: return
 * if (hit && id != 0 && (s16)obj+0x1314 != c) {     ; 0x00452C51
 *     PlaySoundId(id);  obj+0x1314 = (s16)obj+0x19C
 * }
 * ```
 *
 * `[proved]` from the disassembly. The latch at `obj+0x1314` is the last
 * cursor that sounded and nothing else reads or writes it (every `[reg +
 * 0x1314]` operand in the image, and the allocation zeroes it), so it is
 * **never cleared**: a clip whose one cue is the cursor that last sounded --
 * `0x1C3`'s 30, `0x307`'s 40 -- sounds once and is silent on every later
 * pass until another cue has moved the latch. The walks, with two or four
 * cues a loop, move it themselves.
 *
 * `obj+0x1B4` and `obj+0x19C` are the engine's one track. The port keeps a
 * swing on the one-shot channel, `obj.action`, which **is** that track while
 * it runs -- the same reading `ZombieStrikeFrameSplash` makes -- and the base
 * track's cursor otherwise. This runs after the port's clocks have stepped,
 * which is where the engine's post-draw call reads the cursor its draw just
 * computed (`L62`).
 */
export function ZombiePlayMotionFrameSe(obj: ZombieActor, events?: Events): void {
  const motion = obj.action ? obj.action.motion : obj.motion;
  const arm = MOTION_FRAME_SE[motion];
  if (!arm) return;
  const cursor = obj.action ? obj.action.ticks : MotionPlayFrame(obj);
  if (!arm.frames.includes(cursor)) return;
  // `MOVSX ECX, word ptr [ESI + 0x1314]` / `CMP ECX, EAX` at `0x00452C59`.
  if (obj.zom.seFrame === cursor) return;
  events?.emit("sound.play", { id: arm.se });
  // `MOV DX, word ptr [ESI + 0x19C]` / `MOV word ptr [ESI + 0x1314], DX`.
  obj.zom.seFrame = (cursor << 16) >> 16;
}
