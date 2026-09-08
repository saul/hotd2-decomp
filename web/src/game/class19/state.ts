/**
 * Class 0x19's state block — the 0xA4 bytes `Boss4Init` (`FUN_004917E0`)
 * allocates and hangs off `obj+0x1310`.
 *
 * Every routine in this class reaches it through one global,
 * `0x007DD0AC`, which `Boss4Update` (`FUN_004919D0`) republishes at the top of
 * each frame beside three more — `0x009A26A0` (the actor), `0x007DD0B0`
 * (`obj+0x40`, its transform) and `0x007DD0A8` (`obj+0x194`, its model block).
 * **The port has no such globals and does not want them**: there is one of
 * these actors in the game at a time, but a global that is only correct while
 * one particular update is running is a global two agents will read at the
 * wrong moment. The block is a field on the actor instead, the way class
 * 0x10's `CivilianState` is, and every routine takes it as an argument.
 *
 * Offsets are the engine's, so the block can be read next to Ghidra. The names
 * are what each field is *used* as by the routines that have been read; the
 * ones nothing read has touched are named `unk` and marked `[open]` rather
 * than guessed at.
 */
/**
 * `g_class19_states` — `0x00597298`. Twenty-four entries, dispatched by
 * `Boss4Update` (`FUN_004919D0`) on the byte at `state+0x04`:
 * `CALL dword ptr [EAX*0x4 + 0x597298]` at `0x00491A26`.
 *
 * Entries 0 and 2 are the same routine and entries 1 and 3 are another; each
 * pair tells itself apart by reading the state index back. That is why the
 * four are named for what they do rather than numbered.
 */
export enum Boss4State {
  /** `Boss4StateEntranceCarried` (`FUN_004938B0`), riding the transport. */
  EntranceCarriedWait = 0,
  /** `Boss4StateEntranceDropped` (`FUN_00493B40`), the second arena's. */
  EntranceDroppedWait = 1,
  /** `Boss4StateEntranceCarried` (`FUN_004938B0`), already on the ground. */
  EntranceCarriedPlaced = 2,
  /** `Boss4StateEntranceDropped` (`FUN_00493B40`), already on the ground. */
  EntranceDroppedPlaced = 3,
  /** `Boss4StateApproachCamera` (`FUN_00493DC0`). */
  ApproachCamera = 4,
  /** `Boss4StateChooseAction` (`FUN_00494010`). */
  ChooseAction = 5,
  /** `Boss4StateHoldThenApproach` (`FUN_004943B0`). */
  HoldThenApproach = 6,
  /**
   * `Boss4StateWaitForCameraInRange` (`FUN_004944A0`) — the state the
   * entrance hands over to on the frame it raises `g_script_flags[31]`, and
   * the state every flinch comes back to.
   */
  WaitForCameraInRange = 7,
  /** `Boss4StateRiseThenIdle` (`FUN_004945A0`). */
  RiseThenIdle = 8,
  /** `Boss4StateTurnToStoredPoint` (`FUN_00494610`). */
  TurnToStoredPoint = 9,
  /** `Boss4StateLookAtCamera` (`FUN_00494730`). */
  LookAtCamera = 0x0a,
  /** `Boss4StateWalkToPoint` (`FUN_004958F0`). */
  WalkToPoint = 0x0b,
  /** `Boss4StateWithdrawAndAdvancePhase` (`FUN_00495A20`). */
  WithdrawAndAdvancePhase = 0x0c,
  /** `Boss4StateWaitForPlayer` (`FUN_00495D30`). */
  WaitForPlayer = 0x0d,
  /** `Boss4StateHoldUntilPlayerFree` (`FUN_00495D90`). */
  HoldUntilPlayerFree = 0x0e,
  /** `Boss4StateStrikeClip65` (`FUN_00494A80`). */
  StrikeClip65 = 0x0f,
  /** `Boss4StateStrikeClip7A` (`FUN_00494B80`). */
  StrikeClip7A = 0x10,
  /** `Boss4StateStrikeClip7B` (`FUN_00494C70`). */
  StrikeClip7B = 0x11,
  /** `Boss4StatePinPlayer` (`FUN_00494D60`). */
  PinPlayer = 0x12,
  /** `Boss4StateChargePastCamera` (`FUN_00495070`). */
  ChargePastCamera = 0x13,
  /** `Boss4StateFlinch` (`FUN_00495340`), the low head hit. */
  Flinch = 0x14,
  /** `Boss4StateKnockDown` (`FUN_00495570`), the high head hit. */
  KnockDown = 0x15,
  /** `Boss4StateDeath` (`FUN_00495770`), and `g_script_flags[32]`. */
  Death = 0x16,
  /** `Boss4StateDebugFreeMove` (`FUN_00495E20`). No shipped path reaches it. */
  DebugFreeMove = 0x17,
}

