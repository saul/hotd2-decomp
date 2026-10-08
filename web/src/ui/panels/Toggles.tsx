/**
 * The view toggles.
 *
 * The table is the panel: name, label, default, and the sentence that says
 * what the thing actually is. Those tooltips were the only documentation
 * several of these layers had, so they moved here verbatim rather than being
 * summarised — a toggle whose meaning you have to guess is a toggle nobody
 * touches.
 *
 * Each one dispatches a `toggle` command and nothing else. `app/` decides what
 * turning it on means, and `runCommand` switches on the name exhaustively, so
 * adding a row here without handling it fails to compile.
 */
import type { ToggleName } from "../commands";
import type { DebugGroupName } from "../projection";

/** What kind of switch a toggle is. See {@link ToggleSpec.kind}. */
export type ToggleKind = "game" | "debug" | "aid";

export interface ToggleSpec {
  name: ToggleName;
  label: string;
  /** The state the player starts in. */
  on: boolean;
  title: string;
  /**
   * **Is this the game, or is it a thing drawn over the game?**
   *
   * The two were indistinguishable in a column of identical checkboxes, and
   * they are not the same kind of switch at all: turning `sky` off hides
   * scenery the game draws, and turning `boxes` on adds wireframe the game
   * never had. Somebody reading the list could not tell which of the sixteen
   * would change what they were looking *at* and which would change what they
   * were looking *through*.
   *
   * `game` — the game itself draws it, and off is an inspection convenience.
   * `debug` — drawing this player invented, over the top. None of it changes
   * what the game does, so none of it is in a snapshot. **Every one starts
   * off**: the page is the game, and an overlay is something you turn on to
   * look at a question. The rails and the spawn markers used to start on,
   * which put a camera line and a label over every stage anybody opened.
   * `aid` — a debug aid that makes the player **behave** unlike the game so
   * that something can be looked at. It is not drawing, so it is not `debug`,
   * and the game has no such switch, so it is not `game`: off is the engine,
   * and every one of these is off by default.
   */
  kind: ToggleKind;
  /**
   * Which sidebar panel draws this control.
   *
   * The table stays the one owner of what a toggle *is* — its name, its
   * default and the sentence that says what it does — and this only routes the
   * control to the panel that shows what it affects. A second table for the
   * sidebar's toggles would be a second place to add a row and a second place
   * to forget to, and `applyToggle`'s exhaustiveness over `ToggleName` would
   * not notice either.
   *
   * **Required.** It was optional, and undefined meant the top bar — a route
   * that existed for one switch, `shoot`, which is gone. An optional field
   * with no members left is a second place a row can go and a second place to
   * forget it went there.
   */
  group: DebugGroupName;
  /**
   * The key that flips it, as a `KeyboardEvent.code`, when it has one.
   *
   * Here and not in a key map of its own, for the reason `group` is: the table
   * is the one owner of what a toggle is, and a second table of keys would be
   * a second place to add a row. `ui/App.tsx` dispatches from it, the `?`
   * dialog lists it, and the switch shows it beside its label. Only overlays
   * have keys -- the things you turn on to look at a question and off again
   * -- and `test:ui` holds every key to being free of the game's, free
   * roam's and the rest of the page's.
   */
  key?: string;
}

