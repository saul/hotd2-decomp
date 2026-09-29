import type { CharactersJson, CharacterType } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { ActorSpawn, GameUpdate } from "../../src/game/director";
import { ActorAdvanceMotion } from "../../src/game/motion";
import { PlayerBlockCapture } from "../../src/game/player_shell";
import {
  AppState, G, PlayerState, ResetGameGlobals,
} from "../../src/game/globals";
import { NULL_HOST } from "../../src/game/host";
import { MotionPlayFrame, SetGameTables } from "../../src/game/tables";
import { ZombieState } from "../../src/game/class30/states";
import {
  ActorFlag, ThrowerFlag, ZombieFlag2, type ZombieActor,
} from "../../src/game/actor";
import { SpawnClass } from "../../src/game/spawn_class";
import { GameMode } from "../../src/game/game_mode";
import { ModeStartCounterValue } from "../../src/game/credits";
import { ThrowerMotion, ThrowerState } from "../../src/game/class31/states";
import { vec3, type Vec3 } from "../../src/game/vec";
import {
  ActorReactToHit, EffectCode, HitResultCode, ResolveHit,
} from "../../src/game/combat/resolve_hit";
import {
  LeapStrikeSub, LeapTargetMode, ZombieLeapStrikeTarget, ZombieStateLeapStrike,
} from "../../src/game/class30/leap_strike";
import { HALVED_STUMP_SLOT } from "../../src/game/class30/halved";
import { ActorSetMotionBlended, ZombieSetMotionIfIdle }
  from "../../src/game/class30/motion_cue";
import { ZombieClearHitReactionWhenDone } from "../../src/game/class30/react";
import { OverlayCursor } from "../../src/game/motion";
import { ThrowerMotionOf } from "../../src/game/class31/tables";
import { SetPlayerAimFromPointer } from "../../src/game/scene_lights";
import { OptionsCalibrationEntry } from "../../src/game/options";
import { OptionsPad, OptionsRow, OptionsTap } from "../../src/game/options/list";
import { OptionsFrame } from "../../src/game/options/state";
import { OptionsFactoryReset, ProfileBoot, ProfileCapture, ProfileLoad,
         type ProfileBlock } from "../../src/game/profile";
import { OptionsSprite } from "../../src/game/options_data";
import { RequestAppState } from "../../src/game/app_state";
import { SetOptionsTables } from "../../src/game/tables";
import { GetPlayerInputModes, InputMode, SetPlayerInputModes }
  from "../../src/game/input_mode";
import {
  check, motion, TYPE, CHARS, SCENE_MAJOR_PLAYING, spawnZombie, openShutter,
  scene, EnterPlay, JoinPlayerTwo, run, CAM_HOST, thrower,
} from "./harness";

// -- the options screen (app state 0x0C) ---------------------------------------

