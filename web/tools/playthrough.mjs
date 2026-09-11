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
 * **A boss's flag gate is shot at, through the civilian guard.**
 * A `wait_script_flag` gate is usually a timer -- the chapter card counts 180
 * frames and opens its own -- but nine of the game's flags are raised by class
 * 0x14, the stage-2 boss, and the last of each of its three ladders is raised
 * by the boss *dying*. There is no way to clear one but to shoot it, and the
 * enemy-gate rule cannot see it: the script is parked on `0x45`, not `0x44`.
 *
 * This was an opt-in switch when class 0x14 landed, because the grid spray
 * cannot aim and stage 3 block 2's `wait_script_flag 0x1E` is the hostage's --
 * flag 30 comes off *either* of her streams, the rescue's and the one she runs
 * when she is shot, so a sprayed gate could open by killing her and report the
 * stage playable. But {@link shootable} already had the rule that refuses a
 * gate whose panel names a **living civilian**, and that is exactly the guard
 * the switch was standing in for. So the gate is shot at by default and the
 * guard does the refusing; stage 3 still ends on block 13 with its life
 * intact, which is the measurement that says the guard holds.
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
 * ## `--route` names the arm to take at a branch
 *
 * A driven run takes **one** arm of every branch, so "the stage reached an end
 * block" only ever meant that one road through it was played. Stage 2 is the
 * case that made that matter: with nobody rescued `g_script_branch_var` stays
 * 0 for the whole stage, block 0 goes to 11 every time, and blocks 1-10 and
 * 21-32 — twenty-two blocks of shipped script — had never been executed by
 * anything. `--entry` cannot reach them (stage 2 has one entry, and
 * `resolveEntry` falls back to it silently, so the flag produced a
 * byte-identical run), and neither can shooting: the arm that reaches block 1
 * is written by shooting the class-0x21 rescue target during block 0, and the
 * gate the walker is parked on there is neither an enemy gate nor a civilian
 * one, so {@link shootable} declines.
 *
 *   node tools/playthrough.mjs --stage 2 --route 0:1,5:6,7:8,8:10
 *
 * Each rule is `<block>:<target>` — *at the branch in block `<block>`, go to
 * block `<target>`* — and they are written the way the block dump and the
 * player's own branch bar both write a route, as the destination rather than
 * as a slot index, because the destination is the thing you can look up.
 *
 * ### It plays for the arm before it takes the arm, and that is the point
 *
 * **`g_script_branch_var` is written by gameplay and by nothing else** — the
 * global's own note lists every writer in the image and all of them are actor
 * code. So a driver that wants an arm has to *earn* it, and the way an arcade
 * player earns this one is by shooting. While the walker is inside a rule's
 * block, this fires the same volley the gates get, through the same pointer
 * events, the same ray and the same bone spheres. On stage 2 block 0 that
 * kills the class-0x21 rescue target — `RescueTargetHeldState`
 * (`FUN_00451980`) charges its parts, writes `g_script_branch_var = 1`, pays
 * the 80 + 400 and hands both enemy counters back — and the bar then comes up
 * with `→ 1` already marked as **the game's own** route. Nothing is
 * overridden; the run simply played the block.
 *
 * The guard is the one that already exists, read from the other side.
 * {@link shootable} refuses a gate whose panel names a **living civilian**,
 * and inside a block there is no gate and no panel to read — so
 * {@link civiliansOnField} refuses the volley while `g_civilians_alive` is
 * anything but zero, which is stricter. A rescue target is not a civilian: it
 * is an actor the player is meant to shoot, and it is not in that count.
 *
 * ### The override is the fallback, and it is reported as one
 *
 * When the game's arm is still not the one asked for — a branch written by a
 * prop or a switch the grid cannot reach, or a block whose civilians refused
 * the volley — this clicks the other route button. That is the player's own
 * override (`ui/panels/BranchBar.tsx` → `takeBranch`) and nothing new: the
 * drive seam gains no power it did not have, and is still "a metronome and a
 * tap" (`app/harness.ts`).
 *
 * **An override can put the world in a state the engine cannot be in**, so it
 * is printed as a warning and not as a route. Stage 2 block 0 is the proof:
 * clicked rather than played, the rescue target is still in
 * `RescueTargetHeldState` holding `g_enemies_alive` and `g_enemies_present`,
 * its only ways out are the rescue and camera path `0x39` frame `0x121` —
 * neither of which can happen again once block 1 is running — so **every**
 * `wait_enemies_alive` gate in blocks 1 to 10 hangs on it for ever. Measured:
 * `e1 p1` with the actor frozen at one hit point for the rest of the run. The
 * engine cannot reach that state, because the only writer of arm 1 here is the
 * rescue itself. A hang behind an override is not evidence about the port.
 *
 * Every branch the run reaches prints the arms, the arm the **game** chose and
 * why, and the arm taken; the run ends with one `route:` line for the whole
 * road, so two runs are comparable by comparing that line. A rule that names
 * an arm the block does not have, or a branch the run never reached, **fails
 * the run** rather than being ignored — a flag that quietly does nothing is
 * exactly what `--entry` did here, and it cost a session the finding.
 *
 * ### `--original`, because a slot-2 arm is not an arcade road at all
 *
 * A route record has three slots and **every write of `2` into
 * `g_script_branch_var` in the image is behind `g_GameMode == 1`**. So a
 * target in slot 2 belongs to Original Mode, and no arcade run — driven,
 * overridden or played by a person — can reach it. Stage 2 has six of them:
 * blocks 29, 30, 31, 32, 33 and 34, off blocks 1, 3, 12, 8, 18 and 22.
 *
 * `--original` plays the Original Mode bundle, which is where they live, and
 * where the actors that write a 2 — the class 0x53 cat in block 8, the class
 * 0x52 mouse, four class-0x41 prop types — are not despawned on their first
 * frame. An `--route` rule on a slot-2 arm without it is asking for a road the
 * mode does not have.
 *
 *   node tools/playthrough.mjs --stage 2
 *   node tools/playthrough.mjs --stage 2 --headless --hang 1200
 *   node tools/playthrough.mjs --stage 3 --entry 7 --headless
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
  // A **boss's** flag gate is shot at for the same reason an enemy gate is:
  // the gate is waiting for an actor to die and the player's job is to kill
  // it. It goes through the same civilian guard, because stage 3's
  // `wait_script_flag 0x1E` is the hostage's and flag 30 comes off either of
  // her streams -- so a sprayed gate could open by shooting her and report
  // the stage playable. That is the one thing this tool must never do.
  if (s.policy !== "civilians" && s.policy !== "flag") return false;
  return blockerRows(s).every((l) => l.includes(" · dead"));
}

