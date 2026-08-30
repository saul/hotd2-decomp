/**
 * The port, exercised with no renderer at all.
 *
 * This file imports `game/` and nothing else — no three.js, no DOM — which is
 * the point of the boundary. Every gameplay bug in the session that produced
 * this architecture (facing inverted, permits deadlocked, the cat running the
 * zombie's machine, throwers gated on a rank test the engine does not have)
 * would have been caught by one of the assertions below, in a second, without
 * looking at the screen.
 *
 * Run with `npm run test:port`.
 */
import type { ApproachJson, CharacterType, PlayerDamageJson, TrackingJson }
  from "../src/bundle";
import { Rng } from "../src/core/rng";
import { Events } from "../src/core/events";
import { ActorSpawn, GameUpdate } from "../src/game/director";
import { G, ResetGameGlobals } from "../src/game/globals";
import { NULL_HOST } from "../src/game/host";
import { SetGameTables } from "../src/game/tables";
import { STATE_APPROACH, STATE_ATTACK_RUN, STATE_BACKOFF }
  from "../src/game/class30/states";
import { dist2d, vec3 } from "../src/game/vec";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

// -- a stage's worth of tables, small enough to reason about ----------------

const motion = (frames: number) =>
  ({ bank: "t", frames, fps: 30, root: [], rot: [] });

const TYPE: CharacterType = {
  type: 1, name: "test zombie", file: "t.bin", bone_count: 16, bones: [],
  head_bone: 2, reactions: {},
  attacks: {
    "0": {
      "1": {
        strike: 100, lunge: 101, distance: 20, hit_frame: 10,
        player_motion: 7, cancel_mask: 8,
      },
    },
  },
  attack_picks: { "0": new Array(80).fill(1) },
  throw: null,
  motion_row: { "0": [10, 11, 12, 13, 14] },
  backoff_index: 4,
  gore: {}, torso_stages: 3,
  motions: {
    "10": motion(20), "14": motion(20),
    "100": motion(20), "101": motion(20),
  },
};

const APPROACH: ApproachJson = {
  rings: [{ inner: 25, mid: 38, outer: 51 }],
  steps: { base: 2, mid_add: 3, outer_add: 4 },
  ring_set_for_char0: 1,
};

const TRACKING: TrackingJson = {
  curves: [new Array(64).fill(16)], curve: 0, error_clamp: 0x1fff,
  rate_untracked: 12, lookat_radius: 100, distance_scale: 10,
  attack_slots: 2, slots: 8, max_candidates: 14, face_offset: 12,
};

const PLAYER: PlayerDamageJson = {
  life_cost: 1, score: -100, invuln_frames: 90, rank_delta: 2, start_lives: 2,
};

const EYE = vec3(0, 0, 0);

function scene(n: number, rng: Rng): Events {
  ResetGameGlobals();
  SetGameTables({ "1": TYPE }, APPROACH, TRACKING, PLAYER);
  G.g_player_lives = [PLAYER.start_lives, PLAYER.start_lives];
  for (let i = 0; i < n; i++) {
    const a = ActorSpawn(0x1000 + i, 0x30, 1, `zombie ${i}`);
    a.visible = true;
    a.attackState = 1;
    a.hp = 10;
    a.pos = vec3(-20 + i * 20, 0, 45 + i * 10);
    a.motion = 10;
  }
  void rng;
  return new Events();
}

function run(frames: number, rng: Rng, events: Events): void {
  for (let i = 0; i < frames; i++) GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
}

// -- 1. the crowd throttle --------------------------------------------------

