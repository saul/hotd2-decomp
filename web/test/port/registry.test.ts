import type { CharactersJson } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { Scope } from "../../src/core/scope";
import { CameraFrame } from "../../src/core/camera";
import type { Context, Tick } from "../../src/core/system";
import { HingePose } from "../../src/render/hinge";
import { Events } from "../../src/core/events";
import { ticksOfAuthoredFrame } from "../../src/core/play_cursor";
import { ActorSpawn, GameUpdate } from "../../src/game/director";
import { ActorKillAll } from "../../src/game/combat/resolve_hit";
import { CameraDriverSelectMode, CameraMode } from "../../src/game/camera/mode";
import { G, ResetGameGlobals } from "../../src/game/globals";
import {
  RAIN_PARTICLE_COUNT, RainAdvanceParticles, RainResetParticles,
  type RainRules,
} from "../../src/game/effects/rain";
import { NULL_HOST, type ShotPick } from "../../src/game/host";
import {
  QueueOffscreenPull, QueueShotRequest, g_gunshot_sound_ids,
} from "../../src/game/combat/shot";
import {
  MotionOf, MotionPlayLength, SetGameTables, T,
} from "../../src/game/tables";
import {
  ColiTestSphereAgainstActors, ColiTestSphereAgainstFullSet,
} from "../../src/game/coli";
import {
  MotionRow, StrikeSub, ZombieState,
} from "../../src/game/class30/states";
import { ZombieAttackRefusal, ZombieStateHoldAtRange }
  from "../../src/game/class30/hold";
import { ZombieStateBackOff } from "../../src/game/class30/backoff";
import { ZombieStateStrike } from "../../src/game/class30/strike";
import {
  ActorFlag, ThrowerFlag, ZombieFlag2, type Actor, type ZombieActor,
} from "../../src/game/actor";
import {
  ReleaseAttackSlot, ThrowerReleaseAttackPermit, ThrowerTryClaimAttackSlot,
  TryClaimAttackSlot,
} from "../../src/game/combat/permits";
import { ActorDeadSweep } from "../../src/game/despawn";
import {
  DeadSweep, ENEMY_CLASSES, g_class_handlers, registerClass,
} from "../../src/game/registry";
import { PORTED_CLASSES } from "../../src/game/classes";
import { ZombiePushOutOfWorldAndActors } from "../../src/game/class30/ground";
import { SpawnClass } from "../../src/game/spawn_class";
import { GameSystem } from "../../src/app/systems";
import { ThrowerBeginKnockbackArc } from "../../src/game/class31/death";
import { ThrowerState } from "../../src/game/class31/states";
import { vec3, type Vec3 } from "../../src/game/vec";
import {
  ActorPlayHitReaction, HitResultCode, ResolveHit,
} from "../../src/game/combat/resolve_hit";
import {
  check, TYPE, APPROACH, CHARS, SCENE_MAJOR_PLAYING, EYE, spawnZombie,
  PublishCrowd, scene, slotHolds, slotsShown, EnterPlay, JoinPlayerTwo,
  CAM_HOST, WALL_BLOB, FLOOR_BLOB, thrower,
} from "./harness";

// -- the rain, which used to be unreachable from here ----------------------

console.log("\nrain: DrawRainParticles' simulation half");

{
  const rules: RainRules = {
    fallPerFrame: 2, respawnBelow: -7,
    spawn: { x: [0x14, -10], y: [0x32, -25], z: [0x19, -35] },
  };
  const rng = new Rng(1);
  ResetGameGlobals();
  EnterPlay();
  RainResetParticles(rules, rng);
  check("the pool is the extent of the array, not a stored count",
        G.g_rain_particles.length === RAIN_PARTICLE_COUNT,
        `${G.g_rain_particles.length}`);
  check("every drop spawns inside the box the routine's three rand()s give",
        G.g_rain_particles.every((p) =>
          p.x >= -10 && p.x <= 9 && p.y >= -25 && p.y <= 24
          && p.z >= -35 && p.z <= -11),
        JSON.stringify(G.g_rain_particles[0]));
  // The spawn box is in *front* of the camera: z is never positive, so a drop
  // is never created behind the view.
  check("and always in front of the camera",
        G.g_rain_particles.every((p) => p.z < 0));

  const before = G.g_rain_particles.map((p) => p.y);
  RainAdvanceParticles(rules, 1, rng);
  check("one frame is `p.y -= 2.0`, or a respawn into the box",
        G.g_rain_particles.every((p, i) =>
          p.y === before[i] - 2 || (p.y >= -25 && p.y <= 24)),
        `${before[0]} -> ${G.g_rain_particles[0].y}`);

  // The invariant, and it is not "y > -7". The routine falls *then* tests
  // once, so a respawn may itself land below the line -- the box runs down to
  // -25 -- and that drop falls again next frame. What must always hold at the
  // end of a step is that every drop is back inside the spawn box's range.
  // Sixty seconds, so every drop has wrapped many times.
  RainAdvanceParticles(rules, 60 * 60, rng);
  check("a drop never escapes the spawn box's vertical range",
        G.g_rain_particles.every((p) => p.y >= -25 && p.y <= 24),
        JSON.stringify(G.g_rain_particles.filter(
          (p) => p.y < -25 || p.y > 24)));

  // The whole reason it moved: the positions are in `G`, so they are in the
  // snapshot. A save/restore must put the rain back exactly where it was.
  const saved = structuredClone(G.g_rain_particles);
  RainAdvanceParticles(rules, 10, rng);
  G.g_rain_particles = structuredClone(saved);
  check("the pool round-trips through a snapshot",
        JSON.stringify(G.g_rain_particles) === JSON.stringify(saved));

  // Determinism: the same seed must give the same rain, or a replay diverges.
  ResetGameGlobals();
  EnterPlay();
  RainResetParticles(rules, new Rng(7));
  const a = JSON.stringify(G.g_rain_particles);
  ResetGameGlobals();
  EnterPlay();
  RainResetParticles(rules, new Rng(7));
  check("and the same seed gives the same rain",
        JSON.stringify(G.g_rain_particles) === a);
}

// ---------------------------------------------------------------------------
// `FUN_00473CF0`'s pose: `side` is a sign, and four hinges prove it matters
// ---------------------------------------------------------------------------
{
  console.log("\nscripted scenery: the hinge pose");

  // One key from stage 1's curve 0, frame 20 -- the slam judder, where the
  // door has stopped swinging and the X and Z wobble peak. This is the frame
  // the four odd hinges went berserk on, which is why it reads on screen as
  // "spins at the end of the swing" rather than "opens to the wrong angle".
  const slam = [9400, 16869, 9443];

  check("side +1 leaves every angle as the curve wrote it",
        JSON.stringify(HingePose({ side: 1 }, slam))
        === JSON.stringify({ rx: 9400, ry: 16869, rz: 9443 }));

  // `ADD ECX` becomes `SUB ECX` and the yaw gets a `NEG`; `obj+0x6C` is
  // written from the same `ADD EDX,EAX` on both arms, so rz does not mirror.
  check("side -1 mirrors rx and ry, and leaves rz alone",
        JSON.stringify(HingePose({ side: -1 }, slam))
        === JSON.stringify({ rx: -9400, ry: -16869, rz: 9443 }));

  // The bug. `prop_06dc_0` and `prop_0724_0` in stage 1 carry +/-512 -- the
  // amplitude of the wobble they do when shot -- and multiplying by that put
  // 4.8 million BAMS, 73 turns, on the X axis of a door.
  const big = HingePose({ side: 512 }, slam);
  check("a magnitude never reaches the pose",
        big.rx === 9400 && big.ry === 16869 && big.rz === 9443,
        `rx=${big.rx} (${(big.rx / 65536).toFixed(1)} turns)`);
  check("and its sign still mirrors, at 416 as at 1",
        HingePose({ side: -416 }, slam).rx === -9400);

  // `TEST EAX,EAX; JLE`: zero takes the negative arm. No shipped hinge is
  // zero, but the exporter's `or 0` can produce one from an absent parameter.
  check("zero takes the mirrored arm, as `JLE` does",
        HingePose({ side: 0 }, slam).ry === -16869);

  // Every angle stays inside a turn for every side the game ships. The four
  // odd ones are stage 1's; the other 52 are +/-1.
  const shipped = [1, -1, 512, -512, 416, -416];
  check("no shipped side can drive an angle past one turn",
        shipped.every((side) => {
          const a = HingePose({ side }, slam);
          return Math.abs(a.rx) < 0x10000 && Math.abs(a.ry) < 0x10000;
        }));
}

