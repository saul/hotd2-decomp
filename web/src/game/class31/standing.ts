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
import { G } from "../globals";
import { FtolS16 } from "../matrix";
import { ThrowerReleaseAttackPermit, ThrowerTryClaimAttackSlot }
  from "../combat/permits";
import type { GameHost } from "../host";
import {
  CharacterTypeOf, MotionOf, MotionPlayLength, SecondsToTicks, T,
} from "../tables";
import type { CharacterType } from "../../bundle";
import { VecToAngles, vec3 } from "../vec";
import { ActorPlayHitVoice, ActorVoice } from "../combat/voice";
import {
  ActorClipFrame, ActorClipLength, ActorPlayCursor, ActorPlayMotion,
} from "./arc";
import { ThrowerPickLandingPoint } from "./leap_down";
import { ThrowerMotion, ThrowerState } from "./states";
import { ThrowerStrikeConnect } from "./strike";
import {
  Class31SetOf, ThrowerMotionOf, ThrowerPickAttack, ThrowerThrowEntryOf,
} from "./tables";
import {
  ActorSetMotionBlended, ActorSetOneShotBlended, SetCurrentActorMotionBlended,
} from "../class30/motion_cue";
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
  obj.rootActionCursor = -1;
}

/**
 * `ThrowerStateCloseAndStrike` — `FUN_0044EA50`, class 0x31 state 24.
 *
 * `zskamere`'s standing swing: hold the entry's approach clip until the actor
 * is within the entry's own distance of a mark, then swing, cry out, and
 * connect on the entry's hit frame. `[proved]` from the listing, the whole
 * routine. The sub is a four-arm jump table (`0x0044EC68`: `0x0044EA86`,
 * `0x0044EB98`, `0x0044EC11`, `0x0044EC46`) behind `CMP EAX, 0x3 / JA` to the
 * `RET`, and each arm ends by bumping the sub and running on into the next:
 *
 * ```
 *           e = g_class31_throws[obj+0x130C] + (s8)obj+0x131A * 0x10
 * sub 0  0044ea93  obj+0x1360 = (s16)g_players_in_play
 *        0044ea9b  ThrowerPickLandingPoint(obj, obj+0x13E4)
 *        0044eac8  VecToAngles(obj+0x40 - eye.x, 0, obj+0x48 - eye.z,
 *                              &pitch, obj+0x68)
 *        0044eada  obj+0x131A = g_class31_attack_picks[obj+0x1F4 == 0x17
 *                                 ? 0 : obj+0x130C]
 *                               [(rand() >> 4) % 10 + (obj+0x1318 & 7) * 10]
 *        0044eb5f  obj+0x34 |= 0x10000000; obj+0x136C &= 0xFFFFFE1F
 *        0044eb86  obj+0x13D8..0x13E0 = obj+0x40..0x48; sub 1, and on
 * sub 1  0044ebba  if (hypot(obj+0x40 - obj+0x13E4, obj+0x48 - obj+0x13EC)
 *                      > e.distance) {                ; TEST AH, 0x41
 *                    if (obj+0x1B4 != e.lunge)
 *                      ActorSetMotionBlended(obj+0x194, e.lunge, 0, 5)
 *                    return }
 *        0044ebfa  ActorSetMotionBlended(obj+0x194, e.strike, 0, 5)
 *        0044ec02  ActorPlayHitVoice(obj, 3); sub 2, and on
 * sub 2  0044ec15  if (obj+0x19C == e.hit_frame) ThrowerStrikeConnect(obj)
 *        0044ec3b  if (obj+0x19C < g_motion_play_length[obj+0x1B4] - 1)
 *                    return
 *                  sub 3, and on
 * sub 3  0044ec49  state 0x19, sub 0; obj+0x34 &= ~0x10000000
 * ```
 *
 * It writes no velocity and no position, and the mark is
 * `ThrowerPickLandingPoint` taken **once**, in sub 0: a place on the screen,
 * captured from that frame's camera and never refreshed. For character type
 * 0x17 the attack index is drawn from **behaviour set 0's** picks while still
 * indexing the actor's own row, which is what gives `zskamere` (set 2 in all
 * fifteen shipped spawns) the entries 0, 1 and 3 here -- mask 8, which never
 * cancels -- and the limb-gated 4, 5 and 6 in state 32.
 *
 * What the port had wrong, and each was a line the routine does not have or
 * lacked one it does:
 *
 * * **The hit test is `==` every frame, behind no latch**: `MOVSX EAX, word
 *   ptr [EDI + 0x8]` / `CMP dword ptr [ESI + 0x19c], EAX` / `JNZ` at
 *   `0x0044EC11`. Both sides are the play cursor's unit -- the entry's frame
 *   is a `obj+0x19C` value, the same one `ThrowerStrikeConnect` compares
 *   again -- and the cursor gains one a tick, so the equality is met once per
 *   swing; the port tested `>=` behind `obj.struck`.
 * * **The cry**: `PUSH 0x3 / PUSH ESI / CALL 0x0040a6f0` at `0x0044EBFF`, on
 *   the frame the swing starts. The port swung in silence.
 * * **`obj+0x1360` takes the player count**, `MOVSX EDX, word ptr
 *   [0x009c8e80]` / `MOV dword ptr [ESI + 0x1360], EDX` at `0x0044EA86`. On a
 *   thrower that word is the arc phase, `arcPhase`, and
 *   its readers are `ActorArcStep`'s dispatch (`0x0044D86C`),
 *   `ThrowerStrikeConnect`'s melee arm (`CMP [ESI + 0x1360], 0x4` at
 *   `0x0044CEAC`) and `ThrowerStateLeapToPoint`'s (`0x0044E568`). None of them
 *   sees this value: state 24 is entered only from `0x0044B5BB`, one
 *   instruction after `ThrowerStateWaitForPermit` raises `obj+0x136C` bit
 *   `0x400`, so its connect takes the throw-table arm; and every
 *   `ActorArcStep` caller zeroes the phase before its first step --
 *   `ActorArcBeginToWaypoint` (`0x0044D7F0`, `0x0044D84B`),
 *   `ThrowerStateLeapToSurface` (`0x0044C239`, past a `PlaySoundId` Ghidra
 *   stops at), `ThrowerStateLeapToPoint` (`0x0044E558`),
 *   `ThrowerStateLeapStrike` (`0x0044E7B3`, `EBX` zeroed at `0x0044E6B9`) and
 *   `ThrowerStateDelayedPounce` (`0x0044E973`). A byte search for the
 *   displacement `60 13 00 00` finds no other access in class 0x31's range.
 *   The store is kept because the engine makes it.
 * * **No missing-entry exit.** The engine dereferences the row it names;
 *   the port sent a row the bundle omits straight to state 25 with
 *   `0x10000000` still up. See {@link ThrowerThrowEntryOf} for why the zero
 *   row is the one it reads, and why no shipped spawn reaches one here.
 * * **Both clips go through `ActorSetMotionBlended`**, fade 5, the lunge on
 *   the one track's motion and the swing on the one-shot channel that holds
 *   its start frame for the fade, as `ZombieStateStrike`'s does -- the port
 *   cut to the swing and set the lunge outright. The end test is
 *   `g_motion_play_length`, not the clip's authored length.
 */
