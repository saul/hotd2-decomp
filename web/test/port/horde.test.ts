import type { CharactersJson, CharacterType } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { ActorSpawn, GameUpdate } from "../../src/game/director";
import { ScriptedPropUpdate13, g_carrier_prop_routines, SFX_CARRIER_BOW }
  from "../../src/game/class13";
import {
  CARRIER_GROUND_WAKE_DRAW, CARRIER_SELECTORS_PORTED, CarrierDrawSlots,
  CarrierState, type ScriptedPropTail,
} from "../../src/game/class13/state";
import {
  PropStripEffectsTick, PropStripKind, SpawnPropStripEffect,
} from "../../src/game/effects/prop_strip";
import { ActorByAt, G, ResetGameGlobals } from "../../src/game/globals";
import { NULL_HOST, type GameHost } from "../../src/game/host";
import {
  HordeFormation, HordeKind, HordeMemberAt, HordeState, HordeUpdate,
  PlaceHorde, SubModelAdvanceClock, SubModelBlendToMotion, SubModelSetMotion,
  HORDE_CHAR_TYPE, HORDE_CLIP_CRAWL, HORDE_CLIP_DEATH, HORDE_CLIP_LEAP,
  EmergePropState, type HordeTail,
} from "../../src/game/class40";
import { makeSubModel, SubModelFlag } from "../../src/game/class40/submodel";
import {
  WormClassUpdate, WormCountsForEnemyGate, WormDeathUpdate,
  WormLoneDropUpdate, WormMemberAt, WormUpdate, WormBodyDraw, WormFlag,
  WormRoutine, WormState, WORM_LONE_SLOT, SND_WORM_KILLED_A,
  SND_WORM_KILLED_B, SND_WORM_LAND_A, SND_WORM_LAND_B, type WormTail,
} from "../../src/game/class42";
import type { Class42Json } from "../../src/bundle";
import {
  BodyCreatureState, BodyCreatureUpdate, MarkBodyCreatureShot,
  SpawnBodyCreature,
} from "../../src/game/body_creature";
import { SetGameTables, T } from "../../src/game/tables";
import {
  ColiTestSphereAgainstFullSet, QueryGroundHeightAt, QueryGroundSurfaceAt,
} from "../../src/game/coli";
import { ZombieState } from "../../src/game/class30/states";
import {
  ActorFlag, ZombieFlag2, type Actor, type ZombieActor,
} from "../../src/game/actor";
import { type ClassFrame } from "../../src/game/registry";
import { ActorSnapToGroundHeight } from "../../src/game/class30/ground";
import { SpawnClass } from "../../src/game/spawn_class";
import { syncCharacterSpawns, type CharacterPool } from "../../src/app/systems";
import { CarrierTransformPoint } from "../../src/game/carrier";
import { GameMode } from "../../src/game/game_mode";
import { vec3, type Vec3 } from "../../src/game/vec";
import { EffectCode, ResolveHit } from "../../src/game/combat/resolve_hit";
import { RunPendingInits, SpawnSlotActor } from "../../src/game/director";
import { UpdateCameraEnemySlots } from "../../src/game/camera/slots";
import { SelectCameraLookAtTarget } from "../../src/game/camera/select_target";
import {
  check, motion, CHARS, SCENE_MAJOR_PLAYING, spawnZombie, openShutter, scene,
  EnterPlay, JoinPlayerTwo, run, coliQuad,
} from "./harness";

// -- the creature `znjoe` releases ------------------------------------------

/**
 * `ActorReactToHit`'s `znjoe` arm, the state it leads to, and the thing that
 * comes out of the chest.
 *
 * All of it was read and named and none of it was ported, which is why the
 * assertions here are mostly about *edges that did not exist*: state 25 had
 * no `case`, `g_body_creatures` had no entries, and the two enemy counters
 * never saw an object that in the engine has to be shot before a room can
 * clear.
 */
