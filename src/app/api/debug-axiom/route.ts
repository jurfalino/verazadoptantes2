export const runtime = 'edge';

import { getRequestContext } from '@cloudflare/next-on-pages';

export async function GET() {
    const debug: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
        test: 'axiom-connection'
    };

    try {
        const { env } = getRequestContext();
        debug.hasAxiomDataset = !!env?.AXIOM_DATASET;
        debug.hasAxiomToken = !!env?.AXIOM_TOKEN;
        debug.dataset = env?.AXIOM_DATASET;

        if (!env?.AXIOM_DATASET || !env?.AXIOM_TOKEN) {
            debug.error = 'Missing AXIOM_DATASET or AXIOM_TOKEN in environment';
            return Response.json(debug);
        }

        // Send test log
        const testLog = [{
            _time: new Date().toISOString(),
            level: 'info',
            message: 'Axiom test from debug endpoint',
            source: 'api/debug-axiom',
            testId: crypto.randomUUID().slice(0, 8)
        }];

        const response = await fetch(`https://api.axiom.co/v1/datasets/${env.AXIOM_DATASET}/ingest`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${env.AXIOM_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(testLog)
        });

        debug.axiomStatus = response.status;
        debug.axiomOk = response.ok;

        if (!response.ok) {
            debug.axiomError = await response.text();
        } else {
            debug.success = true;
            debug.logSent = testLog[0];
        }

    } catch (e) {
        debug.error = e instanceof Error ? e.message : String(e);
    }

    return Response.json(debug, { status: 200 });
}
