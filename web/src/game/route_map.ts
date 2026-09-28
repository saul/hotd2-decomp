/**
 * The game-over screen's route map: phases 4 and 5 of `GameOverRunPhase`.
 *
 * A figure walks the route this run took over a scrolling map, leaving
 * footprints, and when the route is drawn it blends into its end pose, holds
 * it for 0x78 frames and the screen hands on. All of it is the engine's:
 *
 * * `GameOverRouteMapArm` (`FUN_00460F00`) -- an empty history gets the
 *   default route (`0x0059351C`), the walk's cursor and target are seeded, and
 *   `GameOverBuildRouteTasks` builds the list;
 * * `GameOverBuildRouteTasks` (`FUN_00460FF0`) -- the camera block reset with
 *   its eye 7 back (`FUN_004610D0`), the camera tasks (which make the bodies),
 *   the player tasks, `SpawnAttackablePlayerTask`, one or two figures by who
 *   is on the screen, and `RouteMapDrawTask`;
 * * `RouteMapDrawTask` (`FUN_00461180`) -- moves the target along the history
 *   whenever the cursor reaches it, raises the done word when the history
 *   runs out, and draws the map's four 640x480 screens of 5x15 tiles through
 *   `DrawScreenSprite`, scrolled;
 * * the figure tasks, `RouteFigureTick` (`FUN_004614C0`) and
 *   `RoutePartnerTick` (`FUN_004618C0`) -- step the cursor 4 map pixels a frame
 *   toward the target, scroll, turn the figure, drop a footprint
 *   (`RouteMarkSpawn`, `FUN_00461A90`), place the figure in view space and draw
 *   it with its ground disc;
 * * `GameOverRouteMapWait` (`FUN_004610F0`) -- the trigger, or the done word
 *   at -1, ends the screen.
 *
 * **In view space.** Every 3D thing on this screen is placed at a camera-space
 * point about 100 in front of the eye: the figures through the camera block's
 * own matrix, the discs and footprints with the matrix stack loaded with the
 * identity -- which is camera space, because the stack's base is the
 * world-to-view matrix (`SkeletonBuildAndPose` starts from it). So the records
 * here hold camera-space points, and `render/game_over_scene.ts` draws them in
 * a group that rides the camera. `[proved]` for the maths; the one-frame
 * placement is the same either way.
 */
import { G } from "./globals";
import { ROUTE_FIGURES, ROUTE_FIGURE_PAIR_OFFSET, ROUTE_MARK_SLOTS }
  from "./player_body_data";
import { PlayerTasksCreate, PlayerTasksRun, type PlayerFrame }
  from "./player_shell";
import { PlayerState } from "./player_state";
import { PlayerBodiesCreate } from "./player_body";
import { CameraBlocksReset } from "./camera/actions";
import { UpdateSceneViewAndLight } from "./camera/view";
import { DrawScreenSprite } from "./screen_sprite";
import { PROJECTION_DISTANCE_PX } from "./scene_lights";
import { T } from "./tables";
import { vec3, type Vec3 } from "./vec";

/** The walk's state, `0x007DCCD8`..`0x007DCCFE`. */
export interface RouteMapState {
  /** `0x007DCCD8` -- how far the map has scrolled, in map pixels. */
  scroll: number;
  /** `0x007DCCE0` -- the footprint's model slot. */
  markSlot: number;
  /** `0x007DCCE6` -- which stage's history the walk is in. */
  stage: number;
  /** `0x007DCCE8` -- the block whose waypoints it is walking. */
  block: number;
  /** `0x007DCCEA` -- this frame's step: 0 still, 2/4/6/8 a direction. */
  dir: number;
  /** `0x007DCCEC` -- the waypoint within the block. */
  wp: number;
  /** `0x007DCCEE` -- the entry within the stage's history. */
  entry: number;
  /** `0x007DCCF4` -- the cursor's map y. */
  cursorY: number;
  /** `0x007DCCF8` -- the target, `{s16 x, s16 y}`. */
  targetX: number;
  targetY: number;
  /** `0x007DCCFC` -- the cursor's screen y offset. */
  screenY: number;
  /** `0x007DCCFE` -- the cursor's map x. */
  cursorX: number;
}

