/**
 * The two enemy counters, kept the way the engine keeps them.
 *
 * `g_enemies_alive` and `g_enemies_present` are what the script waits on —
 * `wait_enemies_alive` (0x44) is 434 of the 488 enemy gates in the shipped
 * scripts and `wait_enemies_present` (0x43) the other 54 — so a block does not
 * advance until they say so. They are **counters**, incremented once when an
 * actor is built and decremented once when it leaves, each decrement latched
 * on the actor so it can only happen once.
 *
 * The port used to *derive* them instead, recounting
 * `g_object_list.filter(visible && isEnemy)` every frame in
 * `SyncDerivedActorCounts`. That is a different quantity, and the difference
 * is not academic:
 *
 * * **A corpse is present but not alive.** The engine drops the alive count at
 *   death, in `ZombieReleasePermitAndUntrack` (`FUN_004565A0`), and the
 *   present count only when the death clip finishes, in
 *   `ZombieEnterCorpseState` (`FUN_00456740`). Derived from `visible`, a
 *   corpse counted as both — so the two gates could never differ, which is the
 *   entire reason the game has both.
 * * **An actor can be alive and deliberately uncounted.** `EnemyZombieInit`
 *   (`FUN_00452DA0`) refuses to count a spawn whose initial state is 31; that
 *   state counts itself in when its script flag comes up, which is what makes
 *   those four stage-2 zombies invisible to the gates until the script lets
 *   them in. Derived from `visible`, they were counted from frame one and the
 *   state's whole purpose was unmodelled.
 * * **Character type 9 is not an enemy at all** — `EnemyZombieInit` gives it a
 *   different update handler and never counts it.
 *
 * The two classes latch the same two facts in **different words**: class 0x30
 * in `obj+0x38` ({@link CountFlag}), class 0x31 in `obj+0x136C`
 * ({@link ThrowerFlag}). That is the engine's own polymorphism and the reason
 * there are four functions here rather than two.
 */
import { CountFlag, ThrowerFlag, type Actor } from "../actor";
import { G } from "../globals";

/**
 * `ReleaseEnemyAliveCount` — `FUN_00456560`.
 *
 * `if (!(obj+0x38 & 2)) { obj+0x38 |= 2; g_enemies_alive--; }`. Six routines
 * call it and more than one can reach the same actor, so the latch is what
 * stops the count going negative and opening a gate early.
 */
export function ReleaseEnemyAliveCount(obj: Actor): void {
  if (obj.flags38 & CountFlag.LeftAlive) return;
  obj.flags38 |= CountFlag.LeftAlive;
  G.g_enemies_alive -= 1;
}

/**
 * `ReleaseEnemyPresentCount` — `FUN_00456580`. The same shape on bit 2.
 *
 * Separate from the alive count on purpose: this one falls when the corpse is
 * finished, not when the actor dies.
 */
export function ReleaseEnemyPresentCount(obj: Actor): void {
  if (obj.flags38 & CountFlag.LeftPresent) return;
  obj.flags38 |= CountFlag.LeftPresent;
  G.g_enemies_present -= 1;
}

/**
 * `ThrowerRetireFromAliveCount` — `FUN_0044CFF0`. Class 0x31's, latched in
 * `obj+0x136C` bit 0x800000 rather than in `obj+0x38`.
 */
export function ThrowerRetireFromAliveCount(obj: Actor): void {
  if (obj.flags2 & ThrowerFlag.LeftAlive) return;
  obj.flags2 |= ThrowerFlag.LeftAlive;
  G.g_enemies_alive -= 1;
}

/** `ThrowerRetireFromPresentCount` — `FUN_0044D020`. Bit 0x1000000. */
export function ThrowerRetireFromPresentCount(obj: Actor): void {
  if (obj.flags2 & ThrowerFlag.LeftPresent) return;
  obj.flags2 |= ThrowerFlag.LeftPresent;
  G.g_enemies_present -= 1;
}

/**
 * The character type `EnemyZombieInit` refuses to count — it takes a different
 * update handler entirely (`LAB_00453290`) and is not an enemy.
 */
export const UNCOUNTED_CHAR_TYPE = 9;
/**
 * ...and the initial state it refuses to count, because that state counts
 * itself in later: `ZombieStateWaitScriptFlagThenEnter`, class 0x30 state 31.
 */
export const UNCOUNTED_INITIAL_STATE = 0x1f;

/**
 * `EnemyZombieInit`'s own tail: count this zombie in, unless it is one of the
 * two kinds the engine leaves out.
 *
 * Kept as a function rather than two lines inside `EnemyZombieInit` because
 * the guard is the interesting part and it is the thing a reader will want to
 * find from either side.
 */
export function CountEnemyZombieIn(obj: Actor): void {
  if (obj.charType === UNCOUNTED_CHAR_TYPE) return;
  if (obj.initialState === UNCOUNTED_INITIAL_STATE) return;
  G.g_enemies_present += 1;
  G.g_enemies_alive += 1;
}

/** `EnemyThrowerInit`'s, which has no guard at all: both, unconditionally. */
export function CountEnemyThrowerIn(): void {
  G.g_enemies_present += 1;
  G.g_enemies_alive += 1;
}