console.log("the options screen, driven with pad bits:");
{
  // `OptionsRunPhase` (`FUN_004869E0`) and its list, from the page's boot:
  // `ProfileBoot` with nothing saved, then the menu's request for app state
  // 0x0C, which is what the title's OPTION row makes.
  const rng = new Rng(5);
  const heard: number[] = [];
  const saved: ProfileBlock[] = [];
  const ev = new Events();
  ev.on("sound.play", (d) => heard.push(d.id));
  ev.on("profile.save", (d) => saved.push(d.profile));
  // The screen's `.rdata`, as `ExeTables.optionsTables` reads it: the rows
  // and labels are the image's; the glyph table is one sprite per character
  // (`0x1000 + code`) so a drawn string can be read back; the SE test's
  // first two entries.
  const rows = [
    [2, 3, "Difficulty"], [2, 4, "Life"], [2, 5, "Continue"],
    [2, 6, "Blood Color"], [2, 7, "Sight Graphic"], [2, 8, "Sight Speed"],
    [2, 9, "Sound Test Special Effects"], [2, 10, "Sound Test Music"],
    [2, 11, "Gun Calibration"], [2, 12, "Default"], [15, 18, "EXIT"],
  ].map(([col, row, label]) => ({ col: col as number, row: row as number,
                                   label: label as string }));
  SetOptionsTables({
    rows,
    difficulty_labels: ["Very Easy", "     Easy", "   Normal", "     Hard",
                        "Very Hard"],
    digits: "0123456789".split(""), blood_labels: ["  Red", "Green"],
    free_play: "Free Play", number: "No.",
    glyphs: Array.from({ length: 96 }, (_u, i) => (i === 0 ? 0 : 0x1020 + i)),
    crosshair_sprites: [2728, 2730, 2731, 2732, 2729, 2733, 2734, 2735],
    se_test: [0x80000000, 0x15a9], se_test_packs: [-1, -1],
    music_test: [0x80000000, 0x1000001a],
    sight_speed_sprites: [0xa91, 0xa92, 0xa93, 0xa94],
  });
  /** The glyphs drawn on one line, left to right, as text. */
  const glyphText = (line: number) => G.g_screen_sprite_draws
    .filter((s) => s.id > 0x1020 && s.id < 0x1080
      && s.y >= line * 24 && s.y < line * 24 + 8)
    .sort((a, b) => a.x - b.x)
    .map((s) => String.fromCharCode(s.id - 0x1000)).join("");
  const frame = (pad = 0, held = 0) => {
    G.g_pad_state = pad;
    G.g_pad_held = held;
    GameUpdate(1 / 60, NULL_HOST, rng, ev);
    G.g_pad_state = 0;
    G.g_pad_held = 0;
  };
  G.g_GameMode = GameMode.Arcade;
  G.g_option_credits = 5;
  ProfileBoot(null);
  check("a profile with nothing saved boots in free play -- the port's "
        + "declared departure -- at three lives and Normal, blood 1",
        G.g_option_credits === -1 && G.g_option_lives === 2
        && G.g_start_lives === 3 && G.g_difficulty === 2
        && G.g_option_blood_color === 1 && G.g_profile_version === 7,
        `credits ${G.g_option_credits} lives ${G.g_start_lives}`);
  ResetGameGlobals();
  SetGameTables(CHARS);
  check("the page's players are mouse guns in input mode 6: the mouse with "
        + "the keyboard ORed in (`InputMapDevicesToMaple` case 6)",
        G.g_input_mode[0] === 6 && G.g_player_input_is_gun[0] === 1
        && G.g_player_pad_kind[0] === -1);
  RequestAppState(AppState.Options);
  frame();
  check("a request for 0x0C is committed at the frame's end, both players "
        + "out, run phase 0",
        G.g_app_state === AppState.Options && G.g_nRunPhase === 0
        && G.g_player_state[0] === PlayerState.Out,
        `app ${G.g_app_state} phase ${G.g_nRunPhase}`);
  heard.length = 0;
  const stopped: number[] = [];
  const offStop = ev.on("sound.stopAll", () => stopped.push(1));
  frame();
  offStop();
  check("phase 0 arms the list: every sound stopped, cursor on Difficulty, "
        + "the working copies taken -- credits 0 for free play -- Blood "
        + "Color hidden, the rows below it one line up, the stage released",
        stopped.length === 1
        && G.g_nRunPhase === 1 && G.g_options_frame === OptionsFrame.List
        && G.g_options_cursor === OptionsRow.Difficulty
        && G.g_options_edit_credits === 0 && G.g_options_edit_lives === 2
        && G.g_options_blood_row_shown === 0 && G.g_options_row_shift === -1
        && G.g_stage_unloaded === 1,
        `phase ${G.g_nRunPhase} cursor ${G.g_options_cursor}`);
  frame();
  const title = G.g_screen_sprite_draws.find(
    (s) => s.id === OptionsSprite.Options);
  const exit = G.g_screen_sprite_draws.find((s) => s.id === OptionsSprite.Exit);
  const tiles = G.g_screen_sprite_draws.filter(
    (s) => s.id >= 0x7a && s.id < 0x8e);
  check("the list draws: \"OPTIONS\" 0xB31 at (344, 16) anchor 6, EXIT 0x803 "
        + "lit white and centred at (320, 18*24 - 4), twenty background "
        + "tiles at depth 200",
        title?.x === 344 && title?.y === 16 && title?.flags === 6
        && exit?.x === 320 && exit?.y === 428 && exit?.flags === 0x200a
        && exit?.tint === 0xffffff
        && tiles.length === 20 && tiles.every((t) => t.depth === 200)
        && tiles[19].x === 512 && tiles[19].y === 384,
        JSON.stringify({ title, exit, n: tiles.length }));
  const firstGlyph = G.g_screen_sprite_draws.find(
    (s) => s.id === 0x1044 && s.y === 3 * 24);
  check("...the highlighted row's label red and nearer: \"Difficulty\" on "
        + "line 3, tint 0xFF0000, depth 0.9, and \"Normal\" beside it, white",
        glyphText(3).startsWith("Difficulty")
        && firstGlyph?.tint === 0xff0000 && firstGlyph?.depth === 0.9
        && glyphText(3).endsWith("Normal"),
        `${glyphText(3)} ${JSON.stringify(firstGlyph)}`);
  check("...\"Sight Graphic\" on line 6, not 7: the hidden row's gap closed",
        glyphText(6).startsWith("SightGraphic") && glyphText(7) === "SightSpeed",
        `6 "${glyphText(6)}" 7 "${glyphText(7)}"`);
  heard.length = 0;
  frame(0x20);
  check("down: Life, and 0xA9", G.g_options_cursor === OptionsRow.Life
        && heard.includes(0xa9), `${G.g_options_cursor} ${heard}`);
  frame(0x80);
  frame(0x80);
  check("right twice: the life setting 2 -> 4, written at once",
        G.g_option_lives === 4 && G.g_options_edit_lives === 4,
        `${G.g_option_lives}`);
  frame(0x80);
  check("...and once more wraps to 0 -- \"1\" life", G.g_option_lives === 0);
  frame(0x40);
  check("...left wraps back to 4", G.g_option_lives === 4);
  frame(0x200000);
  check("player 2's down moves the same cursor: Continue",
        G.g_options_cursor === OptionsRow.Continue);
  check("...shown as \"Free Play\"", glyphText(5).endsWith("FreePlay"),
        glyphText(5));
  frame(0x80);
  check("right from free play: 1", G.g_option_credits === 1
        && G.g_options_edit_credits === 1, `${G.g_option_credits}`);
  // [diverges] The port offers free play without the three unlock bits
  // (`FREE_PLAY_ALWAYS_OFFERED`): the row wraps 0..9 as the exe's does only
  // with them.
  frame(0x40);
  check("...left from 1 is free play again, without the unlock bits: -1",
        G.g_option_unlocks === 0 && G.g_option_credits === -1
        && G.g_options_edit_credits === 0, `${G.g_option_credits}`);
  frame(0x40);
  check("...left from free play wraps to 9", G.g_option_credits === 9);
  frame(0x80);
  check("...right from 9 is free play", G.g_option_credits === -1);
  frame(0x80);
  frame(0x80);
  frame(0x80);
  check("...three more: 3", G.g_option_credits === 3);
  frame(0x20);
  check("down from Continue steps over the hidden Blood Color: Sight Graphic",
        G.g_options_cursor === OptionsRow.SightGraphic);
  frame(0x80);
  check("mode 6 may change its sight graphic: player 1's right, 0 -> 1, "
        + "written back", G.g_player_sight_graphic[0] === 1
        && G.g_player_sight_graphic[1] === 0,
        `${G.g_player_sight_graphic}`);
  frame(0x20);
  check("down steps over Sight Speed -- no player on a controller -- to the "
        + "SE test", G.g_options_cursor === OptionsRow.SoundTestSe);
  frame(0x80);
  heard.length = 0;
  frame(0x4);
  check("the SE test: right to 1, A stops voice and SE and plays 0x15A9",
        G.g_options_se_test === 1
        && JSON.stringify(heard) === JSON.stringify(
          [0x80000002, 0x80000001, 0x15a9]),
        heard.map((h) => h.toString(16)).join(","));
  for (let i = 0; i < 31; i++) frame(0, 0x80);
  check("...a right held 30 frames steps once a frame after",
        G.g_options_se_test === 3 && G.g_options_hold_repeat === 30,
        `${G.g_options_se_test} ${G.g_options_hold_repeat}`);
  heard.length = 0;
  frame(0x20);
  check("leaving a sound-test row stops music, voice and SE and plays 0xA9 "
        + "again", G.g_options_cursor === OptionsRow.SoundTestMusic
        && JSON.stringify(heard) === JSON.stringify(
          [0xa9, 0x80000000, 0x80000002, 0x80000001, 0xa9]),
        heard.map((h) => h.toString(16)).join(","));
  frame(0x20);
  check("down steps over Gun Calibration -- mode 6 is not offered it -- to "
        + "Default", G.g_options_cursor === OptionsRow.Default);
  frame(0x20);
  frame(0x20);
  check("...then EXIT, then round to Difficulty",
        G.g_options_cursor === OptionsRow.Difficulty);
  frame(0x10);
  check("up from the top: EXIT", G.g_options_cursor === OptionsRow.Exit);
  frame(0x10);
  frame(0x10);
  check("up from EXIT: Default, then the music test (Gun Calibration "
        + "stepped over)", G.g_options_cursor === OptionsRow.SoundTestMusic);
  for (let i = 0; i < 5; i++) frame(0x10);
  check("up through the rows to Difficulty",
        G.g_options_cursor === OptionsRow.Difficulty,
        `${G.g_options_cursor}`);
  frame(0x40);
  check("left from Normal: Easy", G.g_option_difficulty === 1);
  frame(0x10);
  heard.length = 0;
  frame(0x8);
  check("EXIT on START: 0x121A9, the profile saved with what was set, and "
        + "applied -- five lives, Easy",
        heard.includes(0x121a9) && saved.length === 1
        && saved[0].lives === 4 && saved[0].credits === 3
        && saved[0].difficulty === 1 && saved[0].sightGraphic[0] === 1
        && G.g_start_lives === 5 && G.g_difficulty === 1
        && G.g_nRunPhase === 2,
        JSON.stringify(saved[0]));
  frame();
  check("phase 2: credits cleared and the title asked for, committed at "
        + "the frame's end", G.g_app_state === AppState.Title
        && G.g_credits[0] === 0, `app ${G.g_app_state}`);
  // The title's START, as the page takes it: a game from the title.
  ResetGameGlobals();
  SetGameTables(CHARS);
  check("a game started from the title seeds Arcade with the credit "
        + "setting plus one -- four -- and the start spends one",
        ModeStartCounterValue(GameMode.Arcade) === 4
        && G.g_free_play === 0 && G.g_credits[0] === 3,
        `credits ${G.g_credits} free ${G.g_free_play}`);
  run(2, rng, ev);
  check("...and the player enters play with five lives",
        G.g_player_state[0] === PlayerState.InPlay
        && G.g_player_lives[0] === 5, `lives ${G.g_player_lives[0]}`);
  check("...at Easy", G.g_difficulty === 1);

  // Default: the factory settings, and 5 -- not free play.
  RequestAppState(AppState.Options);
  frame();
  frame();
  frame(0x10);
  frame(0x10);
  check("back in: up twice from Difficulty is Default",
        G.g_options_cursor === OptionsRow.Default, `${G.g_options_cursor}`);
  frame(0x4);
  check("A on Default: the factory settings -- two, two, five credits, "
        + "sight graphic 0 -- and the working copies taken again",
        G.g_option_lives === 2 && G.g_option_difficulty === 2
        && G.g_option_credits === 5 && G.g_options_edit_credits === 5
        && G.g_player_sight_graphic[0] === 0,
        `${G.g_option_lives} ${G.g_option_credits}`);
  G.g_option_credits = 3;
  OptionsFactoryReset();
  check("OptionsFactoryReset writes 5 whatever the boot's free play",
        G.g_option_credits === 5);

  // With the three unlock bits, the exe's own arm: the same wrap.
  G.g_option_unlocks = 7;
  G.g_options_cursor = OptionsRow.Continue;
  G.g_options_edit_credits = 9;
  frame(0x80);
  check("with the unlocks, right from 9 is free play: -1",
        G.g_option_credits === -1 && G.g_options_edit_credits === 0);
  G.g_option_unlocks = 0;

  // [diverges] Gun Calibration is never on offer (`GUN_CALIBRATION_OFFERED`
  // in game/options/list.ts): in the exe a gun outside mode 6 -- a finger's
  // light gun, 0xD -- is offered it, and the port has no calibration screen.
  G.g_input_mode = [0xd, 6];
  G.g_player_input_is_gun = [1, 1];
  G.g_options_cursor = OptionsRow.SoundTestMusic;
  frame(0x20);
  const calibrationDrawn = () => Array.from({ length: 20 }, (_u, l) =>
    glyphText(l)).some((t) => t.includes("GunCalibration"));
  check("a light gun (0xD, a finger) is not offered Gun Calibration either: "
        + "down from the music test is Default, and the row is not drawn",
        G.g_options_cursor === OptionsRow.Default && !calibrationDrawn(),
        `${G.g_options_cursor}`);
  frame(0x10);
  check("...and up from Default steps over it to the music test",
        G.g_options_cursor === OptionsRow.SoundTestMusic);
  G.g_input_mode = [6, 6];

  // The two sub-screens' gates.
  G.g_options_frame = OptionsFrame.Calibration;
  G.g_options_cursor = OptionsRow.GunCalibration;
  frame();
  check("Gun Calibration refuses a mode-6 gun: back to the list, cursor on "
        + "EXIT", G.g_options_frame === OptionsFrame.List
        && G.g_options_cursor === OptionsRow.Exit);
  G.g_input_mode = [5, 5];
  G.g_options_frame = OptionsFrame.Calibration;
  OptionsCalibrationEntry();
  check("...and takes a mode-5 gun: player 1", G.g_calibration_player === 0
        && G.g_options_frame === OptionsFrame.Calibration);
  G.g_input_mode = [6, 6];
  G.g_options_frame = OptionsFrame.SightSpeedArm;
  frame();
  frame();
  check("Sight Speed with no player on a controller goes straight back: "
        + "list, cursor on EXIT", G.g_options_frame === OptionsFrame.List
        && G.g_options_cursor === OptionsRow.Exit);

  // `[port-only]` -- a finger: a tap on a row puts the cursor there, and a
  // tap on the highlighted row steps it, or chooses on EXIT. Lines as drawn:
  // Difficulty 3, Sight Graphic 6 (the hidden Blood Color's gap closed), the
  // SE test 8, Default on Gun Calibration's line 10 (it is not offered),
  // Sight Speed's 7 empty (no player on a controller), EXIT's sprite at 428.
  const mid = (line: number) => line * 24 + 12;
  heard.length = 0;
  const toDifficulty = OptionsTap(mid(3), ev);
  check("a tap on Difficulty's line from EXIT: the cursor there, 0xA9, nothing pressed",
        toDifficulty === 0 && G.g_options_cursor === OptionsRow.Difficulty
        && heard.includes(0xa9), `${toDifficulty} ${G.g_options_cursor} ${heard}`);
  const diff0 = G.g_options_edit_difficulty;
  const again = OptionsTap(mid(3) + 7, ev);
  frame(again);
  check("...and a second tap on it is the right arrow: the difficulty steps",
        again === OptionsPad.Right && G.g_options_edit_difficulty === (diff0 + 1) % 5,
        `${again} ${diff0} -> ${G.g_options_edit_difficulty}`);
  check("a tap on Sight Speed's line, which is not offered, moves nothing",
        OptionsTap(mid(7), ev) === 0 && G.g_options_cursor === OptionsRow.Difficulty);
  OptionsTap(mid(8), ev);
  heard.length = 0;
  OptionsTap(mid(6), ev);
  check("leaving the SE test for Sight Graphic by a tap stops the sounds, as an "
        + "arrow does", G.g_options_cursor === OptionsRow.SightGraphic
        && heard.includes(0x80000000) && heard.includes(0x80000001), `${heard}`);
  check("Default is on Gun Calibration's line, and a second tap on it is A",
        OptionsTap(mid(10), ev) === 0 && G.g_options_cursor === OptionsRow.Default
        && OptionsTap(mid(10), ev) === OptionsPad.A);
  check("EXIT at its sprite's anchor, and a second tap chooses it",
        OptionsTap(428, ev) === 0 && G.g_options_cursor === OptionsRow.Exit
        && OptionsTap(430, ev) === OptionsPad.A);
  check("a tap on no row does nothing", OptionsTap(5, ev) === 0
        && G.g_options_cursor === OptionsRow.Exit);

  // The profile: a saved block overrides the boot's free play.
  const block = ProfileCapture();
  ProfileBoot({ ...block, credits: 5, lives: 4 });
  check("a saved profile overrides the free-play default: credits 5, five "
        + "lives", G.g_option_credits === 5 && G.g_start_lives === 5);
  ProfileBoot({ ...block, credits: -1 });
  check("...and a saved free play stays free play", G.g_option_credits === -1);
  check("a profile of another version is not taken: a reset",
        ProfileLoad({ ...block, version: 6, lives: 4 }) === 0
        && G.g_option_lives === 2 && G.g_option_credits === 5);
  ProfileBoot(null);
  G.g_app_state = AppState.InPlay;
  ResetGameGlobals();
  SetOptionsTables(undefined);
}

