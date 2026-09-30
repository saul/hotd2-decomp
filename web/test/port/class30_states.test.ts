import type { CharactersJson, CharacterType } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { ActorSpawn, GameUpdate } from "../../src/game/director";
import { makeCameraSlots } from "../../src/game/camera/slots";
import { CamPathCueReached } from "../../src/game/camera/path";
import { ActorAdvanceMotion } from "../../src/game/motion";
import { CameraActorTick } from "../../src/game/camera/actor";
import { CameraFromViewAngles } from "../../src/game/camera/hooks";
import { CameraDriverSelectMode, CameraMode } from "../../src/game/camera/mode";
import { CameraDriverFromDeferredPose } from "../../src/game/camera/track";
import {
  G, HIT_SLOT_NONE, PlayerState, ResetGameGlobals,
} from "../../src/game/globals";
import { NULL_HOST } from "../../src/game/host";
import {
  AttackListOf, MotionPlayFrame, SetGameTables,
} from "../../src/game/tables";
import { ZombieState } from "../../src/game/class30/states";
import { ZombieAttackRefusal, ZombieStateHoldAtRange }
  from "../../src/game/class30/hold";
import { ZombiePickAttack } from "../../src/game/class30/strike";
import { ZombieStateWalkDistance } from "../../src/game/class30/walk_distance";
import { ZombieArmedHands, ZombiePickThrowingHand,
         ZombieShouldStandAndThrow, ZombieStateStandAndThrow }
  from "../../src/game/class30/stand_throw";
import { ThrownWeaponPoolUpdate } from "../../src/game/class31/projectile";
import {
  ZOMBIE_AXE_SPIN, ZOMBIE_WEAPON_ROLL,
} from "../../src/game/class30/thrown_weapon";
import { ZombieThrowHandWeapon } from "../../src/game/class30/throw";
import { type ThrownWeaponFrame } from "../../src/game/thrown_weapon";
import {
  ActorFlag, DamageZone, ThrowerFlag, ZombieFlag2, type ZombieActor,
} from "../../src/game/actor";
import {
  ActorScreenHalfSign, ReleaseAttackSlot, ThrowerReleaseAttackPermit,
  ThrowerTryClaimAttackSlot, TryClaimAttackSlot,
} from "../../src/game/combat/permits";
import { ZombieStateApproach } from "../../src/game/class30/approach";
import { ZombieScriptedPickPlayer } from "../../src/game/class30/scripted";
import { ThrowerTryEnterState } from "../../src/game/class31/router";
import {
  ThrowerStateBlinkInThreeHops, ThrowerStateRideObjectPath,
} from "../../src/game/class31/scripted";
import { EnemyZombieUpdate } from "../../src/game/class30";
import { ZombieOnShot } from "../../src/game/class30/on_shot";
import { HIT_SLOT_CLAIMED } from "../../src/game/hit_slots";
import { ZombiePushOutOfWorldAndActors } from "../../src/game/class30/ground";
import {
  ZombieScriptEnded, ZombieStateHoldForCameraCue, ZombieStateTargetMotionScript,
  ZombieStateWalkToPoint,
} from "../../src/game/class30/target";
import {
  AngleWithinTolerance, TurnActorTowardCamera,
} from "../../src/game/actor_turn";
import { SpawnClass } from "../../src/game/spawn_class";
import { ActorBodyConditionFromHands, SPENT_CONDITION }
  from "../../src/game/class30/condition";
import { ThrowerState } from "../../src/game/class31/states";
import { vec3, type Vec3 } from "../../src/game/vec";
import type { ScriptJson } from "../../src/bundle";
import { Walker } from "../../src/script/walker";
import {
  check, motion, TYPE, CHARS, SCENE_MAJOR_PLAYING, EYE, spawnZombie, scene,
  WalkerCameraFrame, SeatCamera, EnterPlay, thrower,
} from "./harness";

/** Slot `i` held by `at`, as a fill or a direct claim leaves it. */
function ClaimSlot(i: number, at = 0): void {
  G.g_enemy_slots[i] = { occupied: 1, at, prop: null };
}

console.log("\nclass 0x30 state 26: the arc alone moves the leap:");
{
  // `ZombieStateDelayedLeap` freezes the pose for the flight — `obj+0x34` bit
  // 0x4000, up for everything but the first frame and the last 0x15 — so the
  // jump clip contributes no root motion while the parabola owns the position.
  // Without it the port applied both and the actor sank through the floor.
  // And 0x3F7 is the limp of a corpse shot out of the air, not a landing: a
  // live actor plays no landing clip at all.
  const LIMP_MOTION = 0x3f7;
  const leaper = (hp = 100) => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    G.g_camera_fixed_eye_y = 0;
    const z = spawnZombie(0x7900, 1, "leaper", {
      initialState: ZombieState.DelayedLeap,
      delayedLeap: { delay: 0, dest: [0, -10, 30], gravity: 0.03674 },
      // All fourteen shipped leapers carry `obj+0x34` bit 0x20000, the
      // ground-snap exemption — without it the snap pins the actor to the
      // fixture's floor on frame one and there is no flight to measure.
      flags: ActorFlag.Airborne,
    });
    z.visible = true;
    z.hp = z.maxHp = hp;
    z.pos = vec3(0, 20, 0);
    return z;
  };

  {
    // The launch's `AND EDX, 0xdffeffff` (`0x004582AA`) drops `0x20000000`
    // and `0x10000` -- `OneShotFired`. It is not `OffScreenPermit` (`0x20000`),
    // which the port cleared, and which is the off-screen attack latch.
    const z = leaper();
    const rng = new Rng(5);
    z.flags2 |= ZombieFlag2.OffScreenPermit | ZombieFlag2.OneShotFired;
    for (let f = 0; f < 5 && z.sub < 2; f++) {
      EnemyZombieUpdate(z, { dt: 1 / 60, rng, host: NULL_HOST });
    }
    check("the leap's launch clears OneShotFired and leaves OffScreenPermit",
          z.sub >= 2 && (z.flags2 & ZombieFlag2.OneShotFired) === 0
          && (z.flags2 & ZombieFlag2.OffScreenPermit) !== 0,
          `sub ${z.sub} flags2 ${z.flags2.toString(16)}`);
  }
  {
    const z = leaper();
    const rng = new Rng(5);
    let lowest = z.pos.y, sawLimp = false, landed = -1;
    for (let f = 0; f < 400 && z.state === ZombieState.DelayedLeap; f++) {
      EnemyZombieUpdate(z, { dt: 1 / 60, rng, host: NULL_HOST });
      ActorAdvanceMotion(z, 1 / 60);
      if (z.motion === LIMP_MOTION) sawLimp = true;
      if (landed < 0 && z.sub >= 4) { landed = f; break; }
      lowest = Math.min(lowest, z.pos.y);
    }
    check("the leap reaches its named point", landed > 0 && lowest <= -9,
          `landed ${landed} lowest ${lowest.toFixed(2)}`);
    // The arc lands a shade *short*, never long: `vel += acc` runs before
    // `pos += vel`, so the last step is one gravity tick smaller.
    check("...and does not sink past it — the freeze suppresses root motion",
          lowest >= -11, `lowest ${lowest.toFixed(2)}`);
    check("...and a live actor never plays the corpse's limp clip", !sawLimp,
          `motion ${z.motion}`);
  }
  {
    // Shot out of the air: the limp is exactly what it is for.
    const z = leaper();
    const rng = new Rng(5);
    let sawLimp = false;
    for (let f = 0; f < 400 && z.state === ZombieState.DelayedLeap; f++) {
      if (f === 12) z.hp = 0;
      EnemyZombieUpdate(z, { dt: 1 / 60, rng, host: NULL_HOST });
      ActorAdvanceMotion(z, 1 / 60);
      if (z.motion === LIMP_MOTION) sawLimp = true;
    }
    check("an actor killed in flight goes limp on the way down", sawLimp,
          `motion ${z.motion}`);
    check("...and lands in the death state, not the attack run",
          z.state === ZombieState.Death, String(z.state));
  }
}

