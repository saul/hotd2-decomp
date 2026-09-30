import type { CharactersJson, CharacterType } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { ActorSpawn, GameUpdate } from "../../src/game/director";
import { ScriptedPropUpdate13 } from "../../src/game/class13";
import { CarriedZombieUpdate18 } from "../../src/game/class18";
import { RegisterForShotTest } from "../../src/game/combat/shot_test";
import {
  ActorByAt, AppState, G, HIT_SLOT_NONE, ResetGameGlobals,
} from "../../src/game/globals";
import { NULL_HOST, type GameHost } from "../../src/game/host";
import {
  CarriedPropRoutine, MarkCarriedPropShot, type CarriedProp,
} from "../../src/game/carried_prop";
import {
  MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixToEulerZYX,
  VecAimXAxisYThenZ,
} from "../../src/game/matrix";
import { CameraTargetsClear, waitTargetsClear }
  from "../../src/script/waits/targets";
import { SetGameTables, T } from "../../src/game/tables";
import { ZombieState } from "../../src/game/class30/states";
import {
  ActorFlag, ZombieFlag2, type Actor, type ZombieActor,
} from "../../src/game/actor";
import { type ClassFrame } from "../../src/game/registry";
import type { TargetScriptJson } from "../../src/bundle/characters";
import { SpawnClass } from "../../src/game/spawn_class";
import { syncCharacterSpawns, type CharacterPool } from "../../src/app/systems";
import {
  CARRIER_RIDERS_DONE_BIT, CarrierBakeWorldPose, CarrierInverseTransformPoint,
  MatrixGetAngles, MatrixToEulerBams, RotXZY, RotYXZ,
} from "../../src/game/carrier";
import { bamsDelta } from "../../src/core/bams";
import { GameMode } from "../../src/game/game_mode";
import { vec3 } from "../../src/game/vec";
import { ResolveHit } from "../../src/game/combat/resolve_hit";
import type { ScriptJson } from "../../src/bundle";
import { Walker } from "../../src/script/walker";
import {
  ActorDrawsSceneLit, BuildEntitySpotlightArray, EntityLightLive, GUN_LIGHT_CONE,
  GUN_LIGHT_FIRST, RenderLightType, SceneLightArrayUpdate, SetPlayerAimFromPointer,
} from "../../src/game/scene_lights";
import { VecToAngles } from "../../src/game/vec";
import { ActorDrawsUnderSecondaryLights } from "../../src/game/light_sets";
import {
  EntityLightReleaseSlot, FLICKER_BROKEN, FLICKER_DEBRIS_COUNT, FLICKER_FADE_FRAMES,
  PlaceFlickerLightProp48, PropUpdateType48FlickerLight, SFX_FLICKER_BREAK,
} from "../../src/game/class41/type48";
import { ZombieAux } from "../../src/game/actor";
import { RunPendingInits, SpawnSlotActors } from "../../src/game/director";
import {
  check, motion, TYPE, CHARS, SCENE_MAJOR_PLAYING, spawnZombie, scene,
  EnterPlay,
} from "./harness";

console.log("\nclass 0x30 state 37 — the drum-carriers on stage 3's bridge:");
{
  // -- the matrix helpers the carried prop is built on --------------------
  // `MatrixToEulerZYX` (`FUN_004019E0`) has to give back the angles a
  // `RotZ; RotY; RotX` was built with, or a released drum snaps round.
  {
    const m = MatIdentity();
    MatrixRotateZ(m, 0x0900); MatrixRotateY(m, -0x2300); MatrixRotateX(m, 0x1400);
    const e = MatrixToEulerZYX(m);
    const near = (a: number, b: number) => Math.abs(a - b) <= 2;
    check("MatrixToEulerZYX undoes MatrixRotateZ; RotateY; RotateX",
          near(e.rz, 0x0900) && near(e.ry, -0x2300) && near(e.rx, 0x1400),
          `rz ${e.rz} ry ${e.ry} rx ${e.rx}`);
    const a = VecAimXAxisYThenZ(0, 0, -5);
    check("VecAimXAxisYThenZ: -Z is a quarter turn about Y from +X",
          a.ry === 0x4000 && a.rz === 0, `ry ${a.ry} rz ${a.rz}`);
  }

  const CARRY_TYPE: CharacterType = {
    ...TYPE,
    motions: {
      ...TYPE.motions,
      // 271 (0x10F) the carry and the wait for a permit; 267 the throw, which
      // lets go on play frame 24; 270 what state 38 stands in afterwards.
      "271": motion(20, 0, 38), "267": motion(30, 0, 58), "270": motion(20),
    },
  };
  const CARRY_CHARS = { ...CHARS, types: { "1": CARRY_TYPE } } as
    unknown as CharactersJson;
  // Stage 3 block 3 step 6's own script, with the loop count cut to two.
  const carryScript: TargetScriptJson = {
    state: ZombieState.CarryProp,
    head: { prop_type: 1, behaviour: 1, release: 4, offset: [0, 3.5, 2],
            spin: [512, 0, 0], launch: [30, -0.085, 0],
            motion: 271, frame: 0, loops: 2, mode: -2 },
    entries: [{ motion: 267, frame: 0, loops: 1, mode: 24 }],
  };
  const retireScript: TargetScriptJson = {
    state: ZombieState.RetireOffScreen,
    head: { point: [0, 0, -60], motion: 270, frame: 0, loops: 1, mode: 0 },
    entries: [],
  };
  // A camera at the origin looking down -Z: world and view space coincide, so
  // a drum's shot point is its world position. The two bones sit either side
  // of the carrier's head.
  const identity = MatIdentity();
  const CARRY_HOST: GameHost = {
    ...NULL_HOST,
    boneMatrix: (at, bone, out) => {
      const z = ActorByAt(at);
      if (!z || (bone !== 4 && bone !== 7)) return false;
      const m = MatIdentity();
      m[12] = z.pos.x + (bone === 4 ? -1 : 1); m[13] = z.pos.y + 10;
      m[14] = z.pos.z;
      for (let i = 0; i < 16; i++) out[i] = m[i];
      return true;
    },
    cameraMatrices: (w2v, v2w) => {
      for (let i = 0; i < 16; i++) { w2v[i] = identity[i]; v2w[i] = identity[i]; }
      return true;
    },
    viewSpaceOf: (at, out) => {
      const z = ActorByAt(at);
      if (!z) return false;
      out.x = z.pos.x; out.y = z.pos.y; out.z = z.pos.z;
      return true;
    },
  };
  const carryScene = (rng: Rng) => {
    ResetGameGlobals();
    SetGameTables(CARRY_CHARS);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    EnterPlay();
    G.g_active_player = 0;
    const z = spawnZombie(0x4050, 1, "drummer", {
      initialState: ZombieState.CarryProp,
      attackState: ZombieState.RetireOffScreen,
      script: { target: carryScript, attack: retireScript },
    }, rng);
    z.visible = true;
    z.pos = vec3(0, 0, -60);
    z.hp = 220;
    return { z, events: new Events() };
  };
  const step = (rng: Rng, events: Events) =>
    GameUpdate(1 / 60, CARRY_HOST, rng, events);
  const drum = (): CarriedProp | undefined => G.g_carried_props[0];

  // -- 1. the carry, the throw and the hit --------------------------------
  {
    const rng = new Rng(3);
    const { z, events } = carryScene(rng);
    check("state 37 is entered as itself, not as the maul",
          z.state === ZombieState.CarryProp, `state ${z.state}`);
    step(rng, events);
    step(rng, events);
    const d = drum();
    check("sub 0 allocates the drum, and its first update seats it in the hands",
          !!d && d.routine === CarriedPropRoutine.Held && d.hp === 3
          && d.slot === 0x0a57 && d.draw !== null,
          d ? `routine ${d.routine} hp ${d.hp} slot ${d.slot}` : "no drum");
    check("...holding the header's own clip, 271, not the list's first",
          z.motion === 271, `motion ${z.motion}`);
    let retiredWhileHolding = false, released = -1, claimed = -1;
    let hitFrame = -1, trackedInFlight = false, gateHeld = false;
    const lives = G.g_player_lives[0];
    for (let f = 0; f < 600 && hitFrame < 0; f++) {
      step(rng, events);
      const p = drum();
      if (claimed < 0 && G.g_attack_permits[0] === z.at) claimed = f;
      if (p && released < 0 && p.routine === CarriedPropRoutine.ThrowAtCamera) {
        released = f;
      }
      if (released < 0 && z.state === ZombieState.RetireOffScreen) {
        retiredWhileHolding = true;
      }
      if (p?.routine === CarriedPropRoutine.ThrowAtCamera) {
        trackedInFlight ||= G.g_camera_candidate_count > 0;
        G.g_camera_settled = 1;
        gateHeld ||= !waitTargetsClear.satisfied!(
          { kind: "targets" }, { op: 0x47 } as never,
          { host: { cameraTargetsClear: CameraTargetsClear },
            gameplayLive: () => true } as never);
      }
      if (p?.routine === CarriedPropRoutine.StuckToScreen) hitFrame = f;
    }
    check("the zombie never retires while it still holds its drum",
          !retiredWhileHolding);
    check("it claims the player's permit before it throws",
          claimed >= 0 && released > claimed,
          `claimed ${claimed} released ${released}`);
    check("the drum is released on the throw's cue and flies at the camera",
          released >= 0, `released ${released}`);
    check("a drum in the air is a camera candidate",
          trackedInFlight, `count ${G.g_camera_candidate_count}`);
    check("...so `wait_targets_clear` (0x47) holds while it flies", gateHeld);
    check("arriving with hit points left costs a life and sticks to the lens",
          hitFrame >= 0 && G.g_player_lives[0] === lives - 1,
          `hit ${hitFrame} lives ${G.g_player_lives[0]}`);
    for (let f = 0; f < 91; f++) step(rng, events);
    // The throw clip outlasts the flight, so the script ends -- and the
    // carrier turns to state 38 -- while the drum is still on the lens.
    check("...and the carrier's script has ended: it now retires",
          z.state === ZombieState.RetireOffScreen, `state ${z.state}`);
    check("ninety frames on the lens, then the drum goes and the permit with it",
          G.g_carried_props.length === 0 && G.g_attack_permits[0] === -1,
          `props ${G.g_carried_props.length} permit ${G.g_attack_permits[0]}`);
  }

  // -- 2. shot out of the air ----------------------------------------------
  {
    const rng = new Rng(5);
    const { events } = carryScene(rng);
    const sounds: number[] = [];
    events.on("sound.play", (e) => sounds.push(e.id));
    const lives = G.g_player_lives[0];
    let shots = 0, broke = false, slots: number[] = [];
    for (let f = 0; f < 600 && !broke; f++) {
      step(rng, events);
      const p = drum();
      if (p?.routine === CarriedPropRoutine.ThrowAtCamera && p.shootable
          && !(p.flags & 8) && shots < 3) {
        MarkCarriedPropShot(p, 0);
        shots++;
        slots.push(p.slot);
      }
      broke = p?.routine === CarriedPropRoutine.Break;
    }
    check("three hits break a type-1 drum in the air", broke, `shots ${shots}`);
    check("...stepping its draw slot down one per hit",
          slots.join(",") === `${0x0a57},${0x0a54},${0x0a53}`,
          slots.map((x) => x.toString(16)).join(","));
    check("...the last hit plays the break sound and frees the permit",
          sounds.includes(0x001616a9) && G.g_attack_permits[0] === -1,
          `permit ${G.g_attack_permits[0]}`);
    for (let f = 0; f < 60; f++) step(rng, events);
    check("...no life is lost, and the break is over in its clip's length",
          G.g_player_lives[0] === lives && G.g_carried_props.length === 0,
          `lives ${G.g_player_lives[0]} props ${G.g_carried_props.length}`);
  }
}


