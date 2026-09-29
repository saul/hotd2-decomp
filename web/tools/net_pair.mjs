/**
 * Two-player netplay in the real page: a host and a replica, two tabs of one
 * headless Chrome, joined the way a player joins -- a room at the dev
 * server's rendezvous, its link opened in the second tab -- over WebRTC,
 * playing a stage.
 *
 * **Chrome as users have it.** No flag makes WebRTC easier here: host
 * addresses stay hidden behind mDNS names, which is what every real Chrome
 * does, and on the machine this was written on they do not resolve and the
 * router does not route to itself -- so the sessions below connect through
 * the dev server's TURN relay (`tools/signal/turn.ts`), and the route they
 * report says so. An earlier version launched Chrome with the hiding off, and
 * passed for days while two real tabs could not connect at all (L80).
 *
 * `test:net` proves the session code on a real stage with no browser; this
 * proves the page around it -- the replica's install into `G`, the render
 * layers that must follow a state they did not make, the gun's route to the
 * host, the overlay's figures -- none of which a headless run touches. It
 * asserts what the overlay says, because the overlay is what a player sees:
 *
 * - the replica streams, every tick it applies is verified by hash, and
 *   **none** differs from the host's; no delta fails to apply;
 * - START pressed on the replica puts player 2 in play on the host;
 * - shots aimed at enemies through the replica's own camera reach the host
 *   as player 2's, and the host's aim check says they agree with its camera;
 * - a rewind on the host moves both to a new epoch without a desync;
 * - the host's game waits while it waits for player 2;
 * - WebRTC connected, and by which route;
 * - and all of it again with the replica's outgoing link made bad, and once
 *   more through the relay alone (`?relay=1`), which must report a relayed
 *   route.
 *
 *     HOTD2_BUNDLE=<dir> node tools/net_pair.mjs [--stage 1] [--seconds 20]
 *
 * Headless, and the only Chrome running: two at once on this machine starve
 * each other (L29).
 */
import { chromium } from "playwright-core";
import { freePort, requireBundle, serve } from "./lib/player.mjs";

requireBundle("net_pair");
const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const STAGE = Number(flag("stage", "1"));
const SECONDS = Number(flag("seconds", "20"));

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${!ok && detail ? ` -- ${detail}` : ""}`);
  if (!ok) failures++;
};

const port = await freePort();
const vite = await serve(port);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const faults = [];
// One context for both tabs: `browser.newPage` would give each its own, and a
// `BroadcastChannel` does not cross contexts any more than it crosses profiles.
let context = null;

/**
 * The loading screen gone, or -- if it is still up after `ms` -- what it says,
 * which is the reason a load failed where there is one.
 */
async function loaded(page, ms = 120_000) {
  try {
    await page.waitForSelector("#loading", { state: "detached", timeout: ms });
    return null;
  } catch {
    return (await page.$eval("#loading", (e) => e.textContent).catch(() => "")) || "still loading";
  }
}

async function open(label, query) {
  const page = await context.newPage();
  page.on("pageerror", (e) => faults.push(`${label} threw: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.location().url.endsWith("/favicon.ico")) {
      faults.push(`${label}: ${m.text()}`);
    }
  });
  await page.addInitScript(() => {
    try {
      localStorage.setItem("hod2.viewPrefs", JSON.stringify({ toggles: {}, muted: true }));
    } catch { /* */ }
  });
  await page.goto(`http://127.0.0.1:${port}/?stage=${STAGE}&${query}`,
                  { waitUntil: "domcontentloaded" });
  const stuck = await loaded(page);
  if (stuck) throw new Error(`${label} did not load: ${stuck}`);
  return page;
}

/** The overlay's figures, as a label -> value map. Opens it if it is shut. */
async function figures(page) {
  if (!(await page.$("#net-overlay"))) {
    await page.keyboard.press("KeyI");
    try {
      await page.waitForSelector("#net-overlay", { timeout: 5000 });
    } catch {
      // No session to show figures for: say what the page does show.
      return {
        overlay: "none",
        lobby: await page.$eval("#net-lobby", (e) => e.textContent).catch(() => "none"),
        badge: await page.$eval("#net-badge", (e) => e.textContent).catch(() => "none"),
      };
    }
  }
  return page.$$eval("#net-overlay tr", (trs) => Object.fromEntries(
    trs.map((tr) => [tr.querySelector("th")?.textContent ?? "",
                     tr.querySelector("td")?.textContent ?? ""])));
}

