/**
 * `BreakablePropUpdate` and the routines it calls.
 *
 * One prop, one frame. The engine interleaves this with its drawing — the
 * `MatrixStackPush` / `AssetDrawSlot` block is inside the same function. The
 * port keeps the state half and the **matrix** half: each draw block ends in
 * `MatrixStore(obj+0x2E4)`, and that matrix is state, because the shatter
 * reads it on a later frame. So the draw's composition is computed here, into
 * `drawMatrix`, and the renderer places the model with it; only the
 * `AssetDrawSlot` itself is `render/`'s.
 *
 * There are **two** lifecycles here and they are easy to conflate:
 *
 * * **Destroyed** — two shots. A prop at stack level 0 turns into the break
 *   puff (`BreakableEffectUpdate`) and releases whatever it was hiding; one
 *   above level 0 bursts into fifteen pieces (`class41/shatter.ts`) and is
 *   gone. Neither falls.
 * * **Toppled** — a prop whose supporting members have all left notices the
 *   floor beneath it has gone and falls under gravity until a hull corner
 *   touches the ground. That is the entire stack collapse: nothing pushes
 *   anything, each prop only ever checks what it is standing on.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { G } from "../globals";
import { GameMode } from "../game_mode";
import { BREAKABLE_STANDING_RISE, PropRegisterForShotTest }
  from "./shot_test";
import { T } from "../tables";
import { BAMS } from "../vec";
import {
  BreakableGroupMembers, BreakablePropAt, MsvcRand, SetBreakableMemberSlot,
} from "./group";
import { ReleaseHiddenItem } from "./items";
import {
  BreakableFlag, BreakableSlot, BreakableState, HIT_FLAG_MASK, PropFamily,
  type BreakableProp,
} from "./prop_state";
import { BreakablePropSpawnShatter, type ShatterCamera } from "./shatter";
import {
  MatIdentity, MatrixRotateX, MatrixRotateY, MatrixRotateZ, MatrixTranslate,
} from "../matrix";

// -- the constants the routine spells out ----------------------------------

/** Gravity on a falling prop, per 60 Hz frame. */
export const BREAKABLE_GRAVITY = 0.01361;

/** The prop's own height; every draw and every hull test is offset by it. */
export const BREAKABLE_HEIGHT = 3.770148;

/** How close another prop must be for a faller to rest on it rather than drop. */
export const BREAKABLE_REST_RADIUS = 6.0;

/** The shake a crack imparts, and the factor it decays by each frame. */
export const BREAKABLE_SHAKE = 1.0;
export const BREAKABLE_SHAKE_DECAY = 0.85;
/** A prop standing on a cracked one is shaken by half as much. */
export const BREAKABLE_SHAKE_NEIGHBOUR = 0.5;
/**
 * The rattle's draw: `(rand() % 0x97 - 75.0) * shake * 0.01` (`0x00464980`),
 * once for x and once for z, and only while `shake > 0.01`.
 */
export const BREAKABLE_SHAKE_SPREAD = 0x97;
export const BREAKABLE_SHAKE_CENTRE = 75;
export const BREAKABLE_SHAKE_SCALE = 0.01;
/** The rattle stops being drawn once `shake` falls to this. */
export const BREAKABLE_SHAKE_FLOOR = 0.01;

/**
 * `g_script_flags[0x77]` — raised in scene 1 (stage 2), it despawns every
 * group prop on its next frame (`0x004646B3`).
 */
export const SCRIPT_FLAG_PROP_SWEEP = 0x77;
/**
 * The hit gate's one exception: in scene 1, block `0x11`, a shot does nothing
 * until `g_script_flags[0x28]` is raised (`0x004646E5`..`0x004646FD`).
 */
export const PROP_HIT_HOLD_SCENE = 1;
export const PROP_HIT_HOLD_BLOCK = 0x11;
export const SCRIPT_FLAG_PROP_HIT_RELEASE = 0x28;
/**
 * `g_script_flags[0x65]` — while it reads 1, every standing group-4 prop
 * breaks by itself (`0x004648FE`): the script's own demolition, and the only
 * way group 4 ever breaks, since the hit gate skips it.
 */