console.log("\nclass 0x30 state 37, release 3 — stage 1's barrel over the civilian:");
{
  const DROP_TYPE: CharacterType = {
    ...TYPE,
    motions: {
      ...TYPE.motions,
      "271": motion(20, 0, 38), "265": motion(20, 0, 38),
      "266": motion(20, 0, 38), "270": motion(20),
    },
  };
  // Stage 1 original block 6 step 1's script: two loops of 271, one of 265,
  // and the drop on frame 15 of 266, released into behaviour 3.
  const dropScript: TargetScriptJson = {
    state: ZombieState.CarryProp,
    head: { prop_type: 0, behaviour: 1, release: 3, offset: [0, 2, 0],
            spin: [512, 0, 0], launch: [0, -1.5, 0],
            motion: 271, frame: 0, loops: 2, mode: -2 },
    entries: [{ motion: 265, frame: 0, loops: 1, mode: -1 },
              { motion: 266, frame: 0, loops: 1, mode: 15 }],
  };
  const identity = MatIdentity();
  // The barrel sits between bones 4 and 7 of the carrier at y 10; the victim's
  // head is straight below it.
  const DROP_HOST: GameHost = {
    ...NULL_HOST,
    boneMatrix: (at, bone, out) => {
      const z = ActorByAt(at);
      if (!z || (bone !== 4 && bone !== 7)) return false;
      const m = MatIdentity();
      m[12] = z.pos.x + (bone === 4 ? -1 : 1); m[13] = z.pos.y + 10;
      m[14] = z.pos.z;
      for (let i = 0; i < 16; i++) out[i] = m[i];
      return true;
    },
    // The victim's head, pinned a few units under where the carrier holds
    // the barrel: the fixture's victim is only a target, and its own state
    // machine is not what is under test.
    boneSphere: (at, bone, out) => {
      const c = G.g_object_list.find((o) => o.name === "barrel man");
      if (at !== 0x3c38 || bone !== 2 || !c) return null;
      out.x = c.pos.x; out.y = c.pos.y - 2; out.z = c.pos.z + 1;
      return 1.5;
    },
    cameraMatrices: (w2v, v2w) => {
      for (let i = 0; i < 16; i++) { w2v[i] = identity[i]; v2w[i] = identity[i]; }
      return true;
    },
  };
  const rng = new Rng(9);
  ResetGameGlobals();
  EnterPlay();
  SetGameTables({ ...CHARS, types: { "1": DROP_TYPE } } as unknown as CharactersJson);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_scene_state_major = SCENE_MAJOR_PLAYING;
  G.g_app_state = AppState.InPlay;
  const victim = ActorSpawn(0x3c38, SpawnClass.Zombie, 1, "victim");
  victim.visible = true;
  victim.pos = vec3(0, 0, -60);
  const z = spawnZombie(0x3c7c, 1, "barrel man", {
    initialState: ZombieState.CarryProp,
    attackState: ZombieState.RetireOffScreen,
    script: { target: dropScript, attack: null }, targetAt: victim.at,
  }, rng);
  z.visible = true;
  z.pos = vec3(0, 0, -60);
  const events = new Events();
  const sounds: number[] = [];
  events.on("sound.play", (e) => sounds.push(e.id));
  let released = -1, killed = -1;
  for (let f = 0; f < 400 && killed < 0; f++) {
    GameUpdate(1 / 60, DROP_HOST, rng, events);
    const p = G.g_carried_props[0];
    if (released < 0 && p?.routine === CarriedPropRoutine.ThrowAtTarget) released = f;
    if (victim.flags & ActorFlag.Dead) killed = f;
  }
  // 271 twice (38 each), 265 once (38), then 266 to frame 15: about 130
  // frames of holding, not the second the maul took.
  check("the barrel is held through the header's two loops and 265 first",
        released > 110, `released on frame ${released}`);
  check("...and released into behaviour 3, not thrown at the camera",
        released >= 0);
  check("dropped on the target's head, it kills it and plays 0x1D16A9",
        killed > released && sounds.includes(0x001d16a9),
        `killed ${killed}`);
  const p = G.g_carried_props[0];
  check("...and bounces off: the contact leaves a pivot and a tumble",
        !!p && (p.pivot.x !== 0 || p.pivot.y !== 0 || p.pivot.z !== 0)
        && (p.spin[0] !== 512 || p.spin[1] !== 0 || p.spin[2] !== 0),
        p ? `pivot ${JSON.stringify(p.pivot)} spin ${p.spin}` : "no prop");
}

