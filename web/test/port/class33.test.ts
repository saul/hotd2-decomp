import type { CharactersJson } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { ActorSpawn, GameUpdate } from "../../src/game/director";
import { ProcessPlayerShotsTestList, ShotTestListReset } from "../../src/game/combat/shot_test";
import { QueueShotRequest } from "../../src/game/combat/shot";
import {
  G, HIT_SLOT_NONE, ResetGameGlobals, ResetSceneOnEnter,
} from "../../src/game/globals";
import { NULL_HOST } from "../../src/game/host";
import { AnglesToward, SpriteEffectKind } from "../../src/game/effects/sprite";
import { SetGameTables, T } from "../../src/game/tables";
import { ColiPublishDynamicList, ColiTraceSegmentAllSets } from "../../src/game/coli";
import { MotionRow, ZombieState } from "../../src/game/class30/states";
import { ZombieStateHoldAtRange } from "../../src/game/class30/hold";
import { ActorPlayHitVoice, ActorVoice }
  from "../../src/game/combat/voice";
import { ZombieReleaseWeaponLoopSe } from "../../src/game/class30/weapon_loop";
import {
  ActorFlag, ZombieFlag2, type Actor, type ScriptedSceneryActor,
  type ZombieActor,
} from "../../src/game/actor";
import { ScriptedCarrierUpdate33, ScriptedPushableUpdate33,
         ScriptedScenerySelector } from "../../src/game/class33";
import { SCENERY_SKIP_COLLISION } from "../../src/game/class33/pushable";
import { EnemyZombieUpdate } from "../../src/game/class30";
import { HIT_SLOT_CLAIMED } from "../../src/game/hit_slots";
import { ZombiePushOutOfWorldAndActors } from "../../src/game/class30/ground";
import { SpawnClass } from "../../src/game/spawn_class";
import { g_class_handlers } from "../../src/game/registry";
import { vec3 } from "../../src/game/vec";
import {
  MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixTranslate,
  MatrixTransformPoint,
} from "../../src/game/matrix";
import { RunPendingInits, SpawnSlotActors } from "../../src/game/director";
import {
  check, TYPE, CHARS, SCENE_MAJOR_PLAYING, spawnZombie, EnterPlay, coliQuad,
  scene,
} from "./harness";

/**
 * `spawnZombie` with an events bus, for the one `Init` in the game that makes
 * a sound.
 *
 * `EnemyZombieInitByCharType` (`FUN_00452FD0`) starts the looping chainsaw for
 * character types 2 and 3, so `ActorSpawn` carries `events` through to
 * `ClassHandler.init`. Going through `ActorSpawn` rather than calling the
 * weapon-loop functions directly is the point of the fixture: it is the wiring
 * from the spawn opcode down to the sound that was missing, not the arithmetic.
 */
function spawnZombieWithEvents(at: number, charType: number, name: string,
                               events: Events): ZombieActor {
  const a = ActorSpawn(at, SpawnClass.Zombie, charType, name, undefined,
                       new Rng(1), events);
  if (a.cls !== SpawnClass.Zombie) throw new Error("not class 0x30");
  return a;
}

// -- class 0x33 selector 1: the carrier -------------------------------------

