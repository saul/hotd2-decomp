/**
 * Writes the static bundle the browser player loads.
 * Ported from `tools/hod2lib/bundle.py`, which was removed once the two
 * agreed byte for byte; see docs/TS_PORT.md.
 *
 * The player does **not** parse `pol/`, `tex/`, `cam/`, `evt/` or `Hod2.exe`
 * while it is playing: it loads glTF, evaluates Hermite curves and walks the
 * resolved event script. What changed with this port is *where* the parsing
 * can happen -- the same code now runs in a CLI or in a worker in the page, so
 * a bundle can be built without leaving the browser. It is still built once
 * and then consumed.
 *
 * Layout:
 *
 *     extract/player/
 *       manifest.json                stages present, tool version, source hashes
 *       stage2/
 *         stage2.glb                 geometry, materials, textures (or .gltf set)
 *         stage2.cam.json            Hermite curves keyed by global path slot
 *         stage2.script.json         the resolved event script and route graph
 *       stage2_original/             game mode 1, same shape
 *
 * `manifest.json` records the SHA-256 of every source file consumed, so a
 * bundle built from a different game build is detectable rather than
 * mysteriously wrong.
 */

import { BUILDER_FILES, BUILDER_HASH } from "../bundle/builder_hash";
import { SCHEMA_FILES, SCHEMA_HASH } from "../bundle/schema_hash";
// The one fact the exporter and the renderer must not hold twice: which slot
// `ScriptedHumanoidDraw`'s object-path arm draws. `class25/state.ts` is a
// declarations-and-constants file with no module-scope side effect, which is
// why it and not `class25/index.ts` -- that one registers a class handler,
// and the exporter has no business acquiring one.
import { HumanoidDrawVariant, HUMANOID_VARIANT3_SLOT }
  from "../game/class25/state";
import { f32, i16, i32, u32 } from "./bytes";
import { charactersJson, resolveForStage as resolveCharacters } from "./characters";
import * as charmotion from "./charmotion";
import * as degraded from "./degraded";
import type { Degradation } from "./degraded";
import * as evtlib from "./evt";
import type { Spawn } from "./evt";
import type { ExeTables } from "./exetab";
import * as gltf from "./gltf";
import type { BundleSink, Deflate, Progress } from "./io";
import { loadBank } from "./mot";
import { dumpsIndented, dumpsStrict } from "./pyjson";
import * as propslib from "./props";
import { AssetCache, resolveForStage as resolveRigs } from "./rigs";
import type { Rig, RigInstance } from "./rigs";
import { Program } from "./script";
import { sha256Hex } from "./sha256";
import { resolveSpawn } from "./spawnres";
import { pairKey } from "./stage";
import type { Stage } from "./stage";
import type { CamPaths } from "./campaths";

/**
 * Bumped when the on-disk shape changes in a way the client must notice. The
 * client refuses a bundle it does not know how to read rather than rendering
 * something subtly wrong.
 *
 * **It stayed at 1 across 23 commits to the reference implementation** -- the
 * ones that added `coli`, `civilians`, `humanoids` and `set_pieces`, and the
 * one that renumbered `game_mode`. A version check whose constant nobody bumps
 * is documentation, not a check.
 *
 * **This integer is still the coarse check, and it is not the one that will
 * fire.** It says "the *layout* moved"; the digest beside it, which nobody has
 * to remember, catches the field-level drift.
 */
export const BUNDLE_FORMAT = 7;

/**
 * `hod2lib.__version__`, which lands in the manifest as `tool_version`.
 *
 * It is informational -- the number a reader validates against is
 * {@link BUNDLE_FORMAT} -- and it names the *library*, not the implementation:
 * `tools/hod2lib/` is still where each format is specified in code, and its
 * `__version__` has to read the same. `tools/verify_exporters.py` checks that.
 *
 * 0.8.0 is the release that removed the Python bundle writer.
 */
export const TOOL_VERSION = "0.8.0";

/**
 * Every asset slot the three container families can draw. The group props use
 * the first four; `KindedPropUpdate` adds the three kinded models and the
 * smaller shadow, and `FallingContainerUpdate` the whole/loose/fragment trio.
 */
export const BREAKABLE_SLOTS = [
  0x19e8, 0x19e6, 0x1a0f, 0x10d0,          // BreakablePropUpdate
  0x17a9, 0x17aa, 0x17ab, 0x10d1,          // KindedPropUpdate
  0x0a50, 0x0a51, 0x0a55,                  // FallingContainerUpdate
];

/**
 * The `PlaceGenericProp` types that read `obj+0x28C`, i.e. whose descriptor
 * `+0x11C` really is an asset slot.
 *
 * `PlaceGenericProp` writes that field into *both* `obj+0x11C` (the lifetime
 * `PropExpireByStepLifetime` counts down) and `obj+0x28C` (the asset slot),
 * and only a few types ever draw the latter. Exporting `+0x11C` as a slot
 * resolved 46 of stage 2's 67 generic props to `char_adv03.bin` and other
 * characters -- which is what "the props are not rendering" looked like.
 *
 * Each entry is a routine whose body was read and found to pass
 * `(s16)obj+0x28C` to `AssetDrawSlot`:
 *
 * * 5 -- `PropDrawOnlyType5` (`FUN_00466820`)
 * * 12 -- `FUN_00467E50`
 * * 33 -- `FUN_00472950`, which draws `+0x28C + obj+0x2A0`
 * * **51 -- `PropDrawOnlyType51` (`FUN_0046EB20`)**
 *
 * **51 was missing, and that is the whole of why the stage 5 van had only its
 * rear doors.** The body is a type-51 placement at the doors' own position and
 * yaw, drawing slot `0x1793` = `char_adv04.bin[94]` -- three models before the
 * `[95]`/`[96]` pair `PropBuildVanDoors` hands its two hinges. The port placed
 * it all along and `DrawSlotFor` asked for `0x1793`; nothing put that slot in
 * the bundle, so there was no model to clone and the prop drew nothing, which
 * from outside is indistinguishable from a placement that was never exported.
 * Eleven type-51 spawns, all in stage 5: four vans, two flat quads at the same
 * pose as two of them, and five other pieces of street furniture from the same
 * file.
 *
 * **Types 31, 53 and 54 are here now too**, and were the last of the seven:
 *
 * * **31 -- `PropDrawOnlyType31` (`FUN_0046A1C0`)**, 6 spawns, an effect strip
 *   out of `eff_1.bin` and `eff_taki.bin`. Its slot is the *base* of a strip
 *   whose length is the descriptor's third orientation word; see
 *   `GENERIC_SLOT_STRIP` below.
 * * **53 -- `PropDrawOnlyType53` (`FUN_0046EBD0`)**, 2 spawns, slot `0x2B` =
 *   `char_adv04.bin[0]`, an inline variant of `PropExpireByStepLifetime`.
 * * **54 -- `PropDrawOnlyType54` (`FUN_0046EDC0`)**, 2 spawns, slot `0x18A1` =
 *   `st5_02b.bin[6]`, which drifts its whole pose while `g_script_flags[12]`
 *   is raised and kills itself 301 frames in.
 *
 * They were held out because adding a type makes its model travel *and* draw,
 * and a type whose own arm is unported arrives wearing the right geometry and
 * doing the wrong thing -- 54 in particular would have been visibly static
 * where the game has it tumbling away. All three arms are ported now, in
 * `game/class41/draw_only.ts`, which is what let their slots in. Ten shipped
 * spawns of scenery, missing for exactly the reason the van's body was.
 */
export const GENERIC_DESCRIPTOR_SLOT = [5, 12, 31, 33, 51, 53, 54];

/**
 * The two descriptor-slot types whose routine plays its slot as a **strip**,
 * so the whole strip has to travel and not just the base.
 *
 * `PropDrawOnlyType31` (`FUN_0046A1C0`) and `PropDrawOnlyType33`
 * (`FUN_00472950`) both draw `(s16)obj+0x28C + (s32)obj+0x2A0` and step that
 * cursor one frame at a time -- 31 wrapping at `obj+0x2A4`, 33 killing itself
 * there -- and `PlaceGenericProp`'s arms at `0x0046205E` and `0x004620BE` give
 * `obj+0x2A4` the placer's `+0x6C`, the descriptor's third orientation word.
 * So the strip is `slot .. slot + roll` inclusive: 39 frames of `eff_1.bin`
 * for stage 1's, 10 and 30 of `eff_taki.bin` for stages 3 and 4, and 60 of
 * `eff_shop.bin` for stage 2's one type-33 spawn.
 *
 * **Neither cursor step is in the decompilation.** `MatrixStackPop` is marked
 * no-return, so Ghidra ends both function bodies at that `CALL` and shows a
 * bare draw with nothing advancing `obj+0x2A0` (`L37`). Carrying only the base
 * slot would have been the van's bug again, one frame deep: the prop draws for
 * one tick and then asks for a model that is not in the bundle.
 */
