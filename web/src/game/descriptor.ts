/**
 * One place that turns a placement into the fields a class's `Init` reads.
 *
 * The engine has no such function: `SpawnFromDescriptor` (`FUN_00408A20`)
 * hands the class a pointer at `obj+0x1390` and every `Init` reads the tail
 * itself. The port cannot do that — the tail is decoded by the exporter into
 * named JSON — so the mapping from that JSON to `Actor` fields has to live
 * somewhere, and **it has to live in exactly one place**.
 *
 * That is not tidiness. `render/characters.ts` built this inline and the
 * headless harnesses each built their own copy, and the copies drifted: the
 * stationary-thrower harness passed `stand_throw` while the player did not, so
 * it reported nine working throwers while every one of them in the player read
 * a walk distance of zero and vanished the instant it had thrown. A harness
 * that builds its actor differently from the thing it is checking is testing
 * the port and not the player.
 *
 * `render/characters.ts` supplies the rest — the motion, the hit points, the
 * yaw and the position, which come from the glTF node rather than from here.
 */
import type { CharacterPlacement } from "../bundle/characters";
import type { Actor } from "./actor";

export function DescriptorFromPlacement(p: CharacterPlacement | undefined):
    Partial<Actor> {
  return {
    initialState: p?.initial_state ?? 0,
    attackState: p?.attack_state ?? 0,
    cameraCue: p?.camera_cue ?? null,
    condition: p?.body_condition ?? 0,
    ringSet: p?.ring_set ?? 0,
    leap: p?.leap ?? null,
    path: p?.path ?? null,
    walkDistance: p?.walk_distance ?? 0,
    entranceMotion: p?.entrance_motion ?? 0,
    pounce: p?.pounce ?? null,
    emerge: p?.emerge ?? null,
    delayedLeap: p?.delayed_leap ?? null,
    // The captor family's two script blobs, and the object they work on.
    // `CivilianInit` writes `child+0x1394 = this`, and `civilian_child` is
    // that pointer as a spawn address.
    script: (p?.target_script || p?.attack_script)
      ? { target: p.target_script ?? null, attack: p.attack_script ?? null }
      : null,
    targetAt: p?.civilian_child ?? -1,
    // Class 0x31's four other entrances. `replay.mjs` had been passing these
    // and `render/characters.ts` had not, which is the same drift the other
    // way round: the grab, the cue wait, the blink-in hold and the leap
    // strike all read a descriptor the player never handed them.
    grab: p?.grab ?? null,
    backAwayDelay: p?.back_away_delay ?? 0,
    cue: p?.cue ?? null,
    leapStrikeFrames: p?.leap_strike_frames ?? 0,
    // `ZombieStateStandAndThrow`'s delays and its way out.
    standThrow: p?.stand_throw,
    // The spawn record's own flags word — `ActorInitFlags` (`FUN_00408970`)
    // makes it `obj+0x34` before the class's `Init` ORs its own bits on.
    flags: p?.init_flags ?? 0,
  };
}
