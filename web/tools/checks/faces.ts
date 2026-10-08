/**
 * The faces that talk, held to the exe: the civilian mouth and the scripted
 * humanoid's talking and blinking head.
 *
 *     node tools/run_ts.mjs tools/checks/faces.ts --game-dir "<install>"
 *
 * What it holds, and where each claim is written down:
 *
 *  * **The hooks are installed where the docs say**: `CivilianInit` writes
 *    `CivilianDrawBonePart` (`0x0048D1F0`) into `model+0x1158` at
 *    `0x0048A60B`, `ScriptedHumanoidInit` writes `ScriptedHumanoidBoneDrawHook`
 *    (`0x00485260`) at `0x004841AD`. `civilians.md`, "The mouth";
 *    `spawns.md`, `op 14`.
 *  * **Op `0x25` is the mouth**: jump-table entry `0x25` of
 *    `CivilianRunScript` is `0x0048C0B0`, whose three stores are `sub+0xA4`,
 *    `sub+0xA8` and `sub+0xA0` from `EBP`, which the routine zeroes on
 *    entry. `game/class10/ops.ts`'s `SetMouth`.
 *  * **`CivilianDrawBonePart`'s arm is the one ported**: the `6` it compares
 *    the row with, the row and count loads at `0x0056B950`/`0x0056B954`
 *    eight bytes a row, the `SUB ECX, 2` that picks the hand-over and the
 *    `3` it hands over to. `game/class10/head.ts`.
 *  * **The six rows** are pointers into the image with a positive count, and
 *    `faces.ts`'s `civilianMouthTables` returns them byte for byte; the two
 *    words after row 5 are not a row. `civilians.md`'s table.
 *  * **`ScriptedHumanoidBoneDrawHook`'s face arms**: the `0x1330` loads and
 *    `CMP 2`/`CMP 1`, both table loads at `0x00596C80`/`0x00596C90`, the
 *    unsigned `DIV` by `0x96` and the `CMP EBP, 0xD`, and every `ADD r, imm32`
 *    base equal to `game/class25/face.ts`'s `FACE_TALK_BASES`,
 *    `FACE_TALK_TWO_BASE` and `FACE_BLINK_BASES`.
 *  * **With a bundle, for every stage it holds**: the three tables are the
 *    exe's, and every head a placed civilian's script or a placed class-0x25
 *    program can make its hook draw has a `gore_<slot>` model to clone --
 *    which is what the renderer needs to show it.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gameDirOrSkip, openGame, Checker, hex } from "../lib/exe_check";
import { bundleDir, bytesAt, toHex } from "./lib_d3d";
import * as evt from "../../src/hod2lib/evt";
import { i8, u32 } from "../../src/hod2lib/bytes";
import { Stage } from "../../src/hod2lib/stage";
import { attachmentList } from "../../src/hod2lib/placement";
import { civilianMouthRows } from "../../src/hod2lib/actorscript";
import { humanoidFaceModes } from "../../src/hod2lib/charmotion";
import {
  CIVILIAN_MOUTH_ROWS, CIVILIAN_MOUTH_TABLES, HUMANOID_FACE_CELS,
  HUMANOID_FACE_CELS_TWO, HUMANOID_FACE_CYCLE, civilianMouthTables,
  humanoidFaceCels,
} from "../../src/hod2lib/faces";
import {
  CIVILIAN_HEAD_BONE, CIVILIAN_MOUTH_HANDOFF_FROM, CIVILIAN_MOUTH_HANDOFF_TO,
} from "../../src/game/class10/head";
import { CIVILIAN_MOUTH_NONE } from "../../src/game/class10/state";
import {
  FACE_BLINK_BASES, FACE_MODE_TALK, FACE_TALK_BASES, FACE_TALK_TWO_BASE,
  HumanoidFaceSlots,
} from "../../src/game/class25/face";

/** Instruction bytes, each read where the doc comment cites it. */
const PINS: [number, string, string][] = [
  [0x0048a60b, "c78058110000f0d14800",
   "CivilianInit: MOV [EAX+0x1158], CivilianDrawBonePart"],
  [0x004841ad, "c7875811000060524800",
   "ScriptedHumanoidInit: MOV [EDI+0x1158], ScriptedHumanoidBoneDrawHook"],
  [0x0048ba1a, "ff248d58c24800", "CivilianRunScript: JMP [ECX*4 + 0x48C258]"],
  [0x0048c2ec, "b0c04800", "the jump table's entry 0x25 is 0x0048C0B0"],
  [0x0048b9e8, "33ed", "CivilianRunScript: XOR EBP, EBP on entry"],
  [0x0048c0b6, "8988a4000000", "op 0x25: MOV [EAX+0xA4], ECX (the frames)"],
  [0x0048c0c4, "8990a8000000", "op 0x25: MOV [EAX+0xA8], EDX (the row)"],
  [0x0048c0d0, "89a9a0000000", "op 0x25: MOV [ECX+0xA0], EBP (a zero cursor)"],
  [0x0048d24b, "bf06000000", "CivilianDrawBonePart: MOV EDI, 6"],
  [0x0048d7e0, "8bb1a8000000", "CivilianDrawBonePart: MOV ESI, [ECX+0xA8]"],
  [0x0048d7e6, "3bf7", "CivilianDrawBonePart: CMP ESI, EDI -- the row against 6"],
  [0x0048d7f4, "8d3cf554b95600", "LEA EDI, [ESI*8 + 0x56B954] -- the count"],
  [0x0048d7fe, "8b04f550b95600", "MOV EAX, [ESI*8 + 0x56B950] -- the cels"],
  [0x0048d83b, "83e902", "SUB ECX, 2 -- row 2 hands over"],
  [0x0048d84b, "c780a800000003000000", "MOV [EAX+0xA8], 3 -- to row 3"],
  [0x0048535f, "8b863013000083f802", "the hook: MOV EAX, [ESI+0x1330]; CMP EAX, 2"],
  [0x004854f9, "83f801", "the hook: CMP EAX, 1"],
  [0x00485396, "0fbe92806c5900", "MOVSX EDX, byte [EDX + 0x596C80]"],
  [0x004854c5, "0fbe92906c5900", "MOVSX EDX, byte [EDX + 0x596C90]"],
  [0x004852d1, "b996000000", "MOV ECX, 0x96 -- the blink's period"],
  [0x004852e6, "f7f1", "DIV ECX -- unsigned"],
  [0x00485502, "83fd0d", "CMP EBP, 0xD -- thirteen blinking frames"],
];

