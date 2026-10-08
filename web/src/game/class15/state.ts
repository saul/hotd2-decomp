/**
 * Class 0x15's per-object words, at the offsets the engine keeps them.
 *
 * `FloatingPropRowSpawn` (`FUN_00441750`) allocates each plank with
 * `ActorAllocRaw(0x34)` at `obj+0x1310` and fills it; `FloatingPropUpdate`
 * (`FUN_004418C0`) reads and steps it. Data only, so the exporter and the
 * renderer can read the shape without importing the class registry.
 */
import { vec3, type Vec3 } from "../vec";

/**
 * Which routine `obj+0x00` holds. `[port-only]` as an enum: the engine
 * stores a code address there, and a snapshot cannot hold one.
 */
export enum FloatingPropRoutine {
  /**
   * `FloatingPropRowSpawn` -- the handler `SpawnFromDescriptorSmall`
   * (`FUN_00408BC0`) installs from `g_class_handlers`, which builds the row
   * and kills itself the first time it runs.
   */
  RowSpawn = 0,
  /** `FloatingPropUpdate` -- what `ActorAlloc` installs in each plank. */
  Plank = 1,
}

/** The block at `obj+0x1310`, and the two object words the update reads. */
export interface FloatingPropTail {
  routine: FloatingPropRoutine;
  /**
   * `obj+0x3C` -- the plank's index in its row, `N - 1` for the first
   * allocated down to 0. Read only by the kill arm's `(N - i) % 3` (L3: the
   * word is a hit slot, a cel phase or a motion id in other classes).
   */
  rowIndex: number;
  /** `obj+0x1F4`, s16 -- the asset slot the update draws. */
  slot: number;
  /** `sub+0x00` -- the `g_prop_behaviours` entry it calls, by index. */
  behaviour: number;
  /**
   * `sub+0x04`, s16 -- frames the plank waits once its flag is up before it
   * leaves; -1 for a plank that never leaves on the flag.
   */
  delay: number;
  /** `sub+0x06`, `sub+0x08` -- the camera path and frame that kill it. */
  camPath: number;
  camFrame: number;
  /** `sub+0x0A`, `sub+0x0C` -- copied from the tail; nothing reads them. */
  word0A: number;
  word0C: number;
  /** `sub+0x0E` -- the `g_script_flags` byte that starts the delay. */
  flag: number;
  /** `sub+0x10` -- the pushed tilt, BAMS, about {@link tiltAxis}. */
  tiltBams: number;
  /** `sub+0x14..+0x1C` -- its axis; `sub+0x18` is always written 0. */
  tiltAxis: Vec3;
  /** `sub+0x20`, f32 -- how far the plank is pressed into the water. */
  sink: number;
  /** `sub+0x24` -- a foot contact pressed it this frame. */
  pressed: number;
  /** `sub+0x28` -- the swing's tilt amplitude once released, BAMS. */
  swingBams: number;
  /** `sub+0x2C`, f32 -- the swing's sink amplitude. */
  swingSink: number;
  /** `sub+0x30` -- the swing's phase, BAMS, `+0x400` a frame. */
  swingPhase: number;
}

/**
 * `[port-only]` -- the block before anything writes it. `ActorAllocRaw` does
 * not zero, and the Init writes every word the update reads before it is
 * read except `sub+0x14..+0x1C` and `sub+0x30`: the axis is read only while
 * `sub+0x10` is non-zero, which only a write of the axis beside it makes so,
 * and the phase only feeds stores gated on `sub+0x28`/`sub+0x2C`, which are
 * zero until the release that also zeroes the phase. So no value here is
 * observable before the routine has written its own.
 */
export function makeFloatingPropTail(): FloatingPropTail {
  return {
    routine: FloatingPropRoutine.RowSpawn, rowIndex: 0, slot: 0,
    behaviour: 0, delay: 0, camPath: 0, camFrame: 0, word0A: 0, word0C: 0,
    flag: 0, tiltBams: 0, tiltAxis: vec3(), sink: 0, pressed: 0,
    swingBams: 0, swingSink: 0, swingPhase: 0,
  };
}
