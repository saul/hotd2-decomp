/**
 * Class 0x41 constructor 37 -- two `komono_1.bin[114]` objects, one standing
 * on the other, which break when shot; a shot on the lower one while both
 * stand knocks the upper one down, and the second of the pair to break lets
 * out the pair's item.
 *
 * Three descriptors in stage 2, both modes: evt `0x24DC` (blocks 4 and 30,
 * item set 1 of one), `0x812C` (block 14, set 2 of two) and `0x1296C` (blocks
 * 25, 26 and 27, set 2 of one). `komono_1.bin[114]` is the model class 0x41
 * type 4 kind 2 draws, and effect 7 on motion `0x1D5` the break that kind
 * plays -- `[likely]` a crate, from that, and the port names nothing for it.
 *
 * ## The routines `[proved]`
 *
 * `PlaceType37PropPair` (`0x004632F0`), `g_class41_constructors[37]`, from the
 * disassembly (`0x004632F0`..`0x0046341F`):
 *
 * ```c
 * for (i = 0; i < 2; i++) {
 *     obj = ActorAlloc(PropUpdateType37, 0x378); ActorClearGameFields(obj);
 *     obj->+0x11C = placer->+0x11C;  obj->+0x194 = (u8)placer->+0x1F4;
 *     obj->+0x196 = (u8)g_evt_step_index;  obj->+0x197 = 0;
 *     obj->+0x290 = i;  obj->+0x192 = 0;
 *     obj->+0x19C = placer->+0x40 + i * 0.05f;  obj->+0x1A4 = i * 0.05f + placer->+0x48;
 *     obj->+0x1A0 = i * 7.197f + placer->+0x44;  obj->+0x1B8 = placer->+0x44;
 *     obj->+0x1D0 = placer->+0x68;  obj->+0x124 = 6.0f;  obj->+0x28C = 0x17A9;
 *     obj->+0x34 = 0x80000001;  obj->+0x324 = 7;  obj->+0x328 = 0x1D5;
 *     g_type37_pair[i] = obj;
 *     if ((s8)obj->+0x194 > 0)
 *         g_item_set_countdown[obj->+0x194] =
 *             placer->+0x64 > 1 ? rand() % placer->+0x64 + 1 : 1;
 * }
 * g_type37_hits_left = 2;
 * ```
 *
 * `PropUpdateType37` (`0x0046B5F0`), from `0x0046B5F0`..`0x0046BC85`, with
 * both jump tables read (`0x0046BC88`, the release's eight sets; `0x0046BCA8`,
 * the draw's four states): transcribed below. The state is `+0x192`
 * ({@link Type37Phase}). The hit bit is **never cleared** -- the `state != 3`
 * test is the only thing that stops a second hit counting -- and the object
 * stays registered for the shot test through its break effect. Nothing in it
 * touches `g_enemies_alive` or `g_enemies_present`.
 *
 * The item arm reads `g_original_item_life_drops` (`0x009C88AA`), which only
 * an Original Mode item raises; the port fills no item slot, so it stays 0.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import type { BreakablePlacement } from "../../bundle";
import { SpawnPropHitEffectScaled } from "../effects/sprite";
import { GameMode } from "../game_mode";
import { G } from "../globals";
import { T } from "../tables";
import {
  MatrixGetTranslation, MatrixLoadIdentity, MatrixRotateX, MatrixRotateY,
  MatrixRotateZ, MatrixTransformPoint, MatrixTranslate,
} from "../matrix";
import { vec3 } from "../vec";
import { MsvcRand } from "./group";
import { SpawnExtraLifePickup, SpawnGoldenFrog, SpawnScorePickup } from "./items";
import { PropExpireByStepLifetime } from "./lifetime";
import { ActorDespawnProp, BreakablePropAwardHit } from "./prop";
import {
  PropDrawBegin, PropDrawEffect, PropDrawSlot, PropMatrixPush,
} from "./prop_draw";
import {
  BreakableFlag, ItemSet, makeBreakableProp, PropFamily, type BreakableProp,
} from "./prop_state";
import { PropRegisterForShotTest } from "./shot_test";
import { PropWords } from "./words";
import {
  TYPE37_EFFECT, TYPE37_MOTION, TYPE37_SLOT, TYPE37_STRIP_BASE,
  TYPE37_STRIP_END,
} from "./type37_slots";

/**
 * `obj+0x192` as `PropUpdateType37` switches on it -- `MOVSX; DEC; JZ` for the
 * state's own arm, and the jump table at `0x0046BCA8` for its draw.
 * {@link BreakableProp.routinePhase} carries it (`L3`).
 */
