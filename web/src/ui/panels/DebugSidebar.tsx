/**
 * The debug sidebar: everything that is about *inspecting* the game.
 *
 * Closed by default, because the page is the game first. Opened from the
 * breadcrumb menu or with the backquote key, it sits to the right of the view
 * on a wide screen -- the game shrinks rather than being covered, since the
 * point of opening it is to watch the two together -- and over the view as a
 * drawer on a narrow one.
 *
 * Three parts, top to bottom:
 *
 * * **The controls**, always on screen while it is open: Play or free roam,
 *   pause, skip, kill. What is left of the transport bar once the stepping,
 *   the speed and the scrubber went.
 * * **Tabs**: the inspection panels, the script, and the event feed. The
 *   script was a column of its own and the feed a panel squeezed under
 *   thirteen others; each is tall and wants the height, and a tab that is not
 *   showing renders nothing -- so a stage being *played* costs none of the
 *   script's thousands of rows.
 * * **The panels**, each owning its fold and declaring its own cost. A folded
 *   panel is not rendered, so `wants(slice)` and "is this mounted" are one
 *   fact. Every string in their bodies was assembled in
 *   `app/projection/sidebar.ts`, which is the only place that knows what an
 *   actor is.
 *
 * The route graph, the scope tree, the globals, the inspector and the rigs
 * list went with the move, and so did the three projection slices only they
 * read: nothing is built for a panel that no longer exists.
 */
import { memo } from "react";
import type { DebugLine } from "../projection";
import { usePersisted } from "../persist";
import { useDispatch } from "../store_context";
import { useSlice } from "../useSlice";
import { Feed } from "./Feed";
import { HudStrip } from "./HudStrip";
import { Panel } from "./Panel";
import { DebugGroup } from "./DebugGroup";
import { Tree } from "./Tree";

type Tab = "inspect" | "script" | "feed";

const TABS: { tab: Tab; label: string; title: string }[] = [
  { tab: "inspect", label: "Inspect",
    title: "The player, the wait, the camera, the scene, the actors and the rest" },
  { tab: "script", label: "Script",
    title: "The stage's event script. Click an instruction to seek to it" },
  { tab: "feed", label: "Feed",
    title: "Every instruction the script ran, and every shot, in order" },
];

