/**
 * Class 0x64 -- stage 6's route selector, `ScoreRouteSelect64`
 * (`FUN_00435FB0`), placed by `spawn_simple` and run on its first walk.
 */
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { GameUpdate, SpawnSimpleActors } from "../../src/game/director";
import { G, ResetGameGlobals } from "../../src/game/globals";
import { NULL_HOST } from "../../src/game/host";
import { GameMode } from "../../src/game/game_mode";
import { SpawnClass } from "../../src/game/spawn_class";
import { check, EnterPlay, JoinPlayerTwo } from "./harness";

console.log("\nclass 0x64, stage 6's route selector:");

/**
 * One selector, as the script places it: `ResetGameGlobals`, the run's state
 * set, the `spawn_simple` record, one frame -- and the route it left.
 */
function route(sel: number, mode: GameMode, scores: [number, number],
               players: 1 | 2, rescued: number, seen: number,
               earlier = 7): { branch: number; dead: boolean } {
  G.g_GameMode = mode;
  ResetGameGlobals();
  EnterPlay();
  // Who is weighed is `SelectAttackablePlayer`'s answer, which the frame
  // computes from the players in play -- so the second player joins the way
  // a second player does, and `g_active_player` is never written here.
  if (players === 2) JoinPlayerTwo();
  G.g_player_score = [...scores];
  G.g_civilians_rescued_total = rescued;
  G.g_civilians_seen_total = seen;
  // A route an earlier writer left: every arm writes 0 before it decides.
  G.g_script_branch_var = earlier;
  const at = -0x7000 - sel;
  SpawnSimpleActors([{ at, class: SpawnClass.ScoreRouteSelect, hp: sel }]);
  GameUpdate(1 / 60, NULL_HOST, new Rng(64), new Events());
  const obj = G.g_object_list.find((o) => o.at === at);
  return { branch: G.g_script_branch_var, dead: !!obj?.dead };
}

const A = GameMode.Arcade, O = GameMode.Original;

// Selector 0, block 3: every civilian rescued, or 70000 in Original Mode.
{
  const r = route(0, A, [90000, 0], 1, 5, 5);
  check("0: every civilian the run saw was rescued -- route 1, in Arcade too",
        r.branch === 1 && r.dead, JSON.stringify(r));
  check("0: one short, Arcade -- route 0 whatever the score",
        route(0, A, [90000, 0], 1, 4, 5).branch === 0);
  check("0: one short, Original Mode at 70000 -- route 2",
        route(0, O, [70000, 0], 1, 4, 5).branch === 2);
  check("0: ...and at 69999 -- route 0",
        route(0, O, [69999, 0], 1, 4, 5).branch === 0);
  check("0: two players add their scores (40000 + 30000) -- route 2",
        route(0, O, [40000, 30000], 2, 4, 5).branch === 2);
  check("0: one player is weighed alone (player 0's 40000) -- route 0",
        route(0, O, [40000, 30000], 1, 4, 5).branch === 0);
  check("0: the tallies compare in sixteen bits",
        route(0, A, [0, 0], 1, -1, 0xffff).branch === 1);
}

// Selector 1, block 5: Original Mode only, two tiers.
{
  check("1: Arcade -- route 0 at any score",
        route(1, A, [150000, 0], 1, 0, 9).branch === 0);
  check("1: Original Mode at 100000 -- route 1",
        route(1, O, [100000, 0], 1, 0, 9).branch === 1);
  check("1: ...at 99999 -- route 2",
        route(1, O, [99999, 0], 1, 0, 9).branch === 2);
  check("1: ...at 69999 -- route 0",
        route(1, O, [69999, 0], 1, 0, 9).branch === 0);
  check("1: two players' 60000 + 40000 -- route 1",
        route(1, O, [60000, 40000], 2, 0, 9).branch === 1);
}

// Selector 2, block 9: under 100000, in either mode.
{
  check("2: under 100000 -- route 1, in Arcade too",
        route(2, A, [99999, 0], 1, 0, 0).branch === 1);
  const r = route(2, O, [100000, 0], 1, 0, 0);
  check("2: at 100000 -- route 0, and the selector is gone",
        r.branch === 0 && r.dead, JSON.stringify(r));
}
