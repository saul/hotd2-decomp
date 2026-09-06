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
   * what the game does, so none of it is in a snapshot.
   */
  kind: "game" | "debug";
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
}

export const TOGGLES: readonly ToggleSpec[] = [
  { name: "allRegions", kind: "debug", label: "All regions", on: false, group: "scene",
    title: "Draw every region at once. Consecutive regions overlap heavily, so this is how the interpenetration becomes legible as a deliberate mechanism rather than an export bug." },
  { name: "rails", kind: "debug", label: "Rails", on: true, group: "camera",
    title: "Camera eye rails, one polyline per cam/ path." },
  { name: "aimRails", kind: "debug", label: "Look-at", on: false, group: "camera",
    title: "The look-at track: where each camera path is aimed, as opposed to where it sits." },
  { name: "sky", kind: "game", label: "Sky", on: true, group: "scene",
    title: "The camera-following backdrop dome the script selects with evt 0x1B/0x1C." },
  { name: "hud", kind: "game", label: "HUD", on: true, group: "scene",
    title: "The screen-space layer: the letterbox shutter (evt 0x1F) and the dialogue subtitles (evt 0x2D)." },
  { name: "rigs", kind: "game", label: "Rigs", on: true, group: "props",
    title: "Objects that ride op_ object paths \u2014 vehicles and props, assembled from transcribed draw routines. They appear only while the camera is on a path that selects them." },
  { name: "spawns", kind: "debug", label: "Spawns", on: true, group: "actors",
    title: "A marker and a label at every spawn the script has placed, so a spawn whose class the port cannot pose yet is still visible as something the game put there. The characters themselves are Characters; this is what stands in for the ones that have no pose." },
  { name: "chars", kind: "game", label: "Characters", on: true, group: "actors",
    title: "Spawned characters assembled from the EXE skeleton and posed from mot/. A spawn whose class has no motion rule yet keeps its marker instead \u2014 an unposed character is a heap of parts, not a character." },
  { name: "props", kind: "game", label: "Props", on: true, group: "props",
    title: "Scripted scenery: doors, shutters and the vans they hang off. They swing when the script sets their flag (evt 0x48) and vanish on a second one. The overlay that says which of those four states each one is in is its own switch, Prop boxes." },
  { name: "propBoxes", kind: "debug", label: "Prop boxes", on: false, group: "props",
    title: "The prop overlay: a bounding box, an origin cross and a state label on every prop the bundle names \u2014 green drawn, amber hidden, magenta no geometry, red no glTF node \u2014 so a prop that is not on screen can be told from one that was never exported. Separate from Props, which draws the props themselves: a debug overlay is never what somebody wants to look at the scene through." },
  { name: "breakables", kind: "game", label: "Breakables", on: true, group: "props",
    title: "The class-0x41 breakable props \u2014 the barrels and boxes the game hides its items in. Built at run time by PlaceBreakableGroup from the exe's own member records, two shots each, and a stack collapses when what it stands on is destroyed." },
  { name: "unported", kind: "debug", label: "Unported", on: false, group: "actors",
    title: "Empty boxes wherever the script has spawned an actor whose class has no module in the port's g_class_handlers. The game would be running a state machine for it; this player is not. docs/formats/spawns.md says what each class is." },
  { name: "coli", kind: "debug", label: "Collision", on: false, group: "collision",
    title: "The game's own coli/ collision, as the port traces it: amber for the blobs the script has selected into the sphere-and-segment set, blue for the ray-only ones, with a spike on each quad's normal so the one-sided winding is visible. A quad in neither set is not tested by anything and is not drawn." },
  { name: "stuck", kind: "debug", label: "Wedged", on: false, group: "collision",
    title: "Which enemies are wedged. ZombiePushOutOfWorldAndActors traces every zombie's body sphere against the selected collision each frame and shoves it back out; one frame of that is normal, half a second of it is an actor that cannot get where its state is taking it. Marks those in red at the sphere the push actually tests. Counts only the world half, not the shoulder-past-another-zombie half." },
  { name: "boxes", kind: "debug", label: "Boxes", on: false, group: "actors",
    title: "Bounding boxes on the actor holding an attack permit \u2014 the one about to swing, and the one SelectCameraLookAtTarget is aiming at \u2014 and, while wait_enemies_alive is blocking, on every enemy keeping it blocked." },
  { name: "trackEnemies", kind: "game", label: "Track", on: true, group: "camera",
    title: "The gameplay camera. With enemies registered, SelectCameraLookAtTarget aims at the one holding an attack permit -- the one about to swing -- or the midpoint of two, and TurnLookAtToward eases the camera onto it. Off restores the authored cam/ path exactly." },
  { name: "muzzle", kind: "game", label: "Muzzle flash", on: false, group: "shooting",
    title: "The nine-frame flash and its second draw, at the crosshair on every shot \u2014 PlayerShotEffectSpawn's first ring. Off by default: it sits under the aim point because the cabinet's gun needed something bright there, and with a mouse it mostly covers what you are shooting. The port spawns the records either way; this only decides whether they are drawn." },
  { name: "redBlood", kind: "game", label: "Red blood", on: true, group: "shooting",
    title: "The game's own Blood Color option. tex/scr_blood_red.bin and tex/scr_blood_green.bin are the same 39 images at the same texture slots, and the game loads one bank over the other; the bundle carries the green one, so this swaps the red and green channels on every material that draws blood \u2014 the spray, the gore parts a zombie swaps in, and the decals." },
];

/** The defaults, as a record — what `app/` initialises its state from. */
export const TOGGLE_DEFAULTS: Readonly<Record<ToggleName, boolean>> =
  Object.fromEntries(TOGGLES.map((t) => [t.name, t.on])) as
    Record<ToggleName, boolean>;

// The component that drew the top bar's ungrouped switches was here. Every
// toggle names a sidebar panel now, and `ui/panels/DebugGroup.tsx` draws them
// all -- in two labelled halves, the game and the overlays over it.