export function DebugSidebar({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = usePersisted<Tab>("debugTab", "inspect");
  return (
    <>
      <header className="dbg-head">
        <strong>Debug</strong>
        <Status />
        <button className="icon-btn" aria-label="Close the debug sidebar"
                title="Close (`)" onClick={onClose}>✕</button>
      </header>
      <Controls />
      <div className="tabs" role="tablist" aria-label="Debug views">
        {TABS.map((t) => (
          <button key={t.tab} role="tab" aria-selected={tab === t.tab}
                  data-tab={t.tab}
                  className={tab === t.tab ? "active" : undefined}
                  title={t.title} onClick={() => setTab(t.tab)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "inspect" && <Inspect />}
      {tab === "script" && <Tree />}
      {tab === "feed" && <div className="tab-body"><Feed /></div>}
    </>
  );
}

/**
 * The stage's line, and the bundle note beside it.
 *
 * It was the right-hand end of the top bar. A model and triangle count is a
 * debugging fact, and so is the bundle's age -- a re-export changes the data
 * under a page that looks identical, and a stale bundle is indistinguishable
 * from a bug.
 */
function Status() {
  const status = useSlice((p) => p?.status);
  return (
    <span id="status" className="dim">
      {status?.text ?? ""}
      {status?.note
        && <span className="dim" title={status.noteTitle}>{status.note}</span>}
    </span>
  );
}

const MODES: { mode: "play" | "free"; label: string; key: string }[] = [
  { mode: "play", label: "Play", key: "1" },
  { mode: "free", label: "Free roam", key: "2" },
];

/**
 * Play or fly, run or hold, skip, clear.
 *
 * `#cam-label` is the camera path and its frame: the one number on the page
 * that moves once per game frame, which is how `tools/pacing.mjs` tells a
 * tick from a frame that was only drawn.
 */
function Controls() {
  const dispatch = useDispatch();
  const t = useSlice((p) => p?.transport);
  const skip = useSlice((p) => p?.skip);
  if (!t) return null;
  const running = t.playing && t.mode === "play";
  return (
    <section id="controls" className="dbg-controls">
      <div className="seg" id="modes" role="group" aria-label="Mode">
        {MODES.map((m) => (
          <button key={m.mode}
                  className={`mode${t.mode === m.mode ? " active" : ""}`}
                  aria-pressed={t.mode === m.mode}
                  title={`${m.label} (${m.key})`}
                  onClick={() => dispatch({ kind: "setMode", mode: m.mode })}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="ctl-row">
        <button id="play-pause" title="Play / pause (Space)"
                onClick={() => dispatch({ kind: running ? "pause" : "play" })}>
          {running ? "❚❚ Pause" : "▶ Play"}
        </button>
        {/* Enabled under the game's own condition: `Walker.canSkip` is the
            region *and* the shutter's firing gate being down, the exact pair
            both player-update routines test before looking at Start. */}
        <button id="skip-go" disabled={!skip?.canSkip}
                title={skip ? `Skip (Enter) — ${skip.sub}`
                            : "Skip (Enter) — only inside a skippable region"}
                onClick={() => dispatch({ kind: "requestSkip" })}>
          ⏭ Skip
        </button>
        <button className="kill"
                title="Kill every live actor outright -- hit points to zero and the directional death, the same thing that opens the live-enemy gate. Civilians go too, through their own killed script, because they are what wait_scripted_actors counts and a room cleared with the hostages still standing is a script that has not moved. Nothing is severed, because no bone was hit."
                onClick={() => dispatch({ kind: "killAll" })}>
          ✕ Kill all
        </button>
      </div>
      <div id="cam-label" className="dim mono">{t.camLabel}</div>
    </section>
  );
}

function Inspect() {
  return (
    <div className="tab-body scroll" id="inspect">
      {/* The strip folds like everything else. It is the tallest thing in the
          column and it is not always what you are looking at. */}
      <Panel id="panel-hud" title="Player" defaultOpen>
        <div id="hud" className="kv"><HudStrip /></div>
      </Panel>

      <WaitPanel />

      <Panel id="panel-camera" title="Camera"
             subTitle={"Where the shot is and where it is aimed. `Rails` and "
               + "`Look-at` draw the authored cam/ curves. The gameplay "
               + "camera -- aiming at whichever actor holds an attack permit "
               + "and easing onto it -- is the game's, and always on."}>
        <DebugGroup group="camera" />
      </Panel>

      <Panel id="panel-scene" title="Scene"
             subTitle={"The stage itself: which regions are drawn, the "
               + "backdrop, the weather, the fog and light ramps the script "
               + "sets, and how the textures are filtered."}>
        <ViewSettings />
        <DebugGroup group="scene" />
      </Panel>

      <ActorsPanel />

      <Panel id="panel-props" title="Props"
             subTitle={"Scripted scenery, the class-0x41 breakables, and the "
               + "rigs that ride op_ paths."}>
        <DebugGroup group="props" />
      </Panel>

      <Panel id="panel-collision" title="Collision"
             subTitle={"The game's own coli/ world as the port traces it, and "
               + "which enemies are wedged against it."}>
        <DebugGroup group="collision" />
      </Panel>

      <Panel id="panel-shooting" title="Shooting"
             subTitle={"Click or tap to shoot: the ray, the per-bone hit "
               + "spheres, the damage escalation and the score, all the "
               + "game's own."}>
        <DebugGroup group="shooting" />
      </Panel>

      <Panel id="panel-sound" title="Sound" defaultOpen
             subTitle={"How loud the game is. The speaker that turns it on "
               + "and off is in the corner of the game, because that is the "
               + "one you press; this is the one you set once."}>
        <SoundPanel />
      </Panel>
    </div>
  );
}

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

/**
 * Light, fog and texture filtering: the player's own choices about how the
 * scene is drawn. The game has none of them, and the tooltips are the only
 * place that says what "as the game" means for each.
 */
function ViewSettings() {
  const dispatch = useDispatch();
  const lightMode = useSlice((p) => p?.lightMode);
  const fogMode = useSlice((p) => p?.fogMode);
  const filterMode = useSlice((p) => p?.filterMode);
  const anisoLimit = useSlice((p) => p?.anisotropyLimit) ?? 1;
  // Controlled selects with nothing to be controlled by yet would be
  // uncontrolled for one commit and controlled for the next.
  if (lightMode === undefined || fogMode === undefined
      || filterMode === undefined) return null;
  return (
    <div className="view-settings" id="view-settings">
      <label title="The game bakes most illumination into textures and the per-mesh base colour, so unlit is the faithful baseline. 'Scene' adds the one directional light SetLightingDefaultSingle installs, with the direction, colour and ambient the script sets.">
        <span>Light</span>
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
        <span>Fog</span>
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
        <span>Filter</span>
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
    </div>
  );
}

/**
 * The volume, and what the music is doing.
 *
 * `#bgm-label` is the audio status line -- which track, and whether the
 * browser is still holding it -- and its `blocked` class is the one audio
 * state that needs a press to clear.
 */
function SoundPanel() {
  const dispatch = useDispatch();
  const sound = useSlice((p) => p?.sound);
  if (!sound) return null;
  return (
    <div className="dbg">
      <label className="volume">
        Volume{" "}
        <input type="range" id="volume" min="0" max="100" step="1"
               value={sound.volume}
               title="BGM volume"
               onChange={(e) => dispatch({ kind: "setVolume",
                                           volume: Number(e.target.value) })} />
        {" "}<span className="dim">{sound.volume}%</span>
      </label>
      <div id="bgm-label"
           className={`dim${sound.blocked && !sound.muted ? " blocked" : ""}`}>
        {sound.muted ? "muted · " : ""}{sound.label}
      </div>
    </div>
  );
}

/**
 * The wait panel, which is the one with a control in its header.
 *
 * `sub` is the wait's own name and `box` is a command, so this component reads
 * two fields and re-renders when either moves. The body reads a third for
 * itself, which is why the panel does not have to hand it down.
 */
function WaitPanel() {
  const dispatch = useDispatch();
  const sub = useSlice((p) => p?.wait?.sub ?? "running");
  const boxed = useSlice((p) => p?.waitBoxed);
  return (
    <Panel id="panel-wait" title="Wait" slice="wait" defaultOpen sub={sub}
           head={
             <label className="hl"
                    title="Box every actor keeping this wait blocked.">
               <input type="checkbox" checked={!!boxed}
                      onChange={(e) => dispatch({ kind: "boxWait",
                                                  on: e.target.checked })} />
               {" box"}
             </label>
           }>
      <div className="dbg"><WaitBody /></div>
    </Panel>
  );
}

function ActorsPanel() {
  const sub = useSlice((p) => p?.actorPanel?.sub ?? "");
  return (
    <Panel id="panel-actors" title="Actors" slice="actors" sub={sub}
           subTitle={"Every object in g_object_list, grouped by spawn class. "
             + "Each class describes its own actors — a class with a module "
             + "in g_class_handlers explains itself, one without is listed "
             + "by id and left alone. docs/formats/spawns.md is the class "
             + "table."}>
      {/* The actors group's switches and readouts belong *in* the actors
          panel rather than beside it: `boxes` boxes the actor the list is
          telling you about, and `enemies` counts what it is listing. */}
      <DebugGroup group="actors" />
      <div className="dbg"><ActorBody /></div>
    </Panel>
  );
}

/**
 * Memoised, and this is where memoisation still pays.
 *
 * It is handed a `lines` array built by its parent, and `stabilise` shares at
 * every depth -- so a group whose lines did not move gets the array it had
 * last frame and this bails, while the sibling group that did move
 * re-renders.
 */
const Lines = memo(function Lines({ lines }: { lines: readonly DebugLine[] }) {
  return (
    <>
      {lines.map((l, i) => (
        <div key={i}
             className={l.note ? "dbg-note"
               : `dbg-row${l.hot ? " hot" : ""}${l.dead ? " dead" : ""}`}>
          {l.text}
        </div>
      ))}
    </>
  );
});

// No `memo` on either body below: each subscribes to its own slice, so it
// re-renders when that slice moves and at no other time.
function WaitBody() {
  const wait = useSlice((p) => p?.wait);
  if (!wait) return null;
  return <Lines lines={wait.lines} />;
}

function ActorBody() {
  const dispatch = useDispatch();
  const actors = useSlice((p) => p?.actorPanel);
  if (!actors) return null;
  if (!actors.groups.length) {
    return <div className="dbg-note">The object pool is empty.</div>;
  }
  return (
    <>
      {actors.groups.map((g) => (
        <div key={g.cls}>
          <div className="dbg-group">
            <span className="dbg-caret"
                  onClick={() => dispatch({ kind: "foldClass", cls: g.cls,
                                            shut: g.open })}>
              {g.open ? "▾" : "▸"}
            </span>
            <span className="dbg-gname"
                  onClick={() => dispatch({ kind: "foldClass", cls: g.cls,
                                            shut: g.open })}>
              {g.name} · {g.count}{g.ported ? "" : " · no module"}
            </span>
            <span className="dbg-box"
                  title="Draw a box round every actor of this class."
                  onClick={() => dispatch({ kind: "boxClass", cls: g.cls,
                                            on: !g.boxed })}>
              {g.boxed ? "▣ box" : "▢ box"}
            </span>
          </div>
          <Lines lines={g.lines} />
        </div>
      ))}
    </>
  );
}
