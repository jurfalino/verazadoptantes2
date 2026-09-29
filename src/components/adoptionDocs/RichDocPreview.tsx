/**
 * Read-only renderings of contract sections for the editor page. Same
 * structure as contract-app's RichDocView and its standard-section markup
 * (contract-app/src/ContractPage.tsx), with Next styling. Plain React
 * children — never raw HTML.
 */
import type { Inline, RichDoc } from '@/domain/adoptionDocs';
import type { StdSection } from '@/domain/standardContractText';

function Run({ r }: { r: Inline }) {
    let node: React.ReactNode = r.text;
    if (r.marks?.includes('underline')) node = <u>{node}</u>;
    if (r.marks?.includes('italic')) node = <em>{node}</em>;
    if (r.marks?.includes('bold')) node = <strong>{node}</strong>;
    return <>{node}</>;
}

export default function RichDocPreview({ doc }: { doc: RichDoc }) {
    return (
        <div className="space-y-2 text-sm leading-relaxed text-stone-700">
            {doc.content.map((b, i) => b.type === 'paragraph'
                ? <p key={i} className="whitespace-pre-wrap">{b.content.length ? b.content.map((r, j) => <Run key={j} r={r} />) : ' '}</p>
                : <ul key={i} className="list-disc pl-5 space-y-2">{b.items.map((it, j) => <li key={j}>{it.map((r, k) => <Run key={k} r={r} />)}</li>)}</ul>)}
        </div>
    );
}

/** A standard section as the contract shows it: intro, then clauses with bold titles. Muted. */
export function StandardSectionPreview({ section }: { section: StdSection }) {
    return (
        <div className="text-sm leading-relaxed text-stone-500">
            {section.intro && <p className="mb-2">{section.intro}</p>}
            <div className="space-y-2 pl-4">
                {section.clauses.map((clause, i) => (
                    <div key={i}>
                        {clause.title && <p className="font-bold text-xs uppercase tracking-wide">{clause.title}</p>}
                        <p>{clause.body}</p>
                    </div>
                ))}
            </div>
        </div>
    );
}
