/**
 * What comes out of a broken container.
 *
 * This is the payoff of the whole class. `BreakablePropUpdate` decrements
 * `g_item_set_countdown` for the set the prop belongs to, and when that
 * reaches zero it switches on the set id — three arms, three different things
 * to release. The countdown was seeded with `rand() % n + 1`, so it is a
 * *random* one of the set's props that pays out, not the last.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { G } from "../globals";
import { ScoreAddForPlayer } from "../combat/score";
import { GameMode } from "../game_mode";
import { CameraBlockEye } from "../camera/view";
import { COLLECTIBLE_WORDS_ZERO, PickOriginalModeItem } from "./original_item";
import { PropWords } from "./words";
import {
  BreakableFlag, BreakableState, ItemSet, makeBreakableProp, PropFamily,
  type BreakableProp,
} from "./prop_state";
import {
  MatrixRotateX, MatrixRotateY, MatrixScale, MatrixTranslate,
} from "../matrix";
import { T } from "../tables";
import {
  LightsRestoreScene, LightsUseSecondarySet, RenderLightSet,
} from "../light_sets";
import {
  PropDrawBegin, PropDrawSlot, PropDrawSlotWithAlpha, PropMatrixClearRotation,
  PropMatrixPush,
} from "./prop_draw";
import { PropExpireByStepLifetime } from "./lifetime";
import { ActorDespawnProp, BreakablePropAwardHit } from "./prop";
import { PropRegisterForShotTest } from "./shot_test";
import { SpawnGoldenFrog } from "./golden_frog";

// The golden frog, item set 3, is an actor of its own: see `golden_frog.ts`.
export { GOLDEN_FROG_CHAR_TYPE, SpawnGoldenFrog } from "./golden_frog";

/** How far above the prop the extra life is released. */
export const EXTRA_LIFE_RISE = 1.0;

/** `PlaySoundId` id for taking the extra life. */
export const SFX_EXTRA_LIFE = 0x3616a9;

/** `PUSH 0x12c` — the score `GrantExtraLife` pays at the life cap. */
export const EXTRA_LIFE_CAP_SCORE = 300;

/**
 * `GrantExtraLife` — `FUN_00415630`.
 *
 * ```
 * 00415630  if (g_GameMode == 1) cap = (s8)g_original_life_cap[p];   0x009A2245 + p*0x14
 *           else                 cap = g_max_lives;                 0x009A2440
 *           if ((s16)g_player_lives[p] >= cap) { ScoreAddForPlayer(p, 300); return 0; }
 * 004156b1  g_player_lives[p] += 1; return 1;
 * ```
 *
 * One more life, unless the player already has the cap's worth -- in which
 * case 300 points instead, through `ScoreAddForPlayer`, so it is never simply
 * wasted. No sound here: the callers play their own, or none. `[proved]`
 */
export function GrantExtraLife(player: number, events?: Events): boolean {
  const lives = G.g_player_lives[player] ?? 0;
  const cap = G.g_GameMode === GameMode.Original
    ? (G.g_original_life_cap[player] ?? 0) : G.g_max_lives;
  if (lives >= cap) {
    ScoreAddForPlayer(player, EXTRA_LIFE_CAP_SCORE, events);
    return false;
  }
  G.g_player_lives[player] = lives + 1;
  return true;
}

/**
 * `SpawnExtraLifePickup` — `FUN_00471BD0`. Item set 1: the extra life, an
 * object of its own running {@link ExtraLifePickupUpdate}.
 *
 * ```c
 * q = ActorAlloc(ExtraLifePickupUpdate, 0x378);  ActorClearGameFields(q);
 * q+0x34 = 0x80000001;  q+0x19C = x;  q+0x1A0 = y + 1.0;  q+0x1A4 = z;
 * q+0x1D0 = (s16)ftol(atan2(x - eye.x, z - eye.z) * 32768/pi) + 0x8000;
 * if (g_scene_index == 5) q+0x1D0 = 0x8000;
 * q+0x197 = p+0x197;  q+0x196 = p+0x196;  q+0x11C = p+0x11C;
 * q+0x2A0 = 0;  q+0x124 = 4.0;
 * ```
 *
 * It inherits the prop's step counters and its `+0x11C`, so it ages on the
 * prop's clock, and plays nothing: the life's sound is its own, when it is
 * shot. `ActorAlloc` appends it to the task list the prop is on, so it runs
 * on the frame it is made. It has no `g_class41_updates` entry, so the port
 * files it as a generic prop of {@link EXTRA_LIFE_ROUTINE_TYPE} and the pool
 * runs it through that row (`class41/generic_routines.ts`).
 *
 * The `item.released` event is the port's own notice for its feed.
 */
