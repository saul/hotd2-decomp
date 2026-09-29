/**
 * The profile: the options, and the block of state the game keeps between
 * runs, its resets, its load, its save, and how it reaches a run.
 *
 * The exe keeps one block, `0x009C9120`..`0x009CA06C` (`0xF4C` bytes), and
 * writes it whole: `ProfileSave` (`FUN_004A0BD0`) takes a negated byte sum of
 * the first `0xF48` into `0x009CA068`, XORs the block with a 176-byte key
 * (`ProfileCipher`, `FUN_004A06F0`), writes it as four `0x3DB`-byte files
 * disguised as game data -- `pol/bg_adv19.bin`,
 * `tex/scr_tod_itm_itamidome2.bin`, `pol/komono_0.bin`, `pol/tv2.bin`, each
 * stamped with `pol/st_adver07.bin`'s file time -- and deciphers it again.
 * `ProfileLoad` (`FUN_004A0B60`) reads, deciphers and takes the block only
 * when the sum matches and the version byte is 7. `web/tools/checks/options.ts`
 * deciphers the install's own four files and checks the sum. `[proved]`
 *
 * The port keeps the parts of the block `G` has: the options -- difficulty,
 * lives, credits, the blood colour, the unused byte and the unlocks -- each
 * player's sight graphic, sight speed, bindings and calibration, the saved
 * Original Mode items, and the version. The rest -- the rankings
 * (`0x009C97A0`), the Training and Boss Mode grades -- belong to modes and
 * screens the port does not have, and neither side of the load writes them.
 * Where the exe writes files, the port raises `profile.save` with the block
 * and `app/` keeps it in the browser (`app/profile_store.ts`).
 */
import type { Events } from "../core/events";
import { G } from "./globals";
import {
  GUN_CALIBRATION_FACTORY, INPUT_BINDINGS_DEFAULT, OPTION_9F28_FACTORY,
  OPTIONS_FACTORY, SIGHT_SPEED_FACTORY, START_LIVES_BY_OPTION,
} from "./options_data";

/** The version byte `ProfileLoad` requires, and writes over a reset block. */
export const PROFILE_VERSION = 7;

/**
 * `[port-only]` -- the parts of the exe's profile block `G` has, as plain
 * data: what `profile.save` carries and `ProfileLoad` takes back.
 */
export interface ProfileBlock {
  /** `0x009CA05F`. */
  version: number;
  /** `0x009C9F20`. */
  difficulty: number;
  /** `0x009C9F21`. */
  lives: number;
  /** `0x009C9F22`. */
  bloodColor: number;
  /** `0x009C9F25`. */
  credits: number;
  /** `0x009C9F28`. */
  unused9F28: number;
  /** `0x009C9F5E`. */
  unlocks: number;
  /** `0x009C9F60 + p*0x7C`. */
  sightGraphic: number[];
  /** `0x009C9F64 + p*0x7C`. */
  sightSpeed: number[];
  /** `0x009C9F68 + p*0x7C`, `[set][5]`. */
  bindings: number[][][];
  /** `0x009C9FB8 + p*0x7C`, eight dwords. */
  calibration: number[][];
  /** `0x009C9F3D`, 33 bytes. */
  originalItems: number[];
}

/**
 * `OptionsFactoryReset` — `FUN_00401130`, the options' factory settings.
 * The four bytes of `g_options_factory` into the difficulty, the life and
 * credit settings and each player's sight graphic; `g_option_9F28_factory`
 * into the unused byte; and per player the sight speed (0.5), all forty
 * binding masks from `g_input_bindings_default`, and the eight calibration
 * dwords. Nothing else. The options' Default row runs it, and so does
 * `ProfileLoad` for a profile it cannot take -- twice, once inside
 * `ProfileFactoryReset`. `[proved]`
 *
 * This is the only writer of 5 into `g_option_credits`: the port's free
 * play is the boot's, not this routine's.
 */
