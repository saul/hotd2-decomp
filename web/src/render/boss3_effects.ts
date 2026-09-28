/**
 * Class 0x45's draws that are not its skeleton: the intro card, the bite
 * flash, the wake, the sparks, the splashes, variant 1's path effects and the
 * opening civilian's shadow.
 *
 * Every one of them is an `AssetDrawSlot` the engine makes inside a routine
 * of the class or of one of its tasks, under a matrix built on the spot; the
 * port's routines leave what they drew on the record or the tail
 * (`game/class45/`), and this builds the same matrix and hangs a clone of the
 * slot's model under it. Nothing here is state: `update` and `resync` are the
 * same call, from what the port holds.
 *
 * The matrices, as the routines build them (call order = product order):
 *
 * * **card piece** (`Boss3IntroCardUpdate`, `FUN_00424900`):
 *   `MatrixLoadIdentity; T(x, y, z); RotY(yaw); Scale(s)` -- camera space --
 *   after, in step 1, the page curl on the card back (`card_curl.ts`).
 * * **bite flash** (`Boss3DrawBoneParts`, `FUN_004219E0`), on the bone's own
 *   matrix: a head `T(7, -0.5, 0) RotY(0x4000)`; the big head
 *   `T(7, -4.5, 0) RotY(0x4000) RotX(0x2000) Scale(1.5)`; the body
 *   `T(7, -0.5, 0) RotY(0x4000) Scale(1.5)`. Cels `0x97A + n % 0x27` and
 *   `0x199C + n % 32`.
 * * **wake** (the same routine), on each chain bone:
 *   `T(4, -1.5, -3.2) RotZ(0x4000) RotY(0x8000) RotX(0x4000)` and
 *   `T(4, -1.5, 3.2) RotZ(0x4000) RotX(0x4000) Scale(-1, 1, 1)`, both cel
 *   `0x8CE + g_frame_counter % 24`.
 * * **spark** (`Boss3SparkUpdate`, `FUN_004246F0`): camera space,
 *   `T(bone point x, y, z + r) RotY(0x8000) Scale(2s)` with `s` the blood's
 *   depth law times `[0x0055CB78]` 0.8.
 * * **splash** (`Boss3SplashUpdate`, `FUN_00424800`): world,
 *   `T(x, y, z)` then kind 0 `Scale(3)`, else `T(0, 4.5, 0) Scale(1, 2, 1)`.
 * * **path effect** (`Boss3PathEffectUpdate`, `FUN_00424E10`): world,
 *   `T(row) RotY(g_camera_block_yaw_bams) Scale(2)`, faded past the row's end
 *   by `AssetDrawSlotWithAlpha`.
 * * **shadow** (`Boss3OpeningBystanderUpdate`, `FUN_00420550`): world,
 *   `T(x, y + 0.3, z) Scale(10, 1, 10)`, slot `0x10D0`.
 * * **the water mound** (`Boss3MeshBulgeUpdate`, `FUN_00424C10`): slot
 *   `0x1850` in the world with its vertices raised where the body swam, and
 *   ten pieces at `T(x, 0, z)`. The raise is kept on this node's own copy of
 *   the geometry, as the engine keeps it in the loaded model; a seek or a
 *   load rebuilds the node flat, which the engine, having neither, never
 *   has to.
 */
import {
  type BufferGeometry, type Group, Matrix4, type Mesh,
  type Object3D, Quaternion, Vector3,
} from "three";
import { BAMS_TO_RAD, BAMS_TO_RAD_F64 } from "../core/bams";
import type { Boss3Actor } from "../game/actor";
import {
  BLOOD_DEPTH_BASE, BLOOD_DEPTH_FAR, BLOOD_DEPTH_RATE,
} from "../game/effects/blood";
import { G } from "../game/globals";
import { SpawnClass } from "../game/spawn_class";
import {
  BOSS3_BULGE_ARC, BOSS3_BULGE_BASE, BOSS3_BULGE_BELOW, BOSS3_BULGE_LIFT,
  BOSS3_BULGE_PIECE_FIRST_SLOT, BOSS3_BULGE_PIECE_XZ, BOSS3_BULGE_REACH,
  BOSS3_BULGE_SLOT, BOSS3_BYSTANDER_SHADOW_SLOT, BOSS3_CARD_PIECE_SLOTS,
  BOSS3_FLASH_A_CELS, BOSS3_FLASH_A_FIRST_SLOT, BOSS3_FLASH_B_CELS,
  BOSS3_FLASH_B_FIRST_SLOT, BOSS3_PATH_EFFECTS, BOSS3_PATH_EFFECT_FIRST_SLOT,
  BOSS3_SPARK_FIRST_SLOT, BOSS3_WAKE_CELS, BOSS3_WAKE_FIRST_SLOT,
} from "../game/class45/tables";
import { CURL_SLOT, CurlModelSlot7EEByYaw, curlHeldYaw } from "./card_curl";
import { setAssetDrawAlpha } from "./draw_order";

