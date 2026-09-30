/**
 * Falling over, and dying.
 *
 * Class 0x31's death is four states, not a clip: it is knocked off its feet
 * and rides a ballistic arc *away from the camera* (`ThrowerBeginKnockbackArc`
 * throws the body back, harder the nearer it already was), bounces on the
 * ground,
 * lies still for a random moment, and then either gets up — because being
 * knocked down is survivable — or plays its own death clip and becomes a
 * corpse that sinks into the floor for two seconds and despawns.
 *
 * `ThrowerStateFallToSurface` is the same fall for an actor that has simply
 * come off a wall, and it is the one path by which a wall-crawler that runs
 * out of wall ends up back on the ground.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import {
  ThrowerReleaseSlotOnDeath, ThrowerRetireFromAliveCount,
  ThrowerRetireFromPresentCount,
} from "../combat/counts";
import { ThrowerReleaseAttackPermit } from "../combat/permits";
import { ActorFlag, ThrowerFlag, type ThrowerActor } from "../actor";
import { G, HIT_SLOT_NONE } from "../globals";
import { CameraSlotVacate } from "../camera/slots";
import { SpawnGroundRingEffect } from "../effects/ring_effect";
import { SpawnSpriteEffect } from "../effects/sprite";
import type { GameHost } from "../host";
import { vec3 } from "../vec";
import { QueryGroundHeightAt } from "../coli";
import { ActorDespawn } from "../despawn";
import { MotionOf, MotionPlayLength, T } from "../tables";
import { ActorSetOneShotBlended } from "../class30/motion_cue";
import { GAME_HZ, MotionFade } from "../class30/states";
import {
  ActorArcBeginToAtSpeed, ActorArcVelocityY,
  ActorPlayCursor, ActorPlayMotion, ClearCurrentActorVelocityAndAccel,
} from "./arc";
import { GroundDustCode, ThrowerEmitGroundDust } from "./ground_dust";
import { ThrowerPickNextState } from "./router";
import { ThrowerState, ThrowerMotion } from "./states";
import { ThrowerMotionOf, ThrowerStanceOf } from "./tables";


const _view = vec3();
const _dest = vec3();

/** `obj+0x5C` — gravity, -196 units per second squared at 60 Hz. */
export const FALL_GRAVITY = -0.05444444;
/** The bounce: the vertical is reversed and halved, the other two halved. */
const BOUNCE_NORMAL = -0.5;
const BOUNCE_TANGENT = 0.5;
/** Below this vertical speed the body has settled. */
const SETTLE_SPEED = 0.15;
/**
 * `PlaySoundId(0x2716A9)` at `0x0044A685` -- `COMMON\ENE_WALK4_16.WAV`, the
 * thump of each bounce. `ThrowerStateKnockedTumbling` plays the same one.
 */
export const SND_BOUNCE = 0x2716a9;
/** ...and it settles regardless after this many frames. */
const FALL_FRAME_CAP = 0x78;
/** `QueryGroundHeightAt(x, y + 4.5, z)` for the fall, `+1.0` for the drop. */
const FALL_PROBE_RISE = 4.5;
const DROP_PROBE_RISE = 1.0;
/** The surface that kills whatever lands on it. `[likely]` deep water. */
export const SURFACE_KILL = 0x5a;
/**
 * `PUSH 0x11b` at `0x0044A788`: the clip sub 3 hands every character but 0x17
 * to, through `SetCurrentActorMotionBlended` (`FUN_0044D230`) at fade 5.
 *
 * Called the get-up because sub 4 is the way back to the hub, and for 0x18
 * and 0x19, which bounce and lie still first, it is one. For `zsass` it is a
 * **back handspring**: in `szom.bin` bone 0 turns a whole revolution about x
 * across its sixteen authored frames while the root runs 21.4 units along the
 * clip's own +z -- backwards, away from where the actor faces. That travel is
 * root motion like any other clip's (`SkeletonApplyRootMotion`, gate on for
 * every class-0x31 actor), so a knocked-down `zsass` really does end up about
 * twenty units further off than the knockback arc left it. What bounds it is
 * where sub 4 lets the clip go: `g_motion_play_length[0x11B] - 2` = 27 on the
 * cursor, and the draw of that same frame takes it to 28 -- authored frame
 * 14, 20.36 of the root, not the clip's last frame's 21.43.
 */
const GET_UP_CLIP = 0x11b;
/**
 * `MOV dword ptr [ESI + 0x133c], 0x1e` at `0x0044A7EB`, with `OR AH, 0x1` on
 * `obj+0x34`: a `zsass` back on its feet ricochets shots for thirty frames,
 * which `EnemyThrowerUpdate` counts down before it takes the bit away.
 */
const ZSASS_GETUP_COOLDOWN = 0x1e;
/**
 * `obj+0x34` bit `0x200000` on a class-0x31 actor: **a body being knocked
 * down.** Sub 0 raises it -- `OR EDX, 0x200000` at `0x0044A49C`, and the
 * tumble's sub 0 the same -- and each takes it down with the rest of the
 * reaction on the way back to the hub (`AND EBP, 0xbfdffeff` at `0x0044A7C5`).
 * Its reader is `ThrowerPushOutOfWorld` (`FUN_00449D40`), on the object the
 * crowd test found: a thrower clinging to a wall or a ceiling that such a body
 * runs into is knocked off it. Class 0x33's burning car raises the same bit of
 * its own word for its own reasons (`ActorFlag.FireLoop`, `L3`).
 */
