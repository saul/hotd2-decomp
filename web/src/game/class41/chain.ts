/**
 * The hanging chain: `g_class41_constructors[24]` and the twenty links it
 * builds.
 *
 * ```
 * PlaceChainSegments   FUN_00463160  the constructor: twenty 0x200-byte links
 * ChainSegmentUpdate   FUN_00469510  one link, one frame: its step lifetime, a
 *                                    shot's swing, the route, its draw
 * SpawnChainItemDrop   FUN_004699C0  segment 0's Original Mode item drop
 * ```
 *
 * Four shipped placements: stage 2 block 22's three (groups 0, 0 and 1, at
 * `y = 20`, hanging from the ceiling) and stage 4 block 3's one. **Group 1 is
 * a route trigger**: in Original Mode any link of it shot in block 0x16 writes
 * `g_script_branch_var = 2`, once, and drops an item.
 *
 * ## How a link hangs
 *
 * Each link is drawn on the matrix the link above it **stored last**, so the
 * twenty make one rope:
 *
 * ```
 * M_0 = T(anchor)          * RotZ(roll_0) * RotX(pitch_0)
 * M_i = Stored_{i-1}       * RotZ(roll_i) * RotX(pitch_i)
 * draw 0x1234 under M_i * RotY(yaw_i)
 * Stored_i = M_i * T(0, -1.5, 0)
 * ```
 *
 * At rest that is twenty links 1.5 apart straight down from the anchor, each
 * turned a quarter turn from the last (`yaw_i = i << 14`). A shot gives every
 * link from two above the hit downward a swing rate, and each link's angles
 * then spring back to zero on their own (`v -= (a + v) / 48; a += v`), so the
 * rope sways and settles.
 *
 * Before this file the port placed twenty generic props of type 0 straight
 * down from the anchor, drew none of them as the routine does -- the renderer
 * fell back on the generic family's slot -- ran no swing, and called the
 * branch arm only for groups above 0.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { G } from "../globals";
import { GameMode } from "../game_mode";
import { T } from "../tables";
import {
  FtolS16, MatCopy, MatrixGetTranslation, MatrixRotateX, MatrixRotateY,
  MatrixRotateZ, MatrixTranslate,
} from "../matrix";
import { vec3 } from "../vec";
import { SpawnPropHitEffectScaled } from "../effects/sprite";
import type { BreakablePlacement } from "../../bundle";
import { BranchBlock } from "./branch";
import { CHAIN_ITEM_ROW, CHAIN_LINK_SLOT } from "./chain_slots";
import { SCRIPT_FLAG_CLEAR_PROPS } from "./lifetime";
import { PICKED_ITEM_WORDS_ZERO } from "./original_item";
import { ActorDespawnProp, BreakablePropAwardHit } from "./prop";
import { PropDrawBegin, PropDrawSlot, PropMatrixPush } from "./prop_draw";
import {
  BreakableFlag, BreakableState, makeBreakableProp, PropFamily,
  type BreakableProp, type ChainSegmentState,
} from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";
import {
  ORIGINAL_ITEM_DROP_RADIUS,
} from "./type07";
import { PropWords } from "./words";

/** `seg->+0x124 = 0x40000000`: every link's sphere is 2.0. */
export const CHAIN_SEGMENT_RADIUS = 2.0;

/** How many segments a chain has, and the stride of `g_chain_segments`. */
export const CHAIN_SEGMENTS = 0x14;

/** The chain group that carries a route, and the only one gated on the mode. */
export const CHAIN_BRANCH_GROUP = 1;

/** `PUSH 0xBFC00000` at `0x004698EE`: `MatrixTranslate(0, -1.5, 0)`. */
export const CHAIN_LINK_DROP = -1.5;

/** `PUSH 0xF16A9` at `0x004695C0`: the clank of a shot link. */
export const SFX_CHAIN_HIT = 0xf16a9;

/** `PUSH 0x3FA00000` at `0x004695D8`: the spark's scale, 1.25. */
const CHAIN_HIT_EFFECT_SCALE = 1.25;

/** `PUSH 0x41900000` at `0x004697C8`: the item drop's world height, 18.0. */
export const CHAIN_ITEM_DROP_Y = 18.0;

/**
 * The swing a shot gives: `rand() % 0x51 - (rand() & 1) * 0x180 + 0x98`, so
 * 152..232 one way or -232..-152 the other (`0x0046963D`..`0x0046969A`).
 */
