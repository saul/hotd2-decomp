/**
 * Class 0x31's four behaviour sets. The port of `tools/hod2lib/class31.py`.
 *
 * Everything here is indexed by `obj+0x130C`, which `EnemyThrowerInit` takes
 * straight from the descriptor tail's byte +1 -- **not** by the body condition
 * that indexes class 0x30's equivalents in `combat`. That is why the two
 * classes have separate tables at separate addresses and why this is a
 * separate module.
 */

import { f32, i16, i32, i32s, u32 } from "./bytes";
import { CLASS31_ARC_SCRIPTS, CLASS31_ARC_SCRIPT_BYTES, arcScript } from "./arcscript";
import type { ArcStage } from "./arcscript";
import { ATTACK_ENTRY, ATTACK_PICK_PER_ZONE, ATTACK_ZONE_COMBOS,
         REACT_GROUPS, THROW_TABLE } from "./combat";
import type { ExeTables } from "./exetab";

/**
 * Class 0x31's own tables, four **behaviour sets** deep.
 *
 *     set  character   how it fights
 *     0    zstin       leaps at walls and the ceiling, then pounces
 *     1    zsass       throws
 *     2    zskamere    [open]
 *     3    zslman      [open]
 */
export const CLASS31_SETS = 4;

/**
 * `PTR_DAT_005929F0[set]` -> six motion ids:
 *
 *     0, 1  the stand ThrowerStateWaitForPermit picks between at random,
 *           and index 1 is also the pause ThrowerStateStrikeOnTheSpot plays
 *     2, 3  the walk/idle, picked by obj+0x34 bit 27
 *     4     the landing clip ThrowerStateLeapAside plays
 *     5     [open] -- no reader found
 */
export const CLASS31_MOTION_SETS = 0x005929f0;

export const CLASS31_MOTION_SET_LEN = 6;

/**
 * `PTR_PTR_00592A10[set]` -> 0x10-byte attack entries, indexed
 * `obj+0x131A + stance * 4`:
 *
 *     +0x00 u32  pointer to the three-stage arc motion script
 *     +0x04 s32  frame of that clip on which the hit lands, or -1
 *     +0x08 s32  the reaction the *player* plays when hit
 *     +0x0C u32  cancel mask
 */
export const CLASS31_ATTACK_TABLE = 0x00592a10;

/**
 * The stance rows: `bit6 + 2*(bit7 + 2*bit17) + 3*bit8` of `obj+0x136C`. The
 * rows are **not all the same length** and sit end to end with no count, so
 * the reader bounds each row by the start of the next thing in the block.
 */
export const CLASS31_STANCES = 8;

export const CLASS31_ATTACKS_PER_STANCE = 4;

/** `PTR_DAT_00592A20[set][...]` -- which attack index to use, by zones. */
export const CLASS31_ATTACK_PICKS = 0x00592a20;

/**
 * The same address as {@link THROW_TABLE}, under the name the *melee* reader
 * uses. `ThrowerStateCloseAndStrike` indexes it by `obj+0x131A` and reads all
 * four fields; `ThrowerStateThrow` reads entries 0 and 1 as the two hands.
 */
export const CLASS31_THROW_TABLE = THROW_TABLE;

export const CLASS31_THROW_ENTRIES = 8;

/**
 * `PTR_PTR_00592A60[set]` -> three band pointers, each to 80 ints laid out
 * `[destroyed zones 0..7][10]`. Band 0 is never reached.
 */
export const CLASS31_STATE_PICKS = 0x00592a60;

export const CLASS31_BANDS = 3;

export const CLASS31_PICKS = ATTACK_PICK_PER_ZONE * ATTACK_ZONE_COMBOS;

/** `PTR_DAT_00592A70[set][g_react_group[bone]]` -- the stumble, eight groups. */
export const CLASS31_REACTIONS = 0x00592a70;

