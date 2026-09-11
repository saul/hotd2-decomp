/**
 * `ThrowerStateLeapToPoint` — `FUN_0044E4C0`, class 0x31 state 20.
 *
 * **How a class-0x31 actor comes through a window.** The descriptor names a
 * destination and a duration, and the actor rides a ballistic arc to it — flat
 * on x and z, a parabola on y that arrives exactly on time — while an **arc
 * motion script** plays the leap as one clip cut into a windup, a flight and a
 * landing.
 *
 * Stage 2 block 11 step 4 is the case to watch: the script plays
 * `COMMON\GRASS1_22.WAV`, the glass, and then spawns two `zstin` in this state
 * so that they arrive through the broken window. Stage 2 block 5 step 6 is the
 * other shape — two `zsass` at y = 87 whose descriptors name the street at
 * y = 37, fifty units down over thirty frames.
 *
 * The port used to integrate a velocity here and play **no clip at all**, so
 * the actor slid through the air in whatever pose it was already in and
 * arrived with no footfall. The arc script is what the state is for.
 *
 * Three more things the state does, and each was missing with it:
 *
 * * **`obj+0x34` bit `0x100` is raised for the duration** — `OR CH, 1` at
 *   `0x0044E4E3` and `AND AH, 0xFE` at `0x0044E5B2`. A class-0x31 actor cannot
 *   be shot while it is coming through the glass.
 * * **`ThrowerFlag.TrackBone2` is cleared on entry and set on landing**, which
 *   is what points `SkeletonEmitNode` at bone 2 for the camera.
 * * **A `rand()` draw**, whose two outcomes are byte-identical scripts. It is
 *   taken anyway: a draw the port skips shifts the shared stream for
 *   everything after it, which is `L46`'s other half.
 *
 * When the arc and its landing clip are both over the actor drops into state
 * 7, which stands and decides.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { ActorFlag, ThrowerFlag, type Actor } from "../actor";
import { vec3 } from "../vec";
import {
  ActorArcBegin, ActorArcStep, ArcPhase, InstallArcMotionScript,
} from "./arc";
import { ThrowerArcScript } from "./tables";
import { ThrowerState } from "./states";

const _dest = vec3();

/**
 * `PlaySoundId(0x2916A9)` at `0x0044E58E` — `COMMON\ENE_WALK6_22.WAV`, the
 * footfall on the frame the arc settles.
 */
export const SND_LEAP_LANDED = 0x2916a9;

/**
 * The character type with a script of its own: `zskamere.bin`.
 *
 * `CMP word ptr [ESI + 0x1F4], 0x17` at `0x0044E50D`. Its script is motion
 * 439 cut at 0..19, 20..31 and 32..42; every other type takes motion 300 cut
 * at 50..55, 56..63 and 64..98.
 */
export const LEAP_TO_POINT_OWN_SCRIPT_TYPE = 0x17;

/**
 * `[port-only]` — which of the three arc scripts this actor leaps on.
 *
 * The engine spells the choice inline at `0x0044E50D`..`0x0044E53D`; it is a
 * function here so a test can assert the character-type arm without driving a
 * whole leap.
 *
 * `drop` and `drop_alt` are **byte for byte the same twelve dwords** — the
 * coin flip between them changes nothing that can be heard or seen, and it is
 * made because the engine makes it.
 */
export function LeapToPointScriptName(obj: Actor, rng: Rng): string {
  if (obj.charType === LEAP_TO_POINT_OWN_SCRIPT_TYPE) return "drop_zskamere";
  return rng.int(2) ? "drop" : "drop_alt";
}

export function ThrowerStateLeapToPoint(obj: Actor, dt: number, rng: Rng,
                                        events?: Events): void {
  const leap = obj.leap;
  if (!leap) {
    obj.state = ThrowerState.StandAndDecide;
    obj.sub = 0;
    return;
  }
  if (obj.sub === 0) {
    obj.flags |= ActorFlag.ShotImmune;
    _dest.x = leap.dest[0];
    _dest.y = leap.dest[1];
    _dest.z = leap.dest[2];
    ActorArcBegin(obj, _dest, leap.frames);
    InstallArcMotionScript(obj, ThrowerArcScript(LeapToPointScriptName(obj, rng)));
    obj.flags2 &= ~ThrowerFlag.TrackBone2;
    obj.sub = 1;
    obj.arcPhase = ArcPhase.Windup;
    // No `return`: `0x0044E562` falls straight into the arm below, so the
    // first frame of the state is also the first frame of the arc.
  }
  // The footfall, once, on the frame the arc settles — which is before the
  // landing clip has finished, so it is not the state's exit.
  if (obj.arcPhase === ArcPhase.Settled
      && !(obj.flags2 & ThrowerFlag.TrackBone2)) {
    obj.flags2 |= ThrowerFlag.TrackBone2;
    events?.emit("sound.play", { id: SND_LEAP_LANDED });
  }
  if (ActorArcStep(obj, 1, dt)) return;
  obj.state = ThrowerState.StandAndDecide;
  obj.flags &= ~ActorFlag.ShotImmune;
  obj.sub = 0;
}
