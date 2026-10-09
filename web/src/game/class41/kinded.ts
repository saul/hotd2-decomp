/**
 * `PlaceKindedProp` and `KindedPropUpdate` — class 0x41 **type 4**.
 *
 * 70 spawns, the most-placed constructor in the game, and **37 of them hide an
 * item** — more than the group placer accounts for. It is the only container
 * family in stages 3, 4 and 6.
 *
 * It is a different shape from the group props in three ways worth holding on
 * to before reading the code:
 *
 * * **One prop per spawn, not a table.** The group placer builds a whole group
 *   from records compiled into the exe; this builds one prop from the spawn
 *   descriptor. An item *set* is therefore N separate spawns sharing an item-
 *   set id, and the set size rides in the spawn's own orientation word.
 * * **Most take one shot.** Only a prop wearing the group props' crate model
 *   (`0x19E8`) takes two; every other kind is destroyed by the first.
 * * **The lifetime is in `+0x11C`**, the field that is hit points for a combat
 *   actor and the group id for the placer. `KindedPropUpdate` never reads it
 *   as a shot count at all.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { G } from "../globals";
import { CameraBlockYaw } from "../camera/view";
import { T } from "../tables";
import { PropRegisterForShotTest } from "./shot_test";
import { MsvcRand } from "./group";
import {
  HiddenItemCopy, ReleaseHiddenItem, SpawnExtraLifePickup,
} from "./items";
import { GameMode } from "../game_mode";
import {
  BreakableFlag, BreakableSlot, BreakableState, HIT_FLAG_MASK, ItemSet,
  makeBreakableProp, PropFamily, type BreakableProp,
} from "./prop_state";
import {
  ActorDespawnProp, BreakablePropAwardHit, PROP_HIT_HOLD_BLOCK,
  PROP_HIT_HOLD_SCENE, SCRIPT_FLAG_PROP_HIT_RELEASE,
} from "./prop";
import { PropExpireByStepLifetime } from "./lifetime";
import {
  PropDrawBegin, PropDrawEffect, PropDrawEffectSceneLit, PropDrawSlot,
  PropMatrixPush, PropSubmitSlotWithSceneLightArray,
} from "./prop_draw";
import { MatrixRotateY, MatrixScale, MatrixTranslate } from "../matrix";
import { EffectMotionPlayLength } from "../effect_draw";
import { SpawnPropHitEffectScaled, SpawnPropHitSpark } from "../effects/sprite";

/**
 * The asset slot each object kind draws, from the chain of `if`s in
 * `PlaceKindedProp`. A kind with no entry gets `0xFFFF` — nothing is drawn,
 * which is what the engine's `-1` means.
 */
export const KIND_SLOT: Partial<Record<number, number>> = {
  2: 0x17a9,
  3: BreakableSlot.Default,      // 0x19E8, the same crate the groups use
  8: 0x17aa,
  9: 0x17ab,
};

/** `AssetDrawSlot(0x10D1)` — the smaller ground shadow kinds 4 and 5 get. */
export const SHADOW_SLOT_SMALL = 0x10d1;

/** The kinds that draw a shadow at all, and which one. */
export const KIND_SHADOW: Partial<Record<number, number>> = {
  0: 0x10d0, 3: 0x10d0, 6: 0x10d0, 7: 0x10d0, 10: 0x10d0,
  4: SHADOW_SLOT_SMALL, 5: SHADOW_SLOT_SMALL,
};

/** The slot a cracked `0x19E8` kinded prop swaps to: nothing at all. */
export const SLOT_NONE = 0xffff;

/** Item set 6 releases 0.5 higher for these kinds; set 7 by 0.9 for `0x17AB`. */
const SET6_RAISED_KINDS = [2, 8, 9];
const SET6_RISE = 0.5;
const SET7_RISE = 0.9;

/**
 * `PlaceKindedProp` — `FUN_00462E10`. One prop, from the spawn descriptor.
 *
 * The *orientation* words carry the payload: `obj+0x6C` is the object kind and
 * `obj+0x64` the item-set size. That is why `docs/formats/spawns.md` warns
 * that the class-0x41 orientation triple must never be read as angles.
 */
