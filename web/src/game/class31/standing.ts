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
import { CharacterTypeOf, MotionOf, SecondsToTicks, T } from "../tables";
import type { CharacterType } from "../../bundle";
import { vec3, type Vec3 } from "../vec";
import { ActorClipFrame, ActorClipLength } from "./arc";
import { ThrowerPickLandingPoint } from "./leap_down";
import { ThrowerMotion, ThrowerState } from "./states";
import { ThrowerStrikeConnect } from "./strike";
import { Class31SetOf, ThrowerMotionOf, ThrowerPickAttack } from "./tables";
import { SetCurrentActorMotionBlended } from "../class30/motion_cue";
import { MotionFade } from "../class30/states";

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

function playOnce(obj: ThrowerActor, motion: number, from = 0): void {
  const m = MotionOf(obj, motion);
  if (!m) return;
  obj.action = { motion, ticks: from };
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
    if (obj.attackPermit < 0) ThrowerTryClaimAttackSlot(obj, rng, host);
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

/**
 * Put one hand's weapon back, give it back its hit sphere, and clear the arm
 * it counted as destroyed -- the four writes each restore state makes per
 * hand, in the engine's order:
 *
 * ```
 * if (rec+0x00 == bare) {
 *   rec+0x00 = armed
 *   rec+0x78 = row(bone - 1).radius          ; table[type] + 0x60 / + 0x9C
 *   rec+0x7C..+0x84 = row(bone - 1).centre   ; table[type] + 0x54 / + 0x90
 *   obj+0x1318 &= ~(1 << g_bone_damage_zone[bone])
 * }
 * ```
 *
 * The stores are `ThrowerStateRearm`'s at `0x0044F831`/`0x0044F891`, through
 * type 0x16's own pointer, and `ThrowerStateRestoreBothHands`' at
 * `0x0044F9F6`/`0x0044FA61`, through `obj+0x1F4`'s. `[proved]` The rows are
 * `g_character_part_tables[rows]`'s own, **unscaled and without the build's
 * slot test** -- which is how a `zsass`, whose build refused both rows, gets a
 * sphere on either hand at all. Bone 5 reads row 4 and bone 8 row 7, which is
 * the row the bundle hangs on the bone. `[port-only]` as a function: both
 * states inline it.
 */
function ThrowerRestoreHand(obj: ThrowerActor, host: GameHost,
                            h: { bone: number; bare: number; armed: number;
                                 zone: DamageZone },
                            rows: CharacterType | null): boolean {
  const k = String(h.bone);
  if (obj.boneSlot[k] !== h.bare) return false;
  host.setBoneSlot(obj.at, h.bone, h.armed);
  obj.boneSlot[k] = h.armed;
  const row = rows?.bones.find((b) => b.bone === h.bone);
  obj.boneRadius[k] = row?.hit_radius ?? 0;
  const c = row?.hit_centre;
  obj.boneCentre[k] = c ? [c[0], c[1], c[2]] : [0, 0, 0];
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
 *
 * **The sphere comes from type 0x16's table by name**, not the actor's:
 *
 * ```
 * 0044f822  MOV ECX, dword ptr [0x004d0384]     ; g_character_part_tables[0x16]
 * 0044f828  MOV EDX, dword ptr [ECX + 0x60]     ; row 4's radius
 * 0044f831  MOV dword ptr [ESI + 0x554], EDX    ; bone 5's record
 * 0044f880  MOV EAX, [0x004d0384]
 * 0044f885  MOV ECX, dword ptr [EAX + 0x9c]     ; row 7's radius
 * 0044f891  MOV dword ptr [ESI + 0x704], ECX    ; bone 8's
 * ```
 *
 * -- the same table, since only a type 0x16 gets this far. Ghidra's
 * pseudocode shows the four words of each as float **literals**, `0x3fe00000`
 * and the rest: `0x004D0384` is initialised data, and the decompiler folded
 * the load through it into the values it points at. They are the table's
 * rows 4 and 7 bit for bit, and `verify_combat.py` holds that.
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
    const rows = T.types[String(CHAR_ZSASS)] ?? null;
    for (const h of HANDS[CHAR_ZSASS]) ThrowerRestoreHand(obj, host, h, rows);
  }
  if (obj.action && ActorClipFrame(obj) < len - 1) return;
  obj.state = ThrowerState.StandAndDecide;
  obj.sub = 0;
}

