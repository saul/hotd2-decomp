/**
 * What of a character is drawn this frame, and how, applied.
 *
 * The port decides it — `game/model_draw.ts` has the reading — and there are
 * three gates, not one, and a draw per node:
 *
 * * **The skeleton.** `SkeletonEmitNode` (`FUN_004114C0`) calls a node's draw
 *   hook only while `model+0x64` bit 0 is up, {@link MotionFlag.Drawn}.
 *   Everything the hook draws goes with it: each bone's own model, a gore
 *   swap's pieces, the cels `ZombieDrawBonePart` (`FUN_004534A0`) adds. The
 *   veto (`SkeletonNodeDrawSuppressed`, `FUN_004122E0`) takes one bone's
 *   own model off on top of that.
 * * **The hook's draw.** A class's hook draws each node either plainly
 *   (`AssetDrawSlot`, `FUN_00418560`) or faded (`AssetDrawSlotWithAlpha`,
 *   `FUN_004185A0`), and the port's hooks write which into
 *   `Actor.nodeDrawAlpha`: `ZombieDrawBonePart` through
 *   `ZombieSubmitSlotByLighting` (`FUN_00453AE0`), `ThrowerDrawBonePart`
 *   (`FUN_00449F90`) through `ThrowerDrawPartWithAlpha` (`FUN_0044A240`).
 *   Everything the hook draws for the node -- its own model, a gore piece, a
 *   cel -- is drawn the same way, because every arm of both hooks ends in the
 *   one routine that picks.
 * * **The vertex-blended parts**, by index, `Actor.partVisible` — the
 *   exporter's `part<i>_<slot>` nodes, which are the waist and the skirt and
 *   are not bones. `DrawCharacterPartSlot` (`FUN_00419B40`) draws four
 *   character types' parts at `obj+0x138C` and every other type's plainly —
 *   {@link PART_ALPHA_CHAR_TYPES}.
 * * **Nothing gates the attachments.** `ActorDrawAttachedParts`
 *   (`FUN_004124F0`) runs after the walk with no test at all and draws each
 *   through `AssetDrawSlot`, so a hair or a held item under a bone is left
 *   alone here even when the bone is hidden or faded.
 *
 * **A faded draw is the forced blend at any alpha, 0 and 1 included** — see
 * `setMeshDrawAlpha` in `render/draw_order.ts`. This file used to draw any
 * alpha above 0 solid and hide a bone at 0, on the reading that 0 and 1 were
 * every alpha the game gives one. They are not: the twin is drawn at 0.25 and
 * fades to nothing, `znele` fades in from 0 over thirty frames, and
 * `zskamere`'s bone 9 pulses on a 120-frame triangle while it blinks. And at 1
 * the forced blend is still not the plain draw -- it shows an opaque-pass
 * mesh's texture alpha -- while at 0 the engine still draws, invisibly, and
 * writes depth.
 *
 * `visible = false` on a bone would take its child bones with it; the veto
 * found that first. `WebGLRenderer.projectObject` returns early on
 * `visible === false` but only *skips the draw* on a failed `layers.test`,
 * and recurses into the children either way — so clearing layer 0 on each
 * mesh the hook would draw hides exactly those and nothing below them. The
 * fade is per mesh for the same reason.
 */
import type { Mesh, Object3D } from "three";
import { MotionFlag } from "../../game/actor";
import { PART_ALPHA_CHAR_TYPES } from "../../game/model_draw";
import { SpawnClass } from "../../game/spawn_class";
import { setAssetDrawAlpha, setMeshDrawAlpha } from "../draw_order";
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
 * not; for them it is a whole-actor gate and nothing else. For the classes
 * whose `obj+0x138C` is the engine's own draw alpha it is read per node and
 * per part below, and closing the whole actor on it would take the
 * attachments and every part the engine still draws with it.
 */
export function alphaGatesWholeActor(inst: Instance): boolean {
  const cls = inst.a.cls;
  return cls !== SpawnClass.Zombie && cls !== SpawnClass.CarriedZombie
    && cls !== SpawnClass.Thrower;
}

/**
 * The draw `DrawCharacterPartSlot` (`FUN_00419B40`) gives this instance's
 * vertex-blended parts: `obj+0x138C` for the four types its switch sends to
 * `AssetDrawSlotWithAlpha` or `FUN_00418620`, with no other test, and `null`
 * -- the plain draw -- for every other.
 */
export function partDrawAlpha(inst: Instance): number | null {
  if (alphaGatesWholeActor(inst)) return null;
  return PART_ALPHA_CHAR_TYPES.includes(inst.a.charType) ? inst.a.alpha : null;
}

function setLayer0(o: Object3D, on: boolean): void {
  if (o.layers.isEnabled(0) === on) return;
  if (on) o.layers.enable(0);
  else o.layers.disable(0);
}

/**
 * Apply every gate and every node's draw to one instance.
 *
 * Cheap when nothing is closed and nothing is faded: the key says so and the
 * walk is skipped. Otherwise the walk runs every frame, because a gore swap
 * or a cel can hang a new mesh under a bone on any frame and it has to
 * arrive hidden or faded, and a fade's alpha moves. `inst.gates` is the key
 * and nothing else — `resync` clears it.
 */
export function applyDrawGates(inst: Instance): void {
  const a = inst.a;

  // The parts. Absent from `partVisible` means the port never built this
  // actor's model record, and the build writes 1.
  const partAlpha = partDrawAlpha(inst);
  for (const [i, node] of partNodesOf(inst)) {
    node.visible = (a.partVisible[i] ?? 1) !== 0;
    setAssetDrawAlpha(node, partAlpha);
  }

  // The skeleton, the veto and the hook's draw.
  const skeleton = (a.motionFlags & MotionFlag.Drawn) !== 0;
  const alphas = a.nodeDrawAlpha;
  const alphaOf = (bone: number): number | null => alphas[bone] ?? null;
  const veto = a.suppressedBones;
  let fading = false;
  for (const bone of inst.bones.keys()) {
    if (alphaOf(bone) !== null) { fading = true; break; }
  }
  const key = skeleton && !fading ? `open:${veto}` : undefined;
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
      setLayer0(o, skeleton && (veto & (1 << bone)) === 0);
    } else if (owner >= 0) {
      setLayer0(o, skeleton);
    }
    if (owner >= 0 && (o as Mesh).isMesh) {
      setMeshDrawAlpha(o as Mesh, alphaOf(owner));
    }
    for (const c of o.children) visit(c, owner);
  };
  visit(inst.pivot, -1);
  inst.gates = key;
}
