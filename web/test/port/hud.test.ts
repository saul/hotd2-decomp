import { Rng } from "../../src/core/rng";
import { GameUpdate } from "../../src/game/director";
import {
  CamBlockSetAnglesFromLookAt, CameraPoseBlock,
} from "../../src/game/camera/path";
import { ActorHeadingErrorTo, ActorTurnTowardXZ } from "../../src/game/actor_turn";
import { CamStashPathRange, CameraPlayStashedPath, CameraStepRailTick }
  from "../../src/game/camera/rail";
import { UpdateSceneViewAndLight } from "../../src/game/camera/view";
import { makeActor } from "../../src/game/actor";
import { CameraDriverSelectMode, CameraMode } from "../../src/game/camera/mode";
import { PlayerTasksDrawWithoutAFrame } from "../../src/game/player_shell";
import { G, ResetGameGlobals, ResetSceneOnEnter } from "../../src/game/globals";
import { NULL_HOST, type GameHost } from "../../src/game/host";
import { MatrixTransformPoint } from "../../src/game/matrix";
import {
  MarkActorShot, QueueOffscreenPull, QueueShotRequest, g_gunshot_sound_ids,
} from "../../src/game/combat/shot";
import { ActorFlag } from "../../src/game/actor";
import { PlayerTakeDamage } from "../../src/game/combat/player";
import {
  DAMAGE_OVERLAY_SLOTS, DAMAGE_OVERLAY_SOUNDS, DAMAGE_OVERLAY_VOICES,
  DamageOverlayClear, DamageOverlayKind, PlayerCameraHook, SceneStateInstallPlayerHooks,
} from "../../src/game/effects/damage_overlay";
import { SpawnClass } from "../../src/game/spawn_class";
import { GameMode } from "../../src/game/game_mode";
import {
  ARCADE_MAGAZINE, BINDING_RELOAD, InputBindingSet, PlayerInputBindingSet,
  RELOAD_SOUND,
} from "../../src/game/player_gun";
import { RELOAD_VOICE, SHOOT_VOICE } from "../../src/game/hud_readout";
import {
  BossHpBarSprite, HUD_READOUT_SPRITES, HudSprite,
} from "../../src/game/hud_sprites";
import { BOSS_HP_BAR_KILL, BossHpBarSpawn, BossHpBarsTick, BossHpFractionOf }
  from "../../src/game/boss_hp_bar";
import { BannerStep, BossBannersTick, BossIntroBannerSpawn }
  from "../../src/game/boss_banner";
import { bannerCardSlots } from "../../src/game/boss_banner_records";
import { DrawScreenSpriteLayered, SCREEN_SPRITE_QUEUE_CELLS,
  ScreenSpriteQueueFlush, ScreenSpriteQueueReset }
  from "../../src/game/screen_sprite";
import { vec3, type Vec3 } from "../../src/game/vec";
import type { ScriptJson } from "../../src/bundle";
import { Walker, type BranchChoice } from "../../src/script/walker";
import { Shutter } from "../../src/script/state/shutter";
import {
  HudDrawShutterState, SHUTTER_BLACKOUT_SCALE, SHUTTER_CLOSED_Y,
  SHUTTER_FRAMES, SHUTTER_SLIDE_STEP, ShutterState,
} from "../../src/game/hud_shutter";
import { CamPath } from "../../src/game/camera/curve";
import {
  check, scene, SeatCamera, EnterPlay, RunOutInvulnerability,
} from "./harness";

console.log("\nthe damage overlay:");
{
  // `PlayerTakeDamage` latches, `PlayerHookSpawnDamageOverlay` spawns on the
  // player's next update, `DamageOverlayUpdateAndDraw` keeps it up, and
  // `UpdateScreenShake` clears the latch. Driven through `GameUpdate` from the
  // page's own reset (L49), so the wiring is what is under test.
  const rng = new Rng(41);
  const events = scene(1, rng);
  // Five hits on the path camera would take every life and the player out of
  // play, where no update runs the hook. The engine's own "no damage" byte
  // keeps the latch and the lives apart: the latch is set either way.
  G.g_player_no_damage[0] = 1;
  const heard: number[] = [];
  events.on("sound.play", (d) => heard.push(d.id));
  const o = G.g_damage_overlays[0]!;
  const step = () => GameUpdate(1 / 60, NULL_HOST, rng, events);

  // The reset does not touch the hook -- only an installer writes it -- so
  // whatever an earlier case left is put to a known value first.
  SceneStateInstallPlayerHooks(1, 1);
  check("the follow camera's installer puts the body draw on both players",
        G.g_player_camera_hook[0] === PlayerCameraHook.DrawBody
        && G.g_player_camera_hook[1] === PlayerCameraHook.DrawBody);
  G.g_player_camera_hook = [PlayerCameraHook.None, PlayerCameraHook.None];
  SceneStateInstallPlayerHooks(1, 3);
  check("CameraInstallViewAngles leaves the camera hook alone",
        G.g_player_camera_hook[0] === PlayerCameraHook.None);
  SceneStateInstallPlayerHooks(2, 5);
  check("every cam/ path installer puts the overlay hook on both players",
        G.g_player_camera_hook[0] === PlayerCameraHook.SpawnDamageOverlay
        && G.g_player_camera_hook[1] === PlayerCameraHook.SpawnDamageOverlay);

  PlayerTakeDamage(0, 1, DamageOverlayKind.Claw, events);
  check("the hit only latches: nothing is spawned inside PlayerTakeDamage",
        !o.active && G.g_player_was_hit[0] === 1);
  step();
  check("the next update spawns it, with the kind the hit passed",
        o.active === 1 && o.kind === DamageOverlayKind.Claw && o.count === 1
        && o.x === 0, JSON.stringify(o));
  check("...and draws its first frame the same update: 59 left",
        o.frames === 59, `${o.frames}`);
  check("kind 3 draws slot 0x932 (common.bin[117], the claw marks)",
        DAMAGE_OVERLAY_SLOTS[o.kind]![o.count - 1] === 0x932);
  check("...and plays DAMAGE2 as it spawns",
        heard.includes(0x001b16a9) && DAMAGE_OVERLAY_SOUNDS[3] === 0x001b16a9,
        heard.map((h) => h.toString(16)).join(","));
  check("UpdateScreenShake consumed the latch and started the shake",
        G.g_player_was_hit[0] === 0 && G.g_screen_shake_frames === 0x2f,
        `${G.g_player_was_hit[0]} ${G.g_screen_shake_frames}`);
  // 47 * 0x1800 BAMS = 146.25 degrees; cos * 47 = -39.08, truncated.
  check("the shake's pitch is ftol(cos(frames * 0x1800) * frames)",
        G.g_screen_shake_pitch === -39, `${G.g_screen_shake_pitch}`);

  heard.length = 0;
  for (let i = 0; i < 4; i++) step();
  const voices = DAMAGE_OVERLAY_VOICES[0]!;
  check("the hurt voice plays on the fifth update, with the overlay still up",
        o.frames === 0x37 && o.active === 1 && heard.length === 1
        && voices.includes(heard[0]!),
        `${o.frames} ${heard.map((h) => h.toString(16))}`);

  // A second hit while it is up: the invulnerability window would refuse it,
  // so it is lifted -- the spawn's own guard is what is under test.
  RunOutInvulnerability();
  heard.length = 0;
  PlayerTakeDamage(0, 1, DamageOverlayKind.Bite, events);
  step();
  check("a hit while one is up shows nothing new and plays nothing",
        o.kind === DamageOverlayKind.Claw && heard.length === 0,
        `${o.kind} ${heard}`);

  // 6 updates so far; it is drawn on updates 1..59 and gone on the 60th.
  for (let i = 6; i < 59; i++) step();
  check("it is up, unchanged, for 59 updates", o.active === 1 && o.frames === 1,
        `${o.active} ${o.frames}`);
  step();
  check("...and gone on the sixtieth", o.active === 0 && o.frames === 0);

  // Under the follow camera the hook is the body draw: the latch is still
  // consumed by the shake, and no overlay appears.
  SceneStateInstallPlayerHooks(1, 1);
  RunOutInvulnerability();
  PlayerTakeDamage(0, 1, DamageOverlayKind.Bite, events);
  step();
  check("under CameraInstallFollowMidpoint a hit shows no overlay",
        o.active === 0 && G.g_player_was_hit[0] === 0
        && G.g_screen_shake_frames === 0x2f);

  // Two players: player 0's overlay sits left, and kind 6 swaps its model.
  SceneStateInstallPlayerHooks(2, 4);
  G.g_max_attackers = 2;
  RunOutInvulnerability();
  PlayerTakeDamage(0, 1, DamageOverlayKind.Gash, events);
  step();
  check("with two players the gash is slot 0x936, 0.22 to the left",
        o.active === 1 && DAMAGE_OVERLAY_SLOTS[o.kind]![o.count - 1] === 0x936
        && Math.abs(o.x + 0.22) < 1e-6, JSON.stringify(o));
  G.g_max_attackers = 1;

  // A player joining clears it: the count latched at spawn is compared.
  // (`DamageOverlayClear` first, so the spawn's live-guard lets it in.)
  DamageOverlayClear(0);
  G.g_player_was_hit[0] = 1;
  G.g_player_damage_overlay_kind[0] = DamageOverlayKind.Splat;
  step();
  const spawned = o.active === 1 && o.count === 1;
  G.g_max_attackers = 2;
  step();
  check("a second player joining takes the overlay down",
        spawned && o.active === 0, `${spawned} ${o.active}`);
  G.g_max_attackers = 1;
}