// ---------------------------------------------------------------------------
// class 0x31: the permit it gives back, the body it has, and the death it dies
// ---------------------------------------------------------------------------
{
  console.log("\nclass 0x31, what stopped the throwers working:");

  // **The permit latch, and the wrong function.** `obj+0x136C` carries the
  // off-screen latch in bit 0x8000 for a thrower and 0x20000 for a zombie —
  // one word, two classes, two bits — so `ReleaseAttackSlot` (`FUN_00456520`)
  // called on a thrower frees the permit *array* and leaves
  // `g_attack_committed` raised. `TryClaimAttackSlot` reads that latch on its
  // first line, so after one off-screen pounce nothing in the scene could ever
  // attack again: every thrower parked in `WaitForPermit` wanting a permit
  // that nobody held.
  const offscreen = {
    ...NULL_HOST,
    viewSpaceOf: (_at: number, out: Vec3) => {
      out.x = 900; out.y = 0; out.z = -40;     // off the side of a 640 frame
      return true;
    },
  };
  {
    const z = thrower(ThrowerState.StandAndDecide);
    check("a thrower off the side of the frame takes a permit and latches",
          ThrowerTryClaimAttackSlot(z, new Rng(1), offscreen)
          && G.g_attack_committed === 1
          && (z.flags2 & ThrowerFlag.OffScreenPermit) !== 0,
          `latch ${G.g_attack_committed} flags2 ${z.flags2.toString(16)}`);
    // The zombie's release reads the wrong bit — it is what the port called.
    ReleaseAttackSlot(z);
    check("...and the class-0x30 release cannot lift it",
          G.g_attack_committed === 1, `latch ${G.g_attack_committed}`);
    ThrowerReleaseAttackPermit(z);
    check("only `ThrowerReleaseAttackPermit` does",
          G.g_attack_committed === 0
          && (z.flags2 & ThrowerFlag.OffScreenPermit) === 0);
  }

  // The same thing end to end, through the state machine: pounce, leap aside,
  // and the next claim must succeed. This is the reported symptom exactly —
  // "after their first attack they stop attacking and just wait".
  {
    const rng = new Rng(5);
    const events = new Events();
    const z = thrower(ThrowerState.StandAndDecide);
    T.coli = { files: ["test"], blobs: { floor: FLOOR_BLOB } };
    G.g_coli_full_set = ["floor"];
    z.pos = vec3(0, 0, 20);                    // inside CLOSE_RANGE, so state 8
    let pounced = false;
    for (let i = 0; i < 1200; i++) {
      GameUpdate(1 / 60, offscreen, rng, events);
      if (z.state === ThrowerState.Pounce) pounced = true;
      if (pounced && z.state === ThrowerState.StandAndDecide) break;
    }
    check("a thrower that has pounced once can claim again",
          pounced && G.g_attack_committed === 0
          && ThrowerTryClaimAttackSlot(z, new Rng(1), offscreen),
          `pounced ${pounced} latch ${G.g_attack_committed}`
          + ` state ${z.state} permit ${z.attackPermit}`);
    ThrowerReleaseAttackPermit(z);
  }

  // **The body sphere.** `ThrowerPushOutOfWorld` (`FUN_00449D40`) is the hook
  // `EnemyThrowerInit` installs at `obj+0x12F0`, and only its third job — the
  // surface snap — used to run. So a thrower was tested against the world at
  // its origin and stood a whole radius inside a wall.
  {
    const rng = new Rng(7);
    const events = new Events();
    const z = thrower(ThrowerState.StandAndDecide);
    check("a thrower is born colliding, and with a radius",
          (z.flags2 & ThrowerFlag.CollideWorld) !== 0
          && (z.flags2 & ThrowerFlag.CollideActors) !== 0
          && z.bodyRadius === 4,
          `flags2 ${z.flags2.toString(16)} r ${z.bodyRadius}`);

    T.coli = { files: ["test"], blobs: { wall: WALL_BLOB, floor: FLOOR_BLOB } };
    G.g_coli_full_set = ["wall", "floor"];
    // **The reported symptom, exactly.** The wall's solid side is x > 30, so
    // an origin at x = 28 is legally outside it — and a four-unit body sphere
    // is two units *inside* it. Nothing measured that, so the model stood in
    // the wall.
    z.pos = vec3(28, 0, 45);
    GameUpdate(1 / 60, CAM_HOST, rng, events);
    check("and a body sphere inside a wall its origin is clear of is pushed out",
          z.pos.x <= 26 + 1e-6, `x ${z.pos.x.toFixed(2)}`);
    // The sphere is the actor lifted by 1.4 radii, not by a constant: that is
    // `FUN_00449E80`'s own literal and it is what makes the body, rather than
    // the feet, the thing the wall pushes.
    check("the sphere sits 1.4 radii above a grounded thrower",
          Math.abs(z.sphereCentre.y - (z.pos.y + z.bodyRadius * 1.4)) < 1e-6,
          `${z.sphereCentre.y} vs ${z.pos.y}`);
  }

  // **The order.** The hook runs *after* the state, because every state here
  // writes `obj.pos` outright — a push applied first is overwritten before
  // anything draws it. `LeapToPoint` is the sharpest case: its last frame
  // snaps the actor onto the descriptor's named point, so if that point is
  // inside a wall the push is the only thing between it and standing there.
  {
    const rng = new Rng(11);
    const events = new Events();
    // After `thrower()`, never before: it calls `SetGameTables(CHARS31)` with
    // no collision, which clears `T.coli`.
    const z = thrower(ThrowerState.LeapToPoint, {
      // Two units past the wall's plane at x = 30, so the body is inside it.
      leap: { dest: [28, 0, 45], frames: 4 },
    });
    T.coli = { files: ["test"], blobs: { wall: WALL_BLOB, floor: FLOOR_BLOB } };
    G.g_coli_full_set = ["wall", "floor"];
    z.pos = vec3(0, 0, 45);
    // Long enough for the arc **and its landing clip**: the state holds until
    // `ActorArcStep` runs out of script, which is what makes the leap an
    // animation rather than a slide.
    for (let i = 0; i < 200 && z.state === ThrowerState.LeapToPoint; i++) {
      GameUpdate(1 / 60, CAM_HOST, rng, events);
    }
    GameUpdate(1 / 60, CAM_HOST, rng, events);
    check("a state that writes `pos` outright is still pushed clear after it",
          z.state === ThrowerState.StandAndDecide && z.pos.x <= 26 + 1e-6,
          `state ${z.state} x ${z.pos.x.toFixed(2)}`);
  }

  // **Behind the surface.** `ColiSphereVsMesh` compares `distance²` against
  // `radius²` and never asks which side the centre is on; the caller turns a
  // negative plane distance into `radius + distance`, which puts a body that
  // has got through a wall back out the front, exactly tangent. The port
  // rejected the case (`if (d < 0) continue`), so a body far enough in was not
  // pushed at all — which is "quite far into the wall".
  {
    ResetGameGlobals();
    EnterPlay();
    T.coli = { files: ["test"], blobs: { wall: WALL_BLOB, floor: FLOOR_BLOB } };
    G.g_coli_full_set = ["wall", "floor"];
    // The wall's outward normal is -x, so the solid side is x > 30.
    check("a sphere in front of a wall is pushed to tangent",
          ColiTestSphereAgainstFullSet(28, 5.6, 45, 4)
          && Math.abs(G.g_coli_hit_depth - 2) < 1e-6
          && Math.abs((G.g_coli_hit_normal[0] ?? 0) + 1) < 1e-6,
          `depth ${G.g_coli_hit_depth} n ${G.g_coli_hit_normal.join(",")}`);
    check("a sphere whose centre is *behind* it is a hit too",
          ColiTestSphereAgainstFullSet(33, 5.6, 45, 4),
          "no hit");
    // 3 behind + 4 radius = 7, along the same outward normal: 33 - 7 = 26,
    // which is four units clear on the walkable side.
    check("...and its depth carries the side, not its normal",
          Math.abs(G.g_coli_hit_depth - 7) < 1e-6
          && Math.abs((G.g_coli_hit_normal[0] ?? 0) + 1) < 1e-6,
          `depth ${G.g_coli_hit_depth} n ${G.g_coli_hit_normal.join(",")}`);
    check("so one push lands it exactly tangent, on the outside",
          Math.abs((33 + (G.g_coli_hit_normal[0] ?? 0) * G.g_coli_hit_depth) - 26)
          < 1e-6);
  }

  // **On the wall.** `ThrowerSnapToSurface` calls `ThrowerFindSurfaceUnderfoot`
  // (`FUN_0044C640`), not `TraceActorSurfaceContactPoint` (`FUN_0044C370`) —
  // two different routines, and the port had been calling the second for the
  // first. The one that matters re-places a clinging actor **6.5 units off**
  // the surface it found; the other returns the hit itself. With the origin in
  // the wall plane and the sphere centred on it — a wall stance leaves y alone
  // — half the actor is inside the geometry, and the push cannot help because
  // this runs after it.
  {
    const rng = new Rng(13);
    const events = new Events();
    const z = thrower(ThrowerState.StandAndDecide);
    T.coli = { files: ["test"], blobs: { wall: WALL_BLOB, floor: FLOOR_BLOB } };
    G.g_coli_full_set = ["wall", "floor"];
    // Clinging to the wall at x = 30, facing along -z so the cardinal puts the
    // probe across the x axis.
    z.flags2 |= ThrowerFlag.OffGround | ThrowerFlag.WallA;
    z.yaw = 0;
    z.pos = vec3(29.5, 12, 45);
    GameUpdate(1 / 60, CAM_HOST, rng, events);
    const off = 30 - z.pos.x;
    check("a thrower on a wall stands 6.5 units off it, not in it",
          Math.abs(off - 6.5) < 1e-3, `${off.toFixed(3)} off the wall`);
    // ...and that is enough for the body to be clear: the sphere is centred on
    // the actor's own y for a wall stance, so on the plane it would be half in.
    check("...which is what puts its body outside the geometry",
          !ColiTestSphereAgainstFullSet(z.sphereCentre.x, z.sphereCentre.y,
                                        z.sphereCentre.z, z.bodyRadius),
          `depth ${G.g_coli_hit_depth}`);
    check("and a wall stance leaves the sphere level with the actor",
          Math.abs(z.sphereCentre.y - z.pos.y) < 1e-6,
          `${z.sphereCentre.y} vs ${z.pos.y}`);
  }

  // **Which way a shot body flies.** `ThrowerBeginKnockbackArc`
  // (`FUN_0044D120`) moves the actor's **view-space** point along the camera's
  // own z and transforms it back: `p = (obj+0x70, obj+0x74, obj+0x78 - t)`.
  // That space has −z in front — `ThrowerPickLandingPoint` unprojects at a
  // literal −15.5 — so `z - t` is *further in front*, and the body is thrown
  // away from the viewer. The port lerped from the actor toward the eye
  // instead, under a `[diverges]` claiming the camera matrix was out of reach,
  // and `k = min(1, t / d)` pinned the destination *on* the camera for
  // anything inside about fifteen units. A thrower pounces to 15.5 in front,
  // so that was every close kill: "when I kill them they seem to be pulled
  // towards me rather than away".
  {
    const z = thrower(ThrowerState.StandAndDecide);
    T.coli = { files: ["test"], blobs: { floor: FLOOR_BLOB } };
    G.g_coli_full_set = ["floor"];
    // Off to one side and well inside the range that used to pin it: the
    // lateral offset is what tells the two shapes apart.
    z.pos = vec3(6, 0, 14);
    z.lookAt = vec3(6, 8, 14);
    const wasZ = z.pos.z;
    ThrowerBeginKnockbackArc(z, CAM_HOST);
    check("a shot body is thrown away from the camera, not at it",
          z.arcTo.z > wasZ, `${wasZ} -> ${z.arcTo.z.toFixed(2)}`);
    // Along the camera's z, so the screen-space offset survives: the body
    // recedes rather than converging on the viewer.
    check("...and it keeps its offset across the screen",
          Math.abs(z.arcTo.x - z.pos.x) < 1e-6,
          `x ${z.pos.x} -> ${z.arcTo.x.toFixed(2)}`);
    check("and it ends further from the eye than it began",
          Math.hypot(z.arcTo.x - EYE.x, z.arcTo.z - EYE.z)
          > Math.hypot(z.pos.x - EYE.x, z.pos.z - EYE.z),
          `${Math.hypot(z.pos.x - EYE.x, z.pos.z - EYE.z).toFixed(2)}`
          + ` -> ${Math.hypot(z.arcTo.x - EYE.x, z.arcTo.z - EYE.z).toFixed(2)}`);
    check("and it never lands on the camera",
          Math.hypot(z.arcTo.x - EYE.x, z.arcTo.z - EYE.z) > 1,
          `${z.arcTo.x.toFixed(2)},${z.arcTo.z.toFixed(2)} vs eye`);

    // Dead is half as far again — `if (obj+0x34 & 0x4000000) t *= 1.5`.
    const alive = z.arcTo.z - z.pos.z;
    z.flags |= ActorFlag.Dead;
    ThrowerBeginKnockbackArc(z, CAM_HOST);
    check("a body that was already dead is thrown half as far again",
          Math.abs((z.arcTo.z - z.pos.z) - alive * 1.5) < 1e-4,
          `${alive.toFixed(3)} -> ${(z.arcTo.z - z.pos.z).toFixed(3)}`);
  }

  // **How long that arc lasts, which is not one number.**
  // `ActorArcBeginToAtSpeed` (`FUN_0044DB50`) picks its floor from two flag
  // words before it divides:
  //
  //   0044dbaa  TEST EAX, 0x2000000    a900000002   ; EAX = obj+0x136C
  //   0044dbc9  JZ   0044dbda                       ; clear -> 15
  //   0044dbce  MOV  EDI, 0xa                       ; set   -> 10 ...
  //   0044dbd3  TEST EAX, 0x44000000   a900000044   ; ... EAX = obj+0x34
  //   0044dbd8  JZ   0044dbdf                       ;     unless dead/reacting
  //   0044dbda  MOV  EDI, 0xf                       ;     -> 15
  //   0044dbe7  FDIVR float ptr [0x0055ccd4]        ; = 0000f041 = 30.0f
  //
  // so `arcTotal = max(N, dist2d / (30.0 / N))`. `ThrowerShotFeedback`
  // (`FUN_00449B20`) raises `ThrowerFlag.LowSphere` as half of
  // `OR EDX, 0x6000000` on the head shot that knocks a thrower down, so a
  // **live** knocked-down thrower takes the 10 branch — and the port had 15
  // and `dist2d / 2` hardcoded, which is only ever the other one.
  {
    const near = () => {
      const a = thrower(ThrowerState.StandAndDecide);
      T.coli = { files: ["test"], blobs: { floor: FLOOR_BLOB } };
      G.g_coli_full_set = ["floor"];
      // Close enough that the travel never reaches either floor, so the
      // assertion is about the floor itself and not about the division.
      a.pos = vec3(0, 0, 60);
      a.lookAt = vec3(0, 8, 60);
      return a;
    };

    const plain = near();
    ThrowerBeginKnockbackArc(plain, CAM_HOST);
    check("an ordinary shot body's arc is floored at 15 frames",
          plain.arcTotal === 15, `${plain.arcTotal}`);

    const knocked = near();
    knocked.flags2 |= ThrowerFlag.LowSphere;
    ThrowerBeginKnockbackArc(knocked, CAM_HOST);
    check("a live knocked-down thrower's is floored at 10, not 15",
          knocked.arcTotal === 10, `${knocked.arcTotal}`);

    // ...and the second test kills the branch again: `0x44000000` is
    // `Dead | Reacting` on `obj+0x34`.
    for (const f of [ActorFlag.Dead, ActorFlag.Reacting]) {
      const back = near();
      back.flags2 |= ThrowerFlag.LowSphere;
      back.flags |= f;
      ThrowerBeginKnockbackArc(back, CAM_HOST);
      check(`...but obj+0x34 0x${f.toString(16)} puts it back to 15`,
            back.arcTotal === 15, `${back.arcTotal}`);
    }

    // The divisor moves with the floor: 30 units per `N` frames, so the same
    // distance takes fewer frames on the 10 branch. Far enough out that both
    // clear their floor.
    // `t = 15/|view| * 10`, so the throw is longest from close in — which is
    // also the only place either floor is cleared.
    const far = (low: boolean) => {
      const a = near();
      if (low) a.flags2 |= ThrowerFlag.LowSphere;
      a.pos = vec3(0, 0, 4);
      a.lookAt = vec3(0, 1, 4);
      ThrowerBeginKnockbackArc(a, CAM_HOST);
      const d = Math.hypot(a.arcTo.x - a.arcFrom.x, a.arcTo.z - a.arcFrom.z);
      return { total: a.arcTotal, d };
    };
    const slow = far(false);
    const fast = far(true);
    check("a long arc runs at 30 units per its own floor",
          slow.total > 15 && fast.total > 10
          && slow.total === Math.trunc(slow.d / (30 / 15))
          && fast.total === Math.trunc(fast.d / (30 / 10)),
          `${slow.total} vs ${Math.trunc(slow.d / 2)},`
          + ` ${fast.total} vs ${Math.trunc(fast.d / 3)}`);
    check("...so the knocked-down one gets there in fewer frames",
          fast.total < slow.total, `${fast.total} vs ${slow.total}`);
  }

  // **The Kill button.** `ActorKillAll` sets `dead` and `ActorFlag.Dead`, and
  // class 0x31's death chain is entered by `ThrowerOnShot` reading
  // `pendingHit` — which nothing was writing. So the button left a thrower
  // flagged dead and still pouncing at you, while the gate, which was counting
  // the renderer's instances rather than `g_enemies_alive`, opened anyway.
  {
    const rng = new Rng(9);
    const events = new Events();
    const z = thrower(ThrowerState.StandAndDecide);
    T.coli = { files: ["test"], blobs: { floor: FLOOR_BLOB } };
    G.g_coli_full_set = ["floor"];
    const before = G.g_enemies_alive;
    check("one thrower is one enemy alive", before === 1, `${before}`);

    ActorKillAll(rng);
    check("the kill leaves the hit its death chain reads",
          z.dead && z.pendingHit !== null,
          `dead ${z.dead} hit ${JSON.stringify(z.pendingHit)}`);
    // `ThrowerReleaseSlotOnDeath` (`FUN_0044D050`) runs on the first frame of
    // the fall, not when the body settles: the room clears when you land the
    // shot.
    GameUpdate(1 / 60, CAM_HOST, rng, events);
    check("...and it leaves `g_enemies_alive` on the first frame of the fall",
          G.g_enemies_alive === 0 && z.state === ThrowerState.FallAndLand,
          `alive ${G.g_enemies_alive} state ${z.state}`);

    // It must not leave twice, however many of the four fall states run.
    for (let i = 0; i < 600; i++) GameUpdate(1 / 60, CAM_HOST, rng, events);
    check("and only once, whatever the rest of the fall does",
          G.g_enemies_alive === 0, `alive ${G.g_enemies_alive}`);
  }
}

