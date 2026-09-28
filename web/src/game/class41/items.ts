/**
 * What comes out of a broken container.
 *
 * This is the payoff of the whole class. `BreakablePropUpdate` decrements
 * `g_item_set_countdown` for the set the prop belongs to, and when that
 * reaches zero it switches on the set id — three arms, three different things
 * to release. The countdown was seeded with `rand() % n + 1`, so it is a
 * *random* one of the set's props that pays out, not the last.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { G } from "../globals";
import { COLLECTIBLE_WORDS_ZERO, PickOriginalModeItem } from "./original_item";
import { PropWords } from "./words";
import {
  BreakableState, ItemSet, makeBreakableProp, PropFamily, type BreakableProp,
} from "./prop_state";

/**
 * The character type `SpawnGoldenFrog` gives its actor. All eighteen of its
 * skeleton slots resolve to `frog_gold.bin`, which is what names it.
 */
export const GOLDEN_FROG_CHAR_TYPE = 0x1c;

/** How far above the prop the extra life is released. */
export const EXTRA_LIFE_RISE = 1.0;

/** `PlaySoundId` id for taking the extra life. */
export const SFX_EXTRA_LIFE = 0x3616a9;

/** Score for a pickup taken while the player is already at the life cap. */
export const EXTRA_LIFE_CAP_SCORE = 300;

/**
 * `g_max_lives` — the cap `GrantExtraLife` tests against. `[open]` as an
 * address: the exe reads `DAT_009A2440` in modes other than 1 and a per-player
 * `0x009A2245 + p*0x14` in mode 1, and neither is in `globals.tsv` yet. The
 * port carries the value the player starts a credit with.
 */
export const DEFAULT_MAX_LIVES = 5;

/**
 * `GrantExtraLife` — `FUN_00415630`.
 *
 * One more life, unless the player already has the cap's worth — in which case
 * the item pays 300 points instead, so it is never simply wasted.
 */
export function GrantExtraLife(player: number): boolean {
  const lives = G.g_player_lives[player] ?? 0;
  if (lives >= DEFAULT_MAX_LIVES) {
    G.g_player_score[player] = (G.g_player_score[player] ?? 0)
      + EXTRA_LIFE_CAP_SCORE;
    return false;
  }
  G.g_player_lives[player] = lives + 1;
  return true;
}

/**
 * `SpawnExtraLifePickup` — `FUN_00471BD0`. Item set 1: the extra life, placed
 * one unit above the prop and turned to face the camera.
 *
 * [diverges] The pickup is released as an event rather than as a second pool.
 * `ExtraLifePickupUpdate` (`FUN_00471CC0`) is a shootable object with its own
 * fade-out, and porting it means a second object type with no reader yet; what
 * `game/` owes the rest of the port is *that the item came out, and which*.
 */
export function SpawnExtraLifePickup(p: BreakableProp, events?: Events): void {
  events?.emit("item.released", {
    set: ItemSet.ExtraLife, from: p.id,
    x: p.x, y: p.y + EXTRA_LIFE_RISE, z: p.z, sound: SFX_EXTRA_LIFE,
  });
}

/**
 * `SpawnGoldenFrog` — `FUN_004722A0`. Item set 3: a full 0x13F4 actor of
 * character type 0x1C, placed at the prop and turned to face the camera.
 *
 * [diverges] Released as an event, for the same reason as the extra life —
 * and this one is a whole scripted actor with its own bytecode.
 */
export function SpawnGoldenFrog(p: BreakableProp, events?: Events): void {
  events?.emit("item.released", {
    set: ItemSet.GoldenFrog, from: p.id, charType: GOLDEN_FROG_CHAR_TYPE,
    x: p.x, y: p.y, z: p.z,
  });
}

/**
 * `SpawnScorePickup` — `FUN_004723F0`. Item sets 2 and 5..8: the generic score
 * pickup, with the set id carried through as its kind. Its model and its
 * release height come from `g_item_pickup_slot` / `g_item_pickup_y_offset`,
 * and `ScorePickupUpdate` pays `g_item_score_table[kind]` when it is shot.
 *
 * [diverges] Released as an event; the pickup's own object is not ported.
 */
export function SpawnScorePickup(p: BreakableProp, kind: number,
                                 events?: Events): void {
  events?.emit("item.released", {
    set: kind, from: p.id, x: p.x, y: p.y, z: p.z,
  });
}

