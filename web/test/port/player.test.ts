import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { ActorStrikeConnect } from "../../src/game/class30/strike";
import {
  EvtGameplayLiveUpdate, PadBit, PlayerBlockCapture, PlayerTasksRun,
} from "../../src/game/player_shell";
import { ScoreAddForPlayer } from "../../src/game/combat/score";
import { UpdateDamageRank } from "../../src/game/run_phase";
import {
  AppState, G, PlayerState, PlayerTask, ResetGameGlobals, ResetSceneOnEnter,
  RunPhase,
} from "../../src/game/globals";
import { NULL_HOST } from "../../src/game/host";
import { QueueShotRequest } from "../../src/game/combat/shot";
import { SetGameTables, T } from "../../src/game/tables";
import { ZombieState } from "../../src/game/class30/states";
import { ActorFlag, type ZombieActor } from "../../src/game/actor";
import { CheckPlayerCanBeHit, IsPlayerAttackable, PlayerTakeDamage }
  from "../../src/game/combat/player";
import { PlayerCameraHook, PlayerEntityHook, SceneStateInstallPlayerHooks }
  from "../../src/game/effects/damage_overlay";
import { PlayerBodiesCreate } from "../../src/game/player_body";
import { EvtCallActionHandler } from "../../src/game/camera/actions";
import { EvtActionHandler } from "../../src/game/camera/driver";
import { TryClaimAttackSlot } from "../../src/game/combat/permits";
import { EnemyZombieUpdate } from "../../src/game/class30";
import {
  ReleaseEnemyAliveCount, ReleaseEnemyPresentCount, UNCOUNTED_CHAR_TYPE,
} from "../../src/game/combat/counts";
import { SpawnClass } from "../../src/game/spawn_class";
import { GameMode } from "../../src/game/game_mode";
import { CreditTrySpend, CreditsAvailable, ModeStartCounterValue }
  from "../../src/game/credits";
import { OPTIONS_FACTORY } from "../../src/game/options_data";
import { ContinueSprite, HudSprite } from "../../src/game/hud_sprites";
import { vec3 } from "../../src/game/vec";
import type { ScriptJson } from "../../src/bundle";
import { Walker } from "../../src/script/walker";
import { GameOverCameraFlyTick } from "../../src/game/game_over";
import { SetGameOverTables } from "../../src/game/tables";
import { RouteFigureTick } from "../../src/game/route_map";
import { CamPath, CamPaths } from "../../src/game/camera/curve";
import { SetCameraPaths } from "../../src/game/tables";
import {
  check, CHARS, SCENE_MAJOR_PLAYING, spawnZombie, scene, EnterPlay,
  JoinPlayerTwo, RunOutInvulnerability, run, TYPE,
} from "./harness";

