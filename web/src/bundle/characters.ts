/**
 * Skeletons, baked motions, damage tables, attacks and spawns —
 * everything docs/formats/combat.md describes.
 *
 * Part of the bundle the exporter writes; see docs/formats/ for each block.
 */

export interface BakedMotion {
  bank: string;
  frames: number;
  /** `mot/` is authored at 30 Hz against the engine's 60 Hz clock. */
  fps: number;
  /** `frames * 3` floats: the root translation. */
  root: number[];
  /** `frames * bone_count * 3` BAMS shorts, bone 0 first. */
  rot: number[];
}

export interface CharacterBone {
  bone: number;
  /** Hit-sphere centre in the bone's own space, from `PTR_DAT_004D032C`. */
  hit_centre?: [number, number, number];
  hit_radius?: number;
  /**
   * `[slot, code, damage]` per successive hit, exactly as `ResolveHit` reads
   * them. *code* is the **next** effect-table entry, which the game branches
   * on rather than treating as a slot: 0 last step, **1 sever**, 2 no effect,
   * anything larger escalate. See docs/formats/combat.md.
   */
  steps?: [number, number, number][];
  /** `PTR_DAT_004D0D84[bone]` — s8 added to the damage, per adaptive rank. */
  damage_rank?: number[];
  /** The exporter's part name, which the glTF node name ends with. */
  part: string;
  slot: number;
  offset: [number, number, number];
  parent: number | null;
}

export interface CharacterType {
  type: number;
  name: string;
  file: string;
  /** Bones in a motion frame — the stride, from the EXE. */
  bone_count: number;
  bones: CharacterBone[];
  /** Bone the score model treats as the head — 2 on every humanoid. */
  head_bone: number;
  /**
   * `{body_condition: [motion per reaction group]}` — the stumble the actor
   * plays when a shot hurts it but does not kill it. See
   * docs/formats/combat.md §7.
   */
  reactions: Record<string, number[]>;
  /**
   * `{body_condition: {index: attack}}` — only the entries the pick table
   * names, which are the only ones the game reads.
   */
  attacks: Record<string, Record<string, AttackJson>>;
  /** `picks[(rand % 10) + (destroyed_zones & 7) * 10]` names the attack. */
  attack_picks: Record<string, number[]>;
  /** The thrown-weapon attack, for the two types that have one. */
  throw: ThrowJson | null;
  /**
   * `{body_condition: [motion, ...]}` — the character's general motion row.
   * 0/1 the walk variants, 2/3 the attack run, `backoff_index` the back-away.
   */
  motion_row: Record<string, number[]>;
  backoff_index: number;
  /** Damaged variants, keyed by asset slot: their own hit spheres. */
  gore: Record<string, { centre: [number, number, number]; radius: number }>;
  /**
   * `ResolveHit`'s count of real torso gore stages. The last one is withheld
   * while the actor is alive, so a zombie only shows it once dead.
   */
  torso_stages: number;
  motions: Record<string, BakedMotion>;
}

export interface CharacterPlacement {
  /** evt offset of the spawn descriptor. */
  at: number;
  class: number;
  char_type: number;
  /** null when this class has no motion rule yet — marker only. */
  motion: number | null;
  /** `obj+0x11C` from the descriptor, before difficulty scaling. */
  hp: number;
  /** The actor's BAMS yaw — the directional death compares the camera's to it. */
  yaw: number;
  /** Class-0x30 descriptor tail: see `Placement` in hod2lib/characters.py. */
  body_condition: number;
  initial_state: number;
  /** State to enter once the approach finishes. 0 means it never attacks. */
  attack_state: number;
  /** Which of `approach.rings` this actor measures against. */
  ring_set: number;
  /**
   * The ballistic arc a spawn placed in the air rides to the ground, from the
   * descriptor's +0x04..+0x10. Only the two leap states read those bytes —
   * class 0x31's state 20 and class 0x30's state 24 — so it is present only
   * for them.
   */
  leap?: { dest: [number, number, number]; frames: number } | null;
  /**
   * The route a `ThrowerStatePathFollow` spawn walks before it fights, from
   * the descriptor's +0x04 delay and the 16-byte waypoints at +0x08.
   */
  path?: {
    delay: number;
    points: { step: number; motion_set: number;
              dest: [number, number, number] }[];
  } | null;
  /**
   * `ThrowerStateWalkDistance` (class 0x31 state 18) walks until it is this
   * far from where it started, then stands.
   */
  walk_distance?: number;
  /** `ThrowerStateEntranceClip` (state 19) plays this once, then stands. */
  entrance_motion?: number;
  /** `ThrowerStateDelayedPounce` (state 23): a clip, then a leap over `frames`. */
  pounce?: { motion: number; frames: number } | null;
  /**
   * A scripted entrance played once before `motion` starts looping — state 21
   * of class 0x30's 54-state machine. The two zombies in the stage-2 van jump
   * out of it this way, staggered by their delays.
   */
  intro?: { motion: number; delay: number };
}