/**
 * One volley: pointer events across the frame, through the real shot path.
 *
 * The grid is coarse because a room full of zombies is a big target. A **boss**
 * is one actor with a handful of bone spheres eighty units out, and a 5x4 grid
 * walks straight past it -- so a gate that is one actor's death gets a denser
 * sweep. Same events, same ray, same spheres; more of them.
 */
async function volley(page, box, cols = 5, rows = 4) {
  const COLS = cols, ROWS = rows;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = box.x + (box.width * (c + 0.5)) / COLS;
      const y = box.y + (box.height * (r + 0.5)) / ROWS;
      await page.mouse.click(x, y);
    }
  }
  // **The pointer does not get left on the furniture.** The bottom row of the
  // grid is at 95% of the frame's height, which is where `#branchbar` draws;
  // Chrome dispatches `pointerenter` when an element appears under a
  // stationary cursor, so a volley followed by a branch point froze the
  // override window — `branchHover` stops `tickBranchCountdown`, deliberately,
  // because deciding is not a race. Measured: `window paused` for 315 frames
  // and counting, which a run reads as a hang at a branch. Resting on a route
  // *button* also fires `previewBranch` and poses the camera somewhere else.
  // Neither is anything this tool means to say, so it puts the pointer back in
  // the middle of the frame, where nothing is listening.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

/**
 * Open the actors panel so that it has something in it, in the one order that
 * works: **click, let React commit, run a frame, let React commit again.**
 *
 * A panel is a `<details>` whose effect *demands* its projection slice when it
 * opens (`ui/panels/Panel.tsx`), and a demanded slice is built by the next
 * publish — which is `Pacer.frame`, on a driven frame. Under `?drive=1` the
 * game is stopped between two `advance` calls, so **every one of the three
 * ways to get this wrong reads as an empty panel**:
 *
 * * click and `sleep`: the claim is registered and no frame is ever run, so
 *   `actorPanel` stays undefined and `ActorBody` renders `null`;
 * * click and `advance` immediately: the frame runs *before* React has
 *   committed the open state and run the effect, so the publish it triggers
 *   has no claim on the slice, and nothing publishes again;
 * * either of those, then read: the panel's own switches and readouts are
 *   there — `4 of 5 up, 3 types`, `0 attacking · 0 live · 6 scripted` — which
 *   is what made it look like a panel with nothing to say rather than a
 *   panel that had not been asked.
 *
 * That is why every hang report this tool has ever written carried no actor
 * rows for a gate with no named holder, stage 2's block 9 included: the rows
 * were never missing from the game, only from the request. One frame of game
 * time, after the hang has already been declared and screenshotted, is the
 * whole cost.
 */