console.log("\nthe player shell: in, hit, out, continue, over:");
{
  // Everything through the ported routines: the reset starts a game from the
  // title, the first task turn enters play, the hits come from
  // `PlayerTakeDamage`, and the frames from `GameUpdate`.
  const rng = new Rng(3);
  const f = { host: NULL_HOST, rng };
  G.g_GameMode = GameMode.Arcade;
  G.g_option_credits = OPTIONS_FACTORY.credits;  // counts, not free play
  ResetGameGlobals();
  SetGameTables(CHARS);
  check("the reset's start press spends one credit of six and puts the "
        + "game in app state 6, player 1 still out",
        G.g_player_state[1] === PlayerState.Out
        && G.g_credits[0] === 5 && G.g_app_state === AppState.InPlay,
        `${G.g_player_state} tasks ${G.g_player_task} credits ${G.g_credits}`);
  check("...and the scene's first turn is PlayerEnterPlay(0): in play, three lives, "
        + "one player, one attacker, 90 frames' grace",
        G.g_player_state[0] === PlayerState.InPlay
        && G.g_player_lives[0] === 3 && G.g_players_in_play === 1
        && G.g_max_attackers === 1 && G.g_player_invuln_frames[0] === 90
        && G.g_player_task[0] === PlayerTask.InPlay,
        `state ${G.g_player_state[0]} lives ${G.g_player_lives[0]} `
        + `in ${G.g_players_in_play}/${G.g_max_attackers} `
        + `inv ${G.g_player_invuln_frames[0]}`);
  check("a hit inside the grace is refused",
        !PlayerTakeDamage(0, 1, 9), `lives ${G.g_player_lives[0]}`);

  // Off the path camera the last life cannot go.
  G.g_scene_state_major_entered = 1;
  G.g_scene_state_major = 1;
  for (let i = 0; i < 3; i++) {
    RunOutInvulnerability();
    PlayerTakeDamage(0, 1, 9);
  }
  check("off the path camera a hit floors lives at one",
        G.g_player_lives[0] === 1, `lives ${G.g_player_lives[0]}`);
  check("...and the score does not go below zero",
        G.g_player_score[0] === 0, `score ${G.g_player_score[0]}`);

  // On it, the last one goes, and the next task turn takes the player out.
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_scene_state_major = SCENE_MAJOR_PLAYING;
  RunOutInvulnerability();
  PlayerTakeDamage(0, 1, 9);
  check("on the path camera the last life goes",
        G.g_player_lives[0] === 0, `lives ${G.g_player_lives[0]}`);
  PlayerTasksRun(f);
  check("...and the player leaves play: state 4, nobody in play, "
        + "not attackable",
        G.g_player_state[0] === PlayerState.Continue
        && G.g_players_in_play === 0 && !IsPlayerAttackable(0),
        `state ${G.g_player_state[0]} in ${G.g_players_in_play}`);
  QueueShotRequest(0, { origin: vec3(), dir: vec3(0, 0, 1) });
  const fired = G.g_player_shot_count[0];
  run(1, rng, new Events());
  check("...a player in the continue has no trigger",
        G.g_player_shot_count[0] === fired && G.g_shot_requests.length === 0,
        `fired ${fired} -> ${G.g_player_shot_count[0]}`);
  const armed = G.g_nRunPhase;
  run(1, rng, new Events());
  check("...and the run falls into its continue screen: phase 3, then 4",
        armed === RunPhase.ContinueArm
        && G.g_nRunPhase === RunPhase.ContinueCountdown,
        `phase ${armed} -> ${G.g_nRunPhase}`);

  // START with a credit: state 1, a point, the rank down one, three lives.
  const rank = G.g_damage_rank;
  G.g_pad_state = PadBit.Start0;
  run(1, rng, new Events());
  G.g_pad_state = 0;
  run(1, rng, new Events());
  // The continue lowers the rank by one, and the next `UpdateDamageRank`
  // sees a player back in play: +4 (`(in_play - seen) * 4`).
  check("START during the countdown continues: in play again with three "
        + "lives, a credit spent, one point, the rank one lower then +4 for "
        + "the player back in play",
        G.g_player_state[0] === PlayerState.InPlay
        && G.g_player_lives[0] === 3 && G.g_credits[0] === 4
        && G.g_player_score[0] === 1
        && G.g_damage_rank === Math.min(15, Math.max(0, rank - 1) + 4)
        && G.g_player_invuln_frames[0] > 90,
        `state ${G.g_player_state[0]} lives ${G.g_player_lives[0]} `
        + `credits ${G.g_credits[0]} score ${G.g_player_score[0]} `
        + `rank ${rank} -> ${G.g_damage_rank}`);
  check("...and the run goes back to play",
        G.g_nRunPhase === RunPhase.InPlay, `phase ${G.g_nRunPhase}`);

  // Run out again and let the countdown run out: game over.
  G.g_player_lives[0] = 0;
  run(1, rng, new Events());
  let frames = 0;
  while (G.g_app_state !== AppState.GameOver && frames < 2000) {
    run(1, rng, new Events());
    frames += 1;
  }
  check("a continue nobody takes ends in the game-over screen, after ten "
        + "digits of 0x2D a frame",
        G.g_app_state === AppState.GameOver && frames > 880 && frames < 930,
        `${frames} frames, app ${G.g_app_state}`);

  // The game-over screen, `GameOverRunPhase` (`FUN_00460960`), from phase 0.
  check("the game-over screen starts at phase 0", G.g_nRunPhase === 0,
        `phase ${G.g_nRunPhase}`);
  const heard: number[] = [];
  const ev = new Events();
  ev.on("sound.play", (d) => heard.push(d.id));
  const z0 = G.g_object_list.find((o) => o.cls === SpawnClass.Zombie);
  const zAt = z0 ? { ...z0.pos } : null;
  // The bodies' clips, as the bundle carries them: `0x338` is 61 frames at 30
  // Hz, played over 120 cursor ticks.
  for (const ct of ["57", "58"]) {
    T.types[ct] = { ...(T.types[ct] ?? {}), motions: {
      ...(T.types[ct]?.motions ?? {}),
      "824": { bank: 38, frames: 61, fps: 30, play: 120,
               root: new Array(61 * 3).fill(0), rot: [] },
    } } as unknown as (typeof T.types)[string];
  }
  // The game-over block, as `ExeTables.gameOverTables` reads it -- the real
  // values for the bodies; a one-block route for the map: stage 1, block 0,
  // one waypoint 48 map pixels down from where the cursor starts.
  // Unused rows are zeroes in the exe's table, and that matters: the frame
  // the history runs out leaves the block at -1, and the next frame reads
  // the row before it -- a zero there is a target the cursor is not on, which
  // is what lets the done word run on to -1.
  const waypoints = Array.from({ length: 6 }, () =>
    Array.from({ length: 0x27 }, () =>
      Array.from({ length: 6 }, () => [0, 0])));
  waypoints[0][0][0] = [-16, -98];
  waypoints[0][0][1] = [-1, -1];
  SetGameOverTables({
    body_char_types: [0x39, 0x3a], body_start_motions: [0x32c, 0x32c],
    fall_motions: [0x338, 0x338], fall_frames: [0x50, 0x3c],
    body_offsets: [[0, 0], [0, 0], [-5, -1.9], [4.2, 0.7]],
    route_tiles: [0xce, 0x119, 0x164, 0x1af],
    route_waypoints: waypoints,
    default_route: Array.from({ length: 6 }, () => new Array(16).fill(-1)),
    entity_offsets: [0, 0, -3, 3],
    seat_x: [304, -304, -4.6755, -4.6755, -4.6755, 4.6755],
    stand_points: [[-728.8, 36.01, -1319.8], [-728.8, 36.01, -1319.8],
                   [-736.9, 36.01, -1316.2], [-728.8, 36.01, -1319.8]],
    stand_motions: [0, 0, 0x356, 0x356, 0x349, 0x356],
  });
  run(1, rng, ev);
  check("phase 0: every player at 4 goes to 6, 200 frames, BGM 9 unlooped",
        G.g_player_state[0] === PlayerState.GameOver
        && G.g_game_over_timer === 200 && G.g_nRunPhase === 1
        && heard.includes(0x10000009), `${G.g_player_state} ${heard}`);
  check("...the stage is released and both bodies are made, on 0x32C "
        + "(`PlayerBodiesCreate`, `FUN_00416450`), with the fly-over counter "
        + "at 11 -- 10 was evaluated as the task was made",
        G.g_stage_unloaded === 1 && G.g_player_bodies.length === 2
        && G.g_player_bodies[0].charType === 0x39
        && G.g_player_bodies[1].charType === 0x3a
        && G.g_player_bodies[0].motion === 0x32c
        && G.g_game_over_fly_frame === 11,
        JSON.stringify(G.g_player_bodies.map((b) => b.motion))
        + ` fly ${G.g_game_over_fly_frame}`);
  run(1, rng, ev);
  const body = G.g_player_bodies[0];
  check("phase 1's first frame arms the player: the fall, 0x338, at the "
        + "origin, drawn, not yet stepping -- and player 2, out, has no body "
        + "drawn",
        body.motion === 0x338 && body.playTicks === 0 && body.drawn === 1
        && body.pos.x === 0 && body.pos.z === 0
        && G.g_player_camera_hook[0]
           === PlayerCameraHook.DrawBodyUntilMotionEnd
        && G.g_player_bodies[1].drawn === 0,
        JSON.stringify(body));
  run(0x3c - 12, rng, ev);
  check("...the cursor holds until the path frame passes 0x3B",
        body.playTicks === 0 && G.g_cam_path_frame === 0x3b,
        `ticks ${body.playTicks} path frame ${G.g_cam_path_frame}`);
  run(1, rng, ev);
  check("...and steps from 0x3C", body.playTicks === 1,
        `ticks ${body.playTicks}`);
  run(118, rng, ev);
  check("...to the clip's last tick, 119, still under the body's hook",
        body.playTicks === 119 && body.drawn === 1
        && G.g_player_camera_hook[0]
           === PlayerCameraHook.DrawBodyUntilMotionEnd,
        `ticks ${body.playTicks} hook ${G.g_player_camera_hook[0]}`);
  run(1, rng, ev);
  check("the next frame draws it on that tick once more and hands the hook "
        + "over to `PlayerHookSetCurActor`",
        body.playTicks === 119 && body.drawn === 1
        && G.g_player_camera_hook[0] === PlayerCameraHook.SetCurActor,
        `ticks ${body.playTicks} hook ${G.g_player_camera_hook[0]}`);
  run(1, rng, ev);
  check("...which draws nothing: the body is gone for the rest of the "
        + "fly-over", body.drawn === 0);
  // Phase 1 has run 1 + (0x3C - 12) + 1 + 118 + 1 + 1 frames of its 200.
  run(199 - (1 + (0x3c - 12) + 1 + 118 + 1 + 1), rng, ev);
  check("phase 1 runs its 200 frames", G.g_nRunPhase === 1
        && G.g_game_over_timer === 1, `${G.g_nRunPhase} ${G.g_game_over_timer}`);
  run(2, rng, ev);
  check("...then phase 2 arms the logo, 180 frames, with the camera block "
        + "reset to the origin and the stage still released",
        G.g_nRunPhase === 3 && G.g_game_over_timer === 0xb4
        && G.g_game_over_logo_frame === 0 && G.g_stage_unloaded === 1
        && G.g_camera_block_eye.x === 0 && G.g_camera_block_target.z === 0);
  run(1, rng, ev);
  const plate = G.g_screen_sprite_anims[0];
  check("the logo's first frame spawns the GAME OVER plate 0x43A at "
        + "(320, 240), fading in from 0 by 0.02 a frame",
        !!plate && plate.id === 0x43a && plate.x === 320 && plate.y === 240
        && Math.abs(plate.alpha - 0.02) < 1e-9, JSON.stringify(plate));
  run(0x78, rng, ev);
  check("...and 120 frames on, the flashes: 0x43B at (340, 260)",
        G.g_screen_sprite_anims.some((s) => s.id === 0x43b && s.x === 340),
        G.g_screen_sprite_anims.map((s) => s.id.toString(16)).join(","));
  check("the scene's actors stand still on the game-over screen",
        !z0 || !zAt || (z0.pos.x === zAt.x && z0.pos.z === zAt.z));
  // The route this game took: the checkpoint the harness never ran, so the
  // history is as the reset left it plus one block -- stage 1, block 0.
  G.g_route_history[0][0] = 0;
  G.g_route_history[0][1] = -1;
  G.g_route_history[0][2] = 1;          // a second entry of 0 is "empty"
  for (let i = 0; i < 0xb4 && G.g_nRunPhase !== 5; i++) run(1, rng, ev);
  const rm = G.g_route_map;
  check("after the logo the route map: one figure, player 1's, on its walk "
        + "clip, the cursor at (-16, -146) aimed at the block's waypoint",
        G.g_nRunPhase === 5 && G.g_route_figures.length === 1
        && G.g_route_figures[0].charType === 0x39
        && G.g_route_figures[0].motion === 0x35b
        && rm.cursorX === -16 && rm.targetY === -98,
        `phase ${G.g_nRunPhase} ${JSON.stringify(rm)}`);
  run(1, rng, ev);
  const tiles = G.g_screen_sprite_draws;
  check("...the map drawn as 300 tiles through DrawScreenSprite, screen 1's "
        + "first at the top-left, depth 120",
        tiles.length === 300 && tiles[0].id === 0xce && tiles[0].x === 0
        && tiles[0].y === 0 && tiles[0].depth === 120 && tiles[0].flags === 0,
        `${tiles.length} ${JSON.stringify(tiles[0])}`);
  run(11, rng, ev);
  check("the figure walks 4 map pixels a frame down the map, leaving a "
        + "footprint a step -- and on the waypoint the history runs out: the "
        + "done word goes to 1 that frame",
        rm.cursorY === -98 && G.g_route_marks.length === 12
        && G.g_route_figures[0].yaw === 0
        && G.g_game_over_route_done === 1,
        `y ${rm.cursorY} marks ${G.g_route_marks.length} `
        + `done ${G.g_game_over_route_done}`);
  run(1, rng, ev);
  check("...and the figure blends into its end clip, 0x338, over 10 frames",
        G.g_route_figures[0].motion === 0x338
        && G.g_route_figures[0].fadeFrom?.motion === 0x35b
        && G.g_game_over_route_done === 2);
  run(0x78, rng, ev);
  check("...held 0x78 frames the screen is still up",
        G.g_app_state === AppState.GameOver);
  run(1, rng, ev);
  check("0x78 frames on the end clip, and the screen hands on by itself: "
        + "credits cleared, app state 3",
        G.g_app_state === 3 && G.g_credits[0] === 0
        && G.g_player_state[0] === PlayerState.Out,
        `app ${G.g_app_state} done ${G.g_game_over_route_done}`);
  G.g_option_credits = -1;
}

