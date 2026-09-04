/**
 * The class-0x30 entrances that **wait**, and then hand over.
 *
 * Seven of the twelve states this file and `scripted.ts` add between them.
 * Every one has the same skeleton — hold a clip, wait for something, set
 * `obj+0x1310` to a state the descriptor names — and they differ only in what
 * they wait for: a frame count, a camera path frame, a script flag, a
 * rideable object. That is why they are one file: read together the family is
 * obvious, and read apart each looks like an arbitrary special case.
 *
 * Between them and `scripted.ts` they are **133 of the game's 356 class-0x30
 * spawns**, against the seventeen states the port already read.
 * `ZombieEntryState` folded all twelve into `AttackRun`, so every one of those
 * spawns turned to the camera on its first frame and walked at it — the same
 * failure the walk-in (state 15) and the stationary thrower (state 33) each
 * had before they were ported, and for the same reason.
 *
 * Two shapes recur and are worth naming up front:
 *
 * * **the re-asserted clip.** States 17, 18, 19 and 20 do
 *   `if (!(obj+0x34 & 0x40000000) && obj+0x1B4 != clip) ActorSetMotion(clip)`
 *   *every frame*, not once on entry. The flag is `ActorFlag.Reacting`, so a
 *   hit reaction is allowed to interrupt the pose and the entrance quietly
 *   takes it back when the reaction ends.
 * * **the branch to `tail+0x03`.** They end with `obj+0x1310 = (s8)tail+3`,
 *   which the port already carries as {@link Actor.attackState}. When that
 *   byte is 15 two of them latch a walk distance first and enter
 *   `ZombieStateWalkDistance` at **sub 1**, skipping its own latch.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import {
  ActorFlag, ZombieFlag2, type Actor, type ZombieActor,
} from "../actor";
import { CountEnemyZombieJoin } from "../combat/counts";
import { ActorByAt, G } from "../globals";
import {
  ActorArcBegin, ActorArcStep, ArcPhase, InstallArcMotionScript,
} from "../class31/arc";
import {
  FirstBakedOf, MotionPlayFrame, MotionPlayLength, MotionRowOf, T,
} from "../tables";
import { ActorSetMotion, ZombieSetMotionIfIdle } from "./motion_cue";
import { MotionFade, MotionRow, ZombieState } from "./states";

/**
 * The arc script `ZombieStateArcScriptedEntrance` installs, by character type
 * — `DAT_00567898` for type 0 and `DAT_00567958` for every other, exported
 * into `combat.arc_scripts` by `CLASS30_ARC_SCRIPTS`.
 */
function ZombieArcEntranceScript(obj: ZombieActor) {
  const t = T.chars?.combat?.arc_scripts;
  return (obj.charType === 0
    ? t?.entrance_type0 : t?.entrance_other) ?? null;
}

/**
 * `ZombieStateSurfaceOnCameraCue`'s two clips: `0xB8` for character types
 * 0xF, 0x10 and 0x11 and `0x3D8` for every other. The engine names them as
 * literals rather than through a table.
 */
const SURFACE_MOTION_WADER = 0xb8;
const SURFACE_MOTION_OTHER = 0x3d8;
/** The character types that take the first — `0xF <= type <= 0x11`. */
const SURFACE_WADER_TYPES = new Set([0xf, 0x10, 0x11]);
/**
 * The two play-clock cursors clip `0xB8` throws splash effect `0x62` on. The
 * second is preceded by two ripples at 1.0 and 0.5 (`FUN_004567C0`), which the
 * port has no water surface to put anywhere.
 */
const SURFACE_SPLASH_FRAMES = [0x15, 0x1b];
const SPLASH_EFFECT = 0x62;

/**
 * `ZombieStateArcScriptedEntrance`'s crouch, by character type: clip `0x10C`
 * held `0x21` play frames for type 0, `0x39F` held `0x2C` for every other.
 */
const ARC_CROUCH_TYPE0 = { motion: 0x10c, hold: 0x21 };
const ARC_CROUCH_OTHER = { motion: 0x39f, hold: 0x2c };

/**
 * The camera cue these states wait on.
 *
 * The engine accepts **either** `g_cam_path_frame` (camera block 0) or
 * `g_cam_path_frame_2` (block 2) — the same `+0xD0` field of two different
 * blocks.
 *
 * [diverges] The port models one camera block, so this tests the one it has.
 * A spawn whose cue is authored against block 2 waits on block 0's frame
 * instead; none of the 47 spawns across states 18, 19 and 23 was observed to
 * need the second, because a stage that is running block 2 is running a
 * cutscene camera the port does not drive either.
 */
