/**
 * Original Mode's per-player block, the items that fill it, and the one query
 * the branch triggers make of it.
 *
 * Each player has a 0x14-byte block at `g_original_item_slots` (`0x009A2240 +
 * p*0x14`):
 *
 * | off   | field                                  |
 * | ----- | -------------------------------------- |
 * | +0x00 | item slot 0, s8, -1 empty              |
 * | +0x01 | item slot 1                            |
 * | +0x02 | `g_original_character`                 |
 * | +0x03 | `g_original_score_multiplier`          |
 * | +0x04 | `g_original_start_lives`               |
 * | +0x05 | `g_original_life_cap`                  |
 * | +0x06 | `g_original_bonus_credits`             |
 * | +0x07 | `g_original_fire_mode`                 |
 * | +0x08 | `g_player_magazine_size`, s8           |
 * | +0x09 | `g_original_weapon_kind`               |
 * | +0x0A | `g_original_weapon_sound_kind`         |
 * | +0x0B | `g_original_weapon_flags` -- `[open]`  |
 * | +0x0C | `g_original_weapon_damage_scale`, f32  |
 * | +0x10 | `g_original_fire_latches`, four bytes  |
 *
 * `ResetOriginalModeLoadout` sets it up once a run; the trunk
 * (`game/class6e/`) fills the two slots out of `g_original_items_taken`, and
 * `OriginalItemsApply` turns what is in them into the rest of the block the
 * moment the trunk closes. So an item does its work for the whole run, at
 * every stage, and is gone from the trunk until the player finds another.
 */
import type { Rng } from "../core/rng";
import { G } from "./globals";
import { T } from "./tables";

/**
 * The 33 Original Mode items, by the id every table is indexed with. Each is
 * named by its own label in the trunk's list, `original_mode.list_sprites`
 * (`g_original_item_list_sprites`, `0x0059721C`) -- the game's words, not a
 * description of what the item does. The effect is `OriginalItemsApply`'s.
 */
export enum OriginalItem {
  Shotgun = 0x00,
  MachineGun = 0x01,
  /** "GRENADE" -- a launcher: three rounds, weapon kind 3. */
  Grenade = 0x02,
  PowerUp12 = 0x03,
  PowerUp15 = 0x04,
  PowerUp20 = 0x05,
  BulletBlow = 0x06,
  Chamber2 = 0x07,
  Chamber4 = 0x08,
  Chamber8 = 0x09,
  ChamberInfinite = 0x0a,
  CustomAirGun = 0x0b,
  ToyGun = 0x0c,
  BassLure = 0x0d,
  LifePlus2 = 0x0e,
  LifePlus5 = 0x0f,
  CreditPlus2 = 0x10,
  CreditPlus5 = 0x11,
  CreditPlus10 = 0x12,
  CreditInfinite = 0x13,
  PrimitiveMeat = 0x14,
  RottenMeat = 0x15,
  AmyCostume = 0x16,
  HarryCostume = 0x17,
  GoldmanCostume = 0x18,
  GCostume = 0x19,
  RoganCostume = 0x1a,
  BrunoCostume = 0x1b,
  CivilianCostume = 0x1c,
  LifeQuarter = 0x1d,
  FirstAidKit = 0x1e,
  /** "UFO??" -- `PropUpdateType77`'s flying bonus asks for it by id. */
  Ufo = 0x1f,
  DoubleScore = 0x20,
}

/** `g_original_items_taken`'s width, `CMP ..., 0x21` in `ItemSelectBuildList`. */
export const ORIGINAL_ITEM_COUNT = 0x21;

/**
 * A row of `original_mode.weapon_records` (`0x004EC928`), or undefined in a
 * bundle written before the block. `[port-only]` as a function.
 */
function WeaponRecord(row: number) {
  return T.originalMode?.weapon_records[row];
}