/** One figure: a skinned body on a walk clip, drawn in view space. */
export interface RouteFigure {
  /** `[port-only]` -- 0 the player figure, 1 the partner. */
  kind: number;
  /** `obj+0x1F4`. */
  charType: number;
  /** `obj+0x1B4`. */
  motion: number;
  /** `obj+0x194`, the frame counter the draw steps once a frame. */
  playTicks: number;
  /**
   * `ActorSetMotionBlended`'s fade: the clip it came from, the frames left and
   * the length -- as the port's `Actor` carries them.
   */
  fadeFrom: { motion: number; ticks: number } | null;
  fade: number;
  fadeLen: number;
  /** `obj+0x1350` -- the clip it blends into when the route is drawn. */
  end: number;
  /** `obj+0x1354` -- its x offset beside a partner. */
  xOff: number;
  /** `obj+0x1358` -- the frames it has held the end clip. */
  held: number;
  /** `obj+0x64`, `+0x68`, BAMS: X is 0x4000, lying flat; Y by direction. */
  pitch: number;
  yaw: number;
  /**
   * `[port-only]` -- the camera-space point the task pushed through the
   * camera block's matrix into `obj+0x40`; the renderer draws it there.
   */
  view: Vec3;
  /** `[port-only]` -- the ground disc's camera-space point. */
  disc: Vec3;
}

/** One footprint, `RouteMarkSpawn`'s task: a map point and how to place it. */
export interface RouteMark {
  /** `+0x34`, `+0x38`. */
  x: number;
  y: number;
  /** `+0x40`: 0 below the scroll line, 1 while scrolling, 2 past its end. */
  mode: number;
  /** `+0x3C`, the count a mode no step makes runs to 1000. */
  age: number;
  /**
   * `[port-only]` -- where this frame's `RouteMarkTick` drew it, a camera-space
   * point; `drawn` 0 until its first walk, and for a mode that draws nothing.
   */
  view: Vec3;
  drawn: number;
}

/** `FUN_004610D0`: the camera block's eye z on this screen. */
const ROUTE_CAMERA_EYE_Z = -7;
/** The cursor's step, map pixels a frame. */
const ROUTE_STEP = 4;
/** Past this map y the map stops scrolling and the cursor moves instead. */
const ROUTE_SCROLL_END = 0x578;
/** The frames the end clip is held before the screen hands on. */
const ROUTE_END_HOLD = 0x78;
/** The end clip's cross-fade. */
const ROUTE_END_FADE = 10;
/** Stage 4's shortcut block, and the waypoint it starts the next stage at. */
const ROUTE_STAGE4_SHORTCUT_BLOCK = 0x19;
const ROUTE_STAGE4_SHORTCUT_WP = 3;
/** The map's four screens, and each one's 5 x 15 tiles of 128 x 32. */
const ROUTE_TILE_COLS = 5;
const ROUTE_TILE_W = 0x80;
const ROUTE_TILE_H = 0x20;
const ROUTE_SCREEN_H = 0x1e0;
const ROUTE_SCROLL_WRAP = 0x780;
/** `DrawScreenSprite`'s depth for a tile: 120.0 (`0x42F00000`). */
const ROUTE_TILE_DEPTH = 120;
/** The figures stand 100 in front of the eye, the discs 99.5, marks 101. */
const FIGURE_DEPTH = -100;
const DISC_DEPTH = -99.5;
const MARK_DEPTH = -101;

/** The waypoint table's shape: 6 stages of 0x27 blocks of 6 waypoints. */
const WAYPOINT_STAGES = 6;
const WAYPOINT_BLOCKS = 0x27;
const WAYPOINTS_PER_BLOCK = 6;

/**
 * `0x00567A04 + ((wp + (stage * 0x27 + block) * 6) * 4)`, read as the engine
 * reads it: one flat index, so a block of -1 -- which is what the done word's
 * frame leaves behind -- reads the entries before its own. The two entries
 * before the table are `0x005679FC`, the tile bases; anything further out is
 * `[open]` and reads as the end marker.
 */
