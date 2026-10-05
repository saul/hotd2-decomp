/**
 * Original Mode: the profile's items, the trunk that hands them out, what
 * each one does, and the weapons they arm.
 *
 * Every number asserted here is the exe's: the fresh profile's three items
 * are `ProfileFactoryReset`'s stores at `0x004010C7/CD/D3`; the item effects
 * are `OriginalItemsApply`'s switch over `ORIGINAL_MODE.weapon_records`
 * (the bundle's `original_mode` block, held to the install by
 * `tools/checks/original_mode.ts`); the trunk's pad bits and sounds are
 * `ItemSelectUpdate`'s immediates.
 */
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { ActorSpawn } from "../../src/game/director";
import { G, ResetGameGlobals } from "../../src/game/globals";
import { NULL_HOST } from "../../src/game/host";
import { g_class_handlers, type ClassFrame } from "../../src/game/registry";
import { SpawnClass } from "../../src/game/spawn_class";
import { GameMode } from "../../src/game/game_mode";
import { SetGameTables, SetOriginalModeTables } from "../../src/game/tables";
import { ProfileBoot, ProfileFactoryReset } from "../../src/game/profile";
import {
  OriginalItem, OriginalItemsApply, OriginalItemsApplyOnJoin,
  ResetOriginalModeLoadout,
} from "../../src/game/original_mode";
import { ItemSelectApplyToPlayers, OriginalRunStartWithLastChoice }
  from "../../src/game/class6e";
import {
  ITEM_SELECT_BGM, ItemSelectPad, ItemSelectRoutine, ItemSelectSound,
  ItemSelectSprite, ItemSelectState,
} from "../../src/game/class6e/state";
import {
  PlayerEnterPlayOriginalContinue, PlayerEnterPlayOriginalJoin,
} from "../../src/game/player_shell";
import { PlayerFireOriginalModeWeapon, OriginalWeaponLoadFireParams }
  from "../../src/game/player_gun";
import { FireShotRequest, QueueShotRequest } from "../../src/game/combat/shot";
import { ResolveHit } from "../../src/game/combat/resolve_hit";
import { ScoreAddForPlayer } from "../../src/game/combat/score";
import { NodeDrawHookId } from "../../src/game/actor";
import { ZombieDrawWithEnlargedHead } from "../../src/game/class30/draw";
import { SpriteEffectKind } from "../../src/game/effects/sprite";
import type { GameHost, ShotPick } from "../../src/game/host";
import { OriginalWeaponKind } from "../../src/game/effects/shot_effects";
import type { CharactersJson, ScriptJson } from "../../src/bundle";
import { IMPACT_SPRITE_BY_MATERIAL } from "../../src/hod2lib/combat";
import { Walker } from "../../src/script/walker";
import { seekTo } from "../../src/script/seek";
import {
  CHARS, check, EnterPlay, ORIGINAL_MODE, scene, spawnZombie,
} from "./harness";

/** A run in Original Mode from the title, with the block's tables in. */
function OriginalRun(): void {
  G.g_GameMode = GameMode.Original;
  ResetGameGlobals();
  SetGameTables(CHARS);
  SetOriginalModeTables(ORIGINAL_MODE);
  EnterPlay();
}

console.log("\nOriginal Mode, a fresh profile's items:");
{
  ProfileFactoryReset();
  const held = G.g_profile_original_items
    .map((n, id) => [id, n]).filter(([, n]) => n > 0);
  check("a failed profile load leaves POWER UP 1.2, CHAMBER +2 and CREDIT +2, "
        + "one each, and nothing else",
        JSON.stringify(held) === JSON.stringify([
          [OriginalItem.PowerUp12, 1], [OriginalItem.Chamber2, 1],
          [OriginalItem.CreditPlus2, 1]]),
        JSON.stringify(held));
  ProfileBoot(null);
  check("...which the boot copies into the counts a run takes from",
        G.g_original_items_taken[OriginalItem.PowerUp12] === 1
        && G.g_original_items_taken[OriginalItem.Chamber2] === 1
        && G.g_original_items_taken[OriginalItem.CreditPlus2] === 1);
}

console.log("\nOriginal Mode, the loadout reset:");
{
  OriginalRun();
  G.g_original_item_slots = [[0, 6], [3, -1]];
  G.g_original_item_big_head = 1;
  G.g_original_item_part_scale = 1;
  ResetOriginalModeLoadout();
  check("both slots empty, both flag bytes clear",
        JSON.stringify(G.g_original_item_slots) === "[[-1,-1],[-1,-1]]"
        && G.g_original_item_big_head === 0 && G.g_original_item_part_scale === 0);
  check("...each player their own character, the score single, 3 lives capped "
        + "at 5, no credits",
        G.g_original_character.join() === "0,1"
        && G.g_original_score_multiplier.join() === "1,1"
        && G.g_original_start_lives.join() === "3,3"
        && G.g_original_life_cap.join() === "5,5"
        && G.g_original_bonus_credits.join() === "0,0");
  check("...and row 0 of the weapon records: magazine 6, kind 0, damage 1.0",
        G.g_player_magazine_size.join() === "6,6"
        && G.g_original_weapon_kind.join() === "0,0"
        && G.g_original_weapon_flags.join() === "3,3"
        && G.g_original_weapon_damage_scale.join() === "1,1");
}

