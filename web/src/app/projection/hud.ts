/**
 * What the debug sidebar reads, grouped by subject.
 *
 * The player used to say everything twice, on opposite sides of the page: a
 * checkbox per layer along the top, and a line per layer's `describe` down the
 * right. So understanding the props layer meant reading a control top-left and
 * a readout bottom-right, with nothing but the word "props" connecting them,
 * and both lists grew one entry at a time until the top bar was sixteen
 * checkboxes and the strip was thirty rows with no scroller.
 *
 * **A control and the readout it affects belong together.** So the sidebar is
 * one panel per subject, each holding that subject's switches *and* its
 * numbers, and the top bar keeps only what is about the session rather than
 * about a layer — which stage, which mode, the snapshot buttons.
 *
 * The rows are built here because this is a projection like the others: a read
 * with no writes, over things `ui/` may not see. The switches are not here at
 * all — they come from the `TOGGLES` table in `ui/panels/Toggles.tsx`, which
 * stays the one owner of what a toggle *is*, with a `group` field saying which
 * panel draws it.
 *
 * **A row is one line.** Nothing that can grow without bound belongs in one:
 * the rig list was a row once, a hundred-odd names joined with commas, and it
 * pushed the panels below it off the bottom of the column. Lists get a panel
 * that folds and scrolls.
 */
import { G } from "../../game/globals";
import { SHUTTER_LABEL } from "../../script/ops/hud";
import type { Walker } from "../../script/walker";
import type { DebugGroupName, StripRow } from "../../ui/projection";

/**
 * The shutter's row: what state it is in, and any dialogue still counting.
 *
 * The parameter is the two walker fields this reads and not `Walker` itself.
 * `Walker` satisfies it structurally, so the call site is unchanged, and
 * naming the two fields is what lets the check in `test/projection.test.ts`
 * hand it a plain object and pin all nine labels without a bundle.
 *
 * `shown` is `toggles.hud`, read from `Player` where the toggle lives, so the
 * sentence and `.hud-layer`'s `hidden` come from one fact rather than two.
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

export interface XYZ { x: number; y: number; z: number }

/** Anything with a one-line readout. Every render layer has one. */
interface Describes { readonly describe: string }

/**
 * What {@link hudInputs} reads off the player.
 *
 * Structural and named for the members `Player` already has, so it is a third
 * declared surface beside `PlayerView` and `PlayerCommands` rather than a
 * second argument list to keep in step. It was a private getter in `main.ts`,
 * where the shape of what the sidebar reads sat thirty lines from the code
 * that reads it and the composition root was formatting `tris` counts.
 */
export interface HudSource {
  readonly walker: Walker | null;
  readonly scene3d: {
    readonly visibility: string;
    readonly visibleCount: number;
    readonly visibleTriangles: number;
  } | null;
  readonly state: { readonly mode: string };
  readonly toggles: { readonly hud: boolean };
  readonly camera: { readonly position: XYZ };
  /** The camera rig's pose scratch — where the block is aimed. */
  readonly cam: { readonly pose: { readonly target: XYZ } };
  readonly ctx: { readonly view: { readonly yawBams: number } };
  readonly chars: Describes;
  readonly props: Describes;
  readonly rigs: Describes;
  readonly breakables: Describes;
  readonly shooting: Describes;
  readonly coliDebug: Describes;
  readonly stuckDebug: Describes;
  /** `app/systems.ts`'s `GameSystem`: permits, tracking, live enemies. */
  readonly game: Describes;
  readonly rain: Describes;
  readonly sceneFog: Describes;
  readonly lighting: Describes;
  readonly backdrop: Describes;
}

/**
 * Everything the debug sidebar reads, built where it is read.
 *
 * One call, two shapes: the Player strip and the per-subject groups. They
 * share every input, so building them apart would mean reading the same dozen
 * layers twice a frame and keeping two argument lists in step.
 */
export function hudInputs(p: HudSource): HudInputs | null {
  const w = p.walker;
  if (!w || !p.scene3d) return null;
  return {
    mode: p.state.mode,
    allRegions: p.scene3d.visibility === "all",
    drawn: `${p.scene3d.visibleCount} models, `
         + `${p.scene3d.visibleTriangles.toLocaleString()} tris`,
    eye: p.camera.position,
    target: p.cam.pose.target,
    yawBams: p.ctx.view.yawBams,
    describe: {
      characters: p.chars.describe,
      props: p.props.describe,
      rigs: p.rigs.describe,
      breakables: p.breakables.describe,
      shooting: p.shooting.describe,
      coli: p.coliDebug.describe,
      wedged: p.stuckDebug.describe,
      enemies: p.game.describe,
      shutter: describeShutter(w, p.toggles.hud),
      rain: p.rain.describe,
      fog: p.sceneFog.describe,
      light: p.lighting.describe,
      sky: p.backdrop.describe,
    },
  };
}

