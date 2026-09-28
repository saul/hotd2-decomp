/**
 * The stage-1 banners' wave, drawn -- the vertex walk of `PropUpdateType45`
 * (`FUN_0046DAB0`), from the clocks `game/class41/type45.ts` keeps.
 *
 * The routine rewrites the vertex data of four models in place
 * (`TYPE45_WAVE_SLOTS`), one after another, each at the wave's clock as it
 * stood when the walk reached it. So the bend is the **model's**: every draw
 * of the slot shows it, and it outlasts the object. The port keeps the model's
 * state as the one number it was written from (`G.g_prop45_wave_clock`), and
 * this is the walk that turns the number back into vertices -- the same split
 * as `render/water_surfaces.ts` and `WaterSurfaceUpdate`'s UV walk.
 *
 * It rewrites the **templates'** geometry, which every clone of a slot shares
 * (`render/breakables.ts`), as every engine draw of the slot reads the one
 * model. Each vertex is recomputed from its authored position, so a frame and
 * a load are the same call and nothing here is state a snapshot needs.
 *
 * **An opaque-pass mesh shows the bend before this frame's.** The routine's
 * draws are submitted before its walk, and `RenderEnqueueCommand`
 * (`FUN_004A7E50`) draws a model's opaque-pass meshes at submission while the
 * rest wait for `RenderFlushCommandList` (`FUN_004A88E0`) at the frame's end
 * (`render/draw_order.ts`) `[likely]` -- from where the two passes read the
 * vertex data, not from a capture. So an opaque mesh takes
 * `G.g_prop45_wave_clock_drawn` and a translucent one `G.g_prop45_wave_clock`.
 *
 * The NL1 back-reference records the walk skips are slots that reuse a vertex
 * (`WalkMeshChainAndDraw`, `FUN_004A7EF0`; `docs/formats/nl1.md`), so walking
 * every glTF vertex walks each real vertex once.
 */
import {
  type BufferAttribute, type BufferGeometry, Matrix4, type Mesh, type Object3D,
  Vector3,
} from "three";
import { BAMS_TO_RAD_F64 } from "../core/bams";
import { G } from "../game/globals";
import {
  TYPE45_WAVE_AMPLITUDE, TYPE45_WAVE_MODEL_LEAD, TYPE45_WAVE_SHIFT,
  TYPE45_WAVE_SLOTS, TYPE45_WAVE_UNBENT,
} from "../game/class41/type45";
import { isOpaquePass, pvr2Words } from "./draw_order";

/**
 * The Z the wave gives a vertex at height `y` of model `k`, bent while the
 * clock read `clock` -- or `null` for a vertex it leaves alone.
 *
 * ```
 * 0046dc80  FLD [ESI+4] ; FLD ST0 ; CALL __ftol       ; lag = ftol(y)
 * 0046dc93  JZ  0x0046dce1                             ; lag 0: z kept
 * 0046dc9b  ECX = ((EDI - lag) << 9) + obj->+0x1D0 ; AND ECX, 0xFFFF
 * 0046dcbe  FILD ; FMUL double [0x004C4370] ; FSIN
 * 0046dccc  FXCH ; FMUL [0x0056470C] ; FMULP ; FSTP float -> [ESI+8]
 * ```
 *
 * `EDI` is `5 k`; `clock` is `obj+0x1D0` before model `k`'s own `+0x200`,
 * which is what `G.g_prop45_wave_clock[k]` holds.
 */
export function bannerWaveZ(k: number, y: number,
                            clock: number): number | null {
  const lag = Math.trunc(y);
  if (lag === 0) return null;
  const bams = ((((TYPE45_WAVE_MODEL_LEAD * k - lag) << TYPE45_WAVE_SHIFT)
                 + clock) & 0xffff);
  return Math.fround(Math.sin(bams * BAMS_TO_RAD_F64)
                     * (y * TYPE45_WAVE_AMPLITUDE));
}

/** One geometry, as authored, in its model's space. */
interface Authored {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  toMesh: Matrix4;
  /** The clock last written into it, so an unchanged model is not rewalked. */
  applied: number;
}

/** What this needs of the breakables layer: the template of a slot. */
export interface BannerWaveTemplates {
  get(slot: number): Object3D | undefined;
}

export class BannerWave {
  private readonly authored = new Map<BufferGeometry, Authored>();

  /** The templates are the stage's; forget their geometry with them. */
  clear(): void {
    this.authored.clear();
  }

  /**
   * Bring every banner template's vertices to the state the port holds.
   * Not a layer of its own: `render/breakables.ts`, which owns the
   * templates, calls it from its `update`.
   */
  apply(templates: BannerWaveTemplates): void {
    TYPE45_WAVE_SLOTS.forEach((slot, k) => {
      const t = templates.get(slot);
      if (!t) return;
      const now = G.g_prop45_wave_clock[k] ?? TYPE45_WAVE_UNBENT;
      const drawn = G.g_prop45_wave_clock_drawn[k] ?? TYPE45_WAVE_UNBENT;
      let rootInv: Matrix4 | null = null;
      t.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const mat = Array.isArray(mesh.material) ? mesh.material[0]
          : mesh.material;
        const w = mat ? pvr2Words(mat) : null;
        const opaque = w !== null && isOpaquePass(w.tsp);
        if (!rootInv) {
          t.updateMatrixWorld(true);
          rootInv = t.matrixWorld.clone().invert();
        }
        this.bend(mesh, rootInv, k, opaque ? drawn : now);
      });
    });
  }

  /** One geometry at one clock, or as authored at `TYPE45_WAVE_UNBENT`. */
  private bend(mesh: Mesh, rootInv: Matrix4, k: number, clock: number): void {
    const geo = mesh.geometry as BufferGeometry;
    const pos = geo.attributes.position as BufferAttribute | undefined;
    if (!pos) return;
    let a = this.authored.get(geo);
    if (!a) {
      const toModel = rootInv.clone().multiply(mesh.matrixWorld);
      const x = new Float32Array(pos.count);
      const y = new Float32Array(pos.count);
      const z = new Float32Array(pos.count);
      const v = new Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(toModel);
        x[i] = v.x; y[i] = v.y; z[i] = v.z;
      }
      a = { x, y, z, toMesh: toModel.clone().invert(),
            applied: TYPE45_WAVE_UNBENT };
      this.authored.set(geo, a);
    }
    if (a.applied === clock) return;
    a.applied = clock;
    const v = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      const bent = clock === TYPE45_WAVE_UNBENT ? null
        : bannerWaveZ(k, a.y[i], clock);
      v.set(a.x[i], a.y[i], bent ?? a.z[i]).applyMatrix4(a.toMesh);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
  }
}
