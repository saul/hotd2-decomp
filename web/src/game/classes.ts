/**
 * The set of ported classes, written down once.
 *
 * Every import here is for its **side effect**: the module's own
 * `registerClass` call. `registry.ts` holds the contracts and an empty table
 * and imports none of these, which is what keeps the dependency edge pointing
 * one way — see the note at the top of that file for the three hours ESM
 * cycles have cost this project.
 *
 * This is also the honest reading of `BuildClassHandlerTable`
 * (`FUN_0040AC90`): the engine's table is a static array of `{id, handler}`
 * pairs walked once at startup, and this is that array, spelled as the imports
 * that produce it.
 *
 * **Anything that runs a frame must have this evaluated first.**
 * `director.ts` imports it, which covers everything: an actor reaches the pool
 * through `ActorSpawn` and leaves it through `GameUpdate`, and both live
 * there. A class that is missing from this list has no behaviour at all and
 * the port says nothing about it — which is deliberate, and is what
 * `port.test.ts`'s registration assertion is for.
 */
import { g_class_handlers } from "./registry";
import type { SpawnClass } from "./spawn_class";

import "./class10";
import "./class19";
import "./class14";
import "./class20";
import "./class21";
import "./class24";
import "./class25";
import "./class30";
import "./class31/thrower";
import "./class41";
import "./class44";
import "./class52";
import "./class53";
import "./class60";
import "./class61";

/**
 * The classes with a ported behaviour, for the UI and `verify_port.py`.
 *
 * A `const` and not a scan at every call because it is computed **after** the
 * imports above have run: ESM evaluates every dependency before the importing
 * module's own body, so by this line the table is complete. Read it from here
 * rather than from `registry.ts` — the registry cannot answer this question
 * without importing the classes, and importing the classes is exactly what it
 * must not do.
 */
export const PORTED_CLASSES: SpawnClass[] =
  Object.keys(g_class_handlers).map(Number);
