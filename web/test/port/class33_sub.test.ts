import type { CharactersJson } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { GameUpdate, RunPendingInits, SpawnSlotActors }
  from "../../src/game/director";
import { G, HIT_SLOT_NONE, ResetGameGlobals } from "../../src/game/globals";
import { NULL_HOST } from "../../src/game/host";
import { SpriteEffectKind } from "../../src/game/effects/sprite";
import { SetGameTables } from "../../src/game/tables";
import type { Actor, ScriptedSceneryActor } from "../../src/game/actor";
import { ScriptedScenerySelector } from "../../src/game/class33";
import { ScriptedSoundCues33FollowReplayCamera } from "../../src/game/class33/cues";
import { ScoreRankForPlayer } from "../../src/game/combat/score";
import { SpawnClass } from "../../src/game/spawn_class";
import {
  MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixScale,
  MatrixTranslate,
} from "../../src/game/matrix";
import { check, CHARS, SCENE_MAJOR_PLAYING, EnterPlay } from "./harness";

// -- class 0x33 selectors 6 to 11 and 99 ------------------------------------
//
// `ScriptedSceneryDispatch33` (`FUN_00432FF0`)'s seven arms past the first
// five. Each block is driven through the front, as class33's selector-5
// blocks are: the placement the exporter emits, `SpawnSlotActors`, the frame
// walk's `Init`, then `GameUpdate` and nothing else. The sound ids are the
// immediates the routines push and the tails the shipped descriptors carry:
// stage 5's `0x1E7C` (selector 7), `0x3D10` (8) and `0x3D34` (9).

const SND_CAR_SRIP = 0x23a9;          // STAGE5_SE\CAR_SRIP_22.wav
const SND_BRAKE = 0x123a9;            // STAGE5_SE\BRAKE_22.wav
const SND_BRIDGE_CRASH = 0x1523a9;    // STAGE5_SE\BRIDGE_CRASH1_22.wav
const SND_GRASS = 0x2f16a9;           // COMMON\GRASS7_16.WAV
const SND_FIRE = 0x723a9;             // STAGE5_SE\CAR_FIRE_22.wav
const SND_FIRE_OFF = 0x823a9;         // STAGE5_SE\CAR_FIRE_22_OFF.wav
const SND_ENDL = 0x1000000c;
const SND_ENDS = 0x1000000d;

type Sub = NonNullable<Actor["class33Sub"]>;

function tables(at: number, sub: Sub, orient: { pitch?: number; yaw?: number;
                                                 roll?: number } = {}) {
  return {
    ...CHARS,
    combat: {
      impact_sprite: { [String(SpriteEffectKind.Dokan)]: [0xfd4, 0x1031, 1.0] },
      impact_sprite_default: [0x0904, 0x0904, 0.1],
      ricochet: {},
    },
    placements: [{
      at, class: 0x33, char_type: -1, motion: null, hp: sub.selector,
      init_flags: 0, yaw: orient.yaw ?? 0, pitch: orient.pitch,
      roll: orient.roll, class33_sub: sub,
    }],
  } as unknown as CharactersJson;
}

function build(at: number, sub: Sub, pos: [number, number, number],
               orient: { pitch?: number; yaw?: number; roll?: number } = {},
               rng = new Rng(7)): ScriptedSceneryActor {
  ResetGameGlobals();
  EnterPlay();
  SetGameTables(tables(at, sub, orient));
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_scene_state_major = SCENE_MAJOR_PLAYING;
  G.g_players_in_play = 1;
  SpawnSlotActors([{ at, class: SpawnClass.ScriptedScenery, pos: [...pos] }]);
  RunPendingInits(rng);
  const o = G.g_object_list.find((a) => a.at === at);
  if (!o || o.cls !== SpawnClass.ScriptedScenery) {
    throw new Error(`no class-0x33 selector ${sub.selector} object`);
  }
  return o;
}

