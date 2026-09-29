/**
 * The looping-SE pairing is real, not two tables that merely sit side by side.
 *
 *     node tools/run_ts.mjs tools/checks/looping_se.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * `PlaySoundId` (`FUN_0041CFD0`) has one branch that decides whether a sound
 * effect loops, and it is not a property of the file:
 *
 * ```c
 * if (g_looping_se_ids != 0xFFFFFFFF) {
 *     i = 0; id = g_looping_se_ids;
 *     do {
 *         if (param_1 == id)                        { loop = 1; break; }
 *         if (param_1 == g_looping_se_stop_ids[i])   { SoundStopAllLoopingSe(); break; }
 *         id = g_looping_se_ids[i + 1]; i++;
 *     } while (id != 0xFFFFFFFF);
 * }
 * SoundPlayOnFreeChannel(name, loop, 0xFFFFFFFF, param_1);
 * ```
 *
 * So an id in the table at `0x005887FC` is played **looped** and an id in the
 * table at `0x005888B0` stops every loop in the mix. The engine keeps no
 * handle for a playing loop, which is why the chainsaw a zombie carries is
 * started by one call from its `Init` and stopped by another from its death --
 * see `EnemyZombieInitByCharType` (`FUN_00452FD0`) and
 * `ZombieReleaseWeaponLoopSe` (`FUN_00456600`).
 *
 * Neither table stores a count and neither bounds the other, so the walk to
 * the `0xFFFFFFFF` terminator is the only thing that fixes their lengths --
 * exactly the shape **L6** warns about. This check reads both through
 * `ExeTables.loopingSe` and `ExeTables.seNames`, and it can fail five ways:
 *
 * * the walk and its terminator must exactly fill the gap between the two
 *   bases. Two tables read to their own terminators that came out different
 *   lengths would mean the index-for-index pairing is invented;
 * * every id in both must resolve through `g_se_name_list` (`0x005845F8`). An
 *   entry that named no record would mean the stride or the base is wrong;
 * * **every pair must be `X.wav` against `X_OFF.wav`.** That is the assertion
 *   that cannot pass by accident, and it is what makes the pairing a fact
 *   rather than an observation about two neighbouring arrays;
 * * the stop file must *not* be shipped. A stop id is a control word, not a
 *   sound, and if the `_OFF` wavs were on disc that reading would be wrong;
 * * a play id listed twice must name the same stopper both times, or the
 *   engine's first-match walk would be deciding the behaviour.
 *
 * It also names the two pairs class 0x30 uses, because those are the ones a
 * regression would be felt in: shoot the chainsaw out of a zombie's hands and
 * the noise has to stop. Their ids are the `PUSH` operands in the exe, and
 * this reads those too.
 */
import { Checker, gameDirOrSkip, hex, openGame } from "../lib/exe_check";
import type { NodeAssetSource } from "../lib/node_io";
import { ExeTables } from "../../src/hod2lib/exetab";

/**
 * `EnemyZombieInitByCharType`'s two character types, the id each plays, and
 * the `PUSH imm32` it is the operand of. `[proved]`
 */
const CLASS30_PLAY: Record<number, [number, number]> = {
  2: [0x004d17a9, 0x00453143],
  3: [0x001f25a9, 0x0045314a],
};
/**
 * ...and `ZombieReleaseWeaponLoopSe`'s stoppers, likewise. `[proved]` The
 * PUSHes are at `0x00456624` and `0x0045662B`: `0x00456620` is inside the
 * `CMP word [ESI+0x1F4], 2` that chooses between them.
 */
const CLASS30_STOP: Record<number, [number, number]> = {
  2: [0x004e17a9, 0x00456624],
  3: [0x002025a9, 0x0045662b],
};

/** The last path segment of a name the exe spells with backslashes. */
const baseName = (name: string): string =>
  name.replace(/\\/g, "/").split("/").pop()!;

/** Every `*.wav` under `dir`, by lower-cased file name. */
async function wavsUnder(source: NodeAssetSource, dir: string): Promise<Set<string>> {
  const out = new Set<string>();
  const walk = async (d: string): Promise<void> => {
    for (const name of await source.list(d)) {
      const path = `${d}/${name}`;
      if (name.toLowerCase().endsWith(".wav")) out.add(name.toLowerCase());
      else if ((await source.list(path).catch(() => [])).length) await walk(path);
    }
  };
  await walk(dir);
  return out;
}

const c = new Checker("looping_se");
const { source, exe } = await openGame(gameDirOrSkip("looping_se"));
const pairs = exe.loopingSe();
const names = exe.seNames();

if (!pairs.length) {
  c.fail("the looping-SE walk found nothing at all");
  c.finish();
}
c.note(`${pairs.length} looping-SE pairs at ${hex(ExeTables.LOOPING_SE_IDS, 8)} `
       + `/ ${hex(ExeTables.LOOPING_SE_STOP_IDS, 8)}`);

// -- 1. the walk and its terminator fill the gap between the two bases ----
//
// `loopingSe` stops on the *play* table's terminator, so a stop table that
// ended sooner would show up as an unresolvable id below rather than here.
// This is the length itself, against the gap between the two bases.
const span = (ExeTables.LOOPING_SE_STOP_IDS - ExeTables.LOOPING_SE_IDS) / 4;
c.ok(pairs.length === span - 1, pairs.length === span - 1
  ? `the walk's ${pairs.length} entries and the terminator exactly fill the `
    + `${span} dwords between the two bases`
  : `${pairs.length} entries walked, but the two bases are ${span} dwords `
    + `apart -- one terminator plus ${span - 1} entries is what a contiguous `
    + "pair of tables would mean");

