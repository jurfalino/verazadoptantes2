#!/usr/bin/env bash
# Remap a Claude Code project's local state from another machine's path-key to
# THIS machine's path-key, and fix the embedded "cwd" inside session transcripts.
#
# Claude stores per-project state at  <home>/projects/<KEY>/  where <KEY> is the
# repo's absolute path with '/' -> '-'. When the repo lives at a different path
# on the new machine the key changes AND every transcript record still carries
# the OLD "cwd". This script fixes both. Memory files and plans contain no
# paths, so they need no edits (they just ride along inside the folder).
#
# It is portable (bash 3.2 / macOS, GNU/Linux) and idempotent: re-running only
# fixes whatever is still stale. Nothing is touched outside <home>/projects.
#
# Usage:
#   remap-project.sh --home <claude-home> --new <new-project-path> \
#                    [--old <old-key>] [--from <src-project-dir>] [--dry-run]
#
#   --home   Claude state root, e.g. ~/.claude-personal or ~/.claude
#   --new    The repo's absolute path ON THIS machine (used to derive the key)
#   --old    Old key folder name under <home>/projects (auto-detected if omitted
#            and there's exactly one candidate)
#   --from   A source projects/<KEY> directory copied from the other machine
#            (e.g. an rsync/\\wsl.localhost path). Copied in, then remapped.
#   --dry-run  Print actions, change nothing.
#
# Examples:
#   # personal project, state already under ~/.claude-personal (cwd fix only)
#   remap-project.sh --home ~/.claude-personal \
#       --new /Users/jurfalino/Developer/Personal/verazadoptantes2
#
#   # work project: pull the WSL folder in, then remap to the Mac path
#   remap-project.sh --home ~/.claude \
#       --from /tmp/wsl-claude/projects/-mnt-c-work-mclass \
#       --new /Users/jurfalino/Developer/Amplify/mclass-enrollment-service

set -euo pipefail

HOME_DIR=""; NEW_PATH=""; OLD_KEY=""; FROM_DIR=""; DRY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --home) HOME_DIR="$2"; shift 2;;
    --new)  NEW_PATH="$2"; shift 2;;
    --old)  OLD_KEY="$2";  shift 2;;
    --from) FROM_DIR="$2"; shift 2;;
    --dry-run) DRY=1; shift;;
    -h|--help) grep '^#' "$0" | grep -v '^#!' | sed 's/^# \{0,1\}//'; exit 0;;
    *) echo "Unknown arg: $1" >&2; exit 1;;
  esac
done

[ -n "$HOME_DIR" ] || { echo "ERROR: --home required" >&2; exit 1; }
[ -n "$NEW_PATH" ] || { echo "ERROR: --new required" >&2; exit 1; }

# Expand a leading ~ if it was passed literally.
HOME_DIR="${HOME_DIR/#\~/$HOME}"
FROM_DIR="${FROM_DIR/#\~/$HOME}"
PROJECTS="$HOME_DIR/projects"

# Key for THIS machine: every '/' -> '-' (leading '/' becomes leading '-').
NEW_KEY="$(printf '%s' "$NEW_PATH" | sed 's|/|-|g')"
DEST="$PROJECTS/$NEW_KEY"

echo "Claude home:  $HOME_DIR"
echo "New path:     $NEW_PATH"
echo "New key:      $NEW_KEY"
[ "$DRY" -eq 1 ] && echo "(dry-run: no changes will be made)"
echo

TS="$(date +%Y%m%d-%H%M%S)"
[ "$DRY" -eq 1 ] || mkdir -p "$PROJECTS"

# ── 1. Bring the source folder in (if --from) ────────────────────────────────
if [ -n "$FROM_DIR" ]; then
  [ -d "$FROM_DIR" ] || { echo "ERROR: --from not found: $FROM_DIR" >&2; exit 1; }
  echo "→ copying source state from $FROM_DIR"
  if [ -d "$DEST" ]; then
    echo "  backing up existing $DEST -> $DEST.bak-$TS"
    [ "$DRY" -eq 1 ] || mv "$DEST" "$DEST.bak-$TS"
  fi
  [ "$DRY" -eq 1 ] || { mkdir -p "$DEST"; cp -R "$FROM_DIR/." "$DEST/"; }
  SRC_DIR="$DEST"
