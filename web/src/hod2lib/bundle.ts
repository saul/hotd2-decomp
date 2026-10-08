/**
 * Writes the static bundle the browser player loads. See docs/PLAYER.md,
 * "The bundle".
 *
 * The player does **not** parse `pol/`, `tex/`, `cam/`, `evt/` or `Hod2.exe`
 * while it is playing: it loads glTF, evaluates Hermite curves and walks the
 * resolved event script. The parsing runs in a CLI or in a worker in the
 * page, so a bundle can be built without leaving the browser; either way it
 * is built once and then consumed.
 *
 * Layout:
 *
 *     extract/player/
 *       manifest.json                format, digests, stages, source hashes
 *       stage2/
 *         stage2.glb                 geometry, materials, textures
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
// Same argument: `class13/state.ts` is data only, `class13/index.ts` registers.
import { CARRIER_SELECTORS_PORTED, CarrierDrawSlots, CarrierEffects }
  from "../game/class13/state";
// ...and `class12/state.ts` for the slot strip class 0x12 steps through.
import { ScriptedProp12DrawSlots } from "../game/class12/state";
// ...and `class26/state.ts` for what class 0x26 subtypes 6 and 7 draw.
import { Class26DrawSlots } from "../game/class26/state";
// ...and `class19/slots.ts` for the stage-4 boss's prop and hit mark.
import { Boss4EffectSlots } from "../game/class19/slots";
// ...and `class41/water_slots.ts` for the tiles the canal water task pairs
// and swaps -- immediates in its routine, which the geometry has to contain.
import { WATER_SURFACE_ALSO_DRAWS } from "../game/class41/water_slots";
// ...and the immediates class 0x44 selector 12 and class 0x41 constructor 47
// draw, which the geometry has to contain.
import { SLIDE_SECOND_DRAW_SLOT, SLIDE_SECOND_SLOT }
  from "../game/class44/slide_slots";
import { TYPE47_CONSTRUCTOR, TYPE47_SLOT } from "../game/class41/type47_slots";
// Same argument again: `hud_sprites.ts` is the id list `hud_readout.ts` draws
// from, as data, and the exporter must put exactly those textures in.
// The continue screen's and the credit line's are in the same file.
import { BOSS_HP_BAR_SPRITES, CONTINUE_SCREEN_SPRITES, HUD_READOUT_SPRITES }
  from "../game/hud_sprites";
// ...and the boss-name banner's, whose record table is data in the same way.
import { BOSS3_CARD_SPRITES, BOSS3_EFFECT_SLOTS }
  from "../game/class45/tables";
import { CLASS2D_EFFECT_SLOTS } from "../game/class2D/state";
import { BOSS_BANNER_SPRITES, bannerCardSlots }
  from "../game/boss_banner_records";
// And the game-over screen's: its logo sprites are immediates in
// `GameOverLogoTask`, its route tiles are `.rdata` read below.
import { GAME_OVER_LOGO_SPRITES, ROUTE_FIGURE_SHADOW_SLOT, ROUTE_MARK_SLOTS }
  from "../game/player_body_data";
// And the options screen's: its titles, EXIT and backgrounds are immediates
// in its routines; its glyphs, crosshairs and sliders are `.rdata` read below.
import { OPTIONS_SCREEN_SPRITES, SCREEN_IDLE_DIM_SLOT }
  from "../game/options_data";
// And the result card's: its seventeen tiles and its glyph models are
// immediates in `ResultCardInstall`.
import { RESULT_CARD_SPRITES, RESULT_GLYPH_SLOTS }
  from "../game/class61/state";
// The trunk's sprites and models: class 0x6E's immediates.
import { ITEM_SELECT_SLOTS, ITEM_SELECT_SPRITES } from "../game/class6e/state";
import { SpawnClass } from "../game/spawn_class";
import { f32, i16, i32, u32 } from "./bytes";
import * as C from "./container";
import { encodeRgba } from "./png";
import * as texbank from "./texbank";
import { BODY_CREATURE_SLOTS, CARRIED_PROP_BREAK, CARRIED_PROP_SLOTS,
         IMPACT_SPRITE_BY_MATERIAL } from "./combat";
import { WEAPON_FIRST_SLOT, WEAPON_LAST_FRAME }
  from "../game/effects/shot_effects";
import { SpriteEffectKind } from "../game/effects/sprite";
import { charactersJson, resolveForStage as resolveCharacters,
         stagePlacesResultCard } from "./characters";
import * as charmotion from "./charmotion";
import { class42Tables } from "./class42";
import * as degraded from "./degraded";
import type { Degradation } from "./degraded";
import * as evtlib from "./evt";
import type { Spawn } from "./evt";
import type { ExeTables } from "./exetab";
import * as gltf from "./gltf";
import { bundleJson } from "./io";
import type { AssetSource, BundleSink, Deflate, Progress } from "./io";
import { loadBank } from "./mot";
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
 * **It stayed at 1 across 23 commits** -- the
 * ones that added `coli`, `civilians`, `humanoids` and `set_pieces`, and the
 * one that renumbered `game_mode`. A version check whose constant nobody bumps
 * is documentation, not a check.
 *
 * **This integer is still the coarse check, and it is not the one that will
 * fire.** It says "the *layout* moved"; the digest beside it, which nobody has
 * to remember, catches the field-level drift.
 */
export const BUNDLE_FORMAT = 16;

/**
 * Every asset slot the three container families can draw. The group props use
 * the first four; `KindedPropUpdate` adds the three kinded models and the
 * smaller shadow, and `FallingContainerUpdate` the whole/loose pair plus
 * `0xA55`, which is what its two `FallingContainerFragmentUpdate`
 * (`FUN_0046AD20`) pieces draw.
 *
 * The fifteen pieces a stacked group prop shatters into are **not** listed
 * here: `BreakablePropShatterUpdate` (`FUN_004653B0`) draws them out of
 * `g_shatter_fragment_slots_a` and `_b`, so `breakableSlotEntry` takes them
 * from `ExeTables.shatterPieces` rather than from a second copy.
 */
export const BREAKABLE_SLOTS = [
  0x19e8, 0x19e6, 0x1a0f, 0x10d0,          // BreakablePropUpdate
  0x17a9, 0x17aa, 0x17ab, 0x10d1,          // KindedPropUpdate
  0x0a50, 0x0a51, 0x0a55,                  // FallingContainerUpdate
  // ExtraLifePickupUpdate, which any of the three can release: the heart,
  // the two players' tags and their pickup strips (frames 1..0x31 each).
  0x10c3, 0x1256, 0x1257,
  ...Array.from({ length: 49 }, (_, i) => 0x116a + i),
  ...Array.from({ length: 49 }, (_, i) => 0x119c + i),
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
 * The literal slots each read routine passes to `AssetDrawSlot`, and every
 * slot a strip or a cursor it steps can reach. Cited by the routine that
 * draws each one.
 *
 * Since the routines record their own draws (`game/class41/prop_draw.ts`) a
 * slot missing here is a draw that happens and shows nothing, so each row is
 * the whole of what its routine can ask for in the shipped data. The models
 * an Original Mode item can wear are not here: they are the item records'
 * (`originalItemSlots`), for every row `originalItemsJson` carries -- which
 * is how type 7's and type 43's drops, the collectibles and the story items
 * all come by theirs. `web/tools/checks/prop_slots.ts` holds every placed type to
 * its row.
 */
export const GENERIC_STATIC_SLOTS: Record<number, number[]> = {
  // PropUpdateType6: the model is the cursor, 0x1032 up to the 0x1063 that wraps.
  6: Array.from({ length: 49 }, (_, i) => 0x1032 + i),
  // PropUpdateType7, and the shadow of the drop SpawnOriginalItemDrop makes in
  // stage 1's Original Mode (its item and strips are row 0's, carried below).
  7: [0x1736, 0x10d0],
  8: [0x1a36, 0x1aaa],                // PropUpdateType8 and its three parts
  9: [0x123b, 0x123c],                // PropUpdateType9, before and after
  // PropUpdateType6 again, type 10's arm: 0x10C4 up to the 0x10CD that wraps.
  10: Array.from({ length: 9 }, (_, i) => 0x10c4 + i),
  11: [0x01cf, 0x01d0],               // PropUpdateType11, `0x1CF + (frame & 1)`
  13: [0x1a4a, 0x1a49, 0x1a43],       // PropUpdateType13
  14: [0x10d2],                       // PropUpdateType14
  19: [0x01ce, 0x10d3],               // PropUpdateType19, body plus the ctor arm
  20: [0x01e2],                       // PropUpdateType20
  21: Array.from({ length: 10 }, (_, i) => 0x132f + i),  // PropDrawOnlyType21
  27: [0x17a9],                       // PropKillOnBranchOneUpdate
  30: [0x01df],                       // PropUpdateType30
  // PropDrawOnlyType31's scene-2 block-11 pair, `tick % 7 + 0x1797`; the strip
  // itself is the descriptor's (GENERIC_SLOT_STRIP).
  31: Array.from({ length: 7 }, (_, i) => 0x1797 + i),
  32: [0x197a, 0x197b, 0x1981],       // LiftUpdate -- car, cage leaf, panel
  35: [0x1812, 0x1813],               // PropUpdateType35
  36: Array.from({ length: 24 }, (_, i) => 0x161b + i),  // PropUpdateType36
  41: [0x0930],                       // PropUpdateType41, both panels
  // PropUpdateType43. Its `obj+0x28C` is NOT the descriptor's -- the arm
  // computes `kind == 3 ? 0x19E8 : 0xFFFF` -- so the slots it can wear are
  // literals: the crate, the kind-2 piece, the heart, the two tags and the
  // two pickup strips the life's pickup plays. A cracked crate is effect 0's
  // tree, not a model (`genericPropEffects`); its Original item is row 0's.
  43: [0x19e8, 0x17a9, 0x10c3, 0x1256, 0x1257, ...Array.from({ length: 49 }, (_, i) => 0x116a + i), ...Array.from({ length: 49 }, (_, i) => 0x119c + i)],
  45: Array.from({ length: 5 }, (_, i) => 0x1731 + i),   // PropUpdateType45
  49: [0x01d2, 0x10d0],               // PropUpdateType49, body plus its shadow
  // PropDrawOnlyType53's two camera-facing strips in blocks 4 and 5.
  53: [...Array.from({ length: 15 }, (_, i) => 0x135f + i), ...Array.from({ length: 8 }, (_, i) => 0x0b67 + i)],
  56: [0x1866, 0x10d3],               // PropUpdateType56, base and part
  57: [0x0d43, 0x0d44],               // PropUpdateType57
  58: [0x01d1],                       // PropUpdateType58
  60: [0x01d8],                       // PropUpdateType60
  64: [0x1a39, 0x0c27],               // PropUpdateType64
  67: [0x1a36, 0x1a35, 0x1a0f, 0x19e8, 0x19e6],  // PropUpdateType67 and its three
  69: [0x13f8, 0x13f7],               // PropUpdateType69
  73: [0x1871],                       // PropUpdateType73
  74: [0x0a64],                       // PropUpdateType74
  75: [0x0a6b],                       // PropUpdateType75, on op_ path 0x178
  // PropUpdateType76: the near door 0xA6D and the plate 0x10D3 on it for the
  // +0x194 == 0 arm; the two leaves 0xA67/0xA68 and the same plate for the
  // +0x194 == 1 arm.
  76: [0x0a6d, 0x10d3, 0x0a67, 0x0a68],
  77: [0x10ab],                       // PropUpdateType77, item 31's own model
};

/**
 * Class 0x41 type 48 -- `PlaceFlickerLightProp48` (`FUN_00463B20`) builds it,
 * not `PlaceGenericProp`, so it is its own container. What
 * `PropUpdateType48FlickerLight` (`FUN_0046DDE0`) draws: the whole prop
 * `0x17AC`, the broken one `0x17AD`, and thirty debris pieces
 * `0xCA5 + i`.
 */
export const FLICKER_LIGHT_TYPE = 48;
export const FLICKER_LIGHT_SLOTS: number[] = [
  0x17ac, 0x17ad, ...Array.from({ length: 30 }, (_, i) => 0xca5 + i),
];

/**
 * The effect trees a generic type's routine draws, as `[effect, motion]`
 * pairs -- the state block its arm writes at `obj+0x324`/`+0x328`, which the
 * routine hands to `EffectDrawUnlit` (`FUN_0040DD90`) or `EffectDrawSceneLit`
 * (`FUN_0040DFA0`). A type drawing two rewrites the block between them, so
 * both travel. Type 18's arm picks its effect by scene. The trees go into
 * `breakables.effects`, keyed by effect id, beside class 0x44's.
 */
export function genericPropEffects(type: number,
                                   scene: number): Array<[number, number]> {
  switch (type) {
    case 9: return [[8, 0x1d0], [9, 0x1d1]];      // PropUpdateType9
    case 18: return [[scene === 1 ? 1 : 0x19, 0x1d8]];   // PropUpdateType18
    case 25: return [[10, 0x1c9]];                // PropUpdateType25
    case 27: return [[7, 0x1d5]];                 // PropKillOnBranchOneUpdate
    case 28: return [[10, 0x1c9]];                // PropUpdateType28
    // PropUpdateType43: a cracked crate is effect 0's tree, and a kind 2 is
    // effect 7's (`g_prop_kind_params`).
    case 43: return [[0, 0x1d9], [7, 0x1d5]];
    case 62: return [[0x1c, 0x1c6]];              // PropUpdateType62
    default: return [];
  }
}

/**
 * The effect trees the stage's generic props draw, keyed by effect id, for
 * the same map {@link scriptFlagEffectsJson} fills. One motion per id is all
 * the map can hold: a second motion for an id already there is noted and not
 * exported, rather than silently posing one effect with another's clip.
 */
export async function genericPropEffectsJson(
    stage: Stage, placements: Record<string, unknown>[],
    have: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const pl of placements) {
    if (pl.container !== "generic") continue;
    for (const [effect, motion] of genericPropEffects(pl.type as number,
                                                      stage.scene ?? -1)) {
      const key = String(effect);
      const prior = (out[key] ?? have[key]) as { motion?: number } | undefined;
      if (prior) {
        if (prior.motion !== motion) {
          degraded.note("hod2lib.bundle.generic_prop_effects",
                        `effect ${effect}`,
                        "a generic prop's second motion for it is not exported",
                        `motion 0x${motion.toString(16)} against `
                        + `0x${(prior.motion ?? -1).toString(16)}`);
        }
        continue;
      }
      const def = await effectDefJson(
        stage, effect, motion, "hod2lib.bundle.generic_prop_effects", []);
      if (def) out[key] = def;
    }
  }
  return out;
}