export const GENERIC_SLOT_STRIP = [31, 33];

/**
 * The literal slots each read routine passes to `AssetDrawSlot`, in the order
 * it draws them. Cited by the routine that draws each one.
 */
export const GENERIC_STATIC_SLOTS: Record<number, number[]> = {
  6: [0x1032],                        // ctor arm; FUN_004668A0 animates from it
  8: [0x1a36],                        // FUN_00467080, `0x1A36 - obj+0x290`
  10: [0x10c4],                       // ctor arm; FUN_004668A0
  11: [0x01cf, 0x01d0],               // FUN_00467C80, `0x1CF + (frame & 1)`
  13: [0x1a4a, 0x1a49, 0x1a43],       // FUN_00467F50
  14: [0x10d2],                       // FUN_00468180
  19: [0x01ce, 0x10d3],               // FUN_00468F00, body plus the ctor arm
  20: [0x01e2],                       // FUN_00469380
  21: Array.from({ length: 10 }, (_, i) => 0x132f + i),  // FUN_004694A0
  27: [0x17a9],                       // FUN_00469E60
  30: [0x01df],                       // FUN_0046A0F0
  32: [0x197a, 0x197b, 0x1981],       // LiftUpdate -- car, cage leaf, panel
  35: [0x1812, 0x1813],               // FUN_0046B320
  49: [0x01d2, 0x10d0],               // FUN_0046E6E0, body plus its shadow
  56: [0x10d3],                       // ctor arm 0x38
  58: [0x01d1],                       // FUN_0046F580
  60: [0x01d8],                       // FUN_0046F840
  64: [0x1a39, 0x0c27],               // FUN_0046FBE0
  77: [0x10ab],                       // FUN_004717A0, Original Mode only
};

/** Types whose routine draws only an effect, never a static model. */
export const GENERIC_NO_MODEL = [18, 25, 28];

/**
 * Stage number -> the index in the BGM tables of that stage's own track.
 *
 * The event script never plays these: every `bgm_entry_play` in the six stage
 * scripts names a *boss* or *transition* track, so the opening track is
 * started outside the event system by a path that has not been traced.
 */
export const STAGE_BGM_INDEX: Record<number, number> =
  { 1: 1, 2: 0, 3: 17, 4: 16, 5: 18, 6: 19 };

/**
 * The BGM mapping a stage needs: ids to filenames, plus its own track.
 *
 * Both tables travel, because which one the game picks depends on runtime
 * state: `PlaySoundId` takes the plain names when `DAT_009C8E98 == 6 &&
 * g_GameMode == 0` and the `_AR` names otherwise. That `0` is **Arcade** --
 * it used to be read as a mode no stage is entered in, on an enumeration
 * where `ARCADE` was 2, and the plain table was therefore declared
 * unreachable. It is the ordinary Arcade case, and the `_AR` mix is what
 * Original, Training and Boss get. The client decides, from `game_mode`; this
 * function no longer states the answer a second time.
 */
export function bgmJson(tables: ExeTables, stageNumber: number | null,
                        gameMode: number): Record<string, unknown> {
  const names = tables.bgmNames();
  const idx = STAGE_BGM_INDEX[stageNumber ?? -1];
  return {
    names,
    stage_track: idx === undefined ? null : {
      index: idx,
      id: (0x10000000 | idx) >>> 0,
      ar: names.ar[idx],
      plain: idx < names.plain.length ? names.plain[idx] : null,
      note: "the stage's own track, named by convention rather than by the "
        + "script -- no bgm_entry_play in any stage script starts it",
    },
    game_mode: gameMode,
  };
}

/**
 * The SE and voice name tables, for the ids `se_play` can carry.
 *
 * `se_play` (0x38) is not restricted to SE: its operand goes through
 * `PlaySoundId`, which dispatches on the top nibble, and the shipped scripts
 * use all three namespaces through it -- 9 BGM ids, 6 voice ids and one stop
 * control across the six stages.
 */
export function soundJson(tables: ExeTables): Record<string, unknown> {
  const byKey = <T>(m: Map<number, T>): Record<string, T> => {
    const out: Record<string, T> = {};
    for (const k of [...m.keys()].sort((a, b) => a - b)) out[String(k)] = m.get(k)!;
    return out;
  };
  const messages: Record<string, unknown> = {};
  for (const m of tables.screenMessages()) {
    messages[String(m.group)] = m.variants;
  }
  return {
    se: byKey(tables.seNames()),
    voice: byKey(tables.voiceNames()),
    // The looping-SE pairs. Without them a player cannot tell a chainsaw from
    // a footstep -- `PlaySoundId` decides loop-versus-one-shot from these two
    // tables and from nothing else, and the `_OFF` id is a *stop*, not a
    // sound. Deciding it from the `_OFF` suffix instead would be a claim about
    // the data that the tables already answer.
    looping: tables.loopingSe(),
    // evt 0x2D's message groups. The sprite is an asset id the player has no
    // 2D pipeline for, but the voice is an ordinary sound id and the frame
    // count and screen position are exact.
    messages,
    screen: { width: 640, height: 480,
              note: "message x/y are pixels in the game's 640x480 screen space" },
  };
}

/**
 * The rain particle asset, from `FUN_004136A0`'s `AssetDrawSlotAlpha(0x53,
 * 0.5)`. No region draws it and no script opcode loads it, so it has to be
 * pulled in explicitly or the effect has no model.
 */
export const RAIN_SLOT = 0x53;

/**
 * evt `0x1D`'s rain, transcribed from `FUN_004136A0`.
 *
 * Every constant here is read, not chosen: 50 particles, `y -= 2.0` a frame,
 * respawn below -7 with the three `rand() %` ranges spelled out, then
 * `world = RotY(camera_yaw) * (x, y, z) + camera_eye`.
 */
export function rainJson(tables: ExeTables,
                         prog: Program): Record<string, unknown> {
  let used = 0;
  for (const b of prog.liveBlocks()) {
    for (const st of b.steps) {
      for (const op of st.ops) {
        if (op.opcode === 0x1d && op.detail.value) used += 1;
      }
    }
  }
  const rec = tables.assetSlots().get(RAIN_SLOT);
  return {
    slot: RAIN_SLOT,
    file: rec ? rec[0] : null,
    entry: rec ? rec[1] : null,
    count: 50,
    fall_per_frame: 2.0,
    respawn_below: -7.0,
    // (modulo, offset) exactly as the routine spells them.
    spawn: { x: [0x14, -10.0], y: [0x32, -25.0], z: [0x19, -35.0] },
    scale: [1.5, 3.5, 1.0],
    roll_bams: 0x100,
    alpha: 0.5,
    draw_layer: 0xe,
    enabled_by_script: used,
  };
}

/** The class-0x41 types `PlaceGenericProp` builds, from the dispatch table. */
function genericTypes(tables: ExeTables): Set<number> {
  const ctor = 0x00461cf0;
  const out = new Set<number>();
  for (const r of tables.class41Dispatch()) {
    if (r.ctor === ctor) out.add(r.type);
  }
  return out;
}

/**
 * Every container spawn a stage places, decoded to what the port needs.
 *
 * Three families, three different descriptors, one list -- because they all
 * decrement the same `g_item_set_countdown` and the port has to place them all
 * before any of the countdowns mean anything.
 */
