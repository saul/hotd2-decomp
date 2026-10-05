/**
 * The game-over screen's immediates: the ones the exporter and the port both
 * need.
 *
 * Data only, with no module-scope side effect, so that `hod2lib/` can import
 * it without acquiring the port -- the same arrangement as
 * `class25/state.ts`. Every value here is a `.text` immediate (a `PUSH` or a
 * `MOV` inside the routine named), and each is a **join key**: a motion the
 * exporter has to bake, a slot it has to carry, a sprite it has to decode. The
 * game-over screen's `.rdata` -- the bodies' types and clips, where they stand,
 * the route map's tiles and waypoints -- is read by `ExeTables.gameOverTables`
 * and travels in `script.json`'s `game_over` block instead. See
 * `docs/formats/bundle.md`, "The rule".
 */

/**
 * `[port-only]` -- the address each player's body and its bundle row are
 * known by. The engine keys nothing on an address; the port's bundle binds a
 * hierarchy to a placement by one, so a body needs one that no evt offset can
 * be. The class-0x46 wings take bit 30; these take bit 29. Row `p` carries the
 * body type `g_player_body_char_types[p]` (`0x00579F50`).
 */
export const PLAYER_BODY_AT: readonly number[] = [0x20000000, 0x20000001];

/** `GameOverCameraFlyTick`'s path: global slot `0x1F`, `cp_gmovr.bin`'s one. */
export const GAME_OVER_CAM_PATH = 0x1f;

/**
 * `GameOverLogoTask`'s (`FUN_00460CD0`) sprites: the plate `0x43A` and the
 * three flashes. `scr_gameover.bin`, texbank `0x155`.
 */
export const GAME_OVER_LOGO_SPRITES: readonly number[] =
  [0x43a, 0x43b, 0x43c, 0x43d];

/** One route-map figure, as `GameOverBuildRouteTasks` (`FUN_00460FF0`) makes it. */
export interface RouteFigureSpec {
  /** The character type -- the same two the bodies are. */
  charType: number;
  /** The clip it walks the route on. */
  walk: number;
  /** The clip it blends into once the route is drawn. */
  end: number;
}

/**
 * `GameOverSpawnPlayerFigure(0x39, 0x35B, 0x338, ...)` and
 * `GameOverSpawnPlayerFigure(0x3A, 0x358, 0x339, 0)` -- the player figure, by
 * which player is on the game-over screen -- and `GameOverSpawnPartnerFigure`
 * (`FUN_004617F0`), which is always type `0x3A` on `0x358` and blends `0x339`
 * (`FUN_004618C0`). `[proved]`
 */
export const ROUTE_FIGURES: readonly RouteFigureSpec[] = [
  { charType: 0x39, walk: 0x35b, end: 0x338 },
  { charType: 0x3a, walk: 0x358, end: 0x339 },
];

/** The player figure's x offset with a partner beside it: `0x18`. */
export const ROUTE_FIGURE_PAIR_OFFSET = 0x18;

/**
 * `g_route_mark_slot` (`0x007DCCE0`): the footprint model the walk leaves,
 * `0x14C2` when player 1 is on the screen and `0x14D2` for player 2 alone.
 */
export const ROUTE_MARK_SLOTS: readonly number[] = [0x14c2, 0x14d2];

/** The figure's ground disc, `AssetDrawSlot(0x145B)` under each figure. */
export const ROUTE_FIGURE_SHADOW_SLOT = 0x145b;

/**
 * The clips the `+0x80` hooks put a body on in play, each a `PUSH` immediate
 * in its routine. `PlayerHookEnterSt1Vehicle` (`FUN_00415B60`): `0x34A` for
 * player 1 of two, `0x322` for anyone else. `PlayerHookRideSt1Vehicle`
 * (`FUN_00415BD0`), on the parked car's frame 0xC: `0x334` and `0x319` the
 * same way. Which a body takes is the player count and its index, never its
 * character type, so the exporter bakes all four on both types.
 */
export const ST1_VEHICLE_SEATED_CLIP = 0x322;
export const ST1_VEHICLE_SEATED_CLIP_P2 = 0x34a;
export const ST1_VEHICLE_PARKED_CLIP = 0x319;
export const ST1_VEHICLE_PARKED_CLIP_P2 = 0x334;
export const PLAYER_ENTITY_HOOK_CLIPS: readonly number[] = [
  ST1_VEHICLE_SEATED_CLIP, ST1_VEHICLE_SEATED_CLIP_P2,
  ST1_VEHICLE_PARKED_CLIP, ST1_VEHICLE_PARKED_CLIP_P2,
];
