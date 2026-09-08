/**
 * Class 0x19's four entrance states — and both writers of
 * `g_script_flags[31]`.
 *
 * `Boss4StateEntranceCarried` (`FUN_004938B0`) is entries 0 **and** 2 of
 * `g_class19_states`; `Boss4StateEntranceDropped` (`FUN_00493B40`) is entries
 * 1 and 3. Each pair is one routine that reads its own state index back to
 * tell the two apart, and the two routines are the same code but for two
 * constants: the banner record and the arena phase.
 *
 * The entrance index comes off the descriptor tail's byte `+0x01`, and the
 * four shipped class-0x19 spawns carry 0, 1, 2 and 3 — one each, in stage 4's
 * blocks 23, 25, 27 and 29. So every one of the game's four is a different
 * entrance, and the eight `wait_script_flag` gates behind them are two per
 * block.
 *
 * ## Three writes, not two
 *
 * The survey that scheduled this work named `0x0049390C` and `0x004958C7`.
 * There is a third: `0x00493B99`, `Boss4StateEntranceDropped`'s own copy of
 * the flag-31 write, `MOV byte ptr [0x009c721f], 0x1` where the other routine
 * has `MOV byte ptr [0x009c721f], BL`. It raises no *new* flag — both are 31 —
 * but a sweep that had missed it would have concluded that blocks 25 and 29
 * had no writer at all. Searching the bare `9c72` over the class's range is
 * what found it (L32).
 */
import type { Actor } from "../actor";
import { G } from "../globals";
import { ActorSetMotion, ActorStartFade } from "../class30/motion_cue";
import { MotionPlayFrame } from "../tables";
import { BossIntroBannerSpawn } from "./banner";
import {
  BOSS4_PHASE_HP_FRACTION, Boss4Clip, Boss4Flag, Boss4State,
} from "./state";
import type { Boss4Block as Blk } from "./state";

/**
 * `g_script_flags` — `0x009C7200`, index 31.
 *
 * The byte both entrance routines write, at `0x0049390C` and `0x00493B99`, on
 * the frame the shutter reaches state 1. Five `wait_script_flag 31` gates in
 * the shipped scripts: stage 4's blocks 23, 25, 27 and 29, plus stage 5's
 * block 3 — that last one is class 0x14's, not this class's.
 */
export const BOSS4_FIGHT_READY_FLAG = 31;

/** The shutter state the entrance waits for — `CMP AL, BL` at `0x004938FD`. */
const SHUTTER_OPENING = 1;

/**
 * The frame of {@link Boss4Clip.Land} sub 2 blends into
 * {@link Boss4Clip.Settle} on — `CMP dword ptr [EAX + 0x8], 0x5A`.
 */
const LAND_SETTLE_FRAME = 0x5a;

/** The fade sub 2 gives the idle it hands over to — `PUSH 0x16`. */
const IDLE_FADE = 0x16;

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
 * `Boss4StateEntranceCarried` — `FUN_004938B0`. States 0 and 2.
 *
 * State 0 rides the transport and state 2 is already on the ground; the two
 * are told apart by `CMP byte ptr [EDX + 0x4], BL` with `BL` 2 at
 * `0x00493AE0`, which is the only place either constant appears.
 */
export function Boss4StateEntranceCarried(obj: Actor, b: Blk): void {
  Boss4Entrance(obj, b, Boss4State.EntranceCarriedPlaced, 0, 0);
}

/**
 * `Boss4StateEntranceDropped` — `FUN_00493B40`. States 1 and 3.
 *
 * Byte for byte the routine above, with three constants changed: the state it
 * compares against is 3, the banner record is the second one and the phase it
 * seats is 9 rather than 0 — the second arena's half of
 * `g_boss4_phase_hp_fraction`, which holds the same nine fractions again.
 */
export function Boss4StateEntranceDropped(obj: Actor, b: Blk): void {
  Boss4Entrance(obj, b, Boss4State.EntranceDroppedPlaced, 1, 9);
}

/**
 * The body the two routines share.
 *
 * `[port-only]` as a *function*: the engine has two copies of this code, one
 * per pair, and they differ only in `placedState`, `banner` and `phase`.
 * Writing it twice would be two chances to transcribe it differently, and the
 * three constants are exactly what the two exe routines disagree about — so
 * the parameters are the diff, not an invention.
 */
