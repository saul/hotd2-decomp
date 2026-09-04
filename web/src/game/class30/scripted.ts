/**
 * The class-0x30 entrances that **attack**.
 *
 * Four states, nineteen spawns, and the thing they have in common is that
 * none of them goes through the attack loop. `AttackRun -> HoldAtRange ->
 * Strike` is a negotiation — rank, allowance, a permit, a distance — and
 * every state here skips all of it: the level has decided this actor hits you
 * at this moment from this spot, and the state simply does it.
 *
 * That is why they were the worst of the twelve to leave unported.
 * `ZombieEntryState` sent them to `AttackRun`, so a zombie scripted to drag
 * you under at a fixed camera frame instead jogged at you from wherever it
 * spawned and joined the queue like anything else.
 *
 * Three of the four pick their own player rather than taking whoever the
 * permit system offers, and they do it with the same inlined routine — see
 * {@link ZombieScriptedPickPlayer}.
 */
import { SecondsToTicks } from "../tables";
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { ActorFlag, ZombieFlag2, type ZombieActor } from "../actor";
import { ActorFacePlayerTarget } from "../actor_turn";
import { IsPlayerAttackable, PlayerTakeDamage } from "../combat/player";
import { ReleaseAttackSlot, TryClaimAttackSlot } from "../combat/permits";
import { ActorByAt, G } from "../globals";
import {
  AttackListOf, FirstBakedOf, MotionPlayFrame, MotionPlayLength, MotionRowOf,
} from "../tables";
import { ActorStrikeConnect, ZombiePickAttack } from "./strike";
import { ZombieReleaseAndDespawn } from "./walk_distance";
import { ActorSetMotion, ActorSetMotionBlended, ZombieSetMotionIfIdle }
  from "./motion_cue";
import { MotionFade, MotionRow, ZombieState } from "./states";
import type { Vec3 } from "../vec";

/**
 * `obj+0x34` bit `0x80000`, raised with {@link ActorFlag.NoCameraTrack} and
 * {@link ActorFlag.ShotImmune} by `ZombieStateWaitForCameraFrame`'s freeze arm
 * and cleared again on the cue — `obj+0x34 |= 0x90100`, then `&= 0xFFF6FEFF`.
 *
 * [open] Nothing else in the ported call graph reads it. Kept as a literal
 * rather than given a name from where it sits.
 */
const WAIT_FREEZE_BIT = 0x80000;

/**
 * `ZombieStateScriptedGrabAndDespawn`'s special clip pair. When the
 * descriptor names `0xBA`, the state plays `0xBB` while it waits and blends
 * `0xBA` on the cue; every other clip is played directly and frozen.
 */
const GRAB_MOTION_PAIRED = 0xba;
const GRAB_MOTION_WAIT = 0xbb;
/**
 * `PlayerTakeDamage`'s third argument for the grab: 9, unless the clip is
 * `0xB1`, in which case 0. Two of the six shipped spawns play exactly `0xB1`.
 */
const GRAB_HIT_KIND = 9;
const GRAB_HIT_KIND_MOTION = 0xb1;
const GRAB_EFFECT = 0x62;

/** `ZombieStateLeapToPoint`'s damage kind — `PlayerTakeDamage(p, 1, 7)`. */
const LEAP_HIT_KIND = 7;

/** `ZombieStateDelayedStrikeInPlace` gives up 0x14 frames after the cue. */
const CARRIER_GIVE_UP_FRAMES = 0x14;

/**
 * The player pick that `ZombieStateLeapToPoint` and
 * `ZombieStateDelayedStrikeInPlace` both **inline**.
 *
 * The engine has no shared function for it: both states carry the same
 * instructions. It is not `TryClaimAttackSlot` — that reads the off-screen
 * commit latch first and picks by distance, and neither of these states wants
 * either. A scripted attacker takes the player its descriptor names, falls
 * back to the other one if that player is out or already spoken for, and gives
 * up only when neither can be hit.
 *
 * `player` is the descriptor's own byte, `-1` meaning "either", which is when
 * the coin is tossed. Returns the chosen permit index, or -1.
 */