console.log("\nclass 0x30 state 33: the stationary thrower:");
{
  // `ZombieStateStandAndThrow` is the only class-0x30 state that never moves
  // the actor. The port had no state 33, so an entry router since deleted
  // folded it into `AttackRun` and stage 1's axe man -- character type 0x13,
  // whose asset file is `tutorial.bin` -- charged the camera.

  /** `obj+0x34` bit 0x20000 — see `ActorInitFlags` and `class30/ground.ts`. */
  const GROUND_SNAP_EXEMPT = 0x20000;

  const thrower = (cond = 7) => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    G.g_camera_fixed_eye_y = 0;
    const z = spawnZombie(0x7500, 1, "axe man", {
      initialState: ZombieState.StandAndThrow, condition: cond,
      standThrow: { delay_two_hands: 2, delay_one_hand: 2,
                    delay_after_throw: 2, exit_state: 0, walk_distance: 5 },
    });
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.pos = vec3(0, 0, 60);
    return z;
  };

  check("a state-33 spawn starts in StandAndThrow, not AttackRun",
        thrower().state === ZombieState.StandAndThrow,
        String(thrower().state));

  {
    const z = thrower();
    check("both hands start armed", ZombieArmedHands(z) === 2,
          String(ZombieArmedHands(z)));
    // Two frames of delay, then it claims and starts the throw clip.
    for (let i = 0; i < 4; i++) {
      ZombieStateStandAndThrow(z, new Rng(1), NULL_HOST);
    }
    check("it claims a permit and starts a throw clip",
          z.attackPermit >= 0 && (z.motion === 102 || z.motion === 103),
          `permit ${z.attackPermit} motion ${z.motion}`);
    check("...and it has not moved", z.pos.x === 0 && z.pos.z === 60,
          `${z.pos.x}, ${z.pos.z}`);
  }

  // **The hand bookkeeping.** A hand whose draw slot is no longer the one the
  // skeleton gave it has thrown its weapon -- or had it shot off -- and
  // `ZombiePickThrowingHand` must fall back to the other one.
  {
    const z = thrower();
    z.boneSlot["5"] = 0;                       // right hand emptied
    check("an emptied hand disarms", ZombieArmedHands(z) === 1,
          String(ZombieArmedHands(z)));
    check("...and the pick falls back to the other",
          ZombiePickThrowingHand(z, new Rng(1)) === 8,
          String(ZombiePickThrowingHand(z, new Rng(1))));
    z.boneSlot["8"] = 0;
    check("with both empty the pick reports none",
          ZombieArmedHands(z) === 0
          && ZombiePickThrowingHand(z, new Rng(1)) === 0);
  }

  // **`ActorInitFlags`, and the bit that showed.** The spawn record's flags
  // word becomes `obj+0x34` before the class Init runs, and `0x20000` exempts
  // the actor from the per-frame ground snap. Without the word, stage 1's axe
  // man was dropped from the ledge he is placed on to the script's ground
  // plane and threw from behind the wall he had been standing on.
  {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    G.g_camera_fixed_eye_y = 0;          // the ground plane, far below
    const pinned = spawnZombie(0x7600, 1, "on a ledge", {
      initialState: ZombieState.StandAndThrow, condition: 7,
      flags: GROUND_SNAP_EXEMPT,
    });
    pinned.visible = true;
    pinned.hp = pinned.maxHp = 100;
    pinned.pos = vec3(0, 47, 60);
    check("the spawn record's flags word reaches the actor",
          (pinned.flags & GROUND_SNAP_EXEMPT) !== 0,
          `0x${(pinned.flags >>> 0).toString(16)}`);
    check("...and `ActorInitFlags` ORs in bit 0", (pinned.flags & 1) !== 0);
    ZombiePushOutOfWorldAndActors(pinned);
    check("a pinned spawn keeps the height the script placed it at",
          pinned.pos.y === 47, String(pinned.pos.y));

    // ...and one without the bit settles onto the ground plane, as every
    // other stationary thrower in the game does.
    const loose = spawnZombie(0x7601, 1, "not pinned", {
      initialState: ZombieState.StandAndThrow, condition: 7,
    });
    loose.visible = true;
    loose.hp = loose.maxHp = 100;
    loose.pos = vec3(0, 47, 60);
    ZombiePushOutOfWorldAndActors(loose);
    check("...and one without it still snaps to the ground",
          loose.pos.y === 0, String(loose.pos.y));
  }

  // The way out: it backs away by the descriptor's distance and then goes.
  {
    const z = thrower();
    z.boneSlot["5"] = 0;
    z.boneSlot["8"] = 0;                 // both thrown
    z.sub = 4;                           // the recover, with nothing left
    z.motion = 102;                      // 24 frames, so a play length of 46
    // The recover arm waits for `obj+0x19C == play_length - 1` exactly, and
    // the cursor wraps -- so this is frame 45 of 46, not "some time later".
    z.playTicks = 45;
    ZombieStateStandAndThrow(z, new Rng(1), NULL_HOST);
    check("with both hands empty it starts the leave delay",
          z.zom.throwDelay === 2, String(z.zom.throwDelay));
    for (let i = 0; i < 4; i++) {
      ZombieStateStandAndThrow(z, new Rng(1), NULL_HOST);
    }
    check("...and then walks away rather than despawning on the spot",
          z.state === ZombieState.WalkDistance && z.zom.targetArrive === 5
          && !z.despawned,
          `${ZombieState[z.state]} arrive ${z.zom.targetArrive} `
          + `despawned ${z.despawned}`);
    check("...backwards, on `row[4]`",
          (z.flags & ActorFlag.BackingOff) !== 0);
  }

  // **The other way out, and the one the level cannot see.**
  //
  // `ZombieStateStandAndThrow`'s ending is a two-way switch on `obj+0x38` bit
  // 0x10 (`0045945C  TEST byte ptr [ESI + 0x38], 0x10` — `f6463810`), and that
  // bit is not a fact about the room: `EnemyZombieInitByCharType`
  // (`FUN_00452FD0`) **moves** it there out of the spawn record's `obj+0x34`
  // bit 1 at `0045300B`, clearing it at the source. Exactly two records in the
  // shipped game set it — stage 3 block 2 step 4's two axe men, who stand
  // against a building.
  //
  // With the bit unmodelled both of them took the *other* arm and walked their
  // descriptor's twenty-five units backwards through that building, holding
  // `wait_enemies_alive` for the hundred frames it took. `FUN_00457220` has no
  // test that could have stopped them, and the world push at that point in
  // stage 3 is thirty-one quads of flat water twenty-four units below their
  // feet, so nothing in the level was ever going to.
  {
    /** `obj+0x34` bit 1 — the descriptor's "do not walk away". */
    const STAND_THROW_RETIRE = 0x2;
    /** `obj+0x38` bit 4 — what `EnemyZombieInitByCharType` turns it into. */
    const AUX_STAND_THROW_RETIRE = 0x10;

    const axeMan = (flags: number) => {
      ResetGameGlobals();
      EnterPlay();
      SetGameTables(CHARS);
      G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
      G.g_scene_state_major = SCENE_MAJOR_PLAYING;
      G.g_camera_fixed_eye_y = 0;
      const z = spawnZombie(0x7700, 1, "axe man", {
        initialState: ZombieState.StandAndThrow, condition: 7, flags,
        standThrow: { delay_two_hands: 0, delay_one_hand: 0,
                      delay_after_throw: 2, exit_state: 0, walk_distance: 25,
                      leave_delay: 4 },
      });
      z.visible = true;
      z.hp = z.maxHp = 100;
      z.pos = vec3(0, 0, 60);
      return z;
    };

    {
      const z = axeMan(STAND_THROW_RETIRE);
      check("`EnemyZombieInitByCharType` moves the record's bit to obj+0x38",
            (z.flags38 & AUX_STAND_THROW_RETIRE) !== 0
            && (z.flags & STAND_THROW_RETIRE) === 0,
            `0x34 0x${(z.flags >>> 0).toString(16)} `
            + `0x38 0x${(z.flags38 >>> 0).toString(16)}`);
      const plain = axeMan(0);
      check("...and leaves an ordinary record without it",
            (plain.flags38 & AUX_STAND_THROW_RETIRE) === 0,
            `0x${(plain.flags38 >>> 0).toString(16)}`);
    }

    // Both hands already thrown, sitting on the recover's last frame, so the
    // next few calls are the leave delay and then the ending.
    const atTheEnding = (flags: number) => {
      const z = axeMan(flags);
      z.boneSlot["5"] = 0;
      z.boneSlot["8"] = 0;
      z.sub = 4;
      z.motion = 102;
      z.playTicks = 45;                  // play length 46, so frame 45 of it
      return z;
    };

    /**
     * One frame of whichever of the two states the actor is in, so the two
     * endings are driven by the *same* loop and only the descriptor bit is
     * different. Driving state 33 alone would leave a walking actor stepping
     * through a routine that is no longer its own.
     */
    const runFrame = (z: ZombieActor): boolean => {
      if (z.state === ZombieState.StandAndThrow) {
        ZombieStateStandAndThrow(z, new Rng(1), NULL_HOST);
      } else if (z.state === ZombieState.WalkDistance) {
        ZombieStateWalkDistance(z, new Rng(1));
      } else {
        return false;
      }
      ActorAdvanceMotion(z, 1 / 60);
      return true;
    };

    {
      const z = atTheEnding(STAND_THROW_RETIRE);
      const start = { ...z.pos };
      const aliveAtStart = G.g_enemies_alive;
      let moved = 0;
      let goneAt = -1;
      for (let i = 0; i < 600 && goneAt < 0; i++) {
        if (!runFrame(z)) break;
        moved = Math.max(moved, Math.hypot(z.pos.x - start.x,
                                           z.pos.z - start.z));
        if (z.despawned) goneAt = i;
      }
      // **The assertion is where the actor is**, not what state it says it is
      // in. The fixture's throw clips carry root motion, so "did not move"
      // here is the retreat's twenty-five units being absent rather than a
      // clip that happens to stand perfectly still.
      check("a retiring thrower never leaves the spot the script put it on",
            moved < 1, `${moved.toFixed(3)}u from ${JSON.stringify(start)}`);
      check("...it gives the enemy count back where it stands",
            G.g_enemies_alive === aliveAtStart - 1,
            `${G.g_enemies_alive} was ${aliveAtStart}`);
      check("...and the block it was holding can advance",
            G.g_enemies_alive === 0 && G.g_enemies_present === 0,
            `alive ${G.g_enemies_alive} present ${G.g_enemies_present}`);
      check("...then it despawns after the descriptor's own delay",
            goneAt >= 0, `despawned at frame ${goneAt}`);
      check("...having stayed in state 33 the whole time",
            z.state === ZombieState.StandAndThrow, ZombieState[z.state]);
    }

    {
      // The retire arm also frees the hit slot, on the spot and with the
      // index left standing: `if ((obj+0x38 & 0x40) && obj+0x3C != -1)
      // g_hit_slots[obj+0x3C] = 0` at `0x00459535`. The port said the table
      // was not ported and made no write, so the slot stayed held until the
      // despawn, a descriptor's delay later.
      const z = atTheEnding(STAND_THROW_RETIRE);
      const slot = z.hitSlot;
      for (let i = 0; i < 600 && z.sub !== 6 && !z.despawned; i++) {
        if (!runFrame(z)) break;
      }
      check("the retire arm gives the hit slot back before the despawn",
            slot !== HIT_SLOT_NONE && (z.flags38 & HIT_SLOT_CLAIMED) !== 0
            && G.g_hit_slots[slot] === HIT_SLOT_NONE && !z.despawned,
            `slot ${slot} entry ${G.g_hit_slots[slot]} sub ${z.sub} `
            + `despawned ${z.despawned}`);
      check("...and leaves obj+0x3C pointing at it, as the engine does",
            z.hitSlot === slot, `${z.hitSlot} was ${slot}`);
    }

    {
      // The seven records that do *not* set the bit still walk away, and the
      // distance they cover is the descriptor's own. Same fixture, one bit
      // different: the two endings have to be told apart by that bit alone.
      const z = atTheEnding(0);
      const start = { ...z.pos };
      let moved = 0;
      for (let i = 0; i < 600 && !z.despawned; i++) {
        if (!runFrame(z)) break;
        moved = Math.max(moved, Math.hypot(z.pos.x - start.x,
                                           z.pos.z - start.z));
      }
      check("a thrower without the bit walks its descriptor's distance",
            moved > 20, `${moved.toFixed(2)}u`);
      check("...and despawns at the end of it", z.despawned);
    }
  }

  // **The weapon that flies.** `ZombieThrowHandWeapon` (`FUN_0045A240`) puts
  // the projectile at the throwing bone's own world position, leaves the hand
  // bare and hands the permit over. The assertion is on the world: a record in
  // `g_thrown_weapons` carrying the kit's projectile slot, closing on the eye
  // frame after frame, and a hand whose recorded draw slot is now the bare
  // one. What that slot *draws* is the exporter's half.
  {
    const z = thrower();
    const host = {
      ...NULL_HOST,
      boneWorld: (_at: number, _bone: number, out: Vec3) => {
        out.x = 0; out.y = 5; out.z = 60;
        return true;
      },
      aimPoint: (_ahead: number, out: Vec3) => {
        out.x = EYE.x; out.y = EYE.y; out.z = EYE.z;
      },
    };
    const kit = CHARS.types["1"].zombie_throw!;
    // 24, not 12: the throw clip starts over a fade of 4, and the engine
    // holds a faded-in clip on its start frame for the fade's five frames
    // (`SkeletonAdvancePlayCursor`, `FUN_004111A0`) before the cursor moves
    // towards `hit_frame`.
    for (let i = 0; i < 24 && !G.g_thrown_weapons.length; i++) {
      ZombieStateStandAndThrow(z, new Rng(1), host);
      ActorAdvanceMotion(z, 1 / 60);
    }
    // **Two**, because this fixture is character type 1, and type 1 throws
    // both hands on the one release frame -- `ZombieStateStandAndThrow`
    // (`FUN_00459080`) at `0x004592E4`..`0x00459301`.
    check("the throw puts a weapon in the world -- one per hand, for type 1",
          G.g_thrown_weapons.length === 2,
          String(G.g_thrown_weapons.length));
    const w = G.g_thrown_weapons[0];
    check("...drawing the kit's own projectile slot",
          !!w && w.slot === kit.hands[0].projectile, `slot ${w?.slot}`);
    check("...and the hand it left is recorded bare",
          z.boneSlot["5"] === kit.hands[0].bare
          || z.boneSlot["8"] === kit.hands[1].bare,
          JSON.stringify(z.boneSlot));
    const before = Math.hypot(w.pos.x - EYE.x, w.pos.z - EYE.z);
    const rx0 = w.rx, ry0 = w.ry;
    const frame: ThrownWeaponFrame = { cam: null, host,
                                       rng: new Rng(1) };
    for (let i = 0; i < 10; i++) ThrownWeaponPoolUpdate(frame);
    const after = Math.hypot(w.pos.x - EYE.x, w.pos.z - EYE.z);
    check("...and it closes on the camera rather than hanging there",
          after < before - 1, `${before.toFixed(1)} -> ${after.toFixed(1)}`);
    // **Class 0x30's tumble is the X term, and it has no sign test on the
    // hand.** `ZombieThrownWeaponStateStraight` (`FUN_00459690`) at
    // `0x00459731` does `obj+0x64 += obj+0x135C`; class 0x31's
    // `ThrownWeaponFlyToTarget` (`FUN_0044FD40`) at `0x0044FDE9` does
    // `obj+0x68 +=` and negates for the other hand. Both draw the same
    // `Rz * Ry * Rx` product, so the axis is the whole of the difference —
    // and the port turned everything about Y, which cartwheeled exactly one
    // of the two families. It was reported as the spin depending on which
    // zombie threw.
    check("...tumbling about X, which is the axe's term",
          w.rx - rx0 === 10 * ZOMBIE_AXE_SPIN && w.ry === ry0,
          `rx ${rx0} -> ${w.rx}, ry ${ry0} -> ${w.ry}`);
    check("...at the launcher's 0xB00, unsigned by the hand",
          w.spinRate === ZOMBIE_AXE_SPIN, String(w.spinRate));
    check("...with no `obj+0x1364` tilt, which only class 0x31's launcher writes",
          w.tilt === 0, String(w.tilt));
    // `MOV dword ptr [ESI+0x6c], 0x800` at `0x0045A4C4`, and the yaw
    // `VecToAngles` gave it toward its target, which the flight never moves.
    check("...rolled 0x800 and facing its target from the hand",
          w.rz === ZOMBIE_WEAPON_ROLL && ry0 !== 0,
          `rz ${w.rz} ry ${ry0}`);
  }

  // **Sub 0 tests `obj+0x34` bit 0x1000000 and writes `obj+0x136C`.**
  // `0x004590E3`..`0x00459109`: holding already, neither write; otherwise
  // `|= 1`, and `|= 0x100000` too while `obj+0x34` has 0x20000. The port
  // raised the held-weapon bit here instead, and that is what sent stage 3's
  // two type-19 axe men into state 12 when they died.
  {
    const z = thrower();
    ZombieStateStandAndThrow(z, new Rng(1), NULL_HOST);
    check("sub 0 raises obj+0x136C bit 1, not obj+0x34's held-weapon bit",
          (z.flags2 & ZombieFlag2.LetGo) !== 0
          && (z.flags & ActorFlag.HoldingWeapon) === 0,
          `0x34 0x${(z.flags >>> 0).toString(16)} `
          + `0x136C 0x${(z.flags2 >>> 0).toString(16)}`);
    check("...and not 0x100000 on the ground",
          (z.flags2 & ZombieFlag2.Carried) === 0);

    const air = thrower();
    air.flags |= GROUND_SNAP_EXEMPT;
    ZombieStateStandAndThrow(air, new Rng(1), NULL_HOST);
    check("...0x100000 as well when obj+0x34 has 0x20000",
          (air.flags2 & (ZombieFlag2.LetGo | ZombieFlag2.Carried))
          === (ZombieFlag2.LetGo | ZombieFlag2.Carried),
          `0x136C 0x${(air.flags2 >>> 0).toString(16)}`);

    const held = thrower();
    held.flags |= ActorFlag.HoldingWeapon | GROUND_SNAP_EXEMPT;
    ZombieStateStandAndThrow(held, new Rng(1), NULL_HOST);
    check("...and neither when the record already holds a weapon",
          (held.flags2 & (ZombieFlag2.LetGo | ZombieFlag2.Carried)) === 0
          && (held.flags & ActorFlag.HoldingWeapon) !== 0,
          `0x136C 0x${(held.flags2 >>> 0).toString(16)}`);

    // What the write is for: a kill routes on the bit, not on who wrote it.
    // `ZombieOnShot` sends a 0x100000 actor to state 9, and the held-weapon
    // bit sends a state-6 death to state 12 -- which is where the port's
    // raise used to put an airborne axe man with neither in his record.
    air.dead = true;
    air.flags |= ActorFlag.Dead;
    air.pendingHit = { bone: 1, result: 1 };
    ZombieOnShot(air);
    check("...so an airborne thrower killed there dies through state 9",
          air.state === ZombieState.DeathKnockbackArc,
          ZombieState[air.state]);
  }

  // **The hand it throws from can no longer be shot.** `ZombieThrowHandWeapon`
  // (`FUN_0045A240`) zeroes the bone record's `+0x78` -- `MOV [EDI + 0x554],
  // EBX` for bone 5, `[EDI + 0x704]` for bone 8 -- which is the radius
  // `ShotTestBoneSphere` skips on zero.
  {
    const z = thrower();
    const host = {
      ...NULL_HOST,
      boneWorld: (_at: number, _bone: number, out: Vec3) => {
        out.x = 0; out.y = 5; out.z = 60;
        return true;
      },
    };
    check("before the throw the hand has the radius the build gave it",
          (z.boneRadius["5"] ?? 0) > 0, JSON.stringify(z.boneRadius));
    ZombieThrowHandWeapon(z, 5, host);
    check("the throw zeroes the emptied hand's hit-sphere radius",
          z.boneRadius["5"] === 0 && z.boneRadius["8"] === undefined,
          JSON.stringify(z.boneRadius));
  }

  // The other way in: a condition-8 walker already facing the camera. It
  // stands at (0, 0, 60) with the eye at the origin, so a camera looking at
  // it has block yaw `atan2(0, -60)`, 0x8000, and an actor facing that camera
  // has yaw 0 -- `VecToAngles(obj - eye)`, as `TurnActorTowardCamera` turns
  // it. `g_camera_yaw_bams` is left at the value the old reading needed to
  // fail.
  const facing = (cond: number, yaw: number) => {
    const z = thrower(cond);
    z.state = ZombieState.AttackRun;
    G.g_camera_block_yaw_bams = 0x8000;
    G.g_camera_yaw_bams = 0;
    z.yaw = yaw;
    return z;
  };
  {
    const z = facing(8, 0);                    // facing the camera
    check("a condition-8 walker facing the camera stops and throws",
          ZombieShouldStandAndThrow(z, new Rng(1)) && z.attackPermit >= 0,
          `permit ${z.attackPermit}`);
    const away = facing(8, 0x4000);            // ninety degrees off
    check("...and one facing away does not",
          !ZombieShouldStandAndThrow(away, new Rng(1)));
    const edge = facing(8, 0x400);             // on the window's edge
    check("...the window is inclusive: 0x400 off still throws",
          ZombieShouldStandAndThrow(edge, new Rng(1)));
    const past = facing(8, 0x401);
    check("...and 0x401 off does not",
          !ZombieShouldStandAndThrow(past, new Rng(1)));
    const ordinary = facing(0, 0);
    check("...nor does an ordinary body condition",
          !ZombieShouldStandAndThrow(ordinary, new Rng(1)));
  }

  // **From the camera itself.** The window is the camera block's yaw turned
  // half round (`0x00458E48`), and that is only a statement about the game if
  // the block is the one the camera routines build and the walker faces the
  // camera the way the walker's own turn leaves it. So: the camera seated on
  // a look-at at the walker (`CamBlockSetAnglesFromLookAt`, then
  // `UpdateSceneViewAndLight`), the scene state's hook run over it so
  // `g_camera_yaw_bams` holds what the engine writes there -- the block's
  // heading less half a turn -- and the walker turned by
  // `TurnActorTowardCamera` until it stops. The port read `g_camera_yaw_bams`
  // and missed by exactly half a turn; this is the measurement stage 4's
  // `znassb` made in the player, in a form that can fail.
  {
    const z = thrower(8);
    z.state = ZombieState.AttackRun;
    z.pos = vec3(30, 0, 40);
    SeatCamera(EYE, z.pos);
    CameraFromViewAngles();
    z.yaw = 0xc000;
    for (let i = 0; i < 200; i++) TurnActorTowardCamera(z, 0x1a0, 1 / 60);
    const exe = AngleWithinTolerance(
      (G.g_camera_block_yaw_bams - 0x8000) & 0xffff, z.yaw & 0xffff, 0x400);
    const old = AngleWithinTolerance(
      (G.g_camera_yaw_bams - 0x8000) & 0xffff, z.yaw & 0xffff, 0x400);
    check("a walker turned to a camera the camera routines built is inside "
          + "the block's window, and outside the one g_camera_yaw_bams gives",
          exe && !old,
          `yaw ${z.yaw} block ${G.g_camera_block_yaw_bams} `
          + `g_camera_yaw_bams ${G.g_camera_yaw_bams}`);
    check("...so it stops to throw, and takes the permit",
          ZombieShouldStandAndThrow(z, new Rng(1)) && z.attackPermit >= 0,
          `permit ${z.attackPermit}`);
  }

  // **Which order the claim and the hands come in** is the character type's
  // (`0x00458E6D`). `znassb` (type 1, this fixture's) claims first and looks
  // at its hands after, so one with both blades gone still takes the permit
  // and answers no; the two axe types look first and claim only if a hand is
  // armed; any other type answers no and claims nothing, hands or none.
  {
    const bare = facing(8, 0);
    bare.boneSlot["5"] = 7883;
    bare.boneSlot["8"] = 7879;
    check("a znassb with both hands empty answers no...",
          ZombieArmedHands(bare) === 0
          && !ZombieShouldStandAndThrow(bare, new Rng(1)));
    check("...having claimed the permit first, as 0x00458EC3 does",
          bare.attackPermit >= 0
          && G.g_attack_permits[bare.attackPermit] === bare.at,
          `permit ${bare.attackPermit}`);

    const types = (ct: number) => {
      ResetGameGlobals();
      EnterPlay();
      SetGameTables({
        ...CHARS, types: { "1": TYPE, [String(ct)]: { ...TYPE, type: ct } },
      } as unknown as CharactersJson);
      G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
      G.g_scene_state_major = SCENE_MAJOR_PLAYING;
      const z = spawnZombie(0x7510, ct, `type ${ct}`, {
        initialState: ZombieState.AttackRun, condition: 8,
      });
      z.visible = true;
      z.hp = z.maxHp = 100;
      z.pos = vec3(0, 0, 60);
      G.g_camera_block_yaw_bams = 0x8000;
      z.yaw = 0;
      return z;
    };
    const axe = types(0x14);
    axe.boneSlot["5"] = 7883;
    axe.boneSlot["8"] = 7879;
    check("an axe walker with both hands empty answers no and claims nothing",
          !ZombieShouldStandAndThrow(axe, new Rng(1)) && axe.attackPermit === -1
          && G.g_attack_permits.every((x) => x === -1),
          `permit ${axe.attackPermit}`);
    const armedAxe = types(0x13);
    check("...and one with its axes stops and throws",
          ZombieShouldStandAndThrow(armedAxe, new Rng(1))
          && armedAxe.attackPermit >= 0);
    const other = types(2);
    check("any other character type answers no, armed or not, and claims "
          + "nothing",
          ZombieArmedHands(other) === 2
          && !ZombieShouldStandAndThrow(other, new Rng(1))
          && other.attackPermit === -1,
          `armed ${ZombieArmedHands(other)} permit ${other.attackPermit}`);
  }
}

