/**
 * Assemble a spawned character: skeleton, placement and motion.
 *
 * `hod2lib/spawnres` answers *what* a spawn is -- its class, its character
 * type, the `pol/` file its parts live in. This module answers the two
 * questions after that:
 *
 * * **How is it built?** `ExeTables.characterSkeleton` gives the bone tree
 *   straight out of the EXE, so a character assembles with no `mot/` data.
 * * **What is it doing?** A character in bind pose is not standing still, it
 *   is a heap: every bone offset runs along its own local X, so zero rotations
 *   pile the parts on top of each other. It has to be posed from a motion
 *   frame to look like anything, and *which* motion is a property of the class
 *   handler.
 *
 * That last point is why this is conservative. `obj+0x1B4` is the motion id
 * and a class handler is the only thing that writes it, so a class earns a
 * motion rule the same way it earns a character-type rule in `spawnres`: by
 * having its handler read. There is deliberately no fallback.
 *
 * A tempting one was tried and rejected. Deriving the bank from the
 * character's bone count *almost* works, but 30 of the 49 banks are 16-bone,
 * so every humanoid would get an arbitrary one of thirty -- and a character
 * posed from another character's animation is worse than a character not posed
 * at all, because it looks like a decoding bug rather than a missing feature.
 *
 * **No re-exports.** This module exports only what it owns; import from the
 * module that owns a name.
 */

import {
  arcScript, CLASS30_ARC_SCRIPTS, CLASS30_ENTRANCE_ARC_SCRIPTS,
} from "./arcscript";
import { civilianItemSlots, civilianMotionIds, civilianMouthRows,
         civilianOrderedStates,
         TARGET_SCRIPT_SHAPE, targetScript,
         targetScriptMotions } from "./actorscript";
import type { CivBlock, TargetScript } from "./actorscript";
import { approachTables, cameraTracking, RING_SET_FOR_CHAR0 } from "./approach";
import { build, goreEntry, rigEntry } from "./charbuild";
import { Boss4SwapSlots } from "../game/class19/slots";
// Data only, as `class25/state.ts` is for `bundle.ts`: the hook's slots.
import { HumanoidHookDrawSlots } from "../game/class25/state";
import { FACE_MODE_TALK, HumanoidFaceSlots } from "../game/class25/face";
import { CIVILIAN_HEAD_BONE, CIVILIAN_MOUTH_HANDOFF_FROM,
         CIVILIAN_MOUTH_HANDOFF_TO } from "../game/class10/mouth";
import type { Character } from "./charbuild";
import { BODY_CREATURE_HOST_CLIPS, CLASS20_DEATH_MOTION,
         CLASS20_IDLE_MOTIONS, CLASS21_FREED_MOTION, CLASS30_DEATH_CLIPS,
         bake, humanoidFaceModes, humanoidModelCommands, humanoidMotionIds,
         introFor, motionFor,
         BOSS3_CLIPS, BOSS4_CLIPS, FROG_CLIPS } from "./charmotion";
import { class31MotionIds, class31Tables } from "./class31";
import { class14Tables } from "./class14";
import { civilianMouthTables, HUMANOID_FACE_CELS, HUMANOID_FACE_CELS_TWO,
         humanoidFaceCels } from "./faces";
import { CLASS32_MOTIONS, class32Tables, class32Tail } from "./class32";
import { boneEffectSlot, boneZones, combatTables, DEATH_LEFT, DEATH_RIGHT,
         deathMotions, difficultyTables, HIT_STEPS,
         PART_SPHERE_FALLBACK_TYPES, partSphereRows, PLAYER_HAND_VARIANTS,
         playerDamage, playerHandSlots, reactionGroups,
         STAND_AND_THROW_STATES } from "./combat";
import * as colilib from "./coli";
import * as degraded from "./degraded";
import * as evtlib from "./evt";
import type { Spawn } from "./evt";
import { ExeTables as ExeTablesClass } from "./exetab";
import type { ExeTables } from "./exetab";
import { attachmentList, BACK_AWAY_STATES, CUE_STATES,
         ENTRANCE_CLIP_STATES, entryTail, GRAB_STATES, LEAP_STATES,
         LEAP_STRIKE_STATES, PATH_STATES, Placement, POUNCE_STATES,
         WALK_DISTANCE_STATES, WAYPOINT_BYTES, entranceTailState }
  from "./placement";
import type { SpawnJson } from "./placement";
import { AssetCache } from "./rigs";
import type { RigInstance } from "./rigs";
import type { Program } from "./script";
import { resolveSpawn } from "./spawnres";
import type { Stage } from "./stage";
// Data only -- see the head of that file for why `hod2lib` may import it.
import { PLAYER_BODY_AT, PLAYER_ENTITY_HOOK_CLIPS, ROUTE_FIGURES }
  from "../game/player_body_data";
// Data only, for the same reason: the result card's clips, its template rows'
// address, and the car rescue's type.
import {
  RESCUE_TARGET_CHAR_TYPE, RESCUE_TARGET_CLASS, RESULT_FIGURE_IDLE_MOTION_BASE,
  RESULT_FIGURE_IDLE_MOTIONS, RESULT_FIGURE_LIFE_MOTION,
  RESULT_FIGURE_LIFE_SLOT, ResultFigureTemplateAt,
} from "../game/class61/state";
// Data only, for the same reason: the clips JUDGMENT's two classes name.
import {
  CLASS22_MOTIONS, CLASS22_NODE2_CYCLE_A, CLASS22_NODE2_CYCLE_B,
  CLASS22_NODE2_SLOT_BASE, CLASS22_SUBACTOR_CHAR_TYPE, CLASS22_SUBACTOR_CLIP,
  CLASS22_SUBACTOR_MOTIONS, Class22SubActorAt,
} from "../game/class22/records";
import { CLASS23_MOTIONS } from "../game/class23/records";
// Data only, for the same reason: every clip the cat's two routines play.
import { CAT_CLIPS } from "../game/class53/records";
// Data only, for the same reason: the golden frog's type, clips and strips.
import {
  GOLDEN_FROG_CHAR_TYPE, GOLDEN_FROG_IDLE_MOTION, GOLDEN_FROG_SHOT_MOTION,
  GOLDEN_FROG_STRIP_SLOTS,
} from "../game/class41/item_pickup_slots";
import { DRAG_TARGET_CLIPS } from "../game/class30/drag_clips";
import { ZombieState } from "../game/class30/states";
import {
  CLASS2D_AT_KIND0, CLASS2D_AT_WING, CLASS2D_CHILD_CHAR_TYPES,
  CLASS2D_CHILD_CLIPS, CLASS2D_CLIPS, CLASS2D_PART_SHELLS,
  CLASS2D_WING_CHAR_TYPE,
  CLASS2D_WING_CLIP, Class2DChildAt,
} from "../game/class2D/state";
// Data only, for the same reason: class 0x41 constructor 61's clips and the
// address each of its figures is known by.
import {
  TYPE61_CONSTRUCTOR, Type61FigureAt, Type61FigureClip,
} from "../game/class41/ctor_literals";
import { type61FigureTypes } from "./class41_ctors";

const finite = (v: number | null | undefined): v is number =>
  v !== null && v !== undefined && Number.isFinite(v);

/**
 * Class 0x20's descriptor tail, as `OneHitTargetInit` reads it.
 *
 * `{i8 char_type; i8 subtype; s16 remove_path; s16 remove_frame; s16 motion}`,
 * and for sub-type 2 four more floats at `+0x08`..`+0x14` bounding the actor's
 * x and z.
 *
 * **The same eight bytes are three different things across classes** -- class
 * 0x30 reads `+0x01`/`+0x02`/`+0x03` as the body condition, the initial state
 * and the attack state -- so this is gated on the class and emitted under a
 * class-named key rather than into the shared fields.
 */
export function class20Tail(rec: Spawn): Record<string, unknown> {
  const subtype = rec.param(0x01, "i8") || 0;
  let box: (number | null)[] | null = null;
  if (subtype === 2) {
    const v = [0x08, 0x0c, 0x10, 0x14].map((o) => rec.param(o, "f32"));
    if (v.every(finite)) box = v;
  }
  return {
    subtype,
    remove_path: rec.param(0x02, "i16") || 0,
    remove_frame: rec.param(0x04, "i16") || 0,
    // 0 is a value here and not an absence: it means the random draw from
    // `g_class20_idle_motions`, which is the port's to make.
    motion: rec.param(0x06, "i16") || 0,
    box,
  };
}

/**
 * Class 0x52's descriptor tail, as `Class52Init` reads it.
 *
 * One s16 at `+0x00`: the **subtype**. 0 and 1 wander and self-despawn; 2, 3
 * and 4 run `Class52BranchTriggerUpdate`, a shootable route-branch trigger,
 * and only while `g_GameMode == 1`.
 */
/**
 * Classes whose actors are drawn by `AssetDrawSlot` rather than by a skeleton,
 * so `spawnres` can never identify one and the placement has to survive that
 * anyway. See the note in `resolveForStage`.
 *
 * Classes 0x16 and 0x17 draw nothing at all -- `WaterFieldCreate` and
 * `WaterWaveSourceAdd` build the stage-2 boss arena's wave field and kill
 * themselves -- but they are here for the same reason: no character type,
 * and the port still needs the placement to build them. So is class 0x2B,
 * a scripted light (`DynamicLightInit`, `FUN_00438060`), which draws nothing
 * and reads only `desc+0x22`, the placement's `hp`.
 */
export const SLOT_DRAWN_CLASSES = new Set([0x12, 0x13, 0x15, 0x16, 0x17, 0x26,
                                           0x29, 0x2b, 0x33, 0x40, 0x42, 0x43,
                                           0x51, 0x52]);

/**
 * Class 0x17's descriptor tail, as `WaterWaveSourceAdd` (`FUN_004422D0`) and
 * the source's first tick read it.
 *
 * ```
 * obj+0x11C  s16  the kind: g_wave_source_kinds[kind] (0x005644E4) is
 *                 {tick, size}, 0 travelling (0x004420C0), 1 circular
 *                 (0x004421B0)                          -> the spawn's hp
 * tail+0x00  f32  amplitude                             -> src+0x5C
 * tail+0x04  f32  wavelength                            -> src+0x60
 * tail+0x08  f32  speed                                 -> src+0x64
 * obj+0x64 / +0x6C  pitch and roll                      -> src+0x48 / +0x50
 * ```
 *
 * The source's position and yaw are the spawn record's own, which the port
 * has from the script. Stage 2 blocks 35 and 39 place two, both kind 0.
 */
export function class17Tail(rec: Spawn, orient: number[]):
    Record<string, unknown> {
  const f = (at: number): number => rec.param(at, "f32") ?? 0;
  return {
    kind: rec.hp,
    amplitude: f(0x00),
    wavelength: f(0x04),
    speed: f(0x08),
    pitch: ((orient[0] ?? 0) << 16) >> 16,
    roll: ((orient[2] ?? 0) << 16) >> 16,
  };
}

export function class52Tail(rec: Spawn): Record<string, unknown> {
  return { subtype: rec.param(0x00, "i16") || 0 };
}

/**
 * Class 0x51's descriptor tail, as `FishInit` (`FUN_00438540`) reads it.
 *
 * ```
 * tail+0x00  f32  the x speed toward the camera -- or, on a group header,
 *                 the water level itself
 * tail+0x04  f32  the z speed
 * tail+0x08  f32  how far the surface bob swings
 * tail+0x0C  i16  0 draws solid and casts a surface shadow, 1 fades in
 * tail+0x0E  i16  the sub-type -- and **6 means this record is not a fish**
 * tail+0x10  i16  frames spent rising
 * tail+0x12  i16  bob cycles to sit through before it may lunge
 * tail+0x14  i16  frames the lunge lasts
 * ```
 *
 * The header is the reason `water_level` is carried beside `speed_x` rather
 * than instead of it: they are the same four bytes, read as different things
 * by the two arms of the Init, and which arm runs is decided by `subtype`.
 * Seven of the twenty-eight shipped class-0x51 descriptors are headers.
 *
 * Its own block for the reason class 0x20's and class 0x52's are: `tail+0x00`
 * is class 0x30's body condition.
 */
/**
 * Class 0x11's descriptor tail, as `FrogInit` (`FUN_0043A080`) and
 * `FrogArmScriptFromDescriptorTail` (`FUN_0043A670`) read it.
 *
 * ```
 * tail+0x00  u16  character type -- 0x1B, frog.bin, in all four
 * tail+0x02  s16  the motion it starts in -- 0x141 in all four
 * tail+0x04  s16  the camera path state 0 waits for
 * tail+0x06  s16  ...and the frame
 * tail+0x08  u16  the heading wedge; 0 means "the half-FOV less 0x200"
 * tail+0x0A  ...  the command list: s16 opcodes, 0xFFFF terminated
 * ```
 *
 * **The opcode is the state.** Its low byte goes straight into `sub+0x04`, and
 * only two of the eight carry operands: 0 takes a camera path, a frame and a
 * motion, and 3 takes one absolute heading. There is no jump and no loop -- at
 * the terminator the cursor stops for good and the class's own chooser takes
 * over, so the list is a prologue rather than a program.
 *
 * The list is decoded here rather than carried raw because its length is not
 * self-describing and the operand count is per opcode: a client reading the
 * bytes would have to know the grammar to know where the next opcode is.
 */
/**
 * Class 0x43's descriptor "tail", which is two bytes.
 *
 * All fourteen shipped spawns use `spawn_placed` (0x09), so there is no
 * parameter block at all: `EvtOpSpawnPlaced09` (`FUN_004088A0`) reads
 * `desc+0x24` into `obj+0x1F4` and `desc+0x25` into `obj+0x130C` inline. The
 * first is 0 in every record and the second is the **sub-type**, 0 to 3.
 *
 * The **member index** is `desc+0x22 - 1`, which the allocator has already put
 * in `hp`. It selects the launch delay, the retreat climb and the row of
 * `g_class43_approach_curves` the owl flies. Stage 2 block 5's two sub-type-0
 * records reuse indices 0 and 1, which the port copies rather than tidies --
 * see `game/class43/`.
 */
/**
 * Class 0x13's descriptor tail — the whole of what `ScriptedPropInit13`
 * (`FUN_0043FE10`) reads before it hands the object to a behaviour.
 *
 * The class has no character type and no skeleton: it is one asset slot drawn
 * under a matrix, so the bundle carries the tail and nothing else.
 *
 * ```
 * +0x00 u16  the draw slot, into obj+0x1F4
 * +0x04 u32  a pointer or -1, into obj+0x14C; no ported behaviour reads it
 * +0x08 u16  the camera path that despawns it
 * +0x0A u16  ...and the frame on that path
 * +0x0C f32  a uniform scale, applied only when it is not 1.0
 * +0x10 u32  an index into g_prop_behaviours (0x005926A8)
 * +0x14 ...  the behaviour's own operand block. For behaviour 8,
 *            `CarrierPropSelectRoutine`, the first dword is the routine;
 *            for 7, `PropBehaviourRideObjectPath` (`FUN_004400D0`), the
 *            `op_` path slot; for 6, `PropBehaviourLaunchWithAccel`
 *            (`FUN_0043FFC0`), two f32 vectors, the launch velocity and the
 *            acceleration, turned by the record's angles.
 * ```
 *
 * `selector` is emitted for every spawn and is meaningless unless `behaviour`
 * is 7 or 8 — five of the game's 23 spawns take behaviour 0, `NoOpStub`, and
 * are static props whose `+0x14` is `-1`. `operand` (the six floats) is
 * emitted for behaviour 6 alone and `path_length` --
 * `g_cam_path_length[selector]` (`0x00576D38`), the one table entry 7 reads
 * besides the tail -- for behaviour 7 alone: each only where its reader is.
 * No shipped descriptor takes either behaviour, so no shipped bundle carries
 * either field.
 */
/**
 * Class 0x18's three numbers, and they are all read out of the class-0x30
 * parameter tail it shares.
 *
 * `CarriedZombieUpdate18` (`FUN_0045CD90`) tests
 * `obj+0x1310 == (s8)tail[3] && obj+0x1312 == 0 && tail+0x0C != -1 &&
 * g_cam_path_frame < tail+0x0E && g_active_cam_path == tail+0x0C`, so the
 * byte is the state it leaves *from* and the two words are the camera cue that
 * lets it. All three shipped spawns carry state 48 on path 124 frame 1080,
 * which is the shot stage 3's block 0 step 6 is playing.
 *
 * Separate from class 0x30's `camera_cue` on purpose: that one is gated on the
 * spawn being a captor, because read blind those bytes are mantissa 330 times
 * out of 333. This class reads them on every spawn and guards with the `-1`.
 */
export function class18Tail(rec: Spawn): Record<string, unknown> {
  const b = rec.evt?.raw;
  const at = rec.offset + 0x24;
  const s8 = (v: number | undefined) => ((v ?? 0) << 24) >> 24;
  return {
    from_state: b ? s8(b[at + 3]) : -1,
    cue_path: rec.param(0x0c, "i16") ?? -1,
    cue_frame: rec.param(0x0e, "i16") ?? -1,
  };
}

/** Class 0x26's subtype, `obj+0x11C`, for the routines this library reads. */
export const CLASS26_BOAT = 2;
/**
 * ...and the two `Class26Subtype67Update` (`FUN_0048F930`) takes -- stage 6
 * block 12's pair. They read no descriptor tail; the placement is what makes
 * the port build the actor at all.
 */
export const CLASS26_ON_PATH = [6, 7];

/**
 * Class 0x26 subtype 2's descriptor tail, as `Class26Subtype2Update`
 * (`FUN_0048EAD0`) reads it on its first frame:
 *
 * ```
 * 0048eb14  8b00          MOV EAX, dword ptr [EAX]        ; EAX = obj+0x1390
 * 0048eb16  89864c010000  MOV dword ptr [ESI + 0x14c], EAX
 * ```
 *
 * One dword, `tail+0x00`, and it is a **relocated pointer** into the collision
 * buffers -- the same kind of operand opcodes 0x10/0x11 carry -- so it is
 * resolved here to the `"<file>:<offset>"` key the bundle's `coli.blobs` is
 * keyed by. Stage 3's one spawn, descriptor 3244, names `coli3.bin` at 0x9C08:
 * 23 quads of surface 53, the boat's foredeck in the boat's own space. A
 * pointer that lands on no blob header is `null`, which is what a wrong
 * reading would look like.
 */
