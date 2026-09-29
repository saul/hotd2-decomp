import type { CharactersJson, CharacterType } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { ActorSpawn, GameUpdate } from "../../src/game/director";
import { CameraHoldEyeTick } from "../../src/game/camera/hooks";
import { G, ResetGameGlobals } from "../../src/game/globals";
import { NULL_HOST, type GameHost } from "../../src/game/host";
import {
  MatIdentity, MatrixRotateX, MatrixRotateZ, MatrixTransformVector,
  VecAimYAxisZThenX, FtolS16,
} from "../../src/game/matrix";
import { SpriteEffectKind } from "../../src/game/effects/sprite";
import { SetGameTables, T } from "../../src/game/tables";
import { ZombieState } from "../../src/game/class30/states";
import { ZombieStateBackOff } from "../../src/game/class30/backoff";
import { ZombieStateWaitTurn } from "../../src/game/class30/wait_turn";
import { ActorRunNodeDrawHooks } from "../../src/game/model_draw";
import { ThrowerDrawBonePart } from "../../src/game/class31/draw";
import { ZombieDrawBonePart } from "../../src/game/class30/draw";
import {
  ActorAimHeadAtCamera, ActorHeadAimAngles, HEAD_AIM_RATE, HeadAimBeginDraw,
  HeadAimEndDraw, ThrowerHeadAims,
} from "../../src/game/class30/head_aim";
import {
  ActorFlag, ThrowerFlag, ZombieFlag2, type ZombieActor,
} from "../../src/game/actor";
import { ZombieOnShot } from "../../src/game/class30/on_shot";
import { ArcPhase } from "../../src/game/class31/arc";
import { type ClassFrame } from "../../src/game/registry";
import { ZombiePushOutOfWorldAndActors } from "../../src/game/class30/ground";
import {
  ZOMBIE_SPRINTS, ZombieWaitMotion,
} from "../../src/game/class30/states";
import {
  AngleWithinTolerance, TurnActorAwayFromPoint,
  TurnActorAwayFromPointTestArrival, TurnActorTowardCamera, TurnAngleToward,
} from "../../src/game/actor_turn";
import { ZombieRunTurnRate, ZombieStateAttackRun, g_wait_turn_variant }
  from "../../src/game/class30/attack_run";
import { ThrowerStateWithdraw } from "../../src/game/class31/pounce";
import { ThrowerStateDelayedPounce } from "../../src/game/class31/entrance";
import { SpawnClass } from "../../src/game/spawn_class";
import {
  FALL_GRAVITY, SND_BOUNCE, ThrowerStateFallAndLand,
} from "../../src/game/class31/death";
import { GroundDustCode, ThrowerEmitGroundDust }
  from "../../src/game/class31/ground_dust";
import { ThrowerStateStandAndDecide } from "../../src/game/class31/stand";
import {
  ActorArcBegin, ActorArcStep, InstallArcMotionScript,
} from "../../src/game/class31/arc";
import { ThrowerState } from "../../src/game/class31/states";
import { vec3 } from "../../src/game/vec";
import { HitResultCode } from "../../src/game/combat/resolve_hit";
import { VecToAngles } from "../../src/game/vec";
import {
  check, motion, TYPE, CHARS, SCENE_MAJOR_PLAYING, spawnZombie, PublishCrowd,
  scene, EnterPlay, ARC, TYPE31, CLASS31, TYPE31_ZSASS, TYPE31_ZSLMAN, CHARS31,
  coliQuad, FLOOR_BLOB, thrower,
} from "./harness";

// -- the turn routines, as the exe has them ---------------------------------
//
// `TurnAngleToward` (`FUN_00409E00`) was an ease for the attack run and a
// wrapped rate limit everywhere else, with a 0x8000 flip standing in for what
// a negative rate does. These pin the routine itself and what its callers
// hand it.

console.log("\nTurnAngleToward: the rate limit, the seam, the tie, and a negative rate:");
{
  check("within the rate it lands on the target",
        TurnAngleToward(0x1000, 0x1030, 0x40) === 0x1030);
  check("...masked to sixteen bits, both of them",
        TurnAngleToward(0x21000, 0x31030, 0x40) === 0x1030);
  check("outside it, one step of the rate toward the target",
        TurnAngleToward(0x1000, 0x3000, 0x40) === 0x1040
        && TurnAngleToward(0x3000, 0x1000, 0x40) === 0x2fc0);
  // Short way through the seam -- and the result is the caller's to store as
  // it is: `a + rate` past 0xFFFF, `a - rate` below zero. The old port
  // wrapped both.
  check("across the seam it goes the short way, and does not wrap the result",
        TurnAngleToward(0xfff0, 0x0100, 0x10) === 0x10000
        && TurnAngleToward(0x0010, 0xff00, 0x20) === -0x10,
        `${TurnAngleToward(0xfff0, 0x0100, 0x10)} `
        + `${TurnAngleToward(0x0010, 0xff00, 0x20)}`);
  check("exactly half a turn apart: up from below, down from above",
        TurnAngleToward(0, 0x8000, 0x40) === 0x40
        && TurnAngleToward(0x8000, 0, 0x40) === 0x7fc0);
  // A negative rate never lands -- not even on a target it is already on --
  // and steps the long way.
  check("a negative rate steps away even from where it stands",
        TurnAngleToward(0x1000, 0x1000, -0x40) === 0x1040);
  let y = 0x1000;
  const seen: number[] = [];
  for (let i = 0; i < 1000; i++) {
    y = TurnAngleToward(y, 0x1000, -0x40);
    if (i >= 996) seen.push(y & 0xffff);
  }
  check("...runs to the opposite heading and dithers about it, a step each way",
        seen.every((v) => v === 0x9000 || v === 0x9040)
        && seen[0] !== seen[1] && seen[1] !== seen[2],
        seen.map((v) => v.toString(16)).join(" "));
}

console.log("\nAngleWithinTolerance, `FUN_0040A040`:");
{
  check("both ends of the window count, across the seam",
        AngleWithinTolerance(0xfff0, 0x10, 0x20)
        && AngleWithinTolerance(0x30, 0x10, 0x20));
  check("...and one past either end does not",
        !AngleWithinTolerance(0xffef, 0x10, 0x20)
        && !AngleWithinTolerance(0x31, 0x10, 0x20));
  check("an unwrapped angle is masked first",
        AngleWithinTolerance(0x10030, 0x10, 0x20));
}