export function SpawnExtraLifePickup(p: BreakableProp, events?: Events): void {
  const q = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  q.family = PropFamily.Generic;
  q.kind = EXTRA_LIFE_ROUTINE_TYPE;
  q.flags = EXTRA_LIFE_FLAGS;
  q.state = BreakableState.Standing;
  q.x = p.x;
  q.y = Math.fround(p.y + EXTRA_LIFE_RISE);
  q.z = p.z;
  // `FPATAN; FMUL g_rad_to_bams; __ftol; MOVSX; ADD 0x8000`, off the eye of
  // the camera block `g_camera_index` names.
  const eye = CameraBlockEye(G.g_camera_index);
  const b = Math.trunc(Math.atan2(p.x - eye.x, p.z - eye.z)
                       * STORY_ITEM_RAD_TO_BAMS);
  q.yaw = ((b << 16) >> 16) + 0x8000;
  if (G.g_scene_index === EXTRA_LIFE_FIXED_YAW_SCENE) q.yaw = 0x8000;
  q.stepsElapsed = p.stepsElapsed;
  q.lastStepIndex = p.lastStepIndex;
  q.lifetime = PropWord11C(p);
  q.storyItem = 0;
  q.hitRadius = EXTRA_LIFE_RADIUS;
  G.g_breakable_props.push(q);
  events?.emit("item.released", {
    set: ItemSet.ExtraLife, from: p.id, x: q.x, y: q.y, z: q.z,
  });
}

/**
 * `[port-only]` -- the routine number the port files the pickup under: the
 * engine's object carries `ExtraLifePickupUpdate` itself, and the routine is
 * in no `g_class41_updates` slot (that table's 79 entries end at
 * `0x00471BA0`).
 */
export const EXTRA_LIFE_ROUTINE_TYPE = 0x100;
/** `MOV dword ptr [EAX + 0x34], 0x80000001` — live, and bit 31. */
const EXTRA_LIFE_FLAGS = 0x80000001;
/** `MOV dword ptr [EAX + 0x124], 0x40800000` — its sphere, 4.0. */
const EXTRA_LIFE_RADIUS = 4.0;
/** `CMP [g_scene_index], 5` — stage 6, where it faces a fixed way. */
const EXTRA_LIFE_FIXED_YAW_SCENE = 5;

/** `obj+0x34` bit 30 — taken: the life has been paid. */
const EXTRA_LIFE_TAKEN = 0x40000000;
/** `AssetDrawSlot(0x10C3)` — the heart, drawn three times its size. */
export const EXTRA_LIFE_HEART_SLOT = 0x10c3;
const EXTRA_LIFE_HEART_RISE = 1.5;
const EXTRA_LIFE_HEART_SCALE = 3.0;
/** Drawn plainly for this many frames of `+0x2A0`, then fading by 0.02 a frame. */
const EXTRA_LIFE_FADE_FROM = 0x19;
const EXTRA_LIFE_FADE_STEP = 0.02;
/** `+0x2A0 > 0x31`: the pickup strip has played, and the object goes. */
const EXTRA_LIFE_LAST_FRAME = 0x31;
/** The two players' pickup strips, `0x116A + 50 * player`, and tags `0x1256 + player`. */
export const EXTRA_LIFE_STRIP_SLOT = 0x116a;
export const EXTRA_LIFE_STRIP_STRIDE = 0x32;
export const EXTRA_LIFE_TAG_SLOT = 0x1256;
/** The tag rises 0.05 a frame (`obj+0x2C0`) from four units above, at half the heart's scale. */
const EXTRA_LIFE_TAG_RISE = 4.0;
const EXTRA_LIFE_TAG_CLIMB = 0.05;
const EXTRA_LIFE_TAG_SCALE = 1.5;
/** `obj+0x70..0x78`: the shot sphere's centre, three units above. */
const EXTRA_LIFE_SHOT_RISE = 3.0;

/**
 * `ExtraLifePickupUpdate` — `FUN_00471CC0`. The extra life: the heart turning
 * to the camera until it is shot or its prop's lifetime runs out.
 *
 * Shot (`obj+0x34` bit 3, not yet taken): no points (`BreakablePropAwardHit`
 * with 0), the taken bit, `0x3616A9`, and `GrantExtraLife` for whoever fired
 * -- player 0 if its bit alone is set, player 1 if its alone, `rand() % 2`
 * if both -- with that player's strip and tag. Then `+0x2A0` counts the
 * pickup: the heart is drawn faded from frame `0x19`, the tag rises above
 * it, the strip plays beside it, and past frame `0x31` the object goes.
 *
 * The hit bit is not cleared and the sphere is registered every frame; the
 * taken bit is what stops a second life.
 */
