/**
 * The port, exercised with no renderer at all.
 *
 * This file imports `game/` and nothing else — no three.js, no DOM — which is
 * the point of the boundary. Every gameplay bug in the session that produced
 * this architecture (facing inverted, permits deadlocked, the cat running the
 * zombie's machine, throwers gated on a rank test the engine does not have)
 * would have been caught by one of the assertions below, in a second, without
 * looking at the screen.
 *
 * Run with `npm run test:port`.
 */
import type {
  ApproachJson, CharactersJson, CharacterType, PlayerDamageJson, TrackingJson,
} from "../src/bundle";
import { Rng } from "../src/core/rng";
import { HingePose } from "../src/render/hinge";
import { Events } from "../src/core/events";
import { ActorSpawn, GameUpdate, RetireUnlistedActor }
  from "../src/game/director";
import { ActorKillAll } from "../src/game/combat/resolve_hit";
import { CamAdvancePathFrame, CamPathCueReached, CamSetPathTarget }
  from "../src/game/camera/path";
import { ActorAdvanceMotion } from "../src/game/motion";
import { UpdateCameraFreeFlag } from "../src/game/camera/track";
import { ActorByAt, G, ResetGameGlobals, ResetSceneOnEnter }
  from "../src/game/globals";
import {
  RAIN_PARTICLE_COUNT, RainAdvanceParticles, RainResetParticles,
  type RainRules,
} from "../src/game/effects/rain";
import { NULL_HOST, type ShotPick } from "../src/game/host";
import { QueueShotRequest } from "../src/game/combat/shot";
import { MotionPlayFrame, MotionPlayLength, SetGameTables, T }
  from "../src/game/tables";
import {
  ColiTestSphereAgainstFullSet, ColiTraceSegmentAllSets,
  QueryGroundHeightAt, QueryGroundSurfaceAt,
} from "../src/game/coli";
import { MotionRow, StrikeSub, ZombieState }
  from "../src/game/class30/states";
import { ZombieAttackRefusal, ZombieStateHoldAtRange }
  from "../src/game/class30/hold";
import { ZombieStateBackOff } from "../src/game/class30/backoff";
import { ZombieStateStrike } from "../src/game/class30/strike";
import { ZombieStateWaitTurn } from "../src/game/class30/wait_turn";
import { ZombieStateWalkDistance } from "../src/game/class30/walk_distance";
import { ZombieArmedHands, ZombiePickThrowingHand,
         ZombieShouldStandAndThrow, ZombieStateStandAndThrow }
  from "../src/game/class30/stand_throw";
import { ActorFlag, ThrowerFlag, ZombieFlag2, type Actor }
  from "../src/game/actor";
import { IsPlayerAttackable } from "../src/game/combat/player";
import { QUEUE_CAP, RANK_SLOTS, RankEnemiesByDistance }
  from "../src/game/combat/rank";
import {
  ReleaseAttackSlot, ThrowerReleaseAttackPermit, ThrowerTryClaimAttackSlot,
  TryClaimAttackSlot,
} from "../src/game/combat/permits";
import { EnemyZombieUpdate, ZombieEntryState } from "../src/game/class30";
import {
  ReleaseEnemyAliveCount, ReleaseEnemyPresentCount, UNCOUNTED_CHAR_TYPE,
  UNCOUNTED_INITIAL_STATE,
} from "../src/game/combat/counts";
import { ActorDeadSweep, ActorDespawn } from "../src/game/despawn";
import { DeadSweep, g_class_handlers, registerClass }
  from "../src/game/registry";
import { PORTED_CLASSES } from "../src/game/classes";
import { ActorSnapToGroundHeight, ZombiePushOutOfWorldAndActors }
  from "../src/game/class30/ground";
import { ActorArcBeginFalling } from "../src/game/class30/emerge";
import { ZombieScriptEnded, ZombieStateHoldForCameraCue }
  from "../src/game/class30/target";
import type { TargetScriptJson } from "../src/bundle/characters";
import { SpawnClass } from "../src/game/spawn_class";
import { CivilianAttachSet, CivilianCountMotionLoops, CivilianOp,
         CivilianTarget,
         CivilianUpdate, CivilianWait, PoseHookGrowAndPushOutOfWorld }
  from "../src/game/class10";
import type { CivilianCmdJson, CivilianItemJson } from "../src/bundle/scene";
import { GameMode } from "../src/game/game_mode";
import { ThrowerBeginKnockbackArc } from "../src/game/class31/death";
import { ThrowerState } from "../src/game/class31/states";
import { ThrowerStrikeConnect } from "../src/game/class31/strike";
import { ThrowerStanceOf } from "../src/game/class31/tables";
import { dist2d, vec3, type Vec3 } from "../src/game/vec";
import { EffectCode, ResolveHit } from "../src/game/combat/resolve_hit";
import type { BreakablesJson } from "../src/bundle";
import {
  BreakableState, BreakablePropTakeShot, BreakablePropUpdate,
  BreakableSlot, GrantExtraLife, ItemSet, MEMBERS_PER_GROUP,
  PlaceBreakableGroup, PropContainerPlacerUpdate, PlaceKindedProp,
  KindedPropUpdate, PropFamily, KIND_SLOT, SLOT_NONE, PlaceGenericProp,
  LiftUpdate, LiftFlag, LIFT_NEAR_CLOSED, LIFT_NEAR_OPEN,
  LIFT_FAR_CLOSED, LIFT_PANEL_CLOSED, LIFT_PANEL_OPEN, LIFT_PANEL_DELAY,
  LIFT_RIDE_DROP, LIFT_HINGE_STEP, SFX_LIFT_GATE, SFX_LIFT_PANEL,
  PropExpireByStepLifetime, GENERIC_DRAW_SLOT,
  GENERIC_ORIGINAL_MODE_ONLY,
} from "../src/game/class41";
import { BreakablePropPoolUpdate } from "../src/game/class41/pool";
import {
  FallingContainerUpdate, PlaceFallingContainer, FALLING_SLOT_LOOSE,
  FALLING_SLOT_WHOLE,
} from "../src/game/class44";
import { SpawnPropContainers } from "../src/game/director";
import {
  SetPieceState, SetPiecePropUpdate,
  DROP_GRAVITY, SLIDE_FRAMES, SLIDE_VX, SLIDE_VZ,
  type SetPieceParams,
} from "../src/game/class24";
import {
  HumanoidCond, HumanoidOp, HumanoidTurn, ScriptedHumanoidUpdate,
  g_class25_path_offsets,
  type HumanoidProgram,
} from "../src/game/class25";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

// -- a stage's worth of tables, small enough to reason about ----------------

/**
 * A clip. `perFrame` is root translation along the clip's own -Z, which is
 * what actually walks a zombie: the run carries 1.289 units a frame on the
 * real data, the walk carries nothing.
 */
const motion = (frames: number, perFrame = 0, play?: number) => ({
  bank: "t", frames, fps: 30,
  root: Array.from({ length: frames * 3 },
                   (_, i) => (i % 3 === 2 ? -perFrame * Math.floor(i / 3) : 0)),
  rot: [],
  // `g_motion_play_length`, when the fixture wants to pin it. The real table
  // is `2n - 2` for some motions and `2n - 3` for others, so a clip that
  // carries the odd one is the only thing that can tell "read the bundle"
  // apart from "derive it from the frame count".
  ...(play === undefined ? {} : { play }),
});

const TYPE: CharacterType = {
  type: 1, name: "test zombie", file: "t.bin", bone_count: 16,
  actor_radius: 10,
  // Two bones, upper arm and forearm, with the forearm parented to it: enough
  // for the sever cascade, which is the part that used to leave a limb
  // animating below a destroyed one.
  bones: [
    { bone: 4, part: "r_upperarm", slot: 4, offset: [0, 0, 0], parent: null,
      damage_rank: [], hit_radius: 2,
      steps: [[0x11, EffectCode.Escalate, 3], [0x12, EffectCode.Escalate + 1, 3],
              [0x13, EffectCode.Escalate + 2, 3], [0x14, EffectCode.Sever, 3]] },
    { bone: 5, part: "r_forearm", slot: 5, offset: [0, 0, 0], parent: 0,
      damage_rank: [], hit_radius: 2, steps: [] },
    { bone: 1, part: "torso", slot: 1, offset: [0, 0, 0], parent: null,
      damage_rank: [], hit_radius: 3,
      steps: [[0x21, EffectCode.Last, 3]] },
  ],
  head_bone: 2, reactions: { "0": [960, 961, 974, 979, 981, 982, 977] },
  attacks: {
    "0": {
      // `distance` is deliberately just *outside* the inner ring, as the real
      // tables have it -- `char_adv00`'s two attacks name 26.0 and 25.0
      // against a ring of 25. That is what makes an actor arriving from the
      // hold already inside it, so the swing starts on the ring and the
      // retreat ends exactly back at the spot it started from. A fixture with
      // the distance *inside* the ring instead makes the retreat overshoot its
      // own anchor and turn round, which is a property of the fixture and not
      // of the port.
      "1": {
        strike: 100, lunge: 101, distance: 26, hit_frame: 10,
        player_motion: 7, cancel_mask: 8,
      },
    },
    // The throw entries: index 0 is bone 5's and index 1 is bone 8's, and the
    // range is a throw's rather than a reach's.
    "7": {
      "0": { strike: 102, lunge: 101, distance: 99, hit_frame: 8,
             player_motion: 4, cancel_mask: 2 },
      "1": { strike: 103, lunge: 101, distance: 99, hit_frame: 8,
             player_motion: 4, cancel_mask: 4 },
    },
    "8": {
      "0": { strike: 102, lunge: 101, distance: 99, hit_frame: 8,
             player_motion: 4, cancel_mask: 2 },
      "1": { strike: 103, lunge: 101, distance: 99, hit_frame: 8,
             player_motion: 4, cancel_mask: 4 },
    },
  },
  attack_picks: { "0": new Array(80).fill(1) },
  throw: null,
  // The stationary thrower's kit. Body conditions 7 and 8 index the same two
  // attack entries, one per hand, exactly as `tutorial.bin`'s do; the hand
  // slots are what `ZombieArmedHands` compares the live draw slots against.
  zombie_throw: {
    hands: [
      { bone: 5, held: 7886, bare: 7883, weapon_bone: 6, projectile: 585 },
      { bone: 8, held: 7882, bare: 7879, weapon_bone: 9, projectile: 585 },
    ],
    straight: true, speed: 1, speed_standing: 1.5, aim_ahead: 4,
    aim_side: 0.6, aim_drop: 1.5, arc_gravity: 0.009, hit_kind: 4,
    stick_frames: 30, blink_frames: 60,
  },
  motion_row: { "0": [10, 10, 12, 12, 14], "7": [10, 10, 12, 12, 14],
                "8": [10, 10, 12, 12, 14] },
  backoff_index: 4,
  gore: {}, torso_stages: 3,
  motions: {
    // 10 the in-place walk and idle, 12 the run that closes, 14 the retreat.
    "10": motion(20, 0, 37), "12": motion(16, 1.289), "14": motion(36, -0.429),
    // 101 the lunge, which carries the actor the last few units into range.
    // The bite, scaled like the real one: `char_adv00`'s runs to -15.55 net
    // against a 25-unit inner ring, so the recover is most of the ring and the
    // retreat that walks it back is the pause between bites.
    "100": motion(20, 0.8), "101": motion(20, 0.6),
    // The two throw clips, which carry no root motion at all --
    // `tutorial.bin`'s net exactly zero.
    "102": motion(24), "103": motion(20),
    // 185 (0xB9) is the pose `ZombieStateEmerge` holds while it waits.
    "185": motion(4),
    // 923 (0x39B), the van jump-out `ZombieStateMotionCue21` plays: 41 frames
    // against a play length of 79, carrying 13.6 units of root translation.
    // The odd play length is the point of pinning it -- the cue this state
    // exits on is expressed in the play clock, not in authored frames.
    "923": motion(41, 0.332, 79),
    "900": motion(30), "901": motion(30), "902": motion(30), "903": motion(30),
    "960": motion(39), "961": motion(39), "974": motion(29), "977": motion(29),
    "979": motion(29), "981": motion(29), "982": motion(29),
    // The twelve entrance states' clips. 184 (0xB8) is the surfacing clip
    // whose two splash cursors are 0x15 and 0x1B, so its play length has to
    // reach past both; 186/187 (0xBA/0xBB) the scripted grab's pair; 700 a
    // plain held clip; 1009/1010 the scripted attacker's strike and idle.
    "184": motion(20, 0, 45), "186": motion(24), "187": motion(24),
    "700": motion(18), "1009": motion(20, 0, 41), "1010": motion(16),
    // 984 (0x3D8) is the surfacing clip for every character type outside
    // 0xF..0x11, which is the one this file's type 1 takes.
    "984": motion(24, 0, 47),
    // State 26's clips: 955 (0x3BB) the jump, and 1015 (0x3F7) the limp of a
    // corpse shot out of the air -- which is not a landing animation.
    "955": motion(30), "1015": motion(20),
  },
};

const APPROACH: ApproachJson = {
  rings: [{ inner: 25, mid: 38, outer: 51 }],
};

// Four curves, because `TURN_CURVE_DEFAULT` selects the second one — the
// fixture used to carry one and say `curve: 0`, which it could do only while
// the number it was indexing with travelled beside it.
const TRACKING: TrackingJson = {
  curves: [0, 1, 2, 3].map(() => new Array(64).fill(16)),
};

const PLAYER: PlayerDamageJson = { start_lives: 2 };

/** One stage's `characters` block, with only what the port reads filled in. */
const CHARS = {
  types: { "1": TYPE },
  approach: APPROACH,
  tracking: TRACKING,
  player: PLAYER,
  placements: [],
  // Bone -> damage zone: 4 and 5 are the right arm, bit 1.
  bone_zones: [0xff, 0xff, 0, 0xff, 1, 1],
  // Bone -> reaction group, which picks the stumble within the row.
  reaction_groups: [0, 1, 0, 1, 2, 2],
  deaths: { front: [900], back: [901] },
  difficulty: {
    hp_delta: [0, 0, 0, 0, 0], hp_min: 1, hp_max: 300,
    initial_rank: [0, 0, 2, 0, 0],
  },
  combat: undefined,
  note: "",
} as unknown as CharactersJson;

/**
 * The scene state's major while a stage is being played — the `cam/` path
 * camera row. `IsPlayerAttackable` (`FUN_00409DC0`) demands it before anything
 * may claim an attack permit, and in the player it arrives every frame from
 * the walker through `syncPortGlobals`. A fixture has no walker, so it has to
 * say so itself; leaving it at 0 is a scripted cutscene, in which nothing
 * attacks.
 */
const SCENE_MAJOR_PLAYING = 2;

const EYE = vec3(0, 0, 0);


function scene(n: number, rng: Rng): Events {
  ResetGameGlobals();
  SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_player_lives = [PLAYER.start_lives, PLAYER.start_lives];
  for (let i = 0; i < n; i++) {
    const a = ActorSpawn(0x1000 + i, SpawnClass.Zombie, 1, `zombie ${i}`);
    a.visible = true;
    a.attackState = 1;
    a.hp = 10;
    a.pos = vec3(-20 + i * 20, 0, 45 + i * 10);
    a.motion = 10;
  }
  void rng;
  return new Events();
}

function run(frames: number, rng: Rng, events: Events): void {
  for (let i = 0; i < frames; i++) GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
}

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
    GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
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
  // The cat. It has no module in `g_class_handlers`, so it must not move.
  const cat = ActorSpawn(0x2000, SpawnClass.SkinnedNpc, 1, "cat");
  cat.visible = true;
  cat.attackState = 1;
  cat.hp = 10;
  cat.pos = vec3(0, 0, 60);
  const start = { ...cat.pos };
  run(600, rng, events);
  check("class 0x53 stayed where the script put it",
        cat.pos.x === start.x && cat.pos.z === start.z);
  check("class 0x53 took no permit", cat.attackPermit === -1);
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
  const z = ActorSpawn(0x3000, SpawnClass.Zombie, 1, "no-attack-state");
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
  const z = ActorSpawn(0x4000, SpawnClass.Zombie, 1, "lone");
  z.attackState = 1;
  z.hp = 1000;
  z.pos = vec3(0, 0, 120);
  z.motion = 10;
  check("it starts unranked, which reads as -1 and passes the rank test",
        z.rank === -1, `rank ${z.rank}`);

  // The renderer sets `visible` *after* the game phase, so an actor's first
  // frame always runs before `RankEnemiesByDistance` has ever seen it. That
  // ordering is the whole bug: with the rank read unsigned it looked like
  // "last in the queue" and the actor dropped out of the attack run on frame
  // one, into a state with no way back.
  z.visible = false;
  GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
  z.visible = true;

  let strandedFar = 0;
  let closest = Infinity;
  for (let i = 0; i < 900; i++) {
    GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
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
    GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
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
  for (let i = 0; i < 30; i++) ZombieStateWaitTurn(z, EYE, rng);
  check("an actor out of the queue waits, and does not advance",
        z.state === ZombieState.WaitTurn
        && Math.abs(z.pos.z - before.z) < 0.01, ZombieState[z.state]);
  z.rank = 0;
  ZombieStateWaitTurn(z, EYE, rng);
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
    const a = ActorSpawn(0x7000 + i, SpawnClass.Zombie, 1, `rank ${i}`);
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

  RankEnemiesByDistance(EYE);

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

// -- 3b. the drop -----------------------------------------------------------

console.log("ThrowerStateLeapToPoint:");
{
  const rng = new Rng(4);
  const events = scene(0, rng);
  // Stage 2 block 5 step 6's first zsass, verbatim: spawned at y = 87 with a
  // descriptor naming the street at y = 37, thirty frames away.
  const z = ActorSpawn(0x20e8, SpawnClass.Thrower, 1, "zsass", {
    initialState: ThrowerState.LeapToPoint,
    leap: { dest: [-732.8, 37.0, -1206.5], frames: 30 },
  });
  z.visible = true;
  z.hp = 10;
  z.pos = vec3(-732.8, 87.0, -1206.5);
  z.motion = 10;

  check("it starts in the descriptor's own state, not the throw",
        z.state === ThrowerState.LeapToPoint, `state ${z.state}`);

  const ys: number[] = [];
  for (let i = 0; i < 40; i++) {
    GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
    ys.push(z.pos.y);
  }
  check("it falls", ys[5] < 87 && ys[5] > 37, `y ${ys[5].toFixed(1)}`);
  check("it accelerates rather than sliding down at a constant rate",
        ys[4] - ys[5] < ys[19] - ys[20],
        `${(ys[4] - ys[5]).toFixed(3)} then ${(ys[19] - ys[20]).toFixed(3)}`);
  check("it lands on the point the descriptor names",
        Math.abs(z.pos.y - 37) < 0.01 && Math.abs(z.pos.x + 732.8) < 0.01,
        `(${z.pos.x.toFixed(1)}, ${z.pos.y.toFixed(1)})`);
  check("in about the frames it names", ys.findIndex((y) => y <= 37.001) <= 31,
        `${ys.findIndex((y) => y <= 37.001)}`);
  check("and then stands up to throw",
        z.state === ThrowerState.StandAndDecide, `state ${z.state}`);
}

// -- 3c. the route ----------------------------------------------------------

console.log("ThrowerStatePathFollow:");
{
  const rng = new Rng(6);
  const events = scene(0, rng);
  // Stage 2 block 3's zsass, 3/3/4, descriptor 0x1EF0, verbatim: wait 30
  // frames, then climb three legs before it fights.
  const z = ActorSpawn(0x1ef0, SpawnClass.Thrower, 1, "zsass", {
    initialState: ThrowerState.PathFollow,
    path: {
      delay: 30,
      points: [
        { step: 1, motion_set: 1, dest: [-741.9, 100.0, -890.7] },
        { step: 1, motion_set: 1, dest: [-741.9, 110.0, -845.7] },
        { step: 1, motion_set: 2, dest: [-737.5, 115.0, -810.0] },
      ],
    },
  });
  z.visible = true;
  z.hp = 10;
  z.pos = vec3(-741.9, 90.0, -930.0);
  z.motion = 10;
  const start = { ...z.pos };

  check("it starts on the route, not standing and throwing",
        z.state === ThrowerState.PathFollow, `state ${z.state}`);
  for (let i = 0; i < 20; i++) GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
  check("it holds still for the descriptor's delay",
        Math.abs(z.pos.z - start.z) < 0.01, `moved ${(z.pos.z - start.z).toFixed(2)}`);

  // The leap at the end lands in front of the camera, so the camera has to be
  // somewhere plausible: in the real scene it is on the street below the roof,
  // not a thousand units away at the origin.
  const roofEye = vec3(-737.5, 100.0, -780.0);
  const roofHost = {
    ...NULL_HOST,
    viewPoint: (x: number, y: number, zz: number, out: Vec3) => {
      out.x = roofEye.x + x;
      out.y = roofEye.y + y;
      out.z = roofEye.z + zz;
    },
  };
  let reachedLast = false;
  for (let i = 0; i < 900; i++) {
    GameUpdate(roofEye, 1 / 60, roofHost, rng, events);
    if (!reachedLast && Math.abs(z.pos.x + 737.5) < 0.2
        && Math.abs(z.pos.z + 810.0) < 0.2
        && Math.abs(z.pos.y - 115.0) < 0.2) reachedLast = true;
  }
  check("it walks the route to the last waypoint", reachedLast,
        `(${z.pos.x.toFixed(1)}, ${z.pos.y.toFixed(1)}, ${z.pos.z.toFixed(1)})`);
  // `ThrowerStateLeapDown`: off the roof and into shot, at a place picked on
  // the *screen* rather than on the map -- 15.5 in front, 9.4 below.
  // The depth is exact -- 15.5 is a literal in `ThrowerPickLandingPoint`. The
  // drop is not asserted to the unit because it divides by
  // `g_projection_distance_px`, which is derived from the projection rather
  // than read out of the binary; what matters is that it comes *down* and
  // lands in front.
  check("then it comes down off the roof, in front of the camera",
        Math.abs(z.pos.z - (roofEye.z - 15.5)) < 0.5
        && z.pos.y < 115 - 5 && z.pos.y < roofEye.y,
        `(${z.pos.x.toFixed(1)}, ${z.pos.y.toFixed(1)}, ${z.pos.z.toFixed(1)})`);
  // ...and the pounce hands to the leap aside, not to the hub: state 9 always
  // ends in state 10. Standing again is two states further on.
  check("and only then goes for the player",
        z.state === ThrowerState.LeapAside
        || z.state === ThrowerState.StandAndDecide, `state ${z.state}`);
}

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
  const z = ActorSpawn(0x5100, SpawnClass.Zombie, 1, "van", {
    initialState: ZombieState.MotionCue,
    attackState: ZombieState.AttackRun,
    intro: { motion: 923, delay: 10 },
    flags: ActorFlag.PoseFrozen | ActorFlag.ShotImmune | ActorFlag.ArcSpent,
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
                    | ActorFlag.ArcSpent)) === 0,
        `flags 0x${z.flags.toString(16)}`);
}

