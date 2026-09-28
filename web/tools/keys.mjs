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

try {
  await waitForLoad(page);
  await page.click(".start-btn");
  await page.waitForTimeout(1500);
  let s = await read();
  check("playing after Start", s.paused === null, JSON.stringify(s));

  // -- the ? dialog ------------------------------------------------------------
  await page.keyboard.press("Shift+Slash");
  await page.waitForTimeout(300);
  s = await read();
  check("? opens the list of keys", s.dialog, JSON.stringify(s));
  check("...holds the game", s.paused?.includes("is-paused") === true, s.paused);
  check("...and says the actor boxes are off", s.boxes === "off", s.boxes);
  await page.keyboard.press("KeyB");
  await page.waitForTimeout(200);
  s = await read();
  check("B turns the boxes on, and the list says so", s.boxes === "on",
        JSON.stringify(s));
  check("...with a toast over the game", s.toast === "Boxes on", s.toast);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  s = await read();
  check("Escape closes it", !s.dialog);
  check("...and lets go of the game", s.paused === null, s.paused);
  await page.keyboard.press("Slash");
  await page.waitForTimeout(200);
  check("a plain / opens it too", (await read()).dialog);
  await page.mouse.click(20, 880);
  await page.waitForTimeout(300);
  s = await read();
  check("a press on the dim round it closes it", !s.dialog);
  check("...and is not a shot at the game on the way", s.paused === null);

  // -- the menu holds the game, as the list does -------------------------------
  await page.click(".crumb-trail");
  await page.waitForTimeout(300);
  s = await read();
  check("opening the menu holds the game",
        s.menu && s.paused?.includes("is-paused") === true, JSON.stringify(s));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  s = await read();
  check("...and shutting it lets go", !s.menu && s.paused === null,
        JSON.stringify(s));

  // -- the page's other keys ---------------------------------------------------
  const before = (await read()).sound;
  await page.keyboard.press("KeyM");
  await page.waitForTimeout(200);
  s = await read();
  check("M flips the sound", s.sound !== before, `${before} -> ${s.sound}`);
  await page.keyboard.press("KeyF");
  await page.waitForTimeout(500);
  const fsOn = (await read()).fs;
  await page.keyboard.press("KeyF");
  await page.waitForTimeout(500);
  const fsOff = (await read()).fs;
  check("F goes fullscreen and back", fsOn && !fsOff, `${fsOn} ${fsOff}`);
  await page.keyboard.press("KeyG");
  await page.waitForTimeout(200);
  check("G says All regions on", (await read()).toast === "All regions on");
  await page.keyboard.press("KeyG");
  await page.keyboard.press("Meta+KeyB");
  await page.waitForTimeout(200);
  s = await read();
  check("a chord is the browser's: Cmd-B does not flip the boxes",
        s.toast === "All regions off", s.toast);

  // -- a click over the game gives the keys back -------------------------------
  const muted = (await read()).sound;
  await page.click("#sound");
  await page.waitForTimeout(200);
  s = await read();
  check("a click on the speaker leaves the focus with the page",
        s.focus === "BODY", s.focus);
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  s = await read();
  check("...so Space pauses the game, not the speaker pressed again",
        s.paused?.includes("is-paused") === true && s.sound !== muted,
        JSON.stringify(s));
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
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
  await page.waitForTimeout(400);
  await page.click('.tabs [data-tab="script"]');
  await page.click('input[type="search"]');
  // Past the toast from the last overlay key, so a new one would be news.
  await page.waitForTimeout(1600);
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
  await page.waitForTimeout(300);
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