function frame(events: Events, rng = new Rng(8)): void {
  GameUpdate(1 / 60, NULL_HOST, rng, events);
}

function listen(): { events: Events; sounds: number[] } {
  const events = new Events();
  const sounds: number[] = [];
  events.on("sound.play", (e) => sounds.push(e.id));
  return { events, sounds };
}

const hx = (v: number) => `0x${v.toString(16)}`;

console.log("\nclass 0x33 selector 7: stage 5's tyres and brakes, on camera frames:");
{
  const AT = 0x1e7c;
  const SHIPPED: Sub = {
    selector: 7, cues: [
      { mode: 1, frame: 505, sound: SND_CAR_SRIP },
      { mode: 1, frame: 760, sound: SND_CAR_SRIP },
      { mode: 1, frame: 820, sound: SND_CAR_SRIP },
      { mode: 1, frame: 990, sound: SND_BRAKE },
      { mode: -1, frame: -1 },
    ],
  };
  // S7.1 the placement is built and its arm claims a hit slot.
  {
    const o = build(AT, SHIPPED, [0, 0, 0]);
    check("a `class33_sub` placement for selector 7 is spawned, and "
          + "`CALL 0x00409270` at `0x00433074` claims it a hit slot",
          o.hp === ScriptedScenerySelector.SoundCues
          && o.hitSlot !== HIT_SLOT_NONE && G.g_hit_slots[o.hitSlot] === AT,
          `hp ${o.hp}, slot ${o.hitSlot}`);
  }
  // S7.2 the seed falls into the test: a cue on the first update fires.
  {
    const o = build(AT, SHIPPED, [0, 0, 0]);
    const { events, sounds } = listen();
    G.g_cam_path_frame = 505;
    frame(events);
    check("spawned with the camera on 505, the first update seeds and plays "
          + "`CAR_SRIP_22` in the same frame (`0x00433ECF` runs into "
          + "`0x00433ED6`)", sounds.join() === String(SND_CAR_SRIP)
          && o.sub === 1 && o.scenery.cue === 1,
          `${sounds.map(hx)} sub ${o.sub} cue ${o.scenery.cue}`);
    frame(events);
    check("...and a camera that holds 505 plays nothing more: the tail "
          + "pointer has moved on to the 760 record",
          sounds.length === 1, sounds.map(hx).join());
  }
  // S7.3 the whole list, in order, and the park.
  {
    const o = build(AT, SHIPPED, [0, 0, 0]);
    const { events, sounds } = listen();
    for (const f of [504, 505, 506, 759, 760, 820, 989, 990, 991, 505, 760]) {
      G.g_cam_path_frame = f;
      frame(events);
    }
    check("frames 505, 760, 820 and 990 play the tyres three times and the "
          + "brakes once, and nothing else does -- equality, not a threshold",
          sounds.map(hx).join() === [SND_CAR_SRIP, SND_CAR_SRIP, SND_CAR_SRIP,
                                     SND_BRAKE].map(hx).join(),
          sounds.map(hx).join());
    check("the object parks on the mode -1 record and stays: the despawn "
          + "behind `CMP [EDI], -1` tests the record just played and can "
          + "never run", !o.despawned && o.scenery.cue === 4 && o.sub === 1
          && G.g_hit_slots[o.hitSlot] === AT,
          `despawned ${o.despawned}, cue ${o.scenery.cue}`);
  }
  // S7.4 mode 0 counts frames, only on mode-0 records, never reset.
  {
    const o = build(AT, {
      selector: 7, cues: [
        { mode: 0, frame: 3, sound: 0x111 },
        { mode: 1, frame: 50, sound: 0x222 },
        { mode: 0, frame: 5, sound: 0x333 },
        { mode: 7, frame: 0 },
      ],
    }, [0, 0, 0]);
    const { events, sounds } = listen();
    const at: string[] = [];
    let n = 0;
    const step = (cam: number) => {
      G.g_cam_path_frame = cam;
      const before = sounds.length;
      frame(events);
      n++;
      if (sounds.length > before) at.push(`${n}:${hx(sounds[sounds.length - 1])}`);
    };
    for (let i = 0; i < 4; i++) step(0);  // 1, 2, 3 (fires), 4 (on the 50)
    step(50);                              // 5: the camera cue
    step(0); step(0);                      // 6, 7: count 4, 5 -> fires on 7
    for (let i = 0; i < 5; i++) step(0);   // parked on mode 7
    check("a mode-0 record fires when `++obj+0x1330` reaches its frame, and "
          + "the count carries over the mode-1 record without stepping: 3, "
          + "then the camera's 50, then 5 two frames later",
          at.join() === "3:0x111,5:0x222,7:0x333" && o.scenery.frames === 5,
          `${at.join()} frames ${o.scenery.frames}`);
  }
}

