/**
 * A host with no browser: the port's own `World` on a stage from the bundle,
 * stepped the way `Player.stepOneFrame` steps it, for `net.test.ts` and for
 * measuring what netplay costs.
 *
 * The character layer is `render/characters.ts`'s spawn contract without
 * three.js, and the renderer's shot test is geometry: the nearest live enemy
 * whose chest a sphere of 12 around the ray meets, answered from the host's
 * own state when the shot resolves.
 */
import { readFileSync } from "node:fs";
import { CameraFrame } from "../src/core/camera";
import { Events } from "../src/core/events";
import { Rng } from "../src/core/rng";
import { Scope } from "../src/core/scope";
import type { Context, Tick } from "../src/core/system";
import { World } from "../src/core/world";
import { GameSystem, ScriptSystem, syncCharacterSpawns, syncPortGlobals }
  from "../src/app/systems";
import { ResetPropContainers } from "../src/game/class41";
import { CamPaths } from "../src/game/camera/curve";
import { AppState, G } from "../src/game/globals";
import { SetBoss4Tables, SetCameraPaths, SetGameOverTables, SetGameTables }
  from "../src/game/tables";
import { ActorFlag } from "../src/game/actor";
import { ActorIsEnemy } from "../src/game/registry";
import type { ShotPick } from "../src/game/host";
import type { Walker as WalkerT } from "../src/script/walker";
import { Walker } from "../src/script/walker";
import type { ScriptJson } from "../src/bundle";
import { stageFile } from "../tools/lib/bundle_root";

const TICK = 1 / 60;
const LIVE: Tick = { dt: TICK, frames: 1, wall: TICK, frozen: false };

type Obj = Record<string, unknown>;

export type HeadlessHost = ReturnType<typeof buildHost>;

/** `render/characters.ts`'s spawn contract without three.js -- as `state.test.ts` has it. */
function headlessPool(chars: ScriptJson["characters"], rng: Rng) {
  type Rec = { at: number; motion: number; synthetic: boolean; parentAt?: number;
               home: { x: number; y: number; z: number } };
  const pending = new Map<number, Rec>();
  const home = new Map<number, Rec["home"]>();
  for (const p of (chars?.placements ?? []) as unknown as Obj[]) {
    if (p.motion === undefined || p.motion === null) continue;
    const type = (chars as unknown as { types?: Record<string, { motions?: Obj }> })
      .types?.[String(p.char_type)];
    if (!type || !type.motions?.[String(p.motion)]) continue;
    const pos = (p.pos as number[]) ?? [0, 0, 0];
    const rec: Rec = { at: p.at as number, motion: p.motion as number,
                       synthetic: !!p.synthetic,
                       parentAt: (p.parent_at ?? p.civilian_child) as number | undefined,
                       home: { x: pos[0], y: pos[1], z: pos[2] } };
    pending.set(rec.at, rec);
    home.set(rec.at, rec.home);
  }
  const live = new Set<number>();
  const instances: { at: number; a: { at: number; despawned: boolean }; rec: Rec;
                     parentAt?: number }[] = [];
  const spent = new Set<number>();
  const wanted = (spawns: readonly { at: number }[]) => {
    const want = new Set<number>();
    const listed = new Set<number>();
    for (const s of spawns) {
      listed.add(s.at);
      if (pending.has(s.at) || live.has(s.at)) want.add(s.at);
    }
    for (const rec of [...pending.values()]) {
      if (rec.parentAt !== undefined && (want.has(rec.parentAt) || listed.has(rec.parentAt))) {
        want.add(rec.at);
      }
    }
    for (const inst of instances) {
      if (inst.parentAt !== undefined && (want.has(inst.parentAt) || listed.has(inst.parentAt))) {
        want.add(inst.at);
      }
    }
    return want;
  };
  const adopt = (actors: readonly { at: number; despawned: boolean }[]) => {
    for (const a of actors) {
      const rec = pending.get(a.at);
      if (!rec) continue;
      pending.delete(a.at);
      live.add(a.at);
      instances.push({ at: a.at, a, rec, parentAt: rec.parentAt });
    }
  };
  return {
    rng,
    bindToPool() {},
    readySpawns(spawns: readonly { at: number }[]) {
      const out = [];
      for (const at of wanted(spawns)) {
        if (spent.has(at)) continue;
        const rec = pending.get(at);
        if (!rec || rec.synthetic) continue;
        out.push({ at, motion: rec.motion, pos: { ...rec.home }, parentAt: rec.parentAt });
      }
      return out;
    },
    syncSpawns(spawns: readonly { at: number }[], made: readonly { at: number; despawned: boolean }[]) {
      const want = wanted(spawns);
      adopt(made);
      const orphans = [];
      for (const at of want) {
        if (!pending.has(at)) continue;
        const a = G.g_object_list.find((o) => o.at === at && !o.despawned);
        if (a) orphans.push(a);
      }
      if (orphans.length) adopt(orphans);
      const gone = [];
      for (let i = instances.length - 1; i >= 0; i--) {
        const inst = instances[i];
        if (want.has(inst.at) && !inst.a.despawned) continue;
        if (inst.a.despawned) spent.add(inst.at);
        else gone.push(inst.a);
        live.delete(inst.at);
        pending.set(inst.at, { ...inst.rec, home: home.get(inst.at) ?? inst.rec.home });
        instances.splice(i, 1);
      }
      for (const at of spent) if (!want.has(at)) spent.delete(at);
      return gone;
    },
  };
}

