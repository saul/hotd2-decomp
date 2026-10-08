import { Zombie1368Flag } from "../../src/game/class30/state";
import type { CharactersJson, CharacterType } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { ticksOfAuthoredFrame } from "../../src/core/play_cursor";
import {
  ActorInitHitPoints, ActorSpawn, GameUpdate,
} from "../../src/game/director";
import {
  ActorKillAll, RemoveBoneSubtree,
} from "../../src/game/combat/resolve_hit";
import { RegisterEnemySlot } from "../../src/game/camera/slots";
import { ActorAdvanceMotion } from "../../src/game/motion";
import { MOTION_FLAGS_INIT, MotionFlag } from "../../src/game/actor";
import {
  ActorByAt, AppState, G, ResetGameGlobals, ResetSceneOnEnter,
} from "../../src/game/globals";
import { NULL_HOST } from "../../src/game/host";
import { RING_EFFECT_SPREAD_FRAMES } from "../../src/game/effects/ring_effect";
import { SpriteEffectKind } from "../../src/game/effects/sprite";
import {
  MotionOf, MotionPlayFrame, MotionPlayLength, SetGameTables, T,
} from "../../src/game/tables";
import { MotionFade, MotionRow, StrikeSub, ZombieState }
  from "../../src/game/class30/states";
import { ZombieStateStrike } from "../../src/game/class30/strike";
import { ActorDrawShadow, ActorSetPartVisibility, PART_ALPHA_CHAR_TYPES,
         ActorRunNodeDrawHooks } from "../../src/game/model_draw";
import { REGROW_FULL, ThrowerDrawBonePart } from "../../src/game/class31/draw";
import { ZombieDrawBonePart } from "../../src/game/class30/draw";
import { ZombieTwinAt } from "../../src/game/class30/twin";
import {
  ActorFlag, ThrowerFlag, ZombieFlag2, type Actor, type ThrowerActor,
  type ZombieActor,
} from "../../src/game/actor";
import {
  ReleaseAttackSlot, ThrowerReleaseAttackPermit, ThrowerTryClaimAttackSlot,
  TryClaimAttackSlot,
} from "../../src/game/combat/permits";
import { ZombieEnterCorpseState, ZombieReleasePermitAndUntrack }
  from "../../src/game/class30/death";
import { ZombieOnShot } from "../../src/game/class30/on_shot";
import { DrawSkinnedModelAndShadow } from "../../src/game/skeleton";
import { CarrierTransformPoint } from "../../src/game/carrier";
import { GROUND_SHADOW_LAYER, GROUND_SHADOW_SLOT }
  from "../../src/game/ground_shadow";
import { ThrowerReleaseSlotOnDeath } from "../../src/game/combat/counts";
import {
  COND_HEAVY_LANDING, LANDING_HEAVY_SHAKE, SND_LANDING, SND_LANDING_HEAVY,
  ZOMBIE_DEATH_EFFECT_CUES,
} from "../../src/game/class30/death_effects";
import { SpawnGroundRingEffect, type RingEffect }
  from "../../src/game/effects/ring_effect";
import { WATER_RING_FRAMES, WATER_RING_SLOT }
  from "../../src/game/effects/water_ring";
import { ZombieStateArcScriptedEntrance } from "../../src/game/class30/entrance";
import { ZombieStateDelayedLeap } from "../../src/game/class30/emerge";
import { ArcPhase } from "../../src/game/class31/arc";
import { OPS as SCENE_OPS } from "../../src/script/ops/scene";
import type { SpriteEffect } from "../../src/game/effects/sprite";
import { UpdateScreenShake } from "../../src/game/effects/damage_overlay";
import { type ClassFrame, g_class_handlers } from "../../src/game/registry";
import { ZOMBIE_SPRINTS, ZombieRunMotion } from "../../src/game/class30/states";
import { ZombieRunTurnRate } from "../../src/game/class30/attack_run";
import { SpawnClass } from "../../src/game/spawn_class";
import { ThrowerStateCorpseBlink } from "../../src/game/class31/death";
import { ThrowerStateRestoreBothHands } from "../../src/game/class31/standing";
import { ActorClipLength } from "../../src/game/class31/arc";
import { ThrowerState } from "../../src/game/class31/states";
import { dist2d, vec3, type Vec3 } from "../../src/game/vec";
import {
  ActorPlayHitReaction, HitResultCode, ResolveHit,
} from "../../src/game/combat/resolve_hit";
import { ActorSetMotionBlended } from "../../src/game/class30/motion_cue";
import { Walker } from "../../src/script/walker";
import {
  check, motion, TYPE, CHARS, SCENE_MAJOR_PLAYING, DRAW_FRAME, spawnZombie,
  openShutter, scene, slotHolds, slotsShown, EnterPlay, run, TYPE31_ZSLMAN,
  CHARS31, coliQuad, FLOOR_BLOB, shadowsUnder,
} from "./harness";

/**
 * Every clip `ChooseDeathMotionDirectional` can give this fixture: the 0x0000
 * table's one, the 0x8000 table's one, and the two side literals. Which of
 * them a death takes is the camera block's yaw against the actor's, so a test
 * about the death *chain* accepts any of the four.
 */
const DIRECTIONAL_DEATHS = [900, 901, 991, 992];

// -- 15. class 0x30's own death chain ---------------------------------------

/**
 * The bug this section exists for: **a killed zombie never left the pool.**
 *
 * `ResolveHit` set `dead`, the director stopped updating the actor, and it
 * stood there for the rest of the stage still counted in `g_enemies_present`.
 * `tools/killall.mjs` showed three of them at `dead=true visible=true
 * state=18` nine hundred frames after the kill.
 *
 * Every assertion below fails without `class30/death.ts` and
 * `class30/on_shot.ts`: there was no edge into state 6, and no state 6.
 */
console.log("class 0x30, the death chain:");
{
  const rng = new Rng(11);
  const events = scene(1, rng);
  const z = G.g_object_list[0];
  z.hp = 1;
  const alive0 = G.g_enemies_alive;
  const present0 = G.g_enemies_present;
  check("one zombie, alive and present", alive0 === 1 && present0 === 1,
        `${alive0}/${present0}`);
  TryClaimAttackSlot(z, new Rng(1), NULL_HOST);

  ResolveHit(z, 1, NULL_HOST, rng);
  check("the killing shot leaves a hit record for `ZombieOnShot`",
        z.pendingHit !== null && z.dead);
  check("...and nothing has moved the actor into a state yet",
        z.state !== ZombieState.Death, `state ${z.state}`);

  // One update. `EnemyZombieUpdate` runs `ZombieOnShot` first, so state 6 is
  // entered and its subs 0, 1 and 2 all run on this frame -- the engine falls
  // through 0x00454D42 into 0x00454D49 and on into 0x00454D90.
  GameUpdate(1 / 60, NULL_HOST, rng, events);
  check("one update puts it in `ZombieState.Death`",
        z.state === ZombieState.Death, `state ${z.state}`);
  check("...at sub 2, because subs 0 and 1 are a fallthrough",
        z.sub === 2, `sub ${z.sub}`);
  check("...playing a death clip picked by `ChooseDeathMotion`",
        DIRECTIONAL_DEATHS.includes(z.motion),
        `motion ${z.motion} yaw ${z.yaw} block ${G.g_camera_block_yaw_bams}`);
  check("...with `obj+0x34` bits 0x22000 raised",
        (z.flags & (ActorFlag.Airborne | ActorFlag.NoHitReaction))
          === (ActorFlag.Airborne | ActorFlag.NoHitReaction),
        z.flags.toString(16));
  check("...the permit and the latch given back",
        z.attackPermit === -1 && G.g_attack_committed === 0
        && G.g_attack_permits.every((x) => x === -1));
  check("...out of `g_enemies_alive`", G.g_enemies_alive === 0,
        `${G.g_enemies_alive}`);
  // The whole point of two counters: the body is on stage, so it is present.
  check("...but still present, because the corpse is not finished",
        G.g_enemies_present === 1, `${G.g_enemies_present}`);
  check("...and still in the pool",
        G.g_object_list.some((o) => o.at === z.at));

  // The death clip plays **exactly once**: state 6 leaves at
  // `g_motion_play_length[obj+0x1B4] - 1`, which for the fixture's 30-frame
  // clips is 58 ticks -- after the fade in. `ChooseDeathMotion` starts it
  // over `MotionFade.Quick`, and the engine holds a faded-in clip on its
  // start frame until the fade is done (`SkeletonAdvancePlayCursor`,
  // `FUN_004111A0`), which puts the whole fade in front of those 58.
  const clipTicks = MotionPlayLength(z) + MotionFade.Quick;
  let toCorpse = -1;
  for (let i = 0; i < 400 && toCorpse < 0; i++) {
    GameUpdate(1 / 60, NULL_HOST, rng, events);
    if (z.state === ZombieState.CorpseSink) toCorpse = i + 1;
  }
  check("the clip runs once and hands to `ZombieEnterCorpseState`",
        toCorpse > 0 && toCorpse <= clipTicks + 2,
        `after ${toCorpse} frames, clip ${clipTicks}`);
  check("...which is what drops `g_enemies_present`",
        G.g_enemies_present === 0, `${G.g_enemies_present}`);
  check("...and freezes the pose", (z.flags & ActorFlag.PoseFrozen) !== 0,
        z.flags.toString(16));
  check("...and takes the corpse out of both pushes",
        (z.flags2 & (ZombieFlag2.CollideWorld | ZombieFlag2.CollideActors))
          === 0, z.flags2.toString(16));

  // 0x78 frames of sinking, then `ActorDespawn`. **The engine's own timer, not
  // an invented one** -- `FUN_00454F20` writes `obj+0x1330 = 0x78` and counts
  // it down, and calls `ActorDespawn` itself at the end.
  const y0 = z.pos.y;
  let left = -1;
  for (let i = 0; i < 400 && left < 0; i++) {
    GameUpdate(1 / 60, NULL_HOST, rng, events);
    if (!G.g_object_list.some((o) => o.at === z.at)) left = i + 1;
  }
  check("the corpse sinks", z.pos.y < y0 - 1, `${y0} -> ${z.pos.y}`);
  check("...and leaves the pool after 0x78 frames",
        left >= 0x76 && left <= 0x7a, `after ${left} frames`);
  check("...taking both counts with it, once",
        G.g_enemies_alive === 0 && G.g_enemies_present === 0,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);
}

/**
 * **B5 — a fatal hit mid-swing must not wait for the swing to finish.**
 *
 * `ZombieStateStrike` (`FUN_00455A40`) plays the swing on the actor's
 * *ordinary* motion — `FUN_004119A0(obj+0x194, entry->strike, 0, 5)` at
 * 0x00455B8A, read back through `obj+0x1B4`/`obj+0x19C` — so when
 * `ChooseDeathMotion` (`FUN_004560B0`) writes the same track the swing is over
 * by construction. The port gives the swing a channel of its own so the poser
 * can hold it at full weight, and nothing was ending it: the actor finished
 * its bite and only then fell over.
 *
 * The fix is in `ActorSetMotionBlended` / `ActorSetMotion`, so this asserts
 * both the primitive and the whole death path through `GameUpdate`.
 */
console.log("class 0x30, a fatal hit lands *during* the swing:");
{
  const rng = new Rng(37);
  const events = scene(1, rng);
  const z = G.g_object_list[0] as ZombieActor;
  const atk = TYPE.attacks["0"]["1"];

  // Mid-swing: the state machine's own shape after `StrikeSub.Lunge`.
  z.state = ZombieState.Strike;
  z.sub = StrikeSub.Swinging;
  z.attack = 1;
  z.action = { motion: atk.strike, ticks: 4 };
  z.hp = 1;

  ActorSetMotionBlended(z, TYPE.motion_row["0"][MotionRow.BackAway], 0, 10);
  check("writing the motion track ends the one-shot on it",
        z.action === null, JSON.stringify(z.action));
  check("...fading out of the swing, not out of the base clip",
        z.fadeFrom?.motion === atk.strike && z.fadeFrom?.ticks === 4,
        JSON.stringify(z.fadeFrom));

  // ...and the whole path: shoot it dead while the swing runs.
  z.state = ZombieState.Strike;
  z.sub = StrikeSub.Swinging;
  z.action = { motion: atk.strike, ticks: 4 };
  ResolveHit(z, 1, NULL_HOST, rng);
  check("the shot kills it mid-swing", z.dead && z.pendingHit !== null);
  GameUpdate(1 / 60, NULL_HOST, rng, events);
  check("one update takes it out of the swing and into `Death`",
        z.state === ZombieState.Death, `state ${z.state}`);
  check("...and the swing is gone, so the death clip is what is posed",
        z.action === null && DIRECTIONAL_DEATHS.includes(z.motion),
        `action ${JSON.stringify(z.action)} motion ${z.motion}`);
}

