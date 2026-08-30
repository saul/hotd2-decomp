/**
 * Shooting: the trigger, the score, the crosshair.
 *
 * The hit test itself lives in `characters.ts`, because that is where the bones
 * are and the spheres ride them. This is the half the game keeps in the player
 * rather than the actor: turning a click into a ray, and turning a hit into
 * points.
 *
 * Read out of the binary; the full account is in `docs/formats/combat.md`.
 *
 * ## The ray
 *
 * `FUN_00406110` unprojects the crosshair with the game's own projection
 * distance — `640.21 = 240 / tan(41.1° / 2)` — and transforms it by the camera
 * matrix. Doing that here with the same camera three.js is already rendering
 * through gives the identical ray, so `Raycaster.setFromCamera` is used rather
 * than re-deriving it: the projection matrix it reads *is* the game's.
 *
 * The game's segment is 1000 units. Nothing here needs the bound — the bone
 * spheres are all well inside it — but it is applied so a shot past everything
 * behaves the same way.
 *
 * ## The score, from `FUN_00409430`
 *
 * ```
 * any hit not on the head     +10
 * a hit on bone 2, the head   +120, then a per-player combo that grows by 10
 * HP reaching zero            +80
 * ```
 *
 * The head combo is added *before* it increments, so consecutive headshots pay
 * 120, 130, 140 …, and **any non-head hit resets it to zero**. That reset is
 * the whole reason the counter exists, so it is reproduced exactly.
 *
 * ## Dying
 *
 * A kill runs `FUN_004560B0`'s directional pick — `camera_yaw − actor_yaw`
 * against four ±45° arcs — and the body plays that clip once and stays. The
 * game's camera yaw is the direction from target to eye, which is the camera's
 * own local **+Z**, so that is what is measured here.
 *
 * ## Feedback — `ActorShotFeedback` and `FUN_00407950`
 *
 * Every shot makes a noise, and which noise is a table, not a guess. The
 * exporter carries both, with the filenames `g_se_name_list` resolves:
 *
 * ```
 * hit, actor alive   one of BLOOD02/03/04/06, BONE01   + the hurt voice
 * hit, actor killed  the same five                     + the kill voice
 * headshot kill      BLOOD01 or BLOOD05                + the head voice
 * hit, no effect     BULLET_MET3 — it bounced off
 * miss               the surface's BULLET_SND/MET/OTH/WAT/WOD
 * ```
 *
 * The voice comes in two sets and `combat.voice_set_a_types` says which set a
 * character type takes; that split is `ActorPlayHitVoice`'s own switch.
 *
 * The **sprite** is `FUN_00407230` for a flesh hit: 25 frames at 60 Hz, drawn
 * at the bone, scaled `(-view_z * 0.0375 + 0.25) * 0.3` and then by the
 * severity of the hit — 0.5 damaged, 0.75 damaged and swapped, 1.0 severed.
 * That geometry and timing are transcribed; the *artwork* is asset slots
 * `0x3A..0x52`, which the bundle does not carry, so a radial splat stands in
 * for it. Marked `[open]` in docs/formats/combat.md rather than pretended.
 *
 * ## What this does not do
 *
 * No ammo, no reload, no civilians. `FUN_004560B0`'s *special* deaths — the
 * ones for a particular destroyed part — are not implemented, so a character
 * whose arm has come off still plays a directional death. What happens after
 * the clip is `FUN_00456740`, which is unread, so the corpse simply stays.
 *
 * A **miss** has no material here: `FUN_00405260` takes it from the collision
 * triangle `ColiSegmentVsMesh` hit, and the collision meshes are not in the
 * bundle. The visible geometry gives the impact *point*, and material 3 —
 * the game's own "other" catch-all — gives the sound. `[open]`, and said so.
 */

import {
  AdditiveBlending, CanvasTexture, Raycaster, Sprite, SpriteMaterial, Vector2,
  Vector3, type Camera, type Object3D,
} from "three";
import type { CharacterLayer } from "./characters";
import type { CombatJson } from "../bundle";
import { G } from "../game/globals";

