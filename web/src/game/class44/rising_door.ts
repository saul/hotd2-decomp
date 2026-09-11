/**
 * Class 0x44 selector 11 — a door that slides straight up.
 *
 * Two spawns in the whole game, and both of them are a shutter the zombies
 * come out from under:
 *
 * * **stage 3**, descriptor `0x23F4`, slot `0xA58` = `etc_door.bin[2]`, at
 *   `(-356.6, -16.1, -3047.8)`. Block 8 step 2 sets script flag 6 and the
 *   four class-0x30 spawns of the same op stand at that point, behind it.
 * * **stage 5**, descriptor `0x0C2C`, slot `0x189A` = `st5.bin[9]`, at
 *   `(275.4, 12.0, -89.6)`, with flag 2 and three class-0x30 spawns at that
 *   point in the next step.
 *
 * Both models render as a corrugated ribbed metal panel, and the file for one
 * of them is called `etc_door`. `[likely]` a roller shutter, on the model, the
 * filename and the vertical rise together; `[proved]` that it is a door-shaped
 * model that translates upward on a script flag.
 *
 * ## The whole routine, `RisingDoorUpdate` (`FUN_004753F0`)
 *
 * ```c
 * if (g_script_flags[obj->+0x2A4] == 1) { ActorKill(); return; }
 * dx = dz = 0;
 * if ((s16)obj->+0x28C == 0xA58 && g_script_flags[obj->+0x2A0] == 0) {
 *     if (obj->+0x2C0 < 0.001) { obj->+0x2C0 = 1.0f; PoseHookNone(2, 0x14); }
 *     dx = (rand() % 0x191 - 200.0) * obj->+0x2C0 * 0.01;
 *     dz = (rand() % 0x65  -  50.0) * obj->+0x2C0 * 0.01;
 *     obj->+0x2C0 *= 0.95;
 * }
 * if (g_script_flags[obj->+0x2A0] == 1) {
 *     if (obj->+0x2A8 == 0) { obj->+0x2A8 = 1; obj->+0x1C4 = 0.5f; }
 *     if ((s16)obj->+0x28C == 0xA58) {
 *         if (obj->+0x1A0 >= 20.0) goto draw;
 *         obj->+0x1C4 += 0.1f;
 *     } else {
 *         if (obj->+0x1A0 >= 35.0) goto draw;
 *         obj->+0x1C4 += 0.01f;
 *     }
 *     obj->+0x1A0 += obj->+0x1C4;
 * }
 * draw:
 * MatrixStackPush(0);
 * MatrixTranslate(dx + obj->+0x19C, obj->+0x1A0, dz + obj->+0x1A4);
 * MatrixRotateY(obj->+0x1D0);
 * AssetDrawSlot((s16)obj->+0x28C);
 * MatrixStackPop(1);
 * ```
 *
 * Four things in it are worth stating outright.
 *
 * **The ceiling is a slot test, not a size test.** `CMP word ptr [ESI+0x28C],
 * 0xA58` picks both the rattle and the rise pair. Stage 3's door climbs 36.1
 * at a tenth a frame and is clear on frame **22**; stage 5's climbs 23 at a
 * hundredth and takes **35**, half again as long over two thirds the distance.
 * Nothing about the model decides which; the engine names one asset slot.
 *
 * **Past the ceiling it stops writing `y` rather than clamping it.** The two
 * `JGE`s jump to the draw, so the last `y` the routine wrote is the pose the
 * door holds — which is one frame's worth *above* the ceiling, not the
 * ceiling. Clamping would leave it a fraction lower for ever.
 *
 * **The rattle reseeds itself.** `obj+0x2C0` decays by 0.95 a frame and is
 * reset to 1.0 whenever it falls below 0.001, which it reaches in about 135
 * frames — so a door waiting on its flag rattles in bursts rather than once.
 * The two offsets are locals in the frame and are never written back, which is
 * why {@link RisingDoorUpdate} decays the amplitude and `render/breakables.ts`
 * draws the displacement, the same split `BreakablePropUpdate` already has.
 *
 * **`PoseHookNone(2, 0x14)` is a dead call.** `FUN_00420810` is the empty stub
 * every skeletal actor gets as its pose hook; called here with two arguments
 * it does nothing at all. It is in the transcription above because it is in
 * the routine, and it is not ported because there is nothing to port.
 *
 * ## What the object is not
 *
 * It is **not** a hinge. `HingeUpdate` (`FUN_00473CF0`) and its three
 * constructors are class 0x44 selectors 1, 2 and 4, and they compose
 * `RotY(base); RotZ; RotY(swing); RotX` off a baked curve; this routine has
 * one `MatrixRotateY` and moves the object's position instead. It is also not
 * the port's `shutter` — `script/state/shutter.ts` is the HUD letterbox,
 * `g_bHudShutterState`, and has nothing to do with any door.
 *
 * `[port-only]` **No shot test.** `PropBuildRisingDoor` sets `obj+0x34 |= 0x51`
 * and bit `0x10` sends `RegisterForShotTest` (`FUN_00405160`) to `ShotTestMesh`
 * rather than to the sphere, which is the path `class41/shot_test.ts` says the
 * port has not got. The routine itself never reads a hit bit, so nothing
 * happens to this object when it is shot either way.
 */
