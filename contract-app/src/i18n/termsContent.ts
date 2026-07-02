// ⚠️ DRAFT NOTICE: the `en` and `pt` text is a DRAFT pending human/legal review
// before production. `es` is authoritative. These Terms describe an Argentine
// data-protection framework (Ley 25.326); the translations render the same
// meaning but the governing law remains Argentine.
//
// Single source for the Terms & Conditions page. List items use the
// "Label — description" convention; the page renders the part before " — " bold.

import type { Locale } from './types';

export type TermsBlock =
    | { type: 'p'; text: string }
    | { type: 'ul'; items: string[] };

export interface TermsSection {
    title: string;
    blocks: TermsBlock[];
}

export interface TermsContent {
    back: string;
    title: string;
    updated: string;
    sections: TermsSection[];
}

const es: TermsContent = {
    back: '← Volver',
    title: 'Términos y Condiciones',
    updated: 'Última actualización: marzo 2026',
    sections: [
        { title: '1. Descripción del servicio', blocks: [
            { type: 'p', text: 'Este formulario es parte de un sistema de gestión de adopciones responsables. Permite a los rescatistas recopilar y verificar información de potenciales adoptantes con el fin de garantizar el bienestar de los animales entregados en adopción.' },
        ] },
        { title: '2. Datos personales recopilados', blocks: [
            { type: 'p', text: 'Al completar este formulario, se te solicitará la siguiente información:' },
            { type: 'ul', items: [
                'Nombre completo — para identificarte como adoptante.',
                'Email — para comunicaciones relacionadas con la adopción.',
                'Teléfono (opcional) — para contacto directo por parte del rescatista.',
                'Dirección — para verificar las condiciones del hogar.',
                'Geolocalización (opcional) — para confirmar tu ubicación actual.',
                'Fotografía (opcional) — para verificación de identidad.',
            ] },
        ] },
        { title: '3. Finalidad del tratamiento', blocks: [
            { type: 'p', text: 'Tus datos serán utilizados exclusivamente para:' },
            { type: 'ul', items: [
                'Evaluar tu solicitud de adopción.',
                'Facilitar la comunicación entre vos y el rescatista.',
                'Mantener un registro del proceso de adopción.',
                'Proteger el bienestar del animal mediante la verificación del adoptante.',
            ] },
            { type: 'p', text: 'Tus datos no serán vendidos, cedidos ni utilizados con fines comerciales o publicitarios.' },
        ] },
        { title: '4. Destinatarios de los datos', blocks: [
            { type: 'p', text: 'La información que proporciones será accesible únicamente por el rescatista que generó el enlace de este formulario y los administradores del sistema de gestión. No se compartirá con terceros salvo requerimiento legal.' },
        ] },
        { title: '5. Conservación de los datos', blocks: [
            { type: 'p', text: 'Tus datos serán conservados mientras dure el proceso de adopción y, posteriormente, como registro histórico con fines de protección animal. Podés solicitar su eliminación en cualquier momento (ver sección 7).' },
        ] },
        { title: '6. Base legal', blocks: [
            { type: 'p', text: 'El tratamiento de tus datos se realiza en cumplimiento de la Ley 25.326 de Protección de Datos Personales de la República Argentina y su Decreto Reglamentario 1558/2001. Tu consentimiento explícito al aceptar estos términos constituye la base legal del tratamiento.' },
        ] },
        { title: '7. Tus derechos (ARCO)', blocks: [
            { type: 'p', text: 'Tenés derecho a:' },
            { type: 'ul', items: [
                'Acceso — conocer qué datos tuyos están almacenados.',
                'Rectificación — corregir datos inexactos o incompletos.',
                'Cancelación — solicitar la eliminación de tus datos.',
                'Oposición — oponerte al tratamiento de tus datos.',
            ] },
            { type: 'p', text: 'Para ejercer cualquiera de estos derechos, escribí a privacidad@buenadoptante.com indicando tu nombre completo y la acción que solicitás. Responderemos dentro de los 10 días hábiles.' },
        ] },
        { title: '8. Seguridad', blocks: [
            { type: 'p', text: 'Los datos se almacenan de forma segura utilizando protocolos de cifrado estándar. Se implementan medidas técnicas y organizativas para proteger tu información contra acceso no autorizado, pérdida o alteración.' },
        ] },
        { title: '9. Modificaciones', blocks: [
            { type: 'p', text: 'Estos términos podrán ser modificados en cualquier momento. Las modificaciones serán efectivas a partir de su publicación. El uso continuado del formulario implica la aceptación de los términos vigentes.' },
        ] },
        { title: '10. Legislación aplicable', blocks: [
            { type: 'p', text: 'Estos términos se rigen por las leyes de la República Argentina. Para cualquier controversia serán competentes los tribunales ordinarios de la Ciudad Autónoma de Buenos Aires.' },
        ] },
    ],
};

