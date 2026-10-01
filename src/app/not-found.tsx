export const runtime = 'edge';

import { connection } from 'next/server';
import NotFoundView, { type NotFoundVariant } from '@/components/notFound/NotFoundView';

/** Dog or cat, picked per request on the server (picking on the client would
 *  mismatch hydration). connection() keeps this out of build-time prerender,
 *  which would freeze one variant forever. */
export default async function NotFound() {
    await connection();
    const variant: NotFoundVariant = Math.random() < 0.5 ? 'dog' : 'cat';
    return <NotFoundView variant={variant} />;
}
