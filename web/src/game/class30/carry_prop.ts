/**
 * Class 0x30 state 37 — the zombie that carries something and throws it.
 *
 * Stage 3 block 3 step 6's two fat zombies on the bridge are this state: each
 * spawns holding a drum (`CarriedPropInit`, prop type 1), stands turning to the
 * camera through the carry clip's loops, waits for an attack permit, throws on
 * frame 24 of motion 267, and only then — its script over — enters state 38
 * and leaves when it is off screen. The port used to run state 37 as the maul
 * (`ZombieStateTargetMotionScript`): the throw clip played at once with
 * nothing in the hands, the script ended a second later, and state 38 retired
 * both of them while the camera was still on its approach, so the bridge was
 * empty by the time the shot reached it.
 *
 * The prop itself is `game/carried_prop.ts`. What this file owns is the
 * carrier's half: the script, the permit, the cue that lets go, and the
 * zombie's reaction to the prop being shot to pieces in its hands.
 */
import { ActorFlag, ZombieFlag2, type ZombieActor } from "../actor";
import { TurnActorAwayFromPoint } from "../actor_turn";
import { CarriedPropAlloc, CarriedPropById } from "../carried_prop";
import { CivilianWait } from "../class10/ops";
import { ActorByAt, G } from "../globals";
import type { GameHost } from "../host";
import { vec3 } from "../vec";
import { ActorSetMotionBlended } from "./motion_cue";
import {
  aimCursor, atLastFrame, blobForState, cursorScript, entryAt, frameOf,
  reblend, ZombieApplyScriptMode, ZombieScriptEnded, ZombieScriptForState,
} from "./target";
import { ZombieState } from "./states";

/** `0x34` — the turn to the camera while the entry's mode is negative... */
const CARRY_TURN_RATE = 0x34;
/** ...and `0xD0` once it is a cue frame, the throw. */
const THROW_TURN_RATE = 0xd0;
/**
 * `0x10F` — the clip replayed, one loop at a time, while the permit is taken.
 * It is 271, the carry clip itself: the zombie simply keeps holding the drum.
 */
const WAIT_MOTION = 0x10f;
/** `obj+0x1358 == 4` — a release into `CarriedPropThrowAtCamera`. */
const RELEASE_AT_CAMERA = 4;

/** `obj+0x1312`, the four subs this state has. */
enum CarrySub {
  Begin = 0,
  NextEntry = 1,
  Carry = 2,
  NextEntryDropped = 3,
  Dropped = 4,
}

/**
 * `ZombieStateCarryProp` — `FUN_0045B380`. Class 0x30 state 37.
 *
 * * **Sub 0** allocates the prop and takes the script's header entry — the
 *   header's own `{motion, frame, loops, mode}` at `+0x30`, not the list's
 *   first — and points the cursor at the list, `+0x38`.
 * * **Subs 1 and 3** take the next list entry and step on to 2 and 4.
 * * **Sub 2** carries. The prop's hit points reaching zero raises the
 *   civilian's `Free` bit and drops to sub 4; the entry's cue frame, with no
 *   cross-fade pending, writes the release mode into the prop — the throw.
 * * **Sub 4** is the same without a prop.
 *
 * Then the shared tail: turn to the camera, and at the last frame of each
 * loop, when the loops run out, decide. A negative mode is a carry entry:
 * with release mode 4 the zombie picks the player the drum is for, claims
 * that player's permit — or, if it is taken, replays `0x10F` for one more
 * loop and asks again — and steps to the throw entry. A non-negative mode
 * was the throw: on to state 35 if the list continues, otherwise
 * `ZombieScriptEnded`.
 */
export function ZombieStateCarryProp(obj: ZombieActor,
                                     host: GameHost): void {
  let holder: { player: number } = { player: -1 };
  switch (obj.sub as CarrySub) {
    case CarrySub.Begin: {
      const s = ZombieScriptForState(obj);
      const h = s?.head ?? {};
      obj.zom.carriedProp = CarriedPropAlloc(obj, h);
      ZombieApplyScriptMode(obj, h.mode ?? 0);
      obj.zom.carryRelease = h.release ?? 0;
      const m = h.motion ?? 0;
      if (obj.motion !== m) ActorSetMotionBlended(obj, m, h.frame ?? 0, 0);
      obj.zom.scriptMotion = m;
      obj.zom.targetLoops = h.loops ?? 0;
      obj.zom.targetCue = h.mode ?? 0;
      aimCursor(obj, blobForState(obj), 0);          // `blob + 0x38`
      obj.sub = CarrySub.Carry;
      break;
    }
    case CarrySub.NextEntry:
    case CarrySub.NextEntryDropped: {
      const e = cursorScript(obj)?.entries[obj.zom.scriptPc];
      if (e) {
        ZombieApplyScriptMode(obj, e.mode);
        if (obj.motion !== e.motion) {
          ActorSetMotionBlended(obj, e.motion, e.frame, 10);
        }
        obj.zom.scriptMotion = e.motion;
        obj.zom.targetLoops = e.loops;
        obj.zom.targetCue = e.mode;
      }
      obj.sub += 1;
      obj.zom.scriptPc += 1;
      break;
    }
    case CarrySub.Carry: {
      const p = CarriedPropById(obj.zom.carriedProp);
      if (!p || p.hp < 1) {
        const t = obj.targetAt >= 0 ? ActorByAt(obj.targetAt) : undefined;
        if (t?.civ) t.civ.wait |= CivilianWait.Free;
        letGo(obj);
        obj.sub = CarrySub.Dropped;
      } else if (frameOf(obj) === obj.zom.targetCue
                 && !(obj.fadeFrom && obj.fade > 0)) {
        // `(obj+0x1CB & 1) == 0` -- bit 0 of the track's `+0x37`, which
        // `ActorSetMotionBlended` raises for the length of a cross-fade.
        // `[likely]` that the port's pending fade is the same condition.
        p.mode = obj.zom.carryRelease;
        letGo(obj);
      }
      if (p) holder = p;
      tail(obj, host, holder);
      break;
    }
    case CarrySub.Dropped:
      // `iVar7 = obj`: the byte is the zombie's own `obj+0x121`.
      tail(obj, host, {
        get player() { return obj.attackPermit; },
        set player(v: number) { obj.attackPermit = v; },
      });
      break;
    default:
      break;
  }
  reblend(obj);
}

