/**
 * What a shot means to a civilian — which is a life, a hundred points and a
 * change of script, and never the damage table class 0x30 and 0x31 run.
 *
 * `MarkActorShot` (`FUN_00404DB0`) raises `obj+0x34` bit 3 and the bit naming
 * the shooter, and this is the class's own reading of them, out of the tail of
 * `CivilianUpdate` (`FUN_0048A920`). That is what `ClassHandler.ownsShotResult`
 * declares.
 */
import { ActorFlag, type Actor } from "../actor";
import { PlayerTakeDamageTimed } from "../combat/player";
import { ScoreAddForPlayer } from "../combat/score";
import type { Events } from "../../core/events";
import { G } from "../globals";
import type { ClassFrame } from "../registry";
import { GameMode } from "../game_mode";
import { vec3 } from "../vec";
import { SpawnCivilianHitMarker } from "./hit_marker";
import { CivilianHeadMode, CivilianTarget, CivilianWait } from "./ops";
import { CivilianRunScript } from "./script";

/** What a shot costs — `ScoreAddForPlayer`'s operand. */
const SHOT_PENALTY = -100;

/**
 * `CivilianPlayDeathVoice` — `FUN_0048D140`.
 *
 * `sub+0x81` names the voice; `0xFF` picks one from the character type, which
 * is what proves what this class is: types 0x24/0x25/0x2E/0x31-0x33 get id
 * `0x2000001A`, 0x21/0x22 get `0x20000011`, 0x26-0x2C get `0x2000000B`,
 * 0x20/0x23/0x2D get `0x2000000D`, and everything else `0x20000012` — the
 * young man, the man, the young woman, the old woman and the child of
 * `COM\\220_Y_M.WAV` and its neighbours.
 */
export function CivilianPlayDeathVoice(obj: Actor, events?: Events): void {
  const sub = obj.civ;
  const byIndex = [0x2000001a, 0x20000012, 0x2000000b, 0x20000011,
                   0x2000000d];
  let id: number;
  const sel = sub?.deathVoice ?? 0xff;
  if (sel < byIndex.length) {
    id = byIndex[sel];
  } else {
    const t = obj.charType;
    if (t === 0x20 || t === 0x23 || t === 0x2d) id = byIndex[4];
    else if (t === 0x21 || t === 0x22) id = byIndex[3];
    else if (t === 0x24 || t === 0x25 || t === 0x2e
             || (t >= 0x31 && t <= 0x33)) id = byIndex[0];
    else if (t >= 0x26 && t <= 0x2c) id = byIndex[2];
    else id = byIndex[1];
  }
  events?.emit("sound.play", { id });
}

/**
 * The shot and the rescue branch of `CivilianUpdate` (`FUN_0048A920`).
 *
 * [port-only] Inline in the engine, with no address of its own. The gate is
 * two tests, over both arms:
 *
 * ```
 * 0048AAC0  CMP [EAX + 0x4C], EBX ; JZ 0x0048AD0F     ; no on-shot script
 * 0048AAC9  MOV ECX, [0x009C6F08] ; CMP ECX, 2 ; JNZ 0x0048AD0F
 * 0048AD12  AND AL, 0xF1                              ; the hit bits go
 * ```
 *
 * A civilian with no on-shot script has its hit bits cleared every frame and
 * cannot be hurt at all, which is how the ones behind glass work -- and it is
 * what `ClassHandler.invulnerable` answers with. **Nor can any civilian while
 * `g_scene_state_major_entered` is not 2**, the path camera: a hit is cleared
 * and the killed bit waits for the state to come back. Stage 3's captives
 * lying in the canal arm their on-shot script only under state 1, so in the
 * exe no shot ever plays the death it names.
 */
