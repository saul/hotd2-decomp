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
import { SPAWN_RIDE_CARRIER, ZombieAttachToCarrier } from "./carrier";

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
const SPAWN_TURN_TOWARD_CAMERA = 0x4;

/**
 * `EnemyZombieInitByCharType` — `FUN_00452FD0`.
 *
 * **The head only.** After the four arms the engine branches on the character
 * type: 2 and 3 load a held prop and play a spawn cry, 9 becomes a corpse,
 * 0xC branches on the body condition, 0xE loads a prop, and 0x12 allocates a
 * *second* class-0x30 actor beside itself. None of that is ported.
 *
 * The fourth arm — `obj+0x34` bit 3 — **is** ported now, and it is not a flag
 * move at all: it re-reads the descriptor's position and yaw as an offset on
 * `g_carrier_object` and seats the actor there. It lives in
 * `class30/carrier.ts` with the seat it calls, because the two are one
 * mechanism. This comment used to say the bit meant "spawned in the air" and
 * that {@link ZombieFlag2.AttachedToCarrier} "already carries it"; nothing
 * set that flag, nothing read it, and stage 5 block 2's four passengers stood
 * at the world origin for it.
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
  if (obj.flags & SPAWN_TURN_TOWARD_CAMERA) {
    obj.flags &= ~SPAWN_TURN_TOWARD_CAMERA;
    obj.flags38 |= ZombieAux.TurnTowardCameraEye;
  }
  // `0045301D  TEST byte ptr [EBP + 0x34], DL` with `DL = 8` — the fourth
  // arm, and the only one that moves the actor rather than moving a bit.
  //
  // It re-reads the descriptor's position and yaw as **carrier-local**: the
  // position goes to `obj+0x13D8` and the yaw to `obj+0x135C`, the flag that
  // makes `EnemyZombieUpdate` re-seat the actor every frame goes up, the seat
  // runs once here so the actor is on the carrier from frame one, and the
  // carried bit goes up **after** the call and not before. See
  // `class30/carrier.ts` for `ZombieAttachToCarrier` and for what settled it.
  if (obj.flags & SPAWN_RIDE_CARRIER) {
    // `00453022/00453025/0045303D  obj+0x13D8/E0/DC = obj+0x40/48/44`, and
    // `00453034  obj+0x135C = obj+0x68`.
    obj.strikeStart.x = obj.pos.x;
    obj.strikeStart.y = obj.pos.y;
    obj.strikeStart.z = obj.pos.z;
    obj.zom.throwHand = obj.yaw;
    // `00453028  OR ECX, 0x10000000`, stored to `obj+0x136C` at `00453037`.
    obj.flags2 |= ZombieFlag2.AttachedToCarrier;
    ZombieAttachToCarrier(obj);
    // `OR EAX, 0x100000` on the word re-read at `00453058` — after the call.
    obj.flags2 |= ZombieFlag2.Carried;
  }
}
