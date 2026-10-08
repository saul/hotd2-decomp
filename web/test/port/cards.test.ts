import type { CharactersJson, CharacterType } from "../../src/bundle";
import { Rng } from "../../src/core/rng";
import { Events } from "../../src/core/events";
import { ActorSpawn } from "../../src/game/director";
import {
  ActorByAt, G, ResetGameGlobals, ScreenFurniture,
} from "../../src/game/globals";
import { NULL_HOST } from "../../src/game/host";
import { SetGameTables, SetResultCardTables, T } from "../../src/game/tables";
import { ActorFlag } from "../../src/game/actor";
import { type ClassFrame, g_class_handlers } from "../../src/game/registry";
import { SpawnClass } from "../../src/game/spawn_class";
import { syncPortGlobals } from "../../src/app/systems";
import {
  CivilianOp, CivilianUpdate, CivilianWait,
} from "../../src/game/class10";
import { GameMode } from "../../src/game/game_mode";
import { HudDrawLives } from "../../src/game/hud_readout";
import { HudSprite } from "../../src/game/hud_sprites";
import { vec3 } from "../../src/game/vec";
import type { ScriptJson } from "../../src/bundle";
import { Walker } from "../../src/script/walker";
import { seekTo } from "../../src/script/seek";
import { ScriptFlagsThisBundleCanRaise }
  from "../../src/script/waits/flag";
import {
  CHAPTER_CARD_FLAG, CHAPTER_CARD_FRAMES, ChapterCardSkipRequested,
} from "../../src/game/class60";
import { RESULT_CARD_FLAG, RESULT_CARD_FRAMES }
  from "../../src/game/class61";
import { ResultCardRoutine } from "../../src/game/class61/state";
import { ResultCardDrawAccuracy, ResultCardDrawScore }
  from "../../src/game/class61/draw";
import { EvtOpAwardAccuracyBonus2B, EvtOpSuppressAccuracyStats2F }
  from "../../src/game/combat/accuracy";
import type { ResultCardActor } from "../../src/game/actor";
import type { ResultCardJson } from "../../src/bundle/stage";
import { ProfileBoot } from "../../src/game/profile";
import {
  check, motion, TYPE, CHARS, EYE, spawnZombie, EnterPlay,
} from "./harness";

/**
 * `wait_script_flag` (0x45) is a **gameplay** gate, and `g_script_flags` is
 * one array.
 *
 * `EvtOpWaitScriptFlag45` (`FUN_0045FC80`) tests `g_script_flags[operand]` and
 * `EvtOpSetScriptFlag48` (`FUN_0045FD70`) is the single line that sets one —
 * on the same 0x100-byte array at `0x009C7200` that `CivilianRunScript`'s op
 * 0x1C (`0x0048BF2A`) and `ZombieStateTargetScriptWithFlag` (`0x0045B1DF`)
 * also write. Across the six shipped scripts **every one of the forty-odd
 * gates names a flag that script's own `set_script_flag` never sets**, so the
 * opcode is only ever "hold until an actor is finished".
 *
 * The port had two stores: a `Set` on the walker that `set_script_flag` wrote
 * and `wait_script_flag` read, and `G.g_script_flags` that gameplay wrote —
 * and `syncPortGlobals` rebuilt the second from the first once a frame, so a
 * flag an actor raised lasted until the next tick and no gate could ever see
 * it. Stage 3 block 2 step 3's `wait_script_flag 0x1E` is what that cost: the
 * hostage raises flag 30 from her own stream (rescued, command 17; shot or
 * mauled, command 12 of the on-shot stream), the wait passed on the frame it
 * was reached, and step 4's boat shot sailed past her and her captor while
 * the maul was still running.
 *
 * Asserted here on the world rather than on a layer's opinion of itself: a
 * real class-0x10 actor in `G.g_object_list` with a real captor, driven by
 * `CivilianUpdate`, against the walker's own address — and with
 * `syncPortGlobals` running every frame, because that is the call that used to
 * wipe the evidence.
 */