{
  // The port's options: `g_option_credits` (0x009C9F25) at -1, free play --
  // the value `ModeStartCounterValue` meets with `CMP AL,0xff` at
  // `0x00496B8B`. The start from the title seeds free play, and a spend in
  // play succeeds without taking anything.
  G.g_GameMode = GameMode.Arcade;
  ResetGameGlobals();
  SetGameTables(CHARS);
  check("the port starts in free play: g_option_credits is -1 and an Arcade "
        + "start from the title seeds free play, not six credits",
        G.g_option_credits === -1
        && ModeStartCounterValue(GameMode.Arcade) === -1
        && G.g_free_play === 1 && CreditsAvailable() === 1,
        `option ${G.g_option_credits} free ${G.g_free_play} `
        + `credits ${G.g_credits}`);
  const before = [...G.g_credits];
  let spent = 0;
  for (let i = 0; i < 20; i++) spent += CreditTrySpend(0, 1);
  check("...and twenty continues all succeed and take nothing",
        spent === 20 && G.g_credits[0] === before[0],
        `spent ${spent} credits ${before} -> ${G.g_credits}`);
}

{
  // `RouteFigureTick` (`FUN_004614C0`): the step picks the yaw -- 0x8000 up
  // the map, 0x4000 x+, -0x4000 x-, 0 down -- and the figure lies at X 0x4000.
  const fig = { kind: 0, charType: 0x39, motion: 0x35b, playTicks: 0,
                fadeFrom: null, fade: 0, fadeLen: 0, end: 0x338, xOff: 0,
                held: 0, pitch: 0x4000, yaw: 0, view: vec3(), disc: vec3() };
  const yawFor = (cx: number, cy: number, tx: number, ty: number): number => {
    G.g_game_over_route_done = 0;
    G.g_route_marks = [];
    G.g_route_map = { scroll: 0, markSlot: 0, stage: 0, block: 0, dir: 0,
                      wp: 0, entry: 0, cursorY: cy, targetX: tx, targetY: ty,
                      screenY: 50, cursorX: cx };
    RouteFigureTick(fig);
    return fig.yaw;
  };
  check("a route figure turns by its step: up 0x8000, x+ 0x4000, "
        + "x- -0x4000, down 0, lying at X 0x4000",
        yawFor(0, 10, 0, 0) === 0x8000 && yawFor(0, 0, 10, 0) === 0x4000
        && yawFor(10, 0, 0, 0) === -0x4000 && yawFor(0, 0, 0, 10) === 0
        && fig.pitch === 0x4000);
}

{
  // `GameOverCameraFlyTick` (`FUN_00460E60`): the path frame is its own
  // counter, the pose goes straight into the block, and the counter steps.
  const key = (t: number, v: number) => [t, v, 0, 0];
  const path = new CamPath(0x1f, {
    file: "cp_gmovr", index: 0, start: 10, duration: 200,
    channels: {
      eye_x: [key(10, 1), key(210, 201)], eye_y: [key(10, 5), key(210, 5)],
      eye_z: [key(10, 0), key(210, 0)], target_x: [key(10, 0), key(210, 0)],
      target_y: [key(10, 0), key(210, 0)],
      target_z: [key(10, -1), key(210, -1)],
    },
  } as never, false);
  const paths = new CamPaths({ fps: 60, paths: {}, object_paths: {} } as never);
  paths.paths.set(0x1f, path);
  SetCameraPaths(paths);
  G.g_game_over_fly_frame = 50;
  GameOverCameraFlyTick();
  check("the fly-over tick evaluates path 0x1F at its own counter into the "
        + "camera block, then counts on",
        G.g_cam_path_frame === 50 && G.g_game_over_fly_frame === 51
        && Math.abs(G.g_camera_block_eye.y - 5) < 1e-9
        && Math.abs(G.g_camera_block_target.z + 1) < 1e-9,
        `frame ${G.g_cam_path_frame} eye ${JSON.stringify(G.g_camera_block_eye)}`);
}