/**
 * **`ZombieStateStrike`'s two motion calls fade, and the fade holds.**
 *
 * `SetCurrentActorMotionBlended(obj+0x194, entry->lunge, 0, 10)` at
 * `0x00455B49` and `ActorSetMotionBlended(obj+0x194, entry->strike, 0, 5)` at
 * `0x00455B63`: one track, a fade each, and `SkeletonAdvancePlayCursor`
 * (`FUN_004111A0`) holds the cursor `obj+0x19C` on the start frame while the
 * fade runs. The port started both on its one-shot channel with no fade, so
 * the swing's cursor left 0 on the frame after it was set and the hit landed
 * `fade` frames early -- and it restarted the lunge unless the one-shot
 * channel already held it, where the engine skips the call while **the track**
 * is playing it (`00455b31 CMP [ESI+0x1b4], EAX` / `00455b37 JZ`).
 *
 * The frames are driven in the director's order -- `ActorAdvanceMotion`, then
 * the state -- so every count here is what the port's states actually see.
 */
console.log("class 0x30, the lunge and the swing hold through their fades:");
{
  const rng = new Rng(43);
  scene(0, rng);
  const atk = TYPE.attacks["0"]["1"];
  const walk = TYPE.motion_row["0"][MotionRow.Walk];
  const striker = (dz: number, over: Partial<Actor> = {}): ZombieActor => {
    const z = spawnZombie(0x7a00, 1, "striker");
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.attackState = 1;
    z.attackPermit = 0;
    z.state = ZombieState.Strike;
    z.sub = StrikeSub.Lunge;
    z.attack = 1;
    z.motion = walk;
    z.playTicks = 7;
    z.action = null;
    z.fadeFrom = null;
    z.fade = 0;
    z.pos = vec3(0, 0, dz);
    Object.assign(z, over);
    return z;
  };
  const frame = (z: ZombieActor): void => {
    ActorAdvanceMotion(z, 1 / 60);
    ZombieStateStrike(z, rng);
  };

  // The lunge: on the ordinary track, fade 10, held 11 frames.
  {
    const z = striker(atk.distance + 20);
    ZombieStateStrike(z, rng);
    check("the lunge goes on the ordinary track, fading out of the walk over 10",
          z.action === null && z.motion === atk.lunge && z.playTicks === 0
            && z.fadeFrom?.motion === walk
            && z.fadeLen === MotionFade.Normal + 1,
          `action ${JSON.stringify(z.action)} motion ${z.motion} `
          + `ticks ${z.playTicks} from ${JSON.stringify(z.fadeFrom)} `
          + `len ${z.fadeLen}`);
    const at = { ...z.pos };
    let held = 1;
    let moved = 0;
    for (; held < 40; held++) {
      frame(z);
      if (z.playTicks !== 0) break;
      moved = Math.max(moved, dist2d(z.pos, at));
    }
    check("...its cursor holds 0 for `fade + 1` = 11 frames, "
          + "counting the one that set it",
          held === MotionFade.Normal + 1 && z.playTicks === 1
            && z.sub === StrikeSub.Lunge,
          `${held} frames, then ${z.playTicks}`);
    check("...and its root motion holds with it", moved === 0,
          `moved ${moved.toFixed(3)}`);
    // Past a whole cycle, kept out of range: the clip wraps on the track and
    // nothing sets it again.
    let restarted = false;
    let last = z.playTicks;
    for (let i = 0; i < 90; i++) {
      z.pos = vec3(0, 0, atk.distance + 20);
      frame(z);
      if (z.playTicks <= last || z.fadeFrom !== null) restarted = true;
      last = z.playTicks;
    }
    check("...and then runs on through its own wrap without being restarted",
          !restarted && z.motion === atk.lunge && z.action === null,
          `restarted ${restarted} ticks ${z.playTicks}`);
  }

  // The gate is the track, not a channel of the port's.
  {
    // 155 of the 311 shipped attack entries name their run as the lunge. The
    // hold hands to the strike before it sets its idle, so the run is still
    // on the track here, and the engine lets it run on as the lunge.
    const z = striker(atk.distance + 20, { motion: atk.lunge,
                                           playTicks: 23 });
    ZombieStateStrike(z, rng);
    check("a lunge clip already on the track is left running",
          z.action === null && z.motion === atk.lunge && z.playTicks === 23
            && z.fadeFrom === null,
          `action ${JSON.stringify(z.action)} ticks ${z.playTicks} `
          + `from ${JSON.stringify(z.fadeFrom)}`);
  }
  {
    // ...but with a one-shot over it, the one-shot is what is on screen.
    const z = striker(atk.distance + 20, {
      motion: atk.lunge, playTicks: 23,
      action: { motion: 700, ticks: 9 },
    });
    ZombieStateStrike(z, rng);
    check("...while one under a one-shot is set again, out of the one-shot",
          z.action === null && z.motion === atk.lunge && z.playTicks === 0
            && z.fadeFrom?.motion === 700 && z.fadeFrom?.ticks === 9,
          `action ${JSON.stringify(z.action)} ticks ${z.playTicks} `
          + `from ${JSON.stringify(z.fadeFrom)}`);
  }

  // The swing: fade 5, held 6 frames, and the hit waits it out.
  {
    const z = striker(atk.distance - 1, { motion: atk.lunge, playTicks: 30 });
    const m = MotionOf(z, atk.strike);
    let swungAt = -1;
    let hitAt = -1;
    let ticksAtHit = -1;
    let endAt = -1;
    let fadedFromLunge = false;
    const zeros: number[] = [];
    for (let i = 0; i < 120 && endAt < 0; i++) {
      frame(z);
      if (swungAt < 0 && z.sub === StrikeSub.Swinging) {
        swungAt = i;
        fadedFromLunge = z.fadeFrom?.motion === atk.lunge
          && z.fadeLen === MotionFade.Quick + 1
          && z.action?.motion === atk.strike;
      }
      if (z.action?.motion === atk.strike && z.action.ticks === 0) {
        zeros.push(i);
      }
      if (hitAt < 0 && z.struck) {
        hitAt = i;
        ticksAtHit = z.action?.ticks ?? -1;
      }
      if (z.state === ZombieState.BackOff) endAt = i;
    }
    const q = MotionFade.Quick;
    check("the swing starts on the frame the lunge comes in range, "
          + "fading out of the lunge over 5",
          swungAt === 0 && fadedFromLunge,
          `swung at ${swungAt}, from ${JSON.stringify(z.fadeFrom)}`);
    check("...its cursor holds 0 for `fade + 1` = 6 frames, "
          + "counting the one that set it",
          zeros.length === q + 1 && zeros[0] === swungAt
            && zeros[q] === swungAt + q,
          zeros.join(","));
    check("...so the hit lands `fade` frames after the unheld clip put it, "
          + "on the entry's own frame",
          hitAt === swungAt + q + atk.hit_frame
            && ticksAtHit === atk.hit_frame,
          `hit at ${hitAt} (was ${swungAt + atk.hit_frame}), `
          + `ticks ${ticksAtHit}`);
    check("...and the clip hands to the retreat that much later too",
          m !== null && endAt === swungAt + q
            + ticksOfAuthoredFrame(m.frames - 1, m.fps),
          `end at ${endAt}`);
  }
}

/**
 * **B12 — the stumble comes from the actor's own body-condition row.**
 *
 * `004544ec 8b8e0c130000` reads `obj+0x130C` and `0045450a 8b1c0b` indexes the
 * character's reaction table with it. The port read row `"0"` for every actor,
 * so the 21 character types with a second row at body condition 3 could never
 * reach it.
 */
console.log("class 0x30, the stumble is indexed by body condition:");
{
  const rng = new Rng(38);
  scene(0, rng);
  const z = spawnZombie(0x3400, 1, "stumbler");
  z.visible = true;
  z.hp = z.maxHp = 100;
  check("condition 0 takes row 0",
        ActorPlayHitReaction(z, 1, HitResultCode.Damaged)
          === TYPE.reactions["0"][1], String(z.react?.motion));
  z.condition = 3;
  check("...and condition 3 takes row 3, which row 0 never named",
        ActorPlayHitReaction(z, 1, HitResultCode.Damaged)
          === TYPE.reactions["3"][1], String(z.react?.motion));
  z.condition = 9;                       // a row the fixture does not carry
  check("...and a condition with no row of its own falls back to row 0",
        ActorPlayHitReaction(z, 1, HitResultCode.Damaged)
          === TYPE.reactions["0"][1], String(z.react?.motion));
}

console.log("class 0x30, the corpse that blinks:");
{
  const rng = new Rng(12);
  const events = scene(0, rng);
  // `ZombieEnterCorpseState` sends character types 0x12 and 3 to state 8.
  const z = spawnZombie(0x3000, 1, "blinker");
  z.visible = true;
  z.hp = 1;
  z.charType = 3;
  z.motion = 900;
  ZombieEnterCorpseState(z);
  check("character type 3 becomes a blinking corpse",
        z.state === ZombieState.CorpseBlink, `state ${z.state}`);
  z.charType = 1;
  z.state = ZombieState.Death;
  ZombieEnterCorpseState(z);
  check("...and every other type a sinking one",
        z.state === ZombieState.CorpseSink, `state ${z.state}`);

  z.charType = 3;
  z.state = ZombieState.CorpseBlink;
  z.sub = 0;
  // Two gates, one value: `obj+0x1F8` bit 0 for the skeleton and every part's
  // byte through `ActorSetPartVisibility` (`FUN_00409D10`) for the waist and
  // the skirt. The body is hidden by closing them, not by an alpha.
  const seen: string[] = [];
  const shadow: boolean[] = [];
  const y0 = z.pos.y;
  for (let i = 0; i < 4; i++) {
    GameUpdate(1 / 60, NULL_HOST, rng, events);
    seen.push(`${z.motionFlags & MotionFlag.Drawn}:${z.partVisible}`);
    shadow.push(shadowsUnder(z).length !== 0);
  }
  check("the blink is the countdown's parity on both gates, first frame drawn",
        seen.join(" ") === "1:1,1 0:0,0 1:1,1 0:0,0", seen.join(" "));
  check("...the alpha is not what does it", z.alpha === 1, `alpha ${z.alpha}`);
  // `0xA0000` at the corpse's opening raises `0x80000`, so the shadow is off
  // for the whole corpse and not only on the odd frames.
  check("...and the corpse has no shadow on any frame",
        shadow.every((s) => !s), JSON.stringify(shadow));
  check("...and it does not sink", z.pos.y === y0, `${y0} -> ${z.pos.y}`);
  // The way out closes both gates before the despawn -- `AND EDX, ~1` at
  // 0x0045508C and `ActorSetPartVisibility(model, 0)` at 0x00455096 -- so the
  // corpse's last frame is a hidden one, whichever parity it ends on.
  for (let i = 0; i < 200 && !z.despawned; i++) {
    GameUpdate(1 / 60, NULL_HOST, rng, events);
  }
  check("...and it leaves hidden, skeleton and parts both closed",
        z.despawned && (z.motionFlags & MotionFlag.Drawn) === 0
        && z.partVisible.join() === "0,0",
        `despawned ${z.despawned} flags ${z.motionFlags} parts ${z.partVisible}`);
}

