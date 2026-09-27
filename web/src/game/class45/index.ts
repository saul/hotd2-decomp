/**
 * Class 0x45 — **the stage-3 boss**, "the Tower": five heads and a body in
 * the canal, three civilians, and its own intro card, under one class id.
 *
 * `g_class_handler_pairs` maps `0x45` to `Boss3ClassHandler`
 * (`FUN_0041FC00`). The handler picks the fight's variant from the block,
 * re-seeds the class's globals (unless the spawn is the body), and installs
 * the sub-type's init from the table at `0x0041FD8C`; the init installs its
 * update. Three routines, three frames -- `obj+0x00` is replaced and the walk
 * calls it once a frame -- which is what {@link Boss3Tail.routine} carries.
 *
 * | sub-type | init / update | what |
 * |---|---|---|
 * | 0 | `Boss3OpeningHeadInit` / `Boss3OpeningHeadUpdate` | the head in the opening |
 * | 1 | `Boss3OpeningBystanderInit` / `Boss3OpeningBystanderUpdate` | the civilian it takes |
 * | 2 | `Boss3FightHeadInit` / `Boss3FightHeadUpdate` | the five fighting heads |
 * | 3 | `Boss3HeldBystanderInit` / `Boss3HeldBystanderUpdate` | the two held civilians |
 * | 4 | `NoOpStub` (`FUN_0041EBB0`) | nothing |
 * | 5 | `Boss3BodyInit` / `Boss3BodyUpdate` | the body |
 *
 * The gates it opens are `wait_enemies_present 0`: head 2 counts in and
 * drops out 180 frames after the last head fell, and the body counts in and
 * drops out as it dies. It writes no script flag. See
 * `docs/re/boss-tower.md` for the whole reading.
 */
import type { Boss3Actor, Actor } from "../actor";
import { G } from "../globals";
import { GameMode } from "../game_mode";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";
import {
  Boss3BodyState, Boss3HeadState, Boss3Phase, Boss3Routine, Boss3Subtype,
  Boss3Variant,
} from "./state";
import { Boss3DrawAttackDelay, Boss3FightHeadInit, Boss3FightHeadUpdate }
  from "./heads";
import { Boss3BodyInit, Boss3BodyUpdate } from "./body";
import {
  Boss3HeldBystanderInit, Boss3HeldBystanderUpdate, Boss3OpeningBystanderInit,
  Boss3OpeningBystanderUpdate, Boss3OpeningHeadInit, Boss3OpeningHeadUpdate,
} from "./opening";

/** The heads' shared bar: 180, or 150 on stage 6 (`AND 0x1E; ADD 0x96`). */
const POOL = 0xb4;
const POOL_STAGE6 = 0x96;
/** `g_boss3_rand_counter`'s three seeds, by variant. */
const RAND_SEEDS: readonly number[] = [0x086deb2c, 0x01084a3c, 0x01553267];
/** The blocks the handler picks a variant from. */
const BLOCK_STAGE6 = 2;
const BLOCK_A = 11;
const BLOCK_B = 13;
const BLOCK_BOSS_MODE_A = 0xf;

/** `obj+0x00` for each sub-type -- the table at `0x0041FD8C`. */
const SUBTYPE_INITS: readonly Boss3Routine[] = [
  Boss3Routine.OpeningHeadInit,        // 0 -> 0x0041FDB0
  Boss3Routine.OpeningBystanderInit,   // 1 -> 0x004200F0
  Boss3Routine.FightHeadInit,          // 2 -> 0x0041FE30
  Boss3Routine.HeldBystanderInit,      // 3 -> 0x00420180
  Boss3Routine.NoOpStub,               // 4 -> 0x0041EBB0
  Boss3Routine.BodyInit,               // 5 -> 0x00420360
];

