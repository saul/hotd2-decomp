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
import type { BloodSpray, PointBloodSpray } from "./effects/blood";
import type { BodyCreature } from "./body_creature";
import type { CarriedProp } from "./carried_prop";
import type { ThrownWeapon } from "./thrown_weapon";
import type { SeveredHead } from "./effects/severed_head";
import type { ShotFlash, ShotTracer, ShotWeaponEffect }
  from "./effects/shot_effects";
import { makeShotFlashRing, makeShotTracerRing, makeShotWeaponRing }
  from "./effects/shot_effects";
import type { SpriteEffect } from "./effects/sprite";
import { makeDamageOverlays, PlayerCameraHook, type DamageOverlay }
  from "./effects/damage_overlay";
import type { PropStripEffect } from "./effects/prop_strip";
import type { FishBloodCloud, FishSurfaceRing, FishWaterSplash }
  from "./effects/fish";
import type { OwlFeather, OwlGroundRing, OwlWaterSplash }
  from "./effects/owl";
import type { RingEffect } from "./effects/ring_effect";
import type { WaterRing } from "./effects/water_ring";
import type { WaterSurface, WaterSurfaceUv } from "./class41/water";
import type { St2Car } from "./class21/car";
import type { Actor } from "./actor";
import type { BreakableProp } from "./class41/prop_state";
import type { OriginalItemBanner } from "./class41/item_banner";
import type { PropShatter } from "./class41/shatter";
import type { ShotRequest } from "./combat/shot";
import type { ShotTestEntry } from "./combat/shot_test";
import type { QueuedScreenSprite, ScreenSprite } from "./screen_sprite";
import type { BossHpBar } from "./boss_hp_bar";
import type { BossBanner } from "./boss_banner";
import type { WaterWaveField } from "./class16/state";
import type {
  Boss3CardPiece, Boss3IntroCard, Boss3MeshBulge, Boss3PathEffect, Boss3Spark,
  Boss3Splash,
} from "./class45/state";
import type { ScreenSpriteAnim } from "./game_over";
import type { Boss4HitMark } from "./class19/hit_mark";
import type { BatSplash } from "./class46/splash";
import type { PlayerBody } from "./player_body";
import type { RouteFigure, RouteMapState, RouteMark } from "./route_map";
import { GameMode } from "./game_mode";
import { vec3 } from "./vec";
import { makeCameraSlots, type CameraCandidate } from "./camera/slot_table";
import { CameraActorInit } from "./camera/actions";
import { MatIdentity } from "./matrix";
import { makeEntityLights } from "./entity_light";
import { PlayerState, PlayerTask, RunPhase } from "./player_state";
import { AdvanceToNextScene, PlayerBlockBoot, PlayerBlockRestore,
  PlayerStartGameFromTitle, PlayerTasksCreate, PlayerTasksRunFirstTurn,
  type PlayerBlock }
  from "./player_shell";
import { HudShutterTaskCreate, type ShutterBar } from "./hud_shutter";

/**
 * `g_app_state` (`0x009C8E98`) — the game's top-level screen, and something
 * the engine really does `switch` on: `FUN_004043C0` has arms for 3 and for
 * 5/9/0x0A/0x0B.
 *
 * Only the members the port has evidence for are here; the shell's other
 * screens stay unnamed rather than guessed. `CommitAppState` (`FUN_0040E860`)
 * is the writer a state *request* goes through, and it applies the request at
 * `g_app_state_pending` (`0x007C17A0`) at the end of the frame.
 */
export enum AppState {
  /**
   * The title and mode-select screen: `AppStateDispatch` (`FUN_004608A0`)
   * runs `TitleMenuRunPhase` (`FUN_00496200`) in it. A start press here is
   * what spends the first credit and requests {@link InPlay}. `[proved]`
   */
  Title = 4,
  /**
   * The attract demo. `RunAttractDemo` (`FUN_00426800`) advances only while
   * this is the state, and it is `IsPlayerAttackable`'s (`FUN_00409DC0`)
   * unconditional-attack override — the demo has no real player, so its
   * `g_player_state` is never 5 and nothing would ever attack it.
   */
  Attract = 5,
  /**
   * A stage, being played. `FUN_00414FC0` requests exactly this on the start
   * press that spends a credit, and `CommitAppState` leaves `g_player_state`
   * alone only for 6 and 7 — so 6 and 7 are the only two states with live
   * players in them, and 7 is the game-over arm. `[proved]`.
   *
   * **This is where the port lives.** `ResolveHit` (`FUN_00409430`) reads
   * `g_app_state` twice and both reads ask "is it 6": at anything else it
   * suppresses gore, dismemberment and the hit result outright.
   */
  InPlay = 6,
  /**
   * The game-over screen, `FUN_00460960`. `RunPhaseContinueCountdown`
   * (`FUN_00460530`) and `RunPhaseNoContinue` (`FUN_00460250`) request it when
   * nobody is left in play, and `CommitAppState` leaves `g_player_state`
   * alone for it, as for 6. `[proved]`
   */
  GameOver = 7,
  /**
   * Boot. Stamped once, by `FUN_0040E4A0`, whose only caller is the startup
   * routine `FUN_0049E4A0` — the one that reads `Hod2.ini` — and which resets
   * the whole data segment (`FUN_0040A920`, `g_app_state = 0`) before setting
   * it. The main loop `FUN_0049E220` draws nothing while it holds
   * (`0049E3DC`), so it is the state the game is in before the first screen.
   *
   * `[proved]`, and it is not a shutdown: `FUN_0040E4A0` has exactly one
   * xref and it is on the way in, not the way out.
   */
  Boot = 0x10,
}

/**
 * `g_screen_furniture_flags` — `0x009A5900`, the bits a screen card holds
 * while it has the screen.
 *
 * Each card ORs its bit in when it starts and ANDs it out on the frame it
 * raises its gate's flag, and the readers are draw routines that stand aside
 * for it: `HudDrawShutterState` (`FUN_00413970`) holds no bars in state 4
 * while either is up (`TEST byte ptr [0x009a5900], 0x30` at `0x00413BB5`),
 * `HudDrawLives` (`FUN_004174A0`) drops "HOLD YOUR FIRE!" under the result
 * card, and `Class22CutsceneHoldUntilChapterCard` (`FUN_0049B280`) draws
 * only while the chapter card is down. `[proved]`
 *
 * Only the two cards' bits are members. Bits 0, 1 and 3 have writers of
 * their own -- `PlayerTryStartPress` and `UpdateSceneViewAndLight` for 0,
 * `CommitAppState` for 1, `EvtLoadBlockProgram` for 3 -- and are still
 * literals where the port uses them.
 */
export enum ScreenFurniture {
  /**
   * `ResultCardInstall` (`FUN_00434EF0`): `OR EDX, 0x10` at `0x00434FD0` in
   * sub 0, `AND AL, 0xEF` at `0x00435683` beside `g_script_flags[0xFE]`.
   */
  ResultCard = 0x10,
  /**
   * `ChapterCardInstall` (`FUN_004342E0`): `OR AL, 0x20` at `0x0043436B` in
   * sub 0 (and in both installer arms), `AND AL, 0xDF` at `0x004348C7`
   * beside `g_script_flags[0xF8]`.
   */
  ChapterCard = 0x20,
}

export { PlayerState, PlayerTask, RunPhase } from "./player_state";

/**
 * `g_hit_slots` holds fourteen entries, and the extent is the loop bound
 * rather than a stored count: `ActorClaimHitSlot` (`FUN_00409270`) walks
 * `&DAT_009c88c0` while the pointer is below `0x009C88F8`, and the span is
 * `0x38` bytes. `[proved]`
 *
 * Here rather than in `game/hit_slots.ts` because that module needs `G` and
 * this one must not need it back.
 */
export const HIT_SLOT_COUNT = 14;

/** No slot: what a claim writes first, and what a full table leaves behind. */
export const HIT_SLOT_NONE = -1;

/**
 * One rain drop, in the camera's own space.
 *
 * Three floats, which is exactly what the exe's array holds: 12 bytes a
 * particle over `0x007C1EB8 .. 0x007C2114`.
 */
export interface RainParticle {
  x: number;
  y: number;
  z: number;
}

