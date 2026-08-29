/**
 * What the player draws on top of the level: camera rails, object rails and
 * spawn markers.
 *
 * The rails are built client-side from the raw Hermite curves rather than
 * imported from the glTF, which is the whole reason the bundle ships curves.
 * A rail drawn here can be recoloured by playback state and can highlight the
 * `start..end` sub-range a single `cam_play` command covers -- neither of
 * which a baked LINEAR animation can express.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  Vector3,
} from "three";
import type { CamPath, CamPaths } from "./campath";
import type { ActiveSpawn } from "./walker";

const RAIL_EYE = 0x26d9ff;
const RAIL_AIM = 0xff8c1a;
const RAIL_OBJ = 0x4dff59;
const RAIL_ACTIVE = 0xffe14d;
const RAIL_DIM = 0x2a3a44;
/** A path with invented channels. Drawn, but never as if it were data. */
const RAIL_DAMAGED = 0xff4d6a;

/** BAMS yaw -> radians. 0x4000 is 90 degrees. */
const BAMS = (Math.PI * 2) / 65536;

function polylineGeometry(points: Float32Array): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(points, 3));
  return g;
}

export class RailLayer {
  readonly group = new Group();
  private readonly eyeLines = new Map<number, Line>();
  private readonly aimLines = new Map<number, Line>();
  private readonly objLines = new Map<number, Line>();
  private readonly activeGroup = new Group();
  private activeSpan: Line | null = null;
  private readonly marker: Mesh;
  private readonly aimMarker: Mesh;
  private readonly link: LineSegments;
  private readonly paths: CamPaths;

