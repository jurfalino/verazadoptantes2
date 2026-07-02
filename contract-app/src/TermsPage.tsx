import './petshield.css'
import { useT } from './i18n/LocaleContext'
import { TERMS_CONTENT } from './i18n/termsContent'

export default function TermsPage() {
    const { locale } = useT()
    const c = TERMS_CONTENT[locale] ?? TERMS_CONTENT.es

    return (
        <div className="ps-form" style={{ padding: 'var(--ps-4)' }}>
            <div className="ps-step-container" style={{ maxWidth: 640, textAlign: 'left' }}>
                <a
                    href="javascript:history.back()"
                    style={{
                        color: 'var(--ps-accent)',
                        fontSize: 14,
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        marginBottom: 'var(--ps-4)',
                    }}
                >
                    {c.back}
                </a>

                <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 'var(--ps-3)', color: 'var(--ps-text)' }}>
                    {c.title}
                </h1>

                <p style={{ fontSize: 13, color: 'var(--ps-text-muted)', marginBottom: 'var(--ps-4)' }}>
                    {c.updated}
                </p>

                <div style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--ps-text-secondary)' }}>
                    {c.sections.map((section, si) => (
                        <Section key={si} title={section.title}>
                            {section.blocks.map((block, bi) =>
                                block.type === 'p' ? (
                                    <p key={bi}>{block.text}</p>
                                ) : (
                                    <ul key={bi}>
                                        {block.items.map((item, ii) => <ListItem key={ii} text={item} />)}
                                    </ul>
                                )
                            )}
                        </Section>
                    ))}
                </div>
            </div>
        </div>
    )
}

/** Renders a "Label — description" item with the label in bold. */
function ListItem({ text }: { text: string }) {
    const idx = text.indexOf(' — ')
    if (idx === -1) return <li>{text}</li>
    return (
        <li><strong>{text.slice(0, idx)}</strong>{text.slice(idx)}</li>
    )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div style={{ marginBottom: 'var(--ps-4)' }}>
            <h2 style={{
                fontSize: 16,
                fontWeight: 600,
                color: 'var(--ps-text)',
                marginBottom: 'var(--ps-2)',
            }}>
                {title}
            </h2>
            {children}
        </div>
    )
}
