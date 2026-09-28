/**
 * Class 0x41 type 25 — a route-branch trigger drawn only as an effect, live
 * in one block.
 *
 * One shipped spawn: stage 2 block 23 step 4 (evt `0xFACC`), at
 * `(-565.2, -13.8, -1282.7)`, `+0x11C` 1, yaw `0x8000`. The step is
 *
 * ```
 * spawn_placed (two others); spawn_obj; spawn_placed (this);
 * cam_play 536..710 on path 93; wait_queued_events_done; wait_enemies_alive 0;
 * advance_step
 * ```
 *
 * and block 23 (`0x17`) routes `{24, 26, -1}`. The arm seeds
 * `g_script_branch_var` with 0 and a scoring hit writes 1, so unshot the
 * stage goes to 24 and shot to 26. `[proved]` from the code and the script.
 *
 * It draws **no static model**: effect 10 on motion `0x1C9`, through
 * `EffectDrawSceneLit` (`FUN_0040DFA0`), held on frame 0 until it is shot,
 * then played once to two frames short of `g_motion_play_length[0x1C9]` (100,
 * read at `0x004E0B62`), then blinked for 29 frames and gone — though the
 * object itself stays until its step lifetime takes it. What it is, `[open]`.
 *
 * ## `PlaceGenericProp` case 0x19 — the arm at `0x00461FFB`
 *
 * ```
 * 00461ffb  MOV word [0x009c88a4],BX          ; g_script_branch_var = 0 (EBX from 0x00461D73)
 * 00462002  MOV [ESI+0x124],0x41400000        ; radius 12.0
 * 0046200c  MOV [ESI+0x324],0xA               ; effect 10
 * 00462016  MOV [ESI+0x328],0x1C9             ; motion 0x1C9
 * 00462020  INC word [0x009c7006]             ; g_enemies_present++
 * ```
 *
 * ## The routine, `0x00469AE0`..`0x00469C72`
 *
 * The pseudocode stops at the hit arm's `PlaySoundId` and at the draw's
 * `MatrixStackPop`; the give-back and the `0x44000000` after the sound, and
 * the registration after the pop, are from `disassemble_bytes` (`L35`).
 *
 * ```c
 * PropExpireByStepLifetime(obj);                // 0x00469AE9, result not tested
 * if (++obj->+0x2A0 == 0xFE && !(obj->+0x34 & 0x40000000)) {
 *     g_enemies_present--;  obj->+0x34 |= 0x40000000;          // the timeout
 * }
 * if ((obj->+0x34 & 8) && !(obj->+0x34 & 0x40000000) && g_evt_block_index == 0x17) {
 *     BreakablePropAwardHit(obj->+0x34, 0);
 *     g_script_branch_var = 1;
 *     PlaySoundId(0x2F16A9);  PoseHookNone(2, 0x14);
 *     g_enemies_present--;                                    // 0x00469B5A
 *     obj->+0x34 |= 0x44000000;                               // 0x00469B61
 * }
 * len = g_motion_play_length[obj->+0x328];
 * if ((obj->+0x34 & 0x4000000) && obj->+0x32C < len - 2) obj->+0x32C++;
 * else if (obj->+0x32C == len - 2) obj->+0x2A4++;
 * if (obj->+0x2A4 < 0x1E && (obj->+0x2A4 <= 0 || !(obj->+0x2A4 & 1))
 *     && g_motion_slots[0x1C9].state == 2) {                  // word [0x009A462C]
 *     Push; Translate(x, y, z); EffectDrawSceneLit(obj + 0x324); Pop;
 * }
 * if (!(obj->+0x34 & 0x4000000)) {
 *     obj->+0x70 = view * (x, y + 12.0, z);  RegisterForShotTest(obj);   // 0x004D1D20
 * }
 * ```
 *
 * `0x009A462C` has no name and one reader; it is `g_motion_slots`
 * (`0x009A37E0`, `{u32 base; u32 state}` per motion) at `0x1C9 * 8 + 4` —
 * the motion's residency. No `AND` on `obj+0x34` and no hit effect. The
 * effect is drawn with no rotation at all: the descriptor's three angles are
 * never read.
 *
 * ## `g_enemies_present`: at most once, and not at all on the unshot route
 *
 * `[proved]` from the code: the timeout and the scoring hit each need
 * `0x40000000` clear and each set it, so at most one of them fires. The path
 * with neither is `PropExpireByStepLifetime` despawning it before frame
 * `0xFE` unshot — and **that is the shipped unshot path** `[proved]` from the
 * script: block 23's step waits on `wait_enemies_alive`, not on the count
 * this object is in, so it advances after the 174-frame camera, and block 24
 * (or 26) step 0 advances at once, which is this object's second step change
 * against a lifetime of 1, about frame 176 of 254. So the engine leaves
 * `g_enemies_present` one high until `ResetSceneOnEnter`. Nothing on either
 * route after block 23 waits on that count (24 → 9 → 28 → 37 and
 * 26 → 27 → 28 → 37; the stage's two `wait_enemies_present` are in blocks 7
 * and 35), so the stage finishes either way; the one reader that still sees
 * it is the two-player attack claim, which compares the count against 1. The
 * port keeps the leak because the game has it.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { G } from "../globals";
import { MatrixTranslate } from "../matrix";
import { T } from "../tables";
import { PROP_BRANCH_ANSWERED } from "./branch";
import { PropExpireByStepLifetime } from "./lifetime";
import { BreakablePropAwardHit } from "./prop";
import { PropDrawBegin, PropDrawEffect, PropMatrixPush } from "./prop_draw";
import { BreakableFlag, type BreakableProp } from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";

/** `MOV [ESI+0x124],0x41400000` — the arm's shot radius. */
export const TYPE25_RADIUS = 12.0;
/** `MOV [ESI+0x324],0xA` — the effect tree it draws. */
export const TYPE25_EFFECT = 10;
/** `MOV [ESI+0x328],0x1C9` — the motion that effect plays. */
export const TYPE25_MOTION = 0x1c9;
/** `CMP EAX,0xFE` — the frame an unshot one counts itself out. */
export const TYPE25_TIMEOUT_FRAME = 0xfe;
/** `CMP word [g_evt_block_index],0x17` — the only block a shot counts in. */
export const TYPE25_BLOCK = 0x17;
/** `PUSH 0x2F16A9; CALL PlaySoundId` — the scoring hit. */
export const SFX_TYPE25_HIT = 0x2f16a9;
/**
 * `obj+0x34` bit 26 — played, and out of the shot test. The scoring hit sets
 * it together with bit 30 as `0x44000000`; the timeout sets bit 30 alone, so a
 * timed-out object stays shootable and simply pays nothing.
 */
