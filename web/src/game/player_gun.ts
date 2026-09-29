/**
 * The gun: the trigger, the magazine and the reload.
 *
 * `PlayerUpdateInPlay` (`FUN_00413E90`) polls the trigger once a frame while
 * the player has a life, through one of two routines:
 *
 * ```
 * PlayerUpdateInPlay
 *   g_GameMode == 1 ? PlayerFireOriginalModeWeapon      FUN_00414B90
 *                   : PlayerFireAndReloadUpdate         FUN_00414940
 *                        PlayerRefillMagazine           FUN_00414B30
 *   ...
 *   if (g_nFiringGate) HudDrawAmmoAndReloadPrompt       FUN_004177D0
 *   HudDrawLives                                        FUN_004174A0
 * ```
 *
 * ## What an empty gun does
 *
 * **Nothing.** The arcade routine's trigger block is
 *
 * ```c
 * if (trigger) {
 *   if (!on_screen || ammo == 0) {
 *     if (gun && !on_screen && ammo != 6) PlayerRefillMagazine();
 *   } else if (g_nFiringGate) {
 *     ammo--;  if (ammo == 0) { empty = 1; prompt_timer = 0; }
 *     fired; BuildShotRay; PlayerShotEffectSpawn; gunshot;
 *   }
 * }
 * if ((g_pad_state & bindings[set].reload) && !gun && ammo != 6)
 *   PlayerRefillMagazine();
 * ```
 *
 * so a pull on an empty gun pointed at the screen takes no round, makes no
 * flash and no sound, and does not reload either `[proved]`. What the player
 * hears is `HudDrawAmmoAndReloadPrompt`'s: while the empty latch is up, a
 * pull with the aim on the screen plays the "RELOAD!" voice, and from the
 * 120th frame on a gun hears "SHOOT (outside the screen)" instead.
 *
 * ## How a gun reloads
 *
 * By a pull with the aim **off the screen**, and only that. The binding sets
 * in `g_input_bindings_default` give the gun set no reload bit at all; a
 * standard controller -- on PC the keyboard, `KeyboardReadAsPad`
 * (`FUN_0041F1A0`), where it is Right Ctrl -- reloads with pad B. The port's
 * device is the mouse, which the exe makes a gun: see
 * `G.g_player_input_is_gun` and {@link QueueOffscreenPull}. Neither reload
 * waits on the firing gate; only the refill's sound does.
 *
 * `[port-only]`: the trigger is the shot queue. Each due pull runs the
 * trigger block once, in the order it was made -- see `TakeDueShotRequests`.
 * `PollPlayerAimInput`'s record for the pull is the request itself: the
 * trigger is down, and `onScreen` is where the aim was.
 */
import type { Events } from "../core/events";
import {
  FireShotRequest, TakeDueShotRequests, g_gunshot_sound_ids, type ShotRequest,
} from "./combat/shot";
import { GameMode } from "./game_mode";
import { AppState, G } from "./globals";
import type { GameHost } from "./host";
import type { Rng } from "../core/rng";

/** The arcade magazine: `PlayerRefillMagazine`'s literal 6. */
export const ARCADE_MAGAZINE = 6;

/** `COMMON\RELOAD1_44.WAV`, `PlayerRefillMagazine`'s one sound. */
export const RELOAD_SOUND = 0x003e16a9;

/** What a player's gun needs from the frame. */
export interface GunFrame {
  host: GameHost;
  rng: Rng;
  events?: Events;
}

/**
 * Which of the four binding sets a player's device reads -- the values
 * `PlayerInputBindingSet` (`FUN_0040D980`) returns.
 */
export enum InputBindingSet {
  /** No device (`g_player_input_is_gun` -1). */
  None = -1,
  /** A gun: the PC mouse in input modes 5 and 6, or the light gun. */
  Gun = 0,
  /** A standard controller (`MapleDeviceKind` 0) -- the PC keyboard. */
  Controller = 1,
  /** `MapleDeviceKind` 1. */
  PadKind1 = 2,
  /** `MapleDeviceKind` 2. */
  PadKind2 = 3,
}

/**
 * `g_original_fire_params` — `0x00579ED8`, eight bytes per
 * `g_original_fire_mode`. `OriginalWeaponLoadFireParams` copies bytes 0..3
 * into the auto-fire latches; `PlayerFireOriginalModeWeapon` reads 1, 5, 6
 * and 7. Rows 4..7 are zero.
 */
