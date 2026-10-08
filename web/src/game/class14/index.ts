/**
 * Class 0x14 — **the stage-2 boss** (the Hierophant), character type `0x47`,
 * `boss2.bin`. Five spawns in the shipped scripts, four alternative endings
 * of stage 2 and a cameo in stage 5:
 *
 * | stage | block | descriptor `tail+0x01` | entrance | gates the script waits on |
 * |---|---|---|---|---|
 * | 2 | 35 | 0 | A | 10, 17 |
 * | 2 | 37 | 1 | B | 10, 11, 12, 13, 14, 15, 16, 17 |
 * | 2 | 39 | 3 | A | 10, 17 |
 * | 2 | 41 | 4 | B | 10, 11, 12, 13, 14, 15, 16, 17 |
 * | 5 |  3 | 2 | C | 31 |
 *
 * ## How a stage-2 gate opens
 *
 * 1. The entrance spawns the boss-name banner and raises flag 9; the banner
 *    flies the camera for 300 frames and sets `g_bHudShutterState = 1`
 *    (`game/boss_banner.ts`). Stage 5 sets the shutter from its script.
 * 2. The entrance hands over on the shutter: flag 10, the health bar,
 *    `g_boss_engaged`, and the boss joins the shot test.
 * 3. `Class14AdvancePhase` walks the phase as the hit points fall, which
 *    sends the long ladder through round B (flags 11, 12) and two scripted
 *    breaks (13..16).
 * 4. A reaction whose boss is out of hit points raises 17 (or 31) on its cue
 *    frame and becomes a death, and the death takes the body out of
 *    `g_enemies_present`.
 *
 * ## The model block
 *
 * This is the one class whose actor carries the engine's own skeletal model
 * block (`Actor.skel`, `game/skeleton.ts`): its weak point, its feet, its
 * y-follow, its leg IK and its deaths all read bone matrices the same frame's
 * pose wrote, and `Class14Update` poses and clocks the model itself -- after
 * the state, as the engine does -- through
 * `Class14AdvanceMotionAndPublishPoints`. The director leaves its clock
 * alone.
 *
 * ## Files
 *
 * `state.ts` the block, `tables.ts` its `.rdata`, `shot.ts` being shot,
 * `advance.ts` the pose, feet, legs and flipbooks, `steer.ts` the route,
 * phase and rank, `entrance.ts`, `fight.ts`, `summon.ts`, `react.ts` and
 * `death.ts` the 21 states, and this file the class itself.
 */
import type { Rng } from "../../core/rng";
import { ActorFlag, type Actor, type Boss2Actor } from "../actor";
import { ActorRegisterCameraPoint } from "../camera/track";
import { ActorDespawn } from "../despawn";
import { G, HIT_SLOT_NONE } from "../globals";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
} from "../registry";
import { MakeSkeletonModel } from "../skeleton";
import { ActorBuildSkinnedModel } from "../spawn";
import { SpawnClass } from "../spawn_class";
import { CharacterTypeOf } from "../tables";
import { Class14AdvanceMotionAndPublishPoints } from "./advance";
import {
  Class14StateEntranceA, Class14StateEntranceB, Class14StateEntranceC,
} from "./entrance";
import {
  Class14StateClose, Class14StateHunt, Class14StateLeapAttack,
  Class14StateLeapFromSide, Class14StateLungeAtCamera, Class14StateReposition,
  Class14StateRoar, Class14StateScriptedBreak, Class14StateStrike,
} from "./fight";
import {
  Class14StateCuedMotion, Class14StateKnockedDown,
} from "./react";
import {
  Class14StateDeathA, Class14StateDeathB, Class14StateDeathC,
} from "./death";
import { Class14ResolveShotBone } from "./shot";
import { Class14Flag, Class14Phase, Class14State } from "./state";
import {
  Class14AdvancePhase, Class14FollowSegment, Class14TrackAdaptiveRank,
} from "./steer";
import { Class14StateSummonRoundA, Class14StateSummonRoundB } from "./summon";
import {
  CLASS14_ANIM_SLOT_SPAWN, CLASS14_BOOK_A_HIGH, CLASS14_BOOK_A_LOW,
  CLASS14_BOOK_B_HIGH, CLASS14_BOOK_B_LOW, CLASS14_CAMERA_RISE,
  CLASS14_FLAG_BANNER, CLASS14_FLAG_BREAK_A_DONE, CLASS14_FLAG_BREAK_A_OPEN,
  CLASS14_FLAG_BREAK_B_DONE, CLASS14_FLAG_BREAK_B_OPEN, CLASS14_FLAG_DEAD,
  CLASS14_FLAG_DEAD_STAGE5, CLASS14_FLAG_INTRO_DONE,
  CLASS14_FLAG_ROUND_B_DONE, CLASS14_FLAG_ROUND_B_OPEN, CLASS14_SHOT_SPHERE,
  Class14AnimMotion, Class14WindowTimingRow,
} from "./tables";