{
  // The nod: `UpdateSceneViewAndLight` re-aims the block at (0, pitch, -1000)
  // in its own un-rolled frame and builds the view from the angles that
  // leaves. Tested off the identity (L48): a camera turned a quarter, and one
  // looking down, where "up" is not world +Y.
  const eye = vec3(5, 2, 7);
  const viewDir = (): Vec3 => {
    const p = vec3();
    MatrixTransformPoint(G.g_camera_view_to_world, { x: 0, y: 0, z: -1 }, p);
    return vec3(p.x - G.g_camera_block_eye.x, p.y - G.g_camera_block_eye.y,
                p.z - G.g_camera_block_eye.z);
  };
  const degBetween = (a: Vec3, b: Vec3): number => {
    const d = (a.x * b.x + a.y * b.y + a.z * b.z)
      / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z));
    return Math.acos(Math.min(1, Math.max(-1, d))) * 180 / Math.PI;
  };
  /** The view direction a block at `eye` aimed at `target` draws with. */
  const nodded = (target: Vec3, pitch: number): Vec3 => {
    ResetGameGlobals();
    G.g_camera_block_eye = vec3(eye.x, eye.y, eye.z);
    G.g_camera_block_target = vec3(target.x, target.y, target.z);
    CamBlockSetAnglesFromLookAt(CameraPoseBlock.Camera,
                                G.g_camera_block_target, 0);
    G.g_screen_shake_pitch = pitch;
    UpdateSceneViewAndLight();
    return viewDir();
  };
  // Whole BAMS on both angles: a hundredth of a degree is the budget.
  const TOL = 0.02;
  let d = nodded(vec3(5, 2, -100), 39);
  check("looking down -Z, a pitch of 39 aims 39 up at 1000 ahead",
        degBetween(d, vec3(0, 39, -1000)) < TOL, JSON.stringify(d));
  d = nodded(vec3(50, 2, 7), -39);
  check("a quarter turn keeps the nod vertical, and the sign",
        degBetween(d, vec3(1000, -39, 0)) < TOL, JSON.stringify(d));
  // 30 degrees down: up' = (0, cos30, -sin30) for a camera facing -Z.
  const c = Math.cos(Math.PI / 6), sn = Math.sin(Math.PI / 6);
  d = nodded(vec3(5, 2 - sn, 7 - c), 10);
  check("looking down, the nod is about the camera's own right axis",
        degBetween(d, vec3(0, -500 + 10 * c, -1000 * c - 10 * sn)) < TOL,
        JSON.stringify(d));
  d = nodded(vec3(5, 2, -100), 0);
  check("no shake, no nod", degBetween(d, vec3(0, 0, -1)) < TOL);
  const before = [G.g_camera_block_pitch_bams, G.g_camera_block_yaw_bams];
  for (let i = 0; i < 60; i++) UpdateSceneViewAndLight();
  check("...and with no driver re-deriving the angles, sixty nods of nothing "
        + "leave them where they were",
        G.g_camera_block_pitch_bams === before[0]
        && G.g_camera_block_yaw_bams === before[1],
        `${before} -> ${G.g_camera_block_pitch_bams},${G.g_camera_block_yaw_bams}`);

  // Through the frame: the shake a hit starts reaches the view the next
  // frame's camera actor builds, as a turn of atan(pitch / 1000) off the
  // block's own (eased) aim -- which the nod leaves alone.
  const rng = new Rng(43);
  const events = scene(1, rng);
  SeatCamera(vec3(0, 0, 0), vec3(0, 0, -50));
  SceneStateInstallPlayerHooks(2, 4);
  PlayerTakeDamage(0, 1, DamageOverlayKind.Bite, events);
  GameUpdate(1 / 60, NULL_HOST, rng, events);
  const pitch = G.g_screen_shake_pitch;
  GameUpdate(1 / 60, NULL_HOST, rng, events);
  const turned = degBetween(viewDir(), vec3(G.g_camera_block_target.x,
                                            G.g_camera_block_target.y,
                                            G.g_camera_block_target.z));
  const want = Math.atan(Math.abs(pitch) / 1000) * 180 / Math.PI;
  check("the next frame's view is nodded by the shake's pitch",
        pitch !== 0 && Math.abs(turned - want) < TOL,
        `pitch ${pitch} turned ${turned.toFixed(4)} want ${want.toFixed(4)}`);
}


console.log("\nthe shutter's one-frame states (HudDrawShutterState's tails):");
{
  // 0, 5 and 6 each last one frame: their tails, at 0x00413A0B, 0x00413A6D
  // and 0x00413A85, write the state they leave for. Without them the HUD
  // readouts -- which draw only in 1, 2 and 4 -- vanished for the rest of any
  // scene that had issued a 6.
  const sh = new Shutter();
  sh.reset();
  sh.set(6);
  HudDrawShutterState();
  check("a 6 is a 2 with the gate up one frame later",
        sh.state === 2 && G.g_nFiringGate === 1, `${sh.state}`);
  sh.set(0);
  HudDrawShutterState();
  check("a 0 is a 4 with the gate up", sh.state === 4
        && G.g_nFiringGate === 1, `${sh.state} ${G.g_nFiringGate}`);
  sh.set(5);
  HudDrawShutterState();
  check("a 5 is a 4 with the gate down", sh.state === 4
        && G.g_nFiringGate === 0, `${sh.state} ${G.g_nFiringGate}`);
  sh.set(7);
  check("...a 7 is only a store until the task runs", sh.state === 7,
        `${sh.state}`);
  HudDrawShutterState();
  check("...and then restores the 4 they left, not the 5",
        sh.state === 4, `${sh.state}`);
  sh.reset();
}

/**
 * `HudDrawShutterState` (`FUN_00413970`) frame by frame, from the reset the
 * page runs.
 *
 * `ResetSceneOnEnter` stores 5 in the state *and* in `g_bHudShutterPrev`
 * (`0x0045EE58`..`0x0045EE64`), and `HudShutterTaskCreate` zeroes the counter.
 * The port used to reset the state to 2 -- nothing drawn -- which is the
 * declared divergence this section removed; every assertion about the first
 * frame fails on it. The rest pins the slide to the engine's own frame: the
 * counter is stepped **before** it is drawn, so an open draws 1..40 and a
 * close 39..0, and each hands over on the 41st frame. The port's machine used
 * to finish both on the 40th and draw the first frame a counter behind.
 */
