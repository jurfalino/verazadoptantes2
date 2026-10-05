export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'offline';
const RETRY_MS = 3000;

/** Debounced, retrying save of a serialized payload. DOM-free so it is unit-testable. */
export class AutosaveQueue {
    private pending: string | null = null;
    private lastSaved: string | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private inflight: Promise<boolean> | null = null;
    constructor(private save: (payload: string) => Promise<boolean>, private delayMs: number, private onStatus: (s: AutosaveStatus) => void) {}

    schedule(payload: string) {
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        if (payload === this.lastSaved) {
            if (this.pending !== null) { this.pending = null; this.onStatus('saved'); }
            return;
        }
        this.pending = payload;
        this.onStatus('saving'); // unsaved typing must never read "Guardado"
        this.timer = setTimeout(() => { void this.flush(); }, this.delayMs);
    }

    async flush(): Promise<boolean> {
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        if (this.inflight) await this.inflight;
        const payload = this.pending;
        if (payload === null || payload === this.lastSaved) return true;
        this.onStatus('saving');
        // Import-free on purpose (unit-tested); the save function reports errors at its own boundary.
        this.inflight = this.save(payload).catch(() => false);
        const ok = await this.inflight;
        this.inflight = null;
        if (ok) {
            this.lastSaved = payload;
            if (this.pending === payload) { this.pending = null; this.onStatus('saved'); }
            // else: newer typing arrived mid-save; its own timer is already scheduled.
        } else {
            this.onStatus('offline');
            this.timer = setTimeout(() => { void this.flush(); }, RETRY_MS);
        }
        return ok;
    }

    /** Unmount: never drop a pending change. */
    dispose() {
        if (this.timer) clearTimeout(this.timer);
        if (this.pending !== null) void this.flush();
    }
}
