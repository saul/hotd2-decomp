/**
 * Class 0x20 — the one-hit target. 36 spawns across stages 1, 2, 3 and 5.
 *
 * A skinned actor, every one of them character type 7 (`char_adv00.bin`), that
 * stands or wanders in front of the camera and **dies to any single hit**.
 * Nothing in the class subtracts from `obj+0x11C`: the branch on `obj+0x34`
 * bit 3 — the bit `MarkActorShot` (`FUN_00404DB0`) raises — is the entire
 * damage model, so there is no hit-point table, no damage row and no reaction.
 * It is not an enemy either: its Init increments no counter, so no
 * `wait_enemies_alive` gate ever sees one.
 *
 * ## The four routines, and what the port does with them
 *
 * The engine swaps the object's entry point rather than keeping a state word:
 *
 * ```
 * OneHitTargetInit           FUN_00448ED0   installs the first of these
 * OneHitTargetUpdate         FUN_00449020   alive: idle, removal test, the shot
 * OneHitTargetPlayDeathClip  FUN_00449380   motion 988, held on its last frame
 * OneHitTargetSinkAndDespawn FUN_00449430   120 frames of body, sinking
 * OneHitTargetHoldDrawn      FUN_004494D0   drawn and nothing else  [not ported]
 * ```
 *
 * {@link OneHitTargetState} is that pointer as a value — the same move class
 * 0x25 makes with `pc = -1`.
 *
 * ## What the descriptor says
 *
 * ```
 * tail+0x00  s8   character type          -> obj+0x1F4
 * tail+0x01  s8   sub-type                -> obj+0x130C
 * tail+0x02  s16  removal: cam path
 * tail+0x04  s16  removal: cam frame
 * tail+0x06  s16  motion, 0 = rand() & 3 of `g_class20_idle_motions`
 * tail+0x08  f32  sub-type 2 only: x min      \
 * tail+0x0C  f32  sub-type 2 only: x max       |  the wander box
 * tail+0x10  f32  sub-type 2 only: z min       |
 * tail+0x14  f32  sub-type 2 only: z max      /
 * ```
 *
 * **The first two bytes are class 0x30's body condition and initial state**,
 * which is why the exporter carries this under its own `class20` key rather
 * than in the shared placement fields — `descriptor.ts` maps it to
 * {@link Actor.oneHitTarget}. The box exists only for sub-type 2: the four
 * stage-2 spawns at `0x52EC`..`0x5370` have an **eight-byte** tail and
 * `tail+0x08` there is already the next descriptor's class word.
 *
 * Sub-type census over the 36 shipped spawns: 7 of sub-type 0, 5 of 1, 24 of
 * 2. The one the bug report names — stage 2, block 9, step 4, op 13, spawn
 * `0x52EC` — is sub-type 0 with motion 0.
 *
 * ## What is not ported, by name
 *
 * * `OneHitTargetHoldDrawn` and the `g_GameMode` 2 / block 0x0D arms that
 *   reach it. The two gate bytes are `[open]`.
 * * `OneHitTargetBoneDrawHook` (`FUN_00449530`) — a per-bone draw callback
 *   that writes nothing to the actor. The renderer's.
 * * `SpawnBoneHitSprite` (`FUN_00407200`) and `SpawnGroundRingEffect`. Both
 *   allocate their own drawing tasks and neither touches this actor.
 * * The damaged-part swap `g_pBoneEffectSlots[type][bone][0]`. The port has
 *   `ActorSwapDamagedPart` for the combat classes; wiring class 0x20's
 *   single-index read of the same table to it is a renderer question and is
 *   left `[open]` rather than half-done.
 */
import { ActorFlag, type Actor, type OneHitTargetActor } from "../actor";
import { ActorDespawn } from "../despawn";
import { G } from "../globals";
import type { Rng } from "../../core/rng";
import { ScoreAddForPlayer } from "../combat/score";
import { authoredFrameHeld, ticksOfAuthoredFrame }
  from "../../core/play_cursor";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";
import { MotionOf } from "../tables";
import { OneHitTargetState, type OneHitTargetTail } from "./state";