console.log("\nthe shutter frame by frame (HudDrawShutterState, from the reset):");
{
  const bars = () => G.g_hud_shutter_bars.map((b) => `${b.y.toFixed(4)}x${b.sy}`)
    .join(" ");
  const pair = (y: number) => `${y.toFixed(4)}x1 ${(-y).toFixed(4)}x1`;
  const SHUT = pair(SHUTTER_CLOSED_Y);

  ResetGameGlobals();
  check("a scene load leaves the shutter at 5 in both bytes, the counter 0 "
        + "and nothing drawn",
        G.g_bHudShutterState === ShutterState.CloseHoldFire
        && G.g_bHudShutterPrev === ShutterState.CloseHoldFire
        && G.g_hud_shutter_counter === 0 && G.g_hud_shutter_bars.length === 0
        && G.g_nFiringGate === 0,
        `state ${G.g_bHudShutterState} prev ${G.g_bHudShutterPrev} `
        + `counter ${G.g_hud_shutter_counter}`);
  HudDrawShutterState();
  check("its first frame draws both bars shut, at y = +-0.35",
        bars() === SHUT, bars());
  check("...and leaves 4 with the gate down: nothing was seeded, 5 == prev",
        G.g_bHudShutterState === ShutterState.Closed
        && G.g_bHudShutterPrev === ShutterState.Closed
        && G.g_nFiringGate === 0 && G.g_hud_shutter_counter === 0,
        `state ${G.g_bHudShutterState} prev ${G.g_bHudShutterPrev} `
        + `gate ${G.g_nFiringGate} counter ${G.g_hud_shutter_counter}`);
  HudDrawShutterState();
  check("...and 4 holds them shut on every frame after", bars() === SHUT
        && G.g_bHudShutterState === ShutterState.Closed, bars());

  // The same frame through the page's own walk: the players first, then the
  // shutter. `HudDrawLives` draws the lamps in state 2 only, so on the frame
  // the script's 6 lands the players still see a 6 and draw none, and the
  // frame after -- the task having made it 2 -- they do.
  {
    const rng = new Rng(52);
    scene(0, rng);
    ResetSceneOnEnter();
    const lamps = () => G.g_screen_sprite_draws.filter(
      (d) => d.id >= HudSprite.Lamp1P && d.id < HudSprite.Lamp1P + 7).length;
    GameUpdate(1 / 60, NULL_HOST, rng);
    check("GameUpdate draws a freshly reset scene shut", bars() === SHUT,
          bars());
    G.g_bHudShutterState = ShutterState.OpenFiring;   // the opcode's store
    GameUpdate(1 / 60, NULL_HOST, rng);
    check("on the frame of a 6 the players still read 6: no lamps, and "
          + "nothing drawn by the shutter", lamps() === 0 && bars() === ""
          && G.g_bHudShutterState === ShutterState.Open,
          `lamps ${lamps()} bars "${bars()}"`);
    GameUpdate(1 / 60, NULL_HOST, rng);
    check("...and on the next they read 2 and draw the lives", lamps() > 0,
          `lamps ${lamps()}`);
  }

  // Open: seeded to 0 on the change, stepped, then drawn.
  ResetGameGlobals();
  HudDrawShutterState();                              // 5 -> 4
  G.g_bHudShutterState = ShutterState.Opening;
  const drawn: string[] = [];
  let gateHeld = true;
  for (let f = 1; f <= SHUTTER_FRAMES; f++) {
    HudDrawShutterState();
    drawn.push(bars());
    gateHeld &&= G.g_nFiringGate === 1;
  }
  const slide = (k: number) => pair(SHUTTER_CLOSED_Y + k * SHUTTER_SLIDE_STEP);
  check("an open draws the counter 1 on its first frame, not 0",
        drawn[0] === slide(1), drawn[0]);
  check("...and 40 on its fortieth, still in state 1",
        drawn[SHUTTER_FRAMES - 1] === slide(SHUTTER_FRAMES)
        && G.g_bHudShutterState === ShutterState.Opening,
        `${drawn[SHUTTER_FRAMES - 1]} state ${G.g_bHudShutterState}`);
  check("...every frame of it one step of 0.0025",
        drawn.every((d, i) => d === slide(i + 1)));
  check("...with the gate raised on every one", gateHeld);
  HudDrawShutterState();
  check("the 41st draws nothing and leaves 2",
        bars() === "" && G.g_bHudShutterState === ShutterState.Open
        && G.g_bHudShutterPrev === ShutterState.Open,
        `"${bars()}" state ${G.g_bHudShutterState}`);
  // A shut state straight after a finished open is shut whatever the counter
  // says. `hud/` used to draw 0, 4 and 5 from the counter, which an open
  // leaves past 40, so they drew no bars at all.
  const leftAt = G.g_hud_shutter_counter;
  G.g_bHudShutterState = ShutterState.CloseFiring;
  HudDrawShutterState();
  check("a 0 straight after an open draws the bars shut at 0.35, with the "
        + "counter left at 41", bars() === SHUT && leftAt === SHUTTER_FRAMES + 1,
        `${bars()} counter ${leftAt}`);
  G.g_bHudShutterState = ShutterState.Open;
  HudDrawShutterState();

  // Close: seeded to 0x28 on the change, stepped, then drawn.
  G.g_bHudShutterState = ShutterState.Closing;
  const closing: string[] = [];
  for (let f = 1; f <= SHUTTER_FRAMES; f++) {
    HudDrawShutterState();
    closing.push(bars());
  }
  check("a close draws 39 .. 0 over its forty frames, the gate still up",
        closing.every((d, i) => d === slide(SHUTTER_FRAMES - 1 - i))
        && G.g_nFiringGate === 1
        && G.g_bHudShutterState === ShutterState.Closing,
        `${closing[0]} .. ${closing[SHUTTER_FRAMES - 1]}`);
  HudDrawShutterState();
  check("...and the 41st draws them shut, drops the gate and leaves 4",
        bars() === SHUT && G.g_nFiringGate === 0
        && G.g_bHudShutterState === ShutterState.Closed, bars());

  // 4 is hidden while either screen card has the screen: `TEST byte ptr
  // [0x009a5900], 0x30` at `0x00413BB5`.
  G.g_screen_furniture_flags = 0x20;
  HudDrawShutterState();
  const underChapter = bars();
  G.g_screen_furniture_flags = 0x10;
  HudDrawShutterState();
  const underResult = bars();
  G.g_screen_furniture_flags = 0;
  HudDrawShutterState();
  check("state 4 draws nothing under the chapter card (0x20) or the result "
        + "card (0x10), and the bars come back after",
        underChapter === "" && underResult === "" && bars() === SHUT,
        `"${underChapter}" "${underResult}" "${bars()}"`);

  // 8, and a 7 after it: the blackout is the one state the tail does not
  // remember, and a 7 draws nothing on its own frame.
  G.g_bHudShutterState = ShutterState.Blackout;
  HudDrawShutterState();
  check("a blackout is one bar at the centre scaled 8, and prev stays 4",
        bars() === `0.0000x${SHUTTER_BLACKOUT_SCALE}`
        && G.g_bHudShutterPrev === ShutterState.Closed,
        `${bars()} prev ${G.g_bHudShutterPrev}`);
  G.g_bHudShutterState = ShutterState.Restore;
  HudDrawShutterState();
  check("a 7 after it puts the 4 back and draws nothing that frame",
        bars() === "" && G.g_bHudShutterState === ShutterState.Closed,
        `"${bars()}" state ${G.g_bHudShutterState}`);
  HudDrawShutterState();
  check("...and the bars are back the frame after", bars() === SHUT, bars());

  // A seek or a paused load runs no frame. The page draws the next frame's
  // bars on a copy and keeps only those.
  ResetGameGlobals();
  EnterPlay();
  PlayerTasksDrawWithoutAFrame();
  check("a world no frame has run on still shows the bars the next frame "
        + "would draw", bars() === SHUT, bars());
  check("...without running that frame on the live world",
        G.g_bHudShutterState === ShutterState.CloseHoldFire
        && G.g_bHudShutterPrev === ShutterState.CloseHoldFire,
        `state ${G.g_bHudShutterState} prev ${G.g_bHudShutterPrev}`);
}

