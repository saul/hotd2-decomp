import type { CharactersJson, CharacterType } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { authoredFrameHeld, authoredFrameOfTicks,
         ticksOfAuthoredFrame } from "../../src/core/play_cursor";
import { ActorSpawn, GameUpdate } from "../../src/game/director";
import { ActorAdvanceMotion } from "../../src/game/motion";
import { MotionFlag } from "../../src/game/actor";
import { G, HIT_SLOT_NONE, ResetGameGlobals } from "../../src/game/globals";
import { NULL_HOST, type GameHost } from "../../src/game/host";
import { SpriteEffectKind } from "../../src/game/effects/sprite";
import { MotionPlayFrame, SetGameTables } from "../../src/game/tables";
import {
  type Actor, type HumanoidActor, type ThrowerActor, type ZombieActor,
} from "../../src/game/actor";
import { g_class_handlers } from "../../src/game/registry";
import { SpawnClass } from "../../src/game/spawn_class";
import { GameMode } from "../../src/game/game_mode";
import { vec3 } from "../../src/game/vec";
import {
  HumanoidCond, HumanoidOp, HumanoidTurn, ScriptedHumanoidRun,
  ScriptedHumanoidUpdate, g_class25_path_offsets,
  type HumanoidProgram,
} from "../../src/game/class25";
import { HumanoidRoutine } from "../../src/game/class25/state";
import {
  check, CHARS, slotsShown, EnterPlay, JETTY_CHARS, jettyScene,
} from "./harness";

// -- 9. class 0x25, the scripted humanoid VM -------------------------------

function humanoidScene(cmds: HumanoidProgram["cmds"],
                       over: Partial<HumanoidProgram> = {}):
    { a: HumanoidActor; events: Events } {
  ResetGameGlobals();
  EnterPlay();
  const prog: HumanoidProgram = {
    charType: 1, removePath: 90, removeFrame: 900, flags2: 0,
    motion: 10, phase: 0, cmds, ...over,
  };
  SetGameTables(CHARS, undefined, undefined, { "12288": prog });
  G.g_active_cam_path = -1;
  G.g_cam_path_frame = 0;
  const a = ActorSpawn(0x3000, SpawnClass.ScriptedHumanoid, 1, "humanoid");
  // Narrowing, not a cast. `ActorSpawn` returns the union, and class 0x25's
  // routines take the arm -- so the test has to prove the actor is a humanoid
  // the same way the director does. Before the union this fixture handed an
  // un-narrowed actor straight into `ScriptedHumanoidUpdate`.
  if (a.cls !== SpawnClass.ScriptedHumanoid) throw new Error("not class 0x25");
  a.visible = true;
  a.pos = vec3(0, 0, 0);
  return { a, events: new Events() };
}

// Through the routine the object has installed, as the director calls it:
// once a program has ended the VM is no longer what runs.
const hFrame = (a: HumanoidActor, events: Events, rng: Rng) =>
  ScriptedHumanoidRun(a, { dt: 1 / 60, rng, host: NULL_HOST, events });

/**
 * **The union's whole point, checked by the compiler.**
 *
 * These do not run. `@ts-expect-error` fails `tsc` if the line it guards
 * *compiles*, so each one asserts that a misread is rejected — which is the
 * only way to test a type. Before the class-0x25 and class-0x30 arms existed,
 * every line below compiled happily and read a word belonging to another
 * class.
 *
 * This is the honest version of what the review predicted. It expected F6 —
 * `RankEnemiesByDistance` writing zombie fields onto every class — to become a
 * type error here. It cannot: `FUN_004090B0` writes `obj+0x131D`/`+0x131E`
 * unconditionally on every ranked entry, with the `charType == 0xB` test
 * gating only the reads that follow, so those two bytes are genuinely
 * class-agnostic and belong in the head. What the union does catch is the
 * cross-class *tail* read, and that is what these pin.
 */
function unionRejectsCrossClassReads(a: Actor, h: HumanoidActor,
                                     t: ThrowerActor,
                                     z: ZombieActor): void {
  // @ts-expect-error a bare `Actor` has no arm until `cls` is narrowed
  void a.hum;
  // @ts-expect-error and it has no class-0x30 arm either
  void a.zom;
  // @ts-expect-error class 0x25's hand-prop selector is not on the head
  void a.bonePropMode;
  // @ts-expect-error nor is its command cursor
  void a.pc;
  // @ts-expect-error class 0x24's state selector is not on the head either
  void a.selector;
  // @ts-expect-error ...and a humanoid cannot read it: `obj+0x130C` is three
  // fields at one address — this arm, `condition`, and class 0x10's tail
  // pointer — and now two of the three are separated.
  void h.selector;
  // @ts-expect-error ...and neither is class 0x31's arm
  void a.thr;
  // @ts-expect-error `obj+0x1350` as the surface under a thrower's landing
  void a.landSurface;
  // @ts-expect-error `obj+0x1354` as the axis its knockback arc falls along
  void a.arcKind;
  // The two words 0x25 and 0x31 share are the ones worth pinning both ways:
  // `obj+0x1394` is a command cursor to one class and a waypoint cursor to the
  // other, and `obj+0x1330` a hand-prop selector against a path delay.
  // @ts-expect-error a humanoid has no waypoint cursor
  void h.pathLeg;
  // @ts-expect-error and a thrower has no command cursor
  void t.pc;
  // @ts-expect-error nor the hand-prop selector that shares its path delay
  void t.bonePropMode;
  // The class-0x30 tail, one address at a time. Each of these was a field on
  // `ActorBase` before this change, readable off a civilian or a set-piece.
  // (`a.holdFrames` still compiles: that name is class 0x24's `obj+0x1320`
  //  and stays in the head. Class 0x30's hold, `obj+0x1330`, is on the arm.)
  // @ts-expect-error `obj+0x1330` — the stand-and-throw idle countdown
  void a.throwDelay;
  // @ts-expect-error `obj+0x1330` — the corpse countdown
  void a.corpseTimer;
  // @ts-expect-error `obj+0x1334` — the back-off counter
  void a.backoffFrames;
  // @ts-expect-error `obj+0x1338` — frames since the last shove
  void a.shoveTimer;
  // @ts-expect-error `obj+0x1368` bit 0, which class 0x31 reads as `reactBone`
  void a.hasCooldown;
  // @ts-expect-error `obj+0x1398` — the captor script cursor
  void a.scriptPc;
  // @ts-expect-error ...and which of the two blobs it is walking
  void a.scriptBlob;
  // @ts-expect-error `obj+0x1320` — the clip the captor script wants
  void a.scriptMotion;
  // @ts-expect-error `obj+0x1350`, which class 0x31 reads as `landSurface`
  void a.targetLoops;
  // @ts-expect-error `obj+0x1354`, which class 0x31 reads as `arcKind`
  void a.targetCue;
  // @ts-expect-error `obj+0x1358`, which this class also reads as `allowance`
  void a.resumeSub;
  // @ts-expect-error `obj+0x132C`, which class 0x25 reads as `hum.turnMode`
  void a.delegate;
  // @ts-expect-error `obj+0x1370` — how close the walk has to get
  void a.targetArrive;
  // @ts-expect-error `obj+0x1374` — how far it has come
  void a.walkTravelled;
  // @ts-expect-error `obj+0x135C`, which class 0x25 reads as `hum.pathSlot`
  void a.throwHand;
  // ...and the other way round: the zombie arm does not carry class 0x25's.
  // @ts-expect-error class 0x25's command cursor is not on a zombie
  void z.hum;
  // @ts-expect-error nor is its hand-prop cel index, `obj+0x1334`
  void z.bonePropFrame;
  // `obj+0x1334` as class 0x30's back-off counter is now behind its own arm,
  // so a humanoid can no longer be asked for it. This line used to be a plain
  // `void h.backoffFrames` with a comment saying why it could not be a
  // directive: class 0x30 had no arm, the field was on the head, and every
  // class could see it. Class 0x30's arm is what made it one.
  // @ts-expect-error class 0x30's back-off counter is not on the head either
  void h.backoffFrames;
  // **And here is what four arms still do not protect.**
  //
  // `void h.slideTimer` below still compiles, and class 0x24 and class 0x30
  // *both* growing an arm did not fix it — which is the point. `obj+0x1330` is
  // class 0x24's slide countdown, class 0x31's pin/entrance countdown, class
  // 0x30's hold, and the shared arc record's elapsed-frame word, all at one
  // address. Class 0x30's three readings moved onto `zom` (`holdFrames`,
  // `throwDelay`, `corpseTimer` — three names on that one word, **on one
  // arm**, which the union does not separate and does not pretend to).
  // `slideTimer` stayed on the head because class 0x31 still reads it there:
  // 22 sites in `class31/` against class 0x24's 5.
  //
  // And the head aliases *itself* at that address — `slideTimer` and
  // `arcFrames` are both `obj+0x1330` — because `arcFrames`/`arcTotal` belong
  // to **no** class: `class30/entrance.ts` and `class30/knockback.ts` drive
  // them through `class31/arc.ts`, which is why that module still takes a bare
  // `Actor`. No `cls` discriminant can separate a word from itself.
  //
  // So the honest rule, with every arm in: a word separates when every class
  // sharing it has an arm **and** no class-agnostic routine drives it — and
  // intra-class aliasing, and intra-*head* aliasing, are untouched by any of
  // this. A `@ts-expect-error` on the line below is an unused directive today
  // and fails the build, which is why it is not written as one.
  void h.slideTimer;
  // The arm is reachable once, and only once, `cls` has been tested.
  if (a.cls === SpawnClass.ScriptedHumanoid) void a.hum.bonePropMode;
  if (a.cls === SpawnClass.Thrower) void a.thr.landSurface;
  if (a.cls === SpawnClass.Zombie) void a.zom.backoffFrames;
  // And an already-narrowed arm needs no test at all.
  void z.zom.corpseTimer;
  void t.thr.landSurface;
}
void unionRejectsCrossClassReads;