export const KNOCKDOWN_BODY = 0x200000;
/**
 * `PUSH -0x1; PUSH 0x1; PUSH 0x61` at `0x0044A877`: the sprite a body that
 * landed on the killing surface leaves, in `g_scene_index` 3 block 4 only.
 */
const KILL_SURFACE_SPRITE = 0x61;
const KILL_SURFACE_SPRITE_SCENE = 3;
const KILL_SURFACE_SPRITE_BLOCK = 4;
/** The corpse lies here for two seconds, sinking this far a frame. */
const CORPSE_FRAMES = 0x78;
const CORPSE_SINK = 0.04;
/** How many re-entries into one fall the knockback arc is worth. */
const KNOCKBACK_ARCS = 2;

/** The pose freeze frame, per character type: `T1` then `T2` in the exe. */
const FREEZE_AIR: Record<number, number> = { 0x16: 35, 0x17: 20, 0x18: 44, 0x19: 44 };
const FREEZE_FALL: Record<number, number> = { 0x16: 48, 0x17: 20, 0x18: 44, 0x19: 44 };

/** The death clip, per character type. */
const DEATH_CLIP: Record<number, number> = {
  0x16: 0x11e, 0x17: 0x1bc, 0x18: 0x11d, 0x19: 0x11d,
};

/** Character type 0x16 never re-bounces and dies through state 3. */
const CHAR_ZSASS = 0x16;
const CHAR_ZSKAMERE = 0x17;
const CHAR_ZSLMAN = 0x18;

/**
 * A clip on the port's one-shot channel, standing in for a track-0 set in the
 * engine (`ActorSetMotion` or `SetCurrentActorMotionBlended` at every call
 * here). Each of those runs `MotionStartOnTrack(model, 0, ...)`, which writes
 * `model+0x36 = 0` and hands the whole skeleton back to track 0 -- so it ends
 * a stumble on track 1, as `ActorSetMotion` does in `class30/motion_cue.ts`.
 */
function playOnce(obj: ThrowerActor, motion: number): void {
  if (!MotionOf(obj, motion)) return;
  obj.react = null;
  obj.action = { motion, ticks: 0 };
  obj.rootActionCursor = -1;
}

/**
 * `ThrowerBeginKnockbackArc` — `FUN_0044D120`. Where a shot body flies.
 *
 * **Away from the camera, not at it**, and harder the nearer it already is:
 *
 * ```c
 * t = 15.0 / |obj+0x70..0x78| * 10.0;      // the view-space tracked point
 * if (t < 0.0) t = 0.0;
 * if (obj+0x34 & 0x4000000) t *= 1.5;      // already dead: half again
 * // then, in the camera's own frame:
 * MatrixStackSetTopFromArray(view_to_world);
 * p = (obj+0x70, obj+0x74, obj+0x78 - t);
 * MatrixTransformPoint(&p, &dest);
 * ```
 *
 * The sign is the whole of it. `obj+0x78` is the depth in the **camera's own**
 * space, and that space has **−z in front**: `ThrowerPickLandingPoint`
 * (`FUN_0044CBA0`) unprojects its landing point at a literal `-15.5` and the
 * port has carried that number, negative, since it was written. So `z - t`
 * with `t >= 0` is *more* negative, which is *further in front of the camera*
 * — the body is thrown away from the viewer.
 *
 * This used to read the store as "pulled `t` units nearer" and approximate it
 * with a lerp from the actor toward the eye, declared a divergence on the
 * grounds that the camera's matrix was out of reach. It is not:
 * `GameHost.viewSpaceOf` is the view-space point and `GameHost.viewPoint` is
 * the inverse transform, and both have been on the seam since
 * `ThrowerPickLandingPoint` was ported. The lerp was wrong twice over — the
 * direction, and the shape. Moving along the camera's z keeps the body's screen
 * x and y, so it recedes; moving toward the eye converges on a point, and
 * `k = min(1, t / d)` pinned it *at* the eye for anything inside about fifteen
 * units. A thrower shot mid-pounce lands 15.5 units in front of the camera, so
 * that was every close kill.
 *
 * `GameHost.viewSpaceOf` hands the field over in the engine's own sign and
 * with no opinion about it, so this is `z - t` verbatim. It used to negate the
 * depth and refuse an actor behind the camera; that judgement belonged to
 * neither reader and is gone.
 */