// -- 33b. the body condition, and the throw row it keeps out of the strike --

console.log("\nActorBodyConditionFromHands:");
{
  /**
   * `znonoopa.bin` cut down: character type 0x14, whose conditions 7 and 8
   * name the **throw** — `distance` 99, the clip that swings the axe — and
   * whose conditions 0..2 name an ordinary reach at nineteen units. Both rows
   * are in the shipped table, which is why which one is selected matters more
   * than anything else on this actor.
   */
  const AXE_HANDS = [
    { bone: 5, held: 7929, bare: 7926, weapon_bone: 6, projectile: 585 },
    { bone: 8, held: 7925, bare: 7923, weapon_bone: 9, projectile: 585 },
  ];
  const MELEE = {
    "0": { strike: 100, lunge: 101, distance: 19, hit_frame: 10,
           overlay_kind: 4, cancel_mask: 2 },
    "1": { strike: 100, lunge: 101, distance: 19, hit_frame: 10,
           overlay_kind: 5, cancel_mask: 4 },
  };
  const TYPE_AXE = {
    ...TYPE,
    type: 0x14, name: "znonoopa", file: "znonoopa.bin",
    attacks: { ...TYPE.attacks, "1": MELEE, "2": MELEE },
    attack_picks: { ...TYPE.attack_picks,
                    "1": new Array(80).fill(0), "2": new Array(80).fill(0) },
    zombie_throw: { ...TYPE.zombie_throw, hands: AXE_HANDS },
    motion_row: { ...TYPE.motion_row,
                  "1": [10, 10, 12, 12, 14], "2": [10, 10, 12, 12, 14] },
    // **The throw clips carry root motion here**, unlike the base fixture's.
    // `ApplyRootMotion` returns before the strike floor when the delta is
    // zero, so a clip that stands perfectly still cannot show the shove — and
    // the shove is the whole of the teleport.
    motions: { ...TYPE.motions, "102": motion(24, 0.05),
               "103": motion(20, 0.05) },
  } as unknown as CharacterType;
  const CHARS_AXE = {
    ...CHARS, types: { "1": TYPE, "20": TYPE_AXE },
  } as unknown as CharactersJson;

  const axeman = (cond: number, at = 0x6784) => {
    ResetGameGlobals();
    SetGameTables(CHARS_AXE);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    EnterPlay();
    G.g_camera_fixed_eye_y = 0;
    const z = ActorSpawn(at, SpawnClass.Zombie, 0x14, "znonoopa", {
      initialState: ZombieState.AttackRun, condition: cond,
    });
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.pos = vec3(0, 0, 60);
    z.motion = 12;
    return z;
  };

  // The trap this whole routine exists to avoid, stated as a fact about the
  // table rather than as a claim about the code.
  {
    const z = axeman(8);
    check("body condition 8 selects the throw row, reach ninety-nine",
          AttackListOf(z)["0"]?.distance === 99,
          String(AttackListOf(z)["0"]?.distance));
    z.condition = 1;
    check("...and the melee row is nineteen",
          AttackListOf(z)["0"]?.distance === 19,
          String(AttackListOf(z)["0"]?.distance));
  }

  // `ZombieStateHoldAtRange` is the one caller, so an actor that reaches the
  // ring can no longer be on the throw row.
  {
    const z = axeman(8);
    const rng = new Rng(4);
    const events = new Events();
    let sawStrike = false;
    let struckOnThrowRow = false;
    let maxStep = 0;
    let prev = { ...z.pos };
    for (let i = 0; i < 900; i++) {
      GameUpdate(1 / 60, NULL_HOST, rng, events);
      maxStep = Math.max(maxStep, Math.hypot(z.pos.x - prev.x,
                                             z.pos.y - prev.y,
                                             z.pos.z - prev.z));
      prev = { ...z.pos };
      if (z.state === ZombieState.Strike) {
        sawStrike = true;
        if (z.condition === 8 || z.condition === 7) struckOnThrowRow = true;
      }
    }
    check("a condition-8 walker reaches the strike", sawStrike);
    check("...never on the throw row", !struckOnThrowRow,
          `condition ${z.condition}`);
    // The teleport, in one number. The run clip carries 1.289 units a frame
    // and the lunge 0.6; anything above a couple of units in a single frame is
    // `ApplyRootMotion`'s floor shoving the actor out to the throw's own
    // ninety-nine-unit range, which is what "gets close, then teleports back
    // and starts throwing" looked like.
    check("...and it never jumps across the room in one frame", maxStep < 3,
          `${maxStep.toFixed(2)} units`);
    check("...it ends up on a hand-derived condition",
          z.condition <= 2, String(z.condition));
  }

  // The routine on its own: the two sticky values, and the operand the engine
  // reads wrong.
  {
    const z = axeman(7);
    ActorBodyConditionFromHands(z);
    check("condition 7 is sticky -- the stationary thrower's own row survives",
          z.condition === 7, String(z.condition));
    const spent = axeman(SPENT_CONDITION);
    ActorBodyConditionFromHands(spent);
    check("...and so is 5", spent.condition === SPENT_CONDITION,
          String(spent.condition));

    const intact = axeman(8);
    ActorBodyConditionFromHands(intact);
    // `0x0045599C` compares the **right** hand's slot against the left hand's
    // held value, so `znonoopa`'s left hand can never count as armed. One
    // hand, condition 1, and `DamageZone.LeftArm` already set -- which is what
    // pins its attack pick to the right-arm swing.
    check("both hands intact still gives condition 1, not 2",
          intact.condition === 1, String(intact.condition));
    check("...with the left arm marked destroyed, as the engine has it",
          (intact.zones & DamageZone.LeftArm) !== 0,
          `zones ${intact.zones}`);

    const empty = axeman(8);
    empty.boneSlot["5"] = 0;
    ActorBodyConditionFromHands(empty);
    check("a thrown right hand takes it to zero", empty.condition === 0,
          String(empty.condition));

    // Character type 1 has no 1-or-2 row, so the routine only ever writes 0.
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    const znassb = ActorSpawn(0x6800, SpawnClass.Zombie, 1, "znassb", {
      initialState: ZombieState.AttackRun, condition: 8,
    });
    znassb.boneSlot["5"] = 7081;             // `znassb`'s own held slots
    znassb.boneSlot["8"] = 7077;
    ActorBodyConditionFromHands(znassb);
    check("character type 1 with both hands armed is left alone",
          znassb.condition === 8, String(znassb.condition));
    znassb.boneSlot["5"] = 0;
    znassb.boneSlot["8"] = 0;
    ActorBodyConditionFromHands(znassb);
    check("...and only falls to zero when both are empty",
          znassb.condition === 0, String(znassb.condition));
  }
}

