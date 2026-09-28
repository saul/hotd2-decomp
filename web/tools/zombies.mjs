/**
 * Trace every class-0x30 actor in one scene, frame by frame.
 *
 *     node tools/run_test.mjs tools/zombies.mjs [stage] [block] [step] [op] [secs] [kill]
 *
 * Prints, per enemy, every distinct (state/sub/permit/rank/distance) it passes
 * through -- which is the only way to tell "waiting for a permit nobody holds"
 * apart from "waiting for a permit a corpse still owns", and the only way to
 * see a death that is deferred to the end of a swing.
 *
 * `kill` is `first`, `nearest`, or a decimal `at`: that actor is shot in the
 * head until it dies, two seconds in.
 *
 * The default is stage 1's block-9 hostage room: civilian `0x4AE4`, placed by
 * the `spawn_obj_c` at step 2 op 2, and her three captors. It seeks to op 7,
 * the `wait_script_flag` her own stream opens, and **not** to op 8, the enemy
 * gate behind it, which is where it used to point: a seek that steps over a
 * flag gate retires the civilian whose stream raises that flag
 * (`Walker.retireFlagRaisers`), because in play her rescue is already behind
 * her. Seeked to op 8 the room is empty and its gate opens on the first frame.
 */
import { readFileSync } from "node:fs";
import { hasBundle, skipNoBundle, stageFile } from "./lib/bundle_root.ts";
import { Rng } from "../src/core/rng.ts";
import { PlayerTasksRun } from "../src/game/player_shell.ts";
import { Events } from "../src/core/events.ts";
import { GameUpdate, SpawnScriptedCharacters, SpawnPropContainers }
  from "../src/game/director.ts";
import { G, ResetGameGlobals } from "../src/game/globals.ts";
import { NULL_HOST } from "../src/game/host.ts";
import { SetCameraPaths, SetGameTables, CharacterTypeOf }
  from "../src/game/tables.ts";
import { CamPaths } from "../src/game/camera/curve.ts";
import { syncPortGlobals } from "../src/app/systems.ts";
import { ActorIsEnemy } from "../src/game/registry.ts";
import { SpawnClass } from "../src/game/spawn_class.ts";
import { vec3 } from "../src/game/vec.ts";
import { Walker } from "../src/script/walker.ts";
import { seekTo } from "../src/script/seek.ts";
import { ResolveHit } from "../src/game/combat/resolve_hit.ts";

const args = process.argv.slice(2)
  .filter((a) => !a.endsWith(".mjs") && !a.endsWith(".ts"));
const stage = Number(args[0] ?? 1);
const block = Number(args[1] ?? 9);
const step = Number(args[2] ?? 2);
const op = Number(args[3] ?? 7);
const secs = Number(args[4] ?? 20);
const killWho = args[5] ?? "";

if (!hasBundle()) skipNoBundle("zombies");
const script = JSON.parse(readFileSync(stageFile(stage, "script"), "utf8"));
const chars = script.characters;
const placementAt = new Map(chars.placements.map((p) => [p.at, p]));

ResetGameGlobals();
SetGameTables(chars, undefined, undefined, undefined, script.coli,
              script.civilians);
// The camera paths, as `handback.mjs` loads them: the action ring and the
// camera actor inside `GameUpdate` write `g_active_cam_path`,
// `g_cam_path_frame` and the scene-state stamp from them, and every
// camera-cued wait and entrance reads those.
SetCameraPaths(new CamPaths(JSON.parse(readFileSync(stageFile(stage, "cam"),
                                                    "utf8"))));
// In play through the ported routines, not by hand (L49): the reset
// started the game from the title, and this is the first player turn.
PlayerTasksRun({ host: NULL_HOST, rng: new Rng(1) });
const rng = new Rng(1);
const events = new Events();

let eye = vec3(0, 6, 0);
const host = {
  ...NULL_HOST,
  aliveEnemies: () => G.g_enemies_alive,
  viewSpaceOf: (at, out) => {
    const a = G.g_object_list.find((o) => o.at === at);
    if (!a) return false;
    out.x = a.pos.x - eye.x;
    out.y = a.pos.y - eye.y;
    out.z = -(a.pos.z - eye.z);
    return true;
  },
  viewPoint: (x, y, z, out) => {
    out.x = eye.x + x; out.y = eye.y + y; out.z = eye.z - z;
  },
};

