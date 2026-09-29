/**
 * The shot and damage tables, and the exporter's readings of them, against
 * the EXE.
 *
 *     node tools/run_ts.mjs tools/checks/combat.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * Each assertion is chosen so that a wrong *reading* fails it, not only a
 * wrong byte. The readings are the ones `docs/formats/combat.md` states, as
 * `src/hod2lib/` makes them for the bundle -- `combat.ts`, `arcscript.ts`,
 * `class31.ts`, `approach.ts`, `charmotion.ts` and `characters.ts`:
 *
 *  1. **The effect table's small values are control codes, not asset slots.**
 *     `ResolveHit` branches on `effect[i + 1]` being 0, 1 or 2. Across every
 *     character type the values are 0, 1, 2 or at least `0xB91` -- a gap of
 *     nearly three thousand with nothing in it.
 *  2. **Slots resolve.** Every value above the gap resolves through the asset
 *     slot table to a `(file, part)` -- `0xB91` is `frog.bin` part 3, `0x1B70`
 *     `harold.bin` part 97 -- which is what a wrong stride or a wrong base
 *     fails. The damaged-part **sphere** table is a separate lookup that may
 *     miss: `ActorSwapDamagedPart` writes the slot unconditionally and
 *     `ResolveDamagedPartSphere` supplies a hit volume only if it finds one.
 *  3. **A sever has something to sever.** Every `code == 1` step sits on a
 *     bone with children, so `SeverBoneChildren` has a subtree to remove --
 *     all but two hands, which sever to a stump.
 *  4. **The export matches the EXE.** `hitSteps` is re-derived from raw bytes
 *     at `ResolveHit`'s `bone * 6 + n`, independently of the library.
 *  5. **Hit points stay in range.** `ActorInitHitPoints` clamps to `[1, 300]`
 *     on every difficulty, for every spawn `resolveForStage` places in the six
 *     arcade stages -- each of which must resolve.
 *  6. **The stumble set is a stumble set.** Every reaction motion has a
 *     `g_motion_play_length` of 1 to 120, every reaction row fills all eight
 *     groups, and **every reaction is shorter than every death** -- 29 to 43
 *     frames against 74 to 161. A misread table does not land on that side of
 *     the line by accident. The bone-to-group map partitions bones 1..15 into
 *     the seven named regions and nothing else.
 *  7. **The approach and tracking tables have the shape they claim.** Every
 *     ring set is ordered `inner < mid <= outer`, and every turn-rate curve has
 *     64 positive entries and is **non-increasing** -- the camera only turns
 *     faster as the target gets further off-axis. A misread stride or base
 *     breaks the ordering. Curve 0 is skipped: it lives in `.data` at
 *     `0x0059C9A8`, a runtime working copy that is zero on disk.
 *  8. **Every attack resolves.** `attackTables` keeps the entries the pick
 *     table names, every character with a pick table yields at least one,
 *     and the entries whose **hit frame their own strike clip never reaches**
 *     are exactly the crawlers' condition-4 swing ({@link ATTACK_MISS}). The
 *     frame and the clip length come from different tables, so a wrong stride
 *     cannot satisfy both, and naming the set rather than bounding it keeps
 *     the swing the engine is meant to whiff while a misread row still fails.
 *  9. **Every thrown attack resolves.** For each type that throws, the release
 *     frame lands inside its own throw clip, the cancel mask is one of the
 *     three the melee table also uses -- 2 right arm, 4 left arm, 8
 *     uncancellable -- and every held, bare and projectile slot resolves.
 *     Body conditions 0, 1 and 3 name the throwing arm; condition 2 uses a
 *     different clip and the uncancellable mask, so the arm-matching rule is
 *     reported rather than asserted.
 * 10. **Every class with a motion rule produces posed actors.**
 *     `resolveForStage` skips any spawn whose class has no `MOTION_RULES`
 *     entry, so a class can be fully decoded -- attack tables, throw tables,
 *     everything -- and still export nothing. A class with spawns and a rule
 *     and no posed spawn fails.
 * 11. **A motion belongs to one skeleton, and the tables respect that.** A
 *     motion block's span over its declared frame count is its stride, hence
 *     the bone count it was authored for. Each character's back-away clip
 *     (`motionRow[condition][4]`) implies **that character's own** bone count
 *     or is refused -- the shared, condition-indexed throw table has rows
 *     naming `kame.bin` clips, which imply 24 bones.
 * 12. **Every sound id names a file.** The voice, impact and ricochet ids
 *     `combatTables` exports are `g_se_name_list` ids; read at the wrong
 *     address they resolve to nothing.
 * 13. **Every motion-row entry the ported states read is baked**, when it
 *     belongs to the character's skeleton: the walks, the runs and the
 *     back-away of every posed class-0x30 type in every stage. The closing is
 *     the clip's own root motion, so an unbaked entry is a zombie standing
 *     still. An entry authored for another skeleton -- `znchain`'s run is
 *     `zom.bin` 968 -- is data, reported with what it costs, not failed.
 * 14. **Class 0x31's picks name states `ThrowerTryEnterState` accepts, and
 *     every clip its attack scripts reach is a motion id.** A pick naming a
 *     state the gate refuses is an actor that can only stand still. Band 0 is
 *     unreachable -- `ThrowerPickNextState` starts the band at 2 and only ever
 *     lowers it to 1 -- and is not read; attack indices with no entry in any
 *     stance are reported.
 * 15. **`ActorPlayHitVoice` kinds 1 and 2 share one voice pair**, their impact
 *     tables are five body ids and two head ids with nothing in common, and
 *     kind 3's entry is a *pair per set* where the others are one id per set.
 *     `ZombieOnShot` (`FUN_00453EB0`) and `ThrowerOnShot` (`FUN_004499A0`)
 *     choose between kinds 1 and 2 on `g_shot_bone == 2`; the `LEA EBP,
 *     [EDI*4 + 0x9A2D88]` that loads the register, and the `MOV EAX, [EBP]` /
 *     `CMP EAX, 2` that test it, are read out of the image in both (L71). The
 *     shared pair is why the choice is nearly inaudible, which is why it is
 *     asserted rather than described (L26).
 * 16. **Every arc script fits its own clips.** `ActorArcStep` (`FUN_0044D860`)
 *     waits on `obj+0x19C` reaching each stage's threshold, and that cursor
 *     wraps at `g_motion_play_length + 1`: a start or threshold past the play
 *     length of the clip its stage plays is an actor parked in its leap for
 *     ever. All 42 scripts classes 0x30 and 0x31 can install -- the named
 *     ones, every attack entry's, the two entrance scripts and
 *     `ZombieStateLeapStrike`'s (`FUN_0045E330`) -- keep every stage inside
 *     it. Eight stage changes switch clips: six scripts end on a different
 *     clip from the two stages before -- set 3's attack 3 in all five stances,
 *     and the crawler's leap, which lands on 0x41D after two stages of 0x41C
 *     -- and `ThrowerStatePathFollow`'s style-2 script (`0x00565E88`) flies on
 *     300 between two stages of 301, so the bound is taken per stage, not per
 *     script. `zslman`'s four leap-aside scripts are
 *     held to the four `MOV ESI, imm32` `ThrowerStateLeapAside` picks them
 *     with ({@link LEAP_ASIDE_ZSLMAN_MOV}), `0x60` apart, and the exported
 *     four to the twelve dwords at each (L65).
 * 17. **A bone record's hit sphere comes from the row whose slot is the
 *     node's, and the rows the later writers read are the rows they say.**
 *     `SkeletonWalkNode`'s gate (`CMP EDX,[EDI]; JNZ` at `0x00410830`) is read
 *     out of `.text`, the bones it refuses are held to {@link GATED}, and
 *     `hitSphere` -- what `charbuild` reads per bone -- is the raw row
 *     `bone - 1` with its own slot. `ThrowerStateRearm` and
 *     `ThrowerStateRestoreBothHands` load rows 4 and 7 -- type 0x16's by name,
 *     the actor's own by index -- and those rows' **slots are the armed hands
 *     `EnemyThrowerInit` writes as immediates** at `0x00449877` and
 *     `0x00449881`, which are also `THROWER_SLOTS[0x16]`'s held slots: a table
 *     and an instruction stream agreeing, which only a right row stride and a
 *     right `bone - 1` produce (L73). Every type whose effect table names a
 *     slot has a damaged-part tail that ends in `-1` inside the image; where
 *     a type's own tail and type 7's (or 0xB's) both hold a slot, the two
 *     rows are the same row, so running both searches cannot be told from a
 *     fallback; `partSphereRows` is a raw first-match read; and every
 *     class-0x30/0x18 spawn of types 2, 3 and 0xE names a collision blob at
 *     its tail's `+0x10`.
 *
 * Reported rather than hidden: character type 21 (`samson`, a boss) has a
 * `g_character_part_tables` entry that is not the `{slot, centre, radius}`
 * layout the others use -- its first word is a float -- so its damaged-part
 * spheres are `[open]`. Its effect slots still resolve; only check 2's sphere
 * count is affected.
 *
 * What only this check sees is the exporter's combat readings held to the
 * code that consumes the tables -- a `.text` operand, a gate, an immediate --
 * rather than to a count taken from the exporter's own output.
 */
