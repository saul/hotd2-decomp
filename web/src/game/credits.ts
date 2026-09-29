/**
 * Credits: what a start press and a continue spend.
 *
 * On the PC there is no coin slot. The title menu's confirm seeds the count
 * from the mode -- six for Arcade at the factory options, six for Original,
 * one for Training and Boss -- and every start and every continue takes one.
 * The first start is one of them, so an Arcade game has five continues.
 *
 * `SetBothPlayerCounters`'s annotation had what it counts as an open question;
 * the spends settle it. `CreditTrySpend` is the only caller of the two spend
 * routines, `PlayerTryStartPress` is the only caller of that, and it passes "is
 * this player in the continue state" as the kind -- so the count is of starts
 * and continues. `[proved]`
 */
import { AppState, G } from "./globals";
import { GameMode } from "./game_mode";

/**
 * `ModeStartCounterValue` — `FUN_00496B70`. The credits a mode starts with:
 * Original 6, Training and Boss 1, Arcade the options' credit setting plus
 * one, or -1 (free play) when that setting is -1.
 */
export function ModeStartCounterValue(mode: number): number {
  if (mode === GameMode.Original) return 6;
  if (mode > GameMode.Original && mode < 4) return 1;
  if (G.g_option_credits === -1) return -1;
  return G.g_option_credits + 1;
}

/**
 * `SetBothPlayerCounters` — `FUN_00406F60`. -1 is free play
 * (`FUN_00407000`), anything else a count (`FUN_00407030(0)` first clears
 * free play); then both counts take the value and `CreditTiersUpdate` runs.
 */
export function SetBothPlayerCounters(n: number): void {
  if (n === -1) {
    G.g_free_play = 1;
    G.g_credits = [0, 0];
    CreditTiersUpdate();
  } else {
    G.g_free_play = 0;
    G.g_credits = [0, 0];
    CreditTiersUpdate();
  }
  G.g_credits = [n, n];
  CreditTiersUpdate();
}

/**
 * `CreditTiersUpdate` — `FUN_00407060`. The 0/1/2 beside each count: 2 in
 * free play or while the count covers the last spend's kind, 1 while it does
 * not, 0 at none. Read by the HUD's credit line only.
 */
export function CreditTiersUpdate(): void {
  if (G.g_credits_per_player !== 0) {
    for (let p = 0; p < 2; p++) {
      if (G.g_free_play === 1) G.g_credit_tier[p] = 2;
      else if (G.g_credits[p] === 0) G.g_credit_tier[p] = 0;
      else {
        G.g_credit_tier[p] = 2 - (G.g_credits[p]
          < CreditCost(G.g_credit_is_continue[p]) ? 1 : 0);
      }
    }
    return;
  }
  if (G.g_free_play === 1) { G.g_credit_tier[0] = 2; return; }
  if (G.g_credits[0] === 0) { G.g_credit_tier[0] = 0; return; }
  G.g_credit_tier[0] = 2 - (G.g_credits[0]
    < CreditCost(G.g_credit_is_continue[0]) ? 1 : 0);
}

/** `g_credits_to_start` or `g_credits_to_continue`, by kind. */
function CreditCost(isContinue: number): number {
  return isContinue !== 0 ? G.g_credits_to_continue : G.g_credits_to_start;
}

/**
 * `CreditCount` — `FUN_00406780`. The shared count, or this player's when
 * counts are per player.
 */
export function CreditCount(player: number): number {
  if (G.g_credits_per_player === 0) return G.g_credits[0];
  return G.g_credits[player];
}

/**
 * `CreditsAvailable` — `FUN_00406ED0`. 1 in free play; otherwise whether any
 * count covers a start or a continue (`FUN_00406F00` shared,
 * `FUN_00406F20` per player).
 */
export function CreditsAvailable(): number {
  if (G.g_free_play === 1) return 1;
  if (G.g_credits_per_player === 0) {
    return (G.g_credits[0] < G.g_credits_to_start
            && G.g_credits[0] < G.g_credits_to_continue) ? 0 : 1;
  }
  for (let p = 0; p < 2; p++) {
    if (!(G.g_credits[p] < G.g_credits_to_start
          && G.g_credits[p] < G.g_credits_to_continue)) return 1;
  }
  return 0;
}

/**
 * `CreditTrySpend` — `FUN_00406DC0`. Only in play, or on the title once a
 * mode has been confirmed; then the shared or the per-player spend.
 */
export function CreditTrySpend(player: number, isContinue: number): number {
  if (G.g_app_state !== AppState.InPlay
      && (G.g_app_state !== AppState.Title || G.g_title_start_armed === 0)) {
    return 0;
  }
  if (G.g_credits_per_player === 0) {
    return CreditSpendShared(player, isContinue);
  }
  return CreditSpendPerPlayer(player, isContinue);
}

/** `CreditSpendShared` — `FUN_00406E10`. */
export function CreditSpendShared(player: number, isContinue: number): number {
  G.g_credit_is_continue[player] = isContinue;
  if (G.g_free_play === 1) return 1;
  const cost = CreditCost(isContinue);
  if (G.g_credits[0] < cost) return 0;
  G.g_credits[0] -= cost;
  return 1;
}

/** `CreditSpendPerPlayer` — `FUN_00406E70`. */
export function CreditSpendPerPlayer(player: number,
                                     isContinue: number): number {
  G.g_credit_is_continue[player] = isContinue;
  if (G.g_free_play === 1) return 1;
  const cost = CreditCost(isContinue);
  if (cost <= G.g_credits[player]) {
    G.g_credits[player] -= cost;
    return 1;
  }
  return 0;
}
