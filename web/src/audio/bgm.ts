/**
 * The mixer: music, sound effects and voice.
 *
 * A sound id in this game is one number space, split by its **top nibble**
 * (`PlaySoundId`, `FUN_0041CFD0`):
 *
 * ```
 *   0  SE       a linked list of {id, name} at 0x005845F8
 *   1  BGM      `id & 0xFFF` indexes a table of filename pointers
 *   2  voice    `(id & 0xFFF) * 0x24` into the records at 0x0058044A
 *   8  control  stop one group: 0x80000001 the SE, 0x80000002 the voice,
 *               and any other value the music
 * ```
 *
 * `bgm_entry_play` (`0x5F`) consumes four operands and uses only the third,
 * as a stop followed by a play. `se_play` (`0x38`-`0x3B`) hands its operand to
 * the same dispatcher, so it is **not** restricted to SE: it is how every
 * stage script starts its own track, at block 0 step 2 (stage 5 alone uses
 * `bgm_entry_play` for it). All three name tables are read out of the EXE by
 * `hod2lib.exetab`, so this file routes ids and never guesses a filename.
 *
 * **Music** is one streamed channel with the engine's own loop -- see
 * `stream.ts` for what that plays, byte for byte -- decoded here and handed to
 * Web Audio as one buffer looped whole, because an `<audio loop>` element
 * cannot play it: it stops at the end of the `data` chunk, and it puts a gap
 * at the seam the engine does not have.
 *
 * SE and voice are one-shots over a small pool -- **except the 44 SE ids
 * `PlaySoundId` loops.** That branch is not a property of the file, it is two
 * tables in the EXE: `g_looping_se_ids` (`0x005887FC`) and
 * `g_looping_se_stop_ids` (`0x005888B0`), 44 entries each, paired index for
 * index. An id in the first plays looped; an id in the second calls
 * `SoundStopAllLoopingSe()` and then plays unlooped. There is no handle and no
 * channel id anywhere in the engine, which is why a chainsaw is started by one
 * call from an actor's init and stopped by another from its death.
 *
 * Everything streams from `/bgm/`, `/se/` and `/voice/` — the dev server
 * serves them out of the user's own install (see `vite.config.ts`), because
 * the audio is 300 MB of uncompressed PCM and copying it into the bundle
 * would triple it. A hosted copy (`tools/site.mjs`) stages them beside the
 * page instead, and {@link soundUrl} is why it can.
 */

import type { BgmJson, SoundJson } from "../bundle";
import { GameMode } from "../game/game_mode";
import {
  bgmStreamFill, bgmStreamLayout, wavStreamHeader,
} from "./stream";

/** `id >> 28`. */
export const NS_SE = 0;
export const NS_BGM = 1;
export const NS_VOICE = 2;
export const NS_CONTROL = 8;
/**
 * The three control words `PlaySoundControl` (`FUN_0041D3E0`) tells apart.
 * Any other namespace-8 id takes the music's arm, as `SOUND_STOP` does; only
 * `SOUND_STOP` itself also clears `g_current_bgm_id` (`0x009C8FB8`).
 */
export const SOUND_STOP = 0x80000000;
export const SOUND_STOP_SE = 0x80000001;
export const SOUND_STOP_VOICE = 0x80000002;

/**
 * Where a sound is fetched from: `<kind>/<path>`, **lowercased**.
 *
 * The exe's tables spell a name the way its build did -- `COMMON\GUN5_22.WAV`,
 * `STAGE1_SE\RAIN3ST_44.wav` -- and the install spells the file however it
 * was pressed (`SE/STAGE1_SE/rain3st_44.wav`), which Windows never minded.
 * The dev server resolves each segment case-insensitively (`vite.config.ts`);
 * a static host cannot, because an S3 key is exact. So the request is
 * lowercased here and `tools/site.mjs` lowercases every file it stages, and
 * the two meet without either knowing the other's spelling. That is safe
 * only because no two of the install's 802 sound files differ in case alone,
 * and `site.mjs` refuses to stage an install where two do.
 */