// -- 3d. the on-screen gate -------------------------------------------------

console.log("ActorIsOnScreen:");
{
  const rng = new Rng(2);
  const events = scene(0, rng);
  const z = ActorSpawn(0x5000, SpawnClass.Zombie, 1, "offscreen");
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
    GameUpdate(EYE, 1 / 60, offscreen, rng, events);
  }
  check("an enemy off the side of the frame still takes a permit",
        z.attackPermit >= 0, `permit ${z.attackPermit}`);
  check("...and latches g_attack_committed while it holds it",
        G.g_attack_committed === 1
        && (z.flags2 & ZombieFlag2.OffScreenPermit) !== 0,
        `latch ${G.g_attack_committed} flags2 ${z.flags2.toString(16)}`);

  // The latch is the throttle: while one enemy is attacking unseen, nobody
  // else may claim at all — not even one in plain sight.
  const other = ActorSpawn(0x5004, SpawnClass.Zombie, 1, "second");
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
        !TryClaimAttackSlot(other, onscreen), `permit ${other.attackPermit}`);

  // Releasing the off-screen permit lifts it, and only then.
  ReleaseAttackSlot(z);
  check("releasing it lifts the latch", G.g_attack_committed === 0
        && (z.flags2 & ZombieFlag2.OffScreenPermit) === 0);
  check("and the next enemy may claim", TryClaimAttackSlot(other, onscreen),
        `permit ${other.attackPermit}`);
  ReleaseAttackSlot(other);

  // **Dying holds the latch if the release is only half done.** The engine
  // frees it from the death state — `ZombieStateDeath6` (`FUN_00454D20`) sub 1
  // runs `ZombieReleasePermitAndUntrack` (`FUN_004565A0`), whose first line is
  // `ReleaseAttackSlot`. The port has no class-0x30 death state, so
  // `GameUpdate`'s dead-actor sweep does it; clearing `g_attack_permits`
  // there without lifting `g_attack_committed` left every remaining enemy
  // refused on `TryClaimAttackSlot`'s first line, and a crowd walked to the
  // ring and stood there wanting a permit nobody held.
  check("an off-screen attacker takes the latch again",
        TryClaimAttackSlot(z, offscreen) && G.g_attack_committed === 1,
        `latch ${G.g_attack_committed}`);
  z.dead = true;
  GameUpdate(EYE, 1 / 60, offscreen, rng, events);
  check("...and dying gives back the whole permit, latch included",
        G.g_attack_committed === 0 && z.attackPermit === -1
        && G.g_attack_permits.every((p) => p === -1),
        `latch ${G.g_attack_committed} permits ${JSON.stringify(G.g_attack_permits)}`);
  check("so the enemies still standing can attack",
        TryClaimAttackSlot(other, onscreen), `permit ${other.attackPermit}`);
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
  const out1 = ResolveHit(z, 4, 0, NULL_HOST, rng);
  check("a hit takes hit points off", z.hp === 100 - 3, `hp ${z.hp}`);
  check("and swaps the bone's model", z.boneSlot["4"] === 0x11,
        JSON.stringify(z.boneSlot));
  check("and stumbles", out1.react !== undefined);
  ResolveHit(z, 4, 0, NULL_HOST, rng);
  ResolveHit(z, 4, 0, NULL_HOST, rng);
  const out4 = ResolveHit(z, 4, 0, NULL_HOST, rng);
  check("the fourth hit severs", out4.severed && out4.result === 3);
  check("and takes the forearm with it -- the whole subtree, not just the arm",
        z.removed.includes(5), `removed ${JSON.stringify(z.removed)}`);
  check("the destroyed-zone mask is set", (z.zones & 2) === 2, `${z.zones}`);
  const before = z.zones;
  ResolveHit(z, 4, 0, NULL_HOST, rng);
  check("a fifth hit on a severed limb does not sever again",
        z.zones === before && z.removed.filter((b) => b === 5).length === 1);

  z.hp = 1;
  const kill = ResolveHit(z, 1, 0, NULL_HOST, rng);
  check("zero hit points kills, once", kill.killed && z.dead);
  check("and picks a directional death", z.death !== null);
  const again = ResolveHit(z, 1, 0, NULL_HOST, rng);
  check("a hit on a corpse scores nothing", !again.killed
        && again.result === 0);
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
  CamAdvancePathFrame(EYE, rail);
  CamSetPathTarget(rail);

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
    CamSetPathTarget(rail);
    GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
    pulled = aimAngle();
  }
  check("an enemy pulls the aim off the rail", pulled > 3,
        `${pulled.toFixed(1)} deg off`);
  check("and the camera is marked as tracking", G.g_camera_is_tracking === 1);

  // Now kill it. Nothing is registered from the next frame on.
  z.dead = true;
  let worst = 0;
  let settled = -1;
  for (let i = 0; i < 300; i++) {
    const before = aimAngle();
    CamSetPathTarget(rail);
    GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
    const after = aimAngle();
    worst = Math.max(worst, Math.abs(before - after));
    if (settled < 0 && after < 0.5) settled = i;
  }
  check("with nothing registered the camera stops tracking",
        G.g_camera_is_tracking === 0);
  check("the aim comes back to the rail", settled >= 0,
        `still ${aimAngle().toFixed(2)} deg off after 300 frames`);
  // 1/13 of a gap that starts near 16 degrees is about 1.3 degrees; a snap
  // would show the whole gap in one step.
  check("and never moves more than two degrees in a frame", worst < 2,
        `worst frame moved ${worst.toFixed(2)} deg`);
  check("it takes tens of frames, not one", settled > 20,
        `settled after ${settled} frames`);
  check("`g_camera_settled` is raised once it has caught up",
        G.g_camera_settled === 1);
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


// -- 8. class 0x41, the breakable-prop / item-container placer --------------
//
// Two groups' worth of members, shaped like the real ones: a two-high stack
// whose top member is held up by the bottom one, and a three-member item set.
// The hull is a single point under the origin, which is enough to make
// `BreakablePropGroundContact` fire the moment a faller drops below the floor.

const BREAKABLES: BreakablesJson = {
  groups: [
    // group 0: a stack. Member 1 stands on member 0.
    [
      { index: 0, x: 0, z: 0, item_set: 0, story_item: -1, level: 0,
        y_offset: 0, supports: [] },
      { index: 1, x: 0, z: 0, item_set: 0, story_item: -1, level: 1,
        y_offset: 7.540296, supports: [0] },
    ],
    // group 1: three props sharing item set 2, all on the ground.
    [
      { index: 0, x: 10, z: 0, item_set: 2, story_item: -1, level: 0,
        y_offset: 0, supports: [] },
      { index: 1, x: 20, z: 0, item_set: 2, story_item: -1, level: 0,
        y_offset: 0, supports: [] },
      { index: 2, x: 30, z: 0, item_set: 2, story_item: -1, level: 0,
        y_offset: 0, supports: [] },
    ],
    // group 2: one prop hiding the extra life.
    [
      { index: 0, x: 40, z: 0, item_set: 1, story_item: -1, level: 0,
        y_offset: 0, supports: [] },
    ],
  ],
  // Four corners of a box. A single point is not enough: the settle picks the
  // *lowest corner that is not the current one*, so a one-point hull can never
  // re-seat and the object sinks to wherever the fall left it.
  hull: [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]],
  falling_hull: [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]],
  kinds: Array.from({ length: 11 }, (_, k) => ({
    kind: k, effect: k, effect_variant: 400 + k, sound: 0x1a16a9,
    radius: 6, y_offset: 6,
  })),
  placements: [
    { at: 0xa100, container: "group", group: 1, lifetime_evt_steps: 4 },
    { at: 0xa200, container: "group", group: 2, lifetime_evt_steps: 6 },
  ],
  level_height: 7.540296,
};

/**
 * A scene for the container tests.
 *
 * The mode defaults to **Original** because that is the one in which an
 * ordinary breakable is an ordinary breakable. In Arcade,
 * `PlaceBreakableGroup` turns the members named by `g_prop_target_set` into
 * one-shot targets that pay no score, and every group has at least one of
 * them — so "a prop takes two shots" is a statement about Original Mode and
 * always was. Arcade's rule gets its own case below.
 */
function propScene(rng: Rng, mode: GameMode = GameMode.Original): Events {
  ResetGameGlobals();
  SetGameTables(CHARS, BREAKABLES);
  G.g_player_lives = [PLAYER.start_lives, PLAYER.start_lives];
  G.g_camera_fixed_eye_y = 0;
  G.g_GameMode = mode;
  void rng;
  return new Events();
}

/** Shoot a prop `n` times, running its update after each. */
function shoot(p: { id: number }, n: number, rng: Rng, events: Events): void {
  for (let i = 0; i < n; i++) {
    const live = G.g_breakable_props.find((q) => q.id === p.id);
    if (!live) return;
    BreakablePropTakeShot(live, 0);
    BreakablePropUpdate(live, rng, events);
  }
}

console.log("\nclass 0x41, the placer:");
{
  const rng = new Rng(11);
  propScene(rng);
  const placer = ActorSpawn(0x9000, SpawnClass.PropContainerPlacer, 4, "placer");
  placer.visible = true;
  placer.hp = 1;          // +0x11C: the group id
  placer.charType = 4;    // +0x1F4: the lifetime in evt blocks
  placer.condition = 0;   // +0x130C: constructor 0, PlaceBreakableGroup

  PropContainerPlacerUpdate(placer, {
    eye: EYE, dt: 1 / 60, rng, host: NULL_HOST,
  });

  check("the placer builds its group", G.g_breakable_props.length === 3,
        `${G.g_breakable_props.length} props`);
  check("the placer kills itself on its first frame", placer.dead);
  check("every prop is registered in g_breakable_members",
        G.g_breakable_props.every(
          (p) => G.g_breakable_members[p.group * MEMBERS_PER_GROUP + p.member]
                 === p.id));
  check("the item countdown is seeded inside [1, n]",
        G.g_item_set_countdown[ItemSet.Score2] >= 1
        && G.g_item_set_countdown[ItemSet.Score2] <= 3,
        String(G.g_item_set_countdown[ItemSet.Score2]));
  check("a prop takes two shots and carries the group's lifetime",
        G.g_breakable_props.every((p) => p.hp === 2 && p.lifetime === 4));
}

console.log("\nclass 0x41, breaking a prop:");
{
  const rng = new Rng(11);
  const events = propScene(rng);
  const props = PlaceBreakableGroup(1, 4, rng);
  let cracked = 0, broken = 0;
  events.on("prop.cracked", () => cracked++);
  events.on("prop.broken", () => broken++);

  const before = G.g_player_score[0];
  shoot(props[0], 1, rng, events);
  check("the first shot cracks rather than breaks",
        cracked === 1 && broken === 0);
  check("the cracked prop swaps to the broken model",
        G.g_breakable_props[0].slot === BreakableSlot.Broken);
  check("cracking a prop is worth no score at all",
        G.g_player_score[0] === before, `${G.g_player_score[0]} vs ${before}`);
  check("but it still counts as a hit", G.g_player_hit_count[0] === 1);

  shoot(props[0], 1, rng, events);
  check("the second shot breaks it", broken === 1);
  check("breaking it is worth ten", G.g_player_score[0] === before + 10,
        String(G.g_player_score[0]));
  check("a broken prop leaves its member slot",
        G.g_breakable_members[1 * MEMBERS_PER_GROUP + 0] === 0);
}

console.log("\nclass 0x41, the item comes out on a random break:");
{
  // The countdown decides *which* break pays out, and it is drawn from the
  // rng -- so over many seeds the release must land on every one of the three
  // props, and never on a fourth break that does not exist.
  const landed = new Set<number>();
  for (let seed = 1; seed <= 40; seed++) {
    const rng = new Rng(seed);
    const events = propScene(rng);
    let releases = 0;
    let onBreak = -1;
    events.on("item.released", () => { releases++; onBreak = breaks; });
    const props = PlaceBreakableGroup(1, 4, rng);
    let breaks = 0;
    for (const p of props) {
      shoot(p, 2, rng, events);
      breaks++;
    }
    check(`seed ${seed}: exactly one item comes out of the set`,
          releases === 1, `${releases} releases`);
    landed.add(onBreak);
  }
  check("over 40 seeds the release lands on more than one break",
        landed.size > 1, `landed on breaks {${[...landed].sort().join(",")}}`);
}

console.log("\nclass 0x41, the stack collapses:");
{
  const rng = new Rng(5);
  const events = propScene(rng);
  const props = PlaceBreakableGroup(0, 4, rng);
  const bottom = props[0], top = props[1];
  check("the top of the stack starts a level up",
        Math.abs(top.y - (bottom.y + 7.540296)) < 1e-6,
        `${top.y} vs ${bottom.y}`);
  check("the top starts standing", top.state === BreakableState.Standing);

  shoot(bottom, 2, rng, events);
  // The bottom is gone; the top should notice on its next update and fall.
  BreakablePropUpdate(top, rng, events);
  check("the top falls once its support is destroyed",
        top.state === BreakableState.Falling, BreakableState[top.state]);

  for (let i = 0; i < 600 && top.state === BreakableState.Falling; i++) {
    BreakablePropUpdate(top, rng, events);
  }
  check("and it comes to rest rather than falling for ever",
        top.state === BreakableState.Settled, BreakableState[top.state]);
  check("it rests at or above the floor",
        top.y >= G.g_camera_fixed_eye_y - 0.1 - 1e-3, String(top.y));
}

console.log("\nclass 0x41, a prop's lifetime is in evt blocks:");
{
  const rng = new Rng(9);
  const events = propScene(rng);
  const props = PlaceBreakableGroup(1, 2, rng);
  const p = props[0];
  // Frames alone must never expire it: the engine counts block advances.
  for (let i = 0; i < 1000; i++) BreakablePropUpdate(p, rng, events);
  check("a thousand frames do not expire a prop", !p.dead);
  for (let b = 1; b <= 3; b++) {
    G.g_evt_step_index = b;
    BreakablePropUpdate(p, rng, events);
  }
  check("but three block advances past a lifetime of two do", p.dead);
}

console.log("\nclass 0x41, the extra life:");
{
  const rng = new Rng(13);
  const events = propScene(rng);
  let released = -1;
  events.on("item.released", (e) => { released = e.set; });
  const props = PlaceBreakableGroup(2, 4, rng);
  shoot(props[0], 2, rng, events);
  check("the lone item-set-1 prop releases the extra life",
        released === ItemSet.ExtraLife, String(released));

  G.g_player_lives[0] = 2;
  check("GrantExtraLife adds a life", GrantExtraLife(0) && G.g_player_lives[0] === 3);
  G.g_player_lives[0] = 5;
  const score = G.g_player_score[0];
  check("and pays 300 instead when the player is at the cap",
        !GrantExtraLife(0) && G.g_player_lives[0] === 5
        && G.g_player_score[0] === score + 300);
}

console.log("\nclass 0x41, the script spawns reach the pool:");
{
  const rng = new Rng(31);
  const events = propScene(rng);
  // What the walker's live spawn list looks like: a placer the bundle has a
  // placement for, one it does not, and an unrelated class.
  const spawns = [
    { at: 0xa100, class: SpawnClass.PropContainerPlacer },
    { at: 0xbeef, class: SpawnClass.PropContainerPlacer },   // no placement
    { at: 0xc000, class: SpawnClass.Zombie },
  ];
  SpawnPropContainers(spawns);
  const placers = G.g_object_list.filter(
    (o) => o.cls === SpawnClass.PropContainerPlacer);
  check("only the placer with a placement is spawned",
        placers.length === 1 && placers[0].at === 0xa100,
        `${placers.length} placers`);
  check("it carries the group in +0x11C and the lifetime in +0x1F4",
        placers[0].hp === 1 && placers[0].charType === 4);

  // The placer builds its group on its first update and then kills itself.
  GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
  check("one frame places the group", G.g_breakable_props.length === 3,
        `${G.g_breakable_props.length} props`);
  check("and the placer is gone", placers[0].dead);

  // Running again must not place it twice -- the bridge is called every frame.
  SpawnPropContainers(spawns);
  GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
  check("a second pass does not place the group again",
        G.g_breakable_props.length === 3,
        `${G.g_breakable_props.length} props`);
}

console.log("\nclass 0x41 type 4, the kinded props:");
{
  const rng = new Rng(41);
  const events = propScene(rng);
  let broken = 0, cracked = 0, released = -1;
  events.on("prop.broken", () => broken++);
  events.on("prop.cracked", () => cracked++);
  events.on("item.released", (e) => { released = e.set; });

  // Kind 2 wears 0x17A9 and dies to one shot; kind 3 wears the group props'
  // crate and takes two. Both are in item set 2, size 2.
  const a = PlaceKindedProp(0xd000, 2, ItemSet.Score2, 2, 5,
                            10, 0, 0, 0x4000, rng);
  const b = PlaceKindedProp(0xd001, 3, ItemSet.Score2, 2, 5,
                            20, 0, 0, 0, rng);
  G.g_breakable_props.push(a, b);
  check("a kinded prop takes the slot its kind names",
        a.slot === KIND_SLOT[2] && b.slot === KIND_SLOT[3],
        `${a.slot.toString(16)} / ${b.slot.toString(16)}`);
  check("and is its own family", a.family === PropFamily.Kinded);
  check("the countdown is seeded inside [1, set size]",
        G.g_item_set_countdown[ItemSet.Score2] >= 1
        && G.g_item_set_countdown[ItemSet.Score2] <= 2);

  // The crate kind survives its first shot; every other kind does not.
  BreakablePropTakeShot(b, 0);
  KindedPropUpdate(b, rng, events);
  check("the crate kind survives one shot and hides its model",
        cracked === 1 && broken === 0 && b.slot === SLOT_NONE,
        `slot ${b.slot.toString(16)}`);

  const before = G.g_player_score[0];
  BreakablePropTakeShot(a, 0);
  KindedPropUpdate(a, rng, events);
  check("a non-crate kind dies to one shot", broken === 1);
  check("and that shot is worth ten", G.g_player_score[0] === before + 10,
        `${G.g_player_score[0]} vs ${before}`);

  // The break effect holds the prop for its animation, then it goes.
  for (let i = 0; i < 200 && !a.dead; i++) KindedPropUpdate(a, rng, events);
  check("the destroyed prop leaves once its effect has run", a.dead);
  void released;
}

console.log("\nclass 0x41 type 4, the whole set pays out exactly once:");
{
  for (let seed = 1; seed <= 20; seed++) {
    const rng = new Rng(seed);
    const events = propScene(rng);
    let releases = 0;
    events.on("item.released", () => releases++);
    // Four props sharing set 5, declared size 4 -- the shape stage 2 uses.
    const props = [0, 1, 2, 3].map((i) =>
      PlaceKindedProp(0xe000 + i, 2, ItemSet.Score5, 4, 5,
                      i * 10, 0, 0, 0, rng));
    G.g_breakable_props.push(...props);
    for (const p of props) {
      BreakablePropTakeShot(p, 0);
      KindedPropUpdate(p, rng, events);
    }
    check(`seed ${seed}: exactly one item from the set of four`,
          releases === 1, `${releases} releases`);
  }
}