export function containerPlacements(tables: ExeTables, evt: evtlib.EvtFile,
                                    spawnRecords: Spawn[]):
    Record<string, unknown>[] {
  const raw = evt.raw;
  const out: Record<string, unknown>[] = [];
  const generic = genericTypes(tables);
  const s8 = (o: number) => (raw[o] << 24) >> 24;
  for (const rec of spawnRecords) {
    if (rec.cls !== 0x41 && rec.cls !== 0x44) continue;
    if (rec.offset + 0x30 > raw.length) continue;
    if (rec.cls === 0x41) {
      const ctor = s8(rec.offset + 0x25);
      if (ctor === 0) {
        out.push({
          at: rec.offset, container: "group", group: rec.hp,
          lifetime_evt_steps: s8(rec.offset + 0x24),
        });
      } else if (ctor === 34) {
        // `PlaceGenericProp` case 0x22 builds a falling container: `+0x11C` is
        // the lifetime and the slot is forced to 0xA50, so this is the same
        // object class 0x44 selector 16 places.
        out.push({
          at: rec.offset, container: "falling", kind: 0,
          item_set: s8(rec.offset + 0x24),
          story_item: -1,
          set_size: rec.orient[0],
          lifetime_evt_steps: rec.hp & 0xff,
          pos: [...rec.pos], yaw: rec.orient[1],
        });
      } else if (generic.has(ctor)) {
        // Everything else `PlaceGenericProp` builds. The prologue writes
        // `+0x11C` to **both** `obj+0x11C` and `obj+0x28C`, so by default it
        // is the lifetime in event steps *and* the asset slot -- and only the
        // types in `GENERIC_DESCRIPTOR_SLOT` ever draw the slot.
        //
        // `field_1f4` is the OTHER number: the s8 at `desc+0x24`, which
        // `FUN_004088A0` widens into `obj+0x1F4`. Four of the switch's arms --
        // types 12, 31, 51 and 53 -- then copy it over `obj+0x11C`, so for
        // those the two meanings do not share a word at all and the lifetime
        // is this byte. See `GENERIC_LIFETIME_FROM_1F4` in
        // `game/class41/generic.ts`; the port applies the switch, this only
        // carries what the descriptor holds.
        out.push({
          at: rec.offset, container: "generic",
          type: ctor, slot: rec.hp,
          lifetime_evt_steps: rec.hp,
          field_1f4: s8(rec.offset + 0x24),
          pos: [...rec.pos],
          pitch: rec.orient[0], yaw: rec.orient[1], roll: rec.orient[2],
        });
      } else if (ctor === 24) {
        // `PlaceChainSegments` -- twenty segments, each carrying the placer's
        // `+0x1F4` as a chain group. Group 1 is a **route-branch trigger**.
        out.push({
          at: rec.offset, container: "chain",
          // `obj+0x1F4`, which for a class-0x41 placer is the **s8 at
          // desc+0x24** -- the same byte that is the lifetime for a group.
          // `+0x25` beside it is the constructor type, so a 16-bit read here
          // returns both and is wrong.
          chain_group: s8(rec.offset + 0x24),
          lifetime_evt_steps: rec.hp,
          pos: [...rec.pos], yaw: rec.orient[1],
        });
      } else if (ctor === 40) {
        // `PlaceFragmentProps` -- a row of shootable objects that burst into
        // fragments, all carrying the placer's `+0x1F4` as a sub-kind.
        // **Sub-kind 9 is a route-branch trigger.**
        out.push({
          at: rec.offset, container: "fragment",
          sub_kind: s8(rec.offset + 0x24),
          lifetime_evt_steps: rec.hp,
          pos: [...rec.pos], yaw: rec.orient[1],
        });
      } else if (ctor === 4) {
        out.push({
          at: rec.offset, container: "kinded",
          kind: rec.orient[2],
          item_set: s8(rec.offset + 0x24),
          set_size: rec.orient[0],
          // `+0x11C` is the lifetime for this class, not hit points.
          lifetime_evt_steps: rec.hp,
          pos: [...rec.pos], yaw: rec.orient[1],
        });
      }
    } else if (rec.hp === 17) {              // class 0x44 selector 17
      // `PlaceStoryModeSwitch` -- the branch writer with the widest reach.
      // `obj+0x11C` is written as the LITERAL 1 by the constructor, so it is
      // not a lifetime here; `+0x2A4` names the script flag that removes it.
      out.push({
        at: rec.offset, container: "story_switch",
        slot: rec.param(0x04, "i16") || 0,
        // The script flag the route waits on, and the one that removes the
        // object. Both signed bytes, and -1 means "none".
        // The descriptor's `+0x08`, which decides how the switch is shot:
        // -1 is the sphere path (radius 8, centre never written, so it answers
        // any shot on screen) and anything else is the mesh volume, which the
        // port has not got. See `game/class41/shot_test.ts`.
        volume: rec.param(0x08, "i32"),
        branch_flag: rec.param(0x10, "i8"),
        remove_flag: rec.param(0x11, "i8"),
        // The four Original Mode item ids that throw the switch without a
        // shot. -1 in the first means the switch has no key at all.
        keys: [0, 1, 2, 3].map((k) => rec.param(0x20 + k, "i8")),
        lifetime_evt_steps: 1,
        pos: [...rec.pos], yaw: rec.orient[1],
      });
    } else if (rec.hp === 11) {              // class 0x44 selector 11
      // `PropBuildRisingDoor` -- a door that slides straight up on a script
      // flag. Everything the object holds is in the parameter tail: the u16 at
      // `+0x04` is the asset slot `RisingDoorUpdate` draws, and the two signed
      // bytes at `+0x20`/`+0x21` are the flag that starts the rise and the
      // flag that deletes it. `lifetime_evt_steps` is 0 because there is no
      // `PropExpireByStepLifetime` in the routine at all -- the remove flag is
      // its whole lifetime, and a lifetime of 0 would otherwise retire it at
      // the first step boundary.
      //
      // The rise itself is not carried: it is `speed += step; y += speed` from
      // a literal, with the two literals picked by comparing the slot against
      // 0xA58, so the port computes it the way the engine does rather than
      // reading a baked curve. See `game/class44/rising_door.ts`.
      out.push({
        at: rec.offset, container: "rising_door",
        slot: rec.param(0x04, "u16") || 0,
        open_flag: rec.param(0x20, "i8") ?? 0,
        remove_flag: rec.param(0x21, "i8") ?? -1,
        lifetime_evt_steps: 0,
        pos: [...rec.pos], yaw: rec.orient[1],
      });
    } else if (rec.hp === 16) {              // class 0x44 selector 16
      const tail = rec.offset + 0x24;
      out.push({
        at: rec.offset, container: "falling",
        kind: rec.orient[2],
        item_set: s8(tail + 4),
        story_item: i32(raw, tail + 8),
        set_size: rec.orient[0],
        lifetime_evt_steps: s8(tail),
        pos: [...rec.pos], yaw: rec.orient[1],
      });
    } else if (rec.hp === 0) {               // class 0x44 selector 0
      // `PropBuildScriptFlagEffect` -- the only selector that draws an
      // animated **effect** rather than a model at a pose. The dword at
      // `tail+0x04` picks the pair (`CMP ECX,0x13F5` at 0x00472B6C): the
      // matching half is effect 2 captured at bone 2, the other effect 3 at
      // bone 1. `obj+0x328` is the literal motion 471 either way, and the
      // spawn's own position is never copied to `obj+0x19C` -- the motion
      // carries world coordinates, which is why `pos` is carried only so the
      // placement can be recognised beside the descriptor.
      const a = (rec.param(0x04, "u32") ?? 0) === propslib.SCRIPT_FLAG_EFFECT_SLOT_A;
      const pick = a ? propslib.SCRIPT_FLAG_EFFECT_A
                     : propslib.SCRIPT_FLAG_EFFECT_B;
      out.push({
        at: rec.offset, container: "script_flag_effect",
        effect: pick.effect,
        capture_bone: pick.captureBone,
        motion: propslib.SCRIPT_FLAG_EFFECT_MOTION,
        // `obj+0x28C`, which this family never draws through: the routine
        // reads its own node slots out of the tree instead.
        slot: rec.param(0x04, "u16") ?? 0,
        // `ScriptFlagEffectUpdate` has no `PropExpireByStepLifetime`; script
        // flag 0x13 is its whole lifetime.
        lifetime_evt_steps: 0,
        pos: [...rec.pos], yaw: rec.orient[1],
      });
    }
  }
  return out;
}

/**
 * Class 0x24's parameter tail, per spawn.
 *
 * `SetPiecePropInit` reads everything a set-piece does out of the tail at
 * `desc+0x24`, and the six state routines read nothing else. Keyed by the
 * spawn's script address, which is the identity every layer agrees on.
 *
 * `obj+0x11C` is carried as `phase` and is **not** hit points: `-1` means the
 * Init draws a random start frame for the clip, which is how a row of
 * identical set-pieces avoids animating in lockstep.
 */
