/**
 * Stage 2 block 0x19's sheet: the thing the first three members crawl under.
 *
 * `SpawnHordeDeformedProp` (`FUN_0043EF70`) is called by `HordeMemberInit`
 * for formation 2's member 0 alone. It lays a `0x1AC`-byte object half a unit
 * above that member, which waits for its model (`HordeDeformedPropAwaitModel`,
 * `FUN_0043EFE0`) and then, every frame, draws `komono_room.bin` part 2 (slot
 * `0x10CF`) at its point **after rewriting the model's vertices**
 * (`HordeDeformedPropUpdate`, `FUN_0043F010`): each vertex within five units
 * (in x and z) of one of `g_horde_members[0..2]` is lifted by a half-sine of
 * that distance, 1.2 at the most, and every other vertex is laid flat -- so
 * the sheet bulges over each of the three as it moves. `FUN_0043F2E0` then
 * rebuilds the face normals and `FUN_0043F3E0` the vertex normals.
 *
 * What is here is what decides anything: the object, its lifetime in step
 * changes, and whether the reshape runs this frame. The reshape itself is
 * arithmetic over the model's vertices and the three members' positions, and
 * it is `render/horde.ts`'s -- the vertices are three.js's, and the only state
 * it reads is the members', which the port already keeps.
 */
import type { Actor } from "../actor";
import { ActorDespawn } from "../despawn";
import { G } from "../globals";
import { ActorSpawn } from "../spawn";
import { SpawnClass } from "../spawn_class";
import { HordeEffectAt } from "./splash";
import { HordeKind, type HordeTail } from "./state";

/** `+0x198 = obj+0x44 + 0.5`: laid half a unit above member 0. */
export const HORDE_SHEET_LIFT = 0.5;
/** Past the third step change it goes, and past the first it stops moving. */
export const HORDE_SHEET_LIFETIME = 3;
export const HORDE_SHEET_FREEZE_AFTER = 1;
/** `obj+0x34 | 0x4000000` -- the reshape stops; the sheet keeps its shape. */
export const HORDE_SHEET_FROZEN = 0x4000000;
/** Camera path 0x40 between these frames, and path 0x47, pause the reshape. */
export const HORDE_SHEET_PAUSE_PATH = 0x40;
export const HORDE_SHEET_PAUSE_FROM = 0x10c;
export const HORDE_SHEET_PAUSE_TO = 0x168;
export const HORDE_SHEET_FREEZE_PATH = 0x47;

function Tail(obj: Actor): HordeTail | null {
  return (obj as Actor & { horde?: HordeTail }).horde ?? null;
}

/**
 * `SpawnHordeDeformedProp` — `FUN_0043EF70`. `(member)`.
 *
 * `+0x194..0x19C` = the member's position, `y + 0.5`; `obj+0x120 = 0xFF`;
 * `obj+0x34 = 1`; `+0x1A4` = the low byte of `g_evt_step_index`,
 * `+0x1A5 = +0x1A6 = 0`. The routine it installs waits for the model.
 */
export function SpawnHordeDeformedProp(member: Actor): Actor | null {
  const obj = ActorSpawn(HordeEffectAt(), SpawnClass.HordeSpawner, -1,
                         "horde deformed prop", { visible: true });
  const t = Tail(obj);
  if (!t) return null;
  t.kind = HordeKind.SheetAwait;
  t.propX = member.pos.x;
  t.propY = member.pos.y + HORDE_SHEET_LIFT;
  t.propZ = member.pos.z;
  obj.flags = 1;
  t.seenStep = (G.g_evt_step_index << 24) >> 24;
  t.stepChanges = 0;
  return obj;
}

/**
 * `HordeDeformedPropAwaitModel` — `FUN_0043EFE0`.
 *
 * Waits for `0x009B739C` bit `0x8000` -- the asset flag its model's load
 * raises -- then builds the model's vertex map (`BuildCharacterPartVertexMap`
 * over the mesh-info block at `0x0055E580`) and installs
 * `HordeDeformedPropUpdate`.
 *
 * `[port-only]` The port has no asynchronous model load in `game/`: the bundle
 * is whole before the first frame, so the flag is up on the first frame the
 * engine would test it, and the vertex map is the renderer's. One frame of
 * waiting, then the update -- which is what the engine does with a model that
 * is already loaded.
 */
export function HordeDeformedPropAwaitModel(obj: Actor): void {
  const t = Tail(obj);
  if (!t) return;
  t.kind = HordeKind.Sheet;
}

/**
 * `HordeDeformedPropUpdate` — `FUN_0043F010`, the half that is state.
 *
 * Counts changes of `g_evt_step_index` against the byte it keeps: past the
 * third it `ActorKill`s itself, and past the first it raises `obj+0x34` bit
 * `0x4000000`, which stops the reshape for good -- the sheet keeps whatever
 * shape it had. Otherwise the reshape runs unless camera path 0x47 is playing
 * or path 0x40 is between frames 0x10C and 0x168; `t.drawn` says whether it
 * does this frame, for `render/horde.ts` to act on. The sheet itself is drawn
 * every frame either way.
 */
export function HordeDeformedPropUpdate(obj: Actor): void {
  const t = Tail(obj);
  if (!t) return;
  const step = (G.g_evt_step_index << 16) >> 16;
  if (step !== t.seenStep) {
    t.stepChanges += 1;
    if (t.stepChanges > HORDE_SHEET_LIFETIME) {
      ActorDespawn(obj);
      return;
    }
    t.seenStep = (G.g_evt_step_index << 24) >> 24;
    if (t.stepChanges > HORDE_SHEET_FREEZE_AFTER) {
      obj.flags |= HORDE_SHEET_FROZEN;
    }
  }
  const cam = G.g_active_cam_path;
  const paused = cam === HORDE_SHEET_FREEZE_PATH
    || (cam === HORDE_SHEET_PAUSE_PATH
        && G.g_cam_path_frame >= HORDE_SHEET_PAUSE_FROM
        && G.g_cam_path_frame <= HORDE_SHEET_PAUSE_TO);
  t.drawn = !(obj.flags & HORDE_SHEET_FROZEN) && !paused;
}
