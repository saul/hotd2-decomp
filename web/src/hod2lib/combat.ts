/**
 * What a shot does: damage, reactions, attacks, gore and death.
 * The port of `tools/hod2lib/combat.py`.
 *
 * The tables `ResolveHit`, `ActorPlayHitReaction`, `ZombieStateStrike`,
 * `ThrowerStateThrow`, `ActorShotFeedback` and `FUN_00456220` read, with the
 * address of each beside it. `docs/formats/combat.md` is the long form; this
 * is the reader.
 *
 * **Every address here is `.rdata` and every literal is `.text`, and the two
 * go to different places.** A table is read out of the EXE and travels in the
 * bundle; an immediate compiled into a routine is a *constant of the port* and
 * belongs in `web/src/game/` beside the code that uses it, carrying the
 * citation it has here.
 */

import { asF32, f32, i16, i32s, u16s, u32, u32s } from "./bytes";
import { CLASS30_ARC_SCRIPTS, arcScript } from "./arcscript";
import type { ArcStage } from "./arcscript";
import type { ExeTables } from "./exetab";

/**
 * `PTR_DAT_004D032C[char_type]`, stride 0x14 indexed `bone - 1`:
 * `{u32 slot; f32 centre[3]; f32 radius}`. The per-bone hit sphere the shot
 * test uses.
 */
export const HIT_SPHERES = 0x004d032c;

/** `PTR_DAT_004C8350[char_type]`: `u16[bone][6]`, damage per successive hit. */
export const HIT_DAMAGE = 0x004c8350;

/**
 * `PTR_DAT_004C7160[char_type]`: `u16[bone][6]`, the asset slot the bone is
 * redrawn with after each hit -- the gore swap.
 */
export const HIT_EFFECT = 0x004c7160;

/** Steps per bone in both tables. */
export const HIT_STEPS = 6;

/**
 * `PTR_DAT_004D0D84[char_type]`: `s8[bone][16]`, added to the table damage.
 * Indexed by the adaptive damage rank, **not** by the menu difficulty.
 */
export const HIT_DAMAGE_RANK = 0x004d0d84;

export const HIT_RANKS = 16;

/**
 * `DAT_004C4D18`: `u8[16]`, bone -> the bit `RemoveBoneSubtree` sets in the
 * actor's destroyed-zone mask at `obj+0x1318`. 0xFF means "no zone".
 */
export const BONE_ZONE = 0x004c4d18;

/** `DAT_005776B0`: `s32[5]`, added to a spawn's hit points, clamped [1, 300]. */
export const DIFFICULTY_HP_DELTA = 0x005776b0;

/** `DAT_005679F4`: `s8[5]`, difficulty -> the rank the game starts at. */
export const INITIAL_DAMAGE_RANK = 0x005679f4;

/**
 * `PTR_PTR_00592FC8[char_type]` -> `motion*[variant][group]`: the **stumble**
 * an actor plays when a shot hurts it but does not kill it.
 */
export const HIT_REACT_TABLE = 0x00592fc8;

/**
 * Not really an alternate reaction table: this is the character's **general
 * motion row**, per body condition, and several states index it directly.
 *
 *     0, 1  ZombieStateApproach -- the two walk variants, by obj+0x136C bit 21
 *     2, 3  ZombieStateAttackRun -- the run, by bit 27
 *     4     ZombieStateBackOff -- the back-away walk
 */
export const HIT_REACT_ALT_TABLE = 0x00592cbc;

/** How many entries of that row to export. */
export const MOTION_ROW_LEN = 8;

/** Index 4: the clip `ZombieStateBackOff` plays while retreating. */
export const MOTION_ROW_BACKOFF = 4;

/** `DAT_004C84A8`: `u16[16]`, bone -> reaction group. */
export const REACT_GROUP = 0x004c84a8;

export const REACT_GROUPS = 8;

/**
 * How far before a pointer table its variant arrays are packed. They are
 * contiguous with it, so this only has to be generous, not exact.
 */
export const ARRAY_BLOCK = 0x1000;

/**
 * `PTR_PTR_00592F18[char][body_condition]` -> 0x10-byte attack entries:
 *
 *     +0x00 s16  the strike motion
 *     +0x02 s16  the lunge motion, played while still beyond *distance*
 *     +0x04 f32  distance inside which the strike starts
 *     +0x08 s16  the frame of the strike clip on which the hit lands
 *     +0x0A s16  the motion the *player* plays when hit
 *     +0x0C u16  cancel mask
 */