console.log("\nTurnActorTowardCamera: the point 1.5 from the eye, turned by its height:");
{
  ResetGameGlobals();
  SetGameTables(CHARS);
  const z = spawnZombie(0x7a00, 1, "turner");
  // Eye at the origin and level: the point is (0, 0, 1.5). An actor at z = 1
  // is *behind* that point, so the heading it takes is 0x8000 -- measured to
  // the eye itself it would be 0, which is what the port used to aim at.
  z.pos = vec3(0, 0, 1);
  z.yaw = 0x8000 - 0x100;
  G.g_camera_eye = vec3(0, 0, 0);
  TurnActorTowardCamera(z, 0x1a0, 1 / 60);
  check("it faces the point, not the eye", (z.yaw & 0xffff) === 0x8000,
        z.yaw.toString(16));
  // `MatrixRotateY(__ftol(g_camera_eye_y))`: at a height of 0x4000 the point
  // swings a quarter turn, onto (1.5, y, 0), and an actor at (1.5, 0, 1) is
  // then straight "ahead" of it at heading 0.
  z.pos = vec3(1.5, 0, 1);
  z.yaw = 0x100;
  G.g_camera_eye = vec3(0, 0x4000, 0);
  TurnActorTowardCamera(z, 0x1a0, 1 / 60);
  check("...and the point turns with the eye's height, not its yaw",
        (z.yaw & 0xffff) === 0, z.yaw.toString(16));
  // One engine frame per step: a tick of three frames is three steps.
  z.pos = vec3(0, 0, 40);
  z.yaw = 0x4000;
  G.g_camera_eye = vec3(0, 0, 0);
  TurnActorTowardCamera(z, 0x1a0, 3 / 60);
  check("a three-frame tick turns three steps of the rate",
        z.yaw === 0x4000 - 3 * 0x1a0, z.yaw.toString(16));
}

console.log("\nZombieStateAttackRun: the turn rate, the bands, and the wait clip:");
{
  const WAIT_ALT = 11;
  const TYPE_PAIRS: CharacterType = {
    ...TYPE,
    // Two different waits and two different runs, so which one is taken
    // shows. The fixture's own row names 10 twice and 12 twice.
    motion_row: { "0": [10, WAIT_ALT, 12, 13, 14],
                  "8": [10, WAIT_ALT, 12, 13, 14] },
    motions: { ...TYPE.motions, "11": motion(20, 0, 37),
               "13": motion(16, 2.5) },
  };
  const CHARS_PAIRS =
    { ...CHARS, types: { "1": TYPE_PAIRS } } as unknown as CharactersJson;
  const runner = (flags: number, z0: number, cond = 0) => {
    ResetGameGlobals();
    SetGameTables(CHARS_PAIRS);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    EnterPlay();
    G.g_camera_fixed_eye_y = 0;
    const z = spawnZombie(0x7b00, 1, "runner", {
      initialState: ZombieState.AttackRun, condition: cond,
    });
    z.flags |= flags;
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.pos = vec3(0, 0, z0);
    z.state = ZombieState.AttackRun;
    z.sub = 0;
    return z;
  };

  check("the jog turns 0x1A0 a frame and the sprint 0x410",
        ZombieRunTurnRate(runner(0, 45)) === 0x1a0
        && ZombieRunTurnRate(runner(ZOMBIE_SPRINTS, 45)) === 0x410);
  {
    // Band 3, a quarter turn off the line to the camera: one frame is one
    // step of the rate, not a fifteenth of the angle.
    const jog = runner(0, 45);
    jog.yaw = 0x4000;
    ZombieStateAttackRun(jog, 1 / 60, new Rng(1));
    const sprint = runner(ZOMBIE_SPRINTS, 45);
    sprint.yaw = 0x4000;
    ZombieStateAttackRun(sprint, 1 / 60, new Rng(1));
    check("...and one frame of the run is one step of it",
          jog.yaw === 0x4000 - 0x1a0 && sprint.yaw === 0x4000 - 0x410,
          `${jog.yaw.toString(16)} ${sprint.yaw.toString(16)}`);
    check("...on the run the spawn record picked",
          jog.motion === 12 && sprint.motion === 13,
          `${jog.motion} ${sprint.motion}`);
  }
  {
    // Dropping out of the queue: state 5, and the wait clip drawn from
    // `g_wait_turn_variant` into bit 21 -- seven of ten set it.
    let set = 0;
    let waits = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const z = runner(0, 45);
      z.rank = 9;
      ZombieStateAttackRun(z, 1 / 60, new Rng(seed));
      if (z.state === ZombieState.WaitTurn) waits += 1;
      if (z.flags2 & ZombieFlag2.WaitTurnVariant) set += 1;
    }
    check("an actor out of the queue goes to WaitTurn", waits === 40,
          `${waits} of 40`);
    check("...with the table's coin in bit 21, and not always the same side",
          set > 0 && set < 40 && g_wait_turn_variant.length === 10,
          `${set} of 40 set it`);
    const z = runner(0, 45);
    z.rank = 9;
    ZombieStateAttackRun(z, 1 / 60, new Rng(3));
    z.flags2 |= ZombieFlag2.WaitTurnVariant;
    ZombieStateWaitTurn(z, new Rng(1));
    check("...and WaitTurn plays the clip the bit picks",
          z.motion === WAIT_ALT
          && ZombieWaitMotion(z, [10, WAIT_ALT, 12, 13, 14]) === WAIT_ALT,
          String(z.motion));
  }
  {
    // A condition-8 walker facing the camera, a free permit, both hands
    // armed. From band 3 it stops and throws; from band 2 the engine never
    // asks, and the port used to.
    // The camera at the origin looking down +z at the walker: block yaw
    // 0x8000, and a walker facing it has yaw 0.
    const near = runner(0, 30, 8);
    G.g_camera_block_yaw_bams = 0x8000;
    near.yaw = 0;
    ZombieStateAttackRun(near, 1 / 60, new Rng(1));
    check("band 2 does not ask to throw, and takes no permit",
          near.state === ZombieState.AttackRun && near.attackPermit === -1,
          `${ZombieState[near.state]} permit ${near.attackPermit}`);
    const far = runner(0, 45, 8);
    G.g_camera_block_yaw_bams = 0x8000;
    far.yaw = 0;
    ZombieStateAttackRun(far, 1 / 60, new Rng(1));
    check("...band 3 does",
          far.state === ZombieState.StandAndThrow && far.attackPermit >= 0,
          `${ZombieState[far.state]} permit ${far.attackPermit}`);
  }
  {
    // A shot is what makes a jogger sprint, and everything that reads the bit
    // follows. `ZombieOnShot` (`FUN_00453EB0`) ORs `0x8000000` into `obj+0x34`
    // at the head of its per-player loop for every shot that finds a bone,
    // alive or dead:
    //
    //   00453ef7  JLE 0x00454035               ; g_shot_bone[p] <= 0: skip
    //   00453f17  OR  ECX, 0x8000000           ; 81c900000008
    //   00453f2a  MOV dword ptr [ESI+0x34], ECX
    //
    // Nothing between the shot and the next frame of the run puts the jogger
    // anywhere else: the spawn record here asked for the jog, and the only
    // input is the hit record `ResolveHit` leaves.
    const shot = runner(0, 45);
    shot.yaw = 0x4000;
    const before = ZombieRunTurnRate(shot);
    shot.pendingHit = { bone: 4, result: HitResultCode.Plain, player: 0 };
    ZombieOnShot(shot);
    ZombieStateAttackRun(shot, 1 / 60, new Rng(1));
    check("a jogger shot and still up runs its next frame on row 3, the sprint",
          before === 0x1a0 && shot.state === ZombieState.AttackRun
          && shot.motion === 13 && !shot.dead,
          `${ZombieState[shot.state]} motion ${shot.motion}`);
    check("...and turns at the sprint's 0x410, not the jog's 0x1A0",
          shot.yaw === 0x4000 - 0x410, shot.yaw.toString(16));

    // `ZombiePushOutOfWorldAndActors` (`FUN_00454900`) moves an actor out of
    // a crowd by a tenth of the penetration, and by 1.8 times that
    // (`0x0055dd48`, `6666e63f`) while `obj+0x34 & 0x18000000` -- tested on
    // the actor itself at `004549b6`, and on the actor that recorded the push
    // at `00454944`. "The crowd push, as the exe runs it" pins both with the
    // bit written by hand; this is the same two with the bit put there by a
    // shot. Neither actor is committed to a strike, so the only bit of the
    // mask either can hold is the one `ZombieOnShot` raised.
    const crowd = (shoot: boolean) => {
      const a = runner(0, 40);
      const b = spawnZombie(0x7b01, 1, "in the way");
      b.visible = true;
      b.hp = b.maxHp = 100;
      for (const z of [a, b]) z.flags2 |= ZombieFlag2.CollideActors;
      b.pos = vec3(2, 0, 40);             // two 3.5 bodies, five deep
      if (shoot) {
        a.pendingHit = { bone: 4, result: HitResultCode.Plain, player: 0 };
        ZombieOnShot(a);
      }
      const mask = (a.flags | b.flags) & 0x18000000;
      PublishCrowd(a, b);
      ZombiePushOutOfWorldAndActors(a);     // a moves, and records b's push
      const self = a.pos.x;                 // from x = 0
      const recorded = b.pushedBy === a.at;
      // An empty list for `b`'s own frame, so what moves it is the push it
      // was handed and nothing it finds itself. `00454935` reads the
      // pusher's flags through the recorded pointer, not the list.
      PublishCrowd();
      const bx = b.pos.x;
      ZombiePushOutOfWorldAndActors(b);
      return { self, pushed: b.pos.x - bx, mask, recorded };
    };
    const calm = crowd(false);
    const hurt = crowd(true);
    check("...with the sprint the only bit of the mask either actor holds",
          calm.mask === 0 && hurt.mask === ZOMBIE_SPRINTS,
          `0x${calm.mask.toString(16)} 0x${hurt.mask.toString(16)}`);
    check("...and it is pushed out of a crowd 1.8x as far (004549b6)",
          calm.self < 0 && Math.abs(hurt.self / calm.self - 1.8) < 1e-6,
          `${hurt.self.toFixed(4)} against ${calm.self.toFixed(4)}`);
    check("...and the actor it pushed is shoved 1.8x as far on that actor's "
          + "own next frame (00454944)",
          calm.recorded && hurt.recorded && calm.pushed > 0
          && Math.abs(hurt.pushed / calm.pushed - 1.8) < 1e-6,
          `${hurt.pushed.toFixed(4)} against ${calm.pushed.toFixed(4)}, `
          + `recorded ${calm.recorded}/${hurt.recorded}`);
  }
}

