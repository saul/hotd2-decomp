/**
 * `ActorPlayHitVoice` — `FUN_0040A6F0`. Every voice an actor has.
 *
 * One routine, five kinds, twenty-three call sites, and it was living in two
 * halves: `render/shooting.ts` had kinds 0, 1 and 2 because the shot path
 * needed them, and nothing had kind 3 at all — which is why a zombie swung
 * without a sound.
 *
 * `[diverges]` **It is still in two halves, and the renderer's copy says so
 * too.** Consolidating it here is not a matter of calling this from there:
 * `verify_layers.py`'s `render-drives-the-port` refuses `render/` to call an
 * engine function, and it is right — the engine plays those three kinds from
 * `ActorShotFeedback` (`FUN_00454050`) and `FUN_00453EB0`, both `game/` code,
 * and `combat/feedback.ts` is already the port of the first. The move belongs
 * there, it needs the kind each of those three call sites passes, and it puts
 * the pick on the world generator and so into the snapshot. That is its own
 * commit. This module is what the *engine's* callers use, and today that is
 * the attack cry.
 *
 * ## The two voice sets
 *
 * The routine opens on a switch over the character type at `obj+0x1F4` and
 * keeps one bit out of it: types 0, 2, 5, 6, 9, 0x0E, 0x0F, 0x10 and 0x11 take
 * **set A** and every other type takes **set B**. Every kind below then picks
 * its id out of the set the actor belongs to.
 *
 * ## The kinds
 *
 * | kind | what it plays |
 * |---|---|
 * | 0 | one of five impacts by `rand() % 5`, then the set's *hurt* voice |
 * | 1 | the same five impacts, then the set's *killed* voice |
 * | 2 | a coin flip between two head impacts, then the set's *head* voice |
 * | 3 | a coin flip **within** the set's own pair — and nothing else |
 * | 4 | one id per set, from `0x005A4EA8` |
 *
 * Kind 3 is the odd one twice over: it is the only kind that plays a single
 * sound rather than an impact plus a voice, and the only one whose table entry
 * is a *pair per set* rather than one id per set. **It is the attack cry**:
 * `ZombieStateStrike` (`FUN_00455A40`) calls it on the frame it starts the
 * strike clip, and `ZombieStateStandAndThrow` (`FUN_00459080`) on the frame it
 * throws.
 *
 * `[open]` **Kind 4 is not ported**, because nothing here has read what calls
 * it with 4 or what `g_actor_voice_kind4` (`0x005A4EA8`) names. Anything but
 * 0..4 reaches the routine's shared tail with the id still 0 and plays
 * nothing, which is what an unported kind does here too.
 *
 * `[open]` The reporter also asked for an **idle** voice, and this routine has
 * no kind that is one: all five fire on an event. Whatever groans a standing
 * zombie makes is a different mechanism and has not been found.
 */
/**
 * What the routine actually reads off the object: the character type at
 * `obj+0x1F4`, and nothing else.
 *
 * The engine takes the whole actor. Naming the one field it touches is what
 * lets the shot path call this without looking an actor up by address —
 * `shot.resolved` already carries `charType`, and an `Actor` satisfies this
 * shape structurally, so every `game/` caller still passes the object the
 * engine passes.
 */
export interface VoiceActor {
  /** `obj+0x1F4`. */
  charType: number;
}
import type { Rng } from "../../core/rng";

/**
 * Where the sound goes — `PlaySoundId` (`FUN_0041CFD0`), by whatever route the
 * caller has to it.
 *
 * A callback rather than an `Events`, because the two callers reach the mixer
 * differently and neither should have to grow the other's seam: `game/` raises
 * a `sound.play` event, and `render/shooting.ts` already holds a `playSound`
 * of its own for the shot path.
 */
export type PlaySound = (id: number) => void;
import { T } from "../tables";

/**
 * The `param_2` the engine passes, and the numbers are its own.
 *
 * An enum because the engine switches on it — see the skill's rule — and
 * because a bare `3` at a call site is exactly how the attack cry went missing:
 * nothing named it, so nothing noticed nothing played it.
 */
export enum ActorVoice {
  /** Hurt, and survived. */
  Hurt = 0,
  /** Killed by a body shot. */
  Killed = 1,
  /** Killed by a head shot. */
  HeadKilled = 2,
  /** The cry that opens a strike or a throw. */
  Attack = 3,
  /** `[open]` — unported; see the note on this module. */
  Kind4 = 4,
}

/** `switch (obj+0x1F4)` at `0x0040A6F5`: which set the character type takes. */
function voiceSetOf(charType: number): 0 | 1 {
  const a = T.chars?.combat?.voice_set_a_types ?? [];
  return a.includes(charType) ? 0 : 1;
}

/**
 * `ActorPlayHitVoice` — `FUN_0040A6F0`.
 *
 * `rng` is the engine's `rand()`, and every draw here is one of its calls in
 * the engine's own order: the impact first, then the voice.
 */
export function ActorPlayHitVoice(obj: VoiceActor, kind: ActorVoice, rng: Rng,
                                  emit: PlaySound): void {
  const c = T.chars?.combat;
  if (!c) return;
  const set = voiceSetOf(obj.charType);
  const play = (id: number | undefined) => { if (id) emit(id); };
  const pick = <U>(xs: readonly U[] | undefined): U | undefined =>
    xs?.length ? xs[rng.int(xs.length)] : undefined;

  switch (kind) {
    case ActorVoice.Hurt:
    case ActorVoice.Killed: {
      // `rand() % 5` over the same five impacts for both, then the kind's own
      // voice out of the set.
      play(pick(c.impact)?.id);
      const v = kind === ActorVoice.Hurt ? c.voice.hurt : c.voice.kill;
      play(v?.[set]?.id);
      return;
    }
    case ActorVoice.HeadKilled:
      // `rand() & 1` between two head impacts -- the engine writes the two ids
      // as literals, `0x516A9` and `0x116A9`, rather than reading a table.
      play(pick(c.head_impact)?.id);
      play(c.voice.head?.[set]?.id);
      return;
    case ActorVoice.Attack:
      // The one kind that plays a single sound, out of a pair that belongs to
      // the set. A bundle written before this was read carries no `attack`,
      // and then the swing stays silent rather than throwing.
      play(pick(c.voice.attack?.[set])?.id);
      return;
    default:
      // `[open]` kind 4, and every value the engine's switch does not name:
      // both reach its tail with the id still zero.
      return;
  }
}
