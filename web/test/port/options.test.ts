import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { GameUpdate } from "../../src/game/director";
import { PlayerBlockCapture } from "../../src/game/player_shell";
import {
  AppState, G, PlayerState, ResetGameGlobals,
} from "../../src/game/globals";
import { NULL_HOST } from "../../src/game/host";
import { SetGameTables } from "../../src/game/tables";
import { GameMode } from "../../src/game/game_mode";
import { ModeStartCounterValue } from "../../src/game/credits";
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
  check, CHARS, openShutter, scene, JoinPlayerTwo, run,
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
