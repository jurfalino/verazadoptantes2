/** One open «same person?» question about a profile, seen from that profile. */
export interface DuplicateCandidate {
    /** The pair's `duplicate_candidates.id` — what an answer («Mantener separados» / «No es esta persona») resolves. */
    id: string;
    otherAdopterId: string;
    otherAdopterName: string;
    matchTypes: string[];
    score: number;
    confidence: string;
    /** Normalised 0–100 confidence percentage derived from score / PRACTICAL_MAX_DUPLICATE. */
    confidencePercent: number;
    /** The pair is on the viewer's «Pendientes de revisar» list: they created either side and didn't take it off. */
    onViewerList: boolean;
    /** Who in the viewer's group answered «No sé» on a form's «¿Es la misma persona?» (the pair stays pending); null when nobody did. */
    unsureBy?: string | null;
    /** Who loaded the other side, from the viewer's view: their group, another rescuer, or nobody (no real owner). */
    otherSide?: 'team' | 'outside' | 'none';
}
