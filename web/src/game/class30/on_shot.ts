/**
 * What happens to a zombie when you shoot it.
 *
 * This is the missing edge in the port's death graph. `ResolveHit` drops the
 * hit points and raises {@link ActorFlag.Dead}; **nothing** then put a
 * class-0x30 actor into a death state, so the director simply stopped updating
 * it and it stayed in the pool as a standing corpse. `ThrowerOnShot`
 * (`class31/on_shot.ts`) is the same routine for class 0x31 and has been the
 * only thing routing a thrower into its fall since it was written.
 */
import { ActorFlag, ZombieFlag2, type ZombieActor } from "../actor";
import { ZombieState } from "./states";

/** `FCOMP [0x0055d178]` — `00009041` = 18.0f. */
const ARC_TARGET_NEAR = 18.0;
/** `0x1a < state && state < 0x1d` — the three states the near test applies to. */
const ARC_TARGET_STATE_LO = 0x1b;
const ARC_TARGET_STATE_HI = 0x1c;
/** `obj+0x130C` — the two body conditions that die through state 9. */
const COND_FIVE = 5;
const COND_SIX = 6;
/**
 * `CMP DX, 0x34` — the state that also dies through state 9.
 * `g_class30_states[0x34]` is `FUN_0045E330`, which the port has not read;
 * `ZombieStateHoldAtRange` is the one thing that enters it (0x0045587C).
 */
const STATE_UNREAD_0x34 = 0x34;

/**
 * `ZombieOnShot` — `FUN_00453EB0`. Its **death** half.
 *
 * ```
 * 00453f88  f6c540       TEST CH, 0x40      ; obj+0x136C bit 0x4000, Leaping
 * 00453f8b  0f85a4...    JNZ  00454035      ; shot mid-leap: keep flying
 * 00453f98  66c786...00  MOV  word [ESI+0x1312], 0x0      ; sub = 0
 * 00453fa1  6683fa34     CMP  DX, 0x34                    ; state
 * 00453fa7  f7c100001000 TEST ECX, 0x100000               ; Carried
 * 00453fb5  83f805       CMP  EAX, 0x5                    ; obj+0x130C
 * 00453fba  83f806       CMP  EAX, 0x6
 * 00453fbf  66c786...06  MOV  word [ESI+0x1310], 0x6      ; ...else state 6
 * 00453fcd  83f81b/1c    CMP  EAX, 0x1b / 0x1c            ; state, for the
 * 00453ff9  d81d78d15500 FCOMP [0x0055d178]               ; 18.0 near test
 * 00454006  83c908       OR   ECX, 0x8                    ; ShotNearArcTarget
 * 0045400f  66c786...09  MOV  word [ESI+0x1310], 0x9
 * ```
 *
 * Two things worth keeping straight:
 *
 * * **The latch is once per death, not once per shot.**
 *   {@link ZombieFlag2.DiedInFlight} is raised on the first shot that finds
 *   the actor dead and vetoes every later one, which is what stops a corpse
 *   being knocked back into sub 0 of its own death state by the rest of a
 *   burst.
 * * **`obj+0x136C` bit 0x4000 vetoes the whole thing.** A zombie shot in the
 *   middle of `ZombieStateDelayedLeap`'s arc finishes the arc; the death is
 *   dispatched later, by whatever ends the leap.
 *
 * [diverges] The engine's routine is the whole shot response, not only this:
 * per player it stashes the result at `obj+0x1364`, calls `ActorShotFeedback`
 * (`FUN_00454050`) for the blood and the sound, and on a *survivable* hit
 * calls `ActorReactToHit` (`FUN_004543F0`) for the stagger. The port's shared
 * `ResolveHit` already does the damage, the gore, the score and the stagger
 * generically — `ThrowerShotFeedback` carries the same `[diverges]` for the
 * same reason — so what is left here is the half no shared routine can do,
 * which is choosing a state.
 *
 * **State 9 is ported.** It used to carry a `[diverges]` here saying it was
 * not: every actor this half of the routine chose state 9 for was sent to
 * {@link ZombieState.Death} instead, on the argument that the two states share
 * a terminus, so the 44 shipped spawns carrying body condition 5 or 6 died
 * where they stood rather than where they were thrown. That was **D2** in
 * `docs/REVIEW-2026-09-03.md`, and `class30/knockback.ts` now transcribes
 * `FUN_004550E0` — the camera-space landing point, the arc, the water case and
 * the bounce — so the write below is the engine's own.
 */
export function ZombieOnShot(obj: ZombieActor): void {
  const hit = obj.pendingHit;
  if (!hit) return;
  obj.pendingHit = null;
  // `00453ec7 f6c401 TEST AH,0x1` on `obj+0x34` (loaded at 0x00453ec4), then
  // `00453eca 0f857e010000 JNZ 0x0045404e` -- the routine's own tail, so a
  // downed actor only ricochets and reaches none of the arms below. The
  // citation here used to read `TEST EAX, 0x100` at 0x00453EFB; that address
  // holds `MOV EDX, [ESI+0x136c]`, inside the per-player loop, and the
  // encoding is the byte form. `[proved]`
  if (obj.flags & ActorFlag.ShotImmune) return;
  // A survivable hit stops here. The engine would call `ActorShotFeedback`
  // and then `ActorReactToHit` (`FUN_004543F0`) for the stagger; the port's
  // shared `ResolveHit` has already run both, so there is nothing left for
  // this routine to do on an actor that is still alive. [diverges]
  if (!(obj.flags & ActorFlag.Dead)) return;
  // `if ((obj+0x136C & 0x80000000) == 0)` at 0x00453F2A, then the raise at
  // 0x00453F4E: this death is dispatched once.
  if (obj.flags2 & ZombieFlag2.DiedInFlight) return;
  obj.flags2 |= ZombieFlag2.DiedInFlight;

  if (obj.flags2 & ZombieFlag2.Leaping) return;
  obj.sub = 0;

  const arcDeath = obj.state === STATE_UNREAD_0x34
                || (obj.flags2 & ZombieFlag2.Carried) !== 0
                || obj.condition === COND_FIVE
                || obj.condition === COND_SIX;
  if (!arcDeath) {
    obj.state = ZombieState.Death;
    return;
  }
  if (obj.state >= ARC_TARGET_STATE_LO && obj.state <= ARC_TARGET_STATE_HI
      && Math.hypot(obj.pos.x - obj.arcTo.x, obj.pos.z - obj.arcTo.z)
         < ARC_TARGET_NEAR) {
    obj.flags2 |= ZombieFlag2.ShotNearArcTarget;
  }
  // `MOV word [ESI+0x1310], 0x9` at 0x0045400F.
  obj.state = ZombieState.DeathKnockbackArc;
}
