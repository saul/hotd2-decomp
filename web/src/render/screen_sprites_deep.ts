/**
 * The screen sprites that sit **behind** the 3D: the ones drawn deeper than
 * the HUD's plane.
 *
 * `DrawScreenSprite`'s depth argument is a real depth. `DrawSpriteQuadCommand`
 * (`FUN_004A7AB0`) turns it into the quad's z-buffer value through the same
 * projection the scene uses and its rhw into `1 / depth`, so a sprite is
 * depth-tested against the 3D like anything else. The HUD's readouts are
 * drawn at 1.0 and 0.98 -- nearer than anything in a scene -- and the HUD
 * canvas, which sits over the WebGL canvas, is the right place for them. The
 * game-over route map's tiles are drawn at **120**, and the figures walking
 * over them stand at 100: the map is behind the figures, and a canvas over
 * the view would put it in front.
 *
 * So a sprite deeper than 1.0 is drawn here instead, as a textured quad in a
 * group that rides the camera, `depth` in front of the eye and sized so it
 * covers exactly the screen pixels the engine's quad covers: at depth `d` a
 * pixel is `d / g_projection_distance_px` units. `[port-only]` as a split;
 * the picture is the engine's.
 */
import {
  AlwaysDepth, DoubleSide, Group, LessEqualDepth, Mesh, MeshBasicMaterial,
  PlaneGeometry, SRGBColorSpace, type Texture, TextureLoader,
} from "three";
import type { System } from "../core/system";
import { G } from "../game/globals";
import { PROJECTION_DISTANCE_PX } from "../game/scene_lights";
import type { RenderContext } from "./context";

/** The PVR2 compare mode whose `g_ZFuncTable` entry is `D3DCMP_ALWAYS`. */
const ZFUNC_MODE_ALWAYS = 7;

/**
 * `DrawSpriteQuadCommand`'s compare mode for a sprite's flags word: bits 8..10,
 * with 0 standing for 4 (`if (uVar7 == 0) uVar7 = 4`).
 */
function ScreenSpriteZFuncMode(flags: number): number {
  const m = (flags >> 8) & 7;
  return m === 0 ? 4 : m;
}

/** The HUD's plane: sprites at this depth or nearer are the HUD layer's. */
export const SCREEN_SPRITE_HUD_DEPTH = 1;

const SCREEN_W = 640;
const SCREEN_H = 480;

/** One sprite's image, as the bundle carries it. */
export interface DeepSpriteImage {
  w: number;
  h: number;
  url: string;
}

export class ScreenSpritesDeep implements System<RenderContext> {
  readonly id = "render.screen_sprites_deep";
  readonly group = new Group();
  /** The bundle's images, by sprite id. Installed at stage load. */
  images: (id: number) => DeepSpriteImage | null = () => null;
  private readonly textures = new Map<string, Texture>();
  private readonly loader = new TextureLoader();
  private readonly geometry = new PlaneGeometry(1, 1);
  private quads: Mesh<PlaneGeometry, MeshBasicMaterial>[] = [];

  constructor() {
    this.group.name = "screen_sprites_deep";
    this.group.matrixAutoUpdate = false;
    // Drawn on the game-over screen too, which hides everything else.
    this.group.userData.keepOnGameOver = true;
  }

  update(ctx: RenderContext): void {
    this.group.matrix.copy(ctx.camera.matrixWorld);
    this.group.matrixWorldNeedsUpdate = true;
    const d = PROJECTION_DISTANCE_PX;
    let n = 0;
    for (const s of G.g_screen_sprite_draws) {
      if (s.depth <= SCREEN_SPRITE_HUD_DEPTH) continue;
      const img = this.images(s.id);
      if (!img) continue;
      const tex = this.texture(img.url);
      let q = this.quads[n];
      if (!q) {
        q = new Mesh(this.geometry, new MeshBasicMaterial({
          transparent: true, side: DoubleSide, depthWrite: true,
        }));
        q.frustumCulled = false;
        this.group.add(q);
        this.quads.push(q);
      }
      if (q.material.map !== tex) {
        q.material.map = tex;
        q.material.needsUpdate = true;
      }
      q.material.opacity = Math.max(0, Math.min(1, s.alpha));
      // The depth test is the sprite's own: `DrawSpriteQuadCommand`
      // (`FUN_004A7AB0`) puts `flags >> 8 & 7` (0 meaning 4) into the PVR2
      // ISP word's compare mode, and `TranslatePvr2StateToD3D` sends
      // `g_ZFuncTable[mode]` as `D3DRENDERSTATE_ZFUNC`. The table is
      // `[1, 7, 3, 5, 4, 6, 2, 8]`, so the default 4 is `D3DCMP_LESSEQUAL`
      // and the 7 every queued sprite carries is `D3DCMP_ALWAYS` -- the boss
      // health bar is never hidden by anything in the scene.
      q.material.depthFunc = ScreenSpriteZFuncMode(s.flags) === ZFUNC_MODE_ALWAYS
        ? AlwaysDepth : LessEqualDepth;
      // The anchor, in half-extents from the top-left -- as the HUD layer
      // places it -- then the quad's centre in screen pixels.
      const w = img.w * s.sx;
      const h = img.h * s.sy;
      const a = s.flags & 0xf;
      const ax = a === 0 ? 1 : a & 3;
      const ay = a === 0 ? 1 : (a >> 2) & 3;
      const cx = s.x + (1 - ax) * w / 2 + w / 2;
      const cy = s.y + (1 - ay) * h / 2 + h / 2;
      const k = s.depth / d;
      q.position.set((cx - SCREEN_W / 2) * k, (SCREEN_H / 2 - cy) * k,
                     -s.depth);
      q.scale.set(w * k, h * k, 1);
      q.visible = true;
      n += 1;
    }
    for (let i = n; i < this.quads.length; i++) this.quads[i].visible = false;
  }

  private texture(url: string): Texture {
    let t = this.textures.get(url);
    if (!t) {
      t = this.loader.load(url);
      t.colorSpace = SRGBColorSpace;
      this.textures.set(url, t);
    }
    return t;
  }
}