/**
 * Stage number -> the index in the BGM tables of that stage's own track.
 *
 * **The event script plays these**, at step 2 of each entry block: a
 * `se_play` of the track in stages 1-4 and 6, a `bgm_entry_play` in stage 5.
 * This said the opposite for as long as only `bgm_entry_play` had been
 * looked at -- every one of those names a boss or transition track -- and the
 * player started the track at load on the strength of it. The player no
 * longer reads this field; it is a label, and a check (`test:seek`) that the
 * script's own first track is the one named here.
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
      note: "the stage's own track, which its script starts at step 2 of "
        + "each entry block (se_play; bgm_entry_play in stage 5)",
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

/** `PlaceTable44Props`' literal `obj+0x324 = 0x13` and `obj+0x328 = 0x1D4`. */
export const TABLE44_EFFECT = 0x13;
export const TABLE44_MOTION = 0x1d4;

/**
 * The slots the three table constructors' objects draw, by container.
 *
 * * `table38`/`table39` — `0x1237` whole, `0x1236` once `PropUpdateType38`
 *   is shot (`komono_st1.bin[3]` and `[2]`).
 * * `table44` — `0x1064` (`komono_7.bin[0]`) for rows 2..6 and the shadow
 *   `0x10D1`; rows 0 and 1 draw effect 0x13, whose node slots travel with
 *   the effect.
 */
export const TABLE_SLOTS: Record<string, number[]> = {
  table38: [0x1237, 0x1236],
  table39: [0x1237],
  table44: [0x1064, 0x10d1],
};

/**
 * Class 0x41 constructor 50, `PlaceTable50Props` (`FUN_00463BA0`): the
 * placer's `+0x1F4` picks one of six tables through `g_prop_table50_ptrs`
 * (`0x00594F08`), `g_prop_table50_counts` (`0x00594F20`, an s8 each) says how
 * many 28-byte rows it has, and the u16 at the head of each row is the slot
 * its `PropDrawOnlyType12` object draws.
 */
export const TABLE50_TYPE = 50;
export const PROP_TABLE50_PTRS = 0x00594f08;
export const PROP_TABLE50_COUNTS = 0x00594f20;
export const PROP_TABLE50_ROW = 0x1c;
/** Six pointers and six counts: `(s16)placer+0x1F4` outside them reads junk. */
export const PROP_TABLE50_TABLES = 6;

/**
 * Class 0x41 constructor 66, `PlaceTable66Props` (`FUN_00464500`): twenty
 * rows of `g_prop_table66_a` (`0x00595158`), or twenty-nine of
 * `g_prop_table66_b` (`0x005953D8`) when the placer's `+0x1F4` is above zero
 * -- both counts `MOV` immediates in the constructor. The s16 at the head of
 * each 32-byte row is the slot its `PropUpdateType66` object draws.
 */
export const TABLE66_TYPE = 66;
export const PROP_TABLE66_A = 0x00595158;
export const PROP_TABLE66_A_ROWS = 0x14;
export const PROP_TABLE66_B = 0x005953d8;
export const PROP_TABLE66_B_ROWS = 0x1d;
export const PROP_TABLE66_ROW = 0x20;

/**
 * The slots one constructor-50 or constructor-66 placement's objects draw,
 * read out of the image the way the constructor reads its rows, or null for a
 * table index the constructor has no table for.
 */
export function propTableSlots(tables: ExeTables, ctor: number,
                               index: number): number[] | null {
  let base: number;
  let rows: number;
  let stride: number;
  if (ctor === TABLE50_TYPE) {
    if (index < 0 || index >= PROP_TABLE50_TABLES) return null;
    const ptr = tables.ru32(PROP_TABLE50_PTRS + index * 4);
    const word = tables.ru16(PROP_TABLE50_COUNTS + index);
    if (ptr === null || word === null) return null;
    base = ptr;
    rows = ((word & 0xff) << 24) >> 24;
    stride = PROP_TABLE50_ROW;
  } else if (ctor === TABLE66_TYPE) {
    // `if (0 < (s16)placer+0x1F4)` -- a negative index takes table a.
    base = index > 0 ? PROP_TABLE66_B : PROP_TABLE66_A;
    rows = index > 0 ? PROP_TABLE66_B_ROWS : PROP_TABLE66_A_ROWS;
    stride = PROP_TABLE66_ROW;
  } else {
    return null;
  }
  const out: number[] = [];
  for (let i = 0; i < rows; i++) {
    const slot = tables.ru16(base + i * stride);
    if (slot === null) return null;
    if (!out.includes(slot)) out.push(slot);
  }
  return out;
}

/**
 * The slots one type-40 sub-kind can draw, from `PlaceFragmentProps`
 * (`FUN_004636A0`) and `PropUpdateType40` (`FUN_0046C570`): its starting slot
 * (`g_fragment_slots`, or the literals of arms 0 and 1), the next one — a hit
 * adds one — sub-kind 9's second draw at `+0x96`, and the forty `garasu.bin`
 * burst pieces `0xCA5`..`0xCCC` every sub-kind shares.
 */
export function fragmentSlots(tables: ExeTables, subKind: number): number[] {
  const out: number[] = [];
  if (subKind === 0) out.push(0x123e, 0x123f);
  else if (subKind === 1) out.push(0x17c6, 0x17c7);
  else {
    const base = tables.ru16(FRAGMENT_SLOTS + subKind * 2) ?? 0;
    if (base) out.push(base, base + 1);
    if (base && subKind === 9) out.push(base + 0x96, base + 1 + 0x96);
  }
  for (let i = 0; i < 40; i++) out.push(0xca5 + i);
  return out;
}