console.log("\nclass 0x33 selector 1: the carrier, and the room it opens:");
{
  // Stage 5's own descriptor, evt `0x1CE4`, as the bundle carries it. The
  // numbers are the shipped ones on purpose: the room this class was ported
  // for is held by *these* cues and not by a shape.
  const STAGE5 = () => ({
    slot: 0x1b0e, shot_mesh: -1, shot_radius: 0.1,
    path: 382, path_end: 590, effect_frame: 580,
    commit_frame: 230, despawn_frame: 650,
    commit_flag: 0xff, despawn_flag: 0xff,
    effect: [678.8, -70, -2616.5, 0, 0, 0],
  });
  // Stage 2's `0x12590`: no effect frame at all, and a commit that fires.
  const STAGE2 = () => ({
    slot: 0x1a35, shot_mesh: 0x0cec69a8, shot_radius: 0,
    path: 338, path_end: 420, effect_frame: -1,
    commit_frame: 360, despawn_frame: -1,
    commit_flag: 0xff, despawn_flag: 128,
    effect: [0, 0, -0.9, 4.8, 2.5, 0],
  });

  const CARRIER_AT = 0x1ce4;
  const CAM_AT_SPAWN = 231;

  const makeCarrier = (tail: ReturnType<typeof STAGE5>,
                       camFrame = CAM_AT_SPAWN): ScriptedSceneryActor => {
    G.g_cam_path_frame = camFrame;
    const a = ActorSpawn(CARRIER_AT, SpawnClass.ScriptedScenery, -1, "carrier",
                         { class33: tail as Actor["class33"],
                           hp: ScriptedScenerySelector.Carrier,
                           maxHp: ScriptedScenerySelector.Carrier });
    if (a.cls !== SpawnClass.ScriptedScenery) throw new Error("not class 0x33");
    a.visible = true;
    return a;
  };
  const reset = () => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    G.g_players_in_play = 1;
    G.g_camera_fixed_eye_y = 0;
  };
  const carrierFrame = () => ({ dt: 1 / 60, rng: new Rng(5),
                                host: NULL_HOST });
  const tick = (c: ScriptedSceneryActor, n: number) => {
    for (let i = 0; i < n; i++) {
      if (c.despawned) return;
      ScriptedCarrierUpdate33(c, carrierFrame());
    }
  };

  // -- the cursor ----------------------------------------------------------
  {
    reset();
    const c = makeCarrier(STAGE5());
    check("the Init publishes `g_carrier_object` before a frame has run",
          G.g_carrier_object === CARRIER_AT, String(G.g_carrier_object));
    tick(c, 1);
    check("`obj+0x1370` opens on `g_cam_path_frame`, which is "
          + "`g_cam_path_frame - 1` seeded and then stepped once",
          c.scenery.pathFrame === CAM_AT_SPAWN, String(c.scenery.pathFrame));
    // The seed is the camera's; the counter after it is not. Move the camera
    // by a hundred frames and the cursor must not notice.
    G.g_cam_path_frame += 100;
    tick(c, 10);
    check("...and then it is the object's own clock, not the camera's",
          c.scenery.pathFrame === CAM_AT_SPAWN + 10,
          String(c.scenery.pathFrame));
    check("...and the shot sphere is `tail+0x08` in both radii",
          c.hitRadius === 0.1 && c.bodyRadius === 0.1,
          `${c.hitRadius}/${c.bodyRadius}`);
  }

  // -- the two bits --------------------------------------------------------
  {
    reset();
    const c = makeCarrier(STAGE5());
    // The cues are read at the **top** of the frame, against the cursor the
    // previous frame's ride left, so the first tick puts the cursor on
    // `CAM_AT_SPAWN` and `n` ticks put it on `CAM_AT_SPAWN + n - 1`.
    tick(c, 580 - CAM_AT_SPAWN + 1);
    check("nothing is up while the ride is still running",
          (c.flags & (ActorFlag.Reacting | ActorFlag.Committed)) === 0,
          `flags 0x${(c.flags >>> 0).toString(16)} cursor ${c.scenery.pathFrame}`);
    check("...and the cursor has reached the descriptor's effect frame",
          c.scenery.pathFrame === 580, String(c.scenery.pathFrame));
    tick(c, 1);
    check("`obj+0x34` bit 0x40000000 goes up on the frame the cursor equals "
          + "`tail+0x14` — the bit state 32 is waiting for",
          (c.flags & ActorFlag.Reacting) !== 0,
          `flags 0x${(c.flags >>> 0).toString(16)}`);
    check("...and stage 5's carrier never raises 0x10000000, because its "
          + "commit frame (230) is behind where the script spawns it (231)",
          (c.flags & ActorFlag.Committed) === 0,
          `flags 0x${(c.flags >>> 0).toString(16)}`);
    check("...and the fire is not up yet", (c.flags & ActorFlag.FireLoop) === 0);
    // The frame that raises the bit also runs the counter, so it is already at
    // 1 here and the fire is `0x13` frames away.
    check("...and `obj+0x1334` is counting from that same frame",
          c.scenery.effectFrames === 1, String(c.scenery.effectFrames));
    tick(c, 0x12);
    check("...the fire waits the 0x14 frames `obj+0x1334` counts",
          (c.flags & ActorFlag.FireLoop) === 0,
          `after ${c.scenery.effectFrames}`);
    tick(c, 1);
    check("...and then it is up", (c.flags & ActorFlag.FireLoop) !== 0,
          `after ${c.scenery.effectFrames}`);
    check("...and stage 5's cursor has already stopped on `tail+0x10` (590)",
          c.scenery.pathFrame === 590, String(c.scenery.pathFrame));
  }
  {
    // `0x004333B8` falls through to `0x004333BB`: the fire does not return.
    // The port once did, from pseudocode that ended early, and froze the
    // carrier where it burned. Stage 5's own numbers cannot tell the two
    // apart -- its ride has ended ten frames before the fire -- so the
    // descriptor's end is moved past the fire.
    reset();
    const c = makeCarrier({ ...STAGE5(), path_end: 700 });
    const sounds: number[] = [];
    const events = new Events();
    events.on("sound.play", (e) => sounds.push(e.id));
    const frame = () => ({ ...carrierFrame(), events });
    for (let i = 0; i < 580 - CAM_AT_SPAWN + 2 + 0x13; i++) {
      ScriptedCarrierUpdate33(c, frame());
    }
    check("a carrier whose ride outlasts its effect is burning by now",
          (c.flags & ActorFlag.FireLoop) !== 0,
          `after ${c.scenery.effectFrames}`);
    const burning = c.scenery.pathFrame;
    for (let i = 0; i < 30; i++) ScriptedCarrierUpdate33(c, frame());
    check("...and it rides on while it burns -- the fire is drawn and the "
          + "routine carries on into its ride",
          c.scenery.pathFrame === burning + 30,
          `${burning} -> ${c.scenery.pathFrame}`);
    G.g_cam_path_frame = 650;
    ScriptedCarrierUpdate33(c, frame());
    check("...and leaves on its camera cue with `CAR_FIRE_22_OFF` (0x823A9), "
          + "the sound only a burning carrier's despawn plays",
          c.despawned && sounds.at(-1) === 0x823a9,
          `despawned ${c.despawned} last 0x${(sounds.at(-1) ?? 0).toString(16)}`);
  }
  {
    reset();
    const c = makeCarrier(STAGE2());
    tick(c, 360 - CAM_AT_SPAWN + 1);
    check("...and nothing is up on the frame the cursor *reaches* the commit "
          + "frame, because the cue is read before the ride steps",
          (c.flags & ActorFlag.Committed) === 0,
          `cursor ${c.scenery.pathFrame}`);
    tick(c, 1);
    check("stage 2's carrier raises 0x10000000 on its own commit frame — the "
          + "bit `ZombieStateRideCarrier` leaves on",
          (c.flags & ActorFlag.Committed) !== 0,
          `cursor ${c.scenery.pathFrame}`);
    check("...and never 0x40000000, because its `tail+0x14` is -1.0",
          (c.flags & ActorFlag.Reacting) === 0,
          `flags 0x${(c.flags >>> 0).toString(16)}`);
    check("...and `tail+0x04 != -1` puts it on the mesh test, bit 0x10",
          (c.flags & 0x10) !== 0, `flags 0x${(c.flags >>> 0).toString(16)}`);
    // `tail+0x10` is 420: past it the cursor freezes rather than running on.
    tick(c, 200);
    check("...and the cursor stops at `tail+0x10` rather than running past it",
          c.scenery.pathFrame === 420, String(c.scenery.pathFrame));
  }

  // -- the two ways off the field -----------------------------------------
  {
    reset();
    const c = makeCarrier(STAGE5());
    tick(c, 10);
    G.g_cam_path_frame = 650;
    tick(c, 1);
    check("the camera reaching `tail+0x1C` despawns it", c.despawned);
  }
  {
    reset();
    const c = makeCarrier({ ...STAGE5(), despawn_flag: 0x80 });
    tick(c, 10);
    check("a carrier whose despawn flag is down stays", !c.despawned);
    G.g_script_flags[0x80] = 1;
    tick(c, 1);
    check("...and goes when the script raises it", c.despawned);
  }
  {
    // `CMP dword ptr [0x9a6458], EBX` at `0x004333DF`: the despawn also takes
    // camera block 2's path frame, which is always 0 -- so a despawn frame
    // of 0 leaves on the first frame whatever block 0's is. No shipped
    // carrier's is 0 (650 or -1).
    reset();
    const c = makeCarrier({ ...STAGE5(), despawn_frame: 0 });
    tick(c, 1);
    check("a carrier whose despawn frame is 0 goes at once, on block 2's "
          + "frame (`0x004333DF`)",
          c.despawned && G.g_cam_path_frame === CAM_AT_SPAWN,
          `despawned ${c.despawned} frame ${G.g_cam_path_frame}`);
  }

  // -- the draw ------------------------------------------------------------
  //
  // `0x004332DA`..`0x0043382F`, read off the listing. The pose is off the
  // path on purpose: a turn and a tilt in every angle, so a draw that took
  // the wrong word, or none, cannot land on the right point.
  {
    const POSE = { x: 12, y: 3, z: -40, pitch: 0x0400, yaw: 0x2000, roll: 0x0200 };
    const host = { ...NULL_HOST, objectPath: () => ({ ...POSE }) };
    const frame = () => ({ ...carrierFrame(), host });
    const at = (m: number[], x: number, y: number, z: number) => {
      const out = vec3();
      MatrixTransformPoint(m, vec3(x, y, z), out);
      return out;
    };
    const near = (a: { x: number; y: number; z: number },
                  b: { x: number; y: number; z: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-3;

    // Stage 2 block 9's boat, slot 0x1A36 -- the one the user found missing.
    reset();
    const boat = makeCarrier({ ...STAGE2(), slot: 0x1a36 });
    ScriptedCarrierUpdate33(boat, frame());
    const d = boat.scenery.draws;
    check("the boat draws its own slot, `obj+0x13F0`, first",
          d[0]?.slot === 0x1a36, d.map((x) => x.slot.toString(16)).join());
    check("...at the ride's position", near(at(d[0].m, 0, 0, 0), POSE),
          JSON.stringify(at(d[0].m, 0, 0, 0)));
    // `obj+0x118` is 2.5 for this slot (`0x004339E1`): a unit along any of
    // the model's axes is 2.5 in the world.
    const ax = at(d[0].m, 1, 0, 0);
    check("...scaled by `obj+0x118`, 2.5 for slots 0x1A35 and 0x1A36",
          Math.abs(Math.hypot(ax.x - POSE.x, ax.y - POSE.y, ax.z - POSE.z)
                   - 2.5) < 1e-4);
    check("...and its yaw is the path's plus a quarter turn, `obj+0x68`",
          boat.yaw === POSE.yaw + 0x4000, String(boat.yaw));
    check("...then the two sprite loops, from 0x24A and 0x260, while the "
          + "ride runs", d.length === 3 && d[1].slot === 0x24a
            && d[2].slot === 0x260,
          d.map((x) => x.slot.toString(16)).join());
    // The loops sit 25 along the object's own Z without the 2.5: the same
    // point as 10 along the model's.
    check("...25 units along the object's Z, outside the model's scale",
          near(at(d[1].m, 0, 0, 0), at(d[0].m, 0, 0, 10)),
          `${JSON.stringify(at(d[1].m, 0, 0, 0))} vs ${JSON.stringify(at(d[0].m, 0, 0, 10))}`);
    for (let i = 0; i < 0x16; i++) ScriptedCarrierUpdate33(boat, frame());
    check("...each loop stepped after its draw and wrapped at its 22nd slot",
          boat.scenery.draws[1]?.slot === 0x24a
            && boat.scenery.draws[2]?.slot === 0x260,
          boat.scenery.draws.map((x) => x.slot.toString(16)).join());
    for (let i = 0; i < 200; i++) ScriptedCarrierUpdate33(boat, frame());
    check("...and once `tail+0x10` ends the ride, the model alone",
          boat.scenery.draws.length === 1
            && boat.scenery.draws[0].slot === 0x1a36,
          boat.scenery.draws.map((x) => x.slot.toString(16)).join());

    // Stage 5's car: five parts, the wheels turning `0x2000` a frame.
    reset();
    const car = makeCarrier(STAGE5());
    ScriptedCarrierUpdate33(car, frame());
    check("stage 5's car draws 0x1B0E, then 0x899, both wheels, 0x1B0A and "
          + "0x1B0D, and no sprite loop",
          car.scenery.draws.map((x) => x.slot).join()
            === [0x1b0e, 0x899, 0x8cb, 0x8cb, 0x1b0a, 0x1b0d].join(),
          car.scenery.draws.map((x) => x.slot.toString(16)).join());
    check("...the car itself at scale 1.0, `obj+0x118`'s other value",
          Math.abs(Math.hypot(...(() => {
            const p = at(car.scenery.draws[0].m, 1, 0, 0);
            return [p.x - car.pos.x, p.y - car.pos.y, p.z - car.pos.z];
          })()) - 1) < 1e-4);
    check("...5 units short of the path in x (`0x004339CD`)",
          car.pos.x === POSE.x - 5, String(car.pos.x));
    // The two wheels share an axle line through the object: 0x8CB at
    // (0, 3.5437, 17.0281) and (0, 3.5437, -12.384) of the object's frame.
    const front = at(car.scenery.draws[2].m, 0, 0, 0);
    const back = at(car.scenery.draws[3].m, 0, 0, 0);
    check("...the wheels 29.41 apart along the car",
          Math.abs(Math.hypot(front.x - back.x, front.y - back.y,
                              front.z - back.z) - (17.0281 + 12.384)) < 1e-3);
    ScriptedCarrierUpdate33(car, frame());
    check("...and `obj+0x135C` turns them 0x2000 a frame",
          car.scenery.wheelTurn === 0x4000, String(car.scenery.wheelTurn));

    // The fire: at the descriptor's point, the first slot 0x1AAC.
    reset();
    const lit = makeCarrier(STAGE5());
    for (let i = 0; i < 580 - CAM_AT_SPAWN + 2 + 0x13; i++) {
      ScriptedCarrierUpdate33(lit, frame());
    }
    const fire = lit.scenery.draws[0];
    check("the fire is drawn first, from 0x1AAC -- the cursor steps before "
          + "its draw",
          (lit.flags & ActorFlag.FireLoop) !== 0 && fire?.slot === 0x1aac,
          `${fire?.slot.toString(16)} flags 0x${(lit.flags >>> 0).toString(16)}`);
    check("...at the descriptor's effect point, `tail+0x24`, not the car's",
          near(at(fire.m, 0, 0, 0), { x: 678.8, y: -70, z: -2616.5 }),
          JSON.stringify(at(fire.m, 0, 0, 0)));
    check("...and the car is still drawn behind it",
          lit.scenery.draws[1]?.slot === 0x1b0e);
  }

  // -- stage 5 block 2's room, end to end ---------------------------------
  //
  // Four class-0x30 spawns in state 32 and the class-0x33 object the script
  // puts beside them. `ZombieStateDelayedStrikeInPlace` (`FUN_0045E830`) has
  // exactly one exit and it is this carrier's bit; state 10 is
  // `ZombieReleaseAndDespawn` (`FUN_00455490`), which is what actually takes
  // them out of `g_enemies_alive`. Both halves have to be right for the gate
  // at step 2 op 50 to come down, and neither was.
  const room = (tail: ReturnType<typeof STAGE5>) => {
    reset();
    for (let i = 0; i < 4; i++) {
      const z = spawnZombie(0x1d44 + i * 0x30, 1, `znnick ${i}`, {
        initialState: ZombieState.DelayedStrikeInPlace,
        attackState: ZombieState.AttackRun,
        entry: { delay: 2, rearm: 4, player: 0 } as Actor["entry"],
      });
      z.visible = true;
      z.hp = z.maxHp = 130;
      // Where the script puts them, and where this state leaves them.
      z.pos = vec3(-10 + i * 7, 0, 2870);
    }
    makeCarrier(tail);
    const rng = new Rng(11);
    const events = new Events();
    let clearedAt = -1;
    for (let f = 0; f < 900; f++) {
      GameUpdate(1 / 60, NULL_HOST, rng, events);
      if (clearedAt < 0 && G.g_enemies_alive === 0) clearedAt = f;
    }
    return clearedAt;
  };
  {
    check("four state-32 zombies count themselves in",
          (() => { reset();
                   const z = spawnZombie(0x1d44, 1, "znnick", {
                     initialState: ZombieState.DelayedStrikeInPlace,
                     attackState: ZombieState.AttackRun,
                     entry: { delay: 2, rearm: 4, player: 0 } as Actor["entry"],
                   });
                   z.visible = true;
                   return G.g_enemies_alive === 1; })(),
          String(G.g_enemies_alive));
    const at = room(STAGE5());
    // 580 - 231 to the bit, then the 0x14 + 1 frames `obj+0x1334` counts.
    check("stage 5 block 2's room empties itself, and on the frame the "
          + "descriptor says: `wait_enemies_alive <= 0` can come down",
          at > 0 && Math.abs(at - ((580 - CAM_AT_SPAWN) + 0x15)) <= 3,
          `cleared at frame ${at}`);
    check("...and every one of the four left the pool rather than parking in "
          + "a state, which is what the counter is measuring",
          G.g_object_list.filter((o) => o.cls === SpawnClass.Zombie).length === 0,
          `${G.g_object_list.length} objects left`);
  }
  {
    // The counterfactual, and it is the shape of the bug that was here: a
    // carrier that never raises the bit is four zombies that never leave.
    const at = room({ ...STAGE5(), effect_frame: -1 });
    check("...and a carrier whose `tail+0x14` is -1.0 never releases them, "
          + "which is what the room looked like with no class 0x33 at all",
          at === -1 && G.g_enemies_alive === 4,
          `cleared at ${at}, ${G.g_enemies_alive} alive`);
  }

  // -- state 10 is a despawn, not a rejoin ---------------------------------
  {
    reset();
    const z = spawnZombie(0x1dd4, 1, "state 10", {
      initialState: ZombieState.AttackRun, attackState: ZombieState.AttackRun,
    });
    z.visible = true;
    z.hp = z.maxHp = 130;
    z.pos = vec3(0, 0, 2870);
    const before = G.g_enemies_alive;
    z.state = ZombieState.Leave;
    z.sub = 0;
    EnemyZombieUpdate(z, { dt: 1 / 60, rng: new Rng(2),
                           host: NULL_HOST });
    check("`g_class30_states[10]` is `ZombieReleaseAndDespawn`, so state 10 "
          + "removes the actor rather than sending it to WaitTurn",
          z.despawned && z.state === ZombieState.Leave,
          `state ${z.state} despawned ${z.despawned}`);
    check("...and both counters come back with it",
          before === 1 && G.g_enemies_alive === 0 && G.g_enemies_present === 0,
          `${before} -> ${G.g_enemies_alive}/${G.g_enemies_present}`);
  }

  // -- `ZombieAttachToCarrier`: the three zombies really are on the car -----
  //
  // `ZombieAttachToCarrier` (`FUN_0045E770`), reached from
  // `EnemyZombieInitByCharType` (`FUN_00452FD0`, 0x0045301D) at spawn and from
  // `EnemyZombieUpdate` (`FUN_004533F0`, 0x00453424) every frame afterwards.
  //
  // The report these assertions exist for said three stage-5 `znnick` should
  // be travelling with the car and were standing 2870 away; the port's own
  // comment said 2870 was where the descriptor put them and "the distance was
  // never the bug". The descriptor settles it: what it holds is an offset, not
  // a position, and every number below is the shipped one.
  //
  //   evt 0x1D44  init_flags 0x20008  (-4.6, 10.0, -16.5)  yaw 16384
  //   evt 0x1D74  init_flags 0x20008  (-4.6,  5.0,  -2.6)  yaw 16384
  //   evt 0x1DA4  init_flags 0x20008  (-4.6,  5.0,   7.0)  yaw 16384
  //
  // `L26`: the divergence at the bottom is pinned by an assertion, because a
  // note saying what somebody meant is not a statement about what runs.
  {
    // The three offsets, and the point stage 5's carrier descriptor fires its
    // own effect at -- `tail+0x24`, which is where the car is at cursor 580.
    const RIDERS: [number, [number, number, number]][] = [
      [0x1d44, [-4.6, 10.0, -16.5]],
      [0x1d74, [-4.6, 5.0, -2.6]],
      [0x1da4, [-4.6, 5.0, 7.0]],
    ];
    const CAR_AT_EFFECT = vec3(678.8, -70, -2616.5);
    const SHIPPED_FLAGS = 0x20008;
    const DESC_YAW = 16384;

    const seatOne = (at: number, off: [number, number, number],
                     flags = SHIPPED_FLAGS): ZombieActor => {
      const z = spawnZombie(at, 1, `znnick ${at.toString(16)}`, {
        flags, yaw: DESC_YAW, pos: vec3(off[0], off[1], off[2]),
        initialState: ZombieState.DelayedStrikeInPlace,
        attackState: ZombieState.AttackRun,
        entry: { delay: 2, rearm: 4, player: 0 } as Actor["entry"],
      });
      z.visible = true;
      z.hp = z.maxHp = 130;
      return z;
    };

    reset();
    const car = makeCarrier(STAGE5());
    car.pos = vec3(CAR_AT_EFFECT.x, CAR_AT_EFFECT.y, CAR_AT_EFFECT.z);
    car.yaw = 0;
    const riders = RIDERS.map(([at, off]) => seatOne(at, off));

    check("descriptor flag bit 3 raises `obj+0x136C` 0x10000000 and 0x100000, "
          + "so the actor is a passenger before a frame has run",
          riders.every((z) => (z.flags2 & ZombieFlag2.AttachedToCarrier) !== 0
                           && (z.flags2 & ZombieFlag2.Carried) !== 0),
          riders.map((z) => (z.flags2 >>> 0).toString(16)).join(" "));
    check("...and the descriptor position is stashed at `obj+0x13D8` rather "
          + "than kept as a world position",
          riders.every((z, i) => z.strikeStart.x === RIDERS[i][1][0]
                              && z.strikeStart.y === RIDERS[i][1][1]
                              && z.strikeStart.z === RIDERS[i][1][2]),
          riders.map((z) => `${z.strikeStart.x},${z.strikeStart.z}`).join(" "));
    check("...and `obj+0x135C` holds the descriptor yaw",
          riders.every((z) => z.zom.throwHand === DESC_YAW),
          riders.map((z) => z.zom.throwHand).join(" "));
    // `MatrixRotateY(carrier+0x68)` then `MatrixRotateY(0x8000)`: with the
    // car's own yaw at zero the seat is a half turn, so x and z negate.
    check("the Init seats them on the car, x and z through the half turn at "
          + "`0x0045E7A6`",
          riders.every((z, i) =>
            Math.abs(z.pos.x - (CAR_AT_EFFECT.x - RIDERS[i][1][0])) < 1e-3
            && Math.abs(z.pos.y - (CAR_AT_EFFECT.y + RIDERS[i][1][1])) < 1e-3
            && Math.abs(z.pos.z - (CAR_AT_EFFECT.z - RIDERS[i][1][2])) < 1e-3),
          riders.map((z) => `(${z.pos.x.toFixed(1)},${z.pos.y.toFixed(1)},`
                          + `${z.pos.z.toFixed(1)})`).join(" "));
    check("...and the yaw is the composed one plus `obj+0x135C`, truncated to "
          + "s16 the way `__ftol` leaves it",
          riders.every((z) => z.yaw === -0x8000 + DESC_YAW),
          riders.map((z) => z.yaw).join(" "));
    // The whole of the report: they are ON the car, two and a half thousand
    // units from the world origin the port was leaving them at.
    check("...so they are within a metre of the car and nowhere near the "
          + "origin, which is where `d≈2870` was measured from",
          riders.every((z) => Math.hypot(z.pos.x - car.pos.x,
                                         z.pos.z - car.pos.z) < 20
                           && Math.hypot(z.pos.x, z.pos.z) > 2000),
          riders.map((z) => Math.hypot(z.pos.x, z.pos.z).toFixed(0)).join(" "));

    // Now drive. `ZombieStateDelayedStrikeInPlace` moves nothing at all, so if
    // the re-seat were in the state rather than in front of it, this fails.
    car.pos.x += 300;
    car.pos.z += 500;
    for (const z of riders) {
      EnemyZombieUpdate(z, { dt: 1 / 60, rng: new Rng(3),
                             host: NULL_HOST });
    }
    check("`EnemyZombieUpdate` re-seats them every frame, so they travel with "
          + "the car while sitting in a state that never moves an actor",
          riders.every((z, i) =>
            Math.abs(z.pos.x - (car.pos.x - RIDERS[i][1][0])) < 1e-3
            && Math.abs(z.pos.z - (car.pos.z - RIDERS[i][1][2])) < 1e-3),
          riders.map((z) => `(${z.pos.x.toFixed(1)},`
                          + `${z.pos.z.toFixed(1)})`).join(" "));
    // A quarter turn of the car swings the bed round with it.
    car.yaw = 0x4000;
    EnemyZombieUpdate(riders[0], { dt: 1 / 60, rng: new Rng(3),
                                   host: NULL_HOST });
    check("...and the car's yaw turns the seat, not just the model",
          Math.abs(riders[0].pos.x - (car.pos.x - RIDERS[0][1][2])) < 1e-3
          && Math.abs(riders[0].pos.z - (car.pos.z + RIDERS[0][1][0])) < 1e-3,
          `(${riders[0].pos.x.toFixed(1)},${riders[0].pos.z.toFixed(1)})`);
  }
  {
    // The counterfactual, and it is exactly what the port did before: the same
    // descriptor without bit 3 stays where the position field says, which is
    // beside the world origin whatever the car does.
    reset();
    const car = makeCarrier(STAGE5());
    car.pos = vec3(678.8, -70, -2616.5);
    const z = spawnZombie(0x1d44, 1, "no bit 3", {
      flags: 0x20000, yaw: 16384, pos: vec3(-4.6, 10.0, -16.5),
      initialState: ZombieState.DelayedStrikeInPlace,
      attackState: ZombieState.AttackRun,
      entry: { delay: 2, rearm: 4, player: 0 } as Actor["entry"],
    });
    z.visible = true;
    z.hp = z.maxHp = 130;
    for (let i = 0; i < 60; i++) {
      EnemyZombieUpdate(z, { dt: 1 / 60, rng: new Rng(4),
                             host: NULL_HOST });
    }
    check("without descriptor bit 3 the same spawn stays at the position "
          + "field, beside the origin — the behaviour this section corrects",
          (z.flags2 & ZombieFlag2.AttachedToCarrier) === 0
          && Math.hypot(z.pos.x, z.pos.z) < 20,
          `(${z.pos.x.toFixed(1)},${z.pos.z.toFixed(1)})`);
  }
  {
    // [diverges] The engine dereferences `g_carrier_object` with no null test
    // (`0x0045E781`). The port cannot, so the seat is skipped and the actor
    // keeps its descriptor offset. Asserted rather than described, because the
    // arm is unreachable in the shipped data and a note would be all there is.
    reset();
    G.g_carrier_object = -1;
    const z = spawnZombie(0x1d44, 1, "no carrier", {
      flags: 0x20008, yaw: 16384, pos: vec3(-4.6, 10.0, -16.5),
      initialState: ZombieState.DelayedStrikeInPlace,
      attackState: ZombieState.AttackRun,
      entry: { delay: 2, rearm: 4, player: 0 } as Actor["entry"],
    });
    z.visible = true;
    EnemyZombieUpdate(z, { dt: 1 / 60, rng: new Rng(6),
                           host: NULL_HOST });
    check("[diverges] with no carrier the seat is skipped and the actor keeps "
          + "its offset, where the engine would follow a null pointer",
          (z.flags2 & ZombieFlag2.AttachedToCarrier) !== 0
          && z.pos.x === -4.6 && z.pos.z === -16.5,
          `(${z.pos.x},${z.pos.z})`);
  }
}


/**
 * The two sounds a zombie makes that are not shot feedback, and the one kind
 * of `ActorPlayHitVoice` that turns out to be dead.
 *
 * `ActorPlayHitVoice` (`FUN_0040A6F0`) is the game's only voice routine and
 * every one of its five kinds fires on an event, so for a long time the answer
 * to "what does a standing zombie sound like" was `[open]`. It is two bare
 * `PlaySoundId` calls, in two different places, and neither goes through that
 * routine:
 *
 * * `ZombieStateHoldAtRange` (`FUN_00455720`) plays `0x1917A9` --
 *   `COMMON2\ZOMBIE_041_16.wav` -- at `0x004558D6`, inside the same
 *   `obj+0x1B4 != row[0]` test that starts the idle clip;
 * * `EnemyZombieInitByCharType` (`FUN_00452FD0`) plays `0x4D17A9` at
 *   `0x0045314F` for character types 2 and 3, which `g_looping_se_ids` makes a
 *   **loop**, and `ZombieReleaseWeaponLoopSe` (`FUN_00456600`) stops it.
 *
 * Both were silent in the port. These assertions fail on the code before this
 * commit, which is the only thing that makes them worth having.
 */
console.log("\nthe idle groan, the weapon loop, and kind 4:");
{
  const GROAN = 0x1917a9;
  const CHAIN_SAW_LOOP = 0x4d17a9;
  const CHAIN_SAW_STOP = 0x4e17a9;
  const LASER_SWORD_LOOP = 0x1f25a9;

  /** Every `sound.play` id an events bus saw, in order. */
  const listen = (events: Events): number[] => {
    const ids: number[] = [];
    events.on("sound.play", (d) => { ids.push(d.id); });
    return ids;
  };
  const clear = () => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    G.g_players_in_play = 1;
  };

  // -- C1. the groan fires on the frame the idle starts, and only then ------
  //
  // `004558b0 3bc7` / `004558b2 742a` is the whole gate. A zombie arriving at
  // the ring is not yet playing `row[0]`, so the first update starts the clip
  // and groans; the second finds the clip already running and does neither.
  {
    clear();
    const events = new Events();
    const heard = listen(events);
    const z = spawnZombie(0x7a00, 1, "arriving at the ring");
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.attackState = 1;
    z.state = ZombieState.HoldAtRange;
    z.sub = 0;
    z.pos = vec3(0, 0, 40);
    z.target = vec3(0, 0, 0);
    // Something other than the idle -- the run clip, which is what an actor
    // that has just arrived is still playing.
    z.motion = TYPE.motion_row["0"][MotionRow.Run];
    ZombieStateHoldAtRange(z, new Rng(7), NULL_HOST, events);
    check("a zombie that reaches the ring groans once -- `PlaySoundId(0x1917A9)`"
          + " at 0x004558D6",
          heard.length === 1 && heard[0] === GROAN,
          heard.map((i) => `0x${i.toString(16)}`).join(",") || "silence");
    check("...and the clip it groans on is the idle, `row[0]`",
          z.motion === TYPE.motion_row["0"][MotionRow.Walk],
          String(z.motion));
    const after = heard.length;
    for (let i = 0; i < 30; i++) {
      ZombieStateHoldAtRange(z, new Rng(7), NULL_HOST, events);
    }
    check("...and does not groan again while the same idle clip runs -- it is "
          + "one shot per entry, not a per-frame chance or a timer",
          heard.length === after, `${heard.length - after} more`);
  }


  // -- C1b. ...and it is silent when the actor arrives already idling --------
  //
  // The same `CMP` read the other way, and it is why the groan is rarer in
  // play than "every time a zombie stands still": `ZombieStateApproach` plays
  // `row[(obj+0x136C >> 0x15) & 1]`, and for the `row[0]` half of that pair
  // the walk in **is** the clip the hub wants, so the hub changes nothing and
  // says nothing. A zombie that arrives from the retreat (`row[4]`) or from an
  // attack run (`row[2]`/`row[3]`) or off the back of a swing does groan --
  // measured on stage 1 block 4, where the walkers reach the ring silently.
  {
    clear();
    const events = new Events();
    const heard = listen(events);
    const z = spawnZombie(0x7a02, 1, "arriving already on row[0]");
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.attackState = 1;
    z.state = ZombieState.HoldAtRange;
    z.sub = 0;
    z.pos = vec3(0, 0, 40);
    z.target = vec3(0, 0, 0);
    z.motion = TYPE.motion_row["0"][MotionRow.Walk];
    ZombieStateHoldAtRange(z, new Rng(7), NULL_HOST, events);
    check("an actor that walks in already playing `row[0]` does not groan -- "
          + "the approach's own clip is the idle, so the hub changes nothing",
          heard.length === 0,
          heard.map((i) => `0x${i.toString(16)}`).join(","));
  }

  // -- C1c. ...and it does when the actor comes back from the retreat -------
  //
  // `ZombieStateBackOff` plays `row[4]`, so an actor returning to the hub
  // after a swing is on a clip the hub does not want and gets both the idle
  // and the groan. This is the path that makes the noise in play.
  {
    clear();
    const events = new Events();
    const heard = listen(events);
    const z = spawnZombie(0x7a03, 1, "back from the retreat");
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.attackState = 1;
    z.state = ZombieState.HoldAtRange;
    z.sub = 0;
    z.pos = vec3(0, 0, 40);
    z.target = vec3(0, 0, 0);
    z.motion = TYPE.motion_row["0"][MotionRow.BackAway];
    // The strike anchor, because that is what a returning actor carries -- and
    // without it the hub would send it back into the retreat before the idle.
    z.flags2 |= ZombieFlag2.StrikeAnchor;
    ZombieStateHoldAtRange(z, new Rng(7), NULL_HOST, events);
    check("...and one coming back on `row[4]` groans again, which is the path "
          + "that actually sounds in play",
          heard.length === 1 && heard[0] === GROAN,
          heard.map((i) => `0x${i.toString(16)}`).join(",") || "silence");
  }

  // -- C2. ...and it is not `ActorPlayHitVoice` -----------------------------
  //
  // The distinction is the whole reason the idle was never found: the voice
  // routine has a kind for the attack cry and none for an idle, so reading it
  // more carefully could never have turned this up. Kind 4 is the other half
  // of that reading, and it is dead.
  {
    clear();
    const events = new Events();
    const heard = listen(events);
    const z = spawnZombie(0x7a01, 1, "proving kind 4 is silent");
    ActorPlayHitVoice(z, ActorVoice.Kind4, new Rng(1),
                      (id) => events.emit("sound.play", { id }));
    check("kind 4 plays nothing: no call site in the image passes 4, and both "
          + "ids at `g_actor_voice_kind4` (0x005A4EA8) are zero and unwritten",
          heard.length === 0, heard.map((i) => i.toString(16)).join(","));
  }

  // -- C3. the weapon loop is refcounted, and shared -----------------------
  //
  // `00453133` gates the *sound* on `g_weapon_loop_holders == 0` while the
  // increment and the `obj+0x131B` latch at `00453164` run for every holder.
  // So two chainsaw zombies make one chainsaw noise.
  {
    clear();
    const events = new Events();
    const heard = listen(events);
    const a = spawnZombieWithEvents(0x7b00, 2, "chainsaw one", events);
    check("the first character-type-2 actor starts the looping chainsaw",
          heard.length === 1 && heard[0] === CHAIN_SAW_LOOP,
          heard.map((i) => `0x${i.toString(16)}`).join(",") || "silence");
    check("...and latches `obj+0x131B` with the count at one",
          a.weaponLoopHeld === 1 && G.g_weapon_loop_holders === 1,
          `${a.weaponLoopHeld} / ${G.g_weapon_loop_holders}`);
    const b = spawnZombieWithEvents(0x7b01, 2, "chainsaw two", events);
    check("the second one takes a share and starts nothing -- one loop per "
          + "scene, not one per actor",
          heard.length === 1 && b.weaponLoopHeld === 1
          && G.g_weapon_loop_holders === 2,
          `${heard.length} sounds, ${G.g_weapon_loop_holders} holders`);

    // ...and the release is the mirror: the first death is silent, the last
    // plays the stop id, which `PlaySoundId` turns into a stop-all.
    ZombieReleaseWeaponLoopSe(a, events);
    check("the first holder to go plays no stop id",
          heard.length === 1 && G.g_weapon_loop_holders === 1
          && a.weaponLoopHeld === 0,
          `${heard.length} sounds, ${G.g_weapon_loop_holders} holders`);
    ZombieReleaseWeaponLoopSe(b, events);
    check("the last one stops it, with the `_OFF` id out of "
          + "`g_looping_se_stop_ids`",
          heard.length === 2 && heard[1] === CHAIN_SAW_STOP
          && G.g_weapon_loop_holders === 0,
          heard.map((i) => `0x${i.toString(16)}`).join(","));
    // Releasing twice must not take the count below zero: the engine's own
    // guard is the latch, not the count.
    ZombieReleaseWeaponLoopSe(b, events);
    check("...and a second release from the same actor does nothing, because "
          + "the latch is what guards it",
          heard.length === 2 && G.g_weapon_loop_holders === 0,
          `${heard.length} sounds, ${G.g_weapon_loop_holders} holders`);
  }

  // -- C4. character type 3 is the same arm with the other pair ------------
  {
    clear();
    const events = new Events();
    const heard = listen(events);
    spawnZombieWithEvents(0x7b02, 3, "laser sword", events);
    check("character type 3 starts the laser sword instead -- `0x1F25A9`, "
          + "the other entry of the same table",
          heard.length === 1 && heard[0] === LASER_SWORD_LOOP,
          heard.map((i) => `0x${i.toString(16)}`).join(",") || "silence");
  }

  // -- C5. every other character type takes no share ----------------------
  //
  // The engine's `switch` has one arm for 2 and 3 and nothing for the rest, so
  // an ordinary zombie must leave both the count and the latch alone -- or the
  // *next* chainsaw zombie would find a non-zero count and never sound.
  {
    clear();
    const events = new Events();
    const heard = listen(events);
    const z = spawnZombieWithEvents(0x7b03, 1, "ordinary", events);
    check("an ordinary zombie takes no share of the weapon loop",
          heard.length === 0 && z.weaponLoopHeld === 0
          && G.g_weapon_loop_holders === 0,
          `${heard.length} sounds, ${G.g_weapon_loop_holders} holders`);
  }

  // -- C6. the scene reset zeroes the count -------------------------------
  //
  // `MOV [0x009c8a74], 0` at `0x0045EF3D`. Without it a second stage's first
  // chainsaw zombie inherits a non-zero count and the chainsaw never starts.
  {
    clear();
    G.g_weapon_loop_holders = 3;
    ResetSceneOnEnter();
    check("`ResetSceneOnEnter` zeroes `g_weapon_loop_holders`, so a stage does "
          + "not inherit the last one's holders",
          G.g_weapon_loop_holders === 0, String(G.g_weapon_loop_holders));
  }
}

