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
 * Every generic type has a row now. The pool's older shape -- a routine whose
 * *branch arm* alone was ported, run inside a prologue and a tail the pool
 * supplied -- is left only for the chain links, which are not built by
 * `PlaceGenericProp`.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import type { BreakableProp } from "./prop_state";
import { PropDrawOnlyType5 } from "./type05";
import {
  PlaceGenericPropType10, PlaceGenericPropType6, PropUpdateType6,
} from "./type06";
import { PlaceGenericPropType7, PropUpdateType7 } from "./type07";
import { PlaceGenericPropType8, PropUpdateType8 } from "./type08";
import { PlaceGenericPropType9, PropUpdateType9 } from "./type09";
import { PlaceGenericPropType11, PropUpdateType11 } from "./type11";
import { PlaceGenericPropType12, PropDrawOnlyType12 } from "./type12";
import { PlaceGenericPropType13 } from "./type13";
import { PlaceGenericPropType14, PropUpdateType14 } from "./type14";
import { PlaceGenericPropType18, PropUpdateType18 } from "./type18";
import { PlaceGenericPropType19, PropUpdateType19 } from "./type19";
import { PlaceGenericPropType20, PropUpdateType20 } from "./type20";
import { PropDrawOnlyType21 } from "./type21";
import { PlaceGenericPropType25, PropUpdateType25 } from "./type25";
import { PlaceGenericPropType27, PropKillOnBranchOneUpdate } from "./type27";
import { PlaceGenericPropType28, PropUpdateType28 } from "./type28";
import { PropUpdateType30 } from "./type30";
import {
  PlaceGenericPropType31, PlaceGenericPropType33, PlaceGenericPropType53,
  PlaceGenericPropType54, PropDrawOnlyType31,
} from "./draw_only";
import { PropUpdateType35 } from "./type35";
import { PlaceGenericPropType36, PropUpdateType36 } from "./type36";
import { PlaceGenericPropType41, PropUpdateType41 } from "./type41";
import { PropUpdateType45 } from "./type45";
import { PlaceGenericPropType49, PropUpdateType49 } from "./type49";
import { PropDrawOnlyType51 } from "./type51";
import { PlaceGenericPropType56, PropUpdateType56 } from "./type56";
import { PlaceGenericPropType57, PropUpdateType57 } from "./type57";
import { PlaceGenericPropType58, PropUpdateType58 } from "./type58";
import { PlaceGenericPropType59, PropUpdateType59 } from "./type59";
import { PlaceGenericPropType60, PropUpdateType60 } from "./type60";
import { PlaceGenericPropType62, PropUpdateType62 } from "./type62";
import { PropUpdateType63 } from "./type63";
import { PlaceGenericPropType64, PropUpdateType64 } from "./type64";
import { PlaceGenericPropType67, PropUpdateType67 } from "./type67";
import { PlaceGenericPropType69, PropUpdateType69 } from "./type69";
import {
  OriginalItemPropUpdate, PlaceGenericPropType70, PlaceGenericPropType71,
} from "./original_item";
import { PlaceGenericPropType72, PropUpdateType72 } from "./type72";
import { PlaceGenericPropType73, PropUpdateType73 } from "./type73";
import { PlaceGenericPropType74, PropUpdateType74 } from "./type74";
import { PropUpdateType75 } from "./flag_prop";
import { PlaceGenericPropType76, PropUpdateType76 } from "./type76";
import { PropUpdateType77 } from "./type77";
import { PropUpdateType78 } from "./type78";
import {
  EXTRA_LIFE_ROUTINE_TYPE, ExtraLifePickupUpdate, SCORE_PICKUP_ROUTINE_TYPE,
  ScorePickupUpdate,
} from "./items";
import { PlaceGenericPropType34 } from "../class44/container";

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
  7: PropUpdateType7,
  8: PropUpdateType8,
  9: PropUpdateType9,
  10: PropUpdateType6,
  11: PropUpdateType11,
  12: PropDrawOnlyType12,
  14: PropUpdateType14,
  18: PropUpdateType18,
  19: PropUpdateType19,
  20: PropUpdateType20,
  21: PropDrawOnlyType21,
  25: PropUpdateType25,
  27: PropKillOnBranchOneUpdate,
  28: PropUpdateType28,
  30: PropUpdateType30,
  31: PropDrawOnlyType31,
  35: PropUpdateType35,
  36: PropUpdateType36,
  41: PropUpdateType41,
  45: PropUpdateType45,
  49: PropUpdateType49,
  51: PropDrawOnlyType51,
  56: PropUpdateType56,
  57: PropUpdateType57,
  58: PropUpdateType58,
  59: PropUpdateType59,
  60: PropUpdateType60,
  62: PropUpdateType62,
  63: PropUpdateType63,
  64: PropUpdateType64,
  67: PropUpdateType67,
  69: PropUpdateType69,
  // One routine, two types: `g_class41_updates[70]` and `[71]` are both
  // `0x004675A0`, and bit `0x200000` of `obj+0x34`, which 71's arm sets, is
  // what makes it bob.
  70: OriginalItemPropUpdate,
  71: OriginalItemPropUpdate,
  72: PropUpdateType72,
  73: PropUpdateType73,
  74: PropUpdateType74,
  75: PropUpdateType75,
  76: PropUpdateType76,
  77: PropUpdateType77,
  78: PropUpdateType78,
  // The extra life: `ActorAlloc`'d by `SpawnExtraLifePickup` with its routine
  // and no table slot, so a number of the port's own.
  [EXTRA_LIFE_ROUTINE_TYPE]: ExtraLifePickupUpdate,
  // ...and the score pickup, `ActorAlloc`'d by `SpawnScorePickup` the same way.
  [SCORE_PICKUP_ROUTINE_TYPE]: ScorePickupUpdate,
};