function CamCueHit(frame: number): boolean {
  return G.g_cam_path_frame === frame;
}

/**
 * The branch every waiting entrance ends with: `obj+0x1310 = (s8)tail+0x03`.
 *
 * The `tail+0x03 == 15` arm is the one worth reading twice. It does not just
 * set state 15 — it latches `obj+0x1370` from the tail *and enters at sub 1*,
 * which is `ZombieStateWalkDistance`'s "record the start point" arm rather
 * than its "latch the distance" one. Entering at sub 0 instead would have the
 * walk overwrite the distance this state just chose with the one at state
 * 15's own `tail+0x04`, which for these spawns is a different field entirely.
 */
function ZombieEntranceBranch(obj: ZombieActor, walkDistance: number | undefined):
    void {
  if (obj.attackState === ZombieState.WalkDistance
      && walkDistance !== undefined) {
    obj.zom.targetArrive = walkDistance;
    obj.state = ZombieState.WalkDistance;
    obj.sub = 1;
    return;
  }
  obj.state = obj.attackState;
  obj.sub = 0;
}

/**
 * The re-asserted entrance clip — `if (!(obj+0x34 & 0x40000000) &&
 * obj+0x1B4 != clip) ActorSetMotion(model, clip)`.
 *
 * `ActorSetMotion` and not the blended one: no fade, and the clock restarts.
 * Since it is guarded on the clip not already being current, that only bites
 * on the frame the pose is taken back from a reaction.
 */
function ZombieHoldEntranceClip(obj: ZombieActor, motion: number | undefined): void {
  if (motion === undefined || motion <= 0) return;
  if (obj.flags & ActorFlag.Reacting) return;
  if (obj.motion === motion) return;
  ActorSetMotion(obj, motion);
}

/** The clip's last frame, on the play clock. Equality: the cursor wraps. */
function atLastFrame(obj: ZombieActor): boolean {
  const len = MotionPlayLength(obj);
  return len > 0 && MotionPlayFrame(obj) === len - 1;
}

/**
 * `ZombieStateSurfaceOnCameraCue` — `FUN_00456F50`, class 0x30 state 13.
 *
 * Sixteen spawns. The come-up-out-of-the-water entrance that waits on the
 * **camera** rather than on a delay, which is what separates it from
 * `ZombieStateEmerge` (state 27): the actor is frozen under the surface until
 * the camera path reaches the frame the descriptor names, and only then does
 * the clip that lifts it out start.
 *
 * The wait is `g_cam_path_frame >= cue`, a **`>=`** where states 18 and 19 use
 * an equality — so this one cannot be missed by a path that skips the frame.
 */
export function ZombieStateSurfaceOnCameraCue(obj: ZombieActor,
                                              events?: Events): void {
  const t = obj.entry;

  if (obj.sub === 0) {
    // `obj+0x34 |= 0x4100` — freeze the pose and take the actor out of the
    // shot test while it is still under the water.
    obj.flags |= ActorFlag.PoseFrozen | ActorFlag.ShotImmune;
    obj.frozen = 1;
    obj.flags2 &= ~ZombieFlag2.CollideWorld;
    const motion = SURFACE_WADER_TYPES.has(obj.charType)
      ? SURFACE_MOTION_WADER : SURFACE_MOTION_OTHER;
    ActorSetMotion(obj, motion);
    obj.sub = 1;
    return;
  }

  if (obj.sub === 1) {
    if (G.g_cam_path_frame < (t?.cue_frame ?? 0)) return;
    obj.sub = 2;
    obj.flags &= ~(ActorFlag.PoseFrozen | ActorFlag.ShotImmune);
    obj.frozen = 0;
    obj.flags2 |= ZombieFlag2.CollideWorld;
  }

  if (obj.motion === SURFACE_MOTION_WADER) {
    const f = MotionPlayFrame(obj);
    for (const at of SURFACE_SPLASH_FRAMES) {
      if (f === at) {
        events?.emit("feed.note", {
          name: "zombie", cat: "combat",
          note: `surfaces — splash ${SPLASH_EFFECT} at frame ${at}`,
        });
      }
    }
  }
  if (atLastFrame(obj)) ZombieEntranceBranch(obj, t?.walk_distance);
}