export function PlaceKindedProp(at: number, kind: number, itemSet: number,
                                setSize: number, lifetime: number,
                                x: number, y: number, z: number, yaw: number,
                                rng: Rng): BreakableProp {
  const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  p.family = PropFamily.Kinded;
  p.at = at;
  p.kind = kind;
  p.itemSet = itemSet;
  // `+0x11C` is the lifetime in evt blocks here, not a shot count.
  p.lifetime = lifetime;
  p.lastStepIndex = G.g_evt_step_index;
  p.stepsElapsed = 0;
  p.x = x;
  p.y = y;
  p.z = z;
  p.yaw = yaw;
  p.flags = 0x80000000 | BreakableFlag.Live;
  p.state = BreakableState.Standing;
  p.slot = KIND_SLOT[kind] ?? SLOT_NONE;
  p.storyItem = -1;

  const params = T.breakables?.kinds?.[kind];
  // `obj+0x124 = (float)g_prop_kind_params[kind].radius`. The bundle has
  // carried this and the y offset beside it since the table was exported, and
  // nothing read either until the shot test became a sphere.
  p.hitRadius = params?.radius ?? 0;
  p.effect = params?.effect ?? 0;
  p.effectVariant = params?.effect_variant ?? 0;

  // The countdown is seeded per *spawn*, so the last of a set to be placed is
  // the one whose draw decides which break pays out. Groups 6 and 7 of the
  // table placer have the same quirk.
  if (itemSet > 0) {
    G.g_item_set_countdown[itemSet] =
      setSize > 1 ? (MsvcRand(rng) % setSize) + 1 : 1;
  }
  return p;
}

/** `g_active_cam_path == 0x29 && g_cam_path_frame == 0x14A` in scene 0. */
const KINDED_DESPAWN_SCENE0_PATH = 0x29;
const KINDED_DESPAWN_SCENE0_FRAME = 0x14a;
/** `g_active_cam_path == 0x2F && g_cam_path_frame == 0x96` in any other. */
const KINDED_DESPAWN_PATH = 0x2f;
const KINDED_DESPAWN_FRAME = 0x96;
/** `MOV [ESI+0x2C0], 0x3F800000` — the shake the crate's crack sets. */
const KINDED_CRACK_SHAKE = 1.0;
/** `SpawnPropHitEffectScaled(obj, player, 0x3FC00000)` — the break's 1.5. */
const KINDED_HIT_EFFECT_SCALE = 1.5;
/**
 * The rattle: `if ([0x004C4CC0] 0.01 < shake)` two `rand() % 0x97`, each
 * `- [0x00569040] 75.0`, `* shake * [0x004D5464] 0.01`, the first into x
 * and the second into z; then `shake *= [0x00564534] 0.85`. The same
 * constants `BreakablePropUpdate` reads.
 */
const KINDED_SHAKE_FLOOR = 0.01;
const KINDED_SHAKE_SPREAD = 0x97;
const KINDED_SHAKE_CENTRE = 75.0;
const KINDED_SHAKE_SCALE = 0.01;
const KINDED_SHAKE_DECAY = 0.85;
/** `PUSH 0x3F4CCCCD`: every model but the crate is drawn 0.8 up. */
const KINDED_MODEL_RISE = 0.8;
/** Scene 3, block `0x11`: `MatrixScale(0.6, 1.0, 1.0)` before the model. */
const KINDED_SQUASH_SCENE = 3;
const KINDED_SQUASH_BLOCK = 0x11;
const KINDED_SQUASH_X = 0.6;
/** `g_camera_fixed_eye_y + [0x004D1D24] 0.2` — the shadow's height. */
const KINDED_SHADOW_RISE = 0.2;
/** `CMP word ptr [0x009A1A08], BX` with `BX = 3`: scene 3 draws its break lit. */
const KINDED_LIT_EFFECT_SCENE = 3;
/** `MatrixScale(10, 1, 10)` for `0x10D0`, `(8, 1, 8)` for `0x10D1`. */
const KINDED_SHADOW_SCALE_LARGE = 10.0;
const KINDED_SHADOW_SCALE_SMALL = 8.0;

/**
 * `KindedPropUpdate` — `FUN_00465FB0`. One prop, one 60 Hz frame.
 *
 * Its draw is recorded where the routine makes it (`class41/prop_draw.ts`):
 * the model -- or, for the seven kinds `PlaceKindedProp` gives no slot and
 * for every kind once it is broken, the effect at `obj+0x324` -- then the
 * ground shadow. A kind with no model is therefore drawn whole by its
 * effect's first frame, and its break is that effect playing on.
 */