const SWING_BASE = 0x98;
const SWING_SPREAD = 0x51;
const SWING_FLIP = 0x180;

/** `float ptr [0x004C4380]` -- 1.0. */
const SWING_FALLOFF_ONE = 1.0;
/** `float ptr [0x004C4C58]` -- 0.25 a link. */
const SWING_FALLOFF_STEP = 0.25;
/** `float ptr [0x005690B8]` -- `0x3DB851EC`, the square term below the hit. */
const SWING_FALLOFF_SQUARE = Math.fround(0.09);

/** `IMUL 0x2AAAAAAB; SAR EDX, 3` -- the spring's divide by 48. */
const SWING_SPRING_DIVISOR = 0x30;

/** How many links above the hit the swing reaches: `LEA EDI, [EBP - 2]`. */
const SWING_LINKS_ABOVE = 2;

/** `obj+0x1B0` of segment 0: the chain's route latch. */
export enum ChainLatch {
  Open = 0,
  /** A group-1 link was shot in block 0x16; segment 0 drops its item next. */
  Shot = 1,
  /** Segment 0 has dropped its item. */
  Dropped = 2,
}

/** `(s8)` -- the engine keeps the step bookkeeping in bytes. */
const s8 = (v: number): number => (v << 24) >> 24;
/** `(s16)`. */
const s16 = (v: number): number => (v << 16) >> 16;

/**
 * `PlaceChainSegments` — `FUN_00463160`. `g_class41_constructors[24]`.
 *
 * ```c
 * if (g_GameMode != 1 && placer->+0x1F4 == 1) { ActorDespawn(placer); return; }
 * for (i = 0; i < 0x14; i++) {
 *     seg = ActorAlloc(ChainSegmentUpdate, 0x200); ActorClearGameFields(seg);
 *     seg->+0x1AC = (s8)placer->+0x1F4;                 // the chain group
 *     g_chain_segments[group * 0x14 + i] = seg;
 *     seg->+0x1A0..+0x1A8 = placer->+0x40..+0x48;       // the anchor
 *     seg->+0x11C = placer->+0x11C;                     // step lifetime
 *     seg->+0x1AD = i;
 *     seg->+0x1AE = (u8)g_evt_step_index;  seg->+0x1AF = 0;
 *     seg->+0x124 = 2.0;                                // hit radius
 *     seg->+0x1B4 = i << 14;                            // its yaw
 * }
 * ```
 *
 * **The mode gate is on group 1 only**, so the other chains are built in
 * arcade and simply have no route to open. Every link starts **at the anchor**
 * with its angles zero: where it hangs is its routine's business, from its
 * first frame.
 */
export function PlaceChainSegments(pl: BreakablePlacement): BreakableProp[] {
  const group = pl.chain_group ?? 0;
  if (G.g_GameMode !== GameMode.Original && group === CHAIN_BRANCH_GROUP) {
    return [];
  }
  const out: BreakableProp[] = [];
  for (let i = 0; i < CHAIN_SEGMENTS; i++) {
    const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
    p.family = PropFamily.ChainSegment;
    p.at = pl.at;
    p.state = BreakableState.Standing;
    // `ActorClearGameFields` leaves `+0x34` zero and nothing here writes it:
    // a link is shootable because its routine registers it, not by a flag.
    p.flags = 0;
    p.hitRadius = CHAIN_SEGMENT_RADIUS;
    // The anchor is the chain's own `+0x1A0..+0x1A8`. The prop record's
    // `x`/`y`/`z` are another layout's offsets (`+0x19C..+0x1A4`, `L3`) and
    // this object never writes them.
    const ax = pl.pos?.[0] ?? 0;
    const ay = pl.pos?.[1] ?? 0;
    const az = pl.pos?.[2] ?? 0;
    const st: ChainSegmentState = {
      lifetime: s16(pl.lifetime_evt_steps ?? 0),
      wx: 0, wy: 0, wz: 0,
      ax, ay, az,
      group: s8(group),
      index: i,
      lastStep: s8(G.g_evt_step_index),
      steps: 0,
      latch: ChainLatch.Open,
      pitch: 0,
      yaw: s16(i << 14),
      roll: 0,
      pitchRate: 0,
      rollRate: 0,
      m: new Array(16).fill(0),
    };
    p.chain = st;
    G.g_chain_segments[st.group * CHAIN_SEGMENTS + i] = p.id;
    out.push(p);
  }
  return out;
}

