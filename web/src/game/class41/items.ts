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
import { PickOriginalModeItem } from "./original_item";
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
 * list the prop is on, so it runs on the frame it is made.
 *
 * The `item.released` event is the port's own notice for its feed; the
 * engine has no counterpart and the game reads nothing from it.
 */
export function SpawnStoryModeItem(p: BreakableProp, rng: Rng,
                                   events?: Events): void {
  const q = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  q.family = PropFamily.OriginalItem;
  q.flags = STORY_ITEM_FLAGS;
  q.state = BreakableState.Standing;
  // `ActorClearGameFields` zeroes the pickup strip's frame and base.
  q.storyItem = 0;
  q.removeFlag = 0;
  q.group = (p.storyItem << 24) >> 24;
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
  PickOriginalModeItem(q, q.group, rng);
  G.g_original_item_banner_count = 0;
  G.g_breakable_props.push(q);
  events?.emit("item.released", {
    set: -1, kind: p.storyItem, from: p.id, x: p.x, y: p.y, z: p.z,
  });
}

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
 * The tail of the destroy path: count this break against the prop's item set
 * and, if that empties the countdown, let the item out.
 *
 * `g_GameMode == 1` has two overrides, and the order is the engine's: an
 * always-on flag makes *every* prop drop the extra life, and a prop carrying
 * its own `storyItem` releases that in place of its set's item.
 *
 * The engine spells this switch out **three times** — once each in
 * `BreakablePropUpdate`, `KindedPropUpdate` and `FallingContainerUpdate` — and
 * the three copies are identical but for the height the item is released at.
 * That difference is `rise`; everything else is one routine here rather than
 * three, because three transcriptions of one switch is three places for it to
 * drift.
 *
 * `storyRise` is the one copy whose two arms differ: `FallingContainerUpdate`
 * (`FUN_0046A580`) seats a story item at its floor **plus 0.5**
 * (`FADD [0x004C43AC]` at `0x0046A9FA`) and a set's item at the floor itself.
 * Everywhere else it is `rise`.
 */
export function ReleaseHiddenItem(p: BreakableProp, rng: Rng,
                                  events?: Events,
                                  rise = 0, storyRise = rise): void {
  // [open] `g_GameMode == 1 && DAT_009C88AA != 0` forces `itemSet = 1` on
  // every prop, so each one drops an extra life. What sets that flag has not
  // been read, so the port does not reproduce it.
  if (p.itemSet <= ItemSet.None) return;

  const left = (G.g_item_set_countdown[p.itemSet] ?? 0) - 1;
  G.g_item_set_countdown[p.itemSet] = left;
  if (left !== 0) return;

  // The per-family height tweak, applied for the release and taken straight
  // back off — the engine does exactly this, `+0x1A0 += r` then `-= r`.
  const story = G.g_GameMode === 1 && p.storyItem !== -1;
  const lift = story ? storyRise : rise;
  p.y += lift;
  if (story) {
    SpawnStoryModeItem(p, rng, events);
  } else {
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
  }
  p.y -= lift;
}
