import { Zombie1368Flag } from "../../src/game/class30/state";
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { authoredFrameOfTicks } from "../../src/core/play_cursor";
import { ActorSpawn, GameUpdate } from "../../src/game/director";
import { ActorAdvanceMotion } from "../../src/game/motion";
import { MotionFlag } from "../../src/game/actor";
import { ActorRegisterCameraPoint } from "../../src/game/camera/track";
import {
  ShotTestListReset, ShotTestPickedHere, type ShotTestEntry,
} from "../../src/game/combat/shot_test";
import { G, ResetGameGlobals } from "../../src/game/globals";
import { NULL_HOST, type GameHost } from "../../src/game/host";
import {
  MotionOf, MotionPlayFrame, MotionPlayLength, SetGameTables, T,
} from "../../src/game/tables";
import {
  ColiDynamicListRemove, ColiTestSphereAgainstActors,
} from "../../src/game/coli";
import { ActorDespawn } from "../../src/game/despawn";
import {
  ThrownWeaponAlloc, ThrownWeaponDespawn, ThrownWeaponRoutine,
} from "../../src/game/thrown_weapon";
import { ActorDespawnProp } from "../../src/game/class41/prop";
import type { BreakableProp } from "../../src/game/class41/prop_state";
import { ZombieState } from "../../src/game/class30/states";
import { ZombieStateWalkDistance } from "../../src/game/class30/walk_distance";
import {
  ActorFlag, ActorUpdateBoundingSphere, CountFlag, ThrowerFlag, ZombieFlag2,
  type Actor, type ZombieActor,
} from "../../src/game/actor";
import { EnemyZombieUpdate, ZOMBIE_CAMERA_RISE }
  from "../../src/game/class30";
import { ThrowerPlaceCollisionSphere, ThrowerPushOutOfWorld }
  from "../../src/game/class31/collide";
import { ZombieOnShot } from "../../src/game/class30/on_shot";
import { ActorSnapToGroundHeight, ZombiePushOutOfWorldAndActors }
  from "../../src/game/class30/ground";
import { ActorArcBeginFalling } from "../../src/game/class30/emerge";
import { ZombieScriptEnded } from "../../src/game/class30/target";
import { ZOMBIE_SPRINTS } from "../../src/game/class30/states";
import type { TargetScriptJson } from "../../src/bundle/characters";
import { SpawnClass } from "../../src/game/spawn_class";
import {
  CivilianCheckShot, CivilianCountMotionLoops, CivilianOp, CivilianRunScript,
  CivilianSphereMode, CivilianUpdate, CivilianWait, CivilianWriteSphereCentre,
  CIVILIAN_SPHERE_BONE_MODE1, CIVILIAN_SPHERE_BONE_MODE2,
  CIVILIAN_SPHERE_BONE_MODE3_A, CIVILIAN_SPHERE_BONE_MODE3_B,
  PoseHookGrowAndPushOutOfWorld,
} from "../../src/game/class10";
import type { CivilianCmdJson } from "../../src/bundle/scene";
import { ThrowerState } from "../../src/game/class31/states";
import { vec3, type Vec3 } from "../../src/game/vec";
import {
  ActorPlayHitReaction, HitResultCode, ResolveHit,
} from "../../src/game/combat/resolve_hit";
import {
  check, CHARS, SCENE_MAJOR_PLAYING, DRAW_FRAME, spawnZombie, PublishCrowd,
  EnterPlay, WALL_BLOB, FLOOR_BLOB, thrower, shadowsUnder,
} from "./harness";