export function ThrowerBeginKnockbackArc(obj: ThrowerActor,
                                        host: GameHost): void {
  // [diverges] The engine always has a camera; a host that cannot answer is
  // the port's own case, and so is a tracked point sitting exactly on the eye,
  // which the engine divides by. Either way the port flies the standing arc --
  // no knockback at all, over `ActorArcBeginToAtSpeed`'s minimum duration --
  // because leaving `arcTotal` at zero would collapse the whole fall into one
  // frame rather than merely skip the throw.
  const len = host.viewSpaceOf(obj.at, _view)
    ? Math.hypot(_view.x, _view.y, _view.z) : 0;
  if (len < 1e-4) {
    ActorArcBeginToAtSpeed(obj, obj.pos);
    return;
  }
  let t = (15.0 / len) * 10.0;
  if (t < 0) t = 0;
  if (obj.flags & ActorFlag.Dead) t *= 1.5;
  // `p = (obj+0x70, obj+0x74, obj+0x78 - t)`, then back through the
  // view-to-world matrix. `-z` is in front, so this is away from the viewer.
  host.viewPoint(_view.x, _view.y, _view.z - t, _dest);
  // A wall-clinging `zslman` keeps its own height: `local_14` is overwritten
  // with `obj+0x44` after the transform.
  if (obj.charType === CHAR_ZSLMAN && (obj.flags2 & 0xc0)) _dest.y = obj.pos.y;
  // `PUSH` the six floats and `CALL 0x0044db50` at `0x0044D216` -- the arc's
  // duration, and whether it is flown at ten frames or fifteen, are that
  // routine's to decide, and it is called rather than copied here.
  ActorArcBeginToAtSpeed(obj, _dest);
}

/**
 * `vel += acc; pos += vel` -- `EnemyThrowerUpdate`'s tail, `0x00449954` ..
 * `0x00449987`, which the engine runs after every state on every frame.
 *
 * `[port-only]` as a function: the port runs that step inside the class-0x31
 * states that move by velocity rather than in `EnemyThrowerUpdate`, as it has
 * since the class was ported -- the fall here and the tumble,
 * `ThrowerStateKnockedTumbling`. Each runs it once on each of its paths that
 * leaves a velocity or an acceleration standing, **after** the state's own
 * tests, which is the engine's order: sub 2's ground test reads `pos.y +
 * vel.y` with the velocity the last frame left, and only then does gravity
 * go in. On every other path both are zero -- sub 0 clears them, the landing
 * clears them -- and the step would move nothing.
 */
export function ThrowerFallIntegrate(obj: ThrowerActor, frames: number): void {
  obj.vel.x += obj.accX * frames;
  obj.vel.y += obj.accY * frames;
  obj.vel.z += obj.accZ * frames;
  obj.pos.x += obj.vel.x * frames;
  obj.pos.y += obj.vel.y * frames;
  obj.pos.z += obj.vel.z * frames;
}

/**
 * Raise {@link ActorFlag.PoseFrozen} once the clip passes the character's
 * threshold -- the switch on `obj+0x1F4` at `0x0044A538` and again at
 * `0x0044A5CD`. A type outside 0x16..0x19 falls out of the jump table and
 * freezes nothing.
 *
 * `[port-only]` as a function: two inline copies of one pattern, with a
 * different table each.
 */
function ThrowerFreezePastFrame(obj: ThrowerActor,
                                table: Record<number, number>): void {
  const frame = table[obj.charType];
  if (frame !== undefined && ActorPlayCursor(obj) >= frame) {
    obj.flags |= ActorFlag.PoseFrozen;
  }
}

/**
 * `g_motion_play_length[obj+0x1B4]` for the clip on the track -- what every
 * cursor test in this routine is measured against, and **not** the clip's
 * baked length: the play length is `2n - 2` or `2n - 3` ticks where the
 * baked clip runs `2n`, so reading the baked length held each clip two or
 * three frames past where the engine lets go of it.
 *
 * `[port-only]` as a function: one `MOVSX` off `0x004E07D0` at each site.
 */
function ThrowerTrackPlayLength(obj: ThrowerActor): number {
  return MotionPlayLength(obj, ActorPlayMotion(obj));
}

/**
 * `ThrowerStateFallAndLand` — `FUN_0044A450`, class 0x31 state 2.
 *
 * The knockdown *and* the death fall — which state it turns into depends on
 * whether the actor was still alive when it landed. Five subs, and 0 falls
 * into 1, 1 into 2, 2 into 3 and 3 into 4 on the frame each finishes, as the
 * engine's switch does:
 *
 * * **0** raises the reaction's bits, starts the airborne clip (a fade of 5
 *   the first time, a hard cut on a re-entry for every type but 0x16), and
 *   throws the body with `ThrowerBeginKnockbackArc` -- at most twice a fall.
 * * **1** rides the arc with `ActorArcVelocityY` (`FUN_0044DDE0`), freezing
 *   the pose past the type's frame.
 * * **2** falls under `obj+0x5C` gravity and bounces until the vertical speed
 *   is under 0.15 or 0x78 frames have passed; `zsass` never bounces. On the
 *   settle the body goes shot-immune.
 * * **3** waits: `zsass` for the airborne clip to reach its play length less
 *   one, the rest for `(rand() % 10 + 1) * 3` frames. Then clip `0x11B`.
 * * **4** waits for that clip's play length less two, and hands back: a
 *   `zsass` with thirty frames of shot immunity, a decapitated thrower to
 *   state 17, and everyone else to `ThrowerPickNextState`.
 *
 * A body that is dead, or landed on surface `0x5A`, leaves sub 3 the other
 * way once its clip has run to its play length (`obj+0x1F1`, the draw's
 * "reached the end" byte): `zsass` to its death clip, the rest to a corpse.
 *
 * **How far a `zsass` goes.** The arc throws it `150 / d` units along the
 * camera's own depth, `d` its distance: about 3.3 at the 45 units stage 2's
 * block 5 stands them at. Clip `0x11B`'s back handspring then carries it the
 * root's travel to authored frame 14, 20.36 units, so a knockdown there
 * costs about 23.7 -- the engine's own figure, and most of what was
 * reported. The port used to read every cursor test against the baked clip's
 * length and so ran the handspring to its last frame; it forgot the thirty
 * frames of immunity at the end, so the next shot could knock it down again
 * at once; and it went straight to state 7 without the router. Together with
 * the stumble on the wrong track (`ThrowerStateHitReaction`, `0x0044A360`),
 * that made a held trigger walk the pair backwards off the walkway faster
 * than the game does.
 */