console.log("\na one-shot clip holds its last frame; a loop wraps:");

{
  // The death clip is the one with no terminator: it is meant to hold until
  // `FUN_00456740` takes the body, which is unread. So if the conversion
  // wraps, a killed zombie plays its death animation and then plays it again,
  // for ever -- which is exactly what it did. `Math.min(frames - 1, ...)`
  // around `authoredFrameOfTicks` cannot fix that, because the modulo is
  // *inside* and hands the clamp a small number every lap.
  const fps = 30, frames = 20;
  const lastTick = ticksOfAuthoredFrame(frames - 1, fps);   // 38 at 30 Hz
  check("both agree while the clip is still running",
        authoredFrameHeld(lastTick, fps, frames)
        === authoredFrameOfTicks(lastTick, fps, frames),
        `${authoredFrameHeld(lastTick, fps, frames)}`);
  check("the held clip stops on its last frame",
        authoredFrameHeld(lastTick + 2, fps, frames) === frames - 1
        && authoredFrameHeld(lastTick + 200, fps, frames) === frames - 1,
        `${authoredFrameHeld(lastTick + 200, fps, frames)}`);
  check("...where the wrapping one has gone back to the start",
        authoredFrameOfTicks(lastTick + 2, fps, frames) === 0,
        `${authoredFrameOfTicks(lastTick + 2, fps, frames)}`);
  check("and a looping clip still wraps, which is what it is for",
        authoredFrameOfTicks(lastTick + 4, fps, frames) === 1,
        `${authoredFrameOfTicks(lastTick + 4, fps, frames)}`);
  check("a zero-length clip is frame 0 either way",
        authoredFrameHeld(99, fps, 0) === 0
        && authoredFrameOfTicks(99, fps, 0) === 0);
}

console.log("\nclass 0x25, the VM runs until a command blocks:");
{
  const rng = new Rng(4);
  // Three setup commands and then a wait: all three should take effect on the
  // first frame, because only a wait costs one.
  const { a, events } = humanoidScene([
    { op: HumanoidOp.SetPos, mode: 0, a: 0, b: 0, f0: 5, f1: 7 },
    { op: HumanoidOp.SetBonePropMode, mode: 2, a: 0, b: 0 },
    { op: HumanoidOp.TurnMode, mode: 1, a: 0, b: 0 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 30, b: 0 },
    { op: HumanoidOp.Kill, mode: 0, a: 0, b: 0 },
  ]);
  hFrame(a, events, rng);
  check("a run of setup commands all take effect in one frame",
        a.pos.x === 5 && a.pos.z === 7 && a.hum.bonePropMode === 2
        && a.hum.turnMode === HumanoidTurn.FaceCamera && a.hum.pc === 3,
        `pc ${a.hum.pc}`);

  // The wait costs frames, and exactly the number it asks for.
  for (let i = 0; i < 29; i++) hFrame(a, events, rng);
  check("the wait holds the cursor while it counts", a.hum.pc === 3 && !a.dead,
        `pc ${a.hum.pc} hold ${a.hum.stallFrames}`);
  hFrame(a, events, rng);
  check("and releases on the frame it names, running on to the kill",
        a.dead, `pc ${a.hum.pc} hold ${a.hum.stallFrames}`);
}

console.log("\nclass 0x25, the camera conditions:");
{
  const rng = new Rng(4);
  const { a, events } = humanoidScene([
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.CameraAt, a: 57, b: 40 },
    { op: HumanoidOp.SetPos, mode: 1, a: 0, b: 0, f0: 12, f1: 0 },
    { op: HumanoidOp.End, mode: 0, a: 0, b: 0 },
  ]);
  hFrame(a, events, rng);
  check("it waits while the camera is elsewhere", a.hum.pc === 0);
  G.g_active_cam_path = 57;
  G.g_cam_path_frame = 39;
  hFrame(a, events, rng);
  check("and while the path matches but the frame has not come", a.hum.pc === 0);
  G.g_cam_path_frame = 40;
  hFrame(a, events, rng);
  check("then runs on when the camera arrives",
        a.pos.y === 12 && a.hum.routine === HumanoidRoutine.Idle,
        `pc ${a.hum.pc} y ${a.pos.y}`);
}

