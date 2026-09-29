/**
 * Class 0x22 — **JUDGMENT's flier**: stage 1's boss, its stage-1 cameo, and
 * its return in stage 5 before the Magician.
 *
 * Four spawns in the game (`docs/re/boss-judgment.md` §1): stage 1 block 0
 * (variant 0, the cameo over the square), stage 1 blocks 14 and 16 (variant
 * 1, the fight and its continue restart, one descriptor), stage 5 block 1
 * (variant 2) and the attract loop (variant 3). The fighting variants spawn
 * the walker, class 0x23, from the nested descriptor at their own
 * `tail+0x10` (`class23/`), and only the pair together is the boss: the
 * walker cannot be hurt outside Training and hands every hit it takes over to
 * the flier; the flier flies circles in the walker's frame until its hit
 * points reach 90, the walker collapses on the same frame, and phase 2 is the
 * flier alone, attacking the player itself.
 *
 * ## What the fight gates
 *
 * ```
 * ride-in: camera frame 830          -> g_script_flags[2]  -> the name banner
 * +300 frames (the banner's own run) -> joins the counters, the health bar
 * banner frame 300                   -> shutter 1 (boss_banner.ts)
 * hit points 90                      -> phase 2, the walker falls (alive -1)
 * hit points 0 -> camera free        -> the death orbit, 300 frames
 *                                    -> g_script_flags[3] (stage 1) / [0] (stage 5)
 * ```
 *
 * ## The port's shape
 *
 * One TS function per exe routine, under its Ghidra name. The class steps
 * its own clip counter (`advancesOwnMotion`) exactly where the engine does,
 * and records the draw's cursor where the draw stands (`draw.ts`). The
 * sub-actor -- the second skinned actor `Class22Init` builds -- is an actor
 * of this class with `judgment.isSubActor` set and no update.
 */
import type { Rng } from "../../core/rng";
import type { Events } from "../../core/events";
import type { Actor, JudgmentActor } from "../actor";
import { BossIntroBannerSpawn } from "../boss_banner";
import { ActorByAt, G } from "../globals";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
  type ReplaySpawnRecord, type SpawnRecord,
} from "../registry";
import { ActorSpawn } from "../spawn";
import { SpawnClass } from "../spawn_class";
import { T } from "../tables";
import { Class22Death } from "./death";
import { CLASS22_NODE2_SLOT } from "./draw";
import {
  CLASS22_BANNER_FLAG, Class22CutsceneHoldUntilChapterCard,
  Class22CutsceneRideAndLeave, Class22DescendAndJoinFight,
  Class22PoseUntilCameraCue, Class22RideInAndJoinFight,
} from "./entrance";
import { Class22FightPhase1, Class22FightPhase2 } from "./fight";
import {
  CLASS22_CHAR_TYPE, CLASS22_SUBACTOR_CHAR_TYPE, CLASS22_SUBACTOR_CLIP,
  Class22SubActorAt,
} from "./records";
import {
  CLASS22_STATE_BASE, CLASS22_STATE_TABLE, Class22State, Class22Variant,
  type Class22Descriptor,
} from "./state";
import { CLASS22_STAGE1_DEAD_FLAG, CLASS22_STAGE5_DEAD_FLAG } from "./death";

/**
 * `g_class22_intro_banner` — `0x00570EC8`, the record `Class22Init` hands
 * `BossIntroBannerSpawn` for variant 1 (`PUSH 0x570ec8` at `0x0049B1FF`).
 * The record itself is `boss_banner_records.ts`'s.
 */
export const CLASS22_INTRO_BANNER = 0x00570ec8;

/** `g_actor_radius_by_char[0x45]` — `0x004C4E3C`, `00002041`, 10.0. */
const CLASS22_RADIUS = 10.0;
/**
 * `MOV byte ptr [EDI + 0x68], 0x5` — `model+0x68`, the flier's and the
 * sub-actor's: the order `SkeletonApplyRootMotion` (`FUN_00410C50`) turns the
 * object in, whose `default:` arm 5 is `RotZ; RotY; RotX`. `[proved]`
 * `render/characters/judgment.ts` draws it; this is the value, kept beside
 * the write.
 */