console.log("\nZombieStateBackOff: which way the retreat turns:");
{
  ResetGameGlobals();
  SetGameTables(CHARS);
  const z = spawnZombie(0x7c00, 1, "retreat");
  z.pos = vec3(0, 0, 10);
  // Where the swing began, further out: the heading from there to the actor
  // is 0x8000. The remembered player point is the eye, so it stays inside
  // the ring and does not leave.
  z.strikeStart = vec3(0, 0, 20);
  z.target = vec3(0, 0, 0);
  z.flags2 |= ZombieFlag2.StrikeAnchor | ZombieFlag2.BackOffTurnFlip;
  z.flags |= ActorFlag.Committed;
  z.state = ZombieState.BackOff;
  z.sub = 0;
  z.yaw = 0x9000;
  ZombieStateBackOff(z, 1 / 60, new Rng(1));
  check("the first frame clears the flip, and the swing's commitment",
        (z.flags2 & ZombieFlag2.BackOffTurnFlip) === 0
        && (z.flags & ActorFlag.Committed) === 0
        && (z.flags & ActorFlag.BackingOff) !== 0);
  check("...and turns at -0x40, away from where the swing began",
        z.yaw === 0x9040, z.yaw.toString(16));
  z.flags2 |= ZombieFlag2.BackOffTurnFlip;
  ZombieStateBackOff(z, 1 / 60, new Rng(1));
  check("with the flip up it turns at +0x40, back toward it",
        z.yaw === 0x9000, z.yaw.toString(16));
  // Standing on the point: `atan2(0, 0)` is 0 and the engine turns off it.
  const on = spawnZombie(0x7c01, 1, "on the point");
  on.pos = vec3(0, 0, 20);
  on.yaw = 0x100;
  TurnActorAwayFromPoint(on, vec3(0, 0, 20), 0x1a0, 1 / 60);
  check("an actor on its own point still turns, to heading 0",
        on.yaw === 0, on.yaw.toString(16));
}