export function class26Tail(
    rec: Spawn,
    sets: [colilib.ColiFile, colilib.ColiFile] | null): Record<string, unknown> {
  // Subtypes 6 and 7 read nothing past the descriptor's own 36 bytes, so
  // there is no word to resolve: the next descriptor starts where a tail
  // would be.
  if (rec.hp !== CLASS26_BOAT) return { coli: null };
  const word = rec.param(0x00, "u32");
  const hit = word !== null && sets
    ? colilib.pointerToOffset(word, sets[0], sets[1]) : null;
  return { coli: hit ? `${hit[0]}:${hit[1]}` : null };
}

/**
 * Class 0x19's descriptor tail, as `Boss4Init` (`FUN_004917E0`) and
 * `Boss4Update` (`FUN_004919D0`) read it.
 *
 * * `+0x00` the character type (0x4A, `boss4.bin`) and `+0x01` the entrance,
 *   the index into `g_class19_states` the boss starts in (0..3, one per
 *   shipped spawn).
 * * `+0x04`..`+0x3C`, fifteen dwords -- one per skeleton bone 1..15 --
 *   copied into each bone record's `+0x88`. Each is `-1` or a **relocated
 *   pointer into the collision buffers** (`0x0CEDxxxx`), the same kind of
 *   operand opcodes 0x10/0x11 carry; `ShotTestBoneTree` (`FUN_00404750`)
 *   tests a bone with one against that blob in the bone's own space
 *   (`ShotTestBoneMesh`, `FUN_004048A0`) instead of its hit sphere. Resolved
 *   here to the `"<file>:<offset>"` key `coli.blobs` is keyed by: ten land
 *   on `coli4.bin` blobs, bones 2, 8, 9, 12 and 15 are `-1`.
 * * `+0x40`/`+0x42` the camera path and frame that despawn it
 *   (`Boss4Update`'s tail, `0x00491AF5`..).
 */
export function class19Tail(
    rec: Spawn,
    sets: [colilib.ColiFile, colilib.ColiFile] | null): Record<string, unknown> {
  const boneColi: (string | null)[] = [];
  for (let i = 0; i < 15; i++) {
    const word = rec.param(0x04 + i * 4, "u32");
    if (word === null || word === 0xffffffff) { boneColi.push(null); continue; }
    const hit = sets ? colilib.pointerToOffset(word, sets[0], sets[1]) : null;
    boneColi.push(hit ? `${hit[0]}:${hit[1]}` : null);
  }
  return {
    char_type: rec.param(0x00, "u8") ?? 0,
    entrance: rec.param(0x01, "u8") ?? 0,
    bone_coli: boneColi,
    despawn_path: rec.param(0x40, "i16") ?? 0,
    despawn_frame: rec.param(0x42, "i16") ?? 0,
  };
}

/**
 * The character types whose arm of `EnemyZombieInitByCharType`
 * (`FUN_00452FD0`) reads the tail's `+0x10`: 2 and 3 share one arm (case 2
 * falls into case 3) and 0xE has its own.
 */
export const ZOMBIE_BONE_MESH_TYPES: ReadonlySet<number> = new Set([2, 3, 0xe]);

/**
 * Class 0x30's tail `+0x10`, for the three character types whose arm of
 * `EnemyZombieInitByCharType` reads it:
 *
 * ```
 * case 2, 3:  rec(5)+0x74 |= 0x51; rec(5)+0x88 = tail+0x10; rec(5)+0x78 = 0
 *             rec(8)+0x74 |= 0x51; rec(8)+0x88 = tail+0x10; rec(8)+0x78 = 0
 * case 0xE:   rec(5)+0x74 |= 0x51; rec(5)+0x88 = tail+0x10; rec(5)+0x78 = 0
 * ```
 *
 * The same kind of word class 0x19's bones carry -- a relocated pointer
 * into the collision buffers, which `ShotTestBoneTree` (`FUN_00404750`)
 * tests the bone against instead of its sphere -- resolved to the `coli.blobs`
 * key the same way. Every shipped spawn of the three resolves: 14 of type 2
 * (stages 1 and 2), 11 of 0xE (stage 4), 9 of 3 (stage 6). Class 0x18 is
 * `EnemyZombieInit` and two stores (`CarriedZombieInit18`, `FUN_0045CD60`), so
 * its tail is read the same way.
 *
 * Gated on the character type, because `+0x10` is something else for every
 * other type (L3).
 */
export function zombieBoneMeshColi(
    rec: Spawn, charType: number | null,
    sets: [colilib.ColiFile, colilib.ColiFile] | null): string | null {
  if (charType === null || !ZOMBIE_BONE_MESH_TYPES.has(charType)) return null;
  const word = rec.param(0x10, "u32");
  if (word === null || word === 0xffffffff || !sets) return null;
  const hit = colilib.pointerToOffset(word, sets[0], sets[1]);
  return hit ? `${hit[0]}:${hit[1]}` : null;
}

/**
 * Class 0x12's descriptor tail — every field `ScriptedPropInit12`
 * (`FUN_0043F9D0`) reads out of `obj+0x130C`, at the width it reads it:
 *
 * ```
 * +0x00 s16  the slot drawn until the flag      -> (float) sub+0x14
 * +0x02 s16  the delay, once the flag is up     -> sub+0x04
 * +0x04 u32  a relocated coli pointer, or -1    -> obj+0x14C (the shot mesh)
 * +0x08 s16  an index into g_prop_behaviours    -> sub+0x00
 * +0x0A s16  the camera path that despawns it   -> sub+0x06
 * +0x0C s16  ...and the frame on it             -> sub+0x08
 * +0x0E s16  the strip's first slot             -> sub+0x0A
 * +0x10 s16  ...and its last                    -> sub+0x0C
 * +0x12 s16  the script flag that starts it, -1 -> sub+0x0E
 * +0x14 f32  the cursor's step a frame          -> sub+0x18
 * +0x18 f32  a uniform scale                    -> sub+0x10
 * ```
 *
 * `[proved]`, `0x0043F9EC`..`0x0043FA49`. The pointer resolves to the
 * `coli.blobs` key the way {@link class26Tail}'s does.
 */
export function class12Tail(
    rec: Spawn,
    sets: [colilib.ColiFile, colilib.ColiFile] | null): Record<string, unknown> {
  const word = rec.param(0x04, "u32");
  const hit = word !== null && word !== 0xffffffff && sets
    ? colilib.pointerToOffset(word, sets[0], sets[1]) : null;
  return {
    slot: rec.param(0x00, "i16") ?? 0,
    delay: rec.param(0x02, "i16") ?? 0,
    coli: hit ? `${hit[0]}:${hit[1]}` : null,
    behaviour: rec.param(0x08, "i16") ?? 0,
    cam_path: rec.param(0x0a, "i16") ?? -1,
    cam_frame: rec.param(0x0c, "i16") ?? -1,
    first: rec.param(0x0e, "i16") ?? 0,
    last: rec.param(0x10, "i16") ?? 0,
    flag: rec.param(0x12, "i16") ?? -1,
    step: rec.param(0x14, "f32") ?? 0,
    scale: rec.param(0x18, "f32") ?? 1,
  };
}

/**
 * Class 0x15's descriptor tail, as `FloatingPropRowSpawn` (`FUN_00441750`)
 * reads it through `obj+0x130C`:
 *
 * ```
 * +0x00  s16  the slot every plank draws           -> plank+0x1F4
 * +0x04  u32  a coli blob pointer, -1 for none      -> plank+0x14C
 * +0x08  s16  the g_prop_behaviours index           -> sub+0x00
 * +0x0A  s16  the camera path that kills a plank    -> sub+0x06
 * +0x0C  s16  ...and its frame                       -> sub+0x08
 * +0x0E  s16, +0x10 s16  copied, read by nothing   -> sub+0x0A, sub+0x0C
 * +0x12  s16  the script flag that starts the delay -> sub+0x0E
 * +0x18  f32 x3  the step between planks
 * +0x24  s8   the count
 * +0x25  s8   how many of the last never leave on the flag
 * +0x26  s16  the delay step between the ones that do
 * ```
 *
 * `+0x14` (1.0 in both shipped descriptors) is read by neither the routine
 * nor the plank's update, so it is not carried. Every width is the load's:
 * `MOVSX` byte for `+0x24`/`+0x25`, word moves into the block and `MOVSX`
 * word where the update reads them back. See `game/class15/`.
 */
export function class15Tail(
    rec: Spawn,
    sets: [colilib.ColiFile, colilib.ColiFile] | null): Record<string, unknown> {
  const word = rec.param(0x04, "u32");
  const hit = word !== null && word !== 0xffffffff && sets
    ? colilib.pointerToOffset(word, sets[0], sets[1]) : null;
  return {
    slot: rec.param(0x00, "i16") ?? 0,
    coli: hit ? `${hit[0]}:${hit[1]}` : null,
    behaviour: rec.param(0x08, "i16") ?? 0,
    cam_path: rec.param(0x0a, "i16") ?? -1,
    cam_frame: rec.param(0x0c, "i16") ?? -1,
    word_0e: rec.param(0x0e, "i16") ?? 0,
    word_10: rec.param(0x10, "i16") ?? 0,
    flag: rec.param(0x12, "i16") ?? -1,
    delta: [rec.param(0x18, "f32") ?? 0, rec.param(0x1c, "f32") ?? 0,
            rec.param(0x20, "f32") ?? 0],
    count: rec.param(0x24, "i8") ?? 0,
    keep: rec.param(0x25, "i8") ?? 0,
    delay_step: rec.param(0x26, "i16") ?? 0,
  };
}

/** `g_prop_behaviours[6]` and `[7]`, the two that read more than `selector`. */
export const PROP13_LAUNCH_WITH_ACCEL = 6;
export const PROP13_RIDE_OBJECT_PATH = 7;

export function class13Tail(rec: Spawn,
                            tables: ExeTables): Record<string, unknown> {
  const behaviour = rec.param(0x10, "u32") ?? 0;
  const selector = rec.param(0x14, "u32") ?? 0;
  const out: Record<string, unknown> = {
    slot: rec.param(0x00, "u16") ?? 0,
    cam_path: rec.param(0x08, "u16") ?? -1,
    cam_frame: rec.param(0x0a, "u16") ?? -1,
    scale: rec.param(0x0c, "f32") ?? 1,
    behaviour,
    selector,
  };
  if (behaviour === PROP13_LAUNCH_WITH_ACCEL) {
    // `pfVar2 = *(sub+0x08)`, `pfVar2[0..2]` and `pfVar2[3..5]`.
    out.operand = [0, 1, 2, 3, 4, 5].map((k) =>
      rec.param(0x14 + 4 * k, "f32") ?? 0);
  }
  if (behaviour === PROP13_RIDE_OBJECT_PATH) {
    // `CMP EDX, [EDI*4 + 0x576D38]` at `0x0044010C`, EDI = the first dword.
    out.path_length = tables.camPathLength(selector);
  }
  return out;
}

export function class43Tail(rec: Spawn): Record<string, unknown> {
  const b = rec.evt?.raw;
  const at = rec.offset + 0x24;
  const s8 = (v: number | undefined) => ((v ?? 0) << 24) >> 24;
  return {
    subtype: b ? s8(b[at + 1]) : 0,
    member: Math.max(0, (rec.hp ?? 1) - 1),
  };
}

/**
 * Class 0x42's descriptor byte: `desc+0x25`, the sub-type.
 *
 * Every one of the three spawns uses `spawn_placed` (0x09), whose allocator
 * copies `desc+0x25` into `obj+0x130C`, and `PlaceWormBatch` (`FUN_0042F9B0`)
 * switches on nothing else: 0 the cog's batch, 1 the lone drop, 2 the large
 * batch. The count, the offsets and every per-member number are in the EXE,
 * and the position and yaw are the spawn record's. See `game/class42/`.
 */
export function class42Tail(rec: Spawn): Record<string, unknown> {
  const b = rec.evt?.raw;
  const at = rec.offset + 0x25;
  return { subtype: b ? ((b[at] ?? 0) << 24) >> 24 : 0 };
}

/**
 * Class 0x29's descriptor tail, as `SceneryBatchUpdate29` (`FUN_00432C80`)
 * reads it through `obj+0x1390`:
 *
 * ```
 * tail+0x00  s16  the camera path that ends it  (MOVSX EDX,[EAX])
 * tail+0x02  s16  ...from this frame on         (MOVSX EAX,[EAX+0x2])
 * ```
 *
 * The list it draws is `obj+0x11C`, the spawn's `hp`. All three shipped
 * spawns use `spawn_obj` (0x0B), whose allocator sets `obj+0x1390` to
 * `desc+0x24`. See `game/class29/`.
 */
export function class29Tail(rec: Spawn): Record<string, unknown> {
  return {
    kill_path: rec.param(0x00, "i16") ?? -1,
    kill_frame: rec.param(0x02, "i16") ?? 0,
  };
}

/**
 * Class 0x46's descriptor, which is three numbers and nothing else.
 *
 * Every one of the 27 spawns uses `spawn_placed` (0x09), so there is no
 * parameter block: `EvtOpSpawnPlaced09` (`FUN_004088A0`) reads `desc+0x24`
 * into `obj+0x1F4` and `desc+0x25` into `obj+0x130C` inline, and `PlaceBats`
 * (`FUN_0042D9C0`) reads both back off the placer.
 *
 * * `desc+0x25` is the **sub-type**, and it decides which of three routines
 *   the members run. Twenty-four spawns carry 0, one carries 1 and two carry 2.
 * * `desc+0x24` is the **flight group**, 0..3, and only sub-type 0 reads it.
 *   It is `obj+0x1F4` on the placer, which for every other opcode-0x09 class
 *   is the character type -- the reason `spawnres` gives class 0x46 a literal
 *   rule rather than `desc24`.
 * * The **member index** is `desc+0x22 - 1`, which the allocator has already
 *   put in `hp`. It picks the launch delay and, with the group, the row of
 *   `g_bat_spline_points` the bat flies.
 *
 * The position is **not** here and is not in the descriptor at all: all
 * twenty-four sub-type-0 records sit at the world origin and take their whole
 * path from a table in the EXE. See `game/class46/`.
 */
/** Class 0x46, and the sub-type whose members are one per descriptor. */
const CLASS46 = 0x46;
const CLASS46_SUBTYPE_DIVE = 0;
/**
 * The two sub-types whose members are **runtime children** of the placer, and
 * the most members each makes: `PlaceBats` (`FUN_0042D9C0`) loops `0x19` times
 * for sub-type 1 and `((1 < g_players_in_play) - 1 & ~1) + 8` times for
 * sub-type 2 -- six with one player, eight with two. The rows are for the most
 * a game can make; a one-player swarm leaves two of them unadopted.
 */
const CLASS46_CHILD_MEMBERS: Readonly<Record<number, number>> = {
  1: 0x19,
  2: 8,
};
/** `zabat.bin` -- `obj+0x1F4 = 0x1E` and clip `0x407`, in every arm. */
const CLASS46_BODY_CHAR_TYPE = 0x1e;
/** `zabat_wing.bin` — six nodes, and the clip `BatWingUpdate` settles on. */
const CLASS46_WING_CHAR_TYPE = 0x1f;
const CLASS46_WING_CLIP = 0x406;
/**
 * `[port-only]` — the spawn address the port's `SpawnBatWings` gives a wing.
 *
 * The engine keys nothing on an address; the port's pool does, so a placer's
 * child needs one, and it takes its body's with bit 30 set. One definition,
 * here and in `game/class46/` (`BatWingAt`), and `web/tools/repo/port.ts` has no way
 * to check that they agree — so the two carry each other's names in a
 * comment, and `render.test.ts` adopts one through the other.
 */
const CLASS46_WING_AT_BIT = 0x40000000;

/**
 * `[port-only]` — the spawn address the port's `PlaceBats` gives member
 * `member` of a sub-type-1 or sub-type-2 placer: bit 29, the sub-type in bits
 * 25..26, the member in bits 20..24 (the scatter has twenty-five) and the
 * placer's own address below. The other half of the pair is `BatChildAt` in
 * `game/class46/`; the same arrangement as {@link hordeMemberAt}.
 */
export function batChildAt(placerAt: number, subtype: number,
                           member: number): number {
  return 0x20000000 | ((subtype & 0x3) << 25) | ((member & 0x1f) << 20)
    | (placerAt & 0xfffff);
}

/**
 * The synthetic placement a bat's wings are drawn from, and the character
 * type it needs in the bundle.
 *
 * `bodyAt` is the address of the body it rides and `parentAt` the placement
 * that makes the row wanted: the body's own descriptor for a sub-type-0 bat,
 * the placer's for a member of the other two -- a member's row is itself
 * synthetic, and parenting one synthetic row to another would make whether it
 * is wanted depend on the order the layer walks them in.
 *
 * Returns null when the wing's own asset or clip will not build, which leaves
 * the bat wingless rather than emitting a row nothing can pose.
 */
async function batWingPlacement(stage: Stage, tables: ExeTables,
                                bodyAt: number, parentAt: number,
                                body: Placement,
                                chars: Map<number, Character>):
    Promise<Placement | null> {
  const ct = CLASS46_WING_CHAR_TYPE;
  if (!chars.has(ct)) {
    const file = tables.characterAssetFile(ct);
    if (!file) return null;
    const built = build(tables, ct, file);
    if (built === null) return null;
    chars.set(ct, built);
  }
  const c = chars.get(ct)!;
  if (!c.motions.has(CLASS46_WING_CLIP)) {
    const baked = await bake(stage.source, tables, CLASS46_WING_CLIP,
                             c.boneCount);
    if (baked === null) return null;
    c.motions.set(CLASS46_WING_CLIP, baked);
  }
  const w = new Placement();
  w.at = bodyAt | CLASS46_WING_AT_BIT;
  w.cls = CLASS46;
  w.char_type = ct;
  w.motion = CLASS46_WING_CLIP;
  w.hp = 0;
  // The body's own spawn dict, so the wing's node lands where the body's does
  // and `toJson` finds an orientation. `BatWingUpdate` moves it from there on
  // its first frame.
  w.spawn = { ...body.spawn, at: w.at };
  w.parent_at = parentAt;
  w.synthetic = true;
  return w;
}

