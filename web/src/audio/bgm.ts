/**
 * Background music.
 *
 * A sound id in this game is one number space, split by its **top nibble**
 * (`PlaySoundId`, `0x0041CFD0`):
 *
 * ```
 *   0  SE       a linked list of {id, name} at 0x005845F8
 *   1  BGM      `id & 0xFFF` indexes a table of filename pointers
 *   2  voice    `(id & 0xFFF) * 0x24` into the records at 0x0058044A
 *   8  control  0x80000000 stops whatever is playing
 * ```
 *
 * `bgm_entry_play` (`0x5F`) consumes four operands and uses only the third,
 * as a stop followed by a play. `se_play` (`0x38`-`0x3B`) hands its operand to
 * the same dispatcher, so it is **not** restricted to SE — across the six
 * stage scripts it names 9 BGM tracks, 6 voice lines and one stop as well.
 * All three tables are read out of the EXE by `hod2lib.exetab`, so this file
 * routes ids and never guesses a filename.
 *
 * Music loops on one element; SE and voice are one-shots over a small pool --
 * **except the 44 SE ids `PlaySoundId` loops.** That branch is not a property
 * of the file, it is two tables in the EXE: `g_looping_se_ids` (`0x005887FC`)
 * and `g_looping_se_stop_ids` (`0x005888B0`), 44 entries each, paired index
 * for index. An id in the first plays looped; an id in the second calls
 * `SoundStopAllLoopingSe()` and then plays unlooped. There is no handle and no
 * channel id anywhere in the engine, which is why a chainsaw is started by one
 * call from an actor's init and stopped by another from its death.
 * Everything streams from `/bgm/`, `/se/` and `/voice/` — the dev server
 * serves them out of the user's own install (see `vite.config.ts`), because
 * the audio is 300 MB of uncompressed PCM and copying it into the bundle
 * would triple it.
 */

import type { BgmJson, SoundJson } from "../bundle";
import { GameMode } from "../game/game_mode";

/** `id >> 28`. */
export const NS_SE = 0;
export const NS_BGM = 1;
export const NS_VOICE = 2;
export const NS_CONTROL = 8;
export const SOUND_STOP = 0x80000000;

/** Concurrent one-shot voices, and how loud they sit under the music. */
const SFX_VOICES = 8;
const SFX_GAIN = 0.85;

export interface BgmState {
  /** The track id currently playing, or null. */
  id: number | null;
  file: string | null;
  /** Why it is playing: a script instruction, or the stage default. */
  source: "script" | "stage" | null;
  playing: boolean;
  blocked: boolean;
}

export class Bgm {
  private el: HTMLAudioElement | null = null;
  private table: BgmJson | null = null;
  private useArTable = true;
  private _volume = 0.6;
  private _muted = true;
  private state: BgmState = {
    id: null, file: null, source: null, playing: false, blocked: false,
  };
  onChange: (s: BgmState) => void = () => {};

  private sound: SoundJson | null = null;
  /**
   * One-shot voices for SE and speech. A pool, because a script can fire
   * several in a frame and a single element would cut each off.
   */
  private readonly pool: HTMLAudioElement[] = [];
  private poolNext = 0;

  /**
   * The looping SE currently sounding, by the id that started each.
   *
   * A map rather than the one-shot pool because a loop has to outlive the
   * frame that started it and be findable again to stop -- and keyed by id
   * because the engine's own bookkeeping is the id too: `SoundStopAllLoopingSe`
   * takes no argument and stops every one of them.
   */
  private readonly loops = new Map<number, HTMLAudioElement>();

  setSoundTables(sound: SoundJson | undefined): void {
    // A new scene's tables replace the old ones, and a loop started under the
    // old ones has nothing left to stop it: `ResetSceneCombatState` zeroes
    // `g_weapon_loop_holders` (`0x009C8A74`) at exactly this point, so the
    // refcount that would have released the chainsaw is gone. `[likely]` the
    // engine's own scene teardown silences the mixer -- that path has not been
    // read -- but leaving a chainsaw running into the next stage is not a
    // behaviour anything in the binary asks for.
    this.stopAllLoopingSe();
    this.sound = sound ?? null;
  }

