import type { CharactersJson } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { ActorSpawn, GameUpdate } from "../../src/game/director";
import { ActorKillAll } from "../../src/game/combat/resolve_hit";
import { CameraMode } from "../../src/game/camera/mode";
import { AppState, G } from "../../src/game/globals";
import { NULL_HOST, type GameHost } from "../../src/game/host";
import { FireShotRequest } from "../../src/game/combat/shot";
import { CharacterTypeOf, SetGameTables } from "../../src/game/tables";
import { ZombieState } from "../../src/game/class30/states";
import { ZombieStateWaitTurn } from "../../src/game/class30/wait_turn";
import { ActorFlag, ZombieFlag2, type Actor } from "../../src/game/actor";
import { QUEUE_CAP, RANK_SLOTS, RankEnemiesByDistance, RegisterForDistanceRank }
  from "../../src/game/combat/rank";
import {
  ReleaseAttackSlot, TryClaimAttackSlot,
} from "../../src/game/combat/permits";
import { SpawnClass } from "../../src/game/spawn_class";
import { dist2d, vec3, type Vec3 } from "../../src/game/vec";
import {
  EffectCode, HitResultCode, ResolveHit,
} from "../../src/game/combat/resolve_hit";
import {
  check, TYPE, APPROACH, PLAYER, CHARS, EYE, spawnZombie, scene, SeatCamera,
  run,
} from "./harness";

// -- 1. the crowd throttle --------------------------------------------------

console.log("class 0x30, three zombies, ten seconds:");
{
  const rng = new Rng(7);
  const events = scene(3, rng);
  let damaged = 0;
  events.on("player.damaged", () => damaged++);

  let maxPermits = 0;
  let sawBackoff = false;
  let minWalking = Infinity;
  let minAnywhere = Infinity;
  let closestState = "";
  for (let i = 0; i < 600; i++) {
    GameUpdate(1 / 60, NULL_HOST, rng, events);
    maxPermits = Math.max(maxPermits,
      G.g_attack_permits.filter((p) => p !== -1).length);
    for (const o of G.g_object_list) {
      if (o.state === ZombieState.BackOff) sawBackoff = true;
      const d = dist2d(o.pos, EYE);
      if (d < minAnywhere) { minAnywhere = d; closestState = ZombieState[o.state] ?? String(o.state); }
      // Only the lunge may come inside the ring, and only to the attack's own
      // distance; the retreat starts from wherever the swing left it. What
      // must never happen is an *approaching* actor crossing it, which is the
      // rule that keeps a zombie with no attack state out of the camera.
      if (o.state === ZombieState.Approach || o.state === ZombieState.AttackRun) {
        minWalking = Math.min(minWalking, d);
      }
    }
  }

  check("never more than g_max_attackers permits at once",
        maxPermits <= G.g_max_attackers, `saw ${maxPermits}`);
  check("someone reached the player and swung", damaged > 0,
        `${damaged} hits`);
  check("the retreat happened", sawBackoff);
  // Every caller of `ZombieSetMotionIfIdle` passes a random start frame, so
  // two zombies given the same order at the same moment do not take the same
  // steps at the same time. Starting them all at frame zero made a crowd move
  // in lockstep, which a crowd of shambling corpses never does.
  const phases = new Set(G.g_object_list.map((o) => o.playTicks));
  check("and they are not in lockstep", phases.size > 1,
        `${phases.size} distinct motion phases among ${G.g_object_list.length}`);
  check("nothing walked inside the inner ring",
        minWalking >= APPROACH.rings[0].inner - 0.01,
        `closest ${minWalking.toFixed(2)}`);
  // Not the attack's distance: the bite travels, and it has to -- the ground
  // it covers is what the retreat then walks back, which is the pause. What it
  // must not do is overshoot the point its own clip settles at, because that
  // transient is what reaches the camera. `strikeFloor` is that point, and it
  // comes out of the tables rather than a number picked to fit.
  const bite = TYPE.attacks["0"]["1"];
  const biteM = TYPE.motions[String(bite.strike)];
  const biteNet = Math.abs(biteM.root[(biteM.frames - 1) * 3 + 2]
                           - biteM.root[2]);
  check("and nothing came closer than the bite's own settle point",
        minAnywhere >= bite.distance - biteNet - 0.01,
        `closest ${minAnywhere.toFixed(2)} in ${closestState}, floor `
        + `${(bite.distance - biteNet).toFixed(2)}`);
  check("the permit came back", G.g_attack_permits.filter((p) => p !== -1).length
        <= 1);
  check("lives were spent, not overspent",
        G.g_player_lives[0] >= 0 && G.g_player_lives[0] < PLAYER.start_lives,
        `${G.g_player_lives[0]} left`);
}

// -- 2. a class with no handler gets no behaviour ---------------------------

console.log("an unread class:");
{
  const rng = new Rng(7);
  const events = scene(0, rng);
  // Class 0x2D has no module in `g_class_handlers`, so it must not move. This
  // used to be the cat, until the cat was read: class 0x53 has a module now,
  // and its clips are *meant* to carry it -- see "class 0x53, the cat". Then
  // it was class 0x42, until the worm was read.
  const idle = ActorSpawn(0x2000, SpawnClass.LargeCreature, 1, "unread");
  idle.visible = true;
  idle.attackState = 1;
  idle.hp = 10;
  idle.pos = vec3(0, 0, 60);
  const start = { ...idle.pos };
  run(600, rng, events);
  check("class 0x2D stayed where the script put it",
        idle.pos.x === start.x && idle.pos.z === start.z);
  check("class 0x2D took no permit", idle.attackPermit === -1);
}

// -- 3. `attack_state` does not gate the swing ------------------------------

