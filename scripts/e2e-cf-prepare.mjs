#!/usr/bin/env node
// Prepares the Cloudflare build for the e2e server (playwright.cf.config.ts).
//
// Input:  .vercel/output/static  — `APP_BUILD_ID=e2e-build npx @cloudflare/next-on-pages`
//         (CI: the cf-build-e2e artifact of the build-cf job).
// Output: .vercel/e2e-cf-static  — a COPY whose worker entry first loads
//         scripts/e2e-cf-resend-stub.js, then the real entry (renamed app.js).
//
// The original output is never modified: the stub must not be able to reach
// anything that could be deployed. Deploy jobs build their own output anyway.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, '.vercel', 'output', 'static');
const dest = path.join(root, '.vercel', 'e2e-cf-static');
const entry = path.join(src, '_worker.js', 'index.js');

function fail(msg) {
    console.error(`[e2e-cf-prepare] ${msg}`);
    process.exit(1);
}

if (!fs.existsSync(entry)) {
    fail(`no Cloudflare build at ${path.relative(root, entry)} — run: APP_BUILD_ID=e2e-build npx @cloudflare/next-on-pages`);
}
// tests/deploy-skew.authed.spec.ts needs the fixed build id baked in at build
// time (next.config.ts deploymentId). Another id fails that spec confusingly.
const workerFiles = fs.readdirSync(path.join(src, '_worker.js'), { recursive: true })
    .filter((f) => String(f).endsWith('.js'));
const hasBuildId = workerFiles.some((f) => fs.readFileSync(path.join(src, '_worker.js', String(f)), 'utf8').includes('"e2e-build"'));
if (!hasBuildId) fail('the build was not made with APP_BUILD_ID=e2e-build (deploy-skew specs would fail)');

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });

const workerDir = path.join(dest, '_worker.js');
fs.renameSync(path.join(workerDir, 'index.js'), path.join(workerDir, 'app.js'));
fs.copyFileSync(path.join(root, 'scripts', 'e2e-cf-resend-stub.js'), path.join(workerDir, 'e2e-resend-stub.js'));
// ES modules evaluate in import order: the stub patches fetch before app.js loads.
fs.writeFileSync(path.join(workerDir, 'index.js'),
    "import './e2e-resend-stub.js';\nexport { default } from './app.js';\n");

console.error(`[e2e-cf-prepare] ${path.relative(root, dest)} ready (Resend stub in front of the worker)`);
