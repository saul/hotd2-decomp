/**
 * The attachment list: the faces and accessories an actor wears.
 *
 * A skinned actor draws one model per skeleton bone, and that is not the whole
 * character. `CivilianInit` (`FUN_0048A3E0`), `ScriptedHumanoidInit`
 * (`FUN_004840D0`) and `SetPiecePropInit` (`FUN_00482CE0`) each take a pointer
 * out of their descriptor tail, park it at `model+0x1170`, and call
 * `ActorBindPartList` (`FUN_00412440`). It is an `s16[]` of ids into
 * `g_actor_attachment_records` (`0x004EC4C0`), terminated by a negative, and
 * the record is `{s32 bone; s32 asset_slot}`.
 *
 * **The ids split at `0x24` and the two halves do opposite things.**
 *
 * * Below it, the record's slot is written over the bone's own drawn slot —
 *   `bone_records[bone].slot = rec.slot`, which is `obj.boneSlot` here. All 36
 *   of those records are bone 2 and every one names a `hito_kao_*` or
 *   `etc_*_kao` model (*kao*, face): a spawn picks one of sixty
 *   interchangeable heads and the skeleton's own is only the default.
 * * At `0x24` and above, nothing is bound. `ActorDrawAttachedParts`
 *   (`FUN_004124F0`) draws the record's slot **as well**, in the matrix of the
 *   record's bone, after every skeleton node. Those 45 records are
 *   `etc_komono_*` (*komono*, small item) on bone 2, bone 1, or bones 12 and
 *   15 — hair and hats, bags and aprons, shoes.
 *
 * **This is where a civilian's hair comes from, and there is nowhere else it
 * could come from.** The head model a civilian's skeleton names is a shell
 * open at the back: `hito_gal`'s is 149 vertices spanning `z 0.18..1.38` with
 * four vertex normals in the whole model pointing backwards, against 15 to 40
 * for every zombie head in the game. The `komono` model on bone 2 is what
 * closes it. Without this the port drew a face on a neck.
 *
 * The list stays a list. The engine keeps the array and walks it every frame
 * rather than resolving it once, so the port keeps the ids on the actor and
 * `render/` resolves them — which is also what makes a snapshot carry the
 * accessories: `resync` re-reads `obj.attachments` and rebuilds.
 */
import type { Actor } from "./actor";
import { T } from "./tables";

/**
 * `ATTACHMENT_REPLACES_BELOW` — `g_actor_attachment_records` ids below this
 * one replace a bone's model; ids at or above it add to it.
 *
 * A literal in both routines and not a property of the table:
 * `ActorBindPartList` compares at `0x0041245B` — `CMP AX, 0x24`, bytes
 * `663d2400`, `JGE` past the bind — and `ActorDrawAttachedParts` at
 * `0x0041264B` with the same four bytes and the opposite jump. The bundle
 * carries the exporter's copy of it; this is the fallback for a stage built
 * before the field existed.
 */
export const ATTACHMENT_REPLACES_BELOW = 0x24;

/**
 * `ActorBindPartList` — `FUN_00412440`.
 *
 * Every id below {@link ATTACHMENT_REPLACES_BELOW} writes its record's slot
 * over the bone's drawn slot. The engine's other half — asking the asset
 * system to load any slot whose id is `0x12` or above — has no counterpart
 * here: the exporter has already put every referenced model in the bundle, so
 * there is nothing to stream.
 *
 * The ids at or above the split are deliberately left alone. They are drawn,
 * not bound, and folding them in here would put an accessory in place of the
 * bone it is meant to sit on.
 *
 * No `GameHost` call, unlike every other `boneSlot` writer in the port. Those
 * run inside a class's `Update`, where the render instance already exists; an
 * `Init` runs before `CharacterLayer.adopt` has bound one, so a host call
 * would go nowhere. `adopt` replays `a.boneSlot` instead, which is the path
 * `resync` already takes — one path rather than two.
 */
export function ActorBindPartList(obj: Actor): void {
  const recs = T.chars?.attachments;
  if (!recs || !obj.attachments.length) return;
  const split = T.chars?.attachment_replaces_below
    ?? ATTACHMENT_REPLACES_BELOW;
  for (const id of obj.attachments) {
    if (id >= split) continue;
    const rec = recs[id];
    if (!rec || rec.bone < 0 || !rec.slot) continue;
    obj.boneSlot[String(rec.bone)] = rec.slot;
  }
}

// The other half of the split -- which ids are *drawn* -- is
// `ActorDrawAttachedParts` (`FUN_004124F0`), and that is a draw routine, so it
// is `render/characters.ts`. It reads the same constant, off the bundle, and
// falls back on the one above; `verify_layers.py`'s `render-drives-the-port`
// is why the filter is not a function here that the renderer calls.