export function ThrowerStateFallAndLand(obj: ThrowerActor, host: GameHost,
                                        dt: number, rng: Rng,
                                        events?: Events): void {
  const frames = dt * GAME_HZ;
  // `MOV EDI, [ECX + 0x14]` at `0x0044A46E`, before the switch: the set's
  // airborne clip, which subs 0 and 1 both start.
  const clip = ThrowerMotionOf(obj, ThrowerMotion.Airborne);

  if (obj.sub === 0) {
    const reentry = (obj.flags2 & ThrowerFlag.ReactReentry) !== 0;
    obj.flags2 = (obj.flags2 & ~(ThrowerFlag.Surface | ThrowerFlag.OffGround))
               | 0x180000;
    obj.flags = (obj.flags & ~ActorFlag.PoseFrozen) | KNOCKDOWN_BODY;
    if (!reentry) {
      ClearCurrentActorVelocityAndAccel(obj);
      // `ActorSetMotionBlended(obj+0x194, clip, 0, 5)` at `0x0044A4C3`.
      if (clip !== undefined) {
        ActorSetOneShotBlended(obj, clip, 0, MotionFade.Quick);
      }
      obj.thr.knockCount = 0;
    } else {
      // `ActorSetMotion` at `0x0044A4E9`: a hard cut, and none at all for
      // `zsass`, whose clip plays on through the second hit.
      if (obj.charType !== CHAR_ZSASS && clip !== undefined) playOnce(obj, clip);
      obj.thr.knockCount += 1;
    }
    if (!(obj.flags & ActorFlag.NoHitReaction)
        && obj.thr.knockCount < KNOCKBACK_ARCS) {
      ThrowerBeginKnockbackArc(obj, host);
    } else {
      obj.flags |= ActorFlag.NoHitReaction;
    }
    // The last line of the engine's own case 0: a thrower leaves
    // `g_enemies_alive` on the frame it is knocked off its feet, not when the
    // body stops bouncing three seconds later.
    ThrowerReleaseSlotOnDeath(obj);
    obj.sub = 1;
  }

  if (obj.sub === 1) {
    ThrowerFreezePastFrame(obj, FREEZE_AIR);
    if (ActorArcVelocityY(obj, frames)) {
      ThrowerFallIntegrate(obj, frames);
      return;
    }
    if (obj.charType === CHAR_ZSASS) {
      ClearCurrentActorVelocityAndAccel(obj);
    } else if (obj.charType > CHAR_ZSASS && obj.charType < 0x1a
               && clip !== undefined) {
      // `ActorSetMotionBlended(obj+0x194, clip, 0, 5)` at `0x0044A58E`: the
      // other three types start the airborne clip over for the drop.
      ActorSetOneShotBlended(obj, clip, 0, MotionFade.Quick);
    }
    // `MOV dword ptr [ESI + 0x5c], 0xbd5f0123` at `0x0044A5A0`.
    obj.accY = FALL_GRAVITY;
    obj.sub = 2;
    obj.flags &= ~ActorFlag.PoseFrozen;
    obj.thr.sinceLanding = 0;
  }

  if (obj.sub === 2) {
    ThrowerFreezePastFrame(obj, FREEZE_FALL);
    obj.thr.sinceLanding += frames;
    // `QueryGroundHeightAt` falls back to the script's own ground plane when
    // the trace misses, which is the engine's own answer.
    const ground = QueryGroundHeightAt(obj.pos.x, obj.pos.y + FALL_PROBE_RISE,
                                       obj.pos.z);
    // `FLD [ESI+0x44]; FADD [ESI+0x50]; FCOMP` at `0x0044A623`: last frame's
    // velocity, before this frame's gravity goes in.
    if (obj.pos.y + obj.vel.y > ground
        && obj.thr.sinceLanding < FALL_FRAME_CAP) {
      ThrowerFallIntegrate(obj, frames);
      return;
    }
    obj.pos.y = ground;
    obj.thr.landSurface = G.g_coli_hit_surface;
    obj.vel.y *= BOUNCE_NORMAL;
    obj.vel.x *= BOUNCE_TANGENT;
    obj.vel.z *= BOUNCE_TANGENT;
    // `PUSH 0x46; CALL ThrowerEmitGroundDust` at `0x0044A658` and
    // `PUSH 0x2716A9; CALL PlaySoundId` at `0x0044A680`, on every bounce --
    // the puff latches itself once per landing, the thump does not.
    ThrowerEmitGroundDust(obj, GroundDustCode.Bounce, host, events);
    events?.emit("sound.play", { id: SND_BOUNCE });
    if (Math.abs(obj.vel.y) > SETTLE_SPEED
        && obj.thr.sinceLanding < FALL_FRAME_CAP
        && obj.charType !== CHAR_ZSASS) {
      obj.flags &= ~ActorFlag.PoseFrozen;
      ThrowerFallIntegrate(obj, frames);         // bounce again
      return;
    }
    ClearCurrentActorVelocityAndAccel(obj);
    // `AND AH, 0x9f` (`80e49f`) then `OR AH, 0x1` (`80cc01`) on `obj+0x34`,
    // and in between `AND EBP, 0xffffbfff` (`81e5ffbfffff`) on `obj+0x136C`
    // at 0x0044A6E6 — the body has settled, so the next landing may puff
    // again.
    obj.flags = (obj.flags & ~(ActorFlag.NoHitReaction | ActorFlag.PoseFrozen))
              | ActorFlag.ShotImmune;
    obj.flags2 &= ~ThrowerFlag.LandingDustEmitted;
    obj.slideTimer = (rng.int(10) + 1) * 3;
    obj.sub = 3;
  }

  if (obj.sub === 3) {
    // `TEST EAX, 0x4000000` on `obj+0x34` at `0x0044A71E`, then the surface:
    // the flag the killing hit raised, not the port's own `dead`.
    if ((obj.flags & ActorFlag.Dead) || obj.thr.landSurface === SURFACE_KILL) {
      // `obj+0x1F1` -- the byte `SkeletonAdvancePlayCursor` (`FUN_004111A0`)
      // sets once the cursor has reached the play length. Until then the
      // body lies on the clip it fell in.
      if (ActorPlayCursor(obj) < ThrowerTrackPlayLength(obj)) return;
      if (obj.thr.landSurface === SURFACE_KILL) {
        obj.flags |= ActorFlag.Dead;
        ThrowerReleaseSlotOnDeath(obj);
        if (G.g_scene_index === KILL_SURFACE_SPRITE_SCENE
            && G.g_evt_block_index === KILL_SURFACE_SPRITE_BLOCK) {
          SpawnSpriteEffect(vec3(obj.pos.x, obj.pos.y, obj.pos.z), 0, 0,
                            KILL_SURFACE_SPRITE, 1, -1, host, events);
        }
      }
      if (obj.charType !== CHAR_ZSASS) {
        ThrowerEnterCorpseState(obj);
        return;
      }
      obj.sub = 0;
      obj.state = ThrowerState.Death;
      return;
    }
    if (obj.charType === CHAR_ZSASS) {
      if (ActorPlayCursor(obj) < ThrowerTrackPlayLength(obj) - 1) return;
    } else {
      obj.slideTimer -= frames;
      if (obj.slideTimer > 0) return;
    }
    // `SetCurrentActorMotionBlended(obj+0x194, 0x11b, 0, 5)` at `0x0044A78E`.
    if (obj.charType !== CHAR_ZSKAMERE) {
      ActorSetOneShotBlended(obj, GET_UP_CLIP, 0, MotionFade.Quick);
    }
    obj.sub = 4;
  }

  if (obj.sub !== 4) return;
  // Sub 4: the clip plays out to its play length less two, and the
  // knocked-down latch decides whether it owes you a get-up first.
  if (ActorPlayCursor(obj) < ThrowerTrackPlayLength(obj) - 2) return;
  const wasKnocked = obj.flags2 & ThrowerFlag.KnockedDown;
  // `AND EBP, 0xbfdffeff` and `AND EDI, 0xffbfdfff` at `0x0044A7C5`.
  obj.flags &= ~(ActorFlag.Reacting | KNOCKDOWN_BODY | ActorFlag.ShotImmune);
  obj.flags2 &= ~(ThrowerFlag.ReactReentry | ThrowerFlag.BandLatched);
  if (obj.charType === CHAR_ZSASS) {
    obj.cooldown = ZSASS_GETUP_COOLDOWN;
    obj.flags |= ActorFlag.ShotImmune;
    obj.state = ThrowerState.StandAndDecide;
    obj.sub = 0;
  }
  if (wasKnocked) {
    obj.state = ThrowerState.GetUp;
    obj.sub = 0;
    return;
  }
  // `CALL 0x0044adb0` at `0x0044A8D6`, with the state still 2 for every type
  // but `zsass` -- the router always moves it on.
  ThrowerPickNextState(obj, rng, host);
}

