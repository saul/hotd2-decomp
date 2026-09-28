/**
 * What being hit looks like: the full-screen damage overlay, and the latch
 * that feeds it.
 *
 * `PlayerTakeDamage` (`FUN_00415300`) does not draw anything. It stores its
 * third argument in `g_player_damage_overlay_kind` and raises `g_player_was_hit`, and
 * the player's own per-frame update, `PlayerUpdateInPlay` (`0x00413E90`),
 * picks the latch up two routines later:
 *
 * ```
 * PlayerUpdateInPlay(task)
 *   ...the +0x80 hook...
 *   PlayerRunCameraHook(task)                 FUN_00415100
 *     g_player_camera_hook[player](task)      0x009A5CDC + player*0x130
 *       = PlayerHookSpawnDamageOverlay        FUN_00415180, under a cam/ path
 *           if (g_player_was_hit[player])
 *             DamageOverlaySpawn(task, g_player_damage_overlay_kind[player])
 *   ...trigger, crosshair, shot rings, HUD...
 *   DamageOverlayUpdateAndDraw(task)          FUN_00417300
 *
 * SelectAttackablePlayer()                    FUN_00414F40, its own task
 *   UpdateScreenShake()                       FUN_00415270 -- clears the latch
 * ```
 *
 * It used to be called the "hit motion", and it is not a motion. Its one
 * reader is the spawn, which uses it as the overlay **kind**: an index into four eleven-row tables that
 * pick the sprite, its placement, its scale and the sound it makes. See
 * {@link DamageOverlayKind}.
 *
 * ## What the overlay is
 *
 * One model out of `pol/common.bin` (entries 116..126, asset slots
 * 0x931..0x93B), drawn in the camera's own space at `z = -1.02` and a scale of
 * 0.02, which makes each one most of a screen tall. Every one of the eleven
 * is a single translucent, alpha-blended (`src_alpha / inv_src_alpha`)
 * ARGB4444 texture: claw marks, a slash, a bite ring, a splat.
 *
 * **It does not fade, flash or animate.** `DamageOverlayUpdateAndDraw` makes
 * the same draw with the same matrix on every one of its 59 frames, and no
 * colour, alpha or scale is touched anywhere in the chain `[proved]`. It is on,
 * unchanged, for just under a second, and then it is off.
 *
 * ## Under which camera
 *
 * The hook at `+0x7C` is chosen by the scene state's installer, so the overlay
 * is a property of the camera, not of the hit: the four row-2 installers (the
 * `cam/` path cameras, minors 4 to 7) put `PlayerHookSpawnDamageOverlay` there and the two
 * row-1 installers that write the slot at all put `PlayerHookDrawBody`, which
 * draws the player's own body instead and never looks at the latch. See
 * {@link SceneStateInstallPlayerHooks}.
 *
 * ## What is not here
 *
 * * **The shake's nod** is `game/camera/view.ts`, applied by the camera
 *   draw the way `UpdateSceneViewAndLight` (`FUN_00401F40`) applies it: this
 *   file computes `g_screen_shake_pitch`, that one re-aims the view by it.
 *   The shake's other writers (entrances, boss deaths) are not wired yet.
 * * Nothing here decides when these run: `PlayerUpdateInPlay`,
 *   `PlayerContinueCountdown` (`FUN_00414280`), `PlayerStateEnterContinue`
 *   (`FUN_00413DE0`) and `SelectAttackablePlayer` do, in
 *   `game/player_shell.ts`, and `PlayerEnterPlay` writes the hook its row
 *   carries before any installer does.
 */
import type { Events } from "../../core/events";
import type { Rng } from "../../core/rng";
import { G } from "../globals";

