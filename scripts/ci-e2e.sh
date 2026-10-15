#!/bin/bash
# CI's e2e step for one shard: `scripts/ci-e2e.sh <playwright args…>`.
#
# `next dev` restarts itself when its heap nears --max-old-space-size, and the
# test in flight dies with ERR_CONNECTION_REFUSED/RESET — a different test each
# time (.agents/plans/e2e-shard-the-suite.md). Playwright's own retries land on
# the same dying server, so they don't help.
#
# When an attempt fails AND its log shows that restart, re-run ONLY the failed
# tests (--last-failed) on a fresh server: few routes to compile, so it doesn't
# reach the ceiling again. A real failure fails again and fails the step. A
# failure without the restart is never retried. Test: src/lib/ciE2eRetry.test.ts.
set -o pipefail

LOG=e2e-attempt-1.log
if npx playwright test "$@" 2>&1 | tee "$LOG"; then
    exit 0
fi

if ! grep -q "approaching the used memory threshold" "$LOG"; then
    exit 1
fi

restarts=$(grep -c "approaching the used memory threshold" "$LOG")
echo "::warning::e2e: the dev server hit a memory restart ($restarts×) — re-running only the failed tests on a fresh server"
npx playwright test "$@" --last-failed
