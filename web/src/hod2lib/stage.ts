/**
 * What a *stage* is: the single abstraction every exporter resolves against.
 * The port of `tools/hod2lib/stage.py`.
 *
 * A stage is not a directory and not a filename glob. It is a **scene id** --
 * the event system's own index -- and everything else follows from tables
 * compiled into `Hod2.exe`:
 *
 *     scene ---> evt/ file          0x00579928 -> 0x004D1C7C
 *           ---> route table        0x00597890      block flow graph
 *           ---> region tables      0x00576A2C/0x00576A5C  (mode 1: .../A8C)
 *           ---> geometry set       union of every region's asset slots,
 *                                   plus every slot opcode 0x50 loads
 *           ---> cam/ files         cp_st<N>, op_st<N>
 *
 * **Everything that touches a file is async here and synchronous in Python.**
 * That is the one structural difference in this package, and it is the seam:
 * a browser cannot block on a read. The laziness is the same -- constructing a
 * `Stage` reads nothing -- and each accessor caches its promise, so two callers
 * asking for the geometry at once decode it once.
 *
 * Reference: docs/formats/pipeline.md.
 */

import * as camlib from "./cam";
import { CamPaths } from "./campaths";
import * as colilib from "./coli";
import * as C from "./container";
import * as degraded from "./degraded";
import * as evt from "./evt";
import { ExeTables } from "./exetab";
import type { AssetSource } from "./io";
import * as nl1 from "./nl1";
import * as texbank from "./texbank";

/**
 * `g_GameMode` (0x009CA08C), as the EXE numbers it.
 *
 * The bundle used to emit a *different* number under the same name -- a flag,
 * `1 if original else 0` -- so a bundle's 0 meant the EXE's 2 and every reader
 * had to know which side of the seam it was on. There is one enumeration now;
 * `web/src/game/game_mode.ts` is its other half.
 *
 * **`ARCADE` was 2 until bundle format 7, and 2 is Training.** The values are
 * the title menu's own row order, which `TitleMenuRegisterSprites`
 * (`FUN_004962C0`) registers by name -- `tex\arcade00`, `tex\original_00`,
 * `tex\traning_00`, `tex\boss_00` -- and `TitleMenuUpdateAndSelect`
 * (`FUN_00496960`) writes the highlighted row straight into the global. Every
 * other writer in the program stores 0, so 1, 2 and 3 can only come from that
 * menu.
 */
export enum GameMode {
  /**
   * Arcade -- the coin-op game. Menu row 0, and the value every non-menu
   * writer of `g_GameMode` stores, so it is also the default.
   */
  ARCADE = 0,
  /** The story campaign. Menu row 1. */
  ORIGINAL = 1,
  /**
   * Training. Menu row 2. `ResetGameOnStart` sends it to scene 6, which is
   * `trnevtbl.bin`, and `g_training_lesson` (`0x009C9118`) selects the lesson.
   * No stage bundle is exported in this mode.
   */
  TRAINING = 2,
  /**
   * Boss. Menu row 3. `ResetGameOnStart` sends it to scene 0 block 0x10 and
   * `PreloadScreenAssetList` gives it a six-entry per-scene table of its own.
   * No shipped stage script is entered in this mode.
   */
  BOSS = 3,
}

/** stage number -> scene id, the event system's own index. */
export const STAGE_TO_SCENE: Record<number, number> =
  { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5 };
export const SCENE_TO_STAGE: Record<number, number> =
  { 0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6 };

/**
 * Parsed `Hod2.exe` tables per source, cached.
 *
 * The reference implementation caches on the game directory string because
 * that is its identity; here the {@link AssetSource} *is* the identity, and it
 * may be a directory handle with no path at all.
 */
const TABLES = new WeakMap<AssetSource, Promise<ExeTables | null>>();

