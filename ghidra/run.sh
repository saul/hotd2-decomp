#!/usr/bin/env bash
# Reproducible Ghidra headless driver for the HOTD2 project.
#
#   ./ghidra/run.sh rebuild             import + apply every committed annotation
#   ./ghidra/run.sh import              create the project and run auto-analysis
#   ./ghidra/run.sh apply-annotations   replay ghidra/annotations/*.tsv onto the DB
#   ./ghidra/run.sh export-annotations  dump the DB's project symbols back to TSV
#   ./ghidra/run.sh script <Name>       run ghidra/scripts/<Name> against the program
#   ./ghidra/run.sh list                list available scripts
#
# `rebuild` is the one to run after a fresh checkout: it produces a database
# with every name, label and dispatch table this project has recovered.
#
# Environment overrides:
#   GHIDRA_HOME   default ~/ghidra_12.1.3_PUBLIC
#   GAME_DIR      default "$HOME/THE HOUSE OF THE DEAD 2"
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GHIDRA_HOME="${GHIDRA_HOME:-$HOME/ghidra_12.1.3_PUBLIC}"
GAME_DIR="${GAME_DIR:-$HOME/THE HOUSE OF THE DEAD 2}"
HEADLESS="$GHIDRA_HOME/support/analyzeHeadless"

PROJECT_DIR="$REPO/ghidra/project"
PROJECT_NAME="HOTD2"
PROGRAM="Hod2.exe"
SCRIPTS="$REPO/ghidra/scripts"
OUT="$REPO/ghidra/out"

export HOTD2_OUT="$OUT"
export HOTD2_REPO="$REPO"
mkdir -p "$PROJECT_DIR" "$OUT"

[[ -x "$HEADLESS" ]] || { echo "error: analyzeHeadless not found at $HEADLESS" >&2; exit 1; }

case "${1:-}" in
  import)
    [[ -f "$GAME_DIR/$PROGRAM" ]] || { echo "error: $GAME_DIR/$PROGRAM not found" >&2; exit 1; }
    echo "Importing $PROGRAM (this takes a few minutes)..."
    "$HEADLESS" "$PROJECT_DIR" "$PROJECT_NAME" \
      -import "$GAME_DIR/$PROGRAM" \
      -processor x86:LE:32:default \
      -cspec windows \
      > "$OUT/import.log" 2>&1
    grep -iE "Analysis succeeded|Import succeeded|ERROR" "$OUT/import.log" | tail -5
    ;;

  rebuild)
    "$0" import
    echo "Applying recovered dispatch tables..."
    HOTD2_APPLY=1 "$0" script ApplyKnownTables.java
    echo "Applying committed annotations..."
    HOTD2_APPLY=1 "$0" script ApplyAnnotations.java
    echo "Done. The database now carries every symbol in ghidra/annotations/."
    ;;

  apply-annotations)
    HOTD2_APPLY="${HOTD2_APPLY:-}" "$0" script ApplyAnnotations.java
    ;;

  export-annotations)
    "$0" script ExportAnnotations.java
    ;;

  script)
    # **A failed run must not look like a quiet one.**
    #
    # This was `"$HEADLESS" ... > log 2>&1` followed by a grep, under
    # `set -e`. When the headless analyzer exits non-zero -- which it does
    # whenever the Ghidra GUI holds the project lock -- `set -e` killed the
    # script *before* the grep, so the command printed nothing at all and the
    # caller saw an empty output and an unchanged `git diff ghidra/annotations`.
    # That reads exactly like "there was nothing to export". It is not: it is
    # "the database was never opened", and a session's worth of renames stays
    # uncommitted while you believe it is saved.
    NAME="${2:?usage: run.sh script <ScriptName>}"
    set +e
    "$HEADLESS" "$PROJECT_DIR" "$PROJECT_NAME" \
      -process "$PROGRAM" -noanalysis \
      -scriptPath "$SCRIPTS" -postScript "$NAME" \
      > "$OUT/script.log" 2>&1
    rc=$?
    set -e
    grep -iE "\[hotd2\]|ERROR|Exception" "$OUT/script.log" | head -20 || true
    if [[ $rc -ne 0 ]]; then
      echo "error: headless exited $rc; $NAME did not run. Full log: $OUT/script.log" >&2
      if grep -q "LockException" "$OUT/script.log"; then
        echo "       the project is locked -- close the Ghidra GUI and retry." >&2
      fi
      exit $rc
    fi
    ;;

  list)
    ls -1 "$SCRIPTS"
    ;;

  *)
    sed -n '2,12p' "${BASH_SOURCE[0]}"
    exit 1
    ;;
esac