console.log("\nclass 0x30's captor family — the zombies work on the civilian:");
{
  const rng = new Rng(11);

  /** One civilian and one captor, wired the way the exporter wires them. */
  const captorScene = (initial: number, attack: number,
                       target: TargetScriptJson | null,
                       civCmds: CivilianCmdJson[][] = [[
                         { op: CivilianOp.Wait, args: [0] },
                         { op: CivilianOp.End, args: [] },
                       ]],
                       attackScript: TargetScriptJson | null = null) => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS, undefined, undefined, undefined, undefined, {
      entries: [0], scripts: civCmds, items: [],
      spawns: {
        "16384": {
          charType: 1, script: 0, removePath: -1, removeFrame: 0,
          removeDelay: 0,
          children: [{ at: 0x4100, class: 0x30, charType: 1,
                       pos: [0, 0, 0] as [number, number, number],
                       yaw: 0, hp: 1 }],
        },
      },
    });
    const civ = ActorSpawn(0x4000, SpawnClass.Civilian, 1, "civilian");
    civ.visible = true;
    civ.pos = vec3(0, 0, 0);
    const z = spawnZombie(0x4100, 1, "captor", {
      initialState: initial, attackState: attack,
      script: { target, attack: attackScript }, targetAt: 0x4000,
    }, rng);
    z.visible = true;
    z.pos = vec3(0, 0, 40);
    return { civ, z, events: new Events() };
  };
  const zFrame = (z: ZombieActor, events: Events) =>
    EnemyZombieUpdate(z, { dt: 1 / 60, rng, host: NULL_HOST, events });

  // The bug this family fixes: an unmodelled captor state fell through
  // `ZombieEntryState` to `AttackRun` and the zombie went for the camera.
  {
    const { z } = captorScene(ZombieState.WalkToTarget, 1, null);
    check("a captor starts in its own state, not in AttackRun",
          z.state === ZombieState.WalkToTarget, `state ${z.state}`);
  }

  // **The grab.** `ZombieStateWalkToTarget` raises the civilian's own `Free`
  // wait bit the frame it gets close enough — which is the civilian's cue.
  {
    const script: TargetScriptJson = {
      state: ZombieState.WalkToTarget,
      head: { arrive: 10, loops: 1, motion: 10, frame: 0 },
      entries: [{ motion: 10, frame: 0, loops: 1, mode: 5 }],
    };
    const { civ, z, events } = captorScene(ZombieState.WalkToTarget, 1,
                                           script);
    zFrame(z, events);
    check("...and walks at the civilian rather than the camera",
          z.sub === 2 && z.zom.targetArrive === 10, `sub ${z.sub}`);
    zFrame(z, events);
    check("out of reach it stays in the walk",
          z.state === ZombieState.WalkToTarget
          && !(civ.civ!.wait & CivilianWait.Free), `state ${z.state}`);
    z.pos = vec3(0, 0, 4);                     // inside the arrive radius
    zFrame(z, events);
    check("inside the radius it hands over to the maul...",
          z.state === ZombieState.TargetMotionScript && z.sub === 1,
          `state ${z.state} sub ${z.sub}`);
    check("...and raises the civilian's own `Free` wait bit, which is the grab",
          (civ.civ!.wait & CivilianWait.Free) !== 0,
          `wait ${civ.civ!.wait.toString(16)}`);
  }

  // **The maul.** The cue frame raises `0x4000000` on the civilian — the same
  // bit a killing shot raises, so it costs both players a hundred points.
  {
    const script: TargetScriptJson = {
      state: ZombieState.TargetMotionScript,
      head: {},
      entries: [{ motion: 10, frame: 0, loops: 1, mode: 3 }],
    };
    const { civ, z, events } = captorScene(ZombieState.TargetMotionScript, 1,
                                           script);
    let killed = false;
    events.on("sound.play", () => { killed = true; });
    zFrame(z, events);
    check("the maul opens on the script's first entry",
          z.motion === 10 && z.zom.targetCue === 3 && z.sub === 2,
          `motion ${z.motion} cue ${z.zom.targetCue}`);
    check("and has not touched the civilian yet",
          !(civ.flags & ActorFlag.Dead));
    // Cue 3 in the **play** clock, which ticks at 60 Hz over 30 Hz data — so
    // three sixtieths, not three thirtieths. This fixture encoded the wrong
    // one, and it agreed with a `frameOf` that was also counting in authored
    // frames: two halves of the same mistake, which is why the corpus (five
    // of stage 1's six maul cues never firing) caught it and this did not.
    z.playTicks = 3;
    zFrame(z, events);
    check("on the cue frame it kills the civilian outright",
          (civ.flags & ActorFlag.Dead) !== 0 && killed,
          `flags ${civ.flags.toString(16)}`);
  }

  // **The order.** Class 0x10's op 0x1A writes a state and a countdown into
  // its own block, and `ZombieStateAwaitCivilianOrder` is the captor sitting
  // on it. `0x31` means die.
  {
    const { civ, z, events } = captorScene(
      ZombieState.AwaitCivilianOrder, 1, null,
      [[{ op: CivilianOp.Wait, args: [CivilianWait.Free] },
        { op: CivilianOp.SetChildCue, args: [ZombieState.OrderDie, 2] },
        { op: CivilianOp.Wait, args: [0] },
        { op: CivilianOp.End, args: [] }]]);
    check("the civilian's op 0x1A is an order to its captors, not a spare word",
          civ.civ!.childOrder === ZombieState.OrderDie
          && civ.civ!.childOrderFrames === 2,
          `order ${civ.civ!.childOrder}/${civ.civ!.childOrderFrames}`);
    // Sub 0 runs on into sub 1 -- the `INC` at 0x0045BB3A is followed by sub
    // 1's first instruction -- so an order already waiting is taken on the
    // captor's first frame.
    G.g_players_in_play = 1;
    G.g_active_player = 1;
    zFrame(z, events);            // hides, then takes the order
    check("...and the captor obeys it on its first frame: 0x31 is die",
          z.dead && (z.flags & ActorFlag.Dead) !== 0 && z.sub === 2,
          `dead ${z.dead} state ${z.state} sub ${z.sub}`);
    // The civilian names nobody (`sub+0x6C` is -1 until a rescue), so with one
    // player in play the kill goes to `g_active_player` -- no `rand()`.
    check("...credited to `g_active_player` while one player is in play",
          z.killedBy === 1, `killedBy ${z.killedBy}`);
    // `ReleaseEnemyAliveCount` and `ReleaseEnemyPresentCount` at
    // 0x0045BBAB/0x0045BBB1, on the frame of the order, not on a later sweep.
    check("...and both enemy counts are given back on that same frame",
          (z.flags38 & (CountFlag.LeftAlive | CountFlag.LeftPresent))
            === (CountFlag.LeftAlive | CountFlag.LeftPresent),
          `flags38 ${z.flags38.toString(16)}`);
    zFrame(z, events);            // sub 2: gone
    check("...and it leaves the pool the frame after", z.despawned);
  }

  // **B6 — an ordered captor still needs its target script.**
  //
  // A captor whose descriptor starts it in state 39 is put into a state by
  // the civilian, and `ZombieScriptForState` (`FUN_0045CA10`) then hands *that*
  // state the tail+0x04 blob. The exporter used to decode that blob with state
  // 39's header shape, which does not exist, so it exported `null` — and this
  // state reads a zero arrive radius out of a missing script and walks at the
  // civilian for ever. Stage 1 block 9's 0x4B74 and 0x4BD0 are the two that
  // did it; their real header is `arrive 12.0, motion 1026`.
  //
  // The producer is the exporter's; this is the
  // consumer, and it is the assertion that says a null script is not survivable
  // rather than merely unusual.
  {
    const ordered: TargetScriptJson = {
      state: ZombieState.WalkToTarget,
      head: { arrive: 12, loops: 1, motion: 10, frame: 0 },
      entries: [{ motion: 10, frame: 0, loops: 1, mode: 5 }],
    };
    const { civ, z, events } = captorScene(ZombieState.AwaitCivilianOrder,
      ZombieState.WalkPastPoint, ordered,
      [[{ op: CivilianOp.Wait, args: [CivilianWait.Free] },
        { op: CivilianOp.SetChildCue, args: [ZombieState.WalkToTarget, 2] },
        { op: CivilianOp.Wait, args: [0] },
        { op: CivilianOp.End, args: [] }]]);
    zFrame(z, events);                       // hides, takes the order
    zFrame(z, events);                       // and walks
    check("an ordered captor enters the state its civilian named",
          z.state === ZombieState.WalkToTarget, `state ${z.state}`);
    zFrame(z, events);
    check("...and reads the tail+0x04 header the order's state gives it",
          z.zom.targetArrive === 12, `arrive ${z.zom.targetArrive}`);
    z.pos = vec3(0, 0, 6);                   // inside 12, outside the old 0
    zFrame(z, events);
    check("...so it can arrive, and hand over to the maul",
          z.state === ZombieState.TargetMotionScript, `state ${z.state}`);
    check("...which is what frees the civilian",
          (civ.civ!.wait & CivilianWait.Free) !== 0,
          `wait ${civ.civ!.wait.toString(16)}`);
  }

  // **A captor waiting on the order is not drawn.** `FUN_0045BAD0` sub 0
  // clears `obj+0x1F8` bit 0 -- the skeleton's draw gate -- and writes 0 to
  // the model's first part-draw byte through `obj+0x1D4`, and taking the order
  // puts both back — so the two `znebi2` of stage 2 block 16 are in the water,
  // invisible, until their civilian calls them up.
  //
  // **Part 0 alone**, not `ActorSetPartVisibility`: a character with a second
  // vertex-blended part keeps drawing it. The port used to hold one alpha for
  // the whole actor here and could not say either thing.
  //
  // And the order arm ends in `g_class30_states[obj+0x1310](obj)`, a tail call
  // through the table, so the state it hands over to runs on the **same**
  // frame rather than the next one.
  {
    const ordered: TargetScriptJson = {
      state: ZombieState.WalkToTarget,
      head: { arrive: 12, loops: 1, motion: 10, frame: 0 },
      entries: [{ motion: 10, frame: 0, loops: 1, mode: 5 }],
    };
    const { civ, z, events } = captorScene(ZombieState.AwaitCivilianOrder,
      ZombieState.WalkPastPoint, ordered,
      [[{ op: CivilianOp.Wait, args: [CivilianWait.Free] },
        { op: CivilianOp.SetChildCue, args: [ZombieState.WalkToTarget, 2] },
        { op: CivilianOp.Wait, args: [0] },
        { op: CivilianOp.End, args: [] }]]);
    const skeleton = () => (z.motionFlags & MotionFlag.Drawn) !== 0;
    check("a captor awaiting the order starts drawn, skeleton and both parts",
          skeleton() && z.partVisible.join() === "1,1",
          `flags ${z.motionFlags} parts ${z.partVisible}`);
    // Nothing ordered yet, so the hide is all the first frame does.
    const count = civ.civ!.childOrderFrames;
    civ.civ!.childOrderFrames = 0;
    G.g_world_slot_draws = [];
    zFrame(z, events);                       // sub 0, into sub 1
    check("...and sub 0 takes the skeleton and part 0 off screen, not part 1",
          !skeleton() && z.partVisible.join() === "0,1" && z.sub === 1,
          `flags ${z.motionFlags} parts ${z.partVisible} sub ${z.sub}`);
    check("...and the shadow with it: the draw's `ActorDrawShadow` reads the "
          + "same bit", shadowsUnder(z).length === 0,
          `${shadowsUnder(z).length} discs`);
    const flagsWhileHidden = z.flags;
    civ.civ!.childOrderFrames = count;
    zFrame(z, events);                       // takes the order
    check("...the order puts both back",
          skeleton() && z.partVisible.join() === "1,1",
          `flags ${z.motionFlags} parts ${z.partVisible}`);
    // `obj+0x34 = obj+0x1350` restores the word whole, so the two bits sub 0
    // raised come off. Not an equality: the state it hands over to runs on
    // this same frame and writes its own bits on top.
    check("...restoring the flags `obj+0x1350` saved",
          (flagsWhileHidden & 0x18000) === 0x18000
          && (z.flags & 0x18000) === 0,
          `flags ${z.flags.toString(16)} vs ${flagsWhileHidden.toString(16)}`);
    check("...and the state it was ordered into has already run this frame",
          z.motion === 10, `motion ${z.motion}`);
  }
  {
    // The failure itself, stated: with no script the radius is zero and the
    // captor can never reach it, whatever it does.
    const { z, events } = captorScene(ZombieState.WalkToTarget, 1, null);
    zFrame(z, events);
    z.pos = vec3(0, 0, 0.5);
    zFrame(z, events);
    check("a captor with no target script has a radius nothing satisfies",
          z.zom.targetArrive === 0 && z.state === ZombieState.WalkToTarget,
          `arrive ${z.zom.targetArrive} state ${z.state}`);
  }

  // The script ends by flipping roles, and only the *attack* script running
  // out sends the actor at the player.
  {
    const { z } = captorScene(ZombieState.WalkToTarget,
                              ZombieState.RetireOffScreen, null);
    ZombieScriptEnded(z);
    check("a finished target script hands over to the attack state",
          z.state === ZombieState.RetireOffScreen, `state ${z.state}`);
    ZombieScriptEnded(z);
    check("...and only a finished attack script sends it at the player",
          z.state === ZombieState.AttackRun, `state ${z.state}`);
  }

  // **The cursor carries which blob it is in, not just how far.** A captor's
  // descriptor has two script blobs and `obj+0x1398` is a *pointer* into one
  // of them; `ZombieScriptForState` (`FUN_0045CA10`) is called only where the
  // engine writes that pointer, never on the steps that read it back.
  //
  // This port kept an index and re-derived the blob from `obj.state` on every
  // read. A captor whose initial state is 35 and whose attack state is 34
  // therefore broke: the walk leaves the cursor in the **attack** blob and
  // hands over to state 35, which is not its attack state, so the next read
  // returned the *target* blob, replayed the approach clip it had already
  // finished, and bounced back to the walk. Stage 3's two `znkage` circled
  // their hostage for ever and her script never left `children-alive`.
  {
    const target: TargetScriptJson = {
      state: ZombieState.TargetMotionScript, head: {},
      entries: [{ motion: 10, frame: 0, loops: 1, mode: -1 }],
    };
    const attack: TargetScriptJson = {
      state: ZombieState.WalkToTarget,
      head: { arrive: 50, loops: 1, motion: 10, frame: 0 },
      entries: [{ motion: 12, frame: 0, loops: 1, mode: 5 }],
    };
    // The shipped shape: start in the maul state, walk as the attack state.
    const { civ, z, events } = captorScene(
      ZombieState.TargetMotionScript, ZombieState.WalkToTarget, target,
      undefined, attack);
    z.pos = vec3(0, 0, 20);                    // already inside `arrive`
    check("it starts on the target blob", z.zom.scriptBlob === 0,
          `blob ${z.zom.scriptBlob}`);

    // Play it out: the target entry ends, the walk takes over, and the walk
    // arrives at once because it is already inside the radius.
    for (let i = 0; i < 400; i++) {
      if (z.state === ZombieState.TargetMotionScript && z.zom.scriptBlob === 1) break;
      // `EnemyZombieUpdate` does not advance the clip -- `GameUpdate` does, and
      // every cue in this family is a play-cursor comparison, so the clock has
      // to run or no entry ever ends.
      ActorAdvanceMotion(z, 1 / 60);
      zFrame(z, events);
    }
    check("...and the walk hands the maul the attack blob, not the target one",
          z.zom.scriptBlob === 1 && z.state === ZombieState.TargetMotionScript,
          `blob ${z.zom.scriptBlob} state ${z.state}`);
    // Sub 1 is the frame that loads the entry the cursor points at, so the
    // clip is only on the actor once it has run.
    ActorAdvanceMotion(z, 1 / 60);
    zFrame(z, events);
    check("...so the clip it plays is the maul's, not the approach's again",
          z.motion === 12, `motion ${z.motion}`);

    // And the maul's cue kills the civilian, which is the whole point of the
    // hand-over: `mode` is the play frame the kill lands on.
    for (let i = 0; i < 400 && !(civ.flags & ActorFlag.Dead); i++) {
      ActorAdvanceMotion(z, 1 / 60);
      zFrame(z, events);
    }
    check("...and its cue frame is what kills the hostage",
          (civ.flags & ActorFlag.Dead) !== 0, `flags 0x${civ.flags.toString(16)}`);
  }

  // **State 43's tail, which is its only exit**.
  //
  // `ZombieStateDragTarget` (`FUN_0045C080`) raises `0x10100` on itself when
  // it kills, so from that frame `DispatchHit` skips `ResolveHit` and nothing
  // can shoot the captor out of `g_enemies_alive`. Sub 3 never increments the
  // sub-state. The one thing that ends it is the tail at `0x0045C1AD`:
  // `g_script_flags[0x1D]` plus `g_players_in_play`, releasing both enemy
  // counts and going to sub 4, which despawns. The port had the sub-4 arm and
  // nothing that could ever assign sub 4, so stage 4's entry-4 route stopped
  // at block 9 with one `znkage` alive at 90 hit points for ever.
  {
    const drag: TargetScriptJson = {
      state: ZombieState.DragTarget,
      // One loop, and a cue at play cursor 4 so the kill lands early.
      head: { loops: 1, cue: 4 },
      entries: [],
    };
    const step = (z: ZombieActor, events: Events, n: number) => {
      for (let i = 0; i < n; i++) {
        ActorAdvanceMotion(z, 1 / 60);
        zFrame(z, events);
      }
    };

    {
      const { civ, z, events } = captorScene(ZombieState.DragTarget, 1, drag);
      // The room the gate is reading, as `EnemyZombieInit` leaves it.
      G.g_enemies_alive = 1;
      G.g_enemies_present = 1;
      G.g_players_in_play = 1;

      step(z, events, 1);
      check("state 43 sub 0 falls into the drag on its own frame",
            z.sub === 1 && z.motion === 0x1a4, `sub ${z.sub} motion ${z.motion}`);

      // The drag glues the captor to the civilian -- all three rotations, not
      // just the yaw.
      civ.pos = vec3(7, 8, 9);
      civ.pitch = 0x111; civ.yaw = 0x222; civ.roll = 0x333;
      step(z, events, 1);
      // x and z only: this fixture has no collision set, so the ground snap
      // that runs after the state puts y at the no-floor floor. The rotations
      // are the half that was missing -- the port copied `yaw` alone and the
      // engine copies `obj+0x64`, `0x68` and `0x6C`.
      check("...and the pose it copies is the position and all three rotations",
            z.pos.x === 7 && z.pos.z === 9
            && z.pitch === 0x111 && z.yaw === 0x222 && z.roll === 0x333,
            `pos ${z.pos.x},${z.pos.y},${z.pos.z} `
            + `rot ${z.pitch},${z.yaw},${z.roll}`);

      // The cue kills her and makes the captor shot-immune.
      step(z, events, 40);
      check("...the cue frame kills the civilian and raises `0x10100` on itself",
            (civ.flags & ActorFlag.Dead) !== 0
            && (z.flags & ActorFlag.ShotImmune) !== 0,
            `civ 0x${civ.flags.toString(16)} z 0x${z.flags.toString(16)}`);

      // Sub 2 is its own arm. It used to fall through into sub 1's loop-and-cue
      // block, whose second half fires the moment the civilian is dead -- so
      // the settle was skipped in a single frame and the state went straight
      // to the turn.
      check("...and it settles in sub 2 rather than skipping to the turn",
            z.sub === 2, `sub ${z.sub}`);
      step(z, events, 400);
      check("...then reaches sub 3, which never advances again",
            z.sub === 3 && z.state === ZombieState.DragTarget,
            `sub ${z.sub} state ${z.state}`);

      // **This is the hang.** Nothing has raised flag 29, so the captor is
      // still in the room and still cannot be shot out of it.
      check("with `g_script_flags[0x1D]` down it holds both enemy counts open",
            G.g_enemies_alive === 1 && G.g_enemies_present === 1
            && !z.dead && z.visible,
            `alive ${G.g_enemies_alive} present ${G.g_enemies_present}`);

      // ...and the flag is what ends it, on the very next frame.
      G.g_script_flags[0x1d] = 1;
      step(z, events, 1);
      check("...and the flag releases both counts and sends it to sub 4",
            G.g_enemies_alive === 0 && G.g_enemies_present === 0
            && z.sub === 4 && (z.flags & ActorFlag.Dead) !== 0,
            `alive ${G.g_enemies_alive} present ${G.g_enemies_present} `
            + `sub ${z.sub} flags 0x${z.flags.toString(16)}`);
      step(z, events, 1);
      check("...and sub 4 despawns it", !z.visible, `visible ${z.visible}`);
    }

    // `g_players_in_play` is the second half of the test, and it is an
    // `AND`: the tail does nothing before anyone has started.
    {
      const { z, events } = captorScene(ZombieState.DragTarget, 1, drag);
      G.g_enemies_alive = 1;
      G.g_enemies_present = 1;
      G.g_players_in_play = 0;
      G.g_script_flags[0x1d] = 1;
      step(z, events, 4);
      check("the tail is an AND: flag 29 up with no player in play holds",
            G.g_enemies_alive === 1 && z.sub !== 4,
            `alive ${G.g_enemies_alive} sub ${z.sub}`);
    }

    // The tail is reached from **every** sub, not only from the turn: the
    // `goto switchD_0045c0aa_default` out of sub 1's "nothing to do" arm is
    // the same block.
    {
      const { z, events } = captorScene(ZombieState.DragTarget, 1, drag);
      G.g_enemies_alive = 1;
      G.g_enemies_present = 1;
      G.g_players_in_play = 1;
      step(z, events, 1);
      check("a captor still in sub 1 is where the flag can catch it",
            z.sub === 1, `sub ${z.sub}`);
      G.g_script_flags[0x1d] = 1;
      step(z, events, 1);
      check("...and the tail runs from sub 1 as well as from sub 3",
            z.sub === 4 && G.g_enemies_alive === 0,
            `sub ${z.sub} alive ${G.g_enemies_alive}`);
    }
  }

}

