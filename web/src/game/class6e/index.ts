/**
 * Class 0x6E — **Original Mode's trunk**: the boot of the car, open, and
 * each player taking up to two of the items they have collected.
 *
 * `EvtLoadBlockProgram` (`FUN_0045EBC0`) enters stage 1 block 0 at step 5 in
 * Original Mode, and step 5 is this: shut the letterbox, the static camera on
 * path `0x36`, region 1, `car_org.bin`, `spawn_simple {0x6E, 0}`, and
 * `wait_enemies_present 0` -- which the trunk holds shut by writing
 * `g_enemies_present = 1` on its first frame. It never lets the wait pass on
 * its own: when both players are done, `ItemSelectFinish` points `g_evt_ip`
 * at step 1 -- the arcade game's opening -- and kills itself.
 *
 * ```
 * ItemSelectUpdate           FUN_00488820   the object's routine
 *   ItemSelectBuildList      FUN_004896B0   the list: ids with a count
 *   ItemSelectTrackPlayers   FUN_00489700   a player joining mid-choice
 *   ItemSelectDrawPanels     FUN_00489830   every sprite
 * ItemSelectFinish           FUN_004895C0   the routine once both are done
 *   OriginalItemsApply       FUN_00415FE0   (game/original_mode.ts)
 *   ItemSelectApplyToPlayers FUN_0048A140   lives, magazine, credits, body
 * ```
 *
 * Nothing here was a function in the database: `0x0048881D..0x004895BF` was
 * a code gap of orphaned instructions, reached only through
 * `g_class_handler_pairs`' last row. See `docs/re/original-mode.md`.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { Actor } from "../actor";
import { CamBlockSetAnglesFromLookAt, CamEvalPath7, CameraPoseBlock }
  from "../camera/path";
import { CAMERA_INDEX_VIEW_ANGLES, CameraBlockEye } from "../camera/view";
import { PlaySoundId } from "../class45/rand";
import { CreditsAddToBoth, CreditsSetFreePlay } from "../credits";
import { G, ResetFragmentSubkind1Intact } from "../globals";
import { MatIdentity, MatrixRotateX, MatrixRotateY, MatrixTranslate }
  from "../matrix";
import { OriginalItemsApply, ResetOriginalModeLoadout } from "../original_mode";
import { OriginalWeaponLoadFireParams } from "../player_gun";
import { PlayerState } from "../player_state";
import { registerClass, type ClassFrame, type ClassHandler } from "../registry";
import { ResetDamageRank } from "../run_phase";
import { ScreenIdleDim, ScreenIdleReset } from "../screen_idle";
import {
  DrawScreenSprite, SCREEN_SPRITE_LIT, SetRenderLightColour,
} from "../screen_sprite";
import { SpawnClass } from "../spawn_class";
import { T } from "../tables";
import { DrawSlotInWorld } from "../view_slot";
import type { Vec3 } from "../vec";
import {
  ITEM_SELECT_BGM, ITEM_SELECT_BGM_STOP, ITEM_SELECT_CAM_LAST,
  ITEM_SELECT_CAM_PATH, ITEM_SELECT_LID_FRAME, ITEM_SELECT_LID_HINGE,
  ITEM_SELECT_LID_SLOT, ITEM_SELECT_LID_STEP, ITEM_SELECT_REFUSE_FRAMES,
  ITEM_SELECT_REPEAT_DELAY, ITEM_SELECT_RESUME_STEP, ITEM_SELECT_ROWS,
  ITEM_SELECT_SCROLL_MAX,
  ITEM_SELECT_TRUNK_AT, ITEM_SELECT_TRUNK_SLOT, ITEM_SELECT_TRUNK_YAW,
  ItemSelectAux, ItemSelectPad, ItemSelectRoutine, ItemSelectSound,
  ItemSelectSprite, ItemSelectState, ORIGINAL_ITEM_IDS, makeItemSelectBlock,
  type ItemSelectBlock,
} from "./state";

/** `(s8)`, as the item bytes are compared. */
const s8 = (v: number): number => ((v & 0xff) << 24) >> 24;

/** The block, made on the first frame if the spawn did not. */
function Block(obj: Actor): ItemSelectBlock {
  obj.itemSelect ??= makeItemSelectBlock();
  return obj.itemSelect;
}

/**
 * The camera block `g_camera_index` names, as `CamBlockSetAnglesFromLookAt`
 * is handed its address. `[port-only]` as a function, as `CameraBlockEye` is.
 */
function CameraIndexPose(): CameraPoseBlock {
  return G.g_camera_index === CAMERA_INDEX_VIEW_ANGLES
    ? CameraPoseBlock.Block2 : CameraPoseBlock.Camera;
}

/** `g_camera_block_target` of the block `g_camera_index` names. */
function CameraIndexTarget(): Vec3 {
  return G.g_camera_index === CAMERA_INDEX_VIEW_ANGLES
    ? G.g_camera_block2_target : G.g_camera_block_target;
}