// -- the class table, and who fills it --------------------------------------

console.log("\n`g_class_handlers`, filled by the classes themselves:");
{
  // The table is empty at `registry.ts`'s own evaluation and each class module
  // writes its own row. That is only true if the modules have been evaluated,
  // and the one thing that guarantees they have is `director.ts`'s side-effect
  // import of `game/classes.ts` -- which this file gets by importing
  // `ActorSpawn`. A missing import here is seven classes with no behaviour and
  // nothing at all saying so, which is exactly the failure the old ESM cycle
  // produced three times.
  const want: [SpawnClass, string][] = [
    [SpawnClass.Civilian, "0x10 civilian"],
    [SpawnClass.Frog, "0x11 frog"],
    [SpawnClass.Boss4, "0x19 stage-4 boss"],
    [SpawnClass.Judgment, "0x22 JUDGMENT's flier"],
    [SpawnClass.JudgmentCompanion, "0x23 JUDGMENT's walker"],
    [SpawnClass.Boss2, "0x14 stage-2 boss"],
    [SpawnClass.WaterWaveField, "0x16 the stage-2 boss arena's wave field"],
    [SpawnClass.WaterWaveSource, "0x17 one wave source on it"],
    [SpawnClass.OneHitTarget, "0x20 one-hit target"],
    [SpawnClass.RankScaledEnemy, "0x21 rescue target"],
    [SpawnClass.ScriptedProp, "0x13 script-driven prop / the boat"],
    [SpawnClass.FlagStripProp, "0x12 slot strip on a flag / the bin's door"],
    [SpawnClass.CarriedZombie, "0x18 the zombie that rides it"],
    [SpawnClass.Vehicle, "0x26 subtype 2, the boat the player rides"],
    [SpawnClass.PathRidingProp, "0x28 stage 1's two burning cars"],
    [SpawnClass.SetPieceProp, "0x24 set piece"],
    [SpawnClass.ScriptedHumanoid, "0x25 scripted humanoid"],
    [SpawnClass.Zombie, "0x30 zombie"],
    [SpawnClass.Thrower, "0x31 thrower"],
    [SpawnClass.ScriptedScenery, "0x33 scripted scenery / the carrier"],
    [SpawnClass.PropContainerPlacer, "0x41 prop container placer"],
    [SpawnClass.FlyingEnemy, "0x43 owl"],
    [SpawnClass.PropPlacer, "0x44 prop placer"],
    [SpawnClass.Boss3, "0x45 stage-3 boss"],
    [SpawnClass.HordeSpawner, "0x40 horde"],
    [SpawnClass.Worm, "0x42 worm"],
    [SpawnClass.Bat, "0x46 bat"],
    [SpawnClass.WaterEnemy, "0x51 fish"],
    [SpawnClass.Mouse, "0x52 mouse / branch trigger"],
    [SpawnClass.SkinnedNpc, "0x53 cat / branch trigger"],
    [SpawnClass.ChapterCard, "0x60 chapter card"],
    [SpawnClass.ResultCard, "0x61 result card"],
    [SpawnClass.ResultCardTally, "0x62 result card loader"],
  ];
  for (const [cls, name] of want) {
    check(`${name} registered itself`,
          typeof g_class_handlers[cls]?.update === "function",
          `handler ${JSON.stringify(g_class_handlers[cls] ?? null)}`);
  }
  check("...and `PORTED_CLASSES` is exactly those and nothing else",
        PORTED_CLASSES.length === want.length
        && want.every(([c]) => PORTED_CLASSES.includes(c)),
        PORTED_CLASSES.map((c) => `0x${c.toString(16)}`).join(","));
  // The cat is 0x53 and now has one -- its sub-type 2 is a route-branch
  // trigger -- and 0x40, the horde, and 0x42, the worm, have one too. Class
  // 0x2D still has none: an unported class must stay absent rather than fall
  // back to anything, because an `if` is what had the cat running the
  // zombie's state machine.
  check("a class with no module has no row",
        g_class_handlers[SpawnClass.LargeCreature] === undefined);

  // Loud, not last-one-wins. A row silently overwritten by a second module is
  // a class whose behaviour depends on evaluation order.
  let threw = "";
  try {
    registerClass(SpawnClass.Zombie, { init: () => undefined,
                                       update: () => undefined });
  } catch (e) {
    threw = String(e);
  }
  check("registering a class twice throws", threw.includes("twice"), threw);
  check("...and the first registration is untouched",
        g_class_handlers[SpawnClass.Zombie]?.debug !== undefined);
}