/**
 * The prop is out of the hands: `obj+0x34 &= ~0x1000000` if it was set,
 * `obj+0x136C |= 1`, and `obj+0x130C = 0`, the body condition.
 */
function letGo(obj: ZombieActor): void {
  if (obj.flags & ActorFlag.HoldingWeapon) {
    obj.flags &= ~ActorFlag.HoldingWeapon;
    obj.flags2 |= ZombieFlag2.LetGo;
  }
  obj.condition = 0;
}

/**
 * The shared tail at `LAB_0045B55A`. `holder` is `iVar7`: the prop in sub 2,
 * the zombie itself in sub 4 — so the byte at `+0x121` the permit logic
 * reads and writes is the prop's `player` in one and the zombie's own
 * `attackPermit` in the other.
 */
function tail(obj: ZombieActor, host: GameHost,
              holder: { player: number }): void {
  const cue = obj.zom.targetCue;
  // `g_camera_eye_z` and `_x` by address (`0x0045B564`..`0x0045B57E`).
  TurnActorAwayFromPoint(obj, G.g_camera_eye,
                         cue < 0 ? CARRY_TURN_RATE : THROW_TURN_RATE,
                         1 / 60);
  if (obj.sub !== CarrySub.Dropped || cue >= 0) {
    if (!atLastFrame(obj)) return;
    obj.zom.targetLoops -= 1;
    if (obj.zom.targetLoops !== 0) return;
    if (cue < 0) {
      if (obj.zom.carryRelease !== RELEASE_AT_CAMERA) {
        // `[diverges]` The engine first tests `g_GameMode == 2 &&
        // DAT_009A2234 == 1` (`0x0045B624`) and, if both hold, replays the
        // wait clip instead. That is
        // Training, the word is one Training's own routines write, and no
        // bundle is exported in Training -- so the arm is not ported and the
        // step to the next entry is what every shipped stage takes.
        obj.sub -= 1;
        return;
      }
      const next = cursorScript(obj)?.entries[obj.zom.scriptPc];
      if ((next?.mode ?? 0) > 0) holder.player = ChooseCarryTarget(obj, host);
      const c = holder.player;
      if (c < 0 || (G.g_attack_permits[c] ?? -1) !== -1) {
        waitAnotherLoop(obj);
        holder.player = -1;
      } else {
        // The engine writes 1; the port's permits hold the claimant's `at`.
        G.g_attack_permits[c] = obj.at;
        obj.sub -= 1;
      }
      return;
    }
    if (entryAt(cursorScript(obj), obj.zom.scriptPc)) {
      obj.state = ZombieState.TargetMotionScript;
      obj.sub = 1;
      return;
    }
  }
  ZombieScriptEnded(obj);
}

/** `0x10F` for one more loop, and `obj+0x1320` follows whatever is playing. */
function waitAnotherLoop(obj: ZombieActor): void {
  if (obj.motion !== WAIT_MOTION) ActorSetMotionBlended(obj, WAIT_MOTION, 0, 10);
  obj.zom.targetLoops = 1;
  obj.zom.scriptMotion = obj.motion;
}

/**
 * The player a thrown prop is for, inline in `ZombieStateCarryProp`'s tail:
 * `g_active_player` with one player in play; with
 * two, whichever permit is free, and with both free the side of the screen
 * the carrier is on (`obj+0x70`, its view-space x).
 */
function ChooseCarryTarget(obj: ZombieActor, host: GameHost): number {
  if (G.g_players_in_play === 1) return G.g_active_player;
  if (G.g_players_in_play === 2) {
    if ((G.g_attack_permits[0] ?? -1) !== -1) return 1;
    if ((G.g_attack_permits[1] ?? -1) !== -1) return 0;
    const v = vec3();
    const x = host.viewSpaceOf(obj.at, v) ? v.x : 0;
    return x >= 0 ? 1 : 0;
  }
  return -1;
}