/**
 * `ThrowerStateRestoreBothHands` — `FUN_0044F900`, class 0x31 state 30.
 *
 * Character type 0x18's version, and it is slower on purpose: the weapon
 * **grows back**, and this state does not grow it. Sub 0 raises
 * `ActorFlag.NoHitReaction` for the length of the state, blends to the
 * stance's idle over five frames if it is not already playing, zeroes the
 * accumulator and raises the latch — then runs on into sub 1, which waits on
 * the latch:
 *
 * ```
 * 0044f924  OR   AH, 0x20                             ; obj+0x34 |= 0x2000
 * 0044f98e  CALL 0x0044d230                          ; (model, idle, 0, 5)
 * 0044f99c  MOV  dword ptr [ESI + 0x1384], 0x0      c7868413000000000000
 * 0044f9a6  OR   ECX, 0x8000000                     81c900000008
 * 0044f9b9  TEST dword ptr [ESI + 0x136c], 0x8000000  f7866c13000000000008
 * ```
 *
 * `ThrowerDrawBonePart` (`FUN_00449F90`) is what advances `obj+0x1384` and
 * drops the latch, from the draw — see `class31/draw.ts` — so the wait is
 * measured in **regrowing nodes drawn**: 41 of them, one a frame for one bare
 * hand and two for two, and none on a frame the skeleton is not drawn. With
 * the latch down, sub 1 puts back each hand that is still bare — two
 * independent tests, `obj+0x4DC == 0x1FF1` at `0x0044F9C9` and
 * `obj+0x68C == 0x1FED` at `0x0044FA31` — and runs on into sub 2, which
 * leaves for state 7 on the clip's last frame and lowers `0x2000` on the way
 * out. `[proved]`
 *
 * This counted forty frames itself for as long as the port had no hook to
 * hang the growth on, and cut to the idle rather than blending into it; the
 * hook is ported now, and the growth is the draw's again. It had also run on
 * `ThrowerTail.hopFrames`, which is `obj+0x1344`,
 * `ThrowerStateBlinkInThreeHops`' hop dwell, before it ran on
 * {@link ThrowerTail.handRegrow}.
 */
export function ThrowerStateRestoreBothHands(obj: ThrowerActor, stance: number,
                                             host: GameHost): void {
  if (obj.sub === 0) {
    obj.flags |= ActorFlag.NoHitReaction;
    const m = RESTORE_IDLE_BY_STANCE[stance & 3] ?? RESTORE_IDLE_BY_STANCE[0];
    if (obj.motion !== m) {
      SetCurrentActorMotionBlended(obj, m, 0, MotionFade.Quick);
    }
    obj.thr.handRegrow = 0;
    obj.flags2 |= ThrowerFlag.Regrowing;
    obj.sub = 1;
  }

  if (obj.sub === 1) {
    if (obj.flags2 & ThrowerFlag.Regrowing) return;
    // `g_character_part_tables[obj+0x1F4]` -- the actor's own type's table
    // this time, `MOV ECX,[EAX*0x4 + 0x4d032c]` at `0x0044F9E6` and
    // `0x0044FA4E`, rows 4 and 7.
    const rows = CharacterTypeOf(obj);
    for (const h of HANDS[CHAR_ZSLMAN] ?? []) {
      ThrowerRestoreHand(obj, host, h, rows);
    }
    obj.sub = 2;
  }

  const len = ActorClipLength(obj, obj.motion);
  // `obj+0x19C` against the clip length, both in cursor ticks. This read
  // `obj.clock * 60` when the clock was seconds -- the same number by a
  // conversion that no longer has to happen.
  if (obj.playTicks < len - 1) return;
  obj.state = ThrowerState.StandAndDecide;
  obj.sub = 0;
  obj.flags &= ~ActorFlag.NoHitReaction;
}

/** Whether this character has hands the two restore states know about. */
export function ThrowerHasHands(obj: ThrowerActor): boolean {
  return HANDS[CharacterTypeOf(obj)?.type ?? -1] !== undefined;
}
