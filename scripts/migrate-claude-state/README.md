# Claude Code state migration — WSL → macOS (or any path → any path)

Two scripts that bundle the Claude Code per-project state (auto-memory,
session transcripts, personal plans, optionally user-level config) into a
folder inside this repo, then unpack it on a different machine.

## The why

Claude Code keeps per-project state at
`~/.claude-personal/projects/<KEY>/` where `<KEY>` is the project's working
directory with `/` → `-` (so `/mnt/c/dev/test` becomes `-mnt-c-dev-test`).
When you move the repo to a different path (e.g. `/Users/you/dev/test` on a
Mac) the key changes, so Claude won't find the existing memory. **The
restore script handles that remap automatically.**

## One-shot use, not a permanent commit

`.claude-migration/` (created by `export.sh`) is one-shot migration content,
not a permanent part of the repo. Push it, run the restore on the new
machine, then `git rm -r .claude-migration/` and commit the removal.

The session JSONL files inside it can be **large and contain the full
conversation history** — fine for a private repo, but worth noting before
pushing to anywhere with broader visibility.

## Procedure

### On the source machine (WSL)

```bash
cd /mnt/c/dev/test
./scripts/migrate-claude-state/export.sh

# Inspect what was staged — particularly the manifest
cat .claude-migration/MANIFEST.txt

# Commit and push
git add .claude-migration/
git commit -m "chore: stage Claude state for mac migration"
git push origin HEAD:staging   # or whatever branch you're using
```

### On the destination machine (Mac)

```bash
# Clone the repo at the path you want it to live at on the Mac.
# The restore script reads pwd to compute the new project key.
cd ~/dev
git clone <repo-url> test
cd test
git checkout staging   # the branch with the migration folder

./scripts/migrate-claude-state/restore.sh

# Verify:
#   - `claude` should reference memory in the first reply
#   - `claude --continue` should list past sessions
#   - if you enter plan mode, the prior plan file should be available

# Once verified, remove the migration folder so it doesn't linger in the repo:
git rm -r .claude-migration/
git commit -m "chore: remove migration folder after mac restore"
git push
```

## What's included

| Item | Source on WSL | Destination on Mac |
|---|---|---|
| Auto-memory files (ALL) | `~/.claude-personal/projects/<SRC_KEY>/memory/` | `~/.claude-personal/projects/<DST_KEY>/memory/` |
| Session transcripts (most-recent N by mtime, default 3) | `~/.claude-personal/projects/<SRC_KEY>/*.jsonl` | `~/.claude-personal/projects/<DST_KEY>/` |
| Personal plans (ALL) | `~/.claude-personal/plans/*.md` | `~/.claude-personal/plans/` |

`KEEP_SESSIONS=10 ./scripts/migrate-claude-state/export.sh` to bring more
session history along (each older transcript can be tens of MB, so the
default is conservative).

## What's NOT included

- **`~/.claude/` user-level config — intentionally skipped.** It contains
  `.credentials.json` (OAuth tokens), large file-history caches, transcripts
  from other projects, and machine-specific daemon state. Log in fresh on
  the Mac (`claude` will prompt) and reconfigure MCP servers / hooks /
  plugins from scratch. If you have settings you want to carry across,
  copy `~/.claude/settings.json` by hand AFTER stripping credentials.
- Project-level Claude settings (`.claude/settings.local.json`) — already
  in the repo via git, migrates by checkout.
- Project plans / audits (`.agents/...`) — same, in the repo.
- Anything in `/tmp/claude*` — runtime task output, regenerated on demand.
- IDE-side plugin state (VS Code Claude extension etc.) — those are owned
  by the IDE and need to be configured separately on the Mac.

## Safety / dry-run

Both scripts are idempotent — re-running `export.sh` regenerates the
folder; `restore.sh` backs up any existing per-project state on the Mac to
a timestamped `~/.claude-personal/projects/<KEY>.bak-<ts>/` before
overwriting. The WSL machine is unchanged by `export.sh`.
