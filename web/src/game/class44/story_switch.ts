/**
 * Class 0x44 selector 17 — the story-mode switch, and the route-branch writer
 * with the widest reach: nine spawns over stages 1, 2, 3 and 5, and five of
 * the game's branch records are answered by one.
 *
 * It is a door. Every shipped one draws a door or gate leaf (slots `0x1794`
 * and `0x1795` are a pair of gate leaves, `0x17D7` a single door), its throw
 * plays `COMMON\DOORKICK1_22.WAV` (`0x2116A9`) and it swings open on the
 * same `g_pHingeCurvesXYZ` the class-0x44 hinges do. "Switch" is this
 * port's old name for it, kept because every document and check uses it.
 *
 * ## It is shot through its mesh `[proved]`
 *
 * The constructor copies the descriptor's `+0x08` to `obj+0x14C` and, when
 * it is not `-1`, ORs `0x50` into `obj+0x34`: bit `0x10` makes
 * `RegisterForShotTest` (`FUN_00405160`) file it past its depth test and
 * `ProcessPlayerShots` send it to `ShotTestMesh` (`FUN_00404A00`), which
 * traces the shot against that collision blob through the matrix the draw
 * stored at `obj+0x150`. **All nine shipped switches name a blob** (the
 * bundle's `coli_blob`, every one resolving to a blob header in its stage's
 * `coli<n>.bin`), so a switch is hit exactly where the shot crosses its
 * mesh, and sorted against every zombie's sphere on the depth of that
 * crossing. The `-1` arm -- a radius of 8.0 and a sphere centre the routine
 * never writes -- is taken by none of them.
 *
 * The same `0x50` -- bits `0x10` and `0x40`, nothing of `0x80008000` -- is
 * what `ColiTraceSegmentAllSets` and `ColiTestSphereAgainstFullSet` take a
 * registered object into their first pass on, so a standing switch is also
 * a wall to a ground probe, a body's push and a world trace (`coli.ts`,
 * `ColiDynamicObjects`), through the same scaled matrix.
 *
 * Until this file the port gave the mesh arm a hit radius of 0 and the prop
 * pool had no mesh test, so **no shipped switch could be shot**: the keyless
 * gates of stage 2 (block 1) and stage 5 (block 4), the keyed doors of stage
 * 1 (block 4) and stage 2 (blocks 3 and 12), and stage 3's two doors, which
 * hand out the scene-2 items, stood shut in every run.
 *
 * ## The whole routine
 *
 * `StoryModeSwitchUpdate` at `0x00474F30`, from the disassembly
 * (`0x00474F30`..`0x004753E6`):
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
 *     if (obj->+0x2A8 < 60) { one frame of g_pHingeCurvesXYZ[(s8)obj->+0x194]; obj->+0x2A8++; }
 *     if (obj->+0x2A0 >= 0 && g_script_flags[obj->+0x2A0] == 1) {
 *       scene 0 block 4 | scene 1 blocks 1, 3, 0xC | scene 4 block 4:
 *         g_script_branch_var = 2; obj->+0x2A0 = -1;
 *       any other block of scenes 0, 1 and 4: goto tail;
 *     }
 *     if (scene 4) { if (block != 4 || !g_script_flags[obj->+0x2A0]) goto tail;
 *                    if (obj->+0x2AC++ > 0x78) { ActorDespawn; return; } }
 *     if (scene 2) { block 2: the first item, or the count to the second
 *                    flag-0x15 write; block 4: the second item }
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
 * **Nothing in it clears `obj+0x34`'s hit bits.** There is no store to
 * `[ESI+0x34]` anywhere in the routine, so a shot on a keyed door by a
 * player carrying none of its four items leaves bit 3 up, and the door
 * throws itself on the first frame one of them is held. (The port's pool
 * used to clear them after the routine, as it does for the families whose
 * routines do.)
 *
 * **One door kicked opens them all.** `g_story_switch_thrown` (`0x009A26EC`)
 * is written by the placement (0) and by the first throw (1) and read by
 * every switch standing, so stage 2's and stage 5's two gate leaves -- sides
 * -1 and +1 at one gateway -- open together from one shot, and only the
 * first plays the kick.
 *
 * **The route waits on its script flag.** The branch write is gated on
 * `g_script_flags[obj+0x2A0] == 1` as well as the scene and block, and the
 * port used to write it without the flag. Stage 2's gate waits on flag
 * `0x72`, stage 5's on `0x10`, stage 1's door on `0x27`.
 *
 * ## Fields, as the port keeps them
 *
 * `+0x192` {@link BreakableProp.routinePhase} ({@link StoryModeSwitchPhase});
 * `+0x194` {@link BreakableProp.group} (the curve, a signed byte);
 * `+0x19C..0x1A4` `x`/`y`/`z`; `+0x1CC`/`+0x1D0`/`+0x1D4` `pitch`/`yaw`/
 * `roll` (only the yaw is written; the other two stay zero); `+0x1A8..0x1B0`
 * `restX..restZ` (the scale); `+0x2A0` {@link BreakableProp.storyItem};
 * `+0x2A4` {@link BreakableProp.removeFlag}; `+0x11C`
 * {@link BreakableProp.lifetime}; `+0x14C`/`+0x150`
 * {@link BreakableProp.coliBlob}/{@link BreakableProp.coliMatrix}; and
 * `+0x64`/`+0x68`/`+0x6C`/`+0x1DC`/`+0x2A8`/`+0x2AC`/`+0x2B0` by offset in
 * {@link BreakableProp.words} ({@link StoryModeSwitchWords}).
 *
 * ## What the port does not carry
 *
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
  PropSubmitSlotWithSceneLightArray,
} from "../class41/prop_draw";
import {
  BreakableFlag, BreakableState, makeBreakableProp, PropFamily,
  type BreakableProp,
} from "../class41/prop_state";
import {
  PROP_SHOT_TEST_MESH, PropRegisterForShotTestAsIs,
} from "../class41/shot_test";
import { HingeCurveXYZFrame } from "../class41/type56";
import { PropWords } from "../class41/words";
import { PROP_SWEEP_FLAG, PROP_SWEEP_SCENE } from "./hinge";

/**
 * `StoryModeSwitchUpdate`'s `obj+0x192`: `MOVSX; SUB 0; JZ; DEC; JNZ` at
 * `0x00474FC1`, so 0 and 1 are the two arms and any other value runs
 * neither. Nothing writes anything but 1 over the constructor's 0.
 */
