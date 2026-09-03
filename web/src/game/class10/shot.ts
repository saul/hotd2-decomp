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
import { CivilianTarget, CivilianWait } from "./ops";
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
 * [port-only] Inline in the engine, with no address of its own. `sub.onShot`
 * is the gate: a civilian with no on-shot script has its hit bits cleared
 * every frame and cannot be hurt at all, which is how the ones behind glass
 * work — and it is what `ClassHandler.invulnerable` answers with.
 */
export function CivilianCheckShot(obj: Actor, f: ClassFrame): void {
  const sub = obj.civ;
  if (!sub) return;
  if (sub.onShotScript < 0) {
    obj.flags &= ~0xe;
    obj.pendingHit = null;
    return;
  }
  const killed = (obj.flags & ActorFlag.Dead) !== 0;
  const hit = killed || (obj.flags & 8) !== 0 || obj.pendingHit !== null;
  if (!hit) return;

  let player: number;
  if (killed) {
    // A killing shot costs **both** players 100 — the engine calls
    // `ScoreAddForPlayer` twice with no test at all.
    player = -1;
    if (!(sub.wait & CivilianWait.Uncounted)) {
      ScoreAddForPlayer(0, SHOT_PENALTY, f.events);
      ScoreAddForPlayer(1, SHOT_PENALTY, f.events);
    }
  } else {
    // `obj+0x34` bits 1 and 2 name the shooter; neither means "either".
    const two = obj.flags & 6;
    player = two === 2 ? 0 : two === 4 ? 1 : (f.rng.next() < 0.5 ? 0 : 1);
    PlayerTakeDamageTimed(player, obj, 0, f.events);
    ScoreAddForPlayer(player, SHOT_PENALTY, f.events);
    G.g_head_combo_bonus[player] = 0;
    G.g_player_hit_count[player] += 1;
    obj.flags |= ActorFlag.Dead;
  }
  obj.pendingHit = null;
  obj.dead = true;
  sub.timer = -1;
  sub.targetMode = CivilianTarget.None;
  sub.sounds = [];
  sub.soundDelay = 0;

  // The killed branch takes `onShotAlt` when there is one; the survivable one
  // always takes `onShot`.
  const to = !killed && sub.onShotAltScript >= 0
    ? sub.onShotAltScript : sub.onShotScript;
  sub.onShot = 0;
  sub.onShotScript = -1;
  sub.resume = 0;
  sub.resumeScript = -1;
  f.events?.emit("civilian.shot", { at: obj.at, player });
  CivilianPlayDeathVoice(obj, f.events);
  CivilianRunScript(obj, to, 0, f);
}
