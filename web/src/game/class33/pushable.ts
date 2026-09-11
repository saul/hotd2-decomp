/**
 * Class 0x33 sub-handler **4** — a piece of scenery an actor shoves out of its
 * way.
 *
 * ```
 * ScriptedPushableUpdate33      FUN_00433B70  the two flags, the seed, the gate
 * ScriptedPushableApplyPush33   FUN_00433CE0  the move
 * ScriptedPushableSyncSphere33  FUN_00433E00  the sphere, re-seated each move
 * ```
 *
 * ## The push is not a shot, and it is not an animation
 *
 * Stage 1's `0x16D8` `char_adv00` was reported as playing "the wrong entrance
 * — a ledge hang where a chair push belongs", and the clip id was right all
 * along: `char_adv00` 1048 is a sixty-frame **hold** whose root goes nowhere
 * and whose bones sway at most 27 degrees, which is what
 * `ZombieStateWaitCameraFrameThenBranch` plays while it waits. What clip 1048
 * was authored to depict is `[open]`.
 *
 * The chair push is this class. `ColiTestSphereAgainstActors` (`FUN_00405B10`)
 * does not move the object it finds — it writes the pusher into `obj+0x138`,
 * the penetration into `+0x13C` and the reversed normal into `+0x140`, and
 * that object applies the push on its own next frame. `game/coli.ts` has
 * written those three since the crowd separation was ported;
 * `ZombiePushOutOfWorldAndActors` was the only reader. This is the second
 * reader, and it is the one the engine has for scenery.
 *
 * `[proved]` Two shipped spawns, both stage 1 and both in block 1 step 2:
 * `0x1A40` at `(22.83, 6.5, -16.74)` and `0x1A74` at `(16.83, 6.5, -20.74)`,
 * each drawing asset slot 4196 — `komono_7.bin` part 0, which renders as a
 * chair. `0x16D8` stands at `(24, 6.5, -20)` facing `-x`, 7.2 units from the
 * second of them, and block 1 step 3 raises their `push_flag` — 32 — one
 * instruction before it spawns him.
 *
 * ## What is not ported, by name
 *
 * * **The mesh shot test.** `tail+0x04` other than `-1` ORs `obj+0x34` bits
 *   `0x40` and `0x10` and puts a mesh id on `obj+0x14C`; bit `0x10` is what
 *   sends the shot to `ShotTestMesh` rather than `ShotTestSphere`, and the
 *   port has neither — see `game/class41/shot_test.ts`. Both shipped spawns
 *   carry `-1`, so neither reaches that arm.
 * * **`ActorClaimHitSlot` (`FUN_00409270`)**, which every arm of the dispatch
 *   ends with. `g_hit_slots` is not ported at all; `game/globals.ts` records
 *   the whole 14-slot table as absent.
 * * **The draw.** `MatrixTranslate(obj+0x40..0x48)` / `RotZ(obj+0x6C)` /
 *   `RotY(obj+0x68)` / `RotX(obj+0x64)` / `AssetDrawSlot(obj+0x13F0)` is
 *   `render/slotmodels.ts`', the same arrangement class 0x52's mouse has.
 * * **`RegisterForShotTest` (`FUN_00405160`)**, at `0x00433CC6` in the tail
 *   the decompiler does not show (`L35`). It is the call that puts the object
 *   in the per-frame dynamic list, and the port has no list: `game/coli.ts`
 *   walks `g_object_list` instead, which is that list's own declared
 *   divergence and covers this object without a line here.
 */
import { type Actor, type ScriptedSceneryActor } from "../actor";
import { ColiTestSphereAgainstActors, ColiTestSphereAgainstFullSet }
  from "../coli";
import { ActorDespawn } from "../despawn";
import { ActorByAt, G } from "../globals";
import type { ClassFrame } from "../registry";

/**
 * `obj+0x34` bit 15, and what two class-agnostic routines do with it.
 *
 * `TEST AH, 0x80` at `0x00433C09` is this class's own use: while it is set the
 * object does not move. It is the same bit `ColiTestSphereAgainstActors` skips
 * a candidate on — `0x80008000` — and the one `ShotTestSphere`
 * (`FUN_00404630`) refuses to descend into a skeleton through, so a set bit
 * takes the object out of the push *and* out of the list the push is found
 * from. That is why one flag arms both halves, and why this class's arming
 * flag is named for the push rather than for the bit.
 *
 * Class 0x31 keeps an unrelated fact in the same bit —
 * `ActorFlag.OffScreenPermit` — which is `L3` in one word. Named here, in the
 * class that uses it as this, rather than added to `ActorFlag`.
 */
