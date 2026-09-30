/**
 * Class 0x30's node draw hook: what a zombie's draw writes back.
 *
 * `EnemyZombieInit` (`FUN_00452DA0`) installs `ZombieDrawBonePart` at
 * `obj+0x12EC` (`model+0x1158`), and `SkeletonEmitNode` (`FUN_004114C0`)
 * calls it for every node that has a slot while `MotionFlag.Drawn` is up and
 * the node is not vetoed. `ZombieAdvanceMotion` (`FUN_00454860`) is where that
 * walk happens: `EnemyZombieUpdate` (`FUN_004533F0`) calls it after the state
 * and the integration.
 *
 * Nearly all of the hook is drawing -- the cels, which are
 * `render/characters/cels.ts` over the table in `class30/bonecels.ts`. What
 * it does that is state is the head aim, the two fade clocks, and which draw
 * each node gets, and that is why it is ported here.
 */
import { ActorFlag, ZombieFlag2, type Actor } from "../actor";
import { G } from "../globals";
import type { ClassFrame } from "../registry";
import { SpawnClass } from "../spawn_class";
import { ActorAimHeadAtCamera, HEAD_AIM_BONE } from "./head_aim";

/**
 * `znele`'s node, whose draw runs its fade-in: `0x1C6C` is index `0x7F` of
 * the byte map at `0x00453A04` (`slot - 0x1BED`), which holds 1, and entry 1
 * of the jump table at `0x004539F4` is `0x00453665`.
 */
const FADE_IN_SLOT = 0x1c6c;
/** The twin's node, whose draw runs its fade-out: `CMP EAX, 0x1c7c` / `JZ`. */
const FADE_OUT_SLOT = 0x1c7c;
/** `FSUB [0x004C4380]` = 1.0: one off the wait per draw of the node. */
const FADE_DELAY_STEP = 1.0;
/**
 * `PUSH 0x2225a9` at `0x004536DA`: `STAGE6_SE` `MONITOR3`, the sound
 * `ThrowerStateBlinkInThreeHops` ends on too.
 */
const SFX_FADE_IN_DONE = 0x2225a9;
/**
 * `AND AH, 0x7e` at `0x004536D7`, on `obj+0x34`: the fade-in's end gives
 * back the shot test and takes away the immunity that
 * `EnemyZombieInitByCharType` raised.
 */
const FADE_IN_DONE_CLEARS = ActorFlag.NoShotTest | ActorFlag.ShotImmune;
/** `OR EBX, 0x60000000` at `0x004536D1`: ...and both pushes. */
const FADE_IN_DONE_PUSH = ZombieFlag2.CollideWorld | ZombieFlag2.CollideActors;

/** The two classes that run this hook, both with the zombie's tail. */
type HookedZombie = Extract<Actor,
  { cls: SpawnClass.Zombie | SpawnClass.CarriedZombie }>;

/**
 * `ZombieDrawBonePart` — `FUN_004534A0`. One node of a zombie's skeleton,
 * drawn; the state it writes.
 *
 * ```
 * 004534d1  CALL MatrixStackPush(0)
 * 004534d9  CMP  word ptr [EDI + 0x14], 0x2      ; bone 2
 * 004534e0  TEST dword ptr [ESI + 0x34], 0x40000 ; ActorFlag.NoHeadAim
 * 004534ea  CALL 0x00453be0                      ; the aim, before the switch
 * 004534f2  MOV  EAX, [EBP]                      ; record[bone].slot
 * ```
 *
 * `[proved]`. The aim runs **first**, on the matrix the hook has just pushed,
 * so whatever the switch then draws for bone 2 -- its own model, a gore swap,
 * a cel -- is drawn turned.
 *
 * Then the switch on the slot. Two arms move `obj+0x138C` before they draw,
 * both on `obj+0x134C` counted down one per draw of their node:
 *
 * * **`0x1C6C`, `znele`'s fade-in** (`0x00453665`). Only while `obj+0x1368`
 *   bit `0x20` is up: the wait drops by 1.0, and once it is below zero the
 *   alpha rises by `obj+0x1388`; when it passes 1.0 -- or at once, if
 *   `obj+0x34` has `0x10000000` -- the arm ends the fade: the bit comes down,
 *   the alpha is pinned at 1.0, both pushes come back (`obj+0x136C |=
 *   0x60000000`), `obj+0x34` loses `0x8100`, and `PlaySoundId(0x2225A9)`.
 * * **`0x1C7C`, the twin's fade-out** (`0x00453708`), with no bit test at
 *   all: the wait drops, and once it is below zero the alpha falls by
 *   `obj+0x1388`, clamped at 0. `ZombieTwinFollowHost` (`FUN_00453290`)
 *   despawns the twin the frame it reads 0.
 *
 * Every arm ends in `ZombieSubmitSlotByLighting`, and which draw that is goes
 * into {@link Actor.nodeDrawAlpha}: after the arm, so the node that runs a
 * fade is drawn at the alpha it has just made.
 *
 * What is not here, and why:
 *
 * * The draws, which are `render/`'s: the cel arms are
 *   `g_class30_bone_cels`, drawn by `render/characters/cels.ts`, and the turn
 *   is drawn by `render/characters/head_aim.ts`.
 * * The two arms that write a cel latch as they draw -- the `0x1CA9` latch
 *   and the `0x1F09` ping-pong in `obj+0x1328` -- which are
 *   `ZOMBIE_BONE_CEL_UNPORTED`, each with what it needs.
 *
 * Class 0x18 runs this hook too: `CarriedZombieInit18` opens on
 * `EnemyZombieInit` and `CarriedZombieUpdate18` on `EnemyZombieUpdate`. Every
 * shipped class-0x18 spawn carries `ActorFlag.NoHeadAim`, so none aims.
 */
