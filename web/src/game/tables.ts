/**
 * The exported data, typed.
 *
 * These are the game's `.rodata` and its loaded assets: read-only for the
 * whole life of a stage, so they are deliberately **not** part of a snapshot —
 * a save state carries the state, and the tables come back with the bundle.
 */
import type {
  AttackJson, BakedMotion, BreakablesJson, CharactersJson, CharacterType,
  ColiJson, ThrowHandJson,
} from "../bundle";
import { authoredFrameOfTicks, ticksOfAuthoredFrame, ticksOfSeconds }
  from "../core/play_cursor";
import type { Actor } from "./actor";
import type { SetPieceParams } from "./class24";
import type { CiviliansJson } from "../bundle/scene";
import type { HumanoidProgram } from "./class25";
import { G } from "./globals";

export const T = {
  /** The whole `characters` block: tables, types and placements. */
  chars: null as CharactersJson | null,
  /**
   * The `breakables` block: the nine class-0x41 groups, the 96-point hull and
   * the type-0 placements. Read-only for the life of the stage, so it is not
   * in the snapshot — it comes back with the bundle.
   */
  breakables: null as BreakablesJson | null,
  /** Class 0x24's parameter tail, per spawn address. */
  setPieces: null as Record<string, SetPieceParams> | null,
  /** Class 0x25's decoded bytecode, per spawn address. */
  humanoids: null as Record<string, HumanoidProgram> | null,
  /**
   * Class 0x10's civilians: the exe's 136 command streams, the 67-entry table
   * that names them, and the per-spawn tail that picks one. The streams are
   * `.rodata` compiled into Hod2.exe rather than evt data, which is why they
   * arrive as one block for the whole game and not per spawn.
   */
  civilians: null as CiviliansJson | null,
  /**
   * The scene's `coli/` blobs. Read-only for the life of the stage, so — like
   * every other table here — it is not in a snapshot; **which** of them are
   * active is, and that lives in `G.g_coli_full_set` / `g_coli_ray_set`.
   */
  coli: null as ColiJson | null,
  types: {} as Record<string, CharacterType>,
  get approach() { return T.chars?.approach ?? null; },
  get tracking() { return T.chars?.tracking ?? null; },
  get player() { return T.chars?.player ?? null; },
};

/**
 * The scene reset's job: point the tables at this stage's data and copy the
 * approach rings into the globals, which is what `DAT_004C4CD0` ->
 * `g_enemy_approach_rings` does at 0x004C4CD0.
 */
/** Said once: a headless fixture legitimately has no collision. */
let warnedNoColi = false;

export function SetGameTables(chars: CharactersJson | undefined,
                              breakables?: BreakablesJson,
                              setPieces?: Record<string, SetPieceParams>,
                              humanoids?: Record<string, HumanoidProgram>,
                              coli?: ColiJson,
                              civilians?: CiviliansJson): void {
  // Ordering hazard, and it cost an afternoon: `ResetGameGlobals` clears the
  // approach rings, so calling it *after* this leaves every ring at zero and
  // every enemy permanently in the outermost band. Say so rather than let it
  // be silent.
  if (chars && !(chars.approach?.rings?.length)) {
    console.warn("[game] no approach rings in this bundle -- enemies will "
                 + "never reach striking range");
  }
  T.chars = chars ?? null;
  T.types = chars?.types ?? {};
  T.breakables = breakables ?? null;
  T.setPieces = setPieces ?? null;
  T.humanoids = humanoids ?? null;
  T.coli = coli ?? null;
  T.civilians = civilians ?? null;
  // A bundle exported before the collision block existed is a bundle where
  // every trace misses, and a silent miss looks exactly like an open level.
  if (chars && !coli?.blobs && !warnedNoColi) {
    warnedNoColi = true;
    console.warn("[game] no coli/ collision in this bundle -- re-export it "
                 + "(tools/export_player.py). Nothing will find a wall.");
  }

  const rings = chars?.approach?.rings ?? [];
  G.g_enemy_approach_rings = rings.map((r) => r.inner);
  G.g_enemy_approach_ring_mid = rings.map((r) => r.mid);
  G.g_enemy_approach_ring_outer = rings.map((r) => r.outer);
  G.g_enemy_approach_steps = chars?.approach?.steps?.base ?? 0;
  G.g_enemy_approach_steps_mid = chars?.approach?.steps?.mid_add ?? 0;
  G.g_enemy_approach_steps_outer = chars?.approach?.steps?.outer_add ?? 0;
  // The same reset picks the camera's turn-rate curve: `FUN_0045EEC0` writes
  // `g_camera_turn_curve = 1`, and `tracking.curve` is that constant read out
  // of the exe. It is a runtime global because the engine can point it at any
  // of the four curves, not because anything shipped ever does.
  G.g_camera_turn_curve = chars?.tracking?.curve ?? 1;
  G.g_camera_turn_rate = chars?.tracking?.rate_untracked ?? 12;
  // `ResetDamageRank` (`FUN_00460770`) seeds the adaptive rank from the menu
  // difficulty; there is no adaptive update ported yet, so it stays at seed.
  G.g_damage_rank = Math.min(15, Math.max(0,
    chars?.difficulty?.initial_rank?.[G.g_difficulty] ?? 0));
}

export function CharacterTypeOf(a: Actor): CharacterType | null {
  return T.types[String(a.charType)] ?? null;
}

export function MotionOf(a: Actor, id: number): BakedMotion | null {
  return T.types[String(a.charType)]?.motions[String(id)] ?? null;
}