/** `g_camera_block_roll_bams` of the block `g_camera_index` names. */
function CameraIndexRoll(): number {
  return G.g_camera_index === CAMERA_INDEX_VIEW_ANGLES
    ? G.g_camera_block2_roll_bams : G.g_camera_block_roll_bams;
}

/**
 * The trunk and its lid, which `ItemSelectUpdate` and `ItemSelectFinish` each
 * write out:
 *
 * ```
 * MatrixStackPush(0); MatrixTranslate(-572.1, 0.0, 262.4);
 * MatrixRotateY(0x52D8); AssetDrawSlot(0x145F);
 * MatrixTranslate(0.0, 10.321, -14.7259);
 * if (+0x133C > 0x59) MatrixRotateX((+0x133C - 0x5A) * 0x100);
 * AssetDrawSlot(0x1460); MatrixStackPop(1);
 * ```
 *
 * `[port-only]` as a function; the lines are the same in both, at
 * `0x004889FE..` and `0x004895CE..`.
 */
function ItemSelectDrawTrunk(b: ItemSelectBlock): void {
  const m = MatIdentity();
  MatrixTranslate(m, ...ITEM_SELECT_TRUNK_AT);
  MatrixRotateY(m, ITEM_SELECT_TRUNK_YAW);
  DrawSlotInWorld(ITEM_SELECT_TRUNK_SLOT, m);
  MatrixTranslate(m, ...ITEM_SELECT_LID_HINGE);
  if (b.frame > ITEM_SELECT_LID_FRAME - 1) {
    MatrixRotateX(m, (b.frame - ITEM_SELECT_LID_FRAME) * ITEM_SELECT_LID_STEP);
  }
  DrawSlotInWorld(ITEM_SELECT_LID_SLOT, m);
}

/**
 * `ItemSelectUpdate` — `FUN_00488820`, the object's routine until both
 * players are done.
 *
 * * **State 0**, the set-up: the three texbanks and the drain (the
 *   bundle's), `ScreenIdleReset`, `ITEM_SELECT.wav`, **the saved items
 *   copied into `g_original_items_taken`** (`REP MOVSD` of 33 bytes from
 *   `g_profile_original_items`), `g_screen_furniture_flags |= 0x18`,
 *   `0x009A2BBC = 0` (Training's start block; nothing in this mode reads
 *   it), `g_enemies_present = 1`, every word zeroed with each player
 *   choosing if in play, `ResetOriginalModeLoadout`, `ItemSelectBuildList`,
 *   `g_camera_driver_held = 1`, state 1 -- and on into state 1's frame.
 * * **State 1**, the lid: A skips to the path's last frame; the camera block
 *   on path `0x36` at the frame; `TRUNK_16.wav` at frame 90; the frame up
 *   one, and past `0x8B` the camera released and state 2.
 * * **State 2** becomes 3 and falls into the menus the same frame.
 *
 * Every frame: `ScreenIdleDim`, the trunk and its lid, then
 * `ItemSelectTrackPlayers`; from state 3 each choosing player's menu,
 * `ItemSelectDrawPanels`, and -- when neither is choosing any more --
 * `ItemSelectFinish` as the routine.
 */
export function ItemSelectUpdate(obj: Actor, f: ClassFrame): void {
  const b = Block(obj);
  const ev = f.events;
  let camera = false;
  if (b.state === ItemSelectState.Setup) {
    // `TexBankQueueLoad(0x156/0x1B5/0x15F); AssetDrainAllJobs()`: the
    // bundle's (`ITEM_SELECT_SPRITES`, `original_mode.list_sprites`).
    ScreenIdleReset();
    PlaySoundId(ITEM_SELECT_BGM, ev);
    G.g_original_items_taken = [...G.g_profile_original_items];
    G.g_screen_furniture_flags |= 0x18;
    G.g_enemies_present = 1;
    b.activePlayer = G.g_active_player;
    b.frame = 0;
    b.scroll = 0;
    for (let p = 0; p < 2; p++) {
      b.choosing[p] = G.g_player_state[p] === PlayerState.InPlay ? 1 : 0;
      b.playerState[p] = G.g_player_state[p];
      b.onSlots[p] = 0;
      b.row[p] = 0;
      b.slot[p] = 0;
      b.refuseFrames[p] = 0;
      b.refusing[p] = 0;
      b.holdFrames[p] = 0;
      b.repeat[p] = 0;
    }
    ResetOriginalModeLoadout();
    ItemSelectBuildList();
    G.g_camera_driver_held = 1;
    b.state += 1;
    camera = true;
  } else if (b.state === ItemSelectState.LidOpening) {
    camera = true;
  } else if (b.state === ItemSelectState.HandOver) {
    b.state = ItemSelectState.Menu;
  }
  if (camera) {
    if ((G.g_pad_state & ItemSelectPad.A) !== 0
        || (G.g_pad_state & (ItemSelectPad.A << 16)) !== 0) {
      b.frame = ITEM_SELECT_CAM_LAST;
    }
    const idx = G.g_camera_index;
    // The roll it returns is not read: the angles take the block's own.
    CamEvalPath7(ITEM_SELECT_CAM_PATH, b.frame, CameraBlockEye(idx),
                 CameraIndexTarget());
    CamBlockSetAnglesFromLookAt(CameraIndexPose(), CameraIndexTarget(),
                                CameraIndexRoll());
    if (b.frame === ITEM_SELECT_LID_FRAME) PlaySoundId(ItemSelectSound.Trunk, ev);
    const was = b.frame;
    b.frame = was + 1;
    if (was > ITEM_SELECT_CAM_LAST - 1) {
      G.g_camera_driver_held = 0;
      b.state += 1;
    }
  }
  ScreenIdleDim();
  ItemSelectDrawTrunk(b);
  ItemSelectTrackPlayers(obj);
  if (b.state < ItemSelectState.Menu) return;
  if (b.choosing[0] !== 0) ItemSelectPlayerMenu(b, 0, ev);
  if (b.choosing[1] !== 0) ItemSelectPlayerMenu(b, 1, ev);
  ItemSelectDrawPanels(obj);
  if (b.choosing[0] === 0 && b.choosing[1] === 0) {
    b.routine = ItemSelectRoutine.Finish;
  }
}

