import type { CharactersJson, CharacterType } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { ActorSpawn, GameUpdate } from "../../src/game/director";
import { ActorAdvanceMotion } from "../../src/game/motion";
import { CameraActorTick, CameraUpdateTick } from "../../src/game/camera/actor";
import { EvtEnterSceneState } from "../../src/game/camera/hooks";
import { DeathArcMotion } from "../../src/game/combat/resolve_hit";
import {
  ActorByAt, AppState, G, HIT_SLOT_NONE, ResetGameGlobals,
} from "../../src/game/globals";
import { NULL_HOST, type GameHost, type ShotPick } from "../../src/game/host";
import {
  MatIdentity, MatrixRotateY, MatrixTransformPoint, FtolS16,
} from "../../src/game/matrix";
import { SpriteEffectKind } from "../../src/game/effects/sprite";
import {
  FireShotRequest, QueueOffscreenPull, QueueShotRequest,
} from "../../src/game/combat/shot";
import { SetGameTables, T } from "../../src/game/tables";
import {
  ColiTestSphereAgainstFullSet, ColiTraceSegmentAllSets, QueryGroundHeightAt,
  QueryGroundSurfaceAt,
} from "../../src/game/coli";
import { ZombieState } from "../../src/game/class30/states";
import { ZombieStateStrike } from "../../src/game/class30/strike";
import { ZombieStateStandAndThrow } from "../../src/game/class30/stand_throw";
import {
  DeflectSub, FlySub, ThrownWeaponPoolUpdate, ThrownWeaponState,
  THROWN_WEAPON_AFTERIMAGE_PERIOD, THROWN_WEAPON_SHADOW_SIZE,
  THROWN_WEAPON_SPIN,
  ZslmanBladeAfterimageFade, ZslmanBladeEmitAfterimage,
} from "../../src/game/class31/projectile";
import {
  ZombieThrownWeaponBeginArc, ZombieThrownWeaponState, ZOMBIE_AXE_SLOT,
  ZOMBIE_BLADE_SPIN, ZOMBIE_WEAPON_ROLL,
} from "../../src/game/class30/thrown_weapon";
import { ZombieThrowHandWeapon } from "../../src/game/class30/throw";
import {
  ThrownWeaponAlloc, ThrownWeaponFlag, ThrownWeaponHitSlotOwner,
  ThrownWeaponRoutine, THROWN_WEAPON_DRAW_FLAGS, THROWN_WEAPON_SPAWN_FLAGS,
  type ThrownWeapon, type ThrownWeaponFrame,
} from "../../src/game/thrown_weapon";
import {
  ActorDrawGroundShadow, GROUND_SHADOW_LAYER, GROUND_SHADOW_SLOT,
} from "../../src/game/ground_shadow";
import type { WorldSlotDraw } from "../../src/game/view_slot";
import {
  CameraSlotObject, UpdateCameraEnemySlots,
} from "../../src/game/camera/slots";
import {
  ActorFlag, DamageZone, ThrowerFlag, ZombieFlag2,
} from "../../src/game/actor";
import {
  RankEnemiesByDistance, RegisterForDistanceRank,
} from "../../src/game/combat/rank";
import { ReleaseAttackSlot } from "../../src/game/combat/permits";
import { ThrowerStateLeapStrike } from "../../src/game/class31/scripted";
import {
  UNCOUNTED_CHAR_TYPE, UNCOUNTED_INITIAL_STATE,
} from "../../src/game/combat/counts";
import { ActorDespawn } from "../../src/game/despawn";
import { ArcPhase } from "../../src/game/class31/arc";
import { ZombiePushOutOfWorldAndActors } from "../../src/game/class30/ground";
import { ZOMBIE_SPRINTS } from "../../src/game/class30/states";
import { SpawnClass } from "../../src/game/spawn_class";
import { GameMode } from "../../src/game/game_mode";
import { ThrowerStateWaitForPermit } from "../../src/game/class31/stand";
import {
  ThrowerStateCloseAndStrike, ThrowerStateStrikeOnTheSpot,
} from "../../src/game/class31/standing";
import { ThrowerState, ThrowSub } from "../../src/game/class31/states";
import { ThrowerStateThrow } from "../../src/game/class31/thrower";
import { ActorPlayCursor } from "../../src/game/class31/arc";
import { ThrowerPickLandingPoint } from "../../src/game/class31/leap_down";
import { dist2d, vec3, type Vec3 } from "../../src/game/vec";
import { HitResultCode } from "../../src/game/combat/resolve_hit";
import { VecToAngles } from "../../src/game/vec";
import {
  check, motion, TYPE, CHARS, SCENE_MAJOR_PLAYING, EYE, HoldCameraAt,
  spawnZombie, openShutter, slotHolds, slotsShown, EnterPlay, JoinPlayerTwo,
  TYPE31, CLASS31, CHARS31, CAM_HOST, coliQuad, WALL_BLOB, FLOOR_BLOB, thrower,
} from "./harness";

