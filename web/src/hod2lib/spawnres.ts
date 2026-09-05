/**
 * Resolve a spawn descriptor to what it actually is, and to geometry.
 * The port of `tools/hod2lib/spawnres.py`.
 *
 * A spawn descriptor names a **class**; the class handler turns that into a
 * **character type** or an asset slot; the character type names a **skeleton**
 * in the EXE, whose nodes name asset slots; and a slot resolves through the
 * asset slot table to a **pol file**. Those filenames are the closest thing
 * this binary has to a name table -- `cat.bin`, `zabat.bin`, `hito_oyaji.bin`
 * -- and they are how a spawn gets identified without guessing.
 */

import { SPAWN_HEADER } from "./evt";
import type { ParamKind, Spawn } from "./evt";
import type { ExeTables } from "./exetab";

export type CharTypeRule =
  | ["literal", number]
  | ["tail", number, ParamKind]
  | ["desc24"];

/**
 * How each class finds its character type (`obj+0x1F4`), from the handler
 * decompilations in `docs/formats/spawns.md`. `["tail", n, kind]` reads the
 * parameter tail at `obj+0x1390 + n` (or `obj+0x130C + n` for opcode 0x0C --
 * same file offset either way); `["desc24"]` is the opcode-0x09 path, where
 * `FUN_004088A0` copies `(s8)desc+0x24` straight to `obj+0x1F4`;
 * `["literal", v]` is a constant the handler stores.
 */
export const CHAR_TYPE_RULES: Record<number, CharTypeRule> = {
  0x10: ["tail", 0x00, "i8"],    // civilian; the type char picks the model
  0x11: ["tail", 0x00, "u16"],   // plain script-spawned enemy
  0x14: ["tail", 0x00, "u8"],    // multi-part enemy
  0x19: ["literal", 0x7c],       // FUN_004917E0 stores 0x7C
  0x20: ["tail", 0x00, "i8"],    // one-hit target; OneHitTargetInit's tail+0
  // The rescue target. It spawns through opcode 0x09, which copies
  // `(s8)desc+0x24` straight to `obj+0x1F4`, and `RescueTargetInit` reads that
  // field rather than writing one -- so the descriptor names the type. The one
  // shipped spawn carries 7, the same `char_adv00.bin` class 0x20 uses.
  // Without this rule the actor is never built and stage 2's first branch
  // cannot be answered.
  0x21: ["desc24"],
  0x22: ["literal", 0x45],       // FUN_0049B0D0 stores 0x45
  0x24: ["tail", 0x04, "i8"],    // set-piece prop: tail+4 -> obj+0x1F4
  0x25: ["tail", 0x00, "i8"],    // scripted humanoid
  0x2d: ["literal", 0x4c],       // FUN_00426A70 stores 0x4C
  0x30: ["tail", 0x00, "i8"],    // the zombie
  0x31: ["tail", 0x00, "i8"],    // humanoid enemy, subtypes 0x16-0x19
  0x32: ["tail", 0x00, "i8"],    // enemy, per-instance asset
  0x53: ["literal", 0x1a],       // FUN_00431250 stores 0x1A -- cat.bin
};

export class ResolvedSpawn {
  constructor(
    /** The `evt.Spawn` record. */
    readonly spawn: Spawn,
    readonly charType: number | null = null,
    readonly assetFile: string | null = null,
    readonly nodeCount = 0,
    readonly note = "",
  ) {}

  get identified(): boolean {
    return this.assetFile !== null;
  }
}

/** The signed byte at `desc+0x24`, for the opcode-0x09 spawns. */
function desc24I8(spawn: Spawn): number | null {
  if (spawn.evt === null) return null;
  const off = spawn.offset + SPAWN_HEADER;
  if (off < 0 || off >= spawn.evt.raw.length) return null;
  return (spawn.evt.raw[off] << 24) >> 24;
}

/** Identify one spawn descriptor. */
export function resolveSpawn(tables: ExeTables, spawn: Spawn): ResolvedSpawn {
  const rule = CHAR_TYPE_RULES[spawn.cls];
  let ct: number | null = null;
  if (rule === undefined) {
    // Deliberately no fallback. Opcode 0x09 does copy desc+0x24 into
    // obj+0x1F4, but plenty of classes then use that field for something else
    // entirely -- class 0x41 uses it as the prop's lifetime in event blocks.
    // Reading it as a character type anyway "identified" 962 of 1225 spawns,
    // most of them as char_adv02 simply because a lifetime of 0 is character
    // type 0. A class earns a rule by having its handler read; it does not get
    // one by default.
    return new ResolvedSpawn(spawn, null, null, 0,
                             "no character-type rule for this class");
  }
  if (rule[0] === "literal") {
    ct = rule[1];
  } else if (rule[0] === "tail") {
    ct = spawn.param(rule[1], rule[2]);
  } else {
    // Opcode 0x09's path: `FUN_004088A0` copies `(s8)desc+0x24` straight to
    // `obj+0x1F4` and there is no parameter block, so `Spawn.param` -- which
    // refuses every opcode but 0x0B/0x0C/0x0D -- cannot read it. This is that
    // byte, read where it lies.
    ct = desc24I8(spawn);
  }

  if (ct === null || ct < 0) {
    return new ResolvedSpawn(spawn, null, null, 0,
                             "no character-type rule for this class");
  }
  const skel = tables.characterSkeleton(ct);
  if (!skel.length) {
    return new ResolvedSpawn(spawn, ct, null, 0,
      `type 0x${ct.toString(16).padStart(2, "0")} has no skeleton`);
  }
  return new ResolvedSpawn(spawn, ct, tables.characterAssetFile(ct),
                           skel.length);
}

/**
 * Identify every spawn descriptor the stage's event script reaches.
 *
 * The reference implementation builds the `Program` itself and swallows a
 * failure with a `degraded.note`; here the caller has usually built one
 * already -- `bundle` builds exactly one and hands it round -- so it is passed
 * in, and a null one is the same "no resolved spawns" answer without the
 * exception to catch.
 */
export function resolveStageSpawns(tables: ExeTables,
                                   spawnRecords: Spawn[] | null):
    ResolvedSpawn[] {
  return (spawnRecords ?? []).map((rec) => resolveSpawn(tables, rec));
}