import type { BreakablePlacement } from "../../bundle";
import { G } from "../globals";
import { ActorDespawnProp } from "../class41/prop";
import {
  BreakableFlag, BreakableState, makeBreakableProp, PropFamily,
  type BreakableProp,
} from "../class41/prop_state";

/**
 * `CMP word ptr [ESI+0x28C], 0xA58` — the one asset slot
 * {@link RisingDoorUpdate} names, and it is stage 3's door.
 *
 * The test appears twice in the routine, once for the rattle and once for the
 * rise pair, and it is the slot rather than anything measured about the model.
 */
export const RISING_DOOR_RATTLE_SLOT = 0xa58;

/** `obj+0x1C4` on the frame the open flag is first seen raised. */
export const RISING_DOOR_SPEED0 = 0.5;
/** `FLD` literals: the `y` the routine stops writing past, per arm. */
export const RISING_DOOR_CEILING = 20.0;
export const RISING_DOOR_CEILING_OTHER = 35.0;
/** `FADD` literals: what the speed gains each frame, per arm. */
export const RISING_DOOR_STEP = 0.1;
export const RISING_DOOR_STEP_OTHER = 0.01;

/** `obj+0x2C0 = 1.0f` whenever it falls below 0.001. */
export const RISING_DOOR_RATTLE_AMP = 1.0;
export const RISING_DOOR_RATTLE_FLOOR = 0.001;
/** `obj+0x2C0 *= 0.95` every frame the door is still shut. */
export const RISING_DOOR_RATTLE_DECAY = 0.95;

/**
 * `[ceiling, step]` for a door drawing *slot*.
 *
 * `[port-only]` The engine has no such function: the comparison is inline in
 * `RisingDoorUpdate`, twice. It is one here so the assertions can name it and
 * so the pair cannot drift apart — and a function rather than a table because
 * a table keyed on every slot in the game would be a claim that some other
 * slot could appear in it.
 */
export function RisingDoorRise(slot: number): [number, number] {
  return slot === RISING_DOOR_RATTLE_SLOT
    ? [RISING_DOOR_CEILING, RISING_DOOR_STEP]
    : [RISING_DOOR_CEILING_OTHER, RISING_DOOR_STEP_OTHER];
}

/**
 * Whether a door drawing *slot* rattles while it waits.
 *
 * `[port-only]` The same inline `CMP` as {@link RisingDoorRise}, named for the
 * other thing it decides.
 */
export function RisingDoorRattles(slot: number): boolean {
  return slot === RISING_DOOR_RATTLE_SLOT;
}

/**
 * `PropBuildRisingDoor` — `FUN_00473410`.
 *
 * `ActorAlloc(RisingDoorUpdate, 0x378)`, `ActorClearGameFields`, the position
 * and the yaw off the descriptor header, and four fields off the parameter
 * tail at `obj+0x1390`: the `u16` at `+0x04` is the asset slot, the `u32` at
 * `+0x08` reaches `obj+0x14C` and is `-1` in both shipped spawns, and the two
 * signed bytes at `+0x20`/`+0x21` are the open and remove flags.
 *
 * `obj+0x68 = 0` is in the constructor and is **not** the draw yaw: the yaw the
 * routine rotates by is `obj+0x1D0`, and `+0x68` is the actor root's own
 * orientation, which this family never draws through. Zeroing it is the engine
 * making sure of that; the port has no root draw for a prop at all.
 */