{
  // A stage step keeps the player: the block rides across, and
  // `AdvanceToNextScene` parks them at 2 for row 2 -- no lives, no counts.
  G.g_GameMode = GameMode.Arcade;
  ResetGameGlobals();
  EnterPlay();
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_scene_state_major = SCENE_MAJOR_PLAYING;
  PlayerTakeDamage(0, 1, 9);
  ScoreAddForPlayer(0, 500);
  const carry = PlayerBlockCapture();
  ResetGameGlobals(carry);
  check("across a stage step the player re-enters by row 2: lives and score kept, counts unchanged, "
        + "90 frames' grace",
        G.g_player_state[0] === PlayerState.InPlay
        && G.g_player_lives[0] === 2 && G.g_player_score[0] === 500
        && G.g_players_in_play === 1 && G.g_max_attackers === 1
        && G.g_player_invuln_frames[0] === 90,
        `state ${G.g_player_state[0]} lives ${G.g_player_lives[0]} `
        + `score ${G.g_player_score[0]} in ${G.g_players_in_play}`);
}

{
  // `ActorStrikeConnect`'s two arms: the permit's player, the latch, and the
  // strike-and-leave arm that passes 0 and despawns (`0x004564F1`).
  const rng = new Rng(8);
  scene(1, rng);
  const z = G.g_object_list[0] as ZombieActor;
  z.attackPermit = 0;
  z.zones = 0;
  const atk = { cancel_mask: 8, overlay_kind: 5 } as unknown as
    Parameters<typeof ActorStrikeConnect>[1];
  const lives = G.g_player_lives[0];
  ActorStrikeConnect(z, atk);
  check("a strike lands on the permit's player and raises the hit latch",
        G.g_player_lives[0] === lives - 1 && G.g_player_was_hit[0] === 1
        && G.g_player_damage_overlay_kind[0] === 5 && !z.despawned);
  RunOutInvulnerability();
  G.g_player_was_hit[0] = 0;
  z.flags |= ActorFlag.StrikeAndLeave;
  ActorStrikeConnect(z, atk);
  check("...with obj+0x34 bit 0x2000000 it lands without the latch and the "
        + "striker leaves", G.g_player_lives[0] === lives - 2
        && G.g_player_was_hit[0] === 0 && z.despawned,
        `lives ${G.g_player_lives[0]} latch ${G.g_player_was_hit[0]} `
        + `despawned ${z.despawned}`);
}

{
  // `UpdateDamageRank` / `ResetDamageRank`, through `GameUpdate` from the
  // page's own reset: the seed on the first frame, a player's entry, a hit's
  // pending -2, and the clock.
  const rng = new Rng(12);
  G.g_GameMode = GameMode.Arcade;
  ResetGameGlobals();
  SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_scene_state_major = SCENE_MAJOR_PLAYING;
  check("the reset leaves run phase 0, ResetGameOnStart",
        G.g_nRunPhase === RunPhase.ResetGameOnStart, `${G.g_nRunPhase}`);
  const seed = CHARS.difficulty?.initial_rank?.[G.g_difficulty] ?? 0;
  run(1, rng, new Events());
  check("the first frame seeds the rank from the difficulty and adds 4 for "
        + "the player who entered: CommitAppState zeroed what the rank had seen",
        G.g_damage_rank === Math.min(15, Math.max(0, seed + 4))
        && G.g_nRunPhase === RunPhase.InPlay && G.g_rank_clock === 2,
        `seed ${seed} rank ${G.g_damage_rank} clock ${G.g_rank_clock}`);
  RunOutInvulnerability();
  const before = G.g_damage_rank;
  PlayerTakeDamage(0, 1, 9);
  check("a hit only queues -2", G.g_damage_rank === before
        && G.g_damage_rank_pending === -2);
  run(1, rng, new Events());
  check("...and the next frame applies it and restarts the clock",
        G.g_damage_rank === Math.max(0, before - 2)
        && G.g_damage_rank_pending === 0 && G.g_rank_clock === 1,
        `rank ${G.g_damage_rank} clock ${G.g_rank_clock}`);
  const r = G.g_damage_rank;
  G.g_rank_clock = 0x708;
  UpdateDamageRank();
  check("every 0x708 frames of clock the rank rises one -- two with four "
        + "lives or more", G.g_damage_rank === Math.min(15, r + 1)
        && G.g_player_lives[0] < 4, `rank ${r} -> ${G.g_damage_rank}`);
}

{
  // `CheckPlayerCanBeHit`: indices, and in play the states 1, 4 and 5 only.
  G.g_GameMode = GameMode.Arcade;
  ResetGameGlobals();
  EnterPlay();
  check("CheckPlayerCanBeHit refuses an index that is not 0 or 1",
        CheckPlayerCanBeHit(2) === -1 && CheckPlayerCanBeHit(-1) === -1);
  check("...and a player at 9 while a stage runs",
        CheckPlayerCanBeHit(1) === -3 && CheckPlayerCanBeHit(0) === 0);
}

