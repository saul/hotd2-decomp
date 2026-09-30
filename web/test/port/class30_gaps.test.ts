/**
 * Class 0x30's dispatch entry for entry, and the per-frame and per-shot
 * routines that sit around it: `g_class30_states[0x36]`, the footstep cue,
 * `ActorUpdateBodyCondition`, the kill-move and remapped deaths, and the
 * corpse's pose.
 */
import type { CharactersJson } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { NULL_HOST } from "../../src/game/host";
import { G, HIT_SLOT_NONE, ResetGameGlobals } from "../../src/game/globals";
import { MotionPlayFrame, SetGameTables, T } from "../../src/game/tables";
import {
  ATTACHED_EFFECT_FIRST_SLOT, ATTACHED_EFFECT_KIND1, AttachedEffectsTick,
  SND_ATTACHED_EFFECT_SPLASH,
} from "../../src/game/effects/attached_effect";
import { ZombieEnterCorpseState } from "../../src/game/class30/death";
import { ZombieState } from "../../src/game/class30/states";
import { Zombie1368Flag } from "../../src/game/class30/state";
import { EnemyZombieUpdate } from "../../src/game/class30";
import { vec3 } from "../../src/game/vec";
import {
  ActorFlag, DamageZone, ZombieFlag2, type ZombieActor,
} from "../../src/game/actor";
import { ActorAdvanceMotion } from "../../src/game/motion";
import { HitResultCode } from "../../src/game/combat/resolve_hit";
import {
  check, CHARS, coliQuad, motion, SCENE_MAJOR_PLAYING, spawnZombie, EnterPlay,
  TYPE,
} from "./harness";

/** A class-0x30 actor, spawned through its `Init` against `tables`. */
function zombie(init: number, desc: Record<string, unknown> = {},
                charType = 1, tables: CharactersJson = CHARS): ZombieActor {
  ResetGameGlobals();
  EnterPlay();
  SetGameTables(tables);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_scene_state_major = SCENE_MAJOR_PLAYING;
  G.g_camera_fixed_eye_y = 0;
  G.g_players_in_play = 1;
  const z = spawnZombie(0x7a00, charType, "gaps",
                        { initialState: init, ...desc });
  z.visible = true;
  z.hp = z.maxHp = 100;
  z.pos = vec3(0, 0, 40);
  return z;
}

const frame = (rng = new Rng(7)) => ({ dt: 1 / 60, rng, host: NULL_HOST });

console.log("\nclass 0x30's dispatch, entry for entry:");
{
  // `EnemyZombieInit` stores the descriptor's byte +2 as it stands
  // (`0x00452F36`); the router that sent anything it had not read to
  // `AttackRun` is gone.
  const z = zombie(ZombieState.NoOp);
  check("a descriptor byte of 0 starts the actor in state 0",
        z.state === ZombieState.NoOp, `state ${z.state}`);
  // `g_class30_states[0]` is `NoOpStub` (`0x0041EBB0`), a bare `RET`. The
  // dispatch's old `default` released the permit and sent the actor to
  // `WaitTurn`.
  z.attackPermit = 0;
  G.g_attack_permits[0] = z.at;
  EnemyZombieUpdate(z, frame());
  check("state 0 is the engine's no-op: the state, the sub and the permit "
        + "stand",
        z.state === ZombieState.NoOp && z.sub === 0 && z.attackPermit === 0
        && G.g_attack_permits[0] === z.at,
        `state ${z.state}/${z.sub} permit ${z.attackPermit}`);
}
{
  // `[0x31]` is `NoOpStub` too, and the five entries with no body do nothing
  // either: none of them is sent to the attack loop.
  for (const st of [ZombieState.OrderDie, ZombieState.RunPastPoint,
                    ZombieState.DelayedPounce, ZombieState.SplitLaunch,
                    ZombieState.SplitHalfCollapse,
                    ZombieState.CollapseToCondition4]) {
    const z = zombie(ZombieState.AttackRun);
    z.state = st;
    z.sub = 0;
    z.attackPermit = 0;
    G.g_attack_permits[0] = z.at;
    EnemyZombieUpdate(z, frame());
    check(`state 0x${st.toString(16)} is not sent to WaitTurn`,
          z.state === st && z.attackPermit === 0,
          `state ${z.state} permit ${z.attackPermit}`);
  }
}