console.log("class 0x30, three zombies, ten seconds:");
{
  const rng = new Rng(7);
  const events = scene(3, rng);
  let damaged = 0;
  events.on("player.damaged", () => damaged++);

  let maxPermits = 0;
  let sawBackoff = false;
  let minWalking = Infinity;
  let minAnywhere = Infinity;
  for (let i = 0; i < 600; i++) {
    GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
    maxPermits = Math.max(maxPermits,
      G.g_attack_permits.filter((p) => p !== -1).length);
    for (const o of G.g_object_list) {
      if (o.state === STATE_BACKOFF) sawBackoff = true;
      const d = dist2d(o.pos, EYE);
      minAnywhere = Math.min(minAnywhere, d);
      // Only the lunge may come inside the ring, and only to the attack's own
      // distance; the retreat starts from wherever the swing left it. What
      // must never happen is an *approaching* actor crossing it, which is the
      // rule that keeps a zombie with no attack state out of the camera.
      if (o.state === STATE_APPROACH || o.state === STATE_ATTACK_RUN) {
        minWalking = Math.min(minWalking, d);
      }
    }
  }

  check("never more than g_max_attackers permits at once",
        maxPermits <= G.g_max_attackers, `saw ${maxPermits}`);
  check("someone reached the player and swung", damaged > 0,
        `${damaged} hits`);
  check("the retreat happened", sawBackoff);
  check("nothing walked inside the inner ring",
        minWalking >= APPROACH.rings[0].inner - 0.01,
        `closest ${minWalking.toFixed(2)}`);
  check("and the lunge stopped at the attack's own distance",
        minAnywhere >= TYPE.attacks["0"]["1"].distance - 0.01,
        `closest ${minAnywhere.toFixed(2)}`);
  check("the permit came back", G.g_attack_permits.filter((p) => p !== -1).length
        <= 1);
  check("lives were spent, not overspent",
        G.g_player_lives[0] >= 0 && G.g_player_lives[0] < PLAYER.start_lives,
        `${G.g_player_lives[0]} left`);
}

// -- 2. a class with no handler gets no behaviour ---------------------------

console.log("an unread class:");
{
  const rng = new Rng(7);
  const events = scene(0, rng);
  // 0x53 is the cat. It has no module, so it must not move.
  const cat = ActorSpawn(0x2000, 0x53, 1, "cat");
  cat.visible = true;
  cat.attackState = 1;
  cat.hp = 10;
  cat.pos = vec3(0, 0, 60);
  const start = { ...cat.pos };
  run(600, rng, events);
  check("class 0x53 stayed where the script put it",
        cat.pos.x === start.x && cat.pos.z === start.z);
  check("class 0x53 took no permit", cat.attackPermit === -1);
}

// -- 3. the actor with no attack state must not block the queue -------------

console.log("a spawn whose descriptor names no attack:");
{
  const rng = new Rng(7);
  const events = scene(1, rng);
  const scenery = ActorSpawn(0x3000, 0x30, 1, "scenery");
  scenery.visible = true;
  scenery.attackState = 0;          // g_class30_states[0], the engine's no-op
  scenery.hp = 10;
  scenery.pos = vec3(0, 0, 26);     // nearest, so it ranks first
  scenery.motion = 10;
  let damaged = 0;
  events.on("player.damaged", () => damaged++);
  run(900, rng, events);
  check("it never took a permit", scenery.attackPermit === -1);
  check("the real zombie still got through", damaged > 0);
}

// -- 4. the snapshot round-trips, exactly -----------------------------------

console.log("save state:");
{
  const digest = (): string => JSON.stringify({
    g: G.g_object_list.map((o) => [
      o.at, o.state, o.sub, o.attackPermit, o.pos.x.toFixed(6),
      o.pos.z.toFixed(6), o.yaw.toFixed(6), o.attack, o.zones,
    ]),
    lives: G.g_player_lives, invuln: G.g_player_invuln_frames,
    permits: G.g_attack_permits, score: G.g_player_score,
    look: G.g_camera_lookat_target,
  });

  const rng = new Rng(11);
  const events = scene(3, rng);
  run(300, rng, events);

  // The snapshot is exactly what `GameSystem.save()` hands the world.
  const snap = structuredClone({ globals: G, rng: rng.state });
  const json = JSON.stringify(snap);
  check("the whole game state is JSON", json.length > 0
        && !json.includes("undefined"));

  run(300, rng, events);
  const after = digest();

  // Put it back and run the same 300 frames again.
  Object.assign(G, structuredClone(snap.globals));
  rng.state = snap.rng;
  run(300, rng, events);
  check("a restored snapshot replays identically", digest() === after);

  // And again from the JSON, which is the form the button hands out.
  const reread = JSON.parse(json) as typeof snap;
  Object.assign(G, reread.globals);
  rng.state = reread.rng;
  run(300, rng, events);
  check("and identically after a round trip through JSON",
        digest() === after);
}

// -- 5. determinism, which is what guards the rules above -------------------

console.log("determinism:");
{
  const one = (): string => {
    const rng = new Rng(3);
    const events = scene(4, rng);
    run(400, rng, events);
    return JSON.stringify(G.g_object_list.map((o) => [o.state, o.pos.x, o.pos.z]));
  };
  check("two runs from the same seed agree", one() === one());
  check("every actor is back to approaching or attacking, none stuck",
        G.g_object_list.every((o) => o.state === STATE_APPROACH
          || o.attackPermit >= 0 || o.dead));
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
