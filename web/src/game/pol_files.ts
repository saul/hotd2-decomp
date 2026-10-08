/**
 * Whole `pol/` files, loaded and freed by the script: opcodes `0x52`
 * (`asset_load_polfile`) and `0x53` (`asset_free_polfile`), and the state
 * they leave in `g_pol_file_records`.
 *
 * Both opcodes queue an asset job on the ring at `0x007DA220` (64 records of
 * 16 bytes: `+0x00` the kind, `+0x08` the file index, `+0x0C` the job's
 * state), which the job task steps through `g_asset_job_handlers`
 * (`0x00588C20`). `[proved]` from the listings:
 *
 * * **Kind 3, the load** (`0x00419000`, through the five states at
 *   `0x0057A2A4`): state 0 refuses a file whose record's state byte is not 0,
 *   else marks it 3 and reads `pol\<name>` whole (`0x00418C20`); 1
 *   decompresses it (`0x00418D20`); 2 reads its `tex\` bank (`0x00418D80`);
 *   3 decompresses that (`0x00418E40`); 4 binds one slot of the file a step
 *   -- its record `+0xC |= 0x8008`, the resident bit -- and after the last
 *   marks the file 4, loaded (`0x00418EC0`).
 * * **Kind 4, the free** (`FUN_00419020`): state 0 drops the job if the file
 *   is not 4, else clears `0x8000` from every slot of the file
 *   (`AND word ptr [slot+0xC], 0x7FFF`, over the file's slot list at
 *   `0x004E794C`, `0x004E803C` long) and moves on; 1 releases each slot's
 *   model; 2 marks the file 0 and frees its memory.
 *
 * So a slot of a whole-file load is resident exactly while its file is: from
 * the load's last step to the free's first. That is the question every
 * reader of the resident bit asks of such a slot -- `AssetDrawSlot` and its
 * twins draw nothing without it, and the vertex walks of class 0x41
 * constructors 1, 3 and 26 run only with it -- so the port keeps the file's
 * state byte, {@link G.g_pol_file_state}, and answers the slot's question
 * from its file (`PolFileResident`).
 */
import { G } from "./globals";
import { GameMode } from "./game_mode";

/** `g_pol_file_records[i] + 8` -- the state byte: nothing loaded. */
export const POL_FILE_FREE = 0;
/** ...the load has begun (`0x00418C52`, `MOV byte ptr [EDX+0x8], 0x3`). */
export const POL_FILE_LOADING = 3;
/** ...every slot of the file bound (`0x00418FEA`, `MOV byte ptr [EBP+0x8], 0x4`). */
export const POL_FILE_LOADED = 4;

/**
 * `PolFileQueueLoad` — `FUN_0041D650`. Asset job kind 3 for file `index`.
 *
 * [diverges] **The job completes where it is queued.** The engine's job
 * task runs the load over `4 + slots` steps -- two whole-file reads, two
 * decompressions and one bind a slot -- behind whatever the ring already
 * holds, so the file is resident some frames after the opcode; the port
 * marks it loaded at once. The pacing is the job ring's and the disk's,
 * which the port does not keep, and what it decides is the frame residency
 * begins and ends, nothing else. The inputs that would show it: a resident
 * test made within a few frames of a load or a free of its file. The one
 * shipped reader that can meet one is class 0x41 constructor 26 in stage 2's
 * block 24, whose file is loaded two blocks before the task is placed, and
 * freed at step 3 op 48 with the task still alive -- so the port's ripple
 * stops on the opcode's frame, and the engine's on the frame its job task
 * reaches the free, which depends on what the ring holds ahead of it and is
 * open. `test/port/class41_pickups.test.ts` pins the immediate completion.
 *
 * The refusal is the job's first step, and kept: a file already loading or
 * loaded is left as it is.
 */
export function PolFileQueueLoad(index: number): void {
  if ((G.g_pol_file_state[index] ?? POL_FILE_FREE) !== POL_FILE_FREE) return;
  G.g_pol_file_state[index] = POL_FILE_LOADED;
}

/**
 * `PolFileQueueFree` — `FUN_0041D690`. Asset job kind 4 for file `index`,
 * which completes where it is queued for the reason the load does (see
 * `PolFileQueueLoad`): the free's first step drops the job unless the file
 * is loaded, and its last marks it free.
 */
export function PolFileQueueFree(index: number): void {
  if ((G.g_pol_file_state[index] ?? POL_FILE_FREE) !== POL_FILE_LOADED) return;
  G.g_pol_file_state[index] = POL_FILE_FREE;
}

/**
 * `[port-only]` -- whether a slot of file `index` has its record's resident
 * bit, `g_asset_slots[slot] + 0xC & 0x8000`: the bit the load sets and the
 * free clears for every slot of the file, so the file's state answers it.
 */
export function PolFileResident(index: number): boolean {
  return (G.g_pol_file_state[index] ?? POL_FILE_FREE) === POL_FILE_LOADED;
}

/** The operand Original Mode reads as "player 1's character's file". */
const POL_FILE_PLAYER0 = 0xbe;
/** ...and player 2's. */
const POL_FILE_PLAYER1 = 0xbf;
/** `CMP AL, 0x7; JG` -- the characters with a file of their own. */
const POL_FILE_PLAYER_LAST = 7;
/** Characters 8 and 9 take these files instead. */
const POL_FILE_CHARACTER8 = 0xa6;
const POL_FILE_CHARACTER9 = 0xb9;

/**
 * The file an opcode-`0x52`/`0x53` operand names, as both handlers compute
 * it (`0x0045F500`..`0x0045F567`, `0x0045F580`..`0x0045F5E7`): in Original
 * Mode, `0xBE` and `0xBF` stand for the two players' characters' own files --
 * `0xBE + character` for 0..7, `0xA6` for 8, `0xB9` for 9 -- and any other
 * character queues nothing. `null` is that nothing.
 *
 * `[port-only]` as a function: both handlers spell it out inline.
 */
function PolFileOperand(operand: number): number | null {
  if (G.g_GameMode !== GameMode.Original) return operand;
  let who: number;
  if (operand === POL_FILE_PLAYER0) who = 0;
  else if (operand === POL_FILE_PLAYER1) who = 1;
  else return operand;
  const c = ((G.g_original_character[who] ?? 0) << 24) >> 24;
  if (c <= POL_FILE_PLAYER_LAST) return c + POL_FILE_PLAYER0;
  if (c === 8) return POL_FILE_CHARACTER8;
  if (c === 9) return POL_FILE_CHARACTER9;
  return null;
}

/**
 * `EvtOpAssetLoadPolfile52` — `FUN_0045F500`. Opcode `0x52`,
 * `asset_load_polfile`: `PolFileQueueLoad` of the operand, as Original Mode
 * reads it, and `ip += 8`.
 */
export function EvtOpAssetLoadPolfile52(operand: number): void {
  const index = PolFileOperand(operand);
  if (index !== null) PolFileQueueLoad(index);
}

/**
 * `EvtOpAssetFreePolfile53` — `FUN_0045F580`. Opcode `0x53`,
 * `asset_free_polfile`: the same reading of the operand, and
 * `PolFileQueueFree`.
 */
export function EvtOpAssetFreePolfile53(operand: number): void {
  const index = PolFileOperand(operand);
  if (index !== null) PolFileQueueFree(index);
}
