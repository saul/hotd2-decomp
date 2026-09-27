/**
 * What of a character is drawn this frame, applied.
 *
 * The port decides it — `game/model_draw.ts` has the reading — and there are
 * three gates, not one:
 *
 * * **The skeleton.** `SkeletonEmitNode` (`FUN_004114C0`) calls a node's draw
 *   hook only while `model+0x64` bit 0 is up, {@link MotionFlag.DrawSkeleton}.
 *   Everything the hook draws goes with it: each bone's own model, a gore
 *   swap's pieces, the cels `ZombieDrawBonePart` (`FUN_004534A0`) adds. The
 *   veto (`SkeletonNodeDrawSuppressed`, `FUN_004122E0`) takes one bone's
 *   own model off on top of that, and the thrower's hook draws each bone at
 *   the alpha `ThrowerDrawBonePart` (`FUN_00449F90`) chose for it.
 * * **The vertex-blended parts**, by index, `Actor.partVisible` — the
 *   exporter's `part<i>_<slot>` nodes, which are the waist and the skirt and
 *   are not bones. `DrawCharacterPartSlot` (`FUN_00419B40`) draws four
 *   character types' parts at `obj+0x138C` — {@link PART_ALPHA_CHAR_TYPES}.
 * * **Nothing gates the attachments.** `ActorDrawAttachedParts`
 *   (`FUN_004124F0`) runs after the walk with no test at all, so a hair or a
 *   held item under a bone is left alone here even when the bone is not.
 *
 * `visible = false` on a bone would take its child bones with it; the veto
 * found that first. `WebGLRenderer.projectObject` returns early on
 * `visible === false` but only *skips the draw* on a failed `layers.test`,
 * and recurses into the children either way — so clearing layer 0 on each
 * mesh the hook would draw hides exactly those and nothing below them.
 *
 * No alpha is blended: a bone or part whose alpha is 0 is not drawn and any
 * other alpha is drawn solid. That is every alpha the shipped game gives one
 * — see `ThrowerDrawBonePart`.
 */
import type { Object3D } from "three";
import { MotionFlag } from "../../game/actor";
import { PART_ALPHA_CHAR_TYPES } from "../../game/model_draw";
import { SpawnClass } from "../../game/spawn_class";
import type { Instance } from "./instance";

/** The exporter's name for vertex-blended part *i*: `..._part<i>_<slot>`. */
const PART_NODE = /_part(\d+)_[0-9a-f]{4}$/;

/**
 * The vertex-blended part nodes of one instance, by part index.
 *
 * Render bookkeeping: found once by name under the pivot, where the loader
 * moved every top-level node of the rig, and cached on the instance.
 */
export function partNodesOf(inst: Instance): Map<number, Object3D> {
  if (inst.partNodes) return inst.partNodes;
  const out = new Map<number, Object3D>();
  for (const c of inst.pivot.children) {
    const m = PART_NODE.exec(c.name);
    if (m) out.set(Number(m[1]), c);
  }
  inst.partNodes = out;
  return out;
}

/**
 * Whether `obj+0x138C` is the draw that the renderer's whole-actor gate
 * reads.
 *
 * [port-only] Three classes — 0x22, 0x23 and 0x40 — write `Actor.alpha` as
 * "the draw ran this frame", which the engine says by running the draw or
 * not; for them it is a whole-actor gate and nothing else. For the two classes
 * whose `obj+0x138C` is the engine's own draw alpha it is read per bone and
 * per part below, and closing the whole actor on it would take the
 * attachments and every part the engine still draws with it.
 */
export function alphaGatesWholeActor(inst: Instance): boolean {
  const cls = inst.a.cls;
  return cls !== SpawnClass.Zombie && cls !== SpawnClass.CarriedZombie
    && cls !== SpawnClass.Thrower;
}

function setLayer0(o: Object3D, on: boolean): void {
  if (o.layers.isEnabled(0) === on) return;
  if (on) o.layers.enable(0);
  else o.layers.disable(0);
}

/**
 * Apply all three gates to one instance.
 *
 * Cheap when nothing is closed: the key says so and the walk is skipped. While
 * anything is closed the walk runs every frame, because a gore swap or a cel
 * can hang a new mesh under a bone on any frame and it has to arrive hidden.
 * `inst.gates` is the key and nothing else — `resync` clears it.
 */
export function applyDrawGates(inst: Instance): void {
  const a = inst.a;

  // The parts. Absent from `partVisible` means the port never built this
  // actor's model record, and the build writes 1.
  const partAlpha = PART_ALPHA_CHAR_TYPES.includes(a.charType) ? a.alpha : 1;
  for (const [i, node] of partNodesOf(inst)) {
    node.visible = (a.partVisible[i] ?? 1) !== 0 && partAlpha > 0;
  }

  // The skeleton, the veto and the hook's alpha.
  const skeleton = (a.motionFlags & MotionFlag.DrawSkeleton) !== 0;
  const alphas = a.cls === SpawnClass.Thrower ? a.thr.boneDrawAlpha : null;
  const drawn = (bone: number): boolean =>
    skeleton && (alphas === null || (alphas[bone] ?? 1) > 0);
  const veto = a.suppressedBones;
  let open = skeleton;
  if (open && alphas) {
    for (const bone of inst.bones.keys()) {
      if (!drawn(bone)) { open = false; break; }
    }
  }
  const key = open ? `open:${veto}` : undefined;
  if (key !== undefined && inst.gates === key) return;

  const keep = new Set<Object3D>(partNodesOf(inst).values());
  for (const n of inst.attached?.values() ?? []) keep.add(n);
  for (const n of inst.held?.values() ?? []) keep.add(n);
  const boneOf = new Map<Object3D, number>();
  for (const [bone, node] of inst.bones) boneOf.set(node, bone);

  const visit = (o: Object3D, owner: number): void => {
    if (keep.has(o)) return;
    const bone = boneOf.get(o);
    if (bone !== undefined) {
      owner = bone;
      setLayer0(o, drawn(bone) && (veto & (1 << bone)) === 0);
    } else if (owner >= 0) {
      setLayer0(o, drawn(owner));
    }
    for (const c of o.children) visit(c, owner);
  };
  visit(inst.pivot, -1);
  inst.gates = key;
}