console.log("\nclass 0x25, jumps and the stall guard:");
{
  const rng = new Rng(4);
  // A jump backwards over a wait: the classic idle loop, and the shape that
  // would hang the frame if the VM did not stop at a blocked command.
  const { a, events } = humanoidScene([
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 5, b: 0 },
    { op: HumanoidOp.Jump, mode: 0, a: 0, b: 0, next: 0 },
  ]);
  for (let i = 0; i < 200; i++) hFrame(a, events, rng);
  check("a loop of wait-and-jump runs for ever without hanging a frame",
        !a.dead && a.hum.pc === 0, `pc ${a.hum.pc}`);
}

console.log("\nclass 0x25, op 10 picks an arm by g_active_player:");
{
  const rng = new Rng(4);
  // Stage 3's block 2, spawn 0x3378 -- character type 0x39, `gameover_player`
  // -- transcribed from `st3evtbl.bin` at 0x33B4 with the indices the exporter
  // resolves. Two arms and a marker between them: kill me if the active player
  // is 1, otherwise stand and play.
  const player = (): Parameters<typeof humanoidScene>[0] => [
    { op: HumanoidOp.WaitThenPlay, mode: -1, a: 0, b: 0 },
    { op: HumanoidOp.IfActivePlayer, mode: 1, a: 0, b: 0, skip: 3 },
    { op: HumanoidOp.Kill, mode: 0, a: 0, b: 0 },
    { op: HumanoidOp.IfActivePlayer, mode: 0, a: 0, b: 0, skip: 6 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 9999, b: 0 },
    { op: HumanoidOp.End, mode: 0, a: 0, b: 0 },
    { op: HumanoidOp.SetPos, mode: 1, a: 0, b: 0, f0: 99, f1: 0 },
    { op: HumanoidOp.End, mode: 0, a: 0, b: 0 },
  ];

  {
    // One player on slot 0 — `SelectAttackablePlayer` (`FUN_00414F40`) writes
    // 0 — is the port's configuration, and it is the one the player character
    // has to survive.
    const { a, events } = humanoidScene(player());
    G.g_active_player = 0;
    hFrame(a, events, rng);
    check("a mismatched op 10 skips its arm instead of running it",
          !a.dead && a.visible, `dead ${a.dead} visible ${a.visible}`);
    check("...and lands on the command after the -2 marker, not on the marker",
          a.hum.pc === 4, `pc ${a.hum.pc}`);
    for (let i = 0; i < 60; i++) hFrame(a, events, rng);
    check("...so the arm the active player names is the one that runs",
          a.hum.pc === 4 && a.pos.y !== 99, `pc ${a.hum.pc} y ${a.pos.y}`);
  }
  {
    // The same program with the other player active: now the kill is the arm
    // that matches, and the actor goes. Both halves matter — an op 10 that
    // always skipped would leave two player characters standing in the shot.
    const { a, events } = humanoidScene(player());
    G.g_active_player = 1;
    hFrame(a, events, rng);
    check("a matching op 10 falls into its arm", a.dead && !a.visible,
          `dead ${a.dead} pc ${a.hum.pc}`);
  }
  {
    // Mode -2 is the marker, not a fourth comparison: `0x0048478C` tests 0, 1
    // and 2 and steps the cursor for anything else.
    const { a, events } = humanoidScene([
      { op: HumanoidOp.IfActivePlayer, mode: -2, a: 0, b: 0 },
      { op: HumanoidOp.SetPos, mode: 1, a: 0, b: 0, f0: 3, f1: 0 },
      { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 9999, b: 0 },
    ]);
    G.g_active_player = 0;
    hFrame(a, events, rng);
    check("an op 10 in a mode it does not test steps over and does not skip",
          a.pos.y === 3 && a.hum.pc === 2, `pc ${a.hum.pc} y ${a.pos.y}`);
  }
  {
    // A bundle written before `skip` was carried. Leaving the VM keeps the
    // actor on screen; running the arm regardless is what deleted it.
    const { a, events } = humanoidScene([
      { op: HumanoidOp.IfActivePlayer, mode: 1, a: 0, b: 0 },
      { op: HumanoidOp.Kill, mode: 0, a: 0, b: 0 },
    ]);
    G.g_active_player = 0;
    hFrame(a, events, rng);
    check("a mismatched op 10 with no skip leaves the VM rather than killing",
          !a.dead && a.visible && a.hum.routine === HumanoidRoutine.Idle,
          `dead ${a.dead} pc ${a.hum.pc}`);
  }
  G.g_active_player = 0;
}

console.log("\nclass 0x25, the removal trigger:");
{
  const rng = new Rng(4);
  const { a, events } = humanoidScene([
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 9999, b: 0 },
  ]);
  G.g_active_cam_path = 90;
  G.g_cam_path_frame = 899;
  hFrame(a, events, rng);
  check("it stays until the camera reaches the removal frame", !a.dead);
  G.g_cam_path_frame = 900;
  hFrame(a, events, rng);
  check("and leaves when it does", a.dead);
}

console.log("\nclass 0x25, the two draw fields the VM writes:");
{
  const rng = new Rng(4);
  // `op 14` picks the hand prop and mode 2 restarts the cel counter; `op 12`
  // is a persistent bone toggle, not the one-shot effect it was read as.
  const { a, events } = humanoidScene([
    { op: HumanoidOp.SetHeadAim, mode: 1, a: 0, b: 0 },
    { op: HumanoidOp.SetBonePropMode, mode: 2, a: 0, b: 0 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 4, b: 0 },
    { op: HumanoidOp.SetHeadAim, mode: 0, a: 0, b: 0 },
    { op: HumanoidOp.SetBonePropMode, mode: 7, a: 0, b: 0 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 9999, b: 0 },
  ]);
  a.hum.bonePropFrame = 9;
  hFrame(a, events, rng);
  check("op 12 mode 1 sets the head-aim toggle and it stays set",
        a.hum.aimsHead === 1);
  check("op 14 mode 2 picks hand prop 2 and restarts the cel counter",
        a.hum.bonePropMode === 2 && a.hum.bonePropFrame === 0);

  for (let i = 0; i < 4; i++) hFrame(a, events, rng);
  check("op 12 mode 0 clears it again", a.hum.aimsHead === 0);
  check("and a mode op 14 does not know leaves the prop alone",
        a.hum.bonePropMode === 2, `mode ${a.hum.bonePropMode}`);
}

