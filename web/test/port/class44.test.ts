/**
 * Class 0x44's hinges and the selectors round them: 1 to 8, 10 and 15.
 *
 * Every placement below is a shipped descriptor's tail as the exporter decodes
 * it, and every curve value is `g_pHingeCurvesXYZ[0]`'s or
 * `g_pHingeCurvesYaw[1]`'s own (read from `0x00595B00` and `0x00595C68`).
 */
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import type {
  BreakablePlacement, BreakablesJson, EffectDefJson,
} from "../../src/bundle";
import { G } from "../../src/game/globals";
import { GameMode } from "../../src/game/game_mode";
import { NULL_HOST } from "../../src/game/host";
import { SetGameTables } from "../../src/game/tables";
import { GameUpdate, SpawnPropContainers } from "../../src/game/director";
import { SpawnClass } from "../../src/game/spawn_class";
import { PropFamily, type BreakableProp } from "../../src/game/class41/prop_state";
import { PropWords } from "../../src/game/class41/words";
import { PropDrawOnlyType31 } from "../../src/game/class41/draw_only";
import { KIND_SLOT } from "../../src/game/class41/kinded";
import {
  Class44Selector, EffectCollapseUpdate, EffectHandoffUpdate,
  FlagSlotEffectUpdate, HINGE_FRAMES, HINGE_FRAMES_CURVE4, HINGE_WORDS,
  HingeUpdate, PropBuildEffectCollapse, PropBuildEffectHandoff,
  PropBuildFlagSlotEffect, PropBuildHinge, PropBuildHingeScaled,
  PropBuildKindedProp, PropBuildScaledSlotEffect, PropBuildSlotStripLoop,
  PropBuildSwingThenBreak, PropBuildVanDoors, ScaledSlotEffectUpdate,
  SFX_FLAG_SLOT_EFFECT, SFX_HINGE_1866, SFX_HINGE_A60_KNOCK,
  SFX_HINGE_A60_OPEN, SwingThenBreakUpdate,
} from "../../src/game/class44";
import { check, CHARS, BREAKABLES, propScene } from "./harness";

/** `g_pHingeCurvesXYZ[0]`'s first four frames, held after. */
const XYZ0 = Array.from({ length: 60 }, (_, i) => (
  [[0, 0, 0], [55, 2989, 55], [195, 5700, 195], [383, 8155, 383]][
    Math.min(i, 3)]));
/** `g_pHingeCurvesYaw[1]`'s first five frames, held after. */
const YAW1 = Array.from({ length: 60 }, (_, i) =>
  [0, 427, 864, 1311, 1764][Math.min(i, 4)]);
/** A 130-frame yaw curve 4, synthetic: frame f is 10f. */
const YAW4 = Array.from({ length: 130 }, (_, i) => i * 10);

/** A two-node effect: a root, bone 1 drawing *a*, bone 2 drawing *b*. */
function effect(motion: number, a: number, b: number,
                playLength = 12): EffectDefJson {
  return {
    nodes: [
      { slot: 0, bone: 0, children: [1, 2] },
      { slot: a, bone: 1, children: [] },
      { slot: b, bone: 2, children: [] },
    ],
    interp: 0, motion, play_length: playLength, frames: 4, bones: 2,
    t: Array.from({ length: 4 * 2 * 3 }, () => 0),
    r: Array.from({ length: 4 * 2 * 3 }, () => 0),
    cues: [],
  };
}

const TABLES: BreakablesJson = {
  ...BREAKABLES,
  hinge_curves_xyz: { "0": XYZ0, "2": XYZ0, "3": XYZ0 },
  hinge_curves_yaw: { "1": YAW1, "4": YAW4 },
  effects: {
    ...BREAKABLES.effects,
    "11": effect(0x1d6, 0x0b01, 0x0b02, 0x80),
    "12": effect(0x1ce, 0x0c01, 0x0c02),
    "13": effect(0x1c7, 0x0d01, 0x0d02),
    "14": effect(0x1c8, 0x0e01, 0x0e02),
    "15": effect(0x1ca, 0x0f01, 0x0f02),
    "16": effect(0x1d3, 0x0500, 0x0501, 0x60),
  },
};