console.log("the skinned model's draw gates, as state:");
{
  const rng = new Rng(14);
  scene(0, rng);
  // `ActorBuildSkinnedModel` (`FUN_00410440`): `model+0x64 = 3`, and one
  // eight-byte record per `g_pCharacterExtraParts` entry with byte `+1` at 1.
  const z = spawnZombie(0x3080, 1, "built");
  // ...and then `EnemyZombieInit` ORs bit 4 in (`0x00452E21`), the trace the
  // corpse's ring and the shadow take -- so a class-0x30 actor carries 7.
  check("the build leaves the skeleton drawn and one byte per part, all 1",
        z.motionFlags === (MOTION_FLAGS_INIT | MotionFlag.TraceGround)
        && (z.motionFlags & MotionFlag.Drawn) !== 0
        && z.partVisible.length === TYPE.parts!.length
        && z.partVisible.every((v) => v === 1),
        `flags ${z.motionFlags} parts ${z.partVisible}`);
  // `ActorSetPartVisibility` (`FUN_00409D10`) takes 0 or 1 and nothing else:
  // `CMP EDX, 0x1` / `TEST EDX, EDX` / `JNZ` past the loop.
  ActorSetPartVisibility(z, 0);
  const off = z.partVisible.join();
  ActorSetPartVisibility(z, 2);
  check("ActorSetPartVisibility writes every part, and ignores anything but 0/1",
        off === "0,0" && z.partVisible.join() === "0,0",
        `${off} then ${z.partVisible}`);
  ActorSetPartVisibility(z, 1);
  check("...and reaches the parts only, never the skeleton's gate",
        z.partVisible.join() === "1,1"
        && (z.motionFlags & MotionFlag.Drawn) !== 0);

  // `ActorDrawShadow` (`FUN_0040A590`): `obj+0x34` bit 0x80000 and
  // `obj+0x1F8` bit 0, then 11x10 -- or 50x30 for types 0x44 and 0x47 --
  // as `MatrixScale(w, 1.0, d)` on the disc's matrix: no turn, so the scale
  // is the diagonal.
  const size = (): string => {
    G.g_world_slot_draws = [];
    ActorDrawShadow(z);
    const d = shadowsUnder(z)[0];
    return d ? `${d.m[0]}x${d.m[10]}` : "none";
  };
  const small = size();
  check("an ordinary character's shadow is 11 by 10", small === "11x10", small);
  z.charType = 0x47;
  const large = size();
  z.charType = 0x44;
  const large44 = size();
  z.charType = 1;
  check("...and types 0x44 and 0x47 get 50 by 30",
        large === "50x30" && large44 === "50x30", `${large} ${large44}`);
  z.motionFlags &= ~MotionFlag.Drawn;
  const noSkel = size();
  z.motionFlags |= MotionFlag.Drawn;
  z.flags |= ActorFlag.NoShadow;
  const flagged = size();
  check("...and none while the skeleton is not drawn or 0x80000 is up",
        noSkel === "none" && flagged === "none", `${noSkel} ${flagged}`);

  // `DrawCharacterPartSlot`'s alpha arms, from its jump table at 0x00419DCC:
  // types 9, 0x12, 0x17 and 0x18, and no others.
  check("the parts drawn at `obj+0x138C` are types 9, 0x12, 0x17 and 0x18",
        PART_ALPHA_CHAR_TYPES.join() === [9, 0x12, 0x17, 0x18].join());

  // `SkeletonEmitNode` (`FUN_004114C0`): a node's hook runs only with a slot,
  // the skeleton drawn and no veto -- and in the skeleton's own order.
  const walked: string[] = [];
  const hook = (_o: Actor, bone: number, slot: number) => {
    walked.push(`${bone}:${slot.toString(16)}`);
  };
  z.boneSlot["1"] = 0x77;
  RemoveBoneSubtree(z, 4);
  ActorRunNodeDrawHooks(z, hook, DRAW_FRAME);
  check("the walk hands each drawn node its current slot, in skeleton order",
        walked.join() === "1:77,2:30", walked.join());
  z.motionFlags &= ~MotionFlag.Drawn;
  walked.length = 0;
  ActorRunNodeDrawHooks(z, hook, DRAW_FRAME);
  check("...and no node at all while `obj+0x1F8` bit 0 is down",
        walked.length === 0, walked.join());
}

console.log("the ground shadow every skinned draw ends with:");
{
  // `DrawSkinnedModelAndShadow` (`FUN_00411090`) ends in `ActorDrawShadow`
  // on `g_cur_actor`, which `EnemyZombieUpdate` points at itself first; the
  // disc is slot 0x10D0 in draw layer 0xD, on the floor traced from three
  // above (a class-0x30 actor carries `MotionFlag.TraceGround`), lifted 0.1,
  // eleven across and ten deep. Driven from the reset, through the frame.
  const rng = new Rng(21);
  const events = scene(0, rng);
  const prevColi = T.coli;
  const prevSet = G.g_coli_full_set;
  T.coli = { files: ["test"], blobs: { floor: FLOOR_BLOB } };
  G.g_coli_full_set = ["floor"];
  const z = spawnZombie(0x3098, 1, "shadowed");
  z.visible = true;
  z.pos = vec3(12, 0, 40);
  run(1, rng, events);
  const discs = G.g_world_slot_draws.filter((d) => d.slot === GROUND_SHADOW_SLOT);
  const d = shadowsUnder(z)[0];
  const lift = Math.fround(0 + 0.10000000149011612);
  check("a zombie's frame draws one ground shadow, in layer 0xD",
        discs.length === 1 && d !== undefined
        && d.layer === GROUND_SHADOW_LAYER,
        `${discs.length} discs, ${JSON.stringify(discs.map((x) => x.m.slice(12, 15)))}`
        + ` zombie at ${JSON.stringify(z.pos)}`);
  check("...on the floor under it, lifted 0.1, 11 across and 10 deep",
        d !== undefined && d.m[13] === lift && d.m[0] === 11 && d.m[10] === 10
        && d.m[5] === 1,
        d ? `y ${d.m[13]} scale ${d.m[0]} ${d.m[5]} ${d.m[10]}` : "none");
  // The same frame with the shadow's bit up draws none -- the gate, read in
  // the draw and not by the test.
  z.flags |= ActorFlag.NoShadow;
  run(1, rng, events);
  check("...and none on a frame the actor carries 0x80000",
        !G.g_world_slot_draws.some((x) => x.slot === GROUND_SHADOW_SLOT));
  z.flags &= ~ActorFlag.NoShadow;
  T.coli = prevColi;
  G.g_coli_full_set = prevSet;

  // **A rider's shadow is drawn under its carrier's push.** The port's
  // stand-in for `CivilianUpdateOnCarrier`'s and `CarriedZombieUpdate18`'s
  // `T Rx Rz Ry` is `carrierAt`, and the disc has to land where the rider
  // itself is drawn: `CarrierTransformPoint` of the disc's own local point.
  // A quarter turn, so a missing or transposed carrier cannot pass (L48).
  const boat = spawnZombie(0x30a0, 1, "carrier");
  boat.pos = vec3(100, 7, -50);
  boat.yaw = 0x4000;
  boat.flags |= ActorFlag.NoShadow;
  const rider = spawnZombie(0x30a8, 1, "rider");
  rider.motionFlags &= ~MotionFlag.TraceGround;
  rider.pos = vec3(3, 2, 9);
  rider.carrierAt = boat.at;
  G.g_world_slot_draws = [];
  G.g_cur_actor = rider.at;
  DrawSkinnedModelAndShadow(rider);
  const want = vec3();
  CarrierTransformPoint(boat, 3, Math.fround(2 + 0.10000000149011612), 9, want);
  const r = G.g_world_slot_draws.find((x) => x.slot === GROUND_SHADOW_SLOT);
  check("a rider's disc is drawn in its carrier's frame, under the rider",
        r !== undefined && Math.abs(r.m[12] - want.x) < 1e-4
        && Math.abs(r.m[13] - want.y) < 1e-4
        && Math.abs(r.m[14] - want.z) < 1e-4
        && Math.abs(r.m[12] - 3) > 1,
        r ? `${r.m.slice(12, 15)} vs ${JSON.stringify(want)}` : "none");
  // ...and the shadow is `g_cur_actor`'s, not the model's owner's.
  G.g_world_slot_draws = [];
  G.g_cur_actor = z.at;
  DrawSkinnedModelAndShadow(rider);
  check("...and the disc is g_cur_actor's, whichever model is drawn",
        shadowsUnder(z).length === 1
        && !G.g_world_slot_draws.some((x) => x.m[12] === r?.m[12]));
  G.g_cur_actor = -1;
}

console.log("class 0x31, the hand grows back in the draw:");
{
  // Bones 5 and 8 are the two hands `ThrowerStateRestoreBothHands` swaps.
  const ZS: CharacterType = {
    ...TYPE31_ZSLMAN,
    bones: [
      ...TYPE31_ZSLMAN.bones,
      { bone: 8, part: "l_forearm", slot: 8, offset: [0, 0, 0], parent: null,
        damage_rank: [], hit_radius: 2, steps: [] },
    ],
    // The ground stance's idle, `0x208`, which sub 0 blends to and sub 2
    // waits out.
    motions: { ...TYPE31_ZSLMAN.motions, "520": motion(40) },
  };
  const tables = {
    ...CHARS31, types: { ...CHARS31.types, "24": ZS },
  } as unknown as CharactersJson;
  const zslman = (at: number): ThrowerActor => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(tables);
    const a = ActorSpawn(at, SpawnClass.Thrower, 0x18, "zslman");
    if (a.cls !== SpawnClass.Thrower) throw new Error("not class 0x31");
    a.visible = true;
    a.state = ThrowerState.RestoreBothHands;
    a.sub = 0;
    return a;
  };
  // One frame of `EnemyThrowerUpdate`'s order: the state, then
  // `ThrowerAdvanceMotion`'s walk with `ThrowerDrawBonePart` on each node.
  const frame = (a: ThrowerActor) => {
    ThrowerStateRestoreBothHands(a, 0, NULL_HOST);
    ActorRunNodeDrawHooks(a, ThrowerDrawBonePart, DRAW_FRAME);
  };

  // One bare hand: one regrowing node a frame. Forty f32 additions of 0.025f
  // come to 0.99999958, so it is the forty-first that drops the latch -- and
  // the state sees that on the frame after.
  const one = zslman(0x9300);
  one.boneSlot["5"] = 0x1ff1;
  for (let i = 0; i < 40; i++) frame(one);
  check("the state holds off the stagger while it waits, as sub 0 raises",
        (one.flags & ActorFlag.NoHitReaction) !== 0 && one.motion === 0x208,
        `flags ${one.flags.toString(16)} motion ${one.motion}`);
  check("forty drawn frames are not enough: the latch is still up",
        (one.flags2 & ThrowerFlag.Regrowing) !== 0
        && one.thr.handRegrow < REGROW_FULL
        && one.thr.handRegrow === Math.fround(0.9999995827674866),
        `regrow ${one.thr.handRegrow}`);
  frame(one);
  check("...the forty-first drops it, pinned at 1.0, in the draw",
        (one.flags2 & ThrowerFlag.Regrowing) === 0
        && one.thr.handRegrow === REGROW_FULL
        && one.boneSlot["5"] === 0x1ff1,
        `regrow ${one.thr.handRegrow} slot ${one.boneSlot["5"]}`);
  frame(one);
  check("...and the state puts the weapon back on the next frame",
        one.boneSlot["5"] === 0x1ff3 && one.sub === 2,
        `slot ${one.boneSlot["5"]} sub ${one.sub}`);
  one.playTicks = ActorClipLength(one, one.motion) - 1;
  frame(one);
  check("...and leaves for the hub on the idle's last frame, stagger allowed",
        one.state === ThrowerState.StandAndDecide
        && (one.flags & ActorFlag.NoHitReaction) === 0,
        `state ${one.state} flags ${one.flags.toString(16)}`);

  // Both bare: the hook runs once per node, so two regrowing nodes a frame.
  const two = zslman(0x9310);
  two.boneSlot["5"] = 0x1ff1;
  two.boneSlot["8"] = 0x1fed;
  for (let i = 0; i < 21; i++) frame(two);
  const early = (two.flags2 & ThrowerFlag.Regrowing) === 0;
  frame(two);
  check("both hands bare grow twice as fast: 21 frames, and both come back",
        early && two.boneSlot["5"] === 0x1ff3 && two.boneSlot["8"] === 0x1fef,
        `early ${early} slots ${two.boneSlot["5"]}/${two.boneSlot["8"]}`);

  // A skeleton that is not drawn does not grow.
  const hidden = zslman(0x9320);
  hidden.boneSlot["5"] = 0x1ff1;
  hidden.motionFlags &= ~MotionFlag.Drawn;
  for (let i = 0; i < 60; i++) frame(hidden);
  check("...and a thrower whose skeleton is not drawn does not re-arm at all",
        hidden.thr.handRegrow === 0
        && (hidden.flags2 & ThrowerFlag.Regrowing) !== 0,
        `regrow ${hidden.thr.handRegrow}`);

  // What the hook drew each bone at, for the renderer. `zslman` goes through
  // `ThrowerDrawPartAlphaIfBlinking`: the alpha under bit 2, solid without.
  const blink = zslman(0x9330);
  blink.state = ThrowerState.StandAndDecide;
  blink.flags2 |= ThrowerFlag.Blinking;
  blink.alpha = 0;
  ActorRunNodeDrawHooks(blink, ThrowerDrawBonePart, DRAW_FRAME);
  const at0 = [4, 5, 1, 2, 8].map((b) => blink.nodeDrawAlpha[b]).join();
  blink.flags2 &= ~ThrowerFlag.Blinking;
  blink.alpha = 1;
  ActorRunNodeDrawHooks(blink, ThrowerDrawBonePart, DRAW_FRAME);
  const plain = [4, 5, 1, 2, 8].map((b) => blink.nodeDrawAlpha[b]);
  check("a blinking zslman's bones are drawn faded at its alpha, 0 included",
        at0 === "0,0,0,0,0", at0);
  check("...and without bit 2 plainly -- `null`, not a faded draw at 1",
        plain.every((x) => x === null), plain.join());
  blink.flags2 |= ThrowerFlag.Blinking;
  ActorRunNodeDrawHooks(blink, ThrowerDrawBonePart, DRAW_FRAME);
  check("...while at alpha 1 under bit 2 it is still the faded draw",
        [4, 5, 1, 2, 8].every((b) => blink.nodeDrawAlpha[b] === 1),
        [4, 5, 1, 2, 8].map((b) => blink.nodeDrawAlpha[b]).join());

  // Every other type: solid while `obj+0x34` has 0x4000000, whatever bit 2.
  SetGameTables(CHARS31);
  const tin = ActorSpawn(0x9340, SpawnClass.Thrower, 0x19, "zstin");
  if (tin.cls !== SpawnClass.Thrower) throw new Error("not class 0x31");
  tin.flags2 |= ThrowerFlag.Blinking;
  tin.alpha = 0;
  ActorRunNodeDrawHooks(tin, ThrowerDrawBonePart, DRAW_FRAME);
  const live = tin.nodeDrawAlpha[1];
  tin.flags |= ActorFlag.Dead;
  ActorRunNodeDrawHooks(tin, ThrowerDrawBonePart, DRAW_FRAME);
  check("...another type blinks too, but a dead one is drawn plainly",
        live === 0 && tin.nodeDrawAlpha[1] === null,
        `${live} then ${tin.nodeDrawAlpha[1]}`);
  // And `0x1FB9` writes the alpha, so every node after it in the walk draws
  // at the ramp: bone 4 is the first root.
  tin.flags &= ~ActorFlag.Dead;
  tin.boneSlot["4"] = 0x1fb9;
  G.g_blink_frame_counter = 90;
  ActorRunNodeDrawHooks(tin, ThrowerDrawBonePart, DRAW_FRAME);
  check("...and the 0x1FB9 node writes a 120-frame ramp into `obj+0x138C`",
        Math.abs(tin.alpha - 0.5) < 1e-6
        && Math.abs((tin.nodeDrawAlpha[2] ?? -1) - 0.5) < 1e-6,
        `alpha ${tin.alpha} bone 2 ${tin.nodeDrawAlpha[2]}`);
  // The triangle itself: up over sixty frames and back down over sixty, and
  // the node that writes it is drawn at it. Without bit 2 the same node is
  // drawn plainly and writes nothing.
  const ramp = [0, 30, 59, 60, 61, 119, 120].map((n) => {
    G.g_blink_frame_counter = n;
    ActorRunNodeDrawHooks(tin, ThrowerDrawBonePart, DRAW_FRAME);
    return Math.round((tin.nodeDrawAlpha[4] ?? -1) * 1000) / 1000;
  });
  check("...0, rising 1/60 a frame to 1 at 60 and falling back by 119",
        ramp.join() === "0,0.5,0.983,1,0.983,0.017,0", ramp.join());
  tin.flags2 &= ~ThrowerFlag.Blinking;
  tin.alpha = 0.25;
  G.g_blink_frame_counter = 30;
  ActorRunNodeDrawHooks(tin, ThrowerDrawBonePart, DRAW_FRAME);
  check("...and without bit 2 the 0x1FB9 node is drawn plainly, alpha left",
        tin.nodeDrawAlpha[4] === null && tin.alpha === 0.25,
        `${tin.nodeDrawAlpha[4]} ${tin.alpha}`);

  // `ThrowerStateCorpseBlink`'s way out: alpha 0 and bit 2 down.
  const corpse = zslman(0x9350);
  corpse.state = ThrowerState.CorpseBlink;
  corpse.sub = 0;
  const rng = new Rng(15);
  for (let i = 0; i < 200 && !corpse.despawned; i++) {
    ThrowerStateCorpseBlink(corpse, 1 / 60, rng);
  }
  check("the zslman corpse leaves with `obj+0x138C` at 0 and bit 2 down",
        corpse.despawned && corpse.alpha === 0
        && (corpse.flags2 & ThrowerFlag.Blinking) === 0,
        `alpha ${corpse.alpha} flags2 ${corpse.flags2.toString(16)}`);
}

