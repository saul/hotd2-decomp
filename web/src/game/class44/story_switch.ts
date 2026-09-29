/**
 * Class 0x44 selector 17 — the story-mode switch, and the route-branch writer
 * with the widest reach: twelve spawns over stages 1, 2, 3 and 5, and five
 * of the game's sixteen branch records are answered by one.
 *
 * ## It is shot through its mesh
 *
 * The constructor at `0x00473A70` copies the descriptor's `+0x08` to
 * `obj+0x14C` and, when it is not `-1`, ORs `0x50` into `obj+0x34`: bit
 * `0x10` sends `ProcessPlayerShots` to `ShotTestMesh` (`FUN_00404A00`), which
 * traces the shot against that collision blob through the matrix the draw
 * stored at `obj+0x150`. **All nine shipped switches name a blob**, so a
 * switch is shot exactly where the shot crosses its mesh, and sorted against
 * every zombie's sphere on the depth of that crossing. The routine writes
 * `obj+0x70..0x78` nowhere; the sphere arm's 8.0 radius and never-written
 * centre are the `-1` descriptor's, which none of them is. `0x40` with it
 * puts the mesh in the two moving-object collision passes as well (`coli.ts`),
 * because bit 31 -- which the `-1` arm sets -- is clear.
 *
 * ## The whole routine
 *
 * The routine at `0x00474F30`, read from the disassembly: the
 * pseudocode stops at the throw's `PlaySoundId` (marked no-return, `L72`) and
 * again at the draw's `MatrixStackPop` (`L35`), and the shot-test
 * registration is past the second.
 *
 * ```c
 * if (obj->+0x2A4 >= 0 && g_script_flags[obj->+0x2A4] == 1) { ActorDespawn; return; }
 * if (g_scene_index == 1) { if (g_script_flags[0x77]) { ActorDespawn; return; } }
 * else if (g_scene_index == 2 && g_evt_block_index == 2 && obj->+0x192 == 0)
 *     g_script_flags[0x15] = 1;                                   // 0x00474FA6
 * if (g_GameMode == 1) {                                          // 0x00474FB4
 *   if (obj->+0x192 == 0) {
 *     if (((obj->+0x34 & 8) && (obj->+0x1FC == -1 || HasItem(+0x1FC) || HasItem(+0x202)
 *                               || HasItem(+0x208) || HasItem(+0x20E)))
 *         || g_story_switch_thrown) {
 *       obj->+0x192 = 1;
 *       if (!g_story_switch_thrown) {
 *         PlaySoundId(0x2116A9); PoseHookNone(3, 0x14); g_story_switch_thrown = 1;
 *       }
 *     }
 *   } else if (obj->+0x192 == 1) {
 *     if (obj->+0x2A8 < 60) { ...one frame of g_pHingeCurvesXYZ[obj->+0x194]...; obj->+0x2A8++; }
 *     if (obj->+0x2A0 >= 0 && g_script_flags[obj->+0x2A0] == 1) {
 *       scene 0 block 4 | scene 1 blocks 1, 3, 0xC | scene 4 block 4:
 *         g_script_branch_var = 2; obj->+0x2A0 = -1;
 *       any other scene 0, 1, 4 block: goto tail;
 *     }
 *     if (scene 4) { if (block != 4 || !g_script_flags[obj->+0x2A0]) goto tail;
 *                    if (obj->+0x2AC++ > 0x78) { ActorDespawn; return; } }
 *     if (scene 2) { block 2: the first item, or the second flag-0x15 writer;
 *                    block 4: the second item }
 *   }
 * }
 * tail:                                                           // 0x004752EF
 * if (!(obj->+0x2A8 >= 60 && obj->+0x2AC % 2)) {
 *   Push; T(obj+0x19C); RotY(+0x1D0); RotZ(+0x6C); RotY(+0x68); RotX(+0x64);
 *   Scale(+0x1A8, +0x1AC, +0x1B0); MaxOfThreeToNoOpStub(...);
 *   lit ? SubmitSlotWithSceneLightArray(+0x28C) : AssetDrawSlot(+0x28C);
 *   MatrixStore(obj+0x150); Pop;
 * }
 * RegisterForShotTest(obj);                                       // 0x004753D7
 * ```
 *
 * **Nothing in it clears `obj+0x34`'s hit bits.** A shot on a keyed switch
 * by a player carrying none of its four items leaves bit 3 up, so the switch
 * throws itself on the frame one of them is picked up. `[proved]`: there is
 * no `AND` on `obj+0x34` anywhere in `0x00474F30`..`0x004753E6`.
 *
 * **One switch thrown throws them all.** `g_story_switch_thrown`
 * (`0x009A26EC`) is written by the placement (0) and by the first throw (1),
 * and read by every switch standing: stage 2's and stage 5's two doors of one
 * gateway (swing signs -1 and 1 at one point) open together from one shot.
 *
 * `obj` fields as the port keeps them: `+0x192` {@link BreakableProp.routinePhase},
 * `+0x194` {@link BreakableProp.group} (the curve), `+0x1CC`/`+0x1D0`/`+0x1D4`
 * `pitch`/`yaw`/`roll`, `+0x1DC` {@link BreakableProp.yawSpin} (the swing's
 * sign), `+0x1A8..0x1B0` `restX..restZ` (the scale), `+0x2A0`
 * {@link BreakableProp.storyItem}, `+0x2A4` {@link BreakableProp.removeFlag},
 * `+0x2A8` {@link BreakableProp.cueCursorB} (the hinge cursor), `+0x11C`
 * {@link BreakableProp.lifetime}, and `+0x64`/`+0x68`/`+0x6C`/`+0x2AC`/`+0x2B0`
 * by offset in {@link BreakableProp.words}.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { ColiStoreObjectMatrix } from "../coli";
import { G } from "../globals";
import { GameMode } from "../game_mode";
import {
  MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixScale, MatrixTranslate,
} from "../matrix";
import { PlayerHoldsOriginalItem } from "../original_mode";
import { SpawnStoryModeItem } from "../class41/items";
import { ActorDespawnProp } from "../class41/prop";
import {
  PropDrawBegin, PropDrawSlot, PropMatrixPush,
} from "../class41/prop_draw";
import {
  BreakableFlag, BreakableState, makeBreakableProp, PropFamily,
  type BreakableProp,
} from "../class41/prop_state";
import { PropShotTestRegister } from "../class41/shot_test";
import { HingeCurveXYZFrame } from "../class41/type56";
import { PropWords } from "../class41/words";

/**
 * `StoryModeSwitchUpdate`'s `obj+0x192`: `CMP` against 0 and 1, and nothing
 * else ever written.
 */