// -- class 0x33 selector 4: the scenery an actor shoves aside -----------------
//
// Reported as stage 1 `0x16D8` `char_adv00` "playing the wrong entrance -- a
// ledge hang where a chair push belongs". The clip id was right: 1048 is a
// sixty-frame hold. The chair push is **this class**, and the port had the
// three fields `ColiTestSphereAgainstActors` writes -- `obj+0x138`, `+0x13C`,
// `+0x140` -- with `ZombiePushOutOfWorldAndActors` as their only reader.
//
// Every number below is stage 1's own descriptor, `0x1A40` and `0x1A74`: slot
// 4196 (`komono_7.bin` part 0, a chair), no shot mesh, a 3.5 sphere, armed by
// script flag 32 and despawned by 33. The set piece is held by *these* values
// and not by a shape.

console.log("\nclass 0x33 selector 4: the scenery an actor shoves aside:");
{
  const CHAIR_AT = 0x1a40;
  const CHAIR_SLOT = 0x1064;             // 4196
  const CHAIR_SPHERE = 3.5;
  const PUSH_FLAG = 32;
  const DESPAWN_FLAG = 33;
  /** `ActorInitFlags` puts the descriptor's word on `obj+0x34`; both carry it. */
  const SPAWN_FLAGS = 0x8000;

  const STAGE1 = () => ({
    slot: CHAIR_SLOT, shot_mesh: -1, shot_radius: CHAIR_SPHERE,
    push_flag: PUSH_FLAG, despawn_flag: DESPAWN_FLAG,
  });

  const reset = () => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    G.g_players_in_play = 1;
  };
  const makeChair = (tail = STAGE1(),
                     flags = SPAWN_FLAGS): ScriptedSceneryActor => {
    const a = ActorSpawn(CHAIR_AT, SpawnClass.ScriptedScenery, -1, "chair",
                         { class33Push: tail as Actor["class33Push"],
                           hp: ScriptedScenerySelector.Pushable,
                           maxHp: ScriptedScenerySelector.Pushable,
                           flags });
    if (a.cls !== SpawnClass.ScriptedScenery) throw new Error("not class 0x33");
    a.pos = vec3(22.83, 6.5, -16.74);
    a.visible = true;
    return a;
  };
  const chairFrame = () => ({ dt: 1 / 60, rng: new Rng(9),
                              host: NULL_HOST });
  const tick = (c: ScriptedSceneryActor, n: number) => {
    for (let i = 0; i < n; i++) {
      if (c.despawned) return;
      ScriptedPushableUpdate33(c, chairFrame());
    }
  };

  // -- C1. the seed, and the radius that makes it a push target -------------
  //
  // `tail+0x04 == -1` writes `tail+0x08` to `obj+0x124` **and** `obj+0x128`.
  // The second is the one that matters: `ColiTestSphereAgainstActors` measures
  // against the *body* radius, so a chair that only got the shot radius is a
  // chair nothing can touch.
  {
    reset();
    const c = makeChair();
    check("before its first frame the chair has no sphere at all",
          c.bodyRadius === 0 && c.hitRadius === 0,
          `${c.bodyRadius}/${c.hitRadius}`);
    tick(c, 1);
    check("the seed writes `tail+0x08` to the body radius as well as the "
          + "shot radius -- both port names for `obj+0x124`, and `obj+0x128`",
          c.bodyRadius === CHAIR_SPHERE && c.hitRadius === CHAIR_SPHERE
          && c.radius === CHAIR_SPHERE,
          `${c.bodyRadius}/${c.hitRadius}/${c.radius}`);
    check("...and the draw slot, which is the whole of what the renderer "
          + "needs to clone a model for it",
          c.scenery.slot === CHAIR_SLOT, String(c.scenery.slot));
    check("`obj+0x1312` is incremented, so the seed runs once",
          c.sub === 1, String(c.sub));
  }

  // -- C2. the freeze, and the one flag that lifts it -----------------------
  //
  // `obj+0x34` bit `0x8000` arrives on the descriptor and `AND AH, 0x7f` at
  // `0x00433C00` is the only thing that clears it. While it is up the object
  // does not move, and `ColiTestSphereAgainstActors` skips it as a candidate
  // -- one bit, both halves.
  {
    reset();
    const c = makeChair();
    tick(c, 1);
    check("the descriptor's `0x8000` survives `ActorInitFlags`, so the chair "
          + "starts held",
          (c.flags & SCENERY_SKIP_COLLISION) !== 0,
          `0x${c.flags.toString(16)}`);
    // A push recorded while it is held must not move it.
    c.pushedBy = 0x7ee0;
    c.pushDepth = 2;
    c.pushNormal = vec3(1, 0, 0);
    const x0 = c.pos.x;
    tick(c, 1);
    check("a push recorded on a held chair moves it nowhere, and is not even "
          + "consumed",
          c.pos.x === x0 && c.pushedBy === 0x7ee0, `${c.pos.x} vs ${x0}`);
    G.g_script_flags[PUSH_FLAG] = 1;
    tick(c, 1);
    check("script flag 32 clears the bit and the chair moves on that same "
          + "frame -- a tenth of the penetration along the recorded normal",
          Math.abs(c.pos.x - (x0 + 0.2)) < 1e-6
          && !(c.flags & SCENERY_SKIP_COLLISION), String(c.pos.x));
    check("...and the recorded push is consumed, so one record is one move",
          c.pushedBy === -1, String(c.pushedBy));
    // The clear is a clear and not a copy of the flag: a flag that goes back
    // down does not re-freeze the object.
    G.g_script_flags[PUSH_FLAG] = 0;
    c.pushedBy = 0x7ee0;
    c.pushDepth = 2;
    c.pushNormal = vec3(1, 0, 0);
    const x1 = c.pos.x;
    tick(c, 1);
    check("the flag dropping again does not put the bit back -- the routine "
          + "only ever clears",
          Math.abs(c.pos.x - (x1 + 0.2)) < 1e-6, String(c.pos.x));
  }

  // -- C3. the pusher's boost bits, not the chair's -------------------------
  //
  // `if ((*(uint *)(obj+0x138) + 0x34) & 0x18000000) f *= 1.8` -- the test is
  // on the actor that did the pushing. Reading the chair's own flags there
  // would be `L11` with the object the other way round, and it would be
  // silent: 1.8 times nothing is still nothing until a zombie that is
  // striking (`ActorFlag.Committed`) or sprinting (`ZOMBIE_SPRINTS`, which a
  // shot raises) arrives. These were called the airborne bits; neither is.
  {
    reset();
    G.g_script_flags[PUSH_FLAG] = 1;
    const pusher = spawnZombie(0x7ee0, 1, "pusher");
    pusher.flags |= 0x18000000;
    const c = makeChair();
    tick(c, 1);
    c.pushedBy = pusher.at;
    c.pushDepth = 2;
    c.pushNormal = vec3(1, 0, 0);
    const x0 = c.pos.x;
    tick(c, 1);
    check("a striking or sprinting pusher shoves 1.8x as far, and the bit "
          + "read is the **pusher's**",
          Math.abs(c.pos.x - (x0 + 0.36)) < 1e-6, String(c.pos.x));

    // ...and the chair's own copy of the same bits changes nothing.
    pusher.flags &= ~0x18000000;
    c.flags |= 0x18000000;
    c.pushedBy = pusher.at;
    c.pushDepth = 2;
    c.pushNormal = vec3(1, 0, 0);
    const x1 = c.pos.x;
    tick(c, 1);
    check("the chair's own airborne bits are not the ones that scale it",
          Math.abs(c.pos.x - (x1 + 0.2)) < 1e-6, String(c.pos.x));
  }

  // -- C4. all three axes, and the sphere that follows ----------------------
  //
  // The recorded push is applied in x, y **and** z -- unlike the re-resolve
  // under it, which is x and z only. And `ScriptedPushableSyncSphere33` rises
  // by exactly the body radius, where `ActorUpdateBoundingSphere` rises by the
  // radius plus one: two conventions for `obj+0x12C`, and this class writes
  // its own.
  {
    reset();
    G.g_script_flags[PUSH_FLAG] = 1;
    const c = makeChair();
    tick(c, 1);
    const p0 = { x: c.pos.x, y: c.pos.y, z: c.pos.z };
    c.pushedBy = -1;
    c.pushedBy = 0x7ee0;
    c.pushDepth = 3;
    c.pushNormal = vec3(0, 1, -1);
    tick(c, 1);
    check("the recorded push moves all three axes, y included",
          Math.abs(c.pos.y - (p0.y + 0.3)) < 1e-6
          && Math.abs(c.pos.z - (p0.z - 0.3)) < 1e-6
          && c.pos.x === p0.x,
          `${c.pos.x}/${c.pos.y}/${c.pos.z}`);
    check("the collision sphere is re-seated at the position plus exactly "
          + "the body radius -- not the radius plus one",
          c.sphereCentre.y === c.pos.y + CHAIR_SPHERE
          && c.sphereCentre.x === c.pos.x && c.sphereCentre.z === c.pos.z,
          String(c.sphereCentre.y));
  }

  // -- C5. a zombie walking into it is the whole set piece ------------------
  //
  // The two halves meeting: the chair registers from its own update,
  // `ZombiePushOutOfWorldAndActors` runs `ColiTestSphereAgainstActors` over
  // the published list, which records the opposite push on whatever it finds,
  // and this class applies it next frame. Nothing here calls the push
  // directly -- if the chair moves, the wiring is real.
  {
    reset();
    G.g_script_flags[PUSH_FLAG] = 1;
    const c = makeChair();
    tick(c, 1);
    const z = spawnZombie(0x16d8, 7, "char_adv00");
    z.pos = vec3(c.pos.x + 4, 6.2, c.pos.z);
    z.bodyRadius = 3.5;
    z.flags2 |= ZombieFlag2.CollideActors;
    const x0 = c.pos.x;
    // The chair filed itself on its own frame (`RegisterForShotTest` at
    // `0x00433CC6`); the next frame's `ColiPublishDynamicList` is what puts it
    // where a zombie can find it. Without that frame boundary it is not there.
    ColiPublishDynamicList();
    ShotTestListReset();
    ZombiePushOutOfWorldAndActors(z);
    check("the zombie's own collision pass records the push on the chair "
          + "rather than moving it",
          c.pushedBy === z.at && c.pushDepth > 0,
          `${c.pushedBy}/${c.pushDepth}`);
    tick(c, 1);
    check("...and the chair shoves itself away from the zombie on the next "
          + "frame, which is the chair push the report was asking for",
          c.pos.x < x0 - 1e-6 && c.pushedBy === -1,
          `${x0} -> ${c.pos.x}`);
  }

  // -- C6. the despawn flag is tested first, and it returns -----------------
  //
  // `MOV AL, byte ptr [ECX + 0xd]` at `0x00433B80` is the first thing in the
  // routine: a raised flag despawns and returns before the seed, the push and
  // the draw. A chair that seeded itself on the frame it left would leave the
  // renderer a slot to clone for one frame.
  {
    reset();
    G.g_script_flags[DESPAWN_FLAG] = 1;
    const c = makeChair();
    tick(c, 1);
    check("script flag 33 despawns the chair on its first frame",
          c.despawned, String(c.despawned));
    check("...before the seed, so it never publishes a draw slot",
          c.scenery.slot === 0 && c.sub === 0,
          `${c.scenery.slot}/${c.sub}`);
  }

  // -- C8. the wiring, from the bundle's placement to the object moving -----
  //
  // Everything above calls `ScriptedPushableUpdate33` by hand, and that is
  // exactly the shape `L38` warns about: a dispatch arm that is missing looks
  // the same as one that is wrong, and a test that drives past it sees
  // neither. Two links, neither of which the assertions above can reach:
  //
  // * `SpawnSlotActors` gates on a tail block being present, and it used to
  //   accept `class33` alone -- so a selector-4 placement made no object at
  //   all, which was one of the four reasons the port drew no chair;
  // * `ScriptedSceneryUpdate33` picks the routine off `obj.hp`, because the
  //   port has one table entry per class where the engine writes one of twelve
  //   pointers into `*obj`.
  //
  // So this one goes in through the front: the placement the exporter emits,
  // then `GameUpdate`, and nothing else.
  {
    reset();
    SetGameTables({
      ...CHARS,
      placements: [{
        at: CHAIR_AT, class: 0x33, char_type: -1, motion: null,
        hp: ScriptedScenerySelector.Pushable, init_flags: SPAWN_FLAGS,
        yaw: 4096, class33_push: STAGE1(),
      }],
    } as unknown as CharactersJson);
    const rng = new Rng(33);
    const events = new Events();
    const listed = [{ at: CHAIR_AT, class: SpawnClass.ScriptedScenery,
                      pos: [22.83, 6.5, -16.74] as [number, number, number] }];
    SpawnSlotActors(listed);
    const c = G.g_object_list.find((o) => o.at === CHAIR_AT);
    check("a placement carrying only `class33_push` is spawned -- the gate "
          + "takes either block, not just the carrier's",
          !!c && c.cls === SpawnClass.ScriptedScenery,
          c ? `class ${c.cls}` : "no actor");
    if (!c || c.cls !== SpawnClass.ScriptedScenery) throw new Error("no chair");
    check("...and it arrives held, because the spawn arm carries the "
          + "descriptor's flags word through",
          (c.flags & SCENERY_SKIP_COLLISION) !== 0,
          `0x${c.flags.toString(16)}`);
    G.g_script_flags[PUSH_FLAG] = 1;
    // The walk that reaches the object runs `ScriptedSceneryDispatch33`,
    // which installs the routine, claims the hit slot and returns
    // (`0x00433044`..`0x00433050`): the routine is not called on that walk.
    GameUpdate(1 / 60, NULL_HOST, rng, events);
    check("the first `GameUpdate` runs the dispatch and not the routine: "
          + "no sphere yet, still held",
          c.bodyRadius !== CHAIR_SPHERE
          && (c.flags & SCENERY_SKIP_COLLISION) !== 0,
          `${c.bodyRadius}/0x${c.flags.toString(16)}`);
    GameUpdate(1 / 60, NULL_HOST, rng, events);
    check("the next reaches the selector-4 routine through the class "
          + "table, seeds the sphere and lifts the freeze",
          c.bodyRadius === CHAIR_SPHERE && c.scenery.slot === CHAIR_SLOT
          && !(c.flags & SCENERY_SKIP_COLLISION),
          `${c.bodyRadius}/${c.scenery.slot}/0x${c.flags.toString(16)}`);
    c.pushedBy = 0x7ee0;
    c.pushDepth = 2;
    c.pushNormal = vec3(1, 0, 0);
    const x0 = c.pos.x;
    GameUpdate(1 / 60, NULL_HOST, rng, events);
    check("...and a second one moves it, with nothing but the class table "
          + "between the frame and the push",
          Math.abs(c.pos.x - (x0 + 0.2)) < 1e-6, `${x0} -> ${c.pos.x}`);
    // Put the fixture back: everything after this file's class-0x33 section
    // expects `CHARS` with no placements in it.
    SetGameTables(CHARS);
  }

  // -- C7. the other selectors get nothing ----------------------------------
  //
  // The bundle carries `class33_push` for selector 4 and `class33` for
  // selector 1, never both, and the port takes which one arrived as the
  // selector. An actor with neither is one of the eight sub-handlers nothing
  // here can run, and the update must be a no-op rather than a default arm.
  {
    reset();
    G.g_script_flags[PUSH_FLAG] = 1;
    const c = makeChair();
    c.class33Push = null;
    const p0 = { x: c.pos.x, sub: c.sub };
    c.pushedBy = 0x7ee0;
    c.pushDepth = 9;
    c.pushNormal = vec3(1, 0, 0);
    tick(c, 4);
    check("a class-0x33 actor with no tail block seeds nothing and moves "
          + "nowhere, however hard something pushes it",
          c.pos.x === p0.x && c.sub === p0.sub && !c.despawned,
          `${c.pos.x}/${c.sub}`);
  }
}

