# `tools/emu` — Unicorn function harness

**Phase 2.** Not yet implemented.

## Purpose

Crack the compression codec without ever running the game.

Rather than executing `Hod2.exe` under Windows or Wine, this harness lifts a
single function's bytes out of `.text` and executes **just that function** inside
a [Unicorn Engine](https://www.unicorn-engine.org/) x86 emulator:

1. Map a scratch stack and input/output buffers into emulator memory.
2. Copy the compressed payload into the input buffer.
3. Set up the calling convention — arguments on the stack for `__cdecl`, or in
   `ecx`/`edx` for `__fastcall`; the exact convention is determined during
   Phase 2a.
4. Push a sentinel return address and run until it is reached.
5. Read the output buffer back out.

## Why this and not a debugger

- Satisfies the project's static-only constraint — the game is never run.
- No Windows, no Wine, no DirectX; works natively on macOS and Linux.
- Fully deterministic and reproducible in CI.
- Isolates one function, so there is no engine state to set up and nothing else
  can interfere.

It yields the same ground truth a runtime hook would: bit-for-bit correct output
on real inputs. That makes it the differential-test oracle for the clean-room
reimplementation in `tools/hod2lib/lz.py` and `src/lz.c`.

## Caveats

- The lifted function must be self-contained, or every call it makes must be
  emulated too. A decompressor is normally a leaf function, so this should hold —
  but verify before trusting the output.
- Any absolute reference into `.data` needs those pages mapped as well.
- Unicorn emulates the CPU, not the OS. Any syscall or API call means the wrong
  function was lifted.

## Planned contents

| File | Purpose |
|---|---|
| `lift.py` | extract a function's bytes from the PE given a start address |
| `run.py` | set up the Unicorn context and execute it |
| `oracle.py` | batch-run over real assets and emit ground-truth pairs |

## Prerequisites

```sh
pip install unicorn
```

A copy of `Hod2.exe` is required; it is never committed here.