const MODEL_68 = 5;
/** `obj+0x1F8 |= 4` — `model+0x64` bit 2. `[open]` meaning; kept on the word. */
const MOTION_FLAG_4 = 4;
/** The sub-actor's `obj+0x34 |= 0x88000`: bit `0x8000` keeps it out of the shot test and the push. */
const SUBACTOR_FLAGS = 0x88000;
/** `sub+0x1350 = sub+0x1354 = 1`. */
const SUBACTOR_FIRST_CLIP_INDEX = 1;

void MODEL_68;

/**
 * `Class22Init` — `FUN_0049B0D0`. Run once, from the spawn; it installs the
 * variant's update and runs it once in the same call.
 *
 * ```
 * obj+0x1310 = obj+0x1312 = 0; obj+0x3C = -1; obj+0x120 = 0xFF
 * obj+0x130C = (s8)tail[1]; char type 0x45; clip (s16)tail[2]
 * ActorBuildSkinnedModel; model+0x68 = 5; model+0x64 |= 4; per-bone hook
 * obj+0x194 = (s16)tail[4]; obj+0x124 = radius[0x45]; obj+0x32C = 0x2A9
 * obj+0x1338 = obj+0x133C = 0
 * sub = ActorAllocSub(0x13F4): char 0x46, clip 0x10, +0x34 |= 0x88000, clip index 1
 * switch variant: 0 cameo; 1 BossIntroBannerSpawn(0x570EC8) + ride-in; 2 descent; 3 pose
 * ```
 *
 * It increments no counter: the flier joins `g_enemies_alive` and
 * `g_enemies_present` only when its entrance hands over to the fight.
 */
export function Class22Init(obj: Actor, rng?: Rng, events?: Events): void {
  if (obj.cls !== SpawnClass.Judgment) return;
  const t = obj.judgment;
  // The sub-actor is built by its flier's `Init`, below; it runs no `Init`
  // of its own -- the engine's is an `ActorAllocSub` block, not a task.
  if (t.isSubActor) return;
  const d = obj.class22;
  if (!d) return;
  obj.state = 0;
  obj.sub = 0;
  // `obj+0x3C = -1`: the slot `ActorBuildSkinnedModel` then claims is the
  // one `ActorSpawn` already claimed for this class (`hit_slots.ts`).
  t.enemySlot = false;
  t.variant = (d.variant << 24) >> 24;
  obj.charType = CLASS22_CHAR_TYPE;
  obj.motion = d.clip;
  // `ActorBuildSkinnedModel` zeroes the counters and the fade; then
  // `MOV [EDI], ECX` puts `tail+0x04` on the counter.
  obj.fadeFrom = null;
  obj.fade = 0;
  obj.fadeLen = 0;
  obj.rootFrame = -1;
  obj.motionFlags |= MOTION_FLAG_4;
  obj.playTicks = d.frame;
  obj.hitRadius = CLASS22_RADIUS;
  obj.radius = CLASS22_RADIUS;
  obj.boneSlot["2"] = CLASS22_NODE2_SLOT;
  t.node2Mode = 0;
  t.node2Count = 0;

  // `ActorAllocSub(0x13F4)` into `obj+0x13B0`.
  const subAt = d.sub_actor_at ?? Class22SubActorAt(obj.at);
  if (!ActorByAt(subAt)) {
    const sub = ActorSpawn(subAt, SpawnClass.Judgment,
                           CLASS22_SUBACTOR_CHAR_TYPE, "judgment sub-actor",
                           { motion: CLASS22_SUBACTOR_CLIP, visible: true,
                             class22: null },
                           rng, events);
    if (sub.cls === SpawnClass.Judgment) {
      const s = sub.judgment;
      s.isSubActor = true;
      sub.charType = CLASS22_SUBACTOR_CHAR_TYPE;
      sub.motion = CLASS22_SUBACTOR_CLIP;
      sub.playTicks = 0;
      sub.flags |= SUBACTOR_FLAGS;
      s.subClipWanted = SUBACTOR_FIRST_CLIP_INDEX;
      s.subClipShown = SUBACTOR_FIRST_CLIP_INDEX;
    }
  }
  t.subActorAt = subAt;

  // `JMP [EAX*4 + 0x49B248]` -- the variant switch. Each arm runs the
  // variant's update once and installs it at `obj+0x00`. **The run is the
  // director's**: `SpawnFromDescriptor` only links the task, and the engine
  // runs this `Init` from the task walk on the frame of the spawn; the port
  // runs it from the spawn itself, in the script phase, and the same frame's
  // walk then makes the one update the engine's `Init` makes. Running it here
  // as well would be two updates on the spawn frame, and without the frame's
  // camera, paths or bones to run them against.
  if (t.variant === Class22Variant.Stage1) {
    BossIntroBannerSpawn(CLASS22_INTRO_BANNER);        // 0x0049B204
  }
}

