/**
 * The sprite effect: one asset-slot flipbook, put in the world and left to
 * run out.
 *
 * `SpawnSpriteEffectFromParams` (`FUN_004073B0`) is the whole of it, and
 * thirty-seven call sites reach it through the marshalling wrapper
 * `SpawnSpriteEffect` (`FUN_00407340`). It allocates one object, gives it a
 * position, a facing and a **slot range** taken from a switch on the kind, and
 * `SpriteEffectDrawAndTick` (`FUN_00407A70`) then draws one asset slot a frame
 * and kills the object when the cursor passes the last one. So a sprite effect
 * is a 60 Hz flipbook whose length is `last - first + 1`, and there is no
 * texture animation anywhere in it: **every frame is a different model.**
 *
 * The kind is the same number as the collision material for the five surface
 * cases, which is why one switch serves both the ricochet off a wall and the
 * splash off water. The table itself is not repeated here — the exporter reads
 * it out of the same switch into `combat.impact_sprite`, and this file is the
 * behaviour around it.
 *
 * ## Where the scale comes from, and why it is fixed at spawn
 *
 * The kind gives a base scale. Then, unless the caller passed an override at
 * `params[6]`, the routine measures the spawn point in the camera's own space
 * and, for anything nearer than fifteen units, **replaces** the base scale
 * with `-z * 0.0667` floored at 0.25 — it does not multiply. Water's base of
 * 4.0 is gone the moment the splash is close enough to see. Kind 0x53 has its
 * own law out to thirty-five units and kind 0x63 is exempt.
 *
 * This is done once, at spawn, so an effect does not resize as the camera
 * moves. That is a fact about the engine and not a shortcut: the draw routine
 * reads `+0x50` and never recomputes it.
 */
import type { Events } from "../../core/events";
import type { GameHost } from "../host";
import { G } from "../globals";
import { T } from "../tables";
import { vec3, type Vec3 } from "../vec";

/**
 * The kinds the shot path can produce.
 *
 * The engine's switch has thirty-one arms and the five collision materials are
 * the ones a bullet reaches; the rest belong to bosses, water and the Original
 * Mode weapons, and are listed in `docs/formats/combat.md` rather than given
 * names here. `SpawnSpriteEffectFromParams` takes a plain number, because the
 * material arriving from `g_coli_hit_surface` is one.
 */
export enum SpriteEffectKind {
  /** `PlayImpactSoundForMaterial` (`FUN_00407950`) calls this one sand. */
  Sand = 1,
  Metal = 2,
  Other = 3,
  Water = 5,
  Wood = 6,
  /** The same five again, with 0x32 added. Both arms share a slot range. */
  SandAlt = 0x33,
  MetalAlt = 0x34,
  OtherAlt = 0x35,
  WaterAlt = 0x37,
  WoodAlt = 0x38,
  /** `ActorShotFeedback`'s ricochet for character type 3. */
  NoEffectType3 = 0x51,
  /** `ThrownWeaponDeflected` (`FUN_00450050`) — the same range as `Other`. */
  DeflectedWeapon = 0x52,
  /**
   * The Original Mode blast `MarkActorShot` (`FUN_00404DB0`) adds for weapon
   * kind 3. Seeds a random roll, and takes the 35-unit scale law.
   */
  OriginalBlast = 0x53,
  /** Exempt from the distance scale law altogether. */
  BigSand = 0x63,
}

/**
 * The twelve floats `SpawnSpriteEffect` builds and
 * `SpawnSpriteEffectFromParams` reads.
 *
 * Named rather than an array because the engine's own callers leave holes in
 * it: `ActorShotFeedback` hands over three floats of bone position and lets
 * `params[3..5]` be whatever was on the stack, which is safe **only** because
 * it also passes `faceCamera`, and that arm overwrites `params[3]` and
 * `params[4]` before either is read. `params[5]` is copied into a local and
 * never used by anything.
 */