/**
 * The bits of the state block's own flag word at `state+0x00`.
 *
 * Not `obj+0x34`: this class carries two flag words and they mean different
 * things. Only the bits routines that have been read touch are named.
 */
export enum Boss4Flag {
  /**
   * Bit 0 — **riding the transport**. `Boss4Init` sets it when the entrance
   * index is 0 or 1 and latches `g_civilian_carrier` beside it; the entrance's
   * sub 1 clears it on the frame the boss drops off.
   */
  OnCarrier = 0x01,
  /**
   * Bit 1 — **placed**: the two- or three-leg walk that puts the actor where
   * its phase wants it has finished. `Boss4AdvancePhaseWhenWalkDone`
   * (`FUN_00492350`) raises it and `Boss4Update` runs the four spline steps
   * behind `0x00491A5B` only while it is up.
   */
  Placed = 0x02,
  /**
   * Bit 3 — **at a waypoint**, and the gate on
   * `Boss4AdvanceArenaWaypoint` (`FUN_004928D0`) at `0x004928DA`.
   */
  AtWaypoint = 0x08,
  /** Bit 4 — raised by the entrance and by `Boss4StateWalkToPoint`. `[open]` */
  Bit4 = 0x10,
  /** Bit 5 — `Boss4EndPlacementWalk` (`FUN_004922C0`)'s gate. */
  PlacementWalk = 0x20,
  /** Bit 6 — `Boss4AdvancePhaseWhenWalkDone` (`FUN_00492350`)'s gate. */
  PhaseWalk = 0x40,
}

/**
 * `g_boss4_phase_hp_fraction` — `0x00570490`. Nine floats, then the same nine
 * again for the second arena, indexed by the phase at `state+0x08`.
 *
 * `Boss4StateEntranceCarried` and `Boss4AdvancePhaseWhenWalkDone` both compute
 * `state+0x24 = obj+0x11E * g_boss4_phase_hp_fraction[phase]`
 * (`FMUL float ptr [EDX*0x4 + 0x570490]` at `0x00493AD0`), and
 * `Boss4ResolveShot` raises `obj+0x34` bit `0x100` — which refuses every
 * further shot — the moment the hit points reach that floor. **So the boss
 * cannot be taken below one ninth of its bar per phase**, and the phases are
 * advanced by the arena progression, not by damage.
 *
 * Read out of `.rdata` as `3b8e633f 761c473f b0aa2a3f eb380e3f 4c8ee33e
 * c1aaaa3e 6d8e633e b08ee33d 00000000`, twice.
 */
export const BOSS4_PHASE_HP_FRACTION: readonly number[] = [
  0.8888889, 0.7777778, 0.6666667, 0.5555556, 0.44444445,
  0.33333334, 0.22222222, 0.11111111, 0,
  0.8888889, 0.7777778, 0.6666667, 0.5555556, 0.44444445,
  0.33333334, 0.22222222, 0.11111111, 0,
];

/**
 * `g_boss4_head_damage` — `0x005704D7`, indexed
 * `g_players_in_play + rank * 2` (`MOVSX ECX, byte ptr [EDX + ECX*0x2 +
 * 0x5704D7]` at `0x00491E01`, with `EDX` the player count and `ECX` the byte
 * at `state+0x0B`).
 *
 * Two players do less damage each, which is what the interleaving is for: the
 * pairs run 26/22, 24/20, 23/19 … 9/13 down the ranks. Read as
 * `001a1618 14171316 12151114 10130f12 0e110d10 0c0f0b0f 0b0e0a0e 0a0d090d`.
 */
