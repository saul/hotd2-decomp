/**
 * Class 0x41 type 77 — Original Mode's flying bonus.
 *
 * Twenty-four shipped spawns, in every stage that places anything but stage 6,
 * and all of them inert unless a player **holds Original Mode item 0x1F**:
 * the routine's head is `g_GameMode != 1 || !PlayerHoldsOriginalItem(0x1F)`,
 * and then it plays `0x800A9` and leaves. Item 0x1F's own model is `0x10AB`
 * (`g_original_item_records[31]`), and `0x10AB` is what this draws — so the
 * item is what calls these out.
 *
 * With the item held, on its first frame it rolls `rand() % 3`: a 0 and it is
 * gone without a sound, anything else and it plays `0x700A9` and flies. It
 * rides `op_` path `0x195` — one of the two global paths every stage carries
 * — carried by its placement: `T(pos) RotY(yaw) T(path)`, spinning `0x400` a
 * frame and drawn at twice size, for 400 frames, and then plays `0x800A9`
 * again and leaves. Shot, it pays **2000 points** and a hit, throws a spark
 * four times the usual size at the aim, stops on its path and blinks for 61
 * frames before it goes.
 *
 * It has no lifetime: the descriptor's `+0x11C` of 1 is never read. The
 * pseudocode stops at the first `PlaySoundId`, which is marked no-return in
 * the database, and throws the shot's payout away as unreachable; the routine
 * is read from the disassembly of `0x004717A0`..`0x00471AA0` (`L35`).
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { ScoreAddForPlayer } from "../combat/score";
import { SpawnScaledPropSpark } from "../effects/sprite";
import { G } from "../globals";
import { GameMode } from "../game_mode";
import type { GameHost } from "../host";
import { MatIdentity, MatrixRotateY, MatrixTranslate } from "../matrix";
import { PlayerHoldsOriginalItem } from "../original_mode";
import { MsvcRand } from "./group";
import { ActorDespawnProp, BreakablePropAwardHit } from "./prop";
import { BreakableFlag, type BreakableProp } from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";

/** `obj+0x192` as `PropUpdateType77` reads it. */
export enum Type77Phase {
  /** Flying. */
  Flying = 0,
  /** Shot: stopped on its path, blinking, `obj+0x2A0` counting. */
  Shot = 1,
}

/** `PUSH 0x1F; CALL PlayerHoldsOriginalItem` — the item it wants held. */
export const TYPE77_ITEM = 0x1f;
/** `PUSH 0x195` — the `op_` path it rides. */
export const TYPE77_PATH = 0x195;
/** `FCOMP float ptr [0x005690D0]` — 400.0, the ride's end. */
export const TYPE77_RIDE_LENGTH = 400.0;
/** `FADD float ptr [0x004C4380]` — 1.0 a frame. */
export const TYPE77_RIDE_STEP = 1.0;
/** `ADD EAX, 0x400` — the spin on `obj+0x1DC`, BAMS a frame. */
export const TYPE77_SPIN = 0x400;
/** `CMP EAX, 0x3C; JLE` — the blink's last frame; the next despawns. */
export const TYPE77_BLINK_FRAMES = 0x3c;
/** `IDIV ECX` with `ECX = 3` — the first frame's roll. */
export const TYPE77_STAY_ODDS = 3;
/** `PUSH 0x40000000` x3 — the model is drawn at twice size. */
export const TYPE77_SCALE = 2.0;
/** `PUSH 0x10AB` — item 31's model. */
export const TYPE77_SLOT = 0x10ab;
/** `PUSH 0x40800000` — `SpawnScaledPropSpark`'s scale. */
export const TYPE77_SPARK_SCALE = 4.0;
/** `PUSH 0x7D0` — `ScoreAddForPlayer`'s points. */
export const TYPE77_SCORE = 2000;
/** `PlaySoundId(0x800A9)` — leaving, by the head or at the ride's end. */
export const SFX_TYPE77_LEAVE = 0x800a9;
/** `PlaySoundId(0x700A9)` — its first frame, when it stays. */
export const SFX_TYPE77_APPEAR = 0x700a9;
/** `PlaySoundId(0xB16A9)` — shot. */
export const SFX_TYPE77_SHOT = 0xb16a9;

const _m = MatIdentity();

/**
 * `PropUpdateType77` — `FUN_004717A0`. One prop, one 60 Hz frame.
 *
 * `+0x2C0` is {@link BreakableProp.shake} (the path cursor), `+0x2A0`
 * {@link BreakableProp.storyItem} (the blink), `+0x1DC`
 * {@link BreakableProp.yawSpin} (the spin) and `+0x192`
 * {@link BreakableProp.routinePhase}. `CamEvalObjectPath6` is the host's; the
 * draw is `render/prop_parts.ts`'s, from {@link BreakableProp.pathPose}.
 */
