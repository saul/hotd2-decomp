/**
 * The looping noise a held weapon makes — the chainsaw and the laser sword.
 *
 * This is the second of the two sounds that had been looked for under the name
 * "the idle groan", and it is the one that is genuinely *ambient*: it starts
 * when an actor is made and runs until one dies. The groan itself is not here
 * — it is a one-shot in `ZombieStateHoldAtRange` — and neither of them is one
 * of `ActorPlayHitVoice`'s five kinds, which all fire on an event.
 *
 * ## Why it is a refcount and not a field
 *
 * `PlaySoundId` (`FUN_0041CFD0`) hands back nothing. There is no handle, no
 * channel id and no per-actor sound state anywhere in the engine, and the only
 * way to silence a loop is to play an id out of `g_looping_se_stop_ids`
 * (`0x005888B0`), which calls `SoundStopAllLoopingSe` and stops **every** loop
 * in the mix. So a per-actor chainsaw is not expressible: the engine keeps one
 * shared loop per scene and counts holders in `g_weapon_loop_holders`
 * (`0x009C8A74`).
 *
 * ```
 *   first holder  -> PlaySoundId(0x4D17A9)   COMMON2\CHAIN_SAW_22.wav      loop
 *   last  holder  -> PlaySoundId(0x4E17A9)   COMMON2\CHAIN_SAW_22_OFF.wav  stop
 * ```
 *
 * The `_OFF` files are not shipped — 36 of the 324 SE names end that way and
 * none of them is on disc — which is the tell that they were never sounds.
 *
 * ## What proves it is the weapon and not the voice
 *
 * Two things, and it matters because the annotation on `0x009C8A74` used to
 * call this a groan voice and the one on `FUN_00456600` used to call it a
 * death scream:
 *
 * 1. the filenames. `g_se_name_list` (`0x005845F8`) resolves the four ids to
 *    `CHAIN_SAW_22`, `CHAIN_SAW_22_OFF`, `LASER_SWORD_22` and
 *    `LASER_SWORD_22_OFF`;
 * 2. `ActorUpdateBodyCondition` (`FUN_00454270`) calls the release for a
 *    character-type-2 actor the moment **neither hand still holds its prop**.
 *    Shoot the chainsaw out of its hands and the noise stops while the actor
 *    is still alive, which a voice would not do.
 */
import type { Events } from "../../core/events";
import type { ZombieActor } from "../actor";
import { G } from "../globals";

/**
 * The two character types that carry a looping weapon, and the pair of ids
 * each one plays.
 *
 * `EnemyZombieInitByCharType`'s switch has one arm for both — case 2 falls
 * through into case 3 — and the only thing it branches on afterwards is
 * `obj+0x1F4 == 2`, twice: once for the start id and once for the stop. So
 * this is the whole of the character-type dependence.
 */
export enum WeaponLoopType {
  /** The chainsaw: `COMMON2\CHAIN_SAW_22.wav`. */
  ChainSaw = 2,
  /** The laser sword: `STAGE6_SE\LASER_SWORD_22.wav`. */
  LaserSword = 3,
}

/** `PUSH 0x4d17a9` at `0x00453143` — entry 4 of `g_looping_se_ids`. */
const CHAIN_SAW_LOOP = 0x4d17a9;
/** `PUSH 0x1f25a9` at `0x0045314a` — entry 34 of the same table. */
const LASER_SWORD_LOOP = 0x1f25a9;
/** `DAT_004e17a9` at `0x00456620` — entry 4 of `g_looping_se_stop_ids`. */
const CHAIN_SAW_STOP = 0x4e17a9;
/** `0x2025a9` at `0x00456627` — entry 34 of the same table. */
const LASER_SWORD_STOP = 0x2025a9;

/**
 * The character-type-2-and-3 arm of `EnemyZombieInitByCharType`
 * (`FUN_00452FD0`), sound only.
 *
 * `[port-only]` as a *function*: the engine has no routine here, only that
 * `switch` arm, and `init_char.ts` already ports the routine it belongs to
 * under its own name. It is split out because the release is a real function
 * (`FUN_00456600`) with two callers, and a take that lived inline while its
 * release sat in another file is how the two halves of a refcount drift apart.
 *
 * The arm also loads the held prop into the actor's two draw slots
 * (`obj+0x550`/`0x564`/`0x554` and `obj+0x700`/`0x704`/`0x714`, all from the
 * descriptor tail's `+0x10`) and, for type 2 alone, raises `obj+0x136C` bit
 * 0x400. None of that is ported — the port has no per-bone prop slots for
 * class 0x30 — and it is called out here rather than silently dropped.
 *
 * `[proved]` The gate is `g_weapon_loop_holders == 0` and nothing else:
 *
 * ```
 * 00453133  8b15748a9c00   MOV  EDX, dword ptr [0x009c8a74]
 * 00453139  3bd0           CMP  EDX, EAX          ; EAX = 0
 * 0045313b  751a           JNZ  0x00453157        ; someone already has it
 * 0045313d  6683f902       CMP  CX, 0x2           ; obj+0x1F4
 * 00453143  68a9174d00     PUSH 0x4d17a9
 * 0045314a  68a9251f00     PUSH 0x1f25a9
 * 0045314f  e87c9efcff     CALL PlaySoundId
 * 00453157  a1748a9c00     MOV  EAX, [0x009c8a74]
 * 0045315d  40             INC  EAX
 * 0045315f  a3748a9c00     MOV  [0x009c8a74], EAX
 * 00453164  c6851b13000001 MOV  byte ptr [EBP + 0x131b], 0x1
 * ```
 *
 * so the increment and the latch happen for **every** holder and the sound for
 * only the first.
 */
export function EnemyZombieTakeWeaponLoopSe(obj: ZombieActor,
                                            events?: Events): void {
  if (obj.charType !== WeaponLoopType.ChainSaw
      && obj.charType !== WeaponLoopType.LaserSword) {
    return;
  }
  if (G.g_weapon_loop_holders === 0) {
    events?.emit("sound.play", {
      id: obj.charType === WeaponLoopType.ChainSaw
        ? CHAIN_SAW_LOOP : LASER_SWORD_LOOP,
    });
  }
  G.g_weapon_loop_holders += 1;
  obj.weaponLoopHeld = 1;
}

/**
 * `ZombieReleaseWeaponLoopSe` — `FUN_00456600`.
 *
 * Called from `ZombieStateDeath6` sub 1 and from `ActorUpdateBodyCondition`
 * (`FUN_00454270`) when a chainsaw actor has lost both hand props. Both paths
 * are the same three steps: refuse unless this actor is a holder, play the
 * stop id if it is the *last* holder, then drop the latch and the count.
 *
 * The stop id is raised whether or not anything is listening, because in the
 * engine it is not a sound: `PlaySoundId` recognises it in
 * `g_looping_se_stop_ids` and calls `SoundStopAllLoopingSe` before handing the
 * (missing) file to the mixer. `audio/bgm.ts` transcribes that branch, so
 * raising the id here is what actually silences the loop.
 */
export function ZombieReleaseWeaponLoopSe(obj: ZombieActor,
                                          events?: Events): void {
  if (obj.weaponLoopHeld !== 1) return;
  if (G.g_weapon_loop_holders === 1) {
    events?.emit("sound.play", {
      id: obj.charType === WeaponLoopType.ChainSaw
        ? CHAIN_SAW_STOP : LASER_SWORD_STOP,
    });
  }
  obj.weaponLoopHeld = 0;
  G.g_weapon_loop_holders -= 1;
}