console.log("\nthe crosshair and the device -- the mouse has one, the light gun none:");
{
  // `HudDrawCrosshair` (`FUN_004169C0`) draws for a player whose device is
  // not a gun and aims on the screen, or who is in input mode 5 or 6 (the
  // mouse). The light gun -- `0xD` on player 1's port, `0xE` on player 2's
  // (`InputModesFromDeviceConfig`, `FUN_0041E440`) -- is a gun like the mouse
  // and in neither mode, so it never has one; the page's finger is that gun
  // and `app/` writes it through `SetPlayerInputModes` (`FUN_0041E240`).
  // Driven from the reset with both players in by their START (L49); sight
  // graphics 2 and 3, so neither sprite is a table's first entry (L48).
  const rng = new Rng(11);
  const ev = new Events();
  SetOptionsTables({
    crosshair_sprites: [2728, 2730, 2731, 2732, 2729, 2733, 2734, 2735],
  } as never);
  scene(0, rng);
  JoinPlayerTwo();
  openShutter();
  G.g_player_sight_graphic = [2, 3];
  SetPlayerAimFromPointer(0, -100, 40);
  SetPlayerAimFromPointer(1, 100, -40);
  const drawn = () => `drawn ${G.g_crosshair_drawn} sprites `
    + `${G.g_crosshair_sprite.map((s) => s.toString(16))} modes `
    + `${G.g_input_mode.map((m) => m.toString(16))}`;
  check("both players in play, both guns, both aiming on the screen",
        G.g_player_state[0] === PlayerState.InPlay
        && G.g_player_state[1] === PlayerState.InPlay
        && G.g_player_input_is_gun[0] === 1 && G.g_player_input_is_gun[1] === 1
        && G.g_aim_on_screen[0] === 1 && G.g_aim_on_screen[1] === 1,
        `states ${G.g_player_state} gun ${G.g_player_input_is_gun}`);
  SetPlayerInputModes(InputMode.MouseKeyboard, InputMode.MouseKeyboard);
  run(1, rng, ev);
  check("two mice (mode 6): both crosshairs, each player's Sight Graphic -- "
        + "player 1's 2 at 0xAAB, player 2's 3 from the blue set at +4, 0xAAF",
        G.g_crosshair_drawn[0] === 1 && G.g_crosshair_drawn[1] === 1
        && G.g_crosshair_sprite[0] === 0xaab && G.g_crosshair_sprite[1] === 0xaaf,
        drawn());
  SetPlayerInputModes(InputMode.LightGun1, InputMode.MouseKeyboard);
  run(1, rng, ev);
  check("player 1 on the light gun (0xD): no crosshair for them, aim on the "
        + "screen or not -- player 2's mouse keeps theirs",
        G.g_crosshair_drawn[0] === 0 && G.g_crosshair_drawn[1] === 1
        && G.g_aim_on_screen[0] === 1, drawn());
  SetPlayerInputModes(InputMode.MouseKeyboard, InputMode.LightGun2);
  run(1, rng, ev);
  check("...and the other way about: player 2's light gun (0xE) has none, "
        + "player 1's mouse is back", G.g_crosshair_drawn[0] === 1
        && G.g_crosshair_drawn[1] === 0 && G.g_crosshair_sprite[0] === 0xaab,
        drawn());
  // The light gun a peer's page sends is its own player 1's, `0xD`, and the
  // exe's network game writes that byte into the peer's slot as it comes
  // (`NetApplyPeerInput`): player 2 in `0xD` is a gun outside 5 and 6 too.
  SetPlayerInputModes(InputMode.MouseKeyboard, InputMode.LightGun1);
  run(1, rng, ev);
  check("player 2 in 0xD -- a peer's own light gun, as its packet says it -- "
        + "has none either", G.g_crosshair_drawn[1] === 0, drawn());
  check("GetPlayerInputModes hands back both, as SetPlayerInputModes wrote them",
        GetPlayerInputModes()[0] === 6 && GetPlayerInputModes()[1] === 0xd);
  SetPlayerInputModes(InputMode.Mouse, InputMode.Mouse);
  run(1, rng, ev);
  check("mode 5, the mouse alone, draws as 6 does",
        G.g_crosshair_drawn[0] === 1 && G.g_crosshair_drawn[1] === 1, drawn());
  // The other arm: a standard controller (the keyboard, mode 3) is not a
  // gun, and has a crosshair exactly while its aim is on the screen.
  // `PlayerBindMapleDevices` is not ported, so its 0 is written here.
  G.g_player_input_is_gun[0] = 0;
  SetPlayerInputModes(InputMode.Keyboard, InputMode.Mouse);
  run(1, rng, ev);
  const padOn = G.g_crosshair_drawn[0];
  G.g_aim_on_screen[0] = 0;
  run(1, rng, ev);
  check("a keyboard (not a gun, mode 3) has one while it aims on the screen "
        + "and none once it does not", padOn === 1
        && G.g_crosshair_drawn[0] === 0, `on ${padOn} then ${drawn()}`);
  G.g_player_input_is_gun[0] = 1;
  G.g_aim_on_screen[0] = 1;
  // No scene load writes the modes: `InputInit` at boot and the network
  // game are their only writers, and the port's reset leaves them be.
  SetPlayerInputModes(InputMode.LightGun1, InputMode.MouseKeyboard);
  const carry = PlayerBlockCapture();
  ResetGameGlobals(carry);
  check("a stage step keeps the device: player 1 still the light gun (0xD)",
        G.g_input_mode[0] === 0xd && G.g_input_mode[1] === 6,
        `modes ${G.g_input_mode}`);
  ResetGameGlobals();
  SetOptionsTables(undefined);
}