/**
 * The synthetic placement one member of a sub-type-1 or sub-type-2 placer is
 * drawn from: character type `0x1E` on clip `0x407`, at {@link batChildAt},
 * parented to the placer. The same arrangement as the horde's members
 * ({@link hordeMemberPlacements}): `PlaceBats` makes the object and the
 * character layer adopts it, and nothing spawns from the row.
 *
 * `placer` is the placer's own row, which has already resolved and baked the
 * body's type and clip.
 */
function batChildPlacement(sp: SpawnJson, placer: Placement, subtype: number,
                           member: number): Placement {
  const b = new Placement();
  b.at = batChildAt(sp.at as number, subtype, member);
  b.cls = CLASS46;
  b.char_type = CLASS46_BODY_CHAR_TYPE;
  b.motion = placer.motion;
  b.hp = 0;
  b.spawn = { ...sp, at: b.at };
  b.parent_at = sp.at as number;
  b.synthetic = true;
  return b;
}

/** `znele.bin`: the character type whose `Init` arm allocates a twin. */
const ZOMBIE_TWIN_HOST_CHAR_TYPE = 0x12;
/** `znjikken1.bin`: `MOV word ptr [EBX + 0x1f4], 0x9` at `0x00453249`. */
const ZOMBIE_TWIN_CHAR_TYPE = 9;
/**
 * `TEST EAX, 0x10000000` at `0x004531DA`: a `znele` whose spawn record sets
 * this `obj+0x34` bit allocates no twin. Two of stage 6's thirteen do.
 */
const ZOMBIE_TWIN_SUPPRESS_FLAG = 0x10000000;
/**
 * `[port-only]` — the bit a twin's spawn address carries over its host's.
 * The other half of the pair is `ZOMBIE_TWIN_AT_BIT` / `ZombieTwinAt` in
 * `game/class30/twin.ts`; nothing can check the two agree, so each names the
 * other, and `web/test/port/` holds them equal.
 */
const ZOMBIE_TWIN_AT_BIT = 0x08000000;

/** The twin's spawn address for a host at `hostAt`. */
export function zombieTwinAt(hostAt: number): number {
  return (hostAt | ZOMBIE_TWIN_AT_BIT) >>> 0;
}

/**
 * The synthetic placements `znele`'s twins are drawn from: one per class-0x30,
 * character-type-0x12 row whose `init_flags` lack 0x10000000, character type 9
 * at {@link zombieTwinAt}, parented to the host so it is wanted exactly while
 * the host is.
 *
 * The twin plays whatever clip its host is on -- `ZombieTwinFollowHost`
 * (`FUN_00453290`) copies `obj+0x1B4` and the frame counters every frame --
 * so every clip baked for the host's type is offered for the twin's; `bake`
 * refuses any that does not fit its skeleton. Returns none when the type will
 * not build, which leaves each `znele` without its ghost rather than emitting
 * a row nothing can pose.
 */
async function zombieTwinPlacements(stage: Stage, tables: ExeTables,
                                    placements: readonly Placement[],
                                    chars: Map<number, Character>):
    Promise<Placement[]> {
  const hosts = placements.filter((p) => p.cls === 0x30 && !p.synthetic
    && p.char_type === ZOMBIE_TWIN_HOST_CHAR_TYPE && p.motion !== null
    && (p.init_flags & ZOMBIE_TWIN_SUPPRESS_FLAG) === 0);
  const hostType = chars.get(ZOMBIE_TWIN_HOST_CHAR_TYPE);
  if (!hosts.length || !hostType) return [];
  const ct = ZOMBIE_TWIN_CHAR_TYPE;
  if (!chars.has(ct)) {
    const file = tables.characterAssetFile(ct);
    if (!file) return [];
    const built = build(tables, ct, file);
    if (built === null) return [];
    chars.set(ct, built);
  }
  const c = chars.get(ct)!;
  for (const mid of [...hostType.motions.keys()].sort((a, b) => a - b)) {
    if (c.motions.has(mid)) continue;
    const baked = await bake(stage.source, tables, mid, c.boneCount);
    if (baked !== null) c.motions.set(mid, baked);
  }
  const out: Placement[] = [];
  for (const h of hosts) {
    if (!c.motions.has(h.motion!)) continue;
    const t = new Placement();
    t.at = zombieTwinAt(h.at);
    t.cls = 0x30;
    t.char_type = ct;
    t.motion = h.motion;
    t.hp = 0;
    t.spawn = { ...h.spawn, at: t.at };
    t.parent_at = h.at;
    t.synthetic = true;
    out.push(t);
  }
  return out;
}

/**
 * The synthetic placement a player's body is drawn from on the game-over
 * screen and in play, and the character type it needs in the bundle.
 *
 * `PlayerBodiesCreate` (`FUN_00416450`) allocates a skinned actor per player
 * with no spawn record behind it, and the route map's figures
 * (`GameOverSpawnPlayerFigure`, `GameOverSpawnPartnerFigure`) are the same two
 * character types again -- so, as for the bat's wings, the bundle carries a
 * row per type to hang the geometry on, at the address the port knows player
 * `p`'s type by (`PLAYER_BODY_AT`). Nothing spawns from it; the pose in the row
 * is the world origin, facing -Z.
 *
 * Every clip the screen can draw that type on is baked: the start motion
 * (`0x004EC8A4`), the fall (`0x004EC8B4`) -- both read from the exe -- and
 * the route figures' walk and end clips where the figure is this type -- and
 * every clip the `+0x80` hooks put a body on in play: their four immediates
 * (`PLAYER_ENTITY_HOOK_CLIPS`) and `g_player_stand_motions` (`0x004EC91C`)
 * entries 2..5, the ones `p + g_players_in_play * 2` can name.
 * Returns null when the type or the fall will not build, which leaves the
 * screen with no body rather than a heap.
 */
async function playerBodyPlacement(stage: Stage, tables: ExeTables,
                                   player: number,
                                   chars: Map<number, Character>):
    Promise<Placement | null> {
  const go = tables.gameOverTables() as {
    body_char_types: number[]; body_start_motions: number[];
    fall_motions: number[]; stand_motions: number[];
  };
  const ct = go.body_char_types[player];
  const fall = go.fall_motions[player];
  if (!chars.has(ct)) {
    const file = tables.characterAssetFile(ct);
    if (!file) return null;
    const built = build(tables, ct, file);
    if (built === null) return null;
    chars.set(ct, built);
  }
  const c = chars.get(ct)!;
  const clips = [fall, go.body_start_motions[player],
                 ...ROUTE_FIGURES.filter((f) => f.charType === ct)
                   .flatMap((f) => [f.walk, f.end]),
                 ...PLAYER_ENTITY_HOOK_CLIPS,
                 ...go.stand_motions.slice(2)];
  for (const mid of clips) {
    if (c.motions.has(mid)) continue;
    const baked = await bake(stage.source, tables, mid, c.boneCount);
    if (baked !== null) c.motions.set(mid, baked);
  }
  if (!c.motions.has(fall)) return null;
  const b = new Placement();
  b.at = PLAYER_BODY_AT[player];
  b.cls = -1;
  b.char_type = ct;
  b.motion = fall;
  b.hp = 0;
  b.spawn = { at: b.at, class: -1, pos: [0, 0, 0], yaw_deg: 0,
              orient: [0, 0, 0] };
  b.synthetic = true;
  b.player_body = player;
  return b;
}

/**
 * Class 0x40's descriptor: `desc+0x25`, the selector `PlaceHorde`
 * (`FUN_0043BD30`) switches on, which the opcode-0x09 allocator copies to
 * `obj+0x130C`. 1 is a horde of members and 2 the prop they push aside; the
 * seven shipped descriptors carry five of one and two of the other. Nothing
 * else in the descriptor is read -- `desc+0x24` goes to `obj+0x1F4` and the
 * placer never looks at it.
 */
export function class40Tail(rec: Spawn): Record<string, unknown> {
  const b = rec.evt?.raw;
  const at = rec.offset + 0x24;
  return { selector: b ? (b[at + 1] ?? 0) & 0xff : 0 };
}

/** Class 0x40, and the selector whose placer builds members. */
const CLASS40 = 0x40;
const CLASS40_SELECTOR_HORDE = 1;
/**
 * `HordeMemberInit` (`FUN_0043BEF0`) writes `side+0x8E = 0x1D` -- `mol.bin`,
 * nine nodes -- as a literal, and the member's three clips are its own:
 * `0x218` the crawl it starts on, `0x217` the leap, `0x219` the death.
 */
const CLASS40_MEMBER_CHAR_TYPE = 0x1d;
const CLASS40_MEMBER_CLIPS = [0x218, 0x217, 0x219];
/** `g_horde_members` has ten slots, and a placer never makes more. */
const CLASS40_MEMBERS = 10;
/**
 * `g_submodel_bone_slots` (`0x004E1F88`) row 1 -- the second skin, which
 * formations 1 and 2 wear through `obj+0x1350`. Row 0 is the skeleton's own
 * slots and needs nothing; these are `mol.bin`'s odd parts, which no skeleton
 * node names, so they ride the gore template to be cloned by slot.
 * `web/tools/checks/horde.ts` asserts them against the EXE.
 */
const CLASS40_SKIN_SLOTS = [4979, 4981, 4983, 4985, 4987, 4989, 4975, 4993,
                            4991];

/**
 * `[port-only]` -- a horde member's spawn address: the placer's with the
 * member index in bits 20..23 and bit 28 set. One definition in two places --
 * `HordeMemberAt` in `game/class40/` is the other -- so each names the other.
 */
export function hordeMemberAt(placerAt: number, idx: number): number {
  return 0x10000000 | ((idx & 0xf) << 20) | (placerAt & 0xfffff);
}

/**
 * The synthetic placements a horde's members are drawn from: ten per
 * selector-1 descriptor, character type 0x1D, parented to the placer.
 *
 * The same arrangement the bat's wing has, for the same reason: the engine
 * builds the members inside `PlaceHorde` with no descriptor, and the client
 * binds a drawable hierarchy to a placement by address. The rows are never
 * spawned from; the placer makes the objects and the character layer adopts
 * them. Returns an empty list when `mol.bin` or its crawl will not build.
 */
async function hordeMemberPlacements(stage: Stage, tables: ExeTables,
                                     sp: SpawnJson,
                                     chars: Map<number, Character>):
    Promise<Placement[]> {
  const ct = CLASS40_MEMBER_CHAR_TYPE;
  if (!chars.has(ct)) {
    const file = tables.characterAssetFile(ct);
    if (!file) return [];
    const built = build(tables, ct, file);
    if (built === null) return [];
    chars.set(ct, built);
  }
  const c = chars.get(ct)!;
  for (const clip of CLASS40_MEMBER_CLIPS) {
    if (c.motions.has(clip)) continue;
    const baked = await bake(stage.source, tables, clip, c.boneCount);
    if (baked !== null) c.motions.set(clip, baked);
  }
  if (!c.motions.has(CLASS40_MEMBER_CLIPS[0])) return [];
  for (const s of CLASS40_SKIN_SLOTS) c.skinSlots.add(s);
  const out: Placement[] = [];
  for (let i = 0; i < CLASS40_MEMBERS; i += 1) {
    const m = new Placement();
    m.at = hordeMemberAt(sp.at as number, i);
    m.cls = CLASS40;
    m.char_type = ct;
    m.motion = CLASS40_MEMBER_CLIPS[0];
    m.hp = 0;
    m.spawn = { ...sp, at: m.at };
    m.parent_at = sp.at as number;
    m.synthetic = true;
    out.push(m);
  }
  return out;
}

/** Class 0x41, whose constructor 61 builds skinned figures. */
const CLASS41 = 0x41;
/** `desc+0x25` -- the s8 a class-0x41 placer's `+0x130C`, its constructor. */
const CLASS41_CTOR_BYTE = 0x25;

/**
 * The synthetic placements class 0x41 constructor 61's nine figures are
 * drawn from: one per figure of every placer whose descriptor names
 * constructor 61, at `Type61FigureAt`, of the character type
 * `g_type61_figure_types` gives it and on the clip `Type61FigureClip` says,
 * parented to the placer.
 *
 * The same arrangement as the horde's members: `PlaceType61Figures`
 * (`FUN_004641F0`) makes the objects with no descriptor, and the client binds
 * a drawable hierarchy to each by address. The rows are never spawned from,
 * and they take the placer's own spawn dict -- the figure's place is the
 * constructor's to decide, in `game/class41/type61.ts`, and the character
 * layer poses the root from the actor. A figure whose type or clip will not
 * build is left out, which leaves it undrawn rather than drawn wrong.
 */
async function type61FigurePlacements(stage: Stage, tables: ExeTables,
                                      recs: Iterable<Spawn>,
                                      byAt: Map<number, SpawnJson>,
                                      chars: Map<number, Character>):
    Promise<Placement[]> {
  const out: Placement[] = [];
  for (const rec of recs) {
    if (rec.cls !== CLASS41 || !rec.evt) continue;
    const at = rec.offset + CLASS41_CTOR_BYTE;
    if (at >= rec.evt.raw.length) continue;
    if (((rec.evt.raw[at] << 24) >> 24) !== TYPE61_CONSTRUCTOR) continue;
    const sp = byAt.get(rec.offset);
    const types = type61FigureTypes(tables);
    if (!sp || !types) continue;
    for (let i = 0; i < types.length; i++) {
      const ct = types[i];
      const clip = Type61FigureClip(ct);
      if (!chars.has(ct)) {
        const file = tables.characterAssetFile(ct);
        if (!file) continue;
        const built = build(tables, ct, file);
        if (built === null) continue;
        chars.set(ct, built);
      }
      const c = chars.get(ct)!;
      if (!c.motions.has(clip)) {
        const baked = await bake(stage.source, tables, clip, c.boneCount);
        if (baked === null) continue;
        c.motions.set(clip, baked);
      }
      const f = new Placement();
      f.at = Type61FigureAt(rec.offset, i);
      f.cls = CLASS41;
      f.char_type = ct;
      f.motion = clip;
      f.hp = 0;
      f.spawn = { ...sp, at: f.at };
      f.parent_at = rec.offset;
      f.synthetic = true;
      out.push(f);
    }
  }
  return out;
}

/** Class 0x61, the result card: `spawn_simple 0x0097723C`'s record. */
const CLASS61 = 0x61;
/** Class 0x10, whose rescues the card stands. */
const CLASS10 = 0x10;

/**
 * Whether this stage's script places the result card -- a `spawn_simple`
 * whose record is class 0x61. Only stages 1..4 do.
 */
export function stagePlacesResultCard(prog: Program): boolean {
  for (const b of prog.liveBlocks()) {
    for (const st of b.steps) {
      for (const o of st.ops) {
        const simple = (o.detail.simple as { class: number }[]) ?? [];
        if (simple.some((r) => r.class === CLASS61)) return true;
      }
    }
  }
  return false;
}

/**
 * The template rows the result card's figures are drawn from, one per
 * character type the card can stand in this stage.
 *
 * `ResultCardInstall` (`FUN_00434EF0`) allocates its figures with no
 * descriptor, as many as the scene's rescues, each of the rescued civilian's
 * own type (`g_rescued_char_types`) or, with none, the scene's own list's
 * (`g_result_figure_records`). So the renderer cannot be handed a row per
 * figure -- which type stands in which place is decided in play -- and is
 * handed one hidden row per type instead, which it clones for each figure
 * (`render/characters.ts`). The types: every class-0x10 placement's in the
 * stage, the car rescue's `0x36` where class 0x21 is placed, and the scene
 * list's. Each is baked every clip a figure can be on: the records' own
 * (read out of the whole span, since a scene with more rescues than places
 * reads past its list), figure 0's `0x180`, and `0x18B..0x18D`. The
 * attachment lists `g_result_figure_attachments` gives each type go on the
 * type, so `goreEntry` carries their models.
 *
 * Returns nothing for a stage that places no result card.
 */
async function resultFigureTemplates(stage: Stage, tables: ExeTables,
                                     prog: Program, placements: Placement[],
                                     chars: Map<number, Character>):
    Promise<Placement[]> {
  if (!stagePlacesResultCard(prog)) return [];
  const rc = tables.resultCardTables() as {
    base: number; bytes: string; lists: number[];
  };
  const bytes = new Uint8Array(rc.bytes.length >> 1);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(rc.bytes.slice(i * 2, i * 2 + 2), 16);
  }
  const dv = new DataView(bytes.buffer);
  const s16 = (va: number): number | null => {
    const off = va - rc.base;
    return off >= 0 && off + 2 <= dv.byteLength ? dv.getInt16(off, true) : null;
  };
  // `g_result_figure_records`: 0x14-byte records, each scene's list from its
  // own pointer (they are not one stride from the span's start: scene 3's
  // follows scene 2's terminator by four bytes).
  const RECORD = 0x14;
  const RESCUES_PER_SCENE = 10;
  const types = new Set<number>();
  for (const p of placements) {
    if (p.cls === CLASS10 && !p.synthetic && p.char_type >= 0) {
      types.add(p.char_type);
    }
    if (p.cls === RESCUE_TARGET_CLASS) types.add(RESCUE_TARGET_CHAR_TYPE);
  }
  const list = rc.lists[stage.scene];
  for (let va = list; list !== undefined; va += RECORD) {
    const t = s16(va);
    if (t === null || t === -1) break;
    types.add(t);
  }
  const clips = new Set<number>([RESULT_FIGURE_LIFE_MOTION]);
  for (let i = 0; i < RESULT_FIGURE_IDLE_MOTIONS; i++) {
    clips.add(RESULT_FIGURE_IDLE_MOTION_BASE + i);
  }
  // The rescued figures' clips: record `i`'s `+0x02` from this scene's list,
  // for as many as `g_rescued_char_types` holds a scene -- ten -- because
  // `ResultCardInstall` reads record `i` for rescue `i` with no bound, and
  // past the terminator that is whatever follows.
  for (let i = 0; list !== undefined && i < RESCUES_PER_SCENE; i++) {
    const m = s16(list + i * RECORD + 2);
    if (m !== null) clips.add(m);
  }
  const attachRecords = tables.attachmentRecords();
  const out: Placement[] = [];
  for (const ct of [...types].sort((a, b) => a - b)) {
    if (!chars.has(ct)) {
      const file = tables.characterAssetFile(ct);
      if (!file) continue;
      const built = build(tables, ct, file);
      if (built === null) continue;
      chars.set(ct, built);
    }
    const c = chars.get(ct)!;
    for (const mid of [...clips].sort((a, b) => a - b)) {
      if (c.motions.has(mid)) continue;
      const baked = await bake(stage.source, tables, mid, c.boneCount);
      if (baked !== null) c.motions.set(mid, baked);
    }
    // `g_result_figure_attachments[type - 0x20]`, up to its first negative.
    for (let va = 0x0055df68 + (ct - 0x20) * 6; ; va += 2) {
      const id = s16(va);
      if (id === null || id < 0) break;
      const arec = attachRecords[id];
      if (arec && arec.slot) c.attachmentSlots.add(arec.slot);
    }
    // `common.bin[199]`, which figure 0 holds up on bone 5
    // (`ResultCardFigureDrawNode`), rides the type's hidden template for the
    // renderer to clone, as a civilian's held item does.
    c.heldSlots.add(RESULT_FIGURE_LIFE_SLOT);
    const first = [...clips].sort((a, b) => a - b)
      .find((m) => c.motions.has(m));
    if (first === undefined) continue;
    const t = new Placement();
    t.at = ResultFigureTemplateAt(ct);
    t.cls = CLASS61;
    t.char_type = ct;
    t.motion = first;
    t.hp = 0;
    t.spawn = { at: t.at, class: CLASS61, pos: [0, 0, 0], yaw_deg: 0,
                orient: [0, 0, 0] };
    t.synthetic = true;
    out.push(t);
  }
  return out;
}

