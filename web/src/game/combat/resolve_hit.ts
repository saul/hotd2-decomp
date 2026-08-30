/**
 * What a bullet does.
 *
 * This was the last piece of gameplay living inside the renderer, and it does
 * not belong there: it decides hit points, which model each bone draws, what
 * comes off, whether the actor stumbles and which way it falls. All of that is
 * state, all of it is in the snapshot, and none of it needs three.js — the two
 * model swaps go out through `GameHost`, and the renderer applies them.
 *
 * The full account is docs/formats/combat.md.
 */
import type { Rng } from "../../core/rng";
import type { CharacterBone, CharacterType } from "../../bundle";
import { DamageZone, type Actor } from "../actor";
import { G } from "../globals";
import type { GameHost } from "../host";
import { CharacterTypeOf, MotionOf, T } from "../tables";

/**
 * `g_hit_result` (0x009A58F8) — what a shot did. The score, the impact sprite
 * and the ricochet sound all switch on it.
 */
export enum HitResultCode {
  /** Nothing: a hit on something already dead. */
  None = 0,
  /** Damaged, and the bone's model was swapped. */
  Damaged = 1,
  /** Damage only — no swap, no stumble for most character types. */
  Plain = 2,
  /** Severed: the bone kept its stump and everything below it came off. */
  Severed = 3,
  /** The sentinel. No damage, no score, and a ricochet rather than blood. */
  NoEffect = 5,
}

/**
 * The **control code** in a bone's effect-table step: each step reads its own
 * entry as the slot to draw and the *next* entry as one of these.
 *
 * An earlier revision folded 0/1/2 to "no slot" and never read them as codes,
 * so every hit reskinned the bone and nothing was ever severed — which is what
 * left a forearm animating below a destroyed upper arm.
 */
export enum EffectCode {
  /** Last step: damage, swap once, latch. */
  Last = 0,
  /** Damage, swap this bone, and remove every bone below it. */
  Sever = 1,
  /** Nothing at all — no damage and no score. */
  NoEffect = 2,
  /** Anything above `NoEffect` escalates: damage, swap, advance a step. */
  Escalate = 3,
}

export interface HitResult {
  damage: number;
  killed: boolean;
  head: boolean;
  hp: number;
  gore: boolean;
  severed: boolean;
  result: HitResultCode;
  death?: number;
  react?: number;
}

/**
 * `DamageRankModifier` — `FUN_00409870`. The per-bone bonus the adaptive rank
 * buys, added to the effect table's own damage and floored at zero.
 */
export function DamageRankModifier(b: CharacterBone | undefined): number {
  const rank = Math.min(15, Math.max(0, G.g_damage_rank));
  return b?.damage_rank?.[rank] ?? 0;
}

/**
 * Bone indices whose parent is *bone*.
 *
 * `CharacterBone.parent` is an **index into `bones`**, not a bone number — the
 * exporter flattens the EXE's node tree parents-first and records where the
 * parent sits in that list. The two happen to differ by one on a humanoid, so
 * comparing them directly is an off-by-one that mostly looks right, which is
 * exactly why it is resolved through the array here.
 */
const kidCache = new WeakMap<CharacterType, Map<number, number[]>>();

function childBones(type: CharacterType, bone: number): number[] {
  let kids = kidCache.get(type);
  if (!kids) {
    kids = new Map();
    type.bones.forEach((b) => {
      if (b.parent === null || b.parent === undefined) return;
      const p = type.bones[b.parent];
      if (!p) return;
      const list = kids!.get(p.bone) ?? [];
      list.push(b.bone);
      kids!.set(p.bone, list);
    });
    kidCache.set(type, kids);
  }
  return kids.get(bone) ?? [];
}

/**
 * `RemoveBoneSubtree` and `ActorSwapDamagedPart` both set
 * `obj+0x1318 |= 1 << g_bone_damage_zone[bone]`. Only three zones are named —
 * head, right arm, left arm — and the rest map to 0xFF, which the game's
 * `& 0x1F` shift parks on bit 31 where nothing reads it.
 */
function markZone(obj: Actor, bone: number): void {
  const z = T.chars?.bone_zones?.[bone];
  if (z === undefined || z > 7) return;
  obj.zones = (obj.zones | (1 << z)) & DamageZone.All;
}

/**
 * `ActorSwapDamagedPart` — `FUN_004098E0`. Replace a bone's model with the
 * damaged variant at *slot*, and set the zone bit when this bone has reached
 * its last stage.
 */
export function ActorSwapDamagedPart(obj: Actor, bone: number, slot: number,
                                     last: boolean, host: GameHost): boolean {
  if (!slot) return false;
  // `obj+0x20C + bone*0x90` -- the draw record.
  obj.boneSlot[bone] = slot;
  host.setBoneSlot(obj.at, bone, slot);
  if (last) markZone(obj, bone);
  return true;
}