// **Which eye.** The engine has three camera points, each read by address:
// `g_camera_eye` (`0x009C71E0`), the gameplay eye the scene state's hook writes
// fifteen under the rail's pose; camera block 0's eye (`0x009A60C0`); and the
// eye of the block `g_camera_index` names. The port handed every class the
// drawn camera instead -- the lens, fifteen above the first -- and every
// routine that read a height, a 3D distance or an aim from it was off by that.
// Each check below drives the eye through the camera's own routines
// (`HoldCameraAt` enters scene state (2, 4), whose hook writes it), never by
// hand, so the two points are fifteen apart as they are in the page.
console.log("\nwhich eye: g_camera_eye, block 0, the drawn block:");
{
  // `RegisterForDistanceRank` (`0x0040902F..0x0040903B`): the **ground**
  // distance to `g_camera_eye`, filed from the zombie's own update and sorted
  // by the next frame's rank task. One zombie 26 out and level with the lens,
  // one 25 out and 25 below it: on the ground the second is nearer; measured
  // in 3D from the lens, as the port's rank was, the first.
  ResetGameGlobals();
  SetGameTables(CHARS);
  EnterPlay();
  const lens = vec3(0, 15, 0);
  HoldCameraAt(lens);
  CameraUpdateTick();
  check("the (2, 4) hook puts g_camera_eye fifteen under the lens",
        G.g_camera_eye.x === 0 && G.g_camera_eye.y === 0
        && G.g_camera_eye.z === 0, JSON.stringify(G.g_camera_eye));
  const level = spawnZombie(0x7e00, 1, "level with the lens");
  const below = spawnZombie(0x7e01, 1, "below it");
  for (const z of [level, below]) { z.visible = true; z.hp = 10; }
  level.pos = vec3(0, 15, 26);
  below.pos = vec3(0, -10, 25);
  RegisterForDistanceRank(level);
  RegisterForDistanceRank(below);
  check("...and each files a key of ftol(ground distance * 10)",
        G.g_distance_rank_list.map((e) => e.key).join() === "260,250",
        G.g_distance_rank_list.map((e) => e.key).join());
  RankEnemiesByDistance();
  check("the rank is the ground distance to g_camera_eye, not the 3D "
        + "distance to the lens: 25 out ranks ahead of 26 out",
        below.rank === 0 && level.rank === 1,
        `below ${below.rank} level ${level.rank}`);
  check("...and the rank task empties the list it sorted",
        G.g_distance_rank_list.length === 0);

  // `ActorFacePlayerTarget` (`0x00455F6F..7A`): the strike's remembered point
  // is `g_camera_eye`, all three words -- so the lunge and the retreat measure
  // from the gameplay eye, fifteen under the lens.
  const striker = spawnZombie(0x7e02, 1, "striker");
  striker.visible = true;
  striker.hp = 10;
  striker.pos = vec3(0, 0, 20);
  ZombieStateStrike(striker, new Rng(4));
  check("a strike remembers g_camera_eye, not the lens",
        striker.target.y === G.g_camera_eye.y
        && striker.target.y === lens.y - 15, `target.y ${striker.target.y}`);
}
{
  // `ThrowerStateGrabPlayer` (`0x0044F015..0x0044F4E2`): stage 5's `zslman`
  // hang off `g_camera_eye` plus the spawn's offset, so fifteen lower than
  // off the lens.
  const rng = new Rng(61);
  const z = thrower(ThrowerState.GrabPlayer, {
    attackState: 7,
    grab: {
      offset: [0, -40, 0], cue_frame: 20, drop_frames: 10, hold_frames: 25,
      player: 0,
    },
  });
  z.pos = vec3(0, 60, 0);
  const lens = vec3(0, 25, 0);
  HoldCameraAt(lens);
  G.g_cam_path_frame = 0;
  for (let i = 0; i < 3; i++) GameUpdate(1 / 60, CAM_HOST, rng);
  check("a zslman hangs 60 over g_camera_eye, which is 15 under the lens",
        G.g_camera_eye.y === lens.y - 15 && z.pos.y === G.g_camera_eye.y + 60,
        `pos.y ${z.pos.y} g_camera_eye.y ${G.g_camera_eye.y}`);
}
{
  // `ThrowerPickLandingPoint`'s `zslman` tail (`0x0044CCAD`..`0x0044CE3B`),
  // past the `MatrixStackPop` the port stopped at: the screen point is thrown
  // away for `T(g_camera_eye) Ry(g_camera_yaw_bams + 0x8000) * (x, y, -10)`,
  // `y` 4.5 on the ground. With the hook's yaw at 0 that is ten units down +z
  // from the gameplay eye and 4.5 above it.
  ResetGameGlobals();
  SetGameTables(CHARS31);
  EnterPlay();
  const z = ActorSpawn(0x9102, SpawnClass.Thrower, 0x18, "zslman",
                       { initialState: ThrowerState.StandAndDecide,
                         condition: 0 });
  z.pos = vec3(0, 0, 60);
  HoldCameraAt(vec3(0, 25, 0));
  CameraUpdateTick();
  const out = vec3();
  ThrowerPickLandingPoint(z, CAM_HOST, out);
  check("a zslman lands ten in front of g_camera_eye and 4.5 above it, not on "
        + "the screen point",
        Math.abs(out.x) < 1e-5 && out.y === G.g_camera_eye.y + 4.5
        && Math.abs(out.z - 10) < 1e-5
        && G.g_camera_eye.y === 10, JSON.stringify(out));
}
{
  // `ThrowerStateCloseAndStrike` (`0x0044EA50`) sub 0: the landing point into
  // `obj+0x13E4` and the **yaw alone** turned to `g_camera_eye`
  // (`0x0044EAA3..EABC`). The port called `ActorFacePlayerTarget`, which also
  // stores the eye into `obj+0x13E4`, so the range test measured to the camera
  // rather than to the mark.
  const z = thrower(ThrowerState.CloseAndStrike);
  z.pos = vec3(30, 0, 40);
  HoldCameraAt(vec3(0, 15, 0));
  CameraUpdateTick();
  const mark = vec3(4, -6, 9);
  const host = {
    ...NULL_HOST,
    viewPoint: (_x: number, _y: number, _z: number, out: Vec3) => {
      out.x = mark.x; out.y = mark.y; out.z = mark.z;
    },
  };
  ThrowerStateCloseAndStrike(z, new Rng(1), host);
  check("close-and-strike keeps the landing point as its target",
        z.target.x === mark.x && z.target.y === mark.y && z.target.z === mark.z,
        JSON.stringify(z.target));
  check("...and turns to face g_camera_eye",
        z.yaw === FtolS16(VecToAngles(30, 0, 40).yaw), String(z.yaw));
}
// Class 0x31's standing swings and its scripted leap raise `obj+0x34` bit
// 0x10000000 -- `ActorFlag.Committed` -- and not `BackingOff`, the bit above
// it: `OR EDX, 0x10000000` (`81ca00000010`) at `0x0044EB5F` in state 24,
// `OR ECX` (`81c900000010`) at `0x00450BD2` in state 32 and `0x0044E72B` in
// state 22, cleared by `25ffffffef` at `0x0044EC52` and `0x00450C6D` and
// `81e1ffffffef` at `0x0044E7F0`. The readers that tell the two apart are the
// crowd push's 1.8x on the shover's bit (`00454944`) and the arc landing's
// dust column (`0x0044D296`/`0x0044D2A1`).
console.log("class 0x31, states 22, 24 and 32 raise 0x10000000, not 0x20000000:");
{
  const SET0 = CLASS31.sets[0]!;
  const TABLES = {
    ...CHARS31,
    class31: {
      ...CLASS31,
      sets: [{
        ...SET0,
        // The mid-pounce ground row, stance 4: state 22 raises
        // `obj+0x136C` 0x20000 before `ThrowerLoadAttackArcScript` reads it.
        attacks: { ...SET0.attacks, "4": SET0.attacks["0"] },
        // One `g_class31_throws` row: motion 9's swing, 287's approach, a
        // reach of 20 and a hit on frame 48.
        strikes: {
          "0": { strike: 9, lunge: 287, distance: 20, hit_frame: 48,
                 overlay_kind: 6, cancel_mask: 2 },
        },
      }],
    },
  } as unknown as CharactersJson;
  const spawn31 = (state: ThrowerState, type = 0x16) => {
    ResetGameGlobals();
    SetGameTables(TABLES);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    EnterPlay();
    G.g_camera_yaw_bams = 0;
    G.g_camera_fixed_eye_y = 0;
    const a = ActorSpawn(0x9000, SpawnClass.Thrower, type, "t",
                         { initialState: state, condition: 0 });
    if (a.cls !== SpawnClass.Thrower) throw new Error("not class 0x31");
    a.visible = true;
    a.hp = 100;
    a.pos = vec3(0, 0, 80);
    a.state = state;
    a.sub = 0;
    return a;
  };
  const hex = (f: number) => `0x${(f >>> 0).toString(16)}`;
  // The crowd push, from the zombie's side: it applies the push a shover
  // recorded on it last frame (`obj+0x138`, `0x00405F2B`), 1.8x when the
  // shover's `obj+0x34 & 0x18000000`. Far from everything, five deep.
  const shovedBy = (at: number): number => {
    const b = spawnZombie(0x7a01, 1, "b");
    b.visible = true;
    b.hp = b.maxHp = 100;
    b.flags2 |= ZombieFlag2.CollideActors;
    b.pos = vec3(50, 0, 0);
    b.pushedBy = at;
    b.pushDepth = 5;
    b.pushNormal = vec3(1, 0, 0);
    ZombiePushOutOfWorldAndActors(b);
    return b.pos.x - 50;
  };
  // A seed whose first draw is under 5, so set 0's picks name attack 0.
  let seed = 1;
  while (new Rng(seed).int(10) >= 5) seed++;

  // -- state 24, `ThrowerStateCloseAndStrike` -------------------------------
  {
    const z = spawn31(ThrowerState.CloseAndStrike);
    // The mark five units in front of it, inside the entry's reach of 20, so
    // the swing starts at once.
    const host = {
      ...NULL_HOST,
      viewPoint: (_x: number, _y: number, _z: number, out: Vec3) => {
        out.x = 0; out.y = 0; out.z = 75;
      },
    };
    const rng = new Rng(seed);
    ThrowerStateCloseAndStrike(z, rng, host);
    check("close-and-strike raises 0x10000000 in sub 0 (`0x0044EB5F`), "
          + "not BackingOff",
          (z.flags & ActorFlag.Committed) !== 0
          && (z.flags & ActorFlag.BackingOff) === 0, hex(z.flags));
    check("...and a zombie it shoves mid-swing is pushed 1.8x "
          + "(`00454944`, the shover's bit)",
          Math.abs(shovedBy(z.at) - 0.9) < 1e-6, String(shovedBy(z.at)));
    let backingOff = false;
    for (let i = 0; i < 400 && z.state === ThrowerState.CloseAndStrike; i++) {
      ActorAdvanceMotion(z, 1 / 60);
      ThrowerStateCloseAndStrike(z, rng, host);
      if (z.flags & ActorFlag.BackingOff) backingOff = true;
    }
    check("...holds it through the swing and drops it on the way to state "
          + "25 (`0x0044EC52`), never raising 0x20000000",
          z.state === ThrowerState.Withdraw
          && (z.flags & ActorFlag.Committed) === 0 && !backingOff,
          `state ${z.state} ${hex(z.flags)} backingOff ${backingOff}`);
    check("...after which the shove is back to a tenth",
          Math.abs(shovedBy(z.at) - 0.5) < 1e-6, String(shovedBy(z.at)));
  }

  // -- state 32, `ThrowerStateStrikeOnTheSpot` -------------------------------
  {
    const z = spawn31(ThrowerState.StrikeOnTheSpot);
    z.sub = 2;
    z.strikeStart = { x: 0, y: 0, z: 80 };
    const rng = new Rng(seed);
    ThrowerStateStrikeOnTheSpot(z, 1 / 60, rng, CAM_HOST);
    check("strike-on-the-spot raises 0x10000000 with its draw "
          + "(`0x00450BD2`), not BackingOff",
          z.sub === 3 && (z.flags & ActorFlag.Committed) !== 0
          && (z.flags & ActorFlag.BackingOff) === 0,
          `sub ${z.sub} ${hex(z.flags)}`);
    let backingOff = false;
    for (let i = 0; i < 400 && z.sub === 3; i++) {
      ActorAdvanceMotion(z, 1 / 60);
      ThrowerStateStrikeOnTheSpot(z, 1 / 60, rng, CAM_HOST);
      if (z.flags & ActorFlag.BackingOff) backingOff = true;
    }
    check("...and drops it when the swing ends (`0x00450C6D`)",
          z.sub === 5 && (z.flags & ActorFlag.Committed) === 0 && !backingOff,
          `sub ${z.sub} ${hex(z.flags)} backingOff ${backingOff}`);
  }

  // -- state 22, `ThrowerStateLeapStrike` ------------------------------------
  {
    const z = spawn31(ThrowerState.LeapStrike, 0x19);
    z.leapStrikeFrames = 30;
    const rng = new Rng(seed);
    const seq0 = G.g_sprite_effect_seq;
    ThrowerStateLeapStrike(z, 1 / 60, rng, CAM_HOST);
    check("the leap strike raises 0x10000000 with the pounce bit "
          + "(`0x0044E72B`), not BackingOff",
          (z.flags & ActorFlag.Committed) !== 0
          && (z.flags & ActorFlag.BackingOff) === 0, hex(z.flags));
    for (let i = 0; i < 400 && z.state === ThrowerState.LeapStrike; i++) {
      ActorAdvanceMotion(z, 1 / 60);
      ThrowerStateLeapStrike(z, 1 / 60, rng, CAM_HOST);
    }
    const columns = G.g_sprite_effects.filter(
      (e) => e.id >= seq0 && e.kind === SpriteEffectKind.DustAlt).length;
    check("...lands with no dust column -- `ThrowerEmitGroundDust` 0x50 "
          + "raises one only with 0x10000000 down and 0x20000000 up",
          z.state === ThrowerState.LeapAside && columns === 0,
          `state ${z.state} columns ${columns}`);
    check("...and drops the bit on the way to state 10 (`0x0044E7F0`)",
          (z.flags & ActorFlag.Committed) === 0
          && (z.flags & ActorFlag.BackingOff) === 0, hex(z.flags));
  }
}
// `ThrowerStateCloseAndStrike` (`FUN_0044EA50`) against its listing, with
// the state that hands it over (`ThrowerStateWaitForPermit`, `FUN_0044B3E0`)
// and the two siblings that swing off the same rows.
console.log("class 0x31 state 24, zskamere's standing swing, as the exe has it:");
{
  const SET0 = CLASS31.sets[0]!;
  // One `g_class31_throws` row: motion 9's swing, 287's approach, a reach of
  // 20, a hit on play-cursor frame 48 and mask 8, which never cancels -- the
  // shape of set 2's rows 0, 1 and 3.
  const ROW = { strike: 9, lunge: 287, distance: 20, hit_frame: 48,
                overlay_kind: 6, cancel_mask: 8 };
  // `zskamere`, whose swing's `g_motion_play_length` is pinned to 2n - 3: a
  // routine that ends it on the clip's own length ends it three frames late.
  const TYPE31_ZSKAMERE: CharacterType = {
    ...TYPE31,
    type: 0x17, name: "zskamere", file: "zskamere.bin",
    motions: { ...TYPE31.motions, "9": motion(40, 0, 77), "296": motion(31) },
  };
  const GROUND_ROW = {
    ...SET0.attacks["0"],
    "0": { ...SET0.attacks["0"]["0"], hit_frame: 30 },
  };
  const tables = (picks: number[]) => ({
    ...CHARS31,
    types: { ...CHARS31.types, "23": TYPE31_ZSKAMERE },
    class31: {
      ...CLASS31,
      sets: [{
        ...SET0,
        // Two different idles, so "the first" can be told from "either".
        motions: [295, 296, 313, 313, 283, 934],
        // The ground row, and the mid-pounce row state 22 installs its arc
        // from, with a hit frame the arc's cursor passes (it ends on 48).
        attacks: { ...SET0.attacks, "0": GROUND_ROW, "4": GROUND_ROW },
        strikes: { "0": ROW },
        attack_picks: picks,
      }],
    },
    combat: {
      impact: [], head_impact: [],
      voice: { hurt: [], kill: [], head: [],
               attack: [[{ id: 40, file: "" }, { id: 41, file: "" }],
                        [{ id: 50, file: "" }, { id: 51, file: "" }]] },
      voice_set_a_types: [], ricochet: {},
    },
  } as unknown as CharactersJson);
  const ALWAYS_0 = new Array(80).fill(0);
  let frame = 0;
  const heard: number[] = [];
  const hits: number[] = [];
  const ev = new Events();
  ev.on("sound.play", (d) => heard.push(d.id));
  ev.on("player.damaged", () => hits.push(frame));
  const cried = () => heard.some((id) => id === 50 || id === 51);
  const spawn = (type: number, state: ThrowerState, picks = ALWAYS_0,
                 twoPlayers = false) => {
    // Arcade, so a credit is left for player 2 to join on.
    G.g_GameMode = GameMode.Arcade;
    ResetGameGlobals();
    SetGameTables(tables(picks));
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    EnterPlay();
    if (twoPlayers) JoinPlayerTwo();
    G.g_camera_yaw_bams = 0;
    const a = ActorSpawn(0x9100, SpawnClass.Thrower, type, "t",
                         { initialState: state, condition: 0 });
    if (a.cls !== SpawnClass.Thrower) throw new Error("not class 0x31");
    a.visible = true;
    a.hp = 100;
    a.pos = vec3(0, 0, 80);
    a.state = state;
    a.sub = 0;
    heard.length = 0;
    hits.length = 0;
    frame = 0;
    return a;
  };
  // The mark `ThrowerPickLandingPoint` hands back, wherever the test puts it.
  const markAt = (m: Vec3) => ({
    ...NULL_HOST,
    viewPoint: (_x: number, _y: number, _z: number, out: Vec3) => {
      out.x = m.x; out.y = m.y; out.z = m.z;
    },
  });

  {
    // Driven from state 8, two players in play, the mark 40 short of it.
    const z = spawn(0x17, ThrowerState.WaitForPermit, ALWAYS_0, true);
    z.arcPhase = ArcPhase.Settled;           // its entrance arc's last phase
    const host = markAt(vec3(0, 0, 40));
    const rng = new Rng(3);
    ThrowerStateWaitForPermit(z, rng, host, ev);
    check("a zskamere's claim raises 0x400 and goes to state 24 playing "
          + "0x2416A9 (`PUSH 0x2416a9` at `0x0044B5A5`)",
          z.state === ThrowerState.CloseAndStrike && z.attackPermit >= 0
          && (z.flags2 & ThrowerFlag.UseThrowTable) !== 0
          && heard.includes(0x2416a9),
          `state ${z.state} permit ${z.attackPermit} heard ${heard}`);
    heard.length = 0;
    ThrowerStateCloseAndStrike(z, rng, host, ev);
    check("sub 0 writes g_players_in_play into obj+0x1360, over the arc's "
          + "phase (`MOV [ESI + 0x1360], EDX` at `0x0044EA93`)",
          G.g_players_in_play === 2 && z.arcPhase === 2,
          `players ${G.g_players_in_play} arcPhase ${z.arcPhase}`);
    check("...and out of reach it takes the row's approach clip, silently",
          z.sub === 1 && z.motion === 287 && !z.action && !cried(),
          `sub ${z.sub} motion ${z.motion} heard ${heard}`);
    // Into reach: 15 from the mark. The fixture's approach clip carries no
    // root, so the step is the test's.
    z.pos.z = 55;
    let start = -1, cry = -1, hitCursor = -1, exitCursor = -1;
    for (frame = 1; frame < 200 && z.state === ThrowerState.CloseAndStrike;
         frame++) {
      ActorAdvanceMotion(z, 1 / 60);
      const was = z.sub;
      ThrowerStateCloseAndStrike(z, rng, host, ev);
      if (was === 1 && z.sub === 2) start = frame;
      if (cry < 0 && cried()) cry = frame;
      if (hitCursor < 0 && hits.length) hitCursor = ActorPlayCursor(z);
      if (z.state !== ThrowerState.CloseAndStrike) {
        exitCursor = ActorPlayCursor(z);
      }
    }
    check("the swing cries out on the frame it starts "
          + "(`ActorPlayHitVoice(obj, 3)` at `0x0044EC02`)",
          start > 0 && cry === start, `start ${start} cry ${cry}`);
    // `ActorSetMotionBlended(obj+0x194, strike, 0, 5)` at `0x0044EBFA` holds
    // the cursor on 0 for the fade: the port's state reads it six times, so
    // 48 comes 53 frames after the swing starts. (The engine's state reads it
    // once more, 54 -- the port's phase, L62, not this routine's.)
    check("the hit lands once, on the frame the play cursor reads the row's "
          + "48, 53 frames into the swing (`CMP [ESI + 0x19c], EAX` at "
          + "`0x0044EC15`)",
          hits.length === 1 && hitCursor === 48 && hits[0] - start === 53,
          `hits ${hits} start ${start} cursor ${hitCursor}`);
    check("...and state 25 follows on g_motion_play_length - 1, 76, with "
          + "0x10000000 down (`0x0044EC3B`, `0x0044EC52`)",
          z.state === ThrowerState.Withdraw && exitCursor === 76
          && (z.flags & ActorFlag.Committed) === 0,
          `state ${z.state} exit at ${exitCursor} flags 0x${z.flags.toString(16)}`);
  }
  {
    // No latch: a cursor that steps over 48 lands nothing, and one put back
    // on 48 lands then.
    const z = spawn(0x17, ThrowerState.WaitForPermit);
    const host = markAt(vec3(0, 0, 75));
    const rng = new Rng(3);
    ThrowerStateWaitForPermit(z, rng, host, ev);
    let skipped = false, restored = false, hitCursor = -1;
    for (frame = 1; frame < 200 && z.state === ThrowerState.CloseAndStrike;
         frame++) {
      ActorAdvanceMotion(z, 1 / 60);
      ThrowerStateCloseAndStrike(z, rng, host, ev);
      const c = ActorPlayCursor(z);
      if (hitCursor < 0 && hits.length) hitCursor = c;
      if (!skipped && z.sub === 2 && c === 47) {
        z.action!.ticks = 48;                 // the next frame reads 49
        skipped = true;
      } else if (skipped && !restored && c === 49) {
        z.action!.ticks = 47;                 // ...and the one after, 48
        restored = true;
      }
    }
    check("the hit test is `==` on every frame behind no latch: stepped over, "
          + "48 lands nothing; put back, it lands",
          skipped && restored && hits.length === 1 && hitCursor === 48,
          `skipped ${skipped} restored ${restored} hits ${hits.length} `
          + `at ${hitCursor}`);
  }
  {
    // A row the bundle omits is the zero row the engine reads -- here the
    // picks name 3, which the fixture, like row A, leaves out.
    const z = spawn(0x17, ThrowerState.WaitForPermit, new Array(80).fill(3));
    const host = markAt(vec3(0, 0, 40));
    const rng = new Rng(3);
    ThrowerStateWaitForPermit(z, rng, host, ev);
    for (frame = 1; frame < 60; frame++) {
      ActorAdvanceMotion(z, 1 / 60);
      ThrowerStateCloseAndStrike(z, rng, host, ev);
    }
    check("an omitted row is not a way out: a reach of 0 it never closes "
          + "keeps it in sub 1 with 0x10000000 up (`0x0044EBBA`)",
          z.state === ThrowerState.CloseAndStrike && z.sub === 1
          && z.attack === 3 && (z.flags & ActorFlag.Committed) !== 0
          && hits.length === 0,
          `state ${z.state} sub ${z.sub} attack ${z.attack} `
          + `flags 0x${z.flags.toString(16)}`);
  }
  {
    // Waiting with the permit taken: 0x17 stands in the set's first idle
    // and draws nothing for it (`CMP AX, 0x17` at `0x0044B458`).
    let idles = "";
    for (let s = 1; s <= 8; s++) {
      const z = spawn(0x17, ThrowerState.WaitForPermit);
      G.g_attack_permits[0] = G.g_attack_permits[1] = 0x7777;
      ThrowerStateWaitForPermit(z, new Rng(s), CAM_HOST, ev);
      idles += `${z.motion} `;
    }
    check("a waiting zskamere stands in idle 0 whatever the draw",
          idles === "295 ".repeat(8), idles);
  }
  {
    // zstin's claim plays the same sound on its way to the pounce.
    const z = spawn(0x19, ThrowerState.WaitForPermit);
    ThrowerStateWaitForPermit(z, new Rng(3), CAM_HOST, ev);
    check("a zstin's claim goes to state 9 playing 0x2416A9 "
          + "(`PUSH 0x2416a9` at `0x0044B526`)",
          z.state === ThrowerState.Pounce && heard.includes(0x2416a9)
          && (z.flags2 & ThrowerFlag.UseThrowTable) === 0,
          `state ${z.state} heard ${heard}`);
  }

  // -- state 32, `ThrowerStateStrikeOnTheSpot` -------------------------------
  {
    const z = spawn(0x17, ThrowerState.StrikeOnTheSpot);
    z.flags2 |= ThrowerFlag.UseThrowTable;
    z.sub = 2;
    z.strikeStart = { x: 0, y: 0, z: 80 };
    const rng = new Rng(3);
    ThrowerStateStrikeOnTheSpot(z, 1 / 60, rng, CAM_HOST, ev);
    check("strike-on-the-spot cries out as its swing starts "
          + "(`ActorPlayHitVoice(obj, 3)` at `0x00450C30`)",
          z.sub === 3 && cried(), `sub ${z.sub} heard ${heard}`);
    let endCursor = -1;
    for (frame = 1; frame < 200 && z.sub === 3; frame++) {
      ActorAdvanceMotion(z, 1 / 60);
      const c = ActorPlayCursor(z);
      // The permit gone and the off-screen latch still up as the swing ends:
      // `FUN_0044CFB0` drops the latch whether or not it frees a permit.
      if (c === 70) {
        ReleaseAttackSlot(z, ThrowerFlag.OffScreenPermit);
        z.flags2 |= ThrowerFlag.OffScreenPermit;
        G.g_attack_committed = 1;
      }
      ThrowerStateStrikeOnTheSpot(z, 1 / 60, rng, CAM_HOST, ev);
      if (z.sub !== 3) endCursor = c;
    }
    check("...ends the swing on g_motion_play_length - 1, 76 "
          + "(`0x00450C5E`)", endCursor === 76, `ended at ${endCursor}`);
    check("...drops the off-screen latch with no permit held "
          + "(`CALL 0x0044cfb0` at `0x00450C75`, unconditional)",
          (z.flags2 & ThrowerFlag.OffScreenPermit) === 0
          && G.g_attack_committed === 0,
          `flags2 0x${z.flags2.toString(16)} committed ${G.g_attack_committed}`);
    check("...and waits in the set's second idle on the one track, not as a "
          + "one-shot (`0x00450C96`)",
          z.sub === 5 && z.motion === 296 && !z.action,
          `sub ${z.sub} motion ${z.motion} action ${z.action?.motion}`);
  }

  // -- state 22, `ThrowerStateLeapStrike` ------------------------------------
  {
    // Nobody may be attacked: the scene is not on its path camera.
    const z = spawn(0x19, ThrowerState.LeapStrike);
    z.leapStrikeFrames = 30;
    G.g_scene_state_major_entered = 1;
    const rng = new Rng(3);
    // The connect's melee arm raises `obj+0x136C` 0x800 on its hit frame,
    // 30 here, whether or not `PlayerTakeDamage` takes a life.
    let struck = false, passed30 = false;
    for (frame = 0; frame < 400 && z.state === ThrowerState.LeapStrike;
         frame++) {
      if (frame) ActorAdvanceMotion(z, 1 / 60);
      ThrowerStateLeapStrike(z, 1 / 60, rng, CAM_HOST, ev);
      if (ActorPlayCursor(z) === 30) passed30 = true;
      if (z.flags2 & ThrowerFlag.Struck) struck = true;
    }
    check("the leap strike connects only while IsPlayerAttackable says so "
          + "(`CALL 0x00409dc0` at `0x0044E7C1`), not whenever obj+0x121 is "
          + "a player",
          z.state === ThrowerState.LeapAside && z.attackPermit >= 0
          && passed30 && !struck,
          `state ${z.state} permit ${z.attackPermit} passed 30 ${passed30} `
          + `struck ${struck}`);
  }
}
{
  // The drawn block. `CameraInstallViewAngles` (`MOV [0x009c6f00], 2` at
  // `0x004039D5`) makes block 2 the one `g_camera_index` names, and
  // `EvtRunQueuedActionsSyncViewBlock` aims it at block 0's look-at, whatever
  // block 0's own angles say -- the boss banner's flight is exactly that.
  // `ChooseDeathMotionDirectional` reads `[g_camera_index * 0x1A4 +
  // 0x9A60D0]` (`0x00456248`), so under (1, 3) a body falls against block 2's
  // heading. Block 0 here looks down -z at a quarter-turned yaw of its own.
  ResetGameGlobals();
  SetGameTables(CHARS);
  const z = spawnZombie(0x7e10, 1, "dying in a cutscene");
  G.g_camera_block_eye = vec3(0, 10, 0);
  G.g_camera_block_target = vec3(0, 10, -100);
  G.g_camera_block_yaw_bams = 0x4000;
  EvtEnterSceneState(1, 3);
  CameraActorTick();
  check("(1, 3) draws from block 2, aimed at block 0's look-at",
        G.g_camera_index === 2 && (G.g_camera_block2_yaw_bams & 0xffff) === 0
        && (G.g_camera_block_yaw_bams & 0xffff) === 0x4000,
        `index ${G.g_camera_index} block2 ${G.g_camera_block2_yaw_bams} `
        + `block0 ${G.g_camera_block_yaw_bams}`);
  z.yaw = 0x8000;
  const m = DeathArcMotion(z, new Rng(5));
  check("a body facing the drawn camera falls back (0x8000 table), not by "
        + "block 0's quarter turn (0x3DF)", m === 901, String(m));
}