function Descriptor(obj: JudgmentActor): Class22Descriptor | null {
  return obj.class22 ?? null;
}

/** One entry of `g_class22_states`, by its absolute index. */
function Class22RunState(obj: JudgmentActor, f: ClassFrame,
                         base: number): void {
  const d = Descriptor(obj);
  if (!d) return;
  switch (CLASS22_STATE_TABLE[base + obj.state]) {
    case Class22State.CutsceneHold:
      Class22CutsceneHoldUntilChapterCard(obj, f);
      break;
    case Class22State.RideAndLeave:
      Class22CutsceneRideAndLeave(obj, f, d);
      break;
    case Class22State.RideIn:
      Class22RideInAndJoinFight(obj, f, d);
      break;
    case Class22State.Phase1:
      Class22FightPhase1(obj, f, d);
      break;
    case Class22State.Phase2:
      Class22FightPhase2(obj, f);
      break;
    case Class22State.Death:
      Class22Death(obj, f, d);
      break;
    case Class22State.Descend:
      Class22DescendAndJoinFight(obj, f, d);
      break;
    default:
      // Past the table's ten entries: the engine would call whatever the
      // next dword is. No shipped path gets here.
      break;
  }
}

/** `Class22RunFromCutsceneEntrance` — `FUN_0049B260`. `CALL [ECX*4 + 0x598000]`. */
export function Class22RunFromCutsceneEntrance(obj: JudgmentActor,
                                               f: ClassFrame): void {
  Class22RunState(obj, f, CLASS22_STATE_BASE[Class22Variant.Cameo]);
}

/** `Class22RunFromRideIn` — `FUN_0049B620`. `CALL [ECX*4 + 0x598008]`. */
export function Class22RunFromRideIn(obj: JudgmentActor, f: ClassFrame): void {
  Class22RunState(obj, f, CLASS22_STATE_BASE[Class22Variant.Stage1]);
}

/** `Class22RunFromDescent` — `FUN_0049CDF0`. `CALL [ECX*4 + 0x598018]`. */
export function Class22RunFromDescent(obj: JudgmentActor, f: ClassFrame): void {
  Class22RunState(obj, f, CLASS22_STATE_BASE[Class22Variant.Stage5]);
}

/**
 * The installed update, one frame. `[port-only]` as a wrapper: the engine's
 * handler slot holds the variant's routine itself; the port's table holds
 * one function per class, so this picks the routine the `Init` installed and
 * opens the frame the two port-only ways the class needs -- the camera
 * candidacy latches (see `JudgmentTail.cameraListed`) and the "drawn this
 * frame" alpha (see `draw.ts`).
 */
export function Class22Update(obj: Actor, f: ClassFrame): void {
  if (obj.cls !== SpawnClass.Judgment) return;
  const t = obj.judgment;
  // The sub-actor has no update.
  if (t.isSubActor) return;
  t.cameraListed = false;
  t.enemySlot = false;
  obj.alpha = 0;
  const sub = ActorByAt(t.subActorAt);
  if (sub && sub !== obj) sub.alpha = 0;
  switch (t.variant) {
    case Class22Variant.Cameo:
      Class22RunFromCutsceneEntrance(obj, f);
      break;
    case Class22Variant.Stage1:
      Class22RunFromRideIn(obj, f);
      break;
    case Class22Variant.Stage5:
      Class22RunFromDescent(obj, f);
      break;
    case Class22Variant.Attract: {
      const d = Descriptor(obj);
      if (d) Class22PoseUntilCameraCue(obj, f, d);
      break;
    }
    default:
      break;
  }
}