console.log("\nclass 0x30's footfalls and swishes, on exact play cursors:");
{
  // `ZombiePlayMotionFrameSe` (`0x00452A10`): clip 0xB sounds ENE_WALK3 on
  // cursors 10, 20, 30 and 1; clip 0x1C3 sounds SWORD11 on 30 alone. The
  // fixture's type gains both clips, so the switch has something to find.
  const tables = {
    ...CHARS,
    types: { "1": { ...TYPE, motions: {
      ...TYPE.motions, "11": motion(20, 0, 39), "451": motion(24, 0, 47),
    } } },
  } as unknown as CharactersJson;
  const z = zombie(ZombieState.NoOp);
  SetGameTables(tables);
  const events = new Events();
  const heard: number[] = [];
  events.on("sound.play", ({ id }) => heard.push(id));
  const tick = () => EnemyZombieUpdate(z, { ...frame(), events });
  z.motion = 0xb;
  z.playTicks = 10;
  tick();
  check("clip 0xB at cursor 10 sounds COMMON\\ENE_WALK3_16 (0x2616A9)",
        heard.length === 1 && heard[0] === 0x2616a9,
        heard.map((x) => x.toString(16)).join(","));
  check("...and latches the cursor at obj+0x1314", z.zom.seFrame === 10,
        String(z.zom.seFrame));
  tick();
  check("the same cursor a second frame sounds nothing", heard.length === 1,
        String(heard.length));
  z.playTicks = 11;
  tick();
  check("a cursor with no cue sounds nothing", heard.length === 1,
        String(heard.length));
  z.playTicks = 20;
  tick();
  check("the next cue, 20, sounds again", heard.length === 2
        && heard[1] === 0x2616a9, String(heard.length));
  // The latch is never cleared: a clip whose one cue is the cursor that last
  // sounded is silent on its next pass.
  z.motion = 0x1c3;
  z.playTicks = 30;
  tick();
  check("clip 0x1C3 at 30 swishes, COMMON\\SWORD11_22 (0x3C16A9)",
        heard.length === 3 && heard[2] === 0x3c16a9,
        heard.map((x) => x.toString(16)).join(","));
  z.playTicks = 31;
  tick();
  z.playTicks = 30 + 48;                  // one wrap of play length 47 later
  tick();
  check("...and its next pass is silent: the latch still holds 30",
        heard.length === 3 && MotionPlayFrame(z) === 30,
        `${heard.length} at cursor ${MotionPlayFrame(z)}`);
  // `TEST AL, 0x2` on `obj+0x1368` at `0x0045348F`: none in the water.
  z.motion = 0xb;
  z.playTicks = 1;
  z.zom.flags1368 |= Zombie1368Flag.InWater;
  tick();
  check("an actor in the water makes no footfall", heard.length === 3,
        String(heard.length));
  z.zom.flags1368 &= ~Zombie1368Flag.InWater;
  tick();
  check("...and out of it, cursor 1 sounds", heard.length === 4,
        String(heard.length));
}

