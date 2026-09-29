/**
 * The crosshair in the real page: the game's own sprite for the Sight
 * Graphic, on the mouse, and none on a finger.
 *
 * `HudDrawCrosshair` (`FUN_004169C0`) draws for the mouse -- input modes 5
 * and 6 -- and never for a gun outside them, which is what the PC build's
 * light gun is (`0xD`, `InputModesFromDeviceConfig`). The page's finger is
 * that gun (`app/device.ts`): a touch puts this page's player in mode `0xD`
 * and the reticle goes, a mouse move puts them back in 6 and it returns. The
 * reticle is `g_crosshair_sprites[sight graphic + player*4]`, drawn at the
 * sprite's own size in the 640x480 screen and centred on the pointer.
 *
 * 1. **A touchscreen with a mouse** (`hasTouch`, 1280x960, under `?drive=1`):
 *    the mouse shows the sprite -- the bundle's own image for the id the game
 *    picked, at 32 screen pixels scaled to the frame, centred where the
 *    pointer is -- and a changed Sight Graphic changes it; a tap hides it
 *    and gives the system pointer back; a mouse move brings it back.
 * 2. **A phone** (`isMobile`, `hasTouch`, 844x390): no fine pointer, so the
 *    light gun from the first frame -- no reticle before, during or after
 *    play's first taps.
 * 3. With `--net`, **two tabs over netplay**: each page draws the other
 *    player's reticle with that player's sprite (player 2's is the blue set),
 *    and a tap on one page takes that player's reticle off the other --
 *    player 2's device travels in their input packet, as the byte at `+0x14`
 *    of the exe's own network packet does. Real time, so not in
 *    `verify_all.py`: parts 1 and 2 are.
 *
 * Every claim is read back out of the page -- `G`, the DOM, the bundle's own
 * file for the image -- never echoed from this script (L44). Screenshots go
 * to `web/shots/`.
 *
 *   HOTD2_BUNDLE=<dir> node tools/crosshair_page.mjs --headless [--net]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { WEB, SHOTS, freePort, openPlayer, requireBundle, serve,
         waitForLoad } from "./lib/player.mjs";

requireBundle("crosshair_page");

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const STAGE = 1;
/** `InputMode.MouseKeyboard` and `InputMode.LightGun1` (`game/input_mode.ts`). */
const MOUSE = 6, GUN = 0xd;

/** The bundle's own image for a screen sprite, out of the stage's file. */
const ROOT = process.env.HOTD2_BUNDLE ?? join(WEB, "..", "extract", "player");
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
const entry = manifest.stages.find((s) => s.stage === STAGE && s.game_mode === 0)
  ?? manifest.stages.find((s) => s.stage === STAGE);
const script = JSON.parse(readFileSync(join(ROOT, entry.name, entry.script), "utf8"));
const SPRITES = script.options?.crosshair_sprites ?? [];
const png = (id) => script.screen_sprites?.[String(id)]?.png ?? null;

const failures = [];
const check = (ok, what, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(what);
};

check(SPRITES.length === 8 && SPRITES.every((id) => png(id)),
      "the bundle has the eight crosshair sprites and their images",
      JSON.stringify(SPRITES));

/** `G`'s crosshair state, and the DOM's two reticles, on one page. */
const read = (page) => page.evaluate(async () => {
  const { G } = await import("/src/game/globals.ts");
  const bg = (el) => el?.style.backgroundImage.match(/^url\("?(.*?)"?\)$/)?.[1] ?? null;
  const box = (el) => {
    const r = el?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
  };
  const own = document.querySelector("#viewport .crosshair:not(.peer)");
  const peer = document.querySelector("#viewport .crosshair.peer");
  const canvas = document.querySelector("#viewport canvas");
  return {
    app: G.g_app_state, pstate: [...G.g_player_state], gate: G.g_nFiringGate,
    mode: [...G.g_input_mode], drawn: [...G.g_crosshair_drawn],
    sprite: [...G.g_crosshair_sprite], sight: [...G.g_player_sight_graphic],
    own: own ? { cls: own.className, hidden: own.hidden, bg: bg(own),
                 box: box(own) } : null,
    peer: peer ? { cls: peer.className, bg: bg(peer), box: box(peer) } : null,
    shooting: document.querySelector("#viewport")?.classList.contains("shooting"),
    canvas: box(canvas),
  };
});
const advance = (page, n) =>
  page.evaluate((k) => globalThis.__hotd2Drive.advance(k), n);
/** The projection is published with the frame; React renders it a task later. */
const settle = (page) => page.waitForTimeout(150);
const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;

