/**
 * `g_GameMode` — 0x009CA08C.
 *
 * The exe's own numbering, and the only one anything in this repo uses. The
 * exporter used to emit a *different* number under the same name — a flag,
 * `1 if original else 0` — so a bundle's `0` meant the exe's `2` and every
 * reader had to know which side of the seam it was on. It emits these values
 * now; there is one enumeration.
 */
export enum GameMode {
  /**
   * Original Mode — the story campaign. Class 0x41 releases the member's own
   * `storyItem` here, and `PlaceGenericProp`'s types 70–72 and 77 only exist
   * in this mode: their update routines despawn on the first frame otherwise.
   */
  Original = 1,
  /**
   * Arcade Mode. `PlaceBreakableGroup` turns the members named by
   * `g_prop_target_set` into one-shot targets and pays no score for them.
   */
  Arcade = 2,
  /** Boss Rush. No shipped stage script is entered in this mode. */
  BossRush = 3,
}
