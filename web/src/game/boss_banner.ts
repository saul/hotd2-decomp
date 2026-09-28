/**
 * The boss-name banner — `BossIntroBannerSpawn` (`FUN_00437A70`) and
 * `BossIntroBannerUpdate` (`FUN_00437AC0`) — the tarot-card intro every boss
 * but the stage-3 one opens with.
 *
 * ## What it does
 *
 * A boss's entrance allocates it with a record (`boss_banner_records.ts`) and
 * forgets it. The banner then:
 *
 * 1. asks for asset slots `0x7ED` and `0x7EE` (the card backs, `etc_2.bin`) and
 *    **waits for a script flag** the record names -- 30 for stage 4, 2 for
 *    stage 1, 9 for stage 2 -- which the boss's own block sets;
 * 2. stashes the camera block's eye and look-at, raises
 *    `g_camera_driver_held` so `CameraDriverSelectMode` parks the camera
 *    driver, and lays out **eight cards** in camera space, one hundredth of a
 *    unit behind each other: card 0 is `0x7ED`, card 6 is the boss's own card
 *    (`+0x06`), the rest `0x7EE`;
 * 3. for eighty frames **flies the camera along its own `cp_` path** --
 *    `CamEvalPath7` straight into the camera block -- while cards 0..5 flip
 *    over in turn, each one re-stacked the frame it is edge-on;
 * 4. from frame 0x50 to the record's end frame (300), keeps flying, shrinks
 *    every card but the boss's to nothing, grows the boss's card from 0.03 to
 *    0.06 while sliding it across, and fades in the boss's **two name
 *    sprites** over sixty frames;
 * 5. on the end frame: `g_bHudShutterState = 1`, the camera driver let go and
 *    the camera block put back as it was, the slots freed, the task killed.
 *
 * Step 5's shutter write is what the class-0x19 and class-0x14 entrances wait
 * on, so the banner is on the path to their first script gate.
 *
 * ## What the port keeps
 *
 * All of the state and the camera flight, and the two name sprites. The cards
 * are plain data here -- position, yaw and scale per card, and the slot each
 * draws -- and `render/effects.ts` draws them from it in the camera's space,
 * which is where `MatrixLoadIdentity` puts them. The per-card
 * `CurlModelSlot7EEByYaw` (`FUN_004759C0`) call in step 2 bends the card
 * back's loaded model, slot `0x7EE`, by the card's yaw, so each back turns
 * over like a page; it is a rewrite of vertices and nothing the game reads, so
 * `render/card_curl.ts` does it from the yaw here. (It was read for a while as
 * slot `0x3F7` -- a model no stage loads -- off a record stride of 0x20, and
 * the cards were drawn flat.)
 *
 * ## Why this is a pool in `G`
 *
 * The engine allocates a task (`ActorAlloc(BossIntroBannerUpdate, 0x1314)`),
 * and a task runs where `ActorAlloc` appended it: after the boss that made it,
 * and after the camera tasks the scene made first. The director steps
 * {@link BossBannersTick} after the camera tasks for that reason, and the pool
 * is plain records so a snapshot carries a banner mid-flight.
 */
import { G } from "./globals";
import type { GameHost } from "./host";
import type { CamPose } from "./camera/curve";
import {
  BANNER_CARD_BACK, BANNER_CARD_BACK_FIRST, BOSS_INTRO_BANNERS,
  type BossIntroBannerRecord,
} from "./boss_banner_records";
import { vec3, type Vec3 } from "./vec";

export { BANNER_CARD_BACK, BANNER_CARD_BACK_FIRST } from "./boss_banner_records";

/** Eight cards, `CMP ECX, 0x8` at `0x00437BAE`; the boss's is the seventh. */
export const BANNER_CARDS = 8;
const BOSS_CARD = 6;
/** Only the first six flip, `CMP EDI, 0x6; JGE` at `0x00437C20`. */
const FLIPPING_CARDS = 6;
/** Card `i` starts flipping on frame `i * 5 + 15`, `LEA EAX, [EDI+EDI*4+0xF]`. */
const FLIP_START = 15;
const FLIP_STAGGER = 5;
/** The flip, BAMS a frame: `ADD EAX, 0xfffffd00` for card 0, `0xfffffe00` after. */
const FLIP_FIRST_STEP = -0x300;
const FLIP_STEP = -0x200;
/** Where a flip stops, `MOV EAX, 0xffff8000`. */
const FLIP_END = -0x8000;
/** The yaw a card is re-stacked on, `CMP [ESI+0xC], 0xffffbe00`. */
const FLIP_RESTACK = -0x4200;
/** Each card one hundredth behind the last -- `FMUL [0x004c4cc0]`, 0.01. */
const CARD_STACK = Math.fround(0.01);
/** Every card's first scale, `MOV EDX, 0x3cf5c28f` -- 0.03. */
const CARD_SCALE = Math.fround(0.03);
/** A card that is not the boss's shrinks by `[0x004e30e0]`, 0.005, a frame. */
const CARD_SHRINK = Math.fround(0.005);
/** The boss's grows by `[0x0055cb98]`, 0.001, to `[0x0055cb9c]`, 0.06. */
const BOSS_CARD_GROW = Math.fround(0.001);
const BOSS_CARD_SCALE = Math.fround(0.06);
/** ...and slides a thirtieth of the way a frame, `[0x0055e1c0]`. */
const BOSS_CARD_SLIDE = Math.fround(1 / 30);
/** The slide's length, `CMP EAX, 0x50` at `0x00437BE5`. */
const SLIDE_FRAMES = 0x50;
/** The names fade in over sixty frames, `FMUL [0x0055cb80]`, 1/60. */
const NAME_FADE = Math.fround(1 / 60);