/**
 * One player's menu, of `ItemSelectUpdate`. `[port-only]` as a function: the
 * routine writes it out twice, player 0's at `0x00488A61..0x0048902F` on the
 * low pad bits, `obj+0x11E`/`+0x11C` and `g_active_player == 0`, player 1's
 * at `0x0048902F..0x00489594` on the same bits shifted up 16 (the second
 * word's up 4), `obj+0x121`/`+0x120` and `g_active_player == 1`. The two
 * copies are otherwise instruction for instruction the same, the
 * "can't combine" sprite's height apart.
 *
 * * While the refusal is up the player does nothing else: it counts to 0x3C
 *   and draws.
 * * RIGHT puts the cursor on the player's slots; LEFT back on the list, at
 *   the first empty slot -- and does nothing with none empty. With two
 *   players each takes one item, so slot 1 is never offered.
 * * In the list: UP and DOWN move the row, scrolling at the ends, repeating
 *   every third frame after 0x28 frames held; A takes the item under the
 *   cursor into the slot the cursor is for. An empty row or a count of 0 is
 *   an error; a second item whose category the first's refuses
 *   (`original_mode.item_compat`) raises the refusal.
 * * On the slots: UP and DOWN step through slot 0, slot 1 and END; A on a
 *   slot puts its item back (slot 1 moving up into an emptied slot 0); START
 *   on END is done.
 */
