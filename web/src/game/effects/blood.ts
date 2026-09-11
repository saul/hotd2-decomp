/**
 * Blood, and the one thing about it that surprises everybody: **it is stuck
 * to the bone.**
 *
 * `SpawnBloodSpray` (`FUN_00407310`) allocates an object holding four fields —
 * the actor, the bone index, a cel counter and a severity — and nothing else.
 * `DrawBloodSpray` (`FUN_00407230`) then reads the bone's hit sphere out of
 * the actor **every frame** and draws asset slot `0x3A + cel` there. So the
 * spray follows a running zombie's shoulder for its whole twenty-five frames,
 * and the port cannot hold a position for it without changing what it does.
 *
 * ## Where exactly
 *
 * The bone records live at `obj + 0x20C + bone * 0x90`, and
 * `ShotTestBoneSphere` (`FUN_004047D0`) proves what the fields are: it tests
 * `obj + bone * 0x90 + 0x274/+0x278/+0x27C` as a sphere centre against the
 * radius at `+0x284`, in **camera space** — `FUN_004107E0` poses them and
 * `RayTestSphere` (`FUN_004062A0`) measures with the camera at the origin.
 *
 * `DrawBloodSpray` draws at that same centre with `z + radius`: the near face
 * of the hit sphere, the side the shot came from, so the spray sits on the
 * surface of the limb rather than inside it. The **centre** is what
 * `MarkActorShot` (`FUN_00404DB0`) copies into the candidate record and what
 * `ActorShotFeedback` hands the ricochet sprite; only the blood adds the
 * radius.
 *
 * There is no ray-versus-surface intersection anywhere in this: the engine
 * never computes where the bullet actually met the model, for an actor or for
 * a prop. What it has is the sphere it hit, and it draws on the front of it.
 *
 * ## Two routines, one shape
 *
 * `SpawnBoneHitSprite` (`FUN_00407200`) and `BoneHitSpriteDrawAndTick`
 * (`FUN_00407120`) are a byte-for-byte copy of the pair above with the
 * severity multiply left out — the exe carries both — so they are two
 * functions here as well, over one record with a severity of 1.
 */
import { G } from "../globals";
import { vec3, type Vec3 } from "../vec";

/** `+0x44` dies past this, so the flipbook is twenty-five frames. */
export const BLOOD_LAST_CEL = 0x18;
/** `AssetDrawSlot(cel + 0x3A)` — `pol/common.bin` entries 0 to 24. */
export const BLOOD_FIRST_SLOT = 0x3a;

/**
 * The depth law both routines share: full size past twenty units, and a
 * shrinking sprite inside that so a hit at arm's length is not a screenful.
 */
export const BLOOD_DEPTH_FAR = -20.0;
export const BLOOD_DEPTH_RATE = -0.037500095;
export const BLOOD_DEPTH_BASE = 0.25;
/** ...and then a flat multiplier, which halves again with captions on. */
export const BLOOD_SCALE = 0.3;
/** `g_wCaptionMode` — 0x009C911E. 1 is the captioned build. */
export const BLOOD_SCALE_CAPTIONED = 0.15;

/**
 * One live spray. Four fields, because the engine's object has four.
 *
 * `[port-only]` `id`: the engine's identity is the task pointer.
 */
export interface BloodSpray {
  id: number;
  /** `+0x34` — the actor, by the spawn address the port identifies it with. */
  at: number;
  /** `+0x48`. */
  bone: number;
  /** `+0x44` — the cel, and the slot cursor: the draw is `0x3A + cel`. */
  cel: number;
  /** `+0x4C` — `ActorShotFeedback`'s severity. 1 for the bone-hit sprite. */
  severity: number;
}

/**
 * `SpawnBloodSpray` — `FUN_00407310`.
 *
 * `severity` is the caller's: `ActorShotFeedback` passes 0.75 for a damaged
 * part, 0.5 for plain damage and 1.0 for a severed one.
 */
export function SpawnBloodSpray(at: number, bone: number,
                                severity: number): void {
  G.g_blood_sprays.push({ id: G.g_blood_spray_seq++, at, bone, cel: 0,
                          severity });
}

/**
 * `SpawnBoneHitSprite` — `FUN_00407200`.
 *
 * The same object with no severity field, which the draw then treats as one.
 * `ResolveHit` fires it beside the severed head, and `OneHitTargetUpdate`
 * fires one per hit bone.
 */