/** A spawn record's descriptor tail, off its placement. */
function Class22RecordDescriptor(rec: SpawnRecord): Class22Descriptor | null {
  const p = (T.chars?.placements ?? []).find((x) => x.at === rec.at);
  return p?.class22 ?? null;
}

/**
 * The flags a record raises, by its variant: 2 and 3 for the stage-1 fight
 * (`0x0049B809`, `0x0049B726` and `0x0049CC95`), 0 for stage 5's
 * (`0x0049CC85`), none for the cameo and the attract loop.
 */
function Class22RaisesScriptFlag(rec: SpawnRecord): readonly number[] | undefined {
  const v = Class22RecordDescriptor(rec)?.variant;
  if (v === Class22Variant.Stage1) {
    return [CLASS22_BANNER_FLAG, CLASS22_STAGE1_DEAD_FLAG];
  }
  if (v === Class22Variant.Stage5) return [CLASS22_STAGE5_DEAD_FLAG];
  return undefined;
}

/**
 * The flag `Class22Death`'s sub 5 raises as the orbit ends, by variant:
 * `MOV byte [0x009C7203], 1` at `0x0049CC95` for stage 1's fight and
 * `MOV byte [0x009C7200], 1` at `0x0049CC85` for stage 5's; none for the
 * others. A function rather than a table because it reads two modules'
 * exports (L56).
 */
function Class22DeadFlag(variant: number): number | undefined {
  if (variant === Class22Variant.Stage1) return CLASS22_STAGE1_DEAD_FLAG;
  if (variant === Class22Variant.Stage5) return CLASS22_STAGE5_DEAD_FLAG;
  return undefined;
}

/**
 * `[port-only]` -- a replay's question, `ClassHandler.outlivedByReplay`:
 * has the replay gone past this flier's way out, so that at the landing
 * address the engine's object is gone, or is a body out of both counters,
 * and must not be rebuilt at its `Init`?
 *
 * A rebuilt fighting flier is a whole fight: its entrance's first frame
 * spawns the walker from the nested descriptor (`0x0049B640` and `0x0049CE10`,
 * sub 0), and the walker counts itself into both enemy counters in its `Init`
 * (`INC`s at `0x0048FE16` and `0x0048FE1D`). Nothing in either class tests
 * the address it was rebuilt at, so every gate after it waits on the fight.
 * A reload at stage 5's `4/1/0` landed with `g_enemies_alive` 1 and held
 * `4/2/12` shut after every zombie in the room was dead.
 *
 * The ways out the replay can see, each read in the exe `[proved]`:
 *
 * * **The variant's dead flag** -- 0 for stage 5, 3 for stage 1's fight.
 *   `Class22Death` (`FUN_0049C910`) raises it in sub 5, at the end of the
 *   orbit and after sub 0 has given both counters back; the walker left
 *   `g_enemies_alive` when it began to fall (`0x004901AE`) and
 *   `g_enemies_present` when it lay down (`0x00490B5C`). The script waits
 *   on it at stage 5's `1/1/72` and stage 1's `14/1/63` and `16/2/55`, and
 *   no `set_script_flag` in either stage names it, so in a replay -- which
 *   runs no class -- the byte comes up only as the replay steps over that
 *   wait. Past it the
 *   flier's only exit is `Class22Death`'s own cue test, and the walker's is
 *   `Class23LieUntilCameraCue`'s (`FUN_00490C50`) on the same cue. So a
 *   landing between the flag and the cue loses two bodies early -- stage 5
 *   block 2 up to path `0xCF` frame 140; the rest of stage 1's block 14,
 *   whose `0x31` stops at 230 and never reaches the 400 of its cue -- which
 *   is the one window this answers early rather than exactly. Neither body
 *   counts, is shot at or raises anything in it.
 * * **The descriptor's cue**, `g_active_cam_path == tail+6 &&
 *   g_cam_path_frame >= tail+8`: the cameo's only way out, the `ActorKill`
 *   at the head of `Class22CutsceneRideAndLeave` (`FUN_0049B3F0`), which it
 *   enters on the chapter card's flag `0xF8` -- raised at stage 1's `0/1/65`,
 *   before block 0 step 2 plays `0x22` to 470. The fighting variants' cue is
 *   tested by `Class22Death` alone, after its own flag in every shipped
 *   script, so the flag answers for them first. A replay jumps frames where
 *   play steps them, so "at or past" is the frame play would have passed.
 *
 * **Not the room gate.** The fighting variants do not count in `Init`, but
 * the walker their first update makes does, so a `wait_enemies_alive` after
 * the spawn is held from that frame on and passes only once the flier is in
 * `Class22Death`. That is already the pair out of both counters -- and still
 * not a reason to retire it: the page parks on the dead flag's wait for the
 * whole 300-frame orbit, and only the orbit raises that flag, so a landing
 * there has to rebuild the fight to be let past at all. The attract loop's
 * variant 3 plays no stage script and answers nothing here.
 */