/**
 * The pose frame a class-0x31 corpse freezes on, keyed by the clip it died in.
 *
 * The general table at `g_class31_corpse_frames` covers motions 0x3D9..0x3E0,
 * and **class 0x31 never plays one of those** -- every use of it reads outside
 * the array. Only these four special cases are real.
 */
export const CLASS31_CORPSE_FRAMES: Record<number, number> = {
  0x11e: 0x00592ad8,      // character 0x16's death clip
  0x11d: 0x00592ad0,      // ...0x18's and 0x19's
  0x1bc: 0x00592ac8,      // ...0x17's
  0x3a6: 0x00592ac0,      // the airborne clip of sets 0 and 3
};

/**
 * The motion ids class 0x31's states name as **literals** rather than through
 * a table, so nothing collects them from the data. Every one is read out of
 * the routine beside it; `bake` refuses a clip that belongs to another
 * skeleton, so the whole list is offered to every class-0x31 character rather
 * than filtered here.
 *
 * Leaving these out is not a subtle failure: a `zstin` that leaps onto a wall
 * has no idle for the stance it arrives in, so `ThrowerSetMotionIfIdle`
 * refuses the clip and it holds whatever it was playing.
 */
export const CLASS31_LITERAL_MOTIONS = new Set([
  // `ThrowerStateStandAndDecide` (state 7): the idle per stance, and
  // character type 0x18's own three.
  0x138, 0x137, 0x131, 0x20f, 0x20c, 0x212,
  // `ThrowerStateWaitForPermit` (state 8), the same shape plus its default.
  0x129, 0x124, 0x134, 0x127, 0x208, 0x1fd, 0x1f3, 0x205,
  // `ThrowerStateLeapAside` (state 10), character 0x18's four.
  0x211, 0x20e, 0x214, 0x20b,
  // `ThrowerStateFallToSurface` (state 11): the fall and the two landings.
  0x1bc, 0x3a5, 0x1ba, 0x3a9,
  // State 3, the death clip, per character type.
  0x11e, 0x11d,
  // `ThrowerStateStrikeOnTheSpot` (state 32).
  0x1b8,
  // `ThrowerStateGrabPlayer` (state 27): the ride, the two grabs, the finish.
  0x1e9, 0x1e5, 0x1e7, 0x1e8,
  // `ThrowerStateKnockedTumbling` (state 33): the tumble and the get-up.
  0x215, 0x1fe, 0x1f4, 0x206, 0x216, 0x1ff, 0x1f5, 0x207,
  // `ThrowerStateThrow`'s character-0x18 branch.
  0x1f7, 0x1f6, 0x1fc, 0x1fb, 0x1f2, 0x1f1, 0x204, 0x203,
  // `ThrowerStateRearm` (state 29), and it is not a typo: character 0x16's
  // re-arm clip really is id **5**. Leaving it out is what let a `zsass` that
  // had thrown once flip-flop between state 7 and state 29 for ever.
  0x005,
  // `ThrowerStateFallAndLand` (state 2)'s get-up, for every type but 0x17.
  0x11b,
]);

/**
 * Where the row at *thisPtr* ends: the next row's start, or *after*'s first.
 *
 * The rows of these tables are packed end to end with no count, so a fixed
 * length reads the neighbour's entries as if they were this row's -- which is
 * exactly the adjacent-array trap. Bounding by the next start recovers set 0's
 * five stances and sets 1 and 2's single one.
 */
function nextBlock(tables: ExeTables, base: number, count: number,
                   after: number, thisPtr: number): number {
  const ends = new Set<number>();
  for (let k = 0; k < count; k++) {
    let v = ptrRow(tables, base, k);
    if (v && v > thisPtr) ends.add(v);
    v = ptrRow(tables, after, k);
    if (v && v > thisPtr) ends.add(v);
  }
  return ends.size ? Math.min(...ends) : thisPtr;
}