export const ATTACK_TABLE = 0x00592f18;

export const ATTACK_ENTRY = 0x10;

/** A hard cap on the entry scan; the real end comes from the next row. */
export const ATTACK_MAX = 16;

/** `PTR_PTR_00592DC0[char][cond]`: which attack to use. */
export const ATTACK_PICK_TABLE = 0x00592dc0;

export const ATTACK_PICK_PER_ZONE = 10;

export const ATTACK_ZONE_COMBOS = 8;

/** What the continue screen restores, and the player's default. */
export const PLAYER_START_LIVES = 2;

/**
 * `PTR_DAT_00592A00[body_condition]` -> two 0x10-byte entries, the same layout
 * as {@link ATTACK_TABLE}, read by `ThrowerStateThrow`. Entry 0 is the right
 * hand (bone 5), entry 1 the left (bone 8).
 */
export const THROW_TABLE = 0x00592a00;

export const THROW_CONDITIONS = 4;

export interface HandKit {
  held: number | null;
  bare: number;
  projectile: number;
  weapon_bone?: number;
}

/**
 * `EnemyThrowerInit` and `SpawnThrownWeapon` name these outright, per
 * character type. *held* is what the hand draws while armed, *bare* what it
 * drops to once thrown, and *projectile* the model that flies.
 */
export const THROWER_SLOTS: Record<number, {
  /**
   * `obj+0x1364` — and it is a **constant tilt, not a rate**, whatever the
   * field is called.
   *
   * `SpawnThrownWeapon` (`FUN_004504E0`) writes it onto the projectile per
   * character type, and `ThrownWeaponUpdate` (`FUN_00450780`) draws
   * `Rz(obj+0x6C) * Ry(obj+0x68) * Rx(obj+0x1364 + obj+0x64)` — so it is
   * added once, to the **X** term. The tumble is `obj+0x135C` accumulating
   * into `obj+0x68`, which is a different field on a different axis, and the
   * port drove the tumble with this number until that was read properly. The
   * name is older than the reading and stays until the next format bump.
   */
  5: HandKit; 8: HandKit; spin: number;
}> = {
  0x16: {                                    // zsass.bin
    5: { held: 0x1fa2, bare: 0x1f9f, projectile: 0x1f91 },
    8: { held: 0x1f9e, bare: 0x1f9b, projectile: 0x1f90 },
    spin: 0x600,
  },
  0x18: {                                    // held slots come from the skeleton
    5: { held: null, bare: 0x1ff1, projectile: 0x1fe2 },
    8: { held: null, bare: 0x1fed, projectile: 0x1fe1 },
    spin: 0,
  },
};

/**
 * The **class 0x30** hand kits, a different family from {@link THROWER_SLOTS}:
 * `ZombiePickThrowingHand` tests *held* to see whether a hand is still armed,
 * and `ZombieThrowHandWeapon` swaps it to *bare*, clears the weapon bone
 * beside it and gives the projectile *projectile*.
 *
 * Only three character types throw, and the switch in each of those two
 * functions is the whole list -- there is no table.
 */
export const ZOMBIE_THROW_SLOTS: Record<number, { 5: HandKit; 8: HandKit }> = {
  0x01: {                                    // znassb.bin
    5: { held: 0x1ba9, bare: 0x1bac, weapon_bone: 6, projectile: 0x1b8d },
    8: { held: 0x1ba5, bare: 0x1ba8, weapon_bone: 9, projectile: 0x1b8c },
  },
  0x13: {                                    // tutorial.bin
    5: { held: 0x1ece, bare: 0x1ecb, weapon_bone: 6, projectile: 0x249 },
    8: { held: 0x1eca, bare: 0x1ec7, weapon_bone: 9, projectile: 0x249 },
  },
  0x14: {                                    // znonoopa.bin
    5: { held: 0x1ef9, bare: 0x1ef6, weapon_bone: 6, projectile: 0x249 },
    8: { held: 0x1ef5, bare: 0x1ef3, weapon_bone: 9, projectile: 0x249 },
  },
};

/** `znonoo.bin` part 0 -- the axe, the only projectile that flies straight. */
export const ZOMBIE_AXE_SLOT = 0x249;

export const ZOMBIE_THROW_SPEED_STANDING = 1.5;
export const ZOMBIE_THROW_SPEED = 1.0;
export const ZOMBIE_THROW_AIM_DROP = 1.5;
/** `ZombieThrownWeaponStateArc`'s gravity, `0x3C1374BC`, negated for bone 8. */
export const ZOMBIE_THROW_ARC_GRAVITY = 0.008999999612569809;
export const ZOMBIE_THROW_HIT_KIND = 4;
export const ZOMBIE_THROW_ARC_HIT_KIND = 6;