/**
 * A route branch goes on the frame the step list runs out.
 *
 * `EvtAdvanceStepOrRoute` (`FUN_0045F000`) reads `g_script_branch_var` and
 * assigns `next[choice]` in the same call; there is no window. The port held
 * every branch for 1.5 s so a viewer could take the other road, which is a
 * debug aid now and off by default -- this section fails on the old default.
 * With the aid on, the value is still latched when the steps run out, so
 * gameplay writing the global during the pause cannot change a decision the
 * engine had already made.
 */
console.log("\na route branch, with and without the debug pause:");
{
  const op = (i: number, code: number, name: string) =>
    ({ i, at: i * 4, op: code, name, cat: "flow" });
  const END = { kind: "end", next: [-1, -1, -1] };
  const BRANCH = { kind: "branch", next: [1, 2, -1] };
  const parked = (index: number) => ({
    index, at: index * 64, route: END,
    steps: [{ index: 0, at: index * 64, ops: [op(0, 0x4e, "halt")] },
            { index: 1, at: index * 64 + 8, ops: [op(1, 0x4e, "halt")] }],
  });
  const script = {
    scene: 0, stage: 1, game_mode: 0, evt_file: "test", entry_block: 0,
    entry_step: 0, routes: [BRANCH, END, END],
    regions: [], cam_slots_used: [], warnings: [],
    blocks: [
      { index: 0, at: 0, route: BRANCH,
        steps: [{ index: 0, at: 0, ops: [op(0, 0x4f, "advance_step")] }] },
      parked(1), parked(2),
    ],
  } as unknown as ScriptJson;
  const prompts: (BranchChoice | null)[] = [];
  const host = {
    enterRegion: () => undefined, loadSlot: () => undefined,
    unloadSlot: () => undefined, startCamera: () => undefined,
    onFeed: () => undefined,
    onBranch: (b: BranchChoice | null) => { prompts.push(b); },
    playSound: () => undefined, aliveEnemies: () => null,
    presentEnemies: () => null,
    aliveCivilians: () => null, cameraFree: () => null,
    scriptFlagRaised: () => null,
    showMessage: () => null, endDialogue: () => undefined,
  };

  ResetGameGlobals();
  const w = new Walker(script, host);
  w.reset();
  check("the pause is off unless asked for", w.options.branchPause === false);
  w.branchChoice = 1;                        // a rescue wrote route 1
  w.tick(1 / 60);
  check("off, the branch goes on the frame the steps run out: next[1] = 2",
        w.block === 2 && w.branch === null
        && !prompts.some((b) => b !== null),
        `block ${w.block} branch ${JSON.stringify(w.branch)}`);
  check("...and clears g_script_branch_var behind it, as the engine's store "
        + "does", G.g_script_branch_var === 0, `${G.g_script_branch_var}`);

  const held = new Walker(script, host, { branchPause: true });
  held.reset();
  held.branchChoice = 1;
  held.tick(1 / 60);
  check("on, it holds at the branch with the game's choice latched",
        held.block === 0 && held.branch !== null && held.branch.choice === 1
        && held.branch.targets.join(",") === "1,2",
        JSON.stringify(held.branch));
  G.g_script_branch_var = 0;                 // gameplay writes during the hold
  held.tickBranchCountdown(1.5);
  check("...and an expired hold takes the latched 1, not what the global "
        + "says now", held.block === 2 && held.branch === null,
        `block ${held.block}`);

  const over = new Walker(script, host, { branchPause: true });
  over.reset();
  over.branchChoice = 1;
  over.tick(1 / 60);
  over.takeBranch(1);
  check("...and a viewer's override is still taken while it holds",
        over.block === 1, `block ${over.block}`);
}

