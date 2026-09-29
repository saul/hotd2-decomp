/**
 * The attachment table, the lists that name it, and -- with a bundle -- every
 * model those lists and class 0x25's two slot writers can ask the client to
 * clone.
 *
 *     node tools/run_ts.mjs tools/checks/attachments.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * An actor's **attachment list** puts a face on a civilian and hair on top of
 * it. `CivilianInit` (`FUN_0048A3E0`), `ScriptedHumanoidInit` (`FUN_004840D0`)
 * and `SetPiecePropInit` (`FUN_00482CE0`) park a pointer from their tail at
 * `model+0x1170` and call `ActorBindPartList` (`FUN_00412440`);
 * `ActorDrawAttachedParts` (`FUN_004124F0`) draws it after every skeleton
 * node. The ids index `g_actor_attachment_table` (`0x004EC748`). The table is
 * read through `ExeTables.attachmentRecords`, the lists through
 * `hod2lib/placement.ts`'s `attachmentList`, and the bundle is the one
 * `HOTD2_BUNDLE` or `extract/player` holds.
 *
 * What this asserts, and the statement each assertion guards:
 *
 *  * **81 records, by arithmetic**: the record array runs `0x004EC4C0` up to
 *    the pointer table. `docs/formats/civilians.md`, "The face and the hair
 *    are not in the skeleton"; `docs/formats/spawns.md`, "The skeleton is not
 *    the whole character"; `exetab.ts`'s `ATTACHMENT_COUNT`.
 *  * **The split at `0x24` is a literal in both routines** -- `CMP AX, 0x24`
 *    at `0x0041245B` and `0x0041264B` -- and the library's and the port's
 *    constants are it. `game/attachments.ts`'s `ATTACHMENT_REPLACES_BELOW`,
 *    `exetab.ts`'s note.
 *  * **Ids `0x00..0x23` are all bone 2 and name a head; `0x24..0x50` name an
 *    `etc_komono_*` model on bones 2, 1, 12 or 15.** The table in
 *    `civilians.md`. The heads are `hito_kao_*` and `etc_*_kao` except three
 *    that name a `char_adv` file, which are listed here by id.
 *  * **97 spawns carry a list: 52 of 65 class 0x10, 5 of 169 class 0x25 and
 *    40 of 67 class 0x24**, over every `evt/` file, and the largest id any of
 *    them names is `0x50`. `civilians.md`, "The list is not class 0x10's";
 *    `spawns.md`; `characters.ts` beside `attachmentList`; `exetab.ts` above
 *    `ATTACHMENT_TABLE`.
 *  * **`op 9` and `op 16` read the tables the docs name**: the instruction
 *    bytes of `ScriptedHumanoidUpdate` (`FUN_004842A0`) that index
 *    `g_player_hand_slots` (`0x004EC9E0`) three to a row and store bone 5,
 *    and that read `HIT_EFFECT` and skip a code of 2 or less; and ten rows,
 *    the word after them 0. `spawns.md`'s `op 9` and `op 16` notes,
 *    `combat.ts`'s `PLAYER_HAND_SLOTS` and `PLAYER_HAND_ROWS`.
 *  * **With a bundle, for every stage it holds** -- `charbuild.ts`'s
 *    `attachmentSlots` and the template it builds, `spawns.md`'s "every slot
 *    either command can write rides the character's hidden template",
 *    `charbuild.ts`'s note on `ZOMBIE_THROW_SLOTS`:
 *      - its `attachments` rows and `attachment_replaces_below` are the EXE's;
 *      - every placed spawn's list is the one its evt gives it;
 *      - every id a placed spawn names has a `gore_<slot>` model to clone;
 *      - every hand a throwing class-0x30 zombie holds, drops to, and throws
 *        has one;
 *      - its `player_hand_slots` is the EXE's thirty words, and every slot a
 *        placed class-0x25 program's `op 9` or `op 16` writes has a model.
 */