export function KindedPropUpdate(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  PropDrawBegin(p);
  let shakeX = 0, shakeZ = 0;
  // `FUN_00466640`, which `ActorDespawn`s -- and so `ActorKill`s, a longjmp
  // out of this routine -- on the scene-1 sweep or an expired lifetime.
  if (PropExpireByStepLifetime(p)) return;
  if (G.g_scene_index === 0
      ? (G.g_active_cam_path === KINDED_DESPAWN_SCENE0_PATH
         && G.g_cam_path_frame === KINDED_DESPAWN_SCENE0_FRAME)
      : (G.g_active_cam_path === KINDED_DESPAWN_PATH
         && G.g_cam_path_frame === KINDED_DESPAWN_FRAME)) {
    ActorDespawnProp(p);
    return;
  }

  // `+0x32C` is the break effect's frame counter; once it is running the prop
  // has been destroyed and takes no more shots. Scene 1's block `0x11` holds
  // every hit until `g_script_flags[0x28]`, as `BreakablePropUpdate` does.
  if (p.effectFrames === 0 && (p.flags & BreakableFlag.Hit) !== 0
      && !(G.g_scene_index === PROP_HIT_HOLD_SCENE
           && G.g_evt_block_index === PROP_HIT_HOLD_BLOCK
           && (G.g_script_flags[SCRIPT_FLAG_PROP_HIT_RELEASE] ?? 0) === 0)) {
    if (p.slot === BreakableSlot.Default) {
      // The crate model is the only kind that survives a shot. No score — the
      // engine passes 0 — and the model is hidden behind `0xFFFF`.
      p.flags &= ~BreakableFlag.Hit;
      BreakablePropAwardHit(p.flags, false, rng);
      events?.emit("prop.cracked", { id: p.id, sound: SFX_KINDED_CRACK });
      p.slot = SLOT_NONE;
      // `obj+0x1D0 = g_camera_block_yaw_bams[g_camera_index]` at
      // `0x004660A2`..`0x004660AE`: the crate turns to face the camera block
      // (`0x009A60D0`) as it cracks.
      p.yaw = CameraBlockYaw(G.g_camera_index);
      // `SpawnPropHitSpark(obj, (obj+0x34 & 2) == 0)` (`FUN_00465860`) at the
      // point `combat/shot.ts` left on the prop.
      if (p.hitAim) SpawnPropHitSpark(p.hitAim.x, p.hitAim.y, p.z);
      p.shake = KINDED_CRACK_SHAKE;
    } else {
      BreakablePropAwardHit(p.flags, true, rng);
      const params = T.breakables?.kinds?.[p.kind];
      events?.emit("prop.broken",
                   { id: p.id, sound: params?.sound ?? SFX_KINDED_CRACK });
      p.effectFrames = 1;
      p.flags &= ~BreakableFlag.Hit;
      // `SpawnPropHitEffectScaled(obj, (obj+0x34 & 2) == 0, 1.5f)`
      // (`FUN_004666B0`), not the spark the crack makes.
      if (p.hitAim) {
        SpawnPropHitEffectScaled(p.hitAim.x, p.hitAim.y, p.z,
                                 KINDED_HIT_EFFECT_SCALE);
      }
      // Original Mode's FIRST AID KIT (`0x00466120`..`0x00466153`): with
      // `g_original_first_aid` up, and the break effect not 0x13 or 0x16,
      // the set is the extra life's (`+0x194 = 1`) and the life comes out in
      // place of the release switch.
      if (G.g_GameMode === GameMode.Original && G.g_original_first_aid !== 0
          && p.effect !== FIRST_AID_SKIP_EFFECT_A
          && p.effect !== FIRST_AID_SKIP_EFFECT_B) {
        p.itemSet = ItemSet.ExtraLife;
        SpawnExtraLifePickup(p, events);
      } else {
        ReleaseKindedItem(p, rng, events);
      }
    }
  }
  p.flags &= ~HIT_FLAG_MASK;

  // The rattle: two of the game's `rand()`s a frame while it lasts, a draw
  // offset only (`0x004662C7`..`0x00466344`).
  if (KINDED_SHAKE_FLOOR < p.shake) {
    shakeX = ((MsvcRand(rng) % KINDED_SHAKE_SPREAD) - KINDED_SHAKE_CENTRE)
      * p.shake * KINDED_SHAKE_SCALE;
    shakeZ = ((MsvcRand(rng) % KINDED_SHAKE_SPREAD) - KINDED_SHAKE_CENTRE)
      * p.shake * KINDED_SHAKE_SCALE;
    p.shake *= KINDED_SHAKE_DECAY;
  }

  // The break effect runs to `g_motion_play_length[+0x328] - 2`
  // (`0x00466355`..`0x0046638E`), then the prop goes -- unless its item set
  // is 0 or 4, which holds the effect's last frame for the rest of its life.
  if (0 < p.effectFrames) {
    p.effectFrames += 1;
    const play = EffectMotionPlayLength(p.effectVariant);
    if (play !== null && play - 2 < p.effectFrames) {
      if (p.itemSet !== ItemSet.None && p.itemSet !== ItemSet.NoRelease) {
        ActorDespawnProp(p);
        return;
      }
      p.effectFrames = play - 2;
    }
  }

  // `if (g_motion_slots[+0x328].state == 2)` (`0x0046639A`): the effect's
  // motion resident. The port's is resident whenever the bundle carries a
  // record on it -- the residency `game/effect_draw.ts` reads.
  if (EffectMotionPlayLength(p.effectVariant) !== null) {
    const m = PropMatrixPush();
    MatrixTranslate(m, shakeX + p.x, p.y, shakeZ + p.z);
    MatrixRotateY(m, p.yaw);
    if (G.g_scene_index === KINDED_SQUASH_SCENE
        && G.g_evt_block_index === KINDED_SQUASH_BLOCK) {
      MatrixScale(m, KINDED_SQUASH_X, 1, 1);
    }
    const slot = (p.slot << 16) >> 16;
    if (p.effectFrames === 0 && slot !== -1) {
      if (p.slot !== BreakableSlot.Default) {
        MatrixTranslate(m, 0, KINDED_MODEL_RISE, 0);
      }
      // `g_scene_lighting` (`0x0046644C`) picks
      // `SubmitSlotWithSceneLightArray` over `AssetDrawSlot`.
      if (G.g_scene_lighting !== 0) PropSubmitSlotWithSceneLightArray(p, m, slot);
      else PropDrawSlot(p, m, slot);
    } else if (p.itemSet === ItemSet.NoRelease
               || G.g_scene_index === KINDED_LIT_EFFECT_SCENE) {
      // `EffectDrawSceneLit` (`FUN_0040DFA0`) for set 4 or in scene 3
      // (`0x0046647E`..`0x004664A5`), else `EffectDrawUnlit`.
      PropDrawEffectSceneLit(p, m, rng);
    } else {
      PropDrawEffect(p, m, rng);
    }
  }

  // The ground shadow, by kind, whole or broken (`0x004664B7`..).
  const shadow = KIND_SHADOW[p.kind];
  if (shadow !== undefined) {
    const s = shadow === SHADOW_SLOT_SMALL
      ? KINDED_SHADOW_SCALE_SMALL : KINDED_SHADOW_SCALE_LARGE;
    const m = PropMatrixPush();
    MatrixTranslate(m, p.x, G.g_camera_fixed_eye_y + KINDED_SHADOW_RISE, p.z);
    MatrixScale(m, s, 1, s);
    PropDrawSlot(p, m, shadow);
  }

  // `if (obj+0x32C == 0) { ...transform...; RegisterForShotTest(obj); }` --
  // a kinded prop leaves the shot test the frame its break effect starts, so
  // the puff is not a second target. The rise is
  // `g_prop_kind_params[kind].y_offset` (`DAT_00593DC2`).
  if (p.effectFrames === 0) {
    const rise = T.breakables?.kinds?.[p.kind]?.y_offset ?? 0;
    PropRegisterForShotTest(p, p.x, p.y + rise, p.z);
  }
}