import { gameDirOrSkip, openGame, Checker, hex } from "../lib/exe_check";
import type { ExeTables } from "../../src/hod2lib/exetab";
import type { NodeAssetSource } from "../lib/node_io";
import {
  attackHitLands, attackPicks, attackTables, combatTables, DEATH_LEFT,
  DEATH_RIGHT, deathMotions, difficultyTables, goreParts, HIT_DAMAGE,
  HIT_EFFECT, HIT_SPHERES, hitReactions, hitSphere, hitSteps,
  MOTION_ROW_BACKOFF, motionRow, partSphereRows, reactionGroups, THROWER_SLOTS,
  throwTables,
} from "../../src/hod2lib/combat";
import { approachTables, cameraTracking } from "../../src/hod2lib/approach";
import {
  arcScript, CLASS30_ARC_SCRIPTS, CLASS31_ARC_SCRIPTS,
  CLASS31_ASIDE_ZSLMAN_STRIDE,
} from "../../src/hod2lib/arcscript";
import type { ArcStage } from "../../src/hod2lib/arcscript";
import { class31MotionIds, class31Tables } from "../../src/hod2lib/class31";
import { MOTION_RULES } from "../../src/hod2lib/charmotion";
import type { BakedMotion } from "../../src/hod2lib/charmotion";
import { resolveForStage, ZOMBIE_BONE_MESH_TYPES }
  from "../../src/hod2lib/characters";
import type { Character } from "../../src/hod2lib/charbuild";
import type { Placement } from "../../src/hod2lib/placement";
import { Stage, STAGE_TO_SCENE } from "../../src/hod2lib/stage";
import { Program } from "../../src/hod2lib/script";
import { spawns } from "../../src/hod2lib/evt";
import { loadBank } from "../../src/hod2lib/mot";
import type { MotionBank } from "../../src/hod2lib/mot";

/** Below this every effect-table value is a control code; above it, a slot. */
const CONTROL_MAX = 2;

/** `ResolveHit` indexes both per-character u16 tables `bone * 6 + n`. */
const RESOLVE_HIT_STEPS = 6;

/** `g_motion_play_length`: `s16[motion]`, the clock the states compare to. */
const MOTION_PLAY_LENGTH = 0x004e07d0;

/** A boss whose part table is not `{slot, centre, radius}`; see the head. */
const NONSTANDARD_PART_TABLE = 21;

/** Each turn-rate curve is 64 bytes, one rate per angle bucket. */
const TURN_RATE_CURVE_BYTES = 64;

/**
 * The one attack entry in the whole table whose hit frame its own strike
 * clip never reaches, shared by three character types: the row at
 * `0x00566E70`, `{997, 1051, 26.0f, 40, 9, 1}` against
 * `g_motion_play_length[997] == 20`. `attackHitLands` says why that is the
 * engine's own miss rather than a misread row.
 */
const ATTACK_MISS = {
  types: [0x07, 0x0b, 0x0c], cond: 4, index: 2, clip: 997, hitFrame: 40,
  play: 20,
} as const;

/** The states `ThrowerTryEnterState` accepts. */
const THROWER_ACCEPTED_STATES = new Set(
  [7, 8, 9, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x1d, 0x1e, 0x1f, 0x20]);

/**
 * `ThrowerStateLeapAside`'s four `MOV ESI, imm32` (opcode `0xBE`) for
 * character type 0x18, by surface row: row 0 and the default at `0x0044BAB1`,
 * row 1 at `0x0044BAD0`, row 2 at `0x0044BAC4`, row 3 at `0x0044BAB8`.
 */
const LEAP_ASIDE_ZSLMAN_MOV = [0x0044bab1, 0x0044bad0, 0x0044bac4, 0x0044bab8];

/**
 * `ZombieOnShot` and `ThrowerOnShot`'s voice-kind test: `LEA EBP, [EDI*4 +
 * 0x9A2D88]` (`g_shot_bone`), then `MOV EAX, [EBP]` and `CMP EAX, 2` on the
 * dead arm. `EBP` is callee-saved across the calls between them.
 */
const VOICE_KIND_SITES: [string, [number, string][]][] = [
  ["ZombieOnShot", [[0x00453eee, "8d2cbd882d9a00"], [0x00453f68, "8b4500"],
                    [0x00453f6e, "83f802"]]],
  ["ThrowerOnShot", [[0x004499d4, "8d2cbd882d9a00"], [0x00449a70, "8b4500"],
                     [0x00449a76, "83f802"]]],
];

/**
 * Every (type, bone) row `SkeletonWalkNode` refuses although it carries a
 * radius, over every character type with a skeleton -- by type, the bones.
 * Held here, whole, so that `ActorBuildSkinnedModel`'s note in
 * `src/game/spawn.ts` can point at a list a check derives from the exe rather
 * than quote one. Most are types whose table pointer is a stub that ends in
 * -1 after a row or two, read on past it; `zsass`'s two hands (0x16) are the
 * real rows that name the armed model where the node names the bare.
 */
const GATED: Record<number, number[]> = {
  0x03: [5, 8], 0x15: [6, 9, 13, 16], 0x16: [5, 8], 0x1a: [3, 11],
  0x1b: [9, 10, 11, 12, 13, 14], 0x1c: range(5, 15), 0x1f: [3],
  0x21: [2], 0x39: [2, 5], 0x3a: [2, 5], 0x3b: [5], 0x3c: [5], 0x3e: [9],
  0x3f: range(7, 16), 0x40: range(5, 16), 0x41: [6, 9],
  0x42: [3, 4], 0x43: [3, 13], 0x46: [3], 0x4e: [3],
  0x53: range(4, 19), 0x54: range(3, 20),
  0x55: range(2, 16),
};