function ItemSelectPlayerMenu(b: ItemSelectBlock, p: number,
                              ev: Events | undefined): void {
  const pad = (bit: number) => (G.g_pad_state & (bit << (16 * p))) !== 0;
  const aux = (bit: number) => (G.g_pad_aux_state & (bit << (4 * p))) !== 0;
  const held = (bit: number) => (G.g_pad_held & (bit << (16 * p))) !== 0;
  const auxHeld = (bit: number) =>
    (G.g_pad_aux_held & (bit << (4 * p))) !== 0;
  const slots = G.g_original_item_slots[p];
  const alone = G.g_active_player === p;
  const both = G.g_active_player === 2;
  const taken = G.g_original_items_taken;
  const list = G.g_item_select_list;

  if (b.refusing[p] !== 0) {
    const was = b.refuseFrames[p];
    b.refuseFrames[p] = was + 1;
    if (was > ITEM_SELECT_REFUSE_FRAMES) {
      b.refusing[p] = 0;
      b.refuseFrames[p] = 0;
    }
    let y: number;
    if (alone) y = 122;
    else if (both) y = p === 0 ? 64 : 192;
    else return;
    DrawScreenSprite(ItemSelectSprite.CannotCombine, 396, y, 0.9, 1, 1);
    return;
  }

  if (!pad(ItemSelectPad.Right) && !aux(ItemSelectAux.Right)) {
    if (pad(ItemSelectPad.Left) || aux(ItemSelectAux.Left)) {
      if (alone) {
        if (slots[0] === -1) { b.slot[p] = 0; b.onSlots[p] = 0; }
        else if (slots[1] === -1) { b.slot[p] = 1; b.onSlots[p] = 0; }
      } else if (both && slots[0] === -1) {
        b.slot[p] = 0;
        b.onSlots[p] = 0;
      }
    }
  } else {
    b.onSlots[p] = 1;
  }

  let sound = 0;
  if (b.onSlots[p] === 0) {
    if (!held(ItemSelectPad.Up | ItemSelectPad.Down)
        && !auxHeld(ItemSelectAux.Up | ItemSelectAux.Down)) {
      b.holdFrames[p] = 0;
      b.repeat[p] = 0;
    } else {
      const was = b.holdFrames[p];
      b.holdFrames[p] = was + 1;
      if (was > ITEM_SELECT_REPEAT_DELAY) {
        b.holdFrames[p] = 0;
        if (held(ItemSelectPad.Down) || auxHeld(ItemSelectAux.Down)) {
          b.repeat[p] = 1;
        } else if (held(ItemSelectPad.Up) || auxHeld(ItemSelectAux.Up)) {
          b.repeat[p] = 2;
        }
      }
    }
    const tick = G.g_frame_counter % 3 === 1;
    if (pad(ItemSelectPad.Down) || aux(ItemSelectAux.Down)
        || (b.repeat[p] === 1 && tick)) {
      b.row[p] += 1;
      if (b.row[p] > ITEM_SELECT_ROWS - 1) {
        b.row[p] = ITEM_SELECT_ROWS - 1;
        if (b.scroll > ITEM_SELECT_SCROLL_MAX - 1) return;
        b.scroll += 1;
      }
      sound = ItemSelectSound.Cursor;
    } else if (pad(ItemSelectPad.Up) || aux(ItemSelectAux.Up)
               || (b.repeat[p] === 2 && tick)) {
      b.row[p] -= 1;
      if (b.row[p] < 0) {
        b.row[p] = 0;
        if (b.scroll < 1) return;
        b.scroll -= 1;
      }
      sound = ItemSelectSound.Cursor;
    } else {
      if (!pad(ItemSelectPad.A)) return;
      const id = list[b.row[p] + b.scroll];
      if (id !== -1 && s8(taken[id]) > 0) {
        if (b.slot[p] === 0) {
          slots[0] = id;
          PlaySoundId(ItemSelectSound.Ok, ev);
          taken[id] = s8(taken[id] - 1);
          ItemSelectBuildList();
          if (both) {
            b.onSlots[p] = 1;
            b.slot[p] = 2;
          } else {
            b.slot[p] = 1;
          }
          return;
        }
        if (b.slot[p] === 1) {
          const cat = T.originalMode?.item_category;
          const ok = T.originalMode?.item_compat[
            (cat?.[id] ?? 0) * 13 + (cat?.[slots[0]] ?? 0)] ?? 0;
          if (ok !== 0) {
            slots[1] = id;
            PlaySoundId(ItemSelectSound.Ok, ev);
            taken[id] = s8(taken[id] - 1);
            ItemSelectBuildList();
            b.onSlots[p] = 1;
            b.slot[p] = 2;
            return;
          }
          b.refuseFrames[p] = 0;
          b.refusing[p] = 1;
          sound = ItemSelectSound.Error;
        } else {
          return;
        }
      } else {
        sound = ItemSelectSound.Error;
      }
    }
  } else {
    b.holdFrames[p] = 0;
    b.repeat[p] = 0;
    if (pad(ItemSelectPad.Down) || aux(ItemSelectAux.Down)) {
      b.slot[p] += 1;
      if (b.slot[p] === 1 && both) b.slot[p] = 2;
      if (b.slot[p] > 2) b.slot[p] = 0;
      sound = ItemSelectSound.Cursor;
    } else if (pad(ItemSelectPad.Up) || aux(ItemSelectAux.Up)) {
      b.slot[p] -= 1;
      if (b.slot[p] === 1 && both) b.slot[p] = 0;
      if (b.slot[p] < 0) b.slot[p] = 2;
      sound = ItemSelectSound.Cursor;
    } else if (pad(ItemSelectPad.A) && b.slot[p] !== 2) {
      if (b.slot[p] === 0) {
        if (slots[0] !== -1) {
          taken[slots[0]] = s8(taken[slots[0]] + 1);
          ItemSelectBuildList();
          if (both || slots[1] === -1) {
            slots[0] = -1;
            PlaySoundId(ItemSelectSound.Release, ev);
            b.onSlots[p] = 0;
          } else {
            slots[0] = slots[1];
            slots[1] = -1;
            PlaySoundId(ItemSelectSound.Release, ev);
            b.slot[p] = 1;
            b.onSlots[p] = 0;
          }
        }
      } else if (b.slot[p] === 1 && slots[1] !== -1) {
        const id = slots[1];
        slots[1] = -1;
        taken[id] = s8(taken[id] + 1);
        PlaySoundId(ItemSelectSound.Release, ev);
        ItemSelectBuildList();
        b.onSlots[p] = 0;
      }
      return;
    } else if (pad(ItemSelectPad.Start) && b.slot[p] === 2) {
      b.choosing[p] = 0;
      sound = ItemSelectSound.Start;
    } else {
      return;
    }
  }
  PlaySoundId(sound, ev);
}