export const SCRIPT_FLAG_GROUP4_BREAK = 0x65;
/** The group the player's shots never break. */
export const SCRIPT_BROKEN_GROUP = 4;
/** `MOV [ESI+0x328], 0x1D9` — the effect variant the script break's puff plays. */
export const GROUP4_BREAK_EFFECT_VARIANT = 0x1d9;

/** The pitch a topple eases toward, signed by which way it went. */
export const BREAKABLE_REST_PITCH = 0x4000;

/** How long the break puff lasts, in 60 Hz frames. */
export const BREAKABLE_EFFECT_FRAMES = 0x48;

/** Sounds, as `PlaySoundId` ids. */
export const SFX_PROP_CRACK = 0x1d16a9;
export const SFX_PROP_BREAK = 0x1a16a9;
export const SFX_PROP_SETTLE = 0x1c16a9;

/** Points a landed shot on a prop is worth — and only the *destroying* one. */
export const PROP_HIT_SCORE = 10;

// -- the call graph --------------------------------------------------------

/**
 * `BreakablePropAwardHit` — `FUN_004650F0`.
 *
 * Works out whose shot it was from the two hit bits, pays for it and counts
 * it. `award` is the engine's second argument, and it is what separates the
 * two hits: the **crack** passes 0 and the **destroy** passes 1, so cracking a
 * prop is worth nothing and breaking it is worth ten. `ExtraLifePickupUpdate`
 * passes 0 too, so a pickup pays no points of its own either.
 *
 * Returns the player, because `GrantExtraLife` needs to know who to pay.
 */
export function BreakablePropAwardHit(flags: number, award: boolean,
                                      rng: Rng): number {
  const noP0 = (flags & BreakableFlag.HitByPlayer0) === 0;
  const noP1 = (flags & BreakableFlag.HitByPlayer1) === 0;
  // Both players landed on the same frame: the engine picks one at random.
  const player = (!noP0 && !noP1) ? MsvcRand(rng) & 1 : (noP0 ? 1 : 0);

  // Training pays nothing for a prop hit; Arcade and Original both do.
  if (award && G.g_GameMode !== GameMode.Training) {
    G.g_player_score[player] = (G.g_player_score[player] ?? 0) + PROP_HIT_SCORE;
  }
  G.g_player_hit_count[player] = (G.g_player_hit_count[player] ?? 0) + 1;
  return player;
}

/** `MatrixRotateY(yaw) * MatrixRotateZ(roll) * MatrixRotateX(pitch)`, in BAMS. */
function RotateYZX(x: number, y: number, z: number,
                   yaw: number, roll: number, pitch: number):
    { x: number; y: number; z: number } {
  let cs = Math.cos(pitch / BAMS), sn = Math.sin(pitch / BAMS);
  let rx = x;
  let ry = y * cs - z * sn;
  let rz = y * sn + z * cs;

  cs = Math.cos(roll / BAMS); sn = Math.sin(roll / BAMS);
  const zx = rx * cs - ry * sn;
  ry = rx * sn + ry * cs;
  rx = zx;

  cs = Math.cos(yaw / BAMS); sn = Math.sin(yaw / BAMS);
  const yx = rx * cs + rz * sn;
  rz = -rx * sn + rz * cs;
  rx = yx;
  return { x: rx, y: ry, z: rz };
}

/**
 * `BreakablePropGroundContact` — `FUN_00465590`.
 *
 * Transforms all 96 of `g_breakable_hull_points` by the prop's `Ry * Rz * Rx`
 * and reports whether any of them has gone below the floor.
 *
 * In `Falling` it records the **first** such point. In `Settled` it keeps the
 * **lowest** one that is not already the contact and re-seats the prop's
 * origin on it, which is how a broken prop comes to rest leaning on a corner
 * rather than sinking through the floor.
 */
