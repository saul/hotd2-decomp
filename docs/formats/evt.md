# `evt/` event tables

**Status:** largely unknown, and the highest-risk format. Phase 6.

13 files. One per stage plus shared and cutscene tables.

| File | Size |
|---|---|
| `st1evtbl.bin` … `st6evtbl.bin` | 17636 – 92472 |
| `advevtbl.bin`, `adv2evtbl.bin` | 11580, 3542 |
| `comevtbl.bin` | 296 |
| `endevtbl.bin` | 9372 |
| `trnevtbl.bin` | 21560 |
| `st1evtbl - Copy.bin` | 27722 — a stray duplicate, ignore |

## The defining property: baked Dreamcast pointers

These are **not** a serialised format. They are raw memory images captured from
the Dreamcast build, still containing absolute SH-4 RAM pointers.

Dreamcast main RAM is mapped at `0x0C000000`–`0x0CFFFFFF`. Dwords in that range
are everywhere:

| File | Size | Dwords in DC RAM range | Share |
|---|---|---|---|
| `st1evtbl.bin` | 27722 | 560 / 6930 | 8.1% |
| `st2evtbl.bin` | 92472 | 1774 / 23118 | 7.7% |
| `comevtbl.bin` | 296 | 17 / 74 | 23.0% |

`st1evtbl.bin` opens with a run of them:

```
0x0CEB5A4C  0x0CEB63F4  0x0CEB79C4  0x0CEB7D98
0x0CEB87EC  0x0CEB97C8  0x0CEB8F40  0x0CEB9994
```

Monotonically increasing at the start, which reads like a table of pointers to
per-event records.

The PC port must apply a fixup pass at load: subtract the original Dreamcast base
and add the actual allocation address. Recovering that routine is the key to the
format.

## The span problem

The pointer ranges do not fit inside the files:

| File | Size | Pointer range | Span |
|---|---|---|---|
| `st1evtbl.bin` | 27722 | `0x0CEB5834` – `0x0CED0918` | 110820 |
| `st2evtbl.bin` | 92472 | `0x0C0B0200` – `0x0CEDBC28` | 14858792 |
| `comevtbl.bin` | 296 | `0x0CEB58F0` – `0x0CEB5A00` | 272 |

`comevtbl` fits neatly — 272 ≤ 296. The others do not: 4× and 160× the file size.

So either:

- pointers target **other** loaded structures — models, motion data, other event
  tables — which the `st2evtbl` range starting at `0x0C0B0200` (far below the
  `0x0CEBxxxx` cluster) strongly suggests; or
- only a subset of `0x0Cxxxxxx`-looking dwords are genuine pointers, and the rest
  are float or integer payload that coincidentally lands in that window.

Both are probably true. At ~8% density, many of these must be coincidence — a
small positive float has an exponent byte around `0x0C` only in narrow ranges,
but packed RGBA or fixed-point data could easily collide.

**Distinguishing real pointers from coincidence requires the loader's fixup
routine.** There is no reliable way to do it from the data alone. This is why
`evt` is the highest-risk item in the plan.

## Loader

Not yet located precisely, but `exception.log` places it: a crash at `Eip =
0x413133` has the ASCII `\evt\st1evtbl.bin` on the stack. The path template
`evt\%s` is at `0x57995C`, reached through a table at `0x579958`.

Start from `0x413133` and work outwards.

## What the format should contain

By analogy with other rail shooters, and given the game's structure:

- Enemy spawn tables — type, position, timing, entry animation
- Branch points — the game's multi-path stage routing
- Trigger volumes and score events
- Civilian rescue events
- Boss phase scripting
- Links into `cam/` for scripted camera moves, and into `mot/` for animations

## Approach

1. RE the fixup routine to recover the exact pointer map — which words are
   relocated and by how much.
2. Rebase the file to offset 0 and re-examine. Real pointers become valid
   internal offsets; coincidental matches become obviously wrong.
3. Walk the record structs from the head table.
4. Cross-reference with `mot/`, `pol/` and `cam/` indices to identify fields.

## Export

JSON sidecars alongside the glTF, since none of this maps to a standard glTF
concept.

## Open questions

1. What is the exact fixup scheme, and how does the loader know which words to
   patch?
2. What was the original Dreamcast load base? `0x0CEB0000` fits `st1evtbl` but
   not `st2evtbl`.
3. Do pointers cross between files — does `st2evtbl` reference data loaded from
   `pol/` or `mot/`?
4. Is `comevtbl` a shared table the per-stage ones link into? Its self-contained
   pointer range suggests it is a good place to start.
