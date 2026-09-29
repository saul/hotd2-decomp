/**
 * Two-player netplay, headless: the real session code, a real stage, a bad
 * link.
 *
 * `net_codec.test.ts` proves the codec on random trees. This proves the
 * session on the game: `NetHost` driving the port's own `World` on a stage
 * from the bundle (`net_rig.ts`), `NetReplica` holding a copy over a
 * `MemoryLink` that drops, delays and reorders, both on one simulated clock.
 * Player 2 exists only on the replica's side -- its START and its shots go
 * through `NetReplica.press`, the wire, and `NetHost.takeInput`, into player
 * index 1's slots, exactly as in the page. It asserts:
 *
 * - **the replica's state is the host's**, by hash on every tick it applies
 *   and by a full structural comparison every thirtieth, against a copy of
 *   the host's state taken at that tick -- and, sabotaged, that a value
 *   written behind the codec's back is found by the audit and named by both
 *   ends once the keyframe that repairs it lands;
 * - **a timeline jump** -- a seek, in the page -- moves both ends to a new
 *   epoch without a desync;
 * - **player 2 plays**: START puts player index 1 in play, every press of the
 *   final epoch reaches the host exactly once and none from any epoch twice,
 *   and player 2 scores;
 * - **the aim check sees what it should**: a shot built the way the page
 *   builds one agrees with the host's camera to rounding, and one that lies
 *   about its pixels is caught;
 * - and it prints what all of it costs, on the host and the replica.
 *
 * The replica here writes into its own plain tree rather than `G`, because
 * host and replica share one process and `G` is a module; the page's install
 * into `G` is the browser harness's to check (`tools/net_pair.mjs`).
 *
 * Run with `npm run test:net`. Needs a bundle; exits 3 without one.
 */
import type { EventMap } from "../src/core/events";
import { TreeHasher, diffTrees } from "../src/core/net/codec";
import { Msg, PressKind } from "../src/core/net/protocol";
import { NetHost, type HostSim } from "../src/app/net/host";
import { NetReplica, type ReplicaSim } from "../src/app/net/replica";
import { MemoryLink } from "../src/app/net/transport";
import type { Identity } from "../src/app/net/peer";
import { G } from "../src/game/globals";
import { PadBit } from "../src/game/player_shell";
import { PlayerState } from "../src/game/player_state";
import { ActorFlag } from "../src/game/actor";
import { ActorIsEnemy } from "../src/game/registry";
import { QueueOffscreenPull, QueueShotRequest } from "../src/game/combat/shot";
import { PROJECTION_DISTANCE_PX, SetPlayerAimFromPointer }
  from "../src/game/scene_lights";
import { finishOrSkip, hasStage } from "../tools/lib/bundle_root";
import { buildHost } from "./net_rig";

