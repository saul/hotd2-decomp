/**
 * Spawned characters: assembled from the EXE skeleton, posed from `mot/`.
 *
 * The exporter has already done the hard half. A skeleton is a tree of named
 * parts, each with a bone offset and an asset slot, which is exactly a rig —
 * so `hod2lib.characters` puts one through the ordinary rig writer at every
 * spawn descriptor of its class, and the glTF arrives with a full node
 * hierarchy per character, positioned and yawed. What is left for the client
 * is the part that cannot be baked: the pose.
 *
 * ## Why a bind pose is not enough
 *
 * Every bone offset runs along its own local X, so a character with zero
 * rotations is not standing still — it is a heap of parts piled on the origin.
 * A character has to be posed from a motion frame to look like anything, which
 * is why an unposed character keeps its spawn marker instead of being drawn.
 *
 * ## The transform, from `FUN_00410590`
 *
 * ```c
 * MatrixTranslate(obj.pos);          // the spawn descriptor
 * Scale(obj.scale);
 * RotX; RotY; RotZ                   // object orientation, order per obj+0x1FC
 * MatrixTranslate(frame.root);       // <- motion root translation
 * RotZ(bone0.rz); RotY(bone0.ry); RotX(bone0.rx);
 * for (node in skeleton) FUN_004107E0(node);   // each bone, recursively
 * ```
 *
 * The first three lines are baked into the instance root by the exporter. The
 * middle two are *between* the object transform and the bones, which is why
 * this inserts a group of its own rather than writing onto the instance root:
 * the motion root translation is expressed in the object's rotated frame, so
 * putting it on the root would apply it in world space and slide every
 * character sideways.
 *
 * Bone rotations are applied `RotZ; RotY; RotX` on a column-vector stack, so
 * the composite is `qZ * qY * qX` — the same convention `_bams_euler_to_quat`
 * uses in the exporter and `rigs.ts` uses for object rigs. It is written out
 * as three axis-angle quaternions here rather than as an Euler order, because
 * the equivalence is easy to get wrong and the multiplication is not.
 *
 * ## Playback
 *
 * `mot/` frames are authored at 30 Hz against the engine's 60 Hz clock (see
 * the `g_motion_play_length` note in `docs/formats/mot.md`), so the bundle
 * states the rate rather than baking it in. Motions loop: which motion an
 * actor plays next is its class's state machine — 54 states for the zombie
 * alone — and the player is told a starting motion by the exporter rather than
 * trying to derive that.
 */

import { Box3, Group, Object3D, Ray, Vector3 } from "three";
import type {
  CharacterPlacement, CharacterType, CharactersJson,
} from "../bundle";
import type { CiviliansJson, CivilianItemJson } from "../bundle/scene";
import type { Actor } from "../game/actor";
import { ATTACHMENT_REPLACES_BELOW } from "../game/attachments";
import type { Vec3 } from "../game/vec";
import type { CharacterSpawnRequest } from "../game/director";
import { Rng } from "../core/rng";
import type { Scope } from "../core/scope";
import type { Context, System } from "../core/system";
import type { ShotPick, ShotRay } from "../game/host";
import type { BreakableLayer } from "./breakables";
import type { SlotModelLayer } from "./slotmodels";
import { BAMS_TO_RAD } from "../core/bams";

/**
 * The exporter names a bone's node `chr_<name>_spawn###_<part>`, where *part*
 * is `bone<NN>_<slot>`. Matching on that **suffix** matters: a glTF node whose
 * mesh has several primitives is loaded as a group with child meshes named
 * `<node name>_0`, `_1`, …, and those would match a looser pattern. Rotating a
 * primitive instead of its bone leaves the bone at bind and spins the piece
 * about the joint — which is exactly what "the parts are detached" looks like.
 */
const boneSuffix = (part: string) => `_${part}`;

/**
 * The renderer's half of a character: the nodes, and a reference to the game
 * object they draw.
 *
 * Every field that survives a frame lives on the `Actor` — see
 * docs/PLAYER_ARCHITECTURE.md, "Saving and restoring the whole game state".
 * What is left here is three.js, which a snapshot never contains and which
 * `resync` rebuilds from the actor after a load.
 */
import type { Instance } from "./characters/instance";
import { Poser } from "./characters/pose";
import { restoreGore, swapGore } from "./characters/gore";
export type { Instance };


/** An adopted hierarchy waiting for its spawn opcode. */
interface Pending {
  at: number;
  type: CharacterType;
  root: Object3D;
  pivot: Group;
  bones: Map<number, Object3D>;
  /** The placement's own motion, which `ActorSpawn` does not set. */
  motion: number;
  place: CharacterPlacement | undefined;
  parentAt?: number;
  home: { x: number; y: number; z: number };
}