console.log("a spawn whose descriptor names no attack state:");
{
  const rng = new Rng(7);
  const events = scene(0, rng);
  // 25 of stage 2's 90 class-0x30 spawns carry `attack_state = -1` and another
  // 7 carry 0. `ZombieStateHoldAtRange` -- which is where an ordinary zombie
  // decides to swing -- never reads that byte; only `ZombieStateApproach`
  // does, and nothing starts there. An earlier port gated the permit on it and
  // those spawns walked up and stood still, which is exactly the bug this
  // asserts against.
  const z = spawnZombie(0x3000, 1, "no-attack-state");
  z.visible = true;
  z.attackState = -1;
  z.hp = 10;
  z.pos = vec3(0, 0, 45);
  z.motion = 10;
  let damaged = 0;
  events.on("player.damaged", () => damaged++);
  run(900, rng, events);
  check("it attacks anyway, because the hub does not read attack_state",
        damaged > 0, `${damaged} hits`);
}

// -- 3a. the queue throttle is a round trip -------------------------------

console.log("the queue throttle:");
{
  const rng = new Rng(9);
  const events = scene(0, rng);
  // One zombie, a long way out. Nothing else competes, so it must simply
  // arrive: the whole point of `ZombieStateWaitTurn` is that dropping out of
  // the distance queue is temporary. Without it the actor parked in
  // `HoldAtRange` for ever and stood still -- which is what shipped.
  const z = spawnZombie(0x4000, 1, "lone");
  z.attackState = 1;
  z.hp = 1000;
  z.pos = vec3(0, 0, 120);
  // Forty-five seconds of bites would take every life: on the path camera the
  // last one goes, and a player out of play is not attacked. The engine's own
  // answer to "a player who cannot die" is `g_player_no_damage`
  // (`0x009C9FD8`), which `PlayerTakeDamage` tests before it takes a life;
  // this is a test of the zombie, so the player gets it.
  G.g_player_no_damage[0] = 1;
  z.motion = 10;
  check("it starts unranked, which reads as -1 and passes the rank test",
        z.rank === -1, `rank ${z.rank}`);

  // The renderer sets `visible` *after* the game phase, so an actor's first
  // frame always runs before `RankEnemiesByDistance` has ever seen it. That
  // ordering is the whole bug: with the rank read unsigned it looked like
  // "last in the queue" and the actor dropped out of the attack run on frame
  // one, into a state with no way back.
  z.visible = false;
  GameUpdate(1 / 60, NULL_HOST, rng, events);
  z.visible = true;

  let strandedFar = 0;
  let closest = Infinity;
  for (let i = 0; i < 900; i++) {
    GameUpdate(1 / 60, NULL_HOST, rng, events);
    const d = dist2d(z.pos, EYE);
    closest = Math.min(closest, d);
    // Sitting in the hub while nowhere near it is the deadlock's signature.
    if (z.state === ZombieState.HoldAtRange
        && d > APPROACH.rings[0].inner + 1) strandedFar++;
  }
  // The bite is a lunge and a recover -- `char_adv00`'s runs 0 -> -18.1 ->
  // -15.55 -- and the distance it ends up forward is exactly what
  // `ZombieStateBackOff` has to walk back before it may attack again. That
  // walk *is* the pause between bites. With nothing else competing for the
  // permit, the gap between one zombie's strikes is that walk plus the clip;
  // suppress the strike's travel and it ends its swing already on the ring,
  // the retreat finishes on its first frame, and it bites on the spot.
  const gaps: number[] = [];
  let last = -1;
  let inStrike = false;
  // `ActorSetMotionBlended`'s fourth argument is a fade length and every state
  // passes one; without it each transition is a cut.
  const strikeMotion = TYPE.attacks["0"]["1"].strike;
  let fadedOutOfBite = false;
  for (let i = 0; i < 1800; i++) {
    GameUpdate(1 / 60, NULL_HOST, rng, events);
    if (z.fadeFrom?.motion === strikeMotion && z.fade > 0) {
      fadedOutOfBite = true;
    }
    const now = z.state === ZombieState.Strike;
    if (now && !inStrike) {
      if (last >= 0) gaps.push(i - last);
      last = i;
    }
    inStrike = now;
  }
  check("it bites more than once", gaps.length > 0, `${gaps.length + 1} bites`);
  check("and the bite cross-fades into the retreat rather than cutting",
        fadedOutOfBite,
        fadedOutOfBite ? "" : "no fade with the strike as the outgoing clip");
  check("and waits between bites rather than repeating on the spot",
        gaps.length > 0 && Math.min(...gaps) > 60,
        gaps.length ? `shortest gap ${Math.min(...gaps)} frames` : "n/a");

  check("it closes the distance", closest < APPROACH.rings[0].inner,
        `closest ${closest.toFixed(1)} of 120`);
  check("and never idles in the hub while far from it", strandedFar < 60,
        `${strandedFar} frames`);

  // The round trip itself. `ZombieStateAttackRun` parks an actor here when its
  // rank falls outside the allowance, and this is the only thing that puts it
  // back; routing the drop-out anywhere else strands it for ever.
  // Called directly: the director re-ranks every frame, so the only way to
  // hold an actor outside the allowance is to run the state itself.
  z.state = ZombieState.WaitTurn;
  z.sub = 0;
  z.rank = 9;
  z.allowance = 2;
  const before = { ...z.pos };
  for (let i = 0; i < 30; i++) ZombieStateWaitTurn(z, rng);
  check("an actor out of the queue waits, and does not advance",
        z.state === ZombieState.WaitTurn
        && Math.abs(z.pos.z - before.z) < 0.01, ZombieState[z.state]);
  z.rank = 0;
  ZombieStateWaitTurn(z, rng);
  check("and rejoins the attack run when the queue moves on",
        z.state === ZombieState.AttackRun, ZombieState[z.state]);
}

// -- 3a'. what the ranking pass is allowed to touch --------------------------

