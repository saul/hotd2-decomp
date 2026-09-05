/**
 * Class 0x52 — the small wandering critter, and a **route-branch trigger**.
 *
 * Ten spawns. Sub-types 0 and 1 wander off along their spawn yaw at 0.4 units
 * a frame and self-despawn; sub-types 2, 3 and 4 stand still and answer a
 * branch when they are shot. `Class52Init` (`FUN_0043F4C0`) despawns those
 * three outright unless `g_GameMode == 1`, so the whole trigger half of this
 * class is an **Original Mode** feature.
 *
 * The value it writes is the signed byte at `0x00564442 + subtype` —
 * **2, 1, 2** for sub-types 2, 3 and 4 — gated on the s16 at
 * `0x00564444 + subtype * 2` being non-zero, which for those three is 18, 10
 * and 10. What those numbers are is `[open]`; here they only have to be
 * non-zero, and all three are.
 *
 * Stage 4 block 10 is the case that carries the whole reading on its own. Its
 * route record is `{12, 18, 19}` — three live slots — and it holds exactly one
 * sub-type 3 and one sub-type 4, writing 1 and 2. The two alternates and the
 * two triggers line up with nothing left over.
 *
 * The census, over the ten shipped spawns: stage 1 block 1 has four of
 * sub-type 0 (all wanderers, so that block's branch is answered by its
 * civilian instead), stage 2 block 18 has sub-types 1 and 2, stage 4 block 7
 * two of sub-type 1, and stage 4 block 10 sub-types 3 and 4.
 *
 * ## What is not ported
 *
 * The **wander**, which is sub-types 0 and 1's whole behaviour:
 * `FUN_0043F5C0` walks the actor along `(sin yaw, cos yaw) * 0.4` and retires
 * it. Those two sub-types write no branch and the port leaves them standing,
 * which is what an unported class already does. The trigger's own flight —
 * sub-states 1 to 4, which resolve a velocity from the yaw and run until x or
 * z passes a per-sub-type bound — is not here either. Neither touches
 * `g_script_branch_var`, and this file exists for the one thing that does.
 *
 * The species is `[open]`: the class plays no sound, so nothing names it. The
 * doc calls it a critter and so does this, without claiming more.
 */
import type { Rng } from "../../core/rng";
import type { Actor } from "../actor";
import { ActorFlag } from "../actor";
import { GameMode } from "../game_mode";
import { G } from "../globals";
import {
  registerClass, type ActorDebug, type ClassFrame, type ClassHandler,
} from "../registry";
import { SpawnClass } from "../spawn_class";

/**
 * The signed bytes at `0x00564442 + subtype` — what each trigger sub-type
 * writes into `g_script_branch_var`.
 *
 * A sub-type absent here is a wanderer and writes nothing. The table's base is
 * chosen so that indices 2..4 land on real data: `0x00564442` and `+1` are the
 * tail of a `double`, which is the adjacent-array shape this project has a
 * lesson about, and only 2, 3 and 4 are ever read.
 */
export const CLASS52_BRANCH_BY_SUBTYPE: Partial<Record<number, number>> = {
  2: 2, 3: 1, 4: 2,
};

/**
 * The s16s at `0x00564444 + subtype * 2` — 18, 10, 10 for sub-types 2, 3
 * and 4. `Class52BranchTriggerUpdate` requires this to be non-zero before it
 * writes, and `[open]` is what the number itself is.
 */
export const CLASS52_TRIGGER_GATE: Partial<Record<number, number>> = {
  2: 18, 3: 10, 4: 10,
};

/** The sub-type below which the class wanders instead of triggering. */
export const CLASS52_FIRST_TRIGGER_SUBTYPE = 2;

function SubType(obj: Actor): number {
  return obj.class52?.subtype ?? 0;
}

