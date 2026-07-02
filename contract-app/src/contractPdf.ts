/**
 * Contract PDF Generator
 *
 * Generates a formal adoption contract PDF using jsPDF. The contract text comes
 * from the single source in `i18n/contractContent.ts` (shared with the on-screen
 * ContractPage) and is ASCII-folded here because the built-in helvetica font
 * lacks full accented-glyph coverage.
 */

import { jsPDF } from 'jspdf'
import { CONTRACT_CONTENT, stripAccents } from './i18n/contractContent'
import type { Locale } from './i18n/types'

interface AnimalData {
    animalName: string
    species: string | null
    age: string | null
    sex: string | null
    color: string | null
    microchip: string | null
    details: string | null
    rescuerName: string | null
}

interface FormData {
    name: string
    lastName: string
    dni: string
    email: string
    phone: string
    address: string
    socialNetworks: string
    locality: string
}

// Page layout constants
const PAGE_WIDTH = 210 // A4 width in mm
const MARGIN_LEFT = 20
const MARGIN_RIGHT = 20
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT
const LINE_HEIGHT = 5.5
const SECTION_GAP = 8
const PAGE_BOTTOM = 280 // Leave margin at bottom

/**
 * Generates a contract PDF from structured form data in the given locale.
 * Returns a Blob or null on failure.
 */
