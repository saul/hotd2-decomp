/**
 * Assemble a spawned character: skeleton, placement and motion.
 * The port of `tools/hod2lib/characters.py`.
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
 * **The re-exports are gone.** `characters.py` re-exports every name of the
 * nine modules below it, so that splitting it was a refactor and not a flag
 * day across `tools/verify_*.py`. Nothing in TypeScript ever imported the old
 * shape, so this module exports only what it owns; import from the module that
 * owns a name.
 */

import { arcScript, CLASS30_ARC_SCRIPTS } from "./arcscript";
import { civilianItemSlots, civilianMotionIds, civilianOrderedStates,
         TARGET_SCRIPT_SHAPE, targetScript,
         targetScriptMotions } from "./actorscript";
import type { CivBlock, TargetScript } from "./actorscript";
import { approachTables, cameraTracking, RING_SET_FOR_CHAR0 } from "./approach";
import { build, goreEntry, rigEntry } from "./charbuild";
import type { Character } from "./charbuild";
import { CLASS20_DEATH_MOTION, CLASS20_IDLE_MOTIONS, bake,
         humanoidMotionIds, introFor, motionFor,
         BOSS4_CLIPS, FROG_CLIPS } from "./charmotion";
import { class31MotionIds, class31Tables } from "./class31";
import { boneZones, combatTables, DEATH_LEFT, DEATH_RIGHT, deathMotions,
         difficultyTables, playerDamage, reactionGroups,
         STAND_AND_THROW_STATES } from "./combat";
import * as degraded from "./degraded";
import * as evtlib from "./evt";
import type { Spawn } from "./evt";
import { ExeTables as ExeTablesClass } from "./exetab";
import type { ExeTables } from "./exetab";
import { attachmentList, BACK_AWAY_STATES, CUE_STATES,
         ENTRANCE_CLIP_STATES, entryTail, GRAB_STATES, LEAP_STATES,
         LEAP_STRIKE_STATES, PATH_STATES, Placement, POUNCE_STATES,
         WALK_DISTANCE_STATES, WAYPOINT_BYTES } from "./placement";
import type { SpawnJson } from "./placement";
import { AssetCache } from "./rigs";
import type { RigInstance } from "./rigs";
import type { Program } from "./script";
import { resolveSpawn } from "./spawnres";
import type { Stage } from "./stage";

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
 */
