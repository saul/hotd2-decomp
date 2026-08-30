/**
 * `g_class30_states` — the state indices class 0x30 dispatches on.
 *
 * Only the five below are ported. The others in the descriptor (10, 15, 26,
 * 30, 38) are approach variants; state 15 walks a set distance and hands to
 * state 1. An unmodelled state with no handler holds its permit for ever,
 * which is what stopped every other zombie attacking, so
 * `ActorAbortAttackAndLeave` catches them rather than a fallthrough.
 */
export const STATE_NOOP = 0;
export const STATE_ATTACK_RUN = 1;
export const STATE_STRIKE = 2;
/**
 * `ZombieStateBackOff` — the pause between attacks. There is no cooldown
 * timer for an ordinary zombie: `ZombieStateHoldAtRange` forces `obj+0x133C`
 * to zero unless `obj+0x1368` bit 0 is set, so the retreat *is* the pause.
 */
export const STATE_BACKOFF = 4;
export const STATE_LEAVE = 10;
export const STATE_APPROACH = 22;

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
