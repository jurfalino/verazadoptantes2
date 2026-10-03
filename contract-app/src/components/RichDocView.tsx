import type { Inline, RichDoc } from '../lib/adoptionDocs'

function Run({ r }: { r: Inline }) {
    let node: React.ReactNode = r.text
    if (r.marks?.includes('underline')) node = <u>{node}</u>
    if (r.marks?.includes('italic')) node = <em>{node}</em>
    if (r.marks?.includes('bold')) node = <strong>{node}</strong>
    return <>{node}</>
}

/** Rescuer-written contract section. Plain React children — never raw HTML. */
export default function RichDocView({ doc }: { doc: RichDoc }) {
    return (
        <div className="space-y-2">
            {doc.content.map((b, i) => {
                if (b?.type === 'paragraph') {
                    return <p key={i} className="whitespace-pre-wrap">{b.content.length ? b.content.map((r, j) => <Run key={j} r={r} />) : ' '}</p>
                }
                if (b?.type === 'bulletList') {
                    return <ul key={i} className="list-disc pl-5 space-y-1">{b.items.map((it, j) => <li key={j}>{it.map((r, k) => <Run key={k} r={r} />)}</li>)}</ul>
                }
                return null // unknown block type: render nothing rather than guess
            })}
        </div>
    )
}