let failures = 0;
let ran = 0;
function check(name: string, ok: boolean, detail = ""): void {
  ran++;
  if (ok) console.log(`  ok    ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
}

const FRAME_MS = 1000 / 60;

type Obj = Record<string, unknown>;
type Vec = { x: number; y: number; z: number };

const ID: Identity = { snapshot: 4, build: "test", bundle: "b", schema: "s" };

const pct = (xs: number[], p: number): number => {
  if (!xs.length) return NaN;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(p * (a.length - 1) + 0.5))];
};

/**
 * A shot at `target` the way the page builds one: the pixel the target sits
 * at through the camera the replica drew (`g_camera_world_to_view`), and the
 * segment from that camera's eye through that pixel -- what
 * `Raycaster.setFromCamera` gives for the same pixel.
 */
function aimAt(g: typeof G, target: Vec): { x: number; y: number; ray: { origin: Vec; dir: Vec } } | null {
  const w = g.g_camera_world_to_view;
  const vx = w[0] * target.x + w[4] * target.y + w[8] * target.z + w[12];
  const vy = w[1] * target.x + w[5] * target.y + w[9] * target.z + w[13];
  const vz = w[2] * target.x + w[6] * target.y + w[10] * target.z + w[14];
  if (vz >= -1) return null; // behind the camera
  const d = PROJECTION_DISTANCE_PX;
  const x = (vx * d) / -vz, y = (vy * d) / -vz;
  const v = g.g_camera_view_to_world;
  const dx = v[0] * x + v[4] * y - v[8] * d;
  const dy = v[1] * x + v[5] * y - v[9] * d;
  const dz = v[2] * x + v[6] * y - v[10] * d;
  const n = Math.hypot(dx, dy, dz) || 1;
  return { x, y, ray: { origin: { x: v[12], y: v[13], z: v[14] },
                        dir: { x: dx / n, y: dy / n, z: dz / n } } };
}

interface Profile { name: string; loss: number; latency: number; jitter: number }

async function run(stage: number, p: Profile, seconds: number,
                   sabotage = false): Promise<void> {
  const h = buildHost(stage);
  let seed = 0x9e3779b9 ^ stage;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const link = new MemoryLink(random);
  link.loss = p.loss;
  link.latency = p.latency;
  link.jitter = p.jitter;
  const hostSim: HostSim = {
    stage: () => ({ stage, original: false }),
    loaded: () => stage,
    liveRoot: () => h.root(),
    hold: () => null,
    branch: () => null,
    view: () => G.g_camera_view_to_world,
    projectionDistance: PROJECTION_DISTANCE_PX,
  };
  const host = new NetHost(link.a, ID, hostSim);
  // The host's events, tapped the way the page taps them.
  let tapped = 0;
  const emit = h.events.emit.bind(h.events);
  h.events.emit = <K extends keyof EventMap>(k: K, payload: EventMap[K]) => {
    host.tap(k, payload);
    tapped++;
    emit(k, payload);
  };

  let replicaRoot = null as Obj | null;
  let dispatched = 0;
  const replicaSim: ReplicaSim = {
    load: async () => null,
    install: (root) => { replicaRoot = root; return null; },
    root: () => replicaRoot!,
    afterApply: () => undefined,
    dispatch: () => { dispatched++; },
    wake: () => undefined,
  };
  const replica = new NetReplica(link.b, ID, replicaSim);
  // Both ends time what lands on the one simulated clock.
  host.clock = replica.clock = () => now;
  // Under sabotage, one desync report is lost on its way to the host, so the
  // replica's own retry is what has to get the keyframe.
  let loseDesync = false, lostDesync = false;
  const hostHears = link.a.onMessage;
  link.a.onMessage = (ch, data) => {
    if (loseDesync && data[0] === Msg.Desync) {
      loseDesync = false;
      lostDesync = true;
      return;
    }
    hostHears(ch, data);
  };

  const truth = new Map<string, Obj>();
  const hasher = new TreeHasher();
  let now = 0;
  const hostCost: number[] = [];
  const replicaCost: number[] = [];
  let compared = 0, deepFail = "";
  let p2Started = false;
  /** Press id -> the replica's epoch when it was pressed. */
  const fired = new Map<number, number>();
  /** Press id -> times the host fed it to the port. */
  const taken = new Map<number, number>();
  let liar = -1;
  let liarError = NaN;
  let aimWorst = 0;
  let aimChecked = 0;
  let seeked = false, seekEpochDone = false;
  let sab1 = 0, sab2 = 0, sabEpoch = 0, mismatchesBefore2 = 0;
  const frames = seconds * 60;
  let hostTick = 0;
  // Player 2's tab hidden for five seconds: no frames, so no steps and no
  // flushes, and the session's timer throttled to once a second. Only what
  // lands still runs.
  const hideFrom = sabotage ? Infinity : Math.floor(frames * 0.3);
  const hideTo = hideFrom + 300;
  let hiddenLag = 0, hiddenKeyframes = -1, hiddenBehind = NaN;

  const setNow = (t: number) => {
    now = t;
    link.a.now = t;
    link.b.now = t;
  };
  setNow(0);
  link.open();
  // A few frames past the last, so the last presses can land.
  for (let f = 0; f < frames + 60; f++) {
    // The replica's stage load is a promise, as the page's is: let it settle.
    await Promise.resolve();
    setNow(f * FRAME_MS);
    link.deliver(now);
    host.poll(now);
    const hidden = f >= hideFrom && f < hideTo;
    if (f === hideFrom) hiddenKeyframes = host.stats.keyframes;
    if (!hidden || f % 60 === 0) replica.poll(now);

    // -- the host's frame: player 2's gun first, as `stepOneFrame` takes it --
    if (!host.holding) {
      const input = host.takeInput();
      if (input.aim) {
        SetPlayerAimFromPointer(1, input.aim.x, input.aim.y);
        if (!input.aim.on) G.g_aim_on_screen[1] = 0;
      }
      for (const q of input.presses) {
        taken.set(q.id, (taken.get(q.id) ?? 0) + 1);
        if (q.kind === PressKind.Start) h.press(PadBit.Start1);
        else if (q.kind === PressKind.Offscreen) QueueOffscreenPull(1);
        else if (q.kind === PressKind.Pull && q.ray) QueueShotRequest(1, q.ray);
        if (q.kind !== PressKind.Pull || Number.isNaN(q.aimError)) continue;
        if (q.id === liar) liarError = q.aimError;
        else aimWorst = Math.max(aimWorst, q.aimError);
        aimChecked++;
      }
      // Player 1 keeps themselves alive on the engine's own continue.
      if (G.g_player_state[0] === PlayerState.Continue && f % 30 === 0) h.press(PadBit.Start0);
      h.step();
      const t0 = performance.now();
      host.endTick(now);
      if (hidden) hiddenLag = Math.max(hiddenLag, host.stats.lag);
      if (f === hideTo - 1) {
        hiddenKeyframes = host.stats.keyframes - hiddenKeyframes;
        hiddenBehind = host.stats.tick - replica.tick;
      }
      if (host.streaming) {
        hostCost.push(performance.now() - t0);
        hostTick++;
        // Keyed as the host numbers its ticks -- per epoch -- so the state
        // after the seek is compared as well as the state before it.
        const t = host.stats.tick;
        if (t % 30 === 0) {
          truth.set(`${host.stats.epoch}:${t}`, structuredClone(h.root()));
          truth.delete(`${host.stats.epoch}:${t - 600}`);
        }
      }
    }

    if (hidden) continue;
    // -- the replica's frame --
    const r0 = performance.now();
    const before = replica.tick;
    replica.step(now);
    if (replica.tick !== before) replicaCost.push(performance.now() - r0);
    const want = truth.get(`${replica.stats.epoch}:${replica.tick}`);
    // Under sabotage the replica differs on purpose until it is repaired;
    // the comparison counts only once the second repair has had time to land
    // -- or a new epoch has started it afresh.
    const comparable = !sabotage || (sab2 > 0 && !replica.stats.desynced
      && (replica.stats.epoch > sabEpoch || replica.tick > sab2 + 180));
    if (want && replicaRoot && replica.tick !== before && comparable) {
      compared++;
      const d = diffTrees(want, replicaRoot, 4);
      if (d.length && !deepFail) deepFail = `tick ${replica.tick}: ${d.join("; ")}`;
      if (!d.length && hasher.hash(want) !== hasher.hash(replicaRoot) && !deepFail) {
        deepFail = `tick ${replica.tick}: equal trees, different hashes`;
      }
    }

    // -- sabotage: the replica's state made wrong behind the codec's back --
    if (sabotage && replicaRoot && replica.running) {
      const g = (replicaRoot.parts as Obj).game as Record<string, unknown>;
      if (!sab1 && replica.tick >= 400) {
        // A value that changes rarely, so nothing the host sends repairs it
        // by accident: only the hash can see it.
        sab1 = replica.tick;
        (g.g_credits as number[])[0] += 77;
      }
      if (sab1 && !sab2 && replica.tick >= 1200 && !replica.stats.desynced) {
        const pool = g.g_object_list as Obj[];
        if (pool.length > 2) {
          // An actor gone from the replica's pool: the next op for it cannot land.
          sab2 = replica.tick;
          sabEpoch = replica.stats.epoch;
          mismatchesBefore2 = replica.stats.mismatches + replica.stats.applyErrors
            + replica.stats.pageWrites;
          loseDesync = true;
          pool.splice(1, 1);
        }
      }
    }

    // -- player 2, scripted, on the replica's side only --
    if (replica.running && f < frames && replicaRoot) {
      const t = replica.tick;
      const g = (replicaRoot.parts as Obj).game as typeof G;
      if (!p2Started && t > 120) {
        const id = replica.press(PressKind.Start);
        if (id >= 0) { fired.set(id, replica.stats.epoch); p2Started = true; }
      }
      if (p2Started && t % 8 === 0 && g.g_player_state[1] === PlayerState.InPlay) {
        if (g.g_player_ammo[1] <= 0) {
          const id = replica.press(PressKind.Offscreen);
          if (id >= 0) fired.set(id, replica.stats.epoch);
        }
        const eye = g.g_camera_block_eye;
        let best: (typeof G.g_object_list)[number] | null = null, bd = Infinity;
        for (const o of g.g_object_list) {
          if (o.despawned || o.dead || !o.visible || !ActorIsEnemy(o.cls)) continue;
          if (o.flags & (ActorFlag.NoShotTest | ActorFlag.ShotImmune | ActorFlag.Dead)) continue;
          const dd = (o.pos.x - eye.x) ** 2 + (o.pos.y - eye.y) ** 2 + (o.pos.z - eye.z) ** 2;
          if (dd < bd) { bd = dd; best = o; }
        }
        const shot = best && aimAt(g, { x: best.pos.x, y: best.pos.y + 5, z: best.pos.z });
        if (shot) {
          replica.setAim(shot.x, shot.y, true);
          const id = replica.press(PressKind.Pull, shot.ray);
          if (id >= 0) fired.set(id, replica.stats.epoch);
          // Once, a shot whose pixels say one thing and whose ray another.
          // On screen: far off the axis 200 pixels is a small angle, and the
          // nearest enemy can be anywhere in front of the camera.
          if (liar < 0 && id >= 0 && fired.size > 20
              && Math.abs(shot.x) < 320 && Math.abs(shot.y) < 240) {
            replica.setAim(shot.x + 200, shot.y, true);
            liar = replica.press(PressKind.Pull, shot.ray);
            if (liar >= 0) fired.set(liar, replica.stats.epoch);
          }
        }
      }
    }
    replica.flushInput(now);

    // A seek, halfway: the host jumps its timeline; the replica must follow.
    if (!seeked && f === Math.floor(frames / 2)) {
      seeked = true;
      host.discontinuity();
    }
    if (seeked && !seekEpochDone && replica.stats.epoch === host.stats.epoch
        && replica.running) {
      seekEpochDone = true;
    }
  }

  const hs = host.stats, rs = replica.stats;
  const tag = `stage ${stage} ${p.name}`;
  const finalEpoch = hs.epoch;
  const twice = [...taken].filter(([, n]) => n > 1).map(([id]) => id);
  const missing = [...fired].filter(([id, ep]) => ep === finalEpoch && !taken.has(id))
    .map(([id]) => id);
  const dropped = [...fired].filter(([id, ep]) => ep !== finalEpoch && !taken.has(id)).length;
  check(`${tag}: the replica streamed (${rs.verified} ticks verified by hash)`,
        // Every tick carries the host's hash, and every one applied is checked.
        rs.verified > frames / 4, `${rs.verified} of ${frames} frames; phase ${rs.phase}`);
  const logs = (s: typeof rs) => s.log.map((e) => `${e.kind}@${e.tick}: ${e.text}`).join(" | ");
  if (sabotage) {
    // What the overlay exists to show: a replica that is not the host's is
    // caught within a pass of the audit -- the kept hash is the host's ops',
    // right as ever, and cannot see it -- the replica names the value against
    // the keyframe that repairs it, and the host hears which.
    check(`${tag}: a value changed behind the codec's back is found by the audit `
          + `(${rs.pageWrites} found)`, sab1 > 0 && rs.pageWrites > 0
          && rs.log.some((e) => /this page wrote parts\.game\.g_credits/.test(e.text)), logs(rs));
    check(`${tag}: ...and the replica names the value against the keyframe`,
          rs.log.some((e) => e.kind === "report" && /g_credits\[0\]/.test(e.text)), logs(rs));
    check(`${tag}: ...and the host hears which`,
          hs.log.some((e) => /player 2 compared the keyframe: .*g_credits\[0\]/.test(e.text)),
          logs(hs));
    check(`${tag}: an actor taken from the replica's pool is caught too`,
          sab2 > 0 && rs.mismatches + rs.applyErrors + rs.pageWrites > mismatchesBefore2,
          logs(rs));
    check(`${tag}: ...whose report the host never got, so the replica asked again `
          + "by itself", lostDesync
          && hs.log.some((e) => /asked for a keyframe: the state is still wrong/.test(e.text)),
          logs(hs));
    check(`${tag}: ...both repaired by keyframes (${rs.keyframes}), the replica `
          + `matching again at the end`, rs.keyframes >= 3 && !rs.desynced, logs(rs));
    check(`${tag}: ${compared} ticks after the repair compared whole against the host's`,
          compared > 5 && !deepFail, deepFail || `${compared} comparisons`);
    console.log(`        replica log: ${logs(rs)}`);
    return;
  }
  check(`${tag}: no tick's hash differed from the host's`, rs.mismatches === 0,
        `${rs.mismatches}: ${logs(rs)}`);
  check(`${tag}: no delta failed to apply`, rs.applyErrors === 0,
        rs.log.map((e) => e.text).join(" | "));
  check(`${tag}: ${compared} ticks compared whole against the host's state`,
        compared > 10 && !deepFail, deepFail || `${compared} comparisons`);
  // A hidden tab applies what lands and says so: the host's base keeps moving,
  // no delta grows past a keyframe's worth, and the tab comes back current.
  check(`${tag}: a hidden player 2 kept the host's deltas narrow (widest `
        + `${hiddenLag} ticks, ${hiddenKeyframes} keyframes) and was ${hiddenBehind} `
        + "ticks behind when it came back",
        hiddenLag < 45 && hiddenKeyframes === 0 && hiddenBehind < 20, "");
  check(`${tag}: the seek's new epoch was taken up`, seekEpochDone,
        `host epoch ${hs.epoch}, replica ${rs.epoch}, phase ${rs.phase}`);
  check(`${tag}: player 2 is in play off a START sent from the replica`,
        [PlayerState.InPlay, PlayerState.Continue, PlayerState.GameOver]
          .includes(G.g_player_state[1]),
        `g_player_state[1] = ${G.g_player_state[1]}`);
  check(`${tag}: every press of the last epoch reached the host once, and none `
        + `twice (${fired.size} pressed, ${taken.size} taken, ${dropped} dropped by the seek)`,
        missing.length === 0 && twice.length === 0 && fired.size > 20,
        `missing ${missing.join(",")}; twice ${twice.join(",")}`);
  check(`${tag}: player 2 scored`, G.g_player_score[1] > 0, `score ${G.g_player_score[1]}`);
  check(`${tag}: the host's events reached the replica`, tapped > 0 && dispatched > 0,
        `${tapped} tapped, ${dispatched} dispatched`);
  check(`${tag}: ${aimChecked} shots built through the replica's camera agree `
        + `with the host's (worst ${aimWorst.toExponential(2)}°)`,
        // acos near 1 is good to ~1e-8 rad, about 1e-6 degrees: that is the
        // floor, and anything replication got wrong is orders above it.
        aimChecked > 10 && aimWorst < 1e-4, "");
  check(`${tag}: ...and the one that lied about its pixels was caught `
        + `(${liarError.toFixed(2)}° off)`, liarError > 1,
        `liar ${liar}; host log: ${hs.log.map((e) => e.text).join(" | ")}`);
  console.log(`        host: ${hostCost.length} ticks, tracking median `
    + `${pct(hostCost, 0.5).toFixed(2)} ms, p95 ${pct(hostCost, 0.95).toFixed(2)} ms; `
    + `${hs.keyframes} keyframes (last ${(hs.keyframeBytes / 1024).toFixed(1)} KiB), `
    + `delta ${hs.deltaBytes.toFixed(0)} B`);
  console.log(`        replica: apply+verify median ${pct(replicaCost, 0.5).toFixed(2)} ms, `
    + `p95 ${pct(replicaCost, 0.95).toFixed(2)} ms; skips ${rs.skips}, underruns `
    + `${rs.underruns}, loss in ${rs.lossIn.toFixed(1)}%`);
}

const STAGES = [1, 2].filter(hasStage);
const PROFILES: Profile[] = [
  { name: "clean", loss: 0, latency: 20, jitter: 0 },
  { name: "lossy", loss: 0.05, latency: 40, jitter: 20 },
  { name: "bad", loss: 0.2, latency: 100, jitter: 60 },
];
for (const stage of STAGES) {
  for (const p of PROFILES) await run(stage, p, 50);
}
// And once with the replica sabotaged, on a lossy link: the checks that
// have to *fail* to be worth having.
if (STAGES.includes(1)) {
  await run(1, { name: "sabotaged", loss: 0.05, latency: 40, jitter: 20 }, 50, true);
}
finishOrSkip("net", failures, ran);
