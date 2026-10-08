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
 * `hod2lib/exetab.ts`, so this file routes ids and never guesses a filename.
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
import type { FillIn, FillOut } from "./bgm_fill_worker";
import { decodeAac, SOUND_INDEX_FORMAT, type SoundIndex } from "./aac";

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
/**
 * Decoded SE and voice clips kept, most recently used last. A stage's shots,
 * hits and deaths are a few dozen files; a clip is under a megabyte decoded.
 */
const CLIP_CACHE = 48;
/** How many of a stage's sounds {@link Bgm.precache} fetches at once. */
const PRECACHE_PARALLEL = 4;

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
   * One-shot SE and speech, sounding now, oldest first.
   *
   * **Buffers on the Web Audio graph, not elements.** They were a pool of
   * eight `<audio>` elements, each shot assigning its file to the next one,
   * and on an iPhone that went silent under fire: every assignment reloads the
   * element, the `play()` it had started is abandoned by the next assignment,
   * and iOS ignores an element's `volume` besides. A decoded buffer can be
   * started any number of times at once, starts on the next audio quantum,
   * and goes through the same gain as the music.
   *
   * Eight at once still, as the pool was -- the engine's channel allocator is
   * not modelled, and a ninth takes the oldest's place.
   */
  private readonly voices: { node: AudioBufferSourceNode;
                             kind: "se" | "voice" }[] = [];
  /** Decoded clips by URL, most recently used last; see `CLIP_CACHE`. */
  private readonly clips = new Map<string, Promise<AudioBuffer | null>>();
  /**
   * What {@link precache} loaded for the current stage, by URL for a clip
   * and by `file|loop` for a track. Held for the stage's life, outside the
   * LRU: stage 2 names more voice lines than `CLIP_CACHE` holds, and a line
   * evicted before it plays is a download again.
   */
  private pinnedClips = new Map<string, () => Promise<AudioBuffer | null>>();
  private pinnedTracks = new Map<string, () => Promise<AudioBuffer | null>>();
  /**
   * Bumped by each stop of its kind, so a clip still decoding when the SE or
   * the voice is stopped does not start afterwards.
   */
  private readonly stopGen = { se: 0, voice: 0 };
  /** The SE and voice level under the music, into the master gain. */
  private sfx: GainNode | null = null;

  /**
   * The looping SE currently sounding, by the id that started each.
   *
   * A map rather than the one-shot pool because a loop has to outlive the
   * frame that started it and be findable again to stop -- and keyed by id
   * because the engine's own bookkeeping is the id too: `SoundStopAllLoopingSe`
   * takes no argument and stops every one of them.
   *
   * **A buffer looped whole, not an `<audio loop>` element**, since the AAC
   * set (`audio/aac.ts`): an element plays the file, and an AAC file starts
   * with the encoder's 2,112 samples of priming, which an element would put
   * in every pass. The buffer is the decode with the priming cut off, so it
   * wraps without a gap, as the engine's static DirectSound loop does. The
   * node is null until the clip has loaded.
   */
  private readonly loops = new Map<number, { node: AudioBufferSourceNode | null }>();

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
    if (!m) this.resume();
    this.emit();
  }

  setVolume(v: number): void {
    this._volume = Math.max(0, Math.min(1, v));
    this.applyGain();
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
    const pinned = this.pinnedTracks.get(key);
    if (pinned) return pinned();
    const hit = this.decoded.find((d) => d.key === key);
    if (hit) return hit.buffer;
    const buffer = await this.decodeUncached(file, loop);
    if (buffer) this.decoded = [{ key, buffer }, ...this.decoded].slice(0, 2);
    return buffer;
  }

  /** The fetch and the fill, with no cache on either side. */
  private async decodeUncached(file: string,
                               loop: boolean): Promise<AudioBuffer | null> {
    // The AAC set has the track already as the period its stream plays
    // (`tools/sounds.ts`), so a decode is the whole job.
    const index = await this.soundIndex();
    const e = index?.files[`bgm/${file.toLowerCase()}#${loop ? "loop" : "once"}`];
    if (index && e?.file) {
      try {
        const r = await fetch(e.file);
        if (!r.ok) return null;
        return await decodeAac(await r.arrayBuffer(), e, index.priming);
      } catch {
        return null;
      }
    }
    let bytes: ArrayBuffer;
    try {
      const r = await fetch(soundUrl("bgm", file));
      if (!r.ok) return null;
      bytes = await r.arrayBuffer();
    } catch {
      return null;
    }
    const filled = await this.fill(bytes, loop);
    if (!filled?.channels) return null;
    const { ctx } = this.graph();
    const buffer = ctx.createBuffer(filled.channels.length, filled.channels[0].length,
                                    filled.sampleRate);
    filled.channels.forEach((a, c) => buffer.copyToChannel(a, c));
    return buffer;
  }

  /**
   * `bgmStreamFill` in the worker (`bgm_fill_worker.ts`), or here where there
   * is no worker to be had. The bytes are handed over either way.
   */
  private fill(bytes: ArrayBuffer, loop: boolean): Promise<FillOut | null> {
    if (typeof Worker === "undefined") {
      const b = new Uint8Array(bytes);
      const header = wavStreamHeader(b);
      const layout = header && bgmStreamLayout(header, b.length, loop);
      if (!header || !layout) return Promise.resolve(null);
      const out: Float32Array<ArrayBuffer>[] = [];
      for (let c = 0; c < layout.channels; c++) out.push(new Float32Array(layout.frames));
      bgmStreamFill(b, header, layout, out);
      return Promise.resolve({ id: 0, sampleRate: layout.sampleRate, channels: out });
    }
    this.filler ??= new Worker(new URL("./bgm_fill_worker.ts", import.meta.url),
                               { type: "module" });
    const worker = this.filler;
    const id = ++this.fillSeq;
    return new Promise((resolve) => {
      const done = (ev: MessageEvent<FillOut>) => {
        if (ev.data.id !== id) return;
        worker.removeEventListener("message", done);
        resolve(ev.data);
      };
      worker.addEventListener("message", done);
      const req: FillIn = { id, bytes, loop };
      worker.postMessage(req, [bytes]);
    });
  }

  private filler: Worker | null = null;
  private fillSeq = 0;

  /**
   * The audio graph made now, under the loading screen, rather than by the
   * first sound in play: making an `AudioContext` is a long call -- 290 ms
   * in headless Chrome -- and it used to land in the frame the stage's music
   * started. It starts suspended, as a page's must, and a press resumes it.
   */
  prepare(): void {
    this.graph();
  }

  private graph(): { ctx: AudioContext; gain: GainNode; sfx: GainNode } {
    if (!this.ctx || !this.gain || !this.sfx) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
      // SE and voice sit under the music: their own level, then the master.
      this.sfx = this.ctx.createGain();
      this.sfx.gain.value = SFX_GAIN;
      this.sfx.connect(this.gain);
      this.ctx.addEventListener("statechange", () => this.emit());
      this.applyGain();
    }
    return { ctx: this.ctx, gain: this.gain, sfx: this.sfx };
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

  /**
   * `[port-only]` -- fetch and decode a stage's sounds before it runs, and
   * keep them until the next stage's: `audio/precache.ts` says which and why.
   * `ids` are routed exactly as {@link play} would route them, against the
   * tables {@link setTable} and {@link setSoundTables} were last given, so call
   * it after those. Resolves when every one has loaded or failed; a 404 -- the
   * 36 `_OFF` names that never shipped -- is a failure that costs nothing.
   *
   * **With the AAC set the whole of `clips.pack` comes too** -- every effect
   * and voice line in the game, 14 MB, once a session -- so the sounds the
   * gameplay code raises, which no data names (`audio/precache.ts`), are on
   * the device as well and cost a decode on first play rather than a fetch.
   * The ones the data names are decoded here as well. The service worker
   * keeps the pack and the tracks as they arrive (`public/sw.js`), so a stage
   * played once plays with every sound offline.
   */
  async precache(ids: readonly number[],
                 progress?: (done: number, total: number) => void):
      Promise<void> {
    // Each entry starts its load once, on whichever asks first: the queue
    // below, or a play that reaches it before the queue has.
    const once = (start: () => Promise<AudioBuffer | null>) => {
      let p: Promise<AudioBuffer | null> | null = null;
      return () => (p ??= start());
    };
    const clips = new Map<string, () => Promise<AudioBuffer | null>>();
    const tracks = new Map<string, () => Promise<AudioBuffer | null>>();
    const jobs: (() => Promise<unknown>)[] = [];
    // First, so the pack's one long download is not queued behind anything.
    jobs.push(() => this.soundIndex().then((i) => i && this.packBytes(i)));
    for (const id of ids) {
      const a = routeSoundId(id, this.table, this.useArTable, this.sound);
      if (a.kind === "bgm") {
        const key = `${a.file}|${a.loop ? "loop" : "once"}`;
        if (tracks.has(key)) continue;
        const job = once(() => this.decodeUncached(a.file, a.loop));
        tracks.set(key, job);
        jobs.push(job);
      } else if (a.kind === "se" || a.kind === "voice") {
        const url = soundUrl(a.kind, a.file);
        if (clips.has(url)) continue;
        const job = once(() => this.fetchClip(url));
        clips.set(url, job);
        jobs.push(job);
      }
    }
    // The new stage's set replaces the last one's: nothing of a stage the
    // player has left is kept.
    this.pinnedClips = clips;
    this.pinnedTracks = tracks;
    // A few at a time, in the order the script names them, so the opening
    // track and the first lines are not queued behind the whole stage.
    let done = 0;
    let next = 0;
    progress?.(0, jobs.length);
    const worker = async () => {
      while (next < jobs.length) {
        await jobs[next++]();
        progress?.(++done, jobs.length);
      }
    };
    await Promise.all(Array.from({ length: PRECACHE_PARALLEL }, worker));
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
   * because a second source on the same clip is audible and the engine's
   * channel allocator is not modelled.
   */
  private startLoopingSe(id: number, file: string): void {
    // Unlike `oneShot`, this does **not** refuse while muted: a one-shot missed
    // is gone, and a loop missed would stay missing for the rest of the scene
    // because the only thing that would start it again is another actor's init.
    // It sounds through the master gain, which is what mutes it.
    if (this.loops.has(id)) return;
    const loop: { node: AudioBufferSourceNode | null } = { node: null };
    this.loops.set(id, loop);
    void this.clip(soundUrl("se", file)).then((buffer) => {
      // Stopped, or stopped and started again, while it loaded.
      if (!buffer || this.loops.get(id) !== loop) return;
      const { ctx, sfx } = this.graph();
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.loop = true;
      node.connect(sfx);
      node.start();
      loop.node = node;
      this.resume();
    });
  }

  private stopLoop(loop: { node: AudioBufferSourceNode | null }): void {
    const n = loop.node;
    loop.node = null;
    if (!n) return;
    try { n.stop(); } catch { /* never started */ }
    n.disconnect();
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
    for (const [id, loop] of [...this.loops]) {
      if (want.has(id)) continue;
      this.stopLoop(loop);
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
    for (const loop of this.loops.values()) this.stopLoop(loop);
    this.loops.clear();
  }

  /**
   * Fire and forget. Failures are silent on purpose: 36 of the 324 SE names
   * end in `_OFF` and are not shipped at all, so a 404 here is expected data,
   * not a fault worth interrupting playback for -- and it is remembered, so
   * it is asked for once.
   *
   * The first play of a file waits for its fetch and decode; every later one
   * starts at once. A stop of the kind while it decodes cancels it.
   */
  private oneShot(kind: "se" | "voice", file: string): void {
    if (this._muted) return;
    const gen = this.stopGen[kind];
    void this.clip(soundUrl(kind, file)).then((buffer) => {
      if (!buffer || this._muted || gen !== this.stopGen[kind]) return;
      const { ctx, sfx } = this.graph();
      while (this.voices.length >= SFX_VOICES) this.release(this.voices[0]);
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(sfx);
      const v = { node, kind };
      node.onended = () => this.forget(v);
      this.voices.push(v);
      node.start();
      this.resume();
    });
  }

  /** A clip, fetched and decoded once. See `CLIP_CACHE`. */
  private clip(url: string): Promise<AudioBuffer | null> {
    const pinned = this.pinnedClips.get(url);
    if (pinned) return pinned();
    const hit = this.clips.get(url);
    if (hit) {
      this.clips.delete(url);
      this.clips.set(url, hit);
      return hit;
    }
    const p = this.fetchClip(url);
    this.clips.set(url, p);
    while (this.clips.size > CLIP_CACHE) {
      this.clips.delete(this.clips.keys().next().value as string);
    }
    return p;
  }

  /**
   * One clip, decoded: out of the AAC pack when there is one and it holds the
   * clip, off the network as a WAV otherwise. Null for a 404 or a bad file.
   */
  private async fetchClip(url: string): Promise<AudioBuffer | null> {
    const index = await this.soundIndex();
    const e = index?.files[decodeURIComponent(url)];
    // The set holds every clip the install has, so one it lacks is one of the
    // `_OFF` names that never shipped: nothing to fetch.
    if (index && !e) return null;
    if (index && e?.pack) {
      const pack = await this.packBytes(index);
      if (!pack) return null;
      try {
        return await decodeAac(pack.slice(e.pack[0], e.pack[0] + e.pack[1]), e,
                               index.priming);
      } catch {
        return null;
      }
    }
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      return await this.graph().ctx.decodeAudioData(await r.arrayBuffer());
    } catch {
      return null;
    }
  }

  /**
   * `sounds.json`, the AAC set's index, once a session -- or null where there
   * is none (a dev server with no `extract/sound/`, a site staged without
   * it), and the page plays the WAVs as before.
   */
  private soundIndex(): Promise<SoundIndex | null> {
    return this.indexLoad ??= (async () => {
      try {
        const r = await fetch("sounds.json");
        if (!r.ok) return null;
        const i = await r.json() as SoundIndex;
        return i.format === SOUND_INDEX_FORMAT && i.codec === "aac" ? i : null;
      } catch {
        return null;
      }
    })();
  }

  private indexLoad: Promise<SoundIndex | null> | null = null;

  /** `clips.pack`, once a session; null if it would not load. */
  private packBytes(index: SoundIndex): Promise<ArrayBuffer | null> {
    return this.packLoad ??= (async () => {
      try {
        const r = await fetch(index.pack);
        return r.ok ? await r.arrayBuffer() : null;
      } catch {
        return null;
      }
    })();
  }

  private packLoad: Promise<ArrayBuffer | null> | null = null;

  private release(v: { node: AudioBufferSourceNode }): void {
    v.node.onended = null;
    try { v.node.stop(); } catch { /* already ended */ }
    v.node.disconnect();
    this.forget(v);
  }

  private forget(v: { node: AudioBufferSourceNode }): void {
    const i = this.voices.indexOf(v as (typeof this.voices)[number]);
    if (i >= 0) this.voices.splice(i, 1);
  }

  /** Stop every one-shot of `kind`, and any still decoding. */
  private stopPool(kind: "se" | "voice"): void {
    this.stopGen[kind] += 1;
    for (const v of [...this.voices]) if (v.kind === kind) this.release(v);
  }

  /**
   * Cut any voice line still playing: `SoundStopGroup(1)` (`FUN_00401000`),
   * which is what `PlaySoundId(0x80000002)` reaches.
   *
   * That is the call `stop_voice_if_skipped` (evt `0x2E`) makes after a
   * cutscene skip. SE and voice share one set of voices, each marked with
   * its kind -- and stopping SE here would be wrong, since a gunshot is not
   * part of the dialogue being skipped.
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