export function ZombieDrawBonePart(obj: Actor, bone: number, slot: number,
                                   f: ClassFrame): void {
  if (obj.cls !== SpawnClass.Zombie && obj.cls !== SpawnClass.CarriedZombie) {
    return;
  }
  if (bone === HEAD_AIM_BONE && (obj.flags & ActorFlag.NoHeadAim) === 0) {
    ActorAimHeadAtCamera(obj, obj.zom, f);
  }
  if (slot === FADE_IN_SLOT) ZombieFadeInNode(obj, f);
  else if (slot === FADE_OUT_SLOT) ZombieFadeOutNode(obj);
  obj.nodeDrawAlpha[bone] = ZombieSubmitSlotByLighting(obj);
}

/** `CMP word ptr [node+0x14], 2` -- the one bone ROTTEN MEAT enlarges. */
export const ENLARGED_HEAD_BONE = 2;
/** `MatrixScale(2.0, 2.0, 2.0)`, and `(1.8, 1.8, 1.0)` for character type 0xE. */
export const ENLARGED_HEAD_SCALE: [number, number, number] = [2.0, 2.0, 2.0];
export const ENLARGED_HEAD_SCALE_0E: [number, number, number] =
  [Math.fround(1.8), Math.fround(1.8), 1.0];
/** `CMP word ptr [g_cur_actor + 0x1F4], 0xE` -- the type with its own scale. */
export const ENLARGED_HEAD_CHAR_TYPE_0E = 0xe;

/**
 * `ZombieDrawWithEnlargedHead` — `FUN_00453B50`. The `obj+0x12EC` hook
 * `EnemyZombieInit` installs in Original Mode while ROTTEN MEAT's
 * `g_original_item_big_head` is 1.
 *
 * ```c
 * if (g_original_item_big_head != 1) return;          // draws nothing at all
 * if (node->bone == 2) {
 *     MatrixStackPush(0);
 *     type == 0xE ? MatrixScale(1.8, 1.8, 1.0) : MatrixScale(2, 2, 2);
 *     NoOpStub(scale);
 *     ZombieDrawBonePart(node);
 *     MatrixStackPop(1);
 * } else ZombieDrawBonePart(node);
 * ```
 *
 * The scale is recorded in {@link Actor.nodeDrawScale} for the renderer,
 * which applies it to bone 2's own draw under the head's turn: the turn is
 * `ZombieDrawBonePart`'s, inside the push. The flag cannot fall while a
 * zombie holding this hook lives -- only `ResetOriginalModeLoadout` clears
 * it, as a run starts -- so the first arm is the engine's and unreachable.
 */
export function ZombieDrawWithEnlargedHead(obj: Actor, bone: number,
                                           slot: number, f: ClassFrame): void {
  if (G.g_original_item_big_head !== 1) return;
  if (bone === ENLARGED_HEAD_BONE) {
    obj.nodeDrawScale[bone] = obj.charType === ENLARGED_HEAD_CHAR_TYPE_0E
      ? ENLARGED_HEAD_SCALE_0E : ENLARGED_HEAD_SCALE;
    ZombieDrawBonePart(obj, bone, slot, f);
    return;
  }
  ZombieDrawBonePart(obj, bone, slot, f);
}