export function setPiecesJson(evt: evtlib.EvtFile,
                              spawnRecords: Spawn[]): Record<string, unknown> {
  const raw = evt.raw;
  const out: Record<string, unknown> = {};
  for (const rec of spawnRecords) {
    if (rec.cls !== 0x24) continue;
    const t = rec.offset + 0x24;
    if (t + 0x16 > raw.length) continue;
    const s16 = (o: number) => i16(raw, t + o);
    out[String(rec.offset)] = {
      selector: (raw[t + 0x05] << 24) >> 24,
      removePath: s16(0x06),
      removeFrame: s16(0x08),
      motion: s16(0x0a),
      hold: s16(0x0c),
      cuePath: s16(0x0e),
      cueFrame: s16(0x10),
      cue2Path: s16(0x12),
      cue2Frame: s16(0x14),
      phase: rec.hp,
    };
  }
  return out;
}

/**
 * Class 0x25's bytecode, decoded.
 *
 * `ScriptedHumanoidInit` reads a pointer out of the tail at `+0x0C` to a
 * **command block**, installs `ScriptedHumanoidUpdate` and never runs again.
 * The commands are emitted as a flat list with jumps resolved to an **index**
 * into it, because the engine's `op 15` carries an absolute pointer into the
 * loaded evt and an index is the same edge without the address.
 */
export function scriptedHumanoidsJson(evt: evtlib.EvtFile,
                                      spawnRecords: Spawn[]):
    Record<string, unknown> {
  const raw = evt.raw;
  const out: Record<string, unknown> = {};
  for (const rec of spawnRecords) {
    if (rec.cls !== 0x25) continue;
    const tail = rec.offset + 0x24;
    const blk = charmotion.humanoidBlockOffset(evt, rec);
    if (blk === null) continue;

    // The walk lives in `charmotion` because `characters` needs the same one
    // to bake the clips `op 2` and `op 3` name.
    const order = charmotion.humanoidCommandOffsets(evt, rec);
    const index = new Map<number, number>();
    order.forEach((off, i) => index.set(off, i));

    const cmds: Record<string, unknown>[] = [];
    for (const off of order) {
      const op = i16(raw, off);
      const mode = i16(raw, off + 2);
      const c: Record<string, unknown> = {
        op, mode, a: i16(raw, off + 4), b: i16(raw, off + 6),
      };
      if (charmotion.humanoidCmdLen(op, mode) === 16) {
        c.f0 = f32(raw, off + 8);
        c.f1 = f32(raw, off + 12);
      }
      if (op === 15) {
        const t = evt.toOffset(u32(raw, off + 4));
        c.next = t !== null ? (index.get(t) ?? -1) : -1;
      }
      // `op 10`'s other edge. The engine finds it by scanning forward for the
      // `-2` marker every time the test fails; an index is the same edge
      // without the scan, for the same reason `op 15`'s pointer becomes one.
      if (op === 10 && (mode === 0 || mode === 1 || mode === 2)) {
        const t = charmotion.humanoidSkipTarget(raw, off);
        c.skip = t !== null ? (index.get(t) ?? -1) : -1;
      }
      cmds.push(c);
    }

    out[String(rec.offset)] = {
      charType: (raw[tail] << 24) >> 24,
      removePath: i16(raw, tail + 2),
      removeFrame: i16(raw, tail + 4),
      // `ScriptedHumanoidDraw` (`FUN_00484FF0`) opens
      // `switch (*(int16*)(obj+0x1390 + 6))`, and `obj+0x1390` is
      // `desc + 0x24` -- so this word is `desc + 0x2A`. It picks a decoration
      // the actor draws beside its skeleton: 1 and 2 are fixed props at
      // hardcoded points, 3 rides the `op_` path in `obj+0x135C`, 4 draws
      // only while `g_active_cam_path == 0x93`. Zero draws nothing, which is
      // 129 of the six stages' 137 spawns; 1 and 2 are stage 2's, 3 and 4
      // stage 3's.
      drawVariant: i16(raw, tail + 6),
      flags2: i16(raw, blk + 2),
      motion: i16(raw, blk + 4),
      phase: i16(raw, blk + 6),
      cmds,
    };
  }
  return out;
}

/**
 * The class-0x41 breakable-prop tables the port needs to place a group.
 *
 * Spawn class 0x41 is a placer: `PropContainerPlacerUpdate` dispatches
 * `obj+0x130C` through 79 constructors and then kills itself. Type 0 is
 * `PlaceBreakableGroup`, which reads its members out of the **exe**, not the
 * evt -- so the port cannot place them from the spawn descriptor alone.
 *
 * All nine groups are emitted, indexed by group id, because the placer picks
 * one by `obj+0x11C` at run time. Forty-two records is nothing next to the
 * geometry.
 */
export function breakablesJson(tables: ExeTables,
                               placements: Record<string, unknown>[],
                               effects: Record<string, unknown> = {}):
    Record<string, unknown> {
  return {
    groups: tables.breakableGroups(),
    hull: tables.breakableHullPoints().map((p) => [...p]),
    falling_hull: tables.fallingHullPoints().map((p) => [...p]),
    kinds: tables.propKindParams(),
    placements,
    effects,
    level_height: 7.540296,
  };
}

/**
 * The effect trees and baked motions class 0x44 selector 0 draws through.
 *
 * One record per effect id the stage's selector-0 spawns name, and nothing at
 * all for a stage that has none -- which is every stage but 1.
 *
 * **The tree is the index source and the motion is read against it.**
 * `g_effect_bone_counts[effect]` is the node count *including* the root, and
 * both `EffectFrameTranslations` and `EffectFrameRotations` derive the stride
 * from it, so a motion baked at the character stride would be a third of a
 * frame out per frame. `effectFrames` is the only decoder that may read one.
 *
 * The cue list rides along because `ScriptFlagEffectUpdate` picks it by the
 * same effect id -- `g_script_flag_effect_cues_a` for effect 2 and
 * `g_script_flag_effect_cues_b` for anything else -- and a consumer that has
 * the effect has the branch.
 */
export async function scriptFlagEffectsJson(
    stage: Stage, placements: Record<string, unknown>[]):
    Promise<Record<string, unknown>> {
  const tables = stage.tables;
  const out: Record<string, unknown> = {};
  const banks = tables.motionBanks();
  for (const pl of placements) {
    if (pl.container !== "script_flag_effect") continue;
    const effect = pl.effect as number;
    const motion = pl.motion as number;
    if (out[String(effect)] !== undefined) continue;
    const nodes = propslib.effectTree(tables, effect);
    const declared = tables.ru16(propslib.EFFECT_BONE_COUNTS + effect * 2) ?? 0;
    // `spawns.md` proves the two agree on the four effects it lists; a stage
    // that disagreed would be a tree read at the wrong struct, and baking the
    // motion at the wrong stride afterwards would hide it in float noise.
    if (!nodes.length || nodes.length !== declared) {
      degraded.note("hod2lib.bundle.script_flag_effects",
                    `effect ${effect} tree`,
                    "the effect is not exported and nothing draws it",
                    `${nodes.length} nodes against g_effect_bone_counts `
                    + `${declared}`);
      continue;
    }
    const bankId = tables.motionBankOf(motion);
    const bank = bankId !== null && banks.has(bankId)
      ? await loadBank(stage.source, banks.get(bankId)![0],
                       banks.get(bankId)![1])
      : null;
    const frames = bank ? bank.effectFrames(motion, declared) : [];
    if (!frames.length) {
      degraded.note("hod2lib.bundle.script_flag_effects",
                    `effect ${effect} motion ${motion}`,
                    "the effect is exported without a pose and holds frame 0",
                    "no frames decoded");
    }
    const t: number[] = [];
    const r: number[] = [];
    for (const f of frames) {
      for (const v of f.t) t.push(v[0], v[1], v[2]);
      for (const v of f.r) r.push(v[0], v[1], v[2]);
    }
    out[String(effect)] = {
      nodes: nodes.map((n) => ({ slot: n.slot, bone: n.bone,
                                 children: [...n.children] })),
      interp: tables.data[tables.v2r(propslib.EFFECT_INTERP_MODE + effect) ?? 0],
      motion,
      // The clock `ScriptFlagEffectUpdate` stops two short of, in play frames.
      play_length: tables.motionPlayLength(motion) ?? 0,
      frames: frames.length,
      bones: declared - 1,
      t, r,
      cues: propslib.effectSoundCues(
        tables, effect === propslib.SCRIPT_FLAG_EFFECT_A.effect
          ? propslib.SCRIPT_FLAG_EFFECT_CUES_A
          : propslib.SCRIPT_FLAG_EFFECT_CUES_B),
    };
  }
  return out;
}

