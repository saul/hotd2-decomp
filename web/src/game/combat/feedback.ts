/**
 * What a shot **looks and sounds like**, once the damage is decided.
 *
 * Two routines, and between them they are every effect a bullet makes:
 * `ActorShotFeedback` (`FUN_00454050`) for a hit on a character, and
 * `SpawnWorldImpact` (`FUN_00405260`) for one that met the level instead.
 *
 * Both used to live in `render/shooting.ts`, spelled as a canvas gradient and
 * a `Sprite`. That put a transcribable piece of the game where `test:port`
 * could not reach it, and — worse for the thing the viewer actually sees — it
 * lost the two facts below.
 *
 * ## The blood is at the bone, and the ricochet is at the sphere
 *
 * Neither effect is at the point the ray met the model, because the engine
 * never computes that point. `ShotTestBoneSphere` (`FUN_004047D0`) finds a
 * **sphere**, `MarkActorShot` (`FUN_00404DB0`) copies its centre into the
 * candidate record, and every effect works from there:
 *
 * * the ricochet sprite goes at the centre, transformed straight out of camera
 *   space;
 * * the blood goes at the centre with the sphere's own radius added to `z`, so
 *   it sits on the face of the limb turned toward the camera, and it is
 *   re-read from the bone on every one of its twenty-five frames.
 *
 * So a shot that clips the edge of an arm still bleeds from the middle of the
 * arm. That is the game, not an approximation of it.
 *
 * ## The severity is a table, and result 1 is the odd one
 *
 * 0.75 for a hit that swapped the part, 0.5 for plain damage, 1.0 for a
 * severed one. Result 1 pays *more* than result 2, which reads backwards until
 * you notice that 1 means the bone's model changed and 2 means it did not.
 */
import type { Events } from "../../core/events";
import type { Actor } from "../actor";
import { G } from "../globals";
import type { GameHost } from "../host";
import { T } from "../tables";
import type { Vec3 } from "../vec";
import { vec3 } from "../vec";
import { SpawnBloodSpray } from "../effects/blood";
import { AnglesToward, SpawnSpriteEffect, SpriteEffectKind }
  from "../effects/sprite";
import { SpawnSeveredHead } from "../effects/severed_head";
import { HitResultCode } from "./resolve_hit";

/** The bone the head is, in every skeleton the game ships. */
const HEAD_BONE = 2;
/**
 * `obj+0x32C == 0x1DC2` — the one head model that comes off on a *damaging*
 * hit rather than on the 1-in-4 kill roll, and the stump it leaves.
 */
const BURSTING_HEAD_SLOT = 0x1dc2;
const BURSTING_HEAD_STUMP = 0x1dc1;
/** `ActorPlayHitVoice(obj, 3)` — a fourth voice kind, only for that burst. */
export const VOICE_KIND_BURST = 3;
/** `PlaySoundId(0x1116A9)` — `COMMON\BULLET_MET3_22.WAV`. */
const SOUND_RICOCHET = 0x1116a9;
const SOUND_RICOCHET_TYPE2 = 0xf16a9;
/** `*(short *)(obj + 500) == 2` and `== 3` — the two special character types. */
const CHAR_TYPE_RICOCHET_ALT = 2;
const CHAR_TYPE_SPRITE_ALT = 3;
/** `g_coli_hit_surface` values whose impact sprite is turned to the camera. */
const WET_SURFACES: ReadonlySet<number> = new Set([5, 0x37]);

/**
 * `ActorShotFeedback` — `FUN_00454050`.
 *
 * `point` is the hit bone's sphere centre in world space, which is what
 * `GameHost.pickShot` already returns and what the engine's own candidate
 * record holds.
 *
 * [diverges] Three things the engine's routine does that this one does not,
 * each because the port answers it somewhere else or not at all:
 *
 * * it is called from each class's own on-shot routine — `FUN_00453EB0` for
 *   class 0x30, and class 0x31 has its own copy in `ThrowerShotFeedback`
 *   (`FUN_00449B20`) that forces result 5 while the thrower is down. The port
 *   calls this once from `ProcessShotRequests`, beside the `ResolveHit` whose
 *   result it reads, so every shootable class gets feedback rather than two;
 * * `ActorUpdateBodyCondition` (`FUN_00454270`) runs on results 1, 3 and 4 and
 *   is **not ported** — it derives `obj+0x130C` from which hands are still
 *   armed and which zones are destroyed, and the death picker reads it. The
 *   port has the sibling `ActorBodyConditionFromHands` (`FUN_00455920`) and
 *   not this one;
 * * `NoOpStub` (`FUN_0041EBB0`) is a bare `RET` and is left out.
 */