export class CharacterLayer implements System {
  readonly id = "render.characters";
  /** Characters the script has spawned. Everything here has a game object. */
  private instances: Instance[] = [];
  /**
   * Adopted hierarchies with no game object yet — every spawn in the stage's
   * glTF that the script has not run the opcode for. `syncSpawns` moves a
   * record between here and `instances`; nothing else may.
   */
  private pending = new Map<number, Pending>();
  private readonly live = new Set<number>();
  /**
   * Spawns that have **removed themselves** and must not be built again until
   * their opcode runs afresh.
   *
   * `ActorDespawn` is the engine's own removal — `ZombieReleaseAndDespawn`
   * (`FUN_00455490`) at the end of the stationary thrower's exit, the captor
   * states, a civilian on its removal cue — and in the engine the object is
   * simply gone: `SpawnFromDescriptor` (`FUN_00408A20`) builds it once, when
   * the opcode executes, and nothing recreates it.
   *
   * Without this the layer rebuilt it **on the very next frame**, because
   * `Walker.spawns` still lists it: a despawned actor fails the `!despawned`
   * test below, is released back to `pending`, is still wanted, and is made
   * again — so it lives its whole life over and over. A civilian on its
   * removal cue was rebuilt 1784 times in 90 seconds, and stage 2's stationary
   * thrower threw its axes nineteen times.
   *
   * An `at` the script no longer lists is cleared, so a route that re-enters a
   * region does place it a second time, which is what `release` is for.
   */
  private readonly spent = new Set<number>();
  /** Each spawn's authored position, so a second placement starts where the
   * first did rather than where the last one walked to. */
  private readonly home = new Map<number, { x: number; y: number; z: number }>();
  private json: CharactersJson | null = null;
  private enabled = true;
  /** Posing and blending. See `render/characters/pose.ts`. */
  private readonly poser = new Poser();
  private readonly _c = new Vector3();
  private readonly _p = new Vector3();
  /** Asset slot → the template node for that damaged part. */
  private readonly goreParts = new Map<number, Object3D>();

  /** Spawn offsets that have a real character, so the marker layer can skip them. */
  readonly posed = new Set<number>();

  /**
   * Adopt every character hierarchy the stage's glTF carries.
   *
   * The exporter emits one instance per spawn descriptor, so this is a
   * traversal rather than a clone: the geometry is already in the scene at the
   * right place, and all that is missing is the pose.
   */
  /**
   * The held-item records, handed over with the stage. They live in the
   * `civilians` block rather than in `characters` because they are the exe's,
   * not a character's — one record serves every skin that can hold it.
   */
  civilians: CiviliansJson | null = null;

  /**
   * No `detach`. The character hierarchies belong to the stage's own glTF,
   * which is disposed wholesale on a stage change, so all this ever gave back
   * were the references -- and the scope does that.
   */
  build(root: Object3D, stage: Scope, json: CharactersJson | undefined): void {
    stage.child("characters").defer(() => {
      this.instances = [];
      this.pending.clear();
      this.live.clear();
      this.spent.clear();
      this.home.clear();
      this.posed.clear();
      this.json = null;
    });
    this.json = json ?? null;
    if (!json) return;

    const motionOf = new Map<number, number>();
    const typeOf = new Map<number, number>();
    const placeOf = new Map<number, CharacterPlacement>();
    for (const p of json.placements) {
      if (p.motion === null || p.motion === undefined) continue;
      motionOf.set(p.at, p.motion);
      typeOf.set(p.at, p.char_type);
      placeOf.set(p.at, p);
    }

    // The hidden per-type templates holding the damaged parts. One copy each;
    // a swap clones from here, which shares geometry and material in three.js.
    //
    // **The rig root is hidden, not only the parts it holds.** A swap clones a
    // part and re-parents the copy onto a bone, so nothing it draws depends on
    // the template being visible — while a part whose name the slot pattern
    // below does not match would otherwise be left standing in the level as a
    // body part with no body.
    root.traverse((o) => {
      const x = o.userData as { hod2_kind?: string; hod2_rig?: string };
      const rig = x?.hod2_rig ?? "";
      if (!rig.startsWith("gore_")) return;
      if (x?.hod2_kind === "rig") { o.visible = false; return; }
      if (x?.hod2_kind !== "rig_part") return;
      const m = /_gore_([0-9a-f]{4})$/.exec(o.name);
      if (m) {
        this.goreParts.set(Number.parseInt(m[1], 16), o);
        o.visible = false;
      }
    });

    const roots: Object3D[] = [];
    root.traverse((o) => {
      const x = o.userData as {
        hod2_kind?: string; hod2_rig?: string; hod2_spawn_at?: number;
      };
      if (x?.hod2_kind === "rig" && x.hod2_rig?.startsWith("chr_")
          && x.hod2_spawn_at !== undefined) {
        roots.push(o);
      }
    });

    // **Every character hierarchy starts hidden, before anything can reject
    // one.** An actor is drawn because the port says it is alive, and until
    // then the exporter's baked bind pose is standing in the level. Three of
    // the guards below `continue` -- a placement with no motion, a character
    // type the bundle does not carry, a partial bone match -- and each of them
    // used to leave the hierarchy exactly as the glTF loaded it, which is
    // visible. Nothing in the stage's lifetime would have hidden it again.
    for (const node of roots) node.visible = false;

    for (const node of roots) {
      const at = (node.userData as { hod2_spawn_at: number }).hod2_spawn_at;
      const motion = motionOf.get(at);
      const ct = typeOf.get(at);
      if (motion === undefined || ct === undefined) continue;
      const type = json.types[String(ct)];
      if (!type || !type.motions[String(motion)]) continue;
      const p = placeOf.get(at);

      // The motion root translation and bone 0's rotation sit between the
      // object transform and the bones -- see the note above.
      const pivot = new Group();
      pivot.name = `${node.name}_motion`;
      for (const child of [...node.children]) pivot.add(child);
      node.add(pivot);

      // Index by the skeleton's own bone numbers, from the exporter's list,
      // rather than by anything parsed out of the scene graph.
      const bones = new Map<number, Object3D>();
      pivot.traverse((o) => {
        for (const b of type.bones) {
          if (bones.has(b.bone)) continue;
          if (o.name.endsWith(boneSuffix(b.part))) {
            bones.set(b.bone, o);
            break;
          }
        }
      });
      if (bones.size !== type.bones.length) {
        // A partial skeleton would pose some joints and leave others at bind,
        // which reads as a broken model rather than a missing feature.
        console.warn(`character ${type.name} at ${at}: matched ` +
                     `${bones.size} of ${type.bones.length} bones`);
        continue;
      }

      // **No `ActorSpawn` here.** The hierarchy is adopted; the game object is
      // not made until the script's spawn opcode asks for it, which is when
      // `SpawnFromDescriptor` (`FUN_00408A20`) makes the engine's. See
      // `syncSpawns`.
      this.pending.set(at, {
        at, type, root: node, pivot, bones, motion,
        place: p, parentAt: p?.civilian_child,
        home: { x: node.position.x, y: node.position.y, z: node.position.z },
      });
      this.home.set(at, { x: node.position.x, y: node.position.y,
                          z: node.position.z });
      this.posed.add(at);
    }
  }

