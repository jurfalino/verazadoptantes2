/**
 * Whether an import run is finished, still going, or stopped.
 *
 * An import is driven by the rescuer's open tab — nothing continues on the
 * server once that tab is closed or reloaded. So a run that is not finished and
 * has shown no activity for a while has stopped, not "en curso". Activity is the
 * last saved row; a run that never saved a row is timed from its start (it used
 * to read "en curso" forever).
 */
export type ImportRunState = 'completed' | 'interrupted' | 'running';

export const IMPORT_RUN_IDLE_SECS = 300;

type When = Date | number | string | null | undefined;

/** Seconds since the epoch, from a Date, epoch seconds/ms, or an ISO string. */
function toSecs(v: When): number | null {
    if (v == null || v === '') return null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime() / 1000;
    if (typeof v === 'number') return v > 1e12 ? v / 1000 : v;
    const n = Number(v);
    if (Number.isFinite(n)) return n > 1e12 ? n / 1000 : n;
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t / 1000;
}

export function importRunState(
    run: { finishedAt?: When; lastItemAt?: When; startedAt?: When },
    nowSecs: number,
): ImportRunState {
    if (run.finishedAt) return 'completed';
    const last = toSecs(run.lastItemAt) ?? toSecs(run.startedAt);
    if (last != null && nowSecs - last > IMPORT_RUN_IDLE_SECS) return 'interrupted';
    return 'running';
}