// -- 33c. the crawler's attack is a leap, and it lands ------------------------

console.log("\nthe crawler's undamaged swing:");
{
  /**
   * `znkager` cut down to the row that matters: character type 12, body
   * condition 4 on every one of its 20 shipped spawns, whose condition-4
   * attack list is two real entries at `0x00566E70`:
   *
   * ```
   *  entry 2  e5 03  1b 04  00 00 d0 41  28 00  09 00  01 00   997 / 1051 / 26.0 / hit 40
   *  entry 3  fa 03  1b 04  00 00 d0 41  03 00  07 00  08 00  1018 / 1051 / 26.0 / hit  3
   * ```
   *
   * and whose condition-4 pick row is ten 2s then ten 3s per zone combo, so an
   * **undamaged** crawler always draws entry 2 and a crawler with its head
   * shot off always draws entry 3.
   *
   * Entry 2's hit frame is 40 against `g_motion_play_length[997]` = 20, and
   * `ZombieStateStrike` fires the hit on `obj+0x19C == entry+0x08` *exactly*
   * (`00455bdf`) while leaving the state at `play_length - 1` (`00455c0b`), so
   * in **that** state the equality is never reached. The frame counts and play
   * lengths below are the real bake — 997 is 11 authored frames with a play
   * length of 20, 1018 is 19 with 35, 1051 is 17 with 31.
   *
   * This section used to conclude from that that "the engine's undamaged
   * crawler swings and misses, every time", and asserted no damage in a
   * minute. **A crawler never runs `ZombieStateStrike`.**
   * `ZombieStateHoldAtRange` sends body condition 4 to state 0x34
   * (`0x0045585E`), `ZombieStateLeapStrike` (`FUN_0045E330`), which lands the
   * entry through `ActorStrikeConnect` when its arc touches down and reads no
   * hit frame at all -- so both entries connect: entry 2's cancel mask is the
   * head, and a crawler that has lost its head draws entry 3, whose mask 8 can
   * never cancel. The draw and the exported entry are unchanged; what this now
   * asserts is the state that reads them. `L53`.
   */
  const CRAWL = {
    "2": { strike: 997, lunge: 1051, distance: 26, hit_frame: 40,
           overlay_kind: 9, cancel_mask: 1 },
    "3": { strike: 1018, lunge: 1051, distance: 26, hit_frame: 3,
           overlay_kind: 7, cancel_mask: 8 },
  };
  const CRAWL_PICKS = Array.from({ length: 80 },
                                 (_, i) => (i % 20 < 10 ? 2 : 3));
  const TYPE_CRAWLER = {
    ...TYPE,
    type: 12, name: "znkager", file: "znkager.bin",
    attacks: { ...TYPE.attacks, "4": CRAWL },
    attack_picks: { ...TYPE.attack_picks, "4": CRAWL_PICKS },
    motion_row: { ...TYPE.motion_row, "4": [10, 10, 12, 12, 14] },
    reactions: { ...TYPE.reactions, "4": TYPE.reactions["0"] },
    motions: { ...TYPE.motions, "997": motion(11, 0.2, 20),
               "1018": motion(19, 0.2, 35), "1051": motion(17, 0.6, 31),
               // `g_class30_leap_strike_arc_script`'s two clips.
               "1052": motion(40), "1053": motion(20) },
  } as unknown as CharacterType;
  const CHARS_CRAWLER = {
    ...CHARS, types: { "1": TYPE, "12": TYPE_CRAWLER },
    combat: {
      arc_scripts: {
        leap_strike: [
          { motion: 0x41c, start: 0, fade: 5, until: 10 },
          { motion: 0x41c, start: 11, fade: 5, until: 38 },
          { motion: 0x41d, start: 0, fade: 3, until: 0 },
        ],
      },
    },
  } as unknown as CharactersJson;

  const crawler = (zones: number) => {
    ResetGameGlobals();
    SetGameTables(CHARS_CRAWLER);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    EnterPlay();
    G.g_camera_fixed_eye_y = 0;
    const z = ActorSpawn(0x4048, SpawnClass.Zombie, 12, "znkager", {
      initialState: ZombieState.AttackRun, condition: 4,
    });
    if (z.cls !== SpawnClass.Zombie) throw new Error("not class 0x30");
    z.visible = true;
    z.attackState = 1;
    z.hp = z.maxHp = 10000;         // it must survive the whole measurement
    z.zones = zones;
    z.pos = vec3(0, 0, 60);
    z.motion = 12;
    return z;
  };

  // The draw, on its own. `ZombiePickAttack` indexes blind, as the engine
  // does: the substitute that used to sit behind this is what made the
  // crawlers dangerous.
  {
    const z = crawler(0);
    const rng = new Rng(3);
    const drawn = new Set<number>();
    for (let i = 0; i < 200; i++) drawn.add(ZombiePickAttack(z, rng));
    check("an undamaged crawler draws entry 2, every time",
          drawn.size === 1 && drawn.has(2), `drew {${[...drawn].join(",")}}`);
    z.zones = DamageZone.Head;
    drawn.clear();
    for (let i = 0; i < 200; i++) drawn.add(ZombiePickAttack(z, rng));
    check("...and with its head shot off, entry 3",
          drawn.size === 1 && drawn.has(3), `drew {${[...drawn].join(",")}}`);
  }

  // The draw must not be second-guessed against the list. A pick naming an
  // index the bundle has no row for is the ten **zeroed** entries the shipped
  // tables carry, and the engine deals no damage on one of those either.
  {
    const z = crawler(0);
    const rng = new Rng(3);
    const bare = {
      ...TYPE_CRAWLER,
      attacks: { ...TYPE.attacks, "4": { "3": CRAWL["3"] } },
    } as unknown as CharacterType;
    const bareChars = {
      ...CHARS, types: { "1": TYPE, "12": bare },
    } as unknown as CharactersJson;
    SetGameTables(bareChars);
    check("a draw the list cannot satisfy is still the draw",
          ZombiePickAttack(z, rng) === 2, String(ZombiePickAttack(z, rng)));
  }

  // And the whole thing running: sixty seconds of one crawler with a live
  // player in front of it.
  const minute = (zones: number) => {
    const z = crawler(zones);
    const rng = new Rng(5);
    const events = new Events();
    let damaged = 0;
    events.on("player.damaged", () => { damaged += 1; });
    let strikes = 0;
    let leaps = 0;
    let was = false;
    const drawn = new Set<number>();
    for (let i = 0; i < 3600; i++) {
      GameUpdate(1 / 60, NULL_HOST, rng, events);
      if (z.state === ZombieState.Strike) strikes += 1;
      const now = z.state === ZombieState.LeapStrike;
      if (now && !was) leaps += 1;
      if (now && z.attack >= 0) drawn.add(z.attack);
      was = now;
    }
    return { strikes, leaps, damaged, drawn: [...drawn].sort() };
  };

  {
    const m = minute(0);
    // The fixture's player has two lives and a continue-less game, so the
    // minute ends with the player down rather than with the crawler tired:
    // three leaps, three hits, as measured when this was written.
    check("it attacks by leaping, again and again until the player is down",
          m.leaps >= 2 && G.g_player_lives[0] === 0,
          `${m.leaps} leaps, lives ${G.g_player_lives[0]}`);
    check("...and never once through ZombieStateStrike", m.strikes === 0,
          `${m.strikes} frames in the strike`);
    check("...on entry 2", m.drawn.length === 1 && m.drawn[0] === 2,
          `drew {${m.drawn.join(",")}}`);
    // The point of the correction.
    check("...and every leap connects: it has no hit frame to miss",
          m.damaged === m.leaps, `${m.damaged} hits from ${m.leaps} leaps`);
  }
  {
    // The other arm: shoot the head off and the same crawler draws entry 3,
    // whose cancel mask of 8 is outside the zone bits, and still connects.
    const m = minute(DamageZone.Head);
    check("a crawler with its head shot off draws entry 3 and connects too",
          m.damaged > 0 && m.drawn.length === 1 && m.drawn[0] === 3,
          `${m.damaged} hits on {${m.drawn.join(",")}}`);
  }
}

