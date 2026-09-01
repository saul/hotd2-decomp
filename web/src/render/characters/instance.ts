/**
 * One assembled character: the game object, the bundle data, and the nodes.
 *
 * Split out so the posing half can name it without importing the layer that
 * owns it. Everything mutable here is either a live reference to an `Actor` —
 * whose state is the port's and goes in the snapshot — or three.js nodes,
 * which are the renderer's and do not.
 */
import type { Group, Object3D } from "three";
import type { Actor } from "../../game/actor";
import type { CharacterType } from "../../bundle";

export interface Instance {
  /** evt offset of the spawn descriptor — the identity the walker uses. */
  at: number;
  /** The game object. All state is here; this is a live reference to it. */
  a: Actor;
  /** Bundle data, resolved once. Immutable, so not state. */
  type: CharacterType;
  root: Object3D;
  /** The node carrying the motion root translation and bone 0's rotation. */
  pivot: Group;
  /** Bone index (as the skeleton numbers them) to its node. */
  bones: Map<number, Object3D>;
  /** Damaged parts currently swapped in, so a second hit can replace them. */
  gore: Map<number, Object3D>;
  /**
   * The class-0x10 civilian that built this actor, for the fifty captors whose
   * descriptors the walker never sees. They come and go with their parent.
   */
  parentAt?: number;
  /**
   * Class 0x10's held items, by their index in `civilians.items`.
   *
   * `CivilianDrawHeldItems` (`FUN_0048CD10`) walks the actor's own list every
   * frame; here the models are attached once and left on the bone, which is
   * the same picture with far less work. The map is keyed by item index so a
   * civilian holding two of the same thing keeps both.
   */
  held?: Map<number, Object3D>;
}
