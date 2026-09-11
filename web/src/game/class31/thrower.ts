/**
 * Class 0x31 — the wall-crawler and the thrower.
 *
 * Four character types share one 35-state machine and four **behaviour sets**,
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
import { ActorFlag, DamageZone, ThrowerFlag, ThrowerStance, type ThrowerActor }
  from "../actor";
import {
  DeadSweep, registerClass, type ActorDebug, type ClassFrame,
  type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";
import { TurnActorTowardCamera } from "../actor_turn";
import { ThrowerReleaseAttackPermit, ThrowerTryClaimAttackSlot }
  from "../combat/permits";
import {
  ThrowerRetireFromAliveCount, ThrowerRetireFromPresentCount,
} from "../combat/counts";
import { G } from "../globals";
import type { GameHost } from "../host";
import { CharacterTypeOf, MotionPlayLength, ThrowHandsOf }
  from "../tables";
import { vec3, type Vec3 } from "../vec";
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
import { ThrowerOnShot } from "./on_shot";
import {
  ThrowerStateCorpse, ThrowerStateDeathClip, ThrowerStateFallAndLand,
  ThrowerStateFallToSurface, ThrowerLeave,
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
import { THROWN_SPIN_RATE } from "./projectile";

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
 * for bone 5, 1 for bone 8, from `ThrowerPickThrowingHand` (`FUN_0044F630`) —
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
 * `AimThrownWeapon` — `FUN_004503D0`. A point `aim_ahead` in front of the
 * camera; the camera looks down its own local -Z, which is where the player is.
 */
export function AimThrownWeapon(obj: ThrowerActor, host: GameHost, eye: Vec3,
                                out: Vec3): void {
  const cfg = CharacterTypeOf(obj)?.throw;
  host.aimPoint(cfg?.aim_ahead ?? 0, out);
  out.y = eye.y;
}

/**
 * `SpawnThrownWeapon` — `FUN_004504E0`. The hand goes bare and the weapon
 * takes off.
 */