console.log("\nthe body condition a landed shot leaves (ActorUpdateBodyCondition):");
{
  // `znchain.bin`, character type 2: its hand props are `0x1BD2` on bone 5
  // and `0x1BCC` on bone 8, and the bone-zone table gives bones 5 and 8 the
  // two arm zones, as the shipped one does.
  const hand = (bone: number, slot: number) => ({
    bone, part: `hand ${bone}`, slot, offset: [0, 0, 0], parent: null,
    damage_rank: [], steps: [],
  });
  const tables = {
    ...CHARS,
    bone_zones: [0xff, 0xff, 0, 0xff, 1, 1, 2, 2, 2],
    types: {
      ...CHARS.types,
      "2": { ...TYPE, type: 2, name: "znchain",
             bones: [...TYPE.bones.filter((b) => b.bone !== 5),
                     hand(5, 0x1bd2), hand(8, 0x1bcc)] },
    },
  } as unknown as CharactersJson;
  const events = new Events();
  const heard: number[] = [];
  events.on("sound.play", ({ id }) => heard.push(id));
  const z = zombie(ZombieState.NoOp, { condition: 2 }, 2, tables);
  check("a znchain takes the chainsaw loop in its Init",
        G.g_weapon_loop_holders === 1 && z.weaponLoopHeld === 1,
        `${G.g_weapon_loop_holders}/${z.weaponLoopHeld}`);
  const shoot = (bone: number, result: number) => {
    z.pendingHit = { bone, result, player: 0 };
    EnemyZombieUpdate(z, { ...frame(), events });
  };
  // Result 1 with the saw's right hand swapped out: one armed hand left.
  z.boneSlot["5"] = 0x1bd3;
  shoot(5, HitResultCode.Damaged);
  check("a damaging shot that takes one hand leaves condition 1",
        z.condition === 1, String(z.condition));
  // Result 2 does not reach it (`0x004541FC` skips the call).
  z.boneSlot["8"] = 0x1bcd;
  shoot(8, HitResultCode.Plain);
  check("a plain hit does not recompute it, whatever the hands hold",
        z.condition === 1 && G.g_weapon_loop_holders === 1,
        `${z.condition} holders ${G.g_weapon_loop_holders}`);
  shoot(8, HitResultCode.Severed);
  check("the shot that finds neither hand armed leaves condition 0",
        z.condition === 0, String(z.condition));
  check("...and stops the chainsaw: CHAIN_SAW_22_OFF (0x4E17A9), the last "
        + "holder released",
        heard.includes(0x4e17a9) && G.g_weapon_loop_holders === 0
        && z.weaponLoopHeld === 0,
        `${heard.map((x) => x.toString(16))} holders `
        + `${G.g_weapon_loop_holders}`);
}
{
  // The tail every type reaches: `obj+0x136C` bit 0x40 with condition 0 and
  // both arm zones destroyed is condition 5, once. Type 1 is `znassb`'s arm,
  // and a bone 5 taken off by `RemoveBoneSubtree` holds no prop.
  const tables = {
    ...CHARS, bone_zones: [0xff, 0xff, 0, 0xff, 1, 1, 2, 2, 2],
  } as unknown as CharactersJson;
  const z = zombie(ZombieState.NoOp, { condition: 1, descFlags: 0x40 }, 1,
                   tables);
  check("the descriptor's +0x20 bit 0x40 reaches obj+0x136C",
        (z.flags2 & 0x40) !== 0, (z.flags2 >>> 0).toString(16));
  z.removed.push(5);
  z.zones |= DamageZone.RightArm | DamageZone.LeftArm;
  z.pendingHit = { bone: 5, result: HitResultCode.Damaged, player: 0 };
  EnemyZombieUpdate(z, frame());
  check("an empty-handed actor with both arm zones gone and bit 0x40 up "
        + "takes condition 5",
        z.condition === 5 && (z.flags2 & 0x40) === 0,
        `${z.condition} ${(z.flags2 >>> 0).toString(16)}`);
}

/**
 * The fixture's type 1 with every clip the maul and the deaths below name --
 * the kill-move entries and their deaths, clip 0xB2, and the directional
 * deaths 0x3D9..0x3E0 -- and the two arc tables `tables(front, back)` sets.
 */
function deathTables(front: number[] = [900], back: number[] = [901]):
    CharactersJson {
  const clips: Record<string, unknown> = {};
  for (const m of [0x1a3, 0x1a4, 0x1a5, 0x1ab, 0x1ac, 0x229, 0x234, 0x277,
                   0x279, 0xb2, 0x3d9, 0x3da, 0x3db, 0x3dc, 0x3dd, 0x3de,
                   0x3df, 0x3e0]) {
    clips[String(m)] = motion(8, 0, 13);
  }
  return {
    ...CHARS,
    deaths: { front, back },
    types: { "1": { ...TYPE, motions: { ...TYPE.motions, ...clips } } },
  } as unknown as CharactersJson;
}

/** Kill `z` the way a shot does, and run the frame that dispatches it. */
function killAndRun(z: ZombieActor, rng = new Rng(3)): void {
  z.hp = 0;
  z.dead = true;
  z.flags |= ActorFlag.Dead;
  z.pendingHit = { bone: 1, result: HitResultCode.Damaged, player: 0 };
  EnemyZombieUpdate(z, frame(rng));
}

