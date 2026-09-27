/**
 * Class 0x19's four entrance states -- and both writers of
 * `g_script_flags[31]`.
 *
 * `Boss4StateEntranceCarried` (`FUN_004938B0`) is entries 0 **and** 2 of
 * `g_class19_states`; `Boss4StateEntranceDropped` (`FUN_00493B40`) is entries
 * 1 and 3. Each pair is one routine that reads its own state index back to
 * tell the two apart, and the two routines are the same code but for three
 * constants: the banner record, the arena phase and the "standing" state.
 *
 * The entrance index comes off the descriptor tail's byte `+0x01`, and the
 * four shipped class-0x19 spawns carry 0, 1, 2 and 3 -- one each, in stage 4's
 * blocks 23, 25, 27 and 29. Entrances 0 and 1 ride the transport in
 * (`class13/routine2.ts`, selector 2) and jump down on `g_script_flags[30]`;
 * 2 and 3 are already standing beside the parked one (selector 9).
 *
 * ```
 * sub 0: BossIntroBannerSpawn(banner); phase = 0 or 9; state+0x24 = maxhp * frac[phase]
 *        standing: ActorSetMotion(0x75); Boss4ChainsawOn(); flags &= ~0x10; sub = 2
 *        riding:   ActorSetMotion(0x7C); sub++
 * sub 1: !g_script_flags[30]: return
 *        Boss4ChainsawOn(); flags &= ~1
 *        the carrier's T RotX RotZ RotY times the boss's -> pos and angles, world space
 *        blend(0x75, 0, 10); PlaySoundId(0x231BA9); sub++
 * sub 2: char+0x20 == 0x75 && cursor == 0x5A: blend(0x74, 0, 10)
 *        g_bHudShutterState != 1: return
 *        g_script_flags[31] = 1; Boss4QueueCameraCue(phase); obj+0x34 &= ~0x8000
 *        Boss4LoadPhaseArena(); BossHpBarSpawn(320.0, 35.0); flags |= 0x12
 *        state 7; sub 0; blend(0x6B, 0, 0x16); g_boss_engaged = 1
 * ```
 *
 * ## Three writes, not two
 *
 * The survey that scheduled this work named `0x0049390C` and `0x004958C7`.
 * There is a third: `0x00493B99`, `Boss4StateEntranceDropped`'s own copy of
 * the flag-31 write, `MOV byte ptr [0x009c721f], 0x1` where the other routine
 * has `MOV byte ptr [0x009c721f], BL`. It raises no *new* flag -- both are 31 --
 * but a sweep that had missed it would have concluded that blocks 25 and 29
 * had no writer at all. Searching the bare `9c72` over the class's range is
 * what found it (L32).
 */
import type { Actor } from "../actor";
import { ActorFlag } from "../actor";
import { BossIntroBannerSpawn } from "../boss_banner";
import { BossHpBarSpawn } from "../boss_hp_bar";
import { CarrierBakeWorldPose } from "../carrier";
import { ActorSetMotion, ActorSetMotionBlended } from "../class30/motion_cue";
import { ActorByAt, G } from "../globals";
import type { ClassFrame } from "../registry";
import { MotionPlayFrame } from "../tables";
import { Boss4LoadPhaseArena } from "./arena";
import { Boss4QueueCameraCue } from "./camera";
import { Boss4ChainsawOn } from "./frame";
import {
  Boss4Clip, Boss4Flag, Boss4PhaseFloor, Boss4Sound, Boss4State,
} from "./state";
import type { Boss4Block as Blk } from "./state";

/**
 * `g_script_flags` -- `0x009C7200`, index 31.
 *
 * The byte both entrance routines write, at `0x0049390C` and `0x00493B99`, on
 * the frame the shutter reaches state 1. Five `wait_script_flag 31` gates in
 * the shipped scripts: stage 4's blocks 23, 25, 27 and 29, plus stage 5's
 * block 3 -- that last one is class 0x14's, not this class's.
 */