const walker = new Walker(script, {
  enterRegion() {}, loadSlot() {}, unloadSlot() {}, startCamera() {},
  onFeed() {}, onBranch() {}, playSound() { return undefined; },
  aliveEnemies: () => G.g_enemies_alive,
  presentEnemies: () => G.g_enemies_present,
  aliveCivilians: () => G.g_civilians_alive,
  scriptFlagRaised: (i) => (G.g_script_flags[i] ?? 0) !== 0,
  // The engine's flag, as `handback.mjs` reads it: the camera runs inside
  // `GameUpdate` now, so a gate that waits for it waits for the real turn.
  cameraFree: () => G.g_camera_free !== 0,
  showMessage: () => null,
  endDialogue() {},
}, { seed: 1 });

if (!seekTo(walker, block, step, op)) {
  console.log(`could not seek to block ${block} step ${step} op ${op}; `
              + `the walker is at ${walker.block}/${walker.step}/${walker.opIndex}`);
}

/** `civilians.spawns[at].children[i].pos` — where a captor stands. */
const childHome = new Map();
for (const [at, rec] of Object.entries(script.civilians?.spawns ?? {})) {
  for (const k of rec.children) childHome.set(k.at, { parent: Number(at), k });
}

/**
 * `render/characters.ts`'s `spent`: an actor that ran `ActorDespawn` on itself
 * is not built again while the script still lists it -- "the opcode has to run
 * again first". Without it a captor shot by `kill` came back as a new actor
 * the moment its corpse left the pool, and the trace showed a dead zombie
 * striking again.
 */
const made = new Map();
const spent = new Set();

function syncSpawns() {
  // The same three steps `syncCharacterSpawns` takes, minus the renderer's
  // "is the model loaded" gate: every spawn the walker lists is ready here.
  const want = new Set();
  for (const s of walker.spawns) want.add(s.at);
  // **Class 0x10's children are not in the walker's list** — `CivilianInit`
  // spawns each itself. `render/characters.ts` adds them by `civilian_child`;
  // this is that rule, headless.
  for (const [at, rec] of childHome) {
    if (want.has(rec.parent)) want.add(at);
  }
  for (const [at, a] of made) {
    if (!a.despawned) continue;
    spent.add(at);
    made.delete(at);
  }
  for (const at of spent) if (!want.has(at)) spent.delete(at);
  const reqs = [];
  for (const at of want) {
    if (spent.has(at)) continue;
    if (G.g_object_list.some((o) => o.at === at)) continue;
    const pl = placementAt.get(at);
    if (!pl) continue;
    const s = walker.spawns.find((x) => x.at === at);
    const pos = s?.pos ?? childHome.get(at)?.k.pos ?? pl.pos ?? [0, 0, 0];
    reqs.push({ at, motion: pl.motion ?? 0,
                pos: { x: pos[0], y: pos[1], z: pos[2] } });
  }
  for (const a of SpawnScriptedCharacters(reqs, rng)) made.set(a.at, a);
  SpawnPropContainers(walker.spawns);
}
syncSpawns();
// Park the eye on one enemy, or nothing ever closes to attack range and no
// permit is ever claimed. The seek stops *at* the spawn opcode rather than
// past it, so this waits for the first tick to run it.
const eyeAt = args[6] ? Number(args[6]) : null;
let eyeSeated = false;
function seatEye() {
  if (eyeSeated) return;
  const first = eyeAt !== null
    ? G.g_object_list.find((o) => o.at === eyeAt)
    : G.g_object_list.find((o) => ActorIsEnemy(o.cls));
  if (!first) return;
  eye = vec3(first.pos.x, first.pos.y + 6, first.pos.z + 24);
  eyeSeated = true;
}

