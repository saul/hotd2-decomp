/**
 * Class 0x41 types 70 to 77 in the running page: what the pool holds, and
 * pictures of them.
 *
 *     HOTD2_BUNDLE=... node tools/collectibles_look.mjs --headless \
 *         --url '?stage=4&original=1&mode=play&block=2&step=5&op=0' \
 *         --frames 30,200 --out coll-s4b2
 *
 * Original Mode only -- every one of these routines but 74's and 75's leaves
 * on its first Arcade frame. `--hold 0x1F` puts an item in player 0's first
 * inventory slot through the page's own `G` (debug only), which is what type
 * 77 wants before it will fly. `--shoot` lands a shot on each of them on the
 * first frame they exist, and `--shoot-at n` on the n-th frame after that,
 * through `BreakablePropTakeShot`, the seam `ProcessPlayerShots` writes.
 *
 * What it prints is read out of the page's own `G` (`L44`): each prop's
 * family, type, model, item id, phase and pose. The pictures are the
 * evidence for the draw; a crop is taken round the props in view, projected
 * through `g_camera_world_to_view`.
 */
import { join } from "node:path";
import { openPlayer, requireBundle, waitForLoad, SHOTS } from "./lib/player.mjs";

requireBundle("collectibles_look");
const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const where = opt("url", "?stage=4&original=1&mode=play&block=2&step=5&op=0");
const tag = opt("out", "collectibles");
const BUDGET = Number(opt("budget", "3000"));
const FAMILIES = [8, 70, 72, 74, 76, 77];
const hold = opt("hold") === null ? null : Number(opt("hold"));

const { page, state, close } = await openPlayer({
  url: `${where}&drive=1&seed=${opt("seed", "1")}`,
  size: opt("size", "1600x1000"), headless: args.includes("--headless"),
  quiet: true,
});

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
};