export function SpawnThrownWeapon(obj: ThrowerActor, hand: ThrowHandJson,
                                  host: GameHost, eye: Vec3,
                                  events?: Events): void {
  const cfg = CharacterTypeOf(obj)?.throw;
  if (!cfg) return;
  const from = vec3();
  // [diverges] The engine reads the hand's own recorded position —
  // `obj + 0x274 + bone * 0x90`, transformed by the camera matrix — and so it
  // **cannot fail**: `SpawnThrownWeapon` (`FUN_004504E0`) has no path that
  // declines to make the weapon. The port has no skeleton in `game/`, so it
  // asks the host, and a host that cannot answer used to make this `return`.
  // That is the whole of "the thrower plays the animation and no axe appears":
  // `ThrowerStateThrow` had already advanced its own sub-state to `Thrown`, so
  // the throw was counted and the weapon was not. Fall back to the actor's own
  // position lifted by a chest height, exactly as `ZombieThrowHandWeapon`
  // (`FUN_0045A240`) does on the class-0x30 side.
  if (!host.boneWorld(obj.at, hand.bone, from)) {
    from.x = obj.pos.x;
    from.y = obj.pos.y + HAND_HEIGHT;
    from.z = obj.pos.z;
  }

  // `obj+0x20C + bone*0x90` -- the draw record, recorded on the actor beside
  // the call that asks the renderer for it, so a snapshot carries which model
  // each bone is showing. `render/characters/gore.ts` used to record it, which
  // made the snapshot depend on whether a hierarchy was in the scene.
  obj.boneSlot[String(hand.bone)] = hand.bare;
  host.setBoneSlot(obj.at, hand.bone, hand.bare);
  obj.zones |= hand.cancel_mask & DamageZone.All;

  // [diverges] **The engine hands the permit to the weapon**, it does not free
  // it. `SpawnThrownWeapon` copies `obj+0x121` into the new actor and writes
  // the thrower's to **0** — not -1; `EBX` is zeroed at 0x0045050A —
  //
  //   004506bb  MOV AL, byte ptr [EDI + 0x121]      8a8721010000  the thrower
  //   004506c4  MOV byte ptr [ESI + 0x121], AL      888621010000  the weapon
  //   004506d5  MOV byte ptr [EDI + 0x121], BL      889f21010000  BL == 0
  //
  // and moves the off-screen latch with it when `obj+0x136C` bit 0x8000 is up
  // (`TEST EAX, ECX` / `JZ` — `85c8 741d` at 0x004506DB, then `OR` on the
  // weapon's word and `AND AH, 0x7F` on the thrower's).
  // The slot is then freed by the weapon, at the very end of its life:
  // `ThrownWeaponFlyToTarget` (`FUN_0044FD40`) calls
  // `ThrowerReleaseAttackPermit` in its sub-4 arm, after the 30 stick frames
  // and the 60 blink frames have run out, in the same breath as the despawn.
  // `ThrowerStateThrow` itself releases nothing — `FUN_0044CFB0` has exactly
  // eight call sites in the program and it is not one of them.
  //
  // The port's weapon is a plain record in `G.g_thrown_weapons`, a pool it
  // shares with class 0x30's thrown weapon, which has its own state table
  // (`g_zombie_thrown_weapon_states`, driven by `ZombieThrownWeaponUpdate`
  // — `FUN_0045A4F0`) and so its own release site. A record cannot hold a
  // permit and releasing from the shared flight routine would free a class
  // 0x30 actor's slot through class 0x31's routine, which is the exact
  // wrong-bit mistake the note on `ThrowerReleaseAttackPermit` warns about.
  // So the slot goes back here, where the engine hands it over, roughly 90
  // frames earlier than the engine gives it up. Making the pool carry a permit
  // is the fix, and it is a change to both classes' projectiles.
  ThrowerReleaseAttackPermit(obj);

  const target = vec3();
  AimThrownWeapon(obj, host, eye, target);
  const d = Math.hypot(target.x - from.x, target.y - from.y,
                       target.z - from.z);
  const ttl = Math.max(1, d / cfg.speed);
  G.g_thrown_weapons.push({
    id: G.g_thrown_next_id++,
    from: obj.at,
    slot: hand.projectile,
    pos: from,
    vel: vec3((target.x - from.x) / ttl, (target.y - from.y) / ttl,
              (target.z - from.z) / ttl),
    ttl,
    // `ThrownWeaponFlyToTarget` (`FUN_0044FD40`) at `0x0044FDE9`:
    // `obj+0x68 += obj+0x135C` when the throwing hand `obj+0x1358` is bone 5
    // and `-=` otherwise. So the sign is the hand's and the axis is **Y**.
    // The rate is the port's -- see `ThrownWeapon.spinAngle`.
    spin: hand.bone === 5 ? THROWN_SPIN_RATE : -THROWN_SPIN_RATE,
    axis: "y",
    spinAngle: 0,
    // `obj+0x1364`, the constant the draw adds to the **X** term. `cfg.spin`
    // is that constant: the exporter reads it out of `SpawnThrownWeapon` and
    // the name is older than the reading.
    tilt: cfg.spin,
    after: 0,
    hit: false,
    stickFrames: cfg.stick_frames,
    blinkFrames: cfg.blink_frames,
    visible: true,
  });
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
export function ThrowerStateThrow(obj: ThrowerActor, host: GameHost, eye: Vec3,
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
    if (obj.attackPermit < 0 && !ThrowerTryClaimAttackSlot(obj, host)) {
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
    ActorSetMotionBlended(obj, cue.motion, 0, THROW_FADE);
    // `FUN_004119A0`'s third argument is the play **cursor**, not an authored
    // frame — `param_1[2] = param_3` writes `obj+0x19C` outright — and the
    // port's wrapper takes an authored frame, so the cursor is written here.
    obj.playTicks = cue.start;
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
    SpawnThrownWeapon(obj, hand, host, eye, events);
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
  const { eye, dt, rng, host, events } = f;
  // The cooldown is also the post-knockdown window in which shots ricochet:
  // `EnemyThrowerUpdate` clears `obj+0x34` bit 0x100 when it reaches zero.
  if (obj.cooldown > 0) {
    obj.cooldown = Math.max(0, obj.cooldown - dt * GAME_HZ);
    if (obj.cooldown === 0) obj.flags &= ~ActorFlag.ShotImmune;
  }
  // The shot drain, in the engine's own place: before the state runs.
  ThrowerOnShot(obj);

  ThrowerRunState(obj, eye, dt, rng, host, events);

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
}

/**
 * The state table, dispatched. `g_class31_states` (0x00592960) is 35 entries
 * and every one has an arm here.
 */
function ThrowerRunState(obj: ThrowerActor, eye: Vec3, dt: number, rng: Rng,
                         host: GameHost, events?: Events): void {
  const stance = ThrowerStanceOf(obj) & 3;
  switch (obj.state) {
    case ThrowerState.HitReaction:
      return ThrowerStateHitReaction(obj, eye, rng, host);
    case ThrowerState.FallAndLand:
      return ThrowerStateFallAndLand(obj, host, dt, rng);
    case ThrowerState.Death:
      return ThrowerStateDeathClip(obj);
    case ThrowerState.Corpse:
      return ThrowerStateCorpse(obj, dt, rng, false);
    case ThrowerState.CorpseBlink:
      return ThrowerStateCorpse(obj, dt, rng, true);
    // Slot 6 holds `ThrowerLeave`, which nothing ever enters as a state. It is
    // here so that an actor forced into it by a descriptor still leaves.
    case ThrowerState.Leave:
      return ThrowerLeave(obj);
    case ThrowerState.FallToSurface:
      return ThrowerStateFallToSurface(obj, dt);
    case ThrowerState.GetUp:
      return ThrowerStateGetUp(obj, eye, rng, host);
    case ThrowerState.RideObjectPath:
      return ThrowerStateRideObjectPath(obj, dt, host);
    case ThrowerState.LeapStrike:
      return ThrowerStateLeapStrike(obj, dt, rng, host, events);
    case ThrowerState.CloseAndStrike:
      return ThrowerStateCloseAndStrike(obj, eye, rng, host, events);
    case ThrowerState.GrabPlayer:
      return ThrowerStateGrabPlayer(obj, eye, dt, rng, events);
    case ThrowerState.WaitForCue:
      return ThrowerStateWaitForCue(obj, dt, rng);
    case ThrowerState.Rearm:
      return ThrowerStateRearm(obj, host);
    case ThrowerState.RestoreBothHands:
      return ThrowerStateRestoreBothHands(obj, dt, stance, host);
    case ThrowerState.StrikeOnTheSpot:
      return ThrowerStateStrikeOnTheSpot(obj, dt, rng, host, events);
    case ThrowerState.KnockedTumbling:
      return ThrowerStateKnockedTumbling(obj, host, dt, rng);
    case ThrowerState.BlinkIn:
      return ThrowerStateBlinkInThreeHops(obj, dt, stance);
    case ThrowerState.StandAndDecide:
      return ThrowerStateStandAndDecide(obj, eye, dt, rng, host);
    case ThrowerState.WaitForPermit:
      return ThrowerStateWaitForPermit(obj, eye, rng, host);
    // Three ids, one handler: the router names 12 and 13, the wait names 9.
    case ThrowerState.Pounce:
    case ThrowerState.PounceNear:
    case ThrowerState.PounceFar:
      return ThrowerStateLeapDown(obj, dt, rng, host, events);
    case ThrowerState.LeapAside:
      return ThrowerStateLeapAside(obj, eye, dt, rng);
    case ThrowerState.LeapToWallA:
    case ThrowerState.LeapToWallB:
    case ThrowerState.LeapToCeiling:
      return ThrowerStateLeapToSurface(obj, dt);
    case ThrowerState.WalkDistance:
      return ThrowerStateWalkDistance(obj, rng);
    case ThrowerState.EntranceClip:
      return ThrowerStateEntranceClip(obj);
    case ThrowerState.DelayedPounce:
      return ThrowerStateDelayedPounce(obj, dt, rng, host, events);
    case ThrowerState.Withdraw:
      return ThrowerStateWithdraw(obj, eye, dt, rng);
    case ThrowerState.LeapToPoint:
      ThrowerStateLeapToPoint(obj);
      return ActorIntegrate(obj, dt);
    case ThrowerState.PathFollow:
      // It moves itself: each leg is an arc with its own duration.
      return ThrowerStatePathFollow(obj, dt);
    case ThrowerState.Throw:
      TurnActorTowardCamera(obj, eye, dt);
      return ThrowerStateThrow(obj, host, eye, rng, events);
    // State 0 is the engine's shared no-op: an actor placed in it does nothing
    // for ever, which is what the engine does too.
    case ThrowerState.Idle:
      return;
    default:
      // Every one of the 35 states now has an arm, so this is only reachable
      // through a descriptor byte outside 0..34.
      obj.state = ThrowerState.StandAndDecide;
      obj.sub = 0;
      return;
  }
}

/**
 * `pos += vel`, at the engine's own 60 Hz. The arc's velocity is per frame, so
 * the port scales it by however much of a frame this tick covered.
 */
/** `param_1[0x4a]` in `EnemyThrowerInit`: `obj+0x128`, the body sphere. */
const CHAR_ZSASS = 0x16;
const BODY_RADIUS_ZSASS = 5.0;
const BODY_RADIUS_OTHER = 4.0;

function ActorIntegrate(obj: ThrowerActor, dt: number): void {
  const frames = dt * GAME_HZ;
  obj.pos.x += obj.vel.x * frames;
  obj.pos.y += obj.vel.y * frames;
  obj.pos.z += obj.vel.z * frames;
}

/**
 * `EnemyThrowerInit` — `FUN_00449620`.
 *
 * The start state is the descriptor's own byte +2 and the behaviour set is
 * byte +1. Stage 2's class-0x31 spawns start in 18, 19, 20, 23 and 26 — never
 * in the throw state an earlier port assumed, which is why the two `zsass`
 * above the street stood in mid-air instead of dropping into it.
 */
export function EnemyThrowerInit(obj: ThrowerActor): void {
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
  obj.alpha = 1;
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
}

/**
 * Which state to actually start in.
 *
 * All seven entrances the shipped data uses are ported — 18, 19, 20, 23, 26,
 * 27 and 34 — and so are the two, 21 and 22, that no descriptor names.
 * Anything else resolves to the hub, which is where every entrance ends.
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
      return ThrowerState.StandAndDecide;
  }
}

/**
 * The thrower. Its states are class 0x31's own table, not class 0x30's, so
 * the number is shown raw rather than named with the wrong vocabulary.
 */
export function EnemyThrowerDebug(obj: ThrowerActor): ActorDebug {
  // `ThrowerStateWaitForPermit` is a pose held until a permit frees, so an
  // actor parked in it looks exactly like one whose own logic has stalled.
  // `ThrowerTryClaimAttackSlot` refuses on two things and neither is visible
  // from the row without saying so.
  const waiting = obj.state === ThrowerState.WaitForPermit
    && obj.attackPermit < 0;
  const held = G.g_attack_permits.findIndex((p) => p !== -1);
  const why = !waiting ? null
    : G.g_attack_committed !== 0 ? "another enemy is committed off screen"
    : held !== -1
      ? `all ${G.g_max_attackers} permits held — 0x`
        + `${(G.g_attack_permits[held] ?? 0).toString(16).toUpperCase()} has it`
      : "a permit is free — the claim is not being made";
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
 * is `obj+0x136C` bit 0x40000000, because class 0x30 already uses 0x20000000
 * of the same word for its own actors — the note on
 * `ThrowerTryClaimAttackSlot` (`FUN_0044CA40`) is where that split is proved.
 *
 * The counts **only on a despawn**, and that is not an omission. Class 0x31's
 * death is four states and it runs the two retires where the exe does —
 * `ThrowerReleaseSlotOnDeath` (`FUN_0044D050`) drops the alive count as the
 * fall opens, `ThrowerStateCorpse` the present count when the body is done —
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