/** A captor in state 35 on a one-entry target script with no target. */
function mauler(clip: number, tables = deathTables()): ZombieActor {
  const script = {
    state: ZombieState.TargetMotionScript, head: {},
    entries: [{ motion: clip, frame: 0, loops: 2, mode: -1 }],
  };
  return zombie(ZombieState.TargetMotionScript, {
    attackState: ZombieState.AttackRun, targetAt: -1,
    script: { target: script, attack: null },
  }, 1, tables);
}

console.log("\nthe kill-move deaths: obj+0x1368 bits 8, 0x10, 0x40, 0x80:");
{
  // `ZombieStateTargetMotionScript` sub 0 (`0x0045AF07`..): the clip just set
  // names the bit, and `ChooseDeathMotion` (`0x004560FB`..) the death.
  const cases: [number, number, number][] = [
    [0x1ab, Zombie1368Flag.DeathClip1AC, 0x1ac],
    [0x1a3, Zombie1368Flag.DeathClip1A5, 0x1a5],
    [0x1a7, Zombie1368Flag.DeathClip1A5, 0x1a5],
    [0x234, Zombie1368Flag.DeathClip229, 0x229],
    [0x277, Zombie1368Flag.DeathClip279, 0x279],
  ];
  for (const [clip, bit, death] of cases) {
    const tables = deathTables();
    (tables.types["1"]!.motions as Record<string, unknown>)[String(0x1a7)] =
      motion(8, 0, 13);
    const z = mauler(clip, tables);
    EnemyZombieUpdate(z, frame());
    check(`a maul entry on clip 0x${clip.toString(16)} raises bit `
          + `0x${bit.toString(16)}`,
          z.motion === clip && z.zom.flags1368 === bit,
          `motion 0x${z.motion.toString(16)} flags 0x${z.zom.flags1368.toString(16)}`);
    killAndRun(z);
    check(`...and a captor killed in it dies on 0x${death.toString(16)}`,
          z.state === ZombieState.Death && z.motion === death,
          `state ${z.state} motion 0x${z.motion.toString(16)}`);
  }
}
{
  // Sub 1's jump table has three cases, not five: a later entry on 0x234
  // raises nothing.
  const z = mauler(0x1ab);
  const s = z.script!.target!;
  s.entries = [{ motion: 0x1ab, frame: 0, loops: 1, mode: -1 },
               { motion: 0x234, frame: 0, loops: 1, mode: -1 }];
  const rng = new Rng(4);
  for (let i = 0; i < 40 && z.motion !== 0x234; i++) {
    EnemyZombieUpdate(z, frame(rng));
    ActorAdvanceMotion(z, 1 / 60);
  }
  EnemyZombieUpdate(z, frame(rng));
  check("a second entry on 0x234, loaded by sub 1, raises no bit of its own",
        z.motion === 0x234
        && z.zom.flags1368 === Zombie1368Flag.DeathClip1AC,
        `motion 0x${z.motion.toString(16)} flags 0x${z.zom.flags1368.toString(16)}`);
}
{
  // The first bit up names the clip: 8 before 0x10.
  const z = mauler(0x1ab);
  EnemyZombieUpdate(z, frame());
  z.zom.flags1368 |= Zombie1368Flag.DeathClip1A5 | Zombie1368Flag.DeathClip229;
  killAndRun(z);
  check("with several kill-move bits up, bit 8's clip wins",
        z.motion === 0x1ac, `0x${z.motion.toString(16)}`);
}
{
  // `ZombieStateDragTarget` sub 0 raises 0x10 at `0x0045C0ED`.
  const script = { state: ZombieState.DragTarget, head: { loops: 5, cue: 3 },
                   entries: [] };
  const z = zombie(ZombieState.DragTarget, {
    attackState: ZombieState.AttackRun, targetAt: -1,
    script: { target: script, attack: null },
  }, 1, deathTables());
  EnemyZombieUpdate(z, frame());
  check("the drag raises bit 0x10 as it starts",
        (z.zom.flags1368 & Zombie1368Flag.DeathClip1A5) !== 0,
        `0x${z.zom.flags1368.toString(16)}`);
}
{
  // Clip 0xB2's arm: `obj+0x136C |= 0x100002` and the arc target 25 ahead.
  const z = mauler(0xb2);
  z.pos = vec3(10, 0, 40);
  z.yaw = 0x4000;
  EnemyZombieUpdate(z, frame());
  const ground = G.g_camera_fixed_eye_y;
  check("a maul on clip 0xB2 raises Carried and DeathPairToFirst",
        (z.flags2 & ZombieFlag2.Carried) !== 0
        && (z.flags2 & ZombieFlag2.DeathPairToFirst) !== 0,
        (z.flags2 >>> 0).toString(16));
  check("...and aims the arc record 25 along the facing, on the ground",
        Math.abs(z.arcTo.x - 35) < 1e-4 && Math.abs(z.arcTo.z - 40) < 1e-4
        && z.arcTo.y === ground,
        `${z.arcTo.x} ${z.arcTo.y} ${z.arcTo.z}`);
  killAndRun(z);
  check("...so a captor shot in it is thrown: state 9, not 6",
        z.state === ZombieState.DeathKnockbackArc, `state ${z.state}`);
  // `0x0045AB63`: the carry comes down on the clip's last cursor.
  const w = mauler(0xb2);
  const rng = new Rng(6);
  let carried = 0;
  for (let i = 0; i < 12; i++) {
    EnemyZombieUpdate(w, frame(rng));
    if (w.flags2 & ZombieFlag2.Carried) carried++;
    ActorAdvanceMotion(w, 1 / 60);
  }
  EnemyZombieUpdate(w, frame(rng));
  check("...and the carry comes down at the clip's end",
        carried > 0 && MotionPlayFrame(w) === 12
        && (w.flags2 & ZombieFlag2.Carried) === 0,
        `${carried} frames, cursor ${MotionPlayFrame(w)}`);
}

