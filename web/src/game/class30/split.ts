/**
 * Half a body: the zombie that is born cut in two, and the split that would
 * cut one in two in play.
 *
 * Class 0x30 has a family of routines built on one fact about its skeletons:
 * `g_character_skeletons[type]` has **two roots**, at `+0x18` and `+0x1C`. For
 * character type 0xC (`znkager`, stage 2's crawler) root 0 is bone 1 -- the
 * torso, with the head and both arms under it -- and root 1 is bone 9 with two
 * three-bone chains, bones 10 to 15. Read out of the EXE with
 * `ExeTables.character_skeleton(0xC)`. Everything below hides one root or the
 * other.
 *
 * ## What is ported, and why only that
 *
 * **`ZombieInitHalved` (`FUN_0045DA10`) is reached**, by every one of the 20
 * shipped `znkager` spawns: they all carry body condition 4, and
 * `EnemyZombieInitByCharType` sends type 0xC at condition 4 here. The actor
 * starts life with root 1 hidden, bone 9 drawing the stump `0x1DA3`, a smaller
 * body sphere, and the three bits `0x6000080` up.
 *
 * **`ZombieSplitInTwo` (`FUN_0045D9F0`) is not reached, and is not ported.**
 * It allocates a second `EnemyZombieUpdate` actor
 * (`ZombieSplitSpawnOtherHalf`, `FUN_0045DB70`), gives it root 1 and the
 * original root 0, throws the original at the camera in state 0x32
 * (`ZombieStateSplitLaunch`, `FUN_0045E010`) and lets the other half collapse
 * in state 0x33 (`ZombieStateSplitHalfCollapse`, `FUN_0045DED0`). It has three
 * callers and none of them can fire on shipped data `[proved]`:
 *
 * * `ActorReactToHit` (`FUN_004543F0`) on `g_hit_result == 4` -- and **no
 *   instruction in the image stores 4 there**. The byte pattern `f8589a00`
 *   occurs 25 times, every one of them `ResolveHit`'s 0/1/2/3/5, a read, or
 *   `ThrowerShotFeedback`'s 5; `fc589a00`, player 1's slot by name, occurs
 *   nowhere.
 * * `ZombieStateAttackRun`'s one-in-64 roll and `ZombieStateLeapStrike` past a
 *   quarter of its arc -- both gated on {@link ZombieFlag2.LowSphere} **and**
 *   {@link ZombieFlag2.SplitArmed}. The second bit's one class-0x30 writer is
 *   state 0x35, `ZombieStateCollapseToCondition4` (`FUN_0045E660`) at
 *   `0x0045E6A2`; no instruction stores 0x35 into `obj+0x1310` as a literal,
 *   and no descriptor's initial or attack state, entry tail, captor script or
 *   civilian op-0x1A order in any of the twelve stage scripts names 53. The
 *   descriptor's `+0x20` word reaches `obj+0x136C` sign-extended, and no
 *   class-0x30 descriptor sets its bit 15.
 *
 * `web/tools/checks/split_unreachable.ts` asserts all of that against the EXE and
 * the scripts, so the day any of it stops being true the check fails rather
 * than the port quietly lacking a feature the data now uses.
 */
import { ZombieFlag2, type ZombieActor } from "../actor";
import { childBones } from "../combat/resolve_hit";
import { CharacterTypeOf } from "../tables";
import {
  CHAR_ZNKAGER, HALVED_STUMP_BONE, HALVED_STUMP_SLOT,
} from "./halved";

export { CHAR_ZNKAGER, HALVED_CONDITION } from "./halved";

/**
 * `OR dword ptr [EAX + 0x136c], 0x6000080` at `0x0045DA23` -- one immediate,
 * three bits: {@link ZombieFlag2.MayFall}, {@link ZombieFlag2.LowSphere} and
 * {@link ZombieFlag2.SeverAnyBone}.
 */
const HALVED_FLAGS2 = ZombieFlag2.MayFall | ZombieFlag2.LowSphere
                    | ZombieFlag2.SeverAnyBone;
/** `FMUL float ptr [0x0056798c]` -- `cdcc4c3f`, 0.8. */
const HALVED_BODY_SCALE = 0.8;