/**
 * The asset slots an **actor** class draws, by spawn class.
 *
 * Class 0x52's ten are `mouse.bin` entries 0..9 -- `MouseInit` seeds
 * `sub+0x24` and `sub+0x22` with the first and last, and every arm of the
 * class steps between them. They are here rather than in
 * {@link BREAKABLE_SLOTS} because the object that draws them is an `Actor`
 * and not a `BreakableProp`: it is registered for the shot test by
 * `RegisterForShotTest` with a radius at `obj+0x124`, not by a bounding box.
 */
export const ACTOR_SLOTS: Record<number, number[]> = {
  // `fish.bin` 3..22 -- the twenty-frame swim strip class 0x51 flips through
  // -- then entries 0, 1 and 2: the flung corpse, the sunk one, and the ripple
  // `SpawnWaterRipple` (`FUN_00439FA0`) draws.
  0x51: [...Array.from({ length: 20 }, (_, i) => 0x1156 + i), 0xb6f, 0xb70,
         0xb71],
  // `owl.bin` 0..105. `OwlDrawBodyChain` (`FUN_00447C20`) draws sixteen of
  // them in one hand-built matrix chain; the whole run travels because the
  // renderer will need the rest of the chain, and entries 34..50, 54, 58 and
  // 90 are drawn by nothing in the image at all.
  0x43: Array.from({ length: 106 }, (_, i) => 0xbbd + i),
  0x52: Array.from({ length: 10 }, (_, i) => 0x1385 + i),
};

/**
 * The extra asset slots a stage's class-0x25 **descriptors** ask for.
 *
 * Not in {@link ACTOR_SLOTS}, because this is not a property of the class:
 * 129 of the 137 class-0x25 spawns are variant 0 and draw nothing beside
 * their skeleton, so keying it on the class would put the model in all six
 * bundles to be used by one.
 *
 * Variants 1, 2 and 4 draw at points the routine hardcodes, so the rig writer
 * already exports them as fixed parts of `obj_484ff0_props`. Variant 3 takes
 * its path slot from `obj+0x135C` at run time, which no static placement can
 * express -- so its model has to travel as a bare slot the client places for
 * itself. See {@link HUMANOID_VARIANT3_SLOT} for what it is and is not known
 * to be.
 */
export function humanoidDrawSlots(
    humanoids: Record<string, unknown>): number[] {
  for (const h of Object.values(humanoids)) {
    if ((h as { drawVariant?: number }).drawVariant
        === HumanoidDrawVariant.OnObjectPath) {
      return [HUMANOID_VARIANT3_SLOT];
    }
  }
  return [];
}

/**
 * A hidden rig holding the models an **actor** class draws by asset slot.
 *
 * The counterpart of {@link breakableSlotEntry}, for the classes whose draw is
 * `AssetDrawSlot` rather than a skeleton. Those spawns cannot go through the
 * character path at all -- `spawnres` has no character-type rule for them
 * because they have no character type -- so without this the client has no
 * geometry, cannot draw them, and `ShotTestSphere` has nothing to hit. Class
 * 0x52's route-branch trigger was ported and unreachable for exactly that
 * reason.
 */
export async function actorSlotEntry(
    stage: Stage, spawnClasses: readonly number[],
    extra: readonly number[], cache: AssetCache):
    Promise<RigInstance | null> {
  const want: number[] = [];
  for (const cls of spawnClasses) {
    for (const slot of ACTOR_SLOTS[cls] ?? []) {
      if (!want.includes(slot)) want.push(slot);
    }
  }
  // Slots a *descriptor* asks for rather than a class -- see
  // {@link humanoidDrawSlots}.
  for (const slot of extra) if (!want.includes(slot)) want.push(slot);
  if (!want.length) return null;
  const slots = stage.tables.assetSlots();
  const parts: RigInstance["parts"] = [];
  for (const slot of want) {
    const rec = slots.get(slot);
    if (!rec) continue;
    const stem = rec[0].endsWith(".bin") ? rec[0].slice(0, -4) : rec[0];
    const [models, bank] = await cache.get(
      "hod2lib.bundle.actor_slot_entry", stem, "actor slot asset",
      `slot 0x${slot.toString(16).padStart(4, "0")} draws nothing`);
    if (rec[1] >= models.length) continue;
    const part = {
      name: `slot_${slot.toString(16).padStart(4, "0")}`,
      slots: [slot],
      note: `actor draw slot 0x${slot.toString(16).padStart(4, "0")}`,
    };
    parts.push([part, [[models[rec[1]], bank, stem]]]);
  }
  if (!parts.length) return null;
  const rig: Rig = {
    name: "slots_actor",
    routine: "asset-slot actor draws (classes 0x43, 0x51, 0x52; class 0x25 variant 3)",
    worldSpace: false,
    parts: parts.map(([p]) => p),
    note: "actor models drawn by asset slot; hidden, cloned per live actor",
  };
  return {
    rig, routes: [], anchors: {}, biases: {}, world: false, placements: [],
    blocked: "",
    fixed: [{ kind: "fixed", translation: [0.0, 0.0, 0.0],
              rotation_bams: [0, 0, 0], cam_paths: [], note: rig.note! }],
    parts,
  };
}

/**
 * The asset slots the **shot effects** flip through.
 *
 * Every one of these is a separate model in `pol/common.bin`: the game has no
 * texture animation, so a twenty-five-frame blood spray is twenty-five models
 * and `AssetDrawSlot(0x3A + cel)` steps through them. Without them in the
 * bundle the player had a canvas gradient standing in for all of it and no
 * muzzle flash or tracer at all.
 *
 * What is here is exactly what a **bullet** can produce:
 *
 * * `SpawnBloodSpray` (`FUN_00407310`) and `SpawnBoneHitSprite`
 *   (`FUN_00407200`), 0x3A..0x52;
 * * the muzzle flash and its second draw, `g_muzzle_flash_slots` and
 *   `g_muzzle_smoke_slots` for both players — nine each, and the tracer is
 *   entry +2 of the second run;
 * * the five collision materials `SpawnWorldImpact` (`FUN_00405260`) and
 *   `ActorShotFeedback` (`FUN_00454050`) can name, which are also the ranges
 *   `SpawnPropHitSpark` (`FUN_00465860`) draws from.
 *
 * What is **not** here, deliberately: the boss and set-piece kinds of
 * `SpawnSpriteEffectFromParams`' switch — 0x41, 0x44, 0x45, 0x50, 0x53, 0x5A,
 * 0x5B, 0x5C, 0x5D, 0x61 — which live in `water_hamon`, `eff_dokan`,
 * `eff_shop`, `eff_2`, `eff_org5b` and `boss1q`, and which nothing on the shot
 * path can reach. Kind 0x51 is the one exception a shot could reach — a
 * ricochet off character type 3 — and it is in `eff_2.bin`; it is carried, and
 * a bundle whose stage does not ship that file simply has no models for it.
 */
export const EFFECT_SLOT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x003a, 0x0052],    // blood, 25 frames
  [0x0175, 0x017d],    // muzzle flash, player 0
  [0x017f, 0x0187],    // muzzle flash, player 1
  [0x0b76, 0x0b7e],    // the flash's second draw, player 0; +2 is the tracer
  [0x0b84, 0x0b8c],    // ...and player 1
  [0x091a, 0x092f],    // kind 1, sand
  [0x0dc3, 0x0dd1],    // kind 2, metal -- and the bursting head
  [0x0e25, 0x0e33],    // kind 3, other -- the catch-all ricochet
  [0x08f8, 0x0903],    // kind 5, water
  [0x0904, 0x0919],    // kind 6, wood -- and the prop spark, from 0x905
  [0x0054, 0x0062],    // kind 0x51, the type-3 ricochet
];

/**
 * A hidden rig holding the models the shot effects flip through.
 *
 * Same shape and same reason as {@link actorSlotEntry}: one part per asset
 * slot, hidden, cloned by the client. `render/effects.ts` is what clones them.
 */