/**
 * `ResetOriginalModeLoadout` — `FUN_0048A0D0`. Once a run, from
 * `ResetGameOnStart`, and again as the trunk opens. The five flag bytes
 * cleared, and per player: both slots empty, the character the player's own,
 * the score single, three lives capped at five, no bonus credits, fire mode 0,
 * and row 0 of the weapon records -- the dword `+0x08..+0x0B` (magazine 6,
 * kind 0, sound kind 0, `+0x0B` 3) and the damage scale 1.0 -- read out of the
 * table (`MOV ESI, [0x004ec928]`, `MOV EDX, [0x004ec92c]`), not written as
 * immediates. It does not touch the auto-fire latches `+0x10..+0x13`.
 * `[proved]`
 */
export function ResetOriginalModeLoadout(): void {
  G.g_original_item_big_head = 0;
  G.g_original_quarter_life = 0;
  G.g_original_first_aid = 0;
  G.g_original_ufo_item = 0;
  G.g_original_item_part_scale = 0;
  const row0 = WeaponRecord(0);
  for (let p = 0; p < 2; p++) {
    if (row0) OriginalLoadWeaponWord(p, 0);
    G.g_original_item_slots[p] = [-1, -1];
    G.g_original_fire_mode[p] = 0;
    if (row0) G.g_original_weapon_damage_scale[p] = row0.damage;
    G.g_original_character[p] = p;
    G.g_original_score_multiplier[p] = 1;
    G.g_original_start_lives[p] = 3;
    G.g_original_life_cap[p] = 5;
    G.g_original_bonus_credits[p] = 0;
  }
}

/**
 * `[port-only]` as a function -- the one dword store every routine here makes
 * of a weapon record's first four bytes into `+0x08..+0x0B`: the magazine,
 * the weapon kind, the sound kind and `+0x0B`.
 */
function OriginalLoadWeaponWord(player: number, row: number): void {
  const r = WeaponRecord(row);
  if (!r) return;
  G.g_player_magazine_size[player] = r.magazine;
  G.g_original_weapon_kind[player] = r.kind;
  G.g_original_weapon_sound_kind[player] = r.sound;
  G.g_original_weapon_flags[player] = r.flags;
}

/** `(s8)(v)`, as a byte store of an int keeps it. */
const s8 = (v: number): number => ((v & 0xff) << 24) >> 24;

/**
 * `OriginalItemsApply` — `FUN_00415FE0`. What player `p`'s two items do, into
 * the rest of the block -- called for both players as the trunk closes
 * (`ItemSelectFinish`). A switch on each slot through the byte table at
 * `0x0041620C` and the jump table at `0x004161B8`, every arm `[proved]` from
 * the listing; `row` is the item's weapon record, `item + 1`:
 *
 * | items         | writes                                                   |
 * | ------------- | -------------------------------------------------------- |
 * | 0..2, guns    | fire mode `item + 1`; the record's dword and damage      |
 * | 3..5, POWER UP| the record's damage and `+0x0B`                          |
 * | 6, BULLET BLOW| kind 4; the record's damage, `+0x0B` and sound kind      |
 * | 7..10, CHAMBER| the record's magazine                                    |
 * | 0x0B, AIR GUN | fire mode 0xC; the record's magazine and sound kind      |
 * | 0x0C, TOY GUN | fire mode 0xD; its sound kind; 5 credits; part scale     |
 * | 0x0D, LURE    | kind 5; the record's sound kind                          |
 * | 0x0E / 0x0F   | lives 5 / lives 8 and the cap 8                          |
 * | 0x10..0x13    | credits 2, 5, 10, -1                                     |
 * | 0x14, P. MEAT | part scale (the toy gun's tail, `0x004160A8`)            |
 * | 0x15, R. MEAT | `g_original_item_big_head`                                   |
 * | 0x16..0x1B    | character `item - 0x14`                                  |
 * | 0x1C          | character `rand() % 2 + 8`                               |
 * | 0x1D, 0x1E, 0x1F | the three flag bytes                                  |
 * | 0x20          | score multiplier 2                                       |
 *
 * An id above 0x20 -- -1, an empty slot, compared unsigned -- does nothing.
 * Then two passes over the slots for the two guns that take other items on
 * top: with fire mode 0xC the magazine is the air gun's own 12 plus each
 * CHAMBER's over 6, or -1 for CHAMBER ∞; with fire mode 0xD the credits are 5
 * plus each CREDIT's, or -1 for CREDIT ∞. The mode tested is the one left in
 * `DL` before the first pass (`MOV DL, [ESI + 0x7]` at `0x00416134`), so the
 * second test sees the first's mode.
 */