function ptrRow(tables: ExeTables, base: number, i: number): number | null {
  const o = tables.v2r(base);
  if (o === null || o + (i + 1) * 4 > tables.data.length) return null;
  return u32(tables.data, o + i * 4);
}

/**
 * Class 0x31's four behaviour sets -- see {@link CLASS31_SETS}.
 *
 * Everything here is read from the routine that consumes it, and the routine
 * is named in each constant's own comment. The arc scripts are resolved and
 * inlined rather than left as addresses, because the client has no way to
 * dereference one.
 */
export function class31Tables(tables: ExeTables | null): Record<string, unknown> {
  if (tables === null) return {};
  const sets: Record<string, unknown>[] = [];
  for (let i = 0; i < CLASS31_SETS; i++) {
    const row: Record<string, unknown> = { set: i };
    let o = tables.v2r(ptrRow(tables, CLASS31_MOTION_SETS, i) ?? 0);
    row.motions = o !== null
      ? i32s(tables.data, o, CLASS31_MOTION_SET_LEN) : [];

    // The attack entries, flattened to [stance][index] with the arc script
    // resolved in place. An entry whose script pointer is null is a hole --
    // the pick table never names it.
    const ptrRowA = ptrRow(tables, CLASS31_ATTACK_TABLE, i) ?? 0;
    o = tables.v2r(ptrRowA);
    const attacks: Record<string, Record<string, unknown>> = {};
    if (o !== null) {
      const n = Math.min(
        CLASS31_STANCES * CLASS31_ATTACKS_PER_STANCE,
        Math.floor((nextBlock(tables, CLASS31_ATTACK_TABLE, CLASS31_SETS,
                              CLASS31_ATTACK_PICKS, ptrRowA) - ptrRowA)
                   / ATTACK_ENTRY));
      if (n > 0 && o + n * ATTACK_ENTRY <= tables.data.length) {
        for (let k = 0; k < n; k++) {
          const a = o + k * ATTACK_ENTRY;
          const ptr = u32(tables.data, a);
          const hit = i32(tables.data, a + 4);
          const hurt = i32(tables.data, a + 8);
          const mask = u32(tables.data, a + 12);
          const script = arcScript(tables, ptr);
          if (script === null) continue;
          const stance = Math.floor(k / CLASS31_ATTACKS_PER_STANCE);
          const idx = k % CLASS31_ATTACKS_PER_STANCE;
          (attacks[String(stance)] ??= {})[String(idx)] = {
            script, hit_frame: hit, player_motion: hurt,
            cancel_mask: mask & 0xffff,
          };
        }
      }
    }
    row.attacks = attacks;

    // `g_class31_throws` in the raw, per set. `throwTables` reads the same two
    // rows for the projectile, keyed by the hand; `ThrowerStateCloseAndStrike`
    // reads them as a **melee** attack.
    const ptrThrow = ptrRow(tables, CLASS31_THROW_TABLE, i) ?? 0;
    o = tables.v2r(ptrThrow);
    const strikes: Record<string, unknown> = {};
    if (o !== null) {
      const n = Math.min(
        CLASS31_THROW_ENTRIES,
        Math.floor((nextBlock(tables, CLASS31_THROW_TABLE, CLASS31_SETS,
                              CLASS31_ATTACK_TABLE, ptrThrow) - ptrThrow)
                   / ATTACK_ENTRY));
      for (let k = 0; k < Math.max(0, n); k++) {
        const a = o + k * ATTACK_ENTRY;
        if (a + ATTACK_ENTRY > tables.data.length) break;
        const strike = i16(tables.data, a);
        const lunge = i16(tables.data, a + 2);
        const dist = f32(tables.data, a + 4);
        const hit = i16(tables.data, a + 8);
        const hurt = i16(tables.data, a + 10);
        const mask = i16(tables.data, a + 12);
        if (strike <= 0) continue;
        strikes[String(k)] = { strike, lunge, distance: dist, hit_frame: hit,
                               player_motion: hurt, cancel_mask: mask & 0xffff };
      }
    }
    row.strikes = strikes;

    o = tables.v2r(ptrRow(tables, CLASS31_ATTACK_PICKS, i) ?? 0);
    row.attack_picks = o !== null && o + CLASS31_PICKS * 4 <= tables.data.length
      ? i32s(tables.data, o, CLASS31_PICKS) : [];

    // The state picks are a pointer to a pointer: one band pointer each.
    const bands: Record<string, number[]> = {};
    const b = tables.v2r(ptrRow(tables, CLASS31_STATE_PICKS, i) ?? 0);
    if (b !== null) {
      for (let band = 0; band < CLASS31_BANDS; band++) {
        const ptr = u32(tables.data, b + band * 4);
        const q = tables.v2r(ptr);
        if (q === null || q + CLASS31_PICKS * 4 > tables.data.length) continue;
        bands[String(band)] = i32s(tables.data, q, CLASS31_PICKS);
      }
    }
    row.state_picks = bands;

    o = tables.v2r(ptrRow(tables, CLASS31_REACTIONS, i) ?? 0);
    row.reactions = o !== null && o + REACT_GROUPS * 4 <= tables.data.length
      ? i32s(tables.data, o, REACT_GROUPS) : [];
    sets.push(row);
  }

  const corpse: Record<string, number[]> = {};
  for (const [motion, addr] of Object.entries(CLASS31_CORPSE_FRAMES)) {
    const o = tables.v2r(addr);
    if (o !== null && o + 8 <= tables.data.length) {
      corpse[motion] = i32s(tables.data, o, 2);
    }
  }

  const scripts: Record<string, ArcStage[] | null> = {};
  for (const [k, a] of Object.entries(CLASS31_ARC_SCRIPTS)) {
    if (k === "aside_zslman") continue;
    scripts[k] = arcScript(tables, a);
  }
  // Character 0x18's is four scripts, one per surface stance, so it goes in
  // flat rather than nested -- the client indexes it by name.
  for (let st = 0; st < 4; st++) {
    scripts[`aside_zslman_${st}`] = arcScript(
      tables, CLASS31_ARC_SCRIPTS.aside_zslman + st * CLASS31_ARC_SCRIPT_BYTES);
  }
  const kept: Record<string, ArcStage[]> = {};
  for (const [k, v] of Object.entries(scripts)) if (v) kept[k] = v;

  return {
    sets, corpse_frames: corpse, scripts: kept,
    note: "Class 0x31's behaviour, four sets deep, indexed by the descriptor "
      + "tail's byte +1 (obj+0x130C). Set 0 is zstin, which is the "
      + "wall-crawler.",
  };
}

/** Every clip the class-0x31 tables can reach, for the bake list. */
export function class31MotionIds(block: Record<string, unknown>): number[] {
  const out: number[] = [];
  const inRange = (m: number) => m > 0 && m < 4096;
  for (const row of (block.sets as Record<string, unknown>[]) ?? []) {
    out.push(...((row.motions as number[]) ?? []).filter(inRange));
    out.push(...((row.reactions as number[]) ?? []).filter(inRange));
    for (const e of Object.values((row.strikes as Record<string, {
      strike: number; lunge: number }>) ?? {})) {
      out.push(e.strike, e.lunge);
    }
    for (const stance of Object.values((row.attacks as Record<string,
      Record<string, { script: ArcStage[] }>>) ?? {})) {
      for (const e of Object.values(stance)) {
        out.push(...e.script.map((st) => st.motion));
      }
    }
  }
  for (const script of Object.values(
      (block.scripts as Record<string, ArcStage[]>) ?? {})) {
    if (script) out.push(...script.map((st) => st.motion));
  }
  out.push(...[...CLASS31_LITERAL_MOTIONS].sort((a, b) => a - b));
  return [...new Set(out.filter(inRange))].sort((a, b) => a - b);
}