export function ZombieScriptedPickPlayer(want: number, rng: Rng): number {
  // `rand() & 0x80000001`, sign-corrected — the engine's way of writing
  // `rand() % 2` for a signed int.
  let p = want === -1 ? rng.int(2) : want;
  if (!IsPlayerAttackable(p) || G.g_attack_permits[p] === 1) {
    // Swap to the other player, and only if *that* one is both attackable and
    // unclaimed. The engine spells both arms out rather than looping.
    const other = p === 0 ? 1 : 0;
    p = (IsPlayerAttackable(other) && G.g_attack_permits[other] === 0)
      ? other : -1;
  }
  return p;
}

/** The clip's last frame, on the play clock. Equality: the cursor wraps. */
function atLastFrame(obj: ZombieActor): boolean {
  const len = MotionPlayLength(obj);
  return len > 0 && MotionPlayFrame(obj) === len - 1;
}

/**
 * `ZombieStateWaitForCameraFrame` — `FUN_00457620`, class 0x30 state 19.
 *
 * Four spawns. Holds — optionally *frozen*, which is what its `tail+0x0C`
 * selects — until the camera path reaches an exact frame, then optionally
 * claims an attack permit and, having claimed one, counts a delay down and
 * goes straight to the strike.
 *
 * **This is the only place in class 0x30 that arms the attack cooldown.** It
 * sets `obj+0x1368` bit 0 and `obj+0x133C` from `tail+0x10`; every other
 * zombie has that bit clear, and `ZombieStateHoldAtRange` therefore forces the
 * cooldown to zero. So for an ordinary zombie there is no wait between swings
 * beyond the strike clip and the retreat — and for these four there is.
 */
export function ZombieStateWaitForCameraFrame(obj: ZombieActor, dt: number): void {
  const t = obj.entry;

  if (obj.sub === 0) {
    if (t?.freeze) {
      // `FUN_00409D10(model, 0)` stops the clip and `obj+0x1F8 &= ~1` takes
      // the root motion off so it cannot drift; 0x90100 hides it from the
      // camera and the shot test.
      //
      // The port has no per-actor root-motion switch and does not need one:
      // root motion is the frame-to-frame delta of a clip, so freezing the
      // clock freezes it too. See `root_motion.ts` — `obj+0x1F8` is 3 for
      // every skeletal actor in the game and nothing else ever clears it.
      obj.frozen = 1;
      obj.flags |= ActorFlag.NoCameraTrack | ActorFlag.ShotImmune
                 | WAIT_FREEZE_BIT;
    }
    obj.sub = 1;
  }

  if (obj.sub === 1) {
    if (!(obj.flags & ActorFlag.Reacting)
        && t?.motion !== undefined && obj.motion !== t.motion) {
      ActorSetMotion(obj, t.motion);
    }
    if (G.g_cam_path_frame !== (t?.cue_frame ?? -1)) return;
    obj.sub = 2;
  }

  if (obj.sub === 2) {
    obj.frozen = 0;
    if (t?.freeze) {
      obj.flags &= ~(ActorFlag.NoCameraTrack | ActorFlag.ShotImmune
                   | WAIT_FREEZE_BIT);
    }
    // `tail+0x0D` says whether to claim at all, and a failed claim is not an
    // error: the actor simply takes the descriptor's branch instead.
    if (!t?.claim || !TryClaimAttackSlot(obj)) {
      obj.state = obj.attackState;
      obj.sub = 0;
      return;
    }
    obj.zom.holdFrames = t?.delay ?? 0;
    obj.sub = 3;
  }

  if (obj.sub !== 3) return;
  obj.zom.holdFrames -= SecondsToTicks(dt);
  if (obj.zom.holdFrames >= 1) return;
  // `obj+0x1368 |= 1` — the flag that lets `ZombieStateHoldAtRange` keep a
  // cooldown instead of zeroing it — and the cooldown itself.
  obj.zom.hasCooldown = true;
  obj.cooldown = t?.cooldown ?? 0;
  obj.state = ZombieState.Strike;
  obj.sub = 0;
}

/**
 * `ZombieStateScriptedGrabAndDespawn` — `FUN_00457B50`, class 0x30 state 23.
 *
 * Six spawns, and **the only class-0x30 entrance that ends in a despawn**
 * rather than in another state. The actor plays a grab, takes the player on
 * an exact clip frame, and removes itself: a set-piece kill, not a fight.
 *
 * Two of the six have a cue of `-1`, which fires at once — those are stage
 * 1's pair, whose clip is `0xB1` and whose damage kind is therefore 0 rather
 * than 9.
 */
