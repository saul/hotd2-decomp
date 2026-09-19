/**
 * The player's own body: the constants the exporter and the port both need.
 *
 * Data only, with no module-scope side effect, so that `hod2lib/` can import
 * it without acquiring the port -- the same arrangement as
 * `class25/state.ts`.
 *
 * In the exe each player has a skinned body actor, allocated by
 * `PlayerBodiesCreate` (`FUN_00416450`) into `0x009A5CD8 + p*0x130` whenever a
 * task list with the camera tasks in it is built. The port draws it in one
 * place only: the game-over fly-over, where `PlayerStateArmGameOver`
 * (`FUN_00414420`) puts it on motion `0x338` and
 * `PlayerHookDrawBodyUntilMotionEnd` (`FUN_004151D0`) draws it. See
 * `game/player_body.ts`.
 */

/**
 * `0x00579F50`, s32 per player: the body's character type -- `0x39`, whose
 * parts are `player1.bin`'s, and `0x3A`, `player2.bin`'s. `[proved]`
 *
 * In Original Mode `PlayerBodiesCreate` takes the type from the character
 * byte at `0x009A2242 + p*0x14` instead, unless that byte equals the player
 * index; and the byte's only writer, `ResetOriginalModeLoadout`
 * (`FUN_0048A0D0`), stores the player index. So both modes draw these two.
 * `[proved]`
 */
export const PLAYER_BODY_CHAR_TYPES: readonly number[] = [0x39, 0x3a];

/**
 * `0x004EC8A4`, s32 per player: the motion `PlayerBodiesCreate` builds a body
 * on. It is drawn, too: a player whose own continue countdown ran out in play
 * is already at state 6 when the game-over screen starts, so phase 0 does not
 * arm them again and their fresh body keeps this clip under the hook
 * `PlayerStateArmGameOver` installed back in app state 6. `[proved]`
 */
export const PLAYER_BODY_START_MOTIONS: readonly number[] = [0x32c, 0x32c];

/** `0x004EC8B4`, s32 per player: the motion the body falls on. `[proved]` */
export const PLAYER_GAME_OVER_MOTIONS: readonly number[] = [0x338, 0x338];

/**
 * `[port-only]` -- the address each player's body actor and its bundle row
 * are known by. The engine keys nothing on an address; the port's bundle binds
 * a hierarchy to a placement by one, so a body needs one that no evt offset
 * can be. The class-0x46 wings take bit 30; these take bit 29.
 */
export const PLAYER_BODY_AT: readonly number[] = [0x20000000, 0x20000001];

/** `GameOverCameraFlyTick`'s path: global slot `0x1F`, `cp_gmovr.bin`'s one. */
export const GAME_OVER_CAM_PATH = 0x1f;