// ─── DRAFT — pending legal review ───────────────────────────────────────────
const en: TermsContent = {
    back: '← Back',
    title: 'Terms & Conditions',
    updated: 'Last updated: March 2026',
    sections: [
        { title: '1. Service description', blocks: [
            { type: 'p', text: 'This form is part of a responsible-adoption management system. It allows rescuers to collect and verify information about potential adopters in order to ensure the welfare of the animals given up for adoption.' },
        ] },
        { title: '2. Personal data collected', blocks: [
            { type: 'p', text: 'When completing this form, you will be asked for the following information:' },
            { type: 'ul', items: [
                'Full name — to identify you as the adopter.',
                'Email — for communications related to the adoption.',
                'Phone (optional) — for direct contact by the rescuer.',
                'Address — to verify the conditions of the home.',
                'Geolocation (optional) — to confirm your current location.',
                'Photograph (optional) — for identity verification.',
            ] },
        ] },
        { title: '3. Purpose of processing', blocks: [
            { type: 'p', text: 'Your data will be used exclusively to:' },
            { type: 'ul', items: [
                'Assess your adoption request.',
                'Facilitate communication between you and the rescuer.',
                'Keep a record of the adoption process.',
                'Protect the animal\'s welfare through adopter verification.',
            ] },
            { type: 'p', text: 'Your data will not be sold, transferred, or used for commercial or advertising purposes.' },
        ] },
        { title: '4. Data recipients', blocks: [
            { type: 'p', text: 'The information you provide will be accessible only to the rescuer who generated this form\'s link and the administrators of the management system. It will not be shared with third parties except by legal requirement.' },
        ] },
        { title: '5. Data retention', blocks: [
            { type: 'p', text: 'Your data will be retained for the duration of the adoption process and, thereafter, as a historical record for animal-protection purposes. You may request its deletion at any time (see section 7).' },
        ] },
        { title: '6. Legal basis', blocks: [
            { type: 'p', text: 'Your data is processed in compliance with Law 25.326 on the Protection of Personal Data of the Argentine Republic and its Regulatory Decree 1558/2001. Your explicit consent upon accepting these terms constitutes the legal basis for processing.' },
        ] },
        { title: '7. Your rights (ARCO)', blocks: [
            { type: 'p', text: 'You have the right to:' },
            { type: 'ul', items: [
                'Access — know what data of yours is stored.',
                'Rectification — correct inaccurate or incomplete data.',
                'Cancellation — request the deletion of your data.',
                'Objection — object to the processing of your data.',
            ] },
            { type: 'p', text: 'To exercise any of these rights, write to privacidad@buenadoptante.com stating your full name and the action you are requesting. We will respond within 10 business days.' },
        ] },
        { title: '8. Security', blocks: [
            { type: 'p', text: 'Data is stored securely using standard encryption protocols. Technical and organizational measures are implemented to protect your information against unauthorized access, loss, or alteration.' },
        ] },
        { title: '9. Modifications', blocks: [
            { type: 'p', text: 'These terms may be modified at any time. Modifications take effect upon publication. Continued use of the form implies acceptance of the terms in force.' },
        ] },
        { title: '10. Governing law', blocks: [
            { type: 'p', text: 'These terms are governed by the laws of the Argentine Republic. Any dispute shall be subject to the ordinary courts of the Autonomous City of Buenos Aires.' },
        ] },
    ],
};