console.log("\nclass 0x30's placement: the ground snap and the two entrances:");
{
  const rng = new Rng(21);
  // A floor at y = 0 and nothing else, so the snap has exactly one answer.
  const scene30 = () => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    T.coli = { files: ["t"], blobs: { floor: FLOOR_BLOB } };
    G.g_coli_full_set = ["floor"];
    G.g_camera_fixed_eye_y = -1e9;     // a miss must not pass as a hit
    const z = spawnZombie(0x6000, 1, "placed");
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.radius = 10;
    return z;
  };

  // **The bug this fixes.** Nothing in the port ever put a class-0x30 actor on
  // the collision floor: its `y` was whatever the spawn record said, for ever.
  {
    const z = scene30();
    // Three under the floor: the probe starts six units above the actor's own
    // y, so that is what "below" can mean. A water spawn ten units down is out
    // of its reach until the emerge clip has brought it most of the way up —
    // which is the engine's limit too, and why the clip is not decoration.
    z.pos = vec3(0, -3, 0);
    ActorSnapToGroundHeight(z);
    check("an actor below the floor is brought up to it", z.pos.y === 0,
          `y ${z.pos.y}`);
    z.pos = vec3(0, -40, 0);
    ActorSnapToGroundHeight(z);
    check("...but only from within the six-unit probe", z.pos.y === -1e9,
          `y ${z.pos.y}`);
    z.pos = vec3(0, 6, 0);             // a little above it
    ActorSnapToGroundHeight(z);
    check("...and one just above it is stuck to it", z.pos.y === 0,
          `y ${z.pos.y}`);
  }

  // More than ten units of air, and only when the actor may leave the floor,
  // is a fall rather than a snap.
  {
    const z = scene30();
    z.pos = vec3(0, 40, 0);
    z.flags2 &= ~ZombieFlag2.MayFall;
    ActorSnapToGroundHeight(z);
    check("without the fall bit even forty units snaps", z.pos.y === 0,
          `y ${z.pos.y}`);
    z.pos = vec3(0, 40, 0);
    z.flags2 |= ZombieFlag2.MayFall;
    ActorSnapToGroundHeight(z);
    check("with it, the actor falls instead",
          z.state === ZombieState.FallToGround && z.pos.y === 40,
          `state ${z.state} y ${z.pos.y}`);
  }

  // `ZombieStateEmerge`: hold the submerged pose for the descriptor's delay,
  // then play the clip it names. The clip is what the player sees coming out
  // of the water; the snap is what keeps its feet on the bottom.
  {
    const z = scene30();
    z.pos = vec3(0, -5, 0);
    z.emerge = { delay: 30, motion: 12 };
    z.state = ZombieState.Emerge;
    check("state 27 is an entrance, not a synonym for AttackRun",
          z.state === ZombieState.Emerge, `state ${z.state}`);
    EnemyZombieUpdate(z, { dt: 1 / 60, rng, host: NULL_HOST });
    // Case 0 falls into case 1 in the engine's jump table, so the first
    // frame both cuts to 0xB9 and counts one frame of the delay off. And
    // nothing in the state writes `obj+0x34` bit 0x4000: the pose plays.
    check("...which cuts to the submerged pose and counts its first frame",
          z.motion === 0xb9 && z.zom.holdFrames === 29,
          `motion ${z.motion} hold ${z.zom.holdFrames}`);
    check("...without freezing the clock, which the engine never does",
          z.frozen === 0 && (z.flags & ActorFlag.PoseFrozen) === 0,
          `frozen ${z.frozen} flags ${z.flags.toString(16)}`);
    for (let i = 0; i < 28; i++) {
      EnemyZombieUpdate(z, { dt: 1 / 60, rng, host: NULL_HOST });
    }
    check("it waits the descriptor's delay out", z.motion === 0xb9,
          `motion ${z.motion}`);
    EnemyZombieUpdate(z, { dt: 1 / 60, rng, host: NULL_HOST });
    check("and then plays the clip the descriptor names, on frame 30",
          z.motion === 12 && z.frozen === 0, `motion ${z.motion}`);
    // And the snap has it standing on the floor rather than under it.
    check("...on the floor, not five units under it", z.pos.y === 0,
          `y ${z.pos.y}`);
  }

  // A zero delay starts the emerge clip on the spawn frame -- sub 0 into sub
  // 1 into sub 2 without a return -- and `tail+0x03 == 1` keeps the actor
  // undrawn until then (`ActorSetPartVisibility`, `FUN_00409D10`, with 0 at
  // `0x0045855A` and with 1 at `0x004585DC`).
  {
    const z = scene30();
    z.emerge = { delay: 0, motion: 12 };
    z.state = ZombieState.Emerge;
    EnemyZombieUpdate(z, { dt: 1 / 60, rng, host: NULL_HOST });
    check("a zero-delay emerge plays its clip on the spawn frame",
          z.motion === 12 && z.sub === 2, `motion ${z.motion} sub ${z.sub}`);

    const w = scene30();
    w.emerge = { delay: 15, motion: 12 };
    w.attackState = 1;
    w.state = ZombieState.Emerge;
    G.g_world_slot_draws = [];
    EnemyZombieUpdate(w, { dt: 1 / 60, rng, host: NULL_HOST });
    // Both gates: `obj+0x1F8 &= ~1` for the skeleton and
    // `ActorSetPartVisibility(model, 0)` for every part -- and the
    // `obj+0x34 |= 0x90000` that takes the shadow and the camera with it.
    check("`tail+0x03 == 1` is not drawn while it waits: no skeleton, no parts",
          (w.motionFlags & MotionFlag.Drawn) === 0
          && w.partVisible.join() === "0,0"
          && (w.flags & ActorFlag.NoShadow) !== 0
          && shadowsUnder(w).length === 0,
          `flags ${w.motionFlags} parts ${w.partVisible}`);
    check("...and the port's alpha is not what hides it", w.alpha === 1,
          `alpha ${w.alpha}`);
    check("...while the one with `tail+0x03 != 1` is drawn from the start",
          (z.motionFlags & MotionFlag.Drawn) !== 0
          && z.partVisible.join() === "1,1");
    for (let i = 0; i < 14; i++) {
      G.g_world_slot_draws = [];
      EnemyZombieUpdate(w, { dt: 1 / 60, rng, host: NULL_HOST });
    }
    check("...and is drawn again as the clip starts, shadow and all",
          w.motion === 12 && (w.motionFlags & MotionFlag.Drawn) !== 0
          && w.partVisible.join() === "1,1" && shadowsUnder(w).length === 1,
          `motion ${w.motion} flags ${w.motionFlags} parts ${w.partVisible}`);
  }

  // **The hand-over does not sink the actor back into the water.** Stage 2
  // block 16: `ZombieStateEmerge` leaves on the last frame of its clip and
  // `ZombieStateAttackRun` starts the run over a 10-frame fade. The engine
  // dissolves from a *still* of the last drawn pose -- `ActorSetMotionBlended`
  // (`FUN_004119A0`) snapshots it into slot A through `MotionLoadPoseSlot`
  // (`FUN_00411C20`) mode 0xC -- and holds the run on its start frame until
  // the fade is done (`SkeletonAdvancePlayCursor`, `FUN_004111A0`). The port
  // ran the outgoing clock on past the end of the clip, the poser's `% frames`
  // wrapped it to frame 0, and frame 0 of an emerge clip is the submerged
  // crouch: the zombie dropped under the surface for the fade and stood up.
  {
    const z = scene30();
    // 700 rather than 12: the fixture's run *is* 12, and a run started over
    // itself would fade out of the run, not out of the emerge clip.
    z.emerge = { delay: 0, motion: 700 };
    // Well out of the rings, so the run is still the run when its fade ends.
    z.pos = vec3(0, 0, 150);
    z.allowance = 8;
    z.state = ZombieState.Emerge;
    const em = MotionOf(z, 700)!;
    const step = () => {
      ActorAdvanceMotion(z, 1 / 60);
      EnemyZombieUpdate(z, { dt: 1 / 60, rng, host: NULL_HOST });
    };
    for (let i = 0; i < 200 && z.state === ZombieState.Emerge; i++) step();
    check("the emerge clip hands over to the attack run",
          z.state === ZombieState.AttackRun, ZombieState[z.state]);
    // Run the attack run's first frame, which is where the fade starts.
    step();
    const from = z.fadeFrom;
    check("...over a fade out of the emerge clip",
          from?.motion === 700 && z.fade > 0, JSON.stringify(from));
    const startCursor = MotionPlayFrame(z);
    const at = { ...z.pos };
    const frames: number[] = [];
    let held = true;
    let fadeFrames = 0;
    // How far the frames that end still inside the fade move it, and how far
    // the one that ends the fade does.
    let movedHeld = 0;
    let lastStep = 0;
    while (z.fadeFrom && fadeFrames < 40) {
      frames.push(authoredFrameOfTicks(z.fadeFrom.ticks, em.fps, em.frames));
      if (MotionPlayFrame(z) !== startCursor) held = false;
      const before = { ...z.pos };
      step();
      if (z.fadeFrom) {
        movedHeld = Math.max(movedHeld,
                             Math.hypot(z.pos.x - at.x, z.pos.z - at.z));
      } else {
        lastStep = Math.hypot(z.pos.x - before.x, z.pos.z - before.z);
      }
      fadeFrames += 1;
    }
    check("...dissolving from the clip's last pose on every frame of it, "
          + "never its first", frames.length > 0
            && frames.every((f) => f === em.frames - 1),
          frames.join(","));
    check("...while the run is held on its start frame, as the engine holds "
          + "it", held && fadeFrames === 11, `held ${held} for ${fadeFrames}`);
    check("...and nothing walks the actor until the fade is over",
          movedHeld < 1e-9, `moved ${movedHeld.toFixed(3)}`);
    check("...after which the run moves on from the frame after it",
          MotionPlayFrame(z) === startCursor + 1,
          `${MotionPlayFrame(z)} after ${startCursor}`);
    // That cursor is odd, and `SkeletonAdvancePlayCursor` (`FUN_004111A0`)
    // poses an odd cursor between its two authored frames at one half: the
    // frame the fade ends steps the actor half of the run's first frame, not
    // nothing and not all of it.
    const run = MotionOf(z, 12)!;
    const half = Math.hypot(run.root[3] - run.root[0],
                            run.root[5] - run.root[2]) / 2;
    check("...and the frame the fade ends steps half an authored frame of it",
          startCursor % 2 === 0 && half > 0
          && Math.abs(lastStep - half * z.scale) < 1e-9,
          `stepped ${lastStep.toFixed(4)}, half a frame ${half.toFixed(4)}`);
  }

  // **A zombie in its emerge animation does not stagger when it is shot.**
  //
  // `ZombieStateEmerge` (`FUN_004584E0`) raises `obj+0x34` `0x2100` in sub 0
  // (`00458532 OR DH, 0x21`), drops `0x100` when the clip starts
  // (`004585EC AND EDX, 0xfff6feff`) and drops `0x2000` on the hand-over
  // (`0045869F AND DH, 0xdf`). `ActorPlayHitReaction` (`FUN_004544C0`) refuses
  // outright while `0x2000` is up — `004544D8 TEST dword ptr [ESI+0x34],
  // 0x10002000` — so the whole entrance is stagger-proof.
  {
    const z = scene30();
    z.pos = vec3(0, -5, 0);
    z.emerge = { delay: 30, motion: 12 };
    z.state = ZombieState.Emerge;
    EnemyZombieUpdate(z, { dt: 1 / 60, rng, host: NULL_HOST });
    check("sub 0 raises both of the bits `OR DH, 0x21` names",
          (z.flags & (ActorFlag.ShotImmune | ActorFlag.NoHitReaction))
            === (ActorFlag.ShotImmune | ActorFlag.NoHitReaction),
          `flags ${z.flags.toString(16)}`);
    check("a shot on the submerged pose plays no stagger",
          ActorPlayHitReaction(z, 1, HitResultCode.Damaged) === undefined
            && z.react === null, JSON.stringify(z.react));

    for (let i = 0; i < 30; i++) {
      EnemyZombieUpdate(z, { dt: 1 / 60, rng, host: NULL_HOST });
    }
    check("the clip that lifts it out is playing, and it is shootable again",
          z.motion === 12 && (z.flags & ActorFlag.ShotImmune) === 0,
          `motion ${z.motion} flags ${z.flags.toString(16)}`);
    check("...but `0x2000` is not in that mask, so it still does not stagger",
          (z.flags & ActorFlag.NoHitReaction) !== 0
            && ActorPlayHitReaction(z, 1, HitResultCode.Damaged) === undefined
            && z.react === null, JSON.stringify(z.react));
    // End to end, through the routine that actually calls it: the whole shot
    // lands, hit points come off, and the entrance clip is left alone.
    const before = z.hp;
    ResolveHit(z, 1, NULL_HOST, rng);
    check("...and a whole `ResolveHit` still leaves the entrance running",
          z.hp < before && z.react === null && z.motion === 12
            && z.state === ZombieState.Emerge,
          `hp ${z.hp} react ${JSON.stringify(z.react)} state ${z.state}`);

    // Run the clip out. The base clock is `ActorAdvanceMotion`'s, which is the
    // director's and not this state's, so the cursor is put on the clip's last
    // frame directly — 12 is 16 authored frames, so a play length of 30.
    z.playTicks = MotionPlayLength(z) - 1;
    EnemyZombieUpdate(z, { dt: 1 / 60, rng, host: NULL_HOST });
    check("the emerge hands over to `AttackRun`",
          z.state === ZombieState.AttackRun, `state ${z.state}`);
    check("...clearing `0x2000` as it goes",
          (z.flags & ActorFlag.NoHitReaction) === 0,
          `flags ${z.flags.toString(16)}`);
    check("...so now the same shot does stagger",
          ActorPlayHitReaction(z, 1, HitResultCode.Damaged) !== undefined
            && z.react !== null, JSON.stringify(z.react));
  }

  // **And two writes to `obj+0x136C`.** Sub 0 raises `0x100002`
  // (`OR EAX, 0x100002` at `0x00458528`) -- or, when `obj+0x34` has
  // `0x200000`, clears that and raises `0x10` (`OR AL, 0x10` at `0x0045851E`)
  // -- and the hand-over drops `0x100000` (`AND EDX, 0xffefffff` at
  // `0x004586B4`). `ZombieOnShot` reads `0x100000`, so a zombie killed while
  // it climbs out dies through state 9; knockback reads `0x10` as its
  // arc-target veto, which had no writer the port knew of.
  {
    const z = scene30();
    z.pos = vec3(0, -5, 0);
    z.emerge = { delay: 30, motion: 12 };
    z.state = ZombieState.Emerge;
    EnemyZombieUpdate(z, { dt: 1 / 60, rng, host: NULL_HOST });
    check("sub 0 raises obj+0x136C 0x100002",
          (z.flags2 & 0x100002) === 0x100002 && (z.flags2 & 0x10) === 0,
          `0x136C 0x${(z.flags2 >>> 0).toString(16)}`);
    for (let i = 0; i < 60 && z.state === ZombieState.Emerge; i++) {
      EnemyZombieUpdate(z, { dt: 1 / 60, rng, host: NULL_HOST });
      if (z.motion === 12) z.playTicks = MotionPlayLength(z) - 1;
    }
    check("...and the hand-over takes 0x100000 back down",
          z.state === ZombieState.AttackRun
            && (z.flags2 & ZombieFlag2.Carried) === 0
            && (z.flags2 & 0x2) !== 0,
          `${ZombieState[z.state]} 0x136C 0x${(z.flags2 >>> 0).toString(16)}`);

    const alt = scene30();
    alt.flags |= 0x200000;
    alt.emerge = { delay: 30, motion: 12 };
    alt.state = ZombieState.Emerge;
    EnemyZombieUpdate(alt, { dt: 1 / 60, rng, host: NULL_HOST });
    check("...with obj+0x34 0x200000 it clears that and raises 0x10 instead",
          (alt.flags & 0x200000) === 0 && (alt.flags2 & 0x10) !== 0
            && (alt.flags2 & 0x100002) === 0,
          `0x34 0x${(alt.flags >>> 0).toString(16)} `
          + `0x136C 0x${(alt.flags2 >>> 0).toString(16)}`);

    // What the bit is for: shot dead while the clip lifts it out.
    const shot = scene30();
    shot.emerge = { delay: 0, motion: 12 };
    shot.state = ZombieState.Emerge;
    EnemyZombieUpdate(shot, { dt: 1 / 60, rng, host: NULL_HOST });
    shot.dead = true;
    shot.flags |= ActorFlag.Dead;
    shot.pendingHit = { bone: 1, result: 1 };
    ZombieOnShot(shot);
    check("...so a zombie killed on its way out dies through state 9",
          shot.state === ZombieState.DeathKnockbackArc,
          ZombieState[shot.state]);
  }

  // `ActorArcBeginFalling` counts its own frames from the gravity, which is
  // the thing that makes state 26 different from every other arc in the port.
  {
    const z = scene30();
    z.pos = vec3(0, 40, 0);
    ActorArcBeginFalling(z, [30, 0, 0], 0.04);
    // `z.zom.holdFrames`, not `z.holdFrames`: the head still has a field of
    // that name and it is class 0x24's `obj+0x1320`. This assertion read the
    // wrong word the moment class 0x30's reading moved to the arm, and said
    // so — which is why the arm's doc calls the surviving head field a trap.
    check("the delayed leap's frame count comes from the drop and the gravity",
          z.zom.holdFrames > 40 && z.zom.holdFrames < 50,
          `${z.zom.holdFrames} frames`);
    check("...and the flat speed divides the distance by it",
          Math.abs(z.vel.x - 30 / z.zom.holdFrames) < 1e-4, `vx ${z.vel.x}`);
    check("...with gravity on the y axis", Math.abs(z.accY + 0.04) < 1e-6,
          `accY ${z.accY}`);
  }

}

