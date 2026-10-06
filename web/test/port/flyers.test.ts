import type { CharactersJson, CharacterType } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { ActorSpawn, GameUpdate } from "../../src/game/director";
import { ActorAdvanceMotion } from "../../src/game/motion";
import { MotionFlag } from "../../src/game/actor";
import {
  CARRIER6_PATH_END, CARRIER_PATH_END, ScriptedPropUpdate13,
  g_carrier_prop_routines, SFX_CARRIER_BOW,
} from "../../src/game/class13";
import {
  CarrierPropRoutine3, SFX_CARRIER3_START,
} from "../../src/game/class13/routine3";
import { CarriedPropIsOnScreen } from "../../src/game/combat/permits";
import {
  CARRIER4_SPRITE_FIRST, CARRIER4_SPRITE_LAST, CARRIER_SELECTORS_PORTED,
  CarrierDrawSlots, CarrierEffects, CarrierRoutine0State,
  CarrierRoutine3State, CarrierRoutine4State, CarrierState,
  type ScriptedPropTail,
} from "../../src/game/class13/state";
import {
  CARRIER4_FX_A_AT, CARRIER4_OFFSET_Z, SFX_CARRIER4_CUE,
  SFX_CARRIER4_LAND_A, SFX_CARRIER4_LAND_B, SFX_CARRIER4_START,
} from "../../src/game/class13/routine4";
import {
  CARRIER5_OFFSET_X, CARRIER5_OFFSET_Z,
} from "../../src/game/class13/routine5";
import type { EffectDefJson } from "../../src/bundle";
import {
  CARRIER0_FRAME_STRIKE, CARRIER0_SPLASH_FIRST, CARRIER0_SPLASH_LAST,
  SFX_CARRIER0_STRIKE, g_carrier_routine0_ride_end,
} from "../../src/game/class13/routine0";
import { CarriedZombieUpdate18 } from "../../src/game/class18";
import { ShotTestListReset } from "../../src/game/combat/shot_test";
import {
  AppState, G, HIT_SLOT_NONE, PlayerState, ResetGameGlobals,
} from "../../src/game/globals";
import { NULL_HOST, type GameHost } from "../../src/game/host";
import {
  MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ,
} from "../../src/game/matrix";
import { FishUpdate } from "../../src/game/class51";
import { FishFlag, FishState, type FishTail } from "../../src/game/class51/state";
import {
  FROG_LEAP_RECOVER_CURSOR, FrogMotion, FrogReadNextScriptCommand,
  FrogStateHopWithinScreenWedge, FrogStateLeapAtPlayer, FrogUpdate,
  PROJECTION_DISTANCE_PX,
} from "../../src/game/class11";
import { FrogFlag, FrogState, type FrogTail } from "../../src/game/class11/state";
import { OwlPickTargetPlayerAndAimOffset, OwlStateDiveAtCamera,
  OwlStateRideApproachSpline, OwlUpdateAndResolveShot }
  from "../../src/game/class43";
import {
  OWL_RING_PULSE_FRAMES, OwlEffectsTick, OwlGroundRingPhase,
  OwlSpawnGroundImpactRing, OwlSpawnWaterSplashFlipbook,
} from "../../src/game/effects/owl";
import {
  BloodCloudTickInScreenSpace, FISH_BLOOD_LAST_SLOT, FISH_SPLASH_LAST_SLOT,
  FishEffectsTick, type FishBloodCloud,
} from "../../src/game/effects/fish";
import {
  RING_EFFECT_SPREAD_FRAMES, RingEffectPhase, RingEffectsTick,
  SpawnRingEffectAtPose,
} from "../../src/game/effects/ring_effect";
import { BatChildAt, BatDiveUpdate, BatSplashesTick, BatUpdate, BatWingAt,
  BAT_CHAR_TYPE, BAT_CLIP, BAT_DIVE_BOB_SCALE, BAT_FLAG_80000,
  BAT_SCATTER_ACCEL_XZ, BAT_SCATTER_ACCEL_Y, BAT_SCATTER_CORPSE_DAMP,
  BAT_SCATTER_CORPSE_GRAVITY, BAT_SPLASH_LAST_FRAME, BAT_SPLASH_Y,
  BAT_SPLINE_POINTS, BAT_WING_CHAR_TYPE, BAT_WING_CLIP, BAT_WING_PITCH,
  SND_BAT_SPLASH, SpawnBatSplash } from "../../src/game/class46";
import { BatState, type BatTail } from "../../src/game/class46/state";
import { OwlDiveKind, OwlState, type OwlTail }
  from "../../src/game/class43/state";
import { MotionPlayFrame, SetGameTables } from "../../src/game/tables";
import { QueryGroundHeightAt } from "../../src/game/coli";
import { ActorFlag, type Actor } from "../../src/game/actor";
import { ActorDeadSweep, ActorDespawn } from "../../src/game/despawn";
import { g_class30_bone_cels, ZombieBoneCelSlots }
  from "../../src/game/class30/bonecels";
import { HIT_SLOT_CLAIMED } from "../../src/game/hit_slots";
import {
  type ClassFrame, DeadSweep, g_class_handlers,
} from "../../src/game/registry";
import { SpawnClass } from "../../src/game/spawn_class";
import { vec3, type Vec3 } from "../../src/game/vec";
import {
  check, TYPE, CHARS, EYE, PublishCrowd, scene, RunOutInvulnerability,
  BREAKABLES,
} from "./harness";

// -- 30. the three flying and swimming enemies -------------------------------
//
// Class 0x11, 0x43 and 0x51, each of which had no module until now. Every
// assertion here is one that fails if a specific reading is dropped.