/**
 * `g_chain_segments[group * 0x14 + index]`, by prop id.
 *
 * `[port-only]` as a function: the engine's table holds pointers and reads
 * through them; the port's holds ids and the pool is a list. A link that has
 * died this frame is still in the list until the walk ends, as the engine's
 * pointer still reaches its object.
 */
function ChainSegmentAt(group: number, index: number):
    BreakableProp | undefined {
  const id = G.g_chain_segments[group * CHAIN_SEGMENTS + index];
  if (id === undefined) return undefined;
  return G.g_breakable_props.find((q) => q.id === id);
}

/**
 * `ChainSegmentUpdate` — `FUN_00469510`. One link, one frame.
 *
 * ```c
 * g_chain_segments[group * 0x14 + index] = obj;
 * if (g_scene_index == 1 && g_script_flags[0x77]) { ActorDespawn(obj); return; }
 * if (g_evt_step_index != (s8)+0x1AE) {
 *     if ((s8)+++0x1AF > (s16)+0x11C) { ActorDespawn(obj); return; }
 *     +0x1AE = (u8)g_evt_step_index;
 * }
 * if (+0x34 & 8) {
 *     BreakablePropAwardHit(+0x34, 0);  +0x34 &= ~8;  PlaySoundId(0xF16A9);
 *     SpawnPropHitEffectAtDepth(+0x78, +0x19C, !(+0x34 & 2), 1.25);
 *     if (g_GameMode == 1 && group == 1 && seg0->+0x1B0 == 0
 *         && g_evt_block_index == 0x16) { seg0->+0x1B0 = 1; g_script_branch_var = 2; }
 *     a = rand() % 0x51 - (rand() & 1) * 0x180 + 0x98;    // (the & first)
 *     b = rand() % 0x51 - (rand() & 1) * 0x180 + 0x98;
 *     for (j = max(index - 2, 0); j < 0x14; j++) {
 *         f = j < index ? 1.0 - (index - j) * 0.25
 *                       : 1.0 + (j - index) * 0.25 - (j - index)^2 * 0.09;
 *         seg[j]->+0x1B8 = __ftol(a * f);  seg[j]->+0x1BC = __ftol(b * f);
 *     }
 * }
 * +0x34 &= ~6;
 * if (index == 0 && +0x1B0 == 1) { +0x1B0 = 2; SpawnChainItemDrop(18.0, 4, obj); }
 * +0x1B8 -= (+0x1B2 + +0x1B8) / 48;  +0x1B2 += +0x1B8;
 * +0x1BC -= (+0x1B6 + +0x1BC) / 48;  +0x1B6 += +0x1BC;
 * Push; index == 0 ? T(+0x1A0) : SetTop(seg[index - 1]->+0x1C0);
 * RotZ(+0x1B6); RotX(+0x1B2);
 *   Push; RotY(+0x1B4); SubmitSlotWithSceneLightArray(0x1234); Pop;
 * T(0, -1.5, 0); MatrixStore(+0x1C0); Pop;
 * +0x194 = translation(view_to_world * +0x1C0);        // the link's foot
 * +0x70 = view(+0x194);  RegisterForShotTest(obj);
 * ```
 *
 * **Every chain runs the whole routine**, not only the route's: groups 0 sway
 * and clank exactly as group 1 does and simply have no route to open. **Any
 * link opens the route**, and the latch lives on segment 0 rather than on the
 * link that was hit, which is what makes twenty objects one switch -- and it
 * is segment 0's own next update, not the shot link's, that drops the item.
 *
 * The step bookkeeping is in bytes: `+0x1AE` is a `u8` copy of the step index
 * read back `MOVSX`, so the test is against the sign-extended byte.
 *
 * The world point at `+0x194` is the link's **foot**, not where its model is
 * drawn: the routine translates down 1.5 before it stores. That is the shot
 * sphere's centre, and the drop's `x`/`z`. The port's shot point is world
 * space where the engine's `+0x70` is view space (`BreakableProp.shotX`).
 */
