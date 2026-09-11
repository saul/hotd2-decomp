/**
 * The port, exercised with no renderer at all.
 *
 * This file imports **no three.js and no DOM**, which is the point of the
 * boundary. Every gameplay bug in the session that produced this architecture
 * (facing inverted, permits deadlocked, the cat running the zombie's machine,
 * throwers gated on a rank test the engine does not have) would have been
 * caught by one of the assertions below, in a second, without looking at the
 * screen.
 *
 * It is `game/` plus the three-free things that sit either side of it:
 * `core/`, `script/`'s walker, `render/hinge.ts` — the one transcription in
 * `render/` — and `app/systems.ts`, which is the port's *frame* and imports
 * three.js only as a type. That last one is how the tick a stopped transport
 * hands the port is reachable here at all; `test/state.test.ts` drives the
 * same class for the same reason.
 *
 * Run with `npm run test:port`.
 */
import type {
  ApproachJson, CharacterPlacement, CharactersJson, CharacterType,
  PlayerDamageJson, TrackingJson,
} from "../src/bundle";
import { Rng } from "../src/core/rng";
import { Scope } from "../src/core/scope";
import { CameraFrame } from "../src/core/camera";
import type { Context, Tick } from "../src/core/system";
import { HingePose } from "../src/render/hinge";
import { Events } from "../src/core/events";
import { authoredFrameHeld, authoredFrameOfTicks,
         ticksOfAuthoredFrame } from "../src/core/play_cursor";
import { ActorInitHitPoints, ActorSpawn, GameUpdate, RetireUnlistedActor }
  from "../src/game/director";
import { ActorKillAll } from "../src/game/combat/resolve_hit";
import { CamAdvancePathFrame, CamPathCueReached, CamSetPathTarget }
  from "../src/game/camera/path";
import { ActorAdvanceMotion } from "../src/game/motion";
import { MOTION_FLAGS_INIT, MotionFlag, type Boss2Actor }
  from "../src/game/actor";
import { CameraPointRiseFor, UpdateCameraFreeFlag }
  from "../src/game/camera/track";
import { ActorByAt, AppState, G, ResetGameGlobals, ResetSceneOnEnter }
  from "../src/game/globals";
import {
  RAIN_PARTICLE_COUNT, RainAdvanceParticles, RainResetParticles,
  type RainRules,
} from "../src/game/effects/rain";
import { NULL_HOST, type GameHost, type ShotPick } from "../src/game/host";
import { FishUpdate } from "../src/game/class51";
import { FishFlag, FishState, type FishTail } from "../src/game/class51/state";
import { FrogReadNextScriptCommand, FrogUpdate } from "../src/game/class11";
import { FrogFlag, FrogState, type FrogTail } from "../src/game/class11/state";
import { OwlStateDiveAtCamera, OwlUpdateAndResolveShot }
  from "../src/game/class43";
import { OwlDiveKind, OwlState, type OwlTail }
  from "../src/game/class43/state";
import { ActorShotFeedback } from "../src/game/combat/feedback";
import { BLOOD_FIRST_SLOT, BLOOD_LAST_CEL, SpawnBloodSpray }
  from "../src/game/effects/blood";
import {
  BodyCreatureState, BodyCreatureUpdate, MarkBodyCreatureShot,
  SpawnBodyCreature,
} from "../src/game/body_creature";
import { OriginalWeaponKind, SHOT_EFFECT_RING, TRACER_LAST_FRAME,
         FLASH_LAST_FRAME } from "../src/game/effects/shot_effects";
import { ShotEffectsTick } from "../src/game/effects/tick";
import { SpawnSpriteEffect, SpriteEffectKind }
  from "../src/game/effects/sprite";
import { MarkActorShot, QueueShotRequest, g_gunshot_sound_ids }
  from "../src/game/combat/shot";
import { AttackListOf, MotionOf, MotionPlayFrame, MotionPlayLength,
         SetGameTables, T } from "../src/game/tables";
import {
  ColiTestSphereAgainstActors, ColiTestSphereAgainstFullSet,
  ColiTraceSegmentAllSets,
  QueryGroundHeightAt, QueryGroundSurfaceAt,
} from "../src/game/coli";
import { MotionRow, StrikeSub, ZombieState }
  from "../src/game/class30/states";
import { ZombieAttackRefusal, ZombieStateHoldAtRange }
  from "../src/game/class30/hold";
import { ZombieStateBackOff } from "../src/game/class30/backoff";
import { ZombiePickAttack, ZombieStateStrike }
  from "../src/game/class30/strike";
import { ZombieStateWaitTurn } from "../src/game/class30/wait_turn";
import { ZombieStateWalkDistance } from "../src/game/class30/walk_distance";
import { ZombieArmedHands, ZombiePickThrowingHand,
         ZombieShouldStandAndThrow, ZombieStateStandAndThrow }
  from "../src/game/class30/stand_throw";
import { ThrownWeaponUpdate, THROWN_SPIN_RATE }
  from "../src/game/class31/projectile";
import { ActorPlayHitVoice, ActorVoice }
  from "../src/game/combat/voice";
import { ZombieReleaseWeaponLoopSe } from "../src/game/class30/weapon_loop";
import { ActorFlag, DamageZone, ThrowerFlag, ThrowerStance, ZombieFlag2,
         type Actor, type HumanoidActor, type OneHitTargetActor,
         type ScriptedSceneryActor,
         type SetPiecePropActor, type ThrowerActor, type ZombieActor }
  from "../src/game/actor";
import { ScriptedCarrierUpdate33, ScriptedPushableUpdate33,
         ScriptedScenerySelector } from "../src/game/class33";
import { SCENERY_SKIP_COLLISION } from "../src/game/class33/pushable";
import { DescriptorFromPlacement } from "../src/game/descriptor";
import { IsPlayerAttackable } from "../src/game/combat/player";
import { QUEUE_CAP, RANK_SLOTS, RankEnemiesByDistance }
  from "../src/game/combat/rank";
import {
  ReleaseAttackSlot, ThrowerReleaseAttackPermit, ThrowerTryClaimAttackSlot,
  TryClaimAttackSlot,
} from "../src/game/combat/permits";
import { EnemyZombieUpdate, ZombieEntryState } from "../src/game/class30";
import { ZombieEnterCorpseState, ZombieReleasePermitAndUntrack }
  from "../src/game/class30/death";
import { ZombieOnShot } from "../src/game/class30/on_shot";
import {
  ReleaseEnemyAliveCount, ReleaseEnemyPresentCount, ThrowerReleaseSlotOnDeath,
  UNCOUNTED_CHAR_TYPE, UNCOUNTED_INITIAL_STATE,
} from "../src/game/combat/counts";
import { ActorDeadSweep, ActorDespawn } from "../src/game/despawn";
import { g_class30_bone_cels, ZombieBoneCelSlots }
  from "../src/game/class30/bonecels";
import { HIT_SLOT_CLAIMED } from "../src/game/hit_slots";
import { ActorIsEnemy, type ClassFrame, DeadSweep, ENEMY_CLASSES, g_class_handlers, registerClass }
  from "../src/game/registry";
import { PORTED_CLASSES } from "../src/game/classes";
import {
  CLASS20_DEATH_MOTION, CLASS20_HEAD_BONE, CLASS20_SCORE_HEAD,
  CLASS20_SCORE_HEAD_COMBO_STEP, CLASS20_SCORE_KILL, CLASS20_SINK_FRAMES,
  CLASS20_SINK_PER_FRAME, CLASS20_SPIN_STEP, CLASS20_WALL_TURN,
  OneHitTargetState, OneHitTargetUpdate, g_class20_idle_motions,
} from "../src/game/class20";
import { ActorSnapToGroundHeight, ZombiePushOutOfWorldAndActors }
  from "../src/game/class30/ground";
import { ActorArcBeginFalling } from "../src/game/class30/emerge";
import { ActorPointIsAhead, ZombieScriptEnded, ZombieStateHoldForCameraCue }
  from "../src/game/class30/target";
import { ActorModelScale } from "../src/game/root_motion";
import { ZOMBIE_SPRINTS, ZombieRunMotion } from "../src/game/class30/states";
import { SeveredHeadPhase, SeveredHeadUpdate, SpawnSeveredHead }
  from "../src/game/effects/severed_head";
import type { TargetScriptJson } from "../src/bundle/characters";
import { SpawnClass } from "../src/game/spawn_class";
import { GameSystem, syncPortGlobals } from "../src/app/systems";
import { CivilianAttachSet, CivilianCountMotionLoops, CivilianOp,
         CivilianTarget,
         CivilianUpdate, CivilianWait, PoseHookGrowAndPushOutOfWorld }
  from "../src/game/class10";
import type { CivilianCmdJson, CivilianItemJson } from "../src/bundle/scene";
import { GameMode } from "../src/game/game_mode";
import { ThrowerBeginKnockbackArc } from "../src/game/class31/death";
import { ActorBodyConditionFromHands, SPENT_CONDITION }
  from "../src/game/class30/condition";
import { ThrowerState, ThrowSub } from "../src/game/class31/states";
import { ThrowerStateThrow } from "../src/game/class31/thrower";
import { ThrowerStrikeConnect } from "../src/game/class31/strike";
import { ThrowerStanceOf } from "../src/game/class31/tables";
import { SND_LEAP_LANDED } from "../src/game/class31/leap";
import { dist2d, vec3, type Vec3 } from "../src/game/vec";
import { ActorPlayHitReaction, EffectCode, HitResultCode, ResolveHit }
  from "../src/game/combat/resolve_hit";
import { ActorSetMotionBlended } from "../src/game/class30/motion_cue";
import type { BreakablesJson, ScriptJson } from "../src/bundle";
import { Walker } from "../src/script/walker";
import { SHUTTER_FRAMES, Shutter } from "../src/script/state/shutter";
import { seekTo } from "../src/script/seek";
import {
  Boss2Handler, CLASS14_FLAG_DEAD, CLASS14_FLAG_DEAD_STAGE5,
  CLASS14_FLAG_INTRO_DONE, CLASS14_FLAG_ROUND_B_OPEN, Class14AdvancePhase,
  Class14Phase, Class14State,
} from "../src/game/class14";
import { ScriptFlagsThisBundleCanRaise }
  from "../src/script/waits/flag";
import { CHAPTER_CARD_FLAG, CHAPTER_CARD_FRAMES }
  from "../src/game/class60";
import { RESULT_CARD_FLAG, RESULT_CARD_FRAMES }
  from "../src/game/class61";
import { BOSS4_DROP_FLAG, BOSS4_FIGHT_READY_FLAG }
  from "../src/game/class19/entrance";
import { BOSS4_DEAD_FLAG, BOSS4_DEATH_DWELL }
  from "../src/game/class19/death";
import { Boss4ResolveShot } from "../src/game/class19/shot";
import {
  BOSS4_HEAD_DAMAGE, BOSS4_PHASE_HP_FRACTION, BOSS4_SOFT_SURFACE,
  BOSS4_WEAK_BONE, Boss4State,
} from "../src/game/class19/state";
import {
  BreakableState, BreakableFlag, BreakablePropTakeShot, BreakablePropUpdate,
  BreakableSlot, GrantExtraLife, ItemSet, MEMBERS_PER_GROUP,
  PlaceBreakableGroup, PropContainerPlacerUpdate, PlaceKindedProp,
  KindedPropUpdate, PropFamily, KIND_SLOT, SLOT_NONE, PlaceGenericProp,
  GENERIC_POSE_ORDER, GENERIC_SLOT_STRIP, PoseOrder,
  LiftUpdate, LiftFlag, LIFT_NEAR_CLOSED, LIFT_NEAR_OPEN,
  LIFT_FAR_CLOSED, LIFT_PANEL_CLOSED, LIFT_PANEL_OPEN, LIFT_PANEL_DELAY,
  LIFT_RIDE_DROP, LIFT_HINGE_STEP, SFX_LIFT_GATE, SFX_LIFT_PANEL,
  PropExpireByStepLifetime, GENERIC_DRAW_SLOT, GENERIC_DESCRIPTOR_SLOT,
  GENERIC_LIFETIME_FROM_1F4,
  GENERIC_ORIGINAL_MODE_ONLY, makeBreakableProp, type BreakableProp,
  PropCuePhase, PropContainerRaisesScriptFlag, PROP75_DROP_AT,
  PROP75_RIDE_LENGTH, PROP75_SCRIPT_FLAG, PROP75_TYPE,
} from "../src/game/class41";
import { BreakablePropPoolUpdate } from "../src/game/class41/pool";
import {
  Type43ItemSet, TYPE43_PICKUP_SLOT,
} from "../src/game/class41/type43";
import {
  SCRIPT_FLAG_TYPE54_DRIFT, TYPE31_DESPAWN_CAM_FRAME,
  TYPE31_DESPAWN_CAM_PATH, TYPE54_DRIFT_FRAMES,
} from "../src/game/class41/draw_only";
import { ClearPropShotTestList } from "../src/game/class41/shot_test";
import {
  CLASS21_HP_BY_RANK, CLASS21_MOTION_FREED, g_st2car_path_table,
  RescueTargetState, RescueTargetUpdate,
} from "../src/game/class21";
import {
  MOUSE_FIRST_SLOT, MOUSE_HIT_RADIUS, MOUSE_LAST_SLOT, MOUSE_PAUSE_FRAMES,
  MOUSE_SPEED, MOUSE_TURN_SPREAD,
  MouseBranchTriggerUpdate, MouseState, MouseWanderUpdate,
} from "../src/game/class52";
import {
  PlaceChainSegments, PlaceFragmentProps, PlaceStoryModeSwitch,
} from "../src/game/class41/triggers";
import {
  STORY_SWITCH_FLAG_AT, STORY_SWITCH_SCRIPT_FLAG,
} from "../src/game/class41/branch";
import {
  BamsHalfway, FallingContainerUpdate, PlaceFallingContainer,
  PropBuildScriptFlagEffect, ScriptFlagEffectFlag, ScriptFlagEffectUpdate,
  SFX_SCRIPT_FLAG_EFFECT, FALLING_SLOT_LOOSE, FALLING_SLOT_WHOLE,
  PropBuildRisingDoor, RisingDoorUpdate, RisingDoorRise, RisingDoorRattles,
  RISING_DOOR_CEILING, RISING_DOOR_CEILING_OTHER, RISING_DOOR_RATTLE_SLOT,
  RISING_DOOR_STEP_OTHER,
} from "../src/game/class44";
import { SpawnPropContainers, SpawnSlotActors }
  from "../src/game/director";
import {
  SetPieceState, SetPiecePropUpdate,
  DROP_GRAVITY, SLIDE_FRAMES, SLIDE_VX, SLIDE_VZ,
  type SetPieceParams,
} from "../src/game/class24";
import {
  HumanoidCond, HumanoidOp, HumanoidTurn, ScriptedHumanoidUpdate,
  g_class25_path_offsets,
  type HumanoidProgram,
} from "../src/game/class25";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

// -- a stage's worth of tables, small enough to reason about ----------------

/**
 * A clip. `perFrame` is root translation along the clip's own -Z, which is
 * what actually walks a zombie: the run carries 1.289 units a frame on the
 * real data, the walk carries nothing.
 */
const motion = (frames: number, perFrame = 0, play?: number) => ({
  bank: "t", frames, fps: 30,
  root: Array.from({ length: frames * 3 },
                   (_, i) => (i % 3 === 2 ? -perFrame * Math.floor(i / 3) : 0)),
  rot: [],
  // `g_motion_play_length`, when the fixture wants to pin it. The real table
  // is `2n - 2` for some motions and `2n - 3` for others, so a clip that
  // carries the odd one is the only thing that can tell "read the bundle"
  // apart from "derive it from the frame count".
  ...(play === undefined ? {} : { play }),
});

const TYPE: CharacterType = {
  type: 1, name: "test zombie", file: "t.bin", bone_count: 16,
  actor_radius: 10,
  // Two bones, upper arm and forearm, with the forearm parented to it: enough
  // for the sever cascade, which is the part that used to leave a limb
  // animating below a destroyed one.
  bones: [
    { bone: 4, part: "r_upperarm", slot: 4, offset: [0, 0, 0], parent: null,
      damage_rank: [], hit_radius: 2,
      steps: [[0x11, EffectCode.Escalate, 3], [0x12, EffectCode.Escalate + 1, 3],
              [0x13, EffectCode.Escalate + 2, 3], [0x14, EffectCode.Sever, 3]] },
    { bone: 5, part: "r_forearm", slot: 5, offset: [0, 0, 0], parent: 0,
      damage_rank: [], hit_radius: 2, steps: [] },
    { bone: 1, part: "torso", slot: 1, offset: [0, 0, 0], parent: null,
      damage_rank: [], hit_radius: 3,
      steps: [[0x21, EffectCode.Last, 3]] },
    // `head_bone: 2` below named a bone this table did not have, so anything
    // that reads the head's *own* record -- the model the severed head flies
    // with, for one -- had nothing to find. No steps: a head hit here is a
    // plain hit, which is what the headshot-burst assertions want.
    // No `steps`, so a head hit here is a plain hit that swaps nothing --
    // which is the case the severed head has to work in, since `boneSlot` only
    // has an entry once something has been swapped. The damage comes from
    // `damage_rank`, which `DamageRankModifier` indexes with `g_damage_rank`.
    { bone: 2, part: "head", slot: 0x30, offset: [0, 0, 0], parent: null,
      damage_rank: new Array(16).fill(5), hit_radius: 2, steps: [] },
  ],
  // Two rows, because the engine picks one with `obj+0x130C` — the shipped
  // characters carry a second set at body condition 3 (motions 257-263) and
  // the port used to read row 0 for every actor.
  head_bone: 2, reactions: { "0": [960, 961, 974, 979, 981, 982, 977],
                             "3": [257, 258, 259, 260, 261, 262, 263] },
  attacks: {
    "0": {
      // `distance` is deliberately just *outside* the inner ring, as the real
      // tables have it -- `char_adv00`'s two attacks name 26.0 and 25.0
      // against a ring of 25. That is what makes an actor arriving from the
      // hold already inside it, so the swing starts on the ring and the
      // retreat ends exactly back at the spot it started from. A fixture with
      // the distance *inside* the ring instead makes the retreat overshoot its
      // own anchor and turn round, which is a property of the fixture and not
      // of the port.
      "1": {
        strike: 100, lunge: 101, distance: 26, hit_frame: 10,
        player_motion: 7, cancel_mask: 8,
      },
    },
    // The throw entries: index 0 is bone 5's and index 1 is bone 8's, and the
    // range is a throw's rather than a reach's.
    "7": {
      "0": { strike: 102, lunge: 101, distance: 99, hit_frame: 8,
             player_motion: 4, cancel_mask: 2 },
      "1": { strike: 103, lunge: 101, distance: 99, hit_frame: 8,
             player_motion: 4, cancel_mask: 4 },
    },
    "8": {
      "0": { strike: 102, lunge: 101, distance: 99, hit_frame: 8,
             player_motion: 4, cancel_mask: 2 },
      "1": { strike: 103, lunge: 101, distance: 99, hit_frame: 8,
             player_motion: 4, cancel_mask: 4 },
    },
  },
  attack_picks: { "0": new Array(80).fill(1) },
  throw: null,
  // The stationary thrower's kit. Body conditions 7 and 8 index the same two
  // attack entries, one per hand, exactly as `tutorial.bin`'s do; the hand
  // slots are what `ZombieArmedHands` compares the live draw slots against.
  zombie_throw: {
    hands: [
      { bone: 5, held: 7886, bare: 7883, weapon_bone: 6, projectile: 585 },
      { bone: 8, held: 7882, bare: 7879, weapon_bone: 9, projectile: 585 },
    ],
    straight: true, speed: 1, speed_standing: 1.5, aim_ahead: 4,
    aim_side: 0.6, aim_drop: 1.5, arc_gravity: 0.009, hit_kind: 4,
    stick_frames: 30, blink_frames: 60,
  },
  motion_row: { "0": [10, 10, 12, 12, 14], "7": [10, 10, 12, 12, 14],
                "8": [10, 10, 12, 12, 14] },
  backoff_index: 4,
  gore: {}, torso_stages: 3,
  motions: {
    // 10 the in-place walk and idle, 12 the run that closes, 14 the retreat.
    "10": motion(20, 0, 37), "12": motion(16, 1.289), "14": motion(36, -0.429),
    // 101 the lunge, which carries the actor the last few units into range.
    // The bite, scaled like the real one: `char_adv00`'s runs to -15.55 net
    // against a 25-unit inner ring, so the recover is most of the ring and the
    // retreat that walks it back is the pause between bites.
    "100": motion(20, 0.8), "101": motion(20, 0.6),
    // The two throw clips, which carry no root motion at all --
    // `tutorial.bin`'s net exactly zero.
    "102": motion(24), "103": motion(20),
    // 185 (0xB9) is the pose `ZombieStateEmerge` holds while it waits.
    "185": motion(4),
    // 300 (0x12C) is `ThrowerStateLeapToPoint`'s clip, cut into a windup, a
    // flight and a landing by the `drop` arc script. It has to be baked for
    // the type or the state has no clip frame to measure its stages against,
    // and an unbaked stage is an actor that hangs in the window for ever.
    "300": motion(50),
    // 439 (0x1B7) is the same, for `zskamere`.
    "439": motion(22),
    // 988 (0x3DC) is class 0x20's death clip -- `OneHitTargetUpdate` names it
    // by id. Deliberately shorter than the 120-frame sink that follows, which
    // is the shape the "plays its death animation twice" report is about:
    // char_adv00's real one is 82 frames against the same 120.
    "988": motion(30),
    // 923 (0x39B), the van jump-out `ZombieStateMotionCue21` plays: 41 frames
    // against a play length of 79, carrying 13.6 units of root translation.
    // The odd play length is the point of pinning it -- the cue this state
    // exits on is expressed in the play clock, not in authored frames.
    "923": motion(41, 0.332, 79),
    "900": motion(30), "901": motion(30), "902": motion(30), "903": motion(30),
    "960": motion(39), "961": motion(39), "974": motion(29), "977": motion(29),
    "979": motion(29), "981": motion(29), "982": motion(29),
    // ...and the second stumble row, the one body condition 3 selects: 43
    // frames rather than 29, which is how the two are told apart on screen.
    "257": motion(43), "258": motion(43), "259": motion(43), "260": motion(43),
    "261": motion(43), "262": motion(43), "263": motion(43),
    // The twelve entrance states' clips. 184 (0xB8) is the surfacing clip
    // whose two splash cursors are 0x15 and 0x1B, so its play length has to
    // reach past both; 186/187 (0xBA/0xBB) the scripted grab's pair; 700 a
    // plain held clip; 1009/1010 the scripted attacker's strike and idle.
    "184": motion(20, 0, 45), "186": motion(24), "187": motion(24),
    "700": motion(18), "1009": motion(20, 0, 41), "1010": motion(16),
    // 984 (0x3D8) is the surfacing clip for every character type outside
    // 0xF..0x11, which is the one this file's type 1 takes.
    "984": motion(24, 0, 47),
    // State 26's clips: 955 (0x3BB) the jump, and 1015 (0x3F7) the limp of a
    // corpse shot out of the air -- which is not a landing animation.
    "955": motion(30), "1015": motion(20),
    // The death of an actor still holding something: 1017 (0x3F9) is what
    // `ChooseDeathMotion` gives it and 1016 (0x3F8) the clip
    // `ZombieStateDeathFallAndBounce` cuts to when the body lands.
    //
    // Both carry their **real** shape from `zom.bin` and their real
    // `g_motion_play_length`, and 1017's 85 is the load-bearing half: state 12
    // sub 1 is `if (obj+0x19C < 0x3C) return;`, a literal 60 measured against
    // that play clock. A fixture that left `play` to be derived from the frame
    // count would pass on a bundle that got it wrong, and the whole of
    // `PLAYER_HANGS.md` 22 is an actor that never reached 60.
    "1017": motion(44, 0, 85), "1016": motion(36, 0, 69),
    // 987 (0x3DB) is the clip `ChooseDeathMotion` gives body conditions 5 and
    // 6 — the two that die through state 9 rather than state 6.
    "987": motion(24),
    // `ZombieStateDragTarget`'s four: 420 (0x1A4) the drag, 424 (0x1A8) the
    // kill, 426 (0x1AA) the aftermath when the civilian is already dead, and
    // 432 (0x1B0) the settle. Sub 2 waits for play cursor 0x2D on **whichever
    // of the two kill clips sub 1 started**, not on 432 — so it is 424 and 426
    // whose play lengths have to reach past 45.
    "420": motion(20, 0, 30), "424": motion(32, 0, 60),
    "426": motion(32, 0, 60), "432": motion(30, 0, 60),
  },
};

const APPROACH: ApproachJson = {
  rings: [{ inner: 25, mid: 38, outer: 51 }],
};

// Four curves, because `TURN_CURVE_DEFAULT` selects the second one — the
// fixture used to carry one and say `curve: 0`, which it could do only while
// the number it was indexing with travelled beside it.
const TRACKING: TrackingJson = {
  curves: [0, 1, 2, 3].map(() => new Array(64).fill(16)),
};

const PLAYER: PlayerDamageJson = { start_lives: 2 };

/** One stage's `characters` block, with only what the port reads filled in. */
const CHARS = {
  types: { "1": TYPE },
  approach: APPROACH,
  tracking: TRACKING,
  player: PLAYER,
  placements: [],
  // Bone -> damage zone: 4 and 5 are the right arm, bit 1.
  bone_zones: [0xff, 0xff, 0, 0xff, 1, 1],
  // Bone -> reaction group, which picks the stumble within the row.
  reaction_groups: [0, 1, 0, 1, 2, 2],
  deaths: { front: [900], back: [901] },
  difficulty: {
    hp_delta: [0, 0, 0, 0, 0], hp_min: 1, hp_max: 300,
    initial_rank: [0, 0, 2, 0, 0],
  },
  combat: undefined,
  note: "",
} as unknown as CharactersJson;

/**
 * The scene state's major while a stage is being played — the `cam/` path
 * camera row. `IsPlayerAttackable` (`FUN_00409DC0`) demands it before anything
 * may claim an attack permit, and in the player it arrives every frame from
 * the walker through `syncPortGlobals`. A fixture has no walker, so it has to
 * say so itself; leaving it at 0 is a scripted cutscene, in which nothing
 * attacks.
 */
const SCENE_MAJOR_PLAYING = 2;

const EYE = vec3(0, 0, 0);

/**
 * `ActorSpawn` narrowed to class 0x30.
 *
 * Narrowing, not a cast, and the same proof the director makes: `makeActor`
 * picks the arm from `cls`, so a fixture that wants to drive class 0x30's
 * states has to establish the class rather than assert it. The `throw` is
 * unreachable, and that is the point — a cast here would be the one place the
 * union could be lied to.
 */
function spawnZombie(at: number, charType: number, name: string,
                     desc?: Partial<Actor>, rng?: Rng): ZombieActor {
  const a = ActorSpawn(at, SpawnClass.Zombie, charType, name, desc, rng);
  if (a.cls !== SpawnClass.Zombie) throw new Error("not class 0x30");
  return a;
}

/**
 * `spawnZombie` with an events bus, for the one `Init` in the game that makes
 * a sound.
 *
 * `EnemyZombieInitByCharType` (`FUN_00452FD0`) starts the looping chainsaw for
 * character types 2 and 3, so `ActorSpawn` carries `events` through to
 * `ClassHandler.init`. Going through `ActorSpawn` rather than calling the
 * weapon-loop functions directly is the point of the fixture: it is the wiring
 * from the spawn opcode down to the sound that was missing, not the arithmetic.
 */
function spawnZombieWithEvents(at: number, charType: number, name: string,
                               events: Events): ZombieActor {
  const a = ActorSpawn(at, SpawnClass.Zombie, charType, name, undefined,
                       new Rng(1), events);
  if (a.cls !== SpawnClass.Zombie) throw new Error("not class 0x30");
  return a;
}

function scene(n: number, rng: Rng): Events {
  ResetGameGlobals();
  SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_player_lives = [PLAYER.start_lives, PLAYER.start_lives];
  // `g_nFiringGate` — `0x009C8E00`. `ResetSceneOnEnter` leaves it **down** and
  // the stage script raises it with `hud_shutter_state` 1 or 6; there is no
  // script in this file, so this line stands in for one. Without it every shot
  // here would be dropped by `ProcessShotRequests`, which is the behaviour the
  // firing-gate section below exists to prove.
  G.g_nFiringGate = 1;
  for (let i = 0; i < n; i++) {
    const a = spawnZombie(0x1000 + i, 1, `zombie ${i}`);
    a.visible = true;
    a.attackState = 1;
    a.hp = 10;
    a.pos = vec3(-20 + i * 20, 0, 45 + i * 10);
    a.motion = 10;
  }
  void rng;
  return new Events();
}

function run(frames: number, rng: Rng, events: Events): void {
  for (let i = 0; i < frames; i++) GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
}

// -- 1. the crowd throttle --------------------------------------------------

console.log("class 0x30, three zombies, ten seconds:");
{
  const rng = new Rng(7);
  const events = scene(3, rng);
  let damaged = 0;
  events.on("player.damaged", () => damaged++);

  let maxPermits = 0;
  let sawBackoff = false;
  let minWalking = Infinity;
  let minAnywhere = Infinity;
  let closestState = "";
  for (let i = 0; i < 600; i++) {
    GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
    maxPermits = Math.max(maxPermits,
      G.g_attack_permits.filter((p) => p !== -1).length);
    for (const o of G.g_object_list) {
      if (o.state === ZombieState.BackOff) sawBackoff = true;
      const d = dist2d(o.pos, EYE);
      if (d < minAnywhere) { minAnywhere = d; closestState = ZombieState[o.state] ?? String(o.state); }
      // Only the lunge may come inside the ring, and only to the attack's own
      // distance; the retreat starts from wherever the swing left it. What
      // must never happen is an *approaching* actor crossing it, which is the
      // rule that keeps a zombie with no attack state out of the camera.
      if (o.state === ZombieState.Approach || o.state === ZombieState.AttackRun) {
        minWalking = Math.min(minWalking, d);
      }
    }
  }

  check("never more than g_max_attackers permits at once",
        maxPermits <= G.g_max_attackers, `saw ${maxPermits}`);
  check("someone reached the player and swung", damaged > 0,
        `${damaged} hits`);
  check("the retreat happened", sawBackoff);
  // Every caller of `ZombieSetMotionIfIdle` passes a random start frame, so
  // two zombies given the same order at the same moment do not take the same
  // steps at the same time. Starting them all at frame zero made a crowd move
  // in lockstep, which a crowd of shambling corpses never does.
  const phases = new Set(G.g_object_list.map((o) => o.playTicks));
  check("and they are not in lockstep", phases.size > 1,
        `${phases.size} distinct motion phases among ${G.g_object_list.length}`);
  check("nothing walked inside the inner ring",
        minWalking >= APPROACH.rings[0].inner - 0.01,
        `closest ${minWalking.toFixed(2)}`);
  // Not the attack's distance: the bite travels, and it has to -- the ground
  // it covers is what the retreat then walks back, which is the pause. What it
  // must not do is overshoot the point its own clip settles at, because that
  // transient is what reaches the camera. `strikeFloor` is that point, and it
  // comes out of the tables rather than a number picked to fit.
  const bite = TYPE.attacks["0"]["1"];
  const biteM = TYPE.motions[String(bite.strike)];
  const biteNet = Math.abs(biteM.root[(biteM.frames - 1) * 3 + 2]
                           - biteM.root[2]);
  check("and nothing came closer than the bite's own settle point",
        minAnywhere >= bite.distance - biteNet - 0.01,
        `closest ${minAnywhere.toFixed(2)} in ${closestState}, floor `
        + `${(bite.distance - biteNet).toFixed(2)}`);
  check("the permit came back", G.g_attack_permits.filter((p) => p !== -1).length
        <= 1);
  check("lives were spent, not overspent",
        G.g_player_lives[0] >= 0 && G.g_player_lives[0] < PLAYER.start_lives,
        `${G.g_player_lives[0]} left`);
}

// -- 2. a class with no handler gets no behaviour ---------------------------

console.log("an unread class:");
{
  const rng = new Rng(7);
  const events = scene(0, rng);
  // The cat. It has no module in `g_class_handlers`, so it must not move.
  const cat = ActorSpawn(0x2000, SpawnClass.SkinnedNpc, 1, "cat");
  cat.visible = true;
  cat.attackState = 1;
  cat.hp = 10;
  cat.pos = vec3(0, 0, 60);
  const start = { ...cat.pos };
  run(600, rng, events);
  check("class 0x53 stayed where the script put it",
        cat.pos.x === start.x && cat.pos.z === start.z);
  check("class 0x53 took no permit", cat.attackPermit === -1);
}

// -- 3. `attack_state` does not gate the swing ------------------------------

console.log("a spawn whose descriptor names no attack state:");
{
  const rng = new Rng(7);
  const events = scene(0, rng);
  // 25 of stage 2's 90 class-0x30 spawns carry `attack_state = -1` and another
  // 7 carry 0. `ZombieStateHoldAtRange` -- which is where an ordinary zombie
  // decides to swing -- never reads that byte; only `ZombieStateApproach`
  // does, and nothing starts there. An earlier port gated the permit on it and
  // those spawns walked up and stood still, which is exactly the bug this
  // asserts against.
  const z = spawnZombie(0x3000, 1, "no-attack-state");
  z.visible = true;
  z.attackState = -1;
  z.hp = 10;
  z.pos = vec3(0, 0, 45);
  z.motion = 10;
  let damaged = 0;
  events.on("player.damaged", () => damaged++);
  run(900, rng, events);
  check("it attacks anyway, because the hub does not read attack_state",
        damaged > 0, `${damaged} hits`);
}

// -- 3a. the queue throttle is a round trip -------------------------------

console.log("the queue throttle:");
{
  const rng = new Rng(9);
  const events = scene(0, rng);
  // One zombie, a long way out. Nothing else competes, so it must simply
  // arrive: the whole point of `ZombieStateWaitTurn` is that dropping out of
  // the distance queue is temporary. Without it the actor parked in
  // `HoldAtRange` for ever and stood still -- which is what shipped.
  const z = spawnZombie(0x4000, 1, "lone");
  z.attackState = 1;
  z.hp = 1000;
  z.pos = vec3(0, 0, 120);
  z.motion = 10;
  check("it starts unranked, which reads as -1 and passes the rank test",
        z.rank === -1, `rank ${z.rank}`);

  // The renderer sets `visible` *after* the game phase, so an actor's first
  // frame always runs before `RankEnemiesByDistance` has ever seen it. That
  // ordering is the whole bug: with the rank read unsigned it looked like
  // "last in the queue" and the actor dropped out of the attack run on frame
  // one, into a state with no way back.
  z.visible = false;
  GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
  z.visible = true;

  let strandedFar = 0;
  let closest = Infinity;
  for (let i = 0; i < 900; i++) {
    GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
    const d = dist2d(z.pos, EYE);
    closest = Math.min(closest, d);
    // Sitting in the hub while nowhere near it is the deadlock's signature.
    if (z.state === ZombieState.HoldAtRange
        && d > APPROACH.rings[0].inner + 1) strandedFar++;
  }
  // The bite is a lunge and a recover -- `char_adv00`'s runs 0 -> -18.1 ->
  // -15.55 -- and the distance it ends up forward is exactly what
  // `ZombieStateBackOff` has to walk back before it may attack again. That
  // walk *is* the pause between bites. With nothing else competing for the
  // permit, the gap between one zombie's strikes is that walk plus the clip;
  // suppress the strike's travel and it ends its swing already on the ring,
  // the retreat finishes on its first frame, and it bites on the spot.
  const gaps: number[] = [];
  let last = -1;
  let inStrike = false;
  // `ActorSetMotionBlended`'s fourth argument is a fade length and every state
  // passes one; without it each transition is a cut.
  const strikeMotion = TYPE.attacks["0"]["1"].strike;
  let fadedOutOfBite = false;
  for (let i = 0; i < 1800; i++) {
    GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
    if (z.fadeFrom?.motion === strikeMotion && z.fade > 0) {
      fadedOutOfBite = true;
    }
    const now = z.state === ZombieState.Strike;
    if (now && !inStrike) {
      if (last >= 0) gaps.push(i - last);
      last = i;
    }
    inStrike = now;
  }
  check("it bites more than once", gaps.length > 0, `${gaps.length + 1} bites`);
  check("and the bite cross-fades into the retreat rather than cutting",
        fadedOutOfBite,
        fadedOutOfBite ? "" : "no fade with the strike as the outgoing clip");
  check("and waits between bites rather than repeating on the spot",
        gaps.length > 0 && Math.min(...gaps) > 60,
        gaps.length ? `shortest gap ${Math.min(...gaps)} frames` : "n/a");

  check("it closes the distance", closest < APPROACH.rings[0].inner,
        `closest ${closest.toFixed(1)} of 120`);
  check("and never idles in the hub while far from it", strandedFar < 60,
        `${strandedFar} frames`);

  // The round trip itself. `ZombieStateAttackRun` parks an actor here when its
  // rank falls outside the allowance, and this is the only thing that puts it
  // back; routing the drop-out anywhere else strands it for ever.
  // Called directly: the director re-ranks every frame, so the only way to
  // hold an actor outside the allowance is to run the state itself.
  z.state = ZombieState.WaitTurn;
  z.sub = 0;
  z.rank = 9;
  z.allowance = 2;
  const before = { ...z.pos };
  for (let i = 0; i < 30; i++) ZombieStateWaitTurn(z, EYE, rng);
  check("an actor out of the queue waits, and does not advance",
        z.state === ZombieState.WaitTurn
        && Math.abs(z.pos.z - before.z) < 0.01, ZombieState[z.state]);
  z.rank = 0;
  ZombieStateWaitTurn(z, EYE, rng);
  check("and rejoins the attack run when the queue moves on",
        z.state === ZombieState.AttackRun, ZombieState[z.state]);
}

// -- 3a'. what the ranking pass is allowed to touch --------------------------

console.log("RankEnemiesByDistance:");
{
  const rng = new Rng(11);
  const events = scene(0, rng);
  void events;
  // Sixteen registrants, two more than the list holds, laid out so that
  // *object order* and *distance order* disagree: the last to spawn is the
  // nearest. The exe caps at registration -- `RegisterForDistanceRank` refuses
  // the fifteenth -- and only then sorts, so the nearest actor here is one of
  // the two that never enters the queue at all.
  const zs: Actor[] = [];
  for (let i = 0; i < RANK_SLOTS + 2; i++) {
    const a = spawnZombie(0x7000 + i, 1, `rank ${i}`);
    a.visible = true;
    a.hp = 10;
    a.pos = vec3(0, 0, 200 - i * 10);
    zs.push(a);
  }
  // A class the ranking pass does not register, with both fields poisoned.
  const other = ActorSpawn(0x7100, SpawnClass.Thrower, 1, "not a zombie");
  other.visible = true;
  other.hp = 10;
  other.pos = vec3(0, 0, 5);
  other.rank = 41;
  other.queueRank = 42;

  RankEnemiesByDistance(EYE);

  check("it ranks exactly what the list holds", zs.filter((a) => a.rank >= 0).length === RANK_SLOTS,
        `${zs.filter((a) => a.rank >= 0).length} ranked`);
  check("the cap is applied in object order, before the sort, so the nearest "
        + "actor past it is not ranked",
        zs[RANK_SLOTS].rank === -1 && zs[RANK_SLOTS + 1].rank === -1,
        `ranks ${zs[RANK_SLOTS].rank}, ${zs[RANK_SLOTS + 1].rank}`);
  // The one that matters: an unranked actor must keep the 0xE the spawn
  // wrote, which fails `queueRank < QUEUE_CAP`. Resetting it to 0 puts every
  // enemy past the fourteenth at the *front* of the queue and takes the crowd
  // throttle off entirely.
  check("and an unranked actor keeps a queue rank that fails the cap",
        zs[RANK_SLOTS].queueRank >= QUEUE_CAP,
        `queueRank ${zs[RANK_SLOTS].queueRank}, cap ${QUEUE_CAP}`);
  check("it writes nothing onto a class that does not register",
        other.rank === 41 && other.queueRank === 42,
        `rank ${other.rank}, queueRank ${other.queueRank}`);
}

// -- 3c. the route ----------------------------------------------------------

console.log("ThrowerStatePathFollow:");
{
  const rng = new Rng(6);
  const events = scene(0, rng);
  // Stage 2 block 3's zsass, 3/3/4, descriptor 0x1EF0, verbatim: wait 30
  // frames, then climb three legs before it fights.
  const z = ActorSpawn(0x1ef0, SpawnClass.Thrower, 1, "zsass", {
    initialState: ThrowerState.PathFollow,
    path: {
      delay: 30,
      points: [
        { step: 1, motion_set: 1, dest: [-741.9, 100.0, -890.7] },
        { step: 1, motion_set: 1, dest: [-741.9, 110.0, -845.7] },
        { step: 1, motion_set: 2, dest: [-737.5, 115.0, -810.0] },
      ],
    },
  });
  z.visible = true;
  z.hp = 10;
  z.pos = vec3(-741.9, 90.0, -930.0);
  z.motion = 10;
  const start = { ...z.pos };

  check("it starts on the route, not standing and throwing",
        z.state === ThrowerState.PathFollow, `state ${z.state}`);
  for (let i = 0; i < 20; i++) GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
  check("it holds still for the descriptor's delay",
        Math.abs(z.pos.z - start.z) < 0.01, `moved ${(z.pos.z - start.z).toFixed(2)}`);

  // The leap at the end lands in front of the camera, so the camera has to be
  // somewhere plausible: in the real scene it is on the street below the roof,
  // not a thousand units away at the origin.
  const roofEye = vec3(-737.5, 100.0, -780.0);
  const roofHost = {
    ...NULL_HOST,
    viewPoint: (x: number, y: number, zz: number, out: Vec3) => {
      out.x = roofEye.x + x;
      out.y = roofEye.y + y;
      out.z = roofEye.z + zz;
    },
  };
  let reachedLast = false;
  for (let i = 0; i < 900; i++) {
    GameUpdate(roofEye, 1 / 60, roofHost, rng, events);
    if (!reachedLast && Math.abs(z.pos.x + 737.5) < 0.2
        && Math.abs(z.pos.z + 810.0) < 0.2
        && Math.abs(z.pos.y - 115.0) < 0.2) reachedLast = true;
  }
  check("it walks the route to the last waypoint", reachedLast,
        `(${z.pos.x.toFixed(1)}, ${z.pos.y.toFixed(1)}, ${z.pos.z.toFixed(1)})`);
  // `ThrowerStateLeapDown`: off the roof and into shot, at a place picked on
  // the *screen* rather than on the map -- 15.5 in front, 9.4 below.
  // The depth is exact -- 15.5 is a literal in `ThrowerPickLandingPoint`. The
  // drop is not asserted to the unit because it divides by
  // `g_projection_distance_px`, which is derived from the projection rather
  // than read out of the binary; what matters is that it comes *down* and
  // lands in front.
  check("then it comes down off the roof, in front of the camera",
        Math.abs(z.pos.z - (roofEye.z - 15.5)) < 0.5
        && z.pos.y < 115 - 5 && z.pos.y < roofEye.y,
        `(${z.pos.x.toFixed(1)}, ${z.pos.y.toFixed(1)}, ${z.pos.z.toFixed(1)})`);
  // ...and the pounce hands to the leap aside, not to the hub: state 9 always
  // ends in state 10. Standing again is two states further on.
  check("and only then goes for the player",
        z.state === ThrowerState.LeapAside
        || z.state === ThrowerState.StandAndDecide, `state ${z.state}`);
}

// -- 3c2. the entrance that arrives on a clip -----------------------------

console.log("the cue entrance:");
{
  const rng = new Rng(11);
  const events = scene(0, rng);
  // The six shipped state-21 records, to the bit: pose frozen, shot-immune,
  // 0x2000 set, and an exit to the attack run. **All three bits are cleared
  // by this state and by nothing else in the game**, so a port that routed
  // state 21 to `AttackRun` -- as the default arm of `mapStartState` did --
  // left the actor frozen for ever. It wanted a permit, it was inside the
  // outer ring, and it never moved, because a zombie is carried by its clip's
  // own root translation and a frozen clip has no delta.
  const z = spawnZombie(0x5100, 1, "van", {
    initialState: ZombieState.MotionCue,
    attackState: ZombieState.AttackRun,
    intro: { motion: 923, delay: 10 },
    flags: ActorFlag.PoseFrozen | ActorFlag.ShotImmune | ActorFlag.NoHitReaction,
  }, rng);
  z.visible = true;
  z.hp = 1000;
  z.pos = vec3(0, 0, 60);
  const startZ = z.pos.z;

  check("it starts in the cue state, not the attack run",
        z.state === ZombieState.MotionCue, `state ${z.state}`);

  // The delay: the clip is set on the first frame but the pose is held, so
  // nothing plays and nothing moves.
  run(9, rng, events);
  check("it holds still for the record's delay",
        (z.flags & ActorFlag.PoseFrozen) !== 0 && z.pos.z === startZ
        && z.playTicks === 0,
        `flags 0x${z.flags.toString(16)} z ${z.pos.z} ticks ${z.playTicks}`);

  run(1, rng, events);
  check("and the delay running out is what releases it",
        (z.flags & ActorFlag.PoseFrozen) === 0);

  // Now the clip plays, and its root translation is the entrance.
  // 45 frames of the play clock is 22 authored frames of a 41-frame clip:
  // half the jump, and past the 0x26 the shot-immunity window ends on.
  run(45, rng, events);
  check("then the clip carries it out", z.pos.z < startZ - 4,
        `moved ${(startZ - z.pos.z).toFixed(1)}`);
  check("and it is shootable once it is through the glass",
        (z.flags & ActorFlag.ShotImmune) === 0,
        `flags 0x${z.flags.toString(16)}`);
  check("but it has not handed over part-way",
        z.state === ZombieState.MotionCue, `state ${z.state}`);

  // 79 is the play length, not the 41 authored frames: reading the exit cue
  // in authored frames would hand over at halfway, part-way through the jump.
  run(60, rng, events);
  check("it hands over at the end of the play clock, not the frame count",
        z.state !== ZombieState.MotionCue, `state ${z.state}`);
  check("...to the state the record names", z.state === ZombieState.AttackRun
        || z.state === ZombieState.HoldAtRange || z.state === ZombieState.Strike,
        `state ${z.state}`);
  check("and nothing of the record's freeze is left on it",
        (z.flags & (ActorFlag.PoseFrozen | ActorFlag.ShotImmune
                    | ActorFlag.NoHitReaction)) === 0,
        `flags 0x${z.flags.toString(16)}`);
}

// -- 3d. the on-screen gate -------------------------------------------------

console.log("ActorIsOnScreen:");
{
  const rng = new Rng(2);
  const events = scene(0, rng);
  const z = spawnZombie(0x5000, 1, "offscreen");
  z.visible = true;
  z.attackState = 1;
  z.hp = 1000;
  z.pos = vec3(0, 0, 40);
  z.motion = 10;
  z.lookAt = vec3(0, 4, 40);

  // `TryClaimAttackSlot` calls `ActorIsOnScreen` (`FUN_00409C10`) -- but **not
  // to refuse the claim**. An off-screen enemy gets the permit and raises
  // `g_attack_committed`, and that latch is what stops a second one. Reading
  // it as a refusal is what left an enemy the camera had walked into standing
  // there for ever: no permit, so no attack, so never the state that retreats.
  const offscreen = {
    ...NULL_HOST,
    viewSpaceOf: (_at: number, out: Vec3) => {
      // Forty units in front — `-z` — and far off the right of a 640 frame.
      out.x = 900; out.y = 0; out.z = -40;
      return true;
    },
  };
  for (let i = 0; i < 600 && z.attackPermit < 0; i++) {
    GameUpdate(EYE, 1 / 60, offscreen, rng, events);
  }
  check("an enemy off the side of the frame still takes a permit",
        z.attackPermit >= 0, `permit ${z.attackPermit}`);
  check("...and latches g_attack_committed while it holds it",
        G.g_attack_committed === 1
        && (z.flags2 & ZombieFlag2.OffScreenPermit) !== 0,
        `latch ${G.g_attack_committed} flags2 ${z.flags2.toString(16)}`);

  // The latch is the throttle: while one enemy is attacking unseen, nobody
  // else may claim at all — not even one in plain sight.
  const other = spawnZombie(0x5004, 1, "second");
  other.visible = true;
  other.hp = 1000;
  other.pos = vec3(5, 0, 40);
  other.lookAt = vec3(5, 4, 40);
  const onscreen = {
    ...NULL_HOST,
    viewSpaceOf: (_at: number, out: Vec3) => {
      out.x = 0; out.y = 0; out.z = -40;     // dead centre, forty in front
      return true;
    },
  };
  check("a second enemy cannot claim while the latch is up",
        !TryClaimAttackSlot(other, onscreen), `permit ${other.attackPermit}`);

  // Releasing the off-screen permit lifts it, and only then.
  ReleaseAttackSlot(z);
  check("releasing it lifts the latch", G.g_attack_committed === 0
        && (z.flags2 & ZombieFlag2.OffScreenPermit) === 0);
  check("and the next enemy may claim", TryClaimAttackSlot(other, onscreen),
        `permit ${other.attackPermit}`);
  ReleaseAttackSlot(other);

  // **Dying holds the latch if the release is only half done.** The engine
  // frees it from the death state — `ZombieStateDeath6` (`FUN_00454D20`) sub 1
  // runs `ZombieReleasePermitAndUntrack` (`FUN_004565A0`), whose first line is
  // `ReleaseAttackSlot`. The port now runs that state, and `GameUpdate`'s
  // dead-actor sweep is the backstop behind it; clearing `g_attack_permits`
  // without lifting `g_attack_committed` left every remaining enemy refused on
  // `TryClaimAttackSlot`'s first line, and a crowd walked to the ring and
  // stood there wanting a permit nobody held.
  check("an off-screen attacker takes the latch again",
        TryClaimAttackSlot(z, offscreen) && G.g_attack_committed === 1,
        `latch ${G.g_attack_committed}`);
  z.dead = true;
  GameUpdate(EYE, 1 / 60, offscreen, rng, events);
  check("...and dying gives back the whole permit, latch included",
        G.g_attack_committed === 0 && z.attackPermit === -1
        && G.g_attack_permits.every((p) => p === -1),
        `latch ${G.g_attack_committed} permits ${JSON.stringify(G.g_attack_permits)}`);
  check("so the enemies still standing can attack",
        TryClaimAttackSlot(other, onscreen), `permit ${other.attackPermit}`);
  ReleaseAttackSlot(other);
}

  // -- 4. damage ---------------------------------------------------------------

console.log("ResolveHit:");
{
  const rng = new Rng(5);
  scene(1, rng);
  const z = G.g_object_list[0];
  z.hp = 100;
  // Bone 4's effect table: four escalating stages, the fourth severing.
  const out1 = ResolveHit(z, 4, 0, NULL_HOST, rng);
  check("a hit takes hit points off", z.hp === 100 - 3, `hp ${z.hp}`);
  check("and swaps the bone's model", z.boneSlot["4"] === 0x11,
        JSON.stringify(z.boneSlot));
  check("and stumbles", out1.react !== undefined);
  ResolveHit(z, 4, 0, NULL_HOST, rng);
  ResolveHit(z, 4, 0, NULL_HOST, rng);
  const out4 = ResolveHit(z, 4, 0, NULL_HOST, rng);
  check("the fourth hit severs", out4.severed && out4.result === 3);
  check("and takes the forearm with it -- the whole subtree, not just the arm",
        z.removed.includes(5), `removed ${JSON.stringify(z.removed)}`);
  check("the destroyed-zone mask is set", (z.zones & 2) === 2, `${z.zones}`);
  const before = z.zones;
  ResolveHit(z, 4, 0, NULL_HOST, rng);
  check("a fifth hit on a severed limb does not sever again",
        z.zones === before && z.removed.filter((b) => b === 5).length === 1);

  z.hp = 1;
  const kill = ResolveHit(z, 1, 0, NULL_HOST, rng);
  check("zero hit points kills, once", kill.killed && z.dead);
  // **The clip is not `ResolveHit`'s.** Class 0x30 runs its own death states
  // now, so it is in `updatesWhenDead` and the shared directional clip is
  // withheld exactly as it is from class 0x31 and class 0x10:
  // `ChooseDeathMotion` (`FUN_004560B0`) picks it, from `ZombieStateDeath6`
  // sub 0. What `ResolveHit` leaves instead is the hit record `ZombieOnShot`
  // (`FUN_00453EB0`) reads on the actor's next update.
  check("no shared death clip: class 0x30 has its own state machine",
        z.death === null, `death ${JSON.stringify(z.death)}`);
  check("...and the hit its death chain reads is left on the actor",
        z.pendingHit !== null, `${JSON.stringify(z.pendingHit)}`);
  const again = ResolveHit(z, 1, 0, NULL_HOST, rng);
  check("a hit on a corpse scores nothing", !again.killed
        && again.result === 0);
}

// -- 4a. the three bits `ResolveHit` reads on `obj+0x34` ---------------------

/**
 * `ResolveHit` (`FUN_00409430`) raises `obj+0x34 |= 0xE00` whenever
 * `g_app_state` is not `AppState.InPlay`, and the three bits it raises have
 * three readers inside the same routine and `ActorSwapDamagedPart`.
 *
 * The port ignored all three, and sat at `g_app_state = 0` with a comment
 * calling the clause inert. Transcribing the OR against that would have set
 * `0xE00` on every actor on its first hit and taken the gore out of the whole
 * game -- which is why the value matters as much as the bits do.
 */
console.log("\nResolveHit's three suppression bits:");
{
  const rng = new Rng(5);

  // `NoDismember` is the one that fires in ordinary play: 68 shipped
  // class-0x30 spawns carry 0x400 in `init_flags`, and `ActorInitFlags`
  // (`FUN_00408970`) makes that `obj+0x34` before the class's `Init` runs.
  scene(1, rng);
  const nd = G.g_object_list[0];
  nd.hp = 100;
  nd.flags |= ActorFlag.NoDismember;
  ResolveHit(nd, 4, 0, NULL_HOST, rng);
  ResolveHit(nd, 4, 0, NULL_HOST, rng);
  ResolveHit(nd, 4, 0, NULL_HOST, rng);
  const sev = ResolveHit(nd, 4, 0, NULL_HOST, rng);
  check("`NoDismember`: the sever step does not sever",
        !sev.severed && sev.result !== 3, `result ${sev.result}`);
  check("...and the forearm stays on", !nd.removed.includes(5),
        `removed ${JSON.stringify(nd.removed)}`);
  check("...but every hit still charged its damage", nd.hp < 100,
        `hp ${nd.hp}`);
  nd.hp = 1;
  const ndKill = ResolveHit(nd, 1, 0, NULL_HOST, rng);
  check("...and the torso death wound is skipped too", !ndKill.severed,
        `result ${ndKill.result}`);
  check("...while the actor still dies, because the kill block is outside "
        + "the guard", ndKill.killed && nd.dead, `killed ${ndKill.killed}`);

  // `NoPartSwap` stops `ActorSwapDamagedPart` before it touches anything.
  scene(1, rng);
  const np = G.g_object_list[0];
  np.hp = 100;
  np.flags |= ActorFlag.NoPartSwap;
  const npOut = ResolveHit(np, 4, 0, NULL_HOST, rng);
  check("`NoPartSwap`: the bone keeps the model it had",
        np.boneSlot["4"] === undefined, JSON.stringify(np.boneSlot));
  check("...and nothing reports gore", !npOut.gore);
  check("...and the damage still lands", np.hp === 100 - 3, `hp ${np.hp}`);

  // `NoHitResult` is written over the finished result, so the swap it just
  // made stands and only the reported code is thrown away.
  scene(1, rng);
  const nr = G.g_object_list[0];
  nr.hp = 100;
  nr.flags |= ActorFlag.NoHitResult;
  const nrOut = ResolveHit(nr, 4, 0, NULL_HOST, rng);
  check("`NoHitResult`: the shot reports nothing", nrOut.result === 0
        && G.g_hit_result === 0, `result ${nrOut.result}`);
  check("...and the swap it made before that still stands",
        nr.boneSlot["4"] === 0x11, JSON.stringify(nr.boneSlot));

  // And the OR itself, which is what puts all three there.
  scene(1, rng);
  const att = G.g_object_list[0];
  att.hp = 100;
  const clean = att.flags;
  ResolveHit(att, 4, 0, NULL_HOST, rng);
  check("in play the OR does not fire",
        (att.flags & 0xe00) === (clean & 0xe00), `flags ${att.flags.toString(16)}`);
  G.g_app_state = AppState.Attract;
  ResolveHit(att, 4, 0, NULL_HOST, rng);
  check("out of play it raises all three at once",
        (att.flags & 0xe00) === 0xe00, `flags ${att.flags.toString(16)}`);
  check("...and that hit reported nothing", G.g_hit_result === 0,
        `${G.g_hit_result}`);
  G.g_app_state = AppState.InPlay;

  // The second read: the head only comes off in play.
  check("`g_app_state` is back in play for everything after this",
        G.g_app_state === 6, `${G.g_app_state}`);
}

// -- 4b. the camera never cuts on its own -----------------------------------

/**
 * The aim eases onto whatever `SelectCameraLookAtTarget` picks, and picking
 * "the path's own target" is not a special case.
 *
 * This is the assertion the stage-2 block-17 report needed. The camera sits at
 * the end of a shot with two enemies alive, aimed off the rail at them; you
 * kill the last one; the port used to hand the raw path target straight to the
 * renderer on that frame, which turned a sixteen-degree correction into one
 * frame of camera. `CameraTrackEnemiesTick` has no such branch — with nothing
 * registered it eases at the flat rate 12, about a thirteenth of the remaining
 * angle a frame.
 */
console.log("the camera eases back onto the rail, it does not cut:");
{
  const rng = new Rng(5);
  const events = scene(1, rng);
  const z = G.g_object_list[0];
  // Off to one side and low, the way the pair in stage 2 block 17 sit.
  z.pos = vec3(-20, 0, 60);
  z.lookAt = vec3(-20, 12, 60);

  // The rail: eye at the origin looking straight down +Z, which is the shot's
  // own aim once the `cam_play` action has retired.
  const rail = vec3(0, 0, 100);
  CamAdvancePathFrame(EYE, rail);
  CamSetPathTarget(rail);

  const aimAngle = (): number => {
    const t = G.g_camera_block_target;
    const a = Math.hypot(t.x - EYE.x, t.y - EYE.y, t.z - EYE.z) || 1;
    const b = Math.hypot(rail.x - EYE.x, rail.y - EYE.y, rail.z - EYE.z) || 1;
    const dot = ((t.x - EYE.x) * (rail.x - EYE.x)
               + (t.y - EYE.y) * (rail.y - EYE.y)
               + (t.z - EYE.z) * (rail.z - EYE.z)) / (a * b);
    return Math.acos(Math.min(1, Math.max(-1, dot))) * 180 / Math.PI;
  };

  // Let the enemy pull the aim off the rail. The block is not re-seated,
  // because the shot's action has retired -- that is the whole point.
  let pulled = 0;
  for (let i = 0; i < 240; i++) {
    CamSetPathTarget(rail);
    GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
    pulled = aimAngle();
  }
  check("an enemy pulls the aim off the rail", pulled > 3,
        `${pulled.toFixed(1)} deg off`);
  check("and the camera is marked as tracking", G.g_camera_is_tracking === 1);

  // Now kill it. Nothing is registered from the next frame on.
  z.dead = true;
  let worst = 0;
  let settled = -1;
  for (let i = 0; i < 300; i++) {
    const before = aimAngle();
    CamSetPathTarget(rail);
    GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
    const after = aimAngle();
    worst = Math.max(worst, Math.abs(before - after));
    if (settled < 0 && after < 0.5) settled = i;
  }
  check("with nothing registered the camera stops tracking",
        G.g_camera_is_tracking === 0);
  check("the aim comes back to the rail", settled >= 0,
        `still ${aimAngle().toFixed(2)} deg off after 300 frames`);
  // 1/13 of a gap that starts near 16 degrees is about 1.3 degrees; a snap
  // would show the whole gap in one step.
  check("and never moves more than two degrees in a frame", worst < 2,
        `worst frame moved ${worst.toFixed(2)} deg`);
  check("it takes tens of frames, not one", settled > 20,
        `settled after ${settled} frames`);
  check("`g_camera_settled` is raised once it has caught up",
        G.g_camera_settled === 1);
}

// -- 5. the snapshot round-trips, exactly -----------------------------------

console.log("save state:");
{
  // **The whole data segment, not a sample of it.**
  //
  // This used to fingerprint nine actor fields and six globals, which is a
  // reasonable guess at what matters and therefore cannot catch what does not
  // occur to you. `G` *is* the save state -- `GameSystem.save()` hands the
  // world exactly this object -- so comparing anything less than all of it
  // asserts something weaker than the contract. The staleness of `lookAt`, for
  // one, was invisible to the old digest.
  const digest = (): string => JSON.stringify(G);

  const rng = new Rng(11);
  const events = scene(3, rng);
  run(300, rng, events);

  // The snapshot is exactly what `GameSystem.save()` hands the world.
  const snap = structuredClone({ globals: G, rng: rng.state });
  const json = JSON.stringify(snap);
  check("the whole game state is JSON", json.length > 0
        && !json.includes("undefined"));

  run(300, rng, events);
  const after = digest();

  // Put it back and run the same 300 frames again.
  Object.assign(G, structuredClone(snap.globals));
  rng.state = snap.rng;
  run(300, rng, events);
  check("a restored snapshot replays identically", digest() === after);

  // And again from the JSON, which is the form the button hands out.
  const reread = JSON.parse(json) as typeof snap;
  Object.assign(G, reread.globals);
  rng.state = reread.rng;
  run(300, rng, events);
  check("and identically after a round trip through JSON",
        digest() === after);

  // **Saving and loading every fifty frames must change nothing at all.**
  //
  // One save and one load can round-trip cleanly and still lose something that
  // only matters a few frames later -- a field restored but never read again,
  // a derived value the load happens to leave correct because the very next
  // tick recomputes it. Doing it repeatedly, across a fight, is what turns a
  // "restores" assertion into a "the snapshot fully determines the future"
  // one, which is the claim the architecture doc actually makes.
  {
    const rngA = new Rng(11);
    const eventsA = scene(3, rngA);
    run(600, rngA, eventsA);
    const straight = digest();

    const rngB = new Rng(11);
    const eventsB = scene(3, rngB);
    for (let i = 0; i < 12; i++) {
      run(50, rngB, eventsB);
      const s2 = JSON.parse(
        JSON.stringify({ globals: G, rng: rngB.state })) as
          { globals: Record<string, unknown>; rng: number };
      Object.assign(G, s2.globals);
      rngB.state = s2.rng;
    }
    check("600 frames with a save and load every 50 is 600 plain frames",
          digest() === straight,
          firstFieldThatDiffers(straight, digest()));
  }
}

/** Which key of `G` two whole-segment digests part company on. */
function firstFieldThatDiffers(a: string, b: string): string {
  const ga = JSON.parse(a) as Record<string, unknown>;
  const gb = JSON.parse(b) as Record<string, unknown>;
  for (const k of Object.keys(ga)) {
    if (JSON.stringify(ga[k]) !== JSON.stringify(gb[k])) return `at G.${k}`;
  }
  return "identical by key, different as a string";
}

// -- 6. determinism, which is what guards the rules above -------------------

console.log("determinism:");
{
  const one = (): string => {
    const rng = new Rng(3);
    const events = scene(4, rng);
    run(400, rng, events);
    return JSON.stringify(G.g_object_list.map((o) => [o.state, o.pos.x, o.pos.z]));
  };
  check("two runs from the same seed agree", one() === one());
  // `WaitTurn` belongs to the loop too: it is where an actor outside the
  // allowance marks time, and it has a way back into the attack run.
  const IN_LOOP = new Set([ZombieState.AttackRun, ZombieState.HoldAtRange,
                           ZombieState.Strike, ZombieState.BackOff,
                           ZombieState.WaitTurn]);
  check("every actor is in the loop, none stuck outside it",
        G.g_object_list.every((o) => IN_LOOP.has(o.state) || o.dead),
        G.g_object_list.map((o) => ZombieState[o.state] ?? o.state).join(","));
}


// -- 8. class 0x41, the breakable-prop / item-container placer --------------
//
// Two groups' worth of members, shaped like the real ones: a two-high stack
// whose top member is held up by the bottom one, and a three-member item set.
// The hull is a single point under the origin, which is enough to make
// `BreakablePropGroundContact` fire the moment a faller drops below the floor.

const BREAKABLES: BreakablesJson = {
  groups: [
    // group 0: a stack. Member 1 stands on member 0.
    [
      { index: 0, x: 0, z: 0, item_set: 0, story_item: -1, level: 0,
        y_offset: 0, supports: [] },
      { index: 1, x: 0, z: 0, item_set: 0, story_item: -1, level: 1,
        y_offset: 7.540296, supports: [0] },
    ],
    // group 1: three props sharing item set 2, all on the ground.
    [
      { index: 0, x: 10, z: 0, item_set: 2, story_item: -1, level: 0,
        y_offset: 0, supports: [] },
      { index: 1, x: 20, z: 0, item_set: 2, story_item: -1, level: 0,
        y_offset: 0, supports: [] },
      { index: 2, x: 30, z: 0, item_set: 2, story_item: -1, level: 0,
        y_offset: 0, supports: [] },
    ],
    // group 2: one prop hiding the extra life.
    [
      { index: 0, x: 40, z: 0, item_set: 1, story_item: -1, level: 0,
        y_offset: 0, supports: [] },
    ],
  ],
  // Four corners of a box. A single point is not enough: the settle picks the
  // *lowest corner that is not the current one*, so a one-point hull can never
  // re-seat and the object sinks to wherever the fall left it.
  hull: [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]],
  falling_hull: [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]],
  // Synthetic, except for kinds 2 and 3: those two carry `g_prop_kind_params`'
  // own rows, because `PropUpdateType43` branches on the effect id and stage
  // 3's seven spawns are all one or the other. Kind 3's effect is **0**, which
  // is what sends it down the crack arm, and kind 2's is 7, which sends it
  // straight to the destroy arm -- a fixture that made every effect non-zero
  // could not tell those two paths apart.
  kinds: Array.from({ length: 11 }, (_, k) => (
    k === 2 ? { kind: 2, effect: 7, effect_variant: 469, sound: 0x1d16a9,
                radius: 6, y_offset: 6 }
      : k === 3 ? { kind: 3, effect: 0, effect_variant: 473, sound: 0x1a16a9,
                    radius: 5, y_offset: 5 }
        : { kind: k, effect: k, effect_variant: 400 + k, sound: 0x1a16a9,
            radius: 6, y_offset: 6 })),
  placements: [
    { at: 0xa100, container: "group", group: 1, lifetime_evt_steps: 4 },
    { at: 0xa200, container: "group", group: 2, lifetime_evt_steps: 6 },
    // Class 0x44 selector 0. Shaped like stage 1's `0x1580`: effect 2,
    // captured at bone 2, on motion 471.
    { at: 0xa300, container: "script_flag_effect", effect: 2,
      capture_bone: 2, motion: 471, slot: 0x13f5, lifetime_evt_steps: 0,
      pos: [-13.7748, 0, -362.302], yaw: 0 },
    // Class 0x41 type 75, shaped like the game's only one: stage 4 block 2's
    // spawn at script address 9580, whose `+0x11C` is 2 and therefore both a
    // two-step lifetime and asset slot 2.
    { at: 0xa400, container: "generic", type: 75, slot: 2,
      lifetime_evt_steps: 2, pos: [121.8, -57, -818.6],
      pitch: 0, yaw: 0, roll: 0 },
  ],
  // One effect, shaped like the real thing but four keys long: a root that
  // draws nothing, a bone-1 node that draws nothing, and the bone-2 node that
  // carries the model. `play_length` is `2n - 2`, the rule `mot.md` states.
  effects: {
    "2": {
      nodes: [
        { slot: 0, bone: 0, children: [1, 2] },
        { slot: 0, bone: 1, children: [] },
        { slot: 0x13f5, bone: 2, children: [] },
      ],
      interp: 1,
      motion: 471,
      play_length: 6,
      frames: 4,
      bones: 2,
      // Bone 1 stands still; bone 2 walks 10 units along x per key and turns
      // a quarter turn per key, so a blend is visible in both channels.
      t: [
        13, 0, -361, -13, 0, -362,
        13, 0, -361, -3, 0, -362,
        13, 0, -361, 7, 0, -362,
        13, 0, -361, 17, 0, -362,
      ],
      r: [
        0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0x4000, 0,
        0, 0, 0, 0, 0x8000, 0,
        0, 0, 0, 0, 0xc000, 0,
      ],
      cues: [1, 3],
    },
  },
  level_height: 7.540296,
};

/**
 * A scene for the container tests.
 *
 * The mode defaults to **Original** because that is the one in which an
 * ordinary breakable is an ordinary breakable. In **Training**,
 * `PlaceBreakableGroup` turns the members named by `g_training_lesson` into
 * one-shot targets that pay no score, and every group has at least one of
 * them — so "a prop takes two shots" is a statement about Original Mode and
 * always was. Training's rule gets its own case below.
 *
 * It said *Arcade* here while `GameMode.ARCADE` was 2, which is Training's
 * number; the case below passed for the right reason under the wrong name.
 */
function propScene(rng: Rng, mode: GameMode = GameMode.Original): Events {
  ResetGameGlobals();
  SetGameTables(CHARS, BREAKABLES);
  G.g_player_lives = [PLAYER.start_lives, PLAYER.start_lives];
  G.g_camera_fixed_eye_y = 0;
  G.g_GameMode = mode;
  void rng;
  return new Events();
}

/** Shoot a prop `n` times, running its update after each. */
function shoot(p: { id: number }, n: number, rng: Rng, events: Events): void {
  for (let i = 0; i < n; i++) {
    const live = G.g_breakable_props.find((q) => q.id === p.id);
    if (!live) return;
    BreakablePropTakeShot(live, 0);
    BreakablePropUpdate(live, rng, events);
  }
}

console.log("\nclass 0x41, the placer:");
{
  const rng = new Rng(11);
  propScene(rng);
  const placer = ActorSpawn(0x9000, SpawnClass.PropContainerPlacer, 4, "placer");
  placer.visible = true;
  placer.hp = 1;          // +0x11C: the group id
  placer.charType = 4;    // +0x1F4: the lifetime in evt blocks
  placer.condition = 0;   // +0x130C: constructor 0, PlaceBreakableGroup

  PropContainerPlacerUpdate(placer, {
    eye: EYE, dt: 1 / 60, rng, host: NULL_HOST,
  });

  check("the placer builds its group", G.g_breakable_props.length === 3,
        `${G.g_breakable_props.length} props`);
  check("the placer kills itself on its first frame", placer.dead);
  check("every prop is registered in g_breakable_members",
        G.g_breakable_props.every(
          (p) => G.g_breakable_members[p.group * MEMBERS_PER_GROUP + p.member]
                 === p.id));
  check("the item countdown is seeded inside [1, n]",
        G.g_item_set_countdown[ItemSet.Score2] >= 1
        && G.g_item_set_countdown[ItemSet.Score2] <= 3,
        String(G.g_item_set_countdown[ItemSet.Score2]));
  check("a prop takes two shots and carries the group's lifetime",
        G.g_breakable_props.every((p) => p.hp === 2 && p.lifetime === 4));
}

console.log("\nclass 0x41, breaking a prop:");
{
  const rng = new Rng(11);
  const events = propScene(rng);
  const props = PlaceBreakableGroup(1, 4, rng);
  let cracked = 0, broken = 0;
  events.on("prop.cracked", () => cracked++);
  events.on("prop.broken", () => broken++);

  const before = G.g_player_score[0];
  shoot(props[0], 1, rng, events);
  check("the first shot cracks rather than breaks",
        cracked === 1 && broken === 0);
  check("the cracked prop swaps to the broken model",
        G.g_breakable_props[0].slot === BreakableSlot.Broken);
  check("cracking a prop is worth no score at all",
        G.g_player_score[0] === before, `${G.g_player_score[0]} vs ${before}`);
  check("but it still counts as a hit", G.g_player_hit_count[0] === 1);

  shoot(props[0], 1, rng, events);
  check("the second shot breaks it", broken === 1);
  check("breaking it is worth ten", G.g_player_score[0] === before + 10,
        String(G.g_player_score[0]));
  check("a broken prop leaves its member slot",
        G.g_breakable_members[1 * MEMBERS_PER_GROUP + 0] === 0);
}

console.log("\nclass 0x41, the item comes out on a random break:");
{
  // The countdown decides *which* break pays out, and it is drawn from the
  // rng -- so over many seeds the release must land on every one of the three
  // props, and never on a fourth break that does not exist.
  const landed = new Set<number>();
  for (let seed = 1; seed <= 40; seed++) {
    const rng = new Rng(seed);
    const events = propScene(rng);
    let releases = 0;
    let onBreak = -1;
    events.on("item.released", () => { releases++; onBreak = breaks; });
    const props = PlaceBreakableGroup(1, 4, rng);
    let breaks = 0;
    for (const p of props) {
      shoot(p, 2, rng, events);
      breaks++;
    }
    check(`seed ${seed}: exactly one item comes out of the set`,
          releases === 1, `${releases} releases`);
    landed.add(onBreak);
  }
  check("over 40 seeds the release lands on more than one break",
        landed.size > 1, `landed on breaks {${[...landed].sort().join(",")}}`);
}

console.log("\nclass 0x41, the stack collapses:");
{
  const rng = new Rng(5);
  const events = propScene(rng);
  const props = PlaceBreakableGroup(0, 4, rng);
  const bottom = props[0], top = props[1];
  check("the top of the stack starts a level up",
        Math.abs(top.y - (bottom.y + 7.540296)) < 1e-6,
        `${top.y} vs ${bottom.y}`);
  check("the top starts standing", top.state === BreakableState.Standing);

  shoot(bottom, 2, rng, events);
  // The bottom is gone; the top should notice on its next update and fall.
  BreakablePropUpdate(top, rng, events);
  check("the top falls once its support is destroyed",
        top.state === BreakableState.Falling, BreakableState[top.state]);

  for (let i = 0; i < 600 && top.state === BreakableState.Falling; i++) {
    BreakablePropUpdate(top, rng, events);
  }
  check("and it comes to rest rather than falling for ever",
        top.state === BreakableState.Settled, BreakableState[top.state]);
  check("it rests at or above the floor",
        top.y >= G.g_camera_fixed_eye_y - 0.1 - 1e-3, String(top.y));
}

console.log("\nclass 0x41, a prop's lifetime is in evt blocks:");
{
  const rng = new Rng(9);
  const events = propScene(rng);
  const props = PlaceBreakableGroup(1, 2, rng);
  const p = props[0];
  // Frames alone must never expire it: the engine counts block advances.
  for (let i = 0; i < 1000; i++) BreakablePropUpdate(p, rng, events);
  check("a thousand frames do not expire a prop", !p.dead);
  for (let b = 1; b <= 3; b++) {
    G.g_evt_step_index = b;
    BreakablePropUpdate(p, rng, events);
  }
  check("but three block advances past a lifetime of two do", p.dead);
}

console.log("\nclass 0x41, the extra life:");
{
  const rng = new Rng(13);
  const events = propScene(rng);
  let released = -1;
  events.on("item.released", (e) => { released = e.set; });
  const props = PlaceBreakableGroup(2, 4, rng);
  shoot(props[0], 2, rng, events);
  check("the lone item-set-1 prop releases the extra life",
        released === ItemSet.ExtraLife, String(released));

  G.g_player_lives[0] = 2;
  check("GrantExtraLife adds a life", GrantExtraLife(0) && G.g_player_lives[0] === 3);
  G.g_player_lives[0] = 5;
  const score = G.g_player_score[0];
  check("and pays 300 instead when the player is at the cap",
        !GrantExtraLife(0) && G.g_player_lives[0] === 5
        && G.g_player_score[0] === score + 300);
}

console.log("\nclass 0x41, the script spawns reach the pool:");
{
  const rng = new Rng(31);
  const events = propScene(rng);
  // What the walker's live spawn list looks like: a placer the bundle has a
  // placement for, one it does not, and an unrelated class.
  const spawns = [
    { at: 0xa100, class: SpawnClass.PropContainerPlacer },
    { at: 0xbeef, class: SpawnClass.PropContainerPlacer },   // no placement
    { at: 0xc000, class: SpawnClass.Zombie },
  ];
  SpawnPropContainers(spawns);
  const placers = G.g_object_list.filter(
    (o) => o.cls === SpawnClass.PropContainerPlacer);
  check("only the placer with a placement is spawned",
        placers.length === 1 && placers[0].at === 0xa100,
        `${placers.length} placers`);
  check("it carries the group in +0x11C and the lifetime in +0x1F4",
        placers[0].hp === 1 && placers[0].charType === 4);

  // The placer builds its group on its first update and then kills itself.
  GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
  check("one frame places the group", G.g_breakable_props.length === 3,
        `${G.g_breakable_props.length} props`);
  check("and the placer is gone", placers[0].dead);

  // Running again must not place it twice -- the bridge is called every frame.
  SpawnPropContainers(spawns);
  GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
  check("a second pass does not place the group again",
        G.g_breakable_props.length === 3,
        `${G.g_breakable_props.length} props`);
}

console.log("\nclass 0x41 type 4, the kinded props:");
{
  const rng = new Rng(41);
  const events = propScene(rng);
  let broken = 0, cracked = 0, released = -1;
  events.on("prop.broken", () => broken++);
  events.on("prop.cracked", () => cracked++);
  events.on("item.released", (e) => { released = e.set; });

  // Kind 2 wears 0x17A9 and dies to one shot; kind 3 wears the group props'
  // crate and takes two. Both are in item set 2, size 2.
  const a = PlaceKindedProp(0xd000, 2, ItemSet.Score2, 2, 5,
                            10, 0, 0, 0x4000, rng);
  const b = PlaceKindedProp(0xd001, 3, ItemSet.Score2, 2, 5,
                            20, 0, 0, 0, rng);
  G.g_breakable_props.push(a, b);
  check("a kinded prop takes the slot its kind names",
        a.slot === KIND_SLOT[2] && b.slot === KIND_SLOT[3],
        `${a.slot.toString(16)} / ${b.slot.toString(16)}`);
  check("and is its own family", a.family === PropFamily.Kinded);
  check("the countdown is seeded inside [1, set size]",
        G.g_item_set_countdown[ItemSet.Score2] >= 1
        && G.g_item_set_countdown[ItemSet.Score2] <= 2);

  // The crate kind survives its first shot; every other kind does not.
  BreakablePropTakeShot(b, 0);
  KindedPropUpdate(b, rng, events);
  check("the crate kind survives one shot and hides its model",
        cracked === 1 && broken === 0 && b.slot === SLOT_NONE,
        `slot ${b.slot.toString(16)}`);

  const before = G.g_player_score[0];
  BreakablePropTakeShot(a, 0);
  KindedPropUpdate(a, rng, events);
  check("a non-crate kind dies to one shot", broken === 1);
  check("and that shot is worth ten", G.g_player_score[0] === before + 10,
        `${G.g_player_score[0]} vs ${before}`);

  // The break effect holds the prop for its animation, then it goes.
  for (let i = 0; i < 200 && !a.dead; i++) KindedPropUpdate(a, rng, events);
  check("the destroyed prop leaves once its effect has run", a.dead);
  void released;
}

console.log("\nclass 0x41 type 4, the whole set pays out exactly once:");
{
  for (let seed = 1; seed <= 20; seed++) {
    const rng = new Rng(seed);
    const events = propScene(rng);
    let releases = 0;
    events.on("item.released", () => releases++);
    // Four props sharing set 5, declared size 4 -- the shape stage 2 uses.
    const props = [0, 1, 2, 3].map((i) =>
      PlaceKindedProp(0xe000 + i, 2, ItemSet.Score5, 4, 5,
                      i * 10, 0, 0, 0, rng));
    G.g_breakable_props.push(...props);
    for (const p of props) {
      BreakablePropTakeShot(p, 0);
      KindedPropUpdate(p, rng, events);
    }
    check(`seed ${seed}: exactly one item from the set of four`,
          releases === 1, `${releases} releases`);
  }
}

console.log("\nclass 0x44 selector 16, the falling container:");
{
  const rng = new Rng(77);
  const events = propScene(rng);
  let cracked = 0, broken = 0, settled = 0, released = -1;
  events.on("prop.cracked", () => cracked++);
  events.on("prop.broken", () => broken++);
  events.on("prop.settled", () => settled++);
  events.on("item.released", (e) => { released = e.set; });

  const c = PlaceFallingContainer(0xf000, 1, ItemSet.ExtraLife, -1, 1, 6,
                                  0, 20, 0, 0, rng);
  G.g_breakable_props.push(c);
  check("it starts whole, two shots, on its own floor",
        c.slot === FALLING_SLOT_WHOLE && c.hp === 2
        && Math.abs(c.floorY - (20 - 7.35)) < 1e-6,
        `floor ${c.floorY}`);

  const before = G.g_player_score[0];
  BreakablePropTakeShot(c, 0);
  FallingContainerUpdate(c, rng, events);
  check("the first shot knocks it loose rather than breaking it",
        cracked === 1 && broken === 0 && c.hp === 1
        && c.slot === FALLING_SLOT_LOOSE);
  check("it pays nothing for that", G.g_player_score[0] === before);
  check("and it is thrown upward", c.vy > 0, String(c.vy));
  check("it is falling", c.state === BreakableState.Falling);

  for (let i = 0; i < 600 && c.state === BreakableState.Falling; i++) {
    FallingContainerUpdate(c, rng, events);
  }
  check("it comes to rest rather than falling for ever",
        c.state === BreakableState.Settled, BreakableState[c.state]);
  // Settling is what re-seats the origin: the contact frame only records the
  // corner, and the frames after it put the container back on that corner.
  for (let i = 0; i < 120; i++) FallingContainerUpdate(c, rng, events);
  // It comes to rest *on a corner*, so the origin sits above the floor by
  // however far that corner is from it -- what must not happen is the origin
  // sinking through, or the container settling onto the camera's ground plane
  // instead of its own.
  check("it settles on its own floor rather than through it or the camera's",
        c.y >= c.floorY - 1e-3 && c.y - c.floorY < 3
        && c.floorY > G.g_camera_fixed_eye_y,
        `y ${c.y.toFixed(3)} floor ${c.floorY.toFixed(3)} ` +
        `camera ${G.g_camera_fixed_eye_y}`);
  check("landing was announced", settled === 1);

  BreakablePropTakeShot(c, 0);
  FallingContainerUpdate(c, rng, events);
  check("the second shot destroys it", broken === 1 && c.dead);
  check("it pays ten", G.g_player_score[0] === before + 10);
  check("and the extra life comes out", released === ItemSet.ExtraLife,
        String(released));
}

console.log("\nall three families share one item-set countdown:");
{
  const rng = new Rng(5);
  const events = propScene(rng);
  let releases = 0;
  events.on("item.released", () => releases++);
  // One group prop and two kinded props, all in set 2. The group placer
  // seeds the countdown, then each kinded placement re-seeds it -- which is
  // the engine's own behaviour and why the classes cannot be ported apart.
  PlaceBreakableGroup(1, 4, rng);
  const k = [0, 1].map((i) =>
    PlaceKindedProp(0xf100 + i, 2, ItemSet.Score2, 2, 5, 50 + i * 10, 0, 0,
                    0, rng));
  G.g_breakable_props.push(...k);
  check("the countdown is one global, not one per class",
        G.g_item_set_countdown[ItemSet.Score2] >= 1
        && G.g_item_set_countdown[ItemSet.Score2] <= 2,
        String(G.g_item_set_countdown[ItemSet.Score2]));

  // Break everything in set 2 across both classes; exactly one item drops.
  for (const p of [...G.g_breakable_props]) {
    if (p.itemSet !== ItemSet.Score2) continue;
    for (let n = 0; n < 3 && !p.dead; n++) {
      BreakablePropTakeShot(p, 0);
      if (p.family === PropFamily.Kinded) KindedPropUpdate(p, rng, events);
      else BreakablePropUpdate(p, rng, events);
    }
  }
  check("breaking the set across two classes pays out once",
        releases === 1, `${releases} releases`);
}

console.log("\nclass 0x41, the generic props:");
{
  const rng = new Rng(3);
  propScene(rng);
  // What the exporter emits for one: the type, the asset slot from `+0x11C`,
  // and three real angles.
  const p = PlaceGenericProp({
    at: 0xa900, container: "generic", type: 12, slot: 0x173d,
    lifetime_evt_steps: 0, pos: [5, 6, 7], pitch: 0x100, yaw: 0x2000,
    roll: 0x300,
  }, rng);
  check("a generic prop draws the slot from +0x11C, not hit points",
        p.slot === 0x173d, p.slot.toString(16));
  check("it is placed where the script put it",
        p.x === 5 && p.y === 6 && p.z === 7);
  check("all three orientation words are angles for this family",
        p.pitch === 0x100 && p.yaw === 0x2000 && p.roll === 0x300);
  check("and it is the drawn-only family",
        p.family === PropFamily.Generic);

  // The arms of the switch that override what the prologue took.
  const door = PlaceGenericProp({
    at: 0xa901, container: "generic", type: 6, slot: 0x1234,
    lifetime_evt_steps: 0, pos: [0, 0, 0],
  }, rng);
  check("a type whose arm overrides the slot uses the arm's",
        door.slot === 0x1032 && door.hp === 1, door.slot.toString(16));
}

console.log("\nclass 0x41's three draw-only types:");
{
  // ---- type 54: the drift is authored, and it is the only exit ----------
  const rng = new Rng(54);
  propScene(rng);
  const p = PlaceGenericProp({
    at: 0xb000, container: "generic", type: 54, slot: 0x18a1,
    lifetime_evt_steps: 0x18a1, field_1f4: 5, pos: [583, -67, -7773.4],
  }, rng);
  G.g_breakable_props.push(p);
  check("a type-54 prop is its own family, not the inert Generic arm",
        p.family === PropFamily.DrawOnlyType54, `${PropFamily[p.family]}`);
  check("...and PlaceGenericProp case 0x36 seeds all five drift rates",
        p.vx === 5 && p.vy === 1.5 && p.vz === -4
        && p.spin === 0x300 && p.yawSpin === -0x400,
        `${p.vx}/${p.vy}/${p.vz} ${p.spin}/${p.yawSpin}`);
  // Flag 12 down: it stands exactly where the script put it, for ever. There
  // is no lifetime prologue on this routine at all.
  G.g_script_flags[SCRIPT_FLAG_TYPE54_DRIFT] = 0;
  for (let i = 0; i < 400; i += 1) BreakablePropPoolUpdate(rng);
  check("with g_script_flags[12] down it does not move and does not retire",
        G.g_breakable_props.length === 1 && p.x === 583 && p.storyItem === 0,
        `${G.g_breakable_props.length} @ ${p.x} f${p.storyItem}`);
  // Raised: five units of X a frame, and dead on the frame after 300.
  G.g_script_flags[SCRIPT_FLAG_TYPE54_DRIFT] = 1;
  BreakablePropPoolUpdate(rng);
  check("...raised, it drifts five units of X and one frame",
        p.x === 588 && p.storyItem === 1 && p.spin === 0x300
        && p.pitch === 0x300, `${p.x} f${p.storyItem} p${p.pitch}`);
  // `CMP EAX,0x12C` is on the count BEFORE the increment, so the frames that
  // read 0..300 all draw -- 301 of them -- and the 302nd is the one that dies.
  for (let i = 0; i < TYPE54_DRIFT_FRAMES; i += 1) {
    BreakablePropPoolUpdate(rng);
  }
  check("...and it is still alive after 301 frames of drift",
        G.g_breakable_props.length === 1 && p.storyItem === 301,
        `${G.g_breakable_props.length} f${p.storyItem}`);
  BreakablePropPoolUpdate(rng);
  check("...and dies on the 302nd, because the compare is pre-increment",
        G.g_breakable_props.length === 0, `${G.g_breakable_props.length}`);
}

{
  // ---- type 31: an effect strip that wraps, and a camera cue ------------
  const rng = new Rng(31);
  propScene(rng);
  // Stage 3's three, whose roll word 9 is a ten-frame strip of eff_taki.bin.
  const p = PlaceGenericProp({
    at: 0xb100, container: "generic", type: 31, slot: 0x0d01,
    lifetime_evt_steps: 0x0d01, field_1f4: 4,
    pos: [-1139, -12.9, -3962.5], pitch: 0, yaw: -0x2edc, roll: 9,
  }, rng);
  G.g_breakable_props.push(p);
  check("a type-31 prop takes its strip length from the roll word",
        p.removeFlag === 9 && p.slot === 0x0d01 && p.storyItem === 0,
        `len ${p.removeFlag} slot ${p.slot.toString(16)}`);
  check("...and the same word is still its roll, because both are the engine's",
        p.roll === 9);
  check("...with its lifetime from desc+0x24 and not from its own slot",
        p.lifetime === 4, `${p.lifetime}`);
  BreakablePropPoolUpdate(rng);
  check("...it steps one frame of the strip a tick", p.storyItem === 1,
        `${p.storyItem}`);
  for (let i = 0; i < 8; i += 1) BreakablePropPoolUpdate(rng);
  check("...and shows the last frame of a ten-frame loop, which is 9",
        p.storyItem === 9, `${p.storyItem}`);
  BreakablePropPoolUpdate(rng);
  // The reset is in the same frame as the increment, so 10 is never held: a
  // roll word of 9 is ten frames, 0..9, and `slot + 10` is never asked for.
  check("...then back to 0 -- the cursor never reaches the strip length",
        p.storyItem === 0, `${p.storyItem}`);
  // The camera cue: exact path AND exact frame, or nothing happens.
  G.g_active_cam_path = TYPE31_DESPAWN_CAM_PATH;
  G.g_cam_path_frame = TYPE31_DESPAWN_CAM_FRAME - 1;
  BreakablePropPoolUpdate(rng);
  check("its camera cue is an equality: one frame early removes nothing",
        G.g_breakable_props.length === 1, `${G.g_breakable_props.length}`);
  G.g_cam_path_frame = TYPE31_DESPAWN_CAM_FRAME;
  BreakablePropPoolUpdate(rng);
  check("...and on the frame itself it goes",
        G.g_breakable_props.length === 0, `${G.g_breakable_props.length}`);
}

{
  // ---- type 53: its own inline lifetime, with no scene-1 sweep ----------
  const rng = new Rng(53);
  propScene(rng);
  const p = PlaceGenericProp({
    at: 0xb200, container: "generic", type: 53, slot: 0x002b,
    lifetime_evt_steps: 0x002b, field_1f4: 6,
    pos: [626.9, -71.1, -6422.6], yaw: -0x5555,
  }, rng);
  G.g_breakable_props.push(p);
  check("a type-53 prop is its own family and its lifetime is desc+0x24",
        p.family === PropFamily.DrawOnlyType53 && p.lifetime === 6,
        `${PropFamily[p.family]} ${p.lifetime}`);
  // Six step changes are survivable; the seventh is not.
  for (let i = 1; i <= 6; i += 1) {
    G.g_evt_step_index = i;
    BreakablePropPoolUpdate(rng);
  }
  check("...it survives exactly as many step changes as its lifetime",
        G.g_breakable_props.length === 1 && p.stepsElapsed === 6,
        `${G.g_breakable_props.length} after ${p.stepsElapsed}`);
  G.g_evt_step_index = 7;
  BreakablePropPoolUpdate(rng);
  check("...and dies on the one after", G.g_breakable_props.length === 0,
        `${G.g_breakable_props.length}`);
}

{
  // The sweep the shared prologue has and this routine does not. Scene 1 with
  // flag 0x77 raised clears every prop that runs `PropExpireByStepLifetime`;
  // a type-53 prop is not one of them, and folding it into the shared arm
  // because its two shipped spawns are in scene 4 is the mistake `L27` names.
  const rng = new Rng(153);
  propScene(rng);
  G.g_scene_index = 1;
  const p = PlaceGenericProp({
    at: 0xb300, container: "generic", type: 53, slot: 0x002b,
    lifetime_evt_steps: 0x002b, field_1f4: 6, pos: [0, 0, 0],
  }, rng);
  const q = PlaceGenericProp({
    at: 0xb301, container: "generic", type: 5, slot: 0x0fd2,
    lifetime_evt_steps: 6, pos: [0, 0, 0],
  }, rng);
  G.g_breakable_props.push(p, q);
  G.g_script_flags[0x77] = 1;
  BreakablePropPoolUpdate(rng);
  check("the scene-1 sweep clears a prologue prop and leaves a type-53 alone",
        G.g_breakable_props.length === 1
        && G.g_breakable_props[0].family === PropFamily.DrawOnlyType53,
        `${G.g_breakable_props.map((r) => PropFamily[r.family]).join()}`);
}

console.log("\nclass 0x41 type 43, stage 3's seven shootable props:");
{
  const rng = new Rng(43);
  const events = propScene(rng);
  // Stage 3's kind-3 crate at evt 0x6900: the descriptor's THIRD orientation
  // word is the kind, its `+0x11C` is a lifetime, and its pitch and roll are
  // thrown away by the arm.
  const crate = PlaceGenericProp({
    at: 0xc000, container: "generic", type: 43, slot: 2,
    lifetime_evt_steps: 2, field_1f4: 1, pos: [10, 20, 30],
    pitch: 0x111, yaw: 0x4000, roll: 3,
  }, rng);
  G.g_breakable_props.push(crate);
  check("a type-43 prop takes its kind from the third orientation word",
        crate.kind === 3 && crate.family === PropFamily.Type43,
        `kind ${crate.kind} ${PropFamily[crate.family]}`);
  check("...its item set from desc+0x24, not from the byte above it",
        crate.group === Type43ItemSet.ExtraLife, `${crate.group}`);
  check("...the kind table's radius, effect and variant",
        crate.hitRadius === 5 && crate.effect === 0
        && crate.effectVariant === 473,
        `r${crate.hitRadius} e${crate.effect} v${crate.effectVariant}`);
  check("...kind 3 wears the ordinary breakable model",
        crate.slot === BreakableSlot.Default, crate.slot.toString(16));
  check("...and the arm throws the descriptor's pitch and roll away",
        crate.pitch === 0 && crate.roll === 0 && crate.yaw === 0x4000,
        `${crate.pitch}/${crate.yaw}/${crate.roll}`);
  check("...with a radius, which is what makes it shootable at all",
        crate.hitRadius > 0);

  // It registers a shot sphere every frame, at the kind's own rise.
  BreakablePropPoolUpdate(rng, events);
  check("...and it publishes that sphere each frame",
        crate.shotRegistered, `${crate.shotRegistered}`);

  // The first shot cracks it: no points, the model swaps, and it turns to
  // face the camera. `KindedPropUpdate` hides the model instead.
  G.g_camera_yaw_bams = 0x2000;
  const score = G.g_player_score[0];
  crate.flags |= BreakableFlag.Hit | BreakableFlag.HitByPlayer0;
  BreakablePropPoolUpdate(rng, events);
  check("one shot cracks a kind 3 and pays nothing",
        crate.slot === BreakableSlot.Broken
        && G.g_player_score[0] === score,
        `${crate.slot.toString(16)} +${G.g_player_score[0] - score}`);
  check("...turning the broken model to face the camera",
        crate.yaw === 0x2000, crate.yaw.toString(16));
  check("...and it is still alive and still shootable",
        !crate.dead && crate.effectFrames === 0);

  // The second shot destroys it: ten points, the puff starts, and because it
  // is holding a life it stays standing for a third.
  crate.flags |= BreakableFlag.Hit | BreakableFlag.HitByPlayer0;
  BreakablePropPoolUpdate(rng, events);
  check("the second shot destroys it, for ten",
        crate.effectFrames >= 1 && G.g_player_score[0] - score === 10,
        `f${crate.effectFrames} +${G.g_player_score[0] - score}`);
  check("...and a wreck that was holding something is not taken away",
        !crate.dead, `${crate.dead}`);
  for (let i = 0; i < 0x50; i += 1) BreakablePropPoolUpdate(rng, events);
  check("...even after its puff has run out",
        !crate.dead, `${crate.dead}`);

  // The third shot is the one that pays out.
  const lives = G.g_player_lives[0];
  crate.flags |= BreakableFlag.Hit | BreakableFlag.HitByPlayer0;
  BreakablePropPoolUpdate(rng, events);
  check("a shot into the wreckage hands over the life",
        G.g_player_lives[0] === lives + 1 && crate.branchLatched,
        `${lives} -> ${G.g_player_lives[0]}`);
  check("...and the wreck wears the pickup's own model",
        crate.slot === TYPE43_PICKUP_SLOT, crate.slot.toString(16));
  crate.flags |= BreakableFlag.Hit | BreakableFlag.HitByPlayer0;
  BreakablePropPoolUpdate(rng, events);
  check("...once, and not again",
        G.g_player_lives[0] === lives + 1, `${G.g_player_lives[0]}`);
}

{
  // A kind 2 has an effect id, so the first shot goes straight to the destroy
  // arm: one shot, ten points, and no crate model at any point.
  const rng = new Rng(143);
  const events = propScene(rng);
  const piece = PlaceGenericProp({
    at: 0xc100, container: "generic", type: 43, slot: 2,
    lifetime_evt_steps: 2, field_1f4: 0, pos: [0, 0, 0], roll: 2,
  }, rng);
  G.g_breakable_props.push(piece);
  check("a kind 2 carries no body model and an effect id",
        piece.slot === SLOT_NONE && piece.effect === 7,
        `${piece.slot.toString(16)} e${piece.effect}`);
  check("...and the kind table's own radius and rise, not the switch's",
        piece.hitRadius === 6, `${piece.hitRadius}`);
  const score = G.g_player_score[0];
  piece.flags |= BreakableFlag.Hit | BreakableFlag.HitByPlayer0;
  BreakablePropPoolUpdate(rng, events);
  check("...and one shot destroys it, for ten",
        piece.effectFrames >= 1 && G.g_player_score[0] - score === 10,
        `f${piece.effectFrames} +${G.g_player_score[0] - score}`);
  // Item set 0: this one IS taken away when the puff ends.
  for (let i = 0; i < 0x50; i += 1) BreakablePropPoolUpdate(rng, events);
  check("...and a wreck hiding nothing goes when its puff ends",
        !G.g_breakable_props.includes(piece),
        `${G.g_breakable_props.length} left`);
}

{
  // The bob and the tumble. Both are seeded at placement and both move every
  // frame; the bob is measured against `restY`, which the sine never touches.
  const rng = new Rng(243);
  const events = propScene(rng);
  const p = PlaceGenericProp({
    at: 0xc200, container: "generic", type: 43, slot: 1,
    lifetime_evt_steps: 1, field_1f4: 0, pos: [0, 50, 0], roll: 3,
  }, rng);
  G.g_breakable_props.push(p);
  check("its bob keeps the descriptor's Y as the centre it swings about",
        p.restY === 50, `${p.restY}`);
  check("...with an amplitude and two spin rates drawn at placement",
        p.shake >= 0.25 && p.shake < 0.25 + 0.51
        && p.spin !== 0 && p.rollSpin !== 0,
        `a${p.shake} ${p.spin}/${p.rollSpin}`);
  const pitch0 = p.pitch, roll0 = p.roll;
  BreakablePropPoolUpdate(rng, events);
  // The sine takes the phase BEFORE the step, and the phase starts at 0, so
  // the first frame draws exactly at the centre. The tumble has no such
  // delay: its rates are seeded non-zero and applied at once.
  check("...the first frame leaves the bob at its centre, sine of nothing",
        p.y === p.restY && p.pitch !== pitch0 && p.roll !== roll0,
        `${p.y} ${pitch0}->${p.pitch} ${roll0}->${p.roll}`);
  BreakablePropPoolUpdate(rng, events);
  check("...and the second frame has moved it off the centre",
        p.y !== p.restY, `${p.y - p.restY}`);
  // The spring pulls the rate toward the angle's opposite, so over a long run
  // the angle stays bounded rather than winding up.
  let worst = 0;
  for (let i = 0; i < 600; i += 1) {
    BreakablePropPoolUpdate(rng, events);
    worst = Math.max(worst, Math.abs(p.pitch), Math.abs(p.roll));
  }
  // A band and not just an upper bound: the divisor IS the stiffness, so the
  // worst excursion over a fixed seed pins it. 48 gives 915 BAMS -- five
  // degrees -- where 12 gives 336 and 192 gives 1742, so a wrong divisor
  // fails this whichever way it is wrong. An `< 0x8000` bound passed all of
  // them and asserted nothing about the spring at all.
  check("...and the tumble is a damped spring of the stiffness the shift says",
        worst > 700 && worst < 1100, `${worst}`);
  check("...and the bob stays within its amplitude of the centre",
        Math.abs(p.y - p.restY) <= p.shake + 1e-6,
        `${p.y - p.restY} vs ${p.shake}`);
}

console.log("\nclass 0x41's pose orders come from the routines:");
{
  // The table the renderer reads. `tools/verify_prop_pose.py` is what says
  // the values match the EXE; this is what says the port's own three types
  // are in it and that the set the fix was about did not drift.
  check("type 51 is the only descriptor-slot type that composes Ry.Rz.Rx",
        GENERIC_POSE_ORDER[51] === PoseOrder.YawRollPitch
        && [5, 12, 31, 33, 53, 54].every(
          (ty) => GENERIC_POSE_ORDER[ty] === PoseOrder.RollYawPitch),
        `${[5, 12, 31, 33, 51, 53, 54].map((ty) => GENERIC_POSE_ORDER[ty])
          .join()}`);
  check("the descriptor-slot set is the seven types that draw obj+0x28C",
        [5, 12, 31, 33, 51, 53, 54].every(
          (ty) => GENERIC_DESCRIPTOR_SLOT.has(ty))
        && GENERIC_DESCRIPTOR_SLOT.size === 7,
        `${[...GENERIC_DESCRIPTOR_SLOT].join()}`);
  check("and the two strip types are the two whose roll is a count",
        GENERIC_SLOT_STRIP.has(31) && GENERIC_SLOT_STRIP.has(33)
        && GENERIC_SLOT_STRIP.size === 2, `${[...GENERIC_SLOT_STRIP].join()}`);
  // Fourteen routines pass `obj+0x28C` to their first draw and only seven of
  // them are descriptor-slot types. These four are the ones that look like
  // they belong and do not, so a well-meaning addition trips here as well as
  // in `tools/verify_prop_pose.py`:
  //
  // * 43 -- its arm computes the field (`0x19E8` or `0xFFFF`) rather than
  //   leaving the prologue's, and it ages `obj+0x11C` as a lifetime. All seven
  //   of its stage-3 spawns carry 1, 2 or 3 there.
  // * 70 and 71 -- `OriginalItemPropUpdate` ages `obj+0x11C` too, so the word
  //   is a lifetime and the model comes from `g_original_item_records`.
  // * 72 -- every code clause passes and the data one does not: its one
  //   shipped spawn carries `+0x11C == 1`, so the engine hands
  //   `AssetDrawSlot` a 1. `[open]`, and out until it is settled.
  check("the four types that draw obj+0x28C and are not descriptor slots",
        [43, 70, 71, 72].every((ty) => !GENERIC_DESCRIPTOR_SLOT.has(ty)),
        `${[43, 70, 71, 72].filter((ty) => GENERIC_DESCRIPTOR_SLOT.has(ty))}`);
}

console.log("\nclass 0x41 type 34 is a falling container:");
{
  const rng = new Rng(9);
  const events = propScene(rng);
  // The generic constructor's case 0x22 builds the same object class 0x44
  // selector 16 does -- so the type-34 spawns in stages 1, 3, 4 and 5 are
  // item containers, and they were absent entirely.
  const before = G.g_item_set_countdown[ItemSet.Score2] ?? 0;
  const c = PlaceFallingContainer(0xf200, 0, ItemSet.Score2, -1, 1, 4,
                                  0, 20, 0, 0, rng);
  G.g_breakable_props.push(c);
  check("it seeds an item countdown, which is why it could not be skipped",
        G.g_item_set_countdown[ItemSet.Score2] === 1
        && before !== G.g_item_set_countdown[ItemSet.Score2]);
  check("and it is the same two-shot falling object",
        c.family === PropFamily.Falling && c.hp === 2
        && c.slot === FALLING_SLOT_WHOLE);
  void events;
}

// -- 9. class 0x25, the scripted humanoid VM -------------------------------

function humanoidScene(cmds: HumanoidProgram["cmds"],
                       over: Partial<HumanoidProgram> = {}):
    { a: HumanoidActor; events: Events } {
  ResetGameGlobals();
  const prog: HumanoidProgram = {
    charType: 1, removePath: 90, removeFrame: 900, flags2: 0,
    motion: 10, phase: 0, cmds, ...over,
  };
  SetGameTables(CHARS, undefined, undefined, { "12288": prog });
  G.g_active_cam_path = -1;
  G.g_cam_path_frame = 0;
  const a = ActorSpawn(0x3000, SpawnClass.ScriptedHumanoid, 1, "humanoid");
  // Narrowing, not a cast. `ActorSpawn` returns the union, and class 0x25's
  // routines take the arm -- so the test has to prove the actor is a humanoid
  // the same way the director does. Before the union this fixture handed an
  // un-narrowed actor straight into `ScriptedHumanoidUpdate`.
  if (a.cls !== SpawnClass.ScriptedHumanoid) throw new Error("not class 0x25");
  a.visible = true;
  a.pos = vec3(0, 0, 0);
  return { a, events: new Events() };
}

const hFrame = (a: HumanoidActor, events: Events, rng: Rng) =>
  ScriptedHumanoidUpdate(a, { eye: EYE, dt: 1 / 60, rng, host: NULL_HOST,
                              events });

/**
 * **The union's whole point, checked by the compiler.**
 *
 * These do not run. `@ts-expect-error` fails `tsc` if the line it guards
 * *compiles*, so each one asserts that a misread is rejected — which is the
 * only way to test a type. Before the class-0x25 and class-0x30 arms existed,
 * every line below compiled happily and read a word belonging to another
 * class.
 *
 * This is the honest version of what the review predicted. It expected F6 —
 * `RankEnemiesByDistance` writing zombie fields onto every class — to become a
 * type error here. It cannot: `FUN_004090B0` writes `obj+0x131D`/`+0x131E`
 * unconditionally on every ranked entry, with the `charType == 0xB` test
 * gating only the reads that follow, so those two bytes are genuinely
 * class-agnostic and belong in the head. What the union does catch is the
 * cross-class *tail* read, and that is what these pin.
 */
function unionRejectsCrossClassReads(a: Actor, h: HumanoidActor,
                                     t: ThrowerActor,
                                     z: ZombieActor): void {
  // @ts-expect-error a bare `Actor` has no arm until `cls` is narrowed
  void a.hum;
  // @ts-expect-error and it has no class-0x30 arm either
  void a.zom;
  // @ts-expect-error class 0x25's hand-prop selector is not on the head
  void a.bonePropMode;
  // @ts-expect-error nor is its command cursor
  void a.pc;
  // @ts-expect-error class 0x24's state selector is not on the head either
  void a.selector;
  // @ts-expect-error ...and a humanoid cannot read it: `obj+0x130C` is three
  // fields at one address — this arm, `condition`, and class 0x10's tail
  // pointer — and now two of the three are separated.
  void h.selector;
  // @ts-expect-error ...and neither is class 0x31's arm
  void a.thr;
  // @ts-expect-error `obj+0x1350` as the surface under a thrower's landing
  void a.landSurface;
  // @ts-expect-error `obj+0x1354` as the axis its knockback arc falls along
  void a.arcKind;
  // The two words 0x25 and 0x31 share are the ones worth pinning both ways:
  // `obj+0x1394` is a command cursor to one class and a waypoint cursor to the
  // other, and `obj+0x1330` a hand-prop selector against a path delay.
  // @ts-expect-error a humanoid has no waypoint cursor
  void h.pathLeg;
  // @ts-expect-error and a thrower has no command cursor
  void t.pc;
  // @ts-expect-error nor the hand-prop selector that shares its path delay
  void t.bonePropMode;
  // The class-0x30 tail, one address at a time. Each of these was a field on
  // `ActorBase` before this change, readable off a civilian or a set-piece.
  // (`a.holdFrames` still compiles: that name is class 0x24's `obj+0x1320`
  //  and stays in the head. Class 0x30's hold, `obj+0x1330`, is on the arm.)
  // @ts-expect-error `obj+0x1330` — the stand-and-throw idle countdown
  void a.throwDelay;
  // @ts-expect-error `obj+0x1330` — the corpse countdown
  void a.corpseTimer;
  // @ts-expect-error `obj+0x1334` — the back-off counter
  void a.backoffFrames;
  // @ts-expect-error `obj+0x1338` — frames since the last shove
  void a.shoveTimer;
  // @ts-expect-error `obj+0x1368` bit 0, which class 0x31 reads as `reactBone`
  void a.hasCooldown;
  // @ts-expect-error `obj+0x1398` — the captor script cursor
  void a.scriptPc;
  // @ts-expect-error ...and which of the two blobs it is walking
  void a.scriptBlob;
  // @ts-expect-error `obj+0x1320` — the clip the captor script wants
  void a.scriptMotion;
  // @ts-expect-error `obj+0x1350`, which class 0x31 reads as `landSurface`
  void a.targetLoops;
  // @ts-expect-error `obj+0x1354`, which class 0x31 reads as `arcKind`
  void a.targetCue;
  // @ts-expect-error `obj+0x1358`, which this class also reads as `allowance`
  void a.resumeSub;
  // @ts-expect-error `obj+0x132C`, which class 0x25 reads as `hum.turnMode`
  void a.delegate;
  // @ts-expect-error `obj+0x1370` — how close the walk has to get
  void a.targetArrive;
  // @ts-expect-error `obj+0x1374` — how far it has come
  void a.walkTravelled;
  // @ts-expect-error `obj+0x135C`, which class 0x25 reads as `hum.pathSlot`
  void a.throwHand;
  // ...and the other way round: the zombie arm does not carry class 0x25's.
  // @ts-expect-error class 0x25's command cursor is not on a zombie
  void z.hum;
  // @ts-expect-error nor is its hand-prop cel index, `obj+0x1334`
  void z.bonePropFrame;
  // `obj+0x1334` as class 0x30's back-off counter is now behind its own arm,
  // so a humanoid can no longer be asked for it. This line used to be a plain
  // `void h.backoffFrames` with a comment saying why it could not be a
  // directive: class 0x30 had no arm, the field was on the head, and every
  // class could see it. Class 0x30's arm is what made it one.
  // @ts-expect-error class 0x30's back-off counter is not on the head either
  void h.backoffFrames;
  // **And here is what four arms still do not protect.**
  //
  // `void h.slideTimer` below still compiles, and class 0x24 and class 0x30
  // *both* growing an arm did not fix it — which is the point. `obj+0x1330` is
  // class 0x24's slide countdown, class 0x31's pin/entrance countdown, class
  // 0x30's hold, and the shared arc record's elapsed-frame word, all at one
  // address. Class 0x30's three readings moved onto `zom` (`holdFrames`,
  // `throwDelay`, `corpseTimer` — three names on that one word, **on one
  // arm**, which the union does not separate and does not pretend to).
  // `slideTimer` stayed on the head because class 0x31 still reads it there:
  // 22 sites in `class31/` against class 0x24's 5.
  //
  // And the head aliases *itself* at that address — `slideTimer` and
  // `arcFrames` are both `obj+0x1330` — because `arcFrames`/`arcTotal` belong
  // to **no** class: `class30/entrance.ts` and `class30/knockback.ts` drive
  // them through `class31/arc.ts`, which is why that module still takes a bare
  // `Actor`. No `cls` discriminant can separate a word from itself.
  //
  // So the honest rule, with every arm in: a word separates when every class
  // sharing it has an arm **and** no class-agnostic routine drives it — and
  // intra-class aliasing, and intra-*head* aliasing, are untouched by any of
  // this. A `@ts-expect-error` on the line below is an unused directive today
  // and fails the build, which is why it is not written as one.
  void h.slideTimer;
  // The arm is reachable once, and only once, `cls` has been tested.
  if (a.cls === SpawnClass.ScriptedHumanoid) void a.hum.bonePropMode;
  if (a.cls === SpawnClass.Thrower) void a.thr.landSurface;
  if (a.cls === SpawnClass.Zombie) void a.zom.backoffFrames;
  // And an already-narrowed arm needs no test at all.
  void z.zom.corpseTimer;
  void t.thr.landSurface;
}
void unionRejectsCrossClassReads;

console.log("\na one-shot clip holds its last frame; a loop wraps:");

{
  // The death clip is the one with no terminator: it is meant to hold until
  // `FUN_00456740` takes the body, which is unread. So if the conversion
  // wraps, a killed zombie plays its death animation and then plays it again,
  // for ever -- which is exactly what it did. `Math.min(frames - 1, ...)`
  // around `authoredFrameOfTicks` cannot fix that, because the modulo is
  // *inside* and hands the clamp a small number every lap.
  const fps = 30, frames = 20;
  const lastTick = ticksOfAuthoredFrame(frames - 1, fps);   // 38 at 30 Hz
  check("both agree while the clip is still running",
        authoredFrameHeld(lastTick, fps, frames)
        === authoredFrameOfTicks(lastTick, fps, frames),
        `${authoredFrameHeld(lastTick, fps, frames)}`);
  check("the held clip stops on its last frame",
        authoredFrameHeld(lastTick + 2, fps, frames) === frames - 1
        && authoredFrameHeld(lastTick + 200, fps, frames) === frames - 1,
        `${authoredFrameHeld(lastTick + 200, fps, frames)}`);
  check("...where the wrapping one has gone back to the start",
        authoredFrameOfTicks(lastTick + 2, fps, frames) === 0,
        `${authoredFrameOfTicks(lastTick + 2, fps, frames)}`);
  check("and a looping clip still wraps, which is what it is for",
        authoredFrameOfTicks(lastTick + 4, fps, frames) === 1,
        `${authoredFrameOfTicks(lastTick + 4, fps, frames)}`);
  check("a zero-length clip is frame 0 either way",
        authoredFrameHeld(99, fps, 0) === 0
        && authoredFrameOfTicks(99, fps, 0) === 0);
}

console.log("\nclass 0x25, the VM runs until a command blocks:");
{
  const rng = new Rng(4);
  // Three setup commands and then a wait: all three should take effect on the
  // first frame, because only a wait costs one.
  const { a, events } = humanoidScene([
    { op: HumanoidOp.SetPos, mode: 0, a: 0, b: 0, f0: 5, f1: 7 },
    { op: HumanoidOp.SetBonePropMode, mode: 2, a: 0, b: 0 },
    { op: HumanoidOp.TurnMode, mode: 1, a: 0, b: 0 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 30, b: 0 },
    { op: HumanoidOp.Kill, mode: 0, a: 0, b: 0 },
  ]);
  hFrame(a, events, rng);
  check("a run of setup commands all take effect in one frame",
        a.pos.x === 5 && a.pos.z === 7 && a.hum.bonePropMode === 2
        && a.hum.turnMode === HumanoidTurn.FaceCamera && a.hum.pc === 3,
        `pc ${a.hum.pc}`);

  // The wait costs frames, and exactly the number it asks for.
  for (let i = 0; i < 29; i++) hFrame(a, events, rng);
  check("the wait holds the cursor while it counts", a.hum.pc === 3 && !a.dead,
        `pc ${a.hum.pc} hold ${a.hum.stallFrames}`);
  hFrame(a, events, rng);
  check("and releases on the frame it names, running on to the kill",
        a.dead, `pc ${a.hum.pc} hold ${a.hum.stallFrames}`);
}

console.log("\nclass 0x25, the camera conditions:");
{
  const rng = new Rng(4);
  const { a, events } = humanoidScene([
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.CameraAt, a: 57, b: 40 },
    { op: HumanoidOp.SetPos, mode: 1, a: 0, b: 0, f0: 12, f1: 0 },
    { op: HumanoidOp.End, mode: 0, a: 0, b: 0 },
  ]);
  hFrame(a, events, rng);
  check("it waits while the camera is elsewhere", a.hum.pc === 0);
  G.g_active_cam_path = 57;
  G.g_cam_path_frame = 39;
  hFrame(a, events, rng);
  check("and while the path matches but the frame has not come", a.hum.pc === 0);
  G.g_cam_path_frame = 40;
  hFrame(a, events, rng);
  check("then runs on when the camera arrives",
        a.pos.y === 12 && a.hum.pc === -1, `pc ${a.hum.pc} y ${a.pos.y}`);
}

console.log("\nclass 0x25, jumps and the stall guard:");
{
  const rng = new Rng(4);
  // A jump backwards over a wait: the classic idle loop, and the shape that
  // would hang the frame if the VM did not stop at a blocked command.
  const { a, events } = humanoidScene([
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 5, b: 0 },
    { op: HumanoidOp.Jump, mode: 0, a: 0, b: 0, next: 0 },
  ]);
  for (let i = 0; i < 200; i++) hFrame(a, events, rng);
  check("a loop of wait-and-jump runs for ever without hanging a frame",
        !a.dead && a.hum.pc === 0, `pc ${a.hum.pc}`);
}

console.log("\nclass 0x25, op 10 picks an arm by g_active_player:");
{
  const rng = new Rng(4);
  // Stage 3's block 2, spawn 0x3378 -- character type 0x39, `gameover_player`
  // -- transcribed from `st3evtbl.bin` at 0x33B4 with the indices the exporter
  // resolves. Two arms and a marker between them: kill me if the active player
  // is 1, otherwise stand and play.
  const player = (): Parameters<typeof humanoidScene>[0] => [
    { op: HumanoidOp.WaitThenPlay, mode: -1, a: 0, b: 0 },
    { op: HumanoidOp.IfActivePlayer, mode: 1, a: 0, b: 0, skip: 3 },
    { op: HumanoidOp.Kill, mode: 0, a: 0, b: 0 },
    { op: HumanoidOp.IfActivePlayer, mode: 0, a: 0, b: 0, skip: 6 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 9999, b: 0 },
    { op: HumanoidOp.End, mode: 0, a: 0, b: 0 },
    { op: HumanoidOp.SetPos, mode: 1, a: 0, b: 0, f0: 99, f1: 0 },
    { op: HumanoidOp.End, mode: 0, a: 0, b: 0 },
  ];

  {
    // One player on slot 0 — `SelectAttackablePlayer` (`FUN_00414F40`) writes
    // 0 — is the port's configuration, and it is the one the player character
    // has to survive.
    const { a, events } = humanoidScene(player());
    G.g_active_player = 0;
    hFrame(a, events, rng);
    check("a mismatched op 10 skips its arm instead of running it",
          !a.dead && a.visible, `dead ${a.dead} visible ${a.visible}`);
    check("...and lands on the command after the -2 marker, not on the marker",
          a.hum.pc === 4, `pc ${a.hum.pc}`);
    for (let i = 0; i < 60; i++) hFrame(a, events, rng);
    check("...so the arm the active player names is the one that runs",
          a.hum.pc === 4 && a.pos.y !== 99, `pc ${a.hum.pc} y ${a.pos.y}`);
  }
  {
    // The same program with the other player active: now the kill is the arm
    // that matches, and the actor goes. Both halves matter — an op 10 that
    // always skipped would leave two player characters standing in the shot.
    const { a, events } = humanoidScene(player());
    G.g_active_player = 1;
    hFrame(a, events, rng);
    check("a matching op 10 falls into its arm", a.dead && !a.visible,
          `dead ${a.dead} pc ${a.hum.pc}`);
  }
  {
    // Mode -2 is the marker, not a fourth comparison: `0x0048478C` tests 0, 1
    // and 2 and steps the cursor for anything else.
    const { a, events } = humanoidScene([
      { op: HumanoidOp.IfActivePlayer, mode: -2, a: 0, b: 0 },
      { op: HumanoidOp.SetPos, mode: 1, a: 0, b: 0, f0: 3, f1: 0 },
      { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 9999, b: 0 },
    ]);
    G.g_active_player = 0;
    hFrame(a, events, rng);
    check("an op 10 in a mode it does not test steps over and does not skip",
          a.pos.y === 3 && a.hum.pc === 2, `pc ${a.hum.pc} y ${a.pos.y}`);
  }
  {
    // A bundle written before `skip` was carried. Leaving the VM keeps the
    // actor on screen; running the arm regardless is what deleted it.
    const { a, events } = humanoidScene([
      { op: HumanoidOp.IfActivePlayer, mode: 1, a: 0, b: 0 },
      { op: HumanoidOp.Kill, mode: 0, a: 0, b: 0 },
    ]);
    G.g_active_player = 0;
    hFrame(a, events, rng);
    check("a mismatched op 10 with no skip leaves the VM rather than killing",
          !a.dead && a.visible && a.hum.pc === -1,
          `dead ${a.dead} pc ${a.hum.pc}`);
  }
  G.g_active_player = 0;
}

console.log("\nclass 0x25, the removal trigger:");
{
  const rng = new Rng(4);
  const { a, events } = humanoidScene([
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 9999, b: 0 },
  ]);
  G.g_active_cam_path = 90;
  G.g_cam_path_frame = 899;
  hFrame(a, events, rng);
  check("it stays until the camera reaches the removal frame", !a.dead);
  G.g_cam_path_frame = 900;
  hFrame(a, events, rng);
  check("and leaves when it does", a.dead);
}

console.log("\nclass 0x25, the two draw fields the VM writes:");
{
  const rng = new Rng(4);
  // `op 14` picks the hand prop and mode 2 restarts the cel counter; `op 12`
  // is a persistent bone toggle, not the one-shot effect it was read as.
  const { a, events } = humanoidScene([
    { op: HumanoidOp.SetBoneDecoration, mode: 1, a: 0, b: 0 },
    { op: HumanoidOp.SetBonePropMode, mode: 2, a: 0, b: 0 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 4, b: 0 },
    { op: HumanoidOp.SetBoneDecoration, mode: 0, a: 0, b: 0 },
    { op: HumanoidOp.SetBonePropMode, mode: 7, a: 0, b: 0 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 9999, b: 0 },
  ]);
  a.hum.bonePropFrame = 9;
  hFrame(a, events, rng);
  check("op 12 mode 1 sets the bone decoration and it stays set",
        a.hum.boneDecoration === 1);
  check("op 14 mode 2 picks hand prop 2 and restarts the cel counter",
        a.hum.bonePropMode === 2 && a.hum.bonePropFrame === 0);

  for (let i = 0; i < 4; i++) hFrame(a, events, rng);
  check("op 12 mode 0 clears it again", a.hum.boneDecoration === 0);
  check("and a mode op 14 does not know leaves the prop alone",
        a.hum.bonePropMode === 2, `mode ${a.hum.bonePropMode}`);
}

console.log("\nclass 0x25, the program ends into ScriptedHumanoidIdle:");
{
  const rng = new Rng(4);
  // Face the camera, then end. `op -1` installs `ScriptedHumanoidIdle`
  // (`FUN_00484D40`), which runs the removal test and the draw and nothing
  // else -- no stall counter, no turn, no path follow, no `prevPos` capture.
  const { a, events } = humanoidScene([
    { op: HumanoidOp.TurnMode, mode: 1, a: 0, b: 0 },
    { op: HumanoidOp.End, mode: 0, a: 0, b: 0 },
  ]);
  hFrame(a, events, rng);
  check("the frame that runs op -1 still falls through the normal tail",
        a.hum.pc === -1 && a.hum.stallFrames === 1 && a.hum.turnMode === HumanoidTurn.FaceCamera,
        `pc ${a.hum.pc} hold ${a.hum.stallFrames}`);

  const yaw = a.yaw;
  // Move it somewhere the FaceCamera turn would aim it differently.
  a.pos.x = 500;
  a.pos.z = -500;
  hFrame(a, events, rng);
  hFrame(a, events, rng);
  check("and after that it stops turning and stops counting",
        a.yaw === yaw && a.hum.stallFrames === 1,
        `yaw ${a.yaw} was ${yaw} hold ${a.hum.stallFrames}`);

  // The removal test is the one thing the idle routine does keep.
  G.g_active_cam_path = 90;
  G.g_cam_path_frame = 900;
  hFrame(a, events, rng);
  check("but the removal trigger still fires", a.dead);
}

console.log("\nclass 0x25, the object path's attachment offset:");
{
  const rng = new Rng(4);
  // `op 11`'s `b` is an index into `g_class25_path_offsets` (0x00596B18), not
  // a distance: record 1 is {4.5, 3.0, -1.5} with a half-turn of yaw.
  const { a, events } = humanoidScene([
    { op: HumanoidOp.FollowPath, mode: 1, a: 5, b: 1 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 9999, b: 0 },
  ]);
  const pathHost = {
    ...NULL_HOST,
    objectPath: () => ({ x: 10, y: 0, z: 20 }),
  };
  ScriptedHumanoidUpdate(a, { eye: EYE, dt: 1 / 60, rng, host: pathHost,
                              events });
  const r = g_class25_path_offsets[1];
  check("op 11's b indexes the 24-byte offset table",
        a.hum.pathOffsetRecord === 1 && r.dx === 4.5 && r.dyaw === 0x8000);
  check("and the record is added to the path's point, with its yaw delta",
        Math.abs(a.pos.x - (10 + r.dx)) < 1e-6
        && Math.abs(a.pos.y - (0 + r.dy)) < 1e-6
        && Math.abs(a.pos.z - (20 + r.dz)) < 1e-6
        && a.yaw === r.dyaw,
        `pos ${a.pos.x},${a.pos.y},${a.pos.z} yaw ${a.yaw}`);
}

console.log("\nclass 0x25, it is not an enemy:");
{
  const rng = new Rng(4);
  const { a, events } = humanoidScene([
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 9999, b: 0 },
  ]);
  hFrame(a, events, rng);
  GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
  check("a scripted humanoid is not counted as a live enemy",
        G.g_enemies_alive === 0, String(G.g_enemies_alive));
  check("and is not a camera target", G.g_enemy_slots.length === 0);
}

console.log("\nclass 0x25, `op 4` mode 4 waits for the actor to RECEDE (B13):");
{
  const rng = new Rng(4);
  // `0x004845AE`-`0x00484604`: the engine compares `|prevPos - point|` against
  // `|pos - point|` and blocks unless the previous distance was the smaller
  // one. The port had this the other way round and called it
  // `NearerThanBefore`.
  const { a, events } = humanoidScene([
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.FartherThanBefore,
      a: 0, b: 0, f0: 0, f1: 0 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 9999, b: 0 },
  ]);
  // Frame one leaves `prevPos` at the origin and the actor 10 units out, so
  // the actor is farther than it was: the command proceeds.
  a.pos.x = 10;
  hFrame(a, events, rng);
  check("moving away from the point passes the test", a.hum.pc === 1,
        `pc ${a.hum.pc}`);

  const closing = humanoidScene([
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.FartherThanBefore,
      a: 0, b: 0, f0: 0, f1: 0 },
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.Frames, a: 9999, b: 0 },
  ]);
  closing.a.pos.x = 10;
  closing.a.hum.prevPos.x = 20;
  hFrame(closing.a, closing.events, rng);
  check("...and closing on it does not", closing.a.hum.pc === 0,
        `pc ${closing.a.hum.pc}`);
}

console.log("\nclass 0x25, an unbaked clip parks the VM (B13's mechanism):");
{
  // The bug as reported was two stage-2 humanoids frozen on one frame. The
  // cause was not in this file at all: their `op 2` set motion 180 and the
  // **exporter** had never baked it, because nothing added an `op 2` operand
  // to the bake list. `tools/verify_scripted_clips.py` is the corpus check for
  // that; this is the port half, which records what an unbaked clip does so
  // the symptom is recognisable the next time one appears.
  const rng = new Rng(4);
  const cmds = [
    { op: HumanoidOp.SetMotion, mode: -1, a: 55, b: 0 },
    { op: HumanoidOp.WaitThenHold, mode: HumanoidCond.MotionFrame,
      a: -1, b: 0 },
    { op: HumanoidOp.End, mode: 0, a: 0, b: 0 },
  ];
  // 55 is deliberately not in `TYPE.motions`.
  const gone = humanoidScene(cmds);
  for (let i = 0; i < 600; i++) hFrame(gone.a, gone.events, rng);
  check("a clip with no baked frames parks the wait for ever",
        gone.a.hum.pc === 1 && gone.a.motion === 55,
        `pc ${gone.a.hum.pc} motion ${gone.a.motion}`);
  check("...and the class says so rather than saying nothing",
        !!g_class_handlers[SpawnClass.ScriptedHumanoid]
          ?.debug?.(gone.a).detail?.some((d) => d.includes("not baked")),
        JSON.stringify(g_class_handlers[SpawnClass.ScriptedHumanoid]
          ?.debug?.(gone.a)));

  // The same program with a clip that *is* baked reaches its last frame and
  // leaves the VM, which is what the two stage-2 spawns now do.
  const ok = humanoidScene([
    { op: HumanoidOp.SetMotion, mode: -1, a: 10, b: 0 },
    { op: HumanoidOp.WaitThenHold, mode: HumanoidCond.MotionFrame,
      a: -1, b: 0 },
    { op: HumanoidOp.End, mode: 0, a: 0, b: 0 },
  ]);
  for (let i = 0; i < 600; i++) {
    ActorAdvanceMotion(ok.a, 1 / 60);
    hFrame(ok.a, ok.events, rng);
  }
  check("a baked clip reaches its last frame and the program ends",
        ok.a.hum.pc === -1 && ok.a.frozen === 1,
        `pc ${ok.a.hum.pc} frozen ${ok.a.frozen}`);
}

console.log("\nclass 0x25 answers the sidebar (B13's other half):");
{
  const rng = new Rng(4);
  const { a, events } = humanoidScene([
    { op: HumanoidOp.WaitUntil, mode: HumanoidCond.CameraAt, a: 67, b: 85 },
  ]);
  hFrame(a, events, rng);
  const d = g_class_handlers[SpawnClass.ScriptedHumanoid]?.debug?.(a);
  // `actorsProjection` prints "ported, but the class says nothing" for any
  // handler with no `debug`, which is what the bug report quoted.
  check("the handler has a `debug`", d !== undefined);
  check("...and it names the command the VM is parked on",
        !!d?.summary.includes("WaitUntil") && !!d?.summary.includes("pc 0"),
        d?.summary);
  check("...and the camera pair it is waiting for",
        !!d?.summary.includes("cam (67,85)"), d?.summary);
}

// -- 9b. class 0x20, the one-hit target -------------------------------------

/**
 * One class-0x20 actor with a descriptor of its own.
 *
 * The tail this hands over is the exporter's `class20` block, which is a
 * **separate key** from `body_condition`/`initial_state` precisely because
 * `OneHitTargetInit` (`FUN_00448ED0`) reads the same two descriptor bytes as
 * the character type and a sub-type where `EnemyZombieInit` reads them as the
 * body condition and the initial state.
 */
function targetScene(over: Partial<NonNullable<Actor["oneHitTarget"]>> = {},
                     rng = new Rng(7)):
    { a: OneHitTargetActor; events: Events; rng: Rng } {
  ResetGameGlobals();
  SetGameTables(CHARS, undefined, undefined, undefined);
  G.g_active_cam_path = -1;
  G.g_cam_path_frame = 0;
  const a = ActorSpawn(0x52ec, SpawnClass.OneHitTarget, 1, "target", {
    oneHitTarget: {
      subtype: 0, remove_path: 68, remove_frame: 260, motion: 10, box: null,
      ...over,
    },
  });
  if (a.cls !== SpawnClass.OneHitTarget) throw new Error("not class 0x20");
  a.visible = true;
  a.pos = vec3(0, 0, 0);
  g_class_handlers[SpawnClass.OneHitTarget]?.init(a, rng);
  return { a, events: new Events(), rng };
}

const tFrame = (a: OneHitTargetActor, events: Events, rng: Rng) =>
  OneHitTargetUpdate(a, { eye: EYE, dt: 1 / 60, rng, host: NULL_HOST, events });

console.log("\nclass 0x20, the Init reads its own tail:");
{
  const { a } = targetScene({ motion: 1024 });
  check("an authored motion is taken as it is", a.motion === 1024,
        String(a.motion));
  check("...and the state opens on the alive routine",
        a.tgt.state === OneHitTargetState.Alive, String(a.tgt.state));

  // `if (tail+6 == 0) obj+0x1B4 = g_class20_idle_motions[rand() & 3]`. Which
  // one is the draw's business; that it is one of the four is the assertion,
  // and that it comes from `ctx.rng` is what makes the snapshot restore.
  const drawn = targetScene({ motion: 0 });
  check("motion 0 draws one of `g_class20_idle_motions`",
        g_class20_idle_motions.includes(drawn.a.motion), String(drawn.a.motion));
  const again = targetScene({ motion: 0 }, new Rng(7));
  check("...from the seeded rng, so two runs of one seed agree",
        again.a.motion === drawn.a.motion,
        `${again.a.motion} vs ${drawn.a.motion}`);
}

console.log("\nclass 0x20, the removal cue:");
{
  const { a, events, rng } = targetScene();
  G.g_active_cam_path = 68;
  G.g_cam_path_frame = 259;
  tFrame(a, events, rng);
  check("one frame short of the cue it stays", !a.despawned && !a.dead);
  G.g_cam_path_frame = 260;
  tFrame(a, events, rng);
  check("at the cue it despawns", a.despawned, `dead ${a.dead}`);

  // The wrong path at the right frame is not the cue. This is the test class
  // 0x24 and class 0x25 share, and class 0x20 has no script-flag alternative.
  const other = targetScene();
  G.g_active_cam_path = 67;
  G.g_cam_path_frame = 900;
  tFrame(other.a, other.events, other.rng);
  check("...and another path at any frame is not it", !other.a.despawned);
}

console.log("\nclass 0x20 dies to one hit, and pays for it:");
{
  const { a, events, rng } = targetScene();
  G.g_player_score = [0, 0];
  // Bone 4 is not the head: 10 points, then 80 for the kill.
  MarkActorShot(a, 0, 4);
  tFrame(a, events, rng);
  check("any hit kills it", a.dead && a.tgt.state === OneHitTargetState.Dying,
        `dead ${a.dead} state ${a.tgt.state}`);
  check("...for 10 + 80", G.g_player_score[0] === 90,
        String(G.g_player_score[0]));
  check("...and it cues the death clip", a.motion === CLASS20_DEATH_MOTION,
        String(a.motion));
  check("...and leaves the shot list -- `obj+0x34` bit 0 is cleared",
        (a.flags & 0x1) === 0, `flags 0x${(a.flags >>> 0).toString(16)}`);
  check("...and the kill counter moved", G.g_one_hit_target_kills === 1,
        String(G.g_one_hit_target_kills));

  const head = targetScene();
  G.g_player_score = [0, 0];
  MarkActorShot(head.a, 0, CLASS20_HEAD_BONE);
  tFrame(head.a, head.events, head.rng);
  check("a head hit pays 120 + the combo + 80",
        G.g_player_score[0] === CLASS20_SCORE_HEAD + CLASS20_SCORE_KILL,
        String(G.g_player_score[0]));
  check("...and grows `g_head_combo_bonus`",
        G.g_head_combo_bonus[0] === CLASS20_SCORE_HEAD_COMBO_STEP,
        String(G.g_head_combo_bonus[0]));

  // The head combo is a per-player counter the whole game shares, and any
  // non-head hit zeroes it -- which is the rule that makes it worth having.
  const body = targetScene();
  G.g_head_combo_bonus = [30, 0];
  MarkActorShot(body.a, 0, 4);
  tFrame(body.a, body.events, body.rng);
  check("a non-head hit zeroes the combo", G.g_head_combo_bonus[0] === 0,
        String(G.g_head_combo_bonus[0]));
}

console.log("\nclass 0x20's death chain runs to the despawn:");
{
  const { a, events, rng } = targetScene();
  MarkActorShot(a, 0, 4);
  tFrame(a, events, rng);
  // `OneHitTargetPlayDeathClip` holds the clip's last frame, then arms the
  // 120-frame countdown at `obj+0x1330` -- which is the head's `arcFrames`,
  // because that word is also the shared arc record's and class 0x24's.
  for (let i = 0; i < 200 && a.tgt.state === OneHitTargetState.Dying; i++) {
    ActorAdvanceMotion(a, 1 / 60);
    tFrame(a, events, rng);
  }
  check("the death clip hands over to the sink",
        a.tgt.state === OneHitTargetState.Sinking, String(a.tgt.state));
  check("...with 120 frames of body armed",
        a.arcFrames === CLASS20_SINK_FRAMES, String(a.arcFrames));
  const y0 = a.pos.y;
  for (let i = 0; i < CLASS20_SINK_FRAMES; i++) tFrame(a, events, rng);
  check("...which sinks 0.04 a frame",
        Math.abs((y0 - a.pos.y) - CLASS20_SINK_FRAMES * CLASS20_SINK_PER_FRAME)
          < 1e-6,
        `${y0} -> ${a.pos.y}`);
  check("...and despawns at zero", a.despawned, `arcFrames ${a.arcFrames}`);
}

/**
 * **...and the clip plays once, not twice.**
 *
 * `OneHitTargetPlayDeathClip` (`FUN_00449380`) puts `obj+0x194` back on the
 * frame the clip ends (`004493e3 MOV [EDI], EAX`) and
 * `OneHitTargetSinkAndDespawn` (`FUN_00449430`) never steps it, so the body
 * sinks on the death clip's last pose. The port's clock is shared and runs for
 * every actor before any handler, and the poser reads the base track with the
 * **wrapping** conversion — so the clip restarted under the sink and the
 * report was "the death animation plays twice". 82 authored frames against a
 * 120-frame sink: once through and 38 frames into a third.
 */
console.log("\n...and the death clip is held, not looped, under the sink:");
{
  const { a, events, rng } = targetScene();
  const clip = () => {
    const m = MotionOf(a, a.motion);
    return m && m.frames > 0
      ? authoredFrameOfTicks(a.playTicks, m.fps, m.frames) : -1;
  };
  MarkActorShot(a, 0, 4);
  tFrame(a, events, rng);
  for (let i = 0; i < 400 && a.tgt.state === OneHitTargetState.Dying; i++) {
    ActorAdvanceMotion(a, 1 / 60);
    tFrame(a, events, rng);
  }
  const m = MotionOf(a, a.motion);
  const last = (m?.frames ?? 1) - 1;
  check("the sink starts on the clip's last authored frame",
        clip() === last, `frame ${clip()} of ${m?.frames}`);
  // The wrap, if it happens, is a frame number going *down*. One pass and no
  // restarts is the whole assertion.
  let restarts = 0;
  let prev = clip();
  for (let i = 0; i < CLASS20_SINK_FRAMES - 1; i++) {
    ActorAdvanceMotion(a, 1 / 60);
    tFrame(a, events, rng);
    const now = clip();
    if (now < prev) restarts += 1;
    prev = now;
  }
  check("...and holds it for the whole 120 frames",
        restarts === 0 && clip() === last,
        `${restarts} restart(s), frame ${clip()}`);
}

console.log("\nclass 0x20's three sub-types:");
{
  // Sub-type 0 has no idle motion of its own at all; whatever moves it is the
  // clip's root translation, which is `ActorAdvanceMotion`'s.
  const still = targetScene({ subtype: 0 });
  const yaw0 = still.a.yaw;
  for (let i = 0; i < 10; i++) tFrame(still.a, still.events, still.rng);
  check("sub-type 0 neither spins nor is clamped", still.a.yaw === yaw0,
        String(still.a.yaw));

  // Sub-type 1 spins, and `obj+0x11C` -- the descriptor's `+0x22`, which the
  // bundle calls `hp` -- is the direction and not a hit-point count.
  const cw = targetScene({ subtype: 1 });
  cw.a.hp = 1;
  for (let i = 0; i < 4; i++) tFrame(cw.a, cw.events, cw.rng);
  check("sub-type 1 with a non-zero `obj+0x11C` spins one way",
        cw.a.yaw === 4 * CLASS20_SPIN_STEP, String(cw.a.yaw));
  const ccw = targetScene({ subtype: 1 });
  ccw.a.hp = 0;
  ccw.a.yaw = 0x8000;
  for (let i = 0; i < 4; i++) tFrame(ccw.a, ccw.events, ccw.rng);
  check("...and with zero it spins the other", ccw.a.yaw === 0x8000 - 4 * CLASS20_SPIN_STEP,
        String(ccw.a.yaw));

  // Sub-type 2 is clamped into the tail's box and turns away from the wall.
  const boxed = targetScene({ subtype: 2, box: [-10, 10, -10, 10] });
  boxed.a.pos.x = 25;
  boxed.a.yaw = 0;
  tFrame(boxed.a, boxed.events, boxed.rng);
  check("sub-type 2 is clamped to the box's x max", boxed.a.pos.x === 10,
        String(boxed.a.pos.x));
  check("...and turns away from that wall",
        boxed.a.yaw === -CLASS20_WALL_TURN, String(boxed.a.yaw));

  // A corner turns ONCE: the engine's `bVar3` suppresses the z turn after an
  // x clamp, so this is 0x100 and not 0x200.
  const corner = targetScene({ subtype: 2, box: [-10, 10, -10, 10] });
  corner.a.pos.x = 25;
  corner.a.pos.z = 25;
  corner.a.yaw = 0;
  tFrame(corner.a, corner.events, corner.rng);
  check("a corner clamps both axes", corner.a.pos.x === 10 && corner.a.pos.z === 10,
        `${corner.a.pos.x},${corner.a.pos.z}`);
  check("...but turns only once", corner.a.yaw === -CLASS20_WALL_TURN,
        String(corner.a.yaw));
}

console.log("\n`ActorInitHitPoints` runs for two classes, not for every spawn:");
{
  // `[proved]` -- `FUN_0040A8B0` has exactly two callers in the image,
  // `EnemyZombieInit` (0x00452DF2) and `EnemyThrowerInit` (0x0044964A). Every
  // other class reads `obj+0x11C` as `SpawnFromDescriptor` left it, and the
  // clamp's floor of 1 turns an honest zero into a one. For a class-0x20
  // sub-type 1 that zero **is** the spin direction, so the clamp reversed it.
  ResetGameGlobals();
  SetGameTables(CHARS, undefined, undefined, undefined);
  const zero = { hp: 0 } as unknown as CharacterPlacement;
  check("a class-0x30 spawn is scaled and clamped to at least 1",
        ActorInitHitPoints(zero, SpawnClass.Zombie) >= 1,
        String(ActorInitHitPoints(zero, SpawnClass.Zombie)));
  check("...and a class-0x31 spawn too",
        ActorInitHitPoints(zero, SpawnClass.Thrower) >= 1);
  check("a class-0x20 spawn keeps its raw `obj+0x11C`",
        ActorInitHitPoints(zero, SpawnClass.OneHitTarget) === 0,
        String(ActorInitHitPoints(zero, SpawnClass.OneHitTarget)));
  check("...and so do the other non-combat classes",
        ActorInitHitPoints(zero, SpawnClass.ScriptedHumanoid) === 0
        && ActorInitHitPoints(zero, SpawnClass.SetPieceProp) === 0
        && ActorInitHitPoints(zero, SpawnClass.Civilian) === 0);
}

console.log("\nclass 0x20 is not an enemy, and owns its own shot:");
{
  const { a, events, rng } = targetScene();
  tFrame(a, events, rng);
  GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
  check("a one-hit target is not counted as a live enemy",
        G.g_enemies_alive === 0, String(G.g_enemies_alive));
  check("...and `ActorIsEnemy` agrees", !ActorIsEnemy(SpawnClass.OneHitTarget));
  // `ownsShotResult` is what keeps `ResolveHit` off it: this actor has no hit
  // points and no damage row, so the combat path would charge it nothing and
  // look up a table it has no entry in.
  check("the class reads `obj+0x34` bit 3 itself",
        g_class_handlers[SpawnClass.OneHitTarget]?.ownsShotResult === true);
  check("...and keeps ticking once dead, or the body would hang in the air",
        g_class_handlers[SpawnClass.OneHitTarget]?.updatesWhenDead === true);
}

// -- 10. class 0x24, the set-pieces ----------------------------------------

const SETPIECE_BASE: SetPieceParams = {
  selector: 0, removePath: 7, removeFrame: 100, motion: 10, hold: 0,
  cuePath: 3, cueFrame: 40, cue2Path: 4, cue2Frame: 20, phase: 0,
};

/** A stage with one set-piece of the given shape, and the camera at nothing. */
function setPieceScene(over: Partial<SetPieceParams>, rng: Rng): {
  a: SetPiecePropActor; events: Events;
} {
  ResetGameGlobals();
  const params = { ...SETPIECE_BASE, ...over };
  SetGameTables(CHARS, undefined, { "12288": params });
  G.g_camera_fixed_eye_y = 0;
  G.g_active_cam_path = -1;
  G.g_cam_path_frame = 0;
  const a = ActorSpawn(0x3000, SpawnClass.SetPieceProp, 1, "set-piece");
  // Narrowing, not a cast — the same reason the humanoid fixture does it.
  if (a.cls !== SpawnClass.SetPieceProp) throw new Error("not class 0x24");
  a.visible = true;
  a.pos = vec3(0, 40, 0);
  void rng;
  return { a, events: new Events() };
}

const frame = (a: SetPiecePropActor, events: Events, rng: Rng) =>
  SetPiecePropUpdate(a, { eye: EYE, dt: 1 / 60, rng, host: NULL_HOST, events });

console.log("\nclass 0x24, the removal trigger:");
{
  const rng = new Rng(2);
  const { a, events } = setPieceScene({}, rng);
  frame(a, events, rng);
  check("it stays while the camera is elsewhere", !a.dead);

  G.g_active_cam_path = 7;
  G.g_cam_path_frame = 99;
  frame(a, events, rng);
  check("and while the path matches but the frame has not arrived", !a.dead);

  G.g_cam_path_frame = 100;
  let removed = 0;
  events.on("setpiece.removed", () => removed++);
  frame(a, events, rng);
  check("it leaves the moment the camera reaches the path and frame",
        a.dead && removed === 1);
}

console.log("\nclass 0x24, the freeze cues:");
{
  const rng = new Rng(2);
  // Selector 2 opens frozen and takes two cues: one starts it, one stops it.
  const { a, events } = setPieceScene(
    { selector: SetPieceState.StartAndStopOnCues }, rng);
  check("selector 2 opens frozen", a.frozen === 1);

  G.g_active_cam_path = 4;
  G.g_cam_path_frame = 20;
  frame(a, events, rng);
  check("the start cue releases it", a.frozen === 0);

  G.g_active_cam_path = 3;
  G.g_cam_path_frame = 40;
  frame(a, events, rng);
  check("the stop cue freezes it again", a.frozen === 1);

  // And a frozen actor's clip does not advance -- the freeze is in
  // `ActorAdvanceMotion`, where the engine keeps it.
  a.motion = 10;
  const before = a.playTicks;
  ActorAdvanceMotion(a, 1 / 60);
  check("a frozen set-piece holds its pose", a.playTicks === before);
  a.frozen = 0;
  ActorAdvanceMotion(a, 1 / 60);
  check("and an unfrozen one does not", a.playTicks > before);
}

console.log("\nclass 0x24, the drop:");
{
  const rng = new Rng(2);
  const { a, events } = setPieceScene(
    { selector: SetPieceState.DropToGround }, rng);
  check("selector 3 opens frozen and in the air",
        a.frozen === 1 && a.pos.y === 40);

  frame(a, events, rng);
  check("the first frame only arms the fall", a.sub === 1 && a.pos.y === 40);

  frame(a, events, rng);
  check("then it accelerates downward",
        Math.abs(a.vel.y - -DROP_GRAVITY) < 1e-9 && a.pos.y < 40,
        `vel ${a.vel.y}`);

  for (let i = 0; i < 3000 && a.sub === 1; i++) frame(a, events, rng);
  check("it lands on the ground plane and stops exactly there",
        a.sub === 2 && a.pos.y === G.g_camera_fixed_eye_y, String(a.pos.y));
  check("and landing is what starts the animation", a.frozen === 0);
}

console.log("\nclass 0x24, the slide:");
{
  const rng = new Rng(2);
  const { a, events } = setPieceScene({ selector: SetPieceState.Slide }, rng);
  frame(a, events, rng);
  check("it takes the fixed heading",
        Math.abs(a.vel.x - SLIDE_VX) < 1e-6
        && Math.abs(a.vel.z - SLIDE_VZ) < 1e-6);
  const x0 = a.pos.x;
  for (let i = 0; i < SLIDE_FRAMES + 4; i++) frame(a, events, rng);
  check("it travels along it and then stops",
        a.pos.x > x0 && a.sub >= 2, `x ${a.pos.x.toFixed(1)} sub ${a.sub}`);
  const rest = a.pos.x;
  for (let i = 0; i < 200; i++) frame(a, events, rng);
  check("and stays stopped", a.pos.x === rest);
}

console.log("\nclass 0x24, the selector is +0x130C:");
{
  const rng = new Rng(2);
  const { a, events } = setPieceScene(
    { selector: SetPieceState.DropToGround }, rng);
  check("the Init writes the selector to +0x130C and leaves +0x1310 alone",
        a.prop.selector === SetPieceState.DropToGround && a.state === 0,
        `selector ${a.prop.selector} state ${a.state}`);

  // `+0x1310` is the combat classes' state word; class 0x24 never reads it,
  // so writing it must not change which state routine runs.
  a.state = SetPieceState.Slide;
  frame(a, events, rng);
  check("and the dispatch ignores +0x1310",
        a.sub === 1 && a.vel.x === 0, `sub ${a.sub} vx ${a.vel.x}`);
}

console.log("\nclass 0x24, the hold-then-play count:");
{
  const rng = new Rng(2);
  const HOLD = 4;
  const { a, events } = setPieceScene(
    { selector: SetPieceState.Idle, hold: HOLD, cuePath: 21, motion: 10 },
    rng);
  // The engine compares the counter *before* stepping it, so the swap lands
  // on the frame after the hold has been counted out in full.
  for (let i = 0; i < HOLD; i++) frame(a, events, rng);
  check("the hold runs its full count before the motion swaps",
        a.motion === 10 && a.holdFrames === HOLD,
        `motion ${a.motion} hold ${a.holdFrames}`);
  frame(a, events, rng);
  check("and swaps on the next frame, tail+0x0E being a motion id here",
        a.motion === 21 && a.playTicks === 0,
        `motion ${a.motion}`);
  frame(a, events, rng);
  frame(a, events, rng);
  check("then the entry point is SetPieceStateIdle and it never swaps again",
        a.motion === 21 && a.holdFrames === HOLD + 1,
        `hold ${a.holdFrames}`);
}

console.log("\nclass 0x24, the script-flag removal variant:");
{
  const rng = new Rng(2);
  const { a, events } = setPieceScene({}, rng);
  // Bit 0x2000000 swaps the removal trigger for a script flag.
  a.flags |= 0x2000000;
  G.g_active_cam_path = 7;
  G.g_cam_path_frame = 999;
  frame(a, events, rng);
  check("the camera no longer removes it once the flag bit is set", !a.dead);
  G.g_script_flags[7] = 1;
  frame(a, events, rng);
  check("but the script flag does", a.dead);
}

console.log("\nclass 0x41, the props are in the save state:");
{
  const rng = new Rng(21);
  const events = propScene(rng);
  PlaceBreakableGroup(1, 4, rng);
  const snap = JSON.stringify(G.g_breakable_props);
  check("the prop pool survives JSON.stringify",
        JSON.parse(snap).length === 3);
  check("a prop holds no functions or class instances",
        G.g_breakable_props.every(
          (p) => Object.values(p).every(
            (v) => typeof v !== "function"
                   && (typeof v !== "object" || v === null
                       || Object.getPrototypeOf(v) === Object.prototype))));
  void events;
}
console.log("\nclass 0x21, the rescue target and stage 2's first fork:");
{
  /**
   * A host that answers `CamEvalObjectPath6` for the two rows of
   * `g_st2car_path_table` class 0x21 reaches, and for nothing else. The pose
   * is a made-up point per slot, which is all the assertions need: what is
   * being checked is *which* curve the actor is on, not the curve.
   */
  const CAR_PATH_POSE: Record<number, { x: number; y: number; z: number;
                                        yaw: number }> = {
    0x148: { x: -100, y: -8, z: -200, yaw: 0x4000 },
    0x14e: { x: -300, y: -8, z: -400, yaw: 0x4000 },
  };
  const carHost: GameHost = {
    ...NULL_HOST,
    objectPath: (slot, _frame) => CAR_PATH_POSE[slot] ?? null,
  };

  const rescueScene = (rng = new Rng(21)) => {
    ResetGameGlobals();
    SetGameTables(CHARS, undefined, undefined, undefined);
    G.g_active_cam_path = 0x39;
    G.g_cam_path_frame = 0;
    // Rank 4 is the first row of `g_class21_hp_by_rank` that gives two, and
    // two is what the "one shot is not a rescue" pair below needs. The table
    // is sixteen rows indexed by `g_damage_rank`; rank 2 gives **one**, which
    // is what this used to assert as two.
    G.g_damage_rank = 4;
    // `ActorSpawn` runs the class's own Init, exactly as
    // `SpawnFromDescriptor` does; calling it again here would count the actor
    // in twice.
    const a = ActorSpawn(0x7d0, SpawnClass.RankScaledEnemy, 7, "rescue",
                         undefined, rng);
    if (a.cls !== SpawnClass.RankScaledEnemy) throw new Error("not class 0x21");
    a.visible = true;
    a.pos = vec3(0, 0, 0);
    return { a, events: new Events(), rng };
  };
  const rFrame = (a: Actor, events: Events, rng: Rng,
                  host: GameHost = carHost) =>
    RescueTargetUpdate(a, { eye: EYE, dt: 1 / 60, rng, host, events });

  {
    const { a, events, rng } = rescueScene();
    check("the Init counts it as an enemy, twice over",
          G.g_enemies_alive === 1 && G.g_enemies_present === 1,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
    check("...with hit points from g_class21_hp_by_rank", a.hp === 2,
          String(a.hp));
    check("...and the table is sixteen rows, not five",
          CLASS21_HP_BY_RANK.length === 16
          && CLASS21_HP_BY_RANK[2] === 1 && CLASS21_HP_BY_RANK[15] === 4,
          `${CLASS21_HP_BY_RANK.length} rows, [2]=${CLASS21_HP_BY_RANK[2]}`);
    check("...and it starts on row 0 of g_st2car_path_table",
          a.rescue.route === 0 && g_st2car_path_table[0] === 0x148,
          `route ${a.rescue.route}`);

    // **And it turns root motion off**, one instruction after
    // `ActorBuildSkinnedModel` turned it on: `MOV EDX,[EDI+0x64];
    // AND EDX,0xFFFFFFFD; MOV [EDI+0x64],EDX` at `0x00451753`-`0x00451760`.
    // Class 0x21 is one of exactly two things in the game that clear the bit.
    //
    // It is not bookkeeping. With the bit clear `SkeletonApplyRootMotion`
    // (`FUN_00410C50`) poses the clip root's **whole** translation instead of
    // only its y, and motion 0x3E6's root is the constant
    // `(0, 15.692, 11.943)` on all sixteen frames -- so the missing line put
    // the rider 11.943 units along its own +Z, out over the car's bonnet.
    // `render/characters/pose.ts` reads this bit and `test/pose.test.ts`
    // asserts the two arms; this is the half that says the bit is right.
    check("...and it clears model+0x64 bit 1 -- root motion OFF",
          (a.motionFlags & MotionFlag.RootMotion) === 0,
          `motionFlags ${a.motionFlags}`);
    check("...which is a departure from what the build leaves",
          (MOTION_FLAGS_INIT & MotionFlag.RootMotion) !== 0
          && a.motionFlags === (MOTION_FLAGS_INIT & ~MotionFlag.RootMotion),
          `${MOTION_FLAGS_INIT} -> ${a.motionFlags}`);

    // **It is on the car.** `RescueTargetPoseFromRoute` (`FUN_00451E50`) puts
    // it at `g_st2car_path_table[obj+0x1350]`'s pose, and sub 0 then adds a
    // drop-in of `(0, 50 - frame, 50 - frame)` rotated by that pose's own yaw.
    // At yaw 0x4000 -- a quarter turn -- the engine's Ry sends the point's z
    // into x, so the whole offset is in x and y and none of it in z.
    G.g_cam_path_frame = 0x20;
    rFrame(a, events, rng);
    const d = 50 - 0x20;
    check("it rides the car's own object path, not a place of its own",
          Math.abs(a.pos.x - (-100 + d)) < 1e-3
          && Math.abs(a.pos.y - (-8 + d)) < 1e-3
          && Math.abs(a.pos.z - -200) < 1e-3,
          `${a.pos.x.toFixed(2)},${a.pos.y.toFixed(2)},${a.pos.z.toFixed(2)}`);
    check("...taking the path's yaw with it", a.yaw === 0x4000,
          String(a.yaw));

    // The `INC word ptr [ESI + 0x1312]` is at `0x00451943`, **after** the
    // transform — so the frame that steps the sub-state still applies the
    // offset, and by then `50 - frame` has gone negative. Transcribed in that
    // order, and this is the assertion that holds it there.
    G.g_cam_path_frame = 0x40;
    rFrame(a, events, rng);
    check("...the frame that steps sub 0 -> 1 still applies the offset",
          a.rescue.sub === 1 && Math.abs(a.pos.x - (-100 + (50 - 0x40))) < 1e-3,
          `sub ${a.rescue.sub} x ${a.pos.x.toFixed(2)}`);
    rFrame(a, events, rng);
    check("...and from then on it is on the pose, with no offset at all",
          Math.abs(a.pos.x - -100) < 1e-3
          && Math.abs(a.pos.y - -8) < 1e-3
          && Math.abs(a.pos.z - -200) < 1e-3,
          `${a.pos.x.toFixed(2)},${a.pos.y.toFixed(2)},${a.pos.z.toFixed(2)}`);

    G.g_cam_path_frame = 0xc0;
    rFrame(a, events, rng);
    check("...and hands over to the held state past frame 0xBD",
          a.rescue.state === RescueTargetState.Held,
          String(a.rescue.state));
    check("...stepping to row 1, the car's route for camera path 0x39",
          a.rescue.route === 1 && g_st2car_path_table[1] === 0x14e,
          `route ${a.rescue.route}`);

    // The held state poses through `RescueTargetPoseFromRouteWithVelocity`,
    // so the actor moves onto the second route and records the jump.
    rFrame(a, events, rng);
    check("...and the held state rides that second route",
          Math.abs(a.pos.x - -300) < 1e-3 && Math.abs(a.pos.z - -400) < 1e-3,
          `${a.pos.x.toFixed(2)},${a.pos.z.toFixed(2)}`);
    check("...writing the frame's pose delta at obj+0x13CC",
          Math.abs(a.rescue.delta.x - -200) < 1e-3
          && Math.abs(a.rescue.delta.z - -200) < 1e-3,
          `${a.rescue.delta.x.toFixed(2)},${a.rescue.delta.z.toFixed(2)}`);

    // A host with no object paths is a valid host, and the actor then stays
    // where it was rather than being flung to the origin.
    const before = { ...a.pos };
    rFrame(a, events, rng, NULL_HOST);
    check("...and a host with no paths leaves it where it stands",
          a.pos.x === before.x && a.pos.z === before.z,
          `${a.pos.x.toFixed(2)},${a.pos.z.toFixed(2)}`);

    // Two hit points, so the first shot does not free it.
    G.g_player_score = [0, 0];
    MarkActorShot(a, 0, 4);
    rFrame(a, events, rng);
    check("one shot is not a rescue",
          G.g_script_branch_var === 0 && a.hp === 1,
          `var ${G.g_script_branch_var} hp ${a.hp}`);
    MarkActorShot(a, 0, 4);
    rFrame(a, events, rng);
    check("**the last shot writes the route**", G.g_script_branch_var === 1,
          String(G.g_script_branch_var));
    check("...and pays 10 + 10 + 80 + 400", G.g_player_score[0] === 500,
          String(G.g_player_score[0]));
    check("...and gives both enemy counters back, once",
          G.g_enemies_alive === 0 && G.g_enemies_present === 0,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
    check("...and plays the freed clip",
          a.motion === CLASS21_MOTION_FREED
          && a.rescue.state === RescueTargetState.Freed,
          `${a.motion} state ${a.rescue.state}`);
  }

  // Left alone, the camera abandons it -- and that path gives the counters
  // back too, which is what stops a `wait_enemies_alive` holding on an actor
  // that has left the shot.
  {
    const { a, events, rng } = rescueScene();
    a.rescue.state = RescueTargetState.Held;
    G.g_cam_path_frame = 0x200;
    rFrame(a, events, rng);
    check("an abandoned target writes no route",
          G.g_script_branch_var === 0, String(G.g_script_branch_var));
    check("...and still gives its counters back",
          G.g_enemies_alive === 0 && G.g_enemies_present === 0,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
  }
}

console.log("\nclasses 0x52 and 0x53, the two shootable triggers:");
{
  const triggerScene = (cls: SpawnClass, tail: object,
                        mode = GameMode.Original) => {
    ResetGameGlobals();
    SetGameTables(CHARS, undefined, undefined, undefined);
    G.g_GameMode = mode;
    const a = ActorSpawn(0x1234, cls, 0x1a, "trigger", tail, new Rng(5));
    a.visible = true;
    return a;
  };
  const tick = (a: Actor) => g_class_handlers[a.cls]?.update(
    a, { eye: EYE, dt: 1 / 60, rng: new Rng(1), host: NULL_HOST });

  // Class 0x52's per-sub-type table is the reading stage 4 block 10 proves:
  // `next = {12, 18, 19}` with one sub-type 3 and one sub-type 4 in it.
  for (const [sub, want] of [[2, 2], [3, 1], [4, 2]] as [number, number][]) {
    const a = triggerScene(SpawnClass.Mouse, { class52: { subtype: sub } });
    MarkActorShot(a, 0, 0);
    tick(a);
    check(`class 0x52 sub-type ${sub} writes route ${want}`,
          G.g_script_branch_var === want, String(G.g_script_branch_var));
  }
  {
    const a = triggerScene(SpawnClass.Mouse, { class52: { subtype: 0 } });
    MarkActorShot(a, 0, 0);
    tick(a);
    check("...and a wanderer writes nothing", G.g_script_branch_var === 0,
          String(G.g_script_branch_var));
    // `ActorDespawn` sets `despawned`, not `dead`: the actor has removed
    // itself and `GameUpdate`'s sweep takes it off `g_object_list`. `dead` is
    // hit points, and this class has none.
    const arcade = triggerScene(SpawnClass.Mouse,
                                { class52: { subtype: 2 } }, GameMode.Arcade);
    check("...and arcade never builds a trigger at all", arcade.despawned);
  }

  // The mouse's own machine: the strip, the wander and the flight. It is
  // ported in full because until now it was ported in half and unreachable.
  {
    const a = triggerScene(SpawnClass.Mouse, { class52: { subtype: 0 } });
    if (a.cls !== SpawnClass.Mouse) throw new Error("not class 0x52");
    check("the Init opens on a frame of the ten-slot strip",
          a.mouse.frame >= MOUSE_FIRST_SLOT
          && a.mouse.frame <= MOUSE_LAST_SLOT,
          a.mouse.frame.toString(16));
    check("...and the shot-test radius `ShotTestSphere` measures against",
          a.hitRadius === MOUSE_HIT_RADIUS, String(a.hitRadius));

    // The strip wraps rather than running off the end of `mouse.bin`.
    a.mouse.frame = MOUSE_LAST_SLOT;
    a.mouse.state = MouseState.Run;
    MouseWanderUpdate(a, { eye: EYE, dt: 1 / 60, rng: new Rng(3),
                           host: NULL_HOST });
    check("the strip wraps from the last slot back to the first",
          a.mouse.frame === MOUSE_FIRST_SLOT, a.mouse.frame.toString(16));

    // 600 frames and it leaves on its own, which is why four of these in
    // stage 1 block 1 answer no branch: they are gone before the route is
    // taken, and they are subtype 0 besides.
    const b = triggerScene(SpawnClass.Mouse, { class52: { subtype: 0 } });
    if (b.cls !== SpawnClass.Mouse) throw new Error("not class 0x52");
    for (let i = 0; i < 601; i++) {
      MouseWanderUpdate(b, { eye: EYE, dt: 1 / 60, rng: new Rng(9),
                             host: NULL_HOST });
    }
    check("a wanderer leaves at 600 frames", b.despawned,
          `life ${b.mouse.life}`);

    // **The turn is the whole of the wander.** `MouseWanderUpdate` ends its
    // sixty-frame pause with `obj+0x68 += (rand() & 0xFFF) - (rand() & 0xFFF)`
    // and then rebuilds the velocity from the new yaw. The port had that as a
    // mask over `Rng.next()`, which returns a float in `[0, 1)`, so both terms
    // were zero: the mouse paused on cue, turned by nothing, and ran in a
    // straight line until its six hundred frames were up. One generator across
    // the samples, because two draws from a fresh one are the same two draws.
    const c = triggerScene(SpawnClass.Mouse, { class52: { subtype: 0 } });
    if (c.cls !== SpawnClass.Mouse) throw new Error("not class 0x52");
    const wanderRng = new Rng(4);
    const turns: number[] = [];
    for (let i = 0; i < 40; i++) {
      c.mouse.state = MouseState.Pause;
      c.mouse.paused = MOUSE_PAUSE_FRAMES;
      const before = c.yaw;
      MouseWanderUpdate(c, { eye: EYE, dt: 1 / 60, rng: wanderRng,
                             host: NULL_HOST });
      turns.push(c.yaw - before);
    }
    check("the mouse turns when its pause ends",
          turns.some((t) => t !== 0),
          `${turns.filter((t) => t === 0).length} of 40 were zero`);
    // One draw would be uniform over 0..0xFFF and so always a turn the same
    // way round. The subtraction is what centres it on zero.
    check("...both ways, because it is the difference of two draws",
          turns.some((t) => t > 0) && turns.some((t) => t < 0),
          `${turns.filter((t) => t > 0).length} up, `
          + `${turns.filter((t) => t < 0).length} down`);
    check("...and never by a whole twelve bits either way",
          turns.every((t) => Math.abs(t) < MOUSE_TURN_SPREAD),
          String(Math.max(...turns.map(Math.abs))));
    // The velocity is rebuilt from the yaw on the same frame, or the mouse
    // would face one way and keep running the other.
    c.mouse.state = MouseState.Pause;
    c.mouse.paused = MOUSE_PAUSE_FRAMES;
    const vx0 = c.mouse.vx;
    const vz0 = c.mouse.vz;
    MouseWanderUpdate(c, { eye: EYE, dt: 1 / 60, rng: wanderRng,
                           host: NULL_HOST });
    check("...and the velocity follows it on the same frame",
          (c.mouse.vx !== vx0 || c.mouse.vz !== vz0)
          && Math.abs(Math.hypot(c.mouse.vx, c.mouse.vz) - MOUSE_SPEED) < 1e-6,
          `${vx0},${vz0} -> ${c.mouse.vx},${c.mouse.vz}`);
  }

  // The trigger's flight: shot, then the per-subtype bound, then stopped.
  {
    const a = triggerScene(SpawnClass.Mouse, { class52: { subtype: 3 } });
    if (a.cls !== SpawnClass.Mouse) throw new Error("not class 0x52");
    a.pos = vec3(-500, 0, 0);
    a.yaw = 0x4000;                    // -x in the port's world convention
    MarkActorShot(a, 0, 0);
    MouseBranchTriggerUpdate(a);
    check("the shot writes the route and starts the flight",
          G.g_script_branch_var === 1 && a.mouse.state === MouseState.Pause,
          `var ${G.g_script_branch_var} state ${a.mouse.state}`);
    MouseBranchTriggerUpdate(a);
    check("...which resolves to subtype 3's own arm",
          a.mouse.state === MouseState.FleeSubtype3, String(a.mouse.state));
    const x0 = a.pos.x;
    MouseBranchTriggerUpdate(a);
    check("...and it moves", a.pos.x !== x0, `${x0} -> ${a.pos.x}`);
    a.pos.x = -80;                     // past subtype 3's bound of -87
    MouseBranchTriggerUpdate(a);
    check("...until it passes its bound, and then stops",
          a.mouse.state === MouseState.Stopped, String(a.mouse.state));
  }

  // Each trigger subtype has its own removal flag, tested before the switch.
  {
    const a = triggerScene(SpawnClass.Mouse, { class52: { subtype: 4 } });
    G.g_script_flags[0x22] = 1;
    MouseBranchTriggerUpdate(a);
    check("subtype 4's own script flag takes it away", a.despawned);
    const b = triggerScene(SpawnClass.Mouse, { class52: { subtype: 4 } });
    G.g_script_flags[0x21] = 1;        // subtype 3's, not this one's
    MouseBranchTriggerUpdate(b);
    check("...and another subtype's does not", !b.despawned);
  }

  // The cat answers in block 8 and nowhere else, and it is the only writer in
  // the game that refuses to overwrite an answer already given.
  {
    const a = triggerScene(SpawnClass.SkinnedNpc,
                           { class53: { anim_set: 0, subtype: 2 } });
    G.g_evt_block_index = 3;
    MarkActorShot(a, 0, 0);
    tick(a);
    check("the cat in block 3 writes nothing", G.g_script_branch_var === 0,
          String(G.g_script_branch_var));
    G.g_evt_block_index = 8;
    MarkActorShot(a, 0, 0);
    tick(a);
    check("...and in block 8 it writes 2", G.g_script_branch_var === 2,
          String(G.g_script_branch_var));

    const b = triggerScene(SpawnClass.SkinnedNpc,
                           { class53: { anim_set: 0, subtype: 2 } });
    G.g_evt_block_index = 8;
    G.g_script_branch_var = 1;
    MarkActorShot(b, 0, 0);
    tick(b);
    check("...but it will not overwrite a route already chosen",
          G.g_script_branch_var === 1, String(G.g_script_branch_var));
  }
}

console.log("\nclass 0x41 type 75: the writer of stage 4's flag 20:");
{
  const rng = new Rng(75);
  /** The fixture's type-75 placement, which is stage 4's shape. */
  const PLACEMENT_75 = 0xa400;

  const place75 = () => {
    const pl = T.breakables?.placements?.find((q) => q.at === PLACEMENT_75);
    if (!pl) throw new Error("the type-75 placement is missing");
    const p = PlaceGenericProp(pl, rng);
    G.g_breakable_props.push(p);
    return p;
  };
  const flag20 = () => G.g_script_flags[PROP75_SCRIPT_FLAG] ?? 0;

  // --- the Arcade head, `0x004710D7` -------------------------------------
  //
  // This is the arm the player actually runs, and it is the one a reading
  // that lumped type 75 in with the other Original-Mode-only types would get
  // wrong: those despawn silently, and this one raises the flag first.
  {
    propScene(rng, GameMode.Arcade);
    const p = place75();
    check("type 75 gets its own family, not `Generic`",
          p.family === PropFamily.Type75, PropFamily[p.family]);
    check("...and `PlaceGenericProp` seeds its `+0x2A4` at 0 and not -1",
          p.removeFlag === 0, String(p.removeFlag));
    check("...with flag 20 down before its first frame", flag20() === 0);
    BreakablePropPoolUpdate(rng);
    check("in Arcade it raises g_script_flags[20] on its first frame",
          flag20() === 1, String(flag20()));
    check("...and leaves the pool on that same frame",
          !G.g_breakable_props.some((q) => q.id === p.id),
          `${G.g_breakable_props.length} props left`);
  }

  // --- the unshot step tick, `0x00471120` --------------------------------
  {
    propScene(rng, GameMode.Original);
    G.g_evt_step_index = 1;
    const p = place75();
    BreakablePropPoolUpdate(rng);
    check("in Original Mode its first frame raises nothing",
          flag20() === 0 && G.g_breakable_props.length === 1,
          `${flag20()} / ${G.g_breakable_props.length}`);

    G.g_evt_step_index = 2;
    BreakablePropPoolUpdate(rng);
    check("...nor does the FIRST change of g_evt_step_index",
          flag20() === 0 && G.g_breakable_props.some((q) => q.id === p.id),
          `${flag20()}`);

    // `INC` then `CMP EAX, 0x2` -- an equality on the counter, so it is this
    // one change and no other. A prop that lived longer would not raise it
    // again, which is why the test walks the index rather than the frames.
    G.g_evt_step_index = 3;
    BreakablePropPoolUpdate(rng);
    check("...the SECOND change is the one that raises flag 20",
          flag20() === 1, String(flag20()));
    check("...on the last step its `lifetime_evt_steps` of 2 buys it",
          G.g_breakable_props.some((q) => q.id === p.id),
          "already gone");

    G.g_evt_step_index = 4;
    BreakablePropPoolUpdate(rng);
    check("...and the third change expires it",
          !G.g_breakable_props.some((q) => q.id === p.id),
          `${G.g_breakable_props.length} props left`);
  }

  // --- the shot ride, `0x00471263` ---------------------------------------
  {
    const events = propScene(rng, GameMode.Original);
    let dropX = NaN, dropY = NaN, dropZ = NaN;
    events.on("item.released", (e) => {
      dropX = e.x; dropY = e.y; dropZ = e.z;
    });
    G.g_evt_step_index = 1;
    const p = place75();
    const live = () => G.g_breakable_props.find((q) => q.id === p.id);

    const l = live();
    if (l) BreakablePropTakeShot(l, 0);
    BreakablePropPoolUpdate(rng, events);
    check("a shot puts it on the ride",
          live()?.cuePhase === PropCuePhase.Riding,
          String(live()?.cuePhase));
    check("...and drops its story item at the routine's own literal point",
          Math.abs(dropX - PROP75_DROP_AT[0]) < 1e-3
          && Math.abs(dropY - PROP75_DROP_AT[1]) < 1e-3
          && Math.abs(dropZ - PROP75_DROP_AT[2]) < 1e-3,
          `${dropX},${dropY},${dropZ}`);
    check("...having put its own position straight back afterwards",
          Math.abs((live()?.x ?? 0) - 121.8) < 1e-3,
          `${live()?.x}`);
    check("...with the flag still down on the frame of the shot",
          flag20() === 0, String(flag20()));

    // The cursor was stepped once on the frame of the shot, so 289 more
    // reach 290.0 and the arm fires on the last of them.
    for (let i = 0; i < PROP75_RIDE_LENGTH - 2; i++) {
      BreakablePropPoolUpdate(rng, events);
    }
    check(`...still down ${PROP75_RIDE_LENGTH - 1} frames into the ride`,
          flag20() === 0, `${flag20()} at ${live()?.shake}`);
    BreakablePropPoolUpdate(rng, events);
    check("...and raised on the frame the cursor reaches "
          + `${PROP75_RIDE_LENGTH}`,
          flag20() === 1 && live()?.cuePhase === PropCuePhase.Done,
          `${flag20()} phase ${live()?.cuePhase}`);
  }

  // --- the declaration, and why it is per record --------------------------
  //
  // The gate is only honoured because the class says it can open it. A
  // class-wide number would say that of every one of the six stages' 441
  // class-0x41 spawns; this asks the record.
  {
    propScene(rng, GameMode.Original);
    check("the placer declares flag 20 for the record that places a type 75",
          PropContainerRaisesScriptFlag(
            { class: 0x41, hp: 0, at: PLACEMENT_75 }) === PROP75_SCRIPT_FLAG,
          String(PropContainerRaisesScriptFlag(
            { class: 0x41, hp: 0, at: PLACEMENT_75 })));
    check("...and nothing for a record that places a group",
          PropContainerRaisesScriptFlag(
            { class: 0x41, hp: 0, at: 0xa100 }) === undefined);
    check("...and nothing for a `spawn_simple` record, which has no address",
          PropContainerRaisesScriptFlag({ class: 0x41, hp: 0 }) === undefined);
    check("...and the type it keys on is the engine's own 75",
          PROP75_TYPE === 75 && GENERIC_DRAW_SLOT[PROP75_TYPE] === 0xa6b,
          String(GENERIC_DRAW_SLOT[PROP75_TYPE]));
  }

  // --- and therefore: the gate stops being excused -------------------------
  {
    propScene(rng, GameMode.Original);
    const spawnOp = (at: number) => ({
      i: 0, at: 0, op: 0x09, name: "spawn_placed", cat: "spawn",
      spawns: [{ at, class: 0x41, flags: 0, pos: [0, 0, 0],
                 yaw_deg: 0, orient: [0, 0, 0], hp: 2, desc_flags: 0 }],
    });
    const gateScript = (at: number) => ({
      scene: 0, stage: 4, game_mode: 0, evt_file: "test", entry_block: 0,
      entry_step: 0, routes: [{ kind: "end", next: [-1, -1, -1] }],
      regions: [], cam_slots_used: [], warnings: [],
      blocks: [{
        index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
        steps: [{ index: 0, at: 0, ops: [
          spawnOp(at),
          { i: 1, at: 8, op: 0x45, arg: PROP75_SCRIPT_FLAG,
            flag: PROP75_SCRIPT_FLAG, name: "wait_script_flag", cat: "wait",
            blocks_on: "script flag 20 set" },
        ] }],
      }],
    } as unknown as ScriptJson);

    check("a bundle that places the type-75 prop CAN raise flag 20",
          ScriptFlagsThisBundleCanRaise(gateScript(PLACEMENT_75))
            .has(PROP75_SCRIPT_FLAG),
          [...ScriptFlagsThisBundleCanRaise(gateScript(PLACEMENT_75))]
            .join(","));
    check("...and one whose class-0x41 spawn is a group cannot",
          !ScriptFlagsThisBundleCanRaise(gateScript(0xa100))
            .has(PROP75_SCRIPT_FLAG),
          [...ScriptFlagsThisBundleCanRaise(gateScript(0xa100))].join(","));
  }
}

console.log("\nthe branch writers: every route the game can choose:");
{
  const rng = new Rng(88);

  /** One generic prop of `type`, carrying `word` as its `+0x11C`. */
  const genericProp = (type: number, word: number) => {
    const p = PlaceGenericProp({ at: 0x1000 + type, container: "generic",
                                 type, slot: word,
                                 lifetime_evt_steps: word, pos: [0, 0, 0] },
                               rng);
    G.g_breakable_props.push(p);
    return p;
  };
  const hitAndTick = (p: { id: number }) => {
    const live = G.g_breakable_props.find((q) => q.id === p.id);
    if (!live) return;
    BreakablePropTakeShot(live, 0);
    BreakablePropPoolUpdate(rng);
  };

  // Types 14 and 19: the constructor seeds the DEFAULT route from the
  // descriptor and the first hit writes the other one. That pairing is the
  // whole mechanism, and reading either half alone makes it look like two
  // unrelated writes to the same global.
  for (const type of [0x0e, 0x13]) {
    propScene(rng, GameMode.Arcade);
    const p = genericProp(type, 0);
    check(`type ${type.toString(16)} seeds the branch from the descriptor`,
          G.g_script_branch_var === 0, String(G.g_script_branch_var));
    hitAndTick(p);
    check(`...and the first shot writes 1 - the descriptor`,
          G.g_script_branch_var === 1, String(G.g_script_branch_var));

    propScene(rng, GameMode.Arcade);
    const q = genericProp(type, 1);
    check(`...so a descriptor of 1 defaults the other way`,
          G.g_script_branch_var === 1, String(G.g_script_branch_var));
    hitAndTick(q);
    check(`...and its shot writes 0`,
          G.g_script_branch_var === 0, String(G.g_script_branch_var));
  }

  // Type 25 has a block gate, and it is the difference between it and the two
  // above. Its one shipped spawn stands in block 0x17 and nowhere else.
  {
    propScene(rng, GameMode.Arcade);
    const p = genericProp(0x19, 0);
    G.g_evt_block_index = 0x16;
    hitAndTick(p);
    check("type 25 in the wrong block writes nothing",
          G.g_script_branch_var === 0, String(G.g_script_branch_var));
    G.g_evt_block_index = 0x17;
    hitAndTick(p);
    check("...and in block 0x17 it writes 1",
          G.g_script_branch_var === 1, String(G.g_script_branch_var));
  }

  // Type 40 takes BOTH of its sub-kind-9 pair, and the counter that agrees
  // them is a global rather than a field.
  {
    propScene(rng);
    const pair = PlaceFragmentProps({ at: 0x2000, container: "fragment",
                                      sub_kind: 9, lifetime_evt_steps: 9,
                                      pos: [0, 0, 0] });
    G.g_breakable_props.push(...pair);
    check("the sub-kind 9 placement builds two, from g_class41_fragment_counts",
          pair.length === 2, String(pair.length));
    check("...and zeroes the shared counter",
          G.g_branch_prop_shot_count === 0,
          String(G.g_branch_prop_shot_count));
    G.g_script_flags[0x11] = 1;
    hitAndTick(pair[0]);
    check("one of the pair is not enough", G.g_script_branch_var === 0,
          `var ${G.g_script_branch_var} count ${G.g_branch_prop_shot_count}`);
    hitAndTick(pair[1]);
    // The count is tested at the top of the routine and the hit at the bottom,
    // so the route opens on the frame AFTER the second break.
    BreakablePropPoolUpdate(rng);
    check("...and both of them are", G.g_script_branch_var === 2,
          `var ${G.g_script_branch_var} count ${G.g_branch_prop_shot_count}`);
    check("...and the counter latches at -1 so it opens once",
          G.g_branch_prop_shot_count === -1,
          String(G.g_branch_prop_shot_count));
  }

  // The chain: twenty links, one latch, and it lives on segment 0.
  {
    propScene(rng);
    G.g_evt_block_index = 0x16;
    const links = PlaceChainSegments({ at: 0x3000, container: "chain",
                                       chain_group: 1, lifetime_evt_steps: 9,
                                       pos: [0, 0, 0] });
    G.g_breakable_props.push(...links);
    check("a chain is twenty segments", links.length === 0x14,
          String(links.length));
    hitAndTick(links[7]);
    check("shooting any link opens the route", G.g_script_branch_var === 2,
          String(G.g_script_branch_var));
    G.g_script_branch_var = 0;
    hitAndTick(links[3]);
    check("...and a second link does not, because the latch is segment 0's",
          G.g_script_branch_var === 0, String(G.g_script_branch_var));
  }

  // ...and the chain's trigger group is not built at all in arcade.
  {
    propScene(rng, GameMode.Arcade);
    const links = PlaceChainSegments({ at: 0x3000, container: "chain",
                                       chain_group: 1, lifetime_evt_steps: 9,
                                       pos: [0, 0, 0] });
    check("arcade never builds chain group 1", links.length === 0,
          String(links.length));
    const other = PlaceChainSegments({ at: 0x3001, container: "chain",
                                       chain_group: 0, lifetime_evt_steps: 9,
                                       pos: [0, 0, 0] });
    check("...but it builds the others", other.length === 0x14,
          String(other.length));
  }

  // The story-mode switch: a scene-and-block table, a script flag, and a key.
  {
    propScene(rng);
    G.g_scene_index = 1;
    G.g_evt_block_index = 3;
    const sw = PlaceStoryModeSwitch({ at: 0x4000, container: "story_switch",
                                      lifetime_evt_steps: 1, branch_flag: 114,
                                      remove_flag: 62, keys: [-1, -1, -1, -1],
                                      pos: [0, 0, 0] });
    G.g_breakable_props.push(sw);
    hitAndTick(sw);
    check("the switch opens scene 1 block 3", G.g_script_branch_var === 2,
          String(G.g_script_branch_var));
    G.g_script_branch_var = 0;
    BreakablePropPoolUpdate(rng);
    check("...once: `+0x2A0` goes to -1 with the route",
          G.g_script_branch_var === 0 && sw.storyItem === -1,
          `var ${G.g_script_branch_var} flag ${sw.storyItem}`);

    propScene(rng);
    G.g_scene_index = 1;
    G.g_evt_block_index = 2;                       // not in the table
    const sw2 = PlaceStoryModeSwitch({ at: 0x4001, container: "story_switch",
                                       lifetime_evt_steps: 1, branch_flag: 114,
                                       remove_flag: 62, keys: [-1, -1, -1, -1],
                                       pos: [0, 0, 0] });
    G.g_breakable_props.push(sw2);
    hitAndTick(sw2);
    check("...and a block the table does not name writes nothing",
          G.g_script_branch_var === 0, String(G.g_script_branch_var));

    // A switch that names a key is not thrown by a shot alone.
    propScene(rng);
    G.g_scene_index = 1;
    G.g_evt_block_index = 3;
    const keyed = PlaceStoryModeSwitch({ at: 0x4002, container: "story_switch",
                                        lifetime_evt_steps: 1,
                                        branch_flag: 115, remove_flag: 116,
                                        keys: [0, 2, 5, 6], pos: [0, 0, 0] });
    G.g_breakable_props.push(keyed);
    hitAndTick(keyed);
    check("a keyed switch refuses a player carrying nothing",
          G.g_script_branch_var === 0, String(G.g_script_branch_var));
    G.g_original_item_slots[0] = [5, -1];
    hitAndTick(keyed);
    check("...and opens for one carrying item 5", G.g_script_branch_var === 2,
          String(G.g_script_branch_var));
  }

  // The switch's own removal flag, which is its lifetime -- `+0x11C` is a
  // literal 1 for this object and counting against it would retire every
  // switch in the game one step boundary after it was placed.
  {
    propScene(rng);
    G.g_scene_index = 1;
    const sw = PlaceStoryModeSwitch({ at: 0x4003, container: "story_switch",
                                      lifetime_evt_steps: 1, branch_flag: 114,
                                      remove_flag: 62, keys: [-1, -1, -1, -1],
                                      pos: [0, 0, 0] });
    G.g_breakable_props.push(sw);
    G.g_evt_step_index += 1;
    BreakablePropPoolUpdate(rng);
    BreakablePropPoolUpdate(rng);
    check("a step boundary does not retire a story switch", !sw.dead);
    G.g_script_flags[62] = 1;
    BreakablePropPoolUpdate(rng);
    check("...its own removal flag does", sw.dead);
  }

  // `g_script_flags[0x15]`, which the switch's HEAD raises -- `0x00474FA6`,
  // before the `CMP g_GameMode, 1` at `0x00474FB4`. Stage 3's block 2 step 3
  // is `wait_script_flag 0x15` and on the block-7 -> block-8 route nothing
  // else in the stage sets it, so with this write missing the stage parked on
  // that instruction for ever. Every arm of the engine's `if`/`else if` is
  // here, because the one that made the bug invisible is the `else`.
  {
    const [SCENE, BLOCK] = STORY_SWITCH_FLAG_AT;
    const flag = () => G.g_script_flags[STORY_SWITCH_SCRIPT_FLAG] ?? 0;
    /** Stage 3's own switch: evt `0x3630`, removal flag 22, keyed on 0 and 6. */
    const place = () => {
      const p = PlaceStoryModeSwitch({
        at: 0x4004, container: "story_switch", lifetime_evt_steps: 1,
        branch_flag: -1, remove_flag: 22, keys: [0, 0, 6, 6],
        pos: [0, 0, 0] });
      G.g_breakable_props.push(p);
      return p;
    };

    propScene(rng, GameMode.Arcade);
    G.g_scene_index = SCENE;
    G.g_evt_block_index = BLOCK;
    const sw = place();
    check("the switch's flag is down before its first frame", flag() === 0);
    BreakablePropPoolUpdate(rng);
    check("in scene 2 block 2 the switch raises g_script_flags[0x15] "
          + "IN ARCADE -- the write is before the mode gate",
          flag() === 1, String(flag()));
    check("...and it is still standing: this is the head, not a despawn",
          !sw.dead);

    // The mode gate is below the write, so Original Mode raises it too.
    propScene(rng, GameMode.Original);
    G.g_scene_index = SCENE;
    G.g_evt_block_index = BLOCK;
    place();
    BreakablePropPoolUpdate(rng);
    check("...and in Original Mode as well", flag() === 1, String(flag()));

    // `g_evt_block_index == 2` is the whole of the block test; the switch
    // stands in stage 3's blocks 7 and 8 first and must write nothing there.
    propScene(rng, GameMode.Arcade);
    G.g_scene_index = SCENE;
    G.g_evt_block_index = 8;
    place();
    BreakablePropPoolUpdate(rng);
    check("a block the head does not name raises nothing", flag() === 0,
          String(flag()));

    // The `else`: scene 1 takes the despawn arm and never reaches the write,
    // which is why five of the twelve switches in the game are in blocks that
    // would otherwise match.
    propScene(rng, GameMode.Arcade);
    G.g_scene_index = 1;
    G.g_evt_block_index = BLOCK;
    place();
    BreakablePropPoolUpdate(rng);
    check("scene 1 is the OTHER arm of the same `if` and raises nothing",
          flag() === 0, String(flag()));

    // `obj+0x192 == 0` -- unthrown. A thrown switch hands the flag to the
    // second write, behind the mode gate and the item spawn, which is not
    // ported: see `StoryModeSwitchUpdate`.
    propScene(rng, GameMode.Arcade);
    G.g_scene_index = SCENE;
    G.g_evt_block_index = BLOCK;
    const thrown = place();
    thrown.branchLatched = true;
    BreakablePropPoolUpdate(rng);
    check("a thrown switch stops raising it", flag() === 0, String(flag()));

    // ...and the removal flag still wins, because it is tested first.
    propScene(rng, GameMode.Arcade);
    G.g_scene_index = SCENE;
    G.g_evt_block_index = BLOCK;
    const gone = place();
    G.g_script_flags[22] = 1;
    BreakablePropPoolUpdate(rng);
    check("its removal flag is tested BEFORE the write, and takes it away",
          gone.dead && flag() === 0, `${gone.dead} / ${flag()}`);
  }

  // Original Mode only, every one of them. Arcade reaches types 14, 19 and 25
  // and nothing else in this file.
  {
    propScene(rng, GameMode.Arcade);
    G.g_evt_block_index = 9;
    const p = genericProp(0x38, 0);
    G.g_script_flags[0x05] = 1;
    hitAndTick(p);
    check("type 56 writes nothing in arcade", G.g_script_branch_var === 0,
          String(G.g_script_branch_var));

    propScene(rng);
    G.g_evt_block_index = 9;
    const q = genericProp(0x38, 0);
    G.g_script_flags[0x05] = 1;
    hitAndTick(q);
    check("...and 2 in original mode, on the flag rather than the shot",
          G.g_script_branch_var === 2, String(G.g_script_branch_var));
  }
}

console.log("\nclass 0x44 selector 0, the effect the script flag plays:");
{
  const rng = new Rng(0x44);
  const PL = BREAKABLES.placements.find(
    (q) => q.container === "script_flag_effect")!;
  const build = () => PropBuildScriptFlagEffect(
    PL.at, PL.effect!, PL.capture_bone!, PL.motion!);
  /**
   * The one prop the effect places, or a dead stand-in.
   *
   * A stand-in rather than a throw because the failure this guards is
   * "the exporter emitted nothing", and a `TypeError` out of the harness ends
   * the run at the first of a dozen checks instead of reporting them.
   */
  const only = (): BreakableProp =>
    G.g_breakable_props[0] ?? makeBreakableProp(-1, 0, 0);

  // The whole of the bug: the exporter emitted nothing for a class-0x44
  // selector-0 spawn, so nothing was placed and nothing was drawn. This fails
  // without the `effects` block, without the placement and without the
  // builder -- `PropBuildScriptFlagEffect` returns an empty array for all
  // three.
  {
    propScene(rng);
    const made = build();
    check("the placer builds one prop per drawable node", made.length === 1,
          `${made.length} props`);
    check("...and it draws the tree's own slot, not the descriptor's",
          made[0]?.slot === 0x13f5, `0x${(made[0]?.slot ?? 0).toString(16)}`);
    check("...seated at motion 471 key 0 rather than at the spawn position",
          made[0]?.x === -13 && made[0]?.z === -362,
          `${made[0]?.x}, ${made[0]?.y}, ${made[0]?.z}`);
  }

  // `if (g_script_flags[0x12] && cursor < play_length - 2) cursor++`.
  {
    propScene(rng);
    const events = new Events();
    G.g_breakable_props.push(...build());
    const p = only();
    for (let i = 0; i < 3; i++) ScriptFlagEffectUpdate(p, events);
    check("the clip does not run with the flag down", p.effectFrames === 0,
          String(p.effectFrames));

    G.g_script_flags[ScriptFlagEffectFlag.Advance] = 1;
    ScriptFlagEffectUpdate(p, events);
    check("the flag starts it", p.effectFrames === 1, String(p.effectFrames));
    // An odd cursor is half way between key 0 and key 1: x from -13 to -3,
    // and the yaw from 0 to 0x4000.
    check("...an odd cursor blends half way to the next key",
          p.x === -8 && p.yaw === 0x2000, `${p.x} yaw ${p.yaw}`);
    ScriptFlagEffectUpdate(p, events);
    check("...and an even one sits on the key",
          p.effectFrames === 2 && p.x === -3 && p.yaw === 0x4000,
          `${p.effectFrames}: ${p.x} yaw ${p.yaw}`);

    // `play_length - 2` is 4 for this fixture, so the cursor stops there and
    // the clip holds its last pose rather than looping.
    for (let i = 0; i < 20; i++) ScriptFlagEffectUpdate(p, events);
    check("...the cursor stops two short of the play length",
          p.effectFrames === 4, String(p.effectFrames));
  }

  // The cue list: `cues[cursor] == obj+0x32C`, equality, and the cursor
  // wraps at the table's -1.
  {
    propScene(rng);
    const events = new Events();
    let sounds = 0;
    events.on("sound.play", (d) => {
      if (d.id === SFX_SCRIPT_FLAG_EFFECT) sounds++;
    });
    G.g_breakable_props.push(...build());
    const p = only();
    G.g_script_flags[ScriptFlagEffectFlag.Advance] = 1;
    for (let i = 0; i < 10; i++) ScriptFlagEffectUpdate(p, events);
    check("both cue frames play the effect's sound", sounds === 2,
          `${sounds} plays`);
    check("...and a parked cursor does not play it again",
          p.effectFrames === 4 && sounds === 2, `${sounds} plays`);
  }

  // `g_script_flags[0x13]` is the whole lifetime, and it is tested first.
  {
    propScene(rng);
    G.g_breakable_props.push(...build());
    const p = only();
    G.g_script_flags[ScriptFlagEffectFlag.Remove] = 1;
    ScriptFlagEffectUpdate(p);
    check("the removal flag despawns it", p.dead);
  }

  // The shortest way round, which is the engine's own u16 fold.
  check("a BAMS blend takes the short way round",
        BamsHalfway(0xf000, 0x1000) === 0x10000 && BamsHalfway(0, 0x8000) === 0x4000,
        `${BamsHalfway(0xf000, 0x1000)}, ${BamsHalfway(0, 0x8000)}`);
}

console.log("\nprops are shot by a sphere, not by the model they draw:");
{
  const rng = new Rng(77);

  // A generic prop that draws NOTHING. Type 25's routine has no static model
  // at all -- `GENERIC_DRAW_SLOT[25]` is null -- and the engine still gives it
  // a radius of 12 and registers it every frame. It was the only branch in
  // arcade mode the port could not reach, for exactly that reason.
  {
    propScene(rng, GameMode.Arcade);
    const p = PlaceGenericProp({ at: 0x9000, container: "generic", type: 0x19,
                                 slot: 0, lifetime_evt_steps: 0,
                                 pos: [10, 0, -5] }, rng);
    G.g_breakable_props.push(p);
    check("a prop with no model still gets its radius", p.hitRadius === 12,
          String(p.hitRadius));
    BreakablePropPoolUpdate(rng);
    check("...and publishes a sphere", p.shotRegistered);
    check("...12 units above its own origin, which is where the routine puts it",
          p.shotX === 10 && p.shotY === 12 && p.shotZ === -5,
          `${p.shotX}/${p.shotY}/${p.shotZ}`);

    // `obj+0x34 |= 0x44000000` -- bit 26 takes it out of the shot test for
    // good, which is why its route can only ever be opened once.
    p.flags |= 0x04000000;
    BreakablePropPoolUpdate(rng);
    check("...until one scoring hit sets bit 26, and then never again",
          !p.shotRegistered);
  }

  // The offsets are per type and they are not all up. Type 7 registers 57
  // units BELOW its origin; type 20 one unit below; type 57 ignores its
  // position and registers a fixed world point.
  {
    const at = (type: number) => {
      propScene(rng, GameMode.Arcade);
      const p = PlaceGenericProp({ at: 0x9100 + type, container: "generic",
                                   type, slot: 0, lifetime_evt_steps: 0,
                                   pos: [0, 100, 0] }, rng);
      G.g_breakable_props.push(p);
      BreakablePropPoolUpdate(rng);
      return p;
    };
    check("type 7 registers 57 units below its origin", at(7).shotY === 43,
          String(at(7).shotY));
    check("type 20 registers one unit below", at(20).shotY === 99,
          String(at(20).shotY));
    const t57 = at(57);
    check("type 57 ignores its position for a fixed world point",
          Math.abs(t57.shotX - -697.042) < 1e-3 && t57.shotY !== 100,
          `${t57.shotX}/${t57.shotY}/${t57.shotZ}`);
    // Type 74's rise is a function of its own radius: `r * 0.5 - 2`.
    check("type 74's rise comes from its own radius", at(74).shotY === 100 + 2.5,
          String(at(74).shotY));
  }

  // The group props: half a stack level up while standing, the raw origin once
  // they are falling, and out of the test entirely once removed.
  {
    propScene(rng);
    PlaceBreakableGroup(1, 4, rng);
    const p = G.g_breakable_props[0];
    p.x = 0; p.y = 0; p.z = 0;
    BreakablePropPoolUpdate(rng);
    check("a standing group prop registers half a stack level up",
          Math.abs(p.shotY - 3.770148) < 1e-5, String(p.shotY));
    check("...with the radius PlaceBreakableGroup gives every member",
          p.hitRadius === 5, String(p.hitRadius));
    p.state = BreakableState.Falling;
    BreakablePropPoolUpdate(rng);
    // Its own y, whatever the fall has done to it this frame -- the rise is
    // assigned only inside the standing arm, so a falling prop loses it.
    check("...its raw origin once it is falling", p.shotY === p.y,
          `${p.shotY} vs ${p.y}`);
    p.state = BreakableState.Removed;
    BreakablePropPoolUpdate(rng);
    check("...and nothing at all once it is removed", !p.shotRegistered);
  }

  // The list is rebuilt every frame, which is what makes a prop that returned
  // early unshootable for exactly as long as the engine makes it.
  {
    propScene(rng);
    PlaceBreakableGroup(1, 4, rng);
    const p = G.g_breakable_props[0];
    BreakablePropPoolUpdate(rng);
    check("a prop is in the list after its own frame", p.shotRegistered);
    ClearPropShotTestList();
    check("...and out of it the moment the list is cleared", !p.shotRegistered);
  }

  // The chain's twenty links are twenty spheres, dropping 1.5 apiece. Placing
  // them all at the anchor would make one link out of twenty.
  {
    propScene(rng);
    const links = PlaceChainSegments({ at: 0x9200, container: "chain",
                                       chain_group: 0, lifetime_evt_steps: 9,
                                       pos: [0, 0, 0] });
    check("each link hangs 1.5 below the one above it",
          Math.abs(links[0].y - -1.5) < 1e-6
          && Math.abs(links[19].y - -30.0) < 1e-6,
          `${links[0].y} .. ${links[19].y}`);
    check("...and each carries its own 2.0 sphere", links[7].hitRadius === 2,
          String(links[7].hitRadius));
  }

  // The fragment pair is two objects 41.683 apart, not two in one place.
  {
    propScene(rng);
    const pair = PlaceFragmentProps({ at: 0x9300, container: "fragment",
                                      sub_kind: 9, lifetime_evt_steps: 9,
                                      pos: [0, 0, 0] });
    G.g_breakable_props.push(...pair);
    check("sub-kind 9's pair is placed apart, from the engine's own table",
          Math.abs(pair[1].x - pair[0].x - 41.683) < 1e-2,
          `${pair[0].x} and ${pair[1].x}`);
    BreakablePropPoolUpdate(rng);
    check("...and each registers 8 units up, which its draw slot decides",
          Math.abs(pair[0].shotY - (pair[0].y + 8.0)) < 1e-5,
          String(pair[0].shotY));
    check("...at 5.5 apiece", pair[0].hitRadius === 5.5,
          String(pair[0].hitRadius));
    // `obj+0x1B9` -- one shot ends it for ever.
    pair[0].branchLatched = true;
    BreakablePropPoolUpdate(rng);
    check("...until one is broken, and then that one is out of the test",
          !pair[0].shotRegistered && pair[1].shotRegistered);
  }
}

console.log("\nclass 0x41 type 32, the lift:");
{
  const rng = new Rng(41);
  const events = propScene(rng);
  const sounds: number[] = [];
  events.on("sound.play", (e) => sounds.push(e.id));
  const gate = PlaceGenericProp(
    { at: 0xbdc0, container: "generic", type: 32, slot: 2,
      lifetime_evt_steps: 2, pos: [-825.1, 40, -1871.7],
      pitch: 0, yaw: 0, roll: 0 }, rng);
  G.g_breakable_props.push(gate);

  check("it is its own family, not a drawn-only generic prop",
        gate.family === PropFamily.Lift);
  check("and the constructor seeds the three hinges at rest",
        gate.yaw === LIFT_NEAR_CLOSED && gate.hingeB === LIFT_FAR_CLOSED
        && gate.pitch === LIFT_PANEL_CLOSED);
  check("the car it draws is komono_suimon slot 0x197A, not the `slot` 2 "
        + "the descriptor carries", GENERIC_DRAW_SLOT[32] === 0x197a);

  // No flag up: nothing moves. This is the whole point of the routine --
  // every motion waits on the script.
  for (let i = 0; i < 120; i++) LiftUpdate(gate, events);
  check("with no script flag raised nothing moves at all",
        gate.yaw === LIFT_NEAR_CLOSED && gate.hingeB === LIFT_FAR_CLOSED
        && gate.pitch === LIFT_PANEL_CLOSED && gate.y === 40
        && sounds.length === 0);

  // Flag 0x37: the gate rides fifteen under the camera's eye.
  G.g_camera_block_eye.y = 100;
  G.g_script_flags[LiftFlag.RideCamera] = 1;
  LiftUpdate(gate, events);
  check("flag 0x37 hangs the car floor fifteen under the camera eye",
        gate.y === 100 - LIFT_RIDE_DROP, String(gate.y));

  // Flag 0x6B: the near pair swings 0x4000 -> 0x8000 at 0x200 a frame, so 32
  // frames exactly, and the door sound fires on the first of them only.
  G.g_script_flags[LiftFlag.OpenNear] = 1;
  sounds.length = 0;
  LiftUpdate(gate, events);
  check("the leaves' door sound fires on the first frame of the swing",
        sounds.length === 1 && sounds[0] === SFX_LIFT_GATE);
  for (let i = 1; i < 32; i++) LiftUpdate(gate, events);
  check("32 frames take the near pair exactly to its open angle",
        gate.yaw === LIFT_NEAR_OPEN, gate.yaw.toString(16));
  for (let i = 0; i < 60; i++) LiftUpdate(gate, events);
  // The engine's test is `< limit + 1`, so the frame that finds the hinge
  // exactly *at* its limit still adds a step: every one of these angles comes
  // to rest one 0x200 past the round number, and then stops.
  check("and it comes to rest one step past that and stays there",
        gate.yaw === LIFT_NEAR_OPEN + LIFT_HINGE_STEP,
        gate.yaw.toString(16));
  check("the door sound does not repeat",
        sounds.filter((x) => x === SFX_LIFT_GATE).length === 1);

  // The panel is not on a flag of its own: it waits on the frames flag 0x6B
  // has been up, which is `obj+0x2A0`.
  check("the overhead panel swung once the near pair had been folding for "
        + "0x27 frames", gate.pitch === LIFT_PANEL_OPEN + LIFT_HINGE_STEP,
        gate.pitch.toString(16));
  check("its own sound fired once", sounds.filter(
    (x) => x === SFX_LIFT_PANEL).length === 1);
  check("and 0x2A0 counted every frame the flag was up, not just the moving "
        + "ones", gate.storyItem === 1 + 31 + 60);

  // Flag 0x6C is independent: the far pair has not moved yet.
  check("the far pair has not moved -- its flag is still down",
        gate.hingeB === LIFT_FAR_CLOSED);
  G.g_script_flags[LiftFlag.OpenFar] = 1;
  LiftUpdate(gate, events);
  check("and it starts from 0x8000 the moment flag 0x6C goes up",
        gate.hingeB === LIFT_FAR_CLOSED + LIFT_HINGE_STEP);

  // The lifetime prologue still runs: three step changes, and it is gone.
  for (let b = 1; b <= 3; b++) {
    G.g_evt_step_index = b;
    LiftUpdate(gate, events);
  }
  check("and it expires on its two-step lifetime like any other prop",
        gate.dead);
  void LIFT_PANEL_DELAY;
}

console.log("\nclass 0x44 selector 11, the door that slides up:");
{
  const rng = new Rng(61);
  propScene(rng);
  // Stage 3's descriptor, exactly: evt 0x23F4, slot 0xA58 = etc_door.bin[2],
  // open flag 6, remove flag 11, at the mouth block 8's zombies come out of.
  const door = PropBuildRisingDoor(
    { at: 0x23f4, container: "rising_door", slot: RISING_DOOR_RATTLE_SLOT,
      open_flag: 6, remove_flag: 11, lifetime_evt_steps: 0,
      pos: [-356.6, -16.1, -3047.8], yaw: 0 });
  G.g_breakable_props.push(door);

  check("it is its own family, not a hinge and not a generic prop",
        door.family === PropFamily.RisingDoor);
  check("the descriptor's tail names the model, the open flag and the "
        + "remove flag",
        door.slot === 0xa58 && door.storyItem === 6 && door.removeFlag === 11);

  // No flag: it holds its placed Y for ever. `wait_enemies_alive` at stage 3
  // block 8 step 2 op 23 is 600-odd frames after the block starts, so a door
  // that crept would be visibly wrong by then.
  for (let i = 0; i < 600; i++) RisingDoorUpdate(door);
  check("with neither flag raised it never moves",
        door.y === -16.1 && door.vy === 0 && !door.dead);
  check("but it rattles while it waits, and reseeds its own amplitude",
        door.shake > 0);

  // Flag 6, which is what op 16 of that step sets. Speed starts at 0.5 and
  // gains 0.1 a frame, so the first frame moves it 0.6.
  G.g_script_flags[6] = 1;
  RisingDoorUpdate(door);
  check("the first frame of the rise seeds the speed at 0.5 and then steps it",
        Math.abs(door.vy - 0.6) < 1e-6 && Math.abs(door.y - -15.5) < 1e-6,
        `${door.vy} ${door.y}`);
  check("and the latch means the speed is seeded once, not every frame",
        door.cueCursorB === 1);

  let frames = 1;
  while (door.y < RISING_DOOR_CEILING && frames < 1000) {
    RisingDoorUpdate(door);
    frames++;
  }
  // v = 0.5 + 0.1k, y = -16.1 + 0.05k^2 + 0.55k: k = 22 is the first that
  // reaches 20.0 (36.3 of the 36.1 it has to climb), k = 21 falls short.
  check("slot 0xA58's arm clears its 20.0 ceiling from y = -16.1 in 22 "
        + "frames", frames === 22, String(frames));
  const held = door.y;
  for (let i = 0; i < 300; i++) RisingDoorUpdate(door);
  check("past the ceiling it stops writing Y rather than clamping to it -- "
        + "so it holds one frame's worth ABOVE 20, not 20",
        door.y === held && held > RISING_DOOR_CEILING, String(held));

  // Flag 11 is the last op of that step, and it is `ActorKill` and not a hide.
  G.g_script_flags[11] = 1;
  RisingDoorUpdate(door);
  check("the remove flag kills it outright", door.dead);
}

console.log("\nclass 0x44 selector 11, stage 5's door takes the other arm:");
{
  const rng = new Rng(62);
  propScene(rng);
  // Stage 5's descriptor: evt 0x0C2C, slot 0x189A = st5.bin[9], flags 2 and 7.
  const door = PropBuildRisingDoor(
    { at: 0x0c2c, container: "rising_door", slot: 0x189a,
      open_flag: 2, remove_flag: 7, lifetime_evt_steps: 0,
      pos: [275.4, 12.0, -89.6], yaw: 0 });
  G.g_breakable_props.push(door);

  // `CMP word ptr [ESI+0x28C], 0xA58` decides both the rattle and the pair.
  check("a slot that is not 0xA58 does not rattle at all",
        !RisingDoorRattles(door.slot));
  for (let i = 0; i < 200; i++) RisingDoorUpdate(door);
  check("...and its amplitude is never seeded", door.shake === 0);
  check("it takes the 35.0 / 0.01 arm",
        RisingDoorRise(door.slot)[0] === RISING_DOOR_CEILING_OTHER
        && RisingDoorRise(door.slot)[1] === RISING_DOOR_STEP_OTHER);

  G.g_script_flags[2] = 1;
  let frames = 0;
  while (door.y < RISING_DOOR_CEILING_OTHER && frames < 1000) {
    RisingDoorUpdate(door);
    frames++;
  }
  // A hundredth a frame rather than a tenth. It has less to climb -- 23
  // against 36.1 -- and still takes half again as long, because the engine
  // names one slot and not a speed.
  check("the slower arm takes 35 frames to clear 35.0 from y = 12",
        frames === 35, String(frames));
  check("and there is no lifetime on this family -- step changes do not "
        + "retire it", (() => {
          for (let b = 1; b <= 20; b++) {
            G.g_evt_step_index = b;
            RisingDoorUpdate(door);
          }
          return !door.dead;
        })());
}

console.log("\nclass 0x41, four types take their lifetime from +0x1F4:");
{
  const rng = new Rng(63);
  propScene(rng);
  // The stage 5 van body, exactly: type 51, `+0x11C` = 0x1793 (the model) and
  // `desc+0x24` = 4 (the lifetime). Reading the first as both is what gave it
  // 6035 event steps in a nine-block stage.
  const van = PlaceGenericProp(
    { at: 0x0d3c, container: "generic", type: 51, slot: 0x1793,
      lifetime_evt_steps: 0x1793, field_1f4: 4,
      pos: [280.0, 2.0, -222.3], pitch: 0, yaw: 4915, roll: 0 }, rng);
  G.g_breakable_props.push(van);

  check("type 51 is a descriptor-slot type, so +0x11C really is the model",
        GENERIC_DESCRIPTOR_SLOT.has(51) && van.slot === 0x1793);
  check("and its lifetime is the OTHER field, not that slot",
        GENERIC_LIFETIME_FROM_1F4.has(51) && van.lifetime === 4,
        String(van.lifetime));
  check("the model it draws is the slot and not a literal -- 51 is absent "
        + "from GENERIC_DRAW_SLOT on purpose",
        GENERIC_DRAW_SLOT[51] === undefined);

  for (let b = 1; b <= 4; b++) {
    G.g_evt_step_index = b;
    PropExpireByStepLifetime(van);
  }
  check("four step changes leave it standing", !van.dead);
  G.g_evt_step_index = 5;
  PropExpireByStepLifetime(van);
  check("the fifth retires it -- with the slot as the lifetime it would have "
        + "stood there for the rest of the stage", van.dead);

  // A type NOT in the set still reads the word it always did.
  const other = PlaceGenericProp(
    { at: 0x0e00, container: "generic", type: 20, slot: 1,
      lifetime_evt_steps: 1, field_1f4: 7, pos: [0, 0, 0],
      pitch: 0, yaw: 0, roll: 0 }, rng);
  check("a type outside the set is untouched by this and still reads +0x11C",
        !GENERIC_LIFETIME_FROM_1F4.has(20) && other.lifetime === 1);
}

console.log("\nclass 0x41, a generic prop's +0x11C is a lifetime:");
{
  const rng = new Rng(43);
  const events = propScene(rng);
  // The stage-2 shape: `hp` 1, which is a lifetime of one event *step* and
  // NOT asset slot 1 (`bg_adv10.bin`).
  const p = PlaceGenericProp(
    { at: 0xbe00, container: "generic", type: 20, slot: 1,
      lifetime_evt_steps: 1, pos: [0, 0, 0], pitch: 0, yaw: 0, roll: 0 },
    rng);
  G.g_breakable_props.push(p);
  check("the lifetime is the descriptor's +0x11C", p.lifetime === 1);
  check("and the model is the literal its routine draws, not that number",
        GENERIC_DRAW_SLOT[20] === 0x1e2);
  for (let i = 0; i < 600; i++) PropExpireByStepLifetime(p);
  check("frames alone do not expire it", !p.dead);
  for (let b = 1; b <= 2; b++) {
    G.g_evt_step_index = b;
    PropExpireByStepLifetime(p);
  }
  check("two step advances past a lifetime of one do", p.dead);

  // The bug this replaced, stated so it cannot come back: the counter is the
  // step index, so a prop ages *inside* a block as well as across one. When
  // it was a monotonic per-block counter every prop lived about four times
  // too long -- blocks average 3.99 steps.
  G.g_evt_step_index = 1;                  // placed in block N's first step
  const r = PlaceGenericProp(
    { at: 0xbe80, container: "generic", type: 20, slot: 1,
      lifetime_evt_steps: 1, pos: [0, 0, 0], pitch: 0, yaw: 0, roll: 0 },
    rng);
  PropExpireByStepLifetime(r);
  check("a prop placed in step 1 survives its own step", !r.dead);
  G.g_evt_step_index = 2;                  // still block N, second step
  PropExpireByStepLifetime(r);
  check("...and its lifetime of one carries it one step further", !r.dead);
  G.g_evt_step_index = 3;                  // still block N, third step
  PropExpireByStepLifetime(r);
  check("...but it is gone by step 3, without the block ever changing",
        r.dead);

  // The scene-1 sweep.
  const q = PlaceGenericProp(
    { at: 0xbe40, container: "generic", type: 20, slot: 9,
      lifetime_evt_steps: 9, pos: [0, 0, 0], pitch: 0, yaw: 0, roll: 0 },
    rng);
  G.g_scene_index = 1;
  G.g_script_flags[0x77] = 1;
  PropExpireByStepLifetime(q);
  check("g_script_flags[0x77] clears every prop on scene 1", q.dead);
  G.g_scene_index = 0;
  G.g_script_flags[0x77] = 0;
  void events;
}

console.log("\nclass 0x41, Original Mode's collectibles in Arcade:");
{
  const rng = new Rng(47);
  const events = propScene(rng);
  // `FUN_004675A0`'s first line is `if (g_GameMode != 1) ActorDespawn(obj)`.
  const p = PlaceGenericProp(
    { at: 0xbf00, container: "generic", type: 70, slot: 3,
      lifetime_evt_steps: 3, pos: [0, 0, 0], pitch: 0, yaw: 0, roll: 0 },
    rng);
  G.g_breakable_props.push(p);
  G.g_GameMode = GameMode.Arcade;
  BreakablePropPoolUpdate(rng, events);
  check("an Original-Mode-only type is gone on its first Arcade frame",
        G.g_breakable_props.length === 0);

  const q = PlaceGenericProp(
    { at: 0xbf40, container: "generic", type: 70, slot: 3,
      lifetime_evt_steps: 3, pos: [0, 0, 0], pitch: 0, yaw: 0, roll: 0 },
    rng);
  G.g_breakable_props.push(q);
  G.g_GameMode = GameMode.Original;
  BreakablePropPoolUpdate(rng, events);
  check("and survives in Original Mode", !q.dead);
  check("the set is the four routines that were actually read",
        [...GENERIC_ORIGINAL_MODE_ONLY].sort((a, b) => a - b)
          .join(",") === "70,71,72,77");
  G.g_GameMode = GameMode.Arcade;
}

console.log("\nclass 0x41 type 4, seven of the eleven kinds are effects:");
{
  // `PlaceKindedProp` (`FUN_00462E10`) writes `obj+0x28C = 0xFFFF` and then
  // overrides it for exactly four kinds. The other seven draw
  // `FUN_0040DD90(obj+0x324)` instead — an animated effect, not a model —
  // which is why their spawn markers have nothing under them and why that is
  // the engine's behaviour rather than a missing export.
  check("only kinds 2, 3, 8 and 9 name an asset slot",
        Object.keys(KIND_SLOT).map(Number).sort((a, b) => a - b)
          .join(",") === "2,3,8,9");
  check("and every other kind is left at the engine's 0xFFFF",
        [0, 1, 4, 5, 6, 7, 10].every((k) => (KIND_SLOT[k] ?? SLOT_NONE)
                                            === SLOT_NONE));
}

console.log("\nclass 0x41, Training's one-shot targets:");
{
  const rng = new Rng(53);
  // `g_GameMode == 2`, and 2 is Training. This block is the reason the enum
  // had to be corrected everywhere at once: with `ARCADE = 0` and this case
  // still asking for Arcade, `PlaceBreakableGroup` would take the ordinary
  // path and every assertion below would fail.
  const events = propScene(rng, GameMode.Training);
  G.g_training_lesson = 0;      // members 2, 3, 4 and 6
  const props = PlaceBreakableGroup(1, 4, rng);
  const target = props.find((p) => p.member === 2);
  const plain = props.find((p) => p.member === 0);
  check("the member the target set names takes one shot, not two",
        !!target && target.hp === 1, `hp ${target?.hp}`);
  check("and wears the one-shot model",
        target?.slot === BreakableSlot.OneShotTarget,
        `0x${target?.slot.toString(16)}`);
  check("the members it does not name are ordinary",
        !!plain && plain.hp === 2 && plain.slot === BreakableSlot.Default);

  const before = G.g_player_score[0];
  shoot(target!, 1, rng, events);
  // Note what it does *not* do: `hp` is still 1. A one-shot target is removed
  // outright rather than damaged, so nothing decrements the shot count.
  check("one shot removes it, without spending its hit point",
        target!.state === BreakableState.Removed && target!.hp === 1,
        `hp ${target!.hp} state ${target!.state}`);
  check("and it pays no score", G.g_player_score[0] === before,
        `${G.g_player_score[0]} vs ${before}`);
}


// -- 12. class 0x31, the wall-crawler ---------------------------------------

/**
 * `zstin`'s own tables, cut down to the rows the states read. The numbers are
 * the game's: the arc scripts and hit frames are `g_class31_melee_attacks`
 * row A verbatim, the picks are `g_class31_action_picks` set 0, and 313 is the
 * walk clip whose root motion is the only thing that closes the distance.
 */
const ARC = (motionId: number) => [
  { motion: motionId, start: 0, fade: 5, until: 22 },
  { motion: motionId, start: 23, fade: 5, until: 46 },
  { motion: motionId, start: 47, fade: 0, until: 47 },
];

/**
 * `CLASS31_ARC_SCRIPTS.drop` and its byte-identical twin, verbatim from
 * `0x00564918`: motion 300 cut at 50..55, 56..63 and 64..98.
 */
const DROP_SCRIPT = (motionId: number) => [
  { motion: motionId, start: 50, fade: 0, until: 55 },
  { motion: motionId, start: 56, fade: 0, until: 63 },
  { motion: motionId, start: 64, fade: 5, until: 98 },
];

const TYPE31: CharacterType = {
  ...TYPE,
  type: 0x19, name: "zstin", file: "zstin.bin",
  motions: {
    ...TYPE.motions,
    // The walk that closes, the idle that does not, the landing clip, and one
    // clip per attack and per surface leap.
    "313": motion(13, 2.08), "295": motion(31), "283": motion(16),
    "303": motion(34), "302": motion(36), "284": motion(25),
    "298": motion(30), "299": motion(30),
    "290": motion(23), "291": motion(23), "309": motion(46), "282": motion(41),
    // The reaction row, the airborne clip, the get-up and the death clip.
    "929": motion(20), "930": motion(20), "931": motion(20), "934": motion(50),
    "935": motion(20), "938": motion(20), "939": motion(20),
    "283b": motion(1), "285": motion(50), "287": motion(29),
  },
};

const CLASS31 = {
  sets: [{
    set: 0,
    motions: [295, 295, 313, 313, 283, 934],
    attacks: {
      // Stance 0, the ground: two hands and a head-butt.
      "0": {
        "0": { script: ARC(303), hit_frame: 62, player_motion: 2, cancel_mask: 2 },
        "1": { script: ARC(302), hit_frame: 64, player_motion: 3, cancel_mask: 4 },
        "3": { script: ARC(284), hit_frame: 41, player_motion: 7, cancel_mask: 8 },
      },
      // Stance 1 and 2, the two walls -- a different swing on each.
      "1": {
        "0": { script: ARC(299), hit_frame: 52, player_motion: 2, cancel_mask: 2 },
      },
      "2": {
        "0": { script: ARC(298), hit_frame: 52, player_motion: 2, cancel_mask: 2 },
      },
    },
    // Intact: a coin flip between the two hands.
    attack_picks: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, ...new Array(70).fill(0)],
    state_picks: {
      // Band 1 is the climb, band 2 stands and occasionally pounces.
      "1": [14, 14, 14, 15, 15, 15, 16, 16, 16, 12, ...new Array(70).fill(14)],
      "2": [7, 7, 7, 7, 7, 7, 7, 7, 7, 13, ...new Array(70).fill(7)],
    },
    // `g_class31_hit_reactions` row A, the `szom.bin` one sets 0, 1 and 3 share.
    reactions: [0x3a7, 0x3a3, 0x3a7, 0x3aa, 0x3ab, 0x3a7, 0x3a2, 0x3a1],
  }],
  // The pose a corpse freezes on, by the clip it died in.
  corpse_frames: { "286": [74, 70], "285": [48, 40], "934": [44, 35] },
  scripts: {
    wall_left: ARC(290), wall_right: ARC(291), ceiling: ARC(309),
    aside: ARC(282), aside_attack3: ARC(282), aside_zsass: ARC(282),
    // `ThrowerStateLeapToPoint`'s three. `drop` and `drop_alt` are byte for
    // byte the same in the exe and are the same here, which is what lets the
    // coin flip be asserted as invisible.
    // The exe's own twelve dwords, not `ARC`'s generic shape: the stage
    // thresholds are what the state measures its windup, flight and landing
    // against, and a stand-in with different ones tests a different clip.
    drop: DROP_SCRIPT(300), drop_alt: DROP_SCRIPT(300),
    drop_zskamere: [
      { motion: 439, start: 0, fade: 0, until: 19 },
      { motion: 439, start: 20, fade: 0, until: 31 },
      { motion: 439, start: 32, fade: 0, until: 42 },
    ],
  },
};

/**
 * `g_class31_throws`' own entry, exactly as the exporter writes it — motion 9
 * for bone 5, motion 8 for bone 8, `release_frame` **48**.
 *
 * Shared by the two throwing character types below, and that sharing is the
 * point: 0x16 reads it and 0x18 does not, off the same bytes. An assertion
 * that 0x18 plays 0x1F7 and lets go on 25 is only worth something if the
 * entry it is supposed to be ignoring says something else.
 */
const THROW31_ENTRY = {
  hands: {
    "0": [
      { bone: 5, motion: 9, release_frame: 48, range: 20, player_motion: 6,
        cancel_mask: 2, held: null, bare: 8177, projectile: 8162 },
      { bone: 8, motion: 8, release_frame: 48, range: 20, player_motion: 6,
        cancel_mask: 4, held: null, bare: 8173, projectile: 8161 },
    ],
  },
  spin: 0, speed: 1.2, aim_ahead: 4, aim_side: 0.6,
  stick_frames: 30, blink_frames: 60,
};

/** The entry's own two clips, and the eight the `.text` switch names. */
const THROW31_MOTIONS = {
  "9": motion(40), "8": motion(40),
  // Right hand then left, per stance: ground, WallA, WallB, ceiling.
  "503": motion(40), "502": motion(40),        // 0x1F7, 0x1F6
  "508": motion(40), "507": motion(40),        // 0x1FC, 0x1FB
  "498": motion(40), "497": motion(40),        // 0x1F2, 0x1F1
  "516": motion(40), "515": motion(40),        // 0x204, 0x203
};

/** Character type 0x16, `zsass` — the thrower that *does* read its entry. */
const TYPE31_ZSASS: CharacterType = {
  ...TYPE31,
  type: 0x16, name: "zsass", file: "zsass.bin",
  throw: THROW31_ENTRY,
  motions: { ...TYPE31.motions, ...THROW31_MOTIONS },
};

/** Character type 0x18, `zslman` — the one whose throw ignores its entry. */
const TYPE31_ZSLMAN: CharacterType = {
  ...TYPE31_ZSASS,
  type: 0x18, name: "zslman", file: "zslman.bin",
};

const CHARS31 = {
  ...CHARS,
  types: { "1": TYPE, "22": TYPE31_ZSASS, "24": TYPE31_ZSLMAN, "25": TYPE31 },
  class31: CLASS31,
} as unknown as CharactersJson;

/**
 * A camera at `EYE` looking toward **+Z**, which is where this file's actors
 * stand. `viewPoint` takes a point in camera space, where -Z is forward, so
 * the z term is negated on the way out.
 */
/**
 * A camera at `EYE` looking down **+z in world**, which is where this file
 * stands its actors.
 *
 * `viewSpaceOf` is the exact inverse of `viewPoint`, and it has to be: the
 * knockback arc reads one and writes through the other, so a stub answering
 * only half of the seam tested the formula against nothing. Both are in the
 * engine's own sign, `-z` in front, and neither has an opinion about an actor
 * behind the camera. See `game/host.ts`.
 */
const CAM_HOST = {
  ...NULL_HOST,
  viewPoint: (x: number, y: number, z: number, out: Vec3) => {
    out.x = EYE.x + x; out.y = EYE.y + y; out.z = EYE.z - z;
  },
  viewSpaceOf: (at: number, out: Vec3) => {
    const a = ActorByAt(at);
    if (!a) return false;
    // The tracked point when the renderer has filled one, the origin
    // otherwise — `lookAtOf`'s own fallback.
    const p = (a.lookAt.x || a.lookAt.y || a.lookAt.z) ? a.lookAt : a.pos;
    out.x = p.x - EYE.x;
    out.y = p.y - EYE.y;
    out.z = EYE.z - p.z;                  // `-z` in front, as the engine has it
    return true;
  },
};

/**
 * One `coli/` quad, as a blob the port's own collision can be pointed at.
 *
 * The wall search used to be answered by a stub host that said "yes, there,"
 * which tested the state machine and nothing else. This is a real quad in the
 * real format, so the assertions below go through `ColiSegmentVsMesh`'s plane
 * test, its dominant-axis projection and its winding test — the same code the
 * shipped collision runs.
 */
function coliQuad(plane: [number, number, number, number], axis: number,
                  verts: number[], surface = 52) {
  const xs = [verts[0], verts[3], verts[6], verts[9]];
  const ys = [verts[1], verts[4], verts[7], verts[10]];
  const zs = [verts[2], verts[5], verts[8], verts[11]];
  return {
    min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
    max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)],
    n: 1, plane, verts, axis: [axis], surface: [surface],
  };
}

/** A wall in the plane `x = 30`, forty units tall and eighty deep. */
const WALL_BLOB = coliQuad([-1, 0, 0, 30], 0,
                           [30, -10, 5, 30, -10, 85, 30, 40, 85, 30, 40, 5]);
/**
 * ...and a floor at `y = 0`, which is where this file's actors stand.
 *
 * **Wound the way the game's own floors are**, which is clockwise seen from
 * above: `coli2.bin:13864` quad 0, under stage 2's spawn at
 * (-742, 40.1, -1725), runs `+x, -z, -x, +z`. It matters because the winding
 * test's sign factor is the dominant normal component *negated on Y*, so a
 * floor authored the other way round is rejected. These fixtures were wound
 * counter-clockwise while `coli.ts` had one global polarity and both were
 * wrong together -- the game's data is the arbiter, not the fixture.
 */
const FLOOR_BLOB = coliQuad([0, 1, 0, 0], 1,
                            [-200, 0, 200, 200, 0, 200, 200, 0, -200,
                             -200, 0, -200]);

function thrower(state: number, extra: Record<string, unknown> = {}) {
  ResetGameGlobals();
  SetGameTables(CHARS31);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_player_lives = [PLAYER.start_lives, PLAYER.start_lives];
  // `g_camera_yaw_bams` is the heading *from* the camera *toward* what it
  // looks at -- `ThrowerStateLeapDown` sets the pouncing actor's own yaw from
  // it, and an actor facing the camera carries `VecToAngles(obj - eye)`. This
  // file's actors stand at +Z of an eye at the origin, so that heading is 0.
  G.g_camera_yaw_bams = 0;
  const a = ActorSpawn(0x9000, SpawnClass.Thrower, 0x19, "zstin", {
    initialState: state, condition: 0, ...extra,
  });
  // Narrowing, not a cast. `ActorSpawn` returns the union and class 0x31's
  // routines take the arm, so the fixture has to prove the actor is a thrower
  // the same way the director does -- see `humanoidScene` for class 0x25.
  if (a.cls !== SpawnClass.Thrower) throw new Error("not class 0x31");
  a.visible = true;
  a.hp = 100;
  a.motion = 936;
  a.pos = vec3(0, 0, 80);
  a.yaw = 0;
  return a;
}

console.log("\nEnemyThrowerInit: zslman is born NoDismember");
// `EnemyThrowerInit` (`FUN_00449620`) is the fourth writer of the flag, and
// the only one outside class 0x30: character type 0x18, `zslman`, is **born**
// with it -- `CMP CX,0x18` / `OR AH,0x4` at `0x00449810`..`0x00449820`. The
// class-0x30 pass that found the other three could not reach this one,
// because it lives in class 0x31's Init.
{
  ResetGameGlobals();
  SetGameTables(CHARS31);
  const zslman = ActorSpawn(0x9100, SpawnClass.Thrower, 0x18, "zslman",
                            { initialState: ThrowerState.StandAndDecide,
                              condition: 0 });
  check("`zslman` is born NoDismember",
        (zslman.flags & ActorFlag.NoDismember) !== 0,
        `flags ${zslman.flags.toString(16)}`);
  const zstin = ActorSpawn(0x9101, SpawnClass.Thrower, 0x19, "zstin",
                           { initialState: ThrowerState.StandAndDecide,
                             condition: 0 });
  check("...and no other thrower character type is",
        (zstin.flags & ActorFlag.NoDismember) === 0,
        `flags ${zstin.flags.toString(16)}`);
}

console.log("class 0x31, ThrowerStateLeapToPoint:");
{
  const rng = new Rng(41);
  const events = new Events();
  let thumps = 0;
  events.on("sound.play", (d) => {
    if (d.id === SND_LEAP_LANDED) thumps += 1;
  });
  // Stage 2 block 5 step 6's first zsass, verbatim: spawned at y = 87 with a
  // descriptor naming the street at y = 37, thirty frames away. The other
  // shape is stage 2 block 11 step 4 -- the script plays the glass and then
  // puts two `zstin` in this state so they arrive through the window.
  const z = thrower(ThrowerState.LeapToPoint, {
    leap: { dest: [-732.8, 37.0, -1206.5], frames: 30 },
  });
  z.pos = vec3(-732.8, 87.0, -1206.5);
  z.motion = 10;

  check("it starts in the descriptor's own state, not the throw",
        z.state === ThrowerState.LeapToPoint, `state ${z.state}`);

  const ys: number[] = [];
  let clip = -1;
  let immune = 0;
  for (let i = 0; i < 200 && z.state === ThrowerState.LeapToPoint; i++) {
    GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
    ys.push(z.pos.y);
    if (z.action) clip = z.action.motion;
    if (z.flags & ActorFlag.ShotImmune) immune += 1;
  }
  // **The arc script is the point of this state**, and without it the actor
  // slid to the ground in whatever pose it was already in. Clip 300 is the
  // leap, cut into a windup at 50..55, a flight at 56..63 and a landing at
  // 64..98 by `CLASS31_ARC_SCRIPTS.drop`.
  check("it plays the leap clip the arc script names",
        clip === 300, `clip ${clip}`);
  check("it falls", ys[8] < 87 && ys[8] > 37, `y ${ys[8]?.toFixed(1)}`);
  check("it accelerates rather than sliding down at a constant rate",
        ys[7] - ys[8] < ys[22] - ys[23],
        `${(ys[7] - ys[8]).toFixed(3)} then ${(ys[22] - ys[23]).toFixed(3)}`);
  check("it lands on the point the descriptor names",
        Math.abs(z.pos.y - 37) < 0.01 && Math.abs(z.pos.x + 732.8) < 0.01,
        `(${z.pos.x.toFixed(1)}, ${z.pos.y.toFixed(1)})`);
  // `OR CH, 1` at `0x0044E4E3`, `AND AH, 0xFE` at `0x0044E5B2`: it cannot be
  // shot on the way through.
  // Every frame but the last: the flag is cleared inside the same update that
  // hands the actor to state 7, which is the frame the loop stops on.
  check("it is shot-immune for the whole leap and not after",
        immune === ys.length - 1 && (z.flags & ActorFlag.ShotImmune) === 0,
        `${immune} of ${ys.length} frames`);
  check("and then stands up to throw",
        z.state === ThrowerState.StandAndDecide, `state ${z.state}`);
  // The footfall, once: `PlaySoundId(0x2916A9)` at `0x0044E58E`.
  check("...having thumped exactly once on the way down",
        thumps === 1, `${thumps}`);
}

console.log("class 0x31, ThrowerStateWalkDistance:");
{
  const rng = new Rng(11);
  const events = new Events();
  const z = thrower(ThrowerState.WalkDistance, { walkDistance: 15 });
  const start = { ...z.pos };
  check("it starts in the entrance the descriptor names",
        z.state === ThrowerState.WalkDistance, `state ${z.state}`);
  let walked = 0;
  for (let i = 0; i < 600 && z.state === ThrowerState.WalkDistance; i++) {
    GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
    walked = Math.hypot(z.pos.x - start.x, z.pos.z - start.z);
  }
  // It stops on the frame it passes the distance, so it may overshoot by one
  // frame of the walk -- 2.08 units -- and no more.
  check("and stops within a frame of the fifteen units it names",
        walked >= 15 && walked < 15 + 2.2, `${walked.toFixed(2)}`);
  check("then it stands and decides",
        z.state === ThrowerState.StandAndDecide, `state ${z.state}`);
}

console.log("class 0x31, the climb:");
{
  const rng = new Rng(3);
  const events = new Events();
  const z = thrower(ThrowerState.StandAndDecide);
  // Band 1 is 40 < d <= 50, and the pick table there is nine parts climb.
  z.pos = vec3(0, 0, 45);
  z.yaw = 0;                             // facing the camera, which the gate needs

  // With no collision the search fails, and the engine's answer to that is to
  // refuse the state -- not to leap at nothing. It still pounces, because one
  // slot in ten of band 1's picks is the pounce and that needs no wall.
  T.coli = null;
  G.g_coli_full_set = [];
  let climbed = false;
  for (let i = 0; i < 300; i++) {
    GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
    if (z.state === ThrowerState.LeapToWallA
        || z.state === ThrowerState.LeapToWallB
        || z.state === ThrowerState.LeapToCeiling) climbed = true;
  }
  check("with nothing to climb it never enters a surface leap", !climbed,
        `state ${z.state}`);
  check("...and its stance is still the ground", z.thr.stance === 0
        && (z.flags2 & 0x1c0) === 0, `flags2 ${z.flags2.toString(16)}`);
  z.state = ThrowerState.StandAndDecide;
  z.sub = 0;
  z.flags2 = 0;
  z.pos = vec3(0, 0, 45);

  // Now give the level a wall in the plane x = 30 — a real quad, tested by the
  // real intersector — and the same search finds it.
  T.coli = { files: ["test"], blobs: { wall: WALL_BLOB, floor: FLOOR_BLOB } };
  G.g_coli_full_set = ["wall", "floor"];
  let sawLeap = false;
  for (let i = 0; i < 900; i++) {
    GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
    if (z.state === ThrowerState.LeapToWallA
        || z.state === ThrowerState.LeapToWallB
        || z.state === ThrowerState.LeapToCeiling) sawLeap = true;
    if ((z.flags2 & 0x1c0) !== 0) break;
  }
  check("given a wall it leaps at it", sawLeap, `state ${z.state}`);
  check("and arriving changes its stance off the ground",
        (z.flags2 & 0x1c0) !== 0 && (z.flags2 & 0x20) !== 0
        && ThrowerStanceOf(z) > 0,
        `flags2 0x${z.flags2.toString(16)} stance ${ThrowerStanceOf(z)}`);
  check("...and left it up on the wall", z.pos.y > 5,
        `y ${z.pos.y.toFixed(1)}`);
}

// **The descriptor's own flag word, which the exporter used to throw away.**
//
// `SpawnFromDescriptor` (`FUN_00408A20`) copies the spawn record's `+0x20`
// u16 into `obj+0x1316` before the class `Init` runs, and `EnemyThrowerInit`
// (`FUN_00449620`) makes it the low half of `obj+0x136C`:
//
//   00449762  MOVSX EAX, word ptr [ESI + 0x1316]   0fbf8616130000
//   00449769  OR    EAX, 0x180000                  0d00001800
//   0044977a  MOV   dword ptr [ESI + 0x136c], EAX  89866c130000
//
// `tools/hod2lib/evt.py` called that word "unused in every shipped file". It
// is not: 23 of 51 class-0x31 and 76 of 345 class-0x30 descriptors set it, and
// the five stage-6 `zslman` that blink in on a wall or the ceiling get their
// whole stance from it and nowhere else. Dropping it gave all five stance 0 —
// the ground motion row, the ground attack row, the floor gravity axis, and no
// `OffGround`.
console.log("class 0x31, the stance the spawn descriptor names:");
{
  // The seam first: bundle field -> actor field. It is one hop and it is the
  // hop that was missing.
  const d = DescriptorFromPlacement({ desc_flags: 0x100 } as never);
  check("`desc_flags` reaches `Actor.descFlags` (`obj+0x1316`)",
        d.descFlags === 0x100, `${d.descFlags}`);
  check("a placement without one is zero, not undefined",
        DescriptorFromPlacement({} as never).descFlags === 0, "");

  // Then the three stances the shipped stage-6 spawns actually carry, and the
  // ground for contrast. `st6evtbl.bin` off=001604/001630/002680 are 0x100,
  // off=002654 is 0x40 and off=0026ac is 0x80 -- all character type 0x18
  // entering state 34.
  const cases: [number, number][] = [
    [0, ThrowerStance.Ground],
    [ThrowerFlag.WallA, ThrowerStance.WallA],
    [ThrowerFlag.WallB, ThrowerStance.WallB],
    [ThrowerFlag.Ceiling, ThrowerStance.Ceiling],
  ];
  for (const [word, want] of cases) {
    const z = thrower(ThrowerState.StandAndDecide, { descFlags: word });
    check(`descriptor word 0x${word.toString(16)} gives stance ${want}`,
          ThrowerStanceOf(z) === want,
          `flags2 0x${(z.flags2 >>> 0).toString(16)}`
          + ` stance ${ThrowerStanceOf(z)}`);
    check("...and the surface bits are the descriptor's own",
          (z.flags2 & ThrowerFlag.Surface) === word,
          `0x${(z.flags2 & ThrowerFlag.Surface).toString(16)}`);
    // `OR AL, 0x20` (`0c20`) on each of the three non-ground arms of the jump
    // table at 0x00449900; the ground arm at 0x004497A7 does not.
    check("...and only a non-ground stance is off the ground",
          !!(z.flags2 & ThrowerFlag.OffGround) === (want !== 0),
          `flags2 0x${(z.flags2 >>> 0).toString(16)}`);
    // `| 0x180000` is unconditional and comes after, so it survives whatever
    // the descriptor said.
    check("...and it is still born colliding",
          (z.flags2 & ThrowerFlag.Collide) === ThrowerFlag.Collide,
          `0x${(z.flags2 >>> 0).toString(16)}`);
  }

  // Bit 0 is the other bit the shipped data sets -- 18 of the 51 -- and it is
  // a draw selector, not a stance. It must not move the stance.
  {
    const z = thrower(ThrowerState.StandAndDecide,
                      { descFlags: ThrowerFlag.SceneLit });
    check("bit 0 carries through without changing the stance",
          (z.flags2 & ThrowerFlag.SceneLit) !== 0
          && ThrowerStanceOf(z) === ThrowerStance.Ground
          && (z.flags2 & ThrowerFlag.OffGround) === 0,
          `flags2 0x${(z.flags2 >>> 0).toString(16)}`);
  }

  // Two surface bits at once overflow the four-arm table: `CMP ECX, 0x3` /
  // `JA` (`83f903` / `7745`) at 0x0044979B skips the whole switch, so the
  // actor keeps the bits but gets neither `OffGround` nor a `+0x134C`. No
  // shipped descriptor does it; the arm is here because the engine has it.
  {
    const z = thrower(ThrowerState.StandAndDecide,
                      { descFlags: ThrowerFlag.WallA | ThrowerFlag.Ceiling });
    check("two surface bits at once fall out of the switch",
          (z.flags2 & ThrowerFlag.OffGround) === 0,
          `flags2 0x${(z.flags2 >>> 0).toString(16)}`);
  }
}

console.log("class 0x31, the pounce and the leap back:");
{
  const rng = new Rng(5);
  const events = new Events();
  let hits = 0;
  let hitMotion = -1;
  events.on("player.damaged", () => { hits++; hitMotion = G.g_player_hit_motion[0]; });
  const z = thrower(ThrowerState.StandAndDecide);
  z.pos = vec3(0, 0, 25);                // inside 30: the router goes straight to 8

  GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
  check("inside thirty units it stops deciding and waits for a permit",
        z.state === ThrowerState.WaitForPermit, `state ${z.state}`);

  let sawPounce = false;
  let closest = Infinity;
  let sawAside = false;
  for (let i = 0; i < 900; i++) {
    GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
    if (z.state === ThrowerState.Pounce) sawPounce = true;
    if (z.state === ThrowerState.LeapAside) sawAside = true;
    closest = Math.min(closest, dist2d(z.pos, EYE));
  }
  check("it takes the permit and pounces", sawPounce, `state ${z.state}`);
  // `ThrowerPickLandingPoint` puts it 15.5 in front of the camera, which is
  // the whole reason the stab connects without any range test.
  check("the leap puts it on the landing point, not at a range it chose",
        Math.abs(closest - 15.5) < 0.6, `closest ${closest.toFixed(2)}`);
  check("and the stab lands", hits > 0, `${hits} hits`);
  // Attack 0's `player_motion` is 2, attack 1's is 3: whichever it drew, the
  // reaction is the attack entry's, not a constant.
  check("with the reaction the attack entry names",
        hitMotion === 2 || hitMotion === 3, `motion ${hitMotion}`);
  check("then it leaps back out", sawAside, `state ${z.state}`);
  check("and the permit is free again for the next one",
        G.g_attack_permits.filter((p) => p !== -1).length <= 1,
        `${G.g_attack_permits.join()}`);
}

console.log("class 0x31, ThrowerStrikeConnect tests no range:");
{
  const rng = new Rng(9);
  const events = new Events();
  void rng;
  let hits = 0;
  events.on("player.damaged", () => hits++);
  const z = thrower(ThrowerState.StandAndDecide);
  z.pos = vec3(0, 0, 400);              // nowhere near the camera
  z.attackPermit = 0;
  G.g_attack_permits[0] = z.at;
  z.attack = 0;
  z.thr.stance = 0;
  z.action = { motion: 303, ticks: 62, loop: false };
  check("a swing on its hit frame connects from four hundred units away",
        ThrowerStrikeConnect(z, events) && hits === 1, `${hits} hits`);
  // ...and the cancel mask is the only thing that stops it.
  z.flags2 = 0;
  z.zones = 2;                          // attack 0 names zone 2, the right arm
  z.action = { motion: 303, ticks: 62, loop: false };
  G.g_player_invuln_frames = 0;
  const before = hits;
  ThrowerStrikeConnect(z, events);
  check("but an attack whose zone has been shot off whiffs", hits === before,
        `${hits} vs ${before}`);
}


// -- 13. class 0x31's own damage and death ----------------------------------

console.log("class 0x31, the stumble and the death chain:");
{
  const rng = new Rng(21);
  const events = new Events();
  const z = thrower(ThrowerState.StandAndDecide);
  z.pos = vec3(0, 0, 45);
  z.hp = 100;

  // `ResolveHit` hands class 0x31 a *pending hit* instead of the shared
  // stagger and the shared directional death: the class picks its own.
  ResolveHit(z, 4, 0, CAM_HOST, rng);
  check("a shot leaves a pending hit rather than a stumble clip",
        !!z.pendingHit && z.react === null, `${JSON.stringify(z.pendingHit)}`);
  GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
  check("...which the next tick turns into its own state",
        z.state === ThrowerState.HitReaction
        || z.state === ThrowerState.FallAndLand, `state ${z.state}`);
  check("and the pending hit is drained", z.pendingHit === null);

  // Now kill it, and watch the whole chain rather than a death clip.
  z.state = ThrowerState.StandAndDecide;
  z.sub = 0;
  z.flags = 0;
  z.flags2 = 0;
  z.hp = 1;
  ResolveHit(z, 1, 0, CAM_HOST, rng);
  check("the kill sets no directional death clip", z.death === null,
        `${JSON.stringify(z.death)}`);
  GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
  check("it falls instead", z.state === ThrowerState.FallAndLand,
        `state ${z.state}`);

  const seen = new Set<number>();
  for (let i = 0; i < 1200 && z.visible; i++) {
    GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
    seen.add(z.state);
  }
  check("the fall becomes a corpse", seen.has(ThrowerState.Corpse),
        [...seen].join());
  check("and the corpse despawns rather than lying there for ever",
        !z.visible && z.dead, `visible ${z.visible}`);
}

console.log("class 0x31, being knocked down is survivable:");
{
  const rng = new Rng(31);
  const events = new Events();
  const z = thrower(ThrowerState.StandAndDecide);
  z.pos = vec3(0, 0, 45);
  z.hp = 100;
  // A body shot on an actor that is *not* in the hub falls rather than
  // stumbles, and a fall it survives ends back at the hub.
  z.state = ThrowerState.LeapAside;
  z.sub = 0;
  ResolveHit(z, 1, 0, CAM_HOST, rng);
  GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
  check("a shot outside the hub knocks it over",
        z.state === ThrowerState.FallAndLand, `state ${z.state}`);
  let recovered = false;
  for (let i = 0; i < 900; i++) {
    GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
    if (z.state === ThrowerState.StandAndDecide) { recovered = true; break; }
  }
  check("and it gets back up", recovered && !z.dead, `state ${z.state}`);
  check("with its hit points intact", z.hp > 0, `hp ${z.hp}`);
}

console.log("class 0x31, the scripted entrances:");
{
  const rng = new Rng(41);
  const events = new Events();
  // Stage 6's `zslman` blink in: three hops from 90 units out, 30 apart.
  const z = thrower(ThrowerState.BlinkIn, { backAwayDelay: 0, attackState: 7 });
  z.pos = vec3(0, 0, 45);
  z.yaw = 0;
  const origin = { ...z.pos };
  check("it starts in the entrance", z.state === ThrowerState.BlinkIn,
        `state ${z.state}`);
  const hops: number[] = [];
  for (let i = 0; i < 300 && z.state === ThrowerState.BlinkIn; i++) {
    GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
    const d = Math.round(Math.hypot(z.pos.x - origin.x, z.pos.z - origin.z));
    if (hops[hops.length - 1] !== d) hops.push(d);
  }
  // With a delay of 0 the first hop lands on the entry frame itself, so the
  // origin never shows up in the trace.
  check("three hops, at 90, 60 and 30 units from where it appeared",
        hops.join() === "90,60,30", hops.join());
  check("then it hands to the state its descriptor names",
        z.state === ThrowerState.StandAndDecide, `state ${z.state}`);
}

console.log("class 0x31, ThrowerStateWaitForCue:");
{
  const rng = new Rng(51);
  const events = new Events();
  // The training stage's six: hold a clip until the camera path reaches a
  // frame, then become state 7.
  const z = thrower(ThrowerState.WaitForCue, {
    cue: { motion: 295, cond: 1, operand: 140 }, attackState: 7,
  });
  G.g_cam_path_frame = 0;
  for (let i = 0; i < 120; i++) GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
  check("it waits while the camera is short of the cue frame",
        z.state === ThrowerState.WaitForCue, `state ${z.state}`);
  G.g_cam_path_frame = 140;
  GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
  check("and goes the moment the camera reaches it",
        z.state === ThrowerState.StandAndDecide, `state ${z.state}`);
}


console.log("class 0x31, ThrowerStateGrabPlayer's sound cues:");
{
  const rng = new Rng(61);
  const events = new Events();
  const heard: number[] = [];
  events.on("sound.play", (e: { id: number }) => heard.push(e.id));
  // Stage 5's four `zslman`: ride the camera, drop on a cue, hold, grab.
  const z = thrower(ThrowerState.GrabPlayer, {
    attackState: 7,
    grab: {
      offset: [0, -40, 0], cue_frame: 20, drop_frames: 10, hold_frames: 25,
      player: 0,
    },
  });
  z.pos = vec3(0, 60, 0);
  G.g_cam_path_frame = 0;
  for (let i = 0; i < 5; i++) GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
  check("no sound while it hangs off the camera waiting for the cue",
        heard.length === 0, heard.map((h) => h.toString(16)).join());
  G.g_cam_path_frame = 20;
  GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
  check("the cue frame plays one step -- COMMON\\ENE_WALK2_11",
        heard.join() === String(0x2516a9), heard.map((h) => h.toString(16)).join());
  for (let i = 0; i < 10; i++) GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
  check("landing plays the thump, then ignites the looping laser sword",
        heard.join() === [0x2516a9, 0x2916a9, 0x1f23a9].join(),
        heard.map((h) => h.toString(16)).join());
  // It blinks for the *first* fifteen frames of the hold and is solid for the
  // rest, and the `_OFF` stopper sits in the `else` arm of that per-frame
  // branch with no edge test -- so with a 25-frame hold it fires ten times.
  for (let i = 0; i < 25; i++) GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
  const offs = heard.filter((h) => h === 0x2023a9).length;
  check("...and the `_OFF` stopper fires on each of the 10 non-blinking frames",
        offs === 10, `${offs}`);

}

console.log("the counts an actor never joined:");
{
  // **An enemy the engine declines to count must not leave the count.**
  //
  // `CountEnemyZombieIn` skips two kinds -- character type 9, which has no
  // update handler at all, and initial state 0x1F, which counts itself in
  // later when its script flag comes up. The release paths are latched so that
  // six routines can all call them and only the first one counts, but the
  // latch said nothing about an actor that was never counted *in*. The engine
  // never had to care: it has no sweep, and nothing reaches an uncounted actor
  // with a release. The port's despawn sweep does, and it took both counters
  // to **-1** -- so every later `wait_enemies_alive <= 0` opened immediately.
  // A room that clears without killing anything is the same class of bug as
  // one that never clears, and much harder to notice.
  for (const [what, ct, initial] of [
    ["initial state 0x1F", 1, UNCOUNTED_INITIAL_STATE],
    ["character type 9", UNCOUNTED_CHAR_TYPE, 0],
  ] as const) {
    ResetGameGlobals();
    SetGameTables(CHARS);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    const z = spawnZombie(0x1000, ct, "zom",
                         { initialState: initial });
    check(`a zombie with ${what} is not in the counts`,
          G.g_enemies_alive === 0 && G.g_enemies_present === 0,
          `alive ${G.g_enemies_alive}, present ${G.g_enemies_present}`);
    ActorDespawn(z);
    GameUpdate(EYE, 1 / 60, NULL_HOST, new Rng(1));
    check(`...and retiring it does not take them below zero`,
          G.g_enemies_alive === 0 && G.g_enemies_present === 0,
          `alive ${G.g_enemies_alive}, present ${G.g_enemies_present}`);
  }
}


console.log("class 0x31, the thrower actually lets go of the weapon:");
{
  // **`ThrowerStateThrow` advancing its own sub-state is not a throw.** The
  // release, `SpawnThrownWeapon` (`FUN_004504E0`), reads the hand's recorded
  // position and allocates the projectile; it has no path in the engine that
  // declines. The port asks the host for that position, and a host that could
  // not answer used to make the whole routine `return` — after the state had
  // already moved to `ThrowSub.Thrown`. So the clip played, the hand went
  // bare, the permit changed hands, and no axe ever left it.
  const HANDS = [
    { bone: 5, motion: 8, release_frame: 6, range: 20, player_motion: 6,
      cancel_mask: 2, held: 8098, bare: 8095, projectile: 8081 },
    { bone: 8, motion: 9, release_frame: 6, range: 20, player_motion: 6,
      cancel_mask: 4, held: 8094, bare: 8091, projectile: 8080 },
  ];
  const TYPE_THROWER = {
    ...TYPE31,
    // **Character type 0x16.** `ThrowerPickThrowingHand` (`FUN_0044F630`)
    // answers 0 for every type but 0x16 and 0x18 — as does
    // `ThrowerBothHandsArmed` (`FUN_0044F5D0`), the gate on the state — so a
    // `zstin` in state 0x1F is a thing the engine cannot make.
    type: 0x16,
    motions: {
      ...TYPE31.motions, "8": motion(24), "9": motion(24),
      // `ThrowerStateRearm`'s clip: motion id 5, a literal, not a set entry.
      "5": motion(20),
    },
    // `g_class31_throws` verbatim in shape: hands by body condition, then the
    // scalars `ThrowerStateThrow` and `ThrownWeaponFlyToTarget` read.
    throw: {
      hands: { "0": HANDS },
      // `SpawnThrownWeapon` writes 0x600 into `obj+0x135C` for `zsass`.
      spin: 0x600, speed: 1.2, aim_ahead: 4, aim_side: 0.6,
      stick_frames: 30, blink_frames: 60,
    },
  } as unknown as CharacterType;
  const CHARS_THROW = {
    ...CHARS31, types: { "1": TYPE, "22": TYPE_THROWER },
  } as unknown as CharactersJson;

  ResetGameGlobals();
  SetGameTables(CHARS_THROW);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_player_lives = [PLAYER.start_lives, PLAYER.start_lives];
  G.g_camera_yaw_bams = 0;
  const z = ActorSpawn(0x9200, SpawnClass.Thrower, 0x16, "thrower", {
    initialState: ThrowerState.StandAndDecide, condition: 0,
  });
  z.visible = true;
  z.hp = 100;
  z.pos = vec3(0, 0, 60);
  z.yaw = 0;
  // `ThrowerEntryState` resolves state 31 to the hub — the throw is a state the
  // router picks, never a spawn's entrance — so it is set here rather than
  // asked for in the descriptor.
  z.state = ThrowerState.Throw;
  z.sub = 0;

  const rng = new Rng(23);
  const events = new Events();
  let threw = 0;
  events.on("enemy.threw", () => { threw += 1; });

  // `NULL_HOST` on purpose: it answers `boneWorld` with `false`, which is the
  // exact condition that used to swallow the throw.
  let seen: (typeof G.g_thrown_weapons)[number] | undefined;
  for (let i = 0; i < 300 && !seen; i++) {
    GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
    seen = G.g_thrown_weapons[0];
  }
  check("the release makes a weapon even when the host has no skeleton",
        seen !== undefined && threw >= 1,
        `pool ${G.g_thrown_weapons.length}, ${threw} throws`);
  if (seen) {
    check("...at the hand's own height, not at the actor's feet",
          seen.pos.y > z.pos.y, `${seen.pos.y} vs ${z.pos.y}`);
    // **`0x600` is a tilt, not a rate**, and this used to assert the opposite.
    // `SpawnThrownWeapon` (`FUN_004504E0`) writes it to the projectile's
    // `obj+0x1364`, and `ThrownWeaponUpdate` (`FUN_00450780`) draws
    // `Rz(obj+0x6C) * Ry(obj+0x68) * Rx(obj+0x1364 + obj+0x64)` — so it is
    // added once, to X, and the *rate* is `obj+0x135C`, which no launcher
    // writes at all. The port had been driving the Y tumble with it.
    check("...carrying the character type's own X tilt",
          seen.tilt === 0x600, String(seen.tilt));
    // Class 0x31 tumbles about Y and negates for the other hand —
    // `ThrownWeaponFlyToTarget` (`FUN_0044FD40`) at `0x0044FDE9`, which tests
    // the throwing hand `obj+0x1358` against bone 5. Class 0x30 does neither.
    check("...tumbling about Y, which is class 0x31's term",
          seen.axis === "y", `axis ${seen.axis}`);
    check("...at the rate the port declares, signed by the hand",
          Math.abs(seen.spin) === THROWN_SPIN_RATE, String(seen.spin));

    // ...and it is a thing that moves. `ThrownWeaponFlyToTarget` sets the
    // velocity once, at launch, and the flight is a straight line at a
    // constant speed until the ttl runs out.
    const launch = { ...seen.pos };
    const before = dist2d(seen.pos, EYE);
    for (let i = 0; i < 20; i++) {
      GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
    }
    check("...and it travels", dist2d(seen.pos, launch) > 10,
          `${dist2d(seen.pos, launch).toFixed(1)} units`);
    check("...toward the camera", dist2d(seen.pos, EYE) < before,
          `${dist2d(seen.pos, EYE).toFixed(1)} from ${before.toFixed(1)}`);
    check("...tumbling as it goes", seen.spinAngle !== 0,
          String(seen.spinAngle));

    // The hit is **timed, not tested**: the weapon damages the player when its
    // flight time runs out, wherever it happens to be. That is
    // `ThrownWeaponFlyToTarget`'s own shape, the same as the melee hit frame.
    let damaged = 0;
    events.on("player.damaged", () => { damaged += 1; });
    for (let i = 0; i < 200 && !seen.hit; i++) {
      GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
    }
    check("...and lands on the player when the flight time is up",
          seen.hit && damaged >= 1, `hit ${seen.hit}, ${damaged} damaged`);
  }
}

console.log("class 0x31, the grab ends in the engine's one leave routine:");
{
  // **`ThrowerLeave` (`FUN_0044AD60`) was transcribed twice, with different
  // bodies.** `class31/death.ts` exported the real one -- retire from the
  // alive count, retire from the present count, release the attack permit,
  // drop the camera slot, despawn. `class31/scripted.ts` had a *private*
  // function of the same name and the same citation that released the permit
  // and set `dead`, and retired from neither count.
  //
  // `ThrowerStateGrabPlayer` (`FUN_0044EF90`) is one of the exe's two callers
  // of the real routine, and it was calling the thin copy. So every thrower
  // that finished its grab-and-throw left `g_enemies_alive` and
  // `g_enemies_present` one too high for the rest of the stage, and any later
  // `wait_enemies_alive` could never open -- a hang, from a duplicate.
  //
  // Nothing caught it because `verify_port.py` keyed its ports by *name*, and
  // a set swallows the second of two. It keys by address now.
  //
  // The counts are what this asserts, because the counts are what hangs.
  const rng = new Rng(61);
  const events = new Events();
  const z = thrower(ThrowerState.GrabPlayer, {
    attackState: 7,
    grab: {
      offset: [0, -40, 0], cue_frame: 20, drop_frames: 10, hold_frames: 25,
      player: 0,
    },
  });
  z.pos = vec3(0, 60, 0);
  check("`EnemyThrowerInit` counted it in, alive and present",
        G.g_enemies_alive === 1 && G.g_enemies_present === 1,
        `alive ${G.g_enemies_alive}, present ${G.g_enemies_present}`);
  G.g_cam_path_frame = 20;
  for (let i = 0; i < 900 && !z.despawned; i++) {
    GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
  }
  check("the throw-away ends in a despawn, not a body left standing",
        z.despawned, `state ${z.state} sub ${z.sub}`);
  check("...and it leaves both counts, so the next wait can open",
        G.g_enemies_alive === 0 && G.g_enemies_present === 0,
        `alive ${G.g_enemies_alive}, present ${G.g_enemies_present}`);
  check("...and gives the attack permit back",
        G.g_attack_permits.every((x) => x === -1), G.g_attack_permits.join());
  check("...and drops out of the camera's enemy slots",
        !G.g_enemy_slots.includes(z.at), G.g_enemy_slots.join());
}

/**
 * `ThrowerStateThrow` and the two compares that divert character type 0x18.
 *
 * D3 of `docs/REVIEW-2026-09-03.md`. The write-up called it a 23-frame late
 * release; it was that **and** the wrong clip, because `FUN_0044FAF0` tests
 * the character type twice — at 0x0044FB7A for the clip and again at
 * 0x0044FC83 for the release frame — and the port had been reading the
 * exported throw entry for both.
 *
 * The three checks below are the three things that were wrong or at risk:
 * the release frame, the clip, and the other character types not moving.
 */
console.log("class 0x31, ThrowerStateThrow, character type 0x18:");
{
  const rng = new Rng(97);
  /**
   * A thrower of a given character type, mid-throw and holding the permit.
   *
   * `drop` is the destroyed-zone bit of the hand that is **not** to throw:
   * `ThrowerPickThrowingHand` (`FUN_0044F630`) tosses a coin for a preferred
   * hand and takes the other whenever the preferred one is bare, so baring one
   * arm is how a test names the hand without owning the coin.
   */
  const throwing = (charType: number, at: number, drop = 0) => {
    ResetGameGlobals();
    SetGameTables(CHARS31);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_camera_yaw_bams = 0;
    const a = ActorSpawn(at, SpawnClass.Thrower, charType, "t", {
      initialState: ThrowerState.Throw, condition: 0,
    });
    // Narrowing, not a cast -- see `thrower` above.
    if (a.cls !== SpawnClass.Thrower) throw new Error("not class 0x31");
    a.visible = true;
    a.hp = 100;
    a.pos = vec3(0, 0, 80);
    a.zones |= drop;
    // `ThrowerEntryState` resolves a descriptor's 31 to the hub -- the throw is
    // a state the router picks, never an entrance -- so it is set here.
    a.state = ThrowerState.Throw;
    // The engine only ever *enters* state 0x1F holding the permit --
    // `ThrowerTryEnterState`'s case 0x1F claims one first -- so seed it,
    // rather than letting the state take the no-permit exit.
    a.attackPermit = 0;
    a.sub = ThrowSub.Draw;
    return a;
  };

  // 1. The release frame. `MOV dword ptr [ESI+0x1350], 0x19` at 0x0044FBE1
  //    and seven more; the bundle's entry says 48. The cursor is the base
  //    track's, `obj+0x19C`, which is what 0x0044FC9B reads.
  const z = throwing(0x18, 0x9200);
  ThrowerStateThrow(z, NULL_HOST, EYE, rng);
  z.playTicks = 24;
  ThrowerStateThrow(z, NULL_HOST, EYE, rng);
  check("type 0x18 has not let go on frame 24",
        z.sub === ThrowSub.Winding, `sub ${z.sub}`);
  z.playTicks = 25;
  ThrowerStateThrow(z, NULL_HOST, EYE, rng);
  check("...and lets go on 25, the constant the switch writes, not the "
        + "entry's 48", z.sub === ThrowSub.Thrown, `sub ${z.sub}`);

  // 2. The clip, per hand and per stance -- the whole reachable table.
  //    Bone 5 is entry 0 and bone 8 entry 1; baring the other arm is what
  //    forces the pick, since the coin is the engine's and not the test's.
  const STANCE = [
    ["ground", 0 as number],
    ["WallA", ThrowerFlag.WallA],
    ["WallB", ThrowerFlag.WallB],
    ["ceiling", ThrowerFlag.Ceiling],
  ] as const;
  const WANT = [[0x1f7, 0x1fc, 0x1f2, 0x204], [0x1f6, 0x1fb, 0x1f1, 0x203]];
  const OTHER_ARM = [DamageZone.LeftArm, DamageZone.RightArm];
  let clips = true;
  const got: string[] = [];
  for (let hand = 0; hand < 2; hand++) {
    for (let s = 0; s < STANCE.length; s++) {
      const a = throwing(0x18, 0x9210 + hand * 8 + s, OTHER_ARM[hand]);
      a.flags2 |= STANCE[s][1];
      ThrowerStateThrow(a, NULL_HOST, EYE, rng);
      const want = WANT[hand][s];
      if (a.motion !== want || a.attack !== hand) {
        clips = false;
        got.push(`${STANCE[s][0]}/${hand}: ${a.motion} want ${want}`);
      }
    }
  }
  check("the stance and the hand pick the clip the `.text` table names, "
        + "all eight of them", clips, got.join("; "));

  // 2b. And the clip does not start at frame zero. `PUSH 0x4 / PUSH 0x1a`
  //     (`6a04 6a1a`) at 0x0044FB87 for every type but 0x18, `PUSH 0x0`
  //     (`6a00`) at 0x0044FC6A for 0x18 -- and `FUN_004119A0` writes that
  //     third argument straight into the play cursor, `param_1[2] = param_3`.
  const s18 = throwing(0x18, 0x9240);
  ThrowerStateThrow(s18, NULL_HOST, EYE, rng);
  check("type 0x18's throw starts its clip at cursor 0",
        s18.playTicks === 0, `cursor ${s18.playTicks}`);

  // 3. The control. Three of the four character types read the entry, at
  //    0x0044FC8D -- `MOVSX EAX, word ptr [EDI + 0x8]`. Same fixture bytes.
  const y = throwing(0x16, 0x9230, DamageZone.LeftArm);
  ThrowerStateThrow(y, NULL_HOST, EYE, rng);
  check("type 0x16 still plays the throw entry's own clip",
        y.motion === 9, `motion ${y.motion}`);
  check("...from cursor 0x1A, not from zero", y.playTicks === 0x1a,
        `cursor ${y.playTicks}`);
  y.playTicks = 47;
  ThrowerStateThrow(y, NULL_HOST, EYE, rng);
  check("...and has not let go on 47", y.sub === ThrowSub.Winding, `sub ${y.sub}`);
  y.playTicks = 48;
  ThrowerStateThrow(y, NULL_HOST, EYE, rng);
  check("...and lets go on the entry's own 48, not on 25",
        y.sub === ThrowSub.Thrown, `sub ${y.sub}`);

  // 4. **The exit.** `g_motion_play_length[obj+0x1B4] - 1 <= obj+0x19C` and
  //    out to state 7 -- `MOV word ptr [ESI + 0x1310], 0x7`
  //    (`66c786101300000700`) at 0x0044FCE1, with `obj+0x1312` zeroed on the
  //    next instruction. Motion 9 is 40 authored frames, so its play length is
  //    78 and the last frame is 77.
  y.playTicks = 76;
  ThrowerStateThrow(y, NULL_HOST, EYE, rng);
  check("the throw holds until the clip's last frame",
        y.state === ThrowerState.Throw && y.sub === ThrowSub.Thrown,
        `state ${y.state} sub ${y.sub}`);
  y.playTicks = 77;
  ThrowerStateThrow(y, NULL_HOST, EYE, rng);
  check("...then hands back to the hub, sub zeroed -- it does not loop",
        y.state === ThrowerState.StandAndDecide && y.sub === 0,
        `state ${y.state} sub ${y.sub}`);
  check("...leaving the hand bare for state 29 to deal with",
        (y.zones & DamageZone.RightArm) !== 0
        && y.boneSlot["5"] === 8177, `zones ${y.zones}`);
}

/**
 * The whole loop, in one actor: hub -> throw -> hub -> re-arm -> hub.
 *
 * `ThrowerStateThrow` (`FUN_0044FAF0`) ends by writing state 7 and nothing
 * else; it is `ThrowerStateStandAndDecide` (`FUN_0044B180`) that offers state
 * 0x1D to `ThrowerTryEnterState` (`FUN_0044AFB0`) before it asks the router
 * anything, and `ThrowerStateRearm` (`FUN_0044F7A0`) that puts the weapon
 * back. The port used to do all of it inside the throw, looping there for ever
 * and swapping one hand back on its way round -- so the actor never reached
 * the hub, state 29 never ran, and nothing downstream of the hub could
 * happen either.
 */
console.log("class 0x31, a throw ends at the hub and state 29 re-arms it:");
{
  const HANDS = [
    { bone: 5, motion: 9, release_frame: 30, range: 20, player_motion: 6,
      cancel_mask: 2, held: 0x1fa2, bare: 0x1f9f, projectile: 8081 },
    { bone: 8, motion: 8, release_frame: 30, range: 20, player_motion: 6,
      cancel_mask: 4, held: 0x1f9e, bare: 0x1f9b, projectile: 8080 },
  ];
  const TYPE_REARM = {
    ...TYPE31,
    type: 0x16, name: "zsass", file: "zsass.bin",
    motions: {
      ...TYPE31.motions, "8": motion(24), "9": motion(24), "5": motion(20),
    },
    throw: {
      hands: { "0": HANDS },
      spin: 0x600, speed: 1.2, aim_ahead: 4, aim_side: 0.6,
      stick_frames: 30, blink_frames: 60,
    },
  } as unknown as CharacterType;
  const CHARS_REARM = {
    ...CHARS31, types: { "1": TYPE, "22": TYPE_REARM },
  } as unknown as CharactersJson;

  ResetGameGlobals();
  SetGameTables(CHARS_REARM);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_player_lives = [PLAYER.start_lives, PLAYER.start_lives];
  G.g_camera_yaw_bams = 0;
  const z = ActorSpawn(0x9300, SpawnClass.Thrower, 0x16, "zsass", {
    initialState: ThrowerState.StandAndDecide, condition: 0,
  });
  if (z.cls !== SpawnClass.Thrower) throw new Error("not class 0x31");
  z.visible = true;
  z.hp = 100;
  z.pos = vec3(0, 0, 80);
  z.yaw = 0;
  // Straight into the throw, holding the permit, the way case 0x1F leaves it.
  z.state = ThrowerState.Throw;
  z.sub = ThrowSub.Draw;
  z.attackPermit = 0;

  const rng = new Rng(41);
  const events = new Events();
  const ARMS = DamageZone.RightArm | DamageZone.LeftArm;
  const ARMED = { "5": 0x1fa2, "8": 0x1f9e } as Record<string, number>;
  // Which hand the coin gave it. `ThrowerPickThrowingHand` owns that choice,
  // so the test reads it back rather than pinning it.
  let bare = "";
  // **One weapon per visit to state 31.** This is what tells the engine's
  // shape from the loop the port used to run: a state that hands back to the
  // hub throws once and lets state 29 re-arm it, where a state that re-arms a
  // hand itself and resets its own sub goes straight round again and empties
  // both hands before it ever leaves.
  let threw = 0;
  let threwBeforeHub = -1;
  events.on("enemy.threw", () => { threw += 1; });
  const seen = new Set<number>();
  for (let i = 0; i < 600; i++) {
    GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
    seen.add(z.state);
    if (threwBeforeHub < 0 && threw > 0
        && z.state === ThrowerState.StandAndDecide) {
      threwBeforeHub = threw;
    }
    if (!bare && (z.zones & ARMS) !== 0) {
      bare = (z.zones & DamageZone.RightArm) !== 0 ? "5" : "8";
    }
    if (bare && seen.has(ThrowerState.Rearm) && (z.zones & ARMS) === 0) break;
  }

  check("the throw let a weapon go and left an arm bare", bare !== "",
        `states ${[...seen].join(",")}`);
  check("the clip's end hands back to the hub, state 7",
        seen.has(ThrowerState.StandAndDecide),
        `states ${[...seen].join(",")}`);
  check("...after exactly one throw, not after both hands are empty",
        threwBeforeHub === 1, `${threwBeforeHub} throws before the hub`);
  check("...and the hub offers state 29, which is where the re-arm lives",
        seen.has(ThrowerState.Rearm), `states ${[...seen].join(",")}`);
  check("...so the hand that threw holds its weapon again",
        bare !== "" && z.boneSlot[bare] === ARMED[bare],
        `bone ${bare} ${z.boneSlot[bare]}`);
  check("...with neither arm still counted destroyed", (z.zones & ARMS) === 0,
        `zones ${z.zones}`);
  check("...and the permit is back in the pool", z.attackPermit < 0
        && G.g_attack_permits.every((p) => p === -1),
        `permit ${z.attackPermit}, pool ${G.g_attack_permits.join(",")}`);
}

// -- 13c. a body on the ground is not a target -------------------------------

/**
 * **`DispatchHit` (`FUN_004092F0`) is the only door into `ResolveHit`, and it
 * is shut while `obj+0x34` bit `0x100` is up.**
 *
 * Reported against stage 2, block 14, step 8, op 2 — the `zsass` at descriptor
 * `0x8094`: *"doesn't seem to die. shoot him enough, he makes a dead sound,
 * but then he keeps on [the] player."*
 *
 * The port charged damage to an actor the engine refuses to resolve a hit on
 * at all, and the window that refusal covers is exactly the window nothing is
 * listening in: `ThrowerOnShot` (`FUN_004499A0`) returns on the same bit, so a
 * `zsass` shot while it lay on the ground reached zero hit points with no
 * reaction chosen. `ThrowerStateFallAndLand`'s sub 4 is a switch arm, not a
 * fall-through from the survive test, so it then stood the corpse back up
 * through `ThrowerStateGetUp` — dead, still inside `g_enemies_alive`, still
 * throwing.
 *
 * The assertions are on the actor's own state and on the two counters, not on
 * `dead`: a flag a layer sets about itself was true the whole time and said
 * nothing about what the player could see.
 */
console.log("\na downed thrower, shot on the ground:");
{
  ResetGameGlobals();
  SetGameTables(CHARS31);
  G.g_app_state = AppState.InPlay;
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_player_lives = [PLAYER.start_lives, PLAYER.start_lives];
  G.g_nFiringGate = 1;
  G.g_camera_yaw_bams = 0;

  const AT = 0x8094;
  const z = ActorSpawn(AT, SpawnClass.Thrower, 0x16, "zsass", {
    initialState: ThrowerState.StandAndDecide, condition: 0,
  });
  if (z.cls !== SpawnClass.Thrower) throw new Error("not class 0x31");
  z.visible = true;
  // Deep enough that the knockdown cannot be the killing blow: what is under
  // test is the shots that land *after* it is down.
  z.hp = z.maxHp = 400;
  z.pos = vec3(0, 0, 80);
  z.yaw = 0;

  const rng = new Rng(31);
  const events = new Events();
  const RAY = { origin: vec3(0, 0, 0), dir: vec3(0, 0, 1) };
  // Bone 1, the torso: the one bone in this fixture with a damage row, so a
  // shot that is *allowed* to resolve unmistakably moves the hit points.
  const host = { ...NULL_HOST,
    pickShot: () => ({ kind: "actor", at: z.at, bone: 1,
                       point: vec3() }) as ShotPick };
  const results: number[] = [];
  events.on("shot.resolved", (r) => results.push(r.result ?? -1));

  /** The four states class 0x31's death runs through, and nothing else. */
  const DYING = new Set([ThrowerState.FallAndLand, ThrowerState.Death,
                         ThrowerState.Corpse, ThrowerState.CorpseBlink]);
  let actedWhileDead = 0;
  let worstWhileDead = "";
  const step = (fire: boolean): void => {
    if (fire) QueueShotRequest(0, RAY);
    GameUpdate(EYE, 1 / 60, host, rng, events);
    const live = ActorByAt(AT);
    if (live?.dead && !live.despawned && !DYING.has(live.state)) {
      actedWhileDead += 1;
      worstWhileDead = `${ThrowerState[live.state] ?? live.state}/${live.sub}`;
    }
  };

  // Shoot until it is knocked off its feet and has settled: `obj+0x34` bit
  // 0x100 goes up at the end of `ThrowerStateFallAndLand`'s sub 2.
  let toDown = 0;
  while (toDown < 900 && !(z.flags & ActorFlag.ShotImmune)) {
    step(true);
    toDown += 1;
  }
  check("a thrower shot enough goes down and settles",
        (z.flags & ActorFlag.ShotImmune) !== 0 && !z.dead,
        `${toDown} frames, state ${z.state}/${z.sub}, hp ${z.hp}`);

  // Let it get as far as the get-up, sub 4, still shot-immune. **That is the
  // sub the report lives in**: sub 4 is reached from the switch, not through
  // sub 3's survive test, so nothing on that path ever re-reads `dead` —
  // a thrower killed here is stood back up by its own death state.
  let toGetUp = 0;
  while (toGetUp < 600 && (z.flags & ActorFlag.ShotImmune)
         && !(z.state === ThrowerState.FallAndLand && z.sub === 4)) {
    step(false);
    toGetUp += 1;
  }
  check("...lies there, and starts to get up while it is still immune",
        z.state === ThrowerState.FallAndLand && z.sub === 4
        && (z.flags & ActorFlag.ShotImmune) !== 0,
        `${toGetUp} frames, state ${z.state}/${z.sub}, `
        + `flags ${z.flags.toString(16)}`);

  // ...and now the whole of it, one round from death. Standing the hit points
  // at 1 by hand is what makes the two readings separable in one shot rather
  // than in a hundred: the engine refuses the round outright, so it stays at
  // 1, and the port charged it, so it went to -2 with nothing listening.
  z.hp = 1;
  const hpDown = z.hp;
  const scoreDown = G.g_player_score[0];
  results.length = 0;
  let shotsWhileDown = 0;
  let hpMovedWhileDown = 0;
  for (let i = 0; i < 240 && (z.flags & ActorFlag.ShotImmune); i++) {
    step(true);
    shotsWhileDown += 1;
    hpMovedWhileDown = Math.max(hpMovedWhileDown, hpDown - z.hp);
  }
  check("...and while it is down every round is refused by `DispatchHit`",
        shotsWhileDown > 0 && hpMovedWhileDown === 0,
        `${shotsWhileDown} rounds took ${hpMovedWhileDown} hp`);
  check("...so a body on the ground cannot be killed where nothing is "
        + "listening for the kill", !z.dead, `hp ${z.hp}, dead ${z.dead}`);
  check("...they ricochet: result 5, and no score",
        results.length > 0 && results.every((r) => r === HitResultCode.NoEffect)
        && G.g_player_score[0] === scoreDown,
        `results ${[...new Set(results)].join(",")}, `
        + `score ${scoreDown} -> ${G.g_player_score[0]}`);

  // Now stop, the way a player who has heard a death sound stops, and watch
  // ten seconds of it. This is the whole of the report: what the viewer saw
  // was a `zsass` that had made its noise and gone back to throwing.
  const deadOnTheGround = z.dead;
  for (let i = 0; i < 600; i++) step(false);
  check("...and ten seconds later it is still not dead, because none of those "
        + "rounds ever reached the damage tables",
        !deadOnTheGround && !z.dead,
        `dead ${deadOnTheGround} on the ground, ${z.dead} after`);

  // Then finish it properly: on its feet, where its own on-shot routine is
  // listening, the same rounds land and the death has somewhere to go.
  for (let i = 0; i < 9000 && ActorByAt(AT); i++) step(true);

  check("it never acts while dead — no standing, throwing or pouncing corpse",
        actedWhileDead === 0,
        `${actedWhileDead} frames, last in ${worstWhileDead}`);
  check("...and it dies: gone from the pool", !ActorByAt(AT),
        `state ${ThrowerState[z.state] ?? z.state}/${z.sub}, hp ${z.hp}`);
  check("...out of `g_enemies_alive`", G.g_enemies_alive === 0,
        `${G.g_enemies_alive}`);
  check("...and out of `g_enemies_present`", G.g_enemies_present === 0,
        `${G.g_enemies_present}`);
}

// -- 14. the collision, against real quads -----------------------------------

console.log("coli/, the game's own collision:");
{
  ResetGameGlobals();
  T.coli = { files: ["test"], blobs: { wall: WALL_BLOB, floor: FLOOR_BLOB } };
  G.g_coli_full_set = ["wall", "floor"];
  G.g_camera_fixed_eye_y = -999;          // so a fallback is unmistakable

  // The wall's normal is -X, so its front is x < 30 — where the actor stands.
  // Every probe in the game traces **inward**, from a far point to the actor,
  // which is the direction the engine's `d0 <= 0 && d1 > 0` accepts.
  check("a segment across a quad hits it, at the quad's own plane",
        ColiTraceSegmentAllSets(60, 10, 45, 0, 10, 45)
        && Math.abs(G.g_coli_hit_x - 30) < 1e-4, `x ${G.g_coli_hit_x}`);
  check("...and reports the quad's material, which only coli/ carries",
        G.g_coli_hit_surface === 52, `${G.g_coli_hit_surface}`);
  // **A quad is one-sided.** The engine accepts only "behind, then in front",
  // and `g_coli_allow_backface` is written by nothing in the program — so the
  // same segment reversed does not hit at all. Reading the test as "opposite
  // signs" would make every wall in the game two-sided.
  check("the same segment reversed does not hit: quads are one-sided",
        !ColiTraceSegmentAllSets(0, 10, 45, 60, 10, 45));
  // Past the quad's own extent: the winding test refuses it.
  check("a segment past the quad's edge misses",
        !ColiTraceSegmentAllSets(60, 100, 45, 0, 100, 45));
  // Same side of the plane at both ends: no crossing, no hit.
  check("a segment that never crosses the plane misses",
        !ColiTraceSegmentAllSets(20, 10, 45, 0, 10, 45));
  // Nearest is measured from the **second** endpoint, which is what makes a
  // ground query find the floor under your feet and not the lowest in the map.
  T.coli = { files: ["test"], blobs: { hi: coliQuad([0, 1, 0, -20], 1,
      [-50, 20, 50, 50, 20, 50, 50, 20, -50, -50, 20, -50], 61),
    floor: FLOOR_BLOB } };
  G.g_coli_full_set = ["hi", "floor"];
  check("the nearer surface to the query's own end wins",
        QueryGroundHeightAt(0, 30, 0) === 20, `${QueryGroundHeightAt(0, 30, 0)}`);
  check("...and from below it is the low one",
        QueryGroundHeightAt(0, 10, 0) === 0, `${QueryGroundHeightAt(0, 10, 0)}`);
  T.coli = { files: ["test"], blobs: { wall: WALL_BLOB, floor: FLOOR_BLOB } };
  G.g_coli_full_set = ["wall", "floor"];

  check("the ground height comes off the floor quad",
        Math.abs(QueryGroundHeightAt(10, 20, 10)) < 1e-4,
        `${QueryGroundHeightAt(10, 20, 10)}`);
  check("...and falls back to the script's ground plane where there is none",
        QueryGroundHeightAt(10, 20, 9999) === -999,
        `${QueryGroundHeightAt(10, 20, 9999)}`);
  check("the surface query reports the material, 0 for a miss",
        QueryGroundSurfaceAt(10, 20, 10) === 52
        && QueryGroundSurfaceAt(10, 20, 9999) === 0);

  // The regression that cost a session: the winding test's sign factor is the
  // dominant normal component, but **negated on Y**, because dropping to the
  // (x, z) plane picks up the handedness of `x_hat x z_hat = -y_hat` while
  // (y, z) and (x, y) do not. One global polarity passes floors and rejects
  // every wall in the game -- or the reverse. All three axes, both signs.
  T.coli = { files: ["test"], blobs: {
    xneg: WALL_BLOB,
    xpos: coliQuad([1, 0, 0, 30], 0,
                   [-30, -10, 85, -30, -10, 5, -30, 40, 5, -30, 40, 85]),
    zneg: coliQuad([0, 0, -1, 30], 2,
                   [5, -10, 30, -75, -10, 30, -75, 40, 30, 5, 40, 30]),
    zpos: coliQuad([0, 0, 1, 30], 2,
                   [-75, -10, -30, 5, -10, -30, 5, 40, -30, -75, 40, -30]),
    yup: FLOOR_BLOB,
    ydown: coliQuad([0, -1, 0, 50], 1,
                    [-200, 50, -200, 200, 50, -200, 200, 50, 200,
                     -200, 50, 200]),
  } };
  G.g_coli_full_set = ["xneg", "xpos", "zneg", "zpos", "yup", "ydown"];
  const faces: [string, number[], number[]][] = [
    ["+x wall", [60, 10, 45], [0, 10, 45]],
    ["-x wall", [-60, 10, 45], [0, 10, 45]],
    ["+z wall", [-35, 10, 60], [-35, 10, 0]],
    ["-z wall", [-35, 10, -60], [-35, 10, 0]],
    ["floor", [0, -60, 0], [0, 10, 0]],
    ["ceiling", [0, 110, 0], [0, 10, 0]],
  ];
  const missed = faces.filter(([, a, b]) =>
    !ColiTraceSegmentAllSets(a[0], a[1], a[2], b[0], b[1], b[2]))
    .map(([n]) => n);
  check("every face orientation is hit from behind, on all three axes",
        missed.length === 0, `missed ${missed.join()}`);
  T.coli = { files: ["test"], blobs: { wall: WALL_BLOB, floor: FLOOR_BLOB } };
  G.g_coli_full_set = ["wall", "floor"];


  // The two sets differ in exactly one way: the sphere test ignores ray-only.
  G.g_coli_full_set = [];
  G.g_coli_ray_set = ["wall"];
  check("a ray-only blob still stops a segment",
        ColiTraceSegmentAllSets(60, 10, 45, 0, 10, 45));
  check("...but the sphere test does not see it",
        !ColiTestSphereAgainstFullSet(28, 10, 45, 5));
  G.g_coli_full_set = ["wall"];
  check("and it does once the blob is in the full set",
        ColiTestSphereAgainstFullSet(28, 10, 45, 5)
        && Math.abs(G.g_coli_hit_depth - 3) < 1e-4,
        `depth ${G.g_coli_hit_depth}`);
}

console.log("\nclass 0x10, the civilian and the rescue:");
{
  const rng = new Rng(9);

  /**
   * One civilian, one script, and however many captors the test wants.
   *
   * The streams are the exe's; here they are hand-written in the same shape
   * the exporter emits, so the VM is driven with no bundle and no renderer.
   *
   * **Every fixture opens with a `Wait`**, because every shipped stream does.
   * `CivilianRunScript` runs its first command whatever it is and stops
   * *before* the next opcode above 0x2B — so a stream that does not open with
   * one never loads a wait word at all and parks on the zero it started with.
   */
  const civScene = (cmds: CivilianCmdJson[][], children: number[] = [],
                    items: CivilianItemJson[] = [], seed?: number) => {
    ResetGameGlobals();
    SetGameTables(CHARS, undefined, undefined, undefined, undefined, {
      entries: [0],
      scripts: cmds,
      items,
      spawns: {
        "16384": {
          charType: 1, script: 0, removePath: -1, removeFrame: 0,
          removeDelay: 0,
          children: children.map((at) => ({
            at, class: 0x30, charType: 1,
            pos: [0, 0, 0] as [number, number, number], yaw: 0, hp: 1,
          })),
        },
      },
    });
    const kids = children.map((at) => {
      const k = spawnZombie(at, 1, "captor");
      k.visible = true;
      return k;
    });
    const a = ActorSpawn(0x4000, SpawnClass.Civilian, 1, "civilian",
                         undefined, seed === undefined ? rng : new Rng(seed));
    a.visible = true;
    a.pos = vec3(0, 0, 0);
    return { a, kids, events: new Events() };
  };
  const cFrame = (a: ReturnType<typeof ActorSpawn>, events: Events) =>
    CivilianUpdate(a, { eye: EYE, dt: 1 / 60, rng, host: NULL_HOST, events });
  const cmd = (op: CivilianOp, ...args: number[]): CivilianCmdJson =>
    ({ op, args });
  const cmdKill = (scripts: number[], ...args: number[]): CivilianCmdJson =>
    ({ op: CivilianOp.SetOnShot, args, scripts });

  // The VM runs a whole block in one go and parks on the next wait. A wait
  // word leads its block and governs the wait that *follows* it, which is why
  // a stream opens with one.
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetTurnRate, 77),
      cmd(CivilianOp.SetCiviliansGoal, 3),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetTurnRate, 88),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]]);
    check("the Init runs a whole block and parks on the next wait",
          a.civ?.cursor === 3 && a.civ?.turnRate === 77
          && a.civ?.civiliansGoal === 3,
          `cursor ${a.civ?.cursor} rate ${a.civ?.turnRate}`);
    for (let i = 0; i < 20; i++) cFrame(a, events);
    check("...and a wait word with no bits and no timer never resumes",
          a.civ?.turnRate === 77 && a.civ?.cursor === 3,
          `rate ${a.civ?.turnRate} cursor ${a.civ?.cursor}`);
  }

  // Wait bit 0x2000 reads `g_script_flags`, and a flag the script has never
  // set is *absent* from the array — which is a hole an undefined slips
  // straight through if the read is not defaulted.
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, CivilianWait.ScriptFlag),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetTurnRate, 77),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]]);
    for (let i = 0; i < 5; i++) cFrame(a, events);
    check("an unset script flag holds the wait rather than passing it",
          a.civ?.turnRate === 10, `rate ${a.civ?.turnRate}`);
    G.g_script_flags[0] = 1;
    cFrame(a, events);
    check("...and raising it lets the block run",
          a.civ?.turnRate === 77, `rate ${a.civ?.turnRate}`);
  }

  // Wait bit 0x1000 is **three** conditions (`0x0048B2F8`): the arm only
  // applies while `g_scene_state_major_entered` is 2, and it then releases on
  // `g_camera_settled` **or** `g_camera_free`. The port read the middle one
  // alone, which is wrong in both directions — and the direction that cost a
  // stage is the missing `g_camera_free`, because
  // `CameraTrackEnemiesTick` only ever raises `settled` while nothing is
  // tracked. Stage 2 block 9's `wait_script_flag 3` is raised by such a
  // civilian and could never come down.
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, CivilianWait.CameraSettled),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetTurnRate, 77),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]]);
    G.g_scene_state_major_entered = 2;
    G.g_camera_settled = 0;
    G.g_camera_free = 0;
    for (let i = 0; i < 5; i++) cFrame(a, events);
    check("bit 0x1000 holds while the camera is neither settled nor free",
          a.civ?.turnRate === 10, `rate ${a.civ?.turnRate}`);
    G.g_camera_free = 1;
    cFrame(a, events);
    check("...and `g_camera_free` alone releases it",
          a.civ?.turnRate === 77, `rate ${a.civ?.turnRate}`);
  }
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, CivilianWait.CameraSettled),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetTurnRate, 77),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]]);
    // Row 1 minor 3 is `CameraFromViewAngles`, the scripted view-angle turn.
    G.g_scene_state_major_entered = 1;
    G.g_camera_settled = 1;
    G.g_camera_free = 1;
    for (let i = 0; i < 5; i++) cFrame(a, events);
    check("...and off the path-camera row the arm releases nothing at all",
          a.civ?.turnRate === 10, `rate ${a.civ?.turnRate}`);
  }

  // The timer, op 0x09. It does **not** delay its own block: `CivilianStep-
  // Script` clears the timer on every resume, and the value that survives is
  // the one `CivilianReapplyWaitCommand` reads out of the block ahead. So a
  // timer set in one block delays the wait at the end of it, and a timer of
  // `n` costs `n + 1` frames because the test reads before the decrement.
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, CivilianWait.Free),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetTimer, 3),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetTurnRate, 77),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]]);
    cFrame(a, events);
    check("the timer's own block runs at once and parks with it armed",
          a.civ?.timer === 3 && a.civ?.cursor === 3 && a.civ?.turnRate === 10,
          `timer ${a.civ?.timer} cursor ${a.civ?.cursor}`);
    for (let i = 0; i < 3; i++) cFrame(a, events);
    check("a timer holds the next block for the frames it names",
          a.civ?.turnRate === 10, `rate ${a.civ?.turnRate}`);
    cFrame(a, events);
    check("...and releases it on the frame it reads zero",
          a.civ?.turnRate === 77, `rate ${a.civ?.turnRate}`);
  }

  // **The rescue.** Wait bit 0x04 blocks while more than `childrenGoal` of
  // the civilian's captors are alive; the block it unblocks carries the
  // 0x10000000 bit, which is where the 400 is paid.
  {
    const { a, kids, events } = civScene([[
      cmd(CivilianOp.Wait, CivilianWait.Free),
      cmd(CivilianOp.SetChildrenGoal, 0),
      cmd(CivilianOp.Wait, CivilianWait.ChildrenAlive),
      cmd(CivilianOp.Wait, CivilianWait.Rescued),
      cmd(CivilianOp.End),
    ]], [0x4100, 0x4200]);
    let paid = 0;
    events.on("civilian.rescued", () => { paid += 1; });
    check("the civilian starts holding both its captors",
          a.civ?.childCount === 2, `${a.civ?.childCount}`);
    for (let i = 0; i < 5; i++) cFrame(a, events);
    check("...and the rescue does not pay while either is alive",
          G.g_player_score[0] === 0 && paid === 0,
          `score ${G.g_player_score[0]}`);
    kids[0].dead = true;
    cFrame(a, events);
    check("one captor down is not enough",
          a.civ?.childCount === 1 && G.g_player_score[0] === 0,
          `left ${a.civ?.childCount} score ${G.g_player_score[0]}`);
    kids[1].dead = true;
    cFrame(a, events);
    check("the last captor down pays 400 -- to both players, since the port "
          + "cannot name a shooter",
          paid === 1 && G.g_player_score[0] === 400
          && G.g_player_score[1] === 400,
          `paid ${paid} ${G.g_player_score.join("/")}`);
  }

  // Shooting one. `SetOnShot` is the gate: without it the hit bits are simply
  // cleared and the civilian cannot be hurt at all.
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, 0), cmd(CivilianOp.End),
    ]]);
    G.g_player_lives = [2, 2];
    a.flags |= 8;
    cFrame(a, events);
    check("a civilian with no on-shot script cannot be shot",
          G.g_player_lives[0] === 2 && G.g_player_score[0] === 0 && !a.dead,
          `lives ${G.g_player_lives[0]} score ${G.g_player_score[0]}`);
  }
  {
    // The exporter resolves op 0x0E's pointer to a stream index, so the
    // fixture carries `scripts` the same way.
    const { a, events } = civScene([
      [cmd(CivilianOp.Wait, CivilianWait.Free),
       { op: CivilianOp.SetOnShot, args: [1], scripts: [1] },
       cmd(CivilianOp.Wait, 0), cmd(CivilianOp.End)],
      [cmd(CivilianOp.Wait, 0), cmd(CivilianOp.SetTurnRate, 55),
       cmd(CivilianOp.Wait, 0), cmd(CivilianOp.End)],
    ]);
    G.g_player_lives = [2, 2];
    G.g_player_score = [0, 0];
    let shot = 0;
    events.on("civilian.shot", () => { shot += 1; });
    a.flags |= 8 | 2;                       // hit, and bit 1 names player 0
    cFrame(a, events);
    // -200, not -100: `PlayerTakeDamage` charges its own 100 for the life and
    // `CivilianUpdate` charges another for the civilian. That is what
    // "-100 twice" in docs/formats/spawns.md is.
    check("shooting a civilian costs a life and 100 points twice",
          shot === 1 && G.g_player_lives[0] === 1
          && G.g_player_score[0] === -200,
          `lives ${G.g_player_lives[0]} score ${G.g_player_score[0]}`);
    check("...and switches it to the on-shot script",
          a.civ?.turnRate === 55 && a.dead, `rate ${a.civ?.turnRate}`);
  }
  {
    const { a, events } = civScene([
      [cmd(CivilianOp.Wait, CivilianWait.Free),
       { op: CivilianOp.SetOnShot, args: [1], scripts: [1] },
       cmd(CivilianOp.Wait, 0), cmd(CivilianOp.End)],
      [cmd(CivilianOp.Wait, 0), cmd(CivilianOp.End)],
    ]);
    G.g_player_lives = [2, 2];
    G.g_player_score = [0, 0];
    a.flags |= ActorFlag.Dead;              // a killing shot
    cFrame(a, events);
    check("a killing shot charges 100 to BOTH players and no life",
          G.g_player_score[0] === -100 && G.g_player_score[1] === -100
          && G.g_player_lives[0] === 2,
          `${G.g_player_score.join("/")} lives ${G.g_player_lives[0]}`);
  }

  // The held items, ops 0x13-0x15. The weighted pick is `rand() %% total`
  // walked down the list, and it comes from `ctx.rng` -- which is what makes
  // "which bottle is this civilian holding" survive a save state.
  {
    const items: CivilianItemJson[] = [
      { bone: 5, slot: 0x1000, kind: -1, rot: [0, 0, 0],
        sets: Array.from({ length: 6 },
                         (_, i) => [i, 0, 0, 1] as [number, number, number,
                                                    number]) },
      { bone: 5, slot: 0x1001, kind: -1, rot: [0, 0, 0],
        sets: Array.from({ length: 6 },
                         (_, i) => [i, 0, 0, 1] as [number, number, number,
                                                    number]) },
    ];
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, CivilianWait.Free),
      { op: CivilianOp.PickHeldItem, args: [1], itemTable: [[1, 0], [3, 1]] },
      { op: CivilianOp.AddPickedItem, args: [0] },
      { op: CivilianOp.AddHeldItem, args: [0, 0], item: 0 },
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]], [], items);
    check("the pick and both appends land in one block",
          a.civ?.items.length === 2 && a.civ?.pickedItem !== -1,
          `items ${JSON.stringify(a.civ?.items)}`);
    check("...and the second append is the record op 0x13 names",
          a.civ?.items[1] === 0, `${a.civ?.items[1]}`);
    // The weights are 1 and 3, so the second record is three times as likely.
    // Asserting a *distribution* rather than a value is what catches a walk
    // that always takes the head -- which is the easy way to get this wrong.
    let second = 0;
    for (let seed = 0; seed < 40; seed++) {
      const one = civScene([[
        cmd(CivilianOp.Wait, CivilianWait.Free),
        { op: CivilianOp.PickHeldItem, args: [1],
          itemTable: [[1, 0], [3, 1]] },
        cmd(CivilianOp.Wait, 0),
        cmd(CivilianOp.End),
      ]], [], items, seed);
      if (one.a.civ?.pickedItem === 1) second += 1;
    }
    check("the weighted pick is weighted, not always the head",
          second > 20 && second < 40, `${second}/40 took the 3:1 entry`);
    void events;
  }

  // `sub+0x82`: one record, six attach sets, chosen by the character type.
  {
    check("the attach set comes from the character type",
          CivilianAttachSet(0x20) === 0 && CivilianAttachSet(0x24) === 4
          && CivilianAttachSet(0x26) === 1 && CivilianAttachSet(0x27) === 2
          && CivilianAttachSet(0x2e) === 3 && CivilianAttachSet(0x99) === 5);
  }

  // Op 0x11's skip count, which is what `CivilianReapplyWaitCommand` is for:
  // the skipped block's *conditions* are re-applied and its actions are not.
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, CivilianWait.Free),
      cmd(CivilianOp.SetSkipCount, 1),
      cmd(CivilianOp.Wait, CivilianWait.Free),
      cmd(CivilianOp.SetTurnRate, 66),      // skipped: not a wait condition
      cmd(CivilianOp.SetEnemiesGoal, 5),    // re-applied: it is one
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]]);
    cFrame(a, events);
    check("a skipped block re-applies its wait conditions...",
          a.civ?.enemiesGoal === 5, `goal ${a.civ?.enemiesGoal}`);
    check("...and does not run its actions",
          a.civ?.turnRate !== 66, `rate ${a.civ?.turnRate}`);
  }

  // **Does a dead civilian leave `g_civilians_alive`?** This is the counter
  // `wait_scripted_actors` blocks on, and a civilian that dies without leaving
  // it parks the script for ever. `CivilianInit` raises the count
  // unconditionally; the way back out on a death is the on-shot script's own
  // `Wait` word carrying `LeaveCountNow` -- and 59 of the 60 streams the shipped
  // scripts use as a death script do carry it, so this is the path that matters.
  {
    const cmdS = (op: CivilianOp, scripts: number[],
                  ...args: number[]): CivilianCmdJson => ({ op, args, scripts });

    // Stream 0 is the life, stream 1 the death. The death stream leaves the
    // count the way the game's own death scripts do.
    const { a, events } = civScene([
      [cmd(CivilianOp.Wait, 0),
       cmdS(CivilianOp.SetOnShot, [1], 1),
       cmd(CivilianOp.Wait, 0)],
      [cmd(CivilianOp.Wait, CivilianWait.LeaveCountNow),
       cmd(CivilianOp.End)],
    ]);
    cFrame(a, events);
    check("a civilian in play is counted", G.g_civilians_alive === 1,
          `${G.g_civilians_alive}`);


    // What the maul does to it: `ZombieStateTargetMotionScript` raises the same
    // bit a killing shot raises on the civilian's `obj+0x34`.
    a.flags |= ActorFlag.Dead;
    cFrame(a, events);
    check("...and leaves the count when it is killed",
          G.g_civilians_alive === 0, `${G.g_civilians_alive} still counted`);

    // And it does not leave twice: the removal that follows a death must not
    // decrement again, or the count goes negative and a later `wait_scripted_
    // actors` passes while civilians are still standing.
    for (let i = 0; i < 8; i++) cFrame(a, events);
    check("...exactly once, however long it lies there",
          G.g_civilians_alive === 0, `${G.g_civilians_alive}`);
  }
  // **The record fills the object, then `Init` runs — in that order.**
  // `SpawnFromDescriptor` (`FUN_00408A20`) does it that way, and
  // `CivilianInit` (`FUN_0048A3E0`) runs the civilian's script as its last
  // act, so the script's opening `SetMotion` is what the actor plays. The
  // player was assigning the placement's own motion *after* `ActorSpawn`
  // returned, which put it straight back: every civilian in the game stood in
  // its spawn pose -- a hostage on 660 rather than the 371 her script asks for
  // -- while her script ran on underneath it.
  {
    civScene([[cmd(CivilianOp.Wait, 0),
               cmd(CivilianOp.SetMotion, 10, -1),
               cmd(CivilianOp.Wait, 0)]]);
    const posed = ActorSpawn(0x4000, SpawnClass.Civilian, 1, "posed",
                             { motion: 900 }, new Rng(3));
    check("the class Init's motion outlives the record's",
          posed.motion === 10, `motion ${posed.motion}`);
  }

  // **`LAB_0048b52e` is one label reached from three places.** The in-front
  // test, the camera cue and the timer sit together at the bottom of
  // `CivilianStepScript` (`FUN_0048B1E0`), and all three arrival arms fall
  // into them — a word with neither `Reach` nor `Face` jumps straight there.
  // The port had that tail written out twice with the in-front test in only
  // one copy, so a word carrying `InFront` alone ran no test at all and could
  // be released by nothing but a timer it did not have. Stage 2's `0x138BC`
  // held `g_civilians_alive` at one and `wait_scripted_actors` at block 30
  // never came down.
  {
    // A wait word leads its block and governs the wait that *follows* it, so
    // the in-front word has to be the first command: the Init then parks on
    // the wait at index 1 with that word governing it.
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, CivilianWait.InFront),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetTurnRate, 77),
      cmd(CivilianOp.Wait, 0),
    ]]);
    // The target is behind her, so the wait holds...
    a.pos = vec3(0, 0, 0);
    a.yaw = 0;
    // Behind her: the rotated delta's z is negative at yaw 0. `targetMode` is
    // left at `None` so the turn step does not run and this is the in-front
    // test on its own.
    if (a.civ) {
      a.civ.target = { x: 0, y: 0, z: -30 };
      a.civ.targetMode = CivilianTarget.None;
    }
    const before = a.civ?.cursor;
    cFrame(a, events);
    check("an in-front wait holds while the target is behind",
          a.civ?.cursor === before && a.civ?.turnRate !== 77,
          `cursor ${a.civ?.cursor}`);
    // ...and releases the frame it is in front, with no timer involved.
    a.yaw = 0x8000;                              // half a turn: now in front
    cFrame(a, events);
    check("...and releases the frame it comes round, timer or no timer",
          a.civ?.turnRate === 77, `turn ${a.civ?.turnRate}`);
  }

  // **The civilian turn cap is a literal, and it is not the script's.**
  // `CivilianStepTurnToTarget` (`FUN_0048C850`) passes `0x100` to
  // `ActorTurnTowardPoint` and never reads `sub+0x0E`; the port passed that
  // field, whose default is ten. Twenty-five times too slow is the difference
  // between a civilian turning round in a couple of seconds and taking most of
  // a minute, and stage 2's `0x138BC` had a `Face` wait behind a 194-degree
  // turn — `wait_scripted_actors` at block 30 waited the whole time.
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, CivilianWait.Face),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetTurnRate, 55),
      cmd(CivilianOp.Wait, 0),
    ]]);
    a.pos = vec3(0, 0, 0);
    a.yaw = 0;
    if (a.civ) {
      // 0x8A00 is 194 degrees — the turn her own `SetTargetHeading` asks for.
      const h = 0x8a00 * ((Math.PI * 2) / 65536);
      a.civ.target = { x: Math.sin(h) * 100, y: 0, z: Math.cos(h) * 100 };
      a.civ.targetMode = 1;
    }
    let frames = 0;
    while (frames < 3000 && a.civ?.turnRate !== 55) {
      cFrame(a, events);
      frames += 1;
    }
    check("a civilian turns at the engine's cap, not the script's rate",
          a.civ?.turnRate === 55 && frames < 200, `${frames} frames`);
  }


  // **The debug clear has to kill what the civilian gate counts too.** A room
  // cleared of enemies with the hostages still standing is a script that has
  // not moved: `wait_scripted_actors` counts civilians, not enemies. Killing
  // one is not `dead = true` either — `CivilianCheckShot` reads
  // `ActorFlag.Dead` and runs her killed script off it, and that script is
  // what carries `LeaveCountNow`.
  {
    const { a, events } = civScene([
      [cmd(CivilianOp.Wait, 0), cmdKill([1], 1), cmd(CivilianOp.Wait, 0)],
      [cmd(CivilianOp.Wait, CivilianWait.LeaveCountNow), cmd(CivilianOp.End)],
    ]);
    cFrame(a, events);
    check("a civilian is in the count before the clear",
          G.g_civilians_alive === 1, `${G.g_civilians_alive}`);

    const cleared = ActorKillAll(0, new Rng(2));
    check("the clear counts her as a civilian, not an enemy",
          cleared.civilians === 1 && cleared.enemies === 0,
          JSON.stringify(cleared));
    // **And what a shot could not touch, the clear must not touch either.**
    // A civilian with no on-shot script has its hit bits cleared every frame by
    // `CivilianCheckShot` — the ones behind glass — so no player can kill it.
    // The clear killing it anyway strands it: dead, still counted in
    // `g_civilians_alive`, and with no killed script to run the
    // `LeaveCountNow` that would take it out. Stage 2's `0x138BC` is one, and
    // it held `wait_scripted_actors` open for ever.
    {
      const safe = ActorSpawn(0x4020, SpawnClass.Civilian, 1, "behind glass");
      safe.visible = true;
      if (safe.civ) safe.civ.onShotScript = -1;
      ActorKillAll(0, new Rng(4));
      // **A civilian the script stops listing leaves the count with it.** The
    // engine has no such moment — every one of `ActorDespawn`'s 171 call sites
    // is inside a class's own state machine — so `RetireUnlistedActor` is the
    // port's seam for a spawn list entry going away, and it runs the class's
    // own leave routine rather than inventing one. Unmaking used to be a hide:
    // the actor stayed in the pool, invisible and still counted, and
    // `wait_scripted_actors` held on a number nothing could bring down.
    {
      const before = G.g_civilians_alive;
      // The fixture has one civilian record, so this borrows it: what is being
      // measured is the count, not the address.
      const going = ActorSpawn(0x4000, SpawnClass.Civilian, 1, "unlisted");
      going.visible = true;
      check("a civilian joins the count when it is made",
            G.g_civilians_alive === before + 1, `${G.g_civilians_alive}`);
      RetireUnlistedActor(going);
      check("...and leaves it when the script stops listing it",
            G.g_civilians_alive === before && going.despawned,
            `${G.g_civilians_alive} despawned ${going.despawned}`);
      // Calling it twice **would** count it out twice, and the engine is no
      // different: `CivilianUpdate`'s tail guards on `sub+0x04` bit 0, which
      // op 0x2C's `LeaveCountNow` sets and a despawn does not. Not doing it
      // twice is the caller's job, and `CharacterLayer.syncSpawns` hands back
      // only the actors that had not already removed themselves.
    }

    check("the clear leaves a civilian no shot could reach alive",
            !safe.dead && (safe.flags & ActorFlag.Dead) === 0,
            `dead ${safe.dead} flags 0x${safe.flags.toString(16)}`);
      safe.visible = false;
    }

    check("...and raises the bit her own machine reads",
          (a.flags & ActorFlag.Dead) !== 0, `flags 0x${a.flags.toString(16)}`);
    // The shared directional death is class 0x30's, from its state 6. Handed
    // to a civilian it stops `ActorAdvanceMotion` before the base clock, so
    // the killed script's own motion cue could never fire.
    check("...but not the shared death clip, which is not hers",
          a.death === null, `death ${JSON.stringify(a.death)}`);

    // Her *killed script* is the thing to assert, not the count: the fixture's
    // removal cue drains that on its own, so a count check here passes with
    // the flag removed and proves nothing.
    cFrame(a, events);
    check("so her own killed script is what runs", a.civ?.script === 1,
          `stream ${a.civ?.script}`);
  }

  // Op 0x19 -- `g_script_branch_var = (s16)cmd[1]`, which is how the game
  // decides which way a branching stage goes. Eleven of the 136 shipped
  // streams run it, all eleven pass 1, and all eleven put it after the
  // `SetOnShot 0` that makes the civilian safe: a rescued civilian takes the
  // alternate route.
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetOnShot, 0),
      cmd(CivilianOp.SetRouteBranch, 1),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]]);
    check("a rescued civilian writes the route branch",
          G.g_script_branch_var === 1, String(G.g_script_branch_var));
    // Nothing else in the port writes it, so the actor really is the source.
    for (let i = 0; i < 10; i++) cFrame(a, events);
    check("...and nothing in the port's frame walks it back",
          G.g_script_branch_var === 1, String(G.g_script_branch_var));
  }

  // The store is a **word**. The command is a dword and no shipped stream
  // needs the difference, but a port that widened it would be inventing a
  // route index the engine cannot express.
  {
    civScene([[
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetRouteBranch, 0x1_0002),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]]);
    check("the branch write is truncated to s16, as `MOV word ptr` is",
          G.g_script_branch_var === 2, String(G.g_script_branch_var));
    civScene([[
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetRouteBranch, 0xFFFF),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]]);
    check("...and sign-extended, so 0xFFFF is -1 and not 65535",
          G.g_script_branch_var === -1, String(G.g_script_branch_var));
  }

  // **Does a civilian's clip carry her?**
  //
  // The director gives every visible actor `ActorAdvanceMotion` and then its
  // class handler, so that is the pair driven here — `cFrame` alone is the VM
  // and the VM does not touch the position. Everything below asserts on
  // `a.pos`, because "the port thinks root motion is on" is the question the
  // last round of this got right while the civilians stood still.
  const cWalk = (a: ReturnType<typeof ActorSpawn>, events: Events,
                 frames: number) => {
    const z0 = a.pos.z, x0 = a.pos.x;
    for (let i = 0; i < frames; i++) {
      ActorAdvanceMotion(a, 1 / 60);
      cFrame(a, events);
    }
    return { dz: a.pos.z - z0, dx: a.pos.x - x0 };
  };
  // Motion 12 is `motion(16, 1.289)` — sixteen frames running along -Z, the
  // clip the zombie's own root-motion test uses. A civilian playing it with
  // `loops = -1` plays it for ever.
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, CivilianWait.RootMotion),
      cmd(CivilianOp.SetMotion, 12, -1),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]]);
    const gate = a.motionFlags & MotionFlag.RootMotion;
    const d = cWalk(a, events, 120);
    check("a civilian's clip carries her: two seconds of motion 12 walks -Z",
          gate !== 0 && d.dz < -10 && Math.abs(d.dx) < 0.01,
          `gate ${gate} dz ${d.dz.toFixed(3)} dx ${d.dx.toFixed(3)}`);
  }
  // The other half of the same switch, and the reason the first assertion is
  // not enough on its own: `CivilianRunScript` op 0x00 *clears* `model+0x64`
  // bit 1 when the block's wait word has no `0x00100000`, and 297 of the 596
  // shipped wait words do not. Those clips animate in place.
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.SetMotion, 12, -1),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]]);
    const gate = a.motionFlags & MotionFlag.RootMotion;
    const d = cWalk(a, events, 120);
    check("...and a block without the bit plays the same clip in place",
          gate === 0 && d.dz === 0 && d.dx === 0,
          `gate ${gate} dz ${d.dz.toFixed(3)} dx ${d.dx.toFixed(3)}`);
  }
  // **The bug this pair was written for.** `SetHudShutterState`,
  // `SetAttachMode`, `SetAttachTarget` and `SetPairA` all used to fall through
  // into `SetScale`'s body — so their operands, small integers, were
  // reinterpreted as float bit patterns into `obj.scale`.
  // `AsFloat(2)` is 2.8e-45, `SkeletonApplyRootMotion` multiplies the root
  // delta by it, and the civilian stopped moving while her legs kept walking.
  // 125 commands in the shipped streams run one of those four. The first has
  // a body of its own now — see the shutter block below — and the other three
  // are still unread; neither writes `model+0x116C`.
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, CivilianWait.RootMotion),
      cmd(CivilianOp.SetPairA, 1, 2),
      cmd(CivilianOp.SetAttachMode, 2),
      cmd(CivilianOp.SetHudShutterState, 1),
      cmd(CivilianOp.SetMotion, 12, -1),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]]);
    const d = cWalk(a, events, 120);
    check("the unread opcodes leave `model+0x116C` alone, so she still walks",
          a.scale === 1 && d.dz < -10,
          `scale ${a.scale} dz ${d.dz.toFixed(3)}`);
  }
  // Op 0x27 is the one command that may write it, and its operand really is a
  // float bit pattern: `MOV dword ptr [model + 0x116c], param_2[1]`. The one
  // shipped instance passes `0x42480000`, which is 50.0.
  {
    const { a, events } = civScene([[
      cmd(CivilianOp.Wait, CivilianWait.RootMotion),
      cmd(CivilianOp.SetScale, 0x42480000 | 0),
      cmd(CivilianOp.SetMotion, 12, -1),
      cmd(CivilianOp.Wait, 0),
      cmd(CivilianOp.End),
    ]]);
    const d = cWalk(a, events, 60);
    check("...and op 0x27 does write it, scaling the ground she covers with it",
          a.scale === 50 && d.dz < -300,
          `scale ${a.scale} dz ${d.dz.toFixed(3)}`);
  }
}

console.log("\nclass 0x30's captor family — the zombies work on the civilian:");
{
  const rng = new Rng(11);

  /** One civilian and one captor, wired the way the exporter wires them. */
  const captorScene = (initial: number, attack: number,
                       target: TargetScriptJson | null,
                       civCmds: CivilianCmdJson[][] = [[
                         { op: CivilianOp.Wait, args: [0] },
                         { op: CivilianOp.End, args: [] },
                       ]],
                       attackScript: TargetScriptJson | null = null) => {
    ResetGameGlobals();
    SetGameTables(CHARS, undefined, undefined, undefined, undefined, {
      entries: [0], scripts: civCmds, items: [],
      spawns: {
        "16384": {
          charType: 1, script: 0, removePath: -1, removeFrame: 0,
          removeDelay: 0,
          children: [{ at: 0x4100, class: 0x30, charType: 1,
                       pos: [0, 0, 0] as [number, number, number],
                       yaw: 0, hp: 1 }],
        },
      },
    });
    const civ = ActorSpawn(0x4000, SpawnClass.Civilian, 1, "civilian");
    civ.visible = true;
    civ.pos = vec3(0, 0, 0);
    const z = spawnZombie(0x4100, 1, "captor", {
      initialState: initial, attackState: attack,
      script: { target, attack: attackScript }, targetAt: 0x4000,
    }, rng);
    z.visible = true;
    z.pos = vec3(0, 0, 40);
    return { civ, z, events: new Events() };
  };
  const zFrame = (z: ZombieActor, events: Events) =>
    EnemyZombieUpdate(z, { eye: EYE, dt: 1 / 60, rng, host: NULL_HOST, events });

  // The bug this family fixes: an unmodelled captor state fell through
  // `ZombieEntryState` to `AttackRun` and the zombie went for the camera.
  {
    const { z } = captorScene(ZombieState.WalkToTarget, 1, null);
    check("a captor starts in its own state, not in AttackRun",
          z.state === ZombieState.WalkToTarget, `state ${z.state}`);
  }

  // **The grab.** `ZombieStateWalkToTarget` raises the civilian's own `Free`
  // wait bit the frame it gets close enough — which is the civilian's cue.
  {
    const script: TargetScriptJson = {
      state: ZombieState.WalkToTarget,
      head: { arrive: 10, loops: 1, motion: 10, frame: 0 },
      entries: [{ motion: 10, frame: 0, loops: 1, mode: 5 }],
    };
    const { civ, z, events } = captorScene(ZombieState.WalkToTarget, 1,
                                           script);
    zFrame(z, events);
    check("...and walks at the civilian rather than the camera",
          z.sub === 2 && z.zom.targetArrive === 10, `sub ${z.sub}`);
    zFrame(z, events);
    check("out of reach it stays in the walk",
          z.state === ZombieState.WalkToTarget
          && !(civ.civ!.wait & CivilianWait.Free), `state ${z.state}`);
    z.pos = vec3(0, 0, 4);                     // inside the arrive radius
    zFrame(z, events);
    check("inside the radius it hands over to the maul...",
          z.state === ZombieState.TargetMotionScript && z.sub === 1,
          `state ${z.state} sub ${z.sub}`);
    check("...and raises the civilian's own `Free` wait bit, which is the grab",
          (civ.civ!.wait & CivilianWait.Free) !== 0,
          `wait ${civ.civ!.wait.toString(16)}`);
  }

  // **The maul.** The cue frame raises `0x4000000` on the civilian — the same
  // bit a killing shot raises, so it costs both players a hundred points.
  {
    const script: TargetScriptJson = {
      state: ZombieState.TargetMotionScript,
      head: {},
      entries: [{ motion: 10, frame: 0, loops: 1, mode: 3 }],
    };
    const { civ, z, events } = captorScene(ZombieState.TargetMotionScript, 1,
                                           script);
    let killed = false;
    events.on("sound.play", () => { killed = true; });
    zFrame(z, events);
    check("the maul opens on the script's first entry",
          z.motion === 10 && z.zom.targetCue === 3 && z.sub === 2,
          `motion ${z.motion} cue ${z.zom.targetCue}`);
    check("and has not touched the civilian yet",
          !(civ.flags & ActorFlag.Dead));
    // Cue 3 in the **play** clock, which ticks at 60 Hz over 30 Hz data — so
    // three sixtieths, not three thirtieths. This fixture encoded the wrong
    // one, and it agreed with a `frameOf` that was also counting in authored
    // frames: two halves of the same mistake, which is why the corpus (three
    // of stage 1's four maul cues never firing) caught it and this did not.
    z.playTicks = 3;
    zFrame(z, events);
    check("on the cue frame it kills the civilian outright",
          (civ.flags & ActorFlag.Dead) !== 0 && killed,
          `flags ${civ.flags.toString(16)}`);
  }

  // **The order.** Class 0x10's op 0x1A writes a state and a countdown into
  // its own block, and `ZombieStateAwaitCivilianOrder` is the captor sitting
  // on it. `0x31` means die.
  {
    const { civ, z, events } = captorScene(
      ZombieState.AwaitCivilianOrder, 1, null,
      [[{ op: CivilianOp.Wait, args: [CivilianWait.Free] },
        { op: CivilianOp.SetChildCue, args: [ZombieState.OrderDie, 2] },
        { op: CivilianOp.Wait, args: [0] },
        { op: CivilianOp.End, args: [] }]]);
    check("the civilian's op 0x1A is an order to its captors, not a spare word",
          civ.civ!.childOrder === ZombieState.OrderDie
          && civ.civ!.childOrderFrames === 2,
          `order ${civ.civ!.childOrder}/${civ.civ!.childOrderFrames}`);
    zFrame(z, events);            // sub 0 -> 1, saves the flags
    zFrame(z, events);            // takes the order
    check("...and the captor obeys it: 0x31 is die",
          z.dead && (z.flags & ActorFlag.Dead) !== 0,
          `dead ${z.dead} state ${z.state}`);
  }

  // **B6 — an ordered captor still needs its target script.**
  //
  // A captor whose descriptor starts it in state 39 is put into a state by
  // the civilian, and `ZombieScriptForState` (`FUN_0045CA10`) then hands *that*
  // state the tail+0x04 blob. The exporter used to decode that blob with state
  // 39's header shape, which does not exist, so it exported `null` — and this
  // state reads a zero arrive radius out of a missing script and walks at the
  // civilian for ever. Stage 1 block 9's 0x4B74 and 0x4BD0 are the two that
  // did it; their real header is `arrive 12.0, motion 1026`.
  //
  // The producer is checked by `tools/verify_captor_scripts.py`; this is the
  // consumer, and it is the assertion that says a null script is not survivable
  // rather than merely unusual.
  {
    const ordered: TargetScriptJson = {
      state: ZombieState.WalkToTarget,
      head: { arrive: 12, loops: 1, motion: 10, frame: 0 },
      entries: [{ motion: 10, frame: 0, loops: 1, mode: 5 }],
    };
    const { civ, z, events } = captorScene(ZombieState.AwaitCivilianOrder,
      ZombieState.WalkPastPoint, ordered,
      [[{ op: CivilianOp.Wait, args: [CivilianWait.Free] },
        { op: CivilianOp.SetChildCue, args: [ZombieState.WalkToTarget, 2] },
        { op: CivilianOp.Wait, args: [0] },
        { op: CivilianOp.End, args: [] }]]);
    zFrame(z, events);                       // sub 0 -> 1
    zFrame(z, events);                       // takes the order
    check("an ordered captor enters the state its civilian named",
          z.state === ZombieState.WalkToTarget, `state ${z.state}`);
    zFrame(z, events);
    check("...and reads the tail+0x04 header the order's state gives it",
          z.zom.targetArrive === 12, `arrive ${z.zom.targetArrive}`);
    z.pos = vec3(0, 0, 6);                   // inside 12, outside the old 0
    zFrame(z, events);
    check("...so it can arrive, and hand over to the maul",
          z.state === ZombieState.TargetMotionScript, `state ${z.state}`);
    check("...which is what frees the civilian",
          (civ.civ!.wait & CivilianWait.Free) !== 0,
          `wait ${civ.civ!.wait.toString(16)}`);
  }

  // **A captor waiting on the order is not drawn.** `FUN_0045BAD0` sub 0
  // clears `obj+0x1F8` bit 0 and writes 0 to the model's first part-draw byte
  // through `obj+0x1D4`, and taking the order puts both back — so the two
  // `znebi2` of stage 2 block 16 are in the water, invisible, until their
  // civilian calls them up. Reported as "they're always visible"; the port had
  // neither write, and nothing in `render/` read the flag that models them.
  //
  // And the order arm ends in `g_class30_states[obj+0x1310](obj)`, a tail call
  // through the table, so the state it hands over to runs on the **same**
  // frame rather than the next one.
  {
    const ordered: TargetScriptJson = {
      state: ZombieState.WalkToTarget,
      head: { arrive: 12, loops: 1, motion: 10, frame: 0 },
      entries: [{ motion: 10, frame: 0, loops: 1, mode: 5 }],
    };
    const { z, events } = captorScene(ZombieState.AwaitCivilianOrder,
      ZombieState.WalkPastPoint, ordered,
      [[{ op: CivilianOp.Wait, args: [CivilianWait.Free] },
        { op: CivilianOp.SetChildCue, args: [ZombieState.WalkToTarget, 2] },
        { op: CivilianOp.Wait, args: [0] },
        { op: CivilianOp.End, args: [] }]]);
    check("a captor awaiting the order starts drawn",
          z.alpha === 1, `alpha ${z.alpha}`);
    zFrame(z, events);                       // sub 0 -> 1, and the hide
    check("...and sub 0 takes it off screen",
          z.alpha === 0 && z.sub === 1, `alpha ${z.alpha} sub ${z.sub}`);
    const flagsWhileHidden = z.flags;
    zFrame(z, events);                       // takes the order
    check("...the order puts it back",
          z.alpha === 1, `alpha ${z.alpha}`);
    // `obj+0x34 = obj+0x1350` restores the word whole, so the two bits sub 0
    // raised come off. Not an equality: the state it hands over to runs on
    // this same frame and writes its own bits on top.
    check("...restoring the flags `obj+0x1350` saved",
          (flagsWhileHidden & 0x18000) === 0x18000
          && (z.flags & 0x18000) === 0,
          `flags ${z.flags.toString(16)} vs ${flagsWhileHidden.toString(16)}`);
    check("...and the state it was ordered into has already run this frame",
          z.motion === 10, `motion ${z.motion}`);
  }
  {
    // The failure itself, stated: with no script the radius is zero and the
    // captor can never reach it, whatever it does.
    const { z, events } = captorScene(ZombieState.WalkToTarget, 1, null);
    zFrame(z, events);
    z.pos = vec3(0, 0, 0.5);
    zFrame(z, events);
    check("a captor with no target script has a radius nothing satisfies",
          z.zom.targetArrive === 0 && z.state === ZombieState.WalkToTarget,
          `arrive ${z.zom.targetArrive} state ${z.state}`);
  }

  // The script ends by flipping roles, and only the *attack* script running
  // out sends the actor at the player.
  {
    const { z } = captorScene(ZombieState.WalkToTarget,
                              ZombieState.RetireOffScreen, null);
    ZombieScriptEnded(z);
    check("a finished target script hands over to the attack state",
          z.state === ZombieState.RetireOffScreen, `state ${z.state}`);
    ZombieScriptEnded(z);
    check("...and only a finished attack script sends it at the player",
          z.state === ZombieState.AttackRun, `state ${z.state}`);
  }

  // **The cursor carries which blob it is in, not just how far.** A captor's
  // descriptor has two script blobs and `obj+0x1398` is a *pointer* into one
  // of them; `ZombieScriptForState` (`FUN_0045CA10`) is called only where the
  // engine writes that pointer, never on the steps that read it back.
  //
  // This port kept an index and re-derived the blob from `obj.state` on every
  // read. A captor whose initial state is 35 and whose attack state is 34
  // therefore broke: the walk leaves the cursor in the **attack** blob and
  // hands over to state 35, which is not its attack state, so the next read
  // returned the *target* blob, replayed the approach clip it had already
  // finished, and bounced back to the walk. Stage 3's two `znkage` circled
  // their hostage for ever and her script never left `children-alive`.
  {
    const target: TargetScriptJson = {
      state: ZombieState.TargetMotionScript, head: {},
      entries: [{ motion: 10, frame: 0, loops: 1, mode: -1 }],
    };
    const attack: TargetScriptJson = {
      state: ZombieState.WalkToTarget,
      head: { arrive: 50, loops: 1, motion: 10, frame: 0 },
      entries: [{ motion: 12, frame: 0, loops: 1, mode: 5 }],
    };
    // The shipped shape: start in the maul state, walk as the attack state.
    const { civ, z, events } = captorScene(
      ZombieState.TargetMotionScript, ZombieState.WalkToTarget, target,
      undefined, attack);
    z.pos = vec3(0, 0, 20);                    // already inside `arrive`
    check("it starts on the target blob", z.zom.scriptBlob === 0,
          `blob ${z.zom.scriptBlob}`);

    // Play it out: the target entry ends, the walk takes over, and the walk
    // arrives at once because it is already inside the radius.
    for (let i = 0; i < 400; i++) {
      if (z.state === ZombieState.TargetMotionScript && z.zom.scriptBlob === 1) break;
      // `EnemyZombieUpdate` does not advance the clip -- `GameUpdate` does, and
      // every cue in this family is a play-cursor comparison, so the clock has
      // to run or no entry ever ends.
      ActorAdvanceMotion(z, 1 / 60);
      zFrame(z, events);
    }
    check("...and the walk hands the maul the attack blob, not the target one",
          z.zom.scriptBlob === 1 && z.state === ZombieState.TargetMotionScript,
          `blob ${z.zom.scriptBlob} state ${z.state}`);
    // Sub 1 is the frame that loads the entry the cursor points at, so the
    // clip is only on the actor once it has run.
    ActorAdvanceMotion(z, 1 / 60);
    zFrame(z, events);
    check("...so the clip it plays is the maul's, not the approach's again",
          z.motion === 12, `motion ${z.motion}`);

    // And the maul's cue kills the civilian, which is the whole point of the
    // hand-over: `mode` is the play frame the kill lands on.
    for (let i = 0; i < 400 && !(civ.flags & ActorFlag.Dead); i++) {
      ActorAdvanceMotion(z, 1 / 60);
      zFrame(z, events);
    }
    check("...and its cue frame is what kills the hostage",
          (civ.flags & ActorFlag.Dead) !== 0, `flags 0x${civ.flags.toString(16)}`);
  }

  // **State 43's tail, which is its only exit** — `PLAYER_HANGS` item 23.
  //
  // `ZombieStateDragTarget` (`FUN_0045C080`) raises `0x10100` on itself when
  // it kills, so from that frame `DispatchHit` skips `ResolveHit` and nothing
  // can shoot the captor out of `g_enemies_alive`. Sub 3 never increments the
  // sub-state. The one thing that ends it is the tail at `0x0045C1AD`:
  // `g_script_flags[0x1D]` plus `g_players_in_play`, releasing both enemy
  // counts and going to sub 4, which despawns. The port had the sub-4 arm and
  // nothing that could ever assign sub 4, so stage 4's entry-4 route stopped
  // at block 9 with one `znkage` alive at 90 hit points for ever.
  {
    const drag: TargetScriptJson = {
      state: ZombieState.DragTarget,
      // One loop, and a cue at play cursor 4 so the kill lands early.
      head: { loops: 1, cue: 4 },
      entries: [],
    };
    const step = (z: ZombieActor, events: Events, n: number) => {
      for (let i = 0; i < n; i++) {
        ActorAdvanceMotion(z, 1 / 60);
        zFrame(z, events);
      }
    };

    {
      const { civ, z, events } = captorScene(ZombieState.DragTarget, 1, drag);
      // The room the gate is reading, as `EnemyZombieInit` leaves it.
      G.g_enemies_alive = 1;
      G.g_enemies_present = 1;
      G.g_players_in_play = 1;

      step(z, events, 1);
      check("state 43 sub 0 falls into the drag on its own frame",
            z.sub === 1 && z.motion === 0x1a4, `sub ${z.sub} motion ${z.motion}`);

      // The drag glues the captor to the civilian -- all three rotations, not
      // just the yaw.
      civ.pos = vec3(7, 8, 9);
      civ.pitch = 0x111; civ.yaw = 0x222; civ.roll = 0x333;
      step(z, events, 1);
      // x and z only: this fixture has no collision set, so the ground snap
      // that runs after the state puts y at the no-floor floor. The rotations
      // are the half that was missing -- the port copied `yaw` alone and the
      // engine copies `obj+0x64`, `0x68` and `0x6C`.
      check("...and the pose it copies is the position and all three rotations",
            z.pos.x === 7 && z.pos.z === 9
            && z.pitch === 0x111 && z.yaw === 0x222 && z.roll === 0x333,
            `pos ${z.pos.x},${z.pos.y},${z.pos.z} `
            + `rot ${z.pitch},${z.yaw},${z.roll}`);

      // The cue kills her and makes the captor shot-immune.
      step(z, events, 40);
      check("...the cue frame kills the civilian and raises `0x10100` on itself",
            (civ.flags & ActorFlag.Dead) !== 0
            && (z.flags & ActorFlag.ShotImmune) !== 0,
            `civ 0x${civ.flags.toString(16)} z 0x${z.flags.toString(16)}`);

      // Sub 2 is its own arm. It used to fall through into sub 1's loop-and-cue
      // block, whose second half fires the moment the civilian is dead -- so
      // the settle was skipped in a single frame and the state went straight
      // to the turn.
      check("...and it settles in sub 2 rather than skipping to the turn",
            z.sub === 2, `sub ${z.sub}`);
      step(z, events, 400);
      check("...then reaches sub 3, which never advances again",
            z.sub === 3 && z.state === ZombieState.DragTarget,
            `sub ${z.sub} state ${z.state}`);

      // **This is the hang.** Nothing has raised flag 29, so the captor is
      // still in the room and still cannot be shot out of it.
      check("with `g_script_flags[0x1D]` down it holds both enemy counts open",
            G.g_enemies_alive === 1 && G.g_enemies_present === 1
            && !z.dead && z.visible,
            `alive ${G.g_enemies_alive} present ${G.g_enemies_present}`);

      // ...and the flag is what ends it, on the very next frame.
      G.g_script_flags[0x1d] = 1;
      step(z, events, 1);
      check("...and the flag releases both counts and sends it to sub 4",
            G.g_enemies_alive === 0 && G.g_enemies_present === 0
            && z.sub === 4 && (z.flags & ActorFlag.Dead) !== 0,
            `alive ${G.g_enemies_alive} present ${G.g_enemies_present} `
            + `sub ${z.sub} flags 0x${z.flags.toString(16)}`);
      step(z, events, 1);
      check("...and sub 4 despawns it", !z.visible, `visible ${z.visible}`);
    }

    // `g_players_in_play` is the second half of the test, and it is an
    // `AND`: the tail does nothing before anyone has started.
    {
      const { z, events } = captorScene(ZombieState.DragTarget, 1, drag);
      G.g_enemies_alive = 1;
      G.g_enemies_present = 1;
      G.g_players_in_play = 0;
      G.g_script_flags[0x1d] = 1;
      step(z, events, 4);
      check("the tail is an AND: flag 29 up with no player in play holds",
            G.g_enemies_alive === 1 && z.sub !== 4,
            `alive ${G.g_enemies_alive} sub ${z.sub}`);
    }

    // The tail is reached from **every** sub, not only from the turn: the
    // `goto switchD_0045c0aa_default` out of sub 1's "nothing to do" arm is
    // the same block.
    {
      const { z, events } = captorScene(ZombieState.DragTarget, 1, drag);
      G.g_enemies_alive = 1;
      G.g_enemies_present = 1;
      G.g_players_in_play = 1;
      step(z, events, 1);
      check("a captor still in sub 1 is where the flag can catch it",
            z.sub === 1, `sub ${z.sub}`);
      G.g_script_flags[0x1d] = 1;
      step(z, events, 1);
      check("...and the tail runs from sub 1 as well as from sub 3",
            z.sub === 4 && G.g_enemies_alive === 0,
            `sub ${z.sub} alive ${G.g_enemies_alive}`);
    }
  }

}

console.log("\nclass 0x30's placement: the ground snap and the two entrances:");
{
  const rng = new Rng(21);
  // A floor at y = 0 and nothing else, so the snap has exactly one answer.
  const scene30 = () => {
    ResetGameGlobals();
    SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    T.coli = { files: ["t"], blobs: { floor: FLOOR_BLOB } };
    G.g_coli_full_set = ["floor"];
    G.g_camera_fixed_eye_y = -1e9;     // a miss must not pass as a hit
    const z = spawnZombie(0x6000, 1, "placed");
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.radius = 10;
    return z;
  };

  // **The bug this fixes.** Nothing in the port ever put a class-0x30 actor on
  // the collision floor: its `y` was whatever the spawn record said, for ever.
  {
    const z = scene30();
    // Three under the floor: the probe starts six units above the actor's own
    // y, so that is what "below" can mean. A water spawn ten units down is out
    // of its reach until the emerge clip has brought it most of the way up —
    // which is the engine's limit too, and why the clip is not decoration.
    z.pos = vec3(0, -3, 0);
    ActorSnapToGroundHeight(z);
    check("an actor below the floor is brought up to it", z.pos.y === 0,
          `y ${z.pos.y}`);
    z.pos = vec3(0, -40, 0);
    ActorSnapToGroundHeight(z);
    check("...but only from within the six-unit probe", z.pos.y === -1e9,
          `y ${z.pos.y}`);
    z.pos = vec3(0, 6, 0);             // a little above it
    ActorSnapToGroundHeight(z);
    check("...and one just above it is stuck to it", z.pos.y === 0,
          `y ${z.pos.y}`);
  }

  // More than ten units of air, and only when the actor may leave the floor,
  // is a fall rather than a snap.
  {
    const z = scene30();
    z.pos = vec3(0, 40, 0);
    z.flags2 &= ~ZombieFlag2.MayFall;
    ActorSnapToGroundHeight(z);
    check("without the fall bit even forty units snaps", z.pos.y === 0,
          `y ${z.pos.y}`);
    z.pos = vec3(0, 40, 0);
    z.flags2 |= ZombieFlag2.MayFall;
    ActorSnapToGroundHeight(z);
    check("with it, the actor falls instead",
          z.state === ZombieState.FallToGround && z.pos.y === 40,
          `state ${z.state} y ${z.pos.y}`);
  }

  // `ZombieStateEmerge`: hold the submerged pose for the descriptor's delay,
  // then play the clip it names. The clip is what the player sees coming out
  // of the water; the snap is what keeps its feet on the bottom.
  {
    const z = scene30();
    z.pos = vec3(0, -5, 0);
    z.emerge = { delay: 30, motion: 12 };
    z.state = ZombieEntryState(ZombieState.Emerge);
    check("state 27 is an entrance, not a synonym for AttackRun",
          z.state === ZombieState.Emerge, `state ${z.state}`);
    EnemyZombieUpdate(z, { eye: EYE, dt: 1 / 60, rng, host: NULL_HOST });
    check("...which holds the submerged pose and freezes the clock",
          z.motion === 0xb9 && z.frozen === 1, `motion ${z.motion}`);
    for (let i = 0; i < 29; i++) {
      EnemyZombieUpdate(z, { eye: EYE, dt: 1 / 60, rng, host: NULL_HOST });
    }
    check("it waits the descriptor's delay out", z.motion === 0xb9,
          `motion ${z.motion}`);
    EnemyZombieUpdate(z, { eye: EYE, dt: 1 / 60, rng, host: NULL_HOST });
    check("and then plays the clip the descriptor names",
          z.motion === 12 && z.frozen === 0, `motion ${z.motion}`);
    // And the snap has it standing on the floor rather than under it.
    check("...on the floor, not five units under it", z.pos.y === 0,
          `y ${z.pos.y}`);
  }

  // **A zombie in its emerge animation does not stagger when it is shot.**
  //
  // `ZombieStateEmerge` (`FUN_004584E0`) raises `obj+0x34` `0x2100` in sub 0
  // (`00458532 OR DH, 0x21`), drops `0x100` when the clip starts
  // (`004585EC AND EDX, 0xfff6feff`) and drops `0x2000` on the hand-over
  // (`0045869F AND DH, 0xdf`). `ActorPlayHitReaction` (`FUN_004544C0`) refuses
  // outright while `0x2000` is up — `004544D8 TEST dword ptr [ESI+0x34],
  // 0x10002000` — so the whole entrance is stagger-proof.
  {
    const z = scene30();
    z.pos = vec3(0, -5, 0);
    z.emerge = { delay: 30, motion: 12 };
    z.state = ZombieEntryState(ZombieState.Emerge);
    EnemyZombieUpdate(z, { eye: EYE, dt: 1 / 60, rng, host: NULL_HOST });
    check("sub 0 raises both of the bits `OR DH, 0x21` names",
          (z.flags & (ActorFlag.ShotImmune | ActorFlag.NoHitReaction))
            === (ActorFlag.ShotImmune | ActorFlag.NoHitReaction),
          `flags ${z.flags.toString(16)}`);
    check("a shot on the submerged pose plays no stagger",
          ActorPlayHitReaction(z, 1, HitResultCode.Damaged) === undefined
            && z.react === null, JSON.stringify(z.react));

    for (let i = 0; i < 30; i++) {
      EnemyZombieUpdate(z, { eye: EYE, dt: 1 / 60, rng, host: NULL_HOST });
    }
    check("the clip that lifts it out is playing, and it is shootable again",
          z.motion === 12 && (z.flags & ActorFlag.ShotImmune) === 0,
          `motion ${z.motion} flags ${z.flags.toString(16)}`);
    check("...but `0x2000` is not in that mask, so it still does not stagger",
          (z.flags & ActorFlag.NoHitReaction) !== 0
            && ActorPlayHitReaction(z, 1, HitResultCode.Damaged) === undefined
            && z.react === null, JSON.stringify(z.react));
    // End to end, through the routine that actually calls it: the whole shot
    // lands, hit points come off, and the entrance clip is left alone.
    const before = z.hp;
    ResolveHit(z, 1, 0, NULL_HOST, rng);
    check("...and a whole `ResolveHit` still leaves the entrance running",
          z.hp < before && z.react === null && z.motion === 12
            && z.state === ZombieState.Emerge,
          `hp ${z.hp} react ${JSON.stringify(z.react)} state ${z.state}`);

    // Run the clip out. The base clock is `ActorAdvanceMotion`'s, which is the
    // director's and not this state's, so the cursor is put on the clip's last
    // frame directly — 12 is 16 authored frames, so a play length of 30.
    z.playTicks = MotionPlayLength(z) - 1;
    EnemyZombieUpdate(z, { eye: EYE, dt: 1 / 60, rng, host: NULL_HOST });
    check("the emerge hands over to `AttackRun`",
          z.state === ZombieState.AttackRun, `state ${z.state}`);
    check("...clearing `0x2000` as it goes",
          (z.flags & ActorFlag.NoHitReaction) === 0,
          `flags ${z.flags.toString(16)}`);
    check("...so now the same shot does stagger",
          ActorPlayHitReaction(z, 1, HitResultCode.Damaged) !== undefined
            && z.react !== null, JSON.stringify(z.react));
  }

  // `ActorArcBeginFalling` counts its own frames from the gravity, which is
  // the thing that makes state 26 different from every other arc in the port.
  {
    const z = scene30();
    z.pos = vec3(0, 40, 0);
    ActorArcBeginFalling(z, [30, 0, 0], 0.04);
    // `z.zom.holdFrames`, not `z.holdFrames`: the head still has a field of
    // that name and it is class 0x24's `obj+0x1320`. This assertion read the
    // wrong word the moment class 0x30's reading moved to the arm, and said
    // so — which is why the arm's doc calls the surviving head field a trap.
    check("the delayed leap's frame count comes from the drop and the gravity",
          z.zom.holdFrames > 40 && z.zom.holdFrames < 50,
          `${z.zom.holdFrames} frames`);
    check("...and the flat speed divides the distance by it",
          Math.abs(z.vel.x - 30 / z.zom.holdFrames) < 1e-4, `vx ${z.vel.x}`);
    check("...with gravity on the y axis", Math.abs(z.accY + 0.04) < 1e-6,
          `accY ${z.accY}`);
  }

}

console.log("\nclass 0x30's two spheres: the wall push and the crowd push:");
{
  const scenePush = () => {
    ResetGameGlobals();
    SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    T.coli = { files: ["t"], blobs: { wall: WALL_BLOB, floor: FLOOR_BLOB } };
    G.g_coli_full_set = ["wall", "floor"];
    G.g_camera_fixed_eye_y = 0;
  };

  // **The bug this fixes.** `EnemyZombieInit` writes both radii and the port
  // wrote neither, so every zombie collided as a point of radius zero and the
  // world push could never find anything to be pushed out of.
  {
    scenePush();
    const z = spawnZombie(0x7000, 1, "radii");
    check("the Init sets the shot radius and the body radius",
          z.radius === 10 && z.bodyRadius === 3.5,
          `shot ${z.radius} body ${z.bodyRadius}`);
  }

  // `WALL_BLOB` is the plane x = 30. Put an actor inside it and it must come
  // back out rather than through.
  {
    scenePush();
    const z = spawnZombie(0x7001, 1, "walled");
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.pos = vec3(29, 0, 45);
    const before = z.pos.x;
    ZombiePushOutOfWorldAndActors(z, 1);
    check("an actor inside a wall is pushed back out of it", z.pos.x < before,
          `x ${z.pos.x.toFixed(2)} from ${before}`);
  }

  // The crowd push is **mutual and deferred**: the mover records the opposite
  // push on whoever it found, who applies it on its own next frame. That is
  // what makes it one test per actor rather than one per pair.
  {
    scenePush();
    const a = spawnZombie(0x7002, 1, "a");
    const b = spawnZombie(0x7003, 1, "b");
    for (const z of [a, b]) { z.visible = true; z.hp = z.maxHp = 100; }
    a.pos = vec3(0, 0, 0);
    b.pos = vec3(2, 0, 0);             // well inside 3.5 + 3.5
    const gap0 = Math.abs(a.pos.x - b.pos.x);
    ZombiePushOutOfWorldAndActors(a, 1);
    check("an actor inside another is pushed away from it", a.pos.x < 0,
          `ax ${a.pos.x.toFixed(3)}`);
    check("...and the other is told which way, not moved",
          b.pos.x === 2 && b.pushedBy === a.at && b.pushNormal.x > 0,
          `bx ${b.pos.x} by ${b.pushedBy}`);
    ZombiePushOutOfWorldAndActors(b, 1);
    check("which it does on its own next frame",
          b.pos.x > 2 && b.pushedBy === -1, `bx ${b.pos.x.toFixed(3)}`);
    check("so the two separate", Math.abs(a.pos.x - b.pos.x) > gap0,
          `gap ${Math.abs(a.pos.x - b.pos.x).toFixed(3)} from ${gap0}`);
  }
}

console.log("\nclass 0x30 state 15, the scripted walk-in:");
{
  // `ZombieStateWalkDistance` does not move the actor -- the clip's root
  // motion does -- so the test moves it and checks what the state makes of
  // that. See `game/class30/walk_distance.ts`.
  const walker = (dist: number) => {
    ResetGameGlobals();
    SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_camera_fixed_eye_y = 0;
    const z = spawnZombie(0x7100, 1, "walk-in", {
      initialState: ZombieState.WalkDistance, walkDistance: dist,
    });
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.pos = vec3(0, 0, 0);
    return z;
  };

  // **The bug this fixes.** State 15 was folded into `AttackRun`, so all
  // fifty of the game's walk-in spawns turned to face the camera on their
  // first frame instead of walking the entrance the level was built for.
  check("a state-15 spawn starts in WalkDistance, not AttackRun",
        ZombieEntryState(ZombieState.WalkDistance) === ZombieState.WalkDistance,
        String(ZombieEntryState(ZombieState.WalkDistance)));

  {
    const z = walker(8);
    ZombieStateWalkDistance(z, new Rng(1));
    check("the first frame latches the distance and the start point",
          z.zom.targetArrive === 8 && z.arcFrom.x === 0 && z.arcFrom.z === 0
          && z.sub === 2, `arrive ${z.zom.targetArrive} sub ${z.sub}`);
    check("...and it is still walking", z.state === ZombieState.WalkDistance,
          String(z.state));

    z.pos.z = -7.9;                       // just short
    ZombieStateWalkDistance(z, new Rng(1));
    check("short of the distance it keeps walking",
          z.state === ZombieState.WalkDistance
          && Math.abs(z.zom.walkTravelled - 7.9) < 1e-4,
          `${ZombieState[z.state]} travelled ${z.zom.walkTravelled.toFixed(2)}`);

    z.pos.z = -8.1;                       // past it
    ZombieStateWalkDistance(z, new Rng(1));
    check("reaching it hands to AttackRun with a fresh sub",
          z.state === ZombieState.AttackRun && z.sub === 0,
          `${ZombieState[z.state]}/${z.sub}`);
    check("...and records where the walk ended",
          z.strikeStart.z === -8.1, String(z.strikeStart.z));
  }

  // The measure is `sqrt(dx^2 + dz^2)`: an actor dropped a long way has not
  // walked anywhere. Taking the 3D distance would end the entrance early for
  // every spawn that falls to the floor on its first frame.
  {
    const z = walker(8);
    ZombieStateWalkDistance(z, new Rng(1));
    z.pos.y = -100;
    ZombieStateWalkDistance(z, new Rng(1));
    check("the distance is 2D -- falling is not walking",
          z.state === ZombieState.WalkDistance && z.zom.walkTravelled === 0,
          `${ZombieState[z.state]} travelled ${z.zom.walkTravelled}`);
  }

  // The other arm: with `obj+0x34` bit 0x20000000 the state retires the actor
  // instead of sending it at the camera. No shipped class-0x30 spawn sets it.
  {
    const z = walker(4);
    z.flags |= ActorFlag.BackingOff;
    ZombieStateWalkDistance(z, new Rng(1));
    z.pos.x = 5;
    ZombieStateWalkDistance(z, new Rng(1));
    check("the 0x20000000 arm despawns rather than attacking",
          z.despawned && z.state === ZombieState.WalkDistance,
          `despawned ${z.despawned} ${ZombieState[z.state]}`);
  }
}

console.log("\nthe clip clock the scripts count in:");
{
  // `g_motion_play_length` is about twice `frames`, and every cue a script
  // names is in *those* units. Counting in authored frames loses every cue
  // past halfway, which is what left the mauled civilians alive.
  ResetGameGlobals();
  SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  const z = spawnZombie(0x7200, 1, "clock");
  z.motion = 10;                     // 20 frames, and a play length of 37
  const m = CHARS.types["1"].motions["10"];
  check("the play clock runs at twice the authored frames",
        (() => { z.playTicks = 2; return MotionPlayFrame(z) === 2; })(),
        `frame ${MotionPlayFrame(z)}`);
  check("...and the play length comes from the bundle, not from frames * 2",
        MotionPlayLength(z) === 37 && m.frames * 2 - 2 === 38,
        `${MotionPlayLength(z)} for ${m.frames} frames`);
  // The failure this guards: a cue past the authored frame count must still
  // be reachable, because the engine's cursor counts to the play length. It
  // **wraps** there rather than running away -- `model[2] = model[0] %
  // (play + 1)` -- so the test is that one full cycle visits every value up
  // to the play length and then returns to zero.
  const seen = new Set<number>();
  for (let i = 0; i < 80; i++) {
    z.playTicks = i;
    seen.add(MotionPlayFrame(z));
  }
  check("a cue past the authored frame count is still reachable",
        seen.has(30) && seen.has(37) && m.frames === 20,
        `${seen.size} distinct cursors for ${m.frames} frames`);
  check("...and the cursor wraps at the play length rather than running away",
        Math.max(...seen) === 37 && seen.size === 38,
        `max ${Math.max(...seen)} of ${seen.size}`);

  // **Every cursor value is observed, once, from every start phase.**
  //
  // The check above sets `playTicks` by hand, which is why it passed for
  // months while the cursor was skipping values: the bug was in *accumulating*
  // it. The clock was seconds, advanced `clock += 1/60` and read back as
  // `Math.floor(clock * fps * 2)`, and repeated float addition of 1/60 does
  // not land on multiples of 1/60 -- so the cursor went 6, 8 and 30, 32 while
  // showing 5 twice. Sixteen call sites compare it with `===`, correctly,
  // because `>=` double-fires across the `% (len + 1)` wrap. A cue authored at
  // 7, 15, 31 or 507 could therefore never fire, and the actor parked for
  // ever. Most of `docs/PLAYER_HANGS.md` is that sentence.
  //
  // So this drives the real advance, one tick at a time, from every phase a
  // clip can start on -- because which value gets lost moves with the phase.
  const len = MotionPlayLength(z);
  let worst = "";
  for (let phase = 0; phase <= len && !worst; phase++) {
    z.playTicks = phase;
    const counts = new Map<number, number>();
    // One full cycle plus a little, so the wrap is included.
    for (let i = 0; i <= len; i++) {
      const f = MotionPlayFrame(z);
      counts.set(f, (counts.get(f) ?? 0) + 1);
      ActorAdvanceMotion(z, 1 / 60);
    }
    for (let f = 0; f <= len; f++) {
      const n = counts.get(f) ?? 0;
      if (n !== 1) {
        worst = `from phase ${phase}, cursor ${f} was observed ${n} times`;
        break;
      }
    }
  }
  check("every cursor value is observed exactly once, from every start phase",
        worst === "", worst);
}

console.log("\nclass 0x10's body radius, and the hook that ramps it:");
{
  // **The bug this fixes.** `CivilianInit` writes `obj+0x128 = 1.0`; the port
  // wrote only `obj+0x124`, so `ColiTestSphereAgainstActors`' lazy default
  // filled the body radius from the *shot* radius -- ten units -- and a
  // captor walking at its civilian was shoved off it from 13.5 away when its
  // script wanted to be within 6. It never arrived and nobody was ever mauled.
  ResetGameGlobals();
  SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  T.civilians = { entries: [], scripts: [], items: [], spawns: {} };
  const c = ActorSpawn(0x7300, SpawnClass.Civilian, 1, "civ", undefined,
                       new Rng(1));
  check("the civilian's body sphere is one unit, not its shot sphere",
        c.bodyRadius === 1 && c.radius !== 1,
        `body ${c.bodyRadius} shot ${c.radius}`);

  // Op 0x16 ramps it, and the hook is what applies the ramp.
  c.civ!.scaleTarget = 4;
  c.civ!.scaleStep = 1;
  for (let i = 0; i < 10; i++) PoseHookGrowAndPushOutOfWorld(c);
  check("the pose hook ramps it to the target and stops there",
        c.bodyRadius === 4, String(c.bodyRadius));
  c.civ!.scaleTarget = 2;
  c.civ!.scaleStep = -0.5;
  for (let i = 0; i < 10; i++) PoseHookGrowAndPushOutOfWorld(c);
  check("...from either side", c.bodyRadius === 2, String(c.bodyRadius));

  // And the push it does only when the wait word asks for it.
  T.coli = { files: ["t"], blobs: { wall: WALL_BLOB } };
  G.g_coli_full_set = ["wall"];
  c.pos = vec3(29, 0, 45);
  c.civ!.scaleTarget = c.bodyRadius;
  c.civ!.scaleStep = 0;
  PoseHookGrowAndPushOutOfWorld(c);
  check("without the wait bit it stays in the wall", c.pos.x === 29,
        String(c.pos.x));
  c.civ!.wait |= CivilianWait.PushOutOfWorld;
  PoseHookGrowAndPushOutOfWorld(c);
  check("with it, it is pushed out", c.pos.x < 29, c.pos.x.toFixed(2));
}

console.log("\nclass 0x10's play cursor: a corpse rests, it does not replay:");
{
  // `CivilianUpdate` advances the cursor only while the loop count allows;
  // when it runs out nothing touches it again. The port's clock is advanced
  // unconditionally and the renderer wraps it, so a civilian killed in a set
  // piece played its dying clip over and over.
  const dying = (loops: number) => {
    ResetGameGlobals();
    SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    T.civilians = { entries: [], scripts: [], items: [], spawns: {} };
    const c = ActorSpawn(0x7400, SpawnClass.Civilian, 1, "dying", undefined,
                         new Rng(1));
    c.visible = true;
    c.motion = 10;                   // 20 frames, play length 37
    c.playTicks = 0;
    c.civ!.loops = loops;
    return c;
  };
  const runClip = (c: Actor, frames: number) => {
    for (let i = 0; i < frames; i++) {
      ActorAdvanceMotion(c, 1 / 60);
      CivilianCountMotionLoops(c);
    }
  };

  {
    const c = dying(1);
    runClip(c, 200);                 // far past the clip's 37-frame play length
    check("a one-shot clip stops at the end of its play length",
          MotionPlayFrame(c) === 37, String(MotionPlayFrame(c)));
    check("...and the loop count is spent", c.civ!.loops === 0,
          String(c.civ!.loops));
    const at = MotionPlayFrame(c);
    runClip(c, 200);
    check("...and it stays there rather than wrapping round again",
          MotionPlayFrame(c) === at, String(MotionPlayFrame(c)));
  }

  // A negative count is the engine's "play for ever": the cursor keeps
  // moving, where a spent one is pinned.
  {
    const c = dying(-1);
    runClip(c, 200);
    const a = MotionPlayFrame(c);
    runClip(c, 1);
    check("a negative loop count still plays for ever",
          MotionPlayFrame(c) !== a, `${a} then ${MotionPlayFrame(c)}`);
  }

  // Two loops take twice as long to settle, and settle in the same place.
  {
    const c = dying(2);
    runClip(c, 40);
    check("a two-loop clip is still going after one play",
          c.civ!.loops === 1, String(c.civ!.loops));
    runClip(c, 200);
    check("...and rests after the second", c.civ!.loops === 0
          && MotionPlayFrame(c) === 37, String(MotionPlayFrame(c)));
  }
}

console.log("\nclass 0x30's twelve entrance states — do the waits end?");
{
  // Every one of the twelve is a wait, and a wait transcribed slightly wrong
  // does not crash: it simply never comes true and the actor stands there for
  // the rest of the stage. `tools/entrances.mjs` checks all 127 shipped spawns
  // against the real bundle; this checks the shapes against data written here,
  // where a cue can be put exactly on and exactly past its frame.

  // **The entry router passes every shipped entrance through now.** It used to
  // fold 37 of the 54 states into `AttackRun`, which is what sent a zombie
  // scripted to drown you jogging across the room instead.
  for (const st of [ZombieState.SurfaceOnCameraCue, ZombieState.RunInPlaceTimed,
                    ZombieState.HoldClipThenBranch,
                    ZombieState.WaitCameraFrameThenBranch,
                    ZombieState.WaitForCameraFrame,
                    ZombieState.WaitScriptFlagThenBranch,
                    ZombieState.ScriptedGrabAndDespawn, ZombieState.LeapToPoint,
                    ZombieState.RideCarrier, ZombieState.ArcScriptedEntrance,
                    ZombieState.WaitScriptFlagThenEnter,
                    ZombieState.DelayedStrikeInPlace]) {
    check(`a state-${st} spawn starts there, not in AttackRun`,
          ZombieEntryState(st) === st, String(ZombieEntryState(st)));
  }
  check("...and a state nothing ships still falls back to AttackRun",
        ZombieEntryState(53) === ZombieState.AttackRun,
        String(ZombieEntryState(53)));

  const spawn = (init: number, entry: unknown, exit = ZombieState.AttackRun) => {
    ResetGameGlobals();
    SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_camera_fixed_eye_y = 0;
    G.g_players_in_play = 1;
    const z = spawnZombie(0x7700, 1, "entrance", {
      initialState: init, attackState: exit,
      entry: entry as Actor["entry"],
    });
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.pos = vec3(0, 0, 30);
    return z;
  };
  const run = (z: ZombieActor, frames: number, rng = new Rng(3)) => {
    for (let f = 0; f < frames; f++) {
      EnemyZombieUpdate(z, { eye: EYE, dt: 1 / 60, rng, host: NULL_HOST });
      // `GameUpdate` advances the clip; `EnemyZombieUpdate` does not. Four of
      // the twelve measure their exit on the **play clock**, so a loop that
      // leaves it at zero stalls them and proves nothing.
      ActorAdvanceMotion(z, 1 / 60);
    }
  };

  // -- state 17: hold a clip for N frames, then branch ---------------------
  {
    const z = spawn(ZombieState.HoldClipThenBranch,
                    { motion: 700, frames: 30 });
    run(z, 20);
    check("state 17 is still holding at 20 of its 30 frames",
          z.state === ZombieState.HoldClipThenBranch && z.motion === 700,
          `${z.state}/${z.motion}`);
    run(z, 20);
    // Where it goes *after* the branch is the attack loop's business — by 40
    // frames the run may already have reached the ring. What matters is that
    // the entrance let go.
    check("...and branches once the count is out",
          z.state !== ZombieState.HoldClipThenBranch, String(z.state));
  }
  {
    // The `tail+0x03 == 15` arm: it latches the distance **and** enters state
    // 15 at sub 1, skipping that state's own latch. Entering at sub 0 would
    // overwrite the distance with `walkDistance`, a different field.
    const z = spawn(ZombieState.HoldClipThenBranch,
                    { motion: 700, frames: 5, walk_distance: 9 },
                    ZombieState.WalkDistance);
    run(z, 10);
    check("state 17's exit-15 arm hands to the walk-in",
          z.state === ZombieState.WalkDistance, String(z.state));
    // It enters state 15 at **sub 1**, not sub 0 — and this is what proves it.
    // Sub 0 is that state's own latch, which would overwrite the distance with
    // `walkDistance`, a different descriptor field that is 0 here.
    check("...carrying the distance the entrance chose, not state 15's own",
          z.zom.targetArrive === 9, String(z.zom.targetArrive));
  }

  // -- state 18: wait for an exact camera frame ----------------------------
  {
    const z = spawn(ZombieState.WaitCameraFrameThenBranch,
                    { motion: 700, cue: 40 });
    G.g_cam_path_frame = 39;
    run(z, 5);
    check("state 18 waits while the camera is short of its frame",
          z.state === ZombieState.WaitCameraFrameThenBranch, String(z.state));
    G.g_cam_path_frame = 40;
    run(z, 1);
    check("...and goes the frame the camera lands on it",
          z.state === ZombieState.AttackRun, String(z.state));
  }
  {
    // The equality is the engine's, and it is load-bearing: a path that steps
    // over the frame parks the actor, which is how the game holds a rank of
    // zombies a given camera run never triggers.
    const z = spawn(ZombieState.WaitCameraFrameThenBranch,
                    { motion: 700, cue: 40 });
    G.g_cam_path_frame = 41;
    run(z, 60);
    check("...but a camera already past it waits for ever, as the exe does",
          z.state === ZombieState.WaitCameraFrameThenBranch, String(z.state));
  }

  // -- state 13: the same wait, but `>=` ------------------------------------
  {
    const z = spawn(ZombieState.SurfaceOnCameraCue, { cue_frame: 40 });
    check("state 13 freezes its pose under the water first",
          (z.flags & ActorFlag.PoseFrozen) !== 0 || z.sub === 0,
          `flags ${z.flags.toString(16)}`);
    run(z, 1);                     // sub 0 -> 1: the freeze is taken first
    G.g_cam_path_frame = 100;
    run(z, 1);
    check("...and a camera *past* its frame still releases it — this one is a"
          + " `>=`, unlike state 18",
          z.sub === 2 && (z.flags & ActorFlag.PoseFrozen) === 0,
          `sub ${z.sub} flags ${z.flags.toString(16)}`);
    run(z, 200);
    // Into the attack loop — which by 200 frames has usually moved on from
    // `AttackRun` itself, so the assertion is that the entrance is done.
    check("...then hands over when the surfacing clip is out",
          z.state !== ZombieState.SurfaceOnCameraCue, String(z.state));
  }

  // -- state 20: the script flag ------------------------------------------
  {
    const z = spawn(ZombieState.WaitScriptFlagThenBranch,
                    { motion: 700, cue: 7 });
    run(z, 30);
    check("state 20 waits on its script flag",
          z.state === ZombieState.WaitScriptFlagThenBranch, String(z.state));
    G.g_script_flags[7] = 1;
    run(z, 1);
    check("...and goes when the script raises it",
          z.state === ZombieState.AttackRun, String(z.state));
  }

  // -- state 19: the only cooldown class 0x30 ever arms --------------------
  {
    const z = spawn(ZombieState.WaitForCameraFrame,
                    { motion: 700, cue_frame: 10, freeze: true, claim: true,
                      delay: 5, cooldown: 90 });
    check("state 19's freeze arm stops the clock", z.frozen === 1 || z.sub === 0,
          `frozen ${z.frozen}`);
    G.g_cam_path_frame = 10;
    run(z, 20);
    check("state 19 claims a permit on its cue and goes to the strike",
          z.state === ZombieState.Strike && z.attackPermit >= 0,
          `${z.state}/${z.attackPermit}`);
    check("...arming the cooldown, which no other class-0x30 state does",
          z.zom.hasCooldown && z.cooldown === 90,
          `${z.zom.hasCooldown}/${z.cooldown}`);
  }
  {
    // A failed claim is not an error — the actor takes the descriptor's branch.
    const z = spawn(ZombieState.WaitForCameraFrame,
                    { motion: 700, cue_frame: 10, freeze: false, claim: false,
                      delay: 0, cooldown: 0 });
    G.g_cam_path_frame = 10;
    run(z, 3);
    check("...and a state-19 spawn that does not claim just branches",
          z.state === ZombieState.AttackRun && !z.zom.hasCooldown,
          `${z.state}/${z.zom.hasCooldown}`);
  }

  // -- state 31: it counts itself into the game ---------------------------
  {
    // The clip has to be **longer than 0x4D on the play clock**, because the
    // exit is `motion != it || 0x4D < cursor` and the cursor wraps. All four
    // shipped spawns name clip 920, whose play length clears it; a shorter one
    // would stall in the engine too, which is why this fixture uses 184.
    const z = spawn(ZombieState.WaitScriptFlagThenEnter,
                    { flag: 3, idle_motion: 10, motion: 923, delay: 10 });
    run(z, 30);
    check("state 31 is not yet an enemy the script can see",
          G.g_enemies_alive === 0 && G.g_enemies_present === 0,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
    G.g_script_flags[3] = 1;
    run(z, 1);
    check("...and counts itself in when its flag comes up",
          G.g_enemies_alive === 1 && G.g_enemies_present === 1,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
    run(z, 200);
    check("...then joins the attack loop",
          z.state !== ZombieState.WaitScriptFlagThenEnter, String(z.state));
  }

  // -- state 23: the only entrance that ends in a despawn ------------------
  {
    const z = spawn(ZombieState.ScriptedGrabAndDespawn,
                    { cue_frame: -1, motion: 186, hit_frame: 10 });
    run(z, 4);
    check("state 23's -1 cue fires at once", z.sub >= 2, String(z.sub));
    run(z, 200);
    check("...and it removes the actor rather than setting a state",
          z.despawned, `despawned ${z.despawned} state ${z.state}`);
  }

  // -- state 24: flies to its point and then never leaves ------------------
  {
    const z = spawn(ZombieState.LeapToPoint,
                    { dest: [0, 0, 12], frames: 10, delay: 5,
                      idle_motion: 1010, strike_motion: 1009, hit_frame: 8,
                      player: 0 });
    run(z, 12);
    check("state 24 flies to the point its descriptor names",
          Math.hypot(z.pos.x - 0, z.pos.z - 12) < 1.5,
          `${z.pos.x.toFixed(2)},${z.pos.z.toFixed(2)}`);
    const perch = { x: z.pos.x, z: z.pos.z };
    run(z, 400);
    check("...stays in the state for ever, as the exe does",
          z.state === ZombieState.LeapToPoint, String(z.state));
    check("...and is pinned to its perch, so the crowd push cannot walk it off",
          z.pos.x === perch.x && z.pos.z === perch.z,
          `${z.pos.x.toFixed(2)},${z.pos.z.toFixed(2)}`);
  }
  {
    // `g_players_in_play` is a **count**, not a two-player flag, and both
    // scripted attackers refuse to strike while it is zero. Leaving the port's
    // old default of 0 in place would have parked all nine of those spawns.
    const z = spawn(ZombieState.LeapToPoint,
                    { dest: [0, 0, 12], frames: 4, delay: 1,
                      idle_motion: 1010, strike_motion: 1009, hit_frame: 8,
                      player: 0 });
    G.g_players_in_play = 0;
    run(z, 120);
    check("state 24 will not strike before a player is in play",
          z.sub === 2, `sub ${z.sub}`);
    G.g_players_in_play = 1;
    run(z, 120);
    check("...and does once one is", z.sub > 2, `sub ${z.sub}`);
  }

  // -- state 29: the passenger --------------------------------------------
  {
    const z = spawn(ZombieState.RideCarrier, null, ZombieState.AttackRun);
    run(z, 3);
    // [diverges] With no rideable object ported the ride is over at once,
    // rather than parking six spawns for the rest of the stage. See
    // `class30/entrance.ts`.
    check("state 29 hands over at once when there is no carrier to ride",
          z.state === ZombieState.AttackRun, String(z.state));
  }

  // -- state 32: the give-up, and which word carries the bit ---------------
  //
  // `ZombieStateDelayedStrikeInPlace` (`FUN_0045E830`) is a permanent swing
  // loop -- it never approaches and never leaves -- with exactly one way out:
  // `0045eafe TEST dword ptr [EAX + 0x34], 0x40000000` on the object
  // `g_carrier_object` (0x009A5C34) names, then `obj+0x1334` counts up and at
  // 0x14 the actor takes state 10. `ScriptedCarrierUpdate33` (`0x004331D0`)
  // raises that bit at `00433280 OR EAX, 0x40000000`, `EAX = [EBP + 0x34]`.
  //
  // This read `obj+0x136C` instead -- the right bit in the wrong word, where
  // `ZombieFlag2.CollideActors` lives and where `EnemyZombieInit`
  // (`FUN_00452DA0`) seeds `0x60000000` on **every** class-0x30 spawn. Both
  // halves are asserted, because only the pair pins the word: the wrong read
  // fires on a carrier that has not ended its ride and never fires on one
  // that has.
  {
    const holdsFor = (z: ZombieActor, frames: number) => {
      for (let f = 0; f < frames; f++) {
        if (z.state !== ZombieState.DelayedStrikeInPlace) return f;
        run(z, 1);
      }
      return -1;
    };

    const z = spawn(ZombieState.DelayedStrikeInPlace,
                    { delay: 2, rearm: 4, player: 0 });
    // Spawned after `z`, because `spawn` resets the pool.
    const carrier = spawnZombie(0x7EE0, 1, "carrier stand-in");
    G.g_carrier_object = carrier.at;
    carrier.flags = 0;
    carrier.flags2 = 0;

    let left = holdsFor(z, 120);
    check("state 32 keeps swinging while its carrier's ride is still running",
          left === -1, `left after ${left} frames`);

    // The old read. `0x40000000` in `obj+0x136C` is a collision bit every
    // class-0x30 actor carries, so this must mean nothing here.
    carrier.flags2 |= ZombieFlag2.CollideActors;
    left = holdsFor(z, 120);
    check("...and `obj+0x136C` bit 0x40000000 is not the bit — it is the "
          + "collision word every class-0x30 spawn is seeded with",
          left === -1, `left after ${left} frames`);
    carrier.flags2 = 0;

    // The engine's read.
    carrier.flags |= ActorFlag.Reacting;
    left = holdsFor(z, 120);
    check("...but `obj+0x34` bit 0x40000000 retires it, and only after the "
          + "0x14 frames `obj+0x1334` counts",
          left > 0x14 && left <= 0x14 + 3, `left after ${left} frames`);
    check("...into state 10, which `g_class30_states` says is "
          + "`ZombieReleaseAndDespawn` (`FUN_00455490`) and not the "
          + "`ActorAbortAttackAndLeave` this used to name",
          z.state === ZombieState.Leave || z.despawned,
          `state ${z.state}${z.despawned ? " despawned" : ""}`);
  }
  {
    // `if ((carrier+0x34 & 0x40000000) == 0) obj+0x1334 = 0;` — the counter is
    // held at zero rather than paused, so a ride that ends, un-ends and ends
    // again costs the full 0x14 from the second raise.
    const z = spawn(ZombieState.DelayedStrikeInPlace,
                    { delay: 2, rearm: 4, player: 0 });
    const carrier = spawnZombie(0x7EE0, 1, "carrier stand-in");
    G.g_carrier_object = carrier.at;
    carrier.flags = ActorFlag.Reacting;
    run(z, 0x10);
    carrier.flags = 0;
    run(z, 4);
    carrier.flags = ActorFlag.Reacting;
    let since = 0;
    while (z.state === ZombieState.DelayedStrikeInPlace && since < 120) {
      run(z, 1);
      since += 1;
    }
    check("the give-up counter is zeroed while the bit is down, not paused — "
          + "the second raise costs the full 0x14 again",
          since > 0x14 && since <= 0x14 + 3, `left ${since} frames after it`);
  }
}

console.log("\nIsPlayerAttackable: the scene has to be running:");
{
  // Three clauses, two of them ported. The first is the interesting one:
  // nothing may attack unless the scene state's major is 2, the `cam/` path
  // camera row -- so a scripted view-angle turn is a window in which the
  // player cannot be hit.
  ResetGameGlobals();
  SetGameTables(CHARS);
  G.g_player_lives = [2, 2];
  check("a player is not attackable before a scene state is entered",
        !IsPlayerAttackable(0), "attackable at major 0");

  G.g_scene_state_major_entered = 1;
  check("...nor while the follow camera or a scripted turn drives",
        !IsPlayerAttackable(0), "attackable at major 1");

  G.g_scene_state_major_entered = 2;
  check("...but is once the path camera is driving", IsPlayerAttackable(0),
        "not attackable at major 2");

  // The attract override: the demo has no real player, so `g_player_state` is
  // never 5, and without this the demo would never be attacked.
  G.g_scene_state_major_entered = 2;
  G.g_player_lives = [0, 0];
  check("a player with no lives left is not attackable — the port's stand-in "
        + "for the state word", !IsPlayerAttackable(0), "still attackable");
  G.g_app_state = AppState.Attract;
  check("...unless the attract demo is running, which overrides it",
        IsPlayerAttackable(0), "override did not fire");
  G.g_app_state = AppState.InPlay;

  // ...and the engine's own third clause, for when a player state exists.
  G.g_player_state = [5, 0];
  check("a player the state word says is in play is attackable regardless",
        IsPlayerAttackable(0) && !IsPlayerAttackable(1),
        `${IsPlayerAttackable(0)}/${IsPlayerAttackable(1)}`);

  // The port's own guard. The engine reads 0x130 bytes below the array here.
  check("...and -1 is nobody", !IsPlayerAttackable(-1), "attackable");

  // **And the gate is wired into the claim**, which is the call site the port
  // used to leave out. `TryClaimAttackSlot` picks a player and voids the pick
  // when this refuses, so no enemy takes a permit during a scripted camera.
  {
    ResetGameGlobals();
    SetGameTables(CHARS);
    G.g_player_lives = [2, 2];
    const z = spawnZombie(0x7D00, 1, "claimant");
    z.visible = true;
    z.hp = z.maxHp = 100;
    G.g_scene_state_major_entered = 1;
    check("no permit is granted while a scripted camera drives",
          !TryClaimAttackSlot(z) && z.attackPermit === -1,
          `permit ${z.attackPermit}`);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    check("...and one is the moment the path camera takes over",
          TryClaimAttackSlot(z) && z.attackPermit === 0,
          `permit ${z.attackPermit}`);
  }
}

console.log("\nResetSceneOnEnter: what a scene starts clean:");
{
  // `ResetSceneOnEnter` (`FUN_0045EDD0`) is the engine's per-scene reset, and
  // the port's `ResetGameGlobals` calls it — the same nesting the exe has,
  // where `ResetGameOnStart` (`FUN_0045FEF0`) zeroes the run totals and the
  // scene load zeroes these.
  ResetGameGlobals();
  SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_enemies_alive = 4;
  G.g_enemies_present = 7;
  G.g_civilians_alive = 3;
  G.g_script_flags[9] = 1;
  G.g_head_combo_bonus = [130, 140];
  G.g_player_hit_count = [22, 31];
  // ...and something it must NOT touch: the run keeps the score across scenes.
  G.g_player_score = [4200, 900];

  ResetSceneOnEnter();
  check("a scene starts with both enemy counts at zero",
        G.g_enemies_alive === 0 && G.g_enemies_present === 0,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);
  check("...and no civilians counted",
        G.g_civilians_alive === 0, String(G.g_civilians_alive));
  check("...and every script flag down",
        (G.g_script_flags[9] ?? 0) === 0, String(G.g_script_flags[9]));
  // The shot statistics are per **scene**, which is what makes the accuracy
  // grade `EvtOpAwardAccuracyBonus2B` (`FUN_0045FE40`) pays a per-stage one.
  check("...and the per-scene shot statistics cleared for both players",
        G.g_head_combo_bonus[0] === 0 && G.g_head_combo_bonus[1] === 0
        && G.g_player_hit_count[0] === 0 && G.g_player_hit_count[1] === 0,
        `${G.g_head_combo_bonus} / ${G.g_player_hit_count}`);
  check("...but the score survives, because it is a run total and not a scene one",
        G.g_player_score[0] === 4200 && G.g_player_score[1] === 900,
        String(G.g_player_score));

  // **The scene enter has to go through it.** `GameSystem.attach` -- the port's
  // stand-in for the engine's scene load -- calls `ResetGameGlobals`, and that
  // is the only path into a stage. If the two are ever decoupled, a stage
  // switch carries the last stage's script flags and enemy counts into the
  // next one, which is precisely what the engine's reset exists to stop.
  G.g_enemies_alive = 9;
  G.g_script_flags[4] = 1;
  G.g_civilians_alive = 2;
  ResetGameGlobals();
  check("the pool reset still performs the scene reset",
        G.g_enemies_alive === 0 && G.g_civilians_alive === 0
        && (G.g_script_flags[4] ?? 0) === 0,
        `${G.g_enemies_alive}/${G.g_civilians_alive}/${G.g_script_flags[4]}`);
}

console.log("\nthe two enemy counters, stepped and not derived:");
{
  // `g_enemies_alive` and `g_enemies_present` are what 488 enemy gates wait
  // on. The port used to recount the pool every frame, which cannot express
  // either of the two things the engine uses them for: a corpse that is
  // present but not alive, and an actor deliberately left out of the count.
  const zombie = (init: number, charType = 1) => {
    const z = spawnZombie(0x7B00 + init, charType, "counted",
                         { initialState: init });
    z.visible = true;
    z.hp = z.maxHp = 100;
    return z;
  };

  ResetGameGlobals();
  SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  check("a scene starts with both counts at zero",
        G.g_enemies_alive === 0 && G.g_enemies_present === 0,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);

  const a = zombie(ZombieState.AttackRun);
  check("an ordinary zombie counts itself in at Init",
        G.g_enemies_alive === 1 && G.g_enemies_present === 1,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);

  // `EnemyZombieInit`'s two exclusions, and they are the point of the rewrite.
  zombie(ZombieState.AttackRun, UNCOUNTED_CHAR_TYPE);
  check("...but character type 9 is not an enemy and is never counted",
        G.g_enemies_alive === 1, String(G.g_enemies_alive));
  const late = zombie(ZombieState.WaitScriptFlagThenEnter);
  check("...and a state-31 spawn is not counted until its flag comes up",
        G.g_enemies_alive === 1, String(G.g_enemies_alive));

  // The state counts itself in, which is the whole reason it exists.
  late.entry = { flag: 3, idle_motion: 10, motion: 923, delay: 0 };
  G.g_camera_fixed_eye_y = 0;
  G.g_script_flags[3] = 1;
  for (let f = 0; f < 3; f++) {
    EnemyZombieUpdate(late, { eye: EYE, dt: 1 / 60, rng: new Rng(1), host: NULL_HOST });
  }
  check("...and then it does", G.g_enemies_alive === 2 && G.g_enemies_present === 2,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);

  // The latch: six routines call the releases and more than one can reach the
  // same actor, so without it the count goes negative and a gate opens early.
  ReleaseEnemyAliveCount(a);
  ReleaseEnemyAliveCount(a);
  ReleaseEnemyAliveCount(a);
  check("the alive release is latched — three calls, one decrement",
        G.g_enemies_alive === 1, String(G.g_enemies_alive));
  check("...and it did not touch the present count",
        G.g_enemies_present === 2, String(G.g_enemies_present));

  // Which is the distinction the derived count could not express at all.
  ReleaseEnemyPresentCount(a);
  check("a corpse leaves `alive` before it leaves `present`",
        G.g_enemies_present === 1, String(G.g_enemies_present));
}

console.log("\nclass 0x30 state 26: the arc alone moves the leap:");
{
  // `ZombieStateDelayedLeap` freezes the pose for the flight — `obj+0x34` bit
  // 0x4000, up for everything but the first frame and the last 0x15 — so the
  // jump clip contributes no root motion while the parabola owns the position.
  // Without it the port applied both and the actor sank through the floor.
  // And 0x3F7 is the limp of a corpse shot out of the air, not a landing: a
  // live actor plays no landing clip at all.
  const LIMP_MOTION = 0x3f7;
  const leaper = (hp = 100) => {
    ResetGameGlobals();
    SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_camera_fixed_eye_y = 0;
    const z = spawnZombie(0x7900, 1, "leaper", {
      initialState: ZombieState.DelayedLeap,
      delayedLeap: { delay: 0, dest: [0, -10, 30], gravity: 0.03674 },
      // All fourteen shipped leapers carry `obj+0x34` bit 0x20000, the
      // ground-snap exemption — without it the snap pins the actor to the
      // fixture's floor on frame one and there is no flight to measure.
      flags: ActorFlag.Airborne,
    });
    z.visible = true;
    z.hp = z.maxHp = hp;
    z.pos = vec3(0, 20, 0);
    return z;
  };

  {
    const z = leaper();
    const rng = new Rng(5);
    let lowest = z.pos.y, sawLimp = false, landed = -1;
    for (let f = 0; f < 400 && z.state === ZombieState.DelayedLeap; f++) {
      EnemyZombieUpdate(z, { eye: EYE, dt: 1 / 60, rng, host: NULL_HOST });
      ActorAdvanceMotion(z, 1 / 60);
      if (z.motion === LIMP_MOTION) sawLimp = true;
      if (landed < 0 && z.sub >= 4) { landed = f; break; }
      lowest = Math.min(lowest, z.pos.y);
    }
    check("the leap reaches its named point", landed > 0 && lowest <= -9,
          `landed ${landed} lowest ${lowest.toFixed(2)}`);
    // The arc lands a shade *short*, never long: `vel += acc` runs before
    // `pos += vel`, so the last step is one gravity tick smaller.
    check("...and does not sink past it — the freeze suppresses root motion",
          lowest >= -11, `lowest ${lowest.toFixed(2)}`);
    check("...and a live actor never plays the corpse's limp clip", !sawLimp,
          `motion ${z.motion}`);
  }
  {
    // Shot out of the air: the limp is exactly what it is for.
    const z = leaper();
    const rng = new Rng(5);
    let sawLimp = false;
    for (let f = 0; f < 400 && z.state === ZombieState.DelayedLeap; f++) {
      if (f === 12) z.hp = 0;
      EnemyZombieUpdate(z, { eye: EYE, dt: 1 / 60, rng, host: NULL_HOST });
      ActorAdvanceMotion(z, 1 / 60);
      if (z.motion === LIMP_MOTION) sawLimp = true;
    }
    check("an actor killed in flight goes limp on the way down", sawLimp,
          `motion ${z.motion}`);
    check("...and lands in the death state, not the attack run",
          z.state === ZombieState.Death, String(z.state));
  }
}

console.log("\nclass 0x30 state 33: the stationary thrower:");
{
  // `ZombieStateStandAndThrow` is the only class-0x30 state that never moves
  // the actor. The port had no state 33, so `ZombieEntryState` folded it into
  // `AttackRun` and stage 1's axe man -- character type 0x13, whose asset file
  // is `tutorial.bin` -- charged the camera.
  check("a state-33 spawn starts in StandAndThrow, not AttackRun",
        ZombieEntryState(ZombieState.StandAndThrow)
          === ZombieState.StandAndThrow,
        String(ZombieEntryState(ZombieState.StandAndThrow)));

  /** `obj+0x34` bit 0x20000 — see `ActorInitFlags` and `class30/ground.ts`. */
  const GROUND_SNAP_EXEMPT = 0x20000;

  const thrower = (cond = 7) => {
    ResetGameGlobals();
    SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_camera_fixed_eye_y = 0;
    const z = spawnZombie(0x7500, 1, "axe man", {
      initialState: ZombieState.StandAndThrow, condition: cond,
      standThrow: { delay_two_hands: 2, delay_one_hand: 2,
                    delay_after_throw: 2, exit_state: 0, walk_distance: 5 },
    });
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.pos = vec3(0, 0, 60);
    return z;
  };

  {
    const z = thrower();
    check("both hands start armed", ZombieArmedHands(z) === 2,
          String(ZombieArmedHands(z)));
    // Two frames of delay, then it claims and starts the throw clip.
    for (let i = 0; i < 4; i++) {
      ZombieStateStandAndThrow(z, EYE, new Rng(1), NULL_HOST);
    }
    check("it claims a permit and starts a throw clip",
          z.attackPermit >= 0 && (z.motion === 102 || z.motion === 103),
          `permit ${z.attackPermit} motion ${z.motion}`);
    check("...and it has not moved", z.pos.x === 0 && z.pos.z === 60,
          `${z.pos.x}, ${z.pos.z}`);
  }

  // **The hand bookkeeping.** A hand whose draw slot is no longer the one the
  // skeleton gave it has thrown its weapon -- or had it shot off -- and
  // `ZombiePickThrowingHand` must fall back to the other one.
  {
    const z = thrower();
    z.boneSlot["5"] = 0;                       // right hand emptied
    check("an emptied hand disarms", ZombieArmedHands(z) === 1,
          String(ZombieArmedHands(z)));
    check("...and the pick falls back to the other",
          ZombiePickThrowingHand(z, new Rng(1)) === 8,
          String(ZombiePickThrowingHand(z, new Rng(1))));
    z.boneSlot["8"] = 0;
    check("with both empty the pick reports none",
          ZombieArmedHands(z) === 0
          && ZombiePickThrowingHand(z, new Rng(1)) === 0);
  }

  // **`ActorInitFlags`, and the bit that showed.** The spawn record's flags
  // word becomes `obj+0x34` before the class Init runs, and `0x20000` exempts
  // the actor from the per-frame ground snap. Without the word, stage 1's axe
  // man was dropped from the ledge he is placed on to the script's ground
  // plane and threw from behind the wall he had been standing on.
  {
    ResetGameGlobals();
    SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_camera_fixed_eye_y = 0;          // the ground plane, far below
    const pinned = spawnZombie(0x7600, 1, "on a ledge", {
      initialState: ZombieState.StandAndThrow, condition: 7,
      flags: GROUND_SNAP_EXEMPT,
    });
    pinned.visible = true;
    pinned.hp = pinned.maxHp = 100;
    pinned.pos = vec3(0, 47, 60);
    check("the spawn record's flags word reaches the actor",
          (pinned.flags & GROUND_SNAP_EXEMPT) !== 0,
          `0x${(pinned.flags >>> 0).toString(16)}`);
    check("...and `ActorInitFlags` ORs in bit 0", (pinned.flags & 1) !== 0);
    ZombiePushOutOfWorldAndActors(pinned, 1);
    check("a pinned spawn keeps the height the script placed it at",
          pinned.pos.y === 47, String(pinned.pos.y));

    // ...and one without the bit settles onto the ground plane, as every
    // other stationary thrower in the game does.
    const loose = spawnZombie(0x7601, 1, "not pinned", {
      initialState: ZombieState.StandAndThrow, condition: 7,
    });
    loose.visible = true;
    loose.hp = loose.maxHp = 100;
    loose.pos = vec3(0, 47, 60);
    ZombiePushOutOfWorldAndActors(loose, 1);
    check("...and one without it still snaps to the ground",
          loose.pos.y === 0, String(loose.pos.y));
  }

  // The way out: it backs away by the descriptor's distance and then goes.
  {
    const z = thrower();
    z.boneSlot["5"] = 0;
    z.boneSlot["8"] = 0;                 // both thrown
    z.sub = 4;                           // the recover, with nothing left
    z.motion = 102;                      // 24 frames, so a play length of 46
    // The recover arm waits for `obj+0x19C == play_length - 1` exactly, and
    // the cursor wraps -- so this is frame 45 of 46, not "some time later".
    z.playTicks = 45;
    ZombieStateStandAndThrow(z, EYE, new Rng(1), NULL_HOST);
    check("with both hands empty it starts the leave delay",
          z.zom.throwDelay === 2, String(z.zom.throwDelay));
    for (let i = 0; i < 4; i++) {
      ZombieStateStandAndThrow(z, EYE, new Rng(1), NULL_HOST);
    }
    check("...and then walks away rather than despawning on the spot",
          z.state === ZombieState.WalkDistance && z.zom.targetArrive === 5
          && !z.despawned,
          `${ZombieState[z.state]} arrive ${z.zom.targetArrive} `
          + `despawned ${z.despawned}`);
    check("...backwards, on `row[4]`",
          (z.flags & ActorFlag.BackingOff) !== 0);
  }

  // **The other way out, and the one the level cannot see.**
  //
  // `ZombieStateStandAndThrow`'s ending is a two-way switch on `obj+0x38` bit
  // 0x10 (`0045945C  TEST byte ptr [ESI + 0x38], 0x10` — `f6463810`), and that
  // bit is not a fact about the room: `EnemyZombieInitByCharType`
  // (`FUN_00452FD0`) **moves** it there out of the spawn record's `obj+0x34`
  // bit 1 at `0045300B`, clearing it at the source. Exactly two records in the
  // shipped game set it — stage 3 block 2 step 4's two axe men, who stand
  // against a building.
  //
  // With the bit unmodelled both of them took the *other* arm and walked their
  // descriptor's twenty-five units backwards through that building, holding
  // `wait_enemies_alive` for the hundred frames it took. `FUN_00457220` has no
  // test that could have stopped them, and the world push at that point in
  // stage 3 is thirty-one quads of flat water twenty-four units below their
  // feet, so nothing in the level was ever going to.
  {
    /** `obj+0x34` bit 1 — the descriptor's "do not walk away". */
    const STAND_THROW_RETIRE = 0x2;
    /** `obj+0x38` bit 4 — what `EnemyZombieInitByCharType` turns it into. */
    const AUX_STAND_THROW_RETIRE = 0x10;

    const axeMan = (flags: number) => {
      ResetGameGlobals();
      SetGameTables(CHARS);
      G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
      G.g_camera_fixed_eye_y = 0;
      const z = spawnZombie(0x7700, 1, "axe man", {
        initialState: ZombieState.StandAndThrow, condition: 7, flags,
        standThrow: { delay_two_hands: 0, delay_one_hand: 0,
                      delay_after_throw: 2, exit_state: 0, walk_distance: 25,
                      leave_delay: 4 },
      });
      z.visible = true;
      z.hp = z.maxHp = 100;
      z.pos = vec3(0, 0, 60);
      return z;
    };

    {
      const z = axeMan(STAND_THROW_RETIRE);
      check("`EnemyZombieInitByCharType` moves the record's bit to obj+0x38",
            (z.flags38 & AUX_STAND_THROW_RETIRE) !== 0
            && (z.flags & STAND_THROW_RETIRE) === 0,
            `0x34 0x${(z.flags >>> 0).toString(16)} `
            + `0x38 0x${(z.flags38 >>> 0).toString(16)}`);
      const plain = axeMan(0);
      check("...and leaves an ordinary record without it",
            (plain.flags38 & AUX_STAND_THROW_RETIRE) === 0,
            `0x${(plain.flags38 >>> 0).toString(16)}`);
    }

    // Both hands already thrown, sitting on the recover's last frame, so the
    // next few calls are the leave delay and then the ending.
    const atTheEnding = (flags: number) => {
      const z = axeMan(flags);
      z.boneSlot["5"] = 0;
      z.boneSlot["8"] = 0;
      z.sub = 4;
      z.motion = 102;
      z.playTicks = 45;                  // play length 46, so frame 45 of it
      return z;
    };

    /**
     * One frame of whichever of the two states the actor is in, so the two
     * endings are driven by the *same* loop and only the descriptor bit is
     * different. Driving state 33 alone would leave a walking actor stepping
     * through a routine that is no longer its own.
     */
    const runFrame = (z: ZombieActor): boolean => {
      if (z.state === ZombieState.StandAndThrow) {
        ZombieStateStandAndThrow(z, EYE, new Rng(1), NULL_HOST);
      } else if (z.state === ZombieState.WalkDistance) {
        ZombieStateWalkDistance(z, new Rng(1));
      } else {
        return false;
      }
      ActorAdvanceMotion(z, 1 / 60);
      return true;
    };

    {
      const z = atTheEnding(STAND_THROW_RETIRE);
      const start = { ...z.pos };
      const aliveAtStart = G.g_enemies_alive;
      let moved = 0;
      let goneAt = -1;
      for (let i = 0; i < 600 && goneAt < 0; i++) {
        if (!runFrame(z)) break;
        moved = Math.max(moved, Math.hypot(z.pos.x - start.x,
                                           z.pos.z - start.z));
        if (z.despawned) goneAt = i;
      }
      // **The assertion is where the actor is**, not what state it says it is
      // in. The fixture's throw clips carry root motion, so "did not move"
      // here is the retreat's twenty-five units being absent rather than a
      // clip that happens to stand perfectly still.
      check("a retiring thrower never leaves the spot the script put it on",
            moved < 1, `${moved.toFixed(3)}u from ${JSON.stringify(start)}`);
      check("...it gives the enemy count back where it stands",
            G.g_enemies_alive === aliveAtStart - 1,
            `${G.g_enemies_alive} was ${aliveAtStart}`);
      check("...and the block it was holding can advance",
            G.g_enemies_alive === 0 && G.g_enemies_present === 0,
            `alive ${G.g_enemies_alive} present ${G.g_enemies_present}`);
      check("...then it despawns after the descriptor's own delay",
            goneAt >= 0, `despawned at frame ${goneAt}`);
      check("...having stayed in state 33 the whole time",
            z.state === ZombieState.StandAndThrow, ZombieState[z.state]);
    }

    {
      // The seven records that do *not* set the bit still walk away, and the
      // distance they cover is the descriptor's own. Same fixture, one bit
      // different: the two endings have to be told apart by that bit alone.
      const z = atTheEnding(0);
      const start = { ...z.pos };
      let moved = 0;
      for (let i = 0; i < 600 && !z.despawned; i++) {
        if (!runFrame(z)) break;
        moved = Math.max(moved, Math.hypot(z.pos.x - start.x,
                                           z.pos.z - start.z));
      }
      check("a thrower without the bit walks its descriptor's distance",
            moved > 20, `${moved.toFixed(2)}u`);
      check("...and despawns at the end of it", z.despawned);
    }
  }

  // **The weapon that flies.** `ZombieThrowHandWeapon` (`FUN_0045A240`) puts
  // the projectile at the throwing bone's own world position, leaves the hand
  // bare and hands the permit over. The assertion is on the world: a record in
  // `g_thrown_weapons` carrying the kit's projectile slot, closing on the eye
  // frame after frame, and a hand whose recorded draw slot is now the bare
  // one. What that slot *draws* is the exporter's half — see the
  // throwing-hand rows in `tools/verify_attachments.py`.
  {
    const z = thrower();
    const host = {
      ...NULL_HOST,
      boneWorld: (_at: number, _bone: number, out: Vec3) => {
        out.x = 0; out.y = 5; out.z = 60;
        return true;
      },
      aimPoint: (_ahead: number, out: Vec3) => {
        out.x = EYE.x; out.y = EYE.y; out.z = EYE.z;
      },
    };
    const kit = CHARS.types["1"].zombie_throw!;
    for (let i = 0; i < 12 && !G.g_thrown_weapons.length; i++) {
      ZombieStateStandAndThrow(z, EYE, new Rng(1), host);
      ActorAdvanceMotion(z, 1 / 60);
    }
    check("the throw puts a weapon in the world",
          G.g_thrown_weapons.length === 1,
          String(G.g_thrown_weapons.length));
    const w = G.g_thrown_weapons[0];
    check("...drawing the kit's own projectile slot",
          !!w && w.slot === kit.hands[0].projectile, `slot ${w?.slot}`);
    check("...and the hand it left is recorded bare",
          z.boneSlot["5"] === kit.hands[0].bare
          || z.boneSlot["8"] === kit.hands[1].bare,
          JSON.stringify(z.boneSlot));
    const before = Math.hypot(w.pos.x - EYE.x, w.pos.z - EYE.z);
    for (let i = 0; i < 10; i++) ThrownWeaponUpdate(1);
    const after = Math.hypot(w.pos.x - EYE.x, w.pos.z - EYE.z);
    check("...and it closes on the camera rather than hanging there",
          after < before - 1, `${before.toFixed(1)} -> ${after.toFixed(1)}`);
    // **Class 0x30's tumble is the X term, and it has no sign test on the
    // hand.** `ZombieThrownWeaponStateStraight` (`FUN_00459690`) at
    // `0x00459731` does `obj+0x64 += obj+0x135C`; class 0x31's
    // `ThrownWeaponFlyToTarget` (`FUN_0044FD40`) at `0x0044FDE9` does
    // `obj+0x68 +=` and negates for the other hand. Both draw the same
    // `Rz * Ry * Rx` product, so the axis is the whole of the difference —
    // and the port turned everything about Y, which cartwheeled exactly one
    // of the two families. It was reported as the spin depending on which
    // zombie threw.
    check("...tumbling about X, which is class 0x30's term",
          w.axis === "x", `axis ${w.axis}`);
    check("...and unsigned by the hand, unlike class 0x31's",
          w.spin > 0, String(w.spin));
    check("...with no `obj+0x1364` tilt, which only class 0x31's launcher writes",
          w.tilt === 0, String(w.tilt));
    check("...and it is actually turning", w.spinAngle !== 0,
          String(w.spinAngle));
  }

  // The other way in: a condition-8 walker already facing the camera.
  {
    const z = thrower(8);
    z.state = ZombieState.AttackRun;
    G.g_camera_yaw_bams = 0x8000;
    z.yaw = 0;                                 // facing the camera's reverse
    check("a condition-8 walker facing the camera stops and throws",
          ZombieShouldStandAndThrow(z));
    const away = thrower(8);
    away.yaw = 0x4000;                         // ninety degrees off
    check("...and one facing away does not", !ZombieShouldStandAndThrow(away));
    const ordinary = thrower(0);
    ordinary.yaw = 0;
    check("...nor does an ordinary body condition",
          !ZombieShouldStandAndThrow(ordinary));
  }
}

// -- 33b. the body condition, and the throw row it keeps out of the strike --

console.log("\nActorBodyConditionFromHands:");
{
  /**
   * `znonoopa.bin` cut down: character type 0x14, whose conditions 7 and 8
   * name the **throw** — `distance` 99, the clip that swings the axe — and
   * whose conditions 0..2 name an ordinary reach at nineteen units. Both rows
   * are in the shipped table, which is why which one is selected matters more
   * than anything else on this actor.
   */
  const AXE_HANDS = [
    { bone: 5, held: 7929, bare: 7926, weapon_bone: 6, projectile: 585 },
    { bone: 8, held: 7925, bare: 7923, weapon_bone: 9, projectile: 585 },
  ];
  const MELEE = {
    "0": { strike: 100, lunge: 101, distance: 19, hit_frame: 10,
           player_motion: 4, cancel_mask: 2 },
    "1": { strike: 100, lunge: 101, distance: 19, hit_frame: 10,
           player_motion: 5, cancel_mask: 4 },
  };
  const TYPE_AXE = {
    ...TYPE,
    type: 0x14, name: "znonoopa", file: "znonoopa.bin",
    attacks: { ...TYPE.attacks, "1": MELEE, "2": MELEE },
    attack_picks: { ...TYPE.attack_picks,
                    "1": new Array(80).fill(0), "2": new Array(80).fill(0) },
    zombie_throw: { ...TYPE.zombie_throw, hands: AXE_HANDS },
    motion_row: { ...TYPE.motion_row,
                  "1": [10, 10, 12, 12, 14], "2": [10, 10, 12, 12, 14] },
    // **The throw clips carry root motion here**, unlike the base fixture's.
    // `ApplyRootMotion` returns before the strike floor when the delta is
    // zero, so a clip that stands perfectly still cannot show the shove — and
    // the shove is the whole of the teleport.
    motions: { ...TYPE.motions, "102": motion(24, 0.05),
               "103": motion(20, 0.05) },
  } as unknown as CharacterType;
  const CHARS_AXE = {
    ...CHARS, types: { "1": TYPE, "20": TYPE_AXE },
  } as unknown as CharactersJson;

  const axeman = (cond: number, at = 0x6784) => {
    ResetGameGlobals();
    SetGameTables(CHARS_AXE);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_player_lives = [PLAYER.start_lives, PLAYER.start_lives];
    G.g_camera_fixed_eye_y = 0;
    const z = ActorSpawn(at, SpawnClass.Zombie, 0x14, "znonoopa", {
      initialState: ZombieState.AttackRun, condition: cond,
    });
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.pos = vec3(0, 0, 60);
    z.motion = 12;
    return z;
  };

  // The trap this whole routine exists to avoid, stated as a fact about the
  // table rather than as a claim about the code.
  {
    const z = axeman(8);
    check("body condition 8 selects the throw row, reach ninety-nine",
          AttackListOf(z)["0"]?.distance === 99,
          String(AttackListOf(z)["0"]?.distance));
    z.condition = 1;
    check("...and the melee row is nineteen",
          AttackListOf(z)["0"]?.distance === 19,
          String(AttackListOf(z)["0"]?.distance));
  }

  // `ZombieStateHoldAtRange` is the one caller, so an actor that reaches the
  // ring can no longer be on the throw row.
  {
    const z = axeman(8);
    const rng = new Rng(4);
    const events = new Events();
    let sawStrike = false;
    let struckOnThrowRow = false;
    let maxStep = 0;
    let prev = { ...z.pos };
    for (let i = 0; i < 900; i++) {
      GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
      maxStep = Math.max(maxStep, Math.hypot(z.pos.x - prev.x,
                                             z.pos.y - prev.y,
                                             z.pos.z - prev.z));
      prev = { ...z.pos };
      if (z.state === ZombieState.Strike) {
        sawStrike = true;
        if (z.condition === 8 || z.condition === 7) struckOnThrowRow = true;
      }
    }
    check("a condition-8 walker reaches the strike", sawStrike);
    check("...never on the throw row", !struckOnThrowRow,
          `condition ${z.condition}`);
    // The teleport, in one number. The run clip carries 1.289 units a frame
    // and the lunge 0.6; anything above a couple of units in a single frame is
    // `ApplyRootMotion`'s floor shoving the actor out to the throw's own
    // ninety-nine-unit range, which is what "gets close, then teleports back
    // and starts throwing" looked like.
    check("...and it never jumps across the room in one frame", maxStep < 3,
          `${maxStep.toFixed(2)} units`);
    check("...it ends up on a hand-derived condition",
          z.condition <= 2, String(z.condition));
  }

  // The routine on its own: the two sticky values, and the operand the engine
  // reads wrong.
  {
    const z = axeman(7);
    ActorBodyConditionFromHands(z);
    check("condition 7 is sticky -- the stationary thrower's own row survives",
          z.condition === 7, String(z.condition));
    const spent = axeman(SPENT_CONDITION);
    ActorBodyConditionFromHands(spent);
    check("...and so is 5", spent.condition === SPENT_CONDITION,
          String(spent.condition));

    const intact = axeman(8);
    ActorBodyConditionFromHands(intact);
    // `0x0045599C` compares the **right** hand's slot against the left hand's
    // held value, so `znonoopa`'s left hand can never count as armed. One
    // hand, condition 1, and `DamageZone.LeftArm` already set -- which is what
    // pins its attack pick to the right-arm swing.
    check("both hands intact still gives condition 1, not 2",
          intact.condition === 1, String(intact.condition));
    check("...with the left arm marked destroyed, as the engine has it",
          (intact.zones & DamageZone.LeftArm) !== 0,
          `zones ${intact.zones}`);

    const empty = axeman(8);
    empty.boneSlot["5"] = 0;
    ActorBodyConditionFromHands(empty);
    check("a thrown right hand takes it to zero", empty.condition === 0,
          String(empty.condition));

    // Character type 1 has no 1-or-2 row, so the routine only ever writes 0.
    ResetGameGlobals();
    SetGameTables(CHARS);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    const znassb = ActorSpawn(0x6800, SpawnClass.Zombie, 1, "znassb", {
      initialState: ZombieState.AttackRun, condition: 8,
    });
    znassb.boneSlot["5"] = 7081;             // `znassb`'s own held slots
    znassb.boneSlot["8"] = 7077;
    ActorBodyConditionFromHands(znassb);
    check("character type 1 with both hands armed is left alone",
          znassb.condition === 8, String(znassb.condition));
    znassb.boneSlot["5"] = 0;
    znassb.boneSlot["8"] = 0;
    ActorBodyConditionFromHands(znassb);
    check("...and only falls to zero when both are empty",
          znassb.condition === 0, String(znassb.condition));
  }
}

// -- 33c. the crawler's attack is meant to miss ------------------------------

console.log("\nthe crawler's undamaged swing:");
{
  /**
   * `znkager` cut down to the row that matters: character type 12, body
   * condition 4 on every one of its 20 shipped spawns, whose condition-4
   * attack list is two real entries at `0x00566E70`:
   *
   * ```
   *  entry 2  e5 03  1b 04  00 00 d0 41  28 00  09 00  01 00   997 / 1051 / 26.0 / hit 40
   *  entry 3  fa 03  1b 04  00 00 d0 41  03 00  07 00  08 00  1018 / 1051 / 26.0 / hit  3
   * ```
   *
   * and whose condition-4 pick row is ten 2s then ten 3s per zone combo, so an
   * **undamaged** crawler always draws entry 2 and a crawler with its head
   * shot off always draws entry 3.
   *
   * Entry 2's hit frame is 40 against `g_motion_play_length[997]` = 20, and
   * `ZombieStateStrike` fires the hit on `obj+0x19C == entry+0x08` *exactly*
   * (`00455bdf`) while leaving the state at `play_length - 1` (`00455c0b`), so
   * the equality is never reached: the engine's undamaged crawler swings and
   * misses, every time. The frame counts and play lengths below are the real
   * bake — 997 is 11 authored frames with a play length of 20, 1018 is 19 with
   * 35, 1051 is 17 with 31.
   *
   * This is divergence 2, closed. The exporter used to drop entry 2 as an
   * impossible row and `ZombiePickAttack` used to substitute another entry
   * when the draw named one the bundle had no row for, which between them
   * handed the crawler entry 3 — a swing that connects. Measured against the
   * real stage-2 bundle: 29 hits landed in a minute before, 0 after.
   */
  const CRAWL = {
    "2": { strike: 997, lunge: 1051, distance: 26, hit_frame: 40,
           player_motion: 9, cancel_mask: 1 },
    "3": { strike: 1018, lunge: 1051, distance: 26, hit_frame: 3,
           player_motion: 7, cancel_mask: 8 },
  };
  const CRAWL_PICKS = Array.from({ length: 80 },
                                 (_, i) => (i % 20 < 10 ? 2 : 3));
  const TYPE_CRAWLER = {
    ...TYPE,
    type: 12, name: "znkager", file: "znkager.bin",
    attacks: { ...TYPE.attacks, "4": CRAWL },
    attack_picks: { ...TYPE.attack_picks, "4": CRAWL_PICKS },
    motion_row: { ...TYPE.motion_row, "4": [10, 10, 12, 12, 14] },
    reactions: { ...TYPE.reactions, "4": TYPE.reactions["0"] },
    motions: { ...TYPE.motions, "997": motion(11, 0.2, 20),
               "1018": motion(19, 0.2, 35), "1051": motion(17, 0.6, 31) },
  } as unknown as CharacterType;
  const CHARS_CRAWLER = {
    ...CHARS, types: { "1": TYPE, "12": TYPE_CRAWLER },
  } as unknown as CharactersJson;

  const crawler = (zones: number) => {
    ResetGameGlobals();
    SetGameTables(CHARS_CRAWLER);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_player_lives = [PLAYER.start_lives, PLAYER.start_lives];
    G.g_camera_fixed_eye_y = 0;
    const z = ActorSpawn(0x4048, SpawnClass.Zombie, 12, "znkager", {
      initialState: ZombieState.AttackRun, condition: 4,
    });
    if (z.cls !== SpawnClass.Zombie) throw new Error("not class 0x30");
    z.visible = true;
    z.attackState = 1;
    z.hp = z.maxHp = 10000;         // it must survive the whole measurement
    z.zones = zones;
    z.pos = vec3(0, 0, 60);
    z.motion = 12;
    return z;
  };

  // The draw, on its own. `ZombiePickAttack` indexes blind, as the engine
  // does: the substitute that used to sit behind this is what made the
  // crawlers dangerous.
  {
    const z = crawler(0);
    const rng = new Rng(3);
    const drawn = new Set<number>();
    for (let i = 0; i < 200; i++) drawn.add(ZombiePickAttack(z, rng));
    check("an undamaged crawler draws entry 2, every time",
          drawn.size === 1 && drawn.has(2), `drew {${[...drawn].join(",")}}`);
    z.zones = DamageZone.Head;
    drawn.clear();
    for (let i = 0; i < 200; i++) drawn.add(ZombiePickAttack(z, rng));
    check("...and with its head shot off, entry 3",
          drawn.size === 1 && drawn.has(3), `drew {${[...drawn].join(",")}}`);
  }

  // The draw must not be second-guessed against the list. A pick naming an
  // index the bundle has no row for is the ten **zeroed** entries the shipped
  // tables carry, and the engine deals no damage on one of those either.
  {
    const z = crawler(0);
    const rng = new Rng(3);
    const bare = {
      ...TYPE_CRAWLER,
      attacks: { ...TYPE.attacks, "4": { "3": CRAWL["3"] } },
    } as unknown as CharacterType;
    const bareChars = {
      ...CHARS, types: { "1": TYPE, "12": bare },
    } as unknown as CharactersJson;
    SetGameTables(bareChars);
    check("a draw the list cannot satisfy is still the draw",
          ZombiePickAttack(z, rng) === 2, String(ZombiePickAttack(z, rng)));
  }

  // And the whole thing running: sixty seconds of one crawler with a live
  // player in front of it.
  const minute = (zones: number) => {
    const z = crawler(zones);
    const rng = new Rng(5);
    const events = new Events();
    let damaged = 0;
    events.on("player.damaged", () => { damaged += 1; });
    let strikes = 0;
    let was = false;
    const drawn = new Set<number>();
    for (let i = 0; i < 3600; i++) {
      GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
      const now = z.state === ZombieState.Strike;
      if (now && !was) strikes += 1;
      if (now && z.attack >= 0) drawn.add(z.attack);
      was = now;
    }
    return { strikes, damaged, drawn: [...drawn].sort() };
  };

  {
    const m = minute(0);
    check("it gets its swing in", m.strikes > 10, `${m.strikes} strikes`);
    check("...on entry 2", m.drawn.length === 1 && m.drawn[0] === 2,
          `drew {${m.drawn.join(",")}}`);
    // The point of the whole change.
    check("...and lands no damage at all, because clip 997 never reaches "
          + "frame 40", m.damaged === 0, `${m.damaged} hits landed`);
  }
  {
    // The other arm, so that "no damage" is a property of the entry and not
    // of the fixture: shoot the head off and the same crawler connects.
    const m = minute(DamageZone.Head);
    check("a crawler with its head shot off draws entry 3 and does connect",
          m.damaged > 0 && m.drawn.length === 1 && m.drawn[0] === 3,
          `${m.damaged} hits on {${m.drawn.join(",")}}`);
  }
}

// `g_camera_free` -- the gate every room-clear wait needs on top of its
// counter. It is the flag that decides whether a room hands over on the frame
// the last enemy dies or once the camera has swung back onto its rail, and the
// way it fails is by never rising, which parks the script for good.
{
  ResetGameGlobals();

  // Claimed: somebody is in the camera's slots.
  G.g_enemy_slots = [0];
  G.g_enemies_alive = 1;
  G.g_camera_settled = 1;
  UpdateCameraFreeFlag();
  check("the camera is not free while an enemy holds a slot",
        G.g_camera_free === 0);

  // The slot empties and the flag rises again -- that is the whole rule.
  G.g_enemy_slots = [];
  UpdateCameraFreeFlag();
  check("the camera is free once nothing holds a slot", G.g_camera_free === 1);

  // The rule is the slot array and NOTHING else. An earlier cut of this also
  // required `g_enemies_alive == 0` and a converged aim -- terms that belong
  // to the other camera driver, not this one -- and the conjunction held every
  // room-clear gate for ever while anything was still alive. These two are the
  // regression: enemies alive, and an aim that has not converged, must both
  // leave the flag up.
  G.g_enemies_alive = 5;
  UpdateCameraFreeFlag();
  check("...even with enemies alive, if none of them holds a slot",
        G.g_camera_free === 1);
  G.g_camera_settled = 0;
  UpdateCameraFreeFlag();
  check("...and without waiting for the aim to converge",
        G.g_camera_free === 1);
}

// The camera-path cue, and the frame that gets stepped over.
//
// `g_cam_path_frame` is an integer in the engine -- both camera drivers end on
// `__ftol` -- and it steps by exactly one, so the engine's cue tests are plain
// `==`. Handing the walker's float straight to the global made `==` a coin
// toss, and class 0x10's removal cue is one of those: a civilian that misses
// it never leaves `g_civilians_alive`, so `wait_scripted_actors` waits for
// ever. `CamPathCueReached` answers `>=` instead.
//
// The `g_cam_path_frame_prev` these cases used to set is gone. It was a
// declared divergence -- a crossing test, to cover a tick that advanced the
// camera by more than one frame -- and two things retired it: the loop calls
// `w.tick(TICK)` exactly once per frame, so the camera steps by exactly one;
// and `CamPathCueReached` never read the field in the first place, having
// moved to `>=` when "already past counts as reached" went in. It was carried
// in every snapshot regardless.
{
  ResetGameGlobals();
  G.g_active_cam_path = 39;

  G.g_cam_path_frame = 280;
  check("a cue the camera lands on fires", CamPathCueReached(39, 280));

  G.g_cam_path_frame = 281;
  check("...and so does one a slow frame steps over",
        CamPathCueReached(39, 280));

  // **Already past counts as reached.** A cue is one-shot, and the paths play
  // once, forward. `seek` restores the camera frame from the address without
  // running the game, so a script can start waiting on a cue the camera has
  // already gone by -- and on a crossing test that cue could never fire again.
  // That is stage 1's hostage: its death script waits on `(39, 60)`, and
  // resuming at `block=1&step=8&op=12&frame=100` put the camera at 100 first.
  // The script never reached its `LeaveCountNow` and `wait_scripted_actors 0`
  // waited for ever.
  G.g_cam_path_frame = 281;
  check("...and a cue the camera is already past still reads as reached",
        CamPathCueReached(39, 280));

  G.g_cam_path_frame = 281;
  check("...but not on a different path", !CamPathCueReached(40, 280));

  G.g_cam_path_frame = 0;
  check("...nor before the path has reached it", !CamPathCueReached(39, 280));
}

// The captor's exit: `ZombieScriptEnded` (`FUN_0045C8D0`) and the shortcut in
// its `WalkPastPoint` arm. Stage 1's `0x18E8` is the shape that matters --
// initial state 34 (`WalkToTarget`), attack state 40 (`WalkPastPoint`), an
// attack script whose point sits in front of it and no entries at all.
//
// **These two assertions were the mirror image of the engine**, because they
// were written against `ActorPointIsAhead`'s inverted yaw term -- see
// `PointLocalZ` in `class30/target.ts`. `MatrixRotateY(-yaw)` gives
// `z' = dx*sin + dz*cos`; the port had `dz*cos - dx*sin`, the *forward*
// rotation, so the predicate answered a point in front where the engine
// answers a point behind. The setups below are unchanged and the expectations
// are swapped, which is the whole of the correction.
//
// The semantics that come out are the ones the state's name asks for: a point
// you have **already walked past** leaves nothing to walk, so the captor turns
// on the player at once; a point still in front of you is a leg to walk first.
{
  const captor = (state: number, attackState: number,
                  point: [number, number, number], yaw = 0) => {
    ResetGameGlobals();
    const z = spawnZombie(0x18e8, 1, "captor");
    z.state = state;
    z.attackState = attackState;
    z.yaw = yaw;
    z.pos = vec3(-80, 2, -309);
    z.script = { target: null,
                 attack: { state: attackState, head: { point }, entries: [] } };
    return z;
  };

  // At x = -80 facing +X (yaw 0xC000), the point at x = -25 is **in front**:
  // there is a leg to walk, so the captor walks it.
  const ahead = captor(ZombieState.TargetMotionScript, ZombieState.WalkPastPoint,
                       [-25, 2, -309], 0xc000);
  ZombieScriptEnded(ahead);
  check("a captor whose point is still in front walks the leg first",
        ahead.state === ZombieState.WalkPastPoint && ahead.sub === 1,
        `state ${ahead.state} sub ${ahead.sub}`);

  // Facing -X, so the same point is behind him: nothing left to walk past.
  const behind = captor(ZombieState.TargetMotionScript, ZombieState.WalkPastPoint,
                        [-25, 2, -309], 0x4000);
  ZombieScriptEnded(behind);
  check("...and one who is already past it turns on the player at once",
        behind.state === ZombieState.AttackRun && behind.sub === 0,
        `state ${behind.state} sub ${behind.sub}`);

  // The role flip itself: a captor already *in* its attack state goes to
  // `AttackRun`, which is what ends the family for good.
  const done = captor(ZombieState.WalkPastPoint, ZombieState.WalkPastPoint,
                      [-25, 2, -309], 0x4000);
  ZombieScriptEnded(done);
  check("a captor that has finished its attack script goes to AttackRun",
        done.state === ZombieState.AttackRun, `state ${done.state}`);
}

// State 42, the camera-cue hold (`ZombieStateHoldForCameraCue`,
// `FUN_0045BFD0`). A captor that has finished its script and would turn on the
// player is instead **staged for a shot**: it runs at the player and holds at
// range, but may not land the blow until the camera reaches the path and frame
// in its descriptor tail. Three spawns in the game do this, all in stage 2.
{
  const staged = (cue: { path: number; frame: number } | null) => {
    ResetGameGlobals();
    const z = spawnZombie(0xa030, 1, "staged captor");
    z.state = ZombieState.TargetMotionScript;
    z.attackState = ZombieState.AttackRun;
    z.cameraCue = cue;
    return z;
  };

  // The exit is diverted rather than going to AttackRun.
  const held = staged({ path: 75, frame: 660 });
  ZombieScriptEnded(held);
  check("a captor with a camera cue holds instead of turning on the player",
        held.state === ZombieState.HoldForCameraCue
        && held.zom.delegate === ZombieState.AttackRun
        && (held.flags & ActorFlag.NoCameraTrack) !== 0,
        `state ${held.state} delegate ${held.zom.delegate}`);

  // Without a cue it goes straight through, which is the other 66 spawns.
  const free = staged(null);
  ZombieScriptEnded(free);
  check("...and one without a cue does not",
        free.state === ZombieState.AttackRun, `state ${free.state}`);

  // Holding: the delegate runs, and the state comes straight back.
  G.g_active_cam_path = 12;
  G.g_cam_path_frame = 3;
  let ran = 0;
  ZombieStateHoldForCameraCue(held, (o, st) => { ran = st; void o; });
  check("the hold runs its delegate every frame",
        ran === ZombieState.AttackRun && held.state === ZombieState.HoldForCameraCue,
        `ran ${ran}, state ${held.state}`);

  // The delegate wants to strike: bounced to HoldAtRange, permit given up.
  held.attackPermit = 0;
  G.g_attack_permits[0] = 1;
  ZombieStateHoldForCameraCue(held, (o) => { o.state = ZombieState.Strike; });
  check("a delegate that reaches Strike is bounced, and gives the permit back",
        held.state === ZombieState.HoldForCameraCue
        && held.zom.delegate === ZombieState.HoldAtRange
        && held.attackPermit === -1,
        `state ${held.state} delegate ${held.zom.delegate} permit ${held.attackPermit}`);

  // The camera arrives: it graduates to the delegate and is visible again.
  G.g_active_cam_path = 75;
  G.g_cam_path_frame = 660;
  ZombieStateHoldForCameraCue(held, () => {});
  check("and it graduates when the camera reaches the cue",
        held.state === ZombieState.HoldAtRange
        && (held.flags & ActorFlag.NoCameraTrack) === 0,
        `state ${held.state} flags 0x${(held.flags >>> 0).toString(16)}`);
}

// -- the rain, which used to be unreachable from here ----------------------

console.log("\nrain: DrawRainParticles' simulation half");

{
  const rules: RainRules = {
    fallPerFrame: 2, respawnBelow: -7,
    spawn: { x: [0x14, -10], y: [0x32, -25], z: [0x19, -35] },
  };
  const rng = new Rng(1);
  ResetGameGlobals();
  RainResetParticles(rules, rng);
  check("the pool is the extent of the array, not a stored count",
        G.g_rain_particles.length === RAIN_PARTICLE_COUNT,
        `${G.g_rain_particles.length}`);
  check("every drop spawns inside the box the routine's three rand()s give",
        G.g_rain_particles.every((p) =>
          p.x >= -10 && p.x <= 9 && p.y >= -25 && p.y <= 24
          && p.z >= -35 && p.z <= -11),
        JSON.stringify(G.g_rain_particles[0]));
  // The spawn box is in *front* of the camera: z is never positive, so a drop
  // is never created behind the view.
  check("and always in front of the camera",
        G.g_rain_particles.every((p) => p.z < 0));

  const before = G.g_rain_particles.map((p) => p.y);
  RainAdvanceParticles(rules, 1, rng);
  check("one frame is `p.y -= 2.0`, or a respawn into the box",
        G.g_rain_particles.every((p, i) =>
          p.y === before[i] - 2 || (p.y >= -25 && p.y <= 24)),
        `${before[0]} -> ${G.g_rain_particles[0].y}`);

  // The invariant, and it is not "y > -7". The routine falls *then* tests
  // once, so a respawn may itself land below the line -- the box runs down to
  // -25 -- and that drop falls again next frame. What must always hold at the
  // end of a step is that every drop is back inside the spawn box's range.
  // Sixty seconds, so every drop has wrapped many times.
  RainAdvanceParticles(rules, 60 * 60, rng);
  check("a drop never escapes the spawn box's vertical range",
        G.g_rain_particles.every((p) => p.y >= -25 && p.y <= 24),
        JSON.stringify(G.g_rain_particles.filter(
          (p) => p.y < -25 || p.y > 24)));

  // The whole reason it moved: the positions are in `G`, so they are in the
  // snapshot. A save/restore must put the rain back exactly where it was.
  const saved = structuredClone(G.g_rain_particles);
  RainAdvanceParticles(rules, 10, rng);
  G.g_rain_particles = structuredClone(saved);
  check("the pool round-trips through a snapshot",
        JSON.stringify(G.g_rain_particles) === JSON.stringify(saved));

  // Determinism: the same seed must give the same rain, or a replay diverges.
  ResetGameGlobals();
  RainResetParticles(rules, new Rng(7));
  const a = JSON.stringify(G.g_rain_particles);
  ResetGameGlobals();
  RainResetParticles(rules, new Rng(7));
  check("and the same seed gives the same rain",
        JSON.stringify(G.g_rain_particles) === a);
}

// ---------------------------------------------------------------------------
// `FUN_00473CF0`'s pose: `side` is a sign, and four hinges prove it matters
// ---------------------------------------------------------------------------
{
  console.log("\nscripted scenery: the hinge pose");

  // One key from stage 1's curve 0, frame 20 -- the slam judder, where the
  // door has stopped swinging and the X and Z wobble peak. This is the frame
  // the four odd hinges went berserk on, which is why it reads on screen as
  // "spins at the end of the swing" rather than "opens to the wrong angle".
  const slam = [9400, 16869, 9443];

  check("side +1 leaves every angle as the curve wrote it",
        JSON.stringify(HingePose({ side: 1 }, slam))
        === JSON.stringify({ rx: 9400, ry: 16869, rz: 9443 }));

  // `ADD ECX` becomes `SUB ECX` and the yaw gets a `NEG`; `obj+0x6C` is
  // written from the same `ADD EDX,EAX` on both arms, so rz does not mirror.
  check("side -1 mirrors rx and ry, and leaves rz alone",
        JSON.stringify(HingePose({ side: -1 }, slam))
        === JSON.stringify({ rx: -9400, ry: -16869, rz: 9443 }));

  // The bug. `prop_06dc_0` and `prop_0724_0` in stage 1 carry +/-512 -- the
  // amplitude of the wobble they do when shot -- and multiplying by that put
  // 4.8 million BAMS, 73 turns, on the X axis of a door.
  const big = HingePose({ side: 512 }, slam);
  check("a magnitude never reaches the pose",
        big.rx === 9400 && big.ry === 16869 && big.rz === 9443,
        `rx=${big.rx} (${(big.rx / 65536).toFixed(1)} turns)`);
  check("and its sign still mirrors, at 416 as at 1",
        HingePose({ side: -416 }, slam).rx === -9400);

  // `TEST EAX,EAX; JLE`: zero takes the negative arm. No shipped hinge is
  // zero, but the exporter's `or 0` can produce one from an absent parameter.
  check("zero takes the mirrored arm, as `JLE` does",
        HingePose({ side: 0 }, slam).ry === -16869);

  // Every angle stays inside a turn for every side the game ships. The four
  // odd ones are stage 1's; the other 52 are +/-1.
  const shipped = [1, -1, 512, -512, 416, -416];
  check("no shipped side can drive an angle past one turn",
        shipped.every((side) => {
          const a = HingePose({ side }, slam);
          return Math.abs(a.rx) < 0x10000 && Math.abs(a.ry) < 0x10000;
        }));
}

// ---------------------------------------------------------------------------
// class 0x31: the permit it gives back, the body it has, and the death it dies
// ---------------------------------------------------------------------------
{
  console.log("\nclass 0x31, what stopped the throwers working:");

  // **The permit latch, and the wrong function.** `obj+0x136C` carries the
  // off-screen latch in bit 0x8000 for a thrower and 0x20000 for a zombie —
  // one word, two classes, two bits — so `ReleaseAttackSlot` (`FUN_00456520`)
  // called on a thrower frees the permit *array* and leaves
  // `g_attack_committed` raised. `TryClaimAttackSlot` reads that latch on its
  // first line, so after one off-screen pounce nothing in the scene could ever
  // attack again: every thrower parked in `WaitForPermit` wanting a permit
  // that nobody held.
  const offscreen = {
    ...NULL_HOST,
    viewSpaceOf: (_at: number, out: Vec3) => {
      out.x = 900; out.y = 0; out.z = -40;     // off the side of a 640 frame
      return true;
    },
  };
  {
    const z = thrower(ThrowerState.StandAndDecide);
    check("a thrower off the side of the frame takes a permit and latches",
          ThrowerTryClaimAttackSlot(z, offscreen)
          && G.g_attack_committed === 1
          && (z.flags2 & ThrowerFlag.OffScreenPermit) !== 0,
          `latch ${G.g_attack_committed} flags2 ${z.flags2.toString(16)}`);
    // The zombie's release reads the wrong bit — it is what the port called.
    ReleaseAttackSlot(z);
    check("...and the class-0x30 release cannot lift it",
          G.g_attack_committed === 1, `latch ${G.g_attack_committed}`);
    ThrowerReleaseAttackPermit(z);
    check("only `ThrowerReleaseAttackPermit` does",
          G.g_attack_committed === 0
          && (z.flags2 & ThrowerFlag.OffScreenPermit) === 0);
  }

  // The same thing end to end, through the state machine: pounce, leap aside,
  // and the next claim must succeed. This is the reported symptom exactly —
  // "after their first attack they stop attacking and just wait".
  {
    const rng = new Rng(5);
    const events = new Events();
    const z = thrower(ThrowerState.StandAndDecide);
    T.coli = { files: ["test"], blobs: { floor: FLOOR_BLOB } };
    G.g_coli_full_set = ["floor"];
    z.pos = vec3(0, 0, 20);                    // inside CLOSE_RANGE, so state 8
    let pounced = false;
    for (let i = 0; i < 1200; i++) {
      GameUpdate(EYE, 1 / 60, offscreen, rng, events);
      if (z.state === ThrowerState.Pounce) pounced = true;
      if (pounced && z.state === ThrowerState.StandAndDecide) break;
    }
    check("a thrower that has pounced once can claim again",
          pounced && G.g_attack_committed === 0
          && ThrowerTryClaimAttackSlot(z, offscreen),
          `pounced ${pounced} latch ${G.g_attack_committed}`
          + ` state ${z.state} permit ${z.attackPermit}`);
    ThrowerReleaseAttackPermit(z);
  }

  // **The body sphere.** `ThrowerPushOutOfWorld` (`FUN_00449D40`) is the hook
  // `EnemyThrowerInit` installs at `obj+0x12F0`, and only its third job — the
  // surface snap — used to run. So a thrower was tested against the world at
  // its origin and stood a whole radius inside a wall.
  {
    const rng = new Rng(7);
    const events = new Events();
    const z = thrower(ThrowerState.StandAndDecide);
    check("a thrower is born colliding, and with a radius",
          (z.flags2 & ThrowerFlag.CollideWorld) !== 0
          && (z.flags2 & ThrowerFlag.CollideActors) !== 0
          && z.bodyRadius === 4,
          `flags2 ${z.flags2.toString(16)} r ${z.bodyRadius}`);

    T.coli = { files: ["test"], blobs: { wall: WALL_BLOB, floor: FLOOR_BLOB } };
    G.g_coli_full_set = ["wall", "floor"];
    // **The reported symptom, exactly.** The wall's solid side is x > 30, so
    // an origin at x = 28 is legally outside it — and a four-unit body sphere
    // is two units *inside* it. Nothing measured that, so the model stood in
    // the wall.
    z.pos = vec3(28, 0, 45);
    GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
    check("and a body sphere inside a wall its origin is clear of is pushed out",
          z.pos.x <= 26 + 1e-6, `x ${z.pos.x.toFixed(2)}`);
    // The sphere is the actor lifted by 1.4 radii, not by a constant: that is
    // `FUN_00449E80`'s own literal and it is what makes the body, rather than
    // the feet, the thing the wall pushes.
    check("the sphere sits 1.4 radii above a grounded thrower",
          Math.abs(z.sphereCentre.y - (z.pos.y + z.bodyRadius * 1.4)) < 1e-6,
          `${z.sphereCentre.y} vs ${z.pos.y}`);
  }

  // **The order.** The hook runs *after* the state, because every state here
  // writes `obj.pos` outright — a push applied first is overwritten before
  // anything draws it. `LeapToPoint` is the sharpest case: its last frame
  // snaps the actor onto the descriptor's named point, so if that point is
  // inside a wall the push is the only thing between it and standing there.
  {
    const rng = new Rng(11);
    const events = new Events();
    // After `thrower()`, never before: it calls `SetGameTables(CHARS31)` with
    // no collision, which clears `T.coli`.
    const z = thrower(ThrowerState.LeapToPoint, {
      // Two units past the wall's plane at x = 30, so the body is inside it.
      leap: { dest: [28, 0, 45], frames: 4 },
    });
    T.coli = { files: ["test"], blobs: { wall: WALL_BLOB, floor: FLOOR_BLOB } };
    G.g_coli_full_set = ["wall", "floor"];
    z.pos = vec3(0, 0, 45);
    // Long enough for the arc **and its landing clip**: the state holds until
    // `ActorArcStep` runs out of script, which is what makes the leap an
    // animation rather than a slide.
    for (let i = 0; i < 200 && z.state === ThrowerState.LeapToPoint; i++) {
      GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
    }
    GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
    check("a state that writes `pos` outright is still pushed clear after it",
          z.state === ThrowerState.StandAndDecide && z.pos.x <= 26 + 1e-6,
          `state ${z.state} x ${z.pos.x.toFixed(2)}`);
  }

  // **Behind the surface.** `ColiSphereVsMesh` compares `distance²` against
  // `radius²` and never asks which side the centre is on; the caller turns a
  // negative plane distance into `radius + distance`, which puts a body that
  // has got through a wall back out the front, exactly tangent. The port
  // rejected the case (`if (d < 0) continue`), so a body far enough in was not
  // pushed at all — which is "quite far into the wall".
  {
    ResetGameGlobals();
    T.coli = { files: ["test"], blobs: { wall: WALL_BLOB, floor: FLOOR_BLOB } };
    G.g_coli_full_set = ["wall", "floor"];
    // The wall's outward normal is -x, so the solid side is x > 30.
    check("a sphere in front of a wall is pushed to tangent",
          ColiTestSphereAgainstFullSet(28, 5.6, 45, 4)
          && Math.abs(G.g_coli_hit_depth - 2) < 1e-6
          && Math.abs((G.g_coli_hit_normal[0] ?? 0) + 1) < 1e-6,
          `depth ${G.g_coli_hit_depth} n ${G.g_coli_hit_normal.join(",")}`);
    check("a sphere whose centre is *behind* it is a hit too",
          ColiTestSphereAgainstFullSet(33, 5.6, 45, 4),
          "no hit");
    // 3 behind + 4 radius = 7, along the same outward normal: 33 - 7 = 26,
    // which is four units clear on the walkable side.
    check("...and its depth carries the side, not its normal",
          Math.abs(G.g_coli_hit_depth - 7) < 1e-6
          && Math.abs((G.g_coli_hit_normal[0] ?? 0) + 1) < 1e-6,
          `depth ${G.g_coli_hit_depth} n ${G.g_coli_hit_normal.join(",")}`);
    check("so one push lands it exactly tangent, on the outside",
          Math.abs((33 + (G.g_coli_hit_normal[0] ?? 0) * G.g_coli_hit_depth) - 26)
          < 1e-6);
  }

  // **On the wall.** `ThrowerSnapToSurface` calls `ThrowerFindSurfaceUnderfoot`
  // (`FUN_0044C640`), not `TraceActorSurfaceContactPoint` (`FUN_0044C370`) —
  // two different routines, and the port had been calling the second for the
  // first. The one that matters re-places a clinging actor **6.5 units off**
  // the surface it found; the other returns the hit itself. With the origin in
  // the wall plane and the sphere centred on it — a wall stance leaves y alone
  // — half the actor is inside the geometry, and the push cannot help because
  // this runs after it.
  {
    const rng = new Rng(13);
    const events = new Events();
    const z = thrower(ThrowerState.StandAndDecide);
    T.coli = { files: ["test"], blobs: { wall: WALL_BLOB, floor: FLOOR_BLOB } };
    G.g_coli_full_set = ["wall", "floor"];
    // Clinging to the wall at x = 30, facing along -z so the cardinal puts the
    // probe across the x axis.
    z.flags2 |= ThrowerFlag.OffGround | ThrowerFlag.WallA;
    z.yaw = 0;
    z.pos = vec3(29.5, 12, 45);
    GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
    const off = 30 - z.pos.x;
    check("a thrower on a wall stands 6.5 units off it, not in it",
          Math.abs(off - 6.5) < 1e-3, `${off.toFixed(3)} off the wall`);
    // ...and that is enough for the body to be clear: the sphere is centred on
    // the actor's own y for a wall stance, so on the plane it would be half in.
    check("...which is what puts its body outside the geometry",
          !ColiTestSphereAgainstFullSet(z.sphereCentre.x, z.sphereCentre.y,
                                        z.sphereCentre.z, z.bodyRadius),
          `depth ${G.g_coli_hit_depth}`);
    check("and a wall stance leaves the sphere level with the actor",
          Math.abs(z.sphereCentre.y - z.pos.y) < 1e-6,
          `${z.sphereCentre.y} vs ${z.pos.y}`);
  }

  // **Which way a shot body flies.** `ThrowerBeginKnockbackArc`
  // (`FUN_0044D120`) moves the actor's **view-space** point along the camera's
  // own z and transforms it back: `p = (obj+0x70, obj+0x74, obj+0x78 - t)`.
  // That space has −z in front — `ThrowerPickLandingPoint` unprojects at a
  // literal −15.5 — so `z - t` is *further in front*, and the body is thrown
  // away from the viewer. The port lerped from the actor toward the eye
  // instead, under a `[diverges]` claiming the camera matrix was out of reach,
  // and `k = min(1, t / d)` pinned the destination *on* the camera for
  // anything inside about fifteen units. A thrower pounces to 15.5 in front,
  // so that was every close kill: "when I kill them they seem to be pulled
  // towards me rather than away".
  {
    const z = thrower(ThrowerState.StandAndDecide);
    T.coli = { files: ["test"], blobs: { floor: FLOOR_BLOB } };
    G.g_coli_full_set = ["floor"];
    // Off to one side and well inside the range that used to pin it: the
    // lateral offset is what tells the two shapes apart.
    z.pos = vec3(6, 0, 14);
    z.lookAt = vec3(6, 8, 14);
    const wasZ = z.pos.z;
    ThrowerBeginKnockbackArc(z, CAM_HOST);
    check("a shot body is thrown away from the camera, not at it",
          z.arcTo.z > wasZ, `${wasZ} -> ${z.arcTo.z.toFixed(2)}`);
    // Along the camera's z, so the screen-space offset survives: the body
    // recedes rather than converging on the viewer.
    check("...and it keeps its offset across the screen",
          Math.abs(z.arcTo.x - z.pos.x) < 1e-6,
          `x ${z.pos.x} -> ${z.arcTo.x.toFixed(2)}`);
    check("and it ends further from the eye than it began",
          Math.hypot(z.arcTo.x - EYE.x, z.arcTo.z - EYE.z)
          > Math.hypot(z.pos.x - EYE.x, z.pos.z - EYE.z),
          `${Math.hypot(z.pos.x - EYE.x, z.pos.z - EYE.z).toFixed(2)}`
          + ` -> ${Math.hypot(z.arcTo.x - EYE.x, z.arcTo.z - EYE.z).toFixed(2)}`);
    check("and it never lands on the camera",
          Math.hypot(z.arcTo.x - EYE.x, z.arcTo.z - EYE.z) > 1,
          `${z.arcTo.x.toFixed(2)},${z.arcTo.z.toFixed(2)} vs eye`);

    // Dead is half as far again — `if (obj+0x34 & 0x4000000) t *= 1.5`.
    const alive = z.arcTo.z - z.pos.z;
    z.flags |= ActorFlag.Dead;
    ThrowerBeginKnockbackArc(z, CAM_HOST);
    check("a body that was already dead is thrown half as far again",
          Math.abs((z.arcTo.z - z.pos.z) - alive * 1.5) < 1e-4,
          `${alive.toFixed(3)} -> ${(z.arcTo.z - z.pos.z).toFixed(3)}`);
  }

  // **How long that arc lasts, which is not one number.**
  // `ActorArcBeginToAtSpeed` (`FUN_0044DB50`) picks its floor from two flag
  // words before it divides:
  //
  //   0044dbaa  TEST EAX, 0x2000000    a900000002   ; EAX = obj+0x136C
  //   0044dbc9  JZ   0044dbda                       ; clear -> 15
  //   0044dbce  MOV  EDI, 0xa                       ; set   -> 10 ...
  //   0044dbd3  TEST EAX, 0x44000000   a900000044   ; ... EAX = obj+0x34
  //   0044dbd8  JZ   0044dbdf                       ;     unless dead/reacting
  //   0044dbda  MOV  EDI, 0xf                       ;     -> 15
  //   0044dbe7  FDIVR float ptr [0x0055ccd4]        ; = 0000f041 = 30.0f
  //
  // so `arcTotal = max(N, dist2d / (30.0 / N))`. `ThrowerShotFeedback`
  // (`FUN_00449B20`) raises `ThrowerFlag.LowSphere` as half of
  // `OR EDX, 0x6000000` on the head shot that knocks a thrower down, so a
  // **live** knocked-down thrower takes the 10 branch — and the port had 15
  // and `dist2d / 2` hardcoded, which is only ever the other one.
  {
    const near = () => {
      const a = thrower(ThrowerState.StandAndDecide);
      T.coli = { files: ["test"], blobs: { floor: FLOOR_BLOB } };
      G.g_coli_full_set = ["floor"];
      // Close enough that the travel never reaches either floor, so the
      // assertion is about the floor itself and not about the division.
      a.pos = vec3(0, 0, 60);
      a.lookAt = vec3(0, 8, 60);
      return a;
    };

    const plain = near();
    ThrowerBeginKnockbackArc(plain, CAM_HOST);
    check("an ordinary shot body's arc is floored at 15 frames",
          plain.arcTotal === 15, `${plain.arcTotal}`);

    const knocked = near();
    knocked.flags2 |= ThrowerFlag.LowSphere;
    ThrowerBeginKnockbackArc(knocked, CAM_HOST);
    check("a live knocked-down thrower's is floored at 10, not 15",
          knocked.arcTotal === 10, `${knocked.arcTotal}`);

    // ...and the second test kills the branch again: `0x44000000` is
    // `Dead | Reacting` on `obj+0x34`.
    for (const f of [ActorFlag.Dead, ActorFlag.Reacting]) {
      const back = near();
      back.flags2 |= ThrowerFlag.LowSphere;
      back.flags |= f;
      ThrowerBeginKnockbackArc(back, CAM_HOST);
      check(`...but obj+0x34 0x${f.toString(16)} puts it back to 15`,
            back.arcTotal === 15, `${back.arcTotal}`);
    }

    // The divisor moves with the floor: 30 units per `N` frames, so the same
    // distance takes fewer frames on the 10 branch. Far enough out that both
    // clear their floor.
    // `t = 15/|view| * 10`, so the throw is longest from close in — which is
    // also the only place either floor is cleared.
    const far = (low: boolean) => {
      const a = near();
      if (low) a.flags2 |= ThrowerFlag.LowSphere;
      a.pos = vec3(0, 0, 4);
      a.lookAt = vec3(0, 1, 4);
      ThrowerBeginKnockbackArc(a, CAM_HOST);
      const d = Math.hypot(a.arcTo.x - a.arcFrom.x, a.arcTo.z - a.arcFrom.z);
      return { total: a.arcTotal, d };
    };
    const slow = far(false);
    const fast = far(true);
    check("a long arc runs at 30 units per its own floor",
          slow.total > 15 && fast.total > 10
          && slow.total === Math.trunc(slow.d / (30 / 15))
          && fast.total === Math.trunc(fast.d / (30 / 10)),
          `${slow.total} vs ${Math.trunc(slow.d / 2)},`
          + ` ${fast.total} vs ${Math.trunc(fast.d / 3)}`);
    check("...so the knocked-down one gets there in fewer frames",
          fast.total < slow.total, `${fast.total} vs ${slow.total}`);
  }

  // **The Kill button.** `ActorKillAll` sets `dead` and `ActorFlag.Dead`, and
  // class 0x31's death chain is entered by `ThrowerOnShot` reading
  // `pendingHit` — which nothing was writing. So the button left a thrower
  // flagged dead and still pouncing at you, while the gate, which was counting
  // the renderer's instances rather than `g_enemies_alive`, opened anyway.
  {
    const rng = new Rng(9);
    const events = new Events();
    const z = thrower(ThrowerState.StandAndDecide);
    T.coli = { files: ["test"], blobs: { floor: FLOOR_BLOB } };
    G.g_coli_full_set = ["floor"];
    const before = G.g_enemies_alive;
    check("one thrower is one enemy alive", before === 1, `${before}`);

    ActorKillAll(0, rng);
    check("the kill leaves the hit its death chain reads",
          z.dead && z.pendingHit !== null,
          `dead ${z.dead} hit ${JSON.stringify(z.pendingHit)}`);
    // `ThrowerReleaseSlotOnDeath` (`FUN_0044D050`) runs on the first frame of
    // the fall, not when the body settles: the room clears when you land the
    // shot.
    GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
    check("...and it leaves `g_enemies_alive` on the first frame of the fall",
          G.g_enemies_alive === 0 && z.state === ThrowerState.FallAndLand,
          `alive ${G.g_enemies_alive} state ${z.state}`);

    // It must not leave twice, however many of the four fall states run.
    for (let i = 0; i < 600; i++) GameUpdate(EYE, 1 / 60, CAM_HOST, rng, events);
    check("and only once, whatever the rest of the fall does",
          G.g_enemies_alive === 0, `alive ${G.g_enemies_alive}`);
  }
}

// -- the class table, and who fills it --------------------------------------

console.log("\n`g_class_handlers`, filled by the classes themselves:");
{
  // The table is empty at `registry.ts`'s own evaluation and each class module
  // writes its own row. That is only true if the modules have been evaluated,
  // and the one thing that guarantees they have is `director.ts`'s side-effect
  // import of `game/classes.ts` -- which this file gets by importing
  // `ActorSpawn`. A missing import here is seven classes with no behaviour and
  // nothing at all saying so, which is exactly the failure the old ESM cycle
  // produced three times.
  const want: [SpawnClass, string][] = [
    [SpawnClass.Civilian, "0x10 civilian"],
    [SpawnClass.Frog, "0x11 frog"],
    [SpawnClass.Boss4, "0x19 stage-4 boss"],
    [SpawnClass.Boss2, "0x14 stage-2 boss"],
    [SpawnClass.OneHitTarget, "0x20 one-hit target"],
    [SpawnClass.RankScaledEnemy, "0x21 rescue target"],
    [SpawnClass.SetPieceProp, "0x24 set piece"],
    [SpawnClass.ScriptedHumanoid, "0x25 scripted humanoid"],
    [SpawnClass.Zombie, "0x30 zombie"],
    [SpawnClass.Thrower, "0x31 thrower"],
    [SpawnClass.ScriptedScenery, "0x33 scripted scenery / the carrier"],
    [SpawnClass.PropContainerPlacer, "0x41 prop container placer"],
    [SpawnClass.FlyingEnemy, "0x43 owl"],
    [SpawnClass.PropPlacer, "0x44 prop placer"],
    [SpawnClass.WaterEnemy, "0x51 fish"],
    [SpawnClass.Mouse, "0x52 mouse / branch trigger"],
    [SpawnClass.SkinnedNpc, "0x53 cat / branch trigger"],
    [SpawnClass.ChapterCard, "0x60 chapter card"],
    [SpawnClass.ResultCard, "0x61 result card"],
  ];
  for (const [cls, name] of want) {
    check(`${name} registered itself`,
          typeof g_class_handlers[cls]?.update === "function",
          `handler ${JSON.stringify(g_class_handlers[cls] ?? null)}`);
  }
  check("...and `PORTED_CLASSES` is exactly those and nothing else",
        PORTED_CLASSES.length === want.length
        && want.every(([c]) => PORTED_CLASSES.includes(c)),
        PORTED_CLASSES.map((c) => `0x${c.toString(16)}`).join(","));
  // The cat is 0x53 and now has one -- its sub-type 2 is a route-branch
  // trigger. Class 0x40, the horde, still has none: an unported class must
  // stay absent rather than fall back to anything, because an `if` is what had
  // the cat running the zombie's state machine.
  check("a class with no module has no row",
        g_class_handlers[0x40 as SpawnClass] === undefined);

  // Loud, not last-one-wins. A row silently overwritten by a second module is
  // a class whose behaviour depends on evaluation order.
  let threw = "";
  try {
    registerClass(SpawnClass.Zombie, { init: () => undefined,
                                       update: () => undefined });
  } catch (e) {
    threw = String(e);
  }
  check("registering a class twice throws", threw.includes("twice"), threw);
  check("...and the first registration is untouched",
        g_class_handlers[SpawnClass.Zombie]?.debug !== undefined);
}

// -- the sweep asks the class -----------------------------------------------

console.log("\n`ActorDeadSweep`, and what each class gives back:");
{
  const rng = new Rng(3);
  scene(0, rng);

  // Class 0x30. The permit on every reason; the counts on death and despawn
  // and never on a frame the renderer simply has not drawn.
  const z = spawnZombie(0x2000, 1, "zombie");
  z.visible = true;
  z.hp = 10;
  check("one zombie is one enemy alive and present",
        G.g_enemies_alive === 1 && G.g_enemies_present === 1,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);
  check("...and it takes a permit", TryClaimAttackSlot(z, NULL_HOST));

  ActorDeadSweep(z, DeadSweep.Unloaded);
  check("an undrawn zombie gives the permit back",
        z.attackPermit === -1 && G.g_attack_permits[0] === -1);
  check("...and keeps both counts, because it is not dead",
        G.g_enemies_alive === 1 && G.g_enemies_present === 1,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);

  // **A dead zombie keeps both counts here**, the same as a dead thrower
  // below. Class 0x30's death is four states and they retire from the counts
  // where the exe does -- `ZombieReleasePermitAndUntrack` (`FUN_004565A0`)
  // drops the alive count as state 6 opens, `ZombieEnterCorpseState`
  // (`FUN_00456740`) the present count when the death clip ends. The sweep
  // used to retire both on this reason, which collapsed the one window
  // `wait_enemies_present` and `wait_enemies_alive` exist to tell apart.
  ActorDeadSweep(z, DeadSweep.Dead);
  check("a dead zombie gives the permit back",
        z.attackPermit === -1 && G.g_attack_permits[0] === -1);
  check("...and keeps both counts: its own death states retire them",
        G.g_enemies_alive === 1 && G.g_enemies_present === 1,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);
  ActorDeadSweep(z, DeadSweep.Despawned);
  check("a despawned one leaves both",
        G.g_enemies_alive === 0 && G.g_enemies_present === 0,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);
  ActorDeadSweep(z, DeadSweep.Despawned);
  check("...and the latches make a second sweep free",
        G.g_enemies_alive === 0 && G.g_enemies_present === 0,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);
}
{
  const rng = new Rng(3);
  scene(0, rng);

  // Class 0x31 disagrees about both facts, which is why the sweep asks. Its
  // death is four states and it retires from the counts where the exe does, so
  // a dead thrower is still *present*.
  const w = ActorSpawn(0x2100, SpawnClass.Thrower, 0x35, "thrower");
  w.visible = true;
  w.hp = 10;
  check("one thrower is one enemy alive and present",
        G.g_enemies_alive === 1 && G.g_enemies_present === 1,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);
  check("...and it takes a permit in its own bit",
        ThrowerTryClaimAttackSlot(w, NULL_HOST) && w.attackPermit >= 0);

  ActorDeadSweep(w, DeadSweep.Dead);
  check("a dead thrower gives the permit back",
        w.attackPermit === -1 && G.g_attack_permits[0] === -1);
  check("...and stays present and alive: its own death states do that",
        G.g_enemies_alive === 1 && G.g_enemies_present === 1,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);

  ActorDeadSweep(w, DeadSweep.Despawned);
  check("a despawned one leaves both, in `obj+0x136C`'s latches",
        G.g_enemies_alive === 0 && G.g_enemies_present === 0,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);
}
{
  const rng = new Rng(3);
  scene(0, rng);

  // The generic enemy release in `despawn.ts` — the fallback for a class with
  // no `onDeadSweep`. It used to be exercised through class 0x51 and then
  // through 0x43; **every class in `ENEMY_CLASSES` now has a module**, and
  // every one of those modules has the hook, so the fallback's enemy branch is
  // no longer reachable from a ported class. That is the assertion now: if a
  // future enemy class is added to the set without a hook, this fails and says
  // so, which is the thing the old stand-in was really guarding.
  for (const cls of ENEMY_CLASSES) {
    check(`0x${cls.toString(16)} is an enemy and answers for its own teardown`,
          typeof g_class_handlers[cls as SpawnClass]?.onDeadSweep === "function",
          `${SpawnClass[cls as SpawnClass]}`);
  }

  // ...and a non-enemy is not counted either way.
  const c = ActorSpawn(0x2300, SpawnClass.ScriptedHumanoid, 0, "humanoid");
  ActorDeadSweep(c, DeadSweep.Dead);
  check("a non-enemy leaves the counters alone",
        G.g_enemies_alive === 0 && G.g_enemies_present === 0,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);
}

// -- 12. the shot queue: input in, decisions in the port ---------------------

/**
 * **The whole of a shot, with no renderer anywhere near it.**
 *
 * Until step 21 every line below ran in `render/shooting.ts` behind a
 * `pointerdown` handler: the score, the head combo, `MarkActorShot`,
 * `BreakablePropTakeShot` and `ResolveHit` itself. None of it could be
 * asserted here, and the head combo had a second private copy that no snapshot
 * carried. Now a click is *input* — a segment on `g_shot_requests` — and
 * `ProcessShotRequests` drains it at the head of `GameUpdate`, which is what
 * makes this section possible at all.
 *
 * The host is the only stub: the hit spheres ride bones a skeleton poses, so
 * `pickShot` is answered by the renderer in the player and by three lines here.
 */
console.log("\nthe shot queue:");
{
  const rng = new Rng(21);
  const events = scene(3, rng);
  // Bone 1 -- the torso, the one bone in the fixture with a `Last` effect row
  // -- stands in for the head, so a "headshot" lands on a real table entry and
  // the score is the only thing under test.
  SetGameTables({
    ...CHARS, types: { "1": { ...TYPE, head_bone: 1 } },
  } as unknown as CharactersJson);
  for (const o of G.g_object_list) o.hp = 100;
  const [z0, z1, z2] = G.g_object_list;

  let pick: ShotPick | null = null;
  const host = { ...NULL_HOST, pickShot: () => pick };
  const RAY = { origin: vec3(0, 0, 0), dir: vec3(0, 0, 1) };
  const seen: { kind: string; points: number }[] = [];
  events.on("shot.resolved", (r) => seen.push({ kind: r.kind, points: r.points }));
  // Every `PlaySoundId` the frame makes, in order. The gunshot is the reason
  // this is here: it was the one sound in the whole shot path that nothing
  // emitted, so the page fired silently and every other noise -- the flesh
  // impact, the ricochet, the surface -- played over the top of nothing.
  const heard: number[] = [];
  events.on("sound.play", (e) => heard.push(e.id));

  // A miss.
  pick = null;
  QueueShotRequest(0, RAY);
  check("a trigger pull waits on the queue", G.g_shot_requests.length === 1);
  check("...and carries the frame it was pulled on",
        G.g_shot_requests[0].frame === Math.round(G.g_frame),
        `${G.g_shot_requests[0].frame} vs ${G.g_frame}`);
  GameUpdate(EYE, 1 / 60, host, rng, events);
  check("the frame drains it", G.g_shot_requests.length === 0);
  check("a miss scores nothing", G.g_player_score[0] === 0
        && seen.at(-1)?.kind === "miss");
  check("but it is still a shot fired", G.g_nPlayerFired[0] === 1);
  // `PlayerFireAndReloadUpdate` (`FUN_00414940`) plays the gunshot at the
  // trigger, not at the hit, so a shot into nothing is as loud as one that
  // lands. It is the FIRST sound of the frame because the engine's order is
  // `BuildShotRay`, `PlayerShotEffectSpawn`, `PlaySoundId`, and everything the
  // round meets is decided after that.
  check("a miss still fires the gun", heard[0] === 0x003416a9,
        heard.map((h) => h.toString(16)).join(" "));

  // Two headshots, then a body shot.
  pick = { kind: "actor", at: z0.at, bone: 1, point: vec3() };
  QueueShotRequest(0, RAY);
  GameUpdate(EYE, 1 / 60, host, rng, events);
  check("a headshot pays 120", G.g_player_score[0] === 120,
        `${G.g_player_score[0]}`);
  check("...and arms `g_head_combo_bonus`, which is the engine's own global",
        G.g_head_combo_bonus[0] === 10, `${G.g_head_combo_bonus[0]}`);

  pick = { kind: "actor", at: z1.at, bone: 1, point: vec3() };
  QueueShotRequest(0, RAY);
  GameUpdate(EYE, 1 / 60, host, rng, events);
  check("the second consecutive headshot pays 130",
        G.g_player_score[0] === 250, `${G.g_player_score[0]}`);

  pick = { kind: "actor", at: z2.at, bone: 4, point: vec3() };
  QueueShotRequest(0, RAY);
  GameUpdate(EYE, 1 / 60, host, rng, events);
  check("a hit that is not on the head pays ten and clears the combo",
        G.g_player_score[0] === 260 && G.g_head_combo_bonus[0] === 0,
        `${G.g_player_score[0]} / ${G.g_head_combo_bonus[0]}`);
  check("and the hit reached `ResolveHit` -- hit points came off",
        z2.hp === 97, `hp ${z2.hp}`);

  // The gun, on a shot that lands. `g_gunshot_sound_ids` (0x004EC8BC) is two
  // entries and the players do not share one: 0x003416A9 is
  // `COMMON\GUN5_22.WAV` and 0x003316A9 is `COMMON\GUN4_22.WAV`.
  {
    heard.length = 0;
    pick = { kind: "actor", at: z2.at, bone: 4, point: vec3() };
    QueueShotRequest(0, RAY);
    GameUpdate(EYE, 1 / 60, host, rng, events);
    check("a hit fires the gun too, and before whatever the round met",
          heard[0] === g_gunshot_sound_ids[0],
          heard.map((h) => h.toString(16)).join(" "));
    heard.length = 0;
    QueueShotRequest(1, RAY);
    GameUpdate(EYE, 1 / 60, host, rng, events);
    check("...and player 1 carries the other gun, not a copy of player 0's",
          heard[0] === g_gunshot_sound_ids[1]
          && g_gunshot_sound_ids[0] !== g_gunshot_sound_ids[1],
          heard.map((h) => h.toString(16)).join(" "));
    check("the two ids are the exe's own `a9163400 a9163300`",
          g_gunshot_sound_ids[0] === 0x003416a9
          && g_gunshot_sound_ids[1] === 0x003316a9,
          g_gunshot_sound_ids.map((h) => h.toString(16)).join(" "));
    // Both are namespace 0 -- SE -- which is what routes them to `/se/` rather
    // than to the BGM element. A gunshot that came out as a BGM id would stop
    // the music and loop for ever.
    check("...and both are SE ids, not music",
          g_gunshot_sound_ids.every((id) => id >>> 28 === 0));
    heard.length = 0;
  }

  // Two pulls between frames both land, in the order they were made.
  const before = G.g_player_score[0];
  pick = { kind: "actor", at: z2.at, bone: 4, point: vec3() };
  QueueShotRequest(0, RAY);
  QueueShotRequest(0, RAY);
  check("two pulls before the next frame both queue",
        G.g_shot_requests.length === 2);
  GameUpdate(EYE, 1 / 60, host, rng, events);
  check("...and both resolve on it", G.g_player_score[0] === before + 20
        && G.g_shot_requests.length === 0, `${G.g_player_score[0]}`);

  // A class that scores its own shot is only marked.
  {
    const civ = ActorSpawn(0x4100, SpawnClass.Civilian, 1, "hostage");
    civ.visible = true;
    const score = G.g_player_score[0];
    const hp = civ.hp;
    pick = { kind: "actor", at: civ.at, bone: 0, point: vec3() };
    QueueShotRequest(0, RAY);
    GameUpdate(EYE, 1 / 60, host, rng, events);
    // The mark is consumed on the same frame: `CivilianCheckShot` reads
    // `obj+0x34` bit 3 in her own update, which runs after the queue drains.
    // What is under test is that the shot never reached `ResolveHit` -- no
    // damage, no hit table, no gore, exactly as `ShotTestSphere` has it for an
    // actor without the skeleton bit.
    check("a civilian is marked, not resolved",
          seen.at(-1)?.kind === "marked" && civ.hp === hp,
          `${seen.at(-1)?.kind} hp ${civ.hp} vs ${hp}`);
    check("...and the shot itself is worth nothing -- her class charges it",
          G.g_player_score[0] === score, `${G.g_player_score[0]}`);
  }

  // The scene reset zeroes the queue: a seek must not fire a click from the
  // run it replaced.
  QueueShotRequest(0, RAY);
  ResetGameGlobals();
  check("a scene reset empties the queue", G.g_shot_requests.length === 0);
}

// -- 12a. a stopped clock resolves nothing ----------------------------------

/**
 * **A frame that owes no tick must not do part of one**, and resolving a shot
 * is a whole game-time job: it takes hit points off, pays a score, arms the
 * head combo and fills three effect rings that only `ShotEffectsTick` can
 * empty again.
 *
 * `GameSystem` is the port's frame, and `app/loop.ts` hands it a tick with
 * `frozen: true` and no time in it whenever the transport is stopped — paused,
 * free roam, or `?freeze=1`. It used to drain `g_shot_requests` on that tick
 * anyway, so a click made with the clock stopped landed a hit, killed the
 * actor, scored it and spawned effects that then hung on screen for ever,
 * because nothing was stepping them. That is the "shots still register when
 * paused" report.
 *
 * **Step mode is not this case and never was**, which is the whole reason the
 * fix costs no debug capability: stepping runs the port at full rate while the
 * *script* stands still, so its ticks carry time and take the live path below.
 * The two assertions are deliberately the same fixture one after the other.
 */
console.log("\nthe shot queue, with the clock stopped:");
{
  const rng = new Rng(22);
  const events = scene(1, rng);
  const [z] = G.g_object_list;
  z.hp = 100;

  // Down the camera's own -Z, which is forward: `MuzzlePointInView` refuses a
  // ray pointing away from the screen, and the muzzle flash below is only an
  // assertion about a stopped clock if the fixture can light it.
  const RAY = { origin: vec3(0, 0, 0), dir: vec3(0, 0, -1) };
  const pick: ShotPick = { kind: "actor", at: z.at, bone: 4, point: vec3() };
  const game = new GameSystem();
  game.backend = {
    boneWorld: () => false,
    setBoneSlot: () => undefined,
    pickShot: () => pick,
  };
  const scope = new Scope("test:stopped-clock");
  const view = new CameraFrame();
  // A camera at the origin looking down -Z. `CameraFrame` starts with both
  // matrices all zero, which makes every transform NaN and every effect the
  // shot would spawn refuse itself -- so the muzzle-flash assertion below
  // would pass on a fixture that could never light one.
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  view.take(I, I);
  const ctx: Context = {
    events, rng, walker: null, scope, session: scope.child("session"),
    view, stage: 1, frame: 0,
  };
  // `Loop.idle` and `pacer.ts`'s `STOPPED_TICK`, by value: wall time for the
  // layers that ride it, and no game time at all.
  const STOPPED: Tick = { dt: 0, frames: 0, wall: 1 / 60, frozen: true };
  // What `stepOneFrame` hands the port on a tick that owes one -- play mode,
  // and step mode, which is the case that must keep working.
  const LIVE: Tick = { dt: 1 / 60, frames: 1, wall: 1 / 60, frozen: false };

  QueueShotRequest(0, RAY);
  const frame = G.g_frame;
  game.update(ctx, STOPPED);
  check("a stopped clock leaves the pull on the queue",
        G.g_shot_requests.length === 1, `${G.g_shot_requests.length}`);
  check("...and takes no hit points off", z.hp === 100, `hp ${z.hp}`);
  check("...and pays nothing", G.g_player_score[0] === 0,
        `${G.g_player_score[0]}`);
  check("...and does not count a shot fired", (G.g_nPlayerFired[0] ?? 0) === 0,
        `${G.g_nPlayerFired[0]}`);
  check("...and leaves the muzzle flash unlit",
        G.g_shot_flash_ring.every((f) => !f.live));
  check("...and throws no tracer",
        G.g_shot_tracer_ring.every((t) => !t.live));
  check("...and does not move the frame counter", G.g_frame === frame,
        `${G.g_frame} vs ${frame}`);
  // The camera yaw is the one thing that *is* written on a stopped tick, and
  // deliberately: where the camera points is not a function of elapsed time,
  // and free roam turns it every frame with the transport stopped.
  check("...but it still takes the camera's yaw",
        G.g_camera_yaw_bams === ctx.view.yawBams);

  // Step mode, and the frame after an unpause: the same request, the same
  // fixture, a tick with time in it.
  game.update(ctx, LIVE);
  check("the first tick with time in it drains the queue",
        G.g_shot_requests.length === 0, `${G.g_shot_requests.length}`);
  check("...and the hit reaches `ResolveHit`", z.hp < 100, `hp ${z.hp}`);
  check("...and pays for it", G.g_player_score[0] > 0,
        `${G.g_player_score[0]}`);
  scope.dispose();
}

/**
 * `ActorRegisterCameraPoint` (`FUN_00409B70`): the tracked bone, lifted.
 *
 * This ran in `render/characters.ts`, which meant the Characters view toggle
 * froze the camera's idea of where every actor was — a view switch changing
 * game state, which is what `no-actor-writes-in-render` exists to catch.
 */
console.log("\nwhere the camera follows an actor:");
{
  const rng = new Rng(22);
  const events = scene(1, rng);
  const z = G.g_object_list[0];
  const host = {
    ...NULL_HOST,
    boneWorld: (_at: number, bone: number, out: Vec3) => {
      if (bone !== 1) return false;
      out.x = 10; out.y = 20; out.z = 30;
      return true;
    },
  };
  GameUpdate(EYE, 1 / 60, host, rng, events);
  check("the tracked bone becomes `obj+0x100`, raised by four",
        z.lookAt.x === 10 && z.lookAt.y === 24 && z.lookAt.z === 30,
        JSON.stringify(z.lookAt));

  const held = { ...z.lookAt };
  GameUpdate(EYE, 1 / 60, { ...NULL_HOST }, rng, events);
  check("a host with no pose leaves it where it was",
        z.lookAt.x === held.x && z.lookAt.y === held.y
        && z.lookAt.z === held.z, JSON.stringify(z.lookAt));
}


/**
 * The strike anchor, `obj+0x136C & 0x40000`, and the four things that hang off
 * it.
 *
 * `ZombieStateStrike` raises it when it captures `strikeStart`
 * (`00455b98 a900000400` / `00455ba5 0d00000400`) and **on the melee path
 * nothing ever clears it again**: the one `AND` in the program that does is in
 * `FUN_0045DA60` (`0045db39 25fffffbff`), which an ordinary zombie never
 * reaches. The port modelled it as a boolean, cleared it in three places, and
 * left it out of the two tests in `ZombieStateHoldAtRange` that read it -- one
 * misreading with four separate symptoms, which is what these assert.
 */
console.log("\nthe strike anchor and the cooldown it gates:");
{
  const rng = new Rng(41);
  const events = scene(0, rng);
  void events;
  const INNER = APPROACH.rings[0].inner;

  const zombie = (name: string, over: Partial<Actor> = {}): ZombieActor => {
    const z = spawnZombie(0x7900, 1, name);
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.attackState = 1;
    z.state = ZombieState.HoldAtRange;
    z.sub = 0;
    // `motion_row[condition][MotionRow.Walk]`, the clip the hub plays while an
    // actor waits its turn.
    z.motion = TYPE.motion_row["0"][MotionRow.Walk];
    z.pos = vec3(0, 0, 40);
    z.target = vec3(0, 0, 0);
    Object.assign(z, over);
    return z;
  };
  const clear = () => {
    ResetGameGlobals();
    SetGameTables(CHARS);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_players_in_play = 1;
  };

  // -- B1. the too-close retreat has an escape, and it is `flags2 & 0x40400`
  //
  // `0045577c  f7866c13000000040400   TEST dword ptr [ESI+0x136c], 0x40400`
  // and the `JNZ` at `00455786` jumps past the whole retreat. Without it a
  // zombie that finishes a swing inside the ring -- which is where a swing
  // ends, because the attack's own distance is inside it -- is bounced
  // straight back into `BackOff` on its first frame in the hub.
  {
    clear();
    const z = zombie("inside-the-ring, has swung",
                     { pos: vec3(0, 0, INNER - 5) });
    z.flags2 |= ZombieFlag2.StrikeAnchor;
    ZombieStateHoldAtRange(z, EYE, new Rng(1), NULL_HOST);
    check("an actor that has already swung is exempt from the too-close retreat",
          z.state !== ZombieState.BackOff, ZombieState[z.state] ?? String(z.state));
  }
  {
    clear();
    const z = zombie("inside-the-ring, mid entry clip",
                     { pos: vec3(0, 0, INNER - 5) });
    z.flags2 |= ZombieFlag2.EntryClipPlaying;
    ZombieStateHoldAtRange(z, EYE, new Rng(1), NULL_HOST);
    check("...and so is one still playing its authored entry clip",
          z.state !== ZombieState.BackOff, ZombieState[z.state] ?? String(z.state));
  }
  {
    clear();
    const z = zombie("inside-the-ring, never swung",
                     { pos: vec3(0, 0, INNER - 5) });
    ZombieStateHoldAtRange(z, EYE, new Rng(1), NULL_HOST);
    check("...but one carrying neither bit still backs off",
          z.state === ZombieState.BackOff, ZombieState[z.state] ?? String(z.state));
  }

  // -- B2. `ZombieStateBackOff` does not clear the anchor ------------------
  //
  // Its only `AND` on `obj+0x136C` is `00455cc0  81e1ffffbfff`, which clears
  // `0x400000` -- the turn flip -- and nothing else.
  {
    clear();
    const z = zombie("retreating", { state: ZombieState.BackOff });
    z.flags2 |= ZombieFlag2.StrikeAnchor;
    z.target = vec3(0, 0, 0);
    z.pos = vec3(0, 0, INNER + 15);
    ZombieStateBackOff(z, EYE, 1 / 60, new Rng(2));
    check("the retreat hands back to the hub", z.state === ZombieState.HoldAtRange,
          ZombieState[z.state] ?? String(z.state));
    check("...and leaves the strike anchor standing",
          (z.flags2 & ZombieFlag2.StrikeAnchor) !== 0,
          `0x${z.flags2.toString(16)}`);
  }

  // -- B3. the cooldown countdown: its gate, its latch, and its fallthrough -
  //
  // `004557dc a801` arms it, `004557e0 f7866c13000000000400` gates it on the
  // anchor, `004557f2 4a` is the one decrement and `004557ff 24fe` disarms the
  // latch when it runs out. There is no `RET` on that path: the exe falls
  // through to the idle and the turn at the bottom of the state.
  {
    clear();
    const z = zombie("cooling, never swung", { cooldown: 10 });
    z.zom.hasCooldown = true;
    ZombieStateHoldAtRange(z, EYE, new Rng(3), NULL_HOST);
    check("a cooldown does not run down for an actor that has never swung",
          z.cooldown === 10, String(z.cooldown));
  }
  {
    clear();
    const z = zombie("cooling", { cooldown: 2 });
    z.zom.hasCooldown = true;
    z.flags2 |= ZombieFlag2.StrikeAnchor;
    ZombieStateHoldAtRange(z, EYE, new Rng(3), NULL_HOST);
    check("...and does for one that has", z.cooldown === 1, String(z.cooldown));
    check("...with the latch still armed at one", z.zom.hasCooldown,
          String(z.zom.hasCooldown));
    ZombieStateHoldAtRange(z, EYE, new Rng(3), NULL_HOST);
    check("...and the latch disarms itself as the counter runs out",
          z.cooldown === 0 && !z.zom.hasCooldown, `${z.cooldown}/${z.zom.hasCooldown}`);
  }
  {
    clear();
    const z = zombie("cooling and idling", { cooldown: 30, motion: 12 });
    z.zom.hasCooldown = true;
    z.flags2 |= ZombieFlag2.StrikeAnchor;
    z.yaw = 0x4000;
    ZombieStateHoldAtRange(z, EYE, new Rng(3), NULL_HOST);
    check("a cooling zombie still plays the row's idle", z.motion === 10,
          String(z.motion));
    check("...and still turns to face you", z.yaw !== 0x4000,
          `0x${z.yaw.toString(16)}`);
  }
  {
    clear();
    const z = zombie("retreating with a cooldown",
                     { state: ZombieState.BackOff, cooldown: 50,
                       pos: vec3(0, 0, INNER + 15) });
    z.zom.hasCooldown = true;
    z.flags2 |= ZombieFlag2.StrikeAnchor;
    ZombieStateBackOff(z, EYE, 1 / 60, new Rng(2));
    check("the retreat leaves an armed cooldown alone",
          z.state === ZombieState.HoldAtRange && z.cooldown === 50,
          `${z.state}/${z.cooldown}`);
  }
  {
    clear();
    const z = zombie("retreating without one",
                     { state: ZombieState.BackOff, cooldown: 50,
                       pos: vec3(0, 0, INNER + 15) });
    ZombieStateBackOff(z, EYE, 1 / 60, new Rng(2));
    check("...and zeroes an unarmed one, as `00455d9f` does", z.cooldown === 0,
          String(z.cooldown));
  }

  // -- B4. a camera-cued attacker strikes from where it stands -------------
  //
  // `00455b24  f6866813000001` -- the lunge is skipped outright while the
  // cooldown latch is armed, so state 19's four spawns swing at whatever range
  // the cue left them at instead of walking in first.
  {
    clear();
    const atk = TYPE.attacks["0"]["1"];
    const z = zombie("cued attacker",
                     { state: ZombieState.Strike, sub: StrikeSub.Lunge,
                       attack: 1, pos: vec3(0, 0, atk.distance + 20) });
    z.zom.hasCooldown = true;
    // The end of the attack cry: `ZombieStateStrike` (`FUN_00455A40`) calls
    // `ActorPlayHitVoice(obj, 3)` at `0x00455B8A`, on the frame the strike
    // clip is set. The routine itself is checked above; this is the wiring,
    // and it is the half that was missing -- the port had the routine for the
    // shot voices and nothing anywhere raised kind 3.
    const cried: number[] = [];
    const bus = new Events();
    bus.on("sound.play", (d) => cried.push(d.id));
    // This fixture's `CHARS.combat` is undefined, and `ActorPlayHitVoice`
    // reads the table off it -- so without this the check would pass on a
    // silent build and fail on a working one. Put a table in for the call.
    const noCombat = T.chars;
    SetGameTables({
      ...CHARS,
      combat: {
        impact: [], head_impact: [],
        voice: { hurt: [], kill: [], head: [],
                 attack: [[{ id: 40, file: "" }], [{ id: 50, file: "" }]] },
        voice_set_a_types: [], ricochet: {},
      },
    } as unknown as CharactersJson);
    ZombieStateStrike(z, EYE, new Rng(4), bus);
    check("a cooldown-armed attacker starts the swing where it stands",
          z.sub === StrikeSub.Swinging && z.action?.motion === atk.strike,
          `${z.sub}/${z.action?.motion}`);
    check("...and cries out as the swing starts",
          cried.length === 1, `${cried.length} sounds: ${cried.join(",")}`);
    if (noCombat) SetGameTables(noCombat);
  }
  {
    clear();
    const atk = TYPE.attacks["0"]["1"];
    const z = zombie("ordinary attacker",
                     { state: ZombieState.Strike, sub: StrikeSub.Lunge,
                       attack: 1, pos: vec3(0, 0, atk.distance + 20) });
    ZombieStateStrike(z, EYE, new Rng(4));
    check("...and one without the latch still lunges in",
          z.sub === StrikeSub.Lunge && z.action?.motion === atk.lunge,
          `${z.sub}/${z.action?.motion}`);
  }

  // -- B5. the retreat's third exit ----------------------------------------
  //
  // `00455d57 83be0c13000004` then `00455d67 d80df4445600`, whose operand at
  // 0x005644f4 is `3333333f` = 0.7: a body-condition-4 actor -- both arms gone
  // -- leaves the retreat at 70% of the inner radius.
  {
    clear();
    const z = zombie("armless, retreating",
                     { state: ZombieState.BackOff, condition: 4,
                       pos: vec3(0, 0, INNER * 0.8) });
    ZombieStateBackOff(z, EYE, 1 / 60, new Rng(2));
    check("condition 4 leaves the retreat at 0.7 of the ring",
          z.state === ZombieState.HoldAtRange,
          ZombieState[z.state] ?? String(z.state));
  }
  {
    clear();
    const z = zombie("whole, retreating",
                     { state: ZombieState.BackOff, condition: 0,
                       pos: vec3(0, 0, INNER * 0.8) });
    ZombieStateBackOff(z, EYE, 1 / 60, new Rng(2));
    check("...and every other condition has to reach the ring itself",
          z.state === ZombieState.BackOff,
          ZombieState[z.state] ?? String(z.state));
  }

  // -- B6. the entry clip refuses the claim, and clears itself -------------
  //
  // `00455815 f6c404` is the refusal; `00455904 80e4fb` is the clear, two
  // frames from the end of the clip on the play clock.
  {
    clear();
    const z = zombie("mid entry clip");
    z.flags2 |= ZombieFlag2.EntryClipPlaying;
    check("an actor still playing its entry clip may not claim",
          ZombieAttackRefusal(z) !== null, String(ZombieAttackRefusal(z)));
    z.playTicks = MotionPlayLength(z, z.motion) - 2;
    ZombieStateHoldAtRange(z, EYE, new Rng(5), NULL_HOST);
    check("...and the hub clears the bit two frames from the end of it",
          (z.flags2 & ZombieFlag2.EntryClipPlaying) === 0,
          `0x${z.flags2.toString(16)}`);
  }

  // -- B7. the retreat's clock is an integer -------------------------------
  //
  // `00455d29`/`00455d32`: `MOV ECX,[ESI+0x1334]; INC ECX` -- one increment
  // per **update**, and `00455d3b 3df0000000` compares the result against
  // 0xF0. The port accumulated `dt * 60` instead, which is the same number
  // only while the frame is exactly 1/60 of a second; the step given here is
  // deliberately not, because that is the only thing that can tell an integer
  // counter apart from an accumulator.
  {
    clear();
    const z = zombie("counting", { state: ZombieState.BackOff,
                                   pos: vec3(0, 0, 5) });
    for (let i = 0; i < 7; i++) ZombieStateBackOff(z, EYE, 1 / 50, new Rng(2));
    check("`backoffFrames` counts updates, not seconds", z.zom.backoffFrames === 7,
          String(z.zom.backoffFrames));
  }
}
/**
 * B25. The lift is `ActorRegisterCameraPoint`'s **float argument**, pushed by
 * whichever class's `Update` calls it, and the three ported classes that call
 * it do not agree: `PUSH 0x40800000` (`6800008040`) at `EnemyZombieUpdate`
 * 0x00453475 and `CivilianUpdate` 0x0048ADAB, `PUSH 0x0` (`6a00`) at
 * `EnemyThrowerUpdate` 0x0044998F.
 *
 * The port applied 4.0 to all of them and said so in a `[diverges]`. This is
 * the assertion that closes it: it fails on the old code, where a thrower's
 * `lookAt.y` came out at 24.
 */
console.log("\nthe camera-point lift is per class:");
{
  const rng = new Rng(23);
  const events = scene(1, rng);
  const zombie = G.g_object_list[0];
  const thrower = ActorSpawn(0x2000, SpawnClass.Thrower, 0x16, "thrower");
  thrower.visible = true;
  thrower.hp = 10;
  thrower.pos = vec3(0, 0, 60);
  const prop = ActorSpawn(0x2001, SpawnClass.SetPieceProp, 1, "prop");
  prop.visible = true;
  const host = {
    ...NULL_HOST,
    boneWorld: (_at: number, bone: number, out: Vec3) => {
      if (bone !== 1) return false;
      out.x = 10; out.y = 20; out.z = 30;
      return true;
    },
  };
  GameUpdate(EYE, 1 / 60, host, rng, events);
  check("class 0x30 lifts by 4.0", zombie.lookAt.y === 24,
        String(zombie.lookAt.y));
  check("class 0x31 lifts by 0.0 -- `PUSH 0x0` at 0x0044998F",
        thrower.lookAt.y === 20, String(thrower.lookAt.y));
  check("a class the exe never registers gets no lift", prop.lookAt.y === 20,
        String(prop.lookAt.y));
  check("`CameraPointRiseFor` is the table, not a constant",
        CameraPointRiseFor(SpawnClass.Civilian) === 4
        && CameraPointRiseFor(SpawnClass.Zombie) === 4
        && CameraPointRiseFor(SpawnClass.Thrower) === 0
        && CameraPointRiseFor(SpawnClass.ScriptedHumanoid) === 0);
}

/**
 * B27. `ColiTestSphereAgainstActors` (`FUN_00405B10`) fills a zero body radius
 * in from the shot radius and **stores it back**:
 * `MOV EAX, [EBX + 0x124]; MOV [EBX + 0x128], EAX` at 0x00405BB1/0x00405BB7.
 * A class that never sets `obj+0x128` still takes part in the crowd push.
 */
console.log("\nthe engine's body-radius fallback:");
{
  const rng = new Rng(24);
  scene(0, rng);
  const other = spawnZombie(0x3000, 1, "no body radius");
  other.visible = true;
  other.pos = vec3(0, 0, 0);
  other.radius = 6;
  other.bodyRadius = 0;
  const self = spawnZombie(0x3001, 1, "pusher");
  self.visible = true;
  self.pos = vec3(2, 0, 0);

  // `ActorUpdateBoundingSphere` puts the other actor's centre at
  // `y = bodyRadius + 1`, so the probe is level with it and two units aside:
  // inside `1 + 6` only if the fallback filled the radius in.
  const hit = ColiTestSphereAgainstActors(self, 2, 7, 0, 1);
  check("a zero body radius still collides -- it falls back to `obj+0x124`",
        hit, String(hit));
  check("...and the fallback is stored back onto the actor",
        other.bodyRadius === 6, String(other.bodyRadius));
}

/**
 * B24. `CivilianUpdate`'s tail at `LAB_0048B0CE`: once the civilian carries
 * `obj+0x34` bit `0x4000000`, every surviving captor gets `obj+0x34` bit
 * `0x1000000` cleared and `obj+0x136C` bit `0x1` set, every frame.
 */
console.log("\na dead civilian releases its captors:");
{
  const rng = new Rng(25);
  const events = scene(0, rng);
  const civ = ActorSpawn(0x4000, SpawnClass.Civilian, 0x20, "civilian");
  civ.visible = true;
  civ.hp = 1;
  g_class_handlers[SpawnClass.Civilian]!.init(civ, rng);
  const captor = spawnZombie(0x4001, 1, "captor");
  captor.visible = true;
  captor.hp = 10;
  captor.flags |= ActorFlag.HoldingWeapon;
  civ.civ!.children = [captor.at];
  civ.civ!.childCount = 1;

  GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
  check("a living civilian holds its captors",
        (captor.flags & ActorFlag.HoldingWeapon) !== 0
        && (captor.flags2 & 1) === 0,
        `${captor.flags.toString(16)} / ${captor.flags2.toString(16)}`);

  civ.flags |= ActorFlag.Dead;
  GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
  check("a dead one clears `obj+0x34` bit 0x1000000 on each",
        (captor.flags & ActorFlag.HoldingWeapon) === 0,
        captor.flags.toString(16));
  check("...and sets `obj+0x136C` bit 0x1 on each",
        (captor.flags2 & 1) === 1, captor.flags2.toString(16));
}

// -- 15. class 0x30's own death chain ---------------------------------------

/**
 * The bug this section exists for: **a killed zombie never left the pool.**
 *
 * `ResolveHit` set `dead`, the director stopped updating the actor, and it
 * stood there for the rest of the stage still counted in `g_enemies_present`.
 * `tools/killall.mjs` showed three of them at `dead=true visible=true
 * state=18` nine hundred frames after the kill.
 *
 * Every assertion below fails without `class30/death.ts` and
 * `class30/on_shot.ts`: there was no edge into state 6, and no state 6.
 */
console.log("class 0x30, the death chain:");
{
  const rng = new Rng(11);
  const events = scene(1, rng);
  const z = G.g_object_list[0];
  z.hp = 1;
  const alive0 = G.g_enemies_alive;
  const present0 = G.g_enemies_present;
  check("one zombie, alive and present", alive0 === 1 && present0 === 1,
        `${alive0}/${present0}`);
  TryClaimAttackSlot(z, NULL_HOST);

  ResolveHit(z, 1, 0, NULL_HOST, rng);
  check("the killing shot leaves a hit record for `ZombieOnShot`",
        z.pendingHit !== null && z.dead);
  check("...and nothing has moved the actor into a state yet",
        z.state !== ZombieState.Death, `state ${z.state}`);

  // One update. `EnemyZombieUpdate` runs `ZombieOnShot` first, so state 6 is
  // entered and its subs 0, 1 and 2 all run on this frame -- the engine falls
  // through 0x00454D42 into 0x00454D49 and on into 0x00454D90.
  GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
  check("one update puts it in `ZombieState.Death`",
        z.state === ZombieState.Death, `state ${z.state}`);
  check("...at sub 2, because subs 0 and 1 are a fallthrough",
        z.sub === 2, `sub ${z.sub}`);
  check("...playing a death clip picked by `ChooseDeathMotion`",
        z.motion === 900 || z.motion === 901, `motion ${z.motion}`);
  check("...with `obj+0x34` bits 0x22000 raised",
        (z.flags & (ActorFlag.Airborne | ActorFlag.NoHitReaction))
          === (ActorFlag.Airborne | ActorFlag.NoHitReaction),
        z.flags.toString(16));
  check("...the permit and the latch given back",
        z.attackPermit === -1 && G.g_attack_committed === 0
        && G.g_attack_permits.every((x) => x === -1));
  check("...out of `g_enemies_alive`", G.g_enemies_alive === 0,
        `${G.g_enemies_alive}`);
  // The whole point of two counters: the body is on stage, so it is present.
  check("...but still present, because the corpse is not finished",
        G.g_enemies_present === 1, `${G.g_enemies_present}`);
  check("...and still in the pool",
        G.g_object_list.some((o) => o.at === z.at));

  // The death clip plays **exactly once**: state 6 leaves at
  // `g_motion_play_length[obj+0x1B4] - 1`, which for the fixture's 30-frame
  // clips is 58 ticks.
  const clipTicks = MotionPlayLength(z);
  let toCorpse = -1;
  for (let i = 0; i < 400 && toCorpse < 0; i++) {
    GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
    if (z.state === ZombieState.CorpseSink) toCorpse = i + 1;
  }
  check("the clip runs once and hands to `ZombieEnterCorpseState`",
        toCorpse > 0 && toCorpse <= clipTicks + 2,
        `after ${toCorpse} frames, clip ${clipTicks}`);
  check("...which is what drops `g_enemies_present`",
        G.g_enemies_present === 0, `${G.g_enemies_present}`);
  check("...and freezes the pose", (z.flags & ActorFlag.PoseFrozen) !== 0,
        z.flags.toString(16));
  check("...and takes the corpse out of both pushes",
        (z.flags2 & (ZombieFlag2.CollideWorld | ZombieFlag2.CollideActors))
          === 0, z.flags2.toString(16));

  // 0x78 frames of sinking, then `ActorDespawn`. **The engine's own timer, not
  // an invented one** -- `FUN_00454F20` writes `obj+0x1330 = 0x78` and counts
  // it down, and calls `ActorDespawn` itself at the end.
  const y0 = z.pos.y;
  let left = -1;
  for (let i = 0; i < 400 && left < 0; i++) {
    GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
    if (!G.g_object_list.some((o) => o.at === z.at)) left = i + 1;
  }
  check("the corpse sinks", z.pos.y < y0 - 1, `${y0} -> ${z.pos.y}`);
  check("...and leaves the pool after 0x78 frames",
        left >= 0x76 && left <= 0x7a, `after ${left} frames`);
  check("...taking both counts with it, once",
        G.g_enemies_alive === 0 && G.g_enemies_present === 0,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);
}

/**
 * **B5 — a fatal hit mid-swing must not wait for the swing to finish.**
 *
 * `ZombieStateStrike` (`FUN_00455A40`) plays the swing on the actor's
 * *ordinary* motion — `FUN_004119A0(obj+0x194, entry->strike, 0, 5)` at
 * 0x00455B8A, read back through `obj+0x1B4`/`obj+0x19C` — so when
 * `ChooseDeathMotion` (`FUN_004560B0`) writes the same track the swing is over
 * by construction. The port gives the swing a channel of its own so the poser
 * can hold it at full weight, and nothing was ending it: the actor finished
 * its bite and only then fell over.
 *
 * The fix is in `ActorSetMotionBlended` / `ActorSetMotion`, so this asserts
 * both the primitive and the whole death path through `GameUpdate`.
 */
console.log("class 0x30, a fatal hit lands *during* the swing:");
{
  const rng = new Rng(37);
  const events = scene(1, rng);
  const z = G.g_object_list[0] as ZombieActor;
  const atk = TYPE.attacks["0"]["1"];

  // Mid-swing: the state machine's own shape after `StrikeSub.Lunge`.
  z.state = ZombieState.Strike;
  z.sub = StrikeSub.Swinging;
  z.attack = 1;
  z.action = { motion: atk.strike, ticks: 4, loop: false };
  z.hp = 1;

  ActorSetMotionBlended(z, TYPE.motion_row["0"][MotionRow.BackAway], 0, 10);
  check("writing the motion track ends the one-shot on it",
        z.action === null, JSON.stringify(z.action));
  check("...fading out of the swing, not out of the base clip",
        z.fadeFrom?.motion === atk.strike && z.fadeFrom?.ticks === 4,
        JSON.stringify(z.fadeFrom));

  // ...and the whole path: shoot it dead while the swing runs.
  z.state = ZombieState.Strike;
  z.sub = StrikeSub.Swinging;
  z.action = { motion: atk.strike, ticks: 4, loop: false };
  ResolveHit(z, 1, 0, NULL_HOST, rng);
  check("the shot kills it mid-swing", z.dead && z.pendingHit !== null);
  GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
  check("one update takes it out of the swing and into `Death`",
        z.state === ZombieState.Death, `state ${z.state}`);
  check("...and the swing is gone, so the death clip is what is posed",
        z.action === null && (z.motion === 900 || z.motion === 901),
        `action ${JSON.stringify(z.action)} motion ${z.motion}`);
}

/**
 * **B12 — the stumble comes from the actor's own body-condition row.**
 *
 * `004544ec 8b8e0c130000` reads `obj+0x130C` and `0045450a 8b1c0b` indexes the
 * character's reaction table with it. The port read row `"0"` for every actor,
 * so the 21 character types with a second row at body condition 3 could never
 * reach it.
 */
console.log("class 0x30, the stumble is indexed by body condition:");
{
  const rng = new Rng(38);
  scene(0, rng);
  const z = spawnZombie(0x3400, 1, "stumbler");
  z.visible = true;
  z.hp = z.maxHp = 100;
  check("condition 0 takes row 0",
        ActorPlayHitReaction(z, 1, HitResultCode.Damaged)
          === TYPE.reactions["0"][1], String(z.react?.motion));
  z.condition = 3;
  check("...and condition 3 takes row 3, which row 0 never named",
        ActorPlayHitReaction(z, 1, HitResultCode.Damaged)
          === TYPE.reactions["3"][1], String(z.react?.motion));
  z.condition = 9;                       // a row the fixture does not carry
  check("...and a condition with no row of its own falls back to row 0",
        ActorPlayHitReaction(z, 1, HitResultCode.Damaged)
          === TYPE.reactions["0"][1], String(z.react?.motion));
}

console.log("class 0x30, the corpse that blinks:");
{
  const rng = new Rng(12);
  const events = scene(0, rng);
  // `ZombieEnterCorpseState` sends character types 0x12 and 3 to state 8.
  const z = spawnZombie(0x3000, 1, "blinker");
  z.visible = true;
  z.hp = 1;
  z.charType = 3;
  z.motion = 900;
  ZombieEnterCorpseState(z);
  check("character type 3 becomes a blinking corpse",
        z.state === ZombieState.CorpseBlink, `state ${z.state}`);
  z.charType = 1;
  z.state = ZombieState.Death;
  ZombieEnterCorpseState(z);
  check("...and every other type a sinking one",
        z.state === ZombieState.CorpseSink, `state ${z.state}`);

  z.charType = 3;
  z.state = ZombieState.CorpseBlink;
  z.sub = 0;
  const alpha: number[] = [];
  const y0 = z.pos.y;
  for (let i = 0; i < 4; i++) {
    GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
    alpha.push(z.alpha);
  }
  check("the blink is the countdown's parity, first frame visible",
        alpha[0] === 1 && alpha[1] === 0 && alpha[2] === 1 && alpha[3] === 0,
        JSON.stringify(alpha));
  check("...and it does not sink", z.pos.y === y0, `${y0} -> ${z.pos.y}`);
}

console.log("class 0x30, `ZombieOnShot`'s two refusals and its second death:");
{
  const rng = new Rng(13);
  scene(0, rng);

  // `TEST CH, 0x40` at 0x00453F88: a zombie shot in mid-leap keeps flying.
  const leaper = spawnZombie(0x3100, 1, "leaper");
  leaper.visible = true;
  leaper.state = ZombieState.DelayedLeap;
  leaper.flags2 |= ZombieFlag2.Leaping;
  leaper.dead = true;
  leaper.flags |= ActorFlag.Dead;
  leaper.pendingHit = { bone: 1, result: 1 };
  ZombieOnShot(leaper);
  check("a zombie shot mid-leap is not sent to a death state",
        leaper.state === ZombieState.DelayedLeap, `state ${leaper.state}`);
  check("...but the death is latched, so the next shot cannot re-enter",
        (leaper.flags2 & ZombieFlag2.DiedInFlight) !== 0,
        leaper.flags2.toString(16));

  // The once-only latch. A burst must not knock a corpse back to sub 0.
  const z = spawnZombie(0x3200, 1, "shot twice");
  z.visible = true;
  z.dead = true;
  z.flags |= ActorFlag.Dead;
  z.pendingHit = { bone: 1, result: 1 };
  ZombieOnShot(z);
  check("a killed zombie enters state 6", z.state === ZombieState.Death);
  z.sub = 2;
  z.pendingHit = { bone: 1, result: 1 };
  ZombieOnShot(z);
  check("...and a second shot does not restart it", z.sub === 2, `sub ${z.sub}`);

  // The carried arm. What is pinned here is the *near-target latch*, which is
  // state 9's own input and is `[proved]` at 0x00454006; where the arm leads
  // is the next block's.
  const carried = spawnZombie(0x3300, 1, "carried");
  carried.visible = true;
  carried.dead = true;
  carried.flags |= ActorFlag.Dead;
  carried.flags2 |= ZombieFlag2.Carried;
  carried.state = 0x1b;
  carried.pos = vec3(0, 0, 0);
  carried.arcTo = { x: 10, y: 0, z: 0 };
  carried.pendingHit = { bone: 1, result: 1 };
  ZombieOnShot(carried);
  check("a carried zombie shot within 18.0 of its arc target latches bit 0x8",
        (carried.flags2 & ZombieFlag2.ShotNearArcTarget) !== 0,
        carried.flags2.toString(16));

  const far = spawnZombie(0x3400, 1, "carried, far");
  far.visible = true;
  far.dead = true;
  far.flags |= ActorFlag.Dead;
  far.flags2 |= ZombieFlag2.Carried;
  far.state = 0x1b;
  far.pos = vec3(0, 0, 0);
  far.arcTo = { x: 30, y: 0, z: 0 };
  far.pendingHit = { bone: 1, result: 1 };
  ZombieOnShot(far);
  check("...and one further away than that does not",
        (far.flags2 & ZombieFlag2.ShotNearArcTarget) === 0,
        far.flags2.toString(16));
}

console.log("class 0x30 state 9: the body is thrown, not dropped:");
{
  // A camera at (0, 6, 0) looking down world +Z, in the engine's own view
  // convention: **-Z in front**, +Y up, and `viewPoint` its exact inverse.
  // `app/systems.ts` builds the real pair out of three.js's camera; this is
  // the smallest thing that is consistent with itself, which is all state 9
  // asks of the seam.
  const CAM = vec3(0, 6, 0);
  const camHost = {
    ...NULL_HOST,
    viewSpaceOf: (at: number, out: Vec3) => {
      const a = ActorByAt(at);
      if (!a) return false;
      out.x = a.lookAt.x - CAM.x;
      out.y = a.lookAt.y - CAM.y;
      out.z = -(a.lookAt.z - CAM.z);
      return true;
    },
    viewPoint: (x: number, y: number, z: number, out: Vec3) => {
      out.x = CAM.x + x;
      out.y = CAM.y + y;
      out.z = CAM.z - z;
    },
  };

  const shot = (condition: number) => {
    ResetGameGlobals();
    SetGameTables(CHARS);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_camera_fixed_eye_y = 0;
    const z = spawnZombie(0x3600, 1, "knocked back",
                         { condition });
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.motion = 10;
    z.pos = vec3(0, 0, 40);
    z.lookAt = vec3(0, 4, 40);
    return z;
  };
  const kill = (z: Actor) => {
    z.hp = 0;
    z.dead = true;
    z.flags |= ActorFlag.Dead;
    z.pendingHit = { bone: 1, result: 1 };
  };

  // 1. **The state.** `ZombieOnShot` (`FUN_00453EB0`) writes 9, not 6, for
  //    body conditions 5 and 6 — 44 shipped spawns carry one of them.
  {
    const rng = new Rng(21);
    const events = new Events();
    const z = shot(5);
    TryClaimAttackSlot(z, camHost);
    kill(z);
    GameUpdate(EYE, 1 / 60, camHost, rng, events);
    check("body condition 5 dies through state 9, not state 6",
          z.state === ZombieState.DeathKnockbackArc, `state ${z.state}`);
    check("...and takes the same clip `ChooseDeathMotion` gives state 6",
          z.motion === 0x3db, `motion ${z.motion}`);
    // Sub 0 runs `ZombieReleasePermitAndUntrack` on the frame the state opens,
    // exactly as state 6's does, and the present count waits for the corpse.
    check("...giving the permit back and leaving `alive` on the same frame",
          z.attackPermit === -1 && G.g_attack_permits.every((p) => p === -1)
          && G.g_enemies_alive === 0, `alive ${G.g_enemies_alive}`);
    check("...but staying *present* until the corpse state",
          G.g_enemies_present === 1, `present ${G.g_enemies_present}`);
  }

  // 2. **The throw.** Sub 1 rides the shared arc record — `ActorArcVelocityY`
  //    (`FUN_0044DDE0`) sets the velocity, `EnemyZombieUpdate` integrates it —
  //    to a landing point built in the camera's own matrix. The body must end
  //    up somewhere else.
  {
    const rng = new Rng(22);
    const events = new Events();
    const z = shot(5);
    kill(z);
    let far = 0;
    for (let f = 0; f < 60; f++) {
      GameUpdate(EYE, 1 / 60, camHost, rng, events);
      far = Math.max(far, dist2d(z.pos, vec3(0, 0, 40)));
      if (z.state !== ZombieState.DeathKnockbackArc) break;
    }
    // Condition 5's depth offset is -7.0 at scale 1.0, so the landing point is
    // seven units further from the camera than the body's tracked point.
    check("the arc carries the body away from where it stood", far > 5,
          `moved ${far.toFixed(2)} units`);
    check("...along the camera's own -Z, which is away from the viewer",
          z.pos.z > 44, `z ${z.pos.z.toFixed(2)}`);
    check("...and it is the shared arc record that carried it",
          z.arcTotal >= 0 && Math.abs(z.arcTo.z - 47) < 2.5,
          `arcTo.z ${z.arcTo.z.toFixed(2)}`);
  }

  // 3. **The terminus.** Same corpse, same order: `alive` at the state's own
  //    opening, `present` at `ZombieEnterCorpseState`, then the pool.
  {
    const rng = new Rng(23);
    const events = new Events();
    const z = shot(6);
    kill(z);
    let sawCorpse = -1, presentAtCorpse = -1, sawArc = false, restedAt = 0;
    for (let f = 0; f < 900; f++) {
      GameUpdate(EYE, 1 / 60, camHost, rng, events);
      if (z.state === ZombieState.DeathKnockbackArc) sawArc = true;
      if (sawCorpse < 0 && (z.state === ZombieState.CorpseSink
                         || z.state === ZombieState.CorpseBlink)) {
        sawCorpse = f;
        presentAtCorpse = G.g_enemies_present;
        restedAt = dist2d(z.pos, vec3(0, 0, 40));
      }
    }
    check("condition 6 reaches the corpse state through the arc",
          sawArc && sawCorpse > 0,
          `arc ${sawArc} state ${z.state} sub ${z.sub}`);
    check("...and the corpse lies where it was thrown, not where it stood",
          restedAt > 5, `${restedAt.toFixed(2)} units from the spot`);
    check("...and `present` falls there, one clip after `alive`",
          presentAtCorpse === 0, `present ${presentAtCorpse}`);
    check("...and the corpse leaves the pool",
          !G.g_object_list.some((o) => o.at === 0x3600),
          `${G.g_object_list.length} left`);
    check("...with both counters back at zero",
          G.g_enemies_alive === 0 && G.g_enemies_present === 0,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
  }

  // The control. A condition the arc does not claim still dies where it
  // stands, which is what every one of the 44 used to do.
  {
    const rng = new Rng(24);
    const events = new Events();
    const z = shot(0);
    kill(z);
    let far = 0;
    for (let f = 0; f < 60; f++) {
      GameUpdate(EYE, 1 / 60, camHost, rng, events);
      far = Math.max(far, dist2d(z.pos, vec3(0, 0, 40)));
    }
    check("an ordinary body still dies through state 6, where it stood",
          far < 1, `state ${z.state}, moved ${far.toFixed(2)}`);
  }
}

console.log("class 0x30, dying with a weapon still in hand:");
{
  const rng = new Rng(14);
  const events = scene(0, rng);
  const z = spawnZombie(0x3500, 1, "axe man");
  z.visible = true;
  z.hp = 1;
  z.pos = vec3(0, 40, 0);
  // `obj+0x34` bit 0x1000000, which `ZombieStateStandAndThrow` raises while a
  // thrower has a weapon. `ChooseDeathMotion` gives it clip 0x3F9 and
  // `ZombieStateDeath6` sub 2 reads the same bit.
  z.flags |= ActorFlag.HoldingWeapon;
  z.dead = true;
  z.flags |= ActorFlag.Dead;
  z.pendingHit = { bone: 1, result: 1 };

  GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
  check("it takes clip 0x3F9, not a directional death", z.motion === 0x3f9,
        `motion ${z.motion}`);
  check("...and state 6 hands it to state 12 rather than to a corpse",
        z.state === ZombieState.DeathFallAndBounce, `state ${z.state}`);

  // Sixty ticks of the death clip, then the fall opens.
  for (let i = 0; i < 40; i++) GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
  check("state 12 holds the clip before it falls", z.sub === 1, `sub ${z.sub}`);
  const y0 = z.pos.y;
  for (let i = 0; i < 40; i++) GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
  check("...then falls under gravity", z.sub === 2 && z.pos.y < y0,
        `sub ${z.sub}, ${y0} -> ${z.pos.y}`);
  // The present count is what the scripts wait on, and state 12 is the one
  // death path that holds it past the death clip: `ReleaseEnemyPresentCount`
  // (`FUN_00456580`) runs in `ZombieEnterCorpseState` and nowhere else, so
  // every frame of the fall is a frame `wait_enemies_present` and
  // `wait_scripted_actors` cannot come down.
  check("...holding `g_enemies_present` for the whole fall",
        G.g_enemies_present === 1, `present ${G.g_enemies_present}`);
  for (let i = 0; i < 400; i++) {
    GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
    if (z.state === ZombieState.CorpseSink) break;
  }
  check("...and settles into the corpse", z.state === ZombieState.CorpseSink,
        `state ${z.state} sub ${z.sub} y ${z.pos.y}`);
  check("...which is where it gives the present count back",
        G.g_enemies_present === 0, `present ${G.g_enemies_present}`);
}

/**
 * **What state 12 costs when its clip is not in the bundle**, pinned as a test
 * rather than left as a sentence.
 *
 * `PLAYER_HANGS.md` 22 and the shape of it: sub 1 is
 * `if (obj+0x19C < 0x3C) return;`, an exact literal against the play clock of
 * clip `0x3F9`, and `MotionPlayFrame` answers **0** for a clip the character
 * type has not got. No character type in any of the twelve shipped bundles had
 * `0x3F9` baked, so no actor in the port could leave state 12 anywhere in the
 * game, `ZombieEnterCorpseState` never ran, and `g_enemies_present` never
 * fell. Stage 3's block 2 hung on a `wait_scripted_actors` behind a dead
 * civilian who was herself parked on `CivilianWait.EnemiesPresent`.
 *
 * The fix is in the exporter -- `CLASS30_DEATH_CLIPS`, checked over the real
 * bundles by `tools/verify_death_clips.py`, because a hand-written fixture that
 * carries the clip is exactly what cannot see an exporter that does not. This
 * block is the other half: it says out loud that state 12's exit **is** the
 * clip's play clock, so a future attempt to clear the hang by short-circuiting
 * the wait, by special-casing a missing clip, or by making `MotionPlayFrame`
 * answer for a clip it has not got, fails here rather than looking like a fix.
 */
console.log("class 0x30 state 12, with no clip to wait on:");
{
  const rng = new Rng(14);
  // Same fixture, one clip poorer. Everything else is `TYPE`, so the only
  // difference between this block and the one above is the bundle.
  const noFall = { ...TYPE.motions } as Record<string, unknown>;
  delete noFall["1017"];
  const TYPE_NO_FALL = { ...TYPE, motions: noFall } as unknown as CharacterType;
  const CHARS_NO_FALL = {
    ...CHARS, types: { "1": TYPE_NO_FALL },
  } as unknown as CharactersJson;

  ResetGameGlobals();
  SetGameTables(CHARS_NO_FALL);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_player_lives = [PLAYER.start_lives, PLAYER.start_lives];
  G.g_nFiringGate = 1;
  const events = new Events();
  const z = spawnZombie(0x3520, 1, "axe man, no fall clip");
  z.visible = true;
  z.hp = 1;
  z.pos = vec3(0, 40, 0);
  z.flags |= ActorFlag.HoldingWeapon;
  z.dead = true;
  z.flags |= ActorFlag.Dead;
  z.pendingHit = { bone: 1, result: 1 };

  GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
  check("state 6 still sends it to state 12 -- the bit decides, not the clip",
        z.state === ZombieState.DeathFallAndBounce, `state ${z.state}`);
  // Ten times the sixty ticks the state is waiting for.
  for (let i = 0; i < 600; i++) GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
  check("...and with no 0x3F9 the play cursor never reaches 0x3C",
        MotionPlayFrame(z) === 0, `cursor ${MotionPlayFrame(z)}`);
  check("...so it is still in sub 1 after 600 frames",
        z.state === ZombieState.DeathFallAndBounce && z.sub === 1,
        `state ${z.state} sub ${z.sub}`);
  check("...and `g_enemies_present` is leaked for the rest of the stage",
        G.g_enemies_present === 1, `present ${G.g_enemies_present}`);
}

console.log("`ActorKillAll` routes class 0x30 through its death chain:");
{
  const rng = new Rng(15);
  const events = scene(2, rng);
  const [a, b] = G.g_object_list;
  const n = ActorKillAll(0, rng);
  check("the button kills both", n.enemies === 2 && a.dead && b.dead);
  // The whole reason to route rather than hand-assemble: what the old code set
  // by hand -- `dead`, the flag, a clip -- is three of the eleven things
  // `ZombieStateDeath6` does, and none of the teardown.
  check("...leaving the hit its death chain reads, not a clip",
        a.pendingHit !== null && a.death === null,
        `${JSON.stringify(a.pendingHit)} / ${JSON.stringify(a.death)}`);
  run(1, rng, events);
  check("...so one update puts both in state 6",
        a.state === ZombieState.Death && b.state === ZombieState.Death,
        `${a.state} / ${b.state}`);
  // 900 frames is what `tools/killall.mjs` ran, and what used to leave three
  // bodies standing.
  run(900, rng, events);
  check("...and 900 frames later the pool is empty of them",
        !G.g_object_list.some((o) => o.at === a.at || o.at === b.at),
        `${G.g_object_list.length} left`);
  check("...with both counters back at zero",
        G.g_enemies_alive === 0 && G.g_enemies_present === 0,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);
}

/**
 * **`ActorKillAll` is refused wherever a shot is refused.**
 *
 * `DispatchHit` (`FUN_004092F0`) returns before `ResolveHit` on `obj+0x34` bit
 * `0x100`, so in the engine no actor can reach zero hit points inside that
 * window — and both enemy classes lean on it. `ThrowerOnShot` (`FUN_004499A0`)
 * gates its whole response on the bit at `004499f5`/`004499f8`, `ZombieOnShot`
 * (`FUN_00453EB0`) at `00453ec7`/`00453eca`, the dead arm of each included. So
 * a debug clear that killed a shot-immune actor left it dead and never told:
 * its class's death chain never opened, and that chain is the only thing that
 * runs `ThrowerReleaseSlotOnDeath` (`FUN_0044D050`) and
 * `ZombieReleasePermitAndUntrack` (`FUN_004565A0`) — the two routines that
 * take it out of `g_enemies_alive` and out of `g_enemy_slots`.
 *
 * That was stage 6 block 0: `g_enemies_alive` stuck at 1 with the sidebar
 * naming nobody, because the holder was a `zslman` cycling its ordinary states
 * as a corpse. Every assertion here fails without the one-line refusal in
 * `ActorKillAll`, and it is the **counters and the slot array** that fail, not
 * a layer's opinion of itself.
 */
console.log("\n`ActorKillAll` will not kill what a shot could not touch:");
{
  const rng = new Rng(24);
  const events = scene(0, rng);

  const immuneZombie = spawnZombie(0x2700, 1, "immune zombie");
  immuneZombie.visible = true;
  immuneZombie.hp = 10;
  immuneZombie.pos = vec3(0, 0, 40);
  immuneZombie.flags |= ActorFlag.ShotImmune;

  const plainZombie = spawnZombie(0x2701, 1, "plain zombie");
  plainZombie.visible = true;
  plainZombie.hp = 10;
  plainZombie.pos = vec3(20, 0, 40);

  const immuneThrower = ActorSpawn(0x2702, SpawnClass.Thrower, 0x18,
                                   "immune thrower");
  immuneThrower.visible = true;
  immuneThrower.hp = 130;
  immuneThrower.pos = vec3(-20, 0, 40);
  immuneThrower.flags |= ActorFlag.ShotImmune;

  G.g_enemies_alive = 3;
  G.g_enemies_present = 3;
  G.g_enemy_slots = [immuneZombie.at, plainZombie.at, immuneThrower.at];

  const n = ActorKillAll(0, rng);
  check("the clear takes the one actor a shot could have reached",
        n.enemies === 1, `${n.enemies}`);
  check("...and leaves the shot-immune zombie its hit points",
        !immuneZombie.dead && immuneZombie.hp === 10
        && (immuneZombie.flags & ActorFlag.Dead) === 0,
        `hp ${immuneZombie.hp} flags ${immuneZombie.flags.toString(16)}`);
  check("...and the shot-immune thrower its own",
        !immuneThrower.dead && immuneThrower.hp === 130
        && (immuneThrower.flags & ActorFlag.Dead) === 0,
        `hp ${immuneThrower.hp} flags ${immuneThrower.flags.toString(16)}`);

  // The counters, which is the half the hang was made of. One kill, so one
  // actor may leave; the two refused ones must still be in both.
  run(900, rng, events);
  check("the killed one leaves both counters",
        G.g_enemies_alive === 2 && G.g_enemies_present === 2,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);
  check("...and its slot with them",
        !G.g_enemy_slots.includes(plainZombie.at), G.g_enemy_slots.join());
  check("...while the two refused ones are still alive and still counted",
        !immuneZombie.dead && !immuneThrower.dead
        && !immuneZombie.despawned && !immuneThrower.despawned,
        `${immuneZombie.dead}/${immuneThrower.dead}`);

  // The window is transient, and that is the whole argument for refusing
  // rather than special-casing: the clip ends, the bit goes, and the next
  // clear -- or the next shot -- takes them in the ordinary way.
  immuneZombie.flags &= ~ActorFlag.ShotImmune;
  immuneThrower.flags &= ~ActorFlag.ShotImmune;
  const m = ActorKillAll(0, rng);
  check("with the bit down the same clear takes both",
        m.enemies === 2 && immuneZombie.dead && immuneThrower.dead,
        `${m.enemies}`);
  run(900, rng, events);
  check("...and `g_enemies_alive` reaches zero, which is the gate",
        G.g_enemies_alive === 0, `${G.g_enemies_alive}`);
  check("...with nothing left holding a camera slot",
        G.g_enemy_slots.length === 0, G.g_enemy_slots.join());
}

// -- D1: where `NoCameraTrack` is raised, and the guard on it ---------------

/**
 * **`ReleaseAttackSlot` (`FUN_00456520`) does not untrack, and the caller
 * that does is guarded.**
 *
 * The port used to raise `obj+0x34` bit 0x10000 inside the permit release,
 * unconditionally, on every path in both ported enemy classes. The engine
 * raises it in `ZombieReleasePermitAndUntrack` (`FUN_004565A0`) instead, in
 * the same arm as the `g_enemy_slots` clear, and skips both when the actor
 * carries `ActorFlag.KeepCameraWhenLast` and is the last enemy alive.
 *
 * Every assertion below fails on the code as it stood before D1: the first
 * four because the release wrote the flag, the last three because the guard
 * did not exist.
 */
console.log("\n`NoCameraTrack` is the caller's write, and it is guarded:");
{
  const rng = new Rng(21);
  scene(0, rng);

  // 1. The permit release, on its own, on both classes.
  {
    const z = spawnZombie(0x2400, 1, "zombie");
    z.visible = true;
    z.hp = 10;
    check("a zombie takes a permit", TryClaimAttackSlot(z, NULL_HOST));
    ReleaseAttackSlot(z);
    check("`ReleaseAttackSlot` gives the permit back",
          z.attackPermit === -1 && G.g_attack_permits[0] === -1);
    check("...and does not touch `obj+0x34`",
          (z.flags & ActorFlag.NoCameraTrack) === 0,
          `flags ${z.flags.toString(16)}`);

    const w = ActorSpawn(0x2401, SpawnClass.Thrower, 0x35, "thrower");
    w.visible = true;
    w.hp = 10;
    check("...and a thrower's release is the same routine, same silence",
          ThrowerTryClaimAttackSlot(w, NULL_HOST)
          && (ThrowerReleaseAttackPermit(w), w.attackPermit === -1)
          && (w.flags & ActorFlag.NoCameraTrack) === 0,
          `flags ${w.flags.toString(16)}`);
  }
}
{
  const rng = new Rng(22);
  scene(0, rng);

  // 2. The guard, in `ZombieReleasePermitAndUntrack`. Three cases, and the
  //    count is read *before* `ReleaseEnemyAliveCount` runs, so "1" means
  //    "this actor is the last one".
  const zombie = (at: number, flags = 0): ZombieActor => {
    const a = spawnZombie(at, 1, `zombie ${at}`);
    a.visible = true;
    a.hp = 10;
    a.flags |= flags;
    G.g_enemy_slots = [...G.g_enemy_slots, a.at];
    return a;
  };

  {
    const last = zombie(0x2500, ActorFlag.KeepCameraWhenLast);
    G.g_enemies_alive = 1;
    ZombieReleasePermitAndUntrack(last);
    check("the last enemy alive carrying the bit keeps camera tracking",
          (last.flags & ActorFlag.NoCameraTrack) === 0,
          `flags ${last.flags.toString(16)}`);
    check("...and keeps its `g_enemy_slots` slot with it",
          G.g_enemy_slots.includes(last.at), G.g_enemy_slots.join());
    check("...and still leaves `g_enemies_alive`, which is outside the arm",
          G.g_enemies_alive === 0, `${G.g_enemies_alive}`);
  }
  {
    const plain = zombie(0x2501);
    G.g_enemies_alive = 1;
    ZombieReleasePermitAndUntrack(plain);
    check("one without the bit loses tracking even as the last alive",
          (plain.flags & ActorFlag.NoCameraTrack) !== 0,
          `flags ${plain.flags.toString(16)}`);
    check("...and loses the slot with it",
          !G.g_enemy_slots.includes(plain.at), G.g_enemy_slots.join());
  }
  {
    const held = zombie(0x2502, ActorFlag.KeepCameraWhenLast);
    G.g_enemies_alive = 2;                     // it is not the last one
    ZombieReleasePermitAndUntrack(held);
    check("with two alive the guard does not fire",
          (held.flags & ActorFlag.NoCameraTrack) !== 0
          && !G.g_enemy_slots.includes(held.at),
          `flags ${held.flags.toString(16)} slots ${G.g_enemy_slots.join()}`);
  }
}
{
  const rng = new Rng(23);
  scene(0, rng);

  // 3. Class 0x31's is the same guard on the other counter --
  //    `ThrowerReleaseSlotOnDeath` (`FUN_0044D050`) reads `g_enemies_present`.
  //    The port used to guard the slot clear alone and raise the flag either
  //    way, which is the half of D1 that lived in `combat/counts.ts`.
  const thrown = (at: number, flags = 0): Actor => {
    const a = ActorSpawn(at, SpawnClass.Thrower, 0x35, `thrower ${at}`);
    a.visible = true;
    a.hp = 0;                                  // dying, so the routine acts
    a.flags |= flags;
    G.g_enemy_slots = [...G.g_enemy_slots, a.at];
    return a;
  };

  {
    const last = thrown(0x2600, ActorFlag.KeepCameraWhenLast);
    G.g_enemies_present = 1;
    ThrowerReleaseSlotOnDeath(last);
    check("the last enemy present carrying the bit keeps both",
          (last.flags & ActorFlag.NoCameraTrack) === 0
          && G.g_enemy_slots.includes(last.at),
          `flags ${last.flags.toString(16)} slots ${G.g_enemy_slots.join()}`);
  }
  {
    const plain = thrown(0x2601);
    G.g_enemies_present = 1;
    ThrowerReleaseSlotOnDeath(plain);
    check("...and one without the bit loses both",
          (plain.flags & ActorFlag.NoCameraTrack) !== 0
          && !G.g_enemy_slots.includes(plain.at),
          `flags ${plain.flags.toString(16)} slots ${G.g_enemy_slots.join()}`);
  }
}
/**
 * **B8, the half of it that lives in `game/`.**
 *
 * The report — "the two later zombies that drop from the high ledge don't
 * pause the camera... maybe a race condition?" — has an obvious suspect: a
 * zombie still in the air has not joined the enemy counters yet, so
 * `wait_enemies_alive` sees zero and lets the block go. It is not what
 * happens, and pinning that down is what turned the search towards the script
 * side, where the bug actually was.
 *
 * `EnemyZombieInit` (`FUN_00452DA0`) does its two `INC`s in `Init`, on the
 * straight line after the state is seeded. The only two spawns it declines are
 * character type 9 and initial state 31 — neither of which any entrance state
 * is — so a dropper is in both counters from the frame the spawn instruction
 * runs and stays there for the whole descent.
 */
console.log("\nan entrance state is counted from its first frame:");
{
  const rng = new Rng(31);
  const events = new Events();
  // Stage 1 block 4 step 5's pair, in shape: class 0x30 on the ledge at
  // y = 61 with `ZombieStateDelayedLeap` (26) as the initial state.
  const drop = (at: number): Actor => ActorSpawn(at, SpawnClass.Zombie, 1,
    "ledge dropper", { initialState: ZombieState.DelayedLeap, hp: 100,
                       maxHp: 100, visible: true, pos: vec3(0, 61, -20) }, rng);

  ResetGameGlobals();
  const a = drop(0xb000);
  const b = drop(0xb001);
  check("both droppers join the counters in `Init`, before a frame runs",
        G.g_enemies_alive === 2 && G.g_enemies_present === 2,
        `alive ${G.g_enemies_alive} present ${G.g_enemies_present}`);
  check("...and they really are in the entrance state",
        a.state === ZombieState.DelayedLeap
        && b.state === ZombieState.DelayedLeap,
        `${a.state} / ${b.state}`);

  // The whole descent. `UNCOUNTED_INITIAL_STATE` is the one state that is
  // allowed to be uncounted while it waits, and 26 is not it.
  check("state 26 is not the state that counts itself in later",
        (ZombieState.DelayedLeap as number) !== UNCOUNTED_INITIAL_STATE);
  let lowAlive = G.g_enemies_alive;
  for (let i = 0; i < 240; i++) {
    GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
    lowAlive = Math.min(lowAlive, G.g_enemies_alive);
  }
  check("...and neither leaves the count while it is still falling",
        lowAlive === 2 && G.g_enemies_alive === 2,
        `lowest ${lowAlive}, now ${G.g_enemies_alive}`);
}

/**
 * **The camera hands the port every frame of a path, including the last one.**
 *
 * The engine runs two tasks: `EvtInterpreterLoop` (`FUN_0045ECC0`) and then
 * `EvtRunQueuedActions` (`FUN_00402320`), and `CamAdvancePathFrame`
 * (`FUN_004035E0`) — which lives in the second — publishes the camera block's
 * `+0xD0` *before* it tests the end of the range and retires the action. So the
 * frame a shot ends on is a value `g_cam_path_frame` really holds, for one
 * whole object update, before the shot behind it can start.
 *
 * The port used to run its camera half first and its instructions second, so
 * `wait_queued_events_done` fell through on the same tick the path ended, the
 * `cam_play` behind it took the camera, and the end frame was never published
 * at all. Stage 1's `cam_play 115..179` went 178, 180 — and three class-0x30
 * zombies whose entrance cue is exactly 179 stood in their entrance clip for
 * the rest of the stage, which is how the game writes "come through the door
 * as this shot ends". Stage 2's `0xFAF4` is the same bug on `100..229`.
 *
 * This is that script in miniature, and the assertion is the invariant rather
 * than the symptom: **no integer between the first shot's start and the second
 * shot's end may be missing from what the walker publishes.**
 * `tools/cam_cues.mjs` is the same check against all 44 shipped spawns.
 */
console.log("\nthe camera path publishes every frame, ends included:");
{
  const camOp = (i: number, start: number, end: number) => ({
    i, at: i, op: 0x30, name: "queue_event", cat: "camera",
    sel: 0x40, action: "cam_play", args: [start, end, 7, 0],
    start, end, slot: 7, flags: 0, static: false, resume: false,
    cam: { file: "cp_test", path: 0, duration: end + 1 },
  });
  const script = {
    scene: 0, stage: 1, game_mode: 0, evt_file: "test", entry_block: 0,
    entry_step: 0, routes: [{ kind: "end", next: [-1, -1, -1] }],
    regions: [], cam_slots_used: [7], warnings: [],
    blocks: [{
      index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
      steps: [{ index: 0, at: 0, ops: [
        camOp(0, 0, 10),
        // The gate the shipped scripts put between two shots.
        { i: 1, at: 1, op: 0x40, name: "wait_queued_events_done", cat: "wait",
          blocks_on: "queued events pending == 0" },
        camOp(2, 11, 20),
        { i: 3, at: 3, op: 0x41, name: "wait_camera_path_frame", cat: "wait",
          arg: 0, blocks_on: "camera path frame past arg" },
      ] }],
    }],
  } as unknown as ScriptJson;

  const w = new Walker(script, {
    enterRegion: () => undefined, loadSlot: () => undefined,
    unloadSlot: () => undefined, startCamera: () => undefined,
    onFeed: () => undefined, onBranch: () => undefined,
    playSound: () => undefined, aliveEnemies: () => null,
    presentEnemies: () => null,
    aliveCivilians: () => null, cameraFree: () => null,
    scriptFlagRaised: () => null,
    showMessage: () => null, endDialogue: () => undefined,
  });
  // No `primeToFirstWait`: it steps *over* waits to get a scene on screen, and
  // the wait between the two shots is the whole point here. The first tick
  // runs the instructions from cold, exactly as the player's does.

  // What `syncPortGlobals` copies into `g_cam_path_frame`, once a tick.
  const published: number[] = [];
  for (let f = 0; f < 60; f++) {
    w.tick(1 / 60);
    published.push(w.cam ? Math.trunc(w.cam.frame) : -1);
  }
  const missing: number[] = [];
  for (let n = 0; n <= 20; n++) if (!published.includes(n)) missing.push(n);
  const head = published.slice(0, 16).join(",");
  check("every frame of both shots reaches the port",
        missing.length === 0, `missing ${missing.join(", ")} of ${head}`);
  check("...including 10, the frame the first shot ends on",
        published.includes(10), head);
  // And it is published for exactly one tick, as `CamAdvancePathFrame` does:
  // one call, one publish, and the shot behind it cannot start until the tick
  // after the interpreter has seen the retirement.
  check("...for exactly one tick, not two",
        published.filter((n) => n === 10).length === 1, head);
  check("...and the shot behind it starts on the tick after",
        published[published.indexOf(10) + 1] === 11, head);
}

/**
 * `wait_camera_path_frame <n>` releases on `n + 1`, not on `n`.
 *
 * `EvtOpWaitCameraPathFrame41` (`FUN_0045FAC0`) advances the instruction
 * pointer only when `g_cam_path_frame > operand`:
 *
 * ```
 * 0045fae7  CMP dword ptr [0x009a6110],EAX
 * 0045faed  JLE 0045fb29            ; frame <= operand: keep waiting
 * ```
 *
 * The port counted down to the operand itself, so every instruction behind
 * such a wait ran one frame early — and `runCameraOnPast`, the seek's half of
 * the same rule, already used `arg + 1`, so the live walker and the seek
 * disagreed about where the camera was. Stage 2's block 9 is the one where it
 * mattered: `wait_camera_path_frame 384` let the `finish_sequence 4` behind it
 * freeze the camera on 384, and frame 385 — the last frame of a stashed play,
 * and a civilian's cue — was never published.
 */
console.log("\na camera-frame wait releases one frame past its operand:");
{
  const camOp = (i: number, start: number, end: number) => ({
    i, at: i, op: 0x30, name: "queue_event", cat: "camera",
    sel: 0x40, action: "cam_play", args: [start, end, 7, 0],
    start, end, slot: 7, flags: 0, static: false, resume: false,
    cam: { file: "cp_test", path: 0, duration: end + 1 },
  });
  const script = {
    scene: 0, stage: 1, game_mode: 0, evt_file: "test", entry_block: 0,
    entry_step: 0, routes: [{ kind: "end", next: [-1, -1, -1] }],
    regions: [], cam_slots_used: [7], warnings: [],
    blocks: [{
      index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
      steps: [{ index: 0, at: 0, ops: [
        camOp(0, 0, 10),
        { i: 1, at: 1, op: 0x41, name: "wait_camera_path_frame", cat: "wait",
          arg: 5, blocks_on: "camera path frame past arg" },
        // The instruction behind the wait, and the frame it ran on is the
        // measurement.
        { i: 2, at: 2, op: 0x48, name: "set_script_flag", cat: "flow",
          flag: 9 },
        { i: 3, at: 3, op: 0x41, name: "wait_camera_path_frame", cat: "wait",
          arg: 0, blocks_on: "camera path frame past arg" },
      ] }],
    }],
  } as unknown as ScriptJson;
  const w = new Walker(script, {
    enterRegion: () => undefined, loadSlot: () => undefined,
    unloadSlot: () => undefined, startCamera: () => undefined,
    onFeed: () => undefined, onBranch: () => undefined,
    playSound: () => undefined, aliveEnemies: () => null,
    presentEnemies: () => null,
    aliveCivilians: () => null, cameraFree: () => null,
    scriptFlagRaised: () => null,
    showMessage: () => null, endDialogue: () => undefined,
  });
  G.g_script_flags[9] = 0;
  let ranOn = -1;
  const seen: number[] = [];
  for (let f = 0; f < 30; f++) {
    w.tick(1 / 60);
    seen.push(w.cam ? Math.trunc(w.cam.frame) : -1);
    if (ranOn < 0 && G.g_script_flags[9]) ranOn = seen[seen.length - 1];
  }
  check("the instruction behind `wait_camera_path_frame 5` runs on frame 6",
        ranOn === 6, `ran on ${ranOn} of ${seen.slice(0, 12).join(",")}`);
}

/**
 * The **other** way the engine plays a path, and it is not this one.
 *
 * `queue_event cam_play` with `flags & 2` does not play: `FUN_00403490`
 * stashes the range, and the `finish_sequence 6|7` behind it installs a rail
 * hook that plays it. Both hooks — `CameraStepRailTick` (`FUN_0040C790`) for
 * state (2,6) and `CameraPlayStashedPath` (`FUN_0040C8A0`) for (2,7) —
 * **increment the frame before they evaluate it**, where `CamAdvancePathFrame`
 * publishes the cursor and then increments. So a stashed `0..10` draws
 * `1..10` under state (2,6): the start frame is stepped past, and the end
 * frame is reached.
 *
 * **And (2,7) draws `1..11`.** The two hooks differ in one byte of guard —
 * `JGE` at `0x0040C7A0` against `JG` at `0x0040C8C0` — so state 7 lets the
 * last comparison through and the increment carries it one frame past the
 * range's end. See `CamCommand.pastEnd`: the port gave (2,6)'s answer to
 * both, and stage 2's block 9 is what that cost.
 *
 * The port had `started: true` on both, copied from the non-deferred branch
 * where it is right, and the deferred shot lost its last frame. Stage 2 block
 * 16 step 6 stashes `581..660` on path 75, and both cues that shot exists to
 * fire are timed to its tail: `0xA030`'s captor cue is 660 and its civilian's
 * killed script waits on 650. Neither could be reached from 659, so the captor
 * never turned on the player, the two `znebi2` were never called up out of the
 * water and `wait_enemies_alive 0` held block 16 for ever.
 */
console.log("\na stashed path is played by a hook that steps first:");
{
  const stashOp = (i: number, start: number, end: number) => ({
    i, at: i, op: 0x30, name: "queue_event", cat: "camera",
    sel: 0x40, action: "cam_play", args: [start, end, 7, 2],
    start, end, slot: 7, flags: 2, static: false, resume: false,
    cam: { file: "cp_test", path: 0, duration: end + 1 },
  });
  const script = {
    scene: 0, stage: 1, game_mode: 0, evt_file: "test", entry_block: 0,
    entry_step: 0, routes: [{ kind: "end", next: [-1, -1, -1] }],
    regions: [], cam_slots_used: [7], warnings: [],
    blocks: [{
      index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
      steps: [{ index: 0, at: 0, ops: [
        stashOp(0, 0, 10),
        { i: 1, at: 1, op: 0x30, name: "queue_event", cat: "camera",
          sel: 0x21, action: "finish_sequence", args: [7],
          scene_state: { major: 2, minor: 7 },
          camera_state: "play_stashed_path_exclusive" },
        { i: 2, at: 2, op: 0x41, name: "wait_camera_path_frame", cat: "wait",
          arg: 0, blocks_on: "camera path frame past arg" },
        // Somewhere for the seek below to land *past* the wait: `seekTo`
        // stops the moment `opIndex` reaches its goal, so asking for the wait
        // itself arrives without ever executing it.
        { i: 3, at: 3, op: 0x48, name: "set_script_flag", cat: "flow",
          flag: 1 },
      ] }],
    }],
  } as unknown as ScriptJson;

  const host = {
    enterRegion: () => undefined, loadSlot: () => undefined,
    unloadSlot: () => undefined, startCamera: () => undefined,
    onFeed: () => undefined, onBranch: () => undefined,
    playSound: () => undefined, aliveEnemies: () => null,
    presentEnemies: () => null,
    aliveCivilians: () => null, cameraFree: () => null,
    scriptFlagRaised: () => null,
    showMessage: () => null, endDialogue: () => undefined,
  };

  const w = new Walker(script, host);
  const published: number[] = [];
  for (let f = 0; f < 40; f++) {
    w.tick(1 / 60);
    published.push(w.cam ? Math.trunc(w.cam.frame) : -1);
  }
  const head = published.slice(0, 14).join(",");
  check("the stashed shot reaches its end frame",
        published.includes(10), head);
  check("...and steps past its start frame, which the hook never draws",
        !published.includes(0), head);
  check("...so its first drawn frame is 1",
        published[0] === 1, head);
  check("...and every frame between is published",
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].every((n) => published.includes(n)),
        head);
  // `JG` at `0x0040C8C0`, and the increment before the publish: state 7's
  // last comparison passes at `cur == end` and carries the frame one past it.
  // Stage 2's block 9 stashes `351..384` and its civilian's cue is **385**.
  check("...and state 7 publishes one frame PAST the end",
        published.includes(11), head);
  check("...and not two",
        !published.includes(12), head);
}

/** The same stash under state **(2,6)**, whose guard stops on the end frame. */
{
  const stashOp = (i: number, start: number, end: number) => ({
    i, at: i, op: 0x30, name: "queue_event", cat: "camera",
    sel: 0x40, action: "cam_play", args: [start, end, 7, 2],
    start, end, slot: 7, flags: 2, static: false, resume: false,
    cam: { file: "cp_test", path: 0, duration: end + 1 },
  });
  const script = {
    scene: 0, stage: 1, game_mode: 0, evt_file: "test", entry_block: 0,
    entry_step: 0, routes: [{ kind: "end", next: [-1, -1, -1] }],
    regions: [], cam_slots_used: [7], warnings: [],
    blocks: [{
      index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
      steps: [{ index: 0, at: 0, ops: [
        stashOp(0, 0, 10),
        { i: 1, at: 1, op: 0x30, name: "queue_event", cat: "camera",
          sel: 0x21, action: "finish_sequence", args: [6],
          scene_state: { major: 2, minor: 6 },
          camera_state: "play_stashed_path" },
        { i: 2, at: 2, op: 0x41, name: "wait_camera_path_frame", cat: "wait",
          arg: 0, blocks_on: "camera path frame past arg" },
      ] }],
    }],
  } as unknown as ScriptJson;
  const host = {
    enterRegion: () => undefined, loadSlot: () => undefined,
    unloadSlot: () => undefined, startCamera: () => undefined,
    onFeed: () => undefined, onBranch: () => undefined,
    playSound: () => undefined, aliveEnemies: () => null,
    presentEnemies: () => null,
    aliveCivilians: () => null, cameraFree: () => null,
    scriptFlagRaised: () => null,
    showMessage: () => null, endDialogue: () => undefined,
  };
  const w = new Walker(script, host);
  const published: number[] = [];
  for (let f = 0; f < 40; f++) {
    w.tick(1 / 60);
    published.push(w.cam ? Math.trunc(w.cam.frame) : -1);
  }
  const head = published.slice(0, 14).join(",");
  check("state 6 reaches the end frame", published.includes(10), head);
  check("...and stops on it", !published.includes(11), head);

  // And the seek's half: `seekTo` observes no waits, so an address behind
  // `wait_camera_path_frame` is reached with the shot still in the middle of
  // itself unless the wait's postcondition is applied by hand. It used to be
  // reached with the camera on frame 0 of a shot the script only ever leaves
  // at 10 — and the `finish_sequence` behind it then froze it there.
  const w2 = new Walker(script, host);
  seekTo(w2, 0, 0, 3);
  check("a seek over the wait lands with the shot at its end",
        w2.cam?.frame === 10, `frame ${w2.cam?.frame}`);
  check("...and with the action retired",
        w2.cam?.done === true, `done ${w2.cam?.done}`);

  // A target that is not a whole number has to throw, because the silent
  // failure is total rather than partial: `arrived()` compares
  // `w.block === block`, so an object equals nothing, `maxOps` falls back to
  // 500,000, and the "seek" replays the **entire script** and returns false.
  // `tools/props43.mjs` was `seekTo(walker, { block, step }, rng)` for exactly
  // that reason — the `.mjs` harnesses are outside `tsc`, so nothing but this
  // stands between a mis-shaped call and a harness that reports the address it
  // asked for as the address it reached. The messages name the argument.
  const refuses = (label: string, call: () => unknown): void => {
    let msg = "did not throw";
    try {
      call();
    } catch (e) {
      msg = e instanceof TypeError ? e.message : `threw ${String(e)}`;
    }
    check(`seekTo refuses ${label}`, msg.startsWith("seekTo: "), msg);
  };
  const w3 = new Walker(script, host);
  // The exact call `props43.mjs` made: an options object where the block goes.
  refuses("an options object for `block`",
          () => seekTo(w3, { block: 0, step: 0 } as unknown as number, 0));
  refuses("a string for `step`",
          () => seekTo(w3, 0, "0" as unknown as number));
  refuses("a fractional `opIndex`", () => seekTo(w3, 0, 0, 1.5));
  refuses("a NaN `block`", () => seekTo(w3, Number.NaN, 0));
  refuses("an infinite `maxOps`",
          () => seekTo(w3, 0, 0, 0, Number.POSITIVE_INFINITY));
  refuses("a fractional `entryBlock`",
          () => seekTo(w3, 0, 0, 0, 500000, 0.5));
  check("...and still takes the call it is meant to take",
        seekTo(w3, 0, 0, 3) === true, `${w3.block}/${w3.step}/${w3.opIndex}`);
}

// The character's size, and the two things it decides.
//
// `ActorBuildSkinnedModel` (`FUN_00410440`) writes `model+0x116C` from the
// character type alone, and `SkeletonApplyRootMotion` scales the clip's root
// delta by it -- so a smaller character takes smaller steps. This port applied
// 1.0 to everything and called the field "drawing only".
{
  check("the scale table is the engine's jump table, not a guess",
        ActorModelScale(30) === 0.6 && ActorModelScale(31) === 0.7
        && ActorModelScale(32) === 0.9 && ActorModelScale(56) === 0.9
        && ActorModelScale(29) === 1 && ActorModelScale(57) === 1
        && ActorModelScale(8) === 1,
        `${[29, 30, 31, 32, 56, 57].map(ActorModelScale).join(", ")}`);

  // Stage 1's rescue, in one line: the civilian is type 38 and her captor
  // type 8, so she flees at 0.9 of her clip and he walks at all of his.
  // Unscaled the gap closes at 0.800 - 0.688 = 0.112 an authored frame;
  // scaled, at 0.800 - 0.619 = 0.180. Both are small, and the ratio between
  // two small numbers is not small: 1.6x, which is a grab 158 ticks after the
  // spawn instead of 244 -- inside its camera shot instead of long after it.
  const civRun = 0.6885 * ActorModelScale(38);
  const captorWalk = 0.800 * ActorModelScale(8);
  const ratio = (captorWalk - civRun) / (0.800 - 0.6885);
  check("...so the captor closes on the civilian 1.6x faster than unscaled",
        Math.abs(ratio - 1.61) < 0.02, `${ratio.toFixed(2)}x`);
}

// `ActorPointIsAhead` (`FUN_0045BC10`): the world delta rotated into the
// actor's own frame by `MatrixRotateY(-yaw)`, and whether that local z is
// positive. `MatrixRotateY(t)` builds `row0 = (cos, 0, -sin)`,
// `row2 = (sin, 0, cos)`, and the transform is D3D's row-vector form, so
// `z' = dz*cos(t) - dx*sin(t)`; at `t = -yaw` that is `dx*sin + dz*cos`. The
// port had `dz*cos - dx*sin` -- the *forward* rotation -- so the dx term
// carried the wrong sign and the predicate answered the mirror question.
//
// The clips face -Z, so a positive local z is a point **behind** the actor,
// which is the question a state named "walk past point" is asking.
{
  const past = (yaw: number, px: number, pz: number) =>
    ActorPointIsAhead({ pos: vec3(0, 0, 0), yaw } as never, vec3(px, 0, pz));
  // Facing +X (yaw 0xC000): a point at +55 is in front of the actor.
  check("a point in front of the actor does not read as walked past",
        past(0xc000, 55, 0) === false);
  check("...and one behind it does", past(0xc000, -55, 0) === true);
  check("...and both answers flip with the facing",
        past(0x4000, 55, 0) === true && past(0x4000, -55, 0) === false);
  // The sideways pair is what the sign error could not tell apart: only the
  // dx term separates them, so with the wrong sign these two agreed.
  check("...and the two sideways points are separated by the yaw term",
        past(0xc000, 0, 55) !== past(0xc000, 0, -55));
}

// The head that comes off, and where it lands.
//
// `SpawnSeveredHead` (`FUN_0040A130`) is an `ActorAlloc` of an object with its
// own per-frame routine -- not the blood spray `docs/formats/combat.md` called
// it, which is why the port removed the head and drew nothing. The physics is
// `SeveredHeadUpdate` (`FUN_0040A230`): thrown up and away from the camera,
// spun on two axes, bounced off the floor at a quarter of its speed, then
// settled, sunk and freed.
{
  ResetGameGlobals();
  const rng = new Rng(7);
  SpawnSeveredHead(vec3(0, 40, 0), 0x1234, 0, 0);
  check("a burst puts one head in the pool", G.g_severed_heads.length === 1);
  const h = G.g_severed_heads[0]!;
  check("...carrying the model the head was drawn with", h.slot === 0x1234);

  SeveredHeadUpdate(h, rng);
  check("...thrown upward between 0.31 and 0.50",
        h.vel.y > 0.28 && h.vel.y < 0.51, `${h.vel.y}`);
  check("...and spun on both axes",
        Math.abs(h.spinYaw) >= 0x800 && h.spinPitch >= 0x800,
        `yaw ${h.spinYaw} pitch ${h.spinPitch}`);
  check("...and it is falling, not still launching",
        h.phase === SeveredHeadPhase.Falling, `phase ${h.phase}`);

  // No collision in this fixture, so the ground answers a constant; what the
  // assertion is about is that gravity is applied and the head comes down.
  const apex = () => {
    let top = h.pos.y, last = h.pos.y;
    for (let i = 0; i < 120 && SeveredHeadUpdate(h, rng); i++) {
      top = Math.max(top, h.pos.y);
      last = h.pos.y;
    }
    return { top, last };
  };
  const { top, last } = apex();
  check("...it rises and then falls", top > 40 && last < top,
        `apex ${top.toFixed(1)}, ended ${last.toFixed(1)}`);

  // The settle path, driven directly: a head at rest counts out and is dropped.
  const g = G.g_severed_heads[0]!;
  g.phase = SeveredHeadPhase.Settled;
  g.timer = 2;
  check("a settled head sinks", (() => {
    const before = g.pos.y;
    SeveredHeadUpdate(g, rng);
    return g.pos.y < before;
  })());
  check("...and is dropped when its two seconds are out",
        SeveredHeadUpdate(g, rng) === false, `timer ${g.timer}`);
}

// Which of the run pair a zombie takes, and who decides.
//
// `ZombieStateAttackRun` (`FUN_004554D0`) indexes its motion row with
// `2 + ((obj+0x34 >> 0x1B) & 1)`. Nothing in the image ORs that bit: it comes
// off the spawn record through `ActorInitFlags`, so it is placement data. The
// port took "the first of the pair this bundle carries" instead, which is
// always row 2, so 192 of the 402 shipped class-0x30 spawns jogged where the
// data says they sprint.
{
  const row = [900, 901, 902, 903, 904];
  const zombie = (flags: number) => {
    ResetGameGlobals();
    const z = spawnZombie(0x4000, 1, "runner");
    z.flags = flags;
    return z;
  };
  check("an unflagged spawn takes the jog, row 2",
        ZombieRunMotion(zombie(0), row) === 902);
  check("...and a flagged one takes the sprint, row 3",
        ZombieRunMotion(zombie(ZOMBIE_SPRINTS), row) === 903);
  // The bit is 0x08000000 and nothing else in the word may reach the index.
  check("...and no other flag moves the index",
        ZombieRunMotion(zombie(0xf7ffffff), row) === 902,
        `${ZombieRunMotion(zombie(0xf7ffffff), row)}`);
  check("...while the whole word does",
        ZombieRunMotion(zombie(0xffffffff), row) === 903);
}

// The headshot burst, end to end.
//
// The physics assertions above drive `SeveredHeadUpdate` directly, which is
// exactly why the first cut of this shipped doing nothing: `ResolveHit` read
// the head's model out of `obj.boneSlot`, which is **empty until something
// swaps a part**, so a clean headshot kill -- the common case -- found slot 0
// and spawned no head at all. Testing the physics is not testing the trigger.
{
  const rng = new Rng(11);
  scene(1, rng);
  G.g_app_state = AppState.InPlay;
  const z = G.g_object_list[0];

  // One in four, so drive it until it fires rather than guessing a seed.
  let fired = 0, tries = 0;
  for (; tries < 60 && fired === 0; tries++) {
    G.g_severed_heads.length = 0;
    z.hp = 1;
    z.dead = false;
    z.flags = 0;
    z.removed.length = 0;
    z.boneSlot = {};
    ResolveHit(z, 2, 0, NULL_HOST, rng);
    fired = G.g_severed_heads.length;
  }
  check("a headshot kill throws a head", fired === 1, `after ${tries} kills`);
  check("...carrying the skeleton's own head model, with nothing swapped",
        G.g_severed_heads[0]?.slot === 0x30,
        `slot ${G.g_severed_heads[0]?.slot}`);

  // ...and the three types the engine spares keep theirs, whatever the roll.
  const spared = (t: number) => {
    const r = new Rng(11);
    scene(1, r);
    G.g_app_state = AppState.InPlay;
    const a = G.g_object_list[0];
    a.charType = t;
    for (let i = 0; i < 40; i++) {
      a.hp = 1; a.dead = false; a.flags = 0; a.removed.length = 0;
      ResolveHit(a, 2, 0, NULL_HOST, r);
    }
    return G.g_severed_heads.length;
  };
  check("...and character types 3, 0x12 and 0x18 never lose one",
        spared(3) === 0 && spared(0x12) === 0 && spared(0x18) === 0);
  G.g_app_state = AppState.Attract;

  if (process.env.HEAD_TRACE) {
    ResetGameGlobals();
    const r = new Rng(3);
    SpawnSeveredHead(vec3(0, 11, 0), 0x30, 0, 0);
    const h = G.g_severed_heads[0]!;
    let f = 0, apex = 0, dist = 0;
    while (SeveredHeadUpdate(h, r) && f < 400) {
      apex = Math.max(apex, h.pos.y);
      dist = Math.hypot(h.pos.x, h.pos.z);
      if (f < 6 || f % 10 === 0) {
        console.log(`    f${String(f).padStart(3)} y=${h.pos.y.toFixed(2)}`
          + ` vy=${h.vel.y.toFixed(3)} d=${dist.toFixed(2)} phase=${h.phase}`);
      }
      f++;
    }
    console.log(`    apex ${apex.toFixed(2)} (from 11), travelled `
      + `${dist.toFixed(2)}, alive ${f} frames`);
  }
}


// -- 26. the shot effects: what leaves the gun, and what sticks to the bone --

/**
 * **Every sprite a bullet makes, with no renderer anywhere near it.**
 *
 * All of this used to be a canvas gradient in `render/shooting.ts`, so none of
 * it could be asserted and two thirds of it did not exist: there was no muzzle
 * flash, no tracer, and the blood was a fading circle at the bone rather than
 * a twenty-five-model flipbook stuck to it.
 *
 * The host here is a camera at the origin looking down **+Z**, which is the
 * direction `RAY` points in every other section of this file, so `viewPoint`
 * and `viewSpaceOfPoint` are one sign flip each.
 */
/**
 * **All five of `ActorPlayHitVoice`'s kinds**, from the one copy of it.
 *
 * `FUN_0040A6F0` has five kinds and the port used to have it twice: kinds 0, 1
 * and 2 in `render/shooting.ts` because the shot path needed them, kind 3
 * nowhere at all -- so a zombie made a noise when you shot it and none when it
 * swung at you, which is how it was reported. Kind 3 is also the only kind
 * whose table entry is a *pair per voice set* rather than one id per set, and
 * the exporter had been reading all fifteen dwords of `g_hit_voice_table` and
 * emitting eleven.
 *
 * There is one copy now, in `game/combat/voice.ts`, so every kind is reachable
 * from here: the set split, the pair, the impact-plus-voice shape of 0, 1 and
 * 2, and kind 4's proved silence. Which kind a *shot* passes is the next
 * section; `ZombieStateStrike` raising kind 3 is checked by the sound reaching
 * the event bus during a real strike.
 */
console.log("\nthe five voice kinds:");
{
  const heard: number[] = [];
  const rng = new Rng(7);
  SetGameTables({
    ...CHARS,
    combat: {
      impact: [{ id: 1, file: "" }],
      head_impact: [{ id: 2, file: "" }],
      voice: {
        hurt: [{ id: 10, file: "" }, { id: 11, file: "" }],
        kill: [{ id: 20, file: "" }, { id: 21, file: "" }],
        head: [{ id: 30, file: "" }, { id: 31, file: "" }],
        attack: [[{ id: 40, file: "" }, { id: 41, file: "" }],
                 [{ id: 50, file: "" }, { id: 51, file: "" }]],
      },
      // The engine's own list, at `0x0040A6F5`.
      voice_set_a_types: [0, 2, 5, 6, 9, 0x0e, 0x0f, 0x10, 0x11],
      ricochet: {},
    },
  } as unknown as CharactersJson);
  const say = (id: number) => heard.push(id);

  heard.length = 0;
  ActorPlayHitVoice({ charType: 2 }, ActorVoice.Attack, rng, say);
  check("a set-A character cries out of set A's pair",
        heard.length === 1 && (heard[0] === 40 || heard[0] === 41),
        JSON.stringify(heard));

  heard.length = 0;
  ActorPlayHitVoice({ charType: 1 }, ActorVoice.Attack, rng, say);
  check("...and a set-B character out of set B's",
        heard.length === 1 && (heard[0] === 50 || heard[0] === 51),
        JSON.stringify(heard));

  // Kind 3 is the only one that plays a *single* sound: the other three open
  // with an impact and the routine's tail plays no second id for this one.
  heard.length = 0;
  ActorPlayHitVoice({ charType: 1 }, ActorVoice.Hurt, rng, say);
  check("a hurt voice is an impact and a voice, which the cry is not",
        heard.length === 2 && heard[0] === 1 && heard[1] === 11,
        JSON.stringify(heard));

  // Kinds 1 and 2 are the other two halves of the shot voice, and they differ
  // in their *impact* rather than in their line: kind 1 draws one of five body
  // impacts, kind 2 coin-flips two head ones. In the shipped table their two
  // voice ids are the same pair, which is why the correction this port made to
  // which kind plays is nearly inaudible -- the fixture gives them distinct
  // ids so that the wiring is still assertable.
  heard.length = 0;
  ActorPlayHitVoice({ charType: 1 }, ActorVoice.Killed, rng, say);
  check("a kill voice is a body impact and set B's kill line",
        heard.length === 2 && heard[0] === 1 && heard[1] === 21,
        JSON.stringify(heard));

  heard.length = 0;
  ActorPlayHitVoice({ charType: 2 }, ActorVoice.HeadKilled, rng, say);
  check("a head voice takes the *head* impact table, and set A's line",
        heard.length === 2 && heard[0] === 2 && heard[1] === 30,
        JSON.stringify(heard));

  // `[proved]` in `functions.tsv`: no site in the image passes 4 and both of
  // its ids are zero, so the engine's own arm reaches `PlaySoundId(0)`.
  heard.length = 0;
  ActorPlayHitVoice({ charType: 2 }, ActorVoice.Kind4, rng, say);
  check("kind 4 is silence, because the engine's ids for it are zero",
        heard.length === 0, JSON.stringify(heard));

  // A bundle written before the four ids were read carries no `attack`, and
  // then the swing has to stay silent rather than throw.
  heard.length = 0;
  SetGameTables({
    ...CHARS,
    combat: { impact: [], head_impact: [], voice: { hurt: [], kill: [], head: [] },
              voice_set_a_types: [], ricochet: {} },
  } as unknown as CharactersJson);
  ActorPlayHitVoice({ charType: 1 }, ActorVoice.Attack, rng, say);
  check("an older bundle with no `attack` is silent, not broken",
        heard.length === 0, JSON.stringify(heard));
}

console.log("\nthe shot effects:");
{
  const rng = new Rng(26);
  const events = scene(1, rng);
  SetGameTables({
    ...CHARS,
    combat: {
      blood_scale: { "1": 0.75, "2": 0.5, "3": 1.0 },
      impact_sprite: { "3": [0x0e25, 0x0e33, 1.0] },
      impact_sprite_default: [0x0904, 0x0904, 0.1],
      ricochet: {},
      // The shot voice is raised from `ActorShotFeedback` now, so this fixture
      // needs the table it reads. One id per row, so which row fired is the
      // number that comes out.
      impact: [{ id: 1, file: "" }],
      head_impact: [{ id: 2, file: "" }],
      voice: {
        hurt: [{ id: 10, file: "" }, { id: 11, file: "" }],
        kill: [{ id: 20, file: "" }, { id: 21, file: "" }],
        head: [{ id: 30, file: "" }, { id: 31, file: "" }],
        attack: [[{ id: 40, file: "" }], [{ id: 50, file: "" }]],
      },
      voice_set_a_types: [0],
    },
  } as unknown as CharactersJson);
  const z0 = G.g_object_list[0]!;
  z0.hp = 100;

  let pick: ShotPick | null = null;
  const host = {
    ...NULL_HOST,
    pickShot: () => pick,
    viewPoint: (x: number, y: number, z: number,
                out: { x: number; y: number; z: number }) => {
      out.x = x; out.y = y; out.z = -z;
    },
    viewSpaceOfPoint: (p: { x: number; y: number; z: number },
                       out: { x: number; y: number; z: number }) => {
      out.x = p.x; out.y = p.y; out.z = -p.z;
      return true;
    },
  };
  const RAY = { origin: vec3(0, 0, 0), dir: vec3(0, 0, 1) };

  // -- the muzzle, on a miss ------------------------------------------------
  pick = null;
  QueueShotRequest(0, RAY);
  GameUpdate(EYE, 1 / 60, host, rng, events);
  const flash = G.g_shot_flash_ring[0]!;
  const tracer = G.g_shot_tracer_ring[0]!;
  check("a shot that hits nothing still lights the muzzle", flash.live);
  check("...and still throws a tracer", tracer.live);
  check("the muzzle point is the crosshair at camera-space z = -1",
        Math.abs(flash.pos.z + 1) < 1e-6, `${flash.pos.z}`);
  check("the tracer flies twenty units a frame",
        Math.abs(Math.hypot(tracer.vel.x, tracer.vel.y, tracer.vel.z) - 20)
          < 1e-4, `${tracer.vel.z}`);
  check("nothing was hit, so the tracer is not cut short",
        G.g_shot_hit_something[0] === 0);
  check("the ring cursor moved on", G.g_shot_effect_cursor[0] === 1);

  // The flash is nine frames and the tracer sixty, counted the way the engine
  // counts them: the frame steps whether or not the record is live.
  for (let i = 0; i < FLASH_LAST_FRAME + 1; i++) ShotEffectsTick();
  check("the muzzle flash is nine frames", !flash.live && tracer.live,
        `flash ${flash.frame}, tracer ${tracer.frame}`);
  for (let i = 0; i < TRACER_LAST_FRAME; i++) ShotEffectsTick();
  check("...and the tracer sixty", !tracer.live, `${tracer.frame}`);

  // -- a hit cuts the tracer on its second frame ---------------------------
  pick = { kind: "actor", at: z0.at, bone: 1, point: vec3(0, 0, 10) };
  QueueShotRequest(0, RAY);
  GameUpdate(EYE, 1 / 60, host, rng, events);
  check("a hit raises `g_shot_hit_something`", G.g_shot_hit_something[0] === 1);
  const hitTracer = G.g_shot_tracer_ring[1]!;
  check("the round is in the air on the frame it was fired", hitTracer.live);
  ShotEffectsTick();
  check("...and gone on the next, because it hit something",
        !hitTracer.live, `frame ${hitTracer.frame}`);

  // -- the ring wraps at six -----------------------------------------------
  G.g_shot_effect_cursor[0] = SHOT_EFFECT_RING - 1;
  pick = null;
  QueueShotRequest(0, RAY);
  GameUpdate(EYE, 1 / 60, host, rng, events);
  check("the six-deep ring wraps rather than growing",
        G.g_shot_effect_cursor[0] === 0, `${G.g_shot_effect_cursor[0]}`);
  check("no weapon record without an Original Mode weapon",
        G.g_shot_weapon_ring.every((w) => !w.live)
        && G.g_original_weapon_kind[0] === OriginalWeaponKind.Standard);

  // -- the blood is at the bone, and it is a flipbook -----------------------
  G.g_blood_sprays = [];
  G.g_sprite_effects = [];
  G.g_hit_result = HitResultCode.Plain;
  ActorShotFeedback(z0, 4, vec3(1, 2, 3), host, rng, events);
  const spray = G.g_blood_sprays[0]!;
  check("a plain hit bleeds", G.g_blood_sprays.length === 1);
  check("...and the spray holds an actor and a bone, not a position",
        spray.at === z0.at && spray.bone === 4);
  check("...at the plain-damage severity", spray.severity === 0.5,
        `${spray.severity}`);
  check("...and it makes no sprite of its own",
        G.g_sprite_effects.length === 0);

  let cels = 0;
  while (G.g_blood_sprays.length) { ShotEffectsTick(); cels++; }
  check("the spray runs twenty-five models, one a frame",
        cels === BLOOD_LAST_CEL + 1, `${cels}`);
  check("...starting at the first of them", BLOOD_FIRST_SLOT === 0x3a);

  G.g_hit_result = HitResultCode.Damaged;
  ActorShotFeedback(z0, 4, vec3(), host, rng, events);
  check("a hit that swapped the part bleeds harder, not less",
        G.g_blood_sprays[0]!.severity === 0.75);
  G.g_blood_sprays = [];

  // -- the voice kind is the hit-result code, and nothing else --------------
  //
  // `[proved]` from two routines that agree, which is what makes this a rule
  // and not one function's habit. `ZombieOnShot` (`FUN_00453EB0`):
  //
  //   00453f46  TEST dword ptr [ESI + 0x34], 0x4000000   ; Dead?
  //   00453f6e  CMP  EAX, 0x2      ; g_hit_result -- dead and 2 -> kind 2
  //   00453f77  PUSH 0x1           ; dead and anything else -> kind 1
  //   00454025  CMP  EAX, 0x5      ; alive and not 5 -> kind 0
  //
  // and `ThrowerOnShot` (`FUN_004499A0`) is the same two instructions with the
  // same two constants at 0x00449A76, 0x00449A7B and 0x00449A88. **Neither
  // tests the bone and neither tests whether the actor died of this shot** --
  // which is what `render/shooting.ts`'s copy keyed on, so these five checks
  // are the behaviour change the move carried. Every one of them fails on the
  // old `killed ? (head ? "head" : "kill") : "hurt"` mapping.
  const voiced: number[] = [];
  const ear = new Events();
  ear.on("sound.play", (d) => voiced.push(d.id));
  // Named explicitly rather than by a range: the ricochet this routine also
  // emits is `0x1116A9`, and a `>= 10` filter swallowed it and turned the
  // result-5 check green on a sound that is not a voice at all.
  const VOICE_IDS = [10, 11, 20, 21, 30, 31, 40, 50];
  const impactOf = (xs: number[]) => xs.filter((id) => id === 1 || id === 2);
  const lineOf = (xs: number[]) => xs.filter((id) => VOICE_IDS.includes(id));
  z0.charType = 0;                      // set A, per `voice_set_a_types`
  z0.flags &= ~(ActorFlag.Dead | ActorFlag.ShotImmune);

  // Alive: kind 0, whatever the bone was. Bone 2 is the head.
  voiced.length = 0;
  G.g_hit_result = HitResultCode.Damaged;
  ActorShotFeedback(z0, 2, vec3(), host, rng, ear);
  check("a live actor shot in the head still says hurt",
        lineOf(voiced).length === 1 && lineOf(voiced)[0] === 10,
        JSON.stringify(voiced));
  check("...with a body impact, not a head one",
        impactOf(voiced).length === 1 && impactOf(voiced)[0] === 1,
        JSON.stringify(voiced));

  // Dead and result 2: kind 2 -- and it is the *result*, not the bone.
  voiced.length = 0;
  z0.flags |= ActorFlag.Dead;
  G.g_hit_result = HitResultCode.Plain;
  ActorShotFeedback(z0, 4, vec3(), host, rng, ear);
  check("result 2 on a dead actor is kind 2, off a shot to the leg",
        lineOf(voiced).length === 1 && lineOf(voiced)[0] === 30,
        JSON.stringify(voiced));
  check("...and kind 2's tell is the head impact table",
        impactOf(voiced).length === 1 && impactOf(voiced)[0] === 2,
        JSON.stringify(voiced));

  // Dead and anything else: kind 1 -- including a shot to the head.
  voiced.length = 0;
  G.g_hit_result = HitResultCode.Damaged;
  ActorShotFeedback(z0, 2, vec3(), host, rng, ear);
  check("a head shot that kills is kind 1, because the result is 1",
        lineOf(voiced).length === 1 && lineOf(voiced)[0] === 20
        && impactOf(voiced)[0] === 1, JSON.stringify(voiced));

  // The two gates that silence it: `obj+0x34` bit 0x100 jumps the whole
  // routine (0x00453ec7), and the live arm refuses result 5 (0x00454025).
  voiced.length = 0;
  z0.flags &= ~ActorFlag.Dead;
  G.g_hit_result = HitResultCode.NoEffect;
  ActorShotFeedback(z0, 2, vec3(), host, rng, ear);
  check("a result-5 hit on a live actor has no voice, only the ricochet",
        lineOf(voiced).length === 0, JSON.stringify(voiced));

  voiced.length = 0;
  z0.flags |= ActorFlag.Dead | ActorFlag.ShotImmune;
  G.g_hit_result = HitResultCode.Plain;
  ActorShotFeedback(z0, 2, vec3(), host, rng, ear);
  check("a shot-immune body is silent even on the dead arm",
        lineOf(voiced).length === 0, JSON.stringify(voiced));

  // The bursting head shouts, which it did not while the voice tables were in
  // `render/`: `00454133 PUSH 0x3` / `00454136 CALL 0x0040a6f0`, inside
  // `ActorShotFeedback` itself rather than in its caller.
  voiced.length = 0;
  z0.flags &= ~(ActorFlag.Dead | ActorFlag.ShotImmune);
  z0.boneSlot["2"] = 0x1dc2;
  G.g_hit_result = HitResultCode.Damaged;
  ActorShotFeedback(z0, 2, vec3(), host, rng, ear);
  check("the head that bursts cries out, out of set A's attack pair",
        voiced.includes(40), JSON.stringify(voiced));
  delete z0.boneSlot["2"];
  z0.flags &= ~(ActorFlag.Dead | ActorFlag.ShotImmune);
  G.g_blood_sprays = [];
  G.g_sprite_effects = [];

  // -- result 5 is a ricochet, and it is not blood --------------------------
  G.g_hit_result = HitResultCode.NoEffect;
  ActorShotFeedback(z0, 4, vec3(0, 0, -30), host, rng, events);
  check("a result-5 hit draws no blood at all",
        G.g_blood_sprays.length === 0);
  const ric = G.g_sprite_effects[0]!;
  check("...it ricochets instead", G.g_sprite_effects.length === 1
        && ric.kind === SpriteEffectKind.Other);
  check("...through the kind's own slot range, from the bundle",
        ric.slot === 0x0e25 && ric.lastSlot === 0x0e33,
        `${ric.slot.toString(16)}..${ric.lastSlot.toString(16)}`);

  let frames = 0;
  while (G.g_sprite_effects.length) { ShotEffectsTick(); frames++; }
  check("a sprite effect is one model a frame and no more",
        frames === 0x0e33 - 0x0e25 + 1, `${frames}`);

  // -- the distance law replaces the base scale, it does not multiply -------
  SpawnSpriteEffect(vec3(0, 0, 5), 0, 0, SpriteEffectKind.Other, 0, 0, host);
  check("an impact five units away is scaled by its depth, not by 1.0",
        Math.abs(G.g_sprite_effects[0]!.scale.x - 5 * 0.0667) < 1e-6,
        `${G.g_sprite_effects[0]!.scale.x}`);
  G.g_sprite_effects = [];
  SpawnSpriteEffect(vec3(0, 0, 100), 0, 0, SpriteEffectKind.Other, 0, 0, host);
  check("...and one a hundred units away keeps the kind's own",
        G.g_sprite_effects[0]!.scale.x === 1.0,
        `${G.g_sprite_effects[0]!.scale.x}`);
  G.g_sprite_effects = [];

  // The pools are plain data, which is the whole reason they are in `G`.
  SpawnBloodSpray(z0.at, 2, 1);
  const copy = JSON.parse(JSON.stringify(G.g_blood_sprays));
  check("every effect pool survives a round trip through JSON",
        copy[0].at === z0.at && copy[0].bone === 2);
  G.g_blood_sprays = [];
}



// -- 40. the firing gate: a shutter that is shut is a trigger that is dead ---

/**
 * **`g_nFiringGate` (`0x009C8E00`), and what a blocked trigger does not do.**
 *
 * Reported as "shouldn't be able to shoot while the shutter is closed", and
 * the port had every piece of it but the one that mattered: the shutter
 * machine drove the gate, the walker exposed it, the save state carried it and
 * `canSkip` read it — and the shot path did not look at it at all.
 *
 * The engine's rule is `PlayerFireAndReloadUpdate`'s (`FUN_00414940`), whose
 * fire block sits under `else if (g_nFiringGate != 0)` at 0x004149BE. That is
 * one test above **everything**: the ammo decrement, the shot counter,
 * `BuildShotRay`, `PlayerShotEffectSpawn` and the gunshot. So a blocked
 * trigger is not "a shot that hits nothing" — it is not a shot. The muzzle
 * flash and the tracer are the visible half of that and they are what these
 * assertions watch, because a gate applied one line too late would still light
 * them.
 *
 * The polarity is the other half, and the reason it is asserted rather than
 * assumed: state 0 is *"close, and enable firing"*, which reads backwards. It
 * is not backwards — `HudDrawShutterState` (`FUN_00413970`) draws the closed
 * bars in state 0 and writes the word 1, so a letterboxed boss intro still
 * lets you shoot, and state 5 draws exactly the same bars and writes 0.
 *
 * The port has no ammo, so the counter the engine keeps *inside* the gate and
 * this file can watch is `g_nPlayerFired`. When a magazine arrives it belongs
 * under the same test, above `PlayerShotEffectSpawn`.
 */
console.log("\nthe firing gate:");
{
  const rng = new Rng(40);
  const events = scene(1, rng);
  const z0 = G.g_object_list[0]!;
  z0.hp = 100;
  let pick: ShotPick | null = { kind: "actor", at: z0.at, bone: 1,
                                point: vec3() };
  // The camera stubs are `PlayerShotEffectSpawn`'s: the muzzle point and the
  // tracer's aim are camera-space, so without them nothing leaves the gun and
  // the assertion that a *blocked* trigger lights nothing would pass for the
  // wrong reason. Same two lines as the shot-effects section above.
  const host = {
    ...NULL_HOST,
    pickShot: () => pick,
    viewPoint: (x: number, y: number, z: number,
                out: { x: number; y: number; z: number }) => {
      out.x = x; out.y = y; out.z = -z;
    },
    viewSpaceOfPoint: (p: { x: number; y: number; z: number },
                       out: { x: number; y: number; z: number }) => {
      out.x = p.x; out.y = p.y; out.z = -p.z;
      return true;
    },
  };
  const RAY = { origin: vec3(0, 0, 0), dir: vec3(0, 0, 1) };
  const resolved: string[] = [];
  events.on("shot.resolved", (r) => resolved.push(r.kind));

  const shutter = new Shutter();

  // -- the gate is down out of `ResetSceneOnEnter` --------------------------
  ResetSceneOnEnter();
  check("a scene starts with the gate down, as `ResetSceneOnEnter` leaves it",
        G.g_nFiringGate === 0, `${G.g_nFiringGate}`);

  // -- a trigger pull under a closed shutter --------------------------------
  const scoreBefore = G.g_player_score[0];
  QueueShotRequest(0, RAY);
  check("the click is still recorded as input", G.g_shot_requests.length === 1);
  GameUpdate(EYE, 1 / 60, host, rng, events);
  check("...and the frame takes it off the queue rather than holding it",
        G.g_shot_requests.length === 0);
  check("a trigger pulled with the gate down resolves nothing",
        resolved.length === 0, resolved.join(","));
  check("...it is not counted as a shot fired", G.g_nPlayerFired[0] === 0,
        `${G.g_nPlayerFired[0]}`);
  check("...it scores nothing", G.g_player_score[0] === scoreBefore);
  check("...the actor it was aimed at is untouched", z0.hp === 100,
        `${z0.hp}`);
  // The distinguishing assertion. `PlayerShotEffectSpawn` (`FUN_00416F70`) is
  // called from *inside* the gated block, so a blocked trigger makes no muzzle
  // flash and no tracer -- which is what separates "the gate is on the trigger"
  // from "the gate is on the hit test".
  check("...and nothing left the gun: no muzzle flash, no tracer",
        !G.g_shot_flash_ring.some((f) => f.live)
        && !G.g_shot_tracer_ring.some((t) => t.live));

  // -- and it does not fire late once the gate comes up ---------------------
  shutter.set(6);        // `hud_shutter_state 6` -- open at once, gate on
  check("state 6 raises the gate", G.g_nFiringGate === 1);
  GameUpdate(EYE, 1 / 60, host, rng, events);
  check("the blocked pull does not fire late", resolved.length === 0,
        resolved.join(","));

  // -- the same pull with the gate up ---------------------------------------
  QueueShotRequest(0, RAY);
  GameUpdate(EYE, 1 / 60, host, rng, events);
  check("with the gate up the same shot lands", resolved.at(-1) === "actor",
        resolved.join(","));
  check("...and now it is a shot fired", G.g_nPlayerFired[0] === 1,
        `${G.g_nPlayerFired[0]}`);
  check("...and the muzzle is lit",
        G.g_shot_flash_ring.some((f) => f.live)
        && G.g_shot_tracer_ring.some((t) => t.live));
  check("...and the actor took the hit", z0.hp < 100, `${z0.hp}`);

  // -- the polarity, state by state, from `HudDrawShutterState` -------------
  // The five states that write the word, and only those five. 2, 4, 7 and 8
  // leave it alone, which is why they are not in `SHUTTER_GATE`.
  shutter.set(5);
  check("state 5 drops the gate at once -- a closed shutter, firing off",
        G.g_nFiringGate === 0);
  shutter.set(0);
  check("state 0 draws the same closed bars and RAISES it",
        G.g_nFiringGate === 1);
  shutter.set(2);
  check("state 2 leaves it alone", G.g_nFiringGate === 1);
  shutter.set(5);
  shutter.set(1);
  check("state 1 raises it on the way open", G.g_nFiringGate === 1);

  // -- state 3 drops it only when the close finishes ------------------------
  shutter.set(3);
  check("a state-3 close keeps the gate up while it is still sliding",
        G.g_nFiringGate === 1);
  const before = G.g_nPlayerFired[0];
  QueueShotRequest(0, RAY);
  GameUpdate(EYE, 1 / 60, host, rng, events);
  check("...so a shot in the middle of a close still fires",
        G.g_nPlayerFired[0] === before + 1,
        `${before} -> ${G.g_nPlayerFired[0]}`);
  shutter.step(SHUTTER_FRAMES);
  check("...and the gate drops the frame the bars meet",
        G.g_nFiringGate === 0 && shutter.state === 4,
        `gate ${G.g_nFiringGate}, state ${shutter.state}`);
  const after = G.g_nPlayerFired[0];
  QueueShotRequest(0, RAY);
  GameUpdate(EYE, 1 / 60, host, rng, events);
  check("...and the next pull is dead", G.g_nPlayerFired[0] === after,
        `${G.g_nPlayerFired[0]}`);

  // -- one word, not two ----------------------------------------------------
  // The gate is in `G` and `Shutter.firingGate` -- which is what `Walker`
  // exposes under that name -- is a view onto it, so the script's idea of the
  // gate and the port's cannot disagree. Two owners of one word is how the
  // shutter's slide counter went wrong once already.
  shutter.firingGate = true;
  check("the script's accessor and `G.g_nFiringGate` are the same word",
        G.g_nFiringGate === 1 && shutter.firingGate);
  G.g_nFiringGate = 0;
  check("...in both directions", !shutter.firingGate);
}

/**
 * `wait_script_flag` (0x45) is a **gameplay** gate, and `g_script_flags` is
 * one array.
 *
 * `EvtOpWaitScriptFlag45` (`FUN_0045FC80`) tests `g_script_flags[operand]` and
 * `EvtOpSetScriptFlag48` (`FUN_0045FD70`) is the single line that sets one —
 * on the same 0x100-byte array at `0x009C7200` that `CivilianRunScript`'s op
 * 0x1C (`0x0048BF2A`) and `ZombieStateTargetScriptWithFlag` (`0x0045B1DF`)
 * also write. Across the six shipped scripts **every one of the forty-odd
 * gates names a flag that script's own `set_script_flag` never sets**, so the
 * opcode is only ever "hold until an actor is finished".
 *
 * The port had two stores: a `Set` on the walker that `set_script_flag` wrote
 * and `wait_script_flag` read, and `G.g_script_flags` that gameplay wrote —
 * and `syncPortGlobals` rebuilt the second from the first once a frame, so a
 * flag an actor raised lasted until the next tick and no gate could ever see
 * it. Stage 3 block 2 step 3's `wait_script_flag 0x1E` is what that cost: the
 * hostage raises flag 30 from her own stream (rescued, command 17; shot or
 * mauled, command 12 of the on-shot stream), the wait passed on the frame it
 * was reached, and step 4's boat shot sailed past her and her captor while
 * the maul was still running. `docs/BUGS.md`, "the civilian/enemy are jumped
 * over".
 *
 * Asserted here on the world rather than on a layer's opinion of itself: a
 * real class-0x10 actor in `G.g_object_list` with a real captor, driven by
 * `CivilianUpdate`, against the walker's own address — and with
 * `syncPortGlobals` running every frame, because that is the call that used to
 * wipe the evidence.
 */
console.log("\n`wait_script_flag` holds for the actor that raises the flag:");
{
  /** The flag stage 3 block 2 step 3 waits on. */
  const RESCUE_FLAG = 30;
  const flagOp = (i: number, op: number, arg: number) => ({
    i, at: i, op, arg, flag: arg,
    name: op === 0x45 ? "wait_script_flag" : "set_script_flag",
    cat: op === 0x45 ? "wait" : "flow",
    blocks_on: `script flag ${arg} set`,
  });
  const script = {
    scene: 0, stage: 3, game_mode: 0, evt_file: "test", entry_block: 0,
    entry_step: 0, routes: [{ kind: "end", next: [-1, -1, -1] }],
    regions: [], cam_slots_used: [], warnings: [],
    blocks: [{
      index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
      steps: [{ index: 0, at: 0, ops: [
        flagOp(0, 0x45, RESCUE_FLAG),
        // Somewhere past the gate, and a second flag so "did it advance" is a
        // fact about the array rather than about the cursor alone.
        flagOp(1, 0x48, 7),
      ] }],
    }],
  } as unknown as ScriptJson;

  ResetGameGlobals();
  SetGameTables(CHARS, undefined, undefined, undefined, undefined, {
    entries: [0],
    // The shape of the shipped stream 64, which is the one the hostage at
    // script address 12808 runs: a wait word leads its block and governs the
    // wait at the **end** of it, so `ChildrenAlive` here parks the VM on
    // command 2 until the captor is down, and the flag is raised by the block
    // that release runs.
    scripts: [[
      { op: CivilianOp.Wait, args: [CivilianWait.ChildrenAlive] },
      { op: CivilianOp.SetChildrenGoal, args: [0] },
      // A word of 0 is "park here": it is what stops the step loop walking
      // straight past this block, which would run the reapply walk and skip
      // the flag. Every one of the 136 shipped streams ends on one.
      { op: CivilianOp.Wait, args: [0] },
      { op: CivilianOp.SetScriptFlag, args: [RESCUE_FLAG] },
      { op: CivilianOp.Wait, args: [0] },
      { op: CivilianOp.End, args: [] },
    ]],
    items: [],
    spawns: {
      "16384": {
        charType: 1, script: 0, removePath: -1, removeFrame: 0,
        removeDelay: 0,
        children: [{ at: 0x4100, class: 0x30, charType: 1,
                     pos: [0, 0, 0] as [number, number, number],
                     yaw: 0, hp: 1 }],
      },
    },
  });

  const rng = new Rng(11);
  const events = new Events();
  const captor = spawnZombie(0x4100, 1, "captor");
  captor.visible = true;
  const civ = ActorSpawn(0x4000, SpawnClass.Civilian, 1, "hostage",
                         undefined, rng);
  civ.visible = true;
  civ.pos = vec3(0, 0, 0);

  const host = {
    enterRegion: () => undefined, loadSlot: () => undefined,
    unloadSlot: () => undefined, startCamera: () => undefined,
    onFeed: () => undefined, onBranch: () => undefined,
    playSound: () => undefined, aliveEnemies: () => null,
    presentEnemies: () => null, aliveCivilians: () => null,
    // The player's host, which is the one under test: it answers out of the
    // same array the civilian writes.
    scriptFlagRaised: (i: number) => (G.g_script_flags[i] ?? 0) !== 0,
    cameraFree: () => null,
    showMessage: () => null, endDialogue: () => undefined,
  };
  const w = new Walker(script, host);

  /** One whole frame of the player: walker, globals sync, then the port. */
  const frame = () => {
    w.tick(1 / 60);
    syncPortGlobals(w, false, EYE);
    CivilianUpdate(civ, { eye: EYE, dt: 1 / 60, rng, host: NULL_HOST, events });
  };

  for (let i = 0; i < 30; i++) frame();
  check("the hostage and her captor are both in the pool",
        ActorByAt(0x4000)?.cls === SpawnClass.Civilian
        && ActorByAt(0x4100)?.cls === SpawnClass.Zombie
        && !ActorByAt(0x4100)?.dead,
        `civ ${ActorByAt(0x4000)?.cls} captor ${ActorByAt(0x4100)?.cls}`);
  check("...and the script is still parked on the gate 30 frames in",
        w.opIndex === 0 && w.wait?.op.op === 0x45,
        `at ${w.block}/${w.step}/${w.opIndex} wait ${w.wait?.op.op}`);
  check("...with the flag it names still down",
        (G.g_script_flags[RESCUE_FLAG] ?? 0) === 0,
        `${G.g_script_flags[RESCUE_FLAG]}`);

  // The rescue: the captor dies, the civilian's own stream runs on and raises
  // the flag. Nothing else in the fixture can raise it.
  captor.dead = true;
  frame();
  check("killing the captor lets her stream raise the flag",
        (G.g_script_flags[RESCUE_FLAG] ?? 0) === 1,
        `${G.g_script_flags[RESCUE_FLAG]} children ${civ.civ?.childCount}`);
  for (let i = 0; i < 5; i++) frame();
  check("...and it is still raised five `syncPortGlobals` calls later",
        (G.g_script_flags[RESCUE_FLAG] ?? 0) === 1,
        `${G.g_script_flags[RESCUE_FLAG]}`);
  // Past the gate the block has no more steps, so the walker has routed on —
  // `0/1/0` is the address it ends at, not the gate it was parked on.
  check("...and the script is off the gate",
        w.wait === null && !(w.step === 0 && w.opIndex === 0),
        `at ${w.block}/${w.step}/${w.opIndex} wait ${w.wait?.op.op}`);
  check("...having run the instruction behind it into the same array",
        (G.g_script_flags[7] ?? 0) === 1, `${G.g_script_flags[7]}`);

  // The escape hatch, pinned. **`[diverges]`**: a gate on a flag nothing this
  // port runs can raise passes, because a faithful one would park the stage on
  // it for ever. The boundary is *derived*, so this is a check on the
  // derivation and not on a list of numbers: the same fixture, one flag
  // nothing in it can raise.
  //
  // The example is still **flag 20**, but the reason it is unraisable here has
  // changed and is now a sharper one. It used to be that class 0x41's
  // `FUN_004710C0` had no module at all; `class41/flag_prop.ts` ports it, and
  // the block above watches it raise the flag three different ways. What
  // makes it unraisable *in this bundle* is that this script places no
  // class-0x41 record at the type-75 placement — which is exactly the
  // per-record declaration `ClassHandler.raisesScriptFlag` was widened for. A
  // class-wide number would have put 20 in this set the moment any prop
  // appeared, and this assertion is what would have caught that.
  //
  // (248 expired as an example when `game/class60/` was written. The flags
  // with no port left are class 0x14's, 0x19's and 0x22's, and class 0x32's
  // 30 — which is `RESCUE_FLAG` in this fixture, so it cannot stand in here.)
  const canRaise = ScriptFlagsThisBundleCanRaise(script);
  check("the coverage set is the civilian's own flag and the script's own",
        canRaise.has(RESCUE_FLAG) && canRaise.has(7) && !canRaise.has(20),
        `${[...canRaise].sort((a, b) => a - b).join(",")}`);
  {
    ResetGameGlobals();
    const unraisable = {
      ...script,
      blocks: [{
        index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
        steps: [{ index: 0, at: 0, ops: [flagOp(0, 0x45, 20)] }],
      }],
    } as unknown as ScriptJson;
    const w3 = new Walker(unraisable, host);
    for (let i = 0; i < 10; i++) w3.tick(1 / 60);
    check("...and a gate on a flag nothing in the bundle raises does not park",
          w3.wait === null && !(w3.step === 0 && w3.opIndex === 0),
          `at ${w3.block}/${w3.step}/${w3.opIndex} wait ${w3.wait?.op.op}`);
  }

  // A seek observes no waits, so the gate's postcondition has to be applied
  // by hand — the same argument as `retires` and `skipRunsCameraOn`. Without
  // it a reload lands past a gate whose flag is still 0, and everything that
  // reads the array (class 0x24's removal cue, 0x30's states 20 and 31,
  // 0x31's cue conditions, 0x52's despawn) sees a world the address does not
  // describe.
  ResetGameGlobals();
  const w2 = new Walker(script, host);
  seekTo(w2, 0, 0, 1);
  check("a seek over the gate leaves the flag it was waiting for raised",
        (G.g_script_flags[RESCUE_FLAG] ?? 0) === 1,
        `${G.g_script_flags[RESCUE_FLAG]}`);
}

/**
 * `spawn_simple` (0x0A), and the two cards it places that open a gate.
 *
 * Twelve of the game's sixty-one `wait_script_flag` gates name flag 248 or
 * flag 254, and both are raised by an actor `EvtOpSpawnSimple0A`
 * (`FUN_00408990`) places — the chapter card (class 0x60, `FUN_004342E0`) and
 * the stage-clear card (class 0x61, `FUN_00434EF0`). Neither existed in this
 * port: opcode 0x0A had no handler, so the actor was never built, so the flag
 * was never raised, and `wait_script_flag` had to be excused from evaluating
 * those gates rather than park every stage on its title card.
 *
 * Asserted on the world, not on the opcode's opinion of itself: a real actor
 * in `G.g_object_list` with the class the record names, driven frame by frame,
 * against the walker's own address on the gate behind it.
 */
console.log("\n`spawn_simple` builds the cards, and the cards open the gate:");
{
  const simpleOp = (i: number, cls: number) => ({
    i, at: 0x100 + i * 8, op: 0x0a, name: "spawn_simple", cat: "spawn",
    simple: [{ class: cls, hp: 0 }],
  });
  const waitOp = (i: number, flag: number) => ({
    i, at: 0x100 + i * 8, op: 0x45, name: "wait_script_flag", cat: "wait",
    arg: flag, blocks_on: `script flag ${flag} set`,
  });
  const cardScript = (cls: number, flag: number) => ({
    scene: 0, stage: 1, game_mode: 0, evt_file: "test", entry_block: 0,
    entry_step: 0, routes: [{ kind: "end", next: [-1, -1, -1] }],
    regions: [], cam_slots_used: [], warnings: [],
    blocks: [{
      index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
      steps: [{ index: 0, at: 0, ops: [
        simpleOp(0, cls),
        waitOp(1, flag),
        { i: 2, at: 0x120, op: 0x48, name: "set_script_flag", cat: "flow",
          flag: 9 },
      ] }],
    }],
  } as unknown as ScriptJson);

  const cardHost = {
    enterRegion: () => undefined, loadSlot: () => undefined,
    unloadSlot: () => undefined, startCamera: () => undefined,
    onFeed: () => undefined, onBranch: () => undefined,
    playSound: () => undefined, aliveEnemies: () => null,
    presentEnemies: () => null, aliveCivilians: () => null,
    scriptFlagRaised: (i: number) => (G.g_script_flags[i] ?? 0) !== 0,
    cameraFree: () => null,
    showMessage: () => null, endDialogue: () => undefined,
  };

  /** Drive one card to its flag and report how many frames it took. */
  const runCard = (cls: SpawnClass, flag: number, expect: number) => {
    ResetGameGlobals();
    SetGameTables(CHARS);
    const script = cardScript(cls, flag);
    const w = new Walker(script, cardHost);
    // The instruction, and nothing else: `SpawnSimpleActors` runs from the
    // opcode rather than from a later frame, which is what makes a seek build
    // the card at all.
    w.tick(1 / 60);
    const live = G.g_object_list.filter((o) => !o.despawned && !o.dead);
    const card = live.find((o) => o.cls === cls);
    check(`0x${cls.toString(16)}: the record puts one actor of its own class `
          + "in the pool",
          live.length === 1 && card !== undefined
          && w.simpleSpawns.length === 1,
          `${live.map((o) => `c${o.cls}`).join(",")} `
          + `list ${w.simpleSpawns.length}`);
    check("...at a key no placement descriptor could collide with",
          (card?.at ?? 0) < 0, `at ${card?.at}`);
    check("...and the walker is parked on the gate it raises",
          w.wait?.op.op === 0x45 && w.opIndex === 1
          && (G.g_script_flags[flag] ?? 0) === 0,
          `at ${w.block}/${w.step}/${w.opIndex} wait ${w.wait?.op.op}`);

    // Counted in **updates**, because that is what the countdown counts: the
    // card is built by the instruction and its first decrement is on its first
    // update, not on the frame the walker placed it.
    //
    // Bails when there is no card rather than dereferencing one: with opcode
    // 0x0A unwired there is nothing to drive, and a suite that throws reports
    // one crash where it should report which assertions the work is holding up.
    if (!card) return { frames: -1, card: null };
    let updates = 0;
    const f = { eye: EYE, dt: 1 / 60, rng: new Rng(3), host: NULL_HOST };
    while (updates < expect + 60 && (G.g_script_flags[flag] ?? 0) === 0) {
      g_class_handlers[cls]?.update(card, f);
      updates += 1;
      w.tick(1 / 60);
    }
    return { frames: updates, card };
  };

  // The chapter card: `MOV word ptr [ESI+0x11c], 0xb4` at `0x004345AB`, then
  // one decrement a frame and the flag on the frame it reads zero.
  {
    const { frames, card } = runCard(SpawnClass.ChapterCard,
                                     CHAPTER_CARD_FLAG, CHAPTER_CARD_FRAMES);
    check(`the chapter card holds ${CHAPTER_CARD_FRAMES} frames, then raises `
          + `g_script_flags[${CHAPTER_CARD_FLAG}]`,
          frames === CHAPTER_CARD_FRAMES
          && G.g_script_flags[CHAPTER_CARD_FLAG] === 1,
          `${frames} frames, flag ${G.g_script_flags[CHAPTER_CARD_FLAG]}`);
    check("...and kills itself on the same frame",
          card?.dead === true, `dead ${card?.dead}`);
  }

  // The result card: 420 frames, and it drops the trigger on its first.
  {
    ResetGameGlobals();
    SetGameTables(CHARS);
    G.g_nFiringGate = 1;
    const w = new Walker(cardScript(SpawnClass.ResultCard, RESULT_CARD_FLAG),
                         cardHost);
    w.tick(1 / 60);
    const card = G.g_object_list.find((o) => o.cls === SpawnClass.ResultCard);
    const f = { eye: EYE, dt: 1 / 60, rng: new Rng(3), host: NULL_HOST };
    if (card) g_class_handlers[SpawnClass.ResultCard]?.update(card, f);
    check("the result card drops `g_nFiringGate` on its first frame",
          card !== undefined && G.g_nFiringGate === 0,
          `card ${card !== undefined} gate ${G.g_nFiringGate}`);
    let frames = 1;
    while (card && frames < RESULT_CARD_FRAMES + 60
           && (G.g_script_flags[RESULT_CARD_FLAG] ?? 0) === 0) {
      g_class_handlers[SpawnClass.ResultCard]?.update(card, f);
      frames += 1;
      w.tick(1 / 60);
    }
    check(`...holds ${RESULT_CARD_FRAMES} frames, then raises `
          + `g_script_flags[${RESULT_CARD_FLAG}]`,
          frames === RESULT_CARD_FRAMES
          && G.g_script_flags[RESULT_CARD_FLAG] === 1,
          `${frames} frames, flag ${G.g_script_flags[RESULT_CARD_FLAG]}`);
    check("...and the gate behind it opens, so the script runs on",
          w.wait === null && !(w.step === 0 && w.opIndex === 1)
          && (G.g_script_flags[9] ?? 0) === 1,
          `at ${w.block}/${w.step}/${w.opIndex} `
          + `wait ${w.wait?.op.op} flag9 ${G.g_script_flags[9]}`);
  }

  // ...and the coverage set now says so, which is the half that decides
  // whether the gate is evaluated at all. Both directions: a stage that
  // spawns the card can open its flag, one that does not, cannot.
  {
    ResetGameGlobals();
    SetGameTables(CHARS);
    const withCard = ScriptFlagsThisBundleCanRaise(
      cardScript(SpawnClass.ChapterCard, CHAPTER_CARD_FLAG));
    check("a stage that spawns the chapter card can raise its flag",
          withCard.has(CHAPTER_CARD_FLAG) && !withCard.has(RESULT_CARD_FLAG),
          `${[...withCard].sort((a, b) => a - b).join(",")}`);
    const withTally = ScriptFlagsThisBundleCanRaise(
      cardScript(SpawnClass.ResultCardTally, CHAPTER_CARD_FLAG));
    check("...and one that spawns only class 0x62, which raises nothing, "
          + "cannot",
          !withTally.has(CHAPTER_CARD_FLAG),
          `${[...withTally].sort((a, b) => a - b).join(",")}`);
  }

  // Two records on one instruction are two objects. `EvtOpSpawnSimple0A`
  // walks its list to the -1 and allocates per operand; the exporter does not
  // collapse duplicates, because stage 3's block 11 lists one twice.
  {
    ResetGameGlobals();
    SetGameTables(CHARS);
    const two = {
      ...cardScript(SpawnClass.ChapterCard, CHAPTER_CARD_FLAG),
      blocks: [{
        index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
        steps: [{ index: 0, at: 0, ops: [{
          i: 0, at: 0x200, op: 0x0a, name: "spawn_simple", cat: "spawn",
          simple: [{ class: SpawnClass.ResultCardTally, hp: 0 },
                   { class: SpawnClass.ResultCardTally, hp: 0 }],
        }] }],
      }],
    } as unknown as ScriptJson;
    const w = new Walker(two, cardHost);
    w.tick(1 / 60);
    const made = G.g_object_list.filter(
      (o) => o.cls === SpawnClass.ResultCardTally);
    check("one instruction with two records makes two objects",
          made.length === 2 && made[0].at !== made[1].at,
          `${made.map((o) => o.at).join(",")}`);
  }
}

console.log("\nclass 0x19: the stage-4 boss, and the flag its entrance raises:");
{
  /**
   * `boss4.bin`'s clips, as `charmotion.BOSS4_CLIPS` bakes them. Only the ones
   * the ported states name need real lengths; the death clip matters most,
   * because `Boss4StateDeath` writes `g_script_flags[32]` on its frame 0x46
   * and a clip shorter than that could never reach it.
   */
  const BOSS4_TYPE = {
    ...TYPE,
    motions: {
      "105": motion(120),   // 0x69, the death fall
      "107": motion(20),    // 0x6B, the fighting idle
      "111": motion(20),    // 0x6F, the flinch out of state 7
      "115": motion(20),    // 0x73, the ordinary flinch
      "116": motion(30),    // 0x74, the settle
      "117": motion(60),    // 0x75, the landing
      "124": motion(40),    // 0x7C, the entrance
    },
  } as unknown as CharacterType;
  const BOSS_CHARS = {
    ...CHARS, types: { "1": TYPE, "74": BOSS4_TYPE },
  } as unknown as CharactersJson;

  /** One boss, straight out of `Boss4Init`, with the entrance `entrance`. */
  const spawnBoss = (entrance: number): Actor => {
    ResetGameGlobals();
    SetGameTables(BOSS_CHARS);
    // `ActorSpawn` runs the class's `Init` itself, the way
    // `SpawnFromDescriptor` does; calling it again here would count the boss
    // into both enemy counters twice.
    return ActorSpawn(35976, SpawnClass.Boss4, 74, "boss4",
                      { hp: 300, maxHp: 300, initialState: entrance,
                        visible: true });
  };
  const bossFrame = { eye: EYE, dt: 1 / 60, rng: new Rng(5), host: NULL_HOST };
  const tickBoss = (obj: Actor, n: number): void => {
    for (let i = 0; i < n; i++) {
      g_class_handlers[SpawnClass.Boss4]?.update(obj, bossFrame);
      // `ActorAdvanceMotion` is the engine's `obj+0x194` step and it is what
      // moves the play cursor these states test against; without it every clip
      // test in this class is frozen on frame 0.
      ActorAdvanceMotion(obj, 1 / 60);
    }
  };

  {
    const obj = spawnBoss(0);
    check("Boss4Init counts the boss in both enemy counters",
          G.g_enemies_alive === 1 && G.g_enemies_present === 1,
          `alive ${G.g_enemies_alive} present ${G.g_enemies_present}`);
    check("...hangs its 0xA4 block off obj+0x1310 and takes the entrance "
          + "state from the descriptor tail",
          obj.boss4?.state === 0 && obj.boss4?.sub === 0,
          `state ${obj.boss4?.state} sub ${obj.boss4?.sub}`);
    check("...and rides the transport for entrances 0 and 1 only",
          (obj.boss4!.flags & 1) === 1
          && (spawnBoss(2).boss4!.flags & 1) === 0,
          `flags ${obj.boss4!.flags}`);
  }

  // The gate chain, one link at a time. Entrance 0 must wait for the script's
  // own `set_script_flag 30` before it will even leave the transport.
  {
    const obj = spawnBoss(0);
    tickBoss(obj, 400);
    check("without g_script_flags[30] the entrance never leaves sub 1, and "
          + "flag 31 stays down",
          obj.boss4?.sub === 1
          && (G.g_script_flags[BOSS4_FIGHT_READY_FLAG] ?? 0) === 0,
          `sub ${obj.boss4?.sub} flag `
          + `${G.g_script_flags[BOSS4_FIGHT_READY_FLAG]}`);

    G.g_script_flags[BOSS4_DROP_FLAG] = 1;
    tickBoss(obj, 2);
    check("...the flag drops it off, and it stands to wait for the shutter",
          obj.boss4?.sub === 2 && (obj.boss4!.flags & 1) === 0,
          `sub ${obj.boss4?.sub} flags ${obj.boss4!.flags}`);

    // The banner is the middle link, and it is the one a reader of the two
    // addresses this work was scheduled from would have missed entirely.
    tickBoss(obj, 200);
    check("...and 200 frames later the shutter is still shut, because the "
          + "banner has not finished",
          G.g_bHudShutterState !== 1
          && (G.g_script_flags[BOSS4_FIGHT_READY_FLAG] ?? 0) === 0,
          `shutter ${G.g_bHudShutterState}`);
    tickBoss(obj, 200);
    check("...the banner reaches frame 300, sets the shutter to 1, and the "
          + `entrance raises g_script_flags[${BOSS4_FIGHT_READY_FLAG}]`,
          G.g_bHudShutterState === 1
          && G.g_script_flags[BOSS4_FIGHT_READY_FLAG] === 1,
          `shutter ${G.g_bHudShutterState} flag `
          + `${G.g_script_flags[BOSS4_FIGHT_READY_FLAG]}`);
    check("...and hands over to state 7, which is where every flinch returns",
          obj.boss4?.state === Boss4State.WaitForCameraInRange,
          `state ${obj.boss4?.state}`);
  }

  // Entrances 2 and 3 are already standing: no transport, no flag-30 wait.
  {
    const obj = spawnBoss(2);
    tickBoss(obj, 1);
    check("entrance 2 goes straight to the shutter wait, with no flag 30",
          obj.boss4?.sub === 2
          && (G.g_script_flags[BOSS4_DROP_FLAG] ?? 0) === 0,
          `sub ${obj.boss4?.sub}`);
    // The banner still waits on flag 30 -- its record names it -- so the fight
    // does not start until the script says so even here.
    tickBoss(obj, 400);
    check("...but its banner still waits on flag 30, so flag 31 stays down",
          (G.g_script_flags[BOSS4_FIGHT_READY_FLAG] ?? 0) === 0,
          `flag ${G.g_script_flags[BOSS4_FIGHT_READY_FLAG]}`);
  }

  // The damage model: one weak bone, and a floor the arena has to lift.
  {
    const obj = spawnBoss(2);
    obj.boss4!.phaseHpFloor = 0;
    const hit = (bone: number, result = 0) => {
      obj.pendingHit = { bone, result };
      Boss4ResolveShot(obj, obj.boss4!);
    };
    const before = obj.hp;
    hit(4);
    check("a shot anywhere but bone 2 costs the boss nothing",
          obj.hp === before, `${before} -> ${obj.hp}`);
    hit(BOSS4_WEAK_BONE);
    check(`a shot on bone ${BOSS4_WEAK_BONE} costs `
          + "g_boss4_head_damage[players + rank*2]",
          obj.hp === before - BOSS4_HEAD_DAMAGE[G.g_players_in_play],
          `${before} -> ${obj.hp}, table `
          + `${BOSS4_HEAD_DAMAGE[G.g_players_in_play]}`);
    check("...and it is counted for the head bonus",
          obj.boss4?.headHits === 1, `${obj.boss4?.headHits}`);
    hit(4, BOSS4_SOFT_SURFACE);
    check("...while a soft-surface hit anywhere costs exactly one",
          obj.hp === before - BOSS4_HEAD_DAMAGE[G.g_players_in_play] - 1,
          `${obj.hp}`);
  }

  {
    const obj = spawnBoss(2);
    tickBoss(obj, 1);
    check("the entrance seats the phase floor from "
          + "g_boss4_phase_hp_fraction[0], 8/9 of the bar",
          Math.abs(obj.boss4!.phaseHpFloor
                   - 300 * BOSS4_PHASE_HP_FRACTION[0]) < 0.01,
          `${obj.boss4!.phaseHpFloor}`);
    let shots = 0;
    while (shots < 40 && !(obj.flags & ActorFlag.ShotImmune)) {
      obj.pendingHit = { bone: BOSS4_WEAK_BONE, result: 0 };
      Boss4ResolveShot(obj, obj.boss4!);
      shots += 1;
    }
    check("...and the boss stops taking damage the moment it is reached, "
          + "which is why the arena phases are the next piece of work",
          (obj.flags & ActorFlag.ShotImmune) !== 0 && obj.hp > 0
          && obj.hp <= obj.boss4!.phaseHpFloor,
          `${shots} shots, hp ${obj.hp}, floor ${obj.boss4!.phaseHpFloor}`);
  }

  // The death, and the second gate.
  {
    const obj = spawnBoss(2);
    tickBoss(obj, 1);
    obj.boss4!.phaseHpFloor = 0;
    let shots = 0;
    while (shots < 40 && obj.hp > 0) {
      obj.pendingHit = { bone: BOSS4_WEAK_BONE, result: 0 };
      Boss4ResolveShot(obj, obj.boss4!);
      shots += 1;
    }
    check("the hit points running out sends the boss to state 0x16",
          obj.boss4?.state === Boss4State.Death
          && (obj.flags & ActorFlag.Dead) !== 0
          && G.g_enemies_alive === 0,
          `state ${obj.boss4?.state} alive ${G.g_enemies_alive}`);
    check("...and nothing has raised flag 32 yet: it is on a clip frame, not "
          + "on the frame the bar empties",
          (G.g_script_flags[BOSS4_DEAD_FLAG] ?? 0) === 0);
    tickBoss(obj, 40);
    check("...still down forty frames into the fall",
          (G.g_script_flags[BOSS4_DEAD_FLAG] ?? 0) === 0,
          `cursor ${MotionPlayFrame(obj)}`);
    tickBoss(obj, 60);
    check("...and up once the death clip reaches frame 0x46, which is "
          + `g_script_flags[${BOSS4_DEAD_FLAG}]`,
          G.g_script_flags[BOSS4_DEAD_FLAG] === 1,
          `cursor ${MotionPlayFrame(obj)} flag `
          + `${G.g_script_flags[BOSS4_DEAD_FLAG]}`);
    check("...and g_enemies_present is not given back until the 240-frame "
          + "dwell runs out",
          G.g_enemies_present === 1, `${G.g_enemies_present}`);
    tickBoss(obj, BOSS4_DEATH_DWELL + 240);
    check("...and then it is, exactly once",
          G.g_enemies_present === 0, `${G.g_enemies_present}`);
  }

  // The half that decides whether the gate is evaluated at all.
  {
    ResetGameGlobals();
    SetGameTables(BOSS_CHARS);
    const bossScript = {
      scene: 0, stage: 4, game_mode: 0, evt_file: "test", entry_block: 0,
      entry_step: 0, routes: [{ kind: "end", next: [-1, -1, -1] }],
      regions: [], cam_slots_used: [], warnings: [],
      blocks: [{
        index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
        steps: [{ index: 0, at: 0, ops: [{
          i: 0, at: 0x100, op: 0x0c, name: "spawn_obj_c", cat: "spawn",
          spawns: [{ at: 35976, class: SpawnClass.Boss4, flags: 0,
                     pos: [0, 0, 0], yaw_deg: 0, orient: [0, 0, 0], hp: 300,
                     desc_flags: 0 }],
        }] }],
      }],
    } as unknown as ScriptJson;
    const can = ScriptFlagsThisBundleCanRaise(bossScript);
    check("a stage that spawns class 0x19 can raise flag 31",
          can.has(BOSS4_FIGHT_READY_FLAG),
          `${[...can].sort((a, b) => a - b).join(",")}`);
    check("...and cannot yet raise flag 32, because the arena phases that let "
          + "the boss die are not ported",
          !can.has(BOSS4_DEAD_FLAG));
  }

  // The shutter byte lives in `G` because `game/` writes it, and the machine
  // has to notice a write that did not come through evt 0x1F.
  {
    ResetGameGlobals();
    const sh = new Shutter();
    sh.reset();
    sh.set(5);
    G.g_nFiringGate = 0;
    G.g_bHudShutterState = 1;          // as `BossIntroBannerUpdate` writes it
    sh.step(1);
    check("a shutter state written from game/ seeds the slide and raises the "
          + "firing gate",
          sh.counter === 1 && G.g_nFiringGate === 1,
          `counter ${sh.counter} gate ${G.g_nFiringGate}`);
    sh.step(SHUTTER_FRAMES);
    check("...and the slide still finishes into state 2",
          sh.state === 2, `state ${sh.state}`);
  }
}

/**
 * Class 0x14 — the stage-2 boss, and the twenty-one `wait_script_flag` gates
 * it is the only writer of.
 *
 * Every assertion here fails without `game/class14/`: the flags come off the
 * boss's own phase ladder and its own death, and with no module the actor has
 * no update at all.
 */
{

  /**
   * `boss2.bin`, with the clips the states name. Play lengths are the real
   * ones out of the exported bundle, because **every state measures its exit
   * on the play clock**: deriving them from the frame count would be a second
   * implementation of the thing the bundle carries.
   */
  const TYPE14: CharacterType = {
    ...TYPE,
    type: 0x47, name: "boss2", file: "boss2.bin",
    motions: {
      ...TYPE.motions,
      "21": motion(50, 0, 98), "23": motion(55, 0, 108),
      "24": motion(50, 0, 98), "25": motion(25, 0, 48),
      "26": motion(33, 0, 64), "29": motion(25, 0, 48),
      "31": motion(35, 0, 68), "32": motion(65, 0, 128),
      "33": motion(60, 0, 118), "34": motion(56, 0, 109),
      "35": motion(30, 0, 58), "36": motion(31, 0, 59),
      "37": motion(41, 0, 79), "38": motion(76, 0, 149),
      "39": motion(20, 0, 38), "40": motion(26, 0, 50),
      "41": motion(35, 0, 68), "42": motion(30, 0, 58),
      "45": motion(61, 0, 119), "46": motion(25, 0, 48),
      "47": motion(25, 0, 48), "48": motion(51, 0, 99),
      "49": motion(101, 0, 199), "51": motion(86, 0, 169),
      "53": motion(15, 0, 28), "54": motion(25, 0, 48),
      "55": motion(61, 0, 119), "56": motion(66, 0, 129),
      "57": motion(66, 0, 129), "58": motion(40, 0, 78),
    },
  };
  const CHARS14 = {
    ...CHARS, types: { "1": TYPE, "71": TYPE14 },
  } as unknown as CharactersJson;

  /** Stage 5 block 3's descriptor tail, as the bundle now carries it. */
  const desc14 = (state: number) => ({
    char_type: 0x47, state,
    dir: [0, 0, 1] as [number, number, number],
    route: [[660, 0, -4900], [660, 0, -5000],
            [510, 0, -5000], [510, 0, -4900]] as [number, number, number][],
    despawn_path: 209, despawn_frame: 0,
  });

  /**
   * Narrowing, not a cast — the same proof `spawnZombie` makes: `makeActor`
   * picks the union arm from `cls`, so a fixture that wants to read the boss's
   * tail has to establish the class rather than assert it.
   */
  const spawnBoss = (state: number, hp: number): Boss2Actor => {
    ResetGameGlobals();
    SetGameTables(CHARS14);
    const a = ActorSpawn(0x2400, SpawnClass.Boss2, 0x47, "boss2",
                         { class14: desc14(state) }, new Rng(7));
    if (a.cls !== SpawnClass.Boss2) throw new Error("not class 0x14");
    a.pos = vec3(580, 0, -5010);
    a.hp = hp;
    a.maxHp = hp;
    a.visible = true;
    return a;
  };

  const boss14Frame = () =>
    ({ eye: vec3(580, 0, -4880), dt: 1 / 60, rng: new Rng(11),
       host: NULL_HOST });

  /**
   * The entrance's one hand-over: `g_bHudShutterState == 1` and nothing else.
   * Entrances 0/1/3/4 raise flag 10 on the way through and entrance 2 does not
   * -- which is exactly why stage 5's block 3 gates on 31 alone.
   */
  {
    const a = spawnBoss(Class14State.Entrance0, 300);
    const f = boss14Frame();
    G.g_bHudShutterState = 2;
    for (let i = 0; i < 4000 && a.boss2.state !== Class14State.Hunt; i++) {
      // The shutter opens well into the entrance, as the script's own
      // `hud_shutter_state 1` does.
      if (i === 600) G.g_bHudShutterState = 1;
      Boss2Handler.update(a, f);
      ActorAdvanceMotion(a, 1 / 60);
    }
    check("entrance 0 hands over to Hunt when the shutter opens",
          a.boss2.state === Class14State.Hunt,
          `state ${Class14State[a.boss2.state]} sub ${a.boss2.sub}`);
    check("...and raises g_script_flags[10] doing it",
          G.g_script_flags[CLASS14_FLAG_INTRO_DONE] === 1,
          `flag10 ${G.g_script_flags[CLASS14_FLAG_INTRO_DONE]}`);
    check("...leaving the phase at ShortOpen",
          a.boss2.phase === Class14Phase.ShortOpen,
          `phase ${Class14Phase[a.boss2.phase]}`);
  }
  {
    const a = spawnBoss(Class14State.Entrance2, 200);
    const f = boss14Frame();
    G.g_bHudShutterState = 2;
    // Entrance 2's sub 1 waits on `g_script_flags[11]`, which stage 5's script
    // raises four instructions before the spawn.
    G.g_script_flags[CLASS14_FLAG_ROUND_B_OPEN] = 1;
    for (let i = 0; i < 4000 && a.boss2.state !== Class14State.Hunt; i++) {
      if (i === 600) G.g_bHudShutterState = 1;
      Boss2Handler.update(a, f);
      ActorAdvanceMotion(a, 1 / 60);
    }
    check("entrance 2 hands over on the same shutter",
          a.boss2.state === Class14State.Hunt,
          `state ${Class14State[a.boss2.state]}`);
    check("...and raises no flag 10, which is why stage 5 waits on 31 alone",
          (G.g_script_flags[CLASS14_FLAG_INTRO_DONE] ?? 0) === 0,
          `flag10 ${G.g_script_flags[CLASS14_FLAG_INTRO_DONE]}`);
    check("...leaving the phase at Stage5Open",
          a.boss2.phase === Class14Phase.Stage5Open,
          `phase ${Class14Phase[a.boss2.phase]}`);
  }

  // `Class14AdvancePhase` -- the ladder, walked by the hit points and by
  // nothing else. Stage 5's half of it is one step: 0.5 of full health.
  {
    const a = spawnBoss(Class14State.Entrance2, 200);
    a.boss2.state = Class14State.Hunt;
    a.boss2.phase = Class14Phase.Stage5Open;
    a.hp = 101;
    Class14AdvancePhase(a);
    const held: number = a.boss2.phase;
    check("the phase holds above g_class14_phase_hp_frac[8]",
          held === Class14Phase.Stage5Open, `${Class14Phase[held]}`);
    a.hp = 100;
    Class14AdvancePhase(a);
    const stepped: number = a.boss2.phase;
    const steppedState: number = a.boss2.state;
    check("...and steps to Stage5Final at exactly half",
          stepped === Class14Phase.Stage5Final
          && steppedState === Class14State.Close,
          `phase ${Class14Phase[stepped]} state ${Class14State[steppedState]}`);
    // The gate every arm carries: a boss mid-leap finishes it first.
    const b = spawnBoss(Class14State.Entrance2, 200);
    b.boss2.state = Class14State.LeapAttack;
    b.boss2.phase = Class14Phase.Stage5Open;
    b.hp = 1;
    Class14AdvancePhase(b);
    const mid: number = b.boss2.phase;
    check("...and no arm is taken while the boss is not in state 5, 6 or 7",
          mid === Class14Phase.Stage5Open, `${Class14Phase[mid]}`);
  }

  // The death fork, which is where all twenty-one gates are finally opened.
  // Phase alone picks the flag.
  for (const [phase, flag, state] of [
    [Class14Phase.ShortFinal, CLASS14_FLAG_DEAD, Class14State.DeathA],
    [Class14Phase.LongFinal, CLASS14_FLAG_DEAD, Class14State.DeathB],
    [Class14Phase.Stage5Final, CLASS14_FLAG_DEAD_STAGE5, Class14State.DeathC],
  ] as [Class14Phase, number, Class14State][]) {
    const a = spawnBoss(Class14State.Entrance2, 200);
    const f = boss14Frame();
    a.boss2.phase = phase;
    a.boss2.state = Class14State.CuedMotion;
    a.boss2.sub = 0;
    a.boss2.nextState = Class14State.Hunt;
    a.hp = 0;
    a.flags |= ActorFlag.Dead;
    for (let i = 0; i < 400 && a.boss2.state === Class14State.CuedMotion; i++) {
      Boss2Handler.update(a, f);
      ActorAdvanceMotion(a, 1 / 60);
    }
    check(`a death in ${Class14Phase[phase]} raises `
          + `g_script_flags[${flag}] and enters ${Class14State[state]}`,
          G.g_script_flags[flag] === 1 && a.boss2.state === state,
          `flag ${G.g_script_flags[flag]} `
          + `state ${Class14State[a.boss2.state]}`);
    check("...and raises nothing else",
          [10, 11, 12, 13, 14, 15, 16, 17, 31]
            .filter((n) => n !== flag)
            .every((n) => (G.g_script_flags[n] ?? 0) === 0),
          `${G.g_script_flags.map((v, i) => (v ? i : -1))
              .filter((i) => i >= 0).join(",")}`);
  }

  /**
   * End to end, on stage 5 block 3's own descriptor: the entrance, the
   * shutter, the fight, two hundred hit points of shooting, and
   * `g_script_flags[31]`.
   *
   * The shots go through `MarkActorShot`, which is what the real shot path
   * does for a class that owns its own result -- `Class14ResolveShotBone`
   * reads `obj+0x34` bit 3 and runs `Class14ApplyBoneDamage` itself, and
   * nothing here goes near `ResolveHit`.
   */
  {
    const a = spawnBoss(Class14State.Entrance2, 200);
    const f = boss14Frame();
    G.g_bHudShutterState = 2;
    G.g_script_flags[CLASS14_FLAG_ROUND_B_OPEN] = 1;
    let shots = 0;
    let frames = 0;
    for (; frames < 60000
           && (G.g_script_flags[CLASS14_FLAG_DEAD_STAGE5] ?? 0) === 0;
         frames++) {
      if (frames === 300) G.g_bHudShutterState = 1;
      if (frames > 400 && frames % 12 === 0) {
        MarkActorShot(a, 0, 1);
        shots += 1;
      }
      Boss2Handler.update(a, f);
      ActorAdvanceMotion(a, 1 / 60);
    }
    check("shot to death from stage 5's descriptor, the boss raises "
          + "g_script_flags[31]",
          G.g_script_flags[CLASS14_FLAG_DEAD_STAGE5] === 1,
          `after ${frames} frames and ${shots} shots, `
          + `hp ${a.hp} phase ${Class14Phase[a.boss2.phase]} `
          + `state ${Class14State[a.boss2.state]}`);
    check("...having walked the phase ladder to Stage5Final on the way",
          a.boss2.phase === Class14Phase.Stage5Final,
          `phase ${Class14Phase[a.boss2.phase]}`);
    check("...and raised flag 17 nowhere, which is stage 2's flag",
          (G.g_script_flags[CLASS14_FLAG_DEAD] ?? 0) === 0,
          `flag17 ${G.g_script_flags[CLASS14_FLAG_DEAD]}`);
  }

  // ...and the coverage set, which decides whether `wait_script_flag` even
  // evaluates the gate. Both directions.
  {
    ResetGameGlobals();
    SetGameTables(CHARS14);
    const spawnScript = (cls: number) => ({
      scene: 0, stage: 5, game_mode: 0, evt_file: "test", entry_block: 0,
      entry_step: 0, routes: [{ kind: "end", next: [-1, -1, -1] }],
      regions: [], cam_slots_used: [], warnings: [],
      blocks: [{
        index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
        steps: [{ index: 0, at: 0, ops: [
          { i: 0, at: 0x100, op: 0x0c, name: "spawn_obj_c", cat: "spawn",
            spawns: [{ at: 0x2400, class: cls, flags: 0, pos: [0, 0, 0],
                       yaw_deg: 0, orient: [0, 0, 0], hp: 200,
                       desc_flags: 0 }] },
        ] }],
      }],
    } as unknown as ScriptJson);
    const withBoss = ScriptFlagsThisBundleCanRaise(spawnScript(0x14));
    check("a stage that spawns class 0x14 can raise all nine of its flags",
          [10, 11, 12, 13, 14, 15, 16, 17, 31].every((n) => withBoss.has(n)),
          `${[...withBoss].sort((x, y) => x - y).join(",")}`);
    const without = ScriptFlagsThisBundleCanRaise(spawnScript(0x30));
    check("...and one that does not, cannot",
          ![10, 17, 31].some((n) => without.has(n)),
          `${[...without].sort((x, y) => x - y).join(",")}`);
  }
}

// -- class 0x33 selector 1: the carrier -------------------------------------

console.log("\nclass 0x33 selector 1: the carrier, and the room it opens:");
{
  // Stage 5's own descriptor, evt `0x1CE4`, as the bundle carries it. The
  // numbers are the shipped ones on purpose: the room this class was ported
  // for is held by *these* cues and not by a shape.
  const STAGE5 = () => ({
    slot: 0x1b0e, shot_mesh: -1, shot_radius: 0.1,
    path: 382, path_end: 590, effect_frame: 580,
    commit_frame: 230, despawn_frame: 650,
    commit_flag: 0xff, despawn_flag: 0xff,
    effect: [678.8, -70, -2616.5, 0, 0, 0],
  });
  // Stage 2's `0x12590`: no effect frame at all, and a commit that fires.
  const STAGE2 = () => ({
    slot: 0x1a35, shot_mesh: 0x0cec69a8, shot_radius: 0,
    path: 338, path_end: 420, effect_frame: -1,
    commit_frame: 360, despawn_frame: -1,
    commit_flag: 0xff, despawn_flag: 128,
    effect: [0, 0, -0.9, 4.8, 2.5, 0],
  });

  const CARRIER_AT = 0x1ce4;
  const CAM_AT_SPAWN = 231;

  const makeCarrier = (tail: ReturnType<typeof STAGE5>,
                       camFrame = CAM_AT_SPAWN): ScriptedSceneryActor => {
    G.g_cam_path_frame = camFrame;
    const a = ActorSpawn(CARRIER_AT, SpawnClass.ScriptedScenery, -1, "carrier",
                         { class33: tail as Actor["class33"],
                           hp: ScriptedScenerySelector.Carrier,
                           maxHp: ScriptedScenerySelector.Carrier });
    if (a.cls !== SpawnClass.ScriptedScenery) throw new Error("not class 0x33");
    a.visible = true;
    return a;
  };
  const reset = () => {
    ResetGameGlobals();
    SetGameTables(CHARS);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_players_in_play = 1;
    G.g_camera_fixed_eye_y = 0;
  };
  const carrierFrame = () => ({ eye: EYE, dt: 1 / 60, rng: new Rng(5),
                                host: NULL_HOST });
  const tick = (c: ScriptedSceneryActor, n: number) => {
    for (let i = 0; i < n; i++) {
      if (c.despawned) return;
      ScriptedCarrierUpdate33(c, carrierFrame());
    }
  };

  // -- the cursor ----------------------------------------------------------
  {
    reset();
    const c = makeCarrier(STAGE5());
    check("the Init publishes `g_carrier_object` before a frame has run",
          G.g_carrier_object === CARRIER_AT, String(G.g_carrier_object));
    tick(c, 1);
    check("`obj+0x1370` opens on `g_cam_path_frame`, which is "
          + "`g_cam_path_frame - 1` seeded and then stepped once",
          c.scenery.pathFrame === CAM_AT_SPAWN, String(c.scenery.pathFrame));
    // The seed is the camera's; the counter after it is not. Move the camera
    // by a hundred frames and the cursor must not notice.
    G.g_cam_path_frame += 100;
    tick(c, 10);
    check("...and then it is the object's own clock, not the camera's",
          c.scenery.pathFrame === CAM_AT_SPAWN + 10,
          String(c.scenery.pathFrame));
    check("...and the shot sphere is `tail+0x08` in both radii",
          c.hitRadius === 0.1 && c.bodyRadius === 0.1,
          `${c.hitRadius}/${c.bodyRadius}`);
  }

  // -- the two bits --------------------------------------------------------
  {
    reset();
    const c = makeCarrier(STAGE5());
    // The cues are read at the **top** of the frame, against the cursor the
    // previous frame's ride left, so the first tick puts the cursor on
    // `CAM_AT_SPAWN` and `n` ticks put it on `CAM_AT_SPAWN + n - 1`.
    tick(c, 580 - CAM_AT_SPAWN + 1);
    check("nothing is up while the ride is still running",
          (c.flags & (ActorFlag.Reacting | ActorFlag.Committed)) === 0,
          `flags 0x${(c.flags >>> 0).toString(16)} cursor ${c.scenery.pathFrame}`);
    check("...and the cursor has reached the descriptor's effect frame",
          c.scenery.pathFrame === 580, String(c.scenery.pathFrame));
    tick(c, 1);
    check("`obj+0x34` bit 0x40000000 goes up on the frame the cursor equals "
          + "`tail+0x14` — the bit state 32 is waiting for",
          (c.flags & ActorFlag.Reacting) !== 0,
          `flags 0x${(c.flags >>> 0).toString(16)}`);
    check("...and stage 5's carrier never raises 0x10000000, because its "
          + "commit frame (230) is behind where the script spawns it (231)",
          (c.flags & ActorFlag.Committed) === 0,
          `flags 0x${(c.flags >>> 0).toString(16)}`);
    check("...and the fire is not up yet", (c.flags & ActorFlag.FireLoop) === 0);
    // The frame that raises the bit also runs the counter, so it is already at
    // 1 here and the fire is `0x13` frames away.
    check("...and `obj+0x1334` is counting from that same frame",
          c.scenery.effectFrames === 1, String(c.scenery.effectFrames));
    tick(c, 0x12);
    check("...the fire waits the 0x14 frames `obj+0x1334` counts",
          (c.flags & ActorFlag.FireLoop) === 0,
          `after ${c.scenery.effectFrames}`);
    tick(c, 1);
    check("...and then it is up", (c.flags & ActorFlag.FireLoop) !== 0,
          `after ${c.scenery.effectFrames}`);
    const frozen = c.scenery.pathFrame;
    tick(c, 60);
    check("...after which the routine returns before its own ride, so the "
          + "object stops where it burned",
          c.scenery.pathFrame === frozen, String(c.scenery.pathFrame));
    G.g_cam_path_frame = 650;
    tick(c, 5);
    check("...and it does not reach its despawn either, camera cue or not",
          !c.despawned);
  }
  {
    reset();
    const c = makeCarrier(STAGE2());
    tick(c, 360 - CAM_AT_SPAWN + 1);
    check("...and nothing is up on the frame the cursor *reaches* the commit "
          + "frame, because the cue is read before the ride steps",
          (c.flags & ActorFlag.Committed) === 0,
          `cursor ${c.scenery.pathFrame}`);
    tick(c, 1);
    check("stage 2's carrier raises 0x10000000 on its own commit frame — the "
          + "bit `ZombieStateRideCarrier` leaves on",
          (c.flags & ActorFlag.Committed) !== 0,
          `cursor ${c.scenery.pathFrame}`);
    check("...and never 0x40000000, because its `tail+0x14` is -1.0",
          (c.flags & ActorFlag.Reacting) === 0,
          `flags 0x${(c.flags >>> 0).toString(16)}`);
    check("...and `tail+0x04 != -1` puts it on the mesh test, bit 0x10",
          (c.flags & 0x10) !== 0, `flags 0x${(c.flags >>> 0).toString(16)}`);
    // `tail+0x10` is 420: past it the cursor freezes rather than running on.
    tick(c, 200);
    check("...and the cursor stops at `tail+0x10` rather than running past it",
          c.scenery.pathFrame === 420, String(c.scenery.pathFrame));
  }

  // -- the two ways off the field -----------------------------------------
  {
    reset();
    const c = makeCarrier(STAGE5());
    tick(c, 10);
    G.g_cam_path_frame = 650;
    tick(c, 1);
    check("the camera reaching `tail+0x1C` despawns it", c.despawned);
  }
  {
    reset();
    const c = makeCarrier({ ...STAGE5(), despawn_flag: 0x80 });
    tick(c, 10);
    check("a carrier whose despawn flag is down stays", !c.despawned);
    G.g_script_flags[0x80] = 1;
    tick(c, 1);
    check("...and goes when the script raises it", c.despawned);
  }

  // -- stage 5 block 2's room, end to end ---------------------------------
  //
  // Four class-0x30 spawns in state 32 and the class-0x33 object the script
  // puts beside them. `ZombieStateDelayedStrikeInPlace` (`FUN_0045E830`) has
  // exactly one exit and it is this carrier's bit; state 10 is
  // `ZombieReleaseAndDespawn` (`FUN_00455490`), which is what actually takes
  // them out of `g_enemies_alive`. Both halves have to be right for the gate
  // at step 2 op 50 to come down, and neither was.
  const room = (tail: ReturnType<typeof STAGE5>) => {
    reset();
    for (let i = 0; i < 4; i++) {
      const z = spawnZombie(0x1d44 + i * 0x30, 1, `znnick ${i}`, {
        initialState: ZombieState.DelayedStrikeInPlace,
        attackState: ZombieState.AttackRun,
        entry: { delay: 2, rearm: 4, player: 0 } as Actor["entry"],
      });
      z.visible = true;
      z.hp = z.maxHp = 130;
      // Where the script puts them, and where this state leaves them.
      z.pos = vec3(-10 + i * 7, 0, 2870);
    }
    makeCarrier(tail);
    const rng = new Rng(11);
    const events = new Events();
    let clearedAt = -1;
    for (let f = 0; f < 900; f++) {
      GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
      if (clearedAt < 0 && G.g_enemies_alive === 0) clearedAt = f;
    }
    return clearedAt;
  };
  {
    check("four state-32 zombies count themselves in",
          (() => { reset();
                   const z = spawnZombie(0x1d44, 1, "znnick", {
                     initialState: ZombieState.DelayedStrikeInPlace,
                     attackState: ZombieState.AttackRun,
                     entry: { delay: 2, rearm: 4, player: 0 } as Actor["entry"],
                   });
                   z.visible = true;
                   return G.g_enemies_alive === 1; })(),
          String(G.g_enemies_alive));
    const at = room(STAGE5());
    // 580 - 231 to the bit, then the 0x14 + 1 frames `obj+0x1334` counts.
    check("stage 5 block 2's room empties itself, and on the frame the "
          + "descriptor says: `wait_enemies_alive <= 0` can come down",
          at > 0 && Math.abs(at - ((580 - CAM_AT_SPAWN) + 0x15)) <= 3,
          `cleared at frame ${at}`);
    check("...and every one of the four left the pool rather than parking in "
          + "a state, which is what the counter is measuring",
          G.g_object_list.filter((o) => o.cls === SpawnClass.Zombie).length === 0,
          `${G.g_object_list.length} objects left`);
  }
  {
    // The counterfactual, and it is the shape of the bug that was here: a
    // carrier that never raises the bit is four zombies that never leave.
    const at = room({ ...STAGE5(), effect_frame: -1 });
    check("...and a carrier whose `tail+0x14` is -1.0 never releases them, "
          + "which is what the room looked like with no class 0x33 at all",
          at === -1 && G.g_enemies_alive === 4,
          `cleared at ${at}, ${G.g_enemies_alive} alive`);
  }

  // -- state 10 is a despawn, not a rejoin ---------------------------------
  {
    reset();
    const z = spawnZombie(0x1dd4, 1, "state 10", {
      initialState: ZombieState.AttackRun, attackState: ZombieState.AttackRun,
    });
    z.visible = true;
    z.hp = z.maxHp = 130;
    z.pos = vec3(0, 0, 2870);
    const before = G.g_enemies_alive;
    z.state = ZombieState.Leave;
    z.sub = 0;
    EnemyZombieUpdate(z, { eye: EYE, dt: 1 / 60, rng: new Rng(2),
                           host: NULL_HOST });
    check("`g_class30_states[10]` is `ZombieReleaseAndDespawn`, so state 10 "
          + "removes the actor rather than sending it to WaitTurn",
          z.despawned && z.state === ZombieState.Leave,
          `state ${z.state} despawned ${z.despawned}`);
    check("...and both counters come back with it",
          before === 1 && G.g_enemies_alive === 0 && G.g_enemies_present === 0,
          `${before} -> ${G.g_enemies_alive}/${G.g_enemies_present}`);
  }

  // -- `ZombieAttachToCarrier`: the three zombies really are on the car -----
  //
  // `ZombieAttachToCarrier` (`FUN_0045E770`), reached from
  // `EnemyZombieInitByCharType` (`FUN_00452FD0`, 0x0045301D) at spawn and from
  // `EnemyZombieUpdate` (`FUN_004533F0`, 0x00453424) every frame afterwards.
  //
  // The report these assertions exist for said three stage-5 `znnick` should
  // be travelling with the car and were standing 2870 away; the port's own
  // comment said 2870 was where the descriptor put them and "the distance was
  // never the bug". The descriptor settles it: what it holds is an offset, not
  // a position, and every number below is the shipped one.
  //
  //   evt 0x1D44  init_flags 0x20008  (-4.6, 10.0, -16.5)  yaw 16384
  //   evt 0x1D74  init_flags 0x20008  (-4.6,  5.0,  -2.6)  yaw 16384
  //   evt 0x1DA4  init_flags 0x20008  (-4.6,  5.0,   7.0)  yaw 16384
  //
  // `L26`: the divergence at the bottom is pinned by an assertion, because a
  // note saying what somebody meant is not a statement about what runs.
  {
    // The three offsets, and the point stage 5's carrier descriptor fires its
    // own effect at -- `tail+0x24`, which is where the car is at cursor 580.
    const RIDERS: [number, [number, number, number]][] = [
      [0x1d44, [-4.6, 10.0, -16.5]],
      [0x1d74, [-4.6, 5.0, -2.6]],
      [0x1da4, [-4.6, 5.0, 7.0]],
    ];
    const CAR_AT_EFFECT = vec3(678.8, -70, -2616.5);
    const SHIPPED_FLAGS = 0x20008;
    const DESC_YAW = 16384;

    const seatOne = (at: number, off: [number, number, number],
                     flags = SHIPPED_FLAGS): ZombieActor => {
      const z = spawnZombie(at, 1, `znnick ${at.toString(16)}`, {
        flags, yaw: DESC_YAW, pos: vec3(off[0], off[1], off[2]),
        initialState: ZombieState.DelayedStrikeInPlace,
        attackState: ZombieState.AttackRun,
        entry: { delay: 2, rearm: 4, player: 0 } as Actor["entry"],
      });
      z.visible = true;
      z.hp = z.maxHp = 130;
      return z;
    };

    reset();
    const car = makeCarrier(STAGE5());
    car.pos = vec3(CAR_AT_EFFECT.x, CAR_AT_EFFECT.y, CAR_AT_EFFECT.z);
    car.yaw = 0;
    const riders = RIDERS.map(([at, off]) => seatOne(at, off));

    check("descriptor flag bit 3 raises `obj+0x136C` 0x10000000 and 0x100000, "
          + "so the actor is a passenger before a frame has run",
          riders.every((z) => (z.flags2 & ZombieFlag2.AttachedToCarrier) !== 0
                           && (z.flags2 & ZombieFlag2.Carried) !== 0),
          riders.map((z) => (z.flags2 >>> 0).toString(16)).join(" "));
    check("...and the descriptor position is stashed at `obj+0x13D8` rather "
          + "than kept as a world position",
          riders.every((z, i) => z.strikeStart.x === RIDERS[i][1][0]
                              && z.strikeStart.y === RIDERS[i][1][1]
                              && z.strikeStart.z === RIDERS[i][1][2]),
          riders.map((z) => `${z.strikeStart.x},${z.strikeStart.z}`).join(" "));
    check("...and `obj+0x135C` holds the descriptor yaw",
          riders.every((z) => z.zom.throwHand === DESC_YAW),
          riders.map((z) => z.zom.throwHand).join(" "));
    // `MatrixRotateY(carrier+0x68)` then `MatrixRotateY(0x8000)`: with the
    // car's own yaw at zero the seat is a half turn, so x and z negate.
    check("the Init seats them on the car, x and z through the half turn at "
          + "`0x0045E7A6`",
          riders.every((z, i) =>
            Math.abs(z.pos.x - (CAR_AT_EFFECT.x - RIDERS[i][1][0])) < 1e-3
            && Math.abs(z.pos.y - (CAR_AT_EFFECT.y + RIDERS[i][1][1])) < 1e-3
            && Math.abs(z.pos.z - (CAR_AT_EFFECT.z - RIDERS[i][1][2])) < 1e-3),
          riders.map((z) => `(${z.pos.x.toFixed(1)},${z.pos.y.toFixed(1)},`
                          + `${z.pos.z.toFixed(1)})`).join(" "));
    check("...and the yaw is the composed one plus `obj+0x135C`, truncated to "
          + "s16 the way `__ftol` leaves it",
          riders.every((z) => z.yaw === -0x8000 + DESC_YAW),
          riders.map((z) => z.yaw).join(" "));
    // The whole of the report: they are ON the car, two and a half thousand
    // units from the world origin the port was leaving them at.
    check("...so they are within a metre of the car and nowhere near the "
          + "origin, which is where `d≈2870` was measured from",
          riders.every((z) => Math.hypot(z.pos.x - car.pos.x,
                                         z.pos.z - car.pos.z) < 20
                           && Math.hypot(z.pos.x, z.pos.z) > 2000),
          riders.map((z) => Math.hypot(z.pos.x, z.pos.z).toFixed(0)).join(" "));

    // Now drive. `ZombieStateDelayedStrikeInPlace` moves nothing at all, so if
    // the re-seat were in the state rather than in front of it, this fails.
    car.pos.x += 300;
    car.pos.z += 500;
    for (const z of riders) {
      EnemyZombieUpdate(z, { eye: EYE, dt: 1 / 60, rng: new Rng(3),
                             host: NULL_HOST });
    }
    check("`EnemyZombieUpdate` re-seats them every frame, so they travel with "
          + "the car while sitting in a state that never moves an actor",
          riders.every((z, i) =>
            Math.abs(z.pos.x - (car.pos.x - RIDERS[i][1][0])) < 1e-3
            && Math.abs(z.pos.z - (car.pos.z - RIDERS[i][1][2])) < 1e-3),
          riders.map((z) => `(${z.pos.x.toFixed(1)},`
                          + `${z.pos.z.toFixed(1)})`).join(" "));
    // A quarter turn of the car swings the bed round with it.
    car.yaw = 0x4000;
    EnemyZombieUpdate(riders[0], { eye: EYE, dt: 1 / 60, rng: new Rng(3),
                                   host: NULL_HOST });
    check("...and the car's yaw turns the seat, not just the model",
          Math.abs(riders[0].pos.x - (car.pos.x - RIDERS[0][1][2])) < 1e-3
          && Math.abs(riders[0].pos.z - (car.pos.z + RIDERS[0][1][0])) < 1e-3,
          `(${riders[0].pos.x.toFixed(1)},${riders[0].pos.z.toFixed(1)})`);
  }
  {
    // The counterfactual, and it is exactly what the port did before: the same
    // descriptor without bit 3 stays where the position field says, which is
    // beside the world origin whatever the car does.
    reset();
    const car = makeCarrier(STAGE5());
    car.pos = vec3(678.8, -70, -2616.5);
    const z = spawnZombie(0x1d44, 1, "no bit 3", {
      flags: 0x20000, yaw: 16384, pos: vec3(-4.6, 10.0, -16.5),
      initialState: ZombieState.DelayedStrikeInPlace,
      attackState: ZombieState.AttackRun,
      entry: { delay: 2, rearm: 4, player: 0 } as Actor["entry"],
    });
    z.visible = true;
    z.hp = z.maxHp = 130;
    for (let i = 0; i < 60; i++) {
      EnemyZombieUpdate(z, { eye: EYE, dt: 1 / 60, rng: new Rng(4),
                             host: NULL_HOST });
    }
    check("without descriptor bit 3 the same spawn stays at the position "
          + "field, beside the origin — the behaviour this section corrects",
          (z.flags2 & ZombieFlag2.AttachedToCarrier) === 0
          && Math.hypot(z.pos.x, z.pos.z) < 20,
          `(${z.pos.x.toFixed(1)},${z.pos.z.toFixed(1)})`);
  }
  {
    // [diverges] The engine dereferences `g_carrier_object` with no null test
    // (`0x0045E781`). The port cannot, so the seat is skipped and the actor
    // keeps its descriptor offset. Asserted rather than described, because the
    // arm is unreachable in the shipped data and a note would be all there is.
    reset();
    G.g_carrier_object = -1;
    const z = spawnZombie(0x1d44, 1, "no carrier", {
      flags: 0x20008, yaw: 16384, pos: vec3(-4.6, 10.0, -16.5),
      initialState: ZombieState.DelayedStrikeInPlace,
      attackState: ZombieState.AttackRun,
      entry: { delay: 2, rearm: 4, player: 0 } as Actor["entry"],
    });
    z.visible = true;
    EnemyZombieUpdate(z, { eye: EYE, dt: 1 / 60, rng: new Rng(6),
                           host: NULL_HOST });
    check("[diverges] with no carrier the seat is skipped and the actor keeps "
          + "its offset, where the engine would follow a null pointer",
          (z.flags2 & ZombieFlag2.AttachedToCarrier) !== 0
          && z.pos.x === -4.6 && z.pos.z === -16.5,
          `(${z.pos.x},${z.pos.z})`);
  }
}


/**
 * The two sounds a zombie makes that are not shot feedback, and the one kind
 * of `ActorPlayHitVoice` that turns out to be dead.
 *
 * `ActorPlayHitVoice` (`FUN_0040A6F0`) is the game's only voice routine and
 * every one of its five kinds fires on an event, so for a long time the answer
 * to "what does a standing zombie sound like" was `[open]`. It is two bare
 * `PlaySoundId` calls, in two different places, and neither goes through that
 * routine:
 *
 * * `ZombieStateHoldAtRange` (`FUN_00455720`) plays `0x1917A9` --
 *   `COMMON2\ZOMBIE_041_16.wav` -- at `0x004558D6`, inside the same
 *   `obj+0x1B4 != row[0]` test that starts the idle clip;
 * * `EnemyZombieInitByCharType` (`FUN_00452FD0`) plays `0x4D17A9` at
 *   `0x0045314F` for character types 2 and 3, which `g_looping_se_ids` makes a
 *   **loop**, and `ZombieReleaseWeaponLoopSe` (`FUN_00456600`) stops it.
 *
 * Both were silent in the port. These assertions fail on the code before this
 * commit, which is the only thing that makes them worth having.
 */
console.log("\nthe idle groan, the weapon loop, and kind 4:");
{
  const GROAN = 0x1917a9;
  const CHAIN_SAW_LOOP = 0x4d17a9;
  const CHAIN_SAW_STOP = 0x4e17a9;
  const LASER_SWORD_LOOP = 0x1f25a9;

  /** Every `sound.play` id an events bus saw, in order. */
  const listen = (events: Events): number[] => {
    const ids: number[] = [];
    events.on("sound.play", (d) => { ids.push(d.id); });
    return ids;
  };
  const clear = () => {
    ResetGameGlobals();
    SetGameTables(CHARS);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_players_in_play = 1;
  };

  // -- C1. the groan fires on the frame the idle starts, and only then ------
  //
  // `004558b0 3bc7` / `004558b2 742a` is the whole gate. A zombie arriving at
  // the ring is not yet playing `row[0]`, so the first update starts the clip
  // and groans; the second finds the clip already running and does neither.
  {
    clear();
    const events = new Events();
    const heard = listen(events);
    const z = spawnZombie(0x7a00, 1, "arriving at the ring");
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.attackState = 1;
    z.state = ZombieState.HoldAtRange;
    z.sub = 0;
    z.pos = vec3(0, 0, 40);
    z.target = vec3(0, 0, 0);
    // Something other than the idle -- the run clip, which is what an actor
    // that has just arrived is still playing.
    z.motion = TYPE.motion_row["0"][MotionRow.Run];
    ZombieStateHoldAtRange(z, EYE, new Rng(7), NULL_HOST, events);
    check("a zombie that reaches the ring groans once -- `PlaySoundId(0x1917A9)`"
          + " at 0x004558D6",
          heard.length === 1 && heard[0] === GROAN,
          heard.map((i) => `0x${i.toString(16)}`).join(",") || "silence");
    check("...and the clip it groans on is the idle, `row[0]`",
          z.motion === TYPE.motion_row["0"][MotionRow.Walk],
          String(z.motion));
    const after = heard.length;
    for (let i = 0; i < 30; i++) {
      ZombieStateHoldAtRange(z, EYE, new Rng(7), NULL_HOST, events);
    }
    check("...and does not groan again while the same idle clip runs -- it is "
          + "one shot per entry, not a per-frame chance or a timer",
          heard.length === after, `${heard.length - after} more`);
  }


  // -- C1b. ...and it is silent when the actor arrives already idling --------
  //
  // The same `CMP` read the other way, and it is why the groan is rarer in
  // play than "every time a zombie stands still": `ZombieStateApproach` plays
  // `row[(obj+0x136C >> 0x15) & 1]`, and for the `row[0]` half of that pair
  // the walk in **is** the clip the hub wants, so the hub changes nothing and
  // says nothing. A zombie that arrives from the retreat (`row[4]`) or from an
  // attack run (`row[2]`/`row[3]`) or off the back of a swing does groan --
  // measured on stage 1 block 4, where the walkers reach the ring silently.
  {
    clear();
    const events = new Events();
    const heard = listen(events);
    const z = spawnZombie(0x7a02, 1, "arriving already on row[0]");
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.attackState = 1;
    z.state = ZombieState.HoldAtRange;
    z.sub = 0;
    z.pos = vec3(0, 0, 40);
    z.target = vec3(0, 0, 0);
    z.motion = TYPE.motion_row["0"][MotionRow.Walk];
    ZombieStateHoldAtRange(z, EYE, new Rng(7), NULL_HOST, events);
    check("an actor that walks in already playing `row[0]` does not groan -- "
          + "the approach's own clip is the idle, so the hub changes nothing",
          heard.length === 0,
          heard.map((i) => `0x${i.toString(16)}`).join(","));
  }

  // -- C1c. ...and it does when the actor comes back from the retreat -------
  //
  // `ZombieStateBackOff` plays `row[4]`, so an actor returning to the hub
  // after a swing is on a clip the hub does not want and gets both the idle
  // and the groan. This is the path that makes the noise in play.
  {
    clear();
    const events = new Events();
    const heard = listen(events);
    const z = spawnZombie(0x7a03, 1, "back from the retreat");
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.attackState = 1;
    z.state = ZombieState.HoldAtRange;
    z.sub = 0;
    z.pos = vec3(0, 0, 40);
    z.target = vec3(0, 0, 0);
    z.motion = TYPE.motion_row["0"][MotionRow.BackAway];
    // The strike anchor, because that is what a returning actor carries -- and
    // without it the hub would send it back into the retreat before the idle.
    z.flags2 |= ZombieFlag2.StrikeAnchor;
    ZombieStateHoldAtRange(z, EYE, new Rng(7), NULL_HOST, events);
    check("...and one coming back on `row[4]` groans again, which is the path "
          + "that actually sounds in play",
          heard.length === 1 && heard[0] === GROAN,
          heard.map((i) => `0x${i.toString(16)}`).join(",") || "silence");
  }

  // -- C2. ...and it is not `ActorPlayHitVoice` -----------------------------
  //
  // The distinction is the whole reason the idle was never found: the voice
  // routine has a kind for the attack cry and none for an idle, so reading it
  // more carefully could never have turned this up. Kind 4 is the other half
  // of that reading, and it is dead.
  {
    clear();
    const events = new Events();
    const heard = listen(events);
    const z = spawnZombie(0x7a01, 1, "proving kind 4 is silent");
    ActorPlayHitVoice(z, ActorVoice.Kind4, new Rng(1),
                      (id) => events.emit("sound.play", { id }));
    check("kind 4 plays nothing: no call site in the image passes 4, and both "
          + "ids at `g_actor_voice_kind4` (0x005A4EA8) are zero and unwritten",
          heard.length === 0, heard.map((i) => i.toString(16)).join(","));
  }

  // -- C3. the weapon loop is refcounted, and shared -----------------------
  //
  // `00453133` gates the *sound* on `g_weapon_loop_holders == 0` while the
  // increment and the `obj+0x131B` latch at `00453164` run for every holder.
  // So two chainsaw zombies make one chainsaw noise.
  {
    clear();
    const events = new Events();
    const heard = listen(events);
    const a = spawnZombieWithEvents(0x7b00, 2, "chainsaw one", events);
    check("the first character-type-2 actor starts the looping chainsaw",
          heard.length === 1 && heard[0] === CHAIN_SAW_LOOP,
          heard.map((i) => `0x${i.toString(16)}`).join(",") || "silence");
    check("...and latches `obj+0x131B` with the count at one",
          a.weaponLoopHeld === 1 && G.g_weapon_loop_holders === 1,
          `${a.weaponLoopHeld} / ${G.g_weapon_loop_holders}`);
    const b = spawnZombieWithEvents(0x7b01, 2, "chainsaw two", events);
    check("the second one takes a share and starts nothing -- one loop per "
          + "scene, not one per actor",
          heard.length === 1 && b.weaponLoopHeld === 1
          && G.g_weapon_loop_holders === 2,
          `${heard.length} sounds, ${G.g_weapon_loop_holders} holders`);

    // ...and the release is the mirror: the first death is silent, the last
    // plays the stop id, which `PlaySoundId` turns into a stop-all.
    ZombieReleaseWeaponLoopSe(a, events);
    check("the first holder to go plays no stop id",
          heard.length === 1 && G.g_weapon_loop_holders === 1
          && a.weaponLoopHeld === 0,
          `${heard.length} sounds, ${G.g_weapon_loop_holders} holders`);
    ZombieReleaseWeaponLoopSe(b, events);
    check("the last one stops it, with the `_OFF` id out of "
          + "`g_looping_se_stop_ids`",
          heard.length === 2 && heard[1] === CHAIN_SAW_STOP
          && G.g_weapon_loop_holders === 0,
          heard.map((i) => `0x${i.toString(16)}`).join(","));
    // Releasing twice must not take the count below zero: the engine's own
    // guard is the latch, not the count.
    ZombieReleaseWeaponLoopSe(b, events);
    check("...and a second release from the same actor does nothing, because "
          + "the latch is what guards it",
          heard.length === 2 && G.g_weapon_loop_holders === 0,
          `${heard.length} sounds, ${G.g_weapon_loop_holders} holders`);
  }

  // -- C4. character type 3 is the same arm with the other pair ------------
  {
    clear();
    const events = new Events();
    const heard = listen(events);
    spawnZombieWithEvents(0x7b02, 3, "laser sword", events);
    check("character type 3 starts the laser sword instead -- `0x1F25A9`, "
          + "the other entry of the same table",
          heard.length === 1 && heard[0] === LASER_SWORD_LOOP,
          heard.map((i) => `0x${i.toString(16)}`).join(",") || "silence");
  }

  // -- C5. every other character type takes no share ----------------------
  //
  // The engine's `switch` has one arm for 2 and 3 and nothing for the rest, so
  // an ordinary zombie must leave both the count and the latch alone -- or the
  // *next* chainsaw zombie would find a non-zero count and never sound.
  {
    clear();
    const events = new Events();
    const heard = listen(events);
    const z = spawnZombieWithEvents(0x7b03, 1, "ordinary", events);
    check("an ordinary zombie takes no share of the weapon loop",
          heard.length === 0 && z.weaponLoopHeld === 0
          && G.g_weapon_loop_holders === 0,
          `${heard.length} sounds, ${G.g_weapon_loop_holders} holders`);
  }

  // -- C6. the scene reset zeroes the count -------------------------------
  //
  // `MOV [0x009c8a74], 0` at `0x0045EF3D`. Without it a second stage's first
  // chainsaw zombie inherits a non-zero count and the chainsaw never starts.
  {
    clear();
    G.g_weapon_loop_holders = 3;
    ResetSceneOnEnter();
    check("`ResetSceneOnEnter` zeroes `g_weapon_loop_holders`, so a stage does "
          + "not inherit the last one's holders",
          G.g_weapon_loop_holders === 0, String(G.g_weapon_loop_holders));
  }
}

// -- class 0x33 selector 4: the scenery an actor shoves aside -----------------
//
// Reported as stage 1 `0x16D8` `char_adv00` "playing the wrong entrance -- a
// ledge hang where a chair push belongs". The clip id was right: 1048 is a
// sixty-frame hold. The chair push is **this class**, and the port had the
// three fields `ColiTestSphereAgainstActors` writes -- `obj+0x138`, `+0x13C`,
// `+0x140` -- with `ZombiePushOutOfWorldAndActors` as their only reader.
//
// Every number below is stage 1's own descriptor, `0x1A40` and `0x1A74`: slot
// 4196 (`komono_7.bin` part 0, a chair), no shot mesh, a 3.5 sphere, armed by
// script flag 32 and despawned by 33. The set piece is held by *these* values
// and not by a shape.

console.log("\nclass 0x33 selector 4: the scenery an actor shoves aside:");
{
  const CHAIR_AT = 0x1a40;
  const CHAIR_SLOT = 0x1064;             // 4196
  const CHAIR_SPHERE = 3.5;
  const PUSH_FLAG = 32;
  const DESPAWN_FLAG = 33;
  /** `ActorInitFlags` puts the descriptor's word on `obj+0x34`; both carry it. */
  const SPAWN_FLAGS = 0x8000;

  const STAGE1 = () => ({
    slot: CHAIR_SLOT, shot_mesh: -1, shot_radius: CHAIR_SPHERE,
    push_flag: PUSH_FLAG, despawn_flag: DESPAWN_FLAG,
  });

  const reset = () => {
    ResetGameGlobals();
    SetGameTables(CHARS);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_players_in_play = 1;
  };
  const makeChair = (tail = STAGE1(),
                     flags = SPAWN_FLAGS): ScriptedSceneryActor => {
    const a = ActorSpawn(CHAIR_AT, SpawnClass.ScriptedScenery, -1, "chair",
                         { class33Push: tail as Actor["class33Push"],
                           hp: ScriptedScenerySelector.Pushable,
                           maxHp: ScriptedScenerySelector.Pushable,
                           flags });
    if (a.cls !== SpawnClass.ScriptedScenery) throw new Error("not class 0x33");
    a.pos = vec3(22.83, 6.5, -16.74);
    a.visible = true;
    return a;
  };
  const chairFrame = () => ({ eye: EYE, dt: 1 / 60, rng: new Rng(9),
                              host: NULL_HOST });
  const tick = (c: ScriptedSceneryActor, n: number) => {
    for (let i = 0; i < n; i++) {
      if (c.despawned) return;
      ScriptedPushableUpdate33(c, chairFrame());
    }
  };

  // -- C1. the seed, and the radius that makes it a push target -------------
  //
  // `tail+0x04 == -1` writes `tail+0x08` to `obj+0x124` **and** `obj+0x128`.
  // The second is the one that matters: `ColiTestSphereAgainstActors` measures
  // against the *body* radius, so a chair that only got the shot radius is a
  // chair nothing can touch.
  {
    reset();
    const c = makeChair();
    check("before its first frame the chair has no sphere at all",
          c.bodyRadius === 0 && c.hitRadius === 0,
          `${c.bodyRadius}/${c.hitRadius}`);
    tick(c, 1);
    check("the seed writes `tail+0x08` to the body radius as well as the "
          + "shot radius -- both port names for `obj+0x124`, and `obj+0x128`",
          c.bodyRadius === CHAIR_SPHERE && c.hitRadius === CHAIR_SPHERE
          && c.radius === CHAIR_SPHERE,
          `${c.bodyRadius}/${c.hitRadius}/${c.radius}`);
    check("...and the draw slot, which is the whole of what the renderer "
          + "needs to clone a model for it",
          c.scenery.slot === CHAIR_SLOT, String(c.scenery.slot));
    check("`obj+0x1312` is incremented, so the seed runs once",
          c.sub === 1, String(c.sub));
  }

  // -- C2. the freeze, and the one flag that lifts it -----------------------
  //
  // `obj+0x34` bit `0x8000` arrives on the descriptor and `AND AH, 0x7f` at
  // `0x00433C00` is the only thing that clears it. While it is up the object
  // does not move, and `ColiTestSphereAgainstActors` skips it as a candidate
  // -- one bit, both halves.
  {
    reset();
    const c = makeChair();
    tick(c, 1);
    check("the descriptor's `0x8000` survives `ActorInitFlags`, so the chair "
          + "starts held",
          (c.flags & SCENERY_SKIP_COLLISION) !== 0,
          `0x${c.flags.toString(16)}`);
    // A push recorded while it is held must not move it.
    c.pushedBy = 0x7ee0;
    c.pushDepth = 2;
    c.pushNormal = vec3(1, 0, 0);
    const x0 = c.pos.x;
    tick(c, 1);
    check("a push recorded on a held chair moves it nowhere, and is not even "
          + "consumed",
          c.pos.x === x0 && c.pushedBy === 0x7ee0, `${c.pos.x} vs ${x0}`);
    G.g_script_flags[PUSH_FLAG] = 1;
    tick(c, 1);
    check("script flag 32 clears the bit and the chair moves on that same "
          + "frame -- a tenth of the penetration along the recorded normal",
          Math.abs(c.pos.x - (x0 + 0.2)) < 1e-6
          && !(c.flags & SCENERY_SKIP_COLLISION), String(c.pos.x));
    check("...and the recorded push is consumed, so one record is one move",
          c.pushedBy === -1, String(c.pushedBy));
    // The clear is a clear and not a copy of the flag: a flag that goes back
    // down does not re-freeze the object.
    G.g_script_flags[PUSH_FLAG] = 0;
    c.pushedBy = 0x7ee0;
    c.pushDepth = 2;
    c.pushNormal = vec3(1, 0, 0);
    const x1 = c.pos.x;
    tick(c, 1);
    check("the flag dropping again does not put the bit back -- the routine "
          + "only ever clears",
          Math.abs(c.pos.x - (x1 + 0.2)) < 1e-6, String(c.pos.x));
  }

  // -- C3. the pusher's airborne bits, not the chair's ----------------------
  //
  // `if ((*(uint *)(obj+0x138) + 0x34) & 0x18000000) f *= 1.8` -- the test is
  // on the actor that did the pushing. Reading the chair's own flags there
  // would be `L11` with the object the other way round, and it would be
  // silent: 1.8 times nothing is still nothing until an airborne zombie
  // arrives.
  {
    reset();
    G.g_script_flags[PUSH_FLAG] = 1;
    const pusher = spawnZombie(0x7ee0, 1, "pusher");
    pusher.flags |= 0x18000000;
    const c = makeChair();
    tick(c, 1);
    c.pushedBy = pusher.at;
    c.pushDepth = 2;
    c.pushNormal = vec3(1, 0, 0);
    const x0 = c.pos.x;
    tick(c, 1);
    check("an airborne pusher shoves 1.8x as far, and the bit read is the "
          + "**pusher's**",
          Math.abs(c.pos.x - (x0 + 0.36)) < 1e-6, String(c.pos.x));

    // ...and the chair's own copy of the same bits changes nothing.
    pusher.flags &= ~0x18000000;
    c.flags |= 0x18000000;
    c.pushedBy = pusher.at;
    c.pushDepth = 2;
    c.pushNormal = vec3(1, 0, 0);
    const x1 = c.pos.x;
    tick(c, 1);
    check("the chair's own airborne bits are not the ones that scale it",
          Math.abs(c.pos.x - (x1 + 0.2)) < 1e-6, String(c.pos.x));
  }

  // -- C4. all three axes, and the sphere that follows ----------------------
  //
  // The recorded push is applied in x, y **and** z -- unlike the re-resolve
  // under it, which is x and z only. And `ScriptedPushableSyncSphere33` rises
  // by exactly the body radius, where `ActorUpdateBoundingSphere` rises by the
  // radius plus one: two conventions for `obj+0x12C`, and this class writes
  // its own.
  {
    reset();
    G.g_script_flags[PUSH_FLAG] = 1;
    const c = makeChair();
    tick(c, 1);
    const p0 = { x: c.pos.x, y: c.pos.y, z: c.pos.z };
    c.pushedBy = -1;
    c.pushedBy = 0x7ee0;
    c.pushDepth = 3;
    c.pushNormal = vec3(0, 1, -1);
    tick(c, 1);
    check("the recorded push moves all three axes, y included",
          Math.abs(c.pos.y - (p0.y + 0.3)) < 1e-6
          && Math.abs(c.pos.z - (p0.z - 0.3)) < 1e-6
          && c.pos.x === p0.x,
          `${c.pos.x}/${c.pos.y}/${c.pos.z}`);
    check("the collision sphere is re-seated at the position plus exactly "
          + "the body radius -- not the radius plus one",
          c.sphereCentre.y === c.pos.y + CHAIR_SPHERE
          && c.sphereCentre.x === c.pos.x && c.sphereCentre.z === c.pos.z,
          String(c.sphereCentre.y));
  }

  // -- C5. a zombie walking into it is the whole set piece ------------------
  //
  // The two halves meeting: `ZombiePushOutOfWorldAndActors` runs
  // `ColiTestSphereAgainstActors`, which records the opposite push on whatever
  // it finds, and this class applies it next frame. Nothing here calls the
  // push directly -- if the chair moves, the wiring is real.
  {
    reset();
    G.g_script_flags[PUSH_FLAG] = 1;
    const c = makeChair();
    tick(c, 1);
    const z = spawnZombie(0x16d8, 7, "char_adv00");
    z.pos = vec3(c.pos.x + 4, 6.2, c.pos.z);
    z.bodyRadius = 3.5;
    z.flags2 |= ZombieFlag2.CollideActors;
    const x0 = c.pos.x;
    ZombiePushOutOfWorldAndActors(z, 1);
    check("the zombie's own collision pass records the push on the chair "
          + "rather than moving it",
          c.pushedBy === z.at && c.pushDepth > 0,
          `${c.pushedBy}/${c.pushDepth}`);
    tick(c, 1);
    check("...and the chair shoves itself away from the zombie on the next "
          + "frame, which is the chair push the report was asking for",
          c.pos.x < x0 - 1e-6 && c.pushedBy === -1,
          `${x0} -> ${c.pos.x}`);
  }

  // -- C6. the despawn flag is tested first, and it returns -----------------
  //
  // `MOV AL, byte ptr [ECX + 0xd]` at `0x00433B80` is the first thing in the
  // routine: a raised flag despawns and returns before the seed, the push and
  // the draw. A chair that seeded itself on the frame it left would leave the
  // renderer a slot to clone for one frame.
  {
    reset();
    G.g_script_flags[DESPAWN_FLAG] = 1;
    const c = makeChair();
    tick(c, 1);
    check("script flag 33 despawns the chair on its first frame",
          c.despawned, String(c.despawned));
    check("...before the seed, so it never publishes a draw slot",
          c.scenery.slot === 0 && c.sub === 0,
          `${c.scenery.slot}/${c.sub}`);
  }

  // -- C8. the wiring, from the bundle's placement to the object moving -----
  //
  // Everything above calls `ScriptedPushableUpdate33` by hand, and that is
  // exactly the shape `L38` warns about: a dispatch arm that is missing looks
  // the same as one that is wrong, and a test that drives past it sees
  // neither. Two links, neither of which the assertions above can reach:
  //
  // * `SpawnSlotActors` gates on a tail block being present, and it used to
  //   accept `class33` alone -- so a selector-4 placement made no object at
  //   all, which was one of the four reasons the port drew no chair;
  // * `ScriptedSceneryUpdate33` picks the routine off `obj.hp`, because the
  //   port has one table entry per class where the engine writes one of twelve
  //   pointers into `*obj`.
  //
  // So this one goes in through the front: the placement the exporter emits,
  // then `GameUpdate`, and nothing else.
  {
    reset();
    SetGameTables({
      ...CHARS,
      placements: [{
        at: CHAIR_AT, class: 0x33, char_type: -1, motion: null,
        hp: ScriptedScenerySelector.Pushable, init_flags: SPAWN_FLAGS,
        yaw: 4096, class33_push: STAGE1(),
      }],
    } as unknown as CharactersJson);
    const rng = new Rng(33);
    const events = new Events();
    const listed = [{ at: CHAIR_AT, class: SpawnClass.ScriptedScenery,
                      pos: [22.83, 6.5, -16.74] as [number, number, number] }];
    SpawnSlotActors(listed, rng);
    const c = G.g_object_list.find((o) => o.at === CHAIR_AT);
    check("a placement carrying only `class33_push` is spawned -- the gate "
          + "takes either block, not just the carrier's",
          !!c && c.cls === SpawnClass.ScriptedScenery,
          c ? `class ${c.cls}` : "no actor");
    if (!c || c.cls !== SpawnClass.ScriptedScenery) throw new Error("no chair");
    check("...and it arrives held, because the spawn arm carries the "
          + "descriptor's flags word through",
          (c.flags & SCENERY_SKIP_COLLISION) !== 0,
          `0x${c.flags.toString(16)}`);
    G.g_script_flags[PUSH_FLAG] = 1;
    GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
    check("one `GameUpdate` reaches the selector-4 routine through the class "
          + "table, seeds the sphere and lifts the freeze",
          c.bodyRadius === CHAIR_SPHERE && c.scenery.slot === CHAIR_SLOT
          && !(c.flags & SCENERY_SKIP_COLLISION),
          `${c.bodyRadius}/${c.scenery.slot}/0x${c.flags.toString(16)}`);
    c.pushedBy = 0x7ee0;
    c.pushDepth = 2;
    c.pushNormal = vec3(1, 0, 0);
    const x0 = c.pos.x;
    GameUpdate(EYE, 1 / 60, NULL_HOST, rng, events);
    check("...and a second one moves it, with nothing but the class table "
          + "between the frame and the push",
          Math.abs(c.pos.x - (x0 + 0.2)) < 1e-6, `${x0} -> ${c.pos.x}`);
    // Put the fixture back: everything after this file's class-0x33 section
    // expects `CHARS` with no placements in it.
    SetGameTables(CHARS);
  }

  // -- C7. the other selectors get nothing ----------------------------------
  //
  // The bundle carries `class33_push` for selector 4 and `class33` for
  // selector 1, never both, and the port takes which one arrived as the
  // selector. An actor with neither is one of the eight sub-handlers nothing
  // here can run, and the update must be a no-op rather than a default arm.
  {
    reset();
    G.g_script_flags[PUSH_FLAG] = 1;
    const c = makeChair();
    c.class33Push = null;
    const p0 = { x: c.pos.x, sub: c.sub };
    c.pushedBy = 0x7ee0;
    c.pushDepth = 9;
    c.pushNormal = vec3(1, 0, 0);
    tick(c, 4);
    check("a class-0x33 actor with no tail block seeds nothing and moves "
          + "nowhere, however hard something pushes it",
          c.pos.x === p0.x && c.sub === p0.sub && !c.despawned,
          `${c.pos.x}/${c.sub}`);
  }
}

// -- 30. the three flying and swimming enemies -------------------------------
//
// Class 0x11, 0x43 and 0x51, each of which had no module until now. Every
// assertion here is one that fails if a specific reading is dropped.

{
  // A host whose `viewPoint` is the identity on x and y and negates z, so the
  // engine's `-z is in front` lands somewhere a test can name. `NULL_HOST`
  // answers nothing, which would put every camera-space target at the origin.
  const HOST: GameHost = {
    ...NULL_HOST,
    viewPoint: (x, y, z, out) => {
      out.x = EYE.x + x;
      out.y = EYE.y + y;
      out.z = EYE.z - z;
    },
  };
  const frame = (rng: Rng, events?: Events): ClassFrame =>
    ({ eye: EYE, dt: 1 / 60, rng, host: HOST, events });

  // -- class 0x51, the fish ------------------------------------------------
  {
    const rng = new Rng(9);
    scene(0, rng);
    const header = ActorSpawn(0x9000, SpawnClass.WaterEnemy, -1, "fish", {
      class51: {
        water_level: -12.5, speed_x: -12.5, speed_z: 0, bob_amplitude: 0,
        entry_mode: 0, subtype: 6, rise_frames: 0, bob_cycles: 0,
        lunge_frames: 0,
      },
    }, rng);
    check("a class-0x51 group header is not a fish: it sets the water level",
          G.g_water_level === -12.5, `${G.g_water_level}`);
    check("...and despawns without joining either enemy counter",
          header.despawned && G.g_enemies_alive === 0
          && G.g_enemies_present === 0,
          `${header.despawned} ${G.g_enemies_alive}/${G.g_enemies_present}`);
  }

  {
    const rng = new Rng(11);
    scene(0, rng);
    G.g_water_level = 0;
    const make = (at: number) => ActorSpawn(at, SpawnClass.WaterEnemy, -1,
      "fish", {
        pos: vec3(0, -2, 40),
        class51: {
          water_level: 0.3, speed_x: 0.3, speed_z: 0.3, bob_amplitude: 4,
          entry_mode: 1, subtype: 0, rise_frames: 3, bob_cycles: 0,
          lunge_frames: 40,
        },
      }, rng);
    const a = make(0x9100);
    const t = () => (a as { fish: FishTail }).fish;
    check("a placed fish joins both enemy counters",
          G.g_enemies_alive === 1 && G.g_enemies_present === 1,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
    check("...and `entry_mode` 1 starts it invisible, to fade in",
          t().alpha === 0 && t().state === FishState.Rise, `${t().alpha}`);
    check("...aimed at the camera, not along its own descriptor yaw",
          t().vx === 0 && Math.abs(t().vz + 0.3) < 1e-6,
          `${t().vx} ${t().vz}`);

    // `rise_frames` is 3, so the fourth update is the one that hands over.
    for (let i = 0; i < 3; i += 1) FishUpdate(a, frame(rng));
    check("the rise lasts exactly `tail+0x10` frames",
          t().state === FishState.Bob && t().alpha === 1,
          `${FishState[t().state]} ${t().alpha}`);

    // `bob_cycles` is 0 and the counter starts at 0, so the first bob frame
    // already satisfies the test and it goes for a slot.
    FishUpdate(a, frame(rng));
    check("...and with no bob cycles owed it claims a slot at once",
          t().state === FishState.Lunge && t().slot >= 0
          && G.g_water_attack_slots[t().slot] === 1,
          `${FishState[t().state]} slot ${t().slot}`);
    check("...taking the permit its slot names",
          a.attackPermit === 0, `${a.attackPermit}`);

    // Four is the whole supply.
    const rest = [make(0x9101), make(0x9102), make(0x9103), make(0x9104)];
    for (const f of rest) {
      const ft = (f as { fish: FishTail }).fish;
      ft.state = FishState.Bob;
      ft.bobCycles = 0;
      ft.bobCycle = 0;
      FishUpdate(f, frame(rng));
    }
    check("only four fish can be in the air at once",
          G.g_water_attack_slots.filter((v) => v === 1).length === 4,
          `${G.g_water_attack_slots}`);
    const last = (rest[3] as { fish: FishTail }).fish;
    check("...and the fifth retires from both counters and swims off",
          last.swimAway && last.slot === -1,
          `${last.swimAway} slot ${last.slot}`);
  }

  {
    // Shot above the water and shot below it are different deaths.
    const rng = new Rng(13);
    scene(0, rng);
    G.g_water_level = -10;
    const mk = (at: number, submerged: boolean) => {
      const f = ActorSpawn(at, SpawnClass.WaterEnemy, -1, "fish", {
        pos: vec3(0, submerged ? -20 : 0, 30),
        class51: {
          water_level: 0.3, speed_x: 0.3, speed_z: 0.3, bob_amplitude: 4,
          entry_mode: 0, subtype: 0, rise_frames: 30, bob_cycles: 1,
          lunge_frames: 40,
        },
      }, rng);
      const ft = (f as { fish: FishTail }).fish;
      if (submerged) ft.flags |= FishFlag.Submerged;
      f.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
      return { f, ft };
    };
    const above = mk(0x9200, false);
    const below = mk(0x9201, true);
    const score = G.g_player_score[0];
    FishUpdate(above.f, frame(rng));
    check("a fish above the water is flung when it is shot",
          above.ft.state === FishState.Flung,
          FishState[above.ft.state]);
    FishUpdate(below.f, frame(rng));
    check("...and one below it surfaces and sinks",
          below.ft.state === FishState.Sink
          // The state runs in the same update as the shot, and it takes its
          // first 0.005 off the sinking centre before this line is reached.
          && Math.abs(below.ft.sinkY - (G.g_water_level + 0.095)) < 1e-6,
          `${FishState[below.ft.state]} sinkY=${below.ft.sinkY}`);
    check("...each paying 80", G.g_player_score[0] - score === 160,
          `${G.g_player_score[0] - score}`);
  }

  // -- class 0x11, the frog ------------------------------------------------
  {
    const rng = new Rng(17);
    scene(0, rng);
    const a = ActorSpawn(0x9300, SpawnClass.Frog, 0x1b, "frog", {
      pos: vec3(50, -8, -432),
      class11: {
        char_type: 0x1b, motion: 0x141, cam_path: 41, cam_frame: 55,
        wedge: 0,
        commands: [{ op: 3, args: [0x3800] }, { op: 7, args: [] }],
      },
    }, rng);
    const t = () => (a as { frog: FrogTail }).frog;
    check("a frog joins both enemy counters",
          G.g_enemies_alive === 1 && G.g_enemies_present === 1,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
    check("...snapped to the ground plane, which is a constant and not a query",
          a.pos.y === G.g_camera_fixed_eye_y, `${a.pos.y}`);
    // atan2(320, 640.2) is 26.55 degrees; less 0x200 that is 23.7, which is
    // 0x10E2 in BAMS. A wedge read straight off a zero tail would be 0.
    check("...and its wedge is the half-FOV less 0x200 when the tail says 0",
          t().wedge === 0x10e2, `0x${t().wedge.toString(16)}`);

    G.g_active_cam_path = 40;
    G.g_cam_path_frame = 999;
    FrogUpdate(a, frame(rng));
    check("state 0 holds while the camera is on a different path",
          t().state === FrogState.WaitForCamera, FrogState[t().state]);
    G.g_active_cam_path = 41;
    FrogUpdate(a, frame(rng));
    FrogUpdate(a, frame(rng));
    check("...and the cue takes the next command, which is the absolute turn",
          t().state === FrogState.HopToHeading && t().cursor === 1,
          `${FrogState[t().state]} cursor ${t().cursor}`);
  }

  {
    const rng = new Rng(19);
    scene(0, rng);
    const a = ActorSpawn(0x9301, SpawnClass.Frog, 0x1b, "frog", {
      pos: vec3(0, 0, 40),
      class11: {
        char_type: 0x1b, motion: 0x141, cam_path: 41, cam_frame: 0, wedge: 0,
        commands: [],
      },
    }, rng);
    const t = () => (a as { frog: FrogTail }).frog;
    const score = G.g_player_score[0];
    a.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
    FrogUpdate(a, frame(rng));
    check("one shot kills a frog -- there is no hit-point arithmetic",
          t().state === FrogState.Die && a.hp === 0,
          `${FrogState[t().state]} hp ${a.hp}`);
    check("...paying 80", G.g_player_score[0] - score === 80,
          `${G.g_player_score[0] - score}`);
    check("...and the alive count comes down while the present count does not",
          G.g_enemies_alive === 0 && G.g_enemies_present === 1,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
    check("...with the corpse model on bone 1 and bones 2 and 3 blanked",
          a.boneSlot["1"] === 0xb91 && a.boneSlot["2"] === 0
          && a.boneSlot["3"] === 0,
          JSON.stringify(a.boneSlot));
  }

  {
    // Inside fifty units the frog takes a permit and leaps; if the permit is
    // already out it idles instead, which is `L9` made a test.
    const rng = new Rng(23);
    scene(0, rng);
    const a = ActorSpawn(0x9302, SpawnClass.Frog, 0x1b, "frog", {
      pos: vec3(0, 0, 10),
      class11: {
        char_type: 0x1b, motion: 0x141, cam_path: 41, cam_frame: 0, wedge: 0,
        commands: [],
      },
    }, rng);
    const t = () => (a as { frog: FrogTail }).frog;
    t().camDist = 10;
    t().flags |= FrogFlag.WantCommand;
    FrogReadNextScriptCommand(a, frame(rng));
    check("a frog inside fifty units leaps, and takes a permit to do it",
          t().state === FrogState.LeapAtPlayer && a.attackPermit === 0
          && G.g_attack_permits[0] === a.at,
          `${FrogState[t().state]} permit ${a.attackPermit}`);

    const b = ActorSpawn(0x9303, SpawnClass.Frog, 0x1b, "frog", {
      pos: vec3(0, 0, 10),
      class11: {
        char_type: 0x1b, motion: 0x141, cam_path: 41, cam_frame: 0, wedge: 0,
        commands: [],
      },
    }, rng);
    const bt = () => (b as { frog: FrogTail }).frog;
    bt().camDist = 10;
    bt().flags |= FrogFlag.WantCommand;
    FrogReadNextScriptCommand(b, frame(rng));
    check("...and a second one idles rather than leaping without one",
          bt().state === FrogState.IdleAndCroak && b.attackPermit === -1,
          `${FrogState[bt().state]} permit ${b.attackPermit}`);
  }

  // -- class 0x43, the owl --------------------------------------------------
  {
    const rng = new Rng(29);
    scene(0, rng);
    G.g_players_in_play = 1;
    const mk = (at: number, subtype: number, member: number) =>
      ActorSpawn(at, SpawnClass.FlyingEnemy, -1, "owl", {
        pos: vec3(-644, 128, -943),
        class43: { subtype, member },
      }, rng);
    const kept = [mk(0x9400, 1, 0), mk(0x9401, 1, 1)];
    const gone = [mk(0x9402, 1, 2), mk(0x9403, 1, 3)];
    check("one player faces two owls of a sub-type, not four",
          kept.every((o) => !o.despawned) && gone.every((o) => o.despawned),
          gone.map((o) => o.despawned).join(","));
    check("...and only the survivors are counted",
          G.g_enemies_alive === 2 && G.g_enemies_present === 2,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
  }

  {
    const rng = new Rng(31);
    scene(0, rng);
    G.g_players_in_play = 2;
    const owls = [0, 1, 2, 3].map((m) =>
      ActorSpawn(0x9500 + m, SpawnClass.FlyingEnemy, -1, "owl", {
        pos: vec3(-644, 128, -943),
        class43: { subtype: 1, member: m },
      }, rng));
    const tail = (o: Actor) => (o as { owl: OwlTail }).owl;
    check("two players face all four", owls.every((o) => !o.despawned));
    check("...perched, with the token free",
          owls.every((o) => tail(o).state === OwlState.WaitLaunch)
          && G.g_class43_attack_token === -1,
          `${G.g_class43_attack_token}`);

    // Member 0 has no delay and no holding circle: it leaves on its first
    // frame, straight onto the approach spline.
    OwlUpdateAndResolveShot(owls[0], frame(rng));
    check("member 0 goes straight to its run-in",
          tail(owls[0]).state === OwlState.Approach,
          OwlState[tail(owls[0]).state]);
    // Members 1..3 wait 20, 40 and 60 frames.
    // `timer` is compared **after** its increment, so member 1's twenty
    // frames of delay take twenty-one updates to expire.
    for (let i = 0; i < 21; i += 1) OwlUpdateAndResolveShot(owls[1], frame(rng));
    check("member 1 waits twenty frames and then flies to the holding circle",
          tail(owls[1]).state === OwlState.FlyToCircle,
          OwlState[tail(owls[1]).state]);
    check("...to a hard-coded point, not to its own spawn",
          tail(owls[1]).centreX === -640 && tail(owls[1]).centreZ === -950,
          `${tail(owls[1]).centreX},${tail(owls[1]).centreZ}`);
    for (let i = 0; i < 19; i += 1) OwlUpdateAndResolveShot(owls[2], frame(rng));
    check("...and member 2 is still perched at the same moment",
          tail(owls[2]).state === OwlState.WaitLaunch,
          OwlState[tail(owls[2]).state]);
  }

  {
    // The sub-type-0 owl cannot be shot until the camera has gone far enough.
    const rng = new Rng(37);
    scene(0, rng);
    G.g_players_in_play = 2;
    const o = ActorSpawn(0x9600, SpawnClass.FlyingEnemy, -1, "owl", {
      pos: vec3(0, 0, 40), class43: { subtype: 0, member: 0 },
    }, rng);
    const t = () => (o as { owl: OwlTail }).owl;
    G.g_cam_path_frame = 100;
    o.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
    OwlUpdateAndResolveShot(o, frame(rng));
    check("a sub-type-0 owl is invulnerable before camera frame 682",
          t().state !== OwlState.Dead, OwlState[t().state]);
    G.g_cam_path_frame = 700;
    o.flags |= ActorFlag.Hit | ActorFlag.HitByPlayer0;
    const score = G.g_player_score[0];
    OwlUpdateAndResolveShot(o, frame(rng));
    check("...and killable after it, for 80",
          t().state === OwlState.Dead && G.g_player_score[0] - score === 80,
          `${OwlState[t().state]} +${G.g_player_score[0] - score}`);
    check("...giving the token back if it was diving",
          G.g_class43_attack_token === -1, `${G.g_class43_attack_token}`);
    for (let i = 0; i < 0x79; i += 1) OwlUpdateAndResolveShot(o, frame(rng));
    check("...and the corpse lasts 121 frames", o.despawned, `${o.despawned}`);
  }

  {
    // The strike is a distance, not a clip frame.
    const rng = new Rng(41);
    scene(0, rng);
    G.g_players_in_play = 1;
    G.g_active_player = 0;
    const o = ActorSpawn(0x9700, SpawnClass.FlyingEnemy, -1, "owl", {
      pos: vec3(0, 0, 2), class43: { subtype: 1, member: 0 },
    }, rng);
    const t = () => (o as { owl: OwlTail }).owl;
    t().state = OwlState.Dive;
    t().dive = OwlDiveKind.Home;
    o.attackPermit = 0;
    G.g_class43_attack_token = 0;
    const lives = G.g_player_lives[0];
    OwlStateDiveAtCamera(o, frame(rng));
    check("an owl inside five units of the eye takes a life",
          G.g_player_lives[0] === lives - 1,
          `${lives} -> ${G.g_player_lives[0]}`);
    check("...then peels off and releases the token",
          t().state === OwlState.OrbitAway && G.g_class43_attack_token === -1,
          `${OwlState[t().state]} ${G.g_class43_attack_token}`);
  }
}

// -- the bone cel runs, and the hit slot that phases them ------------------
//
// `ZombieDrawBonePart` (`FUN_004534A0`) is a *draw* hook, so what it draws is
// the renderer's; what is asserted here is the two halves of it that are game
// state -- the table's own shape against the measured models, and the
// `g_hit_slots` claim that gives each actor its phase.
{
  // The arm the bug report is about. `0x1B3D` draws *neither* itself nor one
  // model: a 20-cel chest and a 30-cel lower torso, which is why reading only
  // the last five of the lower run made five look like a meaningful count.
  const torso = g_class30_bone_cels[0x1b3d];
  check("the undamaged char_adv02 torso draws two runs and not itself",
        !!torso && !torso.self && torso.runs.length === 2,
        `${torso?.self} ${torso?.runs.length}`);
  check("...a 20-cel chest at 0x1B3E and a 30-cel lower torso at 0x1B52",
        torso.runs[0].base === 0x1b3e && torso.runs[0].count === 20
        && torso.runs[1].base === 0x1b52 && torso.runs[1].count === 30,
        torso.runs.map((r) => `${r.base.toString(16)}+${r.count}`).join(" "));

  // The check on the whole reading: the two chest-only damage stages take the
  // lower run and the three that carry their own abdomen are not in the table
  // at all. `0x1B72`, `0x1B73` and `0x1B74` reach y -2.02 in their own
  // geometry; `0x1B70` and `0x1B71` stop at y 1.35.
  for (const slot of [0x1b70, 0x1b71]) {
    const arm = g_class30_bone_cels[slot];
    check(`0x${slot.toString(16).toUpperCase()} draws itself and the lower torso`,
          !!arm && arm.self && arm.runs.length === 1
          && arm.runs[0].base === 0x1b52,
          `${arm?.self} ${arm?.runs.length}`);
  }
  for (const slot of [0x1b72, 0x1b73, 0x1b74]) {
    check(`0x${slot.toString(16).toUpperCase()} is not a trigger at all`,
          g_class30_bone_cels[slot] === undefined,
          `${g_class30_bone_cels[slot] !== undefined}`);
  }
  // Every cel the table can ask for has to be in the bundle, or the draw finds
  // nothing -- which is the hole this fixes, one level down.
  const cels = ZombieBoneCelSlots();
  // 20 + 30 + 5 + 5 + 120 + 18 + 50 + 50: the lower-torso run is named by
  // three arms and counted once, which is the point of asking for the set.
  check("the table names 298 distinct cels across its nine arms",
        cels.length === 298, `${cels.length}`);

  // The phase. `obj+0x3C` is claimed by `ActorBuildSkinnedModel`, which every
  // skinned `Init` calls, and the port claims it in `ActorSpawn` for the
  // classes whose `Init` is a proved caller.
  const rng = new Rng(97);
  scene(0, rng);
  const a = ActorSpawn(0x9800, SpawnClass.Zombie, 0, "znA", {}, rng);
  const b = ActorSpawn(0x9804, SpawnClass.Zombie, 0, "znB", {}, rng);
  check("two zombies take different hit slots, so different cel phases",
        a.hitSlot === 0 && b.hitSlot === 1, `${a.hitSlot} ${b.hitSlot}`);
  check("...and the claim raises obj+0x38 bit 0x40",
        (a.flags38 & HIT_SLOT_CLAIMED) !== 0,
        `0x${a.flags38.toString(16)}`);
  // A class whose `Init` the engine is not proved to build a skinned model in
  // does not claim, rather than a guess that would shift every index.
  const mouse = ActorSpawn(0x9808, SpawnClass.Mouse, -1, "mouse", {}, rng);
  check("a class with no proved model build claims nothing",
        mouse.hitSlot === -1, `${mouse.hitSlot}`);
  // `ActorDespawn` hands the slot back, and the next claim takes it.
  ActorDespawn(a);
  check("a despawn hands the slot back",
        a.hitSlot === -1 && G.g_hit_slots[0] === -1,
        `${a.hitSlot} ${G.g_hit_slots[0]}`);
  const c = ActorSpawn(0x980c, SpawnClass.Zombie, 0, "znC", {}, rng);
  check("...and the next zombie takes the freed one, not the next index",
        c.hitSlot === 0, `${c.hitSlot}`);
  // Fourteen deep, and the engine does not guard the overflow either: the
  // fifteenth claimant keeps -1, which `render/characters/cels.ts` reads as a
  // negative cel index and therefore as no cel.
  const many: number[] = [];
  for (let i = 0; i < 14; i += 1) {
    many.push(ActorSpawn(0x9900 + i * 4, SpawnClass.Zombie, 0, "zn", {},
                         rng).hitSlot);
  }
  // Two are already held, so twelve of the fourteen claims land and the last
  // two find the table full.
  check("the table is fourteen deep and the overflow claimants get -1",
        many.filter((n) => n >= 0).length === 12
        && many.slice(-2).every((n) => n === -1)
        && new Set(many.filter((n) => n >= 0)).size === 12,
        many.join(","));
}

// -- the creature `znjoe` releases ------------------------------------------

/**
 * `ActorReactToHit`'s `znjoe` arm, the state it leads to, and the thing that
 * comes out of the chest.
 *
 * All of it was read and named and none of it was ported, which is why the
 * assertions here are mostly about *edges that did not exist*: state 25 had
 * no `case`, `g_body_creatures` had no entries, and the two enemy counters
 * never saw an object that in the engine has to be shot before a room can
 * clear.
 */
console.log("\nznjoe's creature:");
{
  /** `znjoe`. The one character type `ActorReactToHit` tests for. */
  const JOE = 0x0a;
  const joeType = {
    ...CHARS.types["1"], type: JOE, name: "znjoe", file: "znjoe.bin",
    bones: [
      // The torso, with an **escalating** first step so a hit on it resolves
      // as result 1. `0x1CF1` stands in for `g_pBoneEffectSlots[0x0A][7]`,
      // the slot the release swaps bone 1 to.
      { bone: 1, part: "torso", slot: 1, offset: [0, 0, 0], parent: null,
        damage_rank: [], hit_radius: 3,
        steps: [[0x1cf0, EffectCode.Escalate, 3],
                [0x1cf1, EffectCode.Escalate, 3],
                [0x1cf2, EffectCode.Last, 3]] },
      { bone: 4, part: "r_upperarm", slot: 4, offset: [0, 0, 0], parent: null,
        damage_rank: [], hit_radius: 2,
        steps: [[0x11, EffectCode.Escalate, 3]] },
      { bone: 2, part: "head", slot: 0x30, offset: [0, 0, 0], parent: null,
        damage_rank: [], hit_radius: 2, steps: [] },
    ],
    motions: {
      ...CHARS.types["1"].motions,
      // 0x1E3 the walk it backs out on and 0x1DF the clip it opens on, both
      // with the play length the shipped table gives them:
      // `g_motion_play_length` (0x004E07D0) is **155** at index 479 and 79 at
      // 483. The 155 is the reason the release can happen at all -- the
      // countdown the state arms is 95 to 104 frames and the clip ending is
      // what hands over to the death state, so a clip shorter than the
      // countdown would leave every znjoe dying with its chest closed. A
      // fixture with 40 frames does exactly that, which is how this line
      // came to be pinned.
      "483": motion(40, 0, 79), "479": motion(78, 0, 155),
    },
  } as unknown as CharacterType;
  const joeChars = {
    ...CHARS, types: { "1": CHARS.types["1"], "10": joeType },
  } as unknown as CharactersJson;

  /** A host that can pose bone 1 and has a camera at the origin. */
  const JOE_HOST: GameHost = {
    boneWorld: (_at, bone, out) => {
      if (bone !== 1) return false;
      out.x = 0; out.y = 5; out.z = 40;
      return true;
    },
    aimPoint: (_ahead, out) => { out.x = 0; out.y = 0; out.z = 0; },
    viewPoint: () => undefined,
    viewSpaceOf: () => false,
    // A camera at the origin looking down `-Z`, so camera space is the world
    // with `z` negated -- enough to prove which space the flight is in.
    viewSpaceOfPoint: (pt, out) => {
      out.x = pt.x; out.y = pt.y; out.z = -pt.z;
      return true;
    },
    setBoneSlot: () => undefined,
  };

  function joeScene(rng: Rng): { joe: ZombieActor; events: Events } {
    ResetGameGlobals();
    SetGameTables(joeChars);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_player_lives = [PLAYER.start_lives, PLAYER.start_lives];
    G.g_player_state = [5, 5];
    G.g_app_state = AppState.InPlay;
    G.g_nFiringGate = 1;
    const joe = spawnZombie(0x0a68, JOE, "znjoe", {}, rng);
    joe.visible = true;
    joe.attackState = 1;
    joe.hp = 100;
    joe.pos = vec3(0, 0, 40);
    joe.motion = 10;
    return { joe, events: new Events() };
  }

  // -- 1. the arm, and the frame it has to happen on -----------------------
  //
  // `ResolveHit` charges the damage and withholds the stagger; the arm itself
  // runs in `ZombieOnShot`, which is where the engine calls
  // `ActorReactToHit` -- at `0x0045401A`, **after** the death test at
  // `0x00453F46` that reads the very bit the arm raises. Called any earlier
  // than that, the arm sets state 25 and `ZombieOnShot` overwrites it with
  // {@link ZombieState.Death} on the same frame, which is what it did.
  {
    const rng = new Rng(11);
    const { joe, events } = joeScene(rng);
    const score = G.g_player_score[0];
    const out = ResolveHit(joe, 1, 0, JOE_HOST, rng, 0);
    check("a torso hit on znjoe plays no stagger and leaves it alive",
          out.react === undefined && out.result === 1 && joe.hp > 0
          && !joe.dead,
          `react ${out.react} result ${out.result} hp ${joe.hp}`);
    check("...and the hit carries the player who fired it, per `obj+0x190`",
          joe.pendingHit?.player === 0,
          `${JSON.stringify(joe.pendingHit)}`);
    GameUpdate(EYE, 1 / 60, JOE_HOST, rng, events);
    check("...and `ZombieOnShot` puts it in state 25, not a death state",
          joe.state === ZombieState.ReleaseBodyCreature,
          `state ${joe.state} sub ${joe.sub}`);
    check("...the same OR marks it dead and undismemberable",
          (joe.flags & ActorFlag.Dead) !== 0
          && (joe.flags & ActorFlag.NoDismember) !== 0,
          `flags ${joe.flags.toString(16)}`);
    check("...pays the shooter 0x50 and records who fired",
          G.g_player_score[0] === score + 0x50 && joe.killedBy === 0,
          `score ${G.g_player_score[0]} killedBy ${joe.killedBy}`);

    // Once-only, and the latch is `NoDismember` -- which the same OR raised.
    joe.state = ZombieState.HoldAtRange;
    joe.sub = 0;
    joe.hp = 100;
    joe.flags &= ~(ActorFlag.ShotImmune as number);
    joe.flags2 &= ~(ZombieFlag2.DiedInFlight as number);
    ResolveHit(joe, 1, 0, JOE_HOST, rng, 0);
    GameUpdate(EYE, 1 / 60, JOE_HOST, rng, events);
    check("a second torso hit does not open it again",
          joe.state !== ZombieState.ReleaseBodyCreature, `state ${joe.state}`);
  }

  // Neither of the other two conditions may be dropped.
  {
    const rng = new Rng(12);
    const { events } = joeScene(rng);
    const other = spawnZombie(0x2000, 1, "not a znjoe", {}, rng);
    other.hp = 100;
    other.visible = true;
    ResolveHit(other, 1, 0, JOE_HOST, rng, 0);
    GameUpdate(EYE, 1 / 60, JOE_HOST, rng, events);
    check("another character type's torso hit is an ordinary hit",
          other.state !== ZombieState.ReleaseBodyCreature,
          `state ${other.state}`);
  }
  {
    const rng = new Rng(13);
    const { joe, events } = joeScene(rng);
    ResolveHit(joe, 4, 0, JOE_HOST, rng, 0);
    GameUpdate(EYE, 1 / 60, JOE_HOST, rng, events);
    check("and a znjoe shot in the arm is too -- the bone is bone 1",
          joe.state !== ZombieState.ReleaseBodyCreature, `state ${joe.state}`);
  }

  // -- 2. the state --------------------------------------------------------
  {
    const rng = new Rng(14);
    const { joe, events } = joeScene(rng);
    joe.state = ZombieState.ReleaseBodyCreature;
    joe.sub = 0;
    // Inside the inner ring (25), which is where a zombie shot at close range
    // is. The engine walks it back out before the chest opens.
    joe.pos = vec3(0, 0, 10);
    joe.attackPermit = 0;
    G.g_attack_permits[0] = joe.at;
    for (let i = 0; i < 5; i++) {
      GameUpdate(EYE, 1 / 60, JOE_HOST, rng, events);
    }
    check("inside the inner ring it plays the walk and stays in sub 1",
          joe.motion === 0x1e3 && joe.sub === 1,
          `motion ${joe.motion} sub ${joe.sub}`);
    check("...and it is dead already: sub 0 zeroed the hit points",
          joe.hp === 0, `hp ${joe.hp}`);
    check("...and is immune to a second shot while it finishes",
          (joe.flags & ActorFlag.ShotImmune) !== 0,
          `flags ${joe.flags.toString(16)}`);

    // Out past the ring, and the clip starts.
    joe.pos = vec3(0, 0, 40);
    GameUpdate(EYE, 1 / 60, JOE_HOST, rng, events);
    check("outside it, the release clip starts and a countdown is armed",
          joe.motion === 0x1df && joe.sub === 3
          && joe.arcTotal >= 0x5f && joe.arcTotal <= 0x5f + 9,
          `motion ${joe.motion} sub ${joe.sub} delay ${joe.arcTotal}`);

    const before = G.g_enemies_alive;
    const want = joe.arcTotal;
    for (let i = joe.arcFrames; i < want + 1; i++) {
      GameUpdate(EYE, 1 / 60, JOE_HOST, rng, events);
    }
    check("on the frame it lands, the torso opens",
          joe.boneSlot["1"] === 0x1cf1 && joe.hits[1] === 1,
          `slot ${joe.boneSlot["1"]} hits ${joe.hits[1]}`);
    check("...the creature is released",
          G.g_body_creatures.length === 1,
          `${G.g_body_creatures.length} creatures`);
    check("...and it is a countable enemy: both counts go up",
          G.g_enemies_alive === before + 1,
          `${before} -> ${G.g_enemies_alive}`);
    check("...the permit goes back, because a corpse must not hold one",
          joe.attackPermit === -1 && G.g_attack_permits[0] === -1,
          `permit ${joe.attackPermit}`);
    check("...and the death-motion bit goes up, which is the same latch",
          (joe.flags2 & ZombieFlag2.DeathMotionVariant) !== 0,
          `flags2 ${joe.flags2.toString(16)}`);
    // ...and only once, however long the clip runs. The clip's play length is
    // 155 and the countdown spent 95 to 104 of it, so the last fifty frames
    // are the zombie standing with its chest open -- and the latch has to
    // hold for every one of them. Counted on the sequence rather than on the
    // live list, because the one creature flies off, hits the player and
    // falls out of the world inside that window.
    const n = G.g_body_creature_seq;
    for (let i = 0; i < 80; i++) {
      GameUpdate(EYE, 1 / 60, JOE_HOST, rng, events);
    }
    check("...exactly once, however long the clip runs",
          G.g_body_creature_seq === n, `${n} -> ${G.g_body_creature_seq}`);
    check("...and when the clip ends the zombie dies its own death",
          joe.state === ZombieState.Death
          || joe.state === ZombieState.CorpseSink
          || joe.state === ZombieState.CorpseBlink,
          `state ${joe.state}`);
  }

  // -- 3. the flight -------------------------------------------------------
  {
    const rng = new Rng(15);
    const { joe, events } = joeScene(rng);
    const c = SpawnBodyCreature(joe);
    check("a new creature rides the host's bone",
          c.state === BodyCreatureState.RideHostBone);
    const sounds: number[] = [];
    events.on("sound.play", (e) => sounds.push(e.id));
    BodyCreatureUpdate(c, rng, JOE_HOST, events);
    // The host's bone is at world (0, 5, 40) and the stub's camera space
    // negates z, so the launch point is (0, 6.5, -40): the 1.5 lift is added
    // in *world* and z comes back negative, which is in front of the eye.
    check("...and launches into camera space, lifted by 1.5",
          c.state === BodyCreatureState.Fly
          && Math.abs(c.flight.start.y - 6.5) < 1e-6
          && c.flight.start.z === -40,
          `start ${JSON.stringify(c.flight.start)}`);
    check("...with the launch range measured to the eye",
          Math.abs(c.flight.range - 40) < 1e-6, `range ${c.flight.range}`);
    check("...and plays COMMON\\MEET01_22.WAV", sounds.includes(0x3a16a9),
          `sounds ${sounds.map((x) => x.toString(16)).join(",")}`);
    // One player, so the end point is the origin of camera space: the eye.
    check("...aimed at the eye, because there is one player",
          c.flight.endX === 0 && c.flight.endZ === 0);

    // The arc: a one-unit half-sine over the descent, and it is **zero at
    // both ends** -- `t * 65536 * 5/9` BAMS passes through exactly pi at
    // `t = 0.9`, which is the same `t` the arrival latches on. `c.t` is
    // already the *next* step by the time the call returns, so the t that
    // produced this frame's position is the one read before it.
    let peak = 0;
    let frames = 0;
    let last = 0;
    while (c.arrived === 0 && frames < 240) {
      const t = c.t;
      BodyCreatureUpdate(c, rng, JOE_HOST, events);
      last = c.pos.y - c.flight.start.y * (1 - t);
      peak = Math.max(peak, last);
      frames++;
    }
    check("the flight arrives in about twenty-four frames",
          frames >= 20 && frames <= 30, `${frames} frames`);
    check("...having humped a unit above the straight line",
          peak > 0.95 && peak <= 1.0, `peak ${peak}`);
    check("...and come back down onto it by the time it arrives",
          Math.abs(last) < 0.1, `arc ${last}`);
    check("...which leaves it a tenth of the way above the eye it left from",
          c.pos.y > 0 && c.pos.y < c.flight.start.y * 0.2,
          `y ${c.pos.y} of ${c.flight.start.y}`);
    check("...and the sprite cursor has walked the forty-slot loop",
          c.slot >= 0x1d31 && c.slot <= 0x1d31 + 0x27, `slot ${c.slot}`);

    // Thirty frames later it takes a life -- and only then. The arrival frame
    // steps the counter twice, once to latch and once as the delay's own
    // increment, so twenty-eight more frames is the last one that is safe.
    const lives = G.g_player_lives[0];
    for (let i = 0; i < 0x1e - 2; i++) {
      BodyCreatureUpdate(c, rng, JOE_HOST, events);
    }
    check("it does not hit the player the moment it arrives",
          G.g_player_lives[0] === lives, `lives ${G.g_player_lives[0]}`);
    BodyCreatureUpdate(c, rng, JOE_HOST, events);
    check("...it hits thirty frames later",
          G.g_player_lives[0] === lives - 1 && G.g_player_was_hit[0] === 1,
          `lives ${G.g_player_lives[0]}`);
    check("...and starts falling",
          c.state === BodyCreatureState.FallAfterHit,
          `state ${BodyCreatureState[c.state]}`);

    // The fall's tumble **accelerates**: `tail+0x24` starts at -0x200 and is
    // multiplied by 1.01 every frame, so a creature that has fallen for ten
    // frames is turning faster than one that has fallen for one. The clamp at
    // -0x4000 exists but is not reached from here -- 0.010888 a frame takes
    // the body below `y = -3` in about forty frames and the accumulated spin
    // needs about fifty -- so it is the growth that is asserted and not the
    // clamp.
    const spin0 = c.flight.fallSpin;
    for (let i = 0; i < 10; i++) BodyCreatureUpdate(c, rng, JOE_HOST, events);
    check("the fall's tumble accelerates, and the wrong way for a miss",
          c.flight.fallSpin < spin0 && c.pitch < 0,
          `spin ${spin0} -> ${c.flight.fallSpin} pitch ${c.pitch}`);

    const alive = G.g_enemies_alive;
    const present = G.g_enemies_present;
    let live = true;
    for (let i = 0; i < 600 && live; i++) {
      live = BodyCreatureUpdate(c, rng, JOE_HOST, events);
    }
    check("it falls out of the world and drops both counters",
          !live && G.g_enemies_alive === alive - 1
          && G.g_enemies_present === present - 1,
          `alive ${alive} -> ${G.g_enemies_alive}`);
  }

  // -- 4. shooting it ------------------------------------------------------
  {
    const rng = new Rng(16);
    const { joe, events } = joeScene(rng);
    const c = SpawnBodyCreature(joe);
    BodyCreatureUpdate(c, rng, JOE_HOST, events);   // launch
    const sounds: number[] = [];
    events.on("sound.play", (e) => sounds.push(e.id));
    const score = G.g_player_score[0];
    MarkBodyCreatureShot(c, 0);
    BodyCreatureUpdate(c, rng, JOE_HOST, events);
    check("a shot creature pays 0x50",
          G.g_player_score[0] === score + 0x50,
          `${score} -> ${G.g_player_score[0]}`);
    check("...plays COMMON\\MEET02_22.WAV", sounds.includes(0x3b16a9),
          `sounds ${sounds.map((x) => x.toString(16)).join(",")}`);
    check("...leaves blood at the point it was hit",
          G.g_point_blood_sprays.length === 1,
          `${G.g_point_blood_sprays.length} sprays`);
    check("...and falls the other way",
          c.state === BodyCreatureState.FallShot && c.flight.fallSpin > 0,
          `state ${BodyCreatureState[c.state]} spin ${c.flight.fallSpin}`);
    const lives = G.g_player_lives[0];
    const spin0 = c.flight.fallSpin;
    for (let i = 0; i < 10; i++) BodyCreatureUpdate(c, rng, JOE_HOST, events);
    check("...and tumbles the other way, accelerating",
          c.flight.fallSpin > spin0 && c.pitch > 0,
          `spin ${spin0} -> ${c.flight.fallSpin} pitch ${c.pitch}`);
    let live = true;
    for (let i = 0; i < 600 && live; i++) {
      live = BodyCreatureUpdate(c, rng, JOE_HOST, events);
    }
    check("...and never reaches the player", G.g_player_lives[0] === lives,
          `lives ${G.g_player_lives[0]}`);
    check("...and leaves on its own", !live);
  }

  // -- 5. the pool ---------------------------------------------------------
  {
    const rng = new Rng(17);
    const { joe, events } = joeScene(rng);
    SpawnBodyCreature(joe);
    check("the pool is stepped by `GameUpdate`, like the thrown weapons",
          G.g_body_creatures.length === 1);
    GameUpdate(EYE, 1 / 60, JOE_HOST, rng, events);
    check("...so a creature launches without anybody calling it directly",
          G.g_body_creatures[0].state === BodyCreatureState.Fly,
          `state ${BodyCreatureState[G.g_body_creatures[0].state]}`);
    check("...and a reset empties it",
          (ResetGameGlobals(), G.g_body_creatures.length === 0));
  }
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