function Boss4Entrance(obj: Actor, b: Blk, placedState: number,
                       banner: number, phase: number): void {
  if (b.sub === Sub.Setup) {
    // `PUSH 0x5972f8; CALL BossIntroBannerSpawn` — the boss makes its own
    // name banner, and that banner is what will open the shutter.
    b.banner = BossIntroBannerSpawn(banner);
    // `MOV byte ptr [ECX + 0x8], 0x0` (or 9) — the arena phase.
    b.phase = phase;
    // `FILD obj+0x11E; FMUL [EDX*4 + g_boss4_phase_hp_fraction]; FSTP
    // state+0x24` at `0x00493ACC`. Read **after** the phase is written, so
    // the floor is this phase's and not the previous one's.
    b.phaseHpFloor = obj.maxHp * (BOSS4_PHASE_HP_FRACTION[b.phase] ?? 0);
    if (b.state === placedState) {
      // Already on the ground: land pose, and straight to the shutter wait.
      ActorSetMotion(obj, Boss4Clip.Land);
      Boss4EntranceHold(b);
      b.flags &= ~Boss4Flag.Bit4;
      b.sub = Sub.WaitForShutter;
      return;
    }
    ActorSetMotion(obj, Boss4Clip.Entrance);
    b.sub += 1;
    return;
  }

  if (b.sub === Sub.RideCarrier) {
    // `MOV AL, [0x009c721e]; TEST AL, AL; JZ` — the script's
    // `set_script_flag 30`, and the same flag the banner is waiting on.
    if (!G.g_script_flags[BOSS4_DROP_FLAG]) return;
    Boss4EntranceHold(b);
    b.flags &= ~Boss4Flag.OnCarrier;
    // `[diverges]` The engine now composes the transport's transform into the
    // actor's: `MatrixTranslate(carrier+0x40); MatrixRotateX/Y/Z(carrier+0x64
    // ..+0x6C); MatrixTranslate(obj+0x40); MatrixRotateX/Y/Z(obj+0x64..)`,
    // reads the result back into `obj+0x40` and decomposes the rotation with
    // `FUN_00401AE0`. That turns a pose expressed **in the transport's space**
    // into a world pose — the boss stops being carried and stands where it was
    // standing. The port does not do it, because `state+0x10` is
    // `g_civilian_carrier` and the port has no carrier actor for stage 4's
    // transport: `Boss4Init` latches `-1` and there is nothing to compose. The
    // spawn record's own position is used unchanged, which is where the engine
    // would have put it if the transport were at the origin. Visual, and it
    // does not touch the gate.
    Boss4SetMotionBlended(obj, Boss4Clip.Land);
    b.sub += 1;
    return;
  }

  if (b.sub !== Sub.WaitForShutter) return;

  // `if (obj+0x1B4 == 0x75 && obj+0x19C == 0x5A) FUN_004119A0(char, 0x74, 0,
  // 10)` — the landing settles into the standing pose on one exact frame.
  if (obj.motion === Boss4Clip.Land
      && MotionPlayFrame(obj) === LAND_SETTLE_FRAME) {
    Boss4SetMotionBlended(obj, Boss4Clip.Settle);
  }

  // `MOV AL, [0x009ca0f4]; CMP AL, BL` — and `BL` is 1, the same register the
  // flag write below stores. The shutter only reaches state 1 from
  // `BossIntroBannerUpdate`, 300 frames after `g_script_flags[30]`.
  if (G.g_bHudShutterState !== SHUTTER_OPENING) return;

  // `MOV byte ptr [0x009c721f], BL` at `0x0049390C`, and its twin at
  // `0x00493B99`. This is the gate.
  G.g_script_flags[BOSS4_FIGHT_READY_FLAG] = 1;
  // `FUN_004932A0(state+0x08)` — the phase cue. `[open]`, not ported.
  // `AND CH, 0x7F` — obj+0x34 &= ~0x8000, the bit `Boss4Init` raised.
  obj.flags &= ~0x8000;
  // `FUN_004932C0()` and `FUN_00435E50(320.0f, 35.0f)` — `[open]`, and both
  // are camera or effect work rather than state. Not ported.
  b.flags |= Boss4Flag.Placed | Boss4Flag.Bit4;
  b.state = Boss4State.WaitForCameraInRange;
  b.sub = 0;
  Boss4SetMotionBlended(obj, Boss4Clip.Idle, IDLE_FADE);
  // `MOV byte ptr [0x009ca0ea], BL` — `[open]`. One more byte raised on this
  // frame that nothing read so far reads back.
}

/**
 * `g_script_flags` — `0x009C7200`, index 30.
 *
 * The script's own `set_script_flag 30` — block 23 step 1 op 51, and the same
 * op in blocks 25, 27 and 29. It is read here at `0x0049397B` and by
 * `BossIntroBannerUpdate`, and it is the only flag in this chain the script
 * raises itself.
 */
export const BOSS4_DROP_FLAG = 30;

/**
 * `FUN_00493870`, called on the way out of subs 0 and 1 and by two more
 * states. `[open]` — not read, and not ported.
 *
 * Named here rather than inlined as a comment because the two entrance
 * routines both call it and a reader should see that the port skips one call,
 * not a line of arithmetic.
 */
function Boss4EntranceHold(b: Blk): void {
  void b;
}

/**
 * A blended motion set with the engine's own start frame of 0, as
 * `ActorSetMotionBlended` (`FUN_004119A0`) does it.
 *
 * `[port-only]` as a wrapper: `class30/motion_cue.ts`'s
 * `ZombieSetMotionIfIdle` is the port's blended setter and it draws a random
 * start frame, which is right for a crowd of zombies and wrong for a boss —
 * every one of this class's calls passes a literal `0` as the third argument
 * (`PUSH 0x0` before every `CALL 0x004119A0` in the range). One boss, one
 * pose, no spread.
 */
export function Boss4SetMotionBlended(obj: Actor, motion: number,
                                      fade = 10): void {
  if (obj.motion === motion) return;
  ActorStartFade(obj, obj.motion, obj.playTicks, fade);
  obj.motion = motion;
  obj.playTicks = 0;
  obj.rootFrame = -1;
}
