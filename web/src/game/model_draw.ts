/**
 * What of a skinned actor is drawn, as state.
 *
 * `DrawSkinnedModelAndShadow` (`FUN_00411090`) is four calls, not three:
 *
 * ```
 * 00411092  CALL 0x004a9880        ; MatrixStackPush(0)
 * 004110a6  CALL 0x004110d0        ; SkeletonDrawWalk(model, pos, nodes)
 * 004110ad  CALL 0x004a9840        ; MatrixStackPop(1)
 * 004110b2  MOV  EAX, [0x009a26a0] ; g_cur_actor
 * 004110b8  CALL 0x0040a590        ; ActorDrawShadow(g_cur_actor)
 * ```
 *
 * The last one sits past the `MatrixStackPop` Ghidra has marked no-return,
 * which is why the decompiler, the TSV and two docs all said the routine drew
 * no shadow (`L35`). `[proved]`
 *
 * Three things then decide what is drawn, and **none of them is an alpha for
 * the whole actor**:
 *
 * 1. `model+0x64` bit 0 — {@link MotionFlag.Drawn}. `SkeletonEmitNode`
 *    (`FUN_004114C0`) calls the node draw hook only while it is set, and the
 *    shadow reads it too. This is the skeleton, every node of it.
 * 2. `model+0x40`'s part bytes — {@link Actor.partVisible}. `SkeletonDrawWalk`
 *    (`FUN_004110D0`) draws vertex-blended part *i* only while byte `+1` of
 *    record *i* is set.
 *    These are `g_pCharacterExtraParts`' waist and skirt, which no node names;
 *    part *i* is not bone *i*.
 * 3. The class's node hook at `model+0x1158`, which decides how each node is
 *    drawn — `ThrowerDrawBonePart` (`FUN_00449F90`) draws a class-0x31 bone
 *    at `obj+0x138C` while `obj+0x136C` bit 2 is up.
 *
 * The attachment list at `model+0x1170` (`ActorDrawAttachedParts`,
 * `FUN_004124F0`) is run after all of it **with no gate at all**, so an
 * actor whose skeleton and parts are both hidden still draws what is attached
 * to it.
 *
 * The matrices, the draws and the `+0` "has a model" byte beside each part's
 * visibility byte are `render/`'s -- or `game/skeleton.ts`'s, for an actor
 * that carries the model block. What is here is the half that is state, or
 * that writes state: the gates, and the walk a class's hook is called from.
 */
import type { CharacterBone, CharacterType } from "../bundle";
import { ActorFlag, MotionFlag, type Actor } from "./actor";
import { SkeletonNodeDrawSuppressed } from "./parts";
import { CharacterTypeOf } from "./tables";

/**
 * `ActorSetPartVisibility` — `FUN_00409D10`.
 *
 * Writes one byte into every vertex-blended part of the model — `model+0x3C`
 * of them, the byte at `model+0x40 + i*8 - 7` for `i` from 1, which is byte
 * `+1` of record `i - 1` — and does nothing at all for a value other than 0
 * or 1:
 *
 * ```
 * 00409d15  CMP  EDX, 0x1 / JZ         ; 1 ...
 * 00409d1a  TEST EDX, EDX / JNZ exit   ; ... or 0, or nothing
 * 00409d2f  MOV  byte ptr [ESI + EAX*0x8 + -0x7], DL
 * ```
 *
 * `[proved]`. Ten calls in the image, eight of them in the list Ghidra gives
 * and two more in class 0x30 state 28 (`0x004586E0`), which Ghidra has no
 * function for: `ZombieStateCorpseBlink` twice, `ZombieStateEmerge` twice,
 * `ZombieStateWaitForCameraFrame` twice, state 28 twice, and the unnamed
 * routines at `0x0045DBC0` and `0x00480810` (the latter installed by class
 * 0x32's `0x004807B0`) once each. Every caller that hides an actor
 * also clears {@link MotionFlag.Drawn}, because this reaches the parts
 * and not the skeleton.
 */
