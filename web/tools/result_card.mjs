/**
 * The end of a stage in the real page: the result card's figures, the life
 * bonus, the count and the score, played frame by frame through the stage's
 * own result step.
 *
 * Opens a stage's result step (`block/step 2`, op 0) under `?drive=1`, puts
 * the rescue record in place -- `g_civilians_rescued_by_scene[scene]` and
 * `g_rescued_char_types`, exactly the three stores `RecordRescue`
 * (`game/rescue.ts`) makes at each rescue, which `web/test/port.test.ts`
 * drives through the civilian VM and class 0x21 themselves -- and a score and
 * shot counts for the card to show, then plays the step's 420 frames: the
 * script's own `spawn_simple` builds class 0x62 and the card, its own
 * `cam_play` flies the camera. Every claim is read back out of the page's `G`
 * (`L44`), frame by frame, and held to numbers from the EXE's tables
 * (`docs/re/stage-end.md`), never to the port's own output.
 *
 *   node tools/result_card.mjs --headless [--loud]
 *
 * Screenshots across the flight go to `web/shots/result-card-*.png`.
 */
import { join } from "node:path";
import { openPlayer, requireBundle, waitForLoad, SHOTS } from "./lib/player.mjs";

requireBundle("result_card");

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const failures = [];
const check = (ok, what, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(what);
};

/**
 * The cases, each a stage's result step and a rescue record.
 * `places` is the scene's `g_result_figure_records` x, and `bonus` its
 * `g_result_life_bonus` cell for this many rescues -- both the EXE's.
 */
const CASES = [
  { name: "stage1-five", stage: 1, block: 14, step: 2, scene: 0,
    rescued: [0x31, 0x26, 0x20, 0x27, 0x2e],
    places: [-235, -31.7, -138.4, 81.9, -80],
    clips: [0x17c, 0x17d, 0x17f, 0x17c, 0x17c], bonus: 1,
    shots: [1, 40, 150, 280, 330, 419] },
  { name: "stage1-none", stage: 1, block: 14, step: 2, scene: 0,
    rescued: [], list: [0x27, 0x2e, 0x31, 0x26, 0x20], bonus: 0,
    shots: [150] },
  { name: "stage2-seven", stage: 2, block: 35, step: 2, scene: 1,
    rescued: [0x34, 0x26, 0x27, 0x20, 0x34, 0x2e, 0x31],
    places: [-1089.9, -1286.2, -1181.8, -1169, -1128.2, -1227.5, -1162.3],
    clips: [0x17c, 0x17d, 0x17f, 0x17c, 0x17c, 0x17d, 0x17f], bonus: 2,
    shots: [330] },
  { name: "stage4-three", stage: 4, block: 23, step: 2, scene: 3,
    rescued: [0x2a, 0x32, 0x24],
    places: [-60.9, 81.3, 10.1], clips: [0x17f, 0x17c, 0x17c], bonus: 1,
    shots: [330] },
];

/** `ResultCardInstall`'s numbers: the dwell, the life's frame, the count. */
const CARD_FRAMES = 0x1a4;
const LIFE_FRAME = 302;
const LIFE_CAM_FRAME = 0x104;
/**
 * A figure's place, as it stands on the frame after its first: within a unit
 * of its record's -- the clips carry root motion, which the draw applies in
 * the EXE as here (`SkeletonApplyRootMotion`), so a figure drifts from its
 * record by what its clip walks.
 */
const near = (a, b) => Math.abs(a - Math.fround(b)) < 1;