console.log("the counts an actor never joined:");
{
  // **An enemy the engine declines to count must not leave the count.**
  //
  // `CountEnemyZombieIn` skips two kinds -- character type 9, which has no
  // update handler at all, and initial state 0x1F, which counts itself in
  // later when its script flag comes up. The release paths are latched so that
  // six routines can all call them and only the first one counts, but the
  // latch said nothing about an actor that was never counted *in*. The engine
  // never had to care: it has no sweep, and nothing reaches an uncounted actor
  // with a release. The port's despawn sweep does, and it took both counters
  // to **-1** -- so every later `wait_enemies_alive <= 0` opened immediately.
  // A room that clears without killing anything is the same class of bug as
  // one that never clears, and much harder to notice.
  for (const [what, ct, initial] of [
    ["initial state 0x1F", 1, UNCOUNTED_INITIAL_STATE],
    ["character type 9", UNCOUNTED_CHAR_TYPE, 0],
  ] as const) {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    const z = spawnZombie(0x1000, ct, "zom",
                         { initialState: initial });
    check(`a zombie with ${what} is not in the counts`,
          G.g_enemies_alive === 0 && G.g_enemies_present === 0,
          `alive ${G.g_enemies_alive}, present ${G.g_enemies_present}`);
    ActorDespawn(z);
    GameUpdate(1 / 60, NULL_HOST, new Rng(1));
    check(`...and retiring it does not take them below zero`,
          G.g_enemies_alive === 0 && G.g_enemies_present === 0,
          `alive ${G.g_enemies_alive}, present ${G.g_enemies_present}`);
  }
}


console.log("class 0x31, the thrower actually lets go of the weapon:");
{
  // **`ThrowerStateThrow` advancing its own sub-state is not a throw.** The
  // release, `SpawnThrownWeapon` (`FUN_004504E0`), reads the hand's recorded
  // position and allocates the projectile; it has no path in the engine that
  // declines. The port asks the host for that position, and a host that could
  // not answer used to make the whole routine `return` — after the state had
  // already moved to `ThrowSub.Thrown`. So the clip played, the hand went
  // bare, the permit changed hands, and no axe ever left it.
  const HANDS = [
    { bone: 5, motion: 8, release_frame: 6, range: 20, overlay_kind: 6,
      cancel_mask: 2, held: 8098, bare: 8095, projectile: 8081 },
    { bone: 8, motion: 9, release_frame: 6, range: 20, overlay_kind: 6,
      cancel_mask: 4, held: 8094, bare: 8091, projectile: 8080 },
  ];
  const TYPE_THROWER = {
    ...TYPE31,
    // **Character type 0x16.** `ThrowerPickThrowingHand` (`FUN_0044F630`)
    // answers 0 for every type but 0x16 and 0x18 — as does
    // `ThrowerBothHandsArmed` (`FUN_0044F5D0`), the gate on the state — so a
    // `zstin` in state 0x1F is a thing the engine cannot make.
    type: 0x16,
    motions: {
      ...TYPE31.motions, "8": motion(24), "9": motion(24),
      // `ThrowerStateRearm`'s clip: motion id 5, a literal, not a set entry.
      "5": motion(20),
    },
    // `g_class31_throws` verbatim in shape: hands by body condition, then the
    // scalars `ThrowerStateThrow` and `ThrownWeaponFlyToTarget` read.
    throw: {
      hands: { "0": HANDS },
      // `SpawnThrownWeapon` writes 0x600 into `obj+0x135C` for `zsass`.
      spin: 0x600, speed: 1.2, aim_ahead: 4, aim_side: 0.6,
      stick_frames: 30, blink_frames: 60,
    },
  } as unknown as CharacterType;
  const CHARS_THROW = {
    ...CHARS31, types: { "1": TYPE, "22": TYPE_THROWER },
  } as unknown as CharactersJson;

  ResetGameGlobals();
  SetGameTables(CHARS_THROW);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_scene_state_major = SCENE_MAJOR_PLAYING;
  EnterPlay();
  G.g_camera_yaw_bams = 0;
  const z = ActorSpawn(0x9200, SpawnClass.Thrower, 0x16, "thrower", {
    initialState: ThrowerState.StandAndDecide, condition: 0,
  });
  z.visible = true;
  z.hp = 100;
  z.pos = vec3(0, 0, 60);
  z.yaw = 0;
  // `ThrowerEntryState` resolves state 31 to the hub — the throw is a state the
  // router picks, never a spawn's entrance — so it is set here rather than
  // asked for in the descriptor.
  z.state = ThrowerState.Throw;
  z.sub = 0;

  const rng = new Rng(23);
  const events = new Events();
  let threw = 0;
  events.on("enemy.threw", () => { threw += 1; });

  // `NULL_HOST` on purpose: it answers `boneWorld` with `false`, which is the
  // exact condition that used to swallow the throw.
  let seen: (typeof G.g_thrown_weapons)[number] | undefined;
  for (let i = 0; i < 300 && !seen; i++) {
    GameUpdate(1 / 60, NULL_HOST, rng, events);
    seen = G.g_thrown_weapons[0];
  }
  check("the release makes a weapon even when the host has no skeleton",
        seen !== undefined && threw >= 1,
        `pool ${G.g_thrown_weapons.length}, ${threw} throws`);
  if (seen) {
    check("...at the hand's own height, not at the actor's feet",
          seen.pos.y > z.pos.y, `${seen.pos.y} vs ${z.pos.y}`);
    // **`0x600` is a tilt, not a rate.** `SpawnThrownWeapon` (`FUN_004504E0`)
    // writes it to the projectile's `obj+0x1364`, and `ThrownWeaponUpdate`
    // (`FUN_00450780`) draws `Rz(obj+0x6C) * Ry(obj+0x68) * Rx(obj+0x1364 +
    // obj+0x64)` — so it is added once, to X. The *rate* is `obj+0x135C`,
    // which the same launcher writes as `0x2400` past the `MatrixStackPop`
    // its decompilation stops at (`0x0045072C`).
    check("...carrying the character type's own X tilt",
          seen.tilt === 0x600, String(seen.tilt));
    check("...spinning at the launcher's own 0x2400 a frame",
          seen.spinRate === THROWN_WEAPON_SPIN, String(seen.spinRate));
    // Class 0x31 tumbles about Y and negates for the other hand —
    // `ThrownWeaponFlyToTarget` (`FUN_0044FD40`) at `0x0044FDE9`, which tests
    // the throwing hand `obj+0x1358` against bone 5. The launch frame is also
    // a flight frame, so one step has been taken already.
    check("...tumbling about Y, which is class 0x31's term",
          seen.rx === 0 && seen.rz === 0
          && seen.ry === (seen.hand === 5 ? 1 : -1) * THROWN_WEAPON_SPIN,
          `rx ${seen.rx} ry ${seen.ry} rz ${seen.rz} hand ${seen.hand}`);

    // ...and it is a thing that moves. `ThrownWeaponFlyToTarget` sets the
    // velocity once, at launch, and the flight is a straight line at a
    // constant speed until the ttl runs out.
    const launch = { ...seen.pos };
    const before = dist2d(seen.pos, EYE);
    for (let i = 0; i < 20; i++) {
      GameUpdate(1 / 60, NULL_HOST, rng, events);
    }
    check("...and it travels", dist2d(seen.pos, launch) > 10,
          `${dist2d(seen.pos, launch).toFixed(1)} units`);
    check("...toward the camera", dist2d(seen.pos, EYE) < before,
          `${dist2d(seen.pos, EYE).toFixed(1)} from ${before.toFixed(1)}`);
    check("...a whole 0x2400 more every frame of it",
          seen.ry === (seen.hand === 5 ? 21 : -21) * THROWN_WEAPON_SPIN,
          String(seen.ry));

    // The hit is **timed, not tested**: the weapon damages the player when its
    // flight time runs out, wherever it happens to be. That is
    // `ThrownWeaponFlyToTarget`'s own shape, the same as the melee hit frame.
    let damaged = 0;
    events.on("player.damaged", () => { damaged += 1; });
    for (let i = 0; i < 200 && seen.sub < FlySub.Stick; i++) {
      GameUpdate(1 / 60, NULL_HOST, rng, events);
    }
    check("...and lands on the player when the flight time is up",
          seen.sub >= FlySub.Stick && damaged >= 1,
          `sub ${seen.sub}, ${damaged} damaged`);
  }
}

