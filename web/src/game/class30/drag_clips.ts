/**
 * `ZombieStateDragTarget`'s (`FUN_0045C080`) four clips — class 0x30 state
 * 43, the captor glued to its civilian.
 *
 * Data only, and imported by the exporter for the clip list: the
 * `class53/records.ts` arrangement, so the state and the bundle read one
 * copy. Each is an immediate in the routine:
 *
 * ```
 * 0045c0c4  PUSH 0x1a4                    ; sub 0: the drag
 * 0045c184  PUSH 0x1a8                    ; sub 1, the cue: the kill
 * 0045c1f6  PUSH 0x1aa                    ; sub 1, already dead: the aftermath
 * 0045c24c  MOV dword ptr [EDI + 0x20], 0x1b0   ; sub 2 at cursor 0x2D: the settle
 * ```
 *
 * **An unbaked clip here is a captor standing in its civilian.** The state
 * writes the civilian's position and rotation onto the captor every frame,
 * and it is the drag clip's pose that puts the body on her back. Stage 4's
 * `0x35B4` reached the bundle with `0x1B0` (another state names it) and not
 * the other three, so `ActorSetMotionBlended(0x1A4)` found no clip, the
 * spawn clip `0x3BC` stayed on, and it stood upright inside her.
 */

/** The drag, sub 0's `PUSH 0x1A4` at `0x0045C0C4`. */
export const DRAG_MOTION = 0x1a4;
/** The kill on the header's cue frame, sub 1's `PUSH 0x1A8` at `0x0045C184`. */
export const DRAG_KILL_MOTION = 0x1a8;
/** The civilian already dead at the cue, `PUSH 0x1AA` at `0x0045C1F6`. */
export const DRAG_LATE_MOTION = 0x1aa;
/**
 * Sub 2's settle: at cursor `0x2D` it blends to `0x1B0` over ten frames
 * (`0x0045C24C`).
 */
export const DRAG_SETTLE_MOTION = 0x1b0;

/** Every clip state 43 can put on its actor, for the exporter to bake. */
export const DRAG_TARGET_CLIPS: readonly number[] = [
  DRAG_MOTION, DRAG_KILL_MOTION, DRAG_LATE_MOTION, DRAG_SETTLE_MOTION,
];