export { Class14Phase, Class14State } from "./state";

/** `char+0x68 = 1` -- the actor's rotation goes on X, Z, Y. */
const CLASS14_ROTATION_ORDER = 1;
/** Boss2's skeleton: sixteen bones, if the type table is missing. */
const CLASS14_BONES = 16;

function IsBoss2(obj: Actor): obj is Boss2Actor {
  return obj.cls === SpawnClass.Boss2;
}

/**
 * `Class14Init` — `FUN_00475E90`.
 *
 * ```c
 * tail = obj+0x130C; g_class14_char = obj+0x194; g_class14_xform = obj+0x40
 * g_class14_state = obj+0x1310 = ActorAllocSub(0xBC)       ; zeroed
 * obj+0x34 |= 0x8000                                       ; 0x00475ECF
 * char+0x60 = tail[0]                                      ; 0x47
 * state+0x62 = 0xB; char+0x20 = anim_slots[0xB][0]; char+0x00 = char+0x08 = 0
 * ActorBuildSkinnedModel(char, xform, recs)                ; hit slot, 0x80
 * char+0x1158 = NoOpStub; char+0x68 = 1
 * obj+0x124 = 30.0                                         ; 0x00475F4F
 * g_enemies_present++; g_enemies_alive++
 * obj+0x121 = obj+0x120 = 0xFF; RegisterEnemySlot(obj)
 * state+0x04 = tail[1]; state+0x05 = 0; state+0x0C = 6.0  ; 0x00475F98
 * state+0x1C = tail+0x04..+0x0C; state+0x00 = 1; the route corners
 * state+0x64..+0x78 = 0
 * A = {0x2CB, 0x2CB, 0x2ED, hold 0, rate 1.0}; B = {0x2EE, 0x2EE, 0x315, hold 0}
 * state+0x94 = 0; B.rate = g_class14_window_timing[0].open_rate
 * state+0x96 = GetDamageRank(); +0x97 = 0; +0x98/+0x99 = the players' lives
 * ```
 *
 * **Both counters**, so a `wait_enemies_alive` or `wait_enemies_present` gate
 * sees the boss. `RegisterEnemySlot` (`FUN_00408E80`) is the camera's slot
 * pass in the port (`camera/slots.ts`), which asks `tracksCamera` below.
 */