/** `RemoveBoneSubtree` — `FUN_00409AF0`. This bone and everything under it. */
export function RemoveBoneSubtree(obj: Actor, bone: number): void {
  if (!obj.removed.includes(bone)) obj.removed.push(bone);
  markZone(obj, bone);
  const type = CharacterTypeOf(obj);
  if (!type) return;
  for (const b of childBones(type, bone)) RemoveBoneSubtree(obj, b);
}

/**
 * `SeverBoneChildren` — `FUN_00409AB0`. Remove every bone **below** this one.
 *
 * The severed bone itself keeps the stump model `ActorSwapDamagedPart` just
 * gave it; `RemoveBoneSubtree` then walks each *child* and zeroes its draw
 * slot, recursively.
 */
export function SeverBoneChildren(obj: Actor, bone: number): void {
  const type = CharacterTypeOf(obj);
  if (!type) return;
  for (const b of childBones(type, bone)) RemoveBoneSubtree(obj, b);
}

/**
 * `ActorPlayHitReaction` — `FUN_004544C0`: the stumble.
 *
 * Which clip is a two-level lookup — the actor's **body condition**
 * (`obj+0x130C`) picks a row, and the **reaction group** of the bone that was
 * hit picks the motion within it. `DAT_004C84A8` maps the bone to one of eight
 * groups and they partition the body exactly as you would draw it: head,
 * torso, each arm, pelvis, each leg. For the common zombie that is motions
 * 977, 982, 981, 979, 974, 961, 960 — all 29 frames except the legs at 39, so
 * a leg shot staggers for longer.
 */
export function ActorPlayHitReaction(obj: Actor, bone: number,
                                     result: HitResultCode): number | undefined {
  const group = T.chars?.reaction_groups?.[bone];
  const type = CharacterTypeOf(obj);
  const motion = group === undefined
    ? undefined : type?.reactions?.["0"]?.[group];
  if (!motion || !MotionOf(obj, motion)) return undefined;
  const b = T.chars?.reaction_blend;
  obj.react = {
    motion,
    t: 0,
    blend: result === HitResultCode.Severed ? (b?.sever ?? 20)
                                            : (b?.frames ?? 10),
    // `ActorSetMotion` hard-sets the leg reactions: no cross-fade.
    hard: bone >= (b?.hard_set_from_bone ?? 9),
  };
  return motion;
}

/**
 * `ActorReactToHit` — `FUN_004543F0`. It does **not** run for every hit.
 *
 * Results 1 (damaged and swapped) and 3 (severed) always react; results 2 and
 * 5 react only for character types 3 and 0x12. So a shot that merely takes hit
 * points off a zombie's pelvis does not interrupt its walk.
 */
export function ActorReactToHit(obj: Actor, bone: number,
                                result: HitResultCode): number | undefined {
  if (bone <= 0) return undefined;
  const ct = CharacterTypeOf(obj)?.type ?? -1;
  const reacts = result === HitResultCode.Damaged
    || result === HitResultCode.Severed
    || ((result === HitResultCode.Plain || result === HitResultCode.NoEffect)
        && (ct === 3 || ct === 0x12));
  return reacts ? ActorPlayHitReaction(obj, bone, result) : undefined;
}

/**
 * `ChooseDeathMotionDirectional` — `FUN_00456220`: `camera_yaw - actor_yaw`
 * against four ±45° arcs.
 *
 * Named by angle rather than front/back — see the note in
 * `hod2lib/characters.py`, which explains why those labels depend on two
 * conventions at once and why the *data* is the reliable half.
 */
export function ChooseDeathMotionDirectional(obj: Actor, cameraYawBams: number,
                                             rng: Rng): number | undefined {
  const d = T.chars?.deaths;
  if (!d || !d.front?.length) return undefined;
  const rel = Math.round(cameraYawBams - obj.yaw) & 0xffff;
  const inArc = (centre: number): boolean => {
    let x = (rel - centre) & 0xffff;
    if (x > 0x8000) x -= 0x10000;
    return Math.abs(x) <= d.arc;
  };
  if (inArc(0x4000)) return d.right;
  if (inArc(0xc000)) return d.left;
  const pool = inArc(0x8000) ? d.back : d.front;
  return pool[rng.int(pool.length)];
}

/**
 * `ResolveHit` — `FUN_00409430`. Charge one shot against one bone.
 *
 * The shape that matters is the **control code**: each step reads its own
 * effect-table entry as the slot to draw and the *next* entry as a code.
 *
 * ```
 * code 0   last step: damage, swap once, latch
 * code 1   SEVER: damage, swap this bone, and remove every bone below it
 * code 2   nothing at all — no damage and no score
 * code >2  escalate: damage, swap, advance
 * ```
 *
 * An earlier revision folded 0/1/2 to "no slot" and never read them as codes,
 * so every hit reskinned the bone and nothing was ever severed — which is what
 * left a forearm animating below a destroyed upper arm. For `char_adv00` the
 * sever code sits at step 5 of the upper arms, forearms, thighs and shins, so
 * a limb comes off on the fifth hit and takes everything below it with it.
 */
