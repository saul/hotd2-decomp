/**
 * What being hit costs.
 *
 * A strike costs exactly **one life** — the attack entry's `+0x0A` is the
 * motion the player plays, not a damage amount — plus 100 points and 90 frames
 * of invulnerability. It also drops the adaptive damage rank by 2, which is
 * how being hit makes the game easier.
 */
import type { Events } from "../../core/events";
import type { Actor } from "../actor";
import { G } from "../globals";

/**
 * `CheckPlayerCanBeHit` — `FUN_004153E0`. The invulnerability window, which is
 * why a second zombie swinging on the same frame does not cost a second life.
 */
export function CheckPlayerCanBeHit(player: number): boolean {
  return G.g_player_lives[player] > 0 && G.g_player_invuln_frames <= 0;
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
 * The engine's three clauses, in order, and two of them are ported:
 *
 * 1. `g_scene_state_major_entered` must be **2** — the `cam/` path camera row
 *    of `g_scene_state_table`. So nothing attacks while the follow camera or a
 *    scripted view-angle turn is driving. Measured across the port's own
 *    walker, major 2 is almost all of gameplay and major 1 minor 3
 *    (`CameraFromViewAngles`) is the brief scripted-turn spell.
 * 2. `g_app_state == 5` returns true whatever the player state — the
 *    **attract-mode override**, because the demo has no real player and would
 *    otherwise never be attacked. Inert here; the port has no attract mode.
 * 3. `g_player_state[player] == 5`, in play.
 *
 * [diverges] **The third clause is a stand-in.** Nothing in the port ever
 * writes `g_player_state = 5`: every writer is the game's shell — attract,
 * continue, name entry, game over — reached through the per-player hook the
 * scene-state table installs at `_DAT_009A5CDC`, an indirect call the port has
 * no equivalent of. Until that shell exists, "is this player in play" is
 * answered by the thing that stands in for it, which is that the player has a
 * life left. `g_player_lives` floors at one for the same reason.
 *
 * **Its call sites.** Eight functions in the engine call it; the port has
 * modules for four of them and all four now do:
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
 * | `FUN_0047FE90`, and two calls at 0x0047DAB3/0x0047DAD3 | — unread, in
 *   classes the port has no module for |
 *
 * The `player >= 0` guard is the port's own. The engine is called with -1 by
 * `TryClaimAttackSlot` and the scripted attackers, reads `g_player_state`
 * 0x130 bytes below the array, and relies on whatever is there not being 5.
 */
export function IsPlayerAttackable(player: number): boolean {
  if (G.g_scene_state_major_entered !== SCENE_STATE_PATH_CAMERA) return false;
  if (G.g_app_state === APP_STATE_ATTRACT) return true;
  if (player < 0) return false;
  if (G.g_player_state[player] === PLAYER_STATE_IN_PLAY) return true;
  return (G.g_player_lives[player] ?? 0) > 0;
}

/**
 * The scene state's major that `IsPlayerAttackable` demands — row 2 of
 * `g_scene_state_table`, the `cam/` path cameras. See `EvtEnterSceneState`
 * (`FUN_00403BD0`) for the whole table.
 */
const SCENE_STATE_PATH_CAMERA = 2;
/** `g_app_state` while the attract demo runs; the override's value. */
const APP_STATE_ATTRACT = 5;
/** `g_player_state` for a player who is in play. */
const PLAYER_STATE_IN_PLAY = 5;

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
 * One function for every damage source. The melee strike and the thrown weapon
 * both land here and the engine does not care which: that duplication is
 * exactly what the two hand-written callbacks in the old `main.ts` had grown.
 *
 * `events` is not the exe's — the engine sets `g_player_was_hit` and lets the
 * player entity notice next frame. The global is still written; the event is
 * how the HUD and the feed hear about it without polling.
 */
export function PlayerTakeDamage(player: number, src: Actor | null,
                                 hitMotion: number, events?: Events,
                                 source: "strike" | "thrown" = "strike",
                                 attack = -1): boolean {
  if (!CheckPlayerCanBeHit(player)) return false;

  // [diverges] Floored at **one**, not zero. Reaching zero is the continue
  // sequence, and this port has none: the engine's `g_player_state`
  // (0x009A5C62) leaves 5 and `IsPlayerAttackable` above then makes
  // every enemy stand down, so a player who runs out simply stops being
  // attacked and the script freezes on `g_evt_gameplay_live`. With neither of
  // those modelled, a run that hit zero left the player alive, unattackable by
  // nothing, and the scene running on — which reads as the enemies breaking.
  // Until there is a player state to lose, there is no last life to lose
  // either. Named on purpose: this is a stand-in, not the rule.
  G.g_player_lives[player] =
    Math.max(1, G.g_player_lives[player] - PLAYER_LIFE_COST);
  G.g_player_score[player] += PLAYER_HIT_SCORE;
  G.g_player_invuln_frames = PLAYER_INVULN_FRAMES;
  G.g_player_was_hit[player] = 1;
  G.g_player_hit_motion[player] = hitMotion;
  // Being hit drops the adaptive rank by two, floored at zero.
  G.g_damage_rank =
    Math.max(0, G.g_damage_rank - Math.abs(PLAYER_HIT_RANK_DELTA));
  // A non-head hit ends the headshot chain; taking one certainly does.
  G.g_head_combo_bonus[player] = 0;

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
 * `PlayerTakeDamageTimed` — `FUN_00415430`. The same, from a source that
 * schedules its own hit frame; the thrown weapon's expiry is one.
 */
export function PlayerTakeDamageTimed(player: number, src: Actor | null,
                                      hitMotion: number,
                                      events?: Events): boolean {
  return PlayerTakeDamage(player, src, hitMotion, events, "thrown", -1);
}

/** Count down the invulnerability window. One 60 Hz frame per call. */
export function TickPlayerInvulnerability(frames: number): void {
  G.g_player_invuln_frames = Math.max(0, G.g_player_invuln_frames - frames);
}
