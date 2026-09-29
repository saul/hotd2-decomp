/**
 * The effect system's three tables, held against each other and the discs.
 *
 *     node tools/run_ts.mjs tools/checks/effects.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * An effect is a small rigged object animated by an ordinary motion, and
 * three contiguous tables describe all 29: `g_effect_trees` (`0x004D5390`),
 * `g_effect_bone_counts` (`0x004D5404`) and `g_effect_interp_mode`
 * (`0x004D5440`). `EffectDrawNode` (`FUN_0040DE50`) walks a tree, and
 * `EffectFrameTranslations` (`FUN_0040E040`) and `EffectFrameRotations`
 * (`FUN_0040E070`) derive the motion's stride from the **node count**. Every
 * tree is read through `hod2lib/props.ts`'s `effectTree` and every motion
 * through `hod2lib/mot.ts`, the code the exporter runs.
 *
 * What this asserts, and the statement each assertion guards:
 *
 *  * **The tables are 29 long and contiguous** -- the trees' pointers end
 *    where the counts begin and the counts, padded to a dword, where the
 *    interpolation modes begin. `docs/formats/spawns.md:553-560`,
 *    `props.ts`'s `EFFECT_COUNT`.
 *  * **Every tree walks to exactly its `g_effect_bone_counts` entry.** The
 *    two are independent -- a pointer walk and a flat `s16` -- so agreeing on
 *    all 29 is a test of the node struct `{u32 slot; s16 bone; u16 children;
 *    u32 child[]}`. `spawns.md:615-616` and `623-625`, and `bundle.ts`'s
 *    `effectDefJson`, which refuses an effect whose two disagree.
 *  * **Every bone index is used once, 0 for the root and 1..n-1 below it**,
 *    which is what makes `frame.t[bone - 1]` a total function; and the root
 *    names slot 0, so it never draws. `spawns.md:562-567` and `625-626`.
 *  * **Effect 8's root has 144 children and the tree 145 nodes** -- the walk
 *    is bounded by its input, not by a guess at the data. `props.ts`'s
 *    `EFFECT_NODE_CAP` note.
 *  * **Every interpolation mode is 0, 1 or 2**, the three arms
 *    `EffectPoseNode` has. `spawns.md:559` and `590-591`.
 *  * **Every node slot resolves to a `pol/` file, and each effect's slots to
 *    one file.** Every effect `g_prop_kind_params` names is a `komono_*.bin`,
 *    and the four rows of the table in `spawns.md:604-613` -- effect, prop
 *    kind, node count, file -- are what the EXE says.
 *  * **All 13 `(effect, motion)` pairs the two consumers name divide exactly
 *    by the stride their node count implies**: `g_prop_kind_params`' pair per
 *    class-0x41 type-4 kind, and `PropBuildScriptFlagEffect`'s effects 2 and
 *    3 with the literal motion 471. A wrong stride almost never divides.
 *    `spawns.md:626-627`, `docs/formats/mot.md:188-193`, and `mot.ts`'s
 *    `effectFrameStride`.
 */
import { gameDirOrSkip, openGame, Checker, hex } from "../lib/exe_check";
import * as props from "../../src/hod2lib/props";
import { effectFrameStride, loadBank, type MotionBank } from "../../src/hod2lib/mot";

/** `spawns.md:554` and `props.ts`'s `EFFECT_COUNT`. */
const EFFECTS = 29;

/** `props.ts`: effect 8 is the wide one. */
const WIDE_EFFECT = 8;
const WIDE_ROOT_CHILDREN = 144;
const WIDE_NODES = 145;

/** `EffectPoseNode`'s three arms. */
const INTERP_MODES = [0, 1, 2];

/** `spawns.md:608-613`: `[effect, prop kind, nodes, file]`. */
const KOMONO_TABLE: [number, number, number, string][] = [
  [5, 0, 13, "komono_3.bin"],
  [17, 1, 18, "komono_6.bin"],
  [20, 6, 11, "komono_3.bin"],
  [22, 5, 11, "komono_7.bin"],
];

/** `spawns.md:626` and `mot.md:193`. */
const PAIRS = 13;