export interface SpriteEffectParams {
  pos: Vec3;
  /** `params[3]` and `params[4]`, in BAMS. Overwritten when `faceCamera`. */
  pitch: number;
  yaw: number;
  /** `params[6..8]`. `null` is the routine's `-1.0`: take the kind's own. */
  scale: Vec3 | null;
  /** `params[9]`. */
  kind: number;
  /**
   * `params[10]`. Non-zero re-aims the sprite at `g_camera_block_eye`; the
   * value **2** additionally zeroes the pitch, leaving a yaw-only billboard.
   */
  faceCamera: number;
  /** `params[11]`. Carried, and read by nothing in the routine. */
  player: number;
}

/** One live effect. Plain data: it goes into a snapshot as it is. */
export interface SpriteEffect {
  /** `[port-only]` — the engine's identity is the task pointer. */
  id: number;
  /** `+0x5C`. */
  kind: number;
  /** `+0x38`, `+0x3C`, `+0x40` — world space. */
  pos: Vec3;
  /** `+0x44`, `+0x48`, `+0x4C` — pitch, yaw, roll in BAMS. */
  pitch: number;
  yaw: number;
  roll: number;
  /** `+0x50`, `+0x54`, `+0x58`. All three are always the same number. */
  scale: Vec3;
  /** `+0x60` — the asset slot being drawn, and the cursor. */
  slot: number;
  /** `+0x64` — the last slot; past it the object kills itself. */
  lastSlot: number;
}

/** `+0x50` for a kind the switch does not name. */
const DEFAULT_SLOT = 0x904;
const DEFAULT_SCALE = 0.1;

/** The distance law, from the tail of `SpawnSpriteEffectFromParams`. */
const NEAR_RANGE = -15.0;
const NEAR_RATE = -0.0667;
const NEAR_FLOOR = 0.25;
/** Kind 0x53 has its own, four times further out. */
const BLAST_RANGE = -35.0;
const BLAST_RATE = -0.028571429;
const BLAST_CLAMP = -0.001;

/** `+0x4C` — three of the boss kinds start half-turned. */
const BOSS_ROLL = 0xc000;

/**
 * `SpawnSpriteEffect` — `FUN_00407340`.
 *
 * Marshals a position and a facing into the parameter block, with `-1.0` at
 * `params[6]` for "no scale override", and calls the body. It is a separate
 * function in the exe with thirty-seven callers, so it is a separate function
 * here.
 */
export function SpawnSpriteEffect(pos: Vec3, pitch: number, yaw: number,
                                  kind: number, faceCamera: number,
                                  player: number, host?: GameHost,
                                  events?: Events): void {
  SpawnSpriteEffectFromParams({
    pos, pitch, yaw, scale: null, kind, faceCamera, player,
  }, host, events);
}

/**
 * `SpawnSpriteEffectFromParams` — `FUN_004073B0`.
 *
 * One object, one slot range, one scale. `host` is optional because the scale
 * law is the only part that needs a camera, and a headless run legitimately
 * has none — it then keeps the kind's base scale, which is what the engine
 * uses past fifteen units anyway.
 */