// -- class 0x33 selector 2: a model drawn until a flag or a camera frame -----
//
// `ScriptedPropDrawUntilFlag` (`FUN_00433A10`). Before this the director built
// nothing for selector 2: the exporter wrote its ten descriptors as rigs at a
// fixed pose and `render/props.ts` hid them on a non-zero flag, so the model
// stood from the stage's first frame, came back if the flag fell, and never
// left on its camera frame. Driven from the front, as selector 5's block
// below is: the placement the exporter emits, `SpawnSlotActors`, `GameUpdate`.

console.log("\nclass 0x33 selector 2: a model drawn until a flag or a camera frame:");
{
  // Stage 1's `0x5FE8`, as the exporter reads it: slot `0x36`
  // (`char_adv04.bin` 11), frame word `-1`, flag 1.
  const PROP_AT = 0x5fe8;
  const POS: [number, number, number] = [-968.1, -7, -544.6];
  const shipped = () => ({ slot: 0x36, despawn_frame: -1, despawn_flag: 1 });

  const tables = (prop: { slot: number; despawn_frame: number;
                          despawn_flag: number },
                  angles = { pitch: 0, yaw: 55742, roll: 0 }) => ({
    ...CHARS,
    placements: [{
      at: PROP_AT, class: 0x33, char_type: -1, motion: null,
      hp: ScriptedScenerySelector.DrawUntilFlag, init_flags: 0,
      ...angles, class33_prop: prop,
    }],
  } as unknown as CharactersJson);
  const reset = (prop = shipped(), angles?: { pitch: number; yaw: number;
                                              roll: number }) => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(tables(prop, angles));
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    G.g_players_in_play = 1;
  };
  const build = (rng: Rng) => {
    SpawnSlotActors([{ at: PROP_AT, class: SpawnClass.ScriptedScenery,
                       pos: [...POS] as [number, number, number] }]);
    RunPendingInits(rng);
    return G.g_object_list.find((o) => o.at === PROP_AT) as
      ScriptedSceneryActor | undefined;
  };

  // -- P1. the wiring, and the claim the arm at `0x0043302E` makes ----------
  {
    reset();
    const rng = new Rng(61);
    const o = build(rng);
    check("a placement carrying only `class33_prop` is spawned as selector 2",
          !!o && o.cls === SpawnClass.ScriptedScenery
          && o.hp === ScriptedScenerySelector.DrawUntilFlag,
          o ? `class ${o.cls} hp ${o.hp}` : "no actor");
    if (!o) throw new Error("no selector-2 object");
    const k = o.hitSlot;
    check("...and its dispatch arm claims a hit slot (`CALL 0x00409270` at "
          + "`0x0043302E`)",
          k !== HIT_SLOT_NONE && G.g_hit_slots[k] === PROP_AT,
          `slot ${k} holds ${G.g_hit_slots[k]}`);
    check("...and before its first update it has drawn nothing and seeded "
          + "nothing: `obj+0x13F0` is copied by the update, not the `Init`",
          o.scenery.draws.length === 0 && o.scenery.slot === 0 && o.sub === 0,
          `${o.scenery.draws.length} draws, slot ${o.scenery.slot}, sub ${o.sub}`);
  }

  // -- P1b. a descriptor two instructions name is two objects --------------
  // Stage 1 block 14 step 0 re-spawns the cars blocks 5 and 11 spawned, and
  // `EvtOpSpawnObj0B` allocates afresh each time. Built per instruction: the
  // second lives under a synthetic pool address and names its descriptor in
  // `descAt`; a frame that lists both again builds nothing more.
  {
    reset();
    const rng = new Rng(62);
    const one = { at: PROP_AT, class: SpawnClass.ScriptedScenery,
                  pos: [...POS] as [number, number, number],
                  block: 5, step: 1, opIndex: 10 };
    const two = { ...one, block: 14, step: 0, opIndex: 4 };
    SpawnSlotActors([one]);
    SpawnSlotActors([one, two]);
    SpawnSlotActors([one, two]);
    RunPendingInits(rng);
    const cars = G.g_object_list.filter((o) => o.descAt === PROP_AT);
    check("two instructions naming one selector-2 descriptor build two objects",
          cars.length === 2 && cars[0].at === PROP_AT && cars[1].at < 0
          && cars[1].hp === ScriptedScenerySelector.DrawUntilFlag,
          cars.map((o) => `${o.at}/${o.descAt}`).join(" "));
    // The first instruction's entry leaves the list and comes back: a run of
    // the spawn opcode the walker has not seen built.
    SpawnSlotActors([two]);
    SpawnSlotActors([two, one]);
    check("...and an entry the script lists anew is a new object",
          G.g_object_list.filter((o) => o.descAt === PROP_AT).length === 3);
  }

  // -- P2. the seed, and one draw a frame at the object's own pose ----------
  {
    reset();
    const rng = new Rng(62);
    const o = build(rng);
    if (!o) throw new Error("no selector-2 object");
    G.g_cam_path_frame = 100;
    GameUpdate(1 / 60, NULL_HOST, rng, new Events());
    const d = o.scenery.draws;
    check("the first frame copies `tail+0x00` to `obj+0x13F0` and steps "
          + "`obj+0x1312` to 1 (`INC EAX` at `0x00433A29`)",
          o.scenery.slot === 0x36 && o.sub === 1,
          `slot 0x${o.scenery.slot.toString(16)}, sub ${o.sub}`);
    const xf = (m: ArrayLike<number>, v: ReturnType<typeof vec3>) => {
      const out = vec3();
      MatrixTransformPoint(m, v, out);
      return out;
    };
    const at = d[0] ? xf(d[0].m, vec3(0, 0, 0)) : null;
    check("...and draws exactly that one slot, at the spawn's position",
          d.length === 1 && d[0].slot === 0x36 && !!at
          && Math.abs(at.x - POS[0]) < 1e-3 && Math.abs(at.y - POS[1]) < 1e-3
          && Math.abs(at.z - POS[2]) < 1e-3,
          d.map((x) => `0x${x.slot.toString(16)}`).join(",")
          + (at ? ` at (${at.x}, ${at.y}, ${at.z})` : ""));
    GameUpdate(1 / 60, NULL_HOST, rng, new Events());
    GameUpdate(1 / 60, NULL_HOST, rng, new Events());
    check("three frames later it is still one draw and still sub 1 -- the "
          + "list is the frame's, and the seed ran once",
          !o.despawned && o.scenery.draws.length === 1 && o.sub === 1,
          `${o.scenery.draws.length} draws, sub ${o.sub}`);
  }

  // -- P3. the matrix is `T RotZ RotY RotX Scale(1)` -------------------------
  //
  // A non-identity pose in all three angles (`L48`), so the order shows:
  // `0x00433A6A`..`0x00433A80` is Z, then Y, then X, after the translate.
  {
    const angles = { pitch: 0x1000, yaw: 0x4000, roll: 0x2800 };
    reset(shipped(), angles);
    const rng = new Rng(63);
    const o = build(rng);
    if (!o) throw new Error("no selector-2 object");
    GameUpdate(1 / 60, NULL_HOST, rng, new Events());
    const want = MatIdentity();
    MatrixTranslate(want, ...POS);
    MatrixRotateZ(want, angles.roll);
    MatrixRotateY(want, angles.yaw);
    MatrixRotateX(want, angles.pitch);
    const other = MatIdentity();
    MatrixTranslate(other, ...POS);
    MatrixRotateX(other, angles.pitch);
    MatrixRotateZ(other, angles.roll);
    MatrixRotateY(other, angles.yaw);
    const p = vec3(3, 5, 7);
    const xf = (m: ArrayLike<number>) => {
      const out = vec3();
      MatrixTransformPoint(m, p, out);
      return out;
    };
    const got = o.scenery.draws[0] ? xf(o.scenery.draws[0].m) : null;
    const w = xf(want);
    const x = xf(other);
    const near = (a: { x: number; y: number; z: number },
                  b: { x: number; y: number; z: number }) =>
      Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) < 1e-3;
    check("a point of the model lands where `T RotZ RotY RotX` puts it, and "
          + "not where class 0x13's `T RotX RotZ RotY` would -- the two differ "
          + "at this pose",
          !!got && near(got, w) && !near(w, x),
          got ? `(${got.x.toFixed(3)}, ${got.y.toFixed(3)}, ${got.z.toFixed(3)})`
                + ` want (${w.x.toFixed(3)}, ${w.y.toFixed(3)}, ${w.z.toFixed(3)})`
              : "no draw");
  }

  // -- P4. the flag: `== 1`, and the despawn draws nothing ------------------
  {
    reset();
    const rng = new Rng(64);
    const o = build(rng);
    if (!o) throw new Error("no selector-2 object");
    GameUpdate(1 / 60, NULL_HOST, rng, new Events());
    G.g_script_flags[1] = 2;
    GameUpdate(1 / 60, NULL_HOST, rng, new Events());
    check("flag 1 at 2 is not raised for this routine -- `CMP byte ptr "
          + "[EDX + 0x9c7200], 0x1` at `0x00433A49` is an equality with 1",
          !o.despawned && o.scenery.draws.length === 1,
          `despawned ${o.despawned}`);
    const k = o.hitSlot;
    G.g_script_flags[1] = 1;
    GameUpdate(1 / 60, NULL_HOST, rng, new Events());
    check("at 1 the object despawns that frame, draws nothing, and gives its "
          + "hit slot back",
          o.despawned && o.scenery.draws.length === 0
          && G.g_hit_slots[k] === HIT_SLOT_NONE,
          `despawned ${o.despawned}, ${o.scenery.draws.length} draws`);
    G.g_script_flags[1] = 0;
    GameUpdate(1 / 60, NULL_HOST, rng, new Events());
    check("...and lowering the flag again brings nothing back: the old layer "
          + "showed the model whenever the flag read zero",
          !G.g_object_list.some((a) => a.at === PROP_AT && !a.despawned),
          String(G.g_object_list.filter((a) => a.at === PROP_AT).length));
  }

  // -- P5. the camera frame: block 0's, by equality --------------------------
  //
  // Every shipped frame word is `-1`, so this is the arm on a written tail:
  // `CMP EAX, [0x009a6110]` at `0x00433A40`, and no second compare against
  // block 2's frame, which selector 5 has.
  {
    reset({ slot: 0x36, despawn_frame: 300, despawn_flag: 1 });
    const rng = new Rng(65);
    const o = build(rng);
    if (!o) throw new Error("no selector-2 object");
    G.g_cam_path_frame = 299;
    GameUpdate(1 / 60, NULL_HOST, rng, new Events());
    G.g_cam_path_frame = 301;
    GameUpdate(1 / 60, NULL_HOST, rng, new Events());
    check("on 299 and 301 it stays and draws -- an equality, not a threshold",
          !o.despawned && o.scenery.draws.length === 1,
          `despawned ${o.despawned}`);
    G.g_cam_path_frame_2 = 300;
    GameUpdate(1 / 60, NULL_HOST, rng, new Events());
    check("block 2's frame at 300 does nothing: the routine never reads it",
          !o.despawned, `despawned ${o.despawned}`);
    G.g_cam_path_frame = 300;
    GameUpdate(1 / 60, NULL_HOST, rng, new Events());
    check("block 0's frame at 300 takes it off the field",
          o.despawned && o.scenery.draws.length === 0,
          `despawned ${o.despawned}`);
  }

  // -- P6. a replay that steps over the raise does not rebuild it -----------
  //
  // `[port-only]`: the walker asks the class after every instruction it
  // replays. The question is the routine's own two tests, read off the state
  // the replay has made.
  {
    reset();
    const outlived = g_class_handlers[SpawnClass.ScriptedScenery]
      ?.outlivedByReplay;
    const rec = { at: PROP_AT, class: 0x33,
                  hp: ScriptedScenerySelector.DrawUntilFlag, block: 5 };
    const before = outlived?.(rec);
    G.g_script_flags[1] = 1;
    const after = outlived?.(rec);
    check("a replayed selector-2 record is outlived once its flag reads 1, "
          + "and not before",
          before === false && after === true, `${before} -> ${after}`);
  }

  SetGameTables(CHARS);
}