export function ResolveHit(obj: Actor, bone: number, cameraYawBams: number,
                           host: GameHost, rng: Rng): HitResult {
  const type = CharacterTypeOf(obj);
  const b = type?.bones.find((x) => x.bone === bone);
  const n = obj.hits[bone] ?? 0;
  const step = b?.steps?.[n];
  const slot = step?.[0] ?? 0;
  const code: EffectCode = step?.[1] ?? EffectCode.Last;
  const head = bone === type?.head_bone;
  const wasDead = obj.dead;

  // `damage = table + DamageRankModifier(bone)`, floored at zero.
  let damage = Math.max(0, (step?.[2] ?? 0) + DamageRankModifier(b));

  let result = HitResultCode.None;
  let gore = false;
  let severed = false;
  // The zone bit is set when the *next* code is 0 or 1 -- that is, when this
  // bone has reached its last stage.
  const swap = (): void => {
    const last = code === EffectCode.Last || code === EffectCode.Sever;
    gore = ActorSwapDamagedPart(obj, bone, slot, last, host) || gore;
  };
  const sever = (): void => { severed = true; SeverBoneChildren(obj, bone); };

  if (code === EffectCode.Last) {
    if (slot === 2) {
      result = HitResultCode.NoEffect;                                  // the sentinel: no effect
    } else {
      result = HitResultCode.Plain;
      obj.hp -= damage;
      if (bone === 1) {
        // The torso's last stage is the death wound: only on the hit that
        // takes it below one hit point.
        if (obj.hp < 1 && !obj.latched.includes(bone)) {
          result = HitResultCode.Severed;
          swap(); sever(); obj.latched.push(bone);
        }
      } else if (!obj.latched.includes(bone) && slot !== 0) {
        result = HitResultCode.Damaged;
        swap();
        obj.hits[bone] = n + 1;
        obj.latched.push(bone);
      }
    }
  } else if (code === EffectCode.Sever) {
    result = HitResultCode.Plain;
    obj.hp -= damage;
    if (!obj.latched.includes(bone)) {
      result = HitResultCode.Severed;
      swap(); sever(); obj.latched.push(bone);
    }
  } else if (code === EffectCode.NoEffect) {
    result = HitResultCode.NoEffect;
  } else {
    result = HitResultCode.Damaged;
    obj.hp -= damage;
    // `ResolveHit` counts the torso's real stages inline and withholds the
    // last one while the actor is alive.
    const withhold = obj.hp > 0 && bone === 1
      && (type?.torso_stages ?? 0) <= n + 1;
    if (!withhold) {
      swap();
      obj.hits[bone] = n + 1;
    }
  }
  if (result === HitResultCode.NoEffect) damage = 0;

  // A hit on something already dead scores nothing and cannot kill twice.
  if (wasDead && result === HitResultCode.Plain) result = HitResultCode.None;
  G.g_hit_result = result;

  // `ZombieOnShot` only reacts while the actor is alive; the death takes over
  // otherwise.
  const survived = !wasDead && obj.hp >= 1;
  const react = survived ? ActorReactToHit(obj, bone, result) : undefined;

  let death: number | undefined;
  const killed = !wasDead && obj.hp < 1
    && result !== HitResultCode.NoEffect;
  if (killed) {
    obj.dead = true;
    // The 1-in-4 headshot burst: `ResolveHit` swaps the head to slot 0, which
    // is `RemoveBoneSubtree`'s "gone" -- the head simply leaves.
    if (head && rng.next() < 0.25) {
      RemoveBoneSubtree(obj, bone);
      severed = true;
    }
    death = ChooseDeathMotionDirectional(obj, cameraYawBams, rng);
    if (death !== undefined && MotionOf(obj, death)) {
      obj.death = { motion: death, t: 0 };
    }
  }
  return { damage, killed, head, hp: Math.max(0, obj.hp), gore, severed,
           result, death, react };
}

/**
 * `ActorKillAll` — the debug clear. Drop every live actor to zero hit points
 * and start the directional death. Nothing is severed, because no bone was hit.
 */
export function ActorKillAll(cameraYawBams: number, rng: Rng): number {
  let n = 0;
  for (const obj of G.g_object_list) {
    if (!obj.visible || obj.dead) continue;
    obj.hp = 0;
    obj.dead = true;
    obj.react = null;
    const death = ChooseDeathMotionDirectional(obj, cameraYawBams, rng);
    if (death !== undefined && MotionOf(obj, death)) {
      obj.death = { motion: death, t: 0 };
    }
    n++;
  }
  return n;
}