import { closeSync, existsSync, openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import { gameDirOrSkip, openGame, Checker, hex } from "../lib/exe_check";
import { bundleDir, bytesAt, toHex, type GltfDoc } from "./lib_d3d";
import { ExeTables } from "../../src/hod2lib/exetab";
import * as evt from "../../src/hod2lib/evt";
import { i16, u16, u32 } from "../../src/hod2lib/bytes";
import { Stage } from "../../src/hod2lib/stage";
import { attachmentList, ATTACHMENT_TAIL_OFFSET } from "../../src/hod2lib/placement";
import { humanoidModelCommands } from "../../src/hod2lib/charmotion";
import {
  HIT_EFFECT, HIT_STEPS, PLAYER_HAND_ROWS, PLAYER_HAND_SLOTS,
  PLAYER_HAND_VARIANTS, ZOMBIE_THROW_SLOTS,
} from "../../src/hod2lib/combat";
import { ATTACHMENT_REPLACES_BELOW } from "../../src/game/attachments";

/** `civilians.md` and `spawns.md`. */
const RECORDS = 81;
const RECORD_ARRAY = 0x004ec4c0;
const SPLIT = 0x24;
const LARGEST_ID = 0x50;

/** `CMP AX, 0x24` in each routine, `game/attachments.ts`. */
const SPLIT_COMPARES: [number, string][] = [
  [0x0041245b, "ActorBindPartList"],
  [0x0041264b, "ActorDrawAttachedParts"],
];
const CMP_AX_24 = "663d2400";

/** The heads that are not a `*_kao*` file, by id. */
const CHAR_ADV_HEADS: Record<number, string> = {
  0x02: "char_adv02.bin", 0x03: "char_adv01.bin", 0x0e: "char_adv07.bin",
};

/** `civilians.md`: the bones an accessory hangs off. */
const ACCESSORY_BONES = [1, 2, 12, 15];

/** `civilians.md`'s table: class -> `[spawns with a list, spawns]`. */
const LISTS: Record<number, [number, number]> = {
  0x10: [52, 65], 0x25: [5, 169], 0x24: [40, 67],
};
const LISTS_TOTAL = 97;

/**
 * `ScriptedHumanoidUpdate`'s two slot writers, as bytes. The table address
 * and both strides come from these, not from the library's constants.
 */
const OP9_ROW_LEA = 0x0048476b;        // LEA ECX, [EAX+EAX*2]: 3 a row
const OP9_TABLE_LOAD = 0x00484773;     // MOVSX EAX, word [ECX*2 + disp32]
const OP9_BONE5_STORE = 0x0048477b;    // MOV [EDI+0x4DC], EAX: bone 5's slot
const OP16_TABLE_LOAD = 0x004849a7;    // MOV EBP, [EAX*4 + disp32]
const OP16_FILTER = 0x004849b9;        // CMP EAX, 2; JLE: codes 0..2 skip
const OP_BYTES: [number, string, string][] = [
  [OP9_ROW_LEA, "8d0c40", "op 9: LEA ECX,[EAX+EAX*2] -- three variants a row"],
  [OP9_TABLE_LOAD, "0fbf044d", "op 9: MOVSX EAX,word [ECX*2+table]"],
  [OP9_BONE5_STORE, "8987dc040000", "op 9: MOV [EDI+0x4DC],EAX -- bone 5's slot"],
  [OP16_TABLE_LOAD, "8b2c85", "op 16: MOV EBP,[EAX*4+table]"],
  [OP16_FILTER, "83f8027e02", "op 16: CMP EAX,2; JLE -- a code of 2 or less writes nothing"],
];

interface Placement { at: number; attachments?: number[] | null }
interface Characters {
  attachments?: { bone: number; slot: number }[];
  attachment_replaces_below?: number;
  player_hand_slots?: number[];
  placements: Placement[];
}
interface Manifest { stages: { stage: number; name: string; script: string; geometry: string }[] }

function sameList(a: readonly number[] | null | undefined, b: readonly number[]): boolean {
  return !!a && a.length === b.length && a.every((v, i) => v === b[i]);
}

/** A `.glb`'s JSON chunk alone: the node names are all this reads. */
function glbJson(path: string): GltfDoc {
  const fd = openSync(path, "r");
  try {
    const head = new Uint8Array(20);
    readSync(fd, head, 0, 20, 0);
    const len = new DataView(head.buffer).getUint32(12, true);
    const body = new Uint8Array(len);
    readSync(fd, body, 0, len, 20);
    return JSON.parse(new TextDecoder().decode(body)) as GltfDoc;
  } finally {
    closeSync(fd);
  }
}

/** Every asset slot the client can clone: `CharacterLayer`'s `_gore_<slot>`. */
function cloneable(glb: string): Set<number> {
  const out = new Set<number>();
  for (const n of glbJson(glb).nodes ?? []) {
    const m = /_gore_([0-9a-f]{4})$/.exec(n.name ?? "");
    if (m) out.add(Number.parseInt(m[1]!, 16));
  }
  return out;
}

async function main(): Promise<void> {
  const dir = gameDirOrSkip("attachments");
  const { source, exe } = await openGame(dir);
  const c = new Checker("attachments");

  // -- the table ------------------------------------------------------------
  c.eq(ExeTables.ATTACHMENT_COUNT, RECORDS, "ATTACHMENT_COUNT is 81");
  c.eq((ExeTables.ATTACHMENT_TABLE - RECORD_ARRAY) / 8, RECORDS,
       "the record array runs 0x004EC4C0 up to the pointer table at 8 bytes a record");
  const recs = exe.attachmentRecords();
  c.eq(recs.length, RECORDS, "attachmentRecords() returns 81 rows");
  for (const [va, fn] of SPLIT_COMPARES) {
    c.eq(toHex(bytesAt(exe, va, 4)), CMP_AX_24, `${fn} at ${hex(va, 8)}: CMP AX,0x24`);
  }
  c.eq(ExeTables.ATTACHMENT_REPLACES_BELOW, SPLIT, "exetab's ATTACHMENT_REPLACES_BELOW is 0x24");
  c.eq(ATTACHMENT_REPLACES_BELOW, SPLIT, "game/attachments.ts's ATTACHMENT_REPLACES_BELOW is 0x24");

  const slots = exe.assetSlots();
  const heads: string[] = [];
  const accessories: string[] = [];
  recs.forEach((r, i) => {
    const file = slots.get(r.slot)?.[0] ?? "";
    if (i < SPLIT) {
      const want = CHAR_ADV_HEADS[i];
      const ok = r.bone === 2 && (want ? file === want : /_kao(_|\.)/.test(file));
      if (!ok) heads.push(`${hex(i, 2)}: bone ${r.bone}, ${file || hex(r.slot)}`);
    } else {
      const ok = ACCESSORY_BONES.includes(r.bone) && /^etc_komono_.*\.bin$/.test(file);
      if (!ok) accessories.push(`${hex(i, 2)}: bone ${r.bone}, ${file || hex(r.slot)}`);
    }
  });
  c.ok(!heads.length, `ids 0x00..0x23 are bone 2 and a head (${Object.keys(CHAR_ADV_HEADS).length}`
       + " of them a char_adv file)" + (heads.length ? `; not ${heads.join("; ")}` : ""));
  c.ok(!accessories.length, `ids 0x24..0x50 are an etc_komono_* model on bone ${ACCESSORY_BONES.join("/")}`
       + (accessories.length ? `; not ${accessories.join("; ")}` : ""));

  // -- the lists, over every evt ------------------------------------------
  const counts: Record<number, [number, number]> = {};
  let largest = -1;
  const names = (await source.list("evt")).filter((n) => /\.bin$/i.test(n)).sort();
  for (const name of names) {
    const ev = evt.parse(await source.read(`evt/${name}`), name);
    for (const sp of evt.spawns(ev)) {
      if (!(sp.cls in ATTACHMENT_TAIL_OFFSET)) continue;
      const t = counts[sp.cls] ??= [0, 0];
      t[1]++;
      const ids = attachmentList(ev, sp, sp.cls, recs.length);
      if (!ids.length) continue;
      t[0]++;
      largest = Math.max(largest, ...ids);
    }
  }
  for (const [cls, [w, n]] of Object.entries(LISTS)) {
    const got = counts[Number(cls)] ?? [0, 0];
    c.ok(got[0] === w && got[1] === n,
         `class ${hex(Number(cls), 2)}: ${got[0]} of ${got[1]} spawns carry a list, expected ${w} of ${n}`);
  }
  c.eq(Object.values(counts).reduce((a, [w]) => a + w, 0), LISTS_TOTAL,
       `spawns with a list across ${names.length} evt files`);
  c.eq(largest, LARGEST_ID, "the largest id a list names");

  // -- op 9 and op 16's tables --------------------------------------------
  for (const [va, want, what] of OP_BYTES) {
    c.eq(toHex(bytesAt(exe, va, want.length / 2)), want, `${hex(va, 8)} ${what}`);
  }
  const handVa = u32(bytesAt(exe, OP9_TABLE_LOAD + 4, 4), 0);
  const effVa = u32(bytesAt(exe, OP16_TABLE_LOAD + 3, 4), 0);
  c.eq(handVa, PLAYER_HAND_SLOTS, "op 9's table is PLAYER_HAND_SLOTS");
  c.eq(effVa, HIT_EFFECT, "op 16's table is HIT_EFFECT");
  const n = PLAYER_HAND_ROWS * PLAYER_HAND_VARIANTS;
  const handWords = bytesAt(exe, handVa, n * 2 + 2);
  const handRows: number[] = [];
  for (let k = 0; k < n; k++) handRows.push(i16(handWords, k * 2));
  c.eq(i16(handWords, n * 2), 0, `the word after g_player_hand_slots' ${PLAYER_HAND_ROWS} rows is 0`);

  // -- the bundle ---------------------------------------------------------
  const bd = bundleDir();
  if (!bd) {
    c.note("no bundle: the exported tables, lists and models are unchecked");
    c.finish();
  }
  const manifest = JSON.parse(readFileSync(join(bd!, "manifest.json"), "utf8")) as Manifest;
  const effBase = exe.v2r(HIT_EFFECT);
  let stages = 0, lists = 0, ids = 0, hands = 0, humanoid = 0;
  for (const entry of manifest.stages) {
    const name = entry.name;
    const script = join(bd!, name, entry.script);
    const glb = join(bd!, name, entry.geometry);
    if (!c.ok(existsSync(script) && existsSync(glb), `${name}: the manifest's files are there`)) continue;
    stages++;
    const chars = (JSON.parse(readFileSync(script, "utf8")) as { characters: Characters }).characters;
    const got = chars.attachments ?? [];
    const rowsOk = got.length === recs.length
      && got.every((a, i) => a.bone === recs[i]!.bone && a.slot === recs[i]!.slot);
    c.ok(rowsOk, `${name}: attachments is the EXE's ${recs.length} records, row for row`);
    c.eq(chars.attachment_replaces_below, SPLIT, `${name}: attachment_replaces_below`);
    c.ok(sameList(chars.player_hand_slots, handRows),
         `${name}: player_hand_slots is the EXE's ${n} words`);

    const st = await Stage.create(source, { stage: entry.stage, original: name.endsWith("_original") });
    const ev = await st.evt();
    if (!c.ok(ev !== null, `${name}: its evt reads`) || !ev) continue;
    const have = new Map<number, number[]>();
    for (const p of chars.placements) if (!have.has(p.at)) have.set(p.at, p.attachments ?? []);
    const clones = cloneable(glb);
    const wrongList: string[] = [];
    const noModel: string[] = [];
    for (const sp of evt.spawns(ev)) {
      if (!have.has(sp.offset)) continue;           // never placed: not this check's
      if (sp.cls in ATTACHMENT_TAIL_OFFSET) {
        const want = attachmentList(ev, sp, sp.cls, recs.length);
        if (want.length) {
          lists++;
          if (!sameList(have.get(sp.offset), want)) {
            wrongList.push(`${hex(sp.offset)} wears [${have.get(sp.offset)}], the evt says [${want}]`);
          }
          for (const id of want) {
            ids++;
            const slot = recs[id]!.slot;
            if (!clones.has(slot)) {
              noModel.push(`${hex(sp.offset)}'s ${id < SPLIT ? "head" : "accessory"} ${hex(id, 2)} (slot ${hex(slot, 4)})`);
            }
          }
        }
      }
      if (sp.cls === 0x30) {
        const kit = ZOMBIE_THROW_SLOTS[sp.param(0, "i8") ?? -1];
        if (kit) {
          for (const bone of [5, 8] as const) {
            for (const what of ["held", "bare", "projectile"] as const) {
              const slot = kit[bone][what];
              if (slot === null) continue;
              hands++;
              if (!clones.has(slot)) noModel.push(`${hex(sp.offset)}'s bone ${bone} ${what} (slot ${hex(slot, 4)})`);
            }
          }
        }
      }
      if (sp.cls === 0x25) {
        const ct = sp.param(0, "i8") ?? 0;
        for (const [op, mode, a, b] of humanoidModelCommands(ev, sp) as [number, number, number, number][]) {
          let slot: number;
          if (op === 9) {
            slot = handRows[a * PLAYER_HAND_VARIANTS + mode] ?? 0;
          } else {
            // A raw read of `g_pBoneEffectSlots[ct][6a + b]`: the pointer,
            // then the u16. Codes 0..2 leave the bone alone.
            const row = effBase === null ? null : exe.v2r(u32(exe.data, effBase + ct * 4));
            slot = row === null ? 0 : u16(exe.data, row + (a * HIT_STEPS + b) * 2);
            if (slot <= 2) continue;
          }
          humanoid++;
          if (!clones.has(slot)) {
            noModel.push(`${hex(sp.offset)}'s op ${op} (mode ${mode}, a ${a}, b ${b}) slot ${hex(slot, 4)}`);
          }
        }
      }
    }
    c.ok(!wrongList.length, `${name}: every placed spawn's list is its evt's`
         + (wrongList.length ? `; ${wrongList.slice(0, 6).join("; ")}` : ""));
    c.ok(!noModel.length, `${name}: every model a placed spawn can clone is a gore_ template`
         + (noModel.length ? `; missing ${noModel.slice(0, 6).join("; ")}` : ""));
  }
  c.ok(stages > 0, `${stages} stage bundles read`);
  c.note(`${stages} stage bundles: ${lists} placed lists, ${ids} ids, ${hands} throwing-hand `
         + `slots and ${humanoid} op 9/op 16 slots, each with a model to clone`);

  c.finish();
}

await main();