console.log("\nznjoe's creature:");
{
  /** `znjoe`. The one character type `ActorReactToHit` tests for. */
  const JOE = 0x0a;
  const joeType = {
    ...CHARS.types["1"], type: JOE, name: "znjoe", file: "znjoe.bin",
    bones: [
      // The torso, with an **escalating** first step so a hit on it resolves
      // as result 1. `0x1CF1` stands in for `g_pBoneEffectSlots[0x0A][7]`,
      // the slot the release swaps bone 1 to.
      { bone: 1, part: "torso", slot: 1, offset: [0, 0, 0], parent: null,
        damage_rank: [], hit_radius: 3,
        steps: [[0x1cf0, EffectCode.Escalate, 3],
                [0x1cf1, EffectCode.Escalate, 3],
                [0x1cf2, EffectCode.Last, 3]] },
      { bone: 4, part: "r_upperarm", slot: 4, offset: [0, 0, 0], parent: null,
        damage_rank: [], hit_radius: 2,
        steps: [[0x11, EffectCode.Escalate, 3]] },
      { bone: 2, part: "head", slot: 0x30, offset: [0, 0, 0], parent: null,
        damage_rank: [], hit_radius: 2, steps: [] },
    ],
    motions: {
      ...CHARS.types["1"].motions,
      // 0x1E3 the walk it backs out on and 0x1DF the clip it opens on, both
      // with the play length the shipped table gives them:
      // `g_motion_play_length` (0x004E07D0) is **155** at index 479 and 79 at
      // 483. The 155 is the reason the release can happen at all -- the
      // countdown the state arms is 95 to 104 frames and the clip ending is
      // what hands over to the death state, so a clip shorter than the
      // countdown would leave every znjoe dying with its chest closed. A
      // fixture with 40 frames does exactly that, which is how this line
      // came to be pinned.
      "483": motion(40, 0, 79), "479": motion(78, 0, 155),
    },
  } as unknown as CharacterType;
  const joeChars = {
    ...CHARS, types: { "1": CHARS.types["1"], "10": joeType },
  } as unknown as CharactersJson;

  /** A host that can pose bone 1 and has a camera at the origin. */
  const JOE_HOST: GameHost = {
    boneWorld: (_at, bone, out) => {
      if (bone !== 1) return false;
      out.x = 0; out.y = 5; out.z = 40;
      return true;
    },
    aimPoint: (_ahead, out) => { out.x = 0; out.y = 0; out.z = 0; },
    viewPoint: () => undefined,
    viewSpaceOf: () => false,
    // A camera at the origin looking down `-Z`, so camera space is the world
    // with `z` negated -- enough to prove which space the flight is in.
    viewSpaceOfPoint: (pt, out) => {
      out.x = pt.x; out.y = pt.y; out.z = -pt.z;
      return true;
    },
    setBoneSlot: () => undefined,
  };

  function joeScene(rng: Rng): { joe: ZombieActor; events: Events } {
    ResetGameGlobals();
    SetGameTables(joeChars);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    EnterPlay();
    openShutter();
    const joe = spawnZombie(0x0a68, JOE, "znjoe", {}, rng);
    joe.visible = true;
    joe.attackState = 1;
    joe.hp = 100;
    joe.pos = vec3(0, 0, 40);
    joe.motion = 10;
    return { joe, events: new Events() };
  }

  // -- 1. the arm, and the frame it has to happen on -----------------------
  //
  // `ResolveHit` charges the damage and withholds the stagger; the arm itself
  // runs in `ZombieOnShot`, which is where the engine calls
  // `ActorReactToHit` -- at `0x0045401A`, **after** the death test at
  // `0x00453F46` that reads the very bit the arm raises. Called any earlier
  // than that, the arm sets state 25 and `ZombieOnShot` overwrites it with
  // {@link ZombieState.Death} on the same frame, which is what it did.
  {
    const rng = new Rng(11);
    const { joe, events } = joeScene(rng);
    const before = G.g_player_score[0];
    const out = ResolveHit(joe, 1, JOE_HOST, rng, 0);
    check("a torso hit on znjoe plays no stagger and leaves it alive",
          out.react === undefined && out.result === 1 && joe.hp > 0
          && !joe.dead,
          `react ${out.react} result ${out.result} hp ${joe.hp}`);
    // `ResolveHit`'s tail pays the body hit its 10 there and then; the arm's
    // 0x50 is on top of that, a frame later.
    const score = G.g_player_score[0];
    check("...and `ResolveHit` pays it as a body hit, 10 and no kill",
          score === before + 10 && !out.killed,
          `${before} -> ${score} killed ${out.killed}`);
    check("...and the hit carries the player who fired it, per `obj+0x190`",
          joe.pendingHit?.player === 0,
          `${JSON.stringify(joe.pendingHit)}`);
    GameUpdate(1 / 60, JOE_HOST, rng, events);
    check("...and `ZombieOnShot` puts it in state 25, not a death state",
          joe.state === ZombieState.ReleaseBodyCreature,
          `state ${joe.state} sub ${joe.sub}`);
    check("...the same OR marks it dead and undismemberable",
          (joe.flags & ActorFlag.Dead) !== 0
          && (joe.flags & ActorFlag.NoDismember) !== 0,
          `flags ${joe.flags.toString(16)}`);
    check("...pays the shooter 0x50 and records who fired",
          G.g_player_score[0] === score + 0x50 && joe.killedBy === 0,
          `score ${G.g_player_score[0]} killedBy ${joe.killedBy}`);

    // Once-only, and the latch is `NoDismember` -- which the same OR raised.
    joe.state = ZombieState.HoldAtRange;
    joe.sub = 0;
    joe.hp = 100;
    joe.flags &= ~(ActorFlag.ShotImmune as number);
    joe.flags2 &= ~(ZombieFlag2.DiedInFlight as number);
    ResolveHit(joe, 1, JOE_HOST, rng, 0);
    GameUpdate(1 / 60, JOE_HOST, rng, events);
    check("a second torso hit does not open it again",
          joe.state !== ZombieState.ReleaseBodyCreature, `state ${joe.state}`);
  }

  // Neither of the other two conditions may be dropped.
  {
    const rng = new Rng(12);
    const { events } = joeScene(rng);
    const other = spawnZombie(0x2000, 1, "not a znjoe", {}, rng);
    other.hp = 100;
    other.visible = true;
    ResolveHit(other, 1, JOE_HOST, rng, 0);
    GameUpdate(1 / 60, JOE_HOST, rng, events);
    check("another character type's torso hit is an ordinary hit",
          other.state !== ZombieState.ReleaseBodyCreature,
          `state ${other.state}`);
  }
  {
    const rng = new Rng(13);
    const { joe, events } = joeScene(rng);
    ResolveHit(joe, 4, JOE_HOST, rng, 0);
    GameUpdate(1 / 60, JOE_HOST, rng, events);
    check("and a znjoe shot in the arm is too -- the bone is bone 1",
          joe.state !== ZombieState.ReleaseBodyCreature, `state ${joe.state}`);
  }

  // -- 2. the state --------------------------------------------------------
  {
    const rng = new Rng(14);
    const { joe, events } = joeScene(rng);
    joe.state = ZombieState.ReleaseBodyCreature;
    joe.sub = 0;
    // Inside the inner ring (25), which is where a zombie shot at close range
    // is. The engine walks it back out before the chest opens.
    joe.pos = vec3(0, 0, 10);
    joe.attackPermit = 0;
    G.g_attack_permits[0] = joe.at;
    for (let i = 0; i < 5; i++) {
      GameUpdate(1 / 60, JOE_HOST, rng, events);
    }
    check("inside the inner ring it plays the walk and stays in sub 1",
          joe.motion === 0x1e3 && joe.sub === 1,
          `motion ${joe.motion} sub ${joe.sub}`);
    check("...and it is dead already: sub 0 zeroed the hit points",
          joe.hp === 0, `hp ${joe.hp}`);
    check("...and is immune to a second shot while it finishes",
          (joe.flags & ActorFlag.ShotImmune) !== 0,
          `flags ${joe.flags.toString(16)}`);

    // Out past the ring, and the clip starts.
    joe.pos = vec3(0, 0, 40);
    GameUpdate(1 / 60, JOE_HOST, rng, events);
    check("outside it, the release clip starts and a countdown is armed",
          joe.motion === 0x1df && joe.sub === 3
          && joe.arcTotal >= 0x5f && joe.arcTotal <= 0x5f + 9,
          `motion ${joe.motion} sub ${joe.sub} delay ${joe.arcTotal}`);

    const before = G.g_enemies_alive;
    const want = joe.arcTotal;
    for (let i = joe.arcFrames; i < want + 1; i++) {
      GameUpdate(1 / 60, JOE_HOST, rng, events);
    }
    check("on the frame it lands, the torso opens",
          joe.boneSlot["1"] === 0x1cf1 && joe.hits[1] === 1,
          `slot ${joe.boneSlot["1"]} hits ${joe.hits[1]}`);
    check("...the creature is released",
          G.g_body_creatures.length === 1,
          `${G.g_body_creatures.length} creatures`);
    check("...and it is a countable enemy: both counts go up",
          G.g_enemies_alive === before + 1,
          `${before} -> ${G.g_enemies_alive}`);
    check("...the permit goes back, because a corpse must not hold one",
          joe.attackPermit === -1 && G.g_attack_permits[0] === -1,
          `permit ${joe.attackPermit}`);
    check("...and the death-motion bit goes up, which is the same latch",
          (joe.flags2 & ZombieFlag2.DeathMotionVariant) !== 0,
          `flags2 ${joe.flags2.toString(16)}`);
    // ...and only once, however long the clip runs. The clip's play length is
    // 155 and the countdown spent 95 to 104 of it, so the last fifty frames
    // are the zombie standing with its chest open -- and the latch has to
    // hold for every one of them. Counted on the sequence rather than on the
    // live list, because the one creature flies off, hits the player and
    // falls out of the world inside that window.
    const n = G.g_body_creature_seq;
    for (let i = 0; i < 80; i++) {
      GameUpdate(1 / 60, JOE_HOST, rng, events);
    }
    check("...exactly once, however long the clip runs",
          G.g_body_creature_seq === n, `${n} -> ${G.g_body_creature_seq}`);
    check("...and when the clip ends the zombie dies its own death",
          joe.state === ZombieState.Death
          || joe.state === ZombieState.CorpseSink
          || joe.state === ZombieState.CorpseBlink,
          `state ${joe.state}`);
  }

  // -- 3. the flight -------------------------------------------------------
  {
    const rng = new Rng(15);
    const { joe, events } = joeScene(rng);
    const c = SpawnBodyCreature(joe);
    check("a new creature rides the host's bone",
          c.state === BodyCreatureState.RideHostBone);
    const sounds: number[] = [];
    events.on("sound.play", (e) => sounds.push(e.id));
    BodyCreatureUpdate(c, rng, JOE_HOST, events);
    // The host's bone is at world (0, 5, 40) and the stub's camera space
    // negates z, so the launch point is (0, 6.5, -40): the 1.5 lift is added
    // in *world* and z comes back negative, which is in front of the eye.
    check("...and launches into camera space, lifted by 1.5",
          c.state === BodyCreatureState.Fly
          && Math.abs(c.flight.start.y - 6.5) < 1e-6
          && c.flight.start.z === -40,
          `start ${JSON.stringify(c.flight.start)}`);
    check("...with the launch range measured to the eye",
          Math.abs(c.flight.range - 40) < 1e-6, `range ${c.flight.range}`);
    check("...and plays COMMON\\MEET01_22.WAV", sounds.includes(0x3a16a9),
          `sounds ${sounds.map((x) => x.toString(16)).join(",")}`);
    // One player, so the end point is the origin of camera space: the eye.
    check("...aimed at the eye, because there is one player",
          c.flight.endX === 0 && c.flight.endZ === 0);

    // The arc: a one-unit half-sine over the descent, and it is **zero at
    // both ends** -- `t * 65536 * 5/9` BAMS passes through exactly pi at
    // `t = 0.9`, which is the same `t` the arrival latches on. `c.t` is
    // already the *next* step by the time the call returns, so the t that
    // produced this frame's position is the one read before it.
    let peak = 0;
    let frames = 0;
    let last = 0;
    while (c.arrived === 0 && frames < 240) {
      const t = c.t;
      BodyCreatureUpdate(c, rng, JOE_HOST, events);
      last = c.pos.y - c.flight.start.y * (1 - t);
      peak = Math.max(peak, last);
      frames++;
    }
    check("the flight arrives in about twenty-four frames",
          frames >= 20 && frames <= 30, `${frames} frames`);
    check("...having humped a unit above the straight line",
          peak > 0.95 && peak <= 1.0, `peak ${peak}`);
    check("...and come back down onto it by the time it arrives",
          Math.abs(last) < 0.1, `arc ${last}`);
    check("...which leaves it a tenth of the way above the eye it left from",
          c.pos.y > 0 && c.pos.y < c.flight.start.y * 0.2,
          `y ${c.pos.y} of ${c.flight.start.y}`);
    check("...and the sprite cursor has walked the forty-slot loop",
          c.slot >= 0x1d31 && c.slot <= 0x1d31 + 0x27, `slot ${c.slot}`);

    // Thirty frames later it takes a life -- and only then. The arrival frame
    // steps the counter twice, once to latch and once as the delay's own
    // increment, so twenty-eight more frames is the last one that is safe.
    const lives = G.g_player_lives[0];
    for (let i = 0; i < 0x1e - 2; i++) {
      BodyCreatureUpdate(c, rng, JOE_HOST, events);
    }
    check("it does not hit the player the moment it arrives",
          G.g_player_lives[0] === lives, `lives ${G.g_player_lives[0]}`);
    BodyCreatureUpdate(c, rng, JOE_HOST, events);
    check("...it hits thirty frames later",
          G.g_player_lives[0] === lives - 1 && G.g_player_was_hit[0] === 1,
          `lives ${G.g_player_lives[0]}`);
    check("...and starts falling",
          c.state === BodyCreatureState.FallAfterHit,
          `state ${BodyCreatureState[c.state]}`);

    // The fall's tumble **accelerates**: `tail+0x24` starts at -0x200 and is
    // multiplied by 1.01 every frame, so a creature that has fallen for ten
    // frames is turning faster than one that has fallen for one. The clamp at
    // -0x4000 exists but is not reached from here -- 0.010888 a frame takes
    // the body below `y = -3` in about forty frames and the accumulated spin
    // needs about fifty -- so it is the growth that is asserted and not the
    // clamp.
    const spin0 = c.flight.fallSpin;
    for (let i = 0; i < 10; i++) BodyCreatureUpdate(c, rng, JOE_HOST, events);
    check("the fall's tumble accelerates, and the wrong way for a miss",
          c.flight.fallSpin < spin0 && c.pitch < 0,
          `spin ${spin0} -> ${c.flight.fallSpin} pitch ${c.pitch}`);

    const alive = G.g_enemies_alive;
    const present = G.g_enemies_present;
    let live = true;
    for (let i = 0; i < 600 && live; i++) {
      live = BodyCreatureUpdate(c, rng, JOE_HOST, events);
    }
    check("it falls out of the world and drops both counters",
          !live && G.g_enemies_alive === alive - 1
          && G.g_enemies_present === present - 1,
          `alive ${alive} -> ${G.g_enemies_alive}`);
  }

  // -- 4. shooting it ------------------------------------------------------
  {
    const rng = new Rng(16);
    const { joe, events } = joeScene(rng);
    const c = SpawnBodyCreature(joe);
    BodyCreatureUpdate(c, rng, JOE_HOST, events);   // launch
    const sounds: number[] = [];
    events.on("sound.play", (e) => sounds.push(e.id));
    const score = G.g_player_score[0];
    // `obj+0x70` is last frame's copy of the camera-space position, and the
    // kill is taken before the flight moves it: the position as it stands,
    // not put through the host's camera a second time (which negates z).
    const hitAt = vec3(c.pos.x, c.pos.y, c.pos.z);
    MarkBodyCreatureShot(c, 0);
    BodyCreatureUpdate(c, rng, JOE_HOST, events);
    check("a shot creature pays 0x50",
          G.g_player_score[0] === score + 0x50,
          `${score} -> ${G.g_player_score[0]}`);
    check("...plays COMMON\\MEET02_22.WAV", sounds.includes(0x3b16a9),
          `sounds ${sounds.map((x) => x.toString(16)).join(",")}`);
    const spray = G.g_point_blood_sprays[0]?.pos;
    check("...leaves blood at the point it was hit, in camera space",
          G.g_point_blood_sprays.length === 1 && !!spray
          && spray.x === hitAt.x && spray.y === hitAt.y && spray.z === hitAt.z
          && hitAt.z !== 0,
          `${G.g_point_blood_sprays.length} sprays at ${JSON.stringify(spray)}`
          + ` want ${JSON.stringify(hitAt)}`);
    check("...and falls the other way",
          c.state === BodyCreatureState.FallShot && c.flight.fallSpin > 0,
          `state ${BodyCreatureState[c.state]} spin ${c.flight.fallSpin}`);
    const lives = G.g_player_lives[0];
    const spin0 = c.flight.fallSpin;
    for (let i = 0; i < 10; i++) BodyCreatureUpdate(c, rng, JOE_HOST, events);
    check("...and tumbles the other way, accelerating",
          c.flight.fallSpin > spin0 && c.pitch > 0,
          `spin ${spin0} -> ${c.flight.fallSpin} pitch ${c.pitch}`);
    let live = true;
    for (let i = 0; i < 600 && live; i++) {
      live = BodyCreatureUpdate(c, rng, JOE_HOST, events);
    }
    check("...and never reaches the player", G.g_player_lives[0] === lives,
          `lives ${G.g_player_lives[0]}`);
    check("...and leaves on its own", !live);
  }

  // -- 5. the pool ---------------------------------------------------------
  {
    const rng = new Rng(17);
    const { joe, events } = joeScene(rng);
    SpawnBodyCreature(joe);
    check("the pool is stepped by `GameUpdate`, like the thrown weapons",
          G.g_body_creatures.length === 1);
    GameUpdate(1 / 60, JOE_HOST, rng, events);
    check("...so a creature launches without anybody calling it directly",
          G.g_body_creatures[0].state === BodyCreatureState.Fly,
          `state ${BodyCreatureState[G.g_body_creatures[0].state]}`);
    check("...and a reset empties it",
          (ResetGameGlobals(), G.g_body_creatures.length === 0));
  }

  // -- 6. the camera -------------------------------------------------------
  //
  // `SpawnBodyCreature` ends `RegisterEnemySlot` (`0x0043E77B`); every flying
  // frame `BodyCreatureUpdate` writes `obj+0x100` through the camera block's
  // view-to-world matrix (`0x009A6040 + index * 0x1A4`, `0x0043EAF3`) and
  // calls `RegisterForCameraTracking` (`0x0043EEF1`); both ways out of the
  // flight free the slot (`0x0043EC4E`, `0x0043EDAD`). `obj+0x121` is the
  // player it flies at, so the fill deals it a permit slot.
  {
    const rng = new Rng(18);
    const { joe, events } = joeScene(rng);
    joe.lookAt = vec3(1, 2, 3);
    const c = SpawnBodyCreature(joe);
    check("a new creature is enrolled straight into the first general slot",
          c.cameraSlot === 2 && G.g_enemy_slots[2].occupied === 1
          && G.g_enemy_slots[2].creature === c.id,
          `slot ${c.cameraSlot} ${JSON.stringify(G.g_enemy_slots[2])}`);
    check("...with the host's camera point as its own",
          c.lookAt.x === 1 && c.lookAt.y === 2 && c.lookAt.z === 3
          && c.lookAt !== joe.lookAt, JSON.stringify(c.lookAt));

    // A view-to-world matrix that is not the identity, and a world-to-view
    // one that is not its inverse, so only the right matrix gives the
    // numbers: x' = z + 10, y' = y + 20, z' = 30 - x.
    G.g_camera_index = 0;
    G.g_camera_view_to_world = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0,
                                10, 20, 30, 1];
    G.g_camera_eye = vec3(0, 0, 0);
    G.g_camera_candidates = [];
    G.g_camera_candidate_count = 0;
    BodyCreatureUpdate(c, rng, JOE_HOST, events);       // launch
    // The launch point is (0, 6.5, -40) in camera space (section 3).
    check("the launch frame registers it with the camera, at its position "
          + "carried out of camera space by the view-to-world matrix",
          c.state === BodyCreatureState.Fly
          && c.lookAt.x === -30 && c.lookAt.y === 26.5 && c.lookAt.z === 30,
          JSON.stringify(c.lookAt));
    // `|obj+0x40 - g_camera_eye| * 10`, with `obj+0x40` in camera space:
    // sqrt(6.5^2 + 40^2) = 40.52 -> 405.
    check("...keyed on its camera-space position against the eye, as the "
          + "engine sums it",
          G.g_camera_candidate_count === 1
          && G.g_camera_candidates[0].creature === c.id
          && G.g_camera_candidates[0].key === 405,
          JSON.stringify(G.g_camera_candidates));
    UpdateCameraEnemySlots();
    check("...and the next fill deals it slot 0, as a permit holder: its "
          + "`obj+0x121` is the player it flies at",
          c.target === 0 && c.cameraSlot === 0
          && G.g_enemy_slots[0].creature === c.id
          && G.g_enemy_slots[2].occupied === 0,
          `slot ${c.cameraSlot}`);
    G.g_camera_lookat_target = vec3(0, 0, 0);
    SelectCameraLookAtTarget();
    const look = G.g_camera_lookat_target;
    check("...so the camera looks at it alone",
          look.x === -30 && look.y === 26.5 && look.z === 30,
          JSON.stringify(look));

    // Shot, a few frames into the flight: the slot goes, and the routine
    // returns before the draw and the tail -- no registration, and the cel
    // drawn is still last frame's (the shot arm has reset `obj+0x1330`).
    for (let i = 0; i < 3; i++) {
      UpdateCameraEnemySlots();
      BodyCreatureUpdate(c, rng, JOE_HOST, events);
    }
    UpdateCameraEnemySlots();
    const cel = c.slot;
    MarkBodyCreatureShot(c, 0);
    BodyCreatureUpdate(c, rng, JOE_HOST, events);
    check("shot, it frees its slot and is not registered that frame",
          c.state === BodyCreatureState.FallShot && c.cameraSlot === 0
          && G.g_enemy_slots[0].occupied === 0
          && G.g_camera_candidate_count === 0,
          `occupied ${G.g_enemy_slots[0].occupied} `
          + `candidates ${G.g_camera_candidate_count}`);
    check("...nor does the shot frame reach the draw",
          cel !== 0x1d31 && c.slot === cel, `${cel} -> ${c.slot}`);
    BodyCreatureUpdate(c, rng, JOE_HOST, events);
    check("...and a falling creature registers no more",
          G.g_camera_candidate_count === 0,
          String(G.g_camera_candidate_count));
  }
  {
    // Not shot: the slot goes on the frame it reaches the player.
    const rng = new Rng(19);
    const { joe, events } = joeScene(rng);
    const c = SpawnBodyCreature(joe);
    let freedOnHit = false;
    for (let i = 0; i < 120 && c.state !== BodyCreatureState.FallAfterHit;
         i++) {
      UpdateCameraEnemySlots();
      const slot = c.cameraSlot;
      const was = slot >= 0 ? G.g_enemy_slots[slot].occupied : 0;
      BodyCreatureUpdate(c, rng, JOE_HOST, events);
      if ((c.state as BodyCreatureState) === BodyCreatureState.FallAfterHit) {
        freedOnHit = was === 1 && G.g_enemy_slots[slot].occupied === 0;
      }
    }
    check("a creature that reaches the player frees its slot on that frame",
          c.state === BodyCreatureState.FallAfterHit && freedOnHit,
          `state ${BodyCreatureState[c.state]} freed ${freedOnHit}`);
  }
}