/**
 * `ZombieStateRunInPlaceTimed` — `FUN_00457160`, class 0x30 state 14.
 *
 * Two spawns. Runs on the spot for a fixed count and then joins the attack
 * run. It is `ZombieStateWalkDistance` with a **timer** where that has a
 * distance, down to writing the same `obj+0x13D8` end point when it finishes,
 * and like it the state never moves the actor: the clip's root motion does.
 */
export function ZombieStateRunInPlaceTimed(obj: ZombieActor, dt: number,
                                           rng: Rng): void {
  const row = MotionRowOf(obj);
  // `row[2 + ((obj+0x34 >> 0x1B) & 1)]` — the run pair, the same selection
  // `ZombieStateAttackRun` and `ZombieStateWalkDistance` make.
  const motion = FirstBakedOf(obj, row, MotionRow.Run, MotionRow.RunAlt,
                              MotionRow.Walk, MotionRow.WalkAlt);

  if (obj.sub === 0) {
    obj.zom.holdFrames = obj.entry?.frames ?? 0;
    obj.sub = 1;
  }
  if (obj.sub !== 1) return;

  // `rand() % g_motion_play_length[motion]` — a random start so a rank of
  // them is not in lockstep. Fade 5.
  ZombieSetMotionIfIdle(obj, motion, rng, "clip", MotionFade.Quick);

  obj.zom.holdFrames -= dt * 60;
  if (obj.zom.holdFrames >= 1) return;
  obj.strikeStart.x = obj.pos.x;
  obj.strikeStart.y = obj.pos.y;
  obj.strikeStart.z = obj.pos.z;
  obj.state = ZombieState.AttackRun;
  obj.sub = 0;
}

/**
 * `ZombieStateHoldClipThenBranch` — `FUN_004574D0`, class 0x30 state 17.
 *
 * **Thirty-eight spawns: the commonest entrance in the game after the attack
 * run itself.** Plays one clip for a fixed count and then goes wherever the
 * descriptor points — usually state 1, but for twenty-four of them state 15,
 * the scripted walk-in, with a distance this state latches on the way past.
 *
 * Shipped values are a clip at `+0x04`, 14 to 420 frames at `+0x08`, and a
 * 1-to-10 unit walk distance at `+0x0C`.
 */
export function ZombieStateHoldClipThenBranch(obj: ZombieActor, dt: number): void {
  const t = obj.entry;
  if (obj.sub === 0) {
    obj.zom.holdFrames = t?.frames ?? 0;
    obj.sub = 1;
  } else if (obj.sub !== 1) {
    return;
  }
  ZombieHoldEntranceClip(obj, t?.motion);
  obj.zom.holdFrames -= dt * 60;
  if (obj.zom.holdFrames >= 1) return;
  ZombieEntranceBranch(obj, t?.walk_distance);
}

/**
 * `ZombieStateWaitCameraFrameThenBranch` — `FUN_004575A0`, class 0x30 state 18.
 *
 * Thirty-seven spawns. Holds its clip until the camera path reaches an
 * **exact** frame, then branches. The equality is the engine's and is worth
 * keeping: a spawn whose frame the path steps over waits for ever, which is
 * how the game parks a rank of zombies that a given camera run never triggers.
 */
export function ZombieStateWaitCameraFrameThenBranch(obj: ZombieActor): void {
  const t = obj.entry;
  if (obj.sub === 0) {
    ZombieHoldEntranceClip(obj, t?.motion);
    if (!CamCueHit(t?.cue ?? -1)) return;
    obj.sub = 1;
  } else if (obj.sub !== 1) {
    return;
  }
  ZombieEntranceBranch(obj, undefined);
}

/**
 * `ZombieStateWaitScriptFlagThenBranch` — `FUN_00457780`, class 0x30 state 20.
 *
 * Two spawns, both stage 2, both waiting on script flag 53 while they play
 * clip 198. Byte for byte the state above with the camera gate replaced by
 * `g_script_flags[tail+0x08] == 1`.
 */
export function ZombieStateWaitScriptFlagThenBranch(obj: ZombieActor): void {
  const t = obj.entry;
  if (obj.sub === 0) {
    ZombieHoldEntranceClip(obj, t?.motion);
    // `?? 0` and not a bare read: a flag the script has never set is absent
    // from the array, and `undefined !== 1` would be true either way — but
    // the explicit default is what stops a future `!= 0` reading from firing
    // on frame one. Same guard class 0x10's script-flag wait carries.
    if ((G.g_script_flags[t?.cue ?? -1] ?? 0) !== 1) return;
    obj.sub = 1;
  } else if (obj.sub !== 1) {
    return;
  }
  ZombieEntranceBranch(obj, undefined);
}

