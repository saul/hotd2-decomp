/**
 * `g_entity_lights` — 0x009A1A20 — the record, apart from the routines that
 * fill it (`scene_lights.ts`).
 *
 * Its own module because `globals.ts` builds the initial array and
 * `scene_lights.ts` reads `G`: with the maker there, the two would import each
 * other and whichever loaded second would find the count still in its
 * temporal dead zone.
 */
import type { Vec3 } from "./vec";

/** `D3DLIGHTTYPE`, the values `g_entity_lights` entries carry at `+0x00`. */
export enum RenderLightType {
  Point = 1,
  Spot = 2,
  Directional = 3,
}

/**
 * One `g_entity_lights` entry — a `D3DLIGHT7` and the two words after it.
 * Stride `0x74`; the light is the first `0x68` bytes.
 */
export interface EntityLight {
  type: RenderLightType;      // +0x00
  diffuse: [number, number, number]; // +0x04
  pos: Vec3;                  // +0x34
  dir: Vec3;                  // +0x40
  range: number;              // +0x4C
  falloff: number;            // +0x50
  att0: number;               // +0x54
  att1: number;               // +0x58
  att2: number;               // +0x5C
  /** Full cone angles, radians, as D3D takes them. */
  theta: number;              // +0x60
  phi: number;                // +0x64
  enabled: boolean;           // +0x68
}

/** Sixteen entries — `SceneLightArrayUpdate` walks all of them. */
export const ENTITY_LIGHT_COUNT = 16;
/**
 * `SceneLightArrayInit`'s value for one entry: zeroed, falloff 1.
 * [port-only] The loop inside `SceneLightArrayInit` (`FUN_004809D0`), lifted
 * out so `globals.ts` can build the array without importing the routines.
 */
export function makeEntityLight(): EntityLight {
  return {
    type: 0 as RenderLightType, diffuse: [0, 0, 0],
    pos: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: 0 },
    range: 0, falloff: 1, att0: 0, att1: 0, att2: 0, theta: 0, phi: 0,
    enabled: false,
  };
}

/** [port-only] All sixteen, as `SceneLightArrayInit`'s loop leaves them. */
export function makeEntityLights(): EntityLight[] {
  return Array.from({ length: ENTITY_LIGHT_COUNT }, makeEntityLight);
}