/**
 * `ItemSelectBuildList` — `FUN_004896B0`. `g_item_select_list` is every id
 * whose `(s8)` count is above 0, in id order, and -1 after them.
 */
export function ItemSelectBuildList(): void {
  let n = 0;
  for (let id = 0; id < ORIGINAL_ITEM_IDS; id++) {
    if (s8(G.g_original_items_taken[id]) > 0) G.g_item_select_list[n++] = id;
  }
  for (let i = n; i < ORIGINAL_ITEM_IDS; i++) G.g_item_select_list[i] = -1;
}

/**
 * `ItemSelectTrackPlayers` — `FUN_00489700`. A player whose state has moved
 * since the last frame is choosing again. And when `g_active_player` has just
 * become 2 -- a second player has come in -- every item either player holds
 * goes back into the trunk (no cap), both players' cursors, slots and refusals
 * are reset, and the list is rebuilt: two players take one item each.
 */
export function ItemSelectTrackPlayers(obj: Actor): void {
  const b = Block(obj);
  for (let p = 0; p < 2; p++) {
    if (b.playerState[p] !== G.g_player_state[p]) {
      b.choosing[p] = 1;
      b.playerState[p] = G.g_player_state[p];
    }
  }
  if (G.g_active_player !== b.activePlayer && G.g_active_player === 2) {
    for (let p = 0; p < 2; p++) {
      const slots = G.g_original_item_slots[p];
      for (let i = 0; i < 2; i++) {
        if (slots[i] !== -1) {
          const id = slots[i];
          slots[i] = -1;
          G.g_original_items_taken[id] = s8(G.g_original_items_taken[id] + 1);
        }
      }
      b.onSlots[p] = 0;
      b.row[p] = 0;
      b.slot[p] = 0;
      b.refuseFrames[p] = 0;
      b.refusing[p] = 0;
    }
    ItemSelectBuildList();
  }
  b.activePlayer = G.g_active_player;
}

/**
 * `ItemSelectDrawPanels` — `FUN_00489830`. The screen, every frame from
 * state 3 and once more in `ItemSelectFinish`: the instructions, "INSIDE THE
 * TRUNK", the list's frame (depth 3, behind the rest), seven rows of labels
 * from the scroll with a count beside any above 1, each choosing player's
 * cursor bar in their colour (red, blue: player 0 at depth 2, player 1 at
 * 2.1), the two scroll marks for 45 of every 60 frames, and the slot panels:
 * one player's two slots and "(UP TO 2)", or both players' one each, their
 * panels grey once they are done. The scene's light colour back at the end.
 */
