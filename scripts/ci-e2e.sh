#!/bin/bash
# CI's e2e step for one shard: `scripts/ci-e2e.sh <playwright args…>`.
#
# `next dev` restarts itself when its heap nears --max-old-space-size, and the
# test in flight dies with a refused/reset connection — a different test each
# time (.agents/plans/e2e-shard-the-suite.md). Playwright's own retries land on
# the same dying server, so they don't help.
#
# ONE retry, and only when BOTH show in the log: the memory restart AND a
# dropped connection. The restart alone is not enough — most shards log one
# even when green, so a real assertion failure would qualify. The retry runs
# the WHOLE shard again, in order, on a fresh server: never --last-failed,
# which skips tests that never ran (serial specs, a failed beforeAll or setup)
# and can go green without them (review of v2.56.183). The first attempt's
# report is kept. Test: src/lib/ciE2eRetry.test.ts.
set -o pipefail

LOG=e2e-attempt-1.log
if npx playwright test "$@" 2>&1 | tee "$LOG"; then
    exit 0
fi

RESTART='approaching the used memory threshold'
DROPPED='ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE|ECONNREFUSED|socket hang up'
if ! grep -q "$RESTART" "$LOG" || ! grep -Eq "$DROPPED" "$LOG"; then
    exit 1
fi

# Attempt 2 overwrites playwright-report/ — keep attempt 1's traces and screenshots.
if [ -d playwright-report ]; then
    rm -rf playwright-report-attempt-1
    mv playwright-report playwright-report-attempt-1
fi

restarts=$(grep -c "$RESTART" "$LOG")
echo "::warning::e2e: the dev server hit a memory restart ($restarts×) and dropped a connection — re-running the whole shard once on a fresh server"
npx playwright test "$@"