console.log("\n`wait_script_flag` holds for the actor that raises the flag:");
{
  /** The flag stage 3 block 2 step 3 waits on. */
  const RESCUE_FLAG = 30;
  const flagOp = (i: number, op: number, arg: number) => ({
    i, at: i, op, arg, flag: arg,
    name: op === 0x45 ? "wait_script_flag" : "set_script_flag",
    cat: op === 0x45 ? "wait" : "flow",
    blocks_on: `script flag ${arg} set`,
  });
  const script = {
    scene: 0, stage: 3, game_mode: 0, evt_file: "test", entry_block: 0,
    entry_step: 0, routes: [{ kind: "end", next: [-1, -1, -1] }],
    regions: [], cam_slots_used: [], warnings: [],
    blocks: [{
      index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
      steps: [{ index: 0, at: 0, ops: [
        flagOp(0, 0x45, RESCUE_FLAG),
        // Somewhere past the gate, and a second flag so "did it advance" is a
        // fact about the array rather than about the cursor alone.
        flagOp(1, 0x48, 7),
      ] }],
    }],
  } as unknown as ScriptJson;

  ResetGameGlobals();
  EnterPlay();
  SetGameTables(CHARS, undefined, undefined, undefined, undefined, {
    entries: [0],
    // The shape of the shipped stream 64, which is the one the hostage at
    // script address 12808 runs: a wait word leads its block and governs the
    // wait at the **end** of it, so `ChildrenAlive` here parks the VM on
    // command 2 until the captor is down, and the flag is raised by the block
    // that release runs.
    scripts: [[
      { op: CivilianOp.Wait, args: [CivilianWait.ChildrenAlive] },
      { op: CivilianOp.SetChildrenGoal, args: [0] },
      // A word of 0 is "park here": it is what stops the step loop walking
      // straight past this block, which would run the reapply walk and skip
      // the flag. Every one of the 136 shipped streams ends on one.
      { op: CivilianOp.Wait, args: [0] },
      { op: CivilianOp.SetScriptFlag, args: [RESCUE_FLAG] },
      { op: CivilianOp.Wait, args: [0] },
      { op: CivilianOp.End, args: [] },
    ]],
    items: [],
    spawns: {
      "16384": {
        charType: 1, script: 0, removePath: -1, removeFrame: 0,
        removeDelay: 0,
        children: [{ at: 0x4100, class: 0x30, charType: 1,
                     pos: [0, 0, 0] as [number, number, number],
                     yaw: 0, hp: 1 }],
      },
    },
  });

  const rng = new Rng(11);
  const events = new Events();
  const captor = spawnZombie(0x4100, 1, "captor");
  captor.visible = true;
  const civ = ActorSpawn(0x4000, SpawnClass.Civilian, 1, "hostage",
                         undefined, rng);
  civ.visible = true;
  civ.pos = vec3(0, 0, 0);

  const host = {
    enterRegion: () => undefined, loadSlot: () => undefined,
    unloadSlot: () => undefined, startCamera: () => undefined,
    onFeed: () => undefined, onBranch: () => undefined,
    playSound: () => undefined, aliveEnemies: () => null,
    presentEnemies: () => null, aliveCivilians: () => null,
    // The player's host, which is the one under test: it answers out of the
    // same array the civilian writes.
    scriptFlagRaised: (i: number) => (G.g_script_flags[i] ?? 0) !== 0,
    cameraFree: () => null,
    showMessage: () => null,
  };
  const w = new Walker(script, host);

  /** One whole frame of the player: walker, globals sync, then the port. */
  const frame = () => {
    w.tick(1 / 60);
    syncPortGlobals(w, false, EYE);
    CivilianUpdate(civ, { dt: 1 / 60, rng, host: NULL_HOST, events });
  };

  for (let i = 0; i < 30; i++) frame();
  check("the hostage and her captor are both in the pool",
        ActorByAt(0x4000)?.cls === SpawnClass.Civilian
        && ActorByAt(0x4100)?.cls === SpawnClass.Zombie
        && !ActorByAt(0x4100)?.dead,
        `civ ${ActorByAt(0x4000)?.cls} captor ${ActorByAt(0x4100)?.cls}`);
  check("...and the script is still parked on the gate 30 frames in",
        w.opIndex === 0 && w.wait?.op.op === 0x45,
        `at ${w.block}/${w.step}/${w.opIndex} wait ${w.wait?.op.op}`);
  check("...with the flag it names still down",
        (G.g_script_flags[RESCUE_FLAG] ?? 0) === 0,
        `${G.g_script_flags[RESCUE_FLAG]}`);

  // The rescue: the captor dies, the civilian's own stream runs on and raises
  // the flag. Nothing else in the fixture can raise it.
  captor.dead = true;
  captor.flags |= ActorFlag.Dead;
  frame();
  check("killing the captor lets her stream raise the flag",
        (G.g_script_flags[RESCUE_FLAG] ?? 0) === 1,
        `${G.g_script_flags[RESCUE_FLAG]} children ${civ.civ?.childCount}`);
  for (let i = 0; i < 5; i++) frame();
  check("...and it is still raised five `syncPortGlobals` calls later",
        (G.g_script_flags[RESCUE_FLAG] ?? 0) === 1,
        `${G.g_script_flags[RESCUE_FLAG]}`);
  // Past the gate the block has no more steps, so the walker has routed on —
  // `0/1/0` is the address it ends at, not the gate it was parked on.
  check("...and the script is off the gate",
        w.wait === null && !(w.step === 0 && w.opIndex === 0),
        `at ${w.block}/${w.step}/${w.opIndex} wait ${w.wait?.op.op}`);
  check("...having run the instruction behind it into the same array",
        (G.g_script_flags[7] ?? 0) === 1, `${G.g_script_flags[7]}`);

  // The escape hatch is gone. A gate on a flag nothing this port runs could
  // raise used to pass, under a declared divergence, rather than park the
  // stage for ever; with class 0x32 ported every shipped gate has a writer
  // the port runs (`tools/flag_gates.ts`), and the wait blocks as the
  // engine's does. The derivation stays, as that tool's measurement: the
  // same fixture, one flag nothing in it can raise.
  //
  // The example is **flag 20**: class 0x41's `FUN_004710C0` is ported
  // (`class41/flag_prop.ts`, and the block above watches it raise the flag
  // three different ways), but this script places no class-0x41 record at
  // the type-75 placement -- exactly the per-record declaration
  // `ClassHandler.raisesScriptFlag` was widened for. A class-wide number would
  // have put 20 in this set the moment any prop appeared.
  const canRaise = ScriptFlagsThisBundleCanRaise(script);
  check("the coverage set is the civilian's own flag and the script's own",
        canRaise.has(RESCUE_FLAG) && canRaise.has(7) && !canRaise.has(20),
        `${[...canRaise].sort((a, b) => a - b).join(",")}`);
  {
    ResetGameGlobals();
    EnterPlay();
    const unraisable = {
      ...script,
      blocks: [{
        index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
        steps: [{ index: 0, at: 0, ops: [flagOp(0, 0x45, 20)] }],
      }],
    } as unknown as ScriptJson;
    const w3 = new Walker(unraisable, host);
    for (let i = 0; i < 10; i++) w3.tick(1 / 60);
    check("...and a gate on a flag nothing in the bundle raises parks, as "
          + "EvtOpWaitScriptFlag45 does",
          w3.wait?.op.op === 0x45 && w3.step === 0 && w3.opIndex === 0,
          `at ${w3.block}/${w3.step}/${w3.opIndex} wait ${w3.wait?.op.op}`);
  }

  // A seek observes no waits, so the gate's postcondition has to be applied
  // by hand — the same argument as `retires` and `skipRunsCameraOn`. Without
  // it a reload lands past a gate whose flag is still 0, and everything that
  // reads the array (class 0x24's removal cue, 0x30's states 20 and 31,
  // 0x31's cue conditions, 0x52's despawn) sees a world the address does not
  // describe.
  ResetGameGlobals();
  EnterPlay();
  const w2 = new Walker(script, host);
  seekTo(w2, 0, 0, 1);
  check("a seek over the gate leaves the flag it was waiting for raised",
        (G.g_script_flags[RESCUE_FLAG] ?? 0) === 1,
        `${G.g_script_flags[RESCUE_FLAG]}`);

  // ...and the **other** half of that postcondition: the civilian who raises
  // the flag has run past it. A replay that raised the byte and kept her spawn
  // marker rebuilt her at the landing address with a fresh script, and her
  // rescue block ran again there. Stage 4's block-4 hostage `0x3578` did that
  // at a deep link to block 12: her captor saw flag 29 already up, died on the
  // first frame, and her `SetRouteBranch 1` decided block 12's branch whatever
  // the player did (bug 16). `Walker.retireFlagRaisers`.
  {
    ResetGameGlobals();
    EnterPlay();
    const placed = {
      ...script,
      civilians: T.civilians,
      blocks: [{
        index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
        steps: [{ index: 0, at: 0, ops: [
          { i: 0, at: 0, op: 0x0c, name: "spawn_obj_c", cat: "spawn",
            spawns: [{ at: 0x4000, class: SpawnClass.Civilian, flags: 0,
                       pos: [0, 0, 0], yaw_deg: 0, orient: [0, 0, 0], hp: 0,
                       desc_flags: 0 }] },
          { ...flagOp(1, 0x45, RESCUE_FLAG) },
          { ...flagOp(2, 0x48, 7) },
        ] }],
      }],
    } as unknown as ScriptJson;
    const w4 = new Walker(placed, host);
    seekTo(w4, 0, 0, 1);
    check("a seek that stops at the gate keeps the hostage's spawn listed",
          w4.spawns.some((s) => s.at === 0x4000),
          `${w4.spawns.map((s) => s.at).join(",")}`);
    seekTo(w4, 0, 0, 2);
    check("...and a seek past it retires her with the flag she raises",
          !w4.spawns.some((s) => s.at === 0x4000),
          `${w4.spawns.map((s) => s.at).join(",")}`);
  }
}

