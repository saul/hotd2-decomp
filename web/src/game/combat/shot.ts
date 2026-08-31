/**
 * What a bullet does to an actor that is **not** shot per bone.
 *
 * `ShotTestSphere` (`FUN_00404630`) is the fork. It tests a sphere at the
 * actor's registered point with radius `obj+0x124`, and only descends into the
 * skeleton — `ShotTestSkeleton` (`FUN_00404700`) — when `obj+0x34` bit `0x80`
 * is set and the character has bones. A class-0x10 civilian never has that bit:
 * none of the 136 command streams raises it. So a civilian is a ten-unit ball
 * with no hit table, no damage and no gore, and the hit does not go through
 * `ResolveHit` at all.
 *
 * What it goes through instead is this: the sort picks the nearest candidate
 * and marks it, and the actor's own update decides what being marked means.
 * For a civilian that is a life, two hundred points and the on-shot script.
 */
import { ActorFlag, type Actor } from "../actor";

/**
 * `MarkActorShot` — `FUN_00404DB0`.
 *
 * `obj+0x34 |= (1 << (player + 1)) | 8`. Bit 3 says a hit is pending; bits 1
 * and 2 say which player fired, and the class reads them back to decide who
 * pays. `obj+0x190 + player` also takes the bone, which is why the same
 * function serves the skeleton path.
 *
 * [diverges] The engine's version also runs the blood effect and, in Original
 * Mode, the item-drop test. Neither is state, and both are the renderer's.
 */
export function MarkActorShot(obj: Actor, player: number, bone = 0): void {
  obj.flags |= (1 << ((player + 1) & 0x1f)) | ActorFlag.Hit;
  obj.pendingHit = { bone, result: 0 };
}
