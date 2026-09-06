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
  /**
   * `g_motion_play_length[motion]` (`0x004E07D0`) — the clip clock the
   * *scripts* count in, which is **not** `frames`. It ticks once per 60 Hz
   * frame over 30 Hz data, so it is `2 * frames - 2` or `- 3`; which of the
   * two has no rule, so it is carried rather than derived. Absent only for a
   * motion the table has no row for.
   */
  play?: number;
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

/** One entry of {@link CharacterType.parts}. */
export interface CharacterPartJson {
  /** The asset slot the whole part draws as. */
  slot: number;
  /** `g_character_part_bones[part][4]` — the bone the draw happens in. */
  draw_bone: number;
  /** The four group bones, `null` where the group is absent. */
  bones: (number | null)[];
  /** Which group indices this part's drawer deforms. */
  deformed: number[];
  /** How many logical vertices the part has. */
  rows: number;
  /**
   * Whether the exporter emitted geometry for it. False means the part's
   * drawer is one the port has not read — character type `0x17`'s part 1, and
   * nothing else — so the table is here and the mesh is not.
   */
  supported: boolean;
}

export interface CharacterType {
  type: number;
  name: string;
  file: string;
  /** Bones in a motion frame — the stride, from the EXE. */
  bone_count: number;
  bones: CharacterBone[];
  /**
   * `g_pCharacterExtraParts` (`0x0052ED08`) — the **vertex-blended** parts,
   * which are not in {@link CharacterType.bones} because they are not rigid to
   * one bone: the waist stretches between the chest and the pelvis, and the
   * skirt between the pelvis and both thighs.
   *
   * The geometry itself is in the glTF, as a skinned primitive with a `skin`
   * of its own; this is the description, and what the port needs out of it is
   * `slot` against `draw_bone` — that pairing is what
   * `SkeletonNodeDrawSuppressed` (`FUN_004122E0`) vetoes bone 9's rigid draw
   * for. A `null` entry is a part index whose descriptor pointer is null,
   * kept so the index still lines up with `g_character_part_bones`.
   */
  parts?: (CharacterPartJson | null)[];
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
  /** Class 0x30's own hand kit, if this type throws. */
  zombie_throw?: ZombieThrowJson | null;
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
  /**
   * `obj+0x124`, from `g_actor_radius_by_char` (0x004C4D28). The radius
   * `ShotTestSphere` (`FUN_00404630`) uses for an actor shot as a **sphere**
   * rather than per bone — which is every class-0x10 civilian, since none of
   * them ever raises `obj+0x34` bit 0x80. Ten units for all of them.
   */
  actor_radius: number;
  motions: Record<string, BakedMotion>;
}

/**
 * One entry of a captor script's motion list — `s16[4]`, or `s16[5]` for state
 * 36, which carries a `g_script_flags` index as well.
 */
export interface TargetScriptEntry {
  motion: number;
  frame: number;
  loops: number;
  /**
   * The cue frame the maul lands on, or, in `ZombieStateRetireOffScreen`, the
   * mode its per-frame arm switches on. `ZombieApplyScriptMode` also reads it.
   */
  mode: number;
  /** State 36 only: the `g_script_flags` byte raised on the cue frame. */
  flag?: number;
}

/** One decoded captor script: a header shaped by the entering state, then a list. */
export interface TargetScriptJson {
  /** The class-0x30 state the header belongs to. */
  state: number;
  head: {
    /** State 34: how close the walk has to get. */
    arrive?: number;
    /** States 38, 40 and 41: the point walked at or past. */
    point?: [number, number, number];
    motion?: number;
    frame?: number;
    loops?: number;
    mode?: number;
    /** State 43: the frame the drag kills on. */
    cue?: number;
  };
  entries: TargetScriptEntry[];
}

/**
 * The descriptor tail of a class-0x30 entrance state, by state.
 *
 * Every field is optional because the decoder refuses a field whose bytes do
 * not read plausibly — for any state but its own these are the next
 * descriptor's — and the state falls back to its own default rather than
 * acting on a guess.
 */
