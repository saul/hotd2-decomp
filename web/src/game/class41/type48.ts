/**
 * Class 0x41 type 48 — a hanging lamp that owns a flickering point light, and
 * bursts when shot.
 *
 * Built by its own constructor, `PlaceFlickerLightProp48` (`FUN_00463B20`),
 * not by `PlaceGenericProp`, so the exporter emits it as its own container
 * (`flicker_light`). One shipped spawn: stage 2 block 26 step 1, evt
 * `0x11EF0`, at `(-450, 12.7, -1330.3)` with a two-step lifetime, inside the
 * stretch stage 2 turns the scene light array on for (block 26 step 0 op 19).
 *
 * The light is an entry of `g_entity_lights` the prop claims with
 * `EntityLightAcquireSlot` and gives back with `EntityLightReleaseSlot`; it
 * reaches the screen the way the gun lights do — `SceneLightArrayUpdate`
 * submits every enabled entry, and only surfaces that draw through the array
 * are lit by it. `render/gunlights.ts` draws it; `render/breakables.ts` draws
 * the models.
 *
 * Every constant is from the disassembly (`L1`): `1.5` at `0x004C4CB8`,
 * `0.01` at `0x004D5464` and `0x004C4CC0`, `0.2` at `0x004D1D24`, `0.01` and
 * `0.02` as doubles at `0x0055D190` / `0x0055D188`, `0.02722` at
 * `0x0055CB10`, `2.0` at `0x004E30F0`, `1.2` at `0x00564708`, and the
 * `MOV dword` immediates `0x41A00000` (20), `0x41700000` (15), `0x3E19999A`
 * (0.15), `0x44800000` (1024), `0x40400000` (3). The shot registration
 * (`0x0046E151`..`0x0046E1A9`) and the tail of the debris loop lie outside
 * the body Ghidra gives the function (`L35`); the decompile shows neither and
 * reads as though the broken lamp's model were not drawn while the pieces
 * fall, which the disassembly contradicts.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { G } from "../globals";
import { RenderLightType } from "../entity_light";
import { BAMS } from "../vec";
import { MsvcRand } from "./group";
import { ActorKillProp, BreakablePropAwardHit } from "./prop";
import { PropRegisterForShotTest } from "./shot_test";
import {
  BreakableFlag, BreakableState, PropFamily, makeBreakableProp,
  type BreakableProp, type FlickerDebris,
} from "./prop_state";

/** `g_class41_constructors` index. */
export const FLICKER_LIGHT_TYPE = 48;
/** `obj+0x34 |= 0x40000000` — broken. The routine's own latch. */
export const FLICKER_BROKEN = 0x40000000;
/** `obj+0x124 = 3.0`. */
export const FLICKER_RADIUS = 3.0;
/** The whole lamp, drawn at `(x, y + 2, z)` scale 3. */
export const FLICKER_SLOT_WHOLE = 0x17ac;
/** The broken one, at `(x, y, z)` scale 2. */
export const FLICKER_SLOT_BROKEN = 0x17ad;
/** Debris piece `i` draws `0xCA5 + i`, scale 0.5. */
export const FLICKER_SLOT_DEBRIS = 0xca5;
export const FLICKER_DEBRIS_COUNT = 30;
export const FLICKER_WHOLE_RISE = 2.0;
export const FLICKER_WHOLE_SCALE = 3.0;
export const FLICKER_BROKEN_SCALE = 2.0;
export const FLICKER_DEBRIS_SCALE = 0.5;
/** Frames the pieces fly and the light fades before it goes out. */
export const FLICKER_FADE_FRAMES = 0x5a;
/** `COMMON\...` `0x2B16A9`, the burst. */
export const SFX_FLICKER_BREAK = 0x2b16a9;

const SHOT_DROP = 1.2;
const DEBRIS_DROP = 1.5;
const DEBRIS_GRAVITY = 0.02722;
const PHASE_STEP = 0x800;
const DEBRIS_ANGLE_STEP = 0x888;

/** The light's constant part, `+0x04..+0x5C` of the entry. */
const LIGHT_DIFFUSE: [number, number, number] = [20, 20, 15];
const LIGHT_RANGE = 1024;
const LIGHT_ATT0 = 0.15;
const LIGHT_ATT2_BASE = 0.02;
const LIGHT_ATT2_SPAN = 0.01;

/**
 * `EntityLightAcquireSlot` — `FUN_00480A60`. The first free entry from 3 up;
 * entries 1 and 2 are the gun lights and are never handed out. 0 if none.
 */
export function EntityLightAcquireSlot(): number {
  for (let i = 3; i < G.g_entity_lights.length; i++) {
    const e = G.g_entity_lights[i];
    if (!e.inUse) { e.inUse = true; return i; }
  }
  return 0;
}

/** `EntityLightReleaseSlot` — `FUN_00480AA0`. */
export function EntityLightReleaseSlot(i: number): void {
  const e = G.g_entity_lights[i];
  if (e) e.inUse = false;
}

/** A placement as the bundle carries it. */
export interface FlickerLightPlacement {
  at: number;
  lifetime_evt_steps: number;
  pos?: [number, number, number];
  yaw?: number;
}

/**
 * `PlaceFlickerLightProp48` — `FUN_00463B20`. Lifetime from the placer's
 * `+0x11C`, position and yaw from its `+0x40..0x48` and `+0x68`, radius 3,
 * a light slot claimed.
 */