console.log("\nthe continue screen, as the exe draws it:");
{
  // Into the continue the way a game gets there: the reset's start press, a
  // strike on the path camera that takes the last life, and `GameUpdate`.
  // What is asserted is what the frame drew -- `g_screen_sprite_draws`, which
  // the HUD layer puts on the screen -- read against the pushes in
  // `RunPhaseContinueCountdown` (`FUN_00460530`), `CreditPromptDraw`
  // (`FUN_00406CE0`) and `PlayerContinueCountdown` (`FUN_00414280`).
  const rng = new Rng(5);
  const ev = new Events();
  G.g_GameMode = GameMode.Arcade;
  G.g_option_credits = OPTIONS_FACTORY.credits;  // counts, not free play
  scene(0, rng);
  const at = (id: number) => G.g_screen_sprite_draws.filter((d) => d.id === id);
  const listed = () => JSON.stringify(G.g_screen_sprite_draws.map((d) =>
    [d.id.toString(16), d.x, d.y]));
  run(1, rng, ev);
  check("in play: the crosshair is drawn, the gameplay gate is open, and "
        + "player 2's corner has the credit line -- 'PRESS START BUTTON' at "
        + "(384, 412) x1.4 over 'CREDIT(S)' at (424, 427)",
        G.g_crosshair_drawn[0] === 1 && EvtGameplayLiveUpdate() === 1
        && at(ContinueSprite.PressStart).some((d) => d.x === 384
          && d.y === 412 && Math.abs(d.sx - 1.4) < 1e-6 && d.flags === 5)
        && at(ContinueSprite.Credits).some((d) => d.x === 424 && d.y === 427),
        listed());

  // Frame 1 takes the player out (state 4), frame 2 puts the run in phase 3
  // and arms the countdown, frame 3 is phase 3 and moves the run to 4.
  G.g_player_lives[0] = 1;
  PlayerTakeDamage(0, 1, 9);
  run(3, rng, ev);
  check("the last life gone: player 1 at 4 and the run in phase 4",
        G.g_player_state[0] === PlayerState.Continue
        && G.g_nRunPhase === RunPhase.ContinueCountdown,
        `state ${G.g_player_state[0]} phase ${G.g_nRunPhase}`);
  run(1, rng, ev);
  const big = at(ContinueSprite.Continue);
  const digits = G.g_screen_sprite_draws.filter(
    (d) => d.id >= ContinueSprite.BigDigit0
      && d.id <= ContinueSprite.BigDigit0 + 9);
  check("the run draws 'CONTINUE?' 0x22C at (128, 200) and the 64x128 digit "
        + "0x4F + 9 at (482, 188), scale 1, top-left anchored -- and nothing "
        + "else draws a CONTINUE?",
        big.length === 1 && big[0].x === 128 && big[0].y === 200
        && big[0].sx === 1 && big[0].flags === 0
        && digits.length === 1 && digits[0].id === ContinueSprite.BigDigit0 + 9
        && digits[0].x === 482 && digits[0].y === 188,
        JSON.stringify([...big, ...digits]));
  check("...under it player 1's credit line, 'PRESS START BUTTON' at "
        + "(42, 412) and 'CREDIT(S) 5' from (82, 427), the 5 at 176",
        at(ContinueSprite.PressStart).some((d) => d.x === 42 && d.y === 412)
        && at(ContinueSprite.Credits).some((d) => d.x === 82 && d.y === 427)
        && G.g_screen_sprite_draws.some((d) => d.id === HudSprite.Digit0 + 5
          && d.x === 176 && d.y === 427),
        listed());
  check("...no crosshair, no lives, and the script's gate shut",
        G.g_crosshair_drawn[0] === 0
        && at(HudSprite.Lamp1P).length === 0 && EvtGameplayLiveUpdate() === 0);

  // The digit, frame by frame: 0x9FFF less 0x2D a frame, `>> 12`. The frame
  // above was the first of phase 4; these are the second onwards.
  const shown: number[] = [];
  const lineOn: boolean[] = [];
  const lineWanted: boolean[] = [];
  const clocks: number[] = [];
  for (let f = 0; f < 200; f++) {
    // The walk reads the clock `CreditBlinkTick` left last frame.
    const c = G.g_credit_blink_clock;
    clocks.push(c);
    run(1, rng, ev);
    const d = G.g_screen_sprite_draws.find(
      (s) => s.id >= ContinueSprite.BigDigit0
        && s.id <= ContinueSprite.BigDigit0 + 9);
    shown.push(d ? d.id - ContinueSprite.BigDigit0 : -1);
    lineOn.push(at(ContinueSprite.PressStart).some((s) => s.x === 42));
    lineWanted.push(((c >> 5) % 3) !== 2);
  }
  const nines = shown.filter((d) => d === 9).length;
  check("the digit shows 9 for 92 frames in all -- 0x1000 / 0x2D -- then 8, "
        + "and 7 by the 184th",
        nines === 91 && shown[91] === 8 && shown[182] === 7
        && shown.every((d) => d >= 7),
        `${nines} nines after the first, then ${shown.slice(88, 96)}`);
  check("...the credit line's clock steps one a frame, and the line is off "
        + "exactly where (clock >> 5) % 3 == 2: 64 frames on, 32 off",
        clocks.every((c, i) => i === 0 || c === clocks[i - 1] + 1)
        && lineOn.every((b, i) => b === lineWanted[i])
        && lineOn.includes(true) && lineOn.includes(false),
        `${lineOn.filter((b) => !b).length} frames off of 200`);

  // START with a credit: back in play, and the screen goes. The frame of the
  // press still draws CONTINUE? -- the run draws before it tests -- and the
  // next is in play.
  G.g_pad_state = PadBit.Start0;
  run(1, rng, ev);
  G.g_pad_state = 0;
  run(1, rng, ev);
  check("START continues: in play, 'CONTINUE?' gone, the crosshair back, "
        + "the gate open, and a credit spent",
        G.g_player_state[0] === PlayerState.InPlay
        && G.g_nRunPhase === RunPhase.InPlay
        && at(ContinueSprite.Continue).length === 0
        && G.g_crosshair_drawn[0] === 1 && EvtGameplayLiveUpdate() === 1
        && G.g_credits[0] === 4,
        `state ${G.g_player_state[0]} credits ${G.g_credits[0]} ${listed()}`);
  G.g_option_credits = -1;
}

{
  // Two players: player 1 continues in their half while player 2 plays on,
  // so the run stays in phase 2 and the per-player countdown draws its own.
  const rng = new Rng(6);
  const ev = new Events();
  const at = (id: number) => G.g_screen_sprite_draws.filter((d) => d.id === id);
  const listed = () => JSON.stringify(G.g_screen_sprite_draws.map((d) =>
    [d.id.toString(16), d.x, d.y]));
  G.g_GameMode = GameMode.Arcade;
  scene(0, rng);
  JoinPlayerTwo();
  G.g_player_lives[0] = 1;
  PlayerTakeDamage(0, 1, 9);
  run(3, rng, ev);
  const layered = G.g_screen_sprite_draws.filter((d) => (d.flags & 0x700));
  const small = layered.find((d) => d.id === ContinueSprite.Continue);
  const digit = layered.find((d) => d.id === ContinueSprite.BigDigit0 + 9);
  check("two players: the run stays in play and player 1's countdown draws "
        + "the small CONTINUE? at (48, 170) x0.6/0.8 and its digit at "
        + "(260, 160), through the layered queue",
        G.g_nRunPhase === RunPhase.InPlay
        && G.g_player_state[0] === PlayerState.Continue
        && !!small && small.x === 48 && small.y === 170
        && Math.abs(small.sx - 0.6) < 1e-6 && Math.abs(small.sy - 0.8) < 1e-6
        && !!digit && digit.x === 260 && digit.y === 160
        && G.g_screen_sprite_draws.every((d) =>
          d.id !== ContinueSprite.Continue || d === small),
        JSON.stringify(layered));
  check("...and player 2 in play keeps the script's gate open",
        EvtGameplayLiveUpdate() === 1);
  // The trigger: no use on the first two digits (`CMP EAX, 0x8000; JGE`),
  // and from 7 down it knocks the count to the bottom of its digit.
  const pull = () => QueueShotRequest(0, { origin: vec3(), dir: vec3(0, 0, 1) });
  let before = G.g_player_continue_timer[0];
  pull();
  run(1, rng, ev);
  check("a pull on the 9 does nothing but the frame's 0x2D",
        G.g_player_continue_timer[0] === before - 0x2d,
        `${before.toString(16)} -> `
        + `${G.g_player_continue_timer[0].toString(16)}`);
  while (G.g_player_continue_timer[0] >= 0x8000) run(1, rng, ev);
  before = G.g_player_continue_timer[0];
  pull();
  run(1, rng, ev);
  check("...one on the 7 knocks it to the bottom of its digit",
        G.g_player_continue_timer[0] === (before & ~0xfff) + 1 - 0x2d,
        `${before.toString(16)} -> `
        + `${G.g_player_continue_timer[0].toString(16)}`);
  // Let it run out: the small GAME OVER, then out.
  let frames = 0;
  while (G.g_player_state[0] === PlayerState.Continue && frames < 1200) {
    run(1, rng, ev);
    frames += 1;
  }
  run(1, rng, ev);
  const overs = G.g_screen_sprite_draws.filter(
    (d) => d.id === ContinueSprite.GameOver);
  check("run out, player 1 is game over in play: the arming frame draws the "
        + "small GAME OVER 0x43E at (45, 170) x0.6/0.7 twice -- "
        + "PlayerStateArmGameOver, then the wait it calls",
        G.g_player_state[0] === PlayerState.GameOver && overs.length === 2
        && overs[0].x === 45 && overs[0].y === 170
        && Math.abs(overs[0].sy - 0.7) < 1e-6,
        `state ${G.g_player_state[0]} ${JSON.stringify(overs)}`);
  let shownFor = 1;
  while (G.g_player_state[0] === PlayerState.GameOver && shownFor < 400) {
    run(1, rng, ev);
    if (G.g_screen_sprite_draws.some((d) => d.id === ContinueSprite.GameOver)) {
      shownFor += 1;
    }
  }
  check("...on 119 frames in all: the wait counts 0x78 and draws on every "
        + "one but the last, which puts player 1 out",
        shownFor === 119 && G.g_player_state[0] === PlayerState.Out,
        `${shownFor} frames, state ${G.g_player_state[0]}`);
  const c = G.g_credit_blink_clock;
  run(1, rng, ev);
  check("...and out, player 1's corner has the credit line again",
        at(ContinueSprite.Credits).some((d) => d.x === 82)
          === (((c >> 5) % 3) !== 2),
        listed());
}

