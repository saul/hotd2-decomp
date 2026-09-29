/**
 * The PC input mode: which device each player's port is, as the exe keeps it
 * -- `g_input_mode_p1` (`0x00588E24`) and `g_input_mode_p2` (`0x007DC698`),
 * `G.g_input_mode` here.
 *
 * `InputInit` (`FUN_0041E2D0`) chooses them at boot from the configured
 * devices through `InputModesFromDeviceConfig` (`FUN_0041E440`), and the one
 * runtime writer is the network game: `NetApplyPeerInput` (`FUN_0049EE10`)
 * calls `SetPlayerInputModes` every network frame with this machine's own
 * mode in its slot and **the peer's mode, byte `+0x14` of the peer's packet**,
 * in the other (`NetBuildInputPacket`, `FUN_004A02F0`, puts it there), and
 * `NetSessionClose` (`FUN_0049F040`) puts both back. `[proved]`
 *
 * What reads the mode in the port: `HudDrawCrosshair` (modes 5 and 6 draw the
 * crosshair at once), the options list (Sight Graphic is editable in mode 6,
 * Gun Calibration is offered to a gun outside it) and `GameFrameTick`'s
 * auto-reload (bit 31).
 *
 * The page's pointer is two of these devices, and which one is the page's
 * question, answered in `app/`: a mouse is mode 6, the mouse and the keyboard;
 * a finger is the light gun -- it fires where it lands, and nothing points
 * before it does -- player 1's mode `0xD`. See `app/device.ts`.
 */
import { G } from "./globals";

/**
 * The input modes `InputModesFromDeviceConfig` (`FUN_0041E440`) and
 * `InputMapDevicesToMaple` (`FUN_0041E530`) switch on, low sixteen bits.
 * Bit 31 is a separate gun flag (`FUN_0041EDC0`), which a joystick can carry.
 * `[proved]`
 */
export enum InputMode {
  /** No device: configured index 0. */
  None = 0,
  /** The keyboard as a standard controller (maple flag 1): index 1. */
  Keyboard = 3,
  /** The mouse alone, as a gun (flag 0x80): three buttons. */
  Mouse = 5,
  /**
   * The mouse as a gun with the keyboard's pad ORed into its word -- case 6
   * ORs and falls into case 5 -- index 2, and `InputInit`'s fallback for
   * player 1.
   */
  MouseKeyboard = 6,
  /** The first joystick; `7 + n` is joystick `n`, up to `0xC`. */
  Joystick0 = 7,
  /**
   * The MC PC light gun on player 1's port -- a configured device of type
   * `0x104` -- read through `DeviceIoControl` (`FUN_0041F660`, gun 0).
   */
  LightGun1 = 0xd,
  /** ...and on player 2's (gun 1). */
  LightGun2 = 0xe,
}

/**
 * `SetPlayerInputModes` — `FUN_0041E240`. Both players' modes at once.
 * `[proved]`
 */
export function SetPlayerInputModes(p1: number, p2: number): void {
  G.g_input_mode[0] = p1;
  G.g_input_mode[1] = p2;
}

/**
 * `GetPlayerInputModes` — `FUN_0041E260`. Both players' modes, the way its
 * two out-parameters hand them back. `[proved]`
 */
export function GetPlayerInputModes(): [number, number] {
  return [G.g_input_mode[0], G.g_input_mode[1]];
}