/** `FUN_00404AD0` builds its segment as origin + direction * 1000. */
const SHOT_RANGE = 1000;

const BAMS = 65536 / (Math.PI * 2);

/**
 * `FUN_00407230`: the blood sprite runs 25 asset slots, one per game frame.
 */
const BLOOD_FRAMES = 25;
/** ...and the material impact sprites are frame-per-frame too. */
const IMPACT_HZ = 60;
/** `FUN_00405260` has no material here — 3 is the game's "other" surface. */
const MISS_MATERIAL = 3;

/** `ScoreAddForPlayer` constants, from `FUN_00409430`. */
const SCORE_HIT = 10;
const SCORE_HEAD = 120;
const SCORE_HEAD_COMBO_STEP = 10;
const SCORE_KILL = 80;

export interface ShotResult {
  hit: boolean;
  bone?: number;
  head?: boolean;
  damage?: number;
  killed?: boolean;
  hp?: number;
  /** `g_hit_result` — 1 swapped, 2 damaged, 3 severed, 5 no effect. */
  result?: number;
  points: number;
}

/**
 * The impact sprites, pooled.
 *
 * `FUN_00407230` draws its 25 frames in **view space** at the bone's position
 * with an explicit scale, which is why the size law is reproduced rather than
 * left to perspective: the sprite is near-constant on screen out to 20 units
 * and fixed in the world beyond that.
 */
class ImpactSprites {
  private readonly pool: { s: Sprite; t: number; life: number; k: number }[] = [];
  private readonly tex = ImpactSprites.splat();

  constructor(private readonly scene: Object3D) {}

  /** A radial splat — a stand-in for asset slots 0x3A..0x52. */
  private static splat(): CanvasTexture {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, "rgba(255,240,220,0.95)");
    rg.addColorStop(0.35, "rgba(220,70,50,0.65)");
    rg.addColorStop(1, "rgba(120,10,10,0)");
    g.fillStyle = rg;
    g.fillRect(0, 0, 64, 64);
    return new CanvasTexture(c);
  }

  /** *scale* is the game's severity factor; *viewZ* the hit's view-space z. */
  spawn(at: Vector3, viewZ: number, scale: number, frames: number): void {
    // `FUN_00407230`: 1.0 past 20 units, otherwise -z*0.0375 + 0.25, then the
    // 0.3 the non-wide path applies, then the severity.
    const depth = viewZ < -20 ? 1.0 : -viewZ * 0.0375 + 0.25;
    const k = Math.max(0.05, depth * 0.3 * scale);
    let e = this.pool.find((x) => x.life <= 0);
    if (!e) {
      const sp = new Sprite(new SpriteMaterial({
        map: this.tex, transparent: true, depthTest: false,
        depthWrite: false, blending: AdditiveBlending,
      }));
      sp.renderOrder = 900;
      this.scene.add(sp);
      e = { s: sp, t: 0, life: 0, k: 1 };
      this.pool.push(e);
    }
    e.s.position.copy(at);
    e.t = 0;
    e.k = k;
    e.life = frames / IMPACT_HZ;
    e.s.visible = true;
    e.s.scale.setScalar(k * 8);
  }

  update(dt: number): void {
    for (const e of this.pool) {
      if (e.life <= 0) continue;
      e.t += dt;
      if (e.t >= e.life) { e.life = 0; e.s.visible = false; continue; }
      // The sprite is a flipbook in the game; here the stand-in fades and
      // grows over the same span, so the timing still reads correctly.
      const u = e.t / e.life;
      e.s.scale.setScalar(e.k * 8 * (1 + u * 1.6));
      (e.s.material as SpriteMaterial).opacity = 1 - u;
    }
  }

  clear(): void {
    for (const e of this.pool) { e.life = 0; e.s.visible = false; }
  }
}

export class Shooting {
  private readonly ray = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly dot: HTMLElement;

