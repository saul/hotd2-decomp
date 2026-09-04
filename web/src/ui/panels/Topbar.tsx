/**
 * The top bar: which stage, which mode, and how the scene is drawn.
 *
 * Everything here is a command. The stage select and the Original checkbox
 * reload; the mode buttons switch what the transport means; the three view
 * settings are the player's own — the game has no such choices — and their
 * tooltips are the only place that says so.
 *
 * Four small components rather than one, because they read four unrelated
 * parts of the projection and a change to any one of them should cost only the
 * controls that show it. `StagePicker` and `ViewSettings` used to take the
 * whole `UiProjection` as a prop, which meant their `memo` could never bail on
 * any frame — the checker reported the rule green while the rule was doing
 * nothing at all. Neither is memoised now and neither needs to be: they
 * subscribe to the fields they draw.
 */
import { useDispatch } from "../store_context";
import { useSlice } from "../useSlice";

const LIGHT = [
  { value: "unlit", label: "unlit (baked)" },
  { value: "scene", label: "+ scene light" },
];

const FOG = [
  { value: "planar", label: "as the game" },
  { value: "radial", label: "radial" },
  { value: "off", label: "off" },
];

/**
 * The filter override.
 *
 * `asset` is the default and the faithful one: the exporter writes a glTF
 * sampler per mesh from the game's own TSP filter bit, so the bundle already
 * says nearest or bilinear per surface. The rest force one everywhere.
 */
const FILTER = [
  { value: "asset", label: "as the game" },
  { value: "nearest", label: "nearest" },
  { value: "bilinear", label: "bilinear" },
  { value: "trilinear", label: "trilinear" },
  { value: "aniso", label: "anisotropic" },
];

const MODES: { mode: "step" | "play" | "free"; label: string }[] = [
  { mode: "step", label: "Step" },
  { mode: "play", label: "Play" },
  { mode: "free", label: "Free roam" },
];

export function StagePicker() {
  const dispatch = useDispatch();
  const stage = useSlice((p) => p?.stage);
  const stages = useSlice((p) => p?.stages);
  const original = useSlice((p) => p?.original);
  // Nothing to pick from before there is a projection. Rendering the select
  // anyway would make it an uncontrolled input for one commit and a controlled
  // one for the next, which React warns about and is right to.
  if (stage === undefined || stages === undefined) return null;
  return (
    <>
      <label>
        Stage{" "}
        <select value={stage}
                onChange={(e) => dispatch({ kind: "setStage",
                                            stage: Number(e.target.value) })}>
          {stages.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label title="Game mode 1. Same regions; a few slots resolve to the st_org* models Arcade never draws.">
        <input type="checkbox" checked={!!original}
               onChange={(e) => dispatch({ kind: "setOriginal",
                                           on: e.target.checked })} />
        {" "}Original
      </label>
    </>
  );
}

export function Modes() {
  const dispatch = useDispatch();
  const mode = useSlice((p) => p?.transport.mode);
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

/**
 * The stage's line, and the bundle note beside it.
 *
 * Rendered even before there is a projection: `#status` is the stylesheet's
 * hold on this corner of the bar, and an element that comes and goes would
 * move the `grow` spacer next to it.
 */
export function Status() {
  const status = useSlice((p) => p?.status);
  return (
    <span id="status" className="dim">
      {status?.text ?? ""}
      {status?.note
        && <span className="dim" title={status.noteTitle}>{status.note}</span>}
    </span>
  );
}

export function ViewSettings() {
  const dispatch = useDispatch();
  const shooting = useSlice((p) => p?.toggles.shoot);
  const hasSaved = useSlice((p) => p?.hasSaved);
  const pillarbox = useSlice((p) => p?.pillarbox);
  const lightMode = useSlice((p) => p?.lightMode);
  const fogMode = useSlice((p) => p?.fogMode);
  const filterMode = useSlice((p) => p?.filterMode);
  const anisoLimit = useSlice((p) => p?.anisotropyLimit) ?? 1;
  // Same argument as the stage select: two controlled `<select>`s with nothing
  // to be controlled by yet.
  if (lightMode === undefined || fogMode === undefined
      || filterMode === undefined) return null;
  return (
    <>
      <button className="kill" hidden={!shooting}
              title="Kill every live actor outright -- hit points to zero and the directional death, the same thing that opens the live-enemy gate. Civilians go too, through their own killed script, because they are what wait_scripted_actors counts and a room cleared with the hostages still standing is a script that has not moved. Nothing is severed, because no bone was hit."
              onClick={() => dispatch({ kind: "killAll" })}>Kill</button>
      <button title="Snapshot the whole game state: the walker's program counter and flags, the data segment, every actor and the random seed. Nothing from three.js -- the renderers rebuild from those, which is the test that the split is in the right place. See docs/PLAYER_ARCHITECTURE.md."
              onClick={() => dispatch({ kind: "saveState" })}>Save</button>
      <button disabled={!hasSaved}
              title="Restore the last snapshot. The player becomes identical to the moment it was taken, down to the next attack the RNG draws."
              onClick={() => dispatch({ kind: "loadState" })}>Load</button>
      <label title="The game is 4:3 and its projection is a compile-time constant: 41.1 degrees vertical.">
        <input type="checkbox" checked={!!pillarbox}
               onChange={(e) => dispatch({ kind: "setPillarbox",
                                           on: e.target.checked })} />
        {" "}4:3
      </label>
      <label title="The game bakes most illumination into textures and the per-mesh base colour, so unlit is the faithful baseline. 'Scene' adds the one directional light SetLightingDefaultSingle installs, with the direction, colour and ambient the script sets.">
        Light{" "}
        <select value={lightMode}
                onChange={(e) => dispatch({ kind: "setLightMode",
                                            mode: e.target.value })}>
          {LIGHT.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      <label title={"Fog colour and range come from the script (evt 0x20-0x27)"
        + " and the blend is the D3D7 one: a straight ramp, in sRGB, over"
        + " view-space depth. That is what the game's per-pixel table fog did,"
        + " so 'as the game' fogs the screen corners less than the centre at"
        + " the same real distance. Radial uses true distance from the eye"
        + " instead, which removes that artefact and is not what the hardware"
        + " did."}>
        Fog{" "}
        <select value={fogMode}
                onChange={(e) => dispatch({ kind: "setFogMode",
                                            mode: e.target.value })}>
          {FOG.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      <label title={"Every mesh carries its own filter in its TSP word and the"
        + " exporter writes it into the glTF sampler, so 'as the game' is"
        + " per-surface nearest or bilinear -- what the hardware actually did."
        + " The rest force one filter on everything. Trilinear and anisotropic"
        + " add a mip chain the original never had: they are not more faithful,"
        + " they stop the long floors and walls shimmering at grazing angles."
        + ` Anisotropic uses this machine's maximum, ${anisoLimit}x.`}>
        Filter{" "}
        <select value={filterMode}
                onChange={(e) => dispatch({ kind: "setFilterMode",
                                            mode: e.target.value })}>
          {FILTER.map((o) => (
            <option key={o.value} value={o.value}>
              {o.value === "aniso" ? `${o.label} ${anisoLimit}x` : o.label}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