console.log("\nclass 0x25, the program ends into ScriptedHumanoidIdle:");
{
  const rng = new Rng(4);
  // Face the camera, then end. `op -1` installs `ScriptedHumanoidIdle`
  // (`FUN_00484D40`), which runs the removal test and the draw and nothing
  // else -- no stall counter, no turn, no path follow, no `prevPos` capture.
  const { a, events } = humanoidScene([
    { op: HumanoidOp.TurnMode, mode: 1, a: 0, b: 0 },
    { op: HumanoidOp.End, mode: 0, a: 0, b: 0 },
  ]);
  hFrame(a, events, rng);
  // The cursor stays on the `op -1` it ran: the tail stores it as it stopped.
  check("the frame that runs op -1 still falls through the normal tail",
        a.hum.routine === HumanoidRoutine.Idle && a.hum.pc === 1
        && a.hum.stallFrames === 1 && a.hum.turnMode === HumanoidTurn.FaceCamera,
        `pc ${a.hum.pc} hold ${a.hum.stallFrames}`);

  const yaw = a.yaw;
  // Move it somewhere the FaceCamera turn would aim it differently.
  a.pos.x = 500;
  a.pos.z = -500;
  hFrame(a, events, rng);
  hFrame(a, events, rng);
  check("and after that it stops turning and stops counting",
        a.yaw === yaw && a.hum.stallFrames === 1,
        `yaw ${a.yaw} was ${yaw} hold ${a.hum.stallFrames}`);

  // The removal test is the one thing the idle routine does keep.
  G.g_active_cam_path = 90;
  G.g_cam_path_frame = 900;
  hFrame(a, events, rng);
  check("but the removal trigger still fires", a.dead);
}

console.log("\nclass 0x25, the object path's attachment offset:");
{
  const rng = new Rng(4);
  // `op 11`'s `b` is an index into `g_class25_path_offsets` (0x00596B18), not
  // a distance: record 1 is {4.5, 3.0, -1.5} with a half-turn of yaw.
  const { a, events } = humanoidScene([
    { op: HumanoidOp.FollowPath, mode: 1, a: 5, b: 1 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 9999, b: 0 },
  ]);
  const pathHost = {
    ...NULL_HOST,
    objectPath: () => ({ x: 10, y: 0, z: 20 }),
  };
  ScriptedHumanoidUpdate(a, { dt: 1 / 60, rng, host: pathHost,
                              events });
  const r = g_class25_path_offsets[1];
  check("op 11's b indexes the 24-byte offset table",
        a.hum.pathOffsetRecord === 1 && r.dx === 4.5 && r.dyaw === 0x8000);
  check("and the record is added to the path's point, with its yaw delta",
        Math.abs(a.pos.x - (10 + r.dx)) < 1e-6
        && Math.abs(a.pos.y - (0 + r.dy)) < 1e-6
        && Math.abs(a.pos.z - (20 + r.dz)) < 1e-6
        && a.yaw === r.dyaw,
        `pos ${a.pos.x},${a.pos.y},${a.pos.z} yaw ${a.yaw}`);
}

console.log("\nclass 0x25, a path in mode 1 gives the rider all three angles:");
{
  // `0x00484B6E`-`0x00484B74`: `MOV [EDI+0x64],EAX; MOV [EDI+0x68],ECX;
  // MOV [EDI+0x6c],EDX` out of `CamEvalObjectPath6`'s three ints, skipped in
  // mode 2 by `CMP [EDI+0x1358],0x2 / JZ` at `0x00484B5D`. The port wrote the
  // yaw alone, so a rider on a pitching path stood upright. Three unequal
  // angles, so a dropped or swapped word shows. Record 0 is the no-offset
  // sentinel, so nothing is added on top of the path's own yaw.
  const rng = new Rng(4);
  const ride = (mode: number) => {
    const { a, events } = humanoidScene([
      { op: HumanoidOp.FollowPath, mode, a: 5, b: 0 },
      { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 9999, b: 0 },
    ]);
    a.pitch = 0x0111; a.yaw = 0x0222; a.roll = 0x0333;
    const host = {
      ...NULL_HOST,
      objectPath: () => ({ x: 10, y: 0, z: 20,
                           pitch: 0x3d8e, yaw: 0x4000, roll: 0x0800 }),
    };
    ScriptedHumanoidUpdate(a, { dt: 1 / 60, rng, host, events });
    return a;
  };
  const one = ride(1);
  check("mode 1 writes the path's pitch, yaw and roll onto the rider",
        one.pitch === 0x3d8e && one.yaw === 0x4000 && one.roll === 0x0800,
        `${one.pitch.toString(16)} ${one.yaw.toString(16)} `
        + `${one.roll.toString(16)}`);
  const two = ride(2);
  check("...and mode 2 takes the position and leaves all three alone",
        two.pos.x === 10 && two.pitch === 0x0111 && two.yaw === 0x0222
        && two.roll === 0x0333,
        `${two.pitch.toString(16)} ${two.yaw.toString(16)} `
        + `${two.roll.toString(16)}`);
}

console.log("\nclass 0x25, it is not an enemy:");
{
  const rng = new Rng(4);
  const { a, events } = humanoidScene([
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 9999, b: 0 },
  ]);
  hFrame(a, events, rng);
  GameUpdate(1 / 60, NULL_HOST, rng, events);
  check("a scripted humanoid is not counted as a live enemy",
        G.g_enemies_alive === 0, String(G.g_enemies_alive));
  check("and is not a camera target",
        G.g_enemy_slots.every((x) => x.occupied === 0), slotsShown());
}

console.log("\nclass 0x25, `op 4` mode 4 waits for the actor to RECEDE (B13):");
{
  const rng = new Rng(4);
  // `0x004845AE`-`0x00484604`: the engine compares `|prevPos - point|` against
  // `|pos - point|` and blocks unless the previous distance was the smaller
  // one. The port had this the other way round and called it
  // `NearerThanBefore`.
  const { a, events } = humanoidScene([
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.FartherThanBefore,
      a: 0, b: 0, f0: 0, f1: 0 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 9999, b: 0 },
  ]);
  // Frame one leaves `prevPos` at the origin and the actor 10 units out, so
  // the actor is farther than it was: the command proceeds.
  a.pos.x = 10;
  hFrame(a, events, rng);
  check("moving away from the point passes the test", a.hum.pc === 1,
        `pc ${a.hum.pc}`);

  const closing = humanoidScene([
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.FartherThanBefore,
      a: 0, b: 0, f0: 0, f1: 0 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 9999, b: 0 },
  ]);
  closing.a.pos.x = 10;
  closing.a.hum.prevPos.x = 20;
  hFrame(closing.a, closing.events, rng);
  check("...and closing on it does not", closing.a.hum.pc === 0,
        `pc ${closing.a.hum.pc}`);
}

