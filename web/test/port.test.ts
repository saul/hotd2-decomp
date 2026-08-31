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
import { Events } from "../src/core/events";
import { ActorSpawn, GameUpdate } from "../src/game/director";
import { ActorAdvanceMotion } from "../src/game/motion";
import { G, ResetGameGlobals } from "../src/game/globals";
import { NULL_HOST } from "../src/game/host";
import { SetGameTables } from "../src/game/tables";
import { ZombieState } from "../src/game/class30/states";
import { ZombieStateWaitTurn } from "../src/game/class30/wait_turn";
import { SpawnClass } from "../src/game/spawn_class";
import { ThrowerState } from "../src/game/class31/states";
import { dist2d, vec3, type Vec3 } from "../src/game/vec";
import { EffectCode, ResolveHit } from "../src/game/combat/resolve_hit";
import type { BreakablesJson } from "../src/bundle";
import {
  BreakableState, BreakablePropTakeShot, BreakablePropUpdate,
  BreakableSlot, GrantExtraLife, ItemSet, MEMBERS_PER_GROUP,
  PlaceBreakableGroup, PropContainerPlacerUpdate, PlaceKindedProp,
  KindedPropUpdate, PropFamily, KIND_SLOT, SLOT_NONE, PlaceGenericProp,
} from "../src/game/class41";
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
const motion = (frames: number, perFrame = 0) => ({
  bank: "t", frames, fps: 30,
  root: Array.from({ length: frames * 3 },
                   (_, i) => (i % 3 === 2 ? -perFrame * Math.floor(i / 3) : 0)),
  rot: [],
});

const TYPE: CharacterType = {
  type: 1, name: "test zombie", file: "t.bin", bone_count: 16,
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
  },
  attack_picks: { "0": new Array(80).fill(1) },
  throw: null,
  motion_row: { "0": [10, 10, 12, 12, 14] },
  backoff_index: 4,
  gore: {}, torso_stages: 3,
  motions: {
    // 10 the in-place walk and idle, 12 the run that closes, 14 the retreat.
    "10": motion(20), "12": motion(16, 1.289), "14": motion(36, -0.429),
    // 101 the lunge, which carries the actor the last few units into range.
    // The bite, scaled like the real one: `char_adv00`'s runs to -15.55 net
    // against a 25-unit inner ring, so the recover is most of the ring and the
    // retreat that walks it back is the pause between bites.
    "100": motion(20, 0.8), "101": motion(20, 0.6),
    "900": motion(30), "901": motion(30), "902": motion(30), "903": motion(30),
    "960": motion(39), "961": motion(39), "974": motion(29), "977": motion(29),
    "979": motion(29), "981": motion(29), "982": motion(29),
  },
};

const APPROACH: ApproachJson = {
  rings: [{ inner: 25, mid: 38, outer: 51 }],
  steps: { base: 2, mid_add: 3, outer_add: 4 },
  ring_set_for_char0: 1,
};

const TRACKING: TrackingJson = {
  curves: [new Array(64).fill(16)], curve: 0, error_clamp: 0x1fff,
  rate_untracked: 12, lookat_radius: 100, distance_scale: 10,
  attack_slots: 2, slots: 8, max_candidates: 14, face_offset: 12,
};

const PLAYER: PlayerDamageJson = {
  life_cost: 1, score: -100, invuln_frames: 90, rank_delta: 2, start_lives: 2,
};

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
  reaction_blend: { frames: 10, sever: 20, hard_set_from_bone: 9 },
  deaths: { front: [900], back: [901], left: 902, right: 903, arc: 0x2000 },
  difficulty: {
    hp_delta: [0, 0, 0, 0, 0], hp_min: 1, hp_max: 300,
    initial_rank: [0, 0, 2, 0, 0], default: 2,
  },
  combat: undefined,
  note: "",
} as unknown as CharactersJson;