export enum StoryModeSwitchPhase {
  /** Not thrown: the head still raises flag 0x15 in scene 2 block 2. */
  Standing = 0,
  /** Thrown -- by a keyed hit, or by another switch's throw. */
  Thrown = 1,
}

/**
 * The words of the switch's object no shared field carries, by offset.
 * `+0x64`/`+0x68`/`+0x6C` are the actor rotation words its hinge writes and
 * its draw and `ShotTestMesh` read; `+0x2AC` counts scene 4's despawn and
 * picks the blink; `+0x2B0` is the scene-2 item's once-only latch and then
 * the count to the second flag-0x15 write.
 */
interface StoryModeSwitchWords {
  o64: number;
  o68: number;
  o6C: number;
  o2AC: number;
  o2B0: number;
}
const STORY_SWITCH_WORDS_ZERO: StoryModeSwitchWords = {
  o64: 0, o68: 0, o6C: 0, o2AC: 0, o2B0: 0,
};

/**
 * `obj+0x124 = 0x41000000` at `0x00473AE9`, and only on the `-1` arm.
 *
 * That arm never writes `obj+0x70..0x78` either, so its sphere's centre is
 * the `(0, 0, 0)` `ActorClearGameFields` left, and `RayTestSphere`
 * (`FUN_004062A0`) is a perpendicular-distance test with no divide: a centre
 * at the origin is distance 0 from every line through the eye, and **a switch
 * on that arm answers any shot fired anywhere on screen**. Whether that was
 * meant is `[open]`; no shipped switch takes the arm.
 */
export const STORY_SWITCH_RADIUS = 8.0;

