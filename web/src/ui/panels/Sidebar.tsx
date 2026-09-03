/**
 * The right-hand column: seven panels, each paying for itself.
 *
 * Every panel here owns its own fold and declares its own cost. Nothing in
 * `app/` asks the document what is showing, and a panel that is folded is not
 * rendered — so `wants(slice)` and "is this component mounted" are the same
 * fact rather than two that have to be kept in step.
 *
 * `Sidebar` itself subscribes to **nothing**. It is the composition and the
 * order, and it renders once; each panel below subscribes to the field it
 * shows. That is what makes an open globals panel — which rebuilds every frame
 * — cost one component's render rather than the whole column's.
 *
 * The two bodies at the bottom are pure rendering. Every string in them was
 * assembled in `app/projection/sidebar.ts`, which is the only place that knows
 * what an actor is — a panel that read `G.g_object_list` itself would be a
 * second reader of engine state with its own idea of when to look, and that is
 * how a sidebar comes to disagree with the boxes drawn round the actors it
 * lists.
 */
import { memo } from "react";
import type { DebugLine } from "../projection";
import { useDispatch } from "../store_context";
import { useSlice } from "../useSlice";
import { Feed } from "./Feed";
import { Globals } from "./Globals";
import { HudStrip } from "./HudStrip";
import { Minimap } from "./Minimap";
import { Panel } from "./Panel";
import { DebugGroup } from "./DebugGroup";
import { Rigs, RigsSub } from "./Rigs";
import { Scopes } from "./Scopes";

export function Sidebar() {
  return (
    <>
      {/* The strip folds like everything else. It is the tallest thing in
          the column and it is not always what you are looking at, and the
          panels below it have nowhere to go while it is open — `panel-feed`
          has `flex: 1` and was being squeezed to zero height, summary
          included, whenever the strip grew. */}
      <Panel id="panel-hud" title="Player" defaultOpen>
        <div id="hud" className="scroll"><HudStrip /></div>
      </Panel>

      <WaitPanel />

      <Panel id="panel-camera" title="Camera"
             subTitle={"Where the shot is and where it is aimed. `Rails` and "
               + "`Look-at` draw the authored cam/ curves; `Track` is the "
               + "gameplay camera, which aims at whichever actor holds an "
               + "attack permit and eases onto it."}>
        <DebugGroup group="camera" />
      </Panel>

      <Panel id="panel-scene" title="Scene"
             subTitle={"The stage itself: which regions are drawn, the "
               + "backdrop, the weather, and the fog and light ramps the "
               + "script sets."}>
        <DebugGroup group="scene" />
      </Panel>

      <ActorsPanel />

      <Panel id="panel-props" title="Props"
             subTitle={"Scripted scenery, the class-0x41 breakables, and the "
               + "rigs that ride op_ paths."}>
        <DebugGroup group="props" />
      </Panel>

      <Panel id="panel-rigs" title="Rigs" slice="rigs" sub={<RigsSub />}
             subTitle={"Everything that rides an `op_` path — vehicles, "
               + "shutters and props assembled from transcribed draw "
               + "routines. One row per rig: exactly one of its routes is "
               + "drawn at a time. `box` outlines it in the scene, and does "
               + "so whether or not it is currently drawn, so a rig that is "
               + "missing when you expected it can still be located."}>
        <div className="scroll dbg"><Rigs /></div>
      </Panel>

      <Panel id="panel-collision" title="Collision"
             subTitle={"The game's own coli/ world as the port traces it, and "
               + "which enemies are wedged against it."}>
        <DebugGroup group="collision" />
      </Panel>

      <Panel id="panel-shooting" title="Shooting"
             subTitle={"Click to shoot: the ray, the per-bone hit spheres, "
               + "the damage escalation and the score, all the game's own."}>
        <DebugGroup group="shooting" />
      </Panel>

      <Panel id="panel-route" title="Route graph">
        <Minimap />
      </Panel>

      <Panel id="panel-feed" title="Event feed" defaultOpen grow>
        <Feed />
      </Panel>

      <Panel id="inspector-panel" title="Inspector">
        <Inspector />
      </Panel>

      <Panel id="scope-panel" title="Scopes" slice="scopes" sub="lifetimes"
             subTitle={"The disposal tree. Every scope shows the frame it was "
               + "opened at: a child of `stage` whose frame predates the "
               + "current stage load survived a teardown, and nothing else in "
               + "the player can tell you that. Repeated names collapse into a "
               + "tallied row, so a hundred leaked effect scopes is one line "
               + "rather than a hundred."}>
        <div id="scopes" className="scroll"><Scopes /></div>
      </Panel>

      <Panel id="globals-panel" title="Globals" slice="globals"
             sub="read-only · g_*"
             subTitle={"The port's data segment — every g_* it touches, and "
               + "the object pool. Read-only: a writable panel would be a "
               + "fourth way for state to enter the game, and nothing done "
               + "here would survive a save. Addresses are the ones cited in "
               + "web/src/game/globals.ts, checked against "
               + "ghidra/annotations/globals.tsv."}>
        <div id="globals" className="scroll"><Globals /></div>
      </Panel>
    </>
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
      <div className="scroll dbg"><WaitBody /></div>
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
      <div className="scroll dbg"><ActorBody /></div>
    </Panel>
  );
}

function Inspector() {
  const body = useSlice((p) => p?.inspector);
  return <div id="inspector" className="scroll">{body}</div>;
}

/**
 * Memoised, and this is where memoisation still pays.
 *
 * It is handed a `lines` array built by its parent, and `stabilise` shares at
 * every depth since step 23 — so a group whose lines did not move gets the
 * array it had last frame and this bails, while the sibling group that did
 * move re-renders. That is the case `memo` was always meant to cover and could
 * not, back when every slice was a fresh object.
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

// No `memo` on either body below, and that is the point of the step rather
// than an omission: each subscribes to its own slice, so it re-renders when
// that slice moves and at no other time. Its parent re-renders on exactly the
// frames its own slice moved too, so a shallow prop compare would have nothing
// left to save.
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
