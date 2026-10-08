/**
 * A scripted humanoid's face: the mouth when it talks and the eyelids when it
 * blinks.
 *
 * Class 0x25 is how a cut scene puts its characters in front of the camera,
 * and they talk. Their mouths are not in a motion:
 * `ScriptedHumanoidBoneDrawHook`, the routine at `0x00485260` -- the node
 * hook `ScriptedHumanoidInit` installs at `model+0x1158` (`0x004841AD`), draws
 * bone 2 as **a cel out of a run of head models** -- a per-character base plus
 * a value from a thirteen-entry table -- whenever `obj+0x1330`, the face mode
 * `op 14` writes, asks it to. The runs are the characters' own files:
 * `player1.bin` (0x39) entries 0..6 talk and 8..14 blink, `player2.bin` (0x3A)
 * the same, `char_adv05.bin` (0x3B) entries 1..7 blink and 8..14 talk,
 * `player4.bin` (0x3C), `player_gold.bin` (0x3D) from entry 6, `hou.bin`
 * (0x3E) from 1, `logan.bin` (0x3F) from 26, and `hito_kao_oyaji.bin`'s
 * entries 60 and 61 for 0x36.
 *
 * The rest of the hook -- the head aim, the extra models on bones 1, 5 and 8
 * (`render/characters/humanoid_hook.ts`) and the Original Mode scales -- is
 * not this file's.
 */
import { G } from "../globals";
import { T } from "../tables";
import type { Actor } from "../actor";
import type { ClassFrame } from "../registry";
import { SpawnClass } from "../spawn_class";

/** `case 2:` -- the head, the one bone the face arms draw. */
export const FACE_BONE = 2;
/** `CMP dword ptr [ESI + 0x1330], 0x2` at `0x0048535F`: talking. */
export const FACE_MODE_TALK = 2;
/** `CMP EAX, 0x1` at `0x004854F9`: blinking. */
export const FACE_MODE_BLINK = 1;

/**
 * Face mode 2's bases, by character type: the `ADD EDX, imm32` after each
 * `MOVSX EDX, byte ptr [EDX + 0x596c80]`, at `0x0048539D` (0x39),
 * `0x004853BE` (0x3A), `0x004853DF` (0x3B), `0x00485400` (0x3C), `0x00485421`
 * (0x3D), `0x00485442` (0x3E) and `0x00485488` (0x3F). Every other type falls
 * to the default arm and draws its record -- and still steps the counter.
 */
export const FACE_TALK_BASES: Readonly<Record<number, number>> = {
  0x39: 0x14b3, 0x3a: 0x14c3, 0x3b: 0x14da, 0x3c: 0x14e1,
  0x3d: 0xd28, 0x3e: 0xc3a, 0x3f: 0x1273,
};
/**
 * Character type 0x36's talking face: `g_class25_face_cels_two`
 * (`MOVSX EDX, byte ptr [EDX + 0x596c90]` at `0x004854C5`) over
 * `ADD EDX, 0x149d` at `0x004854CC`. One type, one row.
 */
export const FACE_TALK_TWO_CHAR = 0x36;
export const FACE_TALK_TWO_BASE = 0x149d;
/**
 * Type 0x3F's arm draws its cel under `MatrixScale(0.9, 0.9, 0.9)` -- three
 * `PUSH 0x3f666666` and `CALL 0x004a9cc0` at `0x00485455`..`0x00485464` --
 * pushed and popped around the one draw (`0x00485450`, `0x00485496`).
 */
export const FACE_TALK_SCALED_CHAR = 0x3f;
const FACE_TALK_3F_SCALE_F = Math.fround(0.9);

/**
 * Face mode 1's bases: `ADD ECX, 0x14bb` at `0x00485567` (0x39), `ADD EAX,
 * 0x14cb` at `0x00485546` (0x3A), `ADD EDX, 0x14d3` at `0x00485537` (0x3B),
 * each over `g_class25_face_cels` -- the same ramp the talking face uses.
 */
export const FACE_BLINK_BASES: Readonly<Record<number, number>> = {
  0x39: 0x14bb, 0x3a: 0x14cb, 0x3b: 0x14d3,
};
/**
 * The blink's cycle: `MOV ECX, 0x96; XOR EDX, EDX; DIV ECX` at
 * `0x004852D1`..`0x004852E6` -- unsigned -- over `g_frame_counter +
 * phase * 20` (`LEA EDX, [EAX + EAX*4]`, `LEA EAX, [EAX + EDX*4]`), and the
 * eyes move while the remainder is below thirteen (`CMP EBP, 0xd; JGE` at
 * `0x00485502`): thirteen frames in every hundred and fifty.
 */
export const FACE_BLINK_PERIOD = 150;
export const FACE_BLINK_PHASE_STEP = 20;
export const FACE_BLINK_FRAMES = 13;
/** `MOV ECX, 0xd; CDQ; IDIV ECX`: the talking face's cycle. */
export const FACE_TALK_CYCLE = 13;