console.log("\nclass 0x30's two fades: `znele` in, the twin out");
// `EnemyZombieInitByCharType` (`FUN_00452FD0`) sets them up, and
// `ZombieDrawBonePart` (`FUN_004534A0`)'s `0x1C6C` and `0x1C7C` arms run
// their clocks, one step per draw of the node; every node is drawn through
// `ZombieSubmitSlotByLighting` (`FUN_00453AE0`). The renderer used to draw
// all of it solid.
{
  ResetGameGlobals();
  EnterPlay();
  const withBone1Slot = (type: number, slot: number): CharacterType => ({
    ...TYPE, type,
    bones: TYPE.bones.map((b) => (b.bone === 1 ? { ...b, slot } : b)),
  });
  SetGameTables({
    ...CHARS,
    types: { ...CHARS.types, "18": withBone1Slot(0x12, 0x1c6c),
             "9": withBone1Slot(9, 0x1c7c) },
  } as unknown as CharactersJson);
  const events = new Events();
  const sounds: number[] = [];
  events.on("sound.play", (e) => sounds.push(e.id));
  const f: ClassFrame = { ...DRAW_FRAME, events };
  const pushes = ZombieFlag2.CollideWorld | ZombieFlag2.CollideActors;
  const draw = (z: ZombieActor, n = 1): void => {
    for (let i = 0; i < n; i++) ActorRunNodeDrawHooks(z, ZombieDrawBonePart, f);
  };
  const nodes = (z: ZombieActor): (number | null)[] =>
    [4, 5, 1, 2].map((b) => z.nodeDrawAlpha[b] ?? null);

  const znele = spawnZombie(0x9400, 0x12, "znele",
                            { initialState: ZombieState.HoldClipThenBranch });
  check("`znele` is born at alpha 0, faded, with a hundred-draw wait",
        znele.alpha === 0 && (znele.zom.flags1368 & Zombie1368Flag.FadeDraw) !== 0 && znele.zom.fadeDelay === 100
        && znele.zom.fadeStep === Math.fround(1 / 30),
        `${znele.alpha} ${znele.zom.flags1368} ${znele.zom.fadeDelay}`);
  check("...out of both pushes, and shot-immune, untestable, unaimed",
        (znele.flags2 & pushes) === 0
        && (znele.flags & 0x48500) === 0x48500,
        `${znele.flags2.toString(16)} ${znele.flags.toString(16)}`);
  draw(znele);
  check("...and every node is drawn: the faded draw at 0, not hidden",
        nodes(znele).every((x) => x === 0), nodes(znele).join());
  draw(znele, 99);
  check("a hundred draws of 0x1C6C hold it at 0", znele.alpha === 0
        && znele.zom.fadeDelay === 0, `${znele.alpha} ${znele.zom.fadeDelay}`);
  // The fixture walks bones 4 and 5 before bone 1, the fade node: the hook
  // moves the alpha as it draws that node, so the nodes before it in the
  // walk were drawn at the old one. The shipped skeletons put bone 1 first.
  draw(znele);
  check("...the hundred-and-first steps it 1/30: the fade node and the nodes "
        + "after it at that, the two before it still at 0",
        znele.alpha === Math.fround(1 / 30)
        && nodes(znele).join() === `0,0,${znele.alpha},${znele.alpha}`,
        nodes(znele).join());
  draw(znele, 28);
  const before = sounds.length;
  check("...twenty-nine steps are still under 1, still faded",
        (znele.zom.flags1368 & Zombie1368Flag.FadeDraw) !== 0 && znele.alpha < 1 && before === 0,
        `${znele.alpha}`);
  const last = znele.alpha;
  draw(znele);
  check("the thirtieth passes 1.0 and ends it: pinned at 1, and the fade "
        + "node on is drawn plainly (the two before it at the 29th step)",
        !(znele.zom.flags1368 & Zombie1368Flag.FadeDraw) && znele.alpha === 1
        && nodes(znele).join() === `${last},${last},,`, nodes(znele).join());
  check("...pushes back, shot test and immunity lowered, head aim still off",
        (znele.flags2 & pushes) === pushes
        && (znele.flags & (ActorFlag.NoShotTest | ActorFlag.ShotImmune)) === 0
        && (znele.flags & ActorFlag.NoHeadAim) !== 0,
        `${znele.flags2.toString(16)} ${znele.flags.toString(16)}`);
  check("...and `PlaySoundId(0x2225A9)`, once",
        sounds.filter((s) => s === 0x2225a9).length === 1, sounds.join());
  draw(znele, 10);
  check("...after which the node holds nothing and draws plainly",
        znele.alpha === 1 && nodes(znele).every((x) => x === null)
        && sounds.filter((s) => s === 0x2225a9).length === 1);

  // `obj+0x34` bit 0x10000000 ends it on the first draw: two stage-6 `znele`
  // carry it in their descriptor, and those are the two with no twin.
  const quick = spawnZombie(0x9408, 0x12, "znele",
                            { initialState: ZombieState.HoldClipThenBranch,
                              flags: ActorFlag.Committed });
  draw(quick);
  check("a `znele` with `obj+0x34` 0x10000000 is done on its first draw",
        !(quick.zom.flags1368 & Zombie1368Flag.FadeDraw) && quick.alpha === 1
        && nodes(quick).join() === "0,0,,", nodes(quick).join());

  const twin = spawnZombie(0x9410, 9, "twin");
  check("the twin is born at a quarter alpha, faded, stepping 1/60",
        twin.alpha === 0.25 && (twin.zom.flags1368 & Zombie1368Flag.FadeDraw) !== 0
        && twin.zom.fadeStep === Math.fround(1 / 60)
        && (twin.flags2 & pushes) === 0, `${twin.alpha}`);
  draw(twin, 100);
  check("...holds it for a hundred draws of 0x1C7C, drawn at it",
        twin.alpha === 0.25 && nodes(twin).every((x) => x === 0.25),
        nodes(twin).join());
  draw(twin, 15);
  check("...fifteen steps leave it just above 0 in f32",
        twin.alpha > 0 && twin.alpha < 1e-6, `${twin.alpha}`);
  const tail = twin.alpha;
  draw(twin);
  check("...and the sixteenth clamps it to 0, still the faded draw",
        twin.alpha === 0 && nodes(twin).join() === `${tail},${tail},0,0`,
        nodes(twin).join());

  // The light array wins: `obj+0x136C` bit 0x20 under `g_scene_lighting`
  // takes the draw before the fade bit is looked at.
  const lit = spawnZombie(0x9418, 9, "twin");
  lit.flags2 |= ZombieFlag2.DrawVariantSource;
  G.g_scene_lighting = 1;
  draw(lit);
  check("a lit zombie's nodes are drawn solid through the light array",
        nodes(lit).every((x) => x === null) && (lit.zom.flags1368 & Zombie1368Flag.FadeDraw) !== 0,
        nodes(lit).join());
  G.g_scene_lighting = 0;
  draw(lit);
  check("...and faded again once the scene light goes off",
        nodes(lit).every((x) => x === 0.25), nodes(lit).join());

  // The twin itself. `EnemyZombieInitByCharType`'s type-0x12 arm allocates it
  // (0x00453204) unless `obj+0x34` has 0x10000000, and `EnemyZombieInit`
  // gives type 9 `ZombieTwinFollowHost` (`FUN_00453290`) for its update.
  const twinOf = (hostAt: number) =>
    G.g_object_list.find((o) => o.at === ZombieTwinAt(hostAt));
  const made = twinOf(znele.at);
  check("every `znele` without 0x10000000 allocates a type-9 twin beside it",
        made !== undefined && made.cls === SpawnClass.Zombie
        && made.charType === 9 && made.zom.twinHost === znele.at
        && made.visible,
        made ? `${made.at.toString(16)} ${made.charType}` : "none");
  check("...one with the bit allocates none",
        twinOf(quick.at) === undefined);
  // The exporter writes the twin's synthetic row at its own copy of the
  // address; nothing else holds the two together.
  const { zombieTwinAt } = await import("../../src/hod2lib/characters");
  check("the port's twin address is the one the exporter's row carries",
        [0x874, 0x2164, 0x9400, 0xfffff].every(
          (a) => ZombieTwinAt(a) === zombieTwinAt(a)));
  const aliveBefore = G.g_enemies_alive;
  const host = spawnZombie(0x9420, 0x12, "znele",
                           { initialState: ZombieState.HoldClipThenBranch });
  const tw = twinOf(host.at);
  if (!tw || tw.cls !== SpawnClass.Zombie) throw new Error("no twin");
  check("...counted into neither enemy count: the host is, once",
        G.g_enemies_alive === aliveBefore + 1, `${G.g_enemies_alive}`);
  check("...with the minimum hit points: `ActorInitHitPoints` clamps the "
        + "cleared `obj+0x11E`, and the 999 is written over",
        tw.hp === ActorInitHitPoints({ hp: 0 } as never, SpawnClass.Zombie)
        && tw.hp < 999, `${tw.hp}`);
  // Move the host and put it on another clip; the twin's update takes both.
  host.pos.x = 12;
  host.yaw = 0x2000;
  host.motion = 956;
  host.playTicks = 37;
  const handler = g_class_handlers[SpawnClass.Zombie]!;
  handler.update(tw, f);
  check("the twin's update takes the host's transform and clip each frame",
        tw.pos.x === 12 && tw.yaw === 0x2000 && tw.motion === 956
        && tw.playTicks === 37,
        `${tw.pos.x} ${tw.yaw} ${tw.motion} ${tw.playTicks}`);
  check("...never turns its head (0x40000 every frame)",
        (tw.flags & ActorFlag.NoHeadAim) !== 0);
  check("...and runs its own 0x1C7C node's clock in the draw",
        tw.zom.fadeDelay === 99 && tw.alpha === 0.25);
  // A host with 0x10000000 is not followed.
  host.flags |= ActorFlag.Committed;
  host.pos.x = 30;
  handler.update(tw, f);
  check("...but not while the host has 0x10000000",
        tw.pos.x === 12, `${tw.pos.x}`);
  host.flags &= ~ActorFlag.Committed;
  // Its alpha at 0 is the end of it: `TEST AH, 0x41` takes "equal".
  for (let i = 0; i < 200 && !tw.despawned; i++) handler.update(tw, f);
  check("the twin despawns the update after its alpha reaches 0",
        tw.despawned && tw.alpha === 0 && tw.zom.fadeDelay < -15,
        `${tw.despawned} ${tw.alpha} ${tw.zom.fadeDelay}`);
  // ...and when its host dies.
  const host2 = spawnZombie(0x9430, 0x12, "znele",
                            { initialState: ZombieState.HoldClipThenBranch });
  const twin2 = twinOf(host2.at);
  if (!twin2) throw new Error("no twin");
  host2.flags |= ActorFlag.Dead;
  handler.update(twin2, f);
  check("...and when its host has died", twin2.despawned);
}