/**
 * `SkeletonWalkNode`'s gate and the build's multiply, as the instruction
 * stream has them at `0x00410830`: `MOV EDX,[EAX-0x14]; CMP EDX,[EDI];
 * JNZ +0x3F; FLD [ECX+0x1300]; FMUL [EAX-4]; FSTP [ESI+0x78]`.
 */
const WALK_NODE_GATE = 0x00410830;
const WALK_NODE_GATE_BYTES = "8b50ec3b17753f" + "d98100130000" + "d848fc" + "d95e78";

/** `EnemyThrowerInit`: `MOV [ESI+0x4DC], imm32` and `MOV [ESI+0x68C], imm32`. */
const THROWER_ARM_RIGHT = 0x00449877;
const THROWER_ARM_LEFT = 0x00449881;

/** A `g_character_part_tables` row. */
const PART_ROW = 0x14;

function range(lo: number, hi: number): number[] {
  return Array.from({ length: hi - lo }, (_, i) => lo + i);
}

const key = (ct: number, b: number) => `${ct}:${b}`;

/** Raw little-endian reads over the image, independent of `src/hod2lib/bytes`. */
class Raw {
  private readonly dv: DataView;

  constructor(readonly exe: ExeTables) {
    const d = exe.data;
    this.dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  }

  get length(): number { return this.dv.byteLength; }
  u8(o: number): number { return this.dv.getUint8(o); }
  i16(o: number): number { return this.dv.getInt16(o, true); }
  u16(o: number): number { return this.dv.getUint16(o, true); }
  u32(o: number): number { return this.dv.getUint32(o, true); }
  i32(o: number): number { return this.dv.getInt32(o, true); }
  f32(o: number): number { return this.dv.getFloat32(o, true); }

  /** *n* bytes at *va* as lower-case hex, or "" when *va* is unmapped. */
  hexAt(va: number, n: number): string {
    const o = this.exe.v2r(va);
    if (o === null || o + n > this.length) return "";
    let s = "";
    for (let i = 0; i < n; i++) s += this.u8(o + i).toString(16).padStart(2, "0");
    return s;
  }

  /** `g_motion_play_length[m]`. */
  play(m: number): number {
    return this.i16(this.exe.v2r(MOTION_PLAY_LENGTH)! + m * 2);
  }

  /** *count* u16s from the head of a per-character table, or null. */
  flatU16(base: number, ct: number, count: number): number[] | null {
    const b = this.exe.v2r(base);
    if (b === null) return null;
    const p = this.exe.v2r(this.u32(b + ct * 4));
    if (p === null || p + count * 2 > this.length) return null;
    return range(0, count).map((i) => this.u16(p + i * 2));
  }

  /**
   * `g_character_part_tables[ct]` read raw from row 0 as `[slot, r, cx, cy,
   * cz]` per row, and the index of the first `-1` past the bones, or null
   * when the image ends first.
   */
  partRows(ct: number): { rows: number[][]; end: number | null } {
    const b = this.exe.v2r(HIT_SPHERES)!;
    const p = this.exe.v2r(this.u32(b + ct * 4));
    const n = this.exe.characterBoneCount(ct);
    const rows: number[][] = [];
    if (p === null) return { rows, end: null };
    for (let i = 0; p + (i + 1) * PART_ROW <= this.length; i++) {
      const o = p + i * PART_ROW;
      const slot = this.i32(o);
      rows.push([slot, this.f32(o + 16), this.f32(o + 4), this.f32(o + 8),
                 this.f32(o + 12)]);
      if (i >= n - 1 && slot === -1) return { rows, end: i };
    }
    return { rows, end: null };
  }
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}

function netZ(m: BakedMotion): number {
  const r = m.root;
  const n = m.frames;
  return n < 2 ? 0.0 : r[(n - 1) * 3 + 2] - r[2];
}

function firstBySlot<T>(rows: T[], slotOf: (r: T) => number): Map<number, T> {
  const out = new Map<number, T>();
  for (const r of rows) if (!out.has(slotOf(r))) out.set(slotOf(r), r);
  return out;
}

interface Named { id: number; file: string }
interface ThrowHand {
  bone: number; motion: number; release_frame: number; cancel_mask: number;
  held: number | null; bare: number; projectile: number;
}
interface Class31Attack { script: ArcStage[]; hit_frame: number }
interface Class31Set {
  set: number;
  state_picks: Record<string, number[]>;
  attacks: Record<string, Record<string, Class31Attack>>;
  attack_picks: number[];
}
interface Class31Block { sets: Class31Set[]; scripts: Record<string, ArcStage[]> }

interface Resolved {
  stage: number;
  chars: Map<number, Character>;
  placements: Placement[];
}

async function resolveStages(source: NodeAssetSource, c: Checker):
    Promise<Resolved[]> {
  const out: Resolved[] = [];
  const failed: string[] = [];
  const numbers = Object.keys(STAGE_TO_SCENE).map(Number).sort((a, b) => a - b);
  for (const n of numbers) {
    try {
      const st = await Stage.create(source, { stage: n });
      const prog = await Program.create(st);
      const recs = prog.evt ? spawns(prog.evt) : [];
      const r = await resolveForStage(st, prog, recs);
      out.push({ stage: n, chars: r.chars, placements: r.placements });
    } catch (e) {
      failed.push(`stage ${n}: ${(e as Error).message}`);
    }
  }
  c.ok(!failed.length && out.length === numbers.length,
       `check 5: all ${numbers.length} stages resolve through resolveForStage`
       + (failed.length ? ` -- ${failed.join("; ")}` : ""));
  return out;
}