console.log("thrown weapons, the spin and the shot that takes one down:");
{
  // Reported as *"the knives that are thrown can't be shot out of the way"*,
  // and *"ensure that all knives follow the correct rotation speed and axis"*.
  //
  // Both weapon routines end their frame with the draw, the view point at
  // `obj+0x70` and `RegisterForShotTest` (`FUN_00405160`) --
  // `ThrownWeaponUpdate` (`FUN_00450780`) at `0x00450864`..`0x004508AA`,
  // `ZombieThrownWeaponUpdate` (`FUN_0045A4F0`) at `0x0045A5CC`..`0x0045A612`
  // -- and the port had none of it, so the shot test never saw a weapon. The
  // spin was the port's own `0x200` for every weapon; the launchers write
  // `0x2400` (class 0x31), `0xB00` (the axe) and `0x1600` (`znassb`'s
  // blades), and the three turn about Y, X and Y.
  //
  // A camera at the origin looking down world **+Z**, where the throwers
  // stand: `MatrixRotateY(0x8000)` is its own inverse, so it is both of the
  // camera block's matrices, and the view point the weapon's own draw leaves
  // is what the shot test measures against.
  const flip = MatIdentity();
  MatrixRotateY(flip, 0x8000);
  const HAND = vec3(0, 5, 60);
  const KNIFE_HOST: GameHost = {
    ...NULL_HOST,
    boneWorld: (_at, _bone, out) => {
      out.x = HAND.x; out.y = HAND.y; out.z = HAND.z;
      return true;
    },
    cameraMatrices: (w2v, v2w) => {
      for (let i = 0; i < 16; i++) { w2v[i] = flip[i]; v2w[i] = flip[i]; }
      return true;
    },
    viewSpaceOfPoint: (p, out) => {
      MatrixTransformPoint(flip, p, out);
      return true;
    },
  };
  const pullAt = (p: Vec3, rng: Rng, events: Events): void => {
    const l = Math.hypot(p.x - EYE.x, p.y - EYE.y, p.z - EYE.z);
    FireShotRequest({ player: 0, frame: 0, onScreen: 1, ray: {
      origin: vec3(EYE.x, EYE.y, EYE.z),
      dir: vec3((p.x - EYE.x) / l, (p.y - EYE.y) / l, (p.z - EYE.z) / l),
    } }, KNIFE_HOST, rng, events);
  };
  const registered = (id: number): boolean =>
    G.g_shot_test_list.some((e) => e.thrown === id);

  // -- class 0x31: zsass's knife ------------------------------------------
  {
    const HANDS = [
      { bone: 5, motion: 8, release_frame: 6, range: 20, overlay_kind: 6,
        cancel_mask: 2, held: 8098, bare: 8095, projectile: 0x1f91 },
      { bone: 8, motion: 9, release_frame: 6, range: 20, overlay_kind: 6,
        cancel_mask: 4, held: 8094, bare: 8091, projectile: 0x1f90 },
    ];
    const TYPE_ZSASS = {
      ...TYPE31, type: 0x16,
      motions: { ...TYPE31.motions, "8": motion(24), "9": motion(24),
                 "5": motion(20) },
      throw: { hands: { "0": HANDS }, spin: 0x600, speed: 1.2, aim_ahead: 4,
               aim_side: 0.6, stick_frames: 30, blink_frames: 60 },
    } as unknown as CharacterType;
    ResetGameGlobals();
    SetGameTables({ ...CHARS31, types: { "1": TYPE, "22": TYPE_ZSASS } } as
                  unknown as CharactersJson);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    EnterPlay();
    G.g_camera_yaw_bams = 0;
    const z = ActorSpawn(0x9300, SpawnClass.Thrower, 0x16, "zsass", {
      initialState: ThrowerState.StandAndDecide, condition: 0,
    });
    z.visible = true;
    z.hp = 100;
    z.pos = vec3(0, 0, 60);
    z.state = ThrowerState.Throw;
    z.sub = 0;
    const rng = new Rng(29);
    const events = new Events();
    const sounds: number[] = [];
    events.on("sound.play", (e) => sounds.push(e.id));
    let damaged = 0;
    events.on("player.damaged", () => { damaged += 1; });

    let w = G.g_thrown_weapons[0];
    for (let i = 0; i < 300 && !w; i++) {
      GameUpdate(1 / 60, KNIFE_HOST, rng, events);
      w = G.g_thrown_weapons[0];
    }
    check("zsass lets a knife go", w !== undefined
          && w.routine === ThrownWeaponRoutine.Thrower
          && (w.slot === 0x1f91 || w.slot === 0x1f90),
          `slot ${w?.slot}`);
    if (w) {
      const sign = w.hand === 5 ? 1 : -1;
      // `SpawnThrownWeapon` (`FUN_004504E0`): `MOV [ESI+0x135C], 0x2400` at
      // `0x0045072C`, past the `MatrixStackPop` its pseudocode stops at.
      check("...spinning 0x2400 a frame, the launcher's own rate",
            w.spinRate === THROWN_WEAPON_SPIN && w.ry === sign * 0x2400,
            `rate ${w.spinRate} ry ${w.ry}`);
      // Square to the world, leaning its type's 0x600 on X, spinning on Y.
      check("...about Y alone, square to the world but for the 0x600 lean",
            w.rx === 0 && w.rz === 0 && w.tilt === 0x600,
            `rx ${w.rx} rz ${w.rz} tilt ${w.tilt}`);
      // **The permit went with it**, and the thrower is left on 0, not -1.
      const permit = w.attackPermit;
      check("...carrying the thrower's permit, the thrower left on 0",
            permit >= 0 && z.attackPermit === 0
            && G.g_attack_permits[permit] !== -1,
            `weapon ${permit} thrower ${z.attackPermit} `
            + `table ${G.g_attack_permits.join(",")}`);
      check("...and in the shot test the frame it drew", registered(w.id)
            && w.draw !== null && w.view.z < 0,
            `registered ${registered(w.id)} view z ${w.view.z}`);
      for (let i = 0; i < 5; i++) {
        GameUpdate(1 / 60, KNIFE_HOST, rng, events);
      }
      check("...another 0x2400 every flight frame",
            w.ry === sign * 6 * 0x2400 && w.sub === FlySub.Flight,
            `ry ${w.ry} sub ${w.sub}`);

      // The pull. `ShotTestSphere` takes the weapon whole as a two-unit
      // sphere at the view point its last draw left.
      const hits = G.g_player_hit_count[0];
      const score = G.g_player_score[0];
      let resolved = "";
      events.on("shot.resolved", (e) => { resolved = e.kind; });
      pullAt(w.pos, rng, events);
      check("a pull at a knife in flight marks it", resolved === "marked"
            && (w.flags & ThrownWeaponFlag.Hit) !== 0, resolved);
      sounds.length = 0;
      const sprites = G.g_sprite_effects.length;
      GameUpdate(1 / 60, KNIFE_HOST, rng, events);
      // `ThrownWeaponUpdate`'s hit test, then `ThrownWeaponDeflected`
      // (`FUN_00450050`): subs 0 and 1 run through into 2 on one frame.
      check("...and on its next frame it is deflected",
            w.state === ThrownWeaponState.Deflected
            && w.sub === DeflectSub.Hang && w.timer === 4,
            `state ${w.state} sub ${w.sub} timer ${w.timer}`);
      check("...counting a hit and scoring nothing",
            G.g_player_hit_count[0] === hits + 1
            && G.g_player_score[0] === score,
            `hits ${G.g_player_hit_count[0]} score ${G.g_player_score[0]}`);
      check("...giving its permit back on the spot",
            G.g_attack_permits[permit] === -1 && w.attackPermit === -1,
            G.g_attack_permits.join(","));
      check("...with KNIFE2_OFF and the ricochet",
            sounds.includes(0x5217a9) && sounds.includes(0x1116a9),
            sounds.map((s) => s.toString(16)).join(","));
      check("...and zsass's kind-3 spark where it was hit",
            G.g_sprite_effects.length === sprites + 1
            && G.g_sprite_effects[sprites].kind === 3,
            `${G.g_sprite_effects[sprites]?.kind}`);
      // `ftol(0x2400 * 1.3 * ±1)` at `0x004501F3`..`0x0045020B`.
      check("...its spin now 1.3 times as fast, either way round",
            Math.abs(w.spinRate) === 11980, String(w.spinRate));
      check("...and out of the shot test for good", !registered(w.id)
            && (w.flags & ThrownWeaponFlag.Spent) !== 0);
      // Five frames hanging, then away, cartwheeling about X.
      for (let i = 0; i < 4; i++) {
        GameUpdate(1 / 60, KNIFE_HOST, rng, events);
      }
      const ry = w.ry, rx = w.rx;
      GameUpdate(1 / 60, KNIFE_HOST, rng, events);
      check("...then it tumbles away about X at the new rate",
            w.sub === DeflectSub.Away && w.ry === ry
            && Math.abs(w.rx - rx) === 11980,
            `sub ${w.sub} ry ${ry}->${w.ry} rx ${rx}->${w.rx}`);
      for (let i = 0; i < 200 && G.g_thrown_weapons.includes(w); i++) {
        GameUpdate(1 / 60, KNIFE_HOST, rng, events);
      }
      check("...and goes without ever touching the player",
            !G.g_thrown_weapons.includes(w) && damaged === 0,
            `in pool ${G.g_thrown_weapons.includes(w)} damaged ${damaged}`);
    }
  }

  // -- class 0x30: znassb's blades ------------------------------------------
  {
    const BLADES = [
      { bone: 5, held: 0x1ba9, bare: 0x1bac, weapon_bone: 6,
        projectile: 0x1b8d },
      { bone: 8, held: 0x1ba5, bare: 0x1ba8, weapon_bone: 9,
        projectile: 0x1b8c },
    ];
    const TYPE_ZNASSB = {
      ...TYPE,
      zombie_throw: { ...TYPE.zombie_throw, hands: BLADES, straight: false },
    } as unknown as CharacterType;
    const scene = () => {
      ResetGameGlobals();
      SetGameTables({ ...CHARS, types: { "1": TYPE_ZNASSB } } as unknown as
                    CharactersJson);
      G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
      G.g_scene_state_major = SCENE_MAJOR_PLAYING;
      EnterPlay();
      const z = spawnZombie(0x7800, 1, "znassb", {
        initialState: ZombieState.StandAndThrow, condition: 8,
        standThrow: { delay_two_hands: 0, delay_one_hand: 0,
                      delay_after_throw: 2, exit_state: 0, walk_distance: 5 },
      });
      z.visible = true;
      z.hp = z.maxHp = 100;
      z.pos = vec3(0, 0, 60);
      return z;
    };

    // The flight, straight off the launcher.
    {
      const z = scene();
      z.attackPermit = 0;
      G.g_attack_permits[0] = z.at;
      const rng = new Rng(3);
      ZombieThrowHandWeapon(z, 5, KNIFE_HOST);
      const w = G.g_thrown_weapons[0];
      check("znassb's blade flies the arc, spinning 0x1600",
            w.state === ZombieThrownWeaponState.Arc
            && w.spinRate === ZOMBIE_BLADE_SPIN && w.slot === 0x1b8d,
            `state ${w.state} rate ${w.spinRate} slot ${w.slot}`);
      check("...rolled 0x800, and the permit is the blade's now",
            w.rz === ZOMBIE_WEAPON_ROLL && w.attackPermit === 0
            && z.attackPermit === 0 && G.g_attack_permits[0] === z.at);
      const rx0 = w.rx, ry0 = w.ry;
      const frame: ThrownWeaponFrame = {
        cam: { w2v: flip, v2w: flip }, host: KNIFE_HOST, rng,
      };
      for (let i = 0; i < 4; i++) ThrownWeaponPoolUpdate(frame);
      // `ZombieThrownWeaponStateArc` (`FUN_004598F0`) at `0x00459998`:
      // `obj+0x68 += obj+0x135C`. The axe's straight state turns `obj+0x64`
      // instead; the port had both of them on X.
      check("...about Y, which is the arc's term and not the axe's",
            w.ry - ry0 === 4 * ZOMBIE_BLADE_SPIN && w.rx === rx0,
            `ry ${ry0}->${w.ry} rx ${rx0}->${w.rx}`);
      // Thrown down Z from (0, 0, 60) at a target four units out, so
      // `ZombieThrownWeaponBeginArc` bends it along **X**.
      check("...bending across the throw, along X, by the right hand's +0.009",
            w.acc.x > 0.0089 && w.acc.x < 0.0091 && w.acc.z === 0,
            `acc ${w.acc.x}, ${w.acc.z}`);

      // Shot down: `ZombieThrownWeaponStateShotDown` (`FUN_00459D20`).
      pullAt(w.pos, rng, new Events());
      const sprites = G.g_sprite_effects.length;
      ThrownWeaponPoolUpdate(frame);
      check("a pull takes the blade down: state 3, kind 0x52, permit freed",
            w.state === ZombieThrownWeaponState.ShotDown
            && G.g_sprite_effects[sprites]?.kind === 0x52
            && G.g_attack_permits[0] === -1,
            `state ${w.state} kind ${G.g_sprite_effects[sprites]?.kind} `
            + `table ${G.g_attack_permits.join(",")}`);
      check("...spinning 1.3 times as fast", Math.abs(w.spinRate) === 7321,
            String(w.spinRate));
    }

    // `ZombieThrownWeaponBeginArc` (`FUN_00459B70`): the other window bends
    // it along Z instead.
    {
      const z = scene();
      z.pos = vec3(-60, 0, 4);
      ZombieThrowHandWeapon(z, 8, KNIFE_HOST);
      const w = G.g_thrown_weapons[0];
      const t = ZombieThrownWeaponBeginArc(w, { ...w.pos }, { ...w.target },
                                           -0.009, 1.0);
      check("a blade thrown down X bends along Z, the time from dx and dy",
            w.acc.z === -0.009 && w.acc.x === 0
            && Math.abs(t - Math.hypot(w.target.x - w.pos.x,
                                       w.target.y - w.pos.y)) < 1e-9,
            `acc ${w.acc.x}, ${w.acc.z} t ${t}`);
    }

    // Both hands at once, and what it leaves the walker as.
    {
      const z = scene();
      for (let i = 0; i < 40 && G.g_thrown_weapons.length < 2; i++) {
        ZombieStateStandAndThrow(z, new Rng(1), KNIFE_HOST);
        ActorAdvanceMotion(z, 1 / 60);
      }
      // `0x004592E4`..`0x00459301`: character type 1 claims again, picks the
      // other hand and throws that too, on the same frame.
      check("znassb throws both blades on the one release frame",
            G.g_thrown_weapons.length === 2
            && G.g_thrown_weapons[0].hand !== G.g_thrown_weapons[1].hand,
            `${G.g_thrown_weapons.length} weapons`);
      // `ZombieRetireThrowConditionIfUnarmed` (`FUN_004595F0`).
      check("...and a condition-8 walker with nothing left sprints on as "
            + "condition 0", z.condition === 0
            && (z.flags & ZOMBIE_SPRINTS) !== 0,
            `condition ${z.condition} flags 0x${(z.flags >>> 0).toString(16)}`);
    }
  }
}

