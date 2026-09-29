/**
 * The authoritative Spanish text of contract sections 2–5, mirrored from
 * contract-app/src/i18n/contractContent.ts (the contract-app is a separate
 * package and can't be imported). standardContractText.test.ts fails if the
 * two drift. Used by the editor (pre-fill + read-only preview) only — the
 * public contract still renders from contract-app's own copy.
 */
import type { RichDoc, SectionKey } from './adoptionDocs';

export interface StdClause { title?: string; body: string }
export interface StdSection { title: string; intro?: string; clauses: StdClause[] }

export const STANDARD_SECTIONS_ES: { '2': StdSection; '3': StdSection; '4': StdSection; '5': StdSection } = {
    '2': {
        title: '2. COMPROMISOS DEL ADOPTANTE',
        intro: 'El adoptante declara aceptar la tenencia del animal bajo las siguientes cláusulas obligatorias:',
        clauses: [
            { title: 'Bienestar y Trato:', body: 'El animal será tratado como un miembro de la familia. Se prohíbe terminantemente mantenerlo encadenado, en balcones sin protección, en terrazas/patios sin refugio o deambulando solo por la vía pública.' },
            { title: 'Salud:', body: 'El adoptante se compromete a brindar asistencia veterinaria inmediata ante enfermedades o accidentes, mantener el plan de vacunación anual y la desparasitación al día.' },
            { title: 'Esterilización:', body: '(Si no está castrado) El adoptante se obliga a castrar al animal al cumplir los 6 meses de edad, enviando el certificado correspondiente al rescatista. Se prohíbe su uso para cría o reproducción.' },
            { title: 'Seguridad (Gatos):', body: 'En caso de felinos, el adoptante garantiza que la vivienda cuenta con mallas de protección en ventanas y balcones para evitar caídas (Síndrome del gato paracaidista) o escapes.' },
            { title: 'Prohibición de Uso Utilitario:', body: 'El animal no podrá ser utilizado para fines de seguridad (guardia), control de plagas (caza de roedores), ni experimentos de ninguna índole.' },
        ],
    },
    '3': {
        title: '3. SEGUIMIENTO Y NO ABANDONO',
        clauses: [
            { title: 'Seguimiento:', body: 'El adoptante acepta recibir visitas programadas y enviar fotos/videos periódicos del animal para constatar su estado de salud y adaptación.' },
            { title: 'Prohibición de Cesión:', body: 'Si por razones de fuerza mayor el adoptante no pudiera continuar con la tenencia, está estrictamente prohibido regalarlo, venderlo o abandonarlo. Deberá comunicarse inmediatamente con el rescatista para coordinar el retorno del animal o una nueva adopción supervisada.' },
        ],
    },
    '4': {
        title: '4. INCUMPLIMIENTO Y PROTECCIÓN ANIMAL',
        clauses: [
            { body: 'El incumplimiento de cualquiera de las obligaciones pactadas en este documento facultará al rescatista a declarar la resolución del contrato y exigir la restitución inmediata del animal para garantizar su integridad física y emocional.' },
            { body: 'Esta acción se llevará a cabo sin perjuicio de las denuncias y acciones legales (civiles o penales) que correspondan bajo la legislación vigente en materia de protección y bienestar animal de la jurisdicción correspondiente, la cual sanciona el maltrato, la crueldad y el abandono de seres sintientes.' },
        ],
    },
    '5': {
        title: '5. CONSENTIMIENTO DE TRATAMIENTO DE DATOS Y REGISTRO',
        clauses: [
            { body: 'El Adoptante presta su consentimiento expreso para que los datos personales consignados en este contrato sean incorporados a los registros internos del Rescatista y a bases de datos compartidas entre organizaciones de protección animal debidamente acreditadas.' },
        ],
    },
};

export function standardSectionToRichDoc(s: StdSection): RichDoc {
    const content: RichDoc['content'] = [];
    if (s.intro) content.push({ type: 'paragraph', content: [{ text: s.intro }] });
    for (const c of s.clauses) {
        content.push({
            type: 'paragraph',
            content: c.title ? [{ text: c.title, marks: ['bold'] }, { text: ' ' + c.body }] : [{ text: c.body }],
        });
    }
    return { type: 'doc', content };
}

export const STANDARD_RICH_DOCS: Record<SectionKey, RichDoc> = {
    '2': standardSectionToRichDoc(STANDARD_SECTIONS_ES['2']),
    '3': standardSectionToRichDoc(STANDARD_SECTIONS_ES['3']),
    '4': standardSectionToRichDoc(STANDARD_SECTIONS_ES['4']),
};
