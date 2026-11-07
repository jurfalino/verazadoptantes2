/**
 * The group a person was loaded under: stone for your own group, teal for a
 * teammate's. ONE look on the homepage rows and the /my-adopters provenance
 * line (home-cards review, 2026-11-07):
 * - the rating badge's 22px pill box (11px text, 16px line), so in a row
 *   with a rating the two line up and never touch;
 * - a border, because in the dark theme the stone fill equals the card;
 * - one line, cut at 10rem (or narrower when the row is: min-w-0), the whole
 *   name on hover.
 */
export function GroupChip({ name, self }: { name: string; self: boolean }) {
    return (
        <span
            title={name}
            className={`inline-flex items-center min-w-0 max-w-[10rem] px-2 py-0.5 leading-4 rounded-full border text-[11px] font-medium ${self ? 'bg-stone-100 text-stone-600 border-stone-200' : 'bg-teal-50 text-teal-700 border-teal-200'}`}
        >
            <span className="truncate">{name}</span>
        </span>
    );
}
