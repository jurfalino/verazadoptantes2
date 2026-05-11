/**
 * AnimalCard — one card in the showcase grid (v2.14.10-3).
 * Clicking navigates to /animal/[id]. Reuses petshield.css design tokens.
 */

export interface AnimalSummary {
    id: string
    animalName: string | null
    species: string | null
    sex: string | null
    neutered: number | null
    color: string | null
    images: { url: string }[]
    rescuer?: { displayName: string; orgName?: string }
}

const SPECIES_LABEL: Record<string, string> = {
    cat: 'Gato',
    dog: 'Perro',
    bird: 'Ave',
}

function speciesLabel(s: string | null | undefined): string {
    if (!s) return ''
    return SPECIES_LABEL[s.toLowerCase()] || s
}

function sexLabel(s: string | null | undefined): string {
    if (!s) return ''
    const v = s.toLowerCase()
    if (v === 'macho' || v === 'male') return 'Macho'
    if (v === 'hembra' || v === 'female') return 'Hembra'
    return s
}

export default function AnimalCard({ animal }: { animal: AnimalSummary }) {
    const hero = animal.images[0]?.url
    const name = animal.animalName?.trim() || 'Sin nombre'
    const subtitle = [speciesLabel(animal.species), sexLabel(animal.sex)].filter(Boolean).join(' · ')
    const rescuerLabel = animal.rescuer?.orgName || animal.rescuer?.displayName
    return (
        <a className="ps-showcase-card" href={`/animal/${animal.id}`}>
            <div className="ps-showcase-card__photo">
                {hero ? (
                    <img src={hero} alt={name} loading="lazy" />
                ) : (
                    <div className="ps-showcase-card__photo-empty" aria-hidden>🐾</div>
                )}
            </div>
            <div className="ps-showcase-card__body">
                <h3 className="ps-showcase-card__name">{name}</h3>
                {subtitle && <p className="ps-showcase-card__meta">{subtitle}</p>}
                {rescuerLabel && <p className="ps-showcase-card__rescuer">{rescuerLabel}</p>}
            </div>
        </a>
    )
}