function scene(rng: Rng, mode = GameMode.Arcade,
               placements: BreakablePlacement[] = []): Events {
  const events = propScene(rng, mode);
  SetGameTables(CHARS, { ...TABLES,
                         placements: [...(TABLES.placements ?? []),
                                      ...placements] });
  return events;
}

const sounds = (events: Events): number[] => {
  const out: number[] = [];
  events.on("sound.play", (d) => out.push(d.id));
  return out;
};

/** Stage 1's evt 0x6DC: curve 0, slot 0x1801, side +512, phase 0x4000. */
const HINGE_6DC: BreakablePlacement = {
  at: 0x6dc, container: "hinge", curve: 0, slot: 0x1801, coli: -1,
  side: 512, wobble_phase: 0x4000, open_flag: 0x16, remove_flag: 0x17,
  lifetime_evt_steps: 0, pos: [-9.6, 36.2, 61.4], yaw: 0,
};

console.log("\nclass 0x44 selectors 1, 2 and 4, the hinges, as game objects:");
{
  const rng = new Rng(0x4401);
  const events = scene(rng, GameMode.Arcade, [HINGE_6DC]);
  G.g_evt_step_index = 1;
  SpawnPropContainers([{ at: 0x6dc, class: SpawnClass.PropPlacer }]);
  const placer = G.g_object_list.find((o) => o.at === 0x6dc);
  check("the placer dispatches on +0x11C = 1",
        placer?.hp === Class44Selector.Hinge && placer.hp === 1);
  GameUpdate(1 / 60, NULL_HOST, rng, events);
  const h = G.g_breakable_props.find((q) => q.at === 0x6dc);
  check("one frame builds a HingeUpdate object and the placer dies",
        h?.family === PropFamily.Hinge && !!placer?.dead);
  if (!h) throw new Error("no hinge");
  const w = PropWords(h, HINGE_WORDS);
  check("PropBuildHinge reads the tail at its own offsets",
        h.slot === 0x1801 && w.o290 === 0 && w.o1dc === 512
        && w.o1e8 === 0x4000 && h.storyItem === 0x16 && h.removeFlag === 0x17
        && w.o14c === -1 && h.flags === 0x51 && w.o2c0 === 1.0
        && h.restX === 1 && h.restY === 1 && h.restZ === 1);
  HingeUpdate(h, events);
  check("...and the routine draws its slot at its point",
        h.draws?.length === 1 && h.draws[0].slot === 0x1801
        && h.draws[0].m[12] === Math.fround(-9.6)
        && h.draws[0].m[13] === Math.fround(36.2)
        && h.draws[0].m[14] === Math.fround(61.4));

  // The swing. Frame 0 of curve 0 is (0, 0, 0); frame 1 (55, 2989, 55).
  G.g_script_flags[0x16] = 1;
  HingeUpdate(h, events);
  HingeUpdate(h, events);
  check("side +512 swings as +1 does: the sign, never the magnitude",
        w.o64 === 55 && w.o68 === 2989 && w.o6c === 55 && w.o2a8 === 2,
        `${w.o64} ${w.o68} ${w.o6c}`);
  for (let i = 0; i < 100; i++) HingeUpdate(h, events);
  check("curve 0 runs sixty frames and holds its last",
        w.o2a8 === HINGE_FRAMES && w.o68 === 8155);

  // The shot wobble: bit 3 once the curve has run out.
  const base = w.o68;
  h.flags |= 0x8 | 0x2;
  HingeUpdate(h, events);
  // sin(0x1000 * 2pi / 65536) * -1024 = -391.87 -> ftol -391, times +512.
  check("a shot starts the wobble: bit 30 up, bits 1..3 down, one step in",
        (h.flags & 0x40000000) !== 0 && (h.flags & 0xe) === 0
        && w.o1f4 === base && w.o1e8 === 0x1000
        && w.o68 === base + 391 * 512, `${w.o68 - base}`);
  for (let i = 0; i < 15; i++) HingeUpdate(h, events);
  check("sixteen frames later it is back where it was and the bit is down",
        w.o68 === base && (h.flags & 0x40000000) === 0 && w.o1e8 === 0x10000);

  G.g_script_flags[0x17] = 1;
  const before = h.flags;
  HingeUpdate(h, events);
  check("the remove flag with no blob is ActorKill: the flags are untouched",
        !!h.dead && h.flags === before);
}

