/**
 * What being hit costs.
 *
 * A strike costs exactly **one life** — the attack entry's `+0x0A` is the
 * damage overlay it shows, not a damage amount — plus 100 points and 90 frames
 * of invulnerability. It also drops the adaptive damage rank by 2, which is
 * how being hit makes the game easier. Outside the path camera the last life
 * cannot go: a hit there floors it at one.
 */
import type { Events } from "../../core/events";
import type { Actor } from "../actor";
import { AppState, G, PlayerState } from "../globals";
import { PROJECTION_DISTANCE_PX } from "../scene_lights";
import type { Vec3 } from "../vec";
import { ScoreAddForPlayer } from "./score";

/**
 * `CheckPlayerCanBeHit` — `FUN_004153E0`. 0 when the player may be hit: -1
 * for an index that is not 0 or 1, and -3 while a stage is being played
 * (`g_app_state == 6`) and the player is in any state but 1, 4 or 5. It does
 * **not** test lives or invulnerability -- `PlayerTakeDamage` tests the
 * window itself, on the next line.
 */
export function CheckPlayerCanBeHit(player: number): number {
  if (player !== 0 && player !== 1) return -1;
  const s = G.g_player_state[player];
  if (G.g_app_state === AppState.InPlay && s !== PlayerState.EnterContinue
      && (s < PlayerState.Continue || s > PlayerState.InPlay)) {
    return -3;
  }
  return 0;
}

/**
 * `IsPlayerAttackable` — `FUN_00409DC0`. May an enemy commit an attack here?
 *
 * It lives beside the damage because it is a question about the *player*, and
 * because `TryClaimAttackSlot` needs it: the engine voids a permit it has just
 * picked when this returns false. Note what it does **not** test —
 * `g_player_invuln_frames`. The 90-frame window after a hit stops the *damage*
 * and nothing else, so the enemies keep taking their turns through it. That is
 * the engine's answer to "why is there no pause after I am hit", and it is
 * why there is not one here either.
 *
 * The engine's three clauses, in order, all three ported:
 *
 * 1. `g_scene_state_major_entered` must be **2** — the `cam/` path camera row
 *    of `g_scene_state_table`. So nothing attacks while the follow camera or a
 *    scripted view-angle turn is driving. Measured across the port's own
 *    walker, major 2 is almost all of gameplay and major 1 minor 3
 *    (`CameraFromViewAngles`) is the brief scripted-turn spell.
 * 2. `g_app_state == 5` returns true whatever the player state — the
 *    **attract-mode override**, because the demo has no real player and would
 *    otherwise never be attacked. Inert here, but for a reason that is now
 *    stated rather than assumed: the port sits at `AppState.InPlay`, 6, which
 *    is what the engine is in while a stage runs. It used to sit at 0 and call
 *    this clause inert on the strength of "the port has no attract mode" — see
 *    `g_app_state` in `game/globals.ts` for what that cost.
 * 3. `g_player_state[player] == 5`, in play.
 *
 * The third clause used to be a stand-in -- "has a life left" -- because the
 * port seeded `g_player_state` 0 and nothing wrote 5. It reads the real
 * state now, which `game/player_shell.ts` keeps: `PlayerEnterPlay`
 * (`FUN_00414770`) puts a player at 5 and the continue takes them out.
 *
 * **Its call sites.** Nine functions in the engine call it
 * (`get_xrefs_to 0x00409DC0`, nineteen calls), and the port has all nine:
 *
 * | engine | port |
 * |---|---|
 * | `TryClaimAttackSlot` (`FUN_00455DE0`) | ✅ `combat/permits.ts` |
 * | `ThrowerTryClaimAttackSlot` (`FUN_0044CA40`) | ✅ — delegates to it |
 * | `ZombieStateLeapToPoint` ×3, `ZombieStateDelayedStrikeInPlace` ×3 |
 *   ✅ `ZombieScriptedPickPlayer`, which is the pattern both inline |
 * | `ThrowerStateGrabPlayer` ×3 | ✅ `class31/scripted.ts` |
 * | `ThrowerStateLeapStrike` | — the port has the state, and no shipped spawn
 *   can reach it |
 * | `Class32TryClaimAttackPermit` (`FUN_0047FE90`),
 *   `Class32StateLungeAtCamera` (`FUN_0047D890`) ×2 at `0x0047DAB3`/`0x0047DAD3`,
 *   `Class32ProjectileStrikePlayer` (`FUN_0047F320`) ×4 | ✅ `class32/` |
 *
 * The `player >= 0` guard is the port's own. The engine is called with -1 by
 * `TryClaimAttackSlot` and the scripted attackers, reads `g_player_state`
 * 0x130 bytes below the array, and relies on whatever is there not being 5.
 */