// `g_camera_free` -- the gate every room-clear wait needs on top of its
// counter. It decides whether a room hands over on the frame the last enemy
// dies or once the camera has swung back onto its rail, and **which of two
// drivers produces it is a property of the shot**: `finish_sequence` installs
// one out of `g_camera_action_starters` by the scene-state minor it enters.
//
// This half is the minor-7 driver, `CameraDriverFromDeferredPose`
// (`FUN_00402E00`): the slot array and nothing else.
{
  ResetGameGlobals();
  EnterPlay();

  // Claimed: somebody is in the camera's slots.
  ClaimSlot(2);
  G.g_enemies_alive = 1;
  G.g_camera_settled = 1;
  CameraDriverFromDeferredPose();
  check("the camera is not free while an enemy holds a slot",
        G.g_camera_free === 0);

  // The slot empties and the flag rises again -- that is the whole rule.
  G.g_enemy_slots = makeCameraSlots();
  CameraDriverFromDeferredPose();
  check("the camera is free once nothing holds a slot", G.g_camera_free === 1);

  // For *this* driver the rule is the slot array and nothing else. It has no
  // counter test and no turn, which is exactly why it is the wrong rule to
  // apply to the other 572 shots.
  G.g_enemies_alive = 5;
  CameraDriverFromDeferredPose();
  check("...even with enemies alive, if none of them holds a slot",
        G.g_camera_free === 1);
  G.g_camera_settled = 0;
  CameraDriverFromDeferredPose();
  check("...and without waiting for the aim to converge",
        G.g_camera_free === 1);
}

// ...and this half is the minor-4/6 driver, `CameraDriverSelectMode`
// (`FUN_00402650`) with the hand-back it dispatches to.
//
// Reported as the camera snapping and the script moving on the instant a
// zombie died. The engine holds the room until the aim is back on the rail:
// mode 2 is only the permission to *start* turning, and
// `CameraTurnOntoPathTarget` raises the flag on the frame the eased aim
// catches the path's own target.
{
  ResetGameGlobals();
  EnterPlay();
  // A camera at the origin, the rail aimed down +z, and the aim pulled a
  // quarter turn off it by the enemy that has just died.
  const seat = (offDegrees: number) => {
    SeatCamera(vec3(0, 0, 0), vec3(0, 0, 100));
    const a = offDegrees * Math.PI / 180;
    G.g_camera_block_target.x = Math.sin(a) * 100;
    G.g_camera_block_target.y = 0;
    G.g_camera_block_target.z = Math.cos(a) * 100;
  };

  seat(30);
  G.g_enemies_alive = 1;
  ClaimSlot(2);
  G.g_camera_free = 1;
  CameraActorTick();
  CameraDriverSelectMode();
  check("a live enemy puts the camera in the tracking mode and takes the "
        + "room's permission away",
        G.g_camera_mode === CameraMode.TrackEnemies && G.g_camera_free === 0,
        `${G.g_camera_mode} ${G.g_camera_free}`);

  // It dies: the count falls and the slot empties on the same frame, which is
  // what `ZombieReleasePermitAndUntrack` does. The aim is re-seated because
  // the frame above had no actor behind its slot and so aimed at the rail
  // anyway -- where the enemy left the aim is the fixture, not the assertion.
  G.g_enemies_alive = 0;
  G.g_enemy_slots = makeCameraSlots();
  seat(30);
  CameraActorTick();
  CameraDriverSelectMode();
  check("...and when it dies the mode flips, but the room does not hand back "
        + "on that frame",
        G.g_camera_mode === CameraMode.HandBackToPath && G.g_camera_free === 0,
        `${G.g_camera_mode} ${G.g_camera_free}`);

  let frames = 1;
  for (; frames < 600 && G.g_camera_free === 0; frames += 1) {
    CameraActorTick();
    CameraDriverSelectMode();
  }
  check("...it hands back only once the aim has caught the rail",
        G.g_camera_free === 1 && G.g_camera_settled === 1, `${frames}`);
  // 64 frames at thirty degrees off. The assertion is the order of magnitude,
  // not the exact count: it is a second of held camera, not two frames and not
  // five seconds.
  check("...which takes about a second, not a frame",
        frames > 30 && frames < 150, `${frames} frames`);

  // A wider swing takes longer, which is the whole point of easing it.
  const settleFrom = (deg: number): number => {
    ResetGameGlobals();
    EnterPlay();
    seat(deg);
    G.g_enemies_alive = 0;
    G.g_enemy_slots = makeCameraSlots();
    let n = 0;
    for (; n < 600 && G.g_camera_free === 0; n += 1) {
      CameraActorTick();
      CameraDriverSelectMode();
    }
    return n;
  };
  const near = settleFrom(5);
  const far = settleFrom(90);
  check("...and a wider swing holds the room longer than a narrow one",
        far > near && near > 20, `${near} -> ${far}`);

  // The flag stays up once it is up: the mode is still 2, so the selector
  // does not clear it and the hand-back takes its already-on-the-rail arm.
  ResetGameGlobals();
  EnterPlay();
  seat(0);
  G.g_enemies_alive = 0;
  G.g_enemy_slots = makeCameraSlots();
  CameraActorTick();
  CameraDriverSelectMode();
  const wasFree = G.g_camera_free;
  for (let i = 0; i < 30; i += 1) {
    CameraActorTick();
    CameraDriverSelectMode();
  }
  check("...and having handed back it stays handed back",
        wasFree === 1 && G.g_camera_free === 1);

  // And a new enemy takes it away again.
  G.g_enemies_alive = 1;
  ClaimSlot(2);
  CameraActorTick();
  CameraDriverSelectMode();
  check("...until the next enemy claims a slot",
        G.g_camera_free === 0 && G.g_camera_hand_back_started === 0);
}

// `g_camera_settled` is a this-frame answer, and the clear has to run
// whichever driver the frame picks. It used to be the first line of
// `CameraTrackEnemiesTick`, which the hand-back runs *instead of*.
{
  ResetGameGlobals();
  EnterPlay();
  G.g_camera_settled = 1;
  CameraActorTick();
  check("the camera actor clears `g_camera_settled` before any driver runs",
        G.g_camera_settled === 0 && G.g_camera_is_tracking === 1);
}

// The camera-path cue, and the frame that gets stepped over.
//
// `g_cam_path_frame` is an integer in the engine -- both camera drivers end on
// `__ftol` -- and it steps by exactly one, so the engine's cue tests are plain
// `==`. Handing the walker's float straight to the global made `==` a coin
// toss, and class 0x10's removal cue is one of those: a civilian that misses
// it never leaves `g_civilians_alive`, so `wait_scripted_actors` waits for
// ever. `CamPathCueReached` answers `>=` instead.
//
// The `g_cam_path_frame_prev` these cases used to set is gone. It was a
// declared divergence -- a crossing test, to cover a tick that advanced the
// camera by more than one frame -- and two things retired it: the loop calls
// `w.tick(TICK)` exactly once per frame, so the camera steps by exactly one;
// and `CamPathCueReached` never read the field in the first place, having
// moved to `>=` when "already past counts as reached" went in. It was carried
// in every snapshot regardless.
{
  ResetGameGlobals();
  EnterPlay();
  G.g_active_cam_path = 39;

  G.g_cam_path_frame = 280;
  check("a cue the camera lands on fires", CamPathCueReached(39, 280));

  G.g_cam_path_frame = 281;
  check("...and so does one a slow frame steps over",
        CamPathCueReached(39, 280));

  // **Already past counts as reached.** A cue is one-shot, and the paths play
  // once, forward. `seek` restores the camera frame from the address without
  // running the game, so a script can start waiting on a cue the camera has
  // already gone by -- and on a crossing test that cue could never fire again.
  // That is stage 1's hostage: its death script waits on `(39, 60)`, and
  // resuming at `block=1&step=8&op=12&frame=100` put the camera at 100 first.
  // The script never reached its `LeaveCountNow` and `wait_scripted_actors 0`
  // waited for ever.
  G.g_cam_path_frame = 281;
  check("...and a cue the camera is already past still reads as reached",
        CamPathCueReached(39, 280));

  G.g_cam_path_frame = 281;
  check("...but not on a different path", !CamPathCueReached(40, 280));

  G.g_cam_path_frame = 0;
  check("...nor before the path has reached it", !CamPathCueReached(39, 280));
}

// The captor's exit: `ZombieScriptEnded` (`FUN_0045C8D0`) and the shortcut in
// its `WalkPastPoint` arm. Stage 1's `0x18E8` is the shape that matters --
// initial state 34 (`WalkToTarget`), attack state 40 (`WalkPastPoint`), an
// attack script whose point sits in front of it and no entries at all.
//
// **These two assertions were the mirror image of the engine**, because they
// were written against `ActorPointIsAhead`'s inverted yaw term -- see
// `PointLocalZ` in `class30/target.ts`. `MatrixRotateY(-yaw)` gives
// `z' = dx*sin + dz*cos`; the port had `dz*cos - dx*sin`, the *forward*
// rotation, so the predicate answered a point in front where the engine
// answers a point behind. The setups below are unchanged and the expectations
// are swapped, which is the whole of the correction.
//
// The semantics that come out are the ones the state's name asks for: a point
// you have **already walked past** leaves nothing to walk, so the captor turns
// on the player at once; a point still in front of you is a leg to walk first.
{
  const captor = (state: number, attackState: number,
                  point: [number, number, number], yaw = 0) => {
    ResetGameGlobals();
    EnterPlay();
    const z = spawnZombie(0x18e8, 1, "captor");
    z.state = state;
    z.attackState = attackState;
    z.yaw = yaw;
    z.pos = vec3(-80, 2, -309);
    z.script = { target: null,
                 attack: { state: attackState, head: { point }, entries: [] } };
    return z;
  };

  // At x = -80 facing +X (yaw 0xC000), the point at x = -25 is **in front**:
  // there is a leg to walk, so the captor walks it.
  const ahead = captor(ZombieState.TargetMotionScript, ZombieState.WalkPastPoint,
                       [-25, 2, -309], 0xc000);
  ZombieScriptEnded(ahead);
  check("a captor whose point is still in front walks the leg first",
        ahead.state === ZombieState.WalkPastPoint && ahead.sub === 1,
        `state ${ahead.state} sub ${ahead.sub}`);

  // Facing -X, so the same point is behind him: nothing left to walk past.
  const behind = captor(ZombieState.TargetMotionScript, ZombieState.WalkPastPoint,
                        [-25, 2, -309], 0x4000);
  ZombieScriptEnded(behind);
  check("...and one who is already past it turns on the player at once",
        behind.state === ZombieState.AttackRun && behind.sub === 0,
        `state ${behind.state} sub ${behind.sub}`);

  // The role flip itself: a captor already *in* its attack state goes to
  // `AttackRun`, which is what ends the family for good.
  const done = captor(ZombieState.WalkPastPoint, ZombieState.WalkPastPoint,
                      [-25, 2, -309], 0x4000);
  ZombieScriptEnded(done);
  check("a captor that has finished its attack script goes to AttackRun",
        done.state === ZombieState.AttackRun, `state ${done.state}`);
}