export function BreakablePropGroundContact(p: BreakableProp): boolean {
  const hull = T.breakables?.hull;
  if (!hull?.length) return false;

  const floor = G.g_camera_fixed_eye_y - 0.1;
  let touched = false;
  let lowest = 10000.0;

  for (let i = 0; i < hull.length; i++) {
    const [hx, hy, hz] = hull[i];
    const q = RotateYZX(hx, hy - BREAKABLE_HEIGHT, hz, p.yaw, p.roll, p.pitch);
    if (q.y + p.y >= floor) continue;

    touched = true;
    if (p.state === BreakableState.Falling) {
      p.contact = i;
      p.restX = q.x + p.x;
      p.restY = G.g_camera_fixed_eye_y;
      p.restZ = q.z + p.z;
    } else if (p.state === BreakableState.Settled && i !== p.contact
               && q.y < lowest) {
      p.contact = i;
      lowest = q.y;
      p.restX = q.x + p.x;
      p.restY = G.g_camera_fixed_eye_y;
      p.restZ = q.z + p.z;
    }
  }

  // Settling re-derives the origin from the contact point: put the rested
  // corner where it landed, re-apply the rotation, and step back along the
  // hull offset to find where the prop's own origin now is.
  // The engine re-seats on **every** settled frame, not only on the ones that
  // find a corner below the floor: the `if (state == 2)` around the re-seat is
  // outside the hull loop. Gating it on a contact leaves the origin wherever
  // the fall stopped, which is a fraction of a unit into the ground.
  if (p.state === BreakableState.Settled) {
    const [cx, cy, cz] = hull[p.contact] ?? [0, 0, 0];
    const back = RotateYZX(-cx, -(cy - BREAKABLE_HEIGHT), -cz,
                           p.yaw, p.roll, p.pitch);
    p.x = p.restX + back.x;
    p.y = p.restY + back.y;
    p.z = p.restZ + back.z;
  }
  return touched;
}

/**
 * `BreakableEffectUpdate` — `FUN_00465500`. What a destroyed ground-level prop
 * becomes: the engine overwrites the object's entry point with this, so the
 * prop stops being a prop and spends 0x48 frames as a puff before it dies.
 */
export function BreakableEffectUpdate(p: BreakableProp): void {
  if (p.effectFrames < BREAKABLE_EFFECT_FRAMES) {
    p.effectFrames += 1;
    return;
  }
  ActorDespawnProp(p);
}

/**
 * `ActorDespawn` (`FUN_00409CC0`) as a prop sees it: flagged dead, taken out
 * of its member slot, and dropped from the pool by `BreakablePropPoolUpdate`.
 * A prop-shaped wrapper, not a port of the shared routine — that one clears a
 * light slot at `+0x3C` which a prop never holds.
 */
export function ActorDespawnProp(p: BreakableProp): void {
  p.dead = true;
  p.flags = (p.flags & ~BreakableFlag.Live) | 0x80018000;
  if (G.g_breakable_members[p.group * 9 + p.member] === p.id) {
    SetBreakableMemberSlot(p.group, p.member, 0);
  }
}

/**
 * `ActorKill` (`FUN_004A7040`) as a prop sees it.
 *
 * A **different** exit from {@link ActorDespawnProp}, and two of the generic
 * draw-only types take this one: `PropDrawOnlyType53` at the end of its
 * inline lifetime and `PropDrawOnlyType54` at the end of its drift both
 * `CALL 0x004A7040`, where the shared prologue calls `0x00409CC0`. `ActorKill`
 * unlinks the object and longjmps out of the pool's walk; it writes neither
 * the flag word nor a light slot, which `ActorDespawn` does — so this does
 * not either, and a member slot a generic prop never held is not released.
 *
 * `[port-only]` as a *name*: the engine's routine is `ActorKill`
 * (`FUN_004A7040`), it operates on the pool's current object and takes no
 * argument, and it longjmps rather than returning. This is the prop-shaped
 * wrapper for it, the same shape and the same reason as `ActorKillPlacer` in
 * `class41/index.ts` and `ActorDespawnProp` above.
 */
export function ActorKillProp(p: BreakableProp): void {
  p.dead = true;
}