console.log("\nthe gun: the magazine, the reload, and the HUD readouts:");
{
  // `PlayerFireAndReloadUpdate` (0x00414940), `PlayerRefillMagazine`
  // (0x00414B30), `HudDrawAmmoAndReloadPrompt` (0x004177D0) and
  // `HudDrawLives` (0x004174A0), driven through `GameUpdate` from the page's
  // own reset. Every pull misses -- nothing is under the ray -- so what is
  // measured is the gun and not a target.
  const rng = new Rng(51);
  const events = scene(0, rng);
  const heard: number[] = [];
  events.on("sound.play", (d) => heard.push(d.id));
  let resolved = 0;
  events.on("shot.resolved", () => { resolved += 1; });
  const RAY = { origin: vec3(0, 0, 0), dir: vec3(0, 0, -1) };
  const step = () => GameUpdate(1 / 60, NULL_HOST, rng, events);
  const shoot = () => { QueueShotRequest(0, RAY); step(); };
  const reload = () => { QueueOffscreenPull(0); step(); };
  const sprites = (id: number) => G.g_screen_sprite_draws.filter((s) => s.id === id);
  const bullets = () => sprites(HudSprite.Bullet);
  const lamps = () => G.g_screen_sprite_draws.filter(
    (s) => s.id >= HudSprite.Lamp1P && s.id < HudSprite.Lamp1P + 7);

  step();
  check("a player enters play with six rounds and the latch down",
        G.g_player_ammo[0] === ARCADE_MAGAZINE
        && G.g_player_magazine_empty[0] === 0,
        `${G.g_player_ammo[0]} ${G.g_player_magazine_empty[0]}`);
  check("the mouse is a gun: its binding set is the gun's, which has no "
        + "reload bit", PlayerInputBindingSet(0) === InputBindingSet.Gun
        && G.g_player_input_bindings[0][InputBindingSet.Gun][BINDING_RELOAD]
           === 0);
  check("six bullets are drawn from x = 24, 24 px apart, at y = 364",
        bullets().length === 6
        && bullets().every((b, i) => b.x === 24 + 24 * i && b.y === 364
                                   && b.sx === 1),
        JSON.stringify(bullets().map((b) => b.x)));
  check("'1P' and a lamp a life, 32 px apart from x = 60, at y = 412",
        sprites(HudSprite.Tag1P).length === 1 && lamps().length === 3
        && lamps().every((l, i) => l.x === 60 + 32 * i && l.y === 412),
        JSON.stringify(lamps().map((l) => [l.id.toString(16), l.x])));
  // Each lamp is four frames out of step with the one before it.
  const f = G.g_frame_counter >>> 0;
  check("each lamp's flame cel is ((g_frame_counter + 4i) / 3) % 7",
        lamps().every((l, i) => l.id === HudSprite.Lamp1P
                        + Math.trunc((f + 4 * i) / 3) % 7),
        `${f} ${lamps().map((l) => l.id - HudSprite.Lamp1P).join(",")}`);

  const fired0 = G.g_player_shot_count[0];
  heard.length = 0;
  shoot();
  check("a shot takes one round and fires the gun",
        G.g_player_ammo[0] === 5 && heard.includes(g_gunshot_sound_ids[0])
        && G.g_player_shot_count[0] === fired0 + 1 && bullets().length === 5,
        `ammo ${G.g_player_ammo[0]}, heard ${heard.map((h) => h.toString(16))}`);
  for (let i = 0; i < 5; i++) shoot();
  check("the sixth empties it and raises the latch",
        G.g_player_ammo[0] === 0 && G.g_player_magazine_empty[0] === 1
        && bullets().length === 0,
        `${G.g_player_ammo[0]} ${G.g_player_magazine_empty[0]}`);
  check("...and RELOAD is up, 1.5 wide, at (24, 260)",
        sprites(HudSprite.Reload).length === 1
        && sprites(HudSprite.Reload)[0].x === 24
        && sprites(HudSprite.Reload)[0].y === 260
        && sprites(HudSprite.Reload)[0].sx === 1.5,
        JSON.stringify(sprites(HudSprite.Reload)));

  const firedDry = G.g_player_shot_count[0];
  const resolvedDry = resolved;
  heard.length = 0;
  shoot();
  check("an empty gun pointed at the screen does nothing: no round, no shot, "
        + "no gunshot", G.g_player_ammo[0] === 0
        && G.g_player_shot_count[0] === firedDry && resolved === resolvedDry
        && !heard.includes(g_gunshot_sound_ids[0])
        && !heard.includes(RELOAD_SOUND),
        heard.map((h) => h.toString(16)).join(" "));
  check("...and does not reload itself either -- the voice says RELOAD",
        G.g_player_magazine_empty[0] === 1 && heard.includes(RELOAD_VOICE),
        heard.map((h) => h.toString(16)).join(" "));

  heard.length = 0;
  reload();
  check("a pull off the screen reloads: six rounds, latch down, the reload "
        + "sound", G.g_player_ammo[0] === 6 && G.g_player_magazine_empty[0] === 0
        && heard.includes(RELOAD_SOUND) && !heard.includes(g_gunshot_sound_ids[0])
        && sprites(HudSprite.Reload).length === 0 && bullets().length === 6,
        `${G.g_player_ammo[0]} ${heard.map((h) => h.toString(16))}`);
  heard.length = 0;
  reload();
  check("...and on a full gun it does nothing at all",
        G.g_player_ammo[0] === 6 && !heard.includes(RELOAD_SOUND));
  shoot(); shoot(); shoot();
  reload();
  check("a half-empty gun reloads to six", G.g_player_ammo[0] === 6,
        `${G.g_player_ammo[0]}`);

  // The gate: a shutter shut for a cutscene takes the round away and leaves
  // the reload.
  G.g_nFiringGate = 0;
  shoot();
  check("with the firing gate down a pull takes no round",
        G.g_player_ammo[0] === 6, `${G.g_player_ammo[0]}`);
  check("...and the bullets are hidden, and the lives stay",
        bullets().length === 0 && lamps().length === 3,
        `${bullets().length} ${lamps().length}`);
  G.g_nFiringGate = 1;
  shoot();
  G.g_nFiringGate = 0;
  heard.length = 0;
  reload();
  check("...but a reload still happens, silently",
        G.g_player_ammo[0] === 6 && !heard.includes(RELOAD_SOUND),
        `${G.g_player_ammo[0]} ${heard.map((h) => h.toString(16))}`);
  G.g_nFiringGate = 1;

  // The prompt: 45 frames on in every 60, a second line from 120.
  for (let i = 0; i < 6; i++) shoot();
  const t0 = G.g_player_reload_prompt_timer[0];
  let blinkOn = 0;
  let secondAt = -1;
  for (let i = 0; i < 180; i++) {
    const t = G.g_player_reload_prompt_timer[0];
    step();
    if (sprites(HudSprite.Reload).length) blinkOn += 1;
    if (secondAt < 0 && sprites(HudSprite.ShootOutside).length) secondAt = t;
  }
  check("RELOAD blinks on 45 of every 60 frames of its timer",
        blinkOn === 135, `${blinkOn} from timer ${t0}`);
  check("...and 'SHOOT OUTSIDE OF THE SCREEN!' joins it at 120, at (16, 325)",
        secondAt === 120
        && sprites(HudSprite.ShootOutside).every((s) => s.x === 16 && s.y === 325),
        `${secondAt}`);
  heard.length = 0;
  shoot();
  check("...past 120 a gun's dry pull hears SHOOT, not RELOAD",
        heard.includes(SHOOT_VOICE) && !heard.includes(RELOAD_VOICE),
        heard.map((h) => h.toString(16)).join(" "));
  G.g_player_reload_prompt_timer[0] = 601;
  step();
  check("the timer folds back to 120 past 600",
        G.g_player_reload_prompt_timer[0] === 120,
        `${G.g_player_reload_prompt_timer[0]}`);

  // The voice's gates, from `HudDrawAmmoAndReloadPrompt`'s tail: the timer
  // non-zero, the trigger down this frame, the aim on the screen -- and the
  // routine runs at all only with the firing gate up.
  reload();
  for (let i = 0; i < 5; i++) shoot();
  heard.length = 0;
  shoot();
  const vo = (h: number[]) => h.filter((id) => id === RELOAD_VOICE
                                          || id === SHOOT_VOICE);
  check("the shot that empties the gun is not nagged: the timer is 0 that "
        + "frame", G.g_player_ammo[0] === 0 && vo(heard).length === 0
        && heard.includes(g_gunshot_sound_ids[0]),
        heard.map((h) => h.toString(16)).join(" "));
  heard.length = 0;
  for (let i = 0; i < 30; i++) step();
  check("...and nothing is said while the trigger is left alone",
        vo(heard).length === 0, heard.map((h) => h.toString(16)).join(" "));
  heard.length = 0;
  shoot();
  shoot();
  check("each dry pull is one RELOAD -- a pull is one frame of trigger",
        vo(heard).length === 2 && vo(heard).every((id) => id === RELOAD_VOICE),
        heard.map((h) => h.toString(16)).join(" "));
  G.g_player_input_is_gun[0] = 0;
  G.g_player_pad_kind[0] = 0;
  G.g_player_reload_prompt_timer[0] = 130;
  heard.length = 0;
  shoot();
  check("a controller past 120 still hears RELOAD, not SHOOT",
        vo(heard).length === 1 && vo(heard)[0] === RELOAD_VOICE,
        heard.map((h) => h.toString(16)).join(" "));
  G.g_player_input_is_gun[0] = 1;
  G.g_player_pad_kind[0] = -1;
  G.g_nFiringGate = 0;
  const tGate = G.g_player_reload_prompt_timer[0];
  heard.length = 0;
  shoot();
  check("with the firing gate down: no prompt, no voice, and the timer "
        + "stands", sprites(HudSprite.Reload).length === 0
        && vo(heard).length === 0
        && G.g_player_reload_prompt_timer[0] === tGate,
        `${G.g_player_reload_prompt_timer[0]} vs ${tGate}`);
  G.g_nFiringGate = 1;

  // A controller -- the PC keyboard -- reloads with pad B instead.
  G.g_player_input_is_gun[0] = 0;
  G.g_player_pad_kind[0] = 0;
  reload();
  check("a controller does not reload by shooting off the screen",
        G.g_player_ammo[0] === 0);
  step();
  check("...its prompt's second line is 'PRESS THE RELOAD BUTTON' at (16, 325)",
        sprites(HudSprite.PressReloadButton).length === 1
        || G.g_player_reload_prompt_timer[0] % 60 > 45,
        JSON.stringify(G.g_screen_sprite_draws.map((s) => s.id.toString(16))));
  G.g_pad_state = G.g_player_input_bindings[0][InputBindingSet.Controller][
    BINDING_RELOAD] & 0x2;
  step();
  G.g_pad_state = 0;
  check("...and pad B -- Right Ctrl -- does", G.g_player_ammo[0] === 6,
        `${G.g_player_ammo[0]}`);
  G.g_player_input_is_gun[0] = 1;
  G.g_player_pad_kind[0] = -1;
  shoot();
  G.g_pad_state = 0x2;
  step();
  G.g_pad_state = 0;
  check("a gun ignores pad B", G.g_player_ammo[0] === 5,
        `${G.g_player_ammo[0]}`);

  // The shutter: opening grows the readout from 1.5 to 1; shut, it goes.
  G.g_bHudShutterState = 1;
  G.g_hud_ammo_slide[0] = 0;
  step();
  check("while the shutter opens the bullets are drawn 1.5x, spaced 1.5x",
        bullets().length === 5 && bullets()[0].sx === 1.5
        && bullets()[1].x === 24 + 36, JSON.stringify(bullets()[1]));
  check("...and the lives are not drawn until it is open",
        lamps().length === 0);
  G.g_bHudShutterState = 4;
  G.g_frame_counter = 60;
  step();
  const hold = sprites(HudSprite.HoldYourFire);
  check("shut, no bullets, no lives, and 'HOLD YOUR FIRE!' at (32, 422)",
        bullets().length === 0 && lamps().length === 0 && hold.length === 1
        && hold[0].x === 32 && hold[0].y === 422 && hold[0].sx === 1.5,
        JSON.stringify(hold));
  G.g_frame_counter = 50;
  step();
  check("...blinking: off on the last 15 of every 60 frames",
        sprites(HudSprite.HoldYourFire).length === 0);
  G.g_bHudShutterState = 2;

  // A life lost is a lamp gone.
  G.g_player_lives[0] = 2;
  step();
  check("two lives, two lamps", lamps().length === 2, `${lamps().length}`);

  // Original Mode: the magazine is the weapon's.
  G.g_GameMode = GameMode.Original;
  G.g_player_magazine_size[0] = 9;
  reload();
  check("Original Mode reloads to the magazine size",
        G.g_player_ammo[0] === 9, `${G.g_player_ammo[0]}`);
  // The readout's own row, y 372: player 2's credit line, which
  // `PlayerPollStart` draws for a player at 9, counts its credits in the
  // same digits at y 427.
  const digits = G.g_screen_sprite_draws.filter(
    (s) => s.id >= HudSprite.Digit0 && s.id <= HudSprite.Digit0 + 9
      && s.y === 372);
  check("...and draws seven or more as one bullet, 'x' and two digits",
        bullets().length === 1 && sprites(HudSprite.Times).length === 1
        && digits.map((d) => d.id - HudSprite.Digit0).join("") === "09",
        JSON.stringify(G.g_screen_sprite_draws.map((s) => s.id.toString(16))));
  G.g_player_magazine_size[0] = -1;
  G.g_player_ammo[0] = -1;
  shoot();
  check("an unlimited magazine takes no round and reads 'x o'",
        G.g_player_ammo[0] === -1 && sprites(HudSprite.Times).length === 1
        && sprites(HudSprite.Glyph63).length === 1,
        `${G.g_player_ammo[0]}`);
  G.g_player_magazine_size[0] = 6;
  G.g_original_fire_mode[0] = 2;
  G.g_player_ammo[0] = 3;
  reload();
  check("fire mode 2 cannot be reloaded until it is empty",
        G.g_player_ammo[0] === 3, `${G.g_player_ammo[0]}`);
  G.g_player_ammo[0] = 1;
  shoot();
  // Mode 2's row puts 2 in the latch the trigger waits on: the next pull is
  // not read until it has counted down.
  reload();
  check("...a shot in mode 2 holds the trigger off for two frames",
        G.g_player_ammo[0] === 0, `${G.g_player_ammo[0]}`);
  step();
  reload();
  check("...and can once it is", G.g_player_ammo[0] === 6,
        `${G.g_player_ammo[0]}`);
  G.g_original_fire_mode[0] = 0;
  G.g_GameMode = GameMode.Arcade;

  check("every sprite the readouts drew is one the exporter ships",
        G.g_screen_sprite_draws.every((s) => HUD_READOUT_SPRITES.includes(s.id)));
  check("the frame's sprites are plain data a snapshot can copy",
        JSON.stringify(JSON.parse(JSON.stringify(G.g_screen_sprite_draws)))
        === JSON.stringify(G.g_screen_sprite_draws));

  // A seek builds a world and runs no frame: the readouts are redrawn from
  // it, and nothing the two routines keep moves.
  G.g_player_ammo[0] = 0;
  G.g_player_magazine_empty[0] = 1;
  G.g_player_reload_prompt_timer[0] = 130;
  const drawn = JSON.stringify(G.g_screen_sprite_draws);
  G.g_screen_sprite_draws = [];
  const before = heard.length;
  const world = () => JSON.stringify({ ...G, g_screen_sprite_draws: null });
  const was = world();
  const pool = G.g_object_list;
  PlayerTasksDrawWithoutAFrame();
  check("a seek redraws the readouts without a frame: RELOAD, its second "
        + "line and the lives, and no bullets",
        sprites(HudSprite.Reload).length === 1
        && sprites(HudSprite.ShootOutside).length === 1
        && bullets().length === 0 && lamps().length > 0,
        JSON.stringify(G.g_screen_sprite_draws.map((s) => s.id.toString(16))));
  check("...and moves nothing else in G, and plays nothing",
        world() === was && G.g_object_list === pool
        && heard.length === before,
        `${G.g_player_reload_prompt_timer[0]} ${heard.length - before}`);
  G.g_screen_sprite_draws = JSON.parse(drawn);
  G.g_player_ammo[0] = ARCADE_MAGAZINE;
  G.g_player_magazine_empty[0] = 0;

  // Out of lives: no readouts at all.
  G.g_player_lives[0] = 0;
  step();
  check("a player out of lives draws no readout", G.g_screen_sprite_draws.length === 0,
        `${G.g_screen_sprite_draws.length}`);
}