// -- stage 3's two boats: what stands on one, and what rides the other -------

console.log("stage 3's boats -- the one the player rides and the one that "
            + "arrives:");
{
  // **Class 0x26 subtype 2 is a floor.** `Class26Subtype2Update`
  // (`FUN_0048EAD0`) seats `obj+0x14C` from its descriptor tail and raises
  // `obj+0x34 |= 0x51`, and `ColiTraceSegmentAllSets` (`FUN_004053B0`) opens
  // with a pass over exactly such objects, tracing the query through the
  // inverse of `obj+0x150`. Stage 3 block 0 step 4's zombie leaps onto the
  // boat's bow; with no such pass its ground snap found nothing under the
  // hull and stood it in the canal, waist-deep in the boat.
  //
  // The deck here is one quad at the boat's own y = -2, spanning x +-10 and
  // z 0..30 -- the shape of `coli3.bin:39944`, which is the foredeck in the
  // boat's space -- and the boat is turned a quarter, so an answer that
  // ignored the rotation would miss it.
  const rng = new Rng(26);
  ResetGameGlobals();
  EnterPlay();
  SetGameTables(CHARS);
  T.coli = { files: ["test"], blobs: {
    deck: coliQuad([0, 1, 0, 2], 1,
                   [-10, -2, 30, 10, -2, 30, 10, -2, 0, -10, -2, 0], 53),
  } } as unknown as typeof T.coli;
  G.g_coli_full_set = [];
  G.g_camera_fixed_eye_y = -999;          // so a fall-through is unmistakable
  const host: GameHost = {
    ...NULL_HOST,
    objectPath: (slot) => slot === 0x156
      ? { x: 100, y: -19, z: 200, pitch: 0, yaw: 0x4000, roll: 0 } : null,
  };
  G.g_active_cam_path = 0x7c;
  G.g_cam_path_frame = 855;
  const boat = ActorSpawn(3244, SpawnClass.Vehicle, -1, "boat", {
    hp: 2, class26: { coli: "deck" },
  }, rng);
  boat.visible = true;
  check("before its first tick the boat is no floor: the probe falls through",
        QueryGroundHeightAt(115, -10, 200) === -999,
        `${QueryGroundHeightAt(115, -10, 200)}`);
  GameUpdate(1 / 60, host, rng);
  check("the first tick seats the blob, raises 0x51 and takes the carrier",
        boat.coliBlob === "deck" && (boat.flags & 0x51) === 0x51
        && G.g_carrier_object === boat.at,
        `blob ${boat.coliBlob} flags ${boat.flags.toString(16)} `
        + `carrier ${G.g_carrier_object}`);
  check("...and the pose is the path's, two units up",
        boat.pos.x === 100 && boat.pos.y === -17 && boat.pos.z === 200,
        `${boat.pos.x},${boat.pos.y},${boat.pos.z}`);
  // Local (0, -2, 15) is world (100 + 15, -17 - 2, 200) under a quarter turn
  // of RotY: x' = x cos + z sin.
  const deck = QueryGroundHeightAt(115, -10, 200);
  check("a ground probe over the deck finds the deck, in world space",
        Math.abs(deck - -19) < 1e-4, `${deck}`);
  check("...and the material is the blob's",
        QueryGroundSurfaceAt(115, -10, 200) === 53,
        `${QueryGroundSurfaceAt(115, -10, 200)}`);
  check("...but not where the unturned deck would have been",
        QueryGroundHeightAt(100, -10, 215) === -999,
        `${QueryGroundHeightAt(100, -10, 215)}`);
  G.g_cur_actor = boat.at;
  check("an object never stands on its own blob (g_cur_actor)",
        QueryGroundHeightAt(115, -10, 200) === -999);
  G.g_cur_actor = -1;
  // A leaper's ground snap is exactly this probe: from six above its feet.
  const z = spawnZombie(0x2516, 1, "leaper");
  z.visible = true;
  z.pos = vec3(114, -19.5, 200);
  ActorSnapToGroundHeight(z);
  check("a zombie landing on the bow snaps to the deck, not the canal",
        Math.abs(z.pos.y - -19) < 1e-4, `${z.pos.y}`);
  // The sphere pass is the same list with the normal rotated properly.
  check("the body push sees the deck as well",
        ColiTestSphereAgainstFullSet(115, -18.5, 200, 1)
        && G.g_coli_hit_normal[1] > 0.99,
        `${G.g_coli_hit_normal}`);
  // `0x80008000` refuses an object whatever else it carries.
  boat.flags |= 0x8000;
  check("...and an object carrying 0x8000 takes no part",
        QueryGroundHeightAt(115, -10, 200) === -999);
  boat.flags &= ~0x8000;
  // The latch: on camera path 0x7C frame 0x140 the boat turns to face the
  // camera, and at 0x29E it turns back. The yaw is the camera block's plus
  // 0x8000, unmasked (`0x0048EDC6`), as the camera actor left it this frame;
  // `g_camera_yaw_bams` holds something else, which the old reading took.
  G.g_camera_block_yaw_bams = 0x1000;
  G.g_camera_yaw_bams = 0x3000;
  G.g_cam_path_frame = 0x140;
  GameUpdate(1 / 60, host, rng);
  check("the face-camera latch turns it to the camera block's yaw + 0x8000",
        boat.yaw === G.g_camera_block_yaw_bams + 0x8000
        && boat.yaw !== ((0x3000 + 0x8000) & 0xffff),
        `${boat.yaw.toString(16)} block ${G.g_camera_block_yaw_bams}`);
  G.g_cam_path_frame = 0x29e;
  GameUpdate(1 / 60, host, rng);
  check("...and the frame that drops it hands the yaw back to the path",
        boat.yaw === 0x4000, `${boat.yaw.toString(16)}`);
  // A camera path outside the switch skips the pose: the boat stays put.
  G.g_active_cam_path = 0x80;
  boat.pos.x = 1;
  GameUpdate(1 / 60, host, rng);
  check("a camera path the routine does not name leaves the pose alone",
        boat.pos.x === 1, `${boat.pos.x}`);
  T.coli = null;
}
{
  // **A carrier's rotation is in BAMS.** `CarrierTransformPoint` multiplied
  // by `vec.ts`'s `BAMS` -- BAMS *per radian* -- and so turned every rider by
  // 10430^2/65536 times the carrier's angle. The earlier test of it rode a
  // boat at yaw 0, where every wrong factor is right.
  const carrier = { pos: vec3(10, 0, 20), pitch: 0, yaw: 0x4000, roll: 0 };
  const out = vec3();
  CarrierTransformPoint(carrier as unknown as Parameters<
    typeof CarrierTransformPoint>[0], 1, 0, 0, out);
  check("a rider one unit along x on a boat turned a quarter is at -z",
        Math.abs(out.x - 10) < 1e-6 && Math.abs(out.z - 19) < 1e-6,
        `${out.x},${out.z}`);
}
{
  // **The script's spawns are made in the script's order.** One
  // `spawn_obj_c` places stage 3's arriving boat -- class 0x13, drawn by slot
  // -- and then what rides it; each rider's `Init` copies
  // `g_civilian_carrier`, which the boat's own `Init` has only just set. The
  // player built every character spawn before every slot actor, so the
  // riders copied no carrier at all and stood at their boat-relative offsets
  // from the world origin: the civilian and the zombie "missing" from the
  // other boat.
  const rng = new Rng(18);
  ResetGameGlobals();
  EnterPlay();
  SetGameTables({
    ...CHARS,
    placements: [
      { at: 3184, class: 0x13, char_type: -1, motion: null, hp: 0,
        yaw: 57344, init_flags: 0x8000,
        class13: { slot: 6711, cam_path: 130, cam_frame: 170, scale: 1,
                   behaviour: 8, selector: 1 } },
      { at: 2780, class: 0x18, char_type: 1, motion: 956, hp: 130,
        yaw: 16384, init_flags: 0x60400, initial_state: 35,
        attack_state: 48,
        class18: { from_state: 48, cue_path: 124, cue_frame: 1080 } },
      // A captor: in no script list, made by the `Init` of the spawn that
      // holds it (`CivilianInit` in the game; any listed spawn here).
      { at: 3072, class: 0x18, char_type: 1, motion: 956, hp: 220,
        yaw: 28672, init_flags: 0x60400, initial_state: 35,
        attack_state: 38, civilian_child: 2780,
        class18: { from_state: 38, cue_path: -1, cue_frame: -1 } },
    ],
  } as unknown as CharactersJson);
  const listed = [
    { at: 3184, class: SpawnClass.ScriptedProp,
      pos: [-1055, -26.25, -1620] as [number, number, number] },
    { at: 2780, class: SpawnClass.CarriedZombie,
      pos: [5, -6, -14] as [number, number, number] },
  ];
  // The character layer, reduced to its contract: the rider is placeable,
  // the boat is not one of its.
  const pool: CharacterPool = {
    rng,
    bindToPool: () => {},
    readySpawns: (spawns) => [
      ...spawns.filter((s) => s.at === 2780)
        .map((s) => ({ at: s.at, motion: 956, pos: vec3(5, -6, -14) })),
      { at: 3072, motion: 956, pos: vec3(-2, -6, 3), parentAt: 2780 },
    ],
    syncSpawns: () => [],
  };
  syncCharacterSpawns(pool, listed);
  // The `Init`s are the frame walk's (`SpawnFromDescriptor`); run them here.
  RunPendingInits(rng);
  const rider = G.g_object_list.find((o) => o.at === 2780);
  const boatObj = G.g_object_list.find((o) => o.at === 3184);
  check("the boat and its rider are both made",
        !!rider && !!boatObj, `${!!rider} ${!!boatObj}`);
  check("...boat first, so the rider rides it",
        rider?.carrierAt === 3184,
        `rider carrier ${rider?.carrierAt} / g_civilian_carrier `
        + `${G.g_civilian_carrier}`);
  // The first cut of the ordering walked the script's list alone, and a
  // captor is in no list: every civilian's captors stopped being made.
  const captor = G.g_object_list.find((o) => o.at === 3072);
  check("a captor the script does not list is still made",
        !!captor, `${!!captor}`);
  const order = G.g_object_list.map((o) => o.at);
  check("...straight after the spawn that holds it, on the same carrier",
        order.indexOf(3072) === order.indexOf(2780) + 1
        && captor?.carrierAt === 3184,
        `${order} carrier ${captor?.carrierAt}`);
}
{
  // **`CarrierPropRoutine6` (`FUN_004413C0`)** -- stage 3 block 7's boat.
  // Routine 1's machine on `op_` paths 352/353 at its own frames, with the
  // run-past arm rearranged: fade at 0x668, splash at 0x6A4, and the
  // `0x400000` bit raised with the state change at the path's end.
  const rng = new Rng(66);
  scene(0, rng);
  G.g_civilians_alive = 1;
  const seen: number[] = [];
  const host: GameHost = {
    ...NULL_HOST,
    objectPath: (slot, frame) => {
      seen.push(slot);
      return { x: frame, y: slot, z: 0, pitch: 0, yaw: 0, roll: 0 };
    },
  };
  const fr = (): ClassFrame => ({ dt: 1 / 60, rng, host });
  G.g_cam_path_frame = 0x600;
  const boat = ActorSpawn(29240, SpawnClass.ScriptedProp, -1, "boat", {
    class13: { slot: 6711, cam_path: 134, cam_frame: 340, scale: 1,
               behaviour: 8, selector: 6 },
  }, rng);
  const t = () => (boat as { prop13: ScriptedPropTail }).prop13;
  check("selector 6 has a routine now",
        typeof g_carrier_prop_routines[6] === "function"
        && CARRIER_SELECTORS_PORTED.has(6));
  ScriptedPropUpdate13(boat, fr());
  check("it rides op_ path 353 from the camera's frame",
        boat.pos.y === 0x161 && boat.pos.x === 0x600
        && t().state === CarrierState.RunIn,
        `${boat.pos.x} ${boat.pos.y} ${CarrierState[t().state]}`);
  t().pathFrame = 0x635;
  ScriptedPropUpdate13(boat, fr());
  check("...forks at 0x635 -- a civilian alive, so it pulls up",
        t().state === CarrierState.PullUp, CarrierState[t().state]);
  t().pathFrame = 0x672;
  ScriptedPropUpdate13(boat, fr());
  check("...on path 352, fading its wake at 0x672",
        boat.pos.y === 0x160 && t().wakeFade < 0,
        `${boat.pos.y} ${t().wakeFade}`);
  t().pathFrame = 0x6ae;
  ScriptedPropUpdate13(boat, fr());
  check("...and moors at 0x6AE", t().state === CarrierState.Moored,
        CarrierState[t().state]);
  const held = t().pathFrame;
  ScriptedPropUpdate13(boat, fr());
  check("a moored boat holds its frame", t().pathFrame === held);

  t().state = CarrierState.RunPast;
  t().wakeFade = 0;
  t().pathFrame = 0x668;
  ScriptedPropUpdate13(boat, fr());
  check("running past, the wake starts to fade at 0x668 and the bit waits",
        t().wakeFade < 0 && (boat.flags & 0x400000) === 0,
        `${t().wakeFade} ${boat.flags.toString(16)}`);
  // 0x6A4: the bow strip, eight units *ahead* along the boat's z (routine
  // 1's is five behind), and `0x000B16A9`.
  {
    const ev = new Events();
    const heard: number[] = [];
    ev.on("sound.play", (e) => heard.push(e.id));
    G.g_prop_strip_effects = [];
    t().pathFrame = 0x6a4;
    ScriptedPropUpdate13(boat, { ...fr(), events: ev });
    const bow = G.g_prop_strip_effects[0];
    check("at 0x6A4 routine 6 throws the bow strip 8 units along its z, "
          + "with the sound -- no longer a [diverges]",
          !!bow && bow.first === 0x174a && heard.includes(SFX_CARRIER_BOW)
          && Math.abs(bow.pos.z - (boat.pos.z + 8)) < 1e-6,
          `${bow?.pos.z} vs ${boat.pos.z}`);
    check("its wake sits 32.5 along the heading, routine 1's 27.0",
          CARRIER_GROUND_WAKE_DRAW[6].wakeZ === 32.5
          && CARRIER_GROUND_WAKE_DRAW[1].wakeZ === 27.0
          && CarrierDrawSlots(6).join() === CarrierDrawSlots(1).join());
  }
  t().pathFrame = 0x6ae;
  ScriptedPropUpdate13(boat, fr());
  check("...and at the path's end the strip starts and 0x400000 goes up",
        t().state === CarrierState.Wake && (boat.flags & 0x400000) !== 0,
        `${CarrierState[t().state]} ${boat.flags.toString(16)}`);
  ScriptedPropUpdate13(boat, fr());
  check("...and states 5/6 draw the strip cel they then step",
        t().stripDrawn === 0x1aab && t().stripCel === 0x1aac,
        `${t().stripDrawn.toString(16)}`);
}