console.log("\nHingeUpdate's arms:");
{
  const rng = new Rng(0x4402);
  const events = scene(rng);
  const heard = sounds(events);
  // Stage 2's 0x228C/0x22D4 pair: curve 0, sides -1 (the tail's `ff ff ff
  // ff`) and +1.
  const left = PropBuildHinge({ ...HINGE_6DC, at: 0x228c, slot: 0x1815,
                                side: -1, open_flag: 0x1f, remove_flag: 0x44 });
  const lw = PropWords(left, HINGE_WORDS);
  G.g_script_flags[0x1f] = 1;
  HingeUpdate(left, events);
  HingeUpdate(left, events);
  check("side -1 mirrors X and the yaw and leaves Z",
        lw.o64 === -55 && lw.o68 === -2989 && lw.o6c === 55);

  const yaw = PropBuildHinge({ ...HINGE_6DC, at: 0x231c, curve: 1, side: 1,
                               open_flag: 0x20, remove_flag: 0x45 });
  const yw = PropWords(yaw, HINGE_WORDS);
  G.g_script_flags[0x20] = 1;
  for (let i = 0; i < 4; i++) HingeUpdate(yaw, events);
  check("curve 1 is the yaw-only table: 1311 at frame 3, nothing on X or Z",
        yw.o68 === 1311 && yw.o64 === 0 && yw.o6c === 0);

  const long = PropBuildHinge({ ...HINGE_6DC, at: 0xa90, curve: 4, side: 1,
                                open_flag: 1, remove_flag: 0x14 });
  const gw = PropWords(long, HINGE_WORDS);
  G.g_script_flags[1] = 1;
  for (let i = 0; i < 200; i++) HingeUpdate(long, events);
  check("curve 4 runs 130 frames, not 60",
        gw.o2a8 === HINGE_FRAMES_CURVE4 && gw.o68 === 1290);

  // Slot 0xA60's two cues. Flag 0x36 opens it: its own flag goes up and it
  // switches to curve 1.
  const a60 = PropBuildHinge({ ...HINGE_6DC, at: 0x1618, curve: 1,
                               slot: 0xa5b, open_flag: 0x25, remove_flag: 0x26 });
  a60.slot = 0xa60;
  const aw = PropWords(a60, HINGE_WORDS);
  aw.o290 = 0;
  G.g_script_flags[0x36] = 1;
  HingeUpdate(a60, events);
  check("slot 0xA60 on flag 0x36: its flag up, curve 1, sound 0x1F16A9",
        G.g_script_flags[0x25] === 1 && aw.o290 === 1
        && heard.includes(SFX_HINGE_A60_OPEN));
  G.g_script_flags[0x36] = 0;
  const knock = PropBuildHinge({ ...HINGE_6DC, at: 0x1619, curve: 0,
                                 coli: 0x0ced0000, open_flag: 0x27,
                                 remove_flag: 0x28 });
  knock.slot = 0xa60;
  G.g_script_flags[0x23] = 1;
  HingeUpdate(knock, events);
  check("...and on flag 0x23 with curve 0 it knocks and drops its blob",
        heard.includes(SFX_HINGE_A60_KNOCK)
        && PropWords(knock, HINGE_WORDS).o14c === -1);
  G.g_script_flags[0x23] = 0;

  // Stage 4's slot-0x1866 doors: scene 3, blocks 1 and 7, flag 2 or 4.
  G.g_scene_index = 3;
  G.g_evt_block_index = 7;
  const door = PropBuildHinge({ ...HINGE_6DC, at: 0x48e4, curve: 2,
                                slot: 0x1866, open_flag: 2, remove_flag: 9 });
  G.g_script_flags[4] = 1;
  const n = heard.length;
  HingeUpdate(door, events);
  HingeUpdate(door, events);
  check("slot 0x1866 in scene 3 block 7 plays 0x361BA9 once, on flag 4",
        heard.slice(n).filter((s) => s === SFX_HINGE_1866).length === 1
        && PropWords(door, HINGE_WORDS).o2ac === 1);

  G.g_scene_index = 1;
  G.g_script_flags[0x77] = 1;
  const swept = PropBuildHinge({ ...HINGE_6DC, at: 0x3218 });
  HingeUpdate(swept, events);
  check("scene 1's flag 0x77 sweeps it through ActorDespawn",
        !!swept.dead && ((swept.flags & 0x80018000) >>> 0) === 0x80018000);
  G.g_script_flags[0x77] = 0;

  const blob = PropBuildHinge({ ...HINGE_6DC, at: 0x548c, coli: 0x0ced0640,
                                open_flag: 0x23, remove_flag: 0x48 });
  HingeUpdate(blob, events);
  check("with a blob it files itself for the shot test, at radius 0",
        blob.shotRegistered && blob.hitRadius === 0);
  G.g_script_flags[0x48] = 1;
  HingeUpdate(blob, events);
  check("...and its remove flag is ActorDespawn",
        !!blob.dead && ((blob.flags & 0x80018000) >>> 0) === 0x80018000);

  const wide = PropBuildHingeScaled({ ...HINGE_6DC, at: 0x8440,
                                      container: "hinge_scaled", slot: 0x1817,
                                      scale: [0.6, 0.57, 0.5] });
  HingeUpdate(wide, events);
  const m = wide.draws?.[0]?.m ?? [];
  check("slots 0x1817 and 0x1816 draw at (1.05, 1, 1), not their own scale",
        Math.abs(Math.hypot(m[0], m[1], m[2]) - Math.fround(1.05)) < 1e-6
        && Math.abs(Math.hypot(m[4], m[5], m[6]) - 1) < 1e-6
        && wide.restX === Math.fround(0.6), JSON.stringify(m.slice(0, 3)));
}