console.log("class 0x30, `ZombieOnShot`'s two refusals and its second death:");
{
  const rng = new Rng(13);
  scene(0, rng);

  // `TEST CH, 0x40` at 0x00453F88: a zombie shot in mid-leap keeps flying.
  const leaper = spawnZombie(0x3100, 1, "leaper");
  leaper.visible = true;
  leaper.state = ZombieState.DelayedLeap;
  leaper.flags2 |= ZombieFlag2.Leaping;
  leaper.dead = true;
  leaper.flags |= ActorFlag.Dead;
  leaper.pendingHit = { bone: 1, result: 1 };
  ZombieOnShot(leaper);
  check("a zombie shot mid-leap is not sent to a death state",
        leaper.state === ZombieState.DelayedLeap, `state ${leaper.state}`);
  check("...but the death is latched, so the next shot cannot re-enter",
        (leaper.flags2 & ZombieFlag2.DiedInFlight) !== 0,
        leaper.flags2.toString(16));

  // The once-only latch. A burst must not knock a corpse back to sub 0.
  const z = spawnZombie(0x3200, 1, "shot twice");
  z.visible = true;
  z.dead = true;
  z.flags |= ActorFlag.Dead;
  z.pendingHit = { bone: 1, result: 1 };
  ZombieOnShot(z);
  check("a killed zombie enters state 6", z.state === ZombieState.Death);
  z.sub = 2;
  z.pendingHit = { bone: 1, result: 1 };
  ZombieOnShot(z);
  check("...and a second shot does not restart it", z.sub === 2, `sub ${z.sub}`);

  // The carried arm. What is pinned here is the *near-target latch*, which is
  // state 9's own input and is `[proved]` at 0x00454006; where the arm leads
  // is the next block's.
  const carried = spawnZombie(0x3300, 1, "carried");
  carried.visible = true;
  carried.dead = true;
  carried.flags |= ActorFlag.Dead;
  carried.flags2 |= ZombieFlag2.Carried;
  carried.state = 0x1b;
  carried.pos = vec3(0, 0, 0);
  carried.arcTo = { x: 10, y: 0, z: 0 };
  carried.pendingHit = { bone: 1, result: 1 };
  ZombieOnShot(carried);
  check("a carried zombie shot within 18.0 of its arc target latches bit 0x8",
        (carried.flags2 & ZombieFlag2.ShotNearArcTarget) !== 0,
        carried.flags2.toString(16));

  const far = spawnZombie(0x3400, 1, "carried, far");
  far.visible = true;
  far.dead = true;
  far.flags |= ActorFlag.Dead;
  far.flags2 |= ZombieFlag2.Carried;
  far.state = 0x1b;
  far.pos = vec3(0, 0, 0);
  far.arcTo = { x: 30, y: 0, z: 0 };
  far.pendingHit = { bone: 1, result: 1 };
  ZombieOnShot(far);
  check("...and one further away than that does not",
        (far.flags2 & ZombieFlag2.ShotNearArcTarget) === 0,
        far.flags2.toString(16));
}

console.log("class 0x30, `ZombieOnShot`: a zombie that has been shot runs:");
{
  // The head of the per-player loop, before the latch and before the test for
  // dead -- `ShotImmune` is the only thing ahead of it:
  //
  //   00453f14  80e6fb          AND DH, 0xfb          ; obj+0x136C &= ~0x400
  //   00453f17  81c900000008    OR  ECX, 0x8000000    ; obj+0x34 |= 0x8000000
  //   00453f24  89966c130000    MOV [ESI+0x136c], EDX
  //   00453f2a  894e34          MOV [ESI+0x34], ECX
  //
  // `0x8000000` is the bit `ZombieStateAttackRun` (`FUN_004554D0`) takes the
  // second of its run pair with, and turns 2.5 times as fast on.
  const rng = new Rng(17);
  scene(0, rng);
  const row = [900, 901, 902, 903, 904];

  // Alive, off a spawn record that did not ask to sprint.
  const walker = spawnZombie(0x3600, 1, "walker");
  walker.visible = true;
  walker.hp = 100;
  walker.flags &= ~ZOMBIE_SPRINTS;
  walker.flags2 |= ZombieFlag2.EntryClipPlaying;
  const jog = ZombieRunMotion(walker, row);
  const turn = ZombieRunTurnRate(walker);
  walker.pendingHit = { bone: 4, result: HitResultCode.Plain, player: 0 };
  ZombieOnShot(walker);
  check("a zombie shot and not killed is made to sprint",
        (walker.flags & ZOMBIE_SPRINTS) !== 0 && !walker.dead,
        `flags 0x${(walker.flags >>> 0).toString(16)}`);
  check("...so its run is the second of the pair, and turns 0x410 a frame",
        jog === 902 && ZombieRunMotion(walker, row) === 903
        && turn === 0x1a0 && ZombieRunTurnRate(walker) === 0x410,
        `${jog}->${ZombieRunMotion(walker, row)}, `
        + `${turn}->${ZombieRunTurnRate(walker)}`);
  check("...and its entrance-clip exemption is over",
        (walker.flags2 & ZombieFlag2.EntryClipPlaying) === 0,
        walker.flags2.toString(16));

  // Shot-immune: `TEST AH, 0x1` at 0x00453EC7 jumps past the whole loop.
  const immune = spawnZombie(0x3700, 1, "immune");
  immune.visible = true;
  immune.flags = (immune.flags & ~ZOMBIE_SPRINTS) | ActorFlag.ShotImmune;
  immune.flags2 |= ZombieFlag2.EntryClipPlaying;
  immune.pendingHit = { bone: 4, result: HitResultCode.Plain, player: 0 };
  ZombieOnShot(immune);
  check("a shot-immune zombie takes neither write",
        (immune.flags & ZOMBIE_SPRINTS) === 0
        && (immune.flags2 & ZombieFlag2.EntryClipPlaying) !== 0,
        `flags 0x${(immune.flags >>> 0).toString(16)} `
        + `flags2 0x${immune.flags2.toString(16)}`);

  // A corpse whose death is already latched still takes both, and nothing
  // else: the latch test is after them, and before both arms.
  const corpse = spawnZombie(0x3800, 1, "corpse");
  corpse.visible = true;
  corpse.dead = true;
  corpse.flags = (corpse.flags & ~ZOMBIE_SPRINTS) | ActorFlag.Dead;
  corpse.flags2 |= ZombieFlag2.DiedInFlight | ZombieFlag2.EntryClipPlaying;
  corpse.state = ZombieState.Death;
  corpse.sub = 3;
  corpse.pendingHit = { bone: 2, result: HitResultCode.Plain, player: 0 };
  ZombieOnShot(corpse);
  check("a latched corpse is still marked -- the loop head runs before the "
        + "latch", (corpse.flags & ZOMBIE_SPRINTS) !== 0
        && (corpse.flags2 & ZombieFlag2.EntryClipPlaying) === 0,
        `flags 0x${(corpse.flags >>> 0).toString(16)}`);
  check("...and nothing else happens to it", corpse.state === ZombieState.Death
        && corpse.sub === 3, `state ${corpse.state}.${corpse.sub}`);

  // No shot, no write: the routine is gated on the hit record.
  const idle = spawnZombie(0x3900, 1, "idle");
  idle.flags &= ~ZOMBIE_SPRINTS;
  ZombieOnShot(idle);
  check("...and a zombie nobody shot is left jogging",
        (idle.flags & ZOMBIE_SPRINTS) === 0);
}