console.log("\nclass 0x33 selector 7 outlives its cues, and a seek carries them:");
{
  const AT = 0x1e7c;
  const SHIPPED: Sub = {
    selector: 7, cues: [
      { mode: 1, frame: 505, sound: SND_CAR_SRIP },
      { mode: 1, frame: 760, sound: SND_CAR_SRIP },
      { mode: 1, frame: 820, sound: SND_CAR_SRIP },
      { mode: 1, frame: 990, sound: SND_BRAKE },
      { mode: -1, frame: -1 },
    ],
  };
  // S7.R1 parked on the terminator, it stays: `CMP word [EDI], -1` reads the
  // record just played, never a terminator, so no despawn.
  {
    const o = build(AT, SHIPPED, [0, 0, 0]);
    const { events, sounds } = listen();
    for (const cam of [505, 760, 820, 990, 990, 505, 760]) {
      G.g_cam_path_frame = cam;
      frame(events);
    }
    check("after all four records it is parked on the terminator, still in "
          + "the pool, still holding its hit slot -- nothing in the routine "
          + "takes it away",
          sounds.length === 4 && o.scenery.cue === 4 && !o.despawned
          && G.g_object_list.includes(o) && G.g_hit_slots[o.hitSlot] === AT,
          `${sounds.map(hx).join()} cue ${o.scenery.cue}`);
  }
  // S7.R2 the replay's camera, as stage 5 runs it: spawned on path 207 at
  // 230, the path ends at 600 (505 passed), then block 4's path 209 from 0.
  {
    const state: Record<string, number> = {};
    const seen: number[] = [];
    const show = (slot: number, frame: number, startFrame = 0) => {
      ScriptedSoundCues33FollowReplayCamera(SHIPPED.cues,
                                            { slot, startFrame, frame }, state);
      seen.push(state.cue);
    };
    show(207, 230); show(207, 506); show(207, 600);
    show(209, 601); show(209, 815); show(209, 900); show(209, 1000);
    show(209, 1100);
    // A later frame on a new path from its start, and a path started over.
    check("a replay passes each record whose frame the camera has run "
          + "over since the spawn, in order, on whatever path: 505 on 207, "
          + "760 by 815 on 209, 820 by 900, 990 by 1000, then parked",
          seen.join() === "0,1,1,1,2,3,4,4", seen.join());
    const restart: Record<string, number> = {};
    ScriptedSoundCues33FollowReplayCamera(
      SHIPPED.cues, { slot: 207, startFrame: 0, frame: 600 }, restart);
    const atSpawn = restart.cue;
    ScriptedSoundCues33FollowReplayCamera(
      SHIPPED.cues, { slot: 207, startFrame: 0, frame: 510 }, restart);
    check("...and on the spawn's own frame nothing is passed: a path past "
          + "505 when it spawns plays it only when a path runs over it again",
          atSpawn === 0 && restart.cue === 1, `${atSpawn} ${restart.cue}`);
  }
  // S7.R3 the rebuilt object stands where the replay left it.
  {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(tables(AT, SHIPPED));
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    G.g_players_in_play = 1;
    SpawnSlotActors([{ at: AT, class: SpawnClass.ScriptedScenery,
                       pos: [0, 0, 0], hp: 7,
                       replay: { cue: 1, slot: 207, frame: 600 } }]);
    const rng = new Rng(9);
    RunPendingInits(rng);
    const o = G.g_object_list.find((a) => a.at === AT);
    if (!o || o.cls !== SpawnClass.ScriptedScenery) throw new Error("no 0x1E7C");
    const { events, sounds } = listen();
    G.g_cam_path_frame = 505;
    frame(events);
    G.g_cam_path_frame = 760;
    frame(events);
    check("rebuilt by a seek past 505, it does not play 505 again: its next "
          + "sound is 760's",
          sounds.length === 1 && sounds[0] === SND_CAR_SRIP
          && o.scenery.cue === 2,
          `${sounds.map(hx).join()} cue ${o.scenery.cue}`);
  }
}