async function main(): Promise<void> {
  const dir = gameDirOrSkip("combat");
  const { source, exe } = await openGame(dir);
  const raw = new Raw(exe);
  const c = new Checker("combat");

  const types = range(0, 160).filter((ct) => exe.characterSkeleton(ct).length);
  c.ok(types.length > 0, `${types.length} character types with a skeleton`);

  // 1 + 2 + 3 + 4 ---------------------------------------------------------
  const slots = exe.assetSlots();
  const codes = new Set<number>();
  let minSlot = 2 ** 30;
  let nSlots = 0, nSever = 0, nSeverLeaf = 0, nSphered = 0, nSteps = 0;
  const unresolved: string[] = [];
  const mismatch: string[] = [];
  let ct21Slots = 0, ct21Sphered = 0;
  for (const ct of types) {
    const skel = exe.characterSkeleton(ct);
    const kids = new Map<number, number[]>();
    for (const n of skel) {
      if (n.parent === null) continue;
      const pb = skel[n.parent]!.bone;
      kids.set(pb, [...(kids.get(pb) ?? []), n.bone]);
    }
    const gore = goreParts(exe, ct);
    const nb = exe.characterBoneCount(ct) || 0;
    const span = (nb + 2) * RESOLVE_HIT_STEPS;
    const eff = raw.flatU16(HIT_EFFECT, ct, span);
    const dmg = raw.flatU16(HIT_DAMAGE, ct, span);
    for (const n of skel) {
      const bone = n.bone;
      const steps = hitSteps(exe, ct, bone);
      steps.forEach(([slot, code, damage], i) => {
        nSteps++;
        const j = bone * RESOLVE_HIT_STEPS + i;
        if (!eff || !dmg || slot !== eff[j] || code !== eff[j + 1]
            || damage !== dmg[j]) {
          mismatch.push(`type ${hex(ct)} bone ${bone} step ${i}`);
        }
        if (code <= CONTROL_MAX) codes.add(code);
        if (code === 1) {
          nSever++;
          if (!kids.get(bone)?.length) nSeverLeaf++;
        }
        if (slot > CONTROL_MAX) {
          nSlots++;
          minSlot = Math.min(minSlot, slot);
          if (!slots.has(slot)) {
            unresolved.push(`type ${ct} bone ${bone} slot ${hex(slot)}`);
          }
          if (gore.has(slot)) nSphered++;
          if (ct === NONSTANDARD_PART_TABLE) {
            ct21Slots++;
            if (gore.has(slot)) ct21Sphered++;
          }
        }
      });
    }
  }
  c.note(`${nSlots} slot references, ${nSever} sever steps`);
  const odd = [...codes].filter((v) => v !== 0 && v !== 1 && v !== 2);
  c.ok(!odd.length,
       `check 1: the effect table's small values are control codes 0/1/2 only `
       + `(seen [${[...codes].sort((a, b) => a - b).join(", ")}])`
       + (odd.length ? `; also ${odd.join(", ")}` : ""));
  c.ok(nSlots > 0 && minSlot > 0x100,
       `check 1: a gap between control codes and slots (lowest slot `
       + `${hex(minSlot)})`);
  c.ok(!unresolved.length,
       `check 2: every one of ${nSlots} effect slots is an asset slot`
       + (unresolved.length
         ? ` -- ${unresolved.length} are not: ${unresolved.slice(0, 4).join("; ")}`
         : ""));
  c.note(`${nSphered} of them also carry a damaged-part hit sphere`);
  {
    const { rows } = raw.partRows(NONSTANDARD_PART_TABLE);
    const n = exe.characterBoneCount(NONSTANDARD_PART_TABLE);
    const bone = rows.slice(0, n);
    const slotted = bone.filter((r) => slots.has(r[0]! >>> 0)).length;
    const asFloat = bone.slice(1, 4).map((r) => {
      const w = new DataView(new ArrayBuffer(4));
      w.setInt32(0, r[0]!, true);
      return +w.getFloat32(0, true).toFixed(4);
    });
    c.note(`type ${NONSTANDARD_PART_TABLE} (samson), reported not failed: `
           + `${slotted} of its ${n} bone rows begin with an asset slot -- the `
           + `first words read as floats (${asFloat.join(", ")}, ...) -- so its `
           + `damaged-part spheres are [open]; ${ct21Sphered} of its `
           + `${ct21Slots} effect slots find one`);
  }
  c.ok(nSeverLeaf <= 2,
       `check 3: sever steps on a childless bone: ${nSeverLeaf} (the two `
       + `hands that sever to a stump)`);
  c.ok(nSteps > 0 && !mismatch.length,
       `check 4: all ${nSteps} exported hitSteps match a raw read at `
       + `bone * ${RESOLVE_HIT_STEPS} + n`
       + (mismatch.length
         ? ` -- ${mismatch.length} differ: ${mismatch.slice(0, 4).join("; ")}`
         : ""));

  // 5 ---------------------------------------------------------------------
  const stages = await resolveStages(source, c);
  const diff = difficultyTables(exe) as {
    hp_delta: number[]; hp_min: number; hp_max: number };
  let checked = 0;
  const outOfRange: string[] = [];
  for (const s of stages) {
    for (const p of s.placements) {
      for (let rank = 0; rank < 5; rank++) {
        const hp = Math.min(diff.hp_max,
                            Math.max(diff.hp_min, p.hp + diff.hp_delta[rank]!));
        checked++;
        if (!(diff.hp_min <= hp && hp <= diff.hp_max)) {
          outOfRange.push(`stage ${s.stage} spawn ${hex(p.at)} rank ${rank}: ${hp}`);
        }
      }
    }
  }
  c.ok(checked > 0 && !outOfRange.length,
       `check 5: ${checked} spawn/difficulty hit-point pairs in `
       + `[${diff.hp_min}, ${diff.hp_max}]`
       + (outOfRange.length ? ` -- ${outOfRange.slice(0, 4).join("; ")}` : ""));

  // 6 ---------------------------------------------------------------------
  const groups = reactionGroups(exe);
  const wantGroups = [0, 2, 1, 3, 3, 3, 4, 4, 4, 5, 6, 6, 6, 7, 7, 7];
  c.ok(sameNumbers(groups, wantGroups),
       `check 6: the bone-to-reaction-group map is [${wantGroups.join(", ")}]`
       + (sameNumbers(groups, wantGroups) ? "" : `, not [${groups.join(", ")}]`));
  const reactGroups = Math.max(...wantGroups) + 1;
  const dset = deathMotions(exe);
  const deaths = [...dset.front!, ...dset.back!, DEATH_RIGHT, DEATH_LEFT];
  const deathPlays = deaths.map((m) => raw.play(m));
  const shortestDeath = Math.min(...deathPlays);
  const reactMotions = new Set<number>();
  const badRows: string[] = [];
  let nReactTypes = 0;
  for (const ct of types) {
    const rows = hitReactions(exe, ct);
    if (!rows.size) continue;
    nReactTypes++;
    for (const [variant, row] of rows) {
      if (row.length !== reactGroups || !row.every((m) => m)) {
        badRows.push(`type ${ct} condition ${variant} row is [${row.join(", ")}]`);
        continue;
      }
      for (const m of row) reactMotions.add(m);
    }
  }
  const reactPlays = [...reactMotions].map((m) => raw.play(m));
  const longestReact = reactPlays.length ? Math.max(...reactPlays) : 0;
  c.note(`${nReactTypes} types have a stumble set, ${reactMotions.size} distinct `
         + `motions, longest ${longestReact} frames; deaths run `
         + `${shortestDeath} to ${Math.max(...deathPlays)}`);
  c.ok(!badRows.length,
       `check 6: every reaction row fills all ${reactGroups} groups`
       + (badRows.length ? ` -- ${badRows.slice(0, 4).join("; ")}` : ""));
  c.ok(reactMotions.size > 0 && longestReact < shortestDeath,
       `check 6: every reaction (longest ${longestReact}) is shorter than the `
       + `shortest death (${shortestDeath})`);
  const badReact = [...reactMotions].sort((a, b) => a - b)
    .filter((m) => !(raw.play(m) >= 1 && raw.play(m) <= 120))
    .map((m) => `${m} plays ${raw.play(m)}`);
  c.ok(!badReact.length,
       `check 6: every reaction motion's play length is 1..120`
       + (badReact.length ? ` -- ${badReact.join("; ")}` : ""));

  // 7 ---------------------------------------------------------------------
  const rings = (approachTables(exe) as {
    rings: { inner: number; mid: number; outer: number }[] }).rings;
  const badRings = rings.flatMap((r, i) =>
    0 < r.inner && r.inner < r.mid && r.mid <= r.outer
      ? [] : [`set ${i} ${r.inner}/${r.mid}/${r.outer}`]);
  c.ok(rings.length > 0 && !badRings.length,
       `check 7: all ${rings.length} ring sets are ordered inner < mid <= outer`
       + (badRings.length ? ` -- ${badRings.join("; ")}` : ""));
  const curves = (cameraTracking(exe) as { curves: number[][] }).curves;
  const badLen: string[] = [], badRate: string[] = [], badOrder: string[] = [];
  curves.forEach((cv, i) => {
    if (cv.length !== TURN_RATE_CURVE_BYTES) {
      badLen.push(`curve ${i} is ${cv.length} entries`);
      return;
    }
    if (i === 0) return;                         // a runtime buffer; see the head
    if (cv.some((v) => v <= 0)) {
      badRate.push(`curve ${i} min ${Math.min(...cv)}`);
    }
    if (cv.some((v, k) => k + 1 < cv.length && cv[k + 1]! > v)) {
      badOrder.push(`curve ${i}`);
    }
  });
  c.ok(curves.length > 1 && !badLen.length,
       `check 7: every turn-rate curve has ${TURN_RATE_CURVE_BYTES} entries`
       + (badLen.length ? ` -- ${badLen.join("; ")}` : ""));
  c.ok(!badRate.length,
       `check 7: turn-rate curves 1..${curves.length - 1} are all positive`
       + (badRate.length ? ` -- ${badRate.join("; ")}` : ""));
  c.ok(!badOrder.length,
       `check 7: turn-rate curves 1..${curves.length - 1} are non-increasing, `
       + `curve 1 ${curves[1]?.[0]} -> ${curves[1]?.at(-1)}`
       + (badOrder.length ? ` -- not: ${badOrder.join(", ")}` : ""));

  // 8 ---------------------------------------------------------------------
  let nAtk = 0, nPick = 0;
  const noAttack: number[] = [];
  const unreachable: number[][] = [];
  const badLunge: string[] = [], badMask: string[] = [];
  for (const ct of types) {
    const atk = attackTables(exe, ct);
    const picks = attackPicks(exe, ct);
    for (const [cond, row] of atk) {
      for (const [i, e] of row) {
        nAtk++;
        if (!attackHitLands(e.hit_frame, raw.play(e.strike))) {
          unreachable.push([ct, cond, i, e.strike, e.hit_frame, raw.play(e.strike)]);
        }
        const lp = raw.play(e.lunge);
        if (!(lp > 0 && lp <= 400)) {
          badLunge.push(`type ${ct} cond ${cond} attack ${i} lunge ${e.lunge} `
                        + `has length ${lp}`);
        }
        if (e.cancel_mask & ~0x0f) {
          badMask.push(`type ${ct} cond ${cond} attack ${i} mask ${hex(e.cancel_mask)}`);
        }
      }
    }
    for (const v of picks.values()) nPick += v.length;
    if (picks.size && !atk.size) noAttack.push(ct);
  }
  c.note(`${nAtk} usable attacks, ${nPick} pick entries`);
  c.ok(nAtk > 0 && !badLunge.length,
       `check 8: every usable attack's lunge clip plays 1..400`
       + (badLunge.length ? ` -- ${badLunge.slice(0, 4).join("; ")}` : ""));
  c.ok(!badMask.length,
       `check 8: every attack's cancel mask fits in 0x0F`
       + (badMask.length ? ` -- ${badMask.slice(0, 4).join("; ")}` : ""));
  c.ok(!noAttack.length,
       `check 8: every type with a pick table has a usable attack`
       + (noAttack.length ? ` -- not ${noAttack.slice(0, 6).map((t) => hex(t)).join(", ")}` : ""));
  const cmpTuple = (a: number[], b: number[]) => {
    for (let k = 0; k < Math.min(a.length, b.length); k++) {
      if (a[k] !== b[k]) return a[k]! - b[k]!;
    }
    return a.length - b.length;
  };
  const wantUnreachable = ATTACK_MISS.types.filter((t) => types.includes(t))
    .map((t) => [t, ATTACK_MISS.cond, ATTACK_MISS.index, ATTACK_MISS.clip,
                 ATTACK_MISS.hitFrame, ATTACK_MISS.play]).sort(cmpTuple);
  unreachable.sort(cmpTuple);
  const fmtTuples = (ts: number[][]) =>
    ts.map((t) => `(${t.map((v, k) => (k === 0 ? hex(v) : String(v))).join(", ")})`)
      .join(" ");
  c.ok(JSON.stringify(unreachable) === JSON.stringify(wantUnreachable),
       `check 8: the attacks whose hit frame their own clip never reaches are `
       + `the crawlers' condition-4 swing -- clip ${ATTACK_MISS.clip} at frame `
       + `${ATTACK_MISS.hitFrame} of ${ATTACK_MISS.play}, types `
       + `${ATTACK_MISS.types.map((t) => hex(t)).join(", ")}`
       + (JSON.stringify(unreachable) === JSON.stringify(wantUnreachable)
         ? "" : ` -- read ${fmtTuples(unreachable) || "none"}`));

  // 9 ---------------------------------------------------------------------
  let nThrow = 0, nArmed = 0;
  const badRelease: string[] = [], badThrowMask: string[] = [], badKit: string[] = [];
  for (const ct of types) {
    const thr = throwTables(exe, ct);
    if (!thr) continue;
    for (const [cond, hands] of Object.entries(thr.hands as Record<string, ThrowHand[]>)) {
      for (const h of hands) {
        nThrow++;
        const pl = raw.play(h.motion);
        if (!(h.release_frame >= 0 && h.release_frame < pl)) {
          badRelease.push(`type ${ct} cond ${cond} bone ${h.bone} releases on `
                          + `frame ${h.release_frame} of a ${pl}-frame clip`);
        }
        if (![2, 4, 8].includes(h.cancel_mask)) {
          badThrowMask.push(`type ${ct} bone ${h.bone} mask ${hex(h.cancel_mask)}`);
        } else if (h.cancel_mask === (h.bone === 5 ? 2 : 4)) {
          nArmed++;
        }
        for (const k of ["held", "bare", "projectile"] as const) {
          const v = h[k];
          if (v !== null && v !== undefined && !slots.has(v)) {
            badKit.push(`type ${ct} bone ${h.bone} ${k} slot ${hex(v)}`);
          }
        }
      }
    }
  }
  c.note(`${nThrow} thrown-weapon hands, ${nArmed} cancelled by the arm that `
         + `throws them`);
  c.ok(nThrow > 0 && !badRelease.length,
       `check 9: every thrown hand releases inside its own throw clip`
       + (badRelease.length ? ` -- ${badRelease.slice(0, 4).join("; ")}` : ""));
  c.ok(!badThrowMask.length,
       `check 9: every thrown hand's cancel mask is 2, 4 or 8`
       + (badThrowMask.length ? ` -- ${badThrowMask.join("; ")}` : ""));
  c.ok(!badKit.length,
       `check 9: every held, bare and projectile slot is an asset slot`
       + (badKit.length ? ` -- ${badKit.join("; ")}` : ""));

  // 10 --------------------------------------------------------------------
  const posed = new Map<number, number>();
  const seenCls = new Map<number, number>();
  const bump = (m: Map<number, number>, k: number) => m.set(k, (m.get(k) ?? 0) + 1);
  let meshHands = 0;
  const meshUnresolved: string[] = [];
  for (const s of stages) {
    for (const p of s.placements) {
      bump(seenCls, p.cls);
      if (p.motion !== null) bump(posed, p.cls);
      if ((p.cls === 0x30 || p.cls === 0x18)
          && ZOMBIE_BONE_MESH_TYPES.has(p.char_type)) {
        meshHands++;
        if (!p.bone_mesh_coli) meshUnresolved.push(`stage ${s.stage} ${hex(p.at)}`);
      }
    }
  }
  const ruleClasses = Object.keys(MOTION_RULES).map(Number).sort((a, b) => a - b);
  const unposed = ruleClasses.filter((k) => seenCls.get(k) && !posed.get(k));
  c.ok(!unposed.length,
       `check 10: every class with a motion rule and a spawn is posed: `
       + ruleClasses.map((k) => `${hex(k, 2)}=${posed.get(k) ?? 0}/${seenCls.get(k) ?? 0}`)
         .join(", ")
       + (unposed.length ? ` -- none posed: ${unposed.map((k) => hex(k, 2)).join(", ")}` : ""));

  // 11 --------------------------------------------------------------------
  const bankCache = new Map<string, MotionBank | null>();
  const implied = async (mid: number): Promise<number | null> => {
    const bid = exe.motionBankOf(mid);
    const banks = exe.motionBanks();
    if (bid === null || !banks.has(bid)) return null;
    const [fname, ids] = banks.get(bid)!;
    if (!bankCache.has(fname)) bankCache.set(fname, await loadBank(source, fname, ids));
    const bank = bankCache.get(fname);
    return bank ? bank.impliedBoneCount(mid) : null;
  };
  let nRow = 0, nForeign = 0;
  const notMotion: string[] = [], badBackoffPlay: string[] = [];
  for (const ct of types) {
    const want = exe.characterBoneCount(ct) || 0;
    const rows = motionRow(exe, ct);
    if (!rows.size || !want) continue;
    for (const [cond, row] of rows) {
      const m = row.length > MOTION_ROW_BACKOFF ? row[MOTION_ROW_BACKOFF]! : 0;
      if (!(m > 0 && m < 4096)) {
        notMotion.push(`type ${ct} cond ${cond} names ${m}`);
        continue;
      }
      const got = await implied(m);
      if (got !== null && got !== want) {
        nForeign++;
      } else if (!(raw.play(m) >= 1 && raw.play(m) <= 400)) {
        badBackoffPlay.push(`type ${ct} cond ${cond} motion ${m} plays ${raw.play(m)}`);
      } else {
        nRow++;
      }
    }
  }
  c.note(`${nRow} back-away clips match their own character's skeleton, `
         + `${nForeign} name another's and are refused`);
  c.ok(nRow > 0 && !notMotion.length,
       `check 11: every back-away entry (motionRow[cond][${MOTION_ROW_BACKOFF}]) `
       + `is a motion id`
       + (notMotion.length ? ` -- ${notMotion.slice(0, 4).join("; ")}` : ""));
  c.ok(!badBackoffPlay.length,
       `check 11: every back-away clip of the character's own skeleton plays 1..400`
       + (badBackoffPlay.length ? ` -- ${badBackoffPlay.slice(0, 4).join("; ")}` : ""));

  // 12 --------------------------------------------------------------------
  const se = exe.seNames();
  const combat = combatTables(exe) as {
    impact: Named[]; head_impact: Named[];
    voice: { hurt: Named[]; kill: Named[]; head: Named[]; attack: Named[][] };
    ricochet: Record<string, Named>;
    no_effect: { sound: Named; sound_type2: Named };
  };
  const soundIds = [
    ...combat.impact, ...combat.head_impact, ...combat.voice.hurt,
    ...combat.voice.kill, ...combat.voice.head,
    ...Object.values(combat.ricochet),
    combat.no_effect.sound, combat.no_effect.sound_type2,
  ].map((s) => s.id);
  const nameless = soundIds.filter((i) => !se.has(i)).map((i) => hex(i));
  c.ok(soundIds.length > 0 && !nameless.length,
       `check 12: all ${soundIds.length} combat sound ids name a file`
       + (nameless.length ? ` -- not ${nameless.join(", ")}` : ""));

  // 13 --------------------------------------------------------------------
  const ROW_LABEL = new Map<number, string>([
    [0, "walk"], [1, "walk alt"], [2, "run"], [3, "run alt"],
    [MOTION_ROW_BACKOFF, "back away"]]);
  const gaps = new Set<string>(), foreign = new Set<string>();
  const immobile = new Set<string>();
  let rowTypes = 0;
  for (const s of stages) {
    const cts = [...new Set(s.placements
      .filter((p) => p.cls === 0x30 && p.motion !== null)
      .map((p) => p.char_type))].sort((a, b) => a - b);
    for (const ct of cts) {
      const ch = s.chars.get(ct);
      if (!ch) continue;
      rowTypes++;
      const row = ch.motionRowByCond.get(0) ?? [];
      for (const [i, label] of ROW_LABEL) {
        if (i >= row.length || !(row[i]! > 0 && row[i]! < 4096)) continue;
        if (ch.motions.has(row[i]!)) continue;
        if (await implied(row[i]!) === ch.boneCount) {
          gaps.add(`char ${ct} (${ch.name}) ${label} ${row[i]}`);
        } else {
          foreign.add(`${ch.name}:${label}`);
        }
      }
      const movers = [2, 3, 0, 1].filter((i) => i < row.length
        && ch.motions.has(row[i]!)
        && Math.abs(netZ(ch.motions.get(row[i]!)!)) >= 1.0);
      if (!movers.length) immobile.add(`char ${ct} (${ch.name})`);
    }
  }
  c.note(`motion rows: ${rowTypes} class-0x30 types, ${foreign.size} entries `
         + `authored for another skeleton, ${immobile.size} with nothing that closes`);
  for (const m of [...immobile].sort()) c.note(`  never reaches the player: ${m}`);
  c.ok(rowTypes > 0 && !gaps.size,
       `check 13: every motion-row entry of a class-0x30 type's own skeleton `
       + `is baked`
       + (gaps.size ? ` -- not: ${[...gaps].sort().slice(0, 6).join("; ")}` : ""));

  // 14 --------------------------------------------------------------------
  const c31 = class31Tables(exe) as unknown as Class31Block;
  const badStates = new Set<string>();
  const badClips: string[] = [];
  const noAttack31 = new Set<string>();
  let nSets = 0, nPicks31 = 0;
  for (const row of c31.sets ?? []) {
    nSets++;
    for (const band of ["1", "2"]) {
      for (const v of row.state_picks[band] ?? []) {
        nPicks31++;
        if (!THROWER_ACCEPTED_STATES.has(v)) badStates.add(`set ${row.set} band ${band}: ${v}`);
      }
    }
    if (!Object.keys(row.attacks).length) noAttack31.add(String(row.set));
    for (const [stance, entries] of Object.entries(row.attacks)) {
      for (const [idx, e] of Object.entries(entries)) {
        for (const st of e.script) {
          if (!(st.motion > 0 && st.motion < 4096)) {
            badClips.push(`set ${row.set} ${stance}/${idx}`);
          }
        }
        if (!(e.hit_frame >= -1 && e.hit_frame <= 400)) {
          badStates.add(`set ${row.set} ${stance}/${idx} hit frame ${e.hit_frame}`);
        }
      }
    }
    for (const v of new Set(row.attack_picks)) {
      if (!Object.values(row.attacks).some((st) => String(v) in st)) {
        noAttack31.add(`set ${row.set} pick ${v}`);
      }
    }
  }
  c.note(`class 0x31: ${nSets} behaviour sets, ${nPicks31} action picks, `
         + `${Object.keys(c31.scripts ?? {}).length} named arc scripts, `
         + `${class31MotionIds(c31 as unknown as Record<string, unknown>).length} distinct clips`);
  if (noAttack31.size) {
    c.note(`  attack indices with no entry: ${[...noAttack31].sort().join(", ")}`);
  }
  c.ok(nPicks31 > 0 && !badStates.size,
       `check 14: every class-0x31 pick in bands 1 and 2 names a state `
       + `ThrowerTryEnterState accepts, and every hit frame is -1..400`
       + (badStates.size ? ` -- ${[...badStates].sort().slice(0, 6).join("; ")}` : ""));
  c.ok(!badClips.length,
       `check 14: every class-0x31 attack script stage names a motion id`
       + (badClips.length ? ` -- ${badClips.slice(0, 6).join("; ")}` : ""));

  // 15 --------------------------------------------------------------------
  for (const [fn, sites] of VOICE_KIND_SITES) {
    for (const [va, want] of sites) {
      const got = raw.hexAt(va, want.length / 2);
      c.ok(got === want,
           `check 15: ${fn}'s voice-kind test at ${hex(va, 8)} is ${want}`
           + (got === want ? "" : `, read ${got || "unmapped"}: the kind may no `
              + `longer be read off g_shot_bone`));
    }
  }
  const killIds = combat.voice.kill.map((s) => s.id);
  const headIds = combat.voice.head.map((s) => s.id);
  c.ok(killIds.length > 0 && sameNumbers(killIds, headIds),
       `check 15: kinds 1 and 2 read one voice pair (${killIds.map((i) => hex(i)).join(", ")})`
       + (sameNumbers(killIds, headIds) ? "" : ` -- kind 2 reads ${headIds.map((i) => hex(i)).join(", ")}`));
  const body = new Set(combat.impact.map((s) => s.id));
  const headImpact = new Set(combat.head_impact.map((s) => s.id));
  const shared = [...body].filter((i) => headImpact.has(i));
  c.ok(body.size === 5 && headImpact.size === 2 && !shared.length,
       `check 15: the impact tables are 5 body and 2 head ids, disjoint `
       + `(${body.size}/${headImpact.size}, shared [${shared.map((i) => hex(i)).join(", ")}])`);
  const kind3 = combat.voice.attack;
  c.ok(Array.isArray(kind3) && kind3.length === 2 && kind3.every((pr) => pr.length === 2),
       `check 15: kind 3 is two pairs, one per voice set `
       + `(${kind3?.length ?? 0} of ${kind3?.[0]?.length ?? 0})`);

  // 16 --------------------------------------------------------------------
  const arcs: [string, ArcStage[]][] = [];
  for (const [k, v] of Object.entries(c31.scripts ?? {})) {
    if (v) arcs.push([`named ${k}`, v]);
  }
  for (const row of c31.sets ?? []) {
    for (const [stance, entries] of Object.entries(row.attacks)) {
      for (const [idx, e] of Object.entries(entries)) {
        arcs.push([`set ${row.set} ${stance}/${idx}`, e.script]);
      }
    }
  }
  for (const [k, a] of Object.entries(CLASS30_ARC_SCRIPTS)) {
    const sc = arcScript(exe, a);
    c.ok(sc !== null, `check 16: class-0x30 arc script ${k} (${hex(a, 8)}) resolves`);
    if (sc) arcs.push([`class 0x30 ${k}`, sc]);
  }
  const past: string[] = [];
  let switches = 0;
  for (const [name, sc] of arcs) {
    if (sc.length !== 3) {
      past.push(`${name}: ${sc.length} stages`);
      continue;
    }
    for (let i = 0; i + 1 < sc.length; i++) {
      if (sc[i]!.motion !== sc[i + 1]!.motion) switches++;
    }
    sc.forEach((st, i) => {
      const pl = exe.motionPlayLength(st.motion);
      if (pl === null || !(st.start >= 0 && st.start <= pl && st.until <= pl)) {
        past.push(`${name} stage ${i}: motion ${st.motion} start ${st.start} `
                  + `until ${st.until} play ${pl}`);
      }
    });
  }
  c.ok(arcs.length === 42,
       `check 16: the 42 arc scripts classes 0x30 and 0x31 can install are `
       + `read (${arcs.length})`);
  c.ok(!past.length,
       `check 16: every arc-script stage's start and threshold is inside its `
       + `own clip's play length`
       + (past.length ? ` -- ${past.slice(0, 6).join("; ")}` : ""));
  c.ok(switches === 8,
       `check 16: eight arc-script stage changes switch clips (${switches})`);
  const named: number[] = [];
  LEAP_ASIDE_ZSLMAN_MOV.forEach((ins, row) => {
    const o = exe.v2r(ins)!;
    const op = raw.u8(o);
    const addr = raw.u32(o + 1);
    named.push(addr);
    const want = CLASS31_ARC_SCRIPTS.aside_zslman! + row * CLASS31_ASIDE_ZSLMAN_STRIDE;
    c.ok(op === 0xbe && addr === want,
         `check 16: ThrowerStateLeapAside row ${row} is MOV ESI, ${hex(want, 8)} `
         + `at ${hex(ins, 8)}, where the exporter reads it`
         + (op === 0xbe && addr === want ? ""
           : ` -- the image has ${hex(op, 2)} ${hex(addr, 8)}`));
    const q = exe.v2r(addr);
    const dwords = q === null ? [] : range(0, 12).map((k) => raw.i32(q + k * 4));
    const got = c31.scripts?.[`aside_zslman_${row}`];
    const flat = got ? got.flatMap((s) => [s.motion, s.start, s.fade, s.until]) : [];
    c.ok(dwords.length === 12 && sameNumbers(flat, dwords),
         `check 16: the exported aside_zslman_${row} is the twelve dwords at `
         + `${hex(addr, 8)}`
         + (sameNumbers(flat, dwords) ? ""
           : ` -- exported [${flat.join(", ")}], image [${dwords.join(", ")}]`));
  });
  c.note(`zslman's leap-aside scripts are the four the state names: `
         + named.map((a) => hex(a, 8)).join(", "));

  // 17 --------------------------------------------------------------------
  checkBoneSpheres(c, exe, raw, types);
  c.ok(meshHands > 0 && !meshUnresolved.length,
       `check 17: all ${meshHands} class-0x30/0x18 spawns of types 2, 3 and 0xE `
       + `name a collision blob at tail+0x10`
       + (meshUnresolved.length
         ? ` -- ${meshUnresolved.length} do not: ${meshUnresolved.slice(0, 6).join("; ")}`
         : ""));

  c.finish();
}