console.log("\nthe directional death's remaps, obj+0x136C bits 1, 2 and 4:");
{
  // The fixture's tables put 0x3D9 in the 0x0000 arc and 0x3DC in the 0x8000
  // arc. `desc_flags` is the descriptor's +0x20 word, the low half of
  // `obj+0x136C` (`EnemyZombieInit`, `0x00452EAF`).
  const dying = (desc: number, facingAway: boolean, back = [0x3dc]) => {
    const z = zombie(ZombieState.NoOp, { descFlags: desc }, 1,
                     deathTables([0x3d9], back));
    z.yaw = 0x1000;
    // On a clip of its own, so the death's blend has a pose to fade from.
    z.motion = 10;
    G.g_camera_block_yaw_bams = facingAway ? 0x1000 : 0x9000;
    return z;
  };
  let z = dying(0, true);
  killAndRun(z);
  check("with no remap bit the 0x0000 arc's 0x3D9 stands",
        z.motion === 0x3d9, `0x${z.motion.toString(16)}`);
  z = dying(ZombieFlag2.LetGo, true);
  killAndRun(z);
  check("bit 1 maps 0x3D9 to 0x3DB", z.motion === 0x3db,
        `0x${z.motion.toString(16)}`);
  check("...and the fade dissolves into the clip it loaded, 0x3D9 at 0",
        z.fadeInto?.motion === 0x3d9 && z.fadeInto.ticks === 0
        && z.fadeFrom !== null,
        JSON.stringify(z.fadeInto));
  // Fade 5 holds the start frame five more frames; the sixth lets go.
  for (let i = 0; i < 6; i++) ActorAdvanceMotion(z, 1 / 60);
  check("...until the fade lets go, and 0x3DB plays on from cursor 1",
        z.fadeInto === null && z.fadeFrom === null && z.motion === 0x3db
        && MotionPlayFrame(z) === 1,
        `${JSON.stringify(z.fadeInto)} ${MotionPlayFrame(z)}`);
  z = dying(ZombieFlag2.LetGo | ZombieFlag2.DeathPairToFirst, true);
  killAndRun(z);
  check("bits 1 and 2 together take 0x3D9 there and back", z.motion === 0x3d9
        && z.fadeInto === null, `0x${z.motion.toString(16)}`);
  z = dying(ZombieFlag2.DeathPairToFirst, false);
  killAndRun(z);
  check("bit 2 maps the 0x8000 arc's 0x3DC to 0x3DA", z.motion === 0x3da,
        `0x${z.motion.toString(16)}`);
  // Bit 4 re-draws a side clip from the 0x8000 table, with its own rand().
  // The shipped 0x8000 table, `0x00593084`'s six words.
  const table = [0x3d9, 0x3dd, 0x3db, 0x3dc, 0x3dd, 0x3de];
  z = dying(ZombieFlag2.DeathNoSideClip, true, table);
  G.g_camera_block_yaw_bams = 0x5000;          // rel 0x4000: the side literal
  const rng = new Rng(9);
  const expect = table[new Rng(9).int(6)];
  killAndRun(z, rng);
  check("bit 4 re-draws the side death 0x3E0 from the 0x8000 table",
        z.motion === expect && z.fadeInto?.motion === 0x3e0,
        `0x${z.motion.toString(16)} ${JSON.stringify(z.fadeInto)}`);
}