export function ThrowerStateCloseAndStrike(obj: ThrowerActor,
                                           rng: Rng,
                                           host: GameHost,
                                           events?: Events): void {
  // `CMP EAX, 0x3 / JA 0x0044EC63` on the sign-extended sub.
  if (obj.sub < 0 || obj.sub > 3) return;
  if (obj.sub === 0) {
    obj.arcPhase = G.g_players_in_play;
    ThrowerPickLandingPoint(obj, host, _dest);
    obj.target = { x: _dest.x, y: _dest.y, z: _dest.z };
    // `VecToAngles(obj+0x40 - g_camera_eye_x, 0, obj+0x48 - g_camera_eye_z,
    // &pitch, &obj+0x68)` at `0x0044EAA3..EABC`: the yaw alone, turned to the
    // gameplay eye. **Not** `ActorFacePlayerTarget`, which the port called
    // here: that routine also stores the eye into `obj+0x13E4`, so the
    // landing point just written was overwritten with the eye and the range
    // test below measured to the camera rather than to the mark.
    obj.yaw = FtolS16(VecToAngles(obj.pos.x - G.g_camera_eye.x, 0,
                                  obj.pos.z - G.g_camera_eye.z).yaw);
    // `MOV EDX, dword ptr [0x00592a20]` at `0x0044EAF9` -- set 0's pointer by
    // address -- against `[EDX*0x4 + 0x592a20]` at `0x0044EB2F` for the rest.
    obj.attack = ThrowerPickAttack(obj, rng.int(10),
      obj.charType === CHAR_ZSKAMERE
        ? T.chars?.class31?.sets?.[0] ?? null : Class31SetOf(obj));
    // `8b5634` / `81ca00000010` / `895634` at `0x0044EB59`..`0x0044EB77`:
    // `obj+0x34 |= 0x10000000` -- mid-attack, as every class-0x31 strike has
    // it. It raised `BackingOff`, the next bit up, which on this class only
    // `ThrowerStateLeapAside` and `ThrowerStateWithdraw` write.
    obj.flags |= ActorFlag.Committed;
    obj.flags2 &= ~(ThrowerFlag.Surface | ThrowerFlag.OffGround);
    obj.strikeStart = { x: obj.pos.x, y: obj.pos.y, z: obj.pos.z };
    obj.sub = 1;
  }

  const e = ThrowerThrowEntryOf(obj, obj.attack);
  if (obj.sub === 1) {
    // `FCOMP [EDI + 0x4]` / `TEST AH, 0x41` / `JNZ` at `0x0044EBBA`: at or
    // inside the reach -- or unordered -- swings.
    const d = Math.hypot(obj.pos.x - obj.target.x, obj.pos.z - obj.target.z);
    if (d > e.distance) {
      // `CMP dword ptr [ESI + 0x1b4], EAX` at `0x0044EBC8`: against whatever
      // the one track is playing.
      if (ActorPlayMotion(obj) !== e.lunge) {
        ActorSetMotionBlended(obj, e.lunge, 0, MotionFade.Quick);
      }
      return;
    }
    ActorSetOneShotBlended(obj, e.strike, 0, MotionFade.Quick);
    ActorPlayHitVoice(obj, ActorVoice.Attack, rng,
                      (id) => events?.emit("sound.play", { id }));
    obj.sub = 2;
  }

  if (obj.sub === 2) {
    if (ActorPlayCursor(obj) === e.hit_frame) {
      ThrowerStrikeConnect(obj, events);
    }
    if (ActorPlayCursor(obj)
        < MotionPlayLength(obj, ActorPlayMotion(obj)) - 1) {
      return;
    }
    obj.sub = 3;
  }

  // `25ffffffef` at `0x0044EC52`, stored back to `obj+0x34` at `0x0044EC60`.
  obj.state = ThrowerState.Withdraw;
  obj.sub = 0;
  obj.flags &= ~ActorFlag.Committed;
}