console.log("\nclass 0x30's two spheres: the wall push and the crowd push:");
{
  const scenePush = () => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    T.coli = { files: ["t"], blobs: { wall: WALL_BLOB, floor: FLOOR_BLOB } };
    G.g_coli_full_set = ["wall", "floor"];
    G.g_camera_fixed_eye_y = 0;
  };

  // **The bug this fixes.** `EnemyZombieInit` writes both radii and the port
  // wrote neither, so every zombie collided as a point of radius zero and the
  // world push could never find anything to be pushed out of.
  {
    scenePush();
    const z = spawnZombie(0x7000, 1, "radii");
    check("the Init sets the shot radius and the body radius",
          z.radius === 10 && z.bodyRadius === 3.5,
          `shot ${z.radius} body ${z.bodyRadius}`);
  }

  // `WALL_BLOB` is the plane x = 30. Put an actor inside it and it must come
  // back out rather than through.
  {
    scenePush();
    const z = spawnZombie(0x7001, 1, "walled");
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.pos = vec3(29, 0, 45);
    const before = z.pos.x;
    ZombiePushOutOfWorldAndActors(z);
    check("an actor inside a wall is pushed back out of it", z.pos.x < before,
          `x ${z.pos.x.toFixed(2)} from ${before}`);
  }

  // The crowd push is **mutual and deferred**: the mover records the opposite
  // push on whoever it found, who applies it on its own next frame. That is
  // what makes it one test per actor rather than one per pair.
  {
    scenePush();
    const a = spawnZombie(0x7002, 1, "a");
    const b = spawnZombie(0x7003, 1, "b");
    for (const z of [a, b]) { z.visible = true; z.hp = z.maxHp = 100; }
    a.pos = vec3(0, 0, 0);
    b.pos = vec3(2, 0, 0);             // well inside 3.5 + 3.5
    const gap0 = Math.abs(a.pos.x - b.pos.x);
    PublishCrowd(a, b);
    ZombiePushOutOfWorldAndActors(a);
    check("an actor inside another is pushed away from it", a.pos.x < 0,
          `ax ${a.pos.x.toFixed(3)}`);
    check("...and the other is told which way, not moved",
          b.pos.x === 2 && b.pushedBy === a.at && b.pushNormal.x > 0,
          `bx ${b.pos.x} by ${b.pushedBy}`);
    ZombiePushOutOfWorldAndActors(b);
    check("which it does on its own next frame",
          b.pos.x > 2 && b.pushedBy === -1, `bx ${b.pos.x.toFixed(3)}`);
    check("so the two separate", Math.abs(a.pos.x - b.pos.x) > gap0,
          `gap ${Math.abs(a.pos.x - b.pos.x).toFixed(3)} from ${gap0}`);
  }
}