export const SCENERY_SKIP_COLLISION = 0x8000;

/**
 * `OR AL, 0x1` at `0x00433BAA`, in the seed.
 *
 * `ActorInitFlags` (`FUN_00408970`) has already done `obj+0x34 = flags | 1`
 * before any `Init` runs, so this OR changes nothing on a shipped spawn. It is
 * written because the engine writes it: a record that reached here with the bit
 * down would get it up in the same place.
 */
const SCENERY_SEEDED_BIT = 0x1;

/** The tenth of the penetration a frame, as class 0x30's push applies. */
const PUSH_FRACTION = 0.1;
/** ...and the multiplier while the **pusher** is airborne. */
const PUSH_AIRBORNE = 1.8;
/** `TEST 0x18000000` — either of the pusher's two airborne bits. */
const PUSHER_AIRBORNE_EITHER = 0x18000000;

/** `tail+0x04`'s "no shot mesh", which is what makes the object pushable. */
const SHOT_MESH_NONE = -1;

/**
 * `ScriptedPushableSyncSphere33` — `FUN_00433E00`. The collision sphere, from
 * the position.
 *
 * ```
 * obj+0x12C = obj+0x40
 * obj+0x134 = obj+0x48
 * obj+0x130 = obj+0x44 + obj+0x128
 * ```
 *
 * Three stores and no literal: the centre rises by **exactly the body
 * radius**, where `ActorUpdateBoundingSphere` (`FUN_00454AC0`) rises by the
 * radius plus one. Two conventions for one field, which is what a per-class
 * publisher into a shared list buys you — so this class writes its own rather
 * than borrowing class 0x30's.
 *
 * Called once before the push and once after every move it makes, which is why
 * a shoved object's sphere never lags its model.
 */
export function ScriptedPushableSyncSphere33(obj: Actor): void {
  obj.sphereCentre.x = obj.pos.x;
  obj.sphereCentre.z = obj.pos.z;
  obj.sphereCentre.y = obj.pos.y + obj.bodyRadius;
}

/**
 * `ScriptedPushableApplyPush33` — `FUN_00433CE0`. One frame of being shoved.
 *
 * Three moves, in this order, each followed by a re-sync:
 *
 * 1. the push another actor recorded — a tenth of `obj+0x13C` along
 *    `obj+0x140..0x148`, times 1.8 when the **pusher** carries either airborne
 *    bit, on all three axes. `obj+0x138` is then cleared, so one recorded push
 *    moves the object once;
 * 2. a re-resolve against the actors, at a tenth of the depth and in **x and z
 *    only** — the object is never pushed up out of another. It is *nested*
 *    inside the arm above, so it happens only on a frame something pushed;
 * 3. a resolve against the full collision set, at the **full** depth and on
 *    all three axes, and this one runs whether or not anything pushed.
 *
 * The fraction and the airborne multiplier are `ZombiePushOutOfWorldAndActors`'
 * own, so an enemy walking into a chair displaces it at exactly the speed it
 * would displace another enemy.
 *
 * `DAT_009A26A0 = obj` at `0x00433CE6` is `g_cur_actor`, which
 * `ColiTestSphereAgainstActors` reads to skip the caller. The port passes the
 * caller as an argument instead — `game/coli.ts`'s own note — so there is
 * nothing to set here.
 */