console.log("\na civilian's captors are made with it, though the script never lists them:");
{
  // `CivilianInit` (`FUN_0048A3E0`) spawns its children itself, so the
  // walker's spawn list names the civilian and not them. 6da5fab walked that
  // list to keep the script's order and left every captor in the game
  // unmade -- stage 1's barrel man over the civilian (bug 11) among them.
  const rng = new Rng(21);
  ResetGameGlobals();
  EnterPlay();
  SetGameTables({
    ...CHARS,
    placements: [
      { at: 15484, class: 0x30, char_type: 1, motion: 10, hp: 110, yaw: 0,
        initial_state: 1, attack_state: 1, civilian_child: 15416 },
    ],
  } as unknown as CharactersJson);
  const listed = [
    { at: 15416, class: SpawnClass.Civilian,
      pos: [0, 0, 0] as [number, number, number] },
  ];
  const pool: CharacterPool = {
    rng,
    bindToPool: () => {},
    // The character layer's contract: the civilian and, because its parent
    // is wanted, its captor.
    readySpawns: () => [
      { at: 15416, motion: 10, pos: vec3() },
      { at: 15484, motion: 10, pos: vec3(0, 5, 0), parentAt: 15416 },
    ],
    syncSpawns: () => [],
  };
  syncCharacterSpawns(pool, listed);
  const order = G.g_object_list.map((o) => o.at);
  check("the captor is made", order.includes(15484), `pool ${order}`);
  check("...straight after the civilian that owns it",
        order.indexOf(15484) === order.indexOf(15416) + 1, `pool ${order}`);
}
// -- the gun lights: BuildEntitySpotlightArray and its gates ----------------
//
// `BuildEntitySpotlightArray` (`FUN_00480AC0`) under `SceneLightArrayUpdate`
// (`FUN_00480970`), evt 0x14/0x15/0x16 through the walker, and the draw-path
// bit a class-0x30 descriptor's `+0x20` word raises. The renderer places its
// SpotLight from exactly these numbers, so these are the flashlight.
console.log("\nthe gun lights:");
{
  ResetGameGlobals();
  EnterPlay();
  SetGameTables(CHARS);
  // A camera one unit per axis of its own, at (10, 20, 30), looking down -z:
  // `viewPoint` is the camera block's +0x40 matrix, camera -> world.
  const eye = vec3(10, 20, 30);
  G.g_camera_block_eye = { ...eye };
  const host: GameHost = {
    ...NULL_HOST,
    viewPoint: (x, y, z, out) => { out.x = eye.x + x; out.y = eye.y + y; out.z = eye.z + z; },
  };
  SceneLightArrayUpdate(host);
  check("nothing is built while g_scene_lighting is clear",
        !G.g_entity_lights[GUN_LIGHT_FIRST].enabled && !EntityLightLive(GUN_LIGHT_FIRST));
  // evt 0x14, 0x15, 0x16 as stage 4 block 0 step 3 runs them.
  const script = {
    scene: 3, stage: 4, game_mode: 0, evt_file: "test", entry_block: 0,
    entry_step: 0, routes: [{ kind: "end", next: [-1, -1, -1] }],
    regions: [], cam_slots_used: [], warnings: [],
    blocks: [{
      index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
      steps: [{ index: 0, at: 0, ops: [
        { i: 0, at: 0, op: 0x14, name: "set_scene_lighting", cat: "light", enabled: true },
        { i: 1, at: 8, op: 0x15, name: "enable_entity_spotlights", cat: "light", raw: ["0x00000001"] },
        { i: 2, at: 16, op: 0x16, name: "set_ambient_light_rgb", cat: "light", rgb: [0.5, 0.6, 0.8] },
      ] }],
    }],
  } as unknown as ScriptJson;
  const w = new Walker(script, {
    enterRegion: () => undefined, loadSlot: () => undefined,
    unloadSlot: () => undefined, startCamera: () => undefined,
    onFeed: () => undefined, onBranch: () => undefined,
    playSound: () => undefined, aliveEnemies: () => null,
    presentEnemies: () => null,
    aliveCivilians: () => null, cameraFree: () => null,
    scriptFlagRaised: () => null,
    showMessage: () => null, endDialogue: () => undefined,
  });
  w.tick(1 / 60);
  check("evt 0x14 and 0x15 write g_scene_lighting and g_entity_spotlights_on",
        G.g_scene_lighting === 1 && G.g_entity_spotlights_on === 1,
        `${G.g_scene_lighting} ${G.g_entity_spotlights_on}`);
  check("evt 0x16 writes g_light_array_ambient",
        G.g_light_array_ambient.join() === "0.5,0.6,0.8",
        G.g_light_array_ambient.join());

  SetPlayerAimFromPointer(0, 0, 0);
  SceneLightArrayUpdate(host);
  const l = G.g_entity_lights[GUN_LIGHT_FIRST];
  check("player 1's light is entry 1, a spot, and live",
        l.enabled && l.type === RenderLightType.Spot && EntityLightLive(GUN_LIGHT_FIRST));
  check("...one unit in front of the eye for a centred crosshair",
        l.pos.x === 10 && l.pos.y === 20 && l.pos.z === 29,
        `${l.pos.x} ${l.pos.y} ${l.pos.z}`);
  check("...pointing away from the eye",
        Math.abs(l.dir.z + 1) < 1e-9 && Math.abs(l.dir.x) < 1e-9 && Math.abs(l.dir.y) < 1e-9,
        `${l.dir.x} ${l.dir.y} ${l.dir.z}`);
  check("...with the engine's constants",
        l.att0 === 0.5 && l.theta === GUN_LIGHT_CONE && l.phi === GUN_LIGHT_CONE
        && l.diffuse.join() === "1,1,1");
  // The block eye a frame ahead of the matrix, as it is in the page for one
  // frame whenever the camera moves: the aim is the matrix's own, `pos` minus
  // the matrix origin, because in the engine `+0x40` is built out of that eye.
  // Read from `g_camera_block_eye` it swung off by the camera's travel and
  // the torch flickered between two aims on a moving camera.
  G.g_camera_block_eye = { x: eye.x + 3, y: eye.y, z: eye.z - 4 };
  SceneLightArrayUpdate(host);
  check("the aim does not depend on g_camera_block_eye, only on the matrix",
        Math.abs(l.dir.z + 1) < 1e-9 && Math.abs(l.dir.x) < 1e-9
        && Math.abs(l.dir.y) < 1e-9,
        `${l.dir.x} ${l.dir.y} ${l.dir.z}`);
  G.g_camera_block_eye = { ...eye };
  // An aim up and to the right: the light sits there at depth 1 and points
  // along eye -> it. This is the VecToAngles pitch sign: it was written
  // "the obvious way" and pointed the torch down when aimed up.
  SetPlayerAimFromPointer(0, 320.1, 320.1);
  SceneLightArrayUpdate(host);
  const n = Math.hypot(0.5, 0.5, 1);
  check("an aim up and right puts the light up and right",
        Math.abs(l.pos.x - 10.5) < 1e-9 && Math.abs(l.pos.y - 20.5) < 1e-9,
        `${l.pos.x} ${l.pos.y}`);
  check("...and points it up and right, not down",
        // To BAMS rounding: `VecToAngles` truncates the yaw to s16 and
        // recovers the horizontal length through it, as the engine does.
        Math.abs(l.dir.x - 0.5 / n) < 1e-4 && Math.abs(l.dir.y - 0.5 / n) < 1e-4
        && Math.abs(l.dir.z + 1 / n) < 1e-4,
        `${l.dir.x} ${l.dir.y} ${l.dir.z}`);
  check("VecToAngles gives a negative pitch looking up, as FUN_004016B0 does",
        VecToAngles(0, 1, 1).pitch < 0);
  check("player 2 has no input device, so no light",
        !G.g_entity_lights[GUN_LIGHT_FIRST + 1].enabled);
  G.g_entity_spotlights_on = 0;
  BuildEntitySpotlightArray(host);
  check("evt 0x15 off switches it off", !l.enabled);
  G.g_entity_spotlights_on = 1;
  G.g_scene_lighting = 0;
  SceneLightArrayUpdate(host);
  check("...and with 0x14 off the entry is not submitted",
        !EntityLightLive(GUN_LIGHT_FIRST));

  // The draw path. `EnemyZombieInit` seeds obj+0x136C's low half from the
  // descriptor's +0x20 word, and `EnemyZombieInitByCharType` raises obj+0x38
  // bit 3 from its 0x20 -- which is what puts stage 4's zombies under the
  // torch. The port used to drop the word, so the bit never rose.
  G.g_scene_lighting = 1;
  const lit = spawnZombie(0x2000, 1, "lit", { descFlags: 0x20 } as Partial<Actor>);
  const plain = spawnZombie(0x2001, 1, "plain", { descFlags: 0 } as Partial<Actor>);
  check("a class-0x30 descriptor with +0x20 bit 0x20 raises obj+0x38 bit 3",
        !!(lit.flags38 & ZombieAux.SceneLit), `flags38 ${lit.flags38}`);
  check("...and draws through the scene light array", ActorDrawsSceneLit(lit));
  check("...one without it does not", !ActorDrawsSceneLit(plain));
  G.g_scene_lighting = 0;
  check("...and nothing does while g_scene_lighting is clear",
        !ActorDrawsSceneLit(lit));
}

