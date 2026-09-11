/**
 * `ActorPlayHitVoice` — `FUN_0040A6F0`. Every voice an actor has.
 *
 * One routine, five kinds, twenty-three call sites — and for a while it was
 * implemented twice: `render/shooting.ts` had kinds 0, 1 and 2 because the shot
 * path needed them, and nothing had kind 3 at all, which is why a zombie swung
 * without a sound.
 *
 * **There is one copy, and it is this one.** The renderer's went when the shot
 * kinds moved to `combat/feedback.ts`, which is where the engine plays them
 * from — `ZombieOnShot` (`FUN_00453EB0`) and `ThrowerOnShot` (`FUN_004499A0`)
 * are `game/` code, and `verify_layers.py`'s `render-drives-the-port` refuses
 * `render/` to call an engine function, rightly. Three things came with that
 * move and each is written up where it landed: the kind is the **hit-result
 * code** and not `killed`/`head` (`feedback.ts`), the pick is the world's
 * seeded `rand()` and so is in the snapshot (`L10`), and the bursting head's
 * kind 3 at `0x00454136` stopped being silent.
 *
 * Every caller is now `game/`: `combat/feedback.ts` for kinds 0, 1, 2 and the
 * burst's 3, `class30/strike.ts` and `class30/stand_throw.ts` for the cry.
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
 * ## Kind 4 is dead, and that is now settled
 *
 * `[proved]` **Nothing in the image calls this routine with 4, and kind 4's
 * ids are zero.** Both halves were `[open]` and both have been read:
 *
 * * the census. All twenty-three call sites push a literal: kind 0 at
 *   `0x0045402D`, `0x00449D11`, `0x00452608` and `0x00451A03`; kind 1 at
 *   `0x0045264E`, `0x00449A8B` and `0x00451AF0`; kind 2 at `0x00449A7E`;
 *   `0x00453F7A` is 2 on hit result 2 and 1 otherwise; and thirteen kind-3
 *   sites. (Two of them pass it in a register — `0x00451A03` and `0x00451AF0`,
 *   inside `RescueTargetHeldState` — and the decompilation of that function is
 *   what says which constant each holds.) **No site passes 4.**
 * * the ids. `g_actor_voice_kind4` (`0x005A4EA8`) and the dword after it are
 *   zero in the shipped `.data`, and the only two references to either
 *   anywhere are the reads at `0x0040A849` and `0x0040A852` in this routine.
 *   The nearest thing that *could* write them is the `{key, actor}` scratch
 *   buffer `SortCameraCandidates` (`FUN_00408F30`) and
 *   `SortEnemiesByDistance` (`FUN_00409190`) share at `0x005A4E38`, whose 14
 *   entries end at `0x005A4EA7` — one dword short — and both feeders are
 *   capped at 14. So it cannot overflow into them either. **(L6: that check
 *   is the adjacent-array trap asked the other way round.)**
 *
 * So kind 4 reaches `PlaySoundId(0)`, which is the dispatcher's "no sound"
 * early-out. Porting it is porting silence, and the enum member below stays
 * only to say so.
 *
 * ## The idle noise is not here, and it has been found
 *
 * `[proved]` This routine has no idle kind — all five fire on an event — and
 * the standing zombie's groan is a different mechanism entirely: a bare
 * `PlaySoundId(0x1917A9)` (`COMMON2\ZOMBIE_041_16.wav`) in
 * `ZombieStateHoldAtRange` (`FUN_00455720`) at `0x004558D6`, on the frame the
 * in-range idle clip starts. There is a second, genuinely ambient one as well
 * — the looping chainsaw and laser sword that character types 2 and 3 take a
 * share in at init. `class30/hold.ts` and `class30/weapon_loop.ts` are the
 * two transcriptions.
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
 * A callback rather than an `Events`, which was originally because the two
 * callers reached the mixer differently. Every caller is `game/` now and every
 * one of them passes the same `sound.play` emit, so the indirection has one
 * job left and it is a real one: it keeps the routine callable from
 * `test/port.test.ts` with a list to push into, which is how the five kinds
 * are asserted.
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
  /**
   * `[proved]` **Dead.** No call site in the image passes 4 and both of its
   * ids are zero, so the engine's own arm plays `PlaySoundId(0)` — nothing.
   * Kept as a member because the engine's `switch` names the case, and
   * deleting it would leave the next reader to work the proof out again.
   */
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
  // A table this routine has nothing to read is silence, not a throw — the
  // same terms as the missing `attack` pair below, and for the same reason:
  // every id here comes out of the bundle, and a bundle older than the read
  // that put it there has no row to offer.
  if (!c?.voice) return;
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
      // Kind 4, and every value the engine's switch does not name, reach its
      // tail with the id still zero -- and `PlaySoundId(0)` early-outs. The
      // engine does make the call; not making it here is the same silence.
      return;
  }
}
