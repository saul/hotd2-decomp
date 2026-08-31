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
import { G } from "../globals";
import { ItemSet, type BreakableProp } from "./prop_state";

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
 * prop whose own `+0x2A0` names a kind, *instead of* its item set's release.
 * Three shipped members carry one: group 0's member 0 and group 7's members
 * 3 and 4.
 *
 * [diverges] Released as an event; the object is not ported.
 */
export function SpawnStoryModeItem(p: BreakableProp, events?: Events): void {
  events?.emit("item.released", {
    set: -1, kind: p.storyItem, from: p.id, x: p.x, y: p.y, z: p.z,
  });
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
 */
export function ReleaseHiddenItem(p: BreakableProp, events?: Events,
                                  rise = 0): void {
  // [open] `g_GameMode == 1 && DAT_009C88AA != 0` forces `itemSet = 1` on
  // every prop, so each one drops an extra life. What sets that flag has not
  // been read, so the port does not reproduce it.
  if (p.itemSet <= ItemSet.None) return;

  const left = (G.g_item_set_countdown[p.itemSet] ?? 0) - 1;
  G.g_item_set_countdown[p.itemSet] = left;
  if (left !== 0) return;

  // The per-family height tweak, applied for the release and taken straight
  // back off — the engine does exactly this, `+0x1A0 += r` then `-= r`.
  p.y += rise;
  if (G.g_GameMode === 1 && p.storyItem !== -1) {
    SpawnStoryModeItem(p, events);
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
  p.y -= rise;
}