/** `0x2116A9` — the throw. */
export const SFX_STORY_SWITCH_THROWN = 0x2116a9;

/** `CMP ECX, 0x3C` at `0x00474FDE` — sixty frames of the hinge curve. */
export const STORY_SWITCH_HINGE_FRAMES = 0x3c;

/** `CMP EAX, 0x78` at `0x004750DA` — scene 4's count before it despawns. */
export const STORY_SWITCH_SCENE4_FRAMES = 0x78;

/** `CMP EAX, 0x4C` at `0x004751A6` — scene 2's count to the second write. */
export const STORY_SWITCH_SECOND_FLAG_FRAMES = 0x4c;

/** `g_script_flags[0x77]`, the scene-1 sweep every prop family answers. */
const SCENE1_SWEEP_FLAG = 0x77;

/** `g_script_flags[0x18]` — what scene 2 block 2 waits on after its item. */
const STORY_SWITCH_ITEM_WAIT_FLAG = 0x18;

/**
 * The `(scene, block)` pairs `StoryModeSwitchUpdate` opens a route in.
 *
 * A table because the engine's is one: a `switch` on `g_scene_index` with a
 * block test in each arm, and no arm for the scenes that are missing. Every
 * pair here is a route record whose live alternate is **slot 2**, which is
 * the check that the reading is right — stage 1 block 4 `{6, -1, 13}`, stage
 * 2 blocks 1 `{2, -1, 29}`, 3 `{4, -1, 30}` and 12 `{13, -1, 31}`, and stage
 * 5 block 4 `{5, -1, 6}`.
 */
export const STORY_SWITCH_ROUTES: ReadonlyArray<readonly [number, number]> = [
  [0, 4],
  [1, 1], [1, 3], [1, 0x0c],
  [4, 4],
];

/**
 * `g_script_flags[0x15]` — the flag `StoryModeSwitchUpdate` raises twice:
 * from its **head** (`0x00474FA6`), in Arcade too, and after the scene-2
 * item (`0x004751B1`). The only writes of that byte by literal address in the
 * image.
 *
 * Stage 3's block 2 step 3 is `wait_script_flag 0x15`, and on the
 * block-7 -> block-8 route nothing else in the stage sets it: the script's own
 * `set_script_flag 0x15` is in block 1 step 5 (evt `0x001D00`), and block 1 is
 * only on the entry-0 route. The switch that carries it there is the one
 * block 7 step 8 spawns (evt `0x3630`), whose `obj+0x2A4` removal flag is 22 —
 * which block 2 step 3 raises at its own end, so the object is taken away one
 * gate later by the same step it opened.
 */
export const STORY_SWITCH_SCRIPT_FLAG = 0x15;

/**
 * The one `(scene, block)` the head raises {@link STORY_SWITCH_SCRIPT_FLAG}
 * in — the `else` arm of the scene-1 despawn test, not a member of
 * {@link STORY_SWITCH_ROUTES}. Also the block of the first item.
 */
export const STORY_SWITCH_FLAG_AT: readonly [number, number] = [2, 2];

/** Scene 2's second item block (`CMP BX, 0x4` at `0x004751CC`). */
const STORY_SWITCH_ITEM_BLOCK_B = 4;

/**
 * The points the two scene-2 items are handed out at, written over
 * `obj+0x19C..0x1A4` for the call and put back after it -- float literals in
 * the instructions: `0xC3C94CCD 0xC1800000 0xC5468800` at `0x00475141`, and
 * `0xC479F333 0xC1BE6666 0xC5484B33` at `0x00475208`. Each is beside one of
 * stage 3's two switches.
 */
const STORY_SWITCH_ITEM_A: readonly [number, number, number] =
  [-402.6000061035156, -16.0, -3176.5];
const STORY_SWITCH_ITEM_B: readonly [number, number, number] =
  [-999.7999877929688, -23.799999237060547, -3204.699951171875];

/** The Original Mode item rows the two arms write into `obj+0x2A0`. */
const STORY_SWITCH_ITEM_ROW_A = 2;
const STORY_SWITCH_ITEM_ROW_B = 4;

/** `MOV word ptr [ESI + 0x11C], 2` before each item. */
const STORY_SWITCH_ITEM_WORD_11C = 2;