// -- 2. every id resolves, and 3. every pair is X against X_OFF -----------
const unresolved: string[] = [];
const mismatched: string[] = [];
pairs.forEach(({ play, stop }, i) => {
  const pn = names.get(play);
  const sn = names.get(stop);
  if (pn === undefined) unresolved.push(`entry ${i} play ${hex(play)}`);
  if (sn === undefined) unresolved.push(`entry ${i} stop ${hex(stop)}`);
  if (pn === undefined || sn === undefined) return;
  const want = pn.slice(-4).toLowerCase() === ".wav"
    ? `${pn.slice(0, -4)}_OFF${pn.slice(-4)}` : null;
  if (want === null || want.toLowerCase() !== sn.toLowerCase()) {
    mismatched.push(`entry ${i}: ${pn} paired with ${sn}`);
  }
});
c.ok(!unresolved.length, !unresolved.length
  ? `all ${pairs.length * 2} ids resolve to an SE record`
  : `${unresolved.length} ids do not resolve through g_se_name_list: `
    + unresolved.slice(0, 10).join("; "));
c.ok(!mismatched.length, !mismatched.length
  ? `every one of the ${pairs.length} pairs is X.wav against X_OFF.wav, which `
    + "is what proves the pairing"
  : `${mismatched.length} pairs are not X.wav against X_OFF.wav -- the `
    + "pairing is not index-for-index: " + mismatched.slice(0, 10).join("; "));

// -- 4. the stop file is a control word, not a sound ----------------------
const shipped = await wavsUnder(source, "sound/SE");
if (!shipped.size) {
  c.note("no sound/SE on disc, so the shipped-file half is not asserted here");
} else {
  const stopsOnDisc: string[] = [];
  const playsMissing: string[] = [];
  for (const { play, stop } of pairs) {
    const pn = names.get(play);
    const sn = names.get(stop);
    if (sn && shipped.has(baseName(sn).toLowerCase())) stopsOnDisc.push(sn);
    if (pn && !shipped.has(baseName(pn).toLowerCase())) playsMissing.push(pn);
  }
  c.ok(!stopsOnDisc.length, !stopsOnDisc.length
    ? `none of the ${pairs.length} stop ids names a shipped file -- they are `
      + "control words"
    : `${stopsOnDisc.length} stop ids name a file that IS shipped, so they may `
      + `be sounds after all: ${stopsOnDisc.slice(0, 3).join(", ")}`);
  if (playsMissing.length) {
    c.note(`${playsMissing.length} play ids name a file that is not on disc: `
           + playsMissing.slice(0, 3).join(", "));
  }
}

// -- 5. the duplicates, and why they are harmless -------------------------
//
// Eight of the 44 rows repeat a play id already listed -- the table's own tail
// is a duplicate block. The engine breaks out of the walk on the **first**
// match, so a duplicate is harmless only while both copies name the same
// stopper -- if they disagreed, which row wins would be a fact about the walk
// order and not about the data, and the reading above would be
// underdetermined.
const first = new Map<number, number>();
const contradictions: string[] = [];
pairs.forEach(({ play, stop }, i) => {
  if (!first.has(play)) first.set(play, i);
  const f = first.get(play)!;
  if (f !== i && pairs[f]!.stop !== stop) {
    contradictions.push(`${hex(play)} at ${f} and ${i}`);
  }
});
const dupes = pairs.length - first.size;
c.ok(!contradictions.length, !contradictions.length
  ? `${dupes} play ids repeat, and every repeat names the same stopper, so `
    + "the first-match walk is not load-bearing"
  : `${contradictions.length} repeated play ids name different stoppers, so `
    + "the first-match walk decides the behaviour: "
    + contradictions.slice(0, 10).join("; "));

// -- and the two class 0x30 uses, by index --------------------------------
//
// First match, because that is the one the engine's walk stops at.
const pushOperand = (va: number): number | null =>
  exe.data[exe.v2r(va) ?? -1] === 0x68 ? exe.ru32(va + 1) : null;
for (const ct of Object.keys(CLASS30_PLAY).map(Number)) {
  const [play, playAt] = CLASS30_PLAY[ct]!;
  const [stopWant, stopAt] = CLASS30_STOP[ct]!;
  c.eq(pushOperand(playAt), play,
       `character type ${ct}: EnemyZombieInitByCharType's PUSH at `
       + `${hex(playAt, 8)} plays ${hex(play)}`);
  c.eq(pushOperand(stopAt), stopWant,
       `character type ${ct}: ZombieReleaseWeaponLoopSe's PUSH at `
       + `${hex(stopAt, 8)} plays ${hex(stopWant)}`);
  const i = first.get(play);
  if (i === undefined) {
    c.fail(`character type ${ct}'s ${hex(play)} is not in the looping table `
           + "at all, so it would play as a one-shot");
    continue;
  }
  const stop = pairs[i]!.stop;
  c.ok(stop === stopWant, stop === stopWant
    ? `character type ${ct}: entry ${i}, ${names.get(play)} stopped by `
      + `${names.get(stop)}`
    : `character type ${ct} pairs ${hex(play)} with ${hex(stop)}, but `
      + `ZombieReleaseWeaponLoopSe plays ${hex(stopWant)}`);
}
c.finish();