export function ExtraLifePickupUpdate(p: BreakableProp, rng: Rng,
                                      events?: Events): void {
  PropDrawBegin(p);
  if (PropExpireByStepLifetime(p)) return;
  const f = p.flags;
  if ((f & EXTRA_LIFE_TAKEN) === 0 && (f & BreakableFlag.Hit) !== 0) {
    BreakablePropAwardHit(f, false, rng);
    p.flags |= EXTRA_LIFE_TAKEN;
    events?.emit("sound.play", { id: SFX_EXTRA_LIFE });
    p.storyItem = 1;
    const p0 = (p.flags & BreakableFlag.HitByPlayer0) !== 0;
    if (!p0 || (p.flags & BreakableFlag.HitByPlayer1) === 0) {
      const who = p0 ? 0 : 1;
      GrantExtraLife(who, events);
      p.slot = EXTRA_LIFE_STRIP_SLOT + EXTRA_LIFE_STRIP_STRIDE * who;
      p.removeFlag = EXTRA_LIFE_TAG_SLOT + who;
    } else {
      // `rand() & 0x80000001`, sign-corrected: `rand() % 2`.
      const who = rng.int(2);
      GrantExtraLife(who, events);
      p.removeFlag = EXTRA_LIFE_TAG_SLOT + who;
      p.slot = EXTRA_LIFE_STRIP_SLOT + EXTRA_LIFE_STRIP_STRIDE * who;
    }
  }
  if (p.storyItem > 0) {
    p.storyItem += 1;
    if (p.storyItem > EXTRA_LIFE_LAST_FRAME) {
      ActorDespawnProp(p);
      return;
    }
  }
  let m = PropMatrixPush();
  MatrixTranslate(m, p.x, Math.fround(p.y + EXTRA_LIFE_HEART_RISE), p.z);
  MatrixRotateY(m, p.yaw);
  MatrixScale(m, EXTRA_LIFE_HEART_SCALE, EXTRA_LIFE_HEART_SCALE,
              EXTRA_LIFE_HEART_SCALE);
  // `NoOpStub(3.0)` here does nothing.
  if (p.storyItem < EXTRA_LIFE_FADE_FROM) {
    PropDrawSlot(p, m, EXTRA_LIFE_HEART_SLOT);
  } else {
    PropDrawSlotWithAlpha(p, m, EXTRA_LIFE_HEART_SLOT,
                          Math.fround(1.0 - p.storyItem * EXTRA_LIFE_FADE_STEP));
  }
  if (p.storyItem > 0) {
    p.shake = Math.fround(p.shake + EXTRA_LIFE_TAG_CLIMB);
    m = PropMatrixPush();
    MatrixTranslate(m, p.x, Math.fround(p.shake + p.y + EXTRA_LIFE_TAG_RISE),
                    p.z);
    PropMatrixClearRotation(m);
    MatrixScale(m, EXTRA_LIFE_TAG_SCALE, EXTRA_LIFE_TAG_SCALE,
                EXTRA_LIFE_TAG_SCALE);
    PropDrawSlot(p, m, p.removeFlag);
    m = PropMatrixPush();
    MatrixTranslate(m, p.x, p.y, p.z);
    MatrixRotateY(m, p.yaw);
    PropDrawSlot(p, m, ((p.slot << 16) >> 16) - 1 + p.storyItem);
  }
  PropRegisterForShotTest(p, p.x, Math.fround(p.y + EXTRA_LIFE_SHOT_RISE),
                          p.z);
}

/**
 * `SpawnScorePickup` — `FUN_004723F0`. Item sets 2 and 5..8: the score
 * pickup, an object of its own running {@link ScorePickupUpdate}, with the
 * set id carried through as its kind.
 *
 * ```
 * 004723F6  ActorAlloc(ScorePickupUpdate, 0x378); ActorClearGameFields
 * 00472410  q+0x194 = (u8)kind;  q+0x34 = 0x80000001;  q+0x19C = p+0x19C
 * 00472432  q+0x1A0 = (f32)(g_item_pickup_y_offset[kind] + p+0x1A0)   ; FLD; FADD; FSTP
 * 00472444  q+0x1A4 = p+0x1A4;  q+0x197 = p+0x197;  q+0x196 = p+0x196
 * 00472468  q+0x11C = (u16)p+0x11C;  q+0x2A0 = 0;  q+0x124 = 3.0
 * 0047248A  q+0x28C = g_item_pickup_slot[kind]
 * ```
 *
 * `[proved]`. It inherits the prop's step counters and its `+0x11C`, so it
 * ages on the prop's clock, and it is never turned: `+0x1D0` is the zero
 * `ActorClearGameFields` left, and the routine spins it from there.
 * `ActorAlloc` appends it to the task list the prop is on, so it runs on the
 * frame it is made. It has no `g_class41_updates` entry, so the port files
 * it as a generic prop of {@link SCORE_PICKUP_ROUTINE_TYPE} and the pool
 * runs it through that row (`class41/generic_routines.ts`).
 *
 * The `item.released` event is the port's own notice for its feed.
 */
