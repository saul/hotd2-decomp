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
 * Music loops on one element; SE and voice are one-shots over a small pool.
 * Everything streams from `/bgm/`, `/se/` and `/voice/` — the dev server
 * serves them out of the user's own install (see `vite.config.ts`), because
 * the audio is 300 MB of uncompressed PCM and copying it into the bundle
 * would triple it.
 */

import type { BgmJson, SoundJson } from "./bundle";

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

  setSoundTables(sound: SoundJson | undefined): void {
    this.sound = sound ?? null;
  }

  setTable(bgm: BgmJson | undefined, gameMode: number): void {
    this.table = bgm ?? null;
    // `DAT_009C8E98 == 6 && g_GameMode == 0` selects the plain names and
    // everything else the `_AR` mix. Every stage scene fails that test, so
    // `_AR` is what the six stages actually resolve to.
    this.useArTable = (bgm?.default_table ?? "ar") === "ar" || gameMode !== 0;
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
    if (!m) void this.resume();
    this.emit();
  }

  setVolume(v: number): void {
    this._volume = Math.max(0, Math.min(1, v));
    if (this.el) this.el.volume = this._volume;
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