/** `ZombieStateStandAndThrow` (class 0x30 state 33) reads its own tail. */
export const STAND_AND_THROW_STATES: Record<number, number[]> = { 0x30: [33] };

/** `ThrownWeaponFlyToTarget`. The weapon flies straight at 1.2 per frame. */
export const THROW_SPEED = 1.2;
export const THROW_AIM_AHEAD = 4.0;
export const THROW_AIM_SIDE = 0.6;
export const THROW_STICK_FRAMES = 30;
export const THROW_BLINK_FRAMES = 60;

/** `DAT_00577674`: the sound ids `ActorPlayHitVoice` picks from. */
export const HIT_VOICE_TABLE = 0x00577674;

/** Character types that take **voice set A**; everything else takes set B. */
export const VOICE_SET_A_TYPES = [0, 2, 5, 6, 9, 0x0e, 0x0f, 0x10, 0x11];

/**
 * `FUN_00407950`, material -> the ricochet sound the impact plays. The names
 * are what makes the material codes readable: SND sand, MET metal, OTH other,
 * WAT water, WOD wood.
 */
export const RICOCHET_BY_MATERIAL: Record<number, number> = {
  0x01: 0x1316a9, 0x33: 0x1316a9,     // COMMON\BULLET_SND1_16.WAV
  0x02: 0x0e16a9, 0x34: 0x0e16a9,     // COMMON\BULLET_MET1_16.WAV
  0x03: 0x1216a9, 0x35: 0x1216a9,     // COMMON\BULLET_OTH1_16.WAV
  0x05: 0x1416a9, 0x37: 0x1416a9,     // COMMON\BULLET_WAT1_16.WAV
  0x06: 0x1516a9, 0x38: 0x1516a9,     // COMMON\BULLET_WOD1_16.WAV
  0x44: 0x0b16a9, 0x53: 0x0b16a9,     // COMMON\BOMB1_11.WAV
  0x45: 0x0b16a9,
  0x61: 0x0c16a9, 0x62: 0x0c16a9,     // COMMON\BOMB2_16.WAV
};

/**
 * `FUN_004073B0`, material -> `[first_texture, last_texture, scale]`. The
 * impact is an **animated sprite**: it runs the texture ids from first to last
 * and dies.
 */
export const IMPACT_SPRITE_BY_MATERIAL: Record<number, [number, number, number]> = {
  0x01: [0x091a, 0x092f, 1.0], 0x33: [0x091a, 0x092f, 1.0],
  0x02: [0x0dc3, 0x0dd1, 1.0], 0x34: [0x0dc3, 0x0dd1, 1.0],
  0x03: [0x0e25, 0x0e33, 1.0], 0x35: [0x0e25, 0x0e33, 1.0],
  0x52: [0x0e25, 0x0e33, 1.0],
  0x05: [0x08f8, 0x0903, 4.0], 0x37: [0x08f8, 0x0903, 4.0],
  0x06: [0x0904, 0x0919, 1.0], 0x38: [0x0904, 0x0919, 1.0],
  0x41: [0x0dd7, 0x0e22, 1.0],
  0x44: [0x0fd4, 0x1031, 1.0],
  0x45: [0x174a, 0x1785, 1.0],
  0x46: [0x0094, 0x00a2, 0.7], 0x4b: [0x0094, 0x00a2, 0.7],
  0x50: [0x023a, 0x0248, 1.0],
  0x51: [0x0054, 0x0062, 1.0],
  0x53: [0x0125, 0x013d, 1.0],
  0x61: [0x1339, 0x1356, 1.0], 0x62: [0x1339, 0x1356, 1.5],
  0x63: [0x091a, 0x092f, 5.0],
};

/** The default arm of that switch. */
export const IMPACT_SPRITE_DEFAULT: [number, number, number] = [0x0904, 0x0904, 0.1];

/** `ActorShotFeedback` -- the blood spray's scale by hit result. */
export const BLOOD_SCALE_BY_RESULT: Record<number, number> =
  { 1: 0.75, 2: 0.5, 3: 1.0, 4: 1.0 };