/** Into play with the firing gate up: START skips the opening's cuts. */
async function intoPlay(page, each = async () => {}) {
  for (let i = 0; i < 400; i++) {
    const s = await read(page);
    if (s.app === 6 && s.pstate[0] === 5 && s.gate) return s;
    await each(s);
    if (i % 6 === 0) await page.keyboard.press("Enter");
    await advance(page, 20);
  }
  throw new Error(`never in play with the gate up: ${JSON.stringify(await read(page))}`);
}

// -- 1. a touchscreen with a mouse ---------------------------------------
console.log("\na touchscreen with a mouse:");
{
  const { page, close, state: faults } = await openPlayer({
    url: `?stage=${STAGE}&drive=1&seed=1`, size: "1280x960",
    headless: flag("headless"), quiet: !flag("loud"), debug: false,
    context: { hasTouch: true },
  });
  try {
    await waitForLoad(page);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Space");
    await advance(page, 2);
    const first = await read(page);
    const fine = await page.evaluate(() => matchMedia("(any-pointer: fine)").matches);
    console.log(`        before any pointer: mode ${first.mode[0].toString(16)}, `
                + `(any-pointer: fine) ${fine} on this emulated touchscreen`);
    const c = first.canvas;
    const P = { x: Math.round(c.x + c.w * 0.4), y: Math.round(c.y + c.h * 0.45) };
    await page.mouse.move(P.x, P.y);
    await intoPlay(page);
    await advance(page, 2);
    await settle(page);
    let s = await read(page);
    const want = SPRITES[s.sight[0]];
    const size = 32 * c.h / 480;
    check(s.mode[0] === MOUSE && s.drawn[0] === 1 && s.sprite[0] === want,
          "the mouse (mode 6): the game draws player 1's crosshair, the Sight "
          + `Graphic's sprite 0x${want?.toString(16)}`,
          `mode ${s.mode[0]} drawn ${s.drawn[0]} sprite ${s.sprite[0]}`);
    check(!!s.own && !s.own.hidden && s.own.cls.includes("sprite")
          && s.own.bg === png(want) && s.shooting,
          "...and the page's reticle is that sprite's image out of the bundle, "
          + "the system pointer hidden", JSON.stringify(s.own?.cls));
    check(!!s.own && near(s.own.box.w, size) && near(s.own.box.h, size)
          && near(s.own.box.x + s.own.box.w / 2, P.x)
          && near(s.own.box.y + s.own.box.h / 2, P.y),
          `...32 screen pixels scaled to the frame (${size.toFixed(1)} px) and `
          + "centred on the pointer", JSON.stringify(s.own?.box));
    await page.screenshot({ path: join(SHOTS, "crosshair-mouse.png") });

    // The Sight Graphic, as the options screen leaves it in the profile.
    await page.evaluate(async () => {
      const { G } = await import("/src/game/globals.ts");
      G.g_player_sight_graphic[0] = 2;
    });
    await advance(page, 2);
    await settle(page);
    s = await read(page);
    check(s.sprite[0] === SPRITES[2] && s.own?.bg === png(SPRITES[2])
          && s.own.bg !== png(want),
          `Sight Graphic 2: the reticle is 0x${SPRITES[2].toString(16)}'s image`,
          `sprite ${s.sprite[0]}`);
    await page.screenshot({ path: join(SHOTS, "crosshair-mouse-sight2.png") });

    // A finger: the light gun.
    const T = { x: Math.round(c.x + c.w * 0.6), y: Math.round(c.y + c.h * 0.5) };
    await page.touchscreen.tap(T.x, T.y);
    await advance(page, 2);
    await settle(page);
    s = await read(page);
    check(s.mode[0] === GUN && s.drawn[0] === 0,
          "a tap: player 1 is the light gun (0xD), and the game draws them no "
          + "crosshair", `mode ${s.mode[0]} drawn ${s.drawn[0]} gate ${s.gate}`);
    check(!!s.own && s.own.hidden && !s.shooting,
          "...so the page shows none, and the system pointer is back",
          JSON.stringify({ hidden: s.own?.hidden, shooting: s.shooting }));
    await advance(page, 30);
    await settle(page);
    s = await read(page);
    check(s.drawn[0] === 0 && s.own?.hidden === true,
          "...and still none half a second later: nothing puts it back but the "
          + "mouse", `drawn ${s.drawn[0]}`);
    await page.screenshot({ path: join(SHOTS, "crosshair-touch.png") });

    const Q = { x: Math.round(c.x + c.w * 0.3), y: Math.round(c.y + c.h * 0.6) };
    await page.mouse.move(Q.x, Q.y);
    await advance(page, 2);
    await settle(page);
    s = await read(page);
    check(s.mode[0] === MOUSE && s.drawn[0] === 1 && !s.own?.hidden
          && s.own?.bg === png(SPRITES[2])
          && near(s.own.box.x + s.own.box.w / 2, Q.x)
          && near(s.own.box.y + s.own.box.h / 2, Q.y),
          "a mouse move: mode 6 again, and the reticle is back where the "
          + "pointer is", `mode ${s.mode[0]} drawn ${s.drawn[0]}`);
    check(faults.faults === 0, "no console error or throw on the way",
          faults.faultLines.join(" | "));
  } catch (e) {
    failures.push(String(e));
    console.log(`  FAIL  ${e}`);
  } finally {
    await close();
  }
}