console.log("RankEnemiesByDistance:");
{
  const rng = new Rng(11);
  const events = scene(0, rng);
  void events;
  // Sixteen registrants, two more than the list holds, laid out so that
  // *object order* and *distance order* disagree: the last to spawn is the
  // nearest. The exe caps at registration -- `RegisterForDistanceRank` refuses
  // the fifteenth -- and only then sorts, so the nearest actor here is one of
  // the two that never enters the queue at all.
  const zs: Actor[] = [];
  for (let i = 0; i < RANK_SLOTS + 2; i++) {
    const a = spawnZombie(0x7000 + i, 1, `rank ${i}`);
    a.visible = true;
    a.hp = 10;
    a.pos = vec3(0, 0, 200 - i * 10);
    zs.push(a);
  }
  // A class the ranking pass does not register, with both fields poisoned.
  const other = ActorSpawn(0x7100, SpawnClass.Thrower, 1, "not a zombie");
  other.visible = true;
  other.hp = 10;
  other.pos = vec3(0, 0, 5);
  other.rank = 41;
  other.queueRank = 42;

  // What `EnemyZombieUpdate` does, once per zombie in object order: file it.
  // The thrower has no such call and never enters the list.
  for (const a of zs) RegisterForDistanceRank(a);
  RankEnemiesByDistance();

  check("it ranks exactly what the list holds", zs.filter((a) => a.rank >= 0).length === RANK_SLOTS,
        `${zs.filter((a) => a.rank >= 0).length} ranked`);
  check("the cap is applied in object order, before the sort, so the nearest "
        + "actor past it is not ranked",
        zs[RANK_SLOTS].rank === -1 && zs[RANK_SLOTS + 1].rank === -1,
        `ranks ${zs[RANK_SLOTS].rank}, ${zs[RANK_SLOTS + 1].rank}`);
  // The one that matters: an unranked actor must keep the 0xE the spawn
  // wrote, which fails `queueRank < QUEUE_CAP`. Resetting it to 0 puts every
  // enemy past the fourteenth at the *front* of the queue and takes the crowd
  // throttle off entirely.
  check("and an unranked actor keeps a queue rank that fails the cap",
        zs[RANK_SLOTS].queueRank >= QUEUE_CAP,
        `queueRank ${zs[RANK_SLOTS].queueRank}, cap ${QUEUE_CAP}`);
  check("it writes nothing onto a class that does not register",
        other.rank === 41 && other.queueRank === 42,
        `rank ${other.rank}, queueRank ${other.queueRank}`);
}

// -- 3c. the route ----------------------------------------------------------
//
// `ThrowerStatePathFollow` is tested with the other class-0x31 states, under
// "class 0x31, ThrowerStatePathFollow": it needs `CHARS31`'s arc scripts,
// which are declared further down this file than this section runs.

// -- 3c2. the entrance that arrives on a clip -----------------------------

console.log("the cue entrance:");
{
  const rng = new Rng(11);
  const events = scene(0, rng);
  // The six shipped state-21 records, to the bit: pose frozen, shot-immune,
  // 0x2000 set, and an exit to the attack run. **All three bits are cleared
  // by this state and by nothing else in the game**, so a port that routed
  // state 21 to `AttackRun` -- as the default arm of `mapStartState` did --
  // left the actor frozen for ever. It wanted a permit, it was inside the
  // outer ring, and it never moved, because a zombie is carried by its clip's
  // own root translation and a frozen clip has no delta.
  const z = spawnZombie(0x5100, 1, "van", {
    initialState: ZombieState.MotionCue,
    attackState: ZombieState.AttackRun,
    intro: { motion: 923, delay: 10 },
    flags: ActorFlag.PoseFrozen | ActorFlag.ShotImmune | ActorFlag.NoHitReaction,
  }, rng);
  z.visible = true;
  z.hp = 1000;
  z.pos = vec3(0, 0, 60);
  const startZ = z.pos.z;

  check("it starts in the cue state, not the attack run",
        z.state === ZombieState.MotionCue, `state ${z.state}`);

  // The delay: the clip is set on the first frame but the pose is held, so
  // nothing plays and nothing moves.
  run(9, rng, events);
  check("it holds still for the record's delay",
        (z.flags & ActorFlag.PoseFrozen) !== 0 && z.pos.z === startZ
        && z.playTicks === 0,
        `flags 0x${z.flags.toString(16)} z ${z.pos.z} ticks ${z.playTicks}`);

  run(1, rng, events);
  check("and the delay running out is what releases it",
        (z.flags & ActorFlag.PoseFrozen) === 0);

  // Now the clip plays, and its root translation is the entrance.
  // 45 frames of the play clock is 22 authored frames of a 41-frame clip:
  // half the jump, and past the 0x26 the shot-immunity window ends on.
  run(45, rng, events);
  check("then the clip carries it out", z.pos.z < startZ - 4,
        `moved ${(startZ - z.pos.z).toFixed(1)}`);
  check("and it is shootable once it is through the glass",
        (z.flags & ActorFlag.ShotImmune) === 0,
        `flags 0x${z.flags.toString(16)}`);
  check("but it has not handed over part-way",
        z.state === ZombieState.MotionCue, `state ${z.state}`);

  // 79 is the play length, not the 41 authored frames: reading the exit cue
  // in authored frames would hand over at halfway, part-way through the jump.
  run(60, rng, events);
  check("it hands over at the end of the play clock, not the frame count",
        z.state !== ZombieState.MotionCue, `state ${z.state}`);
  check("...to the state the record names", z.state === ZombieState.AttackRun
        || z.state === ZombieState.HoldAtRange || z.state === ZombieState.Strike,
        `state ${z.state}`);
  check("and nothing of the record's freeze is left on it",
        (z.flags & (ActorFlag.PoseFrozen | ActorFlag.ShotImmune
                    | ActorFlag.NoHitReaction)) === 0,
        `flags 0x${z.flags.toString(16)}`);
}

// -- 3d. the on-screen gate -------------------------------------------------