// -- class 0x41 type 48: the lamp and its point light ------------------------
//
// `PlaceFlickerLightProp48` (`FUN_00463B20`) and `PropUpdateType48FlickerLight`
// (`FUN_0046DDE0`). Stage 2 block 26 step 1 places the one the game ships.
console.log("\nclass 0x41 type 48, the lamp:");
{
  ResetGameGlobals();
  EnterPlay();
  // The mode is not scene state and an earlier section leaves Training up,
  // where a prop hit pays nothing.
  G.g_GameMode = GameMode.Arcade;
  const rng = new Rng(3);
  const events = new Events();
  const sounds: number[] = [];
  events.on("sound.play", (e) => sounds.push((e as { id: number }).id));
  const lamp = PlaceFlickerLightProp48(
    { at: 0x11ef0, lifetime_evt_steps: 2 }, -450, 12.7, -1330.3, 0);
  const slot = lamp.flicker!.lightSlot;
  check("it claims entry 3, the first past the gun lights",
        slot === 3 && G.g_entity_lights[3].inUse, `slot ${slot}`);
  PropUpdateType48FlickerLight(lamp, rng, events);
  const e = G.g_entity_lights[slot];
  check("whole, it lights a point light at the lamp",
        e.enabled && e.type === RenderLightType.Point && e.pos.x === -450
        && e.diffuse.join() === "20,20,15" && e.att0 === 0.15 && e.range === 1024);
  const a0 = e.att2;
  PropUpdateType48FlickerLight(lamp, rng, events);
  check("...and flickers: att2 moves with the phase",
        a0 === 0.02 && e.att2 !== a0 && Math.abs(e.att2 - 0.02) <= 0.01,
        `${a0} -> ${e.att2}`);
  check("...and it is shootable, 1.2 below its origin, radius 3",
        lamp.shotRegistered && Math.abs(lamp.shotY - 11.5) < 1e-9
        && lamp.hitRadius === 3);
  lamp.flags |= 0x8 | 0x2;          // hit by player 0
  lamp.shotRegistered = false;      // the pool clears it at the top of a frame
  const score = G.g_player_score[0] ?? 0;
  PropUpdateType48FlickerLight(lamp, rng, events);
  check("a shot breaks it: sound, score, thirty pieces",
        (lamp.flags & FLICKER_BROKEN) !== 0 && sounds.includes(SFX_FLICKER_BREAK)
        && lamp.flicker!.debris.length === FLICKER_DEBRIS_COUNT
        && (G.g_player_score[0] ?? 0) === score + 10,
        `sounds ${sounds} pieces ${lamp.flicker!.debris.length} `
        + `score ${score} -> ${G.g_player_score[0]}`);
  check("...and the light stays on, fading",
        e.enabled && Math.abs(e.att2 - 0.02) < 1e-9 && !lamp.shotRegistered);
  const y0 = lamp.flicker!.debris[0].y;
  for (let i = 0; i < 30; i++) PropUpdateType48FlickerLight(lamp, rng, events);
  check("...the pieces fly up and fall", lamp.flicker!.debris[0].y !== y0);
  for (let i = 0; i < FLICKER_FADE_FRAMES; i++) {
    PropUpdateType48FlickerLight(lamp, rng, events);
  }
  check("...and after ninety frames the light is out", !e.enabled);
  G.g_evt_step_index += 1; PropUpdateType48FlickerLight(lamp, rng, events);
  G.g_evt_step_index += 1; PropUpdateType48FlickerLight(lamp, rng, events);
  G.g_evt_step_index += 1; PropUpdateType48FlickerLight(lamp, rng, events);
  check("past its lifetime it dies and gives the entry back",
        lamp.dead && !G.g_entity_lights[3].inUse);
  EntityLightReleaseSlot(3);
}

console.log("\nclass 0x30 state 37, release 5 — stage 2's rolling barrels, the drop and the break:");
{
  const ROLL_TYPE: CharacterType = {
    ...TYPE,
    motions: {
      ...TYPE.motions,
      "271": motion(20, 0, 38), "274": motion(20, 0, 38),
      "267": motion(30, 0, 58), "270": motion(20),
    },
  };
  // Stage 2 block 28's script (78264), with the loops cut short.
  const rollScript: TargetScriptJson = {
    state: ZombieState.CarryProp,
    head: { prop_type: 1, behaviour: 1, release: 5, offset: [0, 3.5, 2],
            spin: [512, 0, 0], launch: [0, 0.35, -1],
            motion: 271, frame: 10, loops: 1, mode: -3 },
    entries: [{ motion: 274, frame: 40, loops: 1, mode: -3 },
              { motion: 267, frame: 0, loops: 1, mode: 24 }],
  };
  const retire: TargetScriptJson = {
    state: ZombieState.RetireOffScreen,
    head: { point: [0, 0, -60], motion: 270, frame: 0, loops: 1, mode: 0 },
    entries: [],
  };
  // Effect 0x12, the drum's break: two halves on bones 1 and 2, one key.
  const DRUM_EFFECT = {
    nodes: [{ slot: 0, bone: 0, children: [1, 2] },
            { slot: 0x0a56, bone: 1, children: [] },
            { slot: 0x0a55, bone: 2, children: [] }],
    interp: 0, motion: 0x1cf, play_length: 30, frames: 1, bones: 2,
    t: [0, 1, 0, 0, -1, 0], r: [0, 0, 0, 0, 0, 0], cues: [],
  };
  const identity = MatIdentity();
  const HOST: GameHost = {
    ...NULL_HOST,
    boneMatrix: (at, bone, out) => {
      const z = ActorByAt(at);
      if (!z || (bone !== 4 && bone !== 7)) return false;
      const m = MatIdentity();
      m[12] = z.pos.x + (bone === 4 ? -1 : 1); m[13] = z.pos.y + 10;
      m[14] = z.pos.z;
      for (let i = 0; i < 16; i++) out[i] = m[i];
      return true;
    },
    cameraMatrices: (w2v, v2w) => {
      for (let i = 0; i < 16; i++) { w2v[i] = identity[i]; v2w[i] = identity[i]; }
      return true;
    },
    viewSpaceOf: () => false,
  };
  const scene2 = (seed: number) => {
    const rng = new Rng(seed);
    ResetGameGlobals();
    SetGameTables({ ...CHARS, types: { "1": ROLL_TYPE } } as unknown as CharactersJson);
    T.breakables = { effects: { "18": DRUM_EFFECT } } as never;
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    EnterPlay();
    G.g_active_player = 0;
    G.g_camera_fixed_eye_y = -20;
    const z = spawnZombie(0x131b8, 1, "barrel roller", {
      initialState: ZombieState.CarryProp,
      attackState: ZombieState.RetireOffScreen,
      script: { target: rollScript, attack: retire },
    }, rng);
    z.visible = true;
    z.pos = vec3(0, 0, -100);
    // Already facing the camera, as the carry's turn leaves it: its own +Z
    // away from the eye, so the script's launch `-Z` rolls at the player.
    z.yaw = 0x8000;
    z.hp = 220;
    return { rng, z, events: new Events() };
  };
  const drum = (): CarriedProp | undefined => G.g_carried_props[0];

  // -- 1. the roll ---------------------------------------------------------
  // On flat ground friction stops a barrel long before a hundred units -- the
  // real one has stage 2's steps to fall down -- so this carrier stands inside
  // the forty units where a grounded roll re-aims its arc at the lens.
  {
    const { rng, z, events } = scene2(31);
    z.pos = vec3(0, 0, -36);
    const sounds: number[] = [];
    events.on("sound.play", (e) => sounds.push(e.id));
    const lives = G.g_player_lives[0];
    let released = -1, grounded = false, drawn = false, hit = -1;
    for (let f = 0; f < 1200 && hit < 0; f++) {
      GameUpdate(1 / 60, HOST, rng, events);
      const p = drum();
      if (p?.routine === CarriedPropRoutine.RollAtCamera) {
        if (released < 0) released = f;
        grounded ||= sounds.includes(0x001916a9);
        drawn ||= p.draw !== null;
      }
      if (p?.routine === CarriedPropRoutine.StuckToScreen) hit = f;
    }
    check("release 5 hands the drum to the roll, not to nothing",
          released >= 0, `released ${released}`);
    check("...which is drawn, lands and plays the ground sound",
          drawn && grounded);
    check("...and rolls on to the lens and costs a life",
          hit > released && G.g_player_lives[0] === lives - 1,
          `hit ${hit} lives ${G.g_player_lives[0]}`);
  }

  // -- 2. the carrier dies holding it -------------------------------------
  {
    const { rng, z, events } = scene2(33);
    for (let f = 0; f < 5; f++) GameUpdate(1 / 60, HOST, rng, events);
    const x0 = drum()?.shotPoint.z ?? NaN;
    z.flags |= ActorFlag.Dead;
    let moved = false, drawn = false;
    for (let f = 0; f < 120; f++) {
      GameUpdate(1 / 60, HOST, rng, events);
      const p = drum();
      if (p?.routine === CarriedPropRoutine.FallFree) {
        drawn ||= p.draw !== null;
        moved ||= Math.abs(p.pos.z - x0) > 0.1;
      }
    }
    check("a carrier killed with its drum drops it into the fall",
          drum()?.routine === CarriedPropRoutine.FallFree,
          `routine ${drum()?.routine}`);
    // At rest its centre sits the record's `+0x0C` (5.0) above the ground.
    check("...which is drawn, is pushed off, and comes to rest on the ground",
          drawn && moved && Math.abs((drum()?.pos.y ?? 0) - (-20 + 5)) < 0.5,
          `drawn ${drawn} moved ${moved} y ${drum()?.pos.y}`);
  }

  // -- 3. the break draws its effect -------------------------------------
  {
    const { rng, events } = scene2(35);
    let broke = false, parts: number[] = [];
    for (let f = 0; f < 1200 && !broke; f++) {
      GameUpdate(1 / 60, HOST, rng, events);
      const p = drum();
      if (p?.routine === CarriedPropRoutine.RollAtCamera && p.shootable
          && !(p.flags & 8)) MarkCarriedPropShot(p, 0);
      if (p?.routine === CarriedPropRoutine.Break) {
        broke = true;
        GameUpdate(1 / 60, HOST, rng, events);
        parts = (drum()?.parts ?? []).map((x) => x.slot);
      }
    }
    check("a broken drum draws effect 0x12's two halves",
          broke && parts.join(",") === `${0x0a56},${0x0a55}`,
          `parts ${parts.map((x) => x.toString(16))}`);
  }
}