export function SpawnBoneHitSprite(at: number, bone: number): void {
  G.g_blood_sprays.push({ id: G.g_blood_spray_seq++, at, bone, cel: 0,
                          severity: 1 });
}

/**
 * `[port-only]` — the state half of `DrawBloodSpray` (`FUN_00407230`) and
 * `BoneHitSpriteDrawAndTick` (`FUN_00407120`).
 *
 * [diverges] in shape, not in behaviour: both engine routines draw and then
 * step in one function, because a task is its own renderer. `game/` may not
 * draw, so the cel step is here and `render/effects.ts` reads the bone.
 *
 * Returns false once the cel has passed the last one.
 */
export function BloodSprayTick(b: BloodSpray): boolean {
  b.cel += 1;
  return b.cel <= BLOOD_LAST_CEL;
}

/** `[port-only]` — the pool step the engine gets from its task list. */
export function BloodSpraysTick(): void {
  const live = G.g_blood_sprays;
  if (!live.length) return;
  G.g_blood_sprays = live.filter((b) => BloodSprayTick(b));
}

/**
 * ...and the third of them: the same flipbook at a **point** rather than on a
 * bone.
 *
 * `SpawnBloodSprayAtPoint` (`FUN_00430C50`) allocates a 0x98-byte object
 * running `BloodSprayAtPointDrawAndTick` (`FUN_00430BD0`), which draws
 * `AssetDrawSlot(eff+0x54)` under `MatrixLoadIdentity` and frees itself once
 * that cursor passes `0x52`. `eff+0x54` starts at `0x3A` — **the same
 * twenty-five cels of `pol/common.bin` the bone-stuck spray uses**, which is
 * what says this is blood and not some other sprite: it is
 * {@link SpawnBloodSpray} with a fixed point instead of a bone.
 *
 * Five routines call it, and the ones the port already has are
 * `OwlUpdateAndResolveShot` (`FUN_004460C0`) — class 0x43's death, which does
 * not spawn one today — and `BodyCreatureUpdate` (`FUN_0043E880`).
 *
 * The point is whatever the caller's `obj+0x70..0x78` holds, which is the
 * shot-test sphere's centre, and that is **camera space** — the same space
 * `MatrixLoadIdentity` draws in and the same one `render/effects.ts` already
 * puts the bone spray's sprite in.
 */
export interface PointBloodSpray {
  /** `[port-only]` — a stable key for the renderer. */
  id: number;
  /** `eff+0x38/0x3C/0x40`, in camera space. */
  pos: Vec3;
  /** `eff+0x54` — the asset slot, which **is** the cursor. */
  slot: number;
}

/** `eff+0x54 = 0x3A` — the first cel, and `0x52` is the last. */
export const POINT_BLOOD_LAST_SLOT = 0x52;
/**
 * `MOV dword ptr [ESP], 0x3E99999A`, or `0x3E19999A` when `g_wCaptionMode`
 * is 1 — the scale, which halves with captions on exactly as
 * {@link BLOOD_SCALE} does.
 */
export const POINT_BLOOD_SCALE = 0.3;
export const POINT_BLOOD_SCALE_CAPTIONED = 0.15;

/** `SpawnBloodSprayAtPoint` — `FUN_00430C50`. */
export function SpawnBloodSprayAtPoint(at: Vec3): void {
  G.g_point_blood_sprays.push({
    id: G.g_point_blood_spray_seq++,
    pos: vec3(at.x, at.y, at.z),
    slot: BLOOD_FIRST_SLOT,
  });
}

/**
 * `[port-only]` — the state half of `BloodSprayAtPointDrawAndTick`
 * (`FUN_00430BD0`), for the same reason {@link BloodSprayTick} is one: a task
 * is its own renderer and `game/` may not draw.
 *
 * The engine draws the slot it is **about** to step, and frees only once the
 * stepped value passes the last one, so the last cel is drawn.
 */
export function PointBloodSpraysTick(): void {
  const live = G.g_point_blood_sprays;
  if (!live.length) return;
  G.g_point_blood_sprays = live.filter((b) => {
    b.slot += 1;
    return b.slot <= POINT_BLOOD_LAST_SLOT;
  });
}