{
  // `g_evt_gameplay_live` in the walker: with the gate shut every wait holds,
  // `wait_frames` included, and it goes on the first frame the gate opens.
  const script = {
    scene: 0, stage: 1, game_mode: 0, evt_file: "test", entry_block: 0,
    entry_step: 0, routes: [{ kind: "end", next: [-1, -1, -1] }],
    regions: [], cam_slots_used: [], warnings: [],
    blocks: [{
      index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
      steps: [{ index: 0, at: 0, ops: [
        { i: 0, at: 0, op: 0x42, name: "wait_frames", cat: "wait", arg: 3,
          blocks_on: "frames" },
        { i: 1, at: 1, op: 0x44, name: "wait_enemies_alive", cat: "wait",
          arg: 0, blocks_on: "enemies alive <= arg" },
        { i: 2, at: 2, op: 0x42, name: "wait_frames", cat: "wait", arg: 100,
          blocks_on: "frames" },
      ] }],
    }],
  } as unknown as ScriptJson;
  let live = false;
  const w = new Walker(script, {
    enterRegion: () => undefined, loadSlot: () => undefined,
    unloadSlot: () => undefined, startCamera: () => undefined,
    onFeed: () => undefined, onBranch: () => undefined,
    playSound: () => undefined, aliveEnemies: () => 0,
    presentEnemies: () => 0, aliveCivilians: () => 0, cameraFree: () => true,
    scriptFlagRaised: () => null, gameplayLive: () => live,
    showMessage: () => null,
  });
  for (let f = 0; f < 10; f++) w.tick(1 / 60);
  check("the script holds at wait_frames 3 for ten frames while no player "
        + "is in play", w.opIndex === 0, `op ${w.opIndex}`);
  live = true;
  w.tick(1 / 60);
  check("...and goes on the frame the gate opens: the count ran down while "
        + "it was shut", w.opIndex === 1, `op ${w.opIndex}`);
  live = false;
  for (let f = 0; f < 10; f++) w.tick(1 / 60);
  check("wait_enemies_alive 0 with nobody alive holds while the gate is shut",
        w.opIndex === 1, `op ${w.opIndex}`);
  live = true;
  w.tick(1 / 60);
  check("...and passes once it opens", w.opIndex === 2, `op ${w.opIndex}`);
}

console.log("\nIsPlayerAttackable: the scene has to be running:");
{
  // Three clauses, all ported. The first is the interesting one:
  // nothing may attack unless the scene state's major is 2, the `cam/` path
  // camera row -- so a scripted view-angle turn is a window in which the
  // player cannot be hit.
  ResetGameGlobals();
  EnterPlay();
  SetGameTables(CHARS);
  G.g_player_lives = [2, 2];
  check("a player is not attackable before a scene state is entered",
        !IsPlayerAttackable(0), "attackable at major 0");

  G.g_scene_state_major_entered = 1;
  G.g_scene_state_major = 1;
  check("...nor while the follow camera or a scripted turn drives",
        !IsPlayerAttackable(0), "attackable at major 1");

  G.g_scene_state_major_entered = 2;
  G.g_scene_state_major = 2;
  check("...but is once the path camera is driving", IsPlayerAttackable(0),
        "not attackable at major 2");

  // The attract override: the demo has no real player, so `g_player_state` is
  // never 5, and without this the demo would never be attacked.
  G.g_scene_state_major_entered = 2;
  G.g_scene_state_major = 2;
  // The third clause is the state word itself, and nothing else: lives are
  // not in it. The reset leaves player 1 at 9, out of the game, as boot does.
  check("player 1 is out of a one-player game, lives or no lives",
        G.g_player_state[1] === PlayerState.Out && G.g_player_lives[1] > 0
        && !IsPlayerAttackable(1), `state ${G.g_player_state[1]}`);
  G.g_player_state = [PlayerState.Out, PlayerState.Out];
  check("a player who is not in play is not attackable",
        !IsPlayerAttackable(0), "still attackable");
  G.g_app_state = AppState.Attract;
  check("...unless the attract demo is running, which overrides it",
        IsPlayerAttackable(0), "override did not fire");
  G.g_app_state = AppState.InPlay;
  G.g_player_state = [PlayerState.InPlay, PlayerState.Out];

  // ...and the engine's own third clause, for when a player state exists.
  G.g_player_state = [5, 0];
  check("a player the state word says is in play is attackable regardless",
        IsPlayerAttackable(0) && !IsPlayerAttackable(1),
        `${IsPlayerAttackable(0)}/${IsPlayerAttackable(1)}`);

  // The port's own guard. The engine reads 0x130 bytes below the array here.
  check("...and -1 is nobody", !IsPlayerAttackable(-1), "attackable");

  // **And the gate is wired into the claim**, which is the call site the port
  // used to leave out. `TryClaimAttackSlot` picks a player and voids the pick
  // when this refuses, so no enemy takes a permit during a scripted camera.
  {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS);
    G.g_player_lives = [2, 2];
    const z = spawnZombie(0x7D00, 1, "claimant");
    z.visible = true;
    z.hp = z.maxHp = 100;
    G.g_scene_state_major_entered = 1;
    G.g_scene_state_major = 1;
    check("no permit is granted while a scripted camera drives",
          !TryClaimAttackSlot(z, new Rng(1)) && z.attackPermit === -1,
          `permit ${z.attackPermit}`);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    check("...and one is the moment the path camera takes over",
          TryClaimAttackSlot(z, new Rng(1)) && z.attackPermit === 0,
          `permit ${z.attackPermit}`);
  }
}