// The boss health bar -- `BossHpBarSpawn` (`FUN_00435E50`) and
// `BossHpBarUpdate` (`FUN_00435C80`) -- driven the way a boss drives it: by
// writing `g_boss_hp_fraction` and nothing else.
{
  ResetGameGlobals();
  /** One task-walk's worth: reset the queue, step the bars, flush. */
  const frame = () => {
    G.g_screen_sprite_draws = [];
    ScreenSpriteQueueReset();
    BossHpBarsTick();
    ScreenSpriteQueueFlush();
    return G.g_screen_sprite_draws;
  };
  BossHpBarSpawn(320, 35);
  const bar = G.g_boss_hp_bars[0];
  check("BossHpBarSpawn seats a full fill and an empty bar",
        G.g_boss_hp_fraction === 1 && G.g_boss_hp_bars.length === 1
        && bar.shown === 0 && bar.trail === 1 && bar.blink === 0);

  let drawn = frame();
  check("the flush draws the four sprites newest first: frame, fill, trail, "
        + "empty", drawn.map((d) => d.id).join() === [
          BossHpBarSprite.Frame, BossHpBarSprite.Fill, BossHpBarSprite.Trail,
          BossHpBarSprite.Empty].join(),
        drawn.map((d) => d.id.toString(16)).join());
  const fill = drawn[1];
  check("the fill runs from x - 144, 18 tiles to a full track, anchor (1, 2)",
        fill.x === 320 - 144 && fill.y === 35
        && fill.sx === bar.shown * 18 && (fill.flags & 0xf) === 9
        && (fill.flags & 0x700) === 0x700,
        JSON.stringify(fill));
  check("...and the frame is centred on the spawn point, 1.2 x 0.8",
        drawn[0].x === 320 && drawn[0].sx === 1.2
        && Math.abs(drawn[0].sy - 0.8) < 1e-6 && (drawn[0].flags & 0xf) === 10);
  check("a filling bar has no trail", bar.trail === bar.shown);

  // 0.01 a frame in single precision: a hundred additions fall short of 1.0,
  // and the hundred-and-first is clamped to it. Doubles would get there on
  // the hundredth, which is what this is here to notice.
  let frames = 1;
  while (bar.shown < 1 && frames < 1000) { frame(); frames++; }
  check("the bar fills in 101 frames of 0.01 in floats", frames === 101,
        `${frames}`);

  G.g_boss_hp_fraction = BossHpFractionOf(150, 300);
  drawn = frame();
  check("damage shows on the frame it lands, and leaves a trail",
        bar.shown === 0.5 && bar.trail === Math.fround(1 - 0.001)
        && drawn[2].sx === (bar.trail - bar.shown) * 18,
        `${bar.shown} ${bar.trail}`);
  let drain = 1;
  while (bar.trail > bar.shown && drain < 2000) { frame(); drain++; }
  check("the trail drains 0.001 a frame and stops at the fill", drain === 501
        && bar.trail === bar.shown, `${drain}`);

  // Dead: 0.0 exactly blinks for 120 frames, five hidden in every ten, then
  // the task kills itself.
  G.g_boss_hp_fraction = BossHpFractionOf(0, 300);
  let shown = 0;
  let hidden = 0;
  let life = 0;
  while (G.g_boss_hp_bars.length && life < 1000) {
    if (frame().length) shown++; else hidden++;
    life++;
  }
  check("a fill of 0 blinks the bar for 120 frames and ends it",
        life === 120 && G.g_boss_hp_bars.length === 0
        && hidden > 50 && shown > 50, `${life} ${shown}/${hidden}`);

  BossHpBarSpawn(320, 35);
  G.g_boss_hp_fraction = BOSS_HP_BAR_KILL;
  check("-1 kills the bar at once, drawing nothing",
        frame().length === 0 && G.g_boss_hp_bars.length === 0);

  BossHpBarSpawn(320, 35);
  check("the bar is plain data a snapshot can copy",
        JSON.stringify(JSON.parse(JSON.stringify(G.g_boss_hp_bars)))
        === JSON.stringify(G.g_boss_hp_bars));
  ResetGameGlobals();
  check("a scene reset takes the bar task with the task list",
        G.g_boss_hp_bars.length === 0);

  ScreenSpriteQueueReset();
  for (let i = 0; i < SCREEN_SPRITE_QUEUE_CELLS + 5; i++) {
    DrawScreenSpriteLayered(0x59, i, 0, 1, 1, 1, 0, i & 3);
  }
  G.g_screen_sprite_draws = [];
  ScreenSpriteQueueFlush();
  const layers = G.g_screen_sprite_draws.map((d) => d.x & 3);
  check("the queue holds 28 cells and draws layer by layer",
        G.g_screen_sprite_draws.length === SCREEN_SPRITE_QUEUE_CELLS
        && SCREEN_SPRITE_QUEUE_CELLS === 28
        && layers.every((l, i) => i === 0 || l >= layers[i - 1]),
        layers.join());
  G.g_screen_sprite_draws = [];
  ScreenSpriteQueueReset();
}