/** Result 5 -- the shot did nothing. Character type 2 gets its own ricochet. */
export const NO_EFFECT_RICOCHET = 0x1116a9;          // COMMON\BULLET_MET3_22.WAV
export const NO_EFFECT_RICOCHET_TYPE2 = 0x0f16a9;    // COMMON\BULLET_MET2_16.WAV
export const NO_EFFECT_MATERIAL = 3;
export const NO_EFFECT_MATERIAL_TYPE3 = 0x51;

/**
 * How a dying actor picks its animation, from `FUN_004560B0` ->
 * `FUN_00456220`. The general case is **directional**: `camera_yaw -
 * actor_yaw` against four 90-degree arcs.
 *
 * The arcs are named by their **angle**, not "front" and "back", because which
 * is which depends on two conventions at once. What the *data* says is
 * unambiguous: the 0x0000 table's motions carry the root -8.7, -9.5, -9.3 in
 * z and the 0x8000 table's carry it +7.4, +8.2, +2.5. Since the model faces
 * -Z, negative z is forward, so one set falls the way it is facing and the
 * other falls back over. A body falls away from whatever shot it.
 */
export const DEATH_FRONT = 0x0059309c;
export const DEATH_BACK = 0x00593084;
export const DEATH_RIGHT = 992;
export const DEATH_LEFT = 991;

/** One bone's six-step row from a per-character `u16[bone][6]` table. */
function u16Table(tables: ExeTables, base: number, charType: number,
                  bone: number): number[] {
  const b = tables.v2r(base);
  if (b === null) return [];
  const p = tables.v2r(u32(tables.data, b + charType * 4));
  if (p === null) return [];
  const o = p + bone * HIT_STEPS * 2;
  if (o + HIT_STEPS * 2 > tables.data.length) return [];
  return u16s(tables.data, o, HIT_STEPS);
}

/**
 * *count* u16s from the head of a per-character table, as one flat array.
 *
 * The six-step rows are read flat on purpose. `ResolveHit` computes
 * `i = bone*6 + n` and then reads **both** `[i]` and `[i + 1]`, so the last
 * step of every bone takes its control code from the *next* bone's row.
 * Splitting the table into rows first would quietly lose that.
 */
function u16Flat(tables: ExeTables, base: number, charType: number,
                 count: number): number[] {
  const b = tables.v2r(base);
  if (b === null) return [];
  const p = tables.v2r(u32(tables.data, b + charType * 4));
  if (p === null || p + count * 2 > tables.data.length) return [];
  return u16s(tables.data, p, count);
}

/**
 * The six `[slot, code, damage]` steps `ResolveHit` walks for one bone.
 *
 * *slot* is what the bone is redrawn with, *damage* what the hit costs, and
 * *code* is the **next** entry in the effect table -- which `FUN_00409430`
 * branches on rather than treating as a slot:
 *
 *     0   last step. Damage; swap once and latch; no dismemberment.
 *     1   sever. Damage, swap this bone, remove every bone below it.
 *     2   nothing at all -- no damage and no score.
 *     >2  escalate: damage, swap, and advance to the next step.
 */
export function hitSteps(tables: ExeTables, charType: number,
                         bone: number): number[][] {
  const n = tables.characterBoneCount(charType) || 0;
  const span = (n + 2) * HIT_STEPS;
  const eff = u16Flat(tables, HIT_EFFECT, charType, span);
  const dmg = u16Flat(tables, HIT_DAMAGE, charType, span);
  if (!eff.length) return [];
  const out: number[][] = [];
  for (let i = 0; i < HIT_STEPS; i++) {
    const j = bone * HIT_STEPS + i;
    if (j + 1 >= eff.length) break;
    out.push([eff[j], eff[j + 1], j < dmg.length ? dmg[j] : 0]);
  }
  return out;
}

/** `{bodyCondition: [motion, ...]}` from {@link HIT_REACT_ALT_TABLE}. */
export function motionRow(tables: ExeTables,
                          charType: number): Map<number, number[]> {
  const out = new Map<number, number[]>();
  boundedPtrArray(tables, HIT_REACT_ALT_TABLE, charType).forEach((row, cond) => {
    const o = tables.v2r(row);
    if (o === null || o + MOTION_ROW_LEN * 4 > tables.data.length) return;
    out.set(cond, u32s(tables.data, o, MOTION_ROW_LEN));
  });
  return out;
}

/**
 * `ResolveHit`'s inline count of the torso's real gore stages.
 *
 * The default branch walks the effect table forward from bone 1 step 0 while
 * the entries are greater than 2, and **withholds the last torso stage while
 * the actor is still alive**. So a zombie only ever shows its final torso
 * wound once it is dead.
 */