export { OneHitTargetState, type OneHitTargetTail };

/**
 * `g_class20_idle_motions` — `0x005647A4`. `u32[4]`, read out of `.rdata` as
 * `fd030000 ff030000 00040000 01040000`.
 *
 * `OneHitTargetInit` (`FUN_00448ED0`) picks one with `rand() & 3` when the
 * spawn's `tail+0x06` names no motion — eight of the 36 shipped spawns. All
 * four are ids character type 7 carries.
 */
export const g_class20_idle_motions: readonly number[] =
  [1021, 1023, 1024, 1025];

/**
 * The clip `OneHitTargetUpdate` (`FUN_00449020`) cues the frame the actor is
 * shot: `ActorSetMotionBlended(obj+0x194, 0x3DC, 0, 5)`.
 */
export const CLASS20_DEATH_MOTION = 988;

/** `obj+0x1330 = 0x78` in `OneHitTargetPlayDeathClip` (`FUN_00449380`). */
export const CLASS20_SINK_FRAMES = 120;

/**
 * `obj+0x44` loses this much a frame while the body sinks —
 * `FSUB dword ptr [0x0055xxxx]` folded by the decompiler as `- 0.04` at
 * `0x00449467`. Over {@link CLASS20_SINK_FRAMES} that is 4.8 units.
 */
export const CLASS20_SINK_PER_FRAME = 0.04;

/**
 * Sub-type 1's spin, in BAMS a frame: `+0x40` when the s16 at `obj+0x11C` is
 * non-zero and `-0x40` when it is zero.
 *
 * `[proved]` — `obj+0x1A * 4 = obj+0x68` (the yaw) gains
 * `((-(uint)(*(short *)(obj+0x11C) != 0) & 0x80) - 0x40)`, which is `0 - 0x40`
 * or `0x80 - 0x40`. `obj+0x11C` is the **spawn record's `+0x22` word**, which
 * `SpawnFromDescriptor` (`FUN_00408A20`) copies there before the Init runs —
 * the field the exporter calls `hp`, and one of the polymorphic ones: for this
 * class it is a direction and not a hit-point count.
 */
export const CLASS20_SPIN_STEP = 0x40;

/** Sub-type 2 turns this far away from a wall it has been clamped against. */
export const CLASS20_WALL_TURN = 0x100;

/** Class 0x20's sub-types, `obj+0x130C`, from `OneHitTargetUpdate`'s tail. */
export enum OneHitTargetSubType {
  /** Neither spins nor wanders. The clip's own root motion is all it has. */
  Still = 0,
  /** Spins on the spot at {@link CLASS20_SPIN_STEP} BAMS a frame. */
  Spin = 1,
  /** Kept inside the tail's x/z box, turning away at each wall. */
  Boxed = 2,
}

/**
 * Bone 2 is the head, for this class as for every other: the arm at
 * `iVar6 == 2` in `OneHitTargetUpdate`'s bone loop is the one that pays 120
 * and grows `g_head_combo_bonus`.
 */
export const CLASS20_HEAD_BONE = 2;

/** `ScoreAddForPlayer(player, 0x78)` on the head arm. */
export const CLASS20_SCORE_HEAD = 120;
/** ...and `10` on every other bone, which also zeroes the combo. */
export const CLASS20_SCORE_HIT = 10;
/** `g_head_combo_bonus += 10` after a head hit has been paid. */
export const CLASS20_SCORE_HEAD_COMBO_STEP = 10;
/** `ScoreAddForPlayer(who, 0x50)` once, for the kill. */
export const CLASS20_SCORE_KILL = 80;

/**
 * `OneHitTargetInit` — `FUN_00448ED0`.
 *
 * [diverges] Six things the engine's Init does are the renderer's or are
 * unreachable here, and none of them is state this port keeps:
 * `ActorBuildSkinnedModel`, the bone-draw hook at `obj+0x12EC`,
 * `obj+0x120 = 0xFF` and `obj+0x3C = -1` (a camera slot and a hit slot this
 * class never claims), the `g_app_state == 10` arm that takes the actor out of
 * the shot test with `obj+0x34` bit `0x8000`, and `obj+0x124` from
 * `g_actor_radius_by_char` — which the port's shot test does not use, because
 * `pickShot` is answered by three.js.
 *
 * `rng` is required and used: the engine calls `rand()` twice here, and a draw
 * that is not from `ctx.rng` is a save state that does not restore.
 */