// -- the sweep asks the class -----------------------------------------------

console.log("\n`ActorDeadSweep`, and what each class gives back:");
{
  const rng = new Rng(3);
  scene(0, rng);

  // Class 0x30. The permit on every reason; the counts on death and despawn
  // and never on a frame the renderer simply has not drawn.
  const z = spawnZombie(0x2000, 1, "zombie");
  z.visible = true;
  z.hp = 10;
  check("one zombie is one enemy alive and present",
        G.g_enemies_alive === 1 && G.g_enemies_present === 1,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);
  check("...and it takes a permit", TryClaimAttackSlot(z, new Rng(1), NULL_HOST));

  ActorDeadSweep(z, DeadSweep.Unloaded);
  check("an undrawn zombie gives the permit back",
        z.attackPermit === -1 && G.g_attack_permits[0] === -1);
  check("...and keeps both counts, because it is not dead",
        G.g_enemies_alive === 1 && G.g_enemies_present === 1,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);

  // **A dead zombie keeps both counts here**, the same as a dead thrower
  // below. Class 0x30's death is four states and they retire from the counts
  // where the exe does -- `ZombieReleasePermitAndUntrack` (`FUN_004565A0`)
  // drops the alive count as state 6 opens, `ZombieEnterCorpseState`
  // (`FUN_00456740`) the present count when the death clip ends. The sweep
  // used to retire both on this reason, which collapsed the one window
  // `wait_enemies_present` and `wait_enemies_alive` exist to tell apart.
  ActorDeadSweep(z, DeadSweep.Dead);
  check("a dead zombie gives the permit back",
        z.attackPermit === -1 && G.g_attack_permits[0] === -1);
  check("...and keeps both counts: its own death states retire them",
        G.g_enemies_alive === 1 && G.g_enemies_present === 1,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);
  ActorDeadSweep(z, DeadSweep.Despawned);
  check("a despawned one leaves both",
        G.g_enemies_alive === 0 && G.g_enemies_present === 0,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);
  ActorDeadSweep(z, DeadSweep.Despawned);
  check("...and the latches make a second sweep free",
        G.g_enemies_alive === 0 && G.g_enemies_present === 0,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);
}
{
  const rng = new Rng(3);
  scene(0, rng);

  // Class 0x31 disagrees about both facts, which is why the sweep asks. Its
  // death is four states and it retires from the counts where the exe does, so
  // a dead thrower is still *present*.
  const w = ActorSpawn(0x2100, SpawnClass.Thrower, 0x35, "thrower");
  w.visible = true;
  w.hp = 10;
  check("one thrower is one enemy alive and present",
        G.g_enemies_alive === 1 && G.g_enemies_present === 1,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);
  check("...and it takes a permit in its own bit",
        ThrowerTryClaimAttackSlot(w, new Rng(1), NULL_HOST) && w.attackPermit >= 0);

  ActorDeadSweep(w, DeadSweep.Dead);
  check("a dead thrower gives the permit back",
        w.attackPermit === -1 && G.g_attack_permits[0] === -1);
  check("...and stays present and alive: its own death states do that",
        G.g_enemies_alive === 1 && G.g_enemies_present === 1,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);

  ActorDeadSweep(w, DeadSweep.Despawned);
  check("a despawned one leaves both, in `obj+0x136C`'s latches",
        G.g_enemies_alive === 0 && G.g_enemies_present === 0,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);
}
{
  const rng = new Rng(3);
  scene(0, rng);

  // The generic enemy release in `despawn.ts` — the fallback for a class with
  // no `onDeadSweep`. It used to be exercised through class 0x51 and then
  // through 0x43; **every class in `ENEMY_CLASSES` now has a module**, and
  // every one of those modules has the hook, so the fallback's enemy branch is
  // no longer reachable from a ported class. That is the assertion now: if a
  // future enemy class is added to the set without a hook, this fails and says
  // so, which is the thing the old stand-in was really guarding.
  for (const cls of ENEMY_CLASSES) {
    check(`0x${cls.toString(16)} is an enemy and answers for its own teardown`,
          typeof g_class_handlers[cls as SpawnClass]?.onDeadSweep === "function",
          `${SpawnClass[cls as SpawnClass]}`);
  }

  // ...and a non-enemy is not counted either way.
  const c = ActorSpawn(0x2300, SpawnClass.ScriptedHumanoid, 0, "humanoid");
  ActorDeadSweep(c, DeadSweep.Dead);
  check("a non-enemy leaves the counters alone",
        G.g_enemies_alive === 0 && G.g_enemies_present === 0,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);
}

// -- 12. the shot queue: input in, decisions in the port ---------------------

/**
 * **The whole of a shot, with no renderer anywhere near it.**
 *
 * Until step 21 every line below ran in `render/shooting.ts` behind a
 * `pointerdown` handler: the score, the head combo, `MarkActorShot`,
 * `BreakablePropTakeShot` and `ResolveHit` itself. None of it could be
 * asserted here, and the head combo had a second private copy that no snapshot
 * carried. Now a click is *input* — a segment on `g_shot_requests` — and
 * `ProcessShotRequests` drains it at the head of `GameUpdate`, which is what
 * makes this section possible at all.
 *
 * The host is the only stub: the hit spheres ride bones a skeleton poses, so
 * `pickShot` is answered by the renderer in the player and by three lines here.
 */