export function ChainSegmentUpdate(p: BreakableProp, rng: Rng,
                                   events?: Events): void {
  const c = p.chain!;
  PropDrawBegin(p);
  // `MOV [EDX*4 + 0x7DCD18], ESI` -- before anything can return.
  G.g_chain_segments[c.group * CHAIN_SEGMENTS + c.index] = p.id;
  if (G.g_scene_index === 1
      && (G.g_script_flags[SCRIPT_FLAG_CLEAR_PROPS] ?? 0) !== 0) {
    ActorDespawnProp(p);
    return;
  }
  // `MOVSX AX, byte [+0x1AE]; CMP word [g_evt_step_index], AX`.
  if (s16(G.g_evt_step_index) !== c.lastStep) {
    c.steps = s8(c.steps + 1);
    // `MOVSX CX, CL; CMP CX, word [+0x11C]; JLE` -- out once it is past.
    if (c.steps > c.lifetime) {
      ActorDespawnProp(p);
      return;
    }
    c.lastStep = s8(G.g_evt_step_index);
  }

  if ((p.flags & BreakableFlag.Hit) !== 0) {
    BreakablePropAwardHit(p.flags, false, rng);
    p.flags &= ~BreakableFlag.Hit;
    events?.emit("sound.play", { id: SFX_CHAIN_HIT });
    // `SpawnPropHitEffectAtDepth(+0x78, +0x19C, player, 1.25)`: the crosshair
    // unprojected at the link's own depth (`combat/shot.ts` left it in
    // `hitAim`), at the link's world `z`. The third argument picks the
    // spark's player and the port's spark does not draw it differently.
    if (p.hitAim) {
      SpawnPropHitEffectScaled(p.hitAim.x, p.hitAim.y, c.wz,
                               CHAIN_HIT_EFFECT_SCALE);
    }
    if (G.g_GameMode === GameMode.Original
        && c.group === CHAIN_BRANCH_GROUP) {
      // `MOV EAX, [0x007DCD68]` -- `g_chain_segments[1 * 0x14 + 0]`.
      const seg0 = ChainSegmentAt(CHAIN_BRANCH_GROUP, 0);
      if (seg0?.chain && seg0.chain.latch === ChainLatch.Open
          && G.g_evt_block_index === BranchBlock.Chain) {
        seg0.chain.latch = ChainLatch.Shot;
        G.g_script_branch_var = 2;
      }
    }
    // Four draws, in the order the listing makes them: each pair is the
    // `& 1` first and the `% 0x51` second.
    const flipA = rng.int(2);
    const a = rng.int(SWING_SPREAD) - flipA * SWING_FLIP + SWING_BASE;
    const flipB = rng.int(2);
    const b = rng.int(SWING_SPREAD) - flipB * SWING_FLIP + SWING_BASE;
    for (let j = Math.max(c.index - SWING_LINKS_ABOVE, 0);
         j < CHAIN_SEGMENTS; j++) {
      let f: number;
      if (j < c.index) {
        // `FILD k; FMUL 0.25; FSUBR 1.0`.
        f = SWING_FALLOFF_ONE - (c.index - j) * SWING_FALLOFF_STEP;
      } else {
        // `FILD k; FMUL 0.25; FADD 1.0; FILD k*k; FMUL 0.09; FSUBP`.
        const k = j - c.index;
        f = (k * SWING_FALLOFF_STEP + SWING_FALLOFF_ONE)
          - (k * k) * SWING_FALLOFF_SQUARE;
      }
      // Through the table with no test, as the engine writes through its
      // pointer: all twenty are built together and leave together.
      const seg = ChainSegmentAt(c.group, j)!.chain!;
      seg.pitchRate = FtolS16(a * f);
      seg.rollRate = FtolS16(b * f);
    }
  }
  // `AND ECX, 0xFFFFFFF9` -- both players' bits, every frame.
  p.flags &= ~(BreakableFlag.HitByPlayer0 | BreakableFlag.HitByPlayer1);

  if (c.index === 0 && c.latch === ChainLatch.Shot) {
    c.latch = ChainLatch.Dropped;
    SpawnChainItemDrop(CHAIN_ITEM_DROP_Y, CHAIN_ITEM_ROW, p, rng);
  }

  // The spring, in sixteen bits: the rate is pulled back by a 48th of
  // (angle + rate), and the angle takes the new rate.
  c.pitchRate = s16(c.pitchRate
    - Math.trunc((c.pitch + c.pitchRate) / SWING_SPRING_DIVISOR));
  c.rollRate = s16(c.rollRate
    - Math.trunc((c.roll + c.rollRate) / SWING_SPRING_DIVISOR));
  c.pitch = s16(c.pitchRate + c.pitch);
  c.roll = s16(c.rollRate + c.roll);

  const m = PropMatrixPush();
  if (c.index === 0) {
    MatrixTranslate(m, c.ax, c.ay, c.az);
  } else {
    // `MOV ECX, [EAX*4 + 0x7DCD14]` -- the table one entry back, the link
    // above. PlaceChainSegments builds all twenty in one call and every way
    // out of this routine takes all twenty on the same frame, so it is there.
    MatCopy(m, ChainSegmentAt(c.group, c.index - 1)!.chain!.m);
  }
  MatrixRotateZ(m, c.roll);
  MatrixRotateX(m, c.pitch);
  const link = PropMatrixPush(m);
  MatrixRotateY(link, c.yaw);
  PropDrawSlot(p, link, CHAIN_LINK_SLOT);
  MatrixTranslate(m, 0, CHAIN_LINK_DROP, 0);
  MatCopy(c.m, m);
  // `SetTop(g_camera_blocks[g_camera_index]); MatrixMultiply(+0x1C0)`: the
  // view-to-world over a matrix built on the world-to-view, which is the
  // world matrix the port built from the identity.
  const foot = vec3(0, 0, 0);
  MatrixGetTranslation(c.m, foot);
  c.wx = foot.x; c.wy = foot.y; c.wz = foot.z;
  PropRegisterForShotTest(p, c.wx, c.wy, c.wz);
}

