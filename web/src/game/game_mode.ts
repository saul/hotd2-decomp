/**
 * `g_GameMode` — 0x009CA08C.
 *
 * The exe's own numbering, and the only one anything in this repo uses. The
 * exporter used to emit a *different* number under the same name — a flag,
 * `1 if original else 0` — so a bundle's `0` meant the exe's `2` and every
 * reader had to know which side of the seam it was on. It emits these values
 * now; there is one enumeration.
 *
 * **`Arcade` was 2 until bundle format 7, and 2 is Training.** What settles
 * the four values is the title menu, not what any arm resembles:
 * `TitleMenuRegisterSprites` (`FUN_004962C0`) registers the menu rows as
 * screen sprites in order, each by its own texture name — `tex\arcade00`,
 * `tex\original_00`, `tex\traning_00`, `tex\boss_00`, then `ranking_`,
 * `option_`, `network_`, `exit_` — and `TitleMenuUpdateAndSelect`
 * (`FUN_00496960`) lights the triple at `(cursor + 2) * 3` and, for rows 0 to
 * 3, writes the row straight into the global. Every other writer in the
 * program stores 0: `TitleMenuRunPhase` (`FUN_00496200`) on entry, the two
 * attract screens `RunAttractScene10` (`FUN_0041F9B0`) and
 * `RunAttractScene11` (`FUN_0041FB00`), `RunAttractDemo` (`FUN_00426800`),
 * and `NetworkModeRunPhase` (`FUN_0049F380`). So 1, 2 and 3 can only come
 * from that menu, and 0 is both Arcade and the default.
 */
export enum GameMode {
  /**
   * Arcade Mode — the coin-op game, and what the player runs unless a bundle
   * says otherwise. `PlaySoundId` picks the plain BGM names over the `_AR`
   * ones in this mode and no other (`g_app_state == 6 && g_GameMode == 0`).
   */
  Arcade = 0,
  /**
   * Original Mode — the story campaign. Class 0x41 releases the member's own
   * `storyItem` here, and `PlaceGenericProp`'s types 70–72 and 77 only exist
   * in this mode: their update routines despawn on the first frame otherwise.
   */
  Original = 1,
  /**
   * Training. `PlaceBreakableGroup` turns the members named by
   * `g_training_lesson` into one-shot targets and pays no score for them, and
   * `BreakablePropAwardHit` pays nothing for an ordinary hit either.
   * `ResetGameOnStart` sends this mode to scene 6, `trnevtbl.bin`, so no
   * stage bundle is ever exported in it; the arms that test for it are
   * reachable in the port only from a test.
   */
  Training = 2,
  /** Boss. No shipped stage script is entered in this mode. */
  Boss = 3,
}
