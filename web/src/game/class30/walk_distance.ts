/**
 * `ZombieStateWalkDistance` — `FUN_00457220`, class 0x30 state 15.
 *
 * **The scripted entrance, and the commonest one after the attack run.** The
 * actor remembers where it started, plays its run clip, and keeps walking on
 * the yaw its spawn record gave it until the 2D distance from that point
 * reaches the float at descriptor tail `+0x04` — three to thirty units, all
 * fifty of them exact integers. Only then does it set state 1 and start
 * closing on the camera.
 *
 * It is the difference between an enemy that arrives along the path the level
 * was built for and one that beelines at you from the moment it appears. The
 * port had no state 15 at all: `ZombieEntryState` folded it into `AttackRun`,
 * so every one of these fifty spawns turned to face the camera on its first
 * frame and walked the straight line to it — through whatever the level had
 * drawn in between. Stage 2 block 16 step 3's lone zombie and stage 4 block 2
 * step 8's three are all state 15, and all four were reported walking through
 * a wall.
 *
 * **Nothing here would have stopped them, either.** The engine's collision at
 * stage 2 block 16 step 3 is one blob — `coli2.bin:4656`, fourteen quads of
 * flat water at `y = -25` — and the wall in that shot has no collision
 * anywhere in `coli`. The walls a level *draws* are mostly not walls the
 * engine can feel: what keeps an enemy out of them is the entrance the script
 * gave it, not a push.
 *
 * The state does not move the actor. `SkeletonApplyRootMotion` does, out of
 * the clip — see `game/root_motion.ts` — and this only measures.
 */
import type { Rng } from "../../core/rng";
import { ActorFlag, type ZombieActor } from "../actor";
import { ActorDespawn } from "../despawn";
import { ReleaseAttackSlot } from "../combat/permits";
import { ReleaseEnemyAliveCount, ReleaseEnemyPresentCount }
  from "../combat/counts";
import { FirstBakedOf, MotionRowOf } from "../tables";
import { ZombieSetMotionIfIdle } from "./motion_cue";
import { MotionFade, MotionRow, ZombieRunMotion, ZombieState } from "./states";

/**
 * `ZombieReleaseAndDespawn` — `FUN_00455490`. Free the permit, leave both
 * counts, and go.
 *
 * All three, in the engine's order: `ReleaseEnemyAliveCount`,
 * `ReleaseEnemyPresentCount`, `ReleaseAttackSlot`, then the array clear and
 * `ActorDespawn`. The counter half used to be dropped here, because the port
 * derived `g_enemies_alive` from the pool instead of stepping it; it does not
 * any more — see `combat/counts.ts`.
 *
 * [open] No shipped spawn reaches the state-15 arm: it is the
 * `obj+0x34 & 0x20000000` branch, set on three class-0x31 spawn records and on
 * no class-0x30 one. `ZombieStateStandAndThrow` reaches it, though, and
 * `ZombieStateScriptedGrabAndDespawn` ends in it.
 */
export function ZombieReleaseAndDespawn(obj: ZombieActor): void {
  ReleaseEnemyAliveCount(obj);
  ReleaseEnemyPresentCount(obj);
  ReleaseAttackSlot(obj);
  ActorDespawn(obj);
}

export function ZombieStateWalkDistance(obj: ZombieActor, rng: Rng): void {
  // The engine's own shape: sub 0 latches the distance and falls *through*
  // into sub 1's arm, so the start point is recorded on the same frame. Only
  // sub 2 skips straight to the walk.
  if (obj.sub === 0) {
    // `obj+0x1370 = *(f32 *)(obj+0x1390 + 4)`. The field is shared with
    // `ZombieStateWalkToTarget`'s arrive radius; a spawn has one initial
    // state, so the two never overlap.
    obj.zom.targetArrive = obj.walkDistance;
    obj.sub = 1;
  }
  if (obj.sub !== 2) {
    obj.sub += 1;
    // `obj+0x13C0/C4/C8 = obj+0x40/44/48` — the same three words the two
    // ballistic entrances use as the point an arc began from.
    obj.arcFrom.x = obj.pos.x;
    obj.arcFrom.y = obj.pos.y;
    obj.arcFrom.z = obj.pos.z;
  }

  const row = MotionRowOf(obj);
  // `row[2 + ((obj+0x34 >> 0x1B) & 1)]` normally, `row[4]` when bit
  // 0x20000000 is set — the same pair `ZombieStateAttackRun` picks between,
  // and the same fallback for a skeleton with no run clip of its own.
  //
  // [diverges] The engine selects Run vs RunAlt on `obj+0x34` bit 27, which is
  // the spawn record's own flags word — `SpawnFromDescriptor` does
  // `obj+0x34 = spawn.flags | 1` — and 141 class-0x30 spawns set it. The port
  // does not carry that word onto the actor at all, so this takes whichever
  // variant the bundle bakes. See `ZombieStateAttackRun`, which has the same
  // gap.
  const motion = (obj.flags & ActorFlag.BackingOff)
    ? FirstBakedOf(obj, row, MotionRow.BackAway)
    : ZombieRunMotion(obj, row) ?? FirstBakedOf(obj, row,
                            MotionRow.Run, MotionRow.RunAlt,
                   MotionRow.Walk, MotionRow.WalkAlt);
  ZombieSetMotionIfIdle(obj, motion, rng, "clip", MotionFade.Quick);

  // 2D, on x and z: `obj+0x1374` is the distance travelled, and the engine
  // keeps it even though nothing else reads it back.
  const dx = obj.arcFrom.x - obj.pos.x;
  const dz = obj.arcFrom.z - obj.pos.z;
  obj.zom.walkTravelled = Math.sqrt(dx * dx + dz * dz);
  if (obj.zom.targetArrive > obj.zom.walkTravelled) return;

  obj.strikeStart.x = obj.pos.x;
  obj.strikeStart.y = obj.pos.y;
  obj.strikeStart.z = obj.pos.z;
  if (obj.flags & ActorFlag.BackingOff) {
    ZombieReleaseAndDespawn(obj);
    return;
  }
  obj.state = ZombieState.AttackRun;
  obj.sub = 0;
}