export interface ZombieEntryTail {
  /** 13, 18, 19, 23: the camera path frame the state waits for. `-1` in state
   *  23 means fire at once. */
  cue_frame?: number;
  /** 18, 20: the camera frame, or the `g_script_flags` index, to wait on. */
  cue?: number;
  /** 13, 17: the walk distance handed to state 15, present only when the
   *  descriptor's `+0x03` names it. */
  walk_distance?: number;
  /** 14, 17: how many frames the hold lasts. */
  frames?: number;
  /** 17, 18, 19, 20, 23, 31: the clip the state plays while it waits. */
  motion?: number;
  /** 19: the pose is frozen while it waits (`tail+0x0C == 0`). */
  freeze?: boolean;
  /** 19: claim an attack permit on the cue (`tail+0x0D`). */
  claim?: boolean;
  /** 19, 24, 30, 31, 32: the frames counted down before the state acts. */
  delay?: number;
  /** 19: `obj+0x133C`, the only attack cooldown class 0x30 ever arms. */
  cooldown?: number;
  /** 23, 24: the play-clock frame the hit lands on. */
  hit_frame?: number;
  /** 24, 30: where the arc goes. */
  dest?: [number, number, number];
  /** 30: the arc's parameter-advance rate, `ActorArcStep`'s argument. */
  step?: number;
  /** 24, 31: the clip played between strikes. */
  idle_motion?: number;
  /** 24: the clip the strike itself plays. */
  strike_motion?: number;
  /** 24, 32: which player to attack, `-1` for either. */
  player?: number;
  /** 31: the `g_script_flags` index that lets the actor into the game. */
  flag?: number;
  /** 32: the frames re-armed between swings. */
  rearm?: number;
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
   * `ZombieStateEmerge`'s (state 27) delay and clip. A spawn's `y` is where
   * its entrance *starts*; this clip's own root translation is what lifts the
   * actor out of the water or the ground.
   */
  emerge?: { delay: number; motion: number } | null;
  /** `ZombieStateDelayedLeap`'s (state 26). `gravity` is per-frame, not a duration. */
  delayed_leap?: {
    delay: number; dest: [number, number, number]; gravity: number;
  } | null;
  /**
   * The two captor scripts, decoded — see `target_script` in
   * hod2lib/characters.py. `target_script` is the descriptor tail's `+0x04`
   * blob read for the initial state, `attack_script` the `+0x08` blob read for
   * the attack state, which is the selection `ZombieScriptForState`
   * (`FUN_0045CA10`) makes.
   */
  /**
   * The captor family's camera cue, from the descriptor tail's `+0x0C`/`+0x0E`,
   * absent when `+0x0C` is -1. `ZombieScriptEnded` reads it to decide whether a
   * captor that has finished its script may turn on the player at once, or must
   * hold in state 42 until the camera reaches that path and frame. Three spawns
   * in the game set one, all in stage 2.
   */
  camera_cue?: { path: number; frame: number };
  target_script?: TargetScriptJson;
  attack_script?: TargetScriptJson;
  /**
   * The class-0x10 civilian whose `CivilianInit` builds this actor, as its
   * spawn address. Present only on the fifty zombies holding a civilian:
   * nothing in the evt's instruction stream points at their descriptors, so
   * the walker never places them and they follow their parent instead.
   */
  civilian_child?: number;
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
  /** `ThrowerStateWaitForCue` (state 28): the clip, the condition and its
   *  operand. */
  cue?: { motion: number; cond: number; operand: number } | null;
  /** `ThrowerStateLeapStrike` (state 22): the frames the arc takes. */
  leap_strike_frames?: number;
  /**
   * The spawn record's flags word — `ActorInitFlags` (`FUN_00408970`) makes it
   * the actor's `obj+0x34`, before the class's own `Init` ORs its bits in.
   */
  init_flags?: number;
  /**
   * The descriptor's **second** word, at `+0x20` — not `+0x04`, which is
   * {@link CharacterPlacement.init_flags}. `SpawnFromDescriptor`
   * (`FUN_00408A20`) copies it to `obj+0x1316`, and each combat class's `Init`
   * sign-extends it into the class flag word `obj+0x136C`:
   * `EnemyThrowerInit` (`FUN_00449620`) ORs `0x180000` onto it,
   * `EnemyZombieInit` (`FUN_00452DA0`) ORs `0x60000000`.
   *
   * For class 0x31 the bits are the starting surface — `0x40` wall A, `0x80`
   * wall B, `0x100` ceiling — so a `zslman` that blinks in on the ceiling gets
   * its stance from here and nowhere else. Absent when the word is zero, and
   * absent on the fifty-odd class-0x10 child placements, which the exporter
   * builds outside the script walker.
   */
  desc_flags?: number;
  /**
   * The spawn's **attachment list** — `obj+0x1170`, ids into
   * {@link CharactersJson.attachments}.
   *
   * `ActorBindPartList` (`FUN_00412440`) binds it as the actor is built. An
   * id below `0x24` names a `hito_kao_*` face the bone draws **instead of**
   * the one the skeleton names; an id at or above it names an `etc_komono_*`
   * accessory `ActorDrawAttachedParts` (`FUN_004124F0`) draws **as well**.
   *
   * A civilian's hair is here and nowhere else: the head model the skeleton
   * names is a shell open at the back, and the accessory is what closes it.
   * Absent when the spawn has no list, which is 97 of the game's spawns have
   * one and the rest do not.
   */
  attachments?: number[];
  /**
   * `ZombieStateStandAndThrow`'s tail. `exit_state` is the same `tail+0x03`
   * byte as {@link CharacterPlacement.attack_state}, and it is what says whether
   * `walk_distance` or `leap` is the reading of `tail+0x10`.
   */
  stand_throw?: {
    delay_two_hands: number;
    delay_one_hand: number;
    delay_after_throw: number;
    exit_state: number;
    walk_distance?: number;
    leap?: { dest: [number, number, number]; gravity: number };
    leave_delay?: number;
  };
  /**
   * The tail one of the twelve class-0x30 entrance states reads — see
   * `ENTRY_TAIL_STATES` in `hod2lib/characters.py`, which gates each shape on
   * the spawn's own `initial_state`. Between them these are 133 of the game's
   * 356 class-0x30 spawns.
   *
   * One union rather than twelve optional fields, because exactly one state
   * reads any given spawn's bytes and every other reading of them is the *next*
   * descriptor. `ZombieEntryTailFor` in `class30/entrance.ts` narrows it back
   * by state.
   */
  entry?: ZombieEntryTail | null;
  /** `ThrowerStateDelayedPounce` (state 23): a clip, then a leap over `frames`. */
  pounce?: { motion: number; frames: number } | null;
  /**
   * `ThrowerStateGrabPlayer` (state 27). The offset is **camera-relative**:
   * the actor rides it until the camera path reaches `cue_frame`, drops to it
   * over `drop_frames`, and holds the grab for `hold_frames`. `player` is who
   * it grabs, `-1` for either.
   */
  grab?: {
    offset: [number, number, number];
    cue_frame: number;
    drop_frames: number;
    hold_frames: number;
    player: number;
  } | null;
  /** `ThrowerStateBlinkInThreeHops` (state 34) holds this long first. */
  back_away_delay?: number;
  /**
   * A scripted entrance played once before `motion` starts looping — state 21
   * of class 0x30's 54-state machine. The two zombies in the stage-2 van jump
   * out of it this way, staggered by their delays.
   */
  intro?: { motion: number; delay: number };
  /**
   * Class 0x20's whole descriptor tail, `OneHitTargetInit` (`FUN_00448ED0`)'s
   * reading of it — and its own block because the same bytes are class 0x30's
   * `body_condition` / `initial_state`, which is precisely the polymorphism a
   * shared field would hide.
   *
   * `motion` of 0 is a **value, not an absence**: it means the Init draws one
   * of `CLASS20_IDLE_MOTIONS` with `rand() & 3`, which is the port's draw to
   * make from `ctx.rng`. `box` is `[xmin, xmax, zmin, zmax]`, present only for
   * `subtype` 2, which is the only sub-type that reads those bytes.
   */
  class20?: {
    subtype: number;
    remove_path: number;
    remove_frame: number;
    motion: number;
    box: [number, number, number, number] | null;
  } | null;
  /**
   * Class 0x52's tail — one s16, the sub-type. 0 and 1 wander and leave;
   * **2, 3 and 4 are shootable route-branch triggers** and write
   * `g_script_branch_var` from a per-subtype byte, in Original Mode only.
   *
   * Its own block for the same reason class 0x20's is: `+0x00` here is class
   * 0x30's `body_condition`.
   */
  class52?: { subtype: number } | null;
  /**
   * Class 0x53's tail — the cat. `anim_set` indexes the motion playlist at
   * `0x00589A64`; **sub-type 2 and up is a shootable route-branch trigger**
   * that answers only in event block 8, in Original Mode only.
   */
  class53?: { anim_set: number; subtype: number } | null;
}