/**
 * `g_player_damage_overlay_kind` as `DamageOverlaySpawn` (below) reads it:
 * which of the eleven overlays a hit shows.
 *
 * The values are `PlayerTakeDamage`'s third argument at the engine's own call
 * sites, and the member names are **the picture each one draws** -- the
 * texture in `pol/common.bin` that the kind's asset slot resolves to, read as
 * an image. Pairs that share a texture differ by a mirrored model (0/1) or a
 * U-flipped one (2/3, 4/5); which of a pair is the "mirrored" one is only a
 * label for the model that carries the flip.
 *
 * Every value is reachable in shipped data. Kinds 0, 1, 4, 5, 7, 8 and 9 come
 * out of the zombie attack tables' `+0x0A` (and 2 and 3 from `znchain`,
 * type 0x0D); the literals are:
 *
 * | kind | passed by |
 * |---|---|
 * | 0/1 | `ThrowerStateGrabPlayer`, class 0x31's hand kits (types 0x16, 0x18); 1 also from `CarriedPropThrowAtCamera` for a type-2 prop |
 * | 4 | `ZombieThrownWeaponStateStraight` (the axe) |
 * | 6 | `ZombieThrownWeaponStateArc`, `ThrownWeaponFlyToTarget`, class 0x14's four strikes, class 0x2D's children |
 * | 7 | `ZombieStateLeapToPoint`, `CarriedPropThrowAtCamera`, `CarriedPropRollAtCamera`, class 0x2D state 5, class 0x22 |
 * | 8 | `Boss4StateStrikeClip*`, `Boss4StateChargePastCamera` |
 * | 9 | the bats, the fish, the frog, the owl, the body creature, `ZombieStateScriptedGrabAndDespawn` |
 * | 10 | the horde (`HordeMemberUpdate`) |
 */
export enum DamageOverlayKind {
  /** Slot 0x93B, `common.bin[126]`: texture 33, the diagonal swipe, mirrored. */
  SwipeMirrored = 0,
  /** Slot 0x93A, `common.bin[125]`: texture 33, the diagonal swipe. */
  Swipe = 1,
  /** Slot 0x938, `common.bin[123]`: texture 27 U-flipped, three claw marks. */
  ClawMirrored = 2,
  /** Slot 0x932, `common.bin[117]`: texture 27, three claw marks. */
  Claw = 3,
  /** Slot 0x939, `common.bin[124]`: texture 28 U-flipped, one slash. */
  SlashMirrored = 4,
  /** Slot 0x933, `common.bin[118]`: texture 28, one slash. */
  Slash = 5,
  /**
   * Slot 0x937, `common.bin[122]`: texture 32, a wide horizontal gash -- and
   * with two players slot 0x936, `common.bin[121]`, texture 31, the only kind
   * whose picture changes with the player count.
   */
  Gash = 6,
  /** Slot 0x934, `common.bin[119]`: texture 29, a splat. */
  Splat = 7,
  /** Slot 0x935, `common.bin[120]`: texture 30, a long vertical streak. */
  Streak = 8,
  /** Slot 0x931, `common.bin[116]`: texture 26, a ring of teeth marks. */
  Bite = 9,
  /** The same slot as {@link Bite}; the horde's kind. */
  HordeBite = 10,
}

/** How many rows each of the four per-kind tables has. */
export const DAMAGE_OVERLAY_KINDS = 11;

/**
 * `g_damage_overlay_slots` — `0x00579F80`, `s32[11][2]`, `[kind][players - 1]`.
 *
 * The routine reads it as `0x00579F7C + (count + kind * 2) * 4` with a count
 * of 1 or 2, which is this table one word in: the two s16 at `0x00579F7C` are
 * `g_muzzle_smoke_slots` and are never read by it.
 */
export const DAMAGE_OVERLAY_SLOTS: readonly (readonly [number, number])[] = [
  [0x93b, 0x93b], [0x93a, 0x93a], [0x938, 0x938], [0x932, 0x932],
  [0x939, 0x939], [0x933, 0x933], [0x937, 0x936], [0x934, 0x934],
  [0x935, 0x935], [0x931, 0x931], [0x931, 0x931],
];

/**
 * `g_damage_overlay_offsets` — `0x004ECAD8`, `float[11][2]`: a camera-space
 * `{x, y}` added to the draw's translate. Twenty-two zeros in the shipped exe.
 */
export const DAMAGE_OVERLAY_OFFSETS: readonly (readonly [number, number])[] =
  Array.from({ length: DAMAGE_OVERLAY_KINDS }, () => [0.0, 0.0] as const);

/**
 * `g_damage_overlay_scales` — `0x004ECB30`, `float[11]`, every one
 * `0x3CA3D70A`.
 */
export const DAMAGE_OVERLAY_SCALES: readonly number[] =
  Array.from({ length: DAMAGE_OVERLAY_KINDS }, () => Math.fround(0.02));

