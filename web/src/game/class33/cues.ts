/**
 * Class 0x33 sub-handlers **6, 7, 10 and 11** -- the four that draw nothing.
 *
 * ```
 * ScriptedSpriteEffectOnce33     FUN_00433E30   6: one sprite, then gone
 * ScriptedSoundCues33            FUN_00433E90   7: a list of sounds on cues
 * ScriptedSoundAndFlagAtCue33    FUN_00433F40   10: a sound and a flag on a cue
 * ScriptedEndingTrackSelect33    FUN_00434260   11: ENDL or ENDS by score rank
 * ```
 *
 * `ScriptedSceneryDispatch33` (`FUN_00432FF0`) installs them from the jump
 * table at `0x004330C4`, entries 5, 6, 9 and 10 (`0x0043305F`, `0x0043306D`,
 * `0x00433097`, `0x004330A5`), each with the `ActorClaimHitSlot` every arm
 * ends in. Each routine's address appears in the image once, in its own
 * arm's `MOV dword ptr [EAX], imm32`, so nothing else installs any of them.
 *
 * ## The cue record
 *
 * Selectors 7, 9 and 10 read the same 8-byte record off the descriptor tail
 * (`obj+0x1390`), with the same test:
 *
 * ```
 * +0x00  s16  mode   0: a frame count, 1: a camera frame, else never
 * +0x02  s16  frame  (MOVSX)
 * +0x04  u32  sound  -- 7 and 10 only
 * +0x08  s16  flag   -- 10 only, and on 7 the next record's mode
 * ```
 *
 * Mode 0 fires on the frame `++obj+0x1330` equals `frame` -- a count of the
 * frames the object has spent on mode-0 records, which nothing resets between
 * records -- and mode 1 on the frame `g_cam_path_frame` (`0x009A6110`) equals
 * it. Both are integer equalities. Any other mode is never true, so a record
 * carrying one is where the routine stops for good: it is how selector 7's
 * list ends.
 *
 * The test is inline in each routine, and the three copies are the same
 * eleven instructions with only the registers changed (`L86`):
 * `0x00433ED6`..`0x00433F01` in 7, `0x00433F86`..`0x00433FB1` in 10 and
 * `0x00434208`..`0x00434237` in 9. Each port routine has its own copy, as the
 * exe does.
 *
 * ## What is spawned
 *
 * `[proved]` by a census of every spawn opcode in all eleven `evt/` files:
 * selector 7 once, stage 5 block 2 step 2 (`0x1E7C`), whose four records are
 * `CAR_SRIP_22` at camera frames 505, 760 and 820 and `BRAKE_22` at 990, all
 * `STAGE5_SE` -- the tyres and the brakes of the carrier
 * (`ScriptedCarrierUpdate33`, `FUN_004331D0`) the next op spawns, whose own
 * cue is camera frame 650. The two share no state: only selector 1's arm
 * writes `g_carrier_object`. Selector 11 three times, all `endevtbl.bin`
 * (scene 9) blocks 0..2 step 1, one descriptor `0x4A0` -- the ending, which no
 * stage bundle carries. Selectors 6 and 10 each have one descriptor in the
 * files, `st4evtbl.bin 0xEC8` and `st5evtbl.bin 0xA38`, and no pointer to
 * either from any opcode; their tails agree with the readings here (kind
 * `0x44`, face 0, player -1; mode 1, frame 380, `DOORKICK1_22`, flag 3).
 */
import { ActorDespawn } from "../despawn";
import { PlaySoundId } from "../class45/rand";
import { ScoreRankForPlayer } from "../combat/score";
import { SpawnSpriteEffect } from "../effects/sprite";
import { G } from "../globals";
import type { ScriptedSceneryActor } from "../actor";
import type { ClassFrame } from "../registry";
import { vec3 } from "../vec";

/**
 * The cue record's `+0x00` modes, `CMP word ptr [EDI], 0x0` / `0x1`. Any
 * other value is a record that never fires.
 */