export function Class14Init(obj: Actor, rng?: Rng): void {
  void rng;
  if (!IsBoss2(obj)) return;
  const t = obj.boss2;
  const d = obj.class14;
  obj.flags |= ActorFlag.NoShotTest;
  if (d) obj.charType = d.char_type;
  t.animSlot = CLASS14_ANIM_SLOT_SPAWN;
  // `[port-only]` The block is embedded at `obj+0x194` in the engine; the
  // port makes it here, where the engine starts writing it.
  const skel = MakeSkeletonModel(
    CharacterTypeOf(obj)?.bone_count ?? CLASS14_BONES, 5);
  skel.motion = Class14AnimMotion(CLASS14_ANIM_SLOT_SPAWN);
  obj.skel = skel;
  ActorBuildSkinnedModel(obj);
  skel.order = CLASS14_ROTATION_ORDER;
  obj.hitRadius = CLASS14_SHOT_SPHERE;
  G.g_enemies_present += 1;
  G.g_enemies_alive += 1;
  obj.attackPermit = -1;
  t.state = (d?.state ?? 0) as Class14State;
  t.sub = 0;
  t.cameraRise = CLASS14_CAMERA_RISE;
  if (d) {
    t.dir.x = d.dir[0]; t.dir.y = d.dir[1]; t.dir.z = d.dir[2];
  }
  t.flags = Class14Flag.OffRoute;
  if (d) {
    for (let i = 0; i < 4 && i < d.route.length; i++) {
      t.route[i].x = d.route[i][0];
      t.route[i].y = 0;
      t.route[i].z = d.route[i][2];
    }
  }
  t.legs = [0, 0, 0, 0, 0, 0];
  t.bookA = { frame: CLASS14_BOOK_A_LOW, low: CLASS14_BOOK_A_LOW,
              high: CLASS14_BOOK_A_HIGH, hold: 0, rate: 1 };
  t.bookB = { frame: CLASS14_BOOK_B_LOW, low: CLASS14_BOOK_B_LOW,
              high: CLASS14_BOOK_B_HIGH, hold: 0,
              rate: Math.fround(Class14WindowTimingRow(0).open_rate) };
  t.timing = 0;
  // `GetDamageRank` (`FUN_0040A8A0`) -- `g_damage_rank`, as a signed byte.
  t.rank = (G.g_damage_rank << 24) >> 24;
  t.rankBump = 0;
  t.lives = [((G.g_player_lives[0] ?? 0) << 24) >> 24,
             ((G.g_player_lives[1] ?? 0) << 24) >> 24];
}

/** `CALL dword ptr [ECX*0x4 + 0x596218]` at `0x0047618F`. */
function Class14RunState(obj: Boss2Actor, f: ClassFrame): void {
  switch (obj.boss2.state) {
    case Class14State.Entrance0:
    case Class14State.Entrance3:
      Class14StateEntranceA(obj, f); return;
    case Class14State.Entrance1:
    case Class14State.Entrance4:
      Class14StateEntranceB(obj, f); return;
    case Class14State.Entrance2: Class14StateEntranceC(obj, f); return;
    case Class14State.Hunt: Class14StateHunt(obj, f); return;
    case Class14State.Close: Class14StateClose(obj, f); return;
    case Class14State.Roar: Class14StateRoar(obj, f); return;
    case Class14State.Strike: Class14StateStrike(obj, f); return;
    case Class14State.LungeAtCamera: Class14StateLungeAtCamera(obj, f); return;
    case Class14State.SummonRoundA: Class14StateSummonRoundA(obj, f); return;
    case Class14State.SummonRoundB: Class14StateSummonRoundB(obj, f); return;
    case Class14State.LeapAttack: Class14StateLeapAttack(obj, f); return;
    case Class14State.Reposition: Class14StateReposition(obj, f); return;
    case Class14State.LeapFromSide: Class14StateLeapFromSide(obj, f); return;
    case Class14State.ScriptedBreak: Class14StateScriptedBreak(obj, f); return;
    case Class14State.CuedMotion: Class14StateCuedMotion(obj, f); return;
    case Class14State.KnockedDown: Class14StateKnockedDown(obj, f); return;
    case Class14State.DeathA: Class14StateDeathA(obj, f); return;
    case Class14State.DeathB: Class14StateDeathB(obj, f); return;
    case Class14State.DeathC: Class14StateDeathC(obj, f); return;
    default: return;
  }
}

/**
 * `Class14Update` — `FUN_00476150`. One actor, one 60 Hz frame.
 *
 * ```c
 * Class14ResolveShotBone(obj);
 * g_class14_states[state->state](obj);
 * Class14AdvanceMotionAndPublishPoints(obj);          ; the pose, then the clock
 * if ((state->flags & 1) == 0) {
 *     if (Class14FollowSegment(xform, route+0, route+1, 5.0))
 *         Class14FollowSegment(xform, route+2, route+3, 5.0);
 *     Class14FollowSegment(xform, route+1, route+2, 10.0);
 * }
 * Class14AdvancePhase(obj);
 * ActorRegisterCameraPoint(state->cameraRise);        ; 0x0047621E
 * Class14TrackAdaptiveRank();
 * if (g_active_cam_path == tail+0x30 && g_cam_path_frame == tail+0x32) {
 *     if (obj+0x3C != -1) g_hit_slots[obj+0x3C] = 0;
 *     ActorDespawn(obj);
 * }
 * ```
 */