console.log("\nclass 0x31: the stand's aim test, the withdraw's turn, the pounce's roll:");
{
  const TYPE31_ZSKAMERE: CharacterType = {
    ...TYPE31, type: 0x17, name: "zskamere", file: "zskamere.bin",
  };
  const CHARS31_TURN = {
    ...CHARS31,
    types: { "1": TYPE, "22": TYPE31_ZSASS, "23": TYPE31_ZSKAMERE,
             "24": TYPE31_ZSLMAN, "25": TYPE31 },
  } as unknown as CharactersJson;
  const spawn = (type: number, z0: number) => {
    ResetGameGlobals();
    SetGameTables(CHARS31_TURN);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    EnterPlay();
    G.g_camera_yaw_bams = 0;
    const a = ActorSpawn(0x9a00, SpawnClass.Thrower, type, "t", {
      initialState: ThrowerState.StandAndDecide, condition: 0,
    });
    if (a.cls !== SpawnClass.Thrower) throw new Error("not class 0x31");
    a.visible = true;
    a.hp = 100;
    a.pos = vec3(0, 0, z0);
    return a;
  };

  {
    const t = spawn(0x19, 80);
    t.yaw = 0x300;
    // One step of 0x200 from 0x300 leaves it 0x100 off: outside a window of
    // 0xFF, inside one of 0xF0 after a further step of 0x10.
    check("the arrival test turns first, then answers for the new yaw",
          !TurnActorAwayFromPointTestArrival(t, vec3(0, 0, 0), 0x200, 0xff,
                                             1 / 60)
          && t.yaw === 0x100, t.yaw.toString(16));
    check("...and there, inclusive, once it is within the window",
          TurnActorAwayFromPointTestArrival(t, vec3(0, 0, 0), 0x10, 0xf0,
                                            1 / 60) && t.yaw === 0xf0,
          t.yaw.toString(16));
  }
  {
    // Type 0x17 withdraws its own way: thirty units is clear, no clip wait,
    // and it turns out of the swing at -0x100 as it goes.
    const k = spawn(0x17, 40);
    k.state = ThrowerState.Withdraw;
    k.sub = 0;
    ThrowerStateWithdraw(k, 1 / 60, new Rng(1));
    check("zskamere forty units out is already clear, and back at the hub",
          k.state === ThrowerState.StandAndDecide
          && (k.flags & (ActorFlag.BackingOff | ActorFlag.NoHitReaction)) === 0,
          ThrowerState[k.state]);
    const s = spawn(0x19, 40);
    s.state = ThrowerState.Withdraw;
    s.sub = 0;
    ThrowerStateWithdraw(s, 1 / 60, new Rng(1));
    check("...where any other type still has fifty to go",
          s.state === ThrowerState.Withdraw, ThrowerState[s.state]);
    const n = spawn(0x17, 20);
    n.strikeStart = vec3(0, 0, 30);
    n.yaw = 0x9000;
    n.state = ThrowerState.Withdraw;
    n.sub = 0;
    ThrowerStateWithdraw(n, 1 / 60, new Rng(1));
    check("...and inside thirty it turns, the long way, a step of 0x100",
          n.state === ThrowerState.Withdraw && n.yaw === 0x9100
          && (n.flags & ActorFlag.NoHitReaction) !== 0, n.yaw.toString(16));
  }
  {
    // `obj+0x6C = TurnAngleToward(obj+0x6C, 0, 0xCCC)` every frame of the
    // leap. With no arc left it hands to the withdraw on the same frame.
    const p = spawn(0x19, 60);
    p.pounce = { motion: 283, frames: 10 };
    p.state = ThrowerState.DelayedPounce;
    p.sub = 2;
    p.attackPermit = -1;
    p.roll = 0x2000;
    ThrowerStateDelayedPounce(p, 2 / 60, new Rng(1), NULL_HOST);
    check("the pounce levels its roll at 0xCCC a frame",
          p.roll === 0x2000 - 2 * 0xccc, p.roll.toString(16));
  }
}

/**
 * **What the ground does under a class-0x31 actor**, which the port left out:
 * `ThrowerEmitGroundDust` (`FUN_0044D260`), keyed by the code each of its
 * three callers passes -- 0x46 from `ThrowerStateFallAndLand`'s bounce, 0x50
 * from `ActorArcStep`'s landing, 0x5A from every exit of
 * `ThrowerStateStandAndDecide` -- and the bounce's thump beside it. The 0x50
 * arm falls into the 0x5A one, which is `zsass`'s trail. Every assertion that
 * names a sprite, a latch or the thump fails on the old port, which spawned
 * none of them and never set `obj+0x136C` bit 0x4000.
 */