// -- class 0x33 selector 3: one sprite on the first frame ----------------------
//
// `ScriptedEffectOnFirstFrame33` (`FUN_00433AC0`): no tail, no test, one
// kind-0x62 sprite facing the camera and a despawn. Before this the bundle
// carried no placement for selector 3 and nothing was built at all. The
// sprite table is `SpawnSpriteEffectFromParams`' `case 0x62:` row,
// `0x1339..0x1356` at 1.5, and `PlayImpactSoundForMaterial`'s `BOMB2_16`.

console.log("\nclass 0x33 selector 3: one sprite on the first frame:");
{
  const FIRST_AT = 0x37e8;
  // Stage 1's, block 4 step 1 op 21.
  const POS: [number, number, number] = [-250, 0, -544.3];
  const SPLASH_FIRST = 0x1339;
  const SPLASH_LAST = 0x1356;
  const BOMB2 = 792233;
  const EYE = vec3(-240, 10, -534.3);

  ResetGameGlobals();
  EnterPlay();
  SetGameTables({
    ...CHARS,
    combat: {
      impact_sprite: { [String(SpriteEffectKind.SplashLarge)]:
                         [SPLASH_FIRST, SPLASH_LAST, 1.5] },
      impact_sprite_default: [0x0904, 0x0904, 0.1],
      ricochet: { [String(SpriteEffectKind.SplashLarge)]:
                    { id: BOMB2, file: "COMMON\\BOMB2_16.WAV" } },
    },
    placements: [{
      at: FIRST_AT, class: 0x33, char_type: -1, motion: null,
      hp: ScriptedScenerySelector.EffectOnFirstFrame, init_flags: 0, yaw: 0,
    }],
  } as unknown as CharactersJson);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_scene_state_major = SCENE_MAJOR_PLAYING;
  G.g_players_in_play = 1;

  const rng = new Rng(71);
  const events = new Events();
  const sounds: number[] = [];
  events.on("sound.play", (e) => sounds.push(e.id));
  SpawnSlotActors([{ at: FIRST_AT, class: SpawnClass.ScriptedScenery,
                     pos: [...POS] as [number, number, number] }]);
  RunPendingInits(rng);
  const o = G.g_object_list.find((a) => a.at === FIRST_AT);
  check("a placement with no tail block is spawned when its selector is 3 -- "
        + "the routine reads none",
        !!o && o.cls === SpawnClass.ScriptedScenery
        && o.hp === ScriptedScenerySelector.EffectOnFirstFrame,
        o ? `class ${o.cls} hp ${o.hp}` : "no actor");
  if (!o) throw new Error("no selector-3 object");
  const k = o.hitSlot;
  check("...and its dispatch arm claims a hit slot (`0x0043303C`)",
        k !== HIT_SLOT_NONE && G.g_hit_slots[k] === FIRST_AT,
        `slot ${k} holds ${G.g_hit_slots[k]}`);

  // A host whose eye is somewhere off the object, so face mode 1 has a line
  // to aim along that is not the identity (`L48`).
  const host = {
    ...NULL_HOST,
    viewPoint: (_x: number, _y: number, _z: number,
                out: { x: number; y: number; z: number }) => {
      out.x = EYE.x; out.y = EYE.y; out.z = EYE.z;
    },
  };
  G.g_cam_path_frame = 12345;
  GameUpdate(1 / 60, host, rng, events);
  const fx = G.g_sprite_effects.filter(
    (e) => e.kind === SpriteEffectKind.SplashLarge);
  const e = fx[0];
  const face = AnglesToward(EYE.x - POS[0], EYE.y - POS[1], EYE.z - POS[2]);
  check("its first update throws one kind-0x62 sprite at its own position, "
        + "whatever the camera frame",
        fx.length === 1 && !!e && e.pos.x === POS[0] && e.pos.y === POS[1]
        && e.pos.z === POS[2],
        e ? `${fx.length} at (${e.pos.x}, ${e.pos.y}, ${e.pos.z})` : "none");
  check("...facing the camera in pitch and yaw -- face mode 1 (`PUSH 0x1` at "
        + "`0x00433ACA`), not selector 5's 0 and not the carrier's 2",
        !!e && e.pitch === face.pitch && e.yaw === face.yaw
        && face.pitch !== 0 && face.yaw !== 0,
        e ? `(${e.pitch}, ${e.yaw}) want (${face.pitch}, ${face.yaw})` : "none");
  check("...the `case 0x62:` run `0x1339..0x1356` at 1.5, with `BOMB2_16`",
        !!e && e.lastSlot === SPLASH_LAST && e.slot >= SPLASH_FIRST
        && e.slot <= SPLASH_FIRST + 1 && sounds.length === 1
        && sounds[0] === BOMB2,
        e ? `0x${e.slot.toString(16)}..0x${e.lastSlot.toString(16)}, `
            + `sounds ${sounds.join(",")}` : "none");
  check("...and the object despawns on that frame, giving its hit slot back",
        o.despawned && G.g_hit_slots[k] === HIT_SLOT_NONE,
        `despawned ${o.despawned}`);
  GameUpdate(1 / 60, host, rng, events);
  check("a second frame throws nothing more",
        G.g_sprite_effects.filter(
          (x) => x.kind === SpriteEffectKind.SplashLarge).length <= 1
        && sounds.length === 1,
        String(sounds.length));
  check("`[port-only]` a replay never rebuilds one: it lives one frame, and "
        + "a replay runs none",
        g_class_handlers[SpawnClass.ScriptedScenery]?.outlivedByReplay?.(
          { at: FIRST_AT, class: 0x33,
            hp: ScriptedScenerySelector.EffectOnFirstFrame, block: 4 })
          === true);

  SetGameTables(CHARS);
}

