/**
 * Class 0x46's object, apart from the class module so `actor.ts` can name it
 * without importing the class.
 *
 * `PlaceBats` (`FUN_0042D9C0`) is a **placer**: every path through it ends in
 * `ActorKill`, and what it leaves behind is one or more `0x13D8`-byte actors
 * of character type `0x1E` = `zabat.bin`. The offsets below are those actors',
 * and unlike class 0x43's they are a **combat actor's** — a skeleton, a motion
 * block, clip `0x407` — so the fields sit in the same struct every zombie
 * uses. Only the ones this class writes are here.
 *
 * The bat is settled by both of the binary's name tables at once: character
 * type `0x1E` is `zabat.bin` and the wing's `0x1F` is `zabat_wing.bin`, and
 * every death plays `COMMON2\KOUMORI1_22.wav` or `KOUMORI2_22.wav` — *kōmori*.
 */

/**
 * `obj+0x1374` — which of the three flights this bat belongs to, from the
 * opcode-0x09 descriptor's `+0x25` by way of the placer's `obj+0x130C`.
 *
 * The sub-type picks the update outright, the way class 0x26's does: the three
 * are separate routines rather than three arms of one, and they disagree about
 * the hit gate, the gravity, the exit and whether the enemy counters move at
 * all.
 */
export enum BatSubtype {
  /**
   * `BatDiveUpdate` (`FUN_0042E230`). One bat per descriptor, flying a
   * scripted spline and then homing on the camera. 24 of the game's 27
   * descriptors, in four flights of six.
   */
  Dive = 0,
  /**
   * `BatScatterUpdate` (`FUN_0042E9D0`). Twenty-five bats that burst away from
   * the placer, accelerating, and are gone. **Touches neither enemy counter.**
   * One descriptor: stage 3 block 2 step 4.
   */
  Scatter = 1,
  /**
   * `BatSwarmUpdate` (`FUN_0042ED50`). Eight bats, or ten with two players,
   * that orbit the placer and then peel off at the camera one at a time. Two
   * descriptors: stage 3 block 2 step 4 and stage 4 block 7 step 3.
   */
  Swarm = 2,
}

/**
 * `obj+0x1376` — the state, and all three sub-types share the numbering.
 *
 * What each one *means* differs: {@link BatState.Wait} is a launch delay for
 * {@link BatSubtype.Dive} and {@link BatSubtype.Scatter} and the **orbit** for
 * {@link BatSubtype.Swarm}, which is why the hit gate is not the same in all
 * three.
 */
export enum BatState {
  /** Waiting out `obj+0x13D0`, or — for the swarm — circling while it runs. */
  Wait = 0,
  /** Flying: the spline and the homing run, the scatter, the swarm's dive. */
  Fly = 1,
  /** Shot. Falling, spinning, and counting out. */
  Dead = 2,
}

/**
 * The class-0x46 fields of the actor, by their `obj+` offsets.
 *
 * Everything here is a word the three updates read or write. The names are the
 * port's; the offsets are the engine's and are what a reader checks against
 * Ghidra.
 */
export interface BatTail {
  /** `obj+0x1374` — see {@link BatSubtype}. */
  subtype: BatSubtype;
  /**
   * `obj+0x1375` — the **flight group**, `0`..`3`, from the descriptor's
   * `+0x24` by way of the placer's `obj+0x1F4`. Written by
   * {@link BatSubtype.Dive} alone; it is half the index into
   * `g_bat_spline_points`.
   */
  group: number;
  /** `obj+0x1376`. */
  state: BatState;
  /**
   * `obj+0x1377` — the member index. For {@link BatSubtype.Dive} it is the
   * descriptor's `+0x11C - 1`; for the other two it is the loop counter.
   */
  member: number;
  /**
   * `obj+0x13D0` — the countdown {@link BatState.Wait} runs on. Seeded
   * `member * 20` for the dive, `member * 2` for the scatter and
   * `60 + member * 20` for the swarm, so a flight leaves one at a time.
   */
  timer: number;
  /** `obj+0x13CC` — which of the spline's two segments is running. */
  segment: number;
  /** `obj+0x13D4` — that segment's parameter, `0`..`1` at `0.05` a frame. */
  segT: number;
  /**
   * `obj+0x13A4` — the homing lerp's parameter, `0`..`1`.
   *
   * The swarm's {@link BatState.Wait} borrows the same word for its orbit
   * **radius**, which is `12 + 5·sin` and never near 1, and overwrites it with
   * 0 on the way into {@link BatState.Fly}. Two readings of one word inside
   * one class: `L3` in miniature, and the reason this comment is here.
   */
  t: number;
  /**
   * `obj+0x13A8` — the sideways wobble's amplitude. 1.0 until the homing
   * parameter passes 0.8, then `(1 - t) * 5` so it damps to nothing exactly as
   * the bat arrives.
   */
  wobble: number;
  /**
   * `obj+0x130C/0x1310/0x1314` — the point the homing lerp starts from, and
   * for the swarm the centre it orbits. Latched at the end of the spline.
   */
  fromX: number; fromY: number; fromZ: number;
  /**
   * `obj+0x1318/0x131C/0x1320` — velocity. The scatter flies on it and every
   * corpse falls on it; the dive and the swarm never touch it while alive, so
   * their corpses drop from a standstill.
   */
  vx: number; vy: number; vz: number;
  /** `obj+0x1348/0x1350` — last frame's x and z, for the heading. */
  prevX: number; prevZ: number;
  /**
   * `obj+0x1380` — the wobble's phase while flying, and the corpse's frame
   * counter afterwards. One word, two uses, and the death resets it to 0.
   */
  phase: number;
  /** `obj+0x135C` — the swarm's orbit angle, BAMS. */
  orbitPhase: number;
  /** `obj+0x1360` — the swarm's radius phase, wound by a random step. */
  radiusPhase: number;
  /**
   * `[port-only]` — this actor is the **wing**, not the bat.
   *
   * The engine tells them apart by which update `ActorAlloc` was given:
   * `SpawnBatWings` (`FUN_0042E060`) installs `BatWingUpdate`
   * (`FUN_0042F660`) and the three flight routines are installed by
   * `PlaceBats`. The port has one handler per class id, so the discriminator
   * has to be a field. It is not a divergence in behaviour — the two paths
   * below are the two routines — only in how they are reached.
   */
  isWing: boolean;
}

/** [port-only] `ActorClearGameFields` zeroes the object; this is that zero. */
export function makeBatTail(): BatTail {
  return {
    subtype: BatSubtype.Dive, group: 0, state: BatState.Wait, member: 0,
    timer: 0, segment: 0, segT: 0, t: 0, wobble: 0,
    fromX: 0, fromY: 0, fromZ: 0,
    vx: 0, vy: 0, vz: 0,
    prevX: 0, prevZ: 0,
    phase: 0, orbitPhase: 0, radiusPhase: 0,
    isWing: false,
  };
}

/**
 * The descriptor bytes the bundle carries for a class-0x46 spawn.
 *
 * Three numbers and no more, because that is all a class-0x46 descriptor says:
 * the whole flight path is in the EXE.
 */
export interface BatDescriptor {
  /** `desc+0x25` — see {@link BatSubtype}. */
  subtype: number;
  /** `desc+0x24` — the flight group, `0`..`3`. */
  group: number;
  /** `desc+0x22 - 1` — the member index. */
  member: number;
}
