/**
 * Play a stage from its entry block to an end block, and say where it hangs.
 *
 * The player can be watched, but a stage is forty blocks of script and a hang
 * is a thing that looks exactly like a slow bit until you have stared at it for
 * a minute. This drives one instead: it reads the walker's address out of the
 * HUD, and **an address that has not moved is the whole signal.** This is an
 * arcade game — no authored sequence in it is fifteen seconds long — so fifteen
 * seconds on one instruction is a hang, and the tool says which instruction and
 * what it was waiting for.
 *
 * ## Everything here is counted in frames, not milliseconds
 *
 * It used to poll every 250 ms and start shooting after N *milliseconds* of no
 * address movement, which meant the shots landed on a different game frame in
 * every run — and the port takes its time straight off the wall clock, so the
 * same stage on the same seed played four different ways over five runs
 * (`docs/PLAYER_HANGS.md` item 8). A tool that cannot compare one playthrough
 * with the previous one is not worth much.
 *
 * So it runs the page under `?drive=1` — the seam in `web/src/app/harness.ts`
 * — which hands it the game clock. rAF keeps running and the renderer keeps
 * drawing; this is the real page, the real UI and the real shot path. But game
 * time advances only when this asks for it, and only in whole 60 Hz frames
 * with the walker and the port in step. **Fifteen seconds is now nine hundred
 * frames**, and it is nine hundred frames whatever the browser was doing.
 *
 * It starts each stage at its **entry block** and never deep-links to an
 * address: a seek is its own rebuild path with its own bugs, and a run that
 * begins mid-stage would be testing that instead of the stage.
 *
 * The reason it needs to shoot is that the interesting waits are the room
 * clears, and the reason it can exercise them is that shooting is always on:
 * it used to be a checkbox that defaulted to off, and with it off
 * `WalkerHost.aliveEnemies` answered null, every live-enemy gate passed
 * untested and a playthrough sailed through exactly the fights it exists to
 * exercise. When the script is parked on an **enemy** gate this fires a volley
 * through the real shot path:
 * pointer events on `#viewport`, `Shooting.fire`, the ray, the per-bone
 * spheres, `ResolveHit`. Nothing is faked. Under the driven clock the game is
 * stopped between two `advance` calls, so the whole volley lands on one exact
 * frame rather than smeared across however many the browser happened to run.
 *
 * A volley is a grid because the harness cannot see where the actors are: the
 * projection carries no screen positions and inventing a seam to publish them
 * would be a seam that only this tool uses. Spraying the frame is cruder than a
 * player and hits the same spheres.
 *
 * **A civilian gate is cleared by shooting the zombies, not the civilians.**
 * This used to refuse to fire at one at all, on the reasoning that you are not
 * meant to shoot civilians and so a `wait_scripted_actors` that does not come
 * down on its own is a bug by definition. The second half of that does not
 * follow, and the engine says so: `EvtOpWaitScriptedActors46` (`FUN_0045FCD0`)
 * is `g_civilians_alive <= arg && g_evt_gameplay_live && g_camera_free`, and
 * `g_camera_free` is recomputed by `CameraDriverFromDeferredPose`
 * (`FUN_00402E00`) from the four `g_enemy_slots` entries — so a 0x46 gate
 * standing in a room with live enemies is held by the **enemies**, and the
 * civilian's own killed script waits on `g_enemies_present` besides. Stage 2's
 * block 14 and stage 3's block 6 were each read as a hang for exactly this
 * reason and each is two live zombies, hit points intact, that nothing was
 * ever going to shoot.
 *
 * So it fires at a civilian gate too — **unless the wait panel names a living
 * civilian as the blocker**, which is the one case the old rule was protecting
 * and the one this tool exists to find. A dead one, or none at all, means the
 * room is what is left.
 *
 * `--shoot-for` is the honest fallback. If a room has not cleared by then the
 * gate is **reported** rather than silently papered over, and the debug clear
 * runs — but **the shooting carries on afterwards** rather than stopping, and
 * that is not a detail. Stopping at `SHOOT_FOR` and leaning on the clear is
 * how stage 6 came to be reported as a hang: `ActorKillAll` used to kill a
 * thrower inside `ActorFlag.ShotImmune`, where `DispatchHit` (`FUN_004092F0`)
 * would have refused a shot, and an actor killed without being told never runs
 * its class's death chain — so it stayed in `g_enemies_alive` for ever. The
 * clear refuses that actor now, which means the room is not clear when it
 * returns, and the shots that follow are what finish it.
 *
 * ## `--shoot-for` counts frames in which **nothing took damage**
 *
 * It used to count frames on the instruction, and that cannot tell a room the
 * shots are failing to touch from a room they are slowly winning. Stage 6's
 * three rooms are `zslman` — class 0x31 character type 0x18, whose whole shot
 * response is `ThrowerStateKnockedTumbling` (`FUN_00450E40`). That state holds
 * `ActorFlag.ShotImmune` from its landing (`0x004512E2`) through the get-up
 * and hands out `obj+0x133C = 0x14` on the way to state 7, and `DispatchHit`
 * (`FUN_004092F0`) refuses `ResolveHit` outright while the bit is up. **So one
 * shot lands per knockdown, and firing faster does not help**: measured at
 * 130 hit points and 35 a hit, one of them takes four cycles of about 120
 * frames, and the three rooms cleared in 420, 435 and 285 frames of shooting
 * with the hit points falling 130 → 95 → 60 → 15 → dead all the way. All three
 * were being reported as unclearable by a 300-frame window.
 *
 * Stage 1's block 1, measured the same way, holds `140/140` for 3,000 frames
 * across a hundred volleys, because the script has `g_nFiringGate` down —
 * `HudDrawShutterState` (`FUN_00413970`) drops it at `0x00413B06` when a
 * state-3 close finishes — so `ResolveShotRequest` returns before the ray.
 * Elapsed time cannot separate those two; **damage can**, and that is the only
 * thing this now measures. Raising the window instead would have hidden stage
 * 1 as well as excusing stage 6.
 *
 *   node tools/playthrough.mjs --stage 2
 *   node tools/playthrough.mjs --stage 2 --headless --hang 1200
 *
 * Exit status is 0 only if the stage reached an end block.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { openPlayer, waitForLoad, SHOTS } from "./lib/player.mjs";

const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const flag = (n) => args.includes(`--${n}`);

const stage = opt("stage", "2");
const seed = opt("seed", "1");
/** Game frames on one instruction before the tool starts shooting. 3s. */
const PATIENCE = Number(opt("patience", "180"));
/** Game frames on one instruction before it is a hang. 15s, and see above. */
const HANG = Number(opt("hang", "900"));
/**
 * Game frames of shooting **that did nothing** before falling back to the
 * clear. 8s. See the header: it is a no-damage clock, not a wall clock.
 */
