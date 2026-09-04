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
 * `SpawnScriptedCharacters` supplies the rest — the motion, the hit points
 * (`ActorInitHitPoints`), the yaw, and the position, which comes from the glTF
 * node rather than from the placement and so crosses from `render/` as a
 * `CharacterSpawnRequest`.
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
    // `desc+0x04` -- `*(float *)(obj+0x1390 + 4)`, four bytes into the
    // descriptor parameter tail. Not `obj+0x04`, which is inside the task
    // control block `ActorAlloc` (`FUN_004A6FA0`) owns.
    walkDistance: p?.walk_distance ?? 0,
    entranceMotion: p?.entrance_motion ?? 0,
    pounce: p?.pounce ?? null,
    emerge: p?.emerge ?? null,
    // `ZombieStateMotionCue21`'s two parameters, descriptor `+0x04` and
    // `+0x08`: the clip the entrance plays and the frames it holds before it
    // starts. `render/characters.ts` used to set this itself, which made it
    // the one descriptor field the headless harnesses never saw.
    intro: p?.intro ?? null,
    delayedLeap: p?.delayed_leap ?? null,
    // The twelve entrance states' tails, one union narrowed by the state --
    // see `class30/entrance.ts`.
    entry: p?.entry ?? null,
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
    // Class 0x20's whole tail, under its own key. `OneHitTargetInit`
    // (`FUN_00448ED0`) reads `tail+0x00`/`+0x01` as the character type and a
    // sub-type, where `EnemyZombieInit` reads the same two bytes as the body
    // condition and the initial state -- so this cannot ride on
    // `condition`/`initialState` above without one class reading the other's.
    oneHitTarget: p?.class20 ?? null,
    // The spawn record's own flags word — `ActorInitFlags` (`FUN_00408970`)
    // makes it `obj+0x34` before the class's `Init` ORs its own bits on.
    flags: p?.init_flags ?? 0,
    // ...and the descriptor's *second* word, at `+0x20`, which
    // `SpawnFromDescriptor` (`FUN_00408A20`) puts at `obj+0x1316` — also
    // before `Init` runs, which is what lets `EnemyThrowerInit` read it as the
    // low half of `obj+0x136C`. The exporter used to drop it.
    descFlags: p?.desc_flags ?? 0,
  };
}