// The boss-name banner -- `BossIntroBannerSpawn` (`FUN_00437A70`) and
// `BossIntroBannerUpdate` (`FUN_00437AC0`) -- with Judgment's record: flag 2,
// camera path 48, the boss's card in slot 0x181D.
{
  ResetGameGlobals();
  // A path whose eye is the frame it was asked for, so the flight is visible.
  const path = {
    pose: (t: number, _roll: boolean,
           out: { eye: Vec3; target: Vec3; roll: number }) => {
      out.eye.x = t; out.eye.y = 1; out.eye.z = 2;
      out.target.x = t; out.target.y = 1; out.target.z = 10;
      out.roll = 0;
      return out;
    },
  };
  const host: GameHost = {
    ...NULL_HOST,
    camPath: (slot) => (slot === 48 ? path as unknown as CamPath : null),
  };
  G.g_camera_block_eye = { x: 7, y: 8, z: 9 };
  G.g_camera_block_target = { x: 70, y: 80, z: 90 };
  const b = BossIntroBannerSpawn(0x00570ec8);
  BossBannersTick(host);
  check("a banner waits on its record's flag", b.step === BannerStep.Waiting
        && G.g_camera_driver_held === 0, `step ${b.step}`);

  ResetGameGlobals();
  G.g_camera_block_eye = { x: 7, y: 8, z: 9 };
  G.g_camera_block_target = { x: 70, y: 80, z: 90 };
  G.g_script_flags[2] = 1;
  const j = BossIntroBannerSpawn(0x00570ec8);
  BossBannersTick(host);
  check("...and the preload tests the flag on its own frame "
        + "(`JMP 0x00437d70`), so a raised flag seats it at once",
        j.step === BannerStep.Seat && j.frame === 1, `${j.step} ${j.frame}`);
  BossBannersTick(host);
  check("the seat parks the camera driver and lays out eight cards, the "
        + "boss's own seventh",
        G.g_camera_driver_held === 1 && j.step === BannerStep.Slide
        && j.frame === 2 && j.slots.join() === [0x7ed, 0x7ee, 0x7ee, 0x7ee,
          0x7ee, 0x7ee, 0x181d, 0x7ee].join()
        && j.cards[7].z < j.cards[0].z && j.cards[0].scale === Math.fround(0.03),
        `${j.slots.map((v) => v.toString(16)).join()}`);
  G.g_camera_mode = CameraMode.TrackEnemies;
  G.g_camera_free = 1;
  CameraDriverSelectMode();
  check("...and a held driver is mode 6, which does nothing and frees nothing",
        G.g_camera_mode === CameraMode.Held && G.g_camera_free === 0);

  const headingAtSeat = [G.g_camera_block_yaw_bams, G.g_camera_block_pitch_bams,
                         G.g_camera_block_roll_bams].join();
  BossBannersTick(host);
  check("the slide flies the camera block along the record's path",
        G.g_camera_block_eye.x === 2 && G.g_camera_block_target.z === 10,
        JSON.stringify(G.g_camera_block_eye));
  // **Eye and target, no angles**: `CamEvalPath7` writes six floats and the
  // banner never calls `CamBlockSetAnglesFromLookAt`, so block 0's view keeps
  // the heading it found. (Under scene state (1, 3), where stage 1's banner
  // runs, the frame is drawn from block 2 instead, which turns onto the
  // flight's look-at -- `render.test.ts`, "the boss-name banner's flight".)
  UpdateSceneViewAndLight();
  check("...and leaves block 0's heading alone, so block 0's view keeps it "
        + "and sits at the banner's eye",
        [G.g_camera_block_yaw_bams, G.g_camera_block_pitch_bams,
         G.g_camera_block_roll_bams].join() === headingAtSeat
        && G.g_camera_view_to_world[12] === Math.fround(2)
        && G.g_camera_view_to_world[13] === Math.fround(1)
        && G.g_camera_view_to_world[14] === Math.fround(2),
        `${headingAtSeat} -> ${G.g_camera_block_yaw_bams},`
        + `${G.g_camera_block_pitch_bams}; `
        + `${Array.from(G.g_camera_view_to_world.slice(12, 15)).join()}`);
  let restacked = -1;
  while (j.frame < 0x50 && j.step === BannerStep.Slide) {
    BossBannersTick(host);
    if (restacked < 0 && j.cards[0].yaw === -0x4200) restacked = j.frame;
  }
  check("card 0 turns 0x300 a frame from frame 15, is re-stacked edge-on and "
        + "stops half way round",
        restacked === 15 + 22 && j.cards[0].yaw === -0x8000
        && j.cards[0].z === Math.fround(-1 - 8 * Math.fround(0.01))
        && j.cards[6].yaw === 0 && j.cards[7].yaw === 0,
        `${restacked} ${j.cards[0].yaw} ${j.cards[0].z}`);

  G.g_screen_sprite_draws = [];
  BossBannersTick(host);
  const names = G.g_screen_sprite_draws.filter((d) => d.id === 0xba
                                              || d.id === 0xc8);
  check("frame 0x50 starts the hold and the two names, at alpha 0",
        j.step === BannerStep.Hold && names.length === 2
        && names[0].alpha === 0 && names[0].x === 310 && names[1].x === 526,
        JSON.stringify(names));
  for (let i = 0; i < 60; i++) BossBannersTick(host);
  G.g_screen_sprite_draws = [];
  BossBannersTick(host);
  check("...and they are fully in sixty frames later",
        G.g_screen_sprite_draws.some((d) => d.id === 0xba && d.alpha === 1));
  check("every card but the boss's has shrunk away; the boss's is 0.06 and "
        + "where the record sends it",
        j.cards.every((c, i) => i === 6 || c.scale === 0)
        && j.cards[6].scale === Math.fround(0.06)
        && j.cards[6].x === Math.fround(0.06)
        && j.cards[6].y === Math.fround(0.01),
        JSON.stringify(j.cards[6]));

  let n = 0;
  while (G.g_boss_banners.length && n < 1000) { BossBannersTick(host); n++; }
  check("on frame 300 the banner opens the shutter, lets the camera go, puts "
        + "the block back and ends",
        G.g_bHudShutterState === 1 && G.g_camera_driver_held === 0
        && G.g_camera_block_eye.x === 7 && G.g_camera_block_target.z === 90
        && G.g_boss_banners.length === 0 && j.frame === 300,
        `${G.g_bHudShutterState} ${j.frame} ${JSON.stringify(G.g_camera_block_eye)}`);

  const k = BossIntroBannerSpawn(0x00570ec8);
  BossBannersTick(host);
  BossBannersTick(host);
  check("a banner mid-flight is plain data a snapshot can copy",
        JSON.stringify(JSON.parse(JSON.stringify(k))) === JSON.stringify(k));
  ResetGameGlobals();
  check("a scene reset takes the banner and its hold on the camera with it",
        G.g_boss_banners.length === 0 && G.g_camera_driver_held === 0);
  check("the exporter ships each spawning class's cards: the two backs and "
        + "the boss's own, and nothing for a class with no banner",
        bannerCardSlots([0x19]).join() === [0x7ed, 0x7ee, 0x1873].join()
        && bannerCardSlots([0x22, 0x14]).join()
           === [0x7ed, 0x7ee, 0x181d, 0x1821].join()
        && bannerCardSlots([0x45, 0x30]).length === 0);
}

