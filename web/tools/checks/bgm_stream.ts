/**
 * Where the music loops -- read from the exe, and held against every track.
 *
 *     node tools/run_ts.mjs tools/checks/bgm_stream.ts --game-dir ~/"THE HOUSE OF THE DEAD 2"
 *
 * The answer, `[proved]`: **nowhere in particular.** There are no loop points
 * in the files and none in a table. `PlaySoundId` (`FUN_0041CFD0`) hands every
 * BGM id to `SoundPlayOnFreeChannel(name, loop, 0xF, -1)` (`FUN_004AC020`),
 * channel `0xF` is opened **streamed** with a 3000 ms ring
 * (`SoundChannelOpenWav(0xF, name, 1, 3000)`, `FUN_004A3EF0`), and when
 * `SoundStreamThread` (`FUN_004A4640`) reads past **end of file** it seeks back
 * to the first sample and keeps reading, if the loop bit is set:
 *
 *     [first sample, EOF)  [first sample, EOF)  [first sample, EOF) ...
 *
 * Three things follow, and each is asserted or printed here per track:
 *
 * * the loop restarts at sample 0 -- the `data` chunk's first byte, which the
 *   header walk counts to (`+0x3C`);
 * * whatever follows the `data` chunk -- every shipped track ends in a `LIST`
 *   chunk -- is played as PCM once a pass;
 * * a pass that is not a whole number of frames starts the next one
 *   mid-frame, which on 16-bit stereo exchanges the channels every other pass.
 *
 * It can fail on the exe, on the port and on the files:
 *
 * 1. the bytes that make the reading -- the three `CMP EBX, imm32` that pick
 *    the one-shot ids and the `PUSH 1` / `PUSH 0` they choose between, the
 *    `PUSH 0xBB8; PUSH 1` that opens channel `0xF` streamed, and the two
 *    loop-bit tests in the thread that are followed by a seek to `+0x3C` --
 *    are checked in `Hod2.exe` itself, one instruction to a line;
 * 2. the port's `BGM_ONE_SHOT_IDS` (`src/audio/bgm.ts`) must be exactly the
 *    exe's three, and its `BGM_RING_MS` (`src/audio/stream.ts`) the `PUSH` the
 *    channel is opened with;
 * 3. every name in both BGM tables must open under the port's transcription
 *    of the engine's header walk (`wavStreamHeader`) as PCM that
 *    `bgmStreamLayout` can lay out, and **every looping track must be at least
 *    one ring long**: the first fill is made before the loop bit is set, so a
 *    shorter looping file would play once, then silence to the end of the
 *    ring, then wrap -- a case `src/audio/stream.ts` does not model because no
 *    shipped track needs it.
 *
 * What only this check can see: the port's music loop model resting on
 * instructions the exe does not have, or on a shipped track it cannot play
 * exactly.
 */
import {
  Checker, EXIT_SKIPPED, gameDirOrSkip, hex, openGame,
} from "../lib/exe_check";
import { BGM_ONE_SHOT_IDS } from "../../src/audio/bgm";
import {
  BGM_RING_MS, bgmRingBytes, bgmStreamLayout, wavStreamHeader,
} from "../../src/audio/stream";

/** `PlaySoundId`'s loop-flag choice and the stream it opens: `[va, bytes, what]`. */
const EXE_BYTES: readonly [number, string, string][] = [
  [0x0041d1fb, "81fb09000010", "CMP EBX, 0x10000009"],
  [0x0041d203, "7434", "JZ 0x0041D239 (the unlooped call)"],
  [0x0041d205, "81fb25000010", "CMP EBX, 0x10000025"],
  [0x0041d20b, "742c", "JZ 0x0041D239"],
  [0x0041d20d, "81fb14000010", "CMP EBX, 0x10000014"],
  [0x0041d213, "7424", "JZ 0x0041D239"],
  [0x0041d215, "6aff6a0f", "PUSH -1; PUSH 0xF (channel 0xF)"],
  [0x0041d21d, "6a01", "PUSH 1 -- loop, every other id"],
  [0x0041d239, "6aff6a0f", "PUSH -1; PUSH 0xF"],
  [0x0041d241, "6a00", "PUSH 0 -- once, the three above"],
  // `SoundPlayOnFreeChannel`'s channel-0xF open: streamed, a 3000 ms ring.
  [0x004ac131, "68b80b0000", "PUSH 3000 (ring ms)"],
  [0x004ac136, "6a01", "PUSH 1 (open streamed)"],
  // `SoundStreamThread`'s end-of-file branches: the loop bit, then a seek to
  // the channel's +0x3C.
  [0x004a4991, "f644064308", "TEST byte [+0x43], 0x08 (loop)"],
  [0x004a4998, "8b54063c", "MOV EDX, [+0x3C] (first sample)"],
  [0x004a49a4, "ff1598404c00", "CALL [SetFilePointer]"],
  [0x004a4aaf, "f744064000000008", "TEST [+0x40], 0x08000000 (loop)"],
  [0x004a4ab9, "8b54063c", "MOV EDX, [+0x3C]"],
  [0x004a4ac5, "ff1598404c00", "CALL [SetFilePointer]"],
];
const EXE_ONE_SHOTS = [0x10000009, 0x10000025, 0x10000014];
/** The `PUSH imm32` in {@link EXE_BYTES} whose operand is the ring's length. */
const RING_PUSH = 0x004ac131;

