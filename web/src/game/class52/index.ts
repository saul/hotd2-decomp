/**
 * Class 0x52 — **the mouse**, and a route-branch trigger.
 *
 * The species is settled rather than guessed, the same way class 0x53's was:
 * its ten draw slots `0x1385`..`0x138E` resolve through
 * `ExeTables.asset_slots()` to `mouse.bin` entries **0 to 9**, and an asset
 * filename is one of the binary's two name tables. `docs/formats/spawns.md`
 * had the species `[open]` on the grounds that the class plays no sound; it
 * does not need to, because it is drawn from a named file.
 *
 * Ten spawns, and the subtype in the descriptor tail decides which of two
 * things it is:
 *
 * ```
 * 0, 1   MouseWanderUpdate         runs about, turns at random, leaves at 600 frames
 * 2, 3, 4  MouseBranchTriggerUpdate  stands still until shot, writes a route, flees
 * ```
 *
 * `MouseInit` despawns subtypes 2 to 4 outright unless `g_GameMode == 1`, so
 * the trigger half is an **Original Mode** feature and an arcade run has no
 * such object at all — not an inert one.
 *
 * ## The ten-frame strip
 *
 * `sub+0x24` and `sub+0x22` are the first and last slots, `sub+0x20` the one
 * being drawn, and every moving arm advances it and wraps. `MouseInit` starts
 * a wanderer on `0x1385 + rand() % 10` so a row of them does not run in step,
 * and the trigger pins it to `0x1385` until it is shot. That draw is the whole
 * reason this class was ported and unreachable until now: it is an **asset
 * slot**, not a skeleton, so `render/`'s shot test — which walked character
 * bones and prop boxes — had nothing to offer. `ShotTestSphere`
 * (`FUN_00404630`) is what the engine uses instead, and the port has it now.
 *
 * ## What it writes, and what proves the table
 *
 * The value is the signed byte at `0x00564442 + subtype` — **2, 1, 2** for
 * subtypes 2, 3 and 4 — behind a gate on the s16 at
 * `0x00564444 + subtype * 2`, which for those three is 18, 10 and 10. What
 * those numbers *are* is `[open]`; here they only have to be non-zero.
 *
 * Stage 4 block 10 carries the reading on its own: `next = {12, 18, 19}`,
 * three live slots, holding exactly one subtype-3 and one subtype-4 mouse,
 * writing 1 and 2. The two alternates and the two mice line up with nothing
 * left over.
 *
 * ## What is not ported
 *
 * The draw itself, which is `render/slotmodels.ts`'s. Subtype 1's
 * `SubmitSlotWithSceneLightArray` against subtype 0's `AssetDrawSlot` — the
 * same model lit or unlit — is a renderer difference the port does not carry.
 */
import type { Rng } from "../../core/rng";
import type { Actor } from "../actor";
import { ActorFlag } from "../actor";
import { ActorDespawn } from "../despawn";
import { GameMode } from "../game_mode";
import { G } from "../globals";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";
import { MouseState, type MouseTail } from "./state";

export { MouseState } from "./state";

/**
 * The signed bytes at `0x00564442 + subtype` — what each trigger subtype
 * writes into `g_script_branch_var`.
 *
 * A subtype absent here is a wanderer and writes nothing. The table's base is
 * chosen so indices 2..4 land on real data: `0x00564442` and the byte after it
 * are the tail of a `double`, which is the adjacent-array shape this project
 * has a lesson about, and only 2, 3 and 4 are ever read.
 */
export const MOUSE_BRANCH_BY_SUBTYPE: Partial<Record<number, number>> = {
  2: 2, 3: 1, 4: 2,
};

/**
 * The s16s at `0x00564444 + subtype * 2` — 18, 10, 10 for subtypes 2, 3 and 4.
 * `MouseBranchTriggerUpdate` requires this to be non-zero before it writes,
 * and `[open]` is what the number itself is.
 */
export const MOUSE_TRIGGER_GATE: Partial<Record<number, number>> = {
  2: 18, 3: 10, 4: 10,
};

/**
 * The `g_script_flags` byte that removes each trigger subtype, from the test
 * at the top of `MouseBranchTriggerUpdate`.
 */
export const MOUSE_REMOVE_FLAG: Partial<Record<number, number>> = {
  2: 0x82, 3: 0x21, 4: 0x22,
};

/**
 * Where each subtype's flight ends, spelled as three immediates in three
 * `switch` arms rather than as a table — subtype 2 runs until its **z** falls
 * below the bound, 3 and 4 until their **x** passes theirs in opposite
 * directions.
 */
