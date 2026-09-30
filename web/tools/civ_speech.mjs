/**
 * Does the room wait for a rescued civilian to finish speaking?
 *
 *     node tools/run_test.mjs tools/civ_speech.mjs
 *     CIV_SPEECH_TRACE=1 node tools/run_test.mjs tools/civ_speech.mjs
 *
 * Bug 18: "the port doesn't wait for the civilian to finish speaking -- the
 * game continues, and other zombies appear before the shutter is open", at
 * stage 4 (Original) block 1.
 *
 * The engine has no "wait for the dialogue" opcode. What holds the room is the
 * **camera**: `CivilianUpdate` (`FUN_0048A920`) calls
 * `ActorRegisterCameraPoint` at `0x0048ADB0` every frame, which tail-calls
 * `RegisterForCameraTracking` (`FUN_00408EC0`), and that registers her unless
 * `obj+0x34` bit `0x10000` is set -- which op 0x2C writes from wait bit
 * `0x40000`. While she holds a slot, `CameraDriverSelectMode` (`FUN_00402650`)
 * stays in the tracking mode, `g_camera_free` stays down, and
 * `wait_enemies_alive` (`EvtOpWaitEnemiesAlive44`, `FUN_0045FC10`), which
 * needs it, holds. Her script drops `0x40000` in the block that reopens the
 * shutter, so the room waits for her lines.
 *
 * The port filtered every non-enemy out of the candidate list, so the room
 * handed back the moment her captor died. This plays the stage's own script,
 * camera and actors from the rescue step, kills the captors the way a shot
 * does, and times rescue, dialogue, the civilian's slot, the shutter, the gate
 * and the next spawn.
 *
 * Two cases, in two stages, because the mechanism is the class's and not the
 * room's (L8). Stage 1 block 1 is deliberately **not** one: its civilian's
 * script drops the track bit for the two turn clips between the rescue and her
 * line, so under the same rule its gate can open before she speaks -- which is
 * the exe's rule applied to that script, not a counter-example.
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
import { HitResultCode } from "../src/game/combat/resolve_hit.ts";
import { SpawnScriptedCharacters, SpawnSlotActors }
  from "../src/game/director.ts";
import { G, ResetGameGlobals } from "../src/game/globals.ts";
import { ActorIsEnemy, g_class_handlers } from "../src/game/registry.ts";
import { SetCameraPaths, SetGameTables } from "../src/game/tables.ts";
import { SpawnClass } from "../src/game/spawn_class.ts";
import { Walker } from "../src/script/walker.ts";
import { seekTo } from "../src/script/seek.ts";
import { BUNDLE_ROOT, skipNoBundle } from "./lib/bundle_root.ts";

const TICK = 1 / 60;
const LIVE = { dt: TICK, frames: 1, wall: TICK, frozen: false };
const TRACE = !!process.env.CIV_SPEECH_TRACE;

/**
 * `[name, bundle, block, step, kill frame, frames]`. The step is the rescue's
 * resting address; the kill frame is when the captors are shot, a little
 * after the step's `wait_enemies_alive` is reached.
 */
const CASES = [
  ["stage 4 (Original) block 1", "stage4_original", 1, 1, 240, 900],
  ["stage 2 block 6", "stage2", 6, 3, 150, 800],
];