/** What this needs of the effect layer and the character layer. */
export interface Boss3EffectHost {
  /** A node for `key` at `slot` under `parent`, re-cloned when the slot moves. */
  node(key: string, slot: number, parent: Group): Object3D | null;
  /** World-space effects. */
  world: Group;
  /** Camera-space effects. */
  view: Group;
  /** The camera's world-to-view matrix, for the spark's depth. */
  viewMatrix: Matrix4;
  /** One bone's hit sphere in world space; see `BoneSphereSource`. */
  boneSphere(at: number, bone: number, out: Vector3): number | null;
  /** One bone's world matrix, as the skeleton was last posed. */
  boneMatrix(at: number, bone: number, out: Matrix4): boolean;
}

const AX = new Vector3(1, 0, 0);
const AY = new Vector3(0, 1, 0);
const AZ = new Vector3(0, 0, 1);
const _m = new Matrix4();
const _b = new Matrix4();
const _q = new Quaternion();
const _c = new Vector3();
const _v = new Vector3();

/** `MatrixTranslate` onto `m` (post-multiplied: the call order). */
function T(m: Matrix4, x: number, y: number, z: number): Matrix4 {
  return m.multiply(_b.makeTranslation(x, y, z));
}
function R(m: Matrix4, axis: Vector3, bams: number): Matrix4 {
  return m.multiply(_b.makeRotationFromQuaternion(
    _q.setFromAxisAngle(axis, bams * BAMS_TO_RAD)));
}
function S(m: Matrix4, x: number, y: number, z: number): Matrix4 {
  return m.multiply(_b.makeScale(x, y, z));
}

/** Put `node` under a whole matrix of its own. */
function place(node: Object3D, m: Matrix4): void {
  node.matrixAutoUpdate = false;
  node.matrix.copy(m);
  node.matrixWorldNeedsUpdate = true;
}

/**
 * `AssetDrawSlotWithAlpha` (`FUN_004185A0`)'s second argument, or `null` for
 * a plain `AssetDrawSlot` (`FUN_00418560`). The clone shares its template's
 * materials until it first fades and then gets its own, freed with the node
 * (see `effects.ts`).
 *
 * The state is `DrawModelWithForcedAlphaBlend`'s (`FUN_004A8440`), through
 * `setAssetDrawAlpha`: every mesh in the translucent pass, blended
 * `SRCALPHA`/`INVSRCALPHA`, at its **own** base alpha times this one, and
 * the texture's alpha with it -- **at 1 as at any other value**, because the
 * engine does not test the argument. It used to keep the plain draw at 1,
 * which was the same picture only while the exporter stripped the alpha of
 * every opaque-pass texture.
 */
export function setSlotAlpha(node: Object3D, alpha: number | null): void {
  setAssetDrawAlpha(node, alpha);
}

/** Every class-0x45 draw of the frame, as keys into `seen`. */
export function drawBoss3Effects(h: Boss3EffectHost, seen: Set<string>): void {
  drawCard(h, seen);
  for (const obj of G.g_object_list) {
    if (obj.cls !== SpawnClass.Boss3 || !obj.visible) continue;
    drawBoneParts(h, obj as Boss3Actor, seen);
    drawShadow(h, obj as Boss3Actor, seen);
  }
  drawSparks(h, seen);
  drawSplashes(h, seen);
  drawPathEffects(h, seen);
  drawMound(h, seen);
}

/**
 * The card pieces. Step 1 calls `CurlModelSlot7EEByYaw` (`FUN_004759C0`) for
 * each piece just before drawing it (`0x0042499F`) and step 2 does not, so a
 * `0x7EE` piece is bent by its own yaw while they turn and by the last
 * piece's after -- the banner's shape exactly; see `card_curl.ts`.
 */
function drawCard(h: Boss3EffectHost, seen: Set<string>): void {
  const pieces = G.g_boss3_card_pieces;
  const held = curlHeldYaw(pieces.map((p) => p.yaw));
  G.g_boss3_intro_cards.forEach((c, n) => {
    if (!c.drawn) return;
    pieces.forEach((p, i) => {
      const key = `b3card${n}_${i}`;
      const node = h.node(key, BOSS3_CARD_PIECE_SLOTS[i], h.view);
      if (!node) return;
      seen.add(key);
      _m.identity();
      S(R(T(_m, p.x, p.y, p.z), AY, p.yaw), p.scale, p.scale, p.scale);
      place(node, _m);
      if (BOSS3_CARD_PIECE_SLOTS[i] === CURL_SLOT) {
        CurlModelSlot7EEByYaw(node, c.step === 1 ? p.yaw : held);
      }
    });
  });
}