console.log("\nclass 0x44 selector 16, the falling container:");
{
  const rng = new Rng(77);
  const events = propScene(rng);
  let cracked = 0, broken = 0, settled = 0, released = -1;
  events.on("prop.cracked", () => cracked++);
  events.on("prop.broken", () => broken++);
  events.on("prop.settled", () => settled++);
  events.on("item.released", (e) => { released = e.set; });

  const c = PlaceFallingContainer(0xf000, 1, ItemSet.ExtraLife, -1, 1, 6,
                                  0, 20, 0, 0, rng);
  G.g_breakable_props.push(c);
  check("it starts whole, two shots, on its own floor",
        c.slot === FALLING_SLOT_WHOLE && c.hp === 2
        && Math.abs(c.floorY - (20 - 7.35)) < 1e-6,
        `floor ${c.floorY}`);

  const before = G.g_player_score[0];
  BreakablePropTakeShot(c, 0);
  FallingContainerUpdate(c, rng, events);
  check("the first shot knocks it loose rather than breaking it",
        cracked === 1 && broken === 0 && c.hp === 1
        && c.slot === FALLING_SLOT_LOOSE);
  check("it pays nothing for that", G.g_player_score[0] === before);
  check("and it is thrown upward", c.vy > 0, String(c.vy));
  check("it is falling", c.state === BreakableState.Falling);

  for (let i = 0; i < 600 && c.state === BreakableState.Falling; i++) {
    FallingContainerUpdate(c, rng, events);
  }
  check("it comes to rest rather than falling for ever",
        c.state === BreakableState.Settled, BreakableState[c.state]);
  // Settling is what re-seats the origin: the contact frame only records the
  // corner, and the frames after it put the container back on that corner.
  for (let i = 0; i < 120; i++) FallingContainerUpdate(c, rng, events);
  // It comes to rest *on a corner*, so the origin sits above the floor by
  // however far that corner is from it -- what must not happen is the origin
  // sinking through, or the container settling onto the camera's ground plane
  // instead of its own.
  check("it settles on its own floor rather than through it or the camera's",
        c.y >= c.floorY - 1e-3 && c.y - c.floorY < 3
        && c.floorY > G.g_camera_fixed_eye_y,
        `y ${c.y.toFixed(3)} floor ${c.floorY.toFixed(3)} ` +
        `camera ${G.g_camera_fixed_eye_y}`);
  check("landing was announced", settled === 1);

  BreakablePropTakeShot(c, 0);
  FallingContainerUpdate(c, rng, events);
  check("the second shot destroys it", broken === 1 && c.dead);
  check("it pays ten", G.g_player_score[0] === before + 10);
  check("and the extra life comes out", released === ItemSet.ExtraLife,
        String(released));
}

console.log("\nall three families share one item-set countdown:");
{
  const rng = new Rng(5);
  const events = propScene(rng);
  let releases = 0;
  events.on("item.released", () => releases++);
  // One group prop and two kinded props, all in set 2. The group placer
  // seeds the countdown, then each kinded placement re-seeds it -- which is
  // the engine's own behaviour and why the classes cannot be ported apart.
  PlaceBreakableGroup(1, 4, rng);
  const k = [0, 1].map((i) =>
    PlaceKindedProp(0xf100 + i, 2, ItemSet.Score2, 2, 5, 50 + i * 10, 0, 0,
                    0, rng));
  G.g_breakable_props.push(...k);
  check("the countdown is one global, not one per class",
        G.g_item_set_countdown[ItemSet.Score2] >= 1
        && G.g_item_set_countdown[ItemSet.Score2] <= 2,
        String(G.g_item_set_countdown[ItemSet.Score2]));

  // Break everything in set 2 across both classes; exactly one item drops.
  for (const p of [...G.g_breakable_props]) {
    if (p.itemSet !== ItemSet.Score2) continue;
    for (let n = 0; n < 3 && !p.dead; n++) {
      BreakablePropTakeShot(p, 0);
      if (p.family === PropFamily.Kinded) KindedPropUpdate(p, rng, events);
      else BreakablePropUpdate(p, rng, events);
    }
  }
  check("breaking the set across two classes pays out once",
        releases === 1, `${releases} releases`);
}

console.log("\nclass 0x41, the generic props:");
{
  const rng = new Rng(3);
  propScene(rng);
  // What the exporter emits for one: the type, the asset slot from `+0x11C`,
  // and three real angles.
  const p = PlaceGenericProp({
    at: 0xa900, container: "generic", type: 12, slot: 0x173d,
    lifetime_evt_steps: 0, pos: [5, 6, 7], pitch: 0x100, yaw: 0x2000,
    roll: 0x300,
  }, rng);
  check("a generic prop draws the slot from +0x11C, not hit points",
        p.slot === 0x173d, p.slot.toString(16));
  check("it is placed where the script put it",
        p.x === 5 && p.y === 6 && p.z === 7);
  check("all three orientation words are angles for this family",
        p.pitch === 0x100 && p.yaw === 0x2000 && p.roll === 0x300);
  check("and it is the drawn-only family",
        p.family === PropFamily.Generic);

  // The arms of the switch that override what the prologue took.
  const door = PlaceGenericProp({
    at: 0xa901, container: "generic", type: 6, slot: 0x1234,
    lifetime_evt_steps: 0, pos: [0, 0, 0],
  }, rng);
  check("a type whose arm overrides the slot uses the arm's",
        door.slot === 0x1032 && door.hp === 1, door.slot.toString(16));
}

console.log("\nclass 0x41 type 34 is a falling container:");
{
  const rng = new Rng(9);
  const events = propScene(rng);
  // The generic constructor's case 0x22 builds the same object class 0x44
  // selector 16 does -- so the type-34 spawns in stages 1, 3, 4 and 5 are
  // item containers, and they were absent entirely.
  const before = G.g_item_set_countdown[ItemSet.Score2] ?? 0;
  const c = PlaceFallingContainer(0xf200, 0, ItemSet.Score2, -1, 1, 4,
                                  0, 20, 0, 0, rng);
  G.g_breakable_props.push(c);
  check("it seeds an item countdown, which is why it could not be skipped",
        G.g_item_set_countdown[ItemSet.Score2] === 1
        && before !== G.g_item_set_countdown[ItemSet.Score2]);
  check("and it is the same two-shot falling object",
        c.family === PropFamily.Falling && c.hp === 2
        && c.slot === FALLING_SLOT_WHOLE);
  void events;
}

// -- 9. class 0x25, the scripted humanoid VM -------------------------------

function humanoidScene(cmds: HumanoidProgram["cmds"],
                       over: Partial<HumanoidProgram> = {}):
    { a: ReturnType<typeof ActorSpawn>; events: Events } {
  ResetGameGlobals();
  const prog: HumanoidProgram = {
    charType: 1, removePath: 90, removeFrame: 900, flags2: 0,
    motion: 10, phase: 0, cmds, ...over,
  };
  SetGameTables(CHARS, undefined, undefined, { "12288": prog });
  G.g_active_cam_path = -1;
  G.g_cam_path_frame = 0;
  const a = ActorSpawn(0x3000, SpawnClass.ScriptedHumanoid, 1, "humanoid");
  a.visible = true;
  a.pos = vec3(0, 0, 0);
  return { a, events: new Events() };
}

const hFrame = (a: ReturnType<typeof ActorSpawn>, events: Events, rng: Rng) =>
  ScriptedHumanoidUpdate(a, { eye: EYE, dt: 1 / 60, rng, host: NULL_HOST,
                              events });

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
        a.pos.x === 5 && a.pos.z === 7 && a.bonePropMode === 2
        && a.turnMode === HumanoidTurn.FaceCamera && a.pc === 3,
        `pc ${a.pc}`);

  // The wait costs frames, and exactly the number it asks for.
  for (let i = 0; i < 29; i++) hFrame(a, events, rng);
  check("the wait holds the cursor while it counts", a.pc === 3 && !a.dead,
        `pc ${a.pc} hold ${a.holdFrames}`);
  hFrame(a, events, rng);
  check("and releases on the frame it names, running on to the kill",
        a.dead, `pc ${a.pc} hold ${a.holdFrames}`);
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
  check("it waits while the camera is elsewhere", a.pc === 0);
  G.g_active_cam_path = 57;
  G.g_cam_path_frame = 39;
  hFrame(a, events, rng);
  check("and while the path matches but the frame has not come", a.pc === 0);
  G.g_cam_path_frame = 40;
  hFrame(a, events, rng);
  check("then runs on when the camera arrives",
        a.pos.y === 12 && a.pc === -1, `pc ${a.pc} y ${a.pos.y}`);
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
        !a.dead && a.pc === 0, `pc ${a.pc}`);
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
    { op: HumanoidOp.SetBoneDecoration, mode: 1, a: 0, b: 0 },
    { op: HumanoidOp.SetBonePropMode, mode: 2, a: 0, b: 0 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 4, b: 0 },
    { op: HumanoidOp.SetBoneDecoration, mode: 0, a: 0, b: 0 },
    { op: HumanoidOp.SetBonePropMode, mode: 7, a: 0, b: 0 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 9999, b: 0 },
  ]);
  a.bonePropFrame = 9;
  hFrame(a, events, rng);
  check("op 12 mode 1 sets the bone decoration and it stays set",
        a.boneDecoration === 1);
  check("op 14 mode 2 picks hand prop 2 and restarts the cel counter",
        a.bonePropMode === 2 && a.bonePropFrame === 0);

  for (let i = 0; i < 4; i++) hFrame(a, events, rng);
  check("op 12 mode 0 clears it again", a.boneDecoration === 0);
  check("and a mode op 14 does not know leaves the prop alone",
        a.bonePropMode === 2, `mode ${a.bonePropMode}`);
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
  check("the frame that runs op -1 still falls through the normal tail",
        a.pc === -1 && a.holdFrames === 1 && a.turnMode === HumanoidTurn.FaceCamera,
        `pc ${a.pc} hold ${a.holdFrames}`);

  const yaw = a.yaw;
  // Move it somewhere the FaceCamera turn would aim it differently.
  a.pos.x = 500;
  a.pos.z = -500;
  hFrame(a, events, rng);
  hFrame(a, events, rng);
  check("and after that it stops turning and stops counting",
        a.yaw === yaw && a.holdFrames === 1,
        `yaw ${a.yaw} was ${yaw} hold ${a.holdFrames}`);

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
  ScriptedHumanoidUpdate(a, { eye: EYE, dt: 1 / 60, rng, host: pathHost,
                              events });
  const r = g_class25_path_offsets[1];
  check("op 11's b indexes the 24-byte offset table",
        a.pathOffsetRecord === 1 && r.dx === 4.5 && r.dyaw === 0x8000);
  check("and the record is added to the path's point, with its yaw delta",
        Math.abs(a.pos.x - (10 + r.dx)) < 1e-6
        && Math.abs(a.pos.y - (0 + r.dy)) < 1e-6
        && Math.abs(a.pos.z - (20 + r.dz)) < 1e-6
        && a.yaw === r.dyaw,
        `pos ${a.pos.x},${a.pos.y},${a.pos.z} yaw ${a.yaw}`);
}

console.log("\nclass 0x25, it is not an enemy:");
{
  const rng = new Rng(4);
  const { a, events } = humanoidScene([
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 9999, b: 0 },
  ]);
  hFrame(a, events, rng);
  GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
  check("a scripted humanoid is not counted as a live enemy",
        G.g_enemies_alive === 0, String(G.g_enemies_alive));
  check("and is not a camera target", G.g_enemy_slots.length === 0);
}

// -- 10. class 0x24, the set-pieces ----------------------------------------

const SETPIECE_BASE: SetPieceParams = {
  selector: 0, removePath: 7, removeFrame: 100, motion: 10, hold: 0,
  cuePath: 3, cueFrame: 40, cue2Path: 4, cue2Frame: 20, phase: 0,
};

/** A stage with one set-piece of the given shape, and the camera at nothing. */
function setPieceScene(over: Partial<SetPieceParams>, rng: Rng): {
  a: ReturnType<typeof ActorSpawn>; events: Events;
} {
  ResetGameGlobals();
  const params = { ...SETPIECE_BASE, ...over };
  SetGameTables(CHARS, undefined, { "12288": params });
  G.g_camera_fixed_eye_y = 0;
  G.g_active_cam_path = -1;
  G.g_cam_path_frame = 0;
  const a = ActorSpawn(0x3000, SpawnClass.SetPieceProp, 1, "set-piece");
  a.visible = true;
  a.pos = vec3(0, 40, 0);
  void rng;
  return { a, events: new Events() };
}

const frame = (a: ReturnType<typeof ActorSpawn>, events: Events, rng: Rng) =>
  SetPiecePropUpdate(a, { eye: EYE, dt: 1 / 60, rng, host: NULL_HOST, events });

console.log("\nclass 0x24, the removal trigger:");
{
  const rng = new Rng(2);
  const { a, events } = setPieceScene({}, rng);
  frame(a, events, rng);
  check("it stays while the camera is elsewhere", !a.dead);

  G.g_active_cam_path = 7;
  G.g_cam_path_frame = 99;
  frame(a, events, rng);
  check("and while the path matches but the frame has not arrived", !a.dead);

  G.g_cam_path_frame = 100;
  let removed = 0;
  events.on("setpiece.removed", () => removed++);
  frame(a, events, rng);
  check("it leaves the moment the camera reaches the path and frame",
        a.dead && removed === 1);
}

console.log("\nclass 0x24, the freeze cues:");
{
  const rng = new Rng(2);
  // Selector 2 opens frozen and takes two cues: one starts it, one stops it.
  const { a, events } = setPieceScene(
    { selector: SetPieceState.StartAndStopOnCues }, rng);
  check("selector 2 opens frozen", a.frozen === 1);

  G.g_active_cam_path = 4;
  G.g_cam_path_frame = 20;
  frame(a, events, rng);
  check("the start cue releases it", a.frozen === 0);

  G.g_active_cam_path = 3;
  G.g_cam_path_frame = 40;
  frame(a, events, rng);
  check("the stop cue freezes it again", a.frozen === 1);

  // And a frozen actor's clip does not advance -- the freeze is in
  // `ActorAdvanceMotion`, where the engine keeps it.
  a.motion = 10;
  const before = a.playTicks;
  ActorAdvanceMotion(a, 1 / 60);
  check("a frozen set-piece holds its pose", a.playTicks === before);
  a.frozen = 0;
  ActorAdvanceMotion(a, 1 / 60);
  check("and an unfrozen one does not", a.playTicks > before);
}

console.log("\nclass 0x24, the drop:");
{
  const rng = new Rng(2);
  const { a, events } = setPieceScene(
    { selector: SetPieceState.DropToGround }, rng);
  check("selector 3 opens frozen and in the air",
        a.frozen === 1 && a.pos.y === 40);

  frame(a, events, rng);
  check("the first frame only arms the fall", a.sub === 1 && a.pos.y === 40);

  frame(a, events, rng);
  check("then it accelerates downward",
        Math.abs(a.vel.y - -DROP_GRAVITY) < 1e-9 && a.pos.y < 40,
        `vel ${a.vel.y}`);

  for (let i = 0; i < 3000 && a.sub === 1; i++) frame(a, events, rng);
  check("it lands on the ground plane and stops exactly there",
        a.sub === 2 && a.pos.y === G.g_camera_fixed_eye_y, String(a.pos.y));
  check("and landing is what starts the animation", a.frozen === 0);
}

console.log("\nclass 0x24, the slide:");
{
  const rng = new Rng(2);
  const { a, events } = setPieceScene({ selector: SetPieceState.Slide }, rng);
  frame(a, events, rng);
  check("it takes the fixed heading",
        Math.abs(a.vel.x - SLIDE_VX) < 1e-6
        && Math.abs(a.vel.z - SLIDE_VZ) < 1e-6);
  const x0 = a.pos.x;
  for (let i = 0; i < SLIDE_FRAMES + 4; i++) frame(a, events, rng);
  check("it travels along it and then stops",
        a.pos.x > x0 && a.sub >= 2, `x ${a.pos.x.toFixed(1)} sub ${a.sub}`);
  const rest = a.pos.x;
  for (let i = 0; i < 200; i++) frame(a, events, rng);
  check("and stays stopped", a.pos.x === rest);
}

console.log("\nclass 0x24, the selector is +0x130C:");
{
  const rng = new Rng(2);
  const { a, events } = setPieceScene(
    { selector: SetPieceState.DropToGround }, rng);
  check("the Init writes the selector to +0x130C and leaves +0x1310 alone",
        a.selector === SetPieceState.DropToGround && a.state === 0,
        `selector ${a.selector} state ${a.state}`);

  // `+0x1310` is the combat classes' state word; class 0x24 never reads it,
  // so writing it must not change which state routine runs.
  a.state = SetPieceState.Slide;
  frame(a, events, rng);
  check("and the dispatch ignores +0x1310",
        a.sub === 1 && a.vel.x === 0, `sub ${a.sub} vx ${a.vel.x}`);
}

console.log("\nclass 0x24, the hold-then-play count:");
{
  const rng = new Rng(2);
  const HOLD = 4;
  const { a, events } = setPieceScene(
    { selector: SetPieceState.Idle, hold: HOLD, cuePath: 21, motion: 10 },
    rng);
  // The engine compares the counter *before* stepping it, so the swap lands
  // on the frame after the hold has been counted out in full.
  for (let i = 0; i < HOLD; i++) frame(a, events, rng);
  check("the hold runs its full count before the motion swaps",
        a.motion === 10 && a.holdFrames === HOLD,
        `motion ${a.motion} hold ${a.holdFrames}`);
  frame(a, events, rng);
  check("and swaps on the next frame, tail+0x0E being a motion id here",
        a.motion === 21 && a.playTicks === 0,
        `motion ${a.motion}`);
  frame(a, events, rng);
  frame(a, events, rng);
  check("then the entry point is SetPieceStateIdle and it never swaps again",
        a.motion === 21 && a.holdFrames === HOLD + 1,
        `hold ${a.holdFrames}`);
}

console.log("\nclass 0x24, the script-flag removal variant:");
{
  const rng = new Rng(2);
  const { a, events } = setPieceScene({}, rng);
  // Bit 0x2000000 swaps the removal trigger for a script flag.
  a.flags |= 0x2000000;
  G.g_active_cam_path = 7;
  G.g_cam_path_frame = 999;
  frame(a, events, rng);
  check("the camera no longer removes it once the flag bit is set", !a.dead);
  G.g_script_flags[7] = 1;
  frame(a, events, rng);
  check("but the script flag does", a.dead);
}

console.log("\nclass 0x41, the props are in the save state:");
{
  const rng = new Rng(21);
  const events = propScene(rng);
  PlaceBreakableGroup(1, 4, rng);
  const snap = JSON.stringify(G.g_breakable_props);
  check("the prop pool survives JSON.stringify",
        JSON.parse(snap).length === 3);
  check("a prop holds no functions or class instances",
        G.g_breakable_props.every(
          (p) => Object.values(p).every(
            (v) => typeof v !== "function"
                   && (typeof v !== "object" || v === null
                       || Object.getPrototypeOf(v) === Object.prototype))));
  void events;
}
console.log("\nclass 0x41 type 32, the lift:");
{
  const rng = new Rng(41);
  const events = propScene(rng);
  const sounds: number[] = [];
  events.on("sound.play", (e) => sounds.push(e.id));
  const gate = PlaceGenericProp(
    { at: 0xbdc0, container: "generic", type: 32, slot: 2,
      lifetime_evt_steps: 2, pos: [-825.1, 40, -1871.7],
      pitch: 0, yaw: 0, roll: 0 }, rng);
  G.g_breakable_props.push(gate);

  check("it is its own family, not a drawn-only generic prop",
        gate.family === PropFamily.Lift);
  check("and the constructor seeds the three hinges at rest",
        gate.yaw === LIFT_NEAR_CLOSED && gate.hingeB === LIFT_FAR_CLOSED
        && gate.pitch === LIFT_PANEL_CLOSED);
  check("the car it draws is komono_suimon slot 0x197A, not the `slot` 2 "
        + "the descriptor carries", GENERIC_DRAW_SLOT[32] === 0x197a);

  // No flag up: nothing moves. This is the whole point of the routine --
  // every motion waits on the script.
  for (let i = 0; i < 120; i++) LiftUpdate(gate, events);
  check("with no script flag raised nothing moves at all",
        gate.yaw === LIFT_NEAR_CLOSED && gate.hingeB === LIFT_FAR_CLOSED
        && gate.pitch === LIFT_PANEL_CLOSED && gate.y === 40
        && sounds.length === 0);

  // Flag 0x37: the gate rides fifteen under the camera's eye.
  G.g_camera_block_eye.y = 100;
  G.g_script_flags[LiftFlag.RideCamera] = 1;
  LiftUpdate(gate, events);
  check("flag 0x37 hangs the car floor fifteen under the camera eye",
        gate.y === 100 - LIFT_RIDE_DROP, String(gate.y));

  // Flag 0x6B: the near pair swings 0x4000 -> 0x8000 at 0x200 a frame, so 32
  // frames exactly, and the door sound fires on the first of them only.
  G.g_script_flags[LiftFlag.OpenNear] = 1;
  sounds.length = 0;
  LiftUpdate(gate, events);
  check("the leaves' door sound fires on the first frame of the swing",
        sounds.length === 1 && sounds[0] === SFX_LIFT_GATE);
  for (let i = 1; i < 32; i++) LiftUpdate(gate, events);
  check("32 frames take the near pair exactly to its open angle",
        gate.yaw === LIFT_NEAR_OPEN, gate.yaw.toString(16));
  for (let i = 0; i < 60; i++) LiftUpdate(gate, events);
  // The engine's test is `< limit + 1`, so the frame that finds the hinge
  // exactly *at* its limit still adds a step: every one of these angles comes
  // to rest one 0x200 past the round number, and then stops.
  check("and it comes to rest one step past that and stays there",
        gate.yaw === LIFT_NEAR_OPEN + LIFT_HINGE_STEP,
        gate.yaw.toString(16));
  check("the door sound does not repeat",
        sounds.filter((x) => x === SFX_LIFT_GATE).length === 1);

  // The panel is not on a flag of its own: it waits on the frames flag 0x6B
  // has been up, which is `obj+0x2A0`.
  check("the overhead panel swung once the near pair had been folding for "
        + "0x27 frames", gate.pitch === LIFT_PANEL_OPEN + LIFT_HINGE_STEP,
        gate.pitch.toString(16));
  check("its own sound fired once", sounds.filter(
    (x) => x === SFX_LIFT_PANEL).length === 1);
  check("and 0x2A0 counted every frame the flag was up, not just the moving "
        + "ones", gate.storyItem === 1 + 31 + 60);

  // Flag 0x6C is independent: the far pair has not moved yet.
  check("the far pair has not moved -- its flag is still down",
        gate.hingeB === LIFT_FAR_CLOSED);
  G.g_script_flags[LiftFlag.OpenFar] = 1;
  LiftUpdate(gate, events);
  check("and it starts from 0x8000 the moment flag 0x6C goes up",
        gate.hingeB === LIFT_FAR_CLOSED + LIFT_HINGE_STEP);

  // The lifetime prologue still runs: three step changes, and it is gone.
  for (let b = 1; b <= 3; b++) {
    G.g_evt_step_index = b;
    LiftUpdate(gate, events);
  }
  check("and it expires on its two-step lifetime like any other prop",
        gate.dead);
  void LIFT_PANEL_DELAY;
}