/**
 * `PlaceStoryModeSwitch` — `FUN_00473A70`. `g_class44_subtypes[17]`.
 *
 * ```
 * obj = ActorAlloc(StoryModeSwitchUpdate, 0x378); ActorClearGameFields(obj);
 * obj+0x19C..0x1A4 = placer+0x40..0x48;  obj+0x1D0 = placer+0x68;  obj+0x68 = 0;
 * obj+0x11C = (s16)1;  obj+0x34 |= 1;
 * tail+0x08 != -1 ?  obj+0x34 |= 0x50
 *                 :  obj+0x34 |= 0x80000000, obj+0x124 = 8.0;
 * obj+0x28C = (s16)tail+0x04;  obj+0x14C = tail+0x08;  obj+0x1DC = tail+0x0C;
 * obj+0x194 = (s8)tail+0x00;   obj+0x2A0 = (s8)tail+0x10;  obj+0x2A4 = (s8)tail+0x11;
 * obj+0x2A8 = 0;  obj+0x1A8..0x1B0 = tail+0x14..0x1C;
 * obj+0x1FC/0x202/0x208/0x20E = (s16)(s8)tail+0x20..0x23;
 * g_story_switch_thrown = 0;
 * ```
 *
 * `[proved]`, `0x00473A70`..`0x00473B88`. `obj+0x11C` being written as 1
 * rather than copied is why this object does not run
 * `PropExpireByStepLifetime`: `+0x2A4` removes it instead. The placement's
 * `coli` is `tail+0x08` resolved to its blob, `null` for the `-1` arm; a
 * bundle whose pointer did not resolve leaves it out, and the switch is then
 * a mesh object with no mesh, which no shot can find -- the honest outcome
 * for a mesh the port does not have.
 */
export function PlaceStoryModeSwitch(pl: BreakablePlacement): BreakableProp {
  const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  p.family = PropFamily.StoryModeSwitch;
  p.at = pl.at;
  p.state = BreakableState.Standing;
  p.routinePhase = StoryModeSwitchPhase.Standing;
  p.lastStepIndex = G.g_evt_step_index;
  p.stepsElapsed = 0;
  p.x = pl.pos?.[0] ?? 0;
  p.y = pl.pos?.[1] ?? 0;
  p.z = pl.pos?.[2] ?? 0;
  p.yaw = pl.yaw ?? 0;
  const w = PropWords(p, STORY_SWITCH_WORDS_ZERO);
  w.o68 = 0;
  // Not a lifetime -- see above. Carried as the engine writes it.
  p.lifetime = 1;
  // `ActorClearGameFields` leaves `obj+0x34` at 0, so the word is `1` and
  // then one arm or the other.
  p.flags = BreakableFlag.Live;
  if (pl.coli !== null) {
    p.flags |= 0x50;
  } else {
    p.flags |= 0x80000000;
    p.hitRadius = STORY_SWITCH_RADIUS;
  }
  p.slot = pl.slot ?? 0;
  p.coliBlob = pl.coli ?? null;
  p.yawSpin = pl.swing_sign ?? 0;
  p.group = pl.hinge_curve ?? 0;
  p.storyItem = pl.branch_flag ?? -1;
  p.removeFlag = pl.remove_flag ?? -1;
  p.cueCursorB = 0;
  p.restX = pl.scale?.[0] ?? 0;
  p.restY = pl.scale?.[1] ?? 0;
  p.restZ = pl.scale?.[2] ?? 0;
  p.key0 = pl.keys?.[0] ?? -1;
  p.key1 = pl.keys?.[1] ?? -1;
  p.key2 = pl.keys?.[2] ?? -1;
  p.key3 = pl.keys?.[3] ?? -1;
  G.g_story_switch_thrown = 0;
  return p;
}

/**
 * `StoryModeSwitchUpdate` — `FUN_00474F30`. One switch, one 60 Hz frame. See
 * the file comment for the routine as the listing has it.
 *
 * `[port-only]` in two recordings, both declared where they are made: the
 * draw lands in {@link BreakableProp.draws} (`class41/prop_draw.ts`), and the
 * matrix `MatrixStore` keeps at `obj+0x150` is built on the identity rather
 * than the view, which is the matrix `RegisterForShotTest`'s mesh arm leaves
 * there (`combat/shot_test.ts`).
 */