/** The banner's `+0x00` step, as the routine's own switch names them. */
export enum BannerStep {
  /** Ask for the card backs, then test the flag at once. */
  Preload = 0,
  /** Stash the camera and lay the cards out. */
  Seat = 1,
  /** Frames 1..0x4F: fly, and flip. */
  Slide = 2,
  /** Frames 0x50..the end frame: fly, shrink, grow the boss's card, names. */
  Hold = 3,
  /** Waiting on `g_script_flags[record.flag]`. `MOV [EBP], 0x3e7`. */
  Waiting = 999,
}

/** One card, 0x14 bytes at `+0x08 + i*0x14`. */
export interface BannerCard {
  x: number;
  y: number;
  z: number;
  /** `+0x0C`, BAMS. */
  yaw: number;
  /** `+0x10`. */
  scale: number;
}

/** The banner's 0xE0-byte block, and the record it was given. */
export interface BossBanner {
  /** `+0x00` — {@link BannerStep}. */
  step: number;
  /** `+0x04` — the frame counter, stepped at the bottom of every call. */
  frame: number;
  /**
   * The record's address, the task's own `obj+0x130C`
   * (`MOV dword ptr [ESI + 0x130c], EAX` at `0x00437AA1`). A key into
   * {@link BOSS_INTRO_BANNERS} rather than the record itself, so a snapshot
   * carries a number.
   */
  rec: number;
  /** `+0x08`..`+0xA7`, eight cards. */
  cards: BannerCard[];
  /** `+0xA8`..`+0xC7`, the slot each card draws. */
  slots: number[];
  /** `+0xC8` — the camera block's eye as the banner found it. */
  savedEye: Vec3;
  /** `+0xD4` — and its look-at. */
  savedTarget: Vec3;
}

/**
 * `[port-only]` — the record a banner reads, from the key it holds. The first
 * stage-4 record stands in for a bad key.
 */
export function BannerRecord(b: BossBanner): BossIntroBannerRecord {
  return BOSS_INTRO_BANNERS[b.rec] ?? BOSS_INTRO_BANNERS[0x005972f8];
}

/**
 * `BossIntroBannerSpawn` — `FUN_00437A70`.
 * `ActorAlloc(BossIntroBannerUpdate, 0x1314)`, `ActorAllocSub(0xE0)` into
 * `+0x1310`, the record into `+0x130C`, and the block's first word cleared to
 * {@link BannerStep.Preload}. Appended to the pool, as `ActorAlloc` appends to
 * the task ring.
 */
export function BossIntroBannerSpawn(rec: number): BossBanner {
  const b: BossBanner = {
    step: BannerStep.Preload, frame: 0, rec,
    cards: Array.from({ length: BANNER_CARDS },
                      () => ({ x: 0, y: 0, z: 0, yaw: 0, scale: 0 })),
    slots: new Array<number>(BANNER_CARDS).fill(0),
    savedEye: vec3(), savedTarget: vec3(),
  };
  G.g_boss_banners.push(b);
  return b;
}

const _pose: CamPose = { eye: vec3(), target: vec3(), roll: 0 };

/**
 * `CamEvalPath7(record->camPath, (float)frame, &g_camera_block_eye,
 * &g_camera_block_target, &_, &_)` at `0x00437C13` and `0x00437D25`. The
 * camera block, straight off the banner's own path; the roll is thrown away.
 * A host with no paths leaves the block where it is, as
 * `GameOverCameraFlyTick` does.
 *
 * **Eye and target only, no angles.** `CamEvalPath7` writes six floats and
 * nothing else, and the banner never calls `CamBlockSetAnglesFromLookAt`
 * (`FUN_00403AC0`'s callers do not include it, and no instruction between
 * `0x00437AC0` and its `RET` names `0x009A60CC..D4`). The view is built from
 * the angles (`UpdateSceneViewAndLight`), so the card flight carries the eye
 * along the path and keeps the heading the camera had when the banner took
 * it; the path's target is written and nothing draws from it. `[proved]` The
 * view of a frame is built at its head, before the banner's task runs, so it
 * shows the eye the banner wrote the frame before.
 */