/**
 * `ZombieDrawBonePart`'s `0x1C6C` arm, `0x00453665..0x00453703`:
 *
 * ```
 * 00453665  MOV  ECX, [ESI + 0x1368] / XOR EDX, EDX
 * 0045366d  TEST CL, 0x20 / JZ draw
 * 00453676  FLD  [ESI + 0x134c] / FSUB 1.0 / FST [ESI + 0x134c]
 * 00453688  FCOMP 0.0 / TEST AH, 0x1 / JZ check     ; not below zero: no step
 * 00453695  FLD  [ESI + 0x1388] / FADD [ESI + 0x138c] / FST [ESI + 0x138c]
 * 004536a7  FCOMP 1.0 / TEST AH, 0x41 / JNZ check    ; not above 1.0: go on
 * 004536b4  MOV  EDX, 0x1
 * 004536b9  TEST [ESI + 0x34], 0x10000000 / JNZ done
 * 004536c3  CMP  EDX, 0x1 / JNZ draw
 * 004536c8  done: 0x1368 &= ~0x20, 0x136C |= 0x60000000, 0x34 &= ~0x8100,
 *           0x138C = 1.0, PlaySoundId(0x2225A9)
 * ```
 *
 * `[proved]`. The sums are stored as f32 (`FST`), so the port rounds them.
 * [port-only] as a function: the arm is inline in the hook.
 */
function ZombieFadeInNode(obj: HookedZombie, f: ClassFrame): void {
  const z = obj.zom;
  if (!z.fadeDraw) return;
  let done = false;
  z.fadeDelay = Math.fround(z.fadeDelay - FADE_DELAY_STEP);
  if (z.fadeDelay < 0) {
    obj.alpha = Math.fround(z.fadeStep + obj.alpha);
    if (obj.alpha > 1.0) done = true;
  }
  if ((obj.flags & ActorFlag.Committed) === 0 && !done) return;
  z.fadeDraw = false;
  obj.flags2 |= FADE_IN_DONE_PUSH;
  obj.flags &= ~FADE_IN_DONE_CLEARS;
  obj.alpha = 1.0;
  f.events?.emit("sound.play", { id: SFX_FADE_IN_DONE });
}

/**
 * `ZombieDrawBonePart`'s `0x1C7C` arm, `0x00453708..0x00453750`:
 *
 * ```
 * 00453708  FLD  [ESI + 0x134c] / FSUB 1.0 / FST [ESI + 0x134c]
 * 0045371a  FCOMP 0.0 / TEST AH, 0x1 / JZ draw        ; not below zero
 * 00453727  FLD  [ESI + 0x138c] / FSUB [ESI + 0x1388] / FST [ESI + 0x138c]
 * 00453739  FCOMP 0.0 / TEST AH, 0x1 / JZ draw
 * 00453746  MOV  [ESI + 0x138c], 0x0
 * ```
 *
 * `[proved]`. No test of `obj+0x1368` bit `0x20`: the node runs its clock
 * whether or not the actor is drawn faded. [port-only] as a function.
 */
function ZombieFadeOutNode(obj: HookedZombie): void {
  const z = obj.zom;
  z.fadeDelay = Math.fround(z.fadeDelay - FADE_DELAY_STEP);
  if (!(z.fadeDelay < 0)) return;
  obj.alpha = Math.fround(obj.alpha - z.fadeStep);
  if (obj.alpha < 0) obj.alpha = 0;
}

/**
 * `ZombieSubmitSlotByLighting` — `FUN_00453AE0`. Which of three draws a
 * class-0x30 node gets, returned as {@link Actor.nodeDrawAlpha} holds it:
 *
 * ```
 * 00453ae5  MOV  CL, 0x20
 * 00453ae7  TEST byte ptr [EAX + 0x136c], CL / JZ 00453b07
 * 00453aef  MOV  EDX, [0x009a2bb4] / TEST EDX, EDX / JZ 00453b07
 * 00453afe  CALL SubmitSlotWithSceneLightArray    ; lit, never faded
 * 00453b07  TEST byte ptr [EAX + 0x1368], CL / JZ 00453b24
 * 00453b1b  CALL AssetDrawSlotWithAlpha(slot, [EAX + 0x138c])
 * 00453b29  CALL AssetDrawSlot(slot)
 * ```
 *
 * `[proved]`. So the light array wins: a zombie whose descriptor asked for
 * it (`obj+0x136C` bit `0x20`, {@link ZombieFlag2.DrawVariantSource}) is
 * drawn solid while `g_scene_lighting` is up, fade or no fade. Whether the
 * light array is on for the actor as a whole is `ActorDrawsSceneLit` in
 * `game/scene_lights.ts`, which the renderer asks; this answers only the
 * alpha.
 */
export function ZombieSubmitSlotByLighting(obj: HookedZombie): number | null {
  if ((obj.flags2 & ZombieFlag2.DrawVariantSource) !== 0
      && G.g_scene_lighting !== 0) {
    return null;
  }
  return obj.zom.fadeDraw ? obj.alpha : null;
}