/**
 * `BreakablePropUpdate` — `FUN_00464620`. One prop, one 60 Hz frame.
 *
 * `cam` is the host's two camera matrices, or null with none: the draw blocks
 * compose onto the live view and `MatrixStore` keeps the result, and the
 * shatter takes that view back off. See {@link BreakableProp.drawView}.
 *
 * Ghidra's body for this routine is twelve instructions long and its
 * pseudocode returns out of every draw block; the routine is read here from
 * the disassembly of `0x00464620`..`0x004650C2`, where each draw block runs on
 * into a common tail at `0x00464FD9` -- the shadow and the shot-test
 * registration (L37).
 */
export function BreakablePropUpdate(p: BreakableProp, rng: Rng,
                                    events?: Events,
                                    cam: ShatterCamera | null = null): void {
  // A destroyed ground-level prop has had its entry point replaced; it runs
  // the puff and nothing else.
  if (p.family === PropFamily.Effect) { BreakableEffectUpdate(p); return; }

  // The prop re-registers itself every frame, so a slot freed by a break is
  // only ever reclaimed by something still alive.
  SetBreakableMemberSlot(p.group, p.member, p.id);

  // Lifetime is counted in **evt blocks**, not frames: one tick each time the
  // script moves on. A prop outlives a slow player and not a fast one.
  if (G.g_evt_step_index !== p.lastStepIndex) {
    p.stepsElapsed += 1;
    if (p.stepsElapsed > p.lifetime) { ActorDespawnProp(p); return; }
    p.lastStepIndex = G.g_evt_step_index;
  }

  // `CMP word ptr [g_scene_index], 1; MOV AL, [0x009C7277]` -- stage 2's
  // sweep, the same one `PropExpireByStepLifetime` makes for the generic
  // props, inlined here.
  if (G.g_scene_index === 1
      && (G.g_script_flags[SCRIPT_FLAG_PROP_SWEEP] ?? 0) !== 0) {
    ActorDespawnProp(p);
    return;
  }

  const rec = BreakableGroupMembers(p.group)[p.member];
  const level = rec?.level ?? 0;

  // -- the hit ------------------------------------------------------------
  // Gated on bit 3; skipped entirely for group 4, whose props the script
  // breaks rather than the player; and held in scene 1's block 0x11 until
  // `g_script_flags[0x28]` is raised -- `g_evt_block_index` is `0x009A2BC0`
  // and the flag byte `0x009C7228`.
  if ((p.flags & BreakableFlag.Hit) !== 0 && p.group !== SCRIPT_BROKEN_GROUP
      && !(G.g_scene_index === PROP_HIT_HOLD_SCENE
           && G.g_evt_block_index === PROP_HIT_HOLD_BLOCK
           && (G.g_script_flags[SCRIPT_FLAG_PROP_HIT_RELEASE] ?? 0) === 0)) {
    if (p.hp === 1) {
      // `BreakablePropSpawnShatter(obj); ActorKill();` -- the kill longjmps
      // out of the walk, so nothing below runs for a stacked prop.
      if (BreakDestroy(p, level, rng, events, cam)) return;
    } else if (p.hp === 2) {
      BreakCrack(p, level, rng, events);
    }
  }
  // `AND ECX, 0xFFFFFFF1` at `0x004648F8` -- after a ground-level destroy too:
  // that one swaps the entry point and then carries on with the rest of this
  // frame, rattle draws and all.
  p.flags &= ~HIT_FLAG_MASK;

  // -- the script's own break of group 4 ------------------------------------
  // `if (g_script_flags[0x65] == 1 && group == 4 && state == 0)` -- no score,
  // no sound, no item: the stack comes down because the script says so.
  if ((G.g_script_flags[SCRIPT_FLAG_GROUP4_BREAK] ?? 0) === 1
      && p.group === SCRIPT_BROKEN_GROUP
      && p.state === BreakableState.Standing) {
    p.state = BreakableState.Removed;
    if (level !== 0) {
      BreakablePropSpawnShatter(p, rng, cam, events);
      ActorKillProp(p);
      return;
    }
    // `+0x294 = 0` is written here and in the destroy arm; nothing the port
    // has read reads it, so it is not carried.
    p.effect = 0;
    p.effectVariant = GROUP4_BREAK_EFFECT_VARIANT;
    p.effectFrames = 0;
    p.effectPrevFrame = 0;
    p.family = PropFamily.Effect;
  }

  // -- the rattle -----------------------------------------------------------
  // Two `rand()`s a frame for as long as `shake > 0.01` -- a draw offset only,
  // added to the translate and never written back, so the hull and the shot
  // test stay put. The draws are the game's: they come out of the same
  // generator every other `rand()` in the frame does.
  p.shakeX = 0;
  p.shakeZ = 0;
  if (p.shake > BREAKABLE_SHAKE_FLOOR) {
    p.shakeX = ((MsvcRand(rng) % BREAKABLE_SHAKE_SPREAD)
      - BREAKABLE_SHAKE_CENTRE) * p.shake * BREAKABLE_SHAKE_SCALE;
    p.shakeZ = ((MsvcRand(rng) % BREAKABLE_SHAKE_SPREAD)
      - BREAKABLE_SHAKE_CENTRE) * p.shake * BREAKABLE_SHAKE_SCALE;
    p.shake *= BREAKABLE_SHAKE_DECAY;
  }

  // The draw block is picked by the state the switch read, so the frame a
  // prop starts to fall is still drawn by the standing block.
  const drawn = p.state;
  switch (p.state) {
    case BreakableState.Standing: StandingStep(p, rec, level, rng); break;
    case BreakableState.Falling: FallStep(p, events); break;
    case BreakableState.Settled: SettleStep(p); break;
    case BreakableState.Removed: break;
  }
  BreakablePropStoreDrawMatrix(p, drawn, cam);

  // `if (obj+0x192 != 3) { ...transform...; RegisterForShotTest(obj); }` --
  // the routine's last four lines. The rise is assigned **only** inside the
  // standing arm, so a prop that is falling or settled publishes its raw
  // origin; a removed one publishes nothing and cannot be shot again.
  if (p.state !== BreakableState.Removed) {
    PropRegisterForShotTest(
      p, p.x,
      p.y + (p.state === BreakableState.Standing ? BREAKABLE_STANDING_RISE : 0),
      p.z);
  }
}