/**
 * `PlaceGenericProp`'s arm for each type that has one and whose routine is
 * transcribed — including 13, 33, 53 and 54, whose objects run as families
 * of their own but are built by this constructor all the same. Types 11 and
 * 60 share the arm at `0x004624C4` and so do 7 and 73 (`0x00462874`); each
 * type's file writes it out for its own type.
 */
export const GENERIC_PLACE_ARMS: Partial<Record<number, GenericPlaceArm>> = {
  6: PlaceGenericPropType6,
  7: PlaceGenericPropType7,
  8: PlaceGenericPropType8,
  9: PlaceGenericPropType9,
  10: PlaceGenericPropType10,
  11: PlaceGenericPropType11,
  12: PlaceGenericPropType12,
  13: PlaceGenericPropType13,
  14: PlaceGenericPropType14,
  18: PlaceGenericPropType18,
  19: PlaceGenericPropType19,
  20: PlaceGenericPropType20,
  25: PlaceGenericPropType25,
  27: PlaceGenericPropType27,
  28: PlaceGenericPropType28,
  31: PlaceGenericPropType31,
  33: PlaceGenericPropType33,
  34: PlaceGenericPropType34,
  36: PlaceGenericPropType36,
  41: PlaceGenericPropType41,
  49: PlaceGenericPropType49,
  53: PlaceGenericPropType53,
  54: PlaceGenericPropType54,
  56: PlaceGenericPropType56,
  57: PlaceGenericPropType57,
  58: PlaceGenericPropType58,
  59: PlaceGenericPropType59,
  60: PlaceGenericPropType60,
  62: PlaceGenericPropType62,
  64: PlaceGenericPropType64,
  67: PlaceGenericPropType67,
  69: PlaceGenericPropType69,
  70: PlaceGenericPropType70,
  71: PlaceGenericPropType71,
  72: PlaceGenericPropType72,
  73: PlaceGenericPropType73,
  74: PlaceGenericPropType74,
  76: PlaceGenericPropType76,
};
