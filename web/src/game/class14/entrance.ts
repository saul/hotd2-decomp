/**
 * Class 0x14's three entrances: `g_class14_states[0..4]`. Each ends the same
 * way -- the shutter reaches 1, the boss latches where it stands, joins the
 * shot test and the route steering, and the fight begins -- and each gets to
 * the shutter differently:
 *
 * * **A** (states 0 and 3, stage 2 blocks 35 and 39) spawns the boss-name
 *   banner with record `0x005966B8`, climbs out of the water and raises
 *   `g_script_flags[9]` -- the flag the banner waits on. The banner flies the
 *   camera for 300 frames and then sets `g_bHudShutterState = 1`.
 * * **B** (states 1 and 4, blocks 37 and 41) spawns banner `0x005966F8`.
 *   State 1 hides the model and waits for `g_script_flags[0x5F]`, which block
 *   37 raises itself; state 4 is already up.
 * * **C** (state 2, stage 5 block 3) spawns no banner and waits for
 *   `g_script_flags[11]`; stage 5's own script sets the shutter.
 *
 * All three `[proved]` from their decompilations; the case fall-throughs
 * (A's 3 into 4, B's and C's 4 into 5, C's 0 into 1) are the engine's own.
 */
import type { Actor, Boss2Actor } from "../actor";
import { ActorFlag, MotionFlag } from "../actor";
import { BossIntroBannerSpawn } from "../boss_banner";
import { BossHpBarSpawn } from "../boss_hp_bar";
import { ActorSetMotion, ActorSetMotionBlended } from "../class30/motion_cue";
import { G } from "../globals";
import type { ClassFrame } from "../registry";
import { OBJ_BIT_80000, Class14Flag, Class14Phase, Class14State,
  type Boss2Tail } from "./state";
import {
  Class14BlendAnim, Class14ClipLength, Class14Counter, Class14Cursor,
  Class14SetAnim, Class14Sound as Sound,
} from "./motion";
import {
  CLASS14_FLAG_BANNER, CLASS14_FLAG_ENTRANCE_B_GO, CLASS14_FLAG_INTRO_DONE,
  CLASS14_FLAG_ROUND_B_OPEN, CLASS14_SHUTTER_OPEN, Class14Sound,
} from "./tables";

/** The two banner records, `.rdata`, by address. */
const BANNER_A = 0x005966b8;
const BANNER_B = 0x005966f8;
/** `BossHpBarSpawn(320.0f, 35.0f)` — `PUSH 0x420C0000; PUSH 0x43A00000`. */
const BAR_X = 320;
const BAR_Y = 35;
/** `g_screen_shake_frames = 0x30` and the thirty frames B and C then wait. */
const SHAKE_FRAMES = 0x30;
const RISE_DELAY = 0x1e;
/** The literal motions B and C play: `0x20` hidden, `0x26` up, `0x27` settle. */
const MOTION_HIDDEN = 0x20;
const MOTION_UP = 0x26;
const MOTION_SETTLE = 0x27;
/** The cursor frames the entrances cue on. */
const CUE_SURFACE = 0x1e;
const CUE_GROWL = 0x37;
const CUE_SETTLE = 0x5a;
/** `char+0x00 == 0x4B` — the breath, by the frame counter, not the cursor. */
const CUE_BREATH = 0x4b;
/** `obj+0x34 |= 0x8C000` — `0x80000`, not in the shot test, pose frozen. */
const HIDDEN_BITS = OBJ_BIT_80000 | ActorFlag.NoShotTest | ActorFlag.PoseFrozen;

/**
 * The hand-over, `0x0047833A` (A), `0x004785C3` (B), `0x004787F6` (C):
 *
 * ```c
 * state = 5; sub = 0; target = pos;
 * obj+0x34 &= ~0x8000; state->flags &= ~1;
 * [A, B] g_script_flags[10] = 1;
 * BossHpBarSpawn(320.0, 35.0);
 * [A, B] g_boss_engaged = 1;
 * ```
 *
 * `[port-only]` as a function; the three copies differ only in the two
 * bracketed lines.
 */
function Class14EntranceHandOver(obj: Actor, t: Boss2Tail,
                                 stage2: boolean): void {
  t.state = Class14State.Hunt;
  t.sub = 0;
  t.target.x = obj.pos.x;
  t.target.y = obj.pos.y;
  t.target.z = obj.pos.z;
  obj.flags &= ~ActorFlag.NoShotTest;
  t.flags &= ~Class14Flag.OffRoute;
  if (stage2) G.g_script_flags[CLASS14_FLAG_INTRO_DONE] = 1;
  BossHpBarSpawn(BAR_X, BAR_Y);
  if (stage2) G.g_boss_engaged = 1;
}

/**
 * The model hidden (`char+0x64 &= ~1`, part 0's draw byte 0) and shown again:
 * what B's and C's sub 0 and sub 2 do to the draw.
 */
function Class14ShowModel(obj: Actor, shown: boolean): void {
  if (!obj.skel) return;
  if (shown) obj.motionFlags |= MotionFlag.Drawn;
  else obj.motionFlags &= ~MotionFlag.Drawn;
  obj.skel.part0 = shown ? 1 : 0;
}