console.log("ActorIsOnScreen:");
{
  const rng = new Rng(2);
  const events = scene(0, rng);
  const z = spawnZombie(0x5000, 1, "offscreen");
  z.visible = true;
  z.attackState = 1;
  z.hp = 1000;
  z.pos = vec3(0, 0, 40);
  z.motion = 10;
  z.lookAt = vec3(0, 4, 40);

  // `TryClaimAttackSlot` calls `ActorIsOnScreen` (`FUN_00409C10`) -- but **not
  // to refuse the claim**. An off-screen enemy gets the permit and raises
  // `g_attack_committed`, and that latch is what stops a second one. Reading
  // it as a refusal is what left an enemy the camera had walked into standing
  // there for ever: no permit, so no attack, so never the state that retreats.
  const offscreen = {
    ...NULL_HOST,
    viewSpaceOf: (_at: number, out: Vec3) => {
      // Forty units in front — `-z` — and far off the right of a 640 frame.
      out.x = 900; out.y = 0; out.z = -40;
      return true;
    },
  };
  for (let i = 0; i < 600 && z.attackPermit < 0; i++) {
    GameUpdate(1 / 60, offscreen, rng, events);
  }
  check("an enemy off the side of the frame still takes a permit",
        z.attackPermit >= 0, `permit ${z.attackPermit}`);
  check("...and latches g_attack_committed while it holds it",
        G.g_attack_committed === 1
        && (z.flags2 & ZombieFlag2.OffScreenPermit) !== 0,
        `latch ${G.g_attack_committed} flags2 ${z.flags2.toString(16)}`);

  // The latch is the throttle: while one enemy is attacking unseen, nobody
  // else may claim at all — not even one in plain sight.
  const other = spawnZombie(0x5004, 1, "second");
  other.visible = true;
  other.hp = 1000;
  other.pos = vec3(5, 0, 40);
  other.lookAt = vec3(5, 4, 40);
  const onscreen = {
    ...NULL_HOST,
    viewSpaceOf: (_at: number, out: Vec3) => {
      out.x = 0; out.y = 0; out.z = -40;     // dead centre, forty in front
      return true;
    },
  };
  check("a second enemy cannot claim while the latch is up",
        !TryClaimAttackSlot(other, new Rng(1), onscreen), `permit ${other.attackPermit}`);

  // Releasing the off-screen permit lifts it, and only then.
  ReleaseAttackSlot(z);
  check("releasing it lifts the latch", G.g_attack_committed === 0
        && (z.flags2 & ZombieFlag2.OffScreenPermit) === 0);
  check("and the next enemy may claim", TryClaimAttackSlot(other, new Rng(1), onscreen),
        `permit ${other.attackPermit}`);
  ReleaseAttackSlot(other);

  // **Dying holds the latch if the release is only half done.** The engine
  // frees it from the death state — `ZombieStateDeath6` (`FUN_00454D20`) sub 1
  // runs `ZombieReleasePermitAndUntrack` (`FUN_004565A0`), whose first line is
  // `ReleaseAttackSlot`. The port now runs that state, and `GameUpdate`'s
  // dead-actor sweep is the backstop behind it; clearing `g_attack_permits`
  // without lifting `g_attack_committed` left every remaining enemy refused on
  // `TryClaimAttackSlot`'s first line, and a crowd walked to the ring and
  // stood there wanting a permit nobody held.
  check("an off-screen attacker takes the latch again",
        TryClaimAttackSlot(z, new Rng(1), offscreen) && G.g_attack_committed === 1,
        `latch ${G.g_attack_committed}`);
  z.dead = true;
  GameUpdate(1 / 60, offscreen, rng, events);
  check("...and dying gives back the whole permit, latch included",
        G.g_attack_committed === 0 && z.attackPermit === -1
        && G.g_attack_permits.every((p) => p === -1),
        `latch ${G.g_attack_committed} permits ${JSON.stringify(G.g_attack_permits)}`);
  check("so the enemies still standing can attack",
        TryClaimAttackSlot(other, new Rng(1), onscreen), `permit ${other.attackPermit}`);
  ReleaseAttackSlot(other);
}

  // -- 4. damage ---------------------------------------------------------------