// -- the crowd push, as `ZombiePushOutOfWorldAndActors` (`FUN_00454900`) and
// `ColiTestSphereAgainstActors` (`FUN_00405B10`) do it ----------------------
//
// Every number below is the exe's: a tenth of the depth a frame
// (`0x004C4CC8`), 1.8x (`0x0055DD48`) for `obj+0x34 & 0x18000000`, the
// candidate list published a frame late by `ColiPublishDynamicList`
// (`FUN_00405360`), and the depth re-derived from the two surface points at
// `0x00405E8A`. Two 3.5 bodies two units apart overlap by five.
console.log("\nthe crowd push, as the exe runs it:");
{
  const crowd = (): [ZombieActor, ZombieActor] => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    G.g_camera_fixed_eye_y = 0;          // no collision: the ground plane
    const a = spawnZombie(0x7a00, 1, "a");
    const b = spawnZombie(0x7a01, 1, "b");
    for (const z of [a, b]) {
      z.visible = true;
      z.hp = z.maxHp = 100;
      z.flags2 |= ZombieFlag2.CollideActors;
    }
    a.pos = vec3(0, 0, 0);
    b.pos = vec3(2, 0, 0);
    return [a, b];
  };
  const near = (u: number, v: number, e = 1e-3) => Math.abs(u - v) < e;

  // -- one frame, both halves ----------------------------------------------
  {
    const [a, b] = crowd();
    PublishCrowd(a, b);
    ZombiePushOutOfWorldAndActors(a);
    check("an actor two units inside another moves a tenth of the five-unit "
          + "overlap, straight away from it",
          near(a.pos.x, -0.5) && near(a.pos.z, 0) && a.pos.y === 0,
          `${a.pos.x}/${a.pos.y}/${a.pos.z}`);
    check("...and records the opposite push on the other -- the depth, and "
          + "the reversed normal -- without moving it",
          b.pos.x === 2 && b.pushedBy === a.at && near(b.pushDepth, 5)
          && near(b.pushNormal.x, 1) && near(b.pushNormal.z, 0),
          `${b.pos.x} ${b.pushedBy} ${b.pushDepth} `
          + JSON.stringify(b.pushNormal));
    ZombiePushOutOfWorldAndActors(b);
    // b takes a's 0.5, and then measures a where a **registered** -- still
    // at 0, not at the -0.5 it has moved to this frame: 2.5 apart, 4.5 deep.
    check("the other applies the recorded half-unit on its own update, then "
          + "measures the first where it registered, not where it now is",
          near(b.pos.x, 2 + 0.5 + 0.45) && b.pushedBy === -1
          && a.pushedBy === b.at && near(a.pushDepth, 4.5),
          `${b.pos.x} ${a.pushedBy} ${a.pushDepth}`);
  }

  // The test on its own, because the hook's later traces overwrite the
  // globals it leaves: the point on this sphere, surface 1, the other object.
  {
    const [a, b] = crowd();
    PublishCrowd(a, b);
    ActorUpdateBoundingSphere(a);
    const hit = ColiTestSphereAgainstActors(a, a.sphereCentre.x,
                                            a.sphereCentre.y, a.sphereCentre.z,
                                            a.bodyRadius);
    check("`ColiTestSphereAgainstActors` leaves the hit in the globals: this "
          + "sphere's surface point toward the other, surface 1, the object",
          hit && G.g_coli_hit_surface === 1 && G.g_coli_hit_object === b.at
          && near(G.g_coli_hit_x, 3.5) && near(G.g_coli_hit_depth, 5),
          `${hit} ${G.g_coli_hit_surface} ${G.g_coli_hit_object} `
          + `${G.g_coli_hit_x} ${G.g_coli_hit_depth}`);
  }

  // -- the 1.8x is Committed and the sprint bit, not the airborne bit ------
  {
    const shove = (bits: number): number => {
      const [a, b] = crowd();
      a.flags |= bits;
      PublishCrowd(a, b);
      ZombiePushOutOfWorldAndActors(a);
      return a.pos.x;
    };
    check("a sprinter (`obj+0x34` 0x8000000) is pushed out 1.8x as far",
          near(shove(ZOMBIE_SPRINTS), -0.9), String(shove(ZOMBIE_SPRINTS)));
    check("...and so is one committed to its strike (0x10000000)",
          near(shove(ActorFlag.Committed), -0.9),
          String(shove(ActorFlag.Committed)));
    check("...and an airborne one (0x20000) is not: that bit only skips the "
          + "ground snap", near(shove(ActorFlag.Airborne), -0.5),
          String(shove(ActorFlag.Airborne)));
    const [a, b] = crowd();
    a.flags |= ActorFlag.Committed;
    PublishCrowd(a, b);
    ZombiePushOutOfWorldAndActors(a);
    b.pos.x = 50;                          // out of reach of anything
    ZombiePushOutOfWorldAndActors(b);
    check("the recorded push is 1.8x when the **pusher** carries the bit",
          near(b.pos.x, 50.9), String(b.pos.x));
  }

  // -- who is a candidate ---------------------------------------------------
  {
    let [a, b] = crowd();
    a.flags2 &= ~ZombieFlag2.CollideActors;
    PublishCrowd(a, b);
    ZombiePushOutOfWorldAndActors(a);
    check("without `obj+0x136C` 0x40000000 an actor neither moves nor "
          + "records anything", a.pos.x === 0 && b.pushedBy === -1,
          `${a.pos.x} ${b.pushedBy}`);

    [a, b] = crowd();
    PublishCrowd(a);
    ZombiePushOutOfWorldAndActors(a);
    check("an actor that did not register last frame is not there to be "
          + "found -- the list is the published registrations, not the pool",
          a.pos.x === 0 && b.pushedBy === -1, `${a.pos.x} ${b.pushedBy}`);

    [a, b] = crowd();
    PublishCrowd(a, b);
    b.flags |= ActorFlag.NoShotTest;
    ZombiePushOutOfWorldAndActors(a);
    check("...and one that registered is refused on its **live** flags: "
          + "0x8000 raised since", a.pos.x === 0, String(a.pos.x));

    [a, b] = crowd();
    PublishCrowd(a, b);
    b.flags |= ActorFlag.ShotTestMesh;
    ZombiePushOutOfWorldAndActors(a);
    check("...or 0x10", a.pos.x === 0, String(a.pos.x));

    [a, b] = crowd();
    PublishCrowd(a, b);
    b.pos.x = 100;
    ZombiePushOutOfWorldAndActors(a);
    check("a candidate is measured where it registered, however far it has "
          + "gone since", near(a.pos.x, -0.5), String(a.pos.x));

    [a, b] = crowd();
    b.pos = vec3(0, 0, 0);
    PublishCrowd(a, b);
    ZombiePushOutOfWorldAndActors(a);
    check("two bodies on one centre are a miss -- the normal's components "
          + "sum to exactly zero (`0x00405ECB`) -- and nothing is recorded",
          a.pos.x === 0 && a.pos.z === 0 && b.pushedBy === -1,
          `${a.pos.x}/${a.pos.z} ${b.pushedBy}`);
  }

  // -- the depth the engine re-derives, with two radii that differ ----------
  //
  // r = 1 against R = 6, two units apart: the two surface points are 5 apart
  // (not above R), so the depth is `r - |centre - other's point|` = 1 - 4.
  // A body inside a bigger one is pulled *in*. `r + R - d` would say 5.
  {
    const [a, b] = crowd();
    b.pos = vec3(0, 0, 0);
    b.bodyRadius = 6;
    PublishCrowd(b);
    const y = b.sphereCentre.y;
    const hit = ColiTestSphereAgainstActors(a, 2, y, 0, 1);
    check("unequal radii take the engine's depth, 1 - |6 - 2|, not 1 + 6 - 2",
          hit && near(G.g_coli_hit_depth, -3) && near(G.g_coli_hit_dist_sq, 4)
          && near(G.g_coli_hit_normal[0], 1),
          `${hit} ${G.g_coli_hit_depth} ${G.g_coli_hit_dist_sq} `
          + JSON.stringify(G.g_coli_hit_normal));
  }

  // -- registration: every class-0x30 actor files itself -------------------
  {
    const [a] = crowd();
    ShotTestListReset();
    ActorRegisterCameraPoint(a, NULL_HOST, ZOMBIE_CAMERA_RISE);
    check("`ActorRegisterCameraPoint` files a zombie for the shot test, as "
          + "`0x00409BED` does for every caller -- the crowd push's list",
          G.g_shot_test_list.some((e) => e.at === a.at),
          String(G.g_shot_test_list.length));
    check("...and the port's own pick tests it: class 0x30 is picked the "
          + "engine's way, through the list", ShotTestPickedHere(a));
  }

  // -- the frame's order: published at the head of the frame ---------------
  {
    const [a, b] = crowd();
    GameUpdate(1 / 60, NULL_HOST, new Rng(3), new Events());
    const first = G.g_coli_dynamic_list.map((e) => e.at);
    const filed = G.g_shot_test_list.map((e) => e.at);
    GameUpdate(1 / 60, NULL_HOST, new Rng(3), new Events());
    const second = G.g_coli_dynamic_list.map((e) => e.at);
    check("the first frame's actors test an empty list -- nothing had "
          + "registered before it -- and file themselves during it",
          first.length === 0 && filed.includes(a.at) && filed.includes(b.at),
          `${first} / ${filed}`);
    check("...and the second frame's test what the first filed",
          second.includes(a.at) && second.includes(b.at), String(second));
  }

  // -- `ActorDespawn` takes the object out: `ColiDynamicListRemove` --------
  //
  // `FUN_00409CC0` is four lines: `obj+0x34 = (obj+0x34 & ~1) | 0x80018000`,
  // `ColiDynamicListRemove(obj)` (`FUN_00405220`, `CALL` at `0x00409CD3`),
  // the hit slot, `ActorKill`. The remove zeroes the first matching entry's
  // `+0x00` and `+0x04` and leaves the count, so the entry stays as a hole;
  // the push passes over it at `0x00405B5D`.
  {
    const [a, b] = crowd();
    PublishCrowd(a, b);
    const n = G.g_coli_dynamic_list.length;
    const before = G.g_coli_dynamic_list.map((e) => ({ ...e }));
    ActorDespawn(b);
    const holes = G.g_coli_dynamic_list.filter((e) => e.at === -1);
    const bi = before.findIndex((e) => e.at === b.at);
    const hole = G.g_coli_dynamic_list[bi];
    check("a despawn makes a hole of the object's published entry -- `+0x00` "
          + "and `+0x04` zeroed -- and leaves the count as it was",
          G.g_coli_dynamic_list.length === n && n === 2 && holes.length === 1
          && hole?.at === -1 && hole.flags === 0,
          JSON.stringify(G.g_coli_dynamic_list));
    check("...the sphere centre left where it was, and the other entry "
          + "untouched",
          !!hole && hole.x === before[bi].x && hole.y === before[bi].y
          && hole.z === before[bi].z
          && JSON.stringify(G.g_coli_dynamic_list[1 - bi])
             === JSON.stringify(before[1 - bi]),
          JSON.stringify(G.g_coli_dynamic_list));
    check("...and raises `0x80018000` on the object, bit 0 cleared "
          + "(`0x00409CC9`)",
          (b.flags & (0x80018000 | 1)) === (0x80018000 | 0),
          (b.flags >>> 0).toString(16));
    // The rest of the frame's actors do not meet it: two bodies two units
    // apart overlap by five, and `a` is not pushed at all.
    ZombiePushOutOfWorldAndActors(a);
    check("...so an actor later in the same frame is not pushed by it",
          a.pos.x === 0 && b.pushedBy !== a.at,
          `${a.pos.x} pushedBy ${b.pushedBy}`);
  }
  {
    // The entry found is the object's own. A thrown weapon files its
    // thrower's `at` beside its id and a class-0x44 prop its placer's beside
    // its id; the engine compares one pointer, so each despawn takes its own
    // entry and none of the others.
    ResetGameGlobals();
    const AT = 0x7b00;
    const w = ThrownWeaponAlloc(ThrownWeaponRoutine.Thrower);
    w.from = AT;
    const p = ({ id: 5, at: AT, flags: 0, group: 0, member: 0,
                 dead: false } as unknown) as BreakableProp;
    const entries = (): ShotTestEntry[] => [
      { at: AT, flags: 1, x: 1, y: 2, z: 3 },
      { at: AT, flags: 0x80000001 | 0, x: 4, y: 5, z: 6, thrown: w.id },
      { at: AT, flags: 0x51, x: 0, y: 0, z: 0, prop: p.id },
    ];
    const kinds = () => G.g_coli_dynamic_list.map((e) =>
      e.at === -1 ? "hole" : e.thrown !== undefined ? "thrown"
        : e.prop !== undefined ? "prop" : "actor").join(",");
    G.g_coli_dynamic_list = entries();
    ThrownWeaponDespawn(w);
    check("a thrown weapon's despawn makes a hole of its own entry, not its "
          + "thrower's", kinds() === "actor,hole,prop", kinds());
    G.g_coli_dynamic_list = entries();
    ActorDespawnProp(p);
    check("...a prop's of its own, not its placer's",
          kinds() === "actor,thrown,hole", kinds());
    G.g_coli_dynamic_list = entries();
    ColiDynamicListRemove({ at: AT });
    check("...and an actor's of its own, not its weapon's or its prop's",
          kinds() === "hole,thrown,prop", kinds());
    G.g_coli_dynamic_list = [entries()[0], entries()[0]];
    ColiDynamicListRemove({ at: AT });
    check("...the first match only (`JZ 0x00405244` leaves the loop)",
          kinds() === "hole,actor", kinds());
  }
}

// -- `ThrowerPushOutOfWorld`'s own case, off the same test ------------------
console.log("\nThrowerPushOutOfWorld: what a burning object does to a thrower:");
{
  const scene = (charType: number, offGround: boolean) => {
    const t = thrower(ThrowerState.StandAndDecide);
    t.charType = charType;
    if (offGround) t.flags2 |= ThrowerFlag.OffGround;
    const o = ActorSpawn(0x9001, SpawnClass.Thrower, 0x19, "on fire", {
      initialState: ThrowerState.StandAndDecide, condition: 0,
    });
    o.visible = true;
    o.pos = vec3(t.pos.x + 2, t.pos.y, t.pos.z);
    ThrowerPlaceCollisionSphere(t);
    ThrowerPlaceCollisionSphere(o);
    o.flags |= ActorFlag.FireLoop;
    PublishCrowd(o);
    const x0 = t.pos.x;
    ThrowerPushOutOfWorld(t);
    return { t, x0 };
  };
  let { t, x0 } = scene(0x19, true);
  check("an off-ground thrower shouldered by an object with `obj+0x34` "
        + "0x200000 falls instead of being pushed (`0x00449D8F`)",
        t.state === ThrowerState.FallAndLand && t.sub === 0 && t.pos.x === x0,
        `${t.state}.${t.sub} ${t.pos.x}`);
  ({ t, x0 } = scene(0x19, false));
  check("...one on the ground neither falls nor is pushed",
        t.state === ThrowerState.StandAndDecide && t.pos.x === x0,
        `${t.state} ${t.pos.x}`);
  ({ t, x0 } = scene(0x18, true));
  check("...and `zslman` is always pushed",
        t.state === ThrowerState.StandAndDecide && t.pos.x < x0,
        `${t.state} ${t.pos.x}`);
}

console.log("\nclass 0x30 state 15, the scripted walk-in:");
{
  // `ZombieStateWalkDistance` does not move the actor -- the clip's root
  // motion does -- so the test moves it and checks what the state makes of
  // that. See `game/class30/walk_distance.ts`.
  const walker = (dist: number) => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    G.g_camera_fixed_eye_y = 0;
    const z = spawnZombie(0x7100, 1, "walk-in", {
      initialState: ZombieState.WalkDistance, walkDistance: dist,
    });
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.pos = vec3(0, 0, 0);
    return z;
  };

  // **The bug this fixes.** State 15 was folded into `AttackRun`, so all
  // fifty of the game's walk-in spawns turned to face the camera on their
  // first frame instead of walking the entrance the level was built for.
  check("a state-15 spawn starts in WalkDistance, not AttackRun",
        walker(8).state === ZombieState.WalkDistance,
        String(walker(8).state));

  {
    const z = walker(8);
    ZombieStateWalkDistance(z, new Rng(1));
    check("the first frame latches the distance and the start point",
          z.zom.targetArrive === 8 && z.arcFrom.x === 0 && z.arcFrom.z === 0
          && z.sub === 2, `arrive ${z.zom.targetArrive} sub ${z.sub}`);
    check("...and it is still walking", z.state === ZombieState.WalkDistance,
          String(z.state));

    z.pos.z = -7.9;                       // just short
    ZombieStateWalkDistance(z, new Rng(1));
    check("short of the distance it keeps walking",
          z.state === ZombieState.WalkDistance
          && Math.abs(z.zom.walkTravelled - 7.9) < 1e-4,
          `${ZombieState[z.state]} travelled ${z.zom.walkTravelled.toFixed(2)}`);

    z.pos.z = -8.1;                       // past it
    ZombieStateWalkDistance(z, new Rng(1));
    check("reaching it hands to AttackRun with a fresh sub",
          z.state === ZombieState.AttackRun && z.sub === 0,
          `${ZombieState[z.state]}/${z.sub}`);
    check("...and records where the walk ended",
          z.strikeStart.z === -8.1, String(z.strikeStart.z));
  }

  // The measure is `sqrt(dx^2 + dz^2)`: an actor dropped a long way has not
  // walked anywhere. Taking the 3D distance would end the entrance early for
  // every spawn that falls to the floor on its first frame.
  {
    const z = walker(8);
    ZombieStateWalkDistance(z, new Rng(1));
    z.pos.y = -100;
    ZombieStateWalkDistance(z, new Rng(1));
    check("the distance is 2D -- falling is not walking",
          z.state === ZombieState.WalkDistance && z.zom.walkTravelled === 0,
          `${ZombieState[z.state]} travelled ${z.zom.walkTravelled}`);
  }

  // The other arm: with `obj+0x34` bit 0x20000000 the state retires the actor
  // instead of sending it at the camera. No shipped class-0x30 spawn sets it.
  {
    const z = walker(4);
    z.flags |= ActorFlag.BackingOff;
    ZombieStateWalkDistance(z, new Rng(1));
    z.pos.x = 5;
    ZombieStateWalkDistance(z, new Rng(1));
    check("the 0x20000000 arm despawns rather than attacking",
          z.despawned && z.state === ZombieState.WalkDistance,
          `despawned ${z.despawned} ${ZombieState[z.state]}`);
  }
}

