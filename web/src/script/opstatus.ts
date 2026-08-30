/**
 * The vocabulary for "how far does this client honour an opcode", and nothing
 * else.
 *
 * The per-opcode answers used to live here, in a table parallel to the
 * interpreter's dispatch switch. They drifted -- `enable_rain` was implemented
 * and struck through as unimplemented for weeks, and `set_skippable_region`
 * was marked dead after it had been wired up. A table that has to be
 * remembered will not be.
 *
 * So the answers moved to `Walker.OPS` in `walker.ts`, where an opcode's
 * status sits on the same object as the `run` that justifies it. Ask
 * `opStatus` from `./walker`. What is left here is the type and
 * the human labels, which are presentation and belong with neither.
 *
 * `docs/PLAYER_PROGRESS.md` carries the same table for humans.
 */

export type OpStatus =
  /** Acted on — you can see or hear the result. */
  | "done"
  /** Acted on, but by a rule the client can evaluate rather than the game's. */
  | "approx"
  /** State is kept and shown in the HUD or inspector; nothing is drawn. */
  | "tracked"
  /** Decoded into the feed with its operands; no state, no effect. */
  | "shown"
  /** A proved no-op, a dead opcode, or a dispatch slot nothing encodes. */
  | "none";

export const STATUS_TITLE: Record<OpStatus, string> = {
  done: "acted on",
  approx: "acted on, by an approximation — see the feed note",
  tracked: "state kept and shown, but nothing is drawn from it",
  shown: "not implemented — decoded and listed, but it has no effect here",
  none: "a proved no-op, a dead opcode, or an unused dispatch slot",
};