const file = (b, ext) => join(BUNDLE_ROOT, b, `${b}.${ext}.json`);
if (!CASES.every(([, b]) => existsSync(file(b, "script")))) {
  skipNoBundle("civ_speech");
}

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}`
    + (ok || !detail ? "" : ` -- ${detail}`));
}

/** One case, played. Returns the frame of each thing that happened. */
function play([name, bundle, block, step, killAt, frames]) {
  ResetGameGlobals();
  const script = JSON.parse(readFileSync(file(bundle, "script"), "utf8"));
  const cam = new CamPaths(JSON.parse(readFileSync(file(bundle, "cam"), "utf8")));
  const chars = script.characters;
  const placementAt = new Map(chars.placements.map((p) => [p.at, p]));
  const scope = new Scope("stage");
  const events = new Events();
  const ctx = { events, rng: new Rng(1), walker: null, scope,
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
    showMessage: () => null, endDialogue: () => undefined,
  }, { seed: 1 });
  scriptSys.walker = walker;
  ctx.walker = walker;
  ResetPropContainers();
  world.attach(ctx);
  SetGameTables(chars, script.breakables, script.set_pieces, script.humanoids,
                script.coli, script.civilians);
  SetCameraPaths(cam);
  G.g_players_in_play = 1;
  G.g_player_lives = [9999, 9999];
  G.g_GameMode = script.game_mode;
  if (!seekTo(walker, block, step, 0)) throw new Error(`${name}: seek`);
  world.resync(ctx);

  // The eye the next tick's frame is handed, as the app's `CameraTakeSystem`
  // hands it: the camera the last tick drew. The camera block itself is the
  // port's -- the action ring and the drivers seat it inside `GameUpdate`.
  const seat = () => {
    ctx.view.eye.x = G.g_camera_block_eye.x;
    ctx.view.eye.y = G.g_camera_block_eye.y;
    ctx.view.eye.z = G.g_camera_block_eye.z;
  };
  // Every spawn made once, and a civilian's captors with her -- which is
  // `syncCharacterSpawns`'s rule in app/systems.ts, minus the renderer.
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

  const t = { rescue: -1, dialogue: -1, dialogueEnd: -1, untracked: -1,
              shutterOpen: -1, gate: -1, nextSpawn: -1, nextCamera: -1,
              trackedAtRescue: false };
  let f = 0;
  const log = (s) => { if (TRACE) console.log(`    f${String(f).padStart(4)}  ${s}`); };
  events.on("civilian.rescued", () => { t.rescue = f; log("rescued"); });
  events.on("civilian.dialogue", (d) => {
    const v = script.sound?.messages?.[String(d.group)]?.[0];
    if (t.dialogue < 0) t.dialogue = f;
    t.dialogueEnd = Math.max(t.dialogueEnd, f + (v?.frames ?? 0));
    log(`dialogue ${d.group}, ${v?.frames ?? "?"} frames`);
  });

  let civ = null;
  let shutter = G.g_bHudShutterState;
  const before = new Set();
  seat();
  for (; f < frames; f += 1) {
    walker.tick(TICK);
    if (walker.branch) walker.takeBranch(walker.branch.targets[0]);
    syncPortGlobals(walker, false, ctx.view.eye);
    seat();
    spawn();
    world.update(ctx, LIVE);

    for (const o of G.g_object_list) {
      if (o.despawned || before.has(o.at)) continue;
      before.add(o.at);
      if (o.cls === SpawnClass.Civilian && !civ) civ = o;
      if (t.rescue >= 0 && t.nextSpawn < 0 && ActorIsEnemy(o.cls)) {
        t.nextSpawn = f;
        log(`next enemy 0x${o.at.toString(16)}`);
      }
    }
    // The captors, shot: `ActorKillAll`'s arm for one enemy, which routes the
    // kill through the class's own death chain.
    if (f >= killAt && t.rescue < 0 && f % 10 === 0) {
      for (const o of G.g_object_list) {
        if (o.despawned || o.dead || !o.visible || !ActorIsEnemy(o.cls)) continue;
        if (o.flags & ActorFlag.ShotImmune) continue;
        if (g_class_handlers[o.cls]?.invulnerable?.(o)) continue;
        o.hp = 0; o.dead = true; o.react = null; o.flags |= ActorFlag.Dead;
        o.pendingHit = { bone: 1, result: HitResultCode.Damaged };
      }
    }
    const inSlots = !!civ && G.g_enemy_slots.some((x) => x.occupied === 1
      && x.prop === null && x.at === civ.at);
    // Filed as a candidate by her own update, dealt a slot by the next
    // frame's fill: the slot table is two frames behind what the actors did.
    if (t.rescue >= 0 && f <= t.rescue + 2 && inSlots) t.trackedAtRescue = true;
    if (t.rescue >= 0 && t.untracked < 0 && !inSlots && f > t.rescue) {
      t.untracked = f;
      log("civilian leaves the camera's slots");
    }
    if (G.g_bHudShutterState !== shutter) {
      shutter = G.g_bHudShutterState;
      log(`shutter ${shutter}`);
      if (shutter === 1 && t.rescue >= 0 && t.shutterOpen < 0) t.shutterOpen = f;
    }
    if (t.gate < 0 && (walker.block !== block || walker.step !== step)) {
      t.gate = f;
      log(`walker leaves ${block}/${step} for ${walker.block}/${walker.step}`);
    }
    if (t.gate >= 0 && t.nextCamera < 0 && walker.cam
        && walker.cam.frame > walker.cam.startFrame) {
      t.nextCamera = f;
    }
  }
  return t;
}

for (const c of CASES) {
  const t = play(c);
  const name = c[0];
  console.log(`\n== ${name}: rescue f${t.rescue}, dialogue f${t.dialogue}`
    + `..f${t.dialogueEnd}, civilian untracked f${t.untracked}, shutter `
    + `reopens f${t.shutterOpen}, gate f${t.gate}, next enemy f${t.nextSpawn}`);
  check(`${name}: the captors die and she is rescued`, t.rescue >= 0);
  check(`${name}: she speaks`, t.dialogue >= t.rescue && t.rescue >= 0);
  check(`${name}: a rescued civilian holds a camera slot`, t.trackedAtRescue);
  check(`${name}: ...until after her lines`,
        t.untracked >= t.dialogue && t.dialogue >= 0,
        `untracked f${t.untracked}, dialogue f${t.dialogue}`);
  check(`${name}: the room-clear gate holds until she lets the camera go`,
        t.gate > t.untracked && t.untracked >= 0,
        `gate f${t.gate}, untracked f${t.untracked}`);
  check(`${name}: ...which is after her script reopens the shutter`,
        t.shutterOpen >= 0 && t.gate >= t.shutterOpen,
        `gate f${t.gate}, shutter f${t.shutterOpen}`);
  check(`${name}: no new enemy walks in while she is speaking`,
        t.dialogueEnd >= 0 && (t.nextSpawn < 0 || t.nextSpawn > t.dialogueEnd),
        `next enemy f${t.nextSpawn}, her last line ends f${t.dialogueEnd}`);
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