console.log("\nclass 0x25, op 17 mode 0: the jetty zombies fall back ONCE, "
            + "and into the canal:");
{
  // Stage 2 block 16 step 15, evt 43584, as the bundle carries it: held until
  // camera path 79 frame 100, shot at frame 160 (977, the stumble, to its last
  // cursor), 1024 for twenty frames, then 972 -- the fall back -- and op 17
  // mode 0. The port stepped over op 17 and ran into op -1, so the actor sat
  // in the idle routine on clip 972 with the freeze flag clear, and the fall
  // looped on the jetty until the boss's camera removed it.
  const { a, frame } = jettyScene([
    { op: HumanoidOp.WaitThenHold, mode: HumanoidCond.Always, a: 0, b: 0 },
    { op: HumanoidOp.WaitThenPlay, mode: HumanoidCond.CameraAt, a: 79, b: 100 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.CameraAt, a: 79, b: 160 },
    { op: HumanoidOp.SetBoneModel, mode: 0, a: 2, b: 0 },
    { op: HumanoidOp.SetMotionBlended, mode: 5, a: 977, b: 0 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.MotionFrame, a: -1, b: 0 },
    { op: HumanoidOp.SetMotionBlended, mode: 5, a: 1024, b: 0 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 20, b: 0 },
    { op: HumanoidOp.SetBoneModel, mode: 0, a: 2, b: 1 },
    { op: HumanoidOp.SetMotionBlended, mode: 5, a: 972, b: 0 },
    { op: HumanoidOp.Handoff, mode: 0, a: 0, b: 0 },
    { op: HumanoidOp.End, mode: 0, a: 0, b: 0 },
  ]);
  const slot = a.hitSlot;
  let handoff = -1;
  let deadAt = -1;
  let wrapped = false;
  let last = -1;
  for (let f = 1; f <= 600 && deadAt < 0; f++) {
    G.g_cam_path_frame = Math.min(f, 179);
    frame();
    if (handoff < 0 && a.motion === 972) handoff = f;
    if (a.dead) { deadAt = f; break; }
    if (handoff >= 0) {
      const cur = MotionPlayFrame(a);
      if (cur < last) wrapped = true;
      last = cur;
    }
  }
  check("the program reaches the fall back and the hand-off",
        handoff > 0, `handoff frame ${handoff}`);
  // `ScriptedHumanoidFallAndSplash` (0x00484DF0): vel.y -= 0.02 from rest, so
  // after n frames y = -23 - 0.01 n (n + 1). n = 21 is -27.62, n = 22 is
  // -28.06, and the routine ends at y <= -27.9998 -- the 22nd frame.
  check("it drops through the surface and is gone on the 22nd frame after "
        + "the hand-off, not left looping on the jetty",
        deadAt - handoff === 22 && !a.visible,
        `handoff ${handoff} dead ${deadAt} y ${a.pos.y.toFixed(3)}`);
  check("...and the fall-back clip never wrapped on the way",
        !wrapped, `last cursor ${last}`);
  const splash = G.g_sprite_effects.find(
    (e) => e.kind === SpriteEffectKind.Splash);
  check("...splashing at the surface height, -24.9998, where it went in",
        !!splash && Math.abs(splash.pos.y - -24.999799728393555) < 1e-6
        && Math.abs(splash.pos.x - a.pos.x) < 1e-6
        && Math.abs(splash.pos.z - a.pos.z) < 1e-6,
        JSON.stringify(splash));
  check("...and handing its hit slot back (`ActorFreeHitSlot`)",
        slot !== HIT_SLOT_NONE && a.hitSlot === HIT_SLOT_NONE
        && G.g_hit_slots[slot] === HIT_SLOT_NONE,
        `slot ${slot} now ${a.hitSlot}`);
}

console.log("\nclass 0x25, op 17 mode 0 holds the clip on its last cursor:");
{
  // Placed high, so the fall outlasts the clip. 900 has a play length of 18:
  // the routine raises the freeze when the cursor its last draw showed is 17,
  // and that frame's draw has already stepped to 18 -- which is where the
  // engine's clip holds, on the cursor that is the clip's last pose.
  const { a, frame } = jettyScene([
    { op: HumanoidOp.SetMotionBlended, mode: 0, a: 900, b: 0 },
    { op: HumanoidOp.Handoff, mode: 0, a: 0, b: 0 },
    { op: HumanoidOp.End, mode: 0, a: 0, b: 0 },
  ], vec3(0, 1000, 0));
  const seen: number[] = [];
  for (let f = 1; f <= 80; f++) {
    frame();
    seen.push(MotionPlayFrame(a));
  }
  check("the freeze goes up", a.frozen === 1, `frozen ${a.frozen}`);
  check("...on the clip's play length, and stays there",
        seen.slice(19).every((c) => c === 18) && seen[18] === 18
        && seen[17] === 17,
        seen.slice(14, 24).join(","));
  check("...while the body keeps falling",
        a.pos.y < 1000 - 0.01 * 70 * 71 && !a.dead, `y ${a.pos.y}`);
}

/**
 * A character for class 0x25's two slot writers: bones 2 and 3 carry
 * `znebi2`'s (type 0xF's) effect rows as the bundle does -- `[slot, next,
 * damage]` per step, from `g_pBoneEffectSlots` -- and the table carries
 * `g_player_hand_slots`' ten rows as `0x004EC9E0` holds them. The jetty zombies
 * are type 0xF; the fixture keeps the id 1 the other class-0x25 tests use.
 */
const WOUND_CHARS = {
  ...JETTY_CHARS,
  types: { "1": { ...(JETTY_CHARS as { types: Record<string, CharacterType> })
    .types["1"],
    bones: [
      { bone: 2, part: "head", slot: 0x1bf9, offset: [0, 0, 0], parent: null,
        damage_rank: [], hit_radius: 1.5, hit_slot: 0x1bf9,
        steps: [[0x1bfa, 0x1bfb, 100], [0x1bfb, 0, 120], [0, 0, 0], [0, 0, 0],
                [0, 0, 0], [0, 0x1c00, 0]] },
      { bone: 3, part: "l_upperarm", slot: 0x1bff, offset: [0, 0, 0],
        parent: null, damage_rank: [], hit_radius: 1, hit_slot: 0x1bff,
        steps: [[0x1c00, 0x1c01, 25], [0x1c01, 1, 35], [1, 0, 0]] },
      { bone: 5, part: "r_hand", slot: 0x1591, offset: [0, 0, 0], parent: null,
        damage_rank: [], hit_radius: 1, hit_slot: 0x1591, steps: [] },
    ] } },
  player_hand_slots: [
    0x158f, 0x1591, 0x1592, 0x15a3, 0x15a4, 0x15a5, 0x15b5, 0x15b6, 0x15b7,
    0x15c8, 0x15c9, 0x15ca, 0x0d3a, 0x0d3b, 0x0d3c, 0x0c4e, 0x0c4f, 0x0c50,
    0x126e, 0x126f, 0x1270, 0x09cc, 0x09cd, 0x09ce, 0x0e41, 0x0e42, 0x0e43,
    0x0f9d, 0x14b1, 0x14b2,
  ],
} as unknown as CharactersJson;

/**
 * {@link jettyScene} over {@link WOUND_CHARS}, driven from `ResetGameGlobals`
 * through `GameUpdate`, with a host that records every `setBoneSlot` -- the
 * call that reaches the renderer's draw record.
 */