/**
 * `ZombieStateWaitScriptFlagThenEnter` — `FUN_00458CE0`, class 0x30 state 31.
 *
 * Four spawns, all stage 2, all identical but for their delay. The point of
 * this one is not the wait, it is the **counters**: unlike every other
 * entrance, an actor here is not part of the game at all until its flag comes
 * up, and it increments `g_enemies_present` and `g_enemies_alive` itself when
 * it joins. Until then `wait_enemies_alive` cannot see it.
 */
export function ZombieStateWaitScriptFlagThenEnter(obj: ZombieActor, dt: number,
                                                   rng: Rng): void {
  const t = obj.entry;

  if (obj.sub === 0) {
    obj.flags |= ActorFlag.ShotImmune;
    ZombieSetMotionIfIdle(obj, t?.idle_motion, rng, "clip", MotionFade.Quick);
    obj.sub = 1;
    return;
  }

  if (obj.sub === 1) {
    if ((G.g_script_flags[t?.flag ?? -1] ?? 0) !== 1) return;
    // `obj+0x34 &= ~0x10000` — back into camera tracking, and into the two
    // counts that gate the script's own waits.
    obj.flags &= ~ActorFlag.NoCameraTrack;
    CountEnemyZombieJoin(obj);
    obj.zom.holdFrames = t?.delay ?? 0;
    obj.sub = 2;
  }

  if (obj.sub === 2) {
    obj.zom.holdFrames -= dt * 60;
    if (obj.zom.holdFrames >= 1) return;
    ZombieSetMotionIfIdle(obj, t?.motion, rng, 10, MotionFade.Quick);
    obj.sub = 3;
  }

  if (obj.sub === 3) {
    // `obj+0x1B4 != tail+0x10 || 0x4D < obj+0x19C`. The clip check first: if
    // the entrance clip never took, the actor leaves at once rather than
    // waiting out a cursor that will not arrive.
    if (obj.motion === (t?.motion ?? -1) && MotionPlayFrame(obj) <= 0x4d) {
      return;
    }
    obj.state = ZombieState.AttackRun;
    obj.sub = 0;
    obj.flags &= ~ActorFlag.ShotImmune;
  }
}

/**
 * `ZombieStateRideCarrier` — `FUN_00458960`, class 0x30 state 29.
 *
 * Six spawns, all stage 2. The actor is a **passenger**: it records its own
 * spawn position once and then every frame sets its position to that offset
 * *plus* `g_carrier_object`'s, so it moves with whatever the player is riding.
 * It plays the walk row on the spot and reads **nothing** from the descriptor
 * tail but byte 3 — the tail belongs to the state it hands over to, which the
 * shipped data proves cleanly: the three spawns whose byte 3 is 26 carry a
 * `ZombieStateDelayedLeap` tail and the three whose byte 3 is 30 carry a
 * `ZombieStateArcScriptedEntrance` one.
 *
 * [diverges] **The port has no rideable object**, so `g_carrier_object` is -1
 * and there is nothing to add. Two consequences, both taken deliberately:
 * the actor holds at its spawn position rather than riding, and — since the
 * ride ends when the carrier raises `obj+0x34` bit 0x10000000 and no carrier
 * ever will — the state hands over **immediately** when there is no carrier at
 * all, rather than parking six spawns for ever. Riding properly needs the
 * vehicle classes (`St1VehicleUpdate`, `FUN_0048E5B0` and its peers), which is
 * a separate port and not a line edit here.
 */
export function ZombieStateRideCarrier(obj: ZombieActor, rng: Rng): void {
  if (obj.sub === 0) {
    // `obj+0x13E4/E8/EC = obj+0x40/44/48` — the engine writes x, then z, then
    // y, into the three words `ActorFacePlayerTarget` otherwise uses.
    obj.target.x = obj.pos.x;
    obj.target.z = obj.pos.z;
    obj.target.y = obj.pos.y;
    obj.flags2 |= ZombieFlag2.Carried;
    obj.sub = 1;
  }

  const row = MotionRowOf(obj);
  ZombieSetMotionIfIdle(obj, FirstBakedOf(obj, row, MotionRow.Walk), rng, 5,
                        MotionFade.Normal);

  const carrier = G.g_carrier_object >= 0
    ? ActorByAt(G.g_carrier_object) : undefined;
  if (carrier) {
    obj.pos.x = obj.target.x + carrier.pos.x;
    obj.pos.y = obj.target.y + carrier.pos.y;
    obj.pos.z = obj.target.z + carrier.pos.z;
  }
  // `(carrier+0x34 & 0x10000000) != 0` — the carrier says it is done. With no
  // carrier ported there is nothing to say it, so the ride is over at once.
  if (!carrier || (carrier.flags & ActorFlag.Committed)) {
    obj.flags2 &= ~ZombieFlag2.Carried;
    obj.state = obj.attackState;
    obj.sub = 0;
  }
}