/**
 * `g_damage_overlay_x_by_players` — `0x004ECB5C`, `float[2][2]`,
 * `[players - 1][player]`: one player centred, two players each to their own
 * side. Read as `0x004ECB54 + (player + count * 2) * 4`.
 */
export const DAMAGE_OVERLAY_X_BY_PLAYERS:
  readonly (readonly [number, number])[] = [
    [0.0, 0.0],
    [Math.fround(-0.22), Math.fround(0.22)],
  ];

/**
 * `g_damage_overlay_sounds` — `0x00579FD8`, `u32[11]`: what `DamageOverlaySpawn`
 * plays, all out of `COMMON\`.
 */
export const DAMAGE_OVERLAY_SOUNDS: readonly number[] = [
  0x001a16a9,   // DAMAGE1_22
  0x001a16a9,
  0x001b16a9,   // DAMAGE2_22
  0x001b16a9,
  0x000316a9,   // BLOOD03_16
  0x000316a9,
  0x000316a9,
  0x001d16a9,   // DAMAGE4_22
  0x000516a9,   // BLOOD05_16
  0x000d16a9,   // BONE01_22
  0x000d16a9,
];

/** `+0x04 = 0x3C` at spawn. The draw sees 59 of them; see the update. */
export const DAMAGE_OVERLAY_FRAMES = 0x3c;
/** The frame count the hurt voice plays on — five updates after the spawn. */
export const DAMAGE_OVERLAY_VOICE_FRAME = 0x37;
/** `PUSH 0xBF828F5C` — the translate's camera-space `z`. */
export const DAMAGE_OVERLAY_Z = Math.fround(-1.02);

/**
 * The hurt voice, `[player][rand() % 2]`. Player 0 is James
 * (`DAMEGE_JMS\184_J`, `185_J`), player 1 Gary (`DAMEGE_GA\187_1_GA`,
 * `188_2_GA`) -- and note the pairs are in opposite orders: an odd `rand()`
 * gives player 0 the **lower** id and player 1 the **higher**.
 */
export const DAMAGE_OVERLAY_VOICES: readonly (readonly [number, number])[] = [
  [0x11ea9, 0x1ea9],
  [0x1da9, 0x11da9],
];

/**
 * `g_damage_overlays` — `0x009A26C0`, one `0x14`-byte record per player.
 */
export interface DamageOverlay {
  /** `+0x00`. */
  active: number;
  /** `+0x04` — frames left, 60 at spawn. */
  frames: number;
  /** `+0x08` — the camera-space `x`, from the player count at spawn. */
  x: number;
  /** `+0x0C`. */
  kind: DamageOverlayKind;
  /** `+0x10` — `g_max_attackers` at spawn. */
  count: number;
}

/**
 * `[port-only]` — both players' records, cleared.
 *
 * `kind: 0` rather than the enum member: `G`'s initialiser calls this, and
 * when this module is the first of the pair to load, that happens before the
 * enum above has been built.
 */
export function makeDamageOverlays(): DamageOverlay[] {
  return [0, 1].map(() => ({ active: 0, frames: 0, x: 0, kind: 0, count: 0 }));
}

/**
 * What `g_player_camera_hook` (`0x009A5CDC`) points at -- the routines the
 * scene-state installers write there. `None` is the port's: the engine's
 * pointer holds whatever the last installer, or the last stage, left.
 */
export enum PlayerCameraHook {
  /** `[port-only]` — no installer has run since the reset. */
  None = 0,
  /** `PlayerHookSpawnDamageOverlay`, below. */
  SpawnDamageOverlay = 1,
  /**
   * `PlayerHookDrawBody` (`FUN_00415120`) — the follow and no-op cameras.
   * It draws the player's body; the port's body is the renderer's, so the
   * hook does nothing here, and that is exactly its effect on the overlay.
   */
  DrawBody = 2,
  /**
   * `PlayerHookDrawBodyUntilMotionEnd` (`FUN_004151D0`) --
   * `PlayerStateArmGameOver` installs it. It draws only in app state 7, where
   * `PlayerGameOverWait` runs it; see `game/player_body.ts`.
   */
  DrawBodyUntilMotionEnd = 3,
  /**
   * `PlayerHookSetCurActor` (`FUN_004151B0`) -- what the body's hook hands
   * over to on the clip's last frame. It draws nothing.
   */
  SetCurActor = 4,
}