console.log("\nthe shot queue:");
{
  const rng = new Rng(21);
  const events = scene(3, rng);
  // The headshots are on bone 2, the fixture's head. They used to be on bone 1
  // with the fixture's `head_bone` pointed at it, which the port read; the exe
  // asks `CMP EBP, 0x2` of the shot bone, an immediate, so no table can move
  // the head anywhere else.
  for (const o of G.g_object_list) o.hp = 100;
  const [z0, z1, z2] = G.g_object_list;

  let pick: ShotPick | null = null;
  const host = { ...NULL_HOST, pickShot: () => pick };
  const RAY = { origin: vec3(0, 0, 0), dir: vec3(0, 0, 1) };
  const seen: { kind: string; points: number }[] = [];
  events.on("shot.resolved", (r) => seen.push({ kind: r.kind, points: r.points }));
  // Every `PlaySoundId` the frame makes, in order. The gunshot is the reason
  // this is here: it was the one sound in the whole shot path that nothing
  // emitted, so the page fired silently and every other noise -- the flesh
  // impact, the ricochet, the surface -- played over the top of nothing.
  const heard: number[] = [];
  events.on("sound.play", (e) => heard.push(e.id));

  // A miss.
  pick = null;
  QueueShotRequest(0, RAY);
  check("a trigger pull waits on the queue", G.g_shot_requests.length === 1);
  check("...and carries the frame it was pulled on",
        G.g_shot_requests[0].frame === Math.round(G.g_frame),
        `${G.g_shot_requests[0].frame} vs ${G.g_frame}`);
  GameUpdate(1 / 60, host, rng, events);
  check("the frame drains it", G.g_shot_requests.length === 0);
  check("a miss scores nothing", G.g_player_score[0] === 0
        && seen.at(-1)?.kind === "miss");
  check("but it is still a shot fired", G.g_player_shot_count[0] === 1);
  // `PlayerFireAndReloadUpdate` (`FUN_00414940`) plays the gunshot at the
  // trigger, not at the hit, so a shot into nothing is as loud as one that
  // lands. It is the FIRST sound of the frame because the engine's order is
  // `BuildShotRay`, `PlayerShotEffectSpawn`, `PlaySoundId`, and everything the
  // round meets is decided after that.
  check("a miss still fires the gun", heard[0] === 0x003416a9,
        heard.map((h) => h.toString(16)).join(" "));

  // Two headshots, then a body shot.
  pick = { kind: "actor", at: z0.at, bone: 2, point: vec3() };
  QueueShotRequest(0, RAY);
  GameUpdate(1 / 60, host, rng, events);
  check("a headshot pays 120", G.g_player_score[0] === 120,
        `${G.g_player_score[0]}`);
  check("...and arms `g_head_combo_bonus`, which is the engine's own global",
        G.g_head_combo_bonus[0] === 10, `${G.g_head_combo_bonus[0]}`);

  pick = { kind: "actor", at: z1.at, bone: 2, point: vec3() };
  QueueShotRequest(0, RAY);
  GameUpdate(1 / 60, host, rng, events);
  check("the second consecutive headshot pays 130",
        G.g_player_score[0] === 250, `${G.g_player_score[0]}`);

  pick = { kind: "actor", at: z2.at, bone: 4, point: vec3() };
  QueueShotRequest(0, RAY);
  GameUpdate(1 / 60, host, rng, events);
  check("a hit that is not on the head pays ten and clears the combo",
        G.g_player_score[0] === 260 && G.g_head_combo_bonus[0] === 0,
        `${G.g_player_score[0]} / ${G.g_head_combo_bonus[0]}`);
  check("and the hit reached `ResolveHit` -- hit points came off",
        z2.hp === 97, `hp ${z2.hp}`);

  // The gun, on a shot that lands. `g_gunshot_sound_ids` (0x004EC8BC) is two
  // entries and the players do not share one: 0x003416A9 is
  // `COMMON\GUN5_22.WAV` and 0x003316A9 is `COMMON\GUN4_22.WAV`.
  {
    heard.length = 0;
    pick = { kind: "actor", at: z2.at, bone: 4, point: vec3() };
    QueueShotRequest(0, RAY);
    GameUpdate(1 / 60, host, rng, events);
    check("a hit fires the gun too, and before whatever the round met",
          heard[0] === g_gunshot_sound_ids[0],
          heard.map((h) => h.toString(16)).join(" "));
    // Player 1 has to be in play to pull a trigger at all: the trigger is
    // polled from the player's own task.
    JoinPlayerTwo();
    heard.length = 0;
    QueueShotRequest(1, RAY);
    GameUpdate(1 / 60, host, rng, events);
    check("...and player 1 carries the other gun, not a copy of player 0's",
          heard[0] === g_gunshot_sound_ids[1]
          && g_gunshot_sound_ids[0] !== g_gunshot_sound_ids[1],
          heard.map((h) => h.toString(16)).join(" "));
    check("the two ids are the exe's own `a9163400 a9163300`",
          g_gunshot_sound_ids[0] === 0x003416a9
          && g_gunshot_sound_ids[1] === 0x003316a9,
          g_gunshot_sound_ids.map((h) => h.toString(16)).join(" "));
    // Both are namespace 0 -- SE -- which is what routes them to `/se/` rather
    // than to the BGM element. A gunshot that came out as a BGM id would stop
    // the music and loop for ever.
    check("...and both are SE ids, not music",
          g_gunshot_sound_ids.every((id) => id >>> 28 === 0));
    heard.length = 0;
  }

  // Two pulls between frames both land, in the order they were made -- off a
  // full magazine, which a frame of its own reloads.
  QueueOffscreenPull(0);
  GameUpdate(1 / 60, host, rng, events);
  const before = G.g_player_score[0];
  pick = { kind: "actor", at: z2.at, bone: 4, point: vec3() };
  QueueShotRequest(0, RAY);
  QueueShotRequest(0, RAY);
  check("two pulls before the next frame both queue",
        G.g_shot_requests.length === 2);
  GameUpdate(1 / 60, host, rng, events);
  check("...and both resolve on it", G.g_player_score[0] === before + 20
        && G.g_shot_requests.length === 0, `${G.g_player_score[0]}`);

  // A class that scores its own shot is only marked.
  {
    const civ = ActorSpawn(0x4100, SpawnClass.Civilian, 1, "hostage");
    civ.visible = true;
    const score = G.g_player_score[0];
    const hp = civ.hp;
    pick = { kind: "actor", at: civ.at, bone: 0, point: vec3() };
    QueueShotRequest(0, RAY);
    GameUpdate(1 / 60, host, rng, events);
    // The mark is consumed on the same frame: `CivilianCheckShot` reads
    // `obj+0x34` bit 3 in her own update, which runs after the queue drains.
    // What is under test is that the shot never reached `ResolveHit` -- no
    // damage, no hit table, no gore, exactly as `ShotTestSphere` has it for an
    // actor without the skeleton bit.
    check("a civilian is marked, not resolved",
          seen.at(-1)?.kind === "marked" && civ.hp === hp,
          `${seen.at(-1)?.kind} hp ${civ.hp} vs ${hp}`);
    check("...and the shot itself is worth nothing -- her class charges it",
          G.g_player_score[0] === score, `${G.g_player_score[0]}`);
  }

  // The scene reset zeroes the queue: a seek must not fire a click from the
  // run it replaced.
  QueueShotRequest(0, RAY);
  ResetGameGlobals();
  EnterPlay();
  check("a scene reset empties the queue", G.g_shot_requests.length === 0);
}

// -- 12a. a stopped clock resolves nothing ----------------------------------

/**
 * **A frame that owes no tick must not do part of one**, and resolving a shot
 * is a whole game-time job: it takes hit points off, pays a score, arms the
 * head combo and fills three effect rings that only `ShotEffectsTick` can
 * empty again.
 *
 * `GameSystem` is the port's frame, and `app/loop.ts` hands it a tick with
 * `frozen: true` and no time in it whenever the transport is stopped — paused,
 * free roam, or `?freeze=1`. It used to drain `g_shot_requests` on that tick
 * anyway, so a click made with the clock stopped landed a hit, killed the
 * actor, scored it and spawned effects that then hung on screen for ever,
 * because nothing was stepping them. That is the "shots still register when
 * paused" report.
 *
 * **Step mode was not this case and never was**, which is the whole reason the
 * fix cost no debug capability: stepping ran the port at full rate while the
 * *script* stood still, so its ticks carried time and took the live path below.
 * The two assertions are deliberately the same fixture one after the other.
 */
console.log("\nthe shot queue, with the clock stopped:");
{
  const rng = new Rng(22);
  const events = scene(1, rng);
  const [z] = G.g_object_list;
  z.hp = 100;

  // Down the camera's own -Z, which is forward: `MuzzlePointInView` refuses a
  // ray pointing away from the screen, and the muzzle flash below is only an
  // assertion about a stopped clock if the fixture can light it.
  const RAY = { origin: vec3(0, 0, 0), dir: vec3(0, 0, -1) };
  const pick: ShotPick = { kind: "actor", at: z.at, bone: 4, point: vec3() };
  const game = new GameSystem();
  game.backend = {
    boneWorld: () => false,
    setBoneSlot: () => undefined,
    pickShot: () => pick,
  };
  const scope = new Scope("test:stopped-clock");
  const view = new CameraFrame();
  // A camera at the origin looking down -Z. `CameraFrame` starts with both
  // matrices all zero, which makes every transform NaN and every effect the
  // shot would spawn refuse itself -- so the muzzle-flash assertion below
  // would pass on a fixture that could never light one.
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  view.take(I, I);
  const ctx: Context = {
    events, rng, walker: null, scope, session: scope.child("session"),
    view, stage: 1, frame: 0,
  };
  // `Loop.idle` and `pacer.ts`'s `STOPPED_TICK`, by value: wall time for the
  // layers that ride it, and no game time at all.
  const STOPPED: Tick = { dt: 0, frames: 0, wall: 1 / 60, frozen: true };
  // What `stepOneFrame` hands the port on a tick that owes one -- play mode.
  // (Step mode, when there was one, was the case that had to keep working.)
  const LIVE: Tick = { dt: 1 / 60, frames: 1, wall: 1 / 60, frozen: false };

  QueueShotRequest(0, RAY);
  const frame = G.g_frame;
  // A heading the view cannot have, so a copy from it would show.
  G.g_camera_yaw_bams = 0x1234;
  const yawBefore = G.g_camera_yaw_bams;
  game.update(ctx, STOPPED);
  check("a stopped clock leaves the pull on the queue",
        G.g_shot_requests.length === 1, `${G.g_shot_requests.length}`);
  check("...and takes no hit points off", z.hp === 100, `hp ${z.hp}`);
  check("...and pays nothing", G.g_player_score[0] === 0,
        `${G.g_player_score[0]}`);
  check("...and does not count a shot fired", (G.g_player_shot_count[0] ?? 0) === 0,
        `${G.g_player_shot_count[0]}`);
  check("...and leaves the muzzle flash unlit",
        G.g_shot_flash_ring.every((f) => !f.live));
  check("...and throws no tracer",
        G.g_shot_tracer_ring.every((t) => !t.live));
  check("...and does not move the frame counter", G.g_frame === frame,
        `${G.g_frame} vs ${frame}`);
  // Nor is any camera word copied in from the drawn camera. The gameplay yaw
  // (`g_camera_yaw_bams`, beside `g_camera_eye`) is the scene state's hook's,
  // written inside the tick; it used to be taken from `ctx.view` here, on
  // stopped ticks too, which put the drawn camera's heading where the engine
  // keeps the players'.
  check("...and writes no camera word from the drawn camera",
        G.g_camera_yaw_bams === yawBefore,
        `${G.g_camera_yaw_bams} vs ${yawBefore} (view ${ctx.view.yawBams})`);

  // The frame after an unpause: the same request, the same
  // fixture, a tick with time in it.
  game.update(ctx, LIVE);
  check("the first tick with time in it drains the queue",
        G.g_shot_requests.length === 0, `${G.g_shot_requests.length}`);
  check("...and the hit reaches `ResolveHit`", z.hp < 100, `hp ${z.hp}`);
  check("...and pays for it", G.g_player_score[0] > 0,
        `${G.g_player_score[0]}`);
  scope.dispose();
}

