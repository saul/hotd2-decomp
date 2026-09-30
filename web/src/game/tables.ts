/**
 * The exported data, typed.
 *
 * These are the game's `.rodata` and its loaded assets: read-only for the
 * whole life of a stage, so they are deliberately **not** part of a snapshot —
 * a save state carries the state, and the tables come back with the bundle.
 */
import type { CamPaths } from "./camera/curve";
import type {
  AttackJson, BakedMotion, BreakablesJson, CharacterBone, CharactersJson,
  CharacterType, ColiJson, PartSphereRow, ThrowHandJson,
} from "../bundle";
import { authoredFrameOfTicks, ticksOfSeconds } from "../core/play_cursor";
import type { Actor } from "./actor";
import type { SetPieceParams } from "./class24";
import type { CiviliansJson } from "../bundle/scene";
import type { Boss4TablesJson, ChapterCardJson, GameOverJson, OptionsJson,
  ResultCardJson } from "../bundle/stage";
import type { HumanoidProgram } from "./class25";
import { G } from "./globals";
import { TURN_CURVE_DEFAULT, TURN_RATE_UNTRACKED } from "./camera/constants";
import { APPROACH_STEP_BASE, APPROACH_STEP_MID_ADD, APPROACH_STEP_OUTER_ADD }
  from "./class30/ring";

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
  /**
   * The stage's `cam/` paths, by global slot -- what `CamEvalPath7`
   * (`FUN_004041E0`) evaluates. Bundle data like the rest of this object:
   * read-only for the life of the stage and not in a snapshot. Set by
   * {@link SetCameraPaths}, apart from {@link SetGameTables} so a caller that
   * refreshes the gameplay tables does not drop the curves.
   */
  camPaths: null as CamPaths | null,
  /**
   * The game-over screen's `.rdata`: the bodies' types, clips and stands, the
   * route map's tiles, waypoints and default route. One block for the whole
   * game. Null in a bundle written before it, which draws no body and no map.
   */
  gameOver: null as GameOverJson | null,
  /**
   * The options screen's `.rdata`: its rows and labels, the glyph table its
   * text is drawn from, the crosshair sprites and the two sound tests' lists.
   * One block for the whole game. Null in a bundle written before it, which
   * draws the screen with no text and plays no test.
   */
  options: null as OptionsJson | null,
  /**
   * Class 0x19's `.rdata` -- the stage-4 boss's seven tables. One block for
   * the whole game, read by `game/class19/`. Null in a bundle written before
   * format 13, and the boss then has no arena to fight in.
   */
  boss4: null as Boss4TablesJson | null,
  /**
   * `g_carrier2_door_yaw` (`0x005926D0`) -- the swing class 0x13's carrier
   * routine 2 steps its two doors through. Empty in a pre-13 bundle.
   */
  carrierDoorYaw: [] as number[],
  /**
   * The result card's `.rdata`: the figure records and lists, the per-type
   * attachment lists, the glyph strings, the life bonus and the accuracy
   * bonus. One block for the whole game; null in a bundle written before
   * it. Read through `game/class61/rdata.ts`.
   */
  resultCard: null as ResultCardJson | null,
  /**
   * The chapter card's `.rdata`: the Boss Mode backdrop and its flags, and
   * app state 0x0B's frames. Null in a bundle written before it. Read by
   * `game/class60/boss_mode.ts` and `attract.ts`.
   */
  chapterCard: null as ChapterCardJson | null,
  /**
   * The turn-rate curves and the approach radii — the two `.rdata` tables the
   * camera director reads. The immediates that used to sit beside them in this
   * block are in `game/camera/constants.ts` now; see `docs/formats/bundle.md`.
   */
  get tracking() { return T.chars?.tracking ?? null; },
};

/**
 * The scene reset's job: point the tables at this stage's data and copy the
 * approach rings into the globals, which is what `DAT_004C4CD0` ->
 * `g_enemy_approach_rings` does at 0x004C4CD0.
 */
/** Said once: a headless fixture legitimately has no collision. */
let warnedNoColi = false;

/**
 * `[port-only]` -- the stage-4 boss's `.rdata` and its carrier's door swing,
 * from the same `script.json`.
 */
export function SetBoss4Tables(json: Boss4TablesJson | undefined,
                               doorYaw: number[] | undefined): void {
  T.boss4 = json ?? null;
  T.carrierDoorYaw = doorYaw ?? [];
}

/** `[port-only]` -- the options block, from the same `script.json`. */
export function SetOptionsTables(json: OptionsJson | undefined): void {
  T.options = json ?? null;
}