export function IsPlayerAttackable(player: number): boolean {
  if (G.g_scene_state_major_entered !== SCENE_STATE_PATH_CAMERA) return false;
  if (G.g_app_state === AppState.Attract) return true;
  if (player < 0) return false;
  return G.g_player_state[player] === PlayerState.InPlay;
}

/**
 * The scene state's major that `IsPlayerAttackable` demands — row 2 of
 * `g_scene_state_table`, the `cam/` path cameras. See `EvtEnterSceneState`
 * (`FUN_00403BD0`) for the whole table.
 */
const SCENE_STATE_PATH_CAMERA = 2;

// -- what a hit costs ------------------------------------------------------
//
// `.text` immediates, so they live here rather than in the bundle — see
// `docs/formats/bundle.md`. Every one of them is a literal inside
// `PlayerTakeDamage` (`FUN_00415300`); none of them is an entry in a table
// the exporter could read.

/** A strike costs exactly one life. There is no variable damage. */
const PLAYER_LIFE_COST = 1;
/** ...and 100 points, applied once per hit. */
const PLAYER_HIT_SCORE = -100;
/** Frames of invulnerability after a hit — `0x5A`. */
const PLAYER_INVULN_FRAMES = 90;
/**
 * ...and the adaptive rank drops by this, which is how being hit makes the
 * game easier. `UpdateDamageRank` consumes it.
 */
const PLAYER_HIT_RANK_DELTA = -2;

/**
 * `PlayerTakeDamage` — `FUN_00415300`.
 *
 * One function for every damage source, three arguments: the player, whether
 * to raise the hit latch, and the motion the player plays. Refused for player
 * -1, for a player `CheckPlayerCanBeHit` turns away, inside the player's own
 * invulnerability window, and in the attract demo. Otherwise, unless the
 * player's `g_player_no_damage` byte is set: a life, 100 points through
 * `ScoreAddForPlayer` (so the score floors at 0), and the rank. Then the
 * latch, 0x5A frames, and -- **only outside scene major 2**, the path camera
 * -- the floor at one life. On the path camera the last life can go, and
 * `PlayerUpdateInPlay` (`FUN_00413E90`) takes the player out of play the next
 * frame.
 *
 * `latch` is the engine's second argument: 1 at every call site but
 * `ActorStrikeConnect`'s (`FUN_00456490`) despawning arm, which passes 0.
 * `src`, `source` and `attack` are not the exe's -- they feed the
 * `player.damaged` event the HUD and the feed hear it by.
 *
 * The rank change goes into `g_damage_rank_pending` (`0x009A3794`), and
 * `UpdateDamageRank` (`FUN_004607B0`) folds it in and clamps it on the frame's
 * `RunSceneTasksAndTimers`.
 */
export function PlayerTakeDamage(player: number, latch: number,
                                 overlayKind: number, events?: Events,
                                 src: Actor | null = null,
                                 source: "strike" | "thrown" = "strike",
                                 attack = -1): boolean {
  if (player === -1) return false;
  if (CheckPlayerCanBeHit(player) !== 0
      || G.g_player_invuln_frames[player] !== 0
      || G.g_app_state === AppState.Attract) {
    return false;
  }
  if (G.g_player_no_damage[player] === 0) {
    G.g_player_lives[player] -= PLAYER_LIFE_COST;
    G.g_damage_rank_pending += PLAYER_HIT_RANK_DELTA;
    ScoreAddForPlayer(player, PLAYER_HIT_SCORE, events);
  }
  if (latch !== 0) {
    G.g_player_was_hit[player] = 1;
    G.g_player_damage_overlay_kind[player] = overlayKind;
  }
  G.g_player_invuln_frames[player] = PLAYER_INVULN_FRAMES;
  PlayerFloorLivesOffPath(player);
  events?.emit("player.damaged", {
    source,
    at: src?.at ?? -1,
    who: src?.name ?? "—",
    attack,
    lives: G.g_player_lives[player],
    score: G.g_player_score[player],
  });
  return true;
}

/**
 * `[port-only]` -- the last three lines both damage routines end on, named so
 * they are one rule: off the path camera (`g_scene_state_major_entered` and
 * `g_scene_state_major` both not 2) a player with no lives is given one back.
 */
function PlayerFloorLivesOffPath(player: number): void {
  if (G.g_scene_state_major_entered !== SCENE_STATE_PATH_CAMERA
      && G.g_scene_state_major !== SCENE_STATE_PATH_CAMERA
      && G.g_player_lives[player] < 1) {
    G.g_player_lives[player] = 1;
  }
}

