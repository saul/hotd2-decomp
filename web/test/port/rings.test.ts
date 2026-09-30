import type { CharactersJson } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { ActorSpawn, GameUpdate } from "../../src/game/director";
import { ActorAdvanceMotion } from "../../src/game/motion";
import { MotionFlag } from "../../src/game/actor";
import { G, HIT_SLOT_NONE, ResetGameGlobals } from "../../src/game/globals";
import { NULL_HOST, type GameHost } from "../../src/game/host";
import { SpriteEffectKind } from "../../src/game/effects/sprite";
import { MarkActorShot } from "../../src/game/combat/shot";
import {
  MotionPlayFrame, MotionPlayLength, SetGameTables, T,
} from "../../src/game/tables";
import { StrikeSub, ZombieState } from "../../src/game/class30/states";
import { ZombieStateStrike } from "../../src/game/class30/strike";
import {
  ActorFlag, ZombieFlag2, type Actor, type ZombieActor,
} from "../../src/game/actor";
import { EnemyZombieUpdate } from "../../src/game/class30";
import { ZombieStateTargetMotionScript } from "../../src/game/class30/target";
import {
  SEVERED_HEAD_RING_BOUNCE, SEVERED_HEAD_RING_SETTLE, SeveredHeadUpdate,
  SpawnSeveredHead,
} from "../../src/game/effects/severed_head";
import {
  COND_WADING, SND_WADE_SPLASH, STRIKE_FRAME_SPLASH_LEAD, WADE_MOTION,
  ZombieStrikeFrameSplash, ZombieStrikeStartSplash,
} from "../../src/game/class30/splash";
import { SpawnClass } from "../../src/game/spawn_class";
import {
  ThrowerStateCorpseBlink, ThrowerStateCorpseSink,
} from "../../src/game/class31/death";
import { ThrowerState } from "../../src/game/class31/states";
import { vec3, type Vec3 } from "../../src/game/vec";
import { LerpAngleShortWay } from "../../src/game/vec";
import {
  CLASS21_FREED_START_CURSOR, CLASS21_MOTION_FREED, CLASS21_SINK_FRAMES,
  RescueTargetFreedDrift, RescueTargetState, RescueTargetUpdate,
} from "../../src/game/class21";
import {
  check, motion, TYPE, CHARS, SCENE_MAJOR_PLAYING, spawnZombie, EnterPlay,
  coliQuad, FLOOR_BLOB, thrower,
} from "./harness";

// -- every caller of the ring effects, where the exe calls it -----------------
//
// `SpawnGroundRingEffect` (`FUN_00407DA0`), `SpawnRingEffectAtPose`
// (`FUN_00408370`) and `SpawnWaterRing` (`FUN_004567C0`) have twenty-six call
// sites between them -- every `E8` rel32 in `.text` aimed at one of the three,
// which is exactly the list Ghidra's cross-references give. These are the ones
// the port had not wired: class 0x31's two corpse states, the rescue target's
// freed state, the severed head's bounce and settle, the strike's two wading
// splashes, and the wading clip in the surfacing entrance and the captor
// script. Every assertion that names a ring fails on the port as it was.
console.log("\nevery caller of the ring effects, where the exe calls it:");

