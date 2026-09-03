/**
 * Class 0x31's tail — the words `EnemyThrowerInit` (`FUN_00449620`) and its
 * state machine own in the actor struct.
 *
 * ## The same kind of thing as `HumanoidTail`, and not `CivilianState`
 *
 * `CivilianState` models an `ActorAllocSub(0xC4)` block the engine *allocates*
 * and hangs off a pointer at `obj+0x1310`, so its offsets are the block's own
 * and it is genuinely absent until `CivilianInit` runs.
 *
 * Class 0x31 has no such block: `ActorAllocSub` has 37 call sites and
 * `EnemyThrowerInit` is not one of them [proved]. This class writes the actor
 * struct's tail words directly, exactly as classes 0x24, 0x25 and 0x30 do, so
 * the aliasing between them is **real, and the engine's own design**:
 * `obj+0x1350` genuinely holds the surface under a thrower's landing point and
 * a captor script's remaining loop count, in the same word, because the engine
 * reuses it. The arm is therefore **not** nullable — spelling it like `civ`
 * would invent an absent state the engine does not have.
 *
 * Every field below keeps its `obj+0xNNNN` citation and names who else uses
 * that word. The discriminated union moves the *names* apart so one class
 * cannot read another's reading by accident; it does not pretend the addresses
 * differ.
 *
 * ## What it does not hold, and why
 *
 * Four groups of class-0x31-adjacent words stay on `ActorBase`, and each is a
 * claim the arm would have made falsely:
 *
 * * **`rank` (`+0x131D`) and `queueRank` (`+0x131E`).**
 *   `RankEnemiesByDistance` (`FUN_004090B0`) stores both on **every** ranked
 *   entry unconditionally; the `charType == 0xB` test gates only the reads
 *   that follow. Class-agnostic. `[proved]`
 * * **The shared arc record** — `arcFrames` (`+0x1330`), `arcTotal`
 *   (`+0x1334`), `arcPhase` (`+0x1360`), `arcFrom` (`+0x13C0`) and `arcTo`
 *   (`+0x13CC`), plus the port's `arcScript`. `ActorArcBegin`,
 *   `ActorArcBeginTo`, `ActorArcBeginToAtSpeed`, `ActorArcStep`,
 *   `ActorArcInterpolate` and `InstallArcMotionScript` are driven by classes
 *   0x30 **and** 0x31 — `class30/entrance.ts` and `class30/knockback.ts`
 *   import them out of `class31/arc.ts` — so those words belong to no arm.
 * * **`descFlags` (`+0x1316`).** `SpawnFromDescriptor` (`FUN_00408A20`) copies
 *   the descriptor's `+0x20` word there for **every** class before the class's
 *   `Init` runs, and `DescriptorFromPlacement` seeds it the same way; class
 *   0x30 has 76 shipped spawns that set it. Same argument as `rank`.
 * * **Everything a second class reads under its own name** — `cooldown`
 *   (`+0x133C`), `allowance` (`+0x1358`), `slideTimer` (`+0x1330`), `attack`,
 *   `walkDistance` (`desc+0x04`), `flags2` (`+0x136C`), `alpha` (`+0x138C`),
 *   `struck`, and the descriptor-decoded tails (`leap`, `path`, `grab`,
 *   `pounce`, `cue`, `entranceMotion`, `backAwayDelay`, `leapStrikeFrames`,
 *   `standThrow`) that the class-agnostic `DescriptorFromPlacement` writes.
 *
 * And one thing the arm provably **cannot** fix: `obj+0x1350`'s overlay is
 * *inside* class 0x31 as well. It is the landing surface in states 2 and 33
 * and the throw's cue frame elsewhere — one address, two readings, both this
 * class's. {@link ThrowerTail.landSurface} documents it; a `cls` discriminant
 * separates nothing there, and giving the two readings one name would hide it.
 */
import type { ListCursor } from "../actor";