export async function effectSlotEntry(
    stage: Stage, cache: AssetCache): Promise<RigInstance | null> {
  const want: number[] = [];
  for (const [lo, hi] of EFFECT_SLOT_RANGES) {
    for (let slot = lo; slot <= hi; slot++) {
      if (!want.includes(slot)) want.push(slot);
    }
  }
  const slots = stage.tables.assetSlots();
  const parts: RigInstance["parts"] = [];
  for (const slot of want) {
    const rec = slots.get(slot);
    if (!rec) continue;
    const stem = rec[0].endsWith(".bin") ? rec[0].slice(0, -4) : rec[0];
    const [models, bank] = await cache.get(
      "hod2lib.bundle.effect_slot_entry", stem, "shot effect asset",
      `slot 0x${slot.toString(16).padStart(4, "0")} draws nothing`);
    if (rec[1] >= models.length) continue;
    const part = {
      name: `slot_${slot.toString(16).padStart(4, "0")}`,
      slots: [slot],
      note: `shot effect, slot 0x${slot.toString(16).padStart(4, "0")}`,
    };
    parts.push([part, [[models[rec[1]], bank, stem]]]);
  }
  if (!parts.length) return null;
  const rig: Rig = {
    name: "slots_effect",
    routine: "the shot effects: blood, muzzle flash, tracer, impacts",
    worldSpace: false,
    parts: parts.map(([p]) => p),
    note: "one model per animation frame; hidden, cloned per live effect",
  };
  return {
    rig, routes: [], anchors: {}, biases: {}, world: false, placements: [],
    blocked: "",
    fixed: [{ kind: "fixed", translation: [0.0, 0.0, 0.0],
              rotation_bams: [0, 0, 0], cam_paths: [], note: rig.note! }],
    parts,
  };
}

/**
 * A hidden rig holding the breakable props' models, for the client to clone.
 *
 * Class 0x41's props are built at run time by `PlaceBreakableGroup`, not
 * placed by the exporter, so there is no node per prop to emit -- the client
 * makes one per live prop and needs a template to copy. Same shape as the gore
 * rig: one part per asset slot, hidden, cloned by slot.
 */
export async function breakableSlotEntry(
    stage: Stage, placements: Record<string, unknown>[],
    effects: Record<string, unknown>,
    cache: AssetCache): Promise<RigInstance | null> {
  const slots = stage.tables.assetSlots();
  const parts: RigInstance["parts"] = [];
  // The three container families draw from a fixed set; the generic props each
  // name their own slot in the spawn descriptor, so those come from the
  // stage's own placements and differ per stage.
  const want = [...BREAKABLE_SLOTS];
  for (const pl of placements) {
    if (pl.container !== "generic") continue;
    // The literals this type's routine draws, always; plus the descriptor slot
    // -- or the whole strip -- for the seven types that read `obj+0x28C`. A
    // type that is only ever handed a lifetime contributes nothing, which is
    // what stops `+0x11C == 2` being exported as `char_adv03.bin`.
    for (const slot of GENERIC_STATIC_SLOTS[pl.type as number] ?? []) {
      if (!want.includes(slot)) want.push(slot);
    }
    if (GENERIC_DESCRIPTOR_SLOT.includes(pl.type as number)) {
      // A strip type needs every frame of its strip, not just the base.
      const span = GENERIC_SLOT_STRIP.includes(pl.type as number)
        ? Math.max(0, (pl.roll as number) ?? 0) : 0;
      for (let i = 0; i <= span; i++) {
        const slot = (pl.slot as number) + i;
        if (!want.includes(slot)) want.push(slot);
      }
    }
  }
  // Class 0x44 selector 11 draws its descriptor's slot and nothing else, so
  // the slot travels the same way the three descriptor-slot generic types' do.
  // Without this the prop is placed, `DrawSlotFor` asks for `0xA58`, and the
  // renderer has nothing to clone -- which is exactly how stage 3's roller
  // shutter came to be missing from a level that placed it.
  for (const pl of placements) {
    if (pl.container !== "rising_door") continue;
    const slot = pl.slot as number;
    if (slot && !want.includes(slot)) want.push(slot);
  }
  // Class 0x44 selector 0 draws an effect tree, so the slots it needs are the
  // tree's nodes and **not** the descriptor's `obj+0x28C`, which that family
  // never passes to `AssetDrawSlot`. A node with slot 0 is a pure transform.
  for (const def of Object.values(effects)) {
    for (const n of (def as { nodes: { slot: number }[] }).nodes) {
      if (n.slot && !want.includes(n.slot)) want.push(n.slot);
    }
  }
  for (const slot of want) {
    const rec = slots.get(slot);
    if (!rec) continue;
    const stem = rec[0].endsWith(".bin") ? rec[0].slice(0, -4) : rec[0];
    const [models, bank] = await cache.get(
      "hod2lib.bundle.breakable_slot_entry", stem, "breakable prop asset",
      `slot 0x${slot.toString(16).padStart(4, "0")} draws nothing`);
    if (rec[1] >= models.length) continue;
    const part = {
      name: `slot_${slot.toString(16).padStart(4, "0")}`,
      slots: [slot],
      note: `breakable prop, slot 0x${slot.toString(16).padStart(4, "0")}`,
    };
    parts.push([part, [[models[rec[1]], bank, stem]]]);
  }
  if (!parts.length) return null;
  const rig: Rig = {
    name: "slots_breakable",
    routine: "class 0x41 (BreakablePropUpdate)",
    worldSpace: false,
    parts: parts.map(([p]) => p),
    note: "breakable prop models; hidden, cloned per live prop",
  };
  return {
    rig, routes: [], anchors: {}, biases: {}, world: false, placements: [],
    blocked: "",
    fixed: [{ kind: "fixed", translation: [0.0, 0.0, 0.0],
              rotation_bams: [0, 0, 0], cam_paths: [], note: rig.note! }],
    parts,
  };
}

/**
 * The backdrop dome presets, plus the ones this scene's script selects.
 *
 * The dome models need no special export: every preset a stage uses is already
 * pulled in, because the script loads its asset slot with opcode 0x50 and
 * `Stage.geometry()` includes those.
 */
export function backdropJson(tables: ExeTables,
                             prog: Program): Record<string, unknown> {
  const used = new Map<number, number>();
  for (const b of prog.liveBlocks()) {
    for (const st of b.steps) {
      for (const op of st.ops) {
        if (op.opcode === 0x1b) {
          const v = op.detail.value;
          if (typeof v === "number" && Number.isInteger(v)) {
            used.set(v, (used.get(v) ?? 0) + 1);
          }
        }
      }
    }
  }
  return {
    presets: tables.backdropPresets(),
    used: [...used.keys()].sort((a, b) => a - b),
    note: "evt 0x1B selects a preset, 0x1C the mode (0 off, 2 frozen, else "
      + "animating). Drawn at (camera.x, camera.y + dy, camera.z), spun about "
      + "Y by spin_bams per frame, scaled (1.2, 1.2, -1.2) -- the negative Z "
      + "turns it inside out.",
  };
}

/**
 * The rig routes, gates and animation rules the client needs.
 *
 * The **geometry** goes into the glTF as ordinary nodes; this is the part that
 * cannot: which `op_` path each instance rides, which `cp_` camera paths
 * select it, and the runtime rules the transcription records but cannot bake.
 *
 * The player evaluates the path itself rather than riding a baked animation,
 * which is why the bundle keeps the *slot* -- it can then honour the frame
 * clamp and the position bias exactly, at any frame, including while scrubbing.
 */
