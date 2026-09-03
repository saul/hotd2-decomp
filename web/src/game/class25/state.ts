/**
 * Class 0x25's tail — the words `ScriptedHumanoidInit` (`FUN_004840D0`) and
 * its VM own in the actor struct.
 *
 * ## This is not the same kind of thing as `CivilianState`
 *
 * `CivilianState` models an `ActorAllocSub(0xC4)` block, which the engine
 * *allocates* and hangs off a pointer at `obj+0x1310` — so its offsets are the
 * block's own, `+0x00` upward, and two classes holding blocks of different
 * shapes at one pointer field alias nothing.
 *
 * Class 0x25 has no such block. `ActorAllocSub` has 37 call sites and
 * `ScriptedHumanoidInit` is not one of them [proved] — this class writes the
 * actor struct's tail words directly, and so do classes 0x24, 0x30 and 0x31.
 * The aliasing between them is therefore **real, and the engine's own design**:
 * `obj+0x1330` genuinely holds a hand-prop selector for this class and a slide
 * countdown for class 0x24, in the same word, because the engine reuses it.
 *
 * That is why every field below keeps its `obj+0xNNNN` citation and names who
 * else uses the word. The discriminated union moves the *names* apart so one
 * class cannot read another's reading by accident; it does not pretend the
 * addresses differ, and a comment here that dropped the alias would throw away
 * the thing that makes this readable next to Ghidra.
 *
 * ## What it does not hold
 *
 * `obj+0x1368` and `obj+0x136C` are **not** here. `ScriptedHumanoidInit`
 * zeroes them and nothing in class 0x25 reads them — and an Init that zeroes a
 * range is not evidence of ownership.
 */
import type { Vec3 } from "../vec";
import type { ListCursor } from "../actor";

/** `op 11`'s mode, `obj+0x1358`. Modes above 2 write nothing at all. */
export enum HumanoidPath {
  /** Not riding a path. */
  None = 0,
  /** Position only. */
  Position = 1,
  /** Position and the path's own orientation. */
  PositionAndOrient = 2,
}