export function Class14Update(obj: Actor, f: ClassFrame): void {
  if (!IsBoss2(obj)) return;
  const t = obj.boss2;
  Class14ResolveShotBone(obj, f.rng, f.host, f.events);
  Class14RunState(obj, f);
  Class14AdvanceMotionAndPublishPoints(obj);
  if ((t.flags & Class14Flag.OffRoute) === 0) {
    if (Class14FollowSegment(obj.pos, t.route[0], t.route[1], 5)) {
      Class14FollowSegment(obj.pos, t.route[2], t.route[3], 5);
    }
    Class14FollowSegment(obj.pos, t.route[1], t.route[2], 10);
  }
  Class14AdvancePhase(obj);
  // `ActorRegisterCameraPoint(state+0x0C)` at `0x0047621E`, no gate: the
  // camera point lifted by the rise, and -- through its tail call at
  // `0x00409BED` -- `RegisterForShotTest`, which is how this class enters
  // the shot test at all.
  ActorRegisterCameraPoint(obj, f.host, t.cameraRise);
  Class14TrackAdaptiveRank(obj);
  const d = obj.class14;
  if (d && G.g_active_cam_path === d.despawn_path
      && G.g_cam_path_frame === d.despawn_frame) {
    if (obj.hitSlot !== HIT_SLOT_NONE) G.g_hit_slots[obj.hitSlot] = HIT_SLOT_NONE;
    ActorDespawn(obj);
  }
}

export const Boss2Handler: ClassHandler = {
  init: Class14Init,
  update: Class14Update,
  // `Class14Init` installs `Class14Update` and returns (`0x0047613D`).
  firstUpdateNextWalk: true,
  // The deaths are three states of the class's own: stopping on the frame
  // the hit points run out would freeze the boss in the reaction that is
  // about to raise the flag.
  updatesWhenDead: true,
  // `Class14ResolveShotBone` reads `obj+0x34` bit 3 itself and runs its own
  // damage table; a shot must not go through `ResolveHit`.
  ownsShotResult: true,
  // `Class14Update` makes the `ActorRegisterCameraPoint` call itself, at the
  // exe's site, and that call is the class's `RegisterForShotTest`.
  registersForShotTest: true,
  // `obj+0x194` steps inside `Class14AdvanceMotionAndPublishPoints`
  // (`FUN_00476AD0`), after the state and the draw -- not before the update.
  advancesOwnMotion: true,
  raisesScriptFlag: [
    CLASS14_FLAG_BANNER, CLASS14_FLAG_INTRO_DONE, CLASS14_FLAG_ROUND_B_OPEN,
    CLASS14_FLAG_ROUND_B_DONE, CLASS14_FLAG_BREAK_A_OPEN,
    CLASS14_FLAG_BREAK_A_DONE, CLASS14_FLAG_BREAK_B_OPEN,
    CLASS14_FLAG_BREAK_B_DONE, CLASS14_FLAG_DEAD, CLASS14_FLAG_DEAD_STAGE5,
  ],
  // `ActorRegisterCameraPoint` tail-calls `RegisterForCameraTracking`
  // (`FUN_00408EC0`), which tests only `obj+0x34` bit `0x10000`; the boss is a
  // candidate whenever that bit is clear, which this class sets and clears
  // itself. The class is not in `ENEMY_CLASSES`, so it says so here.
  tracksCamera: () => true,
  onDeadSweep: () => {
    // Nothing. `Class14ApplyBoneDamage` has already dropped the alive count
    // and the class's own death states drop the present count, so the generic
    // teardown would take both twice.
  },
  debug: (obj): ActorDebug => {
    if (!IsBoss2(obj)) return { summary: "boss2 · no tail" };
    const t = obj.boss2;
    return {
      summary: `boss2 · ${Class14State[t.state]} sub ${t.sub}`
        + ` · ${Class14Phase[t.phase]}`,
      detail: [
        `hp ${obj.hp}/${obj.maxHp}, rank ${t.rank}, timing row ${t.timing}`,
        `B ${t.bookB.frame - t.bookB.low} hold ${t.bookB.hold}`,
        `counters ${t.counter0}/${t.counter1}/${t.counter2}/${t.counter3}`,
      ],
      hot: t.state >= Class14State.CuedMotion,
    };
  },
};

registerClass(SpawnClass.Boss2, Boss2Handler);
