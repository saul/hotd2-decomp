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
 * Every reachable arm is read and is a member. `class33/cues.ts` has the
 * four of 6 to 11 that draw nothing (6, 7, 10, 11) and `class33/strips.ts`
 * the three that do (8, 9, 99).
 */
export enum ScriptedScenerySelector {
  /**
   * `ScriptedCarrierUpdate33` (`FUN_004331D0`) — the object
   * `g_carrier_object` points at. **Ported.** Three shipped spawns.
   */
  Carrier = 1,
  /**
   * `ScriptedPropDrawUntilFlag` (`FUN_00433A10`) — one model drawn at the
   * object's own pose until block 0's camera frame equals `tail+0x0C` or the
   * script flag at `tail+0x11` reads 1, then a despawn. **Ported**, in
   * `class33/draw_until_flag.ts`. Fifty-six shipped spawns over ten
   * descriptors, stage 1's and stage 2's.
   */
  DrawUntilFlag = 2,
  /**
   * `ScriptedEffectOnFirstFrame33` (`FUN_00433AC0`) — one sprite of kind
   * 0x62 thrown at the object's own position, facing the camera, on its first
   * update, and a despawn. Reads no tail. **Ported**, in
   * `class33/effect_first_frame.ts`. Fourteen shipped spawns, stage 1's
   * block 4 and stage 2's blocks 9 and 16.
   */
  EffectOnFirstFrame = 3,
  /**
   * `ScriptedPushableUpdate33` (`FUN_00433B70`) — a piece of scenery an actor
   * shoves out of its way. **Ported**, in `class33/pushable.ts`. Two shipped
   * spawns, both stage 1's chairs.
   */
  Pushable = 4,
  /**
   * `ScriptedEffectAtCameraCue33` (`FUN_00433B00`) — a sprite effect that goes
   * off when the camera reaches a frame, and nothing else: no draw, no sphere,
   * no state. **Ported**, in `class33/effect_cue.ts`. One shipped spawn,
   * stage 2's `0x12568`.
   */
  EffectAtCameraCue = 5,
  /**
   * `ScriptedSpriteEffectOnce33` (`FUN_00433E30`) — one sprite effect from
   * the object's own position and facing, kind, mode and player from the
   * tail, then a despawn. **Ported**, in `class33/cues.ts`. No shipped spawn.
   */
  SpriteEffectOnce = 6,
  /**
   * `ScriptedSoundCues33` (`FUN_00433E90`) — a list of sounds, each on a frame
   * count or a camera frame. **Ported**, in `class33/cues.ts`. One shipped
   * spawn, stage 5 block 2's tyres and brakes.
   */
  SoundCues = 7,
  /**
   * `ScriptedBridgeCrashStrip33` (`FUN_00433FE0`) — `BRIDGE_CRASH1_22` and the
   * sixty models of `eff_shop.bin`, one a frame. **Ported**, in
   * `class33/strips.ts`. One shipped spawn, stage 5 block 7.
   */
  BridgeCrashStrip = 8,
  /**
   * `ScriptedFireLoopUntilCue33` (`FUN_00434100`) — `CAR_FIRE_22` and the
   * fire loop until a cue. **Ported**, in `class33/strips.ts`. One shipped
   * spawn, stage 5 block 7.
   */
  FireLoopUntilCue = 9,
  /**
   * `ScriptedSoundAndFlagAtCue33` (`FUN_00433F40`) — a sound and a script flag
   * on a cue. **Ported**, in `class33/cues.ts`. No shipped spawn.
   */
  SoundAndFlagAtCue = 10,
  /**
   * `ScriptedEndingTrackSelect33` (`FUN_00434260`) — `ENDL` or `ENDS` by the
   * score rank. **Ported**, in `class33/cues.ts`. Spawned only by the ending
   * scene, which no bundle carries.
   */
  EndingTrackSelect = 11,
  /**
   * `ScriptedStaticSlotDraw33` (`FUN_00433160`) — the tail's slot, drawn
   * where the object stands, every frame. **Ported**, in
   * `class33/strips.ts`. No shipped spawn.
   */
  StaticSlotDraw = 99,
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
  /**
   * `obj+0x118` — the uniform scale the draw puts on the main slot. The ride
   * writes it every step: `1.0`, or `2.5` for slots `0x1A35` and `0x1A36`
   * (`0x004339B3`, `0x004339E1`, `0x004339F3`). Not `Actor.scale`, which is
   * the skinned model's `model+0x116C`.
   */
  drawScale: number;      // +0x118
  /** `obj+0x1354` — the first sprite loop, `0x24A..0x25F`, seeded `0x24A`. */
  loopA: number;          // +0x1354
  /** `obj+0x1358` — the second sprite loop, `0x260..0x275`, seeded `0x260`. */
  loopB: number;          // +0x1358
  /** `obj+0x135C` — the wheels' turn, `+0x2000` a frame, slot `0x1B0E` only. */
  wheelTurn: number;      // +0x135C
  /** `obj+0x1364` — the fire loop's slot, stepped before it is drawn. */
  fireSlot: number;       // +0x1364
  /** `obj+0x1368` — the slot the fire loop wraps back to, `0x1AAB`. */
  fireFirst: number;      // +0x1368
  /** `obj+0x136C` — the fire loop's last slot, `0x1AD2`. */
  fireLast: number;       // +0x136C
  /**
   * `[port-only]` Every `AssetDrawSlot` the update made this frame, with the
   * world matrix the stack held: `render/slotmodels.ts` draws them. Cleared
   * at the top of each update, so a frame that draws nothing leaves none.
   */
  draws: { slot: number; m: number[] }[];
  /**
   * `obj+0x1330` — selectors 7, 9 and 10 count frames up in it toward a
   * mode-0 cue, and selector 8 counts down from `0x14` to its second sound.
   */
  frames: number;         // +0x1330
  /**
   * `obj+0x1390` as selector 7 moves it: `ADD ECX, 0x8` at `0x00433F15`
   * steps the descriptor tail pointer itself, one 8-byte record a cue. The
   * port keeps it as the index of that record in the bundle's list.
   */
  cue: number;            // +0x1390
  /**
   * `obj+0x1350` and `obj+0x1354` as selectors 7 and 10 seed them: the first
   * record's frame and sound. Nothing reads either back. The same two words
   * are selector 1's {@link pathSlot} and {@link loopA} (`L3`).
   */
  seedFrame: number;      // +0x1350
  seedSound: number;      // +0x1354
}

/**
 * [port-only] The zero every class-0x33 actor starts from.
 *
 * `ScriptedCarrierStepPath33` fills all of it on its first frame; before then
 * the engine's words are whatever the pool held, and this is that written out.
 */
export function makeScriptedSceneryTail(): ScriptedSceneryTail {
  return {
    pathFrame: 0, pathEnd: 0, pathSlot: -1, slot: 0, effectFrames: 0,
    drawScale: 0, loopA: 0, loopB: 0, wheelTurn: 0,
    fireSlot: 0, fireFirst: 0, fireLast: 0, draws: [],
    frames: 0, cue: 0, seedFrame: 0, seedSound: 0,
  };
}
