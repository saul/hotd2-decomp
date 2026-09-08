/**
 * Class 0x19 — **the stage-4 boss**, and the eight `wait_script_flag` gates
 * behind it.
 *
 * Four spawns in the whole game, one per block, all in stage 4: blocks 23, 25,
 * 27 and 29 of `st4.bin`'s script, each `spawn_obj_c` with 300 hit points and
 * a descriptor tail whose byte `+0x01` is 0, 1, 2 and 3 — one of each of the
 * four entrances. Every one of those blocks then runs
 *
 * ```
 *   set_script_flag 30
 *   …
 *   wait_script_flag 31       the fight may start
 *   …
 *   wait_script_flag 32       the boss is dead
 * ```
 *
 * so the eight gates this class holds are two per block, and no other class
 * writes either flag anywhere in stage 4.
 *
 * The tail's byte `+0x00` is the **character type**, `0x4A` — `boss4.bin`,
 * fifteen nodes — and the fifteen dwords after it are one model pointer per
 * node, which is the "~15 per-bone model slots straight from its tail" that
 * `spawns.md` records. The exporter had this class's character type recorded as
 * a literal `0x7C`; `0x7C` is the **clip** `Boss4Init` seats at `obj+0x1B4`
 * two instructions later, and that mistake is why no class-0x19 placement had
 * ever reached a bundle. Fixed in both halves of `hod2lib` in the same commit
 * as this module.
 *
 * ## What runs here, and what does not
 *
 * This is a twenty-four state boss with a nine-phase arena progression, and
 * **the port has its spine and not its fight.** What is here:
 *
 * | | |
 * |---|---|
 * | `Boss4Init` (`FUN_004917E0`) | whole |
 * | `Boss4Update` (`FUN_004919D0`) | the dispatch and the despawn test |
 * | states 0–3, the entrance | whole, and `g_script_flags[31]` |
 * | `BossIntroBannerUpdate` (`FUN_00437AC0`) | its lifetime and its shutter write |
 * | `Boss4ResolveShot` (`FUN_00491B40`) | the damage half; the effects are not |
 * | state `0x14`, the flinch | whole but for the turn |
 * | `Boss4ResumeAfterHit` (`FUN_004952A0`) | whole but for the phase cue |
 * | state `0x16`, the death | whole, and `g_script_flags[32]` |
 *
 * and **the other seventeen states are not ported**. They are named in
 * {@link Boss4State} with their addresses, and an actor that reaches one of
 * them holds the pose it is in: {@link Boss4Handler} routes them to
 * {@link Boss4StateNotPorted}, which does nothing at all rather than
 * pretending.
 *
 * That is not a shape that finishes the fight, and it is not claimed to be.
 * The chain the gates need is
 *
 * ```
 *   entrance -> banner -> shutter -> flag 31 -> state 7 -> shot -> flinch
 *            -> state 7 -> … -> hit points out -> state 0x16 -> flag 32
 * ```
 *
 * and every link of it is here **except** that the hit points cannot run out:
 * `Boss4ResolveShot` refuses every shot once they reach this phase's share of
 * the bar (`g_boss4_phase_hp_fraction[0]`, so 8/9 of 300), and only
 * `Boss4AdvanceArenaWaypoint` (`FUN_004928D0`) and
 * `Boss4AdvancePhaseWhenWalkDone` (`FUN_00492350`) move the phase on. Those
 * two are the arena — they teleport the boss between waypoints as
 * `g_cam_path_frame` passes seventeen thresholds — and they are the next piece
 * of work, not this one.
 *
 * **So this module declares `raisesScriptFlag` for 31 and not for 32.**
 * `script/waits/flag.ts` will hold stage 4's four flag-31 gates for real and
 * go on excusing its four flag-32 ones, which is the honest half: the port can
 * open the first and cannot yet open the second, and saying so in the table is
 * how the escape shrinks by the amount that was actually earned.
 */
import type { Actor } from "../actor";
import { ActorFlag } from "../actor";
import { G } from "../globals";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";
import { BossIntroBannerUpdate } from "./banner";
import {
  BOSS4_DEAD_FLAG, Boss4StateDeath, Boss4StateFlinch,
} from "./death";
import {
  BOSS4_DROP_FLAG, BOSS4_FIGHT_READY_FLAG,
  Boss4StateEntranceCarried, Boss4StateEntranceDropped,
} from "./entrance";
import { Boss4ResolveShot } from "./shot";
import { Boss4State, Boss4BlockNew } from "./state";
import type { Boss4Block as Blk } from "./state";

/** `MOV dword ptr [ESI + 0x124], 0x41F00000` at `0x00491885`. */
const BOSS4_HIT_RADIUS = 30;

