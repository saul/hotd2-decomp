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
import { Zombie1368Flag } from "./state";
import { SecondsToTicks } from "../tables";
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import {
  ActorFlag, MotionFlag, ZombieAux, ZombieFlag2, type ZombieActor,
} from "../actor";
import { ActorSetPartVisibility } from "../model_draw";
import { ActorFacePlayerTarget, TurnActorTowardCameraEye }
  from "../actor_turn";
import { CARRIER_TURN_RATE, CamCueHit } from "./entrance";
import { IsPlayerAttackable, PlayerTakeDamage } from "../combat/player";
import { ReleaseAttackSlot, TryClaimAttackSlot } from "../combat/permits";
import { ActorByAt, G } from "../globals";
import {
  AttackListOf, MotionPlayFrame, MotionPlayLength, MotionRowOf,
} from "../tables";
import { ActorStrikeConnect, ZombiePickAttack } from "./strike";
import { ZombieReleaseAndDespawn } from "./walk_distance";
import { ActorSetMotion, ActorSetMotionBlended, ZombieSetMotionIfIdle }
  from "./motion_cue";
import { MotionFade, ZombieState, ZombieWaitMotion } from "./states";
import { vec3 } from "../vec";
import type { GameHost } from "../host";
import { SpawnSpriteEffect, SpriteEffectKind } from "../effects/sprite";
import { ZombieStrikeStartSplash } from "./splash";

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
 * commit latch first and never falls back to the other player, and neither of
 * these states wants either. A scripted attacker takes the player its
 * descriptor names, falls back to the other one if that player is out or
 * already spoken for, and gives up only when neither can be hit.
 *
 * The engine's tests are `CMP [g_attack_permits + p*4], 1` for "spoken for"
 * and `TEST EAX, EAX` for "free" (`0x00457E32`, `0x00457E5F`), against the
 * 1 every claim stores. The port stores the holder's `at` and frees with -1,
 * so the same two questions are `!== -1` and `=== -1` here. They were
 * `=== 1` and `=== 0`, which saw neither a permit `TryClaimAttackSlot` held
 * nor a free one, so a scripted attacker took a player's permit from under a
 * zombie that held it and never fell back to the other player.
 *
 * `player` is the descriptor's own byte, `-1` meaning "either", which is when
 * the coin is tossed. Returns the chosen permit index, or -1.
 */