console.log("class 0x30 state 9: the body is thrown, not dropped:");
{
  // A camera at (0, 6, 0) looking down world +Z, in the engine's own view
  // convention: **-Z in front**, +Y up, and `viewPoint` its exact inverse.
  // `app/systems.ts` builds the real pair out of three.js's camera; this is
  // the smallest thing that is consistent with itself, which is all state 9
  // asks of the seam.
  const CAM = vec3(0, 6, 0);
  const camHost = {
    ...NULL_HOST,
    viewSpaceOf: (at: number, out: Vec3) => {
      const a = ActorByAt(at);
      if (!a) return false;
      out.x = a.lookAt.x - CAM.x;
      out.y = a.lookAt.y - CAM.y;
      out.z = -(a.lookAt.z - CAM.z);
      return true;
    },
    viewPoint: (x: number, y: number, z: number, out: Vec3) => {
      out.x = CAM.x + x;
      out.y = CAM.y + y;
      out.z = CAM.z - z;
    },
  };

  const shot = (condition: number) => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    G.g_camera_fixed_eye_y = 0;
    const z = spawnZombie(0x3600, 1, "knocked back",
                         { condition });
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.motion = 10;
    z.pos = vec3(0, 0, 40);
    z.lookAt = vec3(0, 4, 40);
    return z;
  };
  const kill = (z: Actor) => {
    z.hp = 0;
    z.dead = true;
    z.flags |= ActorFlag.Dead;
    z.pendingHit = { bone: 1, result: 1 };
  };

  // 1. **The state.** `ZombieOnShot` (`FUN_00453EB0`) writes 9, not 6, for
  //    body conditions 5 and 6 — 44 shipped spawns carry one of them.
  {
    const rng = new Rng(21);
    const events = new Events();
    const z = shot(5);
    TryClaimAttackSlot(z, new Rng(1), camHost);
    kill(z);
    GameUpdate(1 / 60, camHost, rng, events);
    check("body condition 5 dies through state 9, not state 6",
          z.state === ZombieState.DeathKnockbackArc, `state ${z.state}`);
    check("...and takes the same clip `ChooseDeathMotion` gives state 6",
          z.motion === 0x3db, `motion ${z.motion}`);
    // Sub 0 runs `ZombieReleasePermitAndUntrack` on the frame the state opens,
    // exactly as state 6's does, and the present count waits for the corpse.
    check("...giving the permit back and leaving `alive` on the same frame",
          z.attackPermit === -1 && G.g_attack_permits.every((p) => p === -1)
          && G.g_enemies_alive === 0, `alive ${G.g_enemies_alive}`);
    check("...but staying *present* until the corpse state",
          G.g_enemies_present === 1, `present ${G.g_enemies_present}`);
  }

  // 2. **The throw.** Sub 1 rides the shared arc record — `ActorArcVelocityY`
  //    (`FUN_0044DDE0`) sets the velocity, `EnemyZombieUpdate` integrates it —
  //    to a landing point built in the camera's own matrix. The body must end
  //    up somewhere else.
  {
    const rng = new Rng(22);
    const events = new Events();
    const z = shot(5);
    kill(z);
    let far = 0;
    for (let f = 0; f < 60; f++) {
      GameUpdate(1 / 60, camHost, rng, events);
      far = Math.max(far, dist2d(z.pos, vec3(0, 0, 40)));
      if (z.state !== ZombieState.DeathKnockbackArc) break;
    }
    // Condition 5's depth offset is -7.0 at scale 1.0, so the landing point is
    // seven units further from the camera than the body's tracked point.
    check("the arc carries the body away from where it stood", far > 5,
          `moved ${far.toFixed(2)} units`);
    check("...along the camera's own -Z, which is away from the viewer",
          z.pos.z > 44, `z ${z.pos.z.toFixed(2)}`);
    check("...and it is the shared arc record that carried it",
          z.arcTotal >= 0 && Math.abs(z.arcTo.z - 47) < 2.5,
          `arcTo.z ${z.arcTo.z.toFixed(2)}`);
  }

  // 3. **The terminus.** Same corpse, same order: `alive` at the state's own
  //    opening, `present` at `ZombieEnterCorpseState`, then the pool.
  {
    const rng = new Rng(23);
    const events = new Events();
    const z = shot(6);
    kill(z);
    let sawCorpse = -1, presentAtCorpse = -1, sawArc = false, restedAt = 0;
    for (let f = 0; f < 900; f++) {
      GameUpdate(1 / 60, camHost, rng, events);
      if (z.state === ZombieState.DeathKnockbackArc) sawArc = true;
      if (sawCorpse < 0 && (z.state === ZombieState.CorpseSink
                         || z.state === ZombieState.CorpseBlink)) {
        sawCorpse = f;
        presentAtCorpse = G.g_enemies_present;
        restedAt = dist2d(z.pos, vec3(0, 0, 40));
      }
    }
    check("condition 6 reaches the corpse state through the arc",
          sawArc && sawCorpse > 0,
          `arc ${sawArc} state ${z.state} sub ${z.sub}`);
    check("...and the corpse lies where it was thrown, not where it stood",
          restedAt > 5, `${restedAt.toFixed(2)} units from the spot`);
    check("...and `present` falls there, one clip after `alive`",
          presentAtCorpse === 0, `present ${presentAtCorpse}`);
    check("...and the corpse leaves the pool",
          !G.g_object_list.some((o) => o.at === 0x3600),
          `${G.g_object_list.length} left`);
    check("...with both counters back at zero",
          G.g_enemies_alive === 0 && G.g_enemies_present === 0,
          `${G.g_enemies_alive}/${G.g_enemies_present}`);
  }

  // The control. A condition the arc does not claim still dies where it
  // stands, which is what every one of the 44 used to do.
  {
    const rng = new Rng(24);
    const events = new Events();
    const z = shot(0);
    kill(z);
    let far = 0;
    for (let f = 0; f < 60; f++) {
      GameUpdate(1 / 60, camHost, rng, events);
      far = Math.max(far, dist2d(z.pos, vec3(0, 0, 40)));
    }
    check("an ordinary body still dies through state 6, where it stood",
          far < 1, `state ${z.state}, moved ${far.toFixed(2)}`);
  }
}

console.log("class 0x30, dying with a weapon still in hand:");
{
  const rng = new Rng(14);
  const events = scene(0, rng);
  const z = spawnZombie(0x3500, 1, "axe man");
  z.visible = true;
  z.hp = 1;
  z.pos = vec3(0, 40, 0);
  // `obj+0x34` bit 0x1000000, which a spawn record carries for a thrower that
  // starts with a weapon (`ActorInitFlags`); `ZombieStateStandAndThrow` only
  // tests it. `ChooseDeathMotion` gives it clip 0x3F9 and `ZombieStateDeath6`
  // sub 2 reads the same bit.
  z.flags |= ActorFlag.HoldingWeapon;
  z.dead = true;
  z.flags |= ActorFlag.Dead;
  z.pendingHit = { bone: 1, result: 1 };

  GameUpdate(1 / 60, NULL_HOST, rng, events);
  check("it takes clip 0x3F9, not a directional death", z.motion === 0x3f9,
        `motion ${z.motion}`);
  check("...and state 6 hands it to state 12 rather than to a corpse",
        z.state === ZombieState.DeathFallAndBounce, `state ${z.state}`);

  // Sixty ticks of the death clip, then the fall opens.
  for (let i = 0; i < 40; i++) GameUpdate(1 / 60, NULL_HOST, rng, events);
  check("state 12 holds the clip before it falls", z.sub === 1, `sub ${z.sub}`);
  const y0 = z.pos.y;
  for (let i = 0; i < 40; i++) GameUpdate(1 / 60, NULL_HOST, rng, events);
  check("...then falls under gravity", z.sub === 2 && z.pos.y < y0,
        `sub ${z.sub}, ${y0} -> ${z.pos.y}`);
  // The present count is what the scripts wait on, and state 12 is the one
  // death path that holds it past the death clip: `ReleaseEnemyPresentCount`
  // (`FUN_00456580`) runs in `ZombieEnterCorpseState` and nowhere else, so
  // every frame of the fall is a frame `wait_enemies_present` and
  // `wait_scripted_actors` cannot come down.
  check("...holding `g_enemies_present` for the whole fall",
        G.g_enemies_present === 1, `present ${G.g_enemies_present}`);
  for (let i = 0; i < 400; i++) {
    GameUpdate(1 / 60, NULL_HOST, rng, events);
    if (z.state === ZombieState.CorpseSink) break;
  }
  check("...and settles into the corpse", z.state === ZombieState.CorpseSink,
        `state ${z.state} sub ${z.sub} y ${z.pos.y}`);
  check("...which is where it gives the present count back",
        G.g_enemies_present === 0, `present ${G.g_enemies_present}`);
}

/**
 * **What state 12 costs when its clip is not in the bundle**, pinned as a test
 * rather than left as a sentence.
 *
 * The shape of it: sub 1 is
 * `if (obj+0x19C < 0x3C) return;`, an exact literal against the play clock of
 * clip `0x3F9`, and `MotionPlayFrame` answers **0** for a clip the character
 * type has not got. No character type in any of the twelve shipped bundles had
 * `0x3F9` baked, so no actor in the port could leave state 12 anywhere in the
 * game, `ZombieEnterCorpseState` never ran, and `g_enemies_present` never
 * fell. Stage 3's block 2 hung on a `wait_scripted_actors` behind a dead
 * civilian who was herself parked on `CivilianWait.EnemiesPresent`.
 *
 * The fix is in the exporter -- `CLASS30_DEATH_CLIPS`, checked over the real
 * bundles by `web/tools/checks/death_clips.ts`, because a hand-written fixture that
 * carries the clip is exactly what cannot see an exporter that does not. This
 * block is the other half: it says out loud that state 12's exit **is** the
 * clip's play clock, so a future attempt to clear the hang by short-circuiting
 * the wait, by special-casing a missing clip, or by making `MotionPlayFrame`
 * answer for a clip it has not got, fails here rather than looking like a fix.
 */
console.log("class 0x30 state 12, with no clip to wait on:");
{
  const rng = new Rng(14);
  // Same fixture, one clip poorer. Everything else is `TYPE`, so the only
  // difference between this block and the one above is the bundle.
  const noFall = { ...TYPE.motions } as Record<string, unknown>;
  delete noFall["1017"];
  const TYPE_NO_FALL = { ...TYPE, motions: noFall } as unknown as CharacterType;
  const CHARS_NO_FALL = {
    ...CHARS, types: { "1": TYPE_NO_FALL },
  } as unknown as CharactersJson;

  ResetGameGlobals();
  SetGameTables(CHARS_NO_FALL);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_scene_state_major = SCENE_MAJOR_PLAYING;
  EnterPlay();
  openShutter();
  const events = new Events();
  const z = spawnZombie(0x3520, 1, "axe man, no fall clip");
  z.visible = true;
  z.hp = 1;
  z.pos = vec3(0, 40, 0);
  z.flags |= ActorFlag.HoldingWeapon;
  z.dead = true;
  z.flags |= ActorFlag.Dead;
  z.pendingHit = { bone: 1, result: 1 };

  GameUpdate(1 / 60, NULL_HOST, rng, events);
  check("state 6 still sends it to state 12 -- the bit decides, not the clip",
        z.state === ZombieState.DeathFallAndBounce, `state ${z.state}`);
  // Ten times the sixty ticks the state is waiting for.
  for (let i = 0; i < 600; i++) GameUpdate(1 / 60, NULL_HOST, rng, events);
  check("...and with no 0x3F9 the play cursor never reaches 0x3C",
        MotionPlayFrame(z) === 0, `cursor ${MotionPlayFrame(z)}`);
  check("...so it is still in sub 1 after 600 frames",
        z.state === ZombieState.DeathFallAndBounce && z.sub === 1,
        `state ${z.state} sub ${z.sub}`);
  check("...and `g_enemies_present` is leaked for the rest of the stage",
        G.g_enemies_present === 1, `present ${G.g_enemies_present}`);
}

/**
 * **What a body throws up when it goes down**, which the port used to leave
 * out: `ZombieInstallDeathEffectCues` (`FUN_004563F0`) and
 * `ZombieDeathEffectCueTick` (`FUN_004569B0`) put dust or a splash at the
 * death clip's cue frames, `ZombieDeathLandingEffect` (`FUN_00456B70`) at a
 * landing, `SpawnWaterRing` (`FUN_004567C0`) on the wet surfaces, and
 * `SpawnGroundRingEffect` (`FUN_00407DA0`) opens a ring under the corpse.
 * Every assertion that names an effect, a sound or the shake fails on the old
 * port, which drew none of them.
 */