// -- class 0x31: `EnemyThrowerInit`'s bit, and the two corpse states ---------
{
  const t0 = thrower(ThrowerState.StandAndDecide);
  check("`EnemyThrowerInit` raises `obj+0x1F8` bit 4 (`OR EDX, 4` at "
        + "`0x00449694`), as `EnemyZombieInit` does",
        (t0.motionFlags & MotionFlag.TraceGround) !== 0,
        `0x${t0.motionFlags.toString(16)}`);

  // A floor at 0 and a shelf at 26: a trace that starts 20 above a body at 1
  // finds the floor, one that starts 25.5 above it finds the shelf.
  const SHELF_BLOB = coliQuad([0, 1, 0, -26], 1,
                              [-200, 26, 200, 200, 26, 200, 200, 26, -200,
                               -200, 26, -200]);
  const corpse = (motion: number, y: number) => {
    const a = thrower(ThrowerState.StandAndDecide);
    T.coli = { files: ["test"],
               blobs: { floor: FLOOR_BLOB, shelf: SHELF_BLOB } } as never;
    G.g_coli_full_set = ["floor", "shelf"];
    a.pos = vec3(0, y, 80);
    a.lookAt = vec3(2, y + 9, 83);
    a.yaw = 0x1230;
    a.motion = motion;
    a.action = { motion, ticks: 0 };
    a.flags |= ActorFlag.PoseFrozen | ActorFlag.Dead;
    a.dead = true;
    a.state = ThrowerState.Corpse;
    a.sub = 0;
    return a;
  };

  {
    const a = corpse(285, 1);
    ThrowerStateCorpseSink(a, 1 / 60, new Rng(15));
    const r = G.g_ring_effects[0];
    check("a thrower's sinking corpse opens one ground ring on its first frame "
          + "(`CALL 0x00407DA0` at `0x0044AA16`)",
          G.g_ring_effects.length === 1, `${G.g_ring_effects.length}`);
    check("...under the tracked bone, on the floor traced from twenty above, "
          + "at the body's yaw and scale 1",
          r !== undefined && r.x === 2 && r.z === 83
          && r.y === Math.fround(0.05) && r.yaw === 0x1230 && r.scale === 1,
          JSON.stringify(r && { x: r.x, y: r.y, z: r.z, yaw: r.yaw }));
    check("...and sub 0 runs on into sub 1: the first frame sinks and counts",
          a.sub === 1 && a.slideTimer === 0x77
          && Math.abs(a.pos.y - (1 - 0.04)) < 1e-9,
          `sub ${a.sub} count ${a.slideTimer} y ${a.pos.y}`);
  }
  {
    const a = corpse(0x3a6, 1);
    ThrowerStateCorpseSink(a, 1 / 60, new Rng(15));
    check("...but frozen on clip 0x3A6 it lifts the body 5.5 for the call "
          + "(`[0x00565DEC]`), so the trace finds the shelf",
          G.g_ring_effects[0]?.y === Math.fround(26 + Math.fround(0.05)),
          `${G.g_ring_effects[0]?.y}`);
    check("...and puts the height back before it sinks",
          Math.abs(a.pos.y - (1 - 0.04)) < 1e-9, `${a.pos.y}`);
  }
  {
    const a = corpse(0x3a6, 1);
    ThrowerStateCorpseBlink(a, 1 / 60, new Rng(15));
    check("the blinking corpse opens the same ring (`0x0044ABA2`)",
          G.g_ring_effects.length === 1
          && G.g_ring_effects[0]?.y === Math.fround(26 + Math.fround(0.05)),
          `${G.g_ring_effects.length}`);
  }
  {
    // The pose pin draws `rand()` on every frame but the last, not once.
    const a = corpse(0x3a6, 1);
    const rng = new Rng(15);
    const seen = new Set<number>();
    let frames = 0;
    while (!a.despawned && frames < 300) {
      ThrowerStateCorpseSink(a, 1 / 60, rng);
      frames++;
      if (a.action) seen.add(a.action.ticks);
    }
    const ref = new Rng(15);
    for (let i = 0; i < 119; i++) ref.int(17);
    check("the corpse lasts 0x78 frames and pins a fresh pose frame on 119 of "
          + "them -- `rand() % 17 >> 4` a frame, so it can twitch",
          frames === 0x78 && seen.has(44) && seen.has(35)
          && rng.next() === ref.next(),
          `${frames} frames, poses ${[...seen].join(",")}`);
  }
  {
    // The way out is not `ThrowerLeave`: no count, no permit, and the camera
    // slot only for `KeepCameraWhenLast` with nobody else present.
    const a = corpse(285, 1);
    const slot = a.hitSlot;
    a.cameraSlot = 3;
    G.g_enemy_slots[3] = { occupied: 1, at: a.at, prop: null };
    G.g_enemies_present = 1;
    const alive = G.g_enemies_alive;
    const rng = new Rng(15);
    for (let i = 0; i < 200 && !a.despawned; i++) {
      ThrowerStateCorpseSink(a, 1 / 60, rng);
    }
    // `NoCameraTrack` is not a signal here: `ActorDespawn` (`FUN_00409CC0`)
    // raises it on every despawn (`OR EAX, 0x80018000` at `0x00409CCB`), so
    // it is up after this exit as after class 0x30's. The slot is the part
    // only class 0x30's exit touches.
    check("the corpse's exit retires no count and keeps a slot it was not "
          + "told to give up",
          a.despawned && G.g_enemies_alive === alive
          && G.g_enemies_present === 1 && G.g_enemy_slots[3]!.occupied === 1
          && (a.flags & ActorFlag.Live) === 0,
          `alive ${G.g_enemies_alive}/${alive} present ${G.g_enemies_present} `
          + `slot ${G.g_enemy_slots[3]!.occupied}`);
    check("...but frees its hit slot",
          slot !== HIT_SLOT_NONE && G.g_hit_slots[slot] === HIT_SLOT_NONE,
          `slot ${slot}`);

    const b = corpse(285, 1);
    b.flags |= ActorFlag.KeepCameraWhenLast;
    b.cameraSlot = 3;
    G.g_enemy_slots[3] = { occupied: 1, at: b.at, prop: null };
    G.g_enemies_present = 0;
    for (let i = 0; i < 200 && !b.despawned; i++) {
      ThrowerStateCorpseSink(b, 1 / 60, rng);
    }
    check("...and the last one present, which kept the camera, lets it go",
          b.despawned && G.g_enemy_slots[3]!.occupied === 0
          && (b.flags & ActorFlag.NoCameraTrack) !== 0,
          `slot ${G.g_enemy_slots[3]!.occupied}`);
  }
}