/**
 * `ThrowerStateStrikeOnTheSpot` — `FUN_00450B20`, class 0x31 state 32.
 *
 * `zskamere` standing on surface `0x35` above you: it plays one clip, **pins
 * itself to where that clip ended**, and then swings for ever — claim, draw,
 * strike, pause two seconds, repeat. It never writes `obj+0x1310`, so nothing
 * but death takes it out. `[proved]` from the listing: a six-arm jump table
 * (`0x00450CD0`) behind `CMP EAX, 0x5 / JA` to the `RET`, arms falling into
 * each other as state 24's do:
 *
 * ```
 * sub 0  00450b4c  ActorSetMotionBlended(obj+0x194, 0x1B8, 0, 5); sub 1, on
 * sub 1  00450b70  if (obj+0x19C < g_motion_play_length[obj+0x1B4] - 1)
 *                    return
 *        00450b88  sub 2; obj+0x13D8..0x13E0 = obj+0x40..0x48, and on
 * sub 2  00450bac  obj+0x40..0x48 = obj+0x13D8..0x13E0
 *        00450bb8  if (obj+0x121 == 0xFF) ThrowerTryClaimAttackSlot(obj)
 *        00450bd2  obj+0x34 |= 0x10000000
 *        00450c0a  obj+0x131A = g_class31_attack_picks[obj+0x130C][...]
 *        00450c28  ActorSetMotionBlended(obj+0x194,
 *                    g_class31_throws[obj+0x130C][obj+0x131A].strike, 0, 5)
 *        00450c30  ActorPlayHitVoice(obj, 3); sub 3, and on
 * sub 3  00450c41  ThrowerStrikeConnect(obj)
 *        00450c5e  if (obj+0x19C < g_motion_play_length[obj+0x1B4] - 1)
 *                    return
 *                  sub 4, and on
 * sub 4  00450c6d  obj+0x34 &= ~0x10000000
 *        00450c75  ThrowerReleaseAttackPermit(obj)
 *        00450c96  ActorSetMotionBlended(obj+0x194,
 *                    g_class31_motion_sets[obj+0x130C][1], 0, 5)
 *        00450ca5  sub 5; obj+0x1330 = 0x78, and on
 * sub 5  00450cb5  if (--obj+0x1330 > 0) return; sub 2
 * ```
 *
 * The position is restored from the pin at the top of *every* cycle, not once,
 * which is what keeps a strike's own root motion from walking it off its perch.
 *
 * The port had no cry; released the permit only when it held one, where
 * `FUN_0044CFB0` drops the off-screen latch either way; dropped
 * `obj+0x136C` bit `0x800`, which no arm here writes; guarded the swing on
 * the bundle carrying its row; cut to each clip without the fade; and ended
 * each clip on its authored length rather than `g_motion_play_length`.
 */