export function getTables(source: AssetSource): Promise<ExeTables | null> {
  let p = TABLES.get(source);
  if (!p) {
    p = (async () => {
      if (!await source.exists("Hod2.exe")) return null;
      return ExeTables.create(await source.read("Hod2.exe"), "Hod2.exe");
    })();
    TABLES.set(source, p);
  }
  return p;
}

/** One `pol/` file's contribution to a stage: `[name, models, bank]`. */
export type Part = [string, nl1.Model[], texbank.Bank | null];

/**
 * The `tex/` bank paired with a `pol/` file, or null.
 *
 * The EXE's descriptor table is authoritative; the prefix-sum solver is only a
 * fallback for banks it does not list.
 */
async function bankFor(source: AssetSource, tables: ExeTables | null,
                       stem: string): Promise<texbank.Bank | null> {
  const tex = `tex/${stem}.bin`;
  if (!await source.exists(tex)) return null;
  const raw = await source.read(tex);
  const tc = C.load(raw);
  const data = tc.kind === C.COMPRESSED ? tc.data : raw;
  const entries = tables ? tables.entries(stem) : [];
  if (entries.length) return texbank.bankFromExe(data, entries);
  return null;
}

/** `[models, bank]` for a `pol/` asset and its `tex/` bank. */
export async function loadAsset(source: AssetSource, tables: ExeTables | null,
                                name: string):
    Promise<[nl1.Model[], texbank.Bank | null]> {
  const pol = `pol/${name}.bin`;
  if (!await source.exists(pol)) {
    throw new Error(`no such asset: ${pol}`);
  }

  const c = C.load(await source.read(pol));
  if (!c.models.length) throw new Error(`${name}: no models (${c.kind})`);
  const models = nl1.parseContainer(c);

  let bank: texbank.Bank | null = null;
  const tex = `tex/${name}.bin`;
  if (await source.exists(tex)) {
    const raw = await source.read(tex);
    const tc = C.load(raw);
    const data = tc.kind === C.COMPRESSED ? tc.data : raw;
    const entries = tables ? tables.entries(name) : [];
    if (entries.length) {
      bank = texbank.bankFromExe(data, entries);
    } else {
      const descs = texbank.harvestDescriptors(models);
      if (descs.size) bank = texbank.solveLayout(data, descs);
    }
  }
  return [models, bank];
}

/**
 * The `cam/` files belonging to a stage: `cp_stN` then `op_stN`.
 *
 * Returns `[]` when the asset has no matching camera file, which is normal --
 * only the six stages and a handful of cutscenes have one.
 */
export async function loadCamPaths(source: AssetSource, stage: number | null,
                                   name: string | null):
    Promise<camlib.CamFile[]> {
  let stems: string[] = [];
  if (stage !== null) {
    stems = [`cp_st${stage}`, `op_st${stage}`];
  } else if (name) {
    const m = /^st(\d+)_/.exec(name);           // st2_07 -> stage 2
    if (m) stems = [`cp_st${m[1]}`, `op_st${m[1]}`];
  }

  const out: camlib.CamFile[] = [];
  for (const stem of stems) {
    const p = `cam/${stem}.bin`;
    if (await source.exists(p)) {
      out.push(camlib.parse(await source.read(p), `${stem}.bin`));
    }
  }
  return out;
}

export interface ModelRegion {
  regions: number[];
  draw_mode: number;
  slot: number | null;
  entry: number;
}

export interface Geometry {
  parts: Part[];
  /** Keyed by {@link pairKey}: the stem and the model index. */
  modelRegions: Map<string, ModelRegion>;
  regions: [number, number][][];
}

/**
 * The key `modelRegions` and the slot inverse use for a `(name, n)` pair.
 *
 * The reference implementation keys those two maps on a Python tuple, which
 * JavaScript has no equivalent of, so the pair is spelled as one string with a
 * separator no part name can contain. Every reader of either map goes through
 * this function: `gltf` looked the same key up with a space in it once, and
 * the result was every model node in the bundle losing its region list -- a
 * bundle that loads, draws, and shows the whole stage at once.
 */