console.log("\nOriginal Mode, what each item does (OriginalItemsApply):");
{
  const rng = new Rng(7);
  const apply = (a: number, b = -1) => {
    ResetOriginalModeLoadout();
    G.g_original_item_slots[0] = [a, b];
    OriginalItemsApply(0, rng);
  };
  apply(OriginalItem.Shotgun);
  check("SHOTGUN: fire mode 1, two shells, weapon kind 1, its own gunshot",
        G.g_original_fire_mode[0] === 1 && G.g_player_magazine_size[0] === 2
        && G.g_original_weapon_kind[0] === OriginalWeaponKind.Shotgun
        && G.g_original_weapon_sound_kind[0] === 1);
  apply(OriginalItem.Grenade);
  check("GRENADE: fire mode 3, three rounds, kind 3, four times the damage",
        G.g_original_fire_mode[0] === 3 && G.g_player_magazine_size[0] === 3
        && G.g_original_weapon_kind[0] === OriginalWeaponKind.Grenade
        && G.g_original_weapon_damage_scale[0] === 4);
  apply(OriginalItem.PowerUp15, OriginalItem.Chamber4);
  check("POWER UP 1.5 with CHAMBER +4: the bare gun's fire, 1.5 and ten rounds",
        G.g_original_fire_mode[0] === 0
        && G.g_original_weapon_damage_scale[0] === 1.5
        && G.g_player_magazine_size[0] === 10);
  apply(OriginalItem.BulletBlow);
  check("BULLET BLOW: kind 4, the -1.0 one-shot scale, sound kind 4",
        G.g_original_weapon_kind[0] === OriginalWeaponKind.BulletBlow
        && G.g_original_weapon_damage_scale[0] === -1
        && G.g_original_weapon_sound_kind[0] === 4);
  apply(OriginalItem.CustomAirGun, OriginalItem.Chamber8);
  check("the AIR GUN takes a CHAMBER on top: fire mode 0xC, 12 + (14 - 6) = 20",
        G.g_original_fire_mode[0] === 0xc && G.g_player_magazine_size[0] === 20,
        `${G.g_player_magazine_size[0]}`);
  apply(OriginalItem.ChamberInfinite, OriginalItem.CustomAirGun);
  check("...and CHAMBER ∞ in either slot makes it unlimited, -1",
        G.g_player_magazine_size[0] === -1);
  apply(OriginalItem.ToyGun, OriginalItem.CreditPlus10);
  check("the TOY GUN: fire mode 0xD, 5 credits plus the CREDIT's 10, and the "
        + "PRIMITIVE MEAT scale",
        G.g_original_fire_mode[0] === 0xd && G.g_original_bonus_credits[0] === 15
        && G.g_original_item_part_scale === 1
        && G.g_original_weapon_sound_kind[0] === 6);
  apply(OriginalItem.LifePlus5, OriginalItem.DoubleScore);
  check("LIFE +5: eight lives and the cap eight; DOUBLE SCORE: the multiplier 2",
        G.g_original_start_lives[0] === 8 && G.g_original_life_cap[0] === 8
        && G.g_original_score_multiplier[0] === 2);
  apply(OriginalItem.RottenMeat, OriginalItem.LifeQuarter);
  check("ROTTEN MEAT and LIFE 1/4 raise their flag bytes, for both players",
        G.g_original_item_big_head === 1 && G.g_original_quarter_life === 1);
  apply(OriginalItem.GoldmanCostume);
  check("a costume is its character: GOLDMAN, 0x18, plays character 4",
        G.g_original_character[0] === 4);
  const civ = new Set<number>();
  for (let i = 0; i < 20; i++) {
    apply(OriginalItem.CivilianCostume);
    civ.add(G.g_original_character[0]);
  }
  check("...and the CIVILIAN's is 8 or 9, rand() % 2", [...civ].sort().join() === "8,9",
        [...civ].join());
  apply(OriginalItem.Shotgun, OriginalItem.PrimitiveMeat);
  OriginalItemsApplyOnJoin(0);
  check("a join takes the gun back to the bare one, and keeps the meat's scale",
        G.g_original_fire_mode[0] === 0 && G.g_player_magazine_size[0] === 6
        && G.g_original_weapon_kind[0] === 0 && G.g_original_item_part_scale === 1);
}

