/**
 * Class 0x19 — **the stage-4 boss**, Strength, and the eight
 * `wait_script_flag` gates behind it.
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
 * fifteen nodes — and the fifteen dwords after it are **per-bone collision
 * meshes** in `coli4.bin` (ten of them; five are -1 and keep their hit
 * spheres), which is why a shot at his body sparks or bleeds by where it lands.
 * `+0x40`/`+0x42` are the camera path and frame that despawn him.
 *
 * ## The fight
 *
 * Nine **phases** per arena — 0..8 on camera path 185 (entrances 0 and 2),
 * 9..17 on path 193 (1 and 3). Each phase's share of the hit points is a floor
 * (`g_boss4_phase_hp_fraction`); head shots do the damage, by rank and player
 * count (`g_boss4_head_damage`), and reaching the floor makes him refuse shots
 * until the arena moves him on. The move is his own: he plays a camera cue
 * (`camera.ts`), and when `g_cam_path_frame` passes the phase's threshold he is
 * seated at the next spot with the next phase's arena (`arena.ts`). Between
 * moves he approaches the camera and strikes, charges past it, or — in phases
 * 3 and 13 — throws the two props he carries (`attack.ts`, `fight.ts`). The
 * last phase's floor is 0; the death (`death.ts`) raises `g_script_flags[32]`
 * on clip frame 0x46 and he is despawned when the camera reaches the tail's
 * pair. `docs/re/boss-strength.md` has the whole reading.
 *
 * | | |
 * |---|---|
 * | `Boss4Init` (`FUN_004917E0`) | here |
 * | `Boss4Update` (`FUN_004919D0`) | here |
 * | states 0–3, the entrances | `entrance.ts` |
 * | states 4–0xE | `fight.ts` |
 * | states 0xF–0x13, `Boss4SpawnHeldProp` | `attack.ts` |
 * | states 0x14–0x17, `Boss4ResumeAfterHit` | `death.ts` |
 * | `Boss4ResolveShot` and the damage | `shot.ts` |
 * | the bone hit marks | `hit_mark.ts` |
 * | the arena progression, the fence | `arena.ts` |
 * | the camera cues | `camera.ts` |
 * | footfalls, the draw half, the rank, the chainsaw | `frame.ts` |
 */
import type { Actor } from "../actor";
import { ActorFlag } from "../actor";
import { ActorSetMotion } from "../class30/motion_cue";
import { ActorDespawn } from "../despawn";
import { G, HIT_SLOT_NONE } from "../globals";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";
import {
  Boss4AdvanceArenaWaypoint, Boss4AdvancePhaseAtFloor,
  Boss4ArmPhaseWhenInsideArena, Boss4KeepInsideEdge, Boss4TrackWhenInsideArena,
  FENCE_MARGIN,
} from "./arena";
import {
  Boss4StateChargePastCamera, Boss4StateStrikeClip65, Boss4StateStrikeClip7A,
  Boss4StateStrikeClip7B, Boss4StateThrowHeldProp,
} from "./attack";
import { Boss4PlayCameraCue } from "./camera";
import {
  BOSS4_DEAD_FLAG, Boss4StateDeath, Boss4StateDebugFreeMove,
  Boss4StateFlinch, Boss4StateKnockDown,
} from "./death";
import {
  BOSS4_DROP_FLAG, BOSS4_FIGHT_READY_FLAG,
  Boss4StateEntranceCarried, Boss4StateEntranceDropped,
} from "./entrance";
import {
  Boss4StateApproachCamera, Boss4StateChooseAction, Boss4StateFaceCamera,
  Boss4StateHoldThenApproach, Boss4StateHoldUntilPlayerFree,
  Boss4StatePlayArrivalClip, Boss4StateTurnClipThenApproach,
  Boss4StateTurnToStoredPoint, Boss4StateWaitForPlayer, Boss4StateWalkToPoint,
  Boss4StateWithdrawAndAdvancePhase,
} from "./fight";
import {
  Boss4AdjustRank, Boss4AdvanceMotionAndDrawHeldProps,
  Boss4ChainsawCueByCameraFrame, Boss4FootfallShake,
} from "./frame";
import { Boss4ResolveShot } from "./shot";
import {
  BOSS4_BLADE_BONE, BOSS4_CAMERA_RISE, Boss4BlockNew, Boss4Clip, Boss4Flag,
  Boss4State,
} from "./state";
import type { Boss4Block as Blk } from "./state";
import { BOSS4_BLADE_FIRST } from "./slots";