export function ZombieStateScriptedGrabAndDespawn(obj: ZombieActor, eye: Vec3,
                                                  events?: Events): void {
  const t = obj.entry;
  if (!t) { obj.state = ZombieState.AttackRun; obj.sub = 0; return; }

  if (obj.sub === 0) {
    obj.zom.holdFrames = t.cue_frame ?? -1;
    if (t.motion === GRAB_MOTION_PAIRED) {
      ActorSetMotion(obj, GRAB_MOTION_WAIT);
      obj.flags |= ActorFlag.ShotImmune;
    } else {
      if (t.motion !== undefined) ActorSetMotion(obj, t.motion);
      obj.flags |= ActorFlag.PoseFrozen | ActorFlag.ShotImmune;
      obj.frozen = 1;
    }
    obj.flags2 |= ZombieFlag2.Carried;
    obj.sub = 1;
    return;
  }

  if (obj.sub === 1) {
    // `-1` fires at once; otherwise the camera path frame must equal it.
    if (obj.zom.holdFrames !== -1 && G.g_cam_path_frame !== obj.zom.holdFrames) return;
    if (t.motion === GRAB_MOTION_PAIRED) {
      ActorSetMotionBlended(obj, GRAB_MOTION_PAIRED, 0, 1);
    }
    TryClaimAttackSlot(obj);
    ActorFacePlayerTarget(obj, eye);
    obj.flags &= ~(ActorFlag.PoseFrozen | ActorFlag.ShotImmune);
    obj.frozen = 0;
    // `obj+0x13C4 = obj+0x44` — the y the actor is pinned at for the grab.
    obj.arcFrom.y = obj.pos.y;
    obj.sub = 2;
  }

  if (obj.sub === 2) {
    if (MotionPlayFrame(obj) !== (t.hit_frame ?? -1)) return;
    if (obj.attackPermit >= 0) {
      PlayerTakeDamage(obj.attackPermit, obj,
                       obj.motion === GRAB_HIT_KIND_MOTION ? 0 : GRAB_HIT_KIND,
                       events);
    }
    obj.sub = 3;
  }

  if (obj.sub !== 3) return;
  if (!atLastFrame(obj)) return;
  events?.emit("feed.note", {
    name: "zombie", cat: "combat",
    note: `scripted grab ends — effect ${GRAB_EFFECT}`,
  });
  ZombieReleaseAndDespawn(obj);
}

/**
 * `ZombieStateLeapToPoint` — `FUN_00457CE0`, class 0x30 state 24.
 *
 * Six spawns, all stage 3. A **stationary attacker at a scripted point**: it
 * flies to the point its descriptor names over a fixed number of frames, then
 * loops — wait, pick a player, swing, damage on an exact frame, release,
 * wait again — for ever. It never approaches and never leaves.
 *
 * The velocity is `(dest - pos) / frames` and `EnemyZombieUpdate` integrates
 * it, which is why nothing here moves the actor during sub 1. Every sub past 1
 * **pins** the position back to where the flight ended, so the actor cannot be
 * shoved off its perch by the crowd push.
 */