  constructor(paths: CamPaths) {
    this.paths = paths;
    this.group.name = "rails";

    const dim = () =>
      new LineBasicMaterial({ color: RAIL_DIM, transparent: true, opacity: 0.5 });

    for (const [slot, p] of paths.paths) {
      const eye = new Line(polylineGeometry(p.polyline(0)), dim());
      const aim = new Line(polylineGeometry(p.polyline(1)), dim());
      eye.name = `rail_eye_${slot}`;
      aim.name = `rail_aim_${slot}`;
      this.eyeLines.set(slot, eye);
      this.aimLines.set(slot, aim);
      this.group.add(eye, aim);
    }
    for (const [slot, p] of paths.objectPaths) {
      const line = new Line(polylineGeometry(p.polyline(0)), dim());
      line.name = `rail_obj_${slot}`;
      this.objLines.set(slot, line);
      this.group.add(line);
    }

    // The live camera: a cone pointing down its own view axis, plus a segment
    // to what it is aimed at.
    const cone = new ConeGeometry(0.6, 1.8, 4);
    cone.rotateX(Math.PI / 2);
    this.marker = new Mesh(cone, new MeshBasicMaterial({ color: RAIL_ACTIVE }));
    this.aimMarker = new Mesh(
      new ConeGeometry(0.4, 0.4, 8),
      new MeshBasicMaterial({ color: RAIL_AIM }),
    );
    this.link = new LineSegments(
      polylineGeometry(new Float32Array(6)),
      new LineBasicMaterial({ color: RAIL_AIM, transparent: true, opacity: 0.6 }),
    );
    this.activeGroup.add(this.marker, this.aimMarker, this.link);
    this.group.add(this.activeGroup);
    this.setCameraMarkerVisible(false);
    this.setAimRailsVisible(false);
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  setObjectRailsVisible(v: boolean): void {
    for (const l of this.objLines.values()) l.visible = v;
  }

  /**
   * The look-at track of every camera path. Off by default: it doubles the
   * line count and mostly clutters, because what a path is aimed at is
   * usually obvious from where it points.
   */
  setAimRailsVisible(v: boolean): void {
    this.aimVisible = v;
    for (const l of this.aimLines.values()) l.visible = v;
    this.aimMarker.visible = v;
    this.link.visible = v;
  }

  private aimVisible = false;

  setCameraMarkerVisible(v: boolean): void {
    this.activeGroup.visible = v;
  }

  /**
   * Highlight one path, and within it the `start..end` sub-range the current
   * command actually plays. Every other rail dims.
   */
  highlight(slot: number | null, start?: number, end?: number): void {
    const dimColor = new Color(RAIL_DIM);
    for (const [s, line] of this.eyeLines) {
      // A damaged path is drawn so the shot is not simply missing, but in the
      // warning colour so it is never mistaken for the game's own data.
      const damaged = this.paths.paths.get(s)?.isDamaged ?? false;
      (line.material as LineBasicMaterial).color.set(
        s === slot ? (damaged ? RAIL_DAMAGED : RAIL_EYE) : dimColor,
      );
      (line.material as LineBasicMaterial).opacity = s === slot ? 0.9 : 0.35;
    }
    for (const [s, line] of this.aimLines) {
      (line.material as LineBasicMaterial).color.set(
        s === slot ? RAIL_AIM : dimColor,
      );
      (line.material as LineBasicMaterial).opacity = s === slot ? 0.7 : 0.2;
      line.visible = this.aimVisible;
    }
    for (const line of this.objLines.values()) {
      (line.material as LineBasicMaterial).color.set(RAIL_OBJ);
      (line.material as LineBasicMaterial).opacity = 0.45;
    }

    if (this.activeSpan) {
      this.group.remove(this.activeSpan);
      this.activeSpan.geometry.dispose();
      (this.activeSpan.material as LineBasicMaterial).dispose();
      this.activeSpan = null;
    }
    if (slot === null || start === undefined || end === undefined) return;
    const p = this.paths.paths.get(slot);
    if (!p || end <= start) return;
    const n = Math.max(2, Math.min(600, Math.ceil(end - start) + 1));
    const pts = new Float32Array(n * 3);
    const v = new Vector3();
    for (let i = 0; i < n; i++) {
      const t = start + ((end - start) * i) / (n - 1);
      p.pose(t, false).eye.toArray(pts as unknown as number[], i * 3);
      void v;
    }
    this.activeSpan = new Line(
      polylineGeometry(pts),
      new LineBasicMaterial({ color: RAIL_ACTIVE, transparent: true, opacity: 1 }),
    );
    this.activeSpan.name = "rail_active_span";
    this.group.add(this.activeSpan);
  }

  /** Draw the live camera as an object in the scene (used in free roam). */
  setCameraPose(eye: Vector3, target: Vector3): void {
    this.marker.position.copy(eye);
    this.marker.lookAt(target);
    this.aimMarker.position.copy(target);
    const pos = this.link.geometry.getAttribute("position") as BufferAttribute;
    pos.setXYZ(0, eye.x, eye.y, eye.z);
    pos.setXYZ(1, target.x, target.y, target.z);
    pos.needsUpdate = true;
  }

  pathFor(slot: number): CamPath | undefined {
    return this.paths.paths.get(slot);
  }
}

// -- spawn markers ---------------------------------------------------------

function labelTexture(text: string): CanvasTexture {
  const pad = 8;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  ctx.font = "600 28px ui-monospace, SFMono-Regular, Menlo, monospace";
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  c.width = w;
  c.height = 44;
  const g = c.getContext("2d")!;
  g.font = "600 28px ui-monospace, SFMono-Regular, Menlo, monospace";
  g.fillStyle = "rgba(6,10,14,0.82)";
  g.fillRect(0, 0, w, 44);
  g.fillStyle = "#ffe14d";
  g.textBaseline = "middle";
  g.fillText(text, pad, 23);
  const tex = new CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Spawn markers.
 *
 * They are markers and not models on purpose: the class -> model mapping is
 * genuinely unsolved. The class table at `0x009A2280` holds *handler code
 * addresses*, not model ids, so there is nothing to look a model up by yet.
 * Position, BAMS yaw, class and hit points are all confirmed, and those are
 * what is drawn.
 */
export class SpawnLayer {
  readonly group = new Group();
  private readonly pool: Object3D[] = [];
  private labels = new Map<string, CanvasTexture>();
  private showLabels = true;

  constructor() {
    this.group.name = "spawns";
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  setLabelsVisible(v: boolean): void {
    this.showLabels = v;
    for (const o of this.pool) {
      const s = o.children.find((c) => (c as Sprite).isSprite);
      if (s) s.visible = v && o.visible;
    }
  }

  private acquire(i: number): Object3D {
    if (this.pool[i]) return this.pool[i];
    const g = new Group();

    // A flattened cone pointing along the marker's local -Z, so the BAMS yaw
    // is legible as a facing rather than just a dot.
    const body = new Mesh(
      new ConeGeometry(0.45, 1.6, 6),
      new MeshBasicMaterial({
        color: 0xff4d6a, transparent: true, opacity: 0.85,
        blending: AdditiveBlending, depthWrite: false,
      }),
    );
    body.geometry.rotateX(Math.PI);
    body.position.y = 0.8;
    const nose = new Mesh(
      new ConeGeometry(0.22, 0.9, 4),
      new MeshBasicMaterial({ color: 0xffd0d8, depthWrite: false }),
    );
    nose.geometry.rotateX(-Math.PI / 2);
    nose.position.set(0, 0.8, -0.9);
    g.add(body, nose);
    this.group.add(g);
    this.pool[i] = g;
    return g;
  }

  update(spawns: ActiveSpawn[]): void {
    for (let i = 0; i < spawns.length; i++) {
      const s = spawns[i];
      const o = this.acquire(i);
      o.visible = true;
      o.position.set(s.pos[0], s.pos[1], s.pos[2]);
      // +0x18 is the BAMS yaw. +0x14 and +0x1C reach the object's other two
      // rotation fields but their distributions do not look like angles, so
      // they are deliberately not applied here.
      o.rotation.set(0, s.orient[1] * BAMS, 0);

      const dead = s.secondsLeft !== null && s.secondsLeft <= 0;
      for (const c of o.children) {
        const m = (c as Mesh).material as MeshBasicMaterial | undefined;
        if (m && "opacity" in m) m.opacity = dead ? 0.18 : 0.85;
      }

      const text = `c${s.class}${s.hp ? ` hp${s.hp}` : ""}`;
      let sprite = o.children.find((c) => (c as Sprite).isSprite) as
        | Sprite
        | undefined;
      if (!sprite) {
        sprite = new Sprite(new SpriteMaterial({ depthTest: false }));
        sprite.position.y = 2.1;
        o.add(sprite);
      }
      if (sprite.userData.text !== text) {
        let tex = this.labels.get(text);
        if (!tex) this.labels.set(text, (tex = labelTexture(text)));
        (sprite.material as SpriteMaterial).map = tex;
        (sprite.material as SpriteMaterial).needsUpdate = true;
        sprite.scale.set((tex.image as HTMLCanvasElement).width / 22,
                         44 / 22, 1);
        sprite.userData.text = text;
      }
      sprite.visible = this.showLabels;
    }
    for (let i = spawns.length; i < this.pool.length; i++) {
      this.pool[i].visible = false;
    }
  }
}