export function OriginalItemsApply(player: number, rng: Rng): void {
  const slots = G.g_original_item_slots[player];
  for (let i = 0; i < 2; i++) {
    const id = slots[i];
    if ((id >>> 0) > 0x20) continue;
    switch (id) {
      case OriginalItem.Shotgun:
      case OriginalItem.MachineGun:
      case OriginalItem.Grenade: {
        G.g_original_fire_mode[player] = id + 1;
        OriginalLoadWeaponWord(player, id + 1);
        const r = WeaponRecord(id + 1);
        if (r) G.g_original_weapon_damage_scale[player] = r.damage;
        break;
      }
      case OriginalItem.PowerUp12:
      case OriginalItem.PowerUp15:
      case OriginalItem.PowerUp20: {
        const r = WeaponRecord(id + 1);
        if (r) {
          G.g_original_weapon_damage_scale[player] = r.damage;
          G.g_original_weapon_flags[player] = r.flags;
        }
        break;
      }
      case OriginalItem.BulletBlow: {
        G.g_original_weapon_kind[player] = 4;
        const r = WeaponRecord(id + 1);
        if (r) {
          G.g_original_weapon_damage_scale[player] = r.damage;
          G.g_original_weapon_flags[player] = r.flags;
          G.g_original_weapon_sound_kind[player] = r.sound;
        }
        break;
      }
      case OriginalItem.Chamber2:
      case OriginalItem.Chamber4:
      case OriginalItem.Chamber8:
      case OriginalItem.ChamberInfinite: {
        const r = WeaponRecord(id + 1);
        if (r) G.g_player_magazine_size[player] = r.magazine;
        break;
      }
      case OriginalItem.CustomAirGun: {
        G.g_original_fire_mode[player] = 0xc;
        const r = WeaponRecord(id + 1);
        if (r) {
          G.g_player_magazine_size[player] = r.magazine;
          G.g_original_weapon_sound_kind[player] = r.sound;
        }
        break;
      }
      case OriginalItem.ToyGun: {
        G.g_original_fire_mode[player] = 0xd;
        const r = WeaponRecord(id + 1);
        if (r) G.g_original_weapon_sound_kind[player] = r.sound;
        G.g_original_bonus_credits[player] = 5;
        G.g_original_item_part_scale = 1;
        break;
      }
      case OriginalItem.BassLure: {
        G.g_original_weapon_kind[player] = 5;
        const r = WeaponRecord(id + 1);
        if (r) G.g_original_weapon_sound_kind[player] = r.sound;
        break;
      }
      case OriginalItem.LifePlus2:
        G.g_original_start_lives[player] = 5;
        break;
      case OriginalItem.LifePlus5:
        G.g_original_start_lives[player] = 8;
        G.g_original_life_cap[player] = 8;
        break;
      case OriginalItem.CreditPlus2:
        G.g_original_bonus_credits[player] = 2;
        break;
      case OriginalItem.CreditPlus5:
        G.g_original_bonus_credits[player] = 5;
        break;
      case OriginalItem.CreditPlus10:
        G.g_original_bonus_credits[player] = 10;
        break;
      case OriginalItem.CreditInfinite:
        G.g_original_bonus_credits[player] = -1;
        break;
      case OriginalItem.PrimitiveMeat:
        G.g_original_item_part_scale = 1;
        break;
      case OriginalItem.RottenMeat:
        G.g_original_item_big_head = 1;
        break;
      case OriginalItem.AmyCostume:
      case OriginalItem.HarryCostume:
      case OriginalItem.GoldmanCostume:
      case OriginalItem.GCostume:
      case OriginalItem.RoganCostume:
      case OriginalItem.BrunoCostume:
        G.g_original_character[player] = id - 0x14;
        break;
      case OriginalItem.CivilianCostume:
        // `CALL rand; AND EAX, 0x80000001; JNS ...` -- `rand() % 2`, + 8.
        G.g_original_character[player] = rng.int(2) + 8;
        break;
      case OriginalItem.LifeQuarter:
        G.g_original_quarter_life = 1;
        break;
      case OriginalItem.FirstAidKit:
        G.g_original_first_aid = 1;
        break;
      case OriginalItem.Ufo:
        G.g_original_ufo_item = 1;
        break;
      case OriginalItem.DoubleScore:
        G.g_original_score_multiplier[player] = 2;
        break;
    }
  }
  const mode = G.g_original_fire_mode[player];
  if (mode === 0xc) {
    const air = WeaponRecord(OriginalItem.CustomAirGun + 1);
    if (air) G.g_player_magazine_size[player] = air.magazine;
    for (let i = 0; i < 2; i++) {
      const id = slots[i];
      if (id < OriginalItem.Chamber2) continue;
      if (id <= OriginalItem.Chamber8) {
        const r = WeaponRecord(id + 1);
        if (r) {
          G.g_player_magazine_size[player] =
            s8(G.g_player_magazine_size[player] + (r.magazine - 6));
        }
      } else if (id === OriginalItem.ChamberInfinite) {
        const r = WeaponRecord(OriginalItem.ChamberInfinite + 1);
        if (r) G.g_player_magazine_size[player] = r.magazine;
      }
    }
  }
  if (mode === 0xd) {
    G.g_original_bonus_credits[player] = 5;
    for (let i = 0; i < 2; i++) {
      switch (slots[i]) {
        case OriginalItem.CreditPlus2:
          G.g_original_bonus_credits[player] =
            s8(G.g_original_bonus_credits[player] + 2);
          break;
        case OriginalItem.CreditPlus5:
          G.g_original_bonus_credits[player] =
            s8(G.g_original_bonus_credits[player] + 5);
          break;
        case OriginalItem.CreditPlus10:
          G.g_original_bonus_credits[player] =
            s8(G.g_original_bonus_credits[player] + 10);
          break;
        case OriginalItem.CreditInfinite:
          G.g_original_bonus_credits[player] = -1;
          break;
      }
    }
  }
}