function waypoint(stage: number, block: number, wp: number): [number, number] {
  const idx = wp + (stage * WAYPOINT_BLOCKS + block) * WAYPOINTS_PER_BLOCK;
  const go = T.gameOver;
  if (!go) return [-1, -1];
  if (idx < 0) {
    const t = go.route_tiles;
    if (idx === -1) return [t[2] ?? -1, t[3] ?? -1];
    if (idx === -2) return [t[0] ?? -1, t[1] ?? -1];
    return [-1, -1];
  }
  const per = WAYPOINT_BLOCKS * WAYPOINTS_PER_BLOCK;
  const st = Math.floor(idx / per);
  if (st >= WAYPOINT_STAGES) return [-1, -1];
  const rem = idx - st * per;
  const w = go.route_waypoints[st]?.[Math.floor(rem / WAYPOINTS_PER_BLOCK)]
    ?.[rem % WAYPOINTS_PER_BLOCK];
  return w ? [w[0], w[1]] : [-1, -1];
}

/**
 * `g_route_history` read flat, `(s8)0x009A5920[stage * 16 + i]`, as
 * `RouteMapDrawTask` reads it: an entry past a stage's sixteen is the next
 * stage's first.
 */
function historyAt(stage: number, i: number): number {
  const idx = stage * 16 + i;
  return G.g_route_history[Math.floor(idx / 16)]?.[idx % 16] ?? -1;
}

/**
 * `GameOverRouteMapArm` — `FUN_00460F00`, phase 4. An empty history -- nothing
 * recorded for stage 1, or stage 1's second entry block 0 -- is replaced with
 * the default route; the cursor starts at `(-16, -146)` with the screen offset
 * at 146, the target at the first block's first waypoint, and the list is
 * built.
 */
export function GameOverRouteMapArm(f: PlayerFrame): void {
  const h = G.g_route_history;
  if ((h[0]?.[0] ?? -1) === -1 || (h[0]?.[1] ?? -1) === 0) {
    const def = T.gameOver?.default_route ?? [];
    for (let st = 0; st < def.length; st++) {
      for (let i = 0; i < 16; i++) {
        h[st][i] = def[st][i];
        if (def[st][i] === -1) break;
      }
    }
  }
  const block = historyAt(0, 0);
  const [tx, ty] = waypoint(0, block, 0);
  G.g_route_map = {
    scroll: 0, markSlot: 0, stage: 0, block, dir: 8, wp: 0, entry: 0,
    cursorY: -146, targetX: tx, targetY: ty, screenY: 0x92, cursorX: -16,
  };
  G.g_game_over_route_done = 0;
  G.g_route_marks = [];
  GameOverBuildRouteTasks();
  G.g_nRunPhase += 1;
  void f;
}

/**
 * `GameOverBuildRouteTasks` — `FUN_00460FF0`. The camera block reset with
 * its eye at z -7 (`FUN_004610D0`), the camera tasks' bodies, the player
 * tasks, and the figures: player 1's alone (type `0x39`) when only player 1
 * is at state 6, player 2's alone (`0x3A`, footprint `0x14D2`) when only
 * player 2 is, and otherwise player 1's `0x18` to the side with the partner
 * beside it. Then `RouteMapDrawTask`.
 *
 * The view is built from the block's angles, which the reset zeroes: a camera
 * at `(0, 0, -7)` looking down its own -Z. `RouteCameraTaskCreate`
 * (`FUN_004610D0`) allocates `UpdateSceneViewAndLight` as the list's first
 * task, so {@link GameOverRouteTasksWalk} builds the view every frame.
 */
export function GameOverBuildRouteTasks(): void {
  CameraBlocksReset();
  G.g_camera_block_eye.z = ROUTE_CAMERA_EYE_Z;
  PlayerBodiesCreate();
  PlayerTasksCreate();
  const p1 = G.g_player_state[0] === PlayerState.GameOver;
  const p2 = G.g_player_state[1] === PlayerState.GameOver;
  G.g_route_figures = [];
  if (p1 && !p2) {
    G.g_route_map.markSlot = ROUTE_MARK_SLOTS[0];
    GameOverSpawnPlayerFigure(ROUTE_FIGURES[0], 0);
  } else if (!p1 && p2) {
    G.g_route_map.markSlot = ROUTE_MARK_SLOTS[1];
    GameOverSpawnPlayerFigure(ROUTE_FIGURES[1], 0);
  } else {
    G.g_route_map.markSlot = ROUTE_MARK_SLOTS[0];
    GameOverSpawnPlayerFigure(ROUTE_FIGURES[0], ROUTE_FIGURE_PAIR_OFFSET);
    GameOverSpawnPartnerFigure();
  }
}