{
  // A host whose `viewPoint` is the identity on x and y and negates z, so the
  // engine's `-z is in front` lands somewhere a test can name. `NULL_HOST`
  // answers nothing, which would put every camera-space target at the origin.
  const HOST: GameHost = {
    ...NULL_HOST,
    viewPoint: (x, y, z, out) => {
      out.x = EYE.x + x;
      out.y = EYE.y + y;
      out.z = EYE.z - z;
    },
  };
  const frame = (rng: Rng, events?: Events): ClassFrame =>
    ({ dt: 1 / 60, rng, host: HOST, events });

  // -- class 0x51, the fish ------------------------------------------------
  {
    const rng = new Rng(9);
    scene(0, rng);
    const header = ActorSpawn(0x9000, SpawnClass.WaterEnemy, -1, "fish", {
      class51: {
        water_level: -12.5, speed_x: -12.5, speed_z: 0, bob_amplitude: 0,
        entry_mode: 0, subtype: 6, rise_frames: 0, bob_cycles: 0,
        lunge_frames: 0,
      },
    }, rng);
    check("a class-0x51 group header is not a fish: it sets the water level",
          G.g_water_level === -12.5, `${G.g_water_level}`);
    check("...and despawns without joining either enemy counter",
          header.despawned && G.g_enemies_alive === 0
          && G.g_enemies_present === 0,
          `${header.despawned} ${G.g_enemies_alive}/${G.g_enemies_present}`);
  }

  {
    const rng = new Rng(11);
    scene(0, rng);
    G.g_water_level = 0;
    const make = (at: number) => ActorSpawn(at, SpawnClass.WaterEnemy, -1,
      "fish", {
        pos: vec3(0, -2, 40),
        class51: {
          water_level: 0.3, speed_x: 0.3, speed_z: 0.3, bob_amplitude: 4,
          entry_mode: 1, subtype: 0, rise_frames: 3, bob_cycles: 0,
          lunge_frames: 40,
        },
      }, rng);
    const a = make(0x9100);
    const t = () => (a as { fish: FishTail }).fish;
    check("a placed fish joins both enemy counters",
          G.g_enemies_alive === 1 && G.g_enemies_present === 1,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
    check("...and `entry_mode` 1 starts it invisible, to fade in",
          t().alpha === 0 && t().state === FishState.Rise, `${t().alpha}`);
    check("...aimed at the camera, not along its own descriptor yaw",
          t().vx === 0 && Math.abs(t().vz + 0.3) < 1e-6,
          `${t().vx} ${t().vz}`);

    // `rise_frames` is 3, so the fourth update is the one that hands over.
    for (let i = 0; i < 3; i += 1) FishUpdate(a, frame(rng));
    check("the rise lasts exactly `tail+0x10` frames",
          t().state === FishState.Bob && t().alpha === 1,
          `${FishState[t().state]} ${t().alpha}`);

    // `bob_cycles` is 0 and the counter starts at 0, so the first bob frame
    // already satisfies the test and it goes for a slot.
    FishUpdate(a, frame(rng));
    check("...and with no bob cycles owed it claims a slot at once",
          t().state === FishState.Lunge && t().slot >= 0
          && G.g_water_attack_slots[t().slot] === 1,
          `${FishState[t().state]} slot ${t().slot}`);
    check("...taking the permit its slot names",
          a.attackPermit === 0, `${a.attackPermit}`);

    // Four is the whole supply.
    const rest = [make(0x9101), make(0x9102), make(0x9103), make(0x9104)];
    for (const f of rest) {
      const ft = (f as { fish: FishTail }).fish;
      ft.state = FishState.Bob;
      ft.bobCycles = 0;
      ft.bobCycle = 0;
      FishUpdate(f, frame(rng));
    }
    check("only four fish can be in the air at once",
          G.g_water_attack_slots.filter((v) => v === 1).length === 4,
          `${G.g_water_attack_slots}`);
    const last = (rest[3] as { fish: FishTail }).fish;
    check("...and the fifth retires from both counters and swims off",
          last.swimAway && last.slot === -1,
          `${last.swimAway} slot ${last.slot}`);

    // `FishSwimAwayTick` (`FUN_00439C20`) is the whole of its update from
    // here: a shot is not checked, and past `sub+0x7C` (0x3C) frames the
    // silhouette scale `sub+0x28` shrinks 0.01 a frame from 0.4 and the fish
    // despawns when it reaches zero -- `0x00439D23`..`0x00439D61`. Float32
    // leaves 0.4 - 40 * 0.01 at +1e-8, so the 41st shrink is the one: tick
    // 100. This said nothing ever removed it.
    const swimmer = rest[3];
    const score = G.g_player_score[0];
    swimmer.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
    const strip0 = last.frame;
    let gone = -1;
    for (let tick = 1; tick <= 120 && gone < 0; tick += 1) {
      FishUpdate(swimmer, frame(rng));
      if (tick === 1) {
        check("a fish swimming off is not shot: nothing scores",
              G.g_player_score[0] === score && last.swimAway,
              `${G.g_player_score[0] - score}`);
        check("...and its tick draws the strip frame it then steps",
              last.swimDrawFrame === strip0 && last.frame !== strip0
              && last.swimDrawScale === Math.fround(0.4),
              `${last.swimDrawFrame.toString(16)} ${last.frame.toString(16)}`);
      }
      if (tick === 60) {
        check("...its silhouette starts to shrink on the frame the count "
              + "reaches 0x3C",
              last.dx === Math.fround(Math.fround(0.4) - Math.fround(0.01)),
              `${last.dx}`);
      }
      if (swimmer.despawned) gone = tick;
    }
    check("...and it is gone when the scale reaches zero, on tick 100",
          gone === 100, `tick ${gone}`);
  }

  {
    // Shot above the water and shot below it are different deaths.
    const rng = new Rng(13);
    scene(0, rng);
    G.g_water_level = -10;
    const mk = (at: number, submerged: boolean) => {
      const f = ActorSpawn(at, SpawnClass.WaterEnemy, -1, "fish", {
        pos: vec3(0, submerged ? -20 : 0, 30),
        class51: {
          water_level: 0.3, speed_x: 0.3, speed_z: 0.3, bob_amplitude: 4,
          entry_mode: 0, subtype: 0, rise_frames: 30, bob_cycles: 1,
          lunge_frames: 40,
        },
      }, rng);
      const ft = (f as { fish: FishTail }).fish;
      if (submerged) ft.flags |= FishFlag.Submerged;
      f.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
      return { f, ft };
    };
    const above = mk(0x9200, false);
    const below = mk(0x9201, true);
    const score = G.g_player_score[0];
    FishUpdate(above.f, frame(rng));
    check("a fish above the water is flung when it is shot",
          above.ft.state === FishState.Flung,
          FishState[above.ft.state]);
    FishUpdate(below.f, frame(rng));
    check("...and one below it surfaces and sinks",
          below.ft.state === FishState.Sink
          // The state runs in the same update as the shot, and it takes its
          // first 0.005 off the sinking centre before this line is reached.
          && Math.abs(below.ft.sinkY - (G.g_water_level + 0.095)) < 1e-6,
          `${FishState[below.ft.state]} sinkY=${below.ft.sinkY}`);
    check("...each paying 80", G.g_player_score[0] - score === 160,
          `${G.g_player_score[0] - score}`);
  }

  // -- class 0x11, the frog ------------------------------------------------
  {
    const rng = new Rng(17);
    scene(0, rng);
    const a = ActorSpawn(0x9300, SpawnClass.Frog, 0x1b, "frog", {
      pos: vec3(50, -8, -432),
      class11: {
        char_type: 0x1b, motion: 0x141, cam_path: 41, cam_frame: 55,
        wedge: 0,
        commands: [{ op: 3, args: [0x3800] }, { op: 7, args: [] }],
      },
    }, rng);
    const t = () => (a as { frog: FrogTail }).frog;
    check("a frog joins both enemy counters",
          G.g_enemies_alive === 1 && G.g_enemies_present === 1,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
    check("...snapped to the ground plane, which is a constant and not a query",
          a.pos.y === G.g_camera_fixed_eye_y, `${a.pos.y}`);
    // atan2(320, 640.2) is 26.55 degrees; less 0x200 that is 23.7, which is
    // 0x10E2 in BAMS. A wedge read straight off a zero tail would be 0.
    check("...and its wedge is the half-FOV less 0x200 when the tail says 0",
          t().wedge === 0x10e2, `0x${t().wedge.toString(16)}`);

    G.g_active_cam_path = 40;
    G.g_cam_path_frame = 999;
    FrogUpdate(a, frame(rng));
    check("state 0 holds while the camera is on a different path",
          t().state === FrogState.WaitForCamera, FrogState[t().state]);
    G.g_active_cam_path = 41;
    FrogUpdate(a, frame(rng));
    FrogUpdate(a, frame(rng));
    check("...and the cue takes the next command, which is the absolute turn",
          t().state === FrogState.HopToHeading && t().cursor === 1,
          `${FrogState[t().state]} cursor ${t().cursor}`);
  }

  {
    const rng = new Rng(19);
    scene(0, rng);
    const a = ActorSpawn(0x9301, SpawnClass.Frog, 0x1b, "frog", {
      pos: vec3(0, 0, 40),
      class11: {
        char_type: 0x1b, motion: 0x141, cam_path: 41, cam_frame: 0, wedge: 0,
        commands: [],
      },
    }, rng);
    const t = () => (a as { frog: FrogTail }).frog;
    const score = G.g_player_score[0];
    a.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
    FrogUpdate(a, frame(rng));
    check("one shot kills a frog -- there is no hit-point arithmetic",
          t().state === FrogState.Die && a.hp === 0,
          `${FrogState[t().state]} hp ${a.hp}`);
    check("...paying 80", G.g_player_score[0] - score === 80,
          `${G.g_player_score[0] - score}`);
    check("...and the alive count comes down while the present count does not",
          G.g_enemies_alive === 0 && G.g_enemies_present === 1,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
    // `part+0x210` is bone 2's record at `+0x78` -- its hit radius -- and
    // not bone 3's slot: bone 3's model stays on the corpse.
    check("...with the corpse model on bone 1, bone 2 blanked and unshootable, "
          + "and bone 3 left alone",
          a.boneSlot["1"] === 0xb91 && a.boneSlot["2"] === 0
          && a.boneSlot["3"] === undefined && a.boneRadius["2"] === 0,
          `${JSON.stringify(a.boneSlot)} ${JSON.stringify(a.boneRadius)}`);
  }

  {
    // Inside fifty units the frog takes a permit and leaps; if the permit is
    // already out it idles instead, which is `L9` made a test.
    const rng = new Rng(23);
    scene(0, rng);
    const a = ActorSpawn(0x9302, SpawnClass.Frog, 0x1b, "frog", {
      pos: vec3(0, 0, 10),
      class11: {
        char_type: 0x1b, motion: 0x141, cam_path: 41, cam_frame: 0, wedge: 0,
        commands: [],
      },
    }, rng);
    const t = () => (a as { frog: FrogTail }).frog;
    t().camDist = 10;
    t().flags |= FrogFlag.WantCommand;
    FrogReadNextScriptCommand(a, frame(rng));
    check("a frog inside fifty units leaps, and takes a permit to do it",
          t().state === FrogState.LeapAtPlayer && a.attackPermit === 0
          && G.g_attack_permits[0] === a.at,
          `${FrogState[t().state]} permit ${a.attackPermit}`);

    const b = ActorSpawn(0x9303, SpawnClass.Frog, 0x1b, "frog", {
      pos: vec3(0, 0, 10),
      class11: {
        char_type: 0x1b, motion: 0x141, cam_path: 41, cam_frame: 0, wedge: 0,
        commands: [],
      },
    }, rng);
    const bt = () => (b as { frog: FrogTail }).frog;
    bt().camDist = 10;
    bt().flags |= FrogFlag.WantCommand;
    FrogReadNextScriptCommand(b, frame(rng));
    check("...and a second one idles rather than leaping without one",
          bt().state === FrogState.IdleAndCroak && b.attackPermit === -1,
          `${FrogState[bt().state]} permit ${b.attackPermit}`);
  }

  // -- class 0x11: the two turning states, and the push-out -----------------
  //
  // `frog.bin`, cut down to the clips the states below play. The turn clip
  // carries its turn in the **root record** as the real one does (`0x142`
  // ends at ry -24577), and both records get an rx and an rz as well, so a
  // rebase about the wrong axis, in the wrong order or with the wrong sign
  // cannot come out right by symmetry (L48).
  {
    const BONES = 15;
    type Rot = [number, number, number];
    const clip = (frames: number, play: number, r0: Rot = [0, 0x7fff, 0],
                  r1: Rot = [0, 0, 0]) => ({
      bank: "frog", frames, fps: 30, play,
      root: Array.from({ length: frames * 3 }, (_, i) => (i % 3 === 1 ? 2.6 : 0)),
      rot: Array.from({ length: frames * BONES * 3 }, (_, i) => {
        const k = i % (BONES * 3);
        return k < 3 ? r0[k] : k < 6 ? r1[k - 3] : 0;
      }),
    });
    const TURN_R0: Rot = [0x300, -24577, 0x100];
    const TURN_R1: Rot = [0x200, 0x400, -0x180];
    const FROG_TYPE = {
      ...TYPE, type: 0x1b, name: "frog", file: "frog.bin", bone_count: BONES,
      motions: {
        [FrogMotion.Leap]: clip(61, 119),
        [FrogMotion.Death]: clip(6, 10),
        [FrogMotion.Hop]: clip(31, 60),
        [FrogMotion.Idle]: clip(31, 59),
        [FrogMotion.TurnLeft]: clip(16, 30, TURN_R0, TURN_R1),
        [FrogMotion.TurnRight]: clip(16, 30),
        [FrogMotion.HopInPlace]: clip(31, 59),
      },
    };
    const frogScene = (rng: Rng): void => {
      scene(0, rng);
      SetGameTables({
        ...CHARS, types: { "1": TYPE, "27": FROG_TYPE },
      } as unknown as CharactersJson);
    };
    // Camera path 999 never comes, so a frog left in state 0 does nothing.
    const spawnFrog = (at: number, pos: Vec3, rng: Rng) =>
      ActorSpawn(at, SpawnClass.Frog, 0x1b, "frog", {
        pos,
        class11: {
          char_type: 0x1b, motion: 0x141, cam_path: 999, cam_frame: 0,
          wedge: 0, commands: [],
        },
      }, rng);
    const tailOf = (a: Actor) => (a as { frog: FrogTail }).frog;
    const s16 = (v: number) => (v << 16) >> 16;
    const TO_BAMS = 65536 / (Math.PI * 2);

    // The turn's fix-up. When a pass of the turn clip ends the yaw takes the
    // 45 degrees, and bone 1 is turned back by them in the root's frame, so
    // the blend out of the turn clip starts from the pose on screen.
    {
      const rng = new Rng(31);
      frogScene(rng);
      const a = spawnFrog(0x9310, vec3(0, 0, -40), rng);
      const t = tailOf(a);
      a.yaw = 0x1234;
      t.state = FrogState.HopToHeading;
      t.sub = 0;
      t.a = 0x2800;
      FrogStateHopWithinScreenWedge(a, frame(rng));
      check("a frog owed more than 30 degrees starts the left turn clip",
            a.motion === FrogMotion.TurnLeft && t.sub === 1,
            `motion 0x${a.motion.toString(16)} sub ${t.sub}`);
      // `part+0x08` -- the cursor the last draw left, which is what the states
      // read -- at the clip's play length: this pass is done.
      t.playCursor = 30;
      a.playTicks = 30;
      a.fade = 0;                // ...and the fade into it long over
      const yaw0 = a.yaw;
      FrogStateHopWithinScreenWedge(a, frame(rng));
      check("...the pass goes into the yaw, and what is left into the hop",
            a.yaw === s16(yaw0 + 0x2000) && t.a === 0x800
            && a.motion === FrogMotion.Hop && t.sub === 2,
            `yaw ${a.yaw} owed ${t.a} motion 0x${a.motion.toString(16)}`);
      const rec = a.fadeFrom?.records?.find((r) => r.record === 1);
      check("...which dissolves from the turn clip with bone 1 rewritten",
            a.fadeFrom?.motion === FrogMotion.TurnLeft && rec !== undefined,
            JSON.stringify(a.fadeFrom));
      // The invariant the rewrite exists for: the actor's yaw, the root
      // record and bone 1, composed as the draw composes them, put bone 1
      // where it was drawn before the yaw moved.
      const orient = (yaw: number, r0: Rot, r1: Rot) => {
        const m = MatIdentity();
        MatrixRotateY(m, yaw);
        MatrixRotateZ(m, r0[2]); MatrixRotateY(m, r0[1]); MatrixRotateX(m, r0[0]);
        MatrixRotateZ(m, r1[2]); MatrixRotateY(m, r1[1]); MatrixRotateX(m, r1[0]);
        return m;
      };
      const before = orient(yaw0, TURN_R0, TURN_R1);
      const after = orient(a.yaw, TURN_R0, rec?.rot ?? TURN_R1);
      let err = 0;
      for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) {
        err = Math.max(err, Math.abs(before[i] - after[i]));
      }
      check("...so bone 1 keeps the world orientation it was drawn with",
            err < 2e-3, `max element error ${err}`);

      // With a pass still to go there is no blend, and nothing to carry the
      // rewrite: the draw overwrites it, so the snapshot is not touched.
      t.sub = 1;
      t.a = 0x5000;
      a.motion = FrogMotion.TurnLeft;
      t.playCursor = 30;
      a.playTicks = 30;
      a.fadeFrom = null;
      a.fade = 0;
      FrogStateHopWithinScreenWedge(a, frame(rng));
      check("...and a pass with another to follow blends nothing",
            t.sub === 1 && t.a === 0x3000 && a.fadeFrom === null,
            `sub ${t.sub} owed 0x${t.a.toString(16)}`);
    }

    // The launch frame runs on into the flight: both states' substate 2
    // bumps the substate and falls into substate 3's code, which halves the
    // turn still owed.
    {
      const rng = new Rng(37);
      frogScene(rng);
      const a = spawnFrog(0x9311, vec3(0, 0, -40), rng);
      const t = tailOf(a);
      t.state = FrogState.HopToHeading;
      t.sub = 2;
      t.a = 0x800;
      a.motion = FrogMotion.Hop;
      t.playCursor = 0x12;
      const yaw0 = a.yaw;
      FrogStateHopWithinScreenWedge(a, frame(rng));
      check("the hop's launch frame also halves the turn it still owes",
            t.sub === 3 && t.a === 0x400 && a.yaw === s16(yaw0 + 0x400)
            && Math.hypot(a.vel.x, a.vel.z) > 0.99,
            `sub ${t.sub} owed 0x${t.a.toString(16)} yaw ${a.yaw - yaw0}`);

      t.state = FrogState.LeapAtPlayer;
      t.sub = 2;
      t.a = 0x400;
      a.motion = FrogMotion.Leap;
      t.playCursor = 0x1e;
      FrogStateLeapAtPlayer(a, frame(rng));
      check("...and so does the leap's",
            t.sub === 3 && t.a === 0x200
            && (t.flags & FrogFlag.CycleRunning) !== 0,
            `sub ${t.sub} owed 0x${t.a.toString(16)}`);

      // The recovery: `ActorSetMotionBlended(0x13E, 0x3D, 2)` -- the leap
      // clip resumed one past the frame it connected on, over a fade of 2.
      t.sub = 4;
      t.flags = FrogFlag.CycleRunning | FrogFlag.CycleWrapped
        | FrogFlag.NoGravity;
      a.motion = FrogMotion.Idle;
      a.playTicks = 7;
      a.fadeFrom = null;
      a.fade = 0;
      FrogStateLeapAtPlayer(a, frame(rng));
      check("after the bone-2 cycle wraps the leap resumes where it "
            + "connected, over a fade of 2 and not 61",
            a.motion === FrogMotion.Leap
            && MotionPlayFrame(a) === FROG_LEAP_RECOVER_CURSOR
            && t.playCursor === FROG_LEAP_RECOVER_CURSOR
            && a.fadeLen === 3 && t.sub === 5
            && (t.flags & (FrogFlag.CycleRunning | FrogFlag.CycleWrapped
                           | FrogFlag.NoGravity)) === 0,
            `motion 0x${a.motion.toString(16)} cursor ${MotionPlayFrame(a)} `
            + `fadeLen ${a.fadeLen} sub ${t.sub}`);
    }

    // State 1's heading window has three bands across the screen, and the
    // middle one is the full 0x3000. A frog 100 units out, clear of both
    // wedge rays, so the clamp leaves the window alone; its yaw makes the
    // aim at the camera exactly 0.
    {
      const pos = vec3(1, 0, -100);
      const yaw = Math.trunc(Math.atan2(pos.x, pos.z) * TO_BAMS);
      const picks = (viewX: number): number[] => {
        const out: number[] = [];
        for (let seed = 1; seed <= 24; seed++) {
          const rng = new Rng(seed);
          frogScene(rng);
          G.g_camera_yaw_bams = 0;
          const a = spawnFrog(0x9312, vec3(pos.x, 0, pos.z), rng);
          a.yaw = yaw;
          const t = tailOf(a);
          t.state = FrogState.HopAcross;
          t.sub = 0;
          const host: GameHost = {
            ...HOST,
            viewSpaceOf: (_at, o) => { o.x = viewX; o.y = 0; o.z = -100; return true; },
          };
          FrogStateHopWithinScreenWedge(a, { dt: 1 / 60, rng, host });
          out.push(t.a);
        }
        return out;
      };
      const mid = picks(0);
      check("a frog in the middle of the screen may turn either way",
            mid.some((v) => v < 0) && mid.some((v) => v > 0)
            && mid.every((v) => v >= -0x1800 && v <= 0x1800),
            mid.join(","));
      const left = picks(-40);
      check("...and one left of the z/4 line only one way",
            left.every((v) => v >= 0 && v <= 0x1800), left.join(","));
    }

    // The wedge clamp is `acos`, not `asin`: `FUN_004AD0B0` is the C
    // runtime's arc cosine. A frog standing exactly on the first screen-edge
    // ray is 0 from it, and acos(0) moves the window a quarter turn where
    // asin(0) would not move it at all. HopToward with no camera point takes
    // [aim, aim + 0x1800]; a base past 0x2000 is taken as it is, so the
    // heading is the clamp's own number.
    {
      const rng = new Rng(41);
      frogScene(rng);
      // The rays hang off camera block 2's yaw (`0x0043AB62`), not the
      // gameplay eye's heading, which is given something else here.
      G.g_camera_block2_yaw_bams = 0;
      G.g_camera_yaw_bams = 0x3000;
      const a = spawnFrog(0x9313, vec3(0, 0, 0), rng);
      const t = tailOf(a);
      const ray = s16(t.wedge - 0x8000) * (Math.PI * 2) / 65536;
      a.pos.x = Math.sin(ray) * 50;
      a.pos.z = Math.cos(ray) * 50;
      a.yaw = 20000;
      t.state = FrogState.HopToward;
      t.sub = 0;
      FrogStateHopWithinScreenWedge(a, frame(rng));
      const halfFov = Math.trunc(Math.atan2(320, PROJECTION_DISTANCE_PX)
                                 * TO_BAMS);
      const withAcos = s16(halfFov + 0x4000 - 20000 + 0x4000);
      const withAsin = s16(halfFov - 20000 + 0x4000);
      check("a frog on a wedge ray has its window moved by acos(0), "
            + "a quarter turn",
            Math.abs(t.a - withAcos) <= 2 && Math.abs(t.a - withAsin) > 2,
            `heading ${t.a}, acos ${withAcos}, asin ${withAsin}`);
    }

    // `FrogPushOutOfActorCollision`. The camera is a quarter turn about Y and
    // an offset, so a point taken in the wrong space lands nowhere near the
    // other frog (L48). The push is in the world, scaled by bone 1's travel
    // since the last draw, and the pushed point is what the frog publishes.
    {
      const rng = new Rng(43);
      frogScene(rng);
      const cam = vec3(10, 5, 20);
      const toView = (p: Vec3, o: Vec3): void => {
        const dx = p.x - cam.x, dy = p.y - cam.y, dz = p.z - cam.z;
        o.x = -dz; o.y = dy; o.z = dx;
      };
      const a = spawnFrog(0x9314, vec3(0, 0, -50), rng);
      const b = spawnFrog(0x9315, vec3(40, 0, -50), rng);
      const g = a.pos.y;
      const drawn = vec3(0, g + 2.6, -50);
      const host: GameHost = {
        ...NULL_HOST,
        boneWorld: (at, bone, o) => {
          if (at !== a.at || bone !== 1) return false;
          o.x = drawn.x; o.y = drawn.y; o.z = drawn.z;
          return true;
        },
        viewPoint: (x, y, z, o) => {
          o.x = cam.x + z; o.y = cam.y + y; o.z = cam.z - x;
        },
        viewSpaceOfPoint: (p, o) => { toView(p, o); return true; },
      };
      const pf = (): ClassFrame => ({ dt: 1 / 60, rng, host });
      // The other frog has published a sphere two units to A's +x: its own
      // push wrote it, its registration filed it, and the frame boundary
      // published it.
      b.visible = true;
      b.sphereCentre.x = 2;
      b.sphereCentre.y = g + 2.6;
      b.sphereCentre.z = -50;
      PublishCrowd(b);
      // The last draw left bone 1 0.4 behind where this frame draws it.
      const last = vec3();
      toView(vec3(0, g + 2.6, -50.4), last);
      tailOf(a).bone1View = { x: last.x, y: last.y, z: last.z };
      FrogUpdate(a, pf());
      const near = (u: number, v: number) => Math.abs(u - v) < 1e-5;
      // depth 3 + 3 - 2 = 4, normal -x, travel 0.4: 4 * 0.4 * 0.3.
      check("a frog in another's sphere is pushed out along the world normal, "
            + "at the depth times its travel times 0.3",
            near(a.pos.x, -0.48) && near(a.pos.z, -50),
            `pos ${a.pos.x}, ${a.pos.z}`);
      check("...and publishes bone 1, pushed, as its sphere",
            near(a.sphereCentre.x, -0.48) && near(a.sphereCentre.y, g + 2.6)
            && near(a.sphereCentre.z, -50),
            JSON.stringify(a.sphereCentre));
      check("...having measured the other frog where it published itself",
            b.sphereCentre.x === 2 && b.pushedBy === a.at,
            `${JSON.stringify(b.sphereCentre)} pushedBy ${b.pushedBy}`);
      check("...and the travel from bone 1 as last drawn, through the camera",
            near(G.g_frog_bone1_on_entry.z, -50.4)
            && near(G.g_frog_bone1_on_entry.x, 0),
            JSON.stringify(G.g_frog_bone1_on_entry));

      // Drawn in the same place again: no travel, a twentieth of the depth.
      FrogUpdate(a, pf());
      check("a frog that has not moved is nudged at a twentieth of the depth",
            near(a.pos.x, -0.48 - 0.2), `pos ${a.pos.x}`);

      // The camera moves 0.4 and the frog does not. The travel is measured
      // between two readings of one record through one camera block, so it
      // is travel relative to the camera -- the engine's arrangement.
      cam.x += 0.4;
      FrogUpdate(a, pf());
      check("...but under a camera that moved 0.4, at the rate for 0.4",
            near(a.pos.x, -0.48 - 0.2 - 0.48), `pos ${a.pos.x}`);

      // The leap skips the test, and still publishes where bone 1 is.
      const t = tailOf(a);
      t.state = FrogState.LeapAtPlayer;
      t.sub = 4;
      t.flags = 0;
      const x0 = a.pos.x;
      FrogUpdate(a, pf());
      check("the leap is never pushed, but its point is still published",
            a.pos.x === x0 && near(a.sphereCentre.x, 0)
            && near(a.sphereCentre.z, -50),
            `pos ${a.pos.x} sphere ${JSON.stringify(a.sphereCentre)}`);
    }

    // -- the death: `FrogAwardKillAndEnterDeath` and `FrogStateDieTumbleAndSink`
    //
    // Driven the way the director drives a frog -- `ActorAdvanceMotion`, then
    // the update, a frame at a time -- because the hang this pins lived in
    // the phase between the two. The camera is pitched down by asin(0.1),
    // turned a quarter about Y and set somewhere `ClassFrame.eye` is not, so
    // the kick has to be the camera's rotation of (0, 0, -0.5) and nothing
    // else (L48).
    {
      const cam = vec3(7, 9, -3);
      const SN = 0.1;
      const CS = Math.sqrt(1 - SN * SN);
      const host: GameHost = {
        ...NULL_HOST,
        viewPoint: (x, y, z, o) => {
          o.x = cam.x + z * CS; o.y = cam.y + y + z * SN; o.z = cam.z - x;
        },
      };
      const near = (u: number, v: number, e = 1e-9) => Math.abs(u - v) < e;
      const deathScene = (seed: number) => {
        const rng = new Rng(seed);
        frogScene(rng);
        const a = spawnFrog(0x9320, vec3(0, 0, -40), rng);
        const pf = (): ClassFrame => ({ dt: 1 / 60, rng, host });
        // One frame as `SceneTaskWalk` runs it: the clock, then the update.
        const step = (): void => {
          ActorAdvanceMotion(a, 1 / 60);
          FrogUpdate(a, pf());
        };
        return { rng, a, t: tailOf(a), step };
      };

      {
        const { a, t, step } = deathScene(47);
        const ground = a.pos.y;
        check("a frog's Init raises the bit its ring and shadow trace the "
              + "floor by, and publishes its sphere at its feet",
              (a.motionFlags & MotionFlag.TraceGround) !== 0
              && a.sphereCentre.x === 0 && a.sphereCentre.z === -40
              && a.sphereCentre.y === ground,
              `flags 0x${a.motionFlags.toString(16)} `
              + JSON.stringify(a.sphereCentre));
        for (let i = 0; i < 5; i++) step();
        const slot = a.hitSlot;
        // The descriptor's `+0x22`, which the spawn allocator puts in both
        // words: 1 in all four shipped spawns.
        a.hp = a.maxHp = 1;
        const maxHp = a.maxHp;
        const score = G.g_player_score[0];
        const hits = G.g_player_hit_count[0];
        a.attackPermit = 0;
        G.g_attack_permits[0] = a.at;
        a.lookAt.x = 1.5;
        a.lookAt.z = -41.25;
        G.g_ring_effects = [];
        G.g_blood_sprays = [];
        a.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
        step();
        check("the kill frame runs on into the tumble: the kick is already "
              + "bounced, 0.6 of the camera's own -Z half a unit long",
              t.state === FrogState.Die && t.sub === 1 && a.vel.y === 0
              && near(a.vel.x, -0.5 * CS * 0.6) && a.vel.z === 0,
              `${FrogState[t.state]}/${t.sub} vel ${a.vel.x}, ${a.vel.y}, `
              + `${a.vel.z}`);
        check("...and the death clip is blended in from the pose on screen, "
              + "over a fade of 2",
              a.motion === FrogMotion.Death
              && a.fadeFrom?.motion === FrogMotion.Idle && a.fadeLen === 3,
              `motion 0x${a.motion.toString(16)} from `
              + `${JSON.stringify(a.fadeFrom)} fadeLen ${a.fadeLen}`);
        check("...it leaves the shot test (0x8000) rather than going "
              + "shot-immune (0x100)",
              (a.flags & ActorFlag.NoShotTest) !== 0
              && (a.flags & ActorFlag.ShotImmune) === 0
              && (a.flags & ActorFlag.NoCameraTrack) !== 0,
              `flags 0x${a.flags.toString(16)}`);
        check("...the kill zeroes the u16 at +0x11C and nothing beside it",
              a.hp === 0 && a.maxHp === maxHp, `${a.hp}/${a.maxHp}`);
        check("...the alive count comes down, the permit is freed and the "
              + "frog still names it, as the engine leaves obj+0x121",
              G.g_enemies_alive === 0 && G.g_enemies_present === 1
              && G.g_attack_permits[0] === -1 && a.attackPermit === 0,
              `${G.g_enemies_alive}/${G.g_enemies_present} permits `
              + `${G.g_attack_permits} own ${a.attackPermit}`);
        check("...80 points, a hit counted, the order chosen, and the blood "
              + "on bone 2",
              G.g_player_score[0] - score === 80
              && G.g_player_hit_count[0] - hits === 1
              && G.g_hit_player_order[0] === 0
              && G.g_hit_player_order[1] === -1
              && G.g_blood_sprays.length === 1
              && G.g_blood_sprays[0].at === a.at
              && G.g_blood_sprays[0].bone === 2,
              `score +${G.g_player_score[0] - score} order `
              + `${G.g_hit_player_order} blood `
              + JSON.stringify(G.g_blood_sprays));

        // The frames that follow. The clip is held three frames on its start
        // (a fade of 2), then steps a cursor a frame; the state freezes it
        // when it reads `len - 1` = 9, which the draw at +11 computes, and
        // reads 10 on the frame after. The slide is dead by then, so the
        // ring goes down on +13.
        let frozenAt = -1;
        let ringAt = -1;
        let goneAt = -1;
        const cursors: number[] = [];
        let ringVel = "";
        for (let k = 1; k <= 400 && goneAt < 0; k++) {
          const velBefore = `${a.vel.x},${a.vel.y},${a.vel.z}`;
          step();
          if (k <= 14) cursors.push(t.playCursor);
          if (frozenAt < 0 && (a.flags & ActorFlag.PoseFrozen)) frozenAt = k;
          if (ringAt < 0 && G.g_ring_effects.length) {
            ringAt = k;
            ringVel = velBefore;
            check("...on the settling frame the corpse sinks at 0.035 and "
                  + "counts 180",
                  a.vel.x === 0 && a.vel.z === 0 && a.vel.y === -0.035
                  && t.sub === 2 && t.a === 0xb4,
                  `vel ${a.vel.x}, ${a.vel.y}, ${a.vel.z} sub ${t.sub} `
                  + `a ${t.a}`);
          }
          if (a.despawned) goneAt = k;
        }
        check("the drawn cursor is held three frames on the death clip's "
              + "start and then steps to its length",
              cursors.join(",") === "0,0,1,2,3,4,5,6,7,8,9,10,10,10",
              cursors.join(","));
        check("the clip freezes on the frame the state reads len - 1",
              frozenAt === 12, `${frozenAt}`);
        const ring = G.g_ring_effects[0];
        check("SpawnGroundRingEffect goes down on the frame the corpse, "
              + "settled, reads the clip's length",
              ringAt === 13 && ringVel === "0,0,0", `${ringAt} (${ringVel})`);
        check("...under the tracked bone, on the traced ground plus 0.05, "
              + "at the frog's yaw and scale 1",
              ring !== undefined && ring.x === 1.5 && ring.z === -41.25
              && ring.y === Math.fround(QueryGroundHeightAt(0, 0, 0) + 0.05)
              && ring.yaw === a.yaw && ring.scale === 1
              && ring.phase === RingEffectPhase.Spread,
              JSON.stringify(ring));
        check("the corpse despawns 181 frames after it settles, taking the "
              + "present count and its hit slot",
              goneAt === ringAt + 181 && G.g_enemies_present === 0
              && G.g_enemies_alive === 0 && G.g_hit_slots[slot] === HIT_SLOT_NONE
              && slot !== HIT_SLOT_NONE,
              `gone ${goneAt} (ring ${ringAt}) `
              + `${G.g_enemies_alive}/${G.g_enemies_present} slot ${slot}`);
        check("...having sunk 0.035 a frame from the settling frame on",
              near(a.pos.y, ground - 0.035 * 182, 1e-6),
              `${a.pos.y} vs ${ground - 0.035 * 182}`);
      }

      // Every cursor test in the class reads the cursor the last draw left,
      // not the counter the director has already stepped: the hop launches
      // one frame after the counter reaches 0x12, as the engine's does.
      {
        const { a, t, step } = deathScene(53);
        t.state = FrogState.HopToHeading;
        t.sub = 2;
        t.a = 0;
        a.motion = FrogMotion.Hop;
        a.fadeFrom = null;
        a.fade = 0;
        a.playTicks = 0x11;
        t.playCursor = 0x11;
        step();
        const early = t.sub;
        step();
        check("a hop launches on the frame after the counter reaches its "
              + "launch cursor, when the state reads the draw's",
              early === 2 && t.sub === 3 && Math.hypot(a.vel.x, a.vel.z) > 0.99,
              `sub ${early} then ${t.sub}`);
      }

      // Retired while it sinks, a corpse gives back the present count and
      // not the alive count its death state already returned.
      {
        const { a, step } = deathScene(59);
        a.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
        step();
        step();
        g_class_handlers[SpawnClass.Frog]?.leave?.(a);
        check("a sinking frog retired by the script leaves the room's alive "
              + "count alone",
              G.g_enemies_alive === 0 && G.g_enemies_present === 0
              && a.despawned,
              `${G.g_enemies_alive}/${G.g_enemies_present}`);
      }

      // The death frees the permit and leaves `obj+0x121`; a permit someone
      // else has taken since is theirs when the corpse goes.
      {
        const { a, step } = deathScene(61);
        a.attackPermit = 0;
        G.g_attack_permits[0] = a.at;
        a.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
        step();
        G.g_attack_permits[0] = 0x7777;
        g_class_handlers[SpawnClass.Frog]?.onDeadSweep?.(a,
                                                         DeadSweep.Despawned);
        check("a dead frog's sweep does not free a permit another actor holds",
              G.g_attack_permits[0] === 0x7777 && a.attackPermit === -1,
              `${G.g_attack_permits} own ${a.attackPermit}`);
      }

      // Two players in: `ChooseHitPlayerOrder` draws its coin before the
      // shooter's, so the kill frame takes one draw even for a shot only
      // player 0 fired.
      {
        const { rng, a, step } = deathScene(67);
        G.g_active_player = 2;
        a.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
        const ref = new Rng(1);
        ref.state = rng.state;
        const first = ref.int(2);
        step();
        check("with both players in, the kill draws the hit order and "
              + "nothing else for a one-player shot",
              rng.state === ref.state
              && G.g_hit_player_order.join(",")
                 === (first !== 0 ? "0,1" : "1,0"),
              `order ${G.g_hit_player_order} state ${rng.state} vs `
              + `${ref.state}`);
      }
    }
  }

  // -- class 0x43, the owl --------------------------------------------------
  {
    const rng = new Rng(29);
    scene(0, rng);
    G.g_players_in_play = 1;
    const mk = (at: number, subtype: number, member: number) =>
      ActorSpawn(at, SpawnClass.FlyingEnemy, -1, "owl", {
        pos: vec3(-644, 128, -943),
        class43: { subtype, member },
      }, rng);
    const kept = [mk(0x9400, 1, 0), mk(0x9401, 1, 1)];
    const gone = [mk(0x9402, 1, 2), mk(0x9403, 1, 3)];
    check("one player faces two owls of a sub-type, not four",
          kept.every((o) => !o.despawned) && gone.every((o) => o.despawned),
          gone.map((o) => o.despawned).join(","));
    check("...and only the survivors are counted",
          G.g_enemies_alive === 2 && G.g_enemies_present === 2,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
  }

  {
    const rng = new Rng(31);
    scene(0, rng);
    G.g_players_in_play = 2;
    const owls = [0, 1, 2, 3].map((m) =>
      ActorSpawn(0x9500 + m, SpawnClass.FlyingEnemy, -1, "owl", {
        pos: vec3(-644, 128, -943),
        class43: { subtype: 1, member: m },
      }, rng));
    const tail = (o: Actor) => (o as { owl: OwlTail }).owl;
    check("two players face all four", owls.every((o) => !o.despawned));
    check("...perched, with the token free",
          owls.every((o) => tail(o).state === OwlState.WaitLaunch)
          && G.g_class43_attack_token === -1,
          `${G.g_class43_attack_token}`);

    // Member 0 has no delay and no holding circle: it leaves on its first
    // frame, straight onto the approach spline.
    OwlUpdateAndResolveShot(owls[0], frame(rng));
    check("member 0 goes straight to its run-in",
          tail(owls[0]).state === OwlState.Approach,
          OwlState[tail(owls[0]).state]);
    // Members 1..3 wait 20, 40 and 60 frames.
    // `timer` is compared **after** its increment, so member 1's twenty
    // frames of delay take twenty-one updates to expire.
    for (let i = 0; i < 21; i += 1) OwlUpdateAndResolveShot(owls[1], frame(rng));
    check("member 1 waits twenty frames and then flies to the holding circle",
          tail(owls[1]).state === OwlState.FlyToCircle,
          OwlState[tail(owls[1]).state]);
    check("...to a hard-coded point, not to its own spawn",
          tail(owls[1]).centreX === -640 && tail(owls[1]).centreZ === -950,
          `${tail(owls[1]).centreX},${tail(owls[1]).centreZ}`);
    for (let i = 0; i < 19; i += 1) OwlUpdateAndResolveShot(owls[2], frame(rng));
    check("...and member 2 is still perched at the same moment",
          tail(owls[2]).state === OwlState.WaitLaunch,
          OwlState[tail(owls[2]).state]);
  }

  {
    // The sub-type-0 owl cannot be shot until the camera has gone far enough.
    const rng = new Rng(37);
    scene(0, rng);
    G.g_players_in_play = 2;
    const o = ActorSpawn(0x9600, SpawnClass.FlyingEnemy, -1, "owl", {
      pos: vec3(0, 0, 40), class43: { subtype: 0, member: 0 },
    }, rng);
    const t = () => (o as { owl: OwlTail }).owl;
    G.g_cam_path_frame = 100;
    o.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
    OwlUpdateAndResolveShot(o, frame(rng));
    check("a sub-type-0 owl is invulnerable before camera frame 682",
          t().state !== OwlState.Dead, OwlState[t().state]);
    G.g_cam_path_frame = 700;
    o.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
    const score = G.g_player_score[0];
    OwlUpdateAndResolveShot(o, frame(rng));
    check("...and killable after it, for 80",
          t().state === OwlState.Dead && G.g_player_score[0] - score === 80,
          `${OwlState[t().state]} +${G.g_player_score[0] - score}`);
    check("...giving the token back if it was diving",
          G.g_class43_attack_token === -1, `${G.g_class43_attack_token}`);
    for (let i = 0; i < 0x79; i += 1) OwlUpdateAndResolveShot(o, frame(rng));
    check("...and the corpse lasts 121 frames", o.despawned, `${o.despawned}`);
  }

  {
    // The strike is a distance, not a clip frame.
    const rng = new Rng(41);
    scene(0, rng);
    G.g_players_in_play = 1;
    G.g_active_player = 0;
    const o = ActorSpawn(0x9700, SpawnClass.FlyingEnemy, -1, "owl", {
      pos: vec3(0, 0, 2), class43: { subtype: 1, member: 0 },
    }, rng);
    const t = () => (o as { owl: OwlTail }).owl;
    t().state = OwlState.Dive;
    t().dive = OwlDiveKind.Home;
    o.attackPermit = 0;
    G.g_class43_attack_token = 0;
    const lives = G.g_player_lives[0];
    OwlStateDiveAtCamera(o, frame(rng));
    check("an owl inside five units of the eye takes a life",
          G.g_player_lives[0] === lives - 1,
          `${lives} -> ${G.g_player_lives[0]}`);
    check("...then peels off and releases the token",
          t().state === OwlState.OrbitAway && G.g_class43_attack_token === -1,
          `${OwlState[t().state]} ${G.g_class43_attack_token}`);
  }

  {
    // **The wing beat is the dive's clock as well as its animation.**
    // `OwlStateDiveAtCamera` opens on `obj+0x240 = (obj+0x240 + 1) % 30`
    // (`0x00446F42`), before either branch. Held still, the height term
    // `sin((beat + 8) % 30) * 0.2` stops being a bob and becomes a constant
    // bias, and the run-in settles `0.2 / k` off the eye -- five units at the
    // extreme, which is exactly `OWL_STRIKE_RANGE`. The sway dive then passes
    // through the camera just outside its own strike, and because nothing
    // clamps `obj+0x270` in that branch it carries on in a straight line for
    // the rest of the stage. Reported as owls flying straight through the
    // camera on stage 2's block 5.
    const rng = new Rng(47);
    scene(0, rng);
    G.g_players_in_play = 1;
    G.g_active_player = 0;
    // Stage 2's own arrival, measured off the block that reported it: the owl
    // starts 88 units out, 15 below the eye and 7 to one side.
    const o = ActorSpawn(0x9900, SpawnClass.FlyingEnemy, -1, "owl", {
      pos: vec3(-88, -15, -7), class43: { subtype: 0, member: 0 },
    }, rng);
    const t = () => (o as { owl: OwlTail }).owl;
    // The Init's own launch, with its two rng draws pinned so the run-in is
    // the same one every time. The beat is seated where its height term is
    // negative, which is the half of the cycle that puts a frozen owl *under*
    // the eye rather than through it.
    t().rate = 0.0138;
    t().swayRate = Math.trunc(t().rate * 72817.78);
    t().swayPhase = 0;
    t().beat = 15;
    o.attackPermit = 0;
    const lives = G.g_player_lives[0];
    const beats = new Set<number>();
    let struck = -1;
    for (let i = 0; i < 200 && struck < 0; i += 1) {
      OwlStateDiveAtCamera(o, frame(rng));
      beats.add(t().beat);
      if (t().state === OwlState.OrbitAway) struck = i;
    }
    check("the wing beat runs through a dive, all thirty frames of it",
          beats.size === 30, `${beats.size}`);
    check("...so the run-in arrives at the eye's height, not five under it",
          Math.abs(o.pos.y - EYE.y) < 3, `${o.pos.y.toFixed(2)}`);
    check("a sway dive strikes the camera instead of flying through it",
          struck >= 0 && G.g_player_lives[0] === lives - 1,
          `struck at ${struck}, lives ${lives} -> ${G.g_player_lives[0]}`);
  }

  {
    // **Every angle in the class eases toward a target, and the sign of the
    // engine's literal is the whole of it.** The run-in's pitch is
    // `obj+0x64 -= (int)((0x3000 - obj+0x64) * -0.025)` (`0x004464..`, and the
    // same shape at six other call sites), which converges. Negating the
    // literal a second time makes it run away instead, and nothing wraps
    // `obj+0x64`, so the owl tumbled forwards for the length of its approach.
    const rng = new Rng(43);
    scene(0, rng);
    G.g_players_in_play = 1;
    const o = ActorSpawn(0x9a00, SpawnClass.FlyingEnemy, -1, "owl", {
      pos: vec3(-644, 128, -943), class43: { subtype: 1, member: 0 },
    }, rng);
    const t = () => (o as { owl: OwlTail }).owl;
    t().state = OwlState.Approach;
    o.pitch = 0;
    let held = 0;
    let rising = true;
    for (let i = 0; i < 200 && t().state === OwlState.Approach; i += 1) {
      OwlStateRideApproachSpline(o, frame(rng));
      if (t().state !== OwlState.Approach) break;
      if (o.pitch < held) rising = false;
      held = o.pitch;
    }
    check("the run-in's pitch closes on 0x3000 rather than running away",
          rising && held > 0 && held <= 0x3000, `${held}`);
  }

  // -- the owl's and the fish's effect tasks -----------------------------------
  //
  // Every one of them is a task of its own that runs on the frame it is made,
  // after its maker, and every one of them ENDS -- the kills are past a
  // `MatrixStackPop` the decompiler stops at, which is what the port's old
  // note ("none of the three updates has a termination") was reading.
  {
    // The death: blood at the owl's camera point, forty feathers, and the
    // corpse's yaw still steered on the frame it dies.
    const rng = new Rng(53);
    scene(0, rng);
    G.g_players_in_play = 2;
    check("the effect tests run in play", G.g_app_state === AppState.InPlay,
          `${G.g_app_state}`);
    const seen: Vec3[] = [];
    const host: GameHost = {
      ...HOST,
      viewSpaceOfPoint: (p, out) => {
        seen.push(vec3(p.x, p.y, p.z));
        out.x = p.x; out.y = p.y; out.z = p.z - 100;
        return true;
      },
    };
    const o = ActorSpawn(0x9b00, SpawnClass.FlyingEnemy, -1, "owl", {
      pos: vec3(3, 4, 40), class43: { subtype: 1, member: 0 },
    }, rng);
    const t = () => (o as { owl: OwlTail }).owl;
    t().prevX = o.pos.x;
    t().prevZ = o.pos.z;
    o.yaw = 0x4000;
    o.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
    const blood = G.g_point_blood_sprays.length;
    OwlUpdateAndResolveShot(o, { ...frame(rng), host });
    check("a shot owl sheds forty feathers",
          t().state === OwlState.Dead && G.g_owl_feathers.length === 40,
          `${OwlState[t().state]} ${G.g_owl_feathers.length}`);
    check("...in a unit box about it",
          G.g_owl_feathers.every((f) => Math.abs(f.x - 3) <= 0.5
            && Math.abs(f.y - 4) <= 0.5 && Math.abs(f.z - 40) <= 0.5));
    // `rand() & 0x8000FFFF` of a `rand()` that is never above 0x7FFF.
    check("...each turned by half a turn at most, not a whole one",
          G.g_owl_feathers.every((f) => f.yaw >= 0 && f.yaw < 0x8000),
          `${Math.max(...G.g_owl_feathers.map((f) => f.yaw))}`);
    // Two points go through the camera on the death frame: the blood's, and
    // then -- the frame falls through to the tail -- the shot test's depth.
    check("...and leaves blood at its camera-space point",
          G.g_point_blood_sprays.length === blood + 1
          && seen.length === 2 && seen[0].z === 40
          && G.g_point_blood_sprays[blood].pos.z === -60,
          `${G.g_point_blood_sprays.length - blood} ${JSON.stringify(seen)}`);
    // Standing still, the heading of its own motion is 0, and the death frame
    // falls through into the yaw steering: a tenth of the way there.
    check("the death frame still steers the yaw, a tenth of the error",
          o.yaw === 0x4000 - 1638, `${o.yaw}`);

    // A feather lives nine half turns of its phase and is killed on the frame
    // it would start a tenth -- without drawing.
    const f0 = G.g_owl_feathers[0];
    const x0 = f0.x;
    const z0 = f0.z;
    const tx = f0.tx;
    const tz = f0.tz;
    const rate = f0.rate;
    OwlEffectsTick(rng);
    check("a feather eases x by 1/(0x8000 / rate) and z by a thirty-second",
          Math.abs(f0.x - (x0 + (tx - x0) / Math.trunc(0x8000 / rate))) < 1e-9
          && Math.abs(f0.z - (z0 + (tz - z0) / 32)) < 1e-9,
          `${f0.x} ${f0.z}`);
    let frames = 1;
    let lastTurns = 0;
    while (G.g_owl_feathers.includes(f0) && frames < 5000) {
      lastTurns = f0.turns;
      OwlEffectsTick(rng);
      frames += 1;
    }
    // The first half turn takes 0x8000 / (0x200..0x400) frames, every one
    // after it 0x8000 / (0x100..0x500).
    check("...and is gone after its ninth half turn",
          !G.g_owl_feathers.includes(f0) && lastTurns === 8
          && frames >= 32 + 8 * 26 && frames <= 64 + 8 * 128 + 1,
          `${frames} frames, ${lastTurns} turns`);
    for (let i = 0; i < 2000 && G.g_owl_feathers.length; i += 1) {
      OwlEffectsTick(rng);
    }
    check("...as are all forty", G.g_owl_feathers.length === 0,
          `${G.g_owl_feathers.length}`);
  }

  {
    // The strike sheds eight.
    const rng = new Rng(59);
    scene(0, rng);
    G.g_players_in_play = 1;
    G.g_active_player = 0;
    const o = ActorSpawn(0x9c00, SpawnClass.FlyingEnemy, -1, "owl", {
      pos: vec3(0, 0, 2), class43: { subtype: 1, member: 0 },
    }, rng);
    const t = () => (o as { owl: OwlTail }).owl;
    t().state = OwlState.Dive;
    t().dive = OwlDiveKind.Home;
    o.attackPermit = 0;
    OwlStateDiveAtCamera(o, frame(rng));
    check("an owl's strike sheds eight feathers",
          t().state === OwlState.OrbitAway && G.g_owl_feathers.length === 8,
          `${OwlState[t().state]} ${G.g_owl_feathers.length}`);
  }

  {
    // The corpse's ground ring: 120 frames opening, 29 held, 39 fading.
    const rng = new Rng(61);
    const events = scene(0, rng);
    const sounds: number[] = [];
    events.on("sound.play", (e) => sounds.push(e.id));
    OwlSpawnGroundImpactRing(1, 2, 3, 0.75, 0x1000, 0xdc00, events);
    const r = G.g_owl_ground_rings[0];
    check("the owl's ground ring plays its bobble",
          sounds.length === 1 && sounds[0] === 0x118a9, `${sounds}`);
    let drawn = 0;
    let lastPulse = -1;
    while (G.g_owl_ground_rings.length && drawn < 1000) {
      OwlEffectsTick(rng);
      if (!G.g_owl_ground_rings.length) break;
      drawn += 1;
      if (r.drew === OwlGroundRingPhase.Pulse) lastPulse = drawn;
    }
    check("...pulses for 120 frames and fades for 68 more, then goes",
          lastPulse === OWL_RING_PULSE_FRAMES && drawn === 120 + 29 + 39,
          `${lastPulse} ${drawn}`);

    OwlSpawnWaterSplashFlipbook(5, 99, 6);
    const s = G.g_owl_water_splashes[0];
    check("the owl's water splash sits on y = -25, whatever it is handed",
          s.y === -25 && s.x === 5 && s.z === 6, `${s.x},${s.y},${s.z}`);
    const cels: number[] = [];
    for (let i = 0; i < 40 && G.g_owl_water_splashes.length; i += 1) {
      OwlEffectsTick(rng);
      if (G.g_owl_water_splashes.length) cels.push(s.shown);
    }
    check("...and draws its thirty cels once each, the last one included",
          cels.length === 30 && cels[0] === 0 && cels[29] === 29,
          `${cels.length} ${cels[0]}..${cels[cels.length - 1]}`);
  }

  // -- the owl's corpse: four landings, and the effects only they make -------
  //
  // `OwlCorpseFallAndSettle` (`FUN_00448210`) lands each sub-type on its own
  // literals, and the ground ring and the water splash have no other caller.
  // Every number below is the exe's own, written out rather than imported, so
  // that a wrong constant in the port fails here.
  {
    const rng = new Rng(71);
    const events = scene(0, rng);
    G.g_players_in_play = 2;
    G.g_scene_index = 0;
    const sounds: number[] = [];
    events.on("sound.play", (e) => sounds.push(e.id));
    const THUD = 0x1e16a9;       // COMMON\DAMAGE5_22.WAV
    const SIBUKI = 0x4616a9;     // COMMON\SIBUKI8_16.WAV
    const BOBBLE = 0x118a9;      // the ring's own, in scene 0
    const GRAV = Math.fround(0.020415);
    let at = 0xa400;
    // An owl of `subtype` shot where it stands, then put at (x, y, z) with
    // the given velocity: the corpse's first frame is the next update.
    const corpse = (subtype: number, x: number, y: number, z: number,
                    vx = 0, vy = 0, vz = 0) => {
      G.g_cam_path_frame = 700;
      G.g_owl_ground_rings = [];
      G.g_owl_water_splashes = [];
      const o = ActorSpawn(at++, SpawnClass.FlyingEnemy, -1, "owl", {
        pos: vec3(x, y, z), class43: { subtype, member: 0 },
      }, rng);
      const t = (o as { owl: OwlTail }).owl;
      o.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
      OwlUpdateAndResolveShot(o, frame(rng, events));
      o.pos.x = x; o.pos.y = y; o.pos.z = z;
      t.vx = vx; t.vy = vy; t.vz = vz;
      sounds.length = 0;
      const step = () => OwlUpdateAndResolveShot(o, frame(rng, events));
      return { o, t, step };
    };

    {
      const { o, t, step } = corpse(1, 0, 100, 0);
      check("a shot owl is marked with the owl's corpse bit, 0x1000000, and "
            + "not ActorFlag.Dead",
            t.state === OwlState.Dead && (o.flags & 0x1000000) !== 0
            && (o.flags & ActorFlag.Dead) === 0,
            `flags 0x${o.flags.toString(16)}`);
      const p0 = o.pitch;
      step();
      check("the corpse tumbles by its spin, and the spin keeps 0.95 of "
            + "itself, truncated",
            o.pitch === p0 - 768 && t.spin === -729,
            `${o.pitch - p0} ${t.spin}`);
      step();
      check("...-768, then -729, then -692",
            o.pitch === p0 - 768 - 729 && t.spin === -692,
            `${o.pitch - p0} ${t.spin}`);
      check("...and in the air nothing is made and nothing heard",
            G.g_owl_ground_rings.length === 0
            && G.g_owl_water_splashes.length === 0 && sounds.length === 0,
            `${sounds}`);
    }

    // Sub-type 0: the stairwell.
    {
      const { t, step } = corpse(0, -690, 60, -1103, 0, 0, 0.1);
      step();
      check("sub-type 0, between its two rails: both flip z and cancel",
            t.vz === 0.1, `${t.vz}`);
    }
    {
      const { t, step } = corpse(0, -690, 60, -1095, 0, 0, 0.1);
      step();
      check("...beyond rail 0 one flips, and the corpse turns back",
            t.vz === -0.1, `${t.vz}`);
    }
    {
      const { t, step } = corpse(0, -690, 60, -1120, 0, 0, -0.1);
      step();
      check("...beyond rail 1 likewise, the other way", t.vz === 0.1,
            `${t.vz}`);
    }
    {
      const { t, step } = corpse(0, -725, 60, -1095, 0, 0, 0.1);
      step();
      check("...and west of the rails' last point neither is tested",
            t.vz === 0.1, `${t.vz}`);
    }
    {
      const { o, t, step } = corpse(0, -738.9, 60, -1100, -0.5, 0, 0.2);
      step();
      check("sub-type 0, past x = -739: stopped dead, and 0x600 on the spin",
            o.pos.x === -739 && t.vx === 0 && t.vz === 0
            && t.spin === -729 + 0x600,
            `${o.pos.x} ${t.vx} ${t.vz} ${t.spin}`);
    }
    {
      // x -689.5 is step n = -4 of `n * 6 - 671`: a floor at 41.
      const { o, t, step } = corpse(0, -690, 41.01, -1103, 0.5, 0, 0);
      step();
      check("sub-type 0, on a step: onto it, x0.8 across, x-0.4 up, 0x400 "
            + "off the spin, and the thud",
            o.pos.y === 41 && t.vy === -GRAV * Math.fround(-0.4)
            && t.vx === 0.5 * Math.fround(0.8) && t.spin === -729 - 0x400
            && t.settled === 0 && sounds.join() === `${THUD}`
            && G.g_owl_ground_rings.length === 0,
            `${o.pos.y} ${t.vy} ${t.vx} ${t.spin} ${sounds}`);
    }
    {
      const { o, t, step } = corpse(0, -730, 35.93, -1100);
      o.yaw = 0x1234;
      step();
      const r = G.g_owl_ground_rings[0];
      check("sub-type 0 lands for good under 35.91906, with a ring at "
            + "35.93906 turned to its yaw",
            o.pos.y === Math.fround(35.91906) && t.settled === 1
            && G.g_owl_ground_rings.length === 1
            && r.y === Math.fround(35.93906) && r.x === o.pos.x
            && r.z === o.pos.z && r.scale === 0.75 && r.pitch === 0
            && r.yaw === 0x1234,
            `${o.pos.y} ${JSON.stringify(r)}`);
      check("...to the ring's bobble and then the thud",
            sounds.join() === `${BOBBLE},${THUD}`, `${sounds}`);
      const pitch = o.pitch;
      step();
      check("a landed corpse sinks 0.03 a frame and does nothing else",
            o.pos.y === Math.fround(35.91906) - Math.fround(0.03)
            && o.pitch === pitch && G.g_owl_ground_rings.length === 1,
            `${o.pos.y} ${o.pitch - pitch}`);
    }

    // Sub-type 1: a line between a flat and a slope.
    {
      const { o, t, step } = corpse(1, -600, 49.17, -950);
      step();
      const r = G.g_owl_ground_rings[0];
      check("sub-type 1, on the flat side of its line: under 49.16, a ring "
            + "at 49.3 turned 0xDC00 -- and no thud",
            t.settled === 1 && r?.y === Math.fround(49.3) && r.pitch === 0
            && r.yaw === 0xdc00 && r.scale === 0.75
            && sounds.join() === `${BOBBLE}`,
            `${t.settled} ${JSON.stringify(r)} ${sounds}`);
      check("...and the corpse is left where it fell, not put on the flat",
            o.pos.y === 49.17 - GRAV, `${o.pos.y}`);
    }
    {
      const b = Math.fround(0.979029);
      const c = Math.fround(0.203721);
      const d = Math.fround(140.1687);
      const z = -900;
      const under = -(c * z + d) / b;
      const { o, t, step } = corpse(1, -660, under + 0.5, z);
      step();
      check("sub-type 1, on the slope side: nothing while it is above the "
            + "plane", t.settled === 0 && G.g_owl_ground_rings.length === 0,
            `${o.pos.y} ${under}`);
      o.pos.y = under + 0.01;
      t.vy = 0;
      step();
      const r = G.g_owl_ground_rings[0];
      check("...and under it, a ring a unit below the corpse, pitched "
            + "0x1000, and the thud",
            t.settled === 1 && r?.y === o.pos.y - 1 && r.pitch === 0x1000
            && r.yaw === 0xdc00 && sounds.join() === `${BOBBLE},${THUD}`,
            `${t.settled} ${JSON.stringify(r)} ${sounds}`);
    }

    // Sub-type 2: an eight-step stair in a box, and a floor at -36.
    {
      // z -1107.9 is step n = 2 of `-1098.7 - 3.7666 (n + 1)`: -26.
      const { o, t, step } = corpse(2, -1120, -25.99, -1108, 0.2, 0, 0.1);
      step();
      check("sub-type 2, on a step in its box: onto it, x-0.5 on all three, "
            + "0x600 on the spin, and the thud",
            o.pos.y === -26 && t.vy === -GRAV * -0.5 && t.vx === 0.2 * -0.5
            && t.vz === 0.1 * -0.5 && t.bounced === 1
            && t.spin === -729 + 0x600 && t.settled === 0
            && sounds.join() === `${THUD}`,
            `${o.pos.y} ${t.vy} ${t.vx} ${t.vz} ${t.spin} ${sounds}`);
      o.pos.y = -25.99;
      t.vy = 0; t.vx = 0.2; t.vz = 0.1;
      sounds.length = 0;
      step();
      check("...and the second time only its fall is turned: nothing "
            + "across, no thud",
            o.pos.y === -26 && t.vy === -GRAV * -0.5 && t.vx === 0.2
            && t.vz === 0.1 && sounds.length === 0,
            `${o.pos.y} ${t.vx} ${t.vz} ${sounds}`);
    }
    {
      const { o, t, step } = corpse(2, -1100, -35.99, -1100);
      o.yaw = 0x2345;
      step();
      const r = G.g_owl_ground_rings[0];
      check("sub-type 2 lands at -36 outside its box, with a ring at -35.98",
            o.pos.y === -36 && t.settled === 1
            && r?.y === Math.fround(-35.98) && r.yaw === 0x2345
            && r.pitch === 0 && sounds.join() === `${BOBBLE},${THUD}`,
            `${o.pos.y} ${JSON.stringify(r)} ${sounds}`);
    }

    // Sub-type 3: water.
    {
      const { o, t, step } = corpse(3, 10, -24.99, 20, 0.1, 0, 0);
      step();
      const s = G.g_owl_water_splashes[0];
      check("sub-type 3 meets the water at -25: the splash at its x and z, "
            + "SIBUKI8, and no ring",
            t.settled === 1 && s?.x === o.pos.x && s.z === o.pos.z
            && s.y === -25 && G.g_owl_ground_rings.length === 0
            && sounds.join() === `${SIBUKI}`,
            `${t.settled} ${JSON.stringify(s)} ${sounds}`);
      check("...and is not stopped at the surface",
            o.pos.y === -24.99 - GRAV, `${o.pos.y}`);
      const y1 = o.pos.y;
      step();
      check("...it sinks on through it", o.pos.y === y1 - Math.fround(0.03),
            `${o.pos.y}`);
      OwlEffectsTick(rng);
      check("...and the splash it made runs",
            G.g_owl_water_splashes.length === 1
            && G.g_owl_water_splashes[0].shown === 0,
            `${G.g_owl_water_splashes.length}`);
    }
  }

  {
    // The rest of the death path.
    const rng = new Rng(73);
    const events = scene(0, rng);
    G.g_players_in_play = 2;

    // A bullet on a sub-type-0 owl before frame 682 is kept: nothing in the
    // class clears `obj+0x34` bit 3, so the owl dies the frame the guard lifts.
    const o = ActorSpawn(0xa500, SpawnClass.FlyingEnemy, -1, "owl", {
      pos: vec3(0, 0, 40), class43: { subtype: 0, member: 0 },
    }, rng);
    const t = () => (o as { owl: OwlTail }).owl;
    G.g_cam_path_frame = 100;
    o.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
    OwlUpdateAndResolveShot(o, frame(rng, events));
    check("an early bullet on a sub-type-0 owl is kept",
          t().state !== OwlState.Dead && (o.flags & ActorFlag.Hit) !== 0,
          `${OwlState[t().state]} 0x${o.flags.toString(16)}`);
    G.g_cam_path_frame = 700;
    OwlUpdateAndResolveShot(o, frame(rng, events));
    check("...and kills it the frame 682 is passed, with no second shot",
          t().state === OwlState.Dead, OwlState[t().state]);

    // The shot test: every frame alive, the death frame too, never a corpse.
    const p = ActorSpawn(0xa501, SpawnClass.FlyingEnemy, -1, "owl", {
      pos: vec3(3, 4, 40), class43: { subtype: 1, member: 1 },
    }, rng);
    G.g_shot_test_list = [];
    OwlUpdateAndResolveShot(p, frame(rng, events));
    check("a live owl files itself for the shot test, at its own point",
          G.g_shot_test_list.some((e) => e.at === p.at)
          && p.shotCentre.x === p.pos.x && p.shotCentre.y === p.pos.y
          && p.shotCentre.z === p.pos.z,
          `${G.g_shot_test_list.length}`);
    G.g_shot_test_list = [];
    p.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer1;
    OwlUpdateAndResolveShot(p, frame(rng, events));
    check("...on the frame it dies as well",
          (p as { owl: OwlTail }).owl.state === OwlState.Dead
          && G.g_shot_test_list.some((e) => e.at === p.at),
          `${G.g_shot_test_list.length}`);
    G.g_shot_test_list = [];
    OwlUpdateAndResolveShot(p, frame(rng, events));
    check("...and never as a corpse",
          !G.g_shot_test_list.some((e) => e.at === p.at),
          `${G.g_shot_test_list.length}`);

    // A despawned corpse gives nothing back: the death block already did,
    // and the token it would match on is another group's.
    G.g_class43_attack_token = 1;
    const alive = G.g_enemies_alive;
    const present = G.g_enemies_present;
    ActorDespawn(p);
    ActorDeadSweep(p, DeadSweep.Despawned);
    check("a despawned owl corpse frees no token and retires nothing twice",
          G.g_class43_attack_token === 1 && G.g_enemies_alive === alive
          && G.g_enemies_present === present,
          `${G.g_class43_attack_token} ${G.g_enemies_alive}/`
          + `${G.g_enemies_present}`);

    // The yaw's error runs -0x7FFF..+0x8000: a heading straight behind turns
    // the positive way. The death frame steers on the owl's own motion,
    // which standing still is heading 0.
    const q = ActorSpawn(0xa502, SpawnClass.FlyingEnemy, -1, "owl", {
      pos: vec3(0, 0, 40), class43: { subtype: 1, member: 2 },
    }, rng);
    const qt = (q as { owl: OwlTail }).owl;
    qt.prevX = q.pos.x;
    qt.prevZ = q.pos.z;
    q.yaw = 0x8000;
    q.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
    OwlUpdateAndResolveShot(q, frame(rng, events));
    check("an owl turning to a heading exactly behind turns the positive way",
          qt.state === OwlState.Dead && q.yaw === 0x8000 + 3276, `${q.yaw}`);

    // The throw: `g_camera_block_yaw_bams + 0x8000`. The block's yaw faces
    // back at the viewer -- `g_camera_yaw_bams` is it turned half round -- so
    // a camera looking down -z throws the corpse on down -z, away from it.
    G.g_camera_block_yaw_bams = 0;
    G.g_camera_yaw_bams = 0x8000;
    const r = ActorSpawn(0xa503, SpawnClass.FlyingEnemy, -1, "owl", {
      pos: vec3(0, 0, -40), class43: { subtype: 1, member: 3 },
    }, rng);
    const rt = (r as { owl: OwlTail }).owl;
    rt.vx = 0; rt.vy = 0; rt.vz = 0;
    r.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
    OwlUpdateAndResolveShot(r, frame(rng, events));
    check("a shot owl is thrown away from the camera, along the block's yaw "
          + "turned half round",
          rt.state === OwlState.Dead && Math.abs(rt.vx) < 1e-9
          && Math.abs(rt.vz + 1) < 1e-9,
          `${rt.vx} ${rt.vz}`);

    // The two-player aim offset: the owl's horizontal distance from the
    // block's eye, truncated, over sixty, a quarter turn off the block's yaw
    // -- 0xC000 for player 0, 0x4000 for player 1.
    G.g_players_in_play = 2;
    G.g_camera_block_eye.x = 0;
    G.g_camera_block_eye.y = 0;
    G.g_camera_block_eye.z = 0;
    const s = ActorSpawn(0xa504, SpawnClass.FlyingEnemy, -1, "owl", {
      pos: vec3(30.5, 7, 40.2), class43: { subtype: 3, member: 3 },
    }, rng);
    const st = (s as { owl: OwlTail }).owl;
    const sides = new Set<number>();
    for (let i = 0; i < 8; i += 1) {
      OwlPickTargetPlayerAndAimOffset(s, st, rng);
      const want = 50 * Math.fround(1 / 60) * (s.attackPermit === 0 ? -1 : 1);
      sides.add(s.attackPermit);
      check(`the two-player aim offset for player ${s.attackPermit} is the `
            + "distance over sixty, a quarter turn off the block's yaw",
            Math.abs(st.aimX - want) < 1e-9 && Math.abs(st.aimZ) < 1e-9,
            `${st.aimX} ${st.aimZ} want ${want}`);
    }
    check("...and both players are drawn", sides.size === 2,
          `${[...sides]}`);
  }

  {
    // A fish shot above the water, flung, and falling back in: the ring task
    // on the water, the splash, and on the next frame the two surface rings.
    const rng = new Rng(67);
    const events = scene(0, rng);
    G.g_water_level = -10;
    const f = ActorSpawn(0x9d00, SpawnClass.WaterEnemy, -1, "fish", {
      pos: vec3(0, 0, 30),
      class51: {
        water_level: 0.3, speed_x: 0.3, speed_z: 0.3, bob_amplitude: 4,
        entry_mode: 0, subtype: 0, rise_frames: 30, bob_cycles: 1,
        lunge_frames: 40,
      },
    }, rng);
    const ft = (f as { fish: FishTail }).fish;
    f.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
    FishUpdate(f, frame(rng, events));
    check("a shot fish leaves a blood cloud", G.g_fish_blood_clouds.length === 1,
          `${G.g_fish_blood_clouds.length}`);
    let n = 0;
    while (ft.state === FishState.Flung && n < 600) {
      FishUpdate(f, frame(rng, events));
      n += 1;
    }
    check("...and a flung one meeting the water makes the ring task there",
          ft.state === FishState.Sink && G.g_ring_effects.length === 1
          && Math.abs(G.g_ring_effects[0].y - (-10 + 0.02 + 0.05)) < 1e-9
          && G.g_ring_effects[0].scale === 0.8,
          `${FishState[ft.state]} ${G.g_ring_effects.length}`);
    check("...with the splash, and no surface ring yet",
          G.g_fish_water_splashes.length === 1
          && G.g_fish_water_splashes[0].y === -10 - 0.4
          && G.g_fish_surface_rings.length === 0,
          `${G.g_fish_water_splashes.length} ${G.g_fish_surface_rings.length}`);
    check("...its corpse turned by half a turn at most",
          ft.yaw >= 0 && ft.yaw < 0x8000, `${ft.yaw}`);
    // `FishStateSink` tests its timer for 1 **before** stepping it, and the
    // frame that entered the state left it at 0.
    FishUpdate(f, frame(rng, events));
    check("...nor on the sinking corpse's first frame",
          G.g_fish_surface_rings.length === 0,
          `${G.g_fish_surface_rings.length}`);
    FishUpdate(f, frame(rng, events));
    check("the sinking corpse's second frame makes the two surface rings",
          G.g_fish_surface_rings.length === 2
          && G.g_fish_surface_rings[0].scale === 0.6
          && G.g_fish_surface_rings[1].scale === 0.3,
          G.g_fish_surface_rings.map((r) => r.scale).join(","));
  }

  {
    // Shot under the water: the splash, and the ring task -- never the
    // surface ring -- in the same update; and every corpse's yaw is half a
    // turn at most, sixteen deaths over.
    const rng = new Rng(71);
    scene(0, rng);
    G.g_water_level = -10;
    const yaws: number[] = [];
    for (let i = 0; i < 16; i += 1) {
      const f = ActorSpawn(0x9e00 + i, SpawnClass.WaterEnemy, -1, "fish", {
        pos: vec3(i, -20, 30),
        class51: {
          water_level: 0.3, speed_x: 0.3, speed_z: 0.3, bob_amplitude: 4,
          entry_mode: 0, subtype: 0, rise_frames: 30, bob_cycles: 1,
          lunge_frames: 40,
        },
      }, rng);
      const ft = (f as { fish: FishTail }).fish;
      ft.flags |= FishFlag.Submerged;
      f.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
      FishUpdate(f, frame(rng));
      yaws.push(ft.yaw);
    }
    check("a fish shot under water makes the ring task and the splash",
          G.g_ring_effects.length === 16 && G.g_fish_water_splashes.length === 16
          && G.g_fish_surface_rings.length === 0,
          `${G.g_ring_effects.length} ${G.g_fish_water_splashes.length} `
          + `${G.g_fish_surface_rings.length}`);
    check("...its corpse's yaw drawn from rand() & 0xFFFF, which is half a turn",
          yaws.every((y) => y >= 0 && y < 0x8000), yaws.join(","));

    // Every one of the tasks ends, and each after exactly its own run: the
    // tick that finds a finished task is the one that drops it.
    const clouds = G.g_fish_blood_clouds.length;
    const splash = G.g_fish_water_splashes[0];
    const shown: number[] = [];
    let cloudGone = -1;
    let splashGone = -1;
    for (let k = 1; k <= 100; k += 1) {
      FishEffectsTick();
      if (G.g_fish_water_splashes.includes(splash)) shown.push(splash.shown);
      if (cloudGone < 0 && !G.g_fish_blood_clouds.length) cloudGone = k;
      if (splashGone < 0 && !G.g_fish_water_splashes.length) splashGone = k;
    }
    check("the fish's splash draws 0x1339..0x1356 once each and goes",
          shown.length === 30 && shown[0] === 0x1339
          && shown[29] === FISH_SPLASH_LAST_SLOT && splashGone === 31,
          `${shown.length} ${splashGone}`);
    check("...the blood cloud its twenty-five cels",
          clouds === 16 && cloudGone === 26, `${clouds} ${cloudGone}`);
    let ringGone = -1;
    for (let k = 1; k <= 1000 && ringGone < 0; k += 1) {
      RingEffectsTick();
      if (!G.g_ring_effects.length) ringGone = k;
    }
    check("...and the ring task spreads, holds and fades out in 189 draws",
          ringGone === RING_EFFECT_SPREAD_FRAMES + 30 + 40, `${ringGone}`);
  }

  {
    // The surface ring and the blood cloud, stepped by hand.
    const rng = new Rng(73);
    scene(0, rng);
    G.g_water_level = 0;
    const o = ActorSpawn(0x9f00, SpawnClass.WaterEnemy, -1, "fish", {
      pos: vec3(0, 0, 30),
      class51: {
        water_level: 0.3, speed_x: 0.3, speed_z: 0.3, bob_amplitude: 4,
        entry_mode: 0, subtype: 0, rise_frames: 30, bob_cycles: 1,
        lunge_frames: 40,
      },
    }, rng);
    // FishSpawnSurfaceRing through the sink's own first frame.
    const ft = (o as { fish: FishTail }).fish;
    ft.state = FishState.Sink;
    ft.timer = 1;
    FishUpdate(o, frame(rng));
    const ring = G.g_fish_surface_rings[0];
    const alphas: number[] = [];
    for (let i = 0; i < 100 && G.g_fish_surface_rings.includes(ring); i += 1) {
      FishEffectsTick();
      if (G.g_fish_surface_rings.includes(ring)) alphas.push(ring.shownAlpha);
    }
    check("a surface ring fades over sixty frames, widening, and goes",
          alphas.length === 60 && alphas[0] === 1
          && Math.abs(alphas[59] - 1 / 60) < 1e-6
          && Math.abs(ring.shownScale - (0.6 + 59 * 0.02)) < 1e-6,
          `${alphas.length} ${alphas[59]} ${ring.shownScale}`);

    const c: FishBloodCloud = {
      id: 0, pos: vec3(), slot: 0x3a, shown: 0x3a, done: false,
    };
    let draws = 0;
    while (BloodCloudTickInScreenSpace(c) && draws < 100) draws += 1;
    check("a blood cloud draws 0x3A..0x52 and is killed after the last",
          draws === 25 && c.shown === FISH_BLOOD_LAST_SLOT, `${draws}`);

    SpawnRingEffectAtPose({ x: 0, y: 0, z: 0, yaw: 0 }, 1);
    const re = G.g_ring_effects[G.g_ring_effects.length - 1];
    RingEffectsTick();
    check("the ring task's first frame has four strips spread about it",
          re.phase === RingEffectPhase.Spread && re.drawnStrips.length === 4
          && re.drawnStrips[0].x > 1.9 && re.drawnStrips[0].z > 3.9
          && re.drawnStrips[3].x < -1.9 && re.drawnStrips[3].z < -3.9
          && re.drawnRing < 0.1,
          JSON.stringify(re.drawnStrips));
  }

  // -- class 0x46, the bat --------------------------------------------------
  //
  // Every bat in the game is placed at the world origin, so nothing about a
  // flight can be checked against a descriptor: the position, the stagger and
  // the whole path come out of `BAT_SPLINE_POINTS`. These drive the three
  // sub-types against that table and against the two counters.
  const bat = (o: Actor) => (o as { bat: BatTail }).bat;
  const mkBat = (at: number, subtype: number, group: number, member: number,
                 rng: Rng, pos = vec3(0, 0, 0)) =>
    ActorSpawn(at, SpawnClass.Bat, BAT_CHAR_TYPE, "bat", {
      pos, yaw: 0x8000, class46: { subtype, group, member },
    }, rng);

  {
    // Stage 4 block 0 step 6's six descriptors, exactly as they ship: group 0,
    // `+0x11C` 1..6. A one-player game builds four of them.
    const rng = new Rng(53);
    scene(0, rng);
    G.g_players_in_play = 1;
    const six = [0, 1, 2, 3, 4, 5].map((m) => mkBat(0x9b00 + m, 0, 0, m, rng));
    check("one player faces four of the six bats in a flight",
          six.slice(0, 4).every((o) => !o.despawned)
          && six.slice(4).every((o) => o.despawned),
          six.map((o) => (o.despawned ? "-" : "+")).join(""));
    check("...and only those four are in the counters",
          G.g_enemies_alive === 4 && G.g_enemies_present === 4,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
    // `BatSplineWeights(0, 0)` is `(0.5, 0.5, 0)`, so a bat starts at the
    // midpoint of the first two control points and not at the first.
    const row = BAT_SPLINE_POINTS[0];
    check("a bat starts at the midpoint of p0 and p1, not at p0",
          Math.abs(six[0].pos.x - (row[0][0] + row[1][0]) / 2) < 1e-3
          && Math.abs(six[0].pos.z - (row[0][2] + row[1][2]) / 2) < 1e-3,
          `${six[0].pos.x.toFixed(2)},${six[0].pos.z.toFixed(2)}`);
    check("...and members 0 and 3 share a path, two apiece per flight",
          bat(six[0]).group === bat(six[3]).group
          && six[0].pos.x === six[3].pos.x && six[0].pos.z === six[3].pos.z,
          `${six[0].pos.x} vs ${six[3].pos.x}`);
    // `obj+0x64/0x68 = placer+0x64/0x68; obj+0x6C = 0`, after the heading
    // seed: the member faces the descriptor's way until its spline turns it.
    check("...and each faces its descriptor's yaw, not zero, while it waits",
          six[1].yaw === 0x8000 && six[1].pitch === 0 && six[1].roll === 0,
          `${six[1].yaw.toString(16)}`);
    // Twenty frames apart. Member 0 leaves on its first update; member 1 is
    // still waiting twenty updates later.
    BatDiveUpdate(six[0], frame(rng));
    check("member 0 launches on its first frame",
          bat(six[0]).state === BatState.Fly, BatState[bat(six[0]).state]);
    for (let i = 0; i < 20; i += 1) BatDiveUpdate(six[1], frame(rng));
    check("...and member 1 is still waiting twenty frames later",
          bat(six[1]).state === BatState.Wait, BatState[bat(six[1]).state]);
    BatDiveUpdate(six[1], frame(rng));
    check("...and leaves on the twenty-first",
          bat(six[1]).state === BatState.Fly, BatState[bat(six[1]).state]);
  }

  {
    // Two players get all six, which is the only thing the guard does.
    const rng = new Rng(59);
    scene(0, rng);
    G.g_players_in_play = 2;
    const six = [0, 1, 2, 3, 4, 5].map((m) => mkBat(0x9c00 + m, 0, 0, m, rng));
    check("two players face all six", six.every((o) => !o.despawned));
    check("...and all six are counted",
          G.g_enemies_alive === 6 && G.g_enemies_present === 6,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
  }

  {
    // The hit gate. A diving bat cannot die during its launch delay -- the
    // engine tests `state != 2 && state != 0` -- but **only the arm that takes
    // a hit clears bit 3** (`AND AL, 0xF7` at `0x0042E2A5`), so a shot that
    // lands while it waits is still standing when it launches, and the same
    // gate takes it on its first flying frame.
    const rng = new Rng(61);
    scene(0, rng);
    G.g_players_in_play = 1;
    G.g_active_player = 0;
    const o = mkBat(0x9d00, 0, 0, 2, rng);
    o.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
    BatUpdate(o, frame(rng));
    check("a bat cannot be shot during its launch delay",
          bat(o).state === BatState.Wait, BatState[bat(o).state]);
    check("...and is still in both counters",
          G.g_enemies_alive === 1 && G.g_enemies_present === 1,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
    check("...but the hit is not dropped: bit 3 is still up",
          (o.flags & ActorFlag.Hit) !== 0, o.flags.toString(16));
    for (let i = 0; i < 40; i += 1) BatUpdate(o, frame(rng));
    check("...it launches when its stagger is up, the hit still pending",
          bat(o).state === BatState.Fly && (o.flags & ActorFlag.Hit) !== 0,
          `${BatState[bat(o).state]} ${o.flags.toString(16)}`);
    const score = G.g_player_score[0];
    BatUpdate(o, frame(rng));
    check("...and the pending hit kills it on its first flying frame, for 80",
          bat(o).state === BatState.Dead
          && G.g_player_score[0] - score === 80
          && (o.flags & ActorFlag.Hit) === 0,
          `${BatState[bat(o).state]} +${G.g_player_score[0] - score}`);
    check("...dropping both counters on the hit, not on the corpse",
          G.g_enemies_alive === 0 && G.g_enemies_present === 0,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
    for (let i = 0; i < 0x51; i += 1) BatUpdate(o, frame(rng));
    check("...and the corpse lasts eighty frames", o.despawned,
          `${o.despawned}`);

    // ...and one that nobody shot while it waited dies to its first bullet.
    const p = mkBat(0x9d40, 0, 0, 0, rng);
    BatUpdate(p, frame(rng));
    const before = G.g_player_score[0];
    p.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
    BatUpdate(p, frame(rng));
    check("a flying bat dies to one bullet, for 80",
          bat(p).state === BatState.Dead
          && G.g_player_score[0] - before === 80,
          `${BatState[bat(p).state]} +${G.g_player_score[0] - before}`);
  }

  {
    // **An unshot bat always connects, and always leaves.** There is no range
    // test and no attack permit anywhere in the class, so the only thing that
    // ends a flight is arriving -- which is why `wait_enemies_present 0`
    // behind one cannot deadlock.
    const rng = new Rng(67);
    scene(0, rng);
    G.g_active_player = 0;
    G.g_camera_block_eye = vec3(100, -10, -140);
    const o = mkBat(0x9e00, 0, 0, 0, rng);
    const lives = G.g_player_lives[0];
    let frames = 0;
    for (; frames < 400 && !o.despawned; frames += 1) {
      BatUpdate(o, frame(rng));
    }
    check("a bat left alone reaches the camera and takes a life",
          o.despawned && G.g_player_lives[0] === lives - 1,
          `${frames} frames, lives ${lives} -> ${G.g_player_lives[0]}`);
    check("...in about 110 frames: forty of spline and sixty-seven of homing",
          frames > 100 && frames < 125, `${frames}`);
    check("...and gives both counters back, so the room clears",
          G.g_enemies_alive === 0 && G.g_enemies_present === 0,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
  }

  {
    // **The same flight, with nothing set by hand.** The strike's
    // only gate is `g_player_state == 5` for either player (`0x0042E88A`,
    // `0x0042F1B5`), and the page never set it -- the test above did, so it
    // passed while every bat in the page arrived and did nothing. The reset is
    // what the page runs, and it has to leave player 0 in play.
    const rng = new Rng(68);
    scene(0, rng);
    G.g_camera_block_eye = vec3(100, -10, -140);
    check("the stage starts with player 0 in play and player 1 out",
          G.g_player_state[0] === PlayerState.InPlay
          && G.g_player_state[1] === PlayerState.Out,
          `${G.g_player_state}`);
    const dive = mkBat(0x9e40, 0, 0, 0, rng);
    const lives = G.g_player_lives[0];
    for (let i = 0; i < 400 && !dive.despawned; i += 1) {
      BatUpdate(dive, frame(rng));
    }
    check("a diving bat that reaches the camera takes a life off the reset "
          + "state", dive.despawned && G.g_player_lives[0] === lives - 1
          && G.g_player_was_hit[0] === 1 && G.g_player_damage_overlay_kind[0] === 9,
          `lives ${lives} -> ${G.g_player_lives[0]}, `
          + `hit ${G.g_player_was_hit[0]}/${G.g_player_damage_overlay_kind[0]}`);

    // ...and so does the swarm's, through the same strike.
    // Out of the invulnerability window, and above the port's floor of one.
    RunOutInvulnerability();
    mkBat(0x9e80, 2, 0, 0, rng, vec3(90, -10, -120));
    const swarm = G.g_object_list.filter(
      (a) => a.cls === SpawnClass.Bat && !a.despawned && !bat(a).isWing
        && bat(a).subtype === 2);
    const before = G.g_player_lives[0];
    const first = swarm[0];
    for (let i = 0; i < 400 && !first.despawned; i += 1) {
      BatUpdate(first, frame(rng));
    }
    check("...and a swarm bat that reaches it takes one too",
          first.despawned && G.g_player_lives[0] === before - 1,
          `lives ${before} -> ${G.g_player_lives[0]}`);
  }

  {
    // Sub-type 2 is **six with one player and eight with two**, which reads
    // the other way round in the decompiler:
    // `((1 < g_players_in_play) - 1 & 0xFFFFFFFE) + 8`.
    const rng = new Rng(71);
    scene(0, rng);
    G.g_players_in_play = 1;
    mkBat(0x9f00, 2, 0, 0, rng, vec3(-295.7, 53.4, -673));
    const one = G.g_object_list.filter(
      (a) => a.cls === SpawnClass.Bat && !a.despawned && !bat(a).isWing).length;
    check("a swarm is six bats with one player", one === 6, `${one}`);
    check("...and all six are counted",
          G.g_enemies_alive === 6 && G.g_enemies_present === 6,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);

    const rng2 = new Rng(73);
    scene(0, rng2);
    G.g_players_in_play = 2;
    mkBat(0x9f80, 2, 0, 0, rng2, vec3(-295.7, 53.4, -673));
    const two = G.g_object_list.filter(
      (a) => a.cls === SpawnClass.Bat && !a.despawned && !bat(a).isWing).length;
    check("...and eight with two", two === 8, `${two}`);
  }

  {
    // ...and unlike sub-type 0 it can be shot while it is still orbiting: its
    // gate is `state != 2` alone. Two routines, one comparison apart -- `L11`
    // in the shape it actually takes.
    const rng = new Rng(79);
    scene(0, rng);
    G.g_players_in_play = 1;
    mkBat(0xa000, 2, 0, 0, rng, vec3(0, 0, -40));
    const member = G.g_object_list.find(
      (a) => a.cls === SpawnClass.Bat && !a.despawned && !bat(a).isWing)!;
    check("a swarm member starts in the orbit",
          bat(member).state === BatState.Wait,
          BatState[bat(member).state]);
    const score = G.g_player_score[0];
    member.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
    BatUpdate(member, frame(rng));
    check("...and is killable there, where a diving bat is not",
          bat(member).state === BatState.Dead
          && G.g_player_score[0] - score === 80,
          `${BatState[bat(member).state]} +${G.g_player_score[0] - score}`);
  }

  {
    // Sub-type 1 is twenty-five bats that **touch neither counter**, so no
    // `wait_enemies` gate can see one. They still score.
    const rng = new Rng(83);
    scene(0, rng);
    G.g_players_in_play = 1;
    mkBat(0xa100, 1, 0, 0, rng, vec3(-407, -10, -3688));
    const members = G.g_object_list.filter(
      (a) => a.cls === SpawnClass.Bat && !a.despawned && !bat(a).isWing);
    check("a scatter is twenty-five bats", members.length === 25,
          `${members.length}`);
    check("...and none of them is in either counter",
          G.g_enemies_alive === 0 && G.g_enemies_present === 0,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
    const one = members[0];
    for (let i = 0; i < 4; i += 1) BatUpdate(one, frame(rng));
    check("...member 0 is flying after its two-frame stagger",
          bat(one).state === BatState.Fly, BatState[bat(one).state]);
    const score = G.g_player_score[0];
    one.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
    BatUpdate(one, frame(rng));
    check("...a shot one still pays 80 and drops no counter",
          bat(one).state === BatState.Dead
          && G.g_player_score[0] - score === 80
          && G.g_enemies_alive === 0,
          `${BatState[bat(one).state]} +${G.g_player_score[0] - score}`);
  }

  {
    // **The blood is at the bat's view-space point, not at its position.**
    // All three routines call `SpawnBloodSprayAtPoint(obj + 0x40)`, which
    // reads `obj+0x70`: the view of `(x, y + 1, z)` each tail registered last
    // frame. A camera that turns a quarter about y and moves (L48), so a world
    // point handed over as it stands, or the position without its lift, lands
    // somewhere else.
    const view = (p: Vec3, out: Vec3) => {
      out.x = p.z + 5; out.y = p.y - 3; out.z = -p.x - 20;
    };
    const host: GameHost = {
      ...HOST,
      viewSpaceOfPoint: (p, out) => { view(p, out); return true; },
    };
    const fr = (rng: Rng): ClassFrame => ({ ...frame(rng), host });
    const shoot = (o: Actor, rng: Rng, label: string) => {
      // The point the last update registered, taken from the position the
      // update left and not from the port's own field.
      const want = vec3();
      view(vec3(o.pos.x, o.pos.y + 1, o.pos.z), want);
      const blood = G.g_point_blood_sprays.length;
      o.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
      BatUpdate(o, fr(rng));
      const got = G.g_point_blood_sprays[blood]?.pos;
      check(`a shot ${label} bat bleeds at its view-space point, lifted by one`,
            bat(o).state === BatState.Dead
            && G.g_point_blood_sprays.length === blood + 1 && !!got
            && Math.abs(got.x - want.x) < 1e-9
            && Math.abs(got.y - want.y) < 1e-9
            && Math.abs(got.z - want.z) < 1e-9,
            `${BatState[bat(o).state]} want ${JSON.stringify(want)} `
            + `got ${JSON.stringify(got)}`);
    };

    const rng = new Rng(101);
    scene(0, rng);
    G.g_players_in_play = 1;
    const dive = mkBat(0xa140, 0, 0, 0, rng);
    for (let i = 0; i < 12; i += 1) BatUpdate(dive, fr(rng));
    shoot(dive, rng, "diving");

    mkBat(0xa180, 2, 0, 0, rng, vec3(30, 5, -60));
    const swarm = G.g_object_list.find(
      (a) => a.cls === SpawnClass.Bat && !a.despawned && !bat(a).isWing
        && bat(a).subtype === 2)!;
    for (let i = 0; i < 3; i += 1) BatUpdate(swarm, fr(rng));
    shoot(swarm, rng, "swarm");

    mkBat(0xa1c0, 1, 0, 0, rng, vec3(-407, -10, -3688));
    const scatter = G.g_object_list.find(
      (a) => a.cls === SpawnClass.Bat && !a.despawned && !bat(a).isWing
        && bat(a).subtype === 1)!;
    for (let i = 0; i < 4; i += 1) BatUpdate(scatter, fr(rng));
    check("...the scatter member is flying, the one arm that registers",
          bat(scatter).state === BatState.Fly, BatState[bat(scatter).state]);
    shoot(scatter, rng, "scattering");
  }

  {
    // The wings are a **second actor**, and `g_bat_members` is the whole of
    // how they find their body and how they learn it has gone.
    const rng = new Rng(89);
    scene(0, rng);
    G.g_players_in_play = 1;
    const o = mkBat(0xa200, 0, 0, 0, rng);
    const wing = G.g_object_list.find(
      (a) => a.cls === SpawnClass.Bat && bat(a).isWing);
    check("every bat is built with a wing actor", !!wing && !wing.despawned);
    check("...of character type 0x1F, on its own clip",
          wing!.charType === BAT_WING_CHAR_TYPE && wing!.motion === 0x406,
          `${wing!.charType.toString(16)} clip ${wing!.motion.toString(16)}`);
    check("...at its body's address with bit 30 set",
          wing!.at === BatWingAt(o.at) && wing!.at === (0xa200 | 0x40000000),
          wing!.at.toString(16));
    // The body leaves; the wing reads an empty slot and goes on the next frame.
    ActorDespawn(o);
    G.g_bat_members[bat(o).subtype * 0x19 + bat(o).member] = 0;
    BatUpdate(wing!, frame(rng));
    check("...and despawns the frame its body's slot goes empty",
          wing!.despawned, `${wing!.despawned}`);
  }

  {
    // **The seat is the body's node matrix, not its yaw.** `BatWingUpdate`
    // multiplies `body+0x2C4` -- node 1's draw record -- and translates
    // `(0, 1, 2)` in it, so the offset is turned by the clip's root record,
    // lifted by its root height and shrunk by the model's 0.6 before the
    // body's own yaw turns it. A clip whose root record is a plain half-turn
    // about y and whose root height is -0.5, a body at a quarter turn (L48):
    //
    //   Ry(0x8000) (0, 1, 2)  = (0, 1, -2)
    //   T(0, -0.5, 0)         = (0, 0.5, -2)
    //   S(0.6)                = (0, 0.3, -1.2)
    //   Ry(0x4000)            = (-1.2, 0.3, 0)     x' = x cos + z sin
    //   + (10, -5, -100)      = (8.8, -4.7, -100)
    //
    // The first cut took `(0, 1, 2)` in the yaw alone -- (12, -4, -100) -- which
    // for the real clip put the wings four units off, on the wrong side.
    const rng = new Rng(97);
    const SEAT_CLIP = { bank: "t", frames: 1, fps: 30, root: [0, -0.5, 0],
                        rot: [0, 0x8000, 0, 0, 0, 0] };
    const BAT_T = { ...TYPE, type: BAT_CHAR_TYPE, name: "zabat",
      bone_count: 2,
      bones: [{ bone: 1, part: "bone01_1b01", slot: 0x1b01,
                offset: [0, 0, 0], parent: null, steps: [] }],
      motions: { [String(BAT_CLIP)]: SEAT_CLIP } } as unknown as CharacterType;
    const WING_T = { ...BAT_T, type: BAT_WING_CHAR_TYPE, name: "zabat_wing",
      motions: { [String(BAT_WING_CLIP)]: SEAT_CLIP } } as unknown as
      CharacterType;
    ResetGameGlobals();
    SetGameTables({ ...CHARS, types: { ...CHARS.types,
      [String(BAT_CHAR_TYPE)]: BAT_T, [String(BAT_WING_CHAR_TYPE)]: WING_T },
    } as CharactersJson);
    G.g_players_in_play = 1;
    const o = mkBat(0xa240, 0, 0, 0, rng);
    const wing = G.g_object_list.find(
      (a) => a.cls === SpawnClass.Bat && bat(a).isWing)!;
    o.pos = vec3(10, -5, -100);
    o.yaw = 0x4000;
    o.pitch = 0;
    BatUpdate(wing, frame(rng));
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;
    check("a wing sits on its body's node: (0, 1, 2) through the clip's root "
          + "record, its height and the 0.6 model scale",
          near(wing.pos.x, 8.8) && near(wing.pos.y, -4.7)
          && near(wing.pos.z, -100),
          `${wing.pos.x.toFixed(3)},${wing.pos.y.toFixed(3)},`
          + `${wing.pos.z.toFixed(3)}`);
    check("...turned half round from its body and pitched 0xE800",
          wing.yaw === 0x4000 + 0x8000 && wing.pitch === BAT_WING_PITCH,
          `${wing.yaw.toString(16)} ${wing.pitch.toString(16)}`);
    check("...on its body's motion clock",
          wing.playTicks === o.playTicks, `${wing.playTicks} ${o.playTicks}`);

    // The bob the swarm dives with is the dive's 5.0 -- `FMUL [0x0055D2B4]` at
    // `0x0042F035` -- and not the orbit's 8.0.
    mkBat(0xa280, 2, 0, 0, rng, vec3(0, 0, -40));
    const m = G.g_object_list.find((a) => a.cls === SpawnClass.Bat
      && !bat(a).isWing && bat(a).subtype === 2)!;
    bat(m).timer = 0;
    BatUpdate(m, frame(rng));
    check("a swarm member whose orbit has run out turns to dive",
          bat(m).state === BatState.Fly, BatState[bat(m).state]);
    const fromY = bat(m).fromY;
    BatUpdate(m, frame(rng));
    check("...and dives bobbing by the clip's root height times 5, not 8",
          near(m.pos.y - fromY, -0.5 * BAT_DIVE_BOB_SCALE),
          `${(m.pos.y - fromY).toFixed(3)}`);
  }

  {
    // **A placer's members need an address each**, because the port keys both
    // the pool and the drawn hierarchy on one. The scatter has twenty-five,
    // and four bits of member index gave members 16..24 the addresses of
    // 0..8: two bats per row, and a wing seated on the wrong one.
    const rng = new Rng(101);
    scene(0, rng);
    G.g_players_in_play = 1;
    mkBat(0xa300, 1, 0, 0, rng, vec3(-407, -10, -3688));
    const bodies = G.g_object_list.filter(
      (a) => a.cls === SpawnClass.Bat && !bat(a).isWing && !a.despawned);
    const wings = G.g_object_list.filter(
      (a) => a.cls === SpawnClass.Bat && bat(a).isWing && !a.despawned);
    check("a scatter's twenty-five members answer to twenty-five addresses",
          bodies.length === 25 && new Set(bodies.map((a) => a.at)).size === 25,
          `${new Set(bodies.map((a) => a.at)).size}`);
    check("...and their wings to twenty-five more, none shared",
          new Set([...bodies, ...wings].map((a) => a.at)).size === 50,
          `${new Set([...bodies, ...wings].map((a) => a.at)).size}`);
    check("...each at BatChildAt(placer, 1, member)",
          bodies.every((a) => a.at === BatChildAt(0xa300, 1, bat(a).member)));
    // `obj+0x34 = 1`, the build raises `0x80`, then `& ~0x80 | 0x80000`.
    check("...with the engine's flag word, 0x80001, bit 0x80 taken back",
          bodies.every((a) => (a.flags & ~ActorFlag.NoCameraTrack)
                              === (BAT_FLAG_80000 | 1)),
          bodies[0].flags.toString(16));
    // `ActorBuildSkinnedModel` claims a hit slot for every member and every
    // wing, body then wing, and the fourteenth claim fills the table.
    const w0 = wings.find((a) => bat(a).member === 0)!;
    const b6 = bodies.find((a) => bat(a).member === 6)!;
    const b7 = bodies.find((a) => bat(a).member === 7)!;
    check("...and each claims a hit slot, body then wing, until the table fills",
          bodies[0].hitSlot === 0 && w0.hitSlot === 1 && b6.hitSlot === 12
          && b7.hitSlot === HIT_SLOT_NONE,
          `${bodies[0].hitSlot} ${w0.hitSlot} ${b6.hitSlot} ${b7.hitSlot}`);
  }

  {
    // **Who registers for the shot test, and when.** The dive and the swarm at
    // their tails in every state; the scatter only at the end of its flying
    // arm; the wing never. The engine's list is the whole of what a shot can
    // find (`ClassHandler.registersForShotTest`).
    const rng = new Rng(103);
    scene(0, rng);
    G.g_players_in_play = 1;
    G.g_active_player = 0;
    const listed = (a: Actor) => G.g_shot_test_list.some((e) => e.at === a.at);
    const dive = mkBat(0xa340, 0, 0, 3, rng);
    const wing = G.g_object_list.find((a) => a.at === BatWingAt(0xa340))!;
    ShotTestListReset();
    BatUpdate(dive, frame(rng));
    BatUpdate(wing, frame(rng));
    check("a waiting dive bat is in the shot test", listed(dive)
          && bat(dive).state === BatState.Wait);
    check("...its sphere a unit above it",
          dive.shotCentre.y === dive.pos.y + 1
          && dive.shotCentre.x === dive.pos.x,
          `${dive.shotCentre.y} vs ${dive.pos.y}`);
    check("...and the camera aims at its position, not at a bone",
          dive.lookAt.x === dive.pos.x && dive.lookAt.y === dive.pos.y
          && dive.lookAt.z === dive.pos.z);
    check("...and its wing never is", !listed(wing));

    mkBat(0xa380, 1, 0, 0, rng, vec3(-407, -10, -3688));
    const m0 = G.g_object_list.find((a) => a.at === BatChildAt(0xa380, 1, 0))!;
    ShotTestListReset();
    BatUpdate(m0, frame(rng));
    check("a scattering bat is no target while it waits",
          !listed(m0), BatState[bat(m0).state]);
    ShotTestListReset();
    BatUpdate(m0, frame(rng));
    check("...and is once it flies",
          listed(m0) && bat(m0).state === BatState.Fly);

    // The kill is taken inside the flying arm, and the arm carries on: the
    // damped velocity goes through the flight's own 1.05 and 1.08, and the
    // corpse's gravity starts on the next frame.
    const vx = bat(m0).vx, vy = bat(m0).vy, vz = bat(m0).vz;
    const y = m0.pos.y;
    m0.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
    ShotTestListReset();
    BatUpdate(m0, frame(rng));
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
    check("...a shot one dies inside its flying arm",
          bat(m0).state === BatState.Dead, BatState[bat(m0).state]);
    check("...and the kill frame is still a flying frame: x and z bounce by "
          + "-0.3 and accelerate, y climbs by 1.08",
          near(bat(m0).vx, vx * BAT_SCATTER_CORPSE_DAMP * BAT_SCATTER_ACCEL_XZ)
          && near(bat(m0).vz, vz * BAT_SCATTER_CORPSE_DAMP)
          && near(bat(m0).vy, vy * BAT_SCATTER_ACCEL_Y)
          && near(m0.pos.y, y + vy * BAT_SCATTER_ACCEL_Y),
          `vy ${bat(m0).vy} vs ${vy * BAT_SCATTER_ACCEL_Y}`);
    check("...registered for the shot test on that frame too", listed(m0));
    const vy1 = bat(m0).vy;
    ShotTestListReset();
    BatUpdate(m0, frame(rng));
    check("...and falling from the next, and no longer a target",
          near(bat(m0).vy, vy1 - BAT_SCATTER_CORPSE_GRAVITY) && !listed(m0),
          `${bat(m0).vy}`);
  }

  {
    // `SpawnBatSplash` (`FUN_0042F980`) and `BatSplashUpdate`
    // (`FUN_0042F930`): the caller's x and z, **y forced to -25**, thirty
    // models drawn once each, and gone.
    ResetGameGlobals();
    SpawnBatSplash(3, -40, 7);
    const s = G.g_bat_splashes[0];
    check("a splash sits on the water plane, whatever height it was given",
          !!s && s.x === 3 && s.y === BAT_SPLASH_Y && s.y === -25 && s.z === 7,
          `${s?.x},${s?.y},${s?.z}`);
    const drawn: number[] = [];
    for (let i = 0; i < 40 && G.g_bat_splashes.length; i += 1) {
      BatSplashesTick();
      if (G.g_bat_splashes.length) drawn.push(G.g_bat_splashes[0].drawn);
    }
    check("...draws its thirty models once each, the first first",
          drawn.length === BAT_SPLASH_LAST_FRAME + 1
          && drawn.every((d, i) => d === i), drawn.join(","));
    check("...and is gone on the tick after the thirtieth",
          G.g_bat_splashes.length === 0);
  }

  {
    // Both corpses that reach the water leave one, and the frame they do is
    // the splash's first: the pool is stepped after the actors, as a task the
    // bat allocated would be walked after it.
    const rng = new Rng(107);
    const events = scene(0, rng);
    const sounds: number[] = [];
    events.on("sound.play", (e) => sounds.push(e.id));
    G.g_players_in_play = 1;
    mkBat(0xa3c0, 1, 0, 0, rng, vec3(-407, -10, -3688));
    const m = G.g_object_list.find((a) => a.at === BatChildAt(0xa3c0, 1, 0))!;
    bat(m).state = BatState.Dead;
    m.pos = vec3(5, -24.99, -3600);
    bat(m).vx = 0;
    bat(m).vy = 0;
    bat(m).vz = 0;
    GameUpdate(1 / 60, HOST, rng, events);
    const sp = G.g_bat_splashes[0];
    check("a scattering bat's corpse that reaches the water splashes",
          m.despawned && !!sp && sp.x === 5 && sp.y === -25 && sp.z === -3600,
          `${m.despawned} ${sp?.x},${sp?.y},${sp?.z}`);
    check("...drawing its first model on that same frame",
          sp?.drawn === 0, `${sp?.drawn}`);
    check("...to the sound of SIBUKI8", sounds.includes(SND_BAT_SPLASH),
          sounds.map((x) => x.toString(16)).join(","));

    // The swarm's corpse falls with no frame limit to the same plane, and is
    // heard only in stage 3.
    G.g_scene_index = 3;
    mkBat(0xa400, 2, 0, 0, rng, vec3(0, 0, -40));
    const w = G.g_object_list.find((a) => a.at === BatChildAt(0xa400, 2, 0))!;
    bat(w).state = BatState.Dead;
    w.pos = vec3(-6, -24.999, -40);
    const heard = sounds.length;
    GameUpdate(1 / 60, HOST, rng, events);
    check("a swarm corpse splashes too, silently outside stage 3",
          w.despawned && G.g_bat_splashes.some((q) => q.x === -6 && q.y === -25)
          && !sounds.slice(heard).includes(SND_BAT_SPLASH),
          `${w.despawned} ${G.g_bat_splashes.length}`);
  }

  // -- class 0x13, the prop that carries, and class 0x18, what rides it -----
  {
    // Stage 3's block 0 step 6 in miniature: a boat on object path 351 with a
    // zombie standing on it. The engine's carrier is a matrix pushed around
    // the rider's whole update, so the rider's own position is **relative**
    // and the world point is composed; that is the part a renderer needs and
    // the part a test can pin down.
    const rng = new Rng(53);
    scene(0, rng);
    G.g_civilians_alive = 1;
    // A host with one straight object path, so the ride is arithmetic rather
    // than a bundle read.
    const host: GameHost = {
      ...HOST,
      objectPath: (slot, frame) =>
        slot === 0x15f ? { x: frame, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }
                       : { x: 0, y: 0, z: frame, pitch: 0, yaw: 0, roll: 0 },
    };
    const fr = (r: Rng): ClassFrame =>
      ({ dt: 1 / 60, rng: r, host });

    G.g_cam_path_frame = 1000;
    const boat = ActorSpawn(0x9b00, SpawnClass.ScriptedProp, -1, "boat", {
      class13: { slot: 6711, cam_path: 130, cam_frame: 170,
                 scale: 1, behaviour: 8, selector: 1 },
    }, rng);
    const t = () => (boat as { prop13: ScriptedPropTail }).prop13;
    check("a class-0x13 prop takes its slot and its despawn cue off the tail",
          t().slot === 6711 && t().camPath === 130 && t().camFrame === 170,
          `${t().slot} ${t().camPath} ${t().camFrame}`);
    check("...and behaviour 8 makes it the carrier",
          G.g_civilian_carrier === boat.at,
          `${G.g_civilian_carrier.toString(16)}`);

    // The rider, placed after the carrier the way the script places it.
    const rider = ActorSpawn(0x9b01, SpawnClass.CarriedZombie, 5, "rider", {
      pos: vec3(5, -6, -14),
      class18: { from_state: 48, cue_path: 124, cue_frame: 1080 },
    }, rng);
    check("a class-0x18 rider takes the carrier that was current",
          rider.carrierAt === boat.at, `${rider.carrierAt.toString(16)}`);

    // One frame of each: the boat seats itself on the path, the rider
    // publishes where the boat's matrix puts it.
    ScriptedPropUpdate13(boat, fr(rng));
    CarriedZombieUpdate18(rider, fr(rng));
    check("the carrier rides its object path from the camera's frame",
          Math.abs(boat.pos.x - 1000) < 1e-6, `${boat.pos.x}`);
    check("...and the rider's world point is the carrier's own transform of "
          + "its local one",
          Math.abs(rider.carrierWorld.x - (boat.pos.x + 5)) < 1e-6
          && Math.abs(rider.carrierWorld.z - (boat.pos.z - 14)) < 1e-6,
          `${rider.carrierWorld.x},${rider.carrierWorld.z}`);

    // The fork at path frame 0x500 is the class's one dependence on the rest
    // of the scene. With a civilian alive it moors; with none it runs past.
    t().pathFrame = 0x500;
    ScriptedPropUpdate13(boat, fr(rng));
    check("a carrier with a civilian still alive pulls up at 0x500",
          t().state === CarrierState.PullUp, CarrierState[t().state]);

    G.g_civilians_alive = 0;
    t().state = CarrierState.RunIn;
    t().pathFrame = 0x500;
    ScriptedPropUpdate13(boat, fr(rng));
    check("...and one with none of them runs past instead",
          t().state === CarrierState.RunPast, CarrierState[t().state]);

    // Running past, at 0x550: the wake starts to fade and the bow throws a
    // strip -- `SpawnPropStripEffect` kind 3 five units off the bow -- with
    // `0x000B16A9`. This was a `[diverges]` for want of the slots.
    {
      const ev = new Events();
      const heard: number[] = [];
      ev.on("sound.play", (e) => heard.push(e.id));
      G.g_prop_strip_effects = [];
      t().pathFrame = 0x550;
      ScriptedPropUpdate13(boat, { ...fr(rng), events: ev });
      const bow = G.g_prop_strip_effects[0];
      check("at path frame 0x550 the carrier throws the bow strip and sounds it",
            !!bow && bow.first === 0x174a && heard.includes(SFX_CARRIER_BOW)
            && Math.abs(bow.pos.x - boat.pos.x) < 1e-6
            && Math.abs(bow.pos.z - (boat.pos.z - 5)) < 1e-6,
            `${bow?.pos.x},${bow?.pos.z} vs ${boat.pos.x},${boat.pos.z}`);
      check("...and the wake is drawn this frame, on the ground under it",
            t().wakeDrawn >= 0x24a && t().wakeDrawn <= 0x25f
            && t().wakeGroundY === G.g_camera_fixed_eye_y,
            `${t().wakeDrawn} ${t().wakeGroundY}`);
    }

    // Only the three riding states advance the path frame: `0x00440467` is
    // the `INC` every one of their arms jumps to, and states 3, 5 and 6 jump
    // past it.
    t().state = CarrierState.Moored;
    const before = t().pathFrame;
    ScriptedPropUpdate13(boat, fr(rng));
    check("a moored carrier holds its path frame", t().pathFrame === before,
          `${before} -> ${t().pathFrame}`);

    // The despawn is the descriptor's own camera cue, and it is an equality
    // on both halves.
    G.g_active_cam_path = 130;
    G.g_cam_path_frame = 170;
    ScriptedPropUpdate13(boat, fr(rng));
    check("the camera cue on the tail is what removes it", boat.despawned);
  }

  // -- class 0x13 selector 0: stage 2's boat, which runs into the wall -------
  {
    // Stage 2 block 16 step 11 op 2, evt 0xA3E8: slot 0x1A36, scale 2.5,
    // despawn on camera path 78 frame 1110, behaviour 8, selector 0 -- the
    // bundle's own tail. Object path 0x151 here is `x = frame`.
    const rng = new Rng(130);
    scene(0, rng);
    const events = new Events();
    const sounds: number[] = [];
    events.on("sound.play", (e) => sounds.push(e.id));
    const host: GameHost = {
      ...HOST,
      objectPath: (slot, frame) => slot === 0x151
        ? { x: frame, y: -25, z: 0, pitch: 0, yaw: 0, roll: 0 } : null,
    };
    const fr = (r: Rng): ClassFrame =>
      ({ dt: 1 / 60, rng: r, host, events });
    G.g_active_cam_path = 78;
    G.g_cam_path_frame = 326;
    const boat = ActorSpawn(0xa3e8, SpawnClass.ScriptedProp, -1, "boat", {
      class13: { slot: 0x1a36, cam_path: 78, cam_frame: 1110,
                 scale: 2.5, behaviour: 8, selector: 0 },
      pos: vec3(-1055, -26.25, -1620),
    }, rng);
    const t = () => (boat as { prop13: ScriptedPropTail }).prop13;
    check("selector 0 makes it the carrier too",
          G.g_civilian_carrier === boat.at);
    check("the routines the class runs are exactly the selectors the "
          + "exporter carries a model for",
          Object.keys(g_carrier_prop_routines).map(Number).sort().join()
          === [...CARRIER_SELECTORS_PORTED].sort().join(),
          Object.keys(g_carrier_prop_routines).join());

    ScriptedPropUpdate13(boat, fr(rng));
    check("the ride frame draws the wake cel it then steps past",
          t().wakeDrawn === 0x24a && t().wakeCel === 0x24b
          && t().splashDrawn === 0);
    check("its first frame allocates the ride and seats it on path 0x151 at "
          + "the camera's frame -- it used to stand at its descriptor for ever",
          t().state === CarrierRoutine0State.Ride && boat.pos.x === 326
          && t().pathFrame === 327,
          `${t().state} ${boat.pos.x} ${t().pathFrame}`);

    let n = 1;
    while (t().splashCel === 0 && n < 1000) {
      ScriptedPropUpdate13(boat, fr(rng)); n++;
    }
    check("it strikes when the ride frame reaches 0x276, with SIBUKI2",
          t().pathFrame === CARRIER0_FRAME_STRIKE && boat.pos.x === 629
          && t().splashCel === CARRIER0_SPLASH_FIRST
          && sounds.join() === String(SFX_CARRIER0_STRIKE),
          `${t().pathFrame} ${boat.pos.x} ${sounds.map((x) => x.toString(16))}`);
    check("...still in the ride state, which hands over one frame later",
          t().state === CarrierRoutine0State.Ride);
    check("...and the splash is armed on that frame but not yet drawn",
          t().splashDrawn === 0);
    ScriptedPropUpdate13(boat, fr(rng));
    check("the next frame hands over to the coast -- after drawing the "
          + "wake one last time, because case 1 draws whatever it decided",
          t().state === CarrierRoutine0State.Coast && boat.pos.x === 630
          && t().wakeDrawn !== 0,
          `${t().state} ${boat.pos.x} ${t().wakeDrawn}`);
    check("...drawing the splash's first cel",
          t().splashDrawn === CARRIER0_SPLASH_FIRST);
    ScriptedPropUpdate13(boat, fr(rng));
    check("and from then on it coasts without the wake",
          t().wakeDrawn === 0 && t().splashDrawn === CARRIER0_SPLASH_FIRST + 1);

    // The splash strip is 94 cels and then off; the ride coasts to 710.
    for (let i = 0; i < 200; i++) ScriptedPropUpdate13(boat, fr(rng));
    check("the coast stops on g_carrier_routine0_ride_end and holds there",
          t().state === CarrierRoutine0State.Stopped
          && t().pathFrame === g_carrier_routine0_ride_end
          && boat.pos.x === g_carrier_routine0_ride_end,
          `${t().state} ${t().pathFrame} ${boat.pos.x}`);
    check("the splash strip ran to 0x1031 and switched itself off, once",
          t().splashCel === 0 && sounds.length === 1
          && CARRIER0_SPLASH_LAST - CARRIER0_SPLASH_FIRST === 93);
  }

  // -- class 0x13 selectors 4, 5, 7 and 8: stage 4's two set models ---------
  {
    // Stage 4 block 23's evt 0x8CF0: selector 4, despawn on camera path 184
    // frame 320, at (0, 0, 0), with a stand-in slot so the routine's own
    // write of 0x954 shows. Object path 0x176 here is the routine's three
    // literals plus `(240 - frame, frame - 240, 0)`: a correct offset leaves
    // exactly that, and the last frame leaves the origin, where the model is
    // authored.
    const rng = new Rng(131);
    scene(0, rng);
    // Effect 0x15 and 0x18, one record per motion as the exporter keys them:
    // a two-part tree whose parts sit at (1, 2, 3), unturned.
    const part = (motion: number): EffectDefJson => ({
      nodes: [{ slot: 0, bone: 0, children: [1, 2] },
              { slot: 0x968, bone: 1, children: [] },
              { slot: 0x969, bone: 2, children: [] }],
      interp: 0, motion, play_length: 100, frames: 100, bones: 2,
      t: Array.from({ length: 600 }, (_u, i) => (i % 6 < 3 ? (i % 6) + 1 : 0)),
      r: new Array(600).fill(0), cues: [],
    });
    SetGameTables(CHARS, {
      ...BREAKABLES,
      effects: { "21@461": part(0x1cd), "21@460": part(0x1cc),
                 "24@460": part(0x1cc), "24@461": part(0x1cd) },
    });
    const events = new Events();
    const sounds: number[] = [];
    events.on("sound.play", (e) => sounds.push(e.id));
    const X4 = Math.fround(301.89300537109375);
    const Y4 = Math.fround(121.72100067138672);
    const host: GameHost = {
      ...HOST,
      objectPath: (slot, frame) => slot === 0x176
        ? { x: X4 + (240 - frame), y: Y4 + (frame - 240), z: -CARRIER4_OFFSET_Z,
            pitch: 0, yaw: 0, roll: 0 }
        : slot === 0x177
          ? { x: -CARRIER5_OFFSET_X - frame, y: 7, z: -CARRIER5_OFFSET_Z,
              pitch: 0, yaw: 0, roll: 0 }
          : null,
    };
    const fr = (r: Rng): ClassFrame => ({ dt: 1 / 60, rng: r, host, events });
    G.g_active_cam_path = 180;
    G.g_cam_path_frame = 50;
    G.g_screen_shake_frames = 0;
    const set = ActorSpawn(0x8cf0, SpawnClass.ScriptedProp, -1, "set", {
      class13: { slot: 0x111, cam_path: 184, cam_frame: 320, scale: 1,
                 behaviour: 8, selector: 4 },
      pos: vec3(0, 0, 0),
    }, rng);
    const t = () => (set as { prop13: ScriptedPropTail }).prop13;
    ScriptedPropUpdate13(set, fr(rng));
    check("selector 4 allocates its ride, plays 0x1A1BA9 and rides path "
          + "0x176 at the camera's frame, less its three literals",
          t().state === CarrierRoutine4State.Ride && t().riding
          && sounds.join() === String(SFX_CARRIER4_START)
          && set.pos.x === 190 && set.pos.y === -190 && set.pos.z === 0,
          `${t().state} ${sounds} ${set.pos.x} ${set.pos.y} ${set.pos.z}`);
    check("...shakes the screen while it rides",
          G.g_screen_shake_frames === 0x28);
    // Frame 50: s = 50 * 0.1f; `T(-25, 43, -1625) RotY(cam) T(0, 2s, 0)
    // Scale(30, s, 1)` -- the turn is about y, so y carries 43 + 2s.
    const d0 = t().draws[0];
    const s50 = Math.fround(50 * Math.fround(0.1));
    check("...and draws the camera-facing strip's first cel at "
          + "(-25, 43 + 2s, -1625), s = frame * 0.1f, then steps it",
          t().draws.length === 1 && d0.slot === CARRIER4_SPRITE_FIRST
          && d0.m[12] === -25 && d0.m[14] === -1625
          && d0.m[13] === 43 + Math.fround(s50 + s50)
          && Math.abs(d0.m[5] - s50) < 1e-6
          && t().spriteCel === CARRIER4_SPRITE_FIRST + 1,
          JSON.stringify(d0));
    for (let i = 0; i < 12; i++) ScriptedPropUpdate13(set, fr(rng));
    check("the strip wraps from 0x1AF9 back to 0x1AF0",
          t().spriteCel === CARRIER4_SPRITE_FIRST + 3
          && CARRIER4_SPRITE_LAST - CARRIER4_SPRITE_FIRST === 9,
          `${t().spriteCel.toString(16)}`);
    G.g_cam_path_frame = 200;
    ScriptedPropUpdate13(set, fr(rng));
    // (240 - 200) / (240 - 150) * 7 + 3, stored single.
    check("past frame 150 the strip shrinks, to 3 at the path's end",
          Math.abs(t().draws[0].m[5] - Math.fround(40 / 90 * 7 + 3)) < 1e-6,
          `${t().draws[0].m[5]}`);
    sounds.length = 0;
    G.g_cam_path_frame = 210;
    ScriptedPropUpdate13(set, fr(rng));
    check("thirty frames short of g_cam_path_length[0x176] it plays "
          + "0x1B1BA9 and 0x1C1BA9",
          sounds.join() === [SFX_CARRIER4_LAND_A, SFX_CARRIER4_LAND_B].join());
    G.g_cam_path_frame = 240;
    ScriptedPropUpdate13(set, fr(rng));
    check("at frame 240 it stops, and the model stands where it was "
          + "authored: the origin",
          t().state === CarrierRoutine4State.Wait
          && set.pos.x === 0 && set.pos.y === 0 && set.pos.z === 0,
          `${t().state} ${set.pos.x} ${set.pos.y} ${set.pos.z}`);
    G.g_active_cam_path = 0xb9;
    G.g_cam_path_frame = 0xe6;
    ScriptedPropUpdate13(set, fr(rng));
    check("it waits for camera path 0xB9 at frame 0xE7, drawing nothing "
          + "of its own", t().state === CarrierRoutine4State.Wait
          && t().draws.length === 0);
    G.g_cam_path_frame = 0xe7;
    t().fx.frame = 9;
    ScriptedPropUpdate13(set, fr(rng));
    check("...then zeroes the clip and waits for its cue",
          t().state === CarrierRoutine4State.CueA && t().fx.frame === 0
          && t().fx.effect === 0x15 && t().fx.motion === 0x1cd);
    sounds.length = 0;
    G.g_screen_shake_frames = 0;
    G.g_cam_path_frame = 0x1cc;
    ScriptedPropUpdate13(set, fr(rng));
    const fx = t().draws;
    check("frame 0x1CC shakes, plays 0x1E1BA9 and falls into the clip: "
          + "effect 0x15's parts at (303.346, 42.4852, -1685.53) plus "
          + "their own offsets",
          t().state === CarrierRoutine4State.PlayA
          && G.g_screen_shake_frames === 0x28
          && sounds.join() === String(SFX_CARRIER4_CUE)
          && fx.length === 2 && fx[0].slot === 0x968 && fx[1].slot === 0x969
          && fx[0].m[12] === CARRIER4_FX_A_AT[0] + 1
          && fx[0].m[13] === CARRIER4_FX_A_AT[1] + 2,
          JSON.stringify(fx.map((d) => [d.slot, d.m[12], d.m[13], d.m[14]])));
    check("...and the clip does not step before frame 0x1D6",
          t().fx.frame === 0 && t().fx.prev === 0);
    G.g_cam_path_frame = 0x1d6;
    for (let i = 0; i < 150; i++) ScriptedPropUpdate13(set, fr(rng));
    check("from 0x1D6 it steps a frame a tick and holds two short of "
          + "g_motion_play_length[0x1CD]",
          t().fx.frame === 98 && t().fx.prev === 98, `${t().fx.frame}`);
    G.g_cam_path_frame = 0x258;
    ScriptedPropUpdate13(set, fr(rng));
    check("from frame 0x258 the effect is not drawn",
          t().draws.length === 0 && t().state === CarrierRoutine4State.PlayA);
    G.g_cam_path_frame = 0x320;
    ScriptedPropUpdate13(set, fr(rng));
    check("at 0x320 it swaps to motion 0x1CC from frame 0",
          t().state === CarrierRoutine4State.CueB && t().fx.motion === 0x1cc
          && t().fx.frame === 0);
    check("the slot is the descriptor's until frame 0x38E",
          t().slot === 0x111);
    G.g_cam_path_frame = 0x38e;
    ScriptedPropUpdate13(set, fr(rng));
    check("...which writes 0x954 into obj+0x1F4, in any state",
          t().slot === 0x954);
    G.g_cam_path_frame = 0x3c0;
    ScriptedPropUpdate13(set, fr(rng));
    check("frame 0x3C0 starts the second clip, at (326.789, 42.4852, "
          + "-1982.95)", t().state === CarrierRoutine4State.PlayB
          && t().draws[0].m[14] === Math.fround(-1982.946044921875) + 3);

    // Selector 7: block 27's evt 0xA7E4, the same routine arriving seated.
    sounds.length = 0;
    G.g_active_cam_path = 181;
    G.g_cam_path_frame = 0;
    const parked = ActorSpawn(0xa7e4, SpawnClass.ScriptedProp, -1, "set 7", {
      class13: { slot: 0x954, cam_path: 184, cam_frame: 320, scale: 1,
                 behaviour: 8, selector: 7 },
      pos: vec3(9, 9, 9),
    }, rng);
    const t7 = (parked as { prop13: ScriptedPropTail }).prop13;
    ScriptedPropUpdate13(parked, fr(rng));
    check("selector 7 seats at path 0x176's last frame and goes straight to "
          + "the wait: no sound, no strip",
          t7.state === CarrierRoutine4State.Wait && parked.pos.x === 0
          && parked.pos.y === 0 && parked.pos.z === 0 && sounds.length === 0
          && t7.draws.length === 0,
          `${parked.pos.x} ${parked.pos.y} ${parked.pos.z}`);

    // Selector 5: block 25's evt 0x9D40 on path 0x177, x and z added.
    G.g_active_cam_path = 188;
    G.g_cam_path_frame = 100;
    const other = ActorSpawn(0x9d40, SpawnClass.ScriptedProp, -1, "set 5", {
      class13: { slot: 0x956, cam_path: 78, cam_frame: 1200, scale: 1,
                 behaviour: 8, selector: 5 },
      pos: vec3(0, 0, 0),
    }, rng);
    const t5 = (other as { prop13: ScriptedPropTail }).prop13;
    ScriptedPropUpdate13(other, fr(rng));
    check("selector 5 rides path 0x177 with its own two literals, added, and "
          + "leaves y as the path has it",
          t5.state === CarrierRoutine4State.Ride && other.pos.x === -100
          && other.pos.z === 0 && other.pos.y === 7
          && t5.fx.effect === 0x18 && t5.fx.motion === 0x1cc,
          `${other.pos.x} ${other.pos.y} ${other.pos.z}`);
    check("...and its strip stands at x -355",
          t5.draws[0].m[12] === -355 && t5.draws[0].m[14] === -1625);
    t5.state = CarrierRoutine4State.CueA;
    G.g_cam_path_frame = 0x208;
    ScriptedPropUpdate13(other, fr(rng));
    check("its effect is turned half round: row 0 is -x",
          (t5.state as CarrierRoutine4State) === CarrierRoutine4State.PlayA
          && Math.abs(t5.draws[0].m[0] + 1) < 1e-6
          && Math.abs(t5.draws[0].m[12]
                      - (Math.fround(-232.31199645996094) - 1)) < 1e-3,
          JSON.stringify(t5.draws[0].m));

    check("the exporter carries the strip for 4 and 5, not for 7 and 8, and "
          + "both motions for every one",
          CarrierDrawSlots(4).length === 10 && CarrierDrawSlots(5).length === 10
          && CarrierDrawSlots(7).length === 0
          && CarrierEffects(7).map((e) => e.join("@")).join()
             === "21@461,21@460"
          && CarrierEffects(8).map((e) => e.join("@")).join()
             === "24@460,24@461");
  }

  // -- class 0x13 selector 3: stage 4's monitor -----------------------------
  {
    // Stage 4 block 23 step 1 op 10, evt 0x8C4C: slot 0x966, despawn on
    // camera path 180 frame 0, at (318.28, 0, -353.92) with no angles --
    // spawned at frame 90 of path 179. Every number below is the routine's
    // own: 0x958..0x95D, 0.03 and 0.7, 0x1DF, 0xB9.
    const rng = new Rng(133);
    scene(0, rng);
    const events = new Events();
    const sounds: number[] = [];
    events.on("sound.play", (e) => sounds.push(e.id));
    const fr = (r: Rng): ClassFrame =>
      ({ dt: 1 / 60, rng: r, host: HOST, events });
    G.g_active_cam_path = 179;
    G.g_cam_path_frame = 90;
    const at = vec3(318.281982421875, 0, -353.91998291015625);
    const mon = ActorSpawn(0x8c4c, SpawnClass.ScriptedProp, -1, "monitor", {
      class13: { slot: 0x966, cam_path: 180, cam_frame: 0, scale: 1,
                 behaviour: 8, selector: 3 },
      pos: vec3(at.x, at.y, at.z),
    }, rng);
    const t = () => (mon as { prop13: ScriptedPropTail }).prop13;
    const st = () => t().state as CarrierRoutine3State;
    check("selector 3 is installed and makes the monitor the carrier",
          g_carrier_prop_routines[3] === CarrierPropRoutine3
          && G.g_civilian_carrier === mon.at && CARRIER_SELECTORS_PORTED.has(3)
          && CarrierDrawSlots(3).length === 0);
    ScriptedPropUpdate13(mon, fr(rng));
    check("its first frame allocates the block at 0x958, plays MONITOR3 and "
          + "sets no layer",
          st() === CarrierRoutine3State.CountUp && t().monitorCursor === 0x958
          && sounds.join() === String(SFX_CARRIER3_START) && t().alpha === 1
          && t().drawLayer === 8,
          `${st()} ${t().monitorCursor} ${sounds} ${t().drawLayer}`);
    check("...and the update's draw leaves its point in obj+0x70",
          mon.shotCentre.x === at.x && mon.shotCentre.z === at.z);
    let n = 0;
    while (st() === CarrierRoutine3State.CountUp && n < 100) {
      ScriptedPropUpdate13(mon, fr(rng)); n++;
    }
    check("the cursor climbs to 0x95D in five frames and the sixth moves on, "
          + "every one in layer 9",
          n === 6 && t().monitorCursor === 0x95d && t().drawLayer === 9
          && st() === CarrierRoutine3State.FadeDown,
          `${n} ${t().monitorCursor.toString(16)} ${t().drawLayer}`);
    const alphas: number[] = [];
    n = 0;
    while (st() === CarrierRoutine3State.FadeDown && n < 100) {
      ScriptedPropUpdate13(mon, fr(rng)); n++; alphas.push(t().alpha);
    }
    check("the alpha falls 0.03f a frame and the eleventh step clamps it to "
          + "0.7f",
          n === 11 && alphas[0] === Math.fround(1 - Math.fround(0.03))
          && alphas[10] === Math.fround(0.7)
          && st() === CarrierRoutine3State.WaitFrame,
          alphas.join(" "));
    G.g_active_cam_path = 181;
    G.g_cam_path_frame = 0x1de;
    ScriptedPropUpdate13(mon, fr(rng));
    check("it waits for camera frame 0x1DF", st()
          === CarrierRoutine3State.WaitFrame);
    G.g_cam_path_frame = 0x1df;
    ScriptedPropUpdate13(mon, fr(rng));
    check("...of whatever path is playing, and loads 0xB9",
          st() === CarrierRoutine3State.Hold && t().monitorHold === 0xb9);
    n = 0;
    while (st() === CarrierRoutine3State.Hold && n < 1000) {
      ScriptedPropUpdate13(mon, fr(rng)); n++;
    }
    check("the hold is a post-decrement: 0xBA frames, ending on -1",
          n === 0xba && t().monitorHold === -1, `${n} ${t().monitorHold}`);
    n = 0;
    while (st() === CarrierRoutine3State.FadeUp && n < 100) {
      ScriptedPropUpdate13(mon, fr(rng)); n++;
    }
    check("the alpha climbs back in eleven and clamps to 1.0",
          n === 11 && t().alpha === 1
          && st() === CarrierRoutine3State.CountDown, `${n} ${t().alpha}`);
    n = 0;
    while (st() === CarrierRoutine3State.CountDown && n < 100) {
      ScriptedPropUpdate13(mon, fr(rng)); n++;
    }
    check("the cursor steps back to 0x958 and the sixth frame moves to the "
          + "kill", n === 6 && t().monitorCursor === 0x958
          && st() === CarrierRoutine3State.Kill && !mon.despawned);
    ScriptedPropUpdate13(mon, fr(rng));
    check("...which takes it out of the pool",
          mon.despawned && !mon.visible);
    check("it never moved or turned: the record's pose for life",
          mon.pos.x === at.x && mon.pos.y === at.y && mon.pos.z === at.z
          && mon.pitch === 0 && mon.yaw === 0 && mon.roll === 0);
  }

  // -- class 0x13 selectors 1 and 6: the screen test that ends state 6 ------
  {
    // `CarriedPropIsOnScreen` (`FUN_004459C0`) on the point the update's
    // draw left the frame before, radius 40. The camera here sits at
    // (0, 0, 100) looking down -z, so a boat at x 0 is dead ahead and one at
    // x 1000 is far off the right edge.
    for (const selector of [1, 6]) {
      const rng = new Rng(134 + selector);
      scene(0, rng);
      G.g_civilians_alive = 0;
      const host: GameHost = {
        ...HOST,
        objectPath: () => null,
        viewSpaceOfPoint: (p, out) => {
          out.x = p.x; out.y = p.y; out.z = p.z - 100;
          return true;
        },
      };
      const fr = (r: Rng): ClassFrame => ({ dt: 1 / 60, rng: r, host });
      const boat = ActorSpawn(0x9b10 + selector, SpawnClass.ScriptedProp, -1,
                              "boat", {
        class13: { slot: 6711, cam_path: 130, cam_frame: 170, scale: 1,
                   behaviour: 8, selector },
        pos: vec3(0, 0, -50),
      }, rng);
      const t = () => (boat as { prop13: ScriptedPropTail }).prop13;
      ScriptedPropUpdate13(boat, fr(rng));
      t().state = CarrierState.Wake;
      G.g_cam_path_frame = selector === 1 ? CARRIER_PATH_END
        : CARRIER6_PATH_END;
      ScriptedPropUpdate13(boat, fr(rng));
      check(`selector ${selector}: on screen, state 6 holds`,
            t().state === CarrierState.WakeSpent
            && !(boat.flags & ActorFlag.Dead), CarrierState[t().state]);
      boat.pos.x = 1000;
      ScriptedPropUpdate13(boat, fr(rng));
      check(`selector ${selector}: the test reads last frame's point, so `
            + "the frame it leaves still holds",
            t().state === CarrierState.WakeSpent && boat.shotCentre.x === 1000);
      ScriptedPropUpdate13(boat, fr(rng));
      check(`selector ${selector}: off the frame it raises 0x4000000 on `
            + "itself and goes to state 7",
            t().state === CarrierState.Gone
            && (boat.flags & ActorFlag.Dead) !== 0 && !boat.despawned);
      ScriptedPropUpdate13(boat, fr(rng));
      check(`selector ${selector}: ...which despawns it`, boat.despawned);
    }
    // Behind the eye is off whatever the projection says.
    check("CarriedPropIsOnScreen: at or behind the eye is off, a sphere "
          + "straddling the edge is on, one clear of it is off",
          !CarriedPropIsOnScreen({ shotPoint: vec3(0, 0, 0), radius: 40 })
          && CarriedPropIsOnScreen({ shotPoint: vec3(0, 0, -100), radius: 40 })
          // centre at 320 / 640.2 * 120 = 60 off-axis at depth 120 is just
          // past the right edge; a radius of 40 pulls its near side back in.
          && CarriedPropIsOnScreen({ shotPoint: vec3(70, 0, -120), radius: 40 })
          && !CarriedPropIsOnScreen({ shotPoint: vec3(70, 0, -120), radius: 1 })
          && !CarriedPropIsOnScreen({ shotPoint: vec3(0, 60, -100), radius: 1 }));
    {
      // No camera to measure against: the boat stays, as a carried prop does.
      const rng = new Rng(140);
      scene(0, rng);
      const fr = (r: Rng): ClassFrame =>
        ({ dt: 1 / 60, rng: r, host: { ...HOST, objectPath: () => null } });
      const boat = ActorSpawn(0x9b20, SpawnClass.ScriptedProp, -1, "boat", {
        class13: { slot: 6711, cam_path: 130, cam_frame: 170, scale: 1,
                   behaviour: 8, selector: 1 },
        pos: vec3(5000, 0, 5000),
      }, rng);
      const t = () => (boat as { prop13: ScriptedPropTail }).prop13;
      ScriptedPropUpdate13(boat, fr(rng));
      t().state = CarrierState.WakeSpent;
      ScriptedPropUpdate13(boat, fr(rng));
      ScriptedPropUpdate13(boat, fr(rng));
      check("with no camera the carrier holds state 6",
            t().state === CarrierState.WakeSpent && !boat.despawned);
    }
  }
}

// -- the bone cel runs, and the hit slot that phases them ------------------
//
// `ZombieDrawBonePart` (`FUN_004534A0`) is a *draw* hook, so what it draws is
// the renderer's; what is asserted here is the two halves of it that are game
// state -- the table's own shape against the measured models, and the
// `g_hit_slots` claim that gives each actor its phase.
{
  // The arm the bug report is about. `0x1B3D` draws *neither* itself nor one
  // model: a 20-cel chest and a 30-cel lower torso, which is why reading only
  // the last five of the lower run made five look like a meaningful count.
  const torso = g_class30_bone_cels[0x1b3d];
  check("the undamaged char_adv02 torso draws two runs and not itself",
        !!torso && !torso.self && torso.runs.length === 2,
        `${torso?.self} ${torso?.runs.length}`);
  check("...a 20-cel chest at 0x1B3E and a 30-cel lower torso at 0x1B52",
        torso.runs[0].base === 0x1b3e && torso.runs[0].count === 20
        && torso.runs[1].base === 0x1b52 && torso.runs[1].count === 30,
        torso.runs.map((r) => `${r.base.toString(16)}+${r.count}`).join(" "));

  // The check on the whole reading: the two chest-only damage stages take the
  // lower run and the three that carry their own abdomen are not in the table
  // at all. `0x1B72`, `0x1B73` and `0x1B74` reach y -2.02 in their own
  // geometry; `0x1B70` and `0x1B71` stop at y 1.35.
  for (const slot of [0x1b70, 0x1b71]) {
    const arm = g_class30_bone_cels[slot];
    check(`0x${slot.toString(16).toUpperCase()} draws itself and the lower torso`,
          !!arm && arm.self && arm.runs.length === 1
          && arm.runs[0].base === 0x1b52,
          `${arm?.self} ${arm?.runs.length}`);
  }
  for (const slot of [0x1b72, 0x1b73, 0x1b74]) {
    check(`0x${slot.toString(16).toUpperCase()} is not a trigger at all`,
          g_class30_bone_cels[slot] === undefined,
          `${g_class30_bone_cels[slot] !== undefined}`);
  }
  // Every cel the table can ask for has to be in the bundle, or the draw finds
  // nothing -- which is the hole this fixes, one level down.
  const cels = ZombieBoneCelSlots();
  // 20 + 30 + 5 + 5 + 120 + 18 + 50 + 50: the lower-torso run is named by
  // three arms and counted once, which is the point of asking for the set.
  check("the table names 298 distinct cels across its nine arms",
        cels.length === 298, `${cels.length}`);

  // The phase. `obj+0x3C` is claimed by `ActorBuildSkinnedModel`, which every
  // skinned `Init` calls, and the port claims it in `ActorSpawn` for the
  // classes whose `Init` is a proved caller.
  const rng = new Rng(97);
  scene(0, rng);
  const a = ActorSpawn(0x9800, SpawnClass.Zombie, 0, "znA", {}, rng);
  const b = ActorSpawn(0x9804, SpawnClass.Zombie, 0, "znB", {}, rng);
  check("two zombies take different hit slots, so different cel phases",
        a.hitSlot === 0 && b.hitSlot === 1, `${a.hitSlot} ${b.hitSlot}`);
  check("...and the claim raises obj+0x38 bit 0x40",
        (a.flags38 & HIT_SLOT_CLAIMED) !== 0,
        `0x${a.flags38.toString(16)}`);
  // A class whose `Init` the engine is not proved to build a skinned model in
  // does not claim, rather than a guess that would shift every index.
  const mouse = ActorSpawn(0x9808, SpawnClass.Mouse, -1, "mouse", {}, rng);
  check("a class with no proved model build claims nothing",
        mouse.hitSlot === -1, `${mouse.hitSlot}`);
  // `ActorDespawn` hands the slot back, and the next claim takes it.
  ActorDespawn(a);
  check("a despawn hands the slot back",
        a.hitSlot === -1 && G.g_hit_slots[0] === -1,
        `${a.hitSlot} ${G.g_hit_slots[0]}`);
  const c = ActorSpawn(0x980c, SpawnClass.Zombie, 0, "znC", {}, rng);
  check("...and the next zombie takes the freed one, not the next index",
        c.hitSlot === 0, `${c.hitSlot}`);
  // Fourteen deep, and the engine does not guard the overflow either: the
  // fifteenth claimant keeps -1, which `render/characters/cels.ts` reads as a
  // negative cel index and therefore as no cel.
  const many: number[] = [];
  for (let i = 0; i < 14; i += 1) {
    many.push(ActorSpawn(0x9900 + i * 4, SpawnClass.Zombie, 0, "zn", {},
                         rng).hitSlot);
  }
  // Two are already held, so twelve of the fourteen claims land and the last
  // two find the table full.
  check("the table is fourteen deep and the overflow claimants get -1",
        many.filter((n) => n >= 0).length === 12
        && many.slice(-2).every((n) => n === -1)
        && new Set(many.filter((n) => n >= 0)).size === 12,
        many.join(","));
}
