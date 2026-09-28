/**
 * Class 0x41 type 74 — three shots, and it drops an Original Mode item.
 *
 * One shipped spawn: stage 4 (scene 3) at evt `0x36BC`, placed at
 * `(-288.57, -10.53, -301.77)` with a three-step lifetime, drawing
 * `0xA64`. It takes three shots — `PlaceGenericProp` case 0x4A seeds
 * `obj+0x199` with 3 — and on the third it hands out a story-mode item at a
 * fixed point beside it, clears `g_original_item_pickup_blocked`, and falls
 * away, tipping forward a quarter turn, until its lifetime runs out. It has
 * no floor.
 *
 * ## The flag it raises, which is the Arcade exit
 *
 * It is **not** a plain Original-Mode-only type. Its head is
 * `if (g_GameMode != 1) { g_script_flags[0x13] = 1; ActorDespawn(); }` at
 * `0x004710AA` — the same shape as type 75's raise-then-leave — and in block 5
 * with `g_script_flags[0x15]` up it raises flag 0x13 itself: at once while it
 * stands, and fifty frames after it drops its item once it has. Flag 0x13 is
 * what `OriginalItemPropUpdate` routes scene 2 block 4 on. No shipped script
 * waits on it, and stage 4's own block 5 raises it at step 0 (evt `0x3AD8`),
 * so in the shipped game these writes repeat one the script has made.
 *
 * The lifetime is charged **before** the mode test, so a prop whose lifetime
 * has run out leaves without raising anything.
 *
 * Read from the disassembly of `0x00470E20`..`0x004710BF`; `PlaySoundId` is
 * marked no-return in the database, so the pseudocode stops at the shot
 * sound (`L35`).
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { SpawnPropHitEffectScaled } from "../effects/sprite";
import { G } from "../globals";
import { GameMode } from "../game_mode";
import { SpawnStoryModeItem } from "./items";
import { ActorDespawnProp, BreakablePropAwardHit } from "./prop";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush, PropMatrixTRzRyRx }
  from "./prop_draw";
import { BreakableFlag, type BreakableProp } from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";
import { PropWords } from "./words";

/** `obj+0x192` as `PropUpdateType74` reads it. */
export enum Type74Phase {
  /** Standing, and taking shots. */
  Standing = 0,
  /** It has dropped its item and is falling. Shots do nothing. */
  Dropped = 1,
}

/** `PUSH 0xA64` — what it draws, `T(pos) Rz Ry Rx`. */
export const TYPE74_SLOT = 0x0a64;
/** `MOV byte ptr [0x009C7213], 0x1` — `g_script_flags[0x13]`. */
export const TYPE74_SCRIPT_FLAG = 0x13;
/** `MOV AL, [0x009C7215]` — `g_script_flags[0x15]`, the block-5 gate. */
export const TYPE74_GATE_FLAG = 0x15;
/** `CMP word ptr [0x009A2BC0], 0x5`. */
export const TYPE74_GATE_BLOCK = 5;
/** `CMP EAX, 0x32; JLE` — frames after the drop before it raises the flag. */
export const TYPE74_RAISE_AFTER = 0x32;
/** `MOV byte ptr [ESI + 0x199], 0x3` in `PlaceGenericProp` case 0x4A. */
export const TYPE74_SHOTS = 3;
/** `PUSH 0x3FC00000` — the impact effect's scale. */
export const TYPE74_HIT_EFFECT_SCALE = 1.5;
/** `PlaySoundId(0xE16A9)` — each shot. */
export const SFX_TYPE74_HIT = 0xe16a9;
/** `obj+0x2A0 = 2` — the story item kind it drops. */
export const TYPE74_STORY_ITEM = 2;
/**
 * `0x00470F5C`..`0x00470F70`: the point the item is dropped at, written over
 * the prop's own position around `SpawnStoryModeItem` and put back straight
 * after. Raw words `0xC38F4CCD`, `0xC18A6666`, `0xC3974000`.
 */
export const TYPE74_DROP_AT: readonly [number, number, number] =
  [-286.6000061035156, -17.299999237060547, -302.5];
/** `MOV dword ptr [ESI + 0x1C4], 0xBDCCCCCD` — the fall's first step. */
export const TYPE74_DROP_VY = -0.10000000149011612;
/** `FSUB float ptr [0x00569098]` — gravity, `0x3D5EFC7A`. */
export const TYPE74_GRAVITY = 0.05443999916315079;
/** `CMP EAX, 0x4000; JGE` / `ADD EAX, 0x200` — the tip, and its limit. */
export const TYPE74_TIP_LIMIT = 0x4000;
export const TYPE74_TIP_STEP = 0x200;
/**
 * The shot point: `FLD [ESI+0x124]; FMUL [0x004C43AC] (0.5); FADD [y];
 * FSUB [0x004E30F0] (2.0)` — half its radius above its origin, less 2.
 */
export const TYPE74_SHOT_RADIUS_SCALE = 0.5;
export const TYPE74_SHOT_DROP = 2.0;

/** The two player bits `AND ECX, 0xFFFFFFF9` clears at the tail. */
const PLAYER_HIT_BITS = BreakableFlag.HitByPlayer0 | BreakableFlag.HitByPlayer1;