const num = (s) => Number(String(s ?? "").replace(/[^0-9.\-]/g, "")) || 0;

/** `G`, from the page's own module graph (the Vite module the app uses). */
const readG = (page, fn) => page.evaluate(async (src) => {
  const { G } = await import("/src/game/globals.ts");
  return new Function("G", `return (${src})(G);`)(G);
}, fn.toString());

/**
 * Where the nearest live enemy is on the replica's screen, through the
 * replica's own camera -- the pixel a player aiming at it would click.
 */
const enemyOnScreen = (page) => page.evaluate(async () => {
  const { G } = await import("/src/game/globals.ts");
  const { ActorIsEnemy } = await import("/src/game/registry.ts");
  const canvas = document.querySelector("#viewport canvas");
  const r = canvas.getBoundingClientRect();
  const w = G.g_camera_world_to_view;
  const eye = G.g_camera_block_eye;
  let best = null, bd = Infinity;
  for (const o of G.g_object_list) {
    if (o.despawned || o.dead || !o.visible || !ActorIsEnemy(o.cls)) continue;
    const p = { x: o.pos.x, y: o.pos.y + 5, z: o.pos.z };
    const vx = w[0] * p.x + w[4] * p.y + w[8] * p.z + w[12];
    const vy = w[1] * p.x + w[5] * p.y + w[9] * p.z + w[13];
    const vz = w[2] * p.x + w[6] * p.y + w[10] * p.z + w[14];
    if (vz >= -1) continue;
    const half = Math.tan((41.1 * Math.PI) / 360);
    const nx = vx / (-vz * half * (r.width / r.height));
    const ny = vy / (-vz * half);
    if (Math.abs(nx) > 0.95 || Math.abs(ny) > 0.95) continue;
    const d = (o.pos.x - eye.x) ** 2 + (o.pos.z - eye.z) ** 2;
    if (d < bd) {
      bd = d;
      best = { x: r.left + ((nx + 1) / 2) * r.width, y: r.top + ((1 - ny) / 2) * r.height };
    }
  }
  return best;
});

/** `G.g_frame` on a page, and again `ms` later. */
async function frameMoves(page, ms) {
  const a = await readG(page, (G) => G.g_frame);
  await page.waitForTimeout(ms);
  return [a, await readG(page, (G) => G.g_frame)];
}

/**
 * One session: a room made by the host, its link opened by the replica.
 * `both` goes on both pages' addresses (`relay=1`), `replicaQuery` on the
 * replica's alone (`netsim=...`).
 */