console.log("\nclass 0x41, a generic prop's +0x11C is a lifetime:");
{
  const rng = new Rng(43);
  const events = propScene(rng);
  // The stage-2 shape: `hp` 1, which is a lifetime of one event *step* and
  // NOT asset slot 1 (`bg_adv10.bin`).
  const p = PlaceGenericProp(
    { at: 0xbe00, container: "generic", type: 20, slot: 1,
      lifetime_evt_steps: 1, pos: [0, 0, 0], pitch: 0, yaw: 0, roll: 0 },
    rng);
  G.g_breakable_props.push(p);
  check("the lifetime is the descriptor's +0x11C", p.lifetime === 1);
  check("and the model is the literal its routine draws, not that number",
        GENERIC_DRAW_SLOT[20] === 0x1e2);
  for (let i = 0; i < 600; i++) PropExpireByStepLifetime(p);
  check("frames alone do not expire it", !p.dead);
  for (let b = 1; b <= 2; b++) {
    G.g_evt_step_index = b;
    PropExpireByStepLifetime(p);
  }
  check("two step advances past a lifetime of one do", p.dead);

  // The bug this replaced, stated so it cannot come back: the counter is the
  // step index, so a prop ages *inside* a block as well as across one. When
  // it was a monotonic per-block counter every prop lived about four times
  // too long -- blocks average 3.99 steps.
  G.g_evt_step_index = 1;                  // placed in block N's first step
  const r = PlaceGenericProp(
    { at: 0xbe80, container: "generic", type: 20, slot: 1,
      lifetime_evt_steps: 1, pos: [0, 0, 0], pitch: 0, yaw: 0, roll: 0 },
    rng);
  PropExpireByStepLifetime(r);
  check("a prop placed in step 1 survives its own step", !r.dead);
  G.g_evt_step_index = 2;                  // still block N, second step
  PropExpireByStepLifetime(r);
  check("...and its lifetime of one carries it one step further", !r.dead);
  G.g_evt_step_index = 3;                  // still block N, third step
  PropExpireByStepLifetime(r);
  check("...but it is gone by step 3, without the block ever changing",
        r.dead);

  // The scene-1 sweep.
  const q = PlaceGenericProp(
    { at: 0xbe40, container: "generic", type: 20, slot: 9,
      lifetime_evt_steps: 9, pos: [0, 0, 0], pitch: 0, yaw: 0, roll: 0 },
    rng);
  G.g_scene_index = 1;
  G.g_script_flags[0x77] = 1;
  PropExpireByStepLifetime(q);
  check("g_script_flags[0x77] clears every prop on scene 1", q.dead);
  G.g_scene_index = 0;
  G.g_script_flags[0x77] = 0;
  void events;
}

console.log("\nclass 0x41, Original Mode's collectibles in Arcade:");
{
  const rng = new Rng(47);
  const events = propScene(rng);
  // `FUN_004675A0`'s first line is `if (g_GameMode != 1) ActorDespawn(obj)`.
  const p = PlaceGenericProp(
    { at: 0xbf00, container: "generic", type: 70, slot: 3,
      lifetime_evt_steps: 3, pos: [0, 0, 0], pitch: 0, yaw: 0, roll: 0 },
    rng);
  G.g_breakable_props.push(p);
  G.g_GameMode = GameMode.Arcade;
  BreakablePropPoolUpdate(rng, events);
  check("an Original-Mode-only type is gone on its first Arcade frame",
        G.g_breakable_props.length === 0);

  const q = PlaceGenericProp(
    { at: 0xbf40, container: "generic", type: 70, slot: 3,
      lifetime_evt_steps: 3, pos: [0, 0, 0], pitch: 0, yaw: 0, roll: 0 },
    rng);
  G.g_breakable_props.push(q);
  G.g_GameMode = GameMode.Original;
  BreakablePropPoolUpdate(rng, events);
  check("and survives in Original Mode", !q.dead);
  check("the set is the four routines that were actually read",
        [...GENERIC_ORIGINAL_MODE_ONLY].sort((a, b) => a - b)
          .join(",") === "70,71,72,77");
  G.g_GameMode = GameMode.Arcade;
}

console.log("\nclass 0x41 type 4, seven of the eleven kinds are effects:");
{
  // `PlaceKindedProp` (`FUN_00462E10`) writes `obj+0x28C = 0xFFFF` and then
  // overrides it for exactly four kinds. The other seven draw
  // `FUN_0040DD90(obj+0x324)` instead — an animated effect, not a model —
  // which is why their spawn markers have nothing under them and why that is
  // the engine's behaviour rather than a missing export.
  check("only kinds 2, 3, 8 and 9 name an asset slot",
        Object.keys(KIND_SLOT).map(Number).sort((a, b) => a - b)
          .join(",") === "2,3,8,9");
  check("and every other kind is left at the engine's 0xFFFF",
        [0, 1, 4, 5, 6, 7, 10].every((k) => (KIND_SLOT[k] ?? SLOT_NONE)
                                            === SLOT_NONE));
}

console.log("\nclass 0x41, Arcade's one-shot targets:");
{
  const rng = new Rng(53);
  const events = propScene(rng, GameMode.Arcade);
  G.g_prop_target_set = 0;      // members 2, 3, 4 and 6
  const props = PlaceBreakableGroup(1, 4, rng);
  const target = props.find((p) => p.member === 2);
  const plain = props.find((p) => p.member === 0);
  check("the member the target set names takes one shot, not two",
        !!target && target.hp === 1, `hp ${target?.hp}`);
  check("and wears the one-shot model",
        target?.slot === BreakableSlot.OneShotTarget,
        `0x${target?.slot.toString(16)}`);
  check("the members it does not name are ordinary",
        !!plain && plain.hp === 2 && plain.slot === BreakableSlot.Default);

  const before = G.g_player_score[0];
  shoot(target!, 1, rng, events);
  // Note what it does *not* do: `hp` is still 1. A one-shot target is removed
  // outright rather than damaged, so nothing decrements the shot count.
  check("one shot removes it, without spending its hit point",
        target!.state === BreakableState.Removed && target!.hp === 1,
        `hp ${target!.hp} state ${target!.state}`);
  check("and it pays no score", G.g_player_score[0] === before,
        `${G.g_player_score[0]} vs ${before}`);
}


// -- 12. class 0x31, the wall-crawler ---------------------------------------

/**
 * `zstin`'s own tables, cut down to the rows the states read. The numbers are
 * the game's: the arc scripts and hit frames are `g_class31_melee_attacks`
 * row A verbatim, the picks are `g_class31_action_picks` set 0, and 313 is the
 * walk clip whose root motion is the only thing that closes the distance.
 */
const ARC = (motionId: number) => [
  { motion: motionId, start: 0, fade: 5, until: 22 },
  { motion: motionId, start: 23, fade: 5, until: 46 },
  { motion: motionId, start: 47, fade: 0, until: 47 },
];

const TYPE31: CharacterType = {
  ...TYPE,
  type: 0x19, name: "zstin", file: "zstin.bin",
  motions: {
    ...TYPE.motions,
    // The walk that closes, the idle that does not, the landing clip, and one
    // clip per attack and per surface leap.
    "313": motion(13, 2.08), "295": motion(31), "283": motion(16),
    "303": motion(34), "302": motion(36), "284": motion(25),
    "298": motion(30), "299": motion(30),
    "290": motion(23), "291": motion(23), "309": motion(46), "282": motion(41),
    // The reaction row, the airborne clip, the get-up and the death clip.
    "929": motion(20), "930": motion(20), "931": motion(20), "934": motion(50),
    "935": motion(20), "938": motion(20), "939": motion(20),
    "283b": motion(1), "285": motion(50), "287": motion(29),
  },
};

const CLASS31 = {
  sets: [{
    set: 0,
    motions: [295, 295, 313, 313, 283, 934],
    attacks: {
      // Stance 0, the ground: two hands and a head-butt.
      "0": {
        "0": { script: ARC(303), hit_frame: 62, player_motion: 2, cancel_mask: 2 },
        "1": { script: ARC(302), hit_frame: 64, player_motion: 3, cancel_mask: 4 },
        "3": { script: ARC(284), hit_frame: 41, player_motion: 7, cancel_mask: 8 },
      },
      // Stance 1 and 2, the two walls -- a different swing on each.
      "1": {
        "0": { script: ARC(299), hit_frame: 52, player_motion: 2, cancel_mask: 2 },
      },
      "2": {
        "0": { script: ARC(298), hit_frame: 52, player_motion: 2, cancel_mask: 2 },
      },
    },
    // Intact: a coin flip between the two hands.
    attack_picks: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, ...new Array(70).fill(0)],
    state_picks: {
      // Band 1 is the climb, band 2 stands and occasionally pounces.
      "1": [14, 14, 14, 15, 15, 15, 16, 16, 16, 12, ...new Array(70).fill(14)],
      "2": [7, 7, 7, 7, 7, 7, 7, 7, 7, 13, ...new Array(70).fill(7)],
    },
    // `g_class31_hit_reactions` row A, the `szom.bin` one sets 0, 1 and 3 share.
    reactions: [0x3a7, 0x3a3, 0x3a7, 0x3aa, 0x3ab, 0x3a7, 0x3a2, 0x3a1],
  }],
  // The pose a corpse freezes on, by the clip it died in.
  corpse_frames: { "286": [74, 70], "285": [48, 40], "934": [44, 35] },
  scripts: {
    wall_left: ARC(290), wall_right: ARC(291), ceiling: ARC(309),
    aside: ARC(282), aside_attack3: ARC(282), aside_zsass: ARC(282),
  },
};

const CHARS31 = {
  ...CHARS,
  types: { "1": TYPE, "25": TYPE31 },
  class31: CLASS31,
} as unknown as CharactersJson;

/**
 * A camera at `EYE` looking toward **+Z**, which is where this file's actors
 * stand. `viewPoint` takes a point in camera space, where -Z is forward, so
 * the z term is negated on the way out.
 */
/**
 * A camera at `EYE` looking down **+z in world**, which is where this file
 * stands its actors.
 *
 * `viewSpaceOf` is the exact inverse of `viewPoint`, and it has to be: the
 * knockback arc reads one and writes through the other, so a stub answering
 * only half of the seam tested the formula against nothing. Both are in the
 * engine's own sign, `-z` in front, and neither has an opinion about an actor
 * behind the camera. See `game/host.ts`.
 */
const CAM_HOST = {
  ...NULL_HOST,
  viewPoint: (x: number, y: number, z: number, out: Vec3) => {
    out.x = EYE.x + x; out.y = EYE.y + y; out.z = EYE.z - z;
  },
  viewSpaceOf: (at: number, out: Vec3) => {
    const a = ActorByAt(at);
    if (!a) return false;
    // The tracked point when the renderer has filled one, the origin
    // otherwise — `lookAtOf`'s own fallback.
    const p = (a.lookAt.x || a.lookAt.y || a.lookAt.z) ? a.lookAt : a.pos;
    out.x = p.x - EYE.x;
    out.y = p.y - EYE.y;
    out.z = EYE.z - p.z;                  // `-z` in front, as the engine has it
    return true;
  },
};

/**
 * One `coli/` quad, as a blob the port's own collision can be pointed at.
 *
 * The wall search used to be answered by a stub host that said "yes, there,"
 * which tested the state machine and nothing else. This is a real quad in the
 * real format, so the assertions below go through `ColiSegmentVsMesh`'s plane
 * test, its dominant-axis projection and its winding test — the same code the
 * shipped collision runs.
 */
function coliQuad(plane: [number, number, number, number], axis: number,
                  verts: number[], surface = 52) {
  const xs = [verts[0], verts[3], verts[6], verts[9]];
  const ys = [verts[1], verts[4], verts[7], verts[10]];
  const zs = [verts[2], verts[5], verts[8], verts[11]];
  return {
    min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
    max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)],
    n: 1, plane, verts, axis: [axis], surface: [surface],
  };
}

/** A wall in the plane `x = 30`, forty units tall and eighty deep. */
const WALL_BLOB = coliQuad([-1, 0, 0, 30], 0,
                           [30, -10, 5, 30, -10, 85, 30, 40, 85, 30, 40, 5]);
/**
 * ...and a floor at `y = 0`, which is where this file's actors stand.
 *
 * **Wound the way the game's own floors are**, which is clockwise seen from
 * above: `coli2.bin:13864` quad 0, under stage 2's spawn at
 * (-742, 40.1, -1725), runs `+x, -z, -x, +z`. It matters because the winding
 * test's sign factor is the dominant normal component *negated on Y*, so a
 * floor authored the other way round is rejected. These fixtures were wound
 * counter-clockwise while `coli.ts` had one global polarity and both were
 * wrong together -- the game's data is the arbiter, not the fixture.
 */
const FLOOR_BLOB = coliQuad([0, 1, 0, 0], 1,
                            [-200, 0, 200, 200, 0, 200, 200, 0, -200,
                             -200, 0, -200]);

function thrower(state: number, extra: Record<string, unknown> = {}) {
  ResetGameGlobals();
  SetGameTables(CHARS31);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_player_lives = [PLAYER.start_lives, PLAYER.start_lives];
  // `g_camera_yaw_bams` is the heading *from* the camera *toward* what it
  // looks at -- `ThrowerStateLeapDown` sets the pouncing actor's own yaw from
  // it, and an actor facing the camera carries `VecToAngles(obj - eye)`. This
  // file's actors stand at +Z of an eye at the origin, so that heading is 0.
  G.g_camera_yaw_bams = 0;
  const a = ActorSpawn(0x9000, SpawnClass.Thrower, 0x19, "zstin", {
    initialState: state, condition: 0, ...extra,
  });
  a.visible = true;
  a.hp = 100;
  a.motion = 936;
  a.pos = vec3(0, 0, 80);
  a.yaw = 0;
  return a;
}

console.log("class 0x31, ThrowerStateWalkDistance:");
{
  const rng = new Rng(11);
  const events = new Events();
  const z = thrower(ThrowerState.WalkDistance, { walkDistance: 15 });
  const start = { ...z.pos };
  check("it starts in the entrance the descriptor names",
        z.state === ThrowerState.WalkDistance, `state ${z.state}`);
  let walked = 0;
  for (let i = 0; i < 600 && z.state === ThrowerState.WalkDistance; i++) {
    GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
    walked = Math.hypot(z.pos.x - start.x, z.pos.z - start.z);
  }
  // It stops on the frame it passes the distance, so it may overshoot by one
  // frame of the walk -- 2.08 units -- and no more.
  check("and stops within a frame of the fifteen units it names",
        walked >= 15 && walked < 15 + 2.2, `${walked.toFixed(2)}`);
  check("then it stands and decides",
        z.state === ThrowerState.StandAndDecide, `state ${z.state}`);
}

console.log("class 0x31, the climb:");
{
  const rng = new Rng(3);
  const events = new Events();
  const z = thrower(ThrowerState.StandAndDecide);
  // Band 1 is 40 < d <= 50, and the pick table there is nine parts climb.
  z.pos = vec3(0, 0, 45);
  z.yaw = 0;                             // facing the camera, which the gate needs

  // With no collision the search fails, and the engine's answer to that is to
  // refuse the state -- not to leap at nothing. It still pounces, because one
  // slot in ten of band 1's picks is the pounce and that needs no wall.
  T.coli = null;
  G.g_coli_full_set = [];
  let climbed = false;
  for (let i = 0; i < 300; i++) {
    GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
    if (z.state === ThrowerState.LeapToWallA
        || z.state === ThrowerState.LeapToWallB
        || z.state === ThrowerState.LeapToCeiling) climbed = true;
  }
  check("with nothing to climb it never enters a surface leap", !climbed,
        `state ${z.state}`);
  check("...and its stance is still the ground", z.stance === 0
        && (z.flags2 & 0x1c0) === 0, `flags2 ${z.flags2.toString(16)}`);
  z.state = ThrowerState.StandAndDecide;
  z.sub = 0;
  z.flags2 = 0;
  z.pos = vec3(0, 0, 45);

  // Now give the level a wall in the plane x = 30 — a real quad, tested by the
  // real intersector — and the same search finds it.
  T.coli = { files: ["test"], blobs: { wall: WALL_BLOB, floor: FLOOR_BLOB } };
  G.g_coli_full_set = ["wall", "floor"];
  let sawLeap = false;
  for (let i = 0; i < 900; i++) {
    GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
    if (z.state === ThrowerState.LeapToWallA
        || z.state === ThrowerState.LeapToWallB
        || z.state === ThrowerState.LeapToCeiling) sawLeap = true;
    if ((z.flags2 & 0x1c0) !== 0) break;
  }
  check("given a wall it leaps at it", sawLeap, `state ${z.state}`);
  check("and arriving changes its stance off the ground",
        (z.flags2 & 0x1c0) !== 0 && (z.flags2 & 0x20) !== 0
        && ThrowerStanceOf(z) > 0,
        `flags2 0x${z.flags2.toString(16)} stance ${ThrowerStanceOf(z)}`);
  check("...and left it up on the wall", z.pos.y > 5,
        `y ${z.pos.y.toFixed(1)}`);
}

console.log("class 0x31, the pounce and the leap back:");
{
  const rng = new Rng(5);
  const events = new Events();
  let hits = 0;
  let hitMotion = -1;
  events.on("player.damaged", () => { hits++; hitMotion = G.g_player_hit_motion[0]; });
  const z = thrower(ThrowerState.StandAndDecide);
  z.pos = vec3(0, 0, 25);                // inside 30: the router goes straight to 8

  GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
  check("inside thirty units it stops deciding and waits for a permit",
        z.state === ThrowerState.WaitForPermit, `state ${z.state}`);

  let sawPounce = false;
  let closest = Infinity;
  let sawAside = false;
  for (let i = 0; i < 900; i++) {
    GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
    if (z.state === ThrowerState.Pounce) sawPounce = true;
    if (z.state === ThrowerState.LeapAside) sawAside = true;
    closest = Math.min(closest, dist2d(z.pos, EYE));
  }
  check("it takes the permit and pounces", sawPounce, `state ${z.state}`);
  // `ThrowerPickLandingPoint` puts it 15.5 in front of the camera, which is
  // the whole reason the stab connects without any range test.
  check("the leap puts it on the landing point, not at a range it chose",
        Math.abs(closest - 15.5) < 0.6, `closest ${closest.toFixed(2)}`);
  check("and the stab lands", hits > 0, `${hits} hits`);
  // Attack 0's `player_motion` is 2, attack 1's is 3: whichever it drew, the
  // reaction is the attack entry's, not a constant.
  check("with the reaction the attack entry names",
        hitMotion === 2 || hitMotion === 3, `motion ${hitMotion}`);
  check("then it leaps back out", sawAside, `state ${z.state}`);
  check("and the permit is free again for the next one",
        G.g_attack_permits.filter((p) => p !== -1).length <= 1,
        `${G.g_attack_permits.join()}`);
}

console.log("class 0x31, ThrowerStrikeConnect tests no range:");
{
  const rng = new Rng(9);
  const events = new Events();
  void rng;
  let hits = 0;
  events.on("player.damaged", () => hits++);
  const z = thrower(ThrowerState.StandAndDecide);
  z.pos = vec3(0, 0, 400);              // nowhere near the camera
  z.attackPermit = 0;
  G.g_attack_permits[0] = z.at;
  z.attack = 0;
  z.stance = 0;
  z.action = { motion: 303, ticks: 62, loop: false };
  check("a swing on its hit frame connects from four hundred units away",
        ThrowerStrikeConnect(z, events) && hits === 1, `${hits} hits`);
  // ...and the cancel mask is the only thing that stops it.
  z.flags2 = 0;
  z.zones = 2;                          // attack 0 names zone 2, the right arm
  z.action = { motion: 303, ticks: 62, loop: false };
  G.g_player_invuln_frames = 0;
  const before = hits;
  ThrowerStrikeConnect(z, events);
  check("but an attack whose zone has been shot off whiffs", hits === before,
        `${hits} vs ${before}`);
}


// -- 13. class 0x31's own damage and death ----------------------------------

console.log("class 0x31, the stumble and the death chain:");
{
  const rng = new Rng(21);
  const events = new Events();
  const z = thrower(ThrowerState.StandAndDecide);
  z.pos = vec3(0, 0, 45);
  z.hp = 100;

  // `ResolveHit` hands class 0x31 a *pending hit* instead of the shared
  // stagger and the shared directional death: the class picks its own.
  ResolveHit(z, 4, 0, CAM_HOST, rng);
  check("a shot leaves a pending hit rather than a stumble clip",
        !!z.pendingHit && z.react === null, `${JSON.stringify(z.pendingHit)}`);
  GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
  check("...which the next tick turns into its own state",
        z.state === ThrowerState.HitReaction
        || z.state === ThrowerState.FallAndLand, `state ${z.state}`);
  check("and the pending hit is drained", z.pendingHit === null);

  // Now kill it, and watch the whole chain rather than a death clip.
  z.state = ThrowerState.StandAndDecide;
  z.sub = 0;
  z.flags = 0;
  z.flags2 = 0;
  z.hp = 1;
  ResolveHit(z, 1, 0, CAM_HOST, rng);
  check("the kill sets no directional death clip", z.death === null,
        `${JSON.stringify(z.death)}`);
  GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
  check("it falls instead", z.state === ThrowerState.FallAndLand,
        `state ${z.state}`);

  const seen = new Set<number>();
  for (let i = 0; i < 1200 && z.visible; i++) {
    GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
    seen.add(z.state);
  }
  check("the fall becomes a corpse", seen.has(ThrowerState.Corpse),
        [...seen].join());
  check("and the corpse despawns rather than lying there for ever",
        !z.visible && z.dead, `visible ${z.visible}`);
}

