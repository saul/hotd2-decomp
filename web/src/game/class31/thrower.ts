/**
 * Class 0x31 — the wall-crawler and the thrower.
 *
 * Four character types share one 36-state machine and four **behaviour sets**,
 * and which set a spawn gets is a byte in its own descriptor. `zsass` (set 1)
 * stands out of reach and throws; `zstin` (set 0) is the one that moves —
 * it walks in, circles onto the walls and the ceiling at middle range, and
 * when you let it inside thirty units it waits for the attack permit and
 * **arcs onto you with a knife**, connecting on a frame of the leap clip
 * rather than on any range test, then leaps back out to one side.
 *
 * The shape worth holding on to is that none of that is written as behaviour.
 * `ThrowerPickNextState` turns one distance into a band, draws a state id out
 * of a table, and `ThrowerTryEnterState` says yes or no. The repertoire is
 * data; the code is a gate.
 */
import type { Events } from "../../core/events";
import { CountEnemyThrowerIn } from "../combat/counts";
import type { Rng } from "../../core/rng";
import type { ThrowHandJson } from "../../bundle";
import {
  ActorFlag, DamageZone, MotionFlag, ThrowerFlag, ThrowerStance,
  type ThrowerActor,
} from "../actor";
import {
  DeadSweep, registerClass, type ActorDebug, type ClassFrame,
  type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";
import { ActorRegisterCameraPoint } from "../camera/track";
import { RegisterEnemySlot } from "../camera/slots";
import {
  AttackClaimRefusal, ThrowerReleaseAttackPermit, ThrowerTryClaimAttackSlot,
} from "../combat/permits";
import {
  ThrowerRetireFromAliveCount, ThrowerRetireFromPresentCount,
} from "../combat/counts";
import { G } from "../globals";
import type { GameHost } from "../host";
import { CharacterTypeOf, MotionPlayLength, ThrowHandsOf }
  from "../tables";
import { ActorSetMotionBlended } from "../class30/motion_cue";
import { GAME_HZ } from "../class30/states";
import { ThrowerStateLeapToPoint } from "./leap";
import {
  ThrowerStateDelayedPounce, ThrowerStateEntranceClip, ThrowerStateWalkDistance,
} from "./entrance";
import { ThrowerStatePathFollow } from "./path";
import {
  ThrowerStateLeapAside, ThrowerStateLeapDown, ThrowerStateWithdraw,
} from "./pounce";
import {
  ThrowerStateStandAndDecide, ThrowerStateWaitForPermit,
} from "./stand";
import { ThrowerStateLeapToSurface } from "./surface";
import { ThrowerPushOutOfWorld } from "./collide";
import { ActorRunNodeDrawHooks } from "../model_draw";
import { ThrowerDrawBonePart } from "./draw";
import { HeadAimBeginDraw, HeadAimEndDraw, HeadAimSeed }
  from "../class30/head_aim";
import { ThrowerOnShot } from "./on_shot";
import {
  ThrowerStateCorpseBlink, ThrowerStateCorpseSink, ThrowerStateDeathClip,
  ThrowerStateFallAndLand, ThrowerStateFallToSurface, ThrowerLeave,
} from "./death";
import {
  ThrowerStateGetUp, ThrowerStateHitReaction, ThrowerStateKnockedTumbling,
} from "./react";
import {
  ThrowerStateCloseAndStrike, ThrowerStateRearm, ThrowerStateRestoreBothHands,
  ThrowerStateStrikeOnTheSpot,
} from "./standing";
import {
  ThrowerStateBlinkInThreeHops, ThrowerStateGrabPlayer, ThrowerStateLeapStrike,
  ThrowerStateRideObjectPath, ThrowerStateWaitForCue,
} from "./scripted";
import { ThrowerStanceOf } from "./tables";
import { ThrowerState, ThrowSub } from "./states";
import {
  AimThrownWeapon, FlySub, ThrownWeaponState, THROWN_WEAPON_SPIN,
  THROWN_WEAPON_AFTERIMAGE_PERIOD,
} from "./projectile";
import {
  ThrownWeaponAlloc, ThrownWeaponCameraOf, ThrownWeaponRoutine,
  THROWN_WEAPON_DRAW_FLAGS, THROWN_WEAPON_HIT_RADIUS, THROWN_WEAPON_SPAWN_FLAGS,
} from "../thrown_weapon";

/**
 * How high the hand is above the actor's own origin, for the fallback in
 * {@link SpawnThrownWeapon}. The same four units `ZombieThrowHandWeapon` uses.
 */
const HAND_HEIGHT = 4;

/**
 * Hands that still hold a weapon — the port's reading of the engine's draw-slot
 * test, which is what {@link ThrowerPickThrowingHand} chooses between.
 */
function usableHands(obj: ThrowerActor): ThrowHandJson[] {
  return ThrowHandsOf(obj)
    .filter((h) => (obj.zones & DamageZone.All & h.cancel_mask) !== h.cancel_mask);
}

/** The two bones a weapon hangs off, and which throw entry each indexes. */
const RIGHT_HAND_BONE = 5;
const LEFT_HAND_BONE = 8;

/**
 * The cross-fade `ThrowerStateThrow` starts its clip over, and the cursor it
 * starts it at for every character type but 0x18. See {@link ThrowerThrowCue}.
 */
const THROW_FADE = 4;
const THROW_START_CURSOR = 0x1a;

/**
 * `PlaySoundId(0x2916A9)` — `COMMON\ENE_WALK6_22.WAV`, the same id state 27's
 * landing plays. `ThrowerStateThrow` fires it on the throw clip's last frame,
 * one frame before it hands back to the hub.
 */
const SFX_THROW_DONE = 0x2916a9;

/** Character type 0x18 — `zslman`. It has its own clip for everything. */
const CHAR_ZSLMAN = 0x18;
/** Character type 0x17 — `zskamere`. `CMP CX, 0x17` at `0x004497EC`. */
const CHAR_ZSKAMERE = 0x17;

/**
 * `ThrowerPickThrowingHand` — `FUN_0044F630`. Which bone throws this time.
 *
 * A coin decides which hand is **preferred**, not which one throws: the other
 * is taken whenever the preferred one is already bare, and 0 comes back only
 * when both are. Parity 0 prefers bone 5 and parity 1 bone 8, and the two arms
 * are otherwise the same three tests in the opposite order.
 * `ThrowerStateThrow` turns the bone into the throw entry's index with
 * `CMP EAX, 0x5` / `SETNZ DL` (`83f805` / `0f95c2` at 0x0044FB51), so bone 5
 * is entry 0 and everything else — including the 0 that means *neither* — is
 * entry 1.
 *
 * Character types 0x17 and 0x19 carry no weapon and always get 0, which is the
 * same thing `ThrowerBothHandsArmed` (`FUN_0044F5D0`) says at the gate.
 *
 * The engine reads each hand's **draw slot** — `obj+0x4DC` against `0x1FA2`
 * and `obj+0x68C` against `0x1F9E` for character type 0x16, `0x1FF3` and
 * `0x1FEF` for 0x18, which are the `held` ids the bundle carries — where the
 * port reads the destroyed-zone mask, for the reason
 * `ThrowerHasBareHand` (`FUN_0044F720`) states in `router.ts`.
 */
export function ThrowerPickThrowingHand(obj: ThrowerActor, rng: Rng): number {
  if (obj.charType !== CHAR_ZSASS && obj.charType !== CHAR_ZSLMAN) return 0;
  const armed = usableHands(obj);
  if (!armed.length) return 0;
  const want = rng.int(2) === 0 ? RIGHT_HAND_BONE : LEFT_HAND_BONE;
  return armed.some((h) => h.bone === want) ? want : armed[0].bone;
}

/**
 * `ThrowerStateThrow`'s throw clips for character type 0x18, by hand and by
 * stance — and **the throw entry it does not read**.
 *
 * Type 0x18 is diverted out of the shared path *twice*, by two copies of the
 * same compare, and the second one is the one that was missed:
 *
 * * `CMP word ptr [ESI+0x1f4], 0x18` (`6683bef401000018`) at **0x0044FB7A**
 *   picks the **clip**. Every other type takes it from the throw entry's
 *   `+0x00` (`MOVSX EDX, word ptr [EDI]` — `0fbf17` at 0x0044FB84); type 0x18
 *   jumps to 0x0044FB98 and takes it from the switch below instead.
 * * `CMP word ptr [ESI+0x1f4], 0x18` again at **0x0044FC83** picks the
 *   **release frame**, as {@link ThrowerThrowCue} describes.
 *
 * So for `zslman` the exported entry's `motion` *and* its `release_frame` are
 * both dead. The bundle gives it `motion: 9 / 8` and `release_frame: 48`; the
 * engine plays 0x1F7 / 0x1F6 and releases on 25. The port used to read both
 * from the entry, which made it play the wrong clip and then let go 23 frames
 * into the wrong clip. Saying only "23 frames late" understates it. `[proved]`
 *
 * **The index.** `handIdx + 10*stance`, where `handIdx` is `obj+0x131A` — 0
 * for bone 5, 1 for bone 8, from `ThrowerPickThrowingHand` (`0x0044F630`) —
 * and `stance` is `3*bit8 + 2*bit7 + bit6` of `obj+0x136C`
 * (`8b866c130000` at 0x0044FB98, then the shifts and `LEA`s to 0x0044FBBB).
 * That index runs into a 32-byte table of jump-table selectors at
 * `0x0044FD1C` (`MOV CL, byte ptr [EAX + 0x44fd1c]` — `8a881cfd4400` at
 * 0x0044FBCF), bounded by `CMP EAX, 0x1f` / `JA` (`83f81f`, `0f8797000000`)
 * at 0x0044FBC4, and out through the nine-entry jump table at `0x0044FCF8`
 * (`ff248df8fc4400`).
 *
 * **It is `.text`, not a table, which is why it is here and not in the
 * bundle.** `.rdata` starts at 0x004C4000; 0x0044FD1C sits inside
 * `ThrowerStateThrow`'s own body, has exactly one xref in the program — the
 * `MOV CL` above — and its nine jump targets are all addresses inside this
 * one function. It is a compiler-emitted dense switch, and the clip ids are
 * `MOV` immediates in its arms (`b8f7010000` = `MOV EAX, 0x1F7`). Under the
 * `.rdata` travels, `.text` does not rule in `docs/formats/bundle.md` that
 * puts it here, beside `stand.ts`'s `WAIT_BY_STANCE_ZSLMAN`, which is the
 * same shape read out of the neighbouring state.
 *
 * **24 of those 32 bytes are unreachable padding, not data.** `handIdx` is 0
 * or 1 and `stance` is 0..3, so the only indices that can occur are 0, 1, 10,
 * 11, 20, 21, 30 and 31 — the eight below. The other 24 bytes all hold `0x08`,
 * the selector for the default arm, because a dense switch has to be dense.
 * Reading the raw table as an eight-by-four grid of clips would be reading the
 * compiler's padding as the game's data.
 */
const THROW_BY_STANCE_ZSLMAN = [
  // handIdx 0 — bone 5, the right hand. Ground, WallA, WallB, Ceiling.
  [0x1f7, 0x1fc, 0x1f2, 0x204],
  // handIdx 1 — bone 8, the left.
  [0x1f6, 0x1fb, 0x1f1, 0x203],
];

/**
 * The frame type 0x18 lets go on: `0x19` = 25, written to `obj+0x1350` by
 * **all eight** arms of the switch above, the same ten bytes each time
 * (`c7865013000019000000`, at 0x0044FBE1, FBF2, FC03, FC14, FC25, FC36, FC47
 * and FC58). It is uniform across every arm, which is why the release frame
 * does not depend on which clip was picked.
 */
const ZSLMAN_RELEASE_FRAME = 0x19;

/**
 * The clip a throw plays and the frame the weapon leaves the hand — one
 * routine because `ThrowerStateThrow` decides both on the character type, and
 * splitting them is how the port came to play one type's clip against another
 * type's frame.
 *
 * The release frame in the exe is `obj+0x1350` — the **same word** as
 * {@link ThrowerTail.landSurface}, which states 2 and 33 use for the surface
 * under
 * the body. The switch writes the constant `0x19` into it and the compare at
 * 0x0044FC9B..0x0044FCA7 reads it back (`8b8e9c010000` / `8b8650130000` /
 * `3bc8`): one address, two readings, both inside class 0x31, and no `cls`
 * test can tell them apart. The port keeps only the surface reading in the
 * field and returns the frame from here, so the two are never confused at a
 * use site; see the note on {@link ThrowerTail.landSurface}.
 *
 * Every other character type compares `obj+0x19C` against the throw entry's
 * own `+0x08` at 0x0044FC8D (`0fbf4708` then `39869c010000`). `[proved]`
 *
 * **And the clip does not start at frame zero.** `ActorSetMotionBlended`
 * (`FUN_004119A0`) is called with a start **cursor**, not an authored frame —
 * `param_1[2] = param_3; param_1[6] = param_3 / 2` writes `obj+0x19C` and its
 * half at `obj+0x1AC` — and this state passes `0x1A` for every character type
 * but 0x18, which passes 0. `[proved]`: `PUSH 0x4 / PUSH 0x1a` (`6a04 6a1a`)
 * at 0x0044FB87 against `PUSH 0x4 / PUSH 0x0` (`6a04 6a00`) at 0x0044FC68,
 * both falling into the one `CALL 0x004119a0` at 0x0044FC74. So a `zsass`
 * throw is 22 cursor ticks of wind-up against its entry's release frame of 48,
 * not 48.
 *
 * `[open]` — **the default arm.** The exe's stance is `3*bit8 + 2*bit7 + bit6`,
 * a sum, not a selector: if two surface bits were ever set at once it exceeds
 * 3, the index leaves the table's range, and the switch takes its default —
 * which plays **the actor pointer itself** as a motion id (`MOV EAX, dword
 * ptr [ESP + 0xc]` at 0x0044FC64, which after `PUSH ESI` / `PUSH EDI` is the
 * routine's one and only argument; Ghidra renders it `iVar3 = param_1`) and
 * **does not write `obj+0x1350` at all**, so the compare would read a landing
 * surface as a frame number. The port's {@link ThrowerStanceOf} `& 3` cannot
 * produce that, so the two formulas agree exactly while the bits stay
 * exclusive and diverge if they ever do not. Whether the engine can set two at
 * once is undetermined; the fallback below is what the port does if the table
 * is ever indexed outside itself.
 */
function ThrowerThrowCue(obj: ThrowerActor, hand: ThrowHandJson):
    { motion: number; release: number; start: number } {
  if (obj.charType !== CHAR_ZSLMAN) {
    return { motion: hand.motion, release: hand.release_frame,
             start: THROW_START_CURSOR };
  }
  const handIdx = hand.bone === RIGHT_HAND_BONE ? 0 : 1;
  const motion = THROW_BY_STANCE_ZSLMAN[handIdx]?.[ThrowerStanceOf(obj) & 3];
  // The default arm, which the port cannot reach — see above. It leaves
  // `obj+0x1350` alone, so the entry's own frame is the nearest thing to it.
  if (motion === undefined) {
    return { motion: hand.motion, release: hand.release_frame, start: 0 };
  }
  return { motion, release: ZSLMAN_RELEASE_FRAME, start: 0 };
}

/**
 * `SpawnThrownWeapon` — `FUN_004504E0`. The hand goes bare and the weapon
 * takes off.
 *
 * ```
 * w = ActorAlloc(ThrownWeaponUpdate, 0x13F4); ActorClearGameFields(w);
 * ActorClaimHitSlot(w)
 * zsass (0x16):  hand 5 -> 0x1F9F bare, w+0x13F0 = 0x1F91;
 *                hand 8 -> 0x1F9B bare, w+0x13F0 = 0x1F90;  w+0x1364 = 0x600
 * zslman (0x18): hand 5 -> 0x1FF1 bare, 0x1FE2; hand 8 -> 0x1FED, 0x1FE1;
 *                w+0x1364 = 0
 * (both also zero the bone record's +0x78, the hit-sphere radius)
 * thrower+0x1318 |= 1 << g_bone_damage_zone[hand]
 * w+0x40 = the hand's bone position, into the world
 * w+0x34 = 0x80000001; w+0x124 = w+0x128 = 2.0
 * w+0x121 = thrower+0x121; thrower+0x121 = 0; the off-screen latch moves too
 * w+0x1F8 = 5; w+0x1F4 = thrower's type; w+0x1390 = thrower
 * w+0x1358 = hand; w+0x135C = 0x2400; w+0x133C = w+0x1338 = 4
 * w+0x1310 = w+0x1312 = 0; AimThrownWeapon(w)
 * w+0x100 = pos; RegisterForCameraTracking(w)
 * ```
 *
 * Everything from `w+0x34` on is a tail Ghidra does not show: the routine's
 * pseudocode ends at the `MatrixStackPop` at `0x0045069E`, which it has
 * marked no-return (`L35`), and `0x004506A3`..`0x0045077F` is where the flags,
 * the permit, the hand, **the spin rate** and the aim all are. Reading only the
 * pseudocode is how the port came to say that nothing writes the rate.
 *
 * **The weapon takes the permit** — `MOV AL, [EDI+0x121]` (`8a8721010000`,
 * 0x004506BB), `MOV [ESI+0x121], AL` (`888621010000`, 0x004506C4) — and the
 * thrower is left holding **0, not -1**: `MOV [EDI+0x121], BL`
 * (`889f21010000`, 0x004506D5) with `EBX` zeroed at 0x0045050A. The
 * off-screen latch `obj+0x136C` bit `0x8000` moves across with it (`TEST
 * EAX, ECX` / `JZ` — `85c8 741d` at 0x004506DB, `OR` on the weapon's word and
 * `AND AH, 0x7F` on the thrower's). The weapon gives the slot back when it has
 * blinked out, or at once when it is shot down; `ThrowerStateThrow` releases
 * nothing. The port used to free the permit here, some ninety frames early,
 * because its weapon could not hold one. `[proved]`
 *
 * `[diverges]` The engine reads the hand's own recorded position —
 * `obj + 0x274 + bone * 0x90`, through the camera block's `+0x40` matrix —
 * and so it **cannot fail**. The port has no skeleton in `game/`, so it asks
 * the host, and a host that cannot answer gets the actor's own position lifted
 * by a chest height rather than no weapon at all: a routine with no path that
 * declines to make the weapon must not grow one. And two things the weapon
 * does in the engine are not done, for the reasons `ZombieThrowHandWeapon`
 * (`FUN_0045A240`) gives for its own identical two: the hit slot and the
 * camera candidate.
 *
 * The hand's hit-sphere radius **is** zeroed -- `MOV [reg + EDI + 0x284],
 * EBX` with the index `obj+0x1358 * 0x90`, in all four arms (`0x0045054E`,
 * `0x00450580`, `0x004505BF`, `0x004505E8`) -- onto {@link Actor.boneRadius},
 * and the centre is left alone; `ThrowerStateRearm` or
 * `ThrowerStateRestoreBothHands` gives the sphere back with the weapon. It was
 * left out, declared a divergence, for as long as the actor had no per-bone
 * radius to zero.
 */
export function SpawnThrownWeapon(obj: ThrowerActor, hand: ThrowHandJson,
                                  host: GameHost,
                                  events?: Events): void {
  const cfg = CharacterTypeOf(obj)?.throw;
  const w = ThrownWeaponAlloc(ThrownWeaponRoutine.Thrower);

  // `obj+0x20C + bone*0x90` -- the draw record, recorded on the actor beside
  // the call that asks the renderer for it, so a snapshot carries which model
  // each bone is showing. `render/characters/gore.ts` used to record it, which
  // made the snapshot depend on whether a hierarchy was in the scene.
  obj.boneSlot[String(hand.bone)] = hand.bare;
  host.setBoneSlot(obj.at, hand.bone, hand.bare);
  // The bone record's `+0x78`, the hit-sphere radius: the hand it has just
  // emptied cannot be shot.
  obj.boneRadius[String(hand.bone)] = 0;
  w.slot = hand.projectile;
  // `obj+0x1364`, the constant the draw adds to the **X** term. `cfg.spin`
  // is that constant: the exporter reads it out of this routine and the name
  // is older than the reading.
  w.tilt = cfg?.spin ?? 0;
  obj.zones |= hand.cancel_mask & DamageZone.All;

  if (!host.boneWorld(obj.at, hand.bone, w.pos)) {
    w.pos.x = obj.pos.x;
    w.pos.y = obj.pos.y + HAND_HEIGHT;
    w.pos.z = obj.pos.z;
  }
  w.flags = THROWN_WEAPON_SPAWN_FLAGS;
  w.hitRadius = THROWN_WEAPON_HIT_RADIUS;
  w.attackPermit = obj.attackPermit;
  obj.attackPermit = 0;
  if (obj.flags2 & ThrowerFlag.OffScreenPermit) {
    w.flags2 |= ThrowerFlag.OffScreenPermit;
    obj.flags2 &= ~ThrowerFlag.OffScreenPermit;
  }
  w.drawFlags = THROWN_WEAPON_DRAW_FLAGS;
  w.charType = obj.charType;
  w.from = obj.at;
  w.hand = hand.bone;
  w.spinRate = THROWN_WEAPON_SPIN;
  // `obj+0x133C = obj+0x1338 = 4` at `0x00450736`: the afterimage timers,
  // which `ZslmanBladeEmitAfterimage` (`FUN_00450930`) counts down for a
  // `zslman` blade and nothing reads for any other.
  w.afterimageTimer = THROWN_WEAPON_AFTERIMAGE_PERIOD;
  w.afterimagePeriod = THROWN_WEAPON_AFTERIMAGE_PERIOD;
  w.state = ThrownWeaponState.Fly;
  w.sub = FlySub.Launch;
  AimThrownWeapon(w, ThrownWeaponCameraOf(host));
  G.g_thrown_weapons.push(w);
  events?.emit("enemy.threw", { at: obj.at, who: obj.name });
}

/**
 * `ThrowerStateThrow` — `FUN_0044FAF0`, class 0x31 state 31.
 *
 * Play the clip, let go on the frame the hand names, and **hand back to the
 * hub on the clip's last frame**. It does not put the weapon back and it does
 * not give the permit up: state 7 offers `ThrowerStateRearm` (`FUN_0044F7A0`,
 * state 29) — `ThrowerStateRestoreBothHands` (`FUN_0044F900`, state 30) for
 * character type 0x18 — to `ThrowerTryEnterState` (`FUN_0044AFB0`) *before* it
 * asks the router anything, and that gate passes exactly when
 * `ThrowerHasBareHand` (`FUN_0044F720`) says an arm is empty. So the loop is
 * hub → throw → hub → re-arm → hub, and each leg is a state that owns one
 * thing.
 *
 * The three sub-states **fall through into each other**, which is why a throw
 * can start and release on the same frame: the engine's dispatch is
 * `SUB EAX, 0 / JZ` then `DEC EAX / JZ` twice (0x0044FB16..0x0044FB23), and
 * each arm ends by *incrementing* `obj+0x1312` and running straight on into
 * the next.
 *
 * The exit, all of it:
 *
 * ```
 * 0044fcbb  MOV   EDX, dword ptr [ESI + 0x1b4]           8b96b4010000
 * 0044fcc1  MOV   ECX, dword ptr [ESI + 0x19c]           8b8e9c010000
 * 0044fcc7  MOVSX EAX, word ptr [EDX*0x2 + 0x4e07d0]     0fbf0455d0074e00
 * 0044fccf  DEC   EAX                                    48
 * 0044fcd0  CMP   ECX, EAX                               3bc8
 * 0044fcd2  JL    0x0044fcf3                             7c1f
 * 0044fcd4  PUSH  0x2916a9                               68a9162900
 * 0044fcd9  CALL  0x0041cfd0            PlaySoundId      e8f2d2fcff
 * 0044fce1  MOV   word ptr [ESI + 0x1310], 0x7           66c786101300000700
 * 0044fcea  MOV   word ptr [ESI + 0x1312], 0x0           66c786121300000000
 * ```
 *
 * — `g_motion_play_length` of the **base track's** motion against the **base
 * track's** cursor, which is why the port runs the throw on `obj.motion` and
 * `obj.playTicks` rather than on the one-shot channel it has no counterpart
 * for. The port used instead to loop here and leave only when its own clip
 * channel emptied, re-arming one hand on the way out; that is the divergence
 * this replaces.
 */
export function ThrowerStateThrow(obj: ThrowerActor, host: GameHost,
                                  rng: Rng, events?: Events): void {
  if (obj.sub === ThrowSub.Draw) {
    // `if (obj+0x121 == 0xFF && !ThrowerTryClaimAttackSlot(obj)) obj+0x121 = 0`
    // — `CMP byte ptr [ESI + 0x121], 0xff` at 0x0044FB2C, and on a refusal
    // `MOV byte ptr [ESI + 0x121], AL` with AL already zero (0x0044FB42).
    // **Zero, not -1**: the actor goes on to throw holding what reads as
    // permit slot 0. It is very nearly dead code — `ThrowerTryEnterState`'s
    // case 0x1F claims one before it writes the state — but it is the engine's
    // own answer to arriving without one, and the port's used to be a bail to
    // the hub.
    if (obj.attackPermit < 0 && !ThrowerTryClaimAttackSlot(obj, rng, host)) {
      obj.attackPermit = 0;
    }
    const bone = ThrowerPickThrowingHand(obj, rng);
    // `CMP EAX, 0x5 / SETNZ DL / MOV byte ptr [ESI + 0x131a], DL`. The exe
    // also files the bone itself at `obj+0x1358`; the port hands the entry
    // straight to `SpawnThrownWeapon`, so it has nowhere to put it —
    // {@link ThrowerActor.allowance} is that offset read as a different field.
    obj.attack = bone === RIGHT_HAND_BONE ? 0 : 1;
    // Neither hand is armed. The engine has no such path — `ThrowerTryEnterState`
    // refuses state 0x1F unless `ThrowerBothHandsArmed` (`FUN_0044F5D0`) is
    // true — so this is that precondition made explicit rather than a
    // behaviour of its own; on any reachable entry the pick returns 5 or 8.
    if (bone === 0) {
      if (obj.attackPermit >= 0) ThrowerReleaseAttackPermit(obj);
      obj.state = ThrowerState.StandAndDecide;
      obj.sub = 0;
      return;
    }
    const cue = ThrowerThrowCue(obj, ThrowHandsOf(obj)[obj.attack]);
    // `FUN_004119A0`'s third argument is the play **cursor** --
    // `param_1[2] = param_3` writes `obj+0x19C` outright.
    ActorSetMotionBlended(obj, cue.motion, cue.start, THROW_FADE);
    obj.sub = ThrowSub.Winding;
    // ...and falls straight through, as `INC word ptr [ESI + 0x1312]` at
    // 0x0044FC7C does into the release test at 0x0044FC83.
  }

  if (obj.sub === ThrowSub.Winding) {
    // The frame the weapon leaves the hand. The local name is here so the
    // frame reading of `obj+0x1350` is never confused with the landing-surface
    // one at a use site; see {@link ThrowerThrowCue} and
    // {@link ThrowerTail.landSurface}.
    const hand = ThrowHandsOf(obj)[obj.attack];
    if (!hand) return;
    const throwCueFrame = ThrowerThrowCue(obj, hand).release;
    if (obj.playTicks < throwCueFrame) return;
    SpawnThrownWeapon(obj, hand, host, events);
    obj.sub = ThrowSub.Thrown;
    // ...and falls through again, into 0x0044FCBB.
  }

  // A sub-state past 2 is the engine's `POP EDI / POP ESI / RET` at
  // 0x0044FB29: the dispatch has three arms and nothing else.
  if (obj.sub !== ThrowSub.Thrown) return;
  // The clip's last frame, and out to the hub. `g_motion_play_length - 1`
  // against the cursor, both on the base track.
  if (obj.playTicks < MotionPlayLength(obj, obj.motion) - 1) return;
  events?.emit("sound.play", { id: SFX_THROW_DONE });
  obj.state = ThrowerState.StandAndDecide;
  obj.sub = 0;
}

/**
 * `EnemyThrowerUpdate` — `FUN_00449910`.
 *
 * The engine's own order: the cooldown ticks, the shot drain runs, the state
 * runs, and only then does `vel += acc; pos += vel` integrate. Class 0x31
 * integrates **acceleration as well as velocity**, unlike class 0x30, which is
 * what makes its fall and its knock-back physical — but the leap states do not
 * use it at all: they write the position outright from the arc's closed form.
 */
export function EnemyThrowerUpdate(obj: ThrowerActor, f: ClassFrame): void {
  const { dt, rng, host, events } = f;
  // The cooldown is also the post-knockdown window in which shots ricochet:
  // `EnemyThrowerUpdate` clears `obj+0x34` bit 0x100 when it reaches zero.
  if (obj.cooldown > 0) {
    obj.cooldown = Math.max(0, obj.cooldown - dt * GAME_HZ);
    if (obj.cooldown === 0) obj.flags &= ~ActorFlag.ShotImmune;
  }
  // The shot drain, in the engine's own place: before the state runs.
  ThrowerOnShot(obj);

  ThrowerRunState(obj, dt, rng, host, events);

  // `ThrowerPushOutOfWorld` (`FUN_00449D40`), the collision hook at
  // `obj+0x12F0`, and it runs **after** the state — the same place
  // `EnemyZombieUpdate` runs its own. That ordering is the whole of it: every
  // state here writes `obj.pos` outright, so a push that ran first was
  // overwritten before anything drew it, and the body stayed in the wall.
  //
  // Two things say it is after. `FUN_00405160`, which registers the sphere
  // `ThrowerPlaceCollisionSphere` writes into the per-frame list, is reached
  // from the *end* of `EnemyThrowerUpdate` through `FUN_00409B70` — so the
  // sphere has to have been placed by then. And the hook's own last act is
  // `ThrowerSnapToSurface` for states 7 and 8, which is what holds a
  // wall-crawler on its wall; a snap applied before the state moves the actor
  // would be undone every frame.
  ThrowerPushOutOfWorld(obj);
  // `ThrowerAdvanceMotion` (`FUN_00449EF0`), at `0x0044998A`: the draw, and
  // with it the node hook -- which is where the hand grows back. The clock
  // half of that routine is the director's `ActorAdvanceMotion`.
  //
  // [diverges] The hook is always `ThrowerDrawBonePart`. `EnemyThrowerInit`
  // installs `ThrowerDrawWithEnlargedHead` (`FUN_0044A300`) instead in
  // Original Mode with `DAT_009C88A8` up, and in Training
  // `ThrowerAdvanceMotion` swaps in `ThrowerDrawNodePart` (`FUN_0044A2B0`),
  // which grows nothing, for the next frame whenever it holds the clock
  // (`obj+0x34` bit `0x4000`, or bytes `0x009C72F1`/`0x009C72F2` not 1 and
  // 0). `DAT_009C88A8` has not been read, and the port keeps no hook pointer.
  // The big-head arm also doubles bone 2's hit radius (`obj+0x3A4`,
  // `FADD ST0,ST0` at `0x004498E1`), which goes with the item.
  HeadAimBeginDraw(obj, obj.thr, host);
  ActorRunNodeDrawHooks(obj, ThrowerDrawBonePart, f);
  HeadAimEndDraw(obj, obj.thr, host);
  // `PUSH 0; CALL 0x00409b70` at `0x0044998F`, the routine's last act and on
  // every path: the camera point, not lifted, and the candidate filing. The
  // death chain's `0x10000` keeps a corpse off the list.
  ActorRegisterCameraPoint(obj, host, THROWER_CAMERA_RISE);
}

/** `PUSH 0x0` at `0x0044998F`: `ActorRegisterCameraPoint`'s 0.0. */
export const THROWER_CAMERA_RISE = 0.0;

/**
 * The state table, dispatched. `g_class31_states` (0x00592960) is 36 entries
 * and every one has an arm here -- entries 0 and 35 are both the shared
 * no-op, `0x0041EBB0`.
 */
function ThrowerRunState(obj: ThrowerActor, dt: number, rng: Rng,
                         host: GameHost, events?: Events): void {
  const stance = ThrowerStanceOf(obj) & 3;
  switch (obj.state) {
    case ThrowerState.HitReaction:
      return ThrowerStateHitReaction(obj, rng, host);
    case ThrowerState.FallAndLand:
      return ThrowerStateFallAndLand(obj, host, dt, rng, events);
    case ThrowerState.Death:
      return ThrowerStateDeathClip(obj);
    case ThrowerState.Corpse:
      return ThrowerStateCorpseSink(obj, dt, rng);
    case ThrowerState.CorpseBlink:
      return ThrowerStateCorpseBlink(obj, dt, rng);
    // Slot 6 holds `ThrowerLeave`, which nothing ever enters as a state. It is
    // here so that an actor forced into it by a descriptor still leaves.
    case ThrowerState.Leave:
      return ThrowerLeave(obj);
    case ThrowerState.FallToSurface:
      return ThrowerStateFallToSurface(obj, dt);
    case ThrowerState.GetUp:
      return ThrowerStateGetUp(obj, rng, host, events);
    case ThrowerState.RideObjectPath:
      return ThrowerStateRideObjectPath(obj, dt, rng, host);
    case ThrowerState.LeapStrike:
      return ThrowerStateLeapStrike(obj, dt, rng, host, events);
    case ThrowerState.CloseAndStrike:
      return ThrowerStateCloseAndStrike(obj, rng, host, events);
    case ThrowerState.GrabPlayer:
      return ThrowerStateGrabPlayer(obj, dt, rng, events);
    case ThrowerState.WaitForCue:
      return ThrowerStateWaitForCue(obj, dt, rng);
    case ThrowerState.Rearm:
      return ThrowerStateRearm(obj, host);
    case ThrowerState.RestoreBothHands:
      return ThrowerStateRestoreBothHands(obj, stance, host);
    case ThrowerState.StrikeOnTheSpot:
      return ThrowerStateStrikeOnTheSpot(obj, dt, rng, host, events);
    case ThrowerState.KnockedTumbling:
      return ThrowerStateKnockedTumbling(obj, host, dt, rng, events);
    case ThrowerState.BlinkIn:
      return ThrowerStateBlinkInThreeHops(obj, dt, stance);
    case ThrowerState.StandAndDecide:
      return ThrowerStateStandAndDecide(obj, dt, rng, host, events);
    case ThrowerState.WaitForPermit:
      return ThrowerStateWaitForPermit(obj, rng, host, events);
    // Three ids, one handler: the router names 12 and 13, the wait names 9.
    case ThrowerState.Pounce:
    case ThrowerState.PounceNear:
    case ThrowerState.PounceFar:
      return ThrowerStateLeapDown(obj, dt, rng, host, events);
    case ThrowerState.LeapAside:
      return ThrowerStateLeapAside(obj, dt, rng, host, events);
    case ThrowerState.LeapToWallA:
    case ThrowerState.LeapToWallB:
    case ThrowerState.LeapToCeiling:
      return ThrowerStateLeapToSurface(obj, dt, host, events);
    case ThrowerState.WalkDistance:
      return ThrowerStateWalkDistance(obj, rng);
    case ThrowerState.EntranceClip:
      return ThrowerStateEntranceClip(obj, events);
    case ThrowerState.DelayedPounce:
      return ThrowerStateDelayedPounce(obj, dt, rng, host, events);
    case ThrowerState.Withdraw:
      return ThrowerStateWithdraw(obj, dt, rng);
    case ThrowerState.LeapToPoint:
      // No `ActorIntegrate`: the arc **interpolates** the position, the way
      // `ActorArcStep` does for every other leap in this class. Integrating a
      // velocity on top would move the actor twice.
      return ThrowerStateLeapToPoint(obj, dt, rng, events, host);
    case ThrowerState.PathFollow:
      // It moves itself: each leg is an arc with its own duration.
      return ThrowerStatePathFollow(obj, dt, rng, events, host);
    // No turn here. `TurnActorTowardCamera` (`FUN_00409ED0`) has two callers
    // in the image and both are `ZombieStateAttackRun`'s; `ThrowerStateThrow`
    // calls no turn routine at all, so a thrower throws on the facing
    // `ThrowerStateStandAndDecide` left it with. The port turned it here with
    // an ease from before any of this was read.
    case ThrowerState.Throw:
      return ThrowerStateThrow(obj, host, rng, events);
    // States 0 and 35 are the engine's shared no-op: an actor placed in either
    // does nothing for ever, which is what the engine does too. The port used
    // to send 35 to the hub, reading the table as 35 entries long.
    case ThrowerState.Idle:
    case ThrowerState.Idle35:
      return;
    default:
      // `CALL dword ptr [EAX*0x4 + 0x592960]` has no bound: a state past 35
      // calls through `g_class31_motion_sets`' pointers, which are data. No
      // shipped descriptor starts past 34 (the twelve stage bundles'
      // class-0x31 spawns start in 18, 19, 20, 23, 26, 27 and 34, the
      // training stage's six in 28) and nothing writes one, so there is
      // nothing to follow; the port does nothing.
      return;
  }
}

/** `param_1[0x4a]` in `EnemyThrowerInit`: `obj+0x128`, the body sphere. */
const CHAR_ZSASS = 0x16;
/** `EnemyThrowerInit`'s armed hands for `zsass` (`0x00449877`, `0x00449881`). */
const ZSASS_ARMED_RIGHT = 0x1fa2;
const ZSASS_ARMED_LEFT = 0x1f9e;
const BODY_RADIUS_ZSASS = 5.0;
const BODY_RADIUS_OTHER = 4.0;

/**
 * `EnemyThrowerInit` — `FUN_00449620`.
 *
 * The start state is the descriptor's own byte +2 and the behaviour set is
 * byte +1. Stage 2's class-0x31 spawns start in 18, 19, 20, 23 and 26 — never
 * in the throw state an earlier port assumed, which is why the two `zsass`
 * above the street stood in mid-air instead of dropping into it.
 */
export function EnemyThrowerInit(obj: ThrowerActor): void {
  // `ActorBuildSkinnedModel` at `0x00449686`, then `MOV EDX, [ESI+0x1F8]` /
  // `OR EDX, 0x4` (`83ca04`) at `0x00449694` / `MOV [ESI+0x1F8], EDX`: the
  // same bit `EnemyZombieInit` raises at `0x00452E21`, so a thrower's corpse
  // ring sits on the traced floor and not at the body's own y --
  // `SpawnGroundRingEffect` (`FUN_00407DA0`) tests it at `0x00407DCD`.
  // `[proved]`
  obj.motionFlags |= MotionFlag.TraceGround;
  obj.sub = ThrowSub.Draw;
  obj.attack = 0;
  obj.attackPermit = -1;
  // `obj+0x1316`, from the descriptor's `+0x20`: the surface the actor starts
  // attached to. Every shipped stage-2 spawn starts on the ground; stage 6's
  // eight `BlinkIn` spawns cover all four stances, and five of them carry a
  // surface bit.
  //
  //   00449762  MOVSX EAX, word ptr [ESI + 0x1316]   0fbf8616130000
  //   00449769  OR    EAX, 0x180000                  0d00001800
  //   0044977a  MOV   dword ptr [ESI + 0x136c], EAX  89866c130000
  //
  // `| 0x180000` — **every** thrower is born colliding, against the world and
  // against other actors both. Without these two bits `ThrowerPushOutOfWorld`
  // does nothing at all and the body is tested at its origin alone, which
  // draws a thrower standing a radius deep in a wall.
  //
  // The word is **sign-extended**, not zero-extended, so a descriptor setting
  // `0x8000` would raise the whole high half. None does; the shift pair says
  // so anyway rather than pretending the question is not there.
  // `004496FE  TEST dword ptr [ESI + 0x34], 0x40000` and the `VecToAngles`
  // after it, between the body radius and the flag word: the head aim's seed,
  // the same as class 0x30's -- see `HeadAimSeed`.
  HeadAimSeed(obj, obj.thr);
  obj.flags2 = ((obj.descFlags << 16) >> 16) | ThrowerFlag.Collide;
  // Then the stance, from bits 6/7/8 of what the descriptor just supplied —
  // `ECX = 3*bit8 + 2*bit7 + bit6` at 0x00449770..0x00449794, a four-arm jump
  // table at `0x00449900`, and each non-ground arm raises `OffGround`
  // (`OR AL, 0x20` — `0c20`). Two surface bits at once make the index exceed
  // 3 and the whole thing is skipped: `CMP ECX, 0x3` / `JA` (`83f903` /
  // `7745`) at 0x0044979B.
  //
  // Each arm also writes `obj+0x134C` = 0.0/1.0/2.0/3.0. Nothing in class
  // 0x31 reads that float — its only readers in the program are `FUN_0040F220`
  // and class 0x30's `FUN_004534A0`, which seed it with quite different
  // numbers — so its meaning is `[open]` and the port does not carry it.
  //
  // Two surface bits at once therefore leave the actor on the ground with no
  // `OffGround` at all — the engine falls out of the switch rather than
  // picking a stance. No shipped spawn does it; the arm is here because the
  // engine has it.
  const stance = ThrowerStanceOf(obj);
  if (stance !== ThrowerStance.Ground && stance <= ThrowerStance.Ceiling) {
    obj.flags2 |= ThrowerFlag.OffGround;
  }
  // **`zslman` cannot be dismembered**, and it is born that way rather than
  // being made so by a hit:
  //
  //   00449810  6683f918  CMP  CX, 0x18                  ; CX is obj+0x1F4
  //   00449814  7557      JNZ  0x0044986d
  //   00449816  8b4634    MOV  EAX, dword ptr [ESI + 0x34]
  //   0044981d  80cc04    OR   AH, 0x4                   ; |= 0x400
  //   00449820  894634    MOV  dword ptr [ESI + 0x34], EAX
  //
  // `[proved]`. `CX` is the character type — the two arms above this one test
  // it against 0x17 (`6683f917` at `0x004497EC`) and the stance switch reads
  // the same register.
  //
  // The bit is {@link ActorFlag.NoDismember}, and `ResolveHit`'s two guards on
  // it — the sever at `0x004095BD` and bone 1's death wound at `0x004096C0` —
  // stop the limb leaving and the torso being cut, while the kill block that
  // scores and raises `Dead` sits outside both. So a `zslman` still dies
  // normally; it just does not come apart. This is the fourth writer of the
  // flag and the one the class-0x30 pass could not reach, because it is here.
  if (obj.charType === CHAR_ZSLMAN) obj.flags |= ActorFlag.NoDismember;
  // `param_1[0x4a]`, at `obj+0x128`: 5.0 for character type 0x16 and 4.0 for
  // 0x17 through 0x19. It is the radius both push-outs test with.
  obj.bodyRadius = obj.charType === CHAR_ZSASS
    ? BODY_RADIUS_ZSASS : BODY_RADIUS_OTHER;
  // `obj+0x138C`, the draw alpha, for the two types whose parts
  // `DrawCharacterPartSlot` draws at it -- and nowhere else:
  //
  //   004497f8  MOV [ESI + 0x138c], EDX           ; 0x17: 1.0
  //   00449823  CMP byte ptr [EBP + 0x2], 0x22    ; 0x18 starting in state 34
  //   00449829  OR  EAX, 0x80000                  ; ...no shadow
  //   0044982e  MOV [ESI + 0x138c], EDI           ; ...alpha 0
  //   0044983d  OR  AL, 0x4                       ; ...drawn at it
  //   00449847  MOV [ESI + 0x138c], EDX           ; 0x18 otherwise: 1.0
  //
  // `[proved]`, `EDX` 1.0 and `EDI` 0 from the routine's head. So stage 6's
  // eight `zslman` are born invisible and blinking, their waist and skirt
  // with them; state 34's own sub 0 then says the same again. Types 0x16 and
  // 0x19 are not written, which cannot show: their parts are drawn solid and
  // their bones read the word only under bit 2, which every writer raises
  // together with a value.
  if (obj.charType === CHAR_ZSKAMERE) {
    obj.alpha = 1;
  } else if (obj.charType === CHAR_ZSLMAN) {
    if (obj.initialState === ThrowerState.BlinkIn) {
      obj.flags |= ActorFlag.NoShadow;
      obj.alpha = 0;
      obj.flags2 |= ThrowerFlag.Blinking;
    } else {
      obj.alpha = 1;
    }
  }
  // **`zsass` is armed here**, and only its draw records are:
  //
  //   00449871  CMP  CX, 0x16
  //   00449877  MOV  dword ptr [ESI + 0x4dc], 0x1fa2   ; bone 5's slot
  //   00449881  MOV  dword ptr [ESI + 0x68c], 0x1f9e   ; bone 8's
  //
  // `[proved]`. The skeleton names the bare hands (`0x1F9F`, `0x1F9B`), and
  // until this was ported nothing else put the weapons in them before the
  // first `ThrowerStateRearm`. The radius is not written: the
  // build refused both hands' rows, whose slots are these two and not the
  // skeleton's, so a `zsass` holding its weapons cannot be shot in either
  // hand until it has thrown and re-armed. The renderer replays the slots
  // when it adopts the actor, as it does `ActorBindPartList`'s.
  if (obj.charType === CHAR_ZSASS) {
    obj.boneSlot[String(RIGHT_HAND_BONE)] = ZSASS_ARMED_RIGHT;
    obj.boneSlot[String(LEFT_HAND_BONE)] = ZSASS_ARMED_LEFT;
  }
  obj.pendingHit = null;
  obj.thr.knockCount = 0;
  obj.thr.stance = 0;
  obj.thr.moveBand = 0;
  obj.arcPhase = 0;
  obj.arcScript = null;
  obj.state = ThrowerEntryState(obj);
  // `INC word [g_enemies_present]` then `INC word [g_enemies_alive]`, with no
  // guard at all -- unlike class 0x30's, which excludes two kinds.
  CountEnemyThrowerIn();
  // `obj+0x121 = 0xFF`, then `RegisterEnemySlot` at `0x004498A1`: the thrower
  // takes a camera slot the moment it exists, until the next
  // `UpdateCameraEnemySlots` deals the table afresh.
  RegisterEnemySlot(obj);
}

/**
 * Which state to actually start in.
 *
 * `EnemyThrowerInit` stores the descriptor's byte `+2` as it stands --
 * `*(short *)(obj+0x1310) = (short)desc[2]` -- and so does this, for every
 * state the table has: 0 and 35 idle, 7 is the hub, and the eight entrances
 * the shipped data uses (18, 19, 20, 23, 26, 27 and 34 on the stages, 28 on
 * the training stage) are all ported, as are the two, 21 and 22, that no
 * descriptor names. It used to send every state it did not list to the hub.
 *
 * `[port-only]` The arms that fall back to the hub are the port's: they cover
 * a bundle that did not decode the tail the state reads, which the engine
 * reads through `obj+0x1390` whatever it holds. Every shipped spawn in those
 * states has its tail.
 */
export function ThrowerEntryState(obj: ThrowerActor): ThrowerState {
  switch (obj.initialState) {
    case ThrowerState.GrabPlayer:
      return obj.grab ? ThrowerState.GrabPlayer : ThrowerState.StandAndDecide;
    case ThrowerState.WaitForCue:
      return obj.cue ? ThrowerState.WaitForCue : ThrowerState.StandAndDecide;
    case ThrowerState.BlinkIn:
      return ThrowerState.BlinkIn;
    case ThrowerState.LeapStrike:
      return obj.leapStrikeFrames > 0
        ? ThrowerState.LeapStrike : ThrowerState.StandAndDecide;
    case ThrowerState.RideObjectPath:
      return ThrowerState.RideObjectPath;
    case ThrowerState.WalkDistance:
      return obj.walkDistance > 0
        ? ThrowerState.WalkDistance : ThrowerState.StandAndDecide;
    case ThrowerState.EntranceClip:
      return obj.entranceMotion > 0
        ? ThrowerState.EntranceClip : ThrowerState.StandAndDecide;
    case ThrowerState.DelayedPounce:
      return obj.pounce ? ThrowerState.DelayedPounce : ThrowerState.StandAndDecide;
    case ThrowerState.LeapToPoint:
      return obj.leap ? ThrowerState.LeapToPoint : ThrowerState.StandAndDecide;
    case ThrowerState.PathFollow:
      return obj.path ? ThrowerState.PathFollow : ThrowerState.StandAndDecide;
    default:
      return obj.initialState;
  }
}

/**
 * The thrower. Its states are class 0x31's own table, not class 0x30's, so
 * the number is shown raw rather than named with the wrong vocabulary.
 */
export function EnemyThrowerDebug(obj: ThrowerActor): ActorDebug {
  // `ThrowerStateWaitForPermit` is a pose held until a permit frees, so an
  // actor parked in it looks exactly like one whose own logic has stalled.
  // `ThrowerTryClaimAttackSlot` refuses on the latch, the one player it
  // offers and that player's state, and none of it is visible from the row
  // without saying so.
  const waiting = obj.state === ThrowerState.WaitForPermit
    && obj.attackPermit < 0;
  const why = !waiting ? null
    : AttackClaimRefusal() ?? "a permit is free — the claim is not being made";
  const detail = [
    `rank ${obj.rank}/${obj.allowance} · queue ${obj.queueRank}`,
    `hp ${obj.hp}/${obj.maxHp} · motion ${obj.motion}`
      + ` · flags 0x${(obj.flags >>> 0).toString(16)}`,
  ];
  return {
    summary: `${ThrowerState[obj.state] ?? obj.state}/${obj.sub}`
      + (obj.dead ? " · dead" : obj.attackPermit >= 0 ? " · permit"
         : waiting ? " · wants a permit" : ""),
    detail: why ? [`blocked: ${why}`, ...detail] : detail,
    hot: obj.attackPermit >= 0,
  };
}

/**
 * What a class-0x31 thrower gives back when `GameUpdate`'s sweep reaches it.
 *
 * The permit on every reason, in **its own** bit: `ThrowerFlag.OffScreenPermit`
 * is `obj+0x136C` bit `0x8000` where class 0x30's claim raises `0x20000` —
 * the note on `ThrowerTryClaimAttackSlot` (`FUN_0044CA40`) is where that
 * split is proved.
 *
 * The counts **only on a despawn**, and that is not an omission. Class 0x31's
 * death is four states and it runs the two retires where the exe does —
 * `ThrowerReleaseSlotOnDeath` (`FUN_0044D050`) drops the alive count as the
 * fall opens, `ThrowerEnterCorpseState` (`FUN_0044D0A0`) the present count
 * as the body becomes a corpse —
 * so a thrower that has merely died is *present but not alive*, exactly as the
 * engine leaves it, and a sweep that retired both here would collapse the one
 * window class 0x30 has already lost.
 */
function EnemyThrowerDeadSweep(obj: ThrowerActor, why: DeadSweep): void {
  ThrowerReleaseAttackPermit(obj);
  if (why !== DeadSweep.Despawned) return;
  ThrowerRetireFromAliveCount(obj);
  ThrowerRetireFromPresentCount(obj);
}

/** Class 0x31's row of `g_class_handlers`, filled by the class itself. */
export const EnemyThrowerHandler: ClassHandler = {
  init: EnemyThrowerInit,
  update: EnemyThrowerUpdate,
  leave: ThrowerLeave,
  onDeadSweep: EnemyThrowerDeadSweep,
  updatesWhenDead: true,
  debug: EnemyThrowerDebug,
};

registerClass(SpawnClass.Thrower, EnemyThrowerHandler);