/**
 * `SpawnStoryModeItem` — `FUN_00467B90`. Taken while `g_GameMode` is 1 by a
 * prop whose own `+0x2A0` names a row of the scene's Original Mode item
 * table, *instead of* its item set's release; types 74 and 75 call it with
 * rows 2 and 1 of their own. Three shipped group members carry one: group 0's
 * member 0 and group 7's members 3 and 4.
 *
 * **The item is a collectible**, the same object class 0x41 types 70 and 71
 * are:
 *
 * ```c
 * q = ActorAlloc(OriginalItemPropUpdate, 0x378);  ActorClearGameFields(q);
 * q+0x34 = 0x80000001;  q+0x194 = (s8)p+0x2A0;  q+0x19C..0x1A4 = p's;
 * q+0x1D0 = (s16)ftol(atan2(x - eye.x, z - eye.z) * 32768/pi) + 0x8000;
 * q+0x197 = p+0x197;  q+0x196 = p+0x196;  q+0x11C = p+0x11C;  q+0x124 = 3.0;
 * PickOriginalModeItem(q, q+0x194);  g_original_item_banner_count = 0;
 * ```
 *
 * It inherits the prop's step counters and its `+0x11C`, so it ages on the
 * prop's clock from where the prop was. `ActorAlloc` appends it to the task
 * list the prop is on, so it runs on the frame it is made. Its routine is
 * `g_class41_updates[70]`'s, so the port files it as a generic prop of that
 * type and the pool's generic arm runs it through the same row
 * (`class41/generic_routines.ts`); its flags word has no bit `0x200000`, so
 * it turns rather than bobs.
 *
 * The `item.released` event is the port's own notice for its feed; the
 * engine has no counterpart and the game reads nothing from it.
 */
export function SpawnStoryModeItem(p: BreakableProp, rng: Rng,
                                   events?: Events): void {
  const q = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  q.family = PropFamily.Generic;
  q.kind = STORY_ITEM_ROUTINE_TYPE;
  q.flags = STORY_ITEM_FLAGS;
  q.state = BreakableState.Standing;
  // `ActorClearGameFields` zeroes the pickup strip's frame and base.
  q.storyItem = 0;
  q.removeFlag = 0;
  const w = PropWords(q, COLLECTIBLE_WORDS_ZERO);
  w.o194 = (p.storyItem << 24) >> 24;
  q.x = p.x;
  q.y = p.y;
  q.z = p.z;
  // `FPATAN; FMUL g_rad_to_bams; __ftol; MOVSX; ADD 0x8000`, off the camera
  // block's eye -- `g_camera_index` is 0 in every shipped write.
  const b = Math.trunc(Math.atan2(p.x - G.g_camera_block_eye.x,
                                  p.z - G.g_camera_block_eye.z)
                       * STORY_ITEM_RAD_TO_BAMS);
  q.yaw = ((b << 16) >> 16) + 0x8000;
  q.stepsElapsed = p.stepsElapsed;
  q.lastStepIndex = p.lastStepIndex;
  q.lifetime = PropWord11C(p);
  q.hitRadius = STORY_ITEM_RADIUS;
  PickOriginalModeItem(q, w.o194, rng);
  G.g_original_item_banner_count = 0;
  G.g_breakable_props.push(q);
  events?.emit("item.released", {
    set: -1, kind: p.storyItem, from: p.id, x: p.x, y: p.y, z: p.z,
  });
}

/**
 * `PUSH 0x004675A0` into `ActorAlloc` — `OriginalItemPropUpdate`, which is
 * `g_class41_updates[70]`. `[port-only]` as a type number: the engine's
 * object carries the routine and not a type.
 */
const STORY_ITEM_ROUTINE_TYPE = 70;
/** `MOV dword ptr [EAX + 0x34], 0x80000001` — live, and bit 31. */
const STORY_ITEM_FLAGS = 0x80000001;
/** `MOV dword ptr [EAX + 0x124], 0x40400000` — a collectible's 3.0. */
const STORY_ITEM_RADIUS = 3.0;
/** `g_rad_to_bams` — `0x004C4378`, the double `32768/pi`. */
const STORY_ITEM_RAD_TO_BAMS = 32768 / Math.PI;

/**
 * `obj+0x11C` of a prop, whichever port field holds it.
 *
 * `[port-only]` — the engine reads one word; the port keeps that word in
 * `hp` for the families whose routines count shots in it (the group props
 * and the falling container) and in `lifetime` for the ones that count steps
 * against it (the kinded and generic props). The question is the engine's,
 * the answer is where the port put it (`L3`).
 */
function PropWord11C(p: BreakableProp): number {
  return p.family === PropFamily.Group || p.family === PropFamily.Falling
    ? p.hp : p.lifetime;
}

/**
 * Which of the engine's three copies of the release switch a destroy path is
 * running. They are identical in the set arms but for the height the item is
 * released at, and **not** in the story arm, which is why the port has to
 * know: each copy writes `g_original_item_pickup_blocked` (`0x007DCD14`)
 * its own way.
 */