export function OneHitTargetInit(obj: Actor, rng?: Rng): void {
  const a = obj as OneHitTargetActor;
  a.tgt.state = OneHitTargetState.Alive;
  const d = a.oneHitTarget;
  // `if (tail+6 == 0) obj+0x1B4 = g_class20_idle_motions[rand() & 3]`. The
  // engine's mask is `rand() & 0x80000003` sign-corrected, which is
  // `rand() % 4` for a non-negative `rand()`; `Rng.int(4)` is the same draw.
  const authored = d?.motion ?? 0;
  a.motion = authored > 0
    ? authored
    : g_class20_idle_motions[rng ? rng.int(g_class20_idle_motions.length) : 0];
  // `param_1[0x65] = rand()` — `obj+0x194`, the frame counter, so every one of
  // a group opens on a different frame of the same idle. The engine seeds it
  // with the whole of `rand()` and lets the draw wrap it; the port's cursor is
  // the same counter, so it is taken modulo the clip rather than left huge.
  const m = MotionOf(a, a.motion);
  const frames = m?.frames ?? 0;
  a.playTicks = (rng && frames > 0)
    ? ticksOfAuthoredFrame(rng.int(frames), m?.fps ?? 30) : 0;
  a.rootFrame = -1;
  // `obj+0x1F8 |= 2`. Root motion's gate is bit 1 of that word and
  // `ActorBuildSkinnedModel` already sets it to 3 for every skeletal actor —
  // see `root_motion.ts` — so there is nothing for the port to do here.
}

/**
 * The removal test `OneHitTargetUpdate` (`FUN_00449020`) runs on every frame
 * the actor has **not** been shot.
 *
 * `g_active_cam_path == tail+0x02 && g_cam_path_frame >= tail+0x04`, which is
 * the same shape class 0x24 and class 0x25 use — but **without** their
 * `obj+0x34` bit `0x2000000` script-flag alternative: class 0x20 has no such
 * arm, and all 36 shipped spawns carry `init_flags` 0.
 *
 * [port-only] as a *function*: the engine has this inline at `0x0044907F` and
 * there is no exe routine here to name. Split out so a test can drive the
 * removal cue without also driving the shot.
 */
export function OneHitTargetShouldRemove(obj: OneHitTargetActor): boolean {
  const d = obj.oneHitTarget;
  if (!d) return false;
  return G.g_active_cam_path === d.remove_path
      && G.g_cam_path_frame >= d.remove_frame;
}

/**
 * The bone loop, the scoring and the transition into the death clip — the
 * `else` arm of `OneHitTargetUpdate`'s test on `obj+0x34` bit 3.
 *
 * [diverges] The engine walks all sixteen bone records at `obj+0x280 +
 * bone*0x90` and scores **every** one whose flags carry bit 3, because a
 * frame can deliver more than one hit. The port's shot model is one
 * `pendingHit` per actor — `MarkActorShot` (`FUN_00404DB0`) records a single
 * bone — so this scores the one bone that is pending. With one player and one
 * ray per click the two agree; a second simultaneous hit would score once here
 * and twice in the engine.
 *
 * [port-only] as a *function*: this is the body of `OneHitTargetUpdate`
 * (`FUN_00449020`) from `0x0044909A` to `0x0044922E`, not a routine of its
 * own. Split out because it is the half of the class worth asserting on.
 */
