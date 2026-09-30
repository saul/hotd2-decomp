/**
 * Class 0x32's node hook, drawn.
 *
 * `Class32Init` installs `Class32DrawBonePart` (`FUN_0047F780`) at
 * `model+0x1158`, and `SkeletonEmitNode` calls it **in place of** the node's
 * own `AssetDrawSlot`: every model a node of the stage-5 boss shows is one
 * the hook drew, through `Class32DrawNodeSlot` (`FUN_0047FC50`). The port
 * runs the hook in the game and leaves what it drew on the tail --
 * `Boss5Tail.nodeDraws`, by bone, each slot with the light colour it was
 * drawn under (`game/class32/draw.ts`). This hangs those models on the bones
 * and nothing else: which slot, which cel and which light are the port's.
 *
 * A node's own slot is its own primitives, shown; any other slot is a clone
 * off the character's hidden template rig (`goreEntry` carries every model
 * the hook's arms can name, `game/class32/bone_parts.ts`), hung at the bone's
 * origin -- the hook draws under the node's matrix with nothing pushed. A
 * node the hook drew nothing on -- the walk skipped it -- shows nothing.
 *
 * **The light.** A draw's colour is `SetRenderLightColour`'s, made between
 * the draw's `LightsUseSecondarySet` and `LightsRestoreScene`, so it is block
 * 1's ambient and direction under that colour: the hit flash's red or black
 * and the warm light of states 9 and 10. It goes on the model as
 * `userData.hod2_light_colour`, which `render/lighting.ts` reads; `null` is
 * block 1's own colour.
 *
 * Nothing here is state. The nodes are rebuilt from the tail every frame, so
 * `resync` needs no help.
 */
import type { Mesh, Object3D } from "three";
import { SpawnClass } from "../../game/spawn_class";
import type { Class32NodeDraw } from "../../game/class32/state";
import type { Instance } from "./instance";

/** The name every clone carries, so the bone's own children are told apart. */
export const BOSS5_DRAW_HOLDER = "boss5draw";

/** A bone's own slot: the draw record at `+0x20C`, as the build wrote it. */
function ownSlot(inst: Instance, bone: number): number {
  const over = inst.a.boneSlot[String(bone)];
  if (over !== undefined) return over;
  return inst.type.bones.find((b) => b.bone === bone)?.slot ?? 0;
}

/**
 * Tag a model with its draw's light colour. `null` is set, not left off: a
 * bone's child bones hang under it, and an untagged child would take its
 * parent's colour (`render/lighting.ts` inherits a tag down the tree).
 */
function light(o: Object3D, rgb: Class32NodeDraw["light"]): void {
  o.userData.hod2_light_colour = rgb ? [...rgb] : null;
}

/**
 * Draw or skip one node's own model. Layer 0, not `visible`: a bone's
 * children are its child bones, which `visible` would take with it -- the
 * reasoning in `render/characters/draw_gates.ts`.
 */
function drawn(o: Object3D, on: boolean): void {
  if (o.layers.isEnabled(0) === on) return;
  if (on) o.layers.enable(0);
  else o.layers.disable(0);
}

/**
 * Put this frame's hook draws on every bone of a class-0x32 boss, and its
 * part's light. `clone` makes a model from an asset slot, off the
 * character's template.
 *
 * Returns false, and touches nothing, for any other actor.
 */
export function syncBoss5NodeDraws(
    inst: Instance, clone: (slot: number) => Object3D | null): boolean {
  const a = inst.a;
  if (a.cls !== SpawnClass.Boss5) return false;
  const t = a.boss5;
  const have = inst.boss5Draws ?? (inst.boss5Draws = new Map());
  const bones = new Set(inst.bones.values());
  const seen = new Set<string>();
  for (const [bone, node] of inst.bones) {
    const list = t.nodeDraws[String(bone)] ?? [];
    const own = ownSlot(inst, bone);
    const self = list.find((d) => d.slot === own);
    // The bone's own model: drawn when the hook drew the own slot, lit as
    // that draw was. A single-primitive bone is its own mesh; a multi-
    // primitive one holds its primitives beside its child bones.
    const prims = (node as Mesh).isMesh ? [node]
      : node.children.filter((c) => !bones.has(c)
                             && c.name !== BOSS5_DRAW_HOLDER);
    for (const p of prims) {
      drawn(p, self !== undefined);
      light(p, self?.light ?? null);
    }
    list.forEach((d, i) => {
      if (d.slot === own) return;
      const key = `${bone}:${i}`;
      seen.add(key);
      let h = have.get(key);
      if (!h || h.slot !== d.slot) {
        h?.node.removeFromParent();
        const model = clone(d.slot);
        if (!model) { have.delete(key); return; }
        model.name = BOSS5_DRAW_HOLDER;
        h = { node: model, slot: d.slot };
        have.set(key, h);
      }
      if (h.node.parent !== node) node.add(h.node);
      light(h.node, d.light);
    });
  }
  for (const [key, h] of have) {
    if (seen.has(key)) continue;
    h.node.removeFromParent();
    have.delete(key);
  }
  // The part loop, after every node, under what the last node left.
  if (inst.part0) light(inst.part0, t.partLight);
  return true;
}

/** Take every hook model off `inst` and draw its own models again, for a rebuild. */
export function clearBoss5NodeDraws(inst: Instance): void {
  for (const h of inst.boss5Draws?.values() ?? []) h.node.removeFromParent();
  inst.boss5Draws?.clear();
  if (inst.a.cls !== SpawnClass.Boss5) return;
  const bones = new Set(inst.bones.values());
  for (const node of inst.bones.values()) {
    const prims = (node as Mesh).isMesh ? [node]
      : node.children.filter((c) => !bones.has(c));
    for (const p of prims) {
      drawn(p, true);
      delete p.userData.hod2_light_colour;
    }
  }
}