export enum Type37Phase {
  /** Standing where it was placed, or where a fall came to rest. */
  Standing = 0,
  /** Knocked off the lower object: falling and turning. */
  Falling = 1,
  /** Down on one hull corner, turning back about it until both angles cross zero. */
  Pivoting = 2,
  /** Shot: the break effect runs, and the object goes at the end of it. */
  Broken = 3,
}

/** `FMUL float [0x004C4C88]` and `[0x0056900C]` -- object 1's offset. */
export const TYPE37_STACK_XZ = Math.fround(0.05);
export const TYPE37_STACK_Y = Math.fround(7.197);
/** `MOV dword [ESI+0x124], 0x40C00000`. */
export const TYPE37_RADIUS = 6.0;
/** `FADD float [0x0055E1C8]` -- the sphere 6.0 above the origin. */
export const TYPE37_SHOT_RISE = 6.0;
/** `PUSH 0x1D16A9`. */
export const SFX_TYPE37_HIT = 0x1d16a9;
/** `PUSH 0x3FC00000` -- `SpawnPropHitEffectScaled`'s size. */
const TYPE37_HIT_EFFECT_SCALE = 1.5;
/** `CMP byte [0x007DCD05], 2` -- the knock needs both still standing. */
export const TYPE37_PAIR_HITS = 2;
/**
 * The knock's spins, `(1 - 2 * (rand() % 2)) * (rand() % 0x81 + 0x80)`
 * (`SHL EAX, 1; MOV EDI, 1; SUB EDI, EAX`).
 */
export const TYPE37_SPIN_SPREAD = 0x81;
export const TYPE37_SPIN_BASE = 0x80;
/** `FSUB float [0x0055CB10]` -- gravity, 0.02722 a frame. */
export const TYPE37_GRAVITY = Math.fround(0.02722);
/** `FMUL float [0x0055D2B0]` -- the hull's s16s are thousandths. */
export const TYPE37_HULL_SCALE = Math.fround(0.001);
/** `FMUL float [0x005690EC]`, `__ftol` -- the landing turns the spin back. */
export const TYPE37_REBOUND = -1.5;
/** `CMP EAX, 0x46` and `ADD EAX, 2` -- the break effect's end and step. */
export const TYPE37_EFFECT_END = 0x46;
export const TYPE37_EFFECT_STEP = 2;
/** `CMP dword [ESI+0x2A0], 2` -- both angles back at zero. */
const TYPE37_SETTLED = 2;

/** The one word of the object the port keeps beside the shared fields. */
export interface Type37Words {
  /** `obj+0x194` (s8) -- the item set; 1 when the Original Mode item forces one. */
  o194: number;
}
const TYPE37_WORDS: Type37Words = { o194: 0 };

/** `(s16)` of a word and `(char)` of a byte. */
const s16 = (v: number): number => (v << 16) >> 16;
const s8 = (v: number): number => (v << 24) >> 24;

/**
 * `PlaceType37PropPair` — `FUN_004632F0`. `g_class41_constructors[37]`.
 *
 * `pl` carries the placer's point (`+0x40..+0x48`), its `+0x68` (`yaw`), its
 * `+0x64` (`set_size`), its `+0x1F4` (`field_1f4`) and its `+0x11C`
 * (`lifetime_evt_steps`) -- everything the constructor reads.
 */