/** The directional death set — see docs/formats/combat.md. */
export interface DeathSet {
  front: number[];
  back: number[];
  right: number;
  left: number;
  /** ±45° in BAMS. */
  arc: number;
}

/** A sound id paired with the filename `g_se_name_list` gives it. */
export interface NamedSound { id: number; file: string }

/** Everything a shot can make happen — see docs/formats/combat.md §9. */
export interface CombatJson {
  /** `ActorPlayHitVoice`: one of five flesh impacts, on every hurt and kill. */
  impact: NamedSound[];
  /** ...replaced by one of these two on a headshot kill. */
  head_impact: NamedSound[];
  /** `[set A, set B]` per event; `voice_set_a_types` says which a type takes. */
  voice: { hurt: NamedSound[]; kill: NamedSound[]; head: NamedSound[] };
  voice_set_a_types: number[];
  /** `FUN_00407950`: collision material → the ricochet it plays. */
  ricochet: Record<string, NamedSound>;
  /** `FUN_004073B0`: material → `[first texture, last texture, scale]`. */
  impact_sprite: Record<string, [number, number, number]>;
  impact_sprite_default: [number, number, number];
  /** `ActorShotFeedback`: blood spray scale by hit result. */
  blood_scale: Record<string, number>;
  no_effect: {
    sound: NamedSound; sound_type2: NamedSound;
    material: number; material_type3: number;
  };
}

/** One attack, from `PTR_PTR_00592F18`. See docs/formats/combat.md §10. */
export interface AttackJson {
  /** The strike clip. */
  strike: number;
  /** Played while still further away than `distance`. */
  lunge: number;
  distance: number;
  /** Frame of the strike clip on which the hit lands. */
  hit_frame: number;
  /** The motion the *player* plays when hit. */
  player_motion: number;
  /**
   * If every zone named here is destroyed the strike whiffs — 1 head,
   * 2 right arm, 4 left arm. 8 is outside the 3-bit mask, so it never cancels.
   */
  cancel_mask: number;
}

/** One hand's thrown-weapon attack. See docs/formats/combat.md §10. */
export interface ThrowHandJson {
  /** 5 (right) or 8 (left). */
  bone: number;
  motion: number;
  /** Frame of the throw clip on which the weapon leaves the hand. */
  release_frame: number;
  range: number;
  player_motion: number;
  /** Destroyed zones that cancel it — 2 right arm, 4 left arm. */
  cancel_mask: number;
  /** Asset slot the hand draws while armed; null when the skeleton names it. */
  held: number | null;
  /** ...and once thrown. */
  bare: number;
  /** The model that flies. */
  projectile: number;
}

/** The thrown-weapon attack, for the character types that have one. */
export interface ThrowJson {
  /** Keyed by body condition. */
  hands: Record<string, ThrowHandJson[]>;
  /** BAMS added to the weapon's yaw every frame in flight. */
  spin: number;
  /** Units per frame; the flight is a straight line at constant speed. */
  speed: number;
  /** The target is this far in front of the camera. */
  aim_ahead: number;
  aim_side: number;
  stick_frames: number;
  blink_frames: number;
}

/** `PlayerTakeDamage` — a strike costs exactly one life. */
export interface PlayerDamageJson {
  life_cost: number;
  score: number;
  invuln_frames: number;
  rank_delta: number;
  start_lives: number;
}