export function ItemSelectDrawPanels(obj: Actor): void {
  const b = Block(obj);
  const labels = T.originalMode?.list_sprites ?? [];
  const label = (id: number) => labels[id] ?? 0;
  const lit = SCREEN_SPRITE_LIT;
  DrawScreenSprite(ItemSelectSprite.Instructions, 320, 374, 1, 1, 1, 10);
  DrawScreenSprite(ItemSelectSprite.InsideTheTrunk, 126, 24, 1, 1, 1);
  DrawScreenSprite(ItemSelectSprite.ListFrame, 32, 56, 3.0, 1.2, 1.0);
  for (let i = 0, y = 0x52; y < 0x132; i++, y += 0x20) {
    const id = G.g_item_select_list[i + b.scroll];
    if (id === -1 || id === undefined) continue;
    DrawScreenSprite(label(id), 43, y - 4, 1, 1, 1);
    const count = s8(G.g_original_items_taken[id]);
    if (count > 1) {
      const tens = Math.trunc(count / 10);
      DrawScreenSprite(ItemSelectSprite.Times, 261, y + 7, 1.0, 0.7, 0.7);
      if (tens > 0) DrawScreenSprite(ItemSelectSprite.Digit0 + tens, 273, y);
      DrawScreenSprite(ItemSelectSprite.Digit0 + count % 10, 287, y);
    }
  }
  if (b.choosing[0] !== 0 && b.onSlots[0] === 0) {
    SetRenderLightColour(1, 0, 0);
    DrawScreenSprite(ItemSelectSprite.Cursor, 40, b.row[0] * 0x20 + 0x4a,
                     2.0, 1.2, 1.25, lit);
  }
  if (b.choosing[1] !== 0 && b.onSlots[1] === 0) {
    SetRenderLightColour(0, 0, 1);
    DrawScreenSprite(ItemSelectSprite.Cursor, 42, b.row[1] * 0x20 + 0x4c,
                     2.1, 1.2, 1.25, lit);
  }
  if (G.g_frame_counter % 0x3c < 0x2d) {
    SetRenderLightColour(1, 0.9, 0.5);
    if (b.scroll > 0) {
      DrawScreenSprite(ItemSelectSprite.Arrow, 164, 44, 1, 1, 1, lit | 0x20);
    }
    if (b.scroll < ITEM_SELECT_SCROLL_MAX) {
      DrawScreenSprite(ItemSelectSprite.Arrow, 164, 295, 1, 1, 1, lit);
    }
  }
  const active = G.g_active_player;
  // Each panel is drawn lit in 30% grey once its player is done
  // (`SetRenderLightColour(0.3, 0.3, 0.3)` and flags `0x2000`), plain while
  // choosing.
  const shade = (p: number): number => {
    if (b.choosing[p] !== 0) return 0;
    SetRenderLightColour(0.3, 0.3, 0.3);
    return lit;
  };
  let endY: number;
  let flags: number;
  if (active < 0) {
    RestoreSceneLightColour();
    return;
  }
  if (active < 2) {
    DrawScreenSprite(ItemSelectSprite.PanelArrow, 334, 196, 1, 1, 1, 10);
    DrawScreenSprite(ItemSelectSprite.TakeOutItem, 456, 78, 1, 1, 1, 10);
    DrawScreenSprite(ItemSelectSprite.UpTo2, 470, 104, 1, 1, 1, 10);
    flags = shade(active);
    DrawScreenSprite(ItemSelectSprite.Panel1P + active * 2, 352, 120, 3.0,
                     1, 1, flags);
    const slots = G.g_original_item_slots[active];
    if (slots[0] !== -1) DrawScreenSprite(label(slots[0]), 365, 159, 1, 1, 1, flags);
    if (slots[1] !== -1) DrawScreenSprite(label(slots[1]), 365, 185, 1, 1, 1, flags);
    if (b.choosing[active] !== 0 && b.onSlots[active] === 1) {
      const c = T.originalMode?.cursor_colours[active] ?? [1, 1, 1];
      SetRenderLightColour(c[0], c[1], c[2]);
      DrawScreenSprite(ItemSelectSprite.Cursor, 365, b.slot[active] * 0x1a + 0x9f,
                       2.0, 0.97, 1.0, lit);
    }
    endY = 212;
  } else if (active === 2) {
    DrawScreenSprite(ItemSelectSprite.PanelArrow, 333, 142, 1, 1, 1, 10, 0x1000);
    DrawScreenSprite(ItemSelectSprite.PanelArrow, 333, 260, 1, 1, 1, 10, 0xf000);
    DrawScreenSprite(ItemSelectSprite.TakeOutItem, 460, 48, 1, 1, 1, 10);
    flags = shade(0);
    DrawScreenSprite(ItemSelectSprite.Panel1P, 352, 62, 3.0, 1, 1, flags);
    const s0 = G.g_original_item_slots[0][0];
    if (s0 !== -1) DrawScreenSprite(label(s0), 365, 114, 1, 1, 1, flags);
    if (b.choosing[0] !== 0 && b.onSlots[0] === 1) {
      SetRenderLightColour(1, 0, 0);
      const y = b.slot[0] === 0 ? 114 : b.slot[0] === 2 ? 153 : -1;
      if (y >= 0) {
        DrawScreenSprite(ItemSelectSprite.Cursor, 365, y, 2.0, 0.97, 1.0, lit);
      }
    }
    DrawScreenSprite(ItemSelectSprite.End, 526, 154, 1, 1, 1, flags);
    flags = shade(1);
    DrawScreenSprite(ItemSelectSprite.Panel2P, 352, 190, 3.0, 1, 1, flags);
    const s1 = G.g_original_item_slots[1][0];
    if (s1 !== -1) DrawScreenSprite(label(s1), 365, 242, 1, 1, 1, flags);
    if (b.choosing[1] !== 0 && b.onSlots[1] === 1) {
      SetRenderLightColour(0, 0, 1);
      const y = b.slot[1] === 0 ? 242 : b.slot[1] === 2 ? 281 : -1;
      if (y >= 0) {
        DrawScreenSprite(ItemSelectSprite.Cursor, 365, y, 2.0, 0.97, 1.0, lit);
      }
    }
    endY = 282;
  } else {
    RestoreSceneLightColour();
    return;
  }
  DrawScreenSprite(ItemSelectSprite.End, 526, endY, 1, 1, 1, flags);
  RestoreSceneLightColour();
}

/**
 * `SetRenderLightColour(g_scene_light_colour_r, g, b)` -- `0x0048A0A7`, the
 * draw's last line. `[port-only]` as a function.
 */
function RestoreSceneLightColour(): void {
  const c = G.g_scene_light_colour;
  SetRenderLightColour(c[0], c[1], c[2]);
}

/**
 * `ItemSelectFinish` — `FUN_004895C0`, the routine once both players are
 * done, for one frame: the panels and the trunk drawn once more, the music
 * stopped, `g_enemies_present` released, each player's items applied
 * (`OriginalItemsApply`) and put into play (`ItemSelectApplyToPlayers`), and
 * then the script: `g_evt_yield = 0`, `g_evt_step_index = 1` and `g_evt_ip`
 * at the start of step 1 -- the arcade opening -- abandoning the
 * `wait_enemies_present` step 5 was holding on. `RegionUnloadDelta(0x009A2224,
 * 0)` and the word zeroed are the platform's streaming. Then `ActorKill`.
 */