  /** Which adopted hierarchies the script is asking for, this frame. */
  private wantedSpawns(spawns: readonly { at: number }[]): Set<number> {
    const want = new Set<number>();
    for (const s of spawns) if (this.pending.has(s.at) || this.live.has(s.at)) {
      want.add(s.at);
    }
    // **Class 0x10's children are not in the walker's list.** `CivilianInit`
    // (`FUN_0048A3E0`) `SpawnFromDescriptor`s each of them itself, and nothing
    // in the evt points at their descriptors — so they are present exactly
    // when the civilian that holds them is.
    for (const rec of [...this.pending.values()]) {
      if (rec.parentAt !== undefined && want.has(rec.parentAt)) want.add(rec.at);
    }
    for (const inst of this.instances) {
      if (inst.parentAt !== undefined && want.has(inst.parentAt)) {
        want.add(inst.at);
      }
    }
    return want;
  }

  /**
   * The spawns that are ready to become game objects, and the two facts about
   * each that only the scene knows.
   *
   * **This layer no longer calls `ActorSpawn`.** It says which adopted
   * hierarchies the script is currently asking for and where the exporter put
   * them; `SpawnFromDescriptor`'s job — the class, the character type, the
   * descriptor tail, the hit points and the class's own `Init` — is the port's,
   * in `SpawnScriptedCharacters`. `app/systems.ts` puts the two together, and
   * that is the whole of the change: a renderer may notice that a spawn is
   * placeable, it does not get to decide that an object exists.
   */
  readySpawns(spawns: readonly { at: number }[]): CharacterSpawnRequest[] {
    const out: CharacterSpawnRequest[] = [];
    for (const at of this.wantedSpawns(spawns)) {
      // It ran `ActorDespawn` on itself; the opcode has to run again first.
      if (this.spent.has(at)) continue;
      const rec = this.pending.get(at);
      if (!rec) continue;
      out.push({ at, motion: rec.motion, pos: { ...rec.home } });
    }
    return out;
  }