// -- class 0x21: the rescue target's freed body --------------------------------
{
  check("`LerpAngleShortWay` takes a BAMS angle half way home the short way",
        LerpAngleShortWay(0x100, 0, 1, 1) === 0x80
        && LerpAngleShortWay(0xff00, 0, 1, 1) === 0xff80,
        `${LerpAngleShortWay(0x100, 0, 1, 1)} ${LerpAngleShortWay(0xff00, 0, 1, 1)}`);

  const RESCUE7 = {
    ...CHARS,
    types: { ...CHARS.types,
             "7": { ...TYPE, type: 7,
                    motions: { "998": motion(16), "972": motion(30, 0, 57) } } },
  } as unknown as CharactersJson;
  // The car's second route, moving one unit of x a camera frame.
  const movingCar: GameHost = {
    ...NULL_HOST,
    objectPath: (slot, frame) => slot === 0x14e
      ? { x: -300 + frame, y: -8, z: -400, yaw: 0x4000, pitch: 0, roll: 0 }
      : null,
  };
  const freed = (host: GameHost) => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(RESCUE7);
    G.g_damage_rank = 0;
    G.g_camera_fixed_eye_y = -20;
    G.g_active_cam_path = 0x39;
    const rng = new Rng(21);
    const events = new Events();
    const a = ActorSpawn(0x7d1, SpawnClass.RankScaledEnemy, 7, "rescue",
                         undefined, rng);
    if (a.cls !== SpawnClass.RankScaledEnemy) throw new Error("not class 0x21");
    a.visible = true;
    a.rescue.state = RescueTargetState.Held;
    a.rescue.route = 1;
    const f = () => RescueTargetUpdate(a, { dt: 1 / 60, rng, host,
                                           events });
    G.g_cam_path_frame = 10; f();
    G.g_cam_path_frame = 11; f();
    a.lookAt = vec3(1, 2, 3);
    MarkActorShot(a, 0, 4);
    G.g_cam_path_frame = 12;
    f();
    return { a, f };
  };

  {
    const { a, f } = freed(movingCar);
    check("the rescue frame hands over to the freed state with the drift run "
          + "once: the car's own step, and a quarter of the way to the ground",
          a.rescue.state === RescueTargetState.Freed
          && a.rescue.freedFrames === 1 && a.pos.x === -288
          && a.pos.y === -11 && a.pos.z === -400,
          `${RescueTargetState[a.rescue.state]} n ${a.rescue.freedFrames} `
          + `${a.pos.x},${a.pos.y},${a.pos.z}`);
    check("...on the freed clip, blended in at play cursor 15",
          a.motion === CLASS21_MOTION_FREED
          && a.playTicks === CLASS21_FREED_START_CURSOR,
          `motion ${a.motion} ticks ${a.playTicks}`);
    check("...its angles re-derived and its hit slot given back",
          a.yaw === 0x4000 && a.hitSlot === HIT_SLOT_NONE,
          `yaw ${a.yaw} slot ${a.hitSlot}`);

    let k = 0;
    while (a.rescue.state === RescueTargetState.Freed && k < 200) { f(); k++; }
    const r = G.g_ring_effects[0];
    check("the freed state opens the ground ring on its 47th frame -- six "
          + "draws held on cursor 15, then 16 up to the play length 57",
          k === 47 && a.rescue.state === RescueTargetState.Sinking
          && G.g_ring_effects.length === 1, `after ${k} frames`);
    check("...under the tracked bone, at the body's own height (no bit 4), "
          + "which the drift has brought down to the ground plane",
          r !== undefined && r.x === 1 && r.z === 3 && r.yaw === 0x4000
          && r.y === Math.fround(a.pos.y + Math.fround(0.05))
          && Math.abs(r.y - (-20 + 0.05)) < 1e-3 && r.scale === 1,
          JSON.stringify(r && { x: r.x, y: r.y, z: r.z }));
    check("...having carried the car's speed off it and bled it out over "
          + "frames 11..20",
          a.rescue.delta.x === 0 && Math.abs(a.pos.x - -273.5) < 1e-3,
          `x ${a.pos.x} dx ${a.rescue.delta.x}`);

    const held = a.playTicks;
    const y0 = a.pos.y;
    let s = 0;
    while (!a.despawned && s < 300) { f(); s++; }
    check("...then sinks 0x78 frames on the clip's last frame, and is gone",
          s === CLASS21_SINK_FRAMES && a.playTicks === held
          && MotionPlayFrame(a) === 57
          && Math.abs(a.pos.y - (y0 - 0.04 * CLASS21_SINK_FRAMES)) < 1e-3,
          `${s} frames, ticks ${held} -> ${a.playTicks}`);
    check("...and `RescueTargetFreedDrift` is exported under its own name",
          typeof RescueTargetFreedDrift === "function");
  }
  {
    // `RescueTargetDraw` draws -- and so reports the clip's end -- only in
    // front of the camera. Behind it, nothing ends the clip.
    const behind: GameHost = {
      ...movingCar,
      viewSpaceOfPoint: (_p: Vec3, out: Vec3) => {
        out.x = 0; out.y = 0; out.z = 5; return true;
      },
    };
    const { a, f } = freed(behind);
    for (let i = 0; i < 120; i++) f();
    check("...and behind the camera the draw is skipped, so no ring and no sink",
          a.rescue.state === RescueTargetState.Freed
          && G.g_ring_effects.length === 0,
          `${RescueTargetState[a.rescue.state]} ${G.g_ring_effects.length}`);
  }
  {
    // The same through `GameUpdate`: the class steps its own clock, so the
    // director must not step it as well -- and must not step it at all once
    // the freed state stops doing so.
    const { a } = freed(movingCar);
    const rng = new Rng(4);
    const events = new Events();
    let k = 0;
    while (a.rescue.state === RescueTargetState.Freed && k < 200) {
      GameUpdate(1 / 60, movingCar, rng, events);
      k++;
    }
    const held = a.playTicks;
    for (let i = 0; i < 20; i++) GameUpdate(1 / 60, movingCar, rng, events);
    check("...and in the frame loop the director leaves the class's clock "
          + "alone: the ring on the same 47th frame, the sink's clip held",
          k === 47 && a.rescue.state === RescueTargetState.Sinking
          && a.playTicks === held,
          `after ${k} frames, ticks ${held} -> ${a.playTicks}`);
  }
}