// ─── DRAFT — pending legal review ───────────────────────────────────────────
const pt: TermsContent = {
    back: '← Voltar',
    title: 'Termos e Condições',
    updated: 'Última atualização: março de 2026',
    sections: [
        { title: '1. Descrição do serviço', blocks: [
            { type: 'p', text: 'Este formulário faz parte de um sistema de gestão de adoções responsáveis. Permite aos resgatistas coletar e verificar informações de potenciais adotantes a fim de garantir o bem-estar dos animais entregues em adoção.' },
        ] },
        { title: '2. Dados pessoais coletados', blocks: [
            { type: 'p', text: 'Ao preencher este formulário, serão solicitadas as seguintes informações:' },
            { type: 'ul', items: [
                'Nome completo — para identificar você como adotante.',
                'Email — para comunicações relacionadas à adoção.',
                'Telefone (opcional) — para contato direto por parte do resgatista.',
                'Endereço — para verificar as condições do lar.',
                'Geolocalização (opcional) — para confirmar sua localização atual.',
                'Fotografia (opcional) — para verificação de identidade.',
            ] },
        ] },
        { title: '3. Finalidade do tratamento', blocks: [
            { type: 'p', text: 'Seus dados serão utilizados exclusivamente para:' },
            { type: 'ul', items: [
                'Avaliar seu pedido de adoção.',
                'Facilitar a comunicação entre você e o resgatista.',
                'Manter um registro do processo de adoção.',
                'Proteger o bem-estar do animal por meio da verificação do adotante.',
            ] },
            { type: 'p', text: 'Seus dados não serão vendidos, cedidos nem utilizados para fins comerciais ou publicitários.' },
        ] },
        { title: '4. Destinatários dos dados', blocks: [
            { type: 'p', text: 'As informações que você fornecer serão acessíveis unicamente pelo resgatista que gerou o link deste formulário e pelos administradores do sistema de gestão. Não serão compartilhadas com terceiros, salvo por exigência legal.' },
        ] },
        { title: '5. Conservação dos dados', blocks: [
            { type: 'p', text: 'Seus dados serão conservados enquanto durar o processo de adoção e, posteriormente, como registro histórico para fins de proteção animal. Você pode solicitar sua exclusão a qualquer momento (ver seção 7).' },
        ] },
        { title: '6. Base legal', blocks: [
            { type: 'p', text: 'O tratamento dos seus dados é realizado em conformidade com a Lei 25.326 de Proteção de Dados Pessoais da República Argentina e seu Decreto Regulamentar 1558/2001. Seu consentimento explícito ao aceitar estes termos constitui a base legal do tratamento.' },
        ] },
        { title: '7. Seus direitos (ARCO)', blocks: [
            { type: 'p', text: 'Você tem direito a:' },
            { type: 'ul', items: [
                'Acesso — saber quais dados seus estão armazenados.',
                'Retificação — corrigir dados inexatos ou incompletos.',
                'Cancelamento — solicitar a exclusão dos seus dados.',
                'Oposição — opor-se ao tratamento dos seus dados.',
            ] },
            { type: 'p', text: 'Para exercer qualquer um desses direitos, escreva para privacidad@buenadoptante.com informando seu nome completo e a ação que solicita. Responderemos dentro de 10 dias úteis.' },
        ] },
        { title: '8. Segurança', blocks: [
            { type: 'p', text: 'Os dados são armazenados de forma segura utilizando protocolos de criptografia padrão. São implementadas medidas técnicas e organizativas para proteger suas informações contra acesso não autorizado, perda ou alteração.' },
        ] },
        { title: '9. Modificações', blocks: [
            { type: 'p', text: 'Estes termos poderão ser modificados a qualquer momento. As modificações serão efetivas a partir de sua publicação. O uso continuado do formulário implica a aceitação dos termos vigentes.' },
        ] },
        { title: '10. Legislação aplicável', blocks: [
            { type: 'p', text: 'Estes termos regem-se pelas leis da República Argentina. Para qualquer controvérsia serão competentes os tribunais ordinários da Cidade Autônoma de Buenos Aires.' },
        ] },
    ],
};

export const TERMS_CONTENT: Record<Locale, TermsContent> = { es, en, pt };