  /**
   * Bind the objects the port has just made, and hand back the ones the script
   * has stopped listing.
   *
   * **This is the engine's object lifetime, and the reason it is a seam at
   * all.** In the exe an actor comes into existence in `SpawnFromDescriptor`
   * (`FUN_00408A20`) when opcode 0x0B/0x0C/0x0D runs, and its class `Init`
   * runs there and once. This layer used to build all of them at scene load
   * and gate them with `visible` instead, which meant every `Init` in the
   * stage had already run before the first frame: stage 1 counted all seven of
   * its civilians in `g_civilians_alive` from the entry block, six of them
   * belonging to blocks 4, 6, 8, 9 and 13, and `wait_scripted_actors` — whose
   * 68 sites all want zero — could never pass.
   *
   * Driven from `syncCharacterSpawns`, beside `SpawnPropContainers`, so it
   * runs in the script phase and a spawn ticks on the frame its opcode ran.
   * Idempotent in both directions: an `at` already made is left alone.
   */
  syncSpawns(spawns: readonly { at: number }[],
             made: readonly Actor[]): Actor[] {
    const want = this.wantedSpawns(spawns);
    // The objects the port has just made, bound to the hierarchies that were
    // waiting for them. Adoption, not construction: everything about the actor
    // was decided by `SpawnScriptedCharacters`, and all that happens here is
    // that a set of nodes learns which object it draws.
    this.adopt(made);

    // ...and out again. `ActorDespawn` is the engine's own removal and the
    // pool sweep in `GameUpdate` takes it off `g_object_list`; the hierarchy
    // goes back to `pending` so the same spawn can be placed a second time,
    // which a route that re-enters a region does.
    // **Taking the actor out of the world is not this layer's call.** The ones
    // it lets go are handed back for `app/` to retire — and only the ones that
    // did *not* remove themselves, because an actor that ran its own despawn
    // has already done its own bookkeeping and would be counted out twice.
    const gone: Actor[] = [];
    for (let i = this.instances.length - 1; i >= 0; i--) {
      const inst = this.instances[i];
      if (want.has(inst.at) && !inst.a.despawned) continue;
      // Told itself to go, rather than being unloaded with its region.
      if (inst.a.despawned) this.spent.add(inst.at);
      else gone.push(inst.a);
      this.release(inst);
      this.instances.splice(i, 1);
    }
    // ...and an `at` the script has stopped listing is no longer spent: its
    // spawn opcode may run again, and then it is a new object.
    for (const at of this.spent) if (!want.has(at)) this.spent.delete(at);
    return gone;
  }

