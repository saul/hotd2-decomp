/**
 * The data segment.
 *
 * Every mutable global the port touches, named exactly as
 * `ghidra/annotations/globals.tsv` names it, with its address. `G.x = 1` where
 * the exe writes `x`; nothing is passed as an argument to be tidier and
 * nothing is hidden in a class to be idiomatic.
 *
 * One object rather than a file of `export let`, because a `let` binding
 * cannot be enumerated and a save state of one would be a hand-maintained list
 * that rots the first time somebody adds a global. `G.g_enemies_alive` still
 * reads as the exe reads and still greps as `g_enemies_alive`.
 *
 * **This object and the actors inside it are the entire game state.** If
 * something survives a frame and is not reachable from here, the snapshot is
 * wrong and so is the port.
 */
import type { Actor } from "./actor";
import { vec3, type Vec3 } from "./vec";

/** One weapon in flight — the pool `ThrownWeaponUpdate` walks. */
export interface ThrownWeapon {
  /** Unique and stable; the renderer binds its node to this, not to an index. */
  id: number;
  /** The thrower's spawn address, so the renderer can source the model. */
  from: number;
  /** The asset slot of the projectile model. */
  slot: number;
  pos: Vec3;
  /** Units per 60 Hz frame. */
  vel: Vec3;
  /** Frames of flight left. */
  ttl: number;
  /** BAMS per frame, signed by which hand threw it. */
  spin: number;
  yaw: number;
  /** Frames spent in the stick-and-blink tail once the flight is done. */
  after: number;
  hit: boolean;
  stickFrames: number;
  blinkFrames: number;
  /** The renderer hides it on alternate frames once it is blinking. */
  visible: boolean;
}

export const G = {
  // -- the object pool ---------------------------------------------------
  /**
   * Every live actor. The engine keeps a linked pool reached from
   * `g_cur_actor` (0x009A26A0); a list is the same thing with an index.
   */
  g_object_list: [] as Actor[],
  /** `g_enemies_alive` — 0x009C904A. */
  g_enemies_alive: 0,

  // -- attack permits ----------------------------------------------------
  /**
   * `g_attack_permits` — 0x009A2BA0, one per player. `-1` is free, otherwise
   * the `at` of the actor holding it. `TryClaimAttackSlot` offers
   * `g_max_attackers` of them, so with one player exactly one enemy is
   * committed at a time — which is the game's feel.
   */
  g_attack_permits: [-1] as number[],
  /** `g_max_attackers` — 0x009C8E84. */
  g_max_attackers: 1,

  // -- the approach rings, copied from the defaults by the scene reset ----
  /** `g_enemy_approach_rings` — 0x009A2BE0, the inner radius per ring set. */
  g_enemy_approach_rings: [] as number[],
  /** `g_enemy_approach_ring_mid` — 0x009A2BE4. */
  g_enemy_approach_ring_mid: [] as number[],
  /** `g_enemy_approach_ring_outer` — 0x009A2BE8. */
  g_enemy_approach_ring_outer: [] as number[],
  /** `g_enemy_approach_steps` — 0x009C8E40. The queue depth allowed inside mid. */
  g_enemy_approach_steps: 0,
  /** `g_enemy_approach_steps_mid` — 0x009C8E44. */
  g_enemy_approach_steps_mid: 0,
  /** `g_enemy_approach_steps_outer` — 0x009C8E48. */
  g_enemy_approach_steps_outer: 0,

  // -- the player --------------------------------------------------------
  /** `g_player_lives` — 0x009A5C66 + player*0x98. */
  g_player_lives: [2, 2],
  /** `g_player_invuln_frames` — 0x009C8E08. */
  g_player_invuln_frames: 0,
  /** `g_player_was_hit` — 0x009A5CD0 + player*0x98. */
  g_player_was_hit: [0, 0],
  /** `g_player_hit_motion` — 0x009A5CD2 + player*0x130. */
  g_player_hit_motion: [0, 0],
  /** `g_player_hit_count` — 0x009A5C86 + player*0x98. Hits that scored. */
  g_player_hit_count: [0, 0],
  /** `g_head_combo_bonus` — 0x009A5C82 + player*0x98. */
  g_head_combo_bonus: [0, 0],
  /**
   * The running score. `[open]` — it is in the same +player*0x98 block as
   * `g_player_lives` (0x009A5C66) but its offset has not been read out, so
   * this carries no address rather than a guessed one.
   */
  g_player_score: [0, 0],
  /** `g_nPlayerFired` — 0x009A5C78. Shots taken, for the accuracy grade. */
  g_nPlayerFired: [0, 0],

  // -- difficulty --------------------------------------------------------
  /** `g_difficulty` — 0x009C8E94. Scales spawn HP only. */
  g_difficulty: 2,
  /** `g_damage_rank` — 0x009C8E96. The adaptive per-shot damage bonus. */
  g_damage_rank: 2,

  // -- the camera --------------------------------------------------------
  /** `g_camera_is_tracking` — 0x0059C988. */
  g_camera_is_tracking: 0,
  /** `g_camera_lookat_target` — 0x009C6FA8. Where the camera is aimed now. */
  g_camera_lookat_target: vec3(),
  /**
   * `g_enemy_slots` — 0x009A5EC0. The actors the camera considers, nearest
   * first; slots 0 and 1 are the permit holders. Holds `at`, not pointers.
   */
  g_enemy_slots: [] as number[],
  /** True once the look-at has a value worth easing from. */
  g_camera_lookat_valid: false,

  // -- thrown weapons ----------------------------------------------------
  g_thrown_weapons: [] as ThrownWeapon[],
  /** Hands out `ThrownWeapon.id`. Part of the state, so ids never collide. */
  g_thrown_next_id: 1,

  /** 60 Hz frames since the scene reset. Not an exe global; the port's clock. */
  g_frame: 0,
};

/** The shape of the whole data segment, for the snapshot's type. */
export type Globals = typeof G;

/**
 * `ResetSceneEnemyState` in spirit: put every global back to what the scene
 * reset leaves it at. Called on stage load, and by the snapshot loader before
 * it writes the saved values in.
 */
export function ResetGameGlobals(): void {
  G.g_object_list = [];
  G.g_enemies_alive = 0;
  G.g_attack_permits = new Array(G.g_max_attackers).fill(-1);
  G.g_enemy_approach_rings = [];
  G.g_enemy_approach_ring_mid = [];
  G.g_enemy_approach_ring_outer = [];
  G.g_enemy_approach_steps = 0;
  G.g_enemy_approach_steps_mid = 0;
  G.g_enemy_approach_steps_outer = 0;
  G.g_player_invuln_frames = 0;
  G.g_player_was_hit = [0, 0];
  G.g_player_hit_motion = [0, 0];
  G.g_player_hit_count = [0, 0];
  G.g_head_combo_bonus = [0, 0];
  G.g_player_score = [0, 0];
  G.g_nPlayerFired = [0, 0];
  G.g_camera_is_tracking = 0;
  G.g_camera_lookat_target = vec3();
  G.g_camera_lookat_valid = false;
  G.g_enemy_slots = [];
  G.g_thrown_weapons = [];
  G.g_thrown_next_id = 1;
  G.g_frame = 0;
}

/** Write a saved data segment back over the live one, field by field. */
export function RestoreGameGlobals(saved: Globals): void {
  Object.assign(G, saved);
}

/** Find an actor by its spawn address. */
export function ActorByAt(at: number): Actor | undefined {
  return G.g_object_list.find((o) => o.at === at);
}
