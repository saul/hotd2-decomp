/**
 * What one stage's two JSON files add up to, and how they are fetched.
 *
 * Part of the bundle the exporter writes; see docs/formats/ for each block.
 */

import type { CamJson } from "./cameras";
import type { CharactersJson } from "./characters";
import { SUPPORTED_FORMAT } from "./manifest";
import type { Manifest, StageEntry } from "./manifest";
import type { BackdropJson, BreakablesJson, PropsJson, RainJson, RigsJson,
              HumanoidProgramJson, SetPieceParamsJson,
              SoundJson } from "./scene";
import type { BlockJson, ColiJson, RegionEntryJson } from "./script";
import type { BgmJson } from "./sound";

export interface ScriptJson {
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

// -- loading ---------------------------------------------------------------

const ROOT = "bundle";

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status} ${r.statusText}`);
  return (await r.json()) as T;
}

export async function loadManifest(): Promise<Manifest> {
  const m = await getJson<Manifest>(`${ROOT}/manifest.json`);
  if (m.format !== SUPPORTED_FORMAT) {
    throw new Error(
      `bundle format ${m.format}, this client reads ${SUPPORTED_FORMAT}. ` +
        `Rebuild with tools/export_player.py.`,
    );
  }
  return m;
}

export async function loadStage(entry: StageEntry): Promise<StageBundle> {
  const dir = `${ROOT}/${entry.name}`;
  const [script, cam] = await Promise.all([
    getJson<ScriptJson>(`${dir}/${entry.script}`),
    getJson<CamJson>(`${dir}/${entry.cam}`),
  ]);
  return { entry, script, cam, geometryUrl: `${dir}/${entry.geometry}` };
}
