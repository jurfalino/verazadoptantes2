export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'offline' | 'error';
/** 'retry' = transient (offline, retried once per RETRY_MS); 'fatal' = will never succeed as-is (no retry). */
export type SaveResult = 'ok' | 'retry' | 'fatal';
const RETRY_MS = 3000;

/** Debounced, serialized, retrying save of a serialized payload. DOM-free so it is unit-testable. */
export class AutosaveQueue {
    private pending: string | null = null;
    private lastSaved: string | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private chain: Promise<boolean> = Promise.resolve(true);
    private inflight = false;
    private disposed = false;
    constructor(private save: (payload: string) => Promise<SaveResult>, private delayMs: number, private onStatus: (s: AutosaveStatus) => void) {}

    schedule(payload: string) {
        if (this.disposed) return;
        this.clearTimer();
        // Never short-circuit while a save is in flight: it may be writing a different payload.
        if (payload === this.lastSaved && !this.inflight) {
            this.pending = null;
            this.onStatus('saved');
            return;
        }
        this.pending = payload;
        this.onStatus('saving'); // unsaved typing must never read "Guardado"
        this.timer = setTimeout(() => { void this.flush(); }, this.delayMs);
    }

    /** Every flush runs after the previous one: at most one save at a time, in order. */
    flush(): Promise<boolean> {
        this.chain = this.chain.then(() => this.doFlush());
        return this.chain;
    }

    private clearTimer() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } }

    private async doFlush(): Promise<boolean> {
        this.clearTimer();
        const payload = this.pending;
        if (payload === null) return true;
        if (payload === this.lastSaved) { this.pending = null; this.onStatus('saved'); return true; }
        this.onStatus('saving');
        this.inflight = true;
        // Import-free on purpose (unit-tested); the save function reports errors at its own boundary.
        const result = await this.save(payload).catch((): SaveResult => 'retry');
        this.inflight = false;
        if (result === 'ok') {
            this.lastSaved = payload;
            if (this.pending === null || this.pending === payload || this.pending === this.lastSaved) {
                this.pending = null;
                this.onStatus('saved');
            } else if (!this.disposed) {
                // Newer typing arrived mid-save; its timer was cleared by flush ordering, so re-arm.
                this.timer = setTimeout(() => { void this.flush(); }, this.delayMs);
            }
            return true;
        }
        if (result === 'fatal') { this.onStatus('error'); return false; }
        this.onStatus('offline');
        if (!this.disposed) this.timer = setTimeout(() => { void this.flush(); }, RETRY_MS);
        return false;
    }

    /** Unmount: one final flush of a pending change, never any retries afterwards. */
    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.clearTimer();
        if (this.pending !== null) void this.flush();
    }
}