/** `g_fragment_slots` — `0x0059463C`, a u16 per type-40 sub-kind. */
export const FRAGMENT_SLOTS = 0x0059463c;

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
      } else if (ctor === FLICKER_LIGHT_TYPE) {
        // `PlaceFlickerLightProp48`: its own constructor. `+0x11C` (the
        // descriptor's hit-point word) is the lifetime in evt steps; the
        // position and yaw are the placer's.
        out.push({
          at: rec.offset, container: "flicker_light",
          lifetime_evt_steps: rec.hp,
          pos: [...rec.pos], yaw: rec.orient[1],
          slots: FLICKER_LIGHT_SLOTS,
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
      } else if (ctor === TYPE47_CONSTRUCTOR) {
        // `PlaceType47Prop` (`FUN_00463AE0`) -- a 0x48-byte task that draws
        // one faded disc at the descriptor's position and reads nothing else
        // of it. No lifetime: a script flag and a step index end it.
        out.push({
          at: rec.offset, container: "type47",
          lifetime_evt_steps: 0,
          pos: [...rec.pos],
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
      } else if (ctor === 38 || ctor === 39 || ctor === 44) {
        // `PlaceTable38Props`, `PlaceTable39Stacks`, `PlaceTable44Props`:
        // every object comes out of a table in the image, so the descriptor
        // contributes only `+0x11C`, copied into each one as its step
        // lifetime. Type 44's first two rows draw effect 0x13 on motion 468
        // (`obj+0x324`/`+0x328`, literals in the constructor), which is what
        // puts that effect's tree and clip in `breakables.effects`.
        out.push({
          at: rec.offset, container: `table${ctor}`,
          lifetime_evt_steps: rec.hp,
          ...(ctor === 44 ? { effect: TABLE44_EFFECT, motion: TABLE44_MOTION }
                          : {}),
          pos: [...rec.pos], yaw: rec.orient[1],
        });
      } else if (ctor === TABLE50_TYPE || ctor === TABLE66_TYPE) {
        // `PlaceTable50Props` and `PlaceTable66Props`: every object comes out
        // of a table in the image and the descriptor names only which one --
        // `+0x1F4`, the s8 at `desc+0x24` -- and the step lifetime, `+0x11C`,
        // each object copies. The position and angles are never read.
        const index = s8(rec.offset + 0x24);
        if (propTableSlots(tables, ctor, index) === null) {
          degraded.note("hod2lib.bundle.container_placements",
                        `table constructor ${ctor} at 0x${rec.offset.toString(16)}`,
                        "the objects are not placed and nothing draws them",
                        `index ${index} names no table`);
          continue;
        }
        out.push({
          at: rec.offset, container: `table${ctor}`,
          field_1f4: index,
          lifetime_evt_steps: rec.hp,
          pos: [...rec.pos], yaw: rec.orient[1],
        });
      } else if (ctor === 1) {
        // `PlaceWaterSurface` -- the canal water task. Its slot is
        // `g_water_surface_slots[(s16)obj+0x1F4]`, looked up here because the
        // table is image data; the index travels too, since with index 0 the
        // ripple is limited to `z <= -1870`. `+0x11C` is the lifetime.
        const index = s8(rec.offset + 0x24);
        const slot = tables.waterSurfaceSlots()[index];
        if (slot === undefined) {
          degraded.note("hod2lib.bundle.container_placements",
                        `water surface at 0x${rec.offset.toString(16)}`,
                        "the task is not placed and nothing draws its tile",
                        `index ${index} is outside g_water_surface_slots`);
          continue;
        }
        out.push({
          at: rec.offset, container: "water_surface",
          field_1f4: index, slot,
          lifetime_evt_steps: rec.hp,
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
    } else if (rec.hp === 13) {              // class 0x44 selector 13
      // `PropBuildRiseToHeight` (`FUN_00473640`) -- an object that rises a
      // unit a frame on a script flag until it stands a whole-number height
      // above where it was placed. The tail is read at the same offsets and
      // widths the constructor reads it: the u16 at `+0x04` is the slot
      // `RiseToHeightUpdate` draws, the i32 at `+0x08` goes to `obj+0x14C`,
      // the **i32** at `+0x14` is `FILD`ed into the ceiling at `0x004736C0`,
      // and the two signed bytes at `+0x20`/`+0x21` are the rise flag and
      // the remove flag. No lifetime: the remove flag is the object's whole
      // life, as it is selector 11's.
      out.push({
        at: rec.offset, container: "rise_to_height",
        slot: rec.param(0x04, "u16") || 0,
        coli: rec.param(0x08, "i32") ?? -1,
        rise: rec.param(0x14, "i32") ?? 0,
        open_flag: rec.param(0x20, "i8") ?? 0,
        remove_flag: rec.param(0x21, "i8") ?? -1,
        lifetime_evt_steps: 0,
        pos: [...rec.pos], yaw: rec.orient[1],
      });
    } else if (rec.hp === 12) {              // class 0x44 selector 12
      // `PropBuildSlideOnFlag` (`FUN_004734A0`) -- an object that slides a
      // set distance on a script flag. The tail at the offsets and widths the
      // constructor loads it: the u16 at `+0x04` is the slot and the same
      // DWORD is what the elevator-door test compares (`MOV EAX,[EDI+0x4];
      // CMP EAX, 0xAFC`), the i32 at `+0x08` goes to `obj+0x14C`, the i32 at
      // `+0x10` is `FIMUL`ed into the per-frame slide and the i32 at `+0x14`
      // `FILD`ed into its length; the two signed bytes are the flags.
      out.push({
        at: rec.offset, container: "slide_on_flag",
        slot: rec.param(0x04, "u16") || 0,
        slot_word: rec.param(0x04, "u32") ?? 0,
        coli: rec.param(0x08, "i32") ?? -1,
        speed: rec.param(0x10, "i32") ?? 0,
        travel: rec.param(0x14, "i32") ?? 0,
        open_flag: rec.param(0x20, "i8") ?? 0,
        remove_flag: rec.param(0x21, "i8") ?? -1,
        lifetime_evt_steps: 0,
        pos: [...rec.pos], yaw: rec.orient[1],
      });
    } else if (rec.hp === 9) {               // class 0x44 selector 9
      // `PropBuildFlagLiftedProp` (`FUN_00473300`) -- one slot that rises to
      // y 10 on a flag. The u16 at `+0x04` and the two signed bytes; the
      // constructor reads nothing else, not even the yaw.
      out.push({
        at: rec.offset, container: "flag_lifted",
        slot: rec.param(0x04, "u16") || 0,
        open_flag: rec.param(0x20, "i8") ?? 0,
        remove_flag: rec.param(0x21, "i8") ?? -1,
        lifetime_evt_steps: 0,
        pos: [...rec.pos],
      });
    } else if (rec.hp === 14) {              // class 0x44 selector 14
      // `PropBuildDrawOnlySelector14` (`FUN_004736D0`) -- a model at the
      // spawn's pose at a scale, for a lifetime in steps. The tail as the
      // constructor reads it: the u16 at `+0x00` to `obj+0x11C` (the
      // lifetime `PropExpireByStepLifetime` counts), the u16 at `+0x04` to
      // `obj+0x28C` (the slot), and three f32 at `+0x08`..`+0x10` to
      // `obj+0x1A8`..`+0x1B0` (the scale). All three angles are the
      // placer's own and real.
      out.push({
        at: rec.offset, container: "draw_only_14",
        slot: rec.param(0x04, "u16") || 0,
        lifetime_evt_steps: rec.param(0x00, "u16") ?? 0,
        scale: [0x08, 0x0c, 0x10].map((o) => rec.param(o, "f32") ?? 0),
        pos: [...rec.pos],
        pitch: rec.orient[0], yaw: rec.orient[1], roll: rec.orient[2],
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
                               effects: Record<string, unknown> = {},
                               scene = 0):
    Record<string, unknown> {
  const out: Record<string, unknown> = {
    groups: tables.breakableGroups(),
    hull: tables.breakableHullPoints().map((p) => [...p]),
    falling_hull: tables.fallingHullPoints().map((p) => [...p]),
    fragment_hull: tables.fragmentHullPoints().map((p) => [...p]),
    shatter: tables.shatterPieces(),
    kinds: tables.propKindParams(),
    placements,
    effects,
    level_height: 7.540296,
    original_items: originalItemsJson(tables, placements, scene),
    // `g_pHingeCurvesXYZ`, whole: the class-0x41 generic routines that swing
    // a hinge read it by a literal curve index, in `game/`, where the
    // class-0x44 hinges' own copy in `props.curves` cannot be reached.
    hinge_curves_xyz: Object.fromEntries(
      propslib.HINGE_CURVES_XYZ_SELECTORS.map(
        (c) => [String(c), propslib.hingeCurve(tables, c)])),
  };
  return out;
}

/**
 * The class-0x41 types whose arm calls `PickOriginalModeItem`
 * (`FUN_004629C0`) with the placer's `+0x1F4` byte as the row: 70, 71 and 72
 * (`0x0046273F`, `0x00462797`, `0x00462860`).
 */
export const ORIGINAL_ITEM_TYPES = [70, 71, 72];

/**
 * The class-0x41 types whose routine calls `PickOriginalModeItem` with a
 * literal row 0: `SpawnOriginalItemDrop` (`FUN_00466B40`), which
 * `PropUpdateType7` (`FUN_00466930`) calls with `PUSH 0x0` at `0x00466A04`,
 * and `PropUpdateType43` (`FUN_0046CEA0`)'s break at `0x0046D019`.
 */
export const ORIGINAL_ITEM_ROW_ZERO_TYPES = [7, 43];

/**
 * The pickup the collectible becomes when shot: `OriginalItemPropUpdate`
 * (`FUN_004675A0`) and `PropUpdateType72` (`FUN_00470750`) both draw
 * `AssetDrawSlot(obj+0x2A4 - 1 + obj+0x2A0)` with `obj+0x2A0` running 1..0x31
 * and `obj+0x2A4` 0x116A for player 0 or 0x119C (`0x116A + 50`) for player 1.
 * Two strips of 49 frames each.
 */
export const ORIGINAL_ITEM_PICKUP_STRIPS = [0x116a, 0x119c];
export const ORIGINAL_ITEM_PICKUP_FRAMES = 0x31;

/**
 * `OriginalItemBannerUpdate` (`FUN_00475D00`)'s frame sprite, drawn behind
 * the item's own `g_original_item_records[id].sprite`.
 */
export const ORIGINAL_ITEM_BANNER_FRAME = 0x5e0;

/**
 * The rows `SpawnStoryModeItem` (`FUN_00467B90`) is handed by the two generic
 * types that call it with a row of their own: `MOV dword ptr [ESI+0x2A0], 2`
 * in `PropUpdateType74` (`0x00470F4A`) and `MOV [ESI+0x2A0], EDI` with `EDI =
 * 1` in `PropUpdateType75` (`0x004711C9`). Join keys: the exporter has to
 * know them to carry those rows.
 */
export const STORY_ITEM_ROW_BY_TYPE: Record<number, number> = { 74: 2, 75: 1 };

/**
 * This scene's Original Mode item rows and records, cut to what its
 * placements can reach. See `OriginalItemsJson`.
 *
 * A row is named by the placer's byte for a collectible (types 70, 71, 72),
 * by a routine's own immediate for types 7, 43, 74 and 75, and by a story item --
 * `obj+0x2A0` -- for a group member or a falling container, whose destroy
 * path hands `SpawnStoryModeItem` that word in Original Mode.
 */
export function originalItemsJson(tables: ExeTables,
                                  placements: Record<string, unknown>[],
                                  scene: number): Record<string, unknown> {
  const rows: Record<string, unknown> = {};
  const records: Record<string, unknown> = {};
  const named: number[] = [];
  const groups = tables.breakableGroups() as { story_item: number }[][];
  for (const pl of placements) {
    const type = pl.type as number;
    if (pl.container === "generic" && ORIGINAL_ITEM_TYPES.includes(type)) {
      named.push((pl.field_1f4 as number) ?? 0);
    } else if (pl.container === "generic"
               && ORIGINAL_ITEM_ROW_ZERO_TYPES.includes(type)) {
      named.push(0);
    } else if (pl.container === "generic" && type in STORY_ITEM_ROW_BY_TYPE) {
      named.push(STORY_ITEM_ROW_BY_TYPE[type]);
    } else if (pl.container === "group") {
      for (const m of groups[pl.group as number] ?? []) named.push(m.story_item);
    } else if (pl.container === "falling") {
      named.push((pl.story_item as number) ?? -1);
    }
  }
  for (const row of named) {
    if (row < 0 || String(row) in rows) continue;
    const r = tables.originalItemRow(scene, row);
    if (!r) continue;
    rows[String(row)] = r;
    for (const id of r.ids) {
      if (id < 0 || String(id) in records) continue;
      const rec = tables.originalItemRecord(id);
      if (rec) records[String(id)] = rec;
    }
  }
  return { scene, rows, records };
}

/**
 * Every asset slot a collectible placement can draw: both models of each id
 * its row names (0xFFFF is none), and both pickup strips.
 */
export function originalItemSlots(original: Record<string, unknown>): number[] {
  const out: number[] = [];
  const recs = (original.records ?? {}) as
    Record<string, { slot: number; slot2: number }>;
  for (const rec of Object.values(recs)) {
    for (const s of [rec.slot, rec.slot2]) {
      if (s && s !== 0xffff && !out.includes(s)) out.push(s);
    }
  }
  if (Object.keys(recs).length) {
    for (const base of ORIGINAL_ITEM_PICKUP_STRIPS) {
      for (let i = 0; i < ORIGINAL_ITEM_PICKUP_FRAMES; i++) {
        if (!out.includes(base + i)) out.push(base + i);
      }
    }
  }
  return out;
}

/** The banner sprites a collectible placement can raise, and its frame. */
export function originalItemSprites(original: Record<string, unknown>):
    number[] {
  const recs = (original.records ?? {}) as Record<string, { sprite: number }>;
  const out = Object.values(recs).map((r) => r.sprite);
  if (out.length) out.push(ORIGINAL_ITEM_BANNER_FRAME);
  return out;
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
  const out: Record<string, unknown> = {};
  for (const pl of placements) {
    // Every placement that names an effect and a motion: class 0x44 selector
    // 0's window halves, and class 0x41 type 44's two breakable chairs.
    if (pl.effect === undefined || pl.motion === undefined) continue;
    const effect = pl.effect as number;
    const motion = pl.motion as number;
    if (out[String(effect)] !== undefined) continue;
    const def = await effectDefJson(
      stage, effect, motion, "hod2lib.bundle.script_flag_effects",
      propslib.effectSoundCues(
        stage.tables, effect === propslib.SCRIPT_FLAG_EFFECT_A.effect
          ? propslib.SCRIPT_FLAG_EFFECT_CUES_A
          : propslib.SCRIPT_FLAG_EFFECT_CUES_B));
    if (def) out[String(effect)] = def;
  }
  return out;
}

/**
 * The break effects of the carried props a stage's state-37 scripts name,
 * keyed by effect id into the same map the class-0x44 effects use --
 * `CarriedPropBreakUpdate` (`FUN_00444EE0`) draws them through the same
 * `EffectDrawUnlit` those do. No sound cues: the break has none of its own.
 */
export async function carriedPropEffectsJson(
    stage: Stage, placements: readonly Record<string, unknown>[]):
    Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const type of carriedPropTypes(placements)) {
    const brk = CARRIED_PROP_BREAK[type];
    if (!brk || out[String(brk.effect)] !== undefined) continue;
    const def = await effectDefJson(stage, brk.effect, brk.motion,
                                    "hod2lib.bundle.carried_prop_effects", []);
    if (def) out[String(brk.effect)] = def;
  }
  return out;
}

/** The `g_carried_prop_types` indices a stage's state-37 scripts name. */
function carriedPropTypes(placements: readonly Record<string, unknown>[]):
    number[] {
  const out: number[] = [];
  for (const p of placements) {
    for (const k of ["target_script", "attack_script"]) {
      const s = p[k] as { state?: number; head?: { prop_type?: number } }
        | null | undefined;
      const t = s?.state === 37 ? s.head?.prop_type : undefined;
      if (t !== undefined && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

/** One effect id's tree and baked motion, or null with a degraded note. */
async function effectDefJson(stage: Stage, effect: number, motion: number,
                             site: string, cues: number[]):
    Promise<Record<string, unknown> | null> {
  const tables = stage.tables;
  const banks = tables.motionBanks();
  const nodes = propslib.effectTree(tables, effect);
  const declared = tables.ru16(propslib.EFFECT_BONE_COUNTS + effect * 2) ?? 0;
  // `spawns.md` proves the two agree on the effects it lists; a stage that
  // disagreed would be a tree read at the wrong struct, and baking the motion
  // at the wrong stride afterwards would hide it in float noise.
  if (!nodes.length || nodes.length !== declared) {
    degraded.note(site, `effect ${effect} tree`,
                  "the effect is not exported and nothing draws it",
                  `${nodes.length} nodes against g_effect_bone_counts `
                  + `${declared}`);
    return null;
  }
  const bankId = tables.motionBankOf(motion);
  const bank = bankId !== null && banks.has(bankId)
    ? await loadBank(stage.source, banks.get(bankId)![0],
                     banks.get(bankId)![1])
    : null;
  const frames = bank ? bank.effectFrames(motion, declared) : [];
  if (!frames.length) {
    degraded.note(site, `effect ${effect} motion ${motion}`,
                  "the effect is exported without a pose and holds frame 0",
                  "no frames decoded");
  }
  const t: number[] = [];
  const r: number[] = [];
  for (const f of frames) {
    for (const v of f.t) t.push(v[0], v[1], v[2]);
    for (const v of f.r) r.push(v[0], v[1], v[2]);
  }
  return {
    nodes: nodes.map((n) => ({ slot: n.slot, bone: n.bone,
                               children: [...n.children] })),
    interp: tables.data[tables.v2r(propslib.EFFECT_INTERP_MODE + effect) ?? 0],
    motion,
    // The clock the cursor stops two short of, in play frames.
    play_length: tables.motionPlayLength(motion) ?? 0,
    frames: frames.length,
    bones: declared - 1,
    t, r, cues,
  };
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
/** `0x1A78 + ftol(obj+0x1370) % 0x32` -- `water.bin` 13..62. */
const ATTACHED_EFFECT_SLOTS: number[] =
  Array.from({ length: 0x32 }, (_, i) => 0x1a78 + i);

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
  // Class 0x14, the stage-2 boss: the two flipbooks
  // `Class14AdvanceMotionAndPublishPoints` (`FUN_00476AD0`) draws under bone
  // 1's matrix beside the bone's own part -- `state+0x7C` steps 0x2CB..0x2ED
  // and `state+0x88`, the weak point whose frame is the damage window,
  // 0x2EE..0x315. `boss2.bin` entries 2..76. The skeleton itself rides the
  // character path. Then the two splash strips its states and deaths spawn
  // through `SpawnPropStripEffect` (`FUN_0043FCA0`): kind 0, 0x1339..0x1356,
  // and kind 2, 0x0DD7..0x0E22 -- the strip object draws by slot.
  0x14: [
    ...Array.from({ length: 0x315 - 0x2cb + 1 }, (_, i) => 0x2cb + i),
    ...Array.from({ length: 0x1356 - 0x1339 + 1 }, (_, i) => 0x1339 + i),
    ...Array.from({ length: 0x0e22 - 0x0dd7 + 1 }, (_, i) => 0x0dd7 + i),
  ],
  // Class 0x40, the horde: the emerge prop `HordeEmergePropUpdate`
  // (`FUN_0043DD00`) draws twice (`komono_st1b.bin` 12, slot 0x17CC), the
  // member's ground shadow (`common.bin` 200, 0x10D0), and its death splash --
  // the ripple (`common.bin` 371, 0x1A38) and the thirty-frame splash strip
  // (`common.bin` 338..367, 0x15E4 + g_frame_counter % 30). The members
  // themselves are skeletons and ride the character path.
  // And stage 2 block 0x19's sheet, `komono_room.bin` 2 (0x10CF), which
  // `HordeDeformedPropUpdate` (`FUN_0043F010`) reshapes every frame.
  0x40: [0x17cc, 0x10d0, 0x1a38, 0x10cf,
         ...Array.from({ length: 30 }, (_, i) => 0x15e4 + i)],
  // Class 0x22, JUDGMENT's flier: the impact flipbook `Class22Death` leaves
  // at its landing (`Class22ImpactFlipbookUpdate`, `FUN_0049DEA0`: slot
  // `0x94 + n`, `common.bin` 25..39) and the walker's landing ring
  // (`Class23LandingRingUpdate`, `FUN_00491700`: slot `0x17C8`, `boss1q.bin`
  // 94). The walker is only ever made by the flier, so the flier carries both.
  0x22: [...Array.from({ length: 15 }, (_, i) => 0x94 + i), 0x17c8],
  // Class 0x42, the worm: `buyo.bin` 0..53, every slot its three routines
  // draw through `WormAssetDrawSlot` (`FUN_00430B90`) -- the body `0x85A`,
  // its shadow `0x85B`, the landing splat `0x85C..0x874` (which the lone
  // drop draws the first of), the halves `0x875`/`0x876` and their cut face
  // `0x877`, and the death strip `0x87A..0x88F`. The run travels whole, as
  // the owl's does. And the splash `SpawnHordeDeathSplash` (`FUN_0043E4C0`)
  // leaves where one dies, which is class 0x40's object and draws class
  // 0x40's slots: the ripple `0x1A38` and the strip `0x15E4..0x1601`.
  0x42: [...Array.from({ length: 0x88f - 0x85a + 1 }, (_, i) => 0x85a + i),
         0x1a38, ...Array.from({ length: 30 }, (_, i) => 0x15e4 + i)],
  // Classes 0x30 and 0x18 (whose update is `EnemyZombieUpdate` too): the
  // wake `ActorCheckWaterEntry` (`FUN_00456920`) leaves on an actor that
  // wades in -- `AttachedEffectThink` (`FUN_004083D0`) draws
  // `AssetDrawSlotWithAlpha(0x1A78 + n % 0x32)`, `water.bin` 13..62, a
  // fifty-cel cycle. See `game/effects/attached_effect.ts`.
  0x30: ATTACHED_EFFECT_SLOTS,
  0x18: ATTACHED_EFFECT_SLOTS,
  // Class 0x32, the stage-5 boss: every model its projectiles and its tasks
  // draw, in the world and under a light colour of their own, which
  // `render/slotmodels.ts` draws. The afterimage (`Class32AfterimageTick`,
  // `FUN_0047DC30`) draws `boss5.bin` 206, slot `0x5E5`; the rest are
  // `eff_boss5.bin`, which the fight's steps load: the body loop's twenty
  // cels `0xB4..0xC7` (`Class32BodyLoopEffectTick`, `FUN_0047E130`), the
  // hands effect's `0x127A..0x1299` (`Class32HandsEffectTick`,
  // `FUN_0047E2B0`), the projectile's `0xB02..0xB33`
  // (`Class32ProjectileDispatchAndDraw`, `FUN_0047EFA0`, and its trail), the
  // death burst's `0xC54..0xC68` (`Class32DeathBurstTick`, `FUN_00480700`)
  // and the exit effect's `0x7EF..0x815` (`Class32ExitEffectTick`,
  // `FUN_00480810`). The boss's own nodes ride the character path.
  0x32: [
    0x5e5,
    ...Array.from({ length: 0xc7 - 0xb4 + 1 }, (_, i) => 0xb4 + i),
    ...Array.from({ length: 0x1299 - 0x127a + 1 }, (_, i) => 0x127a + i),
    ...Array.from({ length: 0xb33 - 0xb02 + 1 }, (_, i) => 0xb02 + i),
    ...Array.from({ length: 0xc68 - 0xc54 + 1 }, (_, i) => 0xc54 + i),
    ...Array.from({ length: 0x815 - 0x7ef + 1 }, (_, i) => 0x7ef + i),
  ],
};

/**
 * Two runs of `common.bin` the owl's and the fish's tasks share: the ring
 * (371, slot `0x1A38`) with the thirty-frame strip that stands in it (338..367,
 * `0x15E4 + n`), and the thirty-frame splash (307..336, `0x1339 + n`).
 */
const CREATURE_RING_SLOTS: readonly number[] = [
  0x1a38, ...Array.from({ length: 30 }, (_, i) => 0x15e4 + i)];
const CREATURE_SPLASH_SLOTS: readonly number[] =
  Array.from({ length: 30 }, (_, i) => 0x1339 + i);

/**
 * The **sprite-effect** slots a stage's classes draw -- the ones
 * `render/effects.ts` clones from `slots_effect` rather than
 * `render/slotmodels.ts` from `slots_actor`.
 *
 * JUDGMENT's walker's sparks, which only its flier's presence brings.
 * `SpawnSpriteEffectsTowardEye` (`FUN_00407BC0`) runs kind 0x5B through
 * `0xAA4..0xAB6`, 0x5C through `0xA87..0xAA3` and 0x5D through
 * `0xAB7..0xAD3` -- `boss1q.bin`, which the fight's blocks load. The
 * Tower's, class 0x45, every one of which its routines draw themselves. The
 * owl's and the fish's effect tasks, classes 0x43 and 0x51.
 *
 * And what a class-0x30 body throws up and leaves behind, all of it
 * `common.bin`: its death and landing dust and splash
 * (`ZombieDeathEffectCueTick`, `ZombieDeathLandingEffect` -- sprite kinds
 * 0x46, `0x94..0xA2`, and 0x61, `0x1339..0x1356`), its water ring
 * (`SpawnWaterRing`, `0xE23`), and the ring task `SpawnGroundRingEffect`
 * opens under its corpse -- and under class 0x20's -- `0x1A38` and the
 * thirty-cel strip `0x15E4..0x1601`. And the bat's splash, class
 * 0x46's, which is the kind-0x61 run again.
 */
export const EFFECT_SLOTS_BY_CLASS: Record<number, number[]> = {
  0x22: Array.from({ length: 0xad3 - 0xa87 + 1 }, (_, i) => 0xa87 + i),
  0x30: [
    ...Array.from({ length: 0xa2 - 0x94 + 1 }, (_, i) => 0x94 + i),
    ...CREATURE_SPLASH_SLOTS, 0xe23, ...CREATURE_RING_SLOTS,
  ],
  0x20: [...CREATURE_RING_SLOTS],
  // The stage-3 boss's own: its intro card's pieces (view space), its
  // sparks, splashes, bite flashes, wake, path effects, the civilian's
  // shadow and the water mound. See `game/class45/tables.ts`.
  0x45: [...BOSS3_EFFECT_SLOTS],
  // The stage-6 boss's: every slot its routines draw by hand -- its own
  // nodes and shells, the satellites, the children's nodes, the flares and
  // the tasks. See `CLASS2D_EFFECT_SLOTS` in `game/class2D/state.ts`.
  0x2d: [...CLASS2D_EFFECT_SLOTS],
  // The owl's three tasks (`game/effects/owl.ts`): the feather
  // (`OwlFeatherDriftAndDraw`, `FUN_00448A80`: `owl.bin` 51), the ground
  // impact ring and its strip (`OwlGroundImpactRingPulse`, `FUN_00448CE0`:
  // `common.bin` 371 and 338..367) and the water splash
  // (`OwlWaterSplashFlipbookStep`, `FUN_00448800`: `common.bin` 307..336).
  0x43: [0xbf0, ...CREATURE_RING_SLOTS, ...CREATURE_SPLASH_SLOTS],
  // The fish's (`game/effects/fish.ts`): the splash (`WaterSplashUpdate`,
  // `FUN_00439F10`: the same 307..336), the surface ring
  // (`SurfaceRingDrawAndFade`, `FUN_0043A000`: `fish.bin` 2) and the ring
  // task its corpse leaves (`RingEffectSpread`, `FUN_00407E30`: 371 and
  // 338..367). The blood cloud's cels are the shot path's, already carried.
  0x51: [...CREATURE_SPLASH_SLOTS, 0xb71, ...CREATURE_RING_SLOTS],
  // Class 0x46, the bat: the splash a shot one falls into.
  // `BatSplashUpdate` (`FUN_0042F930`) draws `AssetDrawSlot(0x1339 + n)` for
  // n in 0..0x1D -- `common.bin` 307..336, the run class 0x30, the owl and
  // the fish draw too -- under a bare translation. Listed for the class all
  // the same: `effectSlotEntry` carries a slot once however many ask, and a
  // stage with bats and none of those would otherwise have no splash. See
  // `game/class46/splash.ts`.
  0x46: [...CREATURE_SPLASH_SLOTS],
  // Class 0x10, the civilian: the marker `SpawnLifeGrantedMarker`
  // (`FUN_0048DF10`) raises when her held item pays a life --
  // `obj+0x1F4 = 0x1256 + player`, `common.bin` 303 and 304 -- which
  // `LifeGrantedMarkerUpdate` draws in camera space. See
  // `game/class10/life_marker.ts`.
  0x10: [0x1256, 0x1257],
  // Class 0x33, the two sprite kinds its ported routines throw:
  // `SpawnSpriteEffectFromParams`' `case 0x44:` run `0xFD4..0x1031`, all 94 of
  // `eff_dokan.bin` (`ScriptedEffectAtCameraCue33`, `FUN_00433B00`, and
  // `ScriptedCarrierUpdate33`, `FUN_004331D0`, on every slot but `0x1B0E`),
  // and its `case 0x45:` run `0x174A..0x1785`, all 60 of `eff_shop.bin`
  // (the carrier on slot `0x1B0E`). Stage 2's script loads `eff_dokan.bin` in
  // the steps that spawn them, and stage 5's `eff_shop.bin`.
  0x33: [
    ...Array.from({ length: 0x1031 - 0xfd4 + 1 }, (_, i) => 0xfd4 + i),
    ...Array.from({ length: 0x1785 - 0x174a + 1 }, (_, i) => 0x174a + i),
  ],
  // Class 0x32, the stage-5 boss: sprite kind 0x50, `0x23A..0x248`, the
  // spark `Class32ChargeShotBone` (`FUN_0047CE10`) throws off a damaging hit.
  // Its other kind, 0x35, is the shot path's `0xE25` run. The models its
  // projectiles and tasks draw are {@link ACTOR_SLOTS}'.
  0x32: [
    ...Array.from({ length: 0x248 - 0x23a + 1 }, (_, i) => 0x23a + i),
  ],
};

/** {@link EFFECT_SLOTS_BY_CLASS} for the classes a stage spawns. */
export function classEffectSlots(spawnClasses: readonly number[]): number[] {
  const out: number[] = [];
  for (const cls of new Set(spawnClasses)) {
    for (const slot of EFFECT_SLOTS_BY_CLASS[cls] ?? []) out.push(slot);
  }
  return out;
}

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
 * The extra asset slots a stage's **character types** ask for.
 *
 * One entry today: character type `0x0A`, `znjoe`, whose creature draws forty
 * frames of `znjoe.bin` that no skeleton node and no damaged variant names.
 * See {@link BODY_CREATURE_SLOTS} for why the key is a character type and not
 * a spawn class, and `game/body_creature.ts` for what draws them.
 *
 * They ride `slots_effect` rather than `slots_actor` because of the **space**
 * they are drawn in: `BodyCreatureUpdate` ends `MatrixLoadIdentity` +
 * `MatrixTranslate`, which is the camera's own space, and `render/effects.ts`
 * is the layer that already holds a group there — the muzzle flash and the
 * blood hang off the same one. `render/slotmodels.ts` places its clones in
 * the world.
 */
export function bodyCreatureDrawSlots(
    charTypes: Iterable<number>): number[] {
  const out: number[] = [];
  for (const t of charTypes) {
    for (const slot of BODY_CREATURE_SLOTS[t] ?? []) out.push(slot);
  }
  return out;
}

/**
 * The asset slots a stage's **carried props** are drawn with.
 *
 * `ZombieStateCarryProp` (`FUN_0045B380`) allocates an object with no class
 * id and `CarriedPropInit` (`FUN_00442740`) picks its type out of the state-37
 * script's `+0x00`, so the slot is a property of the script and not of any
 * class or character. They ride `slots_effect` because the prop is drawn in
 * two spaces -- world while it is held and thrown, the camera's once it has
 * hit (`CarriedPropStuckToScreen`, `FUN_00444160`) -- and `render/effects.ts`
 * is the layer that holds a group in each. See `game/carried_prop.ts`.
 */
export function carriedPropDrawSlots(
    placements: readonly Record<string, unknown>[]): number[] {
  const out: number[] = [];
  for (const p of placements) {
    for (const k of ["target_script", "attack_script"]) {
      const s = p[k] as { state?: number; head?: { prop_type?: number } }
        | null | undefined;
      if (s?.state !== 37) continue;
      for (const slot of CARRIED_PROP_SLOTS[s.head?.prop_type ?? -1] ?? []) {
        if (!out.includes(slot)) out.push(slot);
      }
    }
  }
  return out;
}

/**
 * The asset slots a stage's class-0x33 **selector-4 descriptors** ask for.
 *
 * Not in {@link ACTOR_SLOTS}, for the same reason {@link humanoidDrawSlots} is
 * not: the slot is a property of the descriptor and not of the class.
 * `ScriptedPushableUpdate33` (`FUN_00433B70`) writes `tail+0x00` to
 * `obj+0x13F0` and draws it, and the two shipped spawns both name 4196 --
 * `komono_7.bin` part 0, a chair. Keying it on the class would put a chair in
 * all six bundles for the benefit of one room.
 *
 * Without this the placement travels, the actor is made, the push works and
 * the client has **no geometry to clone**, which is class 0x52's old bug from
 * the other side: there it was a model nothing could hit, here it would be a
 * chair nothing could see.
 */
export function sceneryDrawSlots(
    placements: readonly { class33_push?: { slot?: number } | null }[],
): number[] {
  const out: number[] = [];
  for (const p of placements) {
    const slot = p.class33_push?.slot;
    if (typeof slot === "number" && slot > 0 && !out.includes(slot)) {
      out.push(slot);
    }
  }
  return out;
}

/**
 * The asset slots a stage's canal water tasks can draw.
 *
 * `WaterSurfaceUpdate` (`FUN_0046E3A0`) draws its placement's tile, the
 * tile's pair, and whatever a swap turns it into -- `WATER_SURFACE_ALSO_DRAWS`
 * lists them. Most of them are also stage geometry, which
 * `render/water_surfaces.ts` prefers; the ones in `komono_boss2.bin` and
 * `komono_venis.bin` are loaded by `asset_load_polfile` and are nobody's
 * region, so without this the boss arena and the stage-2 canal's west end
 * had no water to draw at all.
 */
export function waterSurfaceDrawSlots(
    placements: readonly Record<string, unknown>[]): number[] {
  const out: number[] = [];
  for (const pl of placements) {
    if (pl.container !== "water_surface") continue;
    const first = pl.slot as number;
    for (const slot of [first, ...WATER_SURFACE_ALSO_DRAWS[first] ?? []]) {
      if (!out.includes(slot)) out.push(slot);
    }
  }
  return out;
}

/**
 * The asset slots a stage's class-0x13 **descriptors** draw.
 *
 * `ScriptedPropUpdate13` (`FUN_0043FE90`) draws `obj+0x1F4`, which
 * `ScriptedPropInit13` (`FUN_0043FE10`) copies from the descriptor tail's
 * `+0x00` -- so, like {@link sceneryDrawSlots}, the model is a property of the
 * spawn and not of the class. Twenty-three spawns over three stages name
 * their own slots, and keying on the class would carry every one of them
 * into every bundle.
 *
 * Stage 3's boat only ever had geometry because its slot, `0x1A37`, is also
 * {@link HUMANOID_VARIANT3_SLOT} and so travelled for class 0x25. Stage 2's
 * boat (`0x1A36`, `komono_boat.bin[1]`) had none: the actor was built, rode
 * its path, and the client had nothing to clone.
 */
export function scriptedPropDrawSlots(
    placements: readonly {
      class13?: { slot?: number; behaviour?: number; selector?: number } | null;
    }[],
): number[] {
  const out: number[] = [];
  for (const p of placements) {
    // Only a prop whose behaviour the port runs: `g_prop_behaviours[0]` is
    // `NoOpStub`, a static model, and `[8]` is a carrier whose selector must
    // be one of {@link CARRIER_SELECTORS_PORTED}. Stage 4's seven carriers take
    // selectors 2..9; selector 3's (`0x00440AD0`, slot `0x966`) would
    // otherwise stand at its descriptor while the game drives it -- right
    // geometry, wrong behaviour, which is the reason
    // `GENERIC_DESCRIPTOR_SLOT` holds its unported types back too.
    const t = p.class13;
    const ported = t?.behaviour === 0
      || (t?.behaviour === 8 && CARRIER_SELECTORS_PORTED.has(t.selector ?? -1));
    if (!ported) continue;
    const slot = t?.slot;
    if (typeof slot === "number" && slot > 0 && !out.includes(slot)) {
      out.push(slot);
    }
    // ...and every slot the carrier routine draws beside the prop: the wake,
    // selector 0's splash, selector 1's strip and bow effect.
    if (t?.behaviour === 8) {
      for (const s of CarrierDrawSlots(t.selector ?? -1)) {
        if (!out.includes(s)) out.push(s);
      }
    }
  }
  return out;
}

/**
 * The parts of every effect a ported class-0x13 carrier hands
 * `EffectDrawUnlit` (`FUN_0040DD90`) -- selectors 4 and 7's effect `0x15`,
 * 5 and 8's `0x18` -- which `render/slotmodels.ts` clones from `slots_actor`
 * with the rest of the carrier's draws. A node with slot 0 is a pure
 * transform.
 */
export function carrierEffectDrawSlots(
    tables: ExeTables,
    placements: readonly {
      class13?: { behaviour?: number; selector?: number } | null;
    }[],
): number[] {
  const out: number[] = [];
  for (const p of placements) {
    const t = p.class13;
    if (t?.behaviour !== 8 || !CARRIER_SELECTORS_PORTED.has(t.selector ?? -1)) {
      continue;
    }
    for (const [effect] of CarrierEffects(t.selector ?? -1)) {
      for (const n of propslib.effectTree(tables, effect)) {
        if (n.slot && !out.includes(n.slot)) out.push(n.slot);
      }
    }
  }
  return out;
}

/**
 * The effect trees class 0x13's carriers play, one record per effect **and
 * motion**, keyed `"<effect>@<motion>"`: a carrier's ride block plays motion
 * `0x1CD` and then `0x1CC` through one effect id (or the reverse), which the
 * by-id keys {@link scriptFlagEffectsJson} and the others write cannot hold.
 * `game/effect_draw.ts`'s `EffectDefFor` reads either shape. No sound cues:
 * the carriers play their own.
 */
export async function carrierEffectsJson(
    stage: Stage,
    placements: readonly {
      class13?: { behaviour?: number; selector?: number } | null;
    }[]): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const p of placements) {
    const t = p.class13;
    if (t?.behaviour !== 8 || !CARRIER_SELECTORS_PORTED.has(t.selector ?? -1)) {
      continue;
    }
    for (const [effect, motion] of CarrierEffects(t.selector ?? -1)) {
      const key = `${effect}@${motion}`;
      if (out[key] !== undefined) continue;
      const def = await effectDefJson(stage, effect, motion,
                                      "hod2lib.bundle.carrier_effects", []);
      if (def) out[key] = def;
    }
  }
  return out;
}

/**
 * The asset slots a stage's class-0x12 descriptors draw: the one each waits
 * on and the strip `ScriptedPropUpdate12` (`FUN_0043FA60`) runs through once
 * its flag is up, `AssetDrawSlot(__ftol(sub+0x14))` on every frame between.
 *
 * Like {@link scriptedPropDrawSlots}, a property of the spawn and not of the
 * class: stage 1's door and stages 2 and 5's `sanbasi.bin` strip name their
 * own slots, and `characters.placements` carries a class-0x12 placement only
 * for a behaviour the port runs.
 */
export function flagStripPropDrawSlots(
    placements: readonly {
      class12?: { slot?: number; first?: number; last?: number } | null;
    }[],
): number[] {
  const out: number[] = [];
  for (const p of placements) {
    const t = p.class12;
    if (!t) continue;
    for (const s of ScriptedProp12DrawSlots({
      slot: t.slot ?? 0, first: t.first ?? 0, last: t.last ?? 0,
    })) {
      if (!out.includes(s)) out.push(s);
    }
  }
  return out;
}

/**
 * The asset slots a stage's class-0x26 spawns draw through a routine the port
 * runs: `Class26Subtype67Draw` (`FUN_0048FB40`) and
 * `Class26Subtype67DrawOrKill` (`FUN_0048FD00`) name seven between them,
 * `PUSH` immediates every one, and the renderer clones them from
 * `slots_actor`. Keyed on the spawn's subtype, `obj+0x11C`, because that is
 * what the installer switches on: stage 6's two are the only spawns that
 * take those routines, and only its bundle carries the models.
 */
export function vehicleDrawSlots(
    spawnRecords: readonly { cls: number; hp: number }[]): number[] {
  const out: number[] = [];
  for (const r of spawnRecords) {
    if (r.cls !== 0x26) continue;
    for (const s of Class26DrawSlots(r.hp)) if (!out.includes(s)) out.push(s);
  }
  return out;
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
    routine: "asset-slot actor draws (classes 0x13, 0x14, 0x32, 0x40, 0x42, "
      + "0x43, 0x51, 0x52; class 0x25 variant 3; class 0x26 subtypes 6 and 7; "
      + "class 0x33 selector 4; class 0x41 type 1's water tiles; the wake "
      + "classes 0x30 and 0x18 leave in the water)",
    worldSpace: false,
    parts: parts.map(([p]) => p),
    note: "actor models drawn by asset slot; hidden, cloned per live actor",
  };
  return {
    rig, routes: [], world: false, placements: [],
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
 * And one thing a bullet does not produce: the eleven full-screen **damage
 * overlays** `DamageOverlayUpdateAndDraw` (`FUN_00417300`) draws when the
 * player is hit, `g_damage_overlay_slots` 0x931..0x93B, all `common.bin`.
 * They are drawn exactly the way the muzzle flash is -- camera space, one
 * `AssetDrawSlot` -- so they ride the same rig.
 *
 * What is **not** here, deliberately: the boss and set-piece kinds of
 * `SpawnSpriteEffectFromParams`' switch — 0x41, 0x44, 0x45, 0x50, 0x53, 0x5A,
 * 0x5B, 0x5C, 0x5D — which live in `water_hamon`, `eff_dokan`, `eff_shop`,
 * `eff_2`, `eff_org5b` and `boss1q`, and which nothing on the shot path can
 * reach. Nor the splash, 0x61, and the dust, 0x46: those are `common.bin`
 * (307..336 and 25..39). Each of these that a ported class throws rides
 * {@link EFFECT_SLOTS_BY_CLASS} with that class -- 0x44 and 0x45 with class
 * 0x33, 0x5B..0x5D with class 0x22. Kind 0x51 is the one exception a shot could reach — a
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
  [0x0931, 0x093b],    // the damage overlays -- g_damage_overlay_slots
];

/**
 * The round Original Mode's weapon kind 5 fires: `PlayerShotEffectsThink`
 * (`FUN_00416B00`) draws `AssetDrawSlot(0x109D)` for a live
 * `g_shot_tracer_ring` record of kind 5 and for nothing else (`PUSH 0x109D`
 * at `0x00416DA1`, behind `CMP EAX, 0x5` at `0x00416CBE`), and
 * `AssetQueueLoadSlot` (`FUN_0041D5D0`) is what makes it resident, from
 * `LoadSceneAndReset`. `etc_1.bin` entry 41. Carried in an Original Mode
 * bundle's effect templates, which is where `render/effects.ts` draws the
 * ring from; it used to reach the page only as the rig `obj_416b00`, which
 * the player drew from stage load at `op_` 0x194's own pose -- in front of
 * Goldman's desk.
 */
export const ORIGINAL_WEAPON5_ROUND_SLOT = 0x109d;

/**
 * Whether this stage's script spawns the trunk, class 0x6E: `spawn_simple`
 * `{0x6E, 0}` at `st1evtbl.bin` `0x9EC`, in the step Original Mode enters
 * stage 1 at. Asked of the program, not of the stage number, so the answer
 * is the script's.
 */
export function stageSpawnsItemSelect(prog: Program): boolean {
  for (const b of prog.liveBlocks()) {
    for (const st of b.steps) {
      for (const o of st.ops) {
        const simple = (o.detail.simple as { class: number }[]) ?? [];
        if (simple.some((r) => r.class === SpawnClass.ItemSelect)) return true;
      }
    }
  }
  return false;
}

/**
 * The models Original Mode's weapons draw, for a stage that is Original Mode:
 *
 * * {@link ORIGINAL_WEAPON5_ROUND_SLOT}, BASS LURE's round;
 * * GRENADE's blast, sprite effect 0x53's flipbook, which `MarkActorShot`
 *   (`FUN_00404DB0`) throws on every hit with weapon kind 3;
 * * BULLET BLOW's ring, `AssetDrawSlot(frame + 0xA6F)` for frames 0 to 0x17
 *   of a kind-4 `g_shot_weapon_ring` record (`PlayerShotEffectsThink`,
 *   `FUN_00416B00`).
 *
 * The exe makes the last two resident only for the weapon a player carries
 * -- `PolFileQueueLoad(0x3D)` for kind 3 and `(0x41)` for kind 4, in
 * `FUN_0048A140` as a stage loads. A bundle is exported before any loadout
 * exists, so it carries both. Before the trunk was ported nothing could equip
 * either, and neither was here.
 */
export function originalWeaponEffectSlots(original: boolean): number[] {
  if (!original) return [];
  const out = [ORIGINAL_WEAPON5_ROUND_SLOT];
  const [lo, hi] = IMPACT_SPRITE_BY_MATERIAL[SpriteEffectKind.OriginalBlast];
  for (let slot = lo; slot <= hi; slot++) out.push(slot);
  for (let f = 0; f <= WEAPON_LAST_FRAME; f++) out.push(WEAPON_FIRST_SLOT + f);
  return out;
}

/**
 * A hidden rig holding the models the shot effects flip through.
 *
 * Same shape and same reason as {@link actorSlotEntry}: one part per asset
 * slot, hidden, cloned by the client. `render/effects.ts` is what clones them.
 */
export async function effectSlotEntry(
    stage: Stage, cache: AssetCache,
    extra: readonly number[] = []): Promise<RigInstance | null> {
  const want: number[] = [];
  for (const [lo, hi] of EFFECT_SLOT_RANGES) {
    for (let slot = lo; slot <= hi; slot++) {
      if (!want.includes(slot)) want.push(slot);
    }
  }
  // Slots a **character type** in this stage asks for rather than the shot
  // path -- see {@link bodyCreatureDrawSlots}.
  for (const slot of extra) if (!want.includes(slot)) want.push(slot);
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
    routine: "the shot effects: blood, muzzle flash, tracer, impacts; and "
      + "the creature znjoe releases",
    worldSpace: false,
    parts: parts.map(([p]) => p),
    note: "one model per animation frame; hidden, cloned per live effect",
  };
  return {
    rig, routes: [], world: false, placements: [],
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
  // A stacked group prop's fifteen pieces, both tables: which one a shatter
  // draws is the prop's `+0x324`, a run-time value (Training's one-shot
  // targets take `_b`), so both travel with every stage.
  const shatter = stage.tables.shatterPieces();
  for (const slot of [...shatter.slots_a, ...shatter.slots_b]) {
    if (!want.includes(slot)) want.push(slot);
  }
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
  // The collectibles' models are not in the descriptor at all:
  // `PickOriginalModeItem` overwrites `obj+0x28C` from the item record the
  // row names, so what travels is every model of every id the placed rows can
  // draw, and the two pickup strips.
  const original = originalItemsJson(stage.tables, placements, stage.scene);
  for (const slot of originalItemSlots(original)) {
    if (!want.includes(slot)) want.push(slot);
  }
  for (const pl of placements) {
    if (pl.container !== "flicker_light") continue;
    for (const slot of FLICKER_LIGHT_SLOTS) {
      if (!want.includes(slot)) want.push(slot);
    }
  }
  // Class 0x44 selector 11 draws its descriptor's slot and nothing else, so
  // the slot travels the same way the three descriptor-slot generic types' do.
  // Without this the prop is placed, `DrawSlotFor` asks for `0xA58`, and the
  // renderer has nothing to clone -- which is exactly how stage 3's roller
  // shutter came to be missing from a level that placed it.
  // The table constructors' literals, and every slot a type-40 sub-kind this
  // stage places can draw -- whole, shot, its second draw and the forty
  // pieces it bursts into. Without them the objects are placed and the
  // renderer has nothing to clone, which is how stage 1's church came to have
  // bare pews.
  // Constructors 50 and 66 draw whatever their table's rows name, so what
  // travels is every slot of the table this placement picked.
  for (const pl of placements) {
    const slots = pl.container === "fragment"
      ? fragmentSlots(stage.tables, (pl.sub_kind as number) ?? 0)
      : pl.container === "table50" || pl.container === "table66"
        ? propTableSlots(stage.tables,
                         pl.container === "table50" ? TABLE50_TYPE
                                                    : TABLE66_TYPE,
                         (pl.field_1f4 as number) ?? 0) ?? []
        : TABLE_SLOTS[pl.container as string] ?? [];
    for (const slot of slots) if (!want.includes(slot)) want.push(slot);
  }
  // ...and selector 13 the same: `RiseToHeightUpdate` draws its descriptor's
  // slot, once, and names no other. Stage 5's `0x1892` and twelve of stage
  // 6's are only ever drawn through it. And selector 14's
  // `PropDrawOnlySelector14` (`FUN_004758E0`), whose `0x10AE` in stages 3
  // and 4 no instruction names.
  // ...and every other object that draws its descriptor's slot and nothing
  // else: selectors 9 and 12, and the story-mode switch -- whose model never
  // travelled, so the stage's copy at the world's origin was the only one
  // (stage 3's `0x1853`). Selector 12 draws a second model only for slot
  // `0x189C`, which no shipped spawn names; constructor 47 draws a literal.
  for (const pl of placements) {
    const own = pl.container === "rising_door"
      || pl.container === "rise_to_height" || pl.container === "flag_lifted"
      || pl.container === "slide_on_flag" || pl.container === "story_switch"
      || pl.container === "draw_only_14";
    const slots = own ? [pl.slot as number] : [];
    if (pl.container === "slide_on_flag"
        && pl.slot === SLIDE_SECOND_DRAW_SLOT) {
      slots.push(SLIDE_SECOND_SLOT);
    }
    if (pl.container === "type47") slots.push(TYPE47_SLOT);
    for (const slot of slots) {
      if (slot && !want.includes(slot)) want.push(slot);
    }
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
    rig, routes: [], world: false, placements: [],
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
      // The script addresses of the spawns whose class handler installs this
      // routine. `null` means nothing links the rig to a spawn and the player
      // shows it from stage load, as before; a list -- even an empty one --
      // means the object exists only once one of those spawns has run.
      spawn_ats: inst.spawnAts ?? null,
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
  const say = opts.progress ?? (() => {});
  // The count belongs to this stage, so it starts here rather than at the top
  // of the process. A run builds up to twelve of these and a single running
  // total would say nothing about which one came out short.
  degraded.reset();
  const name = stage.name;
  const outDir = name;
  const tables = stage.tables;
  const cache = new AssetCache(stage);

  // The rain, the props, the rigs, the characters and the breakables each
  // need a `Program`. They are identical by construction and each costs a
  // full evt walk, so this builds one and hands it round.
  const prog = await Program.create(stage);
  // The trunk (class 0x6E) is spawned by one step in the game, stage 1's
  // Original entry; the stage that has it gets its sprites and models.
  const trunk = stageSpawnsItemSelect(prog);
  const evt = prog.evt;
  const spawnRecords = evt ? evtlib.spawns(evt) : [];

  say(`  ${name}: geometry`);
  const geo = await stage.geometry();
  let parts = geo.parts;
  let modelRegions = geo.modelRegions;

  // Rig geometry travels in the glTF as one scene node per route, tagged
  // `hod2_path_slot`, which the client drives from the raw `op_` curve.
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
  const carriedEffects = await carriedPropEffectsJson(
    stage, charPlaces as unknown as Record<string, unknown>[]);
  const flagEffects = {
    ...(await scriptFlagEffectsJson(stage, placements)),
    ...carriedEffects,
  };
  const effectDefs = {
    ...flagEffects,
    ...(await genericPropEffectsJson(stage, placements, flagEffects)),
  };
  const brk = await breakableSlotEntry(stage, placements, effectDefs, cache);
  // Decoded here rather than beside the rest of the script json below,
  // because the glTF needs to know whether any class-0x25 descriptor asks for
  // the variant-3 model before it writes the hidden `slots_actor` rig.
  const humanoids = evt ? scriptedHumanoidsJson(evt, spawnRecords) : {};
  const act = await actorSlotEntry(
    stage, spawnRecords.map((r) => r.cls),
    [...humanoidDrawSlots(humanoids), ...sceneryDrawSlots(charPlaces),
     ...scriptedPropDrawSlots(charPlaces),
     ...carrierEffectDrawSlots(tables, charPlaces),
     ...flagStripPropDrawSlots(charPlaces),
     ...waterSurfaceDrawSlots(placements),
     ...vehicleDrawSlots(spawnRecords)],
    cache);
  const eff = await effectSlotEntry(stage, cache, [
    ...bodyCreatureDrawSlots(charDefs.keys()),
    ...carriedPropDrawSlots(charPlaces as unknown as Record<string, unknown>[]),
    // ...and the break effects' node models, which `render/effects.ts` draws
    // for the same object once it has broken.
    ...Object.values(carriedEffects).flatMap((d) =>
      ((d as { nodes: { slot: number }[] }).nodes)
        .map((n) => n.slot).filter((x) => x > 0)),
    // ...and the game-over route map's: the figures' ground disc and the two
    // footprints, drawn in view space by `render/game_over_scene.ts`.
    ROUTE_FIGURE_SHADOW_SLOT, ...ROUTE_MARK_SLOTS,
    // ...and the boss-name banner's cards, for the classes this stage spawns
    // that make one: drawn in view space too, by `render/effects.ts`.
    ...bannerCardSlots(spawnRecords.map((r) => r.cls)),
    // ...and the stage-4 boss's carried prop and hit mark, which
    // `render/effects.ts` draws on its bones and in flight.
    ...Boss4EffectSlots(spawnRecords.map((r) => r.cls)),
    // ...and the sprite effects a class draws off the shot path.
    ...classEffectSlots(spawnRecords.map((r) => r.cls)),
    // ...and Original Mode's weapons: the weapon-5 round on the tracer
    // ring, the grenade's blast and BULLET BLOW's ring.
    ...originalWeaponEffectSlots(stage.original),
    // ...and the shell screens' idle dimmer, which the options screen draws
    // over itself after five minutes of nothing held.
    SCREEN_IDLE_DIM_SLOT,
    // ...and the result card's `result.bin` glyphs, drawn in view space by
    // `render/view_slots.ts`, for a stage that places the card.
    ...(prog && stagePlacesResultCard(prog) ? RESULT_GLYPH_SLOTS : []),
    // ...and the trunk and its lid, `car_org.bin` 1 and 2, drawn in the world
    // by `render/view_slots.ts`, where the trunk is spawned.
    ...(trunk ? ITEM_SELECT_SLOTS : []),
  ]);
  // Which materials draw blood, so the client can offer the colour the game's
  // own option offers. See `bloodTexturePredicate`.
  const isBloodTexture = bloodTexturePredicate(tables);
  const info = await gltf.exportLevel(name, parts, outDir, sink, deflate, {
    rigs: [...rigInstances, ...charEntries, ...propEntries,
           ...(brk ? [brk] : []), ...(act ? [act] : []),
           ...(eff ? [eff] : [])],
    modelRegions,
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
  // `bundleJson` throws on a `NaN` or an `Infinity` rather than writing it as
  // `null`: a curve that decoded to garbage fails the export here instead of
  // loading as a curve of nulls.
  await sink.write(`${outDir}/${name}.cam.json`, bundleJson(camJson));

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
  // Class 0x42's `.rdata` and the two motions its split halves follow, for
  // the one stage that spawns it. Only then: the halves are a motion bank's
  // frames, and a stage with no worm has no reader for them.
  if (spawnRecords.some((r) => r.cls === 0x42)) {
    (scriptJson.characters as Record<string, unknown>).class42 =
      await class42Tables(stage);
  }
  scriptJson.props = propslib.propsJson(tables, hinges, statics);
  // The carriers' effects ride in the same map, and after
  // `breakableSlotEntry` has taken its node slots: theirs travel in
  // `slots_actor`, which is what draws them.
  scriptJson.breakables = breakablesJson(
    tables, placements,
    { ...effectDefs, ...(await carrierEffectsJson(stage, charPlaces)) },
    stage.scene);
  scriptJson.set_pieces = evt ? setPiecesJson(evt, spawnRecords) : {};
  scriptJson.humanoids = humanoids;
  scriptJson.civilians = evt ? civiliansJson(tables, evt, spawnRecords) : {};
  // The game-over screen's `.rdata`, and every sprite the game draws by id:
  // the HUD's readouts, the continue screen and the credit line, the boss
  // health bar and name banners, the logo, and the route map's 4 x 75 tiles.
  const gameOver = tables.gameOverTables();
  scriptJson.game_over = gameOver;
  // Class 0x19's `.rdata`, and the doors of the carrier it rides in on. Every
  // stage gets them, as every stage gets `game_over`: they are the exe's, not
  // the stage's, and a few kilobytes is not worth a per-stage decision.
  scriptJson.boss4 = tables.boss4Tables();
  scriptJson.carrier_door_yaw = tables.carrierDoorYaw();
  // Class 0x2D's `.rdata`, on the same terms: the stage-6 boss's waypoints,
  // picks, per-rank timings, path segments and child maps. Stage 5's cameo
  // reads none of it; stage 6's fight reads all of it.
  scriptJson.class2d = tables.class2dTables();
  // The result card's `.rdata`, one block for the whole game as `game_over`
  // is: the figures' records and lists, their attachment lists, the glyph
  // strings, the life bonus and the accuracy bonus.
  scriptJson.result_card = tables.resultCardTables();
  const routeTiles = (gameOver.route_tiles as number[]).flatMap((base) =>
    Array.from({ length: ROUTE_TILES_PER_SCREEN }, (_u, i) => base + i));
  // The options screen (app state 0x0C): one block for the whole game, as
  // `game_over` is, and the sprites its tables name beside its immediates.
  const options = tables.optionsTables();
  scriptJson.options = options;
  // Original Mode's `.rdata`, one block for the whole game as `options` is:
  // the weapon records, the fire and ammo-readout rows, the trunk's tables.
  const originalMode = tables.originalModeTables() as {
    ammo_hud_rows: { sprite: number }[]; list_sprites: number[];
  };
  scriptJson.original_mode = originalMode;
  const optionTableSprites = [
    ...(options.glyphs as number[]), ...(options.crosshair_sprites as number[]),
    ...(options.sight_speed_sprites as number[]),
  ].filter((id) => id > 0);
  scriptJson.screen_sprites = await screenSpritesJson(
    tables, stage.source, deflate,
    [...HUD_READOUT_SPRITES, ...CONTINUE_SCREEN_SPRITES,
     ...BOSS_HP_BAR_SPRITES, ...BOSS_BANNER_SPRITES, ...BOSS3_CARD_SPRITES,
     ...GAME_OVER_LOGO_SPRITES, ...routeTiles,
     ...OPTIONS_SCREEN_SPRITES, ...optionTableSprites,
     // `OriginalItemBannerUpdate`'s two sprites, for the ids this stage's
     // collectibles can be.
     ...originalItemSprites(originalItemsJson(tables, placements,
                                              stage.scene)),
     // The result card's frame, for a stage that places the card.
     ...(prog && stagePlacesResultCard(prog) ? RESULT_CARD_SPRITES : []),
     // Original Mode's bullets, `HudDrawAmmoAndReloadPrompt`'s row by fire
     // mode, for an Original stage.
     ...(stage.original
       ? originalMode.ammo_hud_rows.map((r) => r.sprite) : []),
     // ...and the trunk's screen, where it is spawned.
     ...(trunk ? [...ITEM_SELECT_SPRITES, ...originalMode.list_sprites] : [])]);
  await sink.write(`${outDir}/${name}.script.json`, bundleJson(scriptJson));

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
  // The level geometry's triangles, which is what the glTF holds of it:
  // `exportLevel` writes every triangle of every mesh it is handed.
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
 * **The digest is imported, not recomputed.** This exporter is compiled
 * against the declarations in `web/src/bundle/`, so `schema_hash.ts` --
 * generated from them and committed -- is the digest by construction. A
 * bundle built in the browser therefore agrees with the client that built
 * it, with nothing to keep in step.
 */
export async function writeManifest(
    sink: BundleSink, stages: Record<string, unknown>[],
    gameDir: string, built: string,
    notes: Record<string, unknown> | null = null): Promise<string> {
  const doc: Record<string, unknown> = {
    format: BUNDLE_FORMAT,
    schema: { hash: SCHEMA_HASH, files: SCHEMA_FILES },
    // Which exporter wrote it, so a bundle can be told it is out of date
    // rather than merely unreadable. See `web/tools/gen/builder_hash.ts`.
    builder: { hash: BUILDER_HASH, files: BUILDER_FILES },
    tool: "hod2lib",
    built,
    game_dir: gameDir,
    fps: 60,
    // Recovered from SetupSceneProjection. A compile-time constant for the
    // whole game -- there is no zoom and no per-camera FOV.
    projection: {
      yfov_deg: 41.100,
      yfov_bams: gltf.CAM_FOV_BAMS,
      aspect: gltf.CAM_ASPECT,
      znear: gltf.CAM_ZNEAR,
      zfar: gltf.CAM_ZFAR,
    },
    stages,
  };
  if (notes) doc.notes = notes;
  // Indented, because it is the one file a person opens to see what a bundle
  // holds; the stage files are compact.
  await sink.write("manifest.json", bundleJson(doc, 1));
  return "manifest.json";
}

/**
 * The route map's tiles per 640x480 screen: `RouteMapDrawTask`
 * (`FUN_00461180`) draws 5 columns by 15 rows of 128x32, id `base + row * 5 +
 * col`.
 */
const ROUTE_TILES_PER_SCREEN = 5 * 15;

/**
 * The screen sprites the game draws, as images the right way up.
 *
 * `DrawScreenSprite` (`0x0041C6D0`) names a sprite by id; the id picks a
 * `tex/` bank and a global texture slot out of two tables in the exe
 * (`ExeTables.screenSprite`), the slot picks the bank's descriptor. The HUD's
 * are PAL4 textures of `tex/scr_common.bin` with their palette out of
 * `g_texture_palette_table`; the game-over logo's are `scr_gameover.bin` and
 * the route map's tiles `scr_bunki.bin`, both direct colour. The quad the game
 * draws puts texture row 0 at the sprite's bottom edge
 * (`DrawSpriteQuadCommand`, `0x004A7AB0`), so the image is flipped here and
 * the client draws it as it comes.
 *
 * In `script.json` rather than beside it: the same few hundred small images in
 * every stage, and the loader and its cache already carry that file. A sprite
 * that will not resolve is left out and recorded.
 */
export async function screenSpritesJson(tables: ExeTables,
                                        source: AssetSource, deflate: Deflate,
                                        ids: readonly number[]):
    Promise<Record<string, { w: number; h: number; png: string }>> {
  const out: Record<string, { w: number; h: number; png: string }> = {};
  const banks = new Map<string, Uint8Array | null>();
  for (const id of ids) {
    const key = String(id);
    if (key in out) continue;
    const hit = tables.screenSprite(id);
    if (!hit) {
      degraded.note("screenSpritesJson", `sprite 0x${id.toString(16)}`,
                    "that screen sprite", "no bank or slot");
      continue;
    }
    const [bank, e, pal] = hit;
    let data = banks.get(bank);
    if (data === undefined) {
      const path = `tex/${bank}.bin`;
      if (await source.exists(path)) {
        const raw = await source.read(path);
        const tc = C.load(raw);
        data = tc.kind === C.COMPRESSED ? tc.data : raw;
      } else {
        data = null;
      }
      banks.set(bank, data);
    }
    if (!data) {
      degraded.note("screenSpritesJson", `sprite 0x${id.toString(16)}`,
                    "that screen sprite", `no tex/${bank}.bin`);
      continue;
    }
    let rgba: Uint8Array;
    if (e.layout === 5) {
      if (!pal || e.offset + (e.width * e.height) / 2 > data.length) {
        degraded.note("screenSpritesJson", `sprite 0x${id.toString(16)}`,
                      "that screen sprite", "no palette, or past the bank");
        continue;
      }
      rgba = texbank.decodePal4(data, e.offset, e.width, e.height, e.pixfmt,
                                pal);
    } else {
      rgba = texbank.decode(data, e.offset, {
        width: e.width, height: e.height, pixfmt: e.pixfmt, vq: e.vq,
        mipmap: false, twiddled: e.twiddled,
      });
    }
    const png = await encodeRgba(e.width, e.height,
                                 texbank.flipRows(rgba, e.width, e.height),
                                 deflate);
    out[key] = { w: e.width, h: e.height,
                 png: `data:image/png;base64,${base64(png)}` };
  }
  return out;
}

const B64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** RFC 4648 base64, the same in a browser and in node. */
function base64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
      + (i + 1 < b.length ? B64[(n >> 6) & 63] : "=")
      + (i + 2 < b.length ? B64[n & 63] : "=");
  }
  return s;
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