  /** Put one instance's nodes back and return its record to `pending`. */
  private release(inst: Instance): void {
    inst.root.visible = false;
    // **Not `inst.a.visible = false`.** Whether an actor is in the world is
    // the port's, and it already says so: `ActorDespawn` (`FUN_00409CC0`)
    // clears the flag, and `app/` runs `RetireUnlistedActor` on everything
    // this hands back. Writing it here also wrote it on the actors this is
    // merely *unbinding* — a snapshot load's stale copies, a seek's wiped
    // pool — which is a renderer reaching into objects the game no longer
    // owns.
    this.restoreNodes(inst);
    this.live.delete(inst.at);
    const p = this.json?.placements.find((x) => x.at === inst.at);
    this.pending.set(inst.at, {
      at: inst.at, type: inst.type, root: inst.root, pivot: inst.pivot,
      bones: inst.bones, motion: p?.motion ?? inst.a.motion, place: p,
      parentAt: inst.parentAt, home: this.home.get(inst.at)
        ?? { x: inst.root.position.x, y: inst.root.position.y,
             z: inst.root.position.z },
    });
  }


  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) for (const i of this.instances) i.root.visible = false;
  }

  /**
   * Pose every character whose spawn is currently placed.
   *
   * `live` is the walker's spawn list, which is what decides whether a
   * character is in the level at all — the same rule the markers follow, so
   * the two can never disagree about who is present. The clocks are already
   * advanced: `ActorAdvanceMotion` did that in the game phase.
   */
  update(_ctx: Context): void {
    for (const inst of this.instances) {
      // **`Characters` is a view switch and must not touch `a.visible`.**
      // Folded into it, turning the checkbox off emptied `g_enemies_alive` and
      // `g_civilians_alive` and unblocked every gate that reads them.
      //
      // It no longer writes it at all. `inst.a.visible = !inst.a.despawned`
      // stood here to cover the one frame between `ActorDespawn` and the pool
      // sweep — but `ActorDespawn` (`FUN_00409CC0`) already clears the flag, so
      // that half was a no-op, and the other half **put `visible` back to true
      // on every actor the port had deliberately hidden**: a class-0x24
      // set-piece past its removal trigger and a class-0x25 humanoid the script
      // had killed both stayed on screen, because the renderer un-hid them once
      // a frame.
      // **`alpha` is a draw gate as well as a fade**, and until now nothing
      // read it. It is the port's stand-in for the engine's per-part draw byte
      // — `SkeletonDrawWalk` (`FUN_004110D0`) emits a part only when
      // `parts[i*8 + 1]` is non-zero — and two states write it:
      // `ZombieStateCorpseBlink` flickers a body with it and
      // `ZombieStateAwaitCivilianOrder` holds a captor off screen with it
      // until its civilian calls it up. Both write 0 or 1 and nothing else, so
      // a threshold is the whole of what this needs; a genuine fade would have
      // to reach every material under the root and is not what either state
      // asks for.
      const show = this.enabled && inst.a.visible && inst.a.alpha > 0;
      inst.root.visible = show;
      if (!show) continue;
      // The director owns position and facing; apply what it decided. The
      // exporter baked the spawn pose into the root, and this replaces it
      // with the live one rather than composing onto it.
      inst.root.position.set(inst.a.pos.x, inst.a.pos.y, inst.a.pos.z);
      inst.root.rotation.set(0, inst.a.yaw * BAMS_TO_RAD, 0);
      // The clocks belong to the port -- `ActorAdvanceMotion` -- so the game
      // can be run with no renderer at all, and so a swing keeps its play
      // position across a save state. This only reads them.
      this.poser.pose(inst);
      // A bone `RemoveBoneSubtree` took off is hidden here rather than where
      // the shot resolved: `ResolveHit` runs in the port now, and what a
      // severed subtree *looks like* is this layer's half of it. `a.removed`
      // only grows within a life and `restoreNodes` clears the count, so this
      // does nothing on every frame but the one a limb comes off.
      if (inst.hidden !== inst.a.removed.length) {
        for (const b of inst.a.removed) {
          const node = inst.bones.get(b);
          if (node) node.visible = false;
        }
        inst.hidden = inst.a.removed.length;
      }
      this.syncAttachments(inst);
      if (inst.a.civ) this.syncHeldItems(inst);
    }
  }

  /**
   * `ActorDrawAttachedParts` — `FUN_004124F0`. The hair, the hat, the bag and
   * the shoes.
   *
   * The engine walks `model+0x1170` after every skeleton node and, for each id
   * at or above `ATTACHMENT_REPLACES_BELOW`, sets the matrix to that record's
   * bone and calls `AssetDrawSlot` on its asset slot. The ids below the split
   * are not here: `ActorBindPartList` folded them into `a.boneSlot` when the
   * `Init` ran, and `adopt` and `resync` replay them.
   *
   * **This is what closes a civilian's head.** The model a civilian's skeleton
   * names for bone 2 is a face shell open at the back — `hito_gal`'s spans
   * `z 0.18..1.38` with four vertex normals in the whole 149 pointing
   * backwards — and the `etc_komono_*` model on the same bone is the hair that
   * covers it. Every one of the fifty-two class-0x10 spawns that carries a
   * list names one.
   *
   * [diverges] The engine re-issues the draw every frame in the bone's own
   * matrix; here the model is parented to the bone once, which is the same
   * picture. It also applies an Original Mode scale — 1.5x in X and Z on
   * bone 2, 2.0x on bones 5, 8, 12 and 15, gated on `DAT_009C88AC` — which is
   * not ported: what that byte is has not been read.
   */
  private syncAttachments(inst: Instance): void {
    const split = this.json?.attachment_replaces_below
      ?? ATTACHMENT_REPLACES_BELOW;
    const want = inst.a.attachments.filter((id) => id >= split);
    const have = inst.attached ?? (inst.attached = new Map());
    if (want.length === have.size && want.every((k) => have.has(k))) return;
    const recs = this.json?.attachments ?? [];
    for (const [k, node] of have) {
      if (want.includes(k)) continue;
      node.removeFromParent();
      have.delete(k);
    }
    for (const id of want) {
      if (have.has(id)) continue;
      const rec = recs[id];
      const bone = rec && rec.bone >= 0 ? inst.bones.get(rec.bone) : undefined;
      const model = rec && rec.slot ? this.cloneSlot(rec.slot) : null;
      // An empty `Object3D` rather than nothing, so a record with no model in
      // this stage's bundle is asked for once instead of every frame.
      if (!bone || !model) { have.set(id, new Object3D()); continue; }
      bone.add(model);
      have.set(id, model);
    }
  }

  /**
   * `CivilianDrawHeldItems` — `FUN_0048CD10`. What is in a civilian's hands.
   *
   * The record says which bone, which asset slot and how to sit on it; the
   * character type says which of the record's six attach sets to use, which is
   * why one bottle fits an old man and a schoolgirl. The draw's rotation order
   * is X, then Z, then Y, and the translate follows it — copied from the
   * routine rather than guessed, because a hand prop is exactly the thing that
   * looks nearly right in three wrong orders.
   *
   * [diverges] The engine re-draws the item from scratch every frame and runs
   * the record's own per-frame callback (`rec+0x18`) after it. Here the model
   * is parented to the bone once and the callback is `[open]` — the four that
   * appear are unread.
   */
  private syncHeldItems(inst: Instance): void {
    const want = inst.a.civ?.items ?? [];
    const have = inst.held ?? (inst.held = new Map());
    if (want.length === have.size && want.every((k) => have.has(k))) return;
    const items = this.civItems;
    for (const [k, node] of have) {
      if (want.includes(k)) continue;
      node.removeFromParent();
      have.delete(k);
    }
    for (const k of want) {
      if (have.has(k)) continue;
      const rec = items[k];
      const bone = rec && inst.bones.get(rec.bone);
      if (!rec || !bone) { have.set(k, new Object3D()); continue; }
      const group = new Object3D();
      for (const slot of [rec.slot, rec.extra ?? 0]) {
        const m = slot ? this.cloneSlot(slot) : null;
        if (m) group.add(m);
      }
      const set = rec.sets[inst.a.civ?.attachSet ?? 5] ?? rec.sets[5]
        ?? [0, 0, 0, 1];
      group.rotation.set(rec.rot[0] * BAMS_TO_RAD, rec.rot[1] * BAMS_TO_RAD,
                         rec.rot[2] * BAMS_TO_RAD, "XZY");
      group.position.set(set[0], set[1], set[2]);
      group.scale.setScalar(set[3] || 1);
      bone.add(group);
      have.set(k, group);
    }
  }

  /** `civilians.items` — the records the held-item ops name. */
  private get civItems(): CivilianItemJson[] {
    return this.civilians?.items ?? [];
  }

  /**
   * `ShotTestSphere` (`FUN_00404630`) — what one shot segment hits first.
   *
   * The **renderer's half of a shot, and only that half.** The engine
   * broad-phases on the actor's own sphere before descending into the bones;
   * here the bone spheres are cheap enough (fifteen per character, a few dozen
   * characters) that the broad phase would cost more than it saves, so it is
   * skipped — the answer is the same.
   *
   * The sphere is `PTR_DAT_004D032C`'s centre and radius, carried on the bone
   * and therefore moving with the animation exactly as `FUN_004107E0` makes it.
   * Nearest along the ray wins, matching `FUN_00404DB0`'s sort — and the props
   * are in the same sort, because the engine walks **one** candidate list: a
   * barrel in front of a zombie stops the bullet.
   *
   * What the hit *means* is not decided here and must not be. That is
   * `game/combat/shot.ts`, which is what the port calls this from.
   */
  pickShot(ray: ShotRay): ShotPick | null {
    this._ray.origin.set(ray.origin.x, ray.origin.y, ray.origin.z);
    this._ray.direction.set(ray.dir.x, ray.dir.y, ray.dir.z);
    let best: ShotPick | null = null;
    let bestT = Infinity;
    for (const inst of this.instances) {
      if (!inst.root.visible || inst.a.dead) continue;
      for (const b of inst.type.bones) {
        if (!b.hit_radius) continue;
        // A removed bone has a zero draw slot, and `ShotTestBoneTree` never
        // descends into one -- so a blown-off arm cannot be shot again.
        if (inst.a.removed.includes(b.bone)) continue;
        const node = inst.bones.get(b.bone);
        if (!node) continue;
        this._c.set(b.hit_centre![0], b.hit_centre![1], b.hit_centre![2]);
        node.localToWorld(this._c);
        this._ray.closestPointToPoint(this._c, this._p);
        const t = this._p.sub(this._ray.origin).dot(this._ray.direction);
        if (t <= 0) continue;                         // behind the muzzle
        if (this._ray.distanceSqToPoint(this._c)
            > b.hit_radius * b.hit_radius) continue;
        if (t < bestT) {
          bestT = t;
          best = { kind: "actor", at: inst.at, bone: b.bone,
                   point: { x: this._c.x, y: this._c.y, z: this._c.z } };
        }
      }
    }
    // The props ride the same list. `BreakableLayer.pick` measures distance
    // rather than the along-ray parameter, which for a normalised direction is
    // the same number.
    const prop = this.breakables?.pickRay(this._ray) ?? null;
    if (prop && prop.t < bestT) {
      bestT = prop.t;
      best = { kind: "prop", propId: prop.id,
               point: { x: prop.point.x, y: prop.point.y, z: prop.point.z } };
    }
    // ...and so do the asset-slot actors, through the **sphere** the engine
    // tests them with. `ShotTestSphere` (`FUN_00404630`) descends into a bone
    // tree only for an actor with `obj+0x34` bit 7 and a skeleton; one with
    // neither is a single sphere at `obj+0x124`, and that is the whole hit
    // test for class 0x52. See `render/slotmodels.ts`.
    const slot = this.slotModels?.pickSphere(this._ray) ?? null;
    if (slot && slot.t < bestT) {
      best = { kind: "actor", at: slot.at, bone: 0,
               point: { x: slot.point.x, y: slot.point.y, z: slot.point.z } };
    }
    // Say so rather than doing nothing quietly: a bundle exported before the
    // reaction tables were added has no `reaction_groups`, and a silent no-op
    // looks exactly like "the game has no staggers".
    if (best?.kind === "actor" && !this.hasReactions
        && !this.warnedNoReactions) {
      this.warnedNoReactions = true;
      console.warn(
        "[characters] no hit-reaction data in this bundle — re-export it "
        + "(`npm run export`). Zombies will not stagger when shot.");
    }
    return best;
  }

  /**
   * One bone's hit sphere in world space — the centre into `out`, the radius
   * returned, or null when the actor is not posed.
   *
   * The same two numbers `pickShot` tests with, and the same two
   * `DrawBloodSpray` (`FUN_00407230`) draws at: `obj + bone * 0x90 + 0x274`
   * and `+0x284`. The blood is glued to them for its whole twenty-five
   * frames, which is why this is a live query and not a point handed over at
   * spawn.
   */
  boneSphere(at: number, bone: number, out: Vector3): number | null {
    for (const inst of this.instances) {
      if (inst.at !== at) continue;
      const b = inst.type.bones.find((x) => x.bone === bone);
      const node = b && inst.bones.get(bone);
      if (!b || !node || !b.hit_centre) return null;
      out.set(b.hit_centre[0], b.hit_centre[1], b.hit_centre[2]);
      node.localToWorld(out);
      return b.hit_radius ?? null;
    }
    return null;
  }

  /** The breakable props, so a barrel in front of a zombie takes the shot. */
  breakables: BreakableLayer | null = null;
  /**
   * The asset-slot actors, so a mouse in front of a wall takes the shot.
   *
   * Set from `app/`, the same way `breakables` is, because this layer owns the
   * ray and that one owns the spheres.
   */
  slotModels: SlotModelLayer | null = null;
  private readonly _ray = new Ray();

  /**
   * `CamEvalObjectPath6` — the `op_` object paths class 0x25's actors ride.
   *
   * Handed in by `main.ts` because the curves belong to the camera bundle, not
   * to the characters; this layer is only the `HostBackend` the port already
   * talks to.
   */
  paths: {
    objectPath(slot: number): {
      position(t: number, out?: Vec3): Vec3;
      channel(i: number, t: number): number;
    } | undefined;
  } | null = null;

  /**
   * **All six values, not three.**
   *
   * `CamEvalObjectPath6` (`FUN_004042D0`) fills `{float x,y,z; int rx,ry,rz}`,
   * and `ScriptedHumanoidUpdate`'s tail copies the second half straight onto
   * the actor when the follow mode is not 2 — `MOV [EDI+0x64],EAX; MOV
   * [EDI+0x68],ECX; MOV [EDI+0x6c],EDX` at `0x00484B6E`-`0x00484B74`, out of
   * `[ESP+0x4c/0x50/0x54]`. It also rotates the attachment offset through the
   * same triple. This seam used to hand back the position alone, so `p.yaw`
   * was always `undefined`: a rider took its path's *place* and kept its spawn
   * facing, and the offset record was rotated by a yaw of zero. Stage 3's
   * boat riders are the visible case — two class-0x25 actors on `op_st3` 0
   * with offset records 4 and 5, seated facing wherever the descriptor left
   * them while the boat turned under them.
   *
   * `op_` channels 3, 4 and 5 are the BAMS triple; `channel` is what
   * `render/rigs.ts` already reads them with.
   */
  objectPath(slot: number, frame: number):
      { x: number; y: number; z: number;
        pitch: number; yaw: number; roll: number } | null {
    const p = this.paths?.objectPath(slot);
    if (!p) return null;
    const v = p.position(frame, this._pathPos);
    return { x: v.x, y: v.y, z: v.z,
             pitch: p.channel(3, frame), yaw: p.channel(4, frame),
             roll: p.channel(5, frame) };
  }

  private readonly _pathPos = new Vector3();
  private readonly _bone = new Vector3();

  /** The world's generator, handed over by the host. */
  rng = new Rng(1);

  /** One warning per session, not one per shot. */
  private warnedNoReactions = false;

  /** Whether this bundle carries the hit-reaction tables at all. */
  get hasReactions(): boolean {
    return !!this.json?.reaction_groups?.length;
  }


  /** Revive everything — for a seek, which replays the script from the top. */
  revive(): void {
    // **Everything goes back to `pending`, and nothing is re-inited here.**
    // This used to walk the live instances and call each class's `Init` again
    // — on a stage load that meant every `Init` in the stage ran twice, once
    // from the build that had just run it, which is how stage 1 reported
    // thirteen live civilians against seven actors. The engine has one `Init`
    // per object because it has one `SpawnFromDescriptor` per object; the
    // port gets the same by unmaking the objects and letting the replayed
    // script make them again.
    for (const inst of this.instances) this.release(inst);
    this.instances = [];
  }

  /** Put one instance's nodes back to bind: bones, gore swaps, held items. */
  private restoreNodes(inst: Instance): void {
    for (const [bone, g] of inst.gore) restoreGore(inst, bone, g);
    inst.gore.clear();
    inst.hidden = 0;
    for (const g of inst.held?.values() ?? []) g.removeFromParent();
    inst.held?.clear();
    for (const node of inst.bones.values()) {
      node.visible = true;
      for (const c of node.children) c.visible = true;
    }
  }

  /**
   * Make `instances` agree with the object pool.
   *
   * A snapshot load replaces every actor with a restored copy and a seek wipes
   * the pool outright, so after either the live references here are stale.
   * Binding rather than re-spawning is the whole point: a restored actor
   * carries its hit points, its severed bones and its state, and calling
   * `ActorSpawn` would throw all of it away.
   */
  bindToPool(pool: readonly Actor[]): void {
    const byAt = new Map<number, Actor>();
    for (const a of pool) if (!a.despawned) byAt.set(a.at, a);
    this.adopt([...byAt.values()]);
    for (let i = this.instances.length - 1; i >= 0; i--) {
      const inst = this.instances[i];
      const a = byAt.get(inst.at);
      if (a) { inst.a = a; continue; }
      this.release(inst);
      this.instances.splice(i, 1);
    }
  }

  /**
   * Give each new actor the hierarchy that was waiting for its spawn address.
   *
   * The one place a record moves from `pending` to `instances`. Silent about
   * an actor with no hierarchy: a class-0x41 placer has no character at all
   * and is in the same pool.
   */
  private adopt(actors: readonly Actor[]): void {
    for (const a of actors) {
      const rec = this.pending.get(a.at);
      if (!rec) continue;
      this.pending.delete(a.at);
      this.live.add(a.at);
      const inst: Instance = { at: a.at, a, type: rec.type, root: rec.root,
                               pivot: rec.pivot, bones: rec.bones,
                               gore: new Map(), parentAt: rec.parentAt };
      this.instances.push(inst);
      // **A bone slot an `Init` already wrote.** `ActorBindPartList`
      // (`FUN_00412440`) runs inside the class's `Init`, which is before this
      // layer has an instance to write through — so the actor arrives already
      // saying which model each bone draws, and this replays it exactly as
      // `resync` does. Without it a civilian kept the default head its
      // skeleton names instead of the `hito_kao_*` its spawn asked for.
      for (const [bone, slot] of Object.entries(a.boneSlot)) {
        swapGore(this.goreParts, inst, Number(bone), slot);
      }
    }
  }


  /**
   * A clone of the model at *slot*, from the hidden per-type template the
   * exporter emits — the same one the gore swap draws from. Used for a thrown
   * weapon, which the skeleton never names.
   */
  cloneSlot(slot: number): Object3D | null {
    const t = this.goreParts.get(slot);
    if (!t) return null;
    const c = t.clone(true);
    c.visible = true;
    c.position.set(0, 0, 0);
    c.quaternion.identity();
    c.scale.set(1, 1, 1);
    return c;
  }

  /**
   * The assembled actor's world bounds, for a debug box. False when the spawn
   * has no character in the scene — a class with no motion rule keeps its
   * marker, and there is nothing to measure.
   */
  boundsOf(at: number, out: Box3): boolean {
    const inst = this.instances.find((i) => i.at === at);
    if (!inst || !inst.root.visible) return false;
    out.setFromObject(inst.root);
    return !out.isEmpty();
  }

  /** World position of one bone of one instance, for a spawn point. */
  /**
   * Where a bone is, in world space. The port asks for this across
   * `HostBackend` because the skeleton is three.js's and the port is not —
   * so the answer crosses the seam as three numbers, not as a `Vector3`.
   */
  boneWorld(at: number, bone: number, out: Vec3): boolean {
    const inst = this.instances.find((i) => i.at === at);
    const node = inst?.bones.get(bone);
    if (!node) return false;
    node.getWorldPosition(this._bone);
    out.x = this._bone.x; out.y = this._bone.y; out.z = this._bone.z;
    return true;
  }

  /** Swap one bone's drawn model — the thrower's hand going bare and back. */
  setBoneSlot(at: number, bone: number, slot: number): void {
    const inst = this.instances.find((i) => i.at === at);
    if (inst) swapGore(this.goreParts, inst, bone, slot);
  }

  /** The game objects this layer draws. */
  get actors(): Actor[] {
    return this.instances.map((i) => i.a);
  }

  /**
   * Rebind and redraw after a snapshot load.
   *
   * The load replaced every actor in `g_object_list` with a restored copy, so
   * the live references here are stale; and the bone visibility, the gore
   * swaps and the hand slots are three.js state that no snapshot contains.
   * All of it is derived from the actor, which is the test that the split
   * between game state and render state is in the right place.
   */
  resync(_ctx: Context): void {
    // Which spawns exist at all is the pool's answer, not this layer's, and it
    // is not this layer that asks: `CharacterBindSystem` in `app/systems.ts`
    // hands the pool over in the `game` phase, which resyncs before this one.
    for (const inst of this.instances) {
      // Put every bone and every swapped part back, then re-apply what the
      // restored actor says was destroyed.
      this.restoreNodes(inst);
      // `a.removed` already names every bone in each severed subtree, so
      // hiding exactly those is the whole of it.
      for (const bone of inst.a.removed) {
        const node = inst.bones.get(bone);
        if (node) node.visible = false;
      }
      for (const [bone, slot] of Object.entries(inst.a.boneSlot)) {
        swapGore(this.goreParts, inst, Number(bone), slot);
      }
      inst.root.visible = this.enabled && inst.a.visible;
      inst.root.position.set(inst.a.pos.x, inst.a.pos.y, inst.a.pos.z);
      inst.root.rotation.set(0, inst.a.yaw * BAMS_TO_RAD, 0);
      this.poser.pose(inst);
    }
  }

  get describe(): string {
    if (!this.json) return "—";
    const total = this.json.placements.length;
    if (!this.instances.length) return `0 / ${total} posed`;
    const shown = this.instances.filter((i) => i.root.visible).length;
    const types = new Set(this.instances.map((i) => i.type.name)).size;
    return `${shown} of ${this.instances.length} up, ${types} types`;
  }
}