/** Item set 3: `SpawnGoldenFrog` (`FUN_004722A0`)'s arm of the release. */
const GOLDEN_FROG_ITEM_SET = 3;
/** `g_class41_updates[63]`: `PropUpdateType63`, whose table lets one out. */
const GOLDEN_FROG_TABLE_TYPE = 63;

/**
 * Whether this stage can make a golden frog: a container placement in item
 * set 3 (a kinded prop, a falling container, constructor 37's pair, whose
 * set is its `field_1f4`), a group with a member in it, a generic type 63
 * -- whose table, `g_prop_type63_items`, holds one -- or constructor 68.
 */
export function stageMakesGoldenFrog(
    tables: ExeTables, breakables: readonly Record<string, unknown>[]):
    boolean {
  const groups = tables.breakableGroups() as { item_set: number }[][];
  return breakables.some((pl) =>
    pl.item_set === GOLDEN_FROG_ITEM_SET
    || (pl.container === "type37" && pl.field_1f4 === GOLDEN_FROG_ITEM_SET)
    || (pl.container === "group"
        && (groups[pl.group as number] ?? []).some(
          (m) => m.item_set === GOLDEN_FROG_ITEM_SET))
    || (pl.container === "generic" && pl.type === GOLDEN_FROG_TABLE_TYPE)
    || pl.container === "golden_frog");
}

/**
 * The template row the golden frog is drawn from: one hidden row of
 * character type `0x1C`, at `ResultFigureTemplateAt(0x1C)`, which the
 * character layer clones for each frog the port makes -- the result card's
 * figures' arrangement, for the same reason: the frog is allocated with no
 * descriptor (`SpawnGoldenFrog`, `FUN_004722A0`, and constructor 68), at a
 * place decided in play. The type is baked both clips `GoldenFrogUpdate`
 * plays, and given both players' score strips to clone
 * (`GOLDEN_FROG_STRIP_SLOTS`). Nothing for a stage that cannot make one.
 */
async function goldenFrogTemplates(stage: Stage, tables: ExeTables,
                                   breakables: readonly Record<string, unknown>[],
                                   chars: Map<number, Character>):
    Promise<Placement[]> {
  if (!stageMakesGoldenFrog(tables, breakables)) return [];
  const ct = GOLDEN_FROG_CHAR_TYPE;
  if (!chars.has(ct)) {
    const file = tables.characterAssetFile(ct);
    if (!file) return [];
    const built = build(tables, ct, file);
    if (built === null) return [];
    chars.set(ct, built);
  }
  const c = chars.get(ct)!;
  for (const mid of [GOLDEN_FROG_IDLE_MOTION, GOLDEN_FROG_SHOT_MOTION]) {
    if (c.motions.has(mid)) continue;
    const baked = await bake(stage.source, tables, mid, c.boneCount);
    if (baked !== null) c.motions.set(mid, baked);
  }
  if (!c.motions.has(GOLDEN_FROG_IDLE_MOTION)) return [];
  for (const slot of GOLDEN_FROG_STRIP_SLOTS) c.heldSlots.add(slot);
  const t = new Placement();
  t.at = ResultFigureTemplateAt(ct);
  t.cls = CLASS41_GOLDEN_FROG;
  t.char_type = ct;
  t.motion = GOLDEN_FROG_IDLE_MOTION;
  t.hp = 0;
  t.spawn = { at: t.at, class: CLASS41_GOLDEN_FROG, pos: [0, 0, 0],
              yaw_deg: 0, orient: [0, 0, 0] };
  t.synthetic = true;
  return [t];
}

/** Class 0x41, which the port files the golden frog under. */
const CLASS41_GOLDEN_FROG = 0x41;

export function class46Tail(rec: Spawn): Record<string, unknown> {
  const b = rec.evt?.raw;
  const at = rec.offset + 0x24;
  const u8 = (v: number | undefined) => (v ?? 0) & 0xff;
  return {
    subtype: b ? u8(b[at + 1]) : 0,
    group: b ? u8(b[at]) : 0,
    member: Math.max(0, (rec.hp ?? 1) - 1),
  };
}

/**
 * Class 0x45's descriptor: `desc+0x25`, the sub-type `EvtOpSpawnPlaced09`
 * copies into `obj+0x130C` and `Boss3ClassHandler` (`FUN_0041FC00`)
 * dispatches on through `0x0041FD8C` -- 0 the opening head, 1 its civilian,
 * 2 a fighting head, 3 a held civilian, 4 nothing, 5 the body. The head or
 * civilian **index** is `desc+0x22`, which the allocator has already put in
 * `hp`, and the civilians' character type is `desc+0x24`, which `spawnres`
 * reads. See `game/class45/`.
 */
export function class45Tail(rec: Spawn): Record<string, unknown> {
  const b = rec.evt?.raw;
  const at = rec.offset + 0x25;
  return { subtype: b && at < b.length ? (b[at] << 24) >> 24 : 0 };
}

/**
 * Class 0x2D's tail, `obj+0x1390`: `+0x01` the sub-type (s8) --
 * `Class2DClassHandler` (`FUN_00426A70`) installs `Class2DSubtype0Update` for
 * 0 (stage 5's cameo) and `Class2DUpdate` for 1 (the stage-6 fight) -- then
 * seven `s16`: `+0x02` the clip, `+0x04` the counter, `+0x06`/`+0x08` the
 * camera path and frame the cameo goes on, `+0x0A` the fight's hit points,
 * `+0x0C`/`+0x0E` the marks that end rounds 1 and 2. A field past the evt's
 * end reads 0; the cameo's tail is twelve bytes and nothing reads its last
 * two words. See `game/class2D/`.
 */
export function class2dTail(rec: Spawn): Record<string, unknown> {
  const w = (at: number): number => rec.param(at, "i16") ?? 0;
  return {
    subtype: rec.param(0x01, "i8") ?? 0, clip: w(0x02), counter: w(0x04),
    kill_path: w(0x06), kill_frame: w(0x08), fight_hp: w(0x0a),
    round2_hp: w(0x0c), round3_hp: w(0x0e),
  };
}

export function class11Tail(rec: Spawn): Record<string, unknown> {
  const args: Record<number, number> = { 0: 3, 3: 1 };
  const commands: { op: number; args: number[] }[] = [];
  let at = 0x0a;
  for (let guard = 0; guard < 64; guard += 1) {
    const op = rec.param(at, "i16");
    if (op === null || op === -1) break;
    at += 2;
    const n = args[op & 0xff] ?? 0;
    const list: number[] = [];
    for (let k = 0; k < n; k += 1) {
      list.push(rec.param(at, "i16") ?? 0);
      at += 2;
    }
    commands.push({ op, args: list });
  }
  return {
    char_type: rec.param(0x00, "u16") ?? 0,
    motion: rec.param(0x02, "i16") ?? 0,
    cam_path: rec.param(0x04, "i16") ?? 0,
    cam_frame: rec.param(0x06, "i16") ?? 0,
    wedge: rec.param(0x08, "i16") ?? 0,
    commands,
  };
}

export function class51Tail(rec: Spawn): Record<string, unknown> {
  return {
    water_level: rec.param(0x00, "f32") ?? 0,
    speed_x: rec.param(0x00, "f32") ?? 0,
    speed_z: rec.param(0x04, "f32") ?? 0,
    bob_amplitude: rec.param(0x08, "f32") ?? 0,
    entry_mode: rec.param(0x0c, "i16") ?? 0,
    subtype: rec.param(0x0e, "i16") ?? 0,
    rise_frames: rec.param(0x10, "i16") ?? 0,
    bob_cycles: rec.param(0x12, "i16") ?? 0,
    lunge_frames: rec.param(0x14, "i16") ?? 0,
  };
}

/**
 * The first class-0x33 sub-handler the player runs: `obj+0x11C == 1`.
 *
 * `ScriptedSceneryDispatch33` (`FUN_00432FF0`) switches that word into eleven
 * different objects, so the tail below is **one** handler's reading of the
 * bytes and not the class's. `MOVSX ECX, word ptr [EAX + 0x11c]` at
 * `0x00432FF4` is the switch, and the descriptor's `+0x22` is what reaches it.
 */
export const CLASS33_CARRIER = 1;

/**
 * The second class-0x33 sub-handler the player runs: `obj+0x11C == 4`.
 *
 * `ScriptedPushableUpdate33` (`FUN_00433B70`), off the same switch. A piece of
 * scenery an actor shoves out of its way: it draws `tail+0x00` and, while
 * `obj+0x34` bit `0x8000` is clear, applies whatever
 * `ColiTestSphereAgainstActors` recorded at `obj+0x138`/`+0x13C`/`+0x140` --
 * a tenth of the penetration along the reversed normal, which is
 * `ZombiePushOutOfWorldAndActors`' own arithmetic. Two shipped spawns, both
 * stage 1: `0x1A40` and `0x1A74`, asset slot 4196 = `komono_7.bin` part 0.
 */
export const CLASS33_PUSHABLE = 4;

/**
 * The third class-0x33 sub-handler the player runs: `obj+0x11C == 5`.
 *
 * `ScriptedEffectAtCameraCue33` (`FUN_00433B00`), off the same switch -- entry
 * 4 of the jump table at `0x004330C4` is `0x00433051`, which installs it. A
 * sprite effect of kind 0x44 thrown at the object's own position on the frame
 * `g_cam_path_frame` or `g_cam_path_frame_2` equals `tail+0x00`, and then a
 * despawn. One shipped spawn: stage 2's `0x12568`, cue 340.
 */
export const CLASS33_EFFECT_CUE = 5;

/**
 * The class-0x33 sub-handlers {@link class33SubTail} reads, by their
 * `obj+0x11C`: 6 `ScriptedSpriteEffectOnce33` (`FUN_00433E30`), 7
 * `ScriptedSoundCues33` (`FUN_00433E90`), 8 `ScriptedBridgeCrashStrip33`
 * (`FUN_00433FE0`), 9 `ScriptedFireLoopUntilCue33` (`FUN_00434100`), 10
 * `ScriptedSoundAndFlagAtCue33` (`FUN_00433F40`), 11
 * `ScriptedEndingTrackSelect33` (`FUN_00434260`) and 99
 * `ScriptedStaticSlotDraw33` (`FUN_00433160`) -- jump-table entries 5 to 11
 * at `0x004330C4`, 99 through byte 98 of the map at `0x004330F8`.
 */
export const CLASS33_SUB_SELECTORS = [6, 7, 8, 9, 10, 11, 99] as const;

/**
 * The fourth class-0x33 sub-handler the player runs: `obj+0x11C == 2`.
 *
 * `ScriptedPropDrawUntilFlag` (`FUN_00433A10`), entry 1 of the jump table at
 * `0x004330C4` (`0x00433027`). One model at the object's own pose until block
 * 0's camera frame equals `tail+0x0C` or script flag `tail+0x11` reads 1.
 * Ten descriptors, stage 1's `0x5FE8`..`0x60C8` and stage 2's
 * `0x668`..`0x748`, spawned fifty-six times over both modes.
 */
export const CLASS33_DRAW_UNTIL_FLAG = 2;

/**
 * The fifth: `obj+0x11C == 3`. `ScriptedEffectOnFirstFrame33`
 * (`FUN_00433AC0`), entry 2 (`0x00433035`). One kind-0x62 sprite on its first
 * update and a despawn; it reads **no tail**, so it has no block and its
 * placement is all the port needs. Stage 1's `0x37E8`, stage 2's `0x5574`,
 * `0x5598`, `0xA4D0` and `0xA4F4`.
 */
export const CLASS33_EFFECT_FIRST_FRAME = 3;

/**
 * Which spawns of a {@link SLOT_DRAWN_CLASSES} class the bundle carries a
 * placement for.
 *
 * Class 0x52 is one object, so every spawn of it qualifies. Class 0x33 is
 * twelve, and every one is decoded below -- selector 1 by
 * {@link class33Tail}, selector 2 by {@link class33PropTail}, selector 4 by
 * {@link class33PushTail}, selector 5 by {@link class33CueTail} and selectors
 * 6 to 11 and 99 by {@link class33SubTail}; selector 3 reads no tail at all.
 * A selector outside these would be a placement whose tail block is a
 * different handler's bytes read under one of these names, which is `L3`
 * written into the bundle.
 *
 * **The blocks are mutually exclusive and the port reads their presence as
 * the selector**, so widening this is only half the change: see the gate on
 * `class33`/`class33_prop`/`class33_push`/`class33_cue`/`class33_sub` in
 * {@link resolveCharacters}, and the director's.
 */
export function slotDrawnSpawn(cls: number, rec: Spawn): boolean {
  // Class 0x26 is eight objects behind one id, switched on `obj+0x11C` by
  // `Class26InstallSubtypeUpdate` (`FUN_0048E290`). Subtype 2 is read --
  // `Class26Subtype2Update` (`FUN_0048EAD0`), stage 3's boat -- and 6 and 7,
  // `Class26Subtype67Update` (`FUN_0048F930`); the rest are drawn by
  // `render/rigs.ts` off the rig table with no actor behind them.
  if (cls === 0x26) {
    return rec.hp === CLASS26_BOAT || CLASS26_ON_PATH.includes(rec.hp);
  }
  // Class 0x12 calls the behaviour its descriptor names every frame until its
  // strip starts, and the port runs entry 0 alone (`NoOpStub`), which every
  // shipped descriptor names. One that named another would arrive drawing
  // the right slot and doing nothing else.
  if (cls === 0x12) return rec.param(0x08, "i16") === 0;
  // Class 0x15's planks call theirs every frame too (`FloatingPropUpdate`,
  // `FUN_004418C0`), and both shipped descriptors name entry 0.
  if (cls === 0x15) return rec.param(0x08, "i16") === 0;
  if (cls === 0x33) {
    return rec.hp === CLASS33_CARRIER || rec.hp === CLASS33_PUSHABLE
      || rec.hp === CLASS33_EFFECT_CUE || rec.hp === CLASS33_DRAW_UNTIL_FLAG
      || rec.hp === CLASS33_EFFECT_FIRST_FRAME
      || (CLASS33_SUB_SELECTORS as readonly number[]).includes(rec.hp);
  }
  return true;
}

/**
 * Class 0x33 selector 1's descriptor tail, as `ScriptedCarrierUpdate33`
 * (`FUN_004331D0`) and `ScriptedCarrierStepPath33` (`FUN_00433860`) read it.
 *
 * ```
 * tail+0x00  i32  draw slot                     -> obj+0x13F0
 * tail+0x04  i32  shot mesh, -1 for none        -> obj+0x14C, and obj+0x34 |= 0x50
 * tail+0x08  f32  shot sphere, when it is -1    -> obj+0x124 and obj+0x128
 * tail+0x0C  i32  the `op_` path slot           -> obj+0x1350
 * tail+0x10  f32  the last frame of the run     -> obj+0x1374
 * tail+0x14  f32  the frame the effect fires, -1.0 for never
 * tail+0x18  i32  the frame that raises bit 0x10000000
 * tail+0x1C  i32  the camera frame that despawns it
 * tail+0x20  u8   a script flag that raises bit 0x10000000
 * tail+0x21  u8   a script flag that despawns it
 * tail+0x24  f32[6]  where the effect is spawned: x, y, z and three rotations
 * ```
 *
 * The two frame fields are **not** camera frames even though one is seeded
 * from `g_cam_path_frame`: `ScriptedCarrierStepPath33` starts `obj+0x1370` at
 * `g_cam_path_frame - 1` on its first frame and then steps it by one itself,
 * so after that the object is on its own clock. `tail+0x1C` *is* a camera
 * frame -- `ScriptedCarrierUpdate33` compares it against `g_cam_path_frame`
 * and `g_cam_path_frame_2` directly.
 *
 * Its own block, and not the shared placement fields, for the reason class
 * 0x20's and class 0x52's are: `tail+0x00` is class 0x30's body condition.
 *
 * Three shipped spawns, all `spawn_obj` (opcode 0x0B): stage 2's `0x4FD0` and
 * `0x12590`, and stage 5's `0x1CE4`.
 */
export function class33Tail(rec: Spawn): Record<string, unknown> {
  return {
    slot: rec.param(0x00, "i32") ?? 0,
    shot_mesh: rec.param(0x04, "i32") ?? -1,
    shot_radius: rec.param(0x08, "f32") ?? 0,
    path: rec.param(0x0c, "i32") ?? -1,
    path_end: rec.param(0x10, "f32") ?? 0,
    effect_frame: rec.param(0x14, "f32") ?? -1,
    commit_frame: rec.param(0x18, "i32") ?? -1,
    despawn_frame: rec.param(0x1c, "i32") ?? -1,
    commit_flag: rec.param(0x20, "u8") ?? 0xff,
    despawn_flag: rec.param(0x21, "u8") ?? 0xff,
    effect: [0, 1, 2, 3, 4, 5].map((k) => rec.param(0x24 + 4 * k, "f32") ?? 0),
  };
}

