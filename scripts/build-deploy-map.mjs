#!/usr/bin/env node
/**
 * Build the build-id → deployment-URL map that lets the middleware serve an old
 * tab's requests from the deployment it was loaded from (src/domain/deploySkew.ts).
 *
 * Runs in CI before the Cloudflare build. Lists this project's recent successful
 * Pages deployments for one environment and prints a JSON object
 * { "<git sha>": "https://<id>.verazadoptantes2.pages.dev", … }.
 * With --github-env it appends APP_DEPLOY_MAP=<json> to $GITHUB_ENV.
 *
 *   node scripts/build-deploy-map.mjs --env production
 *   node scripts/build-deploy-map.mjs --env preview --branch staging --github-env
 *
 * Fails (exit 1) when the API cannot be read or no deployment qualifies: an empty
 * map silently degrades every old tab to the "reload" notice, which is the
 * failure we are here to prevent.
 */
import { appendFileSync } from 'node:fs';

const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const ENV = arg('--env') || 'production';
const BRANCH = arg('--branch') || (ENV === 'production' ? 'master' : 'staging');
const MAX_AGE_DAYS = Number(arg('--max-age-days') || 14);   // older code may not fit the current DB schema
const MAX_ENTRIES = Number(arg('--max') || 30);
const PROJECT = 'verazadoptantes2';
const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) { console.error('::error::CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID are required'); process.exit(1); }

async function list() {
    const url = `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${PROJECT}/deployments?env=${ENV}&per_page=25`;
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
            const body = await res.json();
            if (res.ok && body.success) return body.result;
            lastErr = JSON.stringify(body.errors ?? res.status);
        } catch (e) { lastErr = String(e); }
        await new Promise(r => setTimeout(r, attempt * 2000));
    }
    throw new Error(`Cloudflare API: ${lastErr}`);
}

try {
    const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
    const map = {};
    for (const d of await list()) {                       // newest first
        const meta = d.deployment_trigger?.metadata ?? {};
        const ok = d.latest_stage?.name === 'deploy' && d.latest_stage?.status === 'success';
        if (!ok || d.environment !== ENV || meta.branch !== BRANCH) continue;
        if (new Date(d.created_on).getTime() < cutoff) continue;
        if (!/^https:\/\/[a-z0-9]+\.verazadoptantes2\.pages\.dev$/.test(d.url)) continue;
        if (meta.commit_hash && !map[meta.commit_hash]) map[meta.commit_hash] = d.url;
        if (Object.keys(map).length >= MAX_ENTRIES) break;
    }
    const n = Object.keys(map).length;
    if (!n) { console.error(`::error::no successful ${ENV}/${BRANCH} deployment in the last ${MAX_AGE_DAYS} days — the deploy map would be empty`); process.exit(1); }
    const json = JSON.stringify(map);
    if (process.argv.includes('--github-env')) {
        appendFileSync(process.env.GITHUB_ENV, `APP_DEPLOY_MAP=${json}\n`);
        const [prevSha] = Object.keys(map);
        appendFileSync(process.env.GITHUB_ENV, `APP_PREVIOUS_BUILD_ID=${prevSha}\n`);
        console.log(`deploy map: ${n} ${ENV}/${BRANCH} deployment(s); newest previous build ${prevSha.slice(0, 10)}`);
    } else {
        console.log(json);
    }
} catch (e) {
    console.error(`::error::could not build the deploy map: ${e.message}`);
    process.exit(1);
}
