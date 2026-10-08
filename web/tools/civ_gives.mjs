/**
 * Does a rescued civilian hand over what she is holding?
 *
 *     node tools/run_test.mjs tools/civ_gives.mjs
 *     CIV_GIVES_TRACE=1 node tools/run_test.mjs tools/civ_gives.mjs
 *
 * Bug: "rescued civilians ... still carry it after you should receive its
 * effect (e.g. extra life). The effect doesn't seem to apply either".
 *
 * `CivilianDrawHeldItems` (`FUN_0048CD10`) calls each held record's `rec+0x18`
 * after drawing it, and the record's routine pays when the entry's operand
 * (`0x800000` in every shipped op 0x13/0x14) turns up in the wait word:
 * `CivilianHeldItemGrantLife` (`FUN_0048DCC0`) a life through `GrantExtraLife`,
 * `CivilianHeldItemGrantOriginalItem` (`FUN_0048DD60`) an Original Mode item
 * into `g_original_items_taken` and a banner. Then the draw drops the entry.
 * See `game/class10/items.ts`.
 *
 * `civilians.mjs` cannot see it: its camera is parked five thousand units
 * away, and every giving stream walks to the camera first. This plays each
 * giving civilian's own stage from the evt step that spawns her -- the walker,
 * the camera and the actors, as `civ_speech.mjs` does -- shoots her captors
 * as player 0 once they are placed, and watches for the give.
 *
 * Every civilian the survey below names is found from the bundle: the spawn's
 * stream (following on-shot and resume pointers) must append an item, and the
 * step is the one whose spawn op names her.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CameraFrame } from "../src/core/camera.ts";
import { Events } from "../src/core/events.ts";
import { Rng } from "../src/core/rng.ts";
import { Scope } from "../src/core/scope.ts";
import { World } from "../src/core/world.ts";
import { GameSystem, ScriptSystem, syncPortGlobals }
  from "../src/app/systems.ts";
import { ResetPropContainers } from "../src/game/class41/index.ts";
import { CamPaths } from "../src/game/camera/curve.ts";
import { ActorFlag } from "../src/game/actor.ts";
import { DispatchHit, HEAD_BONE } from "../src/game/combat/resolve_hit.ts";
import { SpawnScriptedCharacters, SpawnSlotActors }
  from "../src/game/director.ts";
import { G, ResetGameGlobals } from "../src/game/globals.ts";
import { ActorIsEnemy, g_class_handlers } from "../src/game/registry.ts";
import { SetCameraPaths, SetGameTables } from "../src/game/tables.ts";
import { SpawnClass } from "../src/game/spawn_class.ts";
import { CivilianItemCallback } from "../src/game/class10/items.ts";
import { Walker } from "../src/script/walker.ts";
import { seekTo } from "../src/script/seek.ts";
import { NULL_HOST } from "../src/game/host.ts";
import { BUNDLE_ROOT, skipNoBundle } from "./lib/bundle_root.ts";

const TICK = 1 / 60;
const LIVE = { dt: TICK, frames: 1, wall: TICK, frozen: false };
const TRACE = !!process.env.CIV_GIVES_TRACE;
/** Frames to play from the spawn step. */
const FRAMES = 3600;
/** The player every shot here is fired as. */
const SHOOTER = 0;

const file = (b, ext) => join(BUNDLE_ROOT, b, `${b}.${ext}.json`);
/**
 * Both modes: four of the Original Mode items are only in the Original arm of
 * an op 0x1F (`SetResumeByMode`), so an Arcade run resumes past them and the
 * civilian leaves empty-handed -- which is the exe's stream, not a miss.
 */
const BUNDLES = [1, 2, 3, 4, 5, 6].flatMap((n) => [`stage${n}`,
                                                  `stage${n}_original`]);
