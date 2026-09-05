/**
 * The little bytecode blobs an actor state steps through.
 * The port of `tools/hod2lib/actorscript.py`.
 *
 * Three shapes, all of them lists of motion entries compiled into Hod2.exe
 * rather than authored in `evt/`: the target scripts `ZombieScriptForState`
 * (`FUN_0045CA10`) hands to the class-0x30 states that work on `obj+0x1394`,
 * the class-0x10 civilian command streams, and the item slots those streams
 * draw. A list ends on the first entry whose motion is below 1.
 */

import { f32, i16, u16 } from "./bytes";
import type { CivCommand, CivItem } from "./exetab";

/**
 * The class-0x30 states that work on `obj+0x1394` -- the object the actor was
 * built for, which for the 47 class-0x10 captors is the civilian.
 *
 * Each takes a script through `ZombieScriptForState`: the descriptor tail's
 * `+0x08` when the actor is in the tail's attack state, `+0x04` otherwise.
 * The blob opens with a header whose shape belongs to the state that
 * *entered* it and continues as a list of motion entries. A list ends on the
 * first entry whose motion is below 1.
 *
 * `[header bytes, shorts per entry]`.
 */
export const TARGET_SCRIPT_SHAPE: Record<number, [number, number]> = {
  34: [10, 4],   // {f32 arrive_dist; u16 loops; u16 motion; u16 frame}
  35: [0, 4],    // straight into the entries
  36: [0, 5],    // ...with a g_script_flags index per entry
  37: [0x38, 4], // the carried-prop record; [open] beyond its motion fields
  38: [20, 4],   // {f32 x, y, z; s16 motion, frame; s16 loops, mode}
  40: [16, 4],   // {f32 x, y, z; s16 motion, frame}
  41: [16, 4],   // the same, arrived at rather than walked past
  43: [4, 0],    // {s16 loops; s16 cue_frame} -- no list
};

export interface TargetScript {
  state: number;
  head: Record<string, unknown>;
  entries: Record<string, number>[];
}

/**
 * Just the part of a `Program` this module reads.
 *
 * `evt` is nullable because a `Program` built for a scene with no event file
 * has none; `targetScript` is only ever reached with an offset that came out
 * of that same file, so the null arm is unreachable in practice and returning
 * null is the honest thing to do about it.
 */
export interface RawSource {
  evt: { raw: Uint8Array } | null;
}

/**
 * One captor script blob, decoded for the state that enters it.
 *
 * The check that the shapes are right is that **every** blob terminates: all
 * 86 the six stages reach end on an entry whose motion is below 1, within 64
 * entries. A wrong header length walks into the middle of a float and the
 * list runs away immediately.
 */
export function targetScript(prog: RawSource, off: number | null | undefined,
                             state: number): TargetScript | null {
  const shape = TARGET_SCRIPT_SHAPE[state];
  if (shape === undefined || off === null || off === undefined) return null;
  const [headLen, per] = shape;
  if (prog.evt === null) return null;
  const raw = prog.evt.raw;
  if (off + headLen > raw.length) return null;
  let head: Record<string, unknown> = {};
  if (state === 34) {
    head = { arrive: f32(raw, off), loops: u16(raw, off + 4),
             motion: u16(raw, off + 6), frame: u16(raw, off + 8) };
  } else if (state === 38 || state === 40 || state === 41) {
    head = {
      point: [f32(raw, off), f32(raw, off + 4), f32(raw, off + 8)],
      motion: i16(raw, off + 12), frame: i16(raw, off + 14),
    };
    if (state === 38) {
      head.loops = i16(raw, off + 16);
      head.mode = i16(raw, off + 18);
    }
  } else if (state === 43) {
    head = { loops: i16(raw, off), cue: i16(raw, off + 2) };
  }
  const entries: Record<string, number>[] = [];
  let p = off + headLen;
  while (per && entries.length < 64 && p + per * 2 <= raw.length) {
    const v: number[] = [];
    for (let k = 0; k < per; k++) v.push(i16(raw, p + k * 2));
    if (v[0] < 1) break;
    const e: Record<string, number> = { motion: v[0], frame: v[1],
                                        loops: v[2], mode: v[3] };
    if (per > 4) e.flag = v[4];
    entries.push(e);
    p += per * 2;
  }
  return { state, head, entries };
}