// -- light block 1: LightsUseSecondarySet --------------------------------------
//
// `LightsUseSecondarySet` (`FUN_0041DC70`) lights every character with light
// block 1, which evt 0x19 and 0x24/0x25/0x27 write. The walker used to drop
// those as no-ops.
console.log("\nlight block 1 (the characters' light):");
{
  ResetGameGlobals();
  EnterPlay();
  SetGameTables(CHARS);
  const script = {
    scene: 0, stage: 1, game_mode: 0, evt_file: "test", entry_block: 0,
    entry_step: 0, routes: [{ kind: "end", next: [-1, -1, -1] }],
    regions: [], cam_slots_used: [], warnings: [],
    blocks: [{
      index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
      steps: [{ index: 0, at: 0, ops: [
        { i: 0, at: 0, op: 0x19, name: "set_light1_direction", cat: "light",
          pitch_deg: 270, yaw_deg: 0 },
        { i: 1, at: 12, op: 0x24, name: "light1_set", cat: "light",
          light_block: 1, channel: 6, value: 0.8 },
        { i: 2, at: 24, op: 0x27, name: "light1_tween_time", cat: "light",
          light_block: 1, channel: 10, value: 0.3, tween: "time", frames: 4 },
        { i: 3, at: 36, op: 0x20, name: "light0_set", cat: "light",
          light_block: 0, channel: 6, value: 0.5 },
      ] }],
    }],
  } as unknown as ScriptJson;
  const w = new Walker(script, {
    enterRegion: () => undefined, loadSlot: () => undefined,
    unloadSlot: () => undefined, startCamera: () => undefined,
    onFeed: () => undefined, onBranch: () => undefined,
    playSound: () => undefined, aliveEnemies: () => null,
    presentEnemies: () => null,
    aliveCivilians: () => null, cameraFree: () => null,
    scriptFlagRaised: () => null,
    showMessage: () => null, endDialogue: () => undefined,
  });
  check("both blocks start at LightBlockInit's ambient, 0.7",
        w.light.ambient === 0.7 && w.lightSecondary.ambient === 0.7);
  w.tick(1 / 60);
  check("...and 0x27 leaves block 1's ambient tweening, not set",
        w.lightBlock1.tweens[10]?.to === 0.3 && w.lightSecondary.ambient === 0.7);
  // The script ends after the four instructions, and a finished walker runs
  // no more frames; step the block the way `PushSceneLightStateToDevice`
  // would for the four frames the tween asks for.
  w.lightBlock1.step(4);
  const b1 = w.lightSecondary;
  check("evt 0x19 sets block 1's direction, not block 0's",
        b1.pitchDeg === 270 && w.light.pitchDeg === 0,
        `b1 ${b1.pitchDeg} b0 ${w.light.pitchDeg}`);
  check("evt 0x24 sets block 1's colour, 0x20 block 0's",
        b1.rgb[0] === 0.8 && w.light.rgb[0] === 0.5,
        `b1 ${b1.rgb[0]} b0 ${w.light.rgb[0]}`);
  check("evt 0x27 tweens block 1's ambient to its target",
        Math.abs(b1.ambient - 0.3) < 1e-9, `${b1.ambient}`);
  const z = spawnZombie(0x3000, 1, "z");
  check("a zombie draws under block 1 (ZombieAdvanceMotion's first call)",
        ActorDrawsUnderSecondaryLights(z));
}

