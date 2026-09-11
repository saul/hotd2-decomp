/**
 * Does stage 3 place its seven class-0x41 type-43 props, and can they be shot?
 *
 *     node --experimental-strip-types tools/run_test.mjs tools/props43.mjs \
 *          [stage] [block] [step] [seconds]
 *
 * Drives the real `Walker` over the real bundle with `script.breakables`
 * wired, which is what `app/main.ts` does — and what `tools/lifetime.mjs`
 * does **not**: that harness passes `undefined` for the breakables table, so
 * no prop of any family can appear in it and its silence about them says
 * nothing. This one exists because the browser said "breakables: none placed"
 * for stage 3 and the question needed an answer that was not a screenshot.
 *
 * The shot is applied the way `ProcessPlayerShots` applies one — the two hit
 * bits on `obj+0x34`, and the pool's own frame resolves them — because that is
 * the seam the routine reads. Nothing here calls into `PropUpdateType43`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUNDLE_ROOT } from "./lib/bundle_root.ts";
import { Rng } from "../src/core/rng.ts";
import { Events } from "../src/core/events.ts";
import { GameUpdate } from "../src/game/director.ts";
import { G, ResetGameGlobals } from "../src/game/globals.ts";
import { SetGameTables } from "../src/game/tables.ts";
import { Walker } from "../src/script/walker.ts";
import { seekTo } from "../src/script/seek.ts";
import { NULL_HOST } from "../src/game/host.ts";
import { vec3 } from "../src/game/vec.ts";
import { BreakableFlag, PropFamily } from "../src/game/class41/prop_state.ts";

const args = process.argv.slice(2)
  .filter((a) => !a.endsWith(".mjs") && !a.endsWith(".ts"));
const [stage = "3", block = "0", step = "3", seconds = "4"] = args;
const script = JSON.parse(readFileSync(
  join(BUNDLE_ROOT, `stage${stage}`, `stage${stage}.script.json`), "utf8"));

ResetGameGlobals();
SetGameTables(script.characters, script.breakables, script.set_pieces,
              script.humanoids, script.coli, script.civilians);
G.g_players_in_play = 1;
G.g_player_lives = [2, 2];

const NOOP = () => undefined;
const walker = new Walker(script, {
  enterRegion: NOOP, loadSlot: NOOP, unloadSlot: NOOP,
  startCamera: NOOP, onFeed: NOOP, onBranch: NOOP,
  playSound: NOOP, aliveEnemies: () => G.g_enemies_alive,
  presentEnemies: () => G.g_enemies_present, aliveCivilians: () => null,
  scriptFlagRaised: () => null,
  cameraFree: () => null, setShutter: NOOP, showMessage: NOOP,
  endDialogue: NOOP,
});
const rng = new Rng(7);
const events = new Events();
const eye = vec3(0, 0, 0);
seekTo(walker, { block: Number(block), step: Number(step) }, rng);

let failures = 0;
const check = (what, ok, note = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${note ? ` -- ${note}` : ""}`);
  if (!ok) failures += 1;
};

const seen = new Map();
const record = () => {
  for (const p of G.g_breakable_props) {
    if (p.family === PropFamily.Type43) seen.set(p.at, p);
  }
};
record();
for (let i = 0; i < Number(seconds) * 60; i += 1) {
  walker.tick(1 / 60);
  GameUpdate(eye, 1 / 60, NULL_HOST, rng, events);
  record();
}

console.log(`stage ${stage}, seeked to block ${block} step ${step}`);
console.log(`${seen.size} type-43 props seen: `
  + ([...seen.values()].map((p) => `${p.at.toString(16)} kind ${p.kind}`)
    .join(", ") || "none"));
check("stage 3's script places type-43 props at all", seen.size > 0,
      `${seen.size}`);

const live = G.g_breakable_props.filter((p) => p.family === PropFamily.Type43);
if (live.length) {
  const p = live[0];
  const slot0 = p.slot;
  const score0 = G.g_player_score[0];
  let shots = 0;
  for (let i = 0; i < 8 && !p.dead && p.effectFrames === 0; i += 1) {
    p.flags |= BreakableFlag.Hit | BreakableFlag.HitByPlayer0;
    walker.tick(1 / 60);
    GameUpdate(eye, 1 / 60, NULL_HOST, rng, events);
    shots += 1;
  }
  console.log(`  kind ${p.kind}: ${shots} shot(s), slot `
    + `${slot0.toString(16)} -> ${p.slot.toString(16)}, `
    + `+${G.g_player_score[0] - score0} points`);
  check("a type-43 prop in the real bundle breaks when it is shot",
        p.effectFrames > 0, `effectFrames ${p.effectFrames}`);
  check("...and paid for the shot that destroyed it",
        G.g_player_score[0] > score0, `+${G.g_player_score[0] - score0}`);
  check("...one shot for a kind 2 and two for a kind 3",
        p.kind === 3 ? shots === 2 : shots === 1,
        `${shots} for kind ${p.kind}`);
} else {
  check("a type-43 prop is alive to shoot", false);
}

console.log(failures ? `\n${failures} failed` : "\nclean");
process.exit(failures ? 1 : 0);