/**
 * `[port-only]` — the `+0x7C` half of the scene-state installers.
 *
 * `EvtEnterSceneState` (`FUN_00403BD0`) jumps to
 * `g_scene_state_table[major * 9 + minor]`, and each cell is an installer. Of
 * the table's live cells, six write the players' camera hook and the rest
 * leave it alone:
 *
 * | cell | installer | `+0x7C` |
 * |---|---|---|
 * | 1, 1 | `CameraInstallFollowMidpoint` (`FUN_00403980`) | `PlayerHookDrawBody` |
 * | 1, 2 | `CameraInstallNoOpWithBodyDraw` (`FUN_004039A0`) | `PlayerHookDrawBody` |
 * | 1, 3 | `CameraInstallViewAngles` (`FUN_004039D0`) | unchanged |
 * | 2, 4 | `CameraInstallSnapToPathEye` (`FUN_00403A00`) | `PlayerHookSpawnDamageOverlay` |
 * | 2, 5 | `CameraInstallPathImpulseShake` (`FUN_00403A30`) | `PlayerHookSpawnDamageOverlay` |
 * | 2, 6 | `CameraInstallDeferredRail` (`FUN_00403A60`) | `PlayerHookSpawnDamageOverlay` |
 * | 2, 7 | `CameraInstallStashedPath` (`FUN_00403A90`) | `PlayerHookSpawnDamageOverlay` |
 * | 0, 0 | `CameraInstallNoOpHook` (`FUN_00403970`) | unchanged |
 *
 * Every other cell is `SceneStateInvalidHang` (`FUN_00402710`), and the
 * shipped scripts reach only these.
 *
 * Every installer writes both players' slots. The rest of each installer --
 * the camera hook itself -- is the walker's and the camera port's business.
 */
export function SceneStateInstallPlayerHooks(major: number,
                                             minor: number): void {
  let hook: PlayerCameraHook | null = null;
  if (major === 1 && (minor === 1 || minor === 2)) {
    hook = PlayerCameraHook.DrawBody;
  } else if (major === 2 && minor >= 4 && minor <= 7) {
    hook = PlayerCameraHook.SpawnDamageOverlay;
  }
  if (hook === null) return;
  G.g_player_camera_hook[0] = hook;
  G.g_player_camera_hook[1] = hook;
}

/**
 * `DamageOverlayClear` — `FUN_004172E0`. `active` and `frames` only; the
 * rest of the record keeps what the last spawn wrote.
 */
export function DamageOverlayClear(player: number): void {
  const o = G.g_damage_overlays[player];
  if (!o) return;
  o.active = 0;
  o.frames = 0;
}

/**
 * `DamageOverlaySpawn` — `FUN_00417440`.
 *
 * Refused outright while this player's overlay is live, sound and all: a
 * second hit inside the 59 frames shows nothing new. (The 90-frame
 * invulnerability window after a hit is longer, so in practice only a
 * `PlayerTakeDamageTimed` with its override could get here while one is up.)
 */
export function DamageOverlaySpawn(player: number, kind: number,
                                   events?: Events): void {
  const o = G.g_damage_overlays[player];
  if (!o || o.active !== 0) return;
  o.active = 1;
  o.frames = DAMAGE_OVERLAY_FRAMES;
  const count = G.g_max_attackers;
  o.count = count;
  o.x = DAMAGE_OVERLAY_X_BY_PLAYERS[count - 1]?.[player] ?? 0;
  o.kind = kind;
  events?.emit("sound.play", { id: DAMAGE_OVERLAY_SOUNDS[kind] ?? 0 });
}

/**
 * `PlayerHookSpawnDamageOverlay` — `FUN_00415180`. Reads the latch and does
 * not clear it; {@link UpdateScreenShake} does.
 */
export function PlayerHookSpawnDamageOverlay(player: number,
                                             events?: Events): void {
  if ((G.g_player_was_hit[player] ?? 0) !== 0) {
    DamageOverlaySpawn(player, G.g_player_damage_overlay_kind[player] ?? 0, events);
  }
}

/**
 * `PlayerRunCameraHook` — `FUN_00415100`. One indirect call through
 * `g_player_camera_hook`.
 */