/** What the strip and the groups need that is not the walker's. */
export interface HudInputs {
  mode: string;
  /** True while every region is drawn at once. */
  allRegions: boolean;
  drawn: string;
  eye: XYZ;
  /** Where the camera is aimed — the block's target, as the rig holds it. */
  target: XYZ;
  /** The camera's heading in the engine's own units. See `core/bams.ts`. */
  yawBams: number;
  describe: {
    characters: string; props: string; rigs: string; breakables: string;
    shooting: string; coli: string; wedged: string; enemies: string;
    shutter: string; rain: string; fog: string; light: string; sky: string;
  };
}

const fmtVec = (v: XYZ): string =>
  `${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)}`;

/** BAMS as the engine stores them, and as a person reads them. */
const fmtBams = (b: number): string =>
  `${(b * 360 / 65536).toFixed(1)}°  0x${b.toString(16).toUpperCase().padStart(4, "0")}`;

/**
 * The Player strip: where the script is, and nothing about a render layer.
 *
 * Everything that belongs to a layer moved into that layer's group, which is
 * what got this from thirty rows to nine.
 */
export function hudRows(w: Walker, x: HudInputs): StripRow[] {
  const d = x.describe;
  const route = w.currentBlock?.route;
  return [
    ["mode", x.mode],
    ["block", `${w.block}  (${route?.kind ?? "?"}` +
      `${route && route.next.some((n) => n >= 0)
        ? " → " + route.next.filter((n) => n >= 0).join(",") : ""})`],
    ["step / op", `${w.step} / ${w.opIndex}`],
    ["spawns", `${w.spawns.length} placed`
      + (w.liveEnemies ? `, ${w.liveEnemies} the enemy gate waits on` : "")],
    ["lives", `${G.g_player_lives[0]}`
      + (G.g_player_invuln_frames > 0
        ? ` · invulnerable ${Math.ceil(G.g_player_invuln_frames)}f` : "")],
    ["bgm", w.bgmTrack === null ? "—" : `track ${w.bgmTrack}`],
    ["shutter", d.shutter],
    // The two globals the skip feature hangs off, so it is visible that the
    // region opened and the gate dropped even when nothing is pressed.
    ["skip", w.skipRequested ? "requested"
      : w.canSkip ? "offered"
      : w.skippable ? "region open, firing gate up" : "—"],
    ["last se", w.lastSound === null ? "—"
      : `0x${w.lastSound.toString(16).toUpperCase()}`],
  ];
}

/**
 * One group's readouts, keyed by the same names the `TOGGLES` table uses.
 *
 * Adding a group is a name here, a name in `DebugGroupName`, and one `<Panel>`
 * in the sidebar — the switches follow on their own from the table.
 */
export function groupRows(w: Walker, x: HudInputs):
    Record<DebugGroupName, StripRow[]> {
  const d = x.describe;
  const cam = w.cam;
  return {
    camera: [
      ["slot", cam ? String(cam.slot) : "—"],
      // The shot's own end frame, which is what it plays to -- not the
      // curve's extent. `cam_play` names both ends and may run either way.
      ["frame", cam
        ? `${cam.frame.toFixed(1)} / `
          + `${Math.max(cam.startFrame, cam.endFrame).toFixed(0)}`
        : "—"],
      ["eye", fmtVec(x.eye)],
      ["look at", fmtVec(x.target)],
      ["yaw", fmtBams(x.yawBams)],
      ["roll channel", w.rollEnabled ? "on (opcode 0x35)" : "off"],
      // `SelectCameraLookAtTarget` aims at the actor holding a permit; the
      // latch is what says the gameplay camera has taken the shot over.
      ["tracking", G.g_camera_is_tracking ? "locked on an actor" : "off"],
    ],
    scene: [
      ["region", w.region < 0 ? "—" : String(w.region), x.allRegions],
      ["drawn", x.drawn],
      ["sky", d.sky],
      ["rain", d.rain],
      ["fog", d.fog],
      ["light", d.light],
    ],
    actors: [
      ["characters", d.characters],
      ["enemies", d.enemies],
    ],
    props: [
      ["props", d.props],
      ["breakables", d.breakables],
      ["rigs", d.rigs],
    ],
    collision: [
      ["coli", d.coli],
      ["wedged", d.wedged],
    ],
    shooting: [
      ["shooting", d.shooting],
    ],
  };
}