export enum Class33CueMode {
  /** `++obj+0x1330 == frame`. */
  FrameCount = 0,
  /** `g_cam_path_frame == frame`. */
  CameraFrame = 1,
}

/**
 * `PUSH 0x1000000C` at `0x004342A8` and `PUSH 0x1000000D` at `0x004342C1`:
 * BGM 12 and 13 through `PlaySoundId` (`FUN_0041CFD0`)'s namespace 1, which
 * are `ENDL` and `ENDS` in both of its tables (`_AR` in one).
 */
export const SND_BGM_ENDL = 0x1000000c;
export const SND_BGM_ENDS = 0x1000000d;

/** The rank `TEST EAX, EAX` asks for: the best, a score of 80000 or more. */
const ENDING_RANK_ENDL = 0;

/**
 * `ScriptedSpriteEffectOnce33` — `FUN_00433E30`. Selector 6, one frame long.
 *
 * ```
 * 00433E38  params = {obj+0x40, +0x44, +0x48, obj+0x64, +0x68, +0x6C}
 * 00433E68  MOV ECX,[EAX+0x14]; MOV EDX,[EAX+0x10]; MOV EAX,[EAX+0xC]
 * 00433E79  CALL SpawnSpriteEffect(&params, kind, face, player)
 * 00433E7F  CALL ActorDespawn(obj)
 * ```
 *
 * The sprite is thrown from the object's own position with its own pitch and
 * yaw -- `params[3]` and `params[4]`; `params[5]`, the roll, is copied and
 * read by nothing -- and kind, face-camera mode and player come from the tail
 * at `+0x0C`, `+0x10` and `+0x14`. The tail's first three words are not read.
 */
export function ScriptedSpriteEffectOnce33(obj: ScriptedSceneryActor,
                                           f: ClassFrame): void {
  const t = obj.class33Sub;
  if (t?.selector !== 6) return;
  SpawnSpriteEffect(vec3(obj.pos.x, obj.pos.y, obj.pos.z), obj.pitch, obj.yaw,
                    t.kind, t.face, t.player, f.host, f.events);
  ActorDespawn(obj);
}

/**
 * `ScriptedSoundCues33` — `FUN_00433E90`. Selector 7: play each record's
 * sound on its cue, in order.
 *
 * `obj+0x1312` 0 seeds -- `obj+0x1330 = 0`, the first record's frame and
 * sound into `obj+0x1350`/`obj+0x1354`, which nothing reads -- stores 1 and
 * falls into 1 (`0x00433ECF` runs on into `0x00433ED6`); 2 and up return.
 *
 * On a cue it plays the record's sound and moves the tail pointer on by one
 * record (`ADD ECX, 0x8` at `0x00433F15`). Then `CMP word ptr [EDI], -0x1` at
 * `0x00433F1E` asks whether the record **just played** was a terminator --
 * `EDI` still holds the old pointer -- and it cannot have been, since only
 * modes 0 and 1 reach the call. So the despawn at `0x00433F30` never runs,
 * and the list ends by parking on its first record whose mode is neither 0
 * nor 1. Transcribed as written.
 *
 * ## What takes the object away: the end of the scene `[proved]`
 *
 * Nothing else can. A task leaves the task list three ways, and only three:
 *
 * * `ActorKill` (`FUN_004A7040`), which takes no argument and unlinks the
 *   **current** task (`MOV EAX,[0x007DF8B0]` at `0x004A7040`) -- so only an
 *   object's own routine can end it, directly or through `ActorDespawn`
 *   (`FUN_00409CC0`), which ends in it. Every one of its callers is a
 *   routine killing the object it is running; selector 7's never reaches its
 *   own.
 * * `TaskListBuild` (`FUN_004A6F50`), which tears the previous list down
 *   through `0x004A7120` before building the next -- thirteen callers, every
 *   one a phase start: `LoadSceneAndReset` (`FUN_00460030`, the next stage and
 *   the attract demo), the game-over screen's phases, the title,
 *   the options, the ending. `0x004A7120`'s only callers are
 *   `TaskListBuild` and itself.
 * * `ArenaReset` (`FUN_004A7310`), which turns the heap the tasks live in
 *   back into one free block, from the same phase starts.
 *
 * No routine walks the list and unlinks another object. So the object stands,
 * parked, holding the hit slot `ScriptedSceneryDispatch33` claimed for it,
 * until the stage ends, the game is over or the player quits -- and it plays
 * a record whenever **any** camera path publishes that record's frame: stage
 * 5's path 207 ends at frame 600 in block 2, so the 760, 820 and 990 records
 * wait for the paths of the blocks after it. The port's pool keeps it the
 * same way (`ActorDespawn` is the only way out of `G.g_object_list` short of
 * the scene reset), and a seek that rebuilds it carries its cursor
 * ({@link ScriptedSoundCues33FollowReplayCamera}).
 */