export enum StoryModeSwitchPhase {
  /** Shut: the head still raises flag 0x15 in scene 2 block 2. */
  Unthrown = 0,
  /** Kicked open -- by a keyed hit, or by another switch's throw. */
  Thrown = 1,
}

/**
 * The words of the switch's object no shared {@link BreakableProp} field
 * carries, by offset. `+0x64`/`+0x68`/`+0x6C` are the swing's angles, which
 * the draw composes and `ShotTestMesh` turns the hit's normal by;
 * `+0x1DC` the side (the sign of the swing); `+0x2A8` the curve frame;
 * `+0x2AC` scene 4's count, whose parity blinks the draw; `+0x2B0` the
 * scene-2 item's once-only latch and then the count to the second flag-0x15
 * write.
 */
export interface StoryModeSwitchWords {
  o64: number;
  o68: number;
  o6c: number;
  o1dc: number;
  o2a8: number;
  o2ac: number;
  o2b0: number;
}

const STORY_SWITCH_WORDS: StoryModeSwitchWords = {
  o64: 0, o68: 0, o6c: 0, o1dc: 0, o2a8: 0, o2ac: 0, o2b0: 0,
};

/**
 * `obj+0x124 = 0x41000000` at `0x00473AE9`, and only on the `-1` arm.
 *
 * That arm never writes `obj+0x70..0x78` either, so the sphere's centre is
 * the `(0, 0, 0)` `ActorClearGameFields` left -- in **view** space, which is
 * the eye, and `RayTestSphere` (`FUN_004062A0`) measures from a line through
 * the eye, so such a switch would answer any shot fired anywhere on screen.
 * Whether that was meant is `[open]`; no shipped switch takes the arm, and
 * the port's prop points are world points (`class41/shot_test.ts`), so it
 * does not reproduce that.
 */