console.log("\nclass 0x33 selector 10: a sound and a script flag on a cue:");
{
  const o = build(0xa38, { selector: 10, mode: 0, frame: 3, sound: 0x2116a9,
                           flag: 3 }, [0, 0, 0]);
  const { events, sounds } = listen();
  frame(events); frame(events);
  const early = G.g_script_flags[3] ?? 0;
  frame(events);
  check("on the third frame it plays the sound, raises `g_script_flags[3]` "
        + "and despawns -- and not before",
        early === 0 && G.g_script_flags[3] === 1
        && sounds.join() === String(0x2116a9) && o.despawned,
        `before ${early}, after ${G.g_script_flags[3]}, ${sounds.map(hx)}, `
        + `despawned ${o.despawned}`);
}

console.log("\nclass 0x33 selector 6: one sprite from the object, then gone:");
{
  const POS: [number, number, number] = [124.5, -25, -107];
  const o = build(0xec8, { selector: 6, kind: SpriteEffectKind.Dokan, face: 0,
                           player: -1 }, POS, { pitch: 0x1000, yaw: 0x2400 });
  const { events } = listen();
  frame(events);
  const fx = G.g_sprite_effects.filter((e) => e.kind === SpriteEffectKind.Dokan);
  const e = fx[0];
  check("its first frame throws one sprite of the tail's kind from the "
        + "object's position, with its pitch and yaw (`params[3]`, `[4]`)",
        fx.length === 1 && !!e && e.pos.x === POS[0] && e.pos.y === POS[1]
        && e.pos.z === POS[2] && e.pitch === 0x1000 && e.yaw === 0x2400,
        e ? `${fx.length} at (${e.pos.x}, ${e.pos.y}, ${e.pos.z}) `
            + `facing (${e.pitch}, ${e.yaw})` : "none");
  check("...and despawns in the same frame", o.despawned, String(o.despawned));
}

// The draw head selectors 8 and 9 share: `T RotY RotX RotZ Scale`, built here
// from the port's primitives in **that** order, against a placement whose three
// angles are all non-zero so the order can be wrong (`L48`).
function stripMatrix(x: number, y: number, z: number, yaw: number,
                     pitch: number, roll: number, k: number): number[] {
  const m = MatIdentity();
  MatrixTranslate(m, x, y, z);
  MatrixRotateY(m, yaw);
  MatrixRotateX(m, pitch);
  MatrixRotateZ(m, roll);
  MatrixScale(m, k, k, k);
  return m;
}
function zyxMatrix(x: number, y: number, z: number, yaw: number,
                   pitch: number, roll: number, k: number): number[] {
  const m = MatIdentity();
  MatrixTranslate(m, x, y, z);
  MatrixRotateZ(m, roll);
  MatrixRotateY(m, yaw);
  MatrixRotateX(m, pitch);
  MatrixScale(m, k, k, k);
  return m;
}
const near = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-3);

