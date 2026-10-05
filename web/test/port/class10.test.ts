import type { CharactersJson } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { ActorSpawn, RetireUnlistedActor } from "../../src/game/director";
import { ActorKillAll } from "../../src/game/combat/resolve_hit";
import { ActorAdvanceMotion } from "../../src/game/motion";
import { UpdateSceneViewAndLight } from "../../src/game/camera/view";
import { MotionFlag } from "../../src/game/actor";
import { ScoreAddForPlayer } from "../../src/game/combat/score";
import { G, HIT_SLOT_NONE, ResetGameGlobals } from "../../src/game/globals";
import { NULL_HOST } from "../../src/game/host";
import { SetGameTables } from "../../src/game/tables";
import { QueryGroundHeightAt } from "../../src/game/coli";
import { ActorFlag } from "../../src/game/actor";
import {
  PROJECTION_DISTANCE_PX as G_PROJECTION_DISTANCE_PX,
} from "../../src/game/combat/permits";
import { ActorDespawn } from "../../src/game/despawn";
import { HIT_SLOT_CLAIMED } from "../../src/game/hit_slots";
import { SpawnClass } from "../../src/game/spawn_class";
import {
  CivilianAttachSet, CivilianOp, CivilianReapplyWaitCommand, CivilianRunScript,
  CivilianTarget, CivilianUpdate, CivilianWait, LifeGrantedMarkersTick,
} from "../../src/game/class10";
import { CivilianLeaveField } from "../../src/game/class10/update";
import type { CivilianCmdJson, CivilianItemJson } from "../../src/bundle/scene";
import { vec3, type Vec3 } from "../../src/game/vec";
import { ResolveHit } from "../../src/game/combat/resolve_hit";
import {
  check, TYPE, CHARS, SCENE_MAJOR_PLAYING, spawnZombie, EnterPlay,
  JoinPlayerTwo,
} from "./harness";