export function pairKey(a: string, b: number): string {
  return `${a}\u0000${b}`;
}

/**
 * One stage of the game, resolved from `Hod2.exe`.
 *
 * Construct with {@link Stage.create}: reading the EXE tables is the one
 * eager step, and it is asynchronous.
 */
export class Stage {
  readonly stage: number | null;
  readonly gameMode: number;

  private geometryP: Promise<Geometry> | null = null;
  private camFilesP: Promise<camlib.CamFile[]> | null = null;
  private campathsP: Promise<CamPaths> | null = null;
  private evtP: Promise<evt.EvtFile | null> | null = null;
  private colisetsP: Promise<[colilib.ColiFile, colilib.ColiFile] | null> | null
    = null;

  private constructor(
    readonly source: AssetSource,
    readonly scene: number,
    stage: number | null,
    readonly original: boolean,
    readonly tables: ExeTables,
  ) {
    this.stage = stage;
    this.gameMode = original ? GameMode.ORIGINAL : GameMode.ARCADE;
  }

  static async create(source: AssetSource,
                      opts: { stage?: number | null; scene?: number | null;
                              original?: boolean }): Promise<Stage> {
    let scene = opts.scene ?? null;
    const stageNo = opts.stage ?? null;
    if (scene === null) {
      if (stageNo === null) throw new Error("give stage or scene");
      scene = STAGE_TO_SCENE[stageNo] ?? null;
      if (scene === null) throw new Error(`stage ${stageNo} has no scene`);
    }
    const tables = await getTables(source);
    if (tables === null) {
      throw new Error(
        `Hod2.exe is required to resolve a stage: ${source.label}`);
    }
    return new Stage(source, scene,
                     stageNo !== null ? stageNo : (SCENE_TO_STAGE[scene] ?? null),
                     opts.original ?? false, tables);
  }

  // -- identity ---------------------------------------------------------

  /** Bundle/export name: `stage2`, or `stage2_original`. */
  get name(): string {
    const base = this.stage ? `stage${this.stage}` : `scene${this.scene}`;
    return base + (this.original ? "_original" : "");
  }

  get evtFile(): string | null {
    return this.tables.sceneEvtFile(this.scene);
  }

  /** `[[kind, next0, next1, next2], ...]` -- the block flow graph. */
  get routes(): [number, number, number, number][] {
    return this.tables.sceneRoutes(this.scene);
  }

  /**
   * `[terminal block, next scene's entry block]` for every ending.
   *
   * See {@link ExeTables.sceneExits} -- the terminal route record's `next[0]`
   * is where the next stage starts.
   */
  get exits(): [number, number][] {
    return this.tables.sceneExits(this.scene);
  }

  /**
   * Every block this scene can be entered at, ascending.
   *
   * See {@link ExeTables.sceneEntryBlocks}. Stage 3 and stage 4 have two;
   * every other stage has one.
   */
  get entries(): number[] {
    return this.tables.sceneEntryBlocks(this.scene);
  }

  get blockCount(): number {
    return this.routes.length;
  }

  /** `[[[assetSlot, drawMode], ...], ...]` indexed by region id. */
  get regions(): [number, number][][] {
    return this.tables.sceneRegions(this.scene, this.original);
  }

  get drawModes(): Map<number, number> {
    return this.tables.sceneDrawModes(this.scene, this.original);
  }

  // -- collision ---------------------------------------------------------