async function runCase(c) {
  console.log(`\n${c.name}: stage ${c.stage} block ${c.block} step ${c.step}, `
              + `${c.rescued.length} rescued`);
  const { page, close, state } = await openPlayer({
    url: `?stage=${c.stage}&block=${c.block}&step=${c.step}&op=0&drive=1&seed=1`,
    size: "1280x960", headless: flag("headless"), quiet: !flag("loud"),
    debug: false,
  });
  try {
    await waitForLoad(page);
    const start = await page.evaluate(async (k) => {
      const { G } = await import("/src/game/globals.ts");
      G.g_civilians_rescued_by_scene[k.scene] = k.rescued.length;
      k.rescued.forEach((t, i) => { G.g_rescued_char_types[k.scene * 10 + i] = t; });
      G.g_player_score[0] = 12345;
      G.g_player_shot_count[0] = 40;
      G.g_player_hit_count[0] = 30;
      return { lives: G.g_player_lives[0], scene: G.g_scene_index };
    }, { scene: c.scene, rescued: c.rescued });
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Space");

    // The whole card, one frame at a time, in the page.
    const trace = [];
    for (let f = 1; f <= CARD_FRAMES + 10; f++) {
      const row = await page.evaluate(async () => {
        await globalThis.__hotd2Drive.advance(1);
        const { G } = await import("/src/game/globals.ts");
        const figs = G.g_object_list.filter(
          (o) => o.cls === 0x61 && o.card && o.card.routine !== 0);
        const count = G.g_view_slot_draws.find(
          (d) => Math.abs(d.x - 0.25) < 1e-3 && Math.abs(d.y - 0.22) < 1e-3);
        return {
          cam: G.g_cam_path_frame, lives: G.g_player_lives[0],
          flag: G.g_script_flags[0xfe] ?? 0,
          card: G.g_object_list.some((o) => o.cls === 0x61 && !o.dead
                                     && o.card && o.card.routine === 0),
          tally: G.g_object_list.some((o) => o.cls === 0x62 && !o.dead),
          count: count ? count.slot - 0x165f : -1,
          score: G.g_view_slot_draws.filter((d) => Math.abs(d.y + 0.17) < 1e-3)
            .map((d) => d.slot - 0x165f).join(""),
          accuracy: G.g_view_slot_draws.filter(
            (d) => Math.abs(d.y + 0.24) < 1e-3 && Math.abs(d.x + 0.243) < 0.1
              && d.slot < 0x1669).map((d) => d.slot - 0x165f).join(""),
          tiles: G.g_screen_sprite_draws.filter(
            (d) => d.id >= 0xa2a && d.id <= 0xa3a).length,
          figs: figs.map((o) => ({ type: o.charType, x: o.pos.x,
                                   motion: o.motion, holds: o.card.holdsLife,
                                   cursor: o.card.cursor, frozen: o.frozen })),
          at: globalThis.__hotd2Drive.now().a,
        };
      });
      trace[f] = row;
      if (c.shots.includes(f)) {
        await page.waitForTimeout(150);
        await page.evaluate(() => globalThis.__hotd2Drive.advance(0));
        await page.screenshot({
          path: join(SHOTS, `result-card-${c.name}-f${String(f).padStart(3, "0")}.png`) });
      }
    }

    const first = trace[1];
    check(first.card && !first.tally && first.tiles === 17,
          "frame 1: the card is up, class 0x62 is gone, the frame's 17 tiles drawn",
          `card ${first.card} tally ${first.tally} tiles ${first.tiles}`);
    const figs = trace[2].figs;
    if (c.rescued.length) {
      check(figs.length === c.rescued.length
            && figs.every((g, i) => g.type === c.rescued[i]),
            "one figure per rescue, each the rescued civilian's type",
            figs.map((g) => g.type.toString(16)).join(","));
      check(figs.every((g, i) => near(g.x, c.places[i])
                       && (i === 0 || g.motion === c.clips[i])),
            "...at the scene's places, on the places' clips",
            figs.map((g) => `${g.x.toFixed(1)}:${g.motion.toString(16)}`).join(" "));
    } else {
      check(figs.length === c.list.length
            && figs.every((g, i) => g.type === c.list[i]
                          && g.motion >= 0x18b && g.motion <= 0x18d),
            "no rescue: the scene's own list, on 0x18B..0x18D",
            figs.map((g) => `${g.type.toString(16)}:${g.motion.toString(16)}`).join(" "));
    }
    const n = c.rescued.length;
    check(trace[30].count === -1 && trace[31].count === 0
          && trace[51].count === Math.min(1, n)
          && trace[CARD_FRAMES - 1].count === n,
          "the count shows from frame 31, one a third of a second, up to the rescues",
          `30:${trace[30].count} 31:${trace[31].count} 51:${trace[51].count} `
          + `419:${trace[CARD_FRAMES - 1].count}`);
    const life = trace.findIndex((r, i) => i > 0 && r && r.lives !== start.lives);
    const want = Math.min(start.lives + c.bonus, 5);
    check(c.bonus === 0 ? life === -1 && trace[CARD_FRAMES].lives === start.lives
                        : life === LIFE_FRAME && trace[CARD_FRAMES].lives === want,
          `the life bonus: +${c.bonus} on frame ${LIFE_FRAME}, capped at g_max_lives`,
          `${start.lives} -> ${trace[CARD_FRAMES].lives} at frame ${life}`);
    check(trace[100].score === "12345" && trace[100].accuracy === "75",
          "player 1's score and accuracy drawn: 12345, 75",
          `score ${trace[100].score} accuracy ${trace[100].accuracy}`);
    if (c.bonus > 0) {
      const turn = trace.findIndex((r, i) => i > 0 && r && r.figs[0]
                                   && r.figs[0].motion === 0x180);
      const held = trace.filter((r) => r && r.figs[0] && r.figs[0].holds).length;
      check(trace[turn].cam === LIFE_CAM_FRAME && held === 0x57 - 0x1e + 1,
            "figure 0 turns to 0x180 at camera frame 0x104 and holds the life up "
            + "for 58 frames", `turn at cam ${trace[turn]?.cam}, held ${held}`);
      const last = trace[CARD_FRAMES].figs[0];
      check(last.frozen === 1 && last.cursor === 0x81,
            "...and freezes on cursor 0x81", `frozen ${last.frozen} cursor ${last.cursor}`);
      check(trace[CARD_FRAMES].figs.slice(1).every((g) => g.motion !== 0x180),
            "...alone");
    }
    const end = trace[CARD_FRAMES];
    check(end.flag === 1 && !end.card && trace[CARD_FRAMES - 1].flag === 0,
          "the card raises g_script_flags[0xFE] on frame 420 and is gone",
          `419 ${trace[CARD_FRAMES - 1].flag} 420 ${end.flag}`);
    const over = trace.findIndex((r, i) => i > CARD_FRAMES && r && r.at === "-");
    check(over > CARD_FRAMES && over <= CARD_FRAMES + 10,
          "...and within a few frames the step ends the scene",
          `at ${over}: ${trace[CARD_FRAMES + 10]?.at}`);
    check(state.faults === 0, "no console errors", `${state.faults}`);
  } finally {
    await close();
  }
}

for (const c of CASES) await runCase(c);
console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);