/** `ZombieHideSkeletonRoot`'s argument: 1 names root 0, anything else root 1. */
export const SKELETON_ROOT_FIRST = 1;
/** ...and the value every caller that means root 1 passes, `PUSH 0x9`. */
export const SKELETON_ROOT_SECOND = 9;

/**
 * `ZombieInitHalved` — `FUN_0045DA10`.
 *
 * ```
 * 0045da17  FLD   [EAX + 0x128]
 * 0045da1d  FMUL  [0x0056798c]                 ; 0.8
 * 0045da23  OR    dword ptr [EAX+0x136c], 0x6000080
 * 0045da2d  FSTP  [EAX + 0x128]
 * 0045da33  CALL  ZombieHideSkeletonRoot       ; (9)
 * 0045da40  CMP   word ptr [EAX + 0x1f4], 0xc
 * 0045da4a  MOV   dword ptr [EAX + 0x71c], 0x1da3
 * ```
 *
 * The stump is written **after** the hide, so bone 9 ends up drawing it while
 * 10 to 15 draw nothing. In the port that is bone 9 back out of
 * {@link Actor.removed} and into {@link Actor.boneSlot}: the draw record's
 * `+0x00` is `removed ? 0 : boneSlot ?? skeleton`, and here the engine's own
 * last write is the slot. No `GameHost.setBoneSlot` call, because this runs
 * inside `Init`, before the character layer has an instance; its `adopt`
 * replays `boneSlot` the way it does for `ActorBindPartList`.
 */
export function ZombieInitHalved(obj: ZombieActor): void {
  obj.bodyRadius *= HALVED_BODY_SCALE;
  obj.flags2 |= HALVED_FLAGS2;
  ZombieHideSkeletonRoot(obj, SKELETON_ROOT_SECOND);
  if (obj.charType === CHAR_ZNKAGER) {
    obj.removed = obj.removed.filter((b) => b !== HALVED_STUMP_BONE);
    obj.boneSlot[String(HALVED_STUMP_BONE)] = HALVED_STUMP_SLOT;
  }
}

/**
 * `ZombieHideSkeletonRoot` — `FUN_0045DD30`.
 *
 * `ZombieHideBoneSubtree(g_character_skeletons[type] + (which == 1 ? 0x18 :
 * 0x1C))`. The bundle flattens the skeleton parents-first and root by root, in
 * the header's own order, so root *k* is the *k*-th bone with no parent.
 * A type with one root has no `+0x1C` child to hide; the engine would read
 * whatever follows the pointer, and only type 0xC ever arrives here, which has
 * two.
 */
export function ZombieHideSkeletonRoot(obj: ZombieActor, which: number): void {
  const type = CharacterTypeOf(obj);
  if (!type) return;
  const roots = type.bones.filter((b) => b.parent === null
                                      || b.parent === undefined);
  const root = roots[which === SKELETON_ROOT_FIRST ? 0 : 1];
  if (root) ZombieHideBoneSubtree(obj, root.bone);
}

/**
 * `ZombieHideBoneSubtree` — `FUN_0045DD70`. A bone and everything under it.
 *
 * The engine writes three fields of each bone's draw record:
 *
 * ```
 * 0045dd88  MOV dword ptr [EAX + ECX*0x1 + 0x280], 0x20   ; +0x74
 *           MOV dword ptr [.. + 0x20c], 0x0               ; +0x00, the slot
 *           MOV dword ptr [.. + 0x284], 0x0               ; +0x78
 * ```
 *
 * which is `RemoveBoneSubtree`'s shape without the damage-zone bit -- so it is
 * {@link Actor.removed} here too, and nothing goes into `obj.zones`. The
 * `+0x74` write is an **assignment**, so the `0x80000000` latch
 * ({@link Actor.latched}) goes with it; what bit `0x20` of that word is for
 * is `[open]`, as no reader of it has been found. `+0x78` is the field
 * `RemoveBoneSubtree` also zeroes and the port models for neither.
 */
export function ZombieHideBoneSubtree(obj: ZombieActor, bone: number): void {
  if (!obj.removed.includes(bone)) obj.removed.push(bone);
  obj.latched = obj.latched.filter((b) => b !== bone);
  const type = CharacterTypeOf(obj);
  if (!type) return;
  for (const b of childBones(type, bone)) ZombieHideBoneSubtree(obj, b);
}