function BannerFlyCamera(rec: BossIntroBannerRecord, frame: number,
                         host: GameHost): void {
  const path = host.camPath?.(rec.camPath) ?? null;
  if (!path) return;
  path.pose(frame, false, _pose);
  G.g_camera_block_eye.x = _pose.eye.x;
  G.g_camera_block_eye.y = _pose.eye.y;
  G.g_camera_block_eye.z = _pose.eye.z;
  G.g_camera_block_target.x = _pose.target.x;
  G.g_camera_block_target.y = _pose.target.y;
  G.g_camera_block_target.z = _pose.target.z;
}

/**
 * `BossIntroBannerUpdate` — `FUN_00437AC0`. One banner, one 60 Hz frame.
 * Returns `false` on the frame it calls `ActorKill`, which is the frame it
 * opens the shutter.
 *
 * The frame counter is incremented at the bottom of every path but the kill
 * (`INC EAX; MOV [EBP+0x4], EAX` at `0x00437F0D`), including the ones that
 * only wait, so {@link BannerStep.Preload} and {@link BannerStep.Waiting} cost
 * a frame each too. {@link BannerStep.Seat} seeds the counter to 1 and falls
 * to that increment, which is why the slide is measured from 2.
 */
export function BossIntroBannerUpdate(b: BossBanner, host: GameHost): boolean {
  const rec = BannerRecord(b);
  switch (b.step) {
    case BannerStep.Preload:
      // `PUSH 0x7ed; CALL 0x0041d5d0` twice -- the card backs' load jobs,
      // the asset side's -- then `MOV [EBP], 0x3e7; JMP 0x00437d70`: **into**
      // the flag test, the same frame.
      b.step = BannerStep.Waiting;
      BannerTestFlag(b, rec);
      break;
    case BannerStep.Seat:
      BannerSeat(b, rec);
      break;
    case BannerStep.Slide:
      // `CMP EAX, 0x50; JZ 0x00437cea` -- the frame the slide is over it
      // becomes step 3 and runs step 3's body, `LAB_00437CF1`, at once.
      if (b.frame === SLIDE_FRAMES) {
        b.step = BannerStep.Hold;
        if (!BannerHold(b, rec, host)) return false;
        break;
      }
      BannerSlide(b, rec, host);
      break;
    case BannerStep.Hold:
      if (!BannerHold(b, rec, host)) return false;
      break;
    case BannerStep.Waiting:
      BannerTestFlag(b, rec);
      break;
    default:
      break;
  }
  // `0x00437E4D`: in steps 2 and 3, from frame 0x50, the two names.
  if (b.step >= BannerStep.Slide && b.step <= BannerStep.Hold
      && b.frame >= SLIDE_FRAMES) {
    BannerDrawNames(b, rec);
  }
  b.frame += 1;
  return true;
}

/** `0x00437D70`: `if (g_script_flags[record->flag]) step = 1`. */
function BannerTestFlag(b: BossBanner, rec: BossIntroBannerRecord): void {
  if (G.g_script_flags[rec.flag]) b.step = BannerStep.Seat;
}

/**
 * Step 1, `0x00437AF9`. Park the camera driver, stash the block, lay out the
 * cards, and move on.
 */
function BannerSeat(b: BossBanner, rec: BossIntroBannerRecord): void {
  // `MOV [0x009ca094], EAX` with EAX = 1.
  G.g_camera_driver_held = 1;
  const e = G.g_camera_block_eye;
  const t = G.g_camera_block_target;
  b.savedEye = { x: e.x, y: e.y, z: e.z };
  b.savedTarget = { x: t.x, y: t.y, z: t.z };
  b.frame = 1;
  for (let i = 0; i < BANNER_CARDS; i++) {
    const c = b.cards[i];
    c.x = rec.x;
    c.y = rec.y;
    // `FILD i; FMUL [0x004c4cc0]; FSUBR [EBX+0x10]; FSTP [EAX+0x8]`.
    c.z = Math.fround(rec.z - i * CARD_STACK);
    c.yaw = 0;
    c.scale = CARD_SCALE;
    b.slots[i] = i === 0 ? BANNER_CARD_BACK_FIRST
      : i === BOSS_CARD ? rec.cardSlot : BANNER_CARD_BACK;
  }
  b.step += 1;
}