  private enabled = false;
  /**
   * The running score is a global — `G.g_player_score` — because
   * `PlayerTakeDamage` also writes it, and two counters that both call
   * themselves the score is how they drift. Shots and hits stay here: they are
   * the player's own accuracy tally, not part of the port yet.
   */
  get score(): number { return G.g_player_score[0]; }
  set score(v: number) { G.g_player_score[0] = v; }
  shots = 0;
  hits = 0;
  /** `DAT_009A5C82` — grows by 10 per consecutive headshot, reset by any other. */
  private headCombo = 0;

  /** Called with a one-line description of each shot, for the event feed. */
  onShot: (r: ShotResult, note: string) => void = () => {};
  /** Wired to the bundle's sound player; ids are `g_se_name_list` ids. */
  playSound: (id: number) => void = () => {};

  private combat: CombatJson | null = null;
  private impacts: ImpactSprites | null = null;
  private readonly _v = new Vector3();

  constructor(private readonly viewport: HTMLElement,
              private readonly chars: CharacterLayer) {
    this.dot = document.createElement("div");
    this.dot.className = "crosshair";
    this.dot.hidden = true;
    viewport.appendChild(this.dot);

    viewport.addEventListener("pointerdown", (e) => {
      if (!this.enabled || e.button !== 0) return;
      e.preventDefault();
      this.fire(e);
    });
    viewport.addEventListener("pointermove", (e) => {
      if (!this.enabled) return;
      const r = viewport.getBoundingClientRect();
      this.dot.style.left = `${e.clientX - r.left}px`;
      this.dot.style.top = `${e.clientY - r.top}px`;
    });
  }

  setEnabled(v: boolean, camera?: Camera, scene?: Object3D): void {
    this.enabled = v;
    this.dot.hidden = !v;
    this.viewport.classList.toggle("shooting", v);
    this._camera = camera ?? this._camera;
    this._scene = scene ?? this._scene;
    if (this._scene && !this.impacts) {
      this.impacts = new ImpactSprites(this._scene);
    }
  }

  get isEnabled(): boolean { return this.enabled; }

  /**
   * The camera yaw the directional death compares against, in BAMS.
   *
   * `FUN_00403AC0` builds the game's camera yaw from `eye - target`, so it is
   * the camera's own local **+Z** — its backward axis, not its forward one.
   */
  get cameraYawBams(): number {
    if (!this._camera) return 0;
    this._back.set(0, 0, 1).applyQuaternion(this._camera.quaternion);
    return Math.atan2(this._back.x, this._back.z) * BAMS;
  }

  /** The proved sound and sprite tables, from the stage bundle. */
  setTables(combat: CombatJson | undefined): void {
    this.combat = combat ?? null;
  }

  /** Advance the impact sprites. */
  update(dt: number): void {
    this.impacts?.update(dt);
  }

  private pickOne<T>(xs: T[] | undefined): T | undefined {
    return xs?.length ? xs[Math.floor(Math.random() * xs.length)] : undefined;
  }

  /**
   * `ActorPlayHitVoice` (`FUN_0040A6F0`): a flesh impact plus a voice, with
   * the voice taken from set A or set B by character type.
   */
  private voice(charType: number, kind: "hurt" | "kill" | "head"): void {
    const c = this.combat;
    if (!c) return;
    const impact = kind === "head"
      ? this.pickOne(c.head_impact) : this.pickOne(c.impact);
    if (impact) this.playSound(impact.id);
    const set = c.voice_set_a_types.includes(charType) ? 0 : 1;
    const v = c.voice[kind]?.[set];
    if (v) this.playSound(v.id);
  }

  /** View-space z of a world point, which is what the sprite scale reads. */
  private viewZ(at: Vector3): number {
    if (!this._camera) return -20;
    return this._v.copy(at).applyMatrix4(this._camera.matrixWorldInverse).z;
  }

  private readonly _back = new Vector3();
  private _camera: Camera | null = null;
  private _scene: Object3D | null = null;

