/**
 * What the spawn opcode's constructor leaves behind.
 *
 * One engine function, `CivilianInit` (`FUN_0048A3E0`), and the character-type
 * switch inside it that picks which of a held-item record's six attach sets
 * this skin uses.
 */
import { ZombieAux, type Actor } from "../actor";
import type { Rng } from "../../core/rng";
import { G } from "../globals";
import { RegisterEnemySlot } from "../camera/slots";
import { CharacterTypeOf, T } from "../tables";
import { ActorBindPartList } from "../attachments";
import { CivilianRunScript } from "./script";
import { makeCivilianState } from "./state";
import { CivilianWait } from "./ops";

/** `CivilianInit`'s literal for `obj+0x128` — `0x3F800000`. */
const CIVILIAN_BODY_RADIUS = 1;

/**
 * `CivilianInit` — `FUN_0048A3E0`.
 *
 * Allocates the sub-block and seeds it, **runs the script's first block**,
 * and only then the rest -- the hooks, the radii, the camera slot, the
 * counts, the part list, the carrier and the children. That is the engine's
 * order (`CALL CivilianRunScript` at `0x0048A5E2`, ahead of all of it), and
 * it was not the port's, which ran the script last. It matters to anything
 * the first block reads that the rest writes, and to anything the rest reads
 * that the first block writes: op 0x16's ramp is measured from `obj+0x128`,
 * still `ActorClearGameFields`' zero; op 0x1A and op 0x23's mode 2 test the
 * child count at `sub+0x1E`, still 0, so an order or a look at a captor in
 * the first block is dropped; and the `Uncounted` test at `0x0048A705` reads
 * the wait word the first block loaded.
 *
 * The hooks it installs are `CivilianDrawBonePart` (`FUN_0048D1F0`) at
 * `model+0x1158` and `PoseHookGrowAndPushOutOfWorld` at `model+0x115C`
 * (`0x0048A60B`..`0x0048A61B`), both run from `CivilianUpdate` where its
 * draw is.
 */
export function CivilianInit(obj: Actor, rng?: Rng): void {
  // The sub-block's stores, `0x0048A428`..`0x0048A592`: `makeCivilianState`
  // is those values -- `sub+0x0E = 10`, the motion blend, and `sub+0x78 =
  // 1.0`, op 0x16's target, among them -- and the removal cue is the tail's
  // `+0x02`/`+0x04`.
  const sub = makeCivilianState();
  obj.civ = sub;
  const p = T.civilians?.spawns?.[String(obj.at)];
  if (p) {
    sub.removePath = p.removePath;
    sub.removeFrame = p.removeFrame;
  }
  const entry = p ? T.civilians?.entries?.[p.script] : undefined;
  if (entry !== undefined) {
    sub.script = entry;
    CivilianRunScript(obj, entry, 0, undefined, rng);
  }

  // `if (g_scene_lighting) { model+0x1174 = ActorDrawAttachedPartsLit;
  // obj+0x38 |= 8; }` at `0x0048A625`-`0x0048A642`: a civilian spawned while
  // the scene light array is up is drawn by it, body and attachments alike.
  if (G.g_scene_lighting !== 0) obj.flags38 |= ZombieAux.SceneLit;
  sub.attachSet = CivilianAttachSet(obj.charType);
  // `obj+0x124 = g_actor_radius_by_char[type]`, `obj+0x128 = 1.0` at
  // `0x0048A6D6`. The first is the shot sphere and is ten units for every
  // civilian; the second is the radius `PoseHookGrowAndPushOutOfWorld` ramps,
  // which op 0x16 retargets.
  obj.radius = CharacterTypeOf(obj)?.actor_radius ?? 0;
  // **This is the one the captors run into.** `obj+0x128` is the body sphere
  // every actor-versus-actor push measures against, and the port set only the
  // shot sphere above — so `ColiTestSphereAgainstActors`' lazy default filled
  // it from `obj+0x124`, ten units, and a captor walking at its civilian was
  // shoved off it from thirteen and a half units away. Its script wants to be
  // within six. It never arrived, and the civilian was never mauled.
  obj.bodyRadius = CIVILIAN_BODY_RADIUS;
  // `obj+0x121 = 0xFF` at `0x0048A6E2`, then `obj+0x120 = 0xFF` and
  // `RegisterEnemySlot` at `0x0048A6E9`/`0x0048A6F0`: no permit, and a camera
  // slot from the frame she exists until the next fill deals the table.
  obj.attackPermit = -1;
  RegisterEnemySlot(obj);
  if (p) {
    // `CivilianInit` raises it **unconditionally** — the INC at `0x0048A6FE`
    // is on the straight-line fall-through — and this runs exactly when the
    // engine runs it, on the script's spawn opcode. Three paths take it
    // back, one each.
    G.g_civilians_alive += 1;
    // `TEST [sub], 0x8000000` at `0x0048A705`: a civilian whose wait word
    // marks her uncounted is not a civilian the run has seen. The word is
    // the one her first block loaded, since the script ran above.
    // `g_civilians_seen_by_scene` (`0x009C9100`) beside it is not in `G`:
    // nothing the port runs reads it.
    if ((sub.wait & CivilianWait.Uncounted) === 0) {
      G.g_civilians_seen_total = (G.g_civilians_seen_total + 1) & 0xffff;
    }
  }

  // `FUN_0045EBB0(*(u32 *)(tail + 8))` into `model+0x1170`, then
  // `ActorBindPartList` -- the two instructions before the `CivilianUpdate`
  // install. This is what puts the hair on a civilian.
  ActorBindPartList(obj);
  // `if (obj+0x11C != 0) { civ->+0x68 = g_civilian_carrier;
  //   obj[0] = CivilianUpdateOnCarrier; }` at `0x0048A747`-`0x0048A75E`.
  // Seven of the game's 47 civilians ride something; this one does.
  if (obj.hp !== 0) obj.carrierAt = G.g_civilian_carrier;
  // The children, last: `sub+0x1E = tail+0x0C` at `0x0048A775`.
  if (p) {
    sub.childCount = p.children.length;
    sub.children = p.children.map((c) => c.at);
  }
}

/**
 * `sub+0x82` — which of a held-item record's six attach sets this character
 * uses, from `CivilianInit`'s own switch on the character type.
 *
 * One record therefore serves every skin that can hold it, with a different
 * offset and scale in a child's hand than in an old man's.
 *
 * [port-only] No exe function behind the name: it is the switch inside
 * `CivilianInit` (`FUN_0048A3E0`), lifted out because it is a table of
 * character types and reads as one.
 */
export function CivilianAttachSet(charType: number): number {
  switch (charType) {
    case 0x20: case 0x23:
      return 0;
    case 0x24: case 0x25: case 0x31: case 0x32: case 0x33:
      return 4;
    case 0x26: case 0x29: case 0x2a: case 0x2b: case 0x2c: case 0x2d:
    case 0x38:
      return 1;
    case 0x27: case 0x28:
      return 2;
    case 0x2e: case 0x2f: case 0x30:
      return 3;
    default:
      return 5;
  }
}