export const BOSS4_HEAD_DAMAGE: readonly number[] = [
  0, 26, 22, 24, 20, 23, 19, 22, 18, 21, 17, 20, 16, 19, 15, 18,
  14, 17, 13, 16, 12, 15, 11, 15, 11, 14, 10, 14, 10, 13, 9, 13,
];

/**
 * `g_boss_shot_damage_cap` — `0x0055E1B4`, 33.0f
 * (`FCOM float ptr [0x0055e1b4]` at `0x00491E5B`).
 */
export const BOSS4_SHOT_DAMAGE_CAP = 33;

/**
 * The damage a hit that is **not** on the head does, when its surface code is
 * `0x3D`: `FLD float ptr [0x004c4380]` at `0x00491E2B`, and that address holds
 * `0000803f`.
 */
export const BOSS4_BODY_DAMAGE = 1;

/**
 * The bone `Boss4ResolveShot` treats as the weak point — `CMP EBX, 0x2` at
 * `0x00491DCE`, against the byte at `obj+0x190 + shooter`.
 *
 * Node 2 of `boss4.bin`'s fifteen, offset `(-0.0029, 10.292, 0.0075)` from the
 * root: the topmost. Every other bone is a spark and no hit points.
 */
export const BOSS4_WEAK_BONE = 2;

/**
 * The surface code that makes a hit anywhere count — `CMP EAX, 0x3D` at
 * `0x00491D5E` against the per-shooter hit record's `+0x0C`.
 *
 * `0x35` is the code that is explicitly nothing at all (`CMP EAX, 0x35` at
 * `0x00491D86`); everything else raises a spark and no damage.
 */
export const BOSS4_SOFT_SURFACE = 0x3d;

/** The clips `Boss4Init` and the ported states name, by their exe ids. */
export enum Boss4Clip {
  /** The death fall. `FUN_004119A0(char, 0x69, 0, 10)` at `0x00495786`. */
  Die = 0x69,
  /** The fighting idle the entrance ends in, and every flinch returns to. */
  Idle = 0x6b,
  /** The clip `Boss4Init` seats: `MOV dword ptr [ECX + 0x20], 0x7C`. */
  Entrance = 0x7c,
  /** The landing after the drop, and what sub 2 waits on frame 0x5A of. */
  Land = 0x75,
  /** The clip sub 2 blends into on frame 0x5A of {@link Boss4Clip.Land}. */
  Settle = 0x74,
  /** `Boss4StateFlinch`'s ordinary reaction. */
  Flinch = 0x73,
  /** `Boss4StateFlinch`'s reaction when it interrupted state 7. */
  FlinchIdle = 0x6f,
  /** `Boss4StateKnockDown`'s. */
  KnockDown = 0x71,
}

/**
 * The 0xA4-byte block at `obj+0x1310`.
 *
 * A plain object, because `World.save()` puts every slice through
 * `clonePlain`: no class, no methods, nothing that is not JSON.
 */