/**
 * Class 0x33 **selector 4's** tail, as `ScriptedPushableUpdate33`
 * (`FUN_00433B70`) reads it.
 *
 * Every offset below is from `disassemble_bytes` over
 * `0x00433B70`..`0x00433C31` rather than from the pseudocode, because the
 * function is one the decompiler truncates -- see the `L35` note at the end.
 *
 * ```
 * tail+0x00  i32  draw slot                       -> obj+0x13F0
 * tail+0x04  i32  shot mesh, -1 for none          -> obj+0x14C
 * tail+0x08  f32  the sphere, only when +0x04 is -1
 * tail+0x0C  u8   script flag that clears obj+0x34 bit 0x8000
 * tail+0x0D  u8   script flag that despawns it
 * ```
 *
 * The seed runs once, gated on `obj+0x1312` being zero
 * (`MOV DX, word ptr [ESI + 0x1312]` / `TEST DX, DX` at `0x00433B9A`), and
 * ends by **incrementing** that word rather than storing 1 (`INC EDX` at
 * `0x00433BE6`). It ORs `obj+0x34` with `0x1` unconditionally, then splits on
 * `tail+0x04`:
 *
 * * `-1` writes the `f32` at `tail+0x08` to `obj+0x124` **and** `obj+0x128`
 *   -- two separate loads of `[ECX + 8]` at `0x00433BD4` and `0x00433BDD`, so
 *   the object gets a *body* sphere and is pushable;
 * * anything else ORs `0x40` then `0x10` and puts the mesh id on `obj+0x14C`,
 *   which is the mesh shot test the port has not got.
 *
 * Both shipped spawns carry `-1`, so both are body spheres of 3.5.
 *
 * `push_flag` is the flag whose byte is at `tail+0x0C`
 * (`MOV DL, byte ptr [ECX + 0xc]` at `0x00433BF1`); when it reads 1,
 * `AND AH, 0x7f` at `0x00433C00` clears `obj+0x34` bit `0x8000` and the object
 * becomes pushable from that frame on. That is also the bit
 * `ColiTestSphereAgainstActors` skips an object on (`0x80008000`), so one bit
 * both holds the object still and keeps it out of the collision list -- which
 * is why the arming flag is named for the push and not for the bit.
 *
 * `despawn_flag` is the byte at `tail+0x0D`
 * (`MOV AL, byte ptr [ECX + 0xd]` at `0x00433B80`) and its test is the **first
 * thing in the routine**: a raised flag calls `ActorDespawn` and returns
 * before the seed, the push and the draw. Neither flag index has a "none" test
 * in front of it, exactly as selector 1's two do not.
 *
 * `L35`: Ghidra ends this function's body at `0x00433C5C`, on the
 * `MatrixStackPop` call, and the pseudocode ends there too. The real tail runs
 * to `0x00433CD3` and holds `PUSH ESI` / `CALL 0x00405160` at `0x00433CC6` --
 * `RegisterForShotTest`, which is what puts the object in the per-frame
 * dynamic list `ColiTestSphereAgainstActors` walks, and so the reason an actor
 * can find it at all.
 *
 * Its own block and **not** {@link class33Tail}'s: these are two handlers'
 * readings of the same bytes, and `tail+0x0C` is selector 1's `op_` path slot.
 * Two shipped spawns, both `spawn_obj` (opcode 0x0B) and both stage 1:
 * `0x1A40` and `0x1A74`.
 */
export function class33PushTail(rec: Spawn): Record<string, unknown> {
  return {
    slot: rec.param(0x00, "i32") ?? 0,
    shot_mesh: rec.param(0x04, "i32") ?? -1,
    shot_radius: rec.param(0x08, "f32") ?? 0,
    push_flag: rec.param(0x0c, "u8") ?? 0xff,
    despawn_flag: rec.param(0x0d, "u8") ?? 0xff,
  };
}

/**
 * Class 0x33 **selector 5's** tail, as `ScriptedEffectAtCameraCue33`
 * (`FUN_00433B00`) reads it.
 *
 * ```
 * tail+0x00  i32  the camera frame the effect goes off on
 * ```
 *
 * That is the only word the routine reads: `MOV EAX, [ESI + 0x1390]` / `MOV
 * EAX, [EAX]` at `0x00433B0E`, compared as an integer with `g_cam_path_frame`
 * at `0x00433B16` and with `g_cam_path_frame_2` at `0x00433B1A`. The rest of
 * the routine reads the object -- `obj+0x40..0x48`, the position the effect is
 * thrown at.
 *
 * **One word and no more, because there is no more.** The one shipped spawn,
 * stage 2's `0x12568`, is followed four bytes after its tail by the next
 * descriptor (`0x12590`, the selector-1 carrier the same `spawn_obj` makes),
 * so a wider read here would carry that record's class under this one's name
 * -- `L6`.
 *
 * Its own block and **not** {@link class33Tail}'s or
 * {@link class33PushTail}'s, for the reason those two are each other's: three
 * handlers' readings of the same bytes, and `tail+0x00` is a draw slot in the
 * other two.
 */
export function class33CueTail(rec: Spawn): Record<string, unknown> {
  return { cue: rec.param(0x00, "i32") ?? -1 };
}

/**
 * Class 0x33 **selectors 6 to 11 and 99**'s tails, each read the way its own
 * routine reads it and tagged with the selector, or null for any other
 * selector. Every offset is from the routines' listings:
 *
 * ```
 * 6   tail+0x0C kind, +0x10 face-camera mode, +0x14 player  (0x00433E68)
 * 7   {s16 mode, s16 frame, u32 sound} records, stride 8    (0x00433ED6, 0x00433F15)
 * 8   nothing
 * 9   tail+0x00 s16 mode, +0x02 s16 frame                   (0x00434208)
 * 10  selector 7's first record, and tail+0x08 s16 flag     (0x00433FBC)
 * 11  nothing
 * 99  tail+0x00 the draw slot                               (0x004331B3)
 * ```
 *
 * Selector 7 walks its records by moving `obj+0x1390` itself, one record per
 * cue, and only a mode of 0 or 1 can ever be a cue. So the list stops at, and
 * includes, the first record with any other mode: the routine parks there
 * and reads nothing beyond it. That record's `+0x04` is never read and is not
 * carried -- on the one shipped spawn, `0x1E7C`, it is the class word of the
 * descriptor after it (`L6`). The list is also bounded by the file.
 */
export function class33SubTail(rec: Spawn): Record<string, unknown> | null {
  const mode = rec.param(0x00, "i16") ?? -1;
  const frame = rec.param(0x02, "i16") ?? -1;
  switch (rec.hp) {
    case 6:
      return { selector: 6, kind: rec.param(0x0c, "i32") ?? 0,
               face: rec.param(0x10, "i32") ?? 0,
               player: rec.param(0x14, "i32") ?? -1 };
    case 7: {
      const cues: Record<string, number>[] = [];
      for (let at = 0; ; at += 8) {
        const m = rec.param(at, "i16");
        const fr = rec.param(at + 2, "i16");
        if (m === null || fr === null) break;
        if (m !== 0 && m !== 1) {
          cues.push({ mode: m, frame: fr });
          break;
        }
        const sound = rec.param(at + 4, "u32");
        if (sound === null) break;
        cues.push({ mode: m, frame: fr, sound });
      }
      return { selector: 7, cues };
    }
    case 8:
      return { selector: 8 };
    case 9:
      return { selector: 9, mode, frame };
    case 10:
      return { selector: 10, mode, frame,
               sound: rec.param(0x04, "u32") ?? 0,
               flag: rec.param(0x08, "i16") ?? 0 };
    case 11:
      return { selector: 11 };
    case 99:
      return { selector: 99, slot: rec.param(0x00, "i32") ?? 0 };
  }
  return null;
}

/**
 * Class 0x33 **selector 2's** tail, as `ScriptedPropDrawUntilFlag`
 * (`FUN_00433A10`) reads it.
 *
 * ```
 * tail+0x00  i32  draw slot                  -> obj+0x13F0   MOV EDX,[ECX]      0x00433A27
 * tail+0x0C  i32  the camera frame it leaves on              MOV EAX,[ECX+0xC]  0x00433A37
 * tail+0x11  u8   the script flag it leaves on               MOV DL,[ECX+0x11]  0x00433A46
 * ```
 *
 * Nothing else: `+0x04`, `+0x08`, `+0x10` and `+0x12..+0x13` are read by
 * nothing in the routine, and the next descriptor starts at `tail+0x14`. The
 * frame is compared with `g_cam_path_frame` as an integer and carried as the
 * raw word -- every shipped one is `-1` -- rather than turned into a "none":
 * the routine has no such test. The flag byte has none either.
 *
 * Its own block for the reason the other three are each other's: `tail+0x0C`
 * is selector 1's path slot and selector 4's arming flag.
 */
export function class33PropTail(rec: Spawn): Record<string, unknown> {
  return {
    slot: rec.param(0x00, "i32") ?? 0,
    despawn_frame: rec.param(0x0c, "i32") ?? -1,
    despawn_flag: rec.param(0x11, "u8") ?? 0xff,
  };
}

/**
 * Class 0x53's descriptor tail, as `CatInit` reads it.
 *
 * Two s16s: `+0x00` an animation set that indexes 0x00589A64 for the motion,
 * `+0x02` the **subtype**. Subtype 2 and up runs `CatBranchTriggerUpdate`,
 * which writes the route branch in event block 8 and nowhere else.
 */
export function class53Tail(rec: Spawn): Record<string, unknown> {
  return { anim_set: rec.param(0x00, "i16") || 0,
           subtype: rec.param(0x02, "i16") || 0 };
}

/**
 * Class 0x14's descriptor tail, as `Class14Init` (`FUN_00475E90`) reads it.
 *
 * `+0x00` the character type -- 0x47, `boss2.bin`, on all five shipped spawns
 * -- and `+0x01` the state the stage-2 boss starts in, which is the only thing
 * that tells stage 2's four alternative endings apart: 0, 1, 3 and 4 there and
 * 2 in stage 5. `+0x04`..`+0x0C` is the route's forward direction, `+0x10`..
 * `+0x2C` are four x/z corners of the patch of water it swims inside, and
 * `+0x30`/`+0x32` are the camera path and frame that despawn it.
 *
 * Emitted under a class-named key for the reason class 0x20's and 0x52's are:
 * the same two bytes are class 0x30's body condition and initial state.
 */
export function class14Tail(rec: Spawn): Record<string, unknown> {
  const f = (at: number): number => rec.param(at, "f32") ?? 0;
  return {
    char_type: rec.param(0x00, "u8") || 0,
    state: rec.param(0x01, "u8") || 0,
    dir: [f(0x04), f(0x08), f(0x0c)],
    // **Eight floats, not four vec3s.** `Class14Init` copies `tail+0x10` and
    // `tail+0x14` to `state+0x28` and `state+0x30` -- the x and the z of the
    // first corner, with the y between them left alone -- and repeats that
    // four times at a stride of 8. Read as vec3s the quad comes out as
    // `[660, -4900, 660]`, which is a corner with the next corner's x in its
    // y, and the fourth reads past the record into the despawn cue.
    route: [
      [f(0x10), 0, f(0x14)],
      [f(0x18), 0, f(0x1c)],
      [f(0x20), 0, f(0x24)],
      [f(0x28), 0, f(0x2c)],
    ],
    despawn_path: rec.param(0x30, "i16") || 0,
    despawn_frame: rec.param(0x32, "i16") || 0,
  };
}

/**
 * Class 0x14's motion set: `boss2.bin`'s own bank, 21..58.
 *
 * Every clip the class names comes either from a literal in one of its 21
 * states or from the first short of a `g_class14_anim_cues` record that
 * `g_class14_anim_slots` (`0x00596408`) points at, and every one of those ids
 * is in that range. **Every state measures its exit on the play clock of the
 * clip it names**, so an unbaked clip is not cosmetic: `MotionPlayLength` is
 * 0, the cursor never reaches the last frame, and the boss stands in the water
 * for ever with its gate shut. The range is offered whole and `bake` refuses
 * the ids that are authored for another skeleton.
 */
export const CLASS14_MOTIONS: number[] =
  Array.from({ length: 58 - 21 + 1 }, (_unused, i) => 21 + i);

/**
 * Class 0x22's tail -- JUDGMENT's flier, as `Class22Init` (`FUN_0049B0D0`)
 * and its states read it. See `CharacterPlacement.class22` for the fields.
 *
 * `+0x10` is a **pointer** to the nested class-0x23 descriptor, and only the
 * two fighting variants have one: variant 0's tail is twelve bytes and a
 * class-0x30 header follows it (`st1` `0x7C4`). `companion_at` is that
 * pointer as an evt offset, the address the walker's own placement has.
 */
export function class22Tail(rec: Spawn): Record<string, unknown> {
  const variant = rec.param(0x01, "i8") || 0;
  const fights = variant === CLASS22_VARIANT_STAGE1
    || variant === CLASS22_VARIANT_STAGE5;
  const ptr = fights ? rec.param(0x10, "u32") : null;
  const evt = rec.evt;
  return {
    variant,
    clip: rec.param(0x02, "i16") || 0,
    frame: rec.param(0x04, "i16") || 0,
    despawn_path: rec.param(0x06, "i16") || 0,
    despawn_frame: rec.param(0x08, "i16") || 0,
    hp: rec.param(0x0a, "i16") ?? -1,
    hp_stage: fights ? rec.param(0x0c, "i16") || 0 : 0,
    phase1_floor: fights ? rec.param(0x0e, "i16") || 0 : 0,
    companion_at: ptr && evt ? evt.toOffset(ptr) : null,
    sub_actor_at: Class22SubActorAt(rec.offset),
  };
}

/**
 * Class 0x23's tail -- JUDGMENT's walker: the subtype at `+0x01` and the
 * camera cue at `+0x06`/`+0x08`. The descriptor's own position and angles go
 * with it, because the walker is made by the flier's class and not placed
 * from a glTF node -- see `CharacterPlacement.class23`.
 */
export function class23Tail(rec: Spawn): Record<string, unknown> {
  return {
    subtype: rec.param(0x01, "i8") || 0,
    despawn_path: rec.param(0x06, "i16") || 0,
    despawn_frame: rec.param(0x08, "i16") || 0,
    pos: [...rec.pos],
    angles: [...rec.orient],
  };
}

/** `AssetDrawSlot(0x2B5)` and `(0x2B4)` -- node 1's two extra models. */
const CLASS22_NODE1_EXTRA_A = 0x2b5;
const CLASS22_NODE1_EXTRA_B = 0x2b4;

/** The two variants of class 0x22 whose tail carries the walker. */
const CLASS22 = 0x22;
const CLASS23 = 0x23;
const CLASS22_VARIANT_STAGE1 = 1;
const CLASS22_VARIANT_STAGE5 = 2;

/** JUDGMENT's three character types: the walker, the flier, its sub-actor. */
const JUDGMENT_CHAR_TYPES: ReadonlySet<number> = new Set([0x44, 0x45, 0x46]);

/**
 * Build one of JUDGMENT's character types from the file the stage's own
 * script loads it from.
 *
 * `AssetDrawSlot` draws what is resident in a slot, and a whole-file load
 * (`asset_load_polfile`, opcode `0x52`) makes it resident: `FUN_00418E40`
 * points `0x007C2134` at the file's slot list and `FUN_00418EC0` installs
 * each of the file's models into its slot, binding its textures through the
 * **file's** texture table (`0x0055B9B8 + file * 4`). The exe's first listing
 * for slots `0x28F`..`0x2C8` is `char_adv04.bin`, which is what
 * `characterAssetFile` answers -- and no stage-1 or stage-5 block loads it.
 * Stage 1's blocks 0, 14 and 16 and stage 5's blocks 0 and 1 load
 * `boss1z.bin`, `boss1z_wing.bin` and `boss1q.bin` instead. `[proved]`
 *
 * For the flier and its sub-actor the difference is only the texture
 * numbering (each file indexes its own bank, and the images are the same);
 * for the walker it is not -- slot `0x29D`'s meshes 4 and 6 are different
 * geometry in `boss1q.bin`, and its texture 1 is a different image. So the
 * walker drawn from `char_adv04.bin` was not the one the game draws.
 *
 * The file is the first one the script loads whose slot list covers every
 * node of the skeleton; null when none does, and the caller keeps the exe's
 * first listing. Only JUDGMENT's types come through here: the rule is the
 * engine's for every character, but moving the others is not this class's
 * change to make.
 */
function judgmentBuild(prog: Program, tables: ExeTables, ct: number,
                       fallback: string | null): Character | null {
  let file: string | null = null;
  let own: number[] | null = null;
  const want = tables.characterSkeleton(ct).map((n) => n.slot)
    .filter((sl) => sl !== 0);
  for (const blk of prog.blocks) {
    for (const step of blk.steps) {
      for (const op of step.ops) {
        if (file !== null || op.opcode !== 0x52) continue;
        const f = op.detail.file;
        if (typeof f !== "string") continue;
        const list = tables.polFileSlots(f);
        if (list && want.every((sl) => list.includes(sl))) {
          file = f;
          own = list;
        }
      }
    }
  }
  const use = file ?? fallback;
  if (use === null) return null;
  const built = build(tables, ct, use);
  if (built !== null && own !== null) {
    built.ownSlots = new Map(own.map((sl, k) => [sl, k]));
  }
  return built;
}

/**
 * The synthetic placement JUDGMENT's sub-actor is drawn from: character type
 * 0x46 (`boss1z_wing`'s six nodes), clip 0x10, at the address
 * `Class22SubActorAt` gives it and parented to its flier. `Class22Init`
 * builds the actor with `ActorAllocSub`; nothing places it -- the bat's
 * wing's arrangement. Null when the type or its clips will not build.
 */
