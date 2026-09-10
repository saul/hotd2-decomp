/**
 * The other way a class-0x30 actor rides `g_carrier_object`, and the one that
 * is not a state at all.
 *
 * `ZombieStateRideCarrier` (`FUN_00458960`, state 29) is a *state*: it adds
 * the carrier's translation to a position it recorded itself, and only while
 * that state is running. This is the other mechanism, and it sits one level
 * up — in the class's `Init` and in its per-frame update, **before** the state
 * dispatch — so it moves the actor whatever state the actor is in, including
 * the three states that never move an actor themselves.
 *
 * The two never overlap in the shipped data: none of the six state-29 riders
 * sets the descriptor bit this one reads, and none of the four spawns that set
 * it starts in state 29.
 *
 * ## What settled it
 *
 * `class30/scripted.ts` used to conclude, of the three stage-5 block-2
 * `znnick` at `?stage=5&mode=play&block=2&step=2&op=50&frame=599`, that
 * "`SpawnFromDescriptor` copies the spawn position verbatim — the distance was
 * never the bug". The copy is verbatim and the conclusion was still wrong:
 * what it copies is a **carrier-local offset**, and `EnemyZombieInitByCharType`
 * re-reads `obj+0x40/0x44/0x48` as one the moment it sees `obj+0x34` bit 3.
 * Their descriptor positions are `(-4.6, 10, -16.5)`, `(-4.6, 5, -2.6)` and
 * `(-4.6, 5, 7)` — a line up the bed of a car at `x = -4.6`, two of them five
 * units off its floor — and `d≈2870` was the distance from the player to the
 * **world origin**, which is where the port was leaving them.
 *
 * `[proved]` Exactly four descriptors in the whole game set that bit, all
 * class 0x30, all in `st5evtbl` block 2 step 2 op 38: `0x1D44`, `0x1D74`,
 * `0x1DA4` (state 32) and `0x1DD4` (state 18). The carrier is the class-0x33
 * selector-1 car at evt `0x1CE4`, spawned by **op 37** — one op earlier, in
 * the same step — which publishes itself into `g_carrier_object` in its own
 * `Init` (`ScriptedSceneryDispatch33`, `0x00433014`), so the global is live on
 * the frame these four are made.
 */
import { ActorByAt, G } from "../globals";
import { ZombieFlag2, type ZombieActor } from "../actor";
import { ActorLocalPoint } from "../class31/arc";
import { vec3 } from "../vec";

/**
 * `MatrixRotateY(0x8000)` at `0x0045E7A6` — the half turn the seat is built
 * with, on top of the carrier's own yaw. A literal, not a field.
 */
const CARRIER_YAW_BIAS = 0x8000;

/**
 * `TEST byte ptr [EBP + 0x34], DL` at `0x0045301D`, with `DL = 8` — the
 * descriptor's own bit 3, and the whole of what marks a spawn as a passenger.
 *
 * `ActorInitFlags` (`FUN_00408970`) puts the descriptor's flags word on
 * `obj+0x34` before any `Init` runs. Unlike bits 1 and 2, which
 * `EnemyZombieInitByCharType` consumes and clears, this one is left where it
 * is — nothing reads it again, but nothing takes it away either.
 */
export const SPAWN_RIDE_CARRIER = 0x8;

/** Scratch, so the attach allocates nothing per frame. */
const seat = vec3();