function woundScene(cmds: HumanoidProgram["cmds"]):
    { a: Actor; frame: () => void; swaps: number[][] } {
  ResetGameGlobals();
  EnterPlay();
  SetGameTables(WOUND_CHARS, undefined, undefined, { "12288": {
    charType: 1, removePath: 100, removeFrame: 65, flags2: 1,
    motion: 1024, phase: 0, cmds,
  } });
  G.g_active_cam_path = 79;
  G.g_cam_path_frame = 0;
  const swaps: number[][] = [];
  const host: GameHost = {
    ...NULL_HOST,
    setBoneSlot: (at, bone, slot) => { swaps.push([at, bone, slot]); },
  };
  const rng = new Rng(4);
  const events = new Events();
  const a = ActorSpawn(0x3000, SpawnClass.ScriptedHumanoid, 1, "wound",
                       { pos: vec3(-1325, -23, -1834), visible: true }, rng);
  return { a, swaps,
           frame: () => GameUpdate(1 / 60, host, rng, events) };
}

console.log("\nclass 0x25, op 16: blood on the bone, then the wound (stage 2's "
            + "jetty, evt 43584):");
{
  // The first half of evt 43584 as the bundle carries it: held until camera
  // path 79 frame 100, then at frame 160 `op 16 a=2 b=0` and the stumble.
  // The port stepped over both `op 16`s, so the zombie was shot on cue with
  // no blood and no wound. `ScriptedHumanoidUpdate` at 0x00484972 calls
  // `SpawnBloodSpray(obj, 2, 0.75f)` -- `PUSH 0x3f400000` -- and writes
  // `g_pBoneEffectSlots[0xF][6*2 + 0]`, 0x1BFA, into bone 2's record.
  const { a, frame, swaps } = woundScene([
    { op: HumanoidOp.WaitThenHold, mode: HumanoidCond.Always, a: 0, b: 0 },
    { op: HumanoidOp.WaitThenPlay, mode: HumanoidCond.CameraAt, a: 79, b: 100 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.CameraAt, a: 79, b: 160 },
    { op: HumanoidOp.SetBoneModel, mode: 0, a: 2, b: 0 },
    { op: HumanoidOp.SetMotionBlended, mode: 5, a: 977, b: 0 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.MotionFrame, a: -1, b: 0 },
    { op: HumanoidOp.SetMotionBlended, mode: 5, a: 1024, b: 0 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 20, b: 0 },
    { op: HumanoidOp.SetBoneModel, mode: 0, a: 2, b: 1 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 9999, b: 0 },
  ]);
  const radius = a.boneRadius["2"];
  let shotAt = -1;
  for (let f = 1; f <= 160 && shotAt < 0; f++) {
    G.g_cam_path_frame = f;
    frame();
    if (G.g_blood_sprays.length) shotAt = f;
  }
  check("op 16 fires on the frame its wait opens, camera frame 160",
        shotAt === 160, `first blood on frame ${shotAt}`);
  const b0 = G.g_blood_sprays[0];
  check("...spraying blood from bone 2 of this actor at severity 0.75",
        G.g_blood_sprays.length === 1 && b0?.at === a.at && b0?.bone === 2
        && b0?.severity === 0.75 && b0?.cel === 0,
        JSON.stringify(G.g_blood_sprays));
  check("...and redrawing bone 2 as 0x1BFA, g_pBoneEffectSlots[0xF][12]",
        a.boneSlot["2"] === 0x1bfa, `bone 2 slot ${a.boneSlot["2"]}`);
  check("...through GameHost.setBoneSlot, which is what reaches the draw",
        swaps.length === 1 && swaps[0].join() === [0x3000, 2, 0x1bfa].join(),
        JSON.stringify(swaps));
  check("...and running on into the stumble in the same frame",
        a.motion === 977, `motion ${a.motion}`);
  check("...without touching the hit sphere, the step counter or a zone bit "
        + "-- it is not ActorSwapDamagedPart",
        a.boneRadius["2"] === radius && radius > 0
        && (a.hits[2] ?? 0) === 0 && a.zones === 0,
        `radius ${radius} -> ${a.boneRadius["2"]} hits ${a.hits[2]} `
        + `zones ${a.zones}`);
  for (let f = 161; f <= 260 && a.boneSlot["2"] !== 0x1bfb; f++) {
    G.g_cam_path_frame = Math.min(f, 179);
    frame();
  }
  check("the second op 16 (b 1) escalates the same bone to 0x1BFB, with "
        + "blood again",
        a.boneSlot["2"] === 0x1bfb
        && swaps.map((s) => s[2]).join() === [0x1bfa, 0x1bfb].join()
        && G.g_blood_sprays.filter((b) => b.bone === 2).length >= 1,
        `slot ${a.boneSlot["2"]} swaps ${JSON.stringify(swaps)}`);
}

console.log("\nclass 0x25, op 16 leaves a control code alone, and reads the "
            + "table flat:");
{
  // Bone 3's third step is 1 -- a sever code, not a slot -- and `CMP EAX, 0x2;
  // JLE` at 0x004849B9 skips the store for it; the blood has already gone up.
  // Then `a=2 b=6`: the index is 6*2 + 6 = 18, which is bone 3's first step,
  // and it is bone **2**'s record that takes it (`ECX = a*0x90`).
  const { a, frame, swaps } = woundScene([
    { op: HumanoidOp.SetBoneModel, mode: 0, a: 3, b: 2 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 1, b: 0 },
    { op: HumanoidOp.SetBoneModel, mode: 0, a: 2, b: 6 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 9999, b: 0 },
  ]);
  frame();
  check("a control code sprays but swaps nothing",
        G.g_blood_sprays.length === 1 && G.g_blood_sprays[0].bone === 3
        && a.boneSlot["3"] === undefined && swaps.length === 0,
        `blood ${JSON.stringify(G.g_blood_sprays)} swaps ${swaps.length}`);
  frame();
  frame();
  check("6*a + b past the bone's six lands in the next bone's row, "
        + "on bone a's record",
        a.boneSlot["2"] === 0x1c00 && a.boneSlot["3"] === undefined,
        `bone 2 ${a.boneSlot["2"]} bone 3 ${a.boneSlot["3"]}`);
}

console.log("\nclass 0x25, op 9 puts a row of g_player_hand_slots on bone 5:");
{
  // Stage 3 evt 38120, a 0x3A figure: `op 9 mode 2 a=0` -- row 0's third
  // model, 0x1592 -- and later `op 9 mode 1 a=1`, its own hand, 0x15A4.
  // `MOVSX EAX, word ptr [ECX*2 + 0x4ec9e0]` with ECX = 3*a + mode, into
  // `[EDI + 0x4dc]`, which is bone 5's record.
  const { a, frame, swaps } = woundScene([
    { op: HumanoidOp.SetHandModel, mode: 2, a: 0, b: 0 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 1, b: 0 },
    { op: HumanoidOp.SetHandModel, mode: 1, a: 1, b: 0 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 9999, b: 0 },
  ]);
  frame();
  check("mode 2 of row 0 is 0x1592, on bone 5, with no blood",
        a.boneSlot["5"] === 0x1592 && swaps.length === 1
        && swaps[0].join() === [0x3000, 5, 0x1592].join()
        && G.g_blood_sprays.length === 0,
        `bone 5 ${a.boneSlot["5"]} swaps ${JSON.stringify(swaps)}`);
  frame();
  frame();
  check("...and mode 1 of row 1 is 0x15A4, written although it is a "
        + "skeleton's own slot -- op 9 has no filter",
        a.boneSlot["5"] === 0x15a4 && swaps.length === 2,
        `bone 5 ${a.boneSlot["5"]}`);
}