/** `PlaySoundId(0x1D16A9)` — the crack, shared with the group props. */
export const SFX_KINDED_CRACK = 0x1d16a9;

/**
 * The item release, with the two height tweaks this family has and the others
 * do not: set 6 lifts the drop by 0.5 for kinds 2, 8 and 9, and set 7 by 0.9
 * when the prop is wearing `0x17AB`. Its story arm has a lift of its own: 1.0
 * for kind 2 (`CMP word ptr [ESI+0x290], BX` with `BX = 2`; `FADD float
 * [0x004C4380]` at `0x004661C2`), whatever the set.
 */
function ReleaseKindedItem(p: BreakableProp, rng: Rng,
                           events?: Events): void {
  let rise = 0;
  if (p.itemSet === 6 && SET6_RAISED_KINDS.includes(p.kind)) rise = SET6_RISE;
  else if (p.itemSet === 7 && p.slot === 0x17ab) rise = SET7_RISE;
  const storyRise = p.kind === KINDED_STORY_RAISED_KIND ? KINDED_STORY_RISE : 0;
  ReleaseHiddenItem(p, rng, events, HiddenItemCopy.Kinded, rise, storyRise);
}

/** `CMP EAX, 0x13` / `CMP EAX, 0x16` on `+0x324`: no first-aid life from these. */
const FIRST_AID_SKIP_EFFECT_A = 0x13;
const FIRST_AID_SKIP_EFFECT_B = 0x16;

/** The one kind whose story item is released 1.0 up. */
const KINDED_STORY_RAISED_KIND = 2;
const KINDED_STORY_RISE = 1.0;