export const MOUSE_FLEE_BOUND: Partial<Record<number, number>> = {
  2: -1940.8, 3: -87.0, 4: -184.0,
};

/** The ten frames of `mouse.bin`, as asset slots. */
export const MOUSE_FIRST_SLOT = 0x1385;
export const MOUSE_LAST_SLOT = 0x138e;
export const MOUSE_FRAMES = 10;

/** `sub+0x0C` — the only speed the class has, in units a frame. */
export const MOUSE_SPEED = 0.4;
/**
 * The width of each of the two draws the turn is built from — `rand() & 0xFFF`.
 *
 * It is a **mask on `rand()`**, and the mask is uniform here rather than
 * merely nearly so: MSVC's `rand()` returns 0 to 0x7FFF, and 0x8000 is exactly
 * eight times 0x1000, so every value of the low twelve bits comes up equally
 * often. `Rng.int` is the port's spelling of `% n` and is the same
 * distribution, which is why this is a count and not a mask — see
 * {@link MouseWanderUpdate}.
 */
export const MOUSE_TURN_SPREAD = 0x1000;
/** `obj+0x124` — the shot-test radius `ShotTestSphere` measures against. */
export const MOUSE_HIT_RADIUS = 2.0;
/** Frames a wanderer holds still, and the life at which it leaves. */
export const MOUSE_PAUSE_FRAMES = 0x3c;
export const MOUSE_LIFE_FRAMES = 600;
/** The subtype at and above which the mouse is a trigger rather than a mouse. */
export const MOUSE_FIRST_TRIGGER_SUBTYPE = 2;

/** An actor already narrowed to class 0x52. */
type MouseActor = Actor & { mouse: MouseTail };

function Tail(obj: Actor): MouseTail | null {
  return (obj as MouseActor).mouse ?? null;
}

/** BAMS to radians. The engine's own `* 9.587379924285257e-05`. */
const BAMS = (Math.PI * 2) / 65536;

/**
 * `sub->vx = sin(yaw) * speed; sub->vz = cos(yaw) * speed`.
 *
 * [port-only] as a *function*: the engine writes the pair out three times, in
 * `MouseInit`, in `MouseWanderUpdate`'s turn and in the trigger's launch. One
 * here, because three copies of a velocity is how one of them ends up with a
 * different speed.
 *
 * The signs are the port's world convention, which negates both terms — the
 * same `(-sin, -cos)` `class30`'s facing uses.
 */
function MouseSetVelocityFromYaw(obj: Actor, sub: MouseTail): void {
  const r = obj.yaw * BAMS;
  sub.vx = -Math.sin(r) * sub.speed;
  sub.vz = -Math.cos(r) * sub.speed;
}

/** `sub->+0x20 += 1`, wrapping past `+0x22` back to `+0x24`. */
function MouseAdvanceStrip(sub: MouseTail): void {
  sub.frame += 1;
  if (sub.lastFrame < sub.frame) sub.frame = sub.firstFrame;
}

/**
 * `MouseInit` — `FUN_0043F4C0`.
 *
 * ```c
 * obj->+0x3C = -1;
 * obj->+0x124 = 2.0;                          // the shot-test radius
 * sub = ActorAllocSub(0x28);
 * sub->+0x26 = tail->+0x00;                   // the subtype
 * sub->+0x0C = 0.4;
 * sub->velocity = (sin yaw, _, cos yaw) * 0.4;
 * sub->+0x24 = 0x1385;  sub->+0x22 = 0x138E;
 * sub->+0x20 = 0x1385 + rand() % 10;
 * FUN_00409270(obj);                          // claim a slot at 0x009C88C0
 * if (sub->+0x26 < 2)       { ...rebuild the velocity...; *obj = MouseWanderUpdate; }
 * else if (g_GameMode == 1) { sub->velocity = 0; sub->+0x20 = 0x1385;
 *                             *obj = MouseBranchTriggerUpdate; }
 * else ActorDespawn(obj);
 * ```
 *
 * **The mode gate is in the Init**, which is why a subtype-2 mouse in arcade is
 * not a trigger that never fires — it is an object that was never built.
 *
 * The `rand() % 10` is drawn for **every** subtype and then thrown away by the
 * trigger arm, so the port draws it whatever the subtype: a draw the engine
 * makes and the port skips shifts the shared stream for everything after it.
 *
 * The velocity is computed twice in the engine — once from the literal 0.4 and
 * again from `sub->+0x0C`, which is the same 0.4 — and the port does it once.
 * Recorded rather than reproduced, because the second write cannot differ from
 * the first.
 */
