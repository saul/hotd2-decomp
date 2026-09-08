/**
 * The boss-name banner — `BossIntroBannerUpdate` (`FUN_00437AC0`) — and the
 * reason class 0x19's `g_script_flags[31]` is not immediate.
 *
 * The gate chain in stage 4's blocks 23, 25, 27 and 29 is three links long and
 * only the first of them is in the script:
 *
 * ```
 *   set_script_flag 30            evt op 0x48, block 23 step 1 op 51
 *     -> BossIntroBannerUpdate    300 frames, then g_bHudShutterState = 1
 *        -> Boss4StateEntranceCarried sub 2, which raises g_script_flags[31]
 *   wait_script_flag 31           evt op 0x45, block 23 step 1 op 53
 * ```
 *
 * The middle link is easy to miss, because the banner is not a spawn: the
 * boss's own entrance allocates it with `BossIntroBannerSpawn`
 * (`FUN_00437A70`), which hands `FUN_004A6FA0` the update function directly
 * rather than a class id. Its write at `0x00437F1E` is **the only instruction
 * in the image that puts the shutter into state 1 from inside a stage** —
 * `EvtOpSetHudShutterState1F` issues 77 ones across the six scripts and not
 * one of them is in a class-0x19 block — so without it the boss's
 * `CMP AL, BL` at `0x004938FD` can never be true and the fight never starts.
 *
 * ## What the port keeps, and what it does not
 *
 * The banner is screen furniture: eight sprites built from asset slots `0x7ED`
 * and `0x7EE`, slid in along a camera path over eighty frames, held, and faded
 * out on a scale that walks down by 0.005 a frame, with the camera block
 * stashed and restored around the whole thing. **None of that is ported** and
 * the player draws no banner. What is ported is its lifetime and its one
 * write, which is the whole of the gate — the same split class 0x60's chapter
 * card is under.
 */
import { G } from "../globals";
import type { Boss4BannerState } from "./state";

/**
 * One `g_boss4_intro_banners` record — `0x005972F8`, stride 0x40, two of them.
 *
 * Read out of `.rdata`:
 * `1e00 b500 2c01 7318 …` and `1e00 bd00 2c01 7318 …`, so the two differ only
 * in the camera path. The four floats after the header are the sprite fade's
 * and nothing here reads them.
 */
export interface Boss4BannerRecord {
  /** `+0x00` s16 — the script flag the banner waits for. 30 for both. */
  flag: number;
  /** `+0x02` s16 — the camera path it slides along. 181 and 189. `[open]` */
  camPath: number;
  /** `+0x04` s16 — the frame it ends on and sets the shutter. 300 for both. */
  endFrame: number;
  /** `+0x06` s16 — a message id, `0x1873`. Not read here. `[open]` */
  message: number;
}

/**
 * `g_boss4_intro_banners` — `0x005972F8`. Entry 0 is what
 * `Boss4StateEntranceCarried` passes and entry 1 is
 * `Boss4StateEntranceDropped`'s (`PUSH 0x5972f8` at `0x00493A9A`,
 * `PUSH 0x597338` in the other).
 */
export const BOSS4_INTRO_BANNERS: readonly Boss4BannerRecord[] = [
  { flag: 30, camPath: 181, endFrame: 300, message: 0x1873 },
  { flag: 30, camPath: 189, endFrame: 300, message: 0x1873 },
];

/** The frame the slide-in ends on — `CMP dword ptr [ECX + 0x4], 0x50`. */
const BANNER_SLIDE_FRAMES = 0x50;

/** The banner's `+0x00` step values, as the routine's own switch names them. */
enum BannerStep {
  /** Ask for slots `0x7ED`/`0x7EE`, then fall to {@link BannerStep.Waiting}. */
  Preload = 0,
  /** Seat the sprites and the stashed camera block. */
  Seat = 1,
  /** The slide, frames 1..0x50. */
  Slide = 2,
  /** The hold and fade, to the record's end frame. */
  Hold = 3,
  /** Waiting on `g_script_flags[record.flag]`. */
  Waiting = 999,
}

