/**
 * The tail a class-0x41 actor carries: which routine it runs, and the words
 * of the routines that are not the placer's.
 *
 * A class-0x41 spawn is a placer, `PropContainerPlacerUpdate`
 * (`FUN_00461CD0`), and dies on its first frame. Two of the class's routines
 * allocate **skinned actors** with no class id of their own:
 * `PlaceType61Figures` (`FUN_004641F0`) -- `ActorAlloc(Type61FigureUpdate,
 * 0x13F4)` -- and the **golden frog**, `ActorAlloc(GoldenFrogUpdate, 0x13F4)`
 * in `SpawnGoldenFrog` (`FUN_004722A0`), which three of the class's routines
 * call, and in constructor 68 (`FUN_00463E50`). The port files both under
 * this class, as it files the result card's figures under class 0x61: the
 * pool keys its handler on the class, and the engine's object keys it on the
 * routine pointer at `obj+0x00`, which is what
 * {@link PropContainerTail.routine} stands for.
 *
 * Side-effect free, so `actor.ts` can import it.
 */

/**
 * `obj+0x00` for a class-0x41 actor. The numbers are the port's: nothing
 * stores them but the snapshot.
 */
export enum PropContainerRoutine {
  /** `PropContainerPlacerUpdate` (`FUN_00461CD0`) -- the placer itself. */
  Placer = 0,
  /** `Type61FigureUpdate` (`FUN_004729E0`) -- one of constructor 61's nine. */
  Type61Figure = 1,
  /** `GoldenFrogUpdate` (`FUN_00471FA0`) -- the golden frog. */
  GoldenFrog = 2,
}

/**
 * The golden frog's own words, `GoldenFrogUpdate`'s, beyond the shared
 * actor fields it also uses (`pos`, `yaw`, `hp` for `+0x11C`, `state` for
 * `+0x1310`, `playTicks` for `+0x194`, `lookAt` for `+0x100`).
 */
export interface GoldenFrogWords {
  /** `+0x1330` -- `(s16)g_evt_step_index` when it last changed. */
  stepSeen: number;
  /** `+0x1334` -- changes of it counted, against `+0x11C`. */
  steps: number;
  /** `+0x1338` -- the light's pitch, `+0x300` a frame. */
  lightPitch: number;
  /** `+0x133C` -- the light's yaw, `-0x180` a frame. */
  lightYaw: number;
  /** `+0x1350` -- frames of the score strip drawn since the shot. */
  strip: number;
  /** `+0x13F0` -- the strip's first slot: `0x116A` or `0x119C`. */
  stripBase: number;
  /**
   * `[port-only]` -- the light direction the frame's
   * `DrawSkinnedModelAndShadow` was made under, as `SetRenderLightDirection`
   * left it (`G.g_render_light_dir`), when the routine set one; null on a
   * frame it set none, which draws under the scene's. The routine changes
   * the direction only -- the ambient and the colour are the scene's.
   * `render/characters/golden_frog.ts` lights the model with it.
   */
  drawDir: [number, number, number] | null;
  /**
   * `[port-only]` -- the strip's `AssetDrawSlot` this frame and the matrix it
   * was made under, in world space; null on a frame that draws none.
   */
  stripDraw: { slot: number; m: number[] } | null;
}

/** The tail every class-0x41 actor carries. */
export interface PropContainerTail {
  /** `obj+0x00`. See {@link PropContainerRoutine}. */
  routine: PropContainerRoutine;
  /**
   * `[port-only]` A constructor-61 figure's light direction as its last
   * draw set it -- `G.g_render_light_dir` after `Type61FigureUpdate`'s
   * `SetRenderLightDirection`, the world vector the light comes from in the
   * port's encoding (`class41/type61.ts`). Block 1's ambient and colour hold
   * for the rest. The renderer reads it; `(0, 0, 1)` on anything else, which
   * it does not read.
   */
  drawDir: [number, number, number];
  /** {@link PropContainerRoutine.GoldenFrog}'s words; null on anything else. */
  frog: GoldenFrogWords | null;
}

/**
 * `[port-only]` A fresh tail: every class-0x41 spawn is a placer until a
 * constructor says otherwise.
 */
export function makePropContainerTail(): PropContainerTail {
  return { routine: PropContainerRoutine.Placer, drawDir: [0, 0, 1],
           frog: null };
}

/** `[port-only]` -- `ActorClearGameFields`' zero for the frog's words. */
export function makeGoldenFrogWords(): GoldenFrogWords {
  return { stepSeen: 0, steps: 0, lightPitch: 0, lightYaw: 0, strip: 0,
           stripBase: 0, drawDir: null, stripDraw: null };
}
