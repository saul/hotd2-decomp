/**
 * One assembled character: the game object, the bundle data, and the nodes.
 *
 * Split out so the posing half can name it without importing the layer that
 * owns it. Everything mutable here is either a live reference to an `Actor` —
 * whose state is the port's and goes in the snapshot — or three.js nodes,
 * which are the renderer's and do not.
 */
import type { Group, Mesh, Object3D } from "three";
import type { Actor } from "../../game/actor";
import type { BakedMotion, CharacterType } from "../../bundle";
import type { CelRunNode } from "./cels";
import type { HeadTurn } from "./head_aim";
import type { HeldItemNodes } from "./held_items";

/**
 * What one gore swap did to a bone, and therefore what undoing it must put
 * back.
 *
 * `AssetDrawSlot` (`FUN_00418560`) draws **one whole model** for the slot a
 * bone's draw record names, and a model is a chain of meshes — the glTF
 * carries it as one node with several primitives. So a swap has to draw every
 * primitive of the damaged part, which is why the extras are tracked here
 * rather than being assumed away: 57 of 57 of `char_adv02`'s damaged variants
 * are multi-primitive, and eight of its fifteen bones are single-primitive
 * nodes.
 */
export interface GoreSwap {
  /**
   * The bone's own geometry and material from before the first swap, parked
   * on a detached `Mesh`.
   *
   * Only a **single-primitive** bone has one: glTF loads that node as a `Mesh`
   * and its child *bones* hang off it, so it cannot be hidden — the swap
   * writes over what it draws instead. A multi-primitive bone is a `Group`
   * whose own primitives are hidden, and there is nothing to save.
   */
  keep: Mesh | null;
  /** Nodes the swap parented to the bone. Removed when it is undone. */
  added: Object3D[];
  /**
   * A multi-primitive bone's own primitives the first swap hid, shown again
   * when it is undone. Absent for a single-primitive bone, which hides
   * nothing.
   */
  hidden?: Object3D[];
}