/**
 * `BossIntroBannerSpawn` — `FUN_00437A70`. Allocate the banner.
 *
 * `FUN_004A6FA0(BossIntroBannerUpdate, 0x1314)` for the task, `FUN_004A7400`
 * for a 0xE0-byte block at `+0x1310`, the caller's record at `+0x130C`, and
 * the block's first word cleared to {@link BannerStep.Preload}.
 *
 * `[diverges]` The port returns the block instead of allocating a task; see
 * `Boss4Block.banner` for why the boss drives it.
 */
export function BossIntroBannerSpawn(rec: number): Boss4BannerState {
  return { step: BannerStep.Preload, frame: 0, rec };
}

/**
 * `BossIntroBannerUpdate` — `FUN_00437AC0`. One banner, one 60 Hz frame.
 *
 * Returns `true` on the frame it kills itself, which is the frame it sets the
 * shutter.
 *
 * The frame counter is incremented at the **bottom** of every path
 * (`INC dword ptr [ECX + 0x4]` at `0x00437E63`), including the ones that
 * return early, so `Preload` and `Waiting` cost a frame each too. Step 1 seeds
 * the counter to 1 and falls through to that increment, which is why the slide
 * is measured from 2.
 */
export function BossIntroBannerUpdate(b: Boss4BannerState): boolean {
  const rec = BOSS4_INTRO_BANNERS[b.rec] ?? BOSS4_INTRO_BANNERS[0];
  let killed = false;
  switch (b.step) {
    case BannerStep.Preload:
      // `FUN_0041D5D0(0x7ED)` and `FUN_0041D5D0(0x7EE)` — the two asset slots
      // the sprites are drawn from. `[port-only]` nothing draws them here.
      b.step = BannerStep.Waiting;
      break;
    case BannerStep.Seat:
      // The engine stashes the camera block into `+0xC8..+0xDC`, seeds the
      // frame and builds eight sprites, each one hundredth of a unit behind
      // the last. Only the frame survives the port.
      b.frame = 1;
      b.step = BannerStep.Slide;
      break;
    case BannerStep.Slide:
      // `if (frame != 0x50) { draw; return; }` — on the frame it reaches the
      // slide length it becomes step 3 **and falls straight into step 3's
      // body**: the `JMP LAB_00437CF1` at `0x00437CEF` is into the middle of
      // step 3, not to the top of the switch. `noFallthroughCasesInSwitch`
      // will not let that be written as a fallthrough, so the shared tail is
      // its own function and both arms call it.
      if (b.frame !== BANNER_SLIDE_FRAMES) break;
      b.step = BannerStep.Hold;
      killed = BossIntroBannerHold(b, rec);
      break;
    case BannerStep.Hold:
      killed = BossIntroBannerHold(b, rec);
      break;
    case BannerStep.Waiting:
      // `if (g_script_flags[record->flag] != 0) step = 1`. Both records name
      // flag 30, which is the `set_script_flag 30` in the boss's own block.
      if (G.g_script_flags[rec.flag]) b.step = BannerStep.Seat;
      break;
    default:
      break;
  }
  b.frame += 1;
  return killed;
}

/**
 * `LAB_00437CF1` — step 3's body, and the two ways in.
 *
 * `if (frame != record->endFrame) { draw and fade; return; }`, and on the
 * frame it is: `MOV byte ptr [0x009ca0f4], 0x1` at `0x00437F1E`, then the
 * camera block is put back, slots `0x7ED`/`0x7EE` are freed and `FUN_004A7040`
 * — `ActorKill` — ends the task. Only the first of those four survives the
 * port, and it is the one the gate needs.
 */
function BossIntroBannerHold(b: Boss4BannerState,
                             rec: Boss4BannerRecord): boolean {
  if (b.frame !== rec.endFrame) return false;
  G.g_bHudShutterState = 1;
  return true;
}