console.log("\nthe clip clock the scripts count in:");
{
  // `g_motion_play_length` is about twice `frames`, and every cue a script
  // names is in *those* units. Counting in authored frames loses every cue
  // past halfway, which is what left the mauled civilians alive.
  ResetGameGlobals();
  EnterPlay();
  SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_scene_state_major = SCENE_MAJOR_PLAYING;
  const z = spawnZombie(0x7200, 1, "clock");
  z.motion = 10;                     // 20 frames, and a play length of 37
  const m = CHARS.types["1"].motions["10"];
  check("the play clock runs at twice the authored frames",
        (() => { z.playTicks = 2; return MotionPlayFrame(z) === 2; })(),
        `frame ${MotionPlayFrame(z)}`);
  check("...and the play length comes from the bundle, not from frames * 2",
        MotionPlayLength(z) === 37 && m.frames * 2 - 2 === 38,
        `${MotionPlayLength(z)} for ${m.frames} frames`);
  // The failure this guards: a cue past the authored frame count must still
  // be reachable, because the engine's cursor counts to the play length. It
  // **wraps** there rather than running away -- `model[2] = model[0] %
  // (play + 1)` -- so the test is that one full cycle visits every value up
  // to the play length and then returns to zero.
  const seen = new Set<number>();
  for (let i = 0; i < 80; i++) {
    z.playTicks = i;
    seen.add(MotionPlayFrame(z));
  }
  check("a cue past the authored frame count is still reachable",
        seen.has(30) && seen.has(37) && m.frames === 20,
        `${seen.size} distinct cursors for ${m.frames} frames`);
  check("...and the cursor wraps at the play length rather than running away",
        Math.max(...seen) === 37 && seen.size === 38,
        `max ${Math.max(...seen)} of ${seen.size}`);

  // **Every cursor value is observed, once, from every start phase.**
  //
  // The check above sets `playTicks` by hand, which is why it passed for
  // months while the cursor was skipping values: the bug was in *accumulating*
  // it. The clock was seconds, advanced `clock += 1/60` and read back as
  // `Math.floor(clock * fps * 2)`, and repeated float addition of 1/60 does
  // not land on multiples of 1/60 -- so the cursor went 6, 8 and 30, 32 while
  // showing 5 twice. Sixteen call sites compare it with `===`, correctly,
  // because `>=` double-fires across the `% (len + 1)` wrap. A cue authored at
  // 7, 15, 31 or 507 could therefore never fire, and the actor parked for
  // ever. That is the shape of most of the player's hangs.
  //
  // So this drives the real advance, one tick at a time, from every phase a
  // clip can start on -- because which value gets lost moves with the phase.
  const len = MotionPlayLength(z);
  let worst = "";
  for (let phase = 0; phase <= len && !worst; phase++) {
    z.playTicks = phase;
    const counts = new Map<number, number>();
    // One full cycle plus a little, so the wrap is included.
    for (let i = 0; i <= len; i++) {
      const f = MotionPlayFrame(z);
      counts.set(f, (counts.get(f) ?? 0) + 1);
      ActorAdvanceMotion(z, 1 / 60);
    }
    for (let f = 0; f <= len; f++) {
      const n = counts.get(f) ?? 0;
      if (n !== 1) {
        worst = `from phase ${phase}, cursor ${f} was observed ${n} times`;
        break;
      }
    }
  }
  check("every cursor value is observed exactly once, from every start phase",
        worst === "", worst);
}

console.log("\nclass 0x10's body radius, and the hook that ramps it:");
{
  // **The bug this fixes.** `CivilianInit` writes `obj+0x128 = 1.0`; the port
  // wrote only `obj+0x124`, so `ColiTestSphereAgainstActors`' lazy default
  // filled the body radius from the *shot* radius -- ten units -- and a
  // captor walking at its civilian was shoved off it from 13.5 away when its
  // script wanted to be within 6. It never arrived and nobody was ever mauled.
  ResetGameGlobals();
  EnterPlay();
  SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_scene_state_major = SCENE_MAJOR_PLAYING;
  T.civilians = { entries: [], scripts: [], items: [], spawns: {} };
  const c = ActorSpawn(0x7300, SpawnClass.Civilian, 1, "civ", undefined,
                       new Rng(1));
  check("the civilian's body sphere is one unit, not its shot sphere",
        c.bodyRadius === 1 && c.radius !== 1,
        `body ${c.bodyRadius} shot ${c.radius}`);

  // Op 0x16 ramps it, and the hook is what applies the ramp.
  c.civ!.scaleTarget = 4;
  c.civ!.scaleStep = 1;
  for (let i = 0; i < 10; i++) PoseHookGrowAndPushOutOfWorld(c);
  check("the pose hook ramps it to the target and stops there",
        c.bodyRadius === 4, String(c.bodyRadius));
  c.civ!.scaleTarget = 2;
  c.civ!.scaleStep = -0.5;
  for (let i = 0; i < 10; i++) PoseHookGrowAndPushOutOfWorld(c);
  check("...from either side", c.bodyRadius === 2, String(c.bodyRadius));

  // And the push it does only when the wait word asks for it. The sphere it
  // traces is `obj+0x12C` as the switch left it -- set here by hand.
  T.coli = { files: ["t"], blobs: { wall: WALL_BLOB } };
  G.g_coli_full_set = ["wall"];
  c.pos = vec3(29, 0, 45);
  c.sphereCentre = vec3(29, 2, 45);
  c.civ!.scaleTarget = c.bodyRadius;
  c.civ!.scaleStep = 0;
  PoseHookGrowAndPushOutOfWorld(c);
  check("without the wait bit it stays in the wall", c.pos.x === 29,
        String(c.pos.x));
  c.civ!.wait |= CivilianWait.PushOutOfWorld;
  PoseHookGrowAndPushOutOfWorld(c);
  check("with it, it is pushed out", c.pos.x < 29, c.pos.x.toFixed(2));

  // `LEA EDX, [ESI+0x12C]` at `0x0048D0F8`: the published sphere, never one
  // rebuilt from the feet. Feet in the wall, sphere clear of it: no push. The
  // port used to rebuild class 0x30's feet-plus-radius-plus-one first, which
  // put the sphere back in the wall.
  c.pos = vec3(29, 0, 45);
  c.sphereCentre = vec3(0, 2, 45);
  PoseHookGrowAndPushOutOfWorld(c);
  check("the hook traces obj+0x12C as it stands, not a sphere at the feet",
        c.pos.x === 29 && c.sphereCentre.x === 0,
        `pos ${c.pos.x} sphere ${JSON.stringify(c.sphereCentre)}`);
}

console.log("\nclass 0x10's collision-sphere switch: a drawn bone, not the feet:");
{
  // `CivilianUpdate`'s tail switches on `sub+0x80` (op 0x17) to fill
  // `obj+0x12C`: 0 the position, 1 bone 2, 2 bone 1 -- `CivilianInit`'s
  // default -- and 3 halfway between bones 15 and 12. Each bone is its draw
  // record, stored in view space, taken back to the world through
  // `g_camera_blocks`. Only mode 0 was ported, on a misreading of Ghidra's
  // `int *` indices as byte offsets.
  //
  // The stub keeps each bone as the engine does -- a view-space record under
  // a camera turned a quarter and set off the origin (L48), so a world point
  // and its view-space twin differ on every axis -- and answers `boneWorld`
  // the way the switch computes it, view to world.
  ResetGameGlobals();
  EnterPlay();
  SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_scene_state_major = SCENE_MAJOR_PLAYING;
  T.civilians = { entries: [], scripts: [], items: [], spawns: {} };
  const c = ActorSpawn(0x7310, SpawnClass.Civilian, 1, "civ", undefined,
                       new Rng(1));
  c.visible = true;
  c.pos = vec3(40, 3, -60);
  c.yaw = 0x4000;

  const EYE_AT = vec3(-12, 5, 30);
  // Camera right is world +z, up is +y, back is world -x.
  const toView = (w: Vec3): Vec3 =>
    vec3(w.z - EYE_AT.z, w.y - EYE_AT.y, -(w.x - EYE_AT.x));
  const toWorld = (v: Vec3): Vec3 =>
    vec3(EYE_AT.x - v.z, EYE_AT.y + v.y, EYE_AT.z + v.x);
  // The actor's own frame turned a quarter too: local (x, y, z) goes to
  // world (z, y, -x) about its position.
  const local: Record<number, Vec3> = {
    1: vec3(0, 8.5, 0.25), 2: vec3(0.1, 13.4, -0.6),
    12: vec3(1.6, 3.2, 0.5), 15: vec3(-1.4, 2.8, -0.3),
  };
  const records = new Map<number, Vec3>();
  const pose = () => {
    records.clear();
    for (const [b, l] of Object.entries(local)) {
      records.set(Number(b), toView(vec3(c.pos.x + l.z, c.pos.y + l.y,
                                         c.pos.z - l.x)));
    }
  };
  const put = (w: Vec3, out: Vec3) => {
    out.x = w.x; out.y = w.y; out.z = w.z;
  };
  const host: GameHost = {
    ...NULL_HOST,
    boneWorld: (at, bone, out) => {
      const r = at === c.at ? records.get(bone) : undefined;
      if (!r) return false;
      put(toWorld(r), out);
      return true;
    },
    viewPoint: (x, y, z, out) => put(toWorld(vec3(x, y, z)), out),
    viewSpaceOfPoint: (p, out) => { put(toView(p), out); return true; },
  };
  const at = (p: Vec3, x: number, y: number, z: number) =>
    Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9
    && Math.abs(p.z - z) < 1e-9;
  const show = (p: Vec3) => `(${p.x}, ${p.y}, ${p.z})`;
  pose();

  check("the four arms read bones 2, 1, 15 and 12 -- 0x1C0, 0x130, 0x910 "
        + "and 0x760 off the model block",
        CIVILIAN_SPHERE_BONE_MODE1 === 2 && CIVILIAN_SPHERE_BONE_MODE2 === 1
        && CIVILIAN_SPHERE_BONE_MODE3_A === 15
        && CIVILIAN_SPHERE_BONE_MODE3_B === 12);
  check("CivilianInit leaves every civilian on mode 2, bone 1",
        c.civ!.sphereCentreMode === CivilianSphereMode.Bone1,
        String(c.civ!.sphereCentreMode));
  const view1 = records.get(1)!;
  check("...and the camera makes bone 1's record differ from its world "
        + "point on every axis",
        view1.x !== 40.25 && view1.y !== 11.5 && view1.z !== -60,
        show(view1));

  CivilianWriteSphereCentre(c, host);
  check("mode 2: bone 1 in the world", at(c.sphereCentre, 40.25, 11.5, -60),
        show(c.sphereCentre));
  c.civ!.sphereCentreMode = CivilianSphereMode.Bone2;
  CivilianWriteSphereCentre(c, host);
  check("mode 1: bone 2 in the world",
        at(c.sphereCentre, 39.4, 16.4, -60.1), show(c.sphereCentre));
  c.civ!.sphereCentreMode = CivilianSphereMode.Bones12And15;
  CivilianWriteSphereCentre(c, host);
  check("mode 3: halfway between bones 12 and 15",
        at(c.sphereCentre, 40.1, 6, -60.1), show(c.sphereCentre));
  c.civ!.sphereCentreMode = CivilianSphereMode.Position;
  CivilianWriteSphereCentre(c, host);
  check("mode 0: the position", at(c.sphereCentre, 40, 3, -60),
        show(c.sphereCentre));

  // `MOVSX; CMP EAX, 3; JA`: anything else, negative included, writes
  // nothing. And the op keeps only the low byte of its operand.
  c.sphereCentre = vec3(1, 2, 3);
  for (const m of [4, -1, 0x7f]) {
    c.civ!.sphereCentreMode = m;
    CivilianWriteSphereCentre(c, host);
  }
  check("a mode past 3, or negative, writes nothing",
        at(c.sphereCentre, 1, 2, 3), show(c.sphereCentre));
  T.civilians = {
    entries: [], items: [], spawns: {},
    scripts: [[{ op: CivilianOp.SetSphereCentreMode, args: [0x101] }],
              [{ op: CivilianOp.SetSphereCentreMode, args: [0xff] }]],
  };
  CivilianRunScript(c, 0, 0, DRAW_FRAME);
  const lowByte = c.civ!.sphereCentreMode;
  CivilianRunScript(c, 1, 0, DRAW_FRAME);
  check("op 0x17 stores the operand's low byte, read signed",
        lowByte === CivilianSphereMode.Bone2
        && c.civ!.sphereCentreMode === -1,
        `${lowByte}, ${c.civ!.sphereCentreMode}`);

  // [port-only] at the seam: a host with no pose answers nothing, and a bone
  // arm then writes nothing -- the sphere keeps what it had, as the camera
  // point does; mode 3 needs both of its bones.
  for (const m of [CivilianSphereMode.Bone2, CivilianSphereMode.Bone1,
                   CivilianSphereMode.Bones12And15]) {
    c.civ!.sphereCentreMode = m;
    CivilianWriteSphereCentre(c, NULL_HOST);
    check(`with no posed skeleton, mode ${m} keeps the sphere`,
          at(c.sphereCentre, 1, 2, 3), show(c.sphereCentre));
  }
  records.delete(12);
  CivilianWriteSphereCentre(c, host);
  check("...and mode 3 with one of its two bones is no midpoint at all",
        at(c.sphereCentre, 1, 2, 3), show(c.sphereCentre));
  c.civ!.sphereCentreMode = CivilianSphereMode.Position;
  CivilianWriteSphereCentre(c, NULL_HOST);
  check("mode 0 needs no pose", at(c.sphereCentre, 40, 3, -60),
        show(c.sphereCentre));

  // **The readers.** `RegisterForShotTest` records the switch's point,
  // `ColiPublishDynamicList` publishes it a frame later, and
  // `ColiTestSphereAgainstActors` measures every other actor's push against
  // that. A captor probing at bone 1 finds her; one probing where class
  // 0x30's formula would put her sphere -- feet plus radius plus one -- does
  // not.
  pose();
  c.civ!.sphereCentreMode = CivilianSphereMode.Bone1;
  CivilianWriteSphereCentre(c, host);
  PublishCrowd(c);
  const z = spawnZombie(0x7390, 1, "captor");
  z.visible = true;
  z.pos = vec3(40, 3, -52);
  const hitBone = ColiTestSphereAgainstActors(z, 40.25, 13, -60, 1);
  const found = G.g_coli_hit_object;
  const listed = G.g_coli_dynamic_list.find((e) => e.at === c.at);
  const hitFeet = ColiTestSphereAgainstActors(z, 40, 3 + c.bodyRadius + 1,
                                              -60, 1);
  check("the actor push measures a civilian at bone 1, where she publishes",
        hitBone && found === c.at && !!listed
        && at(vec3(listed.x, listed.y, listed.z), 40.25, 11.5, -60),
        `${hitBone} ${found} ${JSON.stringify(listed)}`);
  check("...and not at class 0x30's feet-plus-radius point",
        !hitFeet && at(c.sphereCentre, 40.25, 11.5, -60),
        show(c.sphereCentre));

  // **The order inside the update.** The pose hook runs from the draw, near
  // the top of `CivilianUpdate`, so it traces the sphere the switch wrote on
  // the *previous* frame; the switch then writes this frame's. Last frame's
  // sphere is in the wall and this frame's bone 1 is clear of it: the engine
  // pushes. Tracing after the switch, or rebuilding from the feet, does not.
  T.civilians = { entries: [], scripts: [], items: [], spawns: {} };
  T.coli = { files: ["t"], blobs: { wall: WALL_BLOB } };
  G.g_coli_full_set = ["wall"];
  c.civ!.wait |= CivilianWait.PushOutOfWorld;
  c.civ!.scaleTarget = c.bodyRadius;
  c.civ!.scaleStep = 0;
  c.pos = vec3(0, 0, 45);
  c.sphereCentre = vec3(29.5, 8, 45);
  pose();
  CivilianUpdate(c, { dt: 1 / 60, rng: new Rng(3), host,
                      events: new Events() });
  check("the pose hook traces last frame's sphere, before the switch",
        c.pos.x < 0, `pos.x ${c.pos.x}`);
  check("...and the switch then publishes this frame's bone 1",
        at(c.sphereCentre, 0.25, 8.5, 45), show(c.sphereCentre));
}