console.log("\nclass 0x33 selector 8: the bridge crash and eff_shop.bin's strip:");
{
  const POS: [number, number, number] = [580, 2200, -9149];
  const O = { pitch: 0x3800, yaw: 0x1000, roll: 0x0800 };
  const o = build(0x3d10, { selector: 8 }, POS, O);
  const { events, sounds } = listen();
  const drawn: number[] = [];
  let firstM: number[] = [];
  let grassAt = -1;
  let n = 0;
  while (!o.despawned && n < 100) {
    frame(events);
    n++;
    if (grassAt < 0 && sounds.includes(SND_GRASS)) grassAt = n;
    for (const d of o.scenery.draws) drawn.push(d.slot);
    if (n === 1) firstM = o.scenery.draws[0]?.m ?? [];
  }
  check("`BRIDGE_CRASH1_22` on the first frame and `GRASS7_16` on the "
        + "twentieth (`0x14`, counted down from the seed's frame)",
        sounds[0] === SND_BRIDGE_CRASH && grassAt === 20 && sounds.length === 2,
        `${sounds.map(hx)}, grass on ${grassAt}`);
  check("sixty frames draw `0x174A..0x1785` one each, in order, and the "
        + "sixty-first despawns",
        n === 61 && drawn.length === 60 && drawn[0] === 0x174a
        && drawn[59] === 0x1785 && drawn.every((s, i) => s === 0x174a + i)
        && o.scenery.slot === 0x174a,
        `${n} frames, ${drawn.length} draws, ${hx(drawn[0] ?? 0)}..`
        + `${hx(drawn[drawn.length - 1] ?? 0)}, slot ${hx(o.scenery.slot)}`);
  const want = stripMatrix(POS[0], Math.fround(POS[1] - 300), POS[2], O.yaw,
                           O.pitch, O.roll, 10);
  check("each is drawn 300 below the object at ten times its size, under "
        + "`RotY RotX RotZ` -- not selector 1's `RotZ RotY RotX`",
        near(firstM, want)
        && !near(firstM, zyxMatrix(POS[0], Math.fround(POS[1] - 300), POS[2],
                                   O.yaw, O.pitch, O.roll, 10)),
        `t (${firstM[12]?.toFixed(1)}, ${firstM[13]?.toFixed(1)}, `
        + `${firstM[14]?.toFixed(1)})`);
}

console.log("\nclass 0x33 selector 9: the fire loop until its cue:");
{
  const POS: [number, number, number] = [580, 2200, -9149];
  const O = { pitch: 0x3800, yaw: 0x1000, roll: 0x0800 };
  const o = build(0x3d34, { selector: 9, mode: 0, frame: 360 }, POS, O);
  const { events, sounds } = listen();
  const drawn: number[] = [];
  let scales = true;
  let firstM: number[] = [];
  let n = 0;
  while (!o.despawned && n < 1000) {
    frame(events);
    n++;
    if (o.scenery.drawScale !== 10) scales = false;
    for (const d of o.scenery.draws) drawn.push(d.slot);
    if (n === 1) firstM = o.scenery.draws[0]?.m ?? [];
  }
  check("`CAR_FIRE_22` on the first frame, `CAR_FIRE_22_OFF` and the "
        + "despawn on the 360th, with nothing drawn that frame",
        sounds.map(hx).join() === [SND_FIRE, SND_FIRE_OFF].map(hx).join()
        && n === 360 && drawn.length === 359 && o.scenery.draws.length === 0,
        `${sounds.map(hx)} after ${n} frames, ${drawn.length} draws`);
  check("the loop runs `0x1AAB..0x1AD2` and wraps -- `0x1AAA` is never drawn",
        drawn[0] === 0x1aab && drawn[39] === 0x1ad2 && drawn[40] === 0x1aab
        && !drawn.includes(0x1aaa),
        `${hx(drawn[0] ?? 0)} ${hx(drawn[39] ?? 0)} ${hx(drawn[40] ?? 0)}`);
  check("the scale steps by 0.02 and is back at 10.0 on every frame "
        + "(`10.02 > 10.0` at `0x004341F1` every time)", scales);
  check("drawn at the object under `RotY RotX RotZ` at ten times its size",
        near(firstM, stripMatrix(POS[0], POS[1], POS[2], O.yaw, O.pitch,
                                 O.roll, 10)), firstM.slice(12, 15).join());
}

