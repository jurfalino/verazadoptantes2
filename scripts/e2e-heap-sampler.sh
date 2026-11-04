#!/bin/bash
# Memory log for the e2e dev server (task C1, 2026-11-03).
#
# `next dev` restarts when its heap passes ~80% of the limit and kills the test
# in flight. To see how close each leg gets, this loop appends one line every
# E2E_HEAP_INTERVAL seconds (default 10) to E2E_HEAP_LOG (default e2e-heap.log):
#
#     <epoch> <rss_kb> <heap_used_mb>
#
# heap_used_mb is the peak of the last window, written by the in-process probe
# (scripts/e2e-heap-probe.cjs) to E2E_HEAP_PROBE as "<pid> <mb>"; rss_kb is that
# pid's VmRSS. No probe file yet (server not up) or pid gone (mid-restart): no
# line. It always exits 0 and stops on TERM/INT, so it can never fail a step.
# E2E_HEAP_ITERATIONS (default: forever) bounds the loop for tests.
LOG=${E2E_HEAP_LOG:-e2e-heap.log}
PROBE=${E2E_HEAP_PROBE:-e2e-heap-probe.txt}
INTERVAL=${E2E_HEAP_INTERVAL:-10}
LEFT=${E2E_HEAP_ITERATIONS:--1}

trap 'exit 0' TERM INT

while [ "$LEFT" -ne 0 ]; do
    read -r pid heap < "$PROBE" 2>/dev/null
    if [[ "$pid" =~ ^[0-9]+$ && "$heap" =~ ^[0-9]+$ ]]; then
        rss=$(awk '/^VmRSS:/ {print $2}' "/proc/$pid/status" 2>/dev/null)
        [ -z "$rss" ] && rss=$(ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ')
        if [[ "$rss" =~ ^[0-9]+$ ]]; then
            echo "$(date +%s) $rss $heap" >> "$LOG" 2>/dev/null
        fi
    fi
    pid=''; heap=''
    [ "$LEFT" -gt 0 ] && LEFT=$((LEFT - 1))
    [ "$LEFT" -eq 0 ] && break
    sleep "$INTERVAL" &
    wait $!
done
exit 0