console.log("\nclass 0x31, the ground: the bounce's puff, the landing's column and zsass's trail:");
{
  // `VecAimYAxisZThenX` (`FUN_00401870`): the pair that carries +Y onto the
  // normal as `MatrixRotateZ(rz); MatrixRotateX(rx)`, and not the other order.
  {
    const up = { x: 0, y: 1, z: 0 };
    const out = vec3();
    let worst = 0;
    let other = 0;
    for (const v of [vec3(0.3, 0.9, 0.2), vec3(-0.5, 0.7, 0.4),
                     vec3(0.1, 0.95, -0.3), vec3(0.6, 0.2, -0.7)]) {
      const l = Math.hypot(v.x, v.y, v.z);
      const n = vec3(v.x / l, v.y / l, v.z / l);
      const { rx, rz } = VecAimYAxisZThenX(n.x, n.y, n.z);
      const m = MatIdentity();
      MatrixRotateZ(m, rz);
      MatrixRotateX(m, rx);
      MatrixTransformVector(m, up, out);
      worst = Math.max(worst, Math.hypot(out.x - n.x, out.y - n.y, out.z - n.z));
      const w = MatIdentity();
      MatrixRotateX(w, rx);
      MatrixRotateZ(w, rz);
      MatrixTransformVector(w, up, out);
      other = Math.max(other, Math.hypot(out.x - n.x, out.y - n.y, out.z - n.z));
    }
    check("`VecAimYAxisZThenX` tips +Y onto the vector through Z then X",
          worst < 1e-3 && other > 0.1, `Z;X off by ${worst}, X;Z by ${other}`);
    const flat = VecAimYAxisZThenX(0, 1, 0);
    check("...and a level floor's normal is no tilt at all",
          flat.rx === 0 && flat.rz === 0, JSON.stringify(flat));
  }

  const WALK = 10;
  const WALK_ALT = 12;
  const COMBAT = {
    blood_scale: { "1": 0.75, "2": 0.5, "3": 1.0 },
    impact_sprite: {
      [String(SpriteEffectKind.Dust)]: [0x94, 0xa2, 0.7],
      [String(SpriteEffectKind.DustAlt)]: [0x94, 0xa2, 0.7],
      [String(SpriteEffectKind.Splash)]: [0x1339, 0x1356, 1.0],
    },
    impact_sprite_default: [0x0904, 0x0904, 0.1],
    // `COMMON\BOMB2_16.WAV`: the splash plays its own sound, the dust none.
    ricochet: { [String(SpriteEffectKind.Splash)]: { id: 0x0c16a9, file: "" } },
    impact: [], head_impact: [],
    voice: { hurt: [], kill: [], head: [], attack: [[], []] },
    voice_set_a_types: [1],
  };
  // Set 1 carries the real walk pair's first id and a made-up second one, so
  // that bit 27's choice between them can be seen at all -- the shipped pair
  // is `{10, 10}`.
  const SET1 = { ...CLASS31.sets[0], set: 1,
                 motions: [7, 7, WALK, WALK_ALT, 4, 0x3a4] };
  const TABLES = {
    ...CHARS31,
    combat: COMBAT,
    types: {
      ...(CHARS31 as unknown as { types: Record<string, CharacterType> }).types,
      "22": { ...TYPE31_ZSASS,
              motions: { ...TYPE31_ZSASS.motions,
                         [String(WALK)]: motion(40),
                         [String(WALK_ALT)]: motion(40) } },
    },
    class31: { ...CLASS31, sets: [CLASS31.sets[0], SET1] },
  } as unknown as CharactersJson;
  const WET_FLOOR = coliQuad([0, 1, 0, 0], 1,
                             [-200, 0, 200, 200, 0, 200, 200, 0, -200,
                              -200, 0, -200], 5);
  let nextAt = 0x9400;
  const spawn = (type: number, name: string, condition = 0) => {
    ResetGameGlobals();
    SetGameTables(TABLES);
    // `SetGameTables` puts `T.coli` back, so the floor goes in after it.
    T.coli = { files: ["test"], blobs: { floor: FLOOR_BLOB, wet: WET_FLOOR } };
    G.g_coli_full_set = ["floor"];
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    EnterPlay();
    const a = ActorSpawn(nextAt++, SpawnClass.Thrower, type, name, {
      initialState: ThrowerState.StandAndDecide, condition,
    });
    if (a.cls !== SpawnClass.Thrower) throw new Error("not class 0x31");
    a.visible = true;
    a.hp = 100;
    a.pos = vec3(0, 0, 40);
    a.yaw = 0;
    return a;
  };
  const fresh = (since: number) =>
    G.g_sprite_effects.filter((e) => e.id >= since);
  const sounds = (events: Events) => {
    const ids: number[] = [];
    events.on("sound.play", (e) => ids.push(e.id));
    return ids;
  };

  // -- 0x46, the bounce --------------------------------------------------------
  {
    const z = spawn(0x16, "zsass");
    z.pos = vec3(1, 0, 40);
    z.thr.landSurface = 52;
    G.g_coli_hit_surface = 52;
    const l = Math.hypot(0.3, 0.9, 0.2);
    G.g_coli_hit_normal = [0.3 / l, 0.9 / l, 0.2 / l];
    const want = VecAimYAxisZThenX(0.3 / l, 0.9 / l, 0.2 / l).rx;
    let seq = G.g_sprite_effect_seq;
    // No host: the sprite keeps the pose it was handed rather than being
    // re-aimed at an eye, so the normal's angle is visible.
    ThrowerEmitGroundDust(z, GroundDustCode.Bounce);
    const puff = fresh(seq);
    check("a bounce on dry ground raises one dust sprite at the body",
          puff.length === 1 && puff[0]!.kind === SpriteEffectKind.Dust
          && puff[0]!.pos.x === 1 && puff[0]!.pos.y === 0
          && puff[0]!.pos.z === 40,
          puff.map((s) => `${s.kind}@${JSON.stringify(s.pos)}`).join());
    check("...tilted by the floor's normal through `VecAimYAxisZThenX`, "
          + "the yaw left at 0",
          puff[0]?.pitch === want && want !== 0 && puff[0]?.yaw === 0,
          `pitch ${puff[0]?.pitch} want ${want}`);
    check("...at the kind's own 0.7: `SpawnSpriteEffect` passes no override",
          Math.abs((puff[0]?.scale.x ?? 0) - 0.7) < 1e-6);
    check("...and raises `obj+0x136C` bit 0x4000, which nothing did before",
          (z.flags2 & ThrowerFlag.LandingDustEmitted) !== 0);
    seq = G.g_sprite_effect_seq;
    ThrowerEmitGroundDust(z, GroundDustCode.Bounce);
    check("...so a second bounce of the same landing raises nothing",
          fresh(seq).length === 0);

    z.flags2 &= ~ThrowerFlag.LandingDustEmitted;
    z.thr.landSurface = 0;
    seq = G.g_sprite_effect_seq;
    ThrowerEmitGroundDust(z, GroundDustCode.Bounce);
    check("with no surface latched in `obj+0x1350` the pose is level",
          fresh(seq)[0]?.pitch === 0, `${fresh(seq)[0]?.pitch}`);

    const events = new Events();
    const heard = sounds(events);
    z.flags2 &= ~ThrowerFlag.LandingDustEmitted;
    G.g_coli_hit_surface = 5;
    seq = G.g_sprite_effect_seq;
    ThrowerEmitGroundDust(z, GroundDustCode.Bounce, NULL_HOST, events);
    check("on water (surface 5) it splashes instead, and the splash is heard",
          fresh(seq)[0]?.kind === SpriteEffectKind.Splash
          && heard.includes(0x0c16a9), `${fresh(seq)[0]?.kind} ${heard}`);
    z.flags2 &= ~ThrowerFlag.LandingDustEmitted;
    G.g_coli_hit_surface = 52;
    G.g_rain_enabled = 1;
    seq = G.g_sprite_effect_seq;
    ThrowerEmitGroundDust(z, GroundDustCode.Bounce, NULL_HOST, events);
    check("...and in the rain it splashes on dry ground too",
          fresh(seq)[0]?.kind === SpriteEffectKind.Splash);
    G.g_rain_enabled = 0;
  }

  // -- the bounce as `ThrowerStateFallAndLand` plays it ------------------------
  {
    // `zstin` re-bounces where `zsass` settles on the first contact.
    const t = spawn(0x19, "zstin");
    const events = new Events();
    const heard = sounds(events);
    t.state = ThrowerState.FallAndLand;
    t.sub = 2;
    t.pos = vec3(0, 12, 40);
    t.vel = vec3(0, -1.5, 0);
    t.accY = FALL_GRAVITY;
    t.thr.sinceLanding = 0;
    const seq = G.g_sprite_effect_seq;
    const rng = new Rng(46);
    let frames = 0;
    let latchedOnFirst = false;
    while (t.sub === 2 && frames < 600) {
      const before = heard.length;
      ThrowerStateFallAndLand(t, NULL_HOST, 1 / 60, rng, events);
      if (before === 0 && heard.length) {
        latchedOnFirst = (t.flags2 & ThrowerFlag.LandingDustEmitted) !== 0
          || t.sub !== 2;
      }
      frames++;
    }
    const thumps = heard.filter((id) => id === SND_BOUNCE).length;
    const dust = fresh(seq);
    check("a knocked-down body thumps on every bounce",
          thumps >= 2 && t.sub === 3, `${thumps} thumps, sub ${t.sub}`);
    check("...and raises its puff on the first one only",
          dust.length === 1 && dust[0]!.kind === SpriteEffectKind.Dust
          && latchedOnFirst, `${dust.length} sprites`);
    check("...then drops the latch as it settles, so the next landing puffs",
          (t.flags2 & ThrowerFlag.LandingDustEmitted) === 0);
  }

  // -- 0x50, the arc's landing -------------------------------------------------
  {
    const t = spawn(0x19, "zstin");
    t.flags = (t.flags | ActorFlag.BackingOff) & ~ActorFlag.Committed;
    let seq = G.g_sprite_effect_seq;
    ThrowerEmitGroundDust(t, GroundDustCode.ArcLanding);
    const col = fresh(seq);
    check("a leaping thrower lands in one tall column, kind 0x4B",
          col.length === 1 && col[0]!.kind === SpriteEffectKind.DustAlt,
          col.map((s) => s.kind).join());
    check("...stretched (0.4, 2.0, 0.2) by its own parameter block",
          col[0]?.scale.x === Math.fround(0.4) && col[0]?.scale.y === 2
          && col[0]?.scale.z === Math.fround(0.2),
          JSON.stringify(col[0]?.scale));
    G.g_rain_enabled = 1;
    seq = G.g_sprite_effect_seq;
    ThrowerEmitGroundDust(t, GroundDustCode.ArcLanding);
    check("...a splash in the rain",
          fresh(seq).length === 1
          && fresh(seq)[0]!.kind === SpriteEffectKind.Splash);
    G.g_rain_enabled = 0;
    t.flags |= ActorFlag.Committed;
    seq = G.g_sprite_effect_seq;
    ThrowerEmitGroundDust(t, GroundDustCode.ArcLanding);
    check("...and nothing with `obj+0x34` bit 0x10000000 up",
          fresh(seq).length === 0);
    t.flags &= ~(ActorFlag.Committed | ActorFlag.BackingOff);
    ThrowerEmitGroundDust(t, GroundDustCode.ArcLanding);
    check("...or with bit 0x20000000 down", fresh(seq).length === 0);

    // Through `ActorArcStep`: the frame the arc refuses to move is the one.
    t.flags |= ActorFlag.BackingOff;
    ActorArcBegin(t, vec3(5, 0, 50), 10);
    InstallArcMotionScript(t, ARC(283));
    t.arcPhase = ArcPhase.Landing;
    t.arcFrames = t.arcTotal + 1;
    seq = G.g_sprite_effect_seq;
    ActorArcStep(t, 1, 1 / 60);
    const landed = fresh(seq);
    check("`ActorArcStep` raises the column where the arc comes down",
          landed.length === 1 && landed[0]!.kind === SpriteEffectKind.DustAlt
          && landed[0]!.pos.x === 5 && landed[0]!.pos.z === 50,
          landed.map((s) => `${s.kind}@${JSON.stringify(s.pos)}`).join());
  }

  // -- 0x5A, zsass's trail -----------------------------------------------------
  {
    const z = spawn(0x16, "zsass");
    const walking = (ticks: number) => {
      z.action = null;
      z.motion = WALK;
      z.playTicks = ticks;
      z.state = ThrowerState.StandAndDecide;
      z.flags &= ~0x8000000;
      z.target = vec3(0, 0, 30);
      z.pos = vec3(3, 0, 34);
    };
    walking(0x19);
    let seq = G.g_sprite_effect_seq;
    ThrowerEmitGroundDust(z, GroundDustCode.Trail);
    const two = fresh(seq);
    const yaw = FtolS16(VecToAngles(3, 0, 4).yaw);
    check("on the walk's footfall zsass leaves two scuffs",
          two.length === 2
          && two.every((s) => s.kind === SpriteEffectKind.DustAlt),
          two.map((s) => s.kind).join());
    check("...at the midpoint of the step, on the line walked",
          two.every((s) => s.pos.x === 1.5 && s.pos.y === 0 && s.pos.z === 32),
          JSON.stringify(two[0]?.pos));
    check("...a quarter-turn off it on each side: +0x4000, then +0xC000",
          two[0]?.yaw === yaw + 0x4000 && two[1]?.yaw === yaw + 0xc000
          && two[0]?.pitch === 0,
          `${two[0]?.yaw} ${two[1]?.yaw}, base ${yaw}`);
    check("...as wide as the step is long, times 0.0598",
          two[0]?.scale.x === Math.fround(5 * Math.fround(0.05981133))
          && two[0]?.scale.y === Math.fround(0.8)
          && two[0]?.scale.z === Math.fround(0.2),
          JSON.stringify(two[0]?.scale));
    check("...and the trail point moves up to the actor",
          z.target.x === 3 && z.target.z === 34, JSON.stringify(z.target));

    walking(0x18);
    seq = G.g_sprite_effect_seq;
    ThrowerEmitGroundDust(z, GroundDustCode.Trail);
    check("between footfalls, in the stand, nothing -- and the point stays",
          fresh(seq).length === 0 && z.target.z === 30);
    walking(0x32);
    ThrowerEmitGroundDust(z, GroundDustCode.Trail);
    check("the second footfall, cursor 0x32, scuffs again",
          fresh(seq).length === 2);
    walking(0x18);
    z.state = ThrowerState.WalkDistance;
    seq = G.g_sprite_effect_seq;
    ThrowerEmitGroundDust(z, GroundDustCode.Trail);
    check("out of the stand it scuffs on any frame",
          fresh(seq).length === 2);

    walking(0x19);
    z.motion = CLASS31.sets[0]!.motions[2]!;
    z.condition = 0;
    seq = G.g_sprite_effect_seq;
    ThrowerEmitGroundDust(z, GroundDustCode.Trail);
    check("it is set 1's walk the routine asks for, not the actor's own set's",
          fresh(seq).length === 0);
    walking(0x19);
    z.flags |= 0x8000000;
    ThrowerEmitGroundDust(z, GroundDustCode.Trail);
    check("with `obj+0x34` bit 27 up the first walk no longer counts...",
          fresh(seq).length === 0);
    z.motion = WALK_ALT;
    ThrowerEmitGroundDust(z, GroundDustCode.Trail);
    check("...and the second one does", fresh(seq).length === 2);

    walking(0x19);
    G.g_coli_full_set = ["wet"];
    seq = G.g_sprite_effect_seq;
    ThrowerEmitGroundDust(z, GroundDustCode.Trail);
    check("on water the scuffs are splashes -- the probe is at the midpoint",
          fresh(seq).length === 2
          && fresh(seq).every((s) => s.kind === SpriteEffectKind.Splash));
    G.g_coli_full_set = ["floor"];

    // The fall-through: an arc landing runs the trail after its own column.
    walking(0x18);
    z.state = ThrowerState.Pounce;
    z.flags |= ActorFlag.BackingOff;
    seq = G.g_sprite_effect_seq;
    ThrowerEmitGroundDust(z, GroundDustCode.ArcLanding);
    const all = fresh(seq).map((s) => s.kind);
    check("0x50 falls into the trail: a zsass landing on its walk makes three",
          all.length === 3 && all.every((k) => k === SpriteEffectKind.DustAlt)
          && fresh(seq)[0]!.scale.y === 2, all.join());

    const s = spawn(0x19, "zstin");
    s.motion = WALK;
    s.playTicks = 0x19;
    seq = G.g_sprite_effect_seq;
    ThrowerEmitGroundDust(s, GroundDustCode.Trail);
    check("no other character type leaves a trail", fresh(seq).length === 0);
  }

  // -- the stand lays the trail ------------------------------------------------
  {
    const z = spawn(0x16, "zsass", 1);
    z.sub = 1;
    z.motion = WALK;
    z.playTicks = 0x19;
    z.target = vec3(0, 0, 30);
    z.pos = vec3(3, 0, 34);
    const seq = G.g_sprite_effect_seq;
    ThrowerStateStandAndDecide(z, 1 / 60, new Rng(7), NULL_HOST);
    check("`ThrowerStateStandAndDecide` ends by laying the trail",
          fresh(seq).length === 2 && z.target.z === 34,
          `${fresh(seq).length} sprites, state ${ThrowerState[z.state]}`);
  }
}

