#!/usr/bin/env bash
# Bundle Claude Code per-project state into .claude-migration/ inside this
# repo so the folder can be pushed to git and unpacked on another machine
# via restore.sh. Run from the project root. See README.md for context.

set -euo pipefail

# ── Paths ────────────────────────────────────────────────────────────────

REPO_ROOT="$(pwd)"
MIGRATION_DIR="$REPO_ROOT/.claude-migration"

# How many of the most recent session transcripts to bundle. The current
# session is always the largest one — at most a few MB; older transcripts
# can be tens of MB each but you only need the recent ones for
# `claude --continue` to resume current work. Tune if you want more history.
KEEP_SESSIONS="${KEEP_SESSIONS:-3}"

# The project key is the absolute path with slashes turned into dashes.
# e.g. /mnt/c/dev/test  →  -mnt-c-dev-test
SRC_KEY="$(echo "$REPO_ROOT" | sed 's|/|-|g')"
SRC_PROJECT_DIR="$HOME/.claude-personal/projects/$SRC_KEY"
SRC_PLANS_DIR="$HOME/.claude-personal/plans"

# ── Sanity checks ────────────────────────────────────────────────────────

if [ ! -d "$REPO_ROOT/.git" ]; then
    echo "❌ Run this from the repo root (no .git directory found at $REPO_ROOT)" >&2
    exit 1
fi

if [ ! -d "$SRC_PROJECT_DIR" ]; then
    echo "❌ No Claude per-project state found at $SRC_PROJECT_DIR" >&2
    echo "   Either the project key is wrong (expected $SRC_KEY) or Claude" >&2
    echo "   Code has never been run in this project on this machine." >&2
    exit 1
fi

# ── Stage everything ─────────────────────────────────────────────────────

echo "📦 Exporting Claude state for migration"
echo "   repo:        $REPO_ROOT"
echo "   source key:  $SRC_KEY"
echo "   destination: $MIGRATION_DIR"
echo

# Fresh staging directory each run — keeps the export reproducible.
rm -rf "$MIGRATION_DIR"
mkdir -p "$MIGRATION_DIR/project" "$MIGRATION_DIR/plans"

# 1. Project memory (small, critical — always include all).
echo "→ memory"
if [ -d "$SRC_PROJECT_DIR/memory" ]; then
    mkdir -p "$MIGRATION_DIR/project/memory"
    cp -R "$SRC_PROJECT_DIR/memory/." "$MIGRATION_DIR/project/memory/"
fi
MEMORY_COUNT=$(find "$MIGRATION_DIR/project/memory" -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
echo "   $MEMORY_COUNT memory file(s)"

# 2. Session transcripts — only the most recent N by mtime. Older
#    transcripts can be tens of MB and aren't needed for `claude --continue`
#    to resume current work. Bump KEEP_SESSIONS if you want more history.
echo "→ session transcripts (most recent $KEEP_SESSIONS by mtime)"
SESSION_COUNT=0
# shellcheck disable=SC2012 # ls -t is the simplest portable mtime sort
for f in $(ls -t "$SRC_PROJECT_DIR"/*.jsonl 2>/dev/null | head -n "$KEEP_SESSIONS"); do
    cp "$f" "$MIGRATION_DIR/project/"
    SESSION_COUNT=$((SESSION_COUNT + 1))
done
TOTAL_SESSIONS=$(find "$SRC_PROJECT_DIR" -maxdepth 1 -name '*.jsonl' 2>/dev/null | wc -l | tr -d ' ')
echo "   $SESSION_COUNT of $TOTAL_SESSIONS total"

# 3. Personal plans (not project-keyed; ALL plans come along — restore can
#    surface plans the user no longer needs, but it's safer than guessing
#    which plan belongs to which project).
if [ -d "$SRC_PLANS_DIR" ]; then
    echo "→ personal plans"
    cp -R "$SRC_PLANS_DIR/." "$MIGRATION_DIR/plans/"
    PLAN_COUNT=$(find "$MIGRATION_DIR/plans" -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
    echo "   $PLAN_COUNT plan file(s)"
else
    echo "→ personal plans: none at $SRC_PLANS_DIR (skipping)"
fi

# 4. User-level Claude config (~/.claude) is intentionally NOT bundled.
#    It contains auth tokens (.credentials.json), large file-history caches,
#    transcripts from other projects, and machine-specific daemon state.
#    Log in fresh on the Mac (`claude` will prompt) and reconfigure MCP
#    servers / hooks / plugins from scratch. If you have settings you want
#    to carry across, copy ~/.claude/settings.json by hand AFTER stripping
#    any credentials.
echo "→ user-level config: skipped on purpose (see export.sh comment)"

# ── Manifest ─────────────────────────────────────────────────────────────

MANIFEST="$MIGRATION_DIR/MANIFEST.txt"
{
    echo "Claude state migration bundle"
    echo "============================="
    echo
    echo "Generated:        $(date -u +'%Y-%m-%d %H:%M:%S UTC')"
    echo "Source host:      $(hostname)"
    echo "Source user:      $(whoami)"
    echo "Source repo root: $REPO_ROOT"
    echo "Source key:       $SRC_KEY"
    echo "Git ref:          $(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
    echo "Git branch:       $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
    echo
    echo "Contents:"
    [ -d "$MIGRATION_DIR/project/memory" ] && echo "  - memory files:        $MEMORY_COUNT" || true
    echo "  - session transcripts: $SESSION_COUNT of $TOTAL_SESSIONS (most recent by mtime)"
    [ -d "$MIGRATION_DIR/plans" ] && echo "  - personal plans:      ${PLAN_COUNT:-0}" || true
    echo "  - user-level config:   skipped (re-login on the Mac to recreate)"
    echo
    echo "Size: $(du -sh "$MIGRATION_DIR" 2>/dev/null | cut -f1)"
    echo
    echo "To restore on the destination machine:"
    echo "  1. cd into the destination repo root"
    echo "  2. ./scripts/migrate-claude-state/restore.sh"
} > "$MANIFEST"

cat "$MANIFEST"

echo
echo "✅ Done. Bundle at $MIGRATION_DIR"
echo
echo "Next steps:"
echo "  git add .claude-migration/"
echo "  git commit -m 'chore: stage Claude state for migration'"
echo "  git push"
