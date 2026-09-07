/**
 * `EnemyZombieInit`'s per-character-type tail, and the three flag moves it
 * opens with.
 *
 * The head of this routine is not about the character type at all: it takes
 * three bits the spawn record put in `obj+0x34` and `obj+0x136C` and **moves**
 * them into `obj+0x38`, clearing two of them at the source. That is why
 * carrying the descriptor's flags word onto the actor — which this port does —
 * is not enough on its own: after this runs, `obj+0x34` no longer holds the
 * bit, and the only place the fact survives is `obj+0x38`.
 *
 * The one that shows is `obj+0x34` bit 1. Exactly two spawn records in the
 * shipped game set it, both class 0x30 in stage 3's block 2 step 4 — the two
 * axe men, `init_flags 0x20002` — and the bit it becomes,
 * `ZombieAux.StandThrowRetire`, is read in exactly one place in the whole
 * image: `ZombieStateStandAndThrow`'s ending. Without it those two walked
 * their descriptor's 25 units backwards through the wall of the building they
 * stand against, because the walk is what the *other* seven state-33 spawns
 * do.
 */
import { ActorFlag, ZombieAux, ZombieFlag2, type ZombieActor } from "../actor";

/**
 * The two bits this routine consumes out of the spawn record's flags word.
 *
 * They are the same two `MarkActorShot` (`FUN_00404DB0`) later uses to name
 * the player who fired — {@link ActorFlag.HitByPlayer0} and
 * {@link ActorFlag.HitByPlayer1} — which is *why* the routine clears them: a
 * descriptor bit left in `obj+0x34` would read as a shot on the actor's first
 * drain. One word, two meanings, separated by when they are written.
 */
const SPAWN_STAND_THROW_RETIRE = 0x2;
const SPAWN_CARRIER_OFFSET = 0x4;

/**
 * `EnemyZombieInitByCharType` — `FUN_00452FD0`.
 *
 * **The head only.** After these three moves the engine branches on the
 * character type: 2 and 3 load a held prop and play a spawn cry, 9 becomes a
 * corpse, 0xC branches on the body condition, 0xE loads a prop, and 0x12
 * allocates a *second* class-0x30 actor beside itself. None of that is ported.
 * `obj+0x34` bit 3 — spawned in the air — is the fourth thing the routine
 * looks at, and {@link ActorFlag.SpawnedInAir} already carries it.
 */
export function EnemyZombieInitByCharType(obj: ZombieActor): void {
  // `00453000  if (obj+0x136C & 0x20) obj+0x38 |= 8`. Raised, not moved: the
  // source bit stays where it is.
  //
  // [open] `EnemyZombieInit` *assigns* `obj+0x136C` from the descriptor's
  // `+0x20` word (`(s16)obj+0x1316 | 0x60000000`, `00452EAF`) and this port
  // does not — class 0x31 does, in `EnemyThrowerInit`. So the source bit is
  // unreachable here and this arm cannot fire, for the 55 shipped class-0x30
  // spawns that set it. Seeding the word is a change of its own; the line is
  // transcribed rather than dropped so that the gap is one place, not none.
  if (obj.flags2 & ZombieFlag2.DrawVariantSource) {
    obj.flags38 |= ZombieAux.DrawVariant;
  }
  // `0045300B  if (obj+0x34 & 2) { obj+0x34 &= ~2; obj+0x38 |= 0x10 }`
  if (obj.flags & SPAWN_STAND_THROW_RETIRE) {
    obj.flags &= ~SPAWN_STAND_THROW_RETIRE;
    obj.flags38 |= ZombieAux.StandThrowRetire;
  }
  // `00453045  if (obj+0x34 & 4) { obj+0x34 &= ~4; obj+0x38 |= 0x20 }`
  if (obj.flags & SPAWN_CARRIER_OFFSET) {
    obj.flags &= ~SPAWN_CARRIER_OFFSET;
    obj.flags38 |= ZombieAux.CarrierOffset;
  }
}