function sameList(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function main(): Promise<void> {
  const dir = gameDirOrSkip("effects");
  const { source, exe } = await openGame(dir);
  const c = new Checker("effects");

  // -- the three tables ----------------------------------------------------
  c.eq(props.EFFECT_COUNT, EFFECTS, "props.EFFECT_COUNT is 29");
  c.eq(props.EFFECT_BONE_COUNTS - props.EFFECT_TREES, EFFECTS * 4,
       "g_effect_bone_counts begins where 29 tree pointers end");
  c.eq(props.EFFECT_INTERP_MODE - props.EFFECT_BONE_COUNTS,
       (EFFECTS * 2 + 3) & ~3,
       "g_effect_interp_mode begins where 29 s16 counts end, dword-aligned");

  const slots = exe.assetSlots();
  const declared: number[] = [];
  const fileOf = new Map<number, string[]>();
  let nodes = 0;
  for (let e = 0; e < EFFECTS; e++) {
    const tree = props.effectTree(exe, e);
    const want = exe.ru16(props.EFFECT_BONE_COUNTS + e * 2) ?? -1;
    declared.push(want);
    nodes += tree.length;
    if (!c.ok(tree.length > 0, `effect ${e}: g_effect_trees names a tree`)) continue;
    c.eq(tree.length, want, `effect ${e}: the tree walks to g_effect_bone_counts`);
    const bones = tree.map((n) => n.bone).sort((a, b) => a - b);
    c.ok(sameList(bones, bones.map((_, i) => i)),
         `effect ${e}: bone indices are 0..${tree.length - 1}, each once`
         + (sameList(bones, bones.map((_, i) => i)) ? "" : `; got ${bones.slice(0, 8)}...`));
    c.ok(tree[0]!.bone === 0 && tree[0]!.slot === 0,
         `effect ${e}: the root is bone 0 and draws slot 0`
         + ` (bone ${tree[0]!.bone}, slot ${hex(tree[0]!.slot)})`);
    const r = exe.v2r(props.EFFECT_INTERP_MODE + e);
    const mode = r === null ? -1 : exe.data[r]!;
    c.ok(INTERP_MODES.includes(mode), `effect ${e}: g_effect_interp_mode is ${mode}`);
    const files = new Set<string>();
    const lost: number[] = [];
    for (const n of tree) {
      if (!n.slot) continue;
      const f = slots.get(n.slot)?.[0];
      if (f) files.add(f);
      else lost.push(n.slot);
    }
    c.ok(!lost.length, `effect ${e}: every node slot resolves to a pol file`
         + (lost.length ? `; not ${lost.map((s) => hex(s)).join(", ")}` : ""));
    c.eq(files.size, 1, `effect ${e}: its nodes draw from one file (${[...files].join(", ")})`);
    fileOf.set(e, [...files]);
  }
  c.note(`${EFFECTS} effect trees, ${nodes} nodes`);

  const wide = props.effectTree(exe, WIDE_EFFECT);
  c.eq(wide[0]?.children.length ?? -1, WIDE_ROOT_CHILDREN,
       `effect ${WIDE_EFFECT}'s root has ${WIDE_ROOT_CHILDREN} children`);
  c.eq(wide.length, WIDE_NODES, `effect ${WIDE_EFFECT} has ${WIDE_NODES} nodes`);

  // -- the kinded props' effects are komono ---------------------------------
  const kinds = exe.propKindParams();
  for (const row of kinds) {
    if (row.effect! < 0 || row.effect_variant! <= 0) continue;
    const files = fileOf.get(row.effect!) ?? [];
    c.ok(files.length === 1 && /^komono_.*\.bin$/.test(files[0]!),
         `prop kind ${row.kind}: effect ${row.effect} draws from ${files.join(", ") || "nothing"}`);
  }
  for (const [e, kind, n, file] of KOMONO_TABLE) {
    c.eq(kinds[kind]?.effect, e, `prop kind ${kind} names effect ${e}`);
    c.eq(declared[e], n, `effect ${e} has ${n} nodes`);
    c.eq((fileOf.get(e) ?? []).join(), file, `effect ${e} draws from ${file}`);
  }

  // -- the stride, against every motion the two consumers pair ------------
  const pairs = new Map<string, [number, number]>();
  for (const row of kinds) {
    if (row.effect! >= 0 && row.effect_variant! > 0) {
      pairs.set(`${row.effect}:${row.effect_variant}`, [row.effect!, row.effect_variant!]);
    }
  }
  for (const eff of [props.SCRIPT_FLAG_EFFECT_A.effect, props.SCRIPT_FLAG_EFFECT_B.effect]) {
    pairs.set(`${eff}:${props.SCRIPT_FLAG_EFFECT_MOTION}`,
              [eff, props.SCRIPT_FLAG_EFFECT_MOTION]);
  }
  c.eq(pairs.size, PAIRS, "(effect, motion) pairs the two consumers name");
  const banks = exe.motionBanks();
  const cache = new Map<string, MotionBank | null>();
  for (const [eff, motion] of [...pairs.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const what = `effect ${eff} motion ${motion}`;
    const bankId = exe.motionBankOf(motion);
    if (!c.ok(bankId !== null && banks.has(bankId), `${what}: names a motion bank`)) continue;
    const [name, ids] = banks.get(bankId!)!;
    if (!cache.has(name)) cache.set(name, await loadBank(source, name, ids));
    const bank = cache.get(name);
    const base = bank?.offsets.get(motion);
    if (!c.ok(bank != null && base !== undefined, `${what}: is in ${name}`)) continue;
    let end = bank!.raw.length;
    for (const o of bank!.offsets.values()) if (o > base! && o < end) end = o;
    const span = end - base! - 4;
    const stride = effectFrameStride(declared[eff]!);
    const frames = bank!.frameCount(motion);
    c.ok(stride > 0 && frames > 0 && span === stride * frames,
         `${what} in ${name}: ${frames} frames x stride ${stride} (from ${declared[eff]} nodes)`
         + ` = ${stride * frames}, block ${span} bytes`);
  }

  c.finish();
}

await main();