export interface Instance {
  /**
   * The part-0 node of a character drawn from the model block, found once
   * (`render/characters/model_block.ts`). `null` when the type has none.
   */
  part0?: Object3D | null;
  /**
   * Class 0x40's second draw of a member, where stage 1 block 3 reflects it.
   * A copy of {@link Instance.root}'s tree, re-posed from it each frame; see
   * `render/characters/horde.ts`.
   */
  mirror?: Object3D;
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
  gore: Map<number, GoreSwap>;
  /**
   * How many of `a.removed` have been hidden.
   *
   * Render bookkeeping, not state: `a.removed` is the port's list of bones a
   * `RemoveBoneSubtree` took off, and this is only how far down it this
   * instance's nodes have been caught up. `restoreNodes` clears it, `resync`
   * re-applies the whole list, and a snapshot carries neither.
   */
  hidden?: number;
  /**
   * The model each swapped bone's node shows, by bone, as `a.boneSlot` says
   * it. Render bookkeeping like {@link hidden}: how far this instance has
   * caught up with the actor, so a swap made where no `setBoneSlot` reached
   * this layer -- a netplay replica, which runs no port -- still lands.
   */
  slots?: Record<string, number>;
  /**
   * The model each bone's node shows **instead of** its record this frame,
   * by bone, as `a.nodeDrawSlot` says a class's node hook drew it -- a
   * talking head's mouth cel. Render bookkeeping like {@link slots}, and kept
   * apart from it because the record underneath has not changed: when the
   * hook draws the record again the node goes back to {@link slots}' model,
   * or to its own.
   */
  drawnSlots?: Record<number, number>;
  /**
   * The class-0x10 civilian that built this actor, for the fifty captors whose
   * descriptors the walker never sees. They come and go with their parent.
   */
  parentAt?: number;
  /**
   * The draw gates this instance's nodes are currently showing, as a key —
   * set only while every gate is open and no node is faded, so a frame that
   * changes nothing costs one comparison. See
   * `render/characters/draw_gates.ts`.
   *
   * Render bookkeeping: the gates themselves are `a.motionFlags`,
   * `a.partVisible`, `a.suppressedBones` and `a.nodeDrawAlpha`, and this is
   * only how far the nodes have been caught up to them. `undefined` means
   * "unknown", which is what `restoreNodes`, a fresh instance and any frame
   * with a gate closed or a node faded all are.
   */
  gates?: string;
  /**
   * The turn `ActorAimHeadAtCamera` (`FUN_00453BE0`) gives bone 2's own draw
   * this frame, as a matrix, and whether it gave one. Render bookkeeping,
   * rebuilt by every update from the actor's `headPitch`, `headYaw`,
   * `headAimed` and yaw. See `render/characters/head_aim.ts`.
   */
  headTurn?: HeadTurn;
  /**
   * The exporter's `part<i>_<slot>` nodes — the vertex-blended parts, which
   * are not bones — by part index. Found once by name; render bookkeeping.
   */
  partNodes?: Map<number, Object3D>;
  /**
   * The cel nodes `ZombieDrawBonePart` (`FUN_004534A0`) draws on a bone, keyed
   * `"<bone>:<run index>"`.
   *
   * Render bookkeeping: which cel is showing is a function of
   * `G.g_blink_frame_counter` and `a.hitSlot`, both of which are in the
   * snapshot, so nothing here needs saving and `resync` rebuilds it on the
   * first frame after a load. See `render/characters/cels.ts`.
   */
  cels?: Map<string, CelRunNode>;
  /**
   * Bones whose own primitive meshes are hidden because a cel arm replaced
   * them. Not the same set as `a.removed`, which is a severed subtree.
   */
  celHidden?: Set<number>;
  /**
   * The models an attachment list hung on a bone, by record id.
   *
   * Render bookkeeping and nothing else: the ids are on the actor, in
   * `a.attachments`, and this is only which of them have nodes yet. A record
   * whose model this stage's bundle does not carry gets an empty `Object3D`,
   * so it is asked for once rather than every frame.
   */
  attached?: Map<number, Object3D>;
  /**
   * Class 0x10's held items, by their position in `civ.heldDrawn` -- the
   * list `CivilianDrawHeldItems` (`FUN_0048CD10`) walked this frame -- so a
   * civilian holding two of the same record keeps both.
   *
   * The item's matrix in its bone's frame is a constant of the record and
   * the attach set, so each is built once, from the draw's own calls, and
   * left on the bone: the same picture as the engine's per-frame draw. See
   * `render/characters/held_items.ts`.
   */
  held?: Map<number, Object3D>;
  /** The same items' camera-facing second slots, placed every frame. */
  heldNodes?: HeldItemNodes[];
  /** `attachSet:records` the nodes above were built for. */
  heldKey?: string;
  /**
   * Class 0x25's extra models, `ScriptedHumanoidBoneDrawHook`'s
   * (`FUN_00485260`), by `"<bone>:<slot>"`. Render bookkeeping: which arm
   * draws is a function of the actor's type, motion and drawn cursor, all in
   * the snapshot. See `render/characters/humanoid_hook.ts`.
   */
  hookDraws?: Map<string, Object3D>;
  /**
   * The one clip and authored frame the last pose took every bone from, or
   * `null` when it mixed two (a cross-fade, a reaction). Render bookkeeping,
   * rewritten by every pose: it is what lets {@link Poser.drawnAngles} hand
   * back the draw record's integer triple exactly rather than re-deriving it
   * from a quaternion. See `render/characters/pose.ts`.
   */
  drawnFrom?: { motion: BakedMotion; frame: number } | null;
  /**
   * `Class22DrawBonePart`'s (`FUN_0049D980`) two extra models on the flier's
   * body node, slots `0x2B5` and `0x2B4`. Render bookkeeping; the angles they
   * take are read off the pose each frame. See `render/characters/judgment.ts`.
   */
  judgmentWings?: Object3D[];
  /**
   * A result card figure's `common.bin[199]` on bone 5, which
   * `ResultCardFigureDrawNode` (`FUN_004357F0`) draws while the figure's
   * `holdsLife` is up; null once looked for and not in the bundle. Render
   * bookkeeping. See `render/characters/result_figure.ts`.
   */
  resultLife?: Object3D | null;
  /** The figure's scaled nodes' meshes carry their push and pop. */
  resultScaleHooked?: boolean;
  /**
   * The models `Class32DrawBonePart` (`FUN_0047F780`) draws on a class-0x32
   * node besides the node's own, by `"<bone>:<index in the node's draws>"`,
   * with the slot each was cloned for. Render bookkeeping, rebuilt from
   * `Boss5Tail.nodeDraws` every frame. See `render/characters/boss5.ts`.
   */
  boss5Draws?: Map<string, { node: Object3D; slot: number }>;
  /**
   * The golden frog's score strip, the slot it was cloned for and the clone
   * (null when the bundle has no template for it). Render bookkeeping. See
   * `render/characters/golden_frog.ts`.
   */
  frogStrip?: { slot: number; node: Object3D | null };
}
