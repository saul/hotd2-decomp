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
import type { BreakableProp } from "./class41/prop_state";
import { GameMode } from "./game_mode";
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
  /**
   * The accumulated tumble, `obj+0x68`.
   *
   * `ThrownWeaponFlyToTarget` does `obj+0x68 += obj+0x135C` every frame in
   * flight — negated for the other hand — and `ThrownWeaponUpdate` draws the
   * weapon as `Rz(obj+0x6C) * Ry(obj+0x68) * Rx(obj+0x1364 + obj+0x64)`. So
   * the tumble is the **Y** term: the weapon turns about its own vertical.
   * The X and Z terms are zero in flight; they are only set on landing, when
   * `AimThrownWeapon` points the stuck weapon back at the camera.
   */
  spinAngle: number;
  /** Frames spent in the stick-and-blink tail once the flight is done. */
  after: number;
  hit: boolean;
  stickFrames: number;
  blinkFrames: number;
  /** The renderer hides it on alternate frames once it is blinking. */
  visible: boolean;
  /**
   * Constant acceleration, for the one throw that arcs.
   *
   * Class 0x31's weapon always flies straight, so this is zero for every one
   * of its throws. `ZombieThrownWeaponStateArc` (`FUN_004598F0`) is the other
   * family: char type 1 lobs its weapon with `±0.009` on whichever of X and Z
   * `ZombieThrownWeaponBeginArc` picks, and the axe throwers do not.
   */
  acc?: Vec3;
  /**
   * The damage kind `PlayerTakeDamage` is given on arrival — 4 for a flat
   * throw and 6 for an arced one. Absent means class 0x31's, which passes 0.
   */
  hitKind?: number;
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
  /**
   * `g_enemies_present` — 0x009C7006. The looser of the two counts: what the
   * evt's enemy waits and class 0x10's wait bit 0 test against.
   */
  g_enemies_present: 0,
  /**
   * `g_civilians_alive` — 0x009CA0E8. Every class-0x10 civilian raises this in
   * its Init and drops it when it leaves, unless its wait word carries
   * `0x08000000` (uncounted) — and one wait bit blocks a script until the
   * count has fallen far enough, which is how a stage paces its rescues.
   */
  g_civilians_alive: 0,
  /**
   * `g_two_player_game` — 0x009C8E80. Set when two players are actually in
   * play; class 0x10's wait bit 0x40000000 blocks until it is clear.
   */
  g_two_player_game: 0,

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
  /**
   * `g_attack_committed` — 0x009A34F0. One enemy off camera may hold a
   * permit; while it does, **nobody else may claim one at all**.
   *
   * Both claim functions read it first and give up, and both set it when the
   * actor they are about to grant is off screen. It is cleared by the two
   * release functions and by `ZombieStateHoldAtRange`, each gated on the
   * actor's own bit — `obj+0x136C` bit 0x20000 for class 0x30, bit 0x8000 for
   * class 0x31.
   *
   * The port used to have neither half: it **refused** an off-screen claim
   * outright, so an enemy that ended up level with the camera could never take
   * a permit, never attack, never run the state that retreats, and stood there
   * for good.
   */
  g_attack_committed: 0,

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
  /** `g_hit_result` — 0x009A58F8. What the last shot did; the score reads it. */
  g_hit_result: 0,

  // -- the camera --------------------------------------------------------
  /**
   * `g_camera_is_tracking` — 0x0059C988. Zeroed by `SelectCameraLookAtTarget`
   * when no enemy is registered. It picks the *turn rate*, not whether the
   * camera turns: the ease runs either way.
   */
  g_camera_is_tracking: 0,
  /**
   * `g_camera_lookat_target` — 0x009C6FA8. The point the camera **wants** to
   * look at this frame: a single attacking enemy, the midpoint of two, or —
   * with nothing registered — the path's own target.
   *
   * This is the *desired* point, not where the camera is aimed. Where it is
   * aimed is {@link Globals.g_camera_block_target}, which eases onto this one.
   */
  g_camera_lookat_target: vec3(),
  /**
   * `g_camera_block_target` — 0x009A60D8, the camera block's `+0xD8`: where
   * the camera is actually looking, right now.
   *
   * This is the state that makes the camera smooth. `CameraTrackEnemiesTick`
   * eases it onto `g_camera_lookat_target` every frame and never assigns it —
   * so when the last enemy dies and the desired point falls back to the
   * path's own target, the aim *swings* back onto the rail over about thirty
   * frames instead of cutting to it.
   */
  g_camera_block_target: vec3(),
  /**
   * `g_cam_path_target` — 0x009C70D8. The look-at `CamEvalPath7` evaluates
   * from the active path's target channels, and the fallback
   * `SelectCameraLookAtTarget` uses when nothing is registered.
   *
   * [diverges] The engine writes this only from the deferred-rail hooks
   * (`CameraStepRailTick`, `CameraPlayStashedPath`, `CameraArmStashedPath`),
   * so after an ordinary `cam_play` action retires it can hold the target of
   * whichever shot last ran through one of those. The port keeps it current
   * with the playing path every frame. In the case that motivated this —
   * stage 2 block 17 step 5, where `finish_sequence 6` had just run the
   * 121..150 range through `CameraPlayStashedPath` — the two agree exactly.
   */
  g_cam_path_target: vec3(),
  /**
   * `g_camera_turn_rate` — 0x009C6F36, and `g_camera_turn_curve` — 0x009C6F38.
   *
   * The rate `TurnLookAtToward` divides by, refreshed at the *end* of every
   * `CameraTrackEnemiesTick` and therefore one frame old when the ease reads
   * it. That lag is the engine's, not an accident of the port.
   */
  g_camera_turn_rate: 0,
  g_camera_turn_curve: 1,
  /**
   * `g_camera_settled` — 0x009C6F2F. Raised once the eased look-at has caught
   * up with the desired one (|dot| > 0.99999). `EvtOpWaitTargetsClear47`
   * gates on it, which is why the ease has to exist for op 0x47 to mean
   * anything.
   */
  g_camera_settled: 0,
  /**
   * `g_camera_free` — 0x009C6F2D. **The gate on every room-clear wait.**
   *
   * `wait_enemies_present` (0x43), `wait_enemies_alive` (0x44) and
   * `wait_scripted_actors` (0x46) all require this on top of their counter, so
   * a room does not hand over the moment the last enemy dies — it hands over
   * once the camera has swung back onto its rail.
   *
   * The engine computes it across two per-frame camera drivers:
   * `FUN_00402E00` raises it when no `g_enemy_slots` entry is claimed, and
   * `FUN_00402650` clears it on every frame the camera mode is not
   * "return to path" — a mode it only picks when `g_enemies_alive == 0` *and*
   * no slot is claimed. Inside that mode `CameraTurnOntoPathTarget` latches it
   * when the eased look-at catches the path target.
   *
   * This port has one camera routine rather than that pair, so what it keeps
   * is the conjunction the two of them compute between them: no slot claimed,
   * no enemy alive, and the aim converged. [diverges]
   */
  g_camera_free: 0,
  /**
   * `g_enemy_slots` — 0x009A5EC0. The actors the camera considers, nearest
   * first; slots 0 and 1 are the permit holders. Holds `at`, not pointers.
   */
  g_enemy_slots: [] as number[],

  // -- breakable props, class 0x41 ---------------------------------------
  /**
   * Every live breakable prop. The engine allocates each as its own 0x378
   * object in the same pool the actors live in; a separate list is the same
   * thing with the layout kept honest, since a prop shares no field offsets
   * with an `Actor`.
   */
  g_breakable_props: [] as BreakableProp[],
  /**
   * `g_breakable_members` — 0x007DCDD4. `group * 9 + member` -> the live
   * prop's `id`, or 0 once it is destroyed. Stride 9 because the largest
   * group has nine members, and `BreakablePropUpdate` reads it to find the
   * props a member supports so a stack collapses from the bottom.
   */
  g_breakable_members: [] as number[],
  /**
   * `g_item_set_countdown` — 0x009C7010. How many more props of an item set
   * must break before its item drops. `PlaceBreakableGroup` seeds it with
   * `rand() % n + 1`, so *which* break releases the item is random — it is
   * not the last one.
   */
  g_item_set_countdown: [] as number[],
  /** Hands out `BreakableProp.id`. State, so ids never collide across a load. */
  g_breakable_next_id: 1,

  // -- the camera the script is playing ----------------------------------
  /**
   * `g_active_cam_path` — 0x009A2D78, the `cp_` slot currently playing, and
   * `g_cam_path_frame` — 0x009A6110, how far into it the camera is.
   *
   * Class 0x24's set-pieces are driven entirely by these: every one of its six
   * states is removed when the camera reaches a named path at a named frame,
   * and the freeze/unfreeze cues are the same pair again. A set-piece is a
   * thing that happens *at a point in a camera move*, not at a point in time.
   */
  g_active_cam_path: -1,
  g_cam_path_frame: 0,
  /**
   * The previous frame's `g_cam_path_frame`.
   *
   * Not an engine global. The engine's counter steps by exactly one, so it
   * cannot pass a cue without landing on it and testing `==` is safe there.
   * This port's camera clock runs on real elapsed time and can advance by more
   * than one frame in a tick, so an exact cue can be stepped straight over.
   * Keeping the previous value turns those tests into a crossing test, which
   * is the same answer whenever the engine's assumption holds and the right
   * one when it does not. [diverges]
   */
  g_cam_path_frame_prev: 0,
  /**
   * `g_script_flags` — 0x009C7200. The byte array `set_script_flag` (evt 0x48)
   * writes and the set-pieces read for their other removal trigger.
   */
  g_script_flags: [] as number[],

  // -- the ground plane --------------------------------------------------
  /**
   * `g_camera_fixed_eye_y` — 0x009C8E58, also labelled `g_ground_plane_y`.
   *
   * **The name is wrong and is kept only because it is the one in the Ghidra
   * database.** It is a *ground plane*, not an eye height: `EvtOpSetGroundPlaneY1A`
   * (evt opcode 0x1A) writes it, `PlaceBreakableGroup` puts a group's floor at
   * `this - 0.1`, `BreakablePropGroundContact` tests against the same value,
   * `ActorDrawGroundShadow` draws on it, and `QueryGroundHeightAt` returns it
   * when the `coli/` trace misses. Its one camera use is conditional on
   * `g_camera_use_fixed_y`, which is where the name came from and which is the
   * minority of its readers. Renaming it is a fifty-site sweep across the
   * port, the docs, the tools and the database, so it is written down here
   * rather than done half-way.
   */
  g_camera_fixed_eye_y: 0,
  /**
   * `g_camera_block_eye` — 0x009A60C0: the eased eye position of the camera
   * block `g_camera_index` selects, at `g_camera_blocks + 0x80`.
   *
   * Not the same thing as `g_camera_fixed_eye_y`, which is a *ground plane*
   * the script sets. This is where the camera actually is, after
   * `FUN_00402EF0` has eased it toward the pose the path evaluated —
   * `FUN_00403B00` reads it as the eye when it measures the angle to the
   * look-at target, which is what proves the three words are a position.
   *
   * Only one camera block is ever active in this port, so the array collapses
   * to one entry.
   */
  g_camera_block_eye: vec3(),
  /**
   * `g_camera_yaw_bams` — 0x009C71F0. Which way the camera is pointing, in
   * BAMS, beside the eye at `g_camera_eye_x/y/z` (0x009C71E0).
   *
   * Class 0x31 needs the *yaw alone* rather than the whole camera matrix:
   * `ThrowerStateLeapAside` builds its landing point with a Y rotation only,
   * and `ThrowerFindWallBeside` refuses to leap unless the actor is facing
   * within 0x2000 of it. The host writes it once a frame.
   */
  g_camera_yaw_bams: 0,
  /**
   * `g_coli_hit_surface` — 0x009CAC40. The material id of whatever the last
   * collision trace hit, and a **side output**: every caller reads it straight
   * after its own trace rather than being handed it.
   *
   * Class 0x31 latches it into `obj+0x1350` where it lands, because `0x5A`
   * kills whatever touches it.
   */
  g_coli_hit_surface: 0,
  /**
   * `g_coli_hit_x/y/z` — 0x009CAC54 / 0x009CAC58 / 0x009CAC50 — and the
   * normal. Every collision query reports through these rather than returning
   * a point: the return value only says whether there *was* a hit.
   */
  g_coli_hit_x: 0,
  g_coli_hit_y: 0,
  g_coli_hit_z: 0,
  g_coli_hit_normal: [0, 1, 0] as number[],
  /** How far inside the surface a sphere test found the centre. */
  g_coli_hit_depth: 0,
  /**
   * The two script-selected collision sets, as `"<file>:<offset>"` blob keys.
   *
   * evt `0x10` fills the **full** set, which both the segment and the sphere
   * test consult; `0x11` fills the **ray-only** set, which only the segment
   * test does — `[likely]` scenery that stops a bullet but not movement. Each
   * instruction *replaces* the set it names.
   *
   * This is state, not table data: the script changes it as the stage runs, so
   * it goes in the snapshot and the blobs themselves do not.
   */
  g_coli_full_set: [] as string[],
  g_coli_ray_set: [] as string[],
  /**
   * `g_active_player` — 0x009C7000, from `FUN_00414F40`: -1 nobody, 0 or 1
   * that player alone, 2 both. `TryClaimAttackSlot` offers a permit
   * accordingly when `g_max_attackers` is 1.
   */
  g_active_player: 0,

  // -- game mode ---------------------------------------------------------
  /**
   * `g_GameMode` — 0x009CA08C. See {@link GameMode}.
   *
   * Class 0x41 branches on it both ways: Original releases the member's own
   * `storyItem` and can drop an extra life from every prop, Arcade turns
   * selected members into one-shot targets and pays no score for them.
   *
   * The bundle carries the same numbers — `script.game_mode` *is* this field,
   * and `main.ts` copies it straight across.
   */
  g_GameMode: GameMode.Arcade as GameMode,
  /**
   * `g_prop_target_set` — 0x009C9118. Which of four member sets
   * `PlaceBreakableGroup` turns into one-shot targets while `g_GameMode` is 2.
   */
  g_prop_target_set: 0,
  /**
   * `g_scene_index` — 0x009A1A08. Which scene is loaded, zero-based:
   * `ColiLoadForScene` indexes its file list with it, so scene 1 is stage 2.
   * Class 0x41's routines branch on it for the per-stage sound sets and for
   * `PropExpireByStepLifetime`'s scene-1 sweep.
   */
  g_scene_index: 0,
  /**
   * `g_evt_step_index` — 0x009A2BB0. The event VM's **step index**, and the
   * walker's cursor: `Walker.step` is an accessor over this field, because the
   * engine has one global here and both halves of the game read it.
   *
   * `EvtAdvanceStepOrRoute` increments it at the top and assigns it `1` in the
   * route branch, so it runs 1..k within a block and drops back to 1 on a
   * block change — it is **not** monotonic and **not** a block count.
   * `FUN_0045EBC0` seeds it with 0, 1 or 5 by game mode.
   *
   * A prop's lifetime is measured in changes to this, not in frames, which is
   * why a prop outlives a slow player and not a fast one. It used to be a
   * monotonic per-block counter here and props lived about four times too
   * long — blocks average 3.99 steps.
   */
  g_evt_step_index: 0,

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
 * Put every global back to what the scene reset leaves it at.
 *
 * **Call `SetGameTables` after this, never before.** This clears the approach
 * rings, which are table-derived; doing it the other way round leaves them at
 * zero, every enemy reads the outermost band for ever, and nothing reaches
 * striking range.
 */