/** The flash's matrix on its bone, by which actor is drawing it. */
function flashLocal(m: Matrix4, index: number): Matrix4 {
  if (index === 2) {
    return S(R(R(T(m, 7, -4.5, 0), AY, 0x4000), AX, 0x2000), 1.5, 1.5, 1.5);
  }
  if (index === 8) return S(R(T(m, 7, -0.5, 0), AY, 0x4000), 1.5, 1.5, 1.5);
  return R(T(m, 7, -0.5, 0), AY, 0x4000);
}

const _bone = new Matrix4();

function drawBoneParts(h: Boss3EffectHost, obj: Boss3Actor,
                       seen: Set<string>): void {
  const t = obj.boss3;
  const blk = t.block;
  if (!blk || !t.drawn) return;
  if (t.flash >= 0) {
    const bone = t.index === 8 ? blk.weakBone : blk.jawB;
    if (h.boneMatrix(obj.at, bone, _bone)) {
      const cels = [
        BOSS3_FLASH_A_FIRST_SLOT + t.flash % BOSS3_FLASH_A_CELS,
        BOSS3_FLASH_B_FIRST_SLOT + t.flash % BOSS3_FLASH_B_CELS,
      ];
      cels.forEach((slot, k) => {
        const key = `b3flash${obj.at}_${k}`;
        const node = h.node(key, slot, h.world);
        if (!node) return;
        seen.add(key);
        place(node, flashLocal(_m.copy(_bone), t.index));
      });
    }
  }
  if (t.wakeBones) {
    const slot = BOSS3_WAKE_FIRST_SLOT + (t.wakeCel % BOSS3_WAKE_CELS);
    for (let i = 1; i < blk.boneCount; i++) {
      if (!(t.wakeBones & (1 << i))) continue;
      if (!h.boneMatrix(obj.at, i, _bone)) continue;
      for (let k = 0; k < 2; k++) {
        const key = `b3wake${obj.at}_${i}_${k}`;
        const node = h.node(key, slot, h.world);
        if (!node) continue;
        seen.add(key);
        _m.copy(_bone);
        if (k === 0) {
          R(R(R(T(_m, 4, -1.5, -3.2), AZ, 0x4000), AY, 0x8000), AX, 0x4000);
        } else {
          S(R(R(T(_m, 4, -1.5, 3.2), AZ, 0x4000), AX, 0x4000), -1, 1, 1);
        }
        place(node, _m);
      }
    }
  }
}

/** `[0x004C4D10]` 0.3 above her, flat and ten wide. */
const SHADOW_LIFT = 0.3;
const SHADOW_SPREAD = 10;

function drawShadow(h: Boss3EffectHost, obj: Boss3Actor,
                    seen: Set<string>): void {
  if (!obj.boss3.shadow) return;
  const key = `b3shadow${obj.at}`;
  const node = h.node(key, BOSS3_BYSTANDER_SHADOW_SLOT, h.world);
  if (!node) return;
  seen.add(key);
  _m.identity();
  S(T(_m, obj.pos.x, obj.pos.y + SHADOW_LIFT, obj.pos.z),
    SHADOW_SPREAD, 1, SHADOW_SPREAD);
  place(node, _m);
}

/** `[0x0055CB78]`, a double: the spark's share of the blood's depth law. */
const SPARK_SCALE = 0.8;

function drawSparks(h: Boss3EffectHost, seen: Set<string>): void {
  G.g_boss3_sparks.forEach((s, n) => {
    const r = h.boneSphere(s.at, s.bone, _c);
    if (r === null) return;
    _v.copy(_c).applyMatrix4(h.viewMatrix);
    const z = Math.fround(_v.z + r);
    const depth = z < BLOOD_DEPTH_FAR
      ? 1.0 : Math.fround(z * BLOOD_DEPTH_RATE + BLOOD_DEPTH_BASE);
    const scale = Math.fround(Math.fround(depth * SPARK_SCALE) * 2);
    const key = `b3spark${n}`;
    const node = h.node(key, BOSS3_SPARK_FIRST_SLOT + s.shown, h.view);
    if (!node) return;
    seen.add(key);
    _m.identity();
    S(R(T(_m, _v.x, _v.y, z), AY, 0x8000), scale, scale, scale);
    place(node, _m);
  });
}