console.log("ResolveHit:");
{
  const rng = new Rng(5);
  scene(1, rng);
  const z = G.g_object_list[0];
  z.hp = 100;
  // Bone 4's effect table: four escalating stages, the fourth severing.
  const out1 = ResolveHit(z, 4, NULL_HOST, rng);
  check("a hit takes hit points off", z.hp === 100 - 3, `hp ${z.hp}`);
  check("and swaps the bone's model", z.boneSlot["4"] === 0x11,
        JSON.stringify(z.boneSlot));
  check("and stumbles", out1.react !== undefined);
  ResolveHit(z, 4, NULL_HOST, rng);
  ResolveHit(z, 4, NULL_HOST, rng);
  const out4 = ResolveHit(z, 4, NULL_HOST, rng);
  check("the fourth hit severs", out4.severed && out4.result === 3);
  check("and takes the forearm with it -- the whole subtree, not just the arm",
        z.removed.includes(5), `removed ${JSON.stringify(z.removed)}`);
  check("the destroyed-zone mask is set", (z.zones & 2) === 2, `${z.zones}`);
  const before = z.zones;
  ResolveHit(z, 4, NULL_HOST, rng);
  check("a fifth hit on a severed limb does not sever again",
        z.zones === before && z.removed.filter((b) => b === 5).length === 1);

  z.hp = 1;
  const kill = ResolveHit(z, 1, NULL_HOST, rng);
  check("zero hit points kills, once", kill.killed && z.dead);
  // **The clip is not `ResolveHit`'s.** Class 0x30 runs its own death states
  // now, so it is in `updatesWhenDead` and the shared directional clip is
  // withheld exactly as it is from class 0x31 and class 0x10:
  // `ChooseDeathMotion` (`FUN_004560B0`) picks it, from `ZombieStateDeath6`
  // sub 0. What `ResolveHit` leaves instead is the hit record `ZombieOnShot`
  // (`FUN_00453EB0`) reads on the actor's next update.
  check("no shared death clip: class 0x30 has its own state machine",
        z.death === null, `death ${JSON.stringify(z.death)}`);
  check("...and the hit its death chain reads is left on the actor",
        z.pendingHit !== null, `${JSON.stringify(z.pendingHit)}`);
  const again = ResolveHit(z, 1, NULL_HOST, rng);
  check("a hit on a corpse reports nothing and kills nothing", !again.killed
        && again.result === 0);

  // **The killer's byte.** The kill arm ends `obj+0x34 |= 0x4000000;
  // ScoreAddForPlayer(p, 0x50); *(char *)(obj + 0x131C) = p` -- the store is
  // `004097D1 888f1c130000 MOV byte ptr [EDI + 0x131c], CL`, CL the player
  // argument. `CivilianPruneDeadChildren` reads it back off a dead captor as
  // the rescue's payee. Player 1, so neither the field's `-1` nor the
  // argument's default of 0 can pass for it.
  const k1 = spawnZombie(0x1100, 1, "shot by player 1");
  k1.visible = true;
  k1.hp = 1;
  ResolveHit(k1, 1, NULL_HOST, rng, 1);
  check("the killing shot names its player at obj+0x131C",
        (k1.flags & ActorFlag.Dead) !== 0 && k1.killedBy === 1,
        `flags ${k1.flags.toString(16)} killedBy ${k1.killedBy}`);

  // **The kill is two tests: the dead bit and the hit points.**
  // `0x0040972A TEST [EDI + 0x34], EBX` (EBX = 0x4000000) and
  // `0x00409733 CMP word ptr [EDI + 0x11c], 0x0 / JG`. The port read its own
  // `Actor.dead` for the first, and added a third the engine does not have --
  // `result !== 5` -- which in the engine gates the head burst alone
  // (`0x0040976F`). Neither input is one a shipped class-0x30 spawn reaches
  // through `DispatchHit` that I could find: the release paths that raise the
  // bit alone hold `ShotImmune` too (the drag's `0x10100`, the release state's
  // `0x3500` from its first frame), and `ActorInitHitPoints` floors hit
  // points at 1. So these pin the transcription, by hand.
  {
    // The bit, not the field: `ZombieStateDragTarget`'s release and the body
    // creature's raise `0x4000000` and leave `dead` down. A hit on such an
    // actor at zero hit points kills nothing and its plain result is zeroed.
    const flagged = spawnZombie(0x1110, 1, "dead bit, dead field down");
    flagged.visible = true;
    flagged.hp = 0;
    flagged.flags |= ActorFlag.Dead;
    const onFlagged = ResolveHit(flagged, 5, NULL_HOST, rng, 1);
    check("the dead BIT refuses the kill, whatever `dead` says",
          !onFlagged.killed && onFlagged.result === HitResultCode.None
          && flagged.killedBy === -1,
          `killed ${onFlagged.killed} result ${onFlagged.result} `
          + `killedBy ${flagged.killedBy}`);

    // A result-5 hit on an actor at zero hit points with the bit down kills:
    // the bit, the killer's byte -- and no head, which is the one thing the
    // result gates, so the roll behind it is never drawn.
    const SENTINEL_HEAD = 0x77;
    SetGameTables({
      ...CHARS,
      types: {
        ...CHARS.types,
        [String(SENTINEL_HEAD)]: {
          ...TYPE, type: SENTINEL_HEAD,
          bones: TYPE.bones.map((b) => (b.bone === 2 || b.bone === 5
            ? { ...b, steps: [[2, EffectCode.Last, 3]] } : b)),
        },
      },
    } as unknown as CharactersJson);
    const five = spawnZombie(0x1120, SENTINEL_HEAD, "result 5 at 0 hp");
    five.visible = true;
    five.hp = 0;
    const roll = new Rng(21);
    const out5 = ResolveHit(five, 2, NULL_HOST, roll, 1);
    check("a result-5 hit at zero hit points kills",
          out5.result === HitResultCode.NoEffect && out5.killed
          && (five.flags & ActorFlag.Dead) !== 0 && five.killedBy === 1,
          `result ${out5.result} killed ${out5.killed} `
          + `flags ${five.flags.toString(16)} killedBy ${five.killedBy}`);
    check("...and takes no head: the roll is not drawn",
          !out5.severed && roll.next() === new Rng(21).next(),
          `severed ${out5.severed}`);

    // **And what a result-5 hit is worth**: `ResolveHit`'s tail tests the
    // result ahead of the body arm's 10 (`0x00409819`) and nowhere else, so
    // the head arm's 120 and combo, and the kill's 80, are paid on it. The
    // port zeroed every point of a result-5 hit.
    const target = spawnZombie(0x1130, SENTINEL_HEAD, "result 5, scored");
    target.visible = true;
    target.hp = 50;
    const at = (bone: number): GameHost => ({
      ...NULL_HOST,
      pickShot: () => ({ kind: "actor", at: target.at, bone,
                         point: vec3(0, 0, 40) }),
    });
    const fire = (bone: number): number => {
      const before = G.g_player_score[0];
      FireShotRequest({ player: 0, frame: 0, onScreen: 1, ray: {
        origin: vec3(0, 0, 0), dir: vec3(0, 0, 1) } }, at(bone), rng);
      return G.g_player_score[0] - before;
    };
    G.g_head_combo_bonus[0] = 0;
    const hits0 = G.g_player_hit_count[0];
    const head = fire(2);
    const headHits = G.g_player_hit_count[0] - hits0;
    const body = fire(5);
    const bodyHits = G.g_player_hit_count[0] - hits0 - headHits;
    const combo = G.g_head_combo_bonus[0];
    fire(2);                                  // 120, and the combo to 10
    target.hp = 0;
    const kill = fire(2);                     // 120 + 10, and the kill's 80
    check("a result-5 head hit pays 120; a body hit pays nothing and ends "
          + "the combo", head === 120 && body === 0 && combo === 0,
          `head ${head} body ${body} combo ${combo}`);
    check("...and a result-5 kill on the head pays the combo and the 80",
          kill === 120 + 10 + 80 && (target.flags & ActorFlag.Dead) !== 0,
          `kill ${kill}`);
    // The same tail counts the accuracy grade's hits: `INC [ESI+0x9a5c86]`
    // at `0x0040980A` after the head arm, and at `0x0040983B` inside the
    // body arm's result test -- so the head hits count and the result-5 body
    // hit does not.
    check("...and counts a hit on each head hit, none on the result-5 body "
          + "hit",
          headHits === 1 && bodyHits === 0
          && G.g_player_hit_count[0] - hits0 === 3,
          `head ${headHits} body ${bodyHits} total `
          + `${G.g_player_hit_count[0] - hits0}`);
    SetGameTables(CHARS);
  }

  // **The payout is `ResolveHit`'s own tail, and so is the hit count.**
  // `004097D7 CMP EBP, 0x2` -- `EBP` loaded from `g_shot_bone[p]` at
  // `0x0040943A` -- pays bone 2 `0x78` and the combo, steps the combo by 10
  // and counts the hit, on any result; `00409819` pays any other bone 10 and
  // counts it unless `g_hit_result` is 5, and zeroes the combo either way. The
  // kill's `0x50` is paid inside the kill block (`004097B9`). The port paid
  // all of it from `FireShotRequest`, in one call, never touched
  // `g_player_hit_count` (`0x009A5C86`, the accuracy grade's numerator), and
  // took the head from the bundle's `head_bone`.
  //
  // So `ResolveHit` is called bare here, for player 1 so that neither the
  // default argument nor slot 0 can pass for the payee, and the fixture's
  // table **calls bone 1 the head**: bone 1's record is the part `head` and
  // bone 2's the part `torso`. `head_bone` is gone from the bundle, so a
  // part name is the only thing left in a type that could say where the head
  // is; the exe reads no table for it, so bone 2 is the head and bone 1 is a
  // body hit whatever the table says. Every expected number is one of the
  // tail's immediates.
  {
    const MISLABELLED = 0x79;
    const PART = new Map([[1, "head"], [2, "torso"]]);
    SetGameTables({
      ...CHARS,
      types: {
        ...CHARS.types,
        [String(MISLABELLED)]: {
          ...TYPE, type: MISLABELLED,
          // The labels swapped; the forearm's one step is the sentinel, for a
          // result-5 body hit.
          bones: TYPE.bones.map((b) => ({
            ...b, part: PART.get(b.bone) ?? b.part,
            ...(b.bone === 5 ? { steps: [[2, EffectCode.Last, 3]] } : {}),
          })),
        },
      },
    } as unknown as CharactersJson);
    const t = spawnZombie(0x1140, MISLABELLED, "the tail");
    t.visible = true;
    t.hp = 100;
    G.g_head_combo_bonus[1] = 0;
    const count0 = G.g_player_hit_count[1];
    const other = [G.g_player_score[0], G.g_player_hit_count[0]];
    const hit = (bone: number): { paid: number; combo: number;
                                  counted: number; points: number } => {
      const s0 = G.g_player_score[1], c0 = G.g_player_hit_count[1];
      const out = ResolveHit(t, bone, NULL_HOST, rng, 1);
      return { paid: G.g_player_score[1] - s0, combo: G.g_head_combo_bonus[1],
               counted: G.g_player_hit_count[1] - c0, points: out.points };
    };
    const h1 = hit(2), h2 = hit(2), b1 = hit(1), h3 = hit(2), b5 = hit(5);
    const labelled = CharacterTypeOf(t)?.bones.find((b) => b.part === "head");
    check("the fixture's table calls bone 1 the head",
          labelled?.bone === 1, JSON.stringify(labelled));
    check("bone 2 is the head, whatever the table calls it: 120, then 130",
          h1.paid === 0x78 && h1.combo === 10 && h2.paid === 0x78 + 10
          && h2.combo === 20,
          `${JSON.stringify(h1)} ${JSON.stringify(h2)}`);
    check("...and the bone the table calls the head is a body hit: 10, "
          + "combo gone",
          b1.paid === 10 && b1.combo === 0,
          JSON.stringify(b1));
    check("a result-5 body hit pays nothing, counts nothing, and still ends "
          + "the combo",
          h3.combo === 10 && b5.paid === 0 && b5.counted === 0
          && b5.combo === 0,
          `${JSON.stringify(h3)} ${JSON.stringify(b5)}`);
    check("every other hit is counted into g_player_hit_count, for the "
          + "shooter alone",
          h1.counted === 1 && h2.counted === 1 && b1.counted === 1
          && h3.counted === 1 && G.g_player_hit_count[1] === count0 + 4
          && G.g_player_score[0] === other[0]
          && G.g_player_hit_count[0] === other[1],
          `count ${count0} -> ${G.g_player_hit_count[1]}, player 0 `
          + `${G.g_player_score[0]}/${G.g_player_hit_count[0]}`);
    check("...and what the call reports is what it paid",
          [h1, h2, b1, h3, b5].every((h) => h.points === h.paid),
          [h1, h2, b1, h3, b5].map((h) => `${h.points}/${h.paid}`).join(" "));

    // The kill: `0x50` in the kill block, then the body's 10 in the tail.
    t.hp = 1;
    const k = hit(1);
    check("a killing body hit pays 0x50 and 10 from inside ResolveHit",
          k.paid === 0x50 + 10 && k.counted === 1
          && (t.flags & ActorFlag.Dead) !== 0,
          JSON.stringify(k));
    // The corpse: the dead bit turns result 2 into 0 (`0x0040971F`) and
    // skips the kill block, and 0 is not 5 -- so the tail pays it all the
    // same. "Reports nothing" is not "worth nothing".
    const c = hit(1);
    check("a body hit on a corpse reports nothing, kills nothing, and is "
          + "still worth 10",
          c.paid === 10 && c.counted === 1 && G.g_hit_result === 0,
          `${JSON.stringify(c)} result ${G.g_hit_result}`);
    SetGameTables(CHARS);
  }
}

