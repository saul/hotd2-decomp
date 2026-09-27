/**
 * `g_enemy_slots` — who the camera is allowed to look at — and the candidate
 * list it is filled from.
 *
 * Three pieces, each a routine of its own, and **none of them a filter over the
 * object pool**:
 *
 * * `RegisterForCameraTracking` (`FUN_00408EC0`) is a *call* an object's own
 *   update makes. It appends `{|obj - g_camera_eye| * 10, obj}` to the
 *   candidate list unless the object carries bit `0x10000` or the list holds
 *   fourteen. `ActorRegisterCameraPoint` (`FUN_00409B70`, `camera/track.ts`)
 *   ends with it; the owl, the bats, the fish, the horde and the carried props
 *   call it directly.
 * * `UpdateCameraEnemySlots` (`FUN_00408DD0`) is a **task**, allocated by
 *   `ResetCameraEnemySlots` (`FUN_00408D90`) twelfth in the scene's list and so
 *   walked before every actor. It sorts the candidates the actors registered on
 *   the *previous* frame, clears all sixteen slots and deals them out: an
 *   object holding an attack permit takes the first free of slots 0 and 1, and
 *   anything else takes slot `rank + 2`. Then the list is emptied.
 * * `RegisterEnemySlot` (`FUN_00408E80`) is the other way into the table:
 *   eleven `Init`s and three updates put their object straight into the first
 *   free slot from 2, bypassing the sort, until the next fill clears it.
 *
 * So the table has **holes** -- slot 2 is empty whenever the nearest
 * candidate holds a permit -- and the camera drivers read slots 0..3 by index
 * (`SelectCameraLookAtTarget`, `CameraDriverSelectMode`,
 * `CameraDriverFromDeferredPose`). The port used to keep a compacted list of
 * actors filled after the actors had run; both halves of that were the port's
 * own. `[proved]` for every clause above: see the three routines' rows in
 * `ghidra/annotations/functions.tsv`.
 */
import { ActorFlag, type Actor } from "../actor";
import { ActorByAt, G } from "../globals";
import { CAMERA_ATTACK_SLOTS, CAMERA_MAX_CANDIDATES, CAMERA_SLOTS,
         CAMERA_TRACK_DISTANCE_SCALE } from "./constants";
import { dist3d, type Vec3 } from "../vec";
import { makeCameraSlots, type CameraCandidate } from "./slot_table";

export { makeCameraSlots, type CameraCandidate, type CameraSlot }
  from "./slot_table";

/**
 * `ResetCameraEnemySlots` — `FUN_00408D90`. The candidate list, its count and
 * the sixteen slots, emptied.
 *
 * The routine also allocates the {@link UpdateCameraEnemySlots} task; the
 * port's task is its fixed place in `SceneTaskWalk`, so what is left here is
 * the clear.
 */
export function ResetCameraEnemySlots(): void {
  G.g_camera_candidates = [];
  G.g_camera_candidate_count = 0;
  G.g_enemy_slots = makeCameraSlots();
}

/** `ftol(|obj - g_camera_eye| * 10)`, the key `RegisterForCameraTracking` files. */
function CameraCandidateKey(pos: Vec3): number {
  return Math.trunc(dist3d(pos, G.g_camera_eye) * CAMERA_TRACK_DISTANCE_SCALE);
}

/**
 * `RegisterForCameraTracking` — `FUN_00408EC0`. The whole routine:
 *
 * ```c
 * if (!(obj+0x34 & 0x10000) && g_camera_candidate_count < 0xE) {
 *     g_camera_candidates[count] = { ftol(|obj+0x40 - g_camera_eye| * 10), obj };
 *     g_camera_candidate_count++;
 * }
 * ```
 *
 * No class test and no dead test: those are the callers' business, and a
 * caller that should not be tracked either does not call or raises the bit.
 * `[proved]` (`0x00408EC6`..`0x00408F27`).
 */
export function RegisterForCameraTracking(obj: Actor): void {
  if (obj.flags & ActorFlag.NoCameraTrack) return;
  if (G.g_camera_candidate_count >= CAMERA_MAX_CANDIDATES) return;
  G.g_camera_candidates.push({ key: CameraCandidateKey(obj.pos),
                               at: obj.at, prop: null });
  G.g_camera_candidate_count += 1;
}

/**
 * The same routine, called on a carried prop -- `CarriedPropRelease`,
 * `CarriedPropThrowAtCamera`, `CarriedPropRollAtCamera` and
 * `CarriedPropStuckToScreen` all make it. `[port-only]` as a second function
 * only because the port's props are not {@link Actor}s.
 */
export function RegisterPropForCameraTracking(id: number, flags: number,
                                              pos: Vec3): void {
  if (flags & ActorFlag.NoCameraTrack) return;
  if (G.g_camera_candidate_count >= CAMERA_MAX_CANDIDATES) return;
  G.g_camera_candidates.push({ key: CameraCandidateKey(pos), at: 0, prop: id });
  G.g_camera_candidate_count += 1;
}

/**
 * `SortCameraCandidates` — `FUN_00408F30`. An LSD radix sort, two 8-bit
 * passes, over the low sixteen bits of each key: stable, ascending, so two
 * candidates on one key keep the order they registered in. A key at or past
 * 65536 -- 6.5 km -- wraps, exactly as the engine's does.
 */
export function SortCameraCandidates(): void {
  const c = G.g_camera_candidates;
  for (let shift = 0; shift < 16; shift += 8) {
    const buckets: CameraCandidate[][] = Array.from({ length: 256 }, () => []);
    for (const e of c) buckets[(e.key >>> shift) & 0xff].push(e);
    let i = 0;
    for (const b of buckets) for (const e of b) c[i++] = e;
  }
}

