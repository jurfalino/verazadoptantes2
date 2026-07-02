// ⚠️ DRAFT NOTICE: the `en` and `pt` legal text below is a DRAFT pending
// human/legal review before it is used in production. `es` is authoritative
// (extracted verbatim from the original contract, with accents restored as the
// canonical form). The PDF generator ASCII-folds this text at render time via
// `stripAccents()`, so the on-screen (accented) and PDF (ASCII) outputs share
// this single source and can never drift.
//
// Single source of truth for the adoption contract body + the Terms page,
// consumed by BOTH ContractPage.tsx (screen) and contractPdf.ts (PDF).

import type { Locale } from './types';

export interface ContractClause {
    /** Optional bold lead-in (e.g. "Salud:"). */
    title?: string;
    /** Clause body. May contain interpolation placeholders. */
    body: string;
}

export interface ContractSection {
    title: string;
    intro?: string;
    clauses: ContractClause[];
}

export interface ContractContent {
    title: string;
    /** Intro line. Placeholders: {locality} {day} {month} {year}. */
    intro: string;
    adopterHeading: string;
    rescuerHeading: string;
    labels: {
        fullName: string;
        doc: string;
        address: string;
        phone: string;
        email: string;
        social: string;
        rescuerInstitution: string;
    };
    animalSectionTitle: string;
    animalLabels: {
        name: string;
        species: string;
        age: string;
        sex: string;
        color: string;
        microchip: string;
    };
    /** Prose sections 2–5 (section 1 is the animal data fields above). */
    sections: ContractSection[];
    signAdopter: string;
    signRescuer: string;
    /** Prefix for the doc-number line under the adopter signature. */
    docLabel: string;
    /** 12 month names, index 0 = January. */
    months: string[];
    speciesCat: string;
    speciesDog: string;
    sexMale: string;
    sexFemale: string;
}