{
  // **A shot rider dies.** Class 0x18's update is `CarriedZombieUpdate18`
  // (`FUN_0045CD90`), which runs `EnemyZombieUpdate` and so `ZombieOnShot`
  // (`FUN_00453EB0`) -- but `ResolveHit` left the hit record `ZombieOnShot`
  // reads only on classes 0x30 and 0x31. A rider shot to zero was flagged
  // dead, kept standing in state 35, and held `g_enemies_alive` for ever:
  // stage 3 block 1 step 1's `wait_enemies_alive` never opened.
  const rng = new Rng(18);
  scene(0, rng);
  const host: GameHost = {
    ...NULL_HOST,
    objectPath: () => ({ x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }),
  };
  G.g_cam_path_frame = 1000;
  ActorSpawn(0x9c00, SpawnClass.ScriptedProp, -1, "boat", {
    class13: { slot: 6711, cam_path: 130, cam_frame: 170, scale: 1,
               behaviour: 8, selector: 1 },
  }, rng).visible = true;
  const rider = ActorSpawn(0x9c01, SpawnClass.CarriedZombie, 1, "rider", {
    pos: vec3(5, -6, -14), initialState: 35, attackState: 48, flags: 0x60400,
    class18: { from_state: 48, cue_path: -1, cue_frame: -1 },
  }, rng) as ZombieActor;
  rider.visible = true;
  const alive = G.g_enemies_alive;
  GameUpdate(1 / 60, host, rng);
  rider.hp = 1;
  const kill = ResolveHit(rider, 1, host, rng);
  check("a rider shot to zero is killed", kill.killed && rider.dead);
  GameUpdate(1 / 60, host, rng);
  check("...and its own update sends it into a death state",
        rider.state === ZombieState.Death
        || rider.state === ZombieState.DeathKnockbackArc,
        `state ${ZombieState[rider.state] ?? rider.state}`);
  check("...which takes it out of g_enemies_alive",
        G.g_enemies_alive === alive - 1,
        `${alive} -> ${G.g_enemies_alive}`);
}
{
  // The camera cue fires **before** its frame, not after: `CMP
  // [g_cam_path_frame], ECX` / `JGE` past the arm at `0x0045CE07`.
  const rng = new Rng(19);
  scene(0, rng);
  const host: GameHost = {
    ...NULL_HOST,
    objectPath: () => ({ x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 }),
  };
  ActorSpawn(0x9d00, SpawnClass.ScriptedProp, -1, "boat", {
    class13: { slot: 6711, cam_path: 130, cam_frame: 170, scale: 1,
               behaviour: 8, selector: 1 },
  }, rng);
  const r = ActorSpawn(0x9d01, SpawnClass.CarriedZombie, 1, "rider", {
    pos: vec3(5, -6, -14), initialState: 48, flags: 0x60400,
    class18: { from_state: ZombieState.HoldForCameraCue, cue_path: 124,
               cue_frame: 1080 },
  }, rng) as ZombieActor;
  const frame: ClassFrame = { dt: 1 / 60, rng, host };
  // The wrapper tests the state *after* `EnemyZombieUpdate` has run it, so
  // the "from" state here is one that holds sub 0 across an update --
  // `HoldForCameraCue`. The shipped riders name 48 and 38.
  G.g_active_cam_path = 124;
  G.g_cam_path_frame = 1080;
  r.state = ZombieState.HoldForCameraCue; r.sub = 0;
  CarriedZombieUpdate18(r, frame);
  check("at the cue frame itself the rider is not switched",
        r.state !== 0x2e, `state ${r.state}`);
  G.g_cam_path_frame = 1079;
  r.state = ZombieState.HoldForCameraCue; r.sub = 0;
  CarriedZombieUpdate18(r, frame);
  check("...before it, it is sent to state 0x2E",
        r.state === 0x2e, `state ${r.state}`);
}

console.log("class 0x30 states 46-48, a second reading of main's port:");
{
  // `g_class30_states[46..48]` = `0x0045CFC0`, `0x0045D120`, `0x0045D500`,
  // which the port had no case for: a rider that won its permit fell to the
  // dispatch's `default` and gave the attack up on the boat.
  const rng = new Rng(46);
  scene(0, rng);
  const host: GameHost = { ...NULL_HOST };
  const frame: ClassFrame = { dt: 1 / 60, rng, host };
  G.g_camera_fixed_eye_y = -30;             // the ground, when the probe misses
  const boat = ActorSpawn(0x9e00, SpawnClass.ScriptedProp, -1, "boat", {
    class13: { slot: 6711, cam_path: -1, cam_frame: -1, scale: 1,
               behaviour: 0, selector: 0 },
  }, rng);
  boat.pos = vec3(100, -17, 200);
  boat.yaw = 0x4000;
  G.g_civilian_carrier = boat.at;
  const leap = { state: 48, entries: [], head: {
    point: [130, 0, 180] as [number, number, number], vy: 1,
    gravity: -0.04, motion: 10, release: 0, flag_frame: 75 } };
  const r = ActorSpawn(0x9e01, SpawnClass.CarriedZombie, 1, "rider", {
    pos: vec3(5, -6, -14), initialState: 48, attackState: 48,
    flags: 0x60400,
    script: { target: null, attack: leap },
    class18: { from_state: 48, cue_path: -1, cue_frame: -1 },
  }, rng) as ZombieActor;
  r.visible = true;
  r.hp = 130;
  check("the rider is on the boat", r.carrierAt === boat.at);

  // State 46: idle, turning toward the camera measured in the boat's space.
  r.state = ZombieState.HoldOnCarrier; r.sub = 0; r.yaw = 0;
  CarriedZombieUpdate18(r, frame);
  check("state 46 settles into its sub 1 and stays on the boat",
        r.state === ZombieState.HoldOnCarrier && r.sub === 1
        && r.carrierAt === boat.at, `${r.state}/${r.sub}`);
  const y0 = r.yaw;
  CarriedZombieUpdate18(r, frame);
  check("...turning, 0x68 a frame, toward the camera in carrier space",
        r.yaw !== y0 && Math.abs(((r.yaw - y0 + 0x8000) & 0xffff) - 0x8000)
          <= 0x68, `${y0} -> ${r.yaw}`);

  // State 48: the leap off.
  r.state = ZombieState.LeapOffCarrierAtMark; r.sub = 0;
  CarriedZombieUpdate18(r, frame);
  check("state 48 sub 0 plays the clip and raises NoHitReaction",
        r.sub === 1 && (r.flags & ActorFlag.NoHitReaction) !== 0);
  // Where the boat's matrix will put it: local (x, y, z) under a quarter
  // turn is (100 + z, -17 + y, 200 - x).
  const lx = r.pos.x, ly = r.pos.y, lz = r.pos.z, lyaw = r.yaw;
  const wx = 100 + lz, wy = -17 + ly, wz = 200 - lx;
  CarriedZombieUpdate18(r, frame);
  check("on the launch frame it steps off -- world space, no carrier",
        r.carrierAt === -1 && r.sub === 2
        && (r.flags2 & ZombieFlag2.Leaping) !== 0, `${r.carrierAt} ${r.sub}`);
  check("...baked through the boat's matrix, position and yaw",
        // ...less the first step of the arc, which `EnemyZombieUpdate`
        // integrates straight after the state on the same frame.
        Math.abs(r.pos.x - r.vel.x - wx) < 1e-3
        && Math.abs(r.pos.y - r.vel.y - wy) < 1e-3
        && Math.abs(r.pos.z - r.vel.z - wz) < 1e-3
        && Math.abs((((r.yaw - (lyaw + 0x4000)) & 0xffff) + 0x8000 & 0xffff)
                    - 0x8000) <= 0x68,  // ...and one 0x68 turn after it
        `${r.pos.x.toFixed(2)},${r.pos.y.toFixed(2)},${r.pos.z.toFixed(2)}`
        + ` yaw ${r.yaw} from ${lyaw} want ${wx},${wy},${wz}`);
  // t = |vy / accel| = 25 frames up, 50 in all: vel spans the gap in 2t.
  check("...and aims a parabola at the scripted world point",
        Math.abs(r.vel.x - (130 - wx) / 50) < 1e-4
        && Math.abs(r.vel.z - (180 - wz) / 50) < 1e-4
        && r.vel.y === 1 && r.accY === -0.04,
        `${r.vel.x} ${r.vel.z} ${r.vel.y} ${r.accY}`);
  let n = 0;
  while (r.sub === 2 && n++ < 400) CarriedZombieUpdate18(r, frame);
  check("it lands on the ground and moves to sub 3",
        r.sub === 3 && r.pos.y === -30 && r.vel.y === 0,
        `sub ${r.sub} y ${r.pos.y} after ${n}`);
  n = 0;
  while (r.state === ZombieState.LeapOffCarrierAtMark && n++ < 400) {
    CarriedZombieUpdate18(r, frame);
  }
  check("...and once the clip has played out it attacks: AttackRun",
        r.state === ZombieState.AttackRun || r.state > 0,
        `state ${ZombieState[r.state] ?? r.state}`);

  // State 47: launched along its own facing.
  const fwd = { state: 47, entries: [], head: {
    dist: 2, vy: 1.5, motion: 10, release: 0, flag_frame: 40 } };
  const q = ActorSpawn(0x9e02, SpawnClass.CarriedZombie, 1, "rider2", {
    pos: vec3(0, -6, 0), initialState: 47, attackState: 47, flags: 0x60400,
    script: { target: null, attack: fwd },
    class18: { from_state: 47, cue_path: -1, cue_frame: -1 },
  }, rng) as ZombieActor;
  q.visible = true; q.hp = 130;
  q.state = ZombieState.LeapOffCarrierForward; q.sub = 0; q.yaw = 0;
  CarriedZombieUpdate18(q, frame);
  CarriedZombieUpdate18(q, frame);
  // Baked yaw is the boat's quarter turn: -sin/-cos of 0x4000 is (-2, 0).
  check("state 47 launches along the baked facing at the scripted speed",
        q.carrierAt === -1 && Math.abs(q.vel.x + 2) < 1e-6
        && Math.abs(q.vel.z) < 1e-6 && q.vel.y === 1.5
        && Math.abs(q.accY + 0.1088888868689537) < 1e-9,
        `${q.vel.x} ${q.vel.z} ${q.vel.y} ${q.accY}`);
}
{
  // **Stage 2 block 16's boat rider, after its maul.** `ZombieScriptEnded`
  // sends it to its attack state, 47, and `CarriedZombieUpdate18`'s cue then
  // decides: `g_cam_path_frame < tail+0x0E` (the camera still short of 630)
  // sends it to 0x2E and it holds on the boat, facing the camera. The port had
  // the comparison the wrong way round and no state 46, 47 or 48 at all -- the
  // default arm put it in `AttackRun` in the carrier's frame, 1,660 units
  // from the camera -- and a shot rider never died, because only classes 0x30
  // and 0x31 were handed the hit `ZombieOnShot` reads. Stage 2 block 16 step
  // 12's `wait_enemies_alive` never released.
  const rng = new Rng(1600);
  scene(0, rng);
  const host: GameHost = {
    ...NULL_HOST,
    objectPath: () => ({ x: -1100, y: -25, z: -1530, pitch: 0, yaw: 0x4000,
                         roll: 0 }),
  };
  // The gameplay eye the rider turns to, `g_camera_eye`.
  G.g_camera_eye = vec3(-1100, 0, -1400);
  const fr = (): ClassFrame => ({ dt: 1 / 60,
                                  rng, host });
  G.g_active_cam_path = 78;
  G.g_cam_path_frame = 560;
  const boat = ActorSpawn(0xa3e8, SpawnClass.ScriptedProp, -1, "boat", {
    class13: { slot: 0x1a36, cam_path: 78, cam_frame: 1110, scale: 2.5,
               behaviour: 8, selector: 0 },
  }, rng);
  ScriptedPropUpdate13(boat, fr());
  const rider = ActorSpawn(0xa174, SpawnClass.CarriedZombie, 1, "rider", {
    pos: vec3(-1, 3, 7.5),
    class18: { from_state: 47, cue_path: 78, cue_frame: 630 },
  }, rng) as ZombieActor;
  rider.hp = rider.maxHp = 180;
  rider.attackState = 47;
  rider.state = 47;
  rider.sub = 0;
  CarriedZombieUpdate18(rider, fr());
  check("a rider whose script ends before its camera cue holds on the boat "
        + "(state 0x2E), not AttackRun",
        rider.state === ZombieState.HoldOnCarrier && rider.carrierAt === boat.at,
        `${ZombieState[rider.state] ?? rider.state} carrier ${rider.carrierAt}`);
  for (let i = 0; i < 240; i++) CarrierPostFrame(rider);
  const localEye = vec3();
  CarrierInverseTransformPoint(boat, -1100, 0, -1400, localEye);
  const want = VecToAngles(rider.pos.x - localEye.x, 0,
                           rider.pos.z - localEye.z).yaw;
  check("...turning to face the camera in the boat's own frame",
        Math.abs(bamsDelta(rider.yaw, want)) < 0x200,
        `${rider.yaw} vs ${want}`);
  check("...and it stays aboard: the world point is the boat's transform",
        Math.hypot(rider.carrierWorld.x - boat.pos.x,
                   rider.carrierWorld.z - boat.pos.z) < 20,
        `${rider.carrierWorld.x},${rider.carrierWorld.z}`);

  // Shot dead: the hit reaches `ZombieOnShot`, which is `EnemyZombieUpdate`'s
  // and so class 0x18's too.
  for (let i = 0; i < 40 && !rider.dead; i++) {
    ResolveHit(rider, 2, NULL_HOST, rng);
  }
  CarriedZombieUpdate18(rider, fr());
  check("a rider shot to zero hit points goes into its death state",
        rider.dead && rider.state === ZombieState.Death,
        `${rider.dead} ${ZombieState[rider.state] ?? rider.state}`);

  // Past the cue the same script end takes the attack state instead.
  const late = ActorSpawn(0xa175, SpawnClass.CarriedZombie, 1, "rider2", {
    pos: vec3(-1, 3, 7.5),
    class18: { from_state: 47, cue_path: 78, cue_frame: 630 },
  }, rng) as ZombieActor;
  late.attackState = 47;
  late.state = 47;
  late.sub = 0;
  G.g_cam_path_frame = 640;
  CarriedZombieUpdate18(late, fr());
  check("...and one whose script ends after the cue leaps (state 47 runs)",
        late.state === ZombieState.LeapOffCarrierForward,
        `${ZombieState[late.state] ?? late.state}`);

  // ...and the one that held does not hold for good: `ZombieStateHoldOnCarrier`
  // (`FUN_0045CFC0`) has its own exit, past the `MatrixStackPop` at
  // `0x0045D0AF` the decompiler stops at (L35) -- `g_active_cam_path ==
  // tail+0x0C && g_cam_path_frame == tail+0x0E` sends it to `(s8)tail[3]`.
  const held = ActorSpawn(0xa176, SpawnClass.CarriedZombie, 1, "rider3", {
    pos: vec3(-1, 3, 7.5),
    class18: { from_state: 47, cue_path: 78, cue_frame: 630 },
  }, rng) as ZombieActor;
  held.attackState = 47;
  held.state = ZombieState.HoldOnCarrier;
  held.sub = 0;
  G.g_cam_path_frame = 629;
  CarriedZombieUpdate18(held, fr());
  check("a holding rider is still aboard the frame before its cue",
        held.state === ZombieState.HoldOnCarrier && held.sub === 1
        && held.carrierAt === boat.at,
        `${ZombieState[held.state] ?? held.state}/${held.sub}`);
  G.g_cam_path_frame = 630;
  CarriedZombieUpdate18(held, fr());
  check("...and on camera path 78's frame 630 it takes its attack state, 47 "
        + "(state 46 is not a dead end)",
        held.state === ZombieState.LeapOffCarrierForward && held.sub === 0,
        `${ZombieState[held.state] ?? held.state}/${held.sub}`);

  function CarrierPostFrame(a: ZombieActor): void {
    CarriedZombieUpdate18(a, fr());
  }
}

