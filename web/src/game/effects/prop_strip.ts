/**
 * The slot-strip effect object — a flipbook of asset slots at a fixed pose.
 *
 * `SpawnPropStripEffect` (`FUN_0043FCA0`) allocates a 0x1314 object running
 * `PropStripEffectUpdate` (`FUN_0043FBC0`) and a 0x1C-byte block at
 * `obj+0x1310`, and picks the strip by a kind switch:
 *
 * | kind | slots | sound |
 * |---|---|---|
 * | 0 | `0x1339`..`0x1356` | `0x4116A9` `COMMON\SIBUKI2_16.WAV` |
 * | 1 | `0x16E1`..`0x172F` | `0x4116A9` |
 * | 2 | `0x0DD7`..`0x0E22` | — |
 * | 3 | `0x174A`..`0x1785` | — |
 *
 * Ten callers — class 0x13's selector-1 carrier at its bow, five class-0x14
 * boss states, `ZombieStateTargetMotionScript` and two unnamed routines. Only
 * the carrier's is wired here; the others are the port's to add when their
 * callers are read, and each will need its strip in the bundle.
 *
 * ```c
 * // PropStripEffectUpdate
 * if (sub->delay == 0) { if (++obj->+0x1F4 > sub->last) { ActorDespawn(obj); return; } }
 * else if (--sub->delay == 0) { obj->+0x1F4 = sub->first; sub->behaviour = NoOpStub; }
 * sub->behaviour(obj);
 * Push; Translate(pos); RotX(+0x64); RotZ(+0x6C); RotY(+0x68);
 * if (sub->scale != 1.0) Scale(sub->scale); AssetDrawSlot(obj->+0x1F4); Pop;
 * ```
 *
 * Every kind seeds `delay = 1` and `+0x1F4 = first`, so the strip's first slot
 * is drawn on the object's first frame and every slot once, then it goes.
 * The draw is `render/slotmodels.ts`'.
 */
import type { Events } from "../../core/events";
import { G } from "../globals";
import { vec3, type Vec3 } from "../vec";

/** The strips `SpawnPropStripEffect`'s switch names. */
export enum PropStripKind {
  Kind0 = 0,
  Kind1 = 1,
  Kind2 = 2,
  /** The one class 0x13's carrier spawns off its bow at path frame 0x550. */
  CarrierBow = 3,
}

/** `[first, last, sound or 0]` per kind — the switch's own literals. */
export const PROP_STRIP_KINDS: Readonly<Record<PropStripKind,
  readonly [number, number, number]>> = {
  [PropStripKind.Kind0]: [0x1339, 0x1356, 0x4116a9],
  [PropStripKind.Kind1]: [0x16e1, 0x172f, 0x4116a9],
  [PropStripKind.Kind2]: [0x0dd7, 0x0e22, 0],
  [PropStripKind.CarrierBow]: [0x174a, 0x1785, 0],
};

/** One live strip. Plain data, so it goes into a snapshot as it is. */
export interface PropStripEffect {
  /** `[port-only]` — the engine's identity is the task pointer. */
  id: number;
  /** `+0x40`/`+0x44`/`+0x48`, world space. */
  pos: Vec3;
  /** `+0x64`/`+0x68`/`+0x6C`, BAMS. */
  pitch: number;
  yaw: number;
  roll: number;
  /** `obj+0x1F4` — the slot drawn, and the cursor. */
  slot: number;
  /** `sub+0x04` — frames before the strip starts. */
  delay: number;
  /** `sub+0x0A`, `sub+0x0C` — the strip. */
  first: number;
  last: number;
  /** `sub+0x10` — a uniform scale; the draw skips `MatrixScale` at 1.0. */
  scale: number;
}

/**
 * `SpawnPropStripEffect` — `FUN_0043FCA0`. `params` is the six-word pose the
 * callers build: position, then pitch, yaw and roll in BAMS.
 */
export function SpawnPropStripEffect(
    params: { pos: Vec3; pitch: number; yaw: number; roll: number },
    kind: PropStripKind, scale: number, events?: Events): void {
  const [first, last, sound] = PROP_STRIP_KINDS[kind];
  G.g_prop_strip_effects.push({
    id: G.g_prop_strip_effect_seq++,
    pos: vec3(params.pos.x, params.pos.y, params.pos.z),
    pitch: params.pitch, yaw: params.yaw, roll: params.roll,
    slot: first, delay: 1, first, last, scale,
  });
  if (sound) events?.emit("sound.play", { id: sound });
}

/**
 * `PropStripEffectUpdate` — `FUN_0043FBC0`. Returns false when the object
 * despawns. The behaviour it calls is `NoOpStub` for every kind.
 */
export function PropStripEffectUpdate(e: PropStripEffect): boolean {
  if (e.delay === 0) {
    e.slot += 1;
    if (e.slot > e.last) return false;
  } else {
    e.delay -= 1;
    if (e.delay === 0) e.slot = e.first;
  }
  return true;
}

/** `[port-only]` — walk the pool, as `SpriteEffectsTick` does its own. */
export function PropStripEffectsTick(): void {
  const live = G.g_prop_strip_effects;
  if (!live.length) return;
  G.g_prop_strip_effects = live.filter((e) => PropStripEffectUpdate(e));
}