export function ScriptedSoundCues33(obj: ScriptedSceneryActor,
                                    f: ClassFrame): void {
  const t = obj.class33Sub;
  if (t?.selector !== 7) return;
  const s = obj.scenery;
  // `[port-only]` The bundle stops the list at the record the routine parks
  // on, so the cursor never passes its end; this is the shape of an empty one.
  const rec = t.cues[s.cue];
  if (!rec) return;
  if (obj.sub === 0) {
    s.frames = 0;
    s.seedFrame = rec.frame;
    // Read by nothing; a list that is only its parking record carries no
    // sound word in the bundle.
    s.seedSound = rec.sound ?? 0;
    obj.sub = 1;
  } else if (obj.sub !== 1) {
    return;
  }
  // `0x00433ED6`: the counter steps only while the record is mode 0.
  let hit = false;
  if (rec.mode === Class33CueMode.FrameCount) {
    s.frames += 1;
    hit = s.frames === rec.frame;
  }
  if (!hit && !(rec.mode === Class33CueMode.CameraFrame
                && G.g_cam_path_frame === rec.frame)) return;
  // Only a mode-0 or mode-1 record reaches here, and the bundle gives every
  // one of those its sound (`tools/repo/port.ts` holds it to that).
  PlaySoundId(rec.sound ?? 0, f.events);
  s.cue += 1;
  if (rec.mode !== -1) {
    obj.sub = 1;
    return;
  }
  ActorDespawn(obj);
}

/**
 * `[port-only]` -- selector 7's half of `ClassHandler.followReplayCamera`:
 * the records a replay's camera has run the object past.
 *
 * A seek walks the script and carries the camera from frame to frame without
 * publishing the frames between, and the spawn list rebuilds the object at the
 * landing with its `Init` -- with the cursor at the first record, where the
 * engine's object has played every mode-1 record whose frame some path
 * published while it stood. So each time the replay shows the camera, the
 * frames since the last showing are taken as played -- on the same path, the
 * ones after the frame last seen; on a new path (or the same one started
 * again), the ones from the shot's start -- and each record whose frame is
 * among them, in order, is passed. The first showing is the spawn
 * instruction's own: the object runs from the next frame, so only frames
 * after it count. A mode-0 record counts the object's own frames, which a
 * replay does not have; the walk stops at one, and no shipped list carries
 * one (`[proved]`: stage 5's `0x1E7C` is four mode-1 records and the
 * terminator, the only selector-7 spawn in the game).
 */
export function ScriptedSoundCues33FollowReplayCamera(
    cues: readonly { mode: number; frame: number }[],
    cam: { slot: number; startFrame: number; frame: number },
    state: Record<string, number>): void {
  if (state.slot === undefined) {
    state.cue = 0;
    state.slot = cam.slot;
    state.frame = cam.frame;
    return;
  }
  let lower = cam.slot === state.slot && cam.frame >= state.frame
    ? state.frame + 1 : cam.startFrame;
  for (let rec = cues[state.cue]; rec; rec = cues[state.cue]) {
    if (rec.mode !== Class33CueMode.CameraFrame) break;
    if (rec.frame < lower || rec.frame > cam.frame) break;
    state.cue += 1;
    lower = rec.frame + 1;
  }
  state.slot = cam.slot;
  state.frame = cam.frame;
}

