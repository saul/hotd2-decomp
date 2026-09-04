/**
 * `zskamere`'s two attacks, and putting a weapon back.
 *
 * States 24 and 32 are the other half of `ThrowerStateWaitForPermit`: where
 * `zstin` and `zsass` go to the pounce, character type 0x17 splits two ways —
 * onto the spot if it is standing on surface `0x35` more than fifteen units
 * above the camera, and into a standing strike otherwise. State 8 raises
 * `obj+0x136C` bit `0x400` on the way in, which is what makes both of them
 * resolve against `g_class31_throws` rather than the melee table.
 *
 * States 29 and 30 put a thrown weapon back in a hand, and they are **the
 * other half of the throw**. No pick band names them, which once read as "no
 * shipped data can reach them" — it is wrong. `ThrowerStateStandAndDecide`
 * (`FUN_0044B180`) offers 0x1D, or 0x1E for character type 0x18, to
 * `ThrowerTryEnterState` on every one of its frames and only asks
 * `ThrowerPickNextState` if that is refused — `PUSH 0x1d / CALL 0x0044afb0`
 * (`6a1d e834fcffff`) at 0x0044B375 against `PUSH 0x1e / CALL 0x0044afb0`
 * (`6a1e e819fcffff`) at 0x0044B390, both jumping past the
 * `CALL 0x0044adb0` at 0x0044B3AA on a 1. The
 * gate passes when `ThrowerHasBareHand` (`FUN_0044F720`) says an arm is empty
 * and the actor is in state 7. `ThrowerStateThrow` (`FUN_0044FAF0`) ends by
 * writing state 7, so every throw runs straight into one of these two on the
 * next frame. `[proved]`
 */
import type { Rng } from "../../core/rng";
import type { Events } from "../../core/events";
import { ActorFlag, DamageZone, ThrowerFlag, type ThrowerActor }
  from "../actor";
import { ActorFacePlayerTarget } from "../actor_turn";
import { ThrowerReleaseAttackPermit, ThrowerTryClaimAttackSlot }
  from "../combat/permits";
import type { GameHost } from "../host";
import { CharacterTypeOf, MotionOf, SecondsToTicks } from "../tables";
import { vec3, type Vec3 } from "../vec";
import { ActorClipFrame, ActorClipLength } from "./arc";
import { ThrowerPickLandingPoint } from "./leap_down";
import { ThrowerMotion, ThrowerState } from "./states";
import { ThrowerStrikeConnect } from "./strike";
import { Class31SetOf, ThrowerMotionOf, ThrowerPickAttack } from "./tables";

const _dest = vec3();

const CHAR_ZSASS = 0x16;
const CHAR_ZSKAMERE = 0x17;
const CHAR_ZSLMAN = 0x18;

/** `ThrowerStateStrikeOnTheSpot`'s opening clip, and its pause. */
const PIN_CLIP = 0x1b8;
const PIN_PAUSE_FRAMES = 0x78;
/** `ThrowerStateRearm`'s clip — motion id 5, a literal, not a set entry. */
const REARM_CLIP = 5;

/** Which hand slots each character type swaps between bare and armed. */
const HANDS: Record<number, { bone: number; bare: number; armed: number;
                              zone: DamageZone }[]> = {
  [CHAR_ZSASS]: [
    { bone: 5, bare: 0x1f9f, armed: 0x1fa2, zone: DamageZone.RightArm },
    { bone: 8, bare: 0x1f9b, armed: 0x1f9e, zone: DamageZone.LeftArm },
  ],
  [CHAR_ZSLMAN]: [
    { bone: 5, bare: 0x1ff1, armed: 0x1ff3, zone: DamageZone.RightArm },
    { bone: 8, bare: 0x1fed, armed: 0x1fef, zone: DamageZone.LeftArm },
  ],
};

/** The stance idle `ThrowerStateRestoreBothHands` holds while it regrows. */
const RESTORE_IDLE_BY_STANCE = [0x208, 0x1fd, 0x1f3, 0x205];
/**
 * The weapon grows back at this a **drawn** frame, so forty frames in all.
 *
 * `[0x004C4CB0]` = `cdcccc3c` = 0.025f, the `FADD` in `ThrowerDrawBonePart`
 * (`FUN_00449F90`) at 0x0044A150; the clamp it is compared against,
 * `[0x004C4380]` = `0000803f`, is 1.0f.
 */