async function session(label, { both = "", replicaQuery = "", seconds, robust = false,
                                relayOnly = false }) {
  console.log(`\n${label}`);
  context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await open("host", `net=host${both ? `&${both}` : ""}`);
  await host.keyboard.press("Space"); // past the start screen, and play
  // The room the host made at the dev server's rendezvous, off its card.
  const code = await host.waitForSelector("#net-lobby .net-code", { timeout: 20_000 })
    .then((el) => el.textContent());
  console.log(`        room ${code}`);
  // Nobody to play with yet: the host's game waits, and its card says so.
  const [a, b] = await frameMoves(host, 1500);
  const card = await host.$eval("#net-lobby", (e) => e.textContent).catch(() => "");
  check(`the host's game waits for player 2 (frame ${a} then ${b}), and says so`,
        a === b && /held until they are in/.test(card), `${a} -> ${b}; card: ${card}`);
  const query = [both, replicaQuery].filter(Boolean).join("&");
  const replica = await open("replica", `${query}#join=${code}`);
  await replica.mouse.click(5, 5); // a press, for the audio; the start screen is the host's
  // Streaming: the replica verifies ticks. If it never does, what the lobby
  // card said about the search is the first thing worth knowing.
  let f = {};
  for (let i = 0; i < 60; i++) {
    f = await figures(replica);
    if (num(f["ticks verified"]) > 120) break;
    await replica.waitForTimeout(500);
  }
  const search = await replica.$eval("#net-lobby", (e) => e.textContent).catch(() => "");
  check("the replica connects, streams and verifies ticks", num(f["ticks verified"]) > 120,
        `${JSON.stringify(f)}; lobby: ${search}`);

  // Player 2 presses START. The shell goes through pending-start (10) and
  // into play (5) when the game lets a player in, which can take a while if
  // a cut is running: pressed again every couple of seconds, as a player would.
  let p2 = null;
  for (let i = 0; i < 80 && p2 !== 5; i++) {
    if (i % 8 === 0) await replica.keyboard.press("Enter");
    await replica.waitForTimeout(250);
    p2 = await readG(host, (G) => G.g_player_state[1]);
  }
  check("START on the replica puts player 2 in play on the host", p2 === 5,
        `g_player_state[1] = ${p2}`);

  // Player 2 shoots what it can see, through its own camera: for `seconds`,
  // and on until a hit has scored -- the host's game waited for player 2, so
  // the stage starts from its beginning, and the first zombies take a while.
  //
  // **The best score, not the last.** Aimed at "the nearest enemy", a shot
  // at a captor can take the civilian it holds, which costs player 2 100
  // points and a life (`ScoreAddForPlayer`, class 0x10), and the rewind puts
  // the score back with everything else. What this asks is whether player
  // 2's hits count on the host, and the best score seen says so.
  const start = Date.now();
  const end = start + seconds * 1000;
  const giveUp = end + 45_000;
  let shots = 0, reloads = 0;
  let rewound = false;
  let best = 0;
  while (Date.now() < end || (!best && Date.now() < giveUp)) {
    const t = await enemyOnScreen(replica);
    if (t) {
      await replica.mouse.click(t.x, t.y);
      shots++;
      if (shots % 6 === 0) { await replica.keyboard.press("KeyR"); reloads++; }
    }
    if (!rewound && Date.now() > start + seconds * 500) {
      rewound = true;
      await host.keyboard.press("ArrowLeft"); // a rewind: a new epoch
    }
    best = Math.max(best, await readG(host, (G) => G.g_player_score[1]));
    await replica.waitForTimeout(120);
  }
  console.log(`        ${shots} shots over ${((Date.now() - start) / 1000).toFixed(0)} s`);
  await replica.waitForTimeout(1500);
  const rf = await figures(replica);
  const hf = await figures(host);
  const score = await readG(host, (G) => G.g_player_score[1]);
  const epochs = [num(hf["epoch · tick"].split("·")[0]), num(rf["epoch · tick"].split("·")[0])];
  console.log(`        replica: ${JSON.stringify(rf)}`);
  console.log(`        host: ${JSON.stringify(hf)}`);
  check(`no tick the replica applied differed from the host's (${rf["ticks verified"]} verified)`,
        rf["hash mismatches"] === "0" && num(rf["ticks verified"]) > 300,
        `mismatches ${rf["hash mismatches"]}`);
  check("no delta failed to apply", rf["apply errors"] === "0", rf["apply errors"]);
  // The mirror the deltas land in is what the per-tick hash sees; this is the
  // state the page's systems made of it, re-read a few times a second.
  check("the replica's systems hold the state they were handed "
        + `(${rf["systems disagree"]} disagreements)`,
        rf["systems disagree"] === "0", rf["systems disagree"]);
  check("the replica's state matches the host's now",
        /matches/.test(rf.state ?? "") && num(rf["ticks verified"]) > 0, rf.state);
  check(`player 2's shots reached the host (${shots} fired, ${hf["presses taken"]} presses taken)`,
        shots > 5 && num(hf["presses taken"]) >= shots, "");
  check(`player 2's aim agrees with the host's camera (${hf["player 2's aim"]})`,
        /\d/.test(hf["player 2's aim"] ?? "") && num(hf["player 2's aim"]) < 0.05,
        hf["player 2's aim"]);
  check(`player 2's hits scored on the host (best ${best}, now ${score})`, best > 0,
        `best ${best}`);
  check(`the rewind moved both ends to the same new epoch (${epochs.join(" / ")})`,
        epochs[0] >= 2 && epochs[0] === epochs[1], JSON.stringify(epochs));
  check(`WebRTC connected (${rf.transport}, route ${rf.route}, ICE ${rf.ICE})`,
        /^webrtc/.test(rf.transport ?? "") && /connected|completed/.test(rf.ICE ?? ""), rf.ICE);
  if (relayOnly) {
    check(`...through the relay alone (${rf.route})`, /relay/.test(rf.route ?? ""), rf.route);
  }
  if (robust) await robustness(host, replica);
  await context.close();
}

/**
 * What a session has to survive: the host pausing, player 2 reloading their
 * tab mid-game, and the host moving to another stage.
 */