export const BOSS4_FIGHT_READY_FLAG = 31;

/**
 * `g_script_flags` -- `0x009C7200`, index 30.
 *
 * The script's own `set_script_flag 30` -- block 23 step 1 op 51, and the same
 * op in blocks 25, 27 and 29. It is read here at `0x0049397B` and by
 * `BossIntroBannerUpdate`, and it is the only flag in this chain the script
 * raises itself.
 */
export const BOSS4_DROP_FLAG = 30;

/** The shutter state the entrance waits for -- `CMP AL, BL` at `0x004938FD`. */
const SHUTTER_OPENING = 1;

/**
 * The frame of {@link Boss4Clip.Land} sub 2 blends into
 * {@link Boss4Clip.Settle} on -- `CMP dword ptr [EAX + 0x8], 0x5A`.
 */
const LAND_SETTLE_FRAME = 0x5a;

/** The fade sub 2 gives the idle it hands over to -- `PUSH 0x16`. */
const IDLE_FADE = 0x16;

/** `PUSH 0x420C0000; PUSH 0x43A00000` -- the health bar at (320.0, 35.0). */
const HP_BAR_X = 320.0;
const HP_BAR_Y = 35.0;

/** The entrance's sub-states, all reached by counting up by one. */
enum Sub {
  /** Spawn the banner, seat the phase and the damage floor, pick the clip. */
  Setup = 0,
  /** Ride the transport until `g_script_flags[30]`, then drop off it. */
  RideCarrier = 1,
  /** Stand, and wait for the banner to open the shutter. */
  WaitForShutter = 2,
}

/**
 * `Boss4StateEntranceCarried` -- `FUN_004938B0`. States 0 and 2.
 *
 * State 0 rides the transport and state 2 is already on the ground; the two
 * are told apart by `CMP byte ptr [EDX + 0x4], BL` with `BL` 2 at
 * `0x00493AE0`, which is the only place either constant appears.
 */
export function Boss4StateEntranceCarried(obj: Actor, b: Blk,
                                          f: ClassFrame): void {
  Boss4Entrance(obj, b, f, Boss4State.EntranceCarriedPlaced, 0x005972f8, 0);
}

/**
 * `Boss4StateEntranceDropped` -- `FUN_00493B40`. States 1 and 3.
 *
 * Byte for byte the routine above, with three constants changed: the state it
 * compares against is 3, the banner record is the second one and the phase it
 * seats is 9 rather than 0 -- the second arena's half of
 * `g_boss4_phase_hp_fraction`, which holds the same nine fractions again.
 */
export function Boss4StateEntranceDropped(obj: Actor, b: Blk,
                                          f: ClassFrame): void {
  Boss4Entrance(obj, b, f, Boss4State.EntranceDroppedPlaced, 0x00597338, 9);
}

/**
 * The body the two routines share.
 *
 * `[port-only]` as a *function*: the engine has two copies of this code, one
 * per pair, and they differ only in `placedState`, `banner` and `phase`.
 * Writing it twice would be two chances to transcribe it differently, and the
 * three constants are exactly what the two exe routines disagree about -- so
 * the parameters are the diff, not an invention.
 */