export function SpawnScorePickup(p: BreakableProp, kind: number,
                                 events?: Events): void {
  const row = ItemPickupRowOf(kind);
  const q = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  q.family = PropFamily.Generic;
  q.kind = SCORE_PICKUP_ROUTINE_TYPE;
  q.state = BreakableState.Standing;
  // `ActorClearGameFields` zeroes the strip's frame and base, and the yaw.
  q.storyItem = 0;
  q.removeFlag = 0;
  q.yaw = 0;
  const w = PropWords(q, SCORE_PICKUP_WORDS_ZERO);
  w.o194 = kind & 0xff;
  q.flags = SCORE_PICKUP_FLAGS;
  q.x = p.x;
  q.y = Math.fround(row.y_offset + p.y);
  q.z = p.z;
  q.stepsElapsed = p.stepsElapsed;
  q.lastStepIndex = p.lastStepIndex;
  q.lifetime = (PropWord11C(p) << 16) >> 16;
  q.hitRadius = SCORE_PICKUP_RADIUS;
  q.slot = (row.slot << 16) >> 16;
  G.g_breakable_props.push(q);
  events?.emit("item.released", {
    set: kind, from: p.id, x: q.x, y: q.y, z: q.z,
  });
}

/**
 * `[port-only]` -- the routine number the port files the score pickup under:
 * the engine's object carries `ScorePickupUpdate` itself, and the routine is
 * in no `g_class41_updates` slot. One past {@link EXTRA_LIFE_ROUTINE_TYPE}.
 */
export const SCORE_PICKUP_ROUTINE_TYPE = 0x101;
/** `MOV dword ptr [ESI + 0x34], 0x80000001` — live, and bit 31. */
const SCORE_PICKUP_FLAGS = 0x80000001;
/** `MOV dword ptr [ESI + 0x124], 0x40400000` — its sphere, 3.0. */
const SCORE_PICKUP_RADIUS = 3.0;

/** The words of the score pickup beyond the common prop fields. */
interface ScorePickupWords {
  /** `+0x194` — the kind, a byte: the item set that let it out. */
  o194: number;
}
const SCORE_PICKUP_WORDS_ZERO: ScorePickupWords = { o194: 0 };

/**
 * `g_item_pickup_slot[kind]` (`0x00595058`, stride `0xC`) as the bundle
 * carries it. A kind the bundle has no row for reads as the zeroes a
 * record of the table's own unused kinds holds.
 *
 * `[port-only]` as a function: the engine indexes the table inline.
 */
function ItemPickupRowOf(kind: number):
    { slot: number; score: number; scale: number; y_offset: number } {
  return T.breakables?.item_pickups?.[String(kind)]
    ?? { slot: 0, score: 0, scale: 0, y_offset: 0 };
}

/** The kind that is drawn square to the screen and never turned. */
const SCORE_PICKUP_KIND_FACING = 5;
/** The kind that plays its own sound, is never turned, and has no strip. */
const SCORE_PICKUP_KIND_PENALTY = 7;
/** The kind laid flat: `MatrixRotateX(0x4000)`. */
const SCORE_PICKUP_KIND_FLAT = 2;
/** The kind drawn with UVs from its normals, and shot a little higher. */
const SCORE_PICKUP_KIND_ENV = 8;
/** `PUSH 0x10B2` into `AssetSlotUVsFromViewNormals` — kind 8's own model. */
const SCORE_PICKUP_ENV_SLOT = 0x10b2;
/** `PUSH 0x416A9` for {@link SCORE_PICKUP_KIND_PENALTY}, `0x3B17A9` else. */
export const SFX_SCORE_PICKUP_PENALTY = 0x416a9;
export const SFX_SCORE_PICKUP = 0x3b17a9;
/** `ADD dword ptr [ESI + 0x1D0], 0x200` — the turn, a frame. */
const SCORE_PICKUP_SPIN = 0x200;
/** `MatrixRotateX(0x4000)` for {@link SCORE_PICKUP_KIND_FLAT}. */
const SCORE_PICKUP_FLAT_PITCH = 0x4000;
/** `CMP EAX, 0x19`: drawn plainly below this frame, then faded by 0.02. */
const SCORE_PICKUP_FADE_FROM = 0x19;
const SCORE_PICKUP_FADE_STEP = 0.02;
/** `CMP EAX, 0x31`: past this frame of `+0x2A0` the object goes. */
const SCORE_PICKUP_LAST_FRAME = 0x31;
/** The two players' strips: `0x116A` for player 0, `0x119C` for player 1. */
const SCORE_PICKUP_STRIP_P0 = 0x116a;
const SCORE_PICKUP_STRIP_P1 = 0x119c;
/** `LEA`s to `who * 50` — one strip to the next. */
const SCORE_PICKUP_STRIP_STRIDE = 0x32;
/**
 * The shadow, while the pickup is untaken: `AssetDrawSlot(0x10D0)` under
 * `MatrixScale(3.0, 1.0, 3.0)`, 0.1 (`[0x004C4CC8]`) above the prop it came
 * out of.
 */