console.log("\nOriginal Mode, the trunk hands the items to the run:");
{
  // A fresh profile, a run from the title, and the trunk as `spawn_simple`
  // makes it.
  ProfileBoot(null);
  OriginalRun();
  G.g_evt_step_index = 5;
  G.g_evt_ip = 16;
  const sounds: number[] = [];
  let chosen: number[][] | null = null;
  const events = new Events();
  events.on("sound.play", (e) => { sounds.push(e.id); });
  events.on("original.choice", (e) => { chosen = e.slots; });
  const f: ClassFrame = { dt: 1 / 60, rng: new Rng(3), host: NULL_HOST, events };
  const trunk = ActorSpawn(-0x9ec, SpawnClass.ItemSelect, -1, "simple 0x6e",
                           { hp: 0 });
  trunk.visible = true;
  const tick = (pad = 0) => {
    G.g_pad_state = pad;
    G.g_screen_sprite_draws = [];
    G.g_world_slot_draws = [];
    g_class_handlers[SpawnClass.ItemSelect]!.update(trunk, f);
    G.g_frame_counter += 1;
    G.g_pad_state = 0;
  };
  const b = () => trunk.itemSelect!;

  tick();
  check("its first frame plays ITEM_SELECT.wav and holds the script: "
        + "g_enemies_present = 1",
        sounds[0] === ITEM_SELECT_BGM && G.g_enemies_present === 1);
  check("...copies the saved items in, and lists the three with a count",
        G.g_item_select_list.slice(0, 4).join()
          === [OriginalItem.PowerUp12, OriginalItem.Chamber2,
               OriginalItem.CreditPlus2, -1].join(),
        G.g_item_select_list.join());
  check("...draws the trunk and its lid, car_org.bin 1 and 2",
        G.g_world_slot_draws.map((d) => d.slot).join() === "5215,5216");
  check("...and is opening the lid under camera path 0x36",
        b().state === ItemSelectState.LidOpening && b().frame === 1);
  // The first frame looked at frame 0; frame 90 is looked at on the 91st.
  for (let i = 0; i < 89; i++) tick();
  check("the lid is silent until frame 90...",
        !sounds.includes(ItemSelectSound.Trunk) && b().frame === 90);
  tick();
  check("...which is the trunk's sound, TRUNK_16.wav",
        sounds.includes(ItemSelectSound.Trunk));
  tick(ItemSelectPad.A);
  check("A skips the rest of the lid", b().state === ItemSelectState.HandOver);
  tick();
  check("...and the menu opens on the next frame, with its screen",
        b().state === ItemSelectState.Menu
        && G.g_screen_sprite_draws.some((s) => s.id === ItemSelectSprite.InsideTheTrunk));

  // Take POWER UP 1.2 from row 0, then CHAMBER +2, which is row 0 again once
  // the list is rebuilt without it.
  tick(ItemSelectPad.A);
  check("A takes the row's item into slot 0, and the trunk has one fewer",
        G.g_original_item_slots[0][0] === OriginalItem.PowerUp12
        && G.g_original_items_taken[OriginalItem.PowerUp12] === 0
        && sounds.includes(ItemSelectSound.Ok));
  check("...and the list closes up over it",
        G.g_item_select_list[0] === OriginalItem.Chamber2);
  tick(ItemSelectPad.A);
  check("a second item goes into slot 1, and the cursor to END",
        G.g_original_item_slots[0][1] === OriginalItem.Chamber2
        && b().onSlots[0] === 1 && b().slot[0] === 2);
  tick(ItemSelectPad.Start);
  check("START on END: the player is done", b().choosing[0] === 0
        && b().routine === ItemSelectRoutine.Finish);
  const credits = G.g_credits[0];
  tick();
  check("the finish applies the items: 1.2 times the damage and an eight-round "
        + "magazine, loaded",
        G.g_original_weapon_damage_scale[0] === Math.fround(1.2)
        && G.g_player_magazine_size[0] === 8 && G.g_player_ammo[0] === 8);
  check("...releases the script and points it at step 1, instruction 0",
        G.g_enemies_present === 0 && G.g_evt_step_index === 1
        && G.g_evt_ip === 0);
  check("...stops the music and closes the trunk",
        sounds.includes(0x80000000) && trunk.dead);
  check("...and adds no credit: CREDIT +2 stayed in the trunk",
        G.g_credits[0] === credits);
  check("[port-only] ...and the choice is kept for a trunk a seek passes, "
        + "and raised for the page to store",
        JSON.stringify(G.g_original_last_choice)
          === JSON.stringify([[OriginalItem.PowerUp12, OriginalItem.Chamber2],
                              [-1, -1]])
        && JSON.stringify(chosen)
          === JSON.stringify(G.g_original_last_choice),
        `${JSON.stringify(G.g_original_last_choice)} ${JSON.stringify(chosen)}`);
}