console.log("\nclass 0x33 selector 99: the tail's slot, for good:");
{
  const POS: [number, number, number] = [10, 20, 30];
  const O = { pitch: 0x3800, yaw: 0x1000, roll: 0x0800 };
  const o = build(0x99, { selector: 99, slot: 0x1064 }, POS, O);
  const { events, sounds } = listen();
  for (let i = 0; i < 5; i++) frame(events);
  const d = o.scenery.draws;
  check("every frame draws `tail+0x00` once under `T RotZ RotY RotX` at "
        + "scale 1, plays nothing and never leaves",
        d.length === 1 && d[0].slot === 0x1064 && !o.despawned
        && sounds.length === 0
        && near(d[0].m, zyxMatrix(POS[0], POS[1], POS[2], O.yaw, O.pitch,
                                  O.roll, 1)),
        `${d.length} draws, despawned ${o.despawned}`);
}

console.log("\nclass 0x33 selector 11 and ScoreRankForPlayer: ENDL or ENDS:");
{
  ResetGameGlobals();
  const rank = (score: number) => {
    G.g_player_score[0] = score;
    return ScoreRankForPlayer(0, 1);
  };
  const got = [80000, 79999, 72000, 64000, 56000, 46000, 36000, 35999, 24000,
               23999, 0].map(rank);
  check("ranks step down at 80000, 72000, 64000, 56000, 46000, 36000 and "
        + "24000, 0 the best and 7 the worst",
        got.join() === "0,1,1,2,3,4,5,6,6,7,7", got.join());
  G.g_player_score[0] = 50000;
  check("the routine's `mode` changes nothing: the two arms are the same "
        + "compares", ScoreRankForPlayer(0, 1) === ScoreRankForPlayer(0, 2));

  // `g_active_player` is not set here: `SelectAttackablePlayer` computes it
  // every frame from `g_players_in_play` and player 0's state, so one player
  // in play as player 2 is player 0 out of play.
  const play = (players: number, p0InPlay: boolean, s0: number, s1: number) => {
    const o = build(0x4a0, { selector: 11 }, [0, 0, 0]);
    G.g_players_in_play = players;
    if (!p0InPlay) G.g_player_state[0] = 0;
    G.g_player_score[0] = s0;
    G.g_player_score[1] = s1;
    const { events, sounds } = listen();
    frame(events);
    return { sounds: sounds.map(hx).join(), gone: o.despawned,
             active: G.g_active_player };
  };
  const one = play(1, false, 0, 80000);
  const oneLow = play(1, true, 79999, 99999);
  const twoHigh = play(2, true, 100, 80000);
  const twoLow = play(2, true, 79999, 79999);
  const none = play(0, true, 90000, 90000);
  check("one player in play: `ENDL` when the active player's score is rank 0 "
        + "-- read through `g_active_player`, not player 0",
        one.active === 1 && one.sounds === hx(SND_ENDL)
        && oneLow.active === 0 && oneLow.sounds === hx(SND_ENDS),
        `${one.active}: ${one.sounds} / ${oneLow.active}: ${oneLow.sounds}`);
  check("two players: `ENDL` when either is rank 0, `ENDS` when neither is",
        twoHigh.sounds === hx(SND_ENDL) && twoLow.sounds === hx(SND_ENDS),
        `${twoHigh.sounds} / ${twoLow.sounds}`);
  check("no player in play falls to `ENDS`, and every run despawns",
        none.sounds === hx(SND_ENDS)
        && [one, oneLow, twoHigh, twoLow, none].every((r) => r.gone),
        none.sounds);
}

SetGameTables(CHARS);