const SCORE_PICKUP_SHADOW_SLOT = 0x10d0;
const SCORE_PICKUP_SHADOW_RISE = Math.fround(0.1);
const SCORE_PICKUP_SHADOW_SCALE_XZ = 3.0;
const SCORE_PICKUP_SHADOW_SCALE_Y = 1.0;
/** `FSUB [0x004C4CBC]` — the strip is drawn 2.5 below the pickup. */
const SCORE_PICKUP_STRIP_DROP = 2.5;
/** `FLD [0x004C4CB8]` — kind 8's sphere is 1.5 above its origin. */
const SCORE_PICKUP_ENV_SHOT_RISE = 1.5;

/**
 * `ScorePickupUpdate` — `FUN_004724A0`. The score pickup: a model turning
 * over its shadow until it is shot or its prop's lifetime runs out.
 *
 * ```
 * 004724BC  scale = g_item_pickup_slot[kind].scale        ; read before the lifetime
 * 004724C7  PropExpireByStepLifetime(obj)
 * 004724D2  if (!(obj+0x34 & 0x40000000) && (obj+0x34 & 8)) {
 * 004724E8      BreakablePropAwardHit(obj+0x34, 0);  obj+0x34 |= 0x40000000
 * 00472512      PlaySoundId(kind == 7 ? 0x416A9 : 0x3B17A9)
 *               if (!(p0 bit) || !(p1 bit)) {
 * 0047259C          !p0: ScoreAddForPlayer(1, score);  obj+0x2A4 = 0x119C
 * 0047257A          else ScoreAddForPlayer(0, score);  obj+0x2A4 = 0x116A
 *               } else {
 * 00472529          who = rand() % 2;  ScoreAddForPlayer(who, score)
 * 00472566          (u16)obj+0x28C = who * 50 + 0x116A        ; the MODEL, not +0x2A4
 *               }
 * 004725BC      obj+0x2A0 = 1 }
 * 004725C6  if (obj+0x2A0 > 0 && ++obj+0x2A0 > 0x31) { ActorDespawn(obj); return }
 * 004725EB  if (kind != 5 && kind != 7) obj+0x1D0 += 0x200
 * 00472603  LightsUseSecondarySet()
 *           T(pos); kind 5 ? ClearRotation : Ry(obj+0x1D0); kind 2: Rx(0x4000)
 *           Scale(scale);  kind 8: AssetSlotUVsFromViewNormals(0x10B2)
 * 00472694  n < 0x19 ? AssetDrawSlot(+0x28C) : AssetDrawSlotWithAlpha(+0x28C, 1 - n * 0.02)
 * 004726DD  LightsRestoreScene()
 * 004726EA  if (n == 0) shadow 0x10D0 at (x, y - y_offset[kind] + 0.1, z), Scale(3, 1, 3)
 * 0047275C  if (kind != 7 && n > 0) AssetDrawSlot(+0x2A4 - 1 + n) at T(x, y - 2.5, z) Ry(+0x1D0)
 * 004727C8  obj+0x70 = (x, y + (kind == 8 ? 1.5 : 0), z);  RegisterForShotTest(obj)
 * ```
 *
 * `[proved]`, from the listing. Two things in it are the engine's own and
 * kept: the hit bit is never cleared, the taken bit alone stops a second
 * payment; and **the arm for a shot both players landed writes the strip's
 * base into the model, `+0x28C`, and leaves `+0x2A4` at the zero
 * `ActorClearGameFields` gave it** -- so from that frame the pickup draws
 * the player's strip's first frame as its model, and the strip below it is
 * `AssetDrawSlot(n - 1)`, slots 0 to 0x30, of which slot 0 draws nothing.
 * The single-player arms write `+0x2A4` and leave the model alone.
 *
 * Kind 7 is the one that costs: its row's score is -400.
 */