console.log("\nclass 0x25, op 9's row in Original Mode is the character byte:");
{
  // `DEC EAX; JNZ` on `g_GameMode` at 0x0048473E: in Original Mode an `a` of
  // 0 or 1 is replaced by `g_original_character[a]`, and any other `a`
  // stands. The reset leaves the byte the player index, so the row is the
  // same -- which is why the test also moves the byte: a non-identity input is
  // the only one that says the branch reads it (L48).
  const cmds = [
    { op: HumanoidOp.SetHandModel, mode: 0, a: 1, b: 0 },
    { op: HumanoidOp.SetHandModel, mode: 0, a: 4, b: 0 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 9999, b: 0 },
  ];
  const seed = [...G.g_original_character];
  let s = woundScene(cmds);
  check("the character byte starts as its one writer leaves it, [0, 1]",
        G.g_original_character.join() === "0,1",
        G.g_original_character.join());
  G.g_GameMode = GameMode.Original;
  s.frame();
  check("Original Mode with the byte as the reset leaves it: row 1 -- and "
        + "a=4 is never remapped, 0x0D3A",
        s.swaps.map((x) => x[2]).join() === [0x15a3, 0x0d3a].join(),
        JSON.stringify(s.swaps));
  s = woundScene(cmds);
  G.g_GameMode = GameMode.Original;
  G.g_original_character = [0, 3];
  s.frame();
  check("...and with player 2 on character 3 it is row 3, 0x15C8",
        s.swaps[0]?.[2] === 0x15c8 && s.swaps[1]?.[2] === 0x0d3a,
        JSON.stringify(s.swaps));
  s = woundScene(cmds);
  G.g_GameMode = GameMode.Arcade;
  G.g_original_character = [0, 3];
  s.frame();
  check("...while Arcade Mode never reads it: row 1, 0x15A3",
        s.swaps[0]?.[2] === 0x15a3, JSON.stringify(s.swaps));
  G.g_original_character = seed;
  G.g_GameMode = GameMode.Arcade;
}

console.log("\nclass 0x25, a motion wait counts the engine's cursor:");
{
  // Stage 2 evt 54508 waits on `op 4 mode 2 a=66` over clip 805, which has 35
  // authored frames and a play length of 68. The VM compared authored frames,
  // which never reach 66 on a 35-frame clip, so the actor parked there until
  // its removal trigger. The engine compares `obj+0x19C`: the frame that runs
  // op 3 draws cursor 0, frame n draws n - 1, and the VM reads the cursor the
  // previous frame drew -- 66 on the 68th frame.
  const { a, frame } = jettyScene([
    { op: HumanoidOp.SetMotionBlended, mode: 0, a: 805, b: 0 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.MotionFrame, a: 66, b: 0 },
    { op: HumanoidOp.SetPos, mode: 1, a: 0, b: 0, f0: 5, f1: 0 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 9999, b: 0 },
  ]);
  for (let f = 1; f <= 67; f++) frame();
  check("not before the cursor it names", a.pos.y === -23, `y ${a.pos.y}`);
  frame();
  check("...and on the frame the VM reads 66", a.pos.y === 5, `y ${a.pos.y}`);
}

console.log("\nclass 0x25, op 2 and the Init write the counter itself:");
{
  // Both write `obj+0x194` outright (`*piVar1 = blk+6` in the Init,
  // `MOV [EBP], ECX` at 0x00484466 for op 2), in the counter's unit -- not an
  // authored frame to be doubled -- and -1 is `rand() % 10`.
  const rng = new Rng(4);
  const { a, events } = humanoidScene([
    { op: HumanoidOp.SetMotion, mode: 2, a: 10, b: 7 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 9999, b: 0 },
  ], { phase: 5 });
  check("the Init's phase is the counter", a.playTicks === 5,
        `${a.playTicks}`);
  hFrame(a, events, rng);
  check("...and so is op 2's b", a.playTicks === 7, `${a.playTicks}`);
  check("...and op 2 mode 2 raises obj+0x1F8 bit 4",
        (a.motionFlags & MotionFlag.TraceGround) !== 0,
        `0x${a.motionFlags.toString(16)}`);
  const want = new Rng(4).int(10);
  ResetGameGlobals();
  SetGameTables(JETTY_CHARS, undefined, undefined, { "12288": {
    charType: 1, removePath: 100, removeFrame: 65, flags2: 2, motion: 900,
    phase: -1, cmds: [] } });
  const seeded = ActorSpawn(0x3000, SpawnClass.ScriptedHumanoid, 1, "seed",
                            { visible: true }, new Rng(4));
  check("a phase of -1 is rand() % 10, drawn from the spawn's generator",
        seeded.playTicks === want, `${seeded.playTicks} want ${want}`);
  check("...and blk+2 == 2 raises bit 4 at the Init",
        (seeded.motionFlags & MotionFlag.TraceGround) !== 0);
}