console.log("\nOriginal Mode, a seek past the trunk:");
{
  // Stage 1 block 0 as Original Mode's bundle has it, cut down: step 5 spawns
  // the trunk and waits on it, step 1 is the opening. A seek into step 2
  // replays step 5 on the way, which spawns the trunk and steps over its
  // wait; the trunk must then close with the last choice rather than open
  // over the opening and, once its menu was done, send the script back.
  const op = (i: number, code: number, extra: object = {}) => ({
    i, at: 100 + i * 8, op: code, name: `op${code}`, cat: "flow", ...extra,
  });
  const script = {
    scene: 0, stage: 1, game_mode: GameMode.Original, evt_file: "test",
    entry_block: 0, entry_step: 5, entries: [0], exits: [],
    routes: [{ kind: "goto", next: [1, -1, -1] }, { kind: "end", next: [-1, -1, -1] }],
    regions: [], cam_slots_used: [], warnings: [],
    blocks: [
      { index: 0, at: 0, route: { kind: "goto", next: [1, -1, -1] }, steps: [
        { index: 0, at: 0, ops: [op(0, 0x4f)] },
        { index: 1, at: 8, ops: [op(1, 0x4f)] },
        { index: 2, at: 16, ops: [
          op(2, 0x42, { arg: 600, blocks_on: "arg frames elapsed" }),
          op(3, 0x4f)] },
        { index: 3, at: 32, ops: [op(4, 0x3f), op(5, 0x4f)] },
        { index: 4, at: -1, ops: [], end: true },
        { index: 5, at: 48, ops: [
          op(6, 0x0a, { name: "spawn_simple",
                        simple: [{ class: SpawnClass.ItemSelect, hp: 0 }] }),
          op(7, 0x43, { arg: 0, blocks_on: "enemies present <= arg" }),
          op(8, 0x4f)] },
      ] },
      { index: 1, at: 64, route: { kind: "end", next: [-1, -1, -1] },
        steps: [{ index: 0, at: 64, ops: [] }] },
    ],
  } as unknown as ScriptJson;
  ProfileBoot(null);
  OriginalRun();
  G.g_original_last_choice = [[OriginalItem.Chamber2, -1], [-1, -1]];
  const w = new Walker(script, {
    enterRegion: () => undefined, loadSlot: () => undefined,
    unloadSlot: () => undefined, startCamera: () => undefined,
    onFeed: () => undefined, onBranch: () => undefined,
    playSound: () => undefined, aliveEnemies: () => 0,
    presentEnemies: () => G.g_enemies_present,
    aliveCivilians: () => null, cameraFree: () => null,
    scriptFlagRaised: () => null,
    showMessage: () => null, endDialogue: () => undefined,
  });
  w.reset();
  const reached = seekTo(w, 0, 2, 0);
  const trunk = G.g_object_list.find((o) => o.cls === SpawnClass.ItemSelect);
  check("the seek reaches step 2 through the trunk's step, which spawned it",
        reached && w.block === 0 && w.step === 2 && trunk !== undefined,
        `block ${w.block} step ${w.step} trunk ${trunk !== undefined}`);
  check("...and the trunk is handed the seek's routine, not left to open",
        trunk?.itemSelect?.routine === ItemSelectRoutine.PassedBySeek
        && trunk.initPending === false);
  const f: ClassFrame = { dt: 1 / 60, rng: new Rng(3), host: NULL_HOST,
                          events: new Events() };
  g_class_handlers[SpawnClass.ItemSelect]!.update(trunk!, f);
  check("its first frame closes it with the last choice: CHAMBER +2 taken "
        + "out of the saved items, an eight-round magazine, loaded",
        trunk!.dead && G.g_original_item_slots[0][0] === OriginalItem.Chamber2
        && G.g_original_items_taken[OriginalItem.Chamber2] === 0
        && G.g_player_magazine_size[0] === 8 && G.g_player_ammo[0] === 8,
        `slots ${G.g_original_item_slots[0]} mag ${G.g_player_magazine_size[0]}`);
  check("...and leaves the script where the seek put it: not back at step 1",
        w.step === 2 && G.g_evt_step_index === 2,
        `step ${w.step} g_evt_step_index ${G.g_evt_step_index}`);
}

