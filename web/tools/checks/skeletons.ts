/**
 * Every character skeleton, walked whole, against the EXE's own bone count.
 *
 *     node tools/run_ts.mjs tools/checks/skeletons.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * `ExeTables.characterSkeleton` (`hod2lib/exetab.ts`) flattens
 * `g_character_skeletons` (`0x004E0430`) into a node list, and the rig, the
 * bone spheres the shot test walks and the channels a clip is baked onto are
 * all built from that list. **A node the walk misses is a bone the game has
 * and the player does not**, and nothing downstream notices: the rig builds,
 * the motion bakes onto the bones it has, and the actor draws with a piece
 * missing.
 *
 * The invariant is the EXE's, and it is independent of the walk: the motion
 * frame's bone count at `DAT_004E0724` (`characterBoneCount`) is one more
 * than the highest bone index in the tree, because bone 0 is the object root.
 *
 * What this asserts, and the statement each assertion guards:
 *
 *  * **Every character type with a skeleton walks to exactly bones
 *    1..count-1, each once.** `docs/formats/mot.md`, "The frame record"
 *    (`g_character_bone_counts` is one more than the highest index in the
 *    tree), and the node layout in `exetab.ts`'s `characterSkeleton`.
 *  * **The stage-3 boss's heads are whole.** `boss3.bin` (`0x49`) is a chain
 *    whose node 17 -- the weak bone -- carries the two jaws 18 and 19, 19
 *    nodes against a bone count of 20; `boss3l.bin` (`0x48`) a chain to the
 *    weak bone 24 with jaws 25 and 26, 26 nodes against 27; `b6boss3.bin`
 *    (`0x50`) the same shape. The slots, the chain's step and the jaws'
 *    offsets are the ones `docs/re/boss-tower.md` "The skeletons" lists, and
 *    the weak bone and both jaws sit below depth 12 in all three -- the
 *    trees nest 17 and 24 deep, so a walk capped at depth 12 returns 13 of
 *    their nodes. `boss-tower.md` "The skeletons" ("These trees are deep"),
 *    and `exetab.ts`'s note beside the walk.
 *  * **The other bosses' trees**: `boss4.bin` (`0x4A`) is fifteen nodes,
 *    bones 1..15 (`docs/re/boss-strength.md` section 0); types `0x44`,
 *    `0x45` and `0x46` count 16, 16 and 7 with their root and draw from slots
 *    `0x28F..0x2C8` (`docs/re/boss-judgment.md`, "Character types"); and
 *    `0x1B` is `frog.bin`, 15 bones (`docs/formats/spawns.md`, class `0x11`).
 */
import { gameDirOrSkip, openGame, Checker, hex } from "../lib/exe_check";
import type { ExeTables, SkeletonNode } from "../../src/hod2lib/exetab";

/** How close an offset has to come to one written in the docs. */
const OFFSET_TOLERANCE = 5e-4;

/** A walk capped here returned 13 nodes of the stage-3 heads. */
const OLD_DEPTH_CAP = 12;

/**
 * The three stage-3 heads, as `boss-tower.md` "The skeletons" lists them:
 * a chain `1..weak` whose links after the first sit `step` along X, and two
 * jaws under the weak bone at one shared offset.
 */
interface Head {
  type: number;
  file: string;
  nodes: number;
  bones: number;
  weak: number;
  depth: number;
  step: [number, number, number];
  jaws: [number, number];
  jawOffset: [number, number, number];
  /** Chain slots where the doc names them: `[first, last]` bone, slot. */
  chainSlots?: [number, number, number][];
  jawSlots?: [number, number];
}

const HEADS: Head[] = [
  { type: 0x49, file: "boss3.bin", nodes: 19, bones: 20, weak: 17, depth: 17,
    step: [3, 0, 0], jaws: [18, 19], jawOffset: [3.662, -0.189, 0],
    chainSlots: [[1, 16, 914], [17, 17, 913]], jawSlots: [911, 912] },
  { type: 0x48, file: "boss3l.bin", nodes: 26, bones: 27, weak: 24, depth: 24,
    step: [4, 0, 0], jaws: [25, 26], jawOffset: [4.881, -0.252, 0],
    jawSlots: [898, 899] },
  { type: 0x50, file: "b6boss3.bin", nodes: 26, bones: 27, weak: 24, depth: 24,
    step: [4, 0, 0], jaws: [25, 26], jawOffset: [4.881, -0.252, 0] },
];

/** `[type, file, bone count, slot range or null]` for the other stated trees. */
const COUNTS: [number, string, number, [number, number] | null][] = [
  [0x4a, "boss4.bin", 16, null],
  [0x44, "char_adv04.bin", 16, [0x28f, 0x2c8]],
  [0x45, "char_adv04.bin", 16, [0x28f, 0x2c8]],
  [0x46, "char_adv04.bin", 7, [0x28f, 0x2c8]],
  [0x1b, "frog.bin", 15, null],
];

function near(a: readonly number[], b: readonly number[]): boolean {
  return a.every((v, i) => Math.abs(v - b[i]!) <= OFFSET_TOLERANCE);
}

function vec(v: readonly number[]): string {
  return `(${v.map((x) => x.toFixed(3)).join(", ")})`;
}