export const STORY_SWITCH_RADIUS = 8.0;

/** `obj+0x34 |= 0x80000000` with the radius, on the `-1` arm. */
const STORY_SWITCH_SPHERE_FLAGS = 0x80000000;

/** `OR ECX, 0x50` at `0x00473ADB`, on the mesh arm. */
const STORY_SWITCH_MESH_FLAGS = PROP_SHOT_TEST_MESH | 0x40;

/** `0x2116A9` -- `COMMON\DOORKICK1_22.WAV`, the first throw's. */
export const SFX_STORY_SWITCH_KICK = 0x2116a9;

/** `CMP ECX, 0x3C` at `0x00474FDE` -- sixty frames of the hinge curve. */
export const STORY_SWITCH_HINGE_FRAMES = 0x3c;

/** `CMP EAX, 0x78` at `0x004750DA` -- scene 4's count before it despawns. */
export const STORY_SWITCH_SCENE4_FRAMES = 0x78;

/** `CMP EAX, 0x4C` at `0x004751A6` -- scene 2's count to the second write. */
export const STORY_SWITCH_SECOND_FLAG_FRAMES = 0x4c;

/** `MOV CL, [0x009C7218]` -- what scene 2 block 2 counts on after its item. */
export const STORY_SWITCH_ITEM_WAIT_FLAG = 0x18;

/**
 * `MOV word ptr [0x009c88a4], DX` with `DX = 2` -- every arm of the route
 * table writes the same 2.
 */
export const STORY_SWITCH_ROUTE = 2;

/**
 * The `(scene, block)` pairs `StoryModeSwitchUpdate` opens a route in.
 *
 * A table because the engine's is one: a `switch` on `g_scene_index` with a
 * block test in each arm (`0x00475057`..`0x0047508C`), and no arm for the
 * scenes that are missing. Every pair here is a route record whose live
 * alternate is **slot 2**, which is the check that the reading is right --
 * stage 1 block 4 `{6, -1, 13}`, stage 2 blocks 1 `{2, -1, 29}`, 3
 * `{4, -1, 30}` and 12 `{13, -1, 31}`, and stage 5 block 4 `{5, -1, 6}`.
 */
export const STORY_SWITCH_ROUTES: ReadonlyArray<readonly [number, number]> = [
  [0, 4],
  [1, 1], [1, 3], [1, 0x0c],
  [4, 4],
];

/** The scenes {@link STORY_SWITCH_ROUTES} has an arm for. */
const STORY_SWITCH_ROUTE_SCENES = [0, 1, 4];

/** `CMP DI, 0x4` at `0x00475083` and `0x004750B1` -- the counting scene. */
const STORY_SWITCH_COUNT_SCENE = 4;
const STORY_SWITCH_COUNT_BLOCK = 4;

/**
 * `g_script_flags[0x15]` -- the flag `StoryModeSwitchUpdate` raises twice:
 * from its **head** (`0x00474FA6`), in Arcade too, and after the scene-2
 * item (`0x004751B1`), behind the mode gate. The only writes of that byte by
 * literal address in the image.
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
 * in -- the `else` arm of the scene-1 despawn test, not a member of
 * {@link STORY_SWITCH_ROUTES} -- and the block of the first item.
 */
export const STORY_SWITCH_FLAG_AT: readonly [number, number] = [2, 2];

/** `CMP BX, 0x4` at `0x004751CC` -- scene 2's second item block. */
const STORY_SWITCH_ITEM_BLOCK_B = 4;