else
  # ── 2. Locate the existing source folder under projects/ ───────────────────
  if [ -d "$DEST" ]; then
    SRC_DIR="$DEST"                       # already at new key: cwd fix only
  elif [ -n "$OLD_KEY" ]; then
    SRC_DIR="$PROJECTS/$OLD_KEY"
    [ -d "$SRC_DIR" ] || { echo "ERROR: --old folder not found: $SRC_DIR" >&2; exit 1; }
  else
    # auto-detect: exactly one project folder that isn't already the new key
    CANDS=()
    while IFS= read -r d; do CANDS+=("$d"); done < <(
      find "$PROJECTS" -maxdepth 1 -mindepth 1 -type d \
        ! -name "$NEW_KEY" ! -name '*.bak-*' -exec basename {} \; 2>/dev/null
    )
    if [ "${#CANDS[@]}" -eq 0 ]; then
      echo "ERROR: nothing to remap under $PROJECTS" >&2
      echo "       Copy the source folder in first, or pass --from / --old." >&2
      exit 1
    elif [ "${#CANDS[@]}" -gt 1 ]; then
      echo "ERROR: multiple project folders found — pass --old to pick one:" >&2
      printf '         %s\n' "${CANDS[@]}" >&2
      exit 1
    fi
    SRC_DIR="$PROJECTS/${CANDS[0]}"
    echo "→ auto-detected source key: ${CANDS[0]}"
  fi
fi

# ── 3. Rename to the new key ────────────────────────────────────────────────
if [ "$SRC_DIR" != "$DEST" ]; then
  if [ -d "$DEST" ]; then
    echo "→ backing up existing $DEST -> $DEST.bak-$TS"
    [ "$DRY" -eq 1 ] || mv "$DEST" "$DEST.bak-$TS"
  fi
  echo "→ renaming $(basename "$SRC_DIR") -> $NEW_KEY"
  [ "$DRY" -eq 1 ] || mv "$SRC_DIR" "$DEST"
fi

# ── 4. Remap "cwd" inside transcripts ───────────────────────────────────────
# Read the ACTUAL old cwd values straight from the files, so we never need to
# know the source path up front. The OLD ROOT is the shortest cwd present; we
# replace only that prefix, so subdir cwds (e.g. .../contract-app) keep their
# suffix. Only the cwd FIELD is touched — never path mentions in chat text.
# Deriving the root from the files (not by reversing the key) is essential:
# repo names with literal hyphens would otherwise turn '-' back into '/'.
SCAN_DIR="$DEST"; [ "$DRY" -eq 1 ] && [ "$SRC_DIR" != "$DEST" ] && SCAN_DIR="$SRC_DIR"

# Escape a string for use on sed's LHS (regex) / RHS (replacement, '|' delim).
esc_lhs() { printf '%s' "$1" | sed 's/[][\.*^$/|&]/\\&/g'; }
esc_rhs() { printf '%s' "$1" | sed 's/[\\|&]/\\&/g'; }

if ls "$SCAN_DIR"/*.jsonl >/dev/null 2>&1; then
  OLD_CWDS="$(grep -ho '"cwd":"[^"]*"' "$SCAN_DIR"/*.jsonl 2>/dev/null \
              | sort -u | sed 's/^"cwd":"//; s/"$//')"

  # Stale = cwd values not already at/under the new path.
  STALE="$(printf '%s\n' "$OLD_CWDS" | grep -v "^$(esc_lhs "$NEW_PATH")" || true)"

  if [ -z "$STALE" ]; then
    echo "→ cwd already correct in all transcripts (nothing to remap)"
  else
    OLD_ROOT="$(printf '%s\n' "$STALE" | awk 'NF{print length, $0}' | sort -n | head -1 | cut -d' ' -f2-)"
    echo "→ old root: $OLD_ROOT"
    echo "→ new root: $NEW_PATH"
    printf '%s\n' "$STALE" | sed 's/^/    will fix cwd prefix: /'
    if [ "$DRY" -eq 0 ]; then
      EXPR="s|\"cwd\":\"$(esc_lhs "$OLD_ROOT")|\"cwd\":\"$(esc_rhs "$NEW_PATH")|g"
      for f in "$SCAN_DIR"/*.jsonl; do
        tmp="$f.remap.$$"
        sed "$EXPR" "$f" > "$tmp" && mv "$tmp" "$f"
      done
      remaining="$(grep -ho '"cwd":"[^"]*"' "$SCAN_DIR"/*.jsonl 2>/dev/null \
                   | sort -u | sed 's/^"cwd":"//; s/"$//' \
                   | grep -vc "^$(esc_lhs "$NEW_PATH")" || true)"
      echo "→ done. stale cwd roots remaining: ${remaining:-0}"
    fi
  fi
else
  echo "→ no .jsonl transcripts in folder (memory/plans-only — nothing to remap)"
fi

echo
echo "✅ Remap complete for $NEW_KEY"
[ "$DRY" -eq 1 ] && echo "   (dry-run — re-run without --dry-run to apply)"
echo "   Verify with:  claude --resume   (run from $NEW_PATH)"