const SHOOT_FOR = Number(opt("shoot-for", "480"));
/** Game frames for the whole run. Ten minutes of game time. */
const BUDGET = Number(opt("budget", "36000"));
/** Game frames run between two reads of the HUD. A quarter of a second. */
const POLL = Number(opt("poll", "15"));
/**
 * A wall-clock stop, and **not** a claim about the game.
 *
 * Every deadline above is in frames because that is what the game is measured
 * in. This one is here for the case where the page stops answering at all —
 * a throw in the frame loop, a lost context — because then no frame will ever
 * be run and a frame budget can never be reached. It is reported as what it
 * is: the browser gave up, not the stage.
 */
const WALL_STOP = Number(opt("wall-stop", "1800")) * 1000;

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

/**
 * The wait panel's own blocker rows, as text.
 *
 * They come from `app/projection/sidebar.ts` and read
 * `0x5294 hito_mario2 · dead · enemies-present · d=23` — the actor, the
 * class's own summary, and the ground distance to the camera. The trailing
 * ` · d=` is what tells one from the panel's `<summary>`, which is
 * `0x46 wait_scripted_actors` and matches the address shape on its own.
 */
function blockerRows(s) {
  return s.waitText.split("\n").map((l) => l.trim())
    .filter((l) => /^0x[0-9A-F]+ /.test(l) && l.includes(" · d="));
}

/**
 * May this gate be shot at?
 *
 * An enemy gate always. A civilian gate too — see the header — **unless the
 * panel names a civilian who is still alive.** That one case, and only that
 * one, is the thing this tool exists to find: a `wait_scripted_actors` held by
 * a living civilian who will not leave `g_civilians_alive` is a bug in the
 * port, and killing her would hide it. A dead blocker, or none at all, leaves
 * the room's enemies as what is holding `g_camera_free` down, and those are
 * what an arcade player is shooting. `dead · ` comes from `CivilianDebug`'s
 * summary and from nowhere else.
 */
function shootable(s) {
  if (s.policy === "enemies") return true;
  if (s.policy !== "civilians") return false;
  return blockerRows(s).every((l) => l.includes(" · dead"));
}

/** One volley: pointer events across the frame, through the real shot path. */
async function volley(page, box) {
  const COLS = 5, ROWS = 4;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = box.x + (box.width * (c + 0.5)) / COLS;
      const y = box.y + (box.height * (r + 0.5)) / ROWS;
      await page.mouse.click(x, y);
    }
  }
}

