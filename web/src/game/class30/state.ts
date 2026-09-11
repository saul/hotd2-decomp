/**
 * Class 0x30's tail — the words `EnemyZombieInit` (`FUN_00452DA0`) and its
 * thirty-odd states own in the actor struct.
 *
 * ## The same kind of thing as `HumanoidTail`, and for the same reason
 *
 * `ActorAllocSub` has 37 call sites and `EnemyZombieInit` is not one of them
 * [proved] — there is no side block. Class 0x30 writes the actor struct's tail
 * words directly, and so do classes 0x24, 0x25 and 0x31, so the aliasing
 * between them is **the engine's own design**: `obj+0x1334` genuinely holds
 * this class's back-off counter, class 0x25's cel index and class 0x31's arc
 * duration, in one word, because the engine reuses it.
 *
 * Every field below therefore keeps its `obj+0xNNNN` citation and names who
 * else reads that word. The union moves the *names* apart so one class cannot
 * read another's reading by accident; it does not pretend the addresses
 * differ.
 *
 * ## What this does **not** fix, and must not be read as fixing
 *
 * **`obj+0x1330` is class 0x30's general-purpose per-state dword** — 98
 * accesses across 24 routines — and three of its readings sit on this arm at
 * once: {@link ZombieTail.holdFrames}, {@link ZombieTail.throwDelay} and
 * {@link ZombieTail.corpseTimer}, beside a fourth, the shared arc's
 * `arcFrames`, which is in the head. Putting them all on one arm leaves them
 * aliasing each other exactly as much as before. Separating them
 * would need a second discriminant — the *state* — which would model the
 * port's safety rather than the engine's structure, and it is not attempted.
 * The aliases are documented on the fields instead. The same is true of
 * `obj+0x1334`, where {@link ZombieTail.backoffFrames} and the head's
 * `arcTotal` are one word, and of `obj+0x1358`, where
 * {@link ZombieTail.resumeSub} and the head's `allowance` are.
 *
 * ## What stays in the head, and why
 *
 * * **`rank` (`+0x131D`) and `queueRank` (`+0x131E`).** `RankEnemiesByDistance`
 *   (`FUN_004090B0`) stores both on **every** ranked entry unconditionally —
 *   the `charType == 0xB` test at `0x004090EB` gates only the reads that
 *   follow — so they are genuinely class-agnostic. `[proved]`
 * * **The shared arc record**: `+0x1330` as `arcFrames`, `+0x1334` as
 *   `arcTotal`, `+0x1360`, `+0x13C0` and `+0x13CC`. `ActorArcBegin`,
 *   `ActorArcBeginTo`, `ActorArcBeginToAtSpeed`, `ActorArcStep` and
 *   `ActorArcInterpolate` are called by classes 0x30 **and** 0x31, so those
 *   words belong to no single arm — `ZombieStateDeathKnockbackArc`
 *   (`FUN_004550E0`) reuses `arcTotal` as its own fall counter the moment the
 *   arc is spent, and that is one word under two names already.
 * * **`accX` (`+0x58`) and `accZ` (`+0x60`).** Two thirds of one acceleration
 *   vector whose middle word, `accY` (`+0x5C`), classes 0x10, 0x24 and 0x31
 *   all integrate, and `ClearCurrentActorVelocityAndAccel` (`FUN_0044E120`)
 *   clears all three for any actor. Splitting the triple across the arm and
 *   the head would be a lie about one field.
 * * **`cooldown` (`+0x133C`), `allowance` (`+0x1358`), `attack` (`+0x131A`),
 *   `walkDistance` (`desc+0x04`), `arcPhase`, `arcFrom`.** Class 0x31 reads
 *   each of them at the same address for the same purpose, and
 *   `render/debug.ts` reads two of them; a shared reading is not an alias.
 * * **`holdFrames` (`+0x1320`), which is class 0x24's, not this class's** —
 *   see {@link ZombieTail.holdFrames} for the reading that moved and why it
 *   is a different address.
 * * **The descriptor-sourced words** — `ringSet` (`+0x131F`), `emerge`,
 *   `delayedLeap`, `entry`, `script`, `targetAt` (`+0x1394`), `standThrow`,
 *   `cameraCue`. `DescriptorFromPlacement` (`game/descriptor.ts`) is a
 *   port-only, deliberately class-agnostic decoder that writes all of them as
 *   one `Partial<Actor>`, and every one of them would have to move at once,
 *   for all four classes, together with a split of that function. That is a
 *   job of its own; it is recorded here rather than half-done. `[open]`
 */