console.log("class 0x30, the dust, the splash and the rings a death leaves:");
{
  const SPRITES = {
    blood_scale: { "1": 0.75, "2": 0.5, "3": 1.0 },
    impact_sprite: {
      [String(SpriteEffectKind.Dust)]: [0x94, 0xa2, 0.7],
      [String(SpriteEffectKind.Splash)]: [0x1339, 0x1356, 1.0],
    },
    impact_sprite_default: [0x0904, 0x0904, 0.1],
    ricochet: {},
    impact: [], head_impact: [],
    voice: { hurt: [], kill: [], head: [],
             attack: [[{ id: 40, file: "" }], [{ id: 50, file: "" }]] },
    voice_set_a_types: [1],
  };
  const WET_BLOB = coliQuad([0, 1, 0, 0], 1,
                            [-200, 0, 200, 200, 0, 200, 200, 0, -200,
                             -200, 0, -200], 5);
  // `SetGameTables` puts `T.coli` back, so the floor goes in after it.
  const dying = (at: number, condition: number, wet = false) => {
    const rng = new Rng(31);
    const events = scene(0, rng);
    SetGameTables({ ...CHARS, combat: SPRITES } as unknown as CharactersJson);
    T.coli = { files: ["test"], blobs: { floor: wet ? WET_BLOB : FLOOR_BLOB } };
    G.g_coli_full_set = ["floor"];
    const z = spawnZombie(at, 1, "dying");
    z.visible = true;
    z.hp = 0;
    z.dead = true;
    z.flags |= ActorFlag.Dead;
    z.condition = condition;
    z.pos = vec3(3, 2, 40);
    z.lookAt = vec3(5, 6, 44);
    z.state = ZombieState.Death;
    z.sub = 0;
    return { z, rng, events };
  };
  const newSprites = (since: number) =>
    G.g_sprite_effects.filter((e) => e.id >= since);

  // -- the cue list and the dust ---------------------------------------------
  {
    const { z, rng, events } = dying(0x3700, 5);
    check("`EnemyZombieInit` raises `obj+0x1F8` bit 4 -- the ring traces the floor",
          (z.motionFlags & MotionFlag.TraceGround) !== 0,
          `0x${z.motionFlags.toString(16)}`);
    GameUpdate(1 / 60, NULL_HOST, rng, events);
    // Body condition 5 with no remap bits takes clip 0x3DB, whose list is the
    // one at 0x005930C4: a single cue, play frame 25.
    check("a condition-5 death plays 0x3DB and installs its cue list",
          z.motion === 0x3db && z.zom.deathCue === 6
          && ZOMBIE_DEATH_EFFECT_CUES[z.zom.deathCue] === 25,
          `motion 0x${z.motion.toString(16)} cue ${z.zom.deathCue}`);
    const seq0 = G.g_sprite_effect_seq;
    let at = -1;
    let dust: SpriteEffect | undefined;
    for (let i = 0; i < 60 && z.state === ZombieState.Death; i++) {
      GameUpdate(1 / 60, NULL_HOST, rng, events);
      const fresh = newSprites(seq0);
      if (fresh.length && at < 0) { at = MotionPlayFrame(z); dust = fresh[0]; }
    }
    check("the dust goes up on the cue frame and not before",
          at === 25, `first effect at play frame ${at}`);
    check("...one of it, kind 0x46", G.g_sprite_effect_seq - seq0 === 1
          && dust?.kind === SpriteEffectKind.Dust,
          `${G.g_sprite_effect_seq - seq0} spawned, kind ${dust?.kind}`);
    check("...on the traced floor, not at the body's own height",
          dust?.pos.y === 0 && dust.pos.x === 3 && dust.pos.z === 40,
          JSON.stringify(dust?.pos));
    check("...stretched by the cue's own override, not the kind's 0.7",
          dust?.scale.x === 0.5 && dust.scale.y === 1.5 && dust.scale.z === 1.5,
          JSON.stringify(dust?.scale));
    check("...and the cursor steps on to the list's terminator",
          ZOMBIE_DEATH_EFFECT_CUES[z.zom.deathCue] === -1,
          `cue ${z.zom.deathCue}`);
    check("no water rings on a dry floor", G.g_water_rings.length === 0);

    // The corpse: the ring opens under the tracked bone on the corpse state's
    // first frame, at the traced floor plus 0.05.
    for (let i = 0; i < 10 && z.state === ZombieState.Death; i++) {
      GameUpdate(1 / 60, NULL_HOST, rng, events);
    }
    check("the death clip ends in a sinking corpse",
          z.state === ZombieState.CorpseSink, `state ${z.state}`);
    // The corpse state's first frame is the next one.
    GameUpdate(1 / 60, NULL_HOST, rng, events);
    const ring = G.g_ring_effects[0];
    check("...which opens one ring task", G.g_ring_effects.length === 1,
          `${G.g_ring_effects.length}`);
    check("...at the tracked bone's x and z, not the origin's",
          ring?.x === 5 && ring.z === 44, JSON.stringify(ring));
    check("...on the traced floor plus 0.05, at scale 1",
          ring !== undefined && ring.y === Math.fround(0.05)
          && ring.scale === 1, `${ring?.y}`);
    check("...and the frame that spawned it already shows the spread",
          ring !== undefined && ring.drawnStrips.length === 4
          && ring.count === RING_EFFECT_SPREAD_FRAMES - 1, `${ring?.count}`);

    // 120 frames spreading, 30 holding, 39 fading, and gone on the 40th --
    // outliving the corpse, which leaves after its own 120.
    const drew = (r: RingEffect) => r.drawnStrips.length === 4 ? "spread"
      : r.drawnAlpha < 1 ? "fade" : "hold";
    const drawn: string[] = [];
    if (ring) drawn.push(drew(ring));
    for (let i = 0; i < 400 && G.g_ring_effects.length; i++) {
      GameUpdate(1 / 60, NULL_HOST, rng, events);
      if (G.g_ring_effects[0]) drawn.push(drew(G.g_ring_effects[0]));
    }
    const count = (s: string) => drawn.filter((d) => d === s).length;
    check("the ring spreads for 120 frames, holds 30 and fades for 39",
          count("spread") === 120 && count("hold") === 30
          && count("fade") === 39 && drawn.length === 189,
          `${count("spread")}/${count("hold")}/${count("fade")} `
          + `of ${drawn.length}`);
    check("...and the corpse it opened under is long gone by then", z.despawned);
  }

  // -- in the attract demo, no ring --------------------------------------------
  {
    const { z } = dying(0x3710, 5);
    G.g_app_state = AppState.Attract;
    SpawnGroundRingEffect(z);
    check("`SpawnGroundRingEffect` does nothing outside play",
          G.g_ring_effects.length === 0);
    G.g_app_state = AppState.InPlay;
    z.motionFlags &= ~MotionFlag.TraceGround;
    SpawnGroundRingEffect(z);
    check("...and without bit 4 the ring sits at the body's own height",
          G.g_ring_effects[0]?.y === Math.fround(2 + Math.fround(0.05)),
          `${G.g_ring_effects[0]?.y}`);
  }

  // -- on water: the rings, then the splash ----------------------------------
  {
    const { z, rng, events } = dying(0x3720, 5, true);
    const seq0 = G.g_sprite_effect_seq;
    for (let i = 0; i < 60 && z.state === ZombieState.Death; i++) {
      GameUpdate(1 / 60, NULL_HOST, rng, events);
      if (G.g_water_rings.length) break;
    }
    const splash = newSprites(seq0);
    const rings = G.g_water_rings;
    check("on a wet surface the cue puts down two water rings",
          rings.length === 2 && rings.every((r) => r.slot === WATER_RING_SLOT),
          `${rings.length}`);
    check("...at 1.0 and 0.5, each give or take a tenth or two",
          rings.length === 2
          && [0.8, 0.9, 1.0, 1.1, 1.2].some((s) =>
            Math.abs(rings[0]!.size - s) < 1e-6)
          && [0.3, 0.4, 0.5, 0.6, 0.7].some((s) =>
            Math.abs(rings[1]!.size - s) < 1e-6),
          rings.map((r) => r.size).join(", "));
    check("...on the floor, and a splash beside them there too",
          rings.every((r) => r.pos.y === 0) && splash.length === 1
          && splash[0]!.kind === SpriteEffectKind.Splash
          && splash[0]!.pos.y === 0,
          `${splash.map((s) => `${s.kind}@${s.pos.y}`).join(",")}`);
    check("...and the rings are once per death: the latch is up",
          (z.flags2 & ZombieFlag2.OneShotFired) !== 0);
    // Sixty frames drawn, the spawn frame the first of them.
    let alive = 1;
    const first = rings[0]!;
    while (G.g_water_rings.includes(first) && alive < 200) {
      GameUpdate(1 / 60, NULL_HOST, rng, events);
      if (G.g_water_rings.some((r) => r.id === first.id)) alive++;
      else break;
    }
    check("a water ring lives sixty frames, widening and fading",
          alive === WATER_RING_FRAMES, `${alive}`);
  }

  // -- in the rain, a splash at the body -------------------------------------
  {
    const { rng, events } = dying(0x3730, 5);
    // `EvtOpEnableRain1D` stores its operand in `g_rain_enabled`, and the
    // scene reset takes it back to 0.
    SCENE_OPS[0x1d]!.run!({} as Walker, { value: 1 } as never, true);
    check("the rain opcode writes `g_rain_enabled`", G.g_rain_enabled === 1);
    const seq0 = G.g_sprite_effect_seq;
    for (let i = 0; i < 60 && !newSprites(seq0).length; i++) {
      GameUpdate(1 / 60, NULL_HOST, rng, events);
    }
    const s = newSprites(seq0)[0];
    check("in the rain the cue splashes instead of raising dust",
          s?.kind === SpriteEffectKind.Splash, `kind ${s?.kind}`);
    check("...at the body's own height, and puts down no rings",
          s?.pos.y === 2 && G.g_water_rings.length === 0,
          `${s?.pos.y}, ${G.g_water_rings.length} rings`);
    ResetSceneOnEnter();
    check("...and `ResetSceneOnEnter` puts `g_rain_enabled` back to 0",
          G.g_rain_enabled === 0);
  }

  // -- the landing: state 12 -------------------------------------------------
  {
    const { z, rng, events } = dying(0x3740, 0);
    z.flags |= ActorFlag.HoldingWeapon;
    z.pos = vec3(0, 40, 40);
    const seq0 = G.g_sprite_effect_seq;
    const seen = new Map<number, SpriteEffect>();
    for (let i = 0; i < 500 && z.state !== ZombieState.CorpseSink; i++) {
      GameUpdate(1 / 60, NULL_HOST, rng, events);
      for (const e of newSprites(seq0)) seen.set(e.id, e);
    }
    const spawned = [...seen.values()];
    check("a body that falls and bounces raises dust where it lands, once",
          spawned.length === 1 && spawned[0]!.kind === SpriteEffectKind.Dust
          && spawned[0]!.pos.y === 0 && z.state === ZombieState.CorpseSink,
          `${spawned.map((e) => `${e.kind}@${e.pos.y}`)}, state ${z.state}`);
  }

  // -- the arc entrance's landing: the sound, the shake ----------------------
  const landArc = (condition: number) => {
    const { z, rng, events } = dying(0x3750 + condition, condition);
    const heard: number[] = [];
    events.on("sound.play", (d) => heard.push(d.id));
    z.dead = false;
    z.flags &= ~ActorFlag.Dead;
    z.hp = 10;
    z.state = ZombieState.ArcScriptedEntrance;
    z.sub = 4;
    // The state reads its tail with no test, as `0x00458A70` does, so the
    // fixture carries one: an actor in state 30 always has its arc's.
    z.entry = { dest: [0, 0, 60], frames: 20, step: 1, delay: 0 };
    z.arcPhase = ArcPhase.Settled;
    z.flags2 |= ZombieFlag2.Carried;
    G.g_screen_shake_frames = 0;
    const seq0 = G.g_sprite_effect_seq;
    ZombieStateArcScriptedEntrance(z, 1 / 60, rng, NULL_HOST, events);
    return { z, heard, spawned: newSprites(seq0) };
  };
  {
    const light = landArc(0);
    check("an arc entrance lands with the footfall and the landing hook's dust",
          light.heard.includes(SND_LANDING)
          && light.spawned.some((e) => e.kind === SpriteEffectKind.Dust),
          `${light.heard.map((h) => h.toString(16))}`);
    check("...and no shake", G.g_screen_shake_frames === 0,
          `${G.g_screen_shake_frames}`);
    check("...clearing the carried bit on the settled phase",
          (light.z.flags2 & ZombieFlag2.Carried) === 0);
    const heavy = landArc(COND_HEAVY_LANDING);
    check("body condition 5 lands heavy: the knock and a 0x20-frame shake",
          heavy.heard.includes(SND_LANDING_HEAVY)
          && !heavy.heard.includes(SND_LANDING)
          && G.g_screen_shake_frames === LANDING_HEAVY_SHAKE,
          `${heavy.heard.map((h) => h.toString(16))}, `
          + `shake ${G.g_screen_shake_frames}`);
    check("...and no dust", heavy.spawned.length === 0);
    // Sub 3 arms the arc and drops the landing's latch -- `AND ECX,
    // 0xfffeffff` at `0x00458BA1`, bit 0x10000 -- so a latch left up by
    // anything earlier cannot swallow this landing. The port used to clear
    // the carried bit there instead, one hex digit over.
    const armed = landArc(0);
    armed.z.sub = 3;
    armed.z.entry = { dest: [0, 0, 60], frames: 20, step: 1 };
    armed.z.flags2 |= ZombieFlag2.OneShotFired;
    ZombieStateArcScriptedEntrance(armed.z, 1 / 60, new Rng(3), NULL_HOST,
                                   new Events());
    check("arming the arc drops the landing latch, bit 0x10000",
          (armed.z.flags2 & ZombieFlag2.OneShotFired) === 0,
          `sub ${armed.z.sub} flags2 0x${armed.z.flags2.toString(16)}`);
    // `UpdateScreenShake` is what turns the count into the camera's nod.
    G.g_screen_shake_frames = LANDING_HEAVY_SHAKE;
    UpdateScreenShake();
    check("...which `UpdateScreenShake` counts down into a nod",
          G.g_screen_shake_frames === LANDING_HEAVY_SHAKE - 1
          && G.g_screen_shake_pitch !== 0, `pitch ${G.g_screen_shake_pitch}`);
  }

  // -- the delayed leap's landing, the same pair and the attack cry ----------
  {
    const { z, rng, events } = dying(0x3760, 0);
    const heard: number[] = [];
    events.on("sound.play", (d) => heard.push(d.id));
    z.dead = false;
    z.flags &= ~ActorFlag.Dead;
    z.hp = 10;
    z.state = ZombieState.DelayedLeap;
    z.sub = 3;
    z.delayedLeap = { delay: 0, dest: [0, 0, 40], gravity: -0.03 };
    z.zom.holdFrames = 0;
    const seq0 = G.g_sprite_effect_seq;
    ZombieStateDelayedLeap(z, 1 / 60, rng, NULL_HOST, events);
    check("a delayed leap lands with the footfall, the dust and the attack cry",
          heard.includes(SND_LANDING) && heard.includes(40)
          && newSprites(seq0).some((e) => e.kind === SpriteEffectKind.Dust),
          `heard ${heard.map((h) => h.toString(16))}`);
    check("...and the cry comes after the footfall, as the exe plays them",
          heard.includes(SND_LANDING)
          && heard.indexOf(SND_LANDING) < heard.indexOf(40),
          heard.map((h) => h.toString(16)).join(","));
  }
}