export function MouseInit(obj: Actor, rng?: Rng): void {
  const sub = Tail(obj);
  if (!sub) return;
  obj.hitRadius = MOUSE_HIT_RADIUS;
  sub.subtype = obj.class52?.subtype ?? 0;
  sub.speed = MOUSE_SPEED;
  MouseSetVelocityFromYaw(obj, sub);
  sub.state = MouseState.Run;
  sub.life = 0;
  sub.paused = 0;
  sub.firstFrame = MOUSE_FIRST_SLOT;
  sub.lastFrame = MOUSE_LAST_SLOT;
  sub.frame = MOUSE_FIRST_SLOT + (rng?.int(MOUSE_FRAMES) ?? 0);
  if (sub.subtype < MOUSE_FIRST_TRIGGER_SUBTYPE) return;
  if (G.g_GameMode !== GameMode.Original) {
    ActorDespawn(obj);
    return;
  }
  sub.vx = 0;
  sub.vz = 0;
  sub.frame = MOUSE_FIRST_SLOT;
}

/**
 * `MouseWanderUpdate` — `FUN_0043F5C0`. Subtypes 0 and 1.
 *
 * ```c
 * if (sub->+0x18 == 0) {
 *     obj->x += sub->vx;  obj->z += sub->vz;
 *     ...advance the strip...
 *     if (sub->+0x1C % 100 == 99 && rand() % 10 < 4) {
 *         sub->+0x18 = 1;  sub->+0x20 = sub->+0x24;
 *     }
 * } else if (sub->+0x18 == 1 && ++sub->+0x1E > 0x3C) {
 *     sub->+0x18 = 0;  sub->+0x1E = 0;
 *     obj->yaw += (rand() & 0xFFF) - (rand() & 0xFFF);
 *     sub->velocity = (sin yaw, _, cos yaw) * sub->+0x0C;
 * }
 * ...draw...
 * if (++sub->+0x1C > 600) ActorDespawn(obj);
 * ```
 *
 * **Two draws from `rand()` for the turn, not one**, and they are subtracted:
 * the mouse turns by the difference of two twelve-bit numbers, which is
 * centred on zero and biased toward small turns. One draw would give a
 * uniform turn always in the same direction.
 *
 * The pause is checked on `life % 100 == 99` — the frame *before* each
 * hundred, not on the hundred — and it takes a 40% chance when it comes up.
 * The life counter is incremented at the **bottom**, after the draw, so the
 * mouse is drawn on the frame it despawns.
 */
export function MouseWanderUpdate(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  if (sub.state === MouseState.Run) {
    obj.pos.x += sub.vx;
    obj.pos.z += sub.vz;
    MouseAdvanceStrip(sub);
    if (sub.life % 100 === 99 && f.rng.int(10) < 4) {
      sub.state = MouseState.Pause;
      sub.frame = sub.firstFrame;
    }
  } else if (sub.state === MouseState.Pause) {
    sub.paused += 1;
    if (sub.paused > MOUSE_PAUSE_FRAMES) {
      sub.state = MouseState.Run;
      sub.paused = 0;
      // `(rand() & 0xFFF) - (rand() & 0xFFF)`, in that order. Two draws.
      //
      // **A mask, not a call to `Rng.next`.** `Rng.next()` returns a float in
      // `[0, 1)` and `0.7 & 0xFFF` is `0`, so the line this replaces made both
      // draws zero and the mouse turned by exactly nothing for as long as it
      // existed — it ran in a straight line until its six hundred frames were
      // up. The draws were still taken, so the shared stream was never out of
      // step and nothing downstream showed it. `L46`.
      obj.yaw += f.rng.int(MOUSE_TURN_SPREAD) - f.rng.int(MOUSE_TURN_SPREAD);
      MouseSetVelocityFromYaw(obj, sub);
    }
  }
  sub.life += 1;
  if (sub.life > MOUSE_LIFE_FRAMES) ActorDespawn(obj);
}