export const TYPE25_SHOT_TEST_DONE = 0x04000000;
/** `CMP EAX,0x1E; JGE` — the blink stops drawing at this count. */
export const TYPE25_BLINK_FRAMES = 0x1e;
/** `FADD [0x004D1D20]` — the shot point's rise above its origin. */
export const TYPE25_SHOT_RISE = 12.0;

/**
 * `PlaceGenericProp` case 0x19.
 *
 * `[port-only]` as a *function*: in the engine it is the arm at `0x00461FFB`
 * of `PlaceGenericProp`'s switch. Everything the arm writes, in its order.
 */
export function PlaceGenericPropType25(p: BreakableProp,
                                       pl: BreakablePlacement,
                                       rng: Rng): void {
  void pl; void rng;
  G.g_script_branch_var = 0;
  p.hitRadius = TYPE25_RADIUS;
  p.effect = TYPE25_EFFECT;
  p.effectVariant = TYPE25_MOTION;
  G.g_enemies_present += 1;
  // [port-only] `obj+0x2A4` is the blink count, and `ActorClearGameFields`
  // (`FUN_004A73D0`) left it 0; the port's constructor leaves the struct's
  // -1 there for a generic prop.
  p.removeFlag = 0;
}

/**
 * `PropUpdateType25` — `FUN_00469AE0`. `g_class41_updates[25]`.
 *
 * `+0x2A0` is {@link BreakableProp.storyItem} (frames since placement),
 * `+0x2A4` {@link BreakableProp.removeFlag} (the blink count) and
 * `+0x324..0x330` the effect block, {@link BreakableProp.effect},
 * `effectVariant`, `effectFrames` and `effectPrevFrame`.
 */
export function PropUpdateType25(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  PropDrawBegin(p);
  // Not tested in the engine, and it need not be: `ActorDespawn` ends in
  // `ActorKill`, which does not return.
  if (PropExpireByStepLifetime(p)) return;

  p.storyItem += 1;
  if (p.storyItem === TYPE25_TIMEOUT_FRAME
      && (p.flags & PROP_BRANCH_ANSWERED) === 0) {
    G.g_enemies_present -= 1;
    p.flags |= PROP_BRANCH_ANSWERED;
  }

  if ((p.flags & BreakableFlag.Hit) !== 0
      && (p.flags & PROP_BRANCH_ANSWERED) === 0
      && G.g_evt_block_index === TYPE25_BLOCK) {
    BreakablePropAwardHit(p.flags, false, rng);
    G.g_script_branch_var = 1;
    events?.emit("sound.play", { id: SFX_TYPE25_HIT });
    G.g_enemies_present -= 1;
    p.flags |= PROP_BRANCH_ANSWERED | TYPE25_SHOT_TEST_DONE;
  }

  // `g_motion_play_length[obj+0x328]`, off the effect record the bundle
  // carries for this effect id -- the one place the port has the table.
  // A bundle without the record has nothing to draw, and then the cursor
  // runs on after the hit and the blink never starts, which nothing sees.
  const def = T.breakables?.effects?.[String(p.effect)];
  const end = def && def.motion === p.effectVariant
    ? def.play_length - 2 : Infinity;
  if ((p.flags & TYPE25_SHOT_TEST_DONE) !== 0 && p.effectFrames < end) {
    p.effectFrames += 1;
  } else if (p.effectFrames === end) {
    p.removeFlag += 1;
  }

  const n = p.removeFlag;
  // `[port-only]` `g_motion_slots[0x1C9].state == 2` is not asked: the bundle
  // bakes the motion, so for the port it is always resident -- the answer
  // `PropUpdateType44` (`FUN_0046D850`) gives its own residency test.
  if (n < TYPE25_BLINK_FRAMES && (n <= 0 || n % 2 === 0)) {
    const m = PropMatrixPush();
    MatrixTranslate(m, p.x, p.y, p.z);
    // `EffectDrawSceneLit` is `EffectDrawUnlit`'s walk with each part
    // submitted through `SubmitSlotWithSceneLightArray`; `PropDrawEffect`
    // records the same slots under the same matrices.
    PropDrawEffect(p, m, rng);
  }

  if ((p.flags & TYPE25_SHOT_TEST_DONE) === 0) {
    PropRegisterForShotTest(p, p.x, Math.fround(p.y + TYPE25_SHOT_RISE), p.z);
  }
}