/** `MOV dword ptr [ESI + 0x124], 0x41F00000` at `0x00491885` -- 30.0. */
const BOSS4_HIT_RADIUS = 30;
/** `MOV byte ptr [ECX + 0x9], 0x2` -- the props he carries in. */
const BOSS4_PROPS = 2;
/** `MOV byte ptr [EDX + 0x8], 0xFF` -- no phase until the entrance seats one. */
const BOSS4_NO_PHASE = 0xff;
/** The tail's per-bone words cover records 1..15. */
const BOSS4_TAIL_BONES = 15;

/**
 * `Boss4Init` — `FUN_004917E0`. The whole of the constructor.
 *
 * ```
 * st = ActorAllocSub(0xA4); obj+0x34 |= 0x8000
 * char+0x60 = tail[0]; char+0x20 = 0x7C; char+0x00 = char+0x08 = 0
 * ActorBuildSkinnedModel(char, obj+0x40, char+0x78); char+0x68 = 1
 * char+0x348 = 0x444                       -- bone 5's model
 * obj+0x124 = 30.0; g_enemies_present++; g_enemies_alive++
 * obj+0x121 = obj+0x120 = 0xFF; RegisterEnemySlot(obj)
 * st.state = tail[1]; st.flags = state <= 1 ? 1 : 0; st+0x10 = g_civilian_carrier (<= 1)
 * st.sub = 0; st.rank = GetDamageRank(); st.hits = 0; st.lives = (u8) both players'
 * for bone 1..15: record +0x88 = tail dword; != -1: record +0x74 |= 0x51, +0x78 = 0
 * st.phase = 0xFF; st+0x24 = 0; st+0x09 = 2; st+0x0A = 0; st+0x1C = 0; st+0x22 = -1; st+0x70 = 6.0
 * ```
 *
 * * `char+0x60` is the character type, which the descriptor already carries.
 * * `ActorBuildSkinnedModel` is the renderer's and the hit-slot claim's
 *   (`spawn.ts`); `char+0x68 = 1` is the rotation order `RotX RotZ RotY`,
 *   which is how every actor is drawn.
 * * `RegisterEnemySlot` (`FUN_00408E80`, `0x004918AB`) is the port's
 *   per-frame slot pass, `camera/slots.ts`.
 * * The per-bone words are `obj.boneColi`: a record with one is shot-tested
 *   against its mesh (`ShotTestBoneMesh`) and not its sphere, which is what
 *   `+0x74 |= 0x51` and the zeroed radius say to `ShotTestBoneTree`.
 */
export function Boss4Init(obj: Actor): void {
  const b = Boss4BlockNew();
  obj.boss4 = b;
  obj.flags |= ActorFlag.NoShotTest;
  ActorSetMotion(obj, Boss4Clip.Entrance);
  obj.boneSlot[String(BOSS4_BLADE_BONE)] = BOSS4_BLADE_FIRST;
  obj.hitRadius = BOSS4_HIT_RADIUS;
  obj.radius = BOSS4_HIT_RADIUS;
  G.g_enemies_present += 1;
  G.g_enemies_alive += 1;
  // `MOV byte ptr [ESI + 0x121], 0xFF` and `+0x120`.
  obj.attackPermit = -1;
  // `RegisterEnemySlot(obj)` -- `FUN_00408E80` at `0x004918AB`: the port's
  // per-frame slot pass (`UpdateCameraEnemySlots`) stands in for it.
  b.state = (obj.class19?.entrance ?? obj.initialState) & 0xff;
  if (b.state <= 1) {
    b.flags = Boss4Flag.OnCarrier;
    // `MOV EDX, [0x009a2c88]; MOV [ECX+0x10], EDX` -- `g_civilian_carrier`,
    // the transport `CarrierPropSelectRoutine` made current earlier in the
    // same `spawn_obj_c`.
    b.carrierAt = G.g_civilian_carrier;
  } else {
    b.flags = 0;
  }
  b.sub = 0;
  // `CALL GetDamageRank; MOV byte ptr [ECX + 0xB], AL` -- the low byte of
  // `g_damage_rank`, signed.
  b.rank = (G.g_damage_rank << 24) >> 24;
  b.headHits = 0;
  b.lives = [(G.g_player_lives[0] ?? 0) & 0xff,
             (G.g_player_lives[1] ?? 0) & 0xff];
  const coli = obj.class19?.bone_coli ?? [];
  for (let bone = 1; bone <= BOSS4_TAIL_BONES; bone++) {
    const key = coli[bone - 1];
    if (key) obj.boneColi[String(bone)] = key;
  }
  b.phase = BOSS4_NO_PHASE;
  b.phaseHpFloor = 0;
  b.propsLeft = BOSS4_PROPS;
  b.propsUsed = 0;
  b.cueStep = 0;
  b.cueQueued = -1;
  b.cameraRise = BOSS4_CAMERA_RISE;
}