console.log("\nclass 0x44 selector 2, the van's rear doors:");
{
  const rng = new Rng(0x4403);
  scene(rng);
  // Stage 2's 0x2244, turned a quarter: the offsets are literals in the
  // routine, (-9.29, 11.5, 22.68) and (+9.29, ...), under `RotY(0x4000)`,
  // which carries (x, z) to (z, -x).
  const [a, b] = PropBuildVanDoors({
    at: 0x2244, container: "van_doors", coli: -1, wobble_phase: 0,
    open_flag: 0x19, remove_flag: 0x3e, lifetime_evt_steps: 0,
    pos: [-811.1, -7.0, -613.0], yaw: 0x4000 });
  const near = (v: number, e: number) => Math.abs(v - e) < 1e-3;
  check("two doors, slots 0x1794 and 0x1795, sides -1 and +1, curve 2",
        a.slot === 0x1794 && b.slot === 0x1795
        && PropWords(a, HINGE_WORDS).o1dc === -1
        && PropWords(b, HINGE_WORDS).o1dc === 1
        && PropWords(a, HINGE_WORDS).o290 === 2);
  check("placed at the literal offsets in the van's frame",
        near(a.x, -811.1 + 22.68) && near(a.y, -7.0 + 11.5)
        && near(a.z, -613.0 + 9.29)
        && near(b.x, -811.1 + 22.68) && near(b.z, -613.0 - 9.29),
        `${a.x} ${a.z} ${b.x} ${b.z}`);
  check("the second hung half a turn round",
        a.yaw === 0x4000 && b.yaw === 0xc000);
}