async function openActors(page, advance) {
  await page.click("#panel-actors summary").catch(() => {});
  await sleep(400);
  await advance(1);
  await sleep(400);
}

/**
 * The counters and every actor still standing, off the drive row.
 *
 * **The one readout that cannot come back empty.** The actors panel is
 * React's, needs a driven frame to be published (see {@link openActors}) and
 * shows its groups in document order, so a hang report that takes its first
 * ten lines gets whichever class sorts first — on stage 2's block 9 that is
 * three civilians, and the question was which *enemy* was still alive. This is
 * `Harness.snapshot`, which is game state and nothing else: `e`/`p` are
 * `g_enemies_alive` and `g_enemies_present`, and each row is
 * `<at> c<class> s<state>.<sub> h<hp> @<pos> y<yaw>`.
 */
async function standing(page) {
  const row = await page.evaluate(() => globalThis.__hotd2Drive.now());
  return [row.c, ...row.o.filter((o) => !/ dead| hidden/.test(o))];
}

/**
 * Is a living civilian on the field? `g_civilians_alive`, off the drive row.
 *
 * The same refusal {@link shootable} makes, read from the counter rather than
 * from the wait panel, because `--route`'s volleys are fired **inside** a
 * block where there is no gate and so no blocker rows to read. It is the
 * stricter of the two on purpose: the panel rule refuses when a named blocker
 * is a living civilian, and this refuses while any civilian is alive at all.
 * You do not shoot civilians in this game, and a driver that plays a block for
 * a branch arm must not be the exception.
 */
async function civiliansOnField(page) {
  const row = await page.evaluate(() => globalThis.__hotd2Drive.now());
  return Number(/\bv(-?\d+)/.exec(row.c)?.[1] ?? 0) > 0;
}

/**
 * `--route 0:1,5:6` as a map from branch block to the target block to take.
 *
 * Parsed up front and strictly: a malformed rule is a typo, and a typo that
 * turns into "no rule for that block" is a run that looks like it took the
 * road you asked for. Throwing here is the cheapest place to say so.
 */
function parseRoute(spec) {
  const out = new Map();
  if (!spec) return out;
  for (const part of spec.split(",")) {
    const m = /^(\d+):(\d+)$/.exec(part.trim());
    if (!m) {
      throw new Error(`--route: "${part.trim()}" is not <block>:<target> `
                      + `(for example --route 0:1,5:6)`);
    }
    const [block, target] = [Number(m[1]), Number(m[2])];
    if (out.has(block)) {
      throw new Error(`--route: block ${block} named twice. A block's branch `
                      + `is reached once per visit and takes one arm.`);
    }
    out.set(block, target);
  }
  return out;
}

/**
 * The branch bar, as the page is drawing it — or null when there is none.
 *
 * Read off the DOM rather than through the drive seam, because the buttons are
 * what gets clicked and a driver that read one source and clicked another
 * could act on a bar that had already changed. `sub` is
 * `block <n> → <a> or <b>` from `branchProjection`, which is where the block
 * number comes from; `choice` is the `g_script_branch_var` slot each button
 * stands for, and both halves of the title carry it — the chosen route says
 * `g_script_branch_var is N` and an override says `(branch_choice N)`.
 */