export function OptionsFactoryReset(): void {
  G.g_option_difficulty = OPTIONS_FACTORY.difficulty;
  G.g_option_credits = OPTIONS_FACTORY.credits;
  G.g_option_unused_9F28 = OPTION_9F28_FACTORY;
  G.g_option_lives = OPTIONS_FACTORY.lives;
  for (let p = 0; p < 2; p++) {
    G.g_player_sight_graphic[p] = OPTIONS_FACTORY.sightGraphic;
    G.g_player_sight_speed[p] = SIGHT_SPEED_FACTORY;
    G.g_player_input_bindings[p] =
      INPUT_BINDINGS_DEFAULT[p].map((set) => [...set]);
    G.g_player_gun_calibration[p] = [...GUN_CALIBRATION_FACTORY];
  }
}

/**
 * `ProfileFactoryReset` — `FUN_00401060`, the whole profile: `0x009C9F5F`
 * and the rankings reset (`FUN_0041C490(0)`); the Training and Boss Mode
 * grades zeroed; the blood colour 1; three bytes nothing reads
 * (`0x009C9F23` 1, `0x009C9F24` 0, `0x009C9F26` 0, `0x009C9F27` 1); the
 * saved Original items zeroed; `0x009C9F40`, `44`, `4D` to 1; the unlocks
 * zeroed; `0x009CA058..5E`; and per player no damage, infinite ammo and
 * `+0x7A` zeroed. Then `OptionsFactoryReset`. `[proved]`
 *
 * Of those, `G` holds the blood colour, the saved items, the unlocks and the
 * two per-player flags; the rest are state of screens and modes the port
 * does not have.
 */
export function ProfileFactoryReset(): void {
  G.g_option_blood_color = 1;
  G.g_profile_original_items = new Array(33).fill(0);
  G.g_option_unlocks = 0;
  G.g_player_no_damage = [0, 0];
  G.g_player_infinite_ammo = [0, 0];
  OptionsFactoryReset();
}

/** `g_max_lives`' one value -- the immediate `ProfileApplyToRun` stores. */
export const PROFILE_MAX_LIVES = 5;

/**
 * `ProfileApplyToRun` — `FUN_0040AB50`: the profile into the globals a run
 * reads. `g_start_lives = g_start_lives_by_option[life]`; `g_difficulty =
 * (s16)difficulty`; the saved Original items into `g_original_items_taken`;
 * the Training and Boss Mode grades into their live copies and
 * `0x009A2440 = 5`; a grey to `NoOpStub`; `FUN_0041D4B0` (a debug print of
 * the audio value); and `FUN_0040CB10`, which re-seats both players' aim
 * records -- positions and triggers to zero, calibration copied in. The
 * boot runs it, and the profile save after every write of the profile.
 * `[proved]`
 *
 * The port's aim is the page's pointer, written every frame, so of
 * `FUN_0040CB10` only the trigger has a place in `G`.
 */
export function ProfileApplyToRun(): void {
  G.g_start_lives = START_LIVES_BY_OPTION[G.g_option_lives] ?? 0;
  G.g_difficulty = G.g_option_difficulty;
  G.g_original_items_taken = [...G.g_profile_original_items];
  // `MOV dword ptr [0x009a2440], 0x5` at `0x0040ABC3`: `g_max_lives`, the
  // only write in the image.
  G.g_max_lives = PROFILE_MAX_LIVES;
  // `FUN_0040CB10`: `MOV word ptr [EAX + 0x9c8fd4], DX` per player.
  G.g_trigger_down = [0, 0];
}

/** `[port-only]` -- the block, from `G`. */
export function ProfileCapture(): ProfileBlock {
  return {
    version: G.g_profile_version,
    difficulty: G.g_option_difficulty,
    lives: G.g_option_lives,
    bloodColor: G.g_option_blood_color,
    credits: G.g_option_credits,
    unused9F28: G.g_option_unused_9F28,
    unlocks: G.g_option_unlocks,
    sightGraphic: [...G.g_player_sight_graphic],
    sightSpeed: [...G.g_player_sight_speed],
    bindings: G.g_player_input_bindings.map((p) => p.map((s) => [...s])),
    calibration: G.g_player_gun_calibration.map((p) => [...p]),
    originalItems: [...G.g_profile_original_items],
  };
}

