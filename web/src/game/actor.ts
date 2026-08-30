/**
 * The object struct.
 *
 * One TS field per exe field, at the offset named in the comment, because the
 * offsets are how the port gets checked. Everything here is plain data: no
 * three.js nodes, no functions, no `Map` or `Set` — the whole actor list goes
 * through `structuredClone` and then `JSON.stringify` on every save.
 *
 * The renderer binds to an actor by `at` and owns the nodes; it holds no state
 * of its own that a snapshot would need.
 */
import type { SpawnClass } from "./spawn_class";
import { vec3, type Vec3 } from "./vec";

/** `obj+0x34` — the object's flag word. Only the bits the port reads. */
export enum ActorFlag {
  /**
   * Excluded from `RegisterForCameraTracking`. `ZombieStateApproach` sets it
   * while walking and clears it the moment the actor wins a permit, which is
   * how the camera comes to consider only enemies that have committed.
   */
  NoCameraTrack = 0x10000,
}

/**
 * `obj+0x1318` — the destroyed-zone mask, and the same three bits an attack's
 * `cancel_mask` names. Only three zones exist; `g_bone_damage_zone` maps every
 * other bone to 0xFF, which the game's `& 0x1F` parks on bit 31.
 */
export enum DamageZone {
  Head = 1,
  RightArm = 2,
  LeftArm = 4,
  /** The whole mask. `zones & DamageZone.All` is the engine's own `& 7`. */
  All = 7,
}

/** A motion the actor is playing at full weight. `t` is seconds. */
export interface ActorClip { motion: number; t: number; loop: boolean }

export interface Actor {
  // -- identity ----------------------------------------------------------
  /** The spawn's script address. Stable, and the key the renderer binds on. */
  at: number;
  /** The spawn class — `g_class_handlers` is indexed by it. */
  cls: SpawnClass;
  /** The character type index; `game/tables.ts` resolves the data. */
  charType: number;
  /** Display name, for the feed. Copied from the type at spawn. */
  name: string;

  // -- the engine's own fields -------------------------------------------
  flags: number;            // +0x34
  pos: Vec3;                // +0x40
  /** Yaw in BAMS. The engine keeps a triple at +0x64/68/6C; only Y turns. */
  yaw: number;              // +0x68
  hp: number;               // +0x11C
  maxHp: number;            // +0x11E
  /** `-1` when it holds no permit, else the index into `g_attack_permits`. */
  attackPermit: number;     // +0x121
  /** `ActorBodyConditionFromHands` — indexes the attack and motion tables. */
  condition: number;        // +0x130C
  state: number;            // +0x1310
  sub: number;              // +0x1312
  /** Destroyed zones — a mask of {@link DamageZone}. */
  zones: number;            // +0x1318
  /** The attack index the strike drew. */
  attack: number;           // +0x131A
  /** Rank in the distance queue, nearest first. */
  rank: number;             // +0x131D
  /** Which of `g_enemy_approach_rings` this actor measures against. */
  ringSet: number;          // +0x131F
  /** Frames spent retreating; `ZombieStateBackOff` gives up past 0xF0. */
  backoffFrames: number;    // +0x1334
  /** How deep in the distance queue this actor may be and still attack. */
  allowance: number;        // +0x1358

  // -- descriptor --------------------------------------------------------
  /** The state a permit-holder enters; 0 and -1 mean "never attacks". */
  attackState: number;

  // -- runtime the renderer reads ----------------------------------------
  dead: boolean;
  /** The script has this spawn live and the renderer is showing it. */
  visible: boolean;
  /** The looping base motion. */
  motion: number;
  /** Seconds into that loop. */
  clock: number;
  /** A one-shot or lunge at full weight: the lunge loops, the strike does not. */
  action: ActorClip | null;
  /** The death clip, once. */
  death: { motion: number; t: number } | null;
  /** A stumble, blended over `blend` frames. */
  react: { motion: number; t: number; blend: number; hard: boolean } | null;
  /** The spawn's intro clip and its delay in seconds. */
  intro: { motion: number; delay: number } | null;

  // -- damage bookkeeping ------------------------------------------------
  /** Charges landed per bone — the gore stage. `ResolveHit`'s counter. */
  hits: Record<string, number>;
  /** Bones whose "one hit only" effect has already fired. */
  latched: number[];
  /** Bones whose subtree has been severed. */
  removed: number[];
  /** Per-bone asset slot overrides — the draw record at +0x20C + bone*0x90. */
  boneSlot: Record<string, number>;
}

/** A fresh object. Everything the engine leaves zeroed is zero here. */
export function makeActor(at: number, cls: SpawnClass, charType: number,
                          name: string): Actor {
  return {
    at, cls, charType, name,
    flags: 0,
    pos: vec3(),
    yaw: 0,
    hp: 0,
    maxHp: 0,
    attackPermit: -1,
    condition: 0,
    state: 0,
    sub: 0,
    zones: 0,
    attack: -1,
    rank: 99,
    ringSet: 0,
    backoffFrames: 0,
    allowance: 0,
    attackState: 0,
    dead: false,
    visible: false,
    motion: 0,
    clock: 0,
    action: null,
    death: null,
    react: null,
    intro: null,
    hits: {},
    latched: [],
    removed: [],
    boneSlot: {},
  };
}