/**
 * Stage 2's crawler, `znkager` -- character type 0xC, body condition 4 on all
 * twenty of its spawns -- and the two routines that condition selects.
 *
 * `EnemyZombieInitByCharType` (`FUN_00452FD0`) raises `obj+0x136C` bit 0x80 on
 * every `znkager` and, at condition 4, calls `ZombieInitHalved`
 * (`FUN_0045DA10`): the bone-9 root hidden, a stump on bone 9, a smaller body
 * sphere, bits `0x6000080`. Then `ZombieStateHoldAtRange` sends a condition-4
 * claim to state 0x34 (`0x0045585E`), `ZombieStateLeapStrike` (`FUN_0045E330`),
 * which lands the hit through `ActorStrikeConnect` on touching down.
 *
 * The port had none of it. Every assertion below fails on the tree before this
 * section was written: the flags and the hidden bones were never set, bone 10
 * could not be severed, and the crawler ran `ZombieStateStrike` -- where its
 * attack, hit frame 40 on a clip whose play length is 20, can never land. The
 * fixture pins that play length for exactly that reason: a crawler that is
 * still in the strike deals **no** damage here, and one that leaps does.
 */
console.log("\nthe crawler: born halved, and it leaps rather than strikes:");
{
  // The EXE's type-0xC skeleton: two roots, bone 1 with the head (2) and two
  // arm chains (3-5, 6-8), and bone 9 with two leg chains (10-12, 13-15).
  // `parent` is an index into the list, as the exporter writes it.
  const kb = (bone: number, parent: number | null,
              steps: number[][] = []) =>
    ({ bone, part: `b${bone}`, slot: 0x1d80 + bone, offset: [0, 0, 0],
       parent, damage_rank: [], hit_radius: 2, steps });
  const bones = [
    kb(1, null), kb(2, 0), kb(3, 0), kb(4, 2), kb(5, 3),
    kb(6, 0), kb(7, 5), kb(8, 6),
    kb(9, null), kb(10, 8, [[0x1da9, EffectCode.Sever, 3]]), kb(11, 9),
    kb(12, 10), kb(13, 8), kb(14, 12), kb(15, 13),
  ];
  const STRIKE = 997;
  const LUNGE = 1051;
  const WINDUP = 0x41c;
  const LANDING = 0x41d;
  const KAGER = {
    ...TYPE, type: 0xc, name: "znkager", bones,
    // `00566e70`: `{997, 1051, 26.0f, 40, 9, 1}`, the entry every undamaged
    // crawler draws -- its cond-4 pick row is ten 2s per zone combo.
    attacks: {
      ...TYPE.attacks,
      "4": { "2": { strike: STRIKE, lunge: LUNGE, distance: 26, hit_frame: 40,
                    overlay_kind: 9, cancel_mask: 1 } },
    },
    attack_picks: { ...TYPE.attack_picks, "4": new Array(80).fill(2) },
    motion_row: { ...TYPE.motion_row, "4": [10, 10, 12, 12, 14] },
    motions: {
      ...TYPE.motions,
      // `g_motion_play_length[997]` is 0x14, 20, and `ZombieStateStrike`
      // fires on `obj+0x19C == 40` exactly.
      [STRIKE]: motion(11, 0, 20), [LUNGE]: motion(20, 0.6),
      [WINDUP]: motion(40), [LANDING]: motion(20),
    },
  } as unknown as CharacterType;
  const CHARS12 = {
    ...CHARS,
    types: { "1": TYPE, "3": { ...TYPE, type: 3 }, "12": KAGER },
    // `g_class30_leap_strike_arc_script`, `0x00593180`, as exported.
    combat: {
      arc_scripts: {
        leap_strike: [
          { motion: WINDUP, start: 0, fade: 5, until: 10 },
          { motion: WINDUP, start: 11, fade: 5, until: 38 },
          { motion: LANDING, start: 0, fade: 3, until: 0 },
        ],
      },
    },
  } as unknown as CharactersJson;
  const setup = () => {
    ResetGameGlobals();
    SetGameTables(CHARS12);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    EnterPlay();
    G.g_nFiringGate = 1;
  };
  const kager = (at: number, condition: number): ZombieActor => {
    const z = spawnZombie(at, 0xc, "znkager",
                          { condition, initialState: ZombieState.AttackRun,
                            attackState: -1 }, new Rng(3));
    z.visible = true;
    z.hp = z.maxHp = 100;
    z.pos = vec3(0, 0, 45);
    z.motion = 12;
    return z;
  };
  const range = (a: number, b: number) =>
    Array.from({ length: b - a + 1 }, (_, i) => a + i);

  // -- ZombieInitHalved ----------------------------------------------------
  setup();
  {
    const z = kager(0x7c00, 4);
    check("a znkager born at body condition 4 carries 0x6000080 in obj+0x136C",
          (z.flags2 & 0x6000080) === 0x6000080, `0x${z.flags2.toString(16)}`);
    check("...a body sphere of 0.8 of EnemyZombieInit's 3.5",
          Math.abs(z.bodyRadius - 3.5 * 0.8) < 1e-9, String(z.bodyRadius));
    check("...draws nothing from bone 10 to 15, and all of bones 1 to 9",
          range(10, 15).every((b) => z.removed.includes(b))
          && !range(1, 9).some((b) => z.removed.includes(b)),
          JSON.stringify(z.removed));
    check("...and draws the stump 0x1DA3 on bone 9",
          z.boneSlot["9"] === HALVED_STUMP_SLOT, JSON.stringify(z.boneSlot));
  }
  {
    const z = kager(0x7c01, 0);
    check("one born at any other condition keeps its legs and still gets 0x80",
          z.removed.length === 0
          && (z.flags2 & ZombieFlag2.SeverAnyBone) !== 0
          && (z.flags2 & ZombieFlag2.LowSphere) === 0,
          `0x${z.flags2.toString(16)} ${JSON.stringify(z.removed)}`);
    const out = ResolveHit(z, 10, NULL_HOST, new Rng(1));
    check("...which is what opens ResolveHit's type-0xC gate below bone 9",
          out.result === HitResultCode.Severed
          && z.removed.includes(11) && z.removed.includes(12),
          `result ${out.result} removed ${JSON.stringify(z.removed)}`);
  }

  // -- ZombieLeapStrikeTarget ----------------------------------------------
  {
    setup();
    const calls: number[][] = [];
    const host = {
      ...NULL_HOST,
      viewPoint: (x: number, y: number, zz: number, out: Vec3) => {
        calls.push([x, y, zz]);
        out.x = 7; out.y = 8; out.z = 9;
      },
    };
    const z = kager(0x7c02, 4);
    z.attackPermit = 1;
    const was = G.g_max_attackers;
    G.g_max_attackers = 2;
    const p = vec3();
    ZombieLeapStrikeTarget(z, p, LeapTargetMode.CameraSpace, host);
    z.condition = 0;
    ZombieLeapStrikeTarget(z, p, LeapTargetMode.CameraSpace, host);
    G.g_max_attackers = was;
    check("a crawler aims 3 under and 12.5 ahead of the camera, 2 to the "
          + "permit's side negated; anyone else 12 and 12, not negated",
          JSON.stringify(calls) === "[[2,-3,-12.5],[-2,-12,-12]]"
          && p.x === 7 && p.y === 8 && p.z === 9, JSON.stringify(calls));
  }

  // -- the hub, the leap, the hit ------------------------------------------
  {
    setup();
    const z = kager(0x7c03, 4);
    const rng = new Rng(9);
    const events = new Events();
    const sounds: number[] = [];
    events.on("sound.play", (d) => sounds.push(d.id));
    const lives = G.g_player_lives[0];
    let struck = false;
    let leapt = false;
    const subs = new Set<number>();
    let backedOff = false;
    let livesAtLanding = -1;
    for (let i = 0; i < 2400 && !backedOff; i++) {
      GameUpdate(1 / 60, NULL_HOST, rng, events);
      if (z.state === ZombieState.Strike) struck = true;
      if (z.state === ZombieState.LeapStrike) {
        leapt = true;
        subs.add(z.sub);
        if (z.sub >= LeapStrikeSub.Recoil && livesAtLanding < 0) {
          livesAtLanding = G.g_player_lives[0];
        }
      }
      if (leapt && z.state === ZombieState.BackOff) backedOff = true;
    }
    check("the hub sends a condition-4 claim to state 0x34, the leap", leapt,
          `state ${ZombieState[z.state] ?? z.state}`);
    check("...and never to ZombieStateStrike", !struck);
    check("...which is flown through its arc rather than skipped",
          subs.has(LeapStrikeSub.Flight), JSON.stringify([...subs]));
    check("...and lands the hit the strike could not: a life gone on touchdown",
          G.g_player_lives[0] === lives - 1 && livesAtLanding === lives - 1,
          `lives ${lives} -> ${G.g_player_lives[0]} (at landing ${livesAtLanding})`);
    check("...then bounces, with ENE_WALK6_22 on the bounce, into the retreat",
          backedOff && sounds.includes(0x2916a9),
          `backed off ${backedOff}, sounds ${sounds.join(",")}`);
    check("...back on the ground snap", (z.flags & ActorFlag.Airborne) === 0,
          `0x${z.flags.toString(16)}`);
  }

  // -- ActorReactToHit's three arms ----------------------------------------
  {
    setup();
    const z1 = spawnZombie(0x7c04, 1, "type 1");
    const z3 = spawnZombie(0x7c05, 3, "type 3");
    check("result 4 never staggers -- the split arm, whose split is not ported",
          ActorReactToHit(z1, 1, HitResultCode.Split) === undefined
          && ActorReactToHit(z1, 4, HitResultCode.Split) === undefined);
    check("...result 1 always does", z1.react === null
          && ActorReactToHit(z1, 4, HitResultCode.Damaged) !== undefined);
    check("...and result 0 does for type 3, as 2 and 5 do: everything that is "
          + "not 1, 3 or 4 is one arm",
          ActorReactToHit(z3, 4, HitResultCode.None) !== undefined
          && ActorReactToHit(z1, 4, HitResultCode.None) === undefined);
  }
}

