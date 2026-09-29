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
import { G, ResetGameGlobals } from "../../src/game/globals";
import { NULL_HOST, type GameHost } from "../../src/game/host";
import {
  HordeFormation, HordeKind, HordeMemberAt, HordeState, HordeUpdate,
  PlaceHorde, SubModelAdvanceClock, SubModelBlendToMotion, SubModelSetMotion,
  HORDE_CHAR_TYPE, HORDE_CLIP_CRAWL, HORDE_CLIP_DEATH, HORDE_CLIP_LEAP,
  EmergePropState, type HordeTail,
} from "../../src/game/class40";
import { makeSubModel, SubModelFlag } from "../../src/game/class40/submodel";
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
import {
  check, motion, CHARS, SCENE_MAJOR_PLAYING, spawnZombie, openShutter, scene,
  EnterPlay, JoinPlayerTwo, coliQuad,
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
    MarkBodyCreatureShot(c, 0);
    BodyCreatureUpdate(c, rng, JOE_HOST, events);
    check("a shot creature pays 0x50",
          G.g_player_score[0] === score + 0x50,
          `${score} -> ${G.g_player_score[0]}`);
    check("...plays COMMON\\MEET02_22.WAV", sounds.includes(0x3b16a9),
          `sounds ${sounds.map((x) => x.toString(16)).join(",")}`);
    check("...leaves blood at the point it was hit",
          G.g_point_blood_sprays.length === 1,
          `${G.g_point_blood_sprays.length} sprays`);
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