async function class22SubActorPlacement(stage: Stage, tables: ExeTables,
                                        prog: Program, sp: SpawnJson,
                                        chars: Map<number, Character>):
    Promise<Placement | null> {
  const ct = CLASS22_SUBACTOR_CHAR_TYPE;
  if (!chars.has(ct)) {
    const built = judgmentBuild(prog, tables, ct,
                                tables.characterAssetFile(ct));
    if (built === null) return null;
    chars.set(ct, built);
  }
  const c = chars.get(ct)!;
  for (const mid of CLASS22_SUBACTOR_MOTIONS) {
    if (c.motions.has(mid)) continue;
    const baked = await bake(stage.source, tables, mid, c.boneCount);
    if (baked !== null) c.motions.set(mid, baked);
  }
  if (!c.motions.has(CLASS22_SUBACTOR_CLIP)) return null;
  const w = new Placement();
  w.at = Class22SubActorAt(sp.at as number);
  w.cls = CLASS22;
  w.char_type = ct;
  w.motion = CLASS22_SUBACTOR_CLIP;
  w.hp = 0;
  w.spawn = { ...sp, at: w.at };
  w.parent_at = sp.at as number;
  w.synthetic = true;
  return w;
}

/**
 * The synthetic rows the stage-6 boss's children are drawn from: kinds 0..3
 * on their first clips (`0x40C`, `0x33`, `0x3B`, `0x79`) at
 * `Class2DChildAt(boss, 8 + kind)`, and kind 0's wing (`0x4E` on `0xF`) at
 * `Class2DChildAt(boss, 12)`, each parented to the fight's row. A type or a
 * clip that will not build is left out, and that child draws nothing.
 */
async function class2dChildPlacements(stage: Stage, tables: ExeTables,
                                      boss: Placement,
                                      chars: Map<number, Character>):
    Promise<Placement[]> {
  const want: [number, number, number][] = CLASS2D_CHILD_CHAR_TYPES.map(
    (ct, k) => [ct, CLASS2D_CHILD_CLIPS[k]!, CLASS2D_AT_KIND0 + k]);
  want.push([CLASS2D_WING_CHAR_TYPE, CLASS2D_WING_CLIP, CLASS2D_AT_WING]);
  const out: Placement[] = [];
  for (const [ct, clip, code] of want) {
    if (!chars.has(ct)) {
      const file = tables.characterAssetFile(ct);
      if (!file) continue;
      const built = build(tables, ct, file);
      if (built === null) continue;
      chars.set(ct, built);
    }
    const c = chars.get(ct)!;
    if (!c.motions.has(clip)) {
      const baked = await bake(stage.source, tables, clip, c.boneCount);
      if (baked !== null) c.motions.set(clip, baked);
    }
    if (!c.motions.has(clip)) continue;
    const w = new Placement();
    w.at = Class2DChildAt(boss.at, code);
    w.cls = 0x2d;
    w.char_type = ct;
    w.motion = clip;
    w.hp = 0;
    w.spawn = { ...boss.spawn, at: w.at };
    w.parent_at = boss.at;
    w.synthetic = true;
    out.push(w);
  }
  return out;
}

/**
 * The asset slots a class-0x25 program's `op 9` and `op 16` can write into a
 * bone's draw record, resolved as `ScriptedHumanoidUpdate` (`FUN_004842A0`)
 * resolves them.
 *
 * `op 9` stores `g_player_hand_slots[3*a + mode]` unconditionally. In Original
 * Mode an `a` of 0 or 1 is replaced by `g_original_character[a]`, whose one
 * writer, `ResetOriginalModeLoadout` (`FUN_0048A0D0`), stores the player
 * index -- so that is row `a` again, and one row per command covers both
 * modes. `op 16` stores the character's effect-table entry `6*a + b` only
 * when it is above 2: 0, 1 and 2 are the table's control codes and the
 * command leaves the bone alone for them.
 */
export function humanoidModelSlots(tables: ExeTables, evt: evtlib.EvtFile,
                                   rec: Spawn, charType: number): number[] {
  const hand = playerHandSlots(tables);
  const out: number[] = [];
  for (const [op, mode, a, b] of humanoidModelCommands(evt, rec)) {
    if (op === 9) {
      const s = hand[a * PLAYER_HAND_VARIANTS + mode];
      if (s !== undefined && s > 0) out.push(s);
    } else {
      const s = boneEffectSlot(tables, charType, a * HIT_STEPS + b);
      if (s > 2) out.push(s);
    }
  }
  return out;
}

export interface ResolvedCharacters {
  chars: Map<number, Character>;
  placements: Placement[];
  entries: RigInstance[];
}

/**
 * Characters, their placements, and glTF rig entries for the geometry.
 *
 * * *chars* -- `{charType: Character}`, only for types that both resolve to
 *   geometry **and** have a motion, since an unposed character is a heap of
 *   parts rather than a character;
 * * *placements* -- one {@link Placement} per spawn descriptor;
 * * *entries* -- ready for `gltf.exportLevel(rigs)`, one entry per character
 *   type with a `placements` list, so the exporter emits a full posed
 *   hierarchy at every spawn. A skeleton is exactly a rig -- a tree of named
 *   parts each with a translation, a BAMS triple and an asset slot -- which is
 *   why this goes through the existing writer rather than a second glTF path.
 */
