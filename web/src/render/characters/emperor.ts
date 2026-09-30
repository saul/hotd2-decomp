/**
 * Class 0x2D's skeletons -- the stage-6 boss, its four children and kind 0's
 * wing -- drawn from the model block the port posed (`game/skeleton.ts`).
 *
 * `DrawSkinnedModelAndShadow` (`FUN_00411090`) is the draw, and for the boss
 * and the children the walk hands every node to the class's hook
 * (`Class2DNodeDrawHook`, `Class2DChildNodeDrawHook`,
 * `Class2DChildKind2NodeDrawHook`), which draws the node's model itself --
 * those are in `G.g_class2d_draws` and `render/class2d_draws.ts` draws them.
 * What the walk draws on its own is the vertex-blended parts
 * (`DrawCharacterPartSlot`, `FUN_00419B40`) and, for the wing, which has no
 * hook, every node. So this layer poses the whole skeleton on the block's
 * matrices and shows:
 *
 * * the nodes' own models only for the wing;
 * * each part behind its byte (`Actor.partVisible`), at the boss's alpha
 *   `obj+0x1370` for `boss6.bin` (the `0x4C` arm's `AssetDrawSlotWithAlpha`)
 *   and plainly for the rest, with its UVs rewritten from its normals for
 *   the types whose arm calls `AssetSlotUVsFromViewNormals` first -- 0x4C,
 *   0x4D, 0x4E, 0x4F and 0x51 (the byte map at `0x00419DE8`), not 0x50;
 * * `boss6.bin`'s parts 0..5 with their shells after them, as the `0x4C` arm
 *   draws them (the pair table at `0x004EDA50`): a whole model under the
 *   part's matrix, which is its draw bone's, at the same alpha and with the
 *   same UV rewrite;
 * * under the light set the draw routine installed around the walk, which
 *   the class leaves on the object (`Class2DTail.drawLight`).
 */
import { Matrix4, type Mesh, type Object3D } from "three";
import type { Actor, EmperorActor } from "../../game/actor";
import { SpawnClass } from "../../game/spawn_class";
import { CLASS2D_PART_SHELLS, Class2DRoutine } from "../../game/class2D/state";
import { setAssetDrawAlpha } from "../draw_order";
import { rewriteEnvUvs, setLight } from "../class2d_draws";
import { partNodesOf } from "./draw_gates";
import type { Instance } from "./instance";

/** The part arms that rewrite the UVs first: `0x00419C41` and `0x00419C82`. */
const ENV_UV_PART_TYPES: readonly number[] = [0x4c, 0x4d, 0x4e, 0x4f, 0x51];
/** `boss6.bin`, whose parts are drawn at `obj+0x1370` with shells. */
const BOSS_TYPE = 0x4c;

const _view = new Matrix4();
/** The shells hung on one instance's draw bones, by part. Render bookkeeping. */
const shellsOf = new WeakMap<Instance, Map<number, Object3D | null>>();

/** The world matrix every bone of a class-0x2D actor is drawn with. */
export function EmperorDrawMatrices(a: Actor, out: Map<number, Matrix4>):
    boolean {
  if (a.cls !== SpawnClass.Emperor || !a.skel) return false;
  for (let b = 1; b < a.skel.bones.length; b++) {
    const r = a.skel.bones[b];
    if (!r) continue;
    const m = out.get(b) ?? new Matrix4();
    out.set(b, m.fromArray(r.mat));
  }
  return true;
}

/**
 * The shell for each of `boss6.bin`'s parts 0..5, cloned once from the
 * type's template and hung on the part's draw bone with no offset of its
 * own. A shell the bundle does not carry is `null`, asked for once.
 */
function partShells(inst: Instance,
                    cloneSlot: (slot: number) => Object3D | null):
    Map<number, Object3D | null> {
  let m = shellsOf.get(inst);
  if (m) return m;
  m = new Map();
  CLASS2D_PART_SHELLS.forEach((slot, i) => {
    const part = inst.type.parts?.[i];
    const bone = part ? inst.bones.get(part.draw_bone) : undefined;
    const c = bone ? cloneSlot(slot) : null;
    if (c && bone) bone.add(c);
    m!.set(i, c);
  });
  shellsOf.set(inst, m);
  return m;
}

/**
 * Everything but the pose: which meshes show, the parts' alpha, UVs and
 * shells, and the light set. `w2v` is the camera's world-to-view matrix,
 * sixteen floats in `Matrix4.elements`' layout.
 */
export function drawEmperor(inst: Instance, w2v: ArrayLike<number>,
                            cloneSlot: (slot: number) => Object3D | null):
    void {
  if (inst.a.cls !== SpawnClass.Emperor) return;
  const a = inst.a as EmperorActor;
  const parts = partNodesOf(inst);
  const boss = a.charType === BOSS_TYPE;
  const shells = boss ? partShells(inst, cloneSlot) : null;
  const keep = new Set<Object3D>(parts.values());
  for (const s of shells?.values() ?? []) if (s) keep.add(s);
  // The nodes' own models: layer 0 off for every mesh that is not a part's
  // or a shell's, on the wing's, whose walk draws them.
  const hooked = a.class2d.routine !== Class2DRoutine.Wing;
  const visit = (o: Object3D): void => {
    if (keep.has(o)) return;
    if ((o as Mesh).isMesh) {
      if (hooked) o.layers.disable(0);
      else o.layers.enable(0);
    }
    for (const c of o.children) visit(c);
  };
  visit(inst.pivot);
  const envUv = ENV_UV_PART_TYPES.includes(a.charType);
  const alpha = boss ? a.class2d.boss?.alpha ?? 1 : null;
  _view.fromArray(w2v as number[]);
  for (const [i, node] of parts) {
    node.visible = (a.partVisible[i] ?? 1) !== 0;
    setAssetDrawAlpha(node, alpha);
    if (envUv && node.visible) rewriteEnvUvs(node, _view);
    const shell = shells?.get(i);
    if (shell) {
      shell.visible = node.visible;
      setAssetDrawAlpha(shell, alpha);
      if (shell.visible) rewriteEnvUvs(shell, _view);
    }
  }
  setLight(inst.root, a.class2d.drawLight);
}