export function ZombieStateLeapToPoint(obj: ZombieActor, eye: Vec3, dt: number,
                                       rng: Rng, events?: Events): void {
  const t = obj.entry;
  if (!t?.dest) { obj.state = ZombieState.AttackRun; obj.sub = 0; return; }
  const frames = SecondsToTicks(dt);

  if (obj.sub === 0) {
    if (t.idle_motion !== undefined) ActorSetMotion(obj, t.idle_motion);
    obj.flags |= ActorFlag.ArcSpent;
    obj.flags2 |= ZombieFlag2.Carried;
    obj.zom.holdFrames = t.frames ?? 1;
    const n = Math.max(1, obj.zom.holdFrames);
    obj.vel.x = (t.dest[0] - obj.pos.x) / n;
    obj.vel.y = (t.dest[1] - obj.pos.y) / n;
    obj.vel.z = (t.dest[2] - obj.pos.z) / n;
    obj.sub = 1;
  } else if (obj.sub === 1) {
    obj.zom.holdFrames -= frames;
    if (obj.zom.holdFrames > 0) return;
    // Landed. `obj+0x13C0/C4/C8` is the perch every later sub pins back to.
    obj.arcFrom.x = obj.pos.x;
    obj.arcFrom.y = obj.pos.y;
    obj.arcFrom.z = obj.pos.z;
    obj.vel.x = obj.vel.y = obj.vel.z = 0;
    obj.accX = obj.accY = obj.accZ = 0;
    obj.zom.holdFrames = t.delay ?? 0;
    obj.sub = 2;
  }

  if (obj.sub === 2) {
    // `g_players_in_play` — a count, so this is "has the game started", not
    // "are there two players". See `globals.ts`.
    if (G.g_players_in_play === 0) { ZombieLeapPin(obj); return; }
    obj.sub = 3;
  }

  if (obj.sub === 3) {
    obj.zom.holdFrames -= frames;
    if (obj.zom.holdFrames > 0 || G.g_players_in_play === 0) {
      ZombieLeapPin(obj);
      return;
    }
    const p = ZombieScriptedPickPlayer(t.player ?? -1, rng);
    obj.attackPermit = p;
    if (p === -1) { ZombieLeapPin(obj); return; }
    G.g_attack_permits[p] = 1;
    ActorFacePlayerTarget(obj, eye);
    obj.flags &= ~ActorFlag.PoseFrozen;
    if (t.strike_motion !== undefined) {
      ActorSetMotionBlended(obj, t.strike_motion, 0, MotionFade.Quick);
    }
    obj.sub = 4;
  }

  if (obj.sub === 4) {
    if (MotionPlayFrame(obj) === (t.hit_frame ?? -1)) {
      if (obj.attackPermit >= 0) {
        PlayerTakeDamage(obj.attackPermit, obj, LEAP_HIT_KIND, events);
      }
      obj.sub = 5;
    }
  }

  if (obj.sub === 5 && atLastFrame(obj)) {
    ReleaseAttackSlot(obj);
    // Back to sub 2 — never out of the state. The re-arm is twice the delay.
    obj.zom.holdFrames = (t.delay ?? 0) * 2;
    if (t.idle_motion !== undefined) {
      ActorSetMotionBlended(obj, t.idle_motion, rng.int(10), MotionFade.Quick);
    }
    obj.sub = 2;
  }

  ZombieLeapPin(obj);
}

/**
 * `if (1 < obj+0x1312) pos = obj+0x13C0..0x13C8` — the perch.
 *
 * Every sub past the flight rewrites the position from the point the flight
 * ended at, so `ZombiePushOutOfWorldAndActors` cannot walk the actor off it.
 */
function ZombieLeapPin(obj: ZombieActor): void {
  if (obj.sub <= 1) return;
  obj.pos.x = obj.arcFrom.x;
  obj.pos.y = obj.arcFrom.y;
  obj.pos.z = obj.arcFrom.z;
}

/**
 * `ZombieStateDelayedStrikeInPlace` — `FUN_0045E830`, class 0x30 state 32.
 *
 * Three spawns, all stage 5, and the only class-0x30 state whose handler sits
 * outside the table's contiguous run — `0x0045E830` is past the whole captor
 * family. A stationary attacker on a timer: it stands where it spawned, waits
 * out `tail+0x04`, then swings at a player every `tail+0x06` frames for ever.
 *
 * Unlike `ZombieStateLeapToPoint` it draws a **real attack** out of
 * `g_class30_attack_picks`, so the swing is one of the character's own and
 * `ActorStrikeConnect` decides whether it lands — which means shooting the arm
 * off stops it, exactly as it does in the ordinary loop.
 */