/**
 * `MouseBranchTriggerUpdate` — `FUN_0043F720`. Subtypes 2, 3 and 4.
 *
 * ```c
 * if (g_script_flags[remove_flag[subtype]] == 1) { ActorDespawn(obj); return; }
 * switch (sub->+0x18) {
 *   case 0:
 *     if ((obj->+0x34 & 8) && *(s16 *)(0x00564444 + subtype * 2) != 0) {
 *         g_script_branch_var = *(s8 *)(0x00564442 + subtype);
 *         sub->+0x18 = 1;
 *         sub->+0x20 = sub->+0x24;
 *     }
 *     obj->+0x34 &= ~8;
 *     break;
 *   case 1:  ...resolve the velocity, enter 2, 3 or 4 by subtype, life = 0...
 *   case 2:  obj->x += vx; obj->z += vz; if (obj->z < -1940.8) sub->+0x18 = 10;
 *   case 3:  ...if (-87.0 < obj->x) sub->+0x18 = 10;
 *   case 4:  ...if (obj->x < -184.0) sub->+0x18 = 10;
 *   case 11: ActorDespawn(obj);
 * }
 * ```
 *
 * **The hit bit is cleared whether or not the gate passed**, which is what
 * stops a subtype with a zero gate answering on some later frame.
 *
 * The removal flag is per subtype — `g_script_flags[0x82]`, `[0x21]` and
 * `[0x22]` — and it is tested before the switch, so a script that raises it
 * takes the mouse away mid-flight.
 *
 * State 10 has **no arm**. The mouse that has run past its bound stops moving
 * and keeps drawing where it stopped; that is transcribed as written rather
 * than turned into the despawn it looks like it ought to be.
 */
export function MouseBranchTriggerUpdate(obj: Actor): void {
  const sub = Tail(obj);
  if (!sub) return;
  const remove = MOUSE_REMOVE_FLAG[sub.subtype];
  if (remove !== undefined && (G.g_script_flags[remove] ?? 0) === 1) {
    ActorDespawn(obj);
    return;
  }
  switch (sub.state) {
    case MouseState.Run:
      if ((obj.flags & ActorFlag.Hit) !== 0
          && (MOUSE_TRIGGER_GATE[sub.subtype] ?? 0) !== 0) {
        const value = MOUSE_BRANCH_BY_SUBTYPE[sub.subtype];
        if (value !== undefined) G.g_script_branch_var = value;
        sub.state = MouseState.Pause;
        sub.frame = sub.firstFrame;
      }
      obj.flags &= ~ActorFlag.Hit;
      obj.pendingHit = null;
      break;
    case MouseState.Pause:
      MouseSetVelocityFromYaw(obj, sub);
      sub.state = sub.subtype === 2 ? MouseState.FleeSubtype2
        : sub.subtype === 3 ? MouseState.FleeSubtype3
        : sub.subtype === 4 ? MouseState.FleeSubtype4
        : MouseState.Pause;
      sub.life = 0;
      break;
    case MouseState.FleeSubtype2:
    case MouseState.FleeSubtype3:
    case MouseState.FleeSubtype4: {
      obj.pos.x += sub.vx;
      obj.pos.z += sub.vz;
      const bound = MOUSE_FLEE_BOUND[sub.subtype];
      if (bound !== undefined) {
        const past = sub.subtype === 2 ? obj.pos.z < bound
          : sub.subtype === 3 ? bound < obj.pos.x
          : obj.pos.x < bound;
        if (past) sub.state = MouseState.Stopped;
      }
      MouseAdvanceStrip(sub);
      break;
    }
    case MouseState.Leave:
      ActorDespawn(obj);
      break;
    default:
      break;
  }
}

/**
 * [port-only] The engine swaps `*obj` between `MouseWanderUpdate` and
 * `MouseBranchTriggerUpdate` in the Init and never again; this is that choice
 * written as a test on the subtype, which is what decided it.
 */
export function MouseUpdate(obj: Actor, f: ClassFrame): void {
  const sub = Tail(obj);
  if (!sub) return;
  if (sub.subtype < MOUSE_FIRST_TRIGGER_SUBTYPE) MouseWanderUpdate(obj, f);
  else MouseBranchTriggerUpdate(obj);
}

function MouseDebug(obj: Actor): ActorDebug {
  const sub = Tail(obj);
  if (!sub) return { summary: "no class 0x52 tail", hot: true };
  const writes = MOUSE_BRANCH_BY_SUBTYPE[sub.subtype];
  return {
    summary: writes === undefined
      ? `subtype ${sub.subtype} · wanders, writes no route`
      : `subtype ${sub.subtype} · shoot for route ${writes}`,
    detail: [
      `${MouseState[sub.state]} · frame ${sub.frame.toString(16)} · life ${sub.life}`,
      `g_script_branch_var ${G.g_script_branch_var}`,
    ],
    hot: writes !== undefined && sub.state === MouseState.Run,
  };
}

export const MouseHandler: ClassHandler = {
  init: MouseInit,
  update: MouseUpdate,
  // The class reads `obj+0x34` bit 3 itself and has no hit points at all —
  // `ResolveHit` would look up a damage row it has no entry in.
  ownsShotResult: true,
  debug: MouseDebug,
};

registerClass(SpawnClass.Mouse, MouseHandler);