// -- class 0x33 selector 5: the effect a camera frame sets off ---------------
//
// `ScriptedEffectAtCameraCue33` (`FUN_00433B00`): on the frame
// `g_cam_path_frame` or `g_cam_path_frame_2` equals `tail+0x00`, throw one
// kind-0x44 sprite at the object's own position and despawn. Nothing else --
// no draw, no sphere, no state. The dispatch (`FUN_00432FF0`) installs it from
// jump-table entry 4, `0x00433051`, and like every arm then calls
// `ActorClaimHitSlot`.
//
// The one shipped spawn is stage 2's `0x12568`, block 27 step 1 op 19: cue
// 340 at `(-367.08, -10.67, -1532.01)`. Before this the bundle carried no tail
// block for selector 5 and the director built nothing for it -- `L83`'s shape
// inside a class that has a module, so no audit of class 0x33's arms saw it.
//
// Driven through the front, as C8 above is: the placement the exporter emits,
// `SpawnSlotActors`, then `GameUpdate` and nothing else. The sprite table is
// `SpawnSpriteEffectFromParams`' own `case 0x44:` row, `0xFD4..0x1031` at 1.0
// (`eff_dokan.bin` 0..93), and `PlayImpactSoundForMaterial`'s `BOMB1_11.WAV`.