export async function resolveForStage(
    stage: Stage, prog: Program | null, spawnRecords: Spawn[] | null,
    poseFrame: number | null = null, poseMotion: number | null = null,
    cache: AssetCache = new AssetCache(stage),
    breakables: readonly Record<string, unknown>[] = []):
    Promise<ResolvedCharacters> {
  const tables = stage.tables;
  if (prog === null) {
    return { chars: new Map(), placements: [], entries: [] };
  }

  // The script's spawn dicts carry the placement; the evt.Spawn records carry
  // the parameter tail a motion rule reads. They join on the descriptor's file
  // offset.
  const byAt = new Map<number, SpawnJson>();
  for (const blk of prog.blocks) {
    for (const step of blk.steps) {
      for (const op of step.ops) {
        for (const sp of (op.detail.spawns as SpawnJson[]) ?? []) {
          const at = sp.at as number;
          if (!byAt.has(at)) byAt.set(at, sp);
        }
      }
    }
  }
  const recs = new Map<number, Spawn>();
  for (const r of spawnRecords ?? []) recs.set(r.offset, r);

  // **Class 0x10's children are not script spawns.** `CivilianInit` reads a
  // count at tail+0x0C and an array of descriptor pointers at tail+0x10 and
  // calls `SpawnFromDescriptor` on each, parenting every one at `child+0x1394`.
  // Nothing in the evt's instruction stream points at those descriptors, so
  // `evt.spawns()` never returns them and the fifty zombies holding the game's
  // civilians hostage had no geometry, no placement and no actor. They are the
  // reason a civilian can be rescued at all -- the rescue is "wait until my
  // children are dead".
  const evt = prog.evt!;
  for (const rec of [...recs.values()]) {
    if (rec.cls !== 0x10) continue;
    const n = rec.param(0x0c, "i32") || 0;
    for (let k = 0; k < Math.max(0, Math.min(n, 32)); k++) {
      const w = rec.param(0x10 + k * 4, "u32");
      const off = w ? evt.toOffset(w) : null;
      if (off === null || recs.has(off) || off > evt.raw.length - 0x24) {
        continue;
      }
      const kid = evtlib.readSpawn(evt, off, 0x0b);
      recs.set(off, kid);
      if (!byAt.has(off)) {
        byAt.set(off, {
          at: off, class: kid.cls, flags: kid.initFlags,
          pos: [...kid.pos], yaw_deg: kid.yawDeg, orient: [...kid.orient],
          hp: kid.hp,
          // The descriptor's +0x20 word, the same as the script-walker path
          // carries. These 75 children are built here rather than by the
          // walker, so a key added there does not reach them.
          desc_flags: kid.descFlags,
          civilian_child: rec.offset,
        });
      }
    }
  }

  // **Nor is JUDGMENT's walker.** `Class22RideInAndJoinFight` (`FUN_0049B640`)
  // and `Class22DescendAndJoinFight` (`FUN_0049CE10`) hand the pointer at
  // their own `tail+0x10` to `SpawnFromDescriptor` from their first frame
  // (`0x0049B6FA`, `0x0049CE42`) -- a whole class-0x23 descriptor nested in
  // the flier's, which nothing in the instruction stream points at. Stage 1's
  // blocks 14 and 16 spawn the same flier descriptor, so one walker serves
  // both. The row is synthetic and parented to the flier: the flier's class
  // makes the object, the script never does.
  for (const rec of [...recs.values()]) {
    if (rec.cls !== CLASS22) continue;
    const variant = rec.param(0x01, "i8") || 0;
    if (variant !== CLASS22_VARIANT_STAGE1
        && variant !== CLASS22_VARIANT_STAGE5) continue;
    const w = rec.param(0x10, "u32");
    const off = w ? evt.toOffset(w) : null;
    if (off === null || recs.has(off) || off > evt.raw.length - 0x24) {
      continue;
    }
    const kid = evtlib.readSpawn(evt, off, 0x0b);
    if (kid.cls !== CLASS23) continue;
    recs.set(off, kid);
    if (!byAt.has(off)) {
      byAt.set(off, {
        at: off, class: kid.cls, flags: kid.initFlags,
        pos: [...kid.pos], yaw_deg: kid.yawDeg, orient: [...kid.orient],
        hp: kid.hp, desc_flags: kid.descFlags,
        nested_in: rec.offset,
      });
    }
  }

  const chars = new Map<number, Character>();
  const placements: Placement[] = [];
  // The two collision files, for the one descriptor tail that names a blob --
  // see {@link class26Tail}.
  const coliSets = await stage.colisets();
  const class31 = class31Tables(tables);
  let civscripts: CivBlock;
  try {
    civscripts = tables.civilianScripts();
  } catch (exc) {
    degraded.note("hod2lib.characters.resolve_for_stage",
                  "the civilian script table",
                  "no civilian follows a script", exc);
    civscripts = { entries: [], scripts: [], items: [] };
  }
  const perType = new Map<number, SpawnJson[]>();
  const dset = deathMotions(tables);
  const attachRecords = tables.attachmentRecords();

  for (const at of [...byAt.keys()].sort((a, b) => a - b)) {
    const sp = byAt.get(at)!;
    const rec = recs.get(at);
    if (rec === undefined) continue;
    const cls = sp.class as number;
    const res = resolveSpawn(tables, rec);
    if (!res.identified || res.charType === null) {
      // **The gate is about geometry, not about the placement.** A class whose
      // draw is an `AssetDrawSlot` rather than a skeleton has no character
      // type to resolve and never will -- class 0x52's mouse is drawn from
      // `mouse.bin` slots 0x1385..0x138E -- but the port still needs its
      // descriptor tail to build the actor at all. Those classes are emitted
      // with `char_type` of -1 and `motion` of null; the renderer's ingest
      // already skips a placement with no motion, so nothing downstream has to
      // learn about them.
      //
      // Everything else still falls out here, deliberately. Reading
      // `desc+0x24` as a character type for every class "identified" 962 of
      // 1225 spawns, most of them as `char_adv02` because a lifetime of 0 is
      // character type 0.
      if (!SLOT_DRAWN_CLASSES.has(cls)) continue;
      // ...and, for a class that is several objects behind one id, only the
      // spawns whose sub-handler this library has read. See `slotDrawnSpawn`.
      if (!slotDrawnSpawn(cls, rec)) continue;
    }
    const motion = motionFor(tables, rec, cls);
    const intro = introFor(tables, rec, cls);
    // The descriptor tail, as `EnemyZombieInit` (class 0x30) and
    // `EnemyThrowerInit` (class 0x31) read it: byte +1 is the body condition,
    // +2 the state the actor starts in, +3 the state a permit-winner enters.
    // Every other class gets zeroes rather than a guess.
    // Class 0x19 reads the **same byte** as something else entirely.
    // `Boss4Init` (`FUN_004917E0`) does `MOV byte ptr [EAX + 0x4], DL` with
    // `DL` the tail's byte +1, and that is the index into `g_class19_states`
    // the boss starts in -- one of four entrances, and the four shipped spawns
    // carry one each. It is not a body condition, so it is emitted as
    // `initial_state` and `body_condition` stays 0: the same offset, named for
    // what the class using it uses it as.
    // Class 0x18 reads the same three bytes as class 0x30, because
    // `CarriedZombieInit18` (`FUN_0045CD60`) **is** `EnemyZombieInit` with two
    // lines after it. Without this row its three spawns start in state 0 and
    // the zombie `NoOp` falls straight through to `AttackRun`, which walks
    // them off the boat they are standing on.
    const tail: [number, number, number] =
      (cls === 0x30 || cls === 0x31 || cls === 0x18)
      ? [rec.param(1, "i8") || 0, rec.param(2, "i8") || 0,
         rec.param(3, "i8") || 0]
      : cls === 0x19 ? [0, rec.param(1, "u8") || 0, 0]
      : [0, 0, 0];
    // Whichever state reads the tail past byte 3: the initial state, or the
    // attack state for a passenger. See `entranceTailState`.
    const tailState = entranceTailState(cls, tail[1], tail[2]);
    const inStates = (m: Record<number, number[]>) =>
      (m[cls] ?? []).includes(tailState);

    // The leap states read a destination and a duration out of the same
    // descriptor; every other state uses those bytes for something else, so
    // this is gated on the state rather than emitted blind.
    let leap: Record<string, unknown> | null = null;
    if (inStates(LEAP_STATES)) {
      const frames = rec.param(0x10, "i32") || 0;
      const dest = [4, 8, 0xc].map((o) => rec.param(o, "f32"));
      if (frames > 0 && frames < 3600 && dest.every(finite)) {
        leap = { dest, frames };
      }
    }
    let path: Record<string, unknown> | null = null;
    if (inStates(PATH_STATES)) {
      const pts: Record<string, unknown>[] = [];
      let off = 8;
      for (let i = 0; i < 32; i++) {          // the longest seen is 3
        const step = rec.param(off, "i16");
        if (step === null || step === -1) break;
        const dest = [0, 1, 2].map((k) => rec.param(off + 4 + 4 * k, "f32"));
        if (!dest.every(finite)) break;
        pts.push({ step, motion_set: rec.param(off + 2, "i16") || 0, dest });
        off += WAYPOINT_BYTES;
      }
      if (pts.length) path = { delay: rec.param(4, "i32") || 0, points: pts };
    }
    // The other three class-0x31 entrances read the same four bytes as
    // something else again, so each is gated on its own state.
    let walkDistance: number | null = null;
    if (inStates(WALK_DISTANCE_STATES)) {
      const d = rec.param(4, "f32");
      if (finite(d) && d > 0 && d < 4096) walkDistance = d;
    }
    // `ZombieStateStandAndThrow` reads four delays and then, by the same
    // `tail+0x03` byte the port already carries as `attack_state`, either a
    // walk distance at `+0x10` or a leap point at `+0x10`..`+0x18` with its
    // gravity at `+0x20`. The two readings are cleanly separated.
    let standThrow: Record<string, unknown> | null = null;
    if (inStates(STAND_AND_THROW_STATES)) {
      const exitState = tail[2];
      const st: Record<string, unknown> = {
        delay_two_hands: rec.param(0x04, "i32") || 0,
        delay_one_hand: rec.param(0x08, "i32") || 0,
        delay_after_throw: rec.param(0x0c, "i32") || 0,
        exit_state: exitState,
      };
      if (exitState === 0) {
        const d = rec.param(0x10, "f32");
        if (finite(d) && d > 0 && d < 4096) st.walk_distance = d;
      } else {
        const dest = [0, 1, 2].map((k) => rec.param(0x10 + 4 * k, "f32"));
        const g = rec.param(0x20, "f32");
        if (dest.every(finite) && finite(g)) st.leap = { dest, gravity: g };
      }
      // `+0x1C` is only read on the arm `obj+0x38` bit 0x10 opens, and nothing
      // seen sets that bit -- so it is the next descriptor's bytes for most
      // spawns. Emitted only when it reads as a delay.
      const leave = rec.param(0x1c, "i32");
      if (leave !== null && leave >= 0 && leave < 3600) st.leave_delay = leave;
      standThrow = st;
    }
    // The twelve entrance states, each gated on its own initial state. Class
    // 0x30 only: class 0x31 numbers its states differently.
    const entry = cls === 0x30 ? entryTail(rec, tailState, tail[2]) : null;
    let entranceMotion: number | null = null;
    if (inStates(ENTRANCE_CLIP_STATES)) {
      const m = rec.param(4, "i32");
      if (m !== null && m > 0 && m < 4096) entranceMotion = m;
    }
    let pounce: Record<string, unknown> | null = null;
    if (inStates(POUNCE_STATES)) {
      const m = rec.param(4, "i32");
      const n = rec.param(8, "i32");
      if (m !== null && m > 0 && m < 4096 && n !== null && n > 0 && n < 3600) {
        pounce = { motion: m, frames: n };
      }
    }
    let grab: Record<string, unknown> | null = null;
    if (inStates(GRAB_STATES)) {
      const off = [4, 8, 0xc].map((o) => rec.param(o, "f32"));
      const cueFrame = rec.param(0x10, "i16");
      const drop = rec.param(0x12, "i16");
      const hold = rec.param(0x14, "i16");
      if (off.every(finite) && cueFrame !== null && drop && hold) {
        grab = { offset: off, cue_frame: cueFrame, drop_frames: drop,
                 hold_frames: hold, player: rec.param(0x16, "i8") || 0 };
      }
    }
    let backAwayDelay: number | null = null;
    if (inStates(BACK_AWAY_STATES)) {
      const n = rec.param(4, "i32");
      if (n !== null && n >= 0 && n < 3600) backAwayDelay = n;
    }
    let cue: Record<string, unknown> | null = null;
    if (inStates(CUE_STATES)) {
      const m = rec.param(4, "i32");
      const cond = rec.param(8, "i16");
      const arg = rec.param(0xa, "i16");
      if (m !== null && m > 0 && m < 4096 && cond !== null) {
        cue = { motion: m, cond, operand: arg || 0 };
      }
    }
    let leapStrikeFrames: number | null = null;
    if (inStates(LEAP_STRIKE_STATES)) {
      const n = rec.param(4, "i32");
      if (n !== null && n > 0 && n < 3600) leapStrikeFrames = n;
    }
    // The two placing entrances. Both are class 0x30 only, and both are read
    // off the tail at offsets no other state uses.
    let emerge: Record<string, unknown> | null = null;
    let delayedLeap: Record<string, unknown> | null = null;
    if (cls === 0x30 && tailState === 27) {
      const m = rec.param(8, "i32");
      if (m !== null && m > 0 && m < 4096) {
        emerge = { delay: rec.param(4, "i32") || 0, motion: m };
      }
    }
    if (cls === 0x30 && tailState === 26) {
      const dest = [0, 1, 2].map((k) => rec.param(8 + 4 * k, "f32"));
      const g = rec.param(0x14, "f32");
      if (dest.every(finite) && finite(g) && g > 0 && g < 10) {
        delayedLeap = { delay: rec.param(4, "i32") || 0, dest, gravity: g };
      }
    }
    const class13 = cls === 0x13 ? class13Tail(rec, tables) : null;
    const class12 = cls === 0x12 ? class12Tail(rec, coliSets) : null;
    const class15 = cls === 0x15 ? class15Tail(rec, coliSets) : null;
    const class18 = cls === 0x18 ? class18Tail(rec) : null;
    const class26 = cls === 0x26 ? class26Tail(rec, coliSets) : null;
    const class19 = cls === 0x19 ? class19Tail(rec, coliSets) : null;
    const boneMeshColi = cls === 0x30 || cls === 0x18
      ? zombieBoneMeshColi(rec, res.charType, coliSets) : null;
    const class20 = cls === 0x20 ? class20Tail(rec) : null;
    const class11 = cls === 0x11 ? class11Tail(rec) : null;
    const class43 = cls === 0x43 ? class43Tail(rec) : null;
    const class46 = cls === 0x46 ? class46Tail(rec) : null;
    const class42 = cls === 0x42 ? class42Tail(rec) : null;
    const class29 = cls === 0x29 ? class29Tail(rec) : null;
    const class40 = cls === CLASS40 ? class40Tail(rec) : null;
    const class51 = cls === 0x51 ? class51Tail(rec) : null;
    const class52 = cls === 0x52 ? class52Tail(rec) : null;
    const class53 = cls === 0x53 ? class53Tail(rec) : null;
    const class14 = cls === 0x14 ? class14Tail(rec) : null;
    // Class 0x16 reads no tail -- the plane is the spawn's `y` -- so its
    // block is a marker. Class 0x17's is the source.
    const class16 = cls === 0x16 ? {} : null;
    const class17 = cls === 0x17
      ? class17Tail(rec, (sp.orient as number[] | undefined) ?? [0, 0, 0])
      : null;
    const class22 = cls === CLASS22 ? class22Tail(rec) : null;
    const class23 = cls === CLASS23 ? class23Tail(rec) : null;
    const class32 = cls === 0x32 ? class32Tail(rec) : null;
    const class45 = cls === 0x45 ? class45Tail(rec) : null;
    const class2d = cls === 0x2d ? class2dTail(rec) : null;
    // **Gated on the selector, not on the class.** Class 0x33 is eleven
    // objects behind one id and these four blocks are four of them reading
    // the same bytes; emitting two for one spawn, or any for a sub-handler
    // that is none of them, is `L3` written into the bundle. The port reads
    // which key is present as the selector, so exactly one of them is ever
    // set.
    const is33 = cls === 0x33;
    const class33 = is33 && rec.hp === CLASS33_CARRIER
      ? class33Tail(rec) : null;
    const class33Push = is33 && rec.hp === CLASS33_PUSHABLE
      ? class33PushTail(rec) : null;
    const class33Cue = is33 && rec.hp === CLASS33_EFFECT_CUE
      ? class33CueTail(rec) : null;
    const class33Sub = is33 ? class33SubTail(rec) : null;
    const class33Prop = is33 && rec.hp === CLASS33_DRAW_UNTIL_FLAG
      ? class33PropTail(rec) : null;
    let tscript: TargetScript | null = null;
    let ascript: TargetScript | null = null;
    let cameraCue: Record<string, unknown> | null = null;
    // Class 0x18 too: `CarriedZombieInit18` (`FUN_0045CD60`) is
    // `EnemyZombieInit` and two stores, so its tail is class 0x30's byte for
    // byte and `ZombieScriptForState` reads the same two blobs. Left out, the
    // rider on stage 2's boat had no script -- clip 0, arrival distance 0 --
    // and stood turning toward its civilian for the whole ride.
    if (cls === 0x30 || cls === 0x18) {
      // **The header shape belongs to the state that reads the blob, not to
      // the state the descriptor starts the actor in.** `ZombieScriptForState`
      // is `state == tail[3] ? tail+0x08 : tail+0x04`, so tail+0x04 is read by
      // *whatever* state the actor is in that is not its attack state -- and a
      // captor whose initial state is 39 is put into a state by its civilian's
      // op 0x1A rather than by its own descriptor.
      //
      // Keying the shape on tail[1] therefore dropped the blob for the six
      // such spawns in the game, because 39 has no shape of its own. All six
      // decode cleanly under the ordered state's shape and under no other.
      let tstate = tail[1];
      if (TARGET_SCRIPT_SHAPE[tstate] === undefined) {
        const parentAt = (sp.civilian_child as number | undefined) ?? -1;
        const parent = recs.get(parentAt);
        if (parent !== undefined) {
          for (const st of civilianOrderedStates(
              civscripts, parent.param(0x01, "i8") || 0)) {
            if (TARGET_SCRIPT_SHAPE[st] !== undefined) { tstate = st; break; }
          }
        }
      }
      tscript = targetScript(prog, evt.toOffset(rec.param(4, "u32") || 0),
                             tstate);
      ascript = targetScript(prog, evt.toOffset(rec.param(8, "u32") || 0),
                             tail[2]);
      // The captor family's camera cue, at tail +0x0C/+0x0E.
      // `ZombieScriptEnded` tests `tail+0x0C != -1` twice: once to raise
      // `obj+0x34 & 0x10000`, and once to divert an exit that would have gone
      // to `AttackRun` into state 42 instead, which holds the actor off the
      // player until the camera reaches `(tail+0x0C, tail+0x0E)`.
      //
      // Gated on the actor actually being a captor, not on its class: read
      // blind those bytes yield 333 "cues" of which 330 are mantissa.
      if (tscript || ascript) {
        const cuePath = rec.param(0xc, "i16");
        if (cuePath !== null && cuePath !== -1) {
          cameraCue = { path: cuePath, frame: rec.param(0xe, "i16") || 0 };
        }
      }
    }

    const p = new Placement();
    p.at = at;
    p.cls = cls;
    // -1, not null: a slot-drawn class has no character type and the client's
    // field is a number. The renderer skips these on the `motion` test.
    p.char_type = res.charType === null ? -1 : res.charType;
    p.motion = motion;
    p.spawn = sp;
    p.intro = intro;
    p.emerge = emerge;
    p.delayed_leap = delayedLeap;
    p.target_script = tscript;
    p.attack_script = ascript;
    p.camera_cue = cameraCue;
    p.entry = entry;
    p.body_condition = tail[0];
    p.initial_state = tail[1];
    p.attack_state = tail[2];
    p.leap = leap;
    p.path = path;
    p.walk_distance = walkDistance;
    p.entrance_motion = entranceMotion;
    p.stand_throw = standThrow;
    p.init_flags = Number(sp.flags ?? 0) || 0;
    p.pounce = pounce;
    p.grab = grab;
    p.back_away_delay = backAwayDelay;
    p.cue = cue;
    p.leap_strike_frames = leapStrikeFrames;
    p.ring_set = res.charType === 0 ? RING_SET_FOR_CHAR0 : 0;
    p.class13 = class13;
    p.class12 = class12;
    p.class15 = class15;
    p.class18 = class18;
    p.class26 = class26;
    p.class19 = class19;
    p.bone_mesh_coli = boneMeshColi;
    p.class20 = class20;
    p.class11 = class11;
    p.class43 = class43;
    p.class46 = class46;
    p.class42 = class42;
    p.class29 = class29;
    p.class40 = class40;
    p.class51 = class51;
    p.class52 = class52;
    p.class53 = class53;
    p.class14 = class14;
    p.class16 = class16;
    p.class17 = class17;
    p.class22 = class22;
    p.class23 = class23;
    p.class32 = class32;
    // The walker: made by its flier's class, never by the script.
    if (sp.nested_in !== undefined) {
      p.parent_at = sp.nested_in as number;
      p.synthetic = true;
    }
    p.class45 = class45;
    p.class2d = class2d;
    p.class33 = class33;
    p.class33_push = class33Push;
    p.class33_cue = class33Cue;
    p.class33_sub = class33Sub;
    p.class33_prop = class33Prop;
    // `ActorBindPartList` (`FUN_00412440`) -- the faces and accessories this
    // spawn wears. 97 of the game's spawns carry one and every list matches
    // its character's own family, which is what says the tail offsets are
    // right; see `ATTACHMENT_TAIL_OFFSET`.
    p.attachments = attachmentList(evt, rec, cls, attachRecords.length);
    p.hp = (sp.hp as number) ?? 0;
    placements.push(p);
    // A horde's members: see `hordeMemberPlacements`. Emitted here, before
    // the placer's own row leaves as a marker below.
    if (cls === CLASS40 && class40
        && (class40.selector as number) === CLASS40_SELECTOR_HORDE) {
      for (const m of await hordeMemberPlacements(stage, tables, sp, chars)) {
        placements.push(m);
        let mlist = perType.get(CLASS40_MEMBER_CHAR_TYPE);
        if (!mlist) { mlist = []; perType.set(CLASS40_MEMBER_CHAR_TYPE, mlist); }
        mlist.push({ ...sp, at: m.at, class: CLASS40, hp: 0 } as SpawnJson);
      }
    }

    if (motion === null) continue;         // marker only -- see the module note
    // A slot-drawn class reaches the placement above with no character type
    // and no motion, so the `motion` guard has already taken it; this says so
    // to the compiler, which cannot see that the two are the same set.
    if (res.charType === null) continue;
    if (!chars.has(res.charType)) {
      const built = JUDGMENT_CHAR_TYPES.has(res.charType)
        ? judgmentBuild(prog, tables, res.charType, res.assetFile)
        : build(tables, res.charType, res.assetFile!);
      if (built === null) continue;
      chars.set(res.charType, built);
    }
    const c = chars.get(res.charType)!;
    // The models an attachment list names live in other `pol/` files, so the
    // slots go on the character type and `goreEntry` pulls them in once.
    for (const id of p.attachments) {
      const arec = attachRecords[id];
      if (arec && arec.slot) c.attachmentSlots.add(arec.slot);
    }
    // The death set is authored against zom.bin's skeleton. `bake` drops it
    // for any character whose bone count differs, so the list is offered
    // unconditionally and filtered by the data rather than by a constant.
    const deaths = [...dset.front, ...dset.back, DEATH_RIGHT, DEATH_LEFT];
    // Every clip the states can reach. No bone-count guard is needed here:
    // `bake` refuses a motion whose own block implies a different skeleton, so
    // a table row naming another creature's clip -- which the shared,
    // condition-indexed throw table does -- simply does not bake.
    const reacts: number[] = [...new Set(
      [...c.reactions.values()].flat())].sort((a, b) => a - b);
    for (const row of c.attacks.values()) {
      for (const e of row.values()) {
        reacts.push(e.strike as number, e.lunge as number);
      }
    }
    for (const hands of Object.values(
        (c.throw_?.hands as Record<string, Record<string, unknown>[]>) ?? {})) {
      for (const h of hands) reacts.push(h.motion as number);
    }
    // The whole row the five ported states reach: 0/1 the walk
    // `ZombieStateApproach` and `ZombieStateHoldAtRange` play, **2/3 the run
    // `ZombieStateAttackRun` plays**, and the back-away. Baking only 0, 1 and
    // the back-away leaves the attack run with no clip, and since the closing
    // is that clip's own root motion, the zombies never advanced.
    for (const row of c.motionRowByCond.values()) {
      for (const i of [0, 1, 2, 3, 4]) {
        if (i < row.length && row[i] > 0 && row[i] < 4096) reacts.push(row[i]);
      }
    }
    // The entrance clips a class-0x31 descriptor names for itself, plus every
    // clip its behaviour set can reach. `bake` refuses a clip authored for
    // another skeleton, so the list is offered whole rather than filtered.
    const entryClips: (number | null | undefined)[] = [];
    for (const q of placements) {
      if (q.at === at && q.entrance_motion) entryClips.push(q.entrance_motion);
    }
    for (const q of placements) {
      if (q.at === at && q.pounce) entryClips.push(q.pounce.motion as number);
    }
    for (const q of placements) {
      if (q.at === at && q.cue) entryClips.push(q.cue.motion as number);
    }
    if (cls === 0x31) entryClips.push(...class31MotionIds(class31));
    if (cls === 0x19) entryClips.push(...BOSS4_CLIPS);
    // The frog's whole bank -- see `FROG_CLIPS`.
    if (cls === 0x11) entryClips.push(...FROG_CLIPS);
    // The cat's whole playlist -- see `CAT_CLIPS`. Entry 0 of its set comes
    // from `MOTION_RULES`; the rest are what `CatMotionListUpdate` steps on
    // to, and the last of them is the clip that carries it out of the room.
    if (cls === 0x53) entryClips.push(...CAT_CLIPS);
    // The stage-2 boss's whole bank -- see `CLASS14_MOTIONS`.
    if (cls === 0x14) entryClips.push(...CLASS14_MOTIONS);
    // JUDGMENT's two: every clip the flier's and the walker's states name,
    // all in `mot/boss1.bin`. Their states measure exits on these clips' play
    // clocks, so a missing one is a state that never ends.
    if (cls === CLASS22) entryClips.push(...CLASS22_MOTIONS);
    if (cls === CLASS23) entryClips.push(...CLASS23_MOTIONS);
    // The stage-5 boss's clips -- see `CLASS32_MOTIONS`.
    if (cls === 0x32) entryClips.push(...CLASS32_MOTIONS);
    // The stage-3 boss's clips, all three of its skeletons' -- see
    // `BOSS3_CLIPS`.
    if (cls === 0x45) entryClips.push(...BOSS3_CLIPS);
    // The stage-6 boss's whole bank, `boss6.bin`'s 0x95..0xB0 -- see
    // `CLASS2D_CLIPS`.
    if (cls === 0x2d) entryClips.push(...CLASS2D_CLIPS);
    // ...and the shells `DrawCharacterPartSlot`'s type-0x4C arm draws after
    // parts 0..5, which no node names: on the type's template, for the
    // character layer to hang on the parts' draw bones.
    if (cls === 0x2d) for (const s of CLASS2D_PART_SHELLS) c.heldSlots.add(s);
    // The emerge clip, the submerged pose it holds first, and the two clips
    // the delayed leap plays. An unbaked entrance is an actor standing in the
    // water.
    if (emerge) entryClips.push(emerge.motion as number, 0xb9);
    if (delayedLeap) entryClips.push(0x3bb, 0x399, 0x3f7);
    // The twelve entrance states' own clips. Every one of these states
    // measures its exit on the **play clock** of a clip it names, so an
    // unbaked clip is not a cosmetic gap: `MotionPlayLength` is 0, the cursor
    // never reaches the last frame, and the actor waits for ever.
    if (entry) {
      entryClips.push(entry.motion as number | undefined,
                      entry.idle_motion as number | undefined,
                      entry.strike_motion as number | undefined);
      if (tailState === 13) {
        // Chosen by character type, not named in the tail.
        entryClips.push(0xb8, 0x3d8);
      }
      if (tailState === 23) {
        // The paired wait/grab clips: it plays 0xBB and blends 0xBA.
        entryClips.push(0xba, 0xbb);
      }
      if (tailState === 30) {
        // The crouch and the three arc-script stages, both by type.
        entryClips.push(0x10c, 0x39f);
        for (const k of CLASS30_ENTRANCE_ARC_SCRIPTS) {
          for (const st of arcScript(tables, CLASS30_ARC_SCRIPTS[k]) ?? []) {
            entryClips.push(st.motion);
          }
        }
      }
    }
    // Body condition 4 attacks through `ZombieStateLeapStrike`
    // (`FUN_0045E330`), not `ZombieStateStrike`: its arc script's windup,
    // flight and landing clips. Every `znkager` is condition 4.
    if (cls === 0x30 && tail[0] === 4) {
      const leap = CLASS30_ARC_SCRIPTS.leap_strike;
      for (const st of arcScript(tables, leap) ?? []) entryClips.push(st.motion);
    }
    // The two clips the `znjoe` release state names -- keyed by character
    // type, because that state is. See {@link BODY_CREATURE_HOST_CLIPS}.
    entryClips.push(...(BODY_CREATURE_HOST_CLIPS[res.charType] ?? []));
    // `ActorSnapToGroundHeight` routes an actor over a drop into state 11,
    // whose landing clip is 0x3BA -- and every class-0x30 actor can now reach
    // it, so it is baked for all of them.
    entryClips.push(0x3ba);
    // The six death clips `ChooseDeathMotion` (`FUN_004560B0`) can reach above
    // the directional pick -- see {@link CLASS30_DEATH_CLIPS} for which, why
    // they are offered per character type rather than per spawn, and which
    // four arms are deliberately still out.
    if (cls === 0x30) entryClips.push(...CLASS30_DEATH_CLIPS);
    // State 43's four -- `ZombieStateDragTarget` (`FUN_0045C080`) names them
    // as immediates, so no script does. Gated on the actor being able to be
    // in state 43: its descriptor's own initial or attack state, or a state
    // its civilian's op 0x1A orders it into. Stage 4's `0x35B4` is the one
    // spawn in the game that is; without them it stood upright inside the
    // civilian it is meant to be on the back of.
    if (cls === 0x30) {
      const parent = recs.get((sp.civilian_child as number | undefined) ?? -1);
      const ordered = parent === undefined ? []
        : civilianOrderedStates(civscripts, parent.param(0x01, "i8") || 0);
      if ([tail[1], tail[2], ...ordered].includes(ZombieState.DragTarget)) {
        entryClips.push(...DRAG_TARGET_CLIPS);
      }
    }
    // Class 0x25's own clips: the ones its command block names with `op 2` and
    // `op 3`. Baking only the header's motion leaves some of the six stages'
    // 385 (program, clip) pairs, across 137 programs, with no frames, and a
    // class-0x25 actor whose clip has none is not merely undrawn -- its `op 1`
    // mode 2 wait on the clip's last frame can never fire, so the VM parks for
    // the rest of the stage. `web/tools/checks/script_corpus.ts` holds every
    // pair baked.
    if (cls === 0x25) entryClips.push(...humanoidMotionIds(evt, rec));
    // ...and the models its `op 9` and `op 16` put on a bone. Each is a slot
    // the skeleton may not name -- the hand another character holds, a
    // wound -- and the swap clones by slot, so they ride the hidden template.
    if (cls === 0x25) {
      for (const s of humanoidModelSlots(tables, evt, rec, res.charType)) {
        c.heldSlots.add(s);
      }
      // ...and the extra models `ScriptedHumanoidBoneDrawHook`
      // (`FUN_00485260`) draws for this type and the clips this program
      // plays -- immediates in the hook, which no table names.
      for (const s of HumanoidHookDrawSlots(res.charType,
                                            humanoidMotionIds(evt, rec))) {
        c.heldSlots.add(s);
      }
      // ...and the heads the same hook draws for a talking or blinking face
      // -- see `game/class25/face.ts`.
      const talks = humanoidFaceModes(evt, rec).includes(FACE_MODE_TALK);
      for (const s of HumanoidFaceSlots(
          res.charType, talks,
          humanoidFaceCels(tables, HUMANOID_FACE_CELS),
          humanoidFaceCels(tables, HUMANOID_FACE_CELS_TWO))) {
        c.heldSlots.add(s);
      }
    }
    // Class 0x20's four idles -- `OneHitTargetInit` picks between them with
    // `rand() & 3`, so all four have to exist before the draw is made -- and
    // the clip `OneHitTargetUpdate` cues the frame the actor is shot.
    if (cls === 0x20) {
      entryClips.push(...CLASS20_IDLE_MOTIONS, CLASS20_DEATH_MOTION);
    }
    // Class 0x21's freed clip. The idle comes from `MOTION_RULES`; this is the
    // one `RescueTargetHeldState` swaps to when the target is rescued.
    if (cls === 0x21) entryClips.push(CLASS21_FREED_MOTION);
    entryClips.push(...targetScriptMotions(tscript));
    entryClips.push(...targetScriptMotions(ascript));
    if (cls === 0x10) {
      const which = rec.param(0x01, "i8") || 0;
      entryClips.push(...civilianMotionIds(civscripts, which));
      for (const s of civilianItemSlots(civscripts, which)) c.heldSlots.add(s);
      // ...and the mouth: `CivilianDrawBonePart` (`FUN_0048D1F0`) draws her
      // head at its record slot plus a cel from the rows her script's op
      // 0x25 names, so every `slot + cel` it can reach rides the template.
      for (const s of civilianMouthSlots(tables, c, p.attachments,
                                         attachRecords,
                                         civilianMouthRows(civscripts, which))) {
        c.heldSlots.add(s);
      }
    }
    // The models the stage-4 boss swaps onto its bones -- the hand that holds
    // a prop, the blade `Boss4Init` seats, and the nine heads
    // `Boss4ResolveShot` steps through as the bar falls. See
    // `game/class19/slots.ts`.
    if (cls === 0x19) {
      const heads = (tables.boss4Tables().head_slot_by_bar as number[]) ?? [];
      for (const s of Boss4SwapSlots(heads)) c.heldSlots.add(s);
    }
    for (const mid of [motion, intro ? intro[0] : null,
                       ...deaths, ...reacts, ...entryClips]) {
      if (mid === null || mid === undefined || c.motions.has(mid)) continue;
      const baked = await bake(stage.source, tables, mid, c.boneCount);
      if (baked !== null) c.motions.set(mid, baked);
    }
    if (!c.motions.has(motion)) continue;
    let list = perType.get(res.charType);
    if (!list) { list = []; perType.set(res.charType, list); }
    list.push(sp);

    // -- the bat's wings ---------------------------------------------------
    //
    // `SpawnBatWings` (`FUN_0042E060`) builds a **second skinned actor** per
    // bat: character type 0x1F, `zabat_wing.bin`, six nodes in two
    // three-segment chains, running clip 0x406 off its body's motion clock.
    // The engine needs no descriptor for it -- the placer allocates it -- and
    // that is exactly why the bundle has to carry one: the client binds a
    // drawable hierarchy to a **placement**, by spawn address, so an actor
    // with no placement is an actor with no geometry.
    //
    // So this is a **synthetic placement**: a row the evt script has no
    // descriptor for, marked as such, at the address the port's
    // `SpawnBatWings` gives the actor and parented to the body's. Nothing
    // spawns from it -- `SpawnScriptedCharacters` skips a synthetic row and
    // the placer still makes the object, as the engine does. It exists to
    // carry geometry and to be adopted.
    //
    // A sub-type-0 descriptor is its own member, so its body is this row and
    // only the wing needs one. Sub-types 1 and 2 are placers whose members
    // are runtime children, and the same trick keys on the address the port
    // gives each child: a body row and a wing row per member, all parented to
    // the placer. See `game/class46/`, "How every bat is drawn".
    if (cls === CLASS46 && class46) {
      const subtype = class46.subtype as number;
      const pushRow = (row: Placement, ct: number): void => {
        placements.push(row);
        let l = perType.get(ct);
        if (!l) { l = []; perType.set(ct, l); }
        l.push({ ...sp, at: row.at, class: CLASS46, hp: 0 } as SpawnJson);
      };
      if (subtype === CLASS46_SUBTYPE_DIVE) {
        const wing = await batWingPlacement(stage, tables, sp.at as number,
                                            sp.at as number, p, chars);
        if (wing) pushRow(wing, CLASS46_WING_CHAR_TYPE);
      }
      for (let i = 0; i < (CLASS46_CHILD_MEMBERS[subtype] ?? 0); i += 1) {
        const body = batChildPlacement(sp, p, subtype, i);
        pushRow(body, CLASS46_BODY_CHAR_TYPE);
        const wing = await batWingPlacement(stage, tables, body.at,
                                            sp.at as number, body, chars);
        if (wing) pushRow(wing, CLASS46_WING_CHAR_TYPE);
      }
    }
  }

  // -- JUDGMENT's sub-actor and the flier's extra models -------------------
  //
  // `Class22Init` builds a second skinned actor per flier -- character type
  // 0x46, clip 0x10 -- and `Class22DrawBonePart` (`FUN_0049D980`) draws node
  // 2 from a cycle of slots `0x2A5 + g_class22_node2_cycle_a/b` and node 1
  // with two more models, `0x2B4` and `0x2B5`. None of those is a skeleton
  // node's own slot, so each rides the character's hidden template rig.
  for (const p of [...placements]) {
    if (p.cls !== CLASS22 || p.synthetic || p.motion === null) continue;
    const sub = await class22SubActorPlacement(stage, tables, prog, p.spawn,
                                               chars);
    if (sub) {
      placements.push(sub);
      let slist = perType.get(CLASS22_SUBACTOR_CHAR_TYPE);
      if (!slist) {
        slist = [];
        perType.set(CLASS22_SUBACTOR_CHAR_TYPE, slist);
      }
      slist.push({ ...p.spawn, at: sub.at, class: CLASS22, hp: 0 } as SpawnJson);
    }
    const c = chars.get(p.char_type);
    if (c) {
      for (const k of [...CLASS22_NODE2_CYCLE_A, ...CLASS22_NODE2_CYCLE_B]) {
        c.heldSlots.add(CLASS22_NODE2_SLOT_BASE + k);
      }
      c.heldSlots.add(CLASS22_NODE1_EXTRA_A);
      c.heldSlots.add(CLASS22_NODE1_EXTRA_B);
    }
  }

  // -- the stage-6 boss's children ---------------------------------------------
  //
  // `Class2DState4` allocates one child at a time from `ActorAlloc` -- kinds
  // 0..3, character types 0x4D, 0x4F, 0x50 and 0x51 -- and kind 0 builds a
  // wing (0x4E) in a block of its own. None has a descriptor, so each gets a
  // synthetic row at the address the port gives it (`Class2DChildAt`),
  // parented to the fight's descriptor, carrying the geometry the character
  // layer adopts the object into; nothing spawns from them.
  for (const p of [...placements]) {
    if (p.cls !== 0x2d || p.synthetic || p.motion === null) continue;
    if (((p.class2d?.subtype as number | undefined) ?? 0) !== 1) continue;
    for (const row of await class2dChildPlacements(stage, tables, p, chars)) {
      placements.push(row);
      let clist = perType.get(row.char_type);
      if (!clist) { clist = []; perType.set(row.char_type, clist); }
      clist.push({ ...p.spawn, at: row.at, class: 0x2d, hp: 0 } as SpawnJson);
    }
  }

  // -- `znele`'s twin ---------------------------------------------------------
  //
  // `EnemyZombieInitByCharType` (`FUN_00452FD0`)'s type-0x12 arm allocates a
  // second class-0x30 actor of character type 9 beside every `znele` whose
  // `obj+0x34` lacks 0x10000000, and it wears the host's clip every frame
  // (`ZombieTwinFollowHost`, `FUN_00453290`). Like the bat's wings it has no
  // descriptor and so needs a synthetic row to carry its geometry; see
  // `zombieTwinPlacements`. Emitted after every spawn has been read, so the
  // twin is baked every clip its host's type has.
  for (const tw of await zombieTwinPlacements(stage, tables, placements,
                                              chars)) {
    placements.push(tw);
    let tlist = perType.get(ZOMBIE_TWIN_CHAR_TYPE);
    if (!tlist) { tlist = []; perType.set(ZOMBIE_TWIN_CHAR_TYPE, tlist); }
    tlist.push(tw.spawn);
  }

  // -- class 0x41 constructor 61's figures ---------------------------------
  //
  // Nine skinned actors `PlaceType61Figures` allocates with no descriptor;
  // see `type61FigurePlacements`.
  for (const f of await type61FigurePlacements(stage, tables, recs.values(),
                                               byAt, chars)) {
    placements.push(f);
    let flist = perType.get(f.char_type);
    if (!flist) { flist = []; perType.set(f.char_type, flist); }
    flist.push(f.spawn);
  }

  // -- the players' bodies ---------------------------------------------------
  //
  // Two synthetic rows, one per player, in every stage: a game over can come
  // anywhere. See `playerBodyPlacement`.
  for (let p = 0; p < PLAYER_BODY_AT.length; p++) {
    const body = await playerBodyPlacement(stage, tables, p, chars);
    if (!body) {
      degraded.note("hod2lib.characters.resolve_for_stage",
                    `player ${p + 1}'s body`,
                    "the game-over fly-over draws no body",
                    "the character type or motion 0x338 did not build");
      continue;
    }
    placements.push(body);
    let blist = perType.get(body.char_type);
    if (!blist) { blist = []; perType.set(body.char_type, blist); }
    blist.push(body.spawn);
  }

  // -- the result card's figures -------------------------------------------
  //
  // One hidden row per type the card can stand; see `resultFigureTemplates`.
  for (const t of await resultFigureTemplates(stage, tables, prog, placements,
                                              chars)) {
    placements.push(t);
    let flist = perType.get(t.char_type);
    if (!flist) { flist = []; perType.set(t.char_type, flist); }
    flist.push(t.spawn);
  }

  // -- the golden frog -----------------------------------------------------
  //
  // One hidden row of type 0x1C where a container can let one out; see
  // `goldenFrogTemplates`.
  for (const t of await goldenFrogTemplates(stage, tables, breakables,
                                            chars)) {
    placements.push(t);
    let glist = perType.get(t.char_type);
    if (!glist) { glist = []; perType.set(t.char_type, glist); }
    glist.push(t.spawn);
  }

  const order = [...perType.keys()].sort((a, b) => a - b);
  const entries: RigInstance[] = [];
  for (const ct of order) {
    const c = chars.get(ct);
    if (!c) continue;
    const e = await rigEntry(stage, tables, c, perType.get(ct)!, poseFrame,
                             poseMotion, cache);
    if (e) entries.push(e);
  }
  // One hidden template per character type carrying its damaged parts. The
  // client clones from it on a hit -- emitting them on all 108 instances
  // instead would multiply the geometry for something only a few bones show.
  //
  // **The gate asks `goreEntry` rather than guessing what it will emit.** It
  // used to test `gore or heldSlots`, and every time something new started
  // riding this rig the gate was left behind: gating on `gore` alone left
  // every held item with nothing to clone from, and adding `heldSlots` then
  // left every *head* with nothing to clone from once the severed head started
  // cloning the pristine head model. `goreEntry` already returns null when it
  // has no parts, so asking it is both cheaper to keep correct and exactly as
  // selective.
  for (const ct of order) {
    const c = chars.get(ct);
    if (!c) continue;
    const e = await goreEntry(stage, tables, c, cache);
    if (e) entries.push(e);
  }
  return { chars, placements, entries };
}