/**
 * The stumble is track 1, over bone 1's subtree -- and the crawler flinches on
 * the floor.
 *
 * `ActorPlayHitReaction` (`FUN_004544C0`) plays an upper-body hit's clip with
 * `MotionCrossFadeTo(obj+0x194, 1, clip, 0, 1, result3 ? 0x14 : 10)`: bone 1's
 * subtree only, two frames in, 11 or 21 back out through
 * `MotionFadeOverlayToBase` once the clip reaches its play length; a hit on
 * bone 9 or below cuts the base track with `ActorSetMotion`. The bits it
 * raises are lowered by `ZombieClearHitReactionWhenDone` (`FUN_00454660`) a
 * quarter of the way into the clip, and `ZombieSetMotionIfIdle`
 * (`FUN_00454770`) honours them. The port blended the whole skeleton onto the
 * clip, root included -- a standing flinch that stood every `znkager` up --
 * and had none of the rest.
 */
console.log("\nthe stumble: bone 1's subtree on track 1, and what lowers it:");
{
  // `znkager`'s skeleton in small: bone 1 with head (2) and two arm chains
  // (3-5, 6-8), bone 9 with two leg chains (10-12, 13-15). `parent` is an
  // index into the list, as the exporter writes it.
  const kb = (bone: number, parent: number | null) =>
    ({ bone, part: `b${bone}`, slot: 0x1d80 + bone, offset: [0, 0, 0],
       parent, damage_rank: [], hit_radius: 2, steps: [] });
  const bones = [
    kb(1, null), kb(2, 0), kb(3, 0), kb(4, 2), kb(5, 3), kb(6, 0), kb(7, 5),
    kb(8, 6), kb(9, null), kb(10, 8), kb(11, 9), kb(12, 10), kb(13, 8),
    kb(14, 12), kb(15, 13),
  ];
  // The shipped row: condition 4's stumbles are the standing zombie's, which
  // is why the port's whole-body blend stood a crawler up. 982 is bone 1's --
  // group 2 in `g_bone_reaction_group` -- 16 frames, play length 29.
  const ROW = [982, 977, 982, 981, 979, 974, 961, 960];
  const CRAWL = 1054;
  const OTHER = 1055;
  const KAGER = {
    ...TYPE, type: 0xc, name: "znkager", bones,
    reactions: { "0": ROW, "4": ROW },
    motion_row: { ...TYPE.motion_row,
                  "4": [CRAWL, OTHER, 1051, 1051, 1049, 270, 270, 272] },
    motions: {
      ...TYPE.motions,
      "982": motion(16, 0, 29), "961": motion(21, 0, 39),
      [CRAWL]: motion(20, 0, 37), [OTHER]: motion(20, 0, 37),
      "1051": motion(17, 0.6, 31), "1049": motion(21, 0, 39),
    },
  } as unknown as CharacterType;
  const CHARS_REACT = {
    ...CHARS,
    // Type 1's leg stumble at `zom.bin` 961's real play length, 39.
    types: { "1": { ...TYPE, reactions: { "0": ROW },
                    motions: { ...TYPE.motions, "961": motion(21, 0, 39) } },
             "12": KAGER },
    reaction_groups: [0, 2, 1, 3, 3, 3, 4, 4, 4, 5, 6, 6, 6, 7, 7, 7],
  } as unknown as CharactersJson;
  const setup = () => {
    ResetGameGlobals();
    SetGameTables(CHARS_REACT);
    G.g_scene_state_major_entered = SCENE_MAJOR_PLAYING;
    G.g_scene_state_major = SCENE_MAJOR_PLAYING;
    EnterPlay();
  };
  const crawler = (at: number): ZombieActor => {
    const z = spawnZombie(at, 0xc, "znkager",
                          { condition: 4, initialState: ZombieState.AttackRun,
                            attackState: -1 }, new Rng(3));
    z.hp = z.maxHp = 100;
    z.motion = CRAWL;
    z.playTicks = 5;
    return z;
  };

  // -- ActorPlayHitReaction's two arms ------------------------------------
  setup();
  {
    const z = crawler(0x7d00);
    const clip = ActorReactToHit(z, 1, HitResultCode.Damaged);
    const t = z.react;
    check("a torso hit on a crawler plays its clip on track 1, over bone 1's "
          + "subtree",
          clip === 982 && t !== null && t.motion === 982 && t.bone === 1,
          JSON.stringify(t));
    check("...fading in over two frames and back out over eleven -- "
          + "MotionCrossFadeTo(obj+0x194, 1, clip, 0, 1, 10)",
          t !== null && t.fade === 1 && t.fadeLen === 2 && t.fadeOut === 11
          && !t.back && !t.hold, JSON.stringify(t));
    check("...leaving the crawl on the base track, which the root and the legs "
          + "keep",
          z.motion === CRAWL && z.playTicks === 5,
          `motion ${z.motion} ticks ${z.playTicks}`);
    check("...and raising obj+0x136C 0x1000 and obj+0x34 0x40000000",
          (z.flags2 & ZombieFlag2.HitClipOverlay) !== 0
          && (z.flags2 & ZombieFlag2.HitClipBase) === 0
          && (z.flags & ActorFlag.Reacting) !== 0,
          `flags2 0x${z.flags2.toString(16)} flags 0x${z.flags.toString(16)}`);
  }
  {
    const z = crawler(0x7d01);
    ActorReactToHit(z, 1, HitResultCode.Severed);
    check("a severing hit fades back out over 21 -- PUSH 0x14",
          z.react?.fadeOut === 21, JSON.stringify(z.react));
  }
  {
    const z = spawnZombie(0x7d02, 1, "walker",
                          { condition: 0, initialState: ZombieState.AttackRun,
                            attackState: -1 }, new Rng(3));
    z.hp = z.maxHp = 100;
    z.motion = 10;
    const clip = ActorReactToHit(z, 10, HitResultCode.Damaged);
    check("a leg hit cuts the whole base track onto its clip -- ActorSetMotion",
          clip === 961 && z.motion === 961 && z.playTicks === 0
          && z.react === null && z.fadeFrom === null,
          `clip ${clip} motion ${z.motion} react ${JSON.stringify(z.react)}`);
    check("...and raises obj+0x136C 0x2000, not 0x1000",
          (z.flags2 & ZombieFlag2.HitClipBase) !== 0
          && (z.flags2 & ZombieFlag2.HitClipOverlay) === 0
          && (z.flags & ActorFlag.Reacting) !== 0,
          `flags2 0x${z.flags2.toString(16)}`);
    const rng = new Rng(4);
    ZombieSetMotionIfIdle(z, 10, rng, "clip");
    check("...which ZombieSetMotionIfIdle will not replace while it is up",
          z.motion === 961, `motion ${z.motion}`);
    // A quarter of 39 is 9: `ZombieClearHitReactionWhenDone` lowers the bit
    // on the first frame the base cursor reaches it.
    let lowered = -1;
    for (let i = 1; i <= 40 && lowered < 0; i++) {
      ActorAdvanceMotion(z, 1 / 60);
      ZombieClearHitReactionWhenDone(z);
      if (!(z.flags2 & ZombieFlag2.HitClipBase)) lowered = MotionPlayFrame(z);
    }
    check("...until a quarter of the clip has played, and then both bits drop",
          lowered === 9 && (z.flags & ActorFlag.Reacting) === 0,
          `lowered at cursor ${lowered}`);
    ZombieSetMotionIfIdle(z, 10, rng, "clip");
    check("...and the state's clip comes back", z.motion === 10,
          `motion ${z.motion}`);
  }

  // -- the overlay's life: SkeletonAdvanceOverlayCursor ----------------------
  setup();
  {
    const z = crawler(0x7d03);
    ActorReactToHit(z, 1, HitResultCode.Damaged);
    // Numbers from the exe, not measured: 982's play length is 29, a quarter
    // of it 7; the fade back is `track+0x33` = 10 + 1 frames, weight
    // k / 12; and the track is handed back on the frame the base cursor --
    // which wraps at 37 + 1 -- comes round to the 0 this track holds.
    let quarterAt = -1;
    let backAt = -1;
    let backFade = -1;
    let backMotion = -1;
    let offAt = -1;
    let baseAtOff = -1;
    for (let i = 1; i <= 200 && offAt < 0; i++) {
      ActorAdvanceMotion(z, 1 / 60);
      ZombieClearHitReactionWhenDone(z);
      const t = z.react;
      if (quarterAt < 0 && !(z.flags2 & ZombieFlag2.HitClipOverlay)) {
        quarterAt = t ? OverlayCursor(z, t) : -1;
      }
      if (backAt < 0 && t?.back) {
        backAt = i;
        backFade = t.fade;
        backMotion = t.motion;
      }
      if (!t) {
        offAt = i;
        baseAtOff = MotionPlayFrame(z);
      }
    }
    check("ZombieClearHitReactionWhenDone drops 0x1000 a quarter of the way "
          + "in -- cursor 7 of 29 -- and the reaction bit with it",
          quarterAt === 7 && (z.flags & ActorFlag.Reacting) === 0,
          `at cursor ${quarterAt}`);
    check("the clip plays to its play length and then fades home: the base "
          + "clip on the track, over eleven frames",
          backAt === 1 + 29 && backMotion === CRAWL && backFade === 11,
          `back at frame ${backAt}, fade ${backFade}, motion ${backMotion}`);
    check("...and the track is handed back on the frame the base cursor is 0",
          offAt > backAt + 11 && baseAtOff === 0,
          `off at frame ${offAt}, base cursor ${baseAtOff}`);
  }

  // -- what ends it early, and what does not ----------------------------------
  setup();
  {
    const z = crawler(0x7d04);
    ActorReactToHit(z, 1, HitResultCode.Damaged);
    ZombieSetMotionIfIdle(z, OTHER, new Rng(5), "clip");
    check("ZombieSetMotionIfIdle under 0x1000 changes the legs' clip and the "
          + "stumble plays on -- ActorSetMotionBlendedUnderOverlay",
          z.motion === OTHER && z.react?.motion === 982,
          `motion ${z.motion} react ${JSON.stringify(z.react)}`);
    ActorSetMotionBlended(z, CRAWL, 0, 10);
    check("...and ActorSetMotionBlended ends it: model+0x36 = 0",
          z.motion === CRAWL && z.react === null, JSON.stringify(z.react));
  }

  // -- who staggers at all -----------------------------------------------------
  setup();
  {
    const h = ActorSpawn(0x7d05, SpawnClass.ScriptedHumanoid, 1, "humanoid");
    h.hp = h.maxHp = 100;
    h.visible = true;
    const out = ResolveHit(h, 4, NULL_HOST, new Rng(1));
    check("a class-0x25 figure shot and alive does not stagger: "
          + "ActorReactToHit's one caller is ZombieOnShot (0x0045401B)",
          out.result === HitResultCode.Damaged && h.hp > 0
          && h.react === null && (h.flags & ActorFlag.Reacting) === 0,
          `result ${out.result} react ${JSON.stringify(h.react)}`);
  }
}