const REGROW_PER_FRAME = 0.025;
/** ...and the value {@link ThrowerTail.handRegrow} is done at. */
const REGROW_FULL = 1.0;

function playOnce(obj: ThrowerActor, motion: number, from = 0): void {
  const m = MotionOf(obj, motion);
  if (!m) return;
  obj.action = { motion, ticks: from, loop: false };
  obj.rootActionFrame = -1;
}

/** One entry of `g_class31_throws`, which both standing attacks read. */
function ThrowerStrikeEntry(obj: ThrowerActor, index: number) {
  return Class31SetOf(obj)?.strikes?.[String(index)] ?? null;
}

/**
 * `ThrowerStateCloseAndStrike` — `FUN_0044EA50`, class 0x31 state 24.
 *
 * The standing melee: hold the entry's approach clip until the actor is within
 * the entry's own distance of a target point, then swing and connect on the
 * entry's hit frame.
 *
 * Two things about it are counter-intuitive and both are `[proved]`. **It does
 * not move** — no velocity, no arc, no root motion — so the range test's
 * answer is fixed at the moment of entry unless something else carries the
 * actor, which is `[open]`. And the target point is `ThrowerPickLandingPoint`
 * frozen **once**, in sub 0: a place on the screen, captured from that frame's
 * camera and never refreshed.
 *
 * The one genuine subtlety: for character type 0x17 the attack index is drawn
 * from **behaviour set 0's** pick table while still indexing set 2's strike
 * row, which is what gives `zskamere` the always-connect entries 0, 1 and 3
 * here and the limb-gated 4, 5 and 6 in state 32.
 */
export function ThrowerStateCloseAndStrike(obj: ThrowerActor, eye: Vec3,
                                           rng: Rng,
                                           host: GameHost,
                                           events?: Events): void {
  if (obj.sub === 0) {
    ThrowerPickLandingPoint(obj, host, _dest);
    obj.target = { x: _dest.x, y: _dest.y, z: _dest.z };
    ActorFacePlayerTarget(obj, eye);
    // The 0x17 override: set 0's picks, set 2's entries.
    obj.attack = obj.charType === CHAR_ZSKAMERE
      ? ThrowerPickAttackFromSet0(obj, rng.int(10))
      : ThrowerPickAttack(obj, rng.int(10));
    obj.flags |= ActorFlag.BackingOff;
    obj.flags2 &= ~(ThrowerFlag.Surface | ThrowerFlag.OffGround);
    obj.strikeStart = { x: obj.pos.x, y: obj.pos.y, z: obj.pos.z };
    obj.struck = false;
    obj.sub = 1;
  }

  const e = ThrowerStrikeEntry(obj, obj.attack);
  if (!e) { obj.state = ThrowerState.Withdraw; obj.sub = 0; return; }

  if (obj.sub === 1) {
    const d = Math.hypot(obj.pos.x - obj.target.x, obj.pos.z - obj.target.z);
    if (d > e.distance) {
      if (obj.motion !== e.lunge && MotionOf(obj, e.lunge)) {
        obj.motion = e.lunge;
        obj.playTicks = 0;
        obj.rootFrame = -1;
      }
      return;
    }
    playOnce(obj, e.strike);
    obj.sub = 2;
  }

  if (obj.sub === 2) {
    if (!obj.struck && ActorClipFrame(obj) >= e.hit_frame) {
      obj.struck = true;
      ThrowerStrikeConnect(obj, events);
    }
    const len = ActorClipLength(obj, obj.action?.motion ?? e.strike);
    if (obj.action && ActorClipFrame(obj) < len - 1) return;
    obj.sub = 3;
  }

  obj.flags &= ~ActorFlag.BackingOff;
  obj.state = ThrowerState.Withdraw;
  obj.sub = 0;
}