console.log("\nOriginal Mode, a new run on a stage with no trunk:");
{
  // A link into stage 3, say: the run starts from the title in the reset, as
  // every new run does, and no trunk is coming. It gets the last choice.
  ProfileBoot(null);
  OriginalRun();
  G.g_original_last_choice = [[OriginalItem.Chamber2, OriginalItem.PowerUp12],
                              [-1, -1]];
  OriginalRunStartWithLastChoice(new Rng(3));
  check("the run takes the last choice out of the saved items, as the trunk "
        + "would: both slots, and the counts one lower",
        G.g_original_item_slots[0].join()
          === [OriginalItem.Chamber2, OriginalItem.PowerUp12].join()
        && G.g_original_items_taken[OriginalItem.Chamber2] === 0
        && G.g_original_items_taken[OriginalItem.PowerUp12] === 0,
        `slots ${G.g_original_item_slots[0]}`);
  check("...and the hand-over runs: an eight-round magazine, loaded, and 1.2 "
        + "times the damage",
        G.g_player_magazine_size[0] === 8 && G.g_player_ammo[0] === 8
        && G.g_original_weapon_damage_scale[0] === Math.fround(1.2),
        `mag ${G.g_player_magazine_size[0]}`);

  // Arcade has no items, remembered or not.
  ProfileBoot(null);
  G.g_GameMode = GameMode.Arcade;
  ResetGameGlobals();
  SetGameTables(CHARS);
  SetOriginalModeTables(ORIGINAL_MODE);
  EnterPlay();
  OriginalRunStartWithLastChoice(new Rng(3));
  check("...and an Arcade run is left alone",
        G.g_original_item_slots[0].join() === "-1,-1"
        && G.g_player_magazine_size[0] === 6,
        `slots ${G.g_original_item_slots[0]} mag ${G.g_player_magazine_size[0]}`);
}

console.log("\nOriginal Mode, a pair the trunk refuses:");
{
  OriginalRun();
  G.g_profile_original_items = new Array(33).fill(0);
  G.g_profile_original_items[OriginalItem.Shotgun] = 1;
  G.g_profile_original_items[OriginalItem.MachineGun] = 1;
  const sounds: number[] = [];
  const events = new Events();
  events.on("sound.play", (e) => { sounds.push(e.id); });
  const f: ClassFrame = { dt: 1 / 60, rng: new Rng(3), host: NULL_HOST, events };
  const trunk = ActorSpawn(-0x9ec, SpawnClass.ItemSelect, -1, "simple 0x6e",
                           { hp: 0 });
  trunk.visible = true;
  const tick = (pad = 0) => {
    G.g_pad_state = pad;
    G.g_screen_sprite_draws = [];
    g_class_handlers[SpawnClass.ItemSelect]!.update(trunk, f);
    G.g_pad_state = 0;
  };
  tick(ItemSelectPad.A);   // the set-up, and the lid skipped
  tick();                  // the hand-over
  tick(ItemSelectPad.A);   // the SHOTGUN into slot 0
  sounds.length = 0;
  tick(ItemSelectPad.A);   // the MACHINE GUN: two guns, category 0 twice
  check("two guns cannot be carried together: the error, and slot 1 empty",
        sounds.includes(ItemSelectSound.Error)
        && G.g_original_item_slots[0][1] === -1
        && G.g_original_items_taken[OriginalItem.MachineGun] === 1);
  tick();
  check("...and THESE ITEMS CAN NOT BE COMBINED for the next 60 frames",
        G.g_screen_sprite_draws.some((s) => s.id === ItemSelectSprite.CannotCombine));
  tick(ItemSelectPad.Right);
  tick(ItemSelectPad.A);
  check("the refusal holds the player's input while it shows",
        G.g_original_item_slots[0][0] === OriginalItem.Shotgun);
}

console.log("\nOriginal Mode, the hand-over's credits and lives:");
{
  OriginalRun();
  G.g_credits = [4, 4];
  G.g_original_bonus_credits = [5, 0];
  G.g_original_start_lives = [8, 3];
  ItemSelectApplyToPlayers();
  check("a bonus is added to both counts -- player 0's 5 onto 4",
        G.g_credits.join() === "9,9", G.g_credits.join());
  check("...and the player in play enters with the stock's lives",
        G.g_player_lives[0] === 8 && G.g_player_lives_shown[0] === 8);
  G.g_original_bonus_credits = [0, -1];
  ItemSelectApplyToPlayers();
  check("either player's -1, CREDIT ∞, is free play", G.g_free_play === 1);
  G.g_original_start_lives[0] = 5;
  G.g_player_lives[0] = 0;
  PlayerEnterPlayOriginalContinue(0);
  check("a continue restores the stock, not the options' lives",
        G.g_player_lives[0] === 5);
  G.g_original_item_slots[0] = [OriginalItem.LifePlus5, -1];
  PlayerEnterPlayOriginalJoin(0);
  check("a join undoes LIFE +5 first: three lives", G.g_player_lives[0] === 3);
}