/**
 * `Class52Init` — `FUN_0043F4C0`.
 *
 * ```c
 * obj->+0x3C = -1;  obj->+0x124 = 2.0;
 * sub = ActorAllocSub(0x28);
 * sub->+0x26 = tail->+0x00;                  // the sub-type
 * sub->+0x0C = 0.4;                          // the wander speed
 * sub->velocity = (sin yaw, _, cos yaw) * 0.4;
 * sub->+0x20 = 0x1385 + rand() % 10;         // the draw slot
 * if (sub->+0x26 < 2)      { ...; *obj = FUN_0043F5C0; }   // wander
 * else if (g_GameMode == 1) { sub->velocity = 0; sub->+0x20 = 0x1385;
 *                             *obj = Class52BranchTriggerUpdate; }
 * else ActorDespawn(obj);
 * ```
 *
 * **The mode gate is in the Init, not in the update**, which is why a
 * sub-type-2 critter in arcade is not a trigger that never fires — it is an
 * object that was never built. The port despawns it here for the same reason.
 *
 * The `rand() % 10` slot draw happens for every sub-type and is then thrown
 * away by the trigger arm, so it is made from `ctx.rng` whatever the sub-type:
 * a draw the engine makes and the port skips is a divergent RNG stream for
 * everything downstream of it.
 */
export function Class52Init(obj: Actor, rng?: Rng): void {
  void rng?.int(10);
  const sub = SubType(obj);
  if (sub < CLASS52_FIRST_TRIGGER_SUBTYPE) return;
  if (G.g_GameMode !== GameMode.Original) {
    // `ActorDespawn(obj)` — the arcade arm. `dead` rather than the pool
    // routine because the director's sweep is what retires an actor whose
    // class asked to leave on its first frame.
    obj.dead = true;
  }
}

/**
 * `Class52BranchTriggerUpdate` — `FUN_0043F720`, sub-state 0.
 *
 * ```c
 * case 0:
 *   if ((obj->+0x34 & 8) && *(s16 *)(0x00564444 + subtype * 2) != 0) {
 *       g_script_branch_var = *(s8 *)(0x00564442 + subtype);
 *       sub->+0x18 = 1;                       // start fleeing
 *       sub->+0x20 = sub->+0x24;              // the flee slot
 *       sub->+0x10 = obj->+0x44;
 *   }
 *   obj->+0x34 &= ~8;
 *   break;
 * ```
 *
 * The hit bit is cleared **whether or not the gate passed**, which is what
 * stops a sub-type with a zero gate answering on some later frame.
 */
export function Class52BranchTriggerUpdate(obj: Actor): void {
  const sub = SubType(obj);
  if ((obj.flags & ActorFlag.Hit) !== 0
      && (CLASS52_TRIGGER_GATE[sub] ?? 0) !== 0) {
    const value = CLASS52_BRANCH_BY_SUBTYPE[sub];
    if (value !== undefined) G.g_script_branch_var = value;
    // `sub->+0x18 = 1` — it starts to flee, and the flight is not ported.
    obj.dead = true;
  }
  obj.flags &= ~ActorFlag.Hit;
  obj.pendingHit = null;
}

function Class52Debug(obj: Actor): ActorDebug {
  const sub = SubType(obj);
  const writes = CLASS52_BRANCH_BY_SUBTYPE[sub];
  return {
    summary: writes === undefined
      ? `sub-type ${sub} · wanders, writes no route`
      : `sub-type ${sub} · shoot for route ${writes}`,
    detail: [`g_script_branch_var ${G.g_script_branch_var}`],
    hot: writes !== undefined,
  };
}

export const Class52Handler: ClassHandler = {
  init: Class52Init,
  update: (obj: Actor, f: ClassFrame) => {
    void f;
    if (SubType(obj) >= CLASS52_FIRST_TRIGGER_SUBTYPE) {
      Class52BranchTriggerUpdate(obj);
    }
  },
  // The class reads `obj+0x34` bit 3 itself and has no hit points at all.
  ownsShotResult: true,
  debug: Class52Debug,
};

registerClass(SpawnClass.Critter, Class52Handler);