export const G = {
  // -- the object pool ---------------------------------------------------
  /**
   * Every live actor. The engine keeps a linked pool reached from
   * `g_cur_actor` (0x009A26A0); a list is the same thing with an index.
   */
  g_object_list: [] as Actor[],
  /**
   * `g_cur_actor` — 0x009A26A0, **which object's update is running**, by spawn
   * address; `-1` outside the walk.
   *
   * The engine's task walk leaves the current object here, and the collision
   * passes over moving objects read it to skip the object asking:
   * `ColiTraceSegmentAllSets` (`FUN_004053B0`) compares it at `0x00405448`
   * and `ColiTestSphereAgainstFullSet` (`FUN_004057F0`) at `0x0040583A`
   * (`CMP dword ptr [0x009a26a0], ESI`), so a boat never stands on itself.
   */
  g_cur_actor: -1,
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
   * `g_players_in_play` — 0x009C8E80. **How many players are in play**, and
   * not the two-player flag its old name claimed.
   *
   * `PlayerEnterPlay` (`FUN_00414770`) does `INC word [009C8E80]` as a player
   * enters, on row flag `0x10` of `g_player_enter_play_modes` -- beside a
   * *separate* `INC` of `g_max_attackers` on flag `0x20` -- and
   * `PlayerUpdateInPlay` (`FUN_00413E90`) does the matching `DEC` at
   * `0x00413F42` when one runs out of lives. `CommitAppState` (`FUN_0040E860`)
   * zeroes both on every screen change. So an ordinary single-player game runs
   * at **1**, and 0 means nobody has started yet -- which is what it holds
   * until `player_shell.ts` has run the start press, not a default.
   *
   * That distinction is load-bearing: `ZombieStateLeapToPoint` and
   * `ZombieStateDelayedStrikeInPlace` both refuse to strike while this is 0,
   * so leaving it at the old default would have parked all nine of those
   * spawns for ever. Anything that wants "are there two players" reads
   * `g_max_attackers`, which is what the thrown weapon latches.
   */
  g_players_in_play: 0,
  /**
   * `g_weapon_loop_holders` — 0x009C8A74. **A refcount on one looping sound.**
   *
   * The chainsaw and the laser sword are not per-actor noises: they are two
   * entries of `g_looping_se_ids` (`0x005887FC`), and the engine has no handle
   * for a playing loop at all. So `EnemyZombieInitByCharType` starts the loop
   * only while this is **zero** and `ZombieReleaseWeaponLoopSe` stops it only
   * while it is **one** — the first character-type-2-or-3 actor in the scene
   * opens it and the last one to die or lose its weapon closes it. Every
   * holder in between latches {@link Actor.weaponLoopHeld} and does
   * nothing else with the sound.
   *
   * `ResetSceneCombatState` (`0x0045EF3D`) zeroes it, which is the whole of its
   * lifetime; nothing outside those three sites reads it.
   */
  g_weapon_loop_holders: 0,

  // -- attack permits ----------------------------------------------------
  /**
   * `g_attack_permits` — 0x009A2BA0, one per player. `-1` is free, otherwise
   * the `at` of the actor holding it — the engine stores 1 and frees with 0,
   * so a transcribed reader tests against -1, never the engine's literals
   * (`L63`). `TryClaimAttackSlot` offers each claimant one player's permit,
   * so with one player exactly one enemy is committed at a time — which is
   * the game's feel.
   */
  g_attack_permits: [-1, -1] as number[],
  /**
   * `g_hit_player_order` — 0x009C8908, two ints: which players' marks a shot
   * handler resolves this frame and in what order, `-1` for an unused slot.
   * `ChooseHitPlayerOrder` (`FUN_004093C0`) writes both before every reader
   * walks them, so the zero the image starts with is never read.
   */
  g_hit_player_order: [0, 0] as number[],
  /**
   * `g_max_attackers` — 0x009C8E84. `PlayerEnterPlay` (`FUN_00414770`) raises
   * it on row flag `0x20`, `PlayerContinueCountdown` (`FUN_00414280`) lowers
   * it when a continue runs out, and `CommitAppState` zeroes it.
   */
  g_max_attackers: 0,
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

  // -- the scene light array --------------------------------------------
  // See `scene_lights.ts`. The initial values are `SceneLightArrayInit`'s
  // (`FUN_004809D0`).
  /**
   * `g_scene_lighting` — 0x009A2BB4. evt `0x14`. While set, the light
   * array is built and submitted and the draw routines that ask for it use it.
   */
  g_scene_lighting: 0,
  /** `g_entity_spotlights_on` — 0x009C8D4C. evt `0x15`; the gun lights' gate. */
  g_entity_spotlights_on: 0,
  /**
   * `g_light_array_ambient` — 0x009C71D0, `{unused, r, g, b}`; only r, g, b
   * are carried. evt `0x16` writes them.
   */
  g_light_array_ambient: [0.5, 0.5, 0.5] as [number, number, number],
  /** `g_entity_lights` — 0x009A1A20, sixteen entries of stride 0x74. */
  g_entity_lights: makeEntityLights(),
  /**
   * `g_crosshair_x` — 0x009A5C70 + player*0x130, and `g_crosshair_y`
   * beside it: pixels from the centre of the 640x480 frame, `+y` up.
   */
  g_crosshair_x: [0, 0],
  g_crosshair_y: [0, 0],
  /**
   * `g_aim_on_screen` — 0x009C8FD0 + player*0x28. `PollPlayerAimInput`
   * sets it to 1 every frame for a mouse. [port-only] Player 2 has no input
   * device in the port, so theirs stays 0.
   */
  g_aim_on_screen: [1, 0],

  // -- the player --------------------------------------------------------
  /**
   * `g_player_lives` — 0x009A5C66 + player*0x98. Written by
   * `PlayerEnterPlay` (`FUN_00414770`) from `g_start_lives`, and nowhere else
   * outside the damage path.
   */
  g_player_lives: [0, 0],
  /**
   * `g_player_lives_shown` — 0x009A5C68 + player*0x98, the copy
   * `PlayerUpdateInPlay` (`FUN_00413E90`) takes of the lives after its HUD
   * draw, and `PlayerEnterPlay` sets beside them.
   */
  g_player_lives_shown: [0, 0],
  /**
   * `g_player_invuln_frames` — 0x009C8E08, **one dword per player**.
   * `PlayerEnterPlay` sets the row's frames, `PlayerTakeDamage` 0x5A, and
   * `RunSceneTasksAndTimers` (`FUN_004606D0`) counts both down once a frame,
   * floored at 0.
   */
  g_player_invuln_frames: [0, 0] as number[],
  /**
   * Which routine each player's task runs -- `task+0`, the pointer at
   * `0x009A5CD4 + player*0x130`. See {@link PlayerTask}.
   */
  g_player_task: [PlayerTask.None, PlayerTask.None] as PlayerTask[],
  /**
   * `g_player_ammo` — 0x009A5C7C + player*0x130. `PlayerEnterPlay` loads six
   * in Arcade; `PlayerFireAndReloadUpdate` takes one a shot and
   * `PlayerRefillMagazine` puts the magazine back. See `game/player_gun.ts`.
   */
  g_player_ammo: [0, 0],
  /**
   * `g_player_magazine_size` — 0x009A2248 + player*0x14. `PlayerEnterPlay`'s
   * Arcade arm writes it 6 (the low byte of its `0x3000006` store).
   */
  g_player_magazine_size: [6, 6],
  /**
   * `g_player_magazine_empty` — 0x009A5C7E + player*0x130. Raised by the shot
   * that empties the gun, cleared by every refill; the RELOAD prompt is drawn
   * while it is up.
   */
  g_player_magazine_empty: [0, 0],
  /**
   * `g_player_reload_prompt_timer` — 0x009A5C80 + player*0x130. Frames since
   * the gun ran dry, stepped by `HudDrawAmmoAndReloadPrompt` and folded back
   * to 120 past 600.
   */
  g_player_reload_prompt_timer: [0, 0],
  /**
   * `g_hud_ammo_slide` — 0x007C2120, a float per player: the readout's own
   * counter while the shutter opens, which scales it from 1.5 down to 1.0.
   */
  g_hud_ammo_slide: [0, 0],
  /**
   * `g_player_input_is_gun` — 0x009A5D85 + player*0x130. 1 for a gun, 0 for
   * a standard controller, -1 for no device.
   *
   * **1 in the port, because the port's pointer is the PC mouse and the exe
   * makes the mouse a gun**: `InputMapDevicesToMaple` (`FUN_0041E530`) gives
   * input modes 5 and 6 a maple record with flag `0x80`, and
   * `PlayerBindMapleDevices` (`FUN_0040D8B0`) turns that flag into this 1. So
   * the port's player aims with the gun arm of `PollPlayerAimInput`, reloads
   * by a pull off the screen, and is told "SHOOT OUTSIDE OF THE SCREEN!".
   * Player 2 has no device in the port and never enters play; the value is
   * the same so no lookup ever indexes a binding set of -1.
   */
  g_player_input_is_gun: [1, 1] as number[],
  /**
   * `g_player_pad_kind` — 0x009A5D84 + player*0x130. `MapleDeviceKind`
   * (`FUN_0040D950`) of a non-gun device; -1 for a gun.
   */
  g_player_pad_kind: [-1, -1] as number[],
  /**
   * `g_player_infinite_ammo` — 0x009C9FD9 + player*0x7C. Non-zero and a shot
   * takes no round. Zeroed by the options reset; its setter is `[open]`.
   */
  g_player_infinite_ammo: [0, 0] as number[],
  /**
   * `g_ini_autoreload` — 0x007C17AC. `Hod2.ini`'s `AUTORELOAD`, which
   * `ReadIniFlushSettings` (`FUN_0049E4A0`) reads **only when `G_ENABLE` is
   * 1** and otherwise forces to 0. The installed configuration has
   * `G_ENABLE = 0`, so 0; `AutoReloadEmptyGuns` is transcribed and idle.
   */
  g_ini_autoreload: 0,
  /**
   * `g_input_mode_p1` — 0x00588E24 and `g_input_mode_p2` — 0x007DC698, as
   * `GetPlayerInputModes` (`FUN_0041E260`) returns them. The low half is the
   * PC input mode (5 is the mouse); bit 31 is the gun flag the auto-reload
   * tests. Mode 5 without the flag is what the port's pointer is.
   */
  g_input_mode: [5, 5] as number[],
  /**
   * `g_original_fire_mode` — 0x009A2247 + player*0x14: how the Original Mode
   * weapon fires (1 bursts, 2 reloads only when empty). 0 in Arcade and in
   * every loadout the port can reach.
   */
  g_original_fire_mode: [0, 0] as number[],
  /**
   * The four auto-fire bytes at `+0x10..+0x13` of `g_original_item_slots`
   * (`0x009A2250 + player*0x14`), which `OriginalWeaponLoadFireParams`
   * (`FUN_00416420`) loads and `PlayerFireOriginalModeWeapon` counts down:
   * `[1]` a round is owed without a pull, `[2]` the burst count, `[3]` the
   * frames before the next.
   */
  g_original_fire_latches: [[0, 0, 0, 0], [0, 0, 0, 0]] as number[][],
  /**
   * The screen sprites this frame drew, in draw order -- every
   * `DrawScreenSprite` call, whoever made it. See `game/screen_sprite.ts`.
   *
   * `[port-only]` as a list; what fills it is the engine's.
   * `DrawScreenSprite` (`FUN_0041C6D0`) goes to `DrawSpriteQuadCommand`
   * (`FUN_004A7AB0`) and a quad on the screen, and the port's screen is the
   * HUD layer, which may not read the engine -- so the calls are recorded
   * here, cleared at the head of every frame's player walk, and `app/` hands
   * the list across. Plain data, so a snapshot carries exactly what the frame
   * it was taken on drew. **Not** the exe's `g_screen_sprites` (0x007DDAA8),
   * which is `ScreenSpriteRegister`'s 64-slot array and a different thing;
   * this field was named that until the two were noticed side by side.
   */
  g_screen_sprite_draws: [] as ScreenSprite[],
  /**
   * `g_screen_sprite_queue` — `0x007C21A8`. The layered sprite queue
   * `DrawScreenSpriteLayered` (`FUN_0041C800`) fills and
   * `ScreenSpriteQueueFlush` (`FUN_0041CF30`) draws after the task walk. The
   * engine's is four header cells and a chain; the port keeps the cells in
   * push order and the flush walks them the way the chain would.
   */
  g_screen_sprite_queue: [] as QueuedScreenSprite[],
  /**
   * `g_boss_hp_fraction` — `0x009C8E10`. The boss health bar's fill, 0..1:
   * hit points over maximum, written by whichever boss is fighting and read
   * only by `BossHpBarUpdate` (`FUN_00435C80`). -1.0 kills the bar; 0.0
   * blinks it out. See `game/boss_hp_bar.ts`.
   */
  g_boss_hp_fraction: 0,
  /**
   * `g_boss_engaged` — `0x009CA0EA`. 1 while a boss fight is on: every boss
   * class raises it when it joins and drops it when it dies. Its one reader
   * is `BossModeChapterCardUpdate` (`FUN_00434920`), Boss Mode's fight clock,
   * which the port does not run -- so the port writes it where the engine
   * does and nothing reads it yet.
   */
  g_boss_engaged: 0,
  /**
   * `[port-only]` as a pool: the `Boss4DrawAndAgeBoneHitMark` tasks
   * `Boss4SpawnBoneHitMark` (`FUN_004920C0`) allocates -- the marks a flesh
   * hit leaves on the stage-4 boss, riding the bone that took it. Plain
   * records for the same reason as `g_severed_heads`. See
   * `game/class19/hit_mark.ts`.
   */
  g_boss4_hit_marks: [] as Boss4HitMark[],
  /** `[port-only]` -- the next hit mark's identity, for the renderer. */
  g_boss4_hit_mark_seq: 0,
  /**
   * `g_shot_hit_records` — `0x009A2C40`, stride 0x1C, one per player: the
   * hit `SpawnWorldImpact` (`FUN_00405260`) last resolved for that player's
   * shot -- the point at `+0x00`, the collision surface at `+0x0C` and the
   * normal at `+0x10`, all world space. Written for every shot whose winning
   * candidate was a collision quad: the level's, or a bone's mesh (the
   * `MarkActorShot` arm for a record with `+0x74 & 0x10`). `Boss4ResolveShot`
   * reads the point and the surface back and `Boss4SpawnBoneHitMark` the
   * point and the normal; nothing else in the image reads it.
   */
  g_shot_hit_records: [
    { x: 0, y: 0, z: 0, surface: 0, nx: 0, ny: 0, nz: 0 },
    { x: 0, y: 0, z: 0, surface: 0, nx: 0, ny: 0, nz: 0 },
  ],
  /**
   * `g_original_weapon_damage_scale` — `0x009A224C`, f32, stride 0x14 (the
   * `+0x0C` of each player's `g_original_item_slots` record). The Original
   * Mode damage factor the boss shot routines read: `-1.0` doubles, anything
   * else multiplies (`Boss4ResolveShot` at `0x00491E3E`, `ResolveHit`,
   * `Class14ApplyBoneDamage` and the other bosses).
   *
   * **Every writer stores the same constant**, `[0x004EC92C]` = 1.0f:
   * `PlayerEnterPlay` at `0x00414917`, `ResetOriginalModeLoadout` at
   * `0x0048A117` and `FUN_00416240`'s two item arms at `0x0041627F` and
   * `0x00416297`. `[proved]` from the four stores and the one read of the
   * constant each makes; so the factor is 1.0 wherever a player can shoot,
   * and the doubling arm is never taken. Seeded here with that value rather
   * than written from the four sites, which would write it again.
   */
  g_original_weapon_damage_scale: [1, 1] as number[],
  /**
   * `[port-only]` as a pool: the `BossHpBarUpdate` tasks `BossHpBarSpawn`
   * (`FUN_00435E50`) allocates, in creation order. Plain records for the
   * same reason as `g_severed_heads`.
   */
  g_boss_hp_bars: [] as BossHpBar[],
  /**
   * `[port-only]` as a pool: the `BossIntroBannerUpdate` tasks
   * `BossIntroBannerSpawn` (`FUN_00437A70`) allocates, in creation order.
   * See `game/boss_banner.ts`.
   */
  g_boss_banners: [] as BossBanner[],
  // -- class 0x45, the stage-3 boss: its globals, `0x007DC6F0..0x007DC80F`
  //    and `0x00811200`. Every one is written and read inside the class
  //    (`get_xrefs_to`), bar the counter `NetworkModeRunPhase` also zeroes.
  //    See `game/class45/` and `docs/re/boss-tower.md`.
  /**
   * `g_boss3_heads_attacking` — `0x007DC6F0`. Heads with an armed or running
   * attack; head idx 2's scheduler arms another only while it is below 2.
   */
  g_boss3_heads_attacking: 0,
  /**
   * `g_boss3_variant` — `0x007DC6F1`. 0 and 1 the two stage-3 fights (blocks
   * 11/15 and 13/17), 2 stage 6's. `Boss3ClassHandler` picks it.
   */
  g_boss3_variant: 0,
  /**
   * `g_boss3_heads` — `0x007DC6F4`. The five fighting heads by index, as the
   * spawn addresses of their actors (`-1` for none). Slot 0 is also written
   * by the opening head and by the body, every frame.
   */
  g_boss3_heads: [-1, -1, -1, -1, -1] as number[],
  /** `g_boss3_last_head` — `0x007DC71C`. The head that last bit or was hit. */
  g_boss3_last_head: 0,
  /** `g_boss3_attack_delay` — `0x007DC71E`, s16. Frames to the next armed attack. */
  g_boss3_attack_delay: 0,
  /** `g_boss3_head_hp_pool` — `0x007DC720`, s16. The heads' shared bar. */
  g_boss3_head_hp_pool: 0,
  /**
   * `g_boss3_pose_bone` — `0x007DC724`. `Boss3ComposeBonePose`'s loop index,
   * stored every pass and read by nothing.
   */
  g_boss3_pose_bone: 0,
  /** `g_boss3_heads_left` — `0x007DC728`, s8. Heads still up, 5 at the start. */
  g_boss3_heads_left: 0,
  /** `g_boss3_bystanders` — `0x007DC72C`. The two civilians, by spawn address. */
  g_boss3_bystanders: [-1, -1] as number[],
  /** `g_boss3_phase` — `0x007DC738`, s8. See `Boss3Phase`. */
  g_boss3_phase: 0,
  /**
   * `g_boss3_card_pieces` — `0x007DC740`, eight `{x, y, z, s32 yaw, scale}`
   * records: the intro card, in camera space.
   */
  g_boss3_card_pieces: Array.from({ length: 8 },
    () => ({ x: 0, y: 0, z: 0, yaw: 0, scale: 0 })) as Boss3CardPiece[],
  /** `g_boss3_track_point` — `0x007DC7E0`. The smoothed point the camera tracks. */
  g_boss3_track_point: vec3(),
  /** `g_boss3_opening_bystander_pos` — `0x007DC7F0`. */
  g_boss3_opening_bystander_pos: vec3(),
  /** `g_boss3_opening_bystander_yaw` — `0x007DC800`. Written, not read. */
  g_boss3_opening_bystander_yaw: 0,
  /** `g_boss3_rank` — `0x007DC80C`, s8 0..15. The heads' own adaptive rank. */
  g_boss3_rank: 0,
  /**
   * `g_boss3_rand_counter` — `0x00811200`, u32. `Boss3NextRand`'s state:
   * seeded per variant by the class handler, stepped by every draw and bumped
   * by every processed head shot.
   */
  g_boss3_rand_counter: 0,
  /**
   * `[port-only]` as pools: the tasks class 0x45 allocates, in creation
   * order -- `Boss3IntroCardUpdate`, `Boss3SparkUpdate`, `Boss3SplashUpdate`,
   * `Boss3MeshBulgeUpdate` and `Boss3PathEffectUpdate`. Plain records for the
   * same reason as `g_severed_heads`.
   */
  g_boss3_intro_cards: [] as Boss3IntroCard[],
  g_boss3_sparks: [] as Boss3Spark[],
  g_boss3_splashes: [] as Boss3Splash[],
  g_boss3_mesh_bulges: [] as Boss3MeshBulge[],
  g_boss3_path_effects: [] as Boss3PathEffect[],
  /**
   * `g_camera_driver_held` — `0x009CA094`. While it is 1,
   * `CameraDriverSelectMode` (`FUN_00402650`) forces camera mode 6, the hook
   * that does nothing, and drops `g_camera_free` -- the camera block is left
   * to whoever is writing it. Its only reader. The boss-name banner raises it
   * for the length of its flight, and the bosses' own camera takeovers do too;
   * `ResetSceneCombatState` (`FUN_0045EEC0`, the `checkpoint` opcode) zeroes
   * it at `0x0045EF12`.
   */
  g_camera_driver_held: 0,
  /**
   * `g_stashed_path_frame` — `0x009C70AC`, and `g_stashed_path_end_frame` —
   * `0x009C70B0`. The stashed rail's cursor and its end, as integers.
   * `CamStashPathRange` (`FUN_00403490`) writes them from a `cam_play` with
   * `flags & 2`; the hooks scene states (2,6) and (2,7) install step the
   * cursor; `Boss4PlayCameraCue` overwrites both with its own cue. One owner,
   * in the data segment -- see `game/camera/rail.ts`.
   */
  g_stashed_path_frame: 0,
  g_stashed_path_end_frame: 0,
  /**
   * `g_rail_frame` — `0x009C70BC`. The frame the stashed rail last drew, as a
   * **float**, which `CameraDriverSelectMode` and
   * `CameraDriverFromDeferredPose` truncate into `g_cam_path_frame`.
   */
  g_rail_frame: 0,
  /**
   * `g_force_rail_advance` — `0x009CA098`. At 1 the stashed rail steps even
   * while the screen shakes or nobody is in play. `EvtOpForceCameraPathAdvance37`
   * (`FUN_0045FA60`) writes it; `ResetSceneOnEnter` zeroes it at `0x0045EE7E`.
   */
  g_force_rail_advance: 0,
  /**
   * `g_player_continue_timer` — 0x009A5CC8 + player*0x130. The continue
   * digit is `>> 12`: `PlayerStateArmContinue` seeds `0x9FFF` and
   * `PlayerContinueCountdown` takes `0x2D` a frame.
   */
  g_player_continue_timer: [0, 0],
  /**
   * `g_player_credit_seen` — the four dwords at 0x009A5C8C + player*0x130:
   * the credit counts the continue countdown last saw, and two words it
   * zeroes beside them. A change restarts the countdown.
   */
  g_player_credit_seen: [[0, 0, 0, 0], [0, 0, 0, 0]] as number[][],
  /**
   * `g_player_gameover_timer` — 0x009A5C88 + player*0x130. 120 frames from
   * `PlayerStateArmGameOver` to state 9.
   */
  g_player_gameover_timer: [0, 0],
  /**
   * `g_player_pending_state` — 0x009A5CA8 + player*0x130. The state a start
   * press asked for while it was held back in state 10.
   */
  g_player_pending_state: [0, 0],
  /**
   * `g_player_no_damage` — 0x009C9FD8 + player*0x7C. Non-zero and
   * `PlayerTakeDamage` takes no life, no rank and no points. The factory
   * options reset `FUN_00401060` zeroes it and nothing in the image writes
   * anything else; what sets it, if anything, is `[open]`.
   */
  g_player_no_damage: [0, 0],
  /**
   * `g_start_lives` — 0x009A34C4. `FUN_0040AB50` loads it from
   * {@link START_LIVES_BY_OPTION} at the options' lives setting, and
   * `PlayerEnterPlay` gives it to every player whose row resets lives.
   */
  g_start_lives: 0,
  /**
   * `g_credits` — 0x009C8E60, stride 8: the credits (continues) left, one
   * shared count unless `g_credits_per_player` is set. `SetBothPlayerCounters`
   * seeds it from `ModeStartCounterValue` when the title menu is confirmed.
   */
  g_credits: [0, 0],
  /** `g_credit_tier` — 0x009C8E64, stride 8. `CreditTiersUpdate`'s 0/1/2. */
  g_credit_tier: [0, 0],
  /**
   * `g_credit_is_continue` — 0x005A4D30 + player*4, what the last spend was
   * for: 0 a start, 1 a continue.
   */
  g_credit_is_continue: [0, 0],
  /** `g_free_play` — 0x009C8E70. 1: every spend succeeds. */
  g_free_play: 0,
  /** `g_credits_per_player` — 0x009C8E74. 0: one shared count. */
  g_credits_per_player: 0,
  /**
   * `g_credits_to_start` — 0x009C8E78. `CreditsBootReset` (`FUN_004066D0`)
   * sets 1, and nothing else writes it.
   */
  g_credits_to_start: 1,
  /**
   * `g_credits_to_continue` — 0x009C8E7C. `CreditsBootReset`
   * (`FUN_004066D0`) sets 1, and nothing else writes it.
   */
  g_credits_to_continue: 1,
  /**
   * `g_title_start_armed` — 0x009A21C0. `TitleMenuUpdateAndSelect` raises it
   * on a mode's confirm; in app state 4 `CreditTrySpend` refuses without it.
   */
  g_title_start_armed: 0,
  /**
   * `g_pad_state` — 0x009C9028. Only the start and continue bits are fed:
   * `8` and `0x80000` are the two players' START that `PadStartPressed`
   * (`FUN_00413230`) tests, `4` and `0x40000` what the continue screen reads.
   * `[port-only]` The page raises a bit for one tick when START is pressed.
   */
  g_pad_state: 0,
  /**
   * `g_pad_held` — 0x009C9020, the held-button word beside `g_pad_state`.
   * Its one reader in the port is `Boss4StateDebugFreeMove` (`FUN_00495E20`),
   * a state nothing enters, which moves the stage-4 boss while bit 8 is held.
   * `[port-only]` in that nothing feeds it: the page raises no held bits, so
   * the word stays 0 and the debug state stands still.
   */
  g_pad_held: 0,
  /**
   * `g_trigger_down` — 0x009C8FD4 + player*0x28, the trigger bit in the aim
   * record `PollPlayerAimInput` (`FUN_0040CBB0`) fills. The continue
   * countdown reads it to skip a digit. `[port-only]` Raised for the tick a
   * shot request of that player falls due.
   */
  g_trigger_down: [0, 0],
  /**
   * `g_training_out` — 0x009A2234. `PlayerUpdateInPlay` sets it instead of
   * the continue when a Training player runs out of lives. What reads it is
   * `[open]`.
   */
  g_training_out: 0,
  /** `g_player_was_hit` — 0x009A5CD0 + player*0x98. */
  g_player_was_hit: [0, 0],
  /**
   * `g_player_damage_overlay_kind` — 0x009A5CD2 + player*0x130. Once named the
   * "hit motion"; its one
   * reader hands it to `DamageOverlaySpawn` as the overlay kind -- see
   * `DamageOverlayKind` in `effects/damage_overlay.ts`.
   */
  g_player_damage_overlay_kind: [0, 0],
  /**
   * `g_player_camera_hook` — 0x009A5CDC + player*0x130. What
   * `PlayerRunCameraHook` calls; the scene-state installers write it.
   */
  // `PlayerCameraHook.None`, spelled as its value: this initialiser runs
  // before `effects/damage_overlay.ts` has finished loading whenever that
  // module is the one imported first, and its enum is not there yet.
  g_player_camera_hook: [0, 0] as PlayerCameraHook[],
  /** `g_damage_overlays` — 0x009A26C0, one 0x14-byte record per player. */
  g_damage_overlays: makeDamageOverlays() as DamageOverlay[],
  /**
   * `g_screen_shake_frames` — 0x009C8E8C. The shake's countdown; a consumed
   * hit restarts it at 0x30.
   */
  g_screen_shake_frames: 0,
  /**
   * `g_screen_shake_pitch` — 0x009CA0E4. How far the camera nods, in units
   * up at a look distance of 1000 -- see `camera/view.ts`.
   */
  g_screen_shake_pitch: 0,
  /** `g_player_hit_count` — 0x009A5C86 + player*0x98. Hits that scored. */
  g_player_hit_count: [0, 0],
  /** `g_head_combo_bonus` — 0x009A5C82 + player*0x98. */
  g_head_combo_bonus: [0, 0],
  /**
   * `g_one_hit_target_kills` — 0x009A244A. Stepped by `OneHitTargetUpdate`
   * (`FUN_00449020`) the frame a class-0x20 actor is shot.
   *
   * What reads it is `[open]`: `FUN_00497640` writes it and `FUN_004525C0`
   * reads and writes it, and neither has been read. It is kept because the
   * class writes it and a snapshot has to carry every word the port writes —
   * and it is **not** `g_enemies_alive`, which class 0x20 never touches.
   */
  g_one_hit_target_kills: 0,
  /**
   * `g_player_score` — 0x009A5C6C + player*0x130, a dword. `ScoreAddForPlayer`
   * (`FUN_004156C0`) is its writer and floors it at 0; `PlayerEnterPlay`
   * clears it on row flag 4.
   */
  g_player_score: [0, 0],
  /** `g_nPlayerFired` — 0x009A5C78. Shots taken, for the accuracy grade. */
  g_nPlayerFired: [0, 0],
  /**
   * `g_nFiringGate` — `0x009C8E00`. Non-zero and the trigger works; zero and
   * it does nothing at all.
   *
   * **It is not "the shutter is open".** `HudDrawShutterState`
   * (`FUN_00413970`) is its only writer inside a stage, and it raises it in
   * states 0, 1 and 6 and drops it in state 5 and at the end of a state-3
   * close — so states 0 and 5 both draw a *closed* shutter and set it to 1 and
   * 0 respectively. A boss intro can be letterboxed and still let you shoot.
   * The port's `HudDrawShutterState` is in `game/hud_shutter.ts`, and it is
   * the only writer here too.
   *
   * The rule it enforces is `PlayerFireAndReloadUpdate`'s (`FUN_00414940`),
   * where the whole fire block sits under `else if (g_nFiringGate != 0)` at
   * `0x004149BE`: with the gate down there is no ammo decrement, no shot
   * count, no `BuildShotRay`, no `PlayerShotEffectSpawn` and no gunshot — the
   * routine returns before all of it. `combat/shot.ts` is where the port does
   * the same.
   *
   * **In `G` rather than on the walker, because the exe has one word and the
   * port must have one field.** `Walker`'s save slice still carries it under
   * the old name, but only as a copy taken from here at save time — the script
   * slice is restored before the game slice, so this is what a load ends up
   * holding either way.
   *
   * BSS, so it starts **down**, and `ResetSceneOnEnter` puts it back down on
   * every scene: nothing raises it until the shutter's first state 0, 1 or 6.
   * All eleven shipped `evt/` tables issue those — 87 ones and 104 sixes
   * across the game — so gating on it does not lock the player out.
   */
  g_nFiringGate: 0,
  /**
   * `g_bHudShutterState` — `0x009CA0F4`. The HUD letterbox, states 0..8 (see
   * `ShutterState` in `game/hud_shutter.ts`).
   *
   * evt `0x1F` stores it and does nothing else; `HudDrawShutterState` turns it
   * into bars and a firing gate once a frame. Gameplay writes it too, and
   * reads it: `BossIntroBannerUpdate` (`FUN_00437AC0`) sets it to 1 at
   * `0x00437F1E` and `Class22FightPhase1` at `0x0049B899`, and **the bosses
   * read it to decide that their fight has started** --
   * `Boss4StateEntranceCarried` (`FUN_004938B0`) at `0x004938F6`, and every
   * one of class 0x14's entrances, `Class14StateEntranceA` (`FUN_00478160`)
   * at `0x0047834E`. The script's accessor in `script/state/shutter.ts`
   * reaches this byte, so there is one owner.
   *
   * 5 at a scene's start, as `ResetSceneOnEnter` leaves it: the bars are shut
   * until the script opens them.
   */
  g_bHudShutterState: 5,
  /**
   * `g_bHudShutterPrev` — `0x009C8E9C`. The state `HudDrawShutterState` last
   * settled on: a state that differs from it seeds the slide, and state 7
   * puts it back. The routine writes it on every path but a blackout's, and
   * `ResetSceneOnEnter` sets it to 5 beside the state.
   */
  g_bHudShutterPrev: 5,
  /**
   * `HudDrawShutterState`'s slide counter -- its task's `+0x50`, 0 shut and
   * 0x28 open. `HudShutterTaskCreate` starts it at 0; the routine seeds it on
   * a change of state and steps it in states 1 and 3.
   */
  g_hud_shutter_counter: 0,
  /**
   * `[port-only]` -- the bars `HudDrawShutterState` drew this frame, for
   * `hud/hud.ts` to put on the screen. See `ShutterBar`.
   */
  g_hud_shutter_bars: [] as ShutterBar[],
  /**
   * The trigger pulls this frame has not resolved yet.
   *
   * `[port-only]`, and it is the one piece of *input* the data segment holds.
   * The engine has no queue — `BuildShotRay` (`FUN_00406110`) writes the
   * per-player shot record from the gun hardware and the game loop reads it on
   * the same frame — but the player's click arrives on a DOM event with no
   * game frame around it, so the intent is recorded here and
   * `ProcessShotRequests` drains it at the head of `GameUpdate`.
   *
   * Two things fall out of that, and both are the point of it. The renderer
   * stops making gameplay decisions: it hands over a segment and the port
   * decides what the segment means. And because the queue is plain data in the
   * snapshot, **it is an input log** — record it per frame and a session
   * replays into a headless run, which is the regression harness this player
   * has never had.
   *
   * Normally empty by the end of the frame that read it.
   */
  g_shot_requests: [] as ShotRequest[],
  /**
   * `g_shot_test_list` — `0x0059D8E8`, with its count `g_shot_test_count`
   * (`0x005A4C80`) as the array's length. What `RegisterForShotTest`
   * (`FUN_00405160`) appends to, one five-dword record per object, and what
   * `ProcessPlayerShots` (`FUN_00404570`) tests the next frame's trigger
   * pulls against before emptying it.
   *
   * Only the classes that register the engine's way are in it — see
   * `combat/shot_test.ts`. Plain records, so a snapshot carries a frame's
   * registrations like any other part of the data segment.
   */
  g_shot_test_list: [] as ShotTestEntry[],
  /**
   * `[port-only]` — the heads the 1-in-4 headshot burst has thrown.
   *
   * The engine allocates each one as a task with its own per-frame routine
   * (`SpawnSeveredHead`, `FUN_0040A130`); this port has a fixed object pool and
   * a snapshot that must survive `clonePlain`, so they are plain records here
   * and `SeveredHeadsTick` steps them. Same shape and same reason as
   * `g_shot_requests` above.
   */
  g_severed_heads: [] as SeveredHead[],
  /** `[port-only]` — see {@link SeveredHead.id}. */
  g_severed_head_seq: 0,
  /**
   * `[port-only]` — the creatures `znjoe` has released.
   *
   * `SpawnBodyCreature` (`FUN_0043E720`) allocates each one as a task running
   * `BodyCreatureUpdate` (`FUN_0043E880`), with no class id at all, so the
   * same reasoning as `g_severed_heads` above applies and for the same two
   * reasons: a fixed object pool, and a snapshot that goes through
   * `clonePlain`. Unlike the heads these are **countable enemies** —
   * `BodyCreatureInit` raises both enemy counts — so an emptied list is not a
   * cosmetic difference. See `game/body_creature.ts`.
   */
  g_body_creatures: [] as BodyCreature[],
  /** `[port-only]` — see {@link BodyCreature.id}. */
  g_body_creature_seq: 0,
  /**
   * `[port-only]` — the props class-0x30 zombies in state 37 are carrying or
   * have thrown. `ZombieStateCarryProp` (`FUN_0045B380`) allocates each one
   * as a task with no class id, so this is a pool of plain records for the
   * same two reasons `g_body_creatures` is. See `game/carried_prop.ts`.
   */
  g_carried_props: [] as CarriedProp[],
  /** `[port-only]` — see {@link CarriedProp.id}. */
  g_carried_prop_seq: 0,
  /**
   * `[port-only]` — the blood `SpawnBloodSprayAtPoint` (`FUN_00430C50`) has
   * put at a point rather than on a bone. `game/effects/blood.ts`.
   */
  g_point_blood_sprays: [] as PointBloodSpray[],
  /** `[port-only]` — see {@link PointBloodSpray.id}. */
  g_point_blood_spray_seq: 0,
  /**
   * `[port-only]` — the sprite-effect objects `SpawnSpriteEffectFromParams`
   * (`FUN_004073B0`) has allocated: impacts, ricochets, splashes and the
   * boss bursts. Plain records for the same reason as `g_severed_heads`.
   */
  g_sprite_effects: [] as SpriteEffect[],
  /** `[port-only]` — see {@link SpriteEffect.id}. */
  g_sprite_effect_seq: 0,
  /**
   * `[port-only]` — the slot-strip objects `SpawnPropStripEffect`
   * (`FUN_0043FCA0`) has allocated. `game/effects/prop_strip.ts`.
   */
  g_prop_strip_effects: [] as PropStripEffect[],
  /** `[port-only]` — see {@link PropStripEffect.id}. */
  g_prop_strip_effect_seq: 0,
  /**
   * `[port-only]` — the rings `SpawnWaterRing` (`FUN_004567C0`) has put on a
   * wet surface. `game/effects/water_ring.ts`.
   */
  g_water_rings: [] as WaterRing[],
  /** `[port-only]` — see {@link WaterRing.id}. */
  g_water_ring_seq: 0,
  /**
   * `[port-only]` — the canal water tasks `PlaceWaterSurface`
   * (`FUN_00462F70`, class 0x41 type 1) has allocated. `game/class41/water.ts`.
   */
  g_water_surfaces: [] as WaterSurface[],
  /** `[port-only]` — see {@link WaterSurface.id}. */
  g_water_surface_seq: 0,
  /**
   * `[port-only]` — the stage-2 car tasks `St2CarSpawn` (`FUN_00452120`) has
   * allocated, which `RescueTargetInit` (`FUN_00451720`) is the only caller
   * of. `game/class21/car.ts`; `render/rigs.ts` draws the car from these.
   */
  g_st2_cars: [] as St2Car[],
  /** `[port-only]` — see {@link St2Car.id}. */
  g_st2_car_seq: 0,
  /**
   * `[port-only]` in shape — what `WaterSurfaceUpdate` (`FUN_0046E3A0`) has
   * done to each tile's model, which the engine rewrites in place: one entry
   * per slot the walk has run on. See {@link WaterSurfaceUv}.
   */
  g_water_surface_uv: [] as WaterSurfaceUv[],
  /**
   * `[port-only]` — the owl's and the fish's effect tasks, and the ring task
   * the fish's corpse leaves on the water: `game/effects/owl.ts`,
   * `game/effects/fish.ts` and `game/effects/ring_effect.ts`. Each is an
   * `ActorAlloc`'d task in the engine; here each kind is a pool of plain
   * records, stepped after the actors, which is where the task list runs them.
   */
  g_owl_feathers: [] as OwlFeather[],
  g_owl_ground_rings: [] as OwlGroundRing[],
  g_owl_water_splashes: [] as OwlWaterSplash[],
  g_fish_blood_clouds: [] as FishBloodCloud[],
  g_fish_water_splashes: [] as FishWaterSplash[],
  g_fish_surface_rings: [] as FishSurfaceRing[],
  g_ring_effects: [] as RingEffect[],
  /** `[port-only]` — the seven pools' ids, one sequence between them. */
  g_creature_effect_seq: 0,
  /**
   * `[port-only]` — the blood `SpawnBloodSpray` (`FUN_00407310`) and
   * `SpawnBoneHitSprite` (`FUN_00407200`) have allocated. Each one holds an
   * actor and a bone, not a position, because the engine re-reads the bone
   * every frame it draws.
   */
  g_blood_sprays: [] as BloodSpray[],
  /** `[port-only]` — see {@link BloodSpray.id}. */
  g_blood_spray_seq: 0,

  // -- what leaves the gun -----------------------------------------------
  /** `g_shot_flash_ring` — 0x009A2960, six records a player. */
  g_shot_flash_ring: makeShotFlashRing() as ShotFlash[],
  /** `g_shot_tracer_ring` — 0x009A2460, the round itself. */
  g_shot_tracer_ring: makeShotTracerRing() as ShotTracer[],
  /** `g_shot_weapon_ring` — 0x009A2700, Original Mode weapon kind 4 only. */
  g_shot_weapon_ring: makeShotWeaponRing() as ShotWeaponEffect[],
  /** `g_shot_effect_cursor` — 0x009CA09C, which ring slot the next shot fills. */
  g_shot_effect_cursor: [0, 0] as number[],
  /**
   * `g_shot_hit_something` — 0x009C9010. Written by `ProcessPlayerShots`
   * (`FUN_00404570`) when this frame's shot found any candidate; its one
   * reader kills the tracer on its second frame.
   */
  g_shot_hit_something: [0, 0] as number[],
  /**
   * `g_original_weapon_kind` — 0x009A2249, +0x09 of the per-player Original
   * Mode block. `ResetOriginalModeLoadout` (`FUN_0048A0D0`) seeds it with 0
   * and the port has no pickup that changes it, so every arm behind it is
   * transcribed and unreached. See {@link OriginalWeaponKind}.
   */
  g_original_weapon_kind: [0, 0] as number[],

  // -- difficulty --------------------------------------------------------
  /** `g_difficulty` — 0x009C8E94. Scales spawn HP only. */
  g_difficulty: 2,
  /**
   * `g_damage_rank_pending` — 0x009A3794. `PlayerTakeDamage` subtracts 2;
   * `UpdateDamageRank` adds it into the rank next frame and clears it.
   */
  g_damage_rank_pending: 0,
  /**
   * `g_rank_clock` — 0x009C8A7C. Frames since the rank last fell (or since
   * `ResetDamageRank`, which sets 1); `RunSceneTasksAndTimers` counts it while
   * `g_rank_clock_on`, and every 0x708 of them `UpdateDamageRank` raises the
   * rank.
   */
  g_rank_clock: 0,
  /** `g_rank_clock_on` — 0x009A2C30. `ResetDamageRank` raises it. */
  g_rank_clock_on: 0,
  /**
   * `g_rank_players_seen` — 0x009C8E82, `g_players_in_play` as
   * `UpdateDamageRank` last saw it; a player joining raises the rank by 4.
   * `CommitAppState` zeroes it.
   */
  g_rank_players_seen: 0,
  /** `g_rank_attackers_seen` — 0x009C8E86, the same for `g_max_attackers`. */
  g_rank_attackers_seen: 0,
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
   * `g_camera_blocks` — `0x009A6040` (block 0's `+0x40`), and
   * `g_camera_world_to_view` — `0x009A6000` (`+0x00`): the view-to-world and
   * world-to-view matrices `UpdateSceneViewAndLight` (`FUN_00401F40`) builds
   * from the block's eye and angles at the end of `CameraActorTick`, sixteen
   * floats each in the matrix stack's own layout. Everything after the camera
   * actor in the frame -- the players, the shot test, every actor's
   * `ActorRegisterCameraPoint` -- sees the camera through these, and the draw
   * places the three.js camera from them. See `camera/view.ts`.
   */
  g_camera_view_to_world: MatIdentity(),
  g_camera_world_to_view: MatIdentity(),
  /**
   * `g_camera_index` — `0x009C6F00`. Which of the four camera blocks the view
   * is built from and the shake nods. `set_global` (`EvtActionSetGlobal14`),
   * `CameraBlocksReset` and `CameraResetForPathShot` write it, and every
   * shipped write is 0 -- the only block the port has.
   */
  g_camera_index: 0,
  /**
   * `g_cam_path_target` — 0x009C70D8. The deferred pose block's target, and
   * the fallback `SelectCameraLookAtTarget` uses when nothing is registered.
   *
   * Written by the stashed rail's hooks and `CameraArmStashedPath` (the path's
   * own target channels at the rail frame), and by the minor-4 and minor-6
   * starters (thirty units ahead of the block's eye). A plain `cam_play` never
   * writes it: after one, the fallback aims wherever the last of those left.
   */
  g_cam_path_target: vec3(),
  /**
   * `g_cam_path_eye` — `0x009C70C0`, and its angle words `g_cam_path_pitch_bams`
   * / `g_cam_path_yaw_bams` / `g_cam_path_roll_bams` (`0x009C70CC`/`D0`/`D4`):
   * the **deferred pose block**, laid out as the camera block's `+0x80` on --
   * eye, pitch, yaw, roll, then `g_cam_path_target` at `+0x18`.
   *
   * The stashed rail (`CameraStepRailTick`, `CameraPlayStashedPath`) and
   * `CameraArmStashedPath` evaluate the path into it; `CameraSnapToPathEye`
   * copies the block's eye in. The camera block reaches it only through the
   * drivers: `CameraEaseBlockEyeToPathPose` eases or snaps the block eye onto
   * it, `SelectCameraLookAtTarget` falls back to its target, and
   * `CameraDriverFromDeferredPose` copies the whole of it across.
   */
  g_cam_path_eye: vec3(),
  g_cam_path_pitch_bams: 0,
  g_cam_path_yaw_bams: 0,
  g_cam_path_roll_bams: 0,
  /**
   * `g_camera_eye_x/y/z` — `0x009C71E0`, and `g_camera_pitch_bams` /
   * `g_camera_roll_bams` (`0x009C71EC`, `0x009C71F4`) beside
   * {@link g_camera_yaw_bams}: the **gameplay eye**, where the enemies measure
   * to. Not the camera: only the scene state's hook writes it (the rail at the
   * pose's eye less fifteen in y, the held eye, the view-angle camera fifteen
   * units down its own axis), and `UpdateSceneViewAndLight` draws from the
   * block. See `camera/hooks.ts`.
   *
   * Read by routines with no `ClassFrame` as well: `EnemyZombieInit`
   * (`FUN_00452DA0`) and `EnemyThrowerInit` (`FUN_00449620`) seed the head's
   * aim toward `eye + (0, 15, 0)` from these three words. A spawn runs in the
   * interpreter's task, ahead of this frame's hook, so it reads what the
   * previous frame's hook wrote, as the engine's does. `CameraClearHookAndPose`
   * (`FUN_0040C340`) zeroes all six words on a scene load. `[proved]`
   */
  g_camera_eye: vec3(),
  g_camera_pitch_bams: 0,
  g_camera_roll_bams: 0,
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
   * **Which of two rules produces it depends on the shot**, and the shot says
   * so: `EvtActionFinishSequence21` installs a per-frame driver out of
   * `g_camera_action_starters` (0x00576B20), indexed by the scene-state minor
   * it has just entered. See {@link g_evt_action_handler}.
   *
   * * Minors 4 and 6 — 572 of the 836 `finish_sequence` sites — install
   *   `CameraDriverSelectMode` (`FUN_00402650`), which clears this on every
   *   frame {@link g_camera_mode} is not
   *   {@link CameraMode.HandBackToPath}, and only `CameraTurnOntoPathTarget`
   *   (`FUN_00402740`) raises it again, on the frame the eased aim catches the
   *   path's own target.
   * * Minor 7 installs `CameraDriverFromDeferredPose` (`FUN_00402E00`), which
   *   re-derives it from `g_enemy_slots` every frame with no turn at all.
   *
   * Measured over the shipped scripts, 267 of the 278 room-clear gates wait
   * under the first rule and 5 under the second.
   */
  g_camera_free: 0,
  /**
   * `g_camera_mode` — 0x009C6F20. The index `CameraDriverSelectMode`
   * (`FUN_00402650`) writes and then dispatches through `g_camera_mode_hooks`
   * (`0x00576CBC`).
   *
   * It is recomputed from scratch every frame — the "keep what was there" arm
   * needs {@link g_camera_hand_back_variant} to be negative and nothing ever
   * makes it so — which is why `EvtActionFinishSequence21`'s seed of 3 never
   * decides anything. Kept because the engine keeps it, and because the panel
   * can show it.
   */
  g_camera_mode: 0,
  /**
   * `g_camera_hand_back_started` — 0x009C6F2C.
   *
   * Raised by `CameraTurnOntoPathTarget` on the first frame of the turn back
   * onto the rail and cleared on the frame the aim converges, in the same
   * breath as `g_camera_free`. `CameraDriverSelectMode` clears it on every
   * frame the mode is not 2. It only separates the first frame of a turn from
   * the rest, and both do the same work, so nothing downstream reads it.
   */
  g_camera_hand_back_started: 0,
  /**
   * `g_camera_hand_back_variant` — 0x009C6F2E. Which counter the hand-back
   * watches, and which routine performs it.
   *
   * `CameraResetForPathShot` (`FUN_004031E0`) is its only writer and it writes
   * **0**, at `0x0040322D`, so every shot in the shipped game watches
   * `g_enemies_alive` and turns with `CameraTurnOntoPathTarget`. Modelled as a
   * field rather than folded away because two separate routines branch on it,
   * and because it is what makes the `rate = 0` snap in
   * `CameraTrackEnemiesTick` (`0x00402A12`) dead code.
   */
  g_camera_hand_back_variant: 0,
  /**
   * `g_evt_action_handler` — `0x009A610C`, as the port's `EvtActionHandler`
   * identity: the routine `EvtRunQueuedActions` calls once a frame from
   * inside `CameraActorTick`. The ten `queue_event` actions are dequeued into
   * it, and the persistent ones put their own per-frame routine there -- a
   * `cam_play`'s `CamAdvancePathFrame`, a `finish_sequence`'s starter and
   * then its driver. See `camera/actions.ts`.
   */
  g_evt_action_handler: 0,
  /**
   * `g_evt_action_advance` — `0x009A1A10`. What `EvtRunQueuedActions` does
   * with the ring after the handler's call: 0, the handler is still running;
   * 1, it finished -- dequeue the next action and call it now; 2, dequeue it
   * and call it next frame. Every retiring handler writes 1;
   * `finish_sequence` writes 0; `set_action_drain_mode` writes its operand;
   * a scene starts at 2.
   */
  g_evt_action_advance: 2,
  /**
   * The ring of queued actions -- `0x009C9060`, sixteen instruction pointers
   * between the read cursor `0x009A34D0` and the write cursor `0x009CA108` --
   * as the records themselves. `queue_event` pushes; `EvtRunQueuedActions`
   * shifts.
   */
  g_evt_action_ring: [] as { sel: number; args: number[] }[],
  /**
   * `g_evt_action_operands` — `0x009A6184`, the eight dwords a dequeued
   * action's operands are copied into. A handler reads them every frame it
   * runs, and `hold_camera_preset` counts its first one down in place.
   */
  g_evt_action_operands: [0, 0, 0, 0, 0, 0, 0, 0],
  /**
   * `g_camera_starter_reseats` — `0x009C6F3C`. While set, the three camera
   * action starters run `CameraResetForPathShot` and seat before installing
   * their driver. Every writer stores 1.
   */
  g_camera_starter_reseats: 1,
  /**
   * `g_camera_update_hook` — `0x009C7080`, the scene state's camera routine,
   * as the port's {@link CameraUpdateHook} identity. `CameraUpdateTick` jumps
   * through it once a frame, after the camera actor. See `camera/hooks.ts`.
   */
  g_camera_update_hook: 0,
  /**
   * `g_cam_path_cursor` — `0x009A6144`, the next frame `CamAdvancePathFrame`
   * publishes, and `g_cam_path_end_frame` — `0x009A6148`, the last of the
   * range. Camera block 0's `+0x104` and `+0x108`.
   */
  g_cam_path_cursor: 0,
  g_cam_path_end_frame: 0,
  /**
   * `g_cam_path_frames_left` — `0x009C6F28`. `end - cursor` as the last path
   * routine left it: `CamAdvancePathFrame` and the two rail hooks write it
   * every frame, `CameraHoldEyeTick` writes -1, the resets `0x7FFFFFFF`.
   * `wait_camera_path_frame 0` reads it, and `CameraTrackEnemiesTick` arms
   * the branch preview while it is negative.
   */
  g_cam_path_frames_left: 0x7fffffff,
  /**
   * `g_camera_ease_eye` — `0x009C6F33`. Set, `CameraEaseBlockEyeToPathPose`
   * eases the block's eye onto the pose a sixteenth a frame; clear, it snaps.
   * `EvtActionSetFlag15` raises it; `ResetSceneCombatState` and
   * `goto_scene_state` clear it.
   */
  g_camera_ease_eye: 0,
  /**
   * `g_evt_cam_override_valid` — `0x009C6FD8`, and the three `{path, frame}`
   * pairs `g_evt_cam_override_pairs` (`0x009C6FDC`) that `store_six`
   * (`EvtActionStoreSixOperands60`) writes with it. `CameraArmStashedPath`
   * re-arms the camera on the pair `g_script_branch_var` picks.
   */
  g_evt_cam_override_valid: 0,
  g_evt_cam_override_pairs: [] as { path: number; frame: number }[],
  /**
   * `g_camera_impulse_*` — `0x009C70F8`..`0x009C7104`, `0x007C1760`/`70`:
   * scene state (2,5)'s push. See `CameraImpulseShakeTick` in
   * `camera/hooks.ts`. No shipped script enters (2,5).
   */
  g_camera_impulse_yaw_bams: 0,
  g_camera_impulse_request: 0,
  g_camera_impulse_lock: 0,
  g_camera_impulse_frames: 0,
  g_camera_impulse_offset: vec3(),
  g_camera_impulse_velocity: vec3(),
  /**
   * `g_camera_use_fixed_y` — `0x009C70F4`. At 1 the path hooks put the
   * gameplay eye at `g_camera_fixed_eye_y` rather than fifteen below the
   * pose. Evt opcode 0x36 writes it; no shipped script uses it.
   */
  g_camera_use_fixed_y: 0,
  /**
   * `g_cam_roll_enabled` — `0x009A21B0`. `CamEvalPath7` evaluates a path's
   * roll channel only while this is set; evt opcode 0x35 writes it and
   * `ResetSceneCombatState` clears it.
   */
  g_cam_roll_enabled: 0,
  /**
   * `g_queued_events_pending` — `0x009A2C8C`. Outstanding queued actions:
   * `queue_event` adds one, every handler takes one back as it completes --
   * except `EvtActionFinishSequence21`, whose persistent driver
   * `goto_scene_state` retires. `wait_queued_events_done` blocks on it. In
   * `G` because `CamAdvancePathFrame`, a game routine, is what retires a
   * playing `cam_play`. See `script/state/queued.ts`.
   */
  g_queued_events_pending: 0,
  /**
   * `g_evt_wait_alive_hysteresis` — 0x007DCCA8. The extra frame
   * `wait_enemies_alive` (0x44) costs, and nothing else in the program reads
   * or writes it — `0045FC42` reads, `0045FC4B` and `0045FC60` write, and
   * those three are every reference there is.
   *
   * `EvtOpWaitEnemiesAlive44` (`FUN_0045FC10`) requires `0 < this` before it
   * will pass, zeroes it when it does, and increments it on every frame it
   * does not. It is **not** reset when the count condition fails, so the
   * handler does not require the condition to hold twice running: it requires
   * that this instance of the instruction has already been evaluated once and
   * refused. On top of `g_evt_yield`'s first-visit yield, that makes 0x44 the
   * only wait in the VM that cannot pass until its third frame on the program
   * counter — and 0x43, the same handler without this term, the only other
   * one that reads a counter this port also keeps.
   */
  g_evt_wait_alive_hysteresis: 0,
  /**
   * `g_enemy_slots` — 0x009A5EC0. Sixteen `{u8 occupied; void *actor}`
   * records, stride 8, **indexed**: slots 0 and 1 are the permit holders the
   * last fill dealt and every other candidate sits at its distance rank plus
   * two, so the table has holes. `at` stands in for the pointer. See
   * `camera/slots.ts`.
   */
  g_enemy_slots: makeCameraSlots(),
  /**
   * `g_camera_candidates` — 0x005A4DC8. The `{key, obj}` pairs
   * `RegisterForCameraTracking` (`FUN_00408EC0`) has filed since the last
   * `UpdateCameraEnemySlots` (`FUN_00408DD0`), at most fourteen, in the order
   * they registered. The fill sorts and empties it.
   */
  g_camera_candidates: [] as CameraCandidate[],
  /**
   * `g_camera_candidate_count` — 0x009CA93C. How many objects have called
   * `RegisterForCameraTracking` since the last fill -- the actors and the
   * carried props alike. `EvtOpWaitTargetsClear47` (`FUN_0045FD20`) waits for
   * it to reach zero; the interpreter reads it before the fill empties it, so
   * it is the count the previous frame's objects registered.
   */
  g_camera_candidate_count: 0,

  // -- the water, class 0x16/0x17's plane and class 0x51's four slots -----
  /**
   * `g_water_level` — 0x007DCBB0. The height of the water plane.
   *
   * A data initialiser puts -24.90 there, and it is **rewritten by every
   * class-0x51 group header**: a descriptor whose `tail+0x0E` is 6 is not a
   * fish at all, it is the surface, and `FishInit` (`FUN_00438540`) copies its
   * `tail+0x00` float here before killing itself. Class 0x16's wave field
   * keeps a plane of its own ({@link g_water_wave_field}), which nothing
   * copies here.
   */
  g_water_level: -24.9,
  /**
   * `g_frog_bone1_on_entry` — 0x007DCBB8, three floats beside the water
   * level. Class 0x11's: `FrogUpdate` (`FUN_0043A1E0`) writes it before any
   * state runs, as bone 1 where the **last** draw left it, carried into the
   * world through this frame's camera block; `FrogPushOutOfActorCollision`
   * (`FUN_0043A500`) reads its x and z as where the frame's travel started.
   * Nothing else touches it, and y is written and never read.
   */
  g_frog_bone1_on_entry: vec3(),
  /**
   * `g_water_wave_field` — 0x007DCC4C. The block `WaterFieldCreate`
   * (`FUN_00442290`, class 0x16) allocates: a plane, a slot mask, a count of
   * sources that have ticked and eight wave sources, which class 0x17's
   * spawns add (`game/class16/`, `game/class17/`).
   * `WaterFieldSampleHeight` (`FUN_00442390`) is the surface at a point, and
   * the stage-2 boss is its only reader. Null until a class-0x16 spawn runs.
   */
  g_water_wave_field: null as WaterWaveField | null,
  /**
   * `g_class14_foot_contacts` — 0x009A3500, four `{f32 strength; f32 x, y,
   * z}` records: bone 15's toe, bone 12's toe, bone 15's heel, bone 12's heel,
   * as `Class14AdvanceMotionAndPublishPoints` (`FUN_00476AD0`) publishes them
   * every frame the stage-2 boss's feet are live. The strengths come from the
   * clip's contact cue; the y-follow reads `[0]` and `[1]` to decide which
   * foot is planted.
   */
  g_class14_foot_contacts: [
    { strength: 0, x: 0, y: 0, z: 0 }, { strength: 0, x: 0, y: 0, z: 0 },
    { strength: 0, x: 0, y: 0, z: 0 }, { strength: 0, x: 0, y: 0, z: 0 },
  ],
  /**
   * `g_water_attack_slots` — 0x009A2C20, four dwords.
   *
   * The only thing that lets a class-0x51 fish leave the surface, and the
   * reason four of them can be in the air at once and no more.
   * `FishClaimSlotAndLunge` (`FUN_00438850`) claims one and the index is also
   * *where* the fish leaps to — the four are points in the camera's own space.
   * `SpawnWaterEnemyAt` (`FUN_00438640`) refuses to place one at all while any slot
   * is taken, which is what paces the stage-2 boss's summoning rounds.
   */
  g_water_attack_slots: [0, 0, 0, 0],
  /**
   * `[port-only]` — the next spawn address to give an actor **nothing placed**.
   *
   * The port identifies an actor by the evt offset of the descriptor it came
   * from, and `SpawnWaterEnemyAt` (`FUN_00438640`) has no descriptor at all: the
   * stage-2 boss calls it with three floats. Negative, and counting down, so
   * such an actor can never collide with a real descriptor offset and
   * `ActorByAt` still answers.
   */
  g_summoned_actor_at: -1,
  /**
   * `[port-only]` — the spawn addresses `SpawnSlotActors` has already built.
   *
   * There is no such list in the engine, and there cannot be: the spawn opcode
   * builds an object once, in the step that holds it, and never looks again.
   * The port materialises slot-drawn actors from the walker's live spawn list
   * every frame, so it needs to remember which of them it has made — otherwise
   * an actor that despawns under its own state machine comes straight back.
   * An entry is dropped when the script stops listing that spawn.
   */
  g_slot_actors_built: [] as number[],

  // -- the owls, class 0x43 ----------------------------------------------
  /**
   * `g_class43_attack_token` — 0x008111E0. **-1 means nobody is attacking.**
   *
   * One permit for a whole flock, and the reason owls come at you in turn
   * rather than all at once: `OwlStateWaitLaunchDelay` and
   * `OwlStateCircleHoldingPoint` refuse to begin a run-in unless they read -1,
   * the launch stamps the owl's own member index into it, and the pull-out and
   * the death give it back. It is **not** `g_attack_permits`: class 0x43 never
   * touches that array at all.
   */
  g_class43_attack_token: -1,

  // -- the bats, class 0x46 ----------------------------------------------
  /**
   * `g_bat_members` — 0x007DC918. The live class-0x46 actors, 25 slots per
   * sub-type, indexed `subtype * 0x19 + member`.
   *
   * **It is not bookkeeping.** `BatWingUpdate` (`FUN_0042F660`) reads it to
   * find the body it is drawn on and despawns itself the frame the slot goes
   * empty, which is the whole mechanism by which a bat's wings follow it and
   * die with it. Every bat re-stamps its own slot at the top of its update and
   * clears it on the way out.
   *
   * `[port-only]` the entries are spawn addresses rather than pointers, so the
   * array survives `clonePlain`. 0 is the engine's empty slot and no spawn
   * address is 0, so the sentinel carries over unchanged.
   *
   * The four sub-type-0 flights all share slots 0..5, which is safe only
   * because no two of them are ever in play at once.
   */
  g_bat_members: [] as number[],
  /**
   * `[port-only]` as a pool: the `0x50`-byte objects `SpawnBatSplash`
   * (`FUN_0042F980`) allocates, each running `BatSplashUpdate`
   * (`FUN_0042F930`). Plain records for the same reason as
   * `g_severed_heads`. `game/class46/splash.ts`.
   */
  g_bat_splashes: [] as BatSplash[],
  /** `[port-only]` — see {@link BatSplash.id}. */
  g_bat_splash_seq: 0,

  // -- the horde, class 0x40 ---------------------------------------------
  /**
   * `g_horde_members` — 0x007DCC20. Ten slots, one per member index.
   *
   * Every member stamps its own slot at the end of each update, the corpse
   * clears it when it despawns, and three things read it: the wander's
   * neighbour test, the dive turn in {@link Globals.g_horde_diver} (which
   * skips an empty slot) and the stage-2 deformed prop.
   *
   * `[port-only]` spawn addresses rather than pointers, so the array survives
   * `clonePlain`; 0 is the engine's empty slot and no spawn address is 0.
   */
  g_horde_members: [] as number[],
  /**
   * `g_horde_live_count` — 0x007DCBD0. How many members the placer made, less
   * the ones killed while more than one was left. The last one's corpse keeps
   * the camera's attention while this is 1.
   */
  g_horde_live_count: 0,
  /**
   * `g_horde_diver` — 0x007DCBD4. The member index whose turn it is to dive.
   * One at a time: nobody else may start one, and every path out of a dive or
   * a refusal hands the turn to the next live index.
   */
  g_horde_diver: 0,
  /**
   * `g_horde_last_dive_frame` — 0x007DCC1C. `g_frame_counter` when the last
   * dive started; the next may not start for ninety frames.
   */
  g_horde_last_dive_frame: 0,
  /**
   * `g_horde_emerged` — 0x007DCC48, a byte. Raised by the first member to
   * leave its hold; the emerge prop waits for it.
   */
  g_horde_emerged: 0,
  /**
   * `[port-only]` — the next spawn address a class-0x40 effect object takes.
   *
   * The engine's splash and spark are tasks with no descriptor; the port's
   * pool is keyed on `at`, and two splashes from one member cannot share one.
   * A counter in `G` rather than anywhere else so a snapshot restores it.
   */
  g_horde_effect_seq: 0,
  /**
   * `[port-only]` — how many class-0x40 placers each listed spawn address has
   * been built as, keyed by address.
   *
   * The engine builds a placer every time the spawn instruction runs, and
   * stage 1 runs the same selector-2 descriptor in blocks 7, 8 and 12. The
   * slot-actor bookkeeping builds an address once while it is listed, which
   * is right for an actor that lives while it is listed and wrong for one
   * that `ActorKill`s itself on its first frame; `SpawnHordePlacers` counts
   * instructions instead.
   */
  g_horde_placers_built: {} as Record<string, number>,
  /**
   * `g_crosshair_x` — 0x009A5C70, and its `+0x04` beside it: per player,
   * where each player is aiming, in screen pixels.
   *
   * `[port-only]` in shape. The port has no crosshair in pixels; what it has
   * is the ray each shot request carries, which is that crosshair already
   * unprojected. `FireShotRequest` records the last one per player, and a
   * routine that unprojects the crosshair at some depth -- class 0x40's
   * `SpawnEmergePropSparkAtCrosshair` -- takes the point on it instead.
   */
  g_crosshair_ray: [null, null] as ({ origin: { x: number; y: number;
                                                z: number };
                                      dir: { x: number; y: number;
                                             z: number } } | null)[],

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
  /**
   * `[port-only]` — the 0x2B4 objects `BreakablePropSpawnShatter`
   * (`FUN_00465170`) has allocated, fifteen pieces each, stepped by
   * `BreakablePropShatterUpdate`. `game/class41/shatter.ts`.
   */
  g_prop_shatters: [] as PropShatter[],
  /** `[port-only]` — see {@link PropShatter.id}. */
  g_prop_shatter_seq: 1,

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
   * `g_scene_state_major_entered` — 0x009C6F08. The copy of the scene state's
   * major that only a full `EvtEnterSceneState` (`FUN_00403BD0`) stamps.
   *
   * **`IsPlayerAttackable` requires it to be 2** — the `cam/` path camera row
   * of `g_scene_state_table` — so no enemy commits an attack while the follow
   * camera or a scripted view-angle turn is driving. Pushed from the walker's
   * own `sceneState`, which already tracks it.
   */
  g_scene_state_major_entered: 0,
  /**
   * `g_scene_state_major` — 0x009C6F0C, the live major beside the stamped
   * one. `PlayerTakeDamage` floors lives at one only when **both** are off 2.
   *
   * `[diverges]` The walker keeps one pair, the stamped one, so the port
   * pushes the same value into both. They differ only across a partial enter
   * (`FUN_00403BB0`), which leaves the stamp alone.
   */
  g_scene_state_major: 0,
  /**
   * `g_scene_state_minor` — `0x009C6F14`, and `g_scene_state_minor_entered`
   * — `0x009C6F10`: the minor halves of the two pairs. `EvtEnterSceneState`
   * writes both, its unstamped twin the live one only, and
   * `UpdateSceneViewAndLight` copies live into stamped at the end of every
   * camera actor's task. See `camera/hooks.ts`.
   */
  g_scene_state_minor: 0,
  g_scene_state_minor_entered: 0,
  /**
   * `g_app_state` — 0x009C8E98. Which of the game's top-level screens is
   * running. **The port sits at {@link AppState.InPlay}, 6**, because that
   * is the state the engine is in while a stage is being played, and the port
   * is never anything else.
   *
   * It used to sit at 0 with a comment calling every clause that reads it
   * inert. That was wrong in a way that only bites once something transcribes
   * the *other* read: `ResolveHit` (`FUN_00409430`) raises `obj+0x34 |= 0xE00`
   * on the actor it hits whenever this is **not** 6, and those three bits stop
   * the part swap, the dismemberment and the hit result. At 0 that fires on
   * every shot in the game.
   *
   * **Why 6 is in play**, `[proved]`, two ways:
   *
   * 1. `FUN_00414FC0` — the start-button-with-a-credit path — calls
   *    `RequestAppState(6)` (`FUN_0040E850`) and sets the player's state.
   *    Pressing Start *is* the transition into 6.
   * 2. `CommitAppState` (`FUN_0040E860`) ends with
   *    `if (pending < 6 || pending > 7) g_player_state = 9` for both players.
   *    6 and 7 are the only states it leaves a live player alone in, and 7 is
   *    the game-over arm `FUN_00460530` requests when the continue countdown
   *    expires.
   *
   * A third, independent one: `FUN_0049F380` stores **6 directly** —
   * `MOV dword ptr [0x009c8e98], 0x6` (`c705988e9c0006000000`) at
   * `0x0049F546`, beside `[0x009C7019] = 1`.
   *
   * That third one is also why `CommitAppState` is **not** the only writer,
   * which an earlier reading of this global claimed. `g_app_state` has five
   * writers across six sites — `FUN_0049F380` twice, `CommitAppState`,
   * `FUN_0040E4A0`, `FUN_0040A920` and `FUN_0041E1D0` — and at least two of
   * them store a literal straight into the word rather than going through
   * `RequestAppState`. So a state change does **not** always land on a frame
   * boundary, and code that assumes it does would be wrong.
   *
   * The other values the port has any use for: **5 is the attract demo** —
   * `RunAttractDemo` (`FUN_00426800`) only advances while it is 5, and that is
   * `IsPlayerAttackable`'s override — and **0x10 is boot**, before which
   * nothing is drawn. 3, 4, 9, 0x0A, 0x0B, 0x0C and 0x0F are the shell's other
   * screens and what each one *is* stays `[open]`.
   *
   * There is no `g_app_state_pending` (0x007C17A0) here: the port has no
   * screen to change to, so the request/commit pair has nothing to do.
   */
  g_app_state: AppState.InPlay as number,
  /**
   * `g_player_state` — 0x009A5C62 + player*0x98, s16. See {@link PlayerState}.
   * 5 is *in play*, `IsPlayerAttackable`'s third clause and the gate on every
   * scripted strike that does not take a permit -- the bat's, the horde's, the
   * body creature's. `AdvanceToNextScene` (`FUN_0045FFF0`) puts a player at 5
   * back to 2 for the duration of a scene load, and 8, 9 and 4 are the
   * name-entry, not-participating and credit states.
   *
   * Written only by `game/player_shell.ts` and the two app-state routines,
   * which are the engine's writers: boot leaves 9, a start press 0 or 3,
   * `PlayerEnterPlay` (`FUN_00414770`) 5, the stage step 2, running out 4.
   * Until 2026-09-19 the port seeded it -- `[0, 0]`, then `[5, 9]` -- and
   * everything that tests 5 directly, the bats' and the horde's strikes,
   * silently never landed in the page while their tests set 5 by hand (L49).
   */
  g_player_state: [PlayerState.Out, PlayerState.Out] as number[],
  /**
   * `g_nRunPhase` — 0x009C90A4. See {@link RunPhase}: the port runs phases
   * 2, 3, 4 and 11, the in-play phase and the continue screen.
   */
  g_nRunPhase: RunPhase.InPlay as number,
  /** `g_app_state_pending` — 0x007C17A0. -1 for none. */
  g_app_state_pending: -1,
  /**
   * `g_screen_furniture_flags` — 0x009A5900. Bit 0 lets a start press take
   * effect at once (else it waits in state 10); bit 1 is raised by
   * `CommitAppState` and required by `PlayerTryStartPress`. Bits `0x10` and
   * `0x20` are the two screen cards' — see {@link ScreenFurniture}.
   */
  g_screen_furniture_flags: 0,
  /**
   * `g_game_over_timer` — 0x009CA0F8. `GameOverRunPhase`'s phase timer:
   * 200 frames of fly-over, 180 of logo.
   */
  g_game_over_timer: 0,
  /**
   * `[port-only]` -- `GameOverLogoTask`'s frame counter (its task's
   * `+0x34`), -1 while there is no such task.
   */
  g_game_over_logo_frame: -1,
  /**
   * `[port-only]` -- the live `ScreenSpriteAnimSpawn` tasks, in allocation
   * order. See `game/game_over.ts`.
   */
  g_screen_sprite_anims: [] as ScreenSpriteAnim[],
  /**
   * `g_game_over_route_done` — 0x007DCCE4. The route map sets 1 when it has
   * drawn the whole route; the trigger sets -1, which ends the screen.
   */
  g_game_over_route_done: 0,
  /**
   * `g_game_over_players` — 0x009C8E88, u16. `g_max_attackers` as it stood
   * when the run asked for the game-over screen: `RunPhaseContinueCountdown`
   * and `RunPhaseNoContinueWait` copy it on the line before
   * `RequestAppState(7)`, and they are its only writers. Where the bodies
   * stand and when each falls read it. `[proved]`
   */
  g_game_over_players: 0,
  /**
   * `GameOverCameraFlyTick`'s own counter -- its task's `+0x50`, the fly-over
   * path frame the next tick evaluates. `GameOverSpawnCameraFly` starts it at
   * 10.
   */
  g_game_over_fly_frame: 0,
  /**
   * `[port-only]` -- the stage is not resident. Phase 0 of `GameOverRunPhase`
   * runs `FUN_0041D510`, whose callees reset every pol slot back to the
   * resident common set (`FUN_00418690`) and unload every cam file
   * (`CamSlotsReset`); from then until a stage is loaded again nothing of the
   * stage exists to draw. The port keeps the stage in memory for the restart
   * buttons, and this is how the renderer knows not to draw it.
   */
  g_stage_unloaded: 0,
  /**
   * `0x009A5CD8 + p*0x130` -- each player's body actor, `PlayerBodiesCreate`'s
   * (`FUN_00416450`). Empty until a game-over fly-over builds them; see
   * `game/player_body.ts`.
   */
  g_player_bodies: [] as PlayerBody[],
  /**
   * `g_route_history` — 0x009A5920, s8, sixteen per scene for ten scenes:
   * the blocks this run has entered, in order, -1 after the last. The
   * `checkpoint` opcode (0x4D, `ResetSceneCombatState`, `FUN_0045EEC0`)
   * appends `g_evt_block_index` at `g_route_count` and writes -1 after it;
   * `ResetGameOnStart` fills all 0x28 dwords with -1. The game-over route map
   * walks it. `[proved]`
   */
  g_route_history: Array.from({ length: 10 },
                              () => new Array(16).fill(-1)) as number[][],
  /**
   * `g_route_count` — 0x009A5C30, s8: this scene's next history entry.
   * `ResetSceneOnEnter` zeroes it. `[proved]`
   */
  g_route_count: 0,
  /** The route map's walk, `0x007DCCD8`..; see `game/route_map.ts`. */
  g_route_map: {
    scroll: 0, markSlot: 0, stage: 0, block: 0, dir: 0, wp: 0, entry: 0,
    cursorY: 0, targetX: 0, targetY: 0, screenY: 0, cursorX: 0,
  } as RouteMapState,
  /** The route map's figure tasks, in allocation order. */
  g_route_figures: [] as RouteFigure[],
  /** The route map's footprint tasks, in allocation order. */
  g_route_marks: [] as RouteMark[],
  /** `g_continue_timer` — 0x009A2BB8, the run's own continue countdown. */
  g_continue_timer: 0,
  /** `g_continue_credit_seen` — 0x007DCCAC..0x007DCCB8. */
  g_continue_credit_seen: [0, 0, 0, 0] as number[],
  /** `g_no_continue_frames` — 0x007DCCD4, a byte. */
  g_no_continue_frames: 0,
  /**
   * `g_input_frame` — 0x009A5C40. `InputReadFrame` (`FUN_0040D590`) adds one
   * on every frame's input read, before any screen runs; `CreditBlinkTick`
   * takes the credit line's clock from its difference. The boot reset is its
   * only other writer. Survives a scene load.
   */
  g_input_frame: 0,
  /**
   * `g_screen_frames` — 0x009A5C44. Frames the current screen has run:
   * `RunPhaseInPlay` (`FUN_004601D0`) counts it up after the task walk, and
   * each attract and title screen zeroes and counts its own. Read by
   * `CreditBlinkTick`, past 3, for the attract screens' PRESS START.
   */
  g_screen_frames: 0,
  /**
   * `g_credit_blink_clock` — 0x005A4D44. The credit line's blink clock:
   * `CreditBlinkTick` (`FUN_004067D0`) adds the frames `g_input_frame` moved
   * since it last looked, so it steps once a frame. `CreditPromptDrawSingle`
   * (`FUN_00406860`) hides the line while `(clock >> 5) % 3 == 2`.
   * `CreditsBootReset` (`FUN_004066D0`) zeroes it at boot.
   */
  g_credit_blink_clock: 0,
  /** `g_credit_blink_seen` — 0x005A4D48: `g_input_frame` as last seen. */
  g_credit_blink_seen: 0,
  /**
   * `g_credit_prompt_player` — 0x005A4D28. Whose credit tier the prompt
   * reads: `CreditPromptDraw` (`FUN_00406CE0`) writes the player when counts
   * are per player and 0 when they are shared.
   */
  g_credit_prompt_player: 0,
  /**
   * `g_score_cheat` — 0x009C87FC. `HudDrawScoreCheat` (`FUN_00413FB0`) draws
   * a player's score only while it is 7. Its one setter, `FUN_00495EB0` (app
   * state 3), writes 7 when the L/R presses spell the string at `0x005978C0`,
   * "LLRRRLR"; it and `TitleMenuUpdateAndSelect` (for Training and Boss)
   * zero it. The port does not run screen 3, so it stays 0. `[proved]`
   */
  g_score_cheat: 0,
  /**
   * `[port-only]` -- which players `HudDrawCrosshair` (`FUN_004169C0`) drew
   * the crosshair for this frame, 1 or 0. The engine draws a sprite; the
   * port's crosshair is the page's reticle, which follows the pointer between
   * ticks, so what the routine decides is recorded here and `app/` hands it
   * across. Cleared with `g_screen_sprite_draws` at the head of the player
   * walk.
   */
  g_crosshair_drawn: [0, 0] as number[],
  /**
   * `g_evt_gameplay_live` — 0x007DCCA4. Recomputed at the top of
   * `EvtInterpreterLoop` (`FUN_0045ECC0`) and read by every wait opcode,
   * `0x40` to `0x47`: the script may pass a wait only while it is 1. See
   * `EvtGameplayLiveUpdate`. BSS, so 0 until the first frame computes it.
   */
  g_evt_gameplay_live: 0,
  /**
   * `g_script_flags` — 0x009C7200. The byte array `set_script_flag` (evt 0x48)
   * writes and the set-pieces read for their other removal trigger.
   */
  g_script_flags: [] as number[],
  /**
   * `g_carrier_object` — 0x009A5C34, the object the player is riding.
   *
   * `ZombieStateRideCarrier` (state 29) adds this object's position to its own
   * spawn offset every frame, and leaves when the carrier raises `obj+0x34`
   * bit 0x10000000. `ZombieStateDelayedStrikeInPlace` (state 32) watches the
   * same object's bit 0x40000000 and gives up 0x14 frames after it appears.
   *
   * Two ported classes write it: class 0x33 selector 1
   * (`ScriptedCarrierUpdate33`) and class 0x26 subtype 2
   * (`Class26Subtype2Update` — `FUN_0048EAD0`, stage 3's boat, at
   * `0x0048EB1C`). `St1VehicleUpdate` (`FUN_0048E600`) is unported. See
   * `class30/entrance.ts`.
   */
  g_carrier_object: -1,
  /**
   * `g_civilian_carrier` — 0x009A2C88. The object a **carried actor** rides,
   * and a different global from {@link g_carrier_object} above.
   *
   * `CarrierPropSelectRoutine` (`FUN_00440190`) writes it at `0x004401A0`
   * when a class-0x13 prop installs its routine — the one write
   * `get_xrefs_to 0x009a2c88` lists (readers: `CivilianInit`,
   * `CarriedZombieInit18`, `Boss4Init`).
   * (`Class26Subtype2Update` (`FUN_0048EAD0`) was once listed here too; it
   * writes {@link g_carrier_object} instead — `0048eb1c 8935345c9a00`, `MOV
   * [0x009a5c34], ESI`.) `CarriedZombieInit18` (`FUN_0045CD60`)
   * copies it into `obj+0x13B0` at spawn and never reads it again, so it is
   * the carrier that was current on the frame the rider was placed — which is
   * why the script spawns a boat and its passengers in the same instruction.
   */
  g_civilian_carrier: -1,

  /**
   * `g_hit_slots` — `0x009C88C0`. Fourteen entries, an actor's `at` or `-1`.
   *
   * `ActorClaimHitSlot` (`FUN_00409270`) hands out the indices and
   * `ActorDespawn` (`FUN_00409CC0`) gives them back; `game/hit_slots.ts` is
   * both halves and says what is and is not ported. The reason the port holds
   * it at all is that `obj+0x3C` is the **phase** of every cel animation
   * `ZombieDrawBonePart` (`FUN_004534A0`) plays — see
   * `class30/bonecels.ts`.
   *
   * [port-only] The engine stores pointers and zero means free; the port
   * stores `at` and `-1` means free, because a snapshot carries an index.
   */
  g_hit_slots: [] as number[],

  /**
   * `g_blink_frame_counter` — `0x009A5C50`. Whole game ticks, from the scene
   * reset.
   *
   * One of three free-running counters `FUN_0040E730` steps once a tick.
   * `LoadSceneAndReset` (`0x00460030`) and `ResetSceneCombatState`
   * (`0x0045EF1E`) both zero it. It is the cel phase two per-bone draw hooks
   * index their model runs with — `ZombieDrawBonePart` (`FUN_004534A0`) and
   * `ThrowerDrawBonePart` — and the parity class 0x31's blink states read.
   *
   * Not {@link g_frame}: that one is the port's own clock and is **fractional**
   * (`G.g_frame += dt * 60`), and a cel index taken from a fraction skips and
   * repeats. This is an integer stepped by whole ticks, as `obj+0x19C` is.
   */
  g_blink_frame_counter: 0,
  /**
   * `g_frame_counter` — 0x009A32A0. The second of the three free-running
   * counters `FUN_0040E730` steps once a tick, beside
   * {@link g_blink_frame_counter} and `g_scene_tick_counter`.
   *
   * `OwlDrawBodyChain` (`FUN_00447C20`) takes `% 30` of it and folds that into
   * a sixteen-frame ping-pong for the head's model run — so an owl's head
   * animates on the **world's** clock rather than on its own, and a flock
   * moves its heads in step.
   *
   * A separate field rather than an alias: the two are zeroed by different
   * routines in the engine, and a port that shared one would be asserting they
   * can never drift.
   */
  g_frame_counter: 0,
  /**
   * `g_scene_tick_counter` — `0x009A2BAC`. The third of the counters
   * `FUN_0040E730` steps once a tick, and the one that counts **ticks since
   * the scene was entered**: `ResetSceneOnEnter` (`FUN_0045EDD0`) zeroes it
   * at `0x0045EE23`, where the other two are zeroed by the scene *load*.
   *
   * `PropUpdateType13` (`FUN_00467F50`) blinks its panel on `% 0x28` of it.
   */
  g_scene_tick_counter: 0,

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
   * `g_camera_yaw_bams` — 0x009C71F0. The gameplay eye's heading, in BAMS,
   * beside {@link g_camera_eye}: the scene state's hook writes it -- the
   * rail as its pose's yaw turned half round, the view-angle camera from the
   * block -- and it faces *forward*, where the block's own yaw faces back.
   *
   * Class 0x31 needs the yaw alone rather than the whole camera matrix:
   * `ThrowerStateLeapAside` builds its landing point with a Y rotation only,
   * and `ThrowerFindWallBeside` refuses to leap unless the actor is facing
   * within 0x2000 of it.
   */
  g_camera_yaw_bams: 0,
  /**
   * `g_camera_block_pitch_bams` — 0x009A60CC, `g_camera_blocks + 0x8C`: the
   * camera block's X rotation. `UpdateSceneViewAndLight` (`FUN_00401F40`)
   * builds the camera as `T(eye) Ry(yaw) Rx(this) Rz(roll)` looking down its
   * own -z, and `CamBlockSetAnglesFromLookAt` (`FUN_00403AC0`) derives it from
   * the block's eye and target with `VecToAngles(eye - target)` -- positive
   * looking up. The horde's dive lifts its arc by `2 * sin(this)`.
   */
  g_camera_block_pitch_bams: 0,
  /**
   * `g_camera_block_yaw_bams` — `0x009A60D0`, and `g_camera_block_roll_bams`
   * — `0x009A60D4`: the block's other two angle words, which
   * `UpdateSceneViewAndLight` (`FUN_00401F40`) builds the view from beside
   * the pitch. `CamBlockSetAnglesFromLookAt` (`FUN_00403AC0`) derives pitch
   * and yaw from the eye and target and stores its third argument as the
   * roll; the stage-3 boss's body, `Boss3BodyUpdate` (`FUN_004231C0`),
   * writes the yaw itself and aims the camera by angle.
   *
   * The yaw is the camera's own +z, pointing back at the viewer, and it is
   * the heading nearly every actor that turns to or throws along the camera
   * reads -- not {@link g_camera_yaw_bams}, which the scene state's hooks
   * write half a turn round from it. `globals.tsv` lists the readers.
   */
  g_camera_block_yaw_bams: 0,
  g_camera_block_roll_bams: 0,
  /**
   * `g_camera_block2_eye` — `0x009A6408`, `g_camera_block2_pitch_bams` —
   * `0x009A6414`, `g_camera_block2_yaw_bams` — `0x009A6418`,
   * `g_camera_block2_roll_bams` — `0x009A641C` and `g_camera_block2_target` —
   * `0x009A6420`: camera block **2**'s eye, angles and look-at, at
   * `g_camera_blocks + 2 * 0x1A4` plus the same offsets as block 0's.
   *
   * Nothing draws from it -- `g_camera_index` is 0 in every shipped write --
   * but one routine reads its yaw by address: the frog's screen wedge
   * (`0x0043AB62`). `CameraBlocksReset` zeroes it with the other three,
   * `EvtRunQueuedActionsSyncViewBlock` copies block 0's eye and look-at into
   * it while the scene state is (1, 3) and derives its angles, and
   * `UpdateSceneViewAndLight` rebuilds its angles through `MatrixGetAngles`
   * every frame. So outside a view-angle turn it holds the last one's
   * heading, or zero. `[proved]`
   */
  g_camera_block2_eye: vec3(),
  g_camera_block2_pitch_bams: 0,
  g_camera_block2_yaw_bams: 0,
  g_camera_block2_roll_bams: 0,
  g_camera_block2_target: vec3(),
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
   * Class 0x41 branches on it three ways: Original releases the member's own
   * `storyItem` and can drop an extra life from every prop, **Training**
   * turns selected members into one-shot targets and pays no score for them,
   * and Arcade does neither.
   *
   * The bundle carries the same numbers — `script.game_mode` *is* this field,
   * and `main.ts` copies it straight across. Arcade is **0**, not 2; the two
   * one-shot-target arms below are Training's and unreachable in a shipped
   * stage. See {@link GameMode} for what proves the values.
   */
  g_GameMode: GameMode.Arcade as GameMode,
  /**
   * `g_training_lesson` — 0x009C9118. Which training lesson is being played.
   *
   * It was `g_prop_target_set` here and in the TSV, named from the one use
   * the port has for it: `PlaceBreakableGroup` turns the members it selects
   * into one-shot targets while `g_GameMode` is 2. Mode 2 is **Training**,
   * and the byte is read in exactly two places, both behind that test — the
   * other is `PreloadScreenAssetList` (`FUN_00412FD0`), which indexes a
   * per-lesson asset list with it at training block 3. So the four "member
   * sets" are the four lessons, which is what the old name could not say.
   */
  g_training_lesson: 0,
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
  /**
   * `g_evt_block_index` — 0x009A2BC0, s16. Which event block is running.
   *
   * `Walker.block` is an accessor over this, the same arrangement
   * {@link g_evt_step_index} has, because **nine of the sixteen writers of
   * `g_script_branch_var` gate on it**: a shootable trigger that opens a
   * route in one block is inert in every other. `CatBranchTriggerUpdate` only
   * answers in block 8, `ChainSegmentUpdate` only in 0x16, `PropUpdateType73`
   * only in 7. Without it in `G` the port could place those triggers and
   * would have no way to say when they are live.
   */
  g_evt_block_index: 0,
  /**
   * `g_branch_prop_shot_count` — 0x007DCF18.
   *
   * How many of `PropUpdateType40`'s sub-kind-9 props have been broken.
   * The routine increments it on each break while `g_GameMode` is 1, and at
   * **2** — both of them — with `g_script_flags[0x11]` raised it writes
   * `g_script_branch_var = 2` and stores `-1` here so the route opens once.
   */
  g_branch_prop_shot_count: 0,
  /**
   * `g_fragment_subkind1_intact` — 0x007DCDB8, twelve bytes.
   *
   * One per sub-kind-1 object `PlaceFragmentProps` builds: 1 until a game
   * outside Training breaks that object. The constructor draws `0x17C6` for a
   * 1 and `0x17C7` otherwise, and `PropUpdateType40` refuses a hit on a 0 —
   * so a sub-kind-1 object shot once stays shot for the rest of the game,
   * through every re-placement. `ResetFragmentSubkind1Intact` (`FUN_00463680`)
   * is the only thing that puts them back, once a game.
   */
  g_fragment_subkind1_intact: new Array(12).fill(1) as number[],
  /**
   * `g_original_item_slots` — 0x009A2240, stride 0x14, two slots a player.
   *
   * Original Mode's inventory. `PlayerHoldsOriginalItem` (`FUN_00461C70`)
   * reads it, and three branch triggers only open their route while the
   * player is carrying the right id.
   *
   * [diverges] **Nothing in the port ever fills it.** Shooting a collectible
   * does not: `OriginalItemPropUpdate` counts the id into
   * {@link g_original_items_taken} and raises a banner
   * (`SpawnOriginalItemBanner`, `FUN_00475E40`), and neither writes here. The
   * writer of the ids is not ported, so every slot stays at -1 and the three
   * key-gated routes are unreachable — as they would be for a player who had
   * not found the key. That is the honest state, not a stub: the alternative
   * is to pretend the player is carrying something.
   */
  g_original_item_slots: [[-1, -1], [-1, -1]] as number[][],
  /**
   * `g_original_items_taken` — 0x009C90C0, one byte per Original Mode item
   * id, 33 of them. `OriginalItemPropUpdate` and `PropUpdateType72` count a
   * pickup in, capped at 0x63.
   *
   * **Persistent, not per game**: `FUN_0040AB50` copies all 33 in from the
   * options block at `0x009C9F3D` with the lives and difficulty settings, and
   * nothing in a game's reset clears it. The port has no save block, so it
   * starts at zero with the page and survives every reset.
   */
  g_original_items_taken: new Array(33).fill(0) as number[],
  /**
   * `g_original_item_pickup_blocked` — 0x007DCD14. While non-zero,
   * `OriginalItemPropUpdate` skips its whole pick-up arm. `PlaceGenericProp`
   * clears it for each collectible it builds; type 75 sets it when its ride
   * ends and clears it when it is shot, type 74 clears it when it drops its
   * item.
   */
  g_original_item_pickup_blocked: 0,
  /**
   * `g_original_item_banner_count` — 0x007DCD04, how many
   * `OriginalItemBannerUpdate` banners are up. In scene 5 a banner that finds
   * more than one dies.
   */
  g_original_item_banner_count: 0,
  /**
   * The banners `SpawnOriginalItemBanner` (`FUN_00475E40`) allocates, in
   * allocation order. [port-only] as a list: each is a 0x378 task in the
   * engine. See `game/class41/item_banner.ts`.
   */
  g_original_item_banners: [] as OriginalItemBanner[],
  /**
   * `g_chain_segments` — 0x007DCD18, `[group * 0x14 + segment]`.
   *
   * The twenty-segment chains `PlaceChainSegments` builds, by prop id rather
   * than by pointer. `ChainSegmentUpdate` re-registers into it every frame,
   * and segment 0 of a group carries the latch that stops the group opening
   * its route twice.
   */
  g_chain_segments: [] as number[],
  /**
   * `g_script_branch_var` — 0x009C88A4, s16. **Which route a branch takes.**
   *
   * `EvtAdvanceStepOrRoute` (`FUN_0045F000`) reads it as
   * `block = route.next[g_script_branch_var]` for a `kind == 1` record, and
   * `CameraArmStashedPath` (`FUN_00403DB0`) indexes the `store_six` preview
   * pairs with the same value — which is the check that the preview and the
   * route it previews are keyed identically.
   *
   * It is here, in `G`, and not on the walker, because **the engine keeps one
   * global and both halves of the game touch it**: the event VM reads it, and
   * every writer in the binary is gameplay code. `Walker.branchChoice` is an
   * accessor over this field, the same arrangement `g_evt_step_index` has.
   *
   * **It is reset to 0 on every *step* advance, not on every block change.**
   * The store is on `EvtAdvanceStepOrRoute`'s normal return path, after
   * `pc = EvtGetStep(...)`, so it fires whether or not the step list ran out.
   * That is a much stronger claim than the one three documents and this port
   * used to make, and it is what makes the shipped data legible: almost every
   * branch block spawns the actor that decides its branch in the block's
   * **last** step, because a write made earlier would be cleared by the next
   * step boundary.
   *
   * The port writes it from exactly one place, `CivilianOp.SetRouteBranch`,
   * which is the only writer arcade mode reaches whose class is ported. See
   * the global's row in `ghidra/annotations/globals.tsv` for the full
   * inventory of the sixteen writers and which are Original-Mode-only.
   */
  g_script_branch_var: 0,

  // -- thrown weapons ----------------------------------------------------
  /**
   * The weapons class 0x30 and class 0x31 have thrown, each an `ActorAlloc`'d
   * task in the engine running one of two routines. See `game/thrown_weapon.ts`.
   */
  g_thrown_weapons: [] as ThrownWeapon[],
  /** Hands out `ThrownWeapon.id`. Part of the state, so ids never collide. */
  g_thrown_next_id: 1,

  /**
   * `g_rain_particles` — `0x007C1EB8`. The rain, as fifty positions.
   *
   * The array runs `0x007C1EB8 .. 0x007C2114` at 12 bytes a particle, which is
   * **50** — the count is not stored anywhere, it is the extent of the array.
   * Camera-relative: `DrawRainParticles` turns each one into a world position
   * with `RotY(camera_yaw) * p + camera_eye` at draw time.
   */
  g_rain_particles: [] as RainParticle[],
  /**
   * `g_rain_enabled` — 0x009C8E50. `EvtOpEnableRain1D` (`FUN_0045F340`)
   * stores its operand here and `ResetSceneOnEnter` zeroes it (`0x0045EE78`).
   * The draw of the rain itself reads the walker's copy; what reads this one
   * is gameplay: `ZombieDeathEffectCueTick` and `ZombieDeathLandingEffect`
   * splash rather than raise dust while it is `1`.
   */
  g_rain_enabled: 0,

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
/**
 * `ResetSceneOnEnter` — `FUN_0045EDD0`. Everything a scene starts clean.
 *
 * Called once per scene, from the scene load (`FUN_00460030`), which
 * `ResetGameOnStart` (`FUN_0045FEF0`) reaches at the start of a run. The
 * nesting matters and is kept here: the run totals are zeroed *there* and the
 * per-scene ones *here*, which is what makes `g_civilians_rescued_total` a run
 * figure and `g_civilians_rescued_by_scene` a stage one.
 *
 * **A scene is not quite a stage.** `g_scene_index` names a loadable unit:
 * scenes 0..5 are the six playable stages — `g_attract_demo_playlist`
 * (0x00589828) proves it by naming scene 0, 1 and 3 for its demos of stages 1,
 * 2 and 4 — scene 6 is the entry `ResetGameOnStart` picks for `g_GameMode` 2,
 * and scenes 10 and 11 are the two attract screens. In the port one bundle is
 * one stage is one scene, and `w.script.scene` carries the index, so a stage
 * enter *is* a scene enter for the scenes the port has.
 *
 * **Where it is called from, on both sides.** Three direct callers in the
 * engine, and every one of them is the same act:
 *
 * | engine | port |
 * |---|---|
 * | `LoadSceneAndReset` (`FUN_00460030`) | `app/stage_load.ts` →
 *   `world.attach` → `GameSystem.attach` → {@link ResetGameGlobals} → here.
 *   That is the only path into a stage. |
 * | `FUN_0041F9B0`, attract scene 10 | — the port has no attract mode |
 * | `FUN_0041FB00`, attract scene 11 | — likewise |
 *
 * `LoadSceneAndReset` is itself reached three ways, and the port has an
 * equivalent for one of them: `ResetGameOnStart` for the first scene of a run,
 * `AdvanceToNextScene` (`FUN_0045FFF0`) for each stage transition — which is
 * the port's stage load — and `RunAttractDemo` (`FUN_00426800`) for the demo
 * playlist. **The demo enters a stage scene at an arbitrary block**, which is
 * structurally what the port's seek does.
 *
 * So the port has one caller the engine does not: a **seek**, in `main.ts`. It
 * rebuilds the world from a replay and so must start from a scene as clean as
 * a fresh load. A snapshot *load* deliberately does not reset — it restores
 * the whole data segment, counters and all, which a reset would undo.
 *
 * `[open]` The port has no equivalent of `ResetGameOnStart`, because it has no
 * *run*: every stage load is a fresh start. Nothing is silently wrong — the
 * run totals that reset owns (`g_civilians_seen_total`,
 * `g_civilians_rescued_total`) are not in `G` either — but the run/scene split
 * only half exists here, and a port that grows a continue sequence will need
 * the other half.
 *
 * **The engine's body, line for line, and what the port does with each.** This
 * is a partial transcription and the list is how you can tell which part:
 *
 * | engine | port |
 * |---|---|
 * | `g_enemies_alive = 0`, `g_enemies_present = 0` | ✅ |
 * | `g_civilians_alive = 0` | ✅ |
 * | `g_weapon_loop_holders = 0` (`0x0045EF3D`) | ✅ |
 * | the whole 0x100-byte `g_script_flags` | ✅ |
 * | per player: `g_head_combo_bonus`, `g_player_hit_count` | ✅ |
 * | per player: `g_player_shot_count` (0x009A5C84) | ❌ not in `G` — nothing
 *   in the port counts shots, so there is no accuracy denominator to zero.
 *   `EvtOpAwardAccuracyBonus2B` (`FUN_0045FE40`) is what reads the pair. |
 * | `g_civilians_seen_by_scene`, `g_civilians_rescued_by_scene` | ❌ neither
 *   tally exists; the port raises a `civilian.rescued` event instead. |
 * | `g_hit_slots` — the 14-slot table `ActorClaimHitSlot` claims | ✅ claimed,
 *   released and cleared. `obj+0x3C` is the phase of every cel a class-0x30
 *   bone draws, so the port needed it; `game/hit_slots.ts` says which parts of
 *   the hit-slot system are ported and which are not. |
 * | `g_bHudShutterState` back to 5 (`0x0045EE5F`) | ✅ |
 * | `g_bHudShutterPrev` back to 5 (`0x0045EE64`) | ✅ |
 * | `g_backdrop_mode = 0` | ❌ the global does not exist |
 * | `g_rain_enabled = 0` (`0x0045EE78`) | ✅ |
 * | `g_nFiringGate = 0` | ✅ |
 * | the scene light block, via `LightBlockSetDirection` (`FUN_0040E140`) | ❌ |
 * | `ColiLoadForScene`, `AssetDrainAllJobs` and three loader calls | ❌ the
 *   port loads collision and assets from the bundle, not from here |
 * | `g_scene_tick_counter` (`0x009A2BAC`, at `0x0045EE23`) | ✅ |
 * | `g_force_rail_advance` (`0x009CA098`, at `0x0045EE7E`) | ✅ |
 * | `g_screen_shake_frames = 0` (`0x0045EE29`) | ✅ |
 * | the unread words: `DAT_009C6F1C`, `DAT_009C6F20`,
 *   `DAT_009C71C0`, `DAT_009A5C30`, `DAT_009A34DC = 1` |
 *   `[open]` |
 *
 * The ✅ rows are the ported part (a count here rots, L16). The name is the
 * engine's and the omissions are itemised on
 * purpose: a partial transcription that says which part is a work list, and
 * one that does not is a lie waiting to be believed.
 */
export function ResetSceneOnEnter(): void {
  // The route history's cursor for this scene (`DAT_009A5C30`).
  G.g_route_count = 0;
  G.g_enemies_alive = 0;
  G.g_enemies_present = 0;
  G.g_civilians_alive = 0;
  // `MOV [0x009a2bac], EBX` at `0x0045EE23`, `EBX` zeroed at the top.
  G.g_scene_tick_counter = 0;
  // `for (i = 0xE; i != 0; i--) *p++ = 0` over `&DAT_009C88C0` at
  // `0x0045EE70` -- and the **0xE is a second, independent proof that
  // `g_hit_slots` is fourteen deep**, the first being the pointer bound in
  // `ActorClaimHitSlot` (`FUN_00409270`). `HIT_SLOT_NONE` rather than the
  // engine's 0 because the port stores an actor's `at` and 0 is a real `at`.
  G.g_hit_slots = new Array<number>(HIT_SLOT_COUNT).fill(HIT_SLOT_NONE);
  // `MOV [0x009c8a74], 0` at `0x0045EF3D` — the looping held-weapon SE's
  // refcount. It has to be zeroed here or the *next* scene's first chainsaw
  // zombie finds a non-zero count, never starts the loop, and the chainsaw is
  // silent for the rest of the stage; `audio/bgm.ts` stops the loop itself
  // when the sound tables are swapped, which is the other half.
  G.g_weapon_loop_holders = 0;
  // `for (i = 0x40; i--;) *p++ = 0` over `g_script_flags` — all 0x100 bytes.
  G.g_script_flags = [];
  // The per-player shot statistics, so the accuracy grade is per scene rather
  // than per run. The third of the triple, `g_player_shot_count`, has no
  // counterpart in `G`.
  G.g_head_combo_bonus = [0, 0];
  G.g_player_hit_count = [0, 0];
  // `g_nFiringGate = 0` at 0x0045EEAC, the last write but one in the engine's
  // body. A scene starts with the trigger dead and the script raises the gate;
  // it is not a value the port may default to "on" for convenience, because a
  // stage that never issues `hud_shutter_state 1` or `6` is a stage the engine
  // would not let you shoot in either.
  G.g_nFiringGate = 0;
  // `MOV AL, 5` at `0x0045EE58`, then `MOV [0x009ca0f4], AL` and
  // `MOV [0x009c8e9c], AL`: the state and the one `HudDrawShutterState` last
  // settled on, both 5. They are equal, so the routine's first frame seeds
  // nothing, draws the shut bars and leaves 4 with the gate down -- which is
  // the picture of a scene before its script has opened them, and on that
  // first frame the script has not run at all: its task's first handler,
  // `EvtTaskInstallInterpreter` (`FUN_0045ECB0`), only installs the
  // interpreter.
  G.g_bHudShutterState = 5;
  G.g_bHudShutterPrev = 5;
  // `g_screen_shake_frames`, `MOV [0x009c8e8c], EBX` at `0x0045EE29`.
  G.g_screen_shake_frames = 0;
  // `g_rain_enabled`, `MOV [0x009c8e50], EBX` at `0x0045EE78`.
  G.g_rain_enabled = 0;
  // `MOV [0x009ca098], EBX` at `0x0045EE7E`: the stashed rail obeys its gate
  // again in a new scene.
  G.g_force_rail_advance = 0;
}

/**
 * The port's own reset: the object pools, the camera and the tables that have
 * no single owner in the engine, **plus** `ResetSceneOnEnter` for the half
 * that does.
 *
 * Not an exe function, and it should not pretend to be one. `SpawnFromDescriptor`
 * builds actors one at a time and the engine has no "empty the pool" call at
 * all, because its pool is a fixed array it walks; the port keeps a list, so
 * emptying it is a thing that has to happen somewhere.
 */
export function ResetGameGlobals(carry?: PlayerBlock): void {
  G.g_object_list = [];
  G.g_cur_actor = -1;
  ResetSceneOnEnter();
  // Two permits, one a player, whatever `g_max_attackers` says: the array at
  // `0x009A2BA0` is fixed and `TryClaimAttackSlot` picks a player in it.
  G.g_attack_permits = [-1, -1];
  G.g_hit_player_order = [0, 0];
  G.g_attack_committed = 0;
  G.g_enemy_approach_rings = [];
  G.g_enemy_approach_ring_mid = [];
  G.g_enemy_approach_ring_outer = [];
  G.g_enemy_approach_steps = 0;
  G.g_enemy_approach_steps_mid = 0;
  G.g_enemy_approach_steps_outer = 0;
  // `SceneLightArrayInit` (`FUN_004809D0`), run at scene init. The aim is
  // input and survives, as the engine's input record does.
  G.g_scene_lighting = 0;
  G.g_entity_spotlights_on = 0;
  G.g_light_array_ambient = [0.5, 0.5, 0.5];
  G.g_entity_lights = makeEntityLights();
  G.g_player_was_hit = [0, 0];
  G.g_player_damage_overlay_kind = [0, 0];
  // `PlayerEnterPlay` (`FUN_00414770`) zeroes the overlay's active word and
  // count, which with the rest of the record unread is all of it.
  //
  // `g_player_camera_hook` is **not** reset, deliberately, and neither is it
  // in the engine `[proved]`: the only writers of `0x009A5CDC` and player 1's
  // `0x009A5E0C` are the six scene-state installers (both players),
  // `PlayerInstallDrawBodyHook`, `PlayerInstallDamageOverlayHook` and
  // `PlayerStateArmGameOver` (one player each). The boot routine
  // `FUN_0040A920` -- run once, from `ReadIniFlushSettings` -- writes other
  // fields of the player block and not this one, and neither
  // `LoadSceneAndReset` nor `ResetSceneOnEnter` touches it. So a player who
  // stays out keeps the hook the last installer wrote, through a scene load
  // and through a new game; the port's restart leaves player 1's `1` there
  // for the same reason. In the port the walker's replay of a deep link or a
  // seek may also have run those installers before this reset.
  G.g_damage_overlays = makeDamageOverlays();
  G.g_screen_shake_pitch = 0;
  // `g_player_hit_count` and `g_head_combo_bonus` are `ResetSceneOnEnter`'s.
  // [diverges] `g_one_hit_target_kills` is **not**: nothing read so far
  // clears it, and it is deliberately outside the `ResetSceneOnEnter`
  // transcription above so that list stays a faithful one. It is cleared here,
  // in the port's own reset, because a counter that outlives a stage reload
  // makes a snapshot the port cannot reproduce from a fresh run. If a reader
  // of `FUN_00497640` or `FUN_004525C0` turns out to want the running total,
  // this is the line that is wrong.
  G.g_one_hit_target_kills = 0;
  G.g_player_score = [0, 0];
  G.g_nPlayerFired = [0, 0];
  // Input, and a scene that is starting has none pending. A seek that left a
  // click queued would otherwise fire it into the replayed world.
  G.g_shot_requests = [];
  // [port-only] The engine's list holds object pointers into a pool the scene
  // load has just emptied; nothing registered survives into the new scene.
  G.g_shot_test_list = [];
  G.g_severed_heads = [];
  G.g_severed_head_seq = 0;
  G.g_sprite_effects = [];
  G.g_sprite_effect_seq = 0;
  G.g_prop_strip_effects = [];
  G.g_prop_strip_effect_seq = 0;
  G.g_water_rings = [];
  G.g_water_ring_seq = 0;
  // The water tasks go with the scene's list, and the tiles they rewrote go
  // with the scene's assets.
  G.g_water_surfaces = [];
  G.g_water_surface_seq = 0;
  G.g_water_surface_uv = [];
  // ...and the stage-2 car, a task like them: no class 0x21, no car.
  G.g_st2_cars = [];
  G.g_st2_car_seq = 0;
  // ...and the owl's and the fish's tasks, which the scene's list takes
  // with it like every other task.
  G.g_owl_feathers = [];
  G.g_owl_ground_rings = [];
  G.g_owl_water_splashes = [];
  G.g_fish_blood_clouds = [];
  G.g_fish_water_splashes = [];
  G.g_fish_surface_rings = [];
  G.g_ring_effects = [];
  G.g_creature_effect_seq = 0;
  // The shutter's task is one of the list the scene load builds, so its
  // counter starts again at 0 -- `HudShutterTaskCreate`, at `0x00460733`.
  HudShutterTaskCreate();
  // The scene's task list is rebuilt on a scene load, and a bar task goes
  // with it; the fill itself is a data-segment word and is left alone.
  G.g_boss_hp_bars = [];
  G.g_boss_banners = [];
  G.g_boss4_hit_marks = [];
  // Class 0x45's tasks go with the task list; its data-segment words are
  // re-seeded by `Boss3ClassHandler` on the next spawn, and are put back to
  // the image's zeroes here so a seek from a cold start and one from mid-fight
  // arrive at the same world.
  G.g_boss3_intro_cards = [];
  G.g_boss3_sparks = [];
  G.g_boss3_splashes = [];
  G.g_boss3_mesh_bulges = [];
  G.g_boss3_path_effects = [];
  G.g_boss3_heads_attacking = 0;
  G.g_boss3_variant = 0;
  G.g_boss3_heads = [-1, -1, -1, -1, -1];
  G.g_boss3_last_head = 0;
  G.g_boss3_attack_delay = 0;
  G.g_boss3_head_hp_pool = 0;
  G.g_boss3_pose_bone = 0;
  G.g_boss3_heads_left = 0;
  G.g_boss3_bystanders = [-1, -1];
  G.g_boss3_phase = 0;
  G.g_boss3_card_pieces = Array.from({ length: 8 },
    () => ({ x: 0, y: 0, z: 0, yaw: 0, scale: 0 }));
  G.g_boss3_track_point = vec3();
  G.g_boss3_opening_bystander_pos = vec3();
  G.g_boss3_opening_bystander_yaw = 0;
  G.g_boss3_rank = 0;
  G.g_boss3_rand_counter = 0;
  G.g_screen_sprite_queue = [];
  // ...and a banner that was flying the camera took its hold with it. The
  // engine's own reset is the scene's first `checkpoint`; this is the port's
  // load, which reaches the same state without running one.
  G.g_camera_driver_held = 0;
  // `[port-only]`: the stashed rail's words. The engine never clears them on
  // a scene load -- every stashed play writes both before a scene state reads
  // them -- but a seek has to arrive at the same world from a cold start and
  // from 1500 frames in, and left alone they carry the old stage's range.
  G.g_stashed_path_frame = 0;
  G.g_stashed_path_end_frame = 0;
  G.g_rail_frame = 0;
  G.g_blood_sprays = [];
  G.g_blood_spray_seq = 0;
  G.g_point_blood_sprays = [];
  G.g_point_blood_spray_seq = 0;
  G.g_body_creatures = [];
  G.g_body_creature_seq = 0;
  G.g_carried_props = [];
  G.g_carried_prop_seq = 0;
  G.g_shot_flash_ring = makeShotFlashRing();
  G.g_shot_tracer_ring = makeShotTracerRing();
  G.g_shot_weapon_ring = makeShotWeaponRing();
  G.g_shot_effect_cursor = [0, 0];
  G.g_shot_hit_something = [0, 0];
  G.g_original_weapon_kind = [0, 0];
  G.g_screen_sprite_draws = [];
  G.g_camera_is_tracking = 0;
  G.g_camera_lookat_target = vec3();
  G.g_camera_block_target = vec3();
  G.g_camera_view_to_world = MatIdentity();
  G.g_camera_world_to_view = MatIdentity();
  G.g_cam_path_target = vec3();
  G.g_cam_path_eye = vec3();
  G.g_cam_path_pitch_bams = 0;
  G.g_cam_path_yaw_bams = 0;
  G.g_cam_path_roll_bams = 0;
  // `CameraClearHookAndPose` (`FUN_0040C340`) zeroes these six on a scene
  // load; the port's reset is that load.
  G.g_camera_eye = vec3();
  G.g_camera_pitch_bams = 0;
  G.g_camera_yaw_bams = 0;
  G.g_camera_roll_bams = 0;
  G.g_camera_block_pitch_bams = 0;
  G.g_camera_block_yaw_bams = 0;
  G.g_camera_block_roll_bams = 0;
  G.g_camera_block2_eye = vec3();
  G.g_camera_block2_pitch_bams = 0;
  G.g_camera_block2_yaw_bams = 0;
  G.g_camera_block2_roll_bams = 0;
  G.g_camera_block2_target = vec3();
  G.g_camera_starter_reseats = 1;
  G.g_camera_update_hook = 0;
  G.g_cam_path_cursor = 0;
  G.g_cam_path_end_frame = 0;
  G.g_cam_path_frames_left = 0x7fffffff;
  G.g_camera_ease_eye = 0;
  G.g_evt_cam_override_valid = 0;
  G.g_evt_cam_override_pairs = [];
  G.g_camera_impulse_yaw_bams = 0;
  G.g_camera_impulse_request = 0;
  G.g_camera_impulse_lock = 0;
  G.g_camera_impulse_frames = 0;
  G.g_camera_impulse_offset = vec3();
  G.g_camera_impulse_velocity = vec3();
  G.g_camera_use_fixed_y = 0;
  G.g_cam_roll_enabled = 0;
  G.g_queued_events_pending = 0;
  G.g_camera_turn_rate = 0;
  G.g_camera_turn_curve = 1;
  G.g_camera_settled = 0;
  G.g_camera_free = 0;
  G.g_camera_mode = 0;
  G.g_camera_hand_back_started = 0;
  G.g_camera_hand_back_variant = 0;
  G.g_evt_action_operands = [0, 0, 0, 0, 0, 0, 0, 0];
  // Not in `ResetSceneOnEnter` — the engine's copy is only ever zeroed by the
  // wait that owns it. It is here because this is the port's "nothing is
  // half-done" call, and a seek that lands mid-`wait_enemies_alive` would
  // otherwise carry the previous scene's count of refused frames into the
  // first gate of the new one.
  G.g_evt_wait_alive_hysteresis = 0;
  G.g_enemy_slots = makeCameraSlots();
  G.g_camera_candidates = [];
  G.g_camera_candidate_count = 0;
  G.g_water_level = -24.9;
  G.g_frog_bone1_on_entry = vec3();
  G.g_water_attack_slots = [0, 0, 0, 0];
  // The engine leaves the pointer dangling into the freed pool; nothing
  // samples it until the next class-0x16 spawn replaces it.
  G.g_water_wave_field = null;
  G.g_summoned_actor_at = -1;
  G.g_slot_actors_built = [];
  G.g_class43_attack_token = -1;
  G.g_bat_members = [];
  // The splash is a task, and the scene's task list goes with the scene.
  G.g_bat_splashes = [];
  G.g_bat_splash_seq = 0;
  G.g_horde_members = [];
  G.g_horde_live_count = 0;
  G.g_horde_diver = 0;
  G.g_horde_last_dive_frame = 0;
  G.g_horde_emerged = 0;
  G.g_horde_effect_seq = 0;
  G.g_horde_placers_built = {};
  G.g_crosshair_ray = [null, null];
  G.g_thrown_weapons = [];
  G.g_rain_particles = [];
  G.g_thrown_next_id = 1;
  G.g_breakable_props = [];
  G.g_breakable_members = [];
  G.g_item_set_countdown = [];
  G.g_breakable_next_id = 1;
  G.g_prop_shatters = [];
  G.g_prop_shatter_seq = 1;
  G.g_evt_step_index = 0;
  G.g_evt_block_index = 0;
  G.g_script_branch_var = 0;
  G.g_branch_prop_shot_count = 0;
  ResetFragmentSubkind1Intact();
  G.g_original_item_slots = [[-1, -1], [-1, -1]];
  // `g_original_items_taken` is not here on purpose: it is the options
  // block's, and a game's reset leaves it alone.
  G.g_original_item_pickup_blocked = 0;
  G.g_original_item_banner_count = 0;
  G.g_original_item_banners = [];
  G.g_chain_segments = [];
  G.g_scene_index = 0;
  G.g_camera_block_eye = vec3();
  G.g_active_cam_path = -1;
  G.g_cam_path_frame = 0;
  // The scene's task list: `EvtLoadBlockProgram`'s ring reset and
  // `CameraActorInit` -- which resets the camera block, enters scene state
  // (1, 1) and parks the action slot -- then `CameraClearHookAndPose`
  // (`FUN_0040C340`), which `LoadSceneAndReset` calls after the list and so
  // leaves the scene state's hook a no-op.
  CameraActorInit();
  G.g_camera_update_hook = 0;
  G.g_camera_fixed_eye_y = 0;
  G.g_camera_eye = vec3();
  G.g_camera_pitch_bams = 0;
  G.g_camera_yaw_bams = 0;
  G.g_camera_roll_bams = 0;
  G.g_coli_full_set = [];
  G.g_coli_ray_set = [];
  G.g_coli_hit_surface = 0;
  G.g_carrier_object = -1;
  G.g_civilian_carrier = -1;
  // `LoadSceneAndReset` zeroes the counter at `0x00460030`, and
  // `ResetSceneCombatState` does it again at `0x0045EF1E`. The slot table is
  // `ResetSceneOnEnter`'s and is cleared there.
  G.g_blink_frame_counter = 0;
  G.g_frame_counter = 0;
  G.g_frame = 0;
  // **The player.** The engine's scene load never touches the player block;
  // the port's reset rebuilds all of `G`, so the block is booted here and then
  // either carried across (a stage step: `AdvanceToNextScene` parks whoever is
  // in play at 2, and the new scene's tasks bring them back through row 2) or
  // started afresh from the title, which is what a page load and a seek are.
  // See `game/player_shell.ts`; every step there is a ported routine.
  PlayerBlockBoot();
  if (carry) {
    PlayerBlockRestore(carry);
    AdvanceToNextScene();
    PlayerTasksCreate();
    PlayerTasksRunFirstTurn();
  } else {
    // `ResetGameOnStart`'s (`0x0045FEF0`) route half: the history is the
    // run's, filled with -1 when a game starts and carried by nothing else.
    // Here rather than in the port's `ResetGameOnStart`, which runs on the
    // first frame -- after the script's first `checkpoint`, which the engine
    // runs after the reset.
    G.g_route_history = Array.from({ length: 10 },
                                   () => new Array(16).fill(-1));
    PlayerStartGameFromTitle(G.g_GameMode);
  }
  // The player turn taken above is the port's sequencing, not a frame the
  // engine draws: it runs before the scene's script has set the shutter, so
  // what it drew would be the HUD of a shutter state nobody has chosen yet --
  // on screen for as long as a freshly loaded stage sits paused.
  G.g_screen_sprite_draws = [];
}

/**
 * `ResetFragmentSubkind1Intact` — `FUN_00463680`.
 *
 * Three dword stores of `0x01010101` over `g_fragment_subkind1_intact`.
 * `ResetGameOnStart` calls it, and so does the port's game reset above.
 */
export function ResetFragmentSubkind1Intact(): void {
  G.g_fragment_subkind1_intact = new Array(12).fill(1);
}

/** Write a saved data segment back over the live one, field by field. */
export function RestoreGameGlobals(saved: Globals): void {
  Object.assign(G, saved);
}

/** Find an actor by its spawn address. */
export function ActorByAt(at: number): Actor | undefined {
  return G.g_object_list.find((o) => o.at === at);
}