console.log("\nResetSceneOnEnter: what a scene starts clean:");
{
  // `ResetSceneOnEnter` (`FUN_0045EDD0`) is the engine's per-scene reset, and
  // the port's `ResetGameGlobals` calls it — the same nesting the exe has,
  // where `ResetGameOnStart` (`FUN_0045FEF0`) zeroes the run totals and the
  // scene load zeroes these.
  ResetGameGlobals();
  EnterPlay();
  SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_scene_state_major = SCENE_MAJOR_PLAYING;
  G.g_enemies_alive = 4;
  G.g_enemies_present = 7;
  G.g_civilians_alive = 3;
  G.g_script_flags[9] = 1;
  G.g_head_combo_bonus = [130, 140];
  G.g_player_hit_count = [22, 31];
  // ...and something it must NOT touch: the run keeps the score across scenes.
  G.g_player_score = [4200, 900];

  ResetSceneOnEnter();
  check("a scene starts with both enemy counts at zero",
        G.g_enemies_alive === 0 && G.g_enemies_present === 0,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);
  check("...and no civilians counted",
        G.g_civilians_alive === 0, String(G.g_civilians_alive));
  check("...and every script flag down",
        (G.g_script_flags[9] ?? 0) === 0, String(G.g_script_flags[9]));
  // The shot statistics are per **scene**, which is what makes the accuracy
  // grade `EvtOpAwardAccuracyBonus2B` (`FUN_0045FE40`) pays a per-stage one.
  check("...and the per-scene shot statistics cleared for both players",
        G.g_head_combo_bonus[0] === 0 && G.g_head_combo_bonus[1] === 0
        && G.g_player_hit_count[0] === 0 && G.g_player_hit_count[1] === 0,
        `${G.g_head_combo_bonus} / ${G.g_player_hit_count}`);
  check("...but the score survives, because it is a run total and not a scene one",
        G.g_player_score[0] === 4200 && G.g_player_score[1] === 900,
        String(G.g_player_score));

  // **The scene enter has to go through it.** `GameSystem.attach` -- the port's
  // stand-in for the engine's scene load -- calls `ResetGameGlobals`, and that
  // is the only path into a stage. If the two are ever decoupled, a stage
  // switch carries the last stage's script flags and enemy counts into the
  // next one, which is precisely what the engine's reset exists to stop.
  G.g_enemies_alive = 9;
  G.g_script_flags[4] = 1;
  G.g_civilians_alive = 2;
  ResetGameGlobals();
  EnterPlay();
  check("the pool reset still performs the scene reset",
        G.g_enemies_alive === 0 && G.g_civilians_alive === 0
        && (G.g_script_flags[4] ?? 0) === 0,
        `${G.g_enemies_alive}/${G.g_civilians_alive}/${G.g_script_flags[4]}`);
}

console.log("\nthe two enemy counters, stepped and not derived:");
{
  // `g_enemies_alive` and `g_enemies_present` are what 488 enemy gates wait
  // on. The port used to recount the pool every frame, which cannot express
  // either of the two things the engine uses them for: a corpse that is
  // present but not alive, and an actor deliberately left out of the count.
  const zombie = (init: number, charType = 1) => {
    const z = spawnZombie(0x7B00 + init, charType, "counted",
                         { initialState: init });
    z.visible = true;
    z.hp = z.maxHp = 100;
    return z;
  };

  ResetGameGlobals();
  EnterPlay();
  SetGameTables(CHARS);
  G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
  G.g_scene_state_major = SCENE_MAJOR_PLAYING;
  check("a scene starts with both counts at zero",
        G.g_enemies_alive === 0 && G.g_enemies_present === 0,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);

  const a = zombie(ZombieState.AttackRun);
  check("an ordinary zombie counts itself in at Init",
        G.g_enemies_alive === 1 && G.g_enemies_present === 1,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);

  // `EnemyZombieInit`'s two exclusions, and they are the point of the rewrite.
  zombie(ZombieState.AttackRun, UNCOUNTED_CHAR_TYPE);
  check("...but character type 9 is not an enemy and is never counted",
        G.g_enemies_alive === 1, String(G.g_enemies_alive));
  const late = zombie(ZombieState.WaitScriptFlagThenEnter);
  check("...and a state-31 spawn is not counted until its flag comes up",
        G.g_enemies_alive === 1, String(G.g_enemies_alive));

  // The state counts itself in, which is the whole reason it exists.
  late.entry = { flag: 3, idle_motion: 10, motion: 923, delay: 0 };
  G.g_camera_fixed_eye_y = 0;
  G.g_script_flags[3] = 1;
  for (let f = 0; f < 3; f++) {
    EnemyZombieUpdate(late, { dt: 1 / 60, rng: new Rng(1), host: NULL_HOST });
  }
  check("...and then it does", G.g_enemies_alive === 2 && G.g_enemies_present === 2,
        `${G.g_enemies_alive}/${G.g_enemies_present}`);

  // The latch: six routines call the releases and more than one can reach the
  // same actor, so without it the count goes negative and a gate opens early.
  ReleaseEnemyAliveCount(a);
  ReleaseEnemyAliveCount(a);
  ReleaseEnemyAliveCount(a);
  check("the alive release is latched — three calls, one decrement",
        G.g_enemies_alive === 1, String(G.g_enemies_alive));
  check("...and it did not touch the present count",
        G.g_enemies_present === 2, String(G.g_enemies_present));

  // Which is the distinction the derived count could not express at all.
  ReleaseEnemyPresentCount(a);
  check("a corpse leaves `alive` before it leaves `present`",
        G.g_enemies_present === 1, String(G.g_enemies_present));
}