/**
 * The room's remaining work, as one string — `alive/total hit points`.
 *
 * Read off the drive seam's own row, which is game state and nothing else:
 * `c` carries `e<g_enemies_alive>` and each `o` entry `c<class> ... h<hp>`.
 * Only classes 0x30 and 0x31 are counted, because they are the two that have
 * hit points: `obj+0x11C` is a **sub-type selector** on class 0x20 and an
 * asset slot on class 0x65 (`L3`), so summing every actor's would move for
 * reasons that are not damage.
 *
 * It changes when a shot lands, when an actor dies, and when a wave arrives —
 * all three mean the room is still going somewhere. It does **not** change
 * when actors merely move, which is what a room the shots cannot touch does.
 */
async function roomPressure(page) {
  const row = await page.evaluate(() => globalThis.__hotd2Drive.now());
  const alive = /\be(-?\d+)/.exec(row.c)?.[1] ?? "?";
  let hp = 0;
  for (const o of row.o) {
    if (!/ c(48|49) /.test(o)) continue;
    hp += Math.max(0, Number(/ h(-?\d+)/.exec(o)?.[1] ?? 0));
  }
  return `${alive}/${hp}`;
}

const started = Date.now();
const { page, state, close } = await openPlayer({
  // `drive=1` is the whole of what makes this comparable between runs; `seed`
  // is the other half, and it was already a URL flag.
  url: `?stage=${stage}&drive=1&seed=${seed}`, size: opt("size", "1280x800"),
  headless: flag("headless"), quiet: !flag("loud"),
});