// **Stage 1's bin captor, `0x3D34`**, block 6 step 1 -- the zombie that
// bursts out of the wood once the civilian has climbed off the bin. Its
// civilian orders it into state 36 (the burst, its *target* blob), whose
// one-entry list ends in `ZombieScriptEnded` and so in its attack state 40,
// `ZombieStateWalkPastPoint`. That walks past the header's point and hands
// state 35 **the cursor it wrote**: `0x1398 = blob + 0x10` at `0x0045BD34` /
// `0x0045BD92`, the attack blob's first entry. The port set the index and not
// the blob, so state 35 replayed the burst -- the *target* blob's entry --
// ended that list, went back to state 40, and did it again for ever. Driven
// through `GameUpdate`, with the clips standing in for 967 (the burst), 958
// (the walk) and 958/965 (the attack list).
console.log("\nthe bin captor's walk hands state 35 its attack list, once:");
{
  const rng = new Rng(5);
  const events = scene(0, rng);
  const z = spawnZombie(0x3d34, 1, "bin captor");
  z.visible = true;
  z.hp = 100;
  z.pos = vec3(0, 0, 0);
  z.yaw = 0;                                   // facing -Z, toward the point
  z.attackState = ZombieState.WalkPastPoint;
  z.script = {
    target: { state: 36, head: {},
              entries: [{ motion: 102, frame: 0, loops: 1, mode: 20, flag: 34 }] },
    attack: { state: 40, head: { point: [0, 0, -6], motion: 12, frame: 0 },
              entries: [{ motion: 100, frame: 0, loops: 1, mode: -1 },
                        { motion: 101, frame: 0, loops: 1, mode: 32 }] },
  };
  z.state = ZombieState.TargetScriptWithFlag;
  z.sub = 0;
  const seen: string[] = [];
  for (let i = 0; i < 900 && z.state !== ZombieState.AttackRun; i++) {
    GameUpdate(1 / 60, NULL_HOST, rng, events);
    const s = `${z.state}:${z.zom.scriptMotion}`;
    if (seen[seen.length - 1] !== s) seen.push(s);
  }
  const path = seen.join(" ");
  const burst = `${ZombieState.TargetScriptWithFlag}:102`;
  const walk = `${ZombieState.WalkPastPoint}:12`;
  check("the walk hands state 35 the attack list's first entry, not the burst",
        seen.includes(`${ZombieState.TargetMotionScript}:100`)
        && !seen.includes(`${ZombieState.TargetMotionScript}:102`), path);
  check("...plays both of its entries in order",
        path.includes(`${ZombieState.TargetMotionScript}:100 `
                      + `${ZombieState.TargetMotionScript}:101`), path);
  check("...and bursts and walks once each before turning on the player",
        seen.filter((x) => x === burst).length === 1
        && seen.filter((x) => x === walk).length === 1
        && z.state === ZombieState.AttackRun, path);
}

// **`ActorSetMotionBlended`'s start is a play cursor**, and a script's start
// word is one. `FUN_004119A0` writes its third argument into the cursor as it
// stands (`MOV [ECX+0x8], EAX` at `0x004119AD`) and only its half into the
// authored frame (`CDQ / SUB / SAR` into `[ECX+0x18]`); state 36's sub 0 pushes
// the entry's second word straight in (`ActorSetMotionBlended(track, e[0],
// e[1], 0)`, `0x0045B273`). The bin captor's one entry is the real one from
// stage 1's placement 73: clip 967 -- 43 frames, play length 84 -- from cursor
// 33, raising `g_script_flags[34]` on cursor 63. The port doubled the word, so
// the burst began at 66, past its own cue, and flag 34 never came up (its one
// reader, `MouseBranchTriggerUpdate` at `0x0043F743`, despawns a mouse).
// Driven through `GameUpdate` from `ResetGameGlobals`.
console.log("\nthe bin captor's burst starts on the cursor its entry names:");
{
  const rng = new Rng(5);
  const events = scene(0, rng);
  SetGameTables({ ...CHARS, types: { ...CHARS.types,
    "1": { ...TYPE, motions: { ...TYPE.motions,
                               "967": motion(43, 0, 84) } } } } as
                unknown as CharactersJson);
  const z = spawnZombie(0x3d34, 1, "bin captor");
  z.visible = true;
  z.hp = 100;
  z.pos = vec3(0, 0, 0);
  z.attackState = ZombieState.WalkPastPoint;
  z.script = {
    target: { state: 36, head: {},
              entries: [{ motion: 967, frame: 33, loops: 1, mode: 63,
                          flag: 34 }] },
    attack: { state: 40, head: { point: [0, 0, -6], motion: 12, frame: 0 },
              entries: [] },
  };
  z.state = ZombieState.TargetScriptWithFlag;
  z.sub = 0;
  GameUpdate(1 / 60, NULL_HOST, rng, events);
  const first = MotionPlayFrame(z);
  check("state 36 starts clip 967 at play cursor 33, the entry's word",
        z.motion === 967 && z.playTicks === 33 && first === 33,
        `motion ${z.motion} counter ${z.playTicks} cursor ${first}`);
  let raisedOn = -1;
  for (let i = 0; i < 200 && z.state === ZombieState.TargetScriptWithFlag;
       i++) {
    GameUpdate(1 / 60, NULL_HOST, rng, events);
    if (raisedOn < 0 && G.g_script_flags[34]) raisedOn = MotionPlayFrame(z);
  }
  check("...and raises g_script_flags[34] on its cue, cursor 63, before the "
        + "clip runs out", G.g_script_flags[34] === 1 && raisedOn === 63,
        `flag ${G.g_script_flags[34]} on cursor ${raisedOn}`);
}

// **The two drift tails.** A captor whose clip has drifted off its script's
// (`obj+0x1B4 != obj+0x1320`) is pulled back by its state's tail, and there
// are two. The list-stepping states' (`0x0045B01C` in state 35) blend hard on
// their last loop, from `g_motion_play_length[obj+0x1B4] - 1` -- the drifted
// clip's length, a cursor: `MOVSX ECX, word ptr [ECX*2 + 0x4E07D0]` /
// `DEC ECX` / `PUSH ECX` -- and soft otherwise, spending a loop. The walking
// states' (`0x0045BF96` in state 41) only ever fade back from 0, and read no
// loop count. Clip 923 stands in as the drifted one: 41 frames, play length
// 79, so the hard start is 78 -- where the port passed the last authored
// frame, 40, and doubled it to 80.
console.log("\nthe script states' drift tails:");
{
  const rng = new Rng(5);
  scene(0, rng);
  const z = spawnZombie(0x3d38, 1, "drifted captor");
  const drift = (state: ZombieState, loops: number) => {
    z.state = state;
    z.sub = 2;
    z.zom.targetCue = -1;
    z.zom.scriptMotion = 100;
    z.zom.targetLoops = loops;
    z.motion = 923;
    z.playTicks = 5;
    z.target = vec3(0, 0, -500);
  };
  drift(ZombieState.TargetMotionScript, 1);
  ZombieStateTargetMotionScript(z, rng);
  check("state 35's last loop blends back from g_motion_play_length[923] - 1 "
        + "= cursor 78, and spends nothing",
        z.motion === 100 && z.playTicks === 78 && z.zom.targetLoops === 1,
        `motion ${z.motion} counter ${z.playTicks} loops ${z.zom.targetLoops}`);
  drift(ZombieState.WalkToPoint, 1);
  ZombieStateWalkToPoint(z);
  check("state 41's tail fades back from cursor 0 even on a last loop",
        z.motion === 100 && z.playTicks === 0 && z.zom.targetLoops === 1,
        `motion ${z.motion} counter ${z.playTicks} loops ${z.zom.targetLoops}`);
  drift(ZombieState.WalkToPoint, 3);
  ZombieStateWalkToPoint(z);
  check("...and spends no loop count doing it",
        z.motion === 100 && z.playTicks === 0 && z.zom.targetLoops === 3,
        `motion ${z.motion} counter ${z.playTicks} loops ${z.zom.targetLoops}`);
}

// State 42, the camera-cue hold (`ZombieStateHoldForCameraCue`,
// `FUN_0045BFD0`). A captor that has finished its script and would turn on the
// player is instead **staged for a shot**: it runs at the player and holds at
// range, but may not land the blow until the camera reaches the path and frame
// in its descriptor tail. Three spawns in the game do this, all in stage 2.
{
  const staged = (cue: { path: number; frame: number } | null) => {
    ResetGameGlobals();
    EnterPlay();
    const z = spawnZombie(0xa030, 1, "staged captor");
    z.state = ZombieState.TargetMotionScript;
    z.attackState = ZombieState.AttackRun;
    z.cameraCue = cue;
    return z;
  };

  // The exit is diverted rather than going to AttackRun.
  const held = staged({ path: 75, frame: 660 });
  ZombieScriptEnded(held);
  check("a captor with a camera cue holds instead of turning on the player",
        held.state === ZombieState.HoldForCameraCue
        && held.zom.delegate === ZombieState.AttackRun
        && (held.flags & ActorFlag.NoCameraTrack) !== 0,
        `state ${held.state} delegate ${held.zom.delegate}`);

  // Without a cue it goes straight through, which is the other 66 spawns.
  const free = staged(null);
  ZombieScriptEnded(free);
  check("...and one without a cue does not",
        free.state === ZombieState.AttackRun, `state ${free.state}`);

  // Holding: the delegate runs, and the state comes straight back.
  G.g_active_cam_path = 12;
  G.g_cam_path_frame = 3;
  let ran = 0;
  ZombieStateHoldForCameraCue(held, (o, st) => { ran = st; void o; });
  check("the hold runs its delegate every frame",
        ran === ZombieState.AttackRun && held.state === ZombieState.HoldForCameraCue,
        `ran ${ran}, state ${held.state}`);

  // The delegate wants to strike: bounced to HoldAtRange, permit given up.
  // **The table entry only** -- `0x0045C049` writes `g_attack_permits
  // [obj+0x121] = 0` and leaves `obj+0x121` itself alone. It used to be the
  // whole `ReleaseAttackSlot`, which also voids the index and drops the latch.
  held.attackPermit = 0;
  G.g_attack_permits[0] = 1;
  G.g_attack_committed = 1;
  ZombieStateHoldForCameraCue(held, (o) => { o.state = ZombieState.Strike; });
  check("a delegate that reaches Strike is bounced, and gives the permit back",
        held.state === ZombieState.HoldForCameraCue
        && held.zom.delegate === ZombieState.HoldAtRange
        && G.g_attack_permits[0] === -1,
        `state ${held.state} delegate ${held.zom.delegate} `
        + `permits ${JSON.stringify(G.g_attack_permits)}`);
  check("...and only the table's entry: the index and the latch are left",
        held.attackPermit === 0 && G.g_attack_committed === 1,
        `permit ${held.attackPermit} latch ${G.g_attack_committed}`);
  G.g_attack_committed = 0;

  // The camera arrives: it graduates to the delegate and is visible again.
  G.g_active_cam_path = 75;
  G.g_cam_path_frame = 660;
  ZombieStateHoldForCameraCue(held, () => {});
  check("and it graduates when the camera reaches the cue",
        held.state === ZombieState.HoldAtRange
        && (held.flags & ActorFlag.NoCameraTrack) === 0,
        `state ${held.state} flags 0x${(held.flags >>> 0).toString(16)}`);
}