export function ActorShotFeedback(obj: Actor, bone: number, point: Vec3,
                                  host: GameHost, events?: Events): void {
  const result = G.g_hit_result;
  let severity = 0;

  switch (result) {
    case HitResultCode.Damaged: {
      // The one head that bursts without the kill roll. `obj+0x32C` is the
      // head bone's current model, so a head already swapped once does not
      // qualify -- which is why this fires at most once per actor.
      const slot = obj.boneSlot[String(HEAD_BONE)];
      if (bone === HEAD_BONE && slot === BURSTING_HEAD_SLOT) {
        // `ActorPlayHitVoice(obj, 3)` is the fourth voice kind and stays with
        // the other three in `render/shooting.ts`, which owns the sound
        // tables and the seeded pick. [open] -- the burst is silent here.
        const at = vec3(point.x, point.y, point.z);
        host.boneWorld(obj.at, HEAD_BONE, at);
        SpawnSeveredHead(at, BURSTING_HEAD_STUMP, 0, G.g_camera_yaw_bams);
        obj.boneSlot[String(HEAD_BONE)] = BURSTING_HEAD_STUMP;
        SpawnSpriteEffect(point, 0, 0, SpriteEffectKind.Metal, 1, 0, host,
                          events);
        events?.emit("sound.play", { id: SOUND_RICOCHET });
        break;
      }
      severity = T.chars?.combat?.blood_scale["1"] ?? 0.75;
      break;
    }
    case HitResultCode.Plain:
      severity = T.chars?.combat?.blood_scale["2"] ?? 0.5;
      break;
    case HitResultCode.Severed:
    case 4:
      severity = T.chars?.combat?.blood_scale["3"] ?? 1.0;
      break;
    case HitResultCode.NoEffect: {
      // The engine's arm here first refuses a bone whose `+0x280` carries bit
      // 0x10 -- one tested as a mesh by `ShotTestBoneMesh` (`FUN_004048A0`)
      // rather than as a sphere. No bone in this port is ever mesh-tested,
      // because the port has no per-bone collision blobs, so the guard can
      // never fire and there is nothing to read it from. [open]
      const kind = obj.charType === CHAR_TYPE_SPRITE_ALT
        ? SpriteEffectKind.NoEffectType3 : SpriteEffectKind.Other;
      SpawnSpriteEffect(point, 0, 0, kind, 1, 0, host, events);
      break;
    }
    default:
      break;
  }

  switch (result) {
    case HitResultCode.Damaged:
    case HitResultCode.Severed:
    case 4:
    case HitResultCode.Plain:
      SpawnBloodSpray(obj.at, bone, severity);
      return;
    case HitResultCode.NoEffect:
      events?.emit("sound.play", {
        id: obj.charType === CHAR_TYPE_RICOCHET_ALT
          ? SOUND_RICOCHET_TYPE2 : SOUND_RICOCHET,
      });
      return;
    default:
      return;
  }
}

/**
 * `SpawnWorldImpact` — `FUN_00405260`.
 *
 * A shot that hit the level. The **surface id is the sprite kind**, which is
 * the whole reason one switch serves both: sand, metal, other, water and wood
 * are collision materials and sprite kinds at once. The facing comes from the
 * surface normal, except on the two wet surfaces, where the sprite is turned
 * to face the camera instead.
 *
 * The port can answer this now where `render/shooting.ts` could not: the
 * bundle carries the game's own `coli/` sets, so the impact point, the normal
 * and the material are the engine's numbers rather than a raycast against
 * whatever happened to be drawn.
 *
 * [diverges] The engine also copies the hit into a per-player record at
 * 0x009A2C40, stride 0x1C. Nothing in the image reads it back, so the port
 * does not carry it.
 */
export function SpawnWorldImpact(player: number, point: Vec3, normal: Vec3,
                                 surface: number, host: GameHost,
                                 events?: Events): void {
  const a = AnglesToward(normal.x, normal.y, normal.z);
  const face = WET_SURFACES.has(surface) ? 1 : 0;
  SpawnSpriteEffect(point, a.pitch, a.yaw, surface, face, player, host, events);
}