/**
 * `OriginalItemsApplyOnJoin` — `FUN_00416240`, from
 * `PlayerEnterPlayOriginalJoin` -- `PlayerEnterPlay`'s row 3, a player
 * joining mid-run. It goes through the same two slots and undoes what the
 * trunk's application gave the weapon and the lives, keeping the rest (the
 * byte table at `0x00416314`, the jump table at `0x004162E8`, `[proved]`):
 *
 * * every gun, POWER UP, BULLET BLOW, CHAMBER, the air gun and the lure: fire
 *   mode 0 and row 0 of the weapon records, dword and damage -- the bare gun;
 * * the TOY GUN: the same, and the part scale;
 * * LIFE +2 / +5: three lives, the cap five;
 * * the four CREDITs: nothing;
 * * PRIMITIVE MEAT: the part scale; ROTTEN MEAT, LIFE 1/4, FIRST AID KIT and
 *   UFO??: their flag; DOUBLE SCORE: the multiplier 2;
 * * a costume: the character back to the player's own.
 */
export function OriginalItemsApplyOnJoin(player: number): void {
  const slots = G.g_original_item_slots[player];
  const row0 = WeaponRecord(0);
  for (let i = 0; i < 2; i++) {
    const id = slots[i];
    if ((id >>> 0) > 0x20) continue;
    switch (id) {
      // Byte-table entry 0 (`0x0041626C`): every weapon item but the toy gun.
      case OriginalItem.Shotgun:
      case OriginalItem.MachineGun:
      case OriginalItem.Grenade:
      case OriginalItem.PowerUp12:
      case OriginalItem.PowerUp15:
      case OriginalItem.PowerUp20:
      case OriginalItem.BulletBlow:
      case OriginalItem.Chamber2:
      case OriginalItem.Chamber4:
      case OriginalItem.Chamber8:
      case OriginalItem.ChamberInfinite:
      case OriginalItem.CustomAirGun:
      case OriginalItem.BassLure:
        G.g_original_fire_mode[player] = 0;
        OriginalLoadWeaponWord(player, 0);
        if (row0) G.g_original_weapon_damage_scale[player] = row0.damage;
        break;
      case OriginalItem.ToyGun:
        G.g_original_fire_mode[player] = 0;
        OriginalLoadWeaponWord(player, 0);
        if (row0) G.g_original_weapon_damage_scale[player] = row0.damage;
        G.g_original_item_part_scale = 1;
        break;
      case OriginalItem.LifePlus2:
      case OriginalItem.LifePlus5:
        G.g_original_start_lives[player] = 3;
        G.g_original_life_cap[player] = 5;
        break;
      case OriginalItem.CreditPlus2:
      case OriginalItem.CreditPlus5:
      case OriginalItem.CreditPlus10:
      case OriginalItem.CreditInfinite:
        break;
      case OriginalItem.PrimitiveMeat:
        G.g_original_item_part_scale = 1;
        break;
      case OriginalItem.RottenMeat:
        G.g_original_item_big_head = 1;
        break;
      case OriginalItem.AmyCostume:
      case OriginalItem.HarryCostume:
      case OriginalItem.GoldmanCostume:
      case OriginalItem.GCostume:
      case OriginalItem.RoganCostume:
      case OriginalItem.BrunoCostume:
      case OriginalItem.CivilianCostume:
        G.g_original_character[player] = player;
        break;
      case OriginalItem.LifeQuarter:
        G.g_original_quarter_life = 1;
        break;
      case OriginalItem.FirstAidKit:
        G.g_original_first_aid = 1;
        break;
      case OriginalItem.Ufo:
        G.g_original_ufo_item = 1;
        break;
      case OriginalItem.DoubleScore:
        G.g_original_score_multiplier[player] = 2;
        break;
    }
  }
}

