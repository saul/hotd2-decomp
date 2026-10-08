/**
 * The head aim, drawn.
 *
 * The port decides it -- `game/class30/head_aim.ts` has the reading -- and
 * this is the last three lines of `ActorAimHeadAtCamera` (`FUN_00453BE0`),
 * which turn the matrix the node hook then draws bone 2 with:
 *
 * ```
 * 00453d3e  NEG  EDI; PUSH EDI; CALL MatrixRotateY   ; -centre
 * 00453d46  PUSH [EBX + 0x1324]; CALL MatrixRotateY  ; the head's yaw
 * 00453d52  PUSH [EBX + 0x1320]; CALL MatrixRotateX  ; the head's pitch
 * ```
 *
 * with `centre = (obj+0x68 - 0x8000) & 0xFFFF`. Every call post-multiplies, so
 * the turn is in the bone's own frame, after the pose.
 *
 * ## Only what the hook draws turns
 *
 * The hook pushed the matrix it turns and pops it when it is done, so the turn
 * reaches bone 2's own model, a gore swap's pieces and a cel -- everything the
 * hook draws -- and nothing else. The stored node matrix is untouched, and
 * that is what three other things read: `ActorDrawAttachedParts` hangs hair
 * and hats from it, `SkeletonEmitNode` takes the hit-sphere centre and the
 * camera point from it. So a turned head's hat does not turn, and a shot finds
 * the head where the pose put it.
 *
 * Turning the bone's node would turn all three. So the turn is applied the way
 * the engine applies it: around the draw. Each mesh the hook draws gets an
 * `onBeforeRender` that multiplies the turn into its `matrixWorld` -- `N R N⁻¹`
 * in front of it, `N` being the bone node's world matrix -- and an
 * `onAfterRender` that puts it back, which is the engine's push and pop
 * exactly. `WebGLRenderer.renderObject` (r169) takes `modelViewMatrix`, the
 * normal matrix and the `modelMatrix` uniform after `onBeforeRender`, so the
 * draw sees the turn and nothing after it does. The gun lights' shadow pass
 * takes `modelViewMatrix` *before* its hook, so `onBeforeShadow` recomputes it.
 *
 * "Each mesh the hook draws" is `draw_gates.ts`' answer to the same question:
 * everything under the bone's node that is not a child bone, a vertex-blended
 * part, an attachment or a held item. Bone 2 has no child bones in any
 * class-0x30 or class-0x31 skeleton, but the walk stops at one anyway.
 *
 * Render bookkeeping only: which meshes carry the hook, and the matrix the
 * last update built. The angles, the yaw and whether the hook turned the head
 * at all (`HeadAimWords.headAimed`) are the actor's, so a snapshot fully
 * determines the turn and `resync` needs nothing but the next update.
 */
import { Matrix4, type Camera, type Object3D } from "three";
import { HEAD_AIM_BONE, HEAD_AIM_FACING } from "../../game/class30/head_aim";
import type { HeadAimWords } from "../../game/class30/state";
import {
  MatIdentity, MatrixRotateX, MatrixRotateY, MatrixScale,
} from "../../game/matrix";
import { SpawnClass } from "../../game/spawn_class";
import { partNodesOf } from "./draw_gates";
import type { Instance } from "./instance";

/** One instance's turn: the matrix, the node it is relative to, and whether. */
export interface HeadTurn {
  /** The hook turned bone 2 this frame. */
  on: boolean;
  /** `Ry(-centre) Ry(yaw) Rx(pitch)`, in the bone's own frame. */
  local: Matrix4;
  /** Bone 2's node, whose world matrix the turn is relative to. */
  node: Object3D;
}

/** Which instance's turn each hooked mesh applies. */
const hooked = new WeakMap<Object3D, HeadTurn>();

