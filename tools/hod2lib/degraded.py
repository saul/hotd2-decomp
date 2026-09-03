"""What the exporter could not read, and carried on without.

Thirty-odd places in this package answer a failure with an empty result:
``except Exception: return {}``, ``return []``, ``cache[stem] = ([], None)``.
Every one of them is deliberate -- an install missing one `pol/` file should
still produce a bundle, and refusing to export stage 2 because a single
damaged prop model will not parse would be worse than exporting without it.

What was wrong is that they were **silent**. A parser regression anywhere
under here produced a valid bundle with zero characters, exit code 0, and no
message; the player then rendered an empty stage, which looks exactly like a
gameplay bug. `docs/PLAN.md` P6 named "a silent exporter regression" as the
thing nothing in this repository could catch, and this is why.

So the shape stays and the silence goes. A site that swallows says so:

    try:
        prog = scriptlib.load(stage)
    except Exception as exc:
        degraded.note("the stage's event script", "no props", exc)
        return [], []

which prints one line to stderr and appends a record. `build_stage` drains the
records into the stage's manifest entry, so a bundle carries the list of what
is missing from it, and **`export_player.py` exits non-zero if that list is
not empty.** There is no flag for that and there should not be: a `--strict`
nobody passes is a check that never fires, which is the finding this module
answers, one level up. The files are still written, because an incomplete
bundle is usually what you want to look at while finding out why.

**`where` is taken from the caller's frame**, not passed in. A hand-written
location string is a second name for the same thing and it goes stale the
first time a function moves.
"""
from __future__ import annotations

import sys
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class Degradation:
    """One thing the export could not read, and what was given up for it."""

    #: ``module.function`` of the call site, from the caller's frame.
    where: str
    #: What was being read, in the words of whoever wrote the site.
    what: str
    #: What the bundle is missing as a result. The half that matters.
    lost: str
    #: ``TypeName: message``. Not a traceback -- the site is the location.
    error: str

    def line(self) -> str:
        return f"{self.where}: could not read {self.what} ({self.error}) — {self.lost}"


_log: list[Degradation] = []
#: ``(where, exception type)`` already printed. A cache miss inside a loop over
#: two hundred asset slots is one story, not two hundred lines of it; every
#: occurrence is still recorded, only the printing is folded.
_printed: set[tuple[str, str]] = set()


def note(what: str, lost: str, exc: BaseException) -> None:
    """Record that *what* could not be read, and that *lost* is the price."""
    frame = sys._getframe(1)                                    # noqa: SLF001
    where = f"{frame.f_globals.get('__name__', '?')}.{frame.f_code.co_name}"
    rec = Degradation(where=where, what=what, lost=lost,
                      error=f"{type(exc).__name__}: {exc}")
    _log.append(rec)
    key = (where, type(exc).__name__)
    if key not in _printed:
        _printed.add(key)
        print(f"  warning: {rec.line()}", file=sys.stderr)


def reset() -> None:
    """Start a fresh count. `build_stage` calls this so a count is per stage."""
    _log.clear()
    _printed.clear()


def drain() -> list[dict]:
    """Everything recorded since `reset`, as plain dicts, and start again."""
    out = [asdict(r) for r in _log]
    reset()
    return out