export function PropUpdateType77(p: BreakableProp, rng: Rng, events?: Events,
                                 host?: GameHost): void {
  if (G.g_GameMode !== GameMode.Original
      || !PlayerHoldsOriginalItem(TYPE77_ITEM)) {
    events?.emit("sound.play", { id: SFX_TYPE77_LEAVE });
    ActorDespawnProp(p);
    return;
  }
  // `FLD [ESI+0x2C0]; CALL __ftol; TEST EAX, EAX` -- the first frame, and any
  // frame the cursor has not yet left 0.
  if (Math.trunc(p.shake) === 0) {
    if (MsvcRand(rng) % TYPE77_STAY_ODDS === 0) {
      ActorDespawnProp(p);
      return;
    }
    events?.emit("sound.play", { id: SFX_TYPE77_APPEAR });
  }
  if (p.routinePhase === Type77Phase.Shot) {
    const n = p.storyItem;
    p.storyItem = n + 1;
    if (n > TYPE77_BLINK_FRAMES) {
      ActorDespawnProp(p);
      return;
    }
  }
  let shot = false;
  if ((p.flags & BreakableFlag.Hit) !== 0
      && p.routinePhase === Type77Phase.Flying) {
    p.flags &= ~BreakableFlag.Hit;
    events?.emit("sound.play", { id: SFX_TYPE77_SHOT });
    BreakablePropAwardHit(p.flags, false, rng);
    p.routinePhase = Type77Phase.Shot;
    shot = true;
  }

  // `CamEvalObjectPath6(0x195, obj+0x2C0, &local)` at the cursor as it was
  // before this frame's step.
  const at = host?.objectPath?.(TYPE77_PATH, p.shake) ?? null;
  if (p.storyItem === 0) p.shake += TYPE77_RIDE_STEP;
  // `FCOMP 400.0; TEST AH, 0x41; JNZ` -- on at or below 400.
  if (!(p.shake <= TYPE77_RIDE_LENGTH)) {
    events?.emit("sound.play", { id: SFX_TYPE77_LEAVE });
    ActorDespawnProp(p);
    return;
  }
  p.yawSpin += TYPE77_SPIN;

  // MSVC's `% 2` on the blink counter: the draw block runs on even frames,
  // which before the shot is every frame.
  if (p.storyItem % 2 === 0) {
    p.pathPose = at
      ? { slot: TYPE77_SLOT, x: at.x, y: at.y, z: at.z,
          pitch: 0, yaw: 0, roll: 0 }
      : null;
    // `T(pos) RotY(yaw) T(path)`, and `MatrixGetTranslation` of it: the
    // path's point turned by the placement's yaw and carried to its position.
    for (let i = 0; i < 16; i++) _m[i] = i % 5 === 0 ? 1 : 0;
    MatrixTranslate(_m, p.x, p.y, p.z);
    MatrixRotateY(_m, p.yaw);
    if (at) MatrixTranslate(_m, at.x, at.y, at.z);
    p.shotX = Math.fround(_m[12]);
    p.shotY = Math.fround(_m[13]);
    p.shotZ = Math.fround(_m[14]);
  } else {
    // [diverges] On an odd blink frame the draw block is skipped, and the
    // point the routine then registers is three stack locals
    // (`[ESP+0x8]`..`[ESP+0x10]` at `0x004719BC`) that only the draw block
    // writes -- whatever the previous task left at that depth of the stack.
    // The port has no such value and keeps the point the last draw computed.
    // The one input it reaches is a shot on the blinking prop, which the port
    // does resolve against this sphere; what that shot does -- stop there, or
    // go on to what is behind -- is all that depends on it, because the shot
    // arm is latched by then and the prop itself reacts to nothing. Pinned by
    // `port.test.ts`, "at the point the last draw computed".
    p.pathPose = null;
  }
  PropRegisterForShotTest(p, p.shotX, p.shotY, p.shotZ);

  if (shot) {
    // The routine writes the flown point over `obj+0x19C` for the two calls
    // below and puts its own position back straight after.
    const player = (p.flags & BreakableFlag.HitByPlayer0) !== 0 ? 0 : 1;
    if (p.hitAim) {
      // `SpawnScaledPropSpark` unprojects the aim at the prop's depth and
      // overwrites z with `obj+0x1A4` -- here the flown point's.
      SpawnScaledPropSpark(p.hitAim.x, p.hitAim.y, p.shotZ,
                           TYPE77_SPARK_SCALE);
    }
    ScoreAddForPlayer(player, TYPE77_SCORE, events);
  }
}