export function PlaceType37PropPair(pl: BreakablePlacement,
                                    rng: Rng): BreakableProp[] {
  const [px, py, pz] = pl.pos ?? [0, 0, 0];
  const out: BreakableProp[] = [];
  for (let i = 0; i < 2; i++) {
    const p = makeBreakableProp(G.g_breakable_next_id++, 0, 0);
    p.family = PropFamily.Type37;
    p.at = pl.at;
    // `+0x11C`, which `PropExpireByStepLifetime` counts against.
    p.lifetime = pl.lifetime_evt_steps;
    const w = PropWords(p, TYPE37_WORDS);
    w.o194 = s8(pl.field_1f4 ?? 0);
    p.lastStepIndex = G.g_evt_step_index;
    p.stepsElapsed = 0;
    p.kind = i;                                   // +0x290
    p.routinePhase = Type37Phase.Standing;
    // `FILD i; FLD ST0; FMUL 0.05f; FLD ST0; FADD x; FSTP; FADD z; FSTP;
    // FMUL 7.197f; FADD y; FSTP`.
    p.x = Math.fround(px + i * TYPE37_STACK_XZ);
    p.z = Math.fround(i * TYPE37_STACK_XZ + pz);
    p.y = Math.fround(i * TYPE37_STACK_Y + py);
    p.restHeight = Math.fround(py);               // +0x1B8
    p.yaw = pl.yaw ?? 0;
    p.hitRadius = TYPE37_RADIUS;
    p.slot = TYPE37_SLOT;
    p.flags = 0x80000000 | BreakableFlag.Live;
    p.effect = TYPE37_EFFECT;
    p.effectVariant = TYPE37_MOTION;
    // `ActorClearGameFields` (`FUN_004A73D0`) zeroed the rest.
    p.storyItem = 0;
    p.removeFlag = 0;
    G.g_type37_pair[i] = p.id;
    const set = s8(w.o194);
    if (set > 0) {
      const n = pl.set_size ?? 0;
      G.g_item_set_countdown[set] = n > 1 ? (MsvcRand(rng) % n) + 1 : 1;
    }
    out.push(p);
  }
  G.g_type37_hits_left = TYPE37_PAIR_HITS;
  return out;
}

/** The knock's spin, both draws in the engine's order. */
function Type37KnockSpin(rng: Rng): number {
  const sign = 1 - rng.int(2) * 2;
  return sign * (rng.int(TYPE37_SPIN_SPREAD) + TYPE37_SPIN_BASE);
}

/**
 * One hull corner, `(s16) * 0.001f` each: `-1` negates the s16 first, as the
 * pivot's draw does (`NEG` before `FILD`).
 */
function Type37HullCorner(pl: readonly number[] | undefined, sign: number):
    [number, number, number] {
  const c = pl ?? [0, 0, 0];
  return [Math.fround(sign * c[0] * TYPE37_HULL_SCALE),
          Math.fround(sign * c[1] * TYPE37_HULL_SCALE),
          Math.fround(sign * c[2] * TYPE37_HULL_SCALE)];
}

/**
 * The object `g_type37_pair[i]` names, if it is still in the pool.
 *
 * `[port-only]` in shape: the engine keeps the pointer and writes through it.
 * The two objects share a lifetime, a step count and a despawn frame, so an
 * entry a live object reads names a live object.
 */
function Type37PairObject(i: number): BreakableProp | undefined {
  const id = G.g_type37_pair[i];
  return id ? G.g_breakable_props.find((q) => q.id === id) : undefined;
}

/**
 * `PropUpdateType37` — `FUN_0046B5F0`. One object, one 60 Hz frame.
 *
 * The corners are `g_type37_hull_points`, which the bundle carries raw
 * (`breakables.type37_hull`). `+0x1A8..+0x1B0` are
 * {@link BreakableProp.restX}/`restY`/`restZ`, the corner a fall came down on;
 * `+0x198` {@link BreakableProp.contact}, which corner; `+0x2A0`
 * {@link BreakableProp.storyItem}, how many of the two angles have crossed
 * zero since; `+0x2A4` {@link BreakableProp.removeFlag}, the landing strip's
 * cursor; `+0x2E4` {@link BreakableProp.drawMatrix}, the pivot's matrix.
 */
