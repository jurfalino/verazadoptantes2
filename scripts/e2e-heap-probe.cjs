// Loaded into every Node process of the e2e dev server via NODE_OPTIONS
// `--require` (playwright.config.ts, only when E2E_HEAP_PROBE is set). Inside
// the `next-server` process it records the V8 heap, which no outside tool can
// read; scripts/e2e-heap-sampler.sh turns that into the heap log.
// Every 1 s it samples heapUsed; every 10 s it writes "<pid> <max heap MB in
// the window>" to E2E_HEAP_PROBE, so a GC sawtooth peak between two sampler
// ticks is not missed. Never throws, never keeps the process alive.
'use strict';
const fs = require('fs');
const file = process.env.E2E_HEAP_PROBE;
if (file) {
  let max = 0;
  let ticks = 0;
  const timer = setInterval(() => {
    try {
      if (!String(process.title).startsWith('next-server')) return;
      max = Math.max(max, process.memoryUsage().heapUsed);
      if (++ticks % 10 !== 0) return;
      fs.writeFileSync(file, `${process.pid} ${Math.round(max / 1048576)}\n`);
      max = 0;
    } catch (_) { /* a failed sample must never disturb the server */ }
  }, 1000);
  timer.unref();
}