let exit = 1;
try {
  await waitForLoad(page);
  const version = await page.evaluate(
    () => globalThis.__hotd2Drive?.version ?? null);
  if (version === null) {
    throw new Error("the page has no drive seam — is ?drive=1 wired up? "
                    + "see web/src/app/harness.ts");
  }
  await page.keyboard.press("Space");                 // play
  const box = await page.locator("#viewport").boundingBox();
  if (!box) throw new Error("#viewport has no box");

  /** Run n whole game frames. The only thing in this file that advances time. */
  const advance = (n) =>
    page.evaluate((k) => globalThis.__hotd2Drive.advance(k), n);

  let addr = null;
  /** The frame the current address was first seen on. */
  let addrAt = 0;
  /** The last {@link roomPressure} reading, and the frame it last changed on. */
  let pressure = null;
  let pressureAt = 0;
  let frames = 0;
  let volleys = 0;
  let killedHere = false;
  /** Every gate the shots could not clear — the rooms that are not playable. */
  const unclearable = [];
  let steps = 0;
  let last = null;

  for (;;) {
    const s = await readState(page);
    const here = `${s.block} ${s.step}`;
    if (here !== addr) {
      addr = here;
      addrAt = frames;
      pressure = null;
      pressureAt = frames;
      volleys = 0;
      killedHere = false;
      steps += 1;
      // One line per address is too much for forty blocks; one per block is
      // the shape of the run.
      const blk = s.block.split(" ")[0];
      if (blk !== last) {
        last = blk;
        const t = ((Date.now() - started) / 1000).toFixed(0);
        console.log(`  f${String(frames).padStart(6)}  ${t}s  `
                    + `block ${s.block}  ${s.spawns}  lives ${s.lives}`);
      }
    }

    if (/\(end/.test(s.block)) {
      const t = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`\nreached an end block after ${frames} game frames `
                  + `(${(frames / 60).toFixed(1)}s of game time, ${t}s of `
                  + `wall clock), ${steps} instructions`);
      if (unclearable.length) {
        // **Reaching the end block is not the same as the stage being
        // playable.** Every line here is a room whose enemies the shots could
        // not touch, walked past only because this tool is allowed to cheat.
        console.log(`\n${unclearable.length} rooms could NOT be cleared by `
                    + `shooting — the stage is not playable through:`);
        for (const g of unclearable) console.log(`  block ${g}`);
      }
      exit = state.faults || unclearable.length ? 1 : 0;
      break;
    }

    // Take every skip the script offers, which is what an arcade player does
    // and what keeps a stage inside a sane clock: stage 1 opens with nearly a
    // minute of cathedral before the first zombie. `Enter` is the player's own
    // binding for it, and a skippable region walks the whole cutscene rather
    // than one wait.
    if (s.skip.startsWith("offered")) {
      await page.keyboard.press("Enter");
    }

    const stalled = frames - addrAt;
    /**
     * Frames since anything in the room last took damage. Equal to `stalled`
     * until the first volley, and on a gate nothing is shooting at.
     */
    const fruitless = frames - pressureAt;
    // **Both clocks**, because a room being cleared slowly is not a hang and a
    // fight is not an authored sequence. `stalled > HANG` alone would call
    // stage 6's rooms hung while their hit points were visibly falling.
    if (stalled > HANG && fruitless > HANG) {
      console.log(`\nHUNG at block ${s.block} step/op ${s.step}`);
      if (s.policy === "civilians") {
        console.log("  a civilian gate, which nothing here touches on purpose:"
                    + " you do not shoot civilians in this game, so one that"
                    + " does not come down on its own is the bug.");
      }
      console.log(`  ${stalled} game frames (${(stalled / 60).toFixed(1)}s) on `
                  + `one instruction, and no authored sequence in this game is `
                  + `that long.`);
      for (const line of s.waitText.split("\n").filter((l) => l.trim()
                                                      && l.trim() !== "box")) {
        console.log(`    ${line.trim()}`);
      }
      // The wait panel names who is holding it; the actors panel says why.
      // Printing the holder's own rows is the difference between "a civilian
      // is in the count" and "she is facing the wrong way and her turn rate is
      // zero", and the second is the one you can act on.
      const holders = [...s.waitText.matchAll(/0x[0-9A-F]+/g)].map((m) => m[0]);
      if (holders.length) {
        await page.click("#panel-actors summary").catch(() => {});
        // Wall time, and it is not a game deadline: the panel is React's and
        // this is waiting for it to be drawn, not for the game to do anything.
        await sleep(400);
        const actors = await page.locator("#panel-actors").innerText()
          .catch(() => "");
        const lines = actors.split("\n");
        for (const h of holders) {
          const i = lines.findIndex((l) => l.includes(h));
          if (i < 0) continue;
          console.log("");
          for (const l of lines.slice(i, i + 6)) console.log(`    ${l.trim()}`);
        }
      }
      console.log("");
      mkdirSync(SHOTS, { recursive: true });
      const path = resolve(SHOTS, `hang-stage${stage}.png`);
      await page.screenshot({ path });
      console.log(`  wrote ${path}`);
      break;
    }

    if (stalled > PATIENCE && shootable(s)) {
      // Frames, not volley count and not wall time. A volley is twenty round
      // trips to the browser, which used to take about a second and made the
      // fallback land after the hang deadline rather than before it; under the
      // driven clock it takes **no game time at all**, because the game is
      // stopped between two `advance` calls. So the whole volley lands on one
      // frame, and the deadline it is measured against is a count of frames
      // this tool chose to run.
      volleys += 1;
      await volley(page, box);
      // After the volley, so a hit that landed on this exact frame counts.
      const p = await roomPressure(page);
      if (p !== pressure) {
        pressure = p;
        pressureAt = frames;
      }
      if (fruitless >= SHOOT_FOR && !killedHere) {
        // The report, and it is only a report: the shooting above carries on.
        killedHere = true;
        unclearable.push(`${s.block.split(" ")[0]} step/op ${s.step}`
                         + `  ${s.sub.split("\n").find((l) => l.startsWith("0x"))
                                 ?? s.policy}`);
        // A picture of the moment the room should have been clear. Worth
        // having whatever the rows below say: they give the state and the
        // distance, and the frame gives where the camera was pointing.
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: resolve(SHOTS,
          `unclear-stage${stage}-b${s.block.split(" ")[0]}`
          + `-${s.step.replace(/\D+/g, "_")}.png`) });
        console.log(`      the ${s.policy} gate at block ${s.block} ${s.step} `
                    + `took ${volleys} volleys over ${fruitless} frames `
                    + `without one point of damage landing anywhere in the `
                    + `room (${pressure} alive/hp). Using the debug clear, and `
                    + `still shooting.`);
        // **Who, and how far** — not "the enemies are somewhere the shots
        // cannot reach", which is what this line used to say and which is an
        // inference, not a measurement. The rows say it: stage 5 block 2 is
        // four zombies at `d≈2880`, nearly three thousand units out, and
        // stage 6's are `zslman` at 38 to 56 with `KnockedTumbling` in the
        // summary — an actor inside its own `ActorFlag.ShotImmune` window,
        // which is a room that is slow rather than one that is unreachable.
        for (const l of blockerRows(s)) console.log(`        ${l}`);
        await page.click('button[title^="Kill every live actor"]');
      }
    }

    if (frames > BUDGET) {
      console.log(`\nout of budget after ${BUDGET} game frames at block `
                  + `${s.block}`);
      break;
    }
    if (Date.now() - started > WALL_STOP) {
      console.log(`\nthe browser stopped answering: ${frames} game frames in `
                  + `${(WALL_STOP / 1000).toFixed(0)}s of wall clock. This is `
                  + `not a hang in the stage — the page is not running.`);
      break;
    }
    frames = await advance(POLL);
  }
  if (state.faults) console.log(`\n${state.faults} console errors on the way`);
} finally {
  await close();
}
process.exit(exit);