/**
 * `ZombieAttachToCarrier` — `FUN_0045E770`. Seat the actor on the carrier,
 * position and yaw.
 *
 * ```
 * MatrixTranslate(carrier+0x40, +0x44, +0x48)
 * MatrixRotateY(carrier+0x68)
 * MatrixRotateY(0x8000)
 * MatrixTransformPoint(obj+0x13D8..0x13E0) -> obj+0x40..0x48
 * MatrixToEulerBams(...) -> obj+0x68;  obj+0x68 += obj+0x135C
 * ```
 *
 * The stack post-multiplies, so the composed transform is
 * `T(carrier.pos) · Ry(carrier.yaw + 0x8000)` — two `MatrixRotateY` about one
 * axis add, which is `L5`'s rule for translations seen on the rotation side.
 * Only the carrier's `+0x68` is read: its pitch and roll are ignored, which is
 * why a car that pitches on its path does not tip its passengers.
 *
 * `MatrixToEulerBams` (`FUN_00401AE0`) then takes the composed yaw back off
 * the stack — `atan2(x, z)` of the transformed `+Z`, through `__ftol` into a
 * **signed short** — and the actor's own stashed yaw is added to that. For a
 * Y-only rotation the extraction is exact, so it is written here as the `s16`
 * truncation it is rather than as a matrix round trip.
 *
 * ## The two words it reads, and what else calls them something
 *
 * `obj+0x13D8/0x13DC/0x13E0` and `obj+0x135C` hold the local offset and the
 * local yaw, and **both are aliases**. `+0x13D8` is `strikeStart`, the anchor
 * `ZombieStateStrike` captures and `ZombieStateBackOff` retreats toward;
 * `+0x135C` is `throwHand`, the bone `ZombieStateStandAndThrow` picks. That is
 * `L3` inside one class rather than across two, and the engine gets away with
 * it because a spawn that sets bit 3 reaches neither of those states: the
 * three state-32 spawns inline their own swing and never write the anchor, and
 * the state-18 one hands over to state 10. The port keeps the aliasing rather
 * than inventing two more fields, so that if a future state does write one of
 * them the port breaks in the same place the engine would.
 *
 * [diverges] The engine dereferences `g_carrier_object` with **no null test**
 * — `MOV EAX, [0x009A5C34]` then `MOV ECX, [EAX + 0x48]` at `0x0045E781`,
 * and `ZombieStateDelayedStrikeInPlace` does the same at `0x0045EAFE`. The
 * port cannot: `ActorByAt` returns `undefined` and there is no pointer to
 * follow. With no carrier the seat is skipped and the actor stays at its
 * descriptor offset, which is exactly the behaviour this file just corrected —
 * so the arm exists only to keep a stage that reaches one of these four
 * spawns without its class-0x33 car from throwing. Same divergence, third
 * site: see `entrance.ts`'s note on `ZombieStateRideCarrier`.
 */
export function ZombieAttachToCarrier(obj: ZombieActor): void {
  const carrier = G.g_carrier_object >= 0
    ? ActorByAt(G.g_carrier_object) : undefined;
  if (!carrier) return;
  // `T(carrier.pos) · Ry(carrier.yaw + 0x8000)` applied to the stashed offset.
  ActorLocalPoint(carrier.pos, carrier.yaw + CARRIER_YAW_BIAS,
                  obj.strikeStart.x, obj.strikeStart.y, obj.strikeStart.z,
                  seat);
  obj.pos.x = seat.x;
  obj.pos.y = seat.y;
  obj.pos.z = seat.z;
  // `__ftol` of `fpatan` into a signed short, then `obj+0x68 += obj+0x135C`.
  const ry = ((carrier.yaw + CARRIER_YAW_BIAS) << 16) >> 16;
  obj.yaw = ry + obj.zom.throwHand;
}

/**
 * `EnemyZombieInitByCharType`'s fourth arm — `0x0045301D` to `0x0045305E`.
 *
 * Split out of `init_char.ts` only because the seat above belongs with it: the
 * arm is what turns the descriptor's position and yaw into the local offset
 * and local yaw the seat reads, and nothing else ever writes them for a
 * passenger.
 *
 * The order is the engine's, and the last line is not decoration:
 * `ZombieFlag2.AttachedToCarrier` is what `EnemyZombieUpdate` tests every
 * frame, and `ZombieFlag2.Carried` is raised **after** the first seat, the
 * same bit `ZombieStateRideCarrier` holds while it rides.
 */
export function ZombieSeatOnCarrierFromDescriptor(obj: ZombieActor): void {
  if (!(obj.flags & SPAWN_RIDE_CARRIER)) return;
  // `obj+0x13D8/DC/E0 = obj+0x40/44/48` and `obj+0x135C = obj+0x68`.
  obj.strikeStart.x = obj.pos.x;
  obj.strikeStart.y = obj.pos.y;
  obj.strikeStart.z = obj.pos.z;
  obj.zom.throwHand = obj.yaw;
  // `OR ECX, 0x10000000` at `0x00453028`, stored to `obj+0x136C`.
  obj.flags2 |= ZombieFlag2.AttachedToCarrier;
  ZombieAttachToCarrier(obj);
  // `OR EAX, 0x100000` — after the call, not before.
  obj.flags2 |= ZombieFlag2.Carried;
}