export function ResetGameGlobals(): void {
  G.g_object_list = [];
  G.g_enemies_alive = 0;
  G.g_enemies_present = 0;
  G.g_civilians_alive = 0;
  G.g_attack_permits = new Array(G.g_max_attackers).fill(-1);
  G.g_attack_committed = 0;
  G.g_enemy_approach_rings = [];
  G.g_enemy_approach_ring_mid = [];
  G.g_enemy_approach_ring_outer = [];
  G.g_enemy_approach_steps = 0;
  G.g_enemy_approach_steps_mid = 0;
  G.g_enemy_approach_steps_outer = 0;
  // The scene reset re-arms the player: `ResetSceneCombatState`
  // (`FUN_0045EEC0`) calls into the player init, and without it a replay or a
  // seek starts with however many lives the last run ended on. That went
  // unnoticed until `TryClaimAttackSlot` grew its `IsPlayerAttackable` gate,
  // at which point a zero-life player made every enemy stop attacking.
  // `main.ts` overwrites this from the bundle's `start_lives` immediately
  // after, which is the engine's order too.
  G.g_player_lives = [2, 2];
  G.g_player_invuln_frames = 0;
  G.g_player_was_hit = [0, 0];
  G.g_player_hit_motion = [0, 0];
  G.g_player_hit_count = [0, 0];
  G.g_head_combo_bonus = [0, 0];
  G.g_player_score = [0, 0];
  G.g_nPlayerFired = [0, 0];
  G.g_camera_is_tracking = 0;
  G.g_camera_lookat_target = vec3();
  G.g_camera_block_target = vec3();
  G.g_cam_path_target = vec3();
  G.g_camera_turn_rate = 0;
  G.g_camera_turn_curve = 1;
  G.g_camera_settled = 0;
  G.g_camera_free = 0;
  G.g_enemy_slots = [];
  G.g_thrown_weapons = [];
  G.g_thrown_next_id = 1;
  G.g_breakable_props = [];
  G.g_breakable_members = [];
  G.g_item_set_countdown = [];
  G.g_breakable_next_id = 1;
  G.g_evt_step_index = 0;
  G.g_scene_index = 0;
  G.g_camera_block_eye = vec3();
  G.g_active_cam_path = -1;
  G.g_cam_path_frame = 0;
  G.g_cam_path_frame_prev = 0;
  G.g_coli_full_set = [];
  G.g_coli_ray_set = [];
  G.g_coli_hit_surface = 0;
  G.g_script_flags = [];
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