console.log("zslman's blades trail afterimages, and stop when they land:");
{
  // `ThrownWeaponUpdate` (`FUN_00450780`) ends, drawn or not, in
  //
  //   004508c2  CMP word ptr [ESI+0x1f4], 0x18      ; zslman's weapon only
  //   004508d3  TEST AX, AX / CMP [ESI+0x1312], 2   ; state 0, sub < 2
  //   004508e2  CMP AX, 1                           ; ...or state 1
  //   004508e9  CALL 0x00450930                     ; ZslmanBladeEmitAfterimage
  //
  // and the emitter allocates `ZslmanBladeAfterimageFade` (`FUN_00450A30`)
  // tasks. The port declared the call away. These drive the pool walk itself,
  // `ThrownWeaponPoolUpdate`, because the afterimage has to run on the frame
  // it is made -- `ActorAlloc` links it at the tail of the list being walked.
  const flip = MatIdentity();
  MatrixRotateY(flip, 0x8000);
  const cam = { w2v: flip, v2w: flip };
  const frame = (): ThrownWeaponFrame => ({
    cam, host: NULL_HOST, rng: new Rng(3),
  });
  // A blade as `SpawnThrownWeapon` (`FUN_004504E0`) leaves one: hand 8's
  // 0x1FE1, zslman's type copied across, both timers at 4, flying at a point
  // 50 units off so it is in the air for 41 frames.
  const blade = (slot = 0x1fe1, charType = 0x18): ThrownWeapon => {
    ResetGameGlobals();
    const w = ThrownWeaponAlloc(ThrownWeaponRoutine.Thrower);
    w.slot = slot;
    w.hand = slot === 0x1fe2 ? 5 : 8;
    w.charType = charType;
    w.flags = THROWN_WEAPON_SPAWN_FLAGS;
    w.drawFlags = THROWN_WEAPON_DRAW_FLAGS;
    w.spinRate = THROWN_WEAPON_SPIN;
    w.afterimageTimer = THROWN_WEAPON_AFTERIMAGE_PERIOD;
    w.afterimagePeriod = THROWN_WEAPON_AFTERIMAGE_PERIOD;
    w.attackPermit = -1;
    w.pos = vec3(0, 5, 54);
    w.target = vec3(0, 5, 4);
    G.g_thrown_weapons.push(w);
    return w;
  };
  const trail = () => G.g_thrown_weapons.filter(
    (x) => x.routine === ThrownWeaponRoutine.ZslmanAfterimage);

  // -- the cadence: the fifth call, then every fifth -----------------------
  {
    const w = blade();
    const madeOn: number[] = [];
    const seen = new Set<number>();
    for (let n = 1; n <= 20; n++) {
      ThrownWeaponPoolUpdate(frame());
      for (const a of trail()) {
        if (!seen.has(a.id)) { seen.add(a.id); madeOn.push(n); }
      }
    }
    // `DEC EAX` then `JNS` at 0x0045093B/0x00450942: 4, 3, 2, 1, 0 pass and
    // only the fifth call's -1 makes one -- then the 4 is reloaded.
    check("a zslman blade makes its first afterimage on the fifth frame, "
          + "then every fifth", JSON.stringify(madeOn) === "[5,10,15,20]",
          JSON.stringify(madeOn));
    check("...still flying the whole time", w.state === ThrownWeaponState.Fly
          && w.sub === FlySub.Flight, `state ${w.state} sub ${w.sub}`);
  }

  // -- one afterimage: what it copies, and how it fades --------------------
  {
    const w = blade();
    for (let n = 0; n < 5; n++) ThrownWeaponPoolUpdate(frame());
    const a = trail()[0];
    check("the afterimage is its own task, behind its blade",
          a !== undefined && G.g_thrown_weapons.indexOf(a) === 1
          && a.weapon === w.id, `${a?.weapon} vs ${w.id}`);
    if (a) {
      // `0x004509C8`..`0x004509E0`: 0x1FE1 becomes 0x1FE4 at 0.75.
      check("...drawing 0x1FE4 for hand 8's 0x1FE1, where the blade was",
            a.slot === 0x1fe4 && a.pos.z === w.pos.z && a.ry === w.ry
            && a.tilt === w.tilt && a.spinRate === w.spinRate,
            `slot ${a.slot.toString(16)} z ${a.pos.z}/${w.pos.z}`);
      // It ran the frame it was made: one fifteenth off 0.75, as an f32.
      const step = Math.fround(1 / 15);
      check("...and it ran on the frame it was made: 14 left, one step dimmer",
            a.timer === 14 && a.light === Math.fround(0.75 - step)
            && a.draw !== null, `timer ${a.timer} light ${a.light}`);
      check("...lit grey, because the model it draws is no longer 0x1FE1",
            a.lightColour !== null && a.lightColour[0] === a.light
            && a.lightColour[1] === a.light && a.lightColour[2] === a.light,
            JSON.stringify(a.lightColour));
      check("...and the blade counts it out, the afterimage its own index",
            w.afterimages === 1 && a.afterimages === 0,
            `${w.afterimages}/${a.afterimages}`);
      const z = a.pos.z;
      for (let n = 0; n < 3; n++) ThrownWeaponPoolUpdate(frame());
      check("...standing where it was made while the blade flies on",
            a.pos.z === z && w.pos.z < z, `${a.pos.z} vs ${w.pos.z}`);
      // Fifteen draws in all: the light is below zero by the last of them.
      let lastLight = a.light;
      for (let n = 0; n < 11; n++) {
        ThrownWeaponPoolUpdate(frame());
        lastLight = a.light;
      }
      check("...drawing a fifteenth time with its light below zero",
            a.timer === 0 && !a.despawned && lastLight < 0 && a.draw !== null,
            `timer ${a.timer} light ${lastLight}`);
      const out = w.afterimages;
      ThrownWeaponPoolUpdate(frame());
      check("...and gone on the sixteenth, giving its place back",
            a.despawned && a.draw === null && w.afterimages === out,
            `despawned ${a.despawned} count ${out}->${w.afterimages}`);
    }
    // Hand 5's blade trails 0x1FE5.
    blade(0x1fe2);
    for (let n = 0; n < 5; n++) ThrownWeaponPoolUpdate(frame());
    check("hand 5's 0x1FE2 trails 0x1FE5, at the same 0.75",
          trail()[0]?.slot === 0x1fe5
          && trail()[0]?.light === Math.fround(0.75 - Math.fround(1 / 15)),
          `${trail()[0]?.slot.toString(16)}`);
  }

  // -- the landing ends the trail, and gives nothing back ------------------
  {
    const w = blade();
    let landed = -1;
    for (let n = 1; n <= 60 && landed < 0; n++) {
      ThrownWeaponPoolUpdate(frame());
      if (w.flags & ThrownWeaponFlag.Landed) landed = n;
    }
    const live = trail().filter((a) => !a.despawned);
    check("the frame a blade lands, every afterimage behind it goes",
          landed > 0 && trail().length > 0 && live.length === 0,
          `landed on ${landed}, ${trail().length} out, ${live.length} live`);
    check("...without giving its count back, because the blade is spent",
          w.afterimages === trail().length && w.afterimages > 0,
          `count ${w.afterimages}, ${trail().length} were out`);
    const count = G.g_thrown_weapons.length;
    for (let n = 0; n < 30; n++) ThrownWeaponPoolUpdate(frame());
    check("...and a stuck blade makes no more",
          trail().length === 0 && G.g_thrown_weapons.length === 1
          && count > 1 && w.sub >= FlySub.Stick,
          `${trail().length} afterimages, sub ${w.sub}`);
  }

  // -- shot down: the trail carries on, and stops at ten -------------------
  {
    const w = blade();
    for (let n = 0; n < 12; n++) ThrownWeaponPoolUpdate(frame());
    w.flags |= ThrownWeaponFlag.Hit;
    ThrownWeaponPoolUpdate(frame());
    check("a blade shot out of the air is deflected, and spent",
          w.state === ThrownWeaponState.Deflected
          && (w.flags & ThrownWeaponFlag.Spent) !== 0, `state ${w.state}`);
    // Far enough that it is still in the air when the count runs out: the
    // point the deflection drew is up to a hundred units off, or as little as
    // fourteen.
    w.target = vec3(w.pos.x + 150, w.pos.y, w.pos.z);
    let made = trail().length;
    let most = w.afterimages;
    for (let n = 0; n < 150 && !w.despawned; n++) {
      ThrownWeaponPoolUpdate(frame());
      made = Math.max(made, G.g_thrown_weapons.filter(
        (x) => x.routine === ThrownWeaponRoutine.ZslmanAfterimage).length);
      most = Math.max(most, w.afterimages);
    }
    // `CMP [EBP+0x1368], 0xA` / `JGE`, and the fade's `TEST [EAX+0x34],
    // 0x4000000` / `JNZ` over the `DEC`: spent, nothing comes back, so the
    // count climbs to ten and the emitter stops for good.
    check("...and it keeps trailing until its count reaches ten, then stops",
          most === 10 && w.afterimages === 10, `count ${w.afterimages}`);
  }

  // -- a blade that is gone: its afterimage fades out its own fifteen ------
  {
    const w = blade();
    w.afterimageTimer = 0;
    ZslmanBladeEmitAfterimage(w);
    const a = trail()[0]!;
    // The blade leaves the list, as a shot-down one does when it arrives.
    G.g_thrown_weapons = G.g_thrown_weapons.filter((x) => x !== w);
    let drawn = 0;
    for (let n = 0; n < 20 && !a.despawned; n++) {
      ZslmanBladeAfterimageFade(a, frame());
      if (a.draw) drawn++;
    }
    check("an afterimage whose blade has gone still draws its fifteen",
          drawn === 15 && a.despawned && w.afterimages === 1,
          `${drawn} drawn, count ${w.afterimages}`);
  }

  // -- ActorKill's longjmp: a despawn ends the weapon's routine ------------
  {
    const w = blade();
    w.state = ThrownWeaponState.Deflected;
    w.sub = DeflectSub.Away;
    w.flags |= ThrownWeaponFlag.Spent;
    w.target = vec3(w.pos.x + 0.5, w.pos.y, w.pos.z);
    w.afterimageTimer = 0;
    ThrownWeaponPoolUpdate(frame());
    check("a blade that despawns in its state is not drawn that frame, and "
          + "trails nothing", w.despawned && w.draw === null
          && trail().length === 0 && w.afterimageTimer === 0,
          `draw ${w.draw !== null}, ${trail().length} afterimages`);
  }

  // -- nobody else trails ---------------------------------------------------
  {
    const w = blade(0x1f91, 0x16);
    for (let n = 0; n < 30; n++) ThrownWeaponPoolUpdate(frame());
    check("zsass's knife never calls the emitter", trail().length === 0
          && w.afterimageTimer === THROWN_WEAPON_AFTERIMAGE_PERIOD,
          `${trail().length} afterimages, timer ${w.afterimageTimer}`);
  }
}

console.log("class 0x31, the grab ends in the engine's one leave routine:");
{
  // **`ThrowerLeave` (`FUN_0044AD60`) was transcribed twice, with different
  // bodies.** `class31/death.ts` exported the real one -- retire from the
  // alive count, retire from the present count, release the attack permit,
  // drop the camera slot, despawn. `class31/scripted.ts` had a *private*
  // function of the same name and the same citation that released the permit
  // and set `dead`, and retired from neither count.
  //
  // `ThrowerStateGrabPlayer` (`FUN_0044EF90`) is one of the exe's two callers
  // of the real routine, and it was calling the thin copy. So every thrower
  // that finished its grab-and-throw left `g_enemies_alive` and
  // `g_enemies_present` one too high for the rest of the stage, and any later
  // `wait_enemies_alive` could never open -- a hang, from a duplicate.
  //
  // Nothing caught it because the port check keyed its ports by *name*, and
  // a set swallows the second of two. It keys by address now.
  //
  // The counts are what this asserts, because the counts are what hangs.
  const rng = new Rng(61);
  const events = new Events();
  const z = thrower(ThrowerState.GrabPlayer, {
    attackState: 7,
    grab: {
      offset: [0, -40, 0], cue_frame: 20, drop_frames: 10, hold_frames: 25,
      player: 0,
    },
  });
  z.pos = vec3(0, 60, 0);
  check("`EnemyThrowerInit` counted it in, alive and present",
        G.g_enemies_alive === 1 && G.g_enemies_present === 1,
        `alive ${G.g_enemies_alive}, present ${G.g_enemies_present}`);
  G.g_cam_path_frame = 20;
  for (let i = 0; i < 900 && !z.despawned; i++) {
    GameUpdate(1 / 60, CAM_HOST, rng, events);
  }
  check("the throw-away ends in a despawn, not a body left standing",
        z.despawned, `state ${z.state} sub ${z.sub}`);
  check("...and it leaves both counts, so the next wait can open",
        G.g_enemies_alive === 0 && G.g_enemies_present === 0,
        `alive ${G.g_enemies_alive}, present ${G.g_enemies_present}`);
  check("...and gives the attack permit back",
        G.g_attack_permits.every((x) => x === -1), G.g_attack_permits.join());
  check("...and drops out of the camera's enemy slots",
        !slotHolds(z.at), slotsShown());
}

/**
 * `ThrowerStateThrow` and the two compares that divert character type 0x18.
 *
 * It looked like a 23-frame late
 * release; it was that **and** the wrong clip, because `FUN_0044FAF0` tests
 * the character type twice — at 0x0044FB7A for the clip and again at
 * 0x0044FC83 for the release frame — and the port had been reading the
 * exported throw entry for both.
 *
 * The three checks below are the three things that were wrong or at risk:
 * the release frame, the clip, and the other character types not moving.
 */
