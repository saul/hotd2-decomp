/**
 * The veto: when a part is drawn soft, the rigid twin is not drawn.
 *
 * A character draws one model per skeleton node, and on top of that up to two
 * **vertex-blended parts** — `g_pCharacterExtraParts` (`0x0052ED08`), the
 * waist and the skirt. The skirt's asset slot *is the pelvis model*, so
 * drawing bone 9 as well would draw it twice, in two different poses.
 * `SkeletonNodeDrawSuppressed` (`FUN_004122E0`) is what stops that:
 * `SkeletonEmitNode` (`FUN_004114C0`) asks it before it calls the node draw
 * hook at `obj+0x1158`, and takes the draw only when the answer is zero.
 *
 * The predicate, read out of the disassembly rather than the decompiler's
 * switch reconstruction:
 *
 * ```
 * 004122E8  CMP  word ptr [ECX + 0x60], 0x17     ; character type
 * 004122F3  CMP  word ptr [EDX + 0x14], 0x10     ; node's bone
 * 004122F8  SETGE AL                             ; type 0x17: bone >= 16
 * 00412300  CMP  word ptr [ECX + 0x14], 0x9      ; otherwise: bone == 9 only
 * 0041230D  MOV  ECX, dword ptr [EDX + 0x510]    ; bone_records[9].slot
 * ```
 *
 * and then ten literal slot comparisons. **It tests the slot bone 9 is
 * currently drawing, not the one the skeleton names** — so a swap would change
 * the answer, which is why this is evaluated every frame rather than baked
 * into the export.
 */
import type { Actor } from "./actor";
import { T } from "./tables";

/**
 * The ten slots `SkeletonNodeDrawSuppressed` vetoes bone 9 for, enumerated out
 * of the jump table at `0x00412360` and its byte map at `0x00412368` rather
 * than out of the decompiler.
 *
 * They are exactly the bone-9 slots of the ten character types whose
 * vertex-blended part 1 draws that same slot — `0x21`, `0x22`, `0x26`, `0x28`,
 * `0x29`, `0x2A`, `0x2C`, `0x2D`, `0x35` and `0x3B` — one for one, with no
 * stray in either direction. The exe carries the list, not the rule, so the
 * port carries the list.
 */
export const PELVIS_VETO_SLOTS: readonly number[] = [
  0x0e3c, 0x0e4d, 0x0ea2, 0x0eb6, 0x0ec6,
  0x0ed6, 0x0ef6, 0x0f06, 0x0f83, 0x15b0,
];

/** The bone the ten literals are about. `CMP word ptr [ECX+0x14], 0x9`. */
export const PELVIS_BONE = 9;

/**
 * Character type `0x17`, whose rule is the other arm of the same routine:
 * every bone from 16 up, because `BuildCharacterPartSubparts` (`FUN_00419EB0`)
 * replaces those eight with sub-parts of its own.
 */
export const SUBPART_CHAR_TYPE = 0x17;
export const SUBPART_FIRST_BONE = 0x10;

/**
 * `SkeletonNodeDrawSuppressed` — `FUN_004122E0`.
 *
 * [diverges] The `charType == 0x17` arm is **not** taken. That arm suppresses
 * bones 16 to 23 because `BuildCharacterPartSubparts` draws eight sub-parts in
 * their place, from `g_class17_subpart_records` (`0x0052EA38`) through a
 * second mechanism this port does not have. Vetoing them without the
 * replacement would delete eight bones of a `zskamere` rather than redraw
 * them, which is worse than the double draw the veto exists to prevent. The
 * bone-9 arm is exact.
 */
export function SkeletonNodeDrawSuppressed(obj: Actor, bone: number,
                                           slot: number): boolean {
  if (obj.charType === SUBPART_CHAR_TYPE) return false;
  if (bone !== PELVIS_BONE) return false;
  return PELVIS_VETO_SLOTS.includes(slot);
}

/**
 * The bones whose own draw is vetoed this frame, as a bit per bone.
 *
 * [port-only] The engine has no such field: it asks the predicate per node
 * inside the draw walk, and the port has no draw walk in `game/`. The answer
 * still has to be the port's — `verify_layers.py`'s `render-drives-the-port`
 * is the rule, and it is the right one here, because the input is actor state
 * that a gore swap can change. So it is computed once a frame and read as
 * state, the same shape `Actor.removed` has.
 *
 * A mask rather than an array because it is recomputed every frame for every
 * actor and an array would be an allocation each time; bones run 1..23, so a
 * `number` holds all of them and a snapshot carries it for free.
 */
export function ActorUpdateSuppressedBones(obj: Actor): void {
  const type = T.types[String(obj.charType)];
  let mask = 0;
  if (type) {
    // `bone_records[9].slot` -- what bone 9 is *currently* drawing, which is
    // the swap if one has happened and the skeleton's own slot otherwise.
    const swapped = obj.boneSlot[String(PELVIS_BONE)];
    const authored = type.bones.find((b) => b.bone === PELVIS_BONE)?.slot ?? 0;
    const slot = swapped ?? authored;
    if (SkeletonNodeDrawSuppressed(obj, PELVIS_BONE, slot)) {
      mask |= 1 << PELVIS_BONE;
    }
  }
  obj.suppressedBones = mask;
}