/**
 * `[port-only]` as a function: the matrix half of `BreakablePropUpdate`'s
 * three draw blocks, each of which ends `AssetDrawSlot(obj+0x28C);
 * MatrixStore(obj+0x2E4)`.
 *
 * ```
 * standing  Translate(x+sx, y, z+sz); RotY(yaw)
 * falling   Translate(x+sx, y, z+sz); RotY(yaw); RotZ(roll); RotX(pitch);
 *           Translate(0, -3.770148, 0)
 * settled   Translate(restX+sx, restY, restZ+sz); RotY; RotZ; RotX;
 *           Translate(-hull[c].x, -(hull[c].y - 3.770148), -hull[c].z);
 *           Translate(0, -3.770148, 0)
 * ```
 *
 * `0xC0714A1B` is the `-3.770148` both lower blocks push (`0x00464B0D`,
 * `0x00464D39`); a removed prop draws nothing and stores nothing.
 */
function BreakablePropStoreDrawMatrix(p: BreakableProp, drawn: BreakableState,
                                      cam: ShatterCamera | null): void {
  if (drawn === BreakableState.Removed) return;
  const m = MatIdentity();
  if (drawn === BreakableState.Settled) {
    MatrixTranslate(m, p.restX + p.shakeX, p.restY, p.restZ + p.shakeZ);
  } else {
    MatrixTranslate(m, p.x + p.shakeX, p.y, p.z + p.shakeZ);
  }
  MatrixRotateY(m, p.yaw);
  if (drawn !== BreakableState.Standing) {
    MatrixRotateZ(m, p.roll);
    MatrixRotateX(m, p.pitch);
    if (drawn === BreakableState.Settled) {
      const [cx, cy, cz] = T.breakables?.hull?.[p.contact] ?? [0, 0, 0];
      MatrixTranslate(m, -cx, -(cy - BREAKABLE_HEIGHT), -cz);
    }
    MatrixTranslate(m, 0, -BREAKABLE_HEIGHT, 0);
  }
  p.drawMatrix = m;
  p.drawView = cam ? cam.w2v.slice(0, 16) : [];
}

