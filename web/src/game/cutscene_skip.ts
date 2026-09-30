/**
 * The skip watcher's second routine, and what the port stands in for with it.
 *
 * Class 0x63's `InitCutsceneSkipWatcher` (`FUN_00435F20`) is placed at the
 * top of most steps and installs `CheckCutsceneSkipRequest` (`FUN_00435F40`),
 * which, on the frame a START press arrives inside a skippable region, raises
 * `g_nEvtSkipFlag` and `g_cutscene_skipping` and installs
 * `FinishCutsceneSkip` (`FUN_00435FA0`) in its own place:
 *
 * ```
 * 00435fa0  MOV  dword ptr [0x009a2230], 0x0     ; g_cutscene_skipping
 * 00435faa  JMP  0x004a7040                       ; ActorKill
 * ```
 *
 * `[proved]`. So the flag is up for exactly one walk of the task list: every
 * object that runs after the watcher sees it on the press's frame, every one
 * before it on the next, and none twice.
 *
 * The port has no watcher object. `Walker.requestSkip` (`script/walker.ts`)
 * does `CheckCutsceneSkipRequest`'s work when START is pressed, between two
 * frames, and raises the flag there; the finish then runs at the end of the
 * next scene task walk, after every actor has run once with it up, which is
 * the one-walk lifetime. Which frame an actor sees it on can differ from the
 * engine's by one for an actor spawned before the step's watcher -- the same
 * frame the walker's own skip lands on.
 */
import { G } from "./globals";

/**
 * `FinishCutsceneSkip` — `FUN_00435FA0`. The flag down, and (in the engine)
 * the watcher task gone.
 */
export function FinishCutsceneSkip(): void {
  G.g_cutscene_skipping = 0;
}
