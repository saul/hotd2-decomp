/**
 * Class 0x16 -- **the water-wave field**, and the one routine that reads it.
 *
 * `WaterFieldCreate` (`FUN_00442290`) is the class's whole handler: it points
 * `g_water_wave_field` (`0x007DCC4C`) at a fresh 0x2C-byte block with no
 * sources and the spawn's own `y` as its plane, and `ActorKill`s itself.
 * Class 0x17's spawns then hang wave sources in it (`game/class17/`), and
 * `WaterFieldSampleHeight` (`FUN_00442390`) is the surface height at a point:
 * the plane plus every live source's wave.
 *
 * Four shipped spawns, all stage 2's boss blocks: 35 and 39 at
 * `y = -25.5007` with two sources after them, 37 and 41 at `y = -25.0` with
 * none. Stage 5's cameo places none, and its boss never summons. Its readers
 * are all class 0x14's: the two summoning rounds seat each fish under the
 * surface this returns, `Class14StateScriptedBreak` stands the boss on it, and
 * the deaths ride it.
 */
import { CountFlag, type Actor } from "../actor";
import { ActorDespawn } from "../despawn";
import { G } from "../globals";
import { registerClass, type ClassHandler } from "../registry";
import { SpawnClass } from "../spawn_class";
import type { Vec3 } from "../vec";
import { WaveEvalCircular, WaveEvalTravelling } from "../class17";
import { WAVE_FIELD_SLOTS, WaveSourceKind } from "./state";

/**
 * `WaterFieldCreate` — `FUN_00442290`.
 *
 * ```c
 * g_water_wave_field = ActorAllocRaw(0x2C);
 * g_water_wave_field[1] = 0;  g_water_wave_field[0] = 0;
 * g_water_wave_field[2] = obj+0x44;
 * ActorKill();
 * ```
 *
 * The slot array is not cleared -- `ActorAllocRaw` does not zero -- and it
 * does not need to be: the mask says which slots hold a source, and the
 * sampler reads no slot the mask does not name.
 */
export function WaterFieldCreate(obj: Actor): void {
  G.g_water_wave_field = {
    count: 0, mask: 0, planeY: Math.fround(obj.pos.y),
    sources: new Array(WAVE_FIELD_SLOTS).fill(null),
  };
  // `ActorKill` -- the spawn never joined either enemy count.
  obj.flags38 |= CountFlag.LeftAlive | CountFlag.LeftPresent;
  ActorDespawn(obj);
}

/**
 * `WaterFieldSampleHeight` — `FUN_00442390`. The surface at `p`:
 *
 * ```
 * 0044239C  FLD [field+8]; FST float [ESP+0x10]      ; h = plane
 * for (i = 0, seen = 0; i < 8; i++) {
 *     004423AE  CMP EBX, [field]; JGE return          ; seen >= count
 *     004423BB  TEST [field+4], 1 << i; JZ next
 *     004423C7  CALL [src+0x34](src, p)               ; e
 *     004423CA  FADD float [ESP+0x18]; FST float      ; h = e + h
 *     seen++
 * }
 * return ST0
 * ```
 *
 * The running sum is stored as a float after every source and the value
 * returned is the last sum **before** that rounding, which is what the port
 * returns too. A source that has not ticked has no eval and is not counted,
 * so the `seen >= count` test stops the walk before reaching it.
 */
export function WaterFieldSampleHeight(p: Vec3): number {
  const field = G.g_water_wave_field;
  // [port-only] The engine dereferences the pointer unconditionally. No
  // shipped block reaches a sampler without a field -- stage 5's boss is the
  // only class-0x14 spawn with none, and none of its states samples -- so
  // this is a guard against a port state the game cannot enter, not a value
  // the game has.
  if (!field) return 0;
  let h = field.planeY;
  let ret = h;
  let seen = 0;
  for (let i = 0; i < WAVE_FIELD_SLOTS; i++) {
    if (seen >= field.count) return ret;
    if ((field.mask & (1 << i)) === 0) continue;
    const src = field.sources[i];
    const e = !src || src.evalKind === null ? 0
      : src.evalKind === WaveSourceKind.Circular
        ? WaveEvalCircular(src, p) : WaveEvalTravelling(src, p);
    ret = e + h;
    h = Math.fround(ret);
    seen += 1;
  }
  return ret;
}

const handler: ClassHandler = {
  init: WaterFieldCreate,
  update: () => {},
  debug: () => ({ summary: "wave field" }),
};

registerClass(SpawnClass.WaterWaveField, handler);
