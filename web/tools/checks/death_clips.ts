/**
 * Every clip a class-0x30 death can play is baked for that spawn's character.
 *
 *     cd web && node tools/run_ts.mjs tools/checks/death_clips.ts
 *     HOTD2_BUNDLE=/path/to/export node tools/run_ts.mjs tools/checks/death_clips.ts
 *
 * `ChooseDeathMotion` (`FUN_004560B0`) is the only thing that writes
 * `obj+0x1B4` on a dying zombie, and it has **ten** arms: the directional
 * pick, `ChooseDeathMotionDirectional` (`FUN_00456220`), whose two tables live
 * in the EXE and whose other two arms are the literals 991 and 992, and the
 * arms in {@link DEATH_ARMS}.
 *
 * **Why an unbaked death clip is not a cosmetic gap.** `ZombieStateDeath6`
 * (`FUN_00454D20`) sub 2 leaves on `g_motion_play_length[obj+0x1B4] - 1 <=
 * obj+0x19C`, and `ZombieStateDeathFallAndBounce` (`FUN_00456DF0`) sub 1
 * leaves on `obj+0x19C >= 0x3C`. With no clip the port's `MotionPlayFrame`
 * answers 0 for ever:
 *
 * * the `>= play - 1` wait passes at once, because `play` is 0 too -- so a
 *   condition-4 crawler snaps straight to a corpse with no animation, which
 *   looks like a fast death and not like a missing asset (40 shipped
 *   placements, stage 2's `znkager`, clips `0x404` and `0x41A`);
 * * the `>= 0x3C` wait **never** passes, because 0x3C is a literal. So an
 *   actor that dies holding something -- `obj+0x34` bit `0x1000000`, clip
 *   `0x3F9`, whose real play length is 85 -- can never leave state 12,
 *   `ZombieEnterCorpseState` never runs, `ReleaseEnemyPresentCount`
 *   (`FUN_00456580`) never runs, and `g_enemies_present` never falls: a
 *   `wait_scripted_actors` behind it hangs the stage.
 *
 * **It reads the bundle, not the exporter.** A check that asked the exporter
 * would go green on a fix that never reached a byte the player loads, which is
 * `L24`.
 *
 * **The blind spot, written down rather than left implicit.** The four
 * destroyed-part arms -- `obj+0x1368` bits `0x8`, `0x10`, `0x40`, `0x80`
 * giving clips `0x1AC`, `0x1A5`, `0x279`, `0x229` -- are **not** demanded. All
 * four decode at 16 bones, so they are bakeable; nothing in the ported call
 * graph raises any of those bits, because `ZombieStateTargetMotionScript` and
 * `ZombieStateDragTarget` set them from a kill-move clip id the port does not
 * model. Demanding them would be demanding four clips for arms no actor can
 * take. When one of those bits gets a writer, its clip goes in
 * `CLASS30_DEATH_CLIPS` and in {@link PART_DEATH_CLIPS} on the same day -- and
 * until then this check is agreeing to miss them, which is the shape of gap
 * `tools/checks/prop_slots.ts` names as its own blind spot.
 *
 * One assertion per bundle when every pair is baked, and one failure per
 * (spawn, clip) pair that is not. Exit 3 without a bundle.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { BUNDLE_ROOT, EXIT_SKIPPED } from "../lib/bundle_root";
import { Checker, argValue } from "../lib/exe_check";

type Json = any;

/** Class 0x30. Not a magic number twice: `spawns.md` names it. */
const CLASS_ZOMBIE = 0x30;

/**
 * `obj+0x34` bit `0x1000000`, seeded from the spawn record's `+0x04` init
 * flags, which the engine ORs with 1 into `obj+0x34`. `ChooseDeathMotion`
 * tests it at `0x004560DD` and `ZombieStateDeath6` at `0x00454DB8`.
 */
const HOLDING = 0x1000000;

/**
 * The arms above the directional pick, and the condition that reaches each.
 *
 * None has a static gate -- body condition is recomputed every frame by
 * `ActorBodyConditionFromHands` (`FUN_00455920`) as parts come off, and the
 * holding bit has a runtime writer as well as the descriptor -- so **every**
 * class-0x30 character type is asked for all of them. That is not
 * belt-and-braces: character type 19's own spawn records do not set
 * {@link HOLDING}, and its zombies die holding all the same.
 */
const DEATH_ARMS: ReadonlyArray<readonly [number, string]> = [
  [0x3da, "body condition 4 with obj+0x136C bits 0x2000000 and 0x8000000"],
  [0x3db, "conditions 5-6, and char types 0xF..0x11 while carried"],
  [0x3f8, "ZombieStateDeathFallAndBounce's landing clip"],
  [0x3f9, "obj+0x34 bit 0x1000000 -- and the way out of state 12"],
  [0x404, "body condition 4's coin toss, even draw"],
  [0x41a, "body condition 4's coin toss, odd draw"],
];