console.log("class 0x31, being knocked down is survivable:");
{
  const rng = new Rng(31);
  const events = new Events();
  const z = thrower(ThrowerState.StandAndDecide);
  z.pos = vec3(0, 0, 45);
  z.hp = 100;
  // A body shot on an actor that is *not* in the hub falls rather than
  // stumbles, and a fall it survives ends back at the hub.
  z.state = ThrowerState.LeapAside;
  z.sub = 0;
  ResolveHit(z, 1, 0, CAM_HOST, rng);
  GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
  check("a shot outside the hub knocks it over",
        z.state === ThrowerState.FallAndLand, `state ${z.state}`);
  let recovered = false;
  for (let i = 0; i < 900; i++) {
    GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
    if (z.state === ThrowerState.StandAndDecide) { recovered = true; break; }
  }
  check("and it gets back up", recovered && !z.dead, `state ${z.state}`);
  check("with its hit points intact", z.hp > 0, `hp ${z.hp}`);
}

console.log("class 0x31, the scripted entrances:");
{
  const rng = new Rng(41);
  const events = new Events();
  // Stage 6's `zslman` blink in: three hops from 90 units out, 30 apart.
  const z = thrower(ThrowerState.BlinkIn, { backAwayDelay: 0, attackState: 7 });
  z.pos = vec3(0, 0, 45);
  z.yaw = 0;
  const origin = { ...z.pos };
  check("it starts in the entrance", z.state === ThrowerState.BlinkIn,
        `state ${z.state}`);
  const hops: number[] = [];
  for (let i = 0; i < 300 && z.state === ThrowerState.BlinkIn; i++) {
    GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
    const d = Math.round(Math.hypot(z.pos.x - origin.x, z.pos.z - origin.z));
    if (hops[hops.length - 1] !== d) hops.push(d);
  }
  // With a delay of 0 the first hop lands on the entry frame itself, so the
  // origin never shows up in the trace.
  check("three hops, at 90, 60 and 30 units from where it appeared",
        hops.join() === "90,60,30", hops.join());
  check("then it hands to the state its descriptor names",
        z.state === ThrowerState.StandAndDecide, `state ${z.state}`);
}

console.log("class 0x31, ThrowerStateWaitForCue:");
{
  const rng = new Rng(51);
  const events = new Events();
  // The training stage's six: hold a clip until the camera path reaches a
  // frame, then become state 7.
  const z = thrower(ThrowerState.WaitForCue, {
    cue: { motion: 295, cond: 1, operand: 140 }, attackState: 7,
  });
  G.g_cam_path_frame = 0;
  for (let i = 0; i < 120; i++) GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
  check("it waits while the camera is short of the cue frame",
        z.state === ThrowerState.WaitForCue, `state ${z.state}`);
  G.g_cam_path_frame = 140;
  GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
  check("and goes the moment the camera reaches it",
        z.state === ThrowerState.StandAndDecide, `state ${z.state}`);
}


console.log("class 0x31, ThrowerStateGrabPlayer's sound cues:");
{
  const rng = new Rng(61);
  const events = new Events();
  const heard: number[] = [];
  events.on("sound.play", (e: { id: number }) => heard.push(e.id));
  // Stage 5's four `zslman`: ride the camera, drop on a cue, hold, grab.
  const z = thrower(ThrowerState.GrabPlayer, {
    attackState: 7,
    grab: {
      offset: [0, -40, 0], cue_frame: 20, drop_frames: 10, hold_frames: 25,
      player: 0,
    },
  });
  z.pos = vec3(0, 60, 0);
  G.g_cam_path_frame = 0;
  for (let i = 0; i < 5; i++) GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
  check("no sound while it hangs off the camera waiting for the cue",
        heard.length === 0, heard.map((h) => h.toString(16)).join());
  G.g_cam_path_frame = 20;
  GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
  check("the cue frame plays one step -- COMMON\\ENE_WALK2_11",
        heard.join() === String(0x2516a9), heard.map((h) => h.toString(16)).join());
  for (let i = 0; i < 10; i++) GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
  check("landing plays the thump, then ignites the looping laser sword",
        heard.join() === [0x2516a9, 0x2916a9, 0x1f23a9].join(),
        heard.map((h) => h.toString(16)).join());
  // It blinks for the *first* fifteen frames of the hold and is solid for the
  // rest, and the `_OFF` stopper sits in the `else` arm of that per-frame
  // branch with no edge test -- so with a 25-frame hold it fires ten times.
  for (let i = 0; i < 25; i++) GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
  const offs = heard.filter((h) => h === 0x2023a9).length;
  check("...and the `_OFF` stopper fires on each of the 10 non-blinking frames",
        offs === 10, `${offs}`);

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
    SetGameTables(CHARS);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    const z = ActorSpawn(0x1000, SpawnClass.Zombie, ct, "zom",
                         { initialState: initial });
    check(`a zombie with ${what} is not in the counts`,
          G.g_enemies_alive === 0 && G.g_enemies_present === 0,
          `alive ${G.g_enemies_alive}, present ${G.g_enemies_present}`);
    ActorDespawn(z);
    GameUpdate(EYE, 1 / 60, NULL_HOST, new Rng(1));
    check(`...and retiring it does not take them below zero`,
          G.g_enemies_alive === 0 && G.g_enemies_present === 0,
          `alive ${G.g_enemies_alive}, present ${G.g_enemies_present}`);
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
  // Nothing caught it because `verify_port.py` keyed its ports by *name*, and
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
    GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
  }
  check("the throw-away ends in a despawn, not a body left standing",
        z.despawned, `state ${z.state} sub ${z.sub}`);
  check("...and it leaves both counts, so the next wait can open",
        G.g_enemies_alive === 0 && G.g_enemies_present === 0,
        `alive ${G.g_enemies_alive}, present ${G.g_enemies_present}`);
  check("...and gives the attack permit back",
        G.g_attack_permits.every((x) => x === -1), G.g_attack_permits.join());
  check("...and drops out of the camera's enemy slots",
        !G.g_enemy_slots.includes(z.at), G.g_enemy_slots.join());
}

// -- 14. the collision, against real quads -----------------------------------

console.log("coli/, the game's own collision:");
{
  ResetGameGlobals();
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
      const k = ActorSpawn(at, SpawnClass.Zombie, 1, "captor");
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
    CivilianUpdate(a, { eye: EYE, dt: 1 / 60, rng, host: NULL_HOST, events });
  const cmd = (op: CivilianOp, ...args: number[]): CivilianCmdJson =>
    ({ op, args });
  const cmdKill = (scripts: number[], ...args: number[]): CivilianCmdJson =>
    ({ op: CivilianOp.SetOnShot, args, scripts });

  // The VM runs a whole block in one go and parks on the next wait. A wait
  // word leads its block and governs the wait that *follows* it, which is why
  // a stream opens with one.
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetTurnRate, 77),
      cmd(CivilianOp.SetCiviliansGoal, 3),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetTurnRate, 88),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]]);
    check("the Init runs a whole block and parks on the next wait",
          a.civ?.cursor === 3 && a.civ?.turnRate === 77
          && a.civ?.civiliansGoal === 3,
          `cursor ${a.civ?.cursor} rate ${a.civ?.turnRate}`);
    for (let i = 0; i < 20; i++) cFrame(a, events);
    check("...and a wait word with no bits and no timer never resumes",
          a.civ?.turnRate === 77 && a.civ?.cursor === 3,
          `rate ${a.civ?.turnRate} cursor ${a.civ?.cursor}`);
  }

  // Wait bit 0x2000 reads `g_script_flags`, and a flag the script has never
  // set is *absent* from the array — which is a hole an undefined slips
  // straight through if the read is not defaulted.
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, CivilianWait.ScriptFlag),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetTurnRate, 77),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]]);
    for (let i = 0; i < 5; i++) cFrame(a, events);
    check("an unset script flag holds the wait rather than passing it",
          a.civ?.turnRate === 10, `rate ${a.civ?.turnRate}`);
    G.g_script_flags[0] = 1;
    cFrame(a, events);
    check("...and raising it lets the block run",
          a.civ?.turnRate === 77, `rate ${a.civ?.turnRate}`);
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
      cmd(CivilianOp.SetTurnRate, 77),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]]);
    cFrame(a, events);
    check("the timer's own block runs at once and parks with it armed",
          a.civ?.timer === 3 && a.civ?.cursor === 3 && a.civ?.turnRate === 10,
          `timer ${a.civ?.timer} cursor ${a.civ?.cursor}`);
    for (let i = 0; i < 3; i++) cFrame(a, events);
    check("a timer holds the next block for the frames it names",
          a.civ?.turnRate === 10, `rate ${a.civ?.turnRate}`);
    cFrame(a, events);
    check("...and releases it on the frame it reads zero",
          a.civ?.turnRate === 77, `rate ${a.civ?.turnRate}`);
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
    events.on("civilian.rescued", () => { paid += 1; });
    check("the civilian starts holding both its captors",
          a.civ?.childCount === 2, `${a.civ?.childCount}`);
    for (let i = 0; i < 5; i++) cFrame(a, events);
    check("...and the rescue does not pay while either is alive",
          G.g_player_score[0] === 0 && paid === 0,
          `score ${G.g_player_score[0]}`);
    kids[0].dead = true;
    cFrame(a, events);
    check("one captor down is not enough",
          a.civ?.childCount === 1 && G.g_player_score[0] === 0,
          `left ${a.civ?.childCount} score ${G.g_player_score[0]}`);
    kids[1].dead = true;
    cFrame(a, events);
    check("the last captor down pays 400 -- to both players, since the port "
          + "cannot name a shooter",
          paid === 1 && G.g_player_score[0] === 400
          && G.g_player_score[1] === 400,
          `paid ${paid} ${G.g_player_score.join("/")}`);
  }

  // Shooting one. `SetOnShot` is the gate: without it the hit bits are simply
  // cleared and the civilian cannot be hurt at all.
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, 0), cmd(CivilianOp.End),
    ]]);
    G.g_player_lives = [2, 2];
    a.flags |= 8;
    cFrame(a, events);
    check("a civilian with no on-shot script cannot be shot",
          G.g_player_lives[0] === 2 && G.g_player_score[0] === 0 && !a.dead,
          `lives ${G.g_player_lives[0]} score ${G.g_player_score[0]}`);
  }
  {
    // The exporter resolves op 0x0E's pointer to a stream index, so the
    // fixture carries `scripts` the same way.
    const { a, events } = civScene([
      [cmd(CivilianOp.Wait, CivilianWait.Free),
       { op: CivilianOp.SetOnShot, args: [1], scripts: [1] },
       cmd(CivilianOp.Wait, 0), cmd(CivilianOp.End)],
      [cmd(CivilianOp.Wait, 0), cmd(CivilianOp.SetTurnRate, 55),
       cmd(CivilianOp.Wait, 0), cmd(CivilianOp.End)],
    ]);
    G.g_player_lives = [2, 2];
    G.g_player_score = [0, 0];
    let shot = 0;
    events.on("civilian.shot", () => { shot += 1; });
    a.flags |= 8 | 2;                       // hit, and bit 1 names player 0
    cFrame(a, events);
    // -200, not -100: `PlayerTakeDamage` charges its own 100 for the life and
    // `CivilianUpdate` charges another for the civilian. That is what
    // "-100 twice" in docs/formats/spawns.md is.
    check("shooting a civilian costs a life and 100 points twice",
          shot === 1 && G.g_player_lives[0] === 1
          && G.g_player_score[0] === -200,
          `lives ${G.g_player_lives[0]} score ${G.g_player_score[0]}`);
    check("...and switches it to the on-shot script",
          a.civ?.turnRate === 55 && a.dead, `rate ${a.civ?.turnRate}`);
  }
  {
    const { a, events } = civScene([
      [cmd(CivilianOp.Wait, CivilianWait.Free),
       { op: CivilianOp.SetOnShot, args: [1], scripts: [1] },
       cmd(CivilianOp.Wait, 0), cmd(CivilianOp.End)],
      [cmd(CivilianOp.Wait, 0), cmd(CivilianOp.End)],
    ]);
    G.g_player_lives = [2, 2];
    G.g_player_score = [0, 0];
    a.flags |= ActorFlag.Dead;              // a killing shot
    cFrame(a, events);
    check("a killing shot charges 100 to BOTH players and no life",
          G.g_player_score[0] === -100 && G.g_player_score[1] === -100
          && G.g_player_lives[0] === 2,
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
                                                    number]) },
      { bone: 5, slot: 0x1001, kind: -1, rot: [0, 0, 0],
        sets: Array.from({ length: 6 },
                         (_, i) => [i, 0, 0, 1] as [number, number, number,
                                                    number]) },
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
          a.civ?.items[1] === 0, `${a.civ?.items[1]}`);
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

  // `sub+0x82`: one record, six attach sets, chosen by the character type.
  {
    check("the attach set comes from the character type",
          CivilianAttachSet(0x20) === 0 && CivilianAttachSet(0x24) === 4
          && CivilianAttachSet(0x26) === 1 && CivilianAttachSet(0x27) === 2
          && CivilianAttachSet(0x2e) === 3 && CivilianAttachSet(0x99) === 5);
  }

  // Op 0x11's skip count, which is what `CivilianReapplyWaitCommand` is for:
  // the skipped block's *conditions* are re-applied and its actions are not.
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, CivilianWait.Free),
      cmd(CivilianOp.SetSkipCount, 1),
      cmd(CivilianOp.Wait, CivilianWait.Free),
      cmd(CivilianOp.SetTurnRate, 66),      // skipped: not a wait condition
      cmd(CivilianOp.SetEnemiesGoal, 5),    // re-applied: it is one
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]]);
    cFrame(a, events);
    check("a skipped block re-applies its wait conditions...",
          a.civ?.enemiesGoal === 5, `goal ${a.civ?.enemiesGoal}`);
    check("...and does not run its actions",
          a.civ?.turnRate !== 66, `rate ${a.civ?.turnRate}`);
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
      cmd(CivilianOp.SetTurnRate, 77),
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
          a.civ?.cursor === before && a.civ?.turnRate !== 77,
          `cursor ${a.civ?.cursor}`);
    // ...and releases the frame it is in front, with no timer involved.
    a.yaw = 0x8000;                              // half a turn: now in front
    cFrame(a, events);
    check("...and releases the frame it comes round, timer or no timer",
          a.civ?.turnRate === 77, `turn ${a.civ?.turnRate}`);
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
      cmd(CivilianOp.SetTurnRate, 55),
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
    while (frames < 3000 && a.civ?.turnRate !== 55) {
      cFrame(a, events);
      frames += 1;
    }
    check("a civilian turns at the engine's cap, not the script's rate",
          a.civ?.turnRate === 55 && frames < 200, `${frames} frames`);
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

    const cleared = ActorKillAll(0, new Rng(2));
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
      ActorKillAll(0, new Rng(4));
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
}

console.log("\nclass 0x30's captor family — the zombies work on the civilian:");
{
  const rng = new Rng(11);

  /** One civilian and one captor, wired the way the exporter wires them. */
  const captorScene = (initial: number, attack: number,
                       target: TargetScriptJson | null,
                       civCmds: CivilianCmdJson[][] = [[
                         { op: CivilianOp.Wait, args: [0] },
                         { op: CivilianOp.End, args: [] },
                       ]],
                       attackScript: TargetScriptJson | null = null) => {
    ResetGameGlobals();
    SetGameTables(CHARS, undefined, undefined, undefined, undefined, {
      entries: [0], scripts: civCmds, items: [],
      spawns: {
        "16384": {
          charType: 1, script: 0, removePath: -1, removeFrame: 0,
          removeDelay: 0,
          children: [{ at: 0x4100, class: 0x30, charType: 1,
                       pos: [0, 0, 0] as [number, number, number],
                       yaw: 0, hp: 1 }],
        },
      },
    });
    const civ = ActorSpawn(0x4000, SpawnClass.Civilian, 1, "civilian");
    civ.visible = true;
    civ.pos = vec3(0, 0, 0);
    const z = ActorSpawn(0x4100, SpawnClass.Zombie, 1, "captor", {
      initialState: initial, attackState: attack,
      script: { target, attack: attackScript }, targetAt: 0x4000,
    }, rng);
    z.visible = true;
    z.pos = vec3(0, 0, 40);
    return { civ, z, events: new Events() };
  };
  const zFrame = (z: ReturnType<typeof ActorSpawn>, events: Events) =>
    EnemyZombieUpdate(z, { eye: EYE, dt: 1 / 60, rng, host: NULL_HOST, events });

  // The bug this family fixes: an unmodelled captor state fell through
  // `ZombieEntryState` to `AttackRun` and the zombie went for the camera.
  {
    const { z } = captorScene(ZombieState.WalkToTarget, 1, null);
    check("a captor starts in its own state, not in AttackRun",
          z.state === ZombieState.WalkToTarget, `state ${z.state}`);
  }

  // **The grab.** `ZombieStateWalkToTarget` raises the civilian's own `Free`
  // wait bit the frame it gets close enough — which is the civilian's cue.
  {
    const script: TargetScriptJson = {
      state: ZombieState.WalkToTarget,
      head: { arrive: 10, loops: 1, motion: 10, frame: 0 },
      entries: [{ motion: 10, frame: 0, loops: 1, mode: 5 }],
    };
    const { civ, z, events } = captorScene(ZombieState.WalkToTarget, 1,
                                           script);
    zFrame(z, events);
    check("...and walks at the civilian rather than the camera",
          z.sub === 2 && z.targetArrive === 10, `sub ${z.sub}`);
    zFrame(z, events);
    check("out of reach it stays in the walk",
          z.state === ZombieState.WalkToTarget
          && !(civ.civ!.wait & CivilianWait.Free), `state ${z.state}`);
    z.pos = vec3(0, 0, 4);                     // inside the arrive radius
    zFrame(z, events);
    check("inside the radius it hands over to the maul...",
          z.state === ZombieState.TargetMotionScript && z.sub === 1,
          `state ${z.state} sub ${z.sub}`);
    check("...and raises the civilian's own `Free` wait bit, which is the grab",
          (civ.civ!.wait & CivilianWait.Free) !== 0,
          `wait ${civ.civ!.wait.toString(16)}`);
  }

  // **The maul.** The cue frame raises `0x4000000` on the civilian — the same
  // bit a killing shot raises, so it costs both players a hundred points.
  {
    const script: TargetScriptJson = {
      state: ZombieState.TargetMotionScript,
      head: {},
      entries: [{ motion: 10, frame: 0, loops: 1, mode: 3 }],
    };
    const { civ, z, events } = captorScene(ZombieState.TargetMotionScript, 1,
                                           script);
    let killed = false;
    events.on("sound.play", () => { killed = true; });
    zFrame(z, events);
    check("the maul opens on the script's first entry",
          z.motion === 10 && z.targetCue === 3 && z.sub === 2,
          `motion ${z.motion} cue ${z.targetCue}`);
    check("and has not touched the civilian yet",
          !(civ.flags & ActorFlag.Dead));
    // Cue 3 in the **play** clock, which ticks at 60 Hz over 30 Hz data — so
    // three sixtieths, not three thirtieths. This fixture encoded the wrong
    // one, and it agreed with a `frameOf` that was also counting in authored
    // frames: two halves of the same mistake, which is why the corpus (three
    // of stage 1's four maul cues never firing) caught it and this did not.
    z.playTicks = 3;
    zFrame(z, events);
    check("on the cue frame it kills the civilian outright",
          (civ.flags & ActorFlag.Dead) !== 0 && killed,
          `flags ${civ.flags.toString(16)}`);
  }

  // **The order.** Class 0x10's op 0x1A writes a state and a countdown into
  // its own block, and `ZombieStateAwaitCivilianOrder` is the captor sitting
  // on it. `0x31` means die.
  {
    const { civ, z, events } = captorScene(
      ZombieState.AwaitCivilianOrder, 1, null,
      [[{ op: CivilianOp.Wait, args: [CivilianWait.Free] },
        { op: CivilianOp.SetChildCue, args: [ZombieState.OrderDie, 2] },
        { op: CivilianOp.Wait, args: [0] },
        { op: CivilianOp.End, args: [] }]]);
    check("the civilian's op 0x1A is an order to its captors, not a spare word",
          civ.civ!.childOrder === ZombieState.OrderDie
          && civ.civ!.childOrderFrames === 2,
          `order ${civ.civ!.childOrder}/${civ.civ!.childOrderFrames}`);
    zFrame(z, events);            // sub 0 -> 1, saves the flags
    zFrame(z, events);            // takes the order
    check("...and the captor obeys it: 0x31 is die",
          z.dead && (z.flags & ActorFlag.Dead) !== 0,
          `dead ${z.dead} state ${z.state}`);
  }

  // The script ends by flipping roles, and only the *attack* script running
  // out sends the actor at the player.
  {
    const { z } = captorScene(ZombieState.WalkToTarget,
                              ZombieState.RetireOffScreen, null);
    ZombieScriptEnded(z);
    check("a finished target script hands over to the attack state",
          z.state === ZombieState.RetireOffScreen, `state ${z.state}`);
    ZombieScriptEnded(z);
    check("...and only a finished attack script sends it at the player",
          z.state === ZombieState.AttackRun, `state ${z.state}`);
  }

  // **The cursor carries which blob it is in, not just how far.** A captor's
  // descriptor has two script blobs and `obj+0x1398` is a *pointer* into one
  // of them; `ZombieScriptForState` (`FUN_0045CA10`) is called only where the
  // engine writes that pointer, never on the steps that read it back.
  //
  // This port kept an index and re-derived the blob from `obj.state` on every
  // read. A captor whose initial state is 35 and whose attack state is 34
  // therefore broke: the walk leaves the cursor in the **attack** blob and
  // hands over to state 35, which is not its attack state, so the next read
  // returned the *target* blob, replayed the approach clip it had already
  // finished, and bounced back to the walk. Stage 3's two `znkage` circled
  // their hostage for ever and her script never left `children-alive`.
  {
    const target: TargetScriptJson = {
      state: ZombieState.TargetMotionScript, head: {},
      entries: [{ motion: 10, frame: 0, loops: 1, mode: -1 }],
    };
    const attack: TargetScriptJson = {
      state: ZombieState.WalkToTarget,
      head: { arrive: 50, loops: 1, motion: 10, frame: 0 },
      entries: [{ motion: 12, frame: 0, loops: 1, mode: 5 }],
    };
    // The shipped shape: start in the maul state, walk as the attack state.
    const { civ, z, events } = captorScene(
      ZombieState.TargetMotionScript, ZombieState.WalkToTarget, target,
      undefined, attack);
    z.pos = vec3(0, 0, 20);                    // already inside `arrive`
    check("it starts on the target blob", z.scriptBlob === 0,
          `blob ${z.scriptBlob}`);

    // Play it out: the target entry ends, the walk takes over, and the walk
    // arrives at once because it is already inside the radius.
    for (let i = 0; i < 400; i++) {
      if (z.state === ZombieState.TargetMotionScript && z.scriptBlob === 1) break;
      // `EnemyZombieUpdate` does not advance the clip -- `GameUpdate` does, and
      // every cue in this family is a play-cursor comparison, so the clock has
      // to run or no entry ever ends.
      ActorAdvanceMotion(z, 1 / 60);
      zFrame(z, events);
    }
    check("...and the walk hands the maul the attack blob, not the target one",
          z.scriptBlob === 1 && z.state === ZombieState.TargetMotionScript,
          `blob ${z.scriptBlob} state ${z.state}`);
    // Sub 1 is the frame that loads the entry the cursor points at, so the
    // clip is only on the actor once it has run.
    ActorAdvanceMotion(z, 1 / 60);
    zFrame(z, events);
    check("...so the clip it plays is the maul's, not the approach's again",
          z.motion === 12, `motion ${z.motion}`);

    // And the maul's cue kills the civilian, which is the whole point of the
    // hand-over: `mode` is the play frame the kill lands on.
    for (let i = 0; i < 400 && !(civ.flags & ActorFlag.Dead); i++) {
      ActorAdvanceMotion(z, 1 / 60);
      zFrame(z, events);
    }
    check("...and its cue frame is what kills the hostage",
          (civ.flags & ActorFlag.Dead) !== 0, `flags 0x${civ.flags.toString(16)}`);
  }

}