/**
 * `PlayerHoldsOriginalItem` — `FUN_00461C70`.
 *
 * ```c
 * if (g_players_in_play == 1) {
 *     if (g_original_item_slots[g_active_player][0] != id
 *      && g_original_item_slots[g_active_player][1] != id) return 0;
 * } else if (g_players_in_play == 2) {
 *     if (g_original_item_slots[0][0] != id
 *      && g_original_item_slots[1][0] != id) return 0;
 * } else return 0;
 * return 1;
 * ```
 *
 * **The two-player arm reads a different pair of slots**, not the same two:
 * one player checks both of its own slots, two players check slot 0 of each.
 * That is the trunk's own rule -- with two players in it, each may take one
 * item (`ItemSelectUpdate`), into slot 0 -- so it is not a restriction a
 * two-player run can feel.
 *
 * The second slot is read as a **signed byte** in the engine
 * (`(char)(&DAT_009A2241)[...]`) and the first as a byte, which is why an
 * empty slot of -1 can never match a real id.
 */
export function PlayerHoldsOriginalItem(id: number): boolean {
  if (G.g_players_in_play === 1) {
    const slots = G.g_original_item_slots[G.g_active_player];
    if (!slots) return false;
    return slots[0] === id || slots[1] === id;
  }
  if (G.g_players_in_play === 2) {
    return (G.g_original_item_slots[0]?.[0] === id)
      || (G.g_original_item_slots[1]?.[0] === id);
  }
  return false;
}