// -- 2. a phone -------------------------------------------------------------
console.log("\na phone:");
{
  const { page, close, state: faults } = await openPlayer({
    url: `?stage=${STAGE}&drive=1&seed=1`, size: "844x390",
    headless: flag("headless"), quiet: !flag("loud"), debug: false,
    context: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  });
  try {
    await waitForLoad(page);
    await page.keyboard.press("Space");
    let seen = 0, shown = 0;
    const s0 = await intoPlay(page, async (s) => {
      seen++;
      if (s.drawn[0] || (s.own && !s.own.hidden)) shown++;
    });
    check(s0.mode[0] === GUN, "no fine pointer: the light gun (0xD) from the "
          + "first frame, before any tap", `mode ${s0.mode[0]}`);
    const c = s0.canvas;
    for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.4], [0.7, 0.6]]) {
      await page.touchscreen.tap(Math.round(c.x + c.w * fx), Math.round(c.y + c.h * fy));
      await advance(page, 10);
      await settle(page);
      const s = await read(page);
      seen++;
      if (s.drawn[0] || (s.own && !s.own.hidden)) shown++;
    }
    const s = await read(page);
    check(shown === 0 && s.gate && s.own?.hidden === true && s.mode[0] === GUN,
          `no reticle on any of ${seen} looks -- into play, the firing gate up, `
          + "three taps", `shown ${shown}, gate ${s.gate}`);
    await page.screenshot({ path: join(SHOTS, "crosshair-phone.png") });
    check(faults.faults === 0, "no console error or throw on the way",
          faults.faultLines.join(" | "));
  } catch (e) {
    failures.push(String(e));
    console.log(`  FAIL  ${e}`);
  } finally {
    await close();
  }
}