// **The captor that mauls the civilian and then never attacks** --
// stage 2 block 16, `0xA030`. Driven through `GameUpdate`, so the delegate is
// the real `ZombieStateHoldAtRange` and the claim the real `TryClaimAttackSlot`.
//
// A held captor that reaches the hub before the camera claims on every frame
// of the wait and is bounced on every frame, so it claims on the **cue frame**
// too: the delegate writes Strike, the cue matches, and
// `ZombieStateHoldForCameraCue` (`FUN_0045BFD0`) puts it back in HoldAtRange
// still owning the permit. Its next claim then fails on its own permit. In the
// engine the script lets it go -- `finish_sequence` is queued right after
// every held cue in the game, and `EvtActionFinishSequence21` (`FUN_00403710`)
// zeroes both permits -- and the port had no copy of that, so the zombie stood
// at the ring for the rest of the stage.
console.log("\na held captor's cue frame, and the finish_sequence that frees it:");
{
  const rng = new Rng(3);
  const events = scene(0, rng);
  const z = spawnZombie(0xa030, 1, "held captor");
  z.visible = true;
  z.hp = 1000;
  z.pos = vec3(0, 0, 45);
  z.motion = 10;
  z.attackState = ZombieState.WalkPastPoint;
  z.cameraCue = { path: 75, frame: 660 };
  z.state = ZombieState.HoldForCameraCue;
  z.zom.delegate = ZombieState.HoldAtRange;
  z.flags |= ActorFlag.NoCameraTrack;
  G.g_active_cam_path = 75;

  // The wait: claimed and bounced, every frame, and the table ends each frame
  // empty. `obj+0x121` keeps naming the slot, as the engine leaves it.
  let everHeld = false;
  // The frame is published by the driver in the camera actor
  // (`CameraDriverSelectMode`: `g_cam_path_frame = __ftol(g_rail_frame)`),
  // so the fixture moves the word it publishes from.
  for (let f = 600; f < 610; f++) {
    G.g_rail_frame = f;
    G.g_cam_path_frame = f;
    GameUpdate(1 / 60, NULL_HOST, rng, events);
    if (G.g_attack_permits[0] !== -1) everHeld = true;
  }
  check("before the cue the hold bounces every claim",
        z.state === ZombieState.HoldForCameraCue && !everHeld
        && z.zom.delegate === ZombieState.HoldAtRange && z.attackPermit === 0,
        `state ${z.state} delegate ${z.zom.delegate} permit ${z.attackPermit} `
        + `permits ${JSON.stringify(G.g_attack_permits)} `
        + `refusal ${ZombieAttackRefusal(z)}`);

  // The cue frame: it graduates into HoldAtRange **holding** the permit the
  // delegate claimed on this same frame.
  G.g_rail_frame = 660;
  G.g_cam_path_frame = 660;
  GameUpdate(1 / 60, NULL_HOST, rng, events);
  check("on the cue frame it graduates to HoldAtRange still owning the permit",
        z.state === ZombieState.HoldAtRange
        && G.g_attack_permits[0] === z.at && z.attackPermit === 0,
        `state ${z.state} permit ${z.attackPermit} `
        + `permits ${JSON.stringify(G.g_attack_permits)}`);

  // Nothing in class 0x30 lets go of it: the hub's claim fails on its own
  // permit, and `TryClaimAttackSlot` voids `obj+0x121` first.
  G.g_rail_frame = 661;
  G.g_cam_path_frame = 661;
  for (let i = 0; i < 30; i++) GameUpdate(1 / 60, NULL_HOST, rng, events);
  check("...and its own permit refuses every claim after it",
        z.state === ZombieState.HoldAtRange && z.attackPermit === -1
        && G.g_attack_permits[0] === z.at,
        `state ${z.state} permit ${z.attackPermit} `
        + `permits ${JSON.stringify(G.g_attack_permits)}`);

  // The script's `queue_event finish_sequence 4`, as block 16 step 6 queues
  // it. Queueing drops the off-screen latch (`EvtOpQueueEvent30`,
  // `0x0045F833`) and the action frees both permits (`0x00403714`,
  // `0x0040371E`).
  G.g_attack_committed = 1;
  const script = {
    scene: 0, stage: 2, game_mode: 0, evt_file: "test", entry_block: 0,
    entry_step: 0, routes: [{ kind: "end", next: [-1, -1, -1] }],
    regions: [], cam_slots_used: [], warnings: [],
    blocks: [{
      index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
      steps: [{ index: 0, at: 0, ops: [
        { i: 0, at: 0, op: 0x30, name: "queue_event", cat: "camera",
          sel: 0x21, action: "finish_sequence", args: [4, 0],
          scene_state: { major: 2, minor: 4 },
          camera_state: "snap_to_path_eye" },
        { i: 1, at: 1, op: 0x44, name: "wait_enemies_alive", cat: "wait",
          arg: 0, blocks_on: "enemies alive <= arg" },
      ] }],
    }],
  } as unknown as ScriptJson;
  const host = {
    enterRegion: () => undefined, loadSlot: () => undefined,
    unloadSlot: () => undefined, startCamera: () => undefined,
    onFeed: () => undefined, onBranch: () => undefined,
    playSound: () => undefined, aliveEnemies: () => 1,
    presentEnemies: () => 1,
    aliveCivilians: () => null, cameraFree: () => null,
    scriptFlagRaised: () => null,
    showMessage: () => null, endDialogue: () => undefined,
  };
  const w = new Walker(script, host);
  // The action runs in the camera actor, after the interpreter has queued it,
  // on a ring the driver before it has let go of (`goto_scene_state` or the
  // drain mode leave the advance word at 1).
  G.g_evt_action_advance = 1;
  WalkerCameraFrame(w);
  check("finish_sequence frees both permits and drops the latch",
        G.g_attack_permits.every((p) => p === -1) && G.g_attack_committed === 0,
        `permits ${JSON.stringify(G.g_attack_permits)} `
        + `latch ${G.g_attack_committed}`);

  // And now it strikes.
  let struck = false;
  for (let i = 0; i < 5 && !struck; i++) {
    GameUpdate(1 / 60, NULL_HOST, rng, events);
    struck = z.state === ZombieState.Strike;
  }
  check("...after which the captor strikes",
        struck && G.g_attack_permits[0] === z.at,
        `state ${z.state} permits ${JSON.stringify(G.g_attack_permits)}`);
}

// `ZombieStateHoldAtRange` (`FUN_00455720`) gives back an off-screen claim's
// latch while the actor is still off screen -- `0x00455748`..`0x0045576D` --
// and keeps it while it is on screen. The held captor's bounce leaves the
// latch up, and this is where it comes down.
console.log("\nthe hub drops an off-screen latch:");
{
  const rng = new Rng(4);
  const events = scene(0, rng);
  const z = spawnZombie(0x5100, 1, "latched");
  z.visible = true;
  z.hp = 1000;
  z.pos = vec3(0, 0, 45);
  z.motion = 10;
  const offscreen = {
    ...NULL_HOST,
    viewSpaceOf: (_at: number, out: Vec3) => {
      out.x = 900; out.y = 0; out.z = -40;
      return true;
    },
  };
  const onscreen = {
    ...NULL_HOST,
    viewSpaceOf: (_at: number, out: Vec3) => {
      out.x = 0; out.y = 0; out.z = -40;
      return true;
    },
  };
  // In rank and at the head of the queue, the two fields the director's
  // `GameUpdate` would have written; the hub's own gate is not under test.
  z.rank = 0;
  z.queueRank = 0;
  // The state 42 bounce: the table entry freed, the latch and bit left.
  const latch = () => {
    z.flags2 |= ZombieFlag2.OffScreenPermit;
    G.g_attack_committed = 1;
    G.g_attack_permits = [-1, -1];
    z.state = ZombieState.HoldAtRange;
    z.sub = 0;
  };
  latch();
  ZombieStateHoldAtRange(z, rng, onscreen, events);
  check("on screen the hub keeps the latch",
        G.g_attack_committed === 1
        && (z.flags2 & ZombieFlag2.OffScreenPermit) !== 0
        && z.state === ZombieState.HoldAtRange,
        `latch ${G.g_attack_committed} state ${z.state}`);
  latch();
  ZombieStateHoldAtRange(z, rng, offscreen, events);
  check("off screen it drops the latch, and claims again at once",
        z.state === ZombieState.Strike && z.attackPermit === 0
        && G.g_attack_committed === 1,
        `latch ${G.g_attack_committed} state ${z.state} permit ${z.attackPermit}`);
}

// `TryClaimAttackSlot` (`FUN_00455DE0`) and its thrower copy void `obj+0x121`
// before they test anything (`0x00455DE5`, `0x0044CA45`), so a refused claim
// leaves the actor holding no index -- and its release frees no one else's.
console.log("\na refused claim voids the index:");
{
  const rng = new Rng(5);
  scene(0, rng);
  const a = spawnZombie(0x5200, 1, "stale");
  const b = spawnZombie(0x5204, 1, "holder");
  a.attackPermit = 0;                 // what state 42's bounce leaves behind
  check("the holder claims", TryClaimAttackSlot(b, new Rng(1)) && b.attackPermit === 0,
        `permit ${b.attackPermit}`);
  check("a refused claim leaves obj+0x121 at -1",
        !TryClaimAttackSlot(a, new Rng(1)) && a.attackPermit === -1,
        `permit ${a.attackPermit}`);
  ReleaseAttackSlot(a);
  check("...so releasing it does not free the holder's permit",
        G.g_attack_permits[0] === b.at,
        `permits ${JSON.stringify(G.g_attack_permits)}`);
}