function Boss4Entrance(obj: Actor, b: Blk, f: ClassFrame, placedState: number,
                       banner: number, phase: number): void {
  if (b.sub === Sub.Setup) {
    // `PUSH 0x5972f8; CALL BossIntroBannerSpawn` -- the boss makes its own
    // name banner, and that banner is what will open the shutter. It is a
    // task of its own from here on (`game/boss_banner.ts`); the boss keeps
    // no hold on it, as the engine keeps none.
    BossIntroBannerSpawn(banner);
    b.phase = phase;
    // `FILD obj+0x11E; FMUL [EDX*4 + g_boss4_phase_hp_fraction]; FSTP float
    // state+0x24` at `0x00493ACC`. Read **after** the phase is written.
    b.phaseHpFloor = Math.fround(Boss4PhaseFloor(obj.maxHp, b.phase));
    if (b.state === placedState) {
      // Already on the ground: land pose, the chainsaw, and straight to the
      // shutter wait. `AND ECX, 0xFFFFFFEF` after `Boss4ChainsawOn` takes the
      // footfalls back down: a standing boss does not shake the screen yet.
      ActorSetMotion(obj, Boss4Clip.Land);
      Boss4ChainsawOn(b, f.events);
      b.flags &= ~Boss4Flag.Footfalls;
      b.sub = Sub.WaitForShutter;
      return;
    }
    ActorSetMotion(obj, Boss4Clip.Entrance);
    b.sub += 1;
    return;
  }

  if (b.sub === Sub.RideCarrier) {
    // `MOV AL, [0x009c721e]; TEST AL, AL; JZ` -- the script's
    // `set_script_flag 30`, and the same flag the banner is waiting on.
    if (!G.g_script_flags[BOSS4_DROP_FLAG]) return;
    Boss4ChainsawOn(b, f.events);
    b.flags &= ~Boss4Flag.OnCarrier;
    // `Push; LoadIdentity; Translate(carrier+0x40); RotX(c+0x64);
    // RotZ(c+0x6C); RotY(c+0x68); Translate(obj+0x40); RotX; RotZ; RotY;
    // MatrixGetTranslation -> obj+0x40; MatrixToEulerBams -> obj+0x64..0x6C;
    // Pop` -- the boss's carrier-relative pose made world, inline here and the
    // same six calls `CarrierBakeWorldPose` (`FUN_0045D920`) makes for the
    // class-0x30 riders. The translation is stored as floats.
    const carrier = ActorByAt(b.carrierAt);
    if (carrier) {
      CarrierBakeWorldPose(obj, carrier);
      obj.pos.x = Math.fround(obj.pos.x);
      obj.pos.y = Math.fround(obj.pos.y);
      obj.pos.z = Math.fround(obj.pos.z);
    }
    ActorSetMotionBlended(obj, Boss4Clip.Land, 0, 10);
    f.events?.emit("sound.play", { id: Boss4Sound.Hashiri });
    b.sub += 1;
    return;
  }

  if (b.sub !== Sub.WaitForShutter) return;

  // `if (char+0x20 == 0x75 && char+0x08 == 0x5A) blend(0x74, 0, 10)` -- the
  // landing settles into the standing pose on one exact frame, unguarded.
  if (obj.motion === Boss4Clip.Land
      && MotionPlayFrame(obj) === LAND_SETTLE_FRAME) {
    ActorSetMotionBlended(obj, Boss4Clip.Settle, 0, 10);
  }

  // `MOV AL, [0x009ca0f4]; CMP AL, BL` -- and `BL` is 1, the same register the
  // flag write below stores. The shutter only reaches state 1 from
  // `BossIntroBannerUpdate`, 300 frames after `g_script_flags[30]`.
  if (G.g_bHudShutterState !== SHUTTER_OPENING) return;

  // `MOV byte ptr [0x009c721f], BL` at `0x0049390C`, and its twin at
  // `0x00493B99`. This is the gate.
  G.g_script_flags[BOSS4_FIGHT_READY_FLAG] = 1;
  Boss4QueueCameraCue(b, b.phase);
  // `AND CH, 0x7F` -- obj+0x34 &= ~0x8000, the bit `Boss4Init` raised: from
  // here on the shot test takes him.
  obj.flags &= ~ActorFlag.NoShotTest;
  Boss4LoadPhaseArena(obj, b);
  BossHpBarSpawn(HP_BAR_X, HP_BAR_Y);
  b.flags |= Boss4Flag.Fenced | Boss4Flag.Footfalls;
  b.state = Boss4State.FaceCamera;
  b.sub = 0;
  ActorSetMotionBlended(obj, Boss4Clip.Idle, 0, IDLE_FADE);
  // `MOV byte ptr [0x009ca0ea], BL` -- `g_boss_engaged`.
  G.g_boss_engaged = 1;
}