console.log("class 0x31, ThrowerStateThrow, character type 0x18:");
{
  const rng = new Rng(97);
  /**
   * A thrower of a given character type, mid-throw and holding the permit.
   *
   * `drop` is the destroyed-zone bit of the hand that is **not** to throw:
   * `ThrowerPickThrowingHand` (`FUN_0044F630`) tosses a coin for a preferred
   * hand and takes the other whenever the preferred one is bare, so baring one
   * arm is how a test names the hand without owning the coin.
   */
  const throwing = (charType: number, at: number, drop = 0) => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS31);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    G.g_camera_yaw_bams = 0;
    const a = ActorSpawn(at, SpawnClass.Thrower, charType, "t", {
      initialState: ThrowerState.Throw, condition: 0,
    });
    // Narrowing, not a cast -- see `thrower` above.
    if (a.cls !== SpawnClass.Thrower) throw new Error("not class 0x31");
    a.visible = true;
    a.hp = 100;
    a.pos = vec3(0, 0, 80);
    a.zones |= drop;
    // `ThrowerEntryState` resolves a descriptor's 31 to the hub -- the throw is
    // a state the router picks, never an entrance -- so it is set here.
    a.state = ThrowerState.Throw;
    // The engine only ever *enters* state 0x1F holding the permit --
    // `ThrowerTryEnterState`'s case 0x1F claims one first -- so seed it,
    // rather than letting the state take the no-permit exit.
    a.attackPermit = 0;
    a.sub = ThrowSub.Draw;
    return a;
  };

  // 1. The release frame. `MOV dword ptr [ESI+0x1350], 0x19` at 0x0044FBE1
  //    and seven more; the bundle's entry says 48. The cursor is the base
  //    track's, `obj+0x19C`, which is what 0x0044FC9B reads.
  const z = throwing(0x18, 0x9200);
  ThrowerStateThrow(z, NULL_HOST, rng);
  z.playTicks = 24;
  ThrowerStateThrow(z, NULL_HOST, rng);
  check("type 0x18 has not let go on frame 24",
        z.sub === ThrowSub.Winding, `sub ${z.sub}`);
  z.playTicks = 25;
  ThrowerStateThrow(z, NULL_HOST, rng);
  check("...and lets go on 25, the constant the switch writes, not the "
        + "entry's 48", z.sub === ThrowSub.Thrown, `sub ${z.sub}`);

  // 2. The clip, per hand and per stance -- the whole reachable table.
  //    Bone 5 is entry 0 and bone 8 entry 1; baring the other arm is what
  //    forces the pick, since the coin is the engine's and not the test's.
  const STANCE = [
    ["ground", 0 as number],
    ["WallA", ThrowerFlag.WallA],
    ["WallB", ThrowerFlag.WallB],
    ["ceiling", ThrowerFlag.Ceiling],
  ] as const;
  const WANT = [[0x1f7, 0x1fc, 0x1f2, 0x204], [0x1f6, 0x1fb, 0x1f1, 0x203]];
  const OTHER_ARM = [DamageZone.LeftArm, DamageZone.RightArm];
  let clips = true;
  const got: string[] = [];
  for (let hand = 0; hand < 2; hand++) {
    for (let s = 0; s < STANCE.length; s++) {
      const a = throwing(0x18, 0x9210 + hand * 8 + s, OTHER_ARM[hand]);
      a.flags2 |= STANCE[s][1];
      ThrowerStateThrow(a, NULL_HOST, rng);
      const want = WANT[hand][s];
      if (a.motion !== want || a.attack !== hand) {
        clips = false;
        got.push(`${STANCE[s][0]}/${hand}: ${a.motion} want ${want}`);
      }
    }
  }
  check("the stance and the hand pick the clip the `.text` table names, "
        + "all eight of them", clips, got.join("; "));

  // 2b. And the clip does not start at frame zero. `PUSH 0x4 / PUSH 0x1a`
  //     (`6a04 6a1a`) at 0x0044FB87 for every type but 0x18, `PUSH 0x0`
  //     (`6a00`) at 0x0044FC6A for 0x18 -- and `FUN_004119A0` writes that
  //     third argument straight into the play cursor, `param_1[2] = param_3`.
  const s18 = throwing(0x18, 0x9240);
  ThrowerStateThrow(s18, NULL_HOST, rng);
  check("type 0x18's throw starts its clip at cursor 0",
        s18.playTicks === 0, `cursor ${s18.playTicks}`);

  // 3. The control. Three of the four character types read the entry, at
  //    0x0044FC8D -- `MOVSX EAX, word ptr [EDI + 0x8]`. Same fixture bytes.
  const y = throwing(0x16, 0x9230, DamageZone.LeftArm);
  ThrowerStateThrow(y, NULL_HOST, rng);
  check("type 0x16 still plays the throw entry's own clip",
        y.motion === 9, `motion ${y.motion}`);
  check("...from cursor 0x1A, not from zero", y.playTicks === 0x1a,
        `cursor ${y.playTicks}`);
  y.playTicks = 47;
  ThrowerStateThrow(y, NULL_HOST, rng);
  check("...and has not let go on 47", y.sub === ThrowSub.Winding, `sub ${y.sub}`);
  y.playTicks = 48;
  ThrowerStateThrow(y, NULL_HOST, rng);
  check("...and lets go on the entry's own 48, not on 25",
        y.sub === ThrowSub.Thrown, `sub ${y.sub}`);

  // 4. **The exit.** `g_motion_play_length[obj+0x1B4] - 1 <= obj+0x19C` and
  //    out to state 7 -- `MOV word ptr [ESI + 0x1310], 0x7`
  //    (`66c786101300000700`) at 0x0044FCE1, with `obj+0x1312` zeroed on the
  //    next instruction. Motion 9 is 40 authored frames, so its play length is
  //    78 and the last frame is 77.
  y.playTicks = 76;
  ThrowerStateThrow(y, NULL_HOST, rng);
  check("the throw holds until the clip's last frame",
        y.state === ThrowerState.Throw && y.sub === ThrowSub.Thrown,
        `state ${y.state} sub ${y.sub}`);
  y.playTicks = 77;
  ThrowerStateThrow(y, NULL_HOST, rng);
  check("...then hands back to the hub, sub zeroed -- it does not loop",
        y.state === ThrowerState.StandAndDecide && y.sub === 0,
        `state ${y.state} sub ${y.sub}`);
  check("...leaving the hand bare for state 29 to deal with",
        (y.zones & DamageZone.RightArm) !== 0
        && y.boneSlot["5"] === 8177, `zones ${y.zones}`);
}

/**
 * The whole loop, in one actor: hub -> throw -> hub -> re-arm -> hub.
 *
 * `ThrowerStateThrow` (`FUN_0044FAF0`) ends by writing state 7 and nothing
 * else; it is `ThrowerStateStandAndDecide` (`FUN_0044B180`) that offers state
 * 0x1D to `ThrowerTryEnterState` (`FUN_0044AFB0`) before it asks the router
 * anything, and `ThrowerStateRearm` (`FUN_0044F7A0`) that puts the weapon
 * back. The port used to do all of it inside the throw, looping there for ever
 * and swapping one hand back on its way round -- so the actor never reached
 * the hub, state 29 never ran, and nothing downstream of the hub could
 * happen either.
 */
console.log("class 0x31, a throw ends at the hub and state 29 re-arms it:");
{
  const HANDS = [
    { bone: 5, motion: 9, release_frame: 30, range: 20, overlay_kind: 6,
      cancel_mask: 2, held: 0x1fa2, bare: 0x1f9f, projectile: 8081 },
    { bone: 8, motion: 8, release_frame: 30, range: 20, overlay_kind: 6,
      cancel_mask: 4, held: 0x1f9e, bare: 0x1f9b, projectile: 8080 },
  ];
  const TYPE_REARM = {
    ...TYPE31,
    type: 0x16, name: "zsass", file: "zsass.bin",
    // Both hands carry a sphere, so the re-arm's write can be told from the
    // throw's zero whichever hand the coin gives.
    bones: [
      ...TYPE31.bones,
      { bone: 8, part: "l_hand", slot: 8, offset: [0, 0, 0], parent: null,
        damage_rank: [], hit_radius: 1.5, steps: [] },
    ],
    motions: {
      ...TYPE31.motions, "8": motion(24), "9": motion(24), "5": motion(20),
    },
    throw: {
      hands: { "0": HANDS },
      spin: 0x600, speed: 1.2, aim_ahead: 4, aim_side: 0.6,
      stick_frames: 30, blink_frames: 60,
    },
  } as unknown as CharacterType;
  const CHARS_REARM = {
    ...CHARS31, types: { "1": TYPE, "22": TYPE_REARM },
  } as unknown as CharactersJson;

  ResetGameGlobals();
  SetGameTables(CHARS_REARM);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_scene_state_major = SCENE_MAJOR_PLAYING;
  EnterPlay();
  G.g_camera_yaw_bams = 0;
  const z = ActorSpawn(0x9300, SpawnClass.Thrower, 0x16, "zsass", {
    initialState: ThrowerState.StandAndDecide, condition: 0,
  });
  if (z.cls !== SpawnClass.Thrower) throw new Error("not class 0x31");
  z.visible = true;
  z.hp = 100;
  z.pos = vec3(0, 0, 80);
  z.yaw = 0;
  // Straight into the throw, holding the permit, the way case 0x1F leaves it.
  z.state = ThrowerState.Throw;
  z.sub = ThrowSub.Draw;
  z.attackPermit = 0;

  const rng = new Rng(41);
  const events = new Events();
  const ARMS = DamageZone.RightArm | DamageZone.LeftArm;
  const ARMED = { "5": 0x1fa2, "8": 0x1f9e } as Record<string, number>;
  // Which hand the coin gave it. `ThrowerPickThrowingHand` owns that choice,
  // so the test reads it back rather than pinning it.
  let bare = "";
  // **One weapon per visit to state 31.** This is what tells the engine's
  // shape from the loop the port used to run: a state that hands back to the
  // hub throws once and lets state 29 re-arm it, where a state that re-arms a
  // hand itself and resets its own sub goes straight round again and empties
  // both hands before it ever leaves.
  let threw = 0;
  let threwBeforeHub = -1;
  events.on("enemy.threw", () => { threw += 1; });
  const seen = new Set<number>();
  let weapon: (typeof G.g_thrown_weapons)[number] | undefined;
  let radiusThrown: number | undefined;
  for (let i = 0; i < 600; i++) {
    GameUpdate(1 / 60, NULL_HOST, rng, events);
    weapon ??= G.g_thrown_weapons[0];
    seen.add(z.state);
    if (threwBeforeHub < 0 && threw > 0
        && z.state === ThrowerState.StandAndDecide) {
      threwBeforeHub = threw;
    }
    if (!bare && (z.zones & ARMS) !== 0) {
      bare = (z.zones & DamageZone.RightArm) !== 0 ? "5" : "8";
      radiusThrown = z.boneRadius[bare];
    }
    if (bare && seen.has(ThrowerState.Rearm) && (z.zones & ARMS) === 0) break;
  }

  check("the throw let a weapon go and left an arm bare", bare !== "",
        `states ${[...seen].join(",")}`);
  check("the clip's end hands back to the hub, state 7",
        seen.has(ThrowerState.StandAndDecide),
        `states ${[...seen].join(",")}`);
  check("...after exactly one throw, not after both hands are empty",
        threwBeforeHub === 1, `${threwBeforeHub} throws before the hub`);
  check("...and the hub offers state 29, which is where the re-arm lives",
        seen.has(ThrowerState.Rearm), `states ${[...seen].join(",")}`);
  check("...so the hand that threw holds its weapon again",
        bare !== "" && z.boneSlot[bare] === ARMED[bare],
        `bone ${bare} ${z.boneSlot[bare]}`);
  check("...with neither arm still counted destroyed", (z.zones & ARMS) === 0,
        `zones ${z.zones}`);
  // **The emptied hand could not be shot, and the re-arm gives its sphere
  // back.** `SpawnThrownWeapon` zeroes the bone record's `+0x78` in every arm
  // (`0x004505E8` and `0x004505BF` for this type's two hands), and
  // `ThrowerStateRearm` writes
  // the table's radius back at `0x0044F831`/`0x0044F891` -- which in the port
  // is the override coming off.
  check("...the throw zeroed the bare hand's hit-sphere radius",
        radiusThrown === 0, `bone ${bare} radius ${radiusThrown}`);
  const tableR = TYPE_REARM.bones.find((b) => String(b.bone) === bare)
    ?.hit_radius ?? 0;
  check("...and the re-arm wrote the table's radius back, unscaled",
        bare !== "" && tableR > 0 && z.boneRadius[bare] === tableR,
        `${JSON.stringify(z.boneRadius)} table ${tableR}`);
  // **The permit left with the weapon.** `SpawnThrownWeapon` (`FUN_004504E0`)
  // copies `obj+0x121` onto the projectile and writes the thrower's to 0 --
  // `MOV [EDI+0x121], BL` at `0x004506D5` with `EBX` zeroed -- and the weapon
  // gives it back when it is spent. This used to assert the thrower on -1 and
  // the pool empty, which was the port freeing the slot at the throw.
  check("...and the thrower is left on permit 0, its weapon holding the one "
        + "it had", z.attackPermit === 0 && weapon?.attackPermit === 0,
        `thrower ${z.attackPermit}, weapon ${weapon?.attackPermit}`);
}

// -- 13c. a body on the ground is not a target -------------------------------

/**
 * **`DispatchHit` (`FUN_004092F0`) is the only door into `ResolveHit`, and it
 * is shut while `obj+0x34` bit `0x100` is up.**
 *
 * Reported against stage 2, block 14, step 8, op 2 — the `zsass` at descriptor
 * `0x8094`: *"doesn't seem to die. shoot him enough, he makes a dead sound,
 * but then he keeps on [the] player."*
 *
 * The port charged damage to an actor the engine refuses to resolve a hit on
 * at all, and the window that refusal covers is exactly the window nothing is
 * listening in: `ThrowerOnShot` (`FUN_004499A0`) returns on the same bit, so a
 * `zsass` shot while it lay on the ground reached zero hit points with no
 * reaction chosen. `ThrowerStateFallAndLand`'s sub 4 is a switch arm, not a
 * fall-through from the survive test, so it then stood the corpse back up
 * through `ThrowerStateGetUp` — dead, still inside `g_enemies_alive`, still
 * throwing.
 *
 * The assertions are on the actor's own state and on the two counters, not on
 * `dead`: a flag a layer sets about itself was true the whole time and said
 * nothing about what the player could see.
 */