  /**
   * `[common, perScene]` -- the two `coli/` files this scene loads.
   *
   * `ColiLoadForScene` loads `coli0.bin` for every scene plus
   * `coli<scene+1>.bin`, and it guards `0 <= scene < 7`; scenes outside that
   * range get no collision and this returns null.
   */
  colisets(): Promise<[colilib.ColiFile, colilib.ColiFile] | null> {
    if (this.colisetsP === null) {
      this.colisetsP = (async () => {
        let names: [string, string];
        try {
          names = colilib.sceneFiles(this.scene);
        } catch (exc) {
          // not-a-loss: `ColiLoadForScene` guards `0 <= scene < 7` and this is
          // that guard. A scene outside the range has no collision *in the
          // engine*, so null is the faithful answer rather than a failure.
          if (!(exc instanceof colilib.ColiError)) throw exc;
          return null;
        }
        try {
          return [await colilib.load(this.source, `coli/${names[0]}`, names[0]),
                  await colilib.load(this.source, `coli/${names[1]}`, names[1])];
        } catch (exc) {
          // An install missing `coli/` exported a bundle with no collision in
          // it and said nothing: every wall in the stage becomes passable,
          // every ground query answers zero, and it reads as a gameplay bug
          // rather than a missing file.
          degraded.note("hod2lib.stage.colisets",
                        `coli/${names[0]} and coli/${names[1]}`,
                        "no collision for this scene at all", exc);
          return null;
        }
      })();
    }
    return this.colisetsP;
  }

  // -- event script ------------------------------------------------------

  /** The parsed, relocated `evt/` table, or null if the scene has none. */
  evt(): Promise<evt.EvtFile | null> {
    if (this.evtP === null) {
      this.evtP = (async () => {
        const name = this.evtFile;
        if (!name) return null;
        const path = `evt/${name}`;
        if (!await this.source.exists(path)) return null;
        // The shared 0x200-byte buffer that sits immediately below the stage
        // table in memory. `spawn_simple` points into it, so a stage table
        // that cannot see it resolves six of the game's seven screen-furniture
        // records to nothing. See `EvtFile.resolve`.
        const comPath = "evt/comevtbl.bin";
        const com = await this.source.exists(comPath)
          ? new evt.EvtFile(await this.source.read(comPath), "comevtbl.bin")
          : null;
        return evt.parse(await this.source.read(path), name, this.blockCount,
                         com);
      })();
    }
    return this.evtP;
  }

  // -- geometry ----------------------------------------------------------

  /**
   * The authoritative geometry set for this stage.
   *
   * Globbing `st<N>_*` is wrong in both directions: it misses files the stage
   * genuinely draws (`st3.bin`, and all of stage 6's reused `st5_*` geometry)
   * and includes entries no region ever draws.
   *
   * The real set is the union of every asset slot named by any of the scene's
   * *regions* -- the sliding window the game streams and draws along the rail
   * -- and every slot the event script loads with opcode `0x50`. Whole-file
   * loads (opcode `0x52`) are deliberately excluded: those are spawnable
   * actors instantiated at runtime from spawn descriptors, not placed scenery.
   */
  geometry(): Promise<Geometry> {
    if (this.geometryP === null) this.geometryP = this.buildGeometry();
    return this.geometryP;
  }