/** The host: the port's own `World`, stepped as `Player.stepOneFrame` steps it. */
export function buildHost(stage: number) {
  const script = JSON.parse(readFileSync(stageFile(stage, "script"), "utf8")) as ScriptJson;
  const cam = new CamPaths(JSON.parse(readFileSync(stageFile(stage, "cam"), "utf8")));
  const events = new Events();
  const stageScope = new Scope(`stage:${stage}`);
  const ctx = {
    events, rng: new Rng(1), walker: null as WalkerT | null, scope: stageScope,
    session: stageScope.child("session"), view: new CameraFrame(),
    paths: cam, stage, frame: 0,
  };
  const world = new World<Context>();
  const scriptSys = new ScriptSystem();
  world.add("script", scriptSys);
  const game = new GameSystem();
  game.backend = {
    boneWorld: (at, _bone, out) => {
      const a = G.g_object_list.find((o) => o.at === at);
      if (!a) return false;
      out.x = a.pos.x; out.y = a.pos.y + 5; out.z = a.pos.z;
      return true;
    },
    setBoneSlot: () => undefined,
    // The renderer's half, as geometry: the nearest live enemy whose chest a
    // sphere of 12 around the ray meets. Answered when the host resolves the
    // shot, from the host's own state -- so a shot the replica aimed at where
    // an enemy *was* lands only if it is still there.
    pickShot: (ray) => {
      let best: ShotPick | null = null, bt = Infinity;
      for (const o of G.g_object_list) {
        if (o.despawned || o.dead || !o.visible || !ActorIsEnemy(o.cls)) continue;
        if (o.flags & (ActorFlag.NoShotTest | ActorFlag.ShotImmune | ActorFlag.Dead)) continue;
        const cx = o.pos.x - ray.origin.x, cy = o.pos.y + 5 - ray.origin.y;
        const cz = o.pos.z - ray.origin.z;
        const t = cx * ray.dir.x + cy * ray.dir.y + cz * ray.dir.z;
        if (t <= 0 || t >= bt) continue;
        const px = cx - t * ray.dir.x, py = cy - t * ray.dir.y, pz = cz - t * ray.dir.z;
        if (px * px + py * py + pz * pz > 12 * 12) continue;
        bt = t;
        best = { kind: "actor", at: o.at, bone: 1,
                 point: { x: o.pos.x, y: o.pos.y + 5, z: o.pos.z } };
      }
      return best;
    },
  };
  world.add("game", game);
  const walker = new Walker(script, {
    enterRegion: () => undefined, loadSlot: () => undefined,
    unloadSlot: () => undefined, startCamera: () => undefined,
    onFeed: () => undefined, onBranch: () => undefined, playSound: () => undefined,
    aliveEnemies: () => null, presentEnemies: () => null, aliveCivilians: () => null,
    scriptFlagRaised: () => null, cameraFree: () => null,
    showMessage: () => null, endDialogue: () => undefined,
  });
  scriptSys.walker = walker;
  ctx.walker = walker;
  ResetPropContainers();
  G.g_GameMode = script.game_mode;
  world.attach(ctx);
  SetGameTables(script.characters, script.breakables, script.set_pieces,
                script.humanoids, script.coli, script.civilians);
  SetGameOverTables(script.game_over);
  SetBoss4Tables(script.boss4, script.carrier_door_yaw);
  SetCameraPaths(cam);
  walker.reset(script.entry_block);
  walker.primeToFirstWait();
  const pool = headlessPool(script.characters, ctx.rng);
  let padLatch = 0;
  return {
    world, ctx, walker, events,
    press(bits: number) { padLatch |= bits; },
    step() {
      const w = walker;
      // Read through a function so the check after `tick` is not narrowed away.
      const branch = () => w.branch;
      const b0 = branch();
      if (b0) w.takeBranch(b0.targets[0]);
      else if (!w.finished && G.g_app_state === AppState.InPlay) {
        w.tick(TICK);
        const b1 = branch();
        if (b1) w.takeBranch(b1.targets[0]);
      }
      syncPortGlobals(w, false, ctx.view.eye);
      syncCharacterSpawns(pool as never, w.spawns, ctx.events);
      G.g_pad_state = padLatch;
      padLatch = 0;
      world.update(ctx, LIVE);
      G.g_pad_state = 0;
      ctx.view.eye.x = G.g_camera_block_eye.x;
      ctx.view.eye.y = G.g_camera_block_eye.y;
      ctx.view.eye.z = G.g_camera_block_eye.z;
    },
    /** What `world.save()` lays out, uncloned. */
    root(): Obj {
      return { frame: ctx.frame, rng: ctx.rng.state,
               parts: { game: G, script: walker.saveState() } };
    },
  };
}