/**
 * `ActorRegisterCameraPoint` (`FUN_00409B70`): the tracked bone, lifted.
 *
 * This ran in `render/characters.ts`, which meant the Characters view toggle
 * froze the camera's idea of where every actor was — a view switch changing
 * game state, which is what `no-actor-writes-in-render` exists to catch.
 */
console.log("\nwhere the camera follows an actor:");
{
  const rng = new Rng(22);
  const events = scene(1, rng);
  const z = G.g_object_list[0];
  const host = {
    ...NULL_HOST,
    boneWorld: (_at: number, bone: number, out: Vec3) => {
      if (bone !== 1) return false;
      out.x = 10; out.y = 20; out.z = 30;
      return true;
    },
  };
  GameUpdate(1 / 60, host, rng, events);
  check("the tracked bone becomes `obj+0x100`, raised by four",
        z.lookAt.x === 10 && z.lookAt.y === 24 && z.lookAt.z === 30,
        JSON.stringify(z.lookAt));

  const held = { ...z.lookAt };
  GameUpdate(1 / 60, { ...NULL_HOST }, rng, events);
  check("a host with no pose leaves it where it was",
        z.lookAt.x === held.x && z.lookAt.y === held.y
        && z.lookAt.z === held.z, JSON.stringify(z.lookAt));
}


/**
 * The strike anchor, `obj+0x136C & 0x40000`, and the four things that hang off
 * it.
 *
 * `ZombieStateStrike` raises it when it captures `strikeStart`
 * (`00455b98 a900000400` / `00455ba5 0d00000400`) and **on the melee path
 * nothing ever clears it again**: the one `AND` in the program that does is in
 * `ZombieSplitUpdateSelf` (`0045db39 25fffffbff`), which an ordinary zombie never
 * reaches. The port modelled it as a boolean, cleared it in three places, and
 * left it out of the two tests in `ZombieStateHoldAtRange` that read it -- one
 * misreading with four separate symptoms, which is what these assert.
 */
