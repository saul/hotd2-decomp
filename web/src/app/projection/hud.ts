/**
 * The key/value strip along the top: what the player believes, right now.
 *
 * Thirty rows, and almost every one of them is either a fact off the walker or
 * a layer's own one-line `describe`. It lives here rather than in `main.ts`
 * because it is a projection like the others — a read with no writes — and
 * because a table of thirty entries is easier to keep honest when it is the
 * whole file.
 *
 * The `describe` strings are passed in rather than read: `ui/` may not see a
 * layer, and this is the boundary where a layer's own summary becomes a
 * string.
 */
import { G } from "../../game/globals";
import { SHUTTER_LABEL } from "../../script/ops/hud";
import type { Walker } from "../../script/walker";

/**
 * The shutter's row: what state it is in, and any dialogue still counting.
 *
 * It was `Hud.describe` in `hud/`, which needed its own copy of the label
 * table because `ui/` may not import from `script/` — so the nine states had
 * two names each and nothing checked that they agreed. Here the table is the
 * one in `script/ops/hud.ts` that the feed already uses, because `app/` is the
 * layer allowed to see both sides.
 *
 * The parameter is the two walker fields this reads and not `Walker` itself.
 * `Walker` satisfies it structurally, so the call site is unchanged, and
 * naming the two fields is what lets the check in `test/projection.test.ts`
 * hand it a plain object and pin all nine labels without a bundle.
 *
 * `shown` is `toggles.hud`, read from `Player` where the toggle lives. `Hud`
 * used to hold a copy of that boolean, set through `setEnabled`, purely so
 * this sentence could say `"off"` — a second owner of a fact React had
 * already taken for `.hud-layer`'s `hidden` in step 26, and a frame behind it.
 * The row still says `"off"`; the copy is gone.
 */
export function describeShutter(
    w: { shutterState: number; captionFrames: number } | null,
    shown: boolean): string {
  if (!shown) return "off";
  const state = w?.shutterState ?? 2;
  const label = SHUTTER_LABEL[state] ?? `state ${state}`;
  const frames = w?.captionFrames ?? 0;
  return `${label}${frames > 0 ? `, dialogue ${Math.ceil(frames)}f` : ""}`;
}

/** What the strip needs that is not the walker's and not a `describe`. */
export interface HudInputs {
  mode: string;
  /** True while every region is drawn at once. */
  region: boolean;
  drawn: string;
  eye: { x: number; y: number; z: number };
  describe: {
    fog: string; light: string; sky: string; rigs: string;
    characters: string; props: string; breakables: string; shooting: string;
    coli: string; wedged: string; enemies: string; shutter: string;
    rain: string;
  };
}

const fmtVec = (v: { x: number; y: number; z: number }): string =>
  `${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)}`;

export function hudRows(w: Walker, x: HudInputs):
    [string, string, boolean?][] {
  const d = x.describe;
  const route = w.currentBlock?.route;
  const cam = w.cam;
  return [
      ["mode", x.mode],
      ["block", `${w.block}  (${route?.kind ?? "?"}` +
        `${route && route.next.some((n) => n >= 0)
          ? " → " + route.next.filter((n) => n >= 0).join(",") : ""})`],
      ["step / op", `${w.step} / ${w.opIndex}`],
      ["region", w.region < 0 ? "—" : String(w.region),
        x.region],
      ["drawn", x.drawn],
      ["cam slot", cam ? String(cam.slot) : "—"],
      ["cam frame", cam ? cam.frame.toFixed(1) : "—"],
      ["roll channel", w.rollEnabled ? "on (opcode 0x35)" : "off"],
      ["spawns", `${w.spawns.length} placed`
        + (w.liveEnemies ? `, ${w.liveEnemies} the enemy gate waits on` : "")],
      ["waiting on", w.wait ? w.wait.blocksOn : "—", !!w.wait],
      ["bgm", w.bgmTrack === null ? "—" : `track ${w.bgmTrack}`],
      ["fog", d.fog],
      ["light", d.light],
      ["sky", d.sky],
      ["rigs", d.rigs],
      ["characters", d.characters],
      ["props", d.props],
      ["breakables", d.breakables],
      ["shooting", d.shooting],
      ["coli", d.coli],
      ["wedged", d.wedged],
      ["enemies", d.enemies],
      ["lives", `${G.g_player_lives[0]}`
        + (G.g_player_invuln_frames > 0
          ? ` · invulnerable ${Math.ceil(G.g_player_invuln_frames)}f` : "")],
      ["shutter", d.shutter],
      // The two globals the skip feature hangs off, so it is visible that the
      // region opened and the gate dropped even when nothing is pressed.
      ["skip", w.skipRequested ? "requested"
        : w.canSkip ? "offered"
        : w.skippable ? "region open, firing gate up" : "—"],
      ["rain", d.rain],
      ["last se", w.lastSound === null ? "—"
        : `0x${w.lastSound.toString(16).toUpperCase()}`],
      ["eye", fmtVec(x.eye)],
    ];
}