// `TryClaimAttackSlot` (`FUN_00455DE0`) offers **one** player's permit and
// never the other's: `g_active_player`'s with one attacker, a `rand() % 2`
// with two attackers and one player in play or one enemy present, and the
// actor's own half of the screen otherwise (`ActorScreenHalfSign`,
// `FUN_00409C90`). The port took the first free permit, which is the same
// answer for player 1 alone and a different one everywhere else.
console.log("\nthe claim's pick, one player and two:");
{
  const rng = new Rng(6);
  scene(0, rng);
  const z = spawnZombie(0x5300, 1, "claimant");
  z.visible = true;
  z.hp = 1000;
  const reset = () => {
    G.g_attack_permits = [-1, -1];
    G.g_attack_committed = 0;
    z.attackPermit = -1;
  };
  // Both players in play, so `IsPlayerAttackable` refuses neither.
  G.g_player_state = [PlayerState.InPlay, PlayerState.InPlay];
  /** A generator whose next `int(2)` is `want`, and the state one draw on. */
  const seeded = (want: number) => {
    let s = 1;
    while (new Rng(s).int(2) !== want) s++;
    const after = new Rng(s);
    after.next();
    return { r: new Rng(s), after: after.state };
  };

  G.g_max_attackers = 1;
  G.g_active_player = 1;
  reset();
  const s0 = rng.state;
  check("player 2 alone is offered player 2's permit",
        TryClaimAttackSlot(z, rng) && z.attackPermit === 1
        && G.g_attack_permits[1] === z.at && G.g_attack_permits[0] === -1,
        `permit ${z.attackPermit} ${JSON.stringify(G.g_attack_permits)}`);
  check("...and the one-attacker pick draws nothing", rng.state === s0);
  reset();
  G.g_attack_permits[1] = 0x77;
  check("...with it held, player 1's free permit is not offered instead",
        !TryClaimAttackSlot(z, rng) && z.attackPermit === -1
        && G.g_attack_permits[0] === -1,
        `permit ${z.attackPermit} ${JSON.stringify(G.g_attack_permits)}`);
  G.g_active_player = 2;
  reset();
  check("g_active_player 2 with one attacker offers no permit at all",
        !TryClaimAttackSlot(z, rng) && z.attackPermit === -1);
  G.g_active_player = 0;
  reset();
  check("player 1 alone is still offered permit 0",
        TryClaimAttackSlot(z, rng) && z.attackPermit === 0);

  // Two attackers, one player in play: the coin.
  G.g_max_attackers = 2;
  G.g_players_in_play = 1;
  G.g_enemies_present = 4;
  let t = seeded(1);
  reset();
  check("two attackers, one player in play: rand() % 2 picks permit 1",
        TryClaimAttackSlot(z, t.r) && z.attackPermit === 1,
        `permit ${z.attackPermit}`);
  check("...drawing exactly once", t.r.state === t.after);
  t = seeded(1);
  reset();
  G.g_attack_permits[1] = 0x77;
  check("...and a held pick is refused, not swapped for the free one",
        !TryClaimAttackSlot(z, t.r) && z.attackPermit === -1
        && G.g_attack_permits[0] === -1,
        `permit ${z.attackPermit} ${JSON.stringify(G.g_attack_permits)}`);

  // Two players and one enemy present: a held pick is NOT-ed, to -1 or -2.
  G.g_players_in_play = 2;
  G.g_enemies_present = 1;
  t = seeded(0);
  reset();
  G.g_attack_permits[0] = 0x77;
  check("one enemy present: ~0 is -1, refused",
        !TryClaimAttackSlot(z, t.r) && z.attackPermit === -1
        && t.r.state === t.after);
  t = seeded(1);
  reset();
  G.g_attack_permits[1] = 0x77;
  check("...and ~1 is -2, which IsPlayerAttackable refuses too",
        !TryClaimAttackSlot(z, t.r) && z.attackPermit === -1
        && G.g_attack_permits[0] === -1,
        `permit ${z.attackPermit} ${JSON.stringify(G.g_attack_permits)}`);
  t = seeded(1);
  reset();
  check("...while a free pick is taken", TryClaimAttackSlot(z, t.r)
        && z.attackPermit === 1);

  // Two players and a crowd: the actor's own half of the screen, no draw.
  G.g_enemies_present = 3;
  const side = (x: number) => ({
    ...NULL_HOST,
    viewSpaceOf: (_at: number, out: Vec3) => {
      out.x = x; out.y = 0; out.z = -40;      // forty in front, on screen
      return true;
    },
  });
  check("ActorScreenHalfSign: the right half is 1 and the left -1",
        ActorScreenHalfSign(z, side(5)) === 1
        && ActorScreenHalfSign(z, side(-5)) === -1
        && ActorScreenHalfSign(z, side(0)) === -1);
  reset();
  const s1 = rng.state;
  check("an enemy on the right of the screen comes for player 2",
        TryClaimAttackSlot(z, rng, side(5)) && z.attackPermit === 1,
        `permit ${z.attackPermit}`);
  check("...drawing nothing", rng.state === s1);
  reset();
  check("...and one on the left for player 1",
        TryClaimAttackSlot(z, rng, side(-5)) && z.attackPermit === 0);
  reset();
  G.g_attack_permits[1] = 0x77;
  check("...and the right with player 2's permit held is refused",
        !TryClaimAttackSlot(z, rng, side(5)) && G.g_attack_permits[0] === -1);

  // The gate runs after the pick and voids it.
  G.g_max_attackers = 1;
  G.g_active_player = 1;
  G.g_player_state = [PlayerState.InPlay, PlayerState.Out];
  reset();
  check("a picked player out of play refuses the claim outright",
        !TryClaimAttackSlot(z, rng) && z.attackPermit === -1
        && G.g_attack_permits.every((p) => p === -1));

  // The thrower's copy is the same pick with its own latch bit.
  const w = spawnZombie(0x5304, 1, "stand-in");   // any Actor carries flags2
  G.g_player_state = [PlayerState.InPlay, PlayerState.InPlay];
  G.g_attack_permits = [-1, -1];
  G.g_attack_committed = 0;
  const offscreen = {
    ...NULL_HOST,
    viewSpaceOf: (_at: number, out: Vec3) => {
      out.x = 900; out.y = 0; out.z = -40;
      return true;
    },
  };
  check("ThrowerTryClaimAttackSlot: player 2 alone gets permit 1 too",
        ThrowerTryClaimAttackSlot(w, rng, offscreen) && w.attackPermit === 1);
  check("...and off screen latches obj+0x136C bit 0x8000, not 0x20000",
        (w.flags2 & ThrowerFlag.OffScreenPermit) !== 0
        && (w.flags2 & ZombieFlag2.OffScreenPermit) === 0
        && G.g_attack_committed === 1,
        `flags2 0x${w.flags2.toString(16)}`);
  G.g_active_player = 0;
}

// Neither claim routine stores to `obj+0x34`: `NoCameraTrack` is each
// caller's to lower. `ZombieStateApproach` does it on a grant (`0x00457A4E`);
// the hub does not (`0x00455845`..`0x0045587B`), which is what keeps a captor
// that `ZombieStateHoldForCameraCue` is holding off the camera until its cue.
console.log("\nthe claim leaves NoCameraTrack to its callers:");
{
  const rng = new Rng(7);
  const events = scene(0, rng);
  const z = spawnZombie(0x5400, 1, "untracked");
  z.visible = true;
  z.hp = 1000;
  z.flags |= ActorFlag.NoCameraTrack;
  check("a bare claim grants and leaves the bit up",
        TryClaimAttackSlot(z, rng) && (z.flags & ActorFlag.NoCameraTrack) !== 0);
  ReleaseAttackSlot(z);
  check("...and so does the thrower's",
        ThrowerTryClaimAttackSlot(z, rng)
        && (z.flags & ActorFlag.NoCameraTrack) !== 0);
  ThrowerReleaseAttackPermit(z);

  z.pos = vec3(0, 0, 45);
  z.motion = 10;
  z.rank = 0;
  z.queueRank = 0;
  z.state = ZombieState.HoldAtRange;
  z.sub = 0;
  ZombieStateHoldAtRange(z, rng, NULL_HOST, events);
  check("the hub's grant goes to the strike with the bit still up",
        z.state === ZombieState.Strike && z.attackPermit === 0
        && (z.flags & ActorFlag.NoCameraTrack) !== 0,
        `state ${z.state} permit ${z.attackPermit} flags 0x${z.flags.toString(16)}`);
  ReleaseAttackSlot(z);

  z.state = ZombieState.Approach;
  z.sub = 1;
  z.allowance = 5;
  z.attackState = ZombieState.AttackRun;
  ZombieStateApproach(z, rng, NULL_HOST);
  check("ZombieStateApproach lowers it itself on its grant",
        z.state === ZombieState.AttackRun && z.attackPermit === 0
        && (z.flags & ActorFlag.NoCameraTrack) === 0,
        `state ${z.state} permit ${z.attackPermit} flags 0x${z.flags.toString(16)}`);
  ReleaseAttackSlot(z);
}

// The callers around the claim that were read with it.
console.log("\nthe claim's callers, as the exe orders them:");
{
  // `ZombieShouldStandAndThrow` (`FUN_00458E10`): type 1 claims *before* it
  // tests its hands (`0x00458EC3`), so an unarmed `znassb` walker still takes
  // the permit and is answered no.
  scene(0, new Rng(8));
  const z = spawnZombie(0x5500, 1, "bare znassb", { condition: 8 });
  z.visible = true;
  z.hp = 1000;
  // The facing window is the camera block's yaw turned half round
  // (`0x00458E48`): 0x8000 is a camera looking at a walker facing yaw 0.
  G.g_camera_block_yaw_bams = 0x8000;
  z.yaw = 0;
  z.boneSlot["5"] = -2;
  z.boneSlot["8"] = -2;
  check("an unarmed type-1 walker is answered no...",
        ZombieArmedHands(z) === 0 && !ZombieShouldStandAndThrow(z, new Rng(1)));
  check("...but has claimed the permit on the way",
        z.attackPermit === 0 && G.g_attack_permits[0] === z.at,
        `permit ${z.attackPermit} ${JSON.stringify(G.g_attack_permits)}`);

  // `ZombieScriptedPickPlayer`: "spoken for" is a held entry, whatever the
  // port stored in it -- the holder's `at` from a claim included.
  G.g_player_state = [PlayerState.InPlay, PlayerState.InPlay];
  check("a scripted attacker named for a claimed player falls back to the other",
        ZombieScriptedPickPlayer(0, new Rng(1)) === 1);
  G.g_attack_permits[1] = 0x77;
  check("...and gives up when both are held",
        ZombieScriptedPickPlayer(0, new Rng(1)) === -1);

  // `ThrowerTryEnterState` (`FUN_0044AFB0`) arm 9: state 0x20 claims first,
  // then asks for surface 0x35 -- and a refusal on the surface keeps the
  // permit.
  const w = thrower(ThrowerState.StandAndDecide);
  check("state 0x20 claims, and is refused off surface 0x35",
        !ThrowerTryEnterState(w, ThrowerState.StrikeOnTheSpot, new Rng(1),
                              NULL_HOST)
        && w.attackPermit === 0 && G.g_attack_permits[0] === w.at
        && w.state === ThrowerState.StandAndDecide,
        `permit ${w.attackPermit} state ${w.state}`);

  // `ThrowerStateRideObjectPath` (`FUN_0044E5D0`): shot-immune for the ride
  // (`0x0044E603`), and the bit comes down before the claim (`0x0044E67D`).
  const r = thrower(ThrowerState.StandAndDecide);
  r.state = ThrowerState.RideObjectPath;
  r.sub = 0;
  ThrowerStateRideObjectPath(r, 1 / 60, new Rng(1), NULL_HOST);
  check("the ride raises ShotImmune and nothing on the camera",
        (r.flags & ActorFlag.ShotImmune) !== 0
        && (r.flags & ActorFlag.NoCameraTrack) === 0
        && r.state === ThrowerState.RideObjectPath);
  r.slideTimer = 0xc4;
  ThrowerStateRideObjectPath(r, 1 / 60, new Rng(1), NULL_HOST);
  check("...and its last frame lowers it, claims and pounces",
        (r.flags & ActorFlag.ShotImmune) === 0 && r.attackPermit === 0
        && r.state === ThrowerState.Pounce,
        `flags 0x${r.flags.toString(16)} state ${r.state}`);

  // `ThrowerStateBlinkInThreeHops` (`FUN_00451480`): the bit is `0x100`.
  const b = thrower(ThrowerState.StandAndDecide);
  b.state = ThrowerState.BlinkIn;
  b.sub = 0;
  b.attackState = ThrowerState.StandAndDecide;
  ThrowerStateBlinkInThreeHops(b, 1 / 60, 0);
  check("the blink-in cannot be shot and is not hidden from the camera",
        (b.flags & ActorFlag.ShotImmune) !== 0
        && (b.flags & ActorFlag.NoCameraTrack) === 0,
        `flags 0x${b.flags.toString(16)}`);
  for (let i = 0; i < 400 && b.state === ThrowerState.BlinkIn; i++) {
    ThrowerStateBlinkInThreeHops(b, 1 / 60, 0);
  }
  check("...and arriving lowers it",
        b.state === ThrowerState.StandAndDecide
        && (b.flags & ActorFlag.ShotImmune) === 0,
        `state ${b.state} flags 0x${b.flags.toString(16)}`);
}