console.log("\nclass 0x30's placement: the ground snap and the two entrances:");
{
  const rng = new Rng(21);
  // A floor at y = 0 and nothing else, so the snap has exactly one answer.
  const scene30 = () => {
    ResetGameGlobals();
    SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    T.coli = { files: ["t"], blobs: { floor: FLOOR_BLOB } };
    G.g_coli_full_set = ["floor"];
    G.g_camera_fixed_eye_y = -1e9;     // a miss must not pass as a hit
    const z = ActorSpawn(0x6000, SpawnClass.Zombie, 1, "placed");
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.radius = 10;
    return z;
  };

  // **The bug this fixes.** Nothing in the port ever put a class-0x30 actor on
  // the collision floor: its `y` was whatever the spawn record said, for ever.
  {
    const z = scene30();
    // Three under the floor: the probe starts six units above the actor's own
    // y, so that is what "below" can mean. A water spawn ten units down is out
    // of its reach until the emerge clip has brought it most of the way up —
    // which is the engine's limit too, and why the clip is not decoration.
    z.pos = vec3(0, -3, 0);
    ActorSnapToGroundHeight(z);
    check("an actor below the floor is brought up to it", z.pos.y === 0,
          `y ${z.pos.y}`);
    z.pos = vec3(0, -40, 0);
    ActorSnapToGroundHeight(z);
    check("...but only from within the six-unit probe", z.pos.y === -1e9,
          `y ${z.pos.y}`);
    z.pos = vec3(0, 6, 0);             // a little above it
    ActorSnapToGroundHeight(z);
    check("...and one just above it is stuck to it", z.pos.y === 0,
          `y ${z.pos.y}`);
  }

  // More than ten units of air, and only when the actor may leave the floor,
  // is a fall rather than a snap.
  {
    const z = scene30();
    z.pos = vec3(0, 40, 0);
    z.flags2 &= ~ZombieFlag2.MayFall;
    ActorSnapToGroundHeight(z);
    check("without the fall bit even forty units snaps", z.pos.y === 0,
          `y ${z.pos.y}`);
    z.pos = vec3(0, 40, 0);
    z.flags2 |= ZombieFlag2.MayFall;
    ActorSnapToGroundHeight(z);
    check("with it, the actor falls instead",
          z.state === ZombieState.FallToGround && z.pos.y === 40,
          `state ${z.state} y ${z.pos.y}`);
  }

  // `ZombieStateEmerge`: hold the submerged pose for the descriptor's delay,
  // then play the clip it names. The clip is what the player sees coming out
  // of the water; the snap is what keeps its feet on the bottom.
  {
    const z = scene30();
    z.pos = vec3(0, -5, 0);
    z.emerge = { delay: 30, motion: 12 };
    z.state = ZombieEntryState(ZombieState.Emerge);
    check("state 27 is an entrance, not a synonym for AttackRun",
          z.state === ZombieState.Emerge, `state ${z.state}`);
    EnemyZombieUpdate(z, { eye: EYE, dt: 1 / 60, rng, host: NULL_HOST });
    check("...which holds the submerged pose and freezes the clock",
          z.motion === 0xb9 && z.frozen === 1, `motion ${z.motion}`);
    for (let i = 0; i < 29; i++) {
      EnemyZombieUpdate(z, { eye: EYE, dt: 1 / 60, rng, host: NULL_HOST });
    }
    check("it waits the descriptor's delay out", z.motion === 0xb9,
          `motion ${z.motion}`);
    EnemyZombieUpdate(z, { eye: EYE, dt: 1 / 60, rng, host: NULL_HOST });
    check("and then plays the clip the descriptor names",
          z.motion === 12 && z.frozen === 0, `motion ${z.motion}`);
    // And the snap has it standing on the floor rather than under it.
    check("...on the floor, not five units under it", z.pos.y === 0,
          `y ${z.pos.y}`);
  }

  // `ActorArcBeginFalling` counts its own frames from the gravity, which is
  // the thing that makes state 26 different from every other arc in the port.
  {
    const z = scene30();
    z.pos = vec3(0, 40, 0);
    ActorArcBeginFalling(z, [30, 0, 0], 0.04);
    check("the delayed leap's frame count comes from the drop and the gravity",
          z.holdFrames > 40 && z.holdFrames < 50, `${z.holdFrames} frames`);
    check("...and the flat speed divides the distance by it",
          Math.abs(z.vel.x - 30 / z.holdFrames) < 1e-4, `vx ${z.vel.x}`);
    check("...with gravity on the y axis", Math.abs(z.accY + 0.04) < 1e-6,
          `accY ${z.accY}`);
  }

}

console.log("\nclass 0x30's two spheres: the wall push and the crowd push:");
{
  const scenePush = () => {
    ResetGameGlobals();
    SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    T.coli = { files: ["t"], blobs: { wall: WALL_BLOB, floor: FLOOR_BLOB } };
    G.g_coli_full_set = ["wall", "floor"];
    G.g_camera_fixed_eye_y = 0;
  };

  // **The bug this fixes.** `EnemyZombieInit` writes both radii and the port
  // wrote neither, so every zombie collided as a point of radius zero and the
  // world push could never find anything to be pushed out of.
  {
    scenePush();
    const z = ActorSpawn(0x7000, SpawnClass.Zombie, 1, "radii");
    check("the Init sets the shot radius and the body radius",
          z.radius === 10 && z.bodyRadius === 3.5,
          `shot ${z.radius} body ${z.bodyRadius}`);
  }

  // `WALL_BLOB` is the plane x = 30. Put an actor inside it and it must come
  // back out rather than through.
  {
    scenePush();
    const z = ActorSpawn(0x7001, SpawnClass.Zombie, 1, "walled");
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.pos = vec3(29, 0, 45);
    const before = z.pos.x;
    ZombiePushOutOfWorldAndActors(z, 1);
    check("an actor inside a wall is pushed back out of it", z.pos.x < before,
          `x ${z.pos.x.toFixed(2)} from ${before}`);
  }

  // The crowd push is **mutual and deferred**: the mover records the opposite
  // push on whoever it found, who applies it on its own next frame. That is
  // what makes it one test per actor rather than one per pair.
  {
    scenePush();
    const a = ActorSpawn(0x7002, SpawnClass.Zombie, 1, "a");
    const b = ActorSpawn(0x7003, SpawnClass.Zombie, 1, "b");
    for (const z of [a, b]) { z.visible = true; z.hp = z.maxHp = 100; }
    a.pos = vec3(0, 0, 0);
    b.pos = vec3(2, 0, 0);             // well inside 3.5 + 3.5
    const gap0 = Math.abs(a.pos.x - b.pos.x);
    ZombiePushOutOfWorldAndActors(a, 1);
    check("an actor inside another is pushed away from it", a.pos.x < 0,
          `ax ${a.pos.x.toFixed(3)}`);
    check("...and the other is told which way, not moved",
          b.pos.x === 2 && b.pushedBy === a.at && b.pushNormal.x > 0,
          `bx ${b.pos.x} by ${b.pushedBy}`);
    ZombiePushOutOfWorldAndActors(b, 1);
    check("which it does on its own next frame",
          b.pos.x > 2 && b.pushedBy === -1, `bx ${b.pos.x.toFixed(3)}`);
    check("so the two separate", Math.abs(a.pos.x - b.pos.x) > gap0,
          `gap ${Math.abs(a.pos.x - b.pos.x).toFixed(3)} from ${gap0}`);
  }
}

console.log("\nclass 0x30 state 15, the scripted walk-in:");
{
  // `ZombieStateWalkDistance` does not move the actor -- the clip's root
  // motion does -- so the test moves it and checks what the state makes of
  // that. See `game/class30/walk_distance.ts`.
  const walker = (dist: number) => {
    ResetGameGlobals();
    SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_camera_fixed_eye_y = 0;
    const z = ActorSpawn(0x7100, SpawnClass.Zombie, 1, "walk-in", {
      initialState: ZombieState.WalkDistance, walkDistance: dist,
    });
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.pos = vec3(0, 0, 0);
    return z;
  };

  // **The bug this fixes.** State 15 was folded into `AttackRun`, so all
  // fifty of the game's walk-in spawns turned to face the camera on their
  // first frame instead of walking the entrance the level was built for.
  check("a state-15 spawn starts in WalkDistance, not AttackRun",
        ZombieEntryState(ZombieState.WalkDistance) === ZombieState.WalkDistance,
        String(ZombieEntryState(ZombieState.WalkDistance)));

  {
    const z = walker(8);
    ZombieStateWalkDistance(z, new Rng(1));
    check("the first frame latches the distance and the start point",
          z.targetArrive === 8 && z.arcFrom.x === 0 && z.arcFrom.z === 0
          && z.sub === 2, `arrive ${z.targetArrive} sub ${z.sub}`);
    check("...and it is still walking", z.state === ZombieState.WalkDistance,
          String(z.state));

    z.pos.z = -7.9;                       // just short
    ZombieStateWalkDistance(z, new Rng(1));
    check("short of the distance it keeps walking",
          z.state === ZombieState.WalkDistance
          && Math.abs(z.walkTravelled - 7.9) < 1e-4,
          `${ZombieState[z.state]} travelled ${z.walkTravelled.toFixed(2)}`);

    z.pos.z = -8.1;                       // past it
    ZombieStateWalkDistance(z, new Rng(1));
    check("reaching it hands to AttackRun with a fresh sub",
          z.state === ZombieState.AttackRun && z.sub === 0,
          `${ZombieState[z.state]}/${z.sub}`);
    check("...and records where the walk ended",
          z.strikeStart.z === -8.1, String(z.strikeStart.z));
  }

  // The measure is `sqrt(dx^2 + dz^2)`: an actor dropped a long way has not
  // walked anywhere. Taking the 3D distance would end the entrance early for
  // every spawn that falls to the floor on its first frame.
  {
    const z = walker(8);
    ZombieStateWalkDistance(z, new Rng(1));
    z.pos.y = -100;
    ZombieStateWalkDistance(z, new Rng(1));
    check("the distance is 2D -- falling is not walking",
          z.state === ZombieState.WalkDistance && z.walkTravelled === 0,
          `${ZombieState[z.state]} travelled ${z.walkTravelled}`);
  }

  // The other arm: with `obj+0x34` bit 0x20000000 the state retires the actor
  // instead of sending it at the camera. No shipped class-0x30 spawn sets it.
  {
    const z = walker(4);
    z.flags |= ActorFlag.BackingOff;
    ZombieStateWalkDistance(z, new Rng(1));
    z.pos.x = 5;
    ZombieStateWalkDistance(z, new Rng(1));
    check("the 0x20000000 arm despawns rather than attacking",
          z.despawned && z.state === ZombieState.WalkDistance,
          `despawned ${z.despawned} ${ZombieState[z.state]}`);
  }
}

console.log("\nthe clip clock the scripts count in:");
{
  // `g_motion_play_length` is about twice `frames`, and every cue a script
  // names is in *those* units. Counting in authored frames loses every cue
  // past halfway, which is what left the mauled civilians alive.
  ResetGameGlobals();
  SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  const z = ActorSpawn(0x7200, SpawnClass.Zombie, 1, "clock");
  z.motion = 10;                     // 20 frames, and a play length of 37
  const m = CHARS.types["1"].motions["10"];
  check("the play clock runs at twice the authored frames",
        (() => { z.playTicks = 2; return MotionPlayFrame(z) === 2; })(),
        `frame ${MotionPlayFrame(z)}`);
  check("...and the play length comes from the bundle, not from frames * 2",
        MotionPlayLength(z) === 37 && m.frames * 2 - 2 === 38,
        `${MotionPlayLength(z)} for ${m.frames} frames`);
  // The failure this guards: a cue past the authored frame count must still
  // be reachable, because the engine's cursor counts to the play length. It
  // **wraps** there rather than running away -- `model[2] = model[0] %
  // (play + 1)` -- so the test is that one full cycle visits every value up
  // to the play length and then returns to zero.
  const seen = new Set<number>();
  for (let i = 0; i < 80; i++) {
    z.playTicks = i;
    seen.add(MotionPlayFrame(z));
  }
  check("a cue past the authored frame count is still reachable",
        seen.has(30) && seen.has(37) && m.frames === 20,
        `${seen.size} distinct cursors for ${m.frames} frames`);
  check("...and the cursor wraps at the play length rather than running away",
        Math.max(...seen) === 37 && seen.size === 38,
        `max ${Math.max(...seen)} of ${seen.size}`);

  // **Every cursor value is observed, once, from every start phase.**
  //
  // The check above sets `playTicks` by hand, which is why it passed for
  // months while the cursor was skipping values: the bug was in *accumulating*
  // it. The clock was seconds, advanced `clock += 1/60` and read back as
  // `Math.floor(clock * fps * 2)`, and repeated float addition of 1/60 does
  // not land on multiples of 1/60 -- so the cursor went 6, 8 and 30, 32 while
  // showing 5 twice. Sixteen call sites compare it with `===`, correctly,
  // because `>=` double-fires across the `% (len + 1)` wrap. A cue authored at
  // 7, 15, 31 or 507 could therefore never fire, and the actor parked for
  // ever. Most of `docs/PLAYER_HANGS.md` is that sentence.
  //
  // So this drives the real advance, one tick at a time, from every phase a
  // clip can start on -- because which value gets lost moves with the phase.
  const len = MotionPlayLength(z);
  let worst = "";
  for (let phase = 0; phase <= len && !worst; phase++) {
    z.playTicks = phase;
    const counts = new Map<number, number>();
    // One full cycle plus a little, so the wrap is included.
    for (let i = 0; i <= len; i++) {
      const f = MotionPlayFrame(z);
      counts.set(f, (counts.get(f) ?? 0) + 1);
      ActorAdvanceMotion(z, 1 / 60);
    }
    for (let f = 0; f <= len; f++) {
      const n = counts.get(f) ?? 0;
      if (n !== 1) {
        worst = `from phase ${phase}, cursor ${f} was observed ${n} times`;
        break;
      }
    }
  }
  check("every cursor value is observed exactly once, from every start phase",
        worst === "", worst);
}

console.log("\nclass 0x10's body radius, and the hook that ramps it:");
{
  // **The bug this fixes.** `CivilianInit` writes `obj+0x128 = 1.0`; the port
  // wrote only `obj+0x124`, so `ColiTestSphereAgainstActors`' lazy default
  // filled the body radius from the *shot* radius -- ten units -- and a
  // captor walking at its civilian was shoved off it from 13.5 away when its
  // script wanted to be within 6. It never arrived and nobody was ever mauled.
  ResetGameGlobals();
  SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  T.civilians = { entries: [], scripts: [], items: [], spawns: {} };
  const c = ActorSpawn(0x7300, SpawnClass.Civilian, 1, "civ", undefined,
                       new Rng(1));
  check("the civilian's body sphere is one unit, not its shot sphere",
        c.bodyRadius === 1 && c.radius !== 1,
        `body ${c.bodyRadius} shot ${c.radius}`);

  // Op 0x16 ramps it, and the hook is what applies the ramp.
  c.civ!.scaleTarget = 4;
  c.civ!.scaleStep = 1;
  for (let i = 0; i < 10; i++) PoseHookGrowAndPushOutOfWorld(c);
  check("the pose hook ramps it to the target and stops there",
        c.bodyRadius === 4, String(c.bodyRadius));
  c.civ!.scaleTarget = 2;
  c.civ!.scaleStep = -0.5;
  for (let i = 0; i < 10; i++) PoseHookGrowAndPushOutOfWorld(c);
  check("...from either side", c.bodyRadius === 2, String(c.bodyRadius));

  // And the push it does only when the wait word asks for it.
  T.coli = { files: ["t"], blobs: { wall: WALL_BLOB } };
  G.g_coli_full_set = ["wall"];
  c.pos = vec3(29, 0, 45);
  c.civ!.scaleTarget = c.bodyRadius;
  c.civ!.scaleStep = 0;
  PoseHookGrowAndPushOutOfWorld(c);
  check("without the wait bit it stays in the wall", c.pos.x === 29,
        String(c.pos.x));
  c.civ!.wait |= CivilianWait.PushOutOfWorld;
  PoseHookGrowAndPushOutOfWorld(c);
  check("with it, it is pushed out", c.pos.x < 29, c.pos.x.toFixed(2));
}

console.log("\nclass 0x10's play cursor: a corpse rests, it does not replay:");
{
  // `CivilianUpdate` advances the cursor only while the loop count allows;
  // when it runs out nothing touches it again. The port's clock is advanced
  // unconditionally and the renderer wraps it, so a civilian killed in a set
  // piece played its dying clip over and over.
  const dying = (loops: number) => {
    ResetGameGlobals();
    SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    T.civilians = { entries: [], scripts: [], items: [], spawns: {} };
    const c = ActorSpawn(0x7400, SpawnClass.Civilian, 1, "dying", undefined,
                         new Rng(1));
    c.visible = true;
    c.motion = 10;                   // 20 frames, play length 37
    c.playTicks = 0;
    c.civ!.loops = loops;
    return c;
  };
  const runClip = (c: Actor, frames: number) => {
    for (let i = 0; i < frames; i++) {
      ActorAdvanceMotion(c, 1 / 60);
      CivilianCountMotionLoops(c);
    }
  };

  {
    const c = dying(1);
    runClip(c, 200);                 // far past the clip's 37-frame play length
    check("a one-shot clip stops at the end of its play length",
          MotionPlayFrame(c) === 37, String(MotionPlayFrame(c)));
    check("...and the loop count is spent", c.civ!.loops === 0,
          String(c.civ!.loops));
    const at = MotionPlayFrame(c);
    runClip(c, 200);
    check("...and it stays there rather than wrapping round again",
          MotionPlayFrame(c) === at, String(MotionPlayFrame(c)));
  }

  // A negative count is the engine's "play for ever": the cursor keeps
  // moving, where a spent one is pinned.
  {
    const c = dying(-1);
    runClip(c, 200);
    const a = MotionPlayFrame(c);
    runClip(c, 1);
    check("a negative loop count still plays for ever",
          MotionPlayFrame(c) !== a, `${a} then ${MotionPlayFrame(c)}`);
  }

  // Two loops take twice as long to settle, and settle in the same place.
  {
    const c = dying(2);
    runClip(c, 40);
    check("a two-loop clip is still going after one play",
          c.civ!.loops === 1, String(c.civ!.loops));
    runClip(c, 200);
    check("...and rests after the second", c.civ!.loops === 0
          && MotionPlayFrame(c) === 37, String(MotionPlayFrame(c)));
  }
}

