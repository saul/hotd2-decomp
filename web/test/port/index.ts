/**
 * The port, exercised with no renderer at all.
 *
 * Nothing under `test/port/` imports **three.js or the DOM**, which is the
 * point of the boundary: a gameplay bug in `game/` fails an assertion here in
 * a second, without anyone looking at the screen.
 *
 * It is `game/` plus the three-free things that sit either side of it:
 * `core/`, `script/`'s walker, `render/hinge.ts` — the one transcription in
 * `render/` — and `app/systems.ts`, which is the port's *frame* and imports
 * three.js only as a type. That last one is how the tick a stopped transport
 * hands the port is reachable here at all; `test/state.test.ts` drives the
 * same class for the same reason.
 *
 * The layout:
 *
 * - `harness.ts` holds `check`, the failure count it keeps, and every fixture
 *   or helper more than one area uses: the stage tables (`TYPE`, `CHARS`),
 *   `scene`, `spawnZombie`, `EnterPlay`, `propScene`, the class 0x31 thrower
 *   tables. A helper that one area uses lives in that area's file.
 * - Each `<area>.test.ts` is a run of top-level blocks. A block announces
 *   itself with `console.log`, asserts through `check`, and runs when its file
 *   is evaluated.
 * - This file imports the areas and then reports. **The import order is the
 *   execution order**, and it is part of the suite: the blocks share `G`, the
 *   fixtures and one failure count, so a file goes where its blocks run.
 *
 * The areas, in the order they run:
 *
 *   director          the crowd throttle, ranking, the cue entrance,
 *                     `ResolveHit`, save state and determinism
 *   class41           class 0x41's placer, breaks, items and draws, and
 *                     class 0x44 selector 16
 *   class41_types     class 0x41's transcribed types, 8 to 67
 *   class25           the scripted humanoid's VM
 *   class20_24        the one-hit target and the set piece
 *   routes            the rescue target, the stage-2 car, the shootable
 *                     triggers, and every branch writer
 *   class41_stages    stage props: the church, the lift, the doors, the
 *                     collectibles, Training's targets
 *   class31           the thrower's states, arcs and root motion
 *   class31_throw     the thrower's eye, its weapons and its throw; `coli/`
 *   class10           the civilian and the rescue
 *   class30_captors   the captors, placement, the pushes, the entrance states
 *   player            the player shell, the continue screen, the counters
 *   class30_states    class 0x30's scripted states and the attack-slot claim
 *   registry          `g_class_handlers`, `ActorDeadSweep`, the shot queue,
 *                     the strike anchor; the rain and the hinge pose
 *   class30_death     class 0x30's death chain, fades and `ZombieOnShot`
 *   script            the walker's waits and the camera path
 *   shots             the character's size, severed heads, the camera block's
 *                     yaw, the voices, the shot effects, the firing gate
 *   cards             `wait_script_flag`, `spawn_simple` and the cards
 *   class19_14        the stage-4 and stage-2 bosses
 *   class33           the carrier, the scenery it shoves, its effects
 *   flyers            classes 0x11, 0x43 and 0x51, and the bone cel runs
 *   horde             znjoe's creature, stage 3's boats, class 0x40
 *   class30_state37   the carried barrels and drums, the lights, the riders
 *   hud               the damage overlay, the shutter, the gun, the boss bar
 *                     and banner
 *   class22_45        JUDGMENT, the shot test, the stage-3 boss
 *   turning           the turn helpers and the head aim
 *   rings             every caller of the ring effects
 *   spheres           spawn angles and the hit spheres' writers
 *   class28_12        class 0x28, the bin captor's door, `ShotTestMesh`
 *   options           the options screen and the input devices
 *
 * Run with `npm run test:port` (`node tools/run_test.mjs test/port/index.ts`).
 */
import { failures } from "./harness";
import "./director.test";
import "./class41.test";
import "./class41_types.test";
import "./class25.test";
import "./class20_24.test";
import "./routes.test";
import "./class41_stages.test";
import "./class31.test";
import "./class31_throw.test";
import "./class10.test";
import "./class30_captors.test";
import "./player.test";
import "./class30_states.test";
import "./registry.test";
import "./class30_death.test";
import "./script.test";
import "./shots.test";
import "./cards.test";
import "./class19_14.test";
import "./class33.test";
import "./flyers.test";
import "./horde.test";
import "./class30_state37.test";
import "./hud.test";
import "./class22_45.test";
import "./turning.test";
import "./rings.test";
import "./spheres.test";
import "./class28_12.test";
import "./options.test";

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