// -- the severed head's two rings ----------------------------------------------
{
  const head = (slot: number) => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS);
    T.coli = { files: ["test"], blobs: { floor: FLOOR_BLOB } } as never;
    G.g_coli_full_set = ["floor"];
    G.g_camera_block_yaw_bams = 0x4000;
    G.g_camera_yaw_bams = 0xc000;
    SpawnSeveredHead(vec3(0, 10, 0), slot, 0, 0x100);
    const h = G.g_severed_heads[0]!;
    const rng = new Rng(7);
    const rings: { f: number; scale: number; x: number; y: number; z: number;
                   yaw: number; hx: number; hz: number; hyaw: number }[] = [];
    let vx = NaN;
    for (let f = 0; f < 400; f++) {
      const n = G.g_ring_effects.length;
      const hx = h.pos.x, hz = h.pos.z, hyaw = h.yaw;
      const alive = SeveredHeadUpdate(h, rng);
      if (f === 0) vx = h.vel.x;
      for (const r of G.g_ring_effects.slice(n)) {
        rings.push({ f, scale: r.scale, x: r.x, y: r.y, z: r.z, yaw: r.yaw,
                     hx, hz, hyaw });
      }
      if (!alive) break;
    }
    return { rings, vx };
  };
  const soft = head(0x30);
  check("the head is thrown along the camera block's yaw, away from the "
        + "viewer -- not `g_camera_yaw_bams`, half a turn off",
        Math.abs(soft.vx + 0.2) < 1e-9, `vx ${soft.vx}`);
  const scales = soft.rings.map((r) => r.scale);
  const last = soft.rings[soft.rings.length - 1];
  const prev = soft.rings[soft.rings.length - 2];
  check("a soft head leaves a 0.25 ring every bounce and a 0.5 one as it "
        + "settles, the last two on the same frame",
        scales.length >= 2
        && scales.slice(0, -1).every((s) => s === SEVERED_HEAD_RING_BOUNCE)
        && last?.scale === SEVERED_HEAD_RING_SETTLE && prev?.f === last.f,
        scales.join(","));
  check("...each on the floor under the head, at the head's own yaw",
        soft.rings.every((r) => r.y === 0.05 && r.x === r.hx && r.z === r.hz
                         && r.yaw === r.hyaw),
        JSON.stringify(soft.rings[0]));
  const hard = head(0x2015);
  check("...and a head that clinks leaves only the settle's",
        hard.rings.length === 1 && hard.rings[0]!.scale === SEVERED_HEAD_RING_SETTLE,
        hard.rings.map((r) => r.scale).join(","));
}