  /**
   * Bind the tables and pick between them the way `PlaySoundId` does.
   *
   * `if (g_app_state == 6 && g_GameMode == 0) plain else ar`, at
   * `0x0041D16B`. The port is always in play when a stage is loaded, so the
   * app-state half is constant and the mode decides: **Arcade gets the plain
   * mix** (`ST1.wav`) and Original, Training and Boss get the `_AR` one
   * (`ST1_AR.wav`). Both sets ship in `Sound/bgm/`.
   *
   * It used to be `(default_table ?? "ar") === "ar" || gameMode !== 0`, which
   * is `true` for every bundle ever written: the mode test was dead behind a
   * bundle field that always said `"ar"`, and the field said that because
   * `GameMode.ARCADE` was 2 and mode 0 was believed unreachable.
   */
  setTable(bgm: BgmJson | undefined, gameMode: number): void {
    this.table = bgm ?? null;
    this.useArTable = gameMode !== GameMode.Arcade;
  }

  /** Filename for a sound id, or null if it is not a playable BGM id. */
  fileFor(id: number): string | null {
    if (!this.table) return null;
    // >>> 0 because these ids have the top bit set and `>>` is signed.
    if (id >>> 28 !== NS_BGM) return null;
    const idx = id & 0xfff;
    const t = this.useArTable ? this.table.names.ar : this.table.names.plain;
    return t[idx] ?? null;
  }

  get current(): BgmState {
    return this.state;
  }

  get muted(): boolean {
    return this._muted;
  }

  get volume(): number {
    return this._volume;
  }

  setMuted(m: boolean): void {
    this._muted = m;
    if (this.el) this.el.muted = m;
    for (const el of this.loops.values()) el.muted = m;
    if (!m) void this.resume();
    this.emit();
  }

  setVolume(v: number): void {
    this._volume = Math.max(0, Math.min(1, v));
    if (this.el) this.el.volume = this._volume;
    for (const el of this.loops.values()) {
      el.volume = Math.min(1, this._volume * SFX_GAIN);
    }
    this.emit();
  }

  /**
   * Act on a sound id exactly the way `PlaySoundId` does: dispatch on the top
   * nibble. `se_play` is not restricted to SE -- across the six stage scripts
   * its operand names 9 BGM tracks, 6 voice lines and one stop, so the same
   * routing has to happen here. Returns a note for the event feed.
   */
  play(id: number, source: "script" | "stage" = "script"): string | undefined {
    // Namespace 0 with id 0 is `PlaySoundId`'s early-out -- it is how a
    // script says "nothing", not a real entry.
    if (id === 0) return "no sound (id 0)";
    if (id === SOUND_STOP || id >>> 28 === NS_CONTROL) {
      this.stop();
      return "sound stop";
    }
    if (id >>> 28 === NS_BGM) {
      const file = this.fileFor(id);
      if (!file) return `bgm ${id & 0xfff} has no entry in the table`;
      this.start(file, id, source);
      return `bgm ${file}`;
    }
    if (id >>> 28 === NS_SE) {
      const file = this.sound?.se[String(id)];
      if (!file) return `se 0x${id.toString(16)} is not in the table`;
      // `PlaySoundId`'s own order: walk the pair tables **before** playing,
      // and stop first if this id is a stopper. The engine breaks out of the
      // walk on the first match either way, so an id that is in both tables
      // (none ship, but the walk allows it) takes whichever comes first.
      const loop = this.loopingRole(id);
      if (loop === "stop") {
        this.stopAllLoopingSe();
        // ...and then plays the stop id itself, unlooped. 36 of the 324 SE
        // names end in `_OFF` and none of those files ship, so this is a 404
        // by design and `oneShot` swallowing it is correct.
        this.oneShot("se", file);
        return `se stop-all + ${file}`;
      }
      if (loop === "play") {
        this.startLoopingSe(id, file);
        return `se loop ${file}`;
      }
      this.oneShot("se", file);
      return `se ${file}`;
    }
    if (id >>> 28 === NS_VOICE) {
      const file = this.sound?.voice[String(id & 0xfff)];
      if (!file) return `voice ${id & 0xfff} is not in the table`;
      this.oneShot("voice", file);
      return `voice ${file}`;
    }
    return `sound id 0x${id.toString(16)}: unknown namespace`;
  }

  /**
   * Which of `PlaySoundId`'s two tables holds this id, if either.
   *
   * The walk is the engine's: index in step through both, first match wins,
   * and a `play` hit is tested before the `stop` hit at the same index.
   */
  private loopingRole(id: number): "play" | "stop" | null {
    for (const pair of this.sound?.looping ?? []) {
      if (pair.play === id) return "play";
      if (pair.stop === id) return "stop";
    }
    return null;
  }