console.log("\nclass 0x10's play cursor: a corpse rests, it does not replay:");
{
  // `CivilianUpdate` advances the cursor only while the loop count allows;
  // when it runs out nothing touches it again. The port's clock is advanced
  // unconditionally and the renderer wraps it, so a civilian killed in a set
  // piece played its dying clip over and over.
  const dying = (loops: number) => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    T.civilians = { entries: [], scripts: [], items: [], spawns: {} };
    const c = ActorSpawn(0x7400, SpawnClass.Civilian, 1, "dying", undefined,
                         new Rng(1));
    c.visible = true;
    c.motion = 10;                   // 20 frames, play length 37
    c.playTicks = 0;
    c.civ!.loops = loops;
    return c;
  };
  const runClip = (c: Actor, frames: number) => {
    for (let i = 0; i < frames; i++) {
      ActorAdvanceMotion(c, 1 / 60);
      CivilianCountMotionLoops(c);
    }
  };

  {
    const c = dying(1);
    runClip(c, 200);                 // far past the clip's 37-frame play length
    check("a one-shot clip stops at the end of its play length",
          MotionPlayFrame(c) === 37, String(MotionPlayFrame(c)));
    check("...and the loop count is spent", c.civ!.loops === 0,
          String(c.civ!.loops));
    const at = MotionPlayFrame(c);
    runClip(c, 200);
    check("...and it stays there rather than wrapping round again",
          MotionPlayFrame(c) === at, String(MotionPlayFrame(c)));
  }

  // A negative count is the engine's "play for ever": the cursor keeps
  // moving, where a spent one is pinned.
  {
    const c = dying(-1);
    runClip(c, 200);
    const a = MotionPlayFrame(c);
    runClip(c, 1);
    check("a negative loop count still plays for ever",
          MotionPlayFrame(c) !== a, `${a} then ${MotionPlayFrame(c)}`);
  }

  // Two loops take twice as long to settle, and settle in the same place.
  {
    const c = dying(2);
    runClip(c, 40);
    check("a two-loop clip is still going after one play",
          c.civ!.loops === 1, String(c.civ!.loops));
    runClip(c, 200);
    check("...and rests after the second", c.civ!.loops === 0
          && MotionPlayFrame(c) === 37, String(MotionPlayFrame(c)));
  }
}

/**
 * **A civilian is hurt only on the path camera.** `CivilianUpdate`
 * (`FUN_0048A920`) clears her hit bits (`AND AL, 0xF1` at `0x0048AD12`) unless
 * `sub+0x4C` names an on-shot script **and** `g_scene_state_major_entered`
 * is 2 (`MOV ECX, [0x009C6F08]; CMP ECX, EDI; JNZ` at `0x0048AAC9`) -- one test
 * over both arms, the shot and the killed. The port tested the script alone.
 * Stage 3's captives lying in the canal (streams 62, 68 and 72, clip 686)
 * arm their on-shot script -- clip 676, a death -- only while the scene state
 * is 1, and lose it before it is 2, so in the exe no shot ever plays it; in
 * the port one could, and the body lying there died again.
 */
console.log("\nclass 0x10's shot counts only on the path camera:");
{
  const f = { dt: 1 / 60, rng: new Rng(3), host: NULL_HOST,
              events: new Events() };
  const lying = (major: number) => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS);
    G.g_scene_state_major_entered = major;
    G.g_scene_state_major = major;
    // Stream 0 lies still; stream 1 is the death the shot would switch to.
    T.civilians = { entries: [0], items: [], spawns: {}, scripts: [
      [{ op: CivilianOp.Wait, args: [0] }, { op: CivilianOp.End, args: [] }],
      [{ op: CivilianOp.Wait, args: [0] }, { op: CivilianOp.End, args: [] }],
    ] } as never;
    const c = ActorSpawn(0x7500, SpawnClass.Civilian, 1, "lying", undefined,
                         new Rng(1));
    c.visible = true;
    c.civ!.onShot = 0x1234;
    c.civ!.onShotScript = 1;
    return c;
  };
  for (const major of [1, 3]) {
    const c = lying(major);
    c.flags |= ActorFlag.Hit | 2;
    CivilianCheckShot(c, f);
    check(`scene state ${major}: a hit is cleared and does nothing`,
          (c.flags & 0xe) === 0 && !c.dead && c.civ!.onShotScript === 1,
          `flags ${(c.flags >>> 0).toString(16)} dead ${c.dead} `
          + `onShot ${c.civ!.onShotScript}`);
    const k = lying(major);
    k.flags |= ActorFlag.Dead;
    CivilianCheckShot(k, f);
    check(`scene state ${major}: ...and so is the killed bit, which waits`,
          (k.flags & ActorFlag.Dead) !== 0 && k.civ!.onShotScript === 1,
          `onShot ${k.civ!.onShotScript}`);
  }
  {
    const c = lying(SCENE_MAJOR_PLAYING);
    c.flags |= ActorFlag.Hit | 2;
    CivilianCheckShot(c, f);
    check("scene state 2: the same hit runs her on-shot script",
          c.dead && c.civ!.onShotScript === -1 && c.civ!.script === 1,
          `dead ${c.dead} onShot ${c.civ!.onShotScript} script ${c.civ!.script}`);
  }
}

