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
import { SpawnBoneHitSprite } from "../effects/blood";
import { SpawnSeveredHead } from "../effects/severed_head";
import { vec3 } from "../vec";
import { AngleWithinTolerance } from "../actor_turn";
import type { Rng } from "../../core/rng";
import type { CharacterBone, CharacterType } from "../../bundle";
import { ActorFlag, DamageZone, type Actor } from "../actor";
import { AppState, G } from "../globals";
import { CameraBlockYaw } from "../camera/view";
import { SpawnClass } from "../spawn_class";
import { ZombieState } from "../class30/states";
import { ScoreAddForPlayer } from "./score";
import { ActorIsEnemy, g_class_handlers } from "../registry";
import type { GameHost } from "../host";
import { CharacterTypeOf, MotionOf, PartSphereRowsOf, T } from "../tables";

// -- `.text` immediates ----------------------------------------------------
//
// Literals inside the routines below, not entries in a table the exporter can
// read, so they live here with their citation rather than in the bundle. See
// `docs/formats/bundle.md`.

/**
 * `ActorPlayHitReaction` (`FUN_004544C0`) cross-fades over this many frames,
 * +1, into the actor's second motion track.
 */
const REACT_BLEND = 10;
/** ...and over this many when the hit severed something (`obj+0x1364 == 3`). */
const REACT_BLEND_SEVER = 20;
/** The bone from which the reaction is hard-set instead of cross-faded. */
const REACT_BLEND_MAX_BONE = 9;

/**
 * `ChooseDeathMotionDirectional` (`FUN_00456220`) names two of its four arcs
 * with a literal motion; the other two draw from `.rdata` tables, which is why
 * `deaths.front` and `deaths.back` still come from the bundle and these do not.
 */
const DEATH_RIGHT = 992;
/** The 0xC000 arc. */
const DEATH_LEFT = 991;
/** `0x2000` BAMS = 45°, the half-width of each arc. */
const DEATH_ARC = 0x2000;

/**
 * The one character type `ResolveHit`'s sever arm singles out —
 * `004095C2  6683bff40100000c  CMP word ptr [EDI+0x1f4], 0xc`. What is
 * special about type 0x0C here is `[open]`; the test is transcribed because
 * the engine makes it.
 */
const SEVER_GATED_CHAR = 0xc;
/** ...unless `obj+0x136C` bit 7 is up, which lets it sever anyway. */
const SEVER_GATED_OVERRIDE = 0x80;
/** ...and bones below this one sever whatever the type. */
const SEVER_GATED_FIRST_BONE = 9;

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
  /** What the routine paid through `ScoreAddForPlayer`, for the readout. */
  points: number;
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
 * damaged variant at *slot*, give it that part's hit sphere, and set the
 * zone bit when this bone has reached its last stage.
 *
 * ```
 * next = effect[type][(rec+0x8C) + bone*6 + 1]            ; 0x004098ED..0x0040990E
 * if (g_cur_actor+0x34 & 0x200) return                     ; 0x00409916
 * rec+0x00 = slot                                          ; 0x00409922
 * if (slot == 0 || slot == 1) rec+0x78 = 0                 ; 0x00409973
 * else {
 *   ResolveDamagedPartSphere(rec, slot, type)              ; 0x0040993B
 *   ResolveDamagedPartSphere(rec, slot, type == 0xD ? 0xB : 7)
 * }
 * if (next == 0 || next == 1) obj+0x1318 |= 1 << g_bone_damage_zone[bone]
 * ```
 *
 * **{@link ActorFlag.NoPartSwap} refuses it outright**, before anything:
 * `00409913 8b4834` / `00409916 f6c502 TEST CH,0x2` / `00409919 757f JNZ`,
 * and the jump target is the epilogue. Nothing is swapped, `+0x78` keeps
 * whatever it held and the `obj+0x1318` zone bit is not raised.
 *
 * **Both searches run on every swap.** `ResolveDamagedPartSphere` returns 0
 * on both of its paths, so the `TEST EAX,EAX; JNZ 0x0040997a` at `0x00409943`
 * never skips the second one, and a row type 7 (or 0xB) has for the slot
 * overwrites whatever the actor's own table gave. `docs/formats/combat.md`
 * used to say the second was a fallback for a character with no variant of
 * its own; the shipped rows the two searches both find agree, so the
 * difference cannot be seen, and the routine is transcribed as it runs.
 *
 * **A search that finds nothing writes nothing**: the record keeps the
 * radius and centre it had -- the build's, or the last stage's. Many of
 * the slots the shipped effect tables name have no row in either table.
 *
 * *next* is read from the record's own step counter at the moment of the
 * call, which is why it is read here and not handed in: the headshot's swap
 * to slot 0 runs after a head hit may already have advanced the counter.
 *
 * Slot 0 is the port's {@link Actor.removed} rather than a `boneSlot` of 0:
 * a zero draw slot is what that list means (`BoneDrawSlot` in
 * `shot_test.ts`), and it is what the renderer hides. It removes this bone
 * alone, where `RemoveBoneSubtree` walks the subtree too; the only caller
 * that passes 0 in the shipped data is the headshot, on the head. The
 * renderer hides a removed node with everything under it, and bone 2 has
 * children only in types 0x1D, 0x1F, 0x46, 0x48, 0x49 and 0x4E -- the horde,
 * the bats, JUDGMENT's rider and the stage-3 boss, all hit whole or through
 * their own class's shot routine -- so no head the burst can take has
 * anything under it. `[likely]`, from the classes the bundles place those
 * types under.
 */
export function ActorSwapDamagedPart(obj: Actor, bone: number, slot: number,
                                     host: GameHost): boolean {
  const b = CharacterTypeOf(obj)?.bones.find((x) => x.bone === bone);
  const next = b?.steps?.[obj.hits[bone] ?? 0]?.[1] ?? EffectCode.Last;
  if (obj.flags & ActorFlag.NoPartSwap) return false;
  const k = String(bone);
  // `obj+0x20C + bone*0x90` -- the draw record's slot.
  if (slot === 0) {
    if (!obj.removed.includes(bone)) obj.removed.push(bone);
  } else {
    obj.boneSlot[k] = slot;
    host.setBoneSlot(obj.at, bone, slot);
  }
  if (slot === 0 || slot === 1) {
    obj.boneRadius[k] = 0;
  } else {
    ResolveDamagedPartSphere(obj, bone, slot, obj.charType);
    ResolveDamagedPartSphere(obj, bone, slot,
                             obj.charType === PART_SPHERE_TYPE_0B_OWNER
                               ? PART_SPHERE_FALLBACK_0B
                               : PART_SPHERE_FALLBACK);
  }
  if (next === EffectCode.Last || next === EffectCode.Sever) {
    markZone(obj, bone);
  }
  return slot !== 0;
}