export function generateContractPdf(animal: AnimalData, form: FormData, locale: Locale = 'es'): Blob | null {
    try {
        const c = CONTRACT_CONTENT[locale] ?? CONTRACT_CONTENT.es
        const doc = new jsPDF({ unit: 'mm', format: 'a4' })
        let y = 20

        // Helper: check if we need a new page
        const checkPage = (needed: number) => {
            if (y + needed > PAGE_BOTTOM) {
                doc.addPage()
                y = 20
            }
        }

        // Helper: add wrapped text and advance y. ASCII-folds for helvetica.
        const addText = (text: string, x: number, maxWidth: number, opts?: { bold?: boolean; size?: number; italic?: boolean }) => {
            const size = opts?.size || 10
            const style = opts?.bold && opts?.italic ? 'bolditalic' : opts?.bold ? 'bold' : opts?.italic ? 'italic' : 'normal'
            doc.setFont('helvetica', style)
            doc.setFontSize(size)
            const lines = doc.splitTextToSize(stripAccents(text), maxWidth)
            const lineH = size * 0.45
            checkPage(lines.length * lineH)
            doc.text(lines, x, y)
            y += lines.length * lineH + 1
        }

        // Helper: add a labeled field
        const addField = (label: string, value: string | null | undefined) => {
            const size = 10
            const lbl = stripAccents(label)
            doc.setFont('helvetica', 'bold')
            doc.setFontSize(size)
            const labelWidth = doc.getTextWidth(lbl + ' ')
            doc.text(lbl, MARGIN_LEFT + 4, y)
            doc.setFont('helvetica', 'normal')
            const val = stripAccents(value || '—')
            const remainingWidth = CONTENT_WIDTH - 4 - labelWidth
            if (doc.getTextWidth(val) > remainingWidth) {
                doc.text(val.substring(0, Math.floor(remainingWidth / (size * 0.25))), MARGIN_LEFT + 4 + labelWidth, y)
                y += LINE_HEIGHT
                const rest = val.substring(Math.floor(remainingWidth / (size * 0.25)))
                if (rest) {
                    const wrapped = doc.splitTextToSize(rest, CONTENT_WIDTH - 8)
                    doc.text(wrapped, MARGIN_LEFT + 8, y)
                    y += wrapped.length * LINE_HEIGHT
                }
            } else {
                doc.text(val, MARGIN_LEFT + 4 + labelWidth, y)
                y += LINE_HEIGHT
            }
        }

        const divider = () => {
            doc.setDrawColor(200, 200, 200)
            doc.line(MARGIN_LEFT, y, PAGE_WIDTH - MARGIN_RIGHT, y)
            y += SECTION_GAP
        }

        // === HEADER ===
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(13)
        const titleLines = doc.splitTextToSize(stripAccents(c.title), CONTENT_WIDTH)
        titleLines.forEach((line: string) => {
            const tw = doc.getTextWidth(line)
            doc.text(line, (PAGE_WIDTH - tw) / 2, y)
            y += 6
        })
        y += 2

        // === Date & Location ===
        const today = new Date()
        const day = today.getDate()
        const month = c.months[today.getMonth()]
        const year = today.getFullYear()
        const locality = form.locality || '________________'

        doc.setFont('helvetica', 'normal')
        doc.setFontSize(10)
        const dateText = c.intro
            .replace('{locality}', locality)
            .replace('{day}', String(day))
            .replace('{month}', month)
            .replace('{year}', String(year))
        const dateLines = doc.splitTextToSize(stripAccents(dateText), CONTENT_WIDTH)
        doc.text(dateLines, MARGIN_LEFT, y)
        y += dateLines.length * LINE_HEIGHT + SECTION_GAP

        // === EL ADOPTANTE ===
        checkPage(50)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(10)
        doc.setTextColor(67, 56, 202) // indigo-700
        doc.text(stripAccents(c.adopterHeading), MARGIN_LEFT, y)
        doc.setTextColor(0, 0, 0)
        y += LINE_HEIGHT + 1

        addField(c.labels.fullName, `${form.name} ${form.lastName}`.trim() || '—')
        addField(c.labels.doc, form.dni || '—')
        addField(c.labels.address, form.address || '—')
        addField(c.labels.phone, form.phone || '—')
        addField(c.labels.email, form.email || '—')
        addField(c.labels.social, form.socialNetworks || '—')
        y += 3

        // === EL RESCATISTA ===
        checkPage(15)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(10)
        doc.setTextColor(120, 113, 108) // stone-500
        doc.text(stripAccents(c.rescuerHeading), MARGIN_LEFT, y)
        doc.setTextColor(0, 0, 0)
        y += LINE_HEIGHT + 1
        addField(c.labels.rescuerInstitution, animal.rescuerName || '—')
        y += 3

        divider()

        // === 1. DATOS DEL ANIMAL ===
        checkPage(40)
        addText(c.animalSectionTitle, MARGIN_LEFT, CONTENT_WIDTH, { bold: true, size: 11 })
        y += 1

        const speciesLabel = animal.species === 'cat' ? c.speciesCat : animal.species === 'dog' ? c.speciesDog : (animal.species || '—')
        const sexLabel = animal.sex
            ? (animal.sex.toLowerCase() === 'macho' ? c.sexMale : animal.sex.toLowerCase() === 'hembra' ? c.sexFemale : animal.sex)
            : null
        addField(c.animalLabels.name, animal.animalName)
        addField(c.animalLabels.species, speciesLabel)
        addField(c.animalLabels.age, animal.age)
        addField(c.animalLabels.sex, sexLabel)
        addField(c.animalLabels.color, animal.color || animal.details)
        addField(c.animalLabels.microchip, animal.microchip)
        y += 3

        divider()

        // === PROSE SECTIONS 2–5 (data-driven) ===
        c.sections.forEach((section, i) => {
            checkPage(30)
            addText(section.title, MARGIN_LEFT, CONTENT_WIDTH, { bold: true, size: 11 })
            y += 1
            if (section.intro) {
                addText(section.intro, MARGIN_LEFT, CONTENT_WIDTH)
                y += 2
            }
            for (const clause of section.clauses) {
                checkPage(15)
                if (clause.title) addText(clause.title, MARGIN_LEFT + 4, CONTENT_WIDTH - 4, { bold: true, size: 9 })
                addText(clause.body, MARGIN_LEFT + 4, CONTENT_WIDTH - 4)
                y += 1
            }
            y += 2
            // Divider between sections, but not after the last one (signatures follow).
            if (i < c.sections.length - 1) {
                checkPage(10)
                divider()
            }
        })
        y += 4

        // === SIGNATURES ===
        checkPage(35)
        doc.setDrawColor(120, 120, 120)
        doc.setLineWidth(0.8)
        doc.line(MARGIN_LEFT, y, PAGE_WIDTH - MARGIN_RIGHT, y)
        doc.setLineWidth(0.3)
        y += 15

        const sigWidth = (CONTENT_WIDTH - 20) / 2
        const sigLeft = MARGIN_LEFT
        const sigRight = MARGIN_LEFT + sigWidth + 20

        // Names
        doc.setFont('helvetica', 'italic')
        doc.setFontSize(10)
        doc.setTextColor(150, 150, 150)
        const adopterName = stripAccents(`${form.name} ${form.lastName}`.trim())
        if (adopterName) {
            const nameW = doc.getTextWidth(adopterName)
            doc.text(adopterName, sigLeft + (sigWidth - nameW) / 2, y)
        }
        if (animal.rescuerName) {
            const resc = stripAccents(animal.rescuerName)
            const rescW = doc.getTextWidth(resc)
            doc.text(resc, sigRight + (sigWidth - rescW) / 2, y)
        }
        y += 2

        // Signature lines
        doc.setDrawColor(120, 120, 120)
        doc.line(sigLeft, y, sigLeft + sigWidth, y)
        doc.line(sigRight, y, sigRight + sigWidth, y)
        y += 4

        // Labels
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(8)
        doc.setTextColor(120, 113, 108)
        const adoptLabel = stripAccents(c.signAdopter)
        doc.text(adoptLabel, sigLeft + (sigWidth - doc.getTextWidth(adoptLabel)) / 2, y)
        const rescLabel = stripAccents(c.signRescuer)
        doc.text(rescLabel, sigRight + (sigWidth - doc.getTextWidth(rescLabel)) / 2, y)
        y += 4

        // Doc number under adopter
        if (form.dni) {
            doc.setFont('helvetica', 'normal')
            doc.setFontSize(8)
            doc.setTextColor(150, 150, 150)
            const dniText = stripAccents(`${c.docLabel} ${form.dni}`)
            doc.text(dniText, sigLeft + (sigWidth - doc.getTextWidth(dniText)) / 2, y)
        }

        doc.setTextColor(0, 0, 0)
        return doc.output('blob')
    } catch (err) {
        console.error('[CONTRACT PDF] Generation failed:', err)
        return null
    }
}

/**
 * Convert a Blob to a base64 data URL for transport.
 */
export function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(blob)
    })
}