/**
 * `UpdateCameraEnemySlots` — `FUN_00408DD0`. The frame's slot table, from the
 * candidates registered since the last call.
 *
 * ```c
 * SortCameraCandidates();
 * for (i = 0; i < 16; i++) g_enemy_slots[i] = {0, NULL};
 * for (rank = 0; rank < g_camera_candidate_count; rank++) {
 *     obj = g_camera_candidates[rank].obj;
 *     if (obj+0x121 != 0xFF) {                      // holds a permit
 *         for (s = 0; s < 2; s++) if (!slots[s].occupied) {
 *             slots[s] = {1, obj}; obj+0x120 = s; break;
 *         }                                         // both taken: nowhere
 *     } else {
 *         slots[rank + 2] = {1, obj}; obj+0x120 = rank + 2;
 *     }
 * }
 * g_camera_candidate_count = 0;
 * ```
 *
 * `[proved]` from `0x00408DD0`..`0x00408E7D`. It does **not** touch
 * `g_camera_is_tracking`; `CameraActorTick` seeds that and
 * `SelectCameraLookAtTarget` clears it.
 *
 * `[open]` A carried prop's `obj+0x121` is `0xFF` -- `CarriedPropInit` and
 * `CarriedPropDrop` write it (`0x00442808`, `0x00442B75`) -- so the engine
 * deals a prop slot `rank + 2`, and the camera then reads the prop's
 * `obj+0x100`, which nothing read so far writes. The port keeps the rank (so
 * the actors behind it get the slots the engine gives them) and leaves the
 * prop's own slot empty, which is the same gap `g_body_creatures` names.
 */
export function UpdateCameraEnemySlots(): void {
  SortCameraCandidates();
  const slots = makeCameraSlots();
  const cand = G.g_camera_candidates;
  for (let rank = 0; rank < G.g_camera_candidate_count && rank < cand.length;
       rank++) {
    const e = cand[rank];
    if (e.prop !== null) continue;
    const obj = ActorByAt(e.at);
    if (!obj) continue;
    if (obj.attackPermit !== -1) {
      for (let s = 0; s < CAMERA_ATTACK_SLOTS; s++) {
        if (slots[s].occupied) continue;
        slots[s].occupied = 1;
        slots[s].at = obj.at;
        obj.cameraSlot = s;
        break;
      }
    } else {
      const s = rank + CAMERA_ATTACK_SLOTS;
      slots[s].occupied = 1;
      slots[s].at = obj.at;
      obj.cameraSlot = s;
    }
  }
  G.g_enemy_slots = slots;
  G.g_camera_candidates = [];
  G.g_camera_candidate_count = 0;
}

/**
 * `RegisterEnemySlot` — `FUN_00408E80`. Straight into the first free slot
 * from 2 to 13, with no sort and no candidate entry; `obj+0x120` is `0xFF`
 * when all twelve are taken. It lasts until the next
 * {@link UpdateCameraEnemySlots} clears the table. `[proved]`
 */
export function RegisterEnemySlot(obj: Actor): void {
  obj.cameraSlot = -1;
  for (let s = CAMERA_ATTACK_SLOTS; s < CAMERA_SLOTS - 2; s++) {
    const slot = G.g_enemy_slots[s];
    if (!slot || slot.occupied) continue;
    obj.cameraSlot = s;
    slot.occupied = 1;
    slot.at = obj.at;
    return;
  }
}

/**
 * `ReleaseCameraEnemySlot` — `FUN_004092B0`: `g_enemy_slots[obj+0x120]` freed
 * and `obj+0x120 = 0xFF`.
 */
export function ReleaseCameraEnemySlot(obj: Actor): void {
  const slot = obj.cameraSlot >= 0 ? G.g_enemy_slots[obj.cameraSlot] : undefined;
  if (slot) slot.occupied = 0;
  obj.cameraSlot = -1;
}

/**
 * `[port-only]` -- the expression the death paths inline, written once:
 *
 * ```c
 * if (obj+0x120 != -1) g_enemy_slots[obj+0x120 * 8] = 0;
 * ```
 *
 * The occupied byte alone, and `obj+0x120` left as it was: a stale index
 * clears whatever the last fill put there, which the engine does too.
 */
export function CameraSlotVacate(obj: Actor): void {
  const slot = obj.cameraSlot >= 0 ? G.g_enemy_slots[obj.cameraSlot] : undefined;
  if (slot) slot.occupied = 0;
}

/**
 * The actor in slot `i`, if the slot is occupied and the actor still exists.
 * `[port-only]`: the engine dereferences the pointer.
 */
export function CameraSlotActor(i: number): Actor | undefined {
  const slot = G.g_enemy_slots[i];
  return slot && slot.occupied ? ActorByAt(slot.at) : undefined;
}

/**
 * The walk `CameraDriverSelectMode` (`0x00402654`) and
 * `CameraDriverFromDeferredPose` (`0x00402E07`) both inline: is any of the
 * **first four** slots occupied? `[port-only]` as a function.
 */
export function CameraSlotsBusy(): boolean {
  for (let i = 0; i < 4; i++) if (G.g_enemy_slots[i]?.occupied) return true;
  return false;
}

/** Whether `obj` sits in an occupied slot. `[port-only]`, for tests and the UI. */
export function CameraSlotHolds(at: number): boolean {
  return G.g_enemy_slots.some((s) => s.occupied !== 0 && s.at === at);
}
