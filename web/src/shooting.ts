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
 * ## What this does not do
 *
 * No ammo, no reload, no civilians, and no death animation — which motion a
 * dying actor plays is chosen by its class's state machine, and only two of the
 * zombie's 54 states have been read. A killed character is removed instead, and
 * the HUD says so.
 */

import { Raycaster, Vector2, type Camera, type Object3D } from "three";
import type { CharacterLayer } from "./characters";

/** `FUN_00404AD0` builds its segment as origin + direction * 1000. */
const SHOT_RANGE = 1000;

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
  points: number;
}

export class Shooting {
  private readonly ray = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly dot: HTMLElement;

  private enabled = false;
  score = 0;
  shots = 0;
  hits = 0;
  /** `DAT_009A5C82` — grows by 10 per consecutive headshot, reset by any other. */
  private headCombo = 0;

  /** Called with a one-line description of each shot, for the event feed. */
  onShot: (r: ShotResult, note: string) => void = () => {};

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
  }

  private _camera: Camera | null = null;
  private _scene: Object3D | null = null;

  reset(): void {
    this.score = 0;
    this.shots = 0;
    this.hits = 0;
    this.headCombo = 0;
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
      // A miss still resets nothing but the combo is untouched: the game only
      // clears it on a hit that is not a head.
      this.onShot({ hit: false, points: 0 }, "miss");
      return;
    }

    const out = this.chars.hit(pick.inst, pick.bone);
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
    this.score += points;

    const who = pick.inst.type.name;
    const note = `${who} bone ${pick.bone}${out.head ? " (head)" : ""}` +
      ` −${out.damage} hp${out.killed ? ", killed" : ` → ${out.hp}`}` +
      `  +${points}`;
    this.onShot({ hit: true, bone: pick.bone, head: out.head,
                  damage: out.damage, killed: out.killed, hp: out.hp, points },
                note);
  }

  get describe(): string {
    if (!this.enabled) return "off";
    const acc = this.shots ? Math.round((this.hits / this.shots) * 100) : 0;
    return `${this.score} pts · ${this.hits}/${this.shots} (${acc}%)`
      + (this.headCombo ? ` · head +${this.headCombo}` : "");
  }
}