/**
 * `spawn_simple` (0x0A), and the two cards it places that open a gate.
 *
 * Twelve of the game's sixty-one `wait_script_flag` gates name flag 248 or
 * flag 254, and both are raised by an actor `EvtOpSpawnSimple0A`
 * (`FUN_00408990`) places — the chapter card (class 0x60, `FUN_004342E0`) and
 * the stage-clear card (class 0x61, `FUN_00434EF0`). Neither existed in this
 * port: opcode 0x0A had no handler, so the actor was never built, so the flag
 * was never raised, and `wait_script_flag` had to be excused from evaluating
 * those gates rather than park every stage on its title card.
 *
 * Asserted on the world, not on the opcode's opinion of itself: a real actor
 * in `G.g_object_list` with the class the record names, driven frame by frame,
 * against the walker's own address on the gate behind it.
 */
console.log("\n`spawn_simple` builds the cards, and the cards open the gate:");
{
  const simpleOp = (i: number, cls: number) => ({
    i, at: 0x100 + i * 8, op: 0x0a, name: "spawn_simple", cat: "spawn",
    simple: [{ class: cls, hp: 0 }],
  });
  const waitOp = (i: number, flag: number) => ({
    i, at: 0x100 + i * 8, op: 0x45, name: "wait_script_flag", cat: "wait",
    arg: flag, blocks_on: `script flag ${flag} set`,
  });
  const cardScript = (cls: number, flag: number) => ({
    scene: 0, stage: 1, game_mode: 0, evt_file: "test", entry_block: 0,
    entry_step: 0, routes: [{ kind: "end", next: [-1, -1, -1] }],
    regions: [], cam_slots_used: [], warnings: [],
    blocks: [{
      index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
      steps: [{ index: 0, at: 0, ops: [
        simpleOp(0, cls),
        waitOp(1, flag),
        { i: 2, at: 0x120, op: 0x48, name: "set_script_flag", cat: "flow",
          flag: 9 },
      ] }],
    }],
  } as unknown as ScriptJson);

  const cardHost = {
    enterRegion: () => undefined, loadSlot: () => undefined,
    unloadSlot: () => undefined, startCamera: () => undefined,
    onFeed: () => undefined, onBranch: () => undefined,
    playSound: () => undefined, aliveEnemies: () => null,
    presentEnemies: () => null, aliveCivilians: () => null,
    scriptFlagRaised: (i: number) => (G.g_script_flags[i] ?? 0) !== 0,
    cameraFree: () => null,
    showMessage: () => null,
  };

  /** Drive one card to its flag and report how many frames it took. */
  const runCard = (cls: SpawnClass, flag: number, expect: number) => {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS);
    const script = cardScript(cls, flag);
    const w = new Walker(script, cardHost);
    // The instruction, and nothing else: `SpawnSimpleActors` runs from the
    // opcode rather than from a later frame, which is what makes a seek build
    // the card at all.
    w.tick(1 / 60);
    const live = G.g_object_list.filter((o) => !o.despawned && !o.dead);
    const card = live.find((o) => o.cls === cls);
    check(`0x${cls.toString(16)}: the record puts one actor of its own class `
          + "in the pool",
          live.length === 1 && card !== undefined
          && w.simpleSpawns.length === 1,
          `${live.map((o) => `c${o.cls}`).join(",")} `
          + `list ${w.simpleSpawns.length}`);
    check("...at a key no placement descriptor could collide with",
          (card?.at ?? 0) < 0, `at ${card?.at}`);
    check("...and the walker is parked on the gate it raises",
          w.wait?.op.op === 0x45 && w.opIndex === 1
          && (G.g_script_flags[flag] ?? 0) === 0,
          `at ${w.block}/${w.step}/${w.opIndex} wait ${w.wait?.op.op}`);

    // Counted in **updates**, because that is what the countdown counts: the
    // card is built by the instruction and its first decrement is on its first
    // update, not on the frame the walker placed it.
    //
    // Bails when there is no card rather than dereferencing one: with opcode
    // 0x0A unwired there is nothing to drive, and a suite that throws reports
    // one crash where it should report which assertions the work is holding up.
    if (!card) return { frames: -1, card: null, w };
    let updates = 0;
    const f = { dt: 1 / 60, rng: new Rng(3), host: NULL_HOST };
    while (updates < expect + 60 && (G.g_script_flags[flag] ?? 0) === 0) {
      g_class_handlers[cls]?.update(card, f);
      updates += 1;
      w.tick(1 / 60);
    }
    return { frames: updates, card, w };
  };

  // The chapter card: `MOV word ptr [ESI+0x11c], 0xb4` at `0x004345AB`, then
  // the skip test at `0x00434802`. The engine would hold 180 frames; by the
  // user's decision the port takes the pad's unconditional
  // skip arm on every card, so the flag is up after **one** update — not a
  // three-second dead pause at the top of every stage.
  {
    const { frames, card, w } = runCard(SpawnClass.ChapterCard,
                                     CHAPTER_CARD_FLAG, CHAPTER_CARD_FRAMES);
    check(`the chapter card is skipped: it raises `
          + `g_script_flags[${CHAPTER_CARD_FLAG}] on its first update, not `
          + `after ${CHAPTER_CARD_FRAMES}`,
          frames === 1 && G.g_script_flags[CHAPTER_CARD_FLAG] === 1,
          `${frames} frames, flag ${G.g_script_flags[CHAPTER_CARD_FLAG]}`);
    check("...still through sub 0's latch, and kills itself on the same frame",
          card?.dead === true && card?.sub === 1 && card?.hp === 0,
          `dead ${card?.dead} sub ${card?.sub} hp ${card?.hp}`);
    check("...via the pad's own no-dwell skip bit",
          (ChapterCardSkipRequested() & 0x20000) !== 0,
          `pad 0x${ChapterCardSkipRequested().toString(16)}`);
    check("...and the gate behind it is open on the next walker tick",
          w.wait === null && (G.g_script_flags[9] ?? 0) === 1,
          `at ${w.block}/${w.step}/${w.opIndex} wait ${w.wait?.op.op}`);
  }

  /**
   * Every value written to `g_screen_furniture_flags` while `run` runs, each
   * with `g_script_flags[flag]` as it stood at that write.
   *
   * A skipped chapter card raises its bit and drops it inside one call, so
   * the word before and after that call is the same whether the card wrote
   * it twice or never touched it. Only the writes themselves can tell.
   */
  const furnitureWrites = (flag: number, run: () => void) => {
    let word = G.g_screen_furniture_flags;
    const writes: { word: number; flag: number }[] = [];
    Object.defineProperty(G, "g_screen_furniture_flags", {
      configurable: true, enumerable: true,
      get: () => word,
      set: (v: number) => {
        word = v;
        writes.push({ word: v, flag: G.g_script_flags[flag] ?? 0 });
      },
    });
    try {
      run();
    } finally {
      Object.defineProperty(G, "g_screen_furniture_flags", {
        configurable: true, enumerable: true, writable: true, value: word,
      });
    }
    return writes;
  };
  /** What a card must leave alone: start bits 0 and 1, and the other card. */
  const OTHER_FURNITURE = 0x3;

  // The chapter card's bit: `OR AL, 0x20` at `0x0043436B` first thing in
  // sub 0, and `AND AL, 0xDF` at `0x004348C7` straight after flag 248 goes
  // up at `0x004348C1`. The skip runs both in the one
  // update, which is the exe's own skip path -- so the bit is up for exactly
  // the stretch of that call between sub 0's head and the flag, and down
  // again before any other routine runs.
  {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS);
    const w = new Walker(cardScript(SpawnClass.ChapterCard, CHAPTER_CARD_FLAG),
                         cardHost);
    w.tick(1 / 60);
    const card = G.g_object_list.find((o) => o.cls === SpawnClass.ChapterCard);
    const f = { dt: 1 / 60, rng: new Rng(3), host: NULL_HOST };
    const before = OTHER_FURNITURE | ScreenFurniture.ResultCard;
    G.g_screen_furniture_flags = before;
    const writes = furnitureWrites(CHAPTER_CARD_FLAG, () => {
      if (card) g_class_handlers[SpawnClass.ChapterCard]?.update(card, f);
    });
    const shown = writes.map((x) => `0x${x.word.toString(16)}@${x.flag}`);
    check("the chapter card raises g_screen_furniture_flags bit 0x20 before "
          + "flag 248 and drops it after, both in its one skipped update",
          writes.length === 2
          && writes[0].word === (before | ScreenFurniture.ChapterCard)
          && writes[0].flag === 0
          && writes[1].word === before && writes[1].flag === 1
          && card?.dead === true,
          `${shown.join(" ")} dead ${card?.dead}`);
    check("...so the update ends with the bit down and every other bit as "
          + "it found them",
          G.g_screen_furniture_flags === before,
          `0x${G.g_screen_furniture_flags.toString(16)}`);
  }

  // The installer's two arms raise the same bit before they hand over:
  // `OR EDX, 0x20` at `0x004342F6` (Boss Mode) and `0x00434324` (app state
  // 0x0B). The clears are in the variants, which the port does not run, so
  // neither the flag nor the drop comes.
  {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS);
    const w = new Walker(cardScript(SpawnClass.ChapterCard, CHAPTER_CARD_FLAG),
                         cardHost);
    w.tick(1 / 60);
    const card = G.g_object_list.find((o) => o.cls === SpawnClass.ChapterCard);
    const f = { dt: 1 / 60, rng: new Rng(3), host: NULL_HOST };
    G.g_GameMode = GameMode.Boss;
    G.g_screen_furniture_flags = OTHER_FURNITURE;
    if (card) g_class_handlers[SpawnClass.ChapterCard]?.update(card, f);
    check("in Boss Mode the installer raises bit 0x20 and hands over, with "
          + "no latch, no flag and no kill of its own",
          G.g_screen_furniture_flags
            === (OTHER_FURNITURE | ScreenFurniture.ChapterCard)
          && (G.g_script_flags[CHAPTER_CARD_FLAG] ?? 0) === 0
          && card?.sub === 0 && card?.dead === false,
          `0x${G.g_screen_furniture_flags.toString(16)} `
          + `flag ${G.g_script_flags[CHAPTER_CARD_FLAG]} sub ${card?.sub}`);
  }

  // The result card: 420 frames, and it drops the trigger on its first.
  {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS);
    G.g_nFiringGate = 1;
    const w = new Walker(cardScript(SpawnClass.ResultCard, RESULT_CARD_FLAG),
                         cardHost);
    w.tick(1 / 60);
    const card = G.g_object_list.find((o) => o.cls === SpawnClass.ResultCard);
    const f = { dt: 1 / 60, rng: new Rng(3), host: NULL_HOST };
    /** `HudDrawLives`' state-4 arm, the reader of bit 0x10 on this side:
     *  how many "HOLD YOUR FIRE!" it draws, on a frame it would blink on. */
    const holdYourFire = (): number => {
      G.g_bHudShutterState = 4;
      G.g_frame_counter = 60;
      G.g_screen_sprite_draws = [];
      HudDrawLives(0);
      return G.g_screen_sprite_draws
        .filter((d) => d.id === HudSprite.HoldYourFire).length;
    };
    G.g_screen_furniture_flags = OTHER_FURNITURE;
    if (card) g_class_handlers[SpawnClass.ResultCard]?.update(card, f);
    check("the result card drops `g_nFiringGate` on its first frame",
          card !== undefined && G.g_nFiringGate === 0,
          `card ${card !== undefined} gate ${G.g_nFiringGate}`);
    // `OR EDX, 0x10` at `0x00434FD0`, in sub 0 beside the gate.
    check("...and raises g_screen_furniture_flags bit 0x10 there, leaving "
          + "the other bits alone",
          G.g_screen_furniture_flags
            === (OTHER_FURNITURE | ScreenFurniture.ResultCard)
          && (G.g_script_flags[RESULT_CARD_FLAG] ?? 0) === 0,
          `0x${G.g_screen_furniture_flags.toString(16)}`);
    check("...so shutter state 4 blinks no 'HOLD YOUR FIRE!' under it",
          holdYourFire() === 0);
    let frames = 1;
    let upThroughout = true;
    while (card && frames < RESULT_CARD_FRAMES + 60
           && (G.g_script_flags[RESULT_CARD_FLAG] ?? 0) === 0) {
      g_class_handlers[SpawnClass.ResultCard]?.update(card, f);
      frames += 1;
      if ((G.g_script_flags[RESULT_CARD_FLAG] ?? 0) === 0
          && (G.g_screen_furniture_flags & ScreenFurniture.ResultCard) === 0) {
        upThroughout = false;
      }
      w.tick(1 / 60);
    }
    check(`...holds ${RESULT_CARD_FRAMES} frames, then raises `
          + `g_script_flags[${RESULT_CARD_FLAG}]`,
          frames === RESULT_CARD_FRAMES
          && G.g_script_flags[RESULT_CARD_FLAG] === 1,
          `${frames} frames, flag ${G.g_script_flags[RESULT_CARD_FLAG]}`);
    // `AND AL, 0xEF` at `0x00435683`, after the flag at `0x0043567C`.
    check("...with bit 0x10 up on every frame before the flag, and down on "
          + "the frame the flag goes up",
          upThroughout && card?.dead === true
          && G.g_screen_furniture_flags === OTHER_FURNITURE,
          `up ${upThroughout} dead ${card?.dead} `
          + `0x${G.g_screen_furniture_flags.toString(16)}`);
    check("...and 'HOLD YOUR FIRE!' is back once the card has gone",
          holdYourFire() === 1);
    check("...and the gate behind it opens, so the script runs on",
          w.wait === null && !(w.step === 0 && w.opIndex === 1)
          && (G.g_script_flags[9] ?? 0) === 1,
          `at ${w.block}/${w.step}/${w.opIndex} `
          + `wait ${w.wait?.op.op} flag9 ${G.g_script_flags[9]}`);
  }

  // ...and the coverage set now says so, which is the half that decides
  // whether the gate is evaluated at all. Both directions: a stage that
  // spawns the card can open its flag, one that does not, cannot.
  {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS);
    const withCard = ScriptFlagsThisBundleCanRaise(
      cardScript(SpawnClass.ChapterCard, CHAPTER_CARD_FLAG));
    check("a stage that spawns the chapter card can raise its flag",
          withCard.has(CHAPTER_CARD_FLAG) && !withCard.has(RESULT_CARD_FLAG),
          `${[...withCard].sort((a, b) => a - b).join(",")}`);
    const withTally = ScriptFlagsThisBundleCanRaise(
      cardScript(SpawnClass.ResultCardTally, CHAPTER_CARD_FLAG));
    check("...and one that spawns only class 0x62, which raises nothing, "
          + "cannot",
          !withTally.has(CHAPTER_CARD_FLAG),
          `${[...withTally].sort((a, b) => a - b).join(",")}`);
  }

  // Two records on one instruction are two objects. `EvtOpSpawnSimple0A`
  // walks its list to the -1 and allocates per operand; the exporter does not
  // collapse duplicates, because stage 3's block 11 lists one twice.
  {
    ResetGameGlobals();
    EnterPlay();
    SetGameTables(CHARS);
    const two = {
      ...cardScript(SpawnClass.ChapterCard, CHAPTER_CARD_FLAG),
      blocks: [{
        index: 0, at: 0, route: { kind: "end", next: [-1, -1, -1] },
        steps: [{ index: 0, at: 0, ops: [{
          i: 0, at: 0x200, op: 0x0a, name: "spawn_simple", cat: "spawn",
          simple: [{ class: SpawnClass.ResultCardTally, hp: 0 },
                   { class: SpawnClass.ResultCardTally, hp: 0 }],
        }] }],
      }],
    } as unknown as ScriptJson;
    const w = new Walker(two, cardHost);
    w.tick(1 / 60);
    const made = G.g_object_list.filter(
      (o) => o.cls === SpawnClass.ResultCardTally);
    check("one instruction with two records makes two objects",
          made.length === 2 && made[0].at !== made[1].at,
          `${made.map((o) => o.at).join(",")}`);
  }
}