export function ScorePickupUpdate(p: BreakableProp, rng: Rng,
                                  events?: Events): void {
  PropDrawBegin(p);
  const w = PropWords(p, SCORE_PICKUP_WORDS_ZERO);
  // `MOVSX EAX, byte ptr [ESI+0x194]` -- the kind, sign-extended.
  const kind = (w.o194 << 24) >> 24;
  const row = ItemPickupRowOf(kind);
  const scale = row.scale;
  if (PropExpireByStepLifetime(p)) return;
  const f = p.flags;
  if ((f & SCORE_PICKUP_TAKEN) === 0 && (f & BreakableFlag.Hit) !== 0) {
    BreakablePropAwardHit(f, false, rng);
    p.flags |= SCORE_PICKUP_TAKEN;
    events?.emit("sound.play", {
      id: kind === SCORE_PICKUP_KIND_PENALTY ? SFX_SCORE_PICKUP_PENALTY
                                              : SFX_SCORE_PICKUP,
    });
    const p0 = (p.flags & BreakableFlag.HitByPlayer0) !== 0;
    if (!p0 || (p.flags & BreakableFlag.HitByPlayer1) === 0) {
      if (!p0) {
        ScoreAddForPlayer(1, row.score, events);
        p.removeFlag = SCORE_PICKUP_STRIP_P1;
      } else {
        ScoreAddForPlayer(0, row.score, events);
        p.removeFlag = SCORE_PICKUP_STRIP_P0;
      }
    } else {
      // `rand() & 0x80000001`, sign-corrected: `rand() % 2`.
      const who = rng.int(2);
      ScoreAddForPlayer(who, row.score, events);
      p.slot = ((who * SCORE_PICKUP_STRIP_STRIDE + SCORE_PICKUP_STRIP_P0)
                << 16) >> 16;
    }
    p.storyItem = 1;
  }
  if (p.storyItem > 0) {
    p.storyItem += 1;
    if (p.storyItem > SCORE_PICKUP_LAST_FRAME) {
      ActorDespawnProp(p);
      return;
    }
  }
  if (kind !== SCORE_PICKUP_KIND_FACING && kind !== SCORE_PICKUP_KIND_PENALTY) {
    p.yaw = (p.yaw + SCORE_PICKUP_SPIN) | 0;
  }
  LightsUseSecondarySet();
  const light = RenderLightSet();
  let m = PropMatrixPush();
  MatrixTranslate(m, p.x, p.y, p.z);
  if (kind === SCORE_PICKUP_KIND_FACING) PropMatrixClearRotation(m);
  else MatrixRotateY(m, p.yaw);
  if (kind === SCORE_PICKUP_KIND_FLAT) MatrixRotateX(m, SCORE_PICKUP_FLAT_PITCH);
  MatrixScale(m, scale, scale, scale);
  // `NoOpStub(scale)` here does nothing.
  const env = kind === SCORE_PICKUP_KIND_ENV;
  if (p.storyItem < SCORE_PICKUP_FADE_FROM) {
    PropDrawSlot(p, m, p.slot);
  } else {
    PropDrawSlotWithAlpha(p, m, p.slot,
                          Math.fround(1.0 - p.storyItem * SCORE_PICKUP_FADE_STEP));
  }
  // The call above recorded under block 1's light; `AssetSlotUVsFromView
  // Normals(0x10B2)` rewrote slot 0x10B2's UVs, which only kind 8 draws.
  const main = p.draws?.[p.draws.length - 1];
  if (main) {
    main.light = light;
    if (env && main.slot === SCORE_PICKUP_ENV_SLOT) main.envUv = true;
  }
  LightsRestoreScene();
  if (p.storyItem === 0) {
    m = PropMatrixPush();
    MatrixTranslate(m, p.x,
                    Math.fround(p.y - row.y_offset + SCORE_PICKUP_SHADOW_RISE),
                    p.z);
    MatrixScale(m, SCORE_PICKUP_SHADOW_SCALE_XZ, SCORE_PICKUP_SHADOW_SCALE_Y,
                SCORE_PICKUP_SHADOW_SCALE_XZ);
    PropDrawSlot(p, m, SCORE_PICKUP_SHADOW_SLOT);
  }
  if (kind !== SCORE_PICKUP_KIND_PENALTY && p.storyItem > 0) {
    m = PropMatrixPush();
    MatrixTranslate(m, p.x, Math.fround(p.y - SCORE_PICKUP_STRIP_DROP), p.z);
    MatrixRotateY(m, p.yaw);
    PropDrawSlot(p, m, p.removeFlag - 1 + p.storyItem);
  }
  const rise = env ? SCORE_PICKUP_ENV_SHOT_RISE : 0;
  PropRegisterForShotTest(p, p.x, Math.fround(rise + p.y), p.z);
}

/** `obj+0x34` bit 30 — taken: the pickup has paid. */
const SCORE_PICKUP_TAKEN = 0x40000000;