console.log("\na downed thrower, shot on the ground:");
{
  ResetGameGlobals();
  SetGameTables(CHARS31);
  G.g_app_state = AppState.InPlay;
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_scene_state_major = SCENE_MAJOR_PLAYING;
  EnterPlay();
  // A minute of a thrower on its feet takes every life, and a player out of
  // play has no trigger. This is a test of the thrower: the player is given
  // the engine's own "cannot be hurt" byte, `g_player_no_damage`.
  G.g_player_no_damage[0] = 1;
  openShutter();
  G.g_camera_yaw_bams = 0;

  const AT = 0x8094;
  const z = ActorSpawn(AT, SpawnClass.Thrower, 0x16, "zsass", {
    initialState: ThrowerState.StandAndDecide, condition: 0,
  });
  if (z.cls !== SpawnClass.Thrower) throw new Error("not class 0x31");
  z.visible = true;
  // Deep enough that the knockdown cannot be the killing blow: what is under
  // test is the shots that land *after* it is down.
  z.hp = z.maxHp = 400;
  z.pos = vec3(0, 0, 80);
  z.yaw = 0;

  const rng = new Rng(31);
  const events = new Events();
  const RAY = { origin: vec3(0, 0, 0), dir: vec3(0, 0, 1) };
  // Bone 1, the torso: the one bone in this fixture with a damage row, so a
  // shot that is *allowed* to resolve unmistakably moves the hit points.
  const host = { ...NULL_HOST,
    pickShot: () => ({ kind: "actor", at: z.at, bone: 1,
                       point: vec3() }) as ShotPick };
  const results: number[] = [];
  events.on("shot.resolved", (r) => results.push(r.result ?? -1));

  /** The four states class 0x31's death runs through, and nothing else. */
  const DYING = new Set([ThrowerState.FallAndLand, ThrowerState.Death,
                         ThrowerState.Corpse, ThrowerState.CorpseBlink]);
  let actedWhileDead = 0;
  let worstWhileDead = "";
  const step = (fire: boolean): void => {
    // A gun holds six. A player who shoots this long reloads, and the one
    // way a gun does is a pull off the screen (`PlayerFireAndReloadUpdate`),
    // made on the same frame ahead of the round.
    if (fire) {
      QueueOffscreenPull(0);
      QueueShotRequest(0, RAY);
    }
    GameUpdate(1 / 60, host, rng, events);
    const live = ActorByAt(AT);
    if (live?.dead && !live.despawned && !DYING.has(live.state)) {
      actedWhileDead += 1;
      worstWhileDead = `${ThrowerState[live.state] ?? live.state}/${live.sub}`;
    }
  };

  // Shoot until it is knocked off its feet and has settled: `obj+0x34` bit
  // 0x100 goes up at the end of `ThrowerStateFallAndLand`'s sub 2.
  let toDown = 0;
  while (toDown < 900 && !(z.flags & ActorFlag.ShotImmune)) {
    step(true);
    toDown += 1;
  }
  check("a thrower shot enough goes down and settles",
        (z.flags & ActorFlag.ShotImmune) !== 0 && !z.dead,
        `${toDown} frames, state ${z.state}/${z.sub}, hp ${z.hp}`);

  // Let it get as far as the get-up, sub 4, still shot-immune. **That is the
  // sub the report lives in**: sub 4 is reached from the switch, not through
  // sub 3's survive test, so nothing on that path ever re-reads `dead` —
  // a thrower killed here is stood back up by its own death state.
  let toGetUp = 0;
  while (toGetUp < 600 && (z.flags & ActorFlag.ShotImmune)
         && !(z.state === ThrowerState.FallAndLand && z.sub === 4)) {
    step(false);
    toGetUp += 1;
  }
  check("...lies there, and starts to get up while it is still immune",
        z.state === ThrowerState.FallAndLand && z.sub === 4
        && (z.flags & ActorFlag.ShotImmune) !== 0,
        `${toGetUp} frames, state ${z.state}/${z.sub}, `
        + `flags ${z.flags.toString(16)}`);

  // ...and now the whole of it, one round from death. Standing the hit points
  // at 1 by hand is what makes the two readings separable in one shot rather
  // than in a hundred: the engine refuses the round outright, so it stays at
  // 1, and the port charged it, so it went to -2 with nothing listening.
  z.hp = 1;
  const hpDown = z.hp;
  const scoreDown = G.g_player_score[0];
  results.length = 0;
  let shotsWhileDown = 0;
  let hpMovedWhileDown = 0;
  for (let i = 0; i < 240 && (z.flags & ActorFlag.ShotImmune); i++) {
    step(true);
    shotsWhileDown += 1;
    hpMovedWhileDown = Math.max(hpMovedWhileDown, hpDown - z.hp);
  }
  check("...and while it is down every round is refused by `DispatchHit`",
        shotsWhileDown > 0 && hpMovedWhileDown === 0,
        `${shotsWhileDown} rounds took ${hpMovedWhileDown} hp`);
  check("...so a body on the ground cannot be killed where nothing is "
        + "listening for the kill", !z.dead, `hp ${z.hp}, dead ${z.dead}`);
  check("...they ricochet: result 5, and no score",
        results.length > 0 && results.every((r) => r === HitResultCode.NoEffect)
        && G.g_player_score[0] === scoreDown,
        `results ${[...new Set(results)].join(",")}, `
        + `score ${scoreDown} -> ${G.g_player_score[0]}`);

  // Now stop, the way a player who has heard a death sound stops, and watch
  // ten seconds of it. This is the whole of the report: what the viewer saw
  // was a `zsass` that had made its noise and gone back to throwing.
  const deadOnTheGround = z.dead;
  for (let i = 0; i < 600; i++) step(false);
  check("...and ten seconds later it is still not dead, because none of those "
        + "rounds ever reached the damage tables",
        !deadOnTheGround && !z.dead,
        `dead ${deadOnTheGround} on the ground, ${z.dead} after`);

  // Then finish it properly: on its feet, where its own on-shot routine is
  // listening, the same rounds land and the death has somewhere to go.
  for (let i = 0; i < 9000 && ActorByAt(AT); i++) step(true);

  check("it never acts while dead — no standing, throwing or pouncing corpse",
        actedWhileDead === 0,
        `${actedWhileDead} frames, last in ${worstWhileDead}`);
  check("...and it dies: gone from the pool", !ActorByAt(AT),
        `state ${ThrowerState[z.state] ?? z.state}/${z.sub}, hp ${z.hp}`);
  check("...out of `g_enemies_alive`", G.g_enemies_alive === 0,
        `${G.g_enemies_alive}`);
  check("...and out of `g_enemies_present`", G.g_enemies_present === 0,
        `${G.g_enemies_present}`);
}

// -- 14. the collision, against real quads -----------------------------------

console.log("coli/, the game's own collision:");
{
  ResetGameGlobals();
  EnterPlay();
  T.coli = { files: ["test"], blobs: { wall: WALL_BLOB, floor: FLOOR_BLOB } };
  G.g_coli_full_set = ["wall", "floor"];
  G.g_camera_fixed_eye_y = -999;          // so a fallback is unmistakable

  // The wall's normal is -X, so its front is x < 30 — where the actor stands.
  // Every probe in the game traces **inward**, from a far point to the actor,
  // which is the direction the engine's `d0 <= 0 && d1 > 0` accepts.
  check("a segment across a quad hits it, at the quad's own plane",
        ColiTraceSegmentAllSets(60, 10, 45, 0, 10, 45)
        && Math.abs(G.g_coli_hit_x - 30) < 1e-4, `x ${G.g_coli_hit_x}`);
  check("...and reports the quad's material, which only coli/ carries",
        G.g_coli_hit_surface === 52, `${G.g_coli_hit_surface}`);
  // **A quad is one-sided.** The engine accepts only "behind, then in front",
  // and `g_coli_allow_backface` is written by nothing in the program — so the
  // same segment reversed does not hit at all. Reading the test as "opposite
  // signs" would make every wall in the game two-sided.
  check("the same segment reversed does not hit: quads are one-sided",
        !ColiTraceSegmentAllSets(0, 10, 45, 60, 10, 45));
  // Past the quad's own extent: the winding test refuses it.
  check("a segment past the quad's edge misses",
        !ColiTraceSegmentAllSets(60, 100, 45, 0, 100, 45));
  // Same side of the plane at both ends: no crossing, no hit.
  check("a segment that never crosses the plane misses",
        !ColiTraceSegmentAllSets(20, 10, 45, 0, 10, 45));
  // Nearest is measured from the **second** endpoint, which is what makes a
  // ground query find the floor under your feet and not the lowest in the map.
  T.coli = { files: ["test"], blobs: { hi: coliQuad([0, 1, 0, -20], 1,
      [-50, 20, 50, 50, 20, 50, 50, 20, -50, -50, 20, -50], 61),
    floor: FLOOR_BLOB } };
  G.g_coli_full_set = ["hi", "floor"];
  check("the nearer surface to the query's own end wins",
        QueryGroundHeightAt(0, 30, 0) === 20, `${QueryGroundHeightAt(0, 30, 0)}`);
  check("...and from below it is the low one",
        QueryGroundHeightAt(0, 10, 0) === 0, `${QueryGroundHeightAt(0, 10, 0)}`);
  T.coli = { files: ["test"], blobs: { wall: WALL_BLOB, floor: FLOOR_BLOB } };
  G.g_coli_full_set = ["wall", "floor"];

  check("the ground height comes off the floor quad",
        Math.abs(QueryGroundHeightAt(10, 20, 10)) < 1e-4,
        `${QueryGroundHeightAt(10, 20, 10)}`);
  check("...and falls back to the script's ground plane where there is none",
        QueryGroundHeightAt(10, 20, 9999) === -999,
        `${QueryGroundHeightAt(10, 20, 9999)}`);
  check("the surface query reports the material, 0 for a miss",
        QueryGroundSurfaceAt(10, 20, 10) === 52
        && QueryGroundSurfaceAt(10, 20, 9999) === 0);

  // The regression that cost a session: the winding test's sign factor is the
  // dominant normal component, but **negated on Y**, because dropping to the
  // (x, z) plane picks up the handedness of `x_hat x z_hat = -y_hat` while
  // (y, z) and (x, y) do not. One global polarity passes floors and rejects
  // every wall in the game -- or the reverse. All three axes, both signs.
  T.coli = { files: ["test"], blobs: {
    xneg: WALL_BLOB,
    xpos: coliQuad([1, 0, 0, 30], 0,
                   [-30, -10, 85, -30, -10, 5, -30, 40, 5, -30, 40, 85]),
    zneg: coliQuad([0, 0, -1, 30], 2,
                   [5, -10, 30, -75, -10, 30, -75, 40, 30, 5, 40, 30]),
    zpos: coliQuad([0, 0, 1, 30], 2,
                   [-75, -10, -30, 5, -10, -30, 5, 40, -30, -75, 40, -30]),
    yup: FLOOR_BLOB,
    ydown: coliQuad([0, -1, 0, 50], 1,
                    [-200, 50, -200, 200, 50, -200, 200, 50, 200,
                     -200, 50, 200]),
  } };
  G.g_coli_full_set = ["xneg", "xpos", "zneg", "zpos", "yup", "ydown"];
  const faces: [string, number[], number[]][] = [
    ["+x wall", [60, 10, 45], [0, 10, 45]],
    ["-x wall", [-60, 10, 45], [0, 10, 45]],
    ["+z wall", [-35, 10, 60], [-35, 10, 0]],
    ["-z wall", [-35, 10, -60], [-35, 10, 0]],
    ["floor", [0, -60, 0], [0, 10, 0]],
    ["ceiling", [0, 110, 0], [0, 10, 0]],
  ];
  const missed = faces.filter(([, a, b]) =>
    !ColiTraceSegmentAllSets(a[0], a[1], a[2], b[0], b[1], b[2]))
    .map(([n]) => n);
  check("every face orientation is hit from behind, on all three axes",
        missed.length === 0, `missed ${missed.join()}`);
  T.coli = { files: ["test"], blobs: { wall: WALL_BLOB, floor: FLOOR_BLOB } };
  G.g_coli_full_set = ["wall", "floor"];


  // The two sets differ in exactly one way: the sphere test ignores ray-only.
  G.g_coli_full_set = [];
  G.g_coli_ray_set = ["wall"];
  check("a ray-only blob still stops a segment",
        ColiTraceSegmentAllSets(60, 10, 45, 0, 10, 45));
  check("...but the sphere test does not see it",
        !ColiTestSphereAgainstFullSet(28, 10, 45, 5));
  G.g_coli_full_set = ["wall"];
  check("and it does once the blob is in the full set",
        ColiTestSphereAgainstFullSet(28, 10, 45, 5)
        && Math.abs(G.g_coli_hit_depth - 3) < 1e-4,
        `depth ${G.g_coli_hit_depth}`);
}