/**
 * B's and C's sub 2, `0x00478496` / `0x004786EC`: the thirty-frame countdown
 * after the shake, then the model comes up -- shown, back in the shot test,
 * its pose running.
 */
function Class14EntranceRise(obj: Actor, t: Boss2Tail): void {
  const v = t.counter0;
  t.counter0 = v - 1;
  if (v !== 0) return;
  obj.flags &= ~(ActorFlag.NoShotTest | ActorFlag.PoseFrozen);
  Class14ShowModel(obj, true);
  t.sub += 1;
}

/**
 * `Class14StateEntranceA` — `FUN_00478160`. `g_class14_states[0]` and `[3]`.
 *
 * ```
 * sub 0: BossIntroBannerSpawn(0x005966B8); phase = 0
 *        state 3: anim 0xE (set); flag 9; obj+0x34 &= ~0x20000; BOMB2; sub = 3
 *        else:    anim 0x13 (set); sub++
 * sub 1: cursor 0x1E: obj+0x34 &= ~0x20000; BOMB2; sub++
 * sub 2: cursor == len: anim 0xE (blend 0, 10); flag 9; sub++
 * sub 3: cursor 0x37: ZOMBIE_007 / 0x5A: anim 0xF (blend); sub++   (into 4)
 * sub 4: counter 0x4B: ZOMBIE_002;  shutter 1: the hand-over
 * every frame: flipbook A at its low end with no hold: HERTBEAT
 * ```
 */
export function Class14StateEntranceA(obj: Boss2Actor, f: ClassFrame): void {
  const t = obj.boss2;
  switch (t.sub) {
    case 0:
      BossIntroBannerSpawn(BANNER_A);
      t.phase = Class14Phase.ShortOpen;
      if (t.state === Class14State.Entrance3) {
        Class14SetAnim(obj, t, 0xe);
        G.g_script_flags[CLASS14_FLAG_BANNER] = 1;
        obj.flags &= ~ActorFlag.Airborne;
        Sound(f.events, Class14Sound.Bomb);
        t.sub = 3;
      } else {
        Class14SetAnim(obj, t, 0x13);
        t.sub += 1;
      }
      break;
    case 1:
      if (Class14Cursor(obj) === CUE_SURFACE) {
        obj.flags &= ~ActorFlag.Airborne;
        Sound(f.events, Class14Sound.Bomb);
        t.sub += 1;
      }
      break;
    case 2:
      if (Class14Cursor(obj) === Class14ClipLength(obj)) {
        Class14BlendAnim(obj, t, 0xe);
        G.g_script_flags[CLASS14_FLAG_BANNER] = 1;
        t.sub += 1;
      }
      break;
    case 3:
    case 4:
      if (t.sub === 3) {
        const c = Class14Cursor(obj);
        if (c === CUE_GROWL) {
          Sound(f.events, Class14Sound.Growl);
        } else if (c === CUE_SETTLE) {
          Class14BlendAnim(obj, t, 0xf);
          t.sub += 1;
        }
      }
      if (Class14Counter(obj) === CUE_BREATH) {
        Sound(f.events, Class14Sound.Breath);
      }
      if (G.g_bHudShutterState === CLASS14_SHUTTER_OPEN) {
        Class14EntranceHandOver(obj, t, true);
      }
      break;
    default:
      break;
  }
  if (t.bookA.frame === t.bookA.low && t.bookA.hold === 0) {
    Sound(f.events, Class14Sound.Heartbeat);
  }
}

/**
 * `Class14StateEntranceB` — `FUN_004783B0`. `g_class14_states[1]` and `[4]`.
 *
 * ```
 * sub 0: BossIntroBannerSpawn(0x005966F8); phase = 3
 *        state 4: set(0x26); flag 9; ZOMBIE_007; sub = 4
 *        else: set(0x20); obj+0x34 |= 0x8C000; hide the model; sub++
 * sub 1: g_script_flags[0x5F]: g_screen_shake_frames = 0x30; +0x9C = 0x1E; sub++
 * sub 2: +0x9C-- == 0: obj+0x34 &= ~0xC000; show the model; sub++
 * sub 3: cursor == len: blend(0x26, 0, 10); obj+0x34 &= ~0x80000; flag 9;
 *        ZOMBIE_007; sub++
 * sub 4: cursor 0x37: ZOMBIE_007 / 0x5A: blend(0x27, 0, 10); sub++  (into 5)
 * sub 5: counter 0x4B: ZOMBIE_002;  shutter 1: the hand-over
 * every frame: sub > 2 and flipbook A at its low end with a hold of 1: HERTBEAT
 * ```
 *
 * **B's rise leaves the boss shootable before the fight starts**: sub 2
 * clears `0x8000` along with the pose freeze, so from the frame it surfaces
 * until the hand-over its weak point is in the shot test. A never clears it
 * before the hand-over.
 */
