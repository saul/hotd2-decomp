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
  BuildShotRay, FireShotRequest, TakeDueShotRequests, g_gunshot_sound_ids,
  type ShotRequest,
} from "./combat/shot";
import { GameMode } from "./game_mode";
import { AppState, G } from "./globals";
import type { GameHost } from "./host";
import type { Rng } from "../core/rng";
import { T } from "./tables";

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
 * `g_player_shot_count` count and its `0x009A5C48` guard are
 * `FireShotRequest`'s first lines (`combat/shot.ts`).
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
 * mode's row of `g_original_fire_params` (`0x00579ED8`, the bundle's
 * `original_mode.fire_params`) into the player's four auto-fire latches. A
 * bundle written before the block has no rows and leaves them.
 */
export function OriginalWeaponLoadFireParams(player: number): void {
  const row = T.originalMode?.fire_params[G.g_original_fire_mode[player]];
  if (!row) return;
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
  const id = T.originalMode?.reload_ids[G.g_original_weapon_sound_kind[player]]
    ?? 0;
  events?.emit("sound.play", { id: id !== 0 ? id : RELOAD_SOUND });
}

/**
 * `PlayerFireOriginalModeWeapon` — `FUN_00414B90`. The Original Mode twin:
 * the same trigger block against the magazine instead of the literal, with a
 * burst machine in the four latches, and `PlayerReloadOriginalModeWeapon`
 * for both reloads.
 *
 * The latches, `+0x10..+0x13` of the block (`g_original_fire_params`' first
 * four bytes on every load): `[3]` counts down once a frame, floored at 0,
 * and while it is above 0 nothing fires; `[1] == 1` fires a round with no
 * pull at all. Each round reloads `[1]` and `[3]` from bytes 5 and 7 of the
 * fire mode's row, so the MACHINE GUN (mode 2: 1 and 2) empties itself a
 * round every other frame off one pull, and the GRENADE (mode 3: 0 and 4)
 * waits four frames between rounds. The SHOTGUN (mode 1) also counts `[2]`
 * down from row 1's byte 6, 3: its pull fires three rounds, two frames apart,
 * and only the third takes a shell -- and the second and third are thrown
 * off the crosshair by `rand() % 0x40` across and `rand() % 0x30` down, each
 * signed by a `rand() % 2`, in that order.
 *
 * Every round's ray is `BuildShotRay` of the crosshair as it stands. A pull
 * brings the page's, which is that ray; an owed round and a thrown pellet
 * build it here.
 *
 * `[diverges]` The spread is not written into `g_crosshair_x/y`. The engine
 * writes it there, and the frame after, `FUN_00415710` copies the aim record
 * back over it; the port's crosshair is the pointer's own, written only when
 * the pointer moves, so a write here would stay until it did -- and the next
 * pellet would be thrown from where the last one landed. The shot is the
 * same; what differs is the crosshair sprite, which in the engine jumps with
 * the pellet for that one frame.
 */
export function PlayerFireOriginalModeWeapon(player: number,
                                             f: GunFrame): void {
  const l = G.g_original_fire_latches[player];
  l[3] = s8(l[3] - 1);
  if (l[3] < 1) l[3] = 0;
  const pulls = TakeDueShotRequests(player);
  // The round owed with no pull, built where the engine builds every one.
  const owed = l[1] === 1 && !pulls.length
    ? BuildShotRay(G.g_crosshair_x[player], G.g_crosshair_y[player]) : null;
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

/** `(s8)`, as the latch bytes are counted. */
const s8 = (v: number): number => ((v & 0xff) << 24) >> 24;

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
  const rows = T.originalMode?.fire_params;
  if (G.g_app_state !== AppState.Attract
      && G.g_player_infinite_ammo[player] === 0
      && G.g_player_magazine_size[player] !== -1) {
    const mode = G.g_original_fire_mode[player];
    let take = true;
    if (mode === 1) {
      const row = rows?.[1];
      if (row) {
        l[1] = row[5];
        l[3] = row[7];
      }
      l[2] = s8(l[2] - 1);
      if (l[2] > 0) {
        take = false;
      } else if (row) {
        l[1] = row[1];
        l[2] = row[6];
      }
    } else {
      const row = rows?.[mode];
      if (row) {
        l[1] = row[5];
        l[3] = row[7];
      }
    }
    if (take) G.g_player_ammo[player] -= 1;
  }
  if (G.g_player_ammo[player] === 0) {
    l[1] = 0;
    G.g_player_magazine_empty[player] = 1;
    G.g_player_reload_prompt_timer[player] = 0;
  }
  let shot = req;
  if (G.g_original_fire_mode[player] === 1 && l[2] !== 2) {
    // `rand() % 2`, `rand() % 0x40`, `rand() % 2`, `rand() % 0x30`, in that
    // order (`0x00414CE0..0x00414D3F`): each offset signed `1 - 2 * coin`.
    const sx = f.rng.int(2);
    const mx = f.rng.int(0x40);
    const sy = f.rng.int(2);
    const my = f.rng.int(0x30);
    const x = (sx * -2 + 1) * mx + G.g_crosshair_x[player];
    const y = (sy * -2 + 1) * my + G.g_crosshair_y[player];
    shot = { ...req, ray: BuildShotRay(x, y) };
  }
  const own =
    T.originalMode?.gunshot_ids[G.g_original_weapon_sound_kind[player]] ?? 0;
  FireShotRequest(shot, f.host, f.rng, f.events,
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