export interface ThrowerTail {
  /**
   * `obj+0x1394` — which leg of the walked route the spawn is on. The engine
   * keeps a cursor there.
   *
   * A {@link ListCursor}: `ThrowerStatePathFollow` (`FUN_0044EE00`) walks a
   * pointer over the descriptor's 0x10-byte waypoint records. Same offset as
   * `Actor.targetAt`, which is classes 0x2D and 0x30's **parent actor**, and
   * as class 0x25's `pc` — three readings, one word.
   */
  pathLeg: ListCursor;      // +0x1394, also `targetAt` / class 0x25 `pc`
  /**
   * `obj+0x1330` in sub 1: the delay before the first leg.
   *
   * The same word is the shared arc record's `arcFrames`, which stays on the
   * head, and class 0x24's `slideTimer` and class 0x25's `bonePropMode`. The
   * path follow and an arc never run at once.
   */
  pathDelay: number;        // +0x1330, also `arcFrames` / class 0x24 / 0x25
  /**
   * `obj+0x1364` — the stance row the current attack was drawn against.
   *
   * The same word is class 0x25's `boneDecoration` (`op 12`) and the
   * class-0x30 attack stance row, which the port does not read yet.
   */
  stance: number;           // +0x1364, also class 0x25 / class 0x30
  /**
   * `obj+0x135C` — the distance band `ThrowerPickNextState` last committed to.
   *
   * The same word is class 0x25's `pathSlot`, and it is the word `arcPhase`
   * (`+0x1360`) sits beside rather than in.
   */
  moveBand: number;         // +0x135C, also class 0x25 `pathSlot`
  /**
   * `obj+0x1338` — frames since a leap landed.
   *
   * The same word is class 0x30's `shoveTimer`, which
   * `ZombiePushOutOfWorldAndActors` (`FUN_00454900`) counts down 60 frames
   * after a push. Class 0x31 never reads it that way, and class 0x30 never
   * reads this one.
   */
  sinceLanding: number;     // +0x1338, also class 0x30 `shoveTimer`
  /** `obj+0x1368` — the bone that was hit. Class 0x31 alone reads it that way. */
  reactBone: number;        // +0x1368
  /** `obj+0x1328` — re-entries into the knockdown; two caps the arc. */
  knockCount: number;       // +0x1328, also class 0x25 `turnFrames`
  /**
   * `obj+0x1350` — the surface under the landing point. `0x5A` kills.
   *
   * **Doubly used inside class 0x31 itself**, which is the one overlay no
   * `cls` test can separate — the union moves this name away from class 0x30's
   * `targetLoops` and class 0x25's `turnTarget`, and leaves the intra-class
   * pair exactly as it was. `ThrowerStateFallAndLand` (`FUN_0044A450`) and
   * `ThrowerStateKnockedTumbling` (`FUN_00450E40`) write `g_coli_hit_surface`
   * here and compare it against `0x5A`, while `ThrowerStateThrow`
   * (`FUN_0044FAF0`) writes the constant `0x19`
   * (`c7865013000019000000`, eight sites at 0x0044FBE1..0x0044FC58) and later
   * compares the clip cursor `obj+0x19C` against it —
   * `MOV ECX, [ESI+0x19c]` / `MOV EAX, [ESI+0x1350]` / `CMP ECX, EAX`
   * (`8b8e9c010000` / `8b8650130000` / `3bc8`) at 0x0044FC9B, a **frame
   * number**, not a surface. `[proved]`
   *
   * The two never overlap in time — a thrower is either falling or throwing —
   * and the port stores only the surface reading: the throw's release frame is
   * returned by `ThrowerThrowCue` instead, from the entry for three character
   * types and from the constant `0x19` for 0x18. Read sites name which reading
   * they mean; see `throwCueFrame` in `class31/thrower.ts`.
   */
  landSurface: number;      // +0x1350, also class 0x30 `targetLoops`
  /** `obj+0x1388` — the height a fall began at, and a flag while it is set. */
  fallFromY: number;        // +0x1388
  /**
   * `obj+0x1354` — the axis gravity pulls along. See `ThrowerArcKind`.
   *
   * The same word is class 0x30's `targetCue` and class 0x25's `turnStep`.
   */
  arcKind: number;          // +0x1354, also class 0x30 `targetCue`
  /**
   * `obj+0x133C` is the cooldown; this is the frame the corpse is pinned to.
   *
   * `ThrowerStateCorpseSink` (`FUN_0044A9D0`) and `ThrowerStateCorpseBlink`
   * (`FUN_0044AB70`) rewrite the play cursor to it every frame, which is why a
   * corpse holds one chosen frame of its death clip instead of finishing it.
   */
  corpseFrame: number;      // +0x194, pinned
  /** `ThrowerStateBlinkInThreeHops`' two counters. */
  hopsLeft: number;         // +0x1348
  hopFrames: number;        // +0x1344
  /**
   * `obj+0x1384` — how far character type 0x18's weapons have grown back,
   * `0` to `1` at `0.025` a drawn frame.
   *
   * A field of its own, and not `hopFrames`: `ThrowerStateRestoreBothHands`
   * (`FUN_0044F900`) zeroes **`+0x1384`** (`c7868413000000000000` at
   * 0x0044F99C) and raises `ThrowerFlag.Regrowing`
   * (`81c900000008` at 0x0044F9A6), and `ThrowerDrawBonePart` (`FUN_00449F90`)
   * is what advances it — `FLD [EDI+0x1384]` (`d98784130000`),
   * `FADD [0x004C4CB0]` = `cdcccc3c` = **0.025f**, `FST [EDI+0x1384]`, then
   * `FCOMP [0x004C4380]` = `0000803f` = **1.0f**, and on passing it writes
   * `1.0f` back and clears the flag (`81e1fffffff7`) at
   * 0x0044A14A..0x0044A179. `[proved]`
   *
   * The port used to keep this on `hopFrames` (`+0x1344`), which is
   * `ThrowerStateBlinkInThreeHops`' hop dwell. States 30 and 34 cannot run at
   * once so it never bit, but it was the wrong address.
   */
  handRegrow: number;       // +0x1384
}

/**
 * A tail for a freshly spawned thrower.
 *
 * [port-only] The engine allocates nothing here and **zeroes nothing**:
 * `ActorClearGameFields` (`FUN_004A73D0`) clears `obj+0x34` to the end of the
 * block at *allocation*, so a reused heap block starts with whatever its
 * previous occupant left in the tail, and each state's sub 0 writes the words
 * it is about to read. That works in the exe and is not something the port
 * should imitate — a snapshot has to fully determine the next frame — so the
 * port zeroes. This is the same zeroing the flat struct did before the arm
 * existed, moved rather than introduced: `corpseFrame` keeps its `-1`, which
 * is "no pose chosen" and not a frame, and nothing else changed.
 */
export function makeThrowerTail(): ThrowerTail {
  return {
    pathLeg: 0,
    pathDelay: 0,
    stance: 0,
    moveBand: 0,
    sinceLanding: 0,
    reactBone: 0,
    knockCount: 0,
    landSurface: 0,
    fallFromY: 0,
    arcKind: 0,
    corpseFrame: -1,
    hopsLeft: 0,
    hopFrames: 0,
    handRegrow: 0,
  };
}