export function OneHitTargetTakeShot(obj: OneHitTargetActor, rng: Rng): void {
  const bone = obj.pendingHit?.bone ?? 0;
  // Who fired: `obj+0x34` bits 1 and 2, and `rand() & 1` when neither is set —
  // which happens for a debug kill, not for a shot.
  const p0 = (obj.flags & 0x2) !== 0;
  const p1 = (obj.flags & 0x4) !== 0;
  const who = p0 && !p1 ? 0 : p1 && !p0 ? 1 : rng.int(2);

  if (bone === CLASS20_HEAD_BONE) {
    ScoreAddForPlayer(who, CLASS20_SCORE_HEAD);
    ScoreAddForPlayer(who, G.g_head_combo_bonus[who] ?? 0);
    G.g_head_combo_bonus[who] =
      (G.g_head_combo_bonus[who] ?? 0) + CLASS20_SCORE_HEAD_COMBO_STEP;
  } else {
    ScoreAddForPlayer(who, CLASS20_SCORE_HIT);
    // Any non-head hit zeroes the combo — the same rule the combat classes
    // have, written out again because the engine writes it out again.
    G.g_head_combo_bonus[who] = 0;
  }
  G.g_player_hit_count[who] = (G.g_player_hit_count[who] ?? 0) + 1;

  ScoreAddForPlayer(who, CLASS20_SCORE_KILL);
  // `param_1[0xd] &= 0xfffffffe` — bit 0 goes, which is what takes the actor
  // out of `RegisterForShotTest` and so out of the shot list for good.
  obj.flags &= ~0x1;
  obj.dead = true;
  obj.killedBy = who;
  G.g_one_hit_target_kills += 1;

  obj.motion = CLASS20_DEATH_MOTION;
  obj.playTicks = 0;
  obj.rootFrame = -1;
  obj.tgt.state = OneHitTargetState.Dying;
}

/**
 * Sub-type 1's spin and sub-type 2's box — the tail of
 * `OneHitTargetUpdate` (`FUN_00449020`), which runs on the shot frame too.
 *
 * The box clamps first in x and then in z, and **turns only once**: the flag
 * the engine keeps (`bVar3`) is set by an x clamp and suppresses the z turn,
 * so an actor cornered in both directions turns 0x100 BAMS and not 0x200.
 *
 * [port-only] as a *function*: the engine has this inline at `0x00449234` to
 * `0x00449333`, with no routine of its own to name.
 */
export function OneHitTargetStepIdle(obj: OneHitTargetActor): void {
  const d = obj.oneHitTarget;
  if (!d) return;
  if (d.subtype === OneHitTargetSubType.Spin) {
    // `obj+0x11C` is the descriptor's `+0x22` word — `hp` in the bundle, and
    // a direction here. See {@link CLASS20_SPIN_STEP}.
    obj.yaw += obj.hp !== 0 ? CLASS20_SPIN_STEP : -CLASS20_SPIN_STEP;
    return;
  }
  if (d.subtype !== OneHitTargetSubType.Boxed || !d.box) return;
  const [xmin, xmax, zmin, zmax] = d.box;
  let turned = false;
  if (obj.pos.x >= xmax) {
    obj.pos.x = xmax;
    obj.yaw += obj.yaw < 0xc000 ? -CLASS20_WALL_TURN : CLASS20_WALL_TURN;
    turned = true;
  } else if (obj.pos.x <= xmin) {
    obj.pos.x = xmin;
    obj.yaw += obj.yaw > 0x3fff ? CLASS20_WALL_TURN : -CLASS20_WALL_TURN;
    turned = true;
  }
  if (obj.pos.z >= zmax) {
    obj.pos.z = zmax;
    if (turned) return;
    obj.yaw += obj.yaw < 0x8000 ? -CLASS20_WALL_TURN : CLASS20_WALL_TURN;
  } else if (obj.pos.z <= zmin) {
    obj.pos.z = zmin;
    if (turned) return;
    obj.yaw += obj.yaw < 0x8000 ? CLASS20_WALL_TURN : -CLASS20_WALL_TURN;
  }
}