// `MarkActorShot` (`FUN_00404DB0`)'s per-player byte at `obj+0x190 + player`:
// the bone's index for a bone hit, 1 for an actor hit whole.
{
  ResetGameGlobals();
  const a = makeActor(0x77, SpawnClass.Zombie, 1, "znassb");
  MarkActorShot(a, 1, 2);
  check("a bone hit writes the bone into the shooter's own byte, and the "
        + "shooter's bit", a.shotBones[1] === 2 && a.shotBones[0] === 0
        && (a.flags & ActorFlag.HitByPlayer1) !== 0
        && (a.flags & ActorFlag.Hit) !== 0, JSON.stringify(a.shotBones));
  MarkActorShot(a, 0, 0, true);
  check("...and a whole-actor hit writes 1, leaving the other player's",
        a.shotBones[0] === 1 && a.shotBones[1] === 2,
        JSON.stringify(a.shotBones));
}

// `ActorHeadingErrorTo` (`FUN_00426090`) and `ActorTurnTowardXZ`
// (`FUN_00426120`), at a quarter turn -- where a wrong sign or axis shows (L48).
{
  const a = makeActor(0x78, SpawnClass.Zombie, 1, "znassb");
  a.yaw = 0;
  check("facing +z, an offset along +z is dead ahead",
        ActorHeadingErrorTo(a, 0, 1) === 0);
  check("...and one along +x is a quarter turn round, as VecToAngles "
        + "measures a yaw", ActorHeadingErrorTo(a, 1, 0) === 0x4000,
        `${ActorHeadingErrorTo(a, 1, 0)}`);
  a.yaw = 0x4000;
  check("turned a quarter, +x is dead ahead and +z a quarter the other way",
        ActorHeadingErrorTo(a, 1, 0) === 0
        && ActorHeadingErrorTo(a, 0, 1) === -0x4000,
        `${ActorHeadingErrorTo(a, 1, 0)} ${ActorHeadingErrorTo(a, 0, 1)}`);
  a.yaw = 0;
  ActorTurnTowardXZ(a, 1, 0, 0x200);
  check("a turn takes at most its step", a.yaw === 0x200, `${a.yaw}`);
  a.yaw = 0x3f00;
  ActorTurnTowardXZ(a, 1, 0, 0x200);
  // The error is `__ftol` of a float: 0x100 comes back as 255.99..., and the
  // truncation is the engine's, so the turn lands within one BAMS.
  check("...and closes the error in one step when it is inside it",
        Math.abs(a.yaw - 0x4000) <= 1, `${a.yaw}`);
  a.yaw = 0;
  ActorTurnTowardXZ(a, -1, 0, 0x200);
  check("...and turns the other way for the other side", a.yaw === -0x200,
        `${a.yaw}`);
}

// The stashed rail, owned by `G`: `CameraStepRailTick` (`FUN_0040C790`) and
// `CameraPlayStashedPath` (`FUN_0040C8A0`) step `g_stashed_path_frame` and
// publish `g_rail_frame`, and a range written from game code -- the stage-4
// boss's camera cues -- is what they play next.
{
  ResetGameGlobals();
  // Past the gate, so this block is about the range: the gate has its own.
  G.g_force_rail_advance = 1;
  /** The frames a hook publishes, until it stops stepping. */
  const drawn = (tick: () => void): number[] => {
    const out: number[] = [];
    for (let i = 0; i < 100; i++) {
      const was = G.g_stashed_path_frame;
      tick();
      if (G.g_stashed_path_frame === was) break;
      out.push(G.g_rail_frame);
    }
    return out;
  };
  CamStashPathRange(35, 351, 384);
  const six = drawn(CameraStepRailTick);
  check("state (2,6) increments before it publishes and stops at the end: "
        + "351..384 draws 352..384",
        six[0] === 352 && six[six.length - 1] === 384 && six.length === 33,
        `${six[0]}..${six[six.length - 1]} (${six.length})`);
  check("...and `g_cam_path_frames_left` reads 0 on the last",
        G.g_cam_path_frames_left === 0, `${G.g_cam_path_frames_left}`);
  CamStashPathRange(35, 351, 384);
  const seven = drawn(CameraPlayStashedPath);
  check("...and state (2,7)'s JG lets one frame past the end through: "
        + "352..385", seven[seven.length - 1] === 385 && seven.length === 34,
        `${seven[0]}..${seven[seven.length - 1]} (${seven.length})`);
  // What `Boss4PlayCameraCue` does: overwrite both stash words from game code.
  G.g_stashed_path_frame = 600;
  G.g_stashed_path_end_frame = 640;
  CameraStepRailTick();
  check("...until game code moves the range on, and it plays from there",
        G.g_rail_frame === 601, `${G.g_rail_frame}`);
  ResetGameGlobals();
  check("a reset leaves no stale range for a seek to replay",
        G.g_stashed_path_frame === 0 && G.g_stashed_path_end_frame === 0
        && G.g_rail_frame === 0);
}

/**
 * **The rail's gate.** Both hooks step the stash only when
 * `g_force_rail_advance == 1 || IsDemoRun() || (g_screen_shake_frames == 0 &&
 * g_players_in_play != 0)` (`0x0040C7A6`, `0x0040C8C6`): a hit holds the rail
 * for the shake, and so does an empty game. The frame is still published and
 * the pose still evaluated, so the camera stands rather than blanks.
 */
{
  ResetGameGlobals();
  EnterPlay();
  CamStashPathRange(35, 100, 200);
  CameraStepRailTick();
  check("with a player in play and no shake the rail steps",
        G.g_stashed_path_frame === 101 && G.g_rail_frame === 101,
        `${G.g_stashed_path_frame}`);
  G.g_screen_shake_frames = 0x30;
  CameraStepRailTick();
  CameraPlayStashedPath();
  check("a shake holds it where it is -- both hooks -- still publishing",
        G.g_stashed_path_frame === 101 && G.g_rail_frame === 101
        && G.g_cam_path_frames_left === 99,
        `${G.g_stashed_path_frame} ${G.g_cam_path_frames_left}`);
  G.g_screen_shake_frames = 0;
  const inPlay = G.g_players_in_play;
  G.g_players_in_play = 0;
  CameraStepRailTick();
  check("...and so does nobody being in play", G.g_stashed_path_frame === 101);
  G.g_force_rail_advance = 1;
  CameraStepRailTick();
  check("...unless the script forces it (opcode 0x37)",
        G.g_stashed_path_frame === 102);
  G.g_force_rail_advance = 0;
  G.g_players_in_play = inPlay;
}
