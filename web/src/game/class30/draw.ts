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
 * it does that is state is the head aim, and that is why it is ported here.
 */
import { ActorFlag, type Actor } from "../actor";
import type { ClassFrame } from "../registry";
import { SpawnClass } from "../spawn_class";
import { ActorAimHeadAtCamera, HEAD_AIM_BONE } from "./head_aim";

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
 * What is not here, and why:
 *
 * * The draws, which are `render/`'s: the cel arms are
 *   `g_class30_bone_cels`, drawn by `render/characters/cels.ts`, and the turn
 *   is drawn by `render/characters/head_aim.ts`.
 * * The four arms that write state as they draw -- the `0x1CA9` latch and the
 *   `0x1F09` ping-pong in `obj+0x1328`, the `0x1C7C` decay of `obj+0x134C`
 *   and `obj+0x138C`, and the `0x1C6C` fade with its sound -- which are
 *   `ZOMBIE_BONE_CEL_UNPORTED`, each with what it needs.
 *
 * Class 0x18 runs this hook too: `CarriedZombieInit18` opens on
 * `EnemyZombieInit` and `CarriedZombieUpdate18` on `EnemyZombieUpdate`. Every
 * shipped class-0x18 spawn carries `ActorFlag.NoHeadAim`, so none aims.
 */
export function ZombieDrawBonePart(obj: Actor, bone: number, _slot: number,
                                   f: ClassFrame): void {
  if (obj.cls !== SpawnClass.Zombie && obj.cls !== SpawnClass.CarriedZombie) {
    return;
  }
  if (bone === HEAD_AIM_BONE && (obj.flags & ActorFlag.NoHeadAim) === 0) {
    ActorAimHeadAtCamera(obj, obj.zom, f);
  }
}