export function PropUpdateType37(p: BreakableProp, rng: Rng,
                                 events?: Events): void {
  PropDrawBegin(p);
  // `MOV [EAX*4 + 0x7DCDC4], ESI`, before anything else.
  G.g_type37_pair[s16(p.kind)] = p.id;
  if (PropExpireByStepLifetime(p)) return;
  const w = PropWords(p, TYPE37_WORDS);

  const f = p.flags;
  if ((f & BreakableFlag.Hit) !== 0 && p.routinePhase !== Type37Phase.Broken) {
    BreakablePropAwardHit(f, true, rng);
    p.routinePhase = Type37Phase.Broken;
    events?.emit("sound.play", { id: SFX_TYPE37_HIT });
    // `SpawnPropHitEffectScaled(obj, (obj+0x34 & 2) ? 0 : 1, 1.5f)`
    // (`FUN_004666B0`) at the point `combat/shot.ts` left on the prop.
    if (p.hitAim) {
      SpawnPropHitEffectScaled(p.hitAim.x, p.hitAim.y, p.z,
                               TYPE37_HIT_EFFECT_SCALE);
    }
    if (s16(p.kind) === 0 && s8(G.g_type37_hits_left) === TYPE37_PAIR_HITS) {
      const top = Type37PairObject(1);
      if (top) {
        top.routinePhase = Type37Phase.Falling;
        top.spin = Type37KnockSpin(rng);
        top.rollSpin = Type37KnockSpin(rng);
      }
    }
    G.g_type37_hits_left = s8(G.g_type37_hits_left - 1);
    if (G.g_type37_hits_left === 0) {
      if (G.g_GameMode === GameMode.Original
          && G.g_original_item_life_drops !== 0) {
        w.o194 = ItemSet.ExtraLife;
        SpawnExtraLifePickup(p, events);
      } else if (s8(w.o194) > 0) {
        const set = s8(w.o194);
        const left = s8((G.g_item_set_countdown[set] ?? 0) - 1);
        G.g_item_set_countdown[set] = left;
        if (left === 0) {
          // `MOV ECX, [ESI+0x1B8]; MOV [ESI+0x1A0], ECX`, then the switch.
          p.y = p.restHeight;
          switch (set) {
            case ItemSet.ExtraLife:
              SpawnExtraLifePickup(p, events);
              break;
            case ItemSet.Score2:
            case ItemSet.Score5:
            case ItemSet.Score6:
            case ItemSet.Score7:
            case ItemSet.Score8:
              SpawnScorePickup(p, set, events);
              break;
            case ItemSet.GoldenFrog:
              SpawnGoldenFrog(p, events);
              break;
            default:
              // Set 4, and anything past 8: the table's `0x0046B78B`.
              break;
          }
        }
      }
    }
  }

  switch (s8(p.routinePhase)) {
    case Type37Phase.Broken:
      if (p.effectFrames >= TYPE37_EFFECT_END) {
        ActorDespawnProp(p);
        return;
      }
      p.effectFrames += TYPE37_EFFECT_STEP;
      break;
    case Type37Phase.Pivoting: {
      const spin = p.spin;
      const rollSpin = p.rollSpin;
      const pitch = (p.pitch + spin) | 0;
      const roll = (p.roll + rollSpin) | 0;
      p.pitch = pitch;
      p.roll = roll;
      if ((spin > 0 && pitch > 0) || (spin < 0 && pitch < 0)) {
        p.spin = 0;
        p.pitch = 0;
        p.storyItem += 1;
      }
      if ((rollSpin > 0 && roll > 0) || (rollSpin < 0 && roll < 0)) {
        p.rollSpin = 0;
        p.roll = 0;
        p.storyItem += 1;
      }
      if (p.storyItem === TYPE37_SETTLED) {
        p.routinePhase = Type37Phase.Standing;
        p.removeFlag = 1;
        p.y = p.restHeight;
      }
      break;
    }
    case Type37Phase.Falling: {
      const vy = p.vy - TYPE37_GRAVITY;
      p.pitch = (p.pitch + p.spin) | 0;
      p.vy = Math.fround(vy);
      p.roll = (p.roll + p.rollSpin) | 0;
      p.y = Math.fround(vy + p.y);
      // `MatrixStackPush(0); MatrixLoadIdentity; Ry; Rz; Rx` -- the turn
      // alone, and each corner through it until one is below the floor.
      const m = PropMatrixPush();
      MatrixLoadIdentity(m);
      MatrixRotateY(m, p.yaw);
      MatrixRotateZ(m, p.roll);
      MatrixRotateX(m, p.pitch);
      const hull = T.breakables?.type37_hull ?? [];
      const out = vec3();
      for (let i = 0; i < hull.length; i++) {
        const [cx, cy, cz] = Type37HullCorner(hull[i], 1);
        MatrixTransformPoint(m, vec3(cx, cy, cz), out);
        const oy = Math.fround(out.y);
        if (oy + p.y < p.restHeight) {
          p.routinePhase = Type37Phase.Pivoting;
          p.restY = p.restHeight;
          p.restX = Math.fround(Math.fround(out.x) + p.x);
          p.restZ = Math.fround(Math.fround(out.z) + p.z);
          p.spin = Math.trunc(p.spin * TYPE37_REBOUND);
          p.rollSpin = Math.trunc(p.rollSpin * TYPE37_REBOUND);
          p.storyItem = 0;
          p.contact = i;
          break;
        }
      }
      break;
    }
    default:
      break;
  }

  // The landing strip, fifteen frames at the object's point.
  if (p.removeFlag > 0 && p.removeFlag < TYPE37_STRIP_END) {
    const m = PropMatrixPush();
    MatrixTranslate(m, p.x, p.y, p.z);
    PropDrawSlot(p, m, p.removeFlag + TYPE37_STRIP_BASE);
    p.removeFlag += 1;
  }

  switch (s8(p.routinePhase)) {
    case Type37Phase.Standing:
    case Type37Phase.Falling: {
      const m = PropMatrixPush();
      MatrixTranslate(m, p.x, p.y, p.z);
      MatrixRotateY(m, p.yaw);
      MatrixRotateZ(m, p.roll);
      MatrixRotateX(m, p.pitch);
      PropDrawSlot(p, m, p.slot);
      break;
    }
    case Type37Phase.Pivoting: {
      // `Push; LoadIdentity; T(pivot); Ry; Rz; Rx; T(-corner); MatrixStore
      // (+0x2E4); MatrixGetTranslation -> +0x19C..+0x1A4; Pop`, then the draw
      // under `MatrixMultiply(+0x2E4)` -- a world matrix, the view put back on
      // top of it by the multiply.
      const m = PropMatrixPush();
      MatrixLoadIdentity(m);
      MatrixTranslate(m, p.restX, p.restY, p.restZ);
      MatrixRotateY(m, p.yaw);
      MatrixRotateZ(m, p.roll);
      MatrixRotateX(m, p.pitch);
      const [nx, ny, nz] = Type37HullCorner(
        T.breakables?.type37_hull?.[s8(p.contact)], -1);
      MatrixTranslate(m, nx, ny, nz);
      p.drawMatrix = m.slice(0, 16);
      const t = vec3();
      MatrixGetTranslation(m, t);
      p.x = Math.fround(t.x);
      p.y = Math.fround(t.y);
      p.z = Math.fround(t.z);
      PropDrawSlot(p, p.drawMatrix, p.slot);
      break;
    }
    case Type37Phase.Broken: {
      // `CMP word [EAX*8 + 0x9A37E4], 2` -- `g_motion_slots[0x1D5]` resident.
      // The bundle bakes the motion, so for the port it always is: the answer
      // `PropUpdateType44` and `ScriptFlagEffectUpdate` give their own tests.
      const m = PropMatrixPush();
      MatrixTranslate(m, p.x, p.y, p.z);
      MatrixRotateY(m, p.yaw);
      PropDrawEffect(p, m, rng);
      break;
    }
    default:
      break;
  }

  // The sphere 6.0 above the origin, every frame, whatever the state.
  PropRegisterForShotTest(p, p.x, Math.fround(p.y + TYPE37_SHOT_RISE), p.z);
}