export interface Boss4Block {
  /** `+0x00` — {@link Boss4Flag}. */
  flags: number;
  /** `+0x04` — the index into {@link Boss4State}'s dispatch table. */
  state: number;
  /** `+0x05` — the state's own sub-state, always counted up by one. */
  sub: number;
  /** `+0x06` — the state a flinch interrupted, restored by it. */
  savedState: number;
  /** `+0x07` — that state's sub. */
  savedSub: number;
  /**
   * `+0x08` — the arena phase, 0..8 for the first arena and 9..0x11 for the
   * second. `Boss4Init` writes 0xFF and the entrance writes 0 or 9.
   */
  phase: number;
  /** `+0x09` — how many of `g_boss4_pin_picks`' entries are unused. */
  pinsLeft: number;
  /** `+0x0A` — the bitmask of the ones that have been used. */
  pinsUsed: number;
  /** `+0x0B` — the rank `FUN_0040A8A0` returns, indexing the damage table. */
  rank: number;
  /** `+0x0C` — head hits taken; `Boss4ResolveShot` counts them for the bonus. */
  headHits: number;
  /**
   * `+0x10` — the transport the entrance rides, latched from
   * `g_civilian_carrier` (`0x009A2C88`). An actor's `at`, or `-1`.
   *
   * `[diverges]` The engine keeps the pointer and the entrance's sub 1 reads
   * the carrier's own `+0x40` transform out of it to compose the drop. The
   * port keeps the key and **does not compose the transform** — see
   * `entrance.ts`.
   */
  carrierAt: number;
  /**
   * `+0x24` — the hit points below which `Boss4ResolveShot` stops taking
   * damage until the phase advances. `obj+0x11E * BOSS4_PHASE_HP_FRACTION`.
   */
  phaseHpFloor: number;
  /** `+0x70` — 6.0f from `Boss4Init`, the speed `FUN_00409B70` is given. */
  walkSpeed: number;
  /**
   * `+0x74` — an `s32` four states use for four different things: a countdown
   * in `Boss4StateHoldThenApproach`, the next state in
   * `Boss4StateTurnToStoredPoint`, a camera frame in
   * `Boss4StateChargePastCamera` and the death dwell in `Boss4StateDeath`.
   * One slot, four meanings; the engine reuses it and so does this.
   */
  timer: number;
  /**
   * The intro banner this boss spawned — `BossIntroBannerUpdate`
   * (`FUN_00437AC0`), or `null` before its entrance has run.
   *
   * `[diverges]` In the engine the banner is a **task of its own**, allocated
   * by `BossIntroBannerSpawn` (`FUN_00437A70`) with its own 0xE0-byte block,
   * and it outlives nothing — it kills itself 300 frames in. The port's object
   * pool is keyed by spawn class and the banner has none, so it is driven from
   * this boss's update instead. That is behaviourally the same thing for as
   * long as the boss is in the pool and updating, which covers the banner's
   * whole life; it would differ only if the boss died first, and the boss
   * cannot die before its own entrance has finished.
   */
  banner: Boss4BannerState | null;
}

/** `BossIntroBannerUpdate`'s 0xE0-byte block, the fields it reads. */
export interface Boss4BannerState {
  /** `+0x00` — 0 preload, 999 waiting on the flag, 1 seat, 2 slide, 3 hold. */
  step: number;
  /** `+0x04` — the frame counter, incremented at the bottom of every call. */
  frame: number;
  /**
   * The `g_boss4_intro_banners` entry, as an index.
   *
   * The engine keeps the pointer at the banner task's own `obj+0x130C`
   * (`MOV dword ptr [ESI + 0x130c], EAX` at `0x00437AA1`); an index is the
   * same thing through a table the port has, and it survives `clonePlain`.
   */
  rec: number;
}

/**
 * A fresh block, as `Boss4Init` (`FUN_004917E0`) leaves it.
 *
 * `[port-only]`: the engine has no constructor for this: `FUN_004A74E0`
 * hands back 0xA4 bytes and `Boss4Init` writes twelve fields into them one
 * at a time. Every line below is one of those writes, with its address.
 */
export function Boss4BlockNew(): Boss4Block {
  return {
    flags: 0, state: 0, sub: 0, savedState: 0, savedSub: 0,
    // `MOV byte ptr [EDX + 0x8], 0xFF` at `0x00491983`.
    phase: 0xff,
    // `MOV byte ptr [ECX + 0x9], 0x2` at `0x00491995`, and `+0x0A = 0`.
    pinsLeft: 2, pinsUsed: 0,
    rank: 0, headHits: 0,
    carrierAt: -1,
    // `MOV dword ptr [EAX + 0x24], EBP` with `EBP` zero, at `0x0049198C`.
    phaseHpFloor: 0,
    // `MOV dword ptr [EDX + 0x70], 0x40C00000` at `0x004919BC`.
    walkSpeed: 6,
    timer: 0,
    banner: null,
  };
}