const toHex = (b: Uint8Array): string =>
  [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

const c = new Checker("bgm_stream");
const { source, exe } = await openGame(gameDirOrSkip("bgm_stream"));

// -- 1. the reading, in the exe's own bytes -------------------------------
for (const [va, want, what] of EXE_BYTES) {
  const r = exe.v2r(va);
  const got = r === null ? "" : toHex(exe.data.subarray(r, r + want.length / 2));
  c.ok(got === want, `${hex(va, 8)} ${what}`
       + (got === want ? "" : `: want ${want}, got ${got || "nothing"}`));
}

// -- 2. the port's constants are the exe's --------------------------------
const port = [...BGM_ONE_SHOT_IDS].sort((a, b) => a - b);
const exeIds = [...EXE_ONE_SHOTS].sort((a, b) => a - b);
c.ok(JSON.stringify(port) === JSON.stringify(exeIds),
     "src/audio/bgm.ts BGM_ONE_SHOT_IDS "
     + (JSON.stringify(port) === JSON.stringify(exeIds)
       ? "are the exe's three"
       : `is [${BGM_ONE_SHOT_IDS.map((x) => hex(x)).join(", ")}], the exe's `
         + `are [${EXE_ONE_SHOTS.map((x) => hex(x)).join(", ")}]`));
c.eq(BGM_RING_MS, exe.ru32(RING_PUSH + 1),
     `src/audio/stream.ts BGM_RING_MS is the ring the exe pushes at ${hex(RING_PUSH, 8)}`);

// -- 3. every track, as the stream plays it -------------------------------
const names = exe.bgmNames();
const onDisk = new Map<string, string>();
for (const f of await source.list("sound/bgm")) onDisk.set(f.toLowerCase(), f);
if (!onDisk.size) {
  // Half the check did not run, and a half that did not run is not a pass
  // (L14): a skip, unless the exe half already failed.
  if (c.failed) c.finish();
  console.log("bgm_stream: no sound/bgm under the game dir; no track was "
              + "asserted, so this is a skip");
  process.exit(EXIT_SKIPPED);
}
const tracks = new Map<string, Set<boolean>>();
for (const table of ["ar", "plain"] as const) {
  names[table].forEach((name, idx) => {
    if (name === null) return;
    const loop = !EXE_ONE_SHOTS.includes((0x10000000 | idx) >>> 0);
    if (!tracks.has(name)) tracks.set(name, new Set());
    tracks.get(name)!.add(loop);
  });
}

const row = (cells: [string | number, number][]): string =>
  cells.map(([v, w]) => (w < 0 ? String(v).padEnd(-w) : String(v).padStart(w)))
    .join("");
console.log("\n  " + row([["track", -18], ["mode", -6], ["first", 6], ["data", 10],
                          ["tail", 6], ["pass", 10], ["passes", 7],
                          ["period frames", 15]]) + "  pass/ring");
const unopened: string[] = [];
const short: string[] = [];
const starts = new Set<number>();
const byName = (a: string, b: string): number =>
  a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0;
for (const name of [...tracks.keys()].sort(byName)) {
  const file = onDisk.get(name.toLowerCase());
  if (file === undefined) {
    unopened.push(`${name}: not on disc`);
    continue;
  }
  const b = await source.read(`sound/bgm/${file}`);
  const h = wavStreamHeader(b);
  if (h === null || h.formatTag !== 1 || (h.bitsPerSample !== 8 && h.bitsPerSample !== 16)) {
    unopened.push(`${name}: the header walk does not reach PCM data`);
    continue;
  }
  starts.add(h.dataStart);
  const ring = bgmRingBytes(h);
  for (const loop of [...tracks.get(name)!].sort((a, b) => Number(b) - Number(a))) {
    const layout = bgmStreamLayout(h, b.length, loop);
    if (layout === null) {
      unopened.push(`${name}: bgmStreamLayout cannot lay it out`);
      continue;
    }
    // The stream's own arithmetic, beside the port's: a period is the least
    // number of passes that is a whole number of frames.
    const passes = loop ? h.blockAlign / gcd(layout.passBytes, h.blockAlign) : 1;
    if (layout.passes !== passes) {
      unopened.push(`${name}: bgmStreamLayout makes ${layout.passes} passes a `
                    + `period, the stream makes ${passes}`);
    }
    console.log("  " + row([[name, -18], [loop ? "loop" : "once", -6],
                            [h.dataStart, 6], [h.dataSize, 10],
                            [layout.passBytes - h.dataSize, 6],
                            [layout.passBytes, 10], [layout.passes, 7],
                            [layout.frames, 15]])
                + `  ${(layout.passBytes / ring).toFixed(1).padStart(6)}`);
    if (loop && layout.passBytes < ring) {
      short.push(`${name}: ${layout.passBytes} bytes against a ${ring}-byte ring`);
    }
  }
}
console.log();
c.ok(!unopened.length, !unopened.length
  ? `all ${tracks.size} names in the two tables open under the engine's header `
    + `walk; first sample at ${[...starts].sort((a, b) => a - b).join(", ")}`
  : `${unopened.length} table names do not open as the engine opens them: `
    + unopened.join("; "));
c.ok(!short.length, !short.length
  ? "every looping track is at least one ring long, so the first fill wraps "
    + "like every other and the port's model is exact"
  : `${short.length} looping tracks are shorter than the ring, which the `
    + `port's stream model does not cover: ${short.join("; ")}`);
c.finish();