/**
 * `GameOverSpawnPlayerFigure` — `FUN_004613C0`. A skinned actor on the walk
 * clip, lying flat (`obj+0x64 = 0x4000`), with its end clip and x offset. In
 * Original Mode the type comes from the character byte, which is only ever the
 * player's own (see `PlayerBodiesCreate`), so it is the type named.
 */
export function GameOverSpawnPlayerFigure(
    spec: { charType: number; walk: number; end: number },
    xOff: number): void {
  G.g_route_figures.push(makeFigure(0, spec.charType, spec.walk, spec.end,
                                    xOff));
}

/**
 * `GameOverSpawnPartnerFigure` — `FUN_004617F0`. Type `0x3A` on `0x358`, its
 * frame counter at 16 so the two walk out of step, blending into `0x339`.
 */
export function GameOverSpawnPartnerFigure(): void {
  const spec = ROUTE_FIGURES[1];
  const fig = makeFigure(1, spec.charType, spec.walk, spec.end, 0);
  fig.playTicks = 0x10;
  G.g_route_figures.push(fig);
}

function makeFigure(kind: number, charType: number, walk: number, end: number,
                    xOff: number): RouteFigure {
  return {
    kind, charType, motion: walk, playTicks: 0, fadeFrom: null, fade: 0,
    fadeLen: 0, end, xOff, held: 0, pitch: 0x4000, yaw: 0,
    view: vec3(), disc: vec3(),
  };
}

/** `ActorSetMotionBlended(track, motion, 0, fade)` on a figure. */
function FigureSetMotionBlended(fig: RouteFigure, motion: number,
                                fade: number): void {
  if (fig.motion !== motion) {
    fig.fadeFrom = { motion: fig.motion, ticks: fig.playTicks };
    fig.fadeLen = fade + 1;
    fig.fade = fade;
  }
  fig.motion = motion;
  fig.playTicks = 0;
}

/**
 * The yaw each step direction turns a figure to: `obj+0x68` = `0x8000` up the
 * map, `0x4000` for x+, `0xFFFFC000` for x-, 0 down -- the four arms at
 * `RouteFigureTick`'s second switch, copied by `RoutePartnerTick`. The draw
 * (`SkeletonApplyRootMotion`'s tail, `FUN_00410C50`) builds `T(obj+0x40)`, then
 * by `model+0x68` -- 1, `obj+0x1FC` as `GameOverSpawnPlayerFigure` writes it --
 * `RotX(obj+0x64) RotZ(obj+0x6C) RotY(obj+0x68)`: with Z 0 that is `Rx * Ry`,
 * three.js's Euler `"XYZ"`, and the same BAMS sign every other character in the
 * port is drawn with. The block's angles are zero on this screen, so camera
 * space and world space share their axes. `[proved]`
 */
function FigureTurn(fig: RouteFigure, dir: number): void {
  if (dir === 2) fig.yaw = 0x8000;
  else if (dir === 4) fig.yaw = 0x4000;
  else if (dir === 6) fig.yaw = -0x4000;
  else if (dir === 8) fig.yaw = 0;
}

/**
 * `[port-only]` in spelling: the draw's tail both figure tasks share -- the
 * disc, `DrawSkinnedModelAndShadow`, and `model[0] += 1` -- whose drawing is
 * the renderer's. The counter steps whether or not a fade is running, and a
 * fade holds the incoming clip on its start frame until it is done, as the
 * port's `ActorAdvanceMotion` has it.
 */
function FigureDrawAndStep(fig: RouteFigure, vx: number, vy: number): void {
  fig.view.x = vx;
  fig.view.y = vy;
  fig.view.z = FIGURE_DEPTH;
  fig.disc.x = vx;
  fig.disc.y = vy;
  fig.disc.z = DISC_DEPTH;
  if (fig.fadeFrom) {
    fig.fade -= 1;
    if (fig.fade < 0) {
      fig.playTicks += -fig.fade;
      fig.fadeFrom = null;
      fig.fade = 0;
    }
  } else {
    fig.playTicks += 1;
  }
}

/**
 * `RouteFigureTick` — `FUN_004614C0`, the player figure's task. The done word
 * drives it: 0, pick this frame's step toward the target -- y first, then x,
 * which wins; 1, blend into the end clip over 10 frames and go to 2; 2 and 3,
 * hold 0x78 frames and set -1. Then the step: 2 is up the map, the screen
 * offset growing as the map y falls; 4 and 6 are x; 8 is down the map, which
 * scrolls the map while it can and moves the figure once it cannot. A step
 * leaves a footprint. Last, the figure goes to the camera-space point
 * `((xOff + x) * -100 / d, screenY * -100 / d, -100)`, `d` the projection
 * distance, with its ground disc half a unit nearer.
 */
