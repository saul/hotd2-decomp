/**
 * The top bar: which stage, which mode, and how the scene is drawn.
 *
 * Everything here is a command. The stage select and the Original checkbox
 * reload; the mode buttons switch what the transport means; the three view
 * settings are the player's own — the game has no such choices — and their
 * tooltips are the only place that says so.
 */
import type { Dispatch } from "../commands";
import type { UiProjection } from "../projection";

const LIGHT = [
  { value: "unlit", label: "unlit (baked)" },
  { value: "scene", label: "+ scene light" },
];

const FOG = [
  { value: "radial", label: "radial" },
  { value: "planar", label: "planar (as the game)" },
  { value: "off", label: "off" },
];

const MODES: { mode: "step" | "play" | "free"; label: string }[] = [
  { mode: "step", label: "Step" },
  { mode: "play", label: "Play" },
  { mode: "free", label: "Free roam" },
];

export function StagePicker({ p, dispatch }:
  { p: UiProjection; dispatch: Dispatch }) {
  return (
    <>
      <label>
        Stage{" "}
        <select value={p.stage}
                onChange={(e) => dispatch({ kind: "setStage",
                                            stage: Number(e.target.value) })}>
          {p.stages.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label title="Game mode 1. Same regions; a few slots resolve to the st_org* models Arcade never draws.">
        <input type="checkbox" checked={p.original}
               onChange={(e) => dispatch({ kind: "setOriginal",
                                           on: e.target.checked })} />
        {" "}Original
      </label>
    </>
  );
}

export function Modes({ mode, dispatch }:
  { mode: string; dispatch: Dispatch }) {
  return (
    <>
      {MODES.map((m) => (
        <button key={m.mode}
                className={`mode${mode === m.mode ? " active" : ""}`}
                onClick={() => dispatch({ kind: "setMode", mode: m.mode })}>
          {m.label}
        </button>
      ))}
    </>
  );
}

export function ViewSettings({ p, dispatch }:
  { p: UiProjection; dispatch: Dispatch }) {
  return (
    <>
      <button className="kill" hidden={!p.toggles.shoot}
              title="Kill every live enemy outright -- hit points to zero and the directional death, the same thing that opens the live-enemy gate. Nothing is severed, because no bone was hit."
              onClick={() => dispatch({ kind: "killAll" })}>Kill</button>
      <button title="Snapshot the whole game state: the walker's program counter and flags, the data segment, every actor and the random seed. Nothing from three.js -- the renderers rebuild from those, which is the test that the split is in the right place. See docs/PLAYER_ARCHITECTURE.md."
              onClick={() => dispatch({ kind: "saveState" })}>Save</button>
      <button disabled={!p.hasSaved}
              title="Restore the last snapshot. The player becomes identical to the moment it was taken, down to the next attack the RNG draws."
              onClick={() => dispatch({ kind: "loadState" })}>Load</button>
      <label title="The game is 4:3 and its projection is a compile-time constant: 41.1 degrees vertical.">
        <input type="checkbox" checked={p.pillarbox}
               onChange={(e) => dispatch({ kind: "setPillarbox",
                                           on: e.target.checked })} />
        {" "}4:3
      </label>
      <label title="The game bakes most illumination into textures and the per-mesh base colour, so unlit is the faithful baseline. 'Scene' adds the one directional light SetLightingDefaultSingle installs, with the direction, colour and ambient the script sets.">
        Light{" "}
        <select value={p.lightMode}
                onChange={(e) => dispatch({ kind: "setLightMode",
                                            mode: e.target.value })}>
          {LIGHT.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      <label title="Fog colour and range come from the script (evt 0x20-0x27). Radial uses true distance from the eye; planar reproduces the game's view-space-Z falloff, which fogs the screen corners less than the centre.">
        Fog{" "}
        <select value={p.fogMode}
                onChange={(e) => dispatch({ kind: "setFogMode",
                                            mode: e.target.value })}>
          {FOG.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
    </>
  );
}