console.log("stage 3 block 0's boat, and the riders it carries to the wall:");
{
  // The report: "the zombies on the boat don't seem to die when shot, and
  // when the boat explodes they still stay alive". Three faults, all read
  // from the exe, and this drives each from the reset the page runs.
  //
  // **1. The boat is not in the shot test.** `SpawnFromDescriptorSmall`
  // (`FUN_00408BC0`) hands the record's flags word to `ActorInitFlags`
  // (`FUN_00408970`, `OR ECX, 1; MOV [EAX+0x34], ECX`), and every class-0x13
  // record in the game carries `0x8000`; `RegisterForShotTest`
  // (`FUN_00405160`) refuses it at `0x00405168`. The spawn arm dropped the
  // word, so the boat's 40-unit sphere (`CarrierPropRoutine1` state 0) sat
  // round its origin in the render pick and took the pulls aimed at the
  // riders behind it.
  const rng = new Rng(0xc00);
  scene(0, rng);
  const BOAT = 3184;
  SetGameTables({
    ...CHARS,
    placements: [{
      at: BOAT, class: 0x13, char_type: -1, motion: null, hp: 0,
      init_flags: 0x8000, yaw: 57344,
      class13: { slot: 6711, cam_path: 130, cam_frame: 170, scale: 1,
                 behaviour: 8, selector: 1 },
    }],
  } as unknown as CharactersJson);
  SpawnSlotActors([{ at: BOAT, class: SpawnClass.ScriptedProp,
                     pos: [-1055, -26.25, -1620] as [number, number, number] }]);
  // The `Init`s are the frame walk's (`SpawnFromDescriptor`); run them here.
  RunPendingInits(rng);
  const boat = ActorByAt(BOAT);
  if (!boat) throw new Error("no boat");
  check("stage 3's boat is built with its record's flags word: 0x8000 | 1",
        boat.flags === 0x8001, `0x${boat.flags.toString(16)}`);
  check("...and g_civilian_carrier names it", G.g_civilian_carrier === BOAT);
  // A quarter turn, so a wrong frame for the rider shows (L48).
  const host: GameHost = {
    ...NULL_HOST,
    objectPath: () => ({ x: -1070, y: -17, z: -2900, pitch: 0, yaw: 0x4000,
                         roll: 0 }),
  };
  G.g_active_cam_path = 124;
  G.g_civilians_alive = 0;             // the civilian is dead: it runs past

  // The captor, stage 3's evt 0xC00: class 0x18, attack state 38 with mode 2
  // (turn toward the point and never retire by itself), and no camera cue.
  const victim = ActorSpawn(0xc01, SpawnClass.Zombie, 1, "its target", {},
                            rng);
  const cap = ActorSpawn(0xc00, SpawnClass.CarriedZombie, 1, "captor", {
    pos: vec3(0, -6, -10), initialState: 38, attackState: 38,
    flags: 0x60400,
    script: { target: null, attack: { state: 38, entries: [], head: {
      point: [-10, -6, -10] as [number, number, number], motion: 10,
      frame: 0, loops: 1, mode: 2 } } },
    class18: { from_state: 38, cue_path: -1, cue_frame: -1 },
  }, rng) as ZombieActor;
  cap.visible = boat.visible = true;
  cap.targetAt = victim.at;
  check("the captor rides the boat", cap.carrierAt === BOAT);
  const slot = cap.hitSlot;

  GameUpdate(1 / 60, host, rng);
  check("one frame in, the boat has seated its 40-unit radius and is still "
        + "out of the shot test",
        boat.hitRadius === 40 && (boat.flags & ActorFlag.NoShotTest) !== 0,
        `r ${boat.hitRadius} flags 0x${boat.flags.toString(16)}`);
  const listed = G.g_shot_test_list.length;
  RegisterForShotTest(boat, NULL_HOST);
  check("...which `RegisterForShotTest` refuses (`TEST AH, 0x80`)",
        G.g_shot_test_list.length === listed);

  // **2. The boat's strike ends its captor.** `CarrierPropRoutine1` runs past
  // its mooring with no civilian alive and raises `obj+0x34 |= 0x400000` at
  // path frame `0x55A`; `ZombieStateRetireOffScreen` (`FUN_0045B7B0`) reads
  // it off the carrier at `0x0045B9A5` and calls `ZombieRetireAndCredit`
  // (`FUN_0045BA40`). The port had neither the arm nor a faithful retire.
  const alive = G.g_enemies_alive;
  const present = G.g_enemies_present;
  let n = 0;
  let aboard = true;
  // The ride starts at the camera's frame and counts one a frame; with no
  // path playing here that is 0, so this is the whole ride to `0x55A`.
  while (!(boat.flags & CARRIER_RIDERS_DONE_BIT) && n++ < 0x600) {
    aboard &&= cap.state === ZombieState.RetireOffScreen && !cap.dead
      && cap.carrierAt === BOAT;
    GameUpdate(1 / 60, host, rng);
  }
  check("the captor holds in state 38, aboard and alive, while the boat runs "
        + "past", aboard);
  check("the boat raises 0x400000 as it runs past its mooring, at path frame "
        + "0x55A",
        (boat.flags & CARRIER_RIDERS_DONE_BIT) !== 0
        && (boat as unknown as { prop13: { pathFrame: number } })
          .prop13.pathFrame === 0x55a + 1, `${n} frames`);
  check("...and on that same frame its captor retires: dead, sub 4, "
        + "0x4008001 on its flags",
        cap.dead && cap.sub === 4
        && (cap.flags & 0x4008001) === 0x4008001,
        `dead ${cap.dead} sub ${cap.sub} 0x${cap.flags.toString(16)}`);
  check("...credited to g_active_player in a one-player game",
        G.g_players_in_play === 1 && cap.killedBy === G.g_active_player,
        `in play ${G.g_players_in_play} credit ${cap.killedBy} active `
        + `${G.g_active_player}`);
  check("...with both counts given back on the spot",
        G.g_enemies_alive === alive - 1 && G.g_enemies_present === present - 1,
        `${alive} -> ${G.g_enemies_alive}, ${present} -> `
        + `${G.g_enemies_present}`);
  check("...its hit slot freed",
        slot === HIT_SLOT_NONE || G.g_hit_slots[slot] === HIT_SLOT_NONE,
        `slot ${slot}`);
  check("...and the plain zombie update back (no longer a rider)",
        cap.carrierAt === -1);
  GameUpdate(1 / 60, host, rng);
  check("the next frame it is gone", cap.despawned);

  // **3. A holding rider leaps on its cue.** Stage 3's `0xADC` (attack state
  // 48, cue path 124 frame 1080) finishes its maul early and holds in 46;
  // `ZombieStateHoldOnCarrier`'s exit (`0x0045D0B4`) sends it to 48 on the
  // frame the camera reaches 1080 -- well before the boat strikes.
  const r = ActorSpawn(0xadc, SpawnClass.CarriedZombie, 5, "rider", {
    pos: vec3(5, -6, -14), initialState: 46, attackState: 48,
    flags: 0x60400,
    class18: { from_state: 48, cue_path: 124, cue_frame: 1080 },
  }, rng) as ZombieActor;
  const frame: ClassFrame = { dt: 1 / 60, rng, host };
  r.state = ZombieState.HoldOnCarrier;
  r.sub = 0;
  G.g_cam_path_frame = 1079;
  CarriedZombieUpdate18(r, frame);
  check("the rider holds on the boat the frame before its cue",
        r.state === ZombieState.HoldOnCarrier && r.sub === 1,
        `${ZombieState[r.state] ?? r.state}/${r.sub}`);
  G.g_cam_path_frame = 1080;
  CarriedZombieUpdate18(r, frame);
  check("...and at camera path 124's frame 1080 it goes to its attack state, "
        + "48",
        r.state === ZombieState.LeapOffCarrierAtMark && r.sub === 0,
        `${ZombieState[r.state] ?? r.state}/${r.sub}`);
  r.state = ZombieState.HoldOnCarrier;
  r.sub = 1;
  G.g_cam_path_frame = 1081;
  CarriedZombieUpdate18(r, frame);
  check("...on that frame and no other: the test is `==`, so one past it "
        + "holds",
        r.state === ZombieState.HoldOnCarrier,
        `${ZombieState[r.state] ?? r.state}`);
}