console.log("\nclass 0x10, the civilian and the rescue:");
{
  const rng = new Rng(9);

  /**
   * One civilian, one script, and however many captors the test wants.
   *
   * The streams are the exe's; here they are hand-written in the same shape
   * the exporter emits, so the VM is driven with no bundle and no renderer.
   *
   * **Every fixture opens with a `Wait`**, because every shipped stream does.
   * `CivilianRunScript` runs its first command whatever it is and stops
   * *before* the next opcode above 0x2B — so a stream that does not open with
   * one never loads a wait word at all and parks on the zero it started with.
   */
  const civScene = (cmds: CivilianCmdJson[][], children: number[] = [],
                    items: CivilianItemJson[] = [], seed?: number) => {
    ResetGameGlobals();
    EnterPlay();
    // The path camera: `CivilianUpdate` takes a hit only under it
    // (`0x0048AAC9`), and in the player the walker says so every frame.
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    SetGameTables(CHARS, undefined, undefined, undefined, undefined, {
      entries: [0],
      scripts: cmds,
      items,
      spawns: {
        "16384": {
          charType: 1, script: 0, removePath: -1, removeFrame: 0,
          removeDelay: 0,
          children: children.map((at) => ({
            at, class: 0x30, charType: 1,
            pos: [0, 0, 0] as [number, number, number], yaw: 0, hp: 1,
          })),
        },
      },
    });
    const kids = children.map((at) => {
      const k = spawnZombie(at, 1, "captor");
      k.visible = true;
      return k;
    });
    const a = ActorSpawn(0x4000, SpawnClass.Civilian, 1, "civilian",
                         undefined, seed === undefined ? rng : new Rng(seed));
    a.visible = true;
    a.pos = vec3(0, 0, 0);
    return { a, kids, events: new Events() };
  };
  const cFrame = (a: ReturnType<typeof ActorSpawn>, events: Events) =>
    CivilianUpdate(a, { dt: 1 / 60, rng, host: NULL_HOST, events });
  const cmd = (op: CivilianOp, ...args: number[]): CivilianCmdJson =>
    ({ op, args });
  const cmdKill = (scripts: number[], ...args: number[]): CivilianCmdJson =>
    ({ op: CivilianOp.SetOnShot, args, scripts });

  // The skip arm at `0x0048AF8E`: with `g_cutscene_skipping` up and the wait
  // word's `0x20000000` clear, the removal countdown is set to 1 and the
  // other arms are passed over; the next frame's countdown takes her off.
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, 0), cmd(CivilianOp.SetMotionBlend, 1),
      cmd(CivilianOp.Wait, 0),
    ]]);
    cFrame(a, events);
    const alive = G.g_civilians_alive;
    G.g_cutscene_skipping = 1;
    cFrame(a, events);
    G.g_cutscene_skipping = 0;
    check("a skipped cut scene sets a civilian's removal countdown to 1",
          a.civ?.removeDelay === 1 && !a.despawned,
          `delay ${a.civ?.removeDelay}`);
    cFrame(a, events);
    check("...and the next frame's countdown takes her off the field",
          a.despawned && G.g_civilians_alive === alive - 1,
          `despawned ${a.despawned}, alive ${G.g_civilians_alive}`);
  }

  // The VM runs a whole block in one go and parks on the next wait. A wait
  // word leads its block and governs the wait that *follows* it, which is why
  // a stream opens with one.
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetMotionBlend, 77),
      cmd(CivilianOp.SetCiviliansGoal, 3),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetMotionBlend, 88),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]]);
    check("the Init runs a whole block and parks on the next wait",
          a.civ?.cursor === 3 && a.civ?.motionBlend === 77
          && a.civ?.civiliansGoal === 3,
          `cursor ${a.civ?.cursor} rate ${a.civ?.motionBlend}`);
    for (let i = 0; i < 20; i++) cFrame(a, events);
    check("...and a wait word with no bits and no timer never resumes",
          a.civ?.motionBlend === 77 && a.civ?.cursor === 3,
          `rate ${a.civ?.motionBlend} cursor ${a.civ?.cursor}`);
  }

  // Wait bit 0x2000 reads `g_script_flags`, and a flag the script has never
  // set is *absent* from the array — which is a hole an undefined slips
  // straight through if the read is not defaulted.
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, CivilianWait.ScriptFlag),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetMotionBlend, 77),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]]);
    for (let i = 0; i < 5; i++) cFrame(a, events);
    check("an unset script flag holds the wait rather than passing it",
          a.civ?.motionBlend === 10, `rate ${a.civ?.motionBlend}`);
    G.g_script_flags[0] = 1;
    cFrame(a, events);
    check("...and raising it lets the block run",
          a.civ?.motionBlend === 77, `rate ${a.civ?.motionBlend}`);
  }

  // Wait bit 0x1000 is **three** conditions (`0x0048B2F8`): the arm only
  // applies while `g_scene_state_major_entered` is 2, and it then releases on
  // `g_camera_settled` **or** `g_camera_free`. The port read the middle one
  // alone, which is wrong in both directions — and the direction that cost a
  // stage is the missing `g_camera_free`, because
  // `CameraTrackEnemiesTick` only ever raises `settled` while nothing is
  // tracked. Stage 2 block 9's `wait_script_flag 3` is raised by such a
  // civilian and could never come down.
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, CivilianWait.CameraSettled),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetMotionBlend, 77),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]]);
    G.g_scene_state_major_entered = 2;
    G.g_scene_state_major = 2;
    G.g_camera_settled = 0;
    G.g_camera_free = 0;
    for (let i = 0; i < 5; i++) cFrame(a, events);
    check("bit 0x1000 holds while the camera is neither settled nor free",
          a.civ?.motionBlend === 10, `rate ${a.civ?.motionBlend}`);
    G.g_camera_free = 1;
    cFrame(a, events);
    check("...and `g_camera_free` alone releases it",
          a.civ?.motionBlend === 77, `rate ${a.civ?.motionBlend}`);
  }
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, CivilianWait.CameraSettled),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetMotionBlend, 77),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]]);
    // Row 1 minor 3 is `CameraFromViewAngles`, the scripted view-angle turn.
    G.g_scene_state_major_entered = 1;
    G.g_scene_state_major = 1;
    G.g_camera_settled = 1;
    G.g_camera_free = 1;
    for (let i = 0; i < 5; i++) cFrame(a, events);
    check("...and off the path-camera row the arm releases nothing at all",
          a.civ?.motionBlend === 10, `rate ${a.civ?.motionBlend}`);
  }

  // The timer, op 0x09. It does **not** delay its own block: `CivilianStep-
  // Script` clears the timer on every resume, and the value that survives is
  // the one `CivilianReapplyWaitCommand` reads out of the block ahead. So a
  // timer set in one block delays the wait at the end of it, and a timer of
  // `n` costs `n + 1` frames because the test reads before the decrement.
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, CivilianWait.Free),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetTimer, 3),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetMotionBlend, 77),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]]);
    cFrame(a, events);
    check("the timer's own block runs at once and parks with it armed",
          a.civ?.timer === 3 && a.civ?.cursor === 3 && a.civ?.motionBlend === 10,
          `timer ${a.civ?.timer} cursor ${a.civ?.cursor}`);
    for (let i = 0; i < 3; i++) cFrame(a, events);
    check("a timer holds the next block for the frames it names",
          a.civ?.motionBlend === 10, `rate ${a.civ?.motionBlend}`);
    cFrame(a, events);
    check("...and releases it on the frame it reads zero",
          a.civ?.motionBlend === 77, `rate ${a.civ?.motionBlend}`);
  }

  // **A captor that leaves is not a captor that died.**
  // `CivilianPruneDeadChildren` (`FUN_0048CA60`) tests the child's `obj+0x34`
  // bit `0x4000000` and nothing else; `ActorDespawn` (`FUN_00409CC0`) raises
  // `0x80018000` and never that bit. The port dropped a child as soon as it
  // was missing from the pool, which counted a despawn as a rescue.
  {
    const { a, kids, events } = civScene([[
      cmd(CivilianOp.Wait, CivilianWait.Free),
      cmd(CivilianOp.SetChildrenGoal, 0),
      cmd(CivilianOp.Wait, CivilianWait.ChildrenAlive),
      cmd(CivilianOp.Wait, CivilianWait.Rescued),
      cmd(CivilianOp.End),
    ]], [0x4100]);
    cFrame(a, events);
    ActorDespawn(kids[0]);
    G.g_object_list = G.g_object_list.filter((o) => !o.despawned);
    for (let i = 0; i < 3; i++) cFrame(a, events);
    check("a captor that despawns without the dead bit is still held",
          a.civ?.childCount === 1 && G.g_player_score[0] === 0,
          `left ${a.civ?.childCount} score ${G.g_player_score[0]}`);
  }

  // **The rescue.** Wait bit 0x04 blocks while more than `childrenGoal` of
  // the civilian's captors are alive; the block it unblocks carries the
  // 0x10000000 bit, which is where the 400 is paid.
  {
    const { a, kids, events } = civScene([[
      cmd(CivilianOp.Wait, CivilianWait.Free),
      cmd(CivilianOp.SetChildrenGoal, 0),
      cmd(CivilianOp.Wait, CivilianWait.ChildrenAlive),
      cmd(CivilianOp.Wait, CivilianWait.Rescued),
      cmd(CivilianOp.End),
    ]], [0x4100, 0x4200]);
    let paid = 0;
    let payee = -2;
    events.on("civilian.rescued", (d) => { paid += 1; payee = d.player; });
    // A scene other than 0 and a count other than 0 going in, so the rescue
    // record's index is `scene*10 + n` and not anything that merely starts
    // at zero (L48).
    G.g_scene_index = 2;
    G.g_civilians_rescued_by_scene = [0, 0, 1, 0, 0, 0];
    G.g_civilians_rescued_total = 4;
    G.g_rescued_char_types = new Array<number>(60).fill(0);
    check("the civilian starts holding both its captors",
          a.civ?.childCount === 2, `${a.civ?.childCount}`);
    for (let i = 0; i < 5; i++) cFrame(a, events);
    check("...and the rescue does not pay while either is alive",
          G.g_player_score[0] === 0 && paid === 0,
          `score ${G.g_player_score[0]}`);
    // Killed the way a shot kills (L49): `ResolveHit` (`FUN_00409430`) raises
    // the bit `CivilianPruneDeadChildren` tests and writes the shooter into
    // `obj+0x131C`, which the prune copies to `sub+0x6C`. Player **1** fires,
    // so a payee of 0 or -1 cannot pass. Each killing shot pays its shooter
    // what `ResolveHit`'s own tail pays -- the kill's 0x50 and a body hit's 10
    // -- so the rescue's 400 is what is on the board beyond two of those.
    const KILL_SHOT = 0x50 + 10;
    kids[0].hp = 1;
    ResolveHit(kids[0], 1, NULL_HOST, rng, 1);
    cFrame(a, events);
    check("one captor down is not enough",
          a.civ?.childCount === 1 && G.g_player_score[1] === KILL_SHOT,
          `left ${a.civ?.childCount} score ${G.g_player_score.join("/")}`);
    kids[1].hp = 1;
    ResolveHit(kids[1], 1, NULL_HOST, rng, 1);
    cFrame(a, events);
    // `CivilianApplyWaitWord` pays both players only when `sub+0x6C` is -1,
    // the engine's "could not name one". A shot always names one.
    check("the last captor down pays 400 to the player who shot it, and to "
          + "nobody else",
          paid === 1 && payee === 1
          && G.g_player_score[1] === 2 * KILL_SHOT + 400
          && G.g_player_score[0] === 0,
          `paid ${paid} to ${payee}, scores ${G.g_player_score.join("/")}`);
    // `CivilianRunScript` op 0x2C's bookkeeping, `0x0048BA93`..`0x0048BAC4`:
    // the run total, this scene's count, and the civilian's own type at the
    // count before the increment -- what the result card stands up.
    check("...and records the rescue: the run's total and the scene's count "
          + "up one, and the civilian's type at g_rescued_char_types[2*10 + 1]",
          G.g_civilians_rescued_total === 5
          && G.g_civilians_rescued_by_scene[2] === 2
          && G.g_rescued_char_types[21] === a.charType
          && G.g_rescued_char_types[20] === 0
          && G.g_civilians_rescued_by_scene[0] === 0,
          `total ${G.g_civilians_rescued_total} by scene `
          + `${G.g_civilians_rescued_by_scene.join(",")} type `
          + `${G.g_rescued_char_types[21]} vs ${a.charType}`);
    G.g_scene_index = 0;
  }
  // ...and the other arm of `CivilianApplyWaitWord`'s payee test: a captor
  // that died with `obj+0x131C` still at -1 names nobody, and both players
  // are paid. The bit is set by hand because this checks the payee branch
  // alone, not how a captor comes to die.
  {
    const { a, kids, events } = civScene([[
      cmd(CivilianOp.Wait, CivilianWait.Free),
      cmd(CivilianOp.SetChildrenGoal, 0),
      cmd(CivilianOp.Wait, CivilianWait.ChildrenAlive),
      cmd(CivilianOp.Wait, CivilianWait.Rescued),
      cmd(CivilianOp.End),
    ]], [0x4100]);
    cFrame(a, events);
    kids[0].flags |= ActorFlag.Dead;
    cFrame(a, events);
    check("a captor dead with no killer named pays both players 400",
          G.g_player_score[0] === 400 && G.g_player_score[1] === 400,
          `scores ${G.g_player_score.join("/")}`);
  }

  // Shooting one. `SetOnShot` is the gate: without it the hit bits are simply
  // cleared and the civilian cannot be hurt at all.
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, 0), cmd(CivilianOp.End),
    ]]);
    EnterPlay();
    const lives0 = G.g_player_lives[0];
    a.flags |= 8;
    cFrame(a, events);
    check("a civilian with no on-shot script cannot be shot",
          G.g_player_lives[0] === lives0 && G.g_player_score[0] === 0
          && !a.dead,
          `lives ${G.g_player_lives[0]} score ${G.g_player_score[0]}`);
  }
  {
    // The exporter resolves op 0x0E's pointer to a stream index, so the
    // fixture carries `scripts` the same way.
    const { a, events } = civScene([
      [cmd(CivilianOp.Wait, CivilianWait.Free),
       { op: CivilianOp.SetOnShot, args: [1], scripts: [1] },
       cmd(CivilianOp.Wait, 0), cmd(CivilianOp.End)],
      [cmd(CivilianOp.Wait, 0), cmd(CivilianOp.SetMotionBlend, 55),
       cmd(CivilianOp.Wait, 0), cmd(CivilianOp.End)],
    ]);
    EnterPlay();
    // Points to lose: `ScoreAddForPlayer` floors the score at 0, so a penalty
    // off an empty score reads as nothing at all.
    ScoreAddForPlayer(0, 1000);
    const lives0 = G.g_player_lives[0];
    let shot = 0;
    events.on("civilian.shot", () => { shot += 1; });
    a.flags |= 8 | 2;                       // hit, and bit 1 names player 0
    cFrame(a, events);
    // 200, not 100: `PlayerTakeDamage` charges its own 100 for the life and
    // `CivilianUpdate` charges another for the civilian. That is what
    // "-100 twice" in docs/formats/spawns.md is.
    check("shooting a civilian costs a life and 100 points twice",
          shot === 1 && G.g_player_lives[0] === lives0 - 1
          && G.g_player_score[0] === 800,
          `lives ${G.g_player_lives[0]} score ${G.g_player_score[0]}`);
    check("...and switches it to the on-shot script",
          a.civ?.motionBlend === 55 && a.dead, `rate ${a.civ?.motionBlend}`);
  }
  {
    const { a, events } = civScene([
      [cmd(CivilianOp.Wait, CivilianWait.Free),
       { op: CivilianOp.SetOnShot, args: [1], scripts: [1] },
       cmd(CivilianOp.Wait, 0), cmd(CivilianOp.End)],
      [cmd(CivilianOp.Wait, 0), cmd(CivilianOp.End)],
    ]);
    EnterPlay();
    ScoreAddForPlayer(0, 1000);
    ScoreAddForPlayer(1, 1000);
    const lives0 = G.g_player_lives[0];
    a.flags |= ActorFlag.Dead;              // a killing shot
    cFrame(a, events);
    check("a killing shot charges 100 to BOTH players and no life",
          G.g_player_score[0] === 900 && G.g_player_score[1] === 900
          && G.g_player_lives[0] === lives0,
          `${G.g_player_score.join("/")} lives ${G.g_player_lives[0]}`);
  }

  // The held items, ops 0x13-0x15. The weighted pick is `rand() %% total`
  // walked down the list, and it comes from `ctx.rng` -- which is what makes
  // "which bottle is this civilian holding" survive a save state.
  {
    const items: CivilianItemJson[] = [
      { bone: 5, slot: 0x1000, kind: -1, rot: [0, 0, 0],
        sets: Array.from({ length: 6 },
                         (_, i) => [i, 0, 0, 1] as [number, number, number,
                                                    number]),
        callback: 0, banner: null },
      { bone: 5, slot: 0x1001, kind: -1, rot: [0, 0, 0],
        sets: Array.from({ length: 6 },
                         (_, i) => [i, 0, 0, 1] as [number, number, number,
                                                    number]),
        callback: 0, banner: null },
    ];
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, CivilianWait.Free),
      { op: CivilianOp.PickHeldItem, args: [1], itemTable: [[1, 0], [3, 1]] },
      { op: CivilianOp.AddPickedItem, args: [0] },
      { op: CivilianOp.AddHeldItem, args: [0, 0], item: 0 },
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]], [], items);
    check("the pick and both appends land in one block",
          a.civ?.items.length === 2 && a.civ?.pickedItem !== -1,
          `items ${JSON.stringify(a.civ?.items)}`);
    check("...and the second append is the record op 0x13 names",
          a.civ?.items[1]?.record === 0, JSON.stringify(a.civ?.items[1]));
    // The weights are 1 and 3, so the second record is three times as likely.
    // Asserting a *distribution* rather than a value is what catches a walk
    // that always takes the head -- which is the easy way to get this wrong.
    let second = 0;
    for (let seed = 0; seed < 40; seed++) {
      const one = civScene([[
        cmd(CivilianOp.Wait, CivilianWait.Free),
        { op: CivilianOp.PickHeldItem, args: [1],
          itemTable: [[1, 0], [3, 1]] },
        cmd(CivilianOp.Wait, 0),
        cmd(CivilianOp.End),
      ]], [], items, seed);
      if (one.a.civ?.pickedItem === 1) second += 1;
    }
    check("the weighted pick is weighted, not always the head",
          second > 20 && second < 40, `${second}/40 took the 3:1 entry`);
    void events;
  }

  // **The item is given, and taken away.** Bug: "rescued civilians ... still
  // carry it after you should receive its effect ... +1 life doesn't apply".
  //
  // `CivilianDrawHeldItems` (`FUN_0048CD10`) calls each record's `rec+0x18`
  // after drawing it. Record `0x0056B190`'s is `CivilianHeldItemGrantLife`
  // (`FUN_0048DCC0`): when the entry's operand -- `0x800000` in every shipped
  // op 0x13 -- turns up in the wait word, it clears it, raises `0x400000`,
  // names the player and calls `GrantExtraLife`; the draw then drops the
  // entry. The streams below are shaped like the shipped ones: the append,
  // a wait, then the give (stage 1 civilian `0x3C38`'s stream 13, commands
  // 55-57). The shipped word is `0x940100`; its `0x100` holds the step on the
  // block only while a clip has loops left, and these fixtures play none, so
  // the step would walk straight past a block carrying it -- they load
  // `0x940000`, the same word without that one condition.
  {
    const sets = (x: number, y: number, z: number, w: number) =>
      Array.from({ length: 6 },
                 () => [x, y, z, w] as [number, number, number, number]);
    // Record `0x0056B190` as the exporter writes it, and record `0x0056B390`
    // (kind 4, one of stage 2 civilian `0x8510`'s three picks).
    const LIFE: CivilianItemJson = {
      bone: 5, slot: 0x10c3, kind: -1, rot: [0x4000, 0, 0xc000],
      sets: sets(0, 1, 1, 1), callback: 0x0048dcc0, banner: null,
    };
    const ORIGINAL: CivilianItemJson = {
      bone: 5, slot: 0x10a8, kind: 4, rot: [0xb83a, 0x7a8a, 0xb51f],
      sets: sets(0.5, -0.6, 1.1, 0.8), callback: 0x0048dd60, banner: 0x5c1,
    };
    const GIVE_WORD = CivilianWait.GiveItem | CivilianWait.RootMotion
      | CivilianWait.CameraTrack;
    const give = (): CivilianCmdJson[] => [
      cmd(CivilianOp.Wait, 0),
      { op: CivilianOp.AddHeldItem, args: [0x0056b190, 0x800000], item: 0 },
      cmd(CivilianOp.SetTimer, 5),
      cmd(CivilianOp.Wait, GIVE_WORD),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ];
    const markers = () => G.g_life_granted_markers ?? [];
    const PX = Math.fround(G_PROJECTION_DISTANCE_PX);

    // One player in play: the life goes to whoever is in play.
    {
      const { a, events } = civScene([give()], [], [LIFE, ORIGINAL]);
      const p = G.g_active_player;
      const lives0 = G.g_player_lives[p];
      cFrame(a, events);
      check("a civilian holds the item op 0x13 gave her until the wait word "
            + "says to hand it over",
            a.civ?.items.length === 1 && G.g_player_lives[p] === lives0,
            `items ${JSON.stringify(a.civ?.items)} lives ${G.g_player_lives[p]}`);
      let at = -1;
      let drawnThen = "";
      for (let i = 0; i < 20 && at < 0; i++) {
        cFrame(a, events);
        if ((a.civ?.items.length ?? 1) === 0) {
          at = i;
          drawnThen = JSON.stringify(a.civ?.heldDrawn);
        }
      }
      check("the wait word's 0x800000 gives it: one more life, to the player "
            + "in play",
            at >= 0 && G.g_player_lives[p] === lives0 + 1,
            `given at ${at}, lives ${lives0} -> ${G.g_player_lives[p]} `
            + `(player ${p})`);
      check("...and she no longer carries it -- the entry is dropped and "
            + "neither bit is left in the word",
            a.civ?.items.length === 0
            && (a.civ.wait & (0x800000 | 0x400000)) === 0,
            `items ${JSON.stringify(a.civ?.items)} `
            + `wait 0x${a.civ?.wait.toString(16)}`);
      check("...having been drawn on the frame she gave it, as the engine "
            + "draws before it calls the record's routine",
            drawnThen === "[0]", `drawn ${drawnThen}`);
      cFrame(a, events);
      check("...and not on the next",
            JSON.stringify(a.civ?.heldDrawn) === "[]",
            JSON.stringify(a.civ?.heldDrawn));
      const m = markers()[0];
      check("the paid life raises SpawnLifeGrantedMarker's marker: player "
            + "0's slot, centred with one attacker, 120 px low, 32 px a unit",
            markers().length === 1 && m.slot === 0x1256 + p && m.x === 0
            && m.z === -1 && m.y === Math.fround(-120 / PX)
            && m.scale === Math.fround(32 / PX) && m.frames === 120,
            JSON.stringify(markers()));
      // `LifeGrantedMarkerUpdate` (`FUN_0048DFE0`): draw, then count down;
      // `AssetDrawSlotWithAlpha` at `frames / 6` once `frames < 6.0`, and
      // `ActorKill` after the draw at 1 -- 120 frames drawn in all.
      const drawn: (number | null)[] = [];
      for (let i = 0; i < 125 && markers().length; i++) {
        LifeGrantedMarkersTick();
        if (markers().length) drawn.push(markers()[0].drawnAlpha);
      }
      check("...drawn for 120 frames, the last five faded by sixths, then gone",
            drawn.length === 120 && drawn.slice(0, 115).every((x) => x === null)
            && drawn.slice(115).join() === [5, 4, 3, 2, 1]
              .map((k) => Math.fround(k * Math.fround(1 / 6))).join()
            && markers().length === 0,
            `${drawn.length} frames, tail ${drawn.slice(113).join()}`);
    }

    // Two players: the captor's killer, `obj+0x131C` through the prune.
    // Player **1** fires, so a life for player 0 cannot pass.
    {
      const { a, kids, events } = civScene([[
        cmd(CivilianOp.Wait, CivilianWait.Free),
        { op: CivilianOp.AddHeldItem, args: [0x0056b190, 0x800000], item: 0 },
        cmd(CivilianOp.SetChildrenGoal, 0),
        cmd(CivilianOp.Wait, CivilianWait.ChildrenAlive),
        cmd(CivilianOp.Wait, GIVE_WORD),
        cmd(CivilianOp.Wait, 0),
        cmd(CivilianOp.End),
      ]], [0x4100], [LIFE]);
      JoinPlayerTwo();
      const lives = [...G.g_player_lives];
      for (let i = 0; i < 4; i++) cFrame(a, events);
      check("two players: the item waits for the captor",
            a.civ?.items.length === 1, JSON.stringify(a.civ?.items));
      kids[0].hp = 1;
      ResolveHit(kids[0], 1, NULL_HOST, rng, 1);
      for (let i = 0; i < 3; i++) cFrame(a, events);
      check("...and the life goes to the player who shot it, and to nobody "
            + "else",
            G.g_player_lives[1] === lives[1] + 1
            && G.g_player_lives[0] === lives[0] && a.civ?.items.length === 0,
            `lives ${lives.join("/")} -> ${G.g_player_lives.join("/")}, `
            + `sub+0x6C ${a.civ?.rescuePlayer}`);
      const m = markers()[0];
      check("...whose marker is player 1's slot, 160 px to the right",
            markers().length === 1 && m.slot === 0x1257
            && m.x === Math.fround(160 / PX),
            JSON.stringify(markers()));
    }

    // At the cap: 300 points instead, no marker -- and the item still goes.
    {
      const { a, events } = civScene([give()], [], [LIFE]);
      const p = G.g_active_player;
      G.g_player_lives[p] = G.g_max_lives ?? 5;
      const score0 = G.g_player_score[p];
      for (let i = 0; i < 20; i++) cFrame(a, events);
      check("at g_max_lives the item pays 300 and no life, raises no marker, "
            + "and is still handed over",
            G.g_player_lives[p] === 5 && G.g_player_score[p] === score0 + 300
            && markers().length === 0 && a.civ?.items.length === 0,
            `lives ${G.g_player_lives[p]} score ${G.g_player_score[p]} `
            + `markers ${markers().length} items ${a.civ?.items.length}`);
    }

    // The other thirteen records: `CivilianHeldItemGrantOriginalItem`
    // (`FUN_0048DD60`) counts the kind into `g_original_items_taken` and
    // raises its banner -- in any mode.
    {
      const { a, events } = civScene([[
        cmd(CivilianOp.Wait, 0),
        { op: CivilianOp.PickHeldItem, args: [1], itemTable: [[1, 1]] },
        { op: CivilianOp.AddPickedItem, args: [0x800000] },
        cmd(CivilianOp.SetTimer, 5),
        cmd(CivilianOp.Wait, GIVE_WORD),
        cmd(CivilianOp.Wait, 0),
        cmd(CivilianOp.End),
      ]], [], [LIFE, ORIGINAL]);
      const taken = G.g_original_items_taken[4] ?? 0;
      const lives0 = [...G.g_player_lives];
      for (let i = 0; i < 20; i++) cFrame(a, events);
      const b = G.g_original_item_banners.at(-1);
      check("an Original Mode item is counted, bannered and taken away, and "
            + "pays no life",
            G.g_original_items_taken[4] === taken + 1 && b?.sprite === 0x5c1
            && a.civ?.items.length === 0
            && G.g_player_lives.join() === lives0.join(),
            `taken ${taken} -> ${G.g_original_items_taken[4]}, banner `
            + `${b?.sprite} items ${a.civ?.items.length}`);
    }
  }

  // `sub+0x82`: one record, six attach sets, chosen by the character type.
  {
    check("the attach set comes from the character type",
          CivilianAttachSet(0x20) === 0 && CivilianAttachSet(0x24) === 4
          && CivilianAttachSet(0x26) === 1 && CivilianAttachSet(0x27) === 2
          && CivilianAttachSet(0x2e) === 3 && CivilianAttachSet(0x99) === 5);
  }

  // Op 0x11's skip count, which is what `CivilianReapplyWaitCommand` is for:
  // the skipped block's *conditions* are re-applied and its actions are not
  // -- and they are re-applied **for the step's own loop**, which puts eight
  // of them back on every way out (`0x0048B6DC`). This used to assert the
  // skipped goal was still there afterwards, which was the port's restore
  // running only when nothing had resumed.
  //
  // So: the Init block sets goals 2 and 7 and a skip of one. The skipped
  // block raises the enemy goal to 5; the block after it waits while more
  // than that many enemies are present, and three are -- so the loop passes
  // it in the same frame **because of** the skipped 5 (with the 2 it would
  // hold), walking its civilian goal of 9 on the way. Then the step returns
  // and both goals read 2 and 7 again, which is what the block the cursor
  // lands on runs under; neither passed block's action ran.
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, CivilianWait.Free),
      cmd(CivilianOp.SetEnemiesGoal, 2),
      cmd(CivilianOp.SetCiviliansGoal, 7),
      cmd(CivilianOp.SetSkipCount, 1),
      cmd(CivilianOp.Wait, 0),                  // 4: skipped by op 0x11
      cmd(CivilianOp.SetMotionBlend, 66),       //    an action: never run
      cmd(CivilianOp.SetEnemiesGoal, 5),        //    a condition: re-applied
      cmd(CivilianOp.Wait, CivilianWait.EnemiesPresent),   // 7: passed
      cmd(CivilianOp.SetCiviliansGoal, 9),
      cmd(CivilianOp.SetMotionBlend, 44),
      cmd(CivilianOp.Wait, 0),                  // 10: the block it runs
      cmd(CivilianOp.End),                      // 11: where that parks
    ]]);
    G.g_enemies_present = 3;
    check("the Init block sets its goals and parks on the skipped block",
          a.civ?.cursor === 4 && a.civ?.enemiesGoal === 2
          && a.civ?.civiliansGoal === 7,
          `cursor ${a.civ?.cursor} goals ${a.civ?.enemiesGoal}/`
          + `${a.civ?.civiliansGoal}`);
    cFrame(a, events);
    // Held at 7, the action VM would have run 7's block and parked on 10.
    check("a skipped block's goal is live inside the step: the next wait "
          + "passes on it in the same frame", a.civ?.cursor === 11,
          `cursor ${a.civ?.cursor}`);
    check("...and the step puts the goals back on its way out",
          a.civ?.enemiesGoal === 2 && a.civ?.civiliansGoal === 7,
          `goals ${a.civ?.enemiesGoal}/${a.civ?.civiliansGoal}`);
    check("...and runs no passed block's actions",
          a.civ?.motionBlend !== 66 && a.civ?.motionBlend !== 44,
          `blend ${a.civ?.motionBlend}`);
  }

  // **Op 0x06 sets the point and not the mode.** `MOV dword ptr [EAX + 0x44]`
  // at `0x0048BC93`, and `[ECX + 0x44]` at `0x0048B84E` in the reapply walk:
  // the pointer lands in `sub+0x44`, the three words it names in
  // `sub+0x30..0x38`, and `sub+0x40` -- the mode the turn runs on -- is not
  // written. Every shipped op 0x06 sits in a block waiting on `InFront`, the
  // test that reads `sub+0x30` raw, with the mode at 0: the civilian walks past
  // the point on her own clip and never turns to it. The port wrote the
  // pointer into the mode too, so each of them turned toward it.
  {
    const P = [0, 0, -100];
    const ptr = 5683752;                     // stage 1 stream 3's, cmd 10
    // Mode 0, the shipped shape: nothing may turn her.
    {
      const { a, events } = civScene([[
        cmd(CivilianOp.Wait, 0),
        { op: CivilianOp.SetTargetPoint, args: [ptr],
          point: P as [number, number, number] },
        cmd(CivilianOp.Wait, 0),
        cmd(CivilianOp.End),
      ]]);
      a.yaw = 0x4000;                        // P is 90 degrees off her facing
      for (let i = 0; i < 20; i++) cFrame(a, events);
      check("op 0x06 leaves the target mode at 0, so nothing turns her...",
            a.civ?.targetMode === CivilianTarget.None && a.yaw === 0x4000,
            `mode ${a.civ?.targetMode} yaw 0x${a.yaw.toString(16)}`);
      check("...and still sets the point the in-front test reads",
            a.civ?.target.x === 0 && a.civ?.target.z === -100,
            `target ${JSON.stringify(a.civ?.target)}`);
    }
    // A mode already set -- the camera, -1 -- stands through op 0x06 in both
    // VMs: the action VM running the block, and the reapply walk the step
    // runs over it first.
    {
      const { a, events } = civScene([[
        cmd(CivilianOp.Wait, CivilianWait.Free),
        { op: CivilianOp.SetTarget, args: [CivilianTarget.Camera, 0],
          radius: 5 },
        cmd(CivilianOp.Wait, CivilianWait.InFront),
        { op: CivilianOp.SetTargetPoint, args: [ptr],
          point: P as [number, number, number] },
        cmd(CivilianOp.Wait, 0),
        cmd(CivilianOp.End),
      ]]);
      check("a mode set before op 0x06 is the camera's",
            a.civ?.targetMode === CivilianTarget.Camera,
            `mode ${a.civ?.targetMode}`);
      const at = CivilianReapplyWaitCommand(a, a.civ?.script ?? 0, 2);
      check("the reapply walk's op 0x06 leaves it standing",
            at === 4 && a.civ?.targetMode === CivilianTarget.Camera
            && a.civ?.target.z === -100,
            `at ${at} mode ${a.civ?.targetMode} `
            + `target ${JSON.stringify(a.civ?.target)}`);
      cFrame(a, events);
      check("...and so does the action VM's, once the block runs",
            a.civ?.cursor === 4 && a.civ?.targetMode === CivilianTarget.Camera,
            `cursor ${a.civ?.cursor} mode ${a.civ?.targetMode}`);
    }
  }

  // **Op 0x10 calls a routine; the routine installs a step.** The operand of
  // op 0x10 names an *install* routine, both VMs call it as `hook(obj, cmd +
  // 2)`, and what lands in `sub+0x5C` is the step it writes -- which
  // `CivilianUpdate` calls at `0x0048A962`. Read in full: `CivilianHookStartFall`
  // (`FUN_0048D9F0`), `CivilianHookFallStep` (`FUN_0048DA20`),
  // `CivilianHookStartMoveY` (`FUN_0048DB90`) and its step `FUN_0048DBC0`,
  // `CivilianHookStartMoveLocal` (`FUN_0048DBD0`) and its step `FUN_0048DC10`.
  // The port stored the operand itself, inlined three installs into the action
  // VM with the fall's gravity for all three, and ran the fall step -- which it
  // also had moving x and z and zeroing the velocity -- for every one of them.
  //
  // The addresses are the exe's, written as literals so this block reads the
  // same against any revision of the port.
  {
    const HOOK_START_FALL = 0x0048d9f0, HOOK_RIDE_CHILDREN = 0x0048da90;
    const HOOK_START_MOVE_Y = 0x0048db90, HOOK_START_MOVE_LOCAL = 0x0048dbd0;
    const STEP_NONE = 0x0041ebb0;              // NoOpStub
    const STEP_FALL = 0x0048da20, STEP_RIDE = 0x0048dab0;
    const STEP_MOVE_Y = 0x0048dbc0, STEP_MOVE_LOCAL = 0x0048dc10;
    const f32 = (bits: number): number => {
      const d = new DataView(new ArrayBuffer(4));
      d.setUint32(0, bits >>> 0, true);
      return d.getFloat32(0, true);
    };
    // `MOV dword ptr [EDX + 0x1C], 0xBCDF0123` at `0x0048DA13`.
    const FALL_G = f32(0xbcdf0123);
    // The shipped operands: -0.2 (streams 61, 67, 71) and -0.05 (stream 72).
    const M02 = 0xbe4ccccd, M005 = 0xbd4ccccd;
    const savedEye = G.g_camera_fixed_eye_y;

    // The fall. Wait bit 0x400 holds the block on `sub+0x18`.
    {
      const { a, events } = civScene([[
        cmd(CivilianOp.Wait, CivilianWait.Hook),
        cmd(CivilianOp.SetHook, HOOK_START_FALL),
        cmd(CivilianOp.Wait, 0),
        cmd(CivilianOp.SetMotionBlend, 55),
        cmd(CivilianOp.Wait, 0),
        cmd(CivilianOp.End),
      ]]);
      G.g_camera_fixed_eye_y = 0;              // no coli: the ground is 0
      check("(fixture) the ground under the fall is at 0",
            QueryGroundHeightAt(0, 110, 0) === 0,
            `${QueryGroundHeightAt(0, 110, 0)}`);
      check("op 0x10 calls CivilianHookStartFall: the slot holds its STEP, "
            + "vel.y 0, and obj+0x5C the exe's exact float",
            a.civ?.hook === STEP_FALL && a.vel.y === 0 && a.accY === FALL_G
            && a.civ?.hookDone === 0,
            `hook 0x${a.civ?.hook.toString(16)} vel.y ${a.vel.y} `
            + `accY ${a.accY} done ${a.civ?.hookDone}`);
      a.pos = vec3(0, 10, 0);
      a.vel.x = 0.5; a.vel.z = -0.25;         // an op 0x26 move's leftovers
      cFrame(a, events);
      const y1 = Math.fround(10 + Math.fround(FALL_G));
      check("the fall step moves y by the accelerated velocity...",
            a.pos.y === y1, `y ${a.pos.y} want ${y1}`);
      check("...and y only: x and z stay where they were",
            a.pos.x === 0 && a.pos.z === 0 && a.vel.x === 0.5
            && a.vel.z === -0.25,
            `pos ${JSON.stringify(a.pos)} vel ${JSON.stringify(a.vel)}`);
      // From the routine: v += g; y += v; land when the ground is at or above
      // the new y. With g = -0.0272222 from y = 10 that is n(n+1)/2 * g <= -10,
      // first true at n = 27.
      let v = Math.fround(FALL_G), y = y1, n = 1;
      while (!(0 >= y)) {
        v = Math.fround(FALL_G + v); y = Math.fround(v + y); n++;
      }
      let frames = 1;
      while (a.civ?.hook === STEP_FALL && frames < 200) {
        cFrame(a, events); frames++;
      }
      check("it lands on frame 27, where the arithmetic puts it",
            n === 27 && frames === 27, `derived ${n} ran ${frames}`);
      check("...snapped to the ground, with the step uninstalled (NoOpStub)",
            a.pos.y === 0 && a.civ?.hook === STEP_NONE,
            `y ${a.pos.y} hook 0x${a.civ?.hook.toString(16)}`);
      check("...keeping the velocity it landed with -- nothing zeroes it",
            a.vel.y === v && v < -0.7 && a.vel.x === 0.5,
            `vel ${JSON.stringify(a.vel)} want y ${v}`);
      check("...and sub+0x18 released wait bit 0x400 on that same frame",
            a.civ?.motionBlend === 55 && a.civ?.cursor === 4,
            `blend ${a.civ?.motionBlend} cursor ${a.civ?.cursor}`);
    }

    // `CivilianHookStartMoveY`: one operand into vel.y, the shadow bit, no
    // gravity -- and its step is `y += vel.y` for ever, through the floor.
    {
      const { a, events } = civScene([[
        cmd(CivilianOp.Wait, 0),
        cmd(CivilianOp.SetHook, HOOK_START_MOVE_Y, M02 | 0),
        cmd(CivilianOp.Wait, 0),
        cmd(CivilianOp.End),
      ]]);
      G.g_camera_fixed_eye_y = 0;
      check("op 0x10 calls CivilianHookStartMoveY: its own step, the operand "
            + "in vel.y, obj+0x34 bit 0x80000, and no gravity written",
            a.civ?.hook === STEP_MOVE_Y && a.vel.y === f32(M02)
            && (a.flags & 0x80000) !== 0 && a.accY === 0,
            `hook 0x${a.civ?.hook.toString(16)} vel.y ${a.vel.y} `
            + `flags 0x${a.flags.toString(16)} accY ${a.accY}`);
      a.pos = vec3(3, 10, 4);
      let y = 10;
      for (let i = 0; i < 100; i++) {
        cFrame(a, events);
        y = Math.fround(f32(M02) + y);
      }
      check("its step sinks at a constant -0.2 a frame, past the ground at 0",
            a.pos.y === y && y < -9.9 && a.vel.y === f32(M02)
            && a.pos.x === 3 && a.pos.z === 4,
            `pos ${JSON.stringify(a.pos)} want y ${y} vel.y ${a.vel.y}`);
      check("...and never uninstalls itself or raises sub+0x18",
            a.civ?.hook === STEP_MOVE_Y && a.civ?.hookDone === 0,
            `hook 0x${a.civ?.hook.toString(16)} done ${a.civ?.hookDone}`);
    }

    // `CivilianHookStartMoveLocal`: three operands into the velocity, and a
    // step that adds it **turned by the actor's rotation** --
    // Translate, RotateX(obj+0x64), RotateZ(obj+0x6C), RotateY(obj+0x68),
    // TransformPoint. Each call pre-multiplies, so the velocity meets the Y
    // turn first and the X turn last. With yaw and pitch both 0x4000 and the
    // velocity along -Z: the yaw takes (0, 0, -0.05) to (-0.05, 0, 0), and a
    // turn about X leaves an x vector alone. Taken the other way round the
    // pitch would lift it into y and the yaw would never see it.
    {
      const { a, events } = civScene([[
        cmd(CivilianOp.Wait, 0),
        cmd(CivilianOp.SetHook, HOOK_START_MOVE_LOCAL, 0, 0, M005 | 0),
        cmd(CivilianOp.Wait, 0),
        cmd(CivilianOp.End),
      ]]);
      G.g_camera_fixed_eye_y = 0;
      check("op 0x10 calls CivilianHookStartMoveLocal: its own step and the "
            + "three operands as the velocity, no gravity written",
            a.civ?.hook === STEP_MOVE_LOCAL && a.vel.x === 0 && a.vel.y === 0
            && a.vel.z === f32(M005) && a.accY === 0,
            `hook 0x${a.civ?.hook.toString(16)} vel ${JSON.stringify(a.vel)} `
            + `accY ${a.accY}`);
      a.pos = vec3(5, 0, 7);
      a.yaw = 0x4000; a.pitch = 0x4000; a.roll = 0;
      cFrame(a, events);
      check("its step moves along the turned axes: yaw first, so -Z goes to -X",
            Math.abs(a.pos.x - (5 + f32(M005))) < 1e-6
            && Math.abs(a.pos.y) < 1e-6 && Math.abs(a.pos.z - 7) < 1e-6,
            `pos ${JSON.stringify(a.pos)}`);
      for (let i = 1; i < 30; i++) cFrame(a, events);
      check("...every frame, with no ground to stop it and no uninstall",
            Math.abs(a.pos.x - (5 + 30 * f32(M005))) < 1e-4
            && Math.abs(a.pos.y) < 1e-4 && a.civ?.hook === STEP_MOVE_LOCAL,
            `pos ${JSON.stringify(a.pos)} hook 0x${a.civ?.hook.toString(16)}`);
    }

    // The reapply walk's arm, `0x0048B913`: a null operand writes nothing; any
    // other is CALLED -- its side effects land -- and then `sub+0x5C` gets
    // `NoOpStub`. `sub+0x18` is not touched either way.
    {
      const { a } = civScene([[
        cmd(CivilianOp.Wait, 0),
        cmd(CivilianOp.SetHook, HOOK_START_FALL),
        cmd(CivilianOp.Wait, 0),                            // 2
        cmd(CivilianOp.SetHook, HOOK_START_MOVE_Y, M02 | 0),
        cmd(CivilianOp.Wait, 0),                            // 4
        cmd(CivilianOp.SetHook, 0),
        cmd(CivilianOp.Wait, 0),                            // 6
        cmd(CivilianOp.End),
      ]]);
      const sub = a.civ;
      if (sub) sub.hookDone = 1;
      const at6 = CivilianReapplyWaitCommand(a, 0, 4);
      check("the reapply walk's null op 0x10 writes nothing: the fall stands",
            at6 === 6 && a.civ?.hook === STEP_FALL,
            `at ${at6} hook 0x${a.civ?.hook.toString(16)}`);
      const at4 = CivilianReapplyWaitCommand(a, 0, 2);
      check("its non-null op 0x10 CALLS the install: vel.y and the flag land",
            at4 === 4 && a.vel.y === f32(M02) && (a.flags & 0x80000) !== 0
            && a.accY === FALL_G,
            `at ${at4} vel.y ${a.vel.y} flags 0x${a.flags.toString(16)} `
            + `accY ${a.accY}`);
      check("...and then takes the step it installed back out (NoOpStub), "
            + "leaving sub+0x18 alone",
            a.civ?.hook === STEP_NONE && a.civ?.hookDone === 1,
            `hook 0x${a.civ?.hook.toString(16)} done ${a.civ?.hookDone}`);
    }

    // The action VM's arm, `0x0048BD81`: null is `NoOpStub` and nothing else;
    // non-null is the call and then `sub+0x18 = 0`.
    {
      const { a } = civScene([[
        cmd(CivilianOp.Wait, 0),
        cmd(CivilianOp.SetHook, HOOK_RIDE_CHILDREN),
        cmd(CivilianOp.Wait, 0),                            // 2
        cmd(CivilianOp.SetHook, 0),
        cmd(CivilianOp.Wait, 0),                            // 4
        cmd(CivilianOp.End),
      ]]);
      check("CivilianHookRideChildren installs CivilianHookRideChildrenStep",
            a.civ?.hook === STEP_RIDE, `hook 0x${a.civ?.hook.toString(16)}`);
      const sub = a.civ;
      if (sub) sub.hookDone = 1;
      CivilianRunScript(a, 0, 2);
      check("the action VM's null op 0x10 is NoOpStub, and sub+0x18 stands",
            a.civ?.hook === STEP_NONE && a.civ?.hookDone === 1,
            `hook 0x${a.civ?.hook.toString(16)} done ${a.civ?.hookDone}`);
      CivilianRunScript(a, 0, 0);
      check("...and a non-null one puts sub+0x18 down after the call",
            a.civ?.hook === STEP_RIDE && a.civ?.hookDone === 0,
            `hook 0x${a.civ?.hook.toString(16)} done ${a.civ?.hookDone}`);
    }
    G.g_camera_fixed_eye_y = savedEye;
  }

  // **A camera target on a carrier is taken into the carrier's frame, and the
  // turn and the step take it there differently.** Both test `obj[0] ==
  // CivilianUpdateOnCarrier` (`0x0048C8C1`, `0x0048B39D`), push, make the
  // carrier's `T RotX RotZ RotY`, invert and transform the eye. The turn
  // loads the identity first (`0x0048C8D4`), so it gets the camera in her
  // frame, C^-1 eye. The step does not (`0x0048B3B0` push, `0x0048B3C0`
  // translate), so it inverts the view `UpdateSceneViewAndLight` left on the
  // stack, the update's own push of the carrier, and its own:
  // (V C C)^-1 eye. The port used the world eye in both, against a
  // carrier-relative position.
  //
  // Worked by hand from the engine's calls. `MatrixRotateY(0x4000)`
  // (`FUN_004A9AE0`: row0' = -row2, row2' = row0) sends (x, z) to (z, -x),
  // so a boat at P = (10, 0, 0) turned a quarter is C(x) = P + Ry(x). A
  // camera block at E = (0, 0, 50) with no angles builds V(x) = x - E. Her
  // own position is her carrier's origin.
  {
    const riderScene = (cmds: CivilianCmdJson[]) => {
      ResetGameGlobals();
      EnterPlay();
      SetGameTables(CHARS, undefined, undefined, undefined, undefined, {
        entries: [0], scripts: [cmds], items: [],
        spawns: { "16384": { charType: 1, script: 0, removePath: -1,
                             removeFrame: 0, removeDelay: 0, children: [] } },
      });
      const boat = ActorSpawn(0x9e00, SpawnClass.ScriptedProp, -1, "boat", {
        class13: { slot: 6711, cam_path: -1, cam_frame: -1, scale: 1,
                   behaviour: 0, selector: 0 },
      }, rng);
      boat.pos = vec3(10, 0, 0);
      boat.yaw = 0x4000;
      G.g_civilian_carrier = boat.at;
      // `obj+0x11C != 0` is what installs `CivilianUpdateOnCarrier`.
      const a = ActorSpawn(0x4000, SpawnClass.Civilian, 1, "rider",
                           { hp: 1 }, rng);
      a.visible = true;
      a.pos = vec3(0, 0, 0);
      G.g_camera_block_eye = vec3(0, 0, 50);
      UpdateSceneViewAndLight();
      return { a, boat, events: new Events() };
    };
    // The word a Wait carries governs the park that follows it (L85), so the
    // Init loads the reach word itself and parks on the next wait with the
    // mode set: stage 3's script 25 in two commands -- cmd 5's target, 18
    // units, and cmd 6's reach bit.
    const reach = (): CivilianCmdJson[] => [
      cmd(CivilianOp.Wait, CivilianWait.Reach),
      { op: CivilianOp.SetTarget, args: [CivilianTarget.Camera, 0],
        radius: 18 },
      cmd(CivilianOp.Wait, 0),                  // 2: parked on the reach
      cmd(CivilianOp.SetMotionBlend, 44),       //    run once it is over
      cmd(CivilianOp.Wait, 0),                  // 4
      cmd(CivilianOp.End),
    ];
    {
      const { a } = riderScene(reach());
      const v = G.g_camera_world_to_view;
      check("the rider rides, parked on the reach word with the camera "
            + "mode, under a view of x - (0, 0, 50)",
            a.carrierAt === 0x9e00 && a.civ?.cursor === 2
            && a.civ?.wait === CivilianWait.Reach
            && a.civ?.targetMode === CivilianTarget.Camera
            && v[12] === 0 && v[13] === 0 && v[14] === -50 && v[0] === 1,
            `carrier ${a.carrierAt} cursor ${a.civ?.cursor} `
            + `wait 0x${a.civ?.wait.toString(16)} mode ${a.civ?.targetMode} `
            + `view row 3 ${v.slice(12, 15)}`);
    }
    // V C C (0) = P + Ry(P) - E = (10, 0, 0) + (0, 0, -10) - (0, 0, 50):
    // an eye at (10, 0, -60) is exactly where she stands, in the step's frame.
    // The world eye is 60.8 away and C^-1 eye = (60, 0, 0) is 60 away.
    {
      const { a, events } = riderScene(reach());
      G.g_camera_eye = vec3(10, 0, -60);
      cFrame(a, events);
      check("the step's reach is measured against (V C C)^-1 eye: an eye "
            + "that lands on her there releases the wait",
            a.civ?.cursor === 4 && a.civ?.motionBlend === 44
            && a.civ?.targetMode === CivilianTarget.None,
            `cursor ${a.civ?.cursor} blend ${a.civ?.motionBlend} `
            + `mode ${a.civ?.targetMode}`);
    }
    // And from the other side: an eye at P, where C^-1 eye is her own origin
    // and the world eye is 10 away -- both inside 18 -- is (0, 0, -60) in
    // the step's frame, so the wait holds.
    {
      const { a, events } = riderScene(reach());
      G.g_camera_eye = vec3(10, 0, 0);
      cFrame(a, events);
      check("...and an eye in her own frame's origin does not: the step does "
            + "not load the identity the turn does",
            a.civ?.cursor === 2 && a.civ?.motionBlend !== 44
            && a.civ?.targetMode === CivilianTarget.Camera,
            `cursor ${a.civ?.cursor} blend ${a.civ?.motionBlend} `
            + `mode ${a.civ?.targetMode}`);
    }
    // The turn: an eye at (10, 0, 60) is C^-1 eye = Ry^-1(0, 0, 60) =
    // (-60, 0, 0) in her frame, a quarter turn one way; the world eye was
    // most of a half turn the other. One frame is the cap, 0x100.
    {
      const { a, events } = riderScene([
        cmd(CivilianOp.Wait, CivilianWait.Free),
        { op: CivilianOp.SetTarget, args: [CivilianTarget.Camera, 0],
          radius: 18 },
        cmd(CivilianOp.Wait, 0),
        cmd(CivilianOp.End),
      ]);
      G.g_camera_eye = vec3(10, 0, 60);
      a.yaw = 0;
      cFrame(a, events);
      check("the turn faces C^-1 eye, the camera in the carrier's frame",
            a.yaw === 0x100 && a.civ?.targetMode === CivilianTarget.Camera,
            `yaw 0x${a.yaw.toString(16)} mode ${a.civ?.targetMode}`);
    }
  }

  // **Does a dead civilian leave `g_civilians_alive`?** This is the counter
  // `wait_scripted_actors` blocks on, and a civilian that dies without leaving
  // it parks the script for ever. `CivilianInit` raises the count
  // unconditionally; the way back out on a death is the on-shot script's own
  // `Wait` word carrying `LeaveCountNow` -- and 59 of the 60 streams the shipped
  // scripts use as a death script do carry it, so this is the path that matters.
  {
    const cmdS = (op: CivilianOp, scripts: number[],
                  ...args: number[]): CivilianCmdJson => ({ op, args, scripts });

    // Stream 0 is the life, stream 1 the death. The death stream leaves the
    // count the way the game's own death scripts do.
    const { a, events } = civScene([
      [cmd(CivilianOp.Wait, 0),
       cmdS(CivilianOp.SetOnShot, [1], 1),
       cmd(CivilianOp.Wait, 0)],
      [cmd(CivilianOp.Wait, CivilianWait.LeaveCountNow),
       cmd(CivilianOp.End)],
    ]);
    cFrame(a, events);
    check("a civilian in play is counted", G.g_civilians_alive === 1,
          `${G.g_civilians_alive}`);


    // What the maul does to it: `ZombieStateTargetMotionScript` raises the same
    // bit a killing shot raises on the civilian's `obj+0x34`.
    a.flags |= ActorFlag.Dead;
    cFrame(a, events);
    check("...and leaves the count when it is killed",
          G.g_civilians_alive === 0, `${G.g_civilians_alive} still counted`);

    // And it does not leave twice: the removal that follows a death must not
    // decrement again, or the count goes negative and a later `wait_scripted_
    // actors` passes while civilians are still standing.
    for (let i = 0; i < 8; i++) cFrame(a, events);
    check("...exactly once, however long it lies there",
          G.g_civilians_alive === 0, `${G.g_civilians_alive}`);
  }
  // **The record fills the object, then `Init` runs — in that order.**
  // `SpawnFromDescriptor` (`FUN_00408A20`) does it that way, and
  // `CivilianInit` (`FUN_0048A3E0`) runs the civilian's script as its last
  // act, so the script's opening `SetMotion` is what the actor plays. The
  // player was assigning the placement's own motion *after* `ActorSpawn`
  // returned, which put it straight back: every civilian in the game stood in
  // its spawn pose -- a hostage on 660 rather than the 371 her script asks for
  // -- while her script ran on underneath it.
  {
    civScene([[cmd(CivilianOp.Wait, 0),
               cmd(CivilianOp.SetMotion, 10, -1),
               cmd(CivilianOp.Wait, 0)]]);
    const posed = ActorSpawn(0x4000, SpawnClass.Civilian, 1, "posed",
                             { motion: 900 }, new Rng(3));
    check("the class Init's motion outlives the record's",
          posed.motion === 10, `motion ${posed.motion}`);
  }

  // **The leave frees the hit slot by its index.** `CivilianUpdate`'s tail
  // does `if (obj+0x3C != -1) g_hit_slots[obj+0x3C] = 0` at `0x0048B085`
  // before the count and the despawn, testing the index and not `obj+0x38`
  // bit 0x40 -- so with the claim bit down, that write is the only one that
  // can give the entry back. The port said the table was not modelled and
  // left it to `ActorDespawn`'s release, which tests the bit.
  {
    civScene([[cmd(CivilianOp.Wait, 0)]]);
    const c = ActorSpawn(0x4010, SpawnClass.Civilian, 1, "leaving", {},
                         new Rng(3));
    const slot = c.hitSlot;
    c.flags38 &= ~HIT_SLOT_CLAIMED;
    CivilianLeaveField(c);
    check("a civilian that leaves the field gives its hit slot back",
          slot !== HIT_SLOT_NONE && G.g_hit_slots[slot] === HIT_SLOT_NONE
          && c.despawned,
          `slot ${slot} entry ${G.g_hit_slots[slot]} gone ${c.despawned}`);
  }

  // **`LAB_0048b52e` is one label reached from three places.** The in-front
  // test, the camera cue and the timer sit together at the bottom of
  // `CivilianStepScript` (`FUN_0048B1E0`), and all three arrival arms fall
  // into them — a word with neither `Reach` nor `Face` jumps straight there.
  // The port had that tail written out twice with the in-front test in only
  // one copy, so a word carrying `InFront` alone ran no test at all and could
  // be released by nothing but a timer it did not have. Stage 2's `0x138BC`
  // held `g_civilians_alive` at one and `wait_scripted_actors` at block 30
  // never came down.
  {
    // A wait word leads its block and governs the wait that *follows* it, so
    // the in-front word has to be the first command: the Init then parks on
    // the wait at index 1 with that word governing it.
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, CivilianWait.InFront),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetMotionBlend, 77),
      cmd(CivilianOp.Wait, 0),
    ]]);
    // The target is behind her, so the wait holds...
    a.pos = vec3(0, 0, 0);
    a.yaw = 0;
    // Behind her: the rotated delta's z is negative at yaw 0. `targetMode` is
    // left at `None` so the turn step does not run and this is the in-front
    // test on its own.
    if (a.civ) {
      a.civ.target = { x: 0, y: 0, z: -30 };
      a.civ.targetMode = CivilianTarget.None;
    }
    const before = a.civ?.cursor;
    cFrame(a, events);
    check("an in-front wait holds while the target is behind",
          a.civ?.cursor === before && a.civ?.motionBlend !== 77,
          `cursor ${a.civ?.cursor}`);
    // ...and releases the frame it is in front, with no timer involved.
    a.yaw = 0x8000;                              // half a turn: now in front
    cFrame(a, events);
    check("...and releases the frame it comes round, timer or no timer",
          a.civ?.motionBlend === 77, `turn ${a.civ?.motionBlend}`);
  }

  // **The civilian turn cap is a literal, and it is not the script's.**
  // `CivilianStepTurnToTarget` (`FUN_0048C850`) passes `0x100` to
  // `ActorTurnTowardPoint` and never reads `sub+0x0E`; the port passed that
  // field, whose default is ten. Twenty-five times too slow is the difference
  // between a civilian turning round in a couple of seconds and taking most of
  // a minute, and stage 2's `0x138BC` had a `Face` wait behind a 194-degree
  // turn — `wait_scripted_actors` at block 30 waited the whole time.
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, CivilianWait.Face),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetMotionBlend, 55),
      cmd(CivilianOp.Wait, 0),
    ]]);
    a.pos = vec3(0, 0, 0);
    a.yaw = 0;
    if (a.civ) {
      // 0x8A00 is 194 degrees — the turn her own `SetTargetHeading` asks for.
      const h = 0x8a00 * ((Math.PI * 2) / 65536);
      a.civ.target = { x: Math.sin(h) * 100, y: 0, z: Math.cos(h) * 100 };
      a.civ.targetMode = 1;
    }
    let frames = 0;
    while (frames < 3000 && a.civ?.motionBlend !== 55) {
      cFrame(a, events);
      frames += 1;
    }
    check("a civilian turns at the engine's cap, not the script's rate",
          a.civ?.motionBlend === 55 && frames < 200, `${frames} frames`);
  }


  // **The debug clear has to kill what the civilian gate counts too.** A room
  // cleared of enemies with the hostages still standing is a script that has
  // not moved: `wait_scripted_actors` counts civilians, not enemies. Killing
  // one is not `dead = true` either — `CivilianCheckShot` reads
  // `ActorFlag.Dead` and runs her killed script off it, and that script is
  // what carries `LeaveCountNow`.
  {
    const { a, events } = civScene([
      [cmd(CivilianOp.Wait, 0), cmdKill([1], 1), cmd(CivilianOp.Wait, 0)],
      [cmd(CivilianOp.Wait, CivilianWait.LeaveCountNow), cmd(CivilianOp.End)],
    ]);
    cFrame(a, events);
    check("a civilian is in the count before the clear",
          G.g_civilians_alive === 1, `${G.g_civilians_alive}`);

    const cleared = ActorKillAll(new Rng(2));
    check("the clear counts her as a civilian, not an enemy",
          cleared.civilians === 1 && cleared.enemies === 0,
          JSON.stringify(cleared));
    // **And what a shot could not touch, the clear must not touch either.**
    // A civilian with no on-shot script has its hit bits cleared every frame by
    // `CivilianCheckShot` — the ones behind glass — so no player can kill it.
    // The clear killing it anyway strands it: dead, still counted in
    // `g_civilians_alive`, and with no killed script to run the
    // `LeaveCountNow` that would take it out. Stage 2's `0x138BC` is one, and
    // it held `wait_scripted_actors` open for ever.
    {
      const safe = ActorSpawn(0x4020, SpawnClass.Civilian, 1, "behind glass");
      safe.visible = true;
      if (safe.civ) safe.civ.onShotScript = -1;
      ActorKillAll(new Rng(4));
      // **A civilian the script stops listing leaves the count with it.** The
    // engine has no such moment — every one of `ActorDespawn`'s 171 call sites
    // is inside a class's own state machine — so `RetireUnlistedActor` is the
    // port's seam for a spawn list entry going away, and it runs the class's
    // own leave routine rather than inventing one. Unmaking used to be a hide:
    // the actor stayed in the pool, invisible and still counted, and
    // `wait_scripted_actors` held on a number nothing could bring down.
    {
      const before = G.g_civilians_alive;
      // The fixture has one civilian record, so this borrows it: what is being
      // measured is the count, not the address.
      const going = ActorSpawn(0x4000, SpawnClass.Civilian, 1, "unlisted");
      going.visible = true;
      check("a civilian joins the count when it is made",
            G.g_civilians_alive === before + 1, `${G.g_civilians_alive}`);
      RetireUnlistedActor(going);
      check("...and leaves it when the script stops listing it",
            G.g_civilians_alive === before && going.despawned,
            `${G.g_civilians_alive} despawned ${going.despawned}`);
      // Calling it twice **would** count it out twice, and the engine is no
      // different: `CivilianUpdate`'s tail guards on `sub+0x04` bit 0, which
      // op 0x2C's `LeaveCountNow` sets and a despawn does not. Not doing it
      // twice is the caller's job, and `CharacterLayer.syncSpawns` hands back
      // only the actors that had not already removed themselves.
    }

    check("the clear leaves a civilian no shot could reach alive",
            !safe.dead && (safe.flags & ActorFlag.Dead) === 0,
            `dead ${safe.dead} flags 0x${safe.flags.toString(16)}`);
      safe.visible = false;
    }

    check("...and raises the bit her own machine reads",
          (a.flags & ActorFlag.Dead) !== 0, `flags 0x${a.flags.toString(16)}`);
    // The shared directional death is class 0x30's, from its state 6. Handed
    // to a civilian it stops `ActorAdvanceMotion` before the base clock, so
    // the killed script's own motion cue could never fire.
    check("...but not the shared death clip, which is not hers",
          a.death === null, `death ${JSON.stringify(a.death)}`);

    // Her *killed script* is the thing to assert, not the count: the fixture's
    // removal cue drains that on its own, so a count check here passes with
    // the flag removed and proves nothing.
    cFrame(a, events);
    check("so her own killed script is what runs", a.civ?.script === 1,
          `stream ${a.civ?.script}`);
  }

  // Op 0x19 -- `g_script_branch_var = (s16)cmd[1]`, which is how the game
  // decides which way a branching stage goes. Eleven of the 136 shipped
  // streams run it, all eleven pass 1, and all eleven put it after the
  // `SetOnShot 0` that makes the civilian safe: a rescued civilian takes the
  // alternate route.
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetOnShot, 0),
      cmd(CivilianOp.SetRouteBranch, 1),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]]);
    check("a rescued civilian writes the route branch",
          G.g_script_branch_var === 1, String(G.g_script_branch_var));
    // Nothing else in the port writes it, so the actor really is the source.
    for (let i = 0; i < 10; i++) cFrame(a, events);
    check("...and nothing in the port's frame walks it back",
          G.g_script_branch_var === 1, String(G.g_script_branch_var));
  }

  // The store is a **word**. The command is a dword and no shipped stream
  // needs the difference, but a port that widened it would be inventing a
  // route index the engine cannot express.
  {
    civScene([[
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetRouteBranch, 0x1_0002),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]]);
    check("the branch write is truncated to s16, as `MOV word ptr` is",
          G.g_script_branch_var === 2, String(G.g_script_branch_var));
    civScene([[
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetRouteBranch, 0xFFFF),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]]);
    check("...and sign-extended, so 0xFFFF is -1 and not 65535",
          G.g_script_branch_var === -1, String(G.g_script_branch_var));
  }

  // **Does a civilian's clip carry her?**
  //
  // The director gives every visible actor `ActorAdvanceMotion` and then its
  // class handler, so that is the pair driven here — `cFrame` alone is the VM
  // and the VM does not touch the position. Everything below asserts on
  // `a.pos`, because "the port thinks root motion is on" is the question the
  // last round of this got right while the civilians stood still.
  const cWalk = (a: ReturnType<typeof ActorSpawn>, events: Events,
                 frames: number) => {
    const z0 = a.pos.z, x0 = a.pos.x;
    for (let i = 0; i < frames; i++) {
      ActorAdvanceMotion(a, 1 / 60);
      cFrame(a, events);
    }
    return { dz: a.pos.z - z0, dx: a.pos.x - x0 };
  };
  // Motion 12 is `motion(16, 1.289)` — sixteen frames running along -Z, the
  // clip the zombie's own root-motion test uses. A civilian playing it with
  // `loops = -1` plays it for ever.
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, CivilianWait.RootMotion),
      cmd(CivilianOp.SetMotion, 12, -1),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]]);
    const gate = a.motionFlags & MotionFlag.RootMotion;
    const d = cWalk(a, events, 120);
    check("a civilian's clip carries her: two seconds of motion 12 walks -Z",
          gate !== 0 && d.dz < -10 && Math.abs(d.dx) < 0.01,
          `gate ${gate} dz ${d.dz.toFixed(3)} dx ${d.dx.toFixed(3)}`);
  }
  // The other half of the same switch, and the reason the first assertion is
  // not enough on its own: `CivilianRunScript` op 0x00 *clears* `model+0x64`
  // bit 1 when the block's wait word has no `0x00100000`, and 307 of the 596
  // shipped wait words do not. Those clips animate in place.
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetMotion, 12, -1),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]]);
    const gate = a.motionFlags & MotionFlag.RootMotion;
    const d = cWalk(a, events, 120);
    check("...and a block without the bit plays the same clip in place",
          gate === 0 && d.dz === 0 && d.dx === 0,
          `gate ${gate} dz ${d.dz.toFixed(3)} dx ${d.dx.toFixed(3)}`);
  }
  // **The bug this pair was written for.** `SetHudShutterState`,
  // `SetAttachMode`, `SetAttachTarget` and `SetPairA` all used to fall through
  // into `SetScale`'s body — so their operands, small integers, were
  // reinterpreted as float bit patterns into `obj.scale`.
  // `AsFloat(2)` is 2.8e-45, `SkeletonApplyRootMotion` multiplies the root
  // delta by it, and the civilian stopped moving while her legs kept walking.
  // 125 commands in the shipped streams run one of those four. The first has
  // a body of its own now — see the shutter block below — and the other three
  // are still unread; neither writes `model+0x116C`.
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, CivilianWait.RootMotion),
      cmd(CivilianOp.SetPairA, 1, 2),
      cmd(CivilianOp.SetAttachMode, 2),
      cmd(CivilianOp.SetHudShutterState, 1),
      cmd(CivilianOp.SetMotion, 12, -1),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]]);
    const d = cWalk(a, events, 120);
    check("the unread opcodes leave `model+0x116C` alone, so she still walks",
          a.scale === 1 && d.dz < -10,
          `scale ${a.scale} dz ${d.dz.toFixed(3)}`);
  }
  // Op 0x27 is the one command that may write it, and its operand really is a
  // float bit pattern: `MOV dword ptr [model + 0x116c], param_2[1]`. The one
  // shipped instance passes `0x42480000`, which is 50.0.
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, CivilianWait.RootMotion),
      cmd(CivilianOp.SetScale, 0x42480000 | 0),
      cmd(CivilianOp.SetMotion, 12, -1),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]]);
    const d = cWalk(a, events, 60);
    check("...and op 0x27 does write it, scaling the ground she covers with it",
          a.scale === 50 && d.dz < -300,
          `scale ${a.scale} dz ${d.dz.toFixed(3)}`);
  }
}