/**
 * `ProfileSave` — `FUN_004A0BD0`. The sum, the cipher and the four files
 * are the platform's; the port raises `profile.save` with the block, and
 * `app/` writes it where the browser keeps things.
 */
export function ProfileSave(events?: Events): void {
  events?.emit("profile.save", { profile: ProfileCapture() });
}

/**
 * `ProfileSaveAndApply` — `FUN_004011F0`. `FUN_004A0C10` (returns 1,
 * ignored), `ProfileSave`, then `ProfileApplyToRun`. The options' EXIT calls
 * it; so do the program's exit, the Original Mode game over, the endings,
 * name entry and the Training and Boss results, none of which the port has
 * but the game over. `[proved]`
 */
export function ProfileSaveAndApply(events?: Events): void {
  ProfileSave(events);
  ProfileApplyToRun();
}

/** Whether a stored block has every field `ProfileLoad` writes. */
function ProfileBlockWhole(b: ProfileBlock | null): b is ProfileBlock {
  if (!b || typeof b !== "object") return false;
  const nums = [b.version, b.difficulty, b.lives, b.bloodColor, b.credits,
                b.unused9F28, b.unlocks];
  return nums.every((n) => typeof n === "number" && Number.isFinite(n))
    && [b.sightGraphic, b.sightSpeed, b.originalItems]
      .every((a) => Array.isArray(a))
    && Array.isArray(b.bindings) && Array.isArray(b.calibration);
}

/**
 * `ProfileLoad` — `FUN_004A0B60`. A block that read back whole and carries
 * version 7 is taken, and the rankings copied out of it (`FUN_0041C490(1)`,
 * which the port has no rankings for): 1. Anything else is a profile reset
 * -- `ProfileFactoryReset`, `OptionsFactoryReset` again, version 7: 0.
 * `[proved]`
 *
 * `saved` is what `app/` read from the browser, or null; "read back whole"
 * is the port's stand-in for the file read and the byte sum, which are the
 * platform's.
 */
export function ProfileLoad(saved: ProfileBlock | null): number {
  if (ProfileBlockWhole(saved) && saved.version === PROFILE_VERSION) {
    G.g_profile_version = saved.version;
    G.g_option_difficulty = saved.difficulty;
    G.g_option_lives = saved.lives;
    G.g_option_blood_color = saved.bloodColor;
    G.g_option_credits = saved.credits;
    G.g_option_unused_9F28 = saved.unused9F28;
    G.g_option_unlocks = saved.unlocks;
    for (let p = 0; p < 2; p++) {
      G.g_player_sight_graphic[p] = saved.sightGraphic[p] ?? 0;
      G.g_player_sight_speed[p] = saved.sightSpeed[p] ?? SIGHT_SPEED_FACTORY;
      const sets = saved.bindings[p];
      if (Array.isArray(sets)) {
        G.g_player_input_bindings[p] = sets.map((s) => [...s]);
      }
      const cal = saved.calibration[p];
      if (Array.isArray(cal)) G.g_player_gun_calibration[p] = [...cal];
    }
    G.g_profile_original_items = [...saved.originalItems];
    return 1;
  }
  ProfileFactoryReset();
  OptionsFactoryReset();
  G.g_profile_version = PROFILE_VERSION;
  return 0;
}

/**
 * `[port-only]` -- the profile half of the boot, which the page runs once
 * before its first stage: `FUN_0040E4A0`'s `ProfileLoad`, then the two lines
 * of the data-segment reset `FUN_0040A920` that touch the profile --
 * `ProfileApplyToRun` (`0x0040A931`) and the blood colour to 1
 * (`0x0040A99B`, over whatever was loaded).
 *
 * [diverges] A profile with nothing saved starts in **free play**,
 * `g_option_credits` -1, by the user's choice; the exe's reset leaves it at
 * 5, six credits. Only this boot does it: `OptionsFactoryReset` -- the
 * options' Default row -- still writes 5, and a saved profile brings its own
 * setting, free play or not. `web/test/port.test.ts` pins both.
 */
export function ProfileBoot(saved: ProfileBlock | null): void {
  if (ProfileLoad(saved) === 0) G.g_option_credits = -1;
  ProfileApplyToRun();
  G.g_option_blood_color = 1;
}
