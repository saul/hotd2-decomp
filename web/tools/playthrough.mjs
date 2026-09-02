/**
 * Play a stage from its entry block to an end block, and say where it hangs.
 *
 * The player can be watched, but a stage is forty blocks of script and a hang
 * is a thing that looks exactly like a slow bit until you have stared at it for
 * a minute. This drives one instead: it reads the walker's address out of the
 * HUD, and **an address that has not moved is the whole signal.** This is an
 * arcade game — no authored sequence in it is fifteen seconds long — so
 * fifteen seconds on one instruction is a hang, and the tool says which
 * instruction and what it was waiting for.
 *
 * It starts each stage at its **entry block** and never deep-links to an
 * address: a seek is its own rebuild path with its own bugs, and a run that
 * begins mid-stage would be testing that instead of the stage.
 *
 * The reason it needs to shoot is that the interesting waits are the room
 * clears. With shooting **off** `WalkerHost.aliveEnemies` answers null and
 * every live-enemy gate passes untested, so a playthrough would sail through
 * exactly the fights it exists to exercise — and the walker would drop the
 * spawns out from under them. So shooting goes on, and when the script is
 * parked on an **enemy** gate this fires a volley through the real shot path:
 * pointer events on `#viewport`, `Shooting.fire`, the ray, the per-bone
 * spheres, `ResolveHit`. Nothing is faked.
 *
 * A volley is a grid because the harness cannot see where the actors are: the
 * projection carries no screen positions and inventing a seam to publish them
 * would be a seam that only this tool uses. Spraying the frame is cruder than a
 * player and hits the same spheres.
 *
 * **It never shoots at a civilian gate, and never clears one.** You are not
 * meant to shoot civilians in this game — they are mauled by the zombies or
 * you move past them — so a `wait_scripted_actors` that does not come down on
 * its own is a bug by definition, and a tool that killed its way through would
 * be hiding the thing it exists to find.
 *
 * `--shoot-for` is the honest fallback, and only for enemies. If a room will
 * not clear the enemies are somewhere the shots cannot reach, which is worth
 * knowing on its own, so it is **reported** rather than silently papered over.
 *
 *   node tools/playthrough.mjs --stage 2
 *   node tools/playthrough.mjs --stage 2 --headless --hang 20
 *
 * Exit status is 0 only if the stage reached an end block.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { openPlayer, waitForLoad, enableShooting, SHOTS } from "./lib/player.mjs";

const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const flag = (n) => args.includes(`--${n}`);

const stage = opt("stage", "2");
/** Seconds on one instruction before the tool starts shooting at the problem. */
const PATIENCE = Number(opt("patience", "3")) * 1000;
/** Seconds on one instruction before it is a hang. */
const HANG = Number(opt("hang", "15")) * 1000;
/** Seconds of shooting at one gate before falling back to the debug clear. */
const SHOOT_FOR = Number(opt("shoot-for", "8")) * 1000;
/** Wall-clock cap for the whole run. */
const BUDGET = Number(opt("budget", "600")) * 1000;
const POLL = 250;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The walker's address and what it is blocked on, out of the two panels. */
async function readState(page) {
  return page.evaluate(() => {
    const rowsOf = (id) => {
      const el = document.querySelector(id);
      if (!el) return {};
      const out = {};
      // The strip is a grid of key/value spans in document order.
      const spans = [...el.querySelectorAll(".k, .v")];
      for (let i = 0; i + 1 < spans.length; i += 2) {
        if (spans[i].className === "k" && spans[i + 1].className === "v") {
          out[spans[i].textContent.trim()] = spans[i + 1].textContent.trim();
        }
      }
      return out;
    };
    const hud = rowsOf("#panel-hud");
    const wait = document.querySelector("#panel-wait");
    const waitText = wait ? wait.innerText : "";
    const policy = /policy:\s*([a-z]+)/.exec(waitText)?.[1] ?? null;
    const sub = wait?.querySelector("summary")?.innerText.trim() ?? "";
    return {
      block: hud["block"] ?? "", step: hud["step / op"] ?? "",
      spawns: hud["spawns"] ?? "", lives: hud["lives"] ?? "",
      skip: hud["skip"] ?? "",
      policy, sub, waitText,
    };
  });
}