function drawSplashes(h: Boss3EffectHost, seen: Set<string>): void {
  G.g_boss3_splashes.forEach((s, n) => {
    const key = `b3splash${n}`;
    const node = h.node(key, s.shown, h.world);
    if (!node) return;
    seen.add(key);
    _m.identity();
    T(_m, s.x, s.y, s.z);
    if (s.kind === 0) S(_m, 3, 3, 3);
    else S(T(_m, 0, 4.5, 0), 1, 2, 1);
    place(node, _m);
  });
}

function drawPathEffects(h: Boss3EffectHost, seen: Set<string>): void {
  G.g_boss3_path_effects.forEach((e, n) => {
    if (e.shown < 0) return;
    const row = BOSS3_PATH_EFFECTS[e.shownRow];
    if (!row) return;
    const key = `b3path${n}`;
    const node = h.node(key, BOSS3_PATH_EFFECT_FIRST_SLOT + e.shown, h.world);
    if (!node) return;
    seen.add(key);
    _m.identity();
    S(R(T(_m, row.x, row.y, row.z), AY, e.shownYaw), 2, 2, 2);
    place(node, _m);
    // `Boss3PathEffectUpdate` draws `AssetDrawSlot` inside the window and
    // `AssetDrawSlotWithAlpha` past its end, where the alpha is at most
    // (0x14 - 1) * 0.05: the record's 1 is the plain draw and nothing else.
    setSlotAlpha(node, e.shownAlpha < 1 ? e.shownAlpha : null);
  });
}

const _l = new Vector3();
const _toModel = new Matrix4();
const _toMesh = new Matrix4();

/**
 * The mound's vertex walk, on the node's own geometry: every vertex within
 * `BOSS3_BULGE_REACH` of the body in x and z is raised to the arc's height
 * if that is higher. Copied from the template the first time, so the stage's
 * shared model is never touched; the copies go with the node.
 */
function raiseMound(node: Object3D, x: number, z: number): void {
  node.updateMatrixWorld(true);
  node.traverse((o) => {
    const mesh = o as Mesh;
    let geo = mesh.geometry as BufferGeometry | undefined;
    if (!mesh.isMesh || !geo?.attributes?.position) return;
    if (!mesh.userData.boss3OwnGeometry) {
      geo = geo.clone();
      mesh.geometry = geo;
      mesh.userData.boss3OwnGeometry = true;
      const owned = (node.userData.ownedGeometries ??= []) as BufferGeometry[];
      owned.push(geo);
    }
    // Model space is the node's; a mesh below it may carry a transform.
    _toModel.identity();
    for (let p: Object3D | null = mesh; p && p !== node; p = p.parent) {
      p.updateMatrix();
      _toModel.premultiply(p.matrix);
    }
    _toMesh.copy(_toModel).invert();
    const pos = geo.attributes.position;
    let moved = false;
    for (let i = 0; i < pos.count; i += 1) {
      _l.fromBufferAttribute(pos, i).applyMatrix4(_toModel);
      const dx = _l.x - x;
      const dz = _l.z - z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (!(d < BOSS3_BULGE_REACH)) continue;
      // `FLD 10.0; FSUB ST0,ST1; FMUL [0x0055CBB0]; __ftol` -- on the FPU stack.
      const a = Math.trunc((BOSS3_BULGE_REACH - d) * BOSS3_BULGE_ARC);
      const y = Math.fround(Math.sin(a * BAMS_TO_RAD_F64) * BOSS3_BULGE_LIFT
                            - BOSS3_BULGE_BASE);
      if (!(y > _l.y)) continue;
      _l.y = y;
      _l.applyMatrix4(_toMesh);
      pos.setXYZ(i, _l.x, _l.y, _l.z);
      moved = true;
    }
    if (moved) {
      pos.needsUpdate = true;
      geo.computeBoundingSphere();
    }
  });
}

function drawMound(h: Boss3EffectHost, seen: Set<string>): void {
  G.g_boss3_mesh_bulges.forEach((b, n) => {
    const key = `b3mound${n}`;
    const node = h.node(key, BOSS3_BULGE_SLOT, h.world);
    if (node) {
      seen.add(key);
      place(node, _m.identity());
      if (b.deformed && b.atY < BOSS3_BULGE_BELOW) {
        raiseMound(node, b.atX, b.atZ);
      }
    }
    BOSS3_BULGE_PIECE_XZ.forEach(([x, z], i) => {
      const k = `b3mound${n}_${i}`;
      const piece = h.node(k, BOSS3_BULGE_PIECE_FIRST_SLOT + i, h.world);
      if (!piece) return;
      seen.add(k);
      place(piece, T(_m.identity(), x, 0, z));
    });
  });
}