export function rigsJson(instances: RigInstance[], blocked: Rig[],
                         campaths: CamPaths,
                         tables: ExeTables): Record<string, unknown> {
  const out: Record<string, unknown>[] = [];
  for (const inst of instances) {
    const rig = inst.rig;
    const routes = inst.routes.map((r) => {
      const ref = campaths.get(r.slot);
      return {
        slot: r.slot,
        bias: [...r.bias],
        // The routines clamp with the EXE's per-path play length, NOT the
        // curve's own extent -- and only at the top:
        //     n = min(current_frame, CAM_PATH_LENGTH[slot])
        // For op_ slot 334 the curve runs 40..370.2 while the table says 370,
        // so clamping to the curve's *start* would hold the object still for
        // the first 40 frames instead of letting the evaluator extrapolate
        // back along the opening segment, which is what the game does.
        length: tables.camPathLength(r.slot),
        // Set when the routine passes a literal evaluation time rather than
        // the clamped camera frame -- the object is parked at a fixed point on
        // the path, not riding it.
        hold_frame: r.hold_frame,
        // The routine's own "stop re-evaluating" test, which is not always the
        // path length: St1VehicleUpdate stops at 0x15D (349) where op 0xFE's
        // length is 350.
        stop_frame: r.stop_frame,
        // What the routine does when the path runs out.
        note: r.note ?? "",
        // Empty means ungated: the rig is present whatever the camera is
        // doing. Otherwise it rides only while one of these cp_ slots is the
        // active camera path.
        cam_paths: r.cam_paths,
        file: ref ? ref.file : null,
        index: ref ? ref.index : null,
        duration: ref ? ref.duration : null,
      };
    });
    out.push({
      name: rig.name,
      routine: rig.routine,
      note: rig.note ?? "",
      routes,
      world_space: rig.worldSpace ?? false,
      spawn_class: rig.spawnClass ?? null,
      // Rules the transcription records rather than bakes, so the client can
      // show them instead of pretending the part is static.
      animated_parts: inst.parts
        .filter(([p]) => p.animated || p.condition)
        .map(([p]) => ({ part: p.name, rule: p.animated ?? "",
                         condition: p.condition ?? "" })),
    });
  }
  return {
    rigs: out,
    blocked: blocked.map((r) => ({ name: r.name, routine: r.routine,
                                   reason: r.placementBlocked ?? "" })),
    note: "Object rigs are transcribed draw routines, not asset data -- there "
      + "is no rig format. See docs/formats/rigs.md and hod2lib/rigs.py.",
  };
}

/**
 * Class 0x10's spawns and the exe's civilian scripts.
 *
 * Unlike class 0x24 and class 0x25, whose parameters live in the evt, a
 * civilian's behaviour is a **command stream compiled into Hod2.exe**:
 * `CivilianInit` indexes the 67-entry table at `g_civilian_scripts` with the
 * spawn tail's byte at `+0x01`. So this emits two things -- the streams once,
 * and the per-spawn tail that selects one.
 */
export function civiliansJson(tables: ExeTables, evt: evtlib.EvtFile,
                              spawnRecords: Spawn[]): Record<string, unknown> {
  const raw = evt.raw;
  const spawns: Record<string, unknown> = {};
  for (const rec of spawnRecords) {
    if (rec.cls !== 0x10) continue;
    const t = rec.offset + 0x24;
    if (t + 0x10 > raw.length) continue;
    const n = i32(raw, t + 0x0c);
    const kids: Record<string, unknown>[] = [];
    for (let k = 0; k < Math.max(0, Math.min(n, 32)); k++) {
      const off = evt.toOffset(u32(raw, t + 0x10 + k * 4));
      if (off === null || off > raw.length - 0x24) continue;
      // The children are **not** script spawns: nothing in the evt's
      // instruction stream points at these descriptors, so the walker never
      // sees them and the civilian's own Init is the only thing that builds
      // them. They come out whole for that reason.
      const kid = evtlib.readSpawn(evt, off, 0x0b);
      const res = resolveSpawn(tables, kid);
      kids.push({
        at: off, class: kid.cls, charType: res.charType,
        pos: [...kid.pos], yaw: kid.orient[1], hp: kid.hp,
      });
    }
    spawns[String(rec.offset)] = {
      charType: (raw[t] << 24) >> 24,
      script: (raw[t + 1] << 24) >> 24,
      removePath: i16(raw, t + 2),
      removeFrame: i16(raw, t + 4),
      removeDelay: i16(raw, t + 6),
      children: kids,
    };
  }
  if (!Object.keys(spawns).length) return {};
  return { ...tables.civilianScripts(), spawns };
}

export interface BuildOptions {
  glb?: boolean;
  writeTextures?: boolean;
  unlit?: boolean;
  camStep?: number;
  progress?: Progress;
}

/**
 * Write one stage's directory and return its manifest entry.
 *
 * Geometry is exported with no cameras: the player draws camera rails itself,
 * from the raw curves in `<stage>.cam.json`, so it can colour them by playback
 * state and highlight the `start..end` sub-range one `queue_event` command
 * covers. A baked glTF animation can express neither.
 */