// -- 4a. the three bits `ResolveHit` reads on `obj+0x34` ---------------------

/**
 * `ResolveHit` (`FUN_00409430`) raises `obj+0x34 |= 0xE00` whenever
 * `g_app_state` is not `AppState.InPlay`, and the three bits it raises have
 * three readers inside the same routine and `ActorSwapDamagedPart`.
 *
 * The port ignored all three, and sat at `g_app_state = 0` with a comment
 * calling the clause inert. Transcribing the OR against that would have set
 * `0xE00` on every actor on its first hit and taken the gore out of the whole
 * game -- which is why the value matters as much as the bits do.
 */
console.log("\nResolveHit's three suppression bits:");
{
  const rng = new Rng(5);

  // `NoDismember` is the one that fires in ordinary play: 68 shipped
  // class-0x30 spawns carry 0x400 in `init_flags`, and `ActorInitFlags`
  // (`FUN_00408970`) makes that `obj+0x34` before the class's `Init` runs.
  scene(1, rng);
  const nd = G.g_object_list[0];
  nd.hp = 100;
  nd.flags |= ActorFlag.NoDismember;
  ResolveHit(nd, 4, NULL_HOST, rng);
  ResolveHit(nd, 4, NULL_HOST, rng);
  ResolveHit(nd, 4, NULL_HOST, rng);
  const sev = ResolveHit(nd, 4, NULL_HOST, rng);
  check("`NoDismember`: the sever step does not sever",
        !sev.severed && sev.result !== 3, `result ${sev.result}`);
  check("...and the forearm stays on", !nd.removed.includes(5),
        `removed ${JSON.stringify(nd.removed)}`);
  check("...but every hit still charged its damage", nd.hp < 100,
        `hp ${nd.hp}`);
  nd.hp = 1;
  const ndKill = ResolveHit(nd, 1, NULL_HOST, rng);
  check("...and the torso death wound is skipped too", !ndKill.severed,
        `result ${ndKill.result}`);
  check("...while the actor still dies, because the kill block is outside "
        + "the guard", ndKill.killed && nd.dead, `killed ${ndKill.killed}`);

  // `NoPartSwap` stops `ActorSwapDamagedPart` before it touches anything.
  scene(1, rng);
  const np = G.g_object_list[0];
  np.hp = 100;
  np.flags |= ActorFlag.NoPartSwap;
  const npOut = ResolveHit(np, 4, NULL_HOST, rng);
  check("`NoPartSwap`: the bone keeps the model it had",
        np.boneSlot["4"] === undefined, JSON.stringify(np.boneSlot));
  check("...and nothing reports gore", !npOut.gore);
  check("...and the damage still lands", np.hp === 100 - 3, `hp ${np.hp}`);

  // `NoHitResult` is written over the finished result, so the swap it just
  // made stands and only the reported code is thrown away.
  scene(1, rng);
  const nr = G.g_object_list[0];
  nr.hp = 100;
  nr.flags |= ActorFlag.NoHitResult;
  const nrOut = ResolveHit(nr, 4, NULL_HOST, rng);
  check("`NoHitResult`: the shot reports nothing", nrOut.result === 0
        && G.g_hit_result === 0, `result ${nrOut.result}`);
  check("...and the swap it made before that still stands",
        nr.boneSlot["4"] === 0x11, JSON.stringify(nr.boneSlot));

  // And the OR itself, which is what puts all three there.
  scene(1, rng);
  const att = G.g_object_list[0];
  att.hp = 100;
  const clean = att.flags;
  ResolveHit(att, 4, NULL_HOST, rng);
  check("in play the OR does not fire",
        (att.flags & 0xe00) === (clean & 0xe00), `flags ${att.flags.toString(16)}`);
  G.g_app_state = AppState.Attract;
  ResolveHit(att, 4, NULL_HOST, rng);
  check("out of play it raises all three at once",
        (att.flags & 0xe00) === 0xe00, `flags ${att.flags.toString(16)}`);
  check("...and that hit reported nothing", G.g_hit_result === 0,
        `${G.g_hit_result}`);
  G.g_app_state = AppState.InPlay;

  // The second read: the head only comes off in play.
  check("`g_app_state` is back in play for everything after this",
        G.g_app_state === 6, `${G.g_app_state}`);
}

