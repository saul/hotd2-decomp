/**
 * Class 0x30's dispatch entry for entry, and the per-frame and per-shot
 * routines that sit around it: `g_class30_states[0x36]`, the footstep cue,
 * `ActorUpdateBodyCondition`, the kill-move and remapped deaths, and the
 * corpse's pose.
 */
import type { CharactersJson } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { NULL_HOST } from "../../src/game/host";
import { G, ResetGameGlobals } from "../../src/game/globals";
import { MotionPlayFrame, SetGameTables } from "../../src/game/tables";
import { ZombieState } from "../../src/game/class30/states";
import { Zombie1368Flag } from "../../src/game/class30/state";
import { EnemyZombieUpdate } from "../../src/game/class30";
import { vec3 } from "../../src/game/vec";
import type { ZombieActor } from "../../src/game/actor";
import {
  check, CHARS, motion, SCENE_MAJOR_PLAYING, spawnZombie, EnterPlay, TYPE,
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

console.log("\nclass 0x30's footfalls and swishes, on exact play cursors:");
{
  // `ZombiePlayMotionFrameSe` (`0x00452A10`): clip 0xB sounds ENE_WALK3 on
  // cursors 10, 20, 30 and 1; clip 0x1C3 sounds SWORD11 on 30 alone. The
  // fixture's type gains both clips, so the switch has something to find.
  const tables = {
    ...CHARS,
    types: { "1": { ...TYPE, motions: {
      ...TYPE.motions, "11": motion(20, 0, 39), "451": motion(24, 0, 47),
    } } },
  } as unknown as CharactersJson;
  const z = zombie(ZombieState.NoOp);
  SetGameTables(tables);
  const events = new Events();
  const heard: number[] = [];
  events.on("sound.play", ({ id }) => heard.push(id));
  const tick = () => EnemyZombieUpdate(z, { ...frame(), events });
  z.motion = 0xb;
  z.playTicks = 10;
  tick();
  check("clip 0xB at cursor 10 sounds COMMON\\ENE_WALK3_16 (0x2616A9)",
        heard.length === 1 && heard[0] === 0x2616a9,
        heard.map((x) => x.toString(16)).join(","));
  check("...and latches the cursor at obj+0x1314", z.zom.seFrame === 10,
        String(z.zom.seFrame));
  tick();
  check("the same cursor a second frame sounds nothing", heard.length === 1,
        String(heard.length));
  z.playTicks = 11;
  tick();
  check("a cursor with no cue sounds nothing", heard.length === 1,
        String(heard.length));
  z.playTicks = 20;
  tick();
  check("the next cue, 20, sounds again", heard.length === 2
        && heard[1] === 0x2616a9, String(heard.length));
  // The latch is never cleared: a clip whose one cue is the cursor that last
  // sounded is silent on its next pass.
  z.motion = 0x1c3;
  z.playTicks = 30;
  tick();
  check("clip 0x1C3 at 30 swishes, COMMON\\SWORD11_22 (0x3C16A9)",
        heard.length === 3 && heard[2] === 0x3c16a9,
        heard.map((x) => x.toString(16)).join(","));
  z.playTicks = 31;
  tick();
  z.playTicks = 30 + 48;                  // one wrap of play length 47 later
  tick();
  check("...and its next pass is silent: the latch still holds 30",
        heard.length === 3 && MotionPlayFrame(z) === 30,
        `${heard.length} at cursor ${MotionPlayFrame(z)}`);
  // `TEST AL, 0x2` on `obj+0x1368` at `0x0045348F`: none in the water.
  z.motion = 0xb;
  z.playTicks = 1;
  z.zom.flags1368 |= Zombie1368Flag.InWater;
  tick();
  check("an actor in the water makes no footfall", heard.length === 3,
        String(heard.length));
  z.zom.flags1368 &= ~Zombie1368Flag.InWater;
  tick();
  check("...and out of it, cursor 1 sounds", heard.length === 4,
        String(heard.length));
}