export function torsoStageCount(tables: ExeTables, charType: number): number {
  const n = tables.characterBoneCount(charType) || 0;
  const eff = u16Flat(tables, HIT_EFFECT, charType, (n + 2) * HIT_STEPS);
  let c = 0;
  while (HIT_STEPS + c < eff.length && eff[HIT_STEPS + c] > 2) c += 1;
  return c;
}

/** `s8[16]` added to the table damage, one entry per adaptive rank. */
export function damageRankRow(tables: ExeTables, charType: number,
                              bone: number): number[] {
  const b = tables.v2r(HIT_DAMAGE_RANK);
  if (b === null) return [];
  const v = u32(tables.data, b + charType * 4);
  const p = v ? tables.v2r(v) : null;
  if (p === null) return [];
  const o = p + bone * HIT_RANKS;
  if (o + HIT_RANKS > tables.data.length) return [];
  const out: number[] = [];
  for (let i = 0; i < HIT_RANKS; i++) {
    out.push((tables.data[o + i] << 24) >> 24);
  }
  return out;
}

/** {@link BONE_ZONE} -- bone to destroyed-zone bit, 0xFF for none. */
export function boneZones(tables: ExeTables): number[] {
  const o = tables.v2r(BONE_ZONE);
  if (o === null) return [];
  return [...tables.data.subarray(o, o + 16)];
}

/**
 * The variant array for *charType*, bounded by the next array's start.
 *
 * These arrays sit end to end with no count, so reading a fixed number of
 * entries walks into the neighbour's -- which is exactly how a first pass at
 * this reported a reaction set that belonged to another character.
 *
 * Two things bound it. The arrays are packed **immediately before the pointer
 * table**, so an entry that does not point into that block is not a variant
 * array at all and is rejected; and an array that is a variant array ends
 * where the next one begins, or where the pointer table itself does, because
 * the last one butts straight up against it.
 */
function boundedPtrArray(tables: ExeTables, base: number,
                         charType: number): number[] {
  const b = tables.v2r(base);
  if (b === null) return [];
  const lo = base - ARRAY_BLOCK;
  const tops = new Set<number>();
  for (let ct = 0; ct < 160; ct++) {
    const v = u32(tables.data, b + ct * 4);
    if (lo <= v && v < base && tables.v2r(v) !== null) tops.add(v);
  }
  const p = u32(tables.data, b + charType * 4);
  if (!tops.has(p)) return [];
  const after = [...tops].filter((v) => v > p).sort((x, y) => x - y);
  const end = after.length ? after[0] : base;
  const o = tables.v2r(p)!;
  return u32s(tables.data, o, Math.floor((end - p) / 4));
}

/** {@link REACT_GROUP} -- bone to reaction group. */
export function reactionGroups(tables: ExeTables): number[] {
  const o = tables.v2r(REACT_GROUP);
  return o === null ? [] : u16s(tables.data, o, 16);
}

/**
 * `{bodyCondition: [motion per reaction group]}` for one character.
 *
 * Only two distinct rows exist for the humanoids. The ordinary one is head
 * 977, torso 982, right arm 981, left arm 979, pelvis 974, right leg 961,
 * left leg 960 -- all 29 frames except the legs at 39, short one-shots, and
 * plainly not the deaths, which run 74 to 161.
 */
export function hitReactions(tables: ExeTables,
                             charType: number): Map<number, number[]> {
  const out = new Map<number, number[]>();
  boundedPtrArray(tables, HIT_REACT_TABLE, charType).forEach((row, variant) => {
    const o = tables.v2r(row);
    if (o === null || o + REACT_GROUPS * 4 > tables.data.length) return;
    out.set(variant, u32s(tables.data, o, REACT_GROUPS));
  });
  return out;
}

export interface AttackEntry {
  strike: number;
  lunge: number;
  distance: number;
  hit_frame: number;
  player_motion: number;
  cancel_mask: number;
}

/**
 * `{bodyCondition: {index: attack}}` -- see {@link ATTACK_TABLE}.
 *
 * Only the entries the **pick table names** are exported, because those are
 * the only ones the game ever reads: `ZombieStateStrike` indexes with
 * `obj+0x131A`, which {@link attackPicks} supplies, and never scans. That also
 * sidesteps the row-length problem -- the rows are adjacent with no count, so
 * a fixed scan reads the next row's attacks as this one's, which is what
 * produced entries "hitting on frame 40 of a 20-frame clip".
 *
 * Each entry is checked against its own strike clip before being kept.
 */