/**
 * `PlayerTakeDamageTimed` — `FUN_00415430`. `PlayerTakeDamage` with two more
 * arguments: `ignoreInvuln` lets the hit through the window, and
 * `invulnFrames` (-1 for "leave it") sets the window it opens. It does not test
 * the attract demo, and it does not refuse player -1 before calling
 * `CheckPlayerCanBeHit`, which refuses it anyway.
 *
 * `[open]` **Nothing in the image calls it** -- no `CALL 0x00415430` exists.
 * The port's two callers, the class-0x31 thrown weapon and class 0x10's shot,
 * were attributed to it before that was checked; the weapon's engine routine,
 * `ThrownWeaponFlyToTarget` (`FUN_0044FD40`), calls `PlayerTakeDamage`
 * (`player, 1, 6`), and now does so here too. Class 0x10's engine call has not
 * been found and is left on this routine with its default arguments.
 */
export function PlayerTakeDamageTimed(player: number, latch: number,
                                      overlayKind: number, ignoreInvuln = 0,
                                      invulnFrames = -1, events?: Events,
                                      src: Actor | null = null): boolean {
  if (CheckPlayerCanBeHit(player) !== 0) return false;
  if (G.g_player_invuln_frames[player] !== 0 && ignoreInvuln === 0) {
    return false;
  }
  if (G.g_player_no_damage[player] === 0) {
    G.g_player_lives[player] -= PLAYER_LIFE_COST;
    G.g_damage_rank_pending += PLAYER_HIT_RANK_DELTA;
    ScoreAddForPlayer(player, PLAYER_HIT_SCORE, events);
  }
  if (latch !== 0) {
    G.g_player_was_hit[player] = 1;
    G.g_player_damage_overlay_kind[player] = overlayKind;
  }
  if (invulnFrames !== -1) G.g_player_invuln_frames[player] = invulnFrames;
  PlayerFloorLivesOffPath(player);
  events?.emit("player.damaged", {
    source: "thrown",
    at: src?.at ?? -1,
    who: src?.name ?? "—",
    attack: -1,
    lives: G.g_player_lives[player],
    score: G.g_player_score[player],
  });
  return true;
}

/** `[0x004EC8DC]` -304, `[0x004EC8D8]` 304, `[0x004EC8D4]` -224, `[0x004EC8D0]` 224. */
const ON_SCREEN_MIN_X = -304.0;
const ON_SCREEN_MAX_X = 304.0;
const ON_SCREEN_MIN_Y = -224.0;
const ON_SCREEN_MAX_Y = 224.0;
/** `PUSH -0x64` at `0x004155AD` -- the second hundred a hit from here costs. */
const ON_SCREEN_HIT_SCORE = -0x64;

/**
 * `PlayerTakeDamageIfOnScreen` — `FUN_00415500`. `(view point, latch,
 * motion)`, for a strike that is a thing flying at the screen rather than an
 * enemy's arm:
 *
 * ```
 * x = -(g_projection_distance_px * p.x / p.z)     ; both stored as floats
 * y = -(g_projection_distance_px * p.y / p.z)
 * if (-304 < x && x < 304 && -224 < y && y < 224) {
 *   p = (g_players_in_play == 2) ? (x < 0 ? 0 : 1) : g_active_player
 *   PlayerTakeDamage(p, latch, motion); ScoreAddForPlayer(p, -100); r = 1
 * } else r = 0
 * off the path camera, each player's lives at or below 0 become 1
 * return r
 * ```
 *
 * `[proved]`. With two players in play the half of the screen it lands in
 * picks who pays; the hundred it takes is on top of the hundred
 * `PlayerTakeDamage` takes itself, and is taken even when the window refused
 * the damage. The floor is both players' (`0x009A5C66` and `0x009A5D96`), not
 * the one hit. Class 0x2D's satellites are its callers here.
 */
export function PlayerTakeDamageIfOnScreen(p: Vec3, latch: number,
                                           motion: number,
                                           events?: Events): number {
  const d = Math.fround(PROJECTION_DISTANCE_PX);
  const x = Math.fround(-(d * p.x / p.z));
  const y = Math.fround(-(d * p.y / p.z));
  let r = 0;
  if (ON_SCREEN_MIN_X < x && x < ON_SCREEN_MAX_X
      && ON_SCREEN_MIN_Y < y && y < ON_SCREEN_MAX_Y) {
    const who = G.g_players_in_play === 2 ? (x < 0 ? 0 : 1) : G.g_active_player;
    PlayerTakeDamage(who, latch, motion, events);
    ScoreAddForPlayer(who, ON_SCREEN_HIT_SCORE, events);
    r = 1;
  }
  if (G.g_scene_state_major_entered !== SCENE_STATE_PATH_CAMERA
      && G.g_scene_state_major !== SCENE_STATE_PATH_CAMERA) {
    if (G.g_player_lives[0] <= 0) G.g_player_lives[0] = 1;
    if (G.g_player_lives[1] <= 0) G.g_player_lives[1] = 1;
  }
  return r;
}