export function ZombieStateDelayedStrikeInPlace(obj: ZombieActor, eye: Vec3,
                                                dt: number, rng: Rng,
                                                events?: Events): void {
  const t = obj.entry;
  const frames = SecondsToTicks(dt);

  if (obj.sub === 0) {
    obj.zom.holdFrames = t?.delay ?? 0;
    obj.sub = 1;
  } else if (obj.sub === 1) {
    obj.zom.holdFrames -= frames;
    if (obj.zom.holdFrames > 0) { ZombieDelayedStrikeIdle(obj, rng); return; }
    obj.sub = 2;
  }

  if (obj.sub === 2) {
    obj.zom.holdFrames = t?.rearm ?? 0;
    obj.sub = 3;
  }

  if (obj.sub === 3) {
    if (G.g_players_in_play === 0) { ZombieDelayedStrikeIdle(obj, rng); return; }
    obj.sub = 4;
  }

  if (obj.sub === 4) {
    obj.zom.holdFrames -= frames;
    if (obj.zom.holdFrames > 0 || G.g_players_in_play === 0) {
      ZombieDelayedStrikeIdle(obj, rng);
      return;
    }
    const p = ZombieScriptedPickPlayer(t?.player ?? -1, rng);
    obj.attackPermit = p;
    if (p === -1) { ZombieDelayedStrikeIdle(obj, rng); return; }
    G.g_attack_permits[p] = 1;
    ActorFacePlayerTarget(obj, eye);
    // `obj+0x34 |= 0x10000000` — mid-attack, and the idle below stops.
    obj.flags |= ActorFlag.Committed;
    // The same draw `ZombieStateStrike` sub 0 makes: `rand() % 10` plus ten
    // per destroyed zone, into the character's own pick list.
    obj.attack = ZombiePickAttack(obj, rng);
    const entry = AttackListOf(obj)[String(obj.attack)];
    if (entry) ActorSetMotionBlended(obj, entry.strike, 0, MotionFade.Quick);
    obj.sub = 5;
  }

  if (obj.sub === 5) {
    ActorFacePlayerTarget(obj, eye);
    const entry = AttackListOf(obj)[String(obj.attack)];
    if (entry && MotionPlayFrame(obj) === entry.hit_frame) {
      ActorStrikeConnect(obj, entry, events);
    }
    if (atLastFrame(obj)) {
      ReleaseAttackSlot(obj);
      obj.sub = 0;
      obj.flags &= ~ActorFlag.Committed;
    }
  }

  ZombieDelayedStrikeIdle(obj, rng);
  ZombieDelayedStrikeGiveUp(obj, dt);
}

/**
 * The idle every sub of state 32 falls through to:
 * `if (!(obj+0x34 & 0x10000000) && obj+0x1B4 != row[...]) play it`.
 *
 * `row[(obj+0x136C >> 0x15) & 1]` — the walk pair, selected on the same bit
 * `ZombieStateApproach` reads, from `rand() % 5`.
 */
function ZombieDelayedStrikeIdle(obj: ZombieActor, rng: Rng): void {
  if (obj.flags & ActorFlag.Committed) return;
  const row = MotionRowOf(obj);
  const alt = (obj.flags2 >>> 0x15) & 1;
  const motion = FirstBakedOf(obj, row,
                              alt ? MotionRow.WalkAlt : MotionRow.Walk,
                              MotionRow.Walk, MotionRow.WalkAlt);
  ZombieSetMotionIfIdle(obj, motion, rng, 5, MotionFade.Quick);
}

/**
 * State 32's other watch: `g_carrier_object`'s `obj+0x34` bit 0x40000000.
 *
 * While that bit is clear the counter at `obj+0x1334` is held at zero; once it
 * is set the counter runs, and at `0x14` the actor abandons the fight for
 * state 10 — `ActorAbortAttackAndLeave`, which releases the permit. It is how
 * a scripted attacker gets out of the way when the ride it belongs to ends.
 *
 * [diverges] The port has no rideable object, so `g_carrier_object` is -1, the
 * counter never starts and these three spawns keep swinging rather than
 * retiring. See `entrance.ts`'s note on `ZombieStateRideCarrier` — the same
 * missing piece, and the same fix would clear both.
 */
function ZombieDelayedStrikeGiveUp(obj: ZombieActor, dt: number): void {
  const carrier = G.g_carrier_object >= 0
    ? ActorByAt(G.g_carrier_object) : undefined;
  if (!carrier || !(carrier.flags2 & ZombieFlag2.CollideActors)) {
    obj.zom.backoffFrames = 0;
    return;
  }
  obj.zom.backoffFrames += SecondsToTicks(dt);
  if (obj.zom.backoffFrames <= CARRIER_GIVE_UP_FRAMES) return;
  obj.state = ZombieState.Leave;
  obj.sub = 0;
}