export function attackTables(tables: ExeTables,
                             charType: number): Map<number, Map<number, AttackEntry>> {
  const o = tables.v2r(0x004e07d0)!;
  const play = (m: number) => i16(tables.data, o + m * 2);
  const picks = attackPicks(tables, charType);
  const rows = boundedPtrArray(tables, ATTACK_TABLE, charType);
  const out = new Map<number, Map<number, AttackEntry>>();
  rows.forEach((row, cond) => {
    const base = tables.v2r(row);
    const pick = picks.get(cond);
    if (base === null || pick === undefined) return;
    const want = [...new Set(pick.filter((v) => v >= 0 && v < ATTACK_MAX))]
      .sort((a, b) => a - b);
    const got = new Map<number, AttackEntry>();
    for (const i of want) {
      const a = base + i * ATTACK_ENTRY;
      if (a + ATTACK_ENTRY > tables.data.length) continue;
      const strike = i16(tables.data, a);
      const lunge = i16(tables.data, a + 2);
      const dist = f32(tables.data, a + 4);
      const hit = i16(tables.data, a + 8);
      const dmot = i16(tables.data, a + 10);
      const mask = i16(tables.data, a + 12);
      if (strike <= 0 || lunge <= 0) continue;
      if (!(hit >= 0 && hit < play(strike))) continue;
      if (!(play(lunge) > 0 && play(lunge) <= 400)) continue;
      got.set(i, { strike, lunge, distance: dist, hit_frame: hit,
                   player_motion: dmot, cancel_mask: mask & 0xffff });
    }
    if (got.size) out.set(cond, got);
  });
  return out;
}

/**
 * The thrown-weapon attack for one character type, or null.
 *
 * Only the types {@link THROWER_SLOTS} names throw, because only those have a
 * projectile model: `SpawnThrownWeapon` switches on the character type and
 * does nothing for any other.
 */
export function throwTables(tables: ExeTables,
                            charType: number): Record<string, unknown> | null {
  const kit = THROWER_SLOTS[charType];
  if (kit === undefined) return null;
  const o = tables.v2r(0x004e07d0)!;
  const play = (m: number) => i16(tables.data, o + m * 2);
  const b = tables.v2r(THROW_TABLE)!;
  const out = new Map<number, Record<string, unknown>[]>();
  for (let cond = 0; cond < THROW_CONDITIONS; cond++) {
    const ptr = u32(tables.data, b + cond * 4);
    const q = tables.v2r(ptr);
    if (q === null) continue;
    const hands: Record<string, unknown>[] = [];
    [5, 8].forEach((bone, i) => {
      const a = q + i * ATTACK_ENTRY;
      const motion = i16(tables.data, a);
      const rng = f32(tables.data, a + 4);
      const rel = i16(tables.data, a + 8);
      const dmot = i16(tables.data, a + 10);
      const mask = i16(tables.data, a + 12);
      if (motion <= 0 || !(rel >= 0 && rel < play(motion))) return;
      hands.push({ bone, motion, release_frame: rel, range: rng,
                   player_motion: dmot, cancel_mask: mask & 0xffff,
                   ...kit[bone as 5 | 8] });
    });
    if (hands.length) out.set(cond, hands);
  }
  if (!out.size) return null;
  const hands: Record<string, unknown> = {};
  for (const [k, v] of out) hands[String(k)] = v;
  return { hands, spin: kit.spin, speed: THROW_SPEED,
           aim_ahead: THROW_AIM_AHEAD, aim_side: THROW_AIM_SIDE,
           stick_frames: THROW_STICK_FRAMES,
           blink_frames: THROW_BLINK_FRAMES };
}

/**
 * Class 0x30's hand kit, or null for a type that does not throw.
 *
 * Every value here is a literal out of `ZombiePickThrowingHand` and
 * `ZombieThrowHandWeapon` -- there is no table in the exe, only a switch on
 * the character type in each of those two functions, and three types in it.
 */