/**
 * `g_character_part_tables`' damaged-part rows, by character type, for every
 * type this stage builds and for the two `ActorSwapDamagedPart`
 * (`FUN_004098E0`) searches after the actor's own -- see
 * {@link partSphereRows} and {@link PART_SPHERE_FALLBACK_TYPES}.
 *
 * The rows kept are the ones whose slot some bone's effect table can hand
 * the swap: every step slot above 1 of every type here, since 0 and 1 zero
 * the radius without a search (`0x00409924`, `0x00409929`). Keyed and walked
 * the same way for all of them, because the search is keyed by the table and
 * not by whose slot it is looking for.
 */
export function partSpheres(tables: ExeTables,
                            chars: Map<number, Character>):
    Record<string, unknown> {
  const slots = new Set<number>();
  for (const c of chars.values()) {
    for (const b of c.bones) {
      for (const st of b.steps ?? []) if (st[0] > 1) slots.add(st[0]);
    }
  }
  const types = new Set<number>([...chars.keys(),
                                 ...PART_SPHERE_FALLBACK_TYPES]);
  const out: Record<string, unknown> = {};
  for (const ct of [...types].sort((a, b) => a - b)) {
    out[String(ct)] = partSphereRows(tables, ct, slots);
  }
  return out;
}

/**
 * Every head model `CivilianDrawBonePart` (`FUN_0048D1F0`) can draw for one
 * class-0x10 spawn: its head's record slot plus each cel of each mouth row
 * its script names -- and row 3 behind row 2, which the hook hands over to.
 *
 * The record is what `ActorBindPartList` (`FUN_00412440`) leaves in bone 2:
 * the last head id below the split the spawn's list names, or the skeleton's
 * own head when it names none.
 */
function civilianMouthSlots(tables: ExeTables, c: Character,
                            attachments: readonly number[],
                            records: readonly { bone: number; slot: number }[],
                            rows: readonly number[]): number[] {
  if (!rows.length) return [];
  let head = c.bones.find((b) => b.bone === CIVILIAN_HEAD_BONE)?.slot ?? 0;
  for (const id of attachments) {
    if (id >= ExeTablesClass.ATTACHMENT_REPLACES_BELOW) continue;
    const r = records[id];
    if (r && r.bone === CIVILIAN_HEAD_BONE && r.slot) head = r.slot;
  }
  if (!head) return [];
  const mouth = civilianMouthTables(tables);
  const want = new Set(rows);
  if (want.has(CIVILIAN_MOUTH_HANDOFF_FROM)) want.add(CIVILIAN_MOUTH_HANDOFF_TO);
  const out = new Set<number>();
  for (const r of want) for (const cel of mouth[r] ?? []) out.add(head + cel);
  return [...out].sort((a, b) => a - b);
}

/** The `characters` block of `<stage>.script.json`. */
export function charactersJson(chars: Map<number, Character>,
                               placements: Placement[],
                               tables: ExeTables | null = null):
    Record<string, unknown> {
  const posed = placements.filter((p) => p.motion !== null).length;
  const types: Record<string, unknown> = {};
  for (const ct of [...chars.keys()].sort((a, b) => a - b)) {
    types[String(ct)] = chars.get(ct)!.toJson();
  }
  return {
    deaths: tables !== null ? deathMotions(tables) : {},
    difficulty: tables !== null ? difficultyTables(tables) : {},
    combat: tables !== null ? combatTables(tables) : {},
    reaction_groups: tables !== null ? reactionGroups(tables) : [],
    approach: tables !== null ? approachTables(tables) : {},
    tracking: tables !== null ? cameraTracking(tables) : {},
    player: playerDamage(),
    bone_zones: tables !== null ? boneZones(tables) : [],
    part_spheres: tables !== null ? partSpheres(tables, chars) : {},
    // `g_player_hand_slots` -- class 0x25's `op 9` reads it at run time,
    // because in Original Mode the row is a global's and not the command's.
    player_hand_slots: tables !== null ? playerHandSlots(tables) : [],
    // The cels the two talking hooks add to a head's slot -- see `faces.ts`.
    civilian_mouth_tables: tables !== null ? civilianMouthTables(tables) : [],
    humanoid_face_cels: tables !== null
      ? humanoidFaceCels(tables, HUMANOID_FACE_CELS) : [],
    humanoid_face_cels_two: tables !== null
      ? humanoidFaceCels(tables, HUMANOID_FACE_CELS_TWO) : [],
    class31: tables !== null ? class31Tables(tables) : {},
    // Class 0x14's `.rdata` -- the stage-2 boss's cue, cone, window and
    // round tables. See `class14.ts`.
    class14: tables !== null ? class14Tables(tables) : {},
    // Class 0x32's -- the stage-5 boss's phase ladder and rank tables. See
    // `class32.ts`.
    class32: tables !== null ? class32Tables(tables) : {},
    // `g_actor_attachment_records` -- one table for the whole game, indexed
    // by the ids in a placement's `attachments`.
    attachments: tables !== null ? tables.attachmentRecords() : [],
    attachment_replaces_below: ExeTablesClass.ATTACHMENT_REPLACES_BELOW,
    types,
    placements: placements.map((p) => p.toJson()),
    note: "A character is assembled from the EXE skeleton and posed from a "
      + "mot/ frame. Bind pose is not a rest pose -- every bone offset runs "
      + "along its own local X, so an unposed character is a heap of parts. "
      + "Only classes whose handler has been read get a motion rule, so the "
      + `rest keep their spawn marker: ${posed} of ${placements.length} `
      + "identified spawns are posed.",
  };
}