export interface HumanoidTail {
  /**
   * `obj+0x1394` — the command cursor. `-1` has left the VM, and
   * `ScriptedHumanoidIdle` (`FUN_00484D40`) is what runs from then on.
   *
   * A {@link ListCursor}. The engine keeps a **pointer** here — `MOV dword ptr
   * [EDI + 0x1394], ESI` (`89b794130000`) at `0x00484A9C`, with `ESI` stepped
   * by 8 or 16 bytes per command — so an index is the port's shape for the
   * same cursor. Class 0x31 keeps a descriptor pointer in the same word and
   * class 0x2D a parent actor: three readings, one address.
   */
  pc: ListCursor;             // +0x1394, also class 0x31 `pathLeg`
  /**
   * `obj+0x1320` — frames a wait has been stalled for, counting **up**, reset
   * by the routine that reads it. Tested against a command's `a`.
   *
   * Named `stallFrames` rather than the shared `holdFrames` it used to be:
   * class 0x24 counts a hold in the same word against `tail+0x0C`, and class
   * 0x30 aliases it as `scriptMotion`, which is a motion id and not a counter
   * at all. One word, three readings that do not convert.
   */
  stallFrames: number;        // +0x1320, also class 0x24 / class 0x30
  /** `obj+0x132C` — the turn's mode. 3 is a no-op, not "none". */
  turnMode: number;           // +0x132C
  /** `obj+0x1328` — frames left of the turn. */
  turnFrames: number;         // +0x1328
  /** `obj+0x1354` — signed BAMS per frame. */
  turnStep: number;           // +0x1354
  /** `obj+0x1350` — absolute BAMS, unmasked. */
  turnTarget: number;         // +0x1350
  /** `obj+0x1358` — `op 11`'s mode. */
  pathMode: HumanoidPath;     // +0x1358
  /** `obj+0x135C` — which object path. */
  pathSlot: number;           // +0x135C
  /**
   * `obj+0x1360` — an **index into a 24-byte record table**, not an offset
   * along the path: `g_class25_path_offsets` — `0x00596B18`. Zero means none.
   *
   * `[proved]`: `MOV EAX,[EDI+0x1360]; CMP EAX,EBX; JZ; LEA EAX,[EAX+EAX*0x2];
   * LEA EBP,[EAX*0x8 + 0x596b18]` (`8d0440`, `8d2cc5186b5900`) at
   * `0x00484B77`–`0x00484B89`.
   */
  pathOffsetRecord: number;   // +0x1360
  /**
   * `obj+0x1330` — `op 14`, and it **is** a draw mode: which of the
   * character's hand props the per-bone hook draws.
   *
   * `[proved]`: the reader is `ScriptedHumanoidBoneDrawHook` (`FUN_00485260`),
   * the callback `ScriptedHumanoidInit` installs at `obj+0x12EC` — `MOV EAX,
   * dword ptr [ESI + 0x1330]; CMP EAX,0x2; JNZ` (`8b8630130000`, `83f802`) at
   * `0x0048535F`, and `CMP EAX,0x1` at `0x004854F9`. `ScriptedHumanoidDraw`
   * (`FUN_00484FF0`) never reads it, which had been taken to mean nothing did.
   *
   * The same word is class 0x24's `slideTimer` and class 0x31's `arcFrames`.
   */
  bonePropMode: number;       // +0x1330, also class 0x24 / class 0x31
  /**
   * `obj+0x1334` — the frame counter `ScriptedHumanoidBoneDrawHook` increments
   * once per drawn frame, indexing the 13-entry cel tables as `n % 13`:
   * `g_class25_bone_prop_cels` — `0x00596C80` for `bonePropMode` 2,
   * `g_class25_bone_prop_cels_alt` — `0x00596C90` for 1.
   *
   * `[proved]`: `MOV EAX,[ESI+0x1334]; INC EAX; MOV [ESI+0x1334],EAX`
   * (`8b8634130000`, `40`, `898634130000`) at `0x0048549B`/`0x004854A4` and
   * again at `0x004854DD`/`0x004854E9`. Kept because the exe keeps it on the
   * actor and the VM writes it (`op 14` mode 2 zeroes it); drawing the prop is
   * the renderer's and is not ported.
   *
   * The same word is class 0x30's `backoffFrames` and class 0x31's `arcTotal`.
   */
  bonePropFrame: number;      // +0x1334, also class 0x30 / class 0x31
  /**
   * `obj+0x1364` — `op 12`: a **persistent** toggle, not the one-shot effect
   * the port used to call it. Mode 1 sets it, mode 0 clears it, any other mode
   * leaves it alone.
   *
   * `[proved]`: `MOV dword ptr [EDI + 0x1364], 0x1` (`c7876413000001000000`)
   * at `0x004848BE` and `MOV dword ptr [EDI + 0x1364], EBX` (`899f64130000`,
   * `EBX = 0`) at `0x004848DE`. Read every frame by
   * `ScriptedHumanoidBoneDrawHook` at `0x00485287` — so it decorates **bone
   * 2** for as long as it is set. `FUN_00485BA0` and `FUN_00485D70` are
   * `[open]`.
   *
   * `op 12` is used **zero** times in shipped data, so this is modelled and
   * inert. It is kept because the VM writes it and a snapshot must carry it.
   *
   * The same word is the class-0x30 / class-0x31 attack stance row.
   */
  boneDecoration: number;     // +0x1364, also class 0x30 / class 0x31
  /**
   * `obj+0x13C0`/`+0x13C4`/`+0x13C8` — where the actor was last frame.
   *
   * The same three words are the start point of the shared arc record that
   * `ActorArcBeginTo` (`FUN_0044DC70`) lays down and `ActorArcInterpolate`
   * (`FUN_0044DD00`) reads, for classes 0x30 and 0x31 — which is why this
   * cannot be read as "the arc's origin" for every class.
   */
  prevPos: Vec3;              // +0x13C0, also the shared arc record's start
}

/**
 * A tail for a freshly spawned humanoid. `pc` starts at the first command.
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
export function makeHumanoidTail(): HumanoidTail {
  return {
    pc: 0,
    stallFrames: 0,
    turnMode: 0,
    turnFrames: 0,
    turnStep: 0,
    turnTarget: 0,
    pathMode: HumanoidPath.None,
    pathSlot: 0,
    pathOffsetRecord: 0,
    bonePropMode: 0,
    bonePropFrame: 0,
    boneDecoration: 0,
    prevPos: { x: 0, y: 0, z: 0 },
  };
}