function checkHead(c: Checker, exe: ExeTables, h: Head): void {
  const what = `type ${hex(h.type, 2)} (${h.file})`;
  const skel = exe.characterSkeleton(h.type);
  c.eq(exe.characterAssetFile(h.type), h.file, `${what}: the skeleton draws from ${h.file}`);
  c.eq(skel.length, h.nodes, `${what}: ${h.nodes} nodes`);
  c.eq(exe.characterBoneCount(h.type), h.bones, `${what}: bone count ${h.bones}`);
  const byBone = new Map<number, SkeletonNode>(skel.map((n) => [n.bone, n]));
  const parentBone = (n: SkeletonNode | undefined): number | null =>
    n && n.parent !== null ? skel[n.parent]!.bone : null;
  // The chain: each link's parent is the one before it.
  const broken: number[] = [];
  const offBy: number[] = [];
  for (let b = 1; b <= h.weak; b++) {
    const n = byBone.get(b);
    if (!n || (b > 1 && parentBone(n) !== b - 1) || (b === 1 && n.parent !== null)) broken.push(b);
    if (n && b > 1 && !near(n.offset, h.step)) offBy.push(b);
  }
  c.ok(!broken.length, `${what}: bones 1..${h.weak} are one chain`
       + (broken.length ? `; not at ${broken.join(", ")}` : ""));
  c.ok(!offBy.length, `${what}: links 2..${h.weak} sit ${vec(h.step)} from their parent`
       + (offBy.length ? `; not ${offBy.join(", ")}` : ""));
  for (const [lo, hi, slot] of h.chainSlots ?? []) {
    const bad = [];
    for (let b = lo; b <= hi; b++) if (byBone.get(b)?.slot !== slot) bad.push(b);
    c.ok(!bad.length, `${what}: bones ${lo}..${hi} draw slot ${slot}`
         + (bad.length ? `; not ${bad.join(", ")}` : ""));
  }
  h.jaws.forEach((j, i) => {
    const n = byBone.get(j);
    c.eq(parentBone(n), h.weak, `${what}: jaw ${j} hangs off the weak bone ${h.weak}`);
    c.ok(!!n && near(n.offset, h.jawOffset),
         `${what}: jaw ${j} at ${n ? vec(n.offset) : "nothing"}, expected ${vec(h.jawOffset)}`);
    if (h.jawSlots) c.eq(n?.slot, h.jawSlots[i], `${what}: jaw ${j} draws slot ${h.jawSlots[i]}`);
  });
  const deepest = Math.max(...skel.map((n) => n.depth));
  c.eq(deepest, h.depth, `${what}: the tree nests ${h.depth} deep`);
  const weakDepth = byBone.get(h.weak)?.depth ?? -1;
  c.ok(weakDepth > OLD_DEPTH_CAP && h.jaws.every((j) => (byBone.get(j)?.depth ?? -1) > OLD_DEPTH_CAP),
       `${what}: the weak bone (depth ${weakDepth}) and both jaws sit below depth ${OLD_DEPTH_CAP}`);
  c.eq(skel.filter((n) => n.depth <= OLD_DEPTH_CAP).length, OLD_DEPTH_CAP + 1,
       `${what}: ${OLD_DEPTH_CAP + 1} of its nodes are at depth ${OLD_DEPTH_CAP} or above`);
}

async function main(): Promise<void> {
  const dir = gameDirOrSkip("skeletons");
  const { exe } = await openGame(dir);
  const c = new Checker("skeletons");

  // -- every skeleton, whole ----------------------------------------------
  let walked = 0;
  let nodes = 0;
  for (let ct = 0; ct < 0x100; ct++) {
    const skel = exe.characterSkeleton(ct);
    if (!skel.length) continue;
    walked++;
    nodes += skel.length;
    const want = exe.characterBoneCount(ct);
    const bones = skel.map((n) => n.bone).sort((a, b) => a - b);
    const whole = bones.length === want - 1 && bones.every((b, i) => b === i + 1);
    c.ok(whole, `type ${hex(ct, 2)} (${exe.characterAssetFile(ct) ?? "several files"}): `
         + `${skel.length} nodes are bones 1..${want - 1} of DAT_004E0724's ${want}`
         + (whole ? "" : `; highest ${Math.max(...bones)}`));
  }
  c.ok(walked > 0, `${walked} character types have a skeleton`);
  c.note(`${walked} skeletons, ${nodes} nodes`);

  // -- the stage-3 heads ---------------------------------------------------
  for (const h of HEADS) checkHead(c, exe, h);

  // -- the other trees a doc counts ---------------------------------------
  for (const [ct, file, bones, span] of COUNTS) {
    const what = `type ${hex(ct, 2)}`;
    const skel = exe.characterSkeleton(ct);
    c.eq(exe.characterAssetFile(ct) ?? [...new Set(skel.map((n) => exe.assetSlots().get(n.slot)?.[0]))].join(),
         file, `${what}: the skeleton's slots name ${file}`);
    c.eq(exe.characterBoneCount(ct), bones, `${what}: bone count ${bones}`);
    c.eq(skel.length, bones - 1, `${what}: ${bones - 1} nodes`);
    if (span) {
      const out = skel.filter((n) => n.slot < span[0] || n.slot > span[1]);
      c.ok(!out.length, `${what}: every slot is in ${hex(span[0])}..${hex(span[1])}`
           + (out.length ? `; not ${out.map((n) => hex(n.slot)).join(", ")}` : ""));
    }
  }

  c.finish();
}

await main();
