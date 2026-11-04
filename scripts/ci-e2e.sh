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
#
# BUDGET (2026-11-03): the workflow step has a timeout (E2E_STEP_BUDGET_SEC,
# default 1500 = 25 min, under the job's 30). A re-run only helps if it can
# finish, so it happens only when attempt 1 took at most (budget - 60) / 2
# seconds — the 60 is slack for teardown. Otherwise the step fails now, with a
# clear message, rather than being killed mid-re-run. Separately, a leg that
# used more than E2E_WARN_AT_SEC (default 900) prints a warning, green or not,
# so a leg creeping toward the job limit is seen before it fails.
set -o pipefail

BUDGET=${E2E_STEP_BUDGET_SEC:-1500}
WARN_AT=${E2E_WARN_AT_SEC:-900}
JOB_LIMIT=1800
START=$(date +%s)

# Exit with $1 after the leg-budget warning (if the leg ran long).
finish() {
    local used=$(( $(date +%s) - START ))
    if [ "$used" -gt "$WARN_AT" ]; then
        echo "::warning::e2e leg used ${used}s of its ${JOB_LIMIT}s job limit"
    fi
    exit "$1"
}

LOG=e2e-attempt-1.log
if npx playwright test "$@" 2>&1 | tee "$LOG"; then
    finish 0
fi
ATTEMPT1_SEC=$(( $(date +%s) - START ))

RESTART='approaching the used memory threshold'
DROPPED='ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE|ECONNREFUSED|socket hang up'
if ! grep -q "$RESTART" "$LOG" || ! grep -Eq "$DROPPED" "$LOG"; then
    finish 1
fi

if [ "$ATTEMPT1_SEC" -gt $(( (BUDGET - 60) / 2 )) ]; then
    echo "::warning::e2e: no time left for a re-run (attempt 1 took ${ATTEMPT1_SEC}s of a ${BUDGET}s budget)"
    finish 1
fi

# Attempt 2 overwrites playwright-report/ — keep attempt 1's traces and screenshots.
if [ -d playwright-report ]; then
    rm -rf playwright-report-attempt-1
    mv playwright-report playwright-report-attempt-1
fi

restarts=$(grep -c "$RESTART" "$LOG")
echo "::warning::e2e: the dev server hit a memory restart ($restarts×) and dropped a connection — re-running the whole shard once on a fresh server"
npx playwright test "$@"
rc=$?
finish "$rc"