/** The advance rings — see docs/formats/combat.md §10. */
export interface ApproachJson {
  /** `{inner, mid, outer}` per ring set, from `DAT_004C4CD0`. */
  rings: { inner: number; mid: number; outer: number }[];
  /** Steps to walk: `base` inside the middle ring, plus the adds further out. */
  steps: { base: number; mid_add: number; outer_add: number };
  ring_set_for_char0: number;
}

/** What the gameplay camera aims at and how fast it turns. */
export interface TrackingJson {
  /** Four 64-entry turn-rate curves; a larger value is a *slower* turn. */
  curves: number[][];
  /** The one the scene reset selects. */
  curve: number;
  /** Angle error is clamped here (0x1FFF BAMS = 45°) before `>> 7`. */
  error_clamp: number;
  /** Flat rate used when nothing is being tracked. */
  rate_untracked: number;
  /** `TurnLookAtToward` re-emits the look-at this far from the eye. */
  lookat_radius: number;
  /** Sort key is `|actor − eye| × this`, ascending. */
  distance_scale: number;
  attack_slots: number;
  slots: number;
  max_candidates: number;
  face_offset: number;
}

/** `ActorInitHitPoints` and `ResetDamageRank`. */
export interface DifficultyJson {
  /** Added to a spawn's hit points, by menu difficulty 0..4. */
  hp_delta: number[];
  /** Starting adaptive rank by menu difficulty — what damage is indexed by. */
  initial_rank: number[];
  /** Menu difficulty the player defaults to (Normal). */
  default: number;
  hp_min: number;
  hp_max: number;
}

/**
 * One stage of a three-stage arc motion script — `InstallArcMotionScript`
 * (`FUN_0044DA60`) copies twelve dwords into the actor's slot and
 * `ActorArcStep` (`FUN_0044D860`) walks them.
 *
 * Every script in the program names the **same motion** in all three stages,
 * so a script is one clip cut into windup, flight and landing.
 */
export interface ArcStage {
  motion: number;
  /** Frame of that clip the stage starts at. */
  start: number;
  /** Cross-fade in, in frames. */
  fade: number;
  /** The clip frame past which the next stage begins. */
  until: number;
}

/** One class-0x31 attack — `g_class31_melee_attacks` — 0x00592A10. */
export interface Class31Attack {
  script: ArcStage[];
  /** Frame of the script's clip on which the hit lands; -1 means "on landing". */
  hit_frame: number;
  /** The reaction the *player* plays when it connects. */
  player_motion: number;
  /** If every zone named here is destroyed the strike whiffs. */
  cancel_mask: number;
}

/** One class-0x31 behaviour set. See docs/formats/combat.md §12. */
export interface Class31Set {
  set: number;
  /** `g_class31_motion_sets` — `[idle, idle, walk, walk, land, airborne]`. */
  motions: number[];
  /** `{stance: {index: attack}}` — stance 4 is "mid-leap". */
  attacks: Record<string, Record<string, Class31Attack>>;
  /** `picks[(rand % 10) + (destroyed_zones & 7) * 10]` names the attack. */
  attack_picks: number[];
  /** `{band: [80 candidate state ids]}` — the behaviour repertoire. */
  state_picks: Record<string, number[]>;
  /** The stumble, by reaction group. */
  reactions: number[];
}

/** `g_class31_*` — class 0x31's four behaviour sets and its named scripts. */
export interface Class31Json {
  sets: Class31Set[];
  /** The arc scripts a state names rather than an attack entry. */
  scripts: Record<string, ArcStage[]>;
  note?: string;
}

export interface CharactersJson {
  deaths: DeathSet;
  difficulty: DifficultyJson;
  combat: CombatJson;
  /** `g_bone_damage_zone` — bone → destroyed-zone bit, 0xFF for none. */
  bone_zones: number[];
  /** `DAT_004C84A8` — bone → reaction group: head, torso, each limb. */
  reaction_groups: number[];
  /** `ActorPlayHitReaction`'s cross-fade lengths, in frames. */
  reaction_blend: { frames: number; sever: number; hard_set_from_bone: number };
  approach: ApproachJson;
  tracking: TrackingJson;
  player: PlayerDamageJson;
  /** Class 0x31's own tables — see {@link Class31Json}. */
  class31?: Class31Json;
  types: Record<string, CharacterType>;
  placements: CharacterPlacement[];
  note: string;
}

/** One swinging prop — a door leaf, a shutter, a van door. */
