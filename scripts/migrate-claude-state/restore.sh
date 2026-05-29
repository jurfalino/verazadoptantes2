#!/usr/bin/env bash
# Unpack a Claude Code migration bundle (created by export.sh) into the
# right Mac-local paths. The project key is remapped from the source
# machine's pwd-derived key to the destination machine's pwd-derived key.
# Run from the project root on the destination machine.

set -euo pipefail

# ── Paths ────────────────────────────────────────────────────────────────

REPO_ROOT="$(pwd)"
MIGRATION_DIR="$REPO_ROOT/.claude-migration"

# Project key for THIS machine — derived from the current pwd.
DST_KEY="$(echo "$REPO_ROOT" | sed 's|/|-|g')"
DST_PROJECT_DIR="$HOME/.claude-personal/projects/$DST_KEY"
DST_PLANS_DIR="$HOME/.claude-personal/plans"
DST_USER_CONFIG="$HOME/.claude"

# ── Sanity checks ────────────────────────────────────────────────────────

if [ ! -d "$REPO_ROOT/.git" ]; then
    echo "❌ Run this from the repo root (no .git directory found at $REPO_ROOT)" >&2
    exit 1
fi

if [ ! -d "$MIGRATION_DIR" ]; then
    echo "❌ No migration bundle at $MIGRATION_DIR" >&2
    echo "   Make sure you're on the branch that has .claude-migration/ committed." >&2
    exit 1
fi

if [ ! -f "$MIGRATION_DIR/MANIFEST.txt" ]; then
    echo "⚠  Migration folder exists but no MANIFEST.txt — proceeding anyway." >&2
fi

# ── Show the user what's about to happen ─────────────────────────────────

echo "🔓 Restoring Claude state"
echo "   repo:             $REPO_ROOT"
echo "   destination key:  $DST_KEY"
echo
if [ -f "$MIGRATION_DIR/MANIFEST.txt" ]; then
    echo "── Bundle manifest ──"
    cat "$MIGRATION_DIR/MANIFEST.txt"
    echo "─────────────────────"
    echo
fi

# Show the source key if we can find it in the manifest — if it matches
# the destination key, the remap is a no-op but we still copy.
if [ -f "$MIGRATION_DIR/MANIFEST.txt" ]; then
    SRC_KEY="$(grep '^Source key:' "$MIGRATION_DIR/MANIFEST.txt" | sed 's/^Source key:[[:space:]]*//' || true)"
    if [ -n "${SRC_KEY:-}" ] && [ "$SRC_KEY" != "$DST_KEY" ]; then
        echo "   Source key was:  $SRC_KEY"
        echo "   Mapping to:      $DST_KEY"
        echo
    fi
fi

read -r -p "Proceed with restore? [y/N] " confirm
case "$confirm" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; exit 0 ;;
esac

# ── Back up existing destination state if any ────────────────────────────

TS="$(date +%Y%m%d-%H%M%S)"
if [ -d "$DST_PROJECT_DIR" ]; then
    BACKUP="$DST_PROJECT_DIR.bak-$TS"
    echo "📦 Backing up existing project state → $BACKUP"
    mv "$DST_PROJECT_DIR" "$BACKUP"
fi

if [ -d "$DST_PLANS_DIR" ] && [ -d "$MIGRATION_DIR/plans" ]; then
    BACKUP="$DST_PLANS_DIR.bak-$TS"
    echo "📦 Backing up existing plans → $BACKUP"
    mv "$DST_PLANS_DIR" "$BACKUP"
fi

# ── Restore ──────────────────────────────────────────────────────────────

# 1. Project memory + sessions → destination project dir under new key.
echo "→ memory + sessions"
mkdir -p "$DST_PROJECT_DIR"
if [ -d "$MIGRATION_DIR/project" ]; then
    cp -R "$MIGRATION_DIR/project/." "$DST_PROJECT_DIR/"
fi

# 2. Personal plans (not project-keyed).
if [ -d "$MIGRATION_DIR/plans" ]; then
    echo "→ personal plans"
    mkdir -p "$DST_PLANS_DIR"
    cp -R "$MIGRATION_DIR/plans/." "$DST_PLANS_DIR/"
fi

# 3. User-level config (~/.claude). Bundles created by current export.sh
#    don't ship this on purpose (credentials etc.). If an older bundle
#    happens to include it, restore only when nothing exists at the
#    destination to avoid clobbering the Mac's already-configured state.
if [ -d "$MIGRATION_DIR/user-config" ]; then
    if [ -d "$DST_USER_CONFIG" ]; then
        echo "→ user-level config: SKIPPED (existing $DST_USER_CONFIG present)"
        echo "   Inspect $MIGRATION_DIR/user-config/ and merge by hand if needed."
    else
        echo "→ user-level config (legacy bundle)"
        mkdir -p "$DST_USER_CONFIG"
        cp -R "$MIGRATION_DIR/user-config/." "$DST_USER_CONFIG/"
    fi
fi

# ── Done ─────────────────────────────────────────────────────────────────

echo
echo "✅ Restore complete."
echo
echo "Verify:"
echo "  1. Run \`claude\` in this repo. Ask 'what do you know about this project?'"
echo "     — the reply should reference items from MEMORY.md (project memories,"
echo "     feedback memories, references)."
echo "  2. Run \`claude --continue\` and confirm past sessions are listed."
echo "  3. If you enter plan mode, prior plan files should be present at"
echo "     $DST_PLANS_DIR"
echo
echo "When you're satisfied, remove the migration folder from the repo:"
echo "  git rm -r .claude-migration/"
echo "  git commit -m 'chore: remove migration folder after restore'"
echo "  git push"