/**
 * The two ways out of a fall that killed. Character 0x16 plays its own death
 * clip first; everything else goes straight to a corpse.
 */
function ThrowerDie(obj: ThrowerActor): void {
  // `ThrowerReleaseSlotOnDeath` (`FUN_0044D050`) runs the moment the hit
  // points fall below 1 and always ends in the alive retire. The *present*
  // retire is `ThrowerEnterCorpseState`'s, one clip later.
  ThrowerRetireFromAliveCount(obj);
  obj.dead = true;
  if (obj.thr.landSurface === SURFACE_KILL) obj.flags |= ActorFlag.Dead;
  if (obj.charType === CHAR_ZSASS) {
    obj.state = ThrowerState.Death;
    obj.sub = 0;
    return;
  }
  ThrowerEnterCorpseState(obj);
}

/**
 * `ThrowerStateDeathClip` — `FUN_0044A930`, class 0x31 state 3.
 *
 * Character 0x16's only. Hard-rewinds its own death clip — no blend, because
 * whatever was playing is a fall — releases the permit and the tracking slot
 * in that order, and becomes a corpse when the clip runs out.
 */
export function ThrowerStateDeathClip(obj: ThrowerActor): void {
  if (obj.sub === 0) {
    // `ActorSetMotion(obj+0x194, clip)`: a cut, by character type.
    playOnce(obj, DEATH_CLIP[obj.charType] ?? DEATH_CLIP[0x19]);
    // `ThrowerReleaseAttackPermit` then `ThrowerReleaseSlotOnDeath`, in the
    // engine's order (0x0044A983 then 0x0044A989). Clearing the permit array
    // by hand -- which is what this did -- leaves `g_attack_committed` up.
    ThrowerReleaseAttackPermit(obj);
    ThrowerReleaseSlotOnDeath(obj);
    obj.dead = true;
    obj.sub = 1;
  } else if (obj.sub !== 1) {
    return;
  }
  // `g_motion_play_length[obj+0x1B4] - 1 <= obj+0x19C`, the play length and
  // not the baked clip's: it used to wait `2 * frames - 1` ticks where the
  // engine waits `play_length - 1`, two or three frames longer.
  if (ActorPlayCursor(obj)
      < MotionPlayLength(obj, ActorPlayMotion(obj)) - 1) return;
  ThrowerEnterCorpseState(obj);
}