export function zombieThrowTables(charType: number):
    Record<string, unknown> | null {
  const kit = ZOMBIE_THROW_SLOTS[charType];
  if (kit === undefined) return null;
  const hands = [5, 8].map((bone) => ({ bone, ...kit[bone as 5 | 8] }));
  // The axe flies straight; anything else arcs. `ZombieThrowHandWeapon`
  // decides by the projectile slot, not by the character.
  const straight = hands.every((h) => h.projectile === ZOMBIE_AXE_SLOT);
  return {
    hands,
    straight,
    speed: ZOMBIE_THROW_SPEED,
    speed_standing: ZOMBIE_THROW_SPEED_STANDING,
    aim_ahead: THROW_AIM_AHEAD,
    aim_side: THROW_AIM_SIDE,
    aim_drop: straight ? ZOMBIE_THROW_AIM_DROP : 0.0,
    arc_gravity: ZOMBIE_THROW_ARC_GRAVITY,
    hit_kind: straight ? ZOMBIE_THROW_HIT_KIND : ZOMBIE_THROW_ARC_HIT_KIND,
    stick_frames: THROW_STICK_FRAMES,
    blink_frames: THROW_BLINK_FRAMES,
  };
}

/** `{bodyCondition: [80 indices]}` -- see {@link ATTACK_PICK_TABLE}. */
export function attackPicks(tables: ExeTables,
                            charType: number): Map<number, number[]> {
  const n = ATTACK_PICK_PER_ZONE * ATTACK_ZONE_COMBOS;
  const out = new Map<number, number[]>();
  boundedPtrArray(tables, ATTACK_PICK_TABLE, charType).forEach((row, cond) => {
    const o = tables.v2r(row);
    if (o === null || o + n * 4 > tables.data.length) return;
    out.set(cond, i32s(tables.data, o, n));
  });
  return out;
}

/**
 * What the shell needs before a game starts, which is the life count.
 *
 * The cost of a hit -- one life, -100, 90 frames, -2 rank -- is four
 * immediates in `PlayerTakeDamage` and they live in
 * `web/src/game/combat/player.ts` with this citation.
 */
export function playerDamage(): Record<string, number> {
  return { start_lives: PLAYER_START_LIVES };
}

/**
 * Every sound and sprite a shot can produce, with the names resolved.
 *
 * All of it is proved: `FUN_00407950` is a bare switch of `PlaySoundId` calls,
 * `FUN_004073B0` a bare switch of texture ranges, and {@link HIT_VOICE_TABLE}
 * is read as sound ids and resolved through `g_se_name_list` -- so
 * `COMMON\BULLET_WOD1_16.WAV` sitting under material 6 is what proves material
 * 6 is wood, rather than anyone guessing.
 */
export function combatTables(tables: ExeTables): Record<string, unknown> {
  const o = tables.v2r(HIT_VOICE_TABLE);
  const v = o !== null ? u32s(tables.data, o, 15) : new Array(15).fill(0);
  const se = tables.seNames();
  const name = (i: number) => se.get(i) ?? "";
  const named = (ids: number[]) => ids.map((i) => ({ id: i, file: name(i) }));

  const ricochet: Record<string, unknown> = {};
  for (const k of Object.keys(RICOCHET_BY_MATERIAL).map(Number)
                        .sort((a, b) => a - b)) {
    ricochet[String(k)] = { id: RICOCHET_BY_MATERIAL[k],
                            file: name(RICOCHET_BY_MATERIAL[k]) };
  }
  const sprite: Record<string, unknown> = {};
  for (const k of Object.keys(IMPACT_SPRITE_BY_MATERIAL).map(Number)
                        .sort((a, b) => a - b)) {
    sprite[String(k)] = [...IMPACT_SPRITE_BY_MATERIAL[k]];
  }
  const arcs: Record<string, ArcStage[]> = {};
  for (const [k, a] of Object.entries(CLASS30_ARC_SCRIPTS)) {
    const s = arcScript(tables, a);
    if (s) arcs[k] = s;
  }
  const blood: Record<string, number> = {};
  for (const [k, s] of Object.entries(BLOOD_SCALE_BY_RESULT)) blood[k] = s;

  return {
    // `ActorPlayHitVoice`. `impact` plays on every hurt and every body kill;
    // `head` replaces it on a headshot kill.
    impact: named(v.slice(0, 5)),
    head_impact: named([0x0116a9, 0x0516a9]),
    voice: {
      hurt: named([v[5], v[6]]),
      kill: named([v[7], v[8]]),
      head: named([v[9], v[10]]),
    },
    voice_set_a_types: [...VOICE_SET_A_TYPES],
    // `FUN_00407950` and `FUN_004073B0`, keyed by collision material.
    ricochet,
    impact_sprite: sprite,
    impact_sprite_default: [...IMPACT_SPRITE_DEFAULT],
    // `ZombieStateArcScriptedEntrance` (class 0x30 state 30) names these by
    // character type. The arc machinery is class 0x31's, but these two scripts
    // are class 0x30's own.
    arc_scripts: arcs,
    // `ActorShotFeedback`.
    blood_scale: blood,
    no_effect: {
      sound: { id: NO_EFFECT_RICOCHET, file: name(NO_EFFECT_RICOCHET) },
      sound_type2: { id: NO_EFFECT_RICOCHET_TYPE2,
                     file: name(NO_EFFECT_RICOCHET_TYPE2) },
      material: NO_EFFECT_MATERIAL,
      material_type3: NO_EFFECT_MATERIAL_TYPE3,
    },
  };
}