console.log("\nOriginal Mode, the guns the items arm:");
{
  OriginalRun();
  const rng = new Rng(11);
  const events = new Events();
  const f = { host: NULL_HOST, rng, events };
  const ray = { origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: -1 } };
  G.g_nFiringGate = 1;
  // The SHOTGUN.
  G.g_original_item_slots[0] = [OriginalItem.Shotgun, -1];
  OriginalItemsApply(0, rng);
  G.g_player_ammo[0] = G.g_player_magazine_size[0];
  OriginalWeaponLoadFireParams(0);
  const shots0 = G.g_player_shot_count[0];
  const frame = () => { PlayerFireOriginalModeWeapon(0, f); G.g_frame += 1; };
  QueueShotRequest(0, ray);
  const fired: number[] = [];
  for (let i = 0; i < 8; i++) {
    const before = G.g_player_shot_count[0];
    frame();
    if (G.g_player_shot_count[0] > before) fired.push(i);
  }
  check("one pull of the SHOTGUN is three rounds, two frames apart",
        fired.join() === "0,2,4", fired.join());
  check("...and one shell: two left of two, then one",
        G.g_player_ammo[0] === 1 && G.g_player_shot_count[0] - shots0 === 3,
        `${G.g_player_ammo[0]}`);
  // The MACHINE GUN.
  ResetOriginalModeLoadout();
  G.g_original_item_slots[0] = [OriginalItem.MachineGun, -1];
  OriginalItemsApply(0, rng);
  G.g_player_ammo[0] = G.g_player_magazine_size[0];
  G.g_player_magazine_empty[0] = 0;
  OriginalWeaponLoadFireParams(0);
  QueueShotRequest(0, ray);
  const mg: number[] = [];
  for (let i = 0; i < 16; i++) {
    const before = G.g_player_shot_count[0];
    frame();
    if (G.g_player_shot_count[0] > before) mg.push(i);
  }
  check("one pull of the MACHINE GUN empties it, a round every other frame",
        mg.join() === "0,2,4,6,8,10" && G.g_player_ammo[0] === 0, mg.join());
}

console.log("\nthe script: a -1 step word, and g_evt_ip moved under a wait:");
{
  const op = (i: number, code: number, extra: object = {}) => ({
    i, at: 100 + i * 8, op: code, name: `op${code}`, cat: "flow", ...extra,
  });
  const script = {
    scene: 0, stage: 1, game_mode: GameMode.Original, evt_file: "test",
    entry_block: 0, entry_step: 5, entries: [0], exits: [],
    routes: [{ kind: "goto", next: [1, -1, -1] }, { kind: "end", next: [-1, -1, -1] }],
    regions: [], cam_slots_used: [], warnings: [],
    blocks: [
      { index: 0, at: 0, route: { kind: "goto", next: [1, -1, -1] }, steps: [
        { index: 0, at: 0, ops: [op(0, 0x4f)] },
        { index: 1, at: 8, ops: [op(1, 0x4f)] },
        { index: 2, at: 16, ops: [
          op(2, 0x42, { arg: 5, blocks_on: "arg frames elapsed" }),
          op(3, 0x4f)] },
        { index: 3, at: 32, ops: [op(4, 0x3f), op(5, 0x4f)] },
        { index: 4, at: -1, ops: [], end: true },
        { index: 5, at: 48, ops: [
          op(6, 0x43, { arg: 0, blocks_on: "enemies present <= arg" }),
          op(7, 0x4f)] },
      ] },
      { index: 1, at: 64, route: { kind: "end", next: [-1, -1, -1] },
        steps: [{ index: 0, at: 64, ops: [] },
                { index: 1, at: 72, ops: [op(8, 0x3f), op(9, 0x3f)] }] },
    ],
  } as unknown as ScriptJson;
  ResetGameGlobals();
  G.g_enemies_present = 1;
  const w = new Walker(script, {
    enterRegion: () => undefined, loadSlot: () => undefined,
    unloadSlot: () => undefined, startCamera: () => undefined,
    onFeed: () => undefined, onBranch: () => undefined,
    playSound: () => undefined, aliveEnemies: () => 0,
    presentEnemies: () => G.g_enemies_present,
    aliveCivilians: () => null, cameraFree: () => null,
    scriptFlagRaised: () => null,
    showMessage: () => null, endDialogue: () => undefined,
  });
  w.reset();
  check("Original Mode enters block 0 at step 5, past the -1 at step 4",
        w.block === 0 && w.step === 5);
  for (let i = 0; i < 4; i++) w.tick(1 / 60);
  check("...and holds on step 5's wait while g_enemies_present is 1",
        w.step === 5 && w.opIndex === 0 && w.wait !== null);
  // What `ItemSelectFinish` writes.
  G.g_evt_step_index = 1;
  G.g_evt_ip = 0;
  w.tick(1 / 60);
  check("the wait is gone once g_evt_ip is elsewhere: step 1 runs, and its "
        + "advance_step takes the walk to step 2's own wait",
        w.block === 0 && w.step === 2 && w.wait?.op.op === 0x42,
        `block ${w.block} step ${w.step}`);
  for (let i = 0; i < 8; i++) w.tick(1 / 60);
  check("step 3's advance lands on the -1 and follows the route to block 1",
        w.block === 1, `block ${w.block} step ${w.step}`);
}

