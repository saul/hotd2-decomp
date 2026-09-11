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
 *
 * ## And the shot's **voice** is here now
 *
 * `ActorPlayHitVoice` (`FUN_0040A6F0`) used to be implemented twice: kinds 0,
 * 1 and 2 in `render/shooting.ts` off the `shot.resolved` event, and the attack
 * cry in `combat/voice.ts`. There is one copy, in `combat/voice.ts`, and this
 * file is what the shot path calls it from — because the engine's three shot
 * kinds are played by `game/` code and a renderer may not call into the engine
 * (`verify_layers.py`'s `render-drives-the-port`, and it is right).
 *
 * Three things came with the move, and each is a correction rather than a
 * cost.
 *
 * **The kind is the hit-result code and nothing else.** `[proved]`, and from
 * two routines that agree, which is what makes it a rule rather than one
 * function's habit — `ZombieOnShot` (`FUN_00453EB0`):
 *
 * ```
 * 00453f46  f7463400000004   TEST dword ptr [ESI + 0x34], 0x4000000  ; Dead
 * 00453f4d  0f84c7000000     JZ   0x0045401a                        ; ...alive
 * 00453f6e  83f802           CMP  EAX, 0x2      ; g_hit_result, read back
 * 00453f71  7504             JNZ  0x00453f77
 * 00453f73  6a02             PUSH 0x2           ; dead and result 2 -> kind 2
 * 00453f77  6a01             PUSH 0x1           ; dead otherwise     -> kind 1
 * 00453f7a  e87167fbff       CALL 0x0040a6f0
 * 0045401a  57 e8d0030000    PUSH EDI / CALL ActorReactToHit
 * 00454025  83f805           CMP  EAX, 0x5
 * 00454028  740b             JZ   0x00454035
 * 0045402a  6a00             PUSH 0x0           ; alive, result != 5 -> kind 0
 * 0045402d  e8be66fbff       CALL 0x0040a6f0
 * ```
 *
 * — and `ThrowerOnShot` (`FUN_004499A0`) is the same two instructions with the
 * same two constants at `0x00449A76`, `0x00449A7B` and `0x00449A88`. **Neither
 * tests whether the bone was the head, and neither tests whether the actor
 * died of *this* shot.** The render-side copy keyed on `killed` and `head`, so
 * moving it faithfully changes which voice plays: the head pair now goes with
 * `HitResultCode.Plain` rather than with a headshot kill, and a shot that finds
 * an actor already dead says so instead of saying it hurt.
 *
 * What a player hears change is **the impact and only the impact**: kind 2's
 * two voice ids in `g_hit_voice_table` are the *same pair* as kind 1's, so the
 * difference between those two kinds is two head impacts (`BLOOD01`,
 * `BLOOD05`) against the five body ones. The voice line itself is unchanged.
 *
 * **The pick is the world's `rand()`.** `render/shooting.ts` drew from a
 * generator of its own, reseeded per stage, on the argument that which grunt
 * plays is feedback rather than state. In the engine it is `rand()` like every
 * other draw, and in `game/` there is nothing else it could be: `Math.random`
 * is banned (`L10`) and a pick outside the snapshot is a pick that does not
 * survive a save. So it is `ctx.rng`, and it is in the snapshot.
 *
 * **The bursting head shouts.** Kind 3 at `0x00454136` is `ActorShotFeedback`'s
 * own call rather than its caller's, and it had been silent here — with an
 * open question in the body saying so — for no better reason than that the
 * tables it reads were on the other side of the layer line. That question is
 * answered; the marker is gone with it, which is the only thing that moves the
 * count in `STATUS.md`.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { ActorFlag, type Actor } from "../actor";
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
import { ActorPlayHitVoice, ActorVoice } from "./voice";

/** The bone the head is, in every skeleton the game ships. */
const HEAD_BONE = 2;
/**
 * `obj+0x32C == 0x1DC2` — the one head model that comes off on a *damaging*
 * hit rather than on the 1-in-4 kill roll, and the stump it leaves.
 */
const BURSTING_HEAD_SLOT = 0x1dc2;
const BURSTING_HEAD_STUMP = 0x1dc1;
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
 *   result it reads, so every shootable class gets feedback rather than two.
 *   **The shot voice rides that same merge**, which is the whole reason it can
 *   live here: `PlayShotVoice` below is `ZombieOnShot`'s and
 *   `ThrowerOnShot`'s own code, and the port has one call site for it where
 *   the engine has three. Per-class is the faithful home and it is also a
 *   *narrowing* — only classes 0x30 and 0x31 have an on-shot routine, so the
 *   seventeen other ported shootable classes would go silent, which is a
 *   behaviour change nobody asked for. It is declared here instead;
 * * `ActorUpdateBodyCondition` (`FUN_00454270`) runs on results 1, 3 and 4 and
 *   is **not ported** — it derives `obj+0x130C` from which hands are still
 *   armed and which zones are destroyed, and the death picker reads it. The
 *   port has the sibling `ActorBodyConditionFromHands` (`FUN_00455920`) and
 *   not this one;
 * * `NoOpStub` (`FUN_0041EBB0`) is a bare `RET` and is left out.
 */
export function ActorShotFeedback(obj: Actor, bone: number, point: Vec3,
                                  host: GameHost, rng: Rng,
                                  events?: Events): void {
  const result = G.g_hit_result;
  let severity = 0;

  switch (result) {
    case HitResultCode.Damaged: {
      // The one head that bursts without the kill roll. `obj+0x32C` is the
      // head bone's current model, so a head already swapped once does not
      // qualify -- which is why this fires at most once per actor.
      const slot = obj.boneSlot[String(HEAD_BONE)];
      if (bone === HEAD_BONE && slot === BURSTING_HEAD_SLOT) {
        // `00454133 6a03 PUSH 0x3` / `00454136 CALL 0x0040a6f0`, before the
        // `0045413b PUSH 0x1dc1` that swaps the stump in -- so the head that
        // bursts **shouts**, with the same cry the strike plays, and it is
        // this routine's own call rather than the caller's. This line used to
        // be an unanswered-question marker saying the burst was silent
        // because the voice tables lived in `render/`. They do not.
        ActorPlayHitVoice(obj, ActorVoice.Attack, rng,
                          (id) => events?.emit("sound.play", { id }));
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
      break;
    case HitResultCode.NoEffect:
      events?.emit("sound.play", {
        id: obj.charType === CHAR_TYPE_RICOCHET_ALT
          ? SOUND_RICOCHET_TYPE2 : SOUND_RICOCHET,
      });
      break;
    default:
      break;
  }

  // The caller's half, and it comes **after** the blood in both routines that
  // have it: `ZombieOnShot` calls this routine and then the voice, and
  // `ThrowerShotFeedback` puts its own `00449D11` a single instruction after
  // `00449D09 CALL SpawnBloodSpray`. Why the port raises it from *here* rather
  // than from each class's own on-shot routine is the first bullet of this
  // routine's declared divergence, above.
  PlayShotVoice(obj, result, rng, events);
}

/**
 * The shot voice, as `ZombieOnShot` (`FUN_00453EB0`) and `ThrowerOnShot`
 * (`FUN_004499A0`) choose it — three of `ActorPlayHitVoice`'s five kinds, off
 * nothing but {@link HitResultCode} and whether the actor is dead.
 *
 * **The name is the port's and no exe function bears it** — deliberately, so
 * that nobody goes looking for one (`L38`). This is the *tail* of those two
 * routines, which the port has already merged into one feedback call site, so
 * it is a private helper of that merge rather than something claiming to be a
 * function of its own, and it is not exported for the same reason.
 *
 * The three gates, in the engine's order:
 *
 * 1. `00453ec7 f6c401 TEST AH, 0x1` on `obj+0x34` — {@link ActorFlag.ShotImmune}
 *    jumps the whole routine to its tail at `0x0045404e`, so a shot that only
 *    ricochets off a downed body is silent. `ThrowerShotFeedback` agrees from
 *    the other side: its own kind-0 site at `0x00449D11` sits on the *blood*
 *    arm, which result 5 never reaches.
 * 2. `00453f46 TEST dword ptr [ESI + 0x34], 0x4000000` — {@link ActorFlag.Dead}
 *    picks the arm, and the dead arm's only test is `00453f6e CMP EAX, 0x2` on
 *    `g_hit_result`.
 * 3. the live arm's `00454025 CMP EAX, 0x5` refuses only
 *    {@link HitResultCode.NoEffect}. Result **0** is not refused, and plays
 *    kind 0 like any other.
 */
function PlayShotVoice(obj: Actor, result: HitResultCode, rng: Rng,
                       events?: Events): void {
  if (obj.flags & ActorFlag.ShotImmune) return;
  const emit = (id: number) => { events?.emit("sound.play", { id }); };
  if (obj.flags & ActorFlag.Dead) {
    ActorPlayHitVoice(obj, result === HitResultCode.Plain
                      ? ActorVoice.HeadKilled : ActorVoice.Killed, rng, emit);
    return;
  }
  if (result === HitResultCode.NoEffect) return;
  ActorPlayHitVoice(obj, ActorVoice.Hurt, rng, emit);
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