console.log("\nclass 0x33 selector 5: the effect a camera frame sets off:");
{
  const CUE_AT = 0x12568;
  const CUE = 340;
  const POS: [number, number, number] = [-367.08, -10.67, -1532.01];
  const DOKAN_FIRST = 0xfd4;
  const DOKAN_LAST = 0x1031;
  const BOMB1 = 0x0b16a9;

  const tables = (cue: number) => ({
    ...CHARS,
    combat: {
      impact_sprite: { [String(SpriteEffectKind.Dokan)]:
                         [DOKAN_FIRST, DOKAN_LAST, 1.0] },
      impact_sprite_default: [0x0904, 0x0904, 0.1],
      ricochet: { [String(SpriteEffectKind.Dokan)]:
                    { id: BOMB1, file: "COMMON\\BOMB1_11.WAV" } },
    },
    placements: [{
      at: CUE_AT, class: 0x33, char_type: -1, motion: null,
      hp: ScriptedScenerySelector.EffectAtCameraCue, init_flags: 0,
      yaw: 0, class33_cue: { cue },
    }],
  } as unknown as CharactersJson);
  const reset = (cue = CUE) => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(tables(cue));
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    G.g_players_in_play = 1;
  };
  const build = (rng: Rng) => {
    SpawnSlotActors([{ at: CUE_AT, class: SpawnClass.ScriptedScenery,
                       pos: [...POS] as [number, number, number] }]);
    // The `Init` is the frame walk's (`SpawnFromDescriptor`).
    RunPendingInits(rng);
    return G.g_object_list.find((o) => o.at === CUE_AT);
  };
  const dokans = () => G.g_sprite_effects.filter(
    (e) => e.kind === SpriteEffectKind.Dokan);

  // -- E1. the wiring, and the claim every arm of the dispatch makes --------
  {
    reset();
    const rng = new Rng(55);
    const o = build(rng);
    check("a placement carrying only `class33_cue` is spawned -- the gate "
          + "takes the third block as well as the carrier's and the chair's",
          !!o && o.cls === SpawnClass.ScriptedScenery
          && o.hp === ScriptedScenerySelector.EffectAtCameraCue,
          o ? `class ${o.cls} hp ${o.hp}` : "no actor");
    if (!o) throw new Error("no selector-5 object");
    const k = o.hitSlot;
    check("...and its dispatch claims a hit slot, as `CALL 0x00409270` at "
          + "`0x00433058` closes selector 5's arm",
          k !== HIT_SLOT_NONE && G.g_hit_slots[k] === CUE_AT
          && (o.flags38 & HIT_SLOT_CLAIMED) !== 0,
          `slot ${k} holds ${G.g_hit_slots[k]}, flags38 0x${o.flags38.toString(16)}`);
  }

  // -- E2. the other two ported arms claim too ------------------------------
  //
  // The claim closes **every** arm -- `0x00433020` for the carrier and
  // `0x0043304A` for the chair -- and the port used to make it for neither.
  {
    reset();
    const carrier = ActorSpawn(0x12590, SpawnClass.ScriptedScenery, -1, "carrier",
                               { class33: { slot: 0x1a35 } as Actor["class33"],
                                 hp: ScriptedScenerySelector.Carrier,
                                 maxHp: ScriptedScenerySelector.Carrier });
    const chair = ActorSpawn(0x1a40, SpawnClass.ScriptedScenery, -1, "chair",
                             { class33Push: { slot: 0x1064 } as Actor["class33Push"],
                               hp: ScriptedScenerySelector.Pushable,
                               maxHp: ScriptedScenerySelector.Pushable });
    check("the carrier's and the chair's arms claim the first two free slots, "
          + "in the order the objects were made",
          carrier.hitSlot === 0 && chair.hitSlot === 1
          && G.g_hit_slots[0] === 0x12590 && G.g_hit_slots[1] === 0x1a40,
          `${carrier.hitSlot}/${chair.hitSlot}`);
  }

  // -- E3. one frame, by equality, and the effect it throws -----------------
  {
    reset();
    const rng = new Rng(56);
    const events = new Events();
    const sounds: number[] = [];
    events.on("sound.play", (e) => sounds.push(e.id));
    const o = build(rng);
    if (!o) throw new Error("no selector-5 object");
    const k = o.hitSlot;

    G.g_cam_path_frame = CUE - 1;
    GameUpdate(1 / 60, NULL_HOST, rng, events);
    G.g_cam_path_frame = CUE + 1;
    GameUpdate(1 / 60, NULL_HOST, rng, events);
    check("on 339 and on 341 nothing happens -- the compare at `0x00433B16` "
          + "is an equality, so a frame either side is no frame at all",
          !o.despawned && dokans().length === 0 && sounds.length === 0,
          `despawned ${o.despawned}, ${dokans().length} effects`);

    G.g_cam_path_frame = CUE;
    GameUpdate(1 / 60, NULL_HOST, rng, events);
    const fx = dokans();
    const e = fx[0];
    check("on 340 one kind-0x44 sprite goes off at the object's own position, "
          + "facing (0, 0) -- `params = {obj+0x40..0x48, 0, 0, 0}`",
          fx.length === 1 && !!e
          && e.pos.x === POS[0] && e.pos.y === POS[1] && e.pos.z === POS[2]
          && e.pitch === 0 && e.yaw === 0,
          e ? `${fx.length} at (${e.pos.x}, ${e.pos.y}, ${e.pos.z}) `
              + `facing (${e.pitch}, ${e.yaw})` : "none");
    check("...and it is `eff_dokan.bin`'s run, `0xFD4..0x1031`, not the "
          + "default arm's single `0x904`",
          !!e && e.lastSlot === DOKAN_LAST
          && e.slot >= DOKAN_FIRST && e.slot <= DOKAN_FIRST + 1,
          e ? `0x${e.slot.toString(16)}..0x${e.lastSlot.toString(16)}` : "none");
    check("...with the sprite's own `BOMB1_11.WAV` and no other sound",
          sounds.length === 1 && sounds[0] === BOMB1,
          sounds.map((s) => `0x${s.toString(16)}`).join(","));
    check("...and the object despawns, giving its hit slot back",
          o.despawned && G.g_hit_slots[k] === HIT_SLOT_NONE
          && o.hitSlot === HIT_SLOT_NONE,
          `despawned ${o.despawned}, slot ${k} holds ${G.g_hit_slots[k]}`);

    GameUpdate(1 / 60, NULL_HOST, rng, events);
    check("a second frame on 340 throws nothing more: the object is gone",
          dokans().length === 1, String(dokans().length));
  }

  // -- E4. the second compare, block 2's frame, read as written --------------
  //
  // `CMP dword ptr [0x009a6458], EAX` at `0x00433B1A`. Block 2's frame is 0
  // after the reset and nothing moves it, so a cue of 0 fires on whatever
  // frame block 0 is at. No shipped spawn has one; this is the arm.
  {
    reset(0);
    const rng = new Rng(57);
    const o = build(rng);
    if (!o) throw new Error("no selector-5 object");
    G.g_cam_path_frame = 123;
    GameUpdate(1 / 60, NULL_HOST, rng, new Events());
    check("a cue of 0 goes off with block 0 at frame 123, because "
          + "`g_cam_path_frame_2` is 0",
          G.g_cam_path_frame_2 === 0 && o.despawned && dokans().length === 1,
          `frame_2 ${G.g_cam_path_frame_2}, despawned ${o.despawned}`);
  }

  // Put the fixture back: everything after this expects `CHARS` with no
  // placements and no combat table.
  SetGameTables(CHARS);
}

