/**
 * Boss Mode's bookkeeping, as far as the fights reach it.
 *
 * `BossModeRecordGrade` (`FUN_00425F40`) is called by every boss's kill --
 * class 0x19's `Boss4ResolveShot` at `0x00491EC2`, class 0x2D, 0x32 and the
 * rest -- and returns at once unless `g_GameMode` is 3, Boss Mode. Its body
 * grades the fight into `g_boss_mode_grades` and the save block.
 *
 * **The port never runs that body, and not by choice of this file**:
 * `g_GameMode` is only ever written from the bundle's `game_mode`
 * (`app/stage_load.ts`), and the exporter writes 0 or 1 -- no bundle is a
 * Boss Mode stage, and there is no title menu in the port to pick one. So the
 * gate is transcribed and the body is the one unreachable arm; when Boss Mode
 * is added, the body lands here, not in each boss.
 */
import { G } from "./globals";
import { GameMode } from "./game_mode";

/**
 * `BossModeRecordGrade` — `FUN_00425F40`. `if (g_GameMode != 3) return;` and
 * then the grade. See the file note for why only the gate runs.
 */
export function BossModeRecordGrade(): void {
  if (G.g_GameMode !== GameMode.Boss) return;
}
