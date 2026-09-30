/**
 * Resolve a spawn descriptor to what it actually is, and to geometry.
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
  | ["desc24"]
  | ["class45"];

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
  // **The character type is the tail's first byte, not 0x7C.** This row read
  // `["literal", 0x7c]` with the comment "FUN_004917E0 stores 0x7C", and it
  // does -- into `char+0x20`, which is `obj+0x1B4`, the **clip**:
  //
  //     0049182e  MOVZX DX, byte ptr [EDI]          ; EDI = obj+0x130C, the tail
  //     00491832  MOV word ptr [EAX + 0x60], DX     ; char+0x60 == obj+0x1F4
  //     0049183e  MOV dword ptr [ECX + 0x20], 0x7C  ; char+0x20 == obj+0x1B4
  //
  // Two instructions apart, and the wrong one was taken. Type 0x7C has no
  // skeleton at all, so every class-0x19 spawn resolved to "no skeleton",
  // never became a placement and never reached a bundle; the four shipped
  // tails all carry 0x4A, which is `boss4.bin` with fifteen nodes -- one per
  // per-bone model pointer in the same tail. See `game/class19/`.
  0x19: ["tail", 0x00, "u8"],    // the stage-4 boss
  0x20: ["tail", 0x00, "i8"],    // one-hit target; OneHitTargetInit's tail+0
  // The rescue target. It spawns through opcode 0x09, which copies
  // `(s8)desc+0x24` straight to `obj+0x1F4`, and `RescueTargetInit` reads that
  // field rather than writing one -- so the descriptor names the type. The one
  // shipped spawn carries 7, the same `char_adv00.bin` class 0x20 uses.
  // Without this rule the actor is never built and stage 2's first branch
  // cannot be answered.
  0x21: ["desc24"],
  0x22: ["literal", 0x45],       // FUN_0049B0D0 stores 0x45
  // `Class23Init` (`FUN_0048FD90`): `MOV word ptr [..+0x60], 0x44` at
  // `0x0048FDD9`. The nested descriptor's own `tail+0x00` holds 0x44 as well
  // and is never read.
  0x23: ["literal", 0x44],
  0x24: ["tail", 0x04, "i8"],    // set-piece prop: tail+4 -> obj+0x1F4
  0x25: ["tail", 0x00, "i8"],    // scripted humanoid
  0x2d: ["literal", 0x4c],       // FUN_00426A70 stores 0x4C
  0x30: ["tail", 0x00, "i8"],    // the zombie
  0x31: ["tail", 0x00, "i8"],    // humanoid enemy, subtypes 0x16-0x19
  0x32: ["tail", 0x00, "i8"],    // enemy, per-instance asset
  // `CarriedZombieInit18` (`FUN_0045CD60`) opens on `EnemyZombieInit`, so a
  // class-0x18 spawn is a class-0x30 zombie in every respect that reaches the
  // character layer -- same tail, same first byte. All three carry 5,
  // `znnick.bin`, which stage 3 already loads for its ordinary zombies.
  0x18: ["tail", 0x00, "i8"],    // the zombie that rides a carrier
  // `PlaceBats` (`FUN_0042D9C0`) writes `obj+0x1F4 = 0x1E` as a literal on
  // every member of every flight -- `zabat.bin`, one node, asset slot
  // `0x1B01`. The descriptor's own `+0x24` is the flight GROUP here and not a
  // character type, so `desc24` would resolve stage 4's four flights to types
  // 0, 2 and 3 and stage 3's to 1. The wing actor's `0x1F` has no rule because
  // it has no descriptor: see the note in `game/class46/`.
  0x46: ["literal", 0x1e],   // the bat
  // The stage-3 boss, five heads and a body and three civilians under one
  // class id -- see `class45Type` below and `game/class45/`.
  0x45: ["class45"],
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

/** `desc+0x25`, the class-0x45 sub-type byte `EvtOpSpawnPlaced09` copies. */
function desc25I8(spawn: Spawn): number | null {
  if (spawn.evt === null) return null;
  const off = spawn.offset + SPAWN_HEADER + 1;
  if (off < 0 || off >= spawn.evt.raw.length) return null;
  return (spawn.evt.raw[off] << 24) >> 24;
}

/**
 * Class 0x45's character type, which no single-field rule can express: it is
 * picked by the **sub-type** at `desc+0x25`, and for the fighting heads by the
 * **index** at `desc+0x22` as well. Each sub-type's init writes it, as a
 * literal or not at all (`docs/re/boss-tower.md`):
 *
 * | `desc+0x25` | init | type |
 * |---|---|---|
 * | 0 | `Boss3OpeningHeadInit` (`FUN_0041FDB0`), `0x0041FDCB` | `0x49`, `boss3.bin` |
 * | 1, 3 | `Boss3OpeningBystanderInit` (`FUN_004200F0`), `Boss3HeldBystanderInit` (`FUN_00420180`) | none written: `desc+0x24`, which `EvtOpSpawnPlaced09` copied |
 * | 2 | `Boss3FightHeadInit` (`FUN_0041FE30`) | index 2 `0x48` (`boss3l.bin`), the others `0x49` |
 * | 4 | `NoOpStub` (`FUN_0041EBB0`) | none -- no shipped spawn |
 * | 5 | `Boss3BodyInit` (`FUN_00420360`) | `0x48` |
 */
function class45Type(spawn: Spawn): number | null {
  const sub = desc25I8(spawn);
  switch (sub) {
    case 0: return 0x49;
    case 1: case 3: return desc24I8(spawn);
    case 2: return (spawn.hp & 0xffff) === 2 ? 0x48 : 0x49;
    case 5: return 0x48;
    default: return null;
  }
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
  } else if (rule[0] === "class45") {
    ct = class45Type(spawn);
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
  // The root's file names the character; a type whose nodes span two files
  // (`0x4B`, the stage-5 boss -- see `ExeTables.characterAssetFiles`) is
  // identified all the same, and each node's model is found through its own
  // slot when the rig is built (`charbuild.rigEntry`).
  return new ResolvedSpawn(spawn, ct,
                           tables.characterAssetFiles(ct)[0] ?? null,
                           skel.length);
}