console.log("\nclass 0x44 selector 5, an effect and then a hinge:");
{
  const rng = new Rng(0x4405);
  scene(rng);
  // Stage 2's 0x10018: curve 1, slot 0x17ED, a blob, side -1, phase 0xBC00.
  const p = PropBuildEffectHandoff({
    at: 0x10018, container: "effect_handoff", curve: 1, slot: 0x17ed,
    coli: 0x0cecfbe0, side: -1, wobble_phase: 0xbc00, open_flag: 0x26,
    remove_flag: 0x4b, lifetime_evt_steps: 0, pos: [-708.8, 5.5, -1303.6],
    yaw: 49152 });
  G.g_breakable_props.push(p);
  EffectHandoffUpdate(p, rng);
  check("until flag 0x62 it draws 0x17D7 and nothing else",
        p.draws?.length === 1 && p.draws[0].slot === 0x17d7
        && G.g_breakable_props.length === 1);
  G.g_script_flags[0x62] = 1;
  EffectHandoffUpdate(p, rng);
  const h = G.g_breakable_props[1];
  const hw = h ? PropWords(h, HINGE_WORDS) : null;
  check("flag 0x62 allocates one HingeUpdate object with its words",
        h?.family === PropFamily.Hinge && h.slot === 0x17ed
        && hw?.o290 === 1 && hw.o1dc === -1 && hw.o14c === 0x0cecfbe0
        && h.storyItem === 0x26 && h.removeFlag === 0x4b && h.yaw === 49152);
  check("...but not its wobble phase, which the allocation does not copy",
        hw?.o1e8 === 0);
  check("and from then it draws only effect 0xC, one unit down",
        (p.draws ?? []).map((d) => d.slot).join() === [0x0c01, 0x0c02].join());
  for (let i = 0; i < 40; i++) EffectHandoffUpdate(p, rng);
  check("the hinge is made once, and the clip stops three short",
        G.g_breakable_props.length === 2 && p.effectFrames === 12 - 3);
  check("it files nothing for the shot test", !p.shotRegistered);
}

console.log("\nclass 0x44 selector 6, a swing and then a break:");
{
  const rng = new Rng(0x4406);
  scene(rng);
  G.g_script_flags[0] = 1;
  G.g_script_flags[0x63] = 1;
  // Stage 2's 0x100A4: curve 1, slot 0x1DC, side -1, flags 0x31/0x56.
  const p = PropBuildSwingThenBreak({
    at: 0x100a4, container: "swing_then_break", curve: 1, slot: 0x1dc,
    coli: -1, side: -1, field_2ac: -1, open_flag: 0x31, remove_flag: 0x56,
    scale: [1, 1, 1], lifetime_evt_steps: 0, pos: [0, 0, 0], yaw: 0 });
  check("the builder clears flag 0x63 and, through the placer's zero words, "
        + "flag 0", G.g_script_flags[0x63] === 0 && G.g_script_flags[0] === 0);
  const w = PropWords(p, HINGE_WORDS);
  SwingThenBreakUpdate(p, rng);
  check("unswung, it draws its slot half a turn round and 10.88 along",
        p.draws?.length === 1 && p.draws[0].slot === 0x1dc
        && Math.abs(p.draws[0].m[12] - 10.876867) < 1e-4,
        `${p.draws?.[0]?.m[12]}`);
  G.g_script_flags[0x31] = 1;
  SwingThenBreakUpdate(p, rng);
  SwingThenBreakUpdate(p, rng);
  check("its flag swings it through g_pHingeCurvesYaw[1], mirrored by side",
        w.o68 === -427 && w.o2a8 === 2);
  G.g_script_flags[0x63] = 1;
  const yaw0 = p.yaw;
  SwingThenBreakUpdate(p, rng);
  check("flag 0x63: the strip starts at 0x170, and side -1 turns it by -1",
        p.draws?.[0]?.slot === 0x170 && p.yaw === yaw0 - 1 && w.o1dc === 0);
  SwingThenBreakUpdate(p, rng);
  check("a zero spin is armed at 0x100 and turns nothing that frame",
        w.o1dc === 0x100 && p.yaw === yaw0 - 1
        && (p.flags & 0x40000000) !== 0);
  SwingThenBreakUpdate(p, rng);
  check("then it turns by it and keeps 0.85 of it",
        p.yaw === yaw0 - 1 + 0x100 && w.o1dc === 217);
  const slots = (p.draws ?? []).map((d) => d.slot);
  check("over the strip, effects 0xD and 0xE",
        slots.join() === [0x172, 0x0d01, 0x0d02, 0x0e01, 0x0e02].join(),
        slots.map((s) => s.toString(16)).join());
  for (let i = 0; i < 5; i++) SwingThenBreakUpdate(p, rng);
  check("the strip stops at 0x174", p.draws?.[0]?.slot === 0x174);
  G.g_script_flags[0x64] = 1;
  SwingThenBreakUpdate(p, rng);
  check("flag 0x64 restarts it once, on effect 0xF alone",
        p.effectFrames === 0 && (p.flags & 0x4000000) !== 0
        && (p.draws ?? []).map((d) => d.slot).join()
           === [0x0f01, 0x0f02].join());
}