console.log("\nclass 0x25, op 17's other four modes:");
{
  // Mode 1, `ScriptedHumanoidLaunchAndDrop` (0x00484EA0): sub 0 seeds
  // vel = (x - 231.5, 20) and falls through into sub 1, which steps a growing
  // gravity of 0.027222222 a frame. Stage 2 block 37's bystanders stand near
  // x = 243.
  const g = 0.027222221717238426;
  const up = jettyScene([
    { op: HumanoidOp.Handoff, mode: 1, a: 0, b: 0 },
    { op: HumanoidOp.End, mode: 0, a: 0, b: 0 },
  ], vec3(243, 23, -2230));
  up.frame();
  check("mode 1 ends the VM's frame and moves nothing yet",
        up.a.pos.y === 23 && up.a.pos.x === 243, `y ${up.a.pos.y}`);
  up.frame();
  check("...then launches: up 20 less one step of gravity, out 11.5 along x",
        Math.abs(up.a.pos.y - (23 + 20 - g)) < 1e-9
        && Math.abs(up.a.pos.x - (243 + 11.5)) < 1e-9,
        `y ${up.a.pos.y} x ${up.a.pos.x}`);
  // The routine's recurrence on its own, from the constants: step s is the
  // frame s + 1 (frame 1 was the hand-off), and the actor dies on the first
  // step that leaves y below 0.
  let y = 23, vy = 20, acc = 0, step = 0;
  do { acc -= g; vy += acc; y += vy; step++; } while (y >= 0);
  let frames = 2;
  while (!up.a.dead && frames < 400) { up.frame(); frames++; }
  check("...and dies on the frame it first falls below y = 0",
        up.a.dead && frames === step + 1,
        `died on frame ${frames}, expected ${step + 1}`);

  // Mode 4, `ScriptedHumanoidFallTimed` (0x00484F90): vel.y = -0.40833333
  // at the hand-off, then the same gravity step, and death past 200 frames.
  const t = jettyScene([
    { op: HumanoidOp.Handoff, mode: 4, a: 0, b: 0 },
    { op: HumanoidOp.End, mode: 0, a: 0, b: 0 },
  ], vec3(1632, 500, -9774.9));
  t.frame();
  check("mode 4 sets the opening fall speed",
        Math.abs(t.a.vel.y - -0.40833333134651184) < 1e-12, `${t.a.vel.y}`);
  t.frame();
  check("...and falls by it with one gravity step",
        Math.abs(t.a.pos.y - (500 - 0.40833333134651184 - g)) < 1e-9,
        `y ${t.a.pos.y}`);
  for (let i = 0; i < 199; i++) t.frame();
  check("...alive through its 200th frame", !t.a.dead);
  t.frame();
  check("...and gone on the 201st", t.a.dead && !t.a.visible);

  // Modes 2 and 3 spawn a sprite and stay in the VM: the next command runs in
  // the same frame. An unknown mode steps past and ends the frame.
  const s = jettyScene([
    { op: HumanoidOp.Handoff, mode: 2, a: 0, b: 0 },
    { op: HumanoidOp.Handoff, mode: 3, a: 0, b: 0 },
    { op: HumanoidOp.SetPos, mode: 1, a: 0, b: 0, f0: 7, f1: 0 },
    { op: HumanoidOp.Handoff, mode: 7, a: 0, b: 0 },
    { op: HumanoidOp.SetPos, mode: 1, a: 0, b: 0, f0: 9, f1: 0 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 9999, b: 0 },
  ]);
  s.frame();
  const spark = G.g_sprite_effects.find((e) => e.kind === 0x34);
  const plume = G.g_sprite_effects.find((e) => e.kind === 0x41);
  check("mode 2 puts kind 0x34 at (-999.5, 3.24, -1296.2), yaw 0xC000",
        !!spark && spark.pos.x === -999.5
        && Math.abs(spark.pos.y - 3.24) < 1e-6
        && Math.abs(spark.pos.z - -1296.2) < 1e-4 && spark.yaw === 0xc000,
        JSON.stringify(spark));
  check("mode 3 puts kind 0x41 at (-1264, -24.9, -1353) outside block 9",
        !!plume && plume.pos.x === -1264 && plume.pos.z === -1353
        && Math.abs(plume.pos.y - -24.9) < 1e-6, JSON.stringify(plume));
  check("...both run on into the next command, and mode 7 ends the frame",
        s.a.pos.y === 7, `y ${s.a.pos.y}`);
  s.frame();
  check("...stepped past, so the next frame runs what follows it",
        s.a.pos.y === 9, `y ${s.a.pos.y}`);
}

console.log("\nclass 0x25, the removal trigger gives the hit slot back:");
{
  const { a, frame } = jettyScene([
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 9999, b: 0 },
  ]);
  const slot = a.hitSlot;
  frame();
  G.g_active_cam_path = 100;
  G.g_cam_path_frame = 65;
  frame();
  check("the removal kills it and frees `g_hit_slots`",
        a.dead && slot !== HIT_SLOT_NONE && a.hitSlot === HIT_SLOT_NONE
        && G.g_hit_slots[slot] === HIT_SLOT_NONE,
        `dead ${a.dead} slot ${slot} now ${a.hitSlot}`);
}

console.log("\nclass 0x25, an unbaked clip parks the VM (B13's mechanism):");
{
  // The bug as reported was two stage-2 humanoids frozen on one frame. The
  // cause was not in this file at all: their `op 2` set motion 180 and the
  // **exporter** had never baked it, because nothing added an `op 2` operand
  // to the bake list.
  // This is the port half, which records what an unbaked clip does so
  // the symptom is recognisable the next time one appears.
  const rng = new Rng(4);
  const cmds = [
    { op: HumanoidOp.SetMotion, mode: -1, a: 55, b: 0 },
    { op: HumanoidOp.WaitThenHold, mode: HumanoidCond.MotionFrame,
      a: -1, b: 0 },
    { op: HumanoidOp.End, mode: 0, a: 0, b: 0 },
  ];
  // 55 is deliberately not in `TYPE.motions`.
  const gone = humanoidScene(cmds);
  for (let i = 0; i < 600; i++) hFrame(gone.a, gone.events, rng);
  check("a clip with no baked frames parks the wait for ever",
        gone.a.hum.pc === 1 && gone.a.motion === 55,
        `pc ${gone.a.hum.pc} motion ${gone.a.motion}`);
  check("...and the class says so rather than saying nothing",
        !!g_class_handlers[SpawnClass.ScriptedHumanoid]
          ?.debug?.(gone.a).detail?.some((d) => d.includes("not baked")),
        JSON.stringify(g_class_handlers[SpawnClass.ScriptedHumanoid]
          ?.debug?.(gone.a)));

  // The same program with a clip that *is* baked reaches its last frame and
  // leaves the VM, which is what the two stage-2 spawns now do.
  const ok = humanoidScene([
    { op: HumanoidOp.SetMotion, mode: -1, a: 10, b: 0 },
    { op: HumanoidOp.WaitThenHold, mode: HumanoidCond.MotionFrame,
      a: -1, b: 0 },
    { op: HumanoidOp.End, mode: 0, a: 0, b: 0 },
  ]);
  for (let i = 0; i < 600; i++) {
    ActorAdvanceMotion(ok.a, 1 / 60);
    hFrame(ok.a, ok.events, rng);
  }
  check("a baked clip reaches its last frame and the program ends",
        ok.a.hum.routine === HumanoidRoutine.Idle && ok.a.frozen === 1,
        `pc ${ok.a.hum.pc} frozen ${ok.a.frozen}`);
}

console.log("\nclass 0x25 answers the sidebar (B13's other half):");
{
  const rng = new Rng(4);
  const { a, events } = humanoidScene([
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.CameraAt, a: 67, b: 85 },
  ]);
  hFrame(a, events, rng);
  const d = g_class_handlers[SpawnClass.ScriptedHumanoid]?.debug?.(a);
  // `actorsProjection` prints "ported, but the class says nothing" for any
  // handler with no `debug`, which is what the bug report quoted.
  check("the handler has a `debug`", d !== undefined);
  check("...and it names the command the VM is parked on",
        !!d?.summary.includes("WaitUntil") && !!d?.summary.includes("pc 0"),
        d?.summary);
  check("...and the camera pair it is waiting for",
        !!d?.summary.includes("cam (67,85)"), d?.summary);
}