/** The two difficulty tables `ActorInitHitPoints` and `ResetDamageRank` use. */
export function difficultyTables(tables: ExeTables): Record<string, unknown> {
  const a = tables.v2r(DIFFICULTY_HP_DELTA);
  const b = tables.v2r(INITIAL_DAMAGE_RANK);
  const rank: number[] = [];
  if (b !== null) {
    for (let i = 0; i < 5; i++) rank.push((tables.data[b + i] << 24) >> 24);
  }
  return {
    hp_delta: a !== null ? i32s(tables.data, a, 5) : [],
    initial_rank: rank,
    hp_min: 1, hp_max: 300,
  };
}

/** The directional death set. See {@link DEATH_FRONT}. */
export function deathMotions(tables: ExeTables): Record<string, number[]> {
  const rd = (base: number, n: number): number[] => {
    const o = tables.v2r(base);
    return o === null ? [] : u32s(tables.data, o, n);
  };
  return { front: rd(DEATH_FRONT, 4), back: rd(DEATH_BACK, 6) };
}

/**
 * The damaged-part spheres, keyed by asset slot.
 *
 * `FUN_004099A0` searches the **tail** of the same table the bone spheres come
 * from: past `bone_count - 1` entries, `{slot, centre, radius}` again, and
 * `slot == -1` ends it. So a gore part carries the sphere of the part it
 * replaces, which is how a half-destroyed limb keeps a sensible hit volume.
 *
 * Bounded by the slots the zone table actually names, because a character with
 * no gore -- the cat -- has no terminator either, and reading on walks into
 * whatever follows.
 */
export function goreParts(tables: ExeTables,
                          charType: number): Map<number, Record<string, unknown>> {
  const named = new Set<number>();
  for (let bone = 1; bone < 64; bone++) {
    for (const v of u16Table(tables, HIT_EFFECT, charType, bone)) {
      if (v > 2) named.add(v);
    }
  }
  const out = new Map<number, Record<string, unknown>>();
  if (!named.size) return out;
  const b = tables.v2r(HIT_SPHERES)!;
  const p = tables.v2r(u32(tables.data, b + charType * 4));
  if (p === null) return out;
  const n = tables.characterBoneCount(charType);
  for (let i = n - 1; i < n + 64; i++) {
    const o = p + i * 0x14;
    if (o + 0x14 > tables.data.length) break;
    const slot = i32s(tables.data, o, 1)[0];
    if (slot === -1) break;
    if (!named.has(slot)) continue;
    out.set(slot, {
      centre: [f32(tables.data, o + 4), f32(tables.data, o + 8),
               f32(tables.data, o + 12)],
      radius: f32(tables.data, o + 16),
    });
  }
  return out;
}

/** `[centre, radius]` for one bone, or null when it has no sphere. */
export function hitSphere(tables: ExeTables, charType: number, bone: number):
    [[number, number, number], number] | null {
  const b = tables.v2r(HIT_SPHERES);
  if (b === null || bone < 1) return null;
  const p = tables.v2r(u32(tables.data, b + charType * 4));
  if (p === null) return null;
  const o = p + (bone - 1) * 0x14;
  if (o + 0x14 > tables.data.length) return null;
  const c: [number, number, number] = [f32(tables.data, o + 4),
                                       f32(tables.data, o + 8),
                                       f32(tables.data, o + 12)];
  const r = f32(tables.data, o + 16);
  return r > 0 ? [c, r] : null;
}

/**
 * `g_actor_radius_by_char` -- one float per character type, copied to
 * `obj+0x124` by every Init that has one.
 */
export const ACTOR_RADIUS_TABLE = 0x004c4d28;

/** `obj+0x124` for a character type, or 0 when the table has no row. */
export function actorRadius(tables: ExeTables, charType: number): number {
  const v = tables.ru32(ACTOR_RADIUS_TABLE + charType * 4);
  if (v === null) return 0.0;
  const r = asF32(v);
  return Number.isFinite(r) && r > 0 && r < 1000 ? r : 0.0;
}