/**
 * The float immediates the two item arms write over `obj+0x19C..0x1A4` for
 * the call and put back after it, as their bit patterns:
 * `0xC3C94CCD 0xC1800000 0xC5468800` at `0x00475141`..`0x00475155` and
 * `0xC479F333 0xC1BE6666 0xC5484B33` at `0x00475208`..`0x0047521C`. Each is a
 * few units from one of stage 3's two doors (`(-391.2, -14.6, -3173.4)` and
 * `(-985.1, -23.7, -3211.9)`).
 */
const STORY_SWITCH_ITEM_A_BITS = [0xc3c94ccd, 0xc1800000, 0xc5468800];
const STORY_SWITCH_ITEM_B_BITS = [0xc479f333, 0xc1be6666, 0xc5484b33];

/**
 * The Original Mode item rows the two arms write into `obj+0x2A0` for
 * `SpawnStoryModeItem` to copy: `MOV [ESI+0x2A0], EDX` with `EDX = 2` at
 * `0x0047512C`, and `MOV dword ptr [ESI+0x2A0], 0x4` at `0x004751ED`.
 */
const STORY_SWITCH_ITEM_ROW_A = 2;
const STORY_SWITCH_ITEM_ROW_B = 4;

/** `MOV word ptr [ESI+0x11C], 2` before each item -- the item's `+0x11C`. */
const STORY_SWITCH_ITEM_WORD_11C = 2;

/** `MOV word ptr [ESI+0x11C], CX` with `CX = 1` at `0x00473AC1`. */
const STORY_SWITCH_WORD_11C = 1;

/** A float immediate, from its bits. `[port-only]` as a function. */
function F32Bits(bits: number): number {
  const b = new DataView(new ArrayBuffer(4));
  b.setUint32(0, bits >>> 0);
  return b.getFloat32(0);
}

/**
 * `g_script_flags[i]` as a **signed** index, as the routine's
 * `CMP byte ptr [EAX + 0x9c7200]` reads it. Scene 4's count re-reads
 * `g_script_flags[obj+0x2A0]` after the route has stored -1 there, which is
 * the byte at `0x009C71FF`, one before the array. `[likely]` zero: no
 * instruction names any of `0x009C71F8..0x009C71FF` by address (the bytes
 * `f8719c00`..`ff719c00` occur nowhere in the image) and it sits between
 * `g_camera_roll_bams` and the array in `.bss`. Whether an indexed write
 * with -1 ever lands there is `[open]`. The port has no byte there and
 * reads it as zero.
 */
function ScriptFlagSigned(i: number): number {
  return i >= 0 ? (G.g_script_flags[i] ?? 0) : 0;
}

/** `CMP g_active_cam_path, 0x46`: on camera path 0x46 the draw is never lit. */
const STORY_SWITCH_UNLIT_CAM_PATH = 0x46;

/**
 * `PlaceStoryModeSwitch` — `FUN_00473A70`. `g_class44_subtypes[17]`.
 *
 * ```
 * obj = ActorAlloc(StoryModeSwitchUpdate, 0x378); ActorClearGameFields(obj);
 * obj+0x19C..0x1A4 = desc+0x40..0x48;  obj+0x1D0 = desc+0x68;  obj+0x68 = 0;
 * obj+0x11C = (s16)1;  obj+0x34 |= 1;
 * tail+0x08 != -1 ?  obj+0x34 |= 0x50
 *                 :  obj+0x34 |= 0x80000000, obj+0x124 = 8.0;
 * obj+0x28C = (s16)tail+0x04;  obj+0x14C = tail+0x08;  obj+0x1DC = tail+0x0C;
 * obj+0x194 = tail+0x00 (a byte);  obj+0x2A0 = (s8)tail+0x10;
 * obj+0x2A4 = (s8)tail+0x11;  obj+0x2A8 = 0;  obj+0x1A8..0x1B0 = tail+0x14..0x1C;
 * obj+0x1FC/0x202/0x208/0x20E = (s16)(s8)tail+0x20..0x23;
 * g_story_switch_thrown = 0;
 * ```
 *
 * `[proved]`, `0x00473A70`..`0x00473B88`. `obj+0x11C` being written as 1
 * rather than copied is why this object does not run
 * `PropExpireByStepLifetime`: `+0x2A4` removes it instead. The placement's
 * `coli` is the raw `tail+0x08`, which the arm tests; `coli_blob` is the
 * same pointer resolved to its blob. A pointer that resolved to nothing
 * leaves a mesh object with no mesh, which no shot can find.
 */