/**
 * `Boss3ClassHandler` — `FUN_0041FC00`. The variant: in Boss Mode block 15
 * is 0 and anything else 1; otherwise block 2 is 2 (stage 6), 11 is 0, 13 is
 * 1, and any other block keeps the last. Unless the spawn is the body, the
 * fight's globals start over -- phase 0, five heads, the bar's pool, the
 * rank, an attack delay (a `rand()` draw), nobody attacking, head 2 last, and
 * the counter seeded by variant. Then `obj+0x34 = 1`, no hit slot and no
 * enemy slot, the class's words zeroed, state 0, and the sub-type's init.
 */
export function Boss3ClassHandler(obj: Boss3Actor, f: ClassFrame): void {
  const t = obj.boss3;
  if (G.g_GameMode === GameMode.Boss) {
    G.g_boss3_variant = G.g_evt_block_index !== BLOCK_BOSS_MODE_A ? 1 : 0;
  } else if (G.g_evt_block_index === BLOCK_STAGE6) {
    G.g_boss3_variant = Boss3Variant.Stage6;
  } else if (G.g_evt_block_index === BLOCK_A) {
    G.g_boss3_variant = Boss3Variant.Stage3A;
  } else if (G.g_evt_block_index === BLOCK_B) {
    G.g_boss3_variant = Boss3Variant.Stage3B;
  }
  if (t.subtype !== Boss3Subtype.Body) {
    G.g_boss3_phase = Boss3Phase.Intro;
    G.g_boss3_heads_left = 5;
    G.g_boss3_head_hp_pool = G.g_boss3_variant === Boss3Variant.Stage6
      ? POOL_STAGE6 : POOL;
    // `GetDamageRank` (`FUN_0040A8A0`), kept as the byte it is stored as.
    G.g_boss3_rank = (G.g_damage_rank << 24) >> 24;
    G.g_boss3_attack_delay = Boss3DrawAttackDelay(f, G.g_boss3_rank);
    G.g_boss3_heads_attacking = 0;
    G.g_boss3_last_head = 2;
    const seed = RAND_SEEDS[G.g_boss3_variant];
    if (seed !== undefined) G.g_boss3_rand_counter = seed;
  }
  obj.flags = 1;
  obj.hitSlot = -1;
  // `obj+0x120 = 0xFF`: the enemy slot, which the port's per-frame pass
  // (`camera/slots.ts`) owns -- see `tracksCamera` below.
  t.counter = 0; t.camFrame = 0; t.camFrames = 0; t.unread133C = 0;
  t.blend = 0; t.bob = 0;
  // `obj+0x1348` and `obj+0x134C` are zeroed too; nothing in the class reads
  // either, so neither has a field.
  obj.state = 0;
  const next = SUBTYPE_INITS[t.subtype];
  // A sub-type past 5 leaves `obj+0x00` on the handler (`JA 0x0041FD87`),
  // and the handler runs again next frame. No shipped spawn has one.
  if (next !== undefined) t.routine = next;
}

/**
 * `NoOpStub` — `FUN_0041EBB0`. Sub-type 4's init: returns, and stays
 * installed. No shipped spawn reaches it.
 */
export function NoOpStub(): void {
  return;
}

/**
 * `[port-only]` -- the walk's call through `obj+0x00`: whichever routine the
 * actor has installed.
 */
function Boss3Dispatch(obj: Actor, f: ClassFrame): void {
  if (obj.cls !== SpawnClass.Boss3) return;
  const b = obj as Boss3Actor;
  switch (b.boss3.routine) {
    case Boss3Routine.ClassHandler: Boss3ClassHandler(b, f); break;
    case Boss3Routine.OpeningHeadInit: Boss3OpeningHeadInit(b); break;
    case Boss3Routine.OpeningHeadUpdate: Boss3OpeningHeadUpdate(b, f); break;
    case Boss3Routine.OpeningBystanderInit: Boss3OpeningBystanderInit(b); break;
    case Boss3Routine.OpeningBystanderUpdate:
      Boss3OpeningBystanderUpdate(b, f); break;
    case Boss3Routine.FightHeadInit: Boss3FightHeadInit(b); break;
    case Boss3Routine.FightHeadUpdate: Boss3FightHeadUpdate(b, f); break;
    case Boss3Routine.HeldBystanderInit: Boss3HeldBystanderInit(b); break;
    case Boss3Routine.HeldBystanderUpdate: Boss3HeldBystanderUpdate(b, f); break;
    case Boss3Routine.NoOpStub: NoOpStub(); break;
    case Boss3Routine.BodyInit: Boss3BodyInit(b); break;
    case Boss3Routine.BodyUpdate: Boss3BodyUpdate(b, f); break;
    default: break;
  }
}