console.log("\nclass 0x30's twelve entrance states — do the waits end?");
{
  // Every one of the twelve is a wait, and a wait transcribed slightly wrong
  // does not crash: it simply never comes true and the actor stands there for
  // the rest of the stage. `tools/entrances.mjs` checks all 127 shipped spawns
  // against the real bundle; this checks the shapes against data written here,
  // where a cue can be put exactly on and exactly past its frame.

  // **The entry router passes every shipped entrance through now.** It used to
  // fold 37 of the 54 states into `AttackRun`, which is what sent a zombie
  // scripted to drown you jogging across the room instead.
  for (const st of [ZombieState.SurfaceOnCameraCue, ZombieState.RunInPlaceTimed,
                    ZombieState.HoldClipThenBranch,
                    ZombieState.WaitCameraFrameThenBranch,
                    ZombieState.WaitForCameraFrame,
                    ZombieState.WaitScriptFlagThenBranch,
                    ZombieState.ScriptedGrabAndDespawn, ZombieState.LeapToPoint,
                    ZombieState.RideCarrier, ZombieState.ArcScriptedEntrance,
                    ZombieState.WaitScriptFlagThenEnter,
                    ZombieState.DelayedStrikeInPlace]) {
    check(`a state-${st} spawn starts there, not in AttackRun`,
          ZombieEntryState(st) === st, String(ZombieEntryState(st)));
  }
  check("...and a state nothing ships still falls back to AttackRun",
        ZombieEntryState(53) === ZombieState.AttackRun,
        String(ZombieEntryState(53)));

  const spawn = (init: number, entry: unknown, exit = ZombieState.AttackRun) => {
    ResetGameGlobals();
    SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_camera_fixed_eye_y = 0;
    G.g_players_in_play = 1;
    const z = ActorSpawn(0x7700, SpawnClass.Zombie, 1, "entrance", {
      initialState: init, attackState: exit,
      entry: entry as Actor["entry"],
    });
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.pos = vec3(0, 0, 30);
    return z;
  };
  const run = (z: Actor, frames: number, rng = new Rng(3)) => {
    for (let f = 0; f < frames; f++) {
      EnemyZombieUpdate(z, { eye: EYE, dt: 1 / 60, rng, host: NULL_HOST });
      // `GameUpdate` advances the clip; `EnemyZombieUpdate` does not. Four of
      // the twelve measure their exit on the **play clock**, so a loop that
      // leaves it at zero stalls them and proves nothing.
      ActorAdvanceMotion(z, 1 / 60);
    }
  };

  // -- state 17: hold a clip for N frames, then branch ---------------------
  {
    const z = spawn(ZombieState.HoldClipThenBranch,
                    { motion: 700, frames: 30 });
    run(z, 20);
    check("state 17 is still holding at 20 of its 30 frames",
          z.state === ZombieState.HoldClipThenBranch && z.motion === 700,
          `${z.state}/${z.motion}`);
    run(z, 20);
    // Where it goes *after* the branch is the attack loop's business — by 40
    // frames the run may already have reached the ring. What matters is that
    // the entrance let go.
    check("...and branches once the count is out",
          z.state !== ZombieState.HoldClipThenBranch, String(z.state));
  }
  {
    // The `tail+0x03 == 15` arm: it latches the distance **and** enters state
    // 15 at sub 1, skipping that state's own latch. Entering at sub 0 would
    // overwrite the distance with `walkDistance`, a different field.
    const z = spawn(ZombieState.HoldClipThenBranch,
                    { motion: 700, frames: 5, walk_distance: 9 },
                    ZombieState.WalkDistance);
    run(z, 10);
    check("state 17's exit-15 arm hands to the walk-in",
          z.state === ZombieState.WalkDistance, String(z.state));
    // It enters state 15 at **sub 1**, not sub 0 — and this is what proves it.
    // Sub 0 is that state's own latch, which would overwrite the distance with
    // `walkDistance`, a different descriptor field that is 0 here.
    check("...carrying the distance the entrance chose, not state 15's own",
          z.targetArrive === 9, String(z.targetArrive));
  }

  // -- state 18: wait for an exact camera frame ----------------------------
  {
    const z = spawn(ZombieState.WaitCameraFrameThenBranch,
                    { motion: 700, cue: 40 });
    G.g_cam_path_frame = 39;
    run(z, 5);
    check("state 18 waits while the camera is short of its frame",
          z.state === ZombieState.WaitCameraFrameThenBranch, String(z.state));
    G.g_cam_path_frame = 40;
    run(z, 1);
    check("...and goes the frame the camera lands on it",
          z.state === ZombieState.AttackRun, String(z.state));
  }
  {
    // The equality is the engine's, and it is load-bearing: a path that steps
    // over the frame parks the actor, which is how the game holds a rank of
    // zombies a given camera run never triggers.
    const z = spawn(ZombieState.WaitCameraFrameThenBranch,
                    { motion: 700, cue: 40 });
    G.g_cam_path_frame = 41;
    run(z, 60);
    check("...but a camera already past it waits for ever, as the exe does",
          z.state === ZombieState.WaitCameraFrameThenBranch, String(z.state));
  }

  // -- state 13: the same wait, but `>=` ------------------------------------
  {
    const z = spawn(ZombieState.SurfaceOnCameraCue, { cue_frame: 40 });
    check("state 13 freezes its pose under the water first",
          (z.flags & ActorFlag.PoseFrozen) !== 0 || z.sub === 0,
          `flags ${z.flags.toString(16)}`);
    run(z, 1);                     // sub 0 -> 1: the freeze is taken first
    G.g_cam_path_frame = 100;
    run(z, 1);
    check("...and a camera *past* its frame still releases it — this one is a"
          + " `>=`, unlike state 18",
          z.sub === 2 && (z.flags & ActorFlag.PoseFrozen) === 0,
          `sub ${z.sub} flags ${z.flags.toString(16)}`);
    run(z, 200);
    // Into the attack loop — which by 200 frames has usually moved on from
    // `AttackRun` itself, so the assertion is that the entrance is done.
    check("...then hands over when the surfacing clip is out",
          z.state !== ZombieState.SurfaceOnCameraCue, String(z.state));
  }

  // -- state 20: the script flag ------------------------------------------
  {
    const z = spawn(ZombieState.WaitScriptFlagThenBranch,
                    { motion: 700, cue: 7 });
    run(z, 30);
    check("state 20 waits on its script flag",
          z.state === ZombieState.WaitScriptFlagThenBranch, String(z.state));
    G.g_script_flags[7] = 1;
    run(z, 1);
    check("...and goes when the script raises it",
          z.state === ZombieState.AttackRun, String(z.state));
  }

  // -- state 19: the only cooldown class 0x30 ever arms --------------------
  {
    const z = spawn(ZombieState.WaitForCameraFrame,
                    { motion: 700, cue_frame: 10, freeze: true, claim: true,
                      delay: 5, cooldown: 90 });
    check("state 19's freeze arm stops the clock", z.frozen === 1 || z.sub === 0,
          `frozen ${z.frozen}`);
    G.g_cam_path_frame = 10;
    run(z, 20);
    check("state 19 claims a permit on its cue and goes to the strike",
          z.state === ZombieState.Strike && z.attackPermit >= 0,
          `${z.state}/${z.attackPermit}`);
    check("...arming the cooldown, which no other class-0x30 state does",
          z.hasCooldown && z.cooldown === 90,
          `${z.hasCooldown}/${z.cooldown}`);
  }
  {
    // A failed claim is not an error — the actor takes the descriptor's branch.
    const z = spawn(ZombieState.WaitForCameraFrame,
                    { motion: 700, cue_frame: 10, freeze: false, claim: false,
                      delay: 0, cooldown: 0 });
    G.g_cam_path_frame = 10;
    run(z, 3);
    check("...and a state-19 spawn that does not claim just branches",
          z.state === ZombieState.AttackRun && !z.hasCooldown,
          `${z.state}/${z.hasCooldown}`);
  }

  // -- state 31: it counts itself into the game ---------------------------
  {
    // The clip has to be **longer than 0x4D on the play clock**, because the
    // exit is `motion != it || 0x4D < cursor` and the cursor wraps. All four
    // shipped spawns name clip 920, whose play length clears it; a shorter one
    // would stall in the engine too, which is why this fixture uses 184.
    const z = spawn(ZombieState.WaitScriptFlagThenEnter,
                    { flag: 3, idle_motion: 10, motion: 923, delay: 10 });
    run(z, 30);
    check("state 31 is not yet an enemy the script can see",
          G.g_enemies_alive === 0 && G.g_enemies_present === 0,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
    G.g_script_flags[3] = 1;
    run(z, 1);
    check("...and counts itself in when its flag comes up",
          G.g_enemies_alive === 1 && G.g_enemies_present === 1,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
    run(z, 200);
    check("...then joins the attack loop",
          z.state !== ZombieState.WaitScriptFlagThenEnter, String(z.state));
  }

  // -- state 23: the only entrance that ends in a despawn ------------------
  {
    const z = spawn(ZombieState.ScriptedGrabAndDespawn,
                    { cue_frame: -1, motion: 186, hit_frame: 10 });
    run(z, 4);
    check("state 23's -1 cue fires at once", z.sub >= 2, String(z.sub));
    run(z, 200);
    check("...and it removes the actor rather than setting a state",
          z.despawned, `despawned ${z.despawned} state ${z.state}`);
  }

  // -- state 24: flies to its point and then never leaves ------------------
  {
    const z = spawn(ZombieState.LeapToPoint,
                    { dest: [0, 0, 12], frames: 10, delay: 5,
                      idle_motion: 1010, strike_motion: 1009, hit_frame: 8,
                      player: 0 });
    run(z, 12);
    check("state 24 flies to the point its descriptor names",
          Math.hypot(z.pos.x - 0, z.pos.z - 12) < 1.5,
          `${z.pos.x.toFixed(2)},${z.pos.z.toFixed(2)}`);
    const perch = { x: z.pos.x, z: z.pos.z };
    run(z, 400);
    check("...stays in the state for ever, as the exe does",
          z.state === ZombieState.LeapToPoint, String(z.state));
    check("...and is pinned to its perch, so the crowd push cannot walk it off",
          z.pos.x === perch.x && z.pos.z === perch.z,
          `${z.pos.x.toFixed(2)},${z.pos.z.toFixed(2)}`);
  }
  {
    // `g_players_in_play` is a **count**, not a two-player flag, and both
    // scripted attackers refuse to strike while it is zero. Leaving the port's
    // old default of 0 in place would have parked all nine of those spawns.
    const z = spawn(ZombieState.LeapToPoint,
                    { dest: [0, 0, 12], frames: 4, delay: 1,
                      idle_motion: 1010, strike_motion: 1009, hit_frame: 8,
                      player: 0 });
    G.g_players_in_play = 0;
    run(z, 120);
    check("state 24 will not strike before a player is in play",
          z.sub === 2, `sub ${z.sub}`);
    G.g_players_in_play = 1;
    run(z, 120);
    check("...and does once one is", z.sub > 2, `sub ${z.sub}`);
  }

  // -- state 29: the passenger --------------------------------------------
  {
    const z = spawn(ZombieState.RideCarrier, null, ZombieState.AttackRun);
    run(z, 3);
    // [diverges] With no rideable object ported the ride is over at once,
    // rather than parking six spawns for the rest of the stage. See
    // `class30/entrance.ts`.
    check("state 29 hands over at once when there is no carrier to ride",
          z.state === ZombieState.AttackRun, String(z.state));
  }
}

console.log("\nIsPlayerAttackable: the scene has to be running:");
{
  // Three clauses, two of them ported. The first is the interesting one:
  // nothing may attack unless the scene state's major is 2, the `cam/` path
  // camera row -- so a scripted view-angle turn is a window in which the
  // player cannot be hit.
  ResetGameGlobals();
  SetGameTables(CHARS);
  G.g_player_lives = [2, 2];
  check("a player is not attackable before a scene state is entered",
        !IsPlayerAttackable(0), "attackable at major 0");

  G.g_scene_state_major_entered = 1;
  check("...nor while the follow camera or a scripted turn drives",
        !IsPlayerAttackable(0), "attackable at major 1");

  G.g_scene_state_major_entered = 2;
  check("...but is once the path camera is driving", IsPlayerAttackable(0),
        "not attackable at major 2");

  // The attract override: the demo has no real player, so `g_player_state` is
  // never 5, and without this the demo would never be attacked.
  G.g_scene_state_major_entered = 2;
  G.g_player_lives = [0, 0];
  check("a player with no lives left is not attackable — the port's stand-in "
        + "for the state word", !IsPlayerAttackable(0), "still attackable");
  G.g_app_state = 5;
  check("...unless the attract demo is running, which overrides it",
        IsPlayerAttackable(0), "override did not fire");
  G.g_app_state = 0;

  // ...and the engine's own third clause, for when a player state exists.
  G.g_player_state = [5, 0];
  check("a player the state word says is in play is attackable regardless",
        IsPlayerAttackable(0) && !IsPlayerAttackable(1),
        `${IsPlayerAttackable(0)}/${IsPlayerAttackable(1)}`);

  // The port's own guard. The engine reads 0x130 bytes below the array here.
  check("...and -1 is nobody", !IsPlayerAttackable(-1), "attackable");

  // **And the gate is wired into the claim**, which is the call site the port
  // used to leave out. `TryClaimAttackSlot` picks a player and voids the pick
  // when this refuses, so no enemy takes a permit during a scripted camera.
  {
    ResetGameGlobals();
    SetGameTables(CHARS);
    G.g_player_lives = [2, 2];
    const z = ActorSpawn(0x7D00, SpawnClass.Zombie, 1, "claimant");
    z.visible = true;
    z.hp = z.maxHp = 100;
    G.g_scene_state_major_entered = 1;
    check("no permit is granted while a scripted camera drives",
          !TryClaimAttackSlot(z) && z.attackPermit === -1,
          `permit ${z.attackPermit}`);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    check("...and one is the moment the path camera takes over",
          TryClaimAttackSlot(z) && z.attackPermit === 0,
          `permit ${z.attackPermit}`);
  }
}

console.log("\nResetSceneOnEnter: what a scene starts clean:");
{
  // `ResetSceneOnEnter` (`FUN_0045EDD0`) is the engine's per-scene reset, and
  // the port's `ResetGameGlobals` calls it — the same nesting the exe has,
  // where `ResetGameOnStart` (`FUN_0045FEF0`) zeroes the run totals and the
  // scene load zeroes these.
  ResetGameGlobals();
  SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_enemies_alive = 4;
  G.g_enemies_present = 7;
  G.g_civilians_alive = 3;
  G.g_script_flags[9] = 1;
  G.g_head_combo_bonus = [130, 140];
  G.g_player_hit_count = [22, 31];
  // ...and something it must NOT touch: the run keeps the score across scenes.
  G.g_player_score = [4200, 900];

  ResetSceneOnEnter();
  check("a scene starts with both enemy counts at zero",
        G.g_enemies_alive === 0 && G.g_enemies_present === 0,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);
  check("...and no civilians counted",
        G.g_civilians_alive === 0, String(G.g_civilians_alive));
  check("...and every script flag down",
        (G.g_script_flags[9] ?? 0) === 0, String(G.g_script_flags[9]));
  // The shot statistics are per **scene**, which is what makes the accuracy
  // grade `EvtOpAwardAccuracyBonus2B` (`FUN_0045FE40`) pays a per-stage one.
  check("...and the per-scene shot statistics cleared for both players",
        G.g_head_combo_bonus[0] === 0 && G.g_head_combo_bonus[1] === 0
        && G.g_player_hit_count[0] === 0 && G.g_player_hit_count[1] === 0,
        `${G.g_head_combo_bonus} / ${G.g_player_hit_count}`);
  check("...but the score survives, because it is a run total and not a scene one",
        G.g_player_score[0] === 4200 && G.g_player_score[1] === 900,
        String(G.g_player_score));

  // **The scene enter has to go through it.** `GameSystem.attach` -- the port's
  // stand-in for the engine's scene load -- calls `ResetGameGlobals`, and that
  // is the only path into a stage. If the two are ever decoupled, a stage
  // switch carries the last stage's script flags and enemy counts into the
  // next one, which is precisely what the engine's reset exists to stop.
  G.g_enemies_alive = 9;
  G.g_script_flags[4] = 1;
  G.g_civilians_alive = 2;
  ResetGameGlobals();
  check("the pool reset still performs the scene reset",
        G.g_enemies_alive === 0 && G.g_civilians_alive === 0
        && (G.g_script_flags[4] ?? 0) === 0,
        `${G.g_enemies_alive}/${G.g_civilians_alive}/${G.g_script_flags[4]}`);
}

console.log("\nthe two enemy counters, stepped and not derived:");
{
  // `g_enemies_alive` and `g_enemies_present` are what 488 enemy gates wait
  // on. The port used to recount the pool every frame, which cannot express
  // either of the two things the engine uses them for: a corpse that is
  // present but not alive, and an actor deliberately left out of the count.
  const zombie = (init: number, charType = 1) => {
    const z = ActorSpawn(0x7B00 + init, SpawnClass.Zombie, charType, "counted",
                         { initialState: init });
    z.visible = true;
    z.hp = z.maxHp = 100;
    return z;
  };

  ResetGameGlobals();
  SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  check("a scene starts with both counts at zero",
        G.g_enemies_alive === 0 && G.g_enemies_present === 0,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);

  const a = zombie(ZombieState.AttackRun);
  check("an ordinary zombie counts itself in at Init",
        G.g_enemies_alive === 1 && G.g_enemies_present === 1,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);

  // `EnemyZombieInit`'s two exclusions, and they are the point of the rewrite.
  zombie(ZombieState.AttackRun, UNCOUNTED_CHAR_TYPE);
  check("...but character type 9 is not an enemy and is never counted",
        G.g_enemies_alive === 1, String(G.g_enemies_alive));
  const late = zombie(ZombieState.WaitScriptFlagThenEnter);
  check("...and a state-31 spawn is not counted until its flag comes up",
        G.g_enemies_alive === 1, String(G.g_enemies_alive));

  // The state counts itself in, which is the whole reason it exists.
  late.entry = { flag: 3, idle_motion: 10, motion: 923, delay: 0 };
  G.g_camera_fixed_eye_y = 0;
  G.g_script_flags[3] = 1;
  for (let f = 0; f < 3; f++) {
    EnemyZombieUpdate(late, { eye: EYE, dt: 1 / 60, rng: new Rng(1), host: NULL_HOST });
  }
  check("...and then it does", G.g_enemies_alive === 2 && G.g_enemies_present === 2,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);

  // The latch: six routines call the releases and more than one can reach the
  // same actor, so without it the count goes negative and a gate opens early.
  ReleaseEnemyAliveCount(a);
  ReleaseEnemyAliveCount(a);
  ReleaseEnemyAliveCount(a);
  check("the alive release is latched — three calls, one decrement",
        G.g_enemies_alive === 1, String(G.g_enemies_alive));
  check("...and it did not touch the present count",
        G.g_enemies_present === 2, String(G.g_enemies_present));

  // Which is the distinction the derived count could not express at all.
  ReleaseEnemyPresentCount(a);
  check("a corpse leaves `alive` before it leaves `present`",
        G.g_enemies_present === 1, String(G.g_enemies_present));
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
    SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_camera_fixed_eye_y = 0;
    const z = ActorSpawn(0x7900, SpawnClass.Zombie, 1, "leaper", {
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
    const z = leaper();
    const rng = new Rng(5);
    let lowest = z.pos.y, sawLimp = false, landed = -1;
    for (let f = 0; f < 400 && z.state === ZombieState.DelayedLeap; f++) {
      EnemyZombieUpdate(z, { eye: EYE, dt: 1 / 60, rng, host: NULL_HOST });
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
      EnemyZombieUpdate(z, { eye: EYE, dt: 1 / 60, rng, host: NULL_HOST });
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
  // the actor. The port had no state 33, so `ZombieEntryState` folded it into
  // `AttackRun` and stage 1's axe man -- character type 0x13, whose asset file
  // is `tutorial.bin` -- charged the camera.
  check("a state-33 spawn starts in StandAndThrow, not AttackRun",
        ZombieEntryState(ZombieState.StandAndThrow)
          === ZombieState.StandAndThrow,
        String(ZombieEntryState(ZombieState.StandAndThrow)));

  /** `obj+0x34` bit 0x20000 — see `ActorInitFlags` and `class30/ground.ts`. */
  const GROUND_SNAP_EXEMPT = 0x20000;

  const thrower = (cond = 7) => {
    ResetGameGlobals();
    SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_camera_fixed_eye_y = 0;
    const z = ActorSpawn(0x7500, SpawnClass.Zombie, 1, "axe man", {
      initialState: ZombieState.StandAndThrow, condition: cond,
      standThrow: { delay_two_hands: 2, delay_one_hand: 2,
                    delay_after_throw: 2, exit_state: 0, walk_distance: 5 },
    });
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.pos = vec3(0, 0, 60);
    return z;
  };

  {
    const z = thrower();
    check("both hands start armed", ZombieArmedHands(z) === 2,
          String(ZombieArmedHands(z)));
    // Two frames of delay, then it claims and starts the throw clip.
    for (let i = 0; i < 4; i++) {
      ZombieStateStandAndThrow(z, EYE, new Rng(1), NULL_HOST);
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
    SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_camera_fixed_eye_y = 0;          // the ground plane, far below
    const pinned = ActorSpawn(0x7600, SpawnClass.Zombie, 1, "on a ledge", {
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
    ZombiePushOutOfWorldAndActors(pinned, 1);
    check("a pinned spawn keeps the height the script placed it at",
          pinned.pos.y === 47, String(pinned.pos.y));

    // ...and one without the bit settles onto the ground plane, as every
    // other stationary thrower in the game does.
    const loose = ActorSpawn(0x7601, SpawnClass.Zombie, 1, "not pinned", {
      initialState: ZombieState.StandAndThrow, condition: 7,
    });
    loose.visible = true;
    loose.hp = loose.maxHp = 100;
    loose.pos = vec3(0, 47, 60);
    ZombiePushOutOfWorldAndActors(loose, 1);
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
    ZombieStateStandAndThrow(z, EYE, new Rng(1), NULL_HOST);
    check("with both hands empty it starts the leave delay",
          z.throwDelay === 2, String(z.throwDelay));
    for (let i = 0; i < 4; i++) {
      ZombieStateStandAndThrow(z, EYE, new Rng(1), NULL_HOST);
    }
    check("...and then walks away rather than despawning on the spot",
          z.state === ZombieState.WalkDistance && z.targetArrive === 5
          && !z.despawned,
          `${ZombieState[z.state]} arrive ${z.targetArrive} `
          + `despawned ${z.despawned}`);
    check("...backwards, on `row[4]`",
          (z.flags & ActorFlag.BackingOff) !== 0);
  }

  // The other way in: a condition-8 walker already facing the camera.
  {
    const z = thrower(8);
    z.state = ZombieState.AttackRun;
    G.g_camera_yaw_bams = 0x8000;
    z.yaw = 0;                                 // facing the camera's reverse
    check("a condition-8 walker facing the camera stops and throws",
          ZombieShouldStandAndThrow(z));
    const away = thrower(8);
    away.yaw = 0x4000;                         // ninety degrees off
    check("...and one facing away does not", !ZombieShouldStandAndThrow(away));
    const ordinary = thrower(0);
    ordinary.yaw = 0;
    check("...nor does an ordinary body condition",
          !ZombieShouldStandAndThrow(ordinary));
  }
}

// `g_camera_free` -- the gate every room-clear wait needs on top of its
// counter. It is the flag that decides whether a room hands over on the frame
// the last enemy dies or once the camera has swung back onto its rail, and the
// way it fails is by never rising, which parks the script for good.
{
  ResetGameGlobals();

  // Claimed: somebody is in the camera's slots.
  G.g_enemy_slots = [0];
  G.g_enemies_alive = 1;
  G.g_camera_settled = 1;
  UpdateCameraFreeFlag();
  check("the camera is not free while an enemy holds a slot",
        G.g_camera_free === 0);

  // The slot empties and the flag rises again -- that is the whole rule.
  G.g_enemy_slots = [];
  UpdateCameraFreeFlag();
  check("the camera is free once nothing holds a slot", G.g_camera_free === 1);

  // The rule is the slot array and NOTHING else. An earlier cut of this also
  // required `g_enemies_alive == 0` and a converged aim -- terms that belong
  // to the other camera driver, not this one -- and the conjunction held every
  // room-clear gate for ever while anything was still alive. These two are the
  // regression: enemies alive, and an aim that has not converged, must both
  // leave the flag up.
  G.g_enemies_alive = 5;
  UpdateCameraFreeFlag();
  check("...even with enemies alive, if none of them holds a slot",
        G.g_camera_free === 1);
  G.g_camera_settled = 0;
  UpdateCameraFreeFlag();
  check("...and without waiting for the aim to converge",
        G.g_camera_free === 1);
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
// attack script whose point sits in front of it and no entries at all. When
// the maul ends, the engine tests the point and turns on the player *at once*
// rather than walking the leg first.
{
  const captor = (state: number, attackState: number,
                  point: [number, number, number], yaw = 0) => {
    ResetGameGlobals();
    const z = ActorSpawn(0x18e8, SpawnClass.Zombie, 1, "captor");
    z.state = state;
    z.attackState = attackState;
    z.yaw = yaw;
    z.pos = vec3(-80, 2, -309);
    z.script = { target: null,
                 attack: { state: attackState, head: { point }, entries: [] } };
    return z;
  };

  // Facing +X (yaw 0xC000) with the point at x = -25: already ahead.
  const ahead = captor(ZombieState.TargetMotionScript, ZombieState.WalkPastPoint,
                       [-25, 2, -309], 0xc000);
  ZombieScriptEnded(ahead);
  check("a captor whose point is already ahead turns on the player at once",
        ahead.state === ZombieState.AttackRun && ahead.sub === 0,
        `state ${ahead.state} sub ${ahead.sub}`);

  // Facing -X, so the same point is behind: it walks the leg first.
  const behind = captor(ZombieState.TargetMotionScript, ZombieState.WalkPastPoint,
                        [-25, 2, -309], 0x4000);
  ZombieScriptEnded(behind);
  check("...and one whose point is behind walks it first",
        behind.state === ZombieState.WalkPastPoint && behind.sub === 1,
        `state ${behind.state} sub ${behind.sub}`);

  // The role flip itself: a captor already *in* its attack state goes to
  // `AttackRun`, which is what ends the family for good.
  const done = captor(ZombieState.WalkPastPoint, ZombieState.WalkPastPoint,
                      [-25, 2, -309], 0x4000);
  ZombieScriptEnded(done);
  check("a captor that has finished its attack script goes to AttackRun",
        done.state === ZombieState.AttackRun, `state ${done.state}`);
}

// State 42, the camera-cue hold (`ZombieStateHoldForCameraCue`,
// `FUN_0045BFD0`). A captor that has finished its script and would turn on the
// player is instead **staged for a shot**: it runs at the player and holds at
// range, but may not land the blow until the camera reaches the path and frame
// in its descriptor tail. Three spawns in the game do this, all in stage 2.
{
  const staged = (cue: { path: number; frame: number } | null) => {
    ResetGameGlobals();
    const z = ActorSpawn(0xa030, SpawnClass.Zombie, 1, "staged captor");
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
        && held.delegate === ZombieState.AttackRun
        && (held.flags & ActorFlag.NoCameraTrack) !== 0,
        `state ${held.state} delegate ${held.delegate}`);

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
  held.attackPermit = 0;
  G.g_attack_permits[0] = 1;
  ZombieStateHoldForCameraCue(held, (o) => { o.state = ZombieState.Strike; });
  check("a delegate that reaches Strike is bounced, and gives the permit back",
        held.state === ZombieState.HoldForCameraCue
        && held.delegate === ZombieState.HoldAtRange
        && held.attackPermit === -1,
        `state ${held.state} delegate ${held.delegate} permit ${held.attackPermit}`);

  // The camera arrives: it graduates to the delegate and is visible again.
  G.g_active_cam_path = 75;
  G.g_cam_path_frame = 660;
  ZombieStateHoldForCameraCue(held, () => {});
  check("and it graduates when the camera reaches the cue",
        held.state === ZombieState.HoldAtRange
        && (held.flags & ActorFlag.NoCameraTrack) === 0,
        `state ${held.state} flags 0x${(held.flags >>> 0).toString(16)}`);
}

// -- the rain, which used to be unreachable from here ----------------------

console.log("\nrain: DrawRainParticles' simulation half");

{
  const rules: RainRules = {
    fallPerFrame: 2, respawnBelow: -7,
    spawn: { x: [0x14, -10], y: [0x32, -25], z: [0x19, -35] },
  };
  const rng = new Rng(1);
  ResetGameGlobals();
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
  RainResetParticles(rules, new Rng(7));
  const a = JSON.stringify(G.g_rain_particles);
  ResetGameGlobals();
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
          ThrowerTryClaimAttackSlot(z, offscreen)
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
      GameUpdate(EYE, 1 / 60, offscreen, rng, events);
      if (z.state === ThrowerState.Pounce) pounced = true;
      if (pounced && z.state === ThrowerState.StandAndDecide) break;
    }
    check("a thrower that has pounced once can claim again",
          pounced && G.g_attack_committed === 0
          && ThrowerTryClaimAttackSlot(z, offscreen),
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
    GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
    check("and a body sphere inside a wall its origin is clear of is pushed out",
          z.pos.x <= 26 + 1e-6, `x ${z.pos.x.toFixed(2)}`);
    // The sphere is the actor lifted by 1.4 radii, not by a constant: that is
    // `FUN_00449E80`'s own literal and it is what makes the body, rather than
    // the feet, the thing the wall pushes.
    check("the sphere sits 1.4 radii above a grounded thrower",
          Math.abs(z.camPoint.y - (z.pos.y + z.bodyRadius * 1.4)) < 1e-6,
          `${z.camPoint.y} vs ${z.pos.y}`);
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
    for (let i = 0; i < 10; i++) GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
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
    GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
    const off = 30 - z.pos.x;
    check("a thrower on a wall stands 6.5 units off it, not in it",
          Math.abs(off - 6.5) < 1e-3, `${off.toFixed(3)} off the wall`);
    // ...and that is enough for the body to be clear: the sphere is centred on
    // the actor's own y for a wall stance, so on the plane it would be half in.
    check("...which is what puts its body outside the geometry",
          !ColiTestSphereAgainstFullSet(z.camPoint.x, z.camPoint.y,
                                        z.camPoint.z, z.bodyRadius),
          `depth ${G.g_coli_hit_depth}`);
    check("and a wall stance leaves the sphere level with the actor",
          Math.abs(z.camPoint.y - z.pos.y) < 1e-6,
          `${z.camPoint.y} vs ${z.pos.y}`);
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

    ActorKillAll(0, rng);
    check("the kill leaves the hit its death chain reads",
          z.dead && z.pendingHit !== null,
          `dead ${z.dead} hit ${JSON.stringify(z.pendingHit)}`);
    // `ThrowerReleaseSlotOnDeath` (`FUN_0044D050`) runs on the first frame of
    // the fall, not when the body settles: the room clears when you land the
    // shot.
    GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
    check("...and it leaves `g_enemies_alive` on the first frame of the fall",
          G.g_enemies_alive === 0 && z.state === ThrowerState.FallAndLand,
          `alive ${G.g_enemies_alive} state ${z.state}`);

    // It must not leave twice, however many of the four fall states run.
    for (let i = 0; i < 600; i++) GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
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
    [SpawnClass.SetPieceProp, "0x24 set piece"],
    [SpawnClass.ScriptedHumanoid, "0x25 scripted humanoid"],
    [SpawnClass.Zombie, "0x30 zombie"],
    [SpawnClass.Thrower, "0x31 thrower"],
    [SpawnClass.PropContainerPlacer, "0x41 prop container placer"],
    [SpawnClass.PropPlacer, "0x44 prop placer"],
  ];
  for (const [cls, name] of want) {
    check(`${name} registered itself`,
          typeof g_class_handlers[cls]?.update === "function",
          `handler ${JSON.stringify(g_class_handlers[cls] ?? null)}`);
  }
  check("...and `PORTED_CLASSES` is those seven and nothing else",
        PORTED_CLASSES.length === want.length
        && want.every(([c]) => PORTED_CLASSES.includes(c)),
        PORTED_CLASSES.map((c) => `0x${c.toString(16)}`).join(","));
  // The cat is 0x53 and has no module. It must stay absent rather than fall
  // back to anything -- an `if` is what had it walking at the player.
  check("a class with no module has no row",
        g_class_handlers[0x53 as SpawnClass] === undefined);

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
  const z = ActorSpawn(0x2000, SpawnClass.Zombie, 1, "zombie");
  z.visible = true;
  z.hp = 10;
  check("one zombie is one enemy alive and present",
        G.g_enemies_alive === 1 && G.g_enemies_present === 1,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);
  check("...and it takes a permit", TryClaimAttackSlot(z, NULL_HOST));

  ActorDeadSweep(z, DeadSweep.Unloaded);
  check("an undrawn zombie gives the permit back",
        z.attackPermit === -1 && G.g_attack_permits[0] === -1);
  check("...and keeps both counts, because it is not dead",
        G.g_enemies_alive === 1 && G.g_enemies_present === 1,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);

  ActorDeadSweep(z, DeadSweep.Dead);
  check("a dead one leaves both, on the same frame",
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
        ThrowerTryClaimAttackSlot(w, NULL_HOST) && w.attackPermit >= 0);

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

  // A class with no `onDeadSweep` at all: the generic enemy release. Class
  // 0x51 has no module, so this is the fallback doing the only thing that can
  // honestly be said about an unread class.
  const f = ActorSpawn(0x2200, SpawnClass.WaterEnemy, 0, "water enemy");
  f.visible = true;
  G.g_enemies_alive = 1;
  G.g_enemies_present = 1;
  ActorDeadSweep(f, DeadSweep.Unloaded);
  check("an undrawn unported enemy keeps both counts",
        G.g_enemies_alive === 1 && G.g_enemies_present === 1,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);
  ActorDeadSweep(f, DeadSweep.Dead);
  check("...and a dead one leaves both",
        G.g_enemies_alive === 0 && G.g_enemies_present === 0,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);

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
  // Bone 1 -- the torso, the one bone in the fixture with a `Last` effect row
  // -- stands in for the head, so a "headshot" lands on a real table entry and
  // the score is the only thing under test.
  SetGameTables({
    ...CHARS, types: { "1": { ...TYPE, head_bone: 1 } },
  } as unknown as CharactersJson);
  for (const o of G.g_object_list) o.hp = 100;
  const [z0, z1, z2] = G.g_object_list;

  let pick: ShotPick | null = null;
  const host = { ...NULL_HOST, pickShot: () => pick };
  const RAY = { origin: vec3(0, 0, 0), dir: vec3(0, 0, 1) };
  const seen: { kind: string; points: number }[] = [];
  events.on("shot.resolved", (r) => seen.push({ kind: r.kind, points: r.points }));

  // A miss.
  pick = null;
  QueueShotRequest(0, RAY);
  check("a trigger pull waits on the queue", G.g_shot_requests.length === 1);
  check("...and carries the frame it was pulled on",
        G.g_shot_requests[0].frame === Math.round(G.g_frame),
        `${G.g_shot_requests[0].frame} vs ${G.g_frame}`);
  GameUpdate(EYE, 1 / 60, host, rng, events);
  check("the frame drains it", G.g_shot_requests.length === 0);
  check("a miss scores nothing", G.g_player_score[0] === 0
        && seen.at(-1)?.kind === "miss");
  check("but it is still a shot fired", G.g_nPlayerFired[0] === 1);

  // Two headshots, then a body shot.
  pick = { kind: "actor", at: z0.at, bone: 1, point: vec3() };
  QueueShotRequest(0, RAY);
  GameUpdate(EYE, 1 / 60, host, rng, events);
  check("a headshot pays 120", G.g_player_score[0] === 120,
        `${G.g_player_score[0]}`);
  check("...and arms `g_head_combo_bonus`, which is the engine's own global",
        G.g_head_combo_bonus[0] === 10, `${G.g_head_combo_bonus[0]}`);

  pick = { kind: "actor", at: z1.at, bone: 1, point: vec3() };
  QueueShotRequest(0, RAY);
  GameUpdate(EYE, 1 / 60, host, rng, events);
  check("the second consecutive headshot pays 130",
        G.g_player_score[0] === 250, `${G.g_player_score[0]}`);

  pick = { kind: "actor", at: z2.at, bone: 4, point: vec3() };
  QueueShotRequest(0, RAY);
  GameUpdate(EYE, 1 / 60, host, rng, events);
  check("a hit that is not on the head pays ten and clears the combo",
        G.g_player_score[0] === 260 && G.g_head_combo_bonus[0] === 0,
        `${G.g_player_score[0]} / ${G.g_head_combo_bonus[0]}`);
  check("and the hit reached `ResolveHit` -- hit points came off",
        z2.hp === 97, `hp ${z2.hp}`);

  // Two pulls between frames both land, in the order they were made.
  const before = G.g_player_score[0];
  pick = { kind: "actor", at: z2.at, bone: 4, point: vec3() };
  QueueShotRequest(0, RAY);
  QueueShotRequest(0, RAY);
  check("two pulls before the next frame both queue",
        G.g_shot_requests.length === 2);
  GameUpdate(EYE, 1 / 60, host, rng, events);
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
    GameUpdate(EYE, 1 / 60, host, rng, events);
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
  check("a scene reset empties the queue", G.g_shot_requests.length === 0);
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
  GameUpdate(EYE, 1 / 60, host, rng, events);
  check("the tracked bone becomes `obj+0x100`, raised by four",
        z.lookAt.x === 10 && z.lookAt.y === 24 && z.lookAt.z === 30,
        JSON.stringify(z.lookAt));

  const held = { ...z.lookAt };
  GameUpdate(EYE, 1 / 60, { ...NULL_HOST }, rng, events);
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
 * `FUN_0045DA60` (`0045db39 25fffffbff`), which an ordinary zombie never
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

  const zombie = (name: string, over: Partial<Actor> = {}): Actor => {
    const z = ActorSpawn(0x7900, SpawnClass.Zombie, 1, name);
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
    SetGameTables(CHARS);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
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
    ZombieStateHoldAtRange(z, EYE, new Rng(1), NULL_HOST);
    check("an actor that has already swung is exempt from the too-close retreat",
          z.state !== ZombieState.BackOff, ZombieState[z.state] ?? String(z.state));
  }
  {
    clear();
    const z = zombie("inside-the-ring, mid entry clip",
                     { pos: vec3(0, 0, INNER - 5) });
    z.flags2 |= ZombieFlag2.EntryClipPlaying;
    ZombieStateHoldAtRange(z, EYE, new Rng(1), NULL_HOST);
    check("...and so is one still playing its authored entry clip",
          z.state !== ZombieState.BackOff, ZombieState[z.state] ?? String(z.state));
  }
  {
    clear();
    const z = zombie("inside-the-ring, never swung",
                     { pos: vec3(0, 0, INNER - 5) });
    ZombieStateHoldAtRange(z, EYE, new Rng(1), NULL_HOST);
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
    ZombieStateBackOff(z, EYE, 1 / 60, new Rng(2));
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
    const z = zombie("cooling, never swung", { hasCooldown: true, cooldown: 10 });
    ZombieStateHoldAtRange(z, EYE, new Rng(3), NULL_HOST);
    check("a cooldown does not run down for an actor that has never swung",
          z.cooldown === 10, String(z.cooldown));
  }
  {
    clear();
    const z = zombie("cooling", { hasCooldown: true, cooldown: 2 });
    z.flags2 |= ZombieFlag2.StrikeAnchor;
    ZombieStateHoldAtRange(z, EYE, new Rng(3), NULL_HOST);
    check("...and does for one that has", z.cooldown === 1, String(z.cooldown));
    check("...with the latch still armed at one", z.hasCooldown,
          String(z.hasCooldown));
    ZombieStateHoldAtRange(z, EYE, new Rng(3), NULL_HOST);
    check("...and the latch disarms itself as the counter runs out",
          z.cooldown === 0 && !z.hasCooldown, `${z.cooldown}/${z.hasCooldown}`);
  }
  {
    clear();
    const z = zombie("cooling and idling",
                     { hasCooldown: true, cooldown: 30, motion: 12 });
    z.flags2 |= ZombieFlag2.StrikeAnchor;
    z.yaw = 0x4000;
    ZombieStateHoldAtRange(z, EYE, new Rng(3), NULL_HOST);
    check("a cooling zombie still plays the row's idle", z.motion === 10,
          String(z.motion));
    check("...and still turns to face you", z.yaw !== 0x4000,
          `0x${z.yaw.toString(16)}`);
  }
  {
    clear();
    const z = zombie("retreating with a cooldown",
                     { state: ZombieState.BackOff, hasCooldown: true,
                       cooldown: 50, pos: vec3(0, 0, INNER + 15) });
    z.flags2 |= ZombieFlag2.StrikeAnchor;
    ZombieStateBackOff(z, EYE, 1 / 60, new Rng(2));
    check("the retreat leaves an armed cooldown alone",
          z.state === ZombieState.HoldAtRange && z.cooldown === 50,
          `${z.state}/${z.cooldown}`);
  }
  {
    clear();
    const z = zombie("retreating without one",
                     { state: ZombieState.BackOff, cooldown: 50,
                       pos: vec3(0, 0, INNER + 15) });
    ZombieStateBackOff(z, EYE, 1 / 60, new Rng(2));
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
                       attack: 1, hasCooldown: true,
                       pos: vec3(0, 0, atk.distance + 20) });
    ZombieStateStrike(z, EYE, new Rng(4));
    check("a cooldown-armed attacker starts the swing where it stands",
          z.sub === StrikeSub.Swinging && z.action?.motion === atk.strike,
          `${z.sub}/${z.action?.motion}`);
  }
  {
    clear();
    const atk = TYPE.attacks["0"]["1"];
    const z = zombie("ordinary attacker",
                     { state: ZombieState.Strike, sub: StrikeSub.Lunge,
                       attack: 1, pos: vec3(0, 0, atk.distance + 20) });
    ZombieStateStrike(z, EYE, new Rng(4));
    check("...and one without the latch still lunges in",
          z.sub === StrikeSub.Lunge && z.action?.motion === atk.lunge,
          `${z.sub}/${z.action?.motion}`);
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
    ZombieStateBackOff(z, EYE, 1 / 60, new Rng(2));
    check("condition 4 leaves the retreat at 0.7 of the ring",
          z.state === ZombieState.HoldAtRange,
          ZombieState[z.state] ?? String(z.state));
  }
  {
    clear();
    const z = zombie("whole, retreating",
                     { state: ZombieState.BackOff, condition: 0,
                       pos: vec3(0, 0, INNER * 0.8) });
    ZombieStateBackOff(z, EYE, 1 / 60, new Rng(2));
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
    ZombieStateHoldAtRange(z, EYE, new Rng(5), NULL_HOST);
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
    for (let i = 0; i < 7; i++) ZombieStateBackOff(z, EYE, 1 / 50, new Rng(2));
    check("`backoffFrames` counts updates, not seconds", z.backoffFrames === 7,
          String(z.backoffFrames));
  }
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