  private async buildGeometry(): Promise<Geometry> {
    const source = this.source;
    const slots = this.tables.assetSlots();
    const regions = this.regions;

    const wanted = new Map<string, Set<number>>();
    const slotRegions = new Map<string, Set<number>>();
    regions.forEach((region, ri) => {
      for (const [slot] of region) {
        const rec = slots.get(slot);
        if (!rec) continue;
        let s = wanted.get(rec[0]);
        if (!s) { s = new Set(); wanted.set(rec[0], s); }
        s.add(rec[1]);
        const key = pairKey(rec[0], rec[1]);
        let r = slotRegions.get(key);
        if (!r) { r = new Set(); slotRegions.set(key, r); }
        r.add(ri);
      }
    });

    const ev = await this.evt();
    if (ev !== null) {
      for (const blk of ev.blocks) {
        if (blk.offset < 0) continue;
        for (const prog of blk.programs) {
          for (const ins of prog) {
            if (evt.SLOT_OPCODES.includes(ins.opcode) && ins.raw.length) {
              const rec = slots.get(ins.raw[0]);
              if (rec) {
                let s = wanted.get(rec[0]);
                if (!s) { s = new Set(); wanted.set(rec[0], s); }
                s.add(rec[1]);
              }
            }
          }
        }
      }
    }

    const drawModes = this.drawModes;
    const slotOf = new Map<string, number>();
    for (const [k, v] of slots) slotOf.set(pairKey(v[0], v[1]), k);
    const parts: Part[] = [];
    const modelRegions = new Map<string, ModelRegion>();
    for (const fname of [...wanted.keys()].sort()) {
      const stem = fname.endsWith(".bin") ? fname.slice(0, -4) : fname;
      const pol = `pol/${fname}`;
      if (!await source.exists(pol)) continue;
      const cont = C.load(await source.read(pol));
      const bank = await bankFor(source, this.tables, stem);
      const models: nl1.Model[] = [];
      const order = [...wanted.get(fname)!].sort((a, b) => a - b);
      for (const entry of order) {
        if (entry >= cont.models.length) continue;
        let got: nl1.Model;
        try {
          got = nl1.parse(C.model(cont, entry));
        } catch (exc) {
          degraded.note("hod2lib.stage.geometry", `model ${entry} of ${fname}`,
                        "that model is absent from the geometry", exc);
          continue;
        }
        const slotId = slotOf.get(pairKey(fname, entry));
        modelRegions.set(pairKey(stem, models.length), {
          regions: [...(slotRegions.get(pairKey(fname, entry)) ?? [])]
            .sort((a, b) => a - b),
          draw_mode: slotId !== undefined ? (drawModes.get(slotId) ?? 0) : 0,
          slot: slotId ?? null,
          entry,
        });
        models.push(got);
      }
      if (models.length) parts.push([stem, models, bank]);
    }
    return { parts, modelRegions, regions };
  }

  // -- cameras -----------------------------------------------------------

  /** `[cp_st<N>, op_st<N>]`, parsed. */
  camFiles(): Promise<camlib.CamFile[]> {
    if (this.camFilesP === null) {
      this.camFilesP = loadCamPaths(this.source, this.stage, null);
    }
    return this.camFilesP;
  }

  /** The stage's `cam/` paths keyed by their global slot id. */
  campaths(): Promise<CamPaths> {
    if (this.campathsP === null) {
      this.campathsP = (async () =>
        new CamPaths(this.tables, await this.camFiles()))();
    }
    return this.campathsP;
  }

  // -- description -------------------------------------------------------

  /** Region table with every slot resolved to a file and entry index. */
  regionJson(): Record<string, unknown>[][] {
    const slots = this.tables.assetSlots();
    return this.regions.map((reg) => reg.map(([s, m]) => {
      const rec = slots.get(s) ?? ["?", 0] as [string, number];
      return { slot: s, draw_mode: m, file: rec[0], entry: rec[1] };
    }));
  }

  /**
   * Every file this stage's export is derived from, as source-relative paths.
   *
   * Recorded in the bundle manifest by SHA-256, so a bundle built from a
   * different game build is detectable rather than mysteriously wrong.
   */
  async sourceFiles(): Promise<string[]> {
    const out = ["Hod2.exe"];
    if (this.evtFile) {
      const p = `evt/${this.evtFile}`;
      if (await this.source.exists(p)) out.push(p);
    }
    const com = "evt/comevtbl.bin";
    if (await this.source.exists(com)) out.push(com);
    for (const cf of await this.camFiles()) {
      const p = `cam/${cf.name}`;
      if (await this.source.exists(p)) out.push(p);
    }
    const { parts } = await this.geometry();
    for (const [stem] of parts) {
      for (const sub of ["pol", "tex"]) {
        const p = `${sub}/${stem}.bin`;
        if (await this.source.exists(p)) out.push(p);
      }
    }
    return out;
  }
}