// -- 4b. the camera never cuts on its own -----------------------------------

/**
 * The aim eases onto whatever `SelectCameraLookAtTarget` picks, and picking
 * "the path's own target" is not a special case.
 *
 * This is the assertion the stage-2 block-17 report needed. The camera sits at
 * the end of a shot with two enemies alive, aimed off the rail at them; you
 * kill the last one; the port used to hand the raw path target straight to the
 * renderer on that frame, which turned a sixteen-degree correction into one
 * frame of camera. `CameraTrackEnemiesTick` has no such branch — with nothing
 * registered it eases at the flat rate 12, about a thirteenth of the remaining
 * angle a frame.
 */
console.log("the camera eases back onto the rail, it does not cut:");
{
  const rng = new Rng(5);
  const events = scene(1, rng);
  const z = G.g_object_list[0];
  // Off to one side and low, the way the pair in stage 2 block 17 sit.
  z.pos = vec3(-20, 0, 60);
  z.lookAt = vec3(-20, 12, 60);

  // The rail: eye at the origin looking straight down +Z, which is the shot's
  // own aim once the `cam_play` action has retired.
  const rail = vec3(0, 0, 100);
  SeatCamera(EYE, rail);

  const aimAngle = (): number => {
    const t = G.g_camera_block_target;
    const a = Math.hypot(t.x - EYE.x, t.y - EYE.y, t.z - EYE.z) || 1;
    const b = Math.hypot(rail.x - EYE.x, rail.y - EYE.y, rail.z - EYE.z) || 1;
    const dot = ((t.x - EYE.x) * (rail.x - EYE.x)
               + (t.y - EYE.y) * (rail.y - EYE.y)
               + (t.z - EYE.z) * (rail.z - EYE.z)) / (a * b);
    return Math.acos(Math.min(1, Math.max(-1, dot))) * 180 / Math.PI;
  };

  // Let the enemy pull the aim off the rail. The block is not re-seated,
  // because the shot's action has retired -- that is the whole point.
  let pulled = 0;
  for (let i = 0; i < 240; i++) {
    GameUpdate(1 / 60, NULL_HOST, rng, events);
    pulled = aimAngle();
  }
  check("an enemy pulls the aim off the rail", pulled > 3,
        `${pulled.toFixed(1)} deg off`);
  check("and the camera is marked as tracking", G.g_camera_is_tracking === 1);

  // Now kill it, the way a shot does: its death state raises `NoCameraTrack`
  // and it files no candidate from then on. Two frames later the fill has
  // nothing to deal.
  ActorKillAll(rng);
  let worst = 0;
  let settled = -1;
  let settledOn = -1;
  for (let i = 0; i < 300; i++) {
    const before = aimAngle();
    GameUpdate(1 / 60, NULL_HOST, rng, events);
    const after = aimAngle();
    worst = Math.max(worst, Math.abs(before - after));
    if (settled < 0 && after < 0.5) settled = i;
    if (settledOn < 0 && G.g_camera_settled === 1) settledOn = i;
  }
  // With nothing alive and nothing in a slot the selector hands the room back:
  // `CameraTurnOntoPathTarget`, which eases onto the path's own target at the
  // untracked rate. It never runs `SelectCameraLookAtTarget`, so the tracking
  // flag `CameraActorTick` seeds each frame is not what says it is idle.
  check("with nothing registered and nobody alive the camera turns back",
        G.g_camera_mode === CameraMode.HandBackToPath, `${G.g_camera_mode}`);
  check("the aim comes back to the rail", settled >= 0,
        `still ${aimAngle().toFixed(2)} deg off after 300 frames`);
  // 1/13 of a gap that starts near 16 degrees is about 1.3 degrees; a snap
  // would show the whole gap in one step.
  check("and never moves more than two degrees in a frame", worst < 2,
        `worst frame moved ${worst.toFixed(2)} deg`);
  check("it takes tens of frames, not one", settled > 20,
        `settled after ${settled} frames`);
  // A this-frame answer: raised on the frame the turn converges, in the same
  // breath as `g_camera_free`, and cleared by the next camera actor.
  check("`g_camera_settled` is raised on the frame it catches up",
        settledOn >= 0 && G.g_camera_free === 1 && G.g_camera_settled === 0,
        `settled on ${settledOn}, now ${G.g_camera_settled}`);
}