// -- class 0x30: the wading splashes ---------------------------------------
{
  const WET = coliQuad([0, 1, 0, 0], 1,
                       [-200, 0, 200, 200, 0, 200, 200, 0, -200,
                        -200, 0, -200], 5);
  const SPLASH_CHARS = {
    ...CHARS,
    types: { "1": { ...TYPE, motions: { ...TYPE.motions, "178": motion(30) } },
             "16": { ...TYPE, type: 16 } },
  } as unknown as CharactersJson;
  const wader = (at: number, wet: boolean, cond: number,
                 over: Partial<Actor> = {}, type = 1): ZombieActor => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(SPLASH_CHARS);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    G.g_players_in_play = 1;
    T.coli = { files: ["test"], blobs: { floor: wet ? WET : FLOOR_BLOB } } as never;
    G.g_coli_full_set = ["floor"];
    const z = spawnZombie(at, type, "wader", over);
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.condition = cond;
    z.pos = vec3(3, 0, 20);
    return z;
  };
  const sprites = (since: number) =>
    G.g_sprite_effects.filter((e) => e.id >= since);

  // The strike: `ZombieStrikeStartSplash` as it starts, `ZombieStrikeFrameSplash`
  // 0x14 play frames before its clip ends.
  {
    const z = wader(0x7a00, true, COND_WADING);
    const atk = TYPE.attacks["0"]["1"];
    Object.assign(z, { state: ZombieState.Strike, sub: StrikeSub.Lunge,
                       attack: 1 });
    z.pos = vec3(0, 0, atk.distance - 6);
    const heard: number[] = [];
    const bus = new Events();
    bus.on("sound.play", (d) => heard.push(d.id));
    const rng = new Rng(5);
    const seq0 = G.g_sprite_effect_seq;
    ZombieStateStrike(z, rng, bus);
    const s0 = sprites(seq0);
    check("a wading zombie's swing throws two water rings as it starts "
          + "(`CALL [0x00592BCC]` at `0x00455B69`)",
          G.g_water_rings.length === 2
          && G.g_water_rings.every((r) => r.pos.x === 0 && r.pos.y === 0
                                   && r.pos.z === z.pos.z),
          JSON.stringify(G.g_water_rings.map((r) => r.pos)));
    check("...with a 0x61 splash on the floor and SIBUKI2",
          s0.length === 1 && s0[0]!.kind === SpriteEffectKind.Splash
          && s0[0]!.pos.y === 0 && heard.includes(SND_WADE_SPLASH),
          `${s0.map((s) => s.kind)} ${heard}`);
    let at = -1;
    for (let i = 0; i < 80 && z.state === ZombieState.Strike; i++) {
      ActorAdvanceMotion(z, 1 / 60);
      const t = z.action?.ticks ?? -1;
      const n = G.g_water_rings.length;
      ZombieStateStrike(z, rng, bus);
      if (at < 0 && G.g_water_rings.length > n) at = t;
    }
    check("...and two more 0x14 play frames before the clip's end "
          + "(`CALL [0x00592BD0]` at `0x00455BED`), once",
          at === MotionPlayLength(z, atk.strike) - STRIKE_FRAME_SPLASH_LEAD
          && G.g_water_rings.length === 4
          && (z.flags2 & ZombieFlag2.OneShotFired) !== 0,
          `at cursor ${at}, ${G.g_water_rings.length} rings`);
  }
  {
    const dry = wader(0x7a10, false, COND_WADING);
    ZombieStrikeStartSplash(dry, new Rng(5));
    const deep = wader(0x7a20, true, 0);
    ZombieStrikeStartSplash(deep, new Rng(5));
    deep.flags2 &= ~ZombieFlag2.OneShotFired;
    ZombieStrikeFrameSplash(deep, new Rng(5));
    check("...but not on a dry floor, nor for a body not wading",
          G.g_water_rings.length === 0, `${G.g_water_rings.length}`);
  }

  // State 23's grab: the same start splash, as sprite 0x62, and a 0x62 at the
  // end in place of the feed note.
  {
    const z = wader(0x7a30, true, COND_WADING, {
      initialState: ZombieState.ScriptedGrabAndDespawn, attackState: 1,
      entry: { cue_frame: -1, motion: 186, hit_frame: 10 } as Actor["entry"],
    });
    const rng = new Rng(9);
    const seq0 = G.g_sprite_effect_seq;
    EnemyZombieUpdate(z, { dt: 1 / 60, rng, host: NULL_HOST });
    check("state 23's `-1` cue fires on the spawn frame -- sub 0 runs on into "
          + "sub 1 -- and splashes as the grab starts, sprite 0x62",
          z.sub >= 2 && G.g_water_rings.length === 2
          && sprites(seq0).some((s) => s.kind === SpriteEffectKind.SplashLarge),
          `sub ${z.sub} rings ${G.g_water_rings.length}`);
    for (let i = 0; i < 300 && !z.despawned; i++) {
      EnemyZombieUpdate(z, { dt: 1 / 60, rng, host: NULL_HOST });
      ActorAdvanceMotion(z, 1 / 60);
    }
    const big = sprites(seq0).filter((s) => s.kind === SpriteEffectKind.SplashLarge);
    check("...and ends in a 0x62 at the body as it despawns",
          z.despawned && big.length === 2, `${big.length} of kind 0x62`);
  }

  // The surfacing entrance: clip 0xB8's two cues.
  {
    const z = wader(0x7a40, false, 0, {
      initialState: ZombieState.SurfaceOnCameraCue, attackState: 1,
      entry: { cue_frame: 0 } as Actor["entry"],
    }, 16);
    z.yaw = 0x4000;
    const rng = new Rng(3);
    const seq0 = G.g_sprite_effect_seq;
    EnemyZombieUpdate(z, { dt: 1 / 60, rng, host: NULL_HOST });
    check("state 13 runs sub 0 into its cue test: a cue already reached "
          + "releases the actor on the spawn frame",
          z.motion === WADE_MOTION && z.sub === 2
          && (z.flags & ActorFlag.PoseFrozen) === 0,
          `motion ${z.motion} sub ${z.sub}`);
    const splashes: number[] = [];
    const ringsAt: number[] = [];
    for (let i = 0; i < 60 && z.state === ZombieState.SurfaceOnCameraCue; i++) {
      ActorAdvanceMotion(z, 1 / 60);
      const cur = MotionPlayFrame(z);
      const n = G.g_water_rings.length, s = G.g_sprite_effect_seq;
      EnemyZombieUpdate(z, { dt: 1 / 60, rng, host: NULL_HOST });
      if (G.g_sprite_effect_seq > s) splashes.push(cur);
      if (G.g_water_rings.length > n) ringsAt.push(cur);
    }
    const first = sprites(seq0)[0];
    check("clip 0xB8 splashes at play frames 0x15 and 0x1B, the rings at 0x1B",
          splashes.join() === "21,27" && ringsAt.join() === "27"
          && G.g_water_rings.length === 2,
          `splash ${splashes} rings ${ringsAt}`);
    check("...the splash 0x62, 1.5 ahead of the actor on the floor",
          first?.kind === SpriteEffectKind.SplashLarge
          && Math.abs(first.pos.x - 1.5) < 1e-4 && first.pos.y === 0
          && Math.abs(first.pos.z - 20) < 1e-4,
          JSON.stringify(first?.pos));
  }

  // The captor script: the same wading block, and clip 0xB2's prop strip.
  {
    const z = wader(0x7a50, false, 0);
    z.state = ZombieState.TargetMotionScript;
    z.sub = 2;
    z.motion = WADE_MOTION;
    z.playTicks = 0x1b;
    z.zom.targetCue = -1;
    const seq0 = G.g_sprite_effect_seq;
    ZombieStateTargetMotionScript(z, new Rng(3));
    check("the captor script's wading clip lays the rings at 0x1B too "
          + "(`0x0045AC79`)",
          G.g_water_rings.length === 2
          && sprites(seq0)[0]?.kind === SpriteEffectKind.SplashLarge,
          `${G.g_water_rings.length}`);
    z.motion = 0xb2;
    z.playTicks = 0x16;
    G.g_camera_block_yaw_bams = 0x1234;
    ZombieStateTargetMotionScript(z, new Rng(3));
    const strip = G.g_prop_strip_effects[0];
    check("...and clip 0xB2 throws prop strip kind 0 at 0x16, faced by the "
          + "camera block",
          G.g_prop_strip_effects.length === 1 && strip?.yaw === 0x1234
          && strip.first === 0x1339 && strip.pos.x === 3,
          JSON.stringify(strip && { yaw: strip.yaw, first: strip.first }));
  }
}
