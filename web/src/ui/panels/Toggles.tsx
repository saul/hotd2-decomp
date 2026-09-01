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
import type { Dispatch, ToggleName } from "../commands";

export interface ToggleSpec {
  name: ToggleName;
  label: string;
  /** The state the player starts in. */
  on: boolean;
  title: string;
}

export const TOGGLES: readonly ToggleSpec[] = [
  { name: "allRegions", label: "All regions", on: false,
    title: "Draw every region at once. Consecutive regions overlap heavily, so this is how the interpenetration becomes legible as a deliberate mechanism rather than an export bug." },
  { name: "rails", label: "Rails", on: true,
    title: "Camera eye rails, one polyline per cam/ path." },
  { name: "aimRails", label: "Look-at", on: false,
    title: "The look-at track: where each camera path is aimed, as opposed to where it sits." },
  { name: "sky", label: "Sky", on: true,
    title: "The camera-following backdrop dome the script selects with evt 0x1B/0x1C." },
  { name: "hud", label: "HUD", on: true,
    title: "The screen-space layer: the letterbox shutter (evt 0x1F) and the dialogue subtitles (evt 0x2D)." },
  { name: "rigs", label: "Rigs", on: true,
    title: "Objects that ride op_ object paths \u2014 vehicles and props, assembled from transcribed draw routines. They appear only while the camera is on a path that selects them." },
  { name: "spawns", label: "Spawns", on: true,
    title: "" },
  { name: "chars", label: "Characters", on: true,
    title: "Spawned characters assembled from the EXE skeleton and posed from mot/. A spawn whose class has no motion rule yet keeps its marker instead \u2014 an unposed character is a heap of parts, not a character." },
  { name: "props", label: "Props", on: true,
    title: "Scripted scenery: doors, shutters and the vans they hang off. They swing when the script sets their flag (evt 0x48) and vanish on a second one. Also draws a bounding box and an origin cross on every prop the bundle names \u2014 green drawn, amber hidden, magenta no geometry, red no glTF node \u2014 so a prop that is not on screen can be told from one that was never exported." },
  { name: "breakables", label: "Breakables", on: true,
    title: "The class-0x41 breakable props \u2014 the barrels and boxes the game hides its items in. Built at run time by PlaceBreakableGroup from the exe's own member records, two shots each, and a stack collapses when what it stands on is destroyed." },
  { name: "unported", label: "Unported", on: false,
    title: "Empty boxes wherever the script has spawned an actor whose class has no module in the port's g_class_handlers. The game would be running a state machine for it; this player is not. docs/formats/spawns.md says what each class is." },
  { name: "coli", label: "Collision", on: false,
    title: "The game's own coli/ collision, as the port traces it: amber for the blobs the script has selected into the sphere-and-segment set, blue for the ray-only ones, with a spike on each quad's normal so the one-sided winding is visible. A quad in neither set is not tested by anything and is not drawn." },
  { name: "stuck", label: "Wedged", on: false,
    title: "Which enemies are wedged. ZombiePushOutOfWorldAndActors traces every zombie's body sphere against the selected collision each frame and shoves it back out; one frame of that is normal, half a second of it is an actor that cannot get where its state is taking it. Marks those in red at the sphere the push actually tests. Counts only the world half, not the shoulder-past-another-zombie half." },
  { name: "boxes", label: "Boxes", on: false,
    title: "Bounding boxes on the actor holding an attack permit \u2014 the one about to swing, and the one SelectCameraLookAtTarget is aiming at \u2014 and, while wait_enemies_alive is blocking, on every enemy keeping it blocked." },
  { name: "trackEnemies", label: "Track", on: true,
    title: "The gameplay camera. With enemies registered, SelectCameraLookAtTarget aims at the one holding an attack permit -- the one about to swing -- or the midpoint of two, and TurnLookAtToward eases the camera onto it. Off restores the authored cam/ path exactly." },
  { name: "shoot", label: "Shoot", on: false,
    title: "Click to shoot. Ray from the camera through the crosshair, tested against each character's per-bone hit spheres; hit points, the per-bone damage escalation, the sever step, the sounds and the score are the game's own. With this on, the live-enemy waits become real: the script holds until you have killed them. See docs/formats/combat.md." },
];

/** The defaults, as a record — what `app/` initialises its state from. */
export const TOGGLE_DEFAULTS: Readonly<Record<ToggleName, boolean>> =
  Object.fromEntries(TOGGLES.map((t) => [t.name, t.on])) as
    Record<ToggleName, boolean>;

export function Toggles(
  { state, dispatch }: {
    state: Readonly<Record<ToggleName, boolean>>;
    dispatch: Dispatch;
  },
) {
  return (
    <>
      {TOGGLES.map((t) => (
        <label key={t.name} title={t.title}>
          <input type="checkbox" checked={state[t.name]}
                 onChange={(e) => dispatch({ kind: "toggle", name: t.name,
                                             on: e.target.checked })} />
          {" "}{t.label}
        </label>
      ))}
    </>
  );
}