/**
 * The second shot. Ten points, and then one of two ways to leave. Returns true
 * when the object has been killed and the frame is over for it.
 */
function BreakDestroy(p: BreakableProp, level: number, rng: Rng,
                      events: Events | undefined,
                      cam: ShatterCamera | null): boolean {
  BreakablePropAwardHit(p.flags, true, rng);
  p.state = BreakableState.Removed;
  SetBreakableMemberSlot(p.group, p.member, 0);
  events?.emit("prop.broken", { id: p.id, sound: SFX_PROP_BREAK });

  if (level !== 0) {
    // Stacked: `BreakablePropSpawnShatter(obj); ActorKill();` at
    // `0x00464BBD`. It bursts where its last draw put it and is gone -- an
    // `ActorKill`, not an `ActorDespawn`; the member slot is already clear.
    BreakablePropSpawnShatter(p, rng, cam, events);
    ActorKillProp(p);
    return true;
  }
  // Ground level: the object's entry point is replaced with the puff, and
  // this is where whatever it was hiding comes out. The arm writes `+0x294`,
  // `+0x32C` and `+0x330` -- **not** `+0x324`, so a one-shot target's puff
  // keeps its own effect id -- and hands the lifetime byte to `+0x11C`.
  p.effectFrames = 0;
  p.effectPrevFrame = 0;
  p.family = PropFamily.Effect;
  p.hp = p.lifetime;
  ReleaseHiddenItem(p, events);
  return false;
}

/** The first shot. No score at all — only the hit count and the crack. */
function BreakCrack(p: BreakableProp, level: number, rng: Rng,
                    events?: Events): void {
  if (G.g_GameMode !== GameMode.Training) {
    BreakablePropAwardHit(p.flags, false, rng);
  }
  p.slot = BreakableSlot.Broken;
  // `if (obj+0x192 == 0) obj+0x1D0 = g_camera_block_yaw_bams[g_camera_index]`
  // (`0x0046473E`, the `* 0x69` dword stride): a prop cracked while still
  // standing turns to face the camera. `g_camera_block_yaw_bams` —
  // `0x009A60D0` — is the one block the port keeps.
  if (p.state === BreakableState.Standing) p.yaw = G.g_camera_block_yaw_bams;
  p.hp -= 1;
  p.shake = BREAKABLE_SHAKE;
  events?.emit("prop.cracked", { id: p.id, sound: SFX_PROP_CRACK });
  ShakeSupportedMembers(p, level);
}

/**
 * A cracked prop shakes every member standing on it.
 *
 * The engine walks the whole group's records and shakes any member that names
 * *this* one as a support — the "who is standing on me" question, read from
 * the other side of the same list. Only props at level 0 or 1 do it.
 */
function ShakeSupportedMembers(p: BreakableProp, level: number): void {
  if (level >= 2) return;
  for (const m of BreakableGroupMembers(p.group)) {
    if (!m.supports?.includes(p.member)) continue;
    const above = BreakablePropAt(p.group, m.index);
    if (above) above.shake = BREAKABLE_SHAKE_NEIGHBOUR;
  }
}

/**
 * Standing: the only thing a whole prop does is check what it is standing on.
 *
 * The engine does **not** stop at the first missing support — it runs the
 * whole entry once per gone support, so a prop losing both draws the random
 * bearing twice. That is two `rand()` calls, and the port makes the same two,
 * because the generator is part of the save state.
 */
function StandingStep(p: BreakableProp, rec: { level: number;
                                               supports: number[] } | undefined,
                      level: number, rng: Rng): void {
  if (level <= 0 || !(rec?.supports?.length)) return;
  for (const s of rec.supports) {
    const under = BreakablePropAt(p.group, s);
    if (under && under.state === BreakableState.Standing) continue;
    BeginFall(p, rng);
  }
}