console.log("\nthe head aim (0x00453BE0): bone 2 follows the camera");
{
  // A camera at `eye` whose view is a translation of the world, so a record
  // taken in view space reads back as the world point it was taken from and
  // the view-space origin -- the allocation's zero record -- is the eye.
  const eye = vec3(0, 10, 0);
  const head = vec3(0, 12, 50);
  const camera = (w2v: number[], v2w: number[]): boolean => {
    for (let i = 0; i < 16; i++) w2v[i] = v2w[i] = i % 5 === 0 ? 1 : 0;
    w2v[12] = -eye.x; w2v[13] = -eye.y; w2v[14] = -eye.z;
    v2w[12] = eye.x; v2w[13] = eye.y; v2w[14] = eye.z;
    return true;
  };
  const host: GameHost = {
    ...NULL_HOST,
    cameraMatrices: camera,
    // Bone 2's hit-sphere centre, as the renderer's last pose left it.
    boneSphere: (_at, bone, out) => {
      if (bone !== 2) return null;
      out.x = head.x; out.y = head.y; out.z = head.z;
      return 1;
    },
  };
  const fr: ClassFrame = { dt: 1 / 60, rng: new Rng(1), host };
  const zombie = (flags = 0): ZombieActor => {
    ResetGameGlobals();
    SetGameTables(CHARS);
    EnterPlay();
    // A gameplay eye **at** the lens, which only a fixed eye height set to
    // the lens's own would give: it keeps the arithmetic below readable. On a
    // path the two are fifteen apart, and that case -- the page's -- is
    // driven through the hook that writes it, further down.
    G.g_camera_eye.x = eye.x; G.g_camera_eye.y = eye.y; G.g_camera_eye.z = eye.z;
    head.x = 0; head.y = 12; head.z = 50;
    const z = spawnZombie(0x9400, 1, "aim", { pos: vec3(0, 0, 50), flags });
    z.visible = true;
    return z;
  };
  // One drawn frame, in the order `EnemyZombieUpdate`'s draw runs it: what
  // the last draw left in the record, the node walk, this draw's write.
  const draw = (z: ZombieActor): void => {
    HeadAimBeginDraw(z, z.zom, host);
    ActorRunNodeDrawHooks(z, ZombieDrawBonePart, fr);
    HeadAimEndDraw(z, z.zom, host);
  };
  const s16 = (v: number): number => (Math.trunc(v) << 16) >> 16;

  // `EnemyZombieInit`: `VecToAngles(eye - pos + (0, 15, 0))`, masked. The
  // actor stands at +z of the eye, so the yaw is half a turn.
  const z = zombie();
  const seed = VecToAngles(0, 25, -50);
  check("EnemyZombieInit seeds the head toward the eye raised 15",
        z.zom.headYaw === 0x8000
        && z.zom.headPitch === (s16(seed.pitch) & 0xffff),
        `${z.zom.headYaw.toString(16)} ${z.zom.headPitch.toString(16)}`);

  // The first draw reads the record the allocation cleared: the view-space
  // origin, which is the eye. So the head's first step is toward straight up,
  // one 0xC0 of it, and only then does the pose's own point arrive.
  draw(z);
  check("the first draw aims from the zeroed record -- the eye -- by one step",
        z.zom.headAimed
        && z.zom.headPitch === (s16(seed.pitch) & 0xffff) - HEAD_AIM_RATE
        && z.zom.headYaw === 0x8000 - HEAD_AIM_RATE
        && z.zom.headRecordDue,
        `${z.zom.headPitch.toString(16)} ${z.zom.headYaw.toString(16)}`);
  draw(z);
  check("...and the next takes bone 2's centre into view space from the pose",
        z.zom.headRecord.x === 0 && z.zom.headRecord.y === 2
        && z.zom.headRecord.z === 50, JSON.stringify(z.zom.headRecord));
  let biggest = 0;
  for (let i = 0; i < 60; i++) {
    const p = z.zom.headPitch, y = z.zom.headYaw;
    draw(z);
    biggest = Math.max(biggest, Math.abs(z.zom.headPitch - p),
                       Math.abs(z.zom.headYaw - y));
  }
  const settled = VecToAngles(0, 13, -50);
  check("the head settles on the eye raised 15, from its own centre",
        (z.zom.headYaw & 0xffff) === 0x8000
        && (z.zom.headPitch & 0xffff) === (s16(settled.pitch) & 0xffff),
        `${z.zom.headYaw.toString(16)} ${z.zom.headPitch.toString(16)}`);
  check("...never faster than 0xC0 a drawn frame", biggest === HEAD_AIM_RATE,
        biggest.toString(16));

  // Out of reach: facing away, so straight ahead is yaw 0 and the camera is
  // half a turn from it. The step out past 0x4000 is refused and the head
  // steps back; the step after is inside and is taken. It alternates.
  z.yaw = 0x8000;
  z.zom.headYaw = 0x3f80;
  draw(z);
  const back = z.zom.headYaw;
  draw(z);
  const out = z.zom.headYaw;
  draw(z);
  check("a head whose camera is behind it alternates across the quarter turn",
        back === 0x3ec0 && out === 0x3f80 && z.zom.headYaw === 0x3ec0,
        `${back.toString(16)} ${out.toString(16)} ${z.zom.headYaw.toString(16)}`);

  // A quarter turn (L48): the actor at +x of the eye, facing it. Straight
  // ahead is then 0xC000, which is exactly where the camera is.
  const q = zombie();
  q.pos = vec3(50, 0, 0);
  q.yaw = 0x4000;
  q.zom.headYaw = 0xc000;
  q.zom.headPitch = 0;
  head.x = 50; head.y = 10; head.z = 0;
  draw(q);
  draw(q);
  draw(q);
  check("a quarter-turned actor facing the camera keeps its head straight",
        (q.zom.headYaw & 0xffff) === 0xc000, q.zom.headYaw.toString(16));

  // The record is not written while `obj+0x34` has 0x8000: a corpse's head
  // goes on aiming from where it was when it died.
  const c = zombie();
  draw(c);
  draw(c);
  c.flags |= ActorFlag.NoShotTest;
  draw(c);
  head.z = 80;
  draw(c);
  draw(c);
  const stale = c.zom.headRecord.z;
  c.flags &= ~ActorFlag.NoShotTest;
  draw(c);
  draw(c);
  check("the record holds while 0x8000 is up, and is taken again after",
        stale === 50 && c.zom.headRecord.z === 80,
        `${stale} then ${c.zom.headRecord.z}`);

  // `ActorFlag.NoHeadAim`, from the spawn record: no seed and no aim.
  const n = zombie(ActorFlag.NoHeadAim);
  n.zom.scriptMotion = 0x1a4;
  for (let i = 0; i < 5; i++) draw(n);
  check("a spawn with 0x40000 is never seeded and never aimed",
        n.zom.headPitch === 0 && n.zom.headYaw === 0 && !n.zom.headAimed
        && n.zom.scriptMotion === 0x1a4,
        `${n.zom.headPitch} ${n.zom.headYaw} ${n.zom.headAimed}`);

  // No camera, no aim: a headless host cannot say where the head is.
  const h = zombie();
  const before = h.zom.headYaw;
  ActorAimHeadAtCamera(h, h.zom, { ...fr, host: NULL_HOST });
  check("...and with no camera the head holds",
        h.zom.headYaw === before && !h.zom.headAimed);

  // `ActorHeadAimAngles`, with two attackers: 1.5 in front of the camera, 15
  // up, and 1.2 to the side of the player whose permit the actor holds. This
  // file's camera looks down +z, which is a block yaw of half a turn (the
  // view looks down its own -z), so "in front" is +z.
  const t = zombie();
  G.g_camera_block_yaw_bams = 0x8000;
  const far = vec3(0, 10, 101.5);
  const one = ActorHeadAimAngles(t, far).yaw;
  G.g_max_attackers = 2;
  t.attackPermit = 0;
  const p0 = ActorHeadAimAngles(t, far).yaw;
  t.attackPermit = 1;
  const p1 = ActorHeadAimAngles(t, far).yaw;
  const off = Math.trunc(Math.atan2(1.2, 100) * 65536 / (Math.PI * 2));
  check("two attackers aim 1.5 ahead and 1.2 aside, one side per permit",
        one === -0x8000 && Math.abs(p0 - (0x8000 - off)) <= 1
        && Math.abs(p1 - (-0x8000 + off)) <= 1,
        `${one} ${p0} ${p1} (off ${off})`);

  // The page's case. On a path the gameplay eye is fifteen **below** the
  // lens -- `CameraHoldEyeTick` writes `g_camera_eye.y = pose.y - 15.0`
  // (`0x004C4398`) -- while the view, which the `ClassFrame` used to carry as
  // its eye, is the pose's own. `ActorHeadAimAngles` reads `g_camera_eye` in both branches
  // (`0x00453DA3`, `0x00453E66..0x00453E8E`) and adds the fifteen back, so a
  // head level with the lens looks level into it. Reading the frame's eye --
  // the lens -- put the target fifteen above the camera, and every head in
  // the game looked up.
  {
    const lens = vec3(0, 25, 0);
    const cam = vec3(lens.x, lens.y, lens.z);
    const lensHost: GameHost = {
      ...host,
      cameraMatrices: (w2v, v2w) => {
        for (let i = 0; i < 16; i++) w2v[i] = v2w[i] = i % 5 === 0 ? 1 : 0;
        w2v[12] = -cam.x; w2v[13] = -cam.y; w2v[14] = -cam.z;
        v2w[12] = cam.x; v2w[13] = cam.y; v2w[14] = cam.z;
        return true;
      },
    };
    const lensFrame: ClassFrame = { dt: 1 / 60, rng: new Rng(1),
                                    host: lensHost };
    const drawAt = (z: ZombieActor): void => {
      HeadAimBeginDraw(z, z.zom, lensHost);
      ActorRunNodeDrawHooks(z, ZombieDrawBonePart, lensFrame);
      HeadAimEndDraw(z, z.zom, lensHost);
    };
    const z = zombie();
    G.g_cam_path_eye.x = lens.x; G.g_cam_path_eye.y = lens.y;
    G.g_cam_path_eye.z = lens.z;
    CameraHoldEyeTick();
    check("the path hook puts the gameplay eye fifteen below the lens",
          G.g_camera_eye.y === lens.y - 15, `${G.g_camera_eye.y}`);
    head.x = 0; head.y = lens.y; head.z = 50;
    for (let i = 0; i < 80; i++) drawAt(z);
    check("a head level with the lens settles level: it looks into the "
          + "camera, not fifteen above it",
          (z.zom.headPitch & 0xffff) === 0 && (z.zom.headYaw & 0xffff) === 0x8000,
          `pitch ${s16(z.zom.headPitch)} yaw ${z.zom.headYaw.toString(16)}`);

    // The record is in the view of the frame that drew it. Between two
    // frames the camera backs off ten: the engine's record, taken in the old
    // view and read back through the new, is the head moved ten with it.
    drawAt(z);
    cam.z = lens.z - 10;
    drawAt(z);
    check("the record is taken in the view its draw used, not the next "
          + "frame's",
          z.zom.headRecord.x === 0 && z.zom.headRecord.y === 0
          && z.zom.headRecord.z === 50, JSON.stringify(z.zom.headRecord));
  }

  // Class 0x31: the same routine, behind the hook's own surface test. A
  // thrower on a wall does not look at you; on the ceiling it does.
  const th = thrower(ThrowerState.StandAndDecide);
  const wall = ThrowerFlag.OffGround | ThrowerFlag.WallA;
  const ceiling = ThrowerFlag.OffGround | ThrowerFlag.Ceiling;
  const aims = (bits: number): boolean => {
    th.flags2 = (th.flags2 & ~(ThrowerFlag.Surface | ThrowerFlag.OffGround))
      | bits;
    HeadAimBeginDraw(th, th.thr, host);
    ActorRunNodeDrawHooks(th, ThrowerDrawBonePart, fr);
    HeadAimEndDraw(th, th.thr, host);
    return th.thr.headAimed;
  };
  const ground = aims(0), onWall = aims(wall), onCeiling = aims(ceiling);
  check("a thrower aims on the ground and the ceiling, not on a wall",
        ground && !onWall && onCeiling, `${ground} ${onWall} ${onCeiling}`);
  th.flags2 = (th.flags2 & ~ThrowerFlag.Surface) | ThrowerFlag.OffGround
    | ThrowerFlag.WallB;
  check("...which is `ThrowerHeadAims`: on either wall it does not",
        !ThrowerHeadAims(th));

  // And through the page's own path: `GameUpdate` runs `EnemyZombieUpdate`,
  // whose draw is where the head is stepped.
  const rng = new Rng(3);
  const events = scene(1, rng);
  G.g_camera_eye.x = eye.x; G.g_camera_eye.y = eye.y; G.g_camera_eye.z = eye.z;
  const live = G.g_object_list[0];
  if (live.cls !== SpawnClass.Zombie) throw new Error("not class 0x30");
  const start = live.zom.headYaw;
  for (let i = 0; i < 3; i++) GameUpdate(1 / 60, host, rng, events);
  check("GameUpdate steps a live zombie's head in its own draw",
        live.zom.headAimed && live.zom.headYaw !== start,
        `${live.zom.headAimed} ${start.toString(16)} -> ${live.zom.headYaw.toString(16)}`);
}