export function SpawnSpriteEffectFromParams(p: SpriteEffectParams,
                                            host?: GameHost,
                                            events?: Events): void {
  let pitch = p.pitch;
  let yaw = p.yaw;
  if (p.faceCamera !== 0 && host) {
    // The engine aims the sprite back along the line to `g_camera_block_eye`.
    // `viewPoint(0, 0, 0)` is that eye in world coordinates, which is the one
    // camera fact this file needs beyond the depth.
    const eye = vec3();
    host.viewPoint(0, 0, 0, eye);
    const a = AnglesToward(eye.x - p.pos.x, eye.y - p.pos.y, eye.z - p.pos.z);
    pitch = p.faceCamera === 2 ? 0 : a.pitch;
    yaw = a.yaw;
  }

  const range = SlotRangeForKind(p.kind);
  const e: SpriteEffect = {
    id: G.g_sprite_effect_seq++,
    kind: p.kind,
    pos: vec3(p.pos.x, p.pos.y, p.pos.z),
    pitch, yaw,
    roll: BOSS_ROLL_KINDS.has(p.kind) ? BOSS_ROLL : 0,
    scale: vec3(range[2], range[2], range[2]),
    slot: range[0],
    lastSlot: range[1],
  };

  if (p.scale) {
    e.scale.x = p.scale.x;
    e.scale.y = p.scale.y;
    e.scale.z = p.scale.z;
  } else {
    ApplyDistanceScale(e, host);
  }
  G.g_sprite_effects.push(e);

  // Kind 0x5A is three effects, not one: it keeps its own range and then
  // recurses for 0x5B and 0x5C at the same point. The recursion happens
  // BEFORE the scale law in the engine, and every arm ends in the same sound,
  // so the blast plays three of them.
  for (const extra of RECURSE_KINDS[p.kind] ?? []) {
    SpawnSpriteEffectFromParams({ ...p, kind: extra }, host, events);
  }

  // The last line of the routine, and the reason a shot into a wall makes the
  // wall's own noise: the sprite plays its own ricochet rather than the caller
  // doing it. Every one of the thirty-seven call sites relies on that.
  PlayImpactSoundForMaterial(p.kind, events);
}

/**
 * `PlayImpactSoundForMaterial` — `FUN_00407950`.
 *
 * Collision material to ricochet sound. The filenames the ids resolve to are
 * what named the materials in the first place: 1 sand, 2 metal, 3 other,
 * 5 water, 6 wood. A kind with no row makes no sound.
 */
export function PlayImpactSoundForMaterial(kind: number,
                                           events?: Events): void {
  const s = T.chars?.combat?.ricochet?.[String(kind)];
  if (s) events?.emit("sound.play", { id: s.id });
}

/** The kinds whose arm seeds `+0x4C` with a half turn. */
const BOSS_ROLL_KINDS: ReadonlySet<number> = new Set([0x5a, 0x5b, 0x5c]);
/** Kind 0x5A spawns two more of itself before it returns. */
const RECURSE_KINDS: Readonly<Record<number, number[]>> = { 0x5a: [0x5b, 0x5c] };

/**
 * `[port-only]` The switch's arms, read out of the bundle rather than repeated
 * here. `combat.impact_sprite` is the exporter's copy of the same switch, and
 * `impact_sprite_default` its default arm.
 */
function SlotRangeForKind(kind: number): [number, number, number] {
  const c = T.chars?.combat;
  const hit = c?.impact_sprite?.[String(kind)];
  if (hit) return hit;
  return c?.impact_sprite_default ?? [DEFAULT_SLOT, DEFAULT_SLOT, DEFAULT_SCALE];
}

/**
 * The tail of `SpawnSpriteEffectFromParams`: the base scale is **replaced**,
 * not multiplied, for an effect close to the camera.
 */
function ApplyDistanceScale(e: SpriteEffect, host?: GameHost): void {
  if (e.kind === SpriteEffectKind.BigSand) return;
  const v = vec3();
  if (!host?.viewSpaceOfPoint?.(e.pos, v)) return;
  let k: number;
  if (e.kind === SpriteEffectKind.OriginalBlast) {
    if (v.z <= BLAST_RANGE) return;
    k = Math.abs(Math.min(v.z, BLAST_CLAMP) * BLAST_RATE);
  } else {
    if (v.z <= NEAR_RANGE) return;
    k = Math.max(v.z * NEAR_RATE, NEAR_FLOOR);
  }
  e.scale.x = e.scale.y = e.scale.z = k;
}

