/**
 * Class 0x30's dispatch entry for entry, and the per-frame and per-shot
 * routines that sit around it: `g_class30_states[0x36]`, the footstep cue,
 * `ActorUpdateBodyCondition`, the kill-move and remapped deaths, and the
 * corpse's pose.
 */
import { Rng } from "../../src/core/rng";
import { NULL_HOST } from "../../src/game/host";
import { G, ResetGameGlobals } from "../../src/game/globals";
import { SetGameTables } from "../../src/game/tables";
import { ZombieState } from "../../src/game/class30/states";
import { EnemyZombieUpdate } from "../../src/game/class30";
import { vec3 } from "../../src/game/vec";
import type { ZombieActor } from "../../src/game/actor";
import {
  check, CHARS, SCENE_MAJOR_PLAYING, spawnZombie, EnterPlay,
} from "./harness";

/** A class-0x30 actor of the fixture's type 1, spawned through its `Init`. */
function zombie(init: number, desc: Record<string, unknown> = {}): ZombieActor {
  ResetGameGlobals();
  EnterPlay();
  SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_scene_state_major = SCENE_MAJOR_PLAYING;
  G.g_camera_fixed_eye_y = 0;
  G.g_players_in_play = 1;
  const z = spawnZombie(0x7a00, 1, "gaps", { initialState: init, ...desc });
  z.visible = true;
  z.hp = z.maxHp = 100;
  z.pos = vec3(0, 0, 40);
  return z;
}

const frame = (rng = new Rng(7)) => ({ dt: 1 / 60, rng, host: NULL_HOST });

console.log("\nclass 0x30's dispatch, entry for entry:");
{
  // `EnemyZombieInit` stores the descriptor's byte +2 as it stands
  // (`0x00452F36`); the router that sent anything it had not read to
  // `AttackRun` is gone.
  const z = zombie(ZombieState.NoOp);
  check("a descriptor byte of 0 starts the actor in state 0",
        z.state === ZombieState.NoOp, `state ${z.state}`);
  // `g_class30_states[0]` is `NoOpStub` (`0x0041EBB0`), a bare `RET`. The
  // dispatch's old `default` released the permit and sent the actor to
  // `WaitTurn`.
  z.attackPermit = 0;
  G.g_attack_permits[0] = z.at;
  EnemyZombieUpdate(z, frame());
  check("state 0 is the engine's no-op: the state, the sub and the permit "
        + "stand",
        z.state === ZombieState.NoOp && z.sub === 0 && z.attackPermit === 0
        && G.g_attack_permits[0] === z.at,
        `state ${z.state}/${z.sub} permit ${z.attackPermit}`);
}
{
  // `[0x31]` is `NoOpStub` too, and the five entries with no body do nothing
  // either: none of them is sent to the attack loop.
  for (const st of [ZombieState.OrderDie, ZombieState.RunPastPoint,
                    ZombieState.DelayedPounce, ZombieState.SplitLaunch,
                    ZombieState.SplitHalfCollapse,
                    ZombieState.CollapseToCondition4]) {
    const z = zombie(ZombieState.AttackRun);
    z.state = st;
    z.sub = 0;
    z.attackPermit = 0;
    G.g_attack_permits[0] = z.at;
    EnemyZombieUpdate(z, frame());
    check(`state 0x${st.toString(16)} is not sent to WaitTurn`,
          z.state === st && z.attackPermit === 0,
          `state ${z.state} permit ${z.attackPermit}`);
  }
}
