/**
 * Class 0x13's props in the running page: the three angles each one holds, and
 * pictures of them at the driven frames asked for.
 *
 *     node tools/props13_look.mjs --headless
 *     node tools/props13_look.mjs --headless --url '?stage=2&mode=play&block=20&step=2&op=21' \
 *         --ats 84232 --frames 212 --out props13-sky
 *
 * `ScriptedPropUpdate13` (`FUN_0043FE90`) draws `T; RotX(obj+0x64);
 * RotZ(obj+0x6C); RotY(obj+0x68)`, and `SpawnFromDescriptorSmall`
 * (`FUN_00408BC0`) fills all three from the record. Stage 2 has five static
 * props whose record carries a pitch: four of `komono_st1.bin[3]` at block 17
 * step 1 (the default here) and one of `etc_1.bin[63]` placed in blocks 16,
 * 20, 35 and 39.
 *
 * Under `?drive=1` it advances until the named spawns exist, then on to each
 * driven frame in `--frames` (default 420: the camera's hold at the end of
 * path 81, looking out through the window the four stand in), and screenshots
 * the frame and a crop round the props in view. What it asserts it reads out
 * of the page's own `G` and its own tables (`L44`): each prop's `pitch`, `yaw`
 * and `roll` against the placement the bundle carries for it.
 */
import { join } from "node:path";
import { openPlayer, waitForLoad, SHOTS } from "./lib/player.mjs";

const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const where = opt("url", "?stage=2&mode=play&block=17&step=1&op=34");
const tag = opt("out", "props13");
const ats = opt("ats", "48896,48952,49008,49064").split(",").map(Number);
const BUDGET = Number(opt("budget", "1800"));

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
  const advance = (n) =>
    page.evaluate((k) => globalThis.__hotd2Drive.advance(k), n);
  /** The named props in the page's pool, off its own `G` and tables. */
  const census = () => page.evaluate(async (want) => {
    const { G } = await import("/src/game/globals.ts");
    const { T } = await import("/src/game/tables.ts");
    const pl = new Map((T.chars?.placements ?? []).map((p) => [p.at, p]));
    return G.g_object_list
      .filter((o) => o.cls === 0x13 && !o.despawned && want.includes(o.at))
      .map((o) => ({
        at: o.at, pitch: o.pitch, yaw: o.yaw, roll: o.roll,
        pos: [o.pos.x, o.pos.y, o.pos.z], slot: o.prop13?.slot,
        want: { pitch: pl.get(o.at)?.pitch ?? 0, yaw: pl.get(o.at)?.yaw ?? 0,
                roll: pl.get(o.at)?.roll ?? 0 },
        cam: `${G.g_active_cam_path}/${G.g_cam_path_frame}`,
      }));
  }, ats);
  // Where each is on screen, through the page's own `g_camera_world_to_view`
  // (`0x009A6000`) -- not the shot list: a static prop's `obj+0x124` is 0, so
  // `RegisterForShotTest` lists it with no sphere and the harness's
  // `shotTargets` has nothing to project. View space looks down -z; `x` and
  // `y` here are the tangents off the axis, `z` the distance ahead.
  const targets = () => page.evaluate(async (want) => {
    const { G } = await import("/src/game/globals.ts");
    const { MatrixTransformPoint } = await import("/src/game/matrix.ts");
    const out = [];
    for (const o of G.g_object_list) {
      if (o.cls !== 0x13 || o.despawned || !want.includes(o.at)) continue;
      const v = { x: 0, y: 0, z: 0 };
      MatrixTransformPoint(G.g_camera_world_to_view, o.pos, v);
      if (v.z >= -1) continue;
      out.push({ at: o.at, x: v.x / -v.z, y: v.y / -v.z, z: -v.z });
    }
    return out;
  }, ats);
  const box = await page.locator("#viewport").boundingBox();
  const shot = async (name, clip) => {
    const path = join(SHOTS, `${tag}-${name}.png`);
    await page.screenshot({ path, ...(clip ? { clip } : {}) });
    return path;
  };
  /** The page's vertical half-angle tangent, off its three.js camera's fov
   * (`app/main.ts`); the aspect is the viewport's. */
  const tanY = Math.tan((Number(opt("fov", "41.1")) * Math.PI / 180) / 2);
  const tanX = tanY * box.width / box.height;
  /** A crop round the centroid of what is in view, inside the viewport. */
  const cropAt = (ts) => {
    const w = 640, h = 440;
    const x = ts.reduce((a, t) => a + t.x / tanX, 0) / ts.length;
    const y = ts.reduce((a, t) => a + t.y / tanY, 0) / ts.length;
    const cx = box.x + ((x + 1) / 2) * box.width;
    const cy = box.y + ((1 - y) / 2) * box.height;
    return {
      x: Math.max(box.x, Math.min(box.x + box.width - w, cx - w / 2)),
      y: Math.max(box.y, Math.min(box.y + box.height - h, cy - h / 2)),
      width: w, height: h,
    };
  };
  const inView = (t) => Math.abs(t.x) < 0.9 * tanX
    && Math.abs(t.y) < 0.9 * tanY;

  let f = 0;
  let c = await census();
  while (f < BUDGET && c.length === 0) {
    await advance(2);
    f += 2;
    c = await census();
  }
  check(`the props ${ats.join(", ")} are built`, c.length === ats.length,
        `${c.length} of ${ats.length} after ${f} frames`);
  for (const p of c) {
    const same = p.pitch === p.want.pitch && p.yaw === p.want.yaw
      && p.roll === p.want.roll;
    check(`${p.at} (slot 0x${(p.slot ?? 0).toString(16)}) holds its record's `
          + `three angles`, same,
          `page (${p.pitch}, ${p.yaw}, ${p.roll}) record `
          + `(${p.want.pitch}, ${p.want.yaw}, ${p.want.roll}) at `
          + `${p.pos.map((v) => v.toFixed(1)).join(", ")}`);
  }

  // Shoot at the driven frames asked for. Not "the nearest frame in view":
  // at block 17's first frames the four are in view and **inside** the wall
  // of the window they stand in, drawn and hidden, and a picker that cannot
  // see occlusion chose exactly those frames. `--trace` prints where each is.
  const want = opt("frames", "420").split(",").map(Number)
    .sort((a, b) => a - b);
  const shots = [];
  while (f < BUDGET && want.length) {
    await advance(2);
    f += 2;
    const all = await targets();
    if (args.includes("--trace") && f % 30 === 0) {
      const cam = (await census())[0]?.cam ?? "-";
      console.log(`  f${f} cam ${cam}: ` + (all.map((t) => `${t.at} `
        + `(${t.x.toFixed(2)}, ${t.y.toFixed(2)}) at ${t.z.toFixed(0)}`)
        .join("; ") || "none ahead"));
    }
    if (f < want[0]) continue;
    const at = want.shift();
    const ts = all.filter(inView);
    const cam = (await census())[0]?.cam ?? "-";
    const full = await shot(`f${at}`);
    const crop = ts.length ? await shot(`f${at}-near`, cropAt(ts)) : null;
    shots.push(`f${f} cam ${cam}: ${ts.map((t) => t.at).join(", ") || "none"}`
               + ` in view -- ${full}${crop ? ` and ${crop}` : ""}`);
  }
  check("every frame asked for was shot", want.length === 0,
        `${want.length} left at driven frame ${f}`);
  for (const s of shots) console.log(`  shot ${s}`);
  check("the page raised no faults", state.faults === 0,
        state.faultLines.join(" | "));
} finally {
  await close();
}
process.exit(failures ? 1 : 0);