export function ItemSelectFinish(obj: Actor, f: ClassFrame): void {
  const b = Block(obj);
  ItemSelectDrawPanels(obj);
  ItemSelectDrawTrunk(b);
  PlaySoundId(ITEM_SELECT_BGM_STOP, f.events);
  G.g_enemies_present = 0;
  OriginalItemsApply(0, f.rng);
  OriginalItemsApply(1, f.rng);
  ItemSelectApplyToPlayers();
  G.g_evt_step_index = ITEM_SELECT_RESUME_STEP;
  G.g_evt_ip = 0;
  // `ActorKill` (`FUN_004A7040`).
  obj.dead = true;
  obj.visible = false;
}

/**
 * `ItemSelectApplyToPlayers` — `FUN_0048A140`, the trunk's hand-over to the
 * game. The furniture back to "in play" (`& 0xC7 | 2`), `g_enemies_present =
 * 0`, `ResetDamageRank` and the rank four up for every player in play. Then
 * each player in play (state 5): the lives and the lamps shown from
 * `g_original_start_lives`, the magazine full (6 for the unlimited -1), the
 * fire mode's latches (`OriginalWeaponLoadFireParams`), the head-shot combo,
 * shot count and hit count zeroed, the models the weapon kind needs queued
 * (slot `0x109D` for 5, pol `0x3D` for 3, pol `0x41` for 4 -- the bundle's),
 * and a body rebuilt for a costume. Then the credits: free play if either
 * player's bonus is -1, otherwise both bonuses added to both counts. The rest
 * -- the SE entry stub `FUN_0041D440`, the scene's cam files
 * (`FUN_004040A0`), `PreloadScreenAssetList`, the drain -- is loading; then
 * `ResetFragmentSubkind1Intact`. `[proved]` from the listing, including the
 * three zeroing stores at `0x0048A1C2..0x0048A1CA` the database mis-decodes as
 * a `JLE`.
 */
export function ItemSelectApplyToPlayers(): void {
  G.g_screen_furniture_flags = (G.g_screen_furniture_flags & 0xffffffc7) | 2;
  G.g_enemies_present = 0;
  ResetDamageRank();
  G.g_damage_rank = s16(G.g_damage_rank + G.g_players_in_play * 4);
  for (let p = 0; p < 2; p++) {
    if (G.g_player_state[p] !== PlayerState.InPlay) continue;
    G.g_player_lives[p] = G.g_original_start_lives[p];
    G.g_player_lives_shown[p] = G.g_original_start_lives[p];
    const m = G.g_player_magazine_size[p];
    G.g_player_ammo[p] = m !== -1 ? m : 6;
    OriginalWeaponLoadFireParams(p);
    G.g_head_combo_bonus[p] = 0;
    G.g_player_shot_count[p] = 0;
    G.g_player_hit_count[p] = 0;
    // `AssetQueueLoadSlot(0x109D)` / `PolFileQueueLoad(0x3D)` /
    // `PolFileQueueLoad(0x41)`: the bundle carries them.
    if (G.g_original_character[p] !== p) ItemSelectRebuildBody(p);
  }
  if (G.g_original_bonus_credits[0] === -1
      || G.g_original_bonus_credits[1] === -1) {
    CreditsSetFreePlay();
  } else {
    CreditsAddToBoth(G.g_original_bonus_credits[0]);
    CreditsAddToBoth(G.g_original_bonus_credits[1]);
  }
  ResetFragmentSubkind1Intact();
}

/** `(s16)`, as the rank's `ADD word ptr [0x009c8e96], DX` keeps it. */
const s16 = (v: number): number => ((v & 0xffff) << 16) >> 16;

/**
 * The costume arm of `ItemSelectApplyToPlayers`, `0x0048A20B..0x0048A299`:
 * the player's body freed and built again on the character's type -- `c <= 7`
 * as `0x39 + c`, 8 as `0x21`, 9 as `0x34` -- with `FUN_00416570` as its node
 * hook and its hit slot `0xE + p`. `[port-only]` as a function. The port's
 * body is the record the game-over screen draws (`game/player_body.ts`),
 * which has only the type and its scale to rebuild.
 */
function ItemSelectRebuildBody(p: number): void {
  const body = G.g_player_bodies[p];
  if (!body) return;
  const c = G.g_original_character[p];
  if (c <= 7) body.charType = c + 0x39;
  else if (c === 8) body.charType = 0x21;
  else if (c === 9) body.charType = 0x34;
}