/**
 * `ZombieStateLeapStrike`'s recoil is turned by the camera **block's** yaw:
 * `MOV ECX, [EAX*4 + 0x9a60d0]` at `0x0045E54A`. The two camera yaws are half
 * a turn apart in play (L64), and the leap read `g_camera_yaw_bams`, so the
 * crawler kicked itself back toward the player.
 */
console.log("\nthe crawler's recoil turns by the camera block's yaw:");
{
  ResetGameGlobals();
  SetGameTables(CHARS);
  EnterPlay();
  const z = spawnZombie(0x7d10, 1, "leaper",
                        { condition: 0, initialState: ZombieState.AttackRun,
                          attackState: -1 }, new Rng(3));
  G.g_camera_index = 0;
  G.g_camera_block_yaw_bams = 0x4000;
  G.g_camera_yaw_bams = 0xc000;
  z.state = ZombieState.LeapStrike;
  z.sub = LeapStrikeSub.Recoil;
  z.attack = Number(Object.keys(TYPE.attacks["0"] ?? {})[0] ?? 0);
  z.action = null;
  // Well above the floor, which with no collision loaded is
  // `g_camera_fixed_eye_y`: the bounce sub runs on the same frame, and must
  // not land and clear the velocity it is being asked about.
  G.g_camera_fixed_eye_y = 0;
  z.pos = vec3(0, 100, 40);
  ZombieStateLeapStrike(z, 1 / 60, new Rng(1), NULL_HOST);
  // `RotY(0x4000) . (0, 0, -0.3)` is (-0.3, 0, 0); `RotY(0xC000)` gives +0.3.
  check("the kick is RotY(g_camera_block_yaw_bams) . (0, 0, -0.3)",
        z.sub === LeapStrikeSub.Bounce && Math.abs(z.vel.x + 0.3) < 1e-6
        && Math.abs(z.vel.z) < 1e-6,
        `sub ${z.sub} vel (${z.vel.x.toFixed(3)}, ${z.vel.z.toFixed(3)})`);
}

/**
 * `ThrowerStateWalkDistance` (`FUN_0044E2A0`) starts its walk with class
 * 0x31's own `SetCurrentActorMotionBlended` (`0x0044E358`). It used to borrow
 * class 0x30's `ZombieSetMotionIfIdle`, whose `obj+0x136C` tests now read
 * bits 0x1000 and 0x2000 -- `ThrowerFlag.Walking` and `BandLatched` on a
 * thrower (L3).
 */
console.log("\nclass 0x31's walk is its own call:");
{
  const z = thrower(ThrowerState.WalkDistance, { walkDistance: 15 });
  z.flags2 |= ThrowerFlag.BandLatched;
  const walk = ThrowerMotionOf(z, ThrowerMotion.Walk);
  GameUpdate(1 / 60, CAM_HOST, new Rng(11), new Events());
  check("a thrower with obj+0x136C 0x2000 up still starts its walk",
        walk !== undefined && z.motion === walk, `motion ${z.motion}`);
}