console.log("\nthe frame a corpse lies on (ZombieCorpsePoseFrame):");
{
  // The shipped 26 words at `0x0059301C`, as the bundle carries them.
  const CORPSE = [104, 98, 96, 84, 76, 75, 160, 152, 83, 80, 83, 82, 94, 91,
                  73, 70, 68, 65, 149, 153, 43, 41, 64, 62, 65, 72];
  const tables = deathTables();
  (tables.deaths as { corpse?: number[] }).corpse = CORPSE;
  const corpse = (clip: number) => {
    const z = zombie(ZombieState.NoOp, {}, 1, tables);
    z.motion = clip;
    z.playTicks = 7;
    z.flags |= ActorFlag.PoseFrozen;
    z.state = ZombieState.CorpseSink;
    z.sub = 0;
    return z;
  };
  // 0x3DB is the third directional death: words 4 and 5, 76 and 75.
  const z = corpse(0x3db);
  const rng = new Rng(12);
  const seen = new Map<number, number>();
  let frames = 0;
  while (!z.despawned && frames < 200) {
    EnemyZombieUpdate(z, frame(rng));
    frames++;
    if (!z.despawned) seen.set(z.playTicks, (seen.get(z.playTicks) ?? 0) + 1);
  }
  check("a corpse on clip 0x3DB holds counter 76, and 75 once in seventeen",
        seen.size === 2 && (seen.get(76) ?? 0) > (seen.get(75) ?? 0)
        && (seen.get(75) ?? 0) > 0,
        JSON.stringify([...seen]));
  const ref = new Rng(12);
  for (let i = 0; i < 0x77; i++) ref.int(17);
  check("...one rand() a frame, on every frame but the last of 0x78",
        frames === 0x78 && rng.next() === ref.next(), `${frames} frames`);
  // A clip with no row keeps what the death left, and draws nothing.
  const k = corpse(0x1ac);
  const krng = new Rng(12);
  EnemyZombieUpdate(k, frame(krng));
  check("a kill-move corpse (0x1AC) keeps its counter and draws no rand()",
        k.playTicks === 7 && krng.next() === new Rng(12).next(),
        `${k.playTicks}`);
}

