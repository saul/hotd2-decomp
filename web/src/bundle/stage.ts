/**
 * What one stage's two JSON files add up to.
 *
 * Part of the bundle the exporter writes; see docs/formats/ for each block.
 *
 * **Declarations only.** This file is one of the sources the schema digest is
 * taken over, so anything here that is not a description of the bundle's shape
 * makes the digest move for a reason a bundle cannot be wrong about. How these
 * are fetched, and which bundles are refused, is `load.ts`.
 */

import type { CamJson } from "./cameras";
import type { StageEntry } from "./manifest";
import type { CharactersJson } from "./characters";
import type { BackdropJson, BreakablesJson, PropsJson, RainJson, RigsJson,
              CiviliansJson, HumanoidProgramJson, SetPieceParamsJson,
              SoundJson } from "./scene";
import type { BlockJson, ColiJson, RegionEntryJson } from "./script";
import type { BgmJson } from "./sound";

export interface ScriptJson {
  /**
   * `BUNDLE_FORMAT` at the time this file was written — see
   * {@link StageEntry.format}. Absent in a stage written before format 3.
   */
  format?: number;
  scene: number;
  stage: number | null;
  /** `g_GameMode` as the exe numbers it — see `game/game_mode.ts`. */
  game_mode: number;
  evt_file: string;
  entry_block: number;
  /** Which step of the entry block runs first; the game picks it by mode. */
  entry_step: number;
  routes: { kind: string; next: number[] }[];
  blocks: BlockJson[];
  regions: RegionEntryJson[][];
  cam_slots_used: number[];
  bgm?: BgmJson;
  sound?: SoundJson;
  backdrop?: BackdropJson;
  rigs?: RigsJson;
  characters?: CharactersJson;
  props?: PropsJson;
  breakables?: BreakablesJson;
  /** Class 0x24's parameter tail, keyed by spawn address. */
  set_pieces?: Record<string, SetPieceParamsJson>;
  /** Class 0x25's decoded bytecode, keyed by spawn address. */
  humanoids?: Record<string, HumanoidProgramJson>;
  /** Class 0x10's civilians: the exe's scripts, and who runs which. */
  civilians?: CiviliansJson;
  rain?: RainJson;
  /** The `coli/` blobs this scene loads — see {@link ColiJson}. */
  coli?: ColiJson;
  warnings: string[];
}

export interface StageBundle {
  entry: StageEntry;
  script: ScriptJson;
  cam: CamJson;
  geometryUrl: string;
}