export const TOGGLES: readonly ToggleSpec[] = [
  { name: "allRegions", kind: "debug", label: "All regions", on: false, group: "scene", key: "KeyG",
    title: "Draw every region at once. Consecutive regions overlap heavily, so this is how the interpenetration becomes legible as a deliberate mechanism rather than an export bug." },
  { name: "netStats", kind: "debug", label: "Netplay stats", on: false, group: "net", key: "KeyI",
    title: "Two-player netplay, measured: the round trip and packet loss each way, how long since the last packet arrived, the jitter buffer, how far behind the host this end is, what a tick costs, and every tick's state hash checked against the host's -- with a log of each desync, which part of the state it was in, and the keyframe that repaired it. The small badge over the game stays up whenever a session is; this is the whole of it." },
  { name: "fps", kind: "debug", label: "FPS counter", on: false, group: "scene", key: "KeyK",
    title: "A small badge beside the menu: frames per second, and the time between frames over the last second -- lowest, mean, highest -- with the page's own work per frame (mean and worst), and in a two-player session what a netplay tick costs. Cheap enough to leave on; the perf meter is the whole breakdown. `?fps=1` in the address turns it on." },
  { name: "perf", kind: "debug", label: "Perf meter", on: false, group: "scene", key: "KeyO",
    title: "Frame rate and where each frame's time goes, over the game: the script, the game systems, the render systems and the HUD (the costliest systems named), the matrix walk, the WebGL submission, the UI publish -- and a sampled wait for the GPU. Low fps with little of either is the browser's compositor, not the page. `?perf=1` in the address turns it on; `aa=0`, `shadows=0`, `blur=0` are A/B switches, and `gpu=1` samples the GPU. A dev server writes what it measures to extract/perf.jsonl." },
  { name: "rails", kind: "debug", label: "Rails", on: false, group: "camera", key: "KeyV",
    title: "Camera eye rails, one polyline per cam/ path." },
  { name: "aimRails", kind: "debug", label: "Look-at", on: false, group: "camera", key: "KeyL",
    title: "The look-at track: where each camera path is aimed, as opposed to where it sits." },
  { name: "sky", kind: "game", label: "Sky", on: true, group: "scene",
    title: "The camera-following backdrop dome the script selects with evt 0x1B/0x1C." },
  { name: "hud", kind: "game", label: "HUD", on: true, group: "scene",
    title: "The screen-space layer: the letterbox shutter (evt 0x1F) and the dialogue subtitles (evt 0x2D)." },
  { name: "rigs", kind: "game", label: "Rigs", on: true, group: "props",
    title: "Objects that ride op_ object paths \u2014 vehicles and props, assembled from transcribed draw routines. They appear only while the camera is on a path that selects them." },
  { name: "spawns", kind: "debug", label: "Spawns", on: false, group: "actors", key: "KeyN",
    title: "A marker and a label at every spawn the script has placed, so a spawn whose class the port cannot pose yet is still visible as something the game put there. The characters themselves are Characters; this is what stands in for the ones that have no pose." },
  { name: "chars", kind: "game", label: "Characters", on: true, group: "actors",
    title: "Spawned characters assembled from the EXE skeleton and posed from mot/. A spawn whose class has no motion rule yet keeps its marker instead \u2014 an unposed character is a heap of parts, not a character." },
  { name: "breakables", kind: "game", label: "Breakables", on: true, group: "props",
    title: "The class-0x41 breakable props \u2014 the barrels and boxes the game hides its items in. Built at run time by PlaceBreakableGroup from the exe's own member records, two shots each, and a stack collapses when what it stands on is destroyed." },
  { name: "unported", kind: "debug", label: "Unported", on: false, group: "actors", key: "KeyU",
    title: "Empty boxes wherever the script has spawned an actor whose class has no module in the port's g_class_handlers. The game would be running a state machine for it; this player is not. docs/formats/spawns.md says what each class is." },
  { name: "coli", kind: "debug", label: "Collision", on: false, group: "collision", key: "KeyC",
    title: "The game's own coli/ collision, as the port traces it: amber for the blobs the script has selected into the sphere-and-segment set, blue for the ray-only ones, with a spike on each quad's normal so the one-sided winding is visible. A quad in neither set is not tested by anything and is not drawn." },
  { name: "stuck", kind: "debug", label: "Wedged", on: false, group: "collision", key: "KeyX",
    title: "Which enemies are wedged. ZombiePushOutOfWorldAndActors traces every zombie's body sphere against the selected collision each frame and shoves it back out; one frame of that is normal, half a second of it is an actor that cannot get where its state is taking it. Marks those in red at the sphere the push actually tests. Counts only the world half, not the shoulder-past-another-zombie half." },
  { name: "boxes", kind: "debug", label: "Boxes", on: false, group: "actors", key: "KeyB",
    title: "Bounding boxes on the actor holding an attack permit \u2014 the one about to swing, and the one SelectCameraLookAtTarget is aiming at \u2014 and, while wait_enemies_alive is blocking, on every enemy keeping it blocked." },
  // `trackEnemies` was here. It switched off the gameplay camera --
  // `SelectCameraLookAtTarget` aiming at the permit holder -- which is the game
  // and not a view of it, so it is always on now and is not a switch.
  { name: "muzzle", kind: "game", label: "Muzzle flash", on: true, group: "shooting",
    title: "The nine-frame flash and its second draw, at the crosshair on every shot \u2014 PlayerShotEffectSpawn's first ring. The game draws it, so it is on. It sits under the aim point because the cabinet's gun needed something bright there, and with a mouse it can cover what you are shooting, which is why it is a switch. The port spawns the records either way; this only decides whether they are drawn." },
  { name: "redBlood", kind: "game", label: "Red blood", on: true, group: "shooting",
    title: "The game's own Blood Color option. tex/scr_blood_red.bin and tex/scr_blood_green.bin are the same 39 images at the same texture slots, and the game loads one bank over the other; the bundle carries the green one, so this swaps the red and green channels on every material that draws blood \u2014 the spray, the gore parts a zombie swaps in, and the decals." },
  { name: "branchPause", kind: "aid", label: "Pause at branches", on: false, group: "route",
    title: "Debug aid, off by default. The game has no pause at a route branch: EvtAdvanceStepOrRoute reads g_script_branch_var \u2014 which only gameplay writes, a rescue or a shot prop \u2014 and goes to that route on the same frame. On, the script holds at every branch for 1.5 seconds and the branch bar offers the other routes; nobody answering takes the game's own. Taking another route by hand can leave the world in a state the game cannot reach." },
];

/** The defaults, as a record — what `app/` initialises its state from. */
export const TOGGLE_DEFAULTS: Readonly<Record<ToggleName, boolean>> =
  Object.fromEntries(TOGGLES.map((t) => [t.name, t.on])) as
    Record<ToggleName, boolean>;

// Every toggle names a debug-sidebar panel, and `ui/panels/DebugGroup.tsx`
// draws them all -- in two labelled halves, the game and the overlays over it.