console.log("\nOriginal Mode, the weapon's damage (ResolveHit):");
{
  // One torso hit on a fresh zombie with 50 hit points, in each mode: what
  // the tables charge in Arcade is the baseline every other number scales.
  const hit = (mode: GameMode, slots: number[], quarter = 0) => {
    const rng = new Rng(3);
    scene(1, rng);
    G.g_GameMode = mode;
    SetOriginalModeTables(ORIGINAL_MODE);
    ResetOriginalModeLoadout();
    G.g_original_item_slots[0] = slots;
    OriginalItemsApply(0, rng);
    G.g_original_quarter_life = quarter;
    const z = G.g_object_list[0];
    z.hp = 50;
    const out = ResolveHit(z, 1, NULL_HOST, rng, 0);
    return { lost: 50 - z.hp, killed: out.killed };
  };
  const base = hit(GameMode.Arcade, [-1, -1]).lost;
  check("the fixture's torso costs a zombie some hit points in Arcade",
        base > 0 && base < 12, `${base}`);
  const grenade = hit(GameMode.Original, [OriginalItem.Grenade, -1]);
  check("GRENADE's 4.0 charges four times that, truncated",
        grenade.lost === Math.trunc(base * 4) && !grenade.killed,
        `${grenade.lost} of ${base}`);
  const quarter = hit(GameMode.Original, [-1, -1], 1);
  check("LIFE 1/4 charges four times again on the bare gun's 1.0",
        quarter.lost === base * 4, `${quarter.lost}`);
  const blow = hit(GameMode.Original, [OriginalItem.BulletBlow, -1]);
  check("BULLET BLOW's -1.0 charges all 50 of the zombie's hit points: one "
        + "hit kills", blow.lost === 50 && blow.killed, `${blow.lost}`);
  const blowQuarter = hit(GameMode.Original, [OriginalItem.BulletBlow, -1], 1);
  check("...and LIFE 1/4 does not multiply the one-shot",
        blowQuarter.lost === 50, `${blowQuarter.lost}`);
}

console.log("\nOriginal Mode, GRENADE's blast (MarkActorShot's last arm):");
{
  // A host whose view space is the world, and which picks the one zombie on
  // a sphere of radius 3 centred ten units down the view axis.
  const fire = (slots: number[], pick: Partial<ShotPick>) => {
    const rng = new Rng(5);
    const events = scene(1, rng);
    // The fixture has no combat block. This is the one the other shot tests
    // use, with kind 0x53's row as the exporter ships it.
    SetGameTables({ ...CHARS, combat: {
      blood_scale: { "1": 0.75, "2": 0.5, "3": 1.0 },
      impact_sprite: {
        [String(SpriteEffectKind.OriginalBlast)]:
          [...IMPACT_SPRITE_BY_MATERIAL[SpriteEffectKind.OriginalBlast]],
      },
      impact_sprite_default: [0x0904, 0x0904, 0.1],
      ricochet: {}, impact: [], head_impact: [],
      voice: { hurt: [], kill: [], head: [], attack: [[], []] },
      voice_set_a_types: [1],
    } } as unknown as CharactersJson);
    G.g_GameMode = GameMode.Original;
    SetOriginalModeTables(ORIGINAL_MODE);
    ResetOriginalModeLoadout();
    G.g_original_item_slots[0] = slots;
    OriginalItemsApply(0, rng);
    const z = G.g_object_list[0];
    const host: GameHost = {
      ...NULL_HOST,
      viewSpaceOfPoint: (p, out) => {
        out.x = p.x; out.y = p.y; out.z = p.z; return true;
      },
      pickShot: () => ({ kind: "actor", at: z.at, bone: 1,
                         point: { x: 0, y: 0, z: -10 }, t: 10,
                         ...pick } as ShotPick),
    };
    G.g_sprite_effects = [];
    FireShotRequest({ player: 0, frame: 0, onScreen: 1,
                      ray: { origin: { x: 0, y: 0, z: 0 },
                             dir: { x: 0, y: 0, z: -1 } } },
                    host, rng, events);
    return G.g_sprite_effects.filter(
      (e) => e.kind === SpriteEffectKind.OriginalBlast);
  };
  const sphere = fire([OriginalItem.Grenade, -1], { radius: 3 });
  check("a grenade hit on a sphere throws one blast, radius - 1 nearer the "
        + "eye than the centre: z -10 + 3 - 1",
        sphere.length === 1 && sphere[0].pos.z === -8
        && sphere[0].pos.x === 0 && sphere[0].pos.y === 0,
        JSON.stringify(sphere.map((e) => e.pos)));
  check("...flipping 0x125..0x13D, the exporter's row for kind 0x53",
        sphere[0]?.slot === 0x125 && sphere[0]?.lastSlot === 0x13d,
        `${sphere[0]?.slot}..${sphere[0]?.lastSlot}`);
  const mesh = fire([OriginalItem.Grenade, -1],
                    { point: { x: 1, y: 2, z: -7 },
                      mesh: { surface: 3, normal: { x: 0, y: 0, z: 1 } } });
  check("a collision-mesh hit throws it at the hit point itself",
        mesh.length === 1 && mesh[0].pos.x === 1 && mesh[0].pos.y === 2
        && mesh[0].pos.z === -7, JSON.stringify(mesh.map((e) => e.pos)));
  check("no other weapon throws one: the bare gun and the SHOTGUN",
        fire([-1, -1], { radius: 3 }).length === 0
        && fire([OriginalItem.Shotgun, -1], { radius: 3 }).length === 0);
}