  reset(): void {
    this.score = 0;
    this.shots = 0;
    this.hits = 0;
    this.headCombo = 0;
    this.impacts?.clear();
    this.chars.revive();
  }

  private fire(e: PointerEvent): void {
    if (!this._camera) return;
    const r = this.viewport.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1,
                 -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this._camera as never);
    this.ray.far = SHOT_RANGE;
    this.shots++;

    const pick = this.chars.pick(this.ray.ray);
    if (!pick) {
      // A miss still resets nothing -- the game only clears the head combo on
      // a hit that is not a head. `FUN_00405260` takes the material from the
      // collision triangle; there is none here, so the visible geometry gives
      // the point and material 3 ("other") gives the sound.
      const where = this._scene
        ? this.ray.intersectObject(this._scene, true).find((h) => h.object.visible)
        : undefined;
      const mat = String(MISS_MATERIAL);
      const ric = this.combat?.ricochet[mat];
      if (ric) this.playSound(ric.id);
      if (where && this.impacts) {
        const sp = this.combat?.impact_sprite[mat]
          ?? this.combat?.impact_sprite_default;
        const frames = sp ? Math.max(1, sp[1] - sp[0] + 1) : BLOOD_FRAMES;
        this.impacts.spawn(where.point, this.viewZ(where.point),
                           sp ? sp[2] : 1, frames);
      }
      this.onShot({ hit: false, points: 0 },
                  `miss${ric ? ` · ${ric.file.split("\\").pop()}` : ""}`);
      return;
    }

    const out = this.chars.hit(pick.inst, pick.bone, this.cameraYawBams);
    this.hits++;
    let points = 0;
    if (out.head) {
      points += SCORE_HEAD + this.headCombo;
      this.headCombo += SCORE_HEAD_COMBO_STEP;
    } else {
      points += SCORE_HIT;
      this.headCombo = 0;
    }
    if (out.killed) points += SCORE_KILL;
    // `ResolveHit` scores nothing at all for a result-5 hit.
    if (out.result === 5) points = 0;
    this.score += points;

    // `ActorShotFeedback`: a result-5 hit is a ricochet, everything else is
    // blood at the bone, scaled by how bad the hit was.
    const c = this.combat;
    if (out.result === 5) {
      const ric = c?.no_effect.sound;
      if (ric) this.playSound(ric.id);
      const sp = c?.impact_sprite[String(c.no_effect.material)];
      if (sp && this.impacts) {
        this.impacts.spawn(pick.point, this.viewZ(pick.point), sp[2],
                           Math.max(1, sp[1] - sp[0] + 1));
      }
    } else {
      this.voice(pick.inst.type.type,
                 out.killed ? (out.head ? "head" : "kill") : "hurt");
      const scale = c?.blood_scale[String(out.result)] ?? 0.5;
      this.impacts?.spawn(pick.point, this.viewZ(pick.point), scale,
                          BLOOD_FRAMES);
    }

    const who = pick.inst.type.name;
    const note = `${who} bone ${pick.bone}${out.head ? " (head)" : ""}` +
      ` −${out.damage} hp${out.killed ? ", killed" : ` → ${out.hp}`}` +
      (out.severed ? " · limb severed" : out.gore ? " · part swapped" : "") +
      (out.result === 5 ? " · no effect (ricochet)" : "") +
      (out.react ? ` · stagger ${out.react}` : "") +
      (out.death !== undefined ? ` · death ${out.death}` : "") +
      `  +${points}`;
    this.onShot({ hit: true, bone: pick.bone, head: out.head,
                  damage: out.damage, killed: out.killed, hp: out.hp,
                  result: out.result, points },
                note);
  }

  get describe(): string {
    if (!this.enabled) return "off";
    const acc = this.shots ? Math.round((this.hits / this.shots) * 100) : 0;
    return `${this.score} pts · ${this.hits}/${this.shots} (${acc}%)`
      + (this.headCombo ? ` · head +${this.headCombo}` : "");
  }
}