export function Class14StateEntranceB(obj: Boss2Actor, f: ClassFrame): void {
  const t = obj.boss2;
  switch (t.sub) {
    case 0:
      BossIntroBannerSpawn(BANNER_B);
      t.phase = Class14Phase.LongOpen;
      if (t.state === Class14State.Entrance4) {
        ActorSetMotion(obj, MOTION_UP);
        G.g_script_flags[CLASS14_FLAG_BANNER] = 1;
        Sound(f.events, Class14Sound.Growl);
        t.sub = 4;
      } else {
        ActorSetMotion(obj, MOTION_HIDDEN);
        obj.flags |= HIDDEN_BITS;
        Class14ShowModel(obj, false);
        t.sub += 1;
      }
      break;
    case 1:
      if (G.g_script_flags[CLASS14_FLAG_ENTRANCE_B_GO]) {
        G.g_screen_shake_frames = SHAKE_FRAMES;
        t.counter0 = RISE_DELAY;
        t.sub += 1;
      }
      break;
    case 2:
      Class14EntranceRise(obj, t);
      break;
    case 3:
      if (Class14Cursor(obj) === Class14ClipLength(obj)) {
        ActorSetMotionBlended(obj, MOTION_UP, 0, 10);
        obj.flags &= ~OBJ_BIT_80000;
        G.g_script_flags[CLASS14_FLAG_BANNER] = 1;
        Sound(f.events, Class14Sound.Growl);
        t.sub += 1;
      }
      break;
    case 4:
    case 5:
      Class14EntranceSettle(obj, t, f, true);
      break;
    default:
      break;
  }
  if (t.sub > 2 && t.bookA.frame === t.bookA.low && t.bookA.hold === 1) {
    Sound(f.events, Class14Sound.Heartbeat);
  }
}

/**
 * B's and C's sub 4 falling into sub 5, `0x00478571` / `0x004787A6`: the
 * growl and the settle on their cursor frames, then the breath and the
 * hand-over. `[port-only]` as a function; the two copies differ in whether
 * the hand-over is stage 2's.
 */
function Class14EntranceSettle(obj: Actor, t: Boss2Tail, f: ClassFrame,
                               stage2: boolean): void {
  if (t.sub === 4) {
    const c = Class14Cursor(obj);
    if (c === CUE_GROWL) {
      Sound(f.events, Class14Sound.Growl);
    } else if (c === CUE_SETTLE) {
      ActorSetMotionBlended(obj, MOTION_SETTLE, 0, 10);
      t.sub += 1;
    }
  }
  if (Class14Counter(obj) === CUE_BREATH) Sound(f.events, Class14Sound.Breath);
  if (G.g_bHudShutterState === CLASS14_SHUTTER_OPEN) {
    Class14EntranceHandOver(obj, t, stage2);
  }
}

/**
 * `Class14StateEntranceC` — `FUN_00478640`. `g_class14_states[2]`, stage 5's
 * cameo.
 *
 * ```
 * sub 0: set(0x20); obj+0x34 |= 0x8C000; hide the model; phase = 8; sub++  (into 1)
 * sub 1: g_script_flags[11]: shake 0x30; +0x9C = 0x1E; sub++
 * sub 2: as B's
 * sub 3: cursor == len: blend(0x26, 0, 10); obj+0x34 &= ~0x80000; ZOMBIE_007; sub++
 * sub 4/5: as B's, but the hand-over raises no flag and leaves g_boss_engaged
 * every frame: as B's heartbeat
 * ```
 *
 * No banner: stage 5 block 3 sets the shutter itself (`set_hud_shutter_state
 * 1` at `0x002268`). Flag 11 is block 3's own `set_script_flag 0x0B`.
 */
export function Class14StateEntranceC(obj: Boss2Actor, f: ClassFrame): void {
  const t = obj.boss2;
  switch (t.sub) {
    case 0:
    case 1:
      if (t.sub === 0) {
        ActorSetMotion(obj, MOTION_HIDDEN);
        obj.flags |= HIDDEN_BITS;
        Class14ShowModel(obj, false);
        t.phase = Class14Phase.Stage5Open;
        t.sub += 1;
      }
      if (G.g_script_flags[CLASS14_FLAG_ROUND_B_OPEN]) {
        G.g_screen_shake_frames = SHAKE_FRAMES;
        t.counter0 = RISE_DELAY;
        t.sub += 1;
      }
      break;
    case 2:
      Class14EntranceRise(obj, t);
      break;
    case 3:
      if (Class14Cursor(obj) === Class14ClipLength(obj)) {
        ActorSetMotionBlended(obj, MOTION_UP, 0, 10);
        obj.flags &= ~OBJ_BIT_80000;
        Sound(f.events, Class14Sound.Growl);
        t.sub += 1;
      }
      break;
    case 4:
    case 5:
      Class14EntranceSettle(obj, t, f, false);
      break;
    default:
      break;
  }
  if (t.sub > 2 && t.bookA.frame === t.bookA.low && t.bookA.hold === 1) {
    Sound(f.events, Class14Sound.Heartbeat);
  }
}