const EYE = vec3(0, 0, 0);


function scene(n: number, rng: Rng): Events {
  ResetGameGlobals();
  SetGameTables(CHARS);
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
  const phases = new Set(G.g_object_list.map((o) => o.clock.toFixed(4)));
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
        z.state === ThrowerState.StandAndThrow, `state ${z.state}`);
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
  check("and only then starts throwing",
        z.state === ThrowerState.StandAndThrow, `state ${z.state}`);
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

  // `TryClaimAttackSlot` calls `ActorIsOnScreen` (`FUN_00409C10`) first, so an
  // enemy off the side of the frame cannot start an attack -- nor sit on the
  // one permit while it is out of shot.
  const offscreen = {
    ...NULL_HOST,
    viewSpaceOf: (_at: number, out: Vec3) => {
      out.x = 900; out.y = 0; out.z = 40;   // far off the right of a 640-wide frame
      return true;
    },
  };
  for (let i = 0; i < 600; i++) GameUpdate(EYE, 1 / 60, offscreen, rng, events);
  check("an enemy off the side of the frame takes no permit",
        z.attackPermit === -1 && G.g_attack_permits.every((p) => p === -1),
        `permit ${z.attackPermit}`);

  const onscreen = {
    ...NULL_HOST,
    viewSpaceOf: (_at: number, out: Vec3) => {
      out.x = 0; out.y = 0; out.z = 40;
      return true;
    },
  };
  let claimed = false;
  for (let i = 0; i < 600 && !claimed; i++) {
    GameUpdate(EYE, 1 / 60, onscreen, rng, events);
    if (z.attackPermit >= 0) claimed = true;
  }
  check("and the same enemy in shot does", claimed, `permit ${z.attackPermit}`);
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

// -- 5. the snapshot round-trips, exactly -----------------------------------

console.log("save state:");
{
  const digest = (): string => JSON.stringify({
    g: G.g_object_list.map((o) => [
      o.at, o.state, o.sub, o.attackPermit, o.pos.x.toFixed(6),
      o.pos.z.toFixed(6), o.yaw.toFixed(6), o.attack, o.zones,
    ]),
    lives: G.g_player_lives, invuln: G.g_player_invuln_frames,
    permits: G.g_attack_permits, score: G.g_player_score,
    look: G.g_camera_lookat_target,
  });

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
    { at: 0xa100, container: "group", group: 1, lifetime_evt_blocks: 4 },
    { at: 0xa200, container: "group", group: 2, lifetime_evt_blocks: 6 },
  ],
  level_height: 7.540296,
};

function propScene(rng: Rng): Events {
  ResetGameGlobals();
  SetGameTables(CHARS, BREAKABLES);
  G.g_player_lives = [PLAYER.start_lives, PLAYER.start_lives];
  G.g_camera_fixed_eye_y = 0;
  G.g_GameMode = 0;
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
    G.g_evt_block_counter = b;
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
    lifetime_evt_blocks: 0, pos: [5, 6, 7], pitch: 0x100, yaw: 0x2000,
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
    lifetime_evt_blocks: 0, pos: [0, 0, 0],
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
    { op: HumanoidOp.SetHitMode, mode: 2, a: 0, b: 0 },
    { op: HumanoidOp.TurnMode, mode: 1, a: 0, b: 0 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 30, b: 0 },
    { op: HumanoidOp.Kill, mode: 0, a: 0, b: 0 },
  ]);
  hFrame(a, events, rng);
  check("a run of setup commands all take effect in one frame",
        a.pos.x === 5 && a.pos.z === 7 && a.hitMode === 2
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
  const before = a.clock;
  ActorAdvanceMotion(a, 1 / 60);
  check("a frozen set-piece holds its pose", a.clock === before);
  a.frozen = 0;
  ActorAdvanceMotion(a, 1 / 60);
  check("and an unfrozen one does not", a.clock > before);
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
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