/**
 * `[port-only]` -- a finger on the trunk, which the exe never had: its menus
 * are driven by the pad's directions, A and START, and a phone has none of
 * them. `(x, y)` is the tap on the 640x480 screen, y down. As `OptionsTap`
 * does for the options list, it puts the cursor where the tap is -- the
 * words the arrows would have moved -- and returns the pad bits that finish
 * the job on the next tick, through `ItemSelectUpdate`'s own arms:
 *
 * * a row of the list: LEFT and A -- back to the list at the first empty
 *   slot, and take the row's item, so a full pair of slots, an empty row or
 *   a refused pair go the way the pad's would;
 * * a held item: RIGHT and A on its slot, which puts it back;
 * * END: RIGHT and START on it;
 * * a scroll mark: UP or DOWN from the row at that edge, which scrolls;
 * * anywhere while the lid is opening: A, which skips it.
 *
 * The player is the one the trunk is choosing for alone -- player 1 when the
 * second is alone -- and otherwise player 0, whose page this is. 0 when the
 * tap lands on nothing, or the player is done or refused.
 */
export function ItemSelectTap(x: number, y: number): number {
  const obj = G.g_object_list.find(
    (o) => o.cls === SpawnClass.ItemSelect && !o.dead);
  const b = obj?.itemSelect;
  if (!b) return 0;
  const p = G.g_active_player === 1 ? 1 : 0;
  const bits = (v: number) => v << (16 * p);
  if (b.state < ItemSelectState.Menu) return bits(ItemSelectPad.A);
  if (b.choosing[p] === 0 || b.refusing[p] !== 0) return 0;
  const inBox = (x0: number, y0: number, w: number, h: number) =>
    x >= x0 && x < x0 + w && y >= y0 && y < y0 + h;
  // The scroll marks, 32x32 where `ItemSelectDrawPanels` draws them.
  if (b.scroll > 0 && inBox(164, 44, 32, 32)) {
    b.onSlots[p] = 0;
    b.row[p] = 0;
    return bits(ItemSelectPad.Up);
  }
  if (b.scroll < ITEM_SELECT_SCROLL_MAX && inBox(164, 295, 32, 32)) {
    b.onSlots[p] = 0;
    b.row[p] = ITEM_SELECT_ROWS - 1;
    return bits(ItemSelectPad.Down);
  }
  // The list's rows, as the cursor bar covers them: 0x4A + 32 * row down,
  // across the frame (x 32, 256 * 1.2 wide).
  for (let i = 0; i < ITEM_SELECT_ROWS; i++) {
    if (inBox(32, 0x4a + 0x20 * i, 307, 0x20)) {
      b.row[p] = i;
      return bits(ItemSelectPad.Left | ItemSelectPad.A);
    }
  }
  // The panel: each slot's label, then END.
  const both = G.g_active_player === 2;
  const slotYs = both ? (p === 0 ? [114] : [242]) : [159, 185];
  const endY = both ? (p === 0 ? 154 : 282) : 212;
  const slots = G.g_original_item_slots[p];
  for (let k = 0; k < slotYs.length; k++) {
    if (slots[k] !== -1 && inBox(352, slotYs[k], 256, 26)) {
      b.slot[p] = k;
      return bits(ItemSelectPad.Right | ItemSelectPad.A);
    }
  }
  if (inBox(510, endY - 8, 96, 48)) {
    b.slot[p] = 2;
    return bits(ItemSelectPad.Right | ItemSelectPad.Start);
  }
  return 0;
}

/**
 * `[port-only]` -- there is no `Init` in the engine: `EvtOpSpawnSimple0A`
 * allocates and the class's first frame is `ItemSelectUpdate`. The block is
 * made here so the first frame finds it, and `visible` for the reason every
 * `spawn_simple` class gives (`SpawnSimpleActors`).
 */
function ItemSelectSpawn(obj: Actor): void {
  obj.visible = true;
  obj.itemSelect = makeItemSelectBlock();
}

const ItemSelectHandler: ClassHandler = {
  init: ItemSelectSpawn,
  // The object's routine word (`obj+0x00`): the update until both players
  // are done, then the finish for one frame.
  update: (obj, f) => {
    if (Block(obj).routine === ItemSelectRoutine.Finish) {
      ItemSelectFinish(obj, f);
    } else {
      ItemSelectUpdate(obj, f);
    }
  },
  debug: (obj) => {
    const b = obj.itemSelect;
    if (!b) return { summary: "trunk" };
    return {
      summary: obj.dead ? "trunk · closed"
        : `trunk · state ${b.state} · frame ${b.frame}`,
      detail: [0, 1].map((p) => `P${p + 1} ${b.choosing[p] ? "choosing" : "done"}`
        + ` · slots ${G.g_original_item_slots[p].join(",")}`),
      hot: !obj.dead,
    };
  },
};

registerClass(SpawnClass.ItemSelect, ItemSelectHandler);

/** The rng type a test drives `OriginalItemsApply` with. */
export type { Rng };