// -- class 0x40, the horde -----------------------------------------------------
//
// `PlaceHorde` (`FUN_0043BD30`) and everything it leaves behind: the member's
// Init, its six live states, the kill, the corpse, the dive turn and the prop.
// The fixture is one character type, `mol.bin`'s three clips at their real
// play lengths, and no renderer.
console.log("\nclass 0x40, the horde:");
{
  const MOL = {
    type: HORDE_CHAR_TYPE, name: "mol", file: "mol.bin", bone_count: 10,
    bones: [],
    motions: {
      [String(HORDE_CLIP_LEAP)]: motion(16, 0, 29),
      [String(HORDE_CLIP_CRAWL)]: motion(16, 0, 29),
      [String(HORDE_CLIP_DEATH)]: motion(31, 0, 60),
    },
  } as unknown as CharacterType;
  const HORDE_CHARS = { ...CHARS,
    types: { ...CHARS.types, [String(HORDE_CHAR_TYPE)]: MOL } } as CharactersJson;
  const horde = (o: Actor) => (o as { horde: HordeTail }).horde;
  const HOST: GameHost = { ...NULL_HOST };
  const frame = (rng: Rng, events?: Events): ClassFrame =>
    ({ dt: 1 / 60, rng, host: HOST, events });

  /** A stage-1 or stage-2 room with the placer's descriptor as it ships. */
  const room = (scene: number, block: number, rng: Rng, players = 1) => {
    // Arcade, whatever an earlier test left: the mode is the title's, and a
    // Training or Boss game starts with one credit, which the start spends --
    // leaving none for player 2 to join on.
    G.g_GameMode = GameMode.Arcade;
    ResetGameGlobals();
    SetGameTables(HORDE_CHARS);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    EnterPlay();
    if (players === 2) JoinPlayerTwo();
    G.g_active_player = 0;
    G.g_scene_index = scene;
    G.g_evt_block_index = block;
    G.g_camera_fixed_eye_y = -10;
    G.g_camera_block_eye = vec3(-100, -2, -500);
    void rng;
  };
  const place = (at: number, selector: number, pos: Vec3, rng: Rng) =>
    ActorSpawn(at, SpawnClass.HordeSpawner, -1, "horde placer", {
      class40: { selector }, pos, visible: true,
    }, rng);
  const members = () => G.g_object_list.filter((o) => {
    const t = (o as { horde?: HordeTail }).horde;
    return !o.despawned && t && (t.kind === HordeKind.MemberInit
      || t.kind === HordeKind.Member || t.kind === HordeKind.Corpse);
  });
  const step = (rng: Rng, events?: Events) => {
    G.g_frame_counter += 1;
    for (const o of [...G.g_object_list]) {
      if (!o.despawned) HordeUpdate(o, frame(rng, events));
    }
    G.g_object_list = G.g_object_list.filter((o) => !o.despawned);
  };

  {
    // The counts. Selector 1 is eight, or ten with two players; blocks 0x0E
    // and 0x12 make six or eight; block 0x19 makes four whatever.
    const rng = new Rng(401);
    const cases: [number, number, number, number][] = [
      [0, 3, 1, 8], [0, 3, 2, 10], [1, 0x0e, 1, 6], [1, 0x12, 2, 8],
      [1, 0x19, 1, 4], [1, 0x19, 2, 4],
    ];
    for (const [sc, blk, players, want] of cases) {
      room(sc, blk, rng, players);
      const p = place(0x2b94, 1, vec3(-70, -10, -520), rng);
      check(`block ${blk.toString(16)} with ${players} player(s) makes ${want}`,
            members().length === want && p.despawned,
            `${members().length}, placer despawned ${p.despawned}`);
    }
    room(0, 3, rng);
    place(0x2cec, 2, vec3(-100.866, -7.78, -558.8), rng);
    const props = G.g_object_list.filter(
      (o) => (o as { horde?: HordeTail }).horde?.kind === HordeKind.EmergeProp);
    check("selector 2 is not a horde: one emerge prop and no members",
          props.length === 1 && members().length === 0,
          `${props.length} props, ${members().length} members`);
    check("...at the placer's x and the routine's own y and z",
          props.length === 1 && props[0].pos.x === -100.866
          && Math.abs(props[0].pos.y - -9.2769) < 1e-6
          && Math.abs(props[0].pos.z - -538.8) < 1e-6,
          props[0] ? `${props[0].pos.x},${props[0].pos.y},${props[0].pos.z}`
            : "none");
  }

  {
    // The Init runs as the member's first frame, not inside the placer.
    const rng = new Rng(409);
    room(0, 3, rng);
    place(0x2b94, 1, vec3(-70, -10, -520), rng);
    const ms = members();
    check("a member is allocated with its Init still to run",
          ms.every((m) => horde(m).kind === HordeKind.MemberInit)
          && G.g_enemies_alive === 0,
          `${ms.map((m) => HordeKind[horde(m).kind]).join(",")} `
          + `alive ${G.g_enemies_alive}`);
    step(rng);
    check("...and its first frame counts it into both counters",
          G.g_enemies_alive === 8 && G.g_enemies_present === 8,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
    const m0 = ms[0];
    const t0 = horde(m0);
    check("...in stage 1 block 3's formation, at the spline's first point",
          t0.formation === HordeFormation.Stage1Block3
          && Math.abs(m0.pos.x - (-70 + (-30 + -27) / 2)) < 1e-9
          && Math.abs(m0.pos.z - (-520 + (-20 + -16) / 2)) < 1e-9,
          `formation ${t0.formation} at ${m0.pos.x},${m0.pos.z}`);
    check("...a unit above the placer, out of the shot test, holding",
          m0.pos.y === -9 && (m0.flags & 0x8000) !== 0
          && t0.state === HordeState.Hold && horde(ms[3]).hold === 60,
          `y ${m0.pos.y} flags ${m0.flags.toString(16)} hold ${horde(ms[3]).hold}`);
    check("...and none of them is drawn while it holds",
          ms.every((m) => m.alpha === 0));
    step(rng);
    check("member 0's hold runs out on its first update and it comes up",
          t0.state === HordeState.Enter && G.g_horde_emerged === 1
          && (m0.flags & 0x8000) === 0,
          `${HordeState[t0.state]} emerged ${G.g_horde_emerged}`);
    check("...drawn, with its own slot in g_horde_members",
          m0.alpha === 1 && G.g_horde_members[0] === m0.at
          && m0.shotCentre.x === m0.pos.x && m0.shotCentre.z === m0.pos.z,
          `alpha ${m0.alpha} slot ${G.g_horde_members[0]}`);
    check("...and member 1 still holds, twenty frames behind",
          horde(ms[1]).state === HordeState.Hold, HordeState[horde(ms[1]).state]);
    let n = 0;
    for (; n < 400 && t0.state === HordeState.Enter; n += 1) step(rng);
    // Member 0 is the first diver, so it may take its dive from segment 4
    // once the first ninety frames are up; the scene is in play, so it does.
    check("the leader leaves its spline for the dive from segment 4",
          t0.state === HordeState.WindUp && t0.segment >= 4,
          `${HordeState[t0.state]} seg ${t0.segment} after ${n} frames`);
    const t1 = horde(ms[1]);
    for (let i = 0; i < 400 && t1.state !== HordeState.Wander; i += 1) {
      step(rng);
    }
    check("a follower walks all six segments and wanders",
          t1.state === HordeState.Wander && t1.segment === 6,
          `${HordeState[t1.state]} seg ${t1.segment}`);
  }

  {
    // A dive connects: one life, then the pull-out, then the turn passes.
    const rng = new Rng(419);
    room(0, 3, rng);
    place(0x2b94, 1, vec3(-70, -10, -520), rng);
    const ms = members();
    const m0 = ms[0];
    const t0 = horde(m0);
    const lives = G.g_player_lives[0];
    let saw = { wind: false, dive: false, jaw: false };
    let n = 0;
    for (; n < 2000 && t0.state !== HordeState.PullOut; n += 1) {
      step(rng);
      if (t0.state === HordeState.WindUp) saw.wind = true;
      if (t0.state === HordeState.Dive) {
        saw.dive = true;
        if (m0.flags & 0x10000000) saw.jaw = true;
      }
    }
    check("the leader winds up and dives",
          saw.wind && saw.dive && saw.jaw, JSON.stringify(saw));
    check("...and the bite takes a life at the end of the dive",
          G.g_player_lives[0] === lives - 1,
          `lives ${lives} -> ${G.g_player_lives[0]} after ${n} frames`);
    check("...and hands the dive turn to member 1", G.g_horde_diver === 1,
          `diver ${G.g_horde_diver}`);
    for (let i = 0; i < 400 && t0.state === HordeState.PullOut; i += 1) {
      step(rng);
    }
    check("...then it falls back to the ground and wanders at double speed",
          t0.state === HordeState.Wander && t0.speed === 2.0
          && (m0.flags & 0x10000000) === 0 && m0.pitch === 0,
          `${HordeState[t0.state]} speed ${t0.speed} pitch ${m0.pitch}`);
    check("...on the crawl clip again, a cut and not a blend",
          t0.sub.clip === HORDE_CLIP_CRAWL
          && (t0.sub.flags & SubModelFlag.Blending) === 0,
          `clip ${t0.sub.clip} flags ${t0.sub.flags}`);
  }

  {
    // No dive in a cut scene: `g_scene_state_major_entered != 2` refuses it
    // and keeps the turn.
    const rng = new Rng(421);
    room(0, 3, rng);
    G.g_scene_state_major_entered = 1;
    G.g_scene_state_major = 1;
    place(0x2b94, 1, vec3(-70, -10, -520), rng);
    for (let i = 0; i < 1500; i += 1) step(rng);
    check("outside play nobody dives, and nobody is hurt",
          members().every((m) => horde(m).state === HordeState.Wander
                                 || horde(m).state === HordeState.Enter)
          && G.g_player_lives[0] === G.g_start_lives,
          members().map((m) => HordeState[horde(m).state]).join(","));
  }

  {
    // One bullet, 80 points, both counters, a splash, a sixty-frame corpse --
    // and the room clears when the last one goes.
    const rng = new Rng(431);
    const events = new Events();
    const sounds: number[] = [];
    events.on("sound.play", (e: { id: number }) => sounds.push(e.id));
    room(0, 3, rng);
    place(0x2b94, 1, vec3(-70, -10, -520), rng);
    step(rng, events);
    const ms = members();
    const m0 = ms[0];
    m0.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
    step(rng, events);
    check("a member cannot be shot while it holds",
          horde(m0).state !== HordeState.Dead && G.g_enemies_alive === 8,
          `${HordeState[horde(m0).state]} alive ${G.g_enemies_alive}`);
    step(rng, events);
    const score = G.g_player_score[0];
    m0.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
    step(rng, events);
    check("one bullet kills a member that has come up, for 80",
          horde(m0).state === HordeState.Dead
          && horde(m0).kind === HordeKind.Corpse
          && G.g_player_score[0] - score === 80,
          `${HordeState[horde(m0).state]} +${G.g_player_score[0] - score}`);
    check("...dropping both counters at once",
          G.g_enemies_alive === 7 && G.g_enemies_present === 7,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
    check("...playing a STAGE1_SE PDMG_MORR and the splash's BOBBLE1",
          sounds.some((id) => id === 0x1e18a9 || id === 0x1d18a9)
          && sounds.includes(0x118a9),
          sounds.map((x) => x.toString(16)).join(","));
    check("...blending to the death clip, and leaving a splash behind",
          horde(m0).sub.clip === HORDE_CLIP_DEATH
          && G.g_object_list.some((o) => (o as { horde?: HordeTail })
            .horde?.kind === HordeKind.Splash));
    check("...and the corpse cannot be shot again", m0.hitRadius === 0);
    let n = 0;
    for (; n < 100 && !m0.despawned; n += 1) step(rng, events);
    // `if (0x3b < n++)`: sixty drawn frames, and it goes on the sixty-first.
    check("the corpse lasts sixty frames and gives its slot back",
          m0.despawned && n === 61 && !G.g_horde_members[0],
          `${n} frames, slot ${G.g_horde_members[0]}`);
    // Now the rest of the room.
    for (let i = 0; i < 3000 && G.g_enemies_alive > 0; i += 1) {
      for (const m of members()) {
        const t = horde(m);
        if (t.kind === HordeKind.Member && t.state !== HordeState.Hold) {
          m.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
        }
      }
      step(rng, events);
    }
    check("shooting every member clears the room for wait_enemies_alive",
          G.g_enemies_alive === 0 && G.g_enemies_present === 0,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
    for (let i = 0; i < 200; i += 1) step(rng, events);
    check("...and every object the horde made has gone",
          G.g_object_list.every((o) => {
            const t = (o as { horde?: HordeTail }).horde;
            return !t || t.kind === HordeKind.EmergeProp;
          }),
          G.g_object_list.map((o) => o.name).join(","));
  }

  {
    // **The blood is at the member's view-space point.** `0x0043C4AD` hands
    // `SpawnBloodSprayAtPoint` `obj + 0x40`, which reads `obj+0x70`: the
    // member's position through the camera, as last frame's tail left it. A
    // camera that turns a quarter about y and moves (L48), so the world
    // position handed over as it stands lands somewhere else.
    const view = (p: Vec3, out: Vec3) => {
      out.x = p.z + 5; out.y = p.y - 3; out.z = -p.x - 20;
    };
    const host: GameHost = {
      ...NULL_HOST,
      viewSpaceOfPoint: (p, out) => { view(p, out); return true; },
    };
    const viewStep = (rng: Rng) => {
      G.g_frame_counter += 1;
      for (const o of [...G.g_object_list]) {
        if (!o.despawned) HordeUpdate(o, { dt: 1 / 60, rng, host });
      }
      G.g_object_list = G.g_object_list.filter((o) => !o.despawned);
    };
    const rng = new Rng(432);
    room(0, 3, rng);
    place(0x2b94, 1, vec3(-70, -10, -520), rng);
    for (let i = 0; i < 3; i += 1) viewStep(rng);
    const m0 = members()[0];
    check("the member to shoot has come up",
          horde(m0).state === HordeState.Enter, HordeState[horde(m0).state]);
    const want = vec3();
    view(m0.pos, want);
    const blood = G.g_point_blood_sprays.length;
    m0.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
    viewStep(rng);
    const got = G.g_point_blood_sprays[blood]?.pos;
    check("a shot member bleeds at its view-space point, not its position",
          horde(m0).state === HordeState.Dead
          && G.g_point_blood_sprays.length === blood + 1 && !!got
          && Math.abs(got.x - want.x) < 1e-9
          && Math.abs(got.y - want.y) < 1e-9
          && Math.abs(got.z - want.z) < 1e-9,
          `${HordeState[horde(m0).state]} want ${JSON.stringify(want)} `
          + `got ${JSON.stringify(got)}`);
  }

  {
    // Formation 3's members may not be shot for the first frames of their
    // spline: `g_horde_shot_delay` is 10/8 there.
    const rng = new Rng(433);
    room(1, 0x0e, rng);
    place(0x7f7c, 1, vec3(-1062, -36, -1075), rng);
    step(rng);
    step(rng);
    const m0 = members()[0];
    check("stage 2 block 0x0E's member 0 is walking in",
          horde(m0).state === HordeState.Enter
          && horde(m0).formation === HordeFormation.Stage2Block14,
          `${HordeState[horde(m0).state]} formation ${horde(m0).formation}`);
    m0.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
    step(rng);
    check("...and cannot be shot for its first ten frames of it",
          horde(m0).state === HordeState.Enter, HordeState[horde(m0).state]);
    for (let i = 0; i < 10; i += 1) step(rng);
    m0.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
    step(rng);
    check("...and can after them", horde(m0).state === HordeState.Dead,
          HordeState[horde(m0).state]);
  }

  {
    // Formation 2 (stage 2 block 0x19): four members, none counted by the
    // Init, all counted exactly once when `g_script_flags[94]` rises.
    const rng = new Rng(439);
    room(1, 0x19, rng);
    place(0x113fc, 1, vec3(-530, 33, -1318), rng);
    for (let i = 0; i < 120; i += 1) step(rng);
    check("formation 2 counts nobody in until its flag",
          members().length === 4 && G.g_enemies_alive === 0
          && members().every((m) => horde(m).state === HordeState.Hold),
          `${members().length} alive ${G.g_enemies_alive}`);
    check("...and its members 3+ wait up at y = 41.4",
          Math.abs(members()[3].pos.y - 41.4) < 1e-9,
          `${members()[3].pos.y}`);
    G.g_script_flags[94] = 1;
    step(rng);
    check("...then all four at once, and each only once",
          G.g_enemies_alive === 4 && G.g_enemies_present === 4
          && members().every((m) => horde(m).state === HordeState.Enter),
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
    step(rng);
    check("...holding at four on the next frame",
          G.g_enemies_alive === 4, `${G.g_enemies_alive}`);
  }

  {
    // `g_active_cam_path == 0x47` freezes the whole routine.
    const rng = new Rng(443);
    room(0, 3, rng);
    place(0x2b94, 1, vec3(-70, -10, -520), rng);
    step(rng);
    step(rng);
    const m0 = members()[0];
    const x = m0.pos.x;
    G.g_active_cam_path = 0x47;
    for (let i = 0; i < 30; i += 1) step(rng);
    check("camera path 0x47 stops a member dead, undrawn",
          m0.pos.x === x && m0.alpha === 0, `${x} -> ${m0.pos.x}`);
  }

  {
    // The prop: lifted by the first member up, then a target.
    const rng = new Rng(449);
    const events = new Events();
    room(0, 3, rng);
    place(0x2cec, 2, vec3(-100.866, -7.78, -558.8), rng);
    const prop = G.g_object_list.find((o) => (o as { horde?: HordeTail })
      .horde?.kind === HordeKind.EmergeProp)!;
    const pt = horde(prop);
    step(rng, events);
    check("the prop waits for the horde", pt.propState === EmergePropState.Wait);
    place(0x2b94, 1, vec3(-70, -10, -520), rng);
    // The Init frame, the frame member 0 comes up (after the prop has run),
    // the frame the prop sees it, and the first frame of the lift.
    step(rng, events);
    step(rng, events);
    step(rng, events);
    step(rng, events);
    check("...lifts when the first member comes up",
          pt.propState === EmergePropState.Lift && pt.propPitch > 0,
          `${EmergePropState[pt.propState]} pitch ${pt.propPitch}`);
    for (let i = 0; i < 60 && pt.propState === EmergePropState.Lift; i += 1) {
      step(rng, events);
    }
    // `if (pitch < 0x4000) pitch += 0x600` overshoots to 0x4200 and stays:
    // the lift has no clamp. Only the settle writes 0x4000.
    check("...and comes to rest past upright, where the lift left it",
          pt.propState === EmergePropState.Rest && pt.propPitch === 0x4200,
          `${EmergePropState[pt.propState]} pitch ${pt.propPitch}`);
    G.g_camera_fixed_eye_y = -9.2769;
    prop.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
    const sparks = G.g_sprite_effects.length;
    step(rng, events);
    check("shot, it jumps and throws a spark",
          pt.propState === EmergePropState.Fall && pt.fallVy === 0.6
          && G.g_sprite_effects.length === sparks + 1
          && (prop.flags & ActorFlag.Hit) === 0,
          `${EmergePropState[pt.propState]} sparks ${G.g_sprite_effects.length}`);
    let n = 0;
    for (; n < 600 && pt.propState !== EmergePropState.Rest; n += 1) {
      step(rng, events);
    }
    check("...lands on a corner, rocks, and is at rest again",
          pt.propState === EmergePropState.Rest && pt.propPitch === 0x4000
          && pt.propRoll === 0, `${EmergePropState[pt.propState]} after ${n}`);
    // The lifetime: block 3's prop goes on the second step change.
    const s0 = G.g_evt_step_index;
    G.g_evt_step_index = s0 + 1;
    step(rng, events);
    check("...and outlives one step change", !prop.despawned);
    G.g_evt_step_index = s0 + 2;
    step(rng, events);
    check("...but not two, in block 3", prop.despawned);
  }

  {
    // The sub-model clock. A blend is five draws from a frozen pose to the new
    // clip's first frame, and then the clip runs from 0.
    const m = makeSubModel();
    m.clip = HORDE_CLIP_CRAWL;
    m.frame = 17;
    SubModelAdvanceClock(m, 29);
    check("unblended, the play frame is the frame modulo the play length",
          m.play === 17, `${m.play}`);
    m.frame = 40;
    SubModelAdvanceClock(m, 29);
    check("...wrapping at g_motion_play_length", m.play === 11, `${m.play}`);
    SubModelBlendToMotion(m, HORDE_CLIP_DEATH, 0, 4);
    check("a blend starts at frame 1, held on the new clip's start",
          m.frame === 1 && m.play === 0 && m.blendLen === 5
          && m.fromClip === HORDE_CLIP_CRAWL && m.fromPlay === 11);
    const seen: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      SubModelAdvanceClock(m, 60);
      seen.push(`${m.frame}/${m.play}/${m.flags & 1}`);
      m.frame += 1;
    }
    check("...and ends on its fifth draw, on frame 0 of the new clip",
          seen.join(" ") === "1/0/1 2/0/1 3/0/1 4/0/1 0/0/0 1/1/0",
          seen.join(" "));
    SubModelSetMotion(m, HORDE_CLIP_LEAP);
    check("a cut starts the clip at 0", m.frame === 0 && m.play === 0
          && m.clip === HORDE_CLIP_LEAP);
  }

  {
    // Stage 2 block 0x19's sheet: laid by member 0's Init, waiting a frame for
    // its model, reshaped while the step has changed at most once, frozen
    // after that and gone after the third.
    const rng = new Rng(457);
    room(1, 0x19, rng);
    G.g_evt_step_index = 1;
    place(0x113fc, 1, vec3(-530, 33, -1318), rng);
    step(rng);
    const sheets = () => G.g_object_list.filter((o) => {
      const k = (o as { horde?: HordeTail }).horde?.kind;
      return !o.despawned && (k === HordeKind.SheetAwait || k === HordeKind.Sheet);
    });
    const m0 = members()[0];
    // At the placer's point: `HordeMemberInit` calls it before it has moved
    // the member onto its spline or lifted it the unit.
    void m0;
    check("formation 2's member 0 lays one sheet, half a unit above the placer",
          sheets().length === 1
          && horde(sheets()[0]).propY === 33.5
          && horde(sheets()[0]).propX === -530,
          `${sheets().length} ${sheets()[0] ? horde(sheets()[0]).propY : ""}`);
    const sh = sheets()[0];
    check("...which waits one frame for its model",
          horde(sh).kind === HordeKind.SheetAwait);
    step(rng);
    step(rng);
    check("...and then reshapes every frame",
          horde(sh).kind === HordeKind.Sheet && horde(sh).drawn);
    G.g_active_cam_path = 0x47;
    step(rng);
    check("...but not while camera path 0x47 plays", !horde(sh).drawn);
    G.g_active_cam_path = 0x40;
    G.g_cam_path_frame = 0x120;
    step(rng);
    check("...nor path 0x40 between frames 0x10C and 0x168", !horde(sh).drawn);
    G.g_cam_path_frame = 0x169;
    step(rng);
    check("...and again after it", horde(sh).drawn);
    G.g_evt_step_index = 2;
    step(rng);
    check("one step change leaves it reshaping", horde(sh).drawn);
    G.g_evt_step_index = 3;
    step(rng);
    check("...a second freezes it for good",
          !horde(sh).drawn && (sh.flags & 0x4000000) !== 0);
    G.g_evt_step_index = 4;
    step(rng);
    check("...and it outlives the third", !sh.despawned);
    G.g_evt_step_index = 5;
    step(rng);
    check("...but not the fourth", sh.despawned);
    room(0, 3, rng);
    place(0x2b94, 1, vec3(-70, -10, -520), rng);
    step(rng);
    check("no other formation lays one", sheets().length === 0);
  }

  check("a member's address is the placer's, with the index in bits 20..23",
        HordeMemberAt(0x2b94, 3) === (0x10000000 | (3 << 20) | 0x2b94));
  void PlaceHorde;
}

{
  // **A civilian's children come straight after it.** Stage 2 block 16's
  // civilian (0xA134) rides the boat and `CivilianInit` builds its class-0x18
  // captor (0xA174) itself; the child is in `readySpawns` and not in the
  // walker's list. Walking only the list built no civilian child anywhere:
  // block 5's captors never came through the door and the boat carried no
  // zombie.
  const rng = new Rng(19);
  ResetGameGlobals();
  EnterPlay();
  SetGameTables({
    ...CHARS,
    placements: [
      { at: 0xa3e8, class: 0x13, char_type: -1, motion: null, hp: 0,
        yaw: 57344, init_flags: 0x8000,
        class13: { slot: 0x1a36, cam_path: 78, cam_frame: 1110, scale: 2.5,
                   behaviour: 8, selector: 0 } },
      { at: 0xa134, class: 0x10, char_type: 1, motion: 660, hp: 1,
        yaw: 61440 },
      { at: 0xa174, class: 0x18, char_type: 1, motion: 956, hp: 180,
        yaw: 32768, initial_state: 34, attack_state: 47,
        civilian_child: 0xa134,
        class18: { from_state: 47, cue_path: 78, cue_frame: 630 } },
    ],
  } as unknown as CharactersJson);
  const listed = [
    { at: 0xa3e8, class: SpawnClass.ScriptedProp,
      pos: [-1055, -26.25, -1620] as [number, number, number] },
    { at: 0xa134, class: SpawnClass.Civilian,
      pos: [1.5, 3, 7.5] as [number, number, number] },
  ];
  const order: number[] = [];
  const pool: CharacterPool = {
    rng,
    bindToPool: () => {},
    readySpawns: () => [
      { at: 0xa134, motion: 660, pos: vec3(1.5, 3, 7.5) },
      { at: 0xa174, motion: 956, pos: vec3(1, 3, -22.5), parentAt: 0xa134 },
    ],
    syncSpawns: (_s, made) => { order.push(...made.map((a) => a.at)); return []; },
  };
  syncCharacterSpawns(pool, listed);
  // The `Init`s are the frame walk's (`SpawnFromDescriptor`); run them here.
  RunPendingInits(rng);
  const child = G.g_object_list.find((o) => o.at === 0xa174);
  check("a civilian's class-0x18 child is made although no spawn lists it",
        !!child, order.map((x) => x.toString(16)).join());
  check("...straight after its parent, and it rides the boat",
        order.join() === [0xa134, 0xa174].join()
        && child?.carrierAt === 0xa3e8,
        `${order.map((x) => x.toString(16))} ${child?.carrierAt}`);
}

{
  // `SpawnPropStripEffect` (`FUN_0043FCA0`) kind 3 and its update: nothing
  // drawn on the spawn frame, then 0x174A..0x1785 once each, then gone.
  ResetGameGlobals();
  EnterPlay();
  const ev = new Events();
  const heard: number[] = [];
  ev.on("sound.play", (e) => heard.push(e.id));
  SpawnPropStripEffect({ pos: vec3(1, 2, 3), pitch: 0, yaw: 0x4000, roll: 0 },
                       PropStripKind.CarrierBow, 1.0, ev);
  const e = G.g_prop_strip_effects[0];
  check("the bow strip spawns waiting one frame, silent",
        !!e && e.delay === 1 && heard.length === 0);
  const seen: number[] = [];
  for (let i = 0; i < 100 && G.g_prop_strip_effects.length; i++) {
    PropStripEffectsTick();
    const x = G.g_prop_strip_effects[0];
    if (x) seen.push(x.slot);
  }
  check("...then draws 0x174A..0x1785 once each and despawns",
        seen.length === 0x3c && seen[0] === 0x174a
        && seen[seen.length - 1] === 0x1785
        && G.g_prop_strip_effects.length === 0,
        `${seen.length} ${seen[0]?.toString(16)}`);
  SpawnPropStripEffect({ pos: vec3(0, 0, 0), pitch: 0, yaw: 0, roll: 0 },
                       PropStripKind.Kind0, 1.0, ev);
  check("kinds 0 and 1 sound SIBUKI2 as they spawn",
        heard.join() === String(0x4116a9));
  check("the exporter carries every slot the carrier routines draw",
        CarrierDrawSlots(0).includes(0x25f) && CarrierDrawSlots(0).includes(0xfd4)
        && CarrierDrawSlots(0).includes(0x1031)
        && CarrierDrawSlots(1).includes(0x275) && CarrierDrawSlots(1).includes(0x1ad2)
        && CarrierDrawSlots(1).includes(0x174a) && CarrierDrawSlots(1).includes(0x1785)
        && CarrierDrawSlots(2).join() === "2386,2387"
        && CarrierDrawSlots(9).join() === "2386,2387"
        && CarrierDrawSlots(3).length === 0);
}

console.log("\nclass 0x42, the worm:");
{
  // The class's `.rdata` as `hod2lib/class42.ts` exports it -- every number
  // here is the EXE's, and `web/tools/checks/worm.ts` holds the exporter to
  // the image. The two half tracks are the one thing made up: a straight line
  // down at two units a frame, x one unit out, so a frame can be read back
  // off a position and frame 0 is not at the origin (L48).
  const track = (x: number, y0: number) => ({
    t: Array.from({ length: 60 }, (_, f) => [x, y0 - 2 * f, 0]).flat(),
    r: Array.from({ length: 60 }, (_, f) => [f * 16, 0, 0]).flat(),
  });
  const WORM: Class42Json = {
    offsets_6_8: [
      0, 0, -60, -50, 61, 54, 0, 35, -36, -2, 30, 10, -10, 30,
      10, -10,
    ],
    offsets_10_15: [
      0, 0, -50, -30, 40, -40, 10, 30, -40, 20, 60, 35, 20, 10,
      -20, -10, -10, -15, 10, 20, -30, 0, -30, 20, -20, 10, -10, -30,
      0, -20,
    ],
    drop_delay: [
      70, 90, 95, 105, 115, 125, 130, 135, 140, 145, 150, 155, 160, 165,
      170,
    ],
    yaw_offsets: [
      65024, 1024, 2560, 0, 2048, 3072, 65280, 0, 64000, 768, 2048, 1536, 384, 128,
      928,
    ],
    orbit_phase: [
      1024, 4096, 0, 2048, 256, 768, 1536, 512, 0, 0, 0, 0, 0, 0,
      0,
    ],
    crawl_steps: [
      0, -7, -14, -21, -29, -36, -43, -51, -58, -65, -73, -80, -87, -95,
      -102, -109, -117, -124, -131, -139, -146, -153, -161, -168, -175, -183, -190, -197,
      -205, -528, -835, -1128, -1405, -1667, -1915, -2148, -2367, -2572, -2764, -2941, -3106, -3257,
      -3395, -3520, -3633, -3734, -3822, -3898, -3963, -4016, -4058, -4089, -4107, -4124, -4141, -4159,
      -4177, -4196, -4215, -4235,
    ],
    crawl_scale: [
      5278, 13510, 13501, 5422, 13253, 13390, 5698, 12970, 13173, 6089, 12667, 12863,
      6580, 12347, 12473, 7154, 12016, 12015, 7797, 11678, 11503, 8491, 11338, 10950,
      9221, 10999, 10367, 9970, 10666, 9769, 10690, 10355, 9194, 11344, 10077, 8672,
      11934, 9830, 8200, 12464, 9613, 7777, 12935, 9424, 7400, 13352, 9260, 7068,
      13715, 9121, 6777, 14029, 9004, 6526, 14296, 8907, 6313, 14518, 8829, 6135,
      14699, 8768, 5990, 14841, 8722, 5877, 14946, 8689, 5792, 15018, 8668, 5735,
      15059, 8657, 5702, 15072, 8654, 5691, 14955, 8712, 5785, 14635, 8871, 6040,
      14156, 9108, 6421, 13566, 9400, 6892, 12910, 9726, 7415, 12234, 10061, 7954,
      11584, 10383, 8472, 11005, 10670, 8933, 10544, 10899, 9301, 10161, 11089, 9606,
      9786, 11275, 9905, 9420, 11457, 10197, 9063, 11633, 10482, 8717, 11805, 10758,
      8382, 11971, 11025, 8059, 12131, 11282, 7750, 12285, 11529, 7454, 12431, 11765,
      7173, 12571, 11989, 6907, 12702, 12200, 6658, 12826, 12399, 6426, 12941, 12584,
      6213, 13047, 12754, 6018, 13144, 12910, 5843, 13230, 13049, 5688, 13307, 13172,
      5555, 13373, 13278, 5444, 13428, 13367, 5357, 13471, 13437, 5293, 13503, 13487,
      5254, 13522, 13518, 5241, 13529, 13529, 5260, 13520, 13515,
    ],
    leap_path: [
      169, -193, 337, -387, 502, -584, 663, -784, 817, -986, 961, -1192, 1095, -1402,
      1215, -1616, 1318, -1833, 1404, -2051, 1474, -2269, 1530, -2484, 1572, -2693, 1604, -2897,
      1625, -3092, 1638, -3278, 1642, -3454, 1640, -3619, 1630, -3771, 1613, -3910, 1590, -4034,
      1563, -4142, 1535, -4234, 1509, -4311, 1486, -4370, 1470, -4414, 1459, -4440, 1456, -4449,
    ],
    leap_scale: [
      5278, 13510, 13501, 5350, 13528, 13411, 5552, 13580, 13157, 5868, 13663, 12760,
      6280, 13772, 12243, 6768, 13905, 11629, 7317, 14058, 10941, 7907, 14227, 10199,
      8521, 14410, 9428, 9141, 14603, 8650, 9749, 14802, 7886, 10327, 15004, 7160,
      10858, 15206, 6493, 11323, 15404, 5909, 11704, 15595, 5430, 11985, 15775, 5078,
      12193, 15948, 4802, 12372, 16115, 4538, 12520, 16273, 4293, 12638, 16417, 4074,
      12727, 16543, 3886, 12786, 16645, 3735, 12815, 16719, 3628, 12814, 16761, 3570,
      12784, 16767, 3569, 12724, 16731, 3629, 12635, 16650, 3758, 12516, 16518, 3961,
      12368, 16331, 4245, 12191, 16085, 4615, 11985, 15775, 5078, 11217, 14600, 6853,
      9809, 12440, 10110, 8439, 10317, 13282, 7785, 9250, 14801, 7733, 9070, 14935,
      7710, 8926, 15001, 7714, 8817, 15004, 7744, 8739, 14950, 7797, 8690, 14844,
      7870, 8668, 14692, 7961, 8671, 14498, 8067, 8694, 14268, 8187, 8737, 14008,
      8319, 8797, 13722, 8458, 8871, 13416, 8604, 8956, 13095, 8754, 9051, 12765,
      8906, 9152, 12430, 9056, 9258, 12097, 9204, 9365, 11770, 9346, 9472, 11456,
      9480, 9575, 11158, 9604, 9673, 10883, 9715, 9763, 10635, 9811, 9841, 10421,
      9890, 9907, 10245, 9950, 9957, 10112, 9987, 9989, 10029, 10000, 10000, 10000,
    ],
    halves: [{ motion: 0xbf, ...track(1, 2) }, { motion: 0xc0, ...track(-1, 3) }],
  };
  const worm = (o: Actor) => (o as { worm: WormTail }).worm;
  const HOST: GameHost = { ...NULL_HOST };
  const frame = (rng: Rng, events?: Events): ClassFrame =>
    ({ dt: 1 / 60, rng, host: HOST, events });
  const GROUND = 3.8;
  // The three descriptors as they ship: stage 2, `desc+0x25` 1, 0 and 2.
  const LONE_AT = 0xea04, COG_AT = 0xea2c, LARGE_AT = 0x11ec8;
  const row = (at: number, subtype: number) => ({
    at, class: SpawnClass.Worm, char_type: -1, motion: 0, hp: 1,
    body_condition: 0, initial_state: 0, attack_state: 0, ring_set: 0,
    yaw: 0, class42: { subtype },
  });
  const room = (rng: Rng, block: number, players = 1): Events => {
    G.g_GameMode = GameMode.Arcade;
    ResetGameGlobals();
    SetGameTables({ ...CHARS, class42: WORM, placements: [
      row(LONE_AT, 1), row(COG_AT, 0), row(LARGE_AT, 2),
    ] } as unknown as CharactersJson);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    EnterPlay();
    if (players === 2) JoinPlayerTwo();
    G.g_active_player = 0;
    G.g_scene_index = 1;
    G.g_evt_block_index = block;
    G.g_camera_fixed_eye_y = GROUND;
    void rng;
    return new Events();
  };
  const place = (at: number, subtype: number, pos: Vec3, yaw: number,
                 rng: Rng) =>
    ActorSpawn(at, SpawnClass.Worm, -1, "worm placer",
               { class42: { subtype }, pos, yaw, visible: true }, rng);
  const member = (placer: number, i: number) =>
    ActorByAt(WormMemberAt(placer, i));
  const listen = (events: Events): number[] => {
    const out: number[] = [];
    events.on("sound.play", (e) => out.push(e.id));
    return out;
  };

  {
    // Block 21 step 4's cog batch, sub-type 0, at its descriptor's point and
    // yaw. One player: six.
    const rng = new Rng(71);
    room(rng, 0x15);
    const p = place(COG_AT, 0, vec3(-924, 74.8, -1336), 40432, rng);
    const ms = [0, 1, 2, 3, 4, 5, 6].map((i) => member(COG_AT, i));
    check("the cog's placer builds six worms for one player, and goes",
          p.despawned && ms.slice(0, 6).every((m) => !!m && !m.despawned)
          && !ms[6], ms.map((m) => (m ? "+" : "-")).join(""));
    check("...each in both counters from the moment it is placed",
          G.g_enemies_alive === 6 && G.g_enemies_present === 6
          && G.g_worm_live_count === 6
          && ms.slice(0, 6).every((m, i) => G.g_worm_members[i] === m!.at),
          `${G.g_enemies_alive}/${G.g_enemies_present}/${G.g_worm_live_count}`);
    // `g_worm_offsets_6_8` row 1 is (-60, -50), a tenth each; the yaw is the
    // placer's plus `g_worm_yaw_offsets[1]`, 1024.
    const m1 = ms[1]!;
    check("member 1 sits a tenth of its offset from the placer, a quarter "
          + "turn pitched, turned by its own offset",
          Math.abs(m1.pos.x - (-924 - 6)) < 1e-4
          && Math.abs(m1.pos.z - (-1336 - 5)) < 1e-4 && m1.pos.y === 74.8
          && m1.pitch === 0x4000 && m1.yaw === 40432 + 1024
          && m1.hitRadius === 2.2,
          `${m1.pos.x},${m1.pos.z} pitch ${m1.pitch} yaw ${m1.yaw}`);
    // In block 0x15 it rides the cog: radius idx + 5, about (-924, -1336),
    // at `g_worm_orbit_phase[1] + 0x7800` -- a turn in which neither sin nor
    // cos is 0 or 1 -- and the angle steps back 0x80 after it is read.
    const a = (4096 + 0x7800) * ((2 * Math.PI) / 65536);
    WormUpdate(m1, frame(rng));
    check("on the cog, member 1 circles (-924, -1336) at radius six",
          Math.abs(m1.pos.x - (6 * Math.sin(a) - 924)) < 1e-4
          && Math.abs(m1.pos.z - (6 * Math.cos(a) - 1336)) < 1e-4
          && worm(m1).orbit === 4096 + 0x7800 - 0x80,
          `${m1.pos.x.toFixed(4)},${m1.pos.z.toFixed(4)}`);

    // Member 0's delay is `g_worm_drop_delay[0]`, seventy: the counter passes
    // it on the seventy-first frame.
    const m0 = ms[0]!;
    for (let i = 0; i < 70; i += 1) WormUpdate(m0, frame(rng));
    check("member 0 holds on for its seventy frames",
          worm(m0).state === WormState.Perch, WormState[worm(m0).state]);
    WormUpdate(m0, frame(rng));
    check("...and lets go on the seventy-first",
          worm(m0).state === WormState.Fall, WormState[worm(m0).state]);
    // From y 74.8 at 0.01633 a frame², it is under ground + 3.57 once
    // 0.01633 n(n+1)/2 > 74.8 - 7.37, n(n+1) > 8258.4: n = 91.
    const events = new Events();
    const heard = listen(events);
    for (let i = 0; i < 90; i += 1) WormUpdate(m0, frame(rng, events));
    check("...falls for ninety frames without landing",
          worm(m0).state === WormState.Fall && heard.length === 0,
          `${WormState[worm(m0).state]} y ${m0.pos.y.toFixed(3)}`);
    WormUpdate(m0, frame(rng, events));
    check("...and lands on the ninety-first, 0.8 above the ground, level, "
          + "with a PDMG_MORR from stage 2's bank",
          worm(m0).state === WormState.Splat
          && Math.abs(m0.pos.y - (GROUND + 0.8)) < 1e-6 && m0.pitch === 0
          && heard.length === 1
          && (heard[0] === SND_WORM_LAND_A || heard[0] === SND_WORM_LAND_B),
          `${WormState[worm(m0).state]} y ${m0.pos.y} ${heard.map((x) => x.toString(16))}`);
    // The splat: `++timer > 0x18`, so the twenty-fifth frame leaves it, with
    // the crawl's first row 8.
    for (let i = 0; i < 24; i += 1) WormUpdate(m0, frame(rng));
    check("the splat holds twenty-four frames, drawing 0x85C + n",
          worm(m0).state === WormState.Splat && worm(m0).timer === 24
          && worm(m0).drawnBody === WormBodyDraw.Member,
          WormState[worm(m0).state]);
    WormUpdate(m0, frame(rng));
    check("...and crawls from row 8 on the twenty-fifth",
          worm(m0).state === WormState.Crawl && worm(m0).frame === 8,
          `${WormState[worm(m0).state]} ${worm(m0).frame}`);
    // On the cog the crawl runs twice, rows 8..0x3A and then 0..0x3A: 51 and
    // 59 frames. Each row moves (step[i+1] - step[i]) * 0.01 * 0.6 * 0.8
    // along the yaw, so the whole is (step[59] - step[8] + step[59] -
    // step[0]) * 0.0048 = (-4177 - 4235) * 0.0048 from where it landed.
    const from = { x: m0.pos.x, z: m0.pos.z };
    for (let i = 0; i < 109; i += 1) WormUpdate(m0, frame(rng));
    check("...crawls for 110 frames on the cog",
          worm(m0).state === WormState.Crawl, WormState[worm(m0).state]);
    WormUpdate(m0, frame(rng));
    const go = (-4177 - 4235) * 0.01 * 0.6 * 0.800000011920929;
    const yaw = m0.yaw * ((2 * Math.PI) / 65536);
    check("...then waits, having crawled 40.4 units along its own yaw",
          worm(m0).state === WormState.Wait
          && Math.abs(m0.pos.x - (from.x + go * Math.sin(yaw))) < 1e-3
          && Math.abs(m0.pos.z - (from.z + go * Math.cos(yaw))) < 1e-3,
          `${WormState[worm(m0).state]} moved `
          + `${(m0.pos.x - from.x).toFixed(3)},${(m0.pos.z - from.z).toFixed(3)}`);
  }

  {
    // Two players: eight on the cog, and fifteen in block 26's batch.
    const rng = new Rng(73);
    room(rng, 0x15, 2);
    place(COG_AT, 0, vec3(-924, 74.8, -1336), 40432, rng);
    check("two players face eight on the cog",
          !!member(COG_AT, 7) && !member(COG_AT, 8)
          && G.g_enemies_alive === 8, `${G.g_enemies_alive}`);
    room(rng, 0x1a, 2);
    place(LARGE_AT, 2, vec3(-482, 29, -1333), 18730, rng);
    check("...and fifteen in block 26",
          !!member(LARGE_AT, 14) && G.g_enemies_alive === 15,
          `${G.g_enemies_alive}`);
    room(rng, 0x1a);
    place(LARGE_AT, 2, vec3(-482, 29, -1333), 18730, rng);
    check("one player faces ten there",
          !!member(LARGE_AT, 9) && !member(LARGE_AT, 10)
          && G.g_enemies_alive === 10, `${G.g_enemies_alive}`);
  }

  {
    // **Shot before it lands, it splits.** The kill is in the member's own
    // update, ahead of its state: blood, both counters, a WORM_TUBU and 80 to
    // the shooter, and the halves' heights from their motions' first frames.
    const rng = new Rng(79);
    const events = room(rng, 0x15);
    const heard = listen(events);
    place(COG_AT, 0, vec3(-924, 74.8, -1336), 40432, rng);
    const m2 = member(COG_AT, 2)!;
    const score = G.g_player_score[0];
    m2.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
    WormUpdate(m2, frame(rng, events));
    const y = m2.pos.y;
    check("a worm shot on the cog splits, and its routine is the death's",
          (m2.flags & WormFlag.Split) !== 0
          && worm(m2).routine === WormRoutine.Death
          && worm(m2).state === WormState.Dead, `${m2.flags.toString(16)}`);
    check("...out of both counters and its slot on the shot, for 80 and a "
          + "WORM_TUBU",
          G.g_enemies_alive === 5 && G.g_enemies_present === 5
          && G.g_worm_live_count === 5 && G.g_worm_members[2] === 0
          && G.g_player_score[0] - score === 80
          && heard.some((h) => h === SND_WORM_KILLED_A
                         || h === SND_WORM_KILLED_B),
          `${G.g_enemies_alive}/${G.g_enemies_present} `
          + `+${G.g_player_score[0] - score} ${heard.map((h) => h.toString(16))}`);
    check("...with its halves where their motions' first frames put them, "
          + "and the kill frame still drawn whole",
          worm(m2).halfY[0] === y + 2 && worm(m2).halfY[1] === y + 3
          && worm(m2).drawnBody === WormBodyDraw.Member,
          `${worm(m2).halfY}`);
    check("...and the leaper is a live member",
          G.g_worm_leaper !== 2 && G.g_worm_members[G.g_worm_leaper] !== 0,
          `${G.g_worm_leaper}`);
    WormClassUpdate(m2, frame(rng, events));
    const h = worm(m2).drawnHalves;
    check("the death draws both halves on frame 0 and steps them",
          h.length === 2 && h[0]!.t[1] === 2 && h[1]!.t[1] === 3
          && h[1]!.t[0] === -1 && worm(m2).halfFrame.join() === "1,1",
          JSON.stringify(h.map((x) => x.t)));
    // A half lands once its track's y, two down a frame from 2, puts it
    // under ground + 1.5 = 5.3: 2 - 2f + y < 5.3.
    const land = Math.floor((y + 2 - 5.3) / 2) + 1;
    for (let i = 1; i < land; i += 1) WormDeathUpdate(m2, frame(rng, events));
    const splashes = () => G.g_object_list.filter(
      (o) => o.cls === SpawnClass.HordeSpawner
             && (o as { horde: HordeTail }).horde.kind === HordeKind.Splash
             && !o.despawned).length;
    const before = splashes();
    check("half 0 is still in the air on its frame " + (land - 1),
          worm(m2).halfLanded[0] === 0, `${worm(m2).halfLanded}`);
    WormDeathUpdate(m2, frame(rng, events));
    check("...lands on frame " + land + " at the ground plus 1.5 and "
          + "splashes, then sinks",
          worm(m2).halfLanded[0] === 1 && splashes() === before + 1
          && Math.abs(worm(m2).halfY[0] - (GROUND + 1.5 - 0.025)) < 1e-6,
          `${worm(m2).halfLanded} ${worm(m2).halfY}`);
    for (let i = land + 1; i < 61; i += 1) WormDeathUpdate(m2, frame(rng, events));
    check("the death lasts sixty-one frames...", !m2.despawned);
    WormDeathUpdate(m2, frame(rng, events));
    check("...and is gone on the sixty-second", m2.despawned);
    check("...having moved no counter of its own",
          G.g_enemies_alive === 5 && G.g_enemies_present === 5,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
  }

  {
    // **Shot after it lands, it melts**: no split, the horde's splash where
    // it stands, and the death strip, `0x87A + n`, holding at 0x15. And the
    // shot is player 2's alone, so player 2 is paid.
    const rng = new Rng(83);
    const events = room(rng, 0x1a, 2);
    place(LARGE_AT, 2, vec3(-482, 29, -1333), 18730, rng);
    const m = member(LARGE_AT, 3)!;
    for (let i = 0; i < 400 && worm(m).state !== WormState.Crawl; i += 1) {
      WormUpdate(m, frame(rng, events));
    }
    const score = G.g_player_score[1];
    m.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer1;
    WormUpdate(m, frame(rng, events));
    const splash = G.g_object_list.find(
      (o) => o.cls === SpawnClass.HordeSpawner
             && (o as { horde: HordeTail }).horde.kind === HordeKind.Splash);
    check("a worm shot on the ground does not split, and pays player 2",
          (m.flags & WormFlag.Split) === 0 && worm(m).state === WormState.Dead
          && G.g_player_score[1] - score === 80,
          `${m.flags.toString(16)} +${G.g_player_score[1] - score}`);
    check("...and leaves the horde's splash a hundredth per index over the "
          + "ground",
          !!splash && splash.pos.x === m.pos.x && splash.pos.z === m.pos.z
          && Math.abs(splash.pos.y - (3 * 0.009999999776482582 + GROUND + 1))
             < 1e-6, `${splash?.pos.y}`);
    const strip: number[] = [];
    for (let i = 0; i < 24; i += 1) {
      WormDeathUpdate(m, frame(rng, events));
      strip.push(worm(m).drawnStrip);
    }
    check("...then draws the death strip 0..0x15 and holds its last frame",
          strip[0] === 0 && strip[0x15] === 0x15 && strip[23] === 0x15,
          strip.join(","));
  }

  {
    // **The leap.** Only the member `g_worm_leaper` names swells, for ten
    // frames, to `g_worm_leap_scale` row 0, and then leaps sixty frames at
    // the camera block `g_camera_index` names; unshot, it takes a life off
    // its player and bounces away, and the turn passes to the next member.
    const rng = new Rng(89);
    const events = room(rng, 0x1a);
    G.g_camera_block_eye = vec3(-470, 18, -1290);
    place(LARGE_AT, 2, vec3(-482, 29, -1333), 18730, rng);
    const L = G.g_worm_leaper;
    const m = member(LARGE_AT, L)!;
    for (let i = 0; i < 400 && worm(m).state !== WormState.Wait; i += 1) {
      WormUpdate(m, frame(rng, events));
    }
    for (let i = 0; i < 9; i += 1) WormUpdate(m, frame(rng, events));
    check("the leaper swells for nine frames...",
          worm(m).state === WormState.Wait && worm(m).timer === 9,
          `${WormState[worm(m).state]} ${worm(m).timer}`);
    WormUpdate(m, frame(rng, events));
    const eye = G.g_camera_block_eye;
    const face = (Math.trunc(Math.atan2(m.pos.x - eye.x, m.pos.z - eye.z)
                             * 10430.378350470453) << 16) >> 16;
    const range = Math.hypot(eye.x - m.pos.x, eye.z - m.pos.z);
    check("...and leaps on the tenth, turned square to the camera block",
          worm(m).state === WormState.Leap && m.yaw === face
          && Math.abs(worm(m).range - range) < 1e-9,
          `${WormState[worm(m).state]} yaw ${m.yaw} vs ${face}`);
    const from = { ...worm(m).leapFrom };
    for (let i = 0; i < 0x21; i += 1) WormUpdate(m, frame(rng, events));
    // Frame 0x20 is the path's first row, `{rise 169, reach -193}`.
    const a = m.yaw * ((2 * Math.PI) / 65536);
    check("frame 0x20 puts it the path's first row along its yaw",
          Math.abs(m.pos.x - (-193 * 0.009999999776482582 * Math.sin(a) * range
                              * 0.016179848047500653 + from.x)) < 1e-4
          && Math.abs(m.pos.z - (-193 * 0.009999999776482582 * Math.cos(a)
                                 * range * 0.016179848047500653 + from.z))
             < 1e-4, `${m.pos.x},${m.pos.z}`);
    const lives = G.g_player_lives[0];
    for (let i = 0x21; i < 0x3b; i += 1) WormUpdate(m, frame(rng, events));
    check("the leap has not landed by frame 0x3B",
          worm(m).state === WormState.Leap && G.g_player_lives[0] === lives);
    WormUpdate(m, frame(rng, events));
    check("...and takes a life at the sixtieth, and bounces",
          worm(m).state === WormState.Bounce
          && G.g_player_lives[0] === lives - 1,
          `${WormState[worm(m).state]} ${G.g_player_lives[0]}/${lives}`);
    check("...handing the leap to the next member",
          G.g_worm_leaper === (L + 1) % 10, `${G.g_worm_leaper} after ${L}`);
    for (let i = 0; i < 400 && !m.despawned; i += 1) {
      WormUpdate(m, frame(rng, events));
    }
    check("...which is gone under the ground, out of both counters",
          m.despawned && G.g_enemies_alive === 9 && G.g_enemies_present === 9
          && G.g_worm_members[L] === 0 && G.g_worm_live_count === 9,
          `${G.g_enemies_alive}/${G.g_enemies_present}/${G.g_worm_live_count}`);
  }

  {
    // Sub-type 1: one worm, counted nowhere, that drops from y 62 at 0.02722
    // a frame² and goes under y 30: 0.02722 n(n+1)/2 > 32, n = 48.
    const rng = new Rng(97);
    room(rng, 0x15);
    place(LONE_AT, 1, vec3(-912.7, 62, -1318.4), 37552, rng);
    const lone = ActorByAt(WormMemberAt(LONE_AT, WORM_LONE_SLOT))!;
    check("the lone drop is one worm in neither counter",
          !!lone && worm(lone).routine === WormRoutine.LoneDrop
          && G.g_enemies_alive === 0 && G.g_enemies_present === 0
          && lone.hitRadius === 3.0 && lone.yaw === 37552,
          `${G.g_enemies_alive}`);
    for (let i = 0; i < 47; i += 1) WormLoneDropUpdate(lone, frame(rng));
    check("...falling for forty-seven frames", !lone.despawned
          && worm(lone).drawnBody === WormBodyDraw.Lone,
          `${lone.pos.y}`);
    WormLoneDropUpdate(lone, frame(rng));
    check("...and gone on the forty-eighth, below y 30", lone.despawned,
          `${lone.pos.y}`);

    // Shot, it splits, and goes the frame half 0's track runs out.
    room(rng, 0x15);
    place(LONE_AT, 1, vec3(-912.7, 62, -1318.4), 37552, rng);
    const shot = ActorByAt(WormMemberAt(LONE_AT, WORM_LONE_SLOT))!;
    shot.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
    const score = G.g_player_score[0];
    WormLoneDropUpdate(shot, frame(rng));
    check("shot, it splits on the same frame, for no score",
          worm(shot).state === WormState.Dead
          && worm(shot).drawnHalves.length === 2
          && G.g_player_score[0] === score, `${worm(shot).drawnHalves.length}`);
    for (let i = 1; i < 0x3b; i += 1) WormLoneDropUpdate(shot, frame(rng));
    check("...draws its halves to frame 0x3A", !shot.despawned);
    WormLoneDropUpdate(shot, frame(rng));
    check("...and goes on the frame half 0 reaches 0x3B", shot.despawned);
  }

  {
    // The replay's question is per record: the lone drop counts nothing.
    const rng = new Rng(101);
    room(rng, 0x15);
    check("a replay retires the two batches at a room gate and not the lone "
          + "drop",
          WormCountsForEnemyGate({ at: COG_AT, class: 0x42, hp: 1 })
          && WormCountsForEnemyGate({ at: LARGE_AT, class: 0x42, hp: 1 })
          && !WormCountsForEnemyGate({ at: LONE_AT, class: 0x42, hp: 1 }));
    // ...and the script's spawn reaches `PlaceWormBatch` through the
    // director, which runs the members from the next frame's task walk.
    SpawnSlotActor({ at: COG_AT, class: 0x42, pos: [-924, 74.8, -1336] });
    // The placer's `Init` is the frame walk's; run it ahead of the frame so
    // the member it builds can be read before its first update.
    RunPendingInits(rng);
    const m = member(COG_AT, 1);
    const before = m ? worm(m).orbit : 0;
    run(1, rng, new Events());
    check("the script's spawn builds the batch and the frame runs it",
          !!m && worm(m).orbit === before - 0x80 && G.g_enemies_alive === 6,
          `${m ? worm(m).orbit : "none"} vs ${before}`);
    SetGameTables(CHARS);
  }
}
