/**
 * Contract PDF Generator
 * 
 * Generates a formal adoption contract PDF using jsPDF.
 * Replaces the broken html2canvas screenshot approach.
 */

import { jsPDF } from 'jspdf'

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
 * Generates a contract PDF from structured form data.
 * Returns a Blob or null on failure.
 */
export function generateContractPdf(animal: AnimalData, form: FormData): Blob | null {
    try {
        const doc = new jsPDF({ unit: 'mm', format: 'a4' })
        let y = 20

        // Helper: check if we need a new page
        const checkPage = (needed: number) => {
            if (y + needed > PAGE_BOTTOM) {
                doc.addPage()
                y = 20
            }
        }

        // Helper: add wrapped text and advance y
        const addText = (text: string, x: number, maxWidth: number, opts?: { bold?: boolean; size?: number; italic?: boolean }) => {
            const size = opts?.size || 10
            const style = opts?.bold && opts?.italic ? 'bolditalic' : opts?.bold ? 'bold' : opts?.italic ? 'italic' : 'normal'
            doc.setFont('helvetica', style)
            doc.setFontSize(size)
            const lines = doc.splitTextToSize(text, maxWidth)
            const lineH = size * 0.45
            checkPage(lines.length * lineH)
            doc.text(lines, x, y)
            y += lines.length * lineH + 1
        }

        // Helper: add a labeled field
        const addField = (label: string, value: string | null | undefined) => {
            const size = 10
            doc.setFont('helvetica', 'bold')
            doc.setFontSize(size)
            const labelWidth = doc.getTextWidth(label + ' ')
            doc.text(label, MARGIN_LEFT + 4, y)
            doc.setFont('helvetica', 'normal')
            const val = value || '—'
            const remainingWidth = CONTENT_WIDTH - 4 - labelWidth
            if (doc.getTextWidth(val) > remainingWidth) {
                // Value wraps to next line
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

        // === HEADER ===
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(13)
        const title = 'CONTRATO DE ADOPCION RESPONSABLE DE ANIMAL DE COMPANIA'
        const titleLines = doc.splitTextToSize(title, CONTENT_WIDTH)
        titleLines.forEach((line: string) => {
            const tw = doc.getTextWidth(line)
            doc.text(line, (PAGE_WIDTH - tw) / 2, y)
            y += 6
        })
        y += 2

        // === Date & Location ===
        const today = new Date()
        const day = today.getDate()
        const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
        const month = months[today.getMonth()]
        const year = today.getFullYear()
        const locality = form.locality || ''

        doc.setFont('helvetica', 'normal')
        doc.setFontSize(10)
        const dateText = `En la localidad de ${locality || '________________'}, a los ${day} dias del mes de ${month} de ${year}, se celebra el presente contrato entre:`
        const dateLines = doc.splitTextToSize(dateText, CONTENT_WIDTH)
        doc.text(dateLines, MARGIN_LEFT, y)
        y += dateLines.length * LINE_HEIGHT + SECTION_GAP

        // === EL ADOPTANTE ===
        checkPage(50)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(10)
        doc.setTextColor(67, 56, 202) // indigo-700
        doc.text('El Adoptante:', MARGIN_LEFT, y)
        doc.setTextColor(0, 0, 0)
        y += LINE_HEIGHT + 1

        addField('Nombre y Apellido:', `${form.name} ${form.lastName}`.trim() || '—')
        addField('Documento de Identidad / Personal ID:', form.dni || '—')
        addField('Domicilio Real:', form.address || '—')
        addField('Telefono de contacto:', form.phone || '—')
        addField('Email:', form.email || '—')
        addField('Redes Sociales:', form.socialNetworks || '—')
        y += 3

        // === EL RESCATISTA ===
        checkPage(15)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(10)
        doc.setTextColor(120, 113, 108) // stone-500
        doc.text('El Rescatista / Protectora:', MARGIN_LEFT, y)
        doc.setTextColor(0, 0, 0)
        y += LINE_HEIGHT + 1
        addField('Nombre / Institucion:', animal.rescuerName || '—')
        y += 3

        // === Divider ===
        doc.setDrawColor(200, 200, 200)
        doc.line(MARGIN_LEFT, y, PAGE_WIDTH - MARGIN_RIGHT, y)
        y += SECTION_GAP

        // === 1. DATOS DEL ANIMAL ===
        checkPage(40)
        addText('1. DATOS DEL ANIMAL', MARGIN_LEFT, CONTENT_WIDTH, { bold: true, size: 11 })
        y += 1

        const speciesEmoji = animal.species === 'cat' ? 'Gato' : animal.species === 'dog' ? 'Perro' : (animal.species || '—')
        addField('Nombre:', animal.animalName)
        addField('Especie:', speciesEmoji)
        addField('Edad aprox.:', animal.age)
        addField('Sexo:', animal.sex ? (animal.sex.toLowerCase() === 'macho' ? 'Macho' : animal.sex.toLowerCase() === 'hembra' ? 'Hembra' : animal.sex) : null)
        addField('Color/Senas:', animal.color || animal.details)
        addField('N. de Microchip (si posee):', animal.microchip)
        y += 3

        // === Divider ===
        doc.line(MARGIN_LEFT, y, PAGE_WIDTH - MARGIN_RIGHT, y)
        y += SECTION_GAP

        // === 2. COMPROMISOS DEL ADOPTANTE ===
        checkPage(30)
        addText('2. COMPROMISOS DEL ADOPTANTE', MARGIN_LEFT, CONTENT_WIDTH, { bold: true, size: 11 })
        y += 1
        addText('El adoptante declara aceptar la tenencia del animal bajo las siguientes clausulas obligatorias:', MARGIN_LEFT, CONTENT_WIDTH)
        y += 2

        const clauses = [
            { title: 'Bienestar y Trato:', text: 'El animal sera tratado como un miembro de la familia. Se prohibe terminantemente mantenerlo encadenado, en balcones sin proteccion, en terrazas/patios sin refugio o deambulando solo por la via publica.' },
            { title: 'Salud:', text: 'El adoptante se compromete a brindar asistencia veterinaria inmediata ante enfermedades o accidentes, mantener el plan de vacunacion anual y la desparasitacion al dia.' },
            { title: 'Esterilizacion:', text: '(Si no esta castrado) El adoptante se obliga a castrar al animal al cumplir los 6 meses de edad, enviando el certificado correspondiente al rescatista. Se prohibe su uso para cria o reproduccion.' },
            { title: 'Seguridad (Gatos):', text: 'En caso de felinos, el adoptante garantiza que la vivienda cuenta con mallas de proteccion en ventanas y balcones para evitar caidas (Sindrome del gato paracaidista) o escapes.' },
            { title: 'Prohibicion de Uso Utilitario:', text: 'El animal no podra ser utilizado para fines de seguridad (guardia), control de plagas (caza de roedores), ni experimentos de ninguna indole.' },
        ]

        for (const clause of clauses) {
            checkPage(15)
            addText(clause.title, MARGIN_LEFT + 4, CONTENT_WIDTH - 4, { bold: true, size: 9 })
            addText(clause.text, MARGIN_LEFT + 4, CONTENT_WIDTH - 4)
            y += 1
        }

        // === Divider ===
        checkPage(10)
        doc.line(MARGIN_LEFT, y, PAGE_WIDTH - MARGIN_RIGHT, y)
        y += SECTION_GAP

        // === 3. SEGUIMIENTO Y NO ABANDONO ===
        checkPage(25)
        addText('3. SEGUIMIENTO Y NO ABANDONO', MARGIN_LEFT, CONTENT_WIDTH, { bold: true, size: 11 })
        y += 1

        checkPage(15)
        addText('Seguimiento:', MARGIN_LEFT + 4, CONTENT_WIDTH - 4, { bold: true, size: 9 })
        addText('El adoptante acepta recibir visitas programadas y enviar fotos/videos periodicos del animal para constatar su estado de salud y adaptacion.', MARGIN_LEFT + 4, CONTENT_WIDTH - 4)
        y += 1

        checkPage(20)
        addText('Prohibicion de Cesion:', MARGIN_LEFT + 4, CONTENT_WIDTH - 4, { bold: true, size: 9 })
        addText('Si por razones de fuerza mayor el adoptante no pudiera continuar con la tenencia, esta estrictamente prohibido regalarlo, venderlo o abandonarlo. Debera comunicarse inmediatamente con el rescatista para coordinar el retorno del animal o una nueva adopcion supervisada.', MARGIN_LEFT + 4, CONTENT_WIDTH - 4)
        y += 3

        // === Divider ===
        checkPage(10)
        doc.line(MARGIN_LEFT, y, PAGE_WIDTH - MARGIN_RIGHT, y)
        y += SECTION_GAP

        // === 4. INCUMPLIMIENTO ===
        checkPage(25)
        addText('4. INCUMPLIMIENTO Y LEY 14.346', MARGIN_LEFT, CONTENT_WIDTH, { bold: true, size: 11 })
        y += 1
        addText('El incumplimiento de cualquiera de estas clausulas facultara al rescatista a la restitucion inmediata del animal sin necesidad de intervencion judicial previa, sin perjuicio de las acciones legales que correspondan bajo la Ley Nacional 14.346 de Proteccion Animal, la cual pena el maltrato y la crueldad.', MARGIN_LEFT + 4, CONTENT_WIDTH - 4)
        y += 3

        // === Divider ===
        checkPage(10)
        doc.line(MARGIN_LEFT, y, PAGE_WIDTH - MARGIN_RIGHT, y)
        y += SECTION_GAP

        // === 5. CONSENTIMIENTO ===
        checkPage(25)
        addText('5. CONSENTIMIENTO DE TRATAMIENTO DE DATOS Y REGISTRO', MARGIN_LEFT, CONTENT_WIDTH, { bold: true, size: 11 })
        y += 1
        addText('El Adoptante presta su consentimiento expreso para que los datos personales consignados en este contrato sean incorporados a los registros internos del Rescatista y a bases de datos compartidas entre organizaciones de proteccion animal debidamente acreditadas.', MARGIN_LEFT + 4, CONTENT_WIDTH - 4)
        y += 6

        // === SIGNATURES ===
        checkPage(35)
        doc.setDrawColor(150, 150, 150)
        doc.setLineWidth(0.5)

        // Thick divider
        doc.setDrawColor(120, 120, 120)
        doc.setLineWidth(0.8)
        doc.line(MARGIN_LEFT, y, PAGE_WIDTH - MARGIN_RIGHT, y)
        doc.setLineWidth(0.3)
        y += 15

        // Adopter signature
        const sigWidth = (CONTENT_WIDTH - 20) / 2
        const sigLeft = MARGIN_LEFT
        const sigRight = MARGIN_LEFT + sigWidth + 20

        // Adopter name
        doc.setFont('helvetica', 'italic')
        doc.setFontSize(10)
        doc.setTextColor(150, 150, 150)
        const adopterName = `${form.name} ${form.lastName}`.trim()
        if (adopterName) {
            const nameW = doc.getTextWidth(adopterName)
            doc.text(adopterName, sigLeft + (sigWidth - nameW) / 2, y)
        }
        // Rescuer name
        if (animal.rescuerName) {
            const rescW = doc.getTextWidth(animal.rescuerName)
            doc.text(animal.rescuerName, sigRight + (sigWidth - rescW) / 2, y)
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
        const adoptLabel = 'FIRMA DEL ADOPTANTE'
        doc.text(adoptLabel, sigLeft + (sigWidth - doc.getTextWidth(adoptLabel)) / 2, y)
        const rescLabel = 'FIRMA DEL RESCATISTA'
        doc.text(rescLabel, sigRight + (sigWidth - doc.getTextWidth(rescLabel)) / 2, y)
        y += 4

        // DNI under adopter
        if (form.dni) {
            doc.setFont('helvetica', 'normal')
            doc.setFontSize(8)
            doc.setTextColor(150, 150, 150)
            const dniText = `DNI: ${form.dni}`
            doc.text(dniText, sigLeft + (sigWidth - doc.getTextWidth(dniText)) / 2, y)
        }

        // Reset colors
        doc.setTextColor(0, 0, 0)

        // Return as blob
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