export function PropBuildRisingDoor(pl: BreakablePlacement): BreakableProp {
  const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  p.family = PropFamily.RisingDoor;
  p.at = pl.at;
  p.state = BreakableState.Standing;
  // `obj+0x34 |= 0x51` — live, the mesh shot path (bit 0x10) and bit 0x40.
  p.flags = BreakableFlag.Live | 0x10 | 0x40;
  // `obj+0x28C` — the u16 at tail+0x04.
  p.slot = pl.slot ?? 0;
  p.x = pl.pos?.[0] ?? 0;
  p.y = pl.pos?.[1] ?? 0;
  p.z = pl.pos?.[2] ?? 0;
  // `obj+0x1D0`, the descriptor's orientation *b*. Both shipped spawns are 0.
  p.yaw = pl.yaw ?? 0;
  // `obj+0x2A0` and `obj+0x2A4`, the two signed bytes of the tail. `+0x2A0`
  // is `storyItem`'s fifth meaning and `+0x2A4` is `removeFlag`'s own.
  p.storyItem = pl.open_flag ?? 0;
  p.removeFlag = pl.remove_flag ?? -1;
  // `ActorClearGameFields` zeroes the object, so the rise latch at `+0x2A8`,
  // the speed at `+0x1C4` and the rattle amplitude at `+0x2C0` all start at
  // zero — and the amplitude starting below the floor is what makes the first
  // frame of a shut door seed the rattle.
  p.cueCursorB = 0;
  p.vy = 0;
  p.shake = 0;
  // `PropBuildRisingDoor` writes no `obj+0x124`, so there is no sphere: the
  // `0x10` bit above is the mesh path and the routine reads no hit bit anyway.
  p.hitRadius = 0;
  return p;
}

/**
 * `RisingDoorUpdate` — `FUN_004753F0`. One object, one 60 Hz frame.
 *
 * The engine has no `PropExpireByStepLifetime` here — the remove flag is this
 * object's whole lifetime — so the pool calls this directly rather than
 * through the generic prologue.
 */
export function RisingDoorUpdate(p: BreakableProp): void {
  // `(&g_script_flags)[obj->+0x2A4] == 1`. **No `>= 0` guard**, unlike
  // `HingeUpdate`: the engine indexes the array with whatever the byte holds,
  // and both shipped spawns carry a real flag. A `-1` would read the byte
  // before the array, which is `g_script_flags[-1]` and not modelled.
  if (p.removeFlag >= 0 && G.g_script_flags[p.removeFlag] === 1) {
    ActorDespawnProp(p);
    return;
  }
  const open = G.g_script_flags[p.storyItem] === 1;

  // The rattle, and only for the one slot. The amplitude is state and decays
  // here; the displacement it produces is a draw offset the engine recomputes
  // from `rand()` every frame and never writes back, so it belongs to
  // `render/breakables.ts` — the same split `BreakablePropUpdate` has.
  if (RisingDoorRattles(p.slot) && !open) {
    if (p.shake < RISING_DOOR_RATTLE_FLOOR) p.shake = RISING_DOOR_RATTLE_AMP;
    // `FUN_00420810(2, 0x14)` sits here and is `PoseHookNone`, the empty stub.
    p.shake *= RISING_DOOR_RATTLE_DECAY;
  }

  if (!open) return;
  // `obj+0x2A8` — a one-way latch, so the speed is seeded once however long
  // the flag stays up.
  if (p.cueCursorB === 0) {
    p.cueCursorB = 1;
    p.vy = RISING_DOOR_SPEED0;
  }
  const [ceiling, step] = RisingDoorRise(p.slot);
  // `JGE` to the draw, not a clamp: past the ceiling the routine stops writing
  // `y` and the door holds the last value it wrote, which is one frame's worth
  // above the ceiling.
  if (p.y >= ceiling) return;
  p.vy += step;
  p.y += p.vy;
}