console.log("\nthe strike anchor and the cooldown it gates:");
{
  const rng = new Rng(41);
  const events = scene(0, rng);
  void events;
  const INNER = APPROACH.rings[0].inner;

  const zombie = (name: string, over: Partial<Actor> = {}): ZombieActor => {
    const z = spawnZombie(0x7900, 1, name);
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.attackState = 1;
    z.state = ZombieState.HoldAtRange;
    z.sub = 0;
    // `motion_row[condition][MotionRow.Walk]`, the clip the hub plays while an
    // actor waits its turn.
    z.motion = TYPE.motion_row["0"][MotionRow.Walk];
    z.pos = vec3(0, 0, 40);
    z.target = vec3(0, 0, 0);
    Object.assign(z, over);
    return z;
  };
  const clear = () => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    G.g_players_in_play = 1;
  };

  // -- B1. the too-close retreat has an escape, and it is `flags2 & 0x40400`
  //
  // `0045577c  f7866c13000000040400   TEST dword ptr [ESI+0x136c], 0x40400`
  // and the `JNZ` at `00455786` jumps past the whole retreat. Without it a
  // zombie that finishes a swing inside the ring -- which is where a swing
  // ends, because the attack's own distance is inside it -- is bounced
  // straight back into `BackOff` on its first frame in the hub.
  {
    clear();
    const z = zombie("inside-the-ring, has swung",
                     { pos: vec3(0, 0, INNER - 5) });
    z.flags2 |= ZombieFlag2.StrikeAnchor;
    ZombieStateHoldAtRange(z, new Rng(1), NULL_HOST);
    check("an actor that has already swung is exempt from the too-close retreat",
          z.state !== ZombieState.BackOff, ZombieState[z.state] ?? String(z.state));
  }
  {
    clear();
    const z = zombie("inside-the-ring, mid entry clip",
                     { pos: vec3(0, 0, INNER - 5) });
    z.flags2 |= ZombieFlag2.EntryClipPlaying;
    ZombieStateHoldAtRange(z, new Rng(1), NULL_HOST);
    check("...and so is one still playing its authored entry clip",
          z.state !== ZombieState.BackOff, ZombieState[z.state] ?? String(z.state));
  }
  {
    clear();
    const z = zombie("inside-the-ring, never swung",
                     { pos: vec3(0, 0, INNER - 5) });
    ZombieStateHoldAtRange(z, new Rng(1), NULL_HOST);
    check("...but one carrying neither bit still backs off",
          z.state === ZombieState.BackOff, ZombieState[z.state] ?? String(z.state));
  }

  // -- B2. `ZombieStateBackOff` does not clear the anchor ------------------
  //
  // Its only `AND` on `obj+0x136C` is `00455cc0  81e1ffffbfff`, which clears
  // `0x400000` -- the turn flip -- and nothing else.
  {
    clear();
    const z = zombie("retreating", { state: ZombieState.BackOff });
    z.flags2 |= ZombieFlag2.StrikeAnchor;
    z.target = vec3(0, 0, 0);
    z.pos = vec3(0, 0, INNER + 15);
    ZombieStateBackOff(z, 1 / 60, new Rng(2));
    check("the retreat hands back to the hub", z.state === ZombieState.HoldAtRange,
          ZombieState[z.state] ?? String(z.state));
    check("...and leaves the strike anchor standing",
          (z.flags2 & ZombieFlag2.StrikeAnchor) !== 0,
          `0x${z.flags2.toString(16)}`);
  }

  // -- B3. the cooldown countdown: its gate, its latch, and its fallthrough -
  //
  // `004557dc a801` arms it, `004557e0 f7866c13000000000400` gates it on the
  // anchor, `004557f2 4a` is the one decrement and `004557ff 24fe` disarms the
  // latch when it runs out. There is no `RET` on that path: the exe falls
  // through to the idle and the turn at the bottom of the state.
  {
    clear();
    const z = zombie("cooling, never swung", { cooldown: 10 });
    z.zom.hasCooldown = true;
    ZombieStateHoldAtRange(z, new Rng(3), NULL_HOST);
    check("a cooldown does not run down for an actor that has never swung",
          z.cooldown === 10, String(z.cooldown));
  }
  {
    clear();
    const z = zombie("cooling", { cooldown: 2 });
    z.zom.hasCooldown = true;
    z.flags2 |= ZombieFlag2.StrikeAnchor;
    ZombieStateHoldAtRange(z, new Rng(3), NULL_HOST);
    check("...and does for one that has", z.cooldown === 1, String(z.cooldown));
    check("...with the latch still armed at one", z.zom.hasCooldown,
          String(z.zom.hasCooldown));
    ZombieStateHoldAtRange(z, new Rng(3), NULL_HOST);
    check("...and the latch disarms itself as the counter runs out",
          z.cooldown === 0 && !z.zom.hasCooldown, `${z.cooldown}/${z.zom.hasCooldown}`);
  }
  {
    clear();
    const z = zombie("cooling and idling", { cooldown: 30, motion: 12 });
    z.zom.hasCooldown = true;
    z.flags2 |= ZombieFlag2.StrikeAnchor;
    z.yaw = 0x4000;
    ZombieStateHoldAtRange(z, new Rng(3), NULL_HOST);
    check("a cooling zombie still plays the row's idle", z.motion === 10,
          String(z.motion));
    check("...and still turns to face you", z.yaw !== 0x4000,
          `0x${z.yaw.toString(16)}`);
  }
  {
    clear();
    const z = zombie("retreating with a cooldown",
                     { state: ZombieState.BackOff, cooldown: 50,
                       pos: vec3(0, 0, INNER + 15) });
    z.zom.hasCooldown = true;
    z.flags2 |= ZombieFlag2.StrikeAnchor;
    ZombieStateBackOff(z, 1 / 60, new Rng(2));
    check("the retreat leaves an armed cooldown alone",
          z.state === ZombieState.HoldAtRange && z.cooldown === 50,
          `${z.state}/${z.cooldown}`);
  }
  {
    clear();
    const z = zombie("retreating without one",
                     { state: ZombieState.BackOff, cooldown: 50,
                       pos: vec3(0, 0, INNER + 15) });
    ZombieStateBackOff(z, 1 / 60, new Rng(2));
    check("...and zeroes an unarmed one, as `00455d9f` does", z.cooldown === 0,
          String(z.cooldown));
  }

  // -- B4. a camera-cued attacker strikes from where it stands -------------
  //
  // `00455b24  f6866813000001` -- the lunge is skipped outright while the
  // cooldown latch is armed, so state 19's four spawns swing at whatever range
  // the cue left them at instead of walking in first.
  {
    clear();
    const atk = TYPE.attacks["0"]["1"];
    const z = zombie("cued attacker",
                     { state: ZombieState.Strike, sub: StrikeSub.Lunge,
                       attack: 1, pos: vec3(0, 0, atk.distance + 20) });
    z.zom.hasCooldown = true;
    // The end of the attack cry: `ZombieStateStrike` (`FUN_00455A40`) calls
    // `ActorPlayHitVoice(obj, 3)` at `0x00455B8A`, on the frame the strike
    // clip is set. The routine itself is checked above; this is the wiring,
    // and it is the half that was missing -- the port had the routine for the
    // shot voices and nothing anywhere raised kind 3.
    const cried: number[] = [];
    const bus = new Events();
    bus.on("sound.play", (d) => cried.push(d.id));
    // This fixture's `CHARS.combat` is undefined, and `ActorPlayHitVoice`
    // reads the table off it -- so without this the check would pass on a
    // silent build and fail on a working one. Put a table in for the call.
    const noCombat = T.chars;
    SetGameTables({
      ...CHARS,
      combat: {
        impact: [], head_impact: [],
        voice: { hurt: [], kill: [], head: [],
                 attack: [[{ id: 40, file: "" }], [{ id: 50, file: "" }]] },
        voice_set_a_types: [], ricochet: {},
      },
    } as unknown as CharactersJson);
    ZombieStateStrike(z, new Rng(4), bus);
    check("a cooldown-armed attacker starts the swing where it stands",
          z.sub === StrikeSub.Swinging && z.action?.motion === atk.strike,
          `${z.sub}/${z.action?.motion}`);
    check("...and cries out as the swing starts",
          cried.length === 1, `${cried.length} sounds: ${cried.join(",")}`);
    if (noCombat) SetGameTables(noCombat);
  }
  {
    clear();
    const atk = TYPE.attacks["0"]["1"];
    const z = zombie("ordinary attacker",
                     { state: ZombieState.Strike, sub: StrikeSub.Lunge,
                       attack: 1, pos: vec3(0, 0, atk.distance + 20) });
    ZombieStateStrike(z, new Rng(4));
    // On the ordinary track, where `SetCurrentActorMotionBlended` at
    // `0x00455B49` puts it -- not the one-shot channel.
    check("...and one without the latch still lunges in",
          z.sub === StrikeSub.Lunge && z.action === null
            && z.motion === atk.lunge,
          `${z.sub}/${z.motion} action ${JSON.stringify(z.action)}`);
  }

  // -- B5. the retreat's third exit ----------------------------------------
  //
  // `00455d57 83be0c13000004` then `00455d67 d80df4445600`, whose operand at
  // 0x005644f4 is `3333333f` = 0.7: a body-condition-4 actor -- both arms gone
  // -- leaves the retreat at 70% of the inner radius.
  {
    clear();
    const z = zombie("armless, retreating",
                     { state: ZombieState.BackOff, condition: 4,
                       pos: vec3(0, 0, INNER * 0.8) });
    ZombieStateBackOff(z, 1 / 60, new Rng(2));
    check("condition 4 leaves the retreat at 0.7 of the ring",
          z.state === ZombieState.HoldAtRange,
          ZombieState[z.state] ?? String(z.state));
  }
  {
    clear();
    const z = zombie("whole, retreating",
                     { state: ZombieState.BackOff, condition: 0,
                       pos: vec3(0, 0, INNER * 0.8) });
    ZombieStateBackOff(z, 1 / 60, new Rng(2));
    check("...and every other condition has to reach the ring itself",
          z.state === ZombieState.BackOff,
          ZombieState[z.state] ?? String(z.state));
  }

  // -- B6. the entry clip refuses the claim, and clears itself -------------
  //
  // `00455815 f6c404` is the refusal; `00455904 80e4fb` is the clear, two
  // frames from the end of the clip on the play clock.
  {
    clear();
    const z = zombie("mid entry clip");
    z.flags2 |= ZombieFlag2.EntryClipPlaying;
    check("an actor still playing its entry clip may not claim",
          ZombieAttackRefusal(z) !== null, String(ZombieAttackRefusal(z)));
    z.playTicks = MotionPlayLength(z, z.motion) - 2;
    ZombieStateHoldAtRange(z, new Rng(5), NULL_HOST);
    check("...and the hub clears the bit two frames from the end of it",
          (z.flags2 & ZombieFlag2.EntryClipPlaying) === 0,
          `0x${z.flags2.toString(16)}`);
  }

  // -- B7. the retreat's clock is an integer -------------------------------
  //
  // `00455d29`/`00455d32`: `MOV ECX,[ESI+0x1334]; INC ECX` -- one increment
  // per **update**, and `00455d3b 3df0000000` compares the result against
  // 0xF0. The port accumulated `dt * 60` instead, which is the same number
  // only while the frame is exactly 1/60 of a second; the step given here is
  // deliberately not, because that is the only thing that can tell an integer
  // counter apart from an accumulator.
  {
    clear();
    const z = zombie("counting", { state: ZombieState.BackOff,
                                   pos: vec3(0, 0, 5) });
    for (let i = 0; i < 7; i++) ZombieStateBackOff(z, 1 / 50, new Rng(2));
    check("`backoffFrames` counts updates, not seconds", z.zom.backoffFrames === 7,
          String(z.zom.backoffFrames));
  }

  // -- B8. the strike commits at the pick, and the retreat lets go ---------
  //
  // `00455a93 80e5fe` / `00455a96 81c900000010`: sub 0's first write, before
  // the draw, drops `0x100` and raises `0x10000000` on `obj+0x34`, and nothing
  // on the melee path lowers it until `ZombieStateBackOff`'s first frame
  // (`00455ca1 81e1ffffffef`). `ActorPlayHitReaction` refuses outright while
  // it is up (`004544d8`), so a swing cannot be staggered. Nothing here sets
  // the bit by hand -- `L49` -- because the strike raising it is the half the
  // port was missing.
  {
    clear();
    const atk = TYPE.attacks["0"]["1"];
    const z = zombie("committing", { state: ZombieState.Strike,
                                     sub: StrikeSub.Pick,
                                     pos: vec3(0, 0, atk.distance + 20) });
    z.flags |= ActorFlag.ShotImmune;
    ZombieStateStrike(z, new Rng(4));
    check("the strike's pick raises `Committed`, before the lunge",
          (z.flags & ActorFlag.Committed) !== 0
            && z.state === ZombieState.Strike && z.sub === StrikeSub.Lunge,
          `flags 0x${z.flags.toString(16)} ${z.state}/${z.sub}`);
    check("...and drops bit 8 in the same write",
          (z.flags & ActorFlag.ShotImmune) === 0, `0x${z.flags.toString(16)}`);
    check("...so a shot during the lunge plays no stumble",
          ActorPlayHitReaction(z, 1, HitResultCode.Damaged) === undefined
            && z.react === null, JSON.stringify(z.react));
    const hp = z.hp;
    ResolveHit(z, 1, NULL_HOST, new Rng(6));
    check("...though the whole shot still lands, and the lunge goes on",
          z.hp < hp && z.react === null && z.state === ZombieState.Strike,
          `hp ${z.hp}/${hp} react ${JSON.stringify(z.react)} state ${z.state}`);

    z.pos = vec3(0, 0, atk.distance - 1);
    // A latch left up by whatever played before -- the arc entrance raises it
    // on its landing and hands straight to this state.
    z.flags2 |= ZombieFlag2.OneShotFired;
    ZombieStateStrike(z, new Rng(4));
    check("the swing is committed too",
          z.sub === StrikeSub.Swinging && (z.flags & ActorFlag.Committed) !== 0
            && ActorPlayHitReaction(z, 1, HitResultCode.Damaged) === undefined,
          `${z.sub} 0x${z.flags.toString(16)}`);
    check("...and its start drops the clip's one-shot latch, "
          + "`00455b77 81e2fffffeff`",
          (z.flags2 & ZombieFlag2.OneShotFired) === 0,
          `0x${z.flags2.toString(16)}`);

    // Play the clip out: the strike hands to the retreat and does not lower
    // the bit itself.
    const m = MotionOf(z, atk.strike);
    if (z.action && m) {
      z.action.ticks = ticksOfAuthoredFrame(m.frames - 1, m.fps);
    }
    ZombieStateStrike(z, new Rng(4));
    check("...and it is still up as the swing hands to the retreat",
          z.state === ZombieState.BackOff
            && (z.flags & ActorFlag.Committed) !== 0,
          `${ZombieState[z.state]} 0x${z.flags.toString(16)}`);
    z.pos = vec3(0, 0, 5);              // deep inside the ring: keeps retreating
    ZombieStateBackOff(z, 1 / 60, new Rng(2));
    check("`ZombieStateBackOff`'s first frame takes it down, in the write "
          + "that raises `BackingOff`",
          z.state === ZombieState.BackOff
            && (z.flags & ActorFlag.Committed) === 0
            && (z.flags & ActorFlag.BackingOff) !== 0,
          `${ZombieState[z.state]} 0x${z.flags.toString(16)}`);
    check("...and from there a shot staggers it again",
          ActorPlayHitReaction(z, 1, HitResultCode.Damaged) !== undefined,
          JSON.stringify(z.react));
  }

  // -- B9. ...and a committed zombie is shoved harder ----------------------
  //
  // `ZombiePushOutOfWorldAndActors` multiplies the push by 1.8 (`0x0055dd48`)
  // while `obj+0x34 & 0x18000000` (`004549b6`), and half of that mask is the
  // bit the strike raises. The port had the test and nothing that raised the
  // bit, so a striking zombie was pushed out of a crowd like any other.
  {
    const shove = (strike: boolean): number => {
      clear();
      const a = zombie("shoved", { state: ZombieState.Strike,
                                   sub: StrikeSub.Pick, pos: vec3(0, 0, 40) });
      const b = spawnZombie(0x7901, 1, "in the way");
      b.visible = true;
      b.hp = b.maxHp = 100;
      b.pos = vec3(2, 0, 40);             // well inside 3.5 + 3.5
      if (strike) ZombieStateStrike(a, new Rng(4));
      a.pos = vec3(0, 0, 40);
      PublishCrowd(a, b);
      ZombiePushOutOfWorldAndActors(a);
      return a.pos.x;
    };
    const plain = shove(false);
    const striking = shove(true);
    check("a zombie in its strike is pushed out 1.8x as far",
          plain < 0 && Math.abs(striking / plain - 1.8) < 1e-6,
          `${striking.toFixed(4)} against ${plain.toFixed(4)}`);
  }

  // -- B10. sub 1 falls into sub 2 on the frame the clip starts ------------
  //
  // `00455bc5` increments the sub and runs on into `00455bcc` with no `RET`
  // between them, so sub 2's `obj+0x19C == entry+0x08` sees frame 0 on the
  // frame the clip is set. No attack the shipped pick tables name has a hit
  // frame of 0, so this pins the shape with one that does.
  {
    clear();
    const atk0 = { ...TYPE.attacks["0"]["1"], hit_frame: 0 };
    SetGameTables({
      ...CHARS,
      types: { ...CHARS.types,
               "1": { ...TYPE, attacks: { ...TYPE.attacks, "0": { "1": atk0 } } } },
    } as unknown as CharactersJson);
    const z = zombie("frame-0 striker",
                     { state: ZombieState.Strike, sub: StrikeSub.Lunge,
                       attack: 1, pos: vec3(0, 0, atk0.distance - 1) });
    ZombieStateStrike(z, new Rng(4));
    check("an attack whose hit frame is 0 lands on the frame its clip starts",
          z.sub === StrikeSub.Swinging && z.action?.motion === atk0.strike
            && z.struck, `${z.sub}/${z.action?.motion}/${z.struck}`);
    SetGameTables(CHARS);
  }
}
/**
 * B25. The lift is `ActorRegisterCameraPoint`'s **float argument**, pushed by
 * whichever class's `Update` calls it, and the three ported classes that call
 * it do not agree: `PUSH 0x40800000` (`6800008040`) at `EnemyZombieUpdate`
 * 0x00453475 and `CivilianUpdate` 0x0048ADAB, `PUSH 0x0` (`6a00`) at
 * `EnemyThrowerUpdate` 0x0044998F.
 *
 * The port applied 4.0 to all of them and said so in a `[diverges]`. This is
 * the assertion that closes it: it fails on the old code, where a thrower's
 * `lookAt.y` came out at 24.
 */