export function PlaceFlickerLightProp48(pl: FlickerLightPlacement,
                                        x: number, y: number, z: number,
                                        yaw: number): BreakableProp {
  const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  p.family = PropFamily.Type48;
  p.at = pl.at;
  p.kind = FLICKER_LIGHT_TYPE;
  p.state = BreakableState.Standing;
  p.flags = 0x80000000 | BreakableFlag.Live;
  p.lastStepIndex = G.g_evt_step_index;
  p.stepsElapsed = 0;
  p.lifetime = pl.lifetime_evt_steps;
  p.x = x; p.y = y; p.z = z;
  p.yaw = yaw;
  p.hitRadius = FLICKER_RADIUS;
  p.flicker = {
    lightSlot: EntityLightAcquireSlot(), phase: 0, brokenFrames: 0,
    debris: [],
  };
  return p;
}

/** The part of the entry both arms write, then the one word that differs. */
function WriteFlickerLight(p: BreakableProp, att2: number): void {
  const e = G.g_entity_lights[p.flicker!.lightSlot];
  if (!e) return;
  e.enabled = true;
  e.type = RenderLightType.Point;
  e.pos.x = p.x; e.pos.y = p.y; e.pos.z = p.z;
  e.diffuse = [...LIGHT_DIFFUSE];
  e.att0 = LIGHT_ATT0;
  e.att1 = 0;
  e.range = LIGHT_RANGE;
  e.att2 = att2;
}

/**
 * `PropUpdateType48FlickerLight` — `FUN_0046DDE0`. One lamp, one frame.
 *
 * ```
 * on a step change: if (++count > lifetime) { light off; release; ActorKill; }
 * if (hit && !broken) { award; sound; broken = 1; frames = 0; seed 30 pieces }
 * if (!broken) {
 *     light on, att2 = 0.02 + 0.01 * sin((phase & 0x7FFF) BAMS); phase += 0x800;
 *     draw 0x17AC at (x, y+2, z) RotY scale 3; register (x, y-1.2, z);
 * } else {
 *     light on, att2 = 0.02 + 0.01 * frames; frames++;
 *     if (frames < 90) step and draw the pieces; else light off;
 *     draw 0x17AD at (x, y, z) RotY scale 2;
 * }
 * ```
 */
export function PropUpdateType48FlickerLight(p: BreakableProp, rng: Rng,
                                             events?: Events): void {
  const f = p.flicker;
  if (!f) return;
  if (G.g_evt_step_index !== p.lastStepIndex) {
    p.stepsElapsed += 1;
    if (p.lifetime < p.stepsElapsed) {
      const e = G.g_entity_lights[f.lightSlot];
      if (e) e.enabled = false;
      EntityLightReleaseSlot(f.lightSlot);
      ActorKillProp(p);
      return;
    }
    p.lastStepIndex = G.g_evt_step_index;
  }

  if ((p.flags & BreakableFlag.Hit) !== 0 && (p.flags & FLICKER_BROKEN) === 0) {
    BreakablePropAwardHit(p.flags, true, rng);
    events?.emit("sound.play", { id: SFX_FLICKER_BREAK });
    p.flags |= FLICKER_BROKEN;
    f.brokenFrames = 0;
    f.debris = [];
    for (let k = 0; k < FLICKER_DEBRIS_COUNT * DEBRIS_ANGLE_STEP;
         k += DEBRIS_ANGLE_STEP) {
      const s16 = (v: number) => (v << 16) >> 16;
      const d: FlickerDebris = {
        x: p.x, y: p.y - DEBRIS_DROP, z: p.z,
        rx: s16(MsvcRand(rng)), ry: s16(MsvcRand(rng)), rz: s16(MsvcRand(rng)),
        vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0,
      };
      const sn = Math.sin((MsvcRand(rng) % 0x201 + k) / BAMS);
      d.vx = (MsvcRand(rng) % 0x1a) * 0.01 * sn;
      d.vy = (MsvcRand(rng) % 0x1f) * 0.01 + 0.2;
      const cs = Math.cos((MsvcRand(rng) % 0x201 + k) / BAMS);
      d.vz = (MsvcRand(rng) % 0x1a) * 0.01 * cs;
      d.wx = MsvcRand(rng) % 0x401 - 0x200;
      d.wy = MsvcRand(rng) % 0x401 - 0x200;
      d.wz = MsvcRand(rng) % 0x401 - 0x200;
      f.debris.push(d);
    }
  }

  if ((p.flags & FLICKER_BROKEN) === 0) {
    WriteFlickerLight(p, Math.sin((f.phase & 0x7fff) / BAMS) * LIGHT_ATT2_SPAN
      + LIGHT_ATT2_BASE);
    f.phase += PHASE_STEP;
    PropRegisterForShotTest(p, p.x, p.y - SHOT_DROP, p.z);
    return;
  }
  WriteFlickerLight(p, f.brokenFrames * 0.01 + LIGHT_ATT2_BASE);
  f.brokenFrames += 1;
  if (f.brokenFrames >= FLICKER_FADE_FRAMES) {
    const e = G.g_entity_lights[f.lightSlot];
    if (e) e.enabled = false;
    return;
  }
  for (const d of f.debris) {
    d.vy -= DEBRIS_GRAVITY;
    d.x += d.vx; d.y += d.vy; d.z += d.vz;
    d.rx = ((d.rx + d.wx) << 16) >> 16;
    d.ry = ((d.ry + d.wy) << 16) >> 16;
    d.rz = ((d.rz + d.wz) << 16) >> 16;
  }
}