export function soundUrl(kind: "bgm" | "se" | "voice", file: string): string {
  return `${kind}/${file.replace(/\\/g, "/").toLowerCase()
    .split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * The BGM ids `PlaySoundId` streams **unlooped**: the three `CMP EBX, imm32`
 * at `0x0041D1FB`, `0x0041D205` and `0x0041D20D`, each jumping to the
 * `PUSH 0` at `0x0041D241` where every other id reaches the `PUSH 1` at
 * `0x0041D21D`. Index 9 is `OVR_AR` in both tables -- `GameOverRunPhase`
 * plays it -- and 0x25 and 0x14 are `CLR2` and `HOD1_ADV`, which only the
 * `_AR` table names. Every other name in either table loops.
 */
export const BGM_ONE_SHOT_IDS: readonly number[] =
  [0x10000009, 0x10000025, 0x10000014];

/** Concurrent one-shot voices, and how loud they sit under the music. */
const SFX_VOICES = 8;
const SFX_GAIN = 0.85;

/** What `PlaySoundId` does with one id, decided and not yet done. */
export type SoundAction =
  | { kind: "none"; note: string }
  | { kind: "bgm"; id: number; file: string; loop: boolean }
  | { kind: "stop-bgm"; id: number }
  | { kind: "stop-se" }
  | { kind: "stop-voice" }
  | { kind: "se"; id: number; file: string; loop: "play" | "stop" | null }
  | { kind: "voice"; id: number; file: string };

/**
 * `PlaySoundId`'s dispatch (`FUN_0041CFD0`), as a decision.
 *
 * Pure, so `test:audio` can hold every arm to the exe without a browser:
 * namespace first, then the table, then the loop flag. `useAr` is the table
 * choice `Bgm.setTable` makes.
 */
export function routeSoundId(id: number, bgm: BgmJson | null, useAr: boolean,
                             sound: SoundJson | null): SoundAction {
  // Namespace 0 with id 0 is `PlaySoundId`'s early-out -- it is how a script
  // says "nothing", not a real entry.
  if (id === 0) return { kind: "none", note: "no sound (id 0)" };
  // >>> 0 because these ids have the top bit set and `>>` is signed.
  const ns = id >>> 28;
  if (ns === NS_CONTROL) {
    // `PlaySoundControl`: 0x80000001 releases the SE channels, 0x80000002
    // stops `g_voice_stop_group`, and everything else -- 0x80000000 and any
    // other control word -- stops `g_bgm_stop_group`.
    if (id === SOUND_STOP_SE) return { kind: "stop-se" };
    if (id === SOUND_STOP_VOICE) return { kind: "stop-voice" };
    return { kind: "stop-bgm", id };
  }
  if (ns === NS_BGM) {
    const idx = id & 0xfff;
    const t = !bgm ? [] : useAr ? bgm.names.ar : bgm.names.plain;
    const file = t[idx] ?? null;
    // A null name breaks out before anything is stopped: the track already
    // playing carries on, and `g_current_bgm_id` is not written.
    if (!file) return { kind: "none", note: `bgm ${idx} has no entry in the table` };
    return { kind: "bgm", id, file, loop: !BGM_ONE_SHOT_IDS.includes(id >>> 0) };
  }
  if (ns === NS_SE) {
    const file = sound?.se[String(id)];
    if (!file) return { kind: "none", note: `se 0x${id.toString(16)} is not in the table` };
    // `PlaySoundId`'s own order: walk the pair tables **before** playing,
    // and stop first if this id is a stopper. The engine breaks out of the
    // walk on the first match either way, so an id that is in both tables
    // (none ship, but the walk allows it) takes whichever comes first.
    let loop: "play" | "stop" | null = null;
    for (const pair of sound?.looping ?? []) {
      if (pair.play === id) { loop = "play"; break; }
      if (pair.stop === id) { loop = "stop"; break; }
    }
    return { kind: "se", id, file, loop };
  }
  if (ns === NS_VOICE) {
    const file = sound?.voice[String(id & 0xfff)];
    if (!file) return { kind: "none", note: `voice ${id & 0xfff} is not in the table` };
    return { kind: "voice", id, file };
  }
  return { kind: "none", note: `sound id 0x${id.toString(16)}: unknown namespace` };
}

export interface BgmState {
  /** The track id on channel `0xF`, or null. */
  id: number | null;
  file: string | null;
  /**
   * Why it is there: a `PlaySoundId` the port made, or a seek putting back
   * what the replay passed silently (`Bgm.syncTrack`).
   */
  source: "script" | "seek" | null;
  /** `PlaySoundId`'s loop flag for this id; null with no track. */
  loop: boolean | null;
  /** Sounding: the buffer is started and the context is running. */
  playing: boolean;
  blocked: boolean;
}

/** One decoded period of a track, kept so a restart need not refetch it. */
interface DecodedTrack {
  key: string;
  buffer: AudioBuffer;
}

export class Bgm {
  private table: BgmJson | null = null;
  private useArTable = true;
  private _volume = 0.6;
  private _muted = true;
  private state: BgmState = {
    id: null, file: null, source: null, loop: null, playing: false,
    blocked: false,
  };
  onChange: (s: BgmState) => void = () => {};

  // -- channel 0xF --------------------------------------------------------
  //
  // Web Audio rather than an element: see the file comment and `stream.ts`.
  // The context is made on first use, and it starts suspended until a
  // gesture has reached the page; the transport's sound button is that
  // gesture.
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  /** The buffer source playing channel `0xF`, or null. */
  private node: AudioBufferSourceNode | null = null;
  /** Bumped on every start and stop, so a fetch that lands late is dropped. */
  private seq = 0;
  /** The last two decoded tracks: a restart is the common case. */
  private decoded: DecodedTrack[] = [];

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
    // refcount that would have released the chainsaw is gone. The engine's
    // own teardown is `SoundStopAll` (`FUN_0041D350`), which `stopAll` below
    // transcribes; this stays for a caller that swaps the tables alone.
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
    if (id >>> 28 !== NS_BGM) return null;
    const a = routeSoundId(id, this.table, this.useArTable, null);
    return a.kind === "bgm" ? a.file : null;
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
    this.applyGain();
    for (const el of this.loops.values()) el.muted = m;
    if (!m) this.resume();
    this.emit();
  }

  setVolume(v: number): void {
    this._volume = Math.max(0, Math.min(1, v));
    this.applyGain();
    for (const el of this.loops.values()) {
      el.volume = Math.min(1, this._volume * SFX_GAIN);
    }
    this.emit();
  }

  /**
   * Act on a sound id exactly the way `PlaySoundId` does. Returns a note for
   * the event feed.
   */
  play(id: number): string | undefined {
    const a = routeSoundId(id, this.table, this.useArTable, this.sound);
    switch (a.kind) {
      case "none":
        return a.note;
      case "stop-bgm":
        this.stopTrack();
        return "bgm stop";
      case "stop-se":
        this.stopSe();
        return "se stop-all";
      case "stop-voice":
        this.stopVoice();
        return "voice stop";
      case "bgm":
        // `SoundPlayOnFreeChannel(name, loop, 0xF, -1)`: whatever is on the
        // channel is stopped and released, and the file is opened again from
        // its first byte -- **even when it is the same track**. A script that
        // plays the stage's track a second time restarts it.
        this.startTrack(a.file, a.id, a.loop, "script");
        return `bgm ${a.file}${a.loop ? "" : " (once)"}`;
      case "se":
        if (a.loop === "stop") {
          this.stopAllLoopingSe();
          // ...and then plays the stop id itself, unlooped. 36 of the 324 SE
          // names end in `_OFF` and none of those files ship, so this is a
          // 404 by design and `oneShot` swallowing it is correct.
          this.oneShot("se", a.file);
          return `se stop-all + ${a.file}`;
        }
        if (a.loop === "play") {
          this.startLoopingSe(a.id, a.file);
          return `se loop ${a.file}`;
        }
        this.oneShot("se", a.file);
        return `se ${a.file}`;
      case "voice":
        this.oneShot("voice", a.file);
        return `voice ${a.file}`;
    }
  }

  /**
   * `[port-only]` -- put channel `0xF` where a seek says it should be,
   * **without** restarting a track that is already there.
   *
   * A replay runs the script silently, so the `PlaySoundId` that started the
   * music was skipped; the walker records what it would have left on the
   * channel (`Walker.bgmTrack`) and this applies it once. A track already
   * sounding is left alone rather than restarted, because the engine has no
   * seek and the restart would be the port's, not the game's.
   */
  syncTrack(id: number | null): void {
    if (id === null || id === 0) {
      if (this.state.file) this.stopTrack();
      return;
    }
    const a = routeSoundId(id, this.table, this.useArTable, this.sound);
    if (a.kind !== "bgm") return;
    if (this.state.file === a.file && this.state.loop === a.loop
        && this.state.id !== null) {
      return;
    }
    this.startTrack(a.file, a.id, a.loop, "seek");
  }

  /**
   * `SoundStopAll` (`FUN_0041D350`): the music, the voice and every SE
   * channel, and `g_current_bgm_id` back to 0. `MarkSceneOver` and
   * `ResetGameOnStart` both call it, which is what a stage load is.
   */
  stopAll(): void {
    this.stopTrack();
    this.stopVoice();
    this.stopSe();
  }

  // -- channel 0xF ----------------------------------------------------------

  /** Stop and release channel `0xF`: `SoundStopGroup(0)` (`FUN_00401000`). */
  private stopTrack(): void {
    this.seq++;
    const n = this.node;
    this.node = null;
    if (n) {
      n.onended = null;
      try { n.stop(); } catch { /* never started */ }
      n.disconnect();
    }
    this.state = {
      id: null, file: null, source: null, loop: null, playing: false,
      blocked: this.state.blocked,
    };
    this.emit();
  }

  /**
   * `SoundPlayOnFreeChannel(name, loop, 0xF, -1)` (`FUN_004AC020`) for a
   * track: release the channel, open the file, start it with the loop bit.
   *
   * The open is a fetch, so the start lands a moment later than the call; the
   * engine's open reads its first three seconds synchronously. The old track
   * is silent from the call either way, as it is in the engine.
   */
  private startTrack(file: string, id: number, loop: boolean,
                     source: "script" | "seek"): void {
    this.stopTrack();
    const seq = this.seq;
    this.state = {
      id, file, source, loop, playing: false, blocked: this.state.blocked,
    };
    this.emit();
    void this.decode(file, loop).then((buffer) => {
      if (seq !== this.seq) return;         // superseded while loading
      if (!buffer) {
        this.state.playing = false;
        this.emit();
        return;
      }
      const { ctx, gain } = this.graph();
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      // Looped over the whole buffer: `loopStart`/`loopEnd` stay 0, which is
      // Web Audio's "the entire buffer". The buffer *is* one period of the
      // engine's stream -- see `bgmStreamLayout`.
      node.loop = loop;
      node.connect(gain);
      node.onended = () => {
        if (this.node !== node) return;
        // A one-shot has run out: the thread fills silence and stops the
        // buffer. The id stays on the channel, as `g_current_bgm_id` does.
        this.node = null;
        this.emit();
      };
      node.start();
      this.node = node;
      this.resume();
      this.emit();
    });
  }

  /** Fetch a track and decode one period of its stream, or reuse the last. */
  private async decode(file: string, loop: boolean): Promise<AudioBuffer | null> {
    const key = `${file}|${loop ? "loop" : "once"}`;
    const hit = this.decoded.find((d) => d.key === key);
    if (hit) return hit.buffer;
    let bytes: Uint8Array;
    try {
      const r = await fetch(soundUrl("bgm", file));
      if (!r.ok) return null;
      bytes = new Uint8Array(await r.arrayBuffer());
    } catch {
      return null;
    }
    const header = wavStreamHeader(bytes);
    const layout = header && bgmStreamLayout(header, bytes.length, loop);
    if (!header || !layout) return null;
    const { ctx } = this.graph();
    const buffer = ctx.createBuffer(layout.channels, layout.frames,
                                    layout.sampleRate);
    const out: Float32Array[] = [];
    for (let c = 0; c < layout.channels; c++) out.push(buffer.getChannelData(c));
    bgmStreamFill(bytes, header, layout, out);
    this.decoded = [{ key, buffer }, ...this.decoded].slice(0, 2);
    return buffer;
  }

  private graph(): { ctx: AudioContext; gain: GainNode } {
    if (!this.ctx || !this.gain) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
      this.ctx.addEventListener("statechange", () => this.emit());
      this.applyGain();
    }
    return { ctx: this.ctx, gain: this.gain };
  }

  private applyGain(): void {
    if (this.gain) this.gain.gain.value = this._muted ? 0 : this._volume;
  }

  /**
   * A press has happened: if audio is on and held, let it go.
   *
   * Called from `app/` on any press on the page -- a shot, a key, a menu
   * item -- because the browser counts all of them, and a page reloaded mid-
   * game should come back to sound on the first thing the player does rather
   * than on a press of the speaker they have no reason to make.
   */
  unblock(): void {
    if (!this._muted) this.resume();
  }

  /**
   * Browsers refuse audio until the page has been interacted with. That is a
   * normal outcome, not an error: the state records it and the sound button
   * doubles as the gesture that lifts it.
   */
  private resume(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state === "running") return;
    void ctx.resume().catch(() => {}).finally(() => this.emit());
  }

  // -- SE and voice -----------------------------------------------------------

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
    el.src = soundUrl("se", file);
    el.volume = Math.min(1, this._volume * SFX_GAIN);
    el.muted = this._muted;
    this.loops.set(id, el);
    void el.play().catch(() => {});
  }

  /**
   * `[port-only]` — make the mixer's loops exactly *ids*, adding and removing
   * as little as possible.
   *
   * The seam a **seek** needs. A replay runs the script silently, so the
   * `se_play` that starts a loop is skipped while the one that stops it may
   * not be; the walker records what should be sounding
   * (`Walker.loopingSe`) and this puts the mixer there. A loop already
   * sounding and still wanted is left running rather than restarted, because
   * restarting it is audible.
   *
   * The engine needs nothing like it: it has no seek.
   */
  syncLoopingSe(ids: readonly number[]): void {
    const want = new Set(ids);
    for (const [id, el] of [...this.loops]) {
      if (want.has(id)) continue;
      el.pause();
      el.currentTime = 0;
      this.loops.delete(id);
    }
    for (const id of ids) {
      const file = this.sound?.se[String(id)];
      if (file) this.startLoopingSe(id, file);
    }
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
    const url = soundUrl(kind, file);
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

  /** Stop every element in the pool whose URL is under `/<kind>/`. */
  private stopPool(kind: "se" | "voice"): void {
    for (const el of this.pool) {
      if (el && !el.paused && el.src.includes(`/${kind}/`)) {
        el.pause();
        el.currentTime = 0;
      }
    }
  }

  /**
   * Cut any voice line still playing: `SoundStopGroup(1)` (`FUN_00401000`),
   * which is what `PlaySoundId(0x80000002)` reaches.
   *
   * That is the call `stop_voice_if_skipped` (evt `0x2E`) makes after a
   * cutscene skip. SE and voice share one element pool, so the URL is what
   * distinguishes them -- and stopping SE here would be wrong, since a
   * gunshot is not part of the dialogue being skipped.
   */
  stopVoice(): void {
    this.stopPool("voice");
  }

  /**
   * `PlaySoundId(0x80000001)`: `SoundCommand(n, 0x1100A0)` (`FUN_004ABF80`),
   * which releases channels 0 to 14 -- every SE, looping or not, and neither
   * the music on 15 nor the voice on 16.
   */
  stopSe(): void {
    this.stopPool("se");
    this.stopAllLoopingSe();
  }

  private emit(): void {
    const running = this.ctx?.state === "running";
    this.state.playing = !!this.node && running;
    this.state.blocked = !!this.ctx && !running;
    this.onChange(this.state);
  }
}
