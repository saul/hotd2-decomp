/**
 * Class 0x18 — **a zombie that rides a carrier**, and nothing else.
 *
 * `CarriedZombieInit18` (`FUN_0045CD60`) is two lines on top of
 * `EnemyZombieInit`, so a class-0x18 spawn *is* a class-0x30 zombie: same
 * descriptor tail, same 54-state machine, same two enemy counters, same shot
 * path. What the class adds is a frame of reference — its descriptor position
 * is relative to the object `g_civilian_carrier` named when it spawned, and
 * `CarriedZombieUpdate18` runs the whole ordinary update inside that object's
 * matrix.
 *
 * ```c
 * CarriedZombieInit18(obj):
 *     EnemyZombieInit(obj);
 *     obj->+0x13B0 = g_civilian_carrier;
 *     obj->[0] = CarriedZombieUpdate18;
 *
 * CarriedZombieUpdate18(obj):
 *     MatrixStackPush(0);
 *     MatrixTranslate(carrier+0x40); RotX(+0x64); RotZ(+0x6C); RotY(+0x68);
 *     EnemyZombieUpdate(obj);
 *     if (state == (s8)params[3] && sub == 0 && params[0x0C] != -1
 *         && g_cam_path_frame < params[0x0E]
 *         && g_active_cam_path == params[0x0C]) { state = 0x2E; sub = 0; }
 *     if (state == 7 && sub == 1 && obj->+0x1330 == 2) {
 *         FUN_0045D920(carrier+0x40, obj+0x40);
 *         obj->[0] = EnemyZombieUpdate;
 *     }
 *     MatrixStackPop(1);
 * ```
 *
 * Three spawns in the game, all of them stage 3 block 0 step 6 on the boat
 * `CarrierPropRoutine1` drives — one in a single-player game and two more with
 * a second player. All three carry character type 5, `znnick.bin`, which the
 * stage already loads for its ordinary zombies.
 *
 * ## The two exits, and why the second one matters
 *
 * The first is a camera cue out of the spawn's own parameters and puts the
 * actor into class 0x30's state `0x2E`. The second is the interesting one:
 * once the actor reaches state 7 sub 1 with `obj+0x1330 == 2` the engine bakes
 * the carrier's transform into the actor's own position and **puts the plain
 * zombie update back**. That is the zombie stepping off the boat: from that
 * frame on it is an ordinary class-0x30 actor standing in world space, and
 * nothing about it remembers the carrier.
 *
 * `FUN_0045D920` is the bake — it is the carrier matrix applied to
 * `obj+0x40` — and the port composes the same transform rather than calling a
 * routine it has not read in isolation.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { type Actor, type ZombieActor } from "../actor";

import { EnemyZombieHandler, EnemyZombieInit, EnemyZombieUpdate }
  from "../class30/index";
import { ZombieState } from "../class30/states";
import { CarrierPublishWorld, CarrierTransformPoint } from "../carrier";
import { ActorByAt, G } from "../globals";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";

/**
 * `obj+0x1310 = 0x2E` — the state the camera cue sends a rider to.
 *
 * It is class 0x30's own table index, not a class-0x18 state: this class has
 * no state machine of its own at all.
 */
export const CARRIED_ZOMBIE_CUE_STATE = 0x2e;

/** `obj+0x1330 == 2`, the second half of the step-off test — the field the
 * port calls {@link Actor.slideTimer}. */
const CARRIED_ZOMBIE_STEP_OFF_SUB = 2;

/**
 * `CarriedZombieInit18` — `FUN_0045CD60`.
 *
 * `[diverges]` The engine stores the carrier *pointer* in `obj+0x13B0`; the
 * port stores its spawn address, because a pointer cannot go in a snapshot and
 * an address is what every other cross-actor reference in the port already
 * uses.
 */
export function CarriedZombieInit18(obj: Actor, rng?: Rng,
                                    events?: Events): void {
  EnemyZombieInit(obj as ZombieActor, rng, events);
  obj.carrierAt = G.g_civilian_carrier;
}

const _world = { x: 0, y: 0, z: 0 };

/**
 * `CarriedZombieUpdate18` — `FUN_0045CD90`.
 *
 * The ordinary zombie update, in the carrier's frame, plus the two exits.
 *
 * `[diverges]` The engine's matrix stack makes every write the state machine
 * does land in carrier space and the draw follow automatically. The port runs
 * the state machine on the actor's own (carrier-relative) position exactly as
 * the engine does, and publishes the composed world position on
 * {@link Actor.carrierWorld} for the renderer and the camera to read — which
 * is the seam a port without a matrix stack needs and the engine does not.
 */
export function CarriedZombieUpdate18(obj: Actor, f: ClassFrame): void {
  const carrier = obj.carrierAt >= 0 ? ActorByAt(obj.carrierAt) : undefined;
  EnemyZombieUpdate(obj as ZombieActor, f);
  if (!CarrierPublishWorld(obj, carrier) || !carrier) return;

  const z = obj as ZombieActor;
  // The camera cue out of the spawn's own parameters. `tail+0x0C` is the path
  // and `tail+0x0E` the frame; `-1` in the path is "no cue", and the byte at
  // `tail[3]` is the state it may leave from.
  const cue = obj.class18;
  // **Before** the cue frame, not after: `CMP [0x009a6110], ECX` / `JGE`
  // past the arm at `0x0045CE07`, so the state is switched while
  // `g_cam_path_frame < tail+0x0E`. This read `>=` until it was checked
  // against the instructions; the pseudocode says `<` as well.
  if (cue && cue.cue_path >= 0 && z.state === cue.from_state && z.sub === 0
      && G.g_cam_path_frame < cue.cue_frame
      && G.g_active_cam_path === cue.cue_path) {
    z.state = CARRIED_ZOMBIE_CUE_STATE;
    z.sub = 0;
  }
  // ...and the step off, which bakes the transform and hands the actor back.
  if (z.state === ZombieState.CorpseSink && z.sub === 1
      && z.slideTimer === CARRIED_ZOMBIE_STEP_OFF_SUB) {
    CarrierTransformPoint(carrier, obj.pos.x, obj.pos.y, obj.pos.z, _world);
    obj.pos.x = _world.x;
    obj.pos.y = _world.y;
    obj.pos.z = _world.z;
    obj.carrierAt = -1;
  }
}

function CarriedZombieDebug(obj: Actor): ActorDebug {
  const z = obj as ZombieActor;
  return {
    summary: obj.carrierAt >= 0
      ? `riding 0x${obj.carrierAt.toString(16)} · ${ZombieState[z.state] ?? z.state}`
      : `stepped off · ${ZombieState[z.state] ?? z.state}`,
    detail: [
      `local ${obj.pos.x.toFixed(1)},${obj.pos.y.toFixed(1)},${obj.pos.z.toFixed(1)}`,
      `world ${obj.carrierWorld.x.toFixed(1)},${obj.carrierWorld.y.toFixed(1)},`
      + `${obj.carrierWorld.z.toFixed(1)}`,
    ],
    hot: obj.carrierAt >= 0 && !ActorByAt(obj.carrierAt),
  };
}

/**
 * Class 0x18's row. Everything but the Init, the update and the debug line is
 * class 0x30's, because everything but those *is* class 0x30.
 */
export const CarriedZombieHandler: ClassHandler = {
  ...EnemyZombieHandler,
  init: CarriedZombieInit18,
  update: CarriedZombieUpdate18,
  debug: CarriedZombieDebug,
};

registerClass(SpawnClass.CarriedZombie, CarriedZombieHandler);