/**
 * `Boss4Init` — `FUN_004917E0`. The whole of the constructor.
 *
 * The engine's version also installs the character hierarchy
 * (`FUN_00410440(char, obj+0x40, char+0x78)`), seats `char+0x348 = 0x444` and
 * calls `FUN_00408E80`; all three are the render side's and `render/` builds
 * the hierarchy from the bundle instead.
 *
 * The fifteen per-bone model pointers at `tail+0x04`..`+0x3C` are **not**
 * applied. They go into `char + i*0x90 + 0x100` for `i = 1..15`, raising
 * `0x51` in each part's `+0xEC` flags — a per-instance model override on top
 * of the skeleton's own slots. The port draws the skeleton's, which is what
 * every other class here does, and the difference is which mesh a bone wears.
 * `[diverges]`, visual, and the tail is not in the bundle to apply.
 */
export function Boss4Init(obj: Actor): void {
  const b = Boss4BlockNew();
  obj.boss4 = b;
  // `MOV EBP, [ESI+0x34]; OR EBP, 0x8000` at `0x00491820`. Cleared again by
  // the entrance on the frame it raises flag 31.
  obj.flags |= 0x8000;
  // `MOV dword ptr [ESI + 0x124], 0x41F00000`.
  obj.hitRadius = BOSS4_HIT_RADIUS;
  obj.radius = BOSS4_HIT_RADIUS;
  // `INC word ptr [0x009c7006]` and `INC word ptr [0x009c904a]` — **both**
  // counters, which is what `spawns.md` records for this class and what makes
  // `wait_enemies_alive` and `wait_enemies_present` wait for it.
  G.g_enemies_present += 1;
  G.g_enemies_alive += 1;
  // `MOV byte ptr [ESI + 0x121], 0xFF` and `+0x120` — no attack permit.
  obj.attackPermit = -1;
  // `MOV byte ptr [EAX + 0x4], DL` — the entrance state, from the tail's byte
  // `+0x01`. The exporter carries that byte as the placement's
  // `initial_state`, which is the same field class 0x30 reads it as.
  b.state = obj.initialState & 0xff;
  b.sub = 0;
  if (b.state <= 1) {
    // `CMP byte ptr [EAX+0x4], 0x1; JA` — 0 and 1 ride the transport, 2 and 3
    // are already standing.
    b.flags |= 0x01;
    // `MOV EDX, [0x009a2c88]; MOV [ECX+0x10], EDX` — `g_civilian_carrier`.
    // `[diverges]` The port has no carrier actor for stage 4's transport and
    // records `-1`; see `Boss4Block.carrierAt` and the entrance's sub 1.
    b.carrierAt = -1;
  }
  // `CALL 0x0040A8A0; MOV byte ptr [ECX + 0xB], AL` — the difficulty rank the
  // head-damage table is indexed by. `[open]`, and `G.g_difficulty` is the
  // port's nearest equivalent; the two are not proved to be the same number,
  // so the rank is left at 0 rather than guessed at.
  b.rank = 0;
}

/**
 * The dispatch table `Boss4Update` indexes — `g_class19_states`, `0x00597298`.
 *
 * A literal array in state order, so the numbers next to it are the engine's
 * own indices and a reader can check them against the memory dump. Every entry
 * whose routine is not ported is {@link Boss4StateNotPorted}, **not** a hole:
 * the engine has twenty-four function pointers and so does this, and an actor
 * that reaches one of them stops rather than falling into a neighbour's body.
 */
const BOSS4_STATES: readonly ((obj: Actor, b: Blk) => void)[] = [
  Boss4StateEntranceCarried,  // 0
  Boss4StateEntranceDropped,  // 1
  Boss4StateEntranceCarried,  // 2
  Boss4StateEntranceDropped,  // 3
  Boss4StateNotPorted,        // 4  Boss4StateApproachCamera  FUN_00493DC0
  Boss4StateNotPorted,        // 5  Boss4StateChooseAction    FUN_00494010
  Boss4StateNotPorted,        // 6  Boss4StateHoldThenApproach FUN_004943B0
  Boss4StateNotPorted,        // 7  Boss4StateWaitForCameraInRange FUN_004944A0
  Boss4StateNotPorted,        // 8  Boss4StateRiseThenIdle    FUN_004945A0
  Boss4StateNotPorted,        // 9  Boss4StateTurnToStoredPoint FUN_00494610
  Boss4StateNotPorted,        // 10 Boss4StateLookAtCamera    FUN_00494730
  Boss4StateNotPorted,        // 11 Boss4StateWalkToPoint     FUN_004958F0
  Boss4StateNotPorted,        // 12 Boss4StateWithdrawAndAdvancePhase FUN_00495A20
  Boss4StateNotPorted,        // 13 Boss4StateWaitForPlayer   FUN_00495D30
  Boss4StateNotPorted,        // 14 Boss4StateHoldUntilPlayerFree FUN_00495D90
  Boss4StateNotPorted,        // 15 Boss4StateStrikeClip65    FUN_00494A80
  Boss4StateNotPorted,        // 16 Boss4StateStrikeClip7A    FUN_00494B80
  Boss4StateNotPorted,        // 17 Boss4StateStrikeClip7B    FUN_00494C70
  Boss4StateNotPorted,        // 18 Boss4StatePinPlayer       FUN_00494D60
  Boss4StateNotPorted,        // 19 Boss4StateChargePastCamera FUN_00495070
  Boss4StateFlinch,           // 20
  Boss4StateNotPorted,        // 21 Boss4StateKnockDown       FUN_00495570
  Boss4StateDeath,            // 22
  Boss4StateNotPorted,        // 23 Boss4StateDebugFreeMove   FUN_00495E20
];