/**
 * `ThrowerEnterCorpseState` — `FUN_0044D0A0`. Character type 0x18 blinks out;
 * everything else sinks.
 */
export function ThrowerEnterCorpseState(obj: ThrowerActor): void {
  // `unless (obj+0x38 & 1) ThrowerRetireFromPresentCount` — the *present*
  // count falls here and not at death, which is what makes a corpse still on
  // stage present but not alive. That distinction is the only reason the game
  // has both `wait_enemies_present` and `wait_enemies_alive`.
  ThrowerRetireFromPresentCount(obj);
  obj.flags2 &= ~0x180000;
  obj.flags |= ActorFlag.PoseFrozen;
  obj.dead = true;
  obj.sub = 0;
  obj.state = obj.charType === CHAR_ZSLMAN
    ? ThrowerState.CorpseBlink : ThrowerState.Corpse;
}

/**
 * The pose pin both corpse states run on every frame but their last: a fresh
 * `rand()` and a write of `obj+0x194`, the play cursor, from the table the
 * track's clip `obj+0x1B4` chooses -- `g_class31_corpse_frames_m1bc`,
 * `_m11d`, `_m11e` or `_m3a6` (`0x00592AC0`) by `rand() % 17 >> 4`, so the
 * second entry comes up once in seventeen and **a corpse can twitch** between
 * its two frames from one frame to the next.
 *
 * `[port-only]` as a function: the engine has it inline, the same forty bytes
 * at `0x0044AA9E` and `0x0044AC8C`. And the draw is **every** frame: the port
 * used to take it once, in sub 0, which pinned one frame for the whole two
 * seconds and left the other 119 draws out of the shared stream.
 *
 * [diverges] The engine has a general table for motions `0x3D9..0x3E0` behind
 * these four special cases, and class 0x31 never plays one of those — every
 * use of it reads outside the array, into mesh floats or a string. The port
 * keeps the current frame instead of reproducing an out-of-bounds read; the
 * draw is still taken, as the engine takes it on every arm.
 */
function ThrowerCorpsePoseFrame(obj: ThrowerActor, rng: Rng): void {
  const r = rng.int(17) >> 4;
  const row = T.chars?.class31?.corpse_frames?.[String(ThrowerTrackMotion(obj))];
  obj.thr.corpseFrame = row ? (row[r] ?? row[0]) : -1;
  // `MOV [ESI+0x194], EDX`: the play cursor itself, and the corpse's advance
  // is frozen (`ThrowerEnterCorpseState` raised `PoseFrozen`), so the frame
  // written is the frame drawn.
  if (obj.thr.corpseFrame >= 0 && obj.action) {
    obj.action.ticks = obj.thr.corpseFrame;
  }
}

/**
 * `obj+0x1B4` -- the motion on the engine's one track. The port plays class
 * 0x31's death clips on the one-shot channel (`playOnce`), so while one is up
 * it is the clip on screen.
 */
function ThrowerTrackMotion(obj: ThrowerActor): number {
  return obj.action?.motion ?? obj.motion;
}

/**
 * `0x3A6`, and `[0x00565DEC]` = `0000b040` = 5.5f: both corpse states lift
 * `obj+0x44` by 5.5 around their `SpawnGroundRingEffect` (`FUN_00407DA0`)
 * call when the clip is `0x3A6`, and drop it again straight after --
 *
 * ```
 * 0044a9e6  CMP  dword ptr [ESI+0x1b4], 0x3a6
 * 0044a9f2  FLD  [ESI+0x44] ; FADD [0x00565dec] ; FSTP [ESI+0x44]
 * 0044a9ff  CALL 0x00407da0
 * 0044aa04  FLD  [ESI+0x44] ; FSUB [0x00565dec] ; FSTP [ESI+0x44]
 * ```
 *
 * (and the same at `0x0044AB89`..`0x0044ABB3`). The ring's height is a floor
 * trace from `y + 20` (`MotionFlag.TraceGround`), so this starts that trace
 * 25.5 above the origin for the one clip. `0x3A6` is the airborne clip of
 * behaviour sets 0 and 3; why a body frozen on it wants the higher start is
 * `[open]`.
 */