function checkBoneSpheres(c: Checker, exe: ExeTables, raw: Raw,
                          types: number[]): void {
  const gate = raw.hexAt(WALK_NODE_GATE, WALK_NODE_GATE_BYTES.length / 2);
  c.ok(gate === WALK_NODE_GATE_BYTES,
       `check 17: SkeletonWalkNode's slot gate is at ${hex(WALK_NODE_GATE, 8)}`
       + (gate === WALK_NODE_GATE_BYTES ? "" : ` -- read ${gate || "unmapped"}`));

  // The rows the build refuses, and the rows it reads.
  const gated = new Set<string>();
  const gatedTypes = new Set<number>();
  const sphereMisread: string[] = [];
  let nSpheres = 0;
  for (const ct of types) {
    const { rows } = raw.partRows(ct);
    for (const node of exe.characterSkeleton(ct)) {
      const b = node.bone;
      if (!(b >= 1 && b <= rows.length)) continue;
      const [slot, r, cx, cy, cz] = rows[b - 1]!;
      if (r! > 0 && (slot! >>> 0) !== node.slot) {
        gated.add(key(ct, b));
        gatedTypes.add(ct);
      }
      const got = hitSphere(exe, ct, b);
      const want = r! > 0 ? [cx!, cy!, cz!, r!, slot!] : null;
      const flat = got ? [...got[0], got[1], got[2]] : null;
      if (want) nSpheres++;
      if ((flat === null) !== (want === null)
          || (flat && want && !sameNumbers(flat, want))) {
        sphereMisread.push(`type ${hex(ct)} bone ${b}`);
      }
    }
  }
  const wantGated = new Set(Object.entries(GATED)
    .flatMap(([ct, bones]) => bones.map((b) => key(Number(ct), b))));
  const extra = [...gated].filter((k) => !wantGated.has(k));
  const missing = [...wantGated].filter((k) => !gated.has(k));
  c.ok(!extra.length && !missing.length,
       `check 17: the ${gated.size} rows with a radius the build refuses, in `
       + `${gatedTypes.size} of ${types.length} character types, are GATED`
       + (extra.length || missing.length
         ? ` -- extra ${extra.join(" ")}, missing ${missing.join(" ")}` : ""));
  c.ok(nSpheres > 0 && !sphereMisread.length,
       `check 17: hitSphere is the raw row bone - 1 with its own slot, for all `
       + `${nSpheres} bones with a radius`
       + (sphereMisread.length ? ` -- not ${sphereMisread.slice(0, 6).join("; ")}` : ""));

  // The two restore states: which table, which rows, and whose slots.
  const le32 = (v: number) =>
    [0, 8, 16, 24].map((s) => ((v >>> s) & 0xff).toString(16).padStart(2, "0")).join("");
  const tbl16 = HIT_SPHERES + 0x16 * 4;
  const reads: [number, string, string][] = [
    // ThrowerStateRearm: MOV ECX,[tbl16]; MOV EDX,[ECX+0x60] and
    // MOV EAX,[tbl16] ... MOV ECX,[EAX+0x9C].
    [0x0044f822, "8b0d" + le32(tbl16) + "8b5160", "ThrowerStateRearm row 4"],
    [0x0044f880, "a1" + le32(tbl16) + "8b889c000000", "ThrowerStateRearm row 7"],
    // ThrowerStateRestoreBothHands: MOV ECX,[EAX*4 + table]; +0x60 / +0x9C.
    [0x0044f9e6, "8b0c85" + le32(HIT_SPHERES) + "8b5160",
     "ThrowerStateRestoreBothHands row 4"],
    [0x0044fa4e, "8b0c85" + le32(HIT_SPHERES) + "8b919c000000",
     "ThrowerStateRestoreBothHands row 7"],
  ];
  for (const [va, want, what] of reads) {
    const got = raw.hexAt(va, want.length / 2);
    c.ok(got === want,
         `check 17: ${what} reads g_character_part_tables (${hex(HIT_SPHERES, 8)}) `
         + `at ${hex(va, 8)}`
         + (got === want ? "" : ` -- the image has ${got || "nothing"}, not ${want}`));
  }
  c.ok(4 * PART_ROW + 0x10 === 0x60 && 7 * PART_ROW + 0x10 === 0x9c,
       `check 17: rows 4 and 7's radii are at +0x60 and +0x9C`);

  // EnemyThrowerInit's armed hands, as immediates.
  const arm5 = raw.hexAt(THROWER_ARM_RIGHT, 10);
  const arm8 = raw.hexAt(THROWER_ARM_LEFT, 10);
  const rows16 = raw.partRows(0x16).rows;
  const armed = arm5.startsWith("c786dc040000") && arm8.startsWith("c7868c060000");
  c.ok(armed,
       `check 17: EnemyThrowerInit's two hand writes are at `
       + `${hex(THROWER_ARM_RIGHT, 8)} / ${hex(THROWER_ARM_LEFT, 8)}`);
  if (armed) {
    const imm = (h: string) => parseInt(h.slice(12, 20).match(/../g)!.reverse().join(""), 16);
    const imm5 = imm(arm5), imm8 = imm(arm8);
    c.note(`zsass: EnemyThrowerInit arms ${hex(imm5)}/${hex(imm8)}; rows 4 and 7 `
           + `name ${hex(rows16[4]![0]!)}/${hex(rows16[7]![0]!)}, radii `
           + `${rows16[4]![1]}/${rows16[7]![1]}`);
    c.ok(rows16[4]![0] === imm5 && rows16[7]![0] === imm8,
         `check 17: type 0x16's rows 4 and 7 are the hands EnemyThrowerInit arms`);
    const kit = THROWER_SLOTS[0x16]!;
    c.ok(kit[5].held === imm5 && kit[8].held === imm8,
         `check 17: THROWER_SLOTS[0x16]'s held slots are EnemyThrowerInit's `
         + `immediates (${hex(kit[5].held ?? 0)}/${hex(kit[8].held ?? 0)})`);
  }

  // The damaged-part tails: terminated, agreeing, and exported as a raw
  // first match reads them.
  const fallbackOf = (ct: number) => (ct === 0x0d ? 0x0b : 0x07);
  const unterminated: string[] = [], disagree: string[] = [], misread: string[] = [];
  let both = 0;
  for (const ct of types) {
    const namedSlots = new Set<number>();
    for (const node of exe.characterSkeleton(ct)) {
      for (const st of hitSteps(exe, ct, node.bone)) {
        if (st[0]! > 1) namedSlots.add(st[0]!);
      }
    }
    if (!namedSlots.size) continue;
    const n = exe.characterBoneCount(ct);
    const { rows, end } = raw.partRows(ct);
    if (end === null) {
      unterminated.push(hex(ct));
      continue;
    }
    const own = firstBySlot(rows.slice(n - 1, end), (r) => r[0]!);
    const fct = fallbackOf(ct);
    const f = raw.partRows(fct);
    const fb = firstBySlot(
      f.rows.slice(exe.characterBoneCount(fct) - 1, f.end ?? undefined), (r) => r[0]!);
    for (const s of namedSlots) {
      const a = own.get(s), b = fb.get(s);
      if (a && b) {
        both++;
        if (!sameNumbers(a.slice(1), b.slice(1))) disagree.push(`${hex(ct)} slot ${hex(s)}`);
      }
    }
    const first = firstBySlot(partSphereRows(exe, ct, namedSlots), (e) => e.slot);
    for (const s of namedSlots) {
      const got = first.get(s);
      const want = own.get(s);
      if ((got === undefined) !== (want === undefined)
          || (got && want && !sameNumbers([got.radius, ...got.centre], want.slice(1)))) {
        misread.push(`${hex(ct)} slot ${hex(s)}`);
      }
    }
  }
  c.ok(!unterminated.length,
       `check 17: the damaged-part tail of every type that searches one ends in -1`
       + (unterminated.length ? ` -- not ${unterminated.join(", ")}` : ""));
  c.ok(both > 0 && !disagree.length,
       `check 17: all ${both} slots both searches find have the same row`
       + (disagree.length ? ` -- not ${disagree.slice(0, 6).join("; ")}` : ""));
  c.ok(!misread.length,
       `check 17: partSphereRows is a raw first match for every named slot`
       + (misread.length ? ` -- not ${misread.slice(0, 6).join("; ")}` : ""));
}

await main();
