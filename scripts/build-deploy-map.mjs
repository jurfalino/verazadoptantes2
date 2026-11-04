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
 *
 * The deployment live right now is always mapped, however old: its tabs are the
 * ones open, and it already runs on the schema this run migrated to. The age
 * window applies to the builds before it. (2026-11-04: a release 16 days after
 * the last one found nothing inside 14 days and refused to deploy.)
 */
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const ENV = arg('--env') || 'production';
const BRANCH = arg('--branch') || (ENV === 'production' ? 'master' : 'staging');
const MAX_AGE_DAYS = Number(arg('--max-age-days') || 14);   // older code may not fit the current DB schema
const MAX_ENTRIES = Number(arg('--max') || 30);
const PROJECT = 'verazadoptantes2';
const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID;

async function page(n) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${PROJECT}/deployments?env=${ENV}&per_page=25&page=${n}`;
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

/** A successful deployment of this environment and branch, at a pages.dev URL. */
function qualifies(d, env, branch) {
    const meta = d.deployment_trigger?.metadata ?? {};
    const ok = d.latest_stage?.name === 'deploy' && d.latest_stage?.status === 'success';
    return ok && d.environment === env && meta.branch === branch
        && /^https:\/\/[a-z0-9]+\.verazadoptantes2\.pages\.dev$/.test(d.url);
}

/**
 * Deployments (newest first) -> { sha: url }. The newest qualifying one is the live
 * build and is kept whatever its age; older ones only inside the cutoff. The sha
 * being built is never mapped: on a re-run it is already deployed, and the
 * post-deploy check would then probe "the previous build" with itself.
 */
export function pickDeployments(rows, { env, branch, cutoff, sha, max = 30 }) {
    const map = {};
    let live = true;
    for (const d of rows) {
        if (!qualifies(d, env, branch)) continue;
        const isLive = live;
        live = false;
        const commit = d.deployment_trigger?.metadata?.commit_hash;
        if (!isLive && new Date(d.created_on).getTime() < cutoff) continue;
        if (!commit || commit === sha || Object.hasOwn(map, commit)) continue;
        map[commit] = d.url;
        if (Object.keys(map).length >= max) break;
    }
    return map;
}

/** Newest first, page by page, until past the cutoff and the live build is seen (about half the rows are 'idle' duplicates). */
async function list(cutoff) {
    const all = [];
    for (let n = 1; n <= 8; n++) {
        const rows = await page(n);
        all.push(...rows);
        const pastCutoff = rows.length > 0 && new Date(rows.at(-1).created_on).getTime() < cutoff;
        if (rows.length < 25 || (pastCutoff && all.some((d) => qualifies(d, ENV, BRANCH)))) break;
    }
    return all;
}

/**
 * Escape hatch: ALLOW_EMPTY_DEPLOY_MAP=1 lets a hotfix deploy through a
 * Cloudflare API outage. Old tabs then fall back to the "new version" notice.
 */
function giveUp(message) {
    if (process.env.ALLOW_EMPTY_DEPLOY_MAP === '1') {
        console.log(`::warning title=Deploy map::${message} — continuing WITHOUT skew forwarding (ALLOW_EMPTY_DEPLOY_MAP=1)`);
        if (process.argv.includes('--github-env')) appendFileSync(process.env.GITHUB_ENV, 'APP_DEPLOY_MAP={}\nAPP_PREVIOUS_BUILD_ID=\n');
        process.exit(0);
    }
    console.error(`::error::${message}`);
    process.exit(1);
}

async function main() {
    if (!token || !account) { console.error('::error::CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID are required'); process.exit(1); }
    const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
    const map = pickDeployments(await list(cutoff), { env: ENV, branch: BRANCH, cutoff, sha: process.env.GITHUB_SHA, max: MAX_ENTRIES });
    const n = Object.keys(map).length;
    if (!n) giveUp(`no successful ${ENV}/${BRANCH} deployment to forward old tabs to — the deploy map would be empty`);
    const json = JSON.stringify(map);
    if (process.argv.includes('--github-env')) {
        appendFileSync(process.env.GITHUB_ENV, `APP_DEPLOY_MAP=${json}\n`);
        const [prevSha] = Object.keys(map);
        appendFileSync(process.env.GITHUB_ENV, `APP_PREVIOUS_BUILD_ID=${prevSha}\n`);
        console.log(`deploy map: ${n} ${ENV}/${BRANCH} deployment(s); newest previous build ${prevSha.slice(0, 10)}`);
    } else {
        console.log(json);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((e) => giveUp(`could not build the deploy map: ${e.message}`));
}