export function RouteFigureTick(fig: RouteFigure): void {
  const m = G.g_route_map;
  m.dir = 0;
  switch (G.g_game_over_route_done) {
    case 0:
      if (m.cursorY !== m.targetY) m.dir = m.targetY <= m.cursorY ? 2 : 8;
      if (m.cursorX !== m.targetX) m.dir = m.targetX <= m.cursorX ? 6 : 4;
      break;
    case 1:
      fig.held = 0;
      FigureSetMotionBlended(fig, fig.end, ROUTE_END_FADE);
      G.g_game_over_route_done = 2;
      break;
    case 2:
    case 3:
      if (fig.held === ROUTE_END_HOLD) G.g_game_over_route_done = -1;
      fig.held += 1;
      break;
    default:
      break;
  }
  switch (m.dir) {
    case 2:
      m.screenY += ROUTE_STEP;
      m.cursorY -= ROUTE_STEP;
      break;
    case 4:
      m.cursorX += ROUTE_STEP;
      break;
    case 6:
      m.cursorX -= ROUTE_STEP;
      break;
    case 8:
      m.cursorY += ROUTE_STEP;
      if (m.cursorY < ROUTE_SCROLL_END && m.screenY < 1) {
        m.scroll += ROUTE_STEP;
      } else {
        m.screenY -= ROUTE_STEP;
      }
      break;
    default:
      break;
  }
  FigureTurn(fig, m.dir);
  if (m.dir !== 0) {
    if (m.cursorY < ROUTE_SCROLL_END) {
      if (m.screenY < 1) RouteMarkSpawn(m.cursorX, m.scroll, 1);
      else RouteMarkSpawn(m.cursorX, m.screenY, 0);
    } else {
      RouteMarkSpawn(m.cursorX, m.screenY, 2);
    }
  }
  const d = PROJECTION_DISTANCE_PX;
  FigureDrawAndStep(fig, ((fig.xOff + m.cursorX) * -100) / d,
                    (m.screenY * -100) / d);
}

/**
 * `RoutePartnerTick` — `FUN_004618C0`, the partner's. It follows the player
 * figure's step -- the same direction, the same turn -- and on the done word
 * at 2 blends into `0x339` and sets it to 3. It stands `0x18` to the other
 * side and `0x18` further down the screen.
 */
export function RoutePartnerTick(fig: RouteFigure): void {
  const m = G.g_route_map;
  if (G.g_game_over_route_done === 2) {
    FigureSetMotionBlended(fig, fig.end, ROUTE_END_FADE);
    G.g_game_over_route_done = 3;
  }
  FigureTurn(fig, m.dir);
  const d = PROJECTION_DISTANCE_PX;
  FigureDrawAndStep(fig, ((m.cursorX - ROUTE_FIGURE_PAIR_OFFSET) * -100) / d,
                    ((m.screenY + ROUTE_FIGURE_PAIR_OFFSET) * -100) / d);
}

/**
 * `RouteMarkSpawn` — `FUN_00461A90`. A footprint task at a map point, appended
 * to the list's tail.
 */
export function RouteMarkSpawn(x: number, y: number, mode: number): void {
  G.g_route_marks.push({ x, y, mode, age: 0, view: vec3(), drawn: 0 });
}

/**
 * `RouteMarkTick` — `FUN_00461AC0`, one footprint's frame: where it is drawn,
 * as a camera-space point at depth 101 -- mode 0 rides the scroll down from
 * its screen offset, mode 1 from the scroll line, mode 2 stays put -- which the
 * renderer draws with `g_route_mark_slot`. A mode no step makes draws nothing,
 * counts `+0x3C` and kills itself past 1000. Returns false once it has.
 */