console.log("`ActorKillAll` routes class 0x30 through its death chain:");
{
  const rng = new Rng(15);
  const events = scene(2, rng);
  const [a, b] = G.g_object_list;
  const n = ActorKillAll(rng);
  check("the button kills both", n.enemies === 2 && a.dead && b.dead);
  // The whole reason to route rather than hand-assemble: what the old code set
  // by hand -- `dead`, the flag, a clip -- is three of the eleven things
  // `ZombieStateDeath6` does, and none of the teardown.
  check("...leaving the hit its death chain reads, not a clip",
        a.pendingHit !== null && a.death === null,
        `${JSON.stringify(a.pendingHit)} / ${JSON.stringify(a.death)}`);
  run(1, rng, events);
  check("...so one update puts both in state 6",
        a.state === ZombieState.Death && b.state === ZombieState.Death,
        `${a.state} / ${b.state}`);
  // 900 frames is what `tools/killall.mjs` ran, and what used to leave three
  // bodies standing.
  run(900, rng, events);
  check("...and 900 frames later the pool is empty of them",
        !G.g_object_list.some((o) => o.at === a.at || o.at === b.at),
        `${G.g_object_list.length} left`);
  check("...with both counters back at zero",
        G.g_enemies_alive === 0 && G.g_enemies_present === 0,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);
}

/**
 * **`ActorKillAll` is refused wherever a shot is refused.**
 *
 * `DispatchHit` (`FUN_004092F0`) returns before `ResolveHit` on `obj+0x34` bit
 * `0x100`, so in the engine no actor can reach zero hit points inside that
 * window — and both enemy classes lean on it. `ThrowerOnShot` (`FUN_004499A0`)
 * gates its whole response on the bit at `004499f5`/`004499f8`, `ZombieOnShot`
 * (`FUN_00453EB0`) at `00453ec7`/`00453eca`, the dead arm of each included. So
 * a debug clear that killed a shot-immune actor left it dead and never told:
 * its class's death chain never opened, and that chain is the only thing that
 * runs `ThrowerReleaseSlotOnDeath` (`FUN_0044D050`) and
 * `ZombieReleasePermitAndUntrack` (`FUN_004565A0`) — the two routines that
 * take it out of `g_enemies_alive` and out of `g_enemy_slots`.
 *
 * That was stage 6 block 0: `g_enemies_alive` stuck at 1 with the sidebar
 * naming nobody, because the holder was a `zslman` cycling its ordinary states
 * as a corpse. Every assertion here fails without the one-line refusal in
 * `ActorKillAll`, and it is the **counters and the slot array** that fail, not
 * a layer's opinion of itself.
 */
console.log("\n`ActorKillAll` will not kill what a shot could not touch:");
{
  const rng = new Rng(24);
  const events = scene(0, rng);

  const immuneZombie = spawnZombie(0x2700, 1, "immune zombie");
  immuneZombie.visible = true;
  immuneZombie.hp = 10;
  immuneZombie.pos = vec3(0, 0, 40);
  immuneZombie.flags |= ActorFlag.ShotImmune;

  const plainZombie = spawnZombie(0x2701, 1, "plain zombie");
  plainZombie.visible = true;
  plainZombie.hp = 10;
  plainZombie.pos = vec3(20, 0, 40);

  const immuneThrower = ActorSpawn(0x2702, SpawnClass.Thrower, 0x18,
                                   "immune thrower");
  immuneThrower.visible = true;
  immuneThrower.hp = 130;
  immuneThrower.pos = vec3(-20, 0, 40);
  immuneThrower.flags |= ActorFlag.ShotImmune;

  G.g_enemies_alive = 3;
  G.g_enemies_present = 3;
  RegisterEnemySlot(immuneZombie);
  RegisterEnemySlot(plainZombie);
  RegisterEnemySlot(immuneThrower);

  const n = ActorKillAll(rng);
  check("the clear takes the one actor a shot could have reached",
        n.enemies === 1, `${n.enemies}`);
  check("...and leaves the shot-immune zombie its hit points",
        !immuneZombie.dead && immuneZombie.hp === 10
        && (immuneZombie.flags & ActorFlag.Dead) === 0,
        `hp ${immuneZombie.hp} flags ${immuneZombie.flags.toString(16)}`);
  check("...and the shot-immune thrower its own",
        !immuneThrower.dead && immuneThrower.hp === 130
        && (immuneThrower.flags & ActorFlag.Dead) === 0,
        `hp ${immuneThrower.hp} flags ${immuneThrower.flags.toString(16)}`);

  // The counters, which is the half the hang was made of. One kill, so one
  // actor may leave; the two refused ones must still be in both.
  run(900, rng, events);
  check("the killed one leaves both counters",
        G.g_enemies_alive === 2 && G.g_enemies_present === 2,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);
  check("...and its slot with them",
        !slotHolds(plainZombie.at), slotsShown());
  check("...while the two refused ones are still alive and still counted",
        !immuneZombie.dead && !immuneThrower.dead
        && !immuneZombie.despawned && !immuneThrower.despawned,
        `${immuneZombie.dead}/${immuneThrower.dead}`);

  // The window is transient, and that is the whole argument for refusing
  // rather than special-casing: the clip ends, the bit goes, and the next
  // clear -- or the next shot -- takes them in the ordinary way.
  immuneZombie.flags &= ~ActorFlag.ShotImmune;
  immuneThrower.flags &= ~ActorFlag.ShotImmune;
  const m = ActorKillAll(rng);
  check("with the bit down the same clear takes both",
        m.enemies === 2 && immuneZombie.dead && immuneThrower.dead,
        `${m.enemies}`);
  run(900, rng, events);
  check("...and `g_enemies_alive` reaches zero, which is the gate",
        G.g_enemies_alive === 0, `${G.g_enemies_alive}`);
  check("...with nothing left holding a camera slot",
        G.g_enemy_slots.every((x) => x.occupied === 0), slotsShown());
}

// -- D1: where `NoCameraTrack` is raised, and the guard on it ---------------

/**
 * **`ReleaseAttackSlot` (`FUN_00456520`) does not untrack, and the caller
 * that does is guarded.**
 *
 * The port used to raise `obj+0x34` bit 0x10000 inside the permit release,
 * unconditionally, on every path in both ported enemy classes. The engine
 * raises it in `ZombieReleasePermitAndUntrack` (`FUN_004565A0`) instead, in
 * the same arm as the `g_enemy_slots` clear, and skips both when the actor
 * carries `ActorFlag.KeepCameraWhenLast` and is the last enemy alive.
 *
 * Every assertion below fails on the code as it stood before D1: the first
 * four because the release wrote the flag, the last three because the guard
 * did not exist.
 */
console.log("\n`NoCameraTrack` is the caller's write, and it is guarded:");
{
  const rng = new Rng(21);
  scene(0, rng);

  // 1. The permit release, on its own, on both classes.
  {
    const z = spawnZombie(0x2400, 1, "zombie");
    z.visible = true;
    z.hp = 10;
    check("a zombie takes a permit", TryClaimAttackSlot(z, new Rng(1), NULL_HOST));
    ReleaseAttackSlot(z);
    check("`ReleaseAttackSlot` gives the permit back",
          z.attackPermit === -1 && G.g_attack_permits[0] === -1);
    check("...and does not touch `obj+0x34`",
          (z.flags & ActorFlag.NoCameraTrack) === 0,
          `flags ${z.flags.toString(16)}`);

    const w = ActorSpawn(0x2401, SpawnClass.Thrower, 0x35, "thrower");
    w.visible = true;
    w.hp = 10;
    check("...and a thrower's release is the same routine, same silence",
          ThrowerTryClaimAttackSlot(w, new Rng(1), NULL_HOST)
          && (ThrowerReleaseAttackPermit(w), w.attackPermit === -1)
          && (w.flags & ActorFlag.NoCameraTrack) === 0,
          `flags ${w.flags.toString(16)}`);
  }
}
{
  const rng = new Rng(22);
  scene(0, rng);

  // 2. The guard, in `ZombieReleasePermitAndUntrack`. Three cases, and the
  //    count is read *before* `ReleaseEnemyAliveCount` runs, so "1" means
  //    "this actor is the last one".
  const zombie = (at: number, flags = 0): ZombieActor => {
    const a = spawnZombie(at, 1, `zombie ${at}`);
    a.visible = true;
    a.hp = 10;
    a.flags |= flags;
    RegisterEnemySlot(a);
    return a;
  };

  {
    const last = zombie(0x2500, ActorFlag.KeepCameraWhenLast);
    G.g_enemies_alive = 1;
    ZombieReleasePermitAndUntrack(last);
    check("the last enemy alive carrying the bit keeps camera tracking",
          (last.flags & ActorFlag.NoCameraTrack) === 0,
          `flags ${last.flags.toString(16)}`);
    check("...and keeps its `g_enemy_slots` slot with it",
          slotHolds(last.at), slotsShown());
    check("...and still leaves `g_enemies_alive`, which is outside the arm",
          G.g_enemies_alive === 0, `${G.g_enemies_alive}`);
  }
  {
    const plain = zombie(0x2501);
    G.g_enemies_alive = 1;
    ZombieReleasePermitAndUntrack(plain);
    check("one without the bit loses tracking even as the last alive",
          (plain.flags & ActorFlag.NoCameraTrack) !== 0,
          `flags ${plain.flags.toString(16)}`);
    check("...and loses the slot with it",
          !slotHolds(plain.at), slotsShown());
  }
  {
    const held = zombie(0x2502, ActorFlag.KeepCameraWhenLast);
    G.g_enemies_alive = 2;                     // it is not the last one
    ZombieReleasePermitAndUntrack(held);
    check("with two alive the guard does not fire",
          (held.flags & ActorFlag.NoCameraTrack) !== 0
          && !slotHolds(held.at),
          `flags ${held.flags.toString(16)} slots ${slotsShown()}`);
  }
}
{
  const rng = new Rng(23);
  scene(0, rng);

  // 3. Class 0x31's is the same guard on the other counter --
  //    `ThrowerReleaseSlotOnDeath` (`FUN_0044D050`) reads `g_enemies_present`.
  //    The port used to guard the slot clear alone and raise the flag either
  //    way, which is the half of D1 that lived in `combat/counts.ts`.
  const thrown = (at: number, flags = 0): Actor => {
    const a = ActorSpawn(at, SpawnClass.Thrower, 0x35, `thrower ${at}`);
    a.visible = true;
    a.hp = 0;                                  // dying, so the routine acts
    a.flags |= flags;
    // `EnemyThrowerInit` has already claimed it a slot: `RegisterEnemySlot`
    // is its last call.
    return a;
  };

  {
    const last = thrown(0x2600, ActorFlag.KeepCameraWhenLast);
    G.g_enemies_present = 1;
    ThrowerReleaseSlotOnDeath(last);
    check("the last enemy present carrying the bit keeps both",
          (last.flags & ActorFlag.NoCameraTrack) === 0
          && slotHolds(last.at),
          `flags ${last.flags.toString(16)} slots ${slotsShown()}`);
  }
  {
    const plain = thrown(0x2601);
    G.g_enemies_present = 1;
    ThrowerReleaseSlotOnDeath(plain);
    check("...and one without the bit loses both",
          (plain.flags & ActorFlag.NoCameraTrack) !== 0
          && !slotHolds(plain.at),
          `flags ${plain.flags.toString(16)} slots ${slotsShown()}`);
  }
}