/**
 * `[port-only]` -- `EvtOpSpawnPlaced09` (`FUN_004088A0`) allocates the object
 * with `obj+0x00` on the class handler and `desc+0x25` in `obj+0x130C`; the
 * handler itself runs on the object's first frame, as the walk reaches it.
 */
function Boss3Allocate(obj: Actor): void {
  if (obj.cls !== SpawnClass.Boss3) return;
  const t = obj.boss3;
  t.routine = Boss3Routine.ClassHandler;
  t.subtype = obj.class45?.subtype ?? 0;
}

/** The sidebar's line. */
function Boss3Debug(obj: Actor): ActorDebug {
  if (obj.cls !== SpawnClass.Boss3) return { summary: "boss 3" };
  const t = obj.boss3;
  const name = Boss3Subtype[t.subtype] ?? `sub-type ${t.subtype}`;
  const blk = t.block;
  const state = t.subtype === Boss3Subtype.Body
    ? Boss3BodyState[obj.state] ?? String(obj.state)
    : t.subtype === Boss3Subtype.FightHead
      ? Boss3HeadState[obj.state] ?? String(obj.state)
      : String(obj.state);
  const detail = [
    `routine ${Boss3Routine[t.routine]}, clip ${obj.motion} cursor ${t.cursor}`,
    `phase ${Boss3Phase[G.g_boss3_phase] ?? G.g_boss3_phase}, heads left `
      + `${G.g_boss3_heads_left}, pool ${G.g_boss3_head_hp_pool}`,
  ];
  if (blk && t.subtype === Boss3Subtype.FightHead) {
    detail.push(`hp ${obj.hp}, armed ${blk.armed}, neck ${blk.neckSum}`);
  }
  if (blk && t.subtype === Boss3Subtype.Body) {
    detail.push(`hp ${obj.hp}, path ${blk.pathCursor}/${blk.pathCount}, `
      + `surfacing ${blk.eventIndex}, hits ${blk.hits}`);
  }
  return {
    summary: `boss 3 · ${name} ${t.index} · ${state}`,
    detail,
    hot: obj.state === Boss3HeadState.Attack
      || obj.state === Boss3BodyState.Lunge,
  };
}

export const Boss3Handler: ClassHandler = {
  init: Boss3Allocate,
  update: Boss3Dispatch,
  // A dead head plays out its clip and head 2 counts to the gate after the
  // last one fell; the dead body bobs until flag 4. None of it may stop.
  updatesWhenDead: true,
  // Every routine reads `obj+0x34` bit 3 itself.
  ownsShotResult: true,
  // Every `INC dword ptr [model]` in the class sits behind a state test --
  // see `class45/model.ts`.
  ownsMotionClock: true,
  // `RegisterForCameraTracking` (`FUN_00408EC0`) is called by a fighting
  // head's tail at `0x00421871`, and by nothing else in the class.
  tracksCamera: (obj) => obj.cls === SpawnClass.Boss3
    && obj.boss3.cameraTracked,
  // The class does its own counting in and out -- head 2 and the body, by
  // `INC`/`DEC` at the addresses their routines cite -- and nothing else.
  onDeadSweep: () => {},
  debug: Boss3Debug,
};

registerClass(SpawnClass.Boss3, Boss3Handler);
