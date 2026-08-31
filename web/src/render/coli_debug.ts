/**
 * The game's own `coli/` collision, drawn.
 *
 * The port traces against these quads and nothing else — the ground under an
 * actor, the wall a `zstin` leaps at, the floor `ThrowerStateLeapAside` drops
 * its landing point onto. When an enemy ends up somewhere it should not be,
 * the first question is whether the collision it is consulting looks anything
 * like the level, and until now there was no way to look.
 *
 * Two things it is deliberate about:
 *
 * * **It draws only what is selected.** `G.g_coli_full_set` and
 *   `g_coli_ray_set` are the two lists the script's own opcodes fill, and a
 *   quad in neither is not tested by anything. Drawing every blob in the file
 *   would show a level the game cannot feel.
 * * **It colours by which set.** Amber for the sphere-and-segment set, blue
 *   for the ray-only one — the distinction `ColiTestSphereAgainstFullSet`
 *   makes and `ColiTraceSegmentAllSets` does not.
 *
 * The quads are one-sided in the engine: `quadVsSegment` takes one only from
 * behind. The mesh is drawn `DoubleSide` anyway, because a one-sided debug
 * overlay disappears exactly when you most want to see it, and the winding is
 * shown by the normal spikes instead.
 */
import {
  BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments,
  Mesh, MeshBasicMaterial, DoubleSide, type Object3D,
} from "three";
import type { ColiJson } from "../bundle/script";
import { G } from "../game/globals";

/** Amber: the full set, which both the sphere and the segment tests use. */
const FULL_COLOUR = 0xffa53d;
/** Blue: ray-only, which the sphere test ignores. */
const RAY_COLOUR = 0x4da6ff;
/** How far a normal spike sticks out, in world units. */
const NORMAL_LEN = 6;

export class ColiDebugLayer {
  private root: Group | null = null;
  private json: ColiJson | null = null;
  /** The set membership the mesh was built for, so it rebuilds when it moves. */
  private builtFor = "";
  private enabled = false;

  attach(parent: Object3D, coli: ColiJson | undefined): void {
    this.detach();
    this.json = coli ?? null;
    this.root = new Group();
    this.root.name = "coli_debug";
    this.root.visible = false;
    parent.add(this.root);
  }

  detach(): void {
    this.root?.removeFromParent();
    this.root = null;
    this.json = null;
    this.builtFor = "";
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.root) this.root.visible = on;
    if (on) this.refresh();
  }

  /** Rebuild when the script has selected a different set of blobs. */
  refresh(): void {
    if (!this.enabled || !this.root || !this.json) return;
    const key = `${G.g_coli_full_set.join(",")}|${G.g_coli_ray_set.join(",")}`;
    if (key === this.builtFor) return;
    this.builtFor = key;
    this.clear();
    this.build(G.g_coli_full_set, FULL_COLOUR);
    // A blob in both lists is drawn once, in the full set's colour: that is
    // the one whose behaviour is the superset.
    this.build(G.g_coli_ray_set.filter((k) => !G.g_coli_full_set.includes(k)),
               RAY_COLOUR);
  }

  private clear(): void {
    for (const c of [...(this.root?.children ?? [])]) {
      c.removeFromParent();
      const m = c as Mesh;
      m.geometry?.dispose?.();
      (m.material as { dispose?(): void })?.dispose?.();
    }
  }

  private build(keys: readonly string[], colour: number): void {
    if (!this.root || !this.json) return;
    const pos: number[] = [];
    const edge: number[] = [];
    const norm: number[] = [];
    for (const key of keys) {
      const b = this.json.blobs[key];
      if (!b) continue;
      for (let i = 0; i < b.n; i++) {
        const v = b.verts.slice(i * 12, i * 12 + 12);
        if (v.length < 12) continue;
        const p = [0, 1, 2, 3].map((k) => v.slice(k * 3, k * 3 + 3));
        // Two triangles, wound as the quad is.
        pos.push(...p[0], ...p[1], ...p[2], ...p[0], ...p[2], ...p[3]);
        for (let k = 0; k < 4; k++) {
          edge.push(...p[k], ...p[(k + 1) & 3]);
        }
        // The plane normal, from the centre, so the winding is visible.
        const c = [0, 1, 2].map((k) => (p[0][k] + p[1][k] + p[2][k] + p[3][k]) / 4);
        const nx = b.plane[i * 4], ny = b.plane[i * 4 + 1],
              nz = b.plane[i * 4 + 2];
        norm.push(c[0], c[1], c[2],
                  c[0] + nx * NORMAL_LEN, c[1] + ny * NORMAL_LEN,
                  c[2] + nz * NORMAL_LEN);
      }
    }
    if (!pos.length) return;

    const face = new BufferGeometry();
    face.setAttribute("position",
                      new BufferAttribute(new Float32Array(pos), 3));
    const mesh = new Mesh(face, new MeshBasicMaterial({
      color: colour, transparent: true, opacity: 0.18, side: DoubleSide,
      depthWrite: false,
    }));
    mesh.renderOrder = 900;
    this.root.add(mesh);

    const wire = new BufferGeometry();
    wire.setAttribute("position",
                      new BufferAttribute(new Float32Array(edge), 3));
    const lines = new LineSegments(wire, new LineBasicMaterial({
      color: colour, transparent: true, opacity: 0.75, depthWrite: false,
    }));
    lines.renderOrder = 901;
    this.root.add(lines);

    const spikes = new BufferGeometry();
    spikes.setAttribute("position",
                        new BufferAttribute(new Float32Array(norm), 3));
    const normals = new LineSegments(spikes, new LineBasicMaterial({
      color: colour, transparent: true, opacity: 0.35, depthWrite: false,
    }));
    normals.renderOrder = 902;
    this.root.add(normals);
  }

  /** For the status line: how many quads are actually selected right now. */
  get describe(): string {
    if (!this.json) return "none";
    const count = (keys: readonly string[]) =>
      keys.reduce((n, k) => n + (this.json?.blobs[k]?.n ?? 0), 0);
    const full = count(G.g_coli_full_set);
    const ray = count(G.g_coli_ray_set.filter(
      (k) => !G.g_coli_full_set.includes(k)));
    return `${full} quads selected, ${ray} ray-only`;
  }
}
