/**
 * `[port-only]` The handful of expressions every class-0x14 state repeats
 * inline, spelled once. None of them is an exe function: each is a line or
 * two the engine writes out at every site, and each helper says which.
 */
import type { Events } from "../../core/events";
import type { Actor } from "../actor";
import { ActorSetMotion, ActorSetMotionBlended } from "../class30/motion_cue";
import { MotionPlayLength } from "../tables";
import { Class14Flag, type Boss2Tail } from "./state";
import { Class14AnimMotion } from "./tables";

/** `[port-only]` `char+0x08` — the play cursor the last draw computed. */
export function Class14Cursor(obj: Actor): number {
  return obj.skel?.cursor ?? 0;
}

/** `[port-only]` `char+0x00` — the model block's frame counter. */
export function Class14Counter(obj: Actor): number {
  return obj.skel?.counter ?? 0;
}

/** `[port-only]` `(s16)g_motion_play_length[char+0x20]`. */
export function Class14ClipLength(obj: Actor): number {
  return MotionPlayLength(obj, obj.skel?.motion ?? obj.motion);
}

/**
 * `[port-only]` `state+0x62 = slot; ActorSetMotion(char,
 * *g_class14_anim_slots[slot])`.
 */
export function Class14SetAnim(obj: Actor, t: Boss2Tail, slot: number): void {
  t.animSlot = slot;
  ActorSetMotion(obj, Class14AnimMotion(slot));
}

/**
 * `[port-only]` `state+0x62 = slot; ActorSetMotionBlended(char,
 * *g_class14_anim_slots[slot], start, fade)` -- `start` a play cursor, as the
 * model block takes it.
 */
export function Class14BlendAnim(obj: Actor, t: Boss2Tail, slot: number,
                                 start = 0, fade = 10): void {
  t.animSlot = slot;
  ActorSetMotionBlended(obj, Class14AnimMotion(slot), start, fade);
}

/**
 * `[port-only]` The leap states' last lines, and the knock-down's own copy:
 * `pos += vel; vel.y += g` (`obj+0x4C..+0x54`, `obj+0x5C`), each an `FSTP
 * float`. The leaps put `if ((state->flags & 4) == 0)` in front of it and
 * pass their block; the knock-down integrates unconditionally and passes
 * `null`.
 */
export function Class14Integrate(obj: Actor, t: Boss2Tail | null): void {
  if (t && (t.flags & Class14Flag.NoIntegrate)) return;
  obj.pos.x = Math.fround(obj.vel.x + obj.pos.x);
  obj.pos.y = Math.fround(obj.vel.y + obj.pos.y);
  obj.pos.z = Math.fround(obj.vel.z + obj.pos.z);
  obj.vel.y = Math.fround(obj.accY + obj.vel.y);
}

/** `[port-only]` `PlaySoundId(id)`, raised as an event for the host. */
export function Class14Sound(events: Events | undefined, id: number): void {
  events?.emit("sound.play", { id });
}