console.log("class 0x31's weapon: its ground shadow, its camera candidacy, "
            + "its hit slot:");
{
  // `ThrownWeaponUpdate` (`FUN_00450780`), past the shot-test registration:
  //
  //   004508af  PUSH 0x40a00000 / PUSH 0x40a00000 / PUSH ESI
  //   004508ba  CALL 0x0040a600      ; ActorDrawGroundShadowWithSize(obj, 5, 5)
  //   004508f1  CMP word [ESI+0x1310], 0 / JNZ
  //   004508fb  obj+0x100 = obj+0x40
  //   00450917  CALL 0x00408ec0      ; RegisterForCameraTracking(obj)
  //
  // and `SpawnThrownWeapon` (`FUN_004504E0`) opens with `ActorClaimHitSlot`
  // (`0x004504FE`) and closes with the same registration (`0x00450771`). The
  // port made none of the four calls.
  const flip = MatIdentity();
  MatrixRotateY(flip, 0x8000);
  const cam = { w2v: flip, v2w: flip };
  const frame = (): ThrownWeaponFrame => ({
    cam, host: NULL_HOST, rng: new Rng(3),
  });
  const knife = (): ThrownWeapon => {
    const w = ThrownWeaponAlloc(ThrownWeaponRoutine.Thrower);
    w.slot = 0x1f91;
    w.hand = 5;
    w.charType = 0x16;
    w.tilt = 0x600;
    w.flags = THROWN_WEAPON_SPAWN_FLAGS;
    w.drawFlags = THROWN_WEAPON_DRAW_FLAGS;
    w.spinRate = THROWN_WEAPON_SPIN;
    w.attackPermit = 0;
    w.pos = vec3(3, 18, 44);
    w.target = vec3(3, 18, 4);
    G.g_thrown_weapons.push(w);
    return w;
  };
  const at = (m: readonly number[] | null, p: Vec3): Vec3 => {
    const out = vec3();
    MatrixTransformPoint(m ?? MatIdentity(), p, out);
    return out;
  };
  const near = (a: Vec3, b: Vec3): boolean =>
    Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4
    && Math.abs(a.z - b.z) < 1e-4;
  // The disc this frame drew, as `ActorDrawGroundShadow` recorded it.
  const shadowDrawn = (): WorldSlotDraw | null =>
    G.g_world_slot_draws.find((d) => d.slot === GROUND_SHADOW_SLOT) ?? null;

  // -- the shadow: on the floor traced from three units above --------------
  {
    ResetGameGlobals();
    EnterPlay();
    // A ledge at y = 20, fifty units each way, over the street at y = 0, and
    // the knife flying inside it at y = 18: two under the ledge, so only a probe that starts **three** above
    // the knife (`FADD [0x004C49C0]`, 3.0) finds the ledge rather than the
    // street.
    const prevColi = T.coli;
    const prevSet = G.g_coli_full_set;
    T.coli = { files: ["test"], blobs: { hi: coliQuad([0, 1, 0, -20], 1,
        [-50, 20, 50, 50, 20, 50, 50, 20, -50, -50, 20, -50], 61),
      floor: FLOOR_BLOB } };
    G.g_coli_full_set = ["hi", "floor"];
    G.g_camera_fixed_eye_y = -999;
    const w = knife();
    G.g_world_slot_draws = [];
    ThrownWeaponPoolUpdate(frame());
    // `MatrixTranslate(x, h + 0.1, z); MatrixScale(5, 1, 5)` on top of the
    // view, so a world matrix; h the ledge: 20.1 as an f32.
    const h = Math.fround(20 + 0.10000000149011612);
    const shadow = shadowDrawn();
    check("a flying knife draws its shadow on the floor traced from three "
          + "above it, lifted 0.1, in layer 0xD", shadow !== null
          && shadow.layer === GROUND_SHADOW_LAYER
          && near(at(shadow.m, vec3(0, 0, 0)), vec3(w.pos.x, h, w.pos.z)),
          JSON.stringify(shadow && at(shadow.m, vec3(0, 0, 0))));
    const o = at(shadow?.m ?? null, vec3(0, 0, 0));
    const len = (p: Vec3): number => {
      const q = at(shadow?.m ?? null, p);
      return Math.hypot(q.x - o.x, q.y - o.y, q.z - o.z);
    };
    check("...five across, one high and five deep",
          Math.abs(len(vec3(1, 0, 0)) - THROWN_WEAPON_SHADOW_SIZE) < 1e-5
          && Math.abs(len(vec3(0, 1, 0)) - 1) < 1e-5
          && Math.abs(len(vec3(0, 0, 1)) - THROWN_WEAPON_SHADOW_SIZE) < 1e-5,
          `${len(vec3(1, 0, 0))} ${len(vec3(0, 1, 0))} ${len(vec3(0, 0, 1))}`);
    // The blink's off half: `obj+0x1F8` bit 0 down draws neither.
    w.drawFlags &= ~1;
    G.g_world_slot_draws = [];
    ThrownWeaponPoolUpdate(frame());
    check("...and none on a frame the knife is not drawn",
          shadowDrawn() === null && w.draw === null);
    T.coli = prevColi;
    G.g_coli_full_set = prevSet;
  }
  // -- the routine's three heights and its two refusals -------------------
  {
    ResetGameGlobals();
    G.g_camera_fixed_eye_y = -7;
    const obj = { flags: 0, pos: vec3(1, 2, 3) };
    const drawn = (drawWord: number, o = obj): readonly number[] | null => {
      G.g_world_slot_draws = [];
      ActorDrawGroundShadow(o, drawWord, 11, 10, null);
      return shadowDrawn()?.m ?? null;
    };
    const m1 = drawn(1);
    check("ActorDrawGroundShadow without bit 2 sits at the object's own y",
          m1 !== null
          && near(at(m1, vec3(0, 0, 0)), vec3(1, Math.fround(2.1), 3)),
          JSON.stringify(at(m1, vec3(0, 0, 0))));
    G.g_app_state = 0x0d as AppState;
    const m2 = drawn(5);
    check("...on g_camera_fixed_eye_y in app state 0xD, whatever the bits say",
          m2 !== null
          && near(at(m2, vec3(0, 0, 0)), vec3(1, Math.fround(-7 + 0.1), 3)),
          JSON.stringify(at(m2, vec3(0, 0, 0))));
    G.g_app_state = AppState.InPlay;
    check("...and none for obj+0x34 bit 0x80000 or obj+0x1F8 bit 0 clear",
          drawn(5, { flags: ActorFlag.NoShadow, pos: obj.pos }) === null
          && drawn(4) === null);
  }

  // -- the camera: a knife in flight is a candidate, and holds a permit slot
  {
    ResetGameGlobals();
    EnterPlay();
    HoldCameraAt(vec3(0, 15, 0));
    CameraUpdateTick();
    const w = knife();
    ThrownWeaponPoolUpdate(frame());
    const mine = G.g_camera_candidates.filter((c) => c.thrown === w.id);
    // `ftol(|obj+0x40 - g_camera_eye| * 10)`.
    const key = Math.trunc(Math.hypot(w.pos.x - G.g_camera_eye.x,
                                      w.pos.y - G.g_camera_eye.y,
                                      w.pos.z - G.g_camera_eye.z) * 10);
    check("a knife in state 0 offers itself to the camera, keyed on its "
          + "distance to g_camera_eye", mine.length === 1
          && mine[0]!.key === key, JSON.stringify(mine));
    check("...from obj+0x100, which it set to its position",
          near(w.lookAt, w.pos), JSON.stringify(w.lookAt));
    UpdateCameraEnemySlots();
    const slot = G.g_enemy_slots.findIndex((s) => s.thrown === w.id);
    const seen = CameraSlotObject(slot);
    check("...and, holding its thrower's permit, the fill deals it slot 0",
          slot === 0 && seen !== undefined && seen.attackPermit === 0
          && near(seen.lookAt, w.pos), `slot ${slot}`);
    // Shot down: state 1 runs and offers nothing.
    w.state = ThrownWeaponState.Deflected;
    w.sub = DeflectSub.Struck;
    ThrownWeaponPoolUpdate(frame());
    check("a knife that has been shot down is no candidate",
          !G.g_camera_candidates.some((c) => c.thrown === w.id));
  }

  // -- through the thrower: the launch claims a hit slot and registers -----
  {
    const HANDS = [
      { bone: 5, motion: 8, release_frame: 6, range: 20, overlay_kind: 6,
        cancel_mask: 2, held: 8098, bare: 8095, projectile: 0x1f91 },
      { bone: 8, motion: 9, release_frame: 6, range: 20, overlay_kind: 6,
        cancel_mask: 4, held: 8094, bare: 8091, projectile: 0x1f90 },
    ];
    const TYPE_ZSASS = {
      ...TYPE31, type: 0x16,
      motions: { ...TYPE31.motions, "8": motion(24), "9": motion(24),
                 "5": motion(20) },
      throw: { hands: { "0": HANDS }, spin: 0x600, speed: 1.2, aim_ahead: 4,
               aim_side: 0.6, stick_frames: 30, blink_frames: 60 },
    } as unknown as CharacterType;
    ResetGameGlobals();
    SetGameTables({ ...CHARS31, types: { "1": TYPE, "22": TYPE_ZSASS } } as
                  unknown as CharactersJson);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    EnterPlay();
    G.g_camera_yaw_bams = 0;
    const z = ActorSpawn(0x9300, SpawnClass.Thrower, 0x16, "zsass", {
      initialState: ThrowerState.StandAndDecide, condition: 0,
    });
    z.visible = true;
    z.hp = 100;
    z.pos = vec3(0, 0, 60);
    z.state = ThrowerState.Throw;
    z.sub = 0;
    const rng = new Rng(29);
    let w = G.g_thrown_weapons[0];
    for (let i = 0; i < 300 && !w; i++) {
      GameUpdate(1 / 60, CAM_HOST, rng);
      w = G.g_thrown_weapons[0];
    }
    check("zsass lets a knife go", w !== undefined);
    if (w) {
      // `ActorClaimHitSlot` at `0x004504FE`: the first free entry after the
      // thrower's own.
      check("...which claims the next g_hit_slots entry after its thrower's",
            w.hitSlot === z.hitSlot + 1 && (w.flags38 & 0x40) !== 0
            && G.g_hit_slots[w.hitSlot] === ThrownWeaponHitSlotOwner(w.id),
            `weapon ${w.hitSlot} thrower ${z.hitSlot} `
            + `table ${G.g_hit_slots.join(",")}`);
      // The launch registers once (`0x00450771`) and the weapon's own first
      // frame, the same walk, once more (`0x00450917`).
      const id = w.id;
      check("...and is offered to the camera twice on the frame it is made",
            G.g_camera_candidates.filter((c) => c.thrown === id).length === 2,
            JSON.stringify(G.g_camera_candidates));
      const slot = w.hitSlot;
      for (let i = 0; i < 400 && G.g_thrown_weapons.includes(w); i++) {
        GameUpdate(1 / 60, CAM_HOST, rng);
      }
      check("...and gives the entry back when it despawns",
            !G.g_thrown_weapons.includes(w)
            && G.g_hit_slots[slot] === HIT_SLOT_NONE
            && w.hitSlot === HIT_SLOT_NONE,
            `in pool ${G.g_thrown_weapons.includes(w)} `
            + `entry ${G.g_hit_slots[slot]}`);
    }
  }
}

console.log("class 0x30's weapon: the same three calls:");
{
  // `ZombieThrowHandWeapon` (`FUN_0045A240`) opens with `ActorClaimHitSlot`
  // (`0x0045A25F`) and closes with `obj+0x104 = y + 1.5` -- for every weapon
  // -- and `RegisterForCameraTracking` (`0x0045A4DD`); `ZombieThrownWeaponUpdate`
  // (`FUN_0045A4F0`) draws the 5-by-5 shadow (`0x0045A622`) and, in states 1
  // and 2, files `obj+0x100` -- lifted 1.5 for the axe alone -- with the
  // camera (`0x0045A676`).
  const flip = MatIdentity();
  MatrixRotateY(flip, 0x8000);
  const frame = (): ThrownWeaponFrame => ({
    cam: { w2v: flip, v2w: flip }, host: NULL_HOST, rng: new Rng(5),
  });
  const ZNASSB = {
    ...TYPE,
    zombie_throw: {
      ...TYPE.zombie_throw, straight: false,
      hands: [
        { bone: 5, held: 0x1ba9, bare: 0x1bac, weapon_bone: 6,
          projectile: 0x1b8d },
        { bone: 8, held: 0x1ba5, bare: 0x1ba8, weapon_bone: 9,
          projectile: 0x1b8c },
      ],
    },
  } as unknown as CharacterType;
  const throwOne = (type: CharacterType) => {
    ResetGameGlobals();
    SetGameTables({ ...CHARS, types: { "1": type } } as unknown as
                  CharactersJson);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    EnterPlay();
    G.g_camera_fixed_eye_y = -3;
    const z = spawnZombie(0x7900, 1, "thrower", {
      initialState: ZombieState.StandAndThrow, condition: 8,
      standThrow: { delay_two_hands: 0, delay_one_hand: 0,
                    delay_after_throw: 2, exit_state: 0, walk_distance: 5 },
    });
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.pos = vec3(2, 0, 40);
    z.attackPermit = 0;
    G.g_attack_permits[0] = z.at;
    ZombieThrowHandWeapon(z, 5, NULL_HOST);
    return { z, w: G.g_thrown_weapons[0]! };
  };
  const filed = (id: number) =>
    G.g_camera_candidates.filter((c) => c.thrown === id);
  const lift = (y: number): number => Math.fround(y + 1.5);

  // -- the axe --------------------------------------------------------------
  {
    const { z, w } = throwOne(TYPE);
    check("the axe claims the g_hit_slots entry after its thrower's",
          w.slot === ZOMBIE_AXE_SLOT && z.hitSlot !== HIT_SLOT_NONE
          && w.hitSlot === z.hitSlot + 1 && (w.flags38 & 0x40) !== 0
          && G.g_hit_slots[w.hitSlot] === ThrownWeaponHitSlotOwner(w.id),
          `weapon ${w.hitSlot} thrower ${z.hitSlot} `
          + `table ${G.g_hit_slots.join(",")}`);
    const key = Math.trunc(Math.hypot(w.pos.x - G.g_camera_eye.x,
                                      w.pos.y - G.g_camera_eye.y,
                                      w.pos.z - G.g_camera_eye.z) * 10);
    check("...and is filed with the camera at the launch, its point 1.5 up "
          + "and its key from the unlifted position",
          filed(w.id).length === 1 && filed(w.id)[0]!.key === key
          && w.lookAt.y === lift(w.pos.y) && w.lookAt.x === w.pos.x
          && w.lookAt.z === w.pos.z,
          `${JSON.stringify(filed(w.id))} lookAt ${JSON.stringify(w.lookAt)}`);
    ThrownWeaponPoolUpdate(frame());
    check("in flight (state 1) it files again, the axe's point still 1.5 up",
          w.state === ZombieThrownWeaponState.Straight
          && filed(w.id).length === 2 && w.lookAt.y === lift(w.pos.y),
          `state ${w.state} filed ${filed(w.id).length} `
          + `lookAt.y ${w.lookAt.y} y ${w.pos.y}`);
    const o = vec3();
    const disc = G.g_world_slot_draws.filter(
      (d) => d.slot === GROUND_SHADOW_SLOT).pop();
    MatrixTransformPoint(disc?.m ?? MatIdentity(), vec3(0, 0, 0), o);
    const want = vec3(w.pos.x, Math.fround(-3 + 0.1), w.pos.z);
    check("...and draws its shadow 0.1 over the floor under it",
          disc !== undefined && Math.abs(o.x - want.x) < 1e-4
          && Math.abs(o.y - want.y) < 1e-4 && Math.abs(o.z - want.z) < 1e-4,
          JSON.stringify(o));
    const slot = w.hitSlot;
    for (let i = 0; i < 400 && G.g_thrown_weapons.includes(w); i++) {
      ThrownWeaponPoolUpdate(frame());
    }
    check("...and gives the entry back when it despawns",
          !G.g_thrown_weapons.includes(w)
          && G.g_hit_slots[slot] === HIT_SLOT_NONE,
          `in pool ${G.g_thrown_weapons.includes(w)} `
          + `entry ${G.g_hit_slots[slot]}`);
  }

  // -- znassb's blade -------------------------------------------------------
  {
    const { w } = throwOne(ZNASSB);
    check("a blade's launch point is lifted 1.5 as well",
          w.slot === 0x1b8d && filed(w.id).length === 1
          && w.lookAt.y === lift(w.pos.y), `lookAt.y ${w.lookAt.y}`);
    ThrownWeaponPoolUpdate(frame());
    check("...but in flight (state 2) a blade's point is not lifted",
          w.state === ZombieThrownWeaponState.Arc
          && filed(w.id).length === 2 && w.lookAt.y === w.pos.y,
          `state ${w.state} lookAt.y ${w.lookAt.y} y ${w.pos.y}`);
    w.state = ZombieThrownWeaponState.ShotDown;
    w.sub = 0;
    G.g_camera_candidates = [];
    G.g_camera_candidate_count = 0;
    ThrownWeaponPoolUpdate(frame());
    check("shot down (state 3) it is not filed", filed(w.id).length === 0);
  }
}

console.log("\na knife stuck to the screen: its point follows the camera, its angles do not");
{
  // BUGS.md asked whether a lodged knife should turn with the camera. In the
  // exe it does not. `ThrownWeaponFlyToTarget` (`FUN_0044FD40`)'s stick and
  // blink arms (`0x0044FF7D`, `0x0044FFC5`) re-aim the **point** every frame
  // -- `AimThrownWeapon` (`FUN_004503D0`) into `obj+0x13C0..C8`, copied to
  // `obj+0x40..0x48` -- and write none of `obj+0x64`/`+0x68`/`+0x6C`, which
  // the landing set once; `ThrownWeaponUpdate` (`FUN_00450780`) draws them as
  // world angles under the current camera. So when the camera yaws, the knife
  // stays on the same spot of the screen and turns against it. `[proved]`
  // This pins that, so it is not "fixed" into something the game never did.
  const look = (yaw: number) => {
    const w2v = MatIdentity();
    MatrixRotateY(w2v, yaw);
    const v2w = MatIdentity();
    MatrixRotateY(v2w, (-yaw) & 0xffff);
    return { w2v, v2w };
  };
  ResetGameGlobals();
  G.g_max_attackers = 1;
  const w = ThrownWeaponAlloc(ThrownWeaponRoutine.Thrower);
  w.slot = 0x1fe1;
  w.hand = 8;
  w.flags = THROWN_WEAPON_SPAWN_FLAGS;
  w.drawFlags = THROWN_WEAPON_DRAW_FLAGS;
  w.spinRate = THROWN_WEAPON_SPIN;
  w.attackPermit = 0;
  w.pos = vec3(0, 5, 54);
  w.target = vec3(0, 0, -4);
  G.g_thrown_weapons.push(w);
  let cam = look(0);
  const frame = (): ThrownWeaponFrame => ({ cam, host: NULL_HOST,
                                            rng: new Rng(9) });
  for (let n = 0; n < 200 && w.sub !== FlySub.Stick; n++) {
    ThrownWeaponPoolUpdate(frame());
  }
  const landed = { rx: w.rx, ry: w.ry, rz: w.rz };
  // The camera turns a quarter, and the weapon runs on stuck.
  cam = look(0x4000);
  ThrownWeaponPoolUpdate(frame());
  const want = vec3();
  MatrixTransformPoint(cam.v2w, vec3(0, 0, -4), want);
  check("stuck, the knife's point is four units down the camera that turned",
        w.sub === FlySub.Stick && Math.abs(w.pos.x - want.x) < 1e-4
        && Math.abs(w.pos.z - want.z) < 1e-4,
        `sub ${w.sub} pos ${w.pos.x.toFixed(2)},${w.pos.z.toFixed(2)} `
        + `want ${want.x.toFixed(2)},${want.z.toFixed(2)}`);
  check("...and its three angles are the landing's, unturned",
        w.rx === landed.rx && w.ry === landed.ry && w.rz === landed.rz,
        `${w.rx},${w.ry},${w.rz} vs ${landed.rx},${landed.ry},${landed.rz}`);
}
