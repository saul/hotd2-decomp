/**
 * The two halves of stage-to-stage flow, in the real page.
 *
 * **Where a stage starts is not a property of the stage.** A scene ends by
 * walking off the end of its route table, and the record it walks off names
 * the block it hands the next scene -- `EvtAdvanceStepOrRoute`
 * (`FUN_0045F000`) writes it into `g_evt_block_index` at `0x0045F0DA` and
 * nothing in the scene load touches it again. Two of stage 2's endings name
 * different blocks and two of stage 3's do, so **stage 3 opens at block 0 or
 * block 7 and stage 4 at block 0 or block 4**; every other stage has one.
 *
 * `tools/verify_scene_exits.py` asserts that against the exe's tables and
 * `test/seek.test.ts` drives the walker to each ending. Neither can see the
 * page. This checks the two things only the page has:
 *
 * 1. **The entry picker appears exactly where there is a choice** -- on stages
 *    3 and 4 and nowhere else -- and picking one reloads the stage there.
 * 2. **A stage that runs out advances to the next one**, on its own, without a
 *    reload, at the block the ending named.
 *
 * The second is driven under `?drive=1` from a deep link into the terminal
 * block rather than by playing a whole stage: this is a check of the seam, and
 * `tools/playthrough.mjs` is the tool that plays stages.
 *
 *     node tools/transitions.mjs [--headless]
 */
import { openPlayer, waitForLoad } from "./lib/player.mjs";

const headless = process.argv.includes("--headless");

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  ok    ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

/** The entry select's options and current value, or null when there is none. */
async function readEntryPicker(page) {
  return page.evaluate(() => {
    const sel = document.querySelector("#entry-select");
    if (!sel) return null;
    return {
      value: sel.value,
      options: [...sel.options].map((o) => o.value),
      text: [...sel.options].map((o) => o.textContent),
    };
  });
}

/** The walker's block, out of the HUD strip. */
async function readBlock(page) {
  return page.evaluate(() => {
    const el = document.querySelector("#panel-hud");
    if (!el) return null;
    const spans = [...el.querySelectorAll(".k, .v")];
    for (let i = 0; i + 1 < spans.length; i += 2) {
      if (spans[i].textContent.trim() === "block") {
        return spans[i + 1].textContent.trim();
      }
    }
    return null;
  });
}

const { page, close } = await openPlayer({ headless, quiet: true });

// `openPlayer`'s own fault counter includes the browser's unprompted
// `/favicon.ico`, which every page in this tree 404s and which says nothing
// about the player. Count the app's own errors instead.
const faults = [];
page.on("console", (m) => {
  if (m.type() === "error" && !m.location().url.endsWith("/favicon.ico")) {
    faults.push(m.text());
  }
});
page.on("pageerror", (e) => faults.push(e.message));

try {
  // -- 1. the picker is offered on exactly the stages that have a choice ----
  console.log("the entry picker appears where a stage has more than one entry:");
  const EXPECT = { 1: null, 2: null, 3: ["0", "7"], 4: ["0", "4"],
                   5: null, 6: null };
  for (const stage of [1, 2, 3, 4, 5, 6]) {
    await page.goto(page.url().split("?")[0] + `?stage=${stage}`);
    await waitForLoad(page, "#loading");
    await waitForLoad(page);
    const got = await readEntryPicker(page);
    const want = EXPECT[stage];
    if (want === null) {
      check(`stage ${stage}: no picker`, got === null,
            got ? `offered ${got.options.join(", ")}` : "");
    } else {
      check(`stage ${stage}: picker offers blocks ${want.join(" and ")}`,
            got !== null && String(got.options) === String(want),
            got ? `offered ${got.options.join(", ")}` : "no picker at all");
      check(`stage ${stage}: it opens on the first of them`,
            got?.value === want[0], `value ${got?.value}`);
    }
  }

  // -- 2. the deep link opens the stage at the entry it names ---------------
  console.log("\n`?entry=` opens the stage there:");
  for (const [stage, entry] of [[3, 7], [4, 4]]) {
    await page.goto(page.url().split("?")[0] + `?stage=${stage}&entry=${entry}`);
    await waitForLoad(page, "#loading");
    await waitForLoad(page);
    const picker = await readEntryPicker(page);
    check(`stage ${stage}: the picker shows block ${entry}`,
          picker?.value === String(entry), `value ${picker?.value}`);
    const block = await readBlock(page);
    check(`stage ${stage}: the walker is in block ${entry}, not 0`,
          block !== null && block.startsWith(String(entry)),
          `block reads "${block}"`);
  }

  // A link naming an entry the stage does not have is a stale link, and the
  // stage opens at its own first entry rather than replaying a route the game
  // cannot enter on.
  await page.goto(page.url().split("?")[0] + "?stage=1&entry=7");
  await waitForLoad(page, "#loading");
  await waitForLoad(page);
  check("stage 1: `entry=7`, which it does not have, opens at block 0",
        (await readBlock(page))?.startsWith("0") === true,
        `block reads "${await readBlock(page)}"`);

  // -- 3. a stage that runs out advances to the next one --------------------
  //
  // Stage 1 ends at block 14, whose terminal record names block 0 for stage 2.
  // Deep-linking there and playing runs the last block out, walks the route
  // onto the hole after it, and the page should follow the handover on its own.
  console.log("\na stage that runs out advances to the next one:");
  await page.goto(page.url().split("?")[0]
                  + "?stage=1&block=14&mode=play&drive=1&seed=1");
  await waitForLoad(page, "#loading");
  await waitForLoad(page);
  const before = await page.evaluate(() => location.search);
  check("stage 1 opens on its terminal block", before.includes("stage=1"),
        before);

  // The transport's own button, not the mode button beside it: "Play" is a
  // *mode* and this needs the clock started, which is `\u25b6`.
  await page.evaluate(() => {
    document.querySelectorAll("button").forEach((b) => {
      if (b.textContent.trim() === "\u25b6") b.click();
    });
  });
  // One frame, so the projection carries the click before it is read.
  await page.evaluate(() => globalThis.__hotd2Drive.advance(1));
  check("the transport is running",
        await page.evaluate(() => !document.querySelector("#paused-overlay")));
  let moved = null;
  for (let i = 0; i < 400 && moved === null; i++) {
    await page.evaluate(() => globalThis.__hotd2Drive.advance(60));
    const q = await page.evaluate(() => location.search);
    if (q.includes("stage=2")) moved = q;
  }
  check("it reaches stage 2 without a reload", moved !== null,
        `still ${await page.evaluate(() => location.search)}`);
  if (moved) {
    check("and at block 0, which is what stage 1's ending names",
          !moved.includes("entry=") || moved.includes("entry=0"), moved);
    await waitForLoad(page);
    check("the transport is still running, as a run does not stop between "
          + "stages",
          await page.evaluate(() => !document.querySelector("#paused-overlay")));
  }

  check("no console errors or page exceptions", faults.length === 0,
        faults.join(" | "));
} finally {
  await close();
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