console.log("\nthe player's body in stage 1's car:");
{
  // Stage 1 block 0's `set_update_routine 0` (`EvtActionSetUpdateRoutine12`)
  // seats the body (`PlayerHookEnterSt1Vehicle`, `PlayerHookRideSt1Vehicle`),
  // and `PlayerHookDrawBody` draws it because the routine raised flag bit 0.
  // Driven from the reset, through the action dispatcher and `GameUpdate`.
  const rng = new Rng(5);
  const ev = new Events();
  const zeros = (n: number) => new Array(n * 3).fill(0);
  const body = (type: number, hand: number) => ({
    ...TYPE, type, bones: [{ bone: 5, slot: hand }],
    motions: {
      "802": { bank: 0, frames: 31, fps: 30, play: 60, root: zeros(31), rot: [] },
      "793": { bank: 0, frames: 21, fps: 30, play: 40, root: zeros(21), rot: [] },
      "812": { bank: 0, frames: 2, fps: 30, play: 2, root: zeros(2), rot: [] },
    },
  });
  G.g_GameMode = GameMode.Arcade;
  ResetGameGlobals();
  SetGameTables({
    ...CHARS, types: { ...CHARS.types, "57": body(0x39, 5521),
                       "58": body(0x3a, 5540) },
    player_hand_slots: [5519, 5521, 5522, 5539, 5540, 5541],
  } as never);
  // `ExeTables.gameOverTables`' values, read from the exe.
  SetGameOverTables({
    body_char_types: [0x39, 0x3a], body_start_motions: [0x32c, 0x32c],
    fall_motions: [0x338, 0x338], fall_frames: [0x50, 0x3c],
    body_offsets: [[0, 0], [0, 0], [-5, -1.9], [4.2, 0.7]],
    route_tiles: [0xce, 0x119, 0x164, 0x1af], route_waypoints: [],
    default_route: [],
    entity_offsets: [0, 0, -3, 3],
    seat_x: [304, -304, -4.6755, -4.6755, -4.6755, 4.6755],
    stand_points: [[-728.8, 36.01, -1319.8], [-728.8, 36.01, -1319.8],
                   [-736.9, 36.01, -1316.2], [-728.8, 36.01, -1319.8]],
    stand_motions: [0, 0, 0x356, 0x356, 0x349, 0x356],
  });
  PlayerBodiesCreate();
  // `op_st1` 1, as a constant pose: (100, 7, 50), turned half round. Half a
  // turn is the angle whose seat point does not depend on RotY's sign.
  const k = (v: number) => [[0, v, 0, 0], [350, v, 0, 0]];
  const paths = new CamPaths({ fps: 60, paths: {}, object_paths: {} } as never);
  paths.objectPaths.set(0xfe, new CamPath(0xfe, {
    file: "op_st1", index: 1, start: 0, duration: 350,
    channels: { pos_x: k(100), pos_y: k(7), pos_z: k(50), rot_x: k(0),
                rot_y: k(0x8000), rot_z: k(0) },
  } as never, true));
  SetCameraPaths(paths);
  run(1, rng, ev);
  const b = G.g_player_bodies[0];
  check("in play the body is made and placed on the eye, and not drawn: "
        + "row 0's `+0x80` hook, flag bit 0 down",
        G.g_player_bodies.length === 2 && b.handSlot === 5521
        && G.g_player_entity_hook[0] === PlayerEntityHook.PlaceEntityB
        && (G.g_player_flags[0] & 1) === 0 && b.drawn === 0,
        JSON.stringify({ hook: G.g_player_entity_hook, f: G.g_player_flags,
                         drawn: b.drawn }));

  G.g_active_cam_path = 0x21;
  G.g_cam_path_frame = 100;
  G.g_evt_action_handler = EvtActionHandler.SetUpdateRoutine;
  G.g_evt_action_operands[0] = 0;
  EvtCallActionHandler();
  check("`set_update_routine 0` installs `PlayerHookEnterSt1Vehicle` for "
        + "both players",
        G.g_player_entity_hook[0] === PlayerEntityHook.EnterSt1Vehicle
        && G.g_player_entity_hook[1] === PlayerEntityHook.EnterSt1Vehicle);
  run(1, rng, ev);
  check("...whose one frame raises the draw bit, puts the body on 0x322 with "
        + "hand 0 and hands over to the ride -- and the body is drawn",
        (G.g_player_flags[0] & 1) === 1 && b.motion === 0x322
        && b.handSlot === 5519 && b.drawn === 1 && b.playTicks === 1
        && G.g_player_entity_hook[0] === PlayerEntityHook.RideSt1Vehicle,
        JSON.stringify(b));
  run(1, rng, ev);
  check("on cp 0x21 the ride seats it at the wheel: route point + "
        + "RotY(0x8000) (-4.6755, 0, 0.239), y 0, yaw ry + 0x8000",
        Math.abs(b.pos.x - (100 + 4.6755)) < 1e-4
        && Math.abs(b.pos.z - (50 - 0.239)) < 1e-4
        && b.pos.y === 0 && b.yaw === 0x10000 && b.drawn === 1,
        JSON.stringify(b.pos) + ` yaw ${b.yaw}`);

  G.g_cam_path_frame = 0x105;
  b.pos.x = 1;
  run(1, rng, ev);
  check("...past frame 0x104 it keeps its own x",
        b.pos.x === 1, JSON.stringify(b.pos));

  G.g_active_cam_path = 0x22;
  G.g_cam_path_frame = 0xc;
  const before = b.playTicks;
  run(1, rng, ev);
  check("on cp 0x22 frame 0xC: clip 0x319 from cursor 5 under a fade that "
        + "leaves the counter running, and the hold-the-end hook",
        b.motion === 0x319 && b.cursor === 5 && b.playTicks === before + 1
        && G.g_player_entity_hook[0] === PlayerEntityHook.HoldClipEnd,
        `motion ${b.motion} cursor ${b.cursor} ticks ${b.playTicks}`);
  run(1, rng, ev);
  check("...and the fade's end puts the counter on the cursor after the "
        + "start: cursor 6, counter 7",
        b.cursor === 6 && b.playTicks === 7,
        `cursor ${b.cursor} ticks ${b.playTicks}`);
  b.playTicks = 39;
  run(3, rng, ev);
  check("`PlayerHookHoldClipEnd` holds it a frame short of the end",
        b.playTicks === 39 && b.cursor === 38,
        `cursor ${b.cursor} ticks ${b.playTicks}`);

  // The ride on a camera path it has no arm for: the exe stores stack slots
  // there; the port keeps the body's own.
  G.g_player_entity_hook[0] = PlayerEntityHook.RideSt1Vehicle;
  G.g_active_cam_path = 0x30;
  b.pos.x = 3;
  b.pos.z = 4;
  b.yaw = 0x1234;
  run(1, rng, ev);
  check("on any other path the ride keeps the body's x, z and yaw "
        + "(the declared divergence)",
        b.pos.x === 3 && b.pos.z === 4 && b.yaw === 0x1234 && b.pos.y === 0,
        JSON.stringify(b.pos) + ` yaw ${b.yaw}`);

  SceneStateInstallPlayerHooks(1, 3);
  G.g_evt_action_handler = EvtActionHandler.SetPlayerFlag;
  G.g_evt_action_operands[0] = 0;
  EvtCallActionHandler();
  run(1, rng, ev);
  check("`scene_state 3` puts a `PlaceEntity` hook back and "
        + "`set_player_flag 0` drops the bit: the body is gone",
        (G.g_player_entity_hook[0] as PlayerEntityHook)
          === PlayerEntityHook.PlaceEntityB
        && (G.g_player_flags[0] & 1) === 0 && b.drawn === 0,
        `hook ${G.g_player_entity_hook[0]} flags ${G.g_player_flags[0]}`);
}