/**
 * `SpawnStoryModeItem` — `FUN_00467B90`. Taken while `g_GameMode` is 1 by a
 * prop whose own `+0x2A0` names a row of the scene's Original Mode item
 * table, *instead of* its item set's release; types 74 and 75 call it with
 * rows 2 and 1 of their own. Three shipped group members carry one: group 0's
 * member 0 and group 7's members 3 and 4.
 *
 * **The item is a collectible**, the same object class 0x41 types 70 and 71
 * are:
 *
 * ```c
 * q = ActorAlloc(OriginalItemPropUpdate, 0x378);  ActorClearGameFields(q);
 * q+0x34 = 0x80000001;  q+0x194 = (s8)p+0x2A0;  q+0x19C..0x1A4 = p's;
 * q+0x1D0 = (s16)ftol(atan2(x - eye.x, z - eye.z) * 32768/pi) + 0x8000;
 * q+0x197 = p+0x197;  q+0x196 = p+0x196;  q+0x11C = p+0x11C;  q+0x124 = 3.0;
 * PickOriginalModeItem(q, q+0x194);  g_original_item_banner_count = 0;
 * ```
 *
 * It inherits the prop's step counters and its `+0x11C`, so it ages on the
 * prop's clock from where the prop was. `ActorAlloc` appends it to the task
 * list the prop is on, so it runs on the frame it is made. Its routine is
 * `g_class41_updates[70]`'s, so the port files it as a generic prop of that
 * type and the pool's generic arm runs it through the same row
 * (`class41/generic_routines.ts`); its flags word has no bit `0x200000`, so
 * it turns rather than bobs.
 *
 * The `item.released` event is the port's own notice for its feed; the
 * engine has no counterpart and the game reads nothing from it.
 */
export function SpawnStoryModeItem(p: BreakableProp, rng: Rng,
                                   events?: Events): void {
  const q = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  q.family = PropFamily.Generic;
  q.kind = STORY_ITEM_ROUTINE_TYPE;
  q.flags = STORY_ITEM_FLAGS;
  q.state = BreakableState.Standing;
  // `ActorClearGameFields` zeroes the pickup strip's frame and base.
  q.storyItem = 0;
  q.removeFlag = 0;
  const w = PropWords(q, COLLECTIBLE_WORDS_ZERO);
  w.o194 = (p.storyItem << 24) >> 24;
  q.x = p.x;
  q.y = p.y;
  q.z = p.z;
  // `FPATAN; FMUL g_rad_to_bams; __ftol; MOVSX; ADD 0x8000`, off the camera
  // eye of the block `g_camera_index` names (`0x00467C03`, `0x00467C0F`).
  const eye = CameraBlockEye(G.g_camera_index);
  const b = Math.trunc(Math.atan2(p.x - eye.x, p.z - eye.z)
                       * STORY_ITEM_RAD_TO_BAMS);
  q.yaw = ((b << 16) >> 16) + 0x8000;
  q.stepsElapsed = p.stepsElapsed;
  q.lastStepIndex = p.lastStepIndex;
  q.lifetime = PropWord11C(p);
  q.hitRadius = STORY_ITEM_RADIUS;
  PickOriginalModeItem(q, w.o194, rng);
  G.g_original_item_banner_count = 0;
  G.g_breakable_props.push(q);
  events?.emit("item.released", {
    set: -1, kind: p.storyItem, from: p.id, x: p.x, y: p.y, z: p.z,
  });
}

/**
 * `PUSH 0x004675A0` into `ActorAlloc` — `OriginalItemPropUpdate`, which is
 * `g_class41_updates[70]`. `[port-only]` as a type number: the engine's
 * object carries the routine and not a type.
 */
const STORY_ITEM_ROUTINE_TYPE = 70;
/** `MOV dword ptr [EAX + 0x34], 0x80000001` — live, and bit 31. */
const STORY_ITEM_FLAGS = 0x80000001;
/** `MOV dword ptr [EAX + 0x124], 0x40400000` — a collectible's 3.0. */
const STORY_ITEM_RADIUS = 3.0;
/** `g_rad_to_bams` — `0x004C4378`, the double `32768/pi`. */
const STORY_ITEM_RAD_TO_BAMS = 32768 / Math.PI;

/**
 * `obj+0x11C` of a prop, whichever port field holds it.
 *
 * `[port-only]` — the engine reads one word; the port keeps that word in
 * `hp` for the families whose routines count shots in it (the group props
 * and the falling container) and in `lifetime` for the ones that count steps
 * against it (the kinded and generic props). The question is the engine's,
 * the answer is where the port put it (`L3`).
 */
export function PropWord11C(p: BreakableProp): number {
  return p.family === PropFamily.Group || p.family === PropFamily.Falling
    ? p.hp : p.lifetime;
}

/**
 * Which of the engine's three copies of the release switch a destroy path is
 * running. They are identical in the set arms but for the height the item is
 * released at, and **not** in the story arm, which is why the port has to
 * know: each copy writes `g_original_item_pickup_blocked` (`0x007DCD14`)
 * its own way.
 */