console.log("\nclass 0x44 selectors 3 and 7, effects drawn as one slot:");
{
  const rng = new Rng(0x4407);
  const events = scene(rng);
  const heard = sounds(events);
  // Stage 2's 0xBD38: slot 0x1737, flags 0x2B/0x50, scale (0.9, 0.975, 0.8).
  const s7 = PropBuildScaledSlotEffect({
    at: 0xbd38, container: "scaled_slot_effect", curve: 0, slot: 0x1737,
    coli: -1, side: 1, field_2ac: -1, open_flag: 0x2b, remove_flag: 0x50,
    scale: [0.9, 0.975, 0.8], lifetime_evt_steps: 0,
    pos: [-721.5, 49, -1775.3], yaw: 0 });
  ScaledSlotEffectUpdate(s7, rng);
  check("selector 7 draws its effect's every node as its own slot",
        (s7.draws ?? []).length === 2
        && (s7.draws ?? []).every((d) => d.slot === 0x1737));
  G.g_script_flags[0x2b] = 1;
  for (let i = 0; i < 20; i++) ScaledSlotEffectUpdate(s7, rng);
  check("...and plays it to two short of the play length on its flag",
        s7.effectFrames === 12 - 2);

  G.g_scene_index = 0;
  const s3a = PropBuildFlagSlotEffect({
    at: 0x3acc, container: "flag_slot_effect", coli: 0x0ced0130,
    open_flag: 0x1e, remove_flag: 0x14, lifetime_evt_steps: 0,
    pos: [-447.1, -15.4, -461.3] });
  G.g_scene_index = 1;
  const s3b = PropBuildFlagSlotEffect({
    at: 0xd400, container: "flag_slot_effect", coli: -1,
    open_flag: 0x33, remove_flag: 0x58, lifetime_evt_steps: 0,
    pos: [-1034.8, 129, -1912.1] });
  check("selector 3's slot is 0x17EE in scene 0 and 0x197C in any other",
        s3a.slot === 0x17ee && s3b.slot === 0x197c);
  G.g_script_flags[0x77] = 1;
  s3b.effectFrames = 0x40;
  G.g_script_flags[0x33] = 1;
  FlagSlotEffectUpdate(s3b, rng, events);
  check("it has no scene-1 sweep, plays 0x1116A9 on frame 0x41, and draws "
        + "0x197C at its point",
        !s3b.dead && s3b.effectFrames === 0x41
        && heard.includes(SFX_FLAG_SLOT_EFFECT)
        && (s3b.draws ?? []).every((d) => d.slot === 0x197c)
        && (s3b.draws ?? []).length === 2
        && s3b.draws![0].m[12] === Math.fround(-1034.8));
  G.g_script_flags[0x77] = 0;
}