export function RouteMarkTick(mk: RouteMark): boolean {
  const d = PROJECTION_DISTANCE_PX;
  let y: number;
  if (mk.mode === 0) {
    y = mk.y + G.g_route_map.scroll;
  } else if (mk.mode === 1) {
    y = G.g_route_map.scroll - mk.y;
  } else if (mk.mode === 2) {
    y = mk.y;
  } else {
    mk.drawn = 0;
    mk.age += 1;
    return mk.age <= 1000;
  }
  mk.view.x = (mk.x * -101) / d;
  mk.view.y = (y * -101) / d;
  mk.view.z = MARK_DEPTH;
  mk.drawn = 1;
  return true;
}

/**
 * `RouteMapDrawTask` — `FUN_00461180`. While the cursor sits on the target,
 * the target moves on: the next waypoint of the block; past the block's last,
 * the next block of the stage's history; past the stage's last, the first
 * block of the next stage's, up to stage 6; past that, the done word goes to 1.
 * Stage 5's first target skips to waypoint 3 when stage 4's history holds
 * block 0x19. Then the map: four screens of 5 x 15 tiles, `DrawScreenSprite`
 * at `(col * 128, scroll % 1920 + row * 32 - screen * 480)`, depth 120.
 */
export function RouteMapDrawTask(): void {
  const m = G.g_route_map;
  for (;;) {
    if (m.cursorX !== m.targetX || m.cursorY !== m.targetY) break;
    m.wp += 1;
    if (waypoint(m.stage, m.block, m.wp)[0] === -1) {
      m.wp = 0;
      m.entry += 1;
      m.block = historyAt(m.stage, m.entry);
      if (m.block === -1) {
        let next = false;
        if (m.stage !== 5) {
          m.stage += 1;
          m.entry = 0;
          m.block = historyAt(m.stage, 0);
          next = m.block !== -1;
        }
        if (!next) {
          m.wp = 0;
          G.g_game_over_route_done = 1;
          break;
        }
      }
    }
    if (m.stage === 4 && m.entry === 0 && m.wp === 0) {
      for (let i = 0; i < 16; i++) {
        if (historyAt(3, i) === ROUTE_STAGE4_SHORTCUT_BLOCK) {
          m.wp = ROUTE_STAGE4_SHORTCUT_WP;
          break;
        }
      }
    }
    const [tx, ty] = waypoint(m.stage, m.block, m.wp);
    m.targetX = tx;
    m.targetY = ty;
  }
  const tiles = T.gameOver?.route_tiles ?? [];
  for (let screen = 0; screen < tiles.length; screen++) {
    for (let row = 0; row < ROUTE_SCREEN_H / ROUTE_TILE_H; row++) {
      for (let col = 0; col < ROUTE_TILE_COLS; col++) {
        DrawScreenSprite(tiles[screen] + row * ROUTE_TILE_COLS + col,
                         col * ROUTE_TILE_W,
                         (m.scroll % ROUTE_SCROLL_WRAP) + row * ROUTE_TILE_H
                           - screen * ROUTE_SCREEN_H,
                         ROUTE_TILE_DEPTH);
      }
    }
  }
}

/**
 * `[port-only]` -- the route list, walked: the view (`UpdateSceneViewAndLight`,
 * the list's first task), the player tasks, the figures, the map, then the
 * footprints (allocated after the map task, so after it in the walk; each is
 * drawn by the renderer from its record). The camera tasks' `CameraUpdateTick`
 * runs scene state (0, 0)'s no-op.
 */
export function GameOverRouteTasksWalk(f: PlayerFrame): void {
  UpdateSceneViewAndLight();
  PlayerTasksRun(f);
  for (const fig of G.g_route_figures) {
    if (fig.kind === 0) RouteFigureTick(fig);
    else RoutePartnerTick(fig);
  }
  RouteMapDrawTask();
  // Every footprint, the one a figure spawned this frame included: `ActorAlloc`
  // appends at the list's tail and the walk follows the next pointers, so it
  // reaches a task allocated ahead of it in the same frame `[likely]`.
  G.g_route_marks = G.g_route_marks.filter((mk) => RouteMarkTick(mk));
}

/**
 * `GameOverRouteMapWait` — `FUN_004610F0`, phase 5. The walk, then: the
 * trigger ends the screen at once, and so does the done word reaching -1.
 * Returns true when the screen is over.
 */
export function GameOverRouteMapWait(f: PlayerFrame, skip: boolean): boolean {
  GameOverRouteTasksWalk(f);
  if (skip) {
    G.g_game_over_route_done = -1;
    return true;
  }
  return G.g_game_over_route_done === -1;
}