// **A civilian's clip change** -- `CivilianApplyMotionPose` (`FUN_0048C310`),
// which ops 0x00 and 0x01 call and the port did not. Stage 1's bin civilian
// (`0x3C38`, block 6) is the scene: she falls onto the bin on clip 619 and
// climbs down on 611, whose root ends 15.4 units lower, and the block that
// follows (`0x160100`) carries `0x20000` -- hold bone 1 -- which is what puts
// her feet on the ground. Without it she walked the rest of the scene at the
// height of the bin lid. Each arm is driven through the VM, with a host whose
// bone 1 stands where a draw would have left it.
console.log("\nclass 0x10's clip change, CivilianApplyMotionPose:");
{
  const rng = new Rng(21);
  const N = TYPE.bone_count;
  /** A clip whose every frame has this root and these two records. */
  const clip = (frames: number, root: [number, number, number],
                rec0: [number, number, number] = [0, 0, 0],
                rec1: [number, number, number] = [0, 0, 0]) => ({
    bank: "t", frames, fps: 30,
    root: Array.from({ length: frames * 3 }, (_, i) => root[i % 3]),
    rot: Array.from({ length: frames * N * 3 }, (_, i) => {
      const r = Math.floor(i / 3) % N;
      return r === 0 ? rec0[i % 3] : r === 1 ? rec1[i % 3] : 0;
    }),
  });
  const POSE_CHARS = {
    ...CHARS,
    types: { "1": { ...TYPE, motions: {
      ...TYPE.motions,
      // 610 the climb down, whose root ends low; 565 the stand after it.
      "610": clip(20, [0, -5.18, 0]),
      "565": clip(20, [0, 11.91, 0]),
      // 669 a pose whose bone 1 is turned 0x2000; 373 one that is not.
      "669": clip(20, [0, 11.8, 0], [0, 0, 0], [0, 0x2000, 0]),
      "373": clip(20, [0, 11.0, 0]),
    } } },
  } as unknown as CharactersJson;
  /** Where the host says bone 1 was drawn. */
  const DRAWN = vec3(3, -4.78, 5);
  const HOST = { ...NULL_HOST,
    boneWorld: (_at: number, bone: number, out: Vec3) => {
      if (bone !== 1) return false;
      out.x = DRAWN.x; out.y = DRAWN.y; out.z = DRAWN.z;
      return true;
    } };
  const cmd = (op: CivilianOp, ...args: number[]): CivilianCmdJson =>
    ({ op, args });
  /**
   * The Init plays `first` in a block of its own and waits one timer frame;
   * the next block, led by `word`, changes to `second`. Returned just after
   * that change, driven by `CivilianUpdate` with `HOST`.
   */
  const change = (first: number, word: number, ...block: CivilianCmdJson[]) => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(POSE_CHARS, undefined, undefined, undefined, undefined, {
      entries: [0], items: [],
      scripts: [[
        cmd(CivilianOp.Wait, CivilianWait.RootMotion),
        cmd(CivilianOp.SetMotion, first, -1),
        cmd(CivilianOp.SetTimer, 1),
        cmd(CivilianOp.Wait, word),
        ...block,
        cmd(CivilianOp.Wait, 0),
        cmd(CivilianOp.End),
      ]],
      spawns: { "16384": { charType: 1, script: 0, removePath: -1,
                           removeFrame: 0, removeDelay: 0, children: [] } },
    });
    const a = ActorSpawn(0x4000, SpawnClass.Civilian, 1, "civilian",
                         undefined, rng);
    a.visible = true;
    a.pos = vec3(0, 0, 0);
    a.yaw = 0;
    const events = new Events();
    // The Init parks on command 3; the frame the next block runs moves it.
    for (let i = 0; i < 6 && a.civ?.cursor === 3; i++) {
      CivilianUpdate(a, { dt: 1 / 60, rng, host: HOST, events });
    }
    return a;
  };

  // `0x20000`: pos += bone 1 drawn - bone 1 under the new clip's first frame.
  // Type 1 is scale 1.0 and its first root node's offset is zero, so P2 is
  // the position plus 565's root, `(0, 11.91, 0)`.
  {
    const a = change(610, CivilianWait.HoldBone1 | CivilianWait.RootMotion,
                     cmd(CivilianOp.SetMotion, 565, -1));
    check("0x20000 moves her so bone 1 stays where the climb-down drew it",
          a.motion === 565 && Math.abs(a.pos.x - 3) < 1e-4
          && Math.abs(a.pos.y - (-4.78 - 11.91)) < 1e-4
          && Math.abs(a.pos.z - 5) < 1e-4,
          `motion ${a.motion} pos ${a.pos.x},${a.pos.y},${a.pos.z}`);
    check("...and the fade dissolves from the new clip's root, not the old",
          a.fadeFrom !== null && a.fadeFrom.root?.y === 11.91
          && a.fadeFrom.root?.x === 0 && a.fadeFrom.root?.z === 0,
          JSON.stringify(a.fadeFrom));
  }
  // The blend is op 0x03's operand -- `sub+0xE`, `CivilianInit`'s 10 by
  // default -- and `0x200000` cuts instead.
  {
    const a = change(610, CivilianWait.RootMotion,
                     cmd(CivilianOp.SetMotionBlend, 6),
                     cmd(CivilianOp.SetMotion, 565, -1));
    check("a clip change fades over op 0x03's length",
          a.motion === 565 && a.fadeFrom !== null && a.fadeLen === 7,
          `motion ${a.motion} fadeLen ${a.fadeLen}`);
    const b = change(610, CivilianWait.Cut | CivilianWait.RootMotion,
                     cmd(CivilianOp.SetMotion, 565, -1));
    check("...and 0x200000 cuts, with no fade at all",
          b.motion === 565 && b.fadeFrom === null, `fade ${b.fadeLen}`);
  }
  // The old block walked on its clip (`0x100000` in the word the VM entered
  // with), so the snapshot's x and z are the new frame's -- `model+0x6C` and
  // `+0x74` at `0x0048C809`/`0x0048C816` -- and its y is still the drawn one.
  {
    const a = change(610, CivilianWait.RootMotion,
                     cmd(CivilianOp.SetMotion, 565, -1));
    check("the outgoing block's root motion hands the fade x and z, not y",
          a.fadeFrom?.root?.x === 0 && a.fadeFrom?.root?.z === 0
          && a.fadeFrom?.root?.y === undefined, JSON.stringify(a.fadeFrom));
  }
  // `0x8000`: she turns by the heading the drawn pose has and the new clip's
  // first frame lacks, and records 1 and 9 are rebased by the same so the
  // body does not swing. 669's bone 1 faces 0x2000; 373's faces nothing.
  {
    const a = change(669, CivilianWait.TurnKeepBones | CivilianWait.RootMotion,
                     cmd(CivilianOp.SetMotion, 373, -1));
    const r1 = a.fadeFrom?.records?.find((r) => r.record === 1)?.rot;
    check("0x8000 turns her by the drawn heading the new clip lacks",
          a.motion === 373 && Math.abs(a.yaw - 0x2000) <= 1, `yaw ${a.yaw}`);
    check("...and rebases bone 1 so the body keeps facing where it was",
          r1 !== undefined && r1.every((v) => Math.abs(v) <= 2)
          && a.fadeFrom?.records?.some((r) => r.record === 9) === true,
          JSON.stringify(a.fadeFrom?.records));
  }
  // Op 0x01's third operand is the start **cursor**: `ActorSetMotionBlended`
  // writes it into `model+0x08` as it is. The port doubled it.
  {
    const a = change(610, CivilianWait.Cut,
                     { op: CivilianOp.SetMotionFrom, args: [565, 1, 7] });
    check("op 0x01 starts the clip on the cursor it names",
          a.motion === 565 && a.playTicks === 7, `ticks ${a.playTicks}`);
  }
  // Op 0x18: six dwords copied, the last three into pitch, yaw and roll.
  {
    const a = change(610, 0, { op: CivilianOp.SetPose, args: [0],
                               pose: [-698, -0.116, -541, 0x100, 0xc000, 0x200] });
    check("op 0x18 writes all three angles as BAMS",
          a.pitch === 0x100 && a.yaw === 0xc000 && a.roll === 0x200
          && a.pos.x === -698, `pitch ${a.pitch} yaw ${a.yaw} roll ${a.roll}`);
  }
}

