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
import { SpawnSeveredHead } from "../effects/severed_head";
import type { Rng } from "../../core/rng";
import type { CharacterBone, CharacterType } from "../../bundle";
import { ActorFlag, DamageZone, type Actor } from "../actor";
import { AppState, G } from "../globals";
import { SpawnClass } from "../spawn_class";
import { ActorIsEnemy, g_class_handlers } from "../registry";
import type { GameHost } from "../host";
import { CharacterTypeOf, MotionOf, T } from "../tables";

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
 *
 * **{@link ActorFlag.NoPartSwap} refuses it outright**, before anything: the
 * engine's first act after reading the bone's table entry is
 * `00409913 8b4834` / `00409916 f6c502 TEST CH,0x2` / `00409919 757f JNZ`,
 * and the jump target is the epilogue. Nothing is swapped, `obj+0x78` keeps
 * whatever it held and the `obj+0x1318` zone bit is not raised.
 */
export function ActorSwapDamagedPart(obj: Actor, bone: number, slot: number,
                                     last: boolean, host: GameHost): boolean {
  if (obj.flags & ActorFlag.NoPartSwap) return false;
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
    return Math.abs(x) <= DEATH_ARC;
  };
  if (inArc(0x4000)) return DEATH_RIGHT;
  if (inArc(0xc000)) return DEATH_LEFT;
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
 * How far above the actor's origin the head is thrown from.
 *
 * [diverges] The engine takes `obj+0x394`, the posed head point, through the
 * camera block's matrix. This port has no posed bone in `game/` -- the
 * skeleton is three.js's -- so the launch point is the actor's origin raised
 * by a humanoid's head height. The throw and everything after it are the
 * engine's; only the first position is approximate, and the head is moving
 * within one frame.
 */
const HEAD_LAUNCH_RISE = 11;

export function ResolveHit(obj: Actor, bone: number, cameraYawBams: number,
                           host: GameHost, rng: Rng): HitResult {
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

  // A hit on something already dead scores nothing and cannot kill twice.
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
  // would change when a civilian's on-shot script runs. Two named classes,
  // because two engine routines read the field.
  if (obj.cls === SpawnClass.Thrower || obj.cls === SpawnClass.Zombie) {
    obj.pendingHit = { bone, result };
  }
  const react = survived && !ownReaction
    ? ActorReactToHit(obj, bone, result) : undefined;

  let death: number | undefined;
  const killed = !wasDead && obj.hp < 1
    && result !== HitResultCode.NoEffect;
  if (killed) {
    obj.dead = true;
    // The 1-in-4 headshot burst: `ResolveHit` swaps the head to slot 0, which
    // is `RemoveBoneSubtree`'s "gone" -- the head simply leaves.
    //
    // `ResolveHit`'s **second** read of `g_app_state` opens this block, and it
    // is the same question as the first: `00409741 833d988e9c0006 CMP dword
    // ptr [0x009c8e98], 0x6` / `00409748 756c JNZ 0x004097b6`, which lands past
    // the whole head-pop condition on the flag raise and the score. So the head
    // only ever comes off in play. Inert here, like the `0xE00` OR, and for the
    // same reason.
    if (G.g_app_state === AppState.InPlay && head && rng.next() < 0.25) {
      // **The head is thrown, not just deleted.** `ResolveHit` runs three
      // calls here and this port had only the third: `SpawnBoneHitSprite`,
      // then `SpawnSeveredHead` (`FUN_0040A130`), then the swap to slot 0.
      // `docs/formats/combat.md` recorded the middle one as "a blood spray at
      // `obj+0x394`", which is why it was never ported -- it is an
      // `ActorAlloc` of an object with its own per-frame routine that carries
      // the head's own model and bounces it off the floor.
      //
      // The model has to be read **before** the subtree goes, because that is
      // what zeroes the slot the head is drawn with.
      const slot = obj.boneSlot[bone] ?? 0;
      const at = { x: obj.pos.x, y: obj.pos.y + HEAD_LAUNCH_RISE,
                   z: obj.pos.z };
      if (slot > 0) SpawnSeveredHead(at, slot, 0, obj.yaw);
      RemoveBoneSubtree(obj, bone);
      severed = true;
    }
    // `ResolveHit` also raises `obj+0x34` bit 0x4000000, which is what
    // `ThrowerOnShot` reads to tell a killing blow from a survivable one.
    obj.flags |= ActorFlag.Dead;
    if (!ownDeath) {
      death = ChooseDeathMotionDirectional(obj, cameraYawBams, rng);
      if (death !== undefined && MotionOf(obj, death)) {
        obj.death = { motion: death, ticks: 0 };
      }
    }
  }
  return { damage, killed, head, hp: Math.max(0, obj.hp), gore, severed,
           result, death, react };
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
 */
export function ActorKillAll(cameraYawBams: number, rng: Rng): KillAllResult {
  const out: KillAllResult = { enemies: 0, civilians: 0 };
  for (const obj of G.g_object_list) {
    if (!obj.visible || obj.dead) continue;
    // What a shot could not touch, this must not touch either — see
    // `ClassHandler.invulnerable`.
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
    if (obj.cls === SpawnClass.Thrower || obj.cls === SpawnClass.Zombie) {
      obj.pendingHit = { bone: 1, result: HitResultCode.Damaged };
    }
    // Same rule as `ResolveHit` above: a class that runs its own death gets
    // its own clip, and the shared one would stop the clock it counts on.
    if (!g_class_handlers[obj.cls]?.updatesWhenDead) {
      const death = ChooseDeathMotionDirectional(obj, cameraYawBams, rng);
      if (death !== undefined && MotionOf(obj, death)) {
        obj.death = { motion: death, ticks: 0 };
      }
    }
    if (ActorIsEnemy(obj.cls)) out.enemies += 1;
    else if (obj.cls === SpawnClass.Civilian) out.civilians += 1;
  }
  return out;
}