/** One volley: pointer events across the frame, through the real shot path. */
async function volley(page) {
  const box = await page.locator("#viewport").boundingBox();
  if (!box) return;
  const COLS = 5, ROWS = 4;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = box.x + (box.width * (c + 0.5)) / COLS;
      const y = box.y + (box.height * (r + 0.5)) / ROWS;
      await page.mouse.click(x, y);
    }
  }
}

const started = Date.now();
const { page, state, close } = await openPlayer({
  url: `?stage=${stage}`, size: opt("size", "1280x800"),
  headless: flag("headless"), quiet: true,
});

let exit = 1;
try {
  await waitForLoad(page);
  await enableShooting(page);
  await page.keyboard.press("Space");                 // play

  let addr = null;
  let addrAt = Date.now();
  let volleys = 0;
  let killedHere = false;
  let killed = 0;
  let steps = 0;
  let last = null;

  for (;;) {
    const s = await readState(page);
    const here = `${s.block} ${s.step}`;
    if (here !== addr) {
      addr = here;
      addrAt = Date.now();
      volleys = 0;
      killedHere = false;
      steps += 1;
      // One line per address is too much for forty blocks; one per block is
      // the shape of the run.
      const blk = s.block.split(" ")[0];
      if (blk !== last) {
        last = blk;
        const t = ((Date.now() - started) / 1000).toFixed(0);
        console.log(`  ${t}s  block ${s.block}  ${s.spawns}  lives ${s.lives}`);
      }
    }

    if (/\(end/.test(s.block)) {
      const t = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`\nreached an end block after ${t}s, ${steps} instructions`
                  + `${killed ? ` (${killed} gates needed the debug clear)` : ""}`);
      exit = state.faults ? 1 : 0;
      break;
    }

    // Take every skip the script offers, which is what an arcade player does
    // and what keeps a stage inside a sane wall clock: stage 1 opens with
    // nearly a minute of cathedral before the first zombie. `Enter` is the
    // player's own binding for it, and a skippable region walks the whole
    // cutscene rather than one wait.
    if (s.skip.startsWith("offered")) {
      await page.keyboard.press("Enter");
    }

    const stalled = Date.now() - addrAt;
    if (stalled > HANG) {
      console.log(`\nHUNG at block ${s.block} step/op ${s.step}`);
      if (s.policy === "civilians") {
        console.log("  a civilian gate, which nothing here touches on purpose:"
                    + " you do not shoot civilians in this game, so one that"
                    + " does not come down on its own is the bug.");
      }
      console.log(`  ${stalled / 1000}s on one instruction, and no authored `
                  + `sequence in this game is that long.`);
      for (const line of s.waitText.split("\n").filter((l) => l.trim()
                                                      && l.trim() !== "box")) {
        console.log(`    ${line.trim()}`);
      }
      mkdirSync(SHOTS, { recursive: true });
      const path = resolve(SHOTS, `hang-stage${stage}.png`);
      await page.screenshot({ path });
      console.log(`  wrote ${path}`);
      break;
    }

    if (stalled > PATIENCE && s.policy === "enemies") {
      // Time, not volley count: a volley is twenty round trips to the browser
      // and takes about a second, so counting them made the fallback land
      // after the hang deadline rather than before it.
      if (stalled < SHOOT_FOR) {
        volleys += 1;
        await volley(page);
      } else if (!killedHere) {
        killedHere = true;
        killed += 1;
        console.log(`      enemy gate at block ${s.block} ${s.step} did `
                    + `not clear in ${volleys} volleys over `
                    + `${(SHOOT_FOR / 1000).toFixed(0)}s — the enemies are `
                    + `somewhere the shots cannot reach. Using the debug clear.`);
        await page.click('button[title^="Kill every live actor"]');
      }
    }

    if (Date.now() - started > BUDGET) {
      console.log(`\nout of budget after ${BUDGET / 1000}s at block ${s.block}`);
      break;
    }
    await sleep(POLL);
  }
  if (state.faults) console.log(`\n${state.faults} console errors on the way`);
} finally {
  await close();
}
process.exit(exit);