export const ORIGINAL_FIRE_PARAMS: readonly (readonly number[])[] = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 3, 0, 0, 1, 3, 2],
  [0, 0, 0, 0, 0, 1, 0, 2],
  [0, 0, 0, 0, 0, 0, 0, 4],
];

/**
 * `g_original_weapon_gunshot_ids` — `0x004EC9A0` and
 * `g_original_weapon_reload_ids` — `0x004EC9C0`, eight u32 each, indexed by
 * `g_original_weapon_sound_kind` (`0x009A224A`).
 */
const ORIGINAL_GUNSHOT_IDS: readonly number[] = [
  0, 0x001600a9, 0x000e00a9, 0x000b00a9, 0x000d00a9, 0x000900a9, 0x000600a9,
  0x001500a9,
];
const ORIGINAL_RELOAD_IDS: readonly number[] = [
  0, 0, 0, 0x000c00a9, 0, 0x000a00a9, 0, 0,
];

/**
 * `g_original_weapon_sound_kind` (`0x009A224A`). Not a field of `G`: the
 * only instruction that writes it is `ResetOriginalModeLoadout`'s store of
 * the dword `0x03000006`, which makes it 0, and nothing references the byte
 * to write anything else (see its row in `globals.tsv`).
 */
const ORIGINAL_WEAPON_SOUND_KIND = 0;

/** The magazine a refill fills to, and the count a reload compares against. */
function FullMagazine(player: number): number {
  return G.g_GameMode === GameMode.Original
    ? G.g_player_magazine_size[player] : ARCADE_MAGAZINE;
}

/**
 * `PlayerInputBindingSet` — `FUN_0040D980`. -1 with no device, 0 for a gun,
 * otherwise by the controller's kind.
 */
export function PlayerInputBindingSet(player: number): InputBindingSet {
  const gun = G.g_player_input_is_gun[player];
  if (gun === -1) return InputBindingSet.None;
  if (gun === 1) return InputBindingSet.Gun;
  const kind = G.g_player_pad_kind[player];
  if (kind === 1) return InputBindingSet.PadKind1;
  if (kind !== 2) return InputBindingSet.Controller;
  return InputBindingSet.PadKind2;
}

/** A binding set's `+0x04`, the reload mask. */
export const BINDING_RELOAD = 1;

/**
 * The reload mask of `player`'s binding set, from
 * `g_player_input_bindings` (`+0x08` of the player's options record, which
 * only the factory reset writes); 0 with no device.
 */
function ReloadMask(player: number): number {
  const set = PlayerInputBindingSet(player);
  return set === InputBindingSet.None
    ? 0 : G.g_player_input_bindings[player]?.[set]?.[BINDING_RELOAD] ?? 0;
}

/**
 * `PlayerRefillMagazine` — `FUN_00414B30`. Six rounds, or the Original
 * magazine when it is not -1; the empty latch down; and the reload sound, but
 * only while the firing gate is open -- the refill itself does not wait.
 */
export function PlayerRefillMagazine(player: number, events?: Events): void {
  if (G.g_GameMode === GameMode.Original
      && G.g_player_magazine_size[player] !== -1) {
    G.g_player_ammo[player] = G.g_player_magazine_size[player];
  } else {
    G.g_player_ammo[player] = ARCADE_MAGAZINE;
  }
  G.g_player_magazine_empty[player] = 0;
  if (G.g_nFiringGate !== 0) events?.emit("sound.play", { id: RELOAD_SOUND });
}

/**
 * `PlayerFireAndReloadUpdate` — `FUN_00414940`. The arcade trigger and both
 * of its reloads; see the file comment for the shape.
 *
 * Not transcribed: `FUN_00415710`, which copies the aim record into the
 * player block (the port's aim is written by `SetPlayerAimFromPointer`), and
 * the tail's skip poll, which the walker's `requestSkip` owns. The
 * `0x009A5C48` guard on `g_player_shot_count` has no counterpart because the
 * count itself is `g_nPlayerFired` in the port (see `combat/shot.ts`).
 */
export function PlayerFireAndReloadUpdate(player: number, f: GunFrame): void {
  for (const req of TakeDueShotRequests(player)) {
    PlayerTriggerPull(player, req, f);
  }
  if ((G.g_pad_state & ReloadMask(player)) !== 0
      && G.g_player_input_is_gun[player] === 0
      && G.g_player_ammo[player] !== ARCADE_MAGAZINE) {
    PlayerRefillMagazine(player, f.events);
  }
}