/** Step 2, `0x00437BF2`: fly, and turn the first six cards over in turn. */
function BannerSlide(b: BossBanner, rec: BossIntroBannerRecord,
                     host: GameHost): void {
  BannerFlyCamera(rec, b.frame, host);
  for (let i = 0; i < FLIPPING_CARDS; i++) {
    // `CMP ECX, EAX; JL 0x00437c79` -- not started yet: skip the turn (the
    // engine still draws the card).
    if (b.frame < i * FLIP_STAGGER + FLIP_START) continue;
    const c = b.cards[i];
    c.yaw += i === 0 ? FLIP_FIRST_STEP : FLIP_STEP;
    if (c.yaw <= FLIP_END) c.yaw = FLIP_END;
    // Edge-on: re-stack it, `(8 - i) * 0.01` behind the layout's z.
    if (c.yaw === FLIP_RESTACK) {
      c.z = Math.fround(rec.z - (BANNER_CARDS - i) * CARD_STACK);
    }
  }
  // Then all eight are drawn -- `CurlModelSlot7EEByYaw(yaw)` (the card back's
  // page turn; see the file comment), identity, translate, yaw, scale,
  // `AssetDrawSlot(slot)` -- which `render/effects.ts` does from this state,
  // in its camera-space group. Step 3's loop draws without the curl.
}

/**
 * Step 3, `LAB_00437CF1`. Returns `false` on the end frame, where the engine
 * opens the shutter, puts the camera back and kills the task.
 */
function BannerHold(b: BossBanner, rec: BossIntroBannerRecord,
                    host: GameHost): boolean {
  if (b.frame === rec.endFrame) {
    // `MOV byte ptr [0x009ca0f4], 0x1` at `0x00437F1E` -- the only write in
    // the image that opens the shutter from inside a boss fight's entrance.
    G.g_bHudShutterState = 1;
    G.g_camera_driver_held = 0;
    Object.assign(G.g_camera_block_eye, b.savedEye);
    Object.assign(G.g_camera_block_target, b.savedTarget);
    // `AssetQueueUnloadSlot(0x7ED)`, `(0x7EE)`, `ActorKill`.
    return false;
  }
  BannerFlyCamera(rec, b.frame, host);
  for (let i = 0; i < BANNER_CARDS; i++) {
    const c = b.cards[i];
    if (i !== BOSS_CARD) {
      // `FSUB [0x004e30e0]; FST; FCOMP 0.0; TEST AH, 0x41` -- at or below
      // zero it is zero. The comparison is on the unrounded difference.
      const s = c.scale - CARD_SHRINK;
      c.scale = s <= 0 ? 0 : Math.fround(s);
      continue;
    }
    // `FCOMP [0x0055cb9c]; TEST AH, 0x1; JZ` -- grow only while under 0.06.
    if (!(c.scale < BOSS_CARD_SCALE)) continue;
    const s = c.scale + BOSS_CARD_GROW;
    c.scale = Math.fround(s);
    if (s > BOSS_CARD_SCALE) {
      // Overshot: pin the scale and the card where it was going.
      c.scale = BOSS_CARD_SCALE;
      c.x = rec.toX;
      c.y = rec.toY;
    } else {
      // `FLD [EBX+0x14]; FSUB [EBX+0x8]; FMUL [0x0055e1c0]; FADD [ESI];
      // FSTP [ESI]` -- one rounding, at the store.
      c.x = Math.fround(c.x + (rec.toX - rec.x) * BOSS_CARD_SLIDE);
      c.y = Math.fround(c.y + (rec.toY - rec.y) * BOSS_CARD_SLIDE);
    }
  }
  return true;
}

/**
 * The names, `0x00437E6E`: two `SpriteDrawCheckedBank` (`FUN_0041C630`)
 * records straight out of the record, scale 1, flags 0 -- so `(x, y)` is the
 * top-left -- and an alpha of `(frame - 0x50) / 60`, capped at 1.0.
 */
function BannerDrawNames(b: BossBanner, rec: BossIntroBannerRecord): void {
  const f = Math.fround((b.frame - SLIDE_FRAMES) * NAME_FADE);
  const alpha = f < 1 ? f : 1;
  for (const n of rec.names) {
    G.g_screen_sprite_draws.push({
      id: n.sprite, x: n.x, y: n.y, depth: n.depth, sx: 1, sy: 1, alpha,
      flags: 0,
    });
  }
}

/**
 * `[port-only]` — the banner tasks, stepped in creation order. A banner that
 * kills itself leaves the pool here.
 */
export function BossBannersTick(host: GameHost): void {
  if (G.g_boss_banners.length === 0) return;
  G.g_boss_banners = G.g_boss_banners.filter(
    (b) => BossIntroBannerUpdate(b, host));
}