export function StoryModeSwitchUpdate(p: BreakableProp, rng: Rng,
                                      events?: Events): void {
  PropDrawBegin(p);
  const w = PropWords(p, STORY_SWITCH_WORDS_ZERO);
  if (p.removeFlag >= 0 && (G.g_script_flags[p.removeFlag] ?? 0) === 1) {
    ActorDespawnProp(p);
    return;
  }
  // An `if`/`else if`, and the `else` is load-bearing: the scene-1 arm is the
  // sweep every prop family answers, and the scene-2 arm is the flag stage 3's
  // block 2 waits on, raised **every frame** while the switch stands and with
  // no reference to `g_GameMode`.
  if (G.g_scene_index === 1) {
    if ((G.g_script_flags[SCENE1_SWEEP_FLAG] ?? 0) !== 0) {
      ActorDespawnProp(p);
      return;
    }
  } else if (G.g_scene_index === STORY_SWITCH_FLAG_AT[0]
             && G.g_evt_block_index === STORY_SWITCH_FLAG_AT[1]
             && p.routinePhase === StoryModeSwitchPhase.Standing) {
    G.g_script_flags[STORY_SWITCH_SCRIPT_FLAG] = 1;
  }
  if (G.g_GameMode === GameMode.Original) {
    if (p.routinePhase === StoryModeSwitchPhase.Standing) {
      if (((p.flags & BreakableFlag.Hit) !== 0
           && (p.key0 === -1 || PlayerHoldsOriginalItem(p.key0)
               || PlayerHoldsOriginalItem(p.key1)
               || PlayerHoldsOriginalItem(p.key2)
               || PlayerHoldsOriginalItem(p.key3)))
          || G.g_story_switch_thrown !== 0) {
        p.routinePhase = StoryModeSwitchPhase.Thrown;
        if (G.g_story_switch_thrown === 0) {
          events?.emit("sound.play", { id: SFX_STORY_SWITCH_THROWN });
          // `PoseHookNone(3, 0x14)` (`FUN_00420810`) -- a bare `RET`.
          G.g_story_switch_thrown = 1;
        }
      }
    } else if (p.routinePhase === StoryModeSwitchPhase.Thrown) {
      if (StoryModeSwitchThrown(p, w, rng, events)) return;
    }
  }
  // The tail, `0x004752EF`: past its sixty frames the switch blinks on
  // `obj+0x2AC`, which only scene 4 counts.
  if (!(p.cueCursorB >= STORY_SWITCH_HINGE_FRAMES && w.o2AC % 2 !== 0)) {
    const m = PropMatrixPush();
    MatrixTranslate(m, p.x, p.y, p.z);
    MatrixRotateY(m, p.yaw);
    MatrixRotateZ(m, w.o6C);
    MatrixRotateY(m, w.o68);
    MatrixRotateX(m, w.o64);
    MatrixScale(m, p.restX, p.restY, p.restZ);
    // `MaxOfThreeToNoOpStub` (`FUN_00461C20`) is dead: it hands the largest
    // of the three to an empty stub. `g_scene_lighting` picks
    // `SubmitSlotWithSceneLightArray` over `AssetDrawSlot`; the two draw the
    // same slot under the same matrix, and the record does not tell them apart.
    PropDrawSlot(p, m, p.slot);
    ColiStoreObjectMatrix(p, m);
  }
  PropShotTestRegister(p);
}

/**
 * The arm `obj+0x192 == 1` runs, `0x00474FD8`..`0x00475255`: the swing, the
 * route, scene 4's count and scene 2's items. True when it despawned the
 * switch.
 *
 * `[port-only]` as a function: the arm is inline in the routine. It is split
 * out because it is most of the routine and has one way in.
 */