export function CivilianCheckShot(obj: Actor, f: ClassFrame): void {
  const sub = obj.civ;
  if (!sub) return;
  if (sub.onShotScript < 0 || G.g_scene_state_major_entered !== 2) {
    obj.flags &= ~0xe;
    obj.pendingHit = null;
    return;
  }
  // **Killed by her captors**: `obj+0x34` bit `0x4000000` is already up
  // (`TEST ECX, 0x4000000; JZ` at `0x0048AADF`) -- the maul raised it, not a
  // shot -- and the arm at `0x0048AAEB` takes her on-shot script and fines
  // both players.
  if ((obj.flags & ActorFlag.Dead) !== 0) {
    obj.pendingHit = null;
    obj.dead = true;
    CivilianShotCommonStops(sub);
    f.events?.emit("civilian.shot", { at: obj.at, player: -1 });
    CivilianRunScript(obj, sub.onShotScript, 0, f);
    sub.onShot = 0;
    sub.onShotScript = -1;
    sub.resume = 0;
    sub.resumeScript = -1;
    // `TEST dword ptr [EAX], 0x8000000` at `0x0048AB38`, **after** the new
    // script's first block has loaded its word -- whose `Uncounted` bit the
    // VM keeps from the old one as well.
    if (!(sub.wait & CivilianWait.Uncounted)) {
      ScoreAddForPlayer(0, SHOT_PENALTY, f.events);
      ScoreAddForPlayer(1, SHOT_PENALTY, f.events);
    }
    CivilianShotCommonTail(obj, f);
    return;
  }
  // **Shot**: `TEST CL, 0x8; JZ` at `0x0048AB8F`.
  if ((obj.flags & 8) === 0 && obj.pendingHit === null) return;
  // Where the marker goes: bone `sub+0xAC`'s record point in the world --
  // `MatrixMultiply(model + 0xA0 + bone*0x90)` onto the camera block and
  // its translation, `0x0048AB99`..`0x0048AC09`. The records are the
  // renderer's pose here (`GameHost.boneWorld`); a host that cannot pose
  // her has no point, and the marker is only a draw, so it is not made.
  const posed = f.host.boneWorld(obj.at, sub.hitBone, _hit);
  // `obj+0x34` bits 1 and 2 name the shooter; neither, or both, is `rand() %
  // 2` (`0x0048AC1F`..`0x0048AC32`).
  const two = obj.flags & 6;
  const player = two === 2 ? 0 : two === 4 ? 1 : f.rng.int(2);
  // `PUSH -1; PUSH 1; PUSH EBX; PUSH EBX; PUSH EDI` with `EBX = 0` at
  // `0x0048AC3E`: no overlay, through the invulnerability window, and the
  // window left alone. The port passed `(p, 1, 0, 0, -1)`, which raised the
  // damage overlay and let an invulnerable player shoot her for nothing.
  PlayerTakeDamageTimed(player, 0, 0, 1, -1, f.events, obj);
  ScoreAddForPlayer(player, SHOT_PENALTY, f.events);
  G.g_head_combo_bonus[player] = 0;
  G.g_player_hit_count[player] += 1;
  if (posed) SpawnCivilianHitMarker(player, _hit);
  obj.flags |= ActorFlag.Dead;
  obj.pendingHit = null;
  obj.dead = true;
  CivilianShotCommonStops(sub);
  f.events?.emit("civilian.shot", { at: obj.at, player });
  // `sub+0x50` when there is one, else `sub+0x4C` (`0x0048ACB2`) -- and the
  // two words are cleared only **after** the script runs (`0x0048ACCE`), so
  // an on-shot script that names a new one of either loses it. The port
  // cleared them first and ran the voice before the script, whose op 0x2A
  // picks the voice.
  const to = sub.onShotAltScript >= 0 ? sub.onShotAltScript
    : sub.onShotScript;
  CivilianRunScript(obj, to, 0, f);
  sub.onShot = 0;
  sub.onShotScript = -1;
  sub.resume = 0;
  sub.resumeScript = -1;
  CivilianShotCommonTail(obj, f);
}

const _hit = vec3();

/**
 * The four stores both arms make before their script: the timer, the target
 * mode, the sound list and the queued sound's delay (`0x0048AAEB`..
 * `0x0048AB08` and `0x0048AC89`..`0x0048ACA6`).
 *
 * `[port-only]` as a function: the engine writes them out twice, the same
 * four instructions in each arm.
 */
function CivilianShotCommonStops(sub: NonNullable<Actor["civ"]>): void {
  sub.timer = -1;
  sub.targetMode = CivilianTarget.None;
  sub.sounds = [];
  sub.soundDelay = 0;
}

/**
 * Both arms' tail: the death voice, the head sent back to rest if it was
 * looking at anything (`CMP [EAX+0x8C], EBX; JZ; MOV [EAX+0x8C], 6`), and
 * Training's `g_training_out` (`0x009A2234`).
 *
 * `[port-only]` as a function, for the same reason.
 */
function CivilianShotCommonTail(obj: Actor, f: ClassFrame): void {
  const sub = obj.civ;
  if (!sub) return;
  CivilianPlayDeathVoice(obj, f.events);
  if (sub.headMode !== CivilianHeadMode.None) {
    sub.headMode = CivilianHeadMode.Rest;
  }
  if (G.g_GameMode === GameMode.Training) G.g_training_out = 1;
}