/**
 * The trigger block of `PlayerFireAndReloadUpdate`, for one pull.
 * `[port-only]` as a function -- the engine runs it once a frame -- and
 * transcribed line for line.
 */
function PlayerTriggerPull(player: number, req: ShotRequest,
                           f: GunFrame): void {
  if (req.onScreen === 0 || G.g_player_ammo[player] === 0) {
    // The Original arm of this test is unreachable here (mode 1 takes the
    // other routine) and is transcribed anyway: it compares against the
    // magazine rather than the literal.
    if (G.g_player_input_is_gun[player] === 1 && req.onScreen === 0
        && G.g_player_ammo[player] !== FullMagazine(player)) {
      PlayerRefillMagazine(player, f.events);
    }
    return;
  }
  // `g_nFiringGate` — `0x009C8E00`, tested at `0x004149BE`: with it down the
  // pull does nothing at all, not even take the round.
  if (G.g_nFiringGate === 0) return;
  if (G.g_app_state !== AppState.Attract
      && G.g_player_infinite_ammo[player] === 0
      && (G.g_GameMode !== GameMode.Original
          || G.g_player_magazine_size[player] !== -1)) {
    G.g_player_ammo[player] -= 1;
  }
  if (G.g_player_ammo[player] === 0) {
    G.g_player_magazine_empty[player] = 1;
    G.g_player_reload_prompt_timer[player] = 0;
  }
  FireShotRequest(req, f.host, f.rng, f.events);
}

/**
 * `OriginalWeaponLoadFireParams` — `FUN_00416420`. Bytes 0..3 of the fire
 * mode's `ORIGINAL_FIRE_PARAMS` row into the player's four auto-fire latches.
 */
export function OriginalWeaponLoadFireParams(player: number): void {
  const row = ORIGINAL_FIRE_PARAMS[G.g_original_fire_mode[player]]
    ?? ORIGINAL_FIRE_PARAMS[0];
  const l = G.g_original_fire_latches[player];
  for (let i = 0; i < 4; i++) l[i] = row[i];
}

/**
 * `PlayerReloadOriginalModeWeapon` — `FUN_00414E40`. Fire mode 2 may only be
 * reloaded empty; otherwise the latches are reloaded, the magazine filled --
 * to -1 for an unlimited one, which the HUD draws as `oo` -- the latch
 * lowered, and the weapon's own reload sound played (the common one when it
 * has none), behind the gate.
 */
export function PlayerReloadOriginalModeWeapon(player: number,
                                               events?: Events): void {
  if (G.g_original_fire_mode[player] === 2
      && G.g_player_magazine_empty[player] !== 1) return;
  OriginalWeaponLoadFireParams(player);
  G.g_player_ammo[player] = G.g_player_magazine_size[player];
  G.g_player_magazine_empty[player] = 0;
  if (G.g_nFiringGate === 0) return;
  const id = ORIGINAL_RELOAD_IDS[ORIGINAL_WEAPON_SOUND_KIND] ?? 0;
  events?.emit("sound.play", { id: id !== 0 ? id : RELOAD_SOUND });
}

/**
 * `PlayerFireOriginalModeWeapon` — `FUN_00414B90`. The Original Mode twin:
 * the same trigger block against the magazine instead of the literal, with a
 * burst machine in the four latches, and `PlayerReloadOriginalModeWeapon`
 * for both reloads.
 *
 * The latches: `[3]` counts down once a frame, floored at 0, and while it is
 * above 0 the trigger is not read; `[1] == 1` fires a round with no pull at
 * all. Fire mode 1 reloads `[1]` and `[3]` from row 1 on every shot and takes
 * a round only every `[2]`-th; any other mode reloads them from its own row.
 *
 * `[diverges]` Two arms, both unreachable in the port -- they need
 * `g_original_fire_mode` 1, and no routine the port runs writes anything but
 * 0 there, because no weapon pickup is ported:
 * * the round owed with no pull is fired along the last pull's ray
 *   (`G.g_crosshair_ray`), where the engine calls `BuildShotRay` on the
 *   crosshair as it stands -- the port has a ray only when a pull brings one;
 * * the recoil spread, `rand() % 0x40` across and `% 0x30` down in pixels
 *   before the ray is built, is not applied: the ray arrives built.
 */