const trail = new Map();
function key(o) {
  return `${o.state}/${o.sub}`
    + ` permit=${o.attackPermit} rank=${o.rank}/${o.allowance}`
    + ` q=${o.queueRank} hp=${o.hp} mot=${o.motion}`
    + ` act=${o.action ? o.action.motion : "-"}`
    + ` d=${Math.hypot(o.pos.x - eye.x, o.pos.z - eye.z).toFixed(0)}`;
}
const GONE = "gone -- despawned, out of the pool";
/** The actor each trail last saw, for its header once it has left. */
const lastActor = new Map();
function trace(f) {
  const here = new Set();
  for (const o of G.g_object_list) {
    if (!ActorIsEnemy(o.cls)) continue;
    here.add(o.at);
    lastActor.set(o.at, o);
    const seen = trail.get(o.at) ?? [];
    const k = key(o);
    if (!seen.length || seen[seen.length - 1].k !== k) seen.push({ k, f });
    trail.set(o.at, seen);
  }
  // `GameUpdate` sweeps a despawned actor out of the pool, so without this a
  // trail simply stops on its last state and a despawn reads as nothing.
  for (const [at, seen] of trail) {
    if (here.has(at) || seen[seen.length - 1].k === GONE) continue;
    seen.push({ k: GONE, f });
  }
}

const frames = Math.round(secs * 60);
let killed = false;
for (let i = 0; i < frames; i++) {
  walker.tick(1 / 60);
  syncSpawns();
  seatEye();
  // What the app runs between the script's tick and the game's, and nothing
  // more. This used to copy the scene-state major, the camera path and its
  // frame out of the walker and rebuild `G.g_script_flags` from `walker.flags`
  // -- all of which are the engine's own globals now, written where the
  // engine writes them, and the rebuild wiped every flag an actor raised on
  // the next tick. `walker.flags` is gone with it.
  syncPortGlobals(walker, false, eye);
  GameUpdate(eye, 1 / 60, host, rng, events);
  trace(i);
  if (killWho && !killed && i > 120) {
    const live = G.g_object_list.filter((o) => ActorIsEnemy(o.cls) && !o.dead);
    let cand = null;
    if (killWho === "first") cand = live[0];
    else if (killWho === "nearest") {
      cand = live.slice().sort((a, b) =>
        Math.hypot(a.pos.x - eye.x, a.pos.z - eye.z)
        - Math.hypot(b.pos.x - eye.x, b.pos.z - eye.z))[0];
    } else cand = live.find((o) => o.at === Number(killWho));
    if (cand) {
      const head = CharacterTypeOf(cand)?.head_bone ?? 2;
      for (let s = 0; s < 60 && !cand.dead; s++) {
        ResolveHit(cand, head, host, rng);
      }
      console.log(`shot 0x${cand.at.toString(16)} in the head at frame ${i}:`
        + ` state ${cand.state}/${cand.sub} hp ${cand.hp}`
        + ` dead=${cand.dead} action=${cand.action?.motion ?? "-"}`);
      killed = true;
    }
  }
}

// The walker's own address, not the one asked for (L44).
console.log(`\nstage ${stage}, seeked to ${block}/${step}/${op}; after ${secs}s `
  + `the walker is at ${walker.block}/${walker.step}/${walker.opIndex}`
  + ` (scene state ${G.g_scene_state_major_entered}/${G.g_scene_state_minor_entered},`
  + ` cam path ${G.g_active_cam_path} frame ${G.g_cam_path_frame})`);
console.log(`permits: ${JSON.stringify(G.g_attack_permits)}`
  + ` committed=${G.g_attack_committed} alive=${G.g_enemies_alive}`
  + ` present=${G.g_enemies_present} civ=${G.g_civilians_alive}`);
for (const [at, seen] of trail) {
  const o = lastActor.get(at);
  console.log(`\n0x${at.toString(16)} "${o?.name ?? "?"}" cls 0x${o?.cls.toString(16)}`
    + ` char ${o?.charType} cond ${o?.condition} init ${o?.initialState}`
    + ` attackState ${o?.attackState}`
    + ` target 0x${(o?.targetAt ?? -1).toString(16)}`);
  for (const s of seen) console.log(`   +${s.f}f  ${s.k}`);
}