const CORPSE_RING_LIFT_MOTION = 0x3a6;
const CORPSE_RING_LIFT = 5.5;

/**
 * The opening both corpse states share, instruction for instruction: the
 * ring, the count, and `obj+0x34 |= 0x20000`.
 *
 * `[port-only]` as a function -- `0x0044A9E6`..`0x0044AA38` and
 * `0x0044AB89`..`0x0044ABDB` are the same code twice.
 */
function ThrowerCorpseBegin(obj: ThrowerActor): void {
  if (ThrowerTrackMotion(obj) === CORPSE_RING_LIFT_MOTION) {
    obj.pos.y += CORPSE_RING_LIFT;
    SpawnGroundRingEffect(obj);
    obj.pos.y -= CORPSE_RING_LIFT;
  } else {
    SpawnGroundRingEffect(obj);
  }
  obj.slideTimer = CORPSE_FRAMES;
  // `OR ECX, 0x20000` -- the bit the class-0x30 corpse raises for its sink.
  obj.flags |= ActorFlag.Airborne;
  // `INC word ptr [ESI+0x1312]` and no `RET`: sub 1 runs on this frame too.
  obj.sub = 1;
}

/**
 * The corpse's way out, the same in both states:
 *
 * ```c
 * if ((obj+0x34 & 0x800000) && g_enemies_present == 0) {
 *     obj+0x34 |= 0x10000;
 *     if (obj+0x120 != -1) g_enemy_slots[obj+0x120 * 8] = 0;
 * }
 * if (obj+0x3C != -1) g_hit_slots[obj+0x3C] = 0;
 * ActorDespawn(obj);
 * ```
 *
 * at `0x0044AA4F`..`0x0044AA94` and `0x0044AC34`..`0x0044AC81` `[proved]`.
 * **Not `ThrowerLeave`**, which the port called here: the counts left at
 * the death and at `ThrowerEnterCorpseState`, and the permit goes back in the
 * dead sweep, so the only things left to give up are the camera -- and that
 * only for {@link ActorFlag.KeepCameraWhenLast}, the bit that kept it through
 * `ThrowerReleaseSlotOnDeath` -- and the hit slot.
 */
function ThrowerCorpseLeave(obj: ThrowerActor): void {
  if ((obj.flags & ActorFlag.KeepCameraWhenLast)
      && G.g_enemies_present === 0) {
    obj.flags |= ActorFlag.NoCameraTrack;
    CameraSlotVacate(obj);
  }
  if (obj.hitSlot !== HIT_SLOT_NONE) G.g_hit_slots[obj.hitSlot] = HIT_SLOT_NONE;
  ActorDespawn(obj);
}

/**
 * `ThrowerStateCorpseSink` — `FUN_0044A9D0`, class 0x31 state 4. Every
 * character type but 0x18.
 *
 * Sub 0 opens the ring and falls into sub 1 on the same frame. Sub 1 sinks
 * `obj+0x44` by 0.04 (`[0x004C4D04]` = `0ad7233d`), counts `obj+0x1330`
 * down from 0x78, and on reaching zero leaves; on every other frame it pins
 * the pose. So the body sinks 120 times and is drawn on a pinned frame 119.
 */
export function ThrowerStateCorpseSink(obj: ThrowerActor, dt: number,
                                       rng: Rng): void {
  if (obj.sub === 0) ThrowerCorpseBegin(obj);
  else if (obj.sub !== 1) return;

  const frames = dt * GAME_HZ;
  obj.pos.y -= CORPSE_SINK * frames;
  obj.slideTimer -= frames;
  if (obj.slideTimer < 1) { ThrowerCorpseLeave(obj); return; }
  ThrowerCorpsePoseFrame(obj, rng);
}

/**
 * `ThrowerStateCorpseBlink` — `FUN_0044AB70`, class 0x31 state 5. Character
 * type 0x18 only, which is the test `ThrowerEnterCorpseState` makes.
 *
 * The same opening and the same two seconds without the sink.
 *
 * **The flicker is an alpha, not a draw flag.** Where class 0x30's
 * `ZombieStateCorpseBlink` (`FUN_00454FD0`) closes `obj+0x1F8` bit 0 and the
 * parts' bytes, this writes `obj+0x138C` — 1.0 on an even count, 0 on an odd
 * one — and `obj+0x136C` bit 2 with it, and neither `ActorSetPartVisibility`
 * nor `obj+0x1F8` appears in the routine. `ThrowerDrawBonePart` draws each
 * bone at that alpha while the bit is up, and `DrawCharacterPartSlot` draws
 * `zslman`'s waist at it whatever the bit, so the whole body goes. `[proved]`
 *
 * Parity is read before the decrement, so the first frame is visible; the
 * way out writes `obj+0x138C = 0` and takes bit 2 down.
 */
export function ThrowerStateCorpseBlink(obj: ThrowerActor, dt: number,
                                        rng: Rng): void {
  if (obj.sub === 0) ThrowerCorpseBegin(obj);
  else if (obj.sub !== 1) return;

  if (Math.floor(obj.slideTimer) & 1) {
    obj.flags2 |= ThrowerFlag.Blinking;
    obj.alpha = 0;
  } else {
    obj.flags2 &= ~ThrowerFlag.Blinking;
    obj.alpha = 1;
  }
  obj.slideTimer -= dt * GAME_HZ;
  if (obj.slideTimer < 1) {
    obj.flags2 &= ~ThrowerFlag.Blinking;
    obj.alpha = 0;
    ThrowerCorpseLeave(obj);
    return;
  }
  ThrowerCorpsePoseFrame(obj, rng);
}