  /** The loop ids sounding right now — for the sound projection and the tests. */
  get loopingSe(): number[] {
    return [...this.loops.keys()];
  }

  /**
   * Start one looping SE, or leave it alone if it is already sounding.
   *
   * The engine has no such check and does not need one: every caller of a
   * looping id in the shipped code guards it. `EnemyZombieInitByCharType`
   * plays the chainsaw only while `g_weapon_loop_holders` is 0, which is the
   * refcount that makes the loop one per scene. The guard is here as well
   * because a second element on the same file is audible and the engine's
   * channel allocator is not modelled.
   */
  private startLoopingSe(id: number, file: string): void {
    // Unlike `oneShot`, this does **not** refuse while muted: a one-shot missed
    // is gone, and a loop missed would stay missing for the rest of the scene
    // because the only thing that would start it again is another actor's init.
    // The element is created muted and `setMuted` lifts it.
    if (this.loops.has(id)) return;
    const el = new Audio();
    el.loop = true;
    el.src = `se/${file.replace(/\\/g, "/")
      .split("/").map(encodeURIComponent).join("/")}`;
    el.volume = Math.min(1, this._volume * SFX_GAIN);
    el.muted = this._muted;
    this.loops.set(id, el);
    void el.play().catch(() => {});
  }

  /**
   * `SoundStopAllLoopingSe`. It takes no argument in the engine either — a
   * stop id names which loop it was authored for and stops every one of them.
   */
  stopAllLoopingSe(): void {
    for (const el of this.loops.values()) {
      el.pause();
      el.currentTime = 0;
    }
    this.loops.clear();
  }

  /**
   * Fire and forget. Failures are silent on purpose: 36 of the 324 SE names
   * end in `_OFF` and are not shipped at all, so a 404 here is expected data,
   * not a fault worth interrupting playback for.
   */
  private oneShot(kind: "se" | "voice", file: string): void {
    if (this._muted) return;
    const url = `${kind}/${file.replace(/\\/g, "/")
      .split("/").map(encodeURIComponent).join("/")}`;
    let el = this.pool[this.poolNext];
    if (!el) {
      el = new Audio();
      this.pool[this.poolNext] = el;
    }
    this.poolNext = (this.poolNext + 1) % SFX_VOICES;
    el.src = url;
    // SE sit under the music rather than over it.
    el.volume = Math.min(1, this._volume * SFX_GAIN);
    el.muted = this._muted;
    void el.play().catch(() => {});
  }

  /**
   * Cut any voice line still playing.
   *
   * Used by the cutscene skip. SE and voice share one element pool, so the
   * URL is what distinguishes them -- and stopping SE here would be wrong,
   * since a gunshot is not part of the dialogue being skipped.
   */
  stopVoice(): void {
    for (const el of this.pool) {
      if (el && !el.paused && el.src.includes("/voice/")) {
        el.pause();
        el.currentTime = 0;
      }
    }
  }

  stop(): void {
    this.el?.pause();
    this.state = {
      id: null, file: null, source: null, playing: false, blocked: false,
    };
    this.emit();
  }

  private start(file: string, id: number, source: "script" | "stage"): void {
    if (this.state.file === file && this.state.playing) {
      this.state.id = id;
      this.state.source = source;
      this.emit();
      return;
    }
    if (!this.el) {
      this.el = new Audio();
      this.el.loop = true;
      this.el.preload = "auto";
      this.el.addEventListener("playing", () => {
        this.state.playing = true;
        this.state.blocked = false;
        this.emit();
      });
      this.el.addEventListener("error", () => {
        this.state.playing = false;
        this.emit();
      });
    }
    this.el.muted = this._muted;
    this.el.volume = this._volume;
    this.el.src = `bgm/${encodeURIComponent(file)}`;
    this.state = {
      id, file, source, playing: false, blocked: false,
    };
    void this.resume();
    this.emit();
  }

  /**
   * Browsers refuse audio until the page has been interacted with. That is a
   * normal outcome, not an error: the state records it and the transport's
   * sound button doubles as the gesture that lifts it.
   */
  private async resume(): Promise<void> {
    if (!this.el || !this.el.src) return;
    try {
      await this.el.play();
      this.state.blocked = false;
    } catch {
      this.state.blocked = true;
    }
    this.emit();
  }

  private emit(): void {
    this.onChange(this.state);
  }
}