console.log("\nthe wake a zombie leaves in the water (ActorCheckWaterEntry):");
{
  // A water surface (`coli` surface 5) at y = 10 over the whole scene.
  const WATER = coliQuad([0, 1, 0, -10], 1,
                         [-200, 10, 200, 200, 10, 200, 200, 10, -200,
                          -200, 10, -200], 5);
  const HIPS = 15;
  const tables = {
    ...CHARS,
    types: { "1": { ...TYPE, motions: {
      ...TYPE.motions,
      // A clip whose root stands `HIPS` up, for the hip test.
      "30": { bank: "t", frames: 4, fps: 30, rot: [],
              root: [0, HIPS, 0, 0, HIPS, 0, 0, HIPS, 0, 0, HIPS, 0] },
    } } },
  } as unknown as CharactersJson;
  const wader = (condition: number, y: number) => {
    const z = zombie(ZombieState.NoOp, { condition }, 1, tables);
    T.coli = { files: ["test"], blobs: { water: WATER } } as typeof T.coli;
    G.g_coli_full_set = ["water"];
    // No floor quad: the ground push's miss falls back to the fixed eye
    // height, which is where the actor is put, so it stays at `y`.
    G.g_camera_fixed_eye_y = y;
    z.pos = vec3(4, y, 40);
    z.yaw = 0x4000;
    z.motion = 30;
    return z;
  };
  const events = new Events();
  const heard: number[] = [];
  events.on("sound.play", ({ id }) => heard.push(id));
  const step = (z: ZombieActor) => {
    EnemyZombieUpdate(z, { ...frame(), events });
    AttachedEffectsTick(events);
  };

  let z = wader(6, 0);
  step(z);
  const [a, b] = G.g_attached_effects;
  check("a wading actor under the surface spawns the pair, once",
        G.g_attached_effects.length === 2 && a!.flags === 0
        && b!.flags === ATTACHED_EFFECT_KIND1
        && (z.zom.flags1368 & Zombie1368Flag.InWater) !== 0,
        `${G.g_attached_effects.length}`);
  check("...each at the surface's height, each holding a hit slot",
        a!.height === 10 && b!.height === 10
        && a!.hitSlot !== HIT_SLOT_NONE && b!.hitSlot !== HIT_SLOT_NONE
        && G.g_hit_slots[a!.hitSlot] === a!.at,
        `${a!.height} ${a!.hitSlot} ${b!.hitSlot}`);
  // Kind 0 follows while `BackingOff` is down, faced half round; still, it
  // fades from its 0.05 by 0.015. It stands 2.0 ahead on its own z.
  const d = a!.drawn!;
  check("kind 0 follows, faced 0x8000 round, 2 ahead: (4 - 2, 10, 40)",
        a!.mode === 0 && a!.yaw === 0xc000 && Math.abs(d.x - 2) < 1e-4
        && d.y === 10 && Math.abs(d.z - 40) < 1e-4
        && d.alpha === Math.fround(Math.fround(0.05) - Math.fround(0.015))
        && d.slot === ATTACHED_EFFECT_FIRST_SLOT,
        JSON.stringify(d));
  check("kind 1 lets go where the actor stands", b!.mode === 1
        && b!.x === 4 && b!.z === 40, `${b!.mode} ${b!.x} ${b!.z}`);
  // Moving, kind 0 grows and its cel counter runs a whole cel a frame.
  for (let i = 0; i < 3; i++) { z.pos.z -= 1; step(z); }
  check("moving, kind 0 grows in and steps its cel",
        a!.alpha > d.alpha && a!.drawn!.slot === ATTACHED_EFFECT_FIRST_SLOT + 3,
        `${a!.alpha} 0x${a!.drawn?.slot.toString(16)}`);
  check("...and the wading actor makes no footfall",
        !heard.some((id) => id === 0x2616a9 || id === 0x2916a9));
  // `Committed` rising is the splash, once per task.
  z.flags |= ActorFlag.Committed;
  step(z);
  check("the actor's commit rising plays COMMON\\SIBUKI8_16 once a task",
        heard.filter((id) => id === SND_ATTACHED_EFFECT_SPLASH).length === 2,
        heard.map((x) => x.toString(16)).join(","));
  const slots = [a!.hitSlot, b!.hitSlot];
  z.state = ZombieState.DeathKnockbackArc;
  step(z);
  check("state 9 ends both, and gives their hit slots back",
        G.g_attached_effects.length === 0
        && slots.every((s) => G.g_hit_slots[s] === HIT_SLOT_NONE),
        `${G.g_attached_effects.length}`);

  // Any other body condition needs its hips above the surface.
  z = wader(0, 0);
  step(z);
  check("a standing actor whose root is above the surface spawns it",
        G.g_attached_effects.length === 2, `${G.g_attached_effects.length}`);
  // At y = -5 the root is level with the surface, `FCOMP` says not above;
  // the trace starts at y + 20 = 15, above the water, and finds it.
  z = wader(0, -5);
  step(z);
  check("...and one whose root is under it does not",
        G.g_attached_effects.length === 0
        && (z.zom.flags1368 & Zombie1368Flag.InWater) === 0,
        `${G.g_attached_effects.length}`);
  z = wader(6, 12);
  step(z);
  check("an actor above the surface spawns nothing",
        G.g_attached_effects.length === 0, `${G.g_attached_effects.length}`);
  // A corpse is not live: `ZombieEnterCorpseState` drops bit 0.
  z = wader(6, 0);
  step(z);
  ZombieEnterCorpseState(z);
  AttachedEffectsTick(events);
  check("the actor becoming a corpse ends the pair",
        G.g_attached_effects.length === 0 && (z.flags & ActorFlag.Live) === 0,
        `${G.g_attached_effects.length}`);
}
