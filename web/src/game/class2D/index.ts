/**
 * Class 0x2D — **the stage-6 final boss**, the Emperor (its banner's name
 * sprite, `0xBF`, reads "EMPEROR"; `0xCD` reads "Type α"), and everything it
 * allocates, under one class id.
 *
 * `g_class_handler_pairs` maps `0x2D` to `Class2DClassHandler`
 * (`FUN_00426A70`). The handler reads the descriptor's sub-type
 * (`obj+0x1390 -> +0x01`): 0 is stage 5's cameo in the opening cut, which
 * stands on one spot and is gone the moment play starts
 * (`Class2DSubtype0Update`); 1 is the fight, stage 6 blocks 12 and 14, which
 * runs the seven states of `g_class2d_states` (`Class2DUpdate`). The fight
 * allocates eight satellites (`class2D/satellites.ts`), one child at a time
 * in its second round (`class2D/children.ts`), and its small tasks -- sparks,
 * the trail, the intro flipbook, the death burst (`class2D/tasks.ts`). Every
 * one of those objects runs whatever routine `obj+0x00` holds, which is
 * {@link Class2DTail.routine}.
 *
 * | state | routine | what |
 * |---|---|---|
 * | 0 | `Class2DState0` | rises on object path `0x184` through the intro cut (camera path `0xDF`) |
 * | 1 | `Class2DState1` | rides path `0x185`; at frame 1810 raises flag 50 (the banner) |
 * | 2 | `Class2DState2` | 300 frames, then the fight: 400 hit points, the bar, the enemy counts |
 * | 3 | `Class2DState3` | round 1 -- the satellites' three attacks and the charge, to 260 |
 * | 4 | `Class2DState4` | round 2 -- the waypoints and the four children, to 140 |
 * | 5 | `Class2DState5` | round 3 -- the path segments with the trail, to 0, and the kill |
 * | 6 | `Class2DState6` | the death: the counts back, the burst, the grade, `ActorDespawn` |
 *
 * The one gate it holds is block 12's `wait_enemies_alive 0` (op 210): state
 * 2 counts it in, state 6 counts it out. It raises flag 50 at the end of
 * the intro path. See `docs/re/boss-emperor.md` for the whole reading.
 */
import type { Actor, EmperorActor } from "../actor";
import { G } from "../globals";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";
import {
  Class2DClassHandler, Class2DSubtype0Update, Class2DUpdate,
} from "./boss";
import {
  Class2DChildKind0Init, Class2DChildKind0Update, Class2DChildKind1Init,
  Class2DChildKind1Update, Class2DChildKind2Init, Class2DChildKind2Update,
  Class2DChildKind3Init, Class2DChildKind3Update,
} from "./children";
import { Class2DSatelliteInit, Class2DSatelliteUpdate } from "./satellites";
import {
  Class2DRoutine, Class2DSatelliteState, Class2DState, makeClass2DBossWords,
} from "./state";

/** `g_script_flags[0x32]` -- `Class2DState1` raises it at frame 1810. */
const FLAG_INTRO_DONE = 0x32;

/**
 * `[port-only]` -- the walk's call through `obj+0x00`: whichever routine the
 * object has installed.
 */
function Class2DDispatch(obj: Actor, f: ClassFrame): void {
  if (obj.cls !== SpawnClass.Emperor) return;
  const e = obj as EmperorActor;
  switch (e.class2d.routine) {
    case Class2DRoutine.ClassHandler: Class2DClassHandler(e, f); break;
    case Class2DRoutine.Update: Class2DUpdate(e, f); break;
    case Class2DRoutine.Subtype0Update: Class2DSubtype0Update(e, f); break;
    case Class2DRoutine.SatelliteInit: Class2DSatelliteInit(e, f); break;
    case Class2DRoutine.SatelliteUpdate: Class2DSatelliteUpdate(e, f); break;
    case Class2DRoutine.ChildKind0Init: Class2DChildKind0Init(e, f); break;
    case Class2DRoutine.ChildKind0Update: Class2DChildKind0Update(e, f); break;
    case Class2DRoutine.ChildKind1Init: Class2DChildKind1Init(e, f); break;
    case Class2DRoutine.ChildKind1Update: Class2DChildKind1Update(e, f); break;
    case Class2DRoutine.ChildKind2Init: Class2DChildKind2Init(e, f); break;
    case Class2DRoutine.ChildKind2Update: Class2DChildKind2Update(e, f); break;
    case Class2DRoutine.ChildKind3Init: Class2DChildKind3Init(e, f); break;
    case Class2DRoutine.ChildKind3Update: Class2DChildKind3Update(e, f); break;
    // Kind 0's wing is a block, not a task: nothing calls it.
    case Class2DRoutine.Wing: break;
  }
}