/**
 * `ZombieStateArcScriptedEntrance` — `FUN_00458A70`, class 0x30 state 30.
 *
 * Three spawns, all stage 4, all reached from `ZombieStateRideCarrier` rather
 * than started in. Wait, crouch, then ride a scripted ballistic arc to a world
 * point: `ActorArcBegin` sets the endpoints and `ActorArcStep` runs the flight
 * and its three-stage motion script together, which is class 0x31's machinery
 * reused whole — see `class31/arc.ts`.
 *
 * The crouch and the arc script are chosen by character type, not by anything
 * in the descriptor: clip `0x10C` held `0x21` frames for type 0 and `0x39F`
 * held `0x2C` for every other.
 *
 * [open] The engine's sub 1 has a second arm, taken when the descriptor's own
 * byte `+0x02` is `0x16`, that waits on a camera frame instead of counting the
 * delay down. `+0x02` is the initial-state byte, so for a spawn that starts
 * here it reads 30 and for one routed from state 29 it reads 29 — never 0x16.
 * No shipped record takes it; the countdown arm is the only live one.
 *
 * [diverges] The engine's landing plays sound `0x2A16A9`, or `0x1C16A9` with a
 * screen shake at `DAT_009C8E8C = 0x20` for body condition 5. The port has
 * neither sound nor shake here, so the landing is silent.
 */
export function ZombieStateArcScriptedEntrance(obj: ZombieActor,
                                               dt: number): void {
  const t = obj.entry;

  if (obj.sub === 0) {
    obj.zom.holdFrames = t?.delay ?? 0;
    obj.sub = 1;
  }

  if (obj.sub === 1) {
    obj.zom.holdFrames -= dt * 60;
    if (obj.zom.holdFrames >= 1) return;
    const crouch = obj.charType === 0 ? ARC_CROUCH_TYPE0 : ARC_CROUCH_OTHER;
    ActorSetMotion(obj, crouch.motion);
    obj.zom.holdFrames = crouch.hold;
    obj.sub = 2;
    // `obj+0x34 |= 0x2000` — the arc is armed but has not begun.
    obj.flags |= ActorFlag.ArcSpent;
  }

  if (obj.sub === 2) {
    // The crouch is measured on the play clock, not on the timer.
    if (MotionPlayFrame(obj) < obj.zom.holdFrames) return;
    obj.sub = 3;
  }

  if (obj.sub === 3) {
    const d = t?.dest;
    if (!d) { obj.state = ZombieState.AttackRun; obj.sub = 0; return; }
    ActorArcBegin(obj, { x: d[0], y: d[1], z: d[2] }, t?.frames ?? 1);
    InstallArcMotionScript(obj, ZombieArcEntranceScript(obj));
    obj.arcPhase = ArcPhase.Windup;
    obj.flags2 &= ~ZombieFlag2.Carried;
    obj.sub = 4;
  }

  if (obj.sub !== 4) return;

  const flying = obj.arcPhase === ArcPhase.Flight
              || obj.arcPhase === ArcPhase.Landing;
  if (flying) obj.flags2 |= ZombieFlag2.Carried;
  else obj.flags2 &= ~ZombieFlag2.Carried;

  if (ActorArcStep(obj, t?.step ?? 1, dt)) return;

  obj.flags2 &= ~ZombieFlag2.Carried;
  obj.flags &= ~ActorFlag.ArcSpent;
  // The engine keeps the permit if it somehow has one and goes straight to the
  // strike; otherwise it joins the attack run.
  if (obj.attackPermit === -1) {
    obj.state = ZombieState.AttackRun;
  } else {
    G.g_attack_permits[obj.attackPermit] = obj.at;
    obj.state = ZombieState.Strike;
  }
  obj.sub = 0;
}