// -- class 0x33 selector 1: the carrier in the shot test ---------------------

console.log("\nclass 0x33 selector 1: the carrier is shot as the engine files it:");
{
  // Stage 2's `0x12590` boat, slot 0x1A35 drawn at 2.5, with a blob: one
  // quad facing +z at z = 0 in the boat's own space, x -10..10, y -5..5.
  const BOAT_BLOB = coliQuad([0, 0, 1, 0], 2,
                             [10, 5, 0, -10, 5, 0, -10, -5, 0, 10, -5, 0], 53);
  const BOAT = {
    slot: 0x1a35, shot_mesh: 0x0cec69a8, shot_blob: "boat", shot_radius: 0,
    path: 338, path_end: 420, effect_frame: -1,
    commit_frame: 360, despawn_frame: -1,
    commit_flag: 0xff, despawn_flag: 128,
    effect: [0, 0, -0.9, 4.8, 2.5, 0],
  };
  // The boat rides to (100, 0, 200), unturned; a point on its quad at local
  // (2, 1, 0) is world (105, 2.5, 200) through the 2.5 scale.
  const W = { x: 105, y: 2.5, z: 200 };
  const EYE = { x: 105, y: 2.5, z: 240 };
  const ray = { origin: EYE, dir: { x: 0, y: 0, z: -1 } };
  const host = {
    ...NULL_HOST,
    pickShot: () => null,
    objectPath: () => ({ x: 100, y: 0, z: 200, pitch: 0, yaw: 0, roll: 0 }),
    viewSpaceOfPoint: (p: { x: number; y: number; z: number },
                       out: { x: number; y: number; z: number }) => {
      out.x = p.x - EYE.x; out.y = p.y - EYE.y; out.z = p.z - EYE.z;
      return true;
    },
  };
  const rng = new Rng(0x3301);
  const events = scene(0, rng);
  T.coli = { files: ["test"], blobs: { boat: BOAT_BLOB } } as never;
  G.g_coli_full_set = [];
  G.g_camera_fixed_eye_y = -999;
  G.g_cam_path_frame = 350;
  const boat = ActorSpawn(0x12590, SpawnClass.ScriptedScenery, -1, "boat",
                          { class33: BOAT as Actor["class33"],
                            hp: ScriptedScenerySelector.Carrier,
                            maxHp: ScriptedScenerySelector.Carrier }, rng);
  boat.visible = true;
  GameUpdate(1 / 60, host, rng, events);
  const m = boat.coliMatrix;
  check("the seat's mesh arm: 0x80000051, and obj+0x14C's blob",
        ((boat.flags & 0x80000051) >>> 0) === 0x80000051
        && boat.coliBlob === "boat",
        `0x${(boat.flags >>> 0).toString(16)} ${boat.coliBlob}`);
  check("the draw's MatrixStore(obj+0x150) is the model's matrix, scale and "
        + "all, and RegisterForShotTest files the boat",
        !!m && Math.abs(m[0] - 2.5) < 1e-9 && m[3] === 100 && m[11] === 200
        && G.g_shot_test_list.some((e) => e.at === boat.at),
        `${JSON.stringify(m)} ${JSON.stringify(G.g_shot_test_list)}`);
  const hit = ProcessPlayerShotsTestList(ray, host);
  check("a shot at the boat's quad stops on it: the boat, whole, surface 53",
        hit?.at === boat.at && hit.whole && hit.mesh?.surface === 53
        && Math.hypot(hit.point.x - W.x, hit.point.y - W.y,
                      hit.point.z - W.z) < 1e-6,
        JSON.stringify(hit));
  const resolved: { kind: string }[] = [];
  events.on("shot.resolved", (x) => resolved.push(x));
  QueueShotRequest(0, ray);
  GameUpdate(1 / 60, host, rng, events);
  check("...and the pull marks it and nothing else: bit 3, no damage, "
        + "still riding",
        resolved.length === 1 && resolved[0].kind === "marked"
        && (boat.flags & ActorFlag.Hit) !== 0 && !boat.dead
        && !boat.despawned,
        `${JSON.stringify(resolved)} 0x${(boat.flags >>> 0).toString(16)}`);
  // Bit 31 is what both moving-object passes refuse: published, the boat is
  // still no wall.
  check("bit 31 keeps the published boat out of the moving-object passes",
        G.g_coli_dynamic_list.some((e) => e.at === boat.at)
        && !ColiTraceSegmentAllSets(W.x, W.y, W.z - 5, W.x, W.y, W.z + 20));

  // Stage 5's car: no blob, so the sphere -- 0.1 round obj+0x70.
  const events5 = scene(0, rng);
  G.g_cam_path_frame = 231;
  const car = ActorSpawn(0x1ce4, SpawnClass.ScriptedScenery, -1, "car",
                         { class33: { ...BOAT, slot: 0x1b0e, shot_mesh: -1,
                                      shot_blob: null, shot_radius: 0.1,
                                      despawn_frame: 650,
                                      despawn_flag: 0xff } as Actor["class33"],
                           hp: ScriptedScenerySelector.Carrier,
                           maxHp: ScriptedScenerySelector.Carrier }, rng);
  car.visible = true;
  GameUpdate(1 / 60, host, rng, events5);
  const carHit = ProcessPlayerShotsTestList(
    { origin: { x: 95, y: 0, z: 240 }, dir: { x: 0, y: 0, z: -1 } }, host);
  check("stage 5's car files the sphere arm at its own origin, 0.1 round",
        (car.flags & 0x10) === 0 && car.hitRadius === 0.1
        && car.shotCentre.x === 95 && car.shotCentre.z === 200
        && carHit?.at === car.at && carHit.whole,
        `${car.shotCentre.x},${car.shotCentre.z} ${JSON.stringify(carHit)}`);
  T.coli = null;
  SetGameTables(CHARS);
}
