/**
 * `BatSplashUpdate` (`FUN_0042F930`)'s draw -- the water a shot bat falls
 * into.
 *
 * ```c
 * MatrixStackPush(0);
 * MatrixTranslate(obj+0x38, obj+0x3C, obj+0x40);
 * AssetDrawSlot(obj+0x44 + 0x1339);
 * MatrixStackPop(1);
 * ```
 *
 * A translation and nothing else, in the world: no billboard, no scale. The
 * slot is the frame the routine drew this tick, which `game/class46/splash.ts`
 * leaves on the record, so a seek or a load draws whatever the restored
 * record says and the layer holds nothing of its own.
 *
 * The models are `pol/common.bin` 307..336, carried in the bundle's
 * `slots_effect` rig for any stage that places class 0x46
 * (`EFFECT_SLOTS_BY_CLASS` in `hod2lib/bundle.ts`).
 */
import type { Group, Object3D } from "three";
import { G } from "../game/globals";
import { BAT_SPLASH_FIRST_SLOT } from "../game/class46/splash";

/** What this needs of the effect layer. */
export interface BatSplashHost {
  /** A node for `key` at `slot` under `parent`, re-cloned when the slot moves. */
  node(key: string, slot: number, parent: Group): Object3D | null;
  /** World-space effects. */
  world: Group;
}

/** One node per live splash, at the slot its update drew. */
export function drawBatSplashes(host: BatSplashHost, seen: Set<string>): void {
  for (const s of G.g_bat_splashes) {
    if (s.drawn < 0) continue;
    const key = `bsp${s.id}`;
    const node = host.node(key, BAT_SPLASH_FIRST_SLOT + s.drawn, host.world);
    if (!node) continue;
    seen.add(key);
    node.position.set(s.x, s.y, s.z);
    node.quaternion.identity();
    node.scale.setScalar(1);
  }
}