/** `ADD r32, imm32` sites, by the base they add: `81 /0 id` or `05 id`. */
const TALK_ADDS: [number, number][] = [
  [0x0048539d, 0x39], [0x004853be, 0x3a], [0x004853df, 0x3b],
  [0x00485400, 0x3c], [0x00485421, 0x3d], [0x00485442, 0x3e],
  [0x00485488, 0x3f],
];
const TWO_ADD = 0x004854cc;
const BLINK_ADDS: [number, number][] = [
  [0x00485567, 0x39], [0x00485546, 0x3a], [0x00485537, 0x3b],
];

/** The immediate of an `ADD r32, imm32` at `va`. */
function addImm(bytes: Uint8Array): number | null {
  if (bytes[0] === 0x05) return u32(bytes, 1);
  if (bytes[0] === 0x81 && (bytes[1]! & 0xf8) === 0xc0) return u32(bytes, 2);
  return null;
}

interface Placement { at: number; class?: number; char_type?: number; attachments?: number[] | null }
interface Characters {
  civilian_mouth_tables?: number[][];
  humanoid_face_cels?: number[];
  humanoid_face_cels_two?: number[];
  attachments?: { bone: number; slot: number }[];
  types?: Record<string, { bones: { bone: number; slot: number }[] }>;
  placements: Placement[];
}
interface Manifest { stages: { stage: number; name: string; script: string; geometry: string }[] }