async function readBranch(page) {
  return page.evaluate(() => {
    const bar = document.querySelector("#branchbar");
    if (!bar) return null;
    const sub = bar.querySelector(".dim")?.textContent.trim() ?? "";
    const options = [...bar.querySelectorAll(".routes button")].map((b) => {
      const title = b.title ?? "";
      const m = /g_script_branch_var is (\d+)|branch_choice (\d+)/.exec(title);
      return {
        label: b.textContent.trim(),
        target: Number(/-?\d+/.exec(b.textContent)?.[0] ?? "NaN"),
        choice: m ? Number(m[1] ?? m[2]) : null,
        chosen: b.classList.contains("chosen"),
      };
    });
    return { block: Number(/block (\d+)/.exec(sub)?.[1] ?? "NaN"), sub,
             options };
  });
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
// `--entry` picks which of a stage's entry points to start from. Only stages
// 3 and 4 have more than one, so it changes nothing on the other four --
// `resolveEntry` falls back to the first entry when the number names none,
// silently, which is why passing it on stage 2 produces a byte-identical run.
//
// **It is not a way to choose a branch arm**: an entry is where the walk
// starts and an arm is where a route record goes. `--route` is the arm, and
// the two compose — a run may start at entry 1 and still be told which way to
// go at every fork it reaches.
//
// It is also **not a deep link**: the run starts at a real entry block and
// plays forward, so it exercises the stage's own rebuild path and not the
// seek's. And it is not cosmetic coverage -- stage 3's block 2 is on neither
// entry-0 route, so until this existed a seven-step block of shipped script
// had never been executed by anything, and it held two hangs. See
// `docs/PLAYER_HANGS.md` items 21 to 23.
const entry = opt("entry", null);
/** `--route`'s rules, parsed before the browser is launched. See the header. */
const ROUTE = parseRoute(opt("route", null));
if (ROUTE.size) {
  console.log(`--route: ${[...ROUTE].map(([b, t]) => `${b}→${t}`).join(" ")}`);
}
/**
 * Play the stage's **Original Mode** bundle, `g_GameMode == 1`.
 *
 * Not cosmetic, and not a second difficulty: it is the only mode in which six
 * of stage 2's blocks exist at all. A route record has three slots, and
 * **every write of `2` into `g_script_branch_var` in the whole image is behind
 * `g_GameMode == 1`** — so a slot-2 target is an Original Mode road and no
 * arcade run, driven or played, can reach one. In stage 2 those are blocks
 * 29, 30, 31, 32, 33 and 34, off blocks 1, 3, 12, 8, 18 and 22. Arcade gets
 * slots 0 and 1 and nothing else.
 *
 * It is a URL flag the player already has; this only passes it, and says so.
 */
const original = flag("original");
if (original) console.log("--original: g_GameMode 1, the Original Mode bundle");
const { page, state, close } = await openPlayer({
  // `drive=1` is the whole of what makes this comparable between runs; `seed`
  // is the other half, and it was already a URL flag.
  url: `?stage=${stage}&drive=1&seed=${seed}`
       + (original ? "&original=1" : "")
       + (entry === null ? "" : `&entry=${entry}`),
  size: opt("size", "1280x800"),
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
  /** One entry per branch the run reached, and what it did there. */
  const branches = [];
  /** `--route` rules that named an arm the branch does not have. */
  const routeFaults = [];
  /** Arms taken by clicking rather than by gameplay. See the header. */
  const overrides = [];
  /** Volleys fired inside a rule's block, playing for its arm, by block. */
  const played = new Map();
  /** Rule blocks whose volley the civilian guard refused, said once each. */
  const refused = new Set();
  /**
   * The block of the branch bar now up, once it has been answered.
   *
   * Cleared when the bar goes, which is what makes it per *visit* rather than
   * per block: a branch reached twice in one run is two bars and gets two
   * answers, and a bar that is still up between two polls gets one.
   */
  let answered = null;

  /**
   * **The browser died, as opposed to the stage stopping.**
   *
   * Every `page` call throws `Execution context was destroyed` once the
   * renderer has gone, and an uncaught one took the whole run's report with
   * it — the route line, the rooms, everything measured up to that point —
   * and printed a Playwright stack instead. It happened three times in one
   * session on a machine running several of these at once, at a different
   * block each time, which is the shape of resource exhaustion and not of a
   * bug in the stage. So it is caught and reported as what `WALL_STOP` is
   * reported as: the page is not running.
   */
  let lostThePage = null;

  // Nothing in the page navigates — the only `location.reload` in the app is
  // the export screen's, and it is only reachable before a scene is built —
  // so a destroyed context here is the renderer, not the player. The loop
  // below keeps its own indentation inside this `try`: re-indenting three
  // hundred lines would bury the change in whitespace.
  try {
  for (;;) {
    const s = await readState(page);
    // **Before the address bookkeeping below**, because a branch is not an
    // instruction: the walker is parked and `stalled` is growing, and the
    // countdown that resolves it is 90 frames against `HANG`'s 900. Answering
    // here means the click lands on this frame rather than a poll later.
    const b = await readBranch(page);
    if (!b) answered = null;
    if (b && answered !== b.block) {
      answered = b.block;
      const game = b.options.find((o) => o.chosen) ?? null;
      const want = ROUTE.get(b.block);
      const pick = want === undefined ? null
        : b.options.find((o) => o.target === want) ?? null;
      const chose = game
        ? `the game takes → ${game.target} (g_script_branch_var ${game.choice})`
        : "the game's own arm names a hole";
      const fired = played.get(b.block) ?? 0;
      const forIt = want === undefined ? ""
        : `, ${fired} volley(s) played for it`;
      if (want !== undefined && !pick) {
        // A rule on an arm that is not there. **Not survivable**: letting it
        // through would play the game's road under a flag that says otherwise,
        // which is the `--entry` failure this flag exists to avoid repeating.
        routeFaults.push(`block ${b.block} has no arm to ${want} (${b.sub})`);
        console.log(`  branch ${b.sub}: ${chose}${forIt}; --route says `
                    + `→ ${want}, which is NOT an arm of this block`);
      } else if (pick && game && pick.target === game.target) {
        // **The game wrote it.** Nothing is overridden; the click only saves
        // the 90 frames of viewer window, and takes the arm the game chose.
        console.log(`  branch ${b.sub}: ${chose}${forIt} — that is the arm `
                    + `--route asked for, so gameplay wrote it`);
        await page.locator("#branchbar .routes button")
          .nth(b.options.indexOf(pick)).click();
      } else if (pick) {
        console.log(`  branch ${b.sub}: ${chose}${forIt}; OVERRIDE to `
                    + `→ ${pick.target} (branch_choice ${pick.choice}) — the `
                    + `game did not write this arm, so the world may now be in `
                    + `a state the engine cannot reach. See the header.`);
        overrides.push(`block ${b.block} → ${pick.target}`);
        // The player's own override, clicked on the real page. Indexed rather
        // than matched by text: `hasText: "→ 1"` also matches `→ 11`.
        await page.locator("#branchbar .routes button")
          .nth(b.options.indexOf(pick)).click();
      } else {
        console.log(`  branch ${b.sub}: ${chose}`);
      }
      branches.push({ block: b.block, sub: b.sub,
                      game: game ? game.target : null,
                      took: pick ? pick.target : game ? game.target : null,
                      // Applied is "a rule chose this arm" and overridden is
                      // "the game had not written it". Conflating the two
                      // reported every arm gameplay *did* write as a rule that
                      // never applied, which is the opposite of the truth.
                      applied: !!pick,
                      overridden: !!pick && (!game || pick.target
                                             !== game.target) });
    }
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
      //
      // **Off the blocker rows, not off the panel's whole text.** This used to
      // match `/0x[0-9A-F]+/` over `waitText`, which on *every* gate matches
      // the wait's own opcode in the `<summary>` — `0x45 wait_script_flag`,
      // `0x44 wait_enemies_alive` — so `holders` was never empty, the
      // "no holder named" arm below was unreachable, and the arm that did run
      // looked for an actor row containing `0x45` and printed nothing. That is
      // why no hang report in this file has ever carried an actor row for a
      // gate with no named blocker. `blockerRows` is the reader that can tell
      // the two apart, and it already existed.
      const holders = blockerRows(s).map((l) => l.split(" ")[0]);
      if (holders.length) {
        await openActors(page, advance);
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
      if (!holders.length) {
        // A `wait_script_flag` names no holder, so nothing above opened the
        // actors panel -- and "is the actor that should raise this even on the
        // field" is the first question about one. **The whole panel, to sixty
        // lines**: it lists by class in document order, each actor is three to
        // five lines of its class's own debug, and a cut at ten or twenty is a
        // cut in the middle of whichever class sorts first. Stage 2's block 9
        // spent two runs printing three civilians and none of the class-0x30
        // captor the gate was actually waiting on.
        await openActors(page, advance);
        const actors = await page.locator("#panel-actors").innerText()
          .catch(() => "");
        const lines = actors.split("\n").filter((l) => l.trim()).slice(0, 60);
        if (lines.length) {
          console.log("");
          for (const l of lines) console.log(`    ${l.trim()}`);
        }
      }
      // **And the counters with everything still standing**, which is the
      // readout that cannot be empty and cannot be the wrong ten lines. A
      // gate that waits on a counter is answered by the rows that are in it.
      console.log("");
      for (const l of await standing(page)) console.log(`    ${l}`);
      console.log("");
      mkdirSync(SHOTS, { recursive: true });
      const path = resolve(SHOTS, `hang-stage${stage}.png`);
      await page.screenshot({ path });
      console.log(`  wrote ${path}`);
      break;
    }

    /**
     * Is this a `--route` block being played for the arm it asks for?
     *
     * Not while the bar is up: the bar is answered above, and a volley's
     * bottom row lands on it. Not while a civilian is alive, which is
     * {@link civiliansOnField} and the whole of the guard.
     */
    const blockNow = Number(s.block.split(" ")[0]);
    let playingForArm = !b && ROUTE.has(blockNow);
    if (playingForArm && await civiliansOnField(page)) {
      playingForArm = false;
      if (!refused.has(blockNow)) {
        refused.add(blockNow);
        console.log(`      block ${blockNow} is a --route block and a civilian is `
                    + `alive in it: not firing. You do not shoot civilians in `
                    + `this game, so the arm has to come down another way.`);
      }
    }
    const atGate = stalled > PATIENCE && shootable(s);
    if (atGate || playingForArm) {
      // Frames, not volley count and not wall time. A volley is twenty round
      // trips to the browser, which used to take about a second and made the
      // fallback land after the hang deadline rather than before it; under the
      // driven clock it takes **no game time at all**, because the game is
      // stopped between two `advance` calls. So the whole volley lands on one
      // frame, and the deadline it is measured against is a count of frames
      // this tool chose to run.
      volleys += 1;
      if (playingForArm) played.set(blockNow, (played.get(blockNow) ?? 0) + 1);
      // A room full of zombies is a big target; a boss is one actor with a
      // handful of bone spheres, and a 5x4 grid walks straight past it. So is
      // the actor that writes a branch arm — stage 2's rescue target is one
      // rider on a moving car — so a `--route` block gets the dense sweep too.
      const dense = playingForArm || s.policy === "flag";
      await volley(page, box, dense ? 13 : 5, dense ? 10 : 4);
      // After the volley, so a hit that landed on this exact frame counts.
      const p = await roomPressure(page);
      if (p !== pressure) {
        pressure = p;
        pressureAt = frames;
      }
      if (atGate && fruitless >= SHOOT_FOR && !killedHere) {
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
        // **Only an enemy gate.** The debug clear takes actors out of the
        // counts `wait_enemies_alive` reads, which is what makes it a way
        // past that gate; a `wait_script_flag` is waiting for an actor to
        // *do* something, and killing it from outside its own death states
        // opens nothing.
        if (s.policy === "enemies") {
          await page.click('button[title^="Kill every live actor"]');
        }
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
  } catch (e) {
    // Only the renderer going away. Anything else is this tool's own bug and
    // has to keep its stack.
    if (!/Execution context was destroyed|Target (page|closed)|crash/i
         .test(String(e))) throw e;
    lostThePage = e;
  }
  if (lostThePage) {
    console.log(`\nthe browser gave up: ${String(lostThePage).split("\n")[0]}`);
    console.log("  This is not a hang in the stage — the page stopped "
                + "answering. Everything measured up to here still stands; "
                + "re-run it alone (see `L29`).");
  }
  // **The road, on one line**, whichever way the run ended — a hang on a
  // chosen arm is exactly the finding `--route` exists to produce, and it is
  // unreadable without knowing which arms got it there. `*` marks an override.
  if (branches.length) {
    console.log(`\nroute: ${branches.map((r) => `${r.block}→${r.took}`
                  + (r.overridden ? "*" : "")).join("  ")}`
                + `${ROUTE.size ? "   (* = --route)" : ""}`);
  }
  // A rule that named an arm the block does not have, and a rule whose branch
  // the run never reached. Both mean the run did not play the road that was
  // asked for, and both are failures: the whole value of the flag is that the
  // output says which road was played.
  const missed = [...ROUTE.keys()].filter(
    (blk) => !branches.some((r) => r.block === blk && r.applied));
  for (const f of routeFaults) console.log(`\n--route: ${f}`);
  if (missed.length) {
    console.log(`\n--route: ${missed.length} rule(s) never applied — `
                + `${missed.map((b) => `block ${b}`).join(", ")} `
                + `${missed.length === 1 ? "was" : "were"} never reached as a `
                + `branch. The run did not take the road that was asked for.`);
  }
  if (overrides.length) {
    console.log(`\n--route: ${overrides.length} arm(s) taken by OVERRIDE and `
                + `not by gameplay — ${overrides.join(", ")}. A hang behind one `
                + `of these is not evidence about the port until the state it `
                + `leaves is shown to be one the engine can reach.`);
  }
  if (routeFaults.length || missed.length) exit = 1;
  if (state.faults) console.log(`\n${state.faults} console errors on the way`);
} finally {
  await close();
}
process.exit(exit);
