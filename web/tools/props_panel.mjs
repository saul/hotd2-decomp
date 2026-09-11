/**
 * Does a deep link's props panel say what the port holds?
 *
 *     node tools/props_panel.mjs --headless
 *
 * `tools/props43.mjs` asks whether stage 3 places its class-0x41 props; this
 * asks the question that report was really about — **whether the page agrees**
 * — and it is the only check in the tree that reads the Props panel at all.
 * `L15`: a green build is not a working page, and `verify_player_dom.py` can
 * say an id is rendered but not what is written next to it.
 *
 * ## What it is guarding, and what it was written after
 *
 * `?stage=3&mode=play&block=0&step=3` was reported as "props 0 / 0,
 * breakables none placed" against a headless harness that claimed two props at
 * the same address, and the suspicion was that a URL seek drops props — which
 * would make every deep link anyone uses to inspect a prop bug misleading.
 * **It does not.** Three separate facts came out of it, and each is one of the
 * assertions below, because all three read as "the props are gone":
 *
 *  1. `props 0 / 0` is `render/props.ts` — the scripted scenery, the hinged
 *     doors and their statics. Stage 3's bundle has **zero** of each, so that
 *     row is correct and has nothing to do with class 0x41. Two rows, two
 *     subjects, one word.
 *  2. At `block=0&step=3` the seek lands at **op 0**, and the step places its
 *     props with `spawn_placed` at ops 10 and 11 — behind
 *     `wait_enemies_alive <= 0` at op 8. There is a room to clear first, so
 *     `none placed` is the truth about that address.
 *  3. At `block=0&step=3&op=12`, past both placers, the props appear — but not
 *     until the transport has run a frame. `PropContainerPlacerUpdate` is a
 *     class handler, and a paused player hands `world.update` a
 *     `STOPPED_TICK`, so `GameUpdate` never runs and the placers sit in the
 *     pool with nothing built. A seek that has arrived is therefore *expected*
 *     to show nothing built while paused, and one frame is the whole cure —
 *     so the row has to distinguish that from an address where the script
 *     places nothing at all, and this is what checks that it does.
 *
 * The page is driven with `?drive=1` so the frames are counted rather than
 * waited for. Every read is preceded by a frame assertion: an earlier attempt
 * at this measurement watched a panel while the run had not advanced at all
 * and could not tell, which is no measurement.
 */
import { openPlayer, waitForLoad } from "./lib/player.mjs";
import { hasStage, skipNoBundle } from "./lib/bundle_root.ts";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The page cannot load a stage nothing exported, and a browser waiting
// sixty seconds for `#loading` to go is indistinguishable from a hang
// (`L33`). Skip with 3 rather than fail -- `L14`.
if (!hasStage(3)) skipNoBundle("props-panel (stage 3)");

let bad = 0;
const check = (what, ok, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? ` — ${detail}` : ""}`);
  if (!ok) bad++;
};

/** The Props panel's rows, by label. It folds by default, so open it first. */
async function rows(page) {
  await page.evaluate(() => {
    const d = document.querySelector("#panel-props");
    if (d) d.open = true;
  });
  // The panel's body mounts on the next React commit, and each row is then
  // filled by the frame after that.
  await sleep(350);
  return page.evaluate(() => {
    const d = document.querySelector("#panel-props");
    if (!d) return null;
    const out = {};
    for (const r of d.querySelectorAll(".dbg-row, .dbg > div")) {
      const label = r.querySelector("span, b, strong")?.innerText?.trim();
      if (label) out[label] = r.innerText.replace(label, "").trim();
    }
    // Belt and braces: the row markup is `ui/`'s to change, so the whole
    // panel's text travels too and the assertions below can fall back to it.
    out.__text = d.innerText.replace(/\s*\n\s*/g, " | ");
    return out;
  });
}

/** `breakables | 3 up (3 drawn)` → `3 up (3 drawn)`, however `ui/` lays it out. */
const row = (r, label) => {
  if (r?.[label]) return r[label];
  const m = new RegExp(`${label} \\| ([^|]*)`).exec(r?.__text ?? "");
  return m ? m[1].trim() : "(no row)";
};

async function at(url) {
  const { page, state, close } = await openPlayer({
    url, size: "1280x900", headless: flag("headless"), quiet: true,
  });
  await waitForLoad(page);
  await sleep(400);
  return { page, state, close };
}

/** The driven harness's own row: the walker's address and `g_frame`. */
const now = (page) => page.evaluate(() => window.__hotd2Drive?.now() ?? null);

console.log("\nA deep link before the placer — the room is not cleared:\n");
{
  const { page, state, close } = await at(
    "?stage=3&mode=play&block=0&step=3&drive=1");
  try {
    const n = await now(page);
    check("the drive harness is installed and the seek arrived at op 0",
          n?.a === "0/3/0", `walker at ${n?.a ?? "?"}`);
    const r = await rows(page);
    check("`props` is the scene-prop layer, and stage 3 has none of those",
          row(r, "props") === "0 / 0", row(r, "props"));
    check("`breakables` says none placed, because op 10 has not run",
          row(r, "breakables") === "none placed", row(r, "breakables"));
    // Nothing must move without a frame being asked for, or the two reads
    // above were of different worlds.
    check("...and no game frame ran to get there", n?.g === 0 && n?.f === 0,
          `g_frame ${n?.g}, driven ${n?.f}`);
    check("no console faults", state.faults === 0,
          state.faultLines.join(" ; "));
  } finally { await close(); }
}

console.log("\nThe same link past both placers — paused, then one frame:\n");
{
  const { page, state, close } = await at(
    "?stage=3&mode=play&block=0&step=3&op=12&drive=1");
  try {
    const n0 = await now(page);
    check("the seek arrived at op 12", n0?.a === "0/3/12",
          `walker at ${n0?.a ?? "?"}`);
    const paused = await rows(page);
    // **And it says which of the two it is.** `none placed` is reserved for
    // the address where the script has placed nothing; here the placers are in
    // the pool and only a frame is missing, and the row has to say so or the
    // distinction this file exists to draw is one nothing checks — `L26`.
    check("paused, `breakables` names the placers waiting for a frame",
          /^none built yet — 3 placers in the pool/.test(
            row(paused, "breakables")),
          row(paused, "breakables"));

    // The transport, and then exactly the frames asked for.
    await page.click("body");
    await page.keyboard.press("Space");
    await sleep(150);
    await page.evaluate(() => window.__hotd2Drive.advance(1));
    await sleep(350);
    const n1 = await now(page);
    check("one game frame ran", n1?.g === 1 && n1.f === n0.f + 1,
          `g_frame ${n0?.g} -> ${n1?.g}, driven ${n0?.f} -> ${n1?.f}`);

    const live = await rows(page);
    const b = row(live, "breakables");
    check("...and the three class-0x41 props of that step are placed",
          /^3 up \(3 drawn\)/.test(b), b);
    check("no console faults", state.faults === 0,
          state.faultLines.join(" ; "));
  } finally { await close(); }
}

console.log(bad ? `\n${bad} failed` : "\nall passed");
process.exit(bad ? 1 : 0);