console.log("\nclass 0x30's twelve entrance states — do the waits end?");
{
  // Every one of the twelve is a wait, and a wait transcribed slightly wrong
  // does not crash: it simply never comes true and the actor stands there for
  // the rest of the stage. `tools/entrances.mjs` checks all 127 shipped spawns
  // against the real bundle; this checks the shapes against data written here,
  // where a cue can be put exactly on and exactly past its frame.

  const spawn = (init: number, entry: unknown, exit = ZombieState.AttackRun) => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    G.g_camera_fixed_eye_y = 0;
    G.g_players_in_play = 1;
    const z = spawnZombie(0x7700, 1, "entrance", {
      initialState: init, attackState: exit,
      entry: entry as Actor["entry"],
    });
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.pos = vec3(0, 0, 30);
    return z;
  };
  const run = (z: ZombieActor, frames: number, rng = new Rng(3)) => {
    for (let f = 0; f < frames; f++) {
      EnemyZombieUpdate(z, { dt: 1 / 60, rng, host: NULL_HOST });
      // `GameUpdate` advances the clip; `EnemyZombieUpdate` does not. Four of
      // the twelve measure their exit on the **play clock**, so a loop that
      // leaves it at zero stalls them and proves nothing.
      ActorAdvanceMotion(z, 1 / 60);
    }
  };

  // **`EnemyZombieInit` takes the descriptor's byte as it stands**
  // (`0x00452F36`). A router used to fold 37 of the 54 states into
  // `AttackRun`, which is what sent a zombie scripted to drown you jogging
  // across the room instead; it is gone, and every entrance lands where its
  // byte says.
  for (const st of [ZombieState.SurfaceOnCameraCue, ZombieState.RunInPlaceTimed,
                    ZombieState.HoldClipThenBranch,
                    ZombieState.WaitCameraFrameThenBranch,
                    ZombieState.WaitForCameraFrame,
                    ZombieState.WaitScriptFlagThenBranch,
                    ZombieState.ScriptedGrabAndDespawn, ZombieState.LeapToPoint,
                    ZombieState.RideCarrier, ZombieState.ArcScriptedEntrance,
                    ZombieState.WaitScriptFlagThenEnter,
                    ZombieState.DelayedStrikeInPlace]) {
    const z = spawn(st, null);
    check(`a state-${st} spawn starts there, not in AttackRun`,
          z.state === st, String(z.state));
  }

  // -- state 17: hold a clip for N frames, then branch ---------------------
  {
    const z = spawn(ZombieState.HoldClipThenBranch,
                    { motion: 700, frames: 30 });
    run(z, 20);
    check("state 17 is still holding at 20 of its 30 frames",
          z.state === ZombieState.HoldClipThenBranch && z.motion === 700,
          `${z.state}/${z.motion}`);
    run(z, 20);
    // Where it goes *after* the branch is the attack loop's business — by 40
    // frames the run may already have reached the ring. What matters is that
    // the entrance let go.
    check("...and branches once the count is out",
          z.state !== ZombieState.HoldClipThenBranch, String(z.state));
  }
  {
    // The `tail+0x03 == 15` arm: it latches the distance **and** enters state
    // 15 at sub 1, skipping that state's own latch. Entering at sub 0 would
    // overwrite the distance with `walkDistance`, a different field.
    const z = spawn(ZombieState.HoldClipThenBranch,
                    { motion: 700, frames: 5, walk_distance: 9 },
                    ZombieState.WalkDistance);
    run(z, 10);
    check("state 17's exit-15 arm hands to the walk-in",
          z.state === ZombieState.WalkDistance, String(z.state));
    // It enters state 15 at **sub 1**, not sub 0 — and this is what proves it.
    // Sub 0 is that state's own latch, which would overwrite the distance with
    // `walkDistance`, a different descriptor field that is 0 here.
    check("...carrying the distance the entrance chose, not state 15's own",
          z.zom.targetArrive === 9, String(z.zom.targetArrive));
  }

  // -- state 18: wait for an exact camera frame ----------------------------
  {
    const z = spawn(ZombieState.WaitCameraFrameThenBranch,
                    { motion: 700, cue: 40 });
    G.g_cam_path_frame = 39;
    run(z, 5);
    check("state 18 waits while the camera is short of its frame",
          z.state === ZombieState.WaitCameraFrameThenBranch, String(z.state));
    G.g_cam_path_frame = 40;
    run(z, 1);
    check("...and goes the frame the camera lands on it",
          z.state === ZombieState.AttackRun, String(z.state));
  }
  {
    // The equality is the engine's, and it is load-bearing: a path that steps
    // over the frame parks the actor, which is how the game holds a rank of
    // zombies a given camera run never triggers.
    const z = spawn(ZombieState.WaitCameraFrameThenBranch,
                    { motion: 700, cue: 40 });
    G.g_cam_path_frame = 41;
    run(z, 60);
    check("...but a camera already past it waits for ever, as the exe does",
          z.state === ZombieState.WaitCameraFrameThenBranch, String(z.state));
  }
  {
    // `CMP [0x9a6458], EAX` at `0x004575F1`: the cue also takes camera block
    // 2's path frame, by address, and nothing ever steps block 2's -- so a
    // cue of 0 goes on the first frame whatever block 0's path is doing.
    // No shipped spawn's cue is 0.
    const z = spawn(ZombieState.WaitCameraFrameThenBranch,
                    { motion: 700, cue: 0 });
    G.g_cam_path_frame = 41;
    run(z, 1);
    check("...and a cue of 0 is met by block 2's frame, which is always 0 "
          + "(`0x004575F1`)", z.state === ZombieState.AttackRun,
          String(z.state));
  }

  // -- state 13: the same wait, but `>=` ------------------------------------
  {
    const z = spawn(ZombieState.SurfaceOnCameraCue, { cue_frame: 40 });
    check("state 13 freezes its pose under the water first",
          (z.flags & ActorFlag.PoseFrozen) !== 0 || z.sub === 0,
          `flags ${z.flags.toString(16)}`);
    run(z, 1);                     // sub 0 -> 1: the freeze is taken first
    G.g_cam_path_frame = 100;
    run(z, 1);
    check("...and a camera *past* its frame still releases it — this one is a"
          + " `>=`, unlike state 18",
          z.sub === 2 && (z.flags & ActorFlag.PoseFrozen) === 0,
          `sub ${z.sub} flags ${z.flags.toString(16)}`);
    run(z, 200);
    // Into the attack loop — which by 200 frames has usually moved on from
    // `AttackRun` itself, so the assertion is that the entrance is done.
    check("...then hands over when the surfacing clip is out",
          z.state !== ZombieState.SurfaceOnCameraCue, String(z.state));
  }

  // -- state 20: the script flag ------------------------------------------
  {
    const z = spawn(ZombieState.WaitScriptFlagThenBranch,
                    { motion: 700, cue: 7 });
    run(z, 30);
    check("state 20 waits on its script flag",
          z.state === ZombieState.WaitScriptFlagThenBranch, String(z.state));
    G.g_script_flags[7] = 1;
    run(z, 1);
    check("...and goes when the script raises it",
          z.state === ZombieState.AttackRun, String(z.state));
  }

  // -- state 19: the only cooldown class 0x30 ever arms --------------------
  {
    const z = spawn(ZombieState.WaitForCameraFrame,
                    { motion: 700, cue_frame: 10, freeze: true, claim: true,
                      delay: 5, cooldown: 90 });
    // `tail+0x0C == 0` -- the exporter's `freeze` -- is a **hide**, not a
    // freeze: `ActorSetPartVisibility(model, 0)` at 0x00457653 and
    // `obj+0x1F8 &= ~1` at 0x0045766A, and nothing that touches the clock.
    run(z, 1);
    check("state 19's `tail+0x0C == 0` arm hides the actor, skeleton and parts",
          (z.motionFlags & MotionFlag.Drawn) === 0
          && z.partVisible.join() === "0,0"
          && (z.flags & ActorFlag.NoShadow) !== 0,
          `flags ${z.motionFlags} parts ${z.partVisible}`);
    check("...and does not stop the clock", z.frozen === 0
          && (z.flags & ActorFlag.PoseFrozen) === 0, `frozen ${z.frozen}`);
    G.g_cam_path_frame = 10;
    run(z, 1);
    check("...until the cue, which draws it again",
          (z.motionFlags & MotionFlag.Drawn) !== 0
          && z.partVisible.join() === "1,1"
          && (z.flags & ActorFlag.NoShadow) === 0,
          `flags ${z.motionFlags} parts ${z.partVisible}`);
    run(z, 19);
    check("state 19 claims a permit on its cue and goes to the strike",
          z.state === ZombieState.Strike && z.attackPermit >= 0,
          `${z.state}/${z.attackPermit}`);
    check("...arming the cooldown, which no other class-0x30 state does",
          (z.zom.flags1368 & Zombie1368Flag.Cooldown) !== 0 && z.cooldown === 90,
          `${z.zom.flags1368}/${z.cooldown}`);
  }
  {
    // A failed claim is not an error — the actor takes the descriptor's branch.
    const z = spawn(ZombieState.WaitForCameraFrame,
                    { motion: 700, cue_frame: 10, freeze: false, claim: false,
                      delay: 0, cooldown: 0 });
    G.g_cam_path_frame = 10;
    run(z, 3);
    check("...and a state-19 spawn that does not claim just branches",
          z.state === ZombieState.AttackRun && !(z.zom.flags1368 & Zombie1368Flag.Cooldown),
          `${z.state}/${z.zom.flags1368}`);
  }

  // -- state 31: it counts itself into the game ---------------------------
  {
    // The clip has to be **longer than 0x4D on the play clock**, because the
    // exit is `motion != it || 0x4D < cursor` and the cursor wraps. All four
    // shipped spawns name clip 920, whose play length clears it; a shorter one
    // would stall in the engine too, which is why this fixture uses 184.
    const z = spawn(ZombieState.WaitScriptFlagThenEnter,
                    { flag: 3, idle_motion: 10, motion: 923, delay: 10 });
    run(z, 30);
    check("state 31 is not yet an enemy the script can see",
          G.g_enemies_alive === 0 && G.g_enemies_present === 0,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
    G.g_script_flags[3] = 1;
    run(z, 1);
    check("...and counts itself in when its flag comes up",
          G.g_enemies_alive === 1 && G.g_enemies_present === 1,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
    run(z, 200);
    check("...then joins the attack loop",
          z.state !== ZombieState.WaitScriptFlagThenEnter, String(z.state));
  }

  // -- state 23: the only entrance that ends in a despawn ------------------
  {
    const z = spawn(ZombieState.ScriptedGrabAndDespawn,
                    { cue_frame: -1, motion: 186, hit_frame: 10 });
    run(z, 4);
    check("state 23's -1 cue fires at once", z.sub >= 2, String(z.sub));
    run(z, 200);
    check("...and it removes the actor rather than setting a state",
          z.despawned, `despawned ${z.despawned} state ${z.state}`);
  }

  // -- state 24: flies to its point and then never leaves ------------------
  {
    const z = spawn(ZombieState.LeapToPoint,
                    { dest: [0, 0, 12], frames: 10, delay: 5,
                      idle_motion: 1010, strike_motion: 1009, hit_frame: 8,
                      player: 0 });
    run(z, 12);
    check("state 24 flies to the point its descriptor names",
          Math.hypot(z.pos.x - 0, z.pos.z - 12) < 1.5,
          `${z.pos.x.toFixed(2)},${z.pos.z.toFixed(2)}`);
    const perch = { x: z.pos.x, z: z.pos.z };
    run(z, 400);
    check("...stays in the state for ever, as the exe does",
          z.state === ZombieState.LeapToPoint, String(z.state));
    check("...and is pinned to its perch, so the crowd push cannot walk it off",
          z.pos.x === perch.x && z.pos.z === perch.z,
          `${z.pos.x.toFixed(2)},${z.pos.z.toFixed(2)}`);
  }
  {
    // `g_players_in_play` is a **count**, not a two-player flag, and both
    // scripted attackers refuse to strike while it is zero. Leaving the port's
    // old default of 0 in place would have parked all nine of those spawns.
    const z = spawn(ZombieState.LeapToPoint,
                    { dest: [0, 0, 12], frames: 4, delay: 1,
                      idle_motion: 1010, strike_motion: 1009, hit_frame: 8,
                      player: 0 });
    G.g_players_in_play = 0;
    run(z, 120);
    check("state 24 will not strike before a player is in play",
          z.sub === 2, `sub ${z.sub}`);
    G.g_players_in_play = 1;
    run(z, 120);
    check("...and does once one is", z.sub > 2, `sub ${z.sub}`);
  }

  // -- state 29: the passenger --------------------------------------------
  {
    const z = spawn(ZombieState.RideCarrier, null, ZombieState.AttackRun);
    run(z, 3);
    // [diverges] With no rideable object ported the ride is over at once,
    // rather than parking six spawns for the rest of the stage. See
    // `class30/entrance.ts`.
    check("state 29 hands over at once when there is no carrier to ride",
          z.state === ZombieState.AttackRun, String(z.state));
  }

  // -- state 32: the give-up, and which word carries the bit ---------------
  //
  // `ZombieStateDelayedStrikeInPlace` (`FUN_0045E830`) is a permanent swing
  // loop -- it never approaches and never leaves -- with exactly one way out:
  // `0045eafe TEST dword ptr [EAX + 0x34], 0x40000000` on the object
  // `g_carrier_object` (0x009A5C34) names, then `obj+0x1334` counts up and at
  // 0x14 the actor takes state 10. `ScriptedCarrierUpdate33` (`0x004331D0`)
  // raises that bit at `00433280 OR EAX, 0x40000000`, `EAX = [EBP + 0x34]`.
  //
  // This read `obj+0x136C` instead -- the right bit in the wrong word, where
  // `ZombieFlag2.CollideActors` lives and where `EnemyZombieInit`
  // (`FUN_00452DA0`) seeds `0x60000000` on **every** class-0x30 spawn. Both
  // halves are asserted, because only the pair pins the word: the wrong read
  // fires on a carrier that has not ended its ride and never fires on one
  // that has.
  {
    const holdsFor = (z: ZombieActor, frames: number) => {
      for (let f = 0; f < frames; f++) {
        if (z.state !== ZombieState.DelayedStrikeInPlace) return f;
        run(z, 1);
      }
      return -1;
    };

    const z = spawn(ZombieState.DelayedStrikeInPlace,
                    { delay: 2, rearm: 4, player: 0 });
    // Spawned after `z`, because `spawn` resets the pool.
    const carrier = spawnZombie(0x7EE0, 1, "carrier stand-in");
    G.g_carrier_object = carrier.at;
    carrier.flags = 0;
    carrier.flags2 = 0;

    let left = holdsFor(z, 120);
    check("state 32 keeps swinging while its carrier's ride is still running",
          left === -1, `left after ${left} frames`);

    // The old read. `0x40000000` in `obj+0x136C` is a collision bit every
    // class-0x30 actor carries, so this must mean nothing here.
    carrier.flags2 |= ZombieFlag2.CollideActors;
    left = holdsFor(z, 120);
    check("...and `obj+0x136C` bit 0x40000000 is not the bit — it is the "
          + "collision word every class-0x30 spawn is seeded with",
          left === -1, `left after ${left} frames`);
    carrier.flags2 = 0;

    // The engine's read.
    carrier.flags |= ActorFlag.Reacting;
    left = holdsFor(z, 120);
    check("...but `obj+0x34` bit 0x40000000 retires it, and only after the "
          + "0x14 frames `obj+0x1334` counts",
          left > 0x14 && left <= 0x14 + 3, `left after ${left} frames`);
    check("...into state 10, which `g_class30_states` says is "
          + "`ZombieReleaseAndDespawn` (`FUN_00455490`) and not the "
          + "routine at `0x0045D9F0` this used to name",
          z.state === ZombieState.Leave || z.despawned,
          `state ${z.state}${z.despawned ? " despawned" : ""}`);
  }
  {
    // `if ((carrier+0x34 & 0x40000000) == 0) obj+0x1334 = 0;` — the counter is
    // held at zero rather than paused, so a ride that ends, un-ends and ends
    // again costs the full 0x14 from the second raise.
    const z = spawn(ZombieState.DelayedStrikeInPlace,
                    { delay: 2, rearm: 4, player: 0 });
    const carrier = spawnZombie(0x7EE0, 1, "carrier stand-in");
    G.g_carrier_object = carrier.at;
    carrier.flags = ActorFlag.Reacting;
    run(z, 0x10);
    carrier.flags = 0;
    run(z, 4);
    carrier.flags = ActorFlag.Reacting;
    let since = 0;
    while (z.state === ZombieState.DelayedStrikeInPlace && since < 120) {
      run(z, 1);
      since += 1;
    }
    check("the give-up counter is zeroed while the bit is down, not paused — "
          + "the second raise costs the full 0x14 again",
          since > 0x14 && since <= 0x14 + 3, `left ${since} frames after it`);
  }
}