export interface ZombieTail {
  /**
   * `obj+0x1320` — the clip the captor script wants; the tail re-blends to it.
   *
   * `[proved]`: `ZombieStateTargetMotionScript` (`FUN_0045AAA0`) writes it at
   * `0x0045ADA9` (`MOV dword ptr [ESI + 0x1320], EDX`, `899620130000`) and at
   * `0x0045AEE1`, and reads it back at `0x0045B022`.
   *
   * The same word is class 0x24's `holdFrames` and class 0x25's
   * `hum.stallFrames` — both frame counters, where this is a motion id. One
   * word, three readings that do not convert.
   */
  scriptMotion: number;       // +0x1320, also class 0x24 / class 0x25
  /**
   * `obj+0x132C` — the state `ZombieStateHoldForCameraCue` runs on this
   * actor's behalf while it waits for its camera cue.
   *
   * The same word is class 0x25's `hum.turnMode`.
   */
  delegate: number;           // +0x132C, also class 0x25
  /**
   * `obj+0x1330` — **class 0x30's own hold countdown**, and *not* the
   * `holdFrames` that stays in the head.
   *
   * The head's `holdFrames` is `obj+0x1320`: `SetPieceStateHoldThenPlay`
   * counts class 0x24's hold there against `tail+0x0C`. Class 0x30 counts its
   * holds **sixteen bytes further on**, and the port had the two under one
   * name — a merge of two addresses that the union is what finally separates.
   *
   * `[proved]` at three routines: `ZombieStateEmerge` (`FUN_004584E0`) arms it
   * with the descriptor delay — `MOV dword ptr [ESI + 0x1330], EDX`,
   * `899630130000`, at `0x00458596` — and counts it down at
   * `0x004585BB`/`0x004585C4`; `ZombieStateRunInPlaceTimed` (`FUN_00457160`)
   * latches `tail+0x04` into it at `0x004571B0` and steps it at
   * `0x004571D6`/`0x004571E2`; and `ActorArcBeginFalling` (`FUN_0040A090`)
   * writes its solved frame count there for `ZombieStateDelayedLeap`.
   *
   * Aliases {@link throwDelay} and {@link corpseTimer} **within this class**,
   * and the head's `arcFrames` — see the note at the top of this file. Outside
   * it, class 0x24's `slideTimer` and class 0x25's `hum.bonePropMode`.
   *
   * **A trap, until class 0x24 grows its arm:** `obj.holdFrames` still
   * compiles on a zombie, because the head keeps a field of that name for
   * class 0x24. It is a different word and it is always zero here. A test
   * assertion read it that way the moment this field moved, and `tsc` could
   * not say so; `port.test.ts` now reads `zom.holdFrames` and says why.
   */
  holdFrames: number;         // +0x1330, aliases `throwDelay` and `arcFrames`
  /**
   * `obj+0x1330` — `ZombieStateStandAndThrow`'s idle countdown.
   *
   * A second name for the word above, kept apart because the two states
   * write it for different things and merging them would be a behaviour
   * change dressed up as a cleanup. This is rule 3 of the union: the
   * intra-class alias is documented, not papered over.
   */
  throwDelay: number;         // +0x1330, aliases `holdFrames` and `arcFrames`
  /**
   * `obj+0x1330` — how long the corpse lies there before it sinks, and then
   * how long it blinks out. `ZombieCorpseBegin` arms it with 0x78, two
   * seconds.
   *
   * A **third** name for the same word, and the third reason the note at the
   * top of this file says the arm does not fix the intra-class alias. It is on
   * the arm rather than left as the head's `slideTimer`, which is class 0x24's
   * name for `obj+0x1330`: three classes counting three different things in
   * one word had one port field between them, and reading class 0x24's
   * countdown off a zombie is exactly what the union exists to refuse.
   */
  corpseTimer: number;        // +0x1330, aliases `holdFrames` / `throwDelay`
  /**
   * `obj+0x1334` — frames spent retreating; `ZombieStateBackOff`
   * (`FUN_00455C30`) gives up past 0xF0 (`00455d29 8b8e34130000` /
   * `00455d32 41` — `MOV ECX,[ESI+0x1334]; INC ECX`), and
   * `ZombieStateDelayedLeap` (`FUN_004581A0`) arms it from `tail+0x04`.
   *
   * The same word is the head's `arcTotal` — which
   * `ZombieStateDeathKnockbackArc` (`FUN_004550E0`) turns into its own fall
   * counter once the arc is spent — and, outside this class, class 0x25's
   * `hum.bonePropFrame` and class 0x31's arc duration.
   */
  backoffFrames: number;      // +0x1334, aliases `arcTotal`
  /**
   * `obj+0x1338` — frames since this actor was last shoved out of another.
   *
   * `ZombiePushOutOfWorldAndActors` (`FUN_00454900`) counts it down and, 60
   * frames after a push, flips `obj+0x136C` bit 0x400000 — the direction
   * `ZombieStateBackOff` retreats in. **Not** the attack cooldown, which is
   * `obj+0x133C` and stays in the head because class 0x31 reads it too.
   *
   * The same word is class 0x31's `sinceLanding`.
   */
  shoveTimer: number;         // +0x1338, also class 0x31
  /**
   * `obj+0x1350` — the captor script's remaining loop count.
   *
   * The same word within this class is what `ZombieCorpseBegin` would stash
   * the spawn yaw in (`obj+0x1350 = obj+0x68`) and what
   * `ZombieStateDelayedLeap` (`FUN_004581A0`) leaves its landing frame in;
   * neither is ported, and `class30/death.ts` says why rather than writing a
   * heading into a field named for a loop count. `[open]`
   *
   * Outside the class the same word is class 0x31's `landSurface` and class
   * 0x25's `hum.turnTarget`.
   */
  targetLoops: number;        // +0x1350, also class 0x31 / class 0x25
  /**
   * `obj+0x1354` — the script entry's cue frame or mode, and, once
   * `ZombieStateTargetLostPause` is entered, the state to come back to.
   *
   * The same word is class 0x31's `arcKind` and class 0x25's `hum.turnStep`.
   */
  targetCue: number;          // +0x1354, also class 0x31 / class 0x25
  /**
   * `obj+0x1358` — the sub to come back to.
   *
   * Aliases the head's `allowance` **within this class**: `ZombieRingBandOf`
   * (`class30/ring.ts`) refreshes the queue-depth allowance in the same word
   * this parks a sub in, and the union does not separate them — see the note
   * at the top of this file. Outside it, class 0x25's `hum.pathMode`.
   */
  resumeSub: number;          // +0x1358, aliases `allowance`
  /**
   * `obj+0x1368` bit 0 — **the actor is allowed a cooldown**.
   *
   * `ZombieStateWaitForCameraFrame` (state 19) is the only thing in the class
   * that sets it (`00457731`, `OR AL, 0x1`), and it arms **once**:
   * `ZombieStateHoldAtRange` clears it again when the countdown expires
   * (`004557ff 24fe`). Three routines read it — `ZombieStateHoldAtRange`
   * (`004557dc a801`), `ZombieStateStrike` (`00455b24 f6866813000001`, which
   * skips the lunge while it is up) and `ZombieStateBackOff`
   * (`00455d96 f6866813000001`, which then leaves the head's `cooldown`
   * alone).
   *
   * A separate field and not a bit of `reactBone`, which is the same offset:
   * class 0x31 reads `obj+0x1368` as the bone that was hit, and that is the
   * polymorphism trap this arm makes unreachable rather than merely noted.
   *
   * [diverges] For class 0x30 the whole dword is a **flags word** and the port
   * models one bit of it as this boolean. The other six bits class 0x30
   * provably touches have no port:
   *
   * * `0x2` — entered water. `ActorCheckWaterEntry` sets it (0x00456998) and
   *   tests it (0x00456925); `EnemyZombieUpdate` reads it (0x00453486).
   * * `0x8` / `0x10` / `0x40` / `0x80` — kill-move death-clip selectors, read
   *   back by `ChooseDeathMotion` to pick the matching death.
   *   `ZombieStateTargetMotionScript` sets one per motion id, and **it is not
   *   the only writer**: `0x0045C0ED` is `OR EDX, 0x10` inside
   *   `ZombieStateDragTarget`'s sub 0, so a captor killed mid-drag is meant to
   *   take motion `0x1A5`. This note used to name one state; `functions.tsv`'s
   *   `ChooseDeathMotion` row names both.
   * * `0x20` — set by `EnemyZombieInitByCharType` for character types 9 and
   *   0x12 (0x00453180), tested by `FUN_004534A0` (0x00453665 `TEST CL, 0x20`)
   *   and `FUN_00453AE0` (0x00453B07). `[open]` what it selects.
   *
   * Making this a word is a job of its own; the gap is recorded rather than
   * half-fixed. The arm is what splits it from `reactBone`.
   */
  hasCooldown: boolean;       // +0x1368 bit 0, also class 0x31 `reactBone`
  /**
   * `obj+0x1370` — how close `ZombieStateWalkToTarget` has to get, and what
   * `ZombieStateWalkDistance` latches the descriptor's `desc+0x04` into.
   */
  targetArrive: number;       // +0x1370
  /**
   * `obj+0x1374` — how far `ZombieStateWalkDistance` has come from
   * `arcFrom`. The engine writes it every frame and never reads it back.
   *
   * `ZombieStateDelayedLeap` (`FUN_004581A0`) puts its destination in
   * `obj+0x1374..0x137C`, so this word is a landing x for that state — one
   * more intra-class alias, and one the port does not have because it keeps
   * that destination in the descriptor's `delayedLeap` instead.
   */
  walkTravelled: number;      // +0x1374
  /**
   * `obj+0x1398` — the cursor into the captor script's entry list.
   *
   * The engine keeps a pointer; an index is the same edge without the address,
   * and it survives a snapshot. Shared by every state in the family, which is
   * how `ZombieStateWalkToTarget` can hand `ZombieStateTargetMotionScript` a
   * half-walked list.
   *
   * **A pointer says which list as well as how far in**, and that half is
   * {@link scriptBlob}. Without it the cursor was re-aimed from `obj.state`
   * on every read, so a captor that arrived and entered state 35 went back to
   * the blob it had already finished instead of the one the walk left it in.
   */
  scriptPc: number;           // +0x1398
  /**
   * Which of the descriptor tail's two script blobs {@link scriptPc} indexes:
   * 0 is `+0x04`, 1 is `+0x08`. The other half of `obj+0x1398`.
   *
   * `ZombieScriptForState` (`FUN_0045CA10`) is called only where the engine
   * writes that pointer — `ZombieScriptEnded`, and each scripted state's
   * entry sub — and never on the steps in between, which read the pointer
   * back. Deriving it from the state instead is a test moved across a
   * function boundary, and it moved the answer with it.
   */
  scriptBlob: number;         // +0x1398, which blob the pointer is in
  /**
   * `obj+0x135C` — the bone the current throw leaves from, 5 or 8, and an
   * engine field after all: the port had it uncited.
   *
   * `[proved]`: `ZombieStateStandAndThrow` (`FUN_00459080`) stores
   * `ZombiePickThrowingHand`'s return there — `MOV dword ptr [ESI + 0x135c],
   * EAX`, bytes `89865c130000`, at `0x00459270` — and its **next sub** reads
   * it back for `ZombieThrowHandWeapon` (`MOV ECX, dword ptr [ESI + 0x135c]`,
   * `8b8e5c130000`, `0x004592CF`), so the choice outlives the frame it was
   * made on. Character type 1 picks a second hand and stores that too, at
   * `0x004592FB`.
   *
   * The same word is class 0x25's `hum.pathSlot`.
   */
  throwHand: number;          // +0x135C, also class 0x25
}

/**
 * A tail for a freshly spawned zombie.
 *
 * [port-only] The engine allocates nothing here and **zeroes nothing**:
 * `ActorClearGameFields` (`FUN_004A73D0`) clears `obj+0x34` to the end of the
 * block at *allocation*, so a reused heap block starts with whatever its
 * previous occupant left in the tail, and each state's sub 0 writes the words
 * it is about to read. That works in the exe and is not something the port
 * should imitate — a snapshot has to fully determine the next frame — so the
 * port zeroes. This is the same zeroing the flat struct did before the arm
 * existed, moved rather than introduced: nothing changed behaviourally.
 */
export function makeZombieTail(): ZombieTail {
  return {
    scriptMotion: 0,
    delegate: 0,
    holdFrames: 0,
    throwDelay: 0,
    corpseTimer: 0,
    backoffFrames: 0,
    shoveTimer: 0,
    targetLoops: 0,
    targetCue: 0,
    resumeSub: 0,
    hasCooldown: false,
    targetArrive: 0,
    walkTravelled: 0,
    scriptPc: 0,
    scriptBlob: 0,
    throwHand: 0,
  };
}
