/**
 * Class 0x33's sub-handler selector and the words selector 1 keeps, apart from
 * the class module so `actor.ts` can name them without importing the class —
 * the arrangement classes 0x14, 0x20, 0x24, 0x25 and 0x52 have, and for the
 * reason `registry.ts` records: an ESM cycle that resolves a table to
 * `undefined` has cost this project three separate hours.
 */

/**
 * `obj+0x11C`, as `ScriptedSceneryDispatch33` (`FUN_00432FF0`) switches on it.
 *
 * `MOVSX ECX, word ptr [EAX + 0x11C]` / `DEC ECX` / `CMP ECX, 0x62` at
 * `0x00432FF4`, so the switch runs 1..0x63 through the byte table at
 * `0x004330F8` and the jump table at `0x004330C4`. Twelve arms are reachable:
 * 1 to 11 and 99. **`obj+0x11C` is not hit points here** — it is the raw `s16`
 * at `desc+0x22` that `SpawnFromDescriptor` (`FUN_00408A20`) copies in before
 * any `Init` runs, and the class reads it as a selector. That is `L3`, and it
 * has already caught someone on this class.
 *
 * Only the three the port has read are members. The other nine are, by the
 * dispatch's own jump table:
 *
 * ```
 * 3  -> 0x00433AC0    6  -> 0x00433E30    9  -> 0x00434100
 * 5  -> 0x00433B00    7  -> 0x00433E90   10  -> 0x00433F40
 *                     8  -> 0x00433FE0   11  -> 0x00434260
 *                                        99  -> 0x00433160
 * ```
 *
 * `docs/formats/spawns.md` records what three of those are; none of them is
 * read here and none has a module.
 */
export enum ScriptedScenerySelector {
  /**
   * `ScriptedCarrierUpdate33` (`FUN_004331D0`) — the object
   * `g_carrier_object` points at. **Ported.** Three shipped spawns.
   */
  Carrier = 1,
  /**
   * `ScriptedPropDrawUntilFlag` (`FUN_00433A10`) — a static prop drawn until
   * a camera frame or a script flag. Ten shipped spawns, and they already
   * reach the player through the bundle's `props`, so this class gives them
   * no second behaviour.
   */
  DrawUntilFlag = 2,
  /**
   * `ScriptedPushableUpdate33` (`FUN_00433B70`) — a piece of scenery an actor
   * shoves out of its way. **Ported**, in `class33/pushable.ts`. Two shipped
   * spawns, both stage 1's chairs.
   */
  Pushable = 4,
}

/**
 * The words `ScriptedCarrierUpdate33` (`FUN_004331D0`) and
 * `ScriptedCarrierStepPath33` (`FUN_00433860`) keep on the object.
 *
 * Every one of them is polymorphic — class 0x30 reads `obj+0x1334` as its
 * back-off counter and `obj+0x1370` as a walk distance — so they are this
 * class's own arm of the union rather than fields on the head. `L3`.
 */
export interface ScriptedSceneryTail {
  /**
   * `obj+0x1370` — the cursor into the `op_` path, and the value both of the
   * update's frame cues are compared against.
   *
   * Seeded to `g_cam_path_frame - 1` on the first frame the mover runs and
   * stepped by exactly `1.0` per frame afterwards, so it is **not** the
   * camera's frame: `FADD float ptr [0x004C4380]` at `0x00433931`.
   */
  pathFrame: number;      // +0x1370
  /** `obj+0x1374` — `tail+0x10`, the cursor value that stops the ride. */
  pathEnd: number;        // +0x1374
  /** `obj+0x1350` — `tail+0x0C`, the `op_` slot `CamEvalObjectPath6` reads. */
  pathSlot: number;       // +0x1350
  /** `obj+0x13F0` — `tail+0x00`, the `AssetDrawSlot` id. */
  slot: number;           // +0x13F0
  /**
   * `obj+0x1334` — frames since the effect fired.
   *
   * Zeroed on the frame `obj+0x34` bit `0x40000000` goes up and counted from
   * there; at exactly `0x14` the update raises bit `0x200000`. It is the same
   * word `ZombieStateDelayedStrikeInPlace` counts on **its own** object, which
   * is a different actor.
   */
  effectFrames: number;   // +0x1334
}

/**
 * [port-only] The zero every class-0x33 actor starts from.
 *
 * `ScriptedCarrierStepPath33` fills all of it on its first frame; before then
 * the engine's words are whatever the pool held, and this is that written out.
 */
export function makeScriptedSceneryTail(): ScriptedSceneryTail {
  return { pathFrame: 0, pathEnd: 0, pathSlot: -1, slot: 0, effectFrames: 0 };
}