// -- 5. the snapshot round-trips, exactly -----------------------------------

console.log("save state:");
{
  // **The whole data segment, not a sample of it.**
  //
  // This used to fingerprint nine actor fields and six globals, which is a
  // reasonable guess at what matters and therefore cannot catch what does not
  // occur to you. `G` *is* the save state -- `GameSystem.save()` hands the
  // world exactly this object -- so comparing anything less than all of it
  // asserts something weaker than the contract. The staleness of `lookAt`, for
  // one, was invisible to the old digest.
  const digest = (): string => JSON.stringify(G);

  const rng = new Rng(11);
  const events = scene(3, rng);
  run(300, rng, events);

  // The snapshot is exactly what `GameSystem.save()` hands the world.
  const snap = structuredClone({ globals: G, rng: rng.state });
  const json = JSON.stringify(snap);
  check("the whole game state is JSON", json.length > 0
        && !json.includes("undefined"));

  run(300, rng, events);
  const after = digest();

  // Put it back and run the same 300 frames again.
  Object.assign(G, structuredClone(snap.globals));
  rng.state = snap.rng;
  run(300, rng, events);
  check("a restored snapshot replays identically", digest() === after);

  // And again from the JSON, which is the form the button hands out.
  const reread = JSON.parse(json) as typeof snap;
  Object.assign(G, reread.globals);
  rng.state = reread.rng;
  run(300, rng, events);
  check("and identically after a round trip through JSON",
        digest() === after);

  // **Saving and loading every fifty frames must change nothing at all.**
  //
  // One save and one load can round-trip cleanly and still lose something that
  // only matters a few frames later -- a field restored but never read again,
  // a derived value the load happens to leave correct because the very next
  // tick recomputes it. Doing it repeatedly, across a fight, is what turns a
  // "restores" assertion into a "the snapshot fully determines the future"
  // one, which is the claim the architecture doc actually makes.
  {
    const rngA = new Rng(11);
    const eventsA = scene(3, rngA);
    run(600, rngA, eventsA);
    const straight = digest();

    const rngB = new Rng(11);
    const eventsB = scene(3, rngB);
    for (let i = 0; i < 12; i++) {
      run(50, rngB, eventsB);
      const s2 = JSON.parse(
        JSON.stringify({ globals: G, rng: rngB.state })) as
          { globals: Record<string, unknown>; rng: number };
      Object.assign(G, s2.globals);
      rngB.state = s2.rng;
    }
    check("600 frames with a save and load every 50 is 600 plain frames",
          digest() === straight,
          firstFieldThatDiffers(straight, digest()));
  }
}

/** Which key of `G` two whole-segment digests part company on. */
function firstFieldThatDiffers(a: string, b: string): string {
  const ga = JSON.parse(a) as Record<string, unknown>;
  const gb = JSON.parse(b) as Record<string, unknown>;
  for (const k of Object.keys(ga)) {
    if (JSON.stringify(ga[k]) !== JSON.stringify(gb[k])) return `at G.${k}`;
  }
  return "identical by key, different as a string";
}

// -- 6. determinism, which is what guards the rules above -------------------

console.log("determinism:");
{
  const one = (): string => {
    const rng = new Rng(3);
    const events = scene(4, rng);
    run(400, rng, events);
    return JSON.stringify(G.g_object_list.map((o) => [o.state, o.pos.x, o.pos.z]));
  };
  check("two runs from the same seed agree", one() === one());
  // `WaitTurn` belongs to the loop too: it is where an actor outside the
  // allowance marks time, and it has a way back into the attack run.
  const IN_LOOP = new Set([ZombieState.AttackRun, ZombieState.HoldAtRange,
                           ZombieState.Strike, ZombieState.BackOff,
                           ZombieState.WaitTurn]);
  check("every actor is in the loop, none stuck outside it",
        G.g_object_list.every((o) => IN_LOOP.has(o.state) || o.dead),
        G.g_object_list.map((o) => ZombieState[o.state] ?? o.state).join(","));
}