/**
 * `OneHitTargetUpdate` — `FUN_00449020`.
 *
 * [diverges] The `g_GameMode == 2 && g_evt_block_index == 0x0D` arm at the top
 * — the one that leads to `OneHitTargetHoldDrawn` (`FUN_004494D0`) — is not
 * ported: its two gate bytes are `[open]`, and reading them wrong would freeze
 * an actor that should be alive. The port always takes the ordinary path.
 *
 * [diverges] `RegisterForShotTest` (`FUN_00405160`), which the engine calls at
 * the bottom of every frame `obj+0x34` bit 0 is set, is not called: the port's
 * shot test is `GameHost.pickShot`, answered from three.js, and there is no
 * per-frame registration list to join. `obj+0x34` bit 0 is still cleared on
 * death, because that is the bit the engine's list is gated on and a class
 * that clears it has left the test.
 */
export function OneHitTargetUpdate(obj: Actor, f: ClassFrame): void {
  const a = obj as OneHitTargetActor;
  switch (a.tgt.state) {
    case OneHitTargetState.Dying:
      return OneHitTargetPlayDeathClip(a);
    case OneHitTargetState.Sinking:
      return OneHitTargetSinkAndDespawn(a);
    case OneHitTargetState.HeldDrawn:
      return;                       // not ported -- see the file comment
  }

  if ((a.flags & ActorFlag.Hit) !== 0) {
    OneHitTargetTakeShot(a, f.rng);
  } else if (OneHitTargetShouldRemove(a)) {
    // `g_hit_slots[obj+0x3C] = 0; ActorDespawn(obj)`. The slot write is not
    // ported: `OneHitTargetInit` leaves `obj+0x3C` at -1 and nothing in the
    // class claims one, so what the engine indexes there is `[open]`.
    ActorDespawn(a);
    return;
  }
  // The tail runs on the shot frame as well: the engine falls through from the
  // bone loop into it rather than returning.
  OneHitTargetStepIdle(a);
  // `param_1[0xd] &= 0xfffffff7` -- the hit bit is consumed, every frame.
  a.flags &= ~ActorFlag.Hit;
  a.pendingHit = null;
}

/**
 * `OneHitTargetPlayDeathClip` — `FUN_00449380`.
 *
 * Steps the clip and, on the frame `obj+0x19C` reaches
 * `g_motion_play_length[obj+0x1B4]`, **undoes the step** so the pose holds,
 * arms the 120-frame countdown and hands the body to
 * `OneHitTargetSinkAndDespawn` (`FUN_00449430`).
 *
 * **The hold is `*piVar1 = iVar2`, and it is load-bearing.** The routine steps
 * `obj+0x194` at the top of every frame and, on the frame the clip ends,
 * *writes the old value back* — and `OneHitTargetSinkAndDespawn` never steps
 * it at all. So the counter stops for good and the body sinks on the last
 * pose of the death clip:
 *
 * ```
 * 004493c8  MOV  EAX, [EDI]          ; iVar2 = obj+0x194
 * 004493ca  LEA  ECX, [EAX + 1]
 * 004493cd  MOV  [EDI], ECX          ; step it
 * ...
 * 004493e3  MOV  [EDI], EAX          ; ...and put it back
 * 004493e5  MOV  dword ptr [ESI + 0x1330], 0x78
 * ```
 *
 * The port's clock is `ActorAdvanceMotion`'s and it is shared, so "does not
 * step it" has to be written as an undo — {@link OneHitTargetPinLastFrame}.
 * Without it the base track ran on under the sink and the poser, which reads
 * the base track with the **wrapping** `authoredFrameOfTicks`, restarted the
 * clip: character type 7's clip 988 is 82 frames and the sink is 120, so the
 * death animation visibly played a second time and got 38 frames into a
 * third. That is the "plays its death animation twice" report, and this file
 * used to claim the port could not hold the counter and that the visible
 * result was the same. It is not, and it can.
 */
export function OneHitTargetPlayDeathClip(obj: OneHitTargetActor): void {
  const m = MotionOf(obj, obj.motion);
  if (!m || m.frames <= 0) {
    // No clip in this bundle. The engine cannot reach this -- every id indexes
    // `g_motion_play_length` -- so rather than park for ever (which is what
    // class 0x25 did, and was bug B13) the body goes straight to the sink.
    obj.arcFrames = CLASS20_SINK_FRAMES;
    obj.tgt.state = OneHitTargetState.Sinking;
    return;
  }
  if (authoredFrameHeld(obj.playTicks, m.fps, m.frames) >= m.frames - 1) {
    // `obj+0x1330` is the shared arc word on the head, not a class-0x20 field.
    // See `class20/state.ts`.
    OneHitTargetPinLastFrame(obj);
    obj.arcFrames = CLASS20_SINK_FRAMES;
    obj.tgt.state = OneHitTargetState.Sinking;
  }
}