export function ThrowerStateStrikeOnTheSpot(obj: ThrowerActor, dt: number,
                                            rng: Rng,
                                            host: GameHost,
                                            events?: Events): void {
  // `CMP EAX, 0x5 / JA 0x00450CCB` on the sign-extended sub.
  if (obj.sub < 0 || obj.sub > 5) return;
  if (obj.sub === 0) {
    ActorSetOneShotBlended(obj, PIN_CLIP, 0, MotionFade.Quick);
    obj.sub = 1;
  }

  if (obj.sub === 1) {
    if (ActorPlayCursor(obj)
        < MotionPlayLength(obj, ActorPlayMotion(obj)) - 1) {
      return;
    }
    obj.sub = 2;
    obj.strikeStart = { x: obj.pos.x, y: obj.pos.y, z: obj.pos.z };
  }

  if (obj.sub === 2) {
    obj.pos.x = obj.strikeStart.x;
    obj.pos.y = obj.strikeStart.y;
    obj.pos.z = obj.strikeStart.z;
    // The claim's answer is ignored: it swings whether or not it got one.
    if (obj.attackPermit < 0) ThrowerTryClaimAttackSlot(obj, rng, host);
    // `81c900000010` at `0x00450BD2` on `obj+0x34` (`8b4e34` / `894e34`):
    // bit `0x10000000`, not `BackingOff`.
    obj.flags |= ActorFlag.Committed;
    obj.attack = ThrowerPickAttack(obj, rng.int(10));
    ActorSetOneShotBlended(obj, ThrowerThrowEntryOf(obj, obj.attack).strike,
                           0, MotionFade.Quick);
    // `PUSH 0x3 / PUSH ESI / CALL 0x0040a6f0` at `0x00450C2D`.
    ActorPlayHitVoice(obj, ActorVoice.Attack, rng,
                      (id) => events?.emit("sound.play", { id }));
    obj.sub = 3;
  }

  if (obj.sub === 3) {
    ThrowerStrikeConnect(obj, events);
    if (ActorPlayCursor(obj)
        < MotionPlayLength(obj, ActorPlayMotion(obj)) - 1) {
      return;
    }
    obj.sub = 4;
  }

  if (obj.sub === 4) {
    // `25ffffffef` at `0x00450C6D`.
    obj.flags &= ~ActorFlag.Committed;
    ThrowerReleaseAttackPermit(obj);
    ActorSetMotionBlended(obj, ThrowerMotionOf(obj, ThrowerMotion.IdleAlt) ?? 0,
                          0, MotionFade.Quick);
    obj.sub = 5;
    obj.slideTimer = PIN_PAUSE_FRAMES;
  }

  obj.slideTimer -= SecondsToTicks(dt);
  if (obj.slideTimer > 0) return;
  obj.sub = 2;
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
 * rows 4 and 7 bit for bit, and `web/tools/checks/combat.ts` holds that.
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