/** Fold accents to ASCII for the jsPDF output (helvetica lacks full glyph coverage). */
export function stripAccents(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const es: ContractContent = {
    title: 'CONTRATO DE ADOPCIÓN RESPONSABLE DE ANIMAL DE COMPAÑÍA',
    intro: 'En la localidad de {locality}, a los {day} días del mes de {month} de {year}, se celebra el presente contrato entre:',
    adopterHeading: 'El Adoptante:',
    rescuerHeading: 'El Rescatista / Protectora:',
    labels: {
        fullName: 'Nombre y Apellido:',
        doc: 'Documento de Identidad / Personal ID:',
        address: 'Domicilio Real:',
        phone: 'Teléfono de contacto:',
        email: 'Email:',
        social: 'Redes Sociales:',
        rescuerInstitution: 'Nombre / Institución:',
    },
    animalSectionTitle: '1. DATOS DEL ANIMAL',
    animalLabels: {
        name: 'Nombre:',
        species: 'Especie:',
        age: 'Edad aprox.:',
        sex: 'Sexo:',
        color: 'Color/Señas:',
        microchip: 'N° de Microchip (si posee):',
    },
    sections: [
        {
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
        {
            title: '3. SEGUIMIENTO Y NO ABANDONO',
            clauses: [
                { title: 'Seguimiento:', body: 'El adoptante acepta recibir visitas programadas y enviar fotos/videos periódicos del animal para constatar su estado de salud y adaptación.' },
                { title: 'Prohibición de Cesión:', body: 'Si por razones de fuerza mayor el adoptante no pudiera continuar con la tenencia, está estrictamente prohibido regalarlo, venderlo o abandonarlo. Deberá comunicarse inmediatamente con el rescatista para coordinar el retorno del animal o una nueva adopción supervisada.' },
            ],
        },
        {
            title: '4. INCUMPLIMIENTO Y PROTECCIÓN ANIMAL',
            clauses: [
                { body: 'El incumplimiento de cualquiera de las obligaciones pactadas en este documento facultará al rescatista a declarar la resolución del contrato y exigir la restitución inmediata del animal para garantizar su integridad física y emocional.' },
                { body: 'Esta acción se llevará a cabo sin perjuicio de las denuncias y acciones legales (civiles o penales) que correspondan bajo la legislación vigente en materia de protección y bienestar animal de la jurisdicción correspondiente, la cual sanciona el maltrato, la crueldad y el abandono de seres sintientes.' },
            ],
        },
        {
            title: '5. CONSENTIMIENTO DE TRATAMIENTO DE DATOS Y REGISTRO',
            clauses: [
                { body: 'El Adoptante presta su consentimiento expreso para que los datos personales consignados en este contrato sean incorporados a los registros internos del Rescatista y a bases de datos compartidas entre organizaciones de protección animal debidamente acreditadas.' },
            ],
        },
    ],
    signAdopter: 'FIRMA DEL ADOPTANTE',
    signRescuer: 'FIRMA DEL RESCATISTA',
    docLabel: 'Documento:',
    months: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
    speciesCat: 'Gato',
    speciesDog: 'Perro',
    sexMale: 'Macho',
    sexFemale: 'Hembra',
};

// ─── DRAFT — pending legal review ───────────────────────────────────────────
const en: ContractContent = {
    title: 'RESPONSIBLE PET ADOPTION CONTRACT',
    intro: 'In the locality of {locality}, on the {day} day of {month} {year}, this contract is entered into between:',
    adopterHeading: 'The Adopter:',
    rescuerHeading: 'The Rescuer / Shelter:',
    labels: {
        fullName: 'Full Name:',
        doc: 'Identity Document / Personal ID:',
        address: 'Home Address:',
        phone: 'Contact Phone:',
        email: 'Email:',
        social: 'Social Media:',
        rescuerInstitution: 'Name / Institution:',
    },
    animalSectionTitle: '1. ANIMAL DETAILS',
    animalLabels: {
        name: 'Name:',
        species: 'Species:',
        age: 'Approx. Age:',
        sex: 'Sex:',
        color: 'Color/Markings:',
        microchip: 'Microchip No. (if any):',
    },
    sections: [
        {
            title: '2. ADOPTER COMMITMENTS',
            intro: 'The adopter declares acceptance of custody of the animal under the following mandatory clauses:',
            clauses: [
                { title: 'Welfare and Treatment:', body: 'The animal shall be treated as a member of the family. It is strictly forbidden to keep it chained, on unprotected balconies, on terraces/patios without shelter, or roaming alone in public.' },
                { title: 'Health:', body: 'The adopter commits to providing immediate veterinary care in case of illness or accident, and to keeping the annual vaccination plan and deworming up to date.' },
                { title: 'Spaying/Neutering:', body: '(If not already neutered) The adopter is obligated to neuter the animal upon reaching 6 months of age, sending the corresponding certificate to the rescuer. Its use for breeding or reproduction is prohibited.' },
                { title: 'Safety (Cats):', body: 'In the case of cats, the adopter guarantees that the home has protective netting on windows and balconies to prevent falls (high-rise syndrome) or escapes.' },
                { title: 'Prohibition of Utilitarian Use:', body: 'The animal may not be used for security purposes (guarding), pest control (hunting rodents), or experiments of any kind.' },
            ],
        },
        {
            title: '3. FOLLOW-UP AND NON-ABANDONMENT',
            clauses: [
                { title: 'Follow-up:', body: 'The adopter agrees to receive scheduled visits and to send periodic photos/videos of the animal to verify its health and adaptation.' },
                { title: 'Prohibition of Transfer:', body: 'If, due to force majeure, the adopter can no longer keep the animal, it is strictly forbidden to give it away, sell it, or abandon it. They must immediately contact the rescuer to arrange the return of the animal or a new supervised adoption.' },
            ],
        },
        {
            title: '4. BREACH AND ANIMAL PROTECTION',
            clauses: [
                { body: 'Breach of any of the obligations agreed in this document shall entitle the rescuer to declare the contract terminated and to demand the immediate return of the animal in order to safeguard its physical and emotional integrity.' },
                { body: 'This action shall be taken without prejudice to any complaints and legal actions (civil or criminal) that may apply under the animal-protection and welfare legislation in force in the relevant jurisdiction, which penalizes the mistreatment, cruelty, and abandonment of sentient beings.' },
            ],
        },
        {
            title: '5. CONSENT TO DATA PROCESSING AND REGISTRY',
            clauses: [
                { body: 'The Adopter gives express consent for the personal data recorded in this contract to be incorporated into the Rescuer\'s internal records and into databases shared among duly accredited animal-protection organizations.' },
            ],
        },
    ],
    signAdopter: 'ADOPTER\'S SIGNATURE',
    signRescuer: 'RESCUER\'S SIGNATURE',
    docLabel: 'Document:',
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    speciesCat: 'Cat',
    speciesDog: 'Dog',
    sexMale: 'Male',
    sexFemale: 'Female',
};

// ─── DRAFT — pending legal review ───────────────────────────────────────────
const pt: ContractContent = {
    title: 'CONTRATO DE ADOÇÃO RESPONSÁVEL DE ANIMAL DE COMPANHIA',
    intro: 'Na localidade de {locality}, aos {day} dias do mês de {month} de {year}, celebra-se o presente contrato entre:',
    adopterHeading: 'O Adotante:',
    rescuerHeading: 'O Resgatista / Protetor(a):',
    labels: {
        fullName: 'Nome e Sobrenome:',
        doc: 'Documento de Identidade / Personal ID:',
        address: 'Endereço Residencial:',
        phone: 'Telefone de contato:',
        email: 'Email:',
        social: 'Redes Sociais:',
        rescuerInstitution: 'Nome / Instituição:',
    },
    animalSectionTitle: '1. DADOS DO ANIMAL',
    animalLabels: {
        name: 'Nome:',
        species: 'Espécie:',
        age: 'Idade aprox.:',
        sex: 'Sexo:',
        color: 'Cor/Sinais:',
        microchip: 'N.º de Microchip (se houver):',
    },
    sections: [
        {
            title: '2. COMPROMISSOS DO ADOTANTE',
            intro: 'O adotante declara aceitar a guarda do animal sob as seguintes cláusulas obrigatórias:',
            clauses: [
                { title: 'Bem-estar e Trato:', body: 'O animal será tratado como um membro da família. É terminantemente proibido mantê-lo acorrentado, em sacadas sem proteção, em terraços/quintais sem abrigo ou perambulando sozinho pela via pública.' },
                { title: 'Saúde:', body: 'O adotante compromete-se a prestar assistência veterinária imediata em caso de doença ou acidente, e a manter em dia o plano de vacinação anual e a vermifugação.' },
                { title: 'Castração:', body: '(Se não for castrado) O adotante obriga-se a castrar o animal ao completar 6 meses de idade, enviando o certificado correspondente ao resgatista. É proibido seu uso para cria ou reprodução.' },
                { title: 'Segurança (Gatos):', body: 'No caso de felinos, o adotante garante que a residência conta com telas de proteção em janelas e sacadas para evitar quedas (síndrome do gato paraquedista) ou fugas.' },
                { title: 'Proibição de Uso Utilitário:', body: 'O animal não poderá ser utilizado para fins de segurança (guarda), controle de pragas (caça de roedores), nem experimentos de qualquer natureza.' },
            ],
        },
        {
            title: '3. ACOMPANHAMENTO E NÃO ABANDONO',
            clauses: [
                { title: 'Acompanhamento:', body: 'O adotante aceita receber visitas programadas e enviar fotos/vídeos periódicos do animal para constatar seu estado de saúde e adaptação.' },
                { title: 'Proibição de Cessão:', body: 'Se por motivo de força maior o adotante não puder continuar com a guarda, é estritamente proibido doá-lo, vendê-lo ou abandoná-lo. Deverá comunicar-se imediatamente com o resgatista para coordenar o retorno do animal ou uma nova adoção supervisionada.' },
            ],
        },
        {
            title: '4. DESCUMPRIMENTO E PROTEÇÃO ANIMAL',
            clauses: [
                { body: 'O descumprimento de qualquer das obrigações pactuadas neste documento facultará ao resgatista declarar a rescisão do contrato e exigir a restituição imediata do animal para garantir sua integridade física e emocional.' },
                { body: 'Essa ação será realizada sem prejuízo das denúncias e ações legais (cíveis ou penais) cabíveis sob a legislação vigente em matéria de proteção e bem-estar animal da jurisdição correspondente, a qual sanciona os maus-tratos, a crueldade e o abandono de seres sencientes.' },
            ],
        },
        {
            title: '5. CONSENTIMENTO DE TRATAMENTO DE DADOS E REGISTRO',
            clauses: [
                { body: 'O Adotante presta seu consentimento expresso para que os dados pessoais consignados neste contrato sejam incorporados aos registros internos do Resgatista e a bases de dados compartilhadas entre organizações de proteção animal devidamente credenciadas.' },
            ],
        },
    ],
    signAdopter: 'ASSINATURA DO ADOTANTE',
    signRescuer: 'ASSINATURA DO RESGATISTA',
    docLabel: 'Documento:',
    months: ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'],
    speciesCat: 'Gato',
    speciesDog: 'Cão',
    sexMale: 'Macho',
    sexFemale: 'Fêmea',
};

export const CONTRACT_CONTENT: Record<Locale, ContractContent> = { es, en, pt };