console.log("\nOriginal Mode, DOUBLE SCORE (ScoreAddForPlayer):");
{
  const award = (mode: GameMode, slots: number[], points: number) => {
    ResetGameGlobals();
    G.g_GameMode = mode;
    SetOriginalModeTables(ORIGINAL_MODE);
    ResetOriginalModeLoadout();
    G.g_original_item_slots[0] = slots;
    OriginalItemsApply(0, new Rng(1));
    G.g_player_score[0] = 1000;
    ScoreAddForPlayer(0, points);
    return G.g_player_score[0] - 1000;
  };
  check("DOUBLE SCORE pays a 50-point hit 100",
        award(GameMode.Original, [OriginalItem.DoubleScore, -1], 50) === 100);
  check("...and a -100 penalty -200, the test being on the byte and not the "
        + "sign", award(GameMode.Original, [OriginalItem.DoubleScore, -1], -100)
        === -200);
  check("without it, and in Arcade, points are points",
        award(GameMode.Original, [-1, -1], 50) === 50
        && award(GameMode.Arcade, [OriginalItem.DoubleScore, -1], 50) === 50);
}

console.log("\nOriginal Mode, ROTTEN MEAT (EnemyZombieInit and its hook):");
{
  // One zombie spawned under each loadout; bone 2 is the fixture's head,
  // radius 2 in its table and its row's slot the node's, so the build gives
  // it a sphere for the init to scale.
  const spawn = (mode: GameMode, slots: number[]) => {
    ResetGameGlobals();
    G.g_GameMode = mode;
    SetGameTables(CHARS);
    SetOriginalModeTables(ORIGINAL_MODE);
    ResetOriginalModeLoadout();
    G.g_original_item_slots[0] = slots;
    OriginalItemsApply(0, new Rng(1));
    EnterPlay();
    return spawnZombie(0x1000, 1, "zombie");
  };
  const plain = spawn(GameMode.Original, [-1, -1]);
  const r0 = plain.boneRadius["2"] ?? 0;
  check("a zombie's head sphere is the build's without the item",
        r0 > 0 && plain.nodeDrawHook === NodeDrawHookId.Class, `${r0}`);
  const meat = spawn(GameMode.Original, [OriginalItem.RottenMeat, -1]);
  check("ROTTEN MEAT doubles it -- bone 2 only -- and installs the "
        + "enlarged-head hook",
        meat.boneRadius["2"] === Math.fround(r0 * 2)
        && meat.boneRadius["1"] === plain.boneRadius["1"]
        && meat.nodeDrawHook === NodeDrawHookId.EnlargedHead,
        `${meat.boneRadius["2"]} of ${r0}`);
  const f = { dt: 1 / 60, rng: new Rng(1), host: NULL_HOST } as ClassFrame;
  ZombieDrawWithEnlargedHead(meat, 1, 0x10, f);
  ZombieDrawWithEnlargedHead(meat, 2, 0x30, f);
  check("...whose draw scales bone 2 by 2 and nothing else",
        JSON.stringify(meat.nodeDrawScale[2]) === "[2,2,2]"
        && (meat.nodeDrawScale[1] ?? null) === null);
  const arcade = spawn(GameMode.Arcade, [OriginalItem.RottenMeat, -1]);
  check("the flag does nothing outside Original Mode",
        arcade.boneRadius["2"] === r0
        && arcade.nodeDrawHook === NodeDrawHookId.Class);
}
