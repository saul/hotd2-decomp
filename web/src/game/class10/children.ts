/**
 * The child list — the zombies holding a civilian, and the rescue that
 * emptying it pays for.
 *
 * `CivilianInit` (`FUN_0048A3E0`) reads a child count at the descriptor tail's
 * `+0x0C` and an array of descriptor pointers at `+0x10`, and parents every
 * one at `child+0x1394`. **Nothing in the evt's instruction stream points at
 * those descriptors**, so the script walker never saw them and this port had
 * neither the zombies nor the rescue. Both routines here read that list and
 * nothing else does.
 */
import { ActorFlag, type Actor } from "../actor";
import { ActorByAt } from "../globals";
import { CivilianHook } from "./ops";
import { ActorTurnTowardPoint } from "./turn";

/** `CivilianHookRideChildrenStep`'s turn cap, 0x0048DB6C. */
const RIDE_TURN_CAP = 0x80;

/**
 * `CivilianPruneDeadChildren` — `FUN_0048CA60`.
 *
 * Drops every child whose `obj+0x34` carries the dead bit, remembering the
 * player named at `child+0x131C` — which is who gets the +400 when the last
 * one goes.
 *
 * **The bit is the whole test.** `[proved]`: the loop reads
 * `*(u32 *)(child + 0x34) & 0x4000000` and nothing else. It used to be
 * `kid.dead || flags & Dead`, and a child **missing from the pool** was
 * dropped as well — so a captor that left by `ActorDespawn` (`FUN_00409CC0`),
 * which raises `0x80018000` and never `0x4000000`, counted as a rescue here
 * and in no engine. A child the pool no longer holds is kept: the engine's
 * list still points at it, and its last flags word is what it would read.
 * Every ordinary way out — a kill, `ZombieRetireAndCredit` (`0x4008001`),
 * `ZombieStateDragTarget`'s flag-29 exit — raises the bit before the actor
 * goes, and the civilian updates every frame in between, so none of them is
 * missed.
 */
export function CivilianPruneDeadChildren(obj: Actor): void {
  const sub = obj.civ;
  if (!sub) return;
  const keep: number[] = [];
  for (const at of sub.children) {
    const kid = ActorByAt(at);
    if (!kid || !(kid.flags & ActorFlag.Dead)) {
      keep.push(at);
      continue;
    }
    sub.rescuePlayer = kid.killedBy ?? -1;
    // `sub+0x64` is the pounce slot; the engine clears it when the child
    // holding it goes, or the next one never gets a turn.
    if (sub.pouncer === at) sub.pouncer = 0;
  }
  sub.children = keep;
  sub.childCount = keep.length;
}

/**
 * `CivilianHookRideChildrenStep` — `FUN_0048DAB0`.
 *
 * Averages the surviving captors' positions and turns the civilian toward it
 * at up to 0x80 BAMS a frame — a **facing**, not a carry. Uninstalls itself
 * once the object is flagged dead, and does **not** raise `sub+0x18`, so wait
 * bit 0x400 never ends on this one.
 */
export function CivilianHookRideChildrenStep(obj: Actor): void {
  const sub = obj.civ;
  if (!sub) return;
  if (obj.flags & ActorFlag.Dead) { sub.hook = CivilianHook.None; return; }
  const n = sub.children.length;
  if (n === 0) return;
  const mid = { x: 0, y: 0, z: 0 };
  for (const at of sub.children) {
    const kid = ActorByAt(at);
    if (!kid) continue;
    mid.x += kid.pos.x; mid.y += kid.pos.y; mid.z += kid.pos.z;
  }
  mid.x /= n; mid.y /= n; mid.z /= n;
  ActorTurnTowardPoint(obj, mid, RIDE_TURN_CAP);
}
