/**
 * The class-0x41 generic types whose update routine is transcribed **whole**
 * — head, hit arms, draw and shot-test tail — and the arms of
 * `PlaceGenericProp`'s switch that seed them.
 *
 * `g_class41_updates` (`0x005936BC`) is what `PlaceGenericProp` hands
 * `ActorAlloc`, and the object calls through it every frame; a row here *is*
 * that entry for its type. The pool's generic arm (`class41/pool.ts`) looks a
 * type up here before anything else and, when it finds one, runs it and
 * nothing more: the routine opens with whatever lifetime rule it really has
 * (the shared `PropExpireByStepLifetime`, an inline variant, or none), masks
 * `obj+0x34` where it masks it, registers its shot sphere where and if it
 * registers one, and records its own draws (`class41/prop_draw.ts`).
 *
 * The older table in `pool.ts`, `GENERIC_UPDATE`, is the other shape: a
 * routine whose *branch arm* alone is ported, run inside a prologue and a tail
 * the pool supplies. A type moves from there to here when the rest of its
 * routine is read.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import type { BreakableProp } from "./prop_state";
import { PropDrawOnlyType5 } from "./type05";
import {
  PlaceGenericPropType10, PlaceGenericPropType6, PropUpdateType6,
} from "./type06";
import { PlaceGenericPropType12, PropDrawOnlyType12 } from "./type12";
import { PropDrawOnlyType21 } from "./type21";
import { PropDrawOnlyType51 } from "./type51";
import { PropUpdateType63 } from "./type63";
import { PropUpdateType78 } from "./type78";

/** One `g_class41_updates` entry, transcribed whole. */
export type GenericRoutine = (p: BreakableProp, rng: Rng,
                              events?: Events) => void;

/**
 * One arm of `PlaceGenericProp`'s switch (`FUN_00461CF0`), run after the
 * prologue the constructor already applies. `[port-only]` as a function: in
 * the engine each is a `case` of the switch, reached through
 * `g_place_generic_prop_arm_index` (`0x00462978`) and
 * `g_place_generic_prop_arms` (`0x004628D4`), and not called.
 */
export type GenericPlaceArm = (p: BreakableProp, pl: BreakablePlacement,
                               rng: Rng) => void;

/** `g_class41_updates[type]`, for the types transcribed whole. */
export const GENERIC_ROUTINES: Partial<Record<number, GenericRoutine>> = {
  5: PropDrawOnlyType5,
  // One routine, two types: `g_class41_updates[6]` and `[10]` are both
  // `0x004668A0`, and only their arms differ.
  6: PropUpdateType6,
  10: PropUpdateType6,
  12: PropDrawOnlyType12,
  21: PropDrawOnlyType21,
  51: PropDrawOnlyType51,
  63: PropUpdateType63,
  78: PropUpdateType78,
};

/** `PlaceGenericProp`'s arm for each of those types that has one. */
export const GENERIC_PLACE_ARMS: Partial<Record<number, GenericPlaceArm>> = {
  6: PlaceGenericPropType6,
  10: PlaceGenericPropType10,
  12: PlaceGenericPropType12,
};
