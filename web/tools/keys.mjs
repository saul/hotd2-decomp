/**
 * The page's keys, pressed in a real page.
 *
 *     node tools/keys.mjs            # npm run keys
 *     node tools/keys.mjs --head
 *
 * `test:ui` holds `ui/shortcuts.ts` to the handlers' source; this presses the
 * keys and reads back what they did -- the DOM, never an echo of this script
 * (`L44`). The `?` dialog opens, holds the game and lets go of it; an overlay
 * key flips its overlay and says so; `M` and `F` do what they say; a chord and
 * typing into a field are left alone.
 *
 * And the one it was written for: **a click on a control over the game hands
 * the keys back to the game.** Chrome leaves the focus on a clicked button,
 * and a focused button takes Space and Enter for itself -- so a click on the
 * speaker made the next Space a second click on the speaker, and the next
 * Enter (which is START: the continue, the skip) never reached the game. With
 * `ui/App.tsx`'s release taken out, the three checks that say so fail.
 */
import { openPlayer, requireBundle, waitForLoad } from "./lib/player.mjs";

requireBundle("keys");
const HEAD = process.argv.includes("--head");
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok || !detail ? "" : ` -- ${detail}`}`);
};

const { page, close, state: faults } = await openPlayer({
  url: "?stage=1", size: "1440x900", headless: !HEAD, quiet: true,
  debug: false,
});
const read = () => page.evaluate(() => ({
  dialog: !!document.querySelector("#shortcuts"),
  paused: document.querySelector("#paused-overlay")?.className ?? null,
  toast: document.querySelector("#toast.shown")?.textContent ?? null,
  boxes: [...document.querySelectorAll("#shortcuts dd")]
    .find((d) => d.textContent.startsWith("Boxes"))
    ?.querySelector(".state")?.textContent ?? null,
  sound: document.querySelector("#sound")?.getAttribute("aria-pressed"),
  fs: !!document.fullscreenElement,
  focus: document.activeElement?.tagName ?? null,
  menu: !!document.querySelector("#menu"),
}));
/**
 * `read()`, once it shows `want` -- or as it stands after three seconds, for
 * the check to fail on. A press lands in the page's next render, which is not
 * a fixed number of milliseconds away; the fixed sleeps this replaced were
 * ten seconds of a nineteen-second check. Where the claim is that something
 * did **not** happen, the wait stays a sleep: there is no event to wait for.
 */
const until = async (want, ms = 3000) => {
  const t0 = Date.now();
  for (;;) {
    const s = await read();
    if (want(s) || Date.now() - t0 > ms) return s;
    await page.waitForTimeout(25);
  }
};

try {
  await waitForLoad(page);
  await page.click(".start-btn");
  let s = await until((x) => x.paused === null);
  check("playing after Start", s.paused === null, JSON.stringify(s));

  // -- the ? dialog ------------------------------------------------------------
  await page.keyboard.press("Shift+Slash");
  s = await until((x) => x.dialog && x.paused !== null);
  check("? opens the list of keys", s.dialog, JSON.stringify(s));
  check("...holds the game", s.paused?.includes("is-paused") === true, s.paused);
  check("...and says the actor boxes are off", s.boxes === "off", s.boxes);
  await page.keyboard.press("KeyB");
  s = await until((x) => x.boxes === "on" && x.toast === "Boxes on");
  check("B turns the boxes on, and the list says so", s.boxes === "on",
        JSON.stringify(s));
  check("...with a toast over the game", s.toast === "Boxes on", s.toast);
  await page.keyboard.press("Escape");
  s = await until((x) => !x.dialog && x.paused === null);
  check("Escape closes it", !s.dialog);
  check("...and lets go of the game", s.paused === null, s.paused);
  await page.keyboard.press("Slash");
  check("a plain / opens it too", (await until((x) => x.dialog)).dialog);
  await page.mouse.click(20, 880);
  s = await until((x) => !x.dialog);
  check("a press on the dim round it closes it", !s.dialog);
  check("...and is not a shot at the game on the way", s.paused === null);

  // -- the menu holds the game, as the list does -------------------------------
  await page.click(".crumb-trail");
  s = await until((x) => x.menu && x.paused?.includes("is-paused") === true);
  check("opening the menu holds the game",
        s.menu && s.paused?.includes("is-paused") === true, JSON.stringify(s));
  await page.keyboard.press("Escape");
  s = await until((x) => !x.menu && x.paused === null);
  check("...and shutting it lets go", !s.menu && s.paused === null,
        JSON.stringify(s));

  // -- the page's other keys ---------------------------------------------------
  const before = (await read()).sound;
  await page.keyboard.press("KeyM");
  s = await until((x) => x.sound !== before);
  check("M flips the sound", s.sound !== before, `${before} -> ${s.sound}`);
  await page.keyboard.press("KeyF");
  const fsOn = (await until((x) => x.fs)).fs;
  await page.keyboard.press("KeyF");
  const fsOff = (await until((x) => !x.fs)).fs;
  check("F goes fullscreen and back", fsOn && !fsOff, `${fsOn} ${fsOff}`);
  await page.keyboard.press("KeyG");
  check("G says All regions on",
        (await until((x) => x.toast === "All regions on")).toast === "All regions on");
  // The toast is React's at once; the switch it flipped reaches the store
  // with the page's next published frame, and a G pressed before that reads
  // the switch as still off. Two frames, not a guess at milliseconds.
  await page.evaluate(() => new Promise((ok) =>
    requestAnimationFrame(() => requestAnimationFrame(ok))));
  await page.keyboard.press("KeyG");
  await page.keyboard.press("Meta+KeyB");
  // G's toast first, which comes whatever Cmd-B does; then the sleep, for a
  // Boxes toast that must not come after it.
  await until((x) => x.toast === "All regions off");
  await page.waitForTimeout(200);
  s = await read();
  check("a chord is the browser's: Cmd-B does not flip the boxes",
        s.toast === "All regions off", s.toast);

  // -- a click over the game gives the keys back -------------------------------
  const muted = (await read()).sound;
  await page.click("#sound");
  s = await until((x) => x.focus === "BODY" && x.sound !== muted);
  check("a click on the speaker leaves the focus with the page",
        s.focus === "BODY", s.focus);
  await page.keyboard.press("Space");
  s = await until((x) => x.paused?.includes("is-paused") === true);
  check("...so Space pauses the game, not the speaker pressed again",
        s.paused?.includes("is-paused") === true && s.sound !== muted,
        JSON.stringify(s));
  await page.keyboard.press("Space");
  await until((x) => x.paused === null);
  await page.click(".crumb-trail");
  await page.click(".crumb-trail");
  await page.waitForTimeout(200);
  const trail = (await read()).focus;
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  check("and Enter after opening and shutting the menu is START, not the menu",
        trail === "BODY" && !(await read()).menu, trail);

  // -- typing is typing --------------------------------------------------------
  await page.keyboard.press("Backquote");
  await page.click('.tabs [data-tab="script"]');
  await page.click('input[type="search"]');
  // Past the toast from the last overlay key, so a new one would be news.
  await until((x) => x.toast === null);
  await page.keyboard.type("bgm");
  await page.waitForTimeout(200);
  s = await read();
  check("letters typed into the script filter flip nothing",
        s.toast === null && !s.dialog, JSON.stringify(s));
  await page.click('.tabs [data-tab="inspect"]');
  await page.evaluate(() => {
    const d = document.querySelector("#panel-actors");
    if (d) d.open = true;
  });
  await page.waitForSelector(".key-hint", { timeout: 3000 }).catch(() => null);
  const hints = await page.evaluate(() =>
    [...document.querySelectorAll(".key-hint")].map((k) => k.textContent));
  check("the sidebar's overlay switches show their keys", hints.includes("B"),
        JSON.stringify(hints));
  // The one expected fault is the `_OFF` stop sound the game never shipped
  // (`audio/bgm.ts`); anything else the page complained of is counted.
  const other = faults.faultLines.filter((l) => !/_off\.wav/i.test(l));
  check("the page raised nothing else", other.length === 0, other.join(" | "));
} finally {
  await close();
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