/**
 * `*piVar1 = iVar2` — put the play counter back where it was.
 *
 * [port-only] as a function: in the engine it is one `MOV`, and the sink after
 * it simply never touches the counter again. Here the counter is stepped for
 * every actor by `ActorAdvanceMotion` before any class handler runs, so the
 * two routines that hold this pose have to undo that step themselves.
 *
 * Pinned to the ticks of the **last authored frame** rather than to whatever
 * the counter happened to hold: both conversions agree there — the wrapping
 * `authoredFrameOfTicks` has not wrapped yet at `frames - 1` — so the pose the
 * poser draws is the pose the engine holds, and it cannot drift a frame either
 * way with the clip's fps.
 */
function OneHitTargetPinLastFrame(obj: OneHitTargetActor): void {
  const m = MotionOf(obj, obj.motion);
  if (!m || m.frames <= 0) return;
  obj.playTicks = ticksOfAuthoredFrame(m.frames - 1, m.fps);
  obj.rootFrame = m.frames - 1;
}

/**
 * `OneHitTargetSinkAndDespawn` — `FUN_00449430`.
 *
 * [diverges] `SpawnGroundRingEffect` fires once on the way in — but only in
 * `g_app_state` 6, and it allocates a drawing task rather than touching this
 * actor, so it is the renderer's and is not called here.
 */
export function OneHitTargetSinkAndDespawn(obj: OneHitTargetActor): void {
  // The engine's sink draws the model and never steps `obj+0x194`, so the body
  // goes down on the death clip's last pose. See {@link OneHitTargetPinLastFrame}.
  OneHitTargetPinLastFrame(obj);
  obj.arcFrames -= 1;
  obj.pos.y -= CLASS20_SINK_PER_FRAME;
  if (obj.arcFrames === 0) ActorDespawn(obj);
}

/** One target, for the sidebar. [port-only]. */
export function OneHitTargetDebug(a: Actor): ActorDebug {
  const obj = a as OneHitTargetActor;
  const d = obj.oneHitTarget;
  if (!d) return { summary: "no class20 block in the bundle", hot: true };
  const sub = OneHitTargetSubType[d.subtype] ?? `sub-type ${d.subtype}`;
  const detail = [
    `motion ${obj.motion}`
      + (d.motion === 0 ? " (drawn from g_class20_idle_motions)" : ""),
    `removed at cam path ${d.remove_path} frame ${d.remove_frame}`,
  ];
  if (d.box) {
    detail.push(`box x [${d.box[0]}, ${d.box[1]}] z [${d.box[2]}, ${d.box[3]}]`);
  }
  if (obj.tgt.state === OneHitTargetState.Sinking) {
    detail.push(`${obj.arcFrames} frames of body left`);
  }
  return {
    summary: `${OneHitTargetState[obj.tgt.state]} · ${sub}`,
    detail,
    hot: obj.tgt.state === OneHitTargetState.Alive
      && (obj.flags & ActorFlag.Hit) !== 0,
  };
}

export const OneHitTargetHandler: ClassHandler = {
  init: OneHitTargetInit,
  update: OneHitTargetUpdate,
  // The death chain is three states long and the last of them is what despawns
  // the body, so the director has to keep calling it after `dead` is set --
  // the same reason class 0x31 has this.
  updatesWhenDead: true,
  // The class reads `obj+0x34` bit 3 itself. Sending a shot through
  // `ResolveHit` would charge hit points this actor does not have and look up
  // a damage row it has no entry in.
  ownsShotResult: true,
  debug: OneHitTargetDebug,
};

registerClass(SpawnClass.OneHitTarget, OneHitTargetHandler);