/**
 * `FUN_004016B0` — a direction to the pitch and yaw that point along it.
 *
 * `[port-only]` in name only: the engine's routine writes through two int
 * pointers and is used by five callers in this file's neighbourhood. The yaw
 * comes from `atan2(x, z)` and the pitch from `atan2(y, horizontal)`, with the
 * horizontal recovered through whichever of sine and cosine is furthest from
 * zero — which is the whole reason the routine is not two `atan2` calls.
 */
export function AnglesToward(x: number, y: number, z: number):
    { pitch: number; yaw: number } {
  const BAMS = 65536 / (Math.PI * 2);
  const yaw = Math.round(Math.atan2(x, z) * BAMS) | 0;
  const horiz = ((yaw + 0x2000) & 0x4000) === 0
    ? z / Math.cos(yaw / BAMS)
    : x / Math.sin(yaw / BAMS);
  const pitch = -(Math.round(Math.atan2(y, horiz) * BAMS) | 0);
  return { pitch, yaw };
}

/**
 * `[port-only]` — the state half of `SpriteEffectDrawAndTick`
 * (`FUN_00407A70`).
 *
 * [diverges] in shape, not in behaviour: the engine's routine draws and then
 * steps, in one function, because a task is its own renderer. `game/` may not
 * draw, so the cursor step is here and `render/effects.ts` draws whatever the
 * cursor is pointing at. Nothing else in the routine is state.
 *
 * Returns false once the cursor has passed the last slot.
 */
export function SpriteEffectTick(e: SpriteEffect): boolean {
  e.slot += 1;
  return e.slot <= e.lastSlot;
}

/** `[port-only]` — the pool step the engine gets from its task list. */
export function SpriteEffectsTick(): void {
  const live = G.g_sprite_effects;
  if (!live.length) return;
  G.g_sprite_effects = live.filter((e) => SpriteEffectTick(e));
}

/**
 * `SpawnPropHitSpark` — `FUN_00465860`, with its per-frame body at
 * `FUN_00465950`.
 *
 * The spark a breakable prop makes. Its own object type in the engine rather
 * than a sprite effect — no kind switch, no sound, no distance law — but the
 * same flipbook shape, so it is one of these records with the range written
 * out. `FUN_00465950` steps the cursor **before** it draws, so the slot it
 * starts from is never seen and the first drawn frame is `0x905`.
 *
 * ## Where it goes, which is not where the blood goes
 *
 * `x` and `y` are the **crosshair**, unprojected to the prop's own camera
 * depth: this is the one effect in the shot path that lands where the shot
 * was aimed rather than at the middle of what it hit. Then `z` is overwritten
 * outright with the prop's `obj+0x1A4`.
 *
 * `[proved]` that `obj+0x1A4` is the prop's world z: `FUN_0046F350` writes the
 * literal `0xC4044F9E` into it, which is -529.244, and that is the third
 * component of the fixed world point the same prop type registers for the shot
 * test. Six class-0x41 routines write world-scale negative literals there and
 * nothing else does.
 */
export function SpawnPropHitSpark(x: number, y: number, z: number): void {
  G.g_sprite_effects.push({
    id: G.g_sprite_effect_seq++,
    kind: PROP_SPARK_KIND,
    pos: vec3(x, y, z),
    pitch: 0, yaw: 0, roll: 0,
    scale: vec3(1, 1, 1),
    slot: PROP_SPARK_FIRST_SLOT,
    lastSlot: PROP_SPARK_LAST_SLOT,
  });
}

/**
 * `[port-only]` — the spark is not a kind in the engine's switch at all, so
 * this number names it for the renderer and matches nothing in
 * `combat.impact_sprite`. It billboards and it makes no sound.
 */
export const PROP_SPARK_KIND = -1;
/** `+0x48` starts at 0x904 and steps before the first draw. */
export const PROP_SPARK_FIRST_SLOT = 0x905;
/** `if (0x919 < +0x48) kill` — the last frame of the wood strip. */
export const PROP_SPARK_LAST_SLOT = 0x919;