console.log("\nclass 0x44 selector 8, an effect that falls apart:");
{
  const rng = new Rng(0x4408);
  // Keys 0x22 and 0x23, 73 entries each: entry k at (k, 2k, 3k) then
  // (k + 1, 2k + 2, 3k), rotation (k, 0, 0) then (k + 100, 0, 0). Entry 72's y
  // is a NaN pattern -- what a translation read out of rotation shorts can be.
  const bits = (v: number) => new Uint32Array(new Float32Array([v]).buffer)[0];
  const key = (k0: number) => ({
    key: k0,
    t_bits: Array.from({ length: 73 * 3 }, (_, j) => {
      const k = Math.floor(j / 3);
      const c = j % 3;
      if (k === 72 && c === 1) return 0x7fc00000;
      const v = c === 0 ? k : c === 1 ? 2 * k : 3 * k;
      return bits(k0 === 0x23 && c < 2 ? v + (c + 1) : v);
    }),
    r: Array.from({ length: 73 * 3 }, (_, j) => (
      j % 3 === 0 ? Math.floor(j / 3) + (k0 === 0x23 ? 100 : 0) : 0)),
  });
  const PL: BreakablePlacement = {
    at: 0x69d0, container: "effect_collapse", open_flag: 0x15,
    lifetime_evt_steps: 3, scale: [1, 1, 1], pos: [0, 0, 0], yaw: 0,
    collapse_keys: [key(0x22), key(0x23)] };
  scene(rng, GameMode.Arcade, [PL]);
  G.g_evt_block_index = 0xb;
  const p = PropBuildEffectCollapse(PL);
  EffectCollapseUpdate(p, rng);
  check("block 0xB draws 0x173B at (-869.2, 12, -810) while the flag is down",
        p.draws?.[0]?.slot === 0x173b
        && p.draws[0].m[12] === Math.fround(-869.2)
        && p.draws[0].m[14] === -810);

  // Before the flag the 72 parts fall from the origin to a floor of
  // ftol(0 - 0 + 1 * 5) = 5 -- at once -- and every bounce is three rand()s.
  const ref = new Rng(0x4408);
  for (let i = 0; i < 72 * 3; i++) ref.int(0x8000);
  check("the parts run before the flag: 72 bounces, 216 rand()s",
        rng.state === ref.state);

  const w = PropWords(p, { o1ec: 0 });
  w.o1ec = 0x22;
  G.g_script_flags[0x15] = 1;
  EffectCollapseUpdate(p, rng);
  check("frame 0x22: the tree is drawn at 0.95 and each bone's slot kept",
        (p.draws ?? []).some((d) => d.slot === 0x500 && d.alpha === Math.fround(0.95))
        && p.burst[1].slot === 0x500 && p.burst[2].slot === 0x501);
  const before = rng.state;
  EffectCollapseUpdate(p, rng);
  const b1 = p.burst[1];
  check("frame 0x23 lets go: velocity is the two keys' difference",
        b1.vx === 1 && b1.sx === 100 && b1.rx === 201 && b1.x === 3);
  const part1 = (p.draws ?? []).find((d) => d.slot === 0x500);
  check("part 1 is bone 1's model at entry 1 -- bone 2's key",
        !!part1 && part1.m[12] === 3 && part1.m[14] === 3);
  const once = new Rng(0);
  once.state = before;
  for (let i = 0; i < 3; i++) once.int(0x8000);
  check("entry 72's NaN compares unordered and bounces: three rand()s",
        rng.state === once.state);

  G.g_evt_step_index = 1;
  for (let i = 0; i < 3 && !p.dead; i++) {
    EffectCollapseUpdate(p, rng);
    G.g_evt_step_index += 1;
  }
  check("its own lifetime: three steps, and the fourth despawns it",
        !p.dead);
  EffectCollapseUpdate(p, rng);
  check("...there", !!p.dead);
}