// **A resume stores the cursor, not the clock.** `CivilianStepScript` runs
// `CivilianReapplyWaitCommand` (`FUN_0048B760`) over the block at the cursor
// before `CivilianRunScript` runs it, and the walk's op 0x00 is `MOV dword ptr
// [ECX + 0x8], 0x0` (`0x0048B794`): `model+0x08`, the cursor the next draw
// recomputes from the counter at `model+0x00` -- which it leaves alone. The
// port wrote its one clock, so the outgoing clip was back on its first frame
// when `CivilianApplyMotionPose` (`FUN_0048C310`) read the drawn pose, which
// it takes from the draw records and never from `model+0x08`. Stage 1's
// fountain man (`0x1828`, stream 0: clip 378 once and held, then `0x8200` and
// 377) turned +26345 BAMS in one frame and swung back through the fade.
//
// Driven in the director's order -- the clock, then the update -- over clips
// whose frames differ (L48): 702's bone 1 faces 0x2000 on its last frame and
// nothing on its first, 703 faces 0x2000 throughout, 704 turns 0x100 a frame.
console.log("\nclass 0x10's resume stores the cursor, not the clock:");
{
  const rng = new Rng(23);
  const N = TYPE.bone_count;
  const FRAMES = 20;
  /** `mot/` authors at 30; the cursor runs to `2 * frames - 2`. */
  const PLAY = FRAMES * 2 - 2;
  /** A clip standing still whose bone 1 is turned `yaw(f)` on frame `f`. */
  const turning = (yaw: (f: number) => number) => ({
    bank: "t", frames: FRAMES, fps: 30,
    root: Array.from({ length: FRAMES * 3 }, (_, i) => (i % 3 === 1 ? 11 : 0)),
    rot: Array.from({ length: FRAMES * N * 3 }, (_, i) =>
      (Math.floor(i / 3) % N === 1 && i % 3 === 1
        ? yaw(Math.floor(i / (N * 3))) : 0)),
  });
  const RESUME_CHARS = {
    ...CHARS,
    types: { "1": { ...TYPE, motions: {
      ...TYPE.motions,
      "702": turning((f) => (f === FRAMES - 1 ? 0x2000 : 0)),
      "703": turning(() => 0x2000),
      "704": turning((f) => f * 0x100),
    } } },
  } as unknown as CharactersJson;
  const cmd = (op: CivilianOp, ...args: number[]): CivilianCmdJson =>
    ({ op, args });
  /**
   * Spawn a civilian on `script` at yaw 0x1234 and run it until `until` says
   * stop -- ticking the clip before each update, as `GameUpdate` does.
   * Returns the actor and the play cursor the frame before the last.
   */
  const run = (script: CivilianCmdJson[],
               until: (a: ReturnType<typeof ActorSpawn>) => boolean) => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(RESUME_CHARS, undefined, undefined, undefined, undefined, {
      entries: [0], items: [], scripts: [script],
      spawns: { "16384": { charType: 1, script: 0, removePath: -1,
                           removeFrame: 0, removeDelay: 0, children: [] } },
    });
    const a = ActorSpawn(0x4000, SpawnClass.Civilian, 1, "civilian",
                         undefined, rng);
    a.visible = true;
    a.pos = vec3(0, 0, 0);
    a.yaw = 0x1234;
    const events = new Events();
    let before = a.playTicks;
    for (let i = 0; i < 400 && !until(a); i++) {
      before = a.playTicks;
      ActorAdvanceMotion(a, 1 / 60);
      CivilianUpdate(a, { dt: 1 / 60, rng, host: NULL_HOST, events });
    }
    return { a, before };
  };

  // 702 plays once and holds its last frame (the loop arm stops stepping the
  // counter at the play length); a timer later the `0x8000` block changes to
  // 703. The drawn heading is 702's last frame's, 0x2000, and 703's first
  // frame has the same, so `yaw += 0x2000 - 0x2000`: no turn at all.
  {
    const { a } = run([
      cmd(CivilianOp.Wait, CivilianWait.RootMotion),
      cmd(CivilianOp.SetMotion, 702, 1),
      cmd(CivilianOp.SetTimer, 80),
      cmd(CivilianOp.Wait, CivilianWait.TurnKeepBones | CivilianWait.RootMotion),
      cmd(CivilianOp.SetMotion, 703, -1),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ], (x) => x.motion === 703);
    check("a 0x8000 change turns by the pose she was drawn in, not the "
          + "outgoing clip's first frame",
          a.motion === 703 && a.yaw === 0x1234,
          `motion ${a.motion} yaw ${a.yaw.toString(16)} (0x1234 - 0x2000 is `
          + "the first frame's)");
    // `MotionLoadPoseSlot` mode 0xC snapshots the draw records, and they
    // are 702's held last frame -- the cursor at the play length.
    check("...and the fade dissolves from the held frame, not from frame 0",
          a.fadeFrom?.motion === 702 && a.fadeFrom?.ticks === PLAY,
          JSON.stringify(a.fadeFrom));
  }
  // A block that re-states the clip already playing changes nothing in
  // `CivilianRunScript` (`if (model+0x20 != clip)`), and the reapply's store
  // is gone at the next draw: the counter runs on, one tick a frame.
  {
    const { a, before } = run([
      cmd(CivilianOp.Wait, CivilianWait.RootMotion),
      cmd(CivilianOp.SetMotion, 704, -1),
      cmd(CivilianOp.SetTimer, 20),
      cmd(CivilianOp.Wait, CivilianWait.RootMotion),
      cmd(CivilianOp.SetMotion, 704, -1),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ], (x) => (x.civ?.cursor ?? 3) > 3);
    check("a resume that re-states the playing clip does not restart it",
          a.motion === 704 && before > 0 && a.playTicks === before + 1,
          `ticks ${before} -> ${a.playTicks}`);
  }
  // The store's one reader: the step loop tests the block it has just walked
  // before any draw -- `CMP [model+0x8], sub+0x16` for bit 0x200. The walk
  // stored 0 and op 0x04 asked for 0, so the block is already satisfied and
  // the loop walks past it; its flag is never raised and the next block's is.
  {
    const { a } = run([
      cmd(CivilianOp.Wait, CivilianWait.RootMotion),
      cmd(CivilianOp.SetMotion, 704, -1),
      cmd(CivilianOp.SetTimer, 20),
      cmd(CivilianOp.Wait, CivilianWait.MotionFrame | CivilianWait.RootMotion),
      cmd(CivilianOp.SetMotion, 704, -1),
      cmd(CivilianOp.SetMotionFrame, 0),
      cmd(CivilianOp.SetScriptFlag, 7),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetScriptFlag, 8),
      cmd(CivilianOp.End),
    ], () => G.g_script_flags[7] === 1 || G.g_script_flags[8] === 1);
    check("the 0x200 test reads the cursor the walk just stored",
          a.motion === 704 && (G.g_script_flags[7] ?? 0) === 0
          && G.g_script_flags[8] === 1,
          `flags 7:${G.g_script_flags[7]} 8:${G.g_script_flags[8]}`);
  }
}