export function Class22OutlivedByReplay(rec: ReplaySpawnRecord): boolean {
  const d = Class22RecordDescriptor(rec);
  if (!d) return false;
  const dead = Class22DeadFlag(d.variant);
  if (dead !== undefined) return (G.g_script_flags[dead] ?? 0) === 1;
  if (d.variant !== Class22Variant.Cameo) return false;
  return G.g_active_cam_path === d.despawn_path
    && d.despawn_frame <= G.g_cam_path_frame;
}

/** The sidebar's line. */
function Class22Debug(obj: Actor): ActorDebug {
  if (obj.cls !== SpawnClass.Judgment) return { summary: "judgment" };
  const t = obj.judgment;
  if (t.isSubActor) {
    return { summary: `judgment sub-actor · clip ${obj.motion.toString(16)}` };
  }
  const base = CLASS22_STATE_BASE[t.variant];
  const name = base === undefined ? "pose"
    : Class22State[CLASS22_STATE_TABLE[base + obj.state]] ?? `state ${obj.state}`;
  return {
    summary: `judgment v${t.variant} · ${name} sub ${obj.sub}`,
    detail: [
      `hp ${obj.hp}/${obj.maxHp}, stage ${t.hpStage}, aggression ${t.aggression}`,
      `path ${t.path} frame ${t.pathFrame.toFixed(1)}, counter ${t.counter}`,
      `companion ${t.companionAt}, clip ${obj.motion.toString(16)} cursor ${t.cursor}`,
    ],
    hot: obj.state === 3,
  };
}

export const Class22Handler: ClassHandler = {
  init: Class22Init,
  update: Class22Update,
  // Every state steps `obj+0x194` itself, after its draw, and some return
  // before drawing -- see `ClassHandler.advancesOwnMotion`.
  advancesOwnMotion: true,
  // `Class22ChargeShots` reads the per-player part bytes itself.
  ownsShotResult: true,
  raisesScriptFlag: Class22RaisesScriptFlag,
  outlivedByReplay: Class22OutlivedByReplay,
  // Phase 2's `ActorRegisterCameraPoint(2.0)` (`0x0049C8CE`) while bit
  // `0x100` is down, and the one-frame `RegisterEnemySlot` at `0x0049C347`.
  tracksCamera: (obj) => obj.cls === SpawnClass.Judgment
    && !obj.judgment.isSubActor
    && (obj.judgment.cameraListed || obj.judgment.enemySlot),
  // Phase 1's `RegisterForShotTest` (`0x0049C145`) and phase 2's
  // `ActorRegisterCameraPoint` (`0x0049C8CE`), made from `fight.ts` at those
  // sites. The sub-actor never registers: it is never updated, and its
  // `0x8000` would refuse it anyway.
  registersForShotTest: true,
  debug: Class22Debug,
};

registerClass(SpawnClass.Judgment, Class22Handler);