/** `PUSH 0x7` at `0x00409957`: the table every other type searches second. */
const PART_SPHERE_FALLBACK = 7;
/** `PUSH 0xb` at `0x00409965`, for the one type `0x0040994D` names. */
const PART_SPHERE_FALLBACK_0B = 0xb;
/** `CMP word ptr [ECX + 0x1f4], 0xd` at `0x0040994D`. */
const PART_SPHERE_TYPE_0B_OWNER = 0xd;

/**
 * `ResolveDamagedPartSphere` — `FUN_004099A0`. Give a swapped part its own
 * hit sphere, if *type*'s table has one for it.
 *
 * ```
 * row = g_character_part_tables[type] + (g_character_bone_counts[type] - 1) * 0x14
 * for (; row.slot != -1; row++)
 *   if (row.slot == rec+0x00) { rec+0x78 = row.radius; rec+0x7C = row.centre; break }
 * return 0
 * ```
 *
 * The rows start one past the last bone's, which is where the per-bone rows
 * end; the bundle carries them as `part_spheres`. The comparison is against
 * the record's slot, which the caller has just written -- the pushed *slot*
 * is the same number and is never read. The radius is **not** scaled by the
 * model's size, unlike the build's (`MOV EDX,[ECX+0x10]; MOV [ESI+0x78],EDX`
 * at `0x004099DB`), so a damaged part on an actor drawn at another size is
 * shot through the table's own sphere.
 */
export function ResolveDamagedPartSphere(obj: Actor, bone: number,
                                         _slot: number, type: number): number {
  const k = String(bone);
  const drawn = obj.boneSlot[k];
  for (const row of PartSphereRowsOf(type)) {
    if (row.slot !== drawn) continue;
    obj.boneRadius[k] = row.radius;
    obj.boneCentre[k] = [row.centre[0], row.centre[1], row.centre[2]];
    break;
  }
  return 0;
}

/**
 * `RemoveBoneSubtree` — `FUN_00409AF0`. This bone and everything under it.
 *
 * ```
 * obj+0x1318 |= 1 << g_bone_damage_zone[bone]
 * rec+0x00 = 0; rec+0x78 = 0                   ; 0x00409B3A, 0x00409B41
 * for each child: RemoveBoneSubtree(child)
 * ```
 */