/**
 * The one word of the 0x378 object this routine keeps that no shared field
 * carries. See `class41/words.ts`.
 */
interface Type74Words {
  /**
   * `obj+0x199` (s8) — the shots it takes before it drops its item. The
   * group props keep their lifetime in this byte; this family keeps its in
   * `+0x11C` (`L3`).
   */
  o199: number;
}
const TYPE74_WORDS_ZERO: Type74Words = { o199: 0 };

/**
 * `PlaceGenericProp` case 0x4A, `0x00462883`: the 9.0 radius (which is in
 * `generic.ts`'s table) and `MOV byte ptr [ESI+0x199], 0x3`.
 *
 * `[port-only]` as a *function*: an arm of the switch, reached through
 * `GENERIC_PLACE_ARMS` (`class41/generic_routines.ts`).
 */
export function PlaceGenericPropType74(p: BreakableProp,
                                       _pl: BreakablePlacement,
                                       _rng: Rng): void {
  PropWords(p, TYPE74_WORDS_ZERO).o199 = TYPE74_SHOTS;
}

/**
 * `PropUpdateType74` — `FUN_00470E20`. One prop, one 60 Hz frame.
 *
 * `+0x199` is its own word, `+0x2A4` {@link BreakableProp.removeFlag}
 * (frames since the drop, in block 5),
 * `+0x1C4` {@link BreakableProp.vy} and `+0x192`
 * {@link BreakableProp.routinePhase}.
 */
export function PropUpdateType74(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  PropDrawBegin(p);
  // The inline lifetime, without the scene-1 sweep, and ahead of the mode.
  if (G.g_evt_step_index !== p.lastStepIndex) {
    p.stepsElapsed += 1;
    if (p.stepsElapsed > p.lifetime) {
      ActorDespawnProp(p);
      return;
    }
    p.lastStepIndex = G.g_evt_step_index;
  }
  if (G.g_GameMode !== GameMode.Original) {
    G.g_script_flags[TYPE74_SCRIPT_FLAG] = 1;
    ActorDespawnProp(p);
    return;
  }
  const gate = G.g_evt_block_index === TYPE74_GATE_BLOCK
    && (G.g_script_flags[TYPE74_GATE_FLAG] ?? 0) !== 0;
  if (p.routinePhase === Type74Phase.Dropped) {
    if (gate) {
      p.removeFlag += 1;
      if (p.removeFlag > TYPE74_RAISE_AFTER) {
        G.g_script_flags[TYPE74_SCRIPT_FLAG] = 1;
      }
      // `CMP g_GameMode, EDI / JNZ 0x00470FA8` -- dead: the head has already
      // returned for every mode but 1.
    }
  } else if (p.routinePhase === Type74Phase.Standing && gate) {
    G.g_script_flags[TYPE74_SCRIPT_FLAG] = 1;
  }

  if ((p.flags & BreakableFlag.Hit) !== 0
      && p.routinePhase === Type74Phase.Standing) {
    p.flags &= ~BreakableFlag.Hit;
    BreakablePropAwardHit(p.flags, false, rng);
    // `SpawnPropHitEffectScaled(obj, (flags & 2) ? 0 : 1, 1.5f)` -- at the
    // aim `combat/shot.ts` left on the prop, at the prop's depth.
    if (p.hitAim) {
      SpawnPropHitEffectScaled(p.hitAim.x, p.hitAim.y, p.z,
                               TYPE74_HIT_EFFECT_SCALE);
    }
    events?.emit("sound.play", { id: SFX_TYPE74_HIT });
    // `DEC CL; MOV [ESI+0x199], CL; TEST AL, AL; JG` -- a signed byte.
    const w = PropWords(p, TYPE74_WORDS_ZERO);
    w.o199 = ((w.o199 - 1) << 24) >> 24;
    if (w.o199 <= 0) {
      p.storyItem = TYPE74_STORY_ITEM;
      const [x, y, z] = [p.x, p.y, p.z];
      [p.x, p.y, p.z] = TYPE74_DROP_AT;
      SpawnStoryModeItem(p, rng, events);
      G.g_original_item_pickup_blocked = 0;
      [p.x, p.y, p.z] = [x, y, z];
      p.routinePhase = Type74Phase.Dropped;
      p.vy = TYPE74_DROP_VY;
    }
  }

  p.flags &= ~PLAYER_HIT_BITS;
  if (p.routinePhase === Type74Phase.Dropped) {
    // `FLD [vy]; FSUB [g]; FST [vy]; FADD [y]; FSTP [y]`.
    const v = p.vy - TYPE74_GRAVITY;
    p.vy = Math.fround(v);
    p.y = Math.fround(v + p.y);
    if (p.pitch < TYPE74_TIP_LIMIT) p.pitch += TYPE74_TIP_STEP;
  }
  const m = PropMatrixPush();
  PropMatrixTRzRyRx(m, p.x, p.y, p.z, p.pitch, p.yaw, p.roll);
  PropDrawSlot(p, m, TYPE74_SLOT);
  PropRegisterForShotTest(
    p, p.x,
    Math.fround(p.hitRadius * TYPE74_SHOT_RADIUS_SCALE + p.y
                - TYPE74_SHOT_DROP),
    p.z);
}