console.log("\nclass 0x44 selector 10, PropDrawOnlyType31 from a descriptor:");
{
  const rng = new Rng(0x4410);
  const events = scene(rng);
  G.g_scene_index = 2;
  G.g_evt_block_index = 11;
  G.g_evt_step_index = 1;
  // Stage 3's 0x9164: slot 0x1874, roll 29, lifetime 0, scale (0.7, 0.8, 1).
  const p = PropBuildSlotStripLoop({
    at: 0x9164, container: "slot_strip_loop", slot: 0x1874,
    lifetime_evt_steps: 0, scale: [0.7, 0.8, 1.0], roll: 29,
    pos: [-758.7, 33.8, -4375.8], yaw: 0 });
  check("its own family, the descriptor's slot, strip, scale and step",
        p.family === PropFamily.DrawOnlyType31 && p.slot === 0x1874
        && p.removeFlag === 29 && p.restX === Math.fround(0.7)
        && p.lifetime === 0 && p.lastStepIndex === 1 && p.pitch === 0
        && p.roll === 0);
  G.g_scene_tick_counter = 12;
  PropDrawOnlyType31(p, rng, events);
  check("in scene 2 block 11 it draws its strip and the second strip twice",
        (p.draws ?? []).map((d) => d.slot).join()
        === [0x1874, 0x1797 + 5, 0x1797 + 5].join());
  G.g_evt_step_index = 2;
  PropDrawOnlyType31(p, rng, events);
  check("a lifetime of 0 ends it at the first step boundary", !!p.dead);
}

console.log("\nclass 0x44 selector 15, the kinded prop and its gate:");
{
  const rng = new Rng(0x4415);
  scene(rng, GameMode.Arcade);
  // Stage 3's 0x2504 (scene 2 block 1): kind 2, set size 2, lifetime 1,
  // item set 8, story item 1.
  const PL: BreakablePlacement = {
    at: 0x2504, container: "kinded_44", kind: 2, set_size: 2, item_set: 8,
    story_item: 1, lifetime_evt_steps: 1, pos: [-312.4, -17, -3058],
    yaw: 49152 };
  G.g_scene_index = 2;
  G.g_evt_block_index = 1;
  check("outside Original Mode, scene 2 block 1 builds nothing",
        PropBuildKindedProp(PL, rng) === null);
  G.g_GameMode = GameMode.Original;
  const p = PropBuildKindedProp(PL, rng);
  check("in Original Mode it builds a KindedPropUpdate object",
        p?.family === PropFamily.Kinded && p.slot === KIND_SLOT[2]
        && p.kind === 2 && p.storyItem === 1 && p.itemSet === 8
        && p.lifetime === 1 && p.flags === 0x80000001);
  check("...and seeds its set's countdown from the set size",
        G.g_item_set_countdown[8] === 1 || G.g_item_set_countdown[8] === 2);
  G.g_GameMode = GameMode.Arcade;
  G.g_scene_index = 0;
  G.g_evt_block_index = 3;
  // Stage 1's 0x2D14: kind 0 (the orientation word's low half), set size 2,
  // lifetime 4, item set 2, story item 3.
  const s1: BreakableProp | null = PropBuildKindedProp(
    { ...PL, at: 0x2d14, kind: 0, set_size: 2, story_item: 3, item_set: 2,
      lifetime_evt_steps: 4 },
    rng);
  check("stage 1's are built in Arcade, story item 3 from the tail's +0x08, "
        + "and kind 0 draws no model",
        s1?.storyItem === 3 && s1.itemSet === 2 && s1.lifetime === 4
        && s1.slot === 0xffff);
}
