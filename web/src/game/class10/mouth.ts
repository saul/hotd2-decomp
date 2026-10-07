/**
 * A civilian's mouth.
 *
 * **Nothing in a civilian's motion moves her mouth.** Her face is a model, and
 * the model is swapped: `CivilianInit` (`FUN_0048A3E0`) installs
 * `CivilianDrawBonePart`, the routine at `0x0048D1F0`, as the per-node draw
 * hook (`MOV dword ptr [EAX + 0x1158], 0x48d1f0` at `0x0048A60B`), and for
 * bone 2 that hook submits the bone's record slot **plus a cel** -- a small number
 * read out of one of six lists, `g_civilian_mouth_tables` (`0x0056B950`),
 * stepping once per drawn frame. The `hito_kao_*` faces are laid out for it,
 * twenty consecutive slots a face, and `slot + cel` is the same head with the
 * lower face moved: `0x0C6A` against `0x0C6C`, two cels apart in
 * `hito_kao_gal.bin`, differ in 62 of 149 vertices, every one of them below
 * the eyes and on the front.
 *
 * Her script starts it. Op `0x25` (`CivilianOp.SetMouth`) stores how many
 * frames, which list, and a zero cursor; the shipped streams name lists 0, 1,
 * 2 and 5. List 2 hands over to list 3 when its frames run out, and list 3's
 * last cel holds.
 */
import { T } from "../tables";
import type { Actor } from "../actor";
import type { ClassFrame } from "../registry";
import { CIVILIAN_MOUTH_NONE } from "./state";

/** The bone the hook's `case 2:` arm draws: the head. */
export const CIVILIAN_HEAD_BONE = 2;

/**
 * `CMP dword ptr [...+0xa8], 0x2` in the countdown's zero arm: the list that
 * hands over rather than parking, and the list it hands over to.
 */
export const CIVILIAN_MOUTH_HANDOFF_FROM = 2;
export const CIVILIAN_MOUTH_HANDOFF_TO = 3;

/**
 * `CivilianDrawBonePart` — `FUN_0048D1F0`. The node draw hook, its mouth.
 *
 * ```
 * case 2:
 *   [the head look -- sub+0x8C, not ported]
 *   if (sub+0xA8 != 6) {
 *     cel = (s8)mouth_tables[sub+0xA8].cels[sub+0xA0 % mouth_tables[..].count];
 *     if (sub+0xA4 != 0) {
 *       if (--sub+0xA4 == 0) {
 *         if (sub+0xA8 == 2) { sub+0xA8 = 3; sub+0xA4 = count[3]; sub+0xA0 = 0; }
 *         else sub+0xA0 = count[sub+0xA8] - 1;
 *       } else sub+0xA0 += 1;
 *     }
 *   }
 *   [Original Mode: MatrixScale(1.5, 1.0, 1.5)]
 *   AssetDrawSlot(record + cel);        // or the scene-light twin
 * default:
 *   AssetDrawSlot(record);
 * ```
 *
 * `[proved]` from the listing. The cel is read **before** the step, so the
 * frame op 0x25 lands on draws the list's first cel. The zero arm reads the
 * count through the row it has just written, so list 2 runs list 3 for its
 * own thirteen frames, and every other list parks its cursor on its last cel
 * and holds it until the next op 0x25 -- a 0, the face's own slot, for every
 * list but 3, whose last is 9. `% count` is `IDIV`, but the cursor never goes
 * negative: op 0x25 zeroes it and only this steps it.
 *
 * The record is left alone; the cel is what this draw submits, and that goes
 * to {@link Actor.nodeDrawSlot}. The hook runs once per frame the head is
 * drawn -- `SkeletonEmitNode`'s gate, `ActorRunNodeDrawHooks` -- so the
 * mouth's clock stops while she is not drawn, and the count is in drawn frames.
 *
 * Not here, and none of it the mouth: the head look before it (`sub+0x8C`,
 * see `CivilianOp.SetHeadLook`), the Original Mode scales on bones 2, 5, 8,
 * 12 and 15, which `ActorDrawAttachedParts` has the twin of and which are not
 * ported either, and the choice of `SubmitSlotWithSceneLightArray` over
 * `AssetDrawSlot`, which is the renderer's.
 */
export function CivilianDrawBonePart(obj: Actor, bone: number, slot: number,
                                     _f: ClassFrame): void {
  const sub = obj.civ;
  if (bone !== CIVILIAN_HEAD_BONE || !sub) {
    obj.nodeDrawSlot[bone] = slot;
    return;
  }
  let cel = 0;
  if (sub.mouthTable !== CIVILIAN_MOUTH_NONE) {
    const tables = T.chars?.civilian_mouth_tables ?? [];
    const row = tables[sub.mouthTable] ?? [];
    // [port-only] A bundle older than the tables, or a row the exe would
    // read out of whatever follows `0x0056B980`: the engine has a cel and a
    // count for every value op 0x25 stores, and the shipped operands are
    // 0, 1, 2 and 5. No row is no cel and no step.
    if (row.length) {
      cel = row[sub.mouthFrame % row.length] ?? 0;
      if (sub.mouthFrames !== 0) {
        sub.mouthFrames -= 1;
        if (sub.mouthFrames === 0) {
          if (sub.mouthTable === CIVILIAN_MOUTH_HANDOFF_FROM) {
            sub.mouthTable = CIVILIAN_MOUTH_HANDOFF_TO;
            sub.mouthFrames = tables[sub.mouthTable]?.length ?? 0;
            sub.mouthFrame = 0;
          } else {
            sub.mouthFrame = row.length - 1;
          }
        } else {
          sub.mouthFrame += 1;
        }
      }
    }
  }
  obj.nodeDrawSlot[bone] = slot + cel;
}
