/**
 * Where the camera is, as plain numbers.
 *
 * The port needs four things from the camera and none of them is a `Camera`:
 * the eye, the yaw, a point in front of it, and an actor's position in its own
 * space. Every one of those is a multiply by one of two matrices. Naming
 * `PerspectiveCamera` to get them made `GameSystem` — the adapter that *is*
 * the port's frame — the one system in the engine's half that could not run
 * without a browser, which is the same thing as saying the port could not be
 * tested against its own snapshot.
 *
 * So the camera crosses the seam as sixteen floats twice. `render/` fills this
 * in from the three.js camera it drew with; `game/` reads it and does not know
 * where it came from.
 *
 * The multiply below is `Vector3.applyMatrix4` transcribed, column-major
 * elements and the perspective divide included, so a value that used to come
 * back from three comes back bit-for-bit the same from here.
 */

/** What the port passes and receives. Structurally `game/vec.ts`'s `Vec3`. */
interface XYZ { x: number; y: number; z: number }

/** Column-major, sixteen elements — `Matrix4.elements`' own layout. */
type Mat4 = ArrayLike<number>;

export class CameraFrame {
  /** The camera's world position. */
  readonly eye: XYZ = { x: 0, y: 0, z: 0 };
  /**
   * `g_camera_yaw_bams` — the heading on its own, in the engine's 65536ths.
   *
   * Class 0x31 wants this rather than the whole matrix: the leap aside builds
   * its landing point with a bare `MatrixRotateY`, and the wall search refuses
   * unless the actor faces within 0x2000 of it.
   */
  yawBams = 0;

  private readonly world = new Float64Array(16);
  private readonly inverse = new Float64Array(16);

  /**
   * The transform pair, copied out of whatever produced it.
   *
   * Separate from `place` below, and called **before** it, because the two are
   * not read at the same instant. In free roam the viewer moves the camera
   * after the last draw, so these matrices are a frame behind the eye that
   * `place` takes — and that is the state the port has always run against.
   * Folding the two into one call would quietly correct a staleness the
   * gameplay is tuned around.
   */
  take(world: Mat4, inverse: Mat4): void {
    for (let i = 0; i < 16; i++) {
      this.world[i] = world[i];
      this.inverse[i] = inverse[i];
    }
  }

  /**
   * Where it is and which way it faces, now.
   *
   * `forward` is the camera's own -Z in world space, normalised — what
   * `Camera.getWorldDirection` hands back. The yaw is rounded to the engine's
   * 65536ths here so that there is one definition of it rather than one per
   * caller.
   */
  place(eye: XYZ, forward: XYZ): void {
    this.eye.x = eye.x; this.eye.y = eye.y; this.eye.z = eye.z;
    const bams = Math.round(
      Math.atan2(forward.x, forward.z) * 65536 / (Math.PI * 2));
    this.yawBams = (bams % 65536 + 65536) % 65536;
  }

  /** A point in the camera's own space, in world coordinates. */
  toWorld(x: number, y: number, z: number, out: XYZ): void {
    apply(this.world, x, y, z, out);
  }

  /** A point in world coordinates, in the camera's own space. */
  toView(x: number, y: number, z: number, out: XYZ): void {
    apply(this.inverse, x, y, z, out);
  }
}

function apply(e: ArrayLike<number>, x: number, y: number, z: number,
               out: XYZ): void {
  const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
  out.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
  out.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
  out.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
}