function sameList(a: readonly number[] | null | undefined, b: readonly number[]): boolean {
  return !!a && a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Every asset slot the client can clone: `CharacterLayer`'s `_gore_<slot>`. */
function cloneable(glb: string): Set<number> {
  const buf = readFileSync(glb);
  const len = buf.readUInt32LE(12);
  const doc = JSON.parse(buf.subarray(20, 20 + len).toString("utf8")) as
    { nodes?: { name?: string }[] };
  const out = new Set<number>();
  for (const n of doc.nodes ?? []) {
    const m = /_gore_([0-9a-f]{4})$/.exec(n.name ?? "");
    if (m) out.add(Number.parseInt(m[1]!, 16));
  }
  return out;
}

async function main(): Promise<void> {
  const dir = gameDirOrSkip("faces");
  const { source, exe } = await openGame(dir);
  const c = new Checker("faces");

  // -- the instructions -----------------------------------------------------
  for (const [va, want, what] of PINS) {
    c.eq(toHex(bytesAt(exe, va, want.length / 2)), want, `${hex(va, 8)} ${what}`);
  }
  c.eq(CIVILIAN_MOUTH_NONE, 6, "class10/state.ts's CIVILIAN_MOUTH_NONE is the 6 at 0x0048D24B");
  c.eq(CIVILIAN_MOUTH_HANDOFF_FROM, 2, "the hand-over is from row 2");
  c.eq(CIVILIAN_MOUTH_HANDOFF_TO, 3, "...to row 3");
  c.eq(CIVILIAN_HEAD_BONE, 2, "the arm is bone 2's");
  c.eq(CIVILIAN_MOUTH_ROWS, CIVILIAN_MOUTH_NONE, "a row for every mode below 6");
  for (const [va, type] of TALK_ADDS) {
    c.eq(addImm(bytesAt(exe, va, 6)), FACE_TALK_BASES[type] ?? null,
         `${hex(va, 8)}: type ${hex(type, 2)}'s talking base`);
  }
  c.eq(addImm(bytesAt(exe, TWO_ADD, 6)), FACE_TALK_TWO_BASE,
       `${hex(TWO_ADD, 8)}: type 0x36's talking base`);
  for (const [va, type] of BLINK_ADDS) {
    c.eq(addImm(bytesAt(exe, va, 6)), FACE_BLINK_BASES[type] ?? null,
         `${hex(va, 8)}: type ${hex(type, 2)}'s blinking base`);
  }
  c.eq(Object.keys(FACE_TALK_BASES).length, TALK_ADDS.length,
       "face.ts names no talking base the hook lacks");
  c.eq(Object.keys(FACE_BLINK_BASES).length, BLINK_ADDS.length,
       "face.ts names no blinking base the hook lacks");

  // -- the tables -----------------------------------------------------------
  const rows: number[][] = [];
  for (let m = 0; m < CIVILIAN_MOUTH_ROWS; m++) {
    const ptr = exe.ru32(CIVILIAN_MOUTH_TABLES + m * 8);
    const count = exe.ri32(CIVILIAN_MOUTH_TABLES + m * 8 + 4);
    const o = ptr === null ? null : exe.v2r(ptr);
    if (!c.ok(o !== null && count !== null && count > 0,
              `row ${m}: a pointer into the image (${hex(ptr ?? 0, 8)}) and a count (${count})`)) continue;
    const row: number[] = [];
    for (let i = 0; i < count!; i++) row.push(i8(exe.data, o! + i));
    rows.push(row);
  }
  const after = exe.ru32(CIVILIAN_MOUTH_TABLES + CIVILIAN_MOUTH_ROWS * 8);
  c.ok(after === null || exe.v2r(after) === null || after < 0x00400000,
       `the word after row 5 (${hex(after ?? 0, 8)}) is not a pointer into the image`);
  const lib = civilianMouthTables(exe);
  c.ok(lib.length === rows.length && lib.every((r, i) => sameList(r, rows[i]!)),
       "faces.ts's civilianMouthTables is the six rows byte for byte");
  const ramp = humanoidFaceCels(exe, HUMANOID_FACE_CELS);
  const two = humanoidFaceCels(exe, HUMANOID_FACE_CELS_TWO);
  c.ok(sameList(ramp, [0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1, 0]),
       `g_class25_face_cels is the ramp: ${ramp.join(" ")}`);
  c.ok(two.length === HUMANOID_FACE_CYCLE && two.every((v) => v === 0 || v === 1),
       `g_class25_face_cels_two is thirteen cels of 0 and 1: ${two.join(" ")}`);

  // -- the bundle -----------------------------------------------------------
  const bd = bundleDir();
  if (!bd) {
    c.note("no bundle: the exported tables and the head models are unchecked");
    c.finish();
  }
  const manifest = JSON.parse(readFileSync(join(bd!, "manifest.json"), "utf8")) as Manifest;
  const recs = exe.attachmentRecords();
  const civ = exe.civilianScripts();
  let stages = 0, civs = 0, hums = 0, heads = 0;
  for (const entry of manifest.stages) {
    const name = entry.name;
    const script = join(bd!, name, entry.script);
    const glb = join(bd!, name, entry.geometry);
    if (!c.ok(existsSync(script) && existsSync(glb), `${name}: the manifest's files are there`)) continue;
    stages++;
    const chars = (JSON.parse(readFileSync(script, "utf8")) as { characters: Characters }).characters;
    const got = chars.civilian_mouth_tables ?? [];
    c.ok(got.length === rows.length && got.every((r, i) => sameList(r, rows[i]!)),
         `${name}: civilian_mouth_tables is the exe's six rows`);
    c.ok(sameList(chars.humanoid_face_cels, ramp), `${name}: humanoid_face_cels is the exe's`);
    c.ok(sameList(chars.humanoid_face_cels_two, two), `${name}: humanoid_face_cels_two is the exe's`);

    const st = await Stage.create(source, { stage: entry.stage, original: name.endsWith("_original") });
    const ev = await st.evt();
    if (!c.ok(ev !== null, `${name}: its evt reads`) || !ev) continue;
    const placed = new Set(chars.placements.map((p) => p.at));
    const clones = cloneable(glb);
    const missing: string[] = [];
    for (const sp of evt.spawns(ev)) {
      if (!placed.has(sp.offset)) continue;
      const ct = sp.param(0, "i8") ?? 0;
      if (sp.cls === 0x10) {
        const want = civilianMouthRows(civ, sp.param(0x01, "i8") || 0);
        if (!want.length) continue;
        civs++;
        // `ActorBindPartList`'s last head, or the skeleton's own.
        let head = chars.types?.[String(ct)]?.bones
          .find((b) => b.bone === CIVILIAN_HEAD_BONE)?.slot ?? 0;
        for (const id of attachmentList(ev, sp, sp.cls, recs.length)) {
          const r = recs[id];
          if (id < 0x24 && r && r.bone === CIVILIAN_HEAD_BONE && r.slot) head = r.slot;
        }
        const rowsUsed = new Set(want);
        if (rowsUsed.has(2)) rowsUsed.add(3);
        for (const r of rowsUsed) {
          for (const cel of rows[r] ?? []) {
            heads++;
            if (!clones.has(head + cel)) missing.push(`${hex(sp.offset)} row ${r} ${hex(head + cel, 4)}`);
          }
        }
      }
      if (sp.cls === 0x25) {
        const talks = humanoidFaceModes(ev, sp).includes(FACE_MODE_TALK);
        const slots = HumanoidFaceSlots(ct, talks, ramp, two);
        if (!slots.length) continue;
        hums++;
        for (const s of slots) {
          heads++;
          if (!clones.has(s)) missing.push(`${hex(sp.offset)} type ${hex(ct, 2)} ${hex(s, 4)}`);
        }
      }
    }
    c.ok(!missing.length, `${name}: every head a talking or blinking spawn can draw is a gore_ template`
         + (missing.length ? `; missing ${missing.slice(0, 6).join("; ")}` : ""));
  }
  c.ok(stages > 0, `${stages} stage bundles read`);
  c.note(`${stages} stage bundles: ${civs} talking civilians and ${hums} talking or blinking `
         + `humanoids placed, ${heads} heads, each with a model to clone`);
  c.finish();
}

await main();