export function PlayerRunCameraHook(player: number, events?: Events): void {
  switch (G.g_player_camera_hook[player]) {
    case PlayerCameraHook.SpawnDamageOverlay:
      PlayerHookSpawnDamageOverlay(player, events);
      return;
    case PlayerCameraHook.DrawBody:
    // Outside app state 7 the body's hook draws nothing and steps nothing;
    // inside it `PlayerGameOverWait` runs the hook itself.
    case PlayerCameraHook.DrawBodyUntilMotionEnd:
    case PlayerCameraHook.SetCurActor:
    case PlayerCameraHook.None:
    default:
      return;
  }
}

/**
 * `DamageOverlayUpdateAndDraw` — `FUN_00417300`, its state half. The draw
 * half is `render/effects.ts`, from this record, and makes the same
 * decision: a record is drawn exactly when it is still active after this.
 *
 * ```
 * if (active) {
 *   if (--frames == 0 || count < g_max_attackers) DamageOverlayClear(task);
 *   if (active) { ...draw... }
 * }
 * if (frames == 0x37) PlaySoundId(the hurt voice);
 * ```
 *
 * The decompiler shows the draw arm returning; it does not. It falls through
 * to the voice test at `0x004173CC` (L37), so the voice plays on the fifth
 * update after the spawn with the overlay still up. The draw sees frames 59
 * down to 1: 59 frames drawn, cleared on the sixtieth.
 */
export function DamageOverlayUpdateAndDraw(player: number, rng: Rng,
                                    events?: Events): void {
  const o = G.g_damage_overlays[player];
  if (!o) return;
  if (o.active !== 0) {
    o.frames -= 1;
    if (o.frames === 0 || o.count < G.g_max_attackers) {
      DamageOverlayClear(player);
    }
  }
  if (o.frames === DAMAGE_OVERLAY_VOICE_FRAME) {
    // `rand() & 0x80000001` with the sign fix-up is `rand() % 2`.
    const odd = rng.int(2);
    const pair = DAMAGE_OVERLAY_VOICES[player] ?? DAMAGE_OVERLAY_VOICES[0];
    events?.emit("sound.play", { id: pair[odd] });
  }
}

/** `0x30` — the shake a consumed hit starts. */
export const SCREEN_SHAKE_HIT_FRAMES = 0x30;
/** `timer * 3 << 11` — the shake's phase step, BAMS a frame. */
export const SCREEN_SHAKE_PHASE_STEP = 0x1800;
/** `float [0x004EC8CC]` — the amplitude per frame left, 1.0. */
export const SCREEN_SHAKE_GAIN = 1.0;

/**
 * `UpdateScreenShake` — `FUN_00415270`, run first by
 * `SelectAttackablePlayer` (`FUN_00414F40`).
 *
 * The consumer of `g_player_was_hit`: a latched hit is cleared and restarts
 * the shake at `0x30` frames. Both players' latches are tested every frame,
 * player 0 first, and either one restarts it. Then one frame comes off and the
 * pitch is `ftol(cos(frames * 0x1800 BAMS) * frames)` -- the FPU's `FCOS` is
 * still on the stack into the `FMULP` at `0x004152EF`, which is the argument
 * the decompiler dropped (L1). `__ftol` truncates toward zero.
 *
 * `0x009CA0E0` is zeroed on both arms and read by nothing the port has; it is
 * not carried.
 */
export function UpdateScreenShake(): void {
  let frames = G.g_screen_shake_frames;
  if (G.g_player_was_hit[0] === 1) {
    G.g_player_was_hit[0] = 0;
    frames = SCREEN_SHAKE_HIT_FRAMES;
  }
  if (G.g_player_was_hit[1] === 1) {
    G.g_player_was_hit[1] = 0;
    frames = SCREEN_SHAKE_HIT_FRAMES;
  }
  frames -= 1;
  G.g_screen_shake_frames = frames;
  if (!(frames > 0)) {
    G.g_screen_shake_frames = 0;
    G.g_screen_shake_pitch = 0;
    return;
  }
  const phase = (frames * SCREEN_SHAKE_PHASE_STEP) * (Math.PI * 2 / 65536);
  G.g_screen_shake_pitch =
    Math.trunc(Math.cos(phase) * frames * SCREEN_SHAKE_GAIN);
}