/** The head-aim words of a class whose hook aims, or null. */
function aimOf(inst: Instance): HeadAimWords | null {
  const a = inst.a;
  if (a.cls === SpawnClass.Zombie || a.cls === SpawnClass.CarriedZombie) {
    return a.zom;
  }
  if (a.cls === SpawnClass.Thrower) return a.thr;
  return null;
}

const _inv = new Matrix4();

/** `matrixWorld = N R N⁻¹ matrixWorld`. */
function turnInto(o: Object3D, turn: HeadTurn): void {
  _inv.copy(turn.node.matrixWorld).invert();
  o.matrixWorld.premultiply(_inv).premultiply(turn.local)
    .premultiply(turn.node.matrixWorld);
}

/**
 * Give one mesh the push and the pop. Its own saved matrix, so a mesh drawn
 * twice in a frame -- the main pass and a gun light's shadow pass -- restores
 * each time.
 */
function hook(o: Object3D, turn: HeadTurn): void {
  hooked.set(o, turn);
  const saved = new Matrix4();
  let applied = false;
  const push = (): boolean => {
    const t = hooked.get(o);
    if (!t?.on) return false;
    saved.copy(o.matrixWorld);
    turnInto(o, t);
    applied = true;
    return true;
  };
  const pop = (): void => {
    if (!applied) return;
    o.matrixWorld.copy(saved);
    applied = false;
  };
  o.onBeforeRender = () => { push(); };
  o.onAfterRender = pop;
  o.onBeforeShadow = (_r, _o, _c, shadowCamera: Camera) => {
    if (push()) {
      o.modelViewMatrix.multiplyMatrices(shadowCamera.matrixWorldInverse,
                                         o.matrixWorld);
    }
  };
  o.onAfterShadow = pop;
}

/**
 * Apply this frame's head aim to one instance.
 *
 * Builds the turn from the actor -- `-centre`, then the yaw, then the pitch,
 * through `game/matrix.ts`'s transcriptions of the three routines so the
 * signs are the engine's -- and makes sure every mesh the hook draws carries
 * the push and pop. A gore swap or a cel can hang a new mesh under the bone
 * on any frame, so the walk runs every frame the head is turned; it is a
 * handful of nodes.
 */
export function applyHeadAim(inst: Instance): void {
  const aim = aimOf(inst);
  const node = inst.bones.get(HEAD_AIM_BONE);
  if (!aim || !node) return;
  const turn = inst.headTurn
    ?? (inst.headTurn = { on: false, local: new Matrix4(), node });
  turn.node = node;
  // ROTTEN MEAT's hook pushes a scale around the head's draw before
  // `ZombieDrawBonePart` turns it (`Actor.nodeDrawScale`), so the scale is
  // the first thing on the matrix and the turn goes on after it -- the order
  // `MatrixScale` and `MatrixRotateY` leave a vertex transformed in.
  const scale = inst.a.nodeDrawScale[HEAD_AIM_BONE] ?? null;
  turn.on = aim.headAimed || scale !== null;
  if (!turn.on) return;

  const m = MatIdentity();
  if (scale) MatrixScale(m, scale[0], scale[1], scale[2]);
  if (aim.headAimed) {
    MatrixRotateY(m, -((inst.a.yaw - HEAD_AIM_FACING) & 0xffff));
    MatrixRotateY(m, aim.headYaw);
    MatrixRotateX(m, aim.headPitch);
  }
  turn.local.fromArray(m);

  const keep = new Set<Object3D>(partNodesOf(inst).values());
  for (const n of inst.attached?.values() ?? []) keep.add(n);
  for (const n of inst.held?.values() ?? []) keep.add(n);
  const bones = new Set<Object3D>(inst.bones.values());
  const visit = (o: Object3D): void => {
    if (keep.has(o) || (o !== node && bones.has(o))) return;
    if ((o as { isMesh?: boolean }).isMesh && hooked.get(o) !== turn) {
      hook(o, turn);
    }
    for (const c of o.children) visit(c);
  };
  visit(node);
}