try {
  await waitForLoad(page);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press("Space");
  // `--clear` keeps the room open and the player alive: the enemy gates in
  // front of these placements are the script's, and a harness that does not
  // fight would otherwise sit at a game over (`ActorKillAll`, debug only).
  // `--lives` only keeps the player in play, and lets the script's own
  // fights run -- a killed room can carry the walker a stage further than
  // the frames asked for.
  const clear = args.includes("--clear");
  const lives = clear || args.includes("--lives");
  const advance = async (n) => {
    await page.evaluate((k) => globalThis.__hotd2Drive.advance(k), n);
    if (!lives) return;
    await page.evaluate(async (kill) => {
      const { G } = await import("/src/game/globals.ts");
      const { ActorKillAll } = await import("/src/game/combat/resolve_hit.ts");
      const { Rng } = await import("/src/core/rng.ts");
      if (kill) ActorKillAll(new Rng(1));
      G.g_player_lives[0] = Math.max(G.g_player_lives[0], 5);
    }, clear);
  };
  // `--flag n` raises `g_script_flags[n]` (debug only): stage 2's script
  // never raises 0x12 itself, and type 72 leaves at its cue without it.
  if (opt("flag") !== null) {
    await page.evaluate(async (n) => {
      const { G } = await import("/src/game/globals.ts");
      G.g_script_flags[n] = 1;
    }, Number(opt("flag")));
  }
  if (hold !== null) {
    await page.evaluate(async (id) => {
      const { G } = await import("/src/game/globals.ts");
      G.g_players_in_play = Math.max(1, G.g_players_in_play);
      G.g_original_item_slots[0] = [id, -1];
    }, hold);
  }
  const census = () => page.evaluate(async (fams) => {
    const { G } = await import("/src/game/globals.ts");
    return G.g_breakable_props
      .filter((p) => !p.dead && fams.includes(p.family))
      .map((p) => ({
        id: p.id, at: p.at, family: p.family, type: p.kind,
        slot: p.slot, slotB: p.slotB, item: p.originalItem,
        phase: p.routinePhase, cue: p.cuePhase, strip: p.storyItem,
        pos: [p.x, p.y, p.z], shot: [p.shotX, p.shotY, p.shotZ],
        reg: p.shotRegistered, path: p.pathPose,
        cam: `${G.g_active_cam_path}/${G.g_cam_path_frame}`,
        mode: G.g_GameMode,
      }));
  }, FAMILIES);
  const shootAll = () => page.evaluate(async (fams) => {
    const { G } = await import("/src/game/globals.ts");
    const { BreakablePropTakeShot } = await import("/src/game/class41/prop.ts");
    for (const p of G.g_breakable_props) {
      if (!p.dead && fams.includes(p.family)) BreakablePropTakeShot(p, 0);
    }
  }, FAMILIES);
  const targets = () => page.evaluate(async (fams) => {
    const { G } = await import("/src/game/globals.ts");
    const { MatrixTransformPoint } = await import("/src/game/matrix.ts");
    const out = [];
    for (const p of G.g_breakable_props) {
      if (p.dead || !fams.includes(p.family)) continue;
      const at = p.pathPose && p.family === 8
        ? { x: p.pathPose.x, y: p.pathPose.y, z: p.pathPose.z }
        : { x: p.shotX || p.x, y: p.shotY || p.y, z: p.shotZ || p.z };
      const v = { x: 0, y: 0, z: 0 };
      MatrixTransformPoint(G.g_camera_world_to_view, at, v);
      if (v.z >= -1) continue;
      out.push({ id: p.id, x: v.x / -v.z, y: v.y / -v.z, z: -v.z });
    }
    return out;
  }, FAMILIES);
  const box = await page.locator("#viewport").boundingBox();
  const shot = async (name, clip) => {
    const path = join(SHOTS, `${tag}-${name}.png`);
    await page.screenshot({ path, ...(clip ? { clip } : {}) });
    return path;
  };
  const tanY = Math.tan((41.1 * Math.PI / 180) / 2);
  const tanX = tanY * box.width / box.height;
  const cropAt = (t) => {
    const w = 480, h = 360;
    const cx = box.x + ((t.x / tanX + 1) / 2) * box.width;
    const cy = box.y + ((1 - t.y / tanY) / 2) * box.height;
    return {
      x: Math.max(box.x, Math.min(box.x + box.width - w, cx - w / 2)),
      y: Math.max(box.y, Math.min(box.y + box.height - h, cy - h / 2)),
      width: w, height: h,
    };
  };

  let f = 0;
  let c = await census();
  while (f < BUDGET && c.length === 0) {
    await advance(2);
    f += 2;
    c = await census();
  }
  check("the page is in Original Mode and the props are built",
        c.length > 0 && c[0].mode === 1, `${c.length} after ${f} frames`);
  if (!c.length) {
    // Say what the pool does hold, so an empty census can be told apart
    // from an empty pool.
    const pool = await page.evaluate(async () => {
      const { G } = await import("/src/game/globals.ts");
      return G.g_breakable_props.map((p) => `${p.family}/${p.kind}@${p.at}`)
        .join(" ") + ` mode ${G.g_GameMode} block ${G.g_evt_block_index}`
        + ` step ${G.g_evt_step_index}`;
    });
    console.log(`  pool: ${pool}`);
  }
  for (const p of c) console.log(`  f${f} ${JSON.stringify(p)}`);
  if (args.includes("--shoot")) await shootAll();

  const want = opt("frames", "30").split(",").map(Number)
    .sort((a, b) => a - b);
  // `--hide`: take these props out of the pool one frame before each shot,
  // so a run with it and a run without, on one seed, differ in their pixels
  // by exactly what they draw (`L66`, `L69`). Nothing the game reads back.
  const hide = args.includes("--hide");
  const start = f;
  while (f < start + BUDGET && want.length) {
    if (hide && f + 1 - start >= want[0]) {
      await page.evaluate(async (fams) => {
        const { G } = await import("/src/game/globals.ts");
        G.g_breakable_props = G.g_breakable_props.filter(
          (p) => !fams.includes(p.family));
      }, FAMILIES);
    }
    await advance(1);
    f += 1;
    if (Number(opt("shoot-at", "-1")) === f - start) await shootAll();
    if (f - start < want[0]) continue;
    want.shift();
    const now = await census();
    for (const p of now) console.log(`  f${f} ${JSON.stringify(p)}`);
    const ts = (await targets()).filter(
      (t) => Math.abs(t.x) < 0.95 * tanX && Math.abs(t.y) < 0.95 * tanY);
    const full = await shot(`f${f - start}`);
    console.log(`  shot ${full}`);
    // The breakables layer's own account of what it drew, off the debug
    // panel's Props section.
    if (args.includes("--panel")) {
      await page.getByText("Props", { exact: true }).first().click()
        .catch(() => {});
      const text = await page.evaluate(() => document.body.innerText);
      for (const line of text.split("\n")) {
        if (/ up \(|no template|placed but/.test(line)) {
          console.log(`  panel: ${line}`);
        }
      }
    }
    for (const t of ts) {
      const crop = await shot(`f${f - start}-p${t.id}`, cropAt(t));
      console.log(`  prop ${t.id} in view at ${t.z.toFixed(0)} -- ${crop}`);
    }
  }
  check("the page raised no faults", state.faults === 0,
        state.faultLines.join(" | "));
} finally {
  await close();
}
process.exit(failures ? 1 : 0);