console.log("\nthe camera-point lift is per class:");
{
  const rng = new Rng(23);
  const events = scene(1, rng);
  const zombie = G.g_object_list[0];
  const thrower = ActorSpawn(0x2000, SpawnClass.Thrower, 0x16, "thrower");
  thrower.visible = true;
  thrower.hp = 10;
  thrower.pos = vec3(0, 0, 60);
  const prop = ActorSpawn(0x2001, SpawnClass.SetPieceProp, 1, "prop");
  prop.visible = true;
  const host = {
    ...NULL_HOST,
    boneWorld: (_at: number, bone: number, out: Vec3) => {
      if (bone !== 1) return false;
      out.x = 10; out.y = 20; out.z = 30;
      return true;
    },
  };
  GameUpdate(1 / 60, host, rng, events);
  check("class 0x30 lifts by 4.0", zombie.lookAt.y === 24,
        String(zombie.lookAt.y));
  check("class 0x31 lifts by 0.0 -- `PUSH 0x0` at 0x0044998F",
        thrower.lookAt.y === 20, String(thrower.lookAt.y));
  check("a class the exe never registers gets no lift", prop.lookAt.y === 20,
        String(prop.lookAt.y));
  // The lift is each class's own push, made from its own update: there is
  // no table any more for a class to fall back on.
  check("...and a set piece that never makes the call is not a candidate",
        !G.g_camera_candidates.some((c) => c.at === prop.at));
}

/**
 * B27. `ColiTestSphereAgainstActors` (`FUN_00405B10`) fills a zero body radius
 * in from the shot radius and **stores it back**:
 * `MOV EAX, [EBX + 0x124]; MOV [EBX + 0x128], EAX` at 0x00405BB1/0x00405BB7.
 * A class that never sets `obj+0x128` still takes part in the crowd push.
 */
console.log("\nthe engine's body-radius fallback:");
{
  const rng = new Rng(24);
  scene(0, rng);
  const other = spawnZombie(0x3000, 1, "no body radius");
  other.visible = true;
  other.pos = vec3(0, 0, 0);
  other.radius = 6;
  other.bodyRadius = 0;
  const self = spawnZombie(0x3001, 1, "pusher");
  self.visible = true;
  self.pos = vec3(2, 0, 0);

  // The other actor published its sphere with a body radius of zero, so its
  // centre is `y = 0 + 0 + 1`; the probe is level with it and two units
  // aside: inside `1 + 6` only if the fallback filled the radius in.
  PublishCrowd(other, self);
  const hit = ColiTestSphereAgainstActors(self, 2, 1, 0, 1);
  check("a zero body radius still collides -- it falls back to `obj+0x124`",
        hit, String(hit));
  check("...and the fallback is stored back onto the actor",
        other.bodyRadius === 6, String(other.bodyRadius));
}

/**
 * B24. `CivilianUpdate`'s tail at `LAB_0048B0CE`: once the civilian carries
 * `obj+0x34` bit `0x4000000`, every surviving captor gets `obj+0x34` bit
 * `0x1000000` cleared and `obj+0x136C` bit `0x1` set, every frame.
 */
console.log("\na dead civilian releases its captors:");
{
  const rng = new Rng(25);
  const events = scene(0, rng);
  const civ = ActorSpawn(0x4000, SpawnClass.Civilian, 0x20, "civilian");
  civ.visible = true;
  civ.hp = 1;
  g_class_handlers[SpawnClass.Civilian]!.init(civ, rng);
  const captor = spawnZombie(0x4001, 1, "captor");
  captor.visible = true;
  captor.hp = 10;
  captor.flags |= ActorFlag.HoldingWeapon;
  civ.civ!.children = [captor.at];
  civ.civ!.childCount = 1;

  GameUpdate(1 / 60, NULL_HOST, rng, events);
  check("a living civilian holds its captors",
        (captor.flags & ActorFlag.HoldingWeapon) !== 0
        && (captor.flags2 & 1) === 0,
        `${captor.flags.toString(16)} / ${captor.flags2.toString(16)}`);

  civ.flags |= ActorFlag.Dead;
  GameUpdate(1 / 60, NULL_HOST, rng, events);
  check("a dead one clears `obj+0x34` bit 0x1000000 on each",
        (captor.flags & ActorFlag.HoldingWeapon) === 0,
        captor.flags.toString(16));
  check("...and sets `obj+0x136C` bit 0x1 on each",
        (captor.flags2 & 1) === 1, captor.flags2.toString(16));
}

/**
 * Bug 18. `CivilianUpdate` (`FUN_0048A920`) calls `ActorRegisterCameraPoint`
 * at `0x0048ADB0` on every path, and that tail-calls
 * `RegisterForCameraTracking` (`FUN_00408EC0`), whose only test is `obj+0x34`
 * bit `0x10000`. So a civilian whose wait word carries `0x40000` holds a
 * camera slot, `CameraDriverSelectMode` stays in the tracking mode, and
 * `g_camera_free` -- and with it every room-clear gate -- stays down while she
 * speaks. The port filtered every non-enemy out of the candidate list, and
 * stage 4's next zombies walked in over her lines.
 */
console.log("\na tracked civilian holds the camera, and the room with it:");
{
  const rng = new Rng(18);
  const events = scene(0, rng);
  const civ = ActorSpawn(0x4000, SpawnClass.Civilian, 0x20, "rescued");
  civ.visible = true;
  civ.hp = 1;
  g_class_handlers[SpawnClass.Civilian]!.init(civ, rng);
  // Op 0x2C's write for a word carrying `CivilianWait.CameraTrack`.
  civ.flags &= ~ActorFlag.NoCameraTrack;
  const prop = ActorSpawn(0x4100, SpawnClass.SetPieceProp, 0, "set piece");
  prop.visible = true;
  G.g_enemies_alive = 0;

  // Filed on this frame, dealt into a slot on the next: the fill runs before
  // any actor.
  GameUpdate(1 / 60, NULL_HOST, rng, events);
  GameUpdate(1 / 60, NULL_HOST, rng, events);
  check("a civilian without `obj+0x34` bit 0x10000 is a camera candidate",
        slotHolds(civ.at), slotsShown());
  check("...and a class whose routine never calls it is not",
        !slotHolds(prop.at));
  G.g_camera_free = 1;
  CameraDriverSelectMode();
  check("...so with no enemy alive the camera still tracks, and the room is "
        + "not handed back",
        G.g_camera_mode === CameraMode.TrackEnemies && G.g_camera_free === 0,
        `${G.g_camera_mode} ${G.g_camera_free}`);

  // Her script's next word drops `0x40000`: op 0x2C sets the bit.
  civ.flags |= ActorFlag.NoCameraTrack;
  GameUpdate(1 / 60, NULL_HOST, rng, events);
  GameUpdate(1 / 60, NULL_HOST, rng, events);
  CameraDriverSelectMode();
  check("...and once her wait word drops the track bit the slot goes and the "
        + "hand-back starts",
        !slotHolds(civ.at)
        && G.g_camera_mode === CameraMode.HandBackToPath,
        `${G.g_camera_mode}`);
}
