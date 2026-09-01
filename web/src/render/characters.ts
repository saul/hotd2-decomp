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

import { Box3, Group, Mesh, Object3D, Ray, Vector3 } from "three";
import type {
  CharacterPlacement, CharactersJson,
} from "../bundle";
import type { CiviliansJson, CivilianItemJson } from "../bundle/scene";
import type { Actor } from "../game/actor";
import type { Vec3 } from "../game/vec";
import { DescriptorFromPlacement } from "../game/descriptor";
import { ActorSpawn } from "../game/director";
import { ActorIsEnemy } from "../game/registry";
import { ActorByAt, G } from "../game/globals";
import { Rng } from "../core/rng";
import type { Scope } from "../core/scope";
import type { Context, System } from "../core/system";
import type { GameHost } from "../game/host";
import { ActorKillAll, ResolveHit, type HitResult }
  from "../game/combat/resolve_hit";
import { ReleaseAttackSlot } from "../game/combat/permits";
import { g_class_handlers } from "../game/registry";
import { BAMS_TO_RAD } from "../core/bams";

/**
 * The bone `SkeletonEmitNode` records into `obj+0x100`, and the 4.0
 * `FUN_00409B70` adds to its height before the camera reads it.
 */
const CAMERA_TRACK_BONE = 1;
const CAMERA_TRACK_RISE = 4;

/** The engine's frame clock. Motion clips are authored at half of it. */


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
import { swapGore } from "./characters/gore";
export type { Instance };