/** The directional death set — see docs/formats/combat.md. */
export interface DeathSet {
  front: number[];
  back: number[];
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
  /**
   * `ZombieStateArcScriptedEntrance`'s two arc motion scripts, in class 0x31's
   * twelve-dword shape. The state picks by character type: `entrance_type0`
   * for type 0 and `entrance_other` for every other.
   */
  arc_scripts?: Record<string, ArcStage[]>;
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

/**
 * Class 0x30's hand kit — a **different family** from {@link ThrowJson}, which
 * is class 0x31's. Every value is a literal out of `ZombiePickThrowingHand`
 * (`FUN_00458F00`) and `ZombieThrowHandWeapon` (`FUN_0045A240`); there is no
 * table in the exe, only a switch on the character type in each, with three
 * types in it: 1 (`znassb.bin`), 0x13 (`tutorial.bin`) and 0x14
 * (`znonoopa.bin`).
 */
export interface ZombieThrowHandJson {
  /** 5 (right) or 8 (left). */
  bone: number;
  /** The slot this hand draws while it still holds its weapon. */
  held: number;
  /** ...and once it has thrown it. */
  bare: number;
  /** The bone the weapon mesh hangs off, zeroed with the swap. */
  weapon_bone: number;
  /** The model that flies. `0x249` is `znonoo.bin` part 0 — the axe. */
  projectile: number;
}

export interface ZombieThrowJson {
  hands: ZombieThrowHandJson[];
  /** The axe flies flat; anything else arcs. Decided by the projectile slot. */
  straight: boolean;
  /** Units per frame, and the faster one body condition 7 throws at. */
  speed: number;
  speed_standing: number;
  /** The aim point: this far in front of the eye, offset sideways per player,
   *  and this far below it for the axe. */
  aim_ahead: number;
  aim_side: number;
  aim_drop: number;
  /** `ZombieThrownWeaponStateArc`'s gravity, negated for bone 8. */
  arc_gravity: number;
  /** `PlayerTakeDamage`'s third argument: 4 straight, 6 arced. */
  hit_kind: number;
  /** Frames it sticks in view, then blinks, before it goes. */
  stick_frames: number;
  blink_frames: number;
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

/**
 * `PlayerTakeDamage` — what the *shell* needs, which is one number.
 *
 * The cost of a hit is four `.text` immediates and they live in
 * `game/combat/player.ts` now; this is the one the app reads before the game
 * starts, to fill the life counter. See `docs/formats/bundle.md`.
 */
export interface PlayerDamageJson {
  start_lives: number;
}

/**
 * The advance rings — see docs/formats/combat.md §10. The radii are `.rdata`;
 * the step allowances that used to travel with them are immediates, and live
 * in `game/class30/ring.ts`.
 */
export interface ApproachJson {
  /** `{inner, mid, outer}` per ring set, from `DAT_004C4CD0`. */
  rings: { inner: number; mid: number; outer: number }[];
}

/**
 * The turn-rate curves — `PTR_DAT_00576C04`, the one `.rdata` table the camera
 * director reads. The numbers that used to sit beside them here were `.text`
 * immediates and are in `game/camera/constants.ts`.
 */
export interface TrackingJson {
  /** Four 64-entry turn-rate curves; a larger value is a *slower* turn. */
  curves: number[][];
}

/** `ActorInitHitPoints` and `ResetDamageRank`. */
export interface DifficultyJson {
  /** Added to a spawn's hit points, by menu difficulty 0..4. */
  hp_delta: number[];
  /** Starting adaptive rank by menu difficulty — what damage is indexed by. */
  initial_rank: number[];
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
  /**
   * `g_class31_throws` in the raw, by index. `ThrowerStateThrow` reads entries
   * 0 and 1 as the right and left hand; `ThrowerStateCloseAndStrike` reads the
   * same rows as a **melee** attack — a strike clip, an approach clip, the
   * distance it closes to and the frame the hit lands on. Entries the row
   * leaves zero are omitted, which is why a set-0 actor with both arms gone
   * draws index 3 and finds nothing.
   */
  strikes: Record<string, AttackJson>;
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
  /**
   * The pose frame a corpse freezes on, by the clip it died in — the two
   * entries are picked between with `rand() % 17 >> 4`, so the second comes up
   * once in seventeen. Only the four special-cased clips are here: the
   * engine's general table covers motions class 0x31 never plays.
   */
  corpse_frames?: Record<string, number[]>;
  /** The arc scripts a state names rather than an attack entry. */
  scripts: Record<string, ArcStage[]>;
  note?: string;
}

/**
 * One row of `g_actor_attachment_records` — `0x004EC4C0`, 81 of them.
 *
 * `bone` is `-1` for a row whose pointer does not resolve; the row is kept so
 * that an id stays its own index.
 */
export interface AttachmentRecord {
  bone: number;
  slot: number;
}

export interface CharactersJson {
  deaths: DeathSet;
  difficulty: DifficultyJson;
  combat: CombatJson;
  /** `g_bone_damage_zone` — bone → destroyed-zone bit, 0xFF for none. */
  bone_zones: number[];
  /** `DAT_004C84A8` — bone → reaction group: head, torso, each limb. */
  reaction_groups: number[];
  approach: ApproachJson;
  tracking: TrackingJson;
  player: PlayerDamageJson;
  /** Class 0x31's own tables — see {@link Class31Json}. */
  class31?: Class31Json;
  /**
   * `g_actor_attachment_records` — `0x004EC4C0`, indexed by the ids in a
   * placement's {@link CharacterPlacement.attachments}.
   */
  attachments?: AttachmentRecord[];
  /**
   * `ATTACHMENT_REPLACES_BELOW` — the id below which the record replaces the
   * bone's own model rather than adding to it. Carried rather than assumed,
   * because it is a literal in two exe routines and not a property of the
   * data.
   */
  attachment_replaces_below?: number;
  types: Record<string, CharacterType>;
  placements: CharacterPlacement[];
  note: string;
}

/** One swinging prop — a door leaf, a shutter, a van door. */