/**
 * `ScriptedHumanoidBoneDrawHook` — `FUN_00485260`, the slot each node is
 * drawn with: the bone's record, except for bone 2 when the face is moving.
 *
 * ```
 * case 2:                                    // after the head aim
 *   blink = (u32)(g_frame_counter + (s8)obj[0x131B] * 20) % 150;
 *   if (obj+0x1330 == 2) {
 *     switch (type) {
 *     case 0x36: slot = 0x149D + face_cels_two[obj+0x1334 % 13]; break;
 *     case 0x39 .. 0x3E: slot = base[type] + face_cels[obj+0x1334 % 13]; break;
 *     case 0x3F: MatrixScale(0.9); AssetDrawSlot(0x1273 + face_cels[n % 13]);
 *                obj+0x1334++; goto after;
 *     default:   slot = record;
 *     }
 *     AssetDrawSlot(slot); obj+0x1334++;
 *   } else if (obj+0x1330 == 1 && blink < 13) {
 *     0x39: 0x14BB + face_cels[blink]; 0x3A: 0x14CB + ...; 0x3B: 0x14D3 + ...;
 *     else: record
 *   } else AssetDrawSlot(record);
 * default:
 *   AssetDrawSlot(record);
 * ```
 *
 * `[proved]` from the listing, `0x004852A4`..`0x00485625`. Two things the
 * pseudocode makes easy to miss: the counter steps on **every** talking draw,
 * the default arm's included, so a type with no face of its own still counts;
 * and the blink indexes the talking ramp with its own phase, not the counter,
 * so a blink is the eyelids closing over six frames and opening over six.
 *
 * What it drew goes to {@link Actor.nodeDrawSlot} and the 0x3F arm's scale to
 * {@link Actor.nodeDrawScale}; the record is left as it is.
 */
export function ScriptedHumanoidBoneDrawHook(obj: Actor, bone: number,
                                             slot: number,
                                             _f: ClassFrame): void {
  obj.nodeDrawSlot[bone] = slot;
  if (bone !== FACE_BONE || obj.cls !== SpawnClass.ScriptedHumanoid) return;
  const t = obj.hum;
  obj.nodeDrawScale[bone] = null;
  const cels = T.chars?.humanoid_face_cels ?? [];
  if (t.faceMode === FACE_MODE_TALK) {
    const n = t.faceFrame % FACE_TALK_CYCLE;
    let drawn = slot;
    if (obj.charType === FACE_TALK_TWO_CHAR) {
      const two = T.chars?.humanoid_face_cels_two ?? [];
      // [port-only] A bundle older than the tables has none; the record is
      // drawn and the counter still steps, as the default arm does.
      if (two.length) drawn = FACE_TALK_TWO_BASE + (two[n] ?? 0);
    } else if (obj.charType in FACE_TALK_BASES && cels.length) {
      drawn = FACE_TALK_BASES[obj.charType] + (cels[n] ?? 0);
      if (obj.charType === FACE_TALK_SCALED_CHAR) {
        obj.nodeDrawScale[bone] = [FACE_TALK_3F_SCALE_F, FACE_TALK_3F_SCALE_F,
                                  FACE_TALK_3F_SCALE_F];
      }
    }
    obj.nodeDrawSlot[bone] = drawn;
    t.faceFrame += 1;
    return;
  }
  if (t.faceMode === FACE_MODE_BLINK) {
    // `DIV`, unsigned: the sum is read as a `u32` before the remainder.
    const blink = ((G.g_frame_counter
      + t.facePhase * FACE_BLINK_PHASE_STEP) >>> 0) % FACE_BLINK_PERIOD;
    if (blink < FACE_BLINK_FRAMES && obj.charType in FACE_BLINK_BASES
        && cels.length) {
      obj.nodeDrawSlot[bone] = FACE_BLINK_BASES[obj.charType]
        + (cels[blink] ?? 0);
    }
  }
}

/**
 * `[port-only]` The head models {@link ScriptedHumanoidBoneDrawHook} can draw
 * for character type `charType`, for the exporter to carry on the type's
 * template: the talking run when the program can run `op 14` mode 2
 * (`talks`), and the blinking run for the types that open blinking.
 * `cels` and `celsTwo` are the two tables, as the bundle carries them.
 */
export function HumanoidFaceSlots(charType: number, talks: boolean,
                                  cels: readonly number[],
                                  celsTwo: readonly number[]): number[] {
  const out = new Set<number>();
  if (talks) {
    if (charType === FACE_TALK_TWO_CHAR) {
      for (const c of celsTwo) out.add(FACE_TALK_TWO_BASE + c);
    } else if (charType in FACE_TALK_BASES) {
      for (const c of cels) out.add(FACE_TALK_BASES[charType] + c);
    }
  }
  if (charType in FACE_BLINK_BASES) {
    for (const c of cels) out.add(FACE_BLINK_BASES[charType] + c);
  }
  return [...out].sort((a, b) => a - b);
}