async function robustness(host, replica) {
  // The host pauses: player 2 is held, and says why.
  await host.keyboard.press("Space");
  let held = "";
  for (let i = 0; i < 20 && !/paused/.test(held); i++) {
    await replica.waitForTimeout(150);
    held = await replica.$eval("#net-overlay .net-held", (e) => e.textContent).catch(() => "");
  }
  check(`the host's pause holds player 2, and says so ("${held.trim()}")`, /paused/.test(held));
  // The host still sends a tick now and then while paused, so what changes
  // reaches player 2 -- but no game time passes on either screen. The first
  // of those ticks brings player 2 the ticks its buffer was still holding, so
  // settle first; then player 2 stands exactly where the host stands.
  await replica.waitForTimeout(600);
  const frame0 = await readG(replica, (G) => G.g_frame);
  const hostFrame = await readG(host, (G) => G.g_frame);
  const ticks0 = num((await figures(replica))["ticks verified"]);
  await replica.waitForTimeout(1000);
  const frame1 = await readG(replica, (G) => G.g_frame);
  const f1 = await figures(replica);
  check(`...player 2 stands on the host's frame while it is held (${frame0} and `
        + `${hostFrame}), and no game time passes (${frame1})`,
        frame0 === hostFrame && frame1 === frame0, `${frame0} / ${hostFrame} / ${frame1}`);
  check(`...and the held host's own ticks still verify (${ticks0} -> ${f1["ticks verified"]})`,
        num(f1["ticks verified"]) > ticks0 && f1["hash mismatches"] === "0", JSON.stringify(f1));
  await host.keyboard.press("Space");

  // Player 2 reloads the tab: the same game comes back, and matches.
  await replica.reload({ waitUntil: "domcontentloaded" });
  const stuck = await loaded(replica);
  if (stuck) {
    check("a reloaded player 2 loads the page", false, stuck);
    return;
  }
  let f = {};
  for (let i = 0; i < 60; i++) {
    f = await figures(replica);
    if (num(f["ticks verified"]) > 120) break;
    await replica.waitForTimeout(500);
  }
  check(`a reloaded player 2 rejoins the same room and verifies ticks (${f["ticks verified"]})`,
        num(f["ticks verified"]) > 120 && f["hash mismatches"] === "0", JSON.stringify(f));
  const hf = await figures(host);
  check(`...with the host back to streaming (${hf.phase})`, /streaming/.test(hf.phase ?? ""),
        hf.phase);

  // The host changes stage: player 2 loads it too, and it still matches.
  await host.click("#crumbs .crumb-trail");
  const picked = await host.$('#stage-picker button[data-stage="2"]');
  if (picked) {
    // A stage picked from the menu loads and plays by itself (`loadAndPlay`):
    // no Space here, which would pause it.
    await picked.click();
    const hostStuck = await loaded(host);
    if (hostStuck) {
      check("the host loads stage 2", false, hostStuck);
      return;
    }
    let rf2 = {};
    for (let i = 0; i < 80; i++) {
      await replica.waitForTimeout(500);
      rf2 = await figures(replica);
      if (num(rf2["ticks verified"]) > 200 && (await readG(replica, (G) => G.g_scene_index)) === 1) break;
    }
    const scene = await readG(replica, (G) => G.g_scene_index);
    check(`the host's stage change takes player 2 to stage 2 too (scene index ${scene}), `
          + `still matching (${rf2["hash mismatches"]} mismatches)`,
          scene === 1 && rf2["hash mismatches"] === "0" && num(rf2["ticks verified"]) > 200,
          JSON.stringify(rf2));
  } else {
    check("the host's menu offered stage 2", false, "no #stage-picker button for stage 2");
  }
}

const ONLY = flag("only", "");
try {
  if (!ONLY || ONLY === "clean") {
    await session(`stage ${STAGE}, two tabs over WebRTC`, { seconds: SECONDS, robust: true });
  }
  if (!ONLY || ONLY === "sim") {
    await session(`stage ${STAGE}, WebRTC, replica's link 60±30 ms, 10% loss`,
                  { replicaQuery: "netsim=lat:60,jit:30,loss:10", seconds: SECONDS });
  }
  if (!ONLY || ONLY === "relay") {
    await session(`stage ${STAGE}, WebRTC through the TURN relay alone (?relay=1)`,
                  { both: "relay=1", seconds: SECONDS, relayOnly: true });
  }
} finally {
  await browser.close();
  vite.kill("SIGTERM");
}
check(`nothing threw and nothing logged an error (${faults.length})`, faults.length === 0,
      faults.slice(0, 5).join(" | "));
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