export class CharacterLayer implements System {
  readonly id = "render.characters";
  private instances: Instance[] = [];
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
    root.traverse((o) => {
      const x = o.userData as { hod2_kind?: string; hod2_rig?: string };
      if (x?.hod2_kind !== "rig_part") return;
      const rig = x.hod2_rig ?? "";
      if (!rig.startsWith("gore_")) return;
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

      // The descriptor tail is read by the class's own Init -- the start state
      // is one of its bytes -- so it is handed over at spawn time.
      const a = ActorSpawn(at, p?.class ?? 0, type.type, type.name,
                           DescriptorFromPlacement(p), this.rng);
      a.motion = motion;
      a.hp = this.startHp(p);
      a.maxHp = a.hp;
      a.yaw = p?.yaw ?? 0;
      a.pos = { x: node.position.x, y: node.position.y, z: node.position.z };
      this.instances.push({ at, a, type, root: node, pivot, bones,
                            gore: new Map(), parentAt: p?.civilian_child });
      this.posed.add(at);
      node.visible = false;
    }
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
  update(ctx: Context): void {
    const live = ctx.walker?.spawns ?? [];
    if (!this.instances.length) return;
    const present = new Set<number>();
    for (const s of live) present.add(s.at);
    // **Class 0x10's children are not in the walker's list.** `CivilianInit`
    // builds them from descriptors nothing in the evt points at, so they have
    // no spawn instruction to be placed by; they are present exactly when the
    // civilian that holds them is. Without this the fifty captors were placed,
    // posed and permanently invisible.
    for (const inst of this.instances) {
      const parent = inst.parentAt;
      if (parent !== undefined && present.has(parent)) present.add(inst.at);
    }

    for (const inst of this.instances) {
      // A corpse stays: `FUN_00454D20` plays the clip out before handing the
      // body on, so removing it the instant HP hits zero would be wrong.
      // `ActorDespawn` is the port's own removal — a class-0x10 civilian
      // walks off when its removal cue fires — and it outranks the walker's
      // list, which knows only that the spawn instruction has run.
      const show = this.enabled && present.has(inst.at) && !inst.a.despawned;
      inst.root.visible = show;
      inst.a.visible = show;
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
      this.trackLookAt(inst);
      if (inst.a.civ) this.syncHeldItems(inst);
    }
  }

  /**
   * `obj+0x100`: what the camera aims at.
   *
   * `SkeletonEmitNode` records one bone's world position as it walks the
   * skeleton, and `FUN_00409B70` raises it by 4.0 before the actor registers
   * for camera tracking. The bone is **1** for an ordinary humanoid — the
   * torso — with 2 and 9 selected by flags this port does not model.
   * `SelectCameraLookAtTarget` reads this and never reads the position, which
   * is why aiming at the origin put the camera on the feet.
   */
  private trackLookAt(inst: Instance): void {
    const node = inst.bones.get(CAMERA_TRACK_BONE);
    if (!node) return;
    node.getWorldPosition(this._track);
    inst.a.lookAt.x = this._track.x;
    inst.a.lookAt.y = this._track.y + CAMERA_TRACK_RISE;
    inst.a.lookAt.z = this._track.z;
  }

  private readonly _track = new Vector3();

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
   * Test a ray against every live character's per-bone hit spheres.
   *
   * `FUN_00404630` broad-phases on the actor's own sphere before descending
   * into the bones; here the bone spheres are cheap enough (fifteen per
   * character, a few dozen characters) that the broad phase would cost more
   * than it saves, so it is skipped — the answer is the same.
   *
   * The sphere is `PTR_DAT_004D032C`'s centre and radius, carried on the bone
   * and therefore moving with the animation exactly as `FUN_004107E0` makes it.
   * Nearest along the ray wins, matching `FUN_00404DB0`'s sort.
   */
  pick(ray: Ray): { inst: Instance; bone: number; point: Vector3 } | null {
    let best: { inst: Instance; bone: number; point: Vector3 } | null = null;
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
        ray.closestPointToPoint(this._c, this._p);
        const t = this._p.sub(ray.origin).dot(ray.direction);
        if (t <= 0) continue;                         // behind the muzzle
        if (ray.distanceSqToPoint(this._c) > b.hit_radius * b.hit_radius) continue;
        if (t < bestT) {
          bestT = t;
          best = { inst, bone: b.bone, point: this._c.clone() };
        }
      }
    }
    return best;
  }

  /**
   * `ActorInitHitPoints` (`FUN_0040A8B0`): the descriptor's hit points plus the
   * difficulty delta, clamped to `[1, 300]`.
   */
  private startHp(p: CharacterPlacement | undefined): number {
    const d = this.json?.difficulty;
    if (!p) return 0;
    if (!d?.hp_delta?.length) return p.hp;
    const hp = p.hp + (d.hp_delta[G.g_difficulty] ?? 0);
    return Math.min(d.hp_max, Math.max(d.hp_min, hp));
  }

  /**
   * Charge a hit. `ResolveHit` (`FUN_00409430`) is in `game/combat/`, where it
   * belongs: it decides hit points, which model each bone draws, what comes
   * off and which way the actor falls, and all of that is state that has to be
   * in a snapshot. This is the renderer's half — turn a picked `Instance` into
   * an actor, and apply the model swaps the port asked for.
   */
  hit(inst: Instance, bone: number, cameraYawBams = 0): HitResult {
    const before = inst.a.removed.length;
    const out = ResolveHit(inst.a, bone, cameraYawBams, this.host, this.rng);
    // `RemoveBoneSubtree` zeroed some draw slots; hide what it named. A zero
    // slot is invisible *and* unshootable, which is why the pick tests it too.
    for (const b of inst.a.removed.slice(before)) {
      const node = inst.bones.get(b);
      if (node) node.visible = false;
    }
    // Say so rather than doing nothing quietly: a bundle exported before the
    // reaction tables were added has no `reaction_groups`, and a silent no-op
    // looks exactly like "the game has no staggers".
    if (!this.hasReactions && !this.warnedNoReactions) {
      this.warnedNoReactions = true;
      console.warn(
        "[characters] no hit-reaction data in this bundle — re-export it "
        + "(tools/export_player.py). Zombies will not stagger when shot.");
    }
    return out;
  }

  /** What the port swaps models through. */
  private readonly host: GameHost = {
    boneWorld: () => false,
    aimPoint: () => {},
    viewPoint: () => {},
    viewSpaceOf: () => false,
    setBoneSlot: (at, bone, slot) => this.setBoneSlot(at, bone, slot),
  };

  /**
   * `CamEvalObjectPath6` — the `op_` object paths class 0x25's actors ride.
   *
   * Handed in by `main.ts` because the curves belong to the camera bundle, not
   * to the characters; this layer is only the `HostBackend` the port already
   * talks to.
   */
  paths: {
    objectPath(slot: number):
      { position(t: number, out?: Vector3): Vector3 } | undefined;
  } | null = null;

  objectPath(slot: number, frame: number):
      { x: number; y: number; z: number } | null {
    const p = this.paths?.objectPath(slot);
    if (!p) return null;
    const v = p.position(frame, this._pathPos);
    return { x: v.x, y: v.y, z: v.z };
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
    for (const i of this.instances) {
      i.a.dead = false;
      i.a.death = null;
      i.a.react = null;
      i.a.hits = {};
      i.a.latched.length = 0;
      for (const bone of i.a.removed) {
        const node = i.bones.get(bone);
        if (node) node.visible = true;
      }
      i.a.removed.length = 0;
      i.a.zones = 0;
      i.a.action = null;
      for (const [bone, g] of i.gore) {
        const node = i.bones.get(bone);
        const self = node as Mesh | undefined;
        if (self?.isMesh) {
          // The saved original, put back.
          self.geometry = (g as Mesh).geometry;
          self.material = (g as Mesh).material;
        } else {
          g.removeFromParent();
        }
      }
      i.gore.clear();
      // Class 0x10's hands come back empty: `CivilianInit` runs again below
      // and the script puts back whatever it puts back.
      for (const g of i.held?.values() ?? []) g.removeFromParent();
      i.held?.clear();
      for (const node of i.bones.values()) {
        for (const c of node.children) c.visible = true;
      }
      i.a.hp = this.startHp(this.json?.placements.find((x) => x.at === i.at));
      i.a.maxHp = i.a.hp;
      i.a.boneSlot = {};
      // Back to whatever the class's `Init` leaves behind -- and through the
      // permit release, so nothing is left holding one from before the seek.
      ReleaseAttackSlot(i.a);
      g_class_handlers[i.a.cls]?.init(i.a, this.rng);
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
    for (const inst of this.instances) {
      const a = ActorByAt(inst.at);
      if (a) inst.a = a;
      // Put every bone and every swapped part back, then re-apply what the
      // restored actor says was destroyed.
      for (const [bone, g] of inst.gore) {
        const node = inst.bones.get(bone);
        const self = node as Mesh | undefined;
        if (self?.isMesh) {
          self.geometry = (g as Mesh).geometry;
          self.material = (g as Mesh).material;
        } else {
          g.removeFromParent();
        }
      }
      inst.gore.clear();
      for (const node of inst.bones.values()) {
        node.visible = true;
        for (const c of node.children) c.visible = true;
      }
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

  /** Live, visible, shootable actors — what the enemy-wait opcodes count. */
  get aliveCount(): number {
    // The combat gate counts enemies, not everything with a skeleton: the cat
    // and the class-0x24 set-pieces are posed actors too, and counting them
    // holds `wait_enemies_alive` open for ever.
    return this.instances.filter(
      (i) => i.root.visible && !i.a.dead && ActorIsEnemy(i.a.cls)).length;
  }

  /** The debug clear. `ActorKillAll` is the port's; this only counts. */
  killAll(cameraYawBams = 0): number {
    return ActorKillAll(cameraYawBams, this.rng);
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