export function PlaceStoryModeSwitch(pl: BreakablePlacement): BreakableProp {
  const p = makeBreakableProp(G.g_breakable_next_id++,
                              ((pl.curve ?? 0) << 24) >> 24, 0);
  p.family = PropFamily.StoryModeSwitch;
  p.at = pl.at;
  p.state = BreakableState.Standing;
  p.routinePhase = StoryModeSwitchPhase.Unthrown;
  p.lastStepIndex = G.g_evt_step_index;
  p.stepsElapsed = 0;
  p.x = pl.pos?.[0] ?? 0;
  p.y = pl.pos?.[1] ?? 0;
  p.z = pl.pos?.[2] ?? 0;
  p.yaw = pl.yaw ?? 0;
  const w = PropWords(p, STORY_SWITCH_WORDS);
  w.o68 = 0;
  p.lifetime = STORY_SWITCH_WORD_11C;
  // `ActorClearGameFields` leaves `obj+0x34` at 0, so the word is `1` and
  // then one arm or the other.
  p.flags = BreakableFlag.Live;
  if ((pl.coli ?? -1) !== -1) {
    p.flags = (p.flags | STORY_SWITCH_MESH_FLAGS) >>> 0;
  } else {
    p.flags = (p.flags | STORY_SWITCH_SPHERE_FLAGS) >>> 0;
    p.hitRadius = STORY_SWITCH_RADIUS;
  }
  p.slot = pl.slot ?? 0;
  p.coliBlob = pl.coli_blob ?? null;
  w.o1dc = pl.side ?? 0;
  p.storyItem = pl.branch_flag ?? -1;
  p.removeFlag = pl.remove_flag ?? -1;
  w.o2a8 = 0;
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
 * draw lands in {@link BreakableProp.draws} (`class41/prop_draw.ts`), and
 * the matrix `MatrixStore` keeps at `obj+0x150` is built on the identity
 * rather than the view, which is the matrix `RegisterForShotTest`'s mesh arm
 * leaves there (`class41/shot_test.ts`).
 */
export function StoryModeSwitchUpdate(p: BreakableProp, rng: Rng,
                                      events?: Events): void {
  PropDrawBegin(p);
  const w = PropWords(p, STORY_SWITCH_WORDS);
  if (p.removeFlag >= 0 && (G.g_script_flags[p.removeFlag] ?? 0) === 1) {
    ActorDespawnProp(p);
    return;
  }
  // An `if`/`else if`, and the `else` is load-bearing: the scene-1 arm is the
  // sweep every prop family answers, and the scene-2 arm is the flag stage
  // 3's block 2 waits on, raised **every frame** while the switch is shut
  // and with no reference to `g_GameMode`.
  if (G.g_scene_index === PROP_SWEEP_SCENE) {
    if ((G.g_script_flags[PROP_SWEEP_FLAG] ?? 0) !== 0) {
      ActorDespawnProp(p);
      return;
    }
  } else if (G.g_scene_index === STORY_SWITCH_FLAG_AT[0]
             && G.g_evt_block_index === STORY_SWITCH_FLAG_AT[1]
             && p.routinePhase === StoryModeSwitchPhase.Unthrown) {
    G.g_script_flags[STORY_SWITCH_SCRIPT_FLAG] = 1;
  }
  if (G.g_GameMode === GameMode.Original) {
    if (p.routinePhase === StoryModeSwitchPhase.Unthrown) {
      // `TEST byte [ESI+0x34], 8; JZ 0x004752B9` -- an unhit switch, or a hit
      // one whose four keys all fail, falls to the latch test.
      if (((p.flags & BreakableFlag.Hit) !== 0
           && (p.key0 === -1 || PlayerHoldsOriginalItem(p.key0)
               || PlayerHoldsOriginalItem(p.key1)
               || PlayerHoldsOriginalItem(p.key2)
               || PlayerHoldsOriginalItem(p.key3)))
          || G.g_story_switch_thrown !== 0) {
        p.routinePhase = StoryModeSwitchPhase.Thrown;
        if (G.g_story_switch_thrown === 0) {
          events?.emit("sound.play", { id: SFX_STORY_SWITCH_KICK });
          // `PoseHookNone(3, 0x14)` (`FUN_00420810`) -- a bare `RET`.
          G.g_story_switch_thrown = 1;
        }
      }
    } else if (p.routinePhase === StoryModeSwitchPhase.Thrown) {
      if (StoryModeSwitchThrownArm(p, w, rng, events)) return;
    }
  }
  // `0x004752EF`: past its sixty frames the switch skips its draw on every
  // odd `obj+0x2AC`, which only scene 4 counts.
  if (!(w.o2a8 >= STORY_SWITCH_HINGE_FRAMES && w.o2ac % 2 !== 0)) {
    const m = PropMatrixPush();
    MatrixTranslate(m, p.x, p.y, p.z);
    MatrixRotateY(m, p.yaw);
    MatrixRotateZ(m, w.o6c);
    MatrixRotateY(m, w.o68);
    MatrixRotateX(m, w.o64);
    MatrixScale(m, p.restX, p.restY, p.restZ);
    // `MaxOfThreeToNoOpStub` (`FUN_00461C20`) hands the largest of the three
    // to an empty stub. `g_scene_lighting && g_active_cam_path != 0x46`
    // (`0x0047538C`..`0x0047539F`) submits through the scene light array.
    if (G.g_scene_lighting !== 0 && G.g_active_cam_path !== STORY_SWITCH_UNLIT_CAM_PATH) {
      PropSubmitSlotWithSceneLightArray(p, m, p.slot);
    } else {
      PropDrawSlot(p, m, p.slot);
    }
    // `MatrixStore(obj+0x150)`.
    ColiStoreObjectMatrix(p, m);
    p.coliMatrixDrawn = true;
  }
  // `RegisterForShotTest`, at `0x004753D7` -- past the draw's pop, and made
  // on the frames the draw is skipped too. The routine forks on bit 0x10.
  PropRegisterForShotTestAsIs(p);
}

/**
 * The arm `obj+0x192 == 1` runs, `0x00474FD8`..`0x00475255`: the swing, the
 * route, scene 4's count and scene 2's items. True when it despawned the
 * switch; every other way out is a jump to the draw at `0x004752EF`.
 *
 * `[port-only]` as a function: the arm is inline in the routine. It is split
 * out because it is most of the routine and has one way in.
 */
function StoryModeSwitchThrownArm(p: BreakableProp, w: StoryModeSwitchWords,
                                  rng: Rng, events?: Events): boolean {
  if (w.o2a8 < STORY_SWITCH_HINGE_FRAMES) {
    const i = w.o2a8;
    // `MOVSX EAX, byte ptr [ESI + 0x194]` -- the curve, signed.
    const f = HingeCurveXYZFrame(p.group, i);
    // A bundle that does not carry the curve leaves the pose where it was;
    // the cursor still runs its sixty frames, as `PropUpdateType56`'s does.
    if (f) {
      w.o6c = (f[2] + p.roll) | 0;
      // `TEST EAX,EAX; JLE` on `obj+0x1DC`: a side of 0 or less mirrors the
      // x angle and negates the yaw.
      if (w.o1dc > 0) {
        w.o64 = (p.pitch + f[0]) | 0;
        w.o68 = f[1];
      } else {
        w.o64 = (p.pitch - f[0]) | 0;
        w.o68 = -f[1] | 0;
      }
    }
    w.o2a8 = i + 1;
  }
  const scene = G.g_scene_index;
  const block = G.g_evt_block_index;
  if (p.storyItem >= 0 && (G.g_script_flags[p.storyItem] ?? 0) === 1) {
    if (STORY_SWITCH_ROUTE_SCENES.includes(scene)) {
      const here = STORY_SWITCH_ROUTES.some(
        ([s, b]) => s === scene && b === block);
      if (!here) return false;
      G.g_script_branch_var = STORY_SWITCH_ROUTE;
      p.storyItem = -1;
    }
  }
  if (scene === STORY_SWITCH_COUNT_SCENE) {
    // `g_script_flags[obj+0x2A0]` read again -- after the route, at -1.
    if (block !== STORY_SWITCH_COUNT_BLOCK
        || ScriptFlagSigned(p.storyItem) === 0) {
      return false;
    }
    const n = w.o2ac;
    w.o2ac = n + 1;
    if (n > STORY_SWITCH_SCENE4_FRAMES) {
      ActorDespawnProp(p);
      return true;
    }
  }
  if (scene !== STORY_SWITCH_FLAG_AT[0]) return false;
  if (block === STORY_SWITCH_FLAG_AT[1]) {
    if (w.o2b0 === 0) {
      StoryModeSwitchItemArm(p, w, STORY_SWITCH_ITEM_ROW_A,
                             STORY_SWITCH_ITEM_A_BITS, rng, events);
    } else {
      // `MOV CL, [0x009c7218]; TEST CL, CL; JZ` -- any non-zero.
      if ((G.g_script_flags[STORY_SWITCH_ITEM_WAIT_FLAG] ?? 0) === 0) {
        return false;
      }
      const n = w.o2b0;
      w.o2b0 = n + 1;
      // `0x004751B1` -- the second writer, behind the mode gate.
      if (n > STORY_SWITCH_SECOND_FLAG_FRAMES) {
        G.g_script_flags[STORY_SWITCH_SCRIPT_FLAG] = 1;
      }
    }
    // `0x004751B8` re-reads the scene and the block, and block 2 is not 4.
    return false;
  }
  if (block === STORY_SWITCH_ITEM_BLOCK_B && w.o2b0 === 0) {
    StoryModeSwitchItemArm(p, w, STORY_SWITCH_ITEM_ROW_B,
                           STORY_SWITCH_ITEM_B_BITS, rng, events);
  }
  return false;
}

/**
 * One of the two item arms (`0x00475123`, `0x004751E4`): `obj+0x2A0` and
 * `obj+0x11C` set for the release, the position swapped for a literal point
 * around `SpawnStoryModeItem` (`FUN_00467B90`), the pick-up block lifted
 * (`g_original_item_pickup_blocked`, `0x00475168` and `0x0047522F`), the
 * position put back, and `obj+0x2A0 = -1`, `obj+0x2B0 = 1` after.
 *
 * `[port-only]` as a function: the two arms are the same instructions with
 * different immediates.
 */
function StoryModeSwitchItemArm(p: BreakableProp, w: StoryModeSwitchWords,
                                row: number, at: readonly number[],
                                rng: Rng, events?: Events): void {
  p.storyItem = row;
  p.lifetime = STORY_SWITCH_ITEM_WORD_11C;
  const x = p.x, y = p.y, z = p.z;
  p.x = F32Bits(at[0]);
  p.y = F32Bits(at[1]);
  p.z = F32Bits(at[2]);
  SpawnStoryModeItem(p, rng, events);
  G.g_original_item_pickup_blocked = 0;
  p.x = x; p.y = y; p.z = z;
  p.storyItem = -1;
  w.o2b0 = 1;
}