/**
 * `[port-only]` -- `EvtOpSpawnPlaced09` (`FUN_004088A0`) allocates the object
 * with `obj+0x00` on the class handler and `obj+0x1390` on the descriptor's
 * tail; the handler runs on the object's first frame, as the walk reaches
 * it. The port keeps the tail's words on the boss block. An object the class
 * made itself arrives with its routine and its words already on (see
 * `Class2DSpawnSatellite`, `Class2DSpawnChild`).
 */
function Class2DAllocate(obj: Actor): void {
  if (obj.cls !== SpawnClass.Emperor) return;
  const d = obj.class2dSpawn;
  if (!d) return;
  const t = obj.class2d;
  t.routine = Class2DRoutine.ClassHandler;
  const b = t.boss ?? (t.boss = makeClass2DBossWords());
  b.subtype = (d.subtype << 24) >> 24;
  b.clip = d.clip;
  b.counterStart = d.counter;
  b.killPath = d.kill_path;
  b.killFrame = d.kill_frame;
  b.fightHp = d.fight_hp;
  b.round2Hp = d.round2_hp;
  b.round3Hp = d.round3_hp;
}

/** The sidebar's line. */
function Class2DDebug(obj: Actor): ActorDebug {
  if (obj.cls !== SpawnClass.Emperor) return { summary: "emperor" };
  const t = obj.class2d;
  const routine = Class2DRoutine[t.routine] ?? String(t.routine);
  if (t.boss) {
    const b = t.boss;
    return {
      summary: `emperor · ${Class2DState[obj.state] ?? obj.state} sub ${obj.sub}`,
      detail: [
        `routine ${routine}, clip ${obj.skel?.motion ?? obj.motion} cursor `
          + `${obj.skel?.cursor ?? 0}`,
        `hp ${obj.hp}, rank ${b.rank}, cue ${b.cue}, phase ${b.phase}, `
          + `hits ${b.hits}, next kind ${b.next}`,
        `flag 50: ${G.g_script_flags[FLAG_INTRO_DONE] ? 1 : 0}, child busy `
          + `${G.g_class2d_child_busy}`,
      ],
      hot: obj.state === Class2DState.Death,
    };
  }
  if (t.sat) {
    return {
      summary: `emperor satellite ${t.sat.index} · `
        + `${Class2DSatelliteState[obj.state] ?? obj.state} sub ${obj.sub}`,
    };
  }
  if (t.child) {
    return {
      summary: `emperor child ${t.child.kind} · sub ${obj.sub}`,
      detail: [`routine ${routine}, shown ${t.child.shown}, `
        + `animate ${t.child.animate}`],
    };
  }
  return { summary: `emperor · ${routine}` };
}

export const Class2DHandler: ClassHandler = {
  init: Class2DAllocate,
  update: Class2DDispatch,
  // The death is its own state, with the counts, the burst and the despawn
  // in it; the class never sets `obj.dead`.
  updatesWhenDead: true,
  // Every model block of the class is stepped by its own routines, behind
  // their own tests (`char+0x00` in each state's tail, `+0x1320` in the
  // children's), and the wing by kind 0's draw.
  advancesOwnMotion: true,
  // `Class2DResolveShot` and the three children's shot routines read
  // `obj+0x34` bit 3 themselves; the satellites spark on it.
  ownsShotResult: true,
  // `Class2DState1` raises flag 50 (`MOV byte ptr [0x009C7232], AL`).
  raisesScriptFlag: FLAG_INTRO_DONE,
  // Every routine that can be shot registers itself:
  // `ActorRegisterCameraPoint` in the boss's states 3-5 and the children's
  // tails, `Class2DSatelliteRegisterShot` for the satellites.
  registersForShotTest: true,
  // **Nothing to give back.** The engine has no sweep; the boss's states keep
  // both enemy counts and the children give their permit back on their way
  // out.
  onDeadSweep: () => {},
  debug: Class2DDebug,
};

registerClass(SpawnClass.Emperor, Class2DHandler);