export function ScriptedPushableApplyPush33(obj: ScriptedSceneryActor): void {
  ScriptedPushableSyncSphere33(obj);

  if (obj.pushedBy >= 0) {
    const by = ActorByAt(obj.pushedBy);
    let f = obj.pushDepth * PUSH_FRACTION;
    if (by && (by.flags & PUSHER_AIRBORNE_EITHER)) f *= PUSH_AIRBORNE;
    obj.pos.x += obj.pushNormal.x * f;
    obj.pos.y += obj.pushNormal.y * f;
    obj.pos.z += obj.pushNormal.z * f;
    ScriptedPushableSyncSphere33(obj);
    obj.pushedBy = -1;
    if (ColiTestSphereAgainstActors(obj, obj.sphereCentre.x,
                                    obj.sphereCentre.y, obj.sphereCentre.z,
                                    obj.bodyRadius)) {
      const d = G.g_coli_hit_depth * PUSH_FRACTION;
      obj.pos.x += (G.g_coli_hit_normal[0] ?? 0) * d;
      obj.pos.z += (G.g_coli_hit_normal[2] ?? 0) * d;
      ScriptedPushableSyncSphere33(obj);
    }
  }

  if (ColiTestSphereAgainstFullSet(obj.sphereCentre.x, obj.sphereCentre.y,
                                   obj.sphereCentre.z, obj.bodyRadius)) {
    const d = G.g_coli_hit_depth;
    obj.pos.x += (G.g_coli_hit_normal[0] ?? 0) * d;
    obj.pos.y += (G.g_coli_hit_normal[1] ?? 0) * d;
    obj.pos.z += (G.g_coli_hit_normal[2] ?? 0) * d;
    ScriptedPushableSyncSphere33(obj);
  }
}

/**
 * `ScriptedPushableUpdate33` — `FUN_00433B70`. One frame of the object.
 *
 * Read in order, because the order is the behaviour:
 *
 * 1. **the despawn flag first**, at `tail+0x0D`. A raised flag calls
 *    `ActorDespawn` and returns, before the seed, the push and the draw;
 * 2. the seed, once, gated on `obj+0x1312` being zero and ending by
 *    *incrementing* it. It ORs bit 0 on, takes the draw slot from `tail+0x00`,
 *    and on `tail+0x04 == -1` writes `tail+0x08` to `obj+0x124` **and**
 *    `obj+0x128` — two loads of the same field, and the second is the body
 *    radius that makes the object a push target at all;
 * 3. the push flag, at `tail+0x0C`, which clears
 *    {@link SCENERY_SKIP_COLLISION}. Tested every frame, so re-clearing is
 *    idempotent — and a flag that went down again would **not** put the bit
 *    back, because the routine only ever clears;
 * 4. and the push itself, only while that bit is clear.
 *
 * Both flag indexes are used raw, with no "none" test in front of them — the
 * same shape `ScriptedCarrierUpdate33`'s two have, and for the same reason: a
 * descriptor's "no flag" is `0xFF` and nothing in the image raises
 * `g_script_flags[255]`, so it is arithmetic rather than a branch.
 */
export function ScriptedPushableUpdate33(obj: ScriptedSceneryActor,
                                         _f: ClassFrame): void {
  const t = obj.class33Push;
  if (!t) return;

  // 1. `MOV AL, byte ptr [ECX + 0xd]` / `CMP byte ptr [EAX + 0x9C7200], 0x1`
  //    at `0x00433B80`, and the `return` is before everything else.
  if (G.g_script_flags[t.despawn_flag] === 1) {
    ActorDespawn(obj);
    return;
  }

  // 2. `MOV DX, word ptr [ESI + 0x1312]` / `TEST DX, DX` / `JNZ`, and
  //    `INC EDX` on the way out.
  if (obj.sub === 0) {
    obj.flags |= SCENERY_SEEDED_BIT;
    obj.scenery.slot = t.slot;
    if (t.shot_mesh === SHOT_MESH_NONE) {
      // `obj+0x124 = obj+0x128 = tail+0x08`. Both port names for `obj+0x124`
      // are written: the engine has one field there and the port reads it
      // under `hitRadius` for the shot and `radius` for `coli`'s lazy fill.
      obj.hitRadius = t.shot_radius;
      obj.radius = t.shot_radius;
      obj.bodyRadius = t.shot_radius;
    }
    // The `tail+0x04 != -1` arm — `obj+0x34 |= 0x50` and the mesh id on
    // `obj+0x14C` — is the mesh shot test, and is in the module note as
    // unported. Neither shipped spawn takes it.
    obj.sub += 1;
  }

  // 3. `MOV DL, byte ptr [ECX + 0xc]`, then `AND AH, 0x7f` at `0x00433C00`.
  if (G.g_script_flags[t.push_flag] === 1) {
    obj.flags &= ~SCENERY_SKIP_COLLISION;
  }

  // 4. `TEST AH, 0x80` / `JNZ` past the call.
  if (!(obj.flags & SCENERY_SKIP_COLLISION)) {
    ScriptedPushableApplyPush33(obj);
  }
}
