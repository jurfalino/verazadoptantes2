/**
 * «Pendientes de revisar» reads the duplicate pairs and the general forms side by side. The forms' read never
 * rejects (it toasts its own failure and gives []); the pairs' may. Settled apart, so a failed pairs read still
 * lists the forms and opens a request's link (review M4) — the caller shows the pairs' error with its id.
 */
export async function readBoth<P, R>(pairs: Promise<P>, requests: Promise<R>): Promise<{ pairs: P | null; pairsError: unknown; requests: R }> {
    const [p, r] = await Promise.all([
        pairs.then((value) => ({ value, error: null as unknown }), (error: unknown) => ({ value: null, error })),
        requests,
    ]);
    return { pairs: p.value, pairsError: p.error, requests: r };
}