/**
 * `SpawnChainItemDrop` — `FUN_004699C0`. `(y, row, segment)`.
 *
 * `SpawnOriginalItemDrop`'s object (`OriginalItemDropUpdate`, `0x378`
 * bytes) with its own position rule and its item pick inline:
 *
 * ```c
 * obj = ActorAlloc(OriginalItemDropUpdate, 0x378); ActorClearGameFields(obj);
 * obj->+0x34 = 0x80000001;  obj->+0x11C = seg->+0x11C;        // no + 2
 * obj->+0x19C = seg->+0x194;  obj->+0x1A0 = y;  obj->+0x1A4 = seg->+0x19C;
 * obj->+0x197 = seg->+0x1AF;  obj->+0x196 = seg->+0x1AE;
 * obj->+0x124 = 3.0;
 * row = g_original_item_tables[g_scene_index] + n * 8;
 * r = rand() % (s8)row[7];  i = 0;
 * while ((s8)row[4 + i] <= r && i < 3) i++;
 * obj->+0x290 = (s8)row[i];
 * if (obj->+0x290 != -1) obj->+0x28C/+0x28E/+0x2C4 = g_original_item_records[id];
 * ```
 *
 * `PickOriginalModeItem` (`FUN_004629C0`) written out, with one difference
 * that is the reason it is not called: a row that picks nothing writes
 * nothing, where the routine writes the 1.0 scale. That object leaves on its
 * first update before it draws, so no frame shows it.
 *
 * The drop lands under the link that was segment 0's foot, at the world
 * height 18 -- two below stage 2 block 22's anchor at 20.
 */
export function SpawnChainItemDrop(y: number, row: number,
                                   seg: BreakableProp, rng: Rng):
    BreakableProp {
  const c = seg.chain!;
  const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
  // `ActorClearGameFields`, as `SpawnOriginalItemDrop` has it.
  p.storyItem = 0;
  p.removeFlag = 0;
  p.key0 = p.key1 = p.key2 = p.key3 = 0;
  p.family = PropFamily.OriginalItemDrop;
  p.at = seg.at;
  p.flags = 0x80000000 | BreakableFlag.Live;
  p.lifetime = c.lifetime;
  p.x = c.wx;
  p.y = y;
  p.z = c.wz;
  p.stepsElapsed = c.steps;
  p.lastStepIndex = c.lastStep;
  p.hitRadius = ORIGINAL_ITEM_DROP_RADIUS;
  const w = PropWords(p, PICKED_ITEM_WORDS_ZERO);
  const tbl = T.breakables?.original_items;
  const r = tbl?.rows[String(row)];
  const draw = rng.int(r ? r.weights[3] : 0);
  let i = 0;
  if (r) {
    while (r.weights[i] <= draw && i < 3) i++;
  }
  const id = r ? r.ids[i] : -1;
  w.o290 = id;
  const rec = id === -1 ? undefined : tbl?.records[String(id)];
  if (rec) {
    p.slot = rec.slot;
    w.o28e = (rec.slot2 << 16) >> 16;
    w.o2c4 = rec.scale;
  } else {
    // `ActorClearGameFields` left `+0x28C` zero and nothing writes it.
    p.slot = 0;
  }
  G.g_breakable_props.push(p);
  return p;
}
