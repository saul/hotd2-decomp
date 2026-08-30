/**
 * `g_class30_states` (0x00592AE8) — the states class 0x30 dispatches on.
 *
 * The 54-entry table is the class's whole behaviour; five of its states are
 * ported. The others in the descriptor (10, 15, 26, 30, 38) are approach
 * variants — state 15 walks a set distance and hands to state 1 — and an
 * unmodelled state with no handler holds its permit for ever, which is what
 * stopped every other zombie attacking. `ActorAbortAttackAndLeave` catches
 * them rather than a fallthrough.
 *
 * Values are the table's own indices; the names are what the routines at those
 * indices were named in `ghidra/annotations/functions.tsv`.
 */
export enum ZombieState {
  /** `g_class30_states[0]` — the engine's no-op. 123 of stage 2's spawns. */
  NoOp = 0,
  /** `ZombieStateAttackRun` (`FUN_004554D0`). */
  AttackRun = 1,
  /** `ZombieStateStrike` (`FUN_00455A40`). */
  Strike = 2,
  /**
   * `ZombieStateBackOff` (`FUN_00455C30`). The pause between attacks. There is
   * no cooldown timer for an ordinary zombie: `ZombieStateHoldAtRange` forces
   * `obj+0x133C` to zero unless `obj+0x1368` bit 0 is set, so the retreat *is*
   * the pause.
   */
  BackOff = 4,
  /** `ActorAbortAttackAndLeave` (`FUN_0045D9F0`). */
  Leave = 10,
  /** `ZombieStateApproach` (`FUN_004579A0`). */
  Approach = 22,
}

/**
 * `ZombieStateStrike`'s sub-state, at `obj+0x1312`.
 *
 * [diverges] `Swung` is this port's "already landed the hit" latch. The engine
 * has both a sub-state here and a flag word at `obj+0x1368`; which bit it
 * latches with has not been read, so the latch is kept on the struct rather
 * than in a field of the port's own invention.
 */
export enum StrikeSub {
  /** Draw which attack to use. */
  Pick = 0,
  /** Lunge until inside the attack's own distance. */
  Lunge = 1,
  /** The clip is running and the hit has not landed. */
  Swinging = 2,
  /** The hit has landed; play the clip out. */
  Swung = 3,
}

/** The engine's frame clock; attack hit frames are counted in it. */
export const GAME_HZ = 60;

/**
 * Units per second an enemy closes at.
 *
 * [diverges] Invented, not derived. There is no `fstp [reg+0x4c]` anywhere in
 * 0x455000..0x459000, so the zombie's own code never writes a velocity; it is
 * not root motion either — the clips the approach uses (270, 975, 1000) each
 * net between +0.00 and +0.04 over a full cycle, so they are in-place walks,
 * while the death clips net -8.7 and -15.7 and root motion is plainly real;
 * and it is not a step count, because `obj+0x1358` is a queue depth. This
 * exists so the states that plainly do close the distance can.
 */
export const CLOSING_SPEED = 6;