export function ActorSetPartVisibility(obj: Actor, visible: number): void {
  if (visible !== 1 && visible !== 0) return;
  for (let i = 0; i < obj.partVisible.length; i++) obj.partVisible[i] = visible;
}

/**
 * What a class's node draw hook — `model+0x1158`, installed at `obj+0x12EC`
 * by the class's `Init` — is handed: the node's bone and the slot its draw
 * record holds this frame.
 */
export type NodeDrawHook = (obj: Actor, bone: number, slot: number) => void;

/**
 * The slot a node's draw record holds: `obj+0x20C + bone*0x90`, `+0`.
 *
 * [port-only] A lookup, not a routine. The record is the skeleton's own slot
 * until a swap writes it — `obj.boneSlot` — and zero once `RemoveBoneSubtree`
 * (`FUN_00409AF0`) has taken the bone off, which the port keeps as
 * `obj.removed` instead.
 */
function nodeSlotOf(obj: Actor, node: CharacterBone): number {
  if (obj.removed.includes(node.bone)) return 0;
  return obj.boneSlot[String(node.bone)] ?? node.slot;
}

/**
 * The node half of `SkeletonDrawWalk` (`FUN_004110D0`) and `SkeletonEmitNode`
 * (`FUN_004114C0`): every node the engine would hand the class's draw hook,
 * handed to it, in the engine's order.
 *
 * [port-only] as a function. Those two routines are ported whole in
 * `game/skeleton.ts` — pose, matrices and all — for an actor that carries
 * the model block, which class 0x14 does and classes 0x30 and 0x31 do not:
 * their pose is still `render/`'s. What their hooks write back is state, and
 * the renderer may not call into the port, so the part of the walk the hook
 * sees is here for them: the order, and the gate.
 *
 * The order is the skeleton's own. The engine walks
 * `g_character_skeletons[type]`'s roots in order and recurses depth-first;
 * the exporter flattened the same tree the same way
 * (`ExeTables.characterSkeleton`), so `CharacterType.bones` is this walk's
 * order and a node's `parent` is an index into it.
 *
 * The gate is `SkeletonEmitNode`'s:
 *
 * ```
 * 004114f2  MOV  EAX, dword ptr [ESI]            ; the draw record's slot
 * 004114f7  TEST EAX, EAX / JZ 0x004116cc        ; none: skip to the children
 * 004114ff  MOV  ECX, [0x009ca0a0]               ; g_skeleton_model
 * 00411505  TEST byte ptr [ECX + 0x64], 0x1      ; MotionFlag.Drawn
 * 00411509  JZ   0x004116cc
 * 00411510  CALL 0x004122e0                      ; SkeletonNodeDrawSuppressed
 * 0041151a  JNZ  ...
 * 00411523  CALL dword ptr [EDX + 0x1158]        ; the hook
 * ```
 *
 * `[proved]`. `0x004116CC` is the recursion into the children, so a closed
 * gate stops the draw and not the walk. The tracked bone's world point and
 * each bone's sphere centre, which the same gate skips, are the renderer's
 * pose for these classes; every state that closes the gate also raises
 * `obj+0x34` bits that take the actor out of the camera and the shot test.
 */
export function ActorRunNodeDrawHooks(obj: Actor, hook: NodeDrawHook): void {
  const type = CharacterTypeOf(obj);
  if (!type) return;
  for (let i = 0; i < type.bones.length; i++) {
    if (type.bones[i].parent === null) emitNodeHook(obj, type, i, hook);
  }
}

