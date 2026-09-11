/**
 * Sound is a setting, and settings survive a reload.
 *
 * Three things were reported together and they are checked together here,
 * because they are one change: whether sound is on had to become stored state,
 * the volume slider had to move to the sidebar, and the speaker had to move to
 * the top bar.
 *
 * The reload is the point. `localStorage` is per browser and per origin, so a
 * check that only clicked the button and read it back would pass with nothing
 * persisted at all -- this navigates away and comes back, which is the thing
 * the reporter did.
 *
 *     node tools/sound_prefs.mjs [--headless]
 */
import { openPlayer, waitForLoad } from "./lib/player.mjs";

const headless = process.argv.includes("--headless");
let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  ok    ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
}

const { page, close } = await openPlayer({ headless, quiet: true });
const faults = [];
page.on("console", (m) => {
  if (m.type() === "error" && !m.location().url.endsWith("/favicon.ico")) {
    faults.push(m.text());
  }
});
page.on("pageerror", (e) => faults.push(e.message));

/** Where each control lives, and whether it is there at all. */
const places = () => page.evaluate(() => {
  const mute = document.querySelector("button.sound");
  const vol = document.querySelector("#volume");
  const inside = (el, id) => !!el?.closest(`#${id}`);
  return {
    mute: !!mute,
    muteInTopbar: inside(mute, "topbar"),
    muteInTransport: inside(mute, "transport"),
    volume: !!vol,
    volumeInSidebar: inside(vol, "panel-sound"),
    volumeInTransport: inside(vol, "transport"),
    value: vol ? Number(vol.value) : null,
    pressed: mute?.getAttribute("aria-pressed") ?? null,
  };
});

try {
  const base = page.url().split("?")[0];
  await page.goto(`${base}?stage=1`);
  await waitForLoad(page, "#loading"); await waitForLoad(page);

  console.log("where the two controls live:");
  const at = await places();
  check("the speaker is in the top bar", at.mute && at.muteInTopbar,
        JSON.stringify(at));
  check("...and not in the transport bar any more", !at.muteInTransport);
  check("the volume slider is in the sidebar's Sound panel",
        at.volume && at.volumeInSidebar, JSON.stringify(at));
  check("...and not in the transport bar any more", !at.volumeInTransport);

  console.log("\nand they survive a reload:");
  // Sound starts muted, so one press is "on". Then move the slider.
  await page.click("button.sound");
  await page.evaluate(() => {
    const v = document.querySelector("#volume");
    const set = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value").set;
    set.call(v, "23");
    v.dispatchEvent(new Event("input", { bubbles: true }));
    v.dispatchEvent(new Event("change", { bubbles: true }));
  });
  // Wait for the projection to carry the click rather than sampling straight
  // after it: the page publishes on its own frame, so an immediate read sees
  // the value from before the press and the check fails on its own timing.
  await page.waitForFunction(() => {
    const m = document.querySelector("button.sound");
    const v = document.querySelector("#volume");
    return m?.getAttribute("aria-pressed") === "true" && Number(v?.value) === 23;
  }, { timeout: 10_000 }).catch(() => {});
  const before = await places();
  check("sound is on and the volume is 23", before.pressed === "true"
        && before.value === 23, JSON.stringify(before));

  await page.goto(`${base}?stage=1`);
  await waitForLoad(page, "#loading"); await waitForLoad(page);
  const after = await places();
  check("after a reload the sound is still on", after.pressed === "true",
        `aria-pressed ${after.pressed}`);
  check("...and the volume is still 23", after.value === 23,
        `value ${after.value}`);

  // And the other way, which is the one that matters most: a viewer who left
  // it muted must not be given noise by the restore.
  await page.click("button.sound");
  await page.waitForFunction(() => document.querySelector("button.sound")
    ?.getAttribute("aria-pressed") === "false",
    { timeout: 10_000 }).catch(() => {});
  await page.goto(`${base}?stage=1`);
  await waitForLoad(page, "#loading"); await waitForLoad(page);
  const muted = await places();
  check("a viewer who muted it gets it muted back", muted.pressed === "false",
        `aria-pressed ${muted.pressed}`);

  check("no console errors or page exceptions", faults.length === 0,
        faults.join(" | "));
} finally {
  await close();
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
