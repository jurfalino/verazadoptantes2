import { makeRouteHandler } from '@keystatic/next/route-handler';
import { NextResponse } from 'next/server';
import config from '../../../../../keystatic.config';

export const runtime = 'edge';

// Keystatic GitHub mode requires these env vars. If missing, return a
// helpful error instead of crashing the build.
const hasGitHubConfig =
    process.env.KEYSTATIC_GITHUB_CLIENT_ID &&
    process.env.KEYSTATIC_GITHUB_CLIENT_SECRET &&
    process.env.KEYSTATIC_SECRET;

const missingHandler = () =>
    NextResponse.json(
        { error: 'Keystatic GitHub env vars not configured. Set KEYSTATIC_GITHUB_CLIENT_ID, KEYSTATIC_GITHUB_CLIENT_SECRET, and KEYSTATIC_SECRET.' },
        { status: 503 }
    );

const handler = hasGitHubConfig
    ? makeRouteHandler({ config })
    : { GET: missingHandler, POST: missingHandler };

export const { POST, GET } = handler;