export const SLOT_DRAWN_CLASSES = new Set([0x33, 0x43, 0x51, 0x52]);

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
export function class43Tail(rec: Spawn): Record<string, unknown> {
  const b = rec.evt?.raw;
  const at = rec.offset + 0x24;
  const s8 = (v: number | undefined) => ((v ?? 0) << 24) >> 24;
  return {
    subtype: b ? s8(b[at + 1]) : 0,
    member: Math.max(0, (rec.hp ?? 1) - 1),
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
 * The one class-0x33 sub-handler the player runs: `obj+0x11C == 1`.
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
 * Which spawns of a {@link SLOT_DRAWN_CLASSES} class the bundle carries a
 * placement for.
 *
 * Class 0x52 is one object, so every spawn of it qualifies. Class 0x33 is
 * eleven, and only **two** sub-handlers are decoded below -- selector 1 by
 * {@link class33Tail} and selector 4 by {@link class33PushTail}. Selector 2's
 * props already reach the player through `props`, and the other eight are
 * unread. Emitting one of those would be a placement whose tail block is a
 * different handler's bytes read under one of these two's names, which is `L3`
 * written into the bundle.
 *
 * **The two blocks are mutually exclusive and the port reads their presence as
 * the selector**, so widening this is only half the change: see the gate on
 * `class33`/`class33_push` in {@link resolveCharacters}.
 */
export function slotDrawnSpawn(cls: number, rec: Spawn): boolean {
  if (cls === 0x33) {
    return rec.hp === CLASS33_CARRIER || rec.hp === CLASS33_PUSHABLE;
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
    cache: AssetCache = new AssetCache(stage)): Promise<ResolvedCharacters> {
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

  const chars = new Map<number, Character>();
  const placements: Placement[] = [];
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
    const tail: [number, number, number] = (cls === 0x30 || cls === 0x31)
      ? [rec.param(1, "i8") || 0, rec.param(2, "i8") || 0,
         rec.param(3, "i8") || 0]
      : cls === 0x19 ? [0, rec.param(1, "u8") || 0, 0]
      : [0, 0, 0];
    const inStates = (m: Record<number, number[]>) =>
      (m[cls] ?? []).includes(tail[1]);

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
    const entry = cls === 0x30 ? entryTail(rec, tail[1], tail[2]) : null;
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
    if (cls === 0x30 && tail[1] === 27) {
      const m = rec.param(8, "i32");
      if (m !== null && m > 0 && m < 4096) {
        emerge = { delay: rec.param(4, "i32") || 0, motion: m };
      }
    }
    if (cls === 0x30 && tail[1] === 26) {
      const dest = [0, 1, 2].map((k) => rec.param(8 + 4 * k, "f32"));
      const g = rec.param(0x14, "f32");
      if (dest.every(finite) && finite(g) && g > 0 && g < 10) {
        delayedLeap = { delay: rec.param(4, "i32") || 0, dest, gravity: g };
      }
    }
    const class20 = cls === 0x20 ? class20Tail(rec) : null;
    const class11 = cls === 0x11 ? class11Tail(rec) : null;
    const class43 = cls === 0x43 ? class43Tail(rec) : null;
    const class51 = cls === 0x51 ? class51Tail(rec) : null;
    const class52 = cls === 0x52 ? class52Tail(rec) : null;
    const class53 = cls === 0x53 ? class53Tail(rec) : null;
    const class14 = cls === 0x14 ? class14Tail(rec) : null;
    // **Gated on the selector, not on the class.** Class 0x33 is eleven
    // objects behind one id and these two blocks are two of them reading
    // the same bytes; emitting both for one spawn, or either for a
    // sub-handler that is neither, is `L3` written into the bundle. The
    // port reads which key is present as the selector, so exactly one of
    // them is ever set.
    const is33 = cls === 0x33;
    const class33 = is33 && rec.hp === CLASS33_CARRIER
      ? class33Tail(rec) : null;
    const class33Push = is33 && rec.hp === CLASS33_PUSHABLE
      ? class33PushTail(rec) : null;
    let tscript: TargetScript | null = null;
    let ascript: TargetScript | null = null;
    let cameraCue: Record<string, unknown> | null = null;
    if (cls === 0x30) {
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
    p.class20 = class20;
    p.class11 = class11;
    p.class43 = class43;
    p.class51 = class51;
    p.class52 = class52;
    p.class53 = class53;
    p.class14 = class14;
    p.class33 = class33;
    p.class33_push = class33Push;
    // `ActorBindPartList` (`FUN_00412440`) -- the faces and accessories this
    // spawn wears. 97 of the game's spawns carry one and every list matches
    // its character's own family, which is what says the tail offsets are
    // right; see `ATTACHMENT_TAIL_OFFSET`.
    p.attachments = attachmentList(evt, rec, cls, attachRecords.length);
    p.hp = (sp.hp as number) ?? 0;
    placements.push(p);

    if (motion === null) continue;         // marker only -- see the module note
    // A slot-drawn class reaches the placement above with no character type
    // and no motion, so the `motion` guard has already taken it; this says so
    // to the compiler, which cannot see that the two are the same set.
    if (res.charType === null) continue;
    if (!chars.has(res.charType)) {
      const built = build(tables, res.charType, res.assetFile!);
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
    // The stage-2 boss's whole bank -- see `CLASS14_MOTIONS`.
    if (cls === 0x14) entryClips.push(...CLASS14_MOTIONS);
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
      if (tail[1] === 13) {
        // Chosen by character type, not named in the tail.
        entryClips.push(0xb8, 0x3d8);
      }
      if (tail[1] === 23) {
        // The paired wait/grab clips: it plays 0xBB and blends 0xBA.
        entryClips.push(0xba, 0xbb);
      }
      if (tail[1] === 30) {
        // The crouch and the three arc-script stages, both by type.
        entryClips.push(0x10c, 0x39f);
        for (const a30 of Object.values(CLASS30_ARC_SCRIPTS)) {
          for (const st of arcScript(tables, a30) ?? []) {
            entryClips.push(st.motion);
          }
        }
      }
    }
    // `ActorSnapToGroundHeight` routes an actor over a drop into state 11,
    // whose landing clip is 0x3BA -- and every class-0x30 actor can now reach
    // it, so it is baked for all of them.
    entryClips.push(0x3ba);
    // Class 0x25's own clips: the ones its command block names with `op 2` and
    // `op 3`. Baking only the header's motion left 118 of the six stages' 263
    // (program, clip) pairs with no frames, and a class-0x25 actor whose clip
    // has none is not merely undrawn -- its `op 1` mode 2 wait on the clip's
    // last frame can never fire, so the VM parks for the rest of the stage.
    if (cls === 0x25) entryClips.push(...humanoidMotionIds(evt, rec));
    // Class 0x20's four idles -- `OneHitTargetInit` picks between them with
    // `rand() & 3`, so all four have to exist before the draw is made -- and
    // the clip `OneHitTargetUpdate` cues the frame the actor is shot.
    if (cls === 0x20) {
      entryClips.push(...CLASS20_IDLE_MOTIONS, CLASS20_DEATH_MOTION);
    }
    entryClips.push(...targetScriptMotions(tscript));
    entryClips.push(...targetScriptMotions(ascript));
    if (cls === 0x10) {
      const which = rec.param(0x01, "i8") || 0;
      entryClips.push(...civilianMotionIds(civscripts, which));
      for (const s of civilianItemSlots(civscripts, which)) c.heldSlots.add(s);
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
    class31: tables !== null ? class31Tables(tables) : {},
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