/** The 0x17 override: draw from behaviour set 0's pick table. */
function ThrowerPickAttackFromSet0(obj: ThrowerActor, roll: number): number {
  const picks = Class31SetOf({ ...obj, condition: 0 })?.attack_picks ?? [];
  if (!picks.length) return ThrowerPickAttack(obj, roll);
  return picks[(roll % 10) + (obj.zones & 7) * 10] ?? 0;
}

/**
 * `ThrowerStateStrikeOnTheSpot` — `FUN_00450B20`, class 0x31 state 32.
 *
 * `zskamere` standing on surface `0x35` above you: it plays one clip, **pins
 * itself to where that clip ended**, and then swings for ever — claim, draw,
 * strike, pause two seconds, repeat. It never writes `obj+0x1310`, so nothing
 * but death takes it out.
 *
 * The position is restored from the pin at the top of *every* cycle, not once,
 * which is what keeps a strike's own root motion from walking it off its perch.
 */
export function ThrowerStateStrikeOnTheSpot(obj: ThrowerActor, dt: number,
                                            rng: Rng,
                                            host: GameHost,
                                            events?: Events): void {
  if (obj.sub === 0) {
    playOnce(obj, PIN_CLIP);
    obj.sub = 1;
  }

  if (obj.sub === 1) {
    const len = ActorClipLength(obj, obj.action?.motion ?? PIN_CLIP);
    if (obj.action && ActorClipFrame(obj) < len - 1) return;
    obj.strikeStart = { x: obj.pos.x, y: obj.pos.y, z: obj.pos.z };
    obj.sub = 2;
  }

  if (obj.sub === 2) {
    obj.pos.x = obj.strikeStart.x;
    obj.pos.y = obj.strikeStart.y;
    obj.pos.z = obj.strikeStart.z;
    // The claim's answer is ignored: it swings whether or not it got one.
    if (obj.attackPermit < 0) ThrowerTryClaimAttackSlot(obj, host);
    obj.flags |= ActorFlag.BackingOff;
    obj.attack = ThrowerPickAttack(obj, rng.int(10));
    const e = ThrowerStrikeEntry(obj, obj.attack);
    if (e) playOnce(obj, e.strike);
    obj.struck = false;
    obj.sub = 3;
  }

  if (obj.sub === 3) {
    ThrowerStrikeConnect(obj, events);
    const len = ActorClipLength(obj, obj.action?.motion ?? 0);
    if (obj.action && ActorClipFrame(obj) < len - 1) return;
    obj.sub = 4;
  }

  if (obj.sub === 4) {
    obj.flags &= ~ActorFlag.BackingOff;
    if (obj.attackPermit >= 0) ThrowerReleaseAttackPermit(obj);
    const idle = ThrowerMotionOf(obj, ThrowerMotion.IdleAlt);
    if (idle !== undefined) playOnce(obj, idle);
    obj.slideTimer = PIN_PAUSE_FRAMES;
    obj.flags2 &= ~ThrowerFlag.Struck;
    obj.sub = 5;
  }

  obj.slideTimer -= SecondsToTicks(dt);
  if (obj.slideTimer < 1) obj.sub = 2;
}

/** Put one hand's weapon back and clear the arm it counted as destroyed. */
function ThrowerRestoreHand(obj: ThrowerActor, host: GameHost,
                            h: { bone: number; bare: number; armed: number;
                                 zone: DamageZone }): boolean {
  if (obj.boneSlot[String(h.bone)] !== h.bare) return false;
  host.setBoneSlot(obj.at, h.bone, h.armed);
  obj.boneSlot[String(h.bone)] = h.armed;
  obj.zones &= ~h.zone;
  return true;
}

/**
 * `ThrowerStateRearm` — `FUN_0044F7A0`, class 0x31 state 29.
 *
 * Character type 0x16's only, and it restores **both** hands independently
 * rather than picking one: two sequential tests, so a `zsass` that has thrown
 * twice gets both weapons back on the same frame. Motion id 5 is a literal,
 * not a motion-set entry, and the swap lands on the clip's exact midpoint.
 *
 * The earlier note on this routine said it "puts the weapon back in whichever
 * hand is bare", which read as a choice. It is not one.
 */