{
  // `CarrierBakeWorldPose` (`FUN_0045D920`): the carrier's matrix times the
  // rider's, read back through `MatrixToEulerBams`. A yaw-only pair adds.
  const carrier = { pos: vec3(10, 0, 20), pitch: 0, yaw: 0x4000, roll: 0 };
  const a = { pos: vec3(1, 2, 0), pitch: 0, yaw: 0x1000, roll: 0 };
  CarrierBakeWorldPose(a as unknown as Actor, carrier as unknown as Actor);
  check("the step-off bakes the carrier's position and adds the yaws",
        Math.abs(a.pos.x - 10) < 1e-6 && Math.abs(a.pos.z - 19) < 1e-6
        && Math.abs(a.pos.y - 2) < 1e-6 && Math.abs(a.yaw - 0x5000) <= 1,
        `${a.pos.x},${a.pos.y},${a.pos.z} yaw ${a.yaw}`);
  const r = MatrixToEulerBams(RotXZY(0x0800, 0x0400, 0x2000));
  check("MatrixToEulerBams takes a RotX·RotZ·RotY pose back off its matrix",
        Math.abs(r.pitch - 0x800) <= 1 && Math.abs(r.roll - 0x400) <= 1
        && Math.abs(r.yaw - 0x2000) <= 1,
        `${r.pitch} ${r.roll} ${r.yaw}`);
  // `MatrixGetAngles` (`FUN_004018E0`) reads `RotY·RotX·RotZ` back, with the
  // elevation `VecToAngles` (`FUN_004016B0`) gives: negated, off
  // `z / cos(heading)`. The wrong sign would read 0x800 back as -0x800.
  const g = MatrixGetAngles(RotYXZ(0x2000, 0x0800, 0x0400));
  check("MatrixGetAngles takes a RotY·RotX·RotZ pose back, elevation signed",
        Math.abs(g.x - 0x800) <= 1 && Math.abs(g.y - 0x2000) <= 1
        && Math.abs(g.z - 0x400) <= 1, `${g.x} ${g.y} ${g.z}`);
}