export async function buildStage(stage: Stage, sink: BundleSink,
                                 deflate: Deflate,
                                 opts: BuildOptions = {}):
    Promise<Record<string, unknown>> {
  const glb = opts.glb ?? true;
  const say = opts.progress ?? (() => {});
  // The count belongs to this stage, so it starts here rather than at the top
  // of the process. A run builds up to twelve of these and a single running
  // total would say nothing about which one came out short.
  degraded.reset();
  const name = stage.name;
  const outDir = name;
  const tables = stage.tables;
  const cache = new AssetCache(stage);

  // The reference implementation constructs a fresh `Program` five times over
  // -- once for the rain, once for the props, the rigs, the characters and the
  // breakables. They are identical by construction and each costs a full evt
  // walk, so this builds one and hands it round.
  const prog = await Program.create(stage);
  const evt = prog.evt;
  const spawnRecords = evt ? evtlib.spawns(evt) : [];

  say(`  ${name}: geometry`);
  const geo = await stage.geometry();
  let parts = geo.parts;
  let modelRegions = geo.modelRegions;

  // Rig geometry travels in the glTF, but *unparented*: the bundle exports no
  // camera nodes, so there is no baked animation to hang a rig under. Passing
  // `anchors = {slot: null}` makes the writer emit each instance as a scene
  // node tagged `hod2_path_slot`, which the client then drives from the raw
  // `op_` curve -- the same trick the camera rails use.
  //
  // The rain particle model is drawn by FUN_004136A0, which no region lists
  // and no asset opcode loads. Append it as its own part with an empty region
  // list so the client can adopt it by slot, exactly as it does the dome.
  const rain = rainJson(tables, prog);
  if (rain.file) {
    const stem = (rain.file as string).replace(/\.bin$/, "");
    const [models, bank] = await cache.get(
      "hod2lib.bundle.build_stage", stem,
      `the rain particle asset ${rain.file}`,
      "no rain model, so the stage draws no rain");
    const entry = rain.entry as number | null;
    if (entry !== null && entry < models.length) {
      parts = [...parts, ["rain_fx", [models[entry]], bank]];
      modelRegions = new Map(modelRegions);
      modelRegions.set(pairKey("rain_fx", 0), {
        regions: [], draw_mode: 0, slot: rain.slot as number, entry,
      });
    }
  }

  say(`  ${name}: object rigs`);
  const [rigInstances, rigBlocked] = await resolveRigs(
    stage, prog, spawnRecords, null, cache);
  const rigData: RigInstance[] = rigInstances.map((inst) => {
    const anchors: Record<string, null> = {};
    for (const r of inst.routes) anchors[String(r.slot)] = null;
    return { ...inst, anchors, biases: {} };
  });

  // Spawned characters ride the same writer: a skeleton is a tree of named
  // parts with a translation and an asset slot, which is exactly a rig. They
  // are appended to the glTF list only -- `rigsJson` below is built from
  // `rigInstances`, so a character never turns up as an object rig.
  say(`  ${name}: characters`);
  const { chars: charDefs, placements: charPlaces,
          entries: charEntries } = await resolveCharacters(
    stage, prog, spawnRecords, null, null, cache);

  // Scripted scenery -- the doors, shutters and vans the script opens. Same
  // writer again: a prop is one model at a pose, which is a rig with a fixed
  // placement.
  say(`  ${name}: scripted props`);
  const [hinges, statics] = propslib.resolveForStage(prog, spawnRecords);
  const propEntries = await propslib.rigEntries(stage, hinges, statics, null,
                                                cache);

  // Before the glTF: the template rig has to include every asset slot the
  // stage's generic props name, and only the script knows which those are.
  const placements = evt ? containerPlacements(tables, evt, spawnRecords) : [];
  const effectDefs = await scriptFlagEffectsJson(stage, placements);
  const brk = await breakableSlotEntry(stage, placements, effectDefs, cache);
  // Decoded here rather than beside the rest of the script json below,
  // because the glTF needs to know whether any class-0x25 descriptor asks for
  // the variant-3 model before it writes the hidden `slots_actor` rig.
  const humanoids = evt ? scriptedHumanoidsJson(evt, spawnRecords) : {};
  const act = await actorSlotEntry(
    stage, spawnRecords.map((r) => r.cls), humanoidDrawSlots(humanoids),
    cache);
  const eff = await effectSlotEntry(stage, cache);
  // Which materials draw blood, so the client can offer the colour the game's
  // own option offers. See `bloodTexturePredicate`.
  const isBloodTexture = bloodTexturePredicate(tables);
  const info = await gltf.exportLevel(name, parts, outDir, sink, deflate, {
    rigs: [...rigData, ...charEntries, ...propEntries,
           ...(brk ? [brk] : []), ...(act ? [act] : []),
           ...(eff ? [eff] : [])],
    writeTextures: opts.writeTextures ?? true,
    camFiles: [],                  // rails are drawn client-side
    unlit: opts.unlit ?? true,
    modelRegions,
    glb,
    isBloodTexture,
  });

  say(`  ${name}: camera paths`);
  const campaths = await stage.campaths();
  const camJson = campaths.toJson();
  // Every file a stage directory holds names the format it was written in, not
  // just the manifest that indexes them. A manifest is rewritten by any
  // export; these are not, so a `stage2/` copied in from an older bundle is
  // otherwise a stale stage inside a fresh bundle, which is the one
  // arrangement a single top-level version can never see.
  camJson.format = BUNDLE_FORMAT;
  // `allowNan: false` on purpose: Python writes bare `NaN` and `Infinity`,
  // which are not JSON and which every browser rejects with a parse error
  // naming a byte offset rather than a field. A bundle that cannot be parsed
  // is worse than an export that fails, so this throws here instead.
  await sink.write(`${outDir}/${name}.cam.json`, dumpsStrict(camJson));

  say(`  ${name}: event script`);
  const scriptJson = prog.toJson();
  scriptJson.format = BUNDLE_FORMAT;      // see the note on `cam.json`
  // The region table travels with the script because the client's region
  // visibility is driven by opcodes 0x28/0x29, and it needs to resolve a
  // region id to the models that region draws.
  scriptJson.regions = stage.regionJson();
  scriptJson.cam_slots_used = prog.camSlotsUsed();
  scriptJson.bgm = bgmJson(tables, stage.stage, stage.gameMode);
  scriptJson.sound = soundJson(tables);
  scriptJson.backdrop = backdropJson(tables, prog);
  scriptJson.rigs = rigsJson(rigInstances, rigBlocked, campaths, tables);
  scriptJson.rain = rain;
  scriptJson.characters = charactersJson(charDefs, charPlaces, tables);
  scriptJson.props = propslib.propsJson(tables, hinges, statics);
  scriptJson.breakables = breakablesJson(tables, placements, effectDefs);
  scriptJson.set_pieces = evt ? setPiecesJson(evt, spawnRecords) : {};
  scriptJson.humanoids = humanoids;
  scriptJson.civilians = evt ? civiliansJson(tables, evt, spawnRecords) : {};
  await sink.write(`${outDir}/${name}.script.json`, dumpsStrict(scriptJson));

  let nSpawns = 0;
  for (const b of prog.liveBlocks()) {
    for (const s of b.steps) {
      for (const o of s.ops) {
        nSpawns += ((o.detail.spawns as unknown[]) ?? []).length;
      }
    }
  }
  // Drained here, at the end of the stage and before the entry is built, so
  // the list is exactly what this stage lost.
  const lost: Degradation[] = degraded.drain();
  // Counted *after* `exportLevel`, which is the only thing that mutates a
  // mesh's triangle list, so this is already what the glTF holds. It used to
  // have `dropped_collapsed_uv` subtracted from it as well, which counted the
  // same triangles twice: stage 1 reported 32,485 for a file with 34,062 in
  // it. Whatever the writer left behind is the number.
  const triangles = parts.reduce(
    (n, [, ms]) => n + ms.reduce((k, m) => k + m.triangleCount, 0), 0);
  const sources: Record<string, string> = {};
  for (const rel of await stage.sourceFiles()) {
    sources[rel] = await sha256Hex(await stage.source.read(rel));
  }
  return {
    name,
    // The entry's own format, which is not the manifest's: a partial export
    // carries forward the entries it did not rebuild, so a fresh manifest can
    // index a stage directory written by an older tool.
    format: BUNDLE_FORMAT,
    // Per stage, because the cache is filled one stage at a time and goes out
    // of date the same way. See `StageEntry.builder`.
    builder: BUILDER_HASH,
    stage: stage.stage,
    scene: stage.scene,
    game_mode: stage.gameMode,
    geometry: info.gltf,
    cam: `${name}.cam.json`,
    script: `${name}.script.json`,
    counts: {
      parts: parts.length,
      models: parts.reduce((n, [, m]) => n + m.length, 0),
      triangles,
      materials: info.materials,
      textures: info.textures,
      regions: geo.regions.length,
      blocks: prog.liveBlocks().length,
      branch_points: prog.branchBlocks().length,
      cam_paths: campaths.size,
      spawns: nSpawns,
      rigs: info.rigs,
      characters: charDefs.size,
      props: hinges.length + statics.length,
      posed_spawns: charPlaces.filter((p) => p.motion !== null).length,
      // **Zero is the only good value here.** Every other count says how much
      // is in the bundle; this one says how much of the game did not make it,
      // because something under `hod2lib` answered a failure with an empty
      // result.
      degraded: lost.length,
    },
    // And what each one was. A bundle missing a stage's characters should be
    // able to say so without the export log, which nobody keeps.
    degraded: lost,
    sources,
  };
}

/**
 * `manifest.json`: what is in the bundle and what it came from.
 *
 * Carries the schema digest as well as the version, so the client can tell
 * "this bundle predates a field you read" from "this bundle is fine".
 *
 * **The digest is imported, not recomputed.** The reference implementation
 * hashes `web/src/bundle/*.ts` off disk; this exporter is compiled against
 * those same declarations, so `schema_hash.ts` -- generated from them and
 * committed -- is the digest by construction. A bundle built in the browser
 * therefore agrees with the client that built it, with nothing to keep in step.
 */
export async function writeManifest(
    sink: BundleSink, stages: Record<string, unknown>[],
    gameDir: string, built: string,
    notes: Record<string, unknown> | null = null): Promise<string> {
  const doc: Record<string, unknown> = {
    format: BUNDLE_FORMAT,
    schema: { hash: SCHEMA_HASH, files: SCHEMA_FILES },
    // Which exporter wrote it, so a bundle can be told it is out of date
    // rather than merely unreadable. See `tools/gen_builder_hash.py`.
    builder: { hash: BUILDER_HASH, files: BUILDER_FILES },
    tool: "hod2lib",
    tool_version: TOOL_VERSION,
    built,
    game_dir: gameDir,
    fps: 60,
    // Recovered from SetupSceneProjection. A compile-time constant for the
    // whole game -- there is no zoom and no per-camera FOV.
    projection: {
      yfov_deg: 41.100,
      yfov_bams: gltf.CAM_FOV_BAMS,
      aspect: 4.0 / 3.0,
      znear: gltf.CAM_ZNEAR,
      zfar: gltf.CAM_ZFAR,
    },
    stages,
  };
  if (notes) doc.notes = notes;
  await sink.write("manifest.json", dumpsIndented(doc));
  return "manifest.json";
}

/**
 * Which `(pol stem, texture id)` pairs are **blood**.
 *
 * `tex/scr_blood_red.bin` and `tex/scr_blood_green.bin` hold 39 images each at
 * the same **global** texture slots — 159 upward — as the ordinary banks that
 * ship them, and the game's Blood Color option loads one bank over the other.
 * So "is this blood" is a question about the global slot a bank entry carries
 * at `+0x0C`, not about the file the model came from: 27 `pol/` files have
 * some, and most of them are the gore parts a zombie swaps in when it is shot
 * rather than the spray itself.
 *
 * Returns a predicate that answers false for everything when the exe tables
 * have no blood bank, which is what a fixture without them needs.
 */
export function bloodTexturePredicate(tables: ExeTables):
    (part: string, texId: number) => boolean {
  const slots = new Set(tables.entries(BLOOD_BANK).map((e) => e.slot));
  if (!slots.size) return () => false;
  // Per bank, the per-bank texture id -> is its global slot a blood one. Built
  // lazily: a stage touches a couple of dozen banks out of 494.
  const byBank = new Map<string, Set<number>>();
  return (part, texId) => {
    let ids = byBank.get(part);
    if (!ids) {
      ids = new Set<number>();
      for (const e of tables.entries(part)) {
        if (slots.has(e.slot)) ids.add(e.index);
      }
      byBank.set(part, ids);
    }
    return ids.has(texId);
  };
}

/** The bank whose global slots define what counts as blood. */
export const BLOOD_BANK = "scr_blood_red";
