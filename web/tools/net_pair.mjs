/**
 * Two-player netplay in the real page: a host and a replica, two tabs of one
 * headless Chrome, playing a stage -- joined the way a player joins (a room
 * at the dev server's rendezvous, its link opened in the second tab, which
 * finds the host in the same browser), over `?net=local-host` /
 * `?net=local-join` with a bad link, and over WebRTC (`?rtc=1`).
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
 * - and all of it again with the replica's outgoing link made bad, and over
 *   WebRTC; and, with Chrome hiding host addresses behind mDNS names as it
 *   does for every real user, WebRTC either connects or the lobby says why.
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
// Host candidates as plain addresses: two pages of one browser on one machine
// find each other that way whether or not mDNS resolves, or STUN is reachable.
// **No real user's browser does this** -- the flag hid, for a whole round of
// testing, that two tabs over WebRTC do not connect on this machine (L80) --
// so the last section launches Chrome again without it.
let browser = await chromium.launch({
  channel: "chrome", headless: true,
  args: ["--disable-features=WebRtcHideLocalIpsWithMdns"],
});
const faults = [];
// One context for both tabs: `browser.newPage` would give each its own, and a
// `BroadcastChannel` does not cross contexts any more than it crosses profiles.
let context = null;

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
  await page.waitForSelector("#loading", { state: "detached", timeout: 120_000 });
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
 * One session. `how`: "room" -- an online room, its link opened in the second
 * tab, which pairs over the same-browser path; "local" -- `?net=local-host`
 * and `?net=local-join`; "webrtc" -- a room with `?rtc=1` on both pages.
 */
async function session(label, replicaQuery, seconds, how) {
  console.log(`\n${label}`);
  context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await open("host", how === "local" ? "net=local-host"
    : how === "webrtc" ? "net=host&rtc=1" : "net=host");
  await host.keyboard.press("Space"); // past the start screen, and play
  let replica;
  if (how !== "local") {
    // The room the host made at the dev server's rendezvous, off its card.
    const code = await host.waitForSelector("#net-lobby .net-code", { timeout: 20_000 })
      .then((el) => el.textContent());
    console.log(`        room ${code}`);
    // Nobody to play with yet: the host's game waits, and its card says so.
    const [a, b] = await frameMoves(host, 1500);
    const card = await host.$eval("#net-lobby", (e) => e.textContent).catch(() => "");
    check(`the host's game waits for player 2 (frame ${a} then ${b}), and says so`,
          a === b && /held until they are in/.test(card), `${a} -> ${b}; card: ${card}`);
    const rtc = how === "webrtc" ? "rtc=1&" : "";
    replica = await open("replica", `${rtc}${replicaQuery}#join=${code}`);
  } else {
    replica = await open("replica", `net=local-join&${replicaQuery}`);
  }
  await replica.mouse.click(5, 5); // a press, for the audio; the start screen is the host's
  // Streaming: the replica verifies ticks.
  let f = {};
  for (let i = 0; i < 60; i++) {
    f = await figures(replica);
    if (num(f["ticks verified"]) > 120) break;
    await replica.waitForTimeout(500);
  }
  check("the replica streams and verifies ticks", num(f["ticks verified"]) > 120,
        JSON.stringify(f));

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

  // Player 2 shoots what it can see, through its own camera.
  const end = Date.now() + seconds * 1000;
  let shots = 0, reloads = 0;
  let rewound = false;
  while (Date.now() < end) {
    const t = await enemyOnScreen(replica);
    if (t) {
      await replica.mouse.click(t.x, t.y);
      shots++;
      if (shots % 6 === 0) { await replica.keyboard.press("KeyR"); reloads++; }
    }
    if (!rewound && Date.now() > end - seconds * 500) {
      rewound = true;
      await host.keyboard.press("ArrowLeft"); // a rewind: a new epoch
    }
    await replica.waitForTimeout(120);
  }
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
  check(`player 2 scored (${score})`, score > 0, `score ${score}`);
  check(`the rewind moved both ends to the same new epoch (${epochs.join(" / ")})`,
        epochs[0] >= 2 && epochs[0] === epochs[1], JSON.stringify(epochs));
  if (how === "webrtc") {
    check(`WebRTC connected (${rf.transport}, route ${rf.route}, ICE ${rf.ICE})`,
          rf.transport.startsWith("webrtc") && /connected|completed/.test(rf.ICE), rf.ICE);
    await robustness(host, replica);
  }
  if (how === "room") {
    check(`the second tab found the host in its own browser, no WebRTC (${rf.transport})`,
          /^local/.test(rf.transport ?? ""), rf.transport);
  }
  await context.close();
}

/**
 * WebRTC between two tabs with Chrome as users have it: host addresses hidden
 * behind mDNS names. Where the name resolves it connects; where it does not
 * -- a Mac that has not given the browser Local Network access -- ICE finds
 * no pair, and the page must say so rather than show "connecting" for ever.
 */
async function mdnsSession() {
  console.log("\nstage 1, WebRTC with Chrome's mDNS host names, as a real browser has them");
  context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await open("host", "net=host&rtc=1");
  const code = await host.waitForSelector("#net-lobby .net-code", { timeout: 20_000 })
    .then((el) => el.textContent());
  const replica = await open("replica", `rtc=1#join=${code}`);
  let connected = false, hint = "", path = "";
  for (let i = 0; i < 50 && !connected && !hint; i++) {
    await replica.waitForTimeout(500);
    connected = /connected|completed/.test((await figures(replica)).ICE ?? "");
    hint = await replica.$eval("#net-lobby .net-hint", (e) => e.textContent).catch(() => "");
    path = await replica.$eval("#net-lobby .net-path", (e) => e.textContent).catch(() => path);
  }
  const hostPath = await host.$eval("#net-lobby .net-path", (e) => e.textContent).catch(() => "");
  console.log(`        ${connected ? "connected" : `not connected: ${path}`}`);
  if (!connected) console.log(`        host: ${hostPath}`);
  check("WebRTC either connects or, within 25 s, the lobby says why "
        + `(${connected ? "connected" : "explained"})`,
        connected || (hint.length > 40 && /offered/.test(path)), `path "${path}", hint "${hint}"`);
  if (!connected) {
    check("...and the host's card shows the same search", /offered/.test(hostPath), hostPath);
  }
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
  await replica.waitForSelector("#loading", { state: "detached", timeout: 120_000 });
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
    await host.waitForSelector("#loading", { state: "detached", timeout: 120_000 });
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
  if (!ONLY || ONLY === "local") {
    await session(`stage ${STAGE}, a room, its link opened in a second tab`, "", SECONDS, "room");
  }
  if (!ONLY || ONLY === "sim") {
    await session(`stage ${STAGE}, two tabs, replica's link 60±30 ms, 10% loss`,
                  "netsim=lat:60,jit:30,loss:10", SECONDS, "local");
  }
  if (!ONLY || ONLY === "webrtc") {
    await session(`stage ${STAGE}, WebRTC through the dev server's rendezvous`,
                  "", SECONDS, "webrtc");
  }
  if (!ONLY || ONLY === "mdns") {
    // One Chrome at a time (L29): the first goes before this one comes.
    await browser.close();
    browser = await chromium.launch({ channel: "chrome", headless: true });
    await mdnsSession();
  }
} finally {
  await browser.close();
  vite.kill("SIGTERM");
}
check(`nothing threw and nothing logged an error (${faults.length})`, faults.length === 0,
      faults.slice(0, 5).join(" | "));
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
