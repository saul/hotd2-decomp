/**
 * Which sounds a stage will ask for, read off the stage's own data before it
 * runs -- so the loading screen can fetch and decode them, and the first play
 * of each is not a download.
 *
 * `[port-only]`. The engine needs nothing like it: `PlaySoundId` opens a WAV
 * off the local disc and reads its first three seconds synchronously, so its
 * music and voices start on the frame they are called. The page fetches a
 * file over the network and decodes it first -- 13 MB of PCM for stage 1's
 * track -- and played that way the music and the dialogue land late, Safari
 * worst of all.
 *
 * **What the data names, and nothing else.** Five places carry a sound id or a
 * dialogue group as a value:
 *
 * * the evt script: `se_play`, `se_play_unless_skip` and `se_play_3d`'s
 *   `sound`, and `bgm_entry_play`'s `track` -- which is where every stage's
 *   music starts (`script/ops/sound.ts`);
 * * the evt script's `play_dialogue` groups;
 * * class 0x10's civilian streams -- the ones this stage's spawns can reach:
 *   op `0x1D` plays a dialogue group as the script does, and ops `0x21` and
 *   `0x22` queue sound ids;
 * * class 0x25's programs: op 13 plays a dword id.
 *
 * A dialogue group is all three of its variants -- one player, either one, or
 * both -- because which one plays is `g_active_player` at the moment, and a
 * second player can join between the load and the line.
 *
 * What it does **not** know: the sounds the gameplay code raises itself, by
 * constant or out of a class's table -- the gunshot, the reload, a zombie's
 * groan, a boss's lines (`EvtOpPlayDialogue2D` from classes 0x14, 0x22 and
 * 0x45). Those still load on first play. They are short effects and a few
 * boss lines, and the list here would have to be kept in step with 205 emit
 * sites by hand to include them.
 */
import type { ScriptJson } from "../bundle";

/** The script ops whose `sound` is an id `PlaySoundId` takes. */
const SOUND_OPS = new Set(["se_play", "se_play_unless_skip", "se_play_3d"]);
/** Class 0x10's op that plays a dialogue group (`CivilianOp.PlayDialogue`). */
const CIVILIAN_PLAY_DIALOGUE = 0x1d;
/** ...and the two that queue sound ids (`QueueSound`, `QueueSoundList`). */
const CIVILIAN_QUEUE_SOUND = 0x21;
const CIVILIAN_QUEUE_SOUND_LIST = 0x22;
/** Class 0x25's `HumanoidOp.PlaySound`: the id is `a` low, `b` high. */
const HUMANOID_PLAY_SOUND = 13;

/**
 * Every sound id the stage's data can play, in the order the script first
 * names it -- so the opening track and the first lines are fetched first.
 */
export function stageSoundIds(script: ScriptJson): number[] {
  const ids = new Set<number>();
  const messages = script.sound?.messages ?? {};
  const add = (id: number | undefined) => {
    if (id !== undefined && id !== 0) ids.add(id >>> 0);
  };
  const dialogue = (group: number) => {
    for (const v of messages[String(group)] ?? []) add(v?.voice);
  };

  for (const block of script.blocks) {
    for (const step of block.steps ?? []) {
      for (const op of step.ops) {
        if (SOUND_OPS.has(op.name)) add(op.sound);
        else if (op.name === "bgm_entry_play") add(op.track);
        else if (op.name === "play_dialogue" && op.message_group !== undefined) {
          dialogue(op.message_group);
        }
      }
    }
  }

  // The bundle carries the exe's whole table of civilian streams, 136 of
  // them; only the ones this stage's spawns start, and the ones those point
  // at by operand (`scripts`), can run here.
  const civ = script.civilians;
  const reached = new Set<number>();
  const visit = (i: number | undefined) => {
    if (i === undefined || i < 0 || reached.has(i) || !civ?.scripts[i]) return;
    reached.add(i);
    for (const c of civ.scripts[i]) for (const j of c.scripts ?? []) visit(j);
  };
  for (const sp of Object.values(civ?.spawns ?? {})) visit(civ?.entries[sp.script]);
  for (const i of reached) {
    for (const c of civ!.scripts[i]) {
      if (c.op === CIVILIAN_PLAY_DIALOGUE) dialogue(c.args[0]);
      else if (c.op === CIVILIAN_QUEUE_SOUND) add(c.args[0]);
      else if (c.op === CIVILIAN_QUEUE_SOUND_LIST) {
        for (const s of c.sounds ?? []) add(s[0]);
      }
    }
  }

  for (const prog of Object.values(script.humanoids ?? {})) {
    for (const c of prog.cmds) {
      if (c.op === HUMANOID_PLAY_SOUND) add((c.a & 0xffff) | (c.b << 16));
    }
  }
  return [...ids];
}