/**
 * The four arms this check deliberately does not demand. Named so that the
 * gap is a list rather than a silence -- see the module comment.
 */
const PART_DEATH_CLIPS: readonly number[] = [0x1ac, 0x1a5, 0x279, 0x229];

const HEX3 = (v: number): string => `0x${v.toString(16).toUpperCase().padStart(3, "0")}`;

/** A JSON scalar as the messages spell it: `None` for a missing value. */
function py(v: unknown): string {
  if (v === undefined || v === null) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  return String(v);
}

/** The motion ids a character type carries, whether keyed or listed. */
function motionIds(motions: Json): Set<number> {
  const keys: unknown[] = Array.isArray(motions) ? motions : Object.keys(motions);
  return new Set(keys.map((k) => Number.parseInt(String(k), 10)));
}

const bundle = argValue("bundle") ?? BUNDLE_ROOT;
const manifest = join(bundle, "manifest.json");
if (!existsSync(manifest)) {
  console.log(`SKIP  death_clips: no bundle at ${bundle}`);
  console.log("      build one with `cd web && npm run export -- --game-dir ...`,"
              + " or point HOTD2_BUNDLE at one");
  process.exit(EXIT_SKIPPED);
}

const c = new Checker("death_clips");
c.note("every clip a class-0x30 death can play, in the bundle it plays from");
let checked = 0;
let failed = 0;
let spawns = 0;
let holding = 0;
let bundles = 0;
const types = new Set<string>();

for (const entry of JSON.parse(readFileSync(manifest, "utf8")).stages) {
  const name: string = entry.name;
  const script = join(bundle, name, entry.script);
  if (!existsSync(script)) {
    c.fail(`${name}: the manifest names a script that is not there`);
    failed++;
    continue;
  }
  bundles++;
  const chars = JSON.parse(readFileSync(script, "utf8")).characters;
  const byType = chars.types;
  // The directional set, read out of the bundle rather than out of the EXE:
  // it is what the port's `DeathArcMotion` indexes, and asking
  // the bundle is what makes this a check on the bundle.
  const directional: number[] = [
    ...chars.deaths.front.map(Number), ...chars.deaths.back.map(Number), 991, 992,
  ];

  const bad: string[] = [];
  let here = 0;
  let spawnsHere = 0;
  for (const pl of chars.placements) {
    if (pl.class !== CLASS_ZOMBIE) continue;
    spawns++;
    spawnsHere++;
    const ct = pl.char_type;
    const row = Object.hasOwn(byType, String(ct)) ? byType[String(ct)] : undefined;
    if (row === undefined || row === null) {
      // A class-0x30 spawn whose character type the exporter could not build.
      // Reported rather than skipped: the same defect one step earlier, and
      // it would hide every clip below it.
      bad.push(`${name}: spawn at ${py(pl.at)} is character type ${ct}, which is not in the bundle`);
      continue;
    }
    types.add(`${name}\0${ct}`);
    const have = motionIds(row.motions);
    if ((pl.init_flags ?? 0) & HOLDING) holding++;
    const want: [number, string][] = [
      ...directional.map((m): [number, string] => [m, "the directional pick"]),
      ...DEATH_ARMS.map(([m, why]): [number, string] => [m, why]),
    ];
    for (const [mid, why] of want) {
      here++;
      if (!have.has(mid)) {
        bad.push(`${name}: spawn at ${py(pl.at)} is character type ${ct} (${row.name}), and `
                 + `motion ${mid} (${HEX3(mid)}) -- ${why} -- is not baked for it`);
      }
    }
  }
  checked += here;
  failed += bad.length;
  if (!bad.length) {
    c.ok(true, `${name}: all ${here} (spawn, death clip) pairs baked over ${spawnsHere} `
               + "class-0x30 spawns");
  }
  for (const line of bad) c.fail(line);
}

if (!bundles) {
  console.log("SKIP  death_clips: the manifest names no stages");
  c.finish();
}

c.note(`${bundles} bundles: ${checked - failed} of ${checked} (spawn, death clip) pairs `
       + `baked over ${spawns} class-0x30 spawns and ${types.size} (bundle, character type) pairs`);
c.note(`${holding} of those spawns carry obj+0x34 bit 0x1000000 from their own record, `
       + "so the engine sends them to state 12");
c.note(`not demanded: the ${PART_DEATH_CLIPS.length} destroyed-part arms `
       + `${PART_DEATH_CLIPS.map(HEX3).join(", ")} -- see the module comment`);
c.finish();