/**
 * `[port-only]` -- selector 7's half of `ClassHandler.resumeFromReplay`: the
 * rebuilt object stands on the record the replay ran it to, seeded as its
 * first frame seeded it (`obj+0x1350`/`+0x1354` from the **first** record,
 * `obj+0x1312 = 1`), and its next update tests that record.
 */
export function ScriptedSoundCues33ResumeFromReplay(
    obj: ScriptedSceneryActor, state: Readonly<Record<string, number>>): void {
  const t = obj.class33Sub;
  if (t?.selector !== 7 || !state.cue) return;
  const s = obj.scenery;
  s.frames = 0;
  s.seedFrame = t.cues[0]?.frame ?? 0;
  s.seedSound = t.cues[0]?.sound ?? 0;
  obj.sub = 1;
  s.cue = state.cue;
}

/**
 * `ScriptedSoundAndFlagAtCue33` — `FUN_00433F40`. Selector 10: selector 7's
 * seed and test on one record, then the sound, a script flag and a despawn.
 *
 * `MOVSX ECX, word ptr [EDI+0x8]` / `MOV byte ptr [ECX+0x9C7200], 0x1` at
 * `0x00433FBC` -- `g_script_flags[flag] = 1`, the index used raw.
 */
export function ScriptedSoundAndFlagAtCue33(obj: ScriptedSceneryActor,
                                            f: ClassFrame): void {
  const t = obj.class33Sub;
  if (t?.selector !== 10) return;
  const s = obj.scenery;
  if (obj.sub === 0) {
    s.frames = 0;
    s.seedFrame = t.frame;
    s.seedSound = t.sound;
    obj.sub = 1;
  } else if (obj.sub !== 1) {
    return;
  }
  // `0x00433F86`, the same test as selector 7's.
  let hit = false;
  if (t.mode === Class33CueMode.FrameCount) {
    s.frames += 1;
    hit = s.frames === t.frame;
  }
  if (!hit && !(t.mode === Class33CueMode.CameraFrame
                && G.g_cam_path_frame === t.frame)) return;
  PlaySoundId(t.sound, f.events);
  G.g_script_flags[t.flag] = 1;
  ActorDespawn(obj);
}

/**
 * `ScriptedEndingTrackSelect33` — `FUN_00434260`. Selector 11, one frame:
 * `ENDL` if a player in play has rank 0, `ENDS` otherwise, then a despawn.
 *
 * ```
 * 00434260  CMP word [g_players_in_play], 2 / JNZ one
 *           ScoreRankForPlayer(0, 2) == 0 -> ENDL
 *           ScoreRankForPlayer(1, 2) == 0 -> ENDL
 * 0043428A  one: CMP word [g_players_in_play], 1 / JNZ ENDS
 *           ScoreRankForPlayer(g_active_player, 1) != 0 -> ENDS
 * 004342A8  ENDL: PlaySoundId(0x1000000C); ActorDespawn
 * 004342C1  ENDS: PlaySoundId(0x1000000D); ActorDespawn
 * ```
 *
 * Two players who both miss rank 0 fall through to the one-player test, which
 * fails, and get `ENDS`; so does a count that is neither 1 nor 2. It writes no
 * flag and no branch: the ending scene plays the same, to one track or the
 * other.
 */
export function ScriptedEndingTrackSelect33(obj: ScriptedSceneryActor,
                                            f: ClassFrame): void {
  if (G.g_players_in_play === 2) {
    if (ScoreRankForPlayer(0, 2) === ENDING_RANK_ENDL
        || ScoreRankForPlayer(1, 2) === ENDING_RANK_ENDL) {
      PlaySoundId(SND_BGM_ENDL, f.events);
      ActorDespawn(obj);
      return;
    }
  }
  if (G.g_players_in_play === 1
      && ScoreRankForPlayer(G.g_active_player, 1) === ENDING_RANK_ENDL) {
    PlaySoundId(SND_BGM_ENDL, f.events);
    ActorDespawn(obj);
    return;
  }
  PlaySoundId(SND_BGM_ENDS, f.events);
  ActorDespawn(obj);
}