if (!BUNDLES.some((b) => existsSync(file(b, "script")))) {
  skipNoBundle("civ_gives");
}

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}`
    + (ok || !detail ? "" : ` -- ${detail}`));
}

/** Every stream a spawn can run: its own, and those its pointers name. */
function streamsOf(civ, entry) {
  const seen = new Set();
  const todo = [civ.entries[entry]];
  while (todo.length) {
    const k = todo.pop();
    if (k === undefined || k < 0 || seen.has(k)) continue;
    seen.add(k);
    for (const c of civ.scripts[k] ?? []) {
      for (const j of c.scripts ?? []) todo.push(j);
    }
  }
  return [...seen];
}

/** The records a spawn's streams can append, by op 0x13 or 0x14. */
function appendedRecords(civ, entry) {
  const recs = new Set();
  for (const k of streamsOf(civ, entry)) {
    for (const c of civ.scripts[k] ?? []) {
      if (c.op === 0x13 && c.item !== undefined) recs.add(c.item);
      if (c.op === 0x15) for (const [, r] of c.itemTable ?? []) recs.add(r);
    }
  }
  const appends = streamsOf(civ, entry).some((k) =>
    (civ.scripts[k] ?? []).some((c) => c.op === 0x13 || c.op === 0x14));
  return appends ? [...recs] : [];
}

/** `(block, step)` of the evt op that spawns `at`, or null. */
function spawnStep(script, at) {
  for (const [bi, b] of (script.blocks ?? []).entries()) {
    for (const [si, st] of (b?.steps ?? []).entries()) {
      for (const op of st?.ops ?? []) {
        if ((op.spawns ?? []).some((s) => s.at === at)) return [bi, si];
      }
    }
  }
  return null;
}

/** One civilian, played from her spawn step. */
function play(bundle, at) {
  ResetGameGlobals();
  const script = JSON.parse(readFileSync(file(bundle, "script"), "utf8"));
  const cam = new CamPaths(JSON.parse(readFileSync(file(bundle, "cam"), "utf8")));
  const where = spawnStep(script, at);
  if (!where) return { error: "no spawn step" };
  const [block, step] = where;
  const chars = script.characters;
  const placementAt = new Map(chars.placements.map((p) => [p.at, p]));
  const scope = new Scope("stage");
  const events = new Events();
  const rng = new Rng(1);
  const ctx = { events, rng, walker: null, scope,
                session: scope.child("session"), view: new CameraFrame(),
                stage: 0, frame: 0 };
  const world = new World();
  const scriptSys = new ScriptSystem();
  world.add("script", scriptSys);
  world.add("game", new GameSystem());
  const walker = new Walker(script, {
    enterRegion: () => undefined, loadSlot: () => undefined,
    unloadSlot: () => undefined, startCamera: () => undefined,
    onFeed: () => undefined, onBranch: () => undefined,
    playSound: () => undefined,
    aliveEnemies: () => G.g_enemies_alive,
    presentEnemies: () => G.g_enemies_present,
    aliveCivilians: () => G.g_civilians_alive,
    scriptFlagRaised: (i) => (G.g_script_flags[i] ?? 0) !== 0,
    cameraFree: () => G.g_camera_free !== 0,
    showMessage: () => null,
  }, { seed: 1 });
  scriptSys.walker = walker;
  ctx.walker = walker;
  ResetPropContainers();
  world.attach(ctx);
  SetGameTables(chars, script.breakables, script.set_pieces, script.humanoids,
                script.coli, script.civilians);
  SetCameraPaths(cam);
  G.g_players_in_play = 1;
  G.g_GameMode = script.game_mode;
  if (!seekTo(walker, block, step, 0)) return { error: `seek ${block}/${step}` };
  world.resync(ctx);

  const seat = () => {
    ctx.view.eye.x = G.g_camera_block_eye.x;
    ctx.view.eye.y = G.g_camera_block_eye.y;
    ctx.view.eye.z = G.g_camera_block_eye.z;
  };
  const made = new Set();
  const spawn = () => {
    const reqs = [];
    for (const s of walker.spawns) {
      if (made.has(s.at)) continue;
      const pl = placementAt.get(s.at);
      if (!pl) continue;
      made.add(s.at);
      const pos = s.pos ?? pl.pos ?? [0, 0, 0];
      reqs.push({ at: s.at, motion: pl.motion ?? 0,
                  pos: { x: pos[0], y: pos[1], z: pos[2] } });
    }
    const listed = new Set(walker.spawns.map((s) => s.at));
    for (const pl of chars.placements) {
      const parent = pl.civilian_child ?? pl.parent_at;
      if (parent == null || !listed.has(parent) || made.has(pl.at)) continue;
      made.add(pl.at);
      const pos = pl.pos ?? [0, 0, 0];
      reqs.push({ at: pl.at, motion: pl.motion ?? 0, parentAt: parent,
                  pos: { x: pos[0], y: pos[1], z: pos[2] } });
    }
    SpawnScriptedCharacters(reqs);
    SpawnSlotActors(walker.spawns);
  };

  const r = { block, step, rescue: -1, give: -1, heldFrom: -1, record: -1,
              lives: [-1, -1], livesAfter: [-1, -1], taken: null,
              takenAfter: null, banners: 0, markers: [], heldAfter: -1,
              drawnOnGive: "", drawnAfter: "", payee: -2 };
  events.on("civilian.rescued", (d) => {
    if (d.at === at && r.rescue < 0) { r.rescue = f; r.payee = d.player; }
  });
  let civ = null;
  let f = 0;
  seat();
  for (; f < FRAMES; f += 1) {
    walker.tick(TICK);
    if (walker.branch) walker.takeBranch(walker.branch.targets[0]);
    syncPortGlobals(walker, false, ctx.view.eye);
    seat();
    spawn();
    civ ??= G.g_object_list.find((o) => o.at === at
                                  && o.cls === SpawnClass.Civilian) ?? null;
    // Every enemy in the room, shot by player 0 the way a shot kills (L49):
    // through `DispatchHit`, which writes the killer's byte the prune reads.
    // Not only her captors -- several giving streams wait on
    // `g_enemies_alive` or `g_enemies_present` after the rescue, which is a
    // room a player has cleared.
    for (const o of G.g_object_list) {
      if (o.despawned || (o.flags & ActorFlag.Dead)) continue;
      if (!o.visible || !ActorIsEnemy(o.cls)) continue;
      if (g_class_handlers[o.cls]?.invulnerable?.(o)) continue;
      for (let s = 0; s < 60 && !(o.flags & ActorFlag.Dead); s++) {
        if (!DispatchHit(o, HEAD_BONE, NULL_HOST, rng, SHOOTER)) break;
      }
    }
    const before = civ?.civ ? civ.civ.items.map((e) => e.record) : [];
    if (before.length && r.heldFrom < 0) {
      r.heldFrom = f;
      r.record = before[0];
    }
    if (before.length) {
      r.lives = [...G.g_player_lives];
      r.taken = [...G.g_original_items_taken];
      r.banners = G.g_original_item_banners.length;
    }
    world.update(ctx, LIVE);
    if (TRACE && civ?.civ && f % 60 === 0) {
      const eye = G.g_camera_block_eye;
      const d = Math.hypot(civ.pos.x - eye.x, civ.pos.z - eye.z);
      console.log(`    f${f} cursor ${civ.civ.cursor} wait `
                  + `0x${(civ.civ.wait >>> 0).toString(16)} 2D to eye `
                  + `${d.toFixed(1)} r ${civ.civ.radius} `
                  + `${civ.despawned ? "despawned" : ""}`);
    }
    if (civ?.civ && before.length && civ.civ.items.length < before.length
        && r.give < 0) {
      r.give = f;
      r.livesAfter = [...G.g_player_lives];
      r.takenAfter = [...G.g_original_items_taken];
      r.markers = G.g_life_granted_markers.map((m) => ({ ...m }));
      r.bannerAdded = G.g_original_item_banners.length > r.banners
        ? G.g_original_item_banners.at(-1).sprite : null;
      r.drawnOnGive = JSON.stringify(civ.civ.heldDrawn);
      if (TRACE) console.log(`    f${f} give: lives ${r.lives} -> `
                             + `${r.livesAfter}`);
    }
    if (r.give >= 0 && f === r.give + 1) {
      r.drawnAfter = JSON.stringify(civ?.civ?.heldDrawn ?? []);
    }
    if (r.give >= 0 && f > r.give + 2) break;
  }
  r.heldAfter = civ?.civ?.items.length ?? -1;
  scope.dispose();
  return r;
}

const lifeAt = [];
const originalAt = [];
for (const b of BUNDLES) {
  if (!existsSync(file(b, "script"))) continue;
  const script = JSON.parse(readFileSync(file(b, "script"), "utf8"));
  const civ = script.civilians;
  if (!civ?.spawns) continue;
  for (const [at, rec] of Object.entries(civ.spawns)) {
    const recs = appendedRecords(civ, rec.script);
    if (!recs.length) continue;
    const kinds = recs.map((k) => civ.items[k]?.callback);
    const row = { bundle: b, at: Number(at), recs, script };
    if (kinds.every((k) => k === CivilianItemCallback.GrantLife)) {
      lifeAt.push(row);
    } else {
      originalAt.push(row);
    }
  }
}

console.log(`${lifeAt.length} civilians hold record 0x0056B190 (the life), `
            + `${originalAt.length} hold an Original Mode item`);
const arcadeLife = lifeAt.filter((r) => !r.bundle.endsWith("_original"))
  .map((r) => `${r.bundle}:${r.at.toString(16)}`).sort().join();
check("the survey finds the five life-givers the exe's streams name "
      + "(stage 1 0x3C38, stage 2 0x51AC, 0x9FE8 and 0x12714, stage 4 0x10FC)",
      arcadeLife
      === "stage1:3c38,stage2:12714,stage2:51ac,stage2:9fe8,stage4:10fc",
      arcadeLife);

/**
 * The four whose item is only in the **second** arm of an op 0x1F
 * (`SetResumeByMode`) -- stage 2's `0x8510` (stream 27 -> 25 or 26), `0x1158C`
 * and `0x12098` (54 -> 52 or 53) and stage 4's `0x23F8` (82 -> 80 or 81) --
 * in both modes. `CivilianRunScript` takes that arm when `DAT_009A2226`
 * equals the switch's `DX` (`0x0048BF79`), which is `[open]`, and the port
 * takes the first; so these resume past their item and leave empty-handed.
 * A count that moves here is that reading landing, not this harness breaking.
 */
const BEHIND_RESUME_BY_MODE = new Set([
  "stage2:8510", "stage2:1158c", "stage2:12098", "stage4:23f8",
  "stage2_original:8510", "stage2_original:1158c", "stage2_original:12098",
  "stage4_original:23f8",
]);

let gave = 0;
const missed = [];
for (const row of [...lifeAt, ...originalAt]) {
  const name = `${row.bundle} civilian 0x${row.at.toString(16)}`;
  const r = play(row.bundle, row.at);
  if (r.error) {
    check(`${name}: plays`, false, r.error);
    continue;
  }
  const rec = row.script.civilians.items[r.record];
  const life = rec?.callback === CivilianItemCallback.GrantLife;
  console.log(`\n== ${name} (evt ${r.block}/${r.step}): holds record `
              + `${r.record} from f${r.heldFrom}, rescued f${r.rescue}, `
              + `gives f${r.give}; lives ${r.lives.join("/")} -> `
              + `${r.livesAfter.join("/")}`);
  if (r.give < 0) {
    missed.push(`${row.bundle}:${row.at.toString(16)}`);
    console.log(`  --    never reached its give in ${FRAMES} frames`);
    continue;
  }
  gave += 1;
  check(`${name}: she stops holding it on the frame it is given`,
        r.heldAfter === 0 && r.drawnAfter === "[]",
        `items left ${r.heldAfter}, drawn next frame ${r.drawnAfter}`);
  check(`${name}: ...having been drawn in her hand that frame`,
        r.drawnOnGive !== "[]" && r.drawnOnGive !== "",
        `drawn ${r.drawnOnGive}`);
  if (life) {
    const up = r.livesAfter[SHOOTER] - r.lives[SHOOTER];
    check(`${name}: the life is paid, to the player in play`,
          up === 1 && r.livesAfter[1] === r.lives[1],
          `lives ${r.lives.join("/")} -> ${r.livesAfter.join("/")}`);
    check(`${name}: ...with player 0's marker`,
          r.markers.length === 1 && r.markers[0].slot === 0x1256,
          JSON.stringify(r.markers));
  } else {
    check(`${name}: record ${r.record} (kind ${rec?.kind}) is counted into `
          + "g_original_items_taken and bannered, and pays no life",
          r.takenAfter?.[rec.kind] === (r.taken?.[rec.kind] ?? 0) + 1
          && r.bannerAdded === rec.banner
          && r.livesAfter.join() === r.lives.join(),
          `taken ${r.taken?.[rec.kind]} -> ${r.takenAfter?.[rec.kind]}, `
          + `banner ${r.bannerAdded} want ${rec.banner}`);
  }
}

console.log(`\n${gave} of ${lifeAt.length + originalAt.length} gave`);
check("every life-giver in both modes hands the life over",
      lifeAt.every((r) => !missed.includes(
        `${r.bundle}:${r.at.toString(16)}`)),
      missed.join());
check("...and every Original Mode item does too, but the four behind op "
      + "0x1F's second arm",
      missed.length === BEHIND_RESUME_BY_MODE.size
      && missed.every((m) => BEHIND_RESUME_BY_MODE.has(m)),
      `missed ${missed.join()}`);
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