export function PlayerFireOriginalModeWeapon(player: number,
                                             f: GunFrame): void {
  const l = G.g_original_fire_latches[player];
  l[3] -= 1;
  if (l[3] < 1) l[3] = 0;
  const pulls = TakeDueShotRequests(player);
  const owed = l[1] === 1 && !pulls.length ? G.g_crosshair_ray[player] : null;
  const polls: ShotRequest[] = owed
    ? [{ player, frame: Math.round(G.g_frame), ray: owed,
         onScreen: G.g_aim_on_screen[player] }]
    : pulls;
  for (const req of polls) {
    if (l[3] > 0) break;
    PlayerOriginalTriggerPull(player, req, f);
  }
  if ((G.g_pad_state & ReloadMask(player)) !== 0
      && G.g_player_input_is_gun[player] === 0
      && G.g_player_ammo[player] !== G.g_player_magazine_size[player]) {
    PlayerReloadOriginalModeWeapon(player, f.events);
  }
}

/**
 * The trigger block of `PlayerFireOriginalModeWeapon`, for one pull.
 * `[port-only]` as a function, as {@link PlayerTriggerPull} is.
 */
function PlayerOriginalTriggerPull(player: number, req: ShotRequest,
                                   f: GunFrame): void {
  const l = G.g_original_fire_latches[player];
  if (req.onScreen === 0 || G.g_player_ammo[player] === 0) {
    if (G.g_player_input_is_gun[player] === 1 && req.onScreen === 0
        && G.g_player_ammo[player] !== G.g_player_magazine_size[player]) {
      PlayerReloadOriginalModeWeapon(player, f.events);
    }
    return;
  }
  if (G.g_nFiringGate === 0) return;
  if (G.g_app_state !== AppState.Attract
      && G.g_player_infinite_ammo[player] === 0
      && G.g_player_magazine_size[player] !== -1) {
    const mode = G.g_original_fire_mode[player];
    let take = true;
    if (mode === 1) {
      const row = ORIGINAL_FIRE_PARAMS[1];
      l[1] = row[5];
      l[3] = row[7];
      l[2] -= 1;
      if (l[2] > 0) {
        take = false;
      } else {
        l[1] = row[1];
        l[2] = row[6];
      }
    } else {
      const row = ORIGINAL_FIRE_PARAMS[mode] ?? ORIGINAL_FIRE_PARAMS[0];
      l[1] = row[5];
      l[3] = row[7];
    }
    if (take) G.g_player_ammo[player] -= 1;
  }
  if (G.g_player_ammo[player] === 0) {
    l[1] = 0;
    G.g_player_magazine_empty[player] = 1;
    G.g_player_reload_prompt_timer[player] = 0;
  }
  const own = ORIGINAL_GUNSHOT_IDS[ORIGINAL_WEAPON_SOUND_KIND] ?? 0;
  FireShotRequest(req, f.host, f.rng, f.events,
                  own !== 0 ? own : g_gunshot_sound_ids[player] ?? 0);
}

/**
 * The auto-reload block of `GameFrameTick` (`FUN_0040E730`, `0x0040E76C`).
 * `[port-only]` as a function; the engine runs it inline at the head of the
 * tick, before the app state's own frame.
 *
 * With `g_ini_autoreload` set, any player whose input mode carries the gun
 * flag (bit 31) and whose gun is empty is refilled -- `PlayerRefillMagazine`
 * written out again, down to the gated sound. `g_ini_autoreload` is 0 in the
 * installed configuration (see the field), so this returns at once.
 */
export function AutoReloadEmptyGuns(events?: Events): void {
  if (G.g_ini_autoreload === 0) return;
  for (let p = 0; p < 2; p++) {
    if ((G.g_input_mode[p] & 0x80000000) === 0) continue;
    if (G.g_player_ammo[p] !== 0) continue;
    G.g_player_ammo[p] = G.g_GameMode === GameMode.Original
      && G.g_player_magazine_size[p] !== -1
      ? G.g_player_magazine_size[p] : ARCADE_MAGAZINE;
    G.g_player_magazine_empty[p] = 0;
    if (G.g_nFiringGate !== 0) events?.emit("sound.play", { id: RELOAD_SOUND });
  }
}