/**
 * The result card, whole: the figures it stands, the lives it adds, and the
 * score and accuracy it shows -- `ResultCardInstall` (`FUN_00434EF0`), its
 * figures (`FUN_004356A0`, `FUN_00435760`, `FUN_004357F0`), its two number
 * draws and class 0x62. `docs/re/stage-end.md` is the reading.
 *
 * The `.rdata` is the exe's own: `RESULT_CARD_RDATA` is what
 * `hod2lib/exetab.ts`'s `resultCardTables()` reads out of `Hod2.exe`,
 * copied once so the suite runs with no game directory, and
 * `web/tools/checks/result_card.ts` holds the bundle's copy to the exe. Every
 * expected number below is the exe's -- a record's position, a table's cell
 * -- and never the port's own output read back (L65).
 */
console.log("\nclass 0x61: the figures, the life bonus, the score and accuracy:");
{
  const RESULT_CARD_RDATA: ResultCardJson = {
    base: 0x0055dd80,
    bytes: "27007c0100006bc3000020c0cd0c01c400c000002e007d019a99fdc1cdccfcc09a3902c4" +
      "00c0000031007f0166660ac3cdccfcc000c0ffc300c0000026007c01cdcca342cdccfcc0" +
      "00c0ffc300c0000020007c010000a0c2cdccfcc09a3902c400c00000ffff000000000000" +
      "00000000000000000000000034007c01cd3c88c466666ec100109dc40000000026007d01" +
      "66c6a0c4666696c03373a7c4edb0000027007f019ab993c466666ec19aa9adc4b0960000" +
      "20007c01002092c466666ec1cd5c9ec4decd000034007c0166068dc466666ec1cd4c9ec4" +
      "26df00002e007d01007099c466666ec16626acc436a1000031007f019a4991c466666ec1" +
      "6696a1c4f9c60000ffff00000000000000000000000000000000000024007c01cdccd8c3" +
      "000080c1339345c5004000002e007d010080c2c3000080c1005040c5004000002a007f01" +
      "0080c2c3000080c1001043c50040000032007c010080c2c3000080c100903dc500400000" +
      "ffff000000000000000000000000000000000000000000002a007f019a9973c29a99c9c1" +
      "cd2c66c400c0000032007c019a99a2429a99c9c133936bc400c0000024007c019a992141" +
      "9a99c9c1331364c400c00000ffff00000000000000000000000000000000000080dd5500" +
      "f8dd550098de550000df550000df550000df550026002700ffff2400ffff00002400ffff" +
      "000028002700ffff4300ffff0000ffff000000003200ffff00002d00ffff00002d00ffff" +
      "00003200ffff00003700ffff00003700ffff00003900ffff00003900ffff00003d00ffff" +
      "00003d00ffff00003d00ffff00004300ffff00004000ffff00004300ffff0000ffff0000" +
      "0000ffff00000000ffff000000005000ffff00007b166d167c166b167e166d166c160000" +
      "81160000741671166e166d1600006a16771676167e167c1600008116781600007c166b16" +
      "77167b166d16000069166b166b167e167b1669166b168216000000000001010100000000" +
      "000101020000000101010100000000010101010100000000000000000000000000000000",
    lists: [0x0055dd80, 0x0055ddf8, 0x0055de98, 0x0055df00, 0x0055df00,
            0x0055df00],
    accuracy_bonus: [0, 0, 0, 0, 500, 1000, 1500, 2000, 2500, 3000, 4000, 0,
                     -272, 69, -16, 69, 464, 70, 1248, 70, 1328, 70, 912, 70,
                     944, 70, 5456, 67, 5728, 67, 3472, 72, 5120, 72, 592, 70,
                     848, 70, 41, 39, 15, 17, 27, 29, 9, 9, 14, 14, 16, 16, -3,
                     1025, 8, 0],
  };
  // Every civilian type the scene-0 list and these rescues name, each with
  // the card's clips: 0x17C/0x17D/0x17F the rescued figures', 0x180 figure
  // 0's -- its play length past 0x80, the cursor it freezes on -- and
  // 0x18B..0x18D the no-rescue figures'.
  const CLIPS = {
    "380": motion(40, 0, 78), "381": motion(40, 0, 78),
    "383": motion(40, 0, 78), "384": motion(90, 0, 178),
    "395": motion(30), "396": motion(30), "397": motion(30),
  };
  const civ: Record<string, CharacterType> = {};
  for (const t of [0x20, 0x24, 0x26, 0x27, 0x2a, 0x2e, 0x31, 0x32, 0x34, 0x36]) {
    civ[String(t)] = { ...TYPE, type: t, name: `civ 0x${t.toString(16)}`,
                       motions: { ...TYPE.motions, ...CLIPS } };
  }
  const RCHARS = { ...CHARS, types: { ...CHARS.types, ...civ } } as
    unknown as CharactersJson;
  const events = new Events();
  const sounds: number[] = [];
  events.on("sound.play", (d) => sounds.push(d.id));
  const f: ClassFrame = { dt: 1 / 60, rng: new Rng(11), host: NULL_HOST,
                          events };

  /** A fresh game, the tables, and this scene's rescues as the VM left them. */
  const scene = (sc: number, rescued: number[], lives = 2) => {
    ResetGameGlobals();
    ProfileBoot(null);
    EnterPlay();
    SetGameTables(RCHARS);
    SetResultCardTables(RESULT_CARD_RDATA);
    G.g_scene_index = sc;
    G.g_civilians_rescued_by_scene[sc] = rescued.length;
    rescued.forEach((t, i) => { G.g_rescued_char_types[sc * 10 + i] = t; });
    G.g_player_lives = [lives, 0];
    sounds.length = 0;
    // As `SpawnSimpleActors` makes it: a negative key, and its first frame
    // is its update.
    const card = ActorSpawn(-0x5e88, SpawnClass.ResultCard, -1,
                            "simple 0x61", { hp: 0 });
    card.visible = true;
    return card;
  };
  /**
   * One engine frame of the pool, as `GameUpdate` walks it: in order, and a
   * task allocated this frame reached this frame. The camera path's frame is
   * the card's own frame less one -- the `cam_play` the step queues beside it.
   */
  let frame = 0;
  const tick = () => {
    frame += 1;
    G.g_cam_path_frame = frame - 1;
    G.g_screen_sprite_draws = [];
    G.g_view_slot_draws = [];
    for (const o of G.g_object_list) {
      if (!o.visible || o.dead) continue;
      g_class_handlers[o.cls]?.update(o, f);
    }
  };
  const figures = () => G.g_object_list.filter(
    (o): o is ResultCardActor => o.cls === SpawnClass.ResultCard
      && o.card.routine !== ResultCardRoutine.Card);
  const drawn = (slot: number) =>
    G.g_view_slot_draws.filter((d) => d.slot === slot);
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;

  // **Stage 1, five rescued.** Scene 0's table row is 0 0 0 0 0 1 1 1, so
  // five is one life.
  {
    frame = 0;
    const rescued = [0x31, 0x26, 0x20, 0x27, 0x2e];
    const card = scene(0, rescued);
    tick();
    const fig = figures();
    check("five rescues stand five figures, allocated after the card",
          fig.length === 5 && G.g_object_list.indexOf(card)
            < G.g_object_list.indexOf(fig[0]),
          `${fig.length}`);
    check("...each the rescued civilian's own type, in the order rescued",
          fig.map((o) => o.charType).join() === rescued.join()
          && fig.every((o, i) => o.card.figureIndex === i),
          fig.map((o) => `0x${o.charType.toString(16)}`).join(","));
    // `g_result_figure_records` scene 0: x -235, -31.7, -138.4, 81.9, -80;
    // clips 0x17C, 0x17D, 0x17F, 0x17C, 0x17C; yaw 0xC000.
    check("...at scene 0's five places, on the places' clips",
          [-235, -31.7, -138.4, 81.9, -80].every((x, i) => near(fig[i].pos.x,
                                                               Math.fround(x)))
          && fig.map((o) => o.motion).join() === "380,381,383,380,380"
          && fig.every((o) => o.yaw === 0xc000),
          fig.map((o) => `${o.pos.x.toFixed(1)}:${o.motion}`).join(" "));
    // Type 0x20 on clip 0x17F is the one figure lowered: -7.9 - 2.4.
    check("...the type-0x20 figure on 0x17F stood 2.4 lower, the rest not",
          near(fig[2].pos.y, Math.fround(Math.fround(-7.9) - 2.4))
          && near(fig[1].pos.y, Math.fround(-7.9)),
          `${fig[2].pos.y} ${fig[1].pos.y}`);
    check("...out of the shot test, on their update, with a bonus to show",
          fig.every((o) => (o.flags & ActorFlag.NoShotTest) !== 0
                    && o.card.routine === ResultCardRoutine.FigureUpdate
                    && o.card.lifeBonus === 1),
          fig.map((o) => `0x${o.flags.toString(16)}`).join(","));
    // `g_result_figure_attachments`: 0x20 wears 0x26 and 0x27, 0x27 wears
    // 0x2D.
    check("...wearing their type's hair from g_result_figure_attachments",
          fig[2].attachments.join() === "38,39"
          && fig[3].attachments.join() === "45",
          `${fig[2].attachments} / ${fig[3].attachments}`);
    check("the card plays bgm 3 once", sounds.join() === String(0x10000003),
          sounds.map((s) => s.toString(16)).join());
    const tiles = G.g_screen_sprite_draws;
    check("...draws seventeen scr_result tiles at depth 1.1, with the window "
          + "at (128..512, 128..256) left open",
          tiles.length === 17 && tiles[0].id === 0xa2a
          && tiles[16].id === 0xa3a
          && tiles.every((t) => t.depth === Math.fround(1.1))
          && !tiles.some((t) => t.y === 128 && t.x >= 128 && t.x <= 384)
          && tiles.some((t) => t.id === 0xa2f && t.x === 0 && t.y === 128)
          && tiles.some((t) => t.id === 0xa30 && t.x === 512 && t.y === 128),
          tiles.map((t) => `${t.id.toString(16)}@${t.x},${t.y}`).join(" "));
    const r = drawn(0x167b)[0];
    check("...and 'RESCUED x' from 0x0055DFF8, starting at (-0.25, 0.22)",
          r !== undefined && near(r.x, -0.25) && near(r.y, 0.22)
          && r.z === -1 && near(r.scale, 0.07)
          && G.g_view_slot_draws.filter((d) => near(d.y, 0.22)).length === 9,
          JSON.stringify(r));
    check("...but no count before the dwell reaches 0x186",
          !G.g_view_slot_draws.some((d) => near(d.x, 0.25) && near(d.y, 0.22)));

    // The count: frame k draws `min((k - 31) / 20, 5)`.
    const countAt: number[] = [];
    let heldLife = 0;
    let lifeFrame = -1;
    let bonusFrame = -1;
    let livesAt301 = -1;
    const heldCursors: number[] = [];
    while (frame < RESULT_CARD_FRAMES) {
      tick();
      const c = G.g_view_slot_draws.find((d) => near(d.x, 0.25)
                                         && near(d.y, 0.22));
      countAt[frame] = c ? c.slot - 0x165f : -1;
      if (frame === 301) livesAt301 = G.g_player_lives[0];
      if (lifeFrame < 0 && G.g_player_lives[0] !== 2) lifeFrame = frame;
      if (bonusFrame < 0 && drawn(0x1660).some((d) => near(d.x, 0.234))) {
        bonusFrame = frame;
      }
      if (fig[0].card.holdsLife) {
        heldLife += 1;
        heldCursors.push(fig[0].card.cursor);
      }
    }
    check("the rescues count up one a third of a second from frame 31, and "
          + "stop at five",
          countAt[30] === -1 && countAt[31] === 0 && countAt[50] === 0
          && countAt[51] === 1 && countAt[131] === 5 && countAt[400] === 5,
          `30:${countAt[30]} 31:${countAt[31]} 51:${countAt[51]} `
          + `131:${countAt[131]} 400:${countAt[400]}`);
    check("the life comes on frame 302 -- sub 2, once -- and not before",
          livesAt301 === 2 && lifeFrame === 302 && G.g_player_lives[0] === 3,
          `301:${livesAt301} changed at ${lifeFrame} now ${G.g_player_lives[0]}`);
    check("...its digit (0x165F + 1) at (0.234, 0.05) from frame 271",
          bonusFrame === 271, `${bonusFrame}`);
    check("...and 'LIFE BONUS x' from frame 241",
          drawn(0x1674).length === 1, `${drawn(0x1674).length}`);
    // Figure 0 takes clip 0x180 at camera frame 0x104 and holds the life
    // up for cursor 0x1E..0x57 of it; the others keep their clips.
    check("figure 0 alone changes to clip 0x180 at camera frame 0x104",
          fig[0].motion === 0x180 && fig[1].motion === 381,
          `${fig[0].motion} ${fig[1].motion}`);
    check("...holds the life up for cursors 0x1E..0x57, 58 frames",
          heldLife === 0x57 - 0x1e + 1 && heldCursors[0] === 0x1e
          && heldCursors[heldCursors.length - 1] === 0x57,
          `${heldLife} frames, ${heldCursors[0]}..${heldCursors.at(-1)}`);
    check("...and freezes the frame after its cursor reads 0x80",
          fig[0].frozen === 1 && fig[0].card.cursor === 0x81,
          `frozen ${fig[0].frozen} cursor ${fig[0].card.cursor}`);
    check("the card is gone on frame 420 with the flag up; the figures stay",
          card.dead && G.g_script_flags[RESULT_CARD_FLAG] === 1
          && figures().every((o) => !o.dead && o.visible),
          `dead ${card.dead} flag ${G.g_script_flags[RESULT_CARD_FLAG]}`);
  }

  // **No rescue.** The scene's own list, each on 0x18B + rand() % 3, and
  // scene 0's row gives nothing for none.
  {
    frame = 0;
    scene(0, []);
    tick();
    const fig = figures();
    check("no rescue stands the scene's own list: 0x27 0x2E 0x31 0x26 0x20",
          fig.map((o) => o.charType).join() === "39,46,49,38,32",
          fig.map((o) => `0x${o.charType.toString(16)}`).join(","));
    check("...each on 0x18B..0x18D, with no bonus to show",
          fig.every((o) => o.motion >= 0x18b && o.motion <= 0x18d
                    && o.card.lifeBonus === 0)
          && new Set(fig.map((o) => o.motion)).size > 1,
          fig.map((o) => o.motion.toString(16)).join(","));
    while (frame < RESULT_CARD_FRAMES) tick();
    check("...and no life", G.g_player_lives[0] === 2,
          `${G.g_player_lives[0]}`);
  }

  // **More rescues than places.** Scene 3's list has three records; a
  // fourth rescue reads the terminator -- the origin, clip 0 -- as the exe
  // does, not a bound the routine does not have.
  {
    frame = 0;
    scene(3, [0x2a, 0x32, 0x24, 0x2a]);
    tick();
    const fig = figures();
    check("a fourth rescue in scene 3 stands at the list's terminator",
          fig.length === 4 && fig[3].pos.x === 0 && fig[3].pos.z === 0
          && fig[3].motion === 0 && fig[3].charType === 0x2a,
          fig.map((o) => `${o.pos.x}:${o.motion}`).join(" "));
  }

  // **The caps.** Scene 1, nine rescues: row 1 index 7, two lives -- capped
  // at g_max_lives outside Original Mode and at the player's own byte in it.
  {
    frame = 0;
    scene(1, new Array(9).fill(0x34), 4);
    while (frame < 302) tick();
    check("nine rescues in scene 1 read the row's last cell: +2, capped at "
          + "g_max_lives 5",
          G.g_player_lives[0] === 5 && G.g_max_lives === 5,
          `${G.g_player_lives[0]}`);
    frame = 0;
    scene(1, new Array(9).fill(0x34), 2);
    G.g_GameMode = GameMode.Original;
    G.g_original_life_cap[0] = 3;
    while (frame < 302) tick();
    check("...and in Original Mode at g_original_life_cap, 3",
          G.g_player_lives[0] === 3, `${G.g_player_lives[0]}`);
    G.g_GameMode = GameMode.Arcade;
    G.g_original_life_cap[0] = 5;
  }

  // **The score and the accuracy**, drawn for an in-play player.
  {
    G.g_view_slot_draws = [];
    G.g_player_score[0] = 12345;
    ResultCardDrawScore(0, Math.fround(-0.293), Math.fround(-0.17), 0.5);
    const digits = G.g_view_slot_draws.map((d) => d.slot - 0x165f);
    check("12345 is five digits, right-aligned: no 100000s column",
          digits.join() === "1,2,3,4,5"
          && near(G.g_view_slot_draws[0].x, -0.293 + 0.0288)
          && near(G.g_view_slot_draws[4].x, -0.293 + 0.144),
          `${digits} at ${G.g_view_slot_draws.map((d) => d.x.toFixed(4))}`);
    G.g_view_slot_draws = [];
    G.g_player_shot_count[1] = 40;
    G.g_player_hit_count[1] = 30;
    ResultCardDrawAccuracy(1, Math.fround(-0.243), Math.fround(-0.24),
                           Math.fround(0.3744));
    check("30 hits in 40 shots is 75, then 0x1679, at player 1's stride",
          G.g_view_slot_draws.map((d) => d.slot).join()
            === [0x165f + 7, 0x165f + 5, 0x1679].join()
          && near(G.g_view_slot_draws[0].x, 0.3744 - 0.243 + 0.0288),
          G.g_view_slot_draws.map((d) => d.slot.toString(16)).join());
    G.g_view_slot_draws = [];
    G.g_player_shot_count[1] = 0;
    G.g_player_hit_count[1] = 3;
    ResultCardDrawAccuracy(1, 0, 0, 0);
    check("...no shots is written as one, and 300 is drawn as 0",
          G.g_player_shot_count[1] === 1
          && G.g_view_slot_draws.map((d) => d.slot).join()
            === [0x165f, 0x1679].join(),
          G.g_view_slot_draws.map((d) => d.slot.toString(16)).join());
  }

  // **The accuracy bonus** `award_accuracy_bonus` pays, and what
  // `suppress_accuracy_stats` keeps out of it.
  {
    scene(0, []);
    G.g_player_score = [0, 0];
    G.g_player_shot_count = [40, 0];
    G.g_player_hit_count = [30, 0];
    EvtOpAwardAccuracyBonus2B();
    check("75% pays g_accuracy_bonus_table[7], 2000",
          G.g_player_score[0] === 2000, `${G.g_player_score[0]}`);
    G.g_player_shot_count = [19, 0];
    EvtOpAwardAccuracyBonus2B();
    check("...and nineteen shots are not enough to be graded",
          G.g_player_score[0] === 2000, `${G.g_player_score[0]}`);
    // Hits past the counted shots index past the table: 25 in 20 is 125,
    // index 12, the word after it -- -272 -- and the floor at 0.
    G.g_player_score = [100, 0];
    G.g_player_shot_count = [20, 0];
    G.g_player_hit_count = [25, 0];
    EvtOpAwardAccuracyBonus2B();
    check("...and 125% reads past the eleven entries, as the exe does",
          G.g_player_score[0] === 0, `${G.g_player_score[0]}`);
    EvtOpSuppressAccuracyStats2F(1);
    check("suppress_accuracy_stats writes its operand",
          G.g_accuracy_stats_suppressed === 1);
  }

  // **Class 0x62** kills itself on its first frame; before it had a module
  // it stood in the pool for the rest of the stage.
  {
    ResetGameGlobals();
    const t = ActorSpawn(-0x5e78, SpawnClass.ResultCardTally, -1,
                         "simple 0x62", { hp: 0 });
    t.visible = true;
    g_class_handlers[SpawnClass.ResultCardTally]?.update(t, f);
    check("class 0x62 is gone after its first frame", t.dead && !t.visible,
          `dead ${t.dead}`);
  }
  SetResultCardTables(undefined);
  G.g_scene_index = 0;
}