export function ThrowerStateRearm(obj: ThrowerActor, host: GameHost): void {
  if (obj.charType !== CHAR_ZSASS) {
    obj.state = ThrowerState.StandAndDecide;
    obj.sub = 0;
    return;
  }
  if (obj.sub === 0) {
    playOnce(obj, REARM_CLIP);
    obj.struck = false;
    obj.sub = 1;
  }
  const len = ActorClipLength(obj, obj.action?.motion ?? REARM_CLIP);
  if (!obj.struck && ActorClipFrame(obj) >= Math.trunc(len / 2)) {
    obj.struck = true;
    for (const h of HANDS[CHAR_ZSASS]) ThrowerRestoreHand(obj, host, h);
  }
  if (obj.action && ActorClipFrame(obj) < len - 1) return;
  obj.state = ThrowerState.StandAndDecide;
  obj.sub = 0;
}

/**
 * `ThrowerStateRestoreBothHands` — `FUN_0044F900`, class 0x31 state 30.
 *
 * Character type 0x18's version, and it is slower on purpose: the weapon
 * **grows back**. The state itself only zeroes the accumulator and raises the
 * latch, then waits on it:
 *
 * ```
 * 0044f99c  MOV  dword ptr [ESI + 0x1384], 0x0      c7868413000000000000
 * 0044f9a6  OR   ECX, 0x8000000                     81c900000008
 * 0044f9b9  TEST dword ptr [ESI + 0x136c], 0x8000000  f7866c13000000000008
 * ```
 *
 * `ThrowerDrawBonePart` (`FUN_00449F90`) is what advances `obj+0x1384` by
 * 0.025 a *drawn* frame and clears the latch at 1.0, so the wait is forty
 * frames of being on screen — a thrower that is not being drawn does not
 * re-arm.
 *
 * [diverges] The port has no per-bone draw hook to hang the growth on, so the
 * forty frames are counted here and `Actor.alpha` is not involved. The
 * accumulator and the latch are the engine's own —
 * {@link ThrowerTail.handRegrow} (`obj+0x1384`) and
 * {@link ThrowerFlag.Regrowing}. This used to run on
 * `ThrowerTail.hopFrames`, which is `obj+0x1344`,
 * `ThrowerStateBlinkInThreeHops`' hop dwell: states 30 and 34 cannot run at
 * once so it never bit, but it was the wrong field.
 */
export function ThrowerStateRestoreBothHands(obj: ThrowerActor, dt: number,
                                             stance: number,
                                             host: GameHost): void {
  if (obj.sub === 0) {
    const m = RESTORE_IDLE_BY_STANCE[stance & 3] ?? RESTORE_IDLE_BY_STANCE[0];
    if (obj.motion !== m && MotionOf(obj, m)) {
      obj.motion = m;
      obj.playTicks = 0;
      obj.rootFrame = -1;
    }
    obj.thr.handRegrow = 0;
    obj.flags2 |= ThrowerFlag.Regrowing;
    obj.sub = 1;
  }

  if (obj.sub === 1) {
    obj.thr.handRegrow += REGROW_PER_FRAME * SecondsToTicks(dt);
    if (obj.thr.handRegrow < REGROW_FULL) return;
    // `ThrowerDrawBonePart` pins it at exactly 1.0 and drops the latch.
    obj.thr.handRegrow = REGROW_FULL;
    obj.flags2 &= ~ThrowerFlag.Regrowing;
    for (const h of HANDS[CHAR_ZSLMAN] ?? []) ThrowerRestoreHand(obj, host, h);
    obj.sub = 2;
  }

  const len = ActorClipLength(obj, obj.motion);
  // `obj+0x19C` against the clip length, both in cursor ticks. This read
  // `obj.clock * 60` when the clock was seconds -- the same number by a
  // conversion that no longer has to happen.
  if (obj.playTicks < len - 1) return;
  obj.state = ThrowerState.StandAndDecide;
  obj.sub = 0;
}

/** Whether this character has hands the two restore states know about. */
export function ThrowerHasHands(obj: ThrowerActor): boolean {
  return HANDS[CharacterTypeOf(obj)?.type ?? -1] !== undefined;
}