/** Enter the fall: leave the stack, pick a bearing, and throw the prop. */
function BeginFall(p: BreakableProp, rng: Rng): void {
  p.state = BreakableState.Falling;
  p.vy = 0;
  p.y += BREAKABLE_HEIGHT;

  if ((p.flags & BreakableFlag.FixedTopple) === 0) {
    // `(1 - 2*(rand()&1)) * (rand() % 0x81 + 0x80)`: at least 0x80 of spin,
    // either way. The engine spells the sign with the same masked-modulo
    // idiom the yaw draw uses.
    const sign = 1 - 2 * (MsvcRand(rng) & 1);
    p.spin = sign * ((MsvcRand(rng) % 0x81) + 0x80);
  } else {
    // The authored case keeps the spin the constructor gave it and takes its
    // bearing from `+0x1FE`.
    p.yaw = p.topple;
  }

  // Which way it leans decides the rest pitch, and which end of the bearing
  // the horizontal throw is taken from. `spin < 1` so a zero spin leans back.
  const back = p.spin < 1;
  p.restPitch = back ? -BREAKABLE_REST_PITCH : BREAKABLE_REST_PITCH;
  const bearing = back ? p.yaw + 0x8000 : p.yaw;

  // Two separate draws: the engine calls `rand()` once for each axis.
  p.vx = Math.sin(bearing / BAMS) * ((MsvcRand(rng) % 0xb) * 0.01 + 0.1);
  p.vz = Math.cos(bearing / BAMS) * ((MsvcRand(rng) % 0xb) * 0.01 + 0.1);
}

/**
 * One frame of the fall: gravity, integrate, then ask the hull whether a
 * corner has reached the floor.
 */
function FallStep(p: BreakableProp, events?: Events): void {
  // The engine first looks for another member of the same group that
  // is *below* this one and within 6 units, and zeroes the fall if it finds
  // one — a prop landing on a prop. It measures that with `obj+0x40..0x48`,
  // and nothing in this class ever writes those three floats: `ActorAlloc`
  // zeroes the object from `+0x34` up and `BreakablePropUpdate` only ever
  // writes the position at `+0x19C`. So the comparison is `0 < 0` for every
  // pair and the branch cannot fire. Transcribed, and dead, exactly as it is
  // in the engine — see `hitPos`.
  let resting = false;
  for (const other of G.g_breakable_props) {
    if (other === p || other.dead || other.group !== p.group) continue;
    if (other.member === p.member) continue;
    if (!(other.hitPos.y < p.hitPos.y)) continue;
    const d = Math.hypot(p.hitPos.x - other.hitPos.x,
                         p.hitPos.y - other.hitPos.y,
                         p.hitPos.z - other.hitPos.z);
    if (d < BREAKABLE_REST_RADIUS) { resting = true; p.vy = 0; break; }
  }
  if (!resting) {
    p.vy -= BREAKABLE_GRAVITY;
    p.y += p.vy;
  }

  p.pitch += p.spin;
  p.x += p.vx;
  p.z += p.vz;

  if (BreakablePropGroundContact(p)) {
    p.state = BreakableState.Settled;
    p.settleTimer = 500.0;
    events?.emit("prop.settled", { id: p.id, sound: SFX_PROP_SETTLE });
  }
}

/**
 * One frame of settling: ease the spin toward the rest pitch, and keep
 * re-seating on the lowest hull corner until the motion drops under 0x20.
 */
function SettleStep(p: BreakableProp): void {
  const err = p.restPitch - p.pitch - p.spin;
  p.spin = (err >> 4) + p.spin;
  if (Math.abs(p.spin) > 0x20) {
    p.pitch += p.spin >> 3;
    BreakablePropGroundContact(p);
  }
}

/**
 * Land a shot on a prop, the way the engine's gunshot hit test would: it sets
 * the flag bits that `BreakablePropUpdate` reads on its next frame.
 */
export function BreakablePropTakeShot(p: BreakableProp, player: number): void {
  p.flags |= BreakableFlag.Hit
    | (player === 0 ? BreakableFlag.HitByPlayer0 : BreakableFlag.HitByPlayer1);
}