export enum HiddenItemCopy {
  /** `BreakablePropUpdate` (`FUN_00464620`), `0x00464B41`..`0x00464B8B`. */
  Group = 0,
  /** `KindedPropUpdate` (`FUN_00465FB0`), `0x00466158`..`0x004661F4`. */
  Kinded = 1,
  /** `FallingContainerUpdate` (`FUN_0046A580`), `0x0046A9BB`..`0x0046AA6E`. */
  Falling = 2,
}

/** `CMP [0x009A1A08], BX` with `BX = 2`, and `CMP [0x009A2BC0], 4`. */
const KINDED_STORY_BLOCK_SCENE = 2;
const KINDED_STORY_BLOCK_BLOCK = 4;

/**
 * The tail of the destroy path: count this break against the prop's item set
 * and, if that empties the countdown, let the item out.
 *
 * `g_GameMode == 1` has two overrides, and the order is the engine's: an
 * always-on flag makes *every* prop drop the extra life, and a prop carrying
 * its own `storyItem` releases that in place of its set's item.
 *
 * The engine spells this switch out **three times** — once each in
 * `BreakablePropUpdate`, `KindedPropUpdate` and `FallingContainerUpdate` —
 * and `copy` says which. The set arms are identical but for the height the
 * item is released at, which is `rise`. The story arms differ more:
 *
 * ```c
 * // BreakablePropUpdate, 0x00464B7B
 * SpawnStoryModeItem(obj);  g_original_item_pickup_blocked = 0;
 * // KindedPropUpdate, 0x00466192
 * g_original_item_pickup_blocked = 0;
 * if (g_scene_index == 2 && g_evt_block_index == 4) g_original_item_pickup_blocked = 1;
 * if ((s16)obj->+0x290 == 2) { y += 1.0; SpawnStoryModeItem(obj); y -= 1.0; }
 * else SpawnStoryModeItem(obj);
 * // FallingContainerUpdate, 0x0046A9F4 -- +0x11C = (s8)+0x199 on both arms
 * y = floor + 0.5;  SpawnStoryModeItem(obj);  g_original_item_pickup_blocked = 0;
 * ```
 *
 * `storyRise` is the story arm's height: 1.0 for a kind-2 kinded prop, 0.5
 * over the floor for the falling container, and nothing for a group member.
 * The falling container's `obj+0x11C = (s8)obj+0x199` (`0x0046AA0F`,
 * `0x0046AA35`) is what the story item inherits as its lifetime; the port
 * holds `+0x11C` in `hp` for that family and `+0x199` in `lifetime`.
 */
export function ReleaseHiddenItem(p: BreakableProp, rng: Rng,
                                  events: Events | undefined,
                                  copy: HiddenItemCopy,
                                  rise = 0, storyRise = rise): void {
  // FIRST AID KIT's arm sits in front of this in each caller: it is not
  // part of the switch.
  if (p.itemSet <= ItemSet.None) return;

  const left = (G.g_item_set_countdown[p.itemSet] ?? 0) - 1;
  G.g_item_set_countdown[p.itemSet] = left;
  if (left !== 0) return;

  if (copy === HiddenItemCopy.Falling) p.hp = p.lifetime;
  if (G.g_GameMode === 1 && p.storyItem !== -1) {
    if (copy === HiddenItemCopy.Kinded) {
      G.g_original_item_pickup_blocked = 0;
      if (G.g_scene_index === KINDED_STORY_BLOCK_SCENE
          && G.g_evt_block_index === KINDED_STORY_BLOCK_BLOCK) {
        G.g_original_item_pickup_blocked = 1;
      }
    }
    // `FLD; FADD float; FSTP float` before the call; the kinded copy takes
    // it back off after (`FSUB`), the falling one is despawned next.
    if (storyRise !== 0) p.y = Math.fround(p.y + storyRise);
    SpawnStoryModeItem(p, rng, events);
    if (storyRise !== 0 && copy === HiddenItemCopy.Kinded) {
      p.y = Math.fround(p.y - storyRise);
    }
    if (copy !== HiddenItemCopy.Kinded) G.g_original_item_pickup_blocked = 0;
    return;
  }

  // The per-family height tweak, applied for the release and taken straight
  // back off — the engine does exactly this, `+0x1A0 += r` then `-= r`.
  p.y += rise;
  switch (p.itemSet) {
    case ItemSet.ExtraLife:
      SpawnExtraLifePickup(p, events);
      break;
    case ItemSet.GoldenFrog:
      SpawnGoldenFrog(p, events, rng);
      break;
    case ItemSet.Score2:
    case ItemSet.Score5:
    case ItemSet.Score6:
    case ItemSet.Score7:
    case ItemSet.Score8:
      SpawnScorePickup(p, p.itemSet, events);
      break;
    default:
      // Set 4 has no arm in the engine's switch, and no shipped prop uses it.
      break;
  }
  p.y -= rise;
}