// -- 3. two tabs over netplay -------------------------------------------
if (flag("net")) {
  console.log("\ntwo tabs over netplay:");
  const port = await freePort();
  const vite = await serve(port);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const faults = [];
  try {
    // One context, as `net_pair.mjs` has it (L77), with touch in it.
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 },
                                               hasTouch: true });
    const open = async (label, query) => {
      const page = await context.newPage();
      page.on("pageerror", (e) => faults.push(`${label} threw: ${e.message}`));
      page.on("console", (m) => {
        if (m.type() === "error" && !m.location().url.endsWith("/favicon.ico")) {
          faults.push(`${label}: ${m.text()}`);
        }
      });
      await page.addInitScript(() => {
        try {
          localStorage.setItem("hod2.viewPrefs",
                               JSON.stringify({ toggles: {}, muted: true }));
        } catch { /* */ }
      });
      await page.goto(`http://127.0.0.1:${port}/?stage=${STAGE}&${query}`,
                      { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#loading", { state: "detached", timeout: 120_000 });
      return page;
    };
    /** Poll `fn` on a page until it holds, or `ms` passes; the last value. */
    const until = async (page, fn, ms = 20_000) => {
      const end = Date.now() + ms;
      let v = await fn();
      while (!v.ok && Date.now() < end) {
        await page.waitForTimeout(200);
        v = await fn();
      }
      return v;
    };
    const host = await open("host", "net=host&matchmaker=local");
    await host.keyboard.press("Space");
    const code = await host.waitForSelector("#net-lobby .net-code", { timeout: 20_000 })
      .then((el) => el.textContent());
    const replica = await open("replica", `matchmaker=local#join=${code}`);
    await replica.mouse.click(5, 5);
    let s = await until(replica, async () => {
      const v = await read(host);
      if (v.pstate[1] !== 5) await replica.keyboard.press("Enter");
      return { ok: v.pstate[1] === 5, v };
    }, 60_000);
    check(s.ok, "player 2 joins from the replica", JSON.stringify(s.v?.pstate));
    const hc = (await read(host)).canvas;
    const rc = (await read(replica)).canvas;
    await host.mouse.move(hc.x + hc.w * 0.35, hc.y + hc.h * 0.5);
    await replica.mouse.move(rc.x + rc.w * 0.65, rc.y + rc.h * 0.5);
    // Both mice, the firing gate up: START on the host skips the cuts.
    s = await until(host, async () => {
      const v = await read(host);
      if (!v.gate) await host.keyboard.press("Enter");
      await replica.mouse.move(rc.x + rc.w * 0.65, rc.y + rc.h * 0.5 + (Date.now() % 7));
      return { ok: v.drawn[0] === 1 && v.drawn[1] === 1 && !!v.peer, v };
    }, 90_000);
    const h = s.v;
    // The replica has the host's `G` a round trip later.
    const r = (await until(replica, async () => {
      const v = await read(replica);
      return { ok: !!v.peer && v.drawn[0] === 1 && v.drawn[1] === 1, v };
    })).v;
    check(s.ok && h.mode[1] === MOUSE && h.peer?.cls.includes("sprite")
          && h.peer.bg === png(SPRITES[h.sight[1] + 4]),
          "the host draws player 2's reticle with player 2's sprite "
          + `(0x${SPRITES[(h.sight?.[1] ?? 0) + 4]?.toString(16)}, the blue set)`,
          JSON.stringify({ mode: h?.mode, drawn: h?.drawn, peer: h?.peer?.cls }));
    check(r.peer?.cls.includes("sprite") && r.peer.bg === png(SPRITES[r.sight[0]])
          && r.own && !r.own.hidden && r.own.bg === png(SPRITES[r.sight[1] + 4]),
          "...and the replica draws player 1's with player 1's, its own with "
          + "player 2's", JSON.stringify({ own: r.own?.cls, peer: r.peer?.cls,
                                           drawn: r.drawn, sight: r.sight }));
    await host.screenshot({ path: join(SHOTS, "crosshair-net-host.png") });
    await replica.screenshot({ path: join(SHOTS, "crosshair-net-replica.png") });

    // Player 2 taps: their light gun reaches the host in their packet.
    await replica.touchscreen.tap(Math.round(rc.x + rc.w * 0.5), Math.round(rc.y + rc.h * 0.5));
    s = await until(host, async () => {
      const v = await read(host);
      return { ok: v.mode[1] === GUN && v.drawn[1] === 0 && !v.peer, v };
    });
    const rr = await until(replica, async () => {
      const v = await read(replica);
      return { ok: v.own?.hidden === true, v };
    });
    check(s.ok && rr.ok, "a tap on the replica: player 2 is the light gun on the "
          + "host (0xD), the host shows no reticle for them, and neither does "
          + "their own page", JSON.stringify({ mode: s.v.mode, drawn: s.v.drawn,
                                               peer: !!s.v.peer, own: rr.v.own?.hidden }));
    await host.screenshot({ path: join(SHOTS, "crosshair-net-host-p2-touch.png") });
    await replica.mouse.move(rc.x + rc.w * 0.6, rc.y + rc.h * 0.4);
    s = await until(host, async () => {
      await replica.mouse.move(rc.x + rc.w * 0.6, rc.y + rc.h * 0.4 + (Date.now() % 5));
      const v = await read(host);
      return { ok: v.mode[1] === MOUSE && v.drawn[1] === 1 && !!v.peer, v };
    });
    check(s.ok, "...and their mouse moving puts it back", JSON.stringify(s.v.mode));

    // Player 1 taps: the replica loses player 1's reticle.
    await host.touchscreen.tap(Math.round(hc.x + hc.w * 0.5), Math.round(hc.y + hc.h * 0.5));
    const rp = await until(replica, async () => {
      const v = await read(replica);
      return { ok: v.mode[0] === GUN && !v.peer, v };
    });
    const hp = await read(host);
    check(rp.ok && hp.own?.hidden === true,
          "a tap on the host: player 1's light gun, no reticle for them on "
          + "either page", JSON.stringify({ mode: rp.v.mode, peer: !!rp.v.peer,
                                            own: hp.own?.hidden }));
    await replica.screenshot({ path: join(SHOTS, "crosshair-net-replica-p1-touch.png") });
    await context.close();
  } catch (e) {
    failures.push(String(e));
    console.log(`  FAIL  ${e}`);
  } finally {
    await browser.close();
    vite.kill("SIGTERM");
  }
  check(faults.length === 0, `nothing threw or logged an error (${faults.length})`,
        faults.slice(0, 4).join(" | "));
}

console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);