export enum HiddenItemCopy {
  /** `BreakablePropUpdate` (`FUN_00464620`), `0x00464B41`..`0x00464B8B`. */
  Group = 0,
  /** `KindedPropUpdate` (`FUN_00465FB0`), `0x00466158`..`0x004661F4`. */
  Kinded = 1,
  /** `FallingContainerUpdate` (`FUN_0046A580`), `0x0046A9BB`..`0x0046AA6E`. */
  Falling = 2,
}

/** `CMP [0x009A1A08], BX` with `BX = 2`, and `CMP [0x009A2BC0], 4`. */
const KINDED_STORY_BLOCK_SCENE = 2;
const KINDED_STORY_BLOCK_BLOCK = 4;

/**
 * The tail of the destroy path: count this break against the prop's item set
 * and, if that empties the countdown, let the item out.
 *
 * `g_GameMode == 1` has two overrides, and the order is the engine's: an
 * always-on flag makes *every* prop drop the extra life, and a prop carrying
 * its own `storyItem` releases that in place of its set's item.
 *
 * The engine spells this switch out **three times** — once each in
 * `BreakablePropUpdate`, `KindedPropUpdate` and `FallingContainerUpdate` —
 * and `copy` says which. The set arms are identical but for the height the
 * item is released at, which is `rise`. The story arms differ more:
 *
 * ```c
 * // BreakablePropUpdate, 0x00464B7B
 * SpawnStoryModeItem(obj);  g_original_item_pickup_blocked = 0;
 * // KindedPropUpdate, 0x00466192
 * g_original_item_pickup_blocked = 0;
 * if (g_scene_index == 2 && g_evt_block_index == 4) g_original_item_pickup_blocked = 1;
 * if ((s16)obj->+0x290 == 2) { y += 1.0; SpawnStoryModeItem(obj); y -= 1.0; }
 * else SpawnStoryModeItem(obj);
 * // FallingContainerUpdate, 0x0046A9F4 -- +0x11C = (s8)+0x199 on both arms
 * y = floor + 0.5;  SpawnStoryModeItem(obj);  g_original_item_pickup_blocked = 0;
 * ```
 *
 * `storyRise` is the story arm's height: 1.0 for a kind-2 kinded prop, 0.5
 * over the floor for the falling container, and nothing for a group member.
 * The falling container's `obj+0x11C = (s8)obj+0x199` (`0x0046AA0F`,
 * `0x0046AA35`) is what the story item inherits as its lifetime; the port
 * holds `+0x11C` in `hp` for that family and `+0x199` in `lifetime`.
 */
export function ReleaseHiddenItem(p: BreakableProp, rng: Rng,
                                  events: Events | undefined,
                                  copy: HiddenItemCopy,
                                  rise = 0, storyRise = rise): void {
  // [open] `g_GameMode == 1 && DAT_009C88AA != 0` forces `itemSet = 1` on
  // every prop, so each one drops an extra life. What sets that flag has not
  // been read, so the port does not reproduce it.
  if (p.itemSet <= ItemSet.None) return;

  const left = (G.g_item_set_countdown[p.itemSet] ?? 0) - 1;
  G.g_item_set_countdown[p.itemSet] = left;
  if (left !== 0) return;

  if (copy === HiddenItemCopy.Falling) p.hp = p.lifetime;
  if (G.g_GameMode === 1 && p.storyItem !== -1) {
    if (copy === HiddenItemCopy.Kinded) {
      G.g_original_item_pickup_blocked = 0;
      if (G.g_scene_index === KINDED_STORY_BLOCK_SCENE
          && G.g_evt_block_index === KINDED_STORY_BLOCK_BLOCK) {
        G.g_original_item_pickup_blocked = 1;
      }
    }
    // `FLD; FADD float; FSTP float` before the call; the kinded copy takes
    // it back off after (`FSUB`), the falling one is despawned next.
    if (storyRise !== 0) p.y = Math.fround(p.y + storyRise);
    SpawnStoryModeItem(p, rng, events);
    if (storyRise !== 0 && copy === HiddenItemCopy.Kinded) {
      p.y = Math.fround(p.y - storyRise);
    }
    if (copy !== HiddenItemCopy.Kinded) G.g_original_item_pickup_blocked = 0;
    return;
  }

  // The per-family height tweak, applied for the release and taken straight
  // back off — the engine does exactly this, `+0x1A0 += r` then `-= r`.
  p.y += rise;
  switch (p.itemSet) {
    case ItemSet.ExtraLife:
      SpawnExtraLifePickup(p, events);
      break;
    case ItemSet.GoldenFrog:
      SpawnGoldenFrog(p, events);
      break;
    case ItemSet.Score2:
    case ItemSet.Score5:
    case ItemSet.Score6:
    case ItemSet.Score7:
    case ItemSet.Score8:
      SpawnScorePickup(p, p.itemSet, events);
      break;
    default:
      // Set 4 has no arm in the engine's switch, and no shipped prop uses it.
      break;
  }
  p.y -= rise;
}