/**
 * `obj+0x19C` — the clip frame **the scripts count in**.
 *
 * The animation clock ticks once per 60 Hz frame over data authored at 30 Hz,
 * so it runs to about twice `frames`. Every cue a script names is in these
 * units: `ZombieStateTargetMotionScript`'s kill frame, the class-0x25 VM's
 * "last frame", `ZombieStateMotionCue21`'s exit.
 *
 * Counting in authored frames instead silently loses every cue past halfway.
 * That is what left the civilians alive under their captors: stage 1's four
 * maul cues are 24, 30, 62 and 64 against clips of 41, 26, 43 and 46 frames,
 * so only the 24 ever fired.
 */
export function MotionPlayFrame(a: Actor): number {
  const m = MotionOf(a, a.motion);
  if (!m) return 0;
  // `FUN_004111A0`, the sampler: `model[2] = model[0] % (play_length + 1)`.
  // It **wraps**, and the `+ 1` is why the cursor reaches the play length
  // itself rather than stopping one short — which is the single frame per
  // cycle that `CivilianUpdate`'s loop arm spends a loop on. The same routine
  // then takes `model[2] / 2` as the authored frame and blends the odd values
  // between two, which is what the 60 Hz clock over 30 Hz data actually means.
  const len = MotionPlayLength(a, a.motion);
  // `a.playTicks` **is** `model[0]`: one increment per 60 Hz frame. It used to
  // be `Math.floor(clock * fps * 2)` over a float accumulation of `1/60`, and
  // that dropped whole cursor values -- 7, 15, 31, 507 -- so any cue naming
  // one of them never fired. See `Actor.playTicks`.
  return len > 0 ? a.playTicks % (len + 1) : a.playTicks;
}

/**
 * The **authored** frame of a clip: which of `m.frames` poses to draw.
 *
 * The third of what were three different frame units in this port, and the
 * only one the animation data itself is indexed by. `MotionPlayFrame` counts
 * in the engine's 60 Hz cursor, at about twice this; `playTicks` is that
 * cursor. Every conversion between them goes through here, so a clip authored
 * at something other than 30 Hz would need changing in one place.
 *
 * [port-only] The engine has no such routine: `FUN_004111A0` reads `model[2]`
 * and takes `model[2] / 2` inline, because at 30 Hz that is the whole
 * conversion. This exists so the port has one spelling of it rather than the
 * three it grew.
 */
export function MotionAuthoredFrame(a: Actor, m: BakedMotion): number {
  return authoredFrameOfTicks(a.playTicks, m.fps, m.frames);
}

/**
 * Seconds of game time to whole cursor ticks.
 *
 * [port-only] The engine never converts: it increments `obj+0x19C` once per
 * frame and has no notion of a duration in seconds anywhere near a motion.
 * This is the port's edge, where `Tick.dt` -- which is a real number of
 * seconds because a browser hands one over -- becomes the whole frames the
 * game counts in.
 */
export function SecondsToTicks(seconds: number): number {
  return ticksOfSeconds(seconds);
}

/**
 * An authored frame of `m` to the play cursor's ticks.
 *
 * [port-only] The engine's states write `obj+0x19C` directly, in cursor units,
 * because that is the only unit they have. The bundle's clips are indexed by
 * authored frame, so the port needs the conversion the engine does not.
 */
export function FrameToTicks(frame: number, m: BakedMotion | null): number {
  return ticksOfAuthoredFrame(frame, m?.fps ?? 0);
}

/**
 * `g_motion_play_length[motion]` — how far {@link MotionPlayFrame} counts.
 *
 * The bundle carries the exe's own value because it is `2n - 2` for some
 * motions and `2n - 3` for others with no rule saying which; the derivation is
 * the fallback for a bundle built before the table was exported.
 */
export function MotionPlayLength(a: Actor, id = a.motion): number {
  const m = MotionOf(a, id);
  if (!m) return 0;
  return m.play ?? Math.max(1, m.frames * 2 - 2);
}

/**
 * Attacks this actor can perform for its body condition — the row
 * `ZombieStateStrike` indexes with the pick table.
 */
export function AttackListOf(a: Actor): Record<string, AttackJson> {
  const t = CharacterTypeOf(a);
  return t?.attacks?.[String(a.condition)] ?? t?.attacks?.["0"] ?? {};
}

export function AttackPicksOf(a: Actor): number[] {
  const t = CharacterTypeOf(a);
  return t?.attack_picks?.[String(a.condition)] ?? t?.attack_picks?.["0"] ?? [];
}

/**
 * The first entry of the row that is actually baked into this bundle.
 *
 * [diverges] The engine picks between the two variants with a flag bit —
 * `row[2 + ((obj+0x34 >> 0x1B) & 1)]` for the run — and nothing ported sets
 * it, so this takes whichever exists. It matters because a row entry can name
 * a clip authored for **another skeleton**: `znchain`'s run is `zom.bin` 968,
 * which bakes for the 16-bone humanoids and is refused for it. Asking for the
 * first entry by index and getting a number that has no clip behind it is
 * what left every zombie standing still.
 */
export function FirstBakedOf(a: Actor, row: number[],
                             ...indices: number[]): number | undefined {
  for (const i of indices) {
    const m = row[i];
    if (m !== undefined && MotionOf(a, m)) return m;
  }
  return undefined;
}

/** The general motion row: 0/1 walk, 2/3 attack run, `backoff_index` retreat. */
export function MotionRowOf(a: Actor): number[] {
  const t = CharacterTypeOf(a);
  return t?.motion_row?.[String(a.condition)] ?? t?.motion_row?.["0"] ?? [];
}

/** The thrower's hands for its body condition. */
export function ThrowHandsOf(a: Actor): ThrowHandJson[] {
  const t = CharacterTypeOf(a);
  return t?.throw?.hands?.[String(a.condition)]
      ?? t?.throw?.hands?.["0"] ?? [];
}