/**
 * A state this port does not run.
 *
 * `[diverges]`, and deliberately inert: an actor parked here keeps its clip
 * and its position, which is the same thing a class with no module at all
 * gets. The alternative — falling through to some other state — would be a
 * boss doing something the engine never has it do, and that is worse than a
 * boss standing still.
 */
function Boss4StateNotPorted(obj: Actor, b: Blk): void {
  void obj; void b;
}

/**
 * `Boss4Update` — `FUN_004919D0`. One boss, one 60 Hz frame.
 *
 * The engine's body is eleven calls around one indirect dispatch. Six of them
 * are the arena and the render side and are not ported; each is named on its
 * own line so that the shape of the frame survives the omissions.
 */
export function Boss4Update(obj: Actor, f: ClassFrame): void {
  void f;
  const b = obj.boss4;
  if (!b) return;

  // The banner the entrance spawned. `[diverges]` — it is a task of its own in
  // the engine, driven from the task list rather than from here; see
  // `state.ts`. It has to run **before** the state machine, because the frame
  // it opens the shutter is a frame the entrance must see state 1 on.
  if (b.banner && BossIntroBannerUpdate(b.banner)) b.banner = null;

  Boss4ResolveShot(obj, b);
  // `Boss4AdvanceArenaWaypoint` (`FUN_004928D0`),
  // `Boss4AdvancePhaseWhenWalkDone` (`FUN_00492350`) and
  // `Boss4EndPlacementWalk` (`FUN_004922C0`) run here, in that order. **Not
  // ported**, and between them they are the whole arena progression: the phase
  // at `state+0x08` never moves in this port, so `Boss4ResolveShot`'s floor
  // never lifts. See this file's header.

  (BOSS4_STATES[b.state] ?? Boss4StateNotPorted)(obj, b);

  // `FUN_00492460`, `FUN_00492620`, `FUN_00492790` and `FUN_00409B70(state
  // +0x70)` — the per-frame movement and the part placement. `[open]`, and the
  // render side's. `FUN_00493090`, `FUN_004934D0` and `FUN_004935E0` likewise.

  // `MOVSX EAX, word ptr [EDI + 0x40]; CMP [g_active_cam_path], EAX` — the
  // despawn, on the camera reaching the pair in the descriptor tail at `+0x40`
  // and `+0x42`. `[diverges]` the port has no path to that tail: the bundle
  // carries a placement's fields by name and these two have none, so the boss
  // is retired by the block ending rather than by the camera. It is the last
  // thing in the engine's frame and it never fires before the death state has.
}

/** The sidebar's line for this class. */
function Boss4Debug(obj: Actor): ActorDebug {
  const b = obj.boss4;
  if (!b) return { summary: "boss 4 · no state block" };
  const name = Boss4State[b.state] ?? `state ${b.state}`;
  const ported = BOSS4_STATES[b.state] !== Boss4StateNotPorted;
  const detail = [
    `hp ${obj.hp}/${obj.maxHp}, floor ${b.phaseHpFloor.toFixed(1)}`,
    `phase ${b.phase}, head hits ${b.headHits}`,
    obj.flags & ActorFlag.ShotImmune
      ? "refusing shots — the phase floor is reached"
      : "damageable on bone 2",
  ];
  if (b.banner) {
    detail.push(`banner step ${b.banner.step}, frame ${b.banner.frame}`);
  }
  detail.push(`flags 30/31/32: ${G.g_script_flags[BOSS4_DROP_FLAG] ? 1 : 0}`
    + `/${G.g_script_flags[BOSS4_FIGHT_READY_FLAG] ? 1 : 0}`
    + `/${G.g_script_flags[BOSS4_DEAD_FLAG] ? 1 : 0}`);
  return {
    summary: `boss 4 · ${name} sub ${b.sub}${ported ? "" : " (not ported)"}`,
    detail,
    hot: !ported || b.state === Boss4State.Death,
  };
}

export const Boss4Handler: ClassHandler = {
  init: Boss4Init,
  update: Boss4Update,
  // The death is four sub-states long and the flag lands seventy frames into
  // it, so stopping on the frame the hit points run out would hold the gate
  // shut for ever. Class 0x31 is under the same rule for the same reason.
  updatesWhenDead: true,
  // `Boss4ResolveShot` reads `obj+0x34` bit 3 itself: the boss has one weak
  // bone and a damage table of its own, and `ResolveHit` would charge it off
  // the zombie's.
  ownsShotResult: true,
  // 31 and not 32 — see this file's header. The flag whose whole chain this
  // module runs is declared; the one it cannot reach is not.
  raisesScriptFlag: BOSS4_FIGHT_READY_FLAG,
  debug: Boss4Debug,
};

registerClass(SpawnClass.Boss4, Boss4Handler);