/** One node and its subtree, for {@link ActorRunNodeDrawHooks}. */
function emitNodeHook(obj: Actor, type: CharacterType, index: number,
                      hook: NodeDrawHook): void {
  const node = type.bones[index];
  const slot = nodeSlotOf(obj, node);
  if (slot !== 0 && (obj.motionFlags & MotionFlag.Drawn) !== 0
      && !SkeletonNodeDrawSuppressed(obj, node.bone, slot)) {
    hook(obj, node.bone, slot);
  }
  for (let j = index + 1; j < type.bones.length; j++) {
    if (type.bones[j].parent === index) emitNodeHook(obj, type, j, hook);
  }
}

/**
 * The character types whose vertex-blended parts `DrawCharacterPartSlot`
 * (`FUN_00419B40`) draws **at `obj+0x138C`** rather than solid.
 *
 * Its switch is `type - 9` through the byte map at `0x00419DE8` into the
 * jump table at `0x00419DCC`: type 9 lands on `0x00419C09`, 0x12 on
 * `0x00419C15`, 0x17 on `0x00419B9A` and 0x18 on `0x00419BC6`, and all four
 * end in `AssetDrawSlotWithAlpha(slot, obj+0x138C)` (`FUN_004185A0`) or its
 * lit twin `FUN_00418620` — with no test of `obj+0x136C` bit 2. Every other
 * type in `9..0x52` goes to the default arm, or to `0x4C`'s own, which reads
 * `obj+0x1370` instead. `[proved]`
 *
 * A constant because the renderer applies it and may not call into the port:
 * the choice of draw primitive is the renderer's half of the routine.
 */
export const PART_ALPHA_CHAR_TYPES: readonly number[] = [0x09, 0x12, 0x17, 0x18];

/** `ActorDrawShadow`'s ellipse, `MatrixScale(w, 1.0, d)` over slot `0x10D0`. */
export interface ShadowEllipse {
  /** x scale — `11.0`, or `50.0` for the two large types. */
  w: number;
  /** z scale — `10.0`, or `30.0`. */
  d: number;
}

/** `0x41300000` / `0x41200000` at `0x0040A5BA`: every other character type. */
const SHADOW_SMALL: ShadowEllipse = { w: 11, d: 10 };
/** `0x42480000` / `0x41F00000` at `0x0040A5CC`: character types 0x44, 0x47. */
const SHADOW_LARGE: ShadowEllipse = { w: 50, d: 30 };
/** The two types that get {@link SHADOW_LARGE} — `CMP AX, 0x44` / `0x47`. */
const SHADOW_LARGE_TYPES: readonly number[] = [0x44, 0x47];

/**
 * `ActorDrawShadow` — `FUN_0040A590`, the gate and the size.
 *
 * ```
 * 0040a595  TEST dword ptr [ECX + 0x34], 0x80000   ; ActorFlag.NoShadow
 * 0040a59c  JNZ  exit
 * 0040a59e  TEST byte ptr [ECX + 0x1f8], 0x1       ; MotionFlag.Drawn
 * 0040a5a5  JZ   exit
 * 0040a5a7  MOV  AX, word ptr [ECX + 0x1f4]        ; character type
 * ```
 *
 * then `ActorDrawGroundShadow(obj, w, d)` (`FUN_0040A620`) — the second
 * argument is the x scale, pushed after the third. `[proved]`
 *
 * Returns the ellipse the engine would draw, or `null` for none. **The port
 * does not draw a character's ground shadow** — no class calls this yet and
 * `render/` has no disc for it — so this is the gate, transcribed and tested,
 * for the renderer to be handed when it does. What it answers is the second
 * reader of the two bits every hiding state writes: a blinking corpse's
 * shadow blinks with it, and a captor held off screen has none.
 */
export function ActorDrawShadow(obj: Actor): Readonly<ShadowEllipse> | null {
  if ((obj.flags & ActorFlag.NoShadow) !== 0) return null;
  if ((obj.motionFlags & MotionFlag.Drawn) === 0) return null;
  return SHADOW_LARGE_TYPES.includes(obj.charType) ? SHADOW_LARGE : SHADOW_SMALL;
}
