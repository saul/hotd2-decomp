/**
 * Stage 2 block 16: the captor that mauls the civilian must then attack.
 *
 *     node tools/maul_then_attack.mjs [--shoot]
 *
 * `0xA030` is a held captor: its descriptor tail carries a camera cue
 * (`75:660`), so when its script ends `ZombieScriptEnded` parks it in
 * `ZombieStateHoldForCameraCue`, which runs `AttackRun`/`HoldAtRange` as a
 * delegate and bounces every claim back until the camera reaches that frame.
 * On the cue frame the delegate has just claimed, and the hold hands it back to
 * `HoldAtRange` still owning the permit; the `finish_sequence` the script
 * queues next (`EvtActionFinishSequence21`, `FUN_00403710`) is what frees it.
 * The port had no copy of that, so the zombie stood at the ring with the only
 * permit for the rest of the stage -- the NEW-BUGS-2 report.
 *
 * Nothing is shot, so the maul happens. The driver watches `0xA030` for its
 * first `Strike` after the civilian dies, and with `--shoot` then volleys at
 * the screen until it is dead, which is what the dead civilian's on-shot
 * stream (script 33) waits on -- its `ChildrenAlive` wait, `[likely]` against
 * the goal of 2 her first stream set -- before it orders the other two
 * captors, `0xA08C` and `0xA0E0`, out of `ZombieStateAwaitCivilianOrder`.
 * They must then come for the player too.
 *
 * The report's own address, `step=6&op=10`, seeks past the step-5
 * `spawn_obj_c` that makes the civilian and her captors, and lands in a room
 * with neither; this starts at `step=5&op=9`. Runs under `?drive=1`, so every
 * frame is the game's own 60 Hz tick and the run is the same every time.
 * Point `HOTD2_BUNDLE` at an export; about 25 s either way.
 */
import { openPlayer, pull, waitForLoad } from "./lib/player.mjs";

const SHOOT = process.argv.includes("--shoot");
const URL = "?stage=2&mode=play&entry=0&block=16&step=5&op=9&frame=0&drive=1";
const FRAMES = Number(process.env.FRAMES ?? (SHOOT ? 3600 : 1200));
const CAPTOR = 0xa030;
const OTHERS = [0xa08c, 0xa0e0];
const STRIKE = 3;

const { page, close, state } = await openPlayer({ url: URL, headless: true,
                                                  quiet: true });
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
};
try {
  await waitForLoad(page);
  if (await page.evaluate(() => globalThis.__hotd2Drive?.version ?? null)
      === null) {
    throw new Error("no drive seam -- is ?drive=1 wired up?");
  }
  // Blur first: Space on a focused `<summary>` toggles it instead of
  // starting the transport.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press("Space");
  const box = await page.locator("#viewport").boundingBox();
  if (!box) throw new Error("#viewport has no box");

  const sample = () => page.evaluate(async () => {
    const { G } = await import("/src/game/globals.ts");
    return {
      frame: G.g_frame_counter,
      permits: [...G.g_attack_permits],
      lives: [...G.g_player_lives],
      hits: [...G.g_player_hit_count],
      alive: G.g_enemies_alive,
      cam: `${G.g_active_cam_path}:${G.g_cam_path_frame}`,
      actors: G.g_object_list.filter((o) => o.cls === 0x30 || o.cls === 0x10)
        .map((o) => ({ at: o.at, cls: o.cls, state: o.state, sub: o.sub,
                       permit: o.attackPermit, dead: !!o.dead,
                       delegate: o.zom?.delegate })),
    };
  });
  const advance = (n) => page.evaluate(
    (k) => globalThis.__hotd2Drive.advance(k), n);

  // State sequences per actor, collapsed to changes.
  const seq = new Map();
  const note = (s) => {
    for (const a of s.actors) {
      const tag = `${a.state}${a.state === 42 ? `(${a.delegate})` : ""}`
        + `${a.dead ? "D" : ""}`;
      const list = seq.get(a.at) ?? [];
      if (list.at(-1)?.tag !== tag) list.push({ tag, frame: s.frame, cam: s.cam });
      seq.set(a.at, list);
    }
  };

  let civDeadAt = -1, firstStrike = -1, captorDeadAt = -1;
  const othersStrike = new Map();
  let pulls = 0, k = 0;
  let s = await sample();
  for (let f = 0; f < FRAMES; f++) {
    await advance(1);
    s = await sample();
    note(s);
    const civ = s.actors.find((a) => a.cls === 0x10);
    if (civDeadAt < 0 && civ?.dead) civDeadAt = s.frame;
    const captor = s.actors.find((a) => a.at === CAPTOR);
    if (firstStrike < 0 && captor?.state === STRIKE) firstStrike = s.frame;
    if (captorDeadAt < 0 && firstStrike >= 0 && (!captor || captor.dead)) {
      captorDeadAt = s.frame;
    }
    for (const at of OTHERS) {
      const a = s.actors.find((x) => x.at === at);
      if (a?.state === STRIKE && !othersStrike.has(at)) othersStrike.set(at, s.frame);
    }
    // Volley at the screen once the captor has shown it attacks, every
    // eighth frame, until all three captors have struck or died.
    if (SHOOT && firstStrike >= 0 && f % 8 === 0 && captorDeadAt < 0) {
      const c = (k % 6) + 0.5, r = (Math.floor(k / 6) % 5) + 0.5;
      k++;
      pulls++;
      await pull(page, box.x + (box.width * c) / 6, box.y + (box.height * r) / 5);
    }
    if (SHOOT ? othersStrike.size === OTHERS.length
              : firstStrike >= 0 && f > firstStrike + 400) break;
  }

  for (const [at, list] of seq) {
    console.log(`0x${at.toString(16)}: ${list.map((e) => `${e.tag}@f${e.frame}`).join(" ")}`);
  }
  console.log(`civilian dead at f${civDeadAt}; 0x${CAPTOR.toString(16)} first strike f${firstStrike};`
    + ` lives ${s.lives} hits ${s.hits} permits ${s.permits}`);
  check("the civilian is mauled", civDeadAt >= 0);
  check("the captor strikes after the maul", firstStrike > civDeadAt && civDeadAt >= 0,
        `first strike f${firstStrike}`);
  if (SHOOT) {
    console.log(`pulls ${pulls}; captor dead at f${captorDeadAt}`);
    check("the captor is shot dead", captorDeadAt >= 0);
    for (const at of OTHERS) {
      check(`0x${at.toString(16)} strikes after it`, othersStrike.has(at),
            othersStrike.has(at) ? `f${othersStrike.get(at)}` : "never");
    }
  }
} finally {
  console.log(`faults=${state.faults}`);
  await close();
}
process.exitCode = failures ? 1 : 0;