/**
 * `ThrowerLeave` — `FUN_0044AD60`. Occupies state slot 6 and is never entered
 * as one: nothing in the program writes 6 to `obj+0x1310`. It is the
 * subroutine every other exit calls, and it is **the whole of** class 0x31's
 * leave — the engine has exactly one:
 *
 * ```c
 * ThrowerRetireFromAliveCount(obj);
 * ThrowerRetireFromPresentCount(obj);
 * ThrowerReleaseAttackPermit(obj);
 * if (obj+0x120 != -1) g_enemy_slots[obj+0x120 * 8] = 0;
 * obj+0x34 &= ~1;
 * ActorDespawn(obj);
 * ```
 *
 * Its two callers are `ThrowerStrikeConnect` (`FUN_0044CE60`) and
 * `ThrowerStateGrabPlayer` (`FUN_0044EF90`), and a second transcription of it
 * lived privately in `class31/scripted.ts` doing only the permit release —
 * so a thrower that finished its grab-and-throw never left either count, and
 * `wait_enemies_alive` after one could not open. One exe function, one TS
 * function; `web/tools/repo/port.ts` now checks it by address.
 */
export function ThrowerLeave(obj: ThrowerActor): void {
  // `ThrowerLeave` and `ThrowerReleaseSlotOnDeath` are the engine's two callers
  // of the alive retire; this is the one that also takes the actor off screen.
  ThrowerRetireFromAliveCount(obj);
  ThrowerRetireFromPresentCount(obj);
  ThrowerReleaseAttackPermit(obj);
  // The camera slot, `obj+0x120` — a different slot from the permit at
  // `obj+0x121`. Modelled as a filter by `at` for the same reason
  // `ThrowerReleaseSlotOnDeath` is: the port keeps `g_enemy_slots` as the
  // list of actors rather than a fixed array of eight-byte records.
  CameraSlotVacate(obj);
  // `obj+0x34 &= ~1`. [open] Bit 0 of the flag word has no port: nothing in
  // the ported call graph reads or writes it, so there is nothing to clear.
  // Named here rather than dropped, so the next reader knows it was seen.
  ActorDespawn(obj);
}

/**
 * `ThrowerStateFallToSurface` — `FUN_0044BC70`, class 0x31 state 11.
 *
 * How a wall-crawler that has run out of wall gets back down. It records the
 * height it started from, falls, and picks a landing clip by **how far it
 * fell** — over fifteen units the long one, ten to fifteen the short one,
 * under ten none at all, which is what makes a short drop read as a step and a
 * long one as a landing.
 */
export function ThrowerStateFallToSurface(obj: ThrowerActor, dt: number): void {
  const frames = dt * GAME_HZ;
  const is17 = obj.charType === CHAR_ZSKAMERE;

  if (obj.sub === 0) {
    obj.flags |= ActorFlag.NoHitReaction;
    obj.thr.fallFromY = obj.pos.y;
    obj.flags2 &= ~(ThrowerFlag.Surface | ThrowerFlag.OffGround);
    playOnce(obj, is17 ? 0x1bc : 0x3a5);
    obj.sub = 1;
  }

  if (obj.sub === 1) {
    obj.accY = FALL_GRAVITY;
    obj.vel.y += obj.accY * frames;
    const ground = QueryGroundHeightAt(obj.pos.x, obj.pos.y + DROP_PROBE_RISE,
                                       obj.pos.z);
    if (ground < obj.pos.y + obj.vel.y) {
      obj.pos.y += obj.vel.y * frames;
      return;
    }
    obj.vel.x = obj.vel.y = obj.vel.z = 0;
    obj.accY = 0;
    obj.pos.y = ground;
    const drop = Math.abs(obj.thr.fallFromY - ground);
    if (drop > 15) {
      playOnce(obj, is17 ? 0x1bc : 0x3a5);
      obj.thr.fallFromY = 0;
    } else if (drop > 10) {
      playOnce(obj, is17 ? 0x1ba : 0x3a9);
      obj.thr.fallFromY = 0;
    }
    obj.sub = 2;
  }

  // Sub 2: a landing clip zeroed `fallFromY`, so this leaves at once; with no
  // landing clip it waits the fall clip out instead.
  if (obj.thr.fallFromY !== 0 && obj.action) return;
  obj.flags &= ~ActorFlag.NoHitReaction;
  obj.thr.fallFromY = 0;
  obj.sub = 0;
  obj.thr.landSurface = G.g_coli_hit_surface;
  ThrowerReleaseSlotOnDeath(obj);
  if (!obj.dead && obj.thr.landSurface !== SURFACE_KILL) {
    obj.state = (obj.flags & ActorFlag.BackingOff)
      ? ThrowerState.LeapAside : ThrowerState.StandAndDecide;
    return;
  }
  ThrowerDie(obj);
}

/** Which stance the corpse and fall states report, for the debug feed. */
export function ThrowerFallStance(obj: ThrowerActor): number {
  return ThrowerStanceOf(obj) & 3;
}