/** One entry of `g_class19_states`. */
type Boss4StateFn = (obj: Actor, b: Blk, f: ClassFrame) => void;

/**
 * The dispatch table `Boss4Update` indexes — `g_class19_states`, `0x00597298`,
 * read from memory. A literal array in state order, so the numbers next to it
 * are the engine's own indices.
 */
const BOSS4_STATES: readonly Boss4StateFn[] = [
  Boss4StateEntranceCarried,         // 0     FUN_004938B0
  Boss4StateEntranceDropped,         // 1     FUN_00493B40
  Boss4StateEntranceCarried,         // 2     FUN_004938B0
  Boss4StateEntranceDropped,         // 3     FUN_00493B40
  Boss4StateApproachCamera,          // 4     FUN_00493DC0
  Boss4StateChooseAction,            // 5     FUN_00494010
  Boss4StateHoldThenApproach,        // 6     FUN_004943B0
  Boss4StateFaceCamera,              // 7     FUN_004944A0
  Boss4StatePlayArrivalClip,         // 8     FUN_004945A0
  Boss4StateTurnToStoredPoint,       // 9     FUN_00494610
  Boss4StateTurnClipThenApproach,    // 0xA   FUN_00494730
  Boss4StateWalkToPoint,             // 0xB   FUN_004958F0
  Boss4StateWithdrawAndAdvancePhase, // 0xC   FUN_00495A20
  Boss4StateWaitForPlayer,           // 0xD   FUN_00495D30
  Boss4StateHoldUntilPlayerFree,     // 0xE   FUN_00495D90
  Boss4StateStrikeClip65,            // 0xF   FUN_00494A80
  Boss4StateStrikeClip7A,            // 0x10  FUN_00494B80
  Boss4StateStrikeClip7B,            // 0x11  FUN_00494C70
  Boss4StateThrowHeldProp,           // 0x12  FUN_00494D60
  Boss4StateChargePastCamera,        // 0x13  FUN_00495070
  Boss4StateFlinch,                  // 0x14  FUN_00495340
  Boss4StateKnockDown,               // 0x15  FUN_00495570
  Boss4StateDeath,                   // 0x16  FUN_00495770
  Boss4StateDebugFreeMove,           // 0x17  FUN_00495E20
];

/**
 * `Boss4Update` — `FUN_004919D0`. One boss, one 60 Hz frame, in the engine's
 * order:
 *
 * ```
 * Boss4ResolveShot; Boss4AdvanceArenaWaypoint; Boss4ArmPhaseWhenInsideArena
 * Boss4TrackWhenInsideArena; g_class19_states[state]()
 * Boss4FootfallShake; Boss4AdvanceMotionAndDrawHeldProps; Boss4AdvancePhaseAtFloor
 * ActorRegisterCameraPoint(state+0x70); Boss4PlayCameraCue()
 * flags & 2: the fence -- KeepInsideEdge(P2,P3,5,1) && (P4,P5,5,1); (P3,P4,5,1) && (P5,P2,0,1)
 * Boss4AdjustRank(); Boss4ChainsawCueByCameraFrame()
 * g_active_cam_path == tail+0x40 && g_cam_path_frame == tail+0x42: release the hit slot, ActorDespawn
 * ```
 */