/** `[port-only]` -- the result card's block, from the same `script.json`. */
export function SetResultCardTables(json: ResultCardJson | undefined): void {
  T.resultCard = json ?? null;
}

/** `[port-only]` -- the chapter card's block, from the same `script.json`. */
export function SetChapterCardTables(json: ChapterCardJson | undefined): void {
  T.chapterCard = json ?? null;
}

/** `[port-only]` -- the game-over block, from the same `script.json`. */
export function SetGameOverTables(json: GameOverJson | undefined): void {
  T.gameOver = json ?? null;
}

/** Install the stage's camera paths. See {@link T.camPaths}. `[port-only]`. */
export function SetCameraPaths(paths: CamPaths | null): void {
  T.camPaths = paths;
}

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
                 + "(`npm run export`). Nothing will find a wall.");
  }

  const rings = chars?.approach?.rings ?? [];
  G.g_enemy_approach_rings = rings.map((r) => r.inner);
  G.g_enemy_approach_ring_mid = rings.map((r) => r.mid);
  G.g_enemy_approach_ring_outer = rings.map((r) => r.outer);
  G.g_enemy_approach_steps = APPROACH_STEP_BASE;
  G.g_enemy_approach_steps_mid = APPROACH_STEP_MID_ADD;
  G.g_enemy_approach_steps_outer = APPROACH_STEP_OUTER_ADD;
  // The same reset picks the camera's turn-rate curve: `FUN_0045EEC0` writes
  // `g_camera_turn_curve = 1`. It is a runtime global because the engine can
  // point it at any of the four curves, not because anything shipped ever
  // does — the four curves themselves are `.rdata` and come from the bundle.
  G.g_camera_turn_curve = TURN_CURVE_DEFAULT;
  G.g_camera_turn_rate = TURN_RATE_UNTRACKED;
  // The rank is **not** seeded here any more: `ResetDamageRank`
  // (`FUN_00460770`) does it once a game, from run phase 0, and reads
  // `g_initial_damage_rank` out of `T.chars.difficulty` -- see `run_phase.ts`.
}

export function CharacterTypeOf(a: Actor): CharacterType | null {
  return T.types[String(a.charType)] ?? null;
}

/**
 * One bone's hit-sphere radius as its draw record holds it, `obj + 0x284 +
 * bone*0x90` -- {@link Actor.boneRadius} -- or the table row's, unscaled, for
 * an actor the build never ran on. `[port-only]` as a function: the engine
 * reads the word.
 */
export function BoneHitRadius(a: Actor, b: CharacterBone): number {
  return a.boneRadius[String(b.bone)] ?? b.hit_radius ?? 0;
}

/**
 * The same record's centre, `+0x7C..+0x84` in the bone's own space --
 * {@link Actor.boneCentre} -- or the table row's. `[port-only]` as a
 * function, like {@link BoneHitRadius}.
 */
export function BoneHitCentre(a: Actor, b: CharacterBone):
    readonly number[] | null {
  return a.boneCentre[String(b.bone)] ?? b.hit_centre ?? null;
}

/**
 * `g_character_part_tables[type]`'s damaged-part rows, as far as the bundle
 * carries them -- see `CharactersJson.part_spheres`. `[port-only]`: the
 * engine indexes the table.
 */
export function PartSphereRowsOf(type: number): readonly PartSphereRow[] {
  return T.chars?.part_spheres?.[String(type)] ?? [];
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
 * That is what left the civilians alive under their captors: stage 1's maul
 * cues are 24, 30, 62 and 64 in the lists states 34 and 35 step, against clips
 * of 41, 26, 43 and 46 frames, and 63 and 32 in the state-36 and state-40
 * lists, against 43 and 26, so only the 24 ever fired.
 *
 * This is the cursor as the draw samples it from the counter. A store to the
 * cursor alone since the last sample (`Actor.cursorStore`) is not in it: the
 * one reader that must see such a store, `CivilianStepScript`'s `0x200`
 * test, reads it first.
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
 * The general motion row: 0/1 walk, 2/3 attack run, `backoff_index` retreat.
 *
 * Every state indexes it the way the engine does -- a fixed entry, or one of
 * a pair chosen by a flag bit (`ZombieRunMotion`, `ZombieWaitMotion` in
 * `class30/states.ts`) -- and hands the number to the motion setter, which
 * declines a clip the bundle does not carry. There used to be a
 * "first baked entry of these" helper here that stood in for both bits, on
 * the belief that a row could name a clip authored for another skeleton; no
 * shipped class-0x30 row does, and the engine reads any clip at the
 * character's own stride regardless.
 */
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