/** Every clip a decoded captor script names, for the bake list. */
export function targetScriptMotions(script: TargetScript | null): number[] {
  if (!script) return [];
  const out = [(script.head.motion as number | undefined) ?? 0];
  for (const e of script.entries) out.push(e.motion);
  return out.filter((m) => m > 0 && m < 4096);
}

/** The class-0x10 script block `ExeTables.civilianScripts()` returns. */
export interface CivBlock {
  entries: number[];
  scripts: CivCommand[][];
  items: CivItem[];
}

/**
 * The states class 0x10's op 0x1A orders its captors into, from *entry*.
 *
 * `ZombieStateAwaitCivilianOrder` copies `sub+0x2C` straight into
 * `obj+0x1310` and calls that state's handler on the spot, so a captor whose
 * descriptor starts it in state 39 is really a captor of whatever state its
 * civilian names. Op 0x1A is where the name is, and `0x31` is the order to
 * die rather than a state to enter.
 */
export function civilianOrderedStates(block: CivBlock | null,
                                      entry: number): number[] {
  const scripts = block?.scripts ?? [];
  const entries = block?.entries ?? [];
  if (!(entry >= 0 && entry < entries.length)) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  const pending = [entries[entry]];
  while (pending.length) {
    const i = pending.pop()!;
    if (seen.has(i) || !(i >= 0 && i < scripts.length)) continue;
    seen.add(i);
    for (const c of scripts[i]) {
      if (c.op === 0x1a && c.args.length && c.args[0] !== 0x31) {
        out.push(c.args[0] as number);
      }
      for (const j of c.scripts ?? []) if (j >= 0) pending.push(j);
    }
  }
  return out;
}

/**
 * Every clip class 0x10's script *entry* can reach.
 *
 * Ops 0x00 and 0x01 name the clip; ops 0x0E, 0x0F, 0x1E and 0x1F name another
 * stream, so the answer is the transitive closure from the entry rather than
 * one stream's worth. `bake` refuses a clip authored for another skeleton, so
 * the whole set is offered rather than filtered here.
 */
export function civilianMotionIds(block: CivBlock | null,
                                  entry: number): number[] {
  const scripts = block?.scripts ?? [];
  const entries = block?.entries ?? [];
  if (!(entry >= 0 && entry < entries.length)) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  const pending = [entries[entry]];
  while (pending.length) {
    const i = pending.pop()!;
    if (seen.has(i) || !(i >= 0 && i < scripts.length)) continue;
    seen.add(i);
    for (const c of scripts[i]) {
      if (c.op === 0 || c.op === 1) {
        const m = c.args[0] as number;
        if (m > 0 && m < 4096) out.push(m);
      }
      for (const j of c.scripts ?? []) if (j >= 0) pending.push(j);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/**
 * Every asset slot class 0x10's script *entry* can put in a hand.
 *
 * Ops 0x13 and 0x14 name a record directly, op 0x15 a weighted table of them,
 * and a record draws its own slot plus, for some kinds, a fixed second one.
 * All of it goes in the hidden template the client clones from.
 */
export function civilianItemSlots(block: CivBlock | null,
                                  entry: number): Set<number> {
  const scripts = block?.scripts ?? [];
  const entries = block?.entries ?? [];
  const items = block?.items ?? [];
  if (!(entry >= 0 && entry < entries.length)) return new Set();
  const picked = new Set<number>();
  const seen = new Set<number>();
  const pending = [entries[entry]];
  while (pending.length) {
    const i = pending.pop()!;
    if (seen.has(i) || !(i >= 0 && i < scripts.length)) continue;
    seen.add(i);
    for (const c of scripts[i]) {
      if (c.item !== undefined && c.item !== null && c.item >= 0) {
        picked.add(c.item);
      }
      for (const [, k] of c.itemTable ?? []) if (k >= 0) picked.add(k);
      for (const j of c.scripts ?? []) if (j >= 0) pending.push(j);
    }
  }
  const out = new Set<number>();
  for (const k of picked) {
    if (k >= 0 && k < items.length) {
      out.add(items[k].slot);
      if (items[k].extra) out.add(items[k].extra!);
    }
  }
  return out;
}