function StoryModeSwitchThrown(p: BreakableProp, w: StoryModeSwitchWords,
                               rng: Rng, events?: Events): boolean {
  if (p.cueCursorB < STORY_SWITCH_HINGE_FRAMES) {
    const i = p.cueCursorB;
    // `MOVSX EAX, byte ptr [ESI + 0x194]` -- the curve, signed.
    const f = HingeCurveXYZFrame((p.group << 24) >> 24, i);
    // A bundle that does not carry the curve leaves the pose where it was;
    // the cursor still runs its sixty frames.
    if (f) {
      w.o6C = f[2] + p.roll;
      // `TEST EAX,EAX; JLE` on `obj+0x1DC`: a sign of 0 or less mirrors x and y.
      if (p.yawSpin > 0) {
        w.o64 = p.pitch + f[0];
        w.o68 = f[1];
      } else {
        w.o64 = p.pitch - f[0];
        w.o68 = -f[1];
      }
    }
    p.cueCursorB = i + 1;
  }
  const scene = G.g_scene_index;
  const block = G.g_evt_block_index;
  if (p.storyItem >= 0 && (G.g_script_flags[p.storyItem] ?? 0) === 1) {
    if (scene === 0 || scene === 1 || scene === 4) {
      const here = STORY_SWITCH_ROUTES.some(
        ([s, b]) => s === scene && b === block);
      if (!here) return false;
      G.g_script_branch_var = 2;
      p.storyItem = -1;
    }
  }
  if (scene === 4) {
    // `g_script_flags[obj+0x2A0]` read again -- and once the route above has
    // written `obj+0x2A0 = -1` that is the byte **before** the array,
    // `0x009C71FF`. No instruction names `0x009C71F8..0x009C71FF` by address
    // (byte patterns for all eight find nothing) and no block copy lands on
    // the camera words before it, so it is the zero `.bss` starts at,
    // `[likely]`; the port's array has no byte there and reads 0 the same way.
    if (block !== 4 || (G.g_script_flags[p.storyItem] ?? 0) === 0) {
      return false;
    }
    const n = w.o2AC;
    w.o2AC = n + 1;
    if (n > STORY_SWITCH_SCENE4_FRAMES) {
      ActorDespawnProp(p);
      return true;
    }
  }
  if (scene !== 2) return false;
  if (block === STORY_SWITCH_FLAG_AT[1]) {
    if (w.o2B0 === 0) {
      StoryModeSwitchItem(p, STORY_SWITCH_ITEM_ROW_A, STORY_SWITCH_ITEM_A,
                          rng, events);
      w.o2B0 = 1;
    } else {
      if ((G.g_script_flags[STORY_SWITCH_ITEM_WAIT_FLAG] ?? 0) === 0) {
        return false;
      }
      const n = w.o2B0;
      w.o2B0 = n + 1;
      // `0x004751B1` -- the second writer, behind the mode gate.
      if (n > STORY_SWITCH_SECOND_FLAG_FRAMES) {
        G.g_script_flags[STORY_SWITCH_SCRIPT_FLAG] = 1;
      }
    }
    return false;
  }
  if (block === STORY_SWITCH_ITEM_BLOCK_B && w.o2B0 === 0) {
    StoryModeSwitchItem(p, STORY_SWITCH_ITEM_ROW_B, STORY_SWITCH_ITEM_B,
                        rng, events);
    w.o2B0 = 1;
  }
  return false;
}

/**
 * One of the two item arms (`0x00475123`, `0x004751E4`): `obj+0x2A0` and
 * `obj+0x11C` for the release, the position swapped for a literal point
 * around `SpawnStoryModeItem` (`FUN_00467B90`), the pick-up block lifted
 * (`0x00475168`, `0x0047522F`), and `obj+0x2A0 = -1` after.
 *
 * `[port-only]` as a function: the two arms are the same instructions with
 * different immediates.
 */
function StoryModeSwitchItem(p: BreakableProp, row: number,
                             at: readonly [number, number, number],
                             rng: Rng, events?: Events): void {
  p.storyItem = row;
  p.lifetime = STORY_SWITCH_ITEM_WORD_11C;
  const x = p.x, y = p.y, z = p.z;
  p.x = at[0]; p.y = at[1]; p.z = at[2];
  SpawnStoryModeItem(p, rng, events);
  G.g_original_item_pickup_blocked = 0;
  p.x = x; p.y = y; p.z = z;
  p.storyItem = -1;
}