export function Boss4Update(obj: Actor, f: ClassFrame): void {
  const b = obj.boss4;
  if (!b) return;
  const { host, rng, events } = f;

  Boss4ResolveShot(obj, b, host, rng, events);
  Boss4AdvanceArenaWaypoint(obj, b);
  Boss4ArmPhaseWhenInsideArena(obj, b);
  Boss4TrackWhenInsideArena(obj, b);
  BOSS4_STATES[b.state]?.(obj, b, f);
  Boss4FootfallShake(obj, b, f.eye, host, events);
  Boss4AdvanceMotionAndDrawHeldProps(obj, b, host);
  Boss4AdvancePhaseAtFloor(obj, b);
  // ---- `ActorRegisterCameraPoint(state+0x70)` -- `FUN_00409B70`, called at
  // `0x00491A49`, every frame and ungated. The director makes this call for
  // every actor (`director.ts`), with this class's rise from
  // `Boss4Handler.cameraRise` -- `state+0x70` -- and its candidacy from
  // `tracksCamera`; the call is here in the engine's frame order. ----
  Boss4PlayCameraCue(b, host);
  if (b.flags & Boss4Flag.Fenced) {
    const a = b.arena;
    if (Boss4KeepInsideEdge(obj.pos, a[2], a[3], FENCE_MARGIN, true)) {
      Boss4KeepInsideEdge(obj.pos, a[4], a[5], FENCE_MARGIN, true);
    }
    // `PUSH 0` for the last margin -- a float 0.0, not the 5.0 the other
    // three are given (`0x00491AE8`).
    if (Boss4KeepInsideEdge(obj.pos, a[3], a[4], FENCE_MARGIN, true)) {
      Boss4KeepInsideEdge(obj.pos, a[5], a[2], 0, true);
    }
  }
  Boss4AdjustRank(b);
  Boss4ChainsawCueByCameraFrame(b, events);

  // `MOVSX EAX, word ptr [EDI + 0x40]; CMP [g_active_cam_path], EAX` and the
  // frame against `+0x42` -- the despawn, on the outro cut's first frame.
  const tail = obj.class19;
  if (tail && G.g_active_cam_path === tail.despawn_path
      && G.g_cam_path_frame === tail.despawn_frame) {
    // `if (obj+0x3C != -1) g_hit_slots[obj+0x3C] = 0` -- inline, and then
    // `ActorDespawn`'s own release finds the flag and does it again.
    if (obj.hitSlot !== HIT_SLOT_NONE) G.g_hit_slots[obj.hitSlot] = HIT_SLOT_NONE;
    ActorDespawn(obj);
  }
}

/** The sidebar's line for this class. */
function Boss4Debug(obj: Actor): ActorDebug {
  const b = obj.boss4;
  if (!b) return { summary: "boss 4 · no state block" };
  const name = Boss4State[b.state] ?? `state ${b.state}`;
  const detail = [
    `hp ${obj.hp}/${obj.maxHp}, floor ${b.phaseHpFloor.toFixed(1)}`,
    `phase ${b.phase}, rank ${b.rank}, head hits ${b.headHits}`,
    `props left ${b.propsLeft}, cue ${b.cueStep !== 0
      ? `path ${b.cuePath} frame ${b.cueFrame.toFixed(1)}/${b.cueEnd}`
      : b.flags & Boss4Flag.CueQueued ? `queued ${b.cueQueued}` : "none"}`,
    obj.flags & ActorFlag.ShotImmune
      ? "refusing damage -- the phase floor or a transition"
      : "damageable on bone 2",
  ];
  detail.push(`flags 30/31/32: ${G.g_script_flags[BOSS4_DROP_FLAG] ? 1 : 0}`
    + `/${G.g_script_flags[BOSS4_FIGHT_READY_FLAG] ? 1 : 0}`
    + `/${G.g_script_flags[BOSS4_DEAD_FLAG] ? 1 : 0}`);
  return {
    summary: `boss 4 · ${name} sub ${b.sub}`,
    detail,
    hot: b.state === Boss4State.Death,
  };
}

export const Boss4Handler: ClassHandler = {
  init: Boss4Init,
  update: Boss4Update,
  // The death is several sub-states long and the flag lands seventy frames
  // into it. The class never sets `obj.dead` -- its death is its own state
  // machine off `obj+0x34` bit `0x4000000` -- so this is a declaration of
  // intent rather than a path taken.
  updatesWhenDead: true,
  // `Boss4ResolveShot` reads `obj+0x34` bit 3 itself: the boss has one weak
  // bone and a damage table of its own.
  ownsShotResult: true,
  // `Boss4StateEntranceCarried`/`Dropped` raise 31 and `Boss4StateDeath` 32
  // (`0x004958C7`); every link between them is ported.
  raisesScriptFlag: [BOSS4_FIGHT_READY_FLAG, BOSS4_DEAD_FLAG],
  // `Boss4Update` calls `ActorRegisterCameraPoint(state+0x70)` at
  // `0x00491A49` every frame, ungated, and so registers for the camera
  // whenever `obj+0x34` bit `0x10000` is clear. Not in `ENEMY_CLASSES`, so
  // this is the only way in.
  tracksCamera: () => true,
  cameraRise: (obj) => obj.boss4?.cameraRise ?? BOSS4_CAMERA_RISE,
  // **Nothing to give back.** The engine has no sweep, and this class's own
  // states keep both enemy counts. Its `obj+0x121` is the player an attack is
  // aimed at (`ActorPickTargetPlayer`), not a permit it holds -- the generic
  // release would free `g_attack_permits[target]`, which may be the one the
  // thrown prop holds.
  onDeadSweep: () => {},
  debug: Boss4Debug,
};

registerClass(SpawnClass.Boss4, Boss4Handler);
