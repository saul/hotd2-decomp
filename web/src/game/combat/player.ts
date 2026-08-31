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
import { T } from "../tables";

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
 * [diverges] The engine tests the scene state, the app state and the per-player
 * state word at `g_player_state`; the port has none of those and tests the one
 * thing that stands in for all three — the player is alive.
 */
export function IsPlayerAttackable(player: number): boolean {
  return player >= 0 && (G.g_player_lives[player] ?? 0) > 0;
}

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

  const d = T.player;
  G.g_player_lives[player] =
    Math.max(0, G.g_player_lives[player] - (d?.life_cost ?? 1));
  G.g_player_score[player] += d?.score ?? -100;
  G.g_player_invuln_frames = d?.invuln_frames ?? 90;
  G.g_player_was_hit[player] = 1;
  G.g_player_hit_motion[player] = hitMotion;
  // Being hit drops the adaptive rank by two, floored at zero.
  G.g_damage_rank = Math.max(0, G.g_damage_rank - Math.abs(d?.rank_delta ?? 2));
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