export function RemoveBoneSubtree(obj: Actor, bone: number): void {
  if (!obj.removed.includes(bone)) obj.removed.push(bone);
  obj.boneRadius[String(bone)] = 0;
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
 *
 * **The row is the actor's, not row zero.** This read `reactions["0"]` for
 * every actor and was the one lookup in the port that ignored the body
 * condition — `AttackListOf`, `AttackPicksOf`, `MotionRowOf` and
 * `ThrowHandsOf` all index by it, and the annotation on this address already
 * said this one does too. The engine:
 *
 * ```
 * 004544e5  0fbf86f4010000  MOVSX EAX, word ptr [ESI + 0x1f4]    ; character
 * 004544ec  8b8e0c130000    MOV   ECX, dword ptr [ESI + 0x130c]  ; condition
 * 004544f3  c1e002          SHL   EAX, 0x2
 * 004544f9  8b98c82f5900    MOV   EBX, dword ptr [EAX + 0x592fc8]
 * 004544ff  668b3c55a8844c00 MOV  DI, word ptr [EDX*0x2 + 0x4c84a8] ; group
 * 00454507  c1e102          SHL   ECX, 0x2
 * 0045450a  8b1c0b          MOV   EBX, dword ptr [EBX + ECX]     ; the row
 * 0045450d  8b3cbb          MOV   EDI, dword ptr [EBX + EDI*0x4] ; the clip
 * ```
 *
 * `[proved]`. Twenty-one character types carry a **second** row at body
 * condition 3 — motions 257–263, 43 frames instead of 29 — and nothing in the
 * port could reach it. `znkager`'s crawling body condition 4 is the same row
 * as 0, so this is not why a crawler stands up when it is shot; see
 * `ZombieStateStrike`'s note on the crawler's own attack table for that.
 */
export function ActorPlayHitReaction(obj: Actor, bone: number,
                                     result: HitResultCode): number | undefined {
  // **The refusal this routine opens with**, and the reason an emerging zombie
  // does not stagger:
  //
  // ```
  // 004544d8  f7463400200010  TEST dword ptr [ESI + 0x34], 0x10002000
  // 004544df  0f8571010000    JNZ  0x00454656          ; the epilogue
  // ```
  //
  // Not a state test — a flag test, and the states that must not be
  // interrupted are the ones that raise a bit. `ZombieStateEmerge`
  // (`FUN_004584E0`) holds {@link ActorFlag.NoHitReaction} from its first sub
  // to the frame it hands over to `AttackRun`; `ZombieStateStrike` holds
  // {@link ActorFlag.Committed} from its pick to `ZombieStateBackOff`'s first
  // frame, and `ZombieStateStandAndThrow` and `ZombieStateTargetMotionScript`
  // for the length of a throw or a maul.
  //
  // The port had neither half — no gate here and no raise in the emerge — so
  // every shot on a zombie climbing out of the water or the ground cut its
  // entrance clip with a stumble. It then had the gate and not the strike's
  // raise, which let a shot stagger any zombie out of its swing.
  //
  // Behind the gate the routine has one more arm, which is not here:
  // `if (obj+0x1310 == 3 && obj+0x1312 == 2) { obj+0x1310 = 4; obj+0x1312 = 0; }`
  // -- a shot mid-swing ends the strike. The gate makes it unreachable for
  // this class: every entry to state 3 writes sub 0 (`00455867`,
  // `00457743`, `00458c9d`), sub 0 raises `0x10000000` before it can reach
  // sub 2, and none of the five class-0x30 routines that clear the bit leaves
  // an actor in state 3 with it down -- `FUN_0045DA60`, the one that can run
  // mid-strike (from this routine's caller's result-4 arm), writes state
  // 0x32 in the same breath. `[likely]`, because state writes taken from
  // script data were not enumerated. The port's copy of this routine is also reached by
  // classes whose state 3 is something else, which is why it is not
  // transcribed as dead code.
  if (obj.flags & (ActorFlag.NoHitReaction | ActorFlag.Committed)) {
    return undefined;
  }
  const group = T.chars?.reaction_groups?.[bone];
  const type = CharacterTypeOf(obj);
  const row = type?.reactions?.[String(obj.condition)]
           ?? type?.reactions?.["0"];
  const motion = group === undefined ? undefined : row?.[group];
  if (!motion || !MotionOf(obj, motion)) return undefined;
  obj.react = {
    motion,
    ticks: 0,
    blend: result === HitResultCode.Severed ? REACT_BLEND_SEVER : REACT_BLEND,
    // `ActorSetMotion` (`FUN_00411930`) hard-sets the leg reactions: no fade.
    hard: bone >= REACT_BLEND_MAX_BONE,
  };
  return motion;
}

/**
 * `ActorReactToHit` — `FUN_004543F0`. It does **not** run for every hit.
 *
 * Results 1 (damaged and swapped) and 3 (severed) always react; results 2 and
 * 5 react only for character types 3 and 0x12. So a shot that merely takes hit
 * points off a zombie's pelvis does not interrupt its walk.
 *
 * **And one hit in the whole game does something else entirely.** The
 * result-1 arm asks whether this is a `znjoe` shot in the chest, and that arm
 * is {@link ActorReleaseBodyCreatureOnHit} — which is **not** called from
 * here, and cannot be. See the ordering note on that function.
 */
export function ActorReactToHit(obj: Actor, bone: number,
                                result: HitResultCode): number | undefined {
  if (bone <= 0) return undefined;
  const ct = CharacterTypeOf(obj)?.type ?? -1;
  // The `znjoe` arm `return`s before the stagger, so a hit that will take it
  // plays no reaction at all. The arm itself runs later in the same frame —
  // see {@link ActorWouldReleaseBodyCreature}.
  if (ActorWouldReleaseBodyCreature(obj, bone, ct, result)) return undefined;
  const reacts = result === HitResultCode.Damaged
    || result === HitResultCode.Severed
    || ((result === HitResultCode.Plain || result === HitResultCode.NoEffect)
        && (ct === 3 || ct === 0x12));
  return reacts ? ActorPlayHitReaction(obj, bone, result) : undefined;
}

/**
 * `[port-only]` as a function — it is `ActorReactToHit`'s first arm, inline in
 * the engine — and **the one place in the image that tests a character type
 * against `0x0A`.**
 *
 * ## It is called from `ZombieOnShot`, and that is not a detail
 *
 * `L11`, and it cost this feature a whole session. `ActorReactToHit`'s one
 * caller in the engine is `ZombieOnShot` (`FUN_00453EB0`), at
 * `0x0045401A PUSH EDI / CALL 0x004543F0` — and that call site is **after**
 * `ZombieOnShot`'s own death test:
 *
 * ```
 * 00453F3B  a900000080    TEST EAX, 0x80000000      ; obj+0x136C, dispatched
 * 00453F40  0f85ef000000  JNZ  00454035             ; ...already: nothing
 * 00453F46  f7463400000004 TEST dword [ESI+0x34], 0x4000000   ; Dead
 * 00453F4D  0f84c7000000  JZ   0045401A             ; alive -> the reaction
 * ```
 *
 * So the arm raises {@link ActorFlag.Dead} at a moment when the test that
 * reads it has already been taken for this frame, and by the next frame
 * state 25's own sub 0 has latched `obj+0x136C` bit `0x80000000` and
 * `ZombieOnShot` returns before the test. The bit is never acted on.
 *
 * The port had moved the reaction up into `ResolveHit`, which runs in
 * `ProcessShotRequests` at the **head** of the frame — so `Dead` went up,
 * state 25 went in, and `ZombieOnShot` then ran in the same frame, saw `Dead`
 * with the latch still clear, and overwrote state 25 with
 * {@link ZombieState.Death}. Every znjoe died with its chest shut. Measured:
 * a first torso hit at stage 5 block 0 took the actor from 100 hit points to
 * 35 -- alive, result 1, bone 1 -- and left it in state 6.
 *
 * So this lives here, next to the routine it is an arm of, and is **called
 * from `class30/on_shot.ts`** at the engine's own call site.
 *
 * `ZombieOnShot` reaches it only for an actor that is neither shot-immune nor
 * dead, which is why those two conditions are not repeated below.
 *
 * ```
 * 00454425  CMP word ptr [EAX + 0x1F4], 0xA   ; znjoe
 * 0045442f  CMP dword ptr [g_shot_bone + p*4], 0x1
 * 00454439  TEST dword ptr [EAX + 0x34], 0x400
 * ...       OR   dword ptr [EAX + 0x34], 0x4000400
 *           ScoreAddForPlayer(p, 0x50)
 *           obj+0x131C = p
 *           obj+0x1310 = 0x19;  obj+0x1312 = 0;  return
 * ```
 *
 * Four conditions and all four matter: hit **result 1**, the bone the shot
 * hit is **1** (the torso — `g_shot_bone` is a bone index and not a zone, and
 * this is the same bone the release then reskins), and
 * {@link ActorFlag.NoDismember} still **clear**, which is what makes it
 * once-only: the same `OR` raises that bit, so a second torso hit falls
 * through to an ordinary reaction. The `0x4000000` half of it is
 * {@link ActorFlag.Dead}, which `ResolveHit` otherwise raises only when the
 * hit points reach zero — so the shot that opens a `znjoe` is the shot that
 * kills it, whatever its hit points say, and the state's own sub 0 then
 * zeroes those too.
 *
 * `[proved]` and a whole-corpus fact: exactly **seven** spawns in the twelve
 * shipped scripts resolve to character type `0x0A`, all class 0x30 and all in
 * stage 5 — evt `0x0A68`, `0x0AF8`, `0x0B24`, `0x2E20`, `0x2E50`, `0x2F58`
 * and `0x2F8C` — and none of the seven carries `0x400` in its `init_flags`,
 * so every one of them can do this once.
 *
 * Returns true when the actor was sent to
 * {@link ZombieState.ReleaseBodyCreature}, because the engine **returns**
 * there: no stumble, and nothing below it runs.
 */
export function ActorReleaseBodyCreatureOnHit(obj: Actor, bone: number,
                                              charType: number,
                                              result: HitResultCode,
                                              player: number): boolean {
  if (!ActorWouldReleaseBodyCreature(obj, bone, charType, result)) return false;
  obj.flags |= ActorFlag.Dead | ActorFlag.NoDismember;
  ScoreAddForPlayer(player, RELEASE_CREATURE_SCORE);
  // `obj+0x131C = (char)player` — {@link Actor.killedBy}, whose own note
  // says the port's shot path carried no player and so never wrote it. This
  // arm has one, and the engine writes it here for the same reason it does on
  // a kill: the actor is dead from this instruction.
  obj.killedBy = player;
  obj.state = ZombieState.ReleaseBodyCreature;
  obj.sub = 0;
  return true;
}

/**
 * The arm's four conditions, on their own.
 *
 * `[port-only]` as a *split*: the engine has one `if` whose body both decides
 * and acts. The port has to ask the question in two places, because the two
 * halves of `ActorReactToHit` ended up on different sides of a frame — the
 * stagger in `ResolveHit`, at the head of the frame, and the arm in
 * `ZombieOnShot`, where the engine calls it. The stagger must be withheld on
 * the frame the arm will fire, because the engine's arm `return`s before
 * reaching it, and this is what lets both be true without the arm running
 * early.
 */
export function ActorWouldReleaseBodyCreature(obj: Actor, bone: number,
                                              charType: number,
                                              result: HitResultCode): boolean {
  // `if (g_hit_result[p] == 1)` is the outermost of the four: result 2 or 3
  // on the same bone of the same actor does nothing.
  if (result !== HitResultCode.Damaged) return false;
  if (charType !== RELEASE_CREATURE_CHAR_TYPE) return false;
  if (bone !== RELEASE_CREATURE_BONE) return false;
  if (obj.flags & ActorFlag.NoDismember) return false;
  return obj.cls === SpawnClass.Zombie;
}

/** `CMP word ptr [EAX + 0x1F4], 0xA` — `znjoe`, and nothing else. */
const RELEASE_CREATURE_CHAR_TYPE = 0x0a;
/** `CMP dword ptr [...], 0x1` on `g_shot_bone` — the torso. */
const RELEASE_CREATURE_BONE = 1;
/** `ScoreAddForPlayer(player, 0x50)` — paid for opening it, not for the kill. */
const RELEASE_CREATURE_SCORE = 0x50;

/**
 * `ChooseDeathMotionDirectional` — `FUN_00456220`: the camera block's yaw
 * less the actor's, against four ±45° arcs.
 *
 * ```
 * 00456248  rel = (g_camera_block_yaw_bams[g_camera_index] - obj+0x68) & 0xFFFF
 * 00456258  if (AngleWithinTolerance(rel, 0x4000, 0x2000)) motion = 0x3E0
 * 00456287  if (AngleWithinTolerance(rel, 0xC000, 0x2000)) motion = 0x3DF
 * 004562b3  if (AngleWithinTolerance(rel, 0x0000, 0x2000)) motion = [0x0059309C][rand() % 4]
 * 004562f6  if (AngleWithinTolerance(rel, 0x8000, 0x2000)) motion = [0x00593084][rand() % 6]
 * ```
 *
 * Four tests in a row, not an `else` chain: the arcs are inclusive at both
 * ends, so a heading exactly on a boundary passes two and the later one wins,
 * drawing its `rand()` if it has one.
 *
 * **The heading is the camera block's**, `g_camera_block_yaw_bams`
 * (`0x009A60D0`). Its callers used to hand in a yaw of their own --
 * `g_camera_yaw_bams` (`0x009C71F0`) from `ChooseDeathMotion`, which the
 * scene state's hooks write as a camera heading turned half round and so put
 * every body in the opposite arc, and that plus `0x8000` from the shot path,
 * which on a rail is the path pose's yaw rather than the eased one the camera
 * is drawn at. `[proved]`
 *
 * Named by angle rather than front/back — see the note in
 * `hod2lib/characters.py`, which explains why those labels depend on two
 * conventions at once and why the *data* is the reliable half.
 */
export function ChooseDeathMotionDirectional(obj: Actor,
                                             rng: Rng): number | undefined {
  const d = T.chars?.deaths;
  if (!d || !d.front?.length) return undefined;
  const rel = (CameraBlockYaw(G.g_camera_index) - obj.yaw) & 0xffff;
  let motion: number | undefined;
  if (AngleWithinTolerance(rel, 0x4000, DEATH_ARC)) motion = DEATH_RIGHT;
  if (AngleWithinTolerance(rel, 0xc000, DEATH_ARC)) motion = DEATH_LEFT;
  if (AngleWithinTolerance(rel, 0x0000, DEATH_ARC)) {
    motion = d.front[rng.int(d.front.length)];
  }
  if (AngleWithinTolerance(rel, 0x8000, DEATH_ARC)) {
    motion = d.back[rng.int(d.back.length)];
  }
  return motion;
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
 *
 * **Three suppression bits, and they are read on every path below.** Before it
 * looks at anything else the routine raises `obj+0x34 |= 0xE00` on the actor
 * it is charging, unless `g_app_state` is {@link AppState.InPlay}:
 *
 * ```
 * 00409495  a1988e9c00  MOV EAX, [0x009c8e98]     ; g_app_state
 * 0040949A  83f806      CMP EAX, 0x6
 * 0040949D  7409        JZ  0x004094a8            ; in play: skip the OR
 * 0040949F  8b4734      MOV EAX, dword ptr [EDI + 0x34]
 * 004094A2  80cc0e      OR  AH, 0xe               ; |= 0x0E00
 * 004094A5  894734      MOV dword ptr [EDI + 0x34], EAX
 * ```
 *
 * `[proved]`, and `80cc0e` occurs exactly once in `.text`. The three bits are
 * {@link ActorFlag.NoPartSwap}, {@link ActorFlag.NoDismember} and
 * {@link ActorFlag.NoHitResult}: nothing is reskinned, nothing comes off, and
 * the shot reports zero — which is the attract demo, `g_app_state` 5, playing
 * a stage without ever gibbing anything.
 *
 * **The port sits at 6, so the OR never fires here** — but `NoDismember` has
 * four other writers and 68 shipped class-0x30 spawns carry it in
 * `init_flags`, so the guards below are live in ordinary play. See the flag's
 * own comment for the whole list.
 *
 * The second read of `g_app_state` is the head pop; it is on the kill path
 * below.
 */
/**
 * The fallback launch height, for a host that cannot pose a skeleton.
 *
 * The real launch point is `GameHost.boneWorld` -- the posed head bone, which
 * is what `obj+0x394` is in the engine. This stands in only for a headless
 * host, which queues no shots in the first place.
 */
const HEAD_LAUNCH_RISE = 11;

/**
 * `0040974A`: character types 3, 0x12 and 0x18 keep their heads.
 *
 * `MOVSX ECX,[EDI+0x1f4]` then three `CMP`/`JZ` straight to the skip, before
 * the bone test and before the roll.
 */
const HEADLESS_EXEMPT = new Set([3, 0x12, 0x18]);

/**
 * The head, as `ResolveHit` asks it: `00409760 83fd02 CMP EBP, 0x2` for the
 * pop and `004097D7 83fd02 CMP EBP, 0x2` for the tail's payout, `EBP` loaded
 * from `g_shot_bone[p]` at `0x0040943A`. An immediate, so it lives here --
 * this used to read the bundle's `head_bone`, which the exporter writes as
 * the same `2` for every character type.
 */
const HEAD_BONE = 2;

// `ScoreAddForPlayer` amounts, all immediates in this routine's tail.
/** `004097DC 6a78 PUSH 0x78` -- a hit on bone 2. */
const SCORE_HEAD = 120;
/** `004097FF ADD word ptr [ESI + 0x9a5c82], 0xa` -- the combo's step. */
const SCORE_HEAD_COMBO_STEP = 10;
/** `00409823 6a0a PUSH 0xa` -- any other bone, unless the result is 5. */
const SCORE_HIT = 10;
/** `004097B9 6a50 PUSH 0x50` -- inside the kill block. */
const SCORE_KILL = 80;

/**
 * `DispatchHit` — `FUN_004092F0`. **The only caller of {@link ResolveHit} in
 * the whole image**, and the gate on it.
 *
 * ```
 * 00409336  8b4834      MOV  ECX, dword ptr [EAX + 0x34]
 * 00409339  f6c501      TEST CH, 0x1                  ; obj+0x34 & 0x100
 * 0040933c  750e        JNZ  0x0040934c               ; set -> past the call
 * 0040933e  56          PUSH ESI
 * 0040933f  e8ec000000  CALL 0x00409430               ; ResolveHit
 * ```
 *
 * `[proved]`, and the "only caller" half is proved too: `ResolveHit` has
 * exactly one xref in the image, the `CALL` above. So **an actor whose class
 * has made it shot-immune takes no damage at all** — not reduced damage, and
 * not a hit that is resolved and then discarded. A thrower lying on the ground
 * or getting up, a zombie still under the water in
 * `ZombieStateEmergeFromWater`, one frozen on a camera cue: every one of them
 * is `obj+0x34` bit `0x100`, and the shot never reaches the damage tables.
 *
 * The port had the *reaction* half of this rule in three places and the damage
 * half in none. `ThrowerOnShot` (`FUN_004499A0`) refuses to react while the
 * bit is up, `ZombieOnShot` (`FUN_00453EB0`) likewise, and
 * `ThrowerStateGetUp`'s doc comment said in so many words that "shots ricochet
 * off a thrower that is getting up" — while `FireShotRequest` charged the
 * damage anyway. A `zsass` knocked down and then shot on the ground therefore
 * reached zero hit points inside the one window where nothing was listening
 * for it: `dead` was set, the kill voice played, and its own `state 2` sub 4
 * went on to stand it back up, because the get-up arm is reached from the
 * switch and never re-reads `dead`. It then stood, threw and pounced as a
 * corpse, still inside `g_enemies_alive`. See `docs/BUGS.md`.
 *
 * `null` is the refusal. What the engine does *instead* is still a hit — the
 * shot marked the actor and the class's own feedback routine runs — so the
 * caller draws the ricochet and scores nothing; see `FireShotRequest`.
 *
 * `[diverges]` The engine's routine is a loop over `g_hit_player_order` that
 * also copies `obj+0x190+p` into `g_hit_bone[p]` and clears the per-player
 * marks afterwards. The port's shot path is a queue resolved per request
 * rather than per actor per frame — see `combat/shot.ts` — so the bone comes
 * in as an argument and the marks are the request. This is the gate and the
 * call, which is the part that decides anything.
 */
export function DispatchHit(obj: Actor, bone: number,
                            host: GameHost, rng: Rng,
                            player = 0): HitResult | null {
  if (obj.flags & ActorFlag.ShotImmune) return null;
  return ResolveHit(obj, bone, host, rng, player);
}

/**
 * `player` is the engine's **only** argument: `FUN_00409430` takes the player
 * index and reads the bone out of `g_shot_bone[player]`, which `DispatchHit`
 * (`FUN_004092F0`) has just filled from `obj+0x190 + player`. The port
 * resolves one queued request at a time and so passes the bone directly — but
 * the player is still needed: the routine pays whoever fired, names them as
 * the killer and steps their combo and hit count.
 */
export function ResolveHit(obj: Actor, bone: number,
                           host: GameHost, rng: Rng,
                           player = 0): HitResult {
  // `00409495`: out of play, this hit does nothing visible. Raised on the
  // actor, not scoped to the shot -- the engine ORs into `obj+0x34` and never
  // clears it, so an actor shot once in the attract demo stays inert.
  if (G.g_app_state !== AppState.InPlay) {
    obj.flags |= ActorFlag.NoPartSwap | ActorFlag.NoDismember
      | ActorFlag.NoHitResult;
  }
  const type = CharacterTypeOf(obj);
  const b = type?.bones.find((x) => x.bone === bone);
  const n = obj.hits[bone] ?? 0;
  const step = b?.steps?.[n];
  const slot = step?.[0] ?? 0;
  const code: EffectCode = step?.[1] ?? EffectCode.Last;
  // Bone 2, whatever the character: `EBP` is `g_shot_bone[p]`
  // (`0040943A MOV EBP, [EAX*4 + 0x9a2d88]`), and both readers compare it
  // with an immediate -- see {@link HEAD_BONE}.
  const head = bone === HEAD_BONE;
  // **The dead bit, `obj+0x34 & 0x4000000`** -- `MOV EBX, 0x4000000 / TEST
  // EBX, ECX` at `0x0040970C`, with ECX just loaded from `[EDI + 0x34]` --
  // and not `Actor.dead`, the port's own field, which several paths set
  // without the bit (a thrower's fall, its corpse) or leave down under it
  // (`ZombieStateDragTarget`'s release, the body creature's). The engine reads
  // it after the dispatch below; nothing in the dispatch writes it, so this is
  // the same word.
  const wasDead = (obj.flags & ActorFlag.Dead) !== 0;

  // `damage = table + DamageRankModifier(bone)`, floored at zero.
  let damage = Math.max(0, (step?.[2] ?? 0) + DamageRankModifier(b));

  let result = HitResultCode.None;
  let gore = false;
  let severed = false;
  // `ActorSwapDamagedPart` reads the step's code itself, off the counter,
  // which every arm below advances only after the swap.
  const swap = (): void => {
    gore = ActorSwapDamagedPart(obj, bone, slot, host) || gore;
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
        // takes it below one hit point, and only on an actor that comes
        // apart -- `004096BD 8b4734` / `004096C0 f6c404 TEST AH,0x4` /
        // `004096C3 752d JNZ`, which lands past the swap and the sever.
        if (obj.hp < 1 && !obj.latched.includes(bone)
            && !(obj.flags & ActorFlag.NoDismember)) {
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
    // The sever's own guard, and the engine writes it as one `if` around the
    // whole arm whose `else` is "damage only" -- so folding it into the inner
    // test is the same thing, because both halves charge the damage:
    //
    // ```
    // 004095BA  8b5734                MOV  EDX, dword ptr [EDI + 0x34]
    // 004095BD  f6c604                TEST DH, 0x4              ; NoDismember
    // 004095C0  756a                  JNZ  0x0040962c           ; damage only
    // 004095C2  6683bff40100000c      CMP  word ptr [EDI+0x1f4], 0xc
    // ```
    //
    // ...then character type 0x0C is let through anyway when `obj+0x136C` bit
    // 0x80 is up, and every bone below 9 is let through whatever the type. One
    // creature with one exception, transcribed rather than summarised.
    const dismemberable = !(obj.flags & ActorFlag.NoDismember)
      && (obj.charType !== SEVER_GATED_CHAR
          || (obj.flags2 & SEVER_GATED_OVERRIDE) !== 0
          || bone < SEVER_GATED_FIRST_BONE);
    if (dismemberable && !obj.latched.includes(bone)) {
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

  // `004096F6`: the actor reports nothing at all. The engine writes straight
  // over `g_hit_result` here, *after* the whole dispatch above has run and
  // before the already-dead test -- so the damage and the model swaps it just
  // did all stand, and only the reported result is thrown away.
  if (obj.flags & ActorFlag.NoHitResult) result = HitResultCode.None;

  // A hit on something already dead reports nothing and cannot kill twice --
  // `00409715`..`0040971F`, then the bit's second test at `0x0040972A`. It is
  // not worth nothing: result 0 is not 5, so the tail still pays a body hit.
  if (wasDead && result === HitResultCode.Plain) result = HitResultCode.None;
  G.g_hit_result = result;

  // `ZombieOnShot` only reacts while the actor is alive; the death takes over
  // otherwise.
  const survived = !wasDead && obj.hp >= 1;
  // **Class 0x31 reacts and dies through its own states**, so it takes the
  // shared damage, gore and score and none of the shared *animation*:
  // `ThrowerOnShot` reads this result on the actor's next tick and picks the
  // stumble, the knockdown or the tumble, and its death is a four-state chain
  // with its own clips. Handing it the shared stagger and the shared
  // *directional* death gave a `zstin` `zom.bin`'s animations, which belong to
  // a different creature.
  const ownReaction = obj.cls === SpawnClass.Thrower;
  // **Whose death this is.** `ResolveHit` (`FUN_00409430`) drops hit points
  // and nothing else; the clip comes from the class's own machine —
  // `ZombieStateDeath6` (`FUN_00454D20`) sub 0 calls `ChooseDeathMotion` for
  // class 0x30, `CivilianCheckShot` runs the killed script for class 0x10, and
  // `ThrowerOnShot` picks its own chain. `updatesWhenDead` is exactly the set
  // of classes that keep running one, so they do not get the shared clip.
  //
  // Handing it to a civilian was not cosmetic: `ActorAdvanceMotion` returns on
  // `obj.death` before it touches the base clock, so her killed script — which
  // waits on the clip looping once before the block whose wait word carries
  // `LeaveCountNow` — could never count that loop. She never left
  // `g_civilians_alive`, and `wait_scripted_actors` never opened.
  const ownDeath = g_class_handlers[obj.cls]?.updatesWhenDead ?? false;
  // **The hit record, for the two classes whose update reads one.**
  // `MarkActorShot` (`FUN_00404DB0`) raises `obj+0x34` bit 3 and writes
  // `obj+0x190` for *every* actor, and both `ThrowerOnShot` (`FUN_004499A0`)
  // and `ZombieOnShot` (`FUN_00453EB0`) open by testing that bit. This used to
  // be the thrower's alone, so class 0x30 had no edge into its own death
  // states at all -- which is why a killed zombie stood where it fell.
  //
  // Not keyed on `updatesWhenDead`, though the two sets happen to differ by
  // one: class 0x10 is in that set and `CivilianCheckShot` reads `pendingHit`
  // as one of three things that mean "hit this frame", so widening the write
  // would change when a civilian's on-shot script runs. Two engine routines
  // read the field, and three classes run them: class 0x18's update is
  // `CarriedZombieUpdate18` (`FUN_0045CD90`), which calls `EnemyZombieUpdate`
  // (`CALL 0x004533f0` at `0x0045CDDD`) and so `ZombieOnShot` with it. Left
  // out, a shot rider was flagged dead and never entered a death state, and
  // stayed in `g_enemies_alive` -- stage 3 block 1 step 1's
  // `wait_enemies_alive` never opened.
  if (obj.cls === SpawnClass.Thrower || obj.cls === SpawnClass.Zombie
      || obj.cls === SpawnClass.CarriedZombie) {
    obj.pendingHit = { bone, result, player };
  }
  const react = survived && !ownReaction
    ? ActorReactToHit(obj, bone, result) : undefined;

  let death: number | undefined;
  // **Two tests, and the result is not one of them.**
  //
  // ```
  // 0040972a  855f34          TEST dword ptr [EDI + 0x34], EBX   ; dead bit
  // 0040972d  0f85a4000000    JNZ  0x004097d7                    ; -> no kill
  // 00409733  6683bf1c010000  CMP  word ptr [EDI + 0x11c], 0x0   ; hit points
  // 0040973b  0f8f96000000    JG   0x004097d7                    ; -> no kill
  // ```
  //
  // `g_hit_result == 5` is read once in the block, at `0x0040976F`, and it
  // gates the head coming off and nothing else: the bit, the 0x50 and the
  // killer's byte are all written whatever the result. The port refused the
  // kill on a result-5 hit as well -- so an actor at or below zero hit points
  // whose bit was still down, shot on a bone whose step is the sentinel, was
  // never killed by it.
  const killed = !wasDead && obj.hp < 1;
  if (killed) {
    obj.dead = true;
    // The 1-in-4 headshot burst: `ResolveHit` swaps the head to slot 0 --
    // `ActorSwapDamagedPart(rec, 0, 2)` at `0x004097AA`, which zeroes the
    // slot and the radius of the head alone -- and the head simply leaves.
    //
    // `ResolveHit`'s **second** read of `g_app_state` opens this block, and it
    // is the same question as the first: `00409741 833d988e9c0006 CMP dword
    // ptr [0x009c8e98], 0x6` / `00409748 756c JNZ 0x004097b6`, which lands past
    // the whole head-pop condition on the flag raise and the score. So the head
    // only ever comes off in play. Inert here, like the `0xE00` OR, and for the
    // same reason.
    // `0040974A..0040976D`, the gates between the app-state test and the roll.
    // Two of the three are real and one is not:
    //
    // * three character types never lose a head — that one was missing here,
    //   so this port took heads off three the engine spares;
    // * `CMP word ptr [EDI + 0x3b8], 1 / JG skip` is **dead**.
    //   `obj+0x3B8` has exactly one reference in the whole image, this read,
    //   and `FUN_004A73D0` zeroes every actor from `obj+0x34` to the end of
    //   its block at allocation. So it is 0 for the life of every actor and
    //   the test can never take its jump. Not modelled, and not given a field:
    //   a name for it would be a name for where it sits.
    //
    // Then `CMP dword ptr [EAX*0x4 + 0x9a58f8], 0x5 / JZ skip` at
    // `0x0040976F`: a result-5 hit takes no head. This is where that test
    // lives, and the only place -- it used to be folded into `killed` above,
    // which it is not part of. The roll is `rand() % 4 == 0`
    // (`AND EAX, 0x80000003` and the sign fix-up, `0x0040977E`..`0x0040978B`),
    // drawn only once every gate before it has passed.
    if (G.g_app_state === AppState.InPlay && head
        && !HEADLESS_EXEMPT.has(obj.charType)
        && result !== HitResultCode.NoEffect && rng.int(4) === 0) {
      // **The head is thrown, not just deleted.** `ResolveHit` runs three
      // calls here and this port had only the third: `SpawnBoneHitSprite`,
      // then `SpawnSeveredHead` (`FUN_0040A130`), then the swap to slot 0.
      // `docs/formats/combat.md` recorded the middle one as "a blood spray at
      // `obj+0x394`", which is why it was never ported -- it is an
      // `ActorAlloc` of an object with its own per-frame routine that carries
      // the head's own model and bounces it off the floor.
      //
      // The model has to be read **before** the swap, because that is what
      // zeroes the slot the head is drawn with.
      //
      // **`boneSlot` is only written by a swap.** It starts empty, so a head
      // that has never been shot before the killing shot has no entry in it —
      // which is the *common* case, and it is why the first cut of this spawned
      // nothing at all. `obj+0x32C` in the engine is the bone's current model
      // whether or not anything has swapped it, so the fallback here is the
      // skeleton's own pristine slot for that bone.
      const slot = obj.boneSlot[bone]
        ?? type?.bones.find((b) => b.bone === bone)?.slot ?? 0;
      // `SpawnSeveredHead` seeds from `obj+0x394`, the **posed head point**.
      // `GameHost.boneWorld` is that same fact, and `ResolveHit` already holds
      // the host, so the head starts where the head actually is rather than at
      // a guessed height above the actor's origin. The fallback is only for a
      // host with no scene, which queues no shots anyway.
      // The first of the three, and the one this port had all along in the
      // sense that it did nothing: `SpawnBoneHitSprite` (`FUN_00407200`) is
      // the twenty-five-frame flipbook at the bone, with no severity.
      SpawnBoneHitSprite(obj.at, bone);
      const at = vec3(obj.pos.x, obj.pos.y + HEAD_LAUNCH_RISE, obj.pos.z);
      host.boneWorld(obj.at, bone, at);
      if (slot > 0) SpawnSeveredHead(at, slot, 0, obj.yaw);
      // The third call, and **not** `RemoveBoneSubtree`, which this was: the
      // swap takes the head and nothing under it, raises the zone bit only if
      // the head's current step is its last, and is refused like any other
      // swap under `NoPartSwap` -- where the head is thrown all the same.
      ActorSwapDamagedPart(obj, bone, 0, host);
      severed = true;
    }
    // `ResolveHit` also raises `obj+0x34` bit 0x4000000, which is what
    // `ThrowerOnShot` reads to tell a killing blow from a survivable one...
    obj.flags |= ActorFlag.Dead;
    // ...pays the kill, `004097B9 PUSH 0x50` / `004097C1 CALL 0x004156c0`...
    ScoreAddForPlayer(player, SCORE_KILL);
    // ...and names the killer: `004097D1 888f1c130000 MOV byte ptr
    // [EDI + 0x131c], CL`, CL the player argument.
    // `CivilianPruneDeadChildren` (`FUN_0048CA60`) copies it off a dead
    // captor into `sub+0x6C`, the rescue's payee; left at -1 every rescue
    // paid both players.
    obj.killedBy = player;
    if (!ownDeath) {
      death = ChooseDeathMotionDirectional(obj, rng);
      if (death !== undefined && MotionOf(obj, death)) {
        obj.death = { motion: death, ticks: 0 };
      }
    }
  }

  // `004097D7`, the tail, reached by every hit the dispatch above charged --
  // alive, dead or just killed. **The payout is this routine's**, and it used
  // to be `FireShotRequest`'s, which summed the four amounts into one call and
  // never counted the hit:
  //
  // ```
  // 004097D7  CMP EBP, 0x2 / JNZ 0x00409819          ; bone 2?
  //           ScoreAddForPlayer(p, 0x78)
  //           ScoreAddForPlayer(p, (s16)g_head_combo_bonus[p])
  //           g_head_combo_bonus[p] += 10;  g_player_hit_count[p]++;  return
  // 00409819  CMP [g_hit_result + p*4], 5 / JZ 0x0040984c
  //           ScoreAddForPlayer(p, 10);  g_player_hit_count[p]++
  // 0040984C  g_head_combo_bonus[p] = 0
  // ```
  //
  // So the head pays on any result and the body's ten and its count are
  // withheld from a result-5 hit alone -- `g_hit_result` as it stands after
  // the two overwrites above. `g_player_hit_count` (`0x009A5C86`) is the
  // numerator of the end-of-stage accuracy grade.
  let points = killed ? SCORE_KILL : 0;
  if (head) {
    const combo = G.g_head_combo_bonus[player];
    ScoreAddForPlayer(player, SCORE_HEAD);
    ScoreAddForPlayer(player, combo);
    G.g_head_combo_bonus[player] = combo + SCORE_HEAD_COMBO_STEP;
    G.g_player_hit_count[player] += 1;
    points += SCORE_HEAD + combo;
  } else {
    if (result !== HitResultCode.NoEffect) {
      ScoreAddForPlayer(player, SCORE_HIT);
      G.g_player_hit_count[player] += 1;
      points += SCORE_HIT;
    }
    G.g_head_combo_bonus[player] = 0;
  }
  return { damage, killed, head, hp: Math.max(0, obj.hp), gore, severed,
           result, death, react, points };
}

/** What {@link ActorKillAll} cleared, split by which gate it opens. */
export interface KillAllResult {
  enemies: number;
  civilians: number;
}

/**
 * `ActorKillAll` — the debug clear. Drop every live actor to zero hit points
 * and start the directional death. Nothing is severed, because no bone was hit.
 *
 * It raises `ActorFlag.Dead` as well as `dead`, exactly as `ResolveHit` does on
 * a killing blow, and that is the difference between clearing the room and
 * clearing half of it. **A class that dies through its own states reads the
 * flag, not `dead`**: `CivilianCheckShot` runs the civilian's killed script
 * off it, and that script is what carries `LeaveCountNow` and takes her out of
 * `g_civilians_alive` — 59 of the 60 streams the shipped scripts use as a
 * death script do. Without the flag the button killed the enemies and left
 * every civilian standing in the count, holding `wait_scripted_actors` open
 * with nothing on screen to shoot.
 *
 * **And it stands in for a shot, so it is refused wherever a shot is.**
 * {@link DispatchHit} (`FUN_004092F0`) returns before `ResolveHit` on
 * `ActorFlag.ShotImmune`, so in the engine an actor can never reach zero hit
 * points inside that window — which is exactly what both enemy classes rely
 * on. `ThrowerOnShot` (`FUN_004499A0`) gates its **whole** response on
 * `(obj+0x34 & 0x100) == 0` — `004499f5 f6c401 TEST AH,0x1` then
 * `004499f8 0f85f8000000 JNZ 0x00449af6`, the routine's own tail, so the dead
 * arm at `00449a3e TEST EAX,0x4000000` is past it — and `ZombieOnShot`
 * (`FUN_00453EB0`) is the same pair at `00453ec7`/`00453eca`, jumping to
 * `0x0045404e`. `[proved]`
 *
 * So an actor killed from outside while shot-immune is dead and *never told*:
 * its class's death chain never opens, and the chain is what runs
 * `ThrowerReleaseSlotOnDeath` (`FUN_0044D050`) and
 * `ZombieReleasePermitAndUntrack` (`FUN_004565A0`) — the two routines that
 * take it out of `g_enemies_alive` and out of `g_enemy_slots`. It then stands
 * up and goes back to its ordinary states as a corpse, holding the room-clear
 * gate open for ever.
 *
 * That is stage 6 block 0's hang: a `zslman` caught in the tail of
 * `ThrowerStateKnockedTumbling` (`FUN_00450E40`), which raises the bit as the
 * body settles and holds it through the get-up clip (`obj+0x133C = 0x14` on
 * the way out is the same window again). The window is transient — the clip
 * ends, the bit goes, and the next shot or the next clear takes the actor in
 * the ordinary way — so refusing here is not "this actor can never be
 * cleared", it is "not this frame", which is what a shot would have been told.
 */
export function ActorKillAll(rng: Rng): KillAllResult {
  const out: KillAllResult = { enemies: 0, civilians: 0 };
  for (const obj of G.g_object_list) {
    if (!obj.visible || obj.dead) continue;
    // What a shot could not touch, this must not touch either — see
    // `ClassHandler.invulnerable` for the class's own answer, and
    // `DispatchHit` for the one every class shares.
    if (obj.flags & ActorFlag.ShotImmune) continue;
    if (g_class_handlers[obj.cls]?.invulnerable?.(obj)) continue;
    obj.hp = 0;
    obj.dead = true;
    obj.react = null;
    obj.flags |= ActorFlag.Dead;
    // **A class that reads a hit has to be given one.** `ResolveHit` records
    // `pendingHit` for the classes whose own routine reads one, and
    // `ThrowerOnShot` / `ZombieOnShot` are the only things that route a
    // thrower or a zombie into its death chain — so without this the button
    // left a thrower flagged dead and still pouncing, while the enemy gate,
    // which was counting something else, opened behind it. The bone is 1, the
    // torso: bone 0 never reacts and bone 2 would decapitate, and this stands
    // in for a killing shot rather than a particular one.
    //
    // Class 0x30 is routed the same way, and **not** hand-assembled. It used
    // to be given `dead`, the flag and a death clip here and nothing else,
    // which is three of the eleven things `ZombieStateDeath6` does and none of
    // the teardown: no permit release, no untrack, no retire from either
    // count, no corpse and no despawn. Reproducing a state machine's effects
    // at its call site is exactly what `ThrowerOnShot`'s note above was
    // written against, and the same reasoning covers both classes now.
    if (obj.cls === SpawnClass.Thrower || obj.cls === SpawnClass.Zombie
        || obj.cls === SpawnClass.CarriedZombie) {
      obj.pendingHit = { bone: 1, result: HitResultCode.Damaged };
    }
    // Same rule as `ResolveHit` above: a class that runs its own death gets
    // its own clip, and the shared one would stop the clock it counts on.
    if (!g_class_handlers[obj.cls]?.updatesWhenDead) {
      const death = ChooseDeathMotionDirectional(obj, rng);
      if (death !== undefined && MotionOf(obj, death)) {
        obj.death = { motion: death, ticks: 0 };
      }
    }
    if (ActorIsEnemy(obj.cls)) out.enemies += 1;
    else if (obj.cls === SpawnClass.Civilian) out.civilians += 1;
  }
  return out;
}
