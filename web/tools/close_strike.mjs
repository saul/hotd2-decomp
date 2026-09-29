/**
 * **Where does a `zskamere`'s standing swing land, and does it cry out?**
 *
 * `ThrowerStateCloseAndStrike` (`FUN_0044EA50`, class 0x31 state 24) is
 * character type 0x17's attack: `ThrowerStateWaitForPermit` hands it over
 * with `PlaySoundId(0x2416A9)` (`0x0044B5A5`), sub 1 holds the row's approach
 * clip until the actor is within the row's reach of its mark, then
 * `ActorSetMotionBlended(strike, 0, 5)` and `ActorPlayHitVoice(obj, 3)` start
 * the swing, and `ThrowerStrikeConnect` runs on the frame the play cursor
 * equals the row's hit frame -- `==`, every frame, no latch (`0x0044EC15`).
 *
 * This drives the real page under `?drive=1` from stage 4 block 1 step 2,
 * where the stage's first two `zskamere` drop in, and reads one probe per
 * driven frame: each 0x17 actor's state, sub and play cursor, every sound id
 * the page's `sound.play` delivers (through `Bgm.prototype.play`, the one
 * listener), and the players' lives and invulnerability. It reports, per
 * swing: the frame it started, what was heard on that frame, the frame a life
 * went and the cursor then, and the cursor state 25 was entered on.
 *
 *   HOTD2_BUNDLE=... node tools/close_strike.mjs --headless [--seed N]
 */
import { openPlayer, requireBundle, waitForLoad } from "./lib/player.mjs";

requireBundle("close_strike");

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const SEED = Number(opt("seed", "1"));
const FRAMES = Number(opt("frames", "3000"));
const WHERE = opt("at", "block=1&step=2&op=5");

const { page, close, state } = await openPlayer({
  url: `?stage=4&mode=play&${WHERE}&drive=1&seed=${SEED}`,
  size: "1280x800", headless: flag("headless"), quiet: true,
});

let failures = 0;
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? `  ${detail}` : ""}`);
};

try {
  await waitForLoad(page);
  await page.keyboard.press("Space");
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.evaluate(async () => {
    const { Bgm } = await import("/src/audio/bgm.ts");
    const { G } = await import("/src/game/globals.ts");
    const arc = await import("/src/game/class31/arc.ts");
    const heard = [];
    const play = Bgm.prototype.play;
    Bgm.prototype.play = function (id) {
      heard.push(id);
      return play.call(this, id);
    };
    window.__probe = () => {
      const out = {
        f: G.g_frame_counter,
        heard: heard.splice(0),
        lives: [...G.g_player_lives],
        invuln: [...G.g_player_invuln_frames],
        a: G.g_object_list
          .filter((o) => o.cls === 0x31 && o.charType === 0x17)
          .map((o) => ({
            at: o.at, state: o.state, sub: o.sub,
            cursor: arc.ActorPlayCursor(o), motion: arc.ActorPlayMotion(o),
            attack: o.attack, phase: o.arcPhase, permit: o.attackPermit,
          })),
      };
      return out;
    };
  });

  const swings = [];              // {at, start, heard, hitF, hitCursor, exitCursor}
  const open = new Map();         // at -> swing in progress
  const prev = new Map();
  let lastLives = null, lastInvuln = null;
  const states = new Set();
  const claims = [];
  for (let f = 0; f < FRAMES; f++) {
    await page.evaluate(() => window.__hotd2Drive.advance(1));
    const p = await page.evaluate(() => window.__probe());
    const lost = lastLives
      && p.lives.some((l, i) => l < lastLives[i]
                         || p.invuln[i] > lastInvuln[i] + 1);
    lastLives = p.lives;
    lastInvuln = p.invuln;
    for (const a of p.a) {
      states.add(a.state);
      const was = prev.get(a.at);
      if (was && was.state === 8 && a.state === 24) {
        claims.push({ at: a.at, f: p.f, heard: p.heard });
      }
      // Sub 1 runs on into sub 2 on the frame the mark is in reach, and sub 0
      // into sub 1 on the frame the state is entered: a swing can start on
      // the frame state 8 hands over.
      if (a.state === 24 && a.sub >= 2
          && (was?.state !== 24 || was.sub < 2)) {
        const s = { at: a.at, start: p.f, heard: p.heard, attack: a.attack,
                    phase: a.phase, hitF: -1, hitCursor: -1, exitCursor: -1 };
        swings.push(s);
        open.set(a.at, s);
      }
      const s = open.get(a.at);
      if (s && lost && s.hitF < 0) {
        s.hitF = p.f;
        s.hitCursor = a.cursor;
      }
      if (s && was?.state === 24 && a.state !== 24) {
        s.exitCursor = a.cursor;
        s.exitState = a.state;
        open.delete(a.at);
      }
      prev.set(a.at, a);
    }
    if (swings.length >= 2 && open.size === 0) break;
  }
  console.log(`seed ${SEED}: states seen ${[...states].sort((x, y) => x - y)}`);
  for (const c of claims) {
    console.log(`  claim   at ${c.at} f${c.f} heard ${c.heard.map((h) => h.toString(16))}`);
  }
  for (const s of swings) {
    console.log(`  swing   at ${s.at} attack ${s.attack} obj+0x1360 ${s.phase} `
                + `started f${s.start} heard ${s.heard.map((h) => h.toString(16))}`
                + ` hit f${s.hitF} (+${s.hitF - s.start}) cursor ${s.hitCursor}`
                + ` exit cursor ${s.exitCursor} -> state ${s.exitState}`);
  }
  check("a zskamere reached state 24 and swung", swings.length > 0);
  check("every claim into state 24 played 0x2416A9",
        claims.length > 0 && claims.every((c) => c.heard.includes(0x2416a9)));
  check("every swing cried out on the frame it started",
        swings.every((s) => s.heard.some((h) => h !== 0x2416a9)));
  check("every swing that took a life took it on its row's hit frame",
        swings.every((s) => s.hitF < 0 || [35, 22, 40].includes(s.hitCursor)));
  check("the page threw nothing", state.faults === 0);
} finally {
  await close();
}
process.exit(failures ? 1 : 0);
