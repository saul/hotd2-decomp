/**
 * Class 0x64 -- **a route selector**: the one object stage 6 decides its way
 * by score and rescues with.
 *
 * `g_class_handler_pairs` gives it `0x00435FB0` (`{0x64, 0x00435FB0}`), and
 * stage 6 places it with `spawn_simple` three times -- blocks 3, 5 and 9,
 * records `{0x64, 0}`, `{0x64, 1}` and `{0x64, 2}` -- each in front of a block
 * whose route the script then reads. Nothing else spawns it. Before this
 * module the class had no entry, so each of those three blocks always left by
 * `next[0]`.
 *
 * The handler is the whole object: the pool runs it on the first walk, it
 * writes `g_script_branch_var` and it `ActorKill`s itself on every path.
 */
import type { Actor } from "../actor";
import { G } from "../globals";
import { GameMode } from "../game_mode";
import { registerClass, type ActorDebug, type ClassHandler } from "../registry";
import { SpawnClass } from "../spawn_class";

/** `g_active_player == 2`: both players are in play, and their scores add. */
const BOTH_PLAYERS = 2;
/** `CMP ..., 0x11170` -- 70000 points. */
const SCORE_ROUTE_LOW = 70000;
/** `CMP ..., 0x186A0` -- 100000 points. */
const SCORE_ROUTE_HIGH = 100000;

/** `obj+0x11C`, the `spawn_simple` record's second word. */
export enum ScoreRouteSelector {
  /** Block 3: every civilian rescued, or (Original Mode) 70000 points. */
  RescuesOrScore = 0,
  /** Block 5: Original Mode only, 100000 or 70000 points. */
  ScoreTwoTiers = 1,
  /** Block 9: under 100000 points. */
  UnderHighScore = 2,
}

/**
 * `ActorKill` (`FUN_004A7040`) as this class takes it. `[port-only]` as a
 * name, and kept in the pool dead for the reason `SkipWatchKill`
 * (`class63/index.ts`) gives: `SpawnSimpleActors` would build a selector that
 * had left the pool again.
 */
function ScoreRouteKill(obj: Actor): void {
  obj.dead = true;
  obj.visible = false;
}

/**
 * The score the selector weighs: both players' summed when both are in play
 * (`[0x009A5C6C] + [0x009A5D9C]`), otherwise the active player's
 * (`[g_active_player * 0x130 + 0x009A5C6C]`). `[port-only]` as a function;
 * the routine loads one or the other inline in each arm.
 *
 * `g_active_player` is -1 when nobody may be targeted, and the engine's index
 * then reads the word 0x130 before player 0's record; the port's array has no
 * such element and every comparison on it is false. `[open]` whether the
 * selector can run then -- each of its three spawns is in a room being played.
 */
function ScoreRouteScore(): number {
  if (G.g_active_player === BOTH_PLAYERS) {
    return (G.g_player_score[0] ?? 0) + (G.g_player_score[1] ?? 0);
  }
  return G.g_player_score[G.g_active_player];
}

/**
 * `ScoreRouteSelect64` — `FUN_00435FB0`. The handler, run once.
 *
 * ```
 * switch ((s16)obj+0x11C) {
 * case 0: branch = 0;
 *         if ((u16)g_civilians_rescued_total == g_civilians_seen_total)
 *             { branch = 1; ActorKill; }
 *         if (g_GameMode == 1 && score >= 70000) branch = 2;
 *         break;
 * case 1: branch = 0;
 *         if (g_GameMode == 1) {
 *             if (score >= 100000) { branch = 1; ActorKill; }
 *             if (score >= 70000) branch = 2;
 *         }
 *         break;
 * case 2: branch = 0;
 *         if (score < 100000) { branch = 1; ActorKill; }
 *         break;
 * }
 * ActorKill;
 * ```
 *
 * `[proved]` from the listing, `0x00435FB0`..`0x0043613D`. Every arm writes
 * the route 0 first, so a selector that finds nothing leaves the block by
 * `next[0]` whatever an earlier one wrote. Selector 2 is the only one with no
 * mode test: Arcade takes it too. Selector 0's rescue test is the run's two
 * tallies, both `u16` -- every civilian the run has created (class 0x10's,
 * class 0x21's and class 0x41 type 19's) against every rescue.
 */
export function ScoreRouteSelect64(obj: Actor): void {
  switch (obj.hp) {
    case ScoreRouteSelector.RescuesOrScore:
      G.g_script_branch_var = 0;
      // `MOV CX, word [0x009CA0EC]; CMP CX, word [0x009A21BA]` -- sixteen
      // bits each side; the port keeps the rescue tally signed.
      if ((G.g_civilians_rescued_total & 0xffff) === G.g_civilians_seen_total) {
        G.g_script_branch_var = 1;
        ScoreRouteKill(obj);
        return;
      }
      if (G.g_GameMode === GameMode.Original
          && ScoreRouteScore() >= SCORE_ROUTE_LOW) {
        G.g_script_branch_var = 2;
      }
      break;
    case ScoreRouteSelector.ScoreTwoTiers:
      G.g_script_branch_var = 0;
      if (G.g_GameMode === GameMode.Original) {
        const score = ScoreRouteScore();
        if (score >= SCORE_ROUTE_HIGH) {
          G.g_script_branch_var = 1;
          ScoreRouteKill(obj);
          return;
        }
        if (score >= SCORE_ROUTE_LOW) G.g_script_branch_var = 2;
      }
      break;
    case ScoreRouteSelector.UnderHighScore:
      G.g_script_branch_var = 0;
      if (ScoreRouteScore() < SCORE_ROUTE_HIGH) {
        G.g_script_branch_var = 1;
        ScoreRouteKill(obj);
        return;
      }
      break;
  }
  ScoreRouteKill(obj);
}

/** `[port-only]` -- the call through `obj+0x00`: the handler, on the walk. */
function ScoreRouteUpdate(obj: Actor): void {
  if (obj.cls !== SpawnClass.ScoreRouteSelect || obj.dead) return;
  ScoreRouteSelect64(obj);
}

function ScoreRouteDebug(obj: Actor): ActorDebug {
  return {
    summary: `route selector ${ScoreRouteSelector[obj.hp] ?? obj.hp}`,
    detail: [`route ${G.g_script_branch_var} · rescued `
             + `${G.g_civilians_rescued_total}/${G.g_civilians_seen_total}`],
  };
}

export const ScoreRouteHandler: ClassHandler = {
  // The pool's handler is the routine itself; the first walk runs it.
  init: () => {},
  update: ScoreRouteUpdate,
  // No hit points: `obj+0x11C` is the record's selector.
  ownsShotResult: true,
  debug: ScoreRouteDebug,
};

registerClass(SpawnClass.ScoreRouteSelect, ScoreRouteHandler);