export function ZombieScriptedPickPlayer(want: number, rng: Rng): number {
  // `rand() & 0x80000001`, sign-corrected — the engine's way of writing
  // `rand() % 2` for a signed int.
  let p = want === -1 ? rng.int(2) : want;
  if (!IsPlayerAttackable(p) || G.g_attack_permits[p] !== -1) {
    // Swap to the other player, and only if *that* one is both attackable and
    // unclaimed. The engine spells both arms out rather than looping.
    const other = p === 0 ? 1 : 0;
    p = (IsPlayerAttackable(other) && G.g_attack_permits[other] === -1)
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
 * Four spawns. Holds — optionally **hidden**, which is what its `tail+0x0C`
 * selects — until the camera path reaches an exact frame, then optionally
 * claims an attack permit and, having claimed one, counts a delay down and
 * goes straight to the strike.
 *
 * The hide is `tail+0x0C == 0` — `MOV AL, [EDI + 0xc]` / `TEST AL, AL` /
 * `JNZ` past it at `0x00457643` — and it is three writes, none of which
 * touches the clock:
 *
 * ```
 * 00457653  CALL 0x00409d10          ; ActorSetPartVisibility(model, 0)
 * 00457664  OR   ECX, 0x90100        ; no camera, no shot, no shadow
 * 0045766a  AND  AL, 0xfe            ; obj+0x1F8 &= ~1: no skeleton
 * ```
 *
 * The cue undoes it: `ActorSetPartVisibility(model, 1)` at `0x004576CA`
 * **unconditionally**, and `obj+0x1F8 |= 1` / `obj+0x34 &= 0xfff6feff` only
 * for the hidden kind. `[proved]`
 *
 * This used to say that `FUN_00409D10` "stops the clip" and `obj+0x1F8` bit 0
 * is root motion, and froze the clock (`obj+0x1324`) for the wait. The first
 * is `ActorSetPartVisibility` and the second is {@link
 * MotionFlag.Drawn}; root motion is bit 1, and nothing here writes
 * `obj+0x1324` or `obj+0x34` bit `0x4000`. The clip plays. The exporter's
 * name for the byte, `freeze`, is the same misreading, and its polarity is
 * right: `freeze` is `tail+0x0C == 0`.
 *
 * **This is the only place in class 0x30 that arms the attack cooldown.** It
 * sets `obj+0x1368` bit 0 and `obj+0x133C` from `tail+0x10`; every other
 * zombie has that bit clear, and `ZombieStateHoldAtRange` therefore forces the
 * cooldown to zero. So for an ordinary zombie there is no wait between swings
 * beyond the strike clip and the retreat — and for these four there is.
 */
export function ZombieStateWaitForCameraFrame(obj: ZombieActor, dt: number,
                                              rng: Rng): void {
  const t = obj.entry;
  const hide = t?.freeze === true;

  if (obj.sub === 0) {
    if (hide) {
      ActorSetPartVisibility(obj, 0);
      obj.flags |= ActorFlag.NoCameraTrack | ActorFlag.ShotImmune
                 | ActorFlag.NoShadow;
      obj.motionFlags &= ~MotionFlag.Drawn;
    }
    // `INC word ptr [ESI + 0x1312]` at `0x00457675` and on into sub 1.
    obj.sub = 1;
  }

  if (obj.sub === 1) {
    if (!(obj.flags & ActorFlag.Reacting)
        && t?.motion !== undefined && obj.motion !== t.motion) {
      ActorSetMotion(obj, t.motion);
    }
    // `0x004576A6`/`0x004576AE`: either camera block's frame, which is
    // `CamCueHit`.
    if (!CamCueHit(t?.cue_frame ?? -1)) return;
    obj.sub = 2;
  }

  if (obj.sub === 2) {
    ActorSetPartVisibility(obj, 1);
    if (hide) {
      obj.motionFlags |= MotionFlag.Drawn;
      obj.flags &= ~(ActorFlag.NoCameraTrack | ActorFlag.ShotImmune
                   | ActorFlag.NoShadow);
    }
    // `tail+0x0D` says whether to claim at all, and a failed claim is not an
    // error: the actor simply takes the descriptor's branch instead. The
    // `NoCameraTrack` clear above is the only one this state has, and it is
    // made before the claim and only for the hidden kind; a visible one keeps
    // whatever its spawn flags gave it (`0x004576D5`..`0x00457705`).
    if (!t?.claim || !TryClaimAttackSlot(obj, rng)) {
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
  obj.zom.flags1368 |= Zombie1368Flag.Cooldown;
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
 *
 * Two effects, both now here. On the cue, `CALL dword ptr [0x00592BCC]` at
 * `0x00457C2D` is `ZombieStrikeStartSplash` (`FUN_00456C50`) -- the strike's
 * own wading splash, which for this state (0x17) throws sprite 0x62. At the
 * end, `SpawnSpriteEffect({obj+0x40, +0x44, +0x48}, 0x62, 1, -1)` at
 * `0x00457CB8`, just before `ZombieReleaseAndDespawn`: the port had a feed
 * note there. And `obj.frozen` is gone from both ends: it is class 0x24's
 * `obj+0x1324` (L3), no store in this routine touches it, and
 * {@link ActorFlag.PoseFrozen} is what holds the clock.
 */
export function ZombieStateScriptedGrabAndDespawn(obj: ZombieActor,
                                                  rng: Rng, host?: GameHost,
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
    }
    obj.flags2 |= ZombieFlag2.Carried;
    // `INC word ptr [ESI+0x1312]` at `0x00457BCA` and no `RET`: the jump
    // table at `0x00457CCC` puts sub 1 at `0x00457BD7`, the next instruction
    // after sub 0's last store (L53). So the two `-1` spawns take their cue
    // on the frame they are made; the port returned here, a frame late.
    obj.sub = 1;
  }

  if (obj.sub === 1) {
    // `-1` fires at once; otherwise the camera path frame must equal it —
    // **either camera block's**, which is `CamCueHit`.
    if (obj.zom.holdFrames !== -1 && !CamCueHit(obj.zom.holdFrames)) return;
    if (t.motion === GRAB_MOTION_PAIRED) {
      ActorSetMotionBlended(obj, GRAB_MOTION_PAIRED, 0, 1);
    }
    // The answer is not looked at (`0x00457C18`), and the only `obj+0x34`
    // write after it is `AND AH, 0xbe` -- the freeze and the shot immunity,
    // not the camera bit.
    TryClaimAttackSlot(obj, rng);
    ActorFacePlayerTarget(obj);
    obj.flags &= ~(ActorFlag.PoseFrozen | ActorFlag.ShotImmune);
    ZombieStrikeStartSplash(obj, rng, host, events);
    // `obj+0x13C4 = obj+0x44` — the y the actor is pinned at for the grab.
    obj.arcFrom.y = obj.pos.y;
    obj.sub = 2;
  }

  if (obj.sub === 2) {
    if (MotionPlayFrame(obj) !== (t.hit_frame ?? -1)) return;
    if (obj.attackPermit >= 0) {
      PlayerTakeDamage(obj.attackPermit, 1,
                       obj.motion === GRAB_HIT_KIND_MOTION ? 0 : GRAB_HIT_KIND,
                       events, obj);
    }
    obj.sub = 3;
  }

  if (obj.sub !== 3) return;
  if (!atLastFrame(obj)) return;
  SpawnSpriteEffect(vec3(obj.pos.x, obj.pos.y, obj.pos.z), 0, 0,
                    SpriteEffectKind.SplashLarge, 1, -1, host, events);
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
export function ZombieStateLeapToPoint(obj: ZombieActor, dt: number,
                                       rng: Rng, events?: Events): void {
  const t = obj.entry;
  if (!t?.dest) { obj.state = ZombieState.AttackRun; obj.sub = 0; return; }
  const frames = SecondsToTicks(dt);

  if (obj.sub === 0) {
    if (t.idle_motion !== undefined) ActorSetMotion(obj, t.idle_motion);
    obj.flags |= ActorFlag.NoHitReaction;
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
    G.g_attack_permits[p] = obj.at;       // the engine's 1; see the pick
    ActorFacePlayerTarget(obj);
    obj.flags &= ~ActorFlag.PoseFrozen;
    if (t.strike_motion !== undefined) {
      ActorSetMotionBlended(obj, t.strike_motion, 0, MotionFade.Quick);
    }
    obj.sub = 4;
  }

  if (obj.sub === 4) {
    if (MotionPlayFrame(obj) === (t.hit_frame ?? -1)) {
      if (obj.attackPermit >= 0) {
        PlayerTakeDamage(obj.attackPermit, 1, LEAP_HIT_KIND, events, obj);
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
 * family. A stationary attacker on a timer: it waits out `tail+0x04`, then
 * swings at a player every `tail+0x06` frames for ever.
 *
 * **Stationary in its own frame of reference, which is not the world's.** All
 * three shipped spawns set descriptor flag bit 3, so `EnemyZombieUpdate`
 * re-seats them on `g_carrier_object` before this function runs and they ride
 * stage 5's car the whole time they are swinging. This state moves nothing;
 * that is not the same as the actor not moving. See `class30/carrier.ts`.
 *
 * Unlike `ZombieStateLeapToPoint` it draws a **real attack** out of
 * `g_class30_attack_picks`, so the swing is one of the character's own and
 * `ActorStrikeConnect` decides whether it lands — which means shooting the arm
 * off stops it, exactly as it does in the ordinary loop.
 *
 * **The tail runs on every frame, whichever sub the switch took.** In the exe
 * every arm ends at `switchD_0045e899_default` — `case 0` and `case 1` by
 * `break`, `case 3` and `case 4` by an explicit `goto` on their wait, and the
 * `obj+0x121 == -1` arm by falling out of its `if` — and the idle and the
 * carrier watch below are what sits there. The sub machine was written here
 * with `return` on those waits, so on any frame the actor was **counting a
 * timer down** the give-up did not run: `ZombieDelayedStrikeGiveUp`'s counter
 * only advanced on the frames the swing happened to be past its wait, and the
 * actor left `0x14` frames late by however many it had spent waiting. Hence
 * the split: the switch may return, the frame may not.
 */
export function ZombieStateDelayedStrikeInPlace(obj: ZombieActor,
                                                dt: number, rng: Rng,
                                                events?: Events): void {
  ZombieDelayedStrikeStep(obj, dt, rng, events);
  // `switchD_0045e899_default`, in order: the idle re-blend, the camera turn,
  // then the watch.
  ZombieDelayedStrikeIdle(obj, rng);
  // `0045EAEA  TEST byte ptr [ESI + 0x38], 0x20` then
  // `TurnActorTowardCameraEye(obj, 0x1A0)` — the same arm
  // `ZombieStateRideCarrier` has at `0x004589F5`. No stage-5 passenger sets
  // the descriptor bit behind it, so it is dead in the shipped data and
  // transcribed anyway; see {@link ZombieAux.TurnTowardCameraEye}.
  if (obj.flags38 & ZombieAux.TurnTowardCameraEye) {
    TurnActorTowardCameraEye(obj, CARRIER_TURN_RATE, dt);
  }
  ZombieDelayedStrikeGiveUp(obj, dt);
}

/** The switch itself — `0045e899`'s nine arms. May return; see the caller. */
function ZombieDelayedStrikeStep(obj: ZombieActor, dt: number,
                                 rng: Rng, events?: Events): void {
  const t = obj.entry;
  const frames = SecondsToTicks(dt);

  if (obj.sub === 0) {
    obj.zom.holdFrames = t?.delay ?? 0;
    obj.sub = 1;
  } else if (obj.sub === 1) {
    obj.zom.holdFrames -= frames;
    if (obj.zom.holdFrames > 0) return;
    obj.sub = 2;
  }

  if (obj.sub === 2) {
    obj.zom.holdFrames = t?.rearm ?? 0;
    obj.sub = 3;
  }

  if (obj.sub === 3) {
    if (G.g_players_in_play === 0) return;
    obj.sub = 4;
  }

  if (obj.sub === 4) {
    obj.zom.holdFrames -= frames;
    if (obj.zom.holdFrames > 0 || G.g_players_in_play === 0) return;
    const p = ZombieScriptedPickPlayer(t?.player ?? -1, rng);
    obj.attackPermit = p;
    if (p === -1) return;
    G.g_attack_permits[p] = obj.at;       // the engine's 1; see the pick
    ActorFacePlayerTarget(obj);
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
    ActorFacePlayerTarget(obj);
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
  ZombieSetMotionIfIdle(obj, ZombieWaitMotion(obj, MotionRowOf(obj)), rng, 5,
                        MotionFade.Quick);
}

/**
 * State 32's other watch: `g_carrier_object`'s `obj+0x34` bit 0x40000000.
 *
 * While that bit is clear the counter at `obj+0x1334` is held at zero; once it
 * is set the counter runs, and at `0x14` the actor abandons the fight for
 * state 10 — `ZombieReleaseAndDespawn` (`FUN_00455490`), which releases the
 * permit and leaves the pool. This used to name `ActorAbortAttackAndLeave`
 * for state 10, the same wrong citation `ZombieState.Leave` carried. It is how
 * a scripted attacker gets out of the way when the ride it belongs to ends.
 *
 * **`obj+0x34`, not `obj+0x136C`.** The read is
 * `0045eafe TEST dword ptr [EAX + 0x34], 0x40000000` on the object
 * `g_carrier_object` names, and the writer is
 * `ScriptedCarrierUpdate33` (`0x004331D0`) at `00433280 OR EAX, 0x40000000`
 * with `EAX = [EBP + 0x34]`. This tested `obj+0x136C` — the right bit in the
 * wrong word, where {@link ZombieFlag2.CollideActors} lives, which
 * `EnemyZombieInit` (`FUN_00452DA0`) seeds on **every** class-0x30 spawn as
 * half of `|= 0x60000000`. So the old read would have retired these three the
 * instant any class-0x30 actor became the carrier, and never retired them for
 * the class-0x33 one that really is. Same shape as `L3`: the word decides the
 * meaning, and 0x40000000 means two unrelated things in the two words.
 *
 * On the carrier the bit is not "a reaction is in progress" — class 0x33
 * selector 1 raises it once its own `obj+0x1370` passes the threshold at its
 * descriptor tail's `+0x14`, i.e. **the ride has reached the end of its run**.
 * {@link ActorFlag.Reacting} is the port's name for `obj+0x34` bit 0x40000000
 * and is used here for the bit, exactly as `ZombieStateRideCarrier` uses
 * {@link ActorFlag.Committed} for the carrier's 0x10000000.
 *
 * **The carrier exists now.** `ScriptedCarrierUpdate33` (`FUN_004331D0`) is
 * ported (`game/class33/`) and writes `g_carrier_object`; stage 5 block 2's is
 * evt `0x1CE4`, whose descriptor fires its effect — and this bit — at path
 * cursor frame 580. That was one half of the room a player could not clear:
 * `wait_enemies_alive <= 0` at step 2 op 50. The other half was
 * {@link ZombieState.Leave}: it is `10`, `g_class30_states[10]` is
 * `ZombieReleaseAndDespawn` (`FUN_00455490`), and the port had no `case` for
 * it, so every actor that got here went to `WaitTurn` and stayed alive. See
 * `class30/index.ts`.
 *
 * **This comment used to end "the distance was never the bug", and it was
 * wrong.** The reasoning was that this state never moves an actor and
 * `SpawnFromDescriptor` (`FUN_00408A20`) copies the spawn position verbatim,
 * so `d≈2870` had to be where the level wanted them. Both halves are true
 * and the conclusion does not follow: what the descriptor holds for these
 * three is a **carrier-local offset**, `(-4.6, 10, -16.5)`, `(-4.6, 5, -2.6)`
 * and `(-4.6, 5, 7)`, and `EnemyZombieInitByCharType` re-reads it as one on
 * `obj+0x34` bit 3 and hands it to `ZombieAttachToCarrier` (`FUN_0045E770`),
 * which `EnemyZombieUpdate` then re-runs **before this state every frame**.
 * They ride the car. `d≈2870` was the distance from the player to the world
 * origin, and the reporter who said they should be travelling with the car was
 * right. See `class30/carrier.ts` — and `L26`, because a note this confident
 * is exactly what stops anyone looking.
 *
 * The port still guards `g_carrier_object` before dereferencing it, which the
 * engine does not — see `entrance.ts`'s note on `ZombieStateRideCarrier`.
 */
function ZombieDelayedStrikeGiveUp(obj: ZombieActor, dt: number): void {
  const carrier = G.g_carrier_object >= 0
    ? ActorByAt(G.g_carrier_object) : undefined;
  if (!carrier || !(carrier.flags & ActorFlag.Reacting)) {
    obj.zom.backoffFrames = 0;
    return;
  }
  obj.zom.backoffFrames += SecondsToTicks(dt);
  if (obj.zom.backoffFrames <= CARRIER_GIVE_UP_FRAMES) return;
  obj.state = ZombieState.Leave;
  obj.sub = 0;
}
