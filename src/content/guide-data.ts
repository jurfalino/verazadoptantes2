// Static content for the Adoption Guide and FAQ.
// Imported by both src/app/api/guide-content/route.ts (client fetch)
// and the guia/* layouts (server-rendered JSON-LD for SEO).

export type StepDetail = {
    textEs: string;
    textEn: string;
    textPt: string;
    linkUrl?: string;
    linkTextEs?: string;
    linkTextEn?: string;
    linkTextPt?: string;
};

export type GuideStepEntry = {
    title: string;
    titleEs: string;
    titleEn: string;
    titlePt: string;
    descriptionEs: string;
    descriptionEn: string;
    descriptionPt: string;
    icon: string;
    order: number;
    details?: StepDetail[];
};

export type GuideStep = {
    slug: string;
    entry: GuideStepEntry;
};

export type FaqEntry = {
    question: string;
    questionEs: string;
    questionEn: string;
    questionPt: string;
    answerEs: string;
    answerEn: string;
    answerPt: string;
    order: number;
};

export type FaqItem = {
    slug: string;
    entry: FaqEntry;
};

export const STEPS: GuideStep[] = [
    {
        slug: 'preparacion-animal',
        entry: {
            title: 'Preparación del Animal',
            titleEs: 'Fase 1: Preparación del Animal',
            titleEn: 'Phase 1: Animal Preparation',
            titlePt: 'Fase 1: Preparação do Animal',
            descriptionEs: 'Antes de buscar adoptantes, el animal debe estar en condiciones óptimas para reducir excusas de devoluciones.',
            descriptionEn: 'Before looking for adopters, the animal must be in optimal condition to reduce excuses for returns.',
            descriptionPt: 'Antes de procurar adotantes, o animal deve estar em condições ideais para reduzir desculpas de devolução.',
            icon: '🏥',
            order: 1,
            details: [
                {
                    textEs: 'Salud al día: Vacunación (mínimo la Triple Felina o Séxtuple Canina) y desparasitación interna y externa.',
                    textEn: 'Health up to date: Vaccination (at minimum the Feline Triple or Canine Sextuple) and internal and external deworming.',
                    textPt: 'Saúde em dia: Vacinação (no mínimo a Tríplice Felina ou a Sêxtupla Canina) e vermifugação interna e externa.',
                },
                {
                    textEs: 'Castración obligatoria: Es la única forma de evitar criaderos clandestinos o que el animal se escape por celo. Si es muy cachorro, la adopción debe estar sujeta a un compromiso de castración a los 6 meses.',
                    textEn: 'Mandatory spaying/neutering: It is the only way to prevent clandestine breeders or the animal running away due to heat. If very young, adoption must be subject to a spay/neuter commitment at 6 months.',
                    textPt: 'Castração obrigatória: É a única forma de evitar criadouros clandestinos ou que o animal fuja no cio. Se for muito filhote, a adoção deve estar sujeita a um compromisso de castração aos 6 meses.',
                },
                {
                    textEs: 'Perfil de comportamiento: Observar si convive con otros animales, si es apto para niños o si es muy activo. La honestidad aquí evita que el animal sea devuelto a la semana.',
                    textEn: 'Behavior profile: Observe if it lives well with other animals, if it is suitable for children, or if it is very active. Honesty here prevents the animal from being returned within a week.',
                    textPt: 'Perfil de comportamento: Observe se convive com outros animais, se é adequado para crianças ou se é muito ativo. A honestidade aqui evita que o animal seja devolvido em uma semana.',
                },
            ],
        },
    },
    {
        slug: 'publicacion-estrategica',
        entry: {
            title: 'Publicación Estratégica',
            titleEs: 'Fase 2: Publicación Estratégica',
            titleEn: 'Phase 2: Strategic Posting',
            titlePt: 'Fase 2: Publicação Estratégica',
            descriptionEs: 'No publiques solo "Busca hogar". La publicación es el primer filtro.',
            descriptionEn: 'Don\'t just post "Looking for a home." The ad is the first filter.',
            descriptionPt: 'Não publique apenas "Procura-se um lar". A publicação é o primeiro filtro.',
            icon: '🎯',
            order: 2,
            details: [
                {
                    textEs: 'Fotos de alta calidad: Una foto con buena luz y el animal mirando a cámara aumenta un 70% el interés.',
                    textEn: 'High-quality photos: A photo with good lighting and the animal looking at the camera increases interest by 70%.',
                    textPt: 'Fotos de alta qualidade: Uma foto com boa luz e o animal olhando para a câmera aumenta o interesse em 70%.',
                },
                {
                    textEs: 'Descripción con personalidad: Contar su historia brevemente y sus gustos.',
                    textEn: 'Description with personality: Briefly tell its story and its likes.',
                    textPt: 'Descrição com personalidade: Conte brevemente a história dele e do que ele gosta.',
                },
                {
                    textEs: 'Aclarar requisitos: "Se entrega con contrato, redes en ventanas (si es gato) y seguimiento". Esto ahuyenta de entrada a los "adoptantes por impulso".',
                    textEn: 'Clarify requirements: "Comes with a contract, window nets (if a cat), and follow-up." This scares off "impulse adopters" from the start.',
                    textPt: 'Deixe os requisitos claros: "Entregue com contrato, telas nas janelas (se for gato) e acompanhamento". Isso afasta logo de cara os "adotantes por impulso".',
                },
            ],
        },
    },
    {
        slug: 'filtro-investigacion',
        entry: {
            title: 'El Filtro',
            titleEs: 'Fase 3: El Filtro (Investigación del Candidato)',
            titleEn: 'Phase 3: The Filter (Candidate Investigation)',
            titlePt: 'Fase 3: O Filtro (Investigação do Candidato)',
            descriptionEs: 'Aquí es donde aplicamos el cuestionario de filtro sutil.',
            descriptionEn: 'This is where we apply the subtle screening questionnaire.',
            descriptionPt: 'É aqui que aplicamos o questionário de triagem sutil.',
            icon: '🔍',
            order: 3,
            details: [
                {
                    textEs: 'Formulario Inicial: Enviá las preguntas por WhatsApp o Google Forms.',
                    textEn: 'Initial Form: Send the questions via WhatsApp or Google Forms.',
                    textPt: 'Formulário inicial: Envie as perguntas por WhatsApp ou Google Forms.',
                },
                {
                    textEs: 'El "Stalkeo" Preventivo: Buscá el nombre en Google y redes sociales.',
                    textEn: 'Preventive Background Check: Search the name on Google and social media.',
                    textPt: 'A investigação preventiva: Busque o nome no Google e nas redes sociais.',
                },
                {
                    textEs: 'Consultá bases de datos de adoptantes o grupos de "Alertas de Maltratadores" en Facebook.',
                    textEn: 'Check adopter databases or "Abuser Alert" groups on Facebook.',
                    textPt: 'Consulte bancos de dados de adotantes ou grupos de "Alerta de Maus-Tratos" no Facebook.',
                    linkUrl: '/',
                    linkTextEs: '🔎 Buscar en Veraz Adoptantes',
                    linkTextEn: '🔎 Search in Veraz Adoptantes',
                    linkTextPt: '🔎 Buscar no Veraz Adoptantes',
                },
                {
                    textEs: 'Si sospechás de un perfil falso, pedí una videollamada.',
                    textEn: 'If you suspect a fake profile, request a video call.',
                    textPt: 'Se suspeitar de um perfil falso, peça uma videochamada.',
                },
            ],
        },
    },
    {
        slug: 'entrevista-visita',
        entry: {
            title: 'Entrevista y Visita',
            titleEs: 'Fase 4: La Entrevista y Visita Domiciliaria',
            titleEn: 'Phase 4: Interview & Home Visit',
            titlePt: 'Fase 4: A Entrevista e a Visita Domiciliar',
            descriptionEs: 'Nunca entregues un animal en un punto medio (plaza, estación de servicio).',
            descriptionEn: 'Never hand over an animal at a midpoint (park, gas station).',
            descriptionPt: 'Nunca entregue um animal em um ponto intermediário (praça, posto de gasolina).',
            icon: '🏠',
            order: 4,
            details: [
                {
                    textEs: 'La Visita: Ver dónde va a vivir permite detectar si hay peligros (balcones sin red, cercos bajos, suciedad extrema).',
                    textEn: 'The Visit: Seeing where the animal will live allows you to detect dangers (balconies without nets, low fences, extreme dirt).',
                    textPt: 'A visita: Ver onde o animal vai morar permite detectar perigos (sacadas sem tela, cercas baixas, sujeira extrema).',
                },
                {
                    textEs: 'La Dinámica Familiar: Observar cómo interactúan los otros miembros de la casa (especialmente niños) con el animal.',
                    textEn: 'Family Dynamics: Observe how other household members (especially children) interact with the animal.',
                    textPt: 'A dinâmica familiar: Observe como os outros moradores da casa (especialmente crianças) interagem com o animal.',
                },
                {
                    textEs: 'Referencias: Pedir el contacto del veterinario de su mascota anterior o actual. Si no tiene, pedí una referencia personal de confianza.',
                    textEn: 'References: Ask for the contact of their previous or current pet\'s veterinarian. If they don\'t have one, ask for a trusted personal reference.',
                    textPt: 'Referências: Peça o contato do veterinário do pet anterior ou atual. Se não tiver, peça uma referência pessoal de confiança.',
                },
            ],
        },
    },
    {
        slug: 'contrato-entrega',
        entry: {
            title: 'Contrato y Entrega',
            titleEs: 'Fase 5: El Contrato y la Entrega',
            titleEn: 'Phase 5: Contract & Handover',
            titlePt: 'Fase 5: O Contrato e a Entrega',
            descriptionEs: 'El momento del traspaso debe ser formal para que el adoptante sienta el peso de la responsabilidad.',
            descriptionEn: 'The handover moment must be formal so the adopter feels the weight of responsibility.',
            descriptionPt: 'O momento da entrega deve ser formal para que o adotante sinta o peso da responsabilidade.',
            icon: '📋',
            order: 5,
            details: [
                {
                    textEs: 'Documentación: Fotocopia del DNI del adoptante y firma de un Contrato de Adopción Responsable.',
                    textEn: 'Documentation: Copy of the adopter\'s ID and signing of a Responsible Adoption Contract.',
                    textPt: 'Documentação: Cópia do documento do adotante e assinatura de um Contrato de Adoção Responsável.',
                },
                {
                    textEs: 'Kit de inicio: Pedir que tengan preparada la comida, el collar/chapa o las piedras sanitarias antes de que el animal llegue.',
                    textEn: 'Starter kit: Ask them to have food, collar/tag, or litter prepared before the animal arrives.',
                    textPt: 'Kit inicial: Peça que tenham a comida, a coleira/plaquinha ou a areia sanitária prontas antes de o animal chegar.',
                },
                {
                    textEs: 'Microchip (opcional pero recomendado): En Argentina hay opciones privadas para chipear al animal y vincularlo legalmente al dueño.',
                    textEn: 'Microchip (optional but recommended): In Argentina, there are private options to chip the animal and legally link it to the owner.',
                    textPt: 'Microchip (opcional, mas recomendado): Há opções privadas para microchipar o animal e vinculá-lo legalmente ao dono.',
                },
            ],
        },
    },
    {
        slug: 'seguimiento-post-adopcion',
        entry: {
            title: 'Seguimiento Post-Adopción',
            titleEs: 'Fase 6: Seguimiento Post-Adopción',
            titleEn: 'Phase 6: Post-Adoption Follow-up',
            titlePt: 'Fase 6: Acompanhamento Pós-Adoção',
            descriptionEs: 'El trabajo no termina cuando cerrás la puerta del adoptante.',
            descriptionEn: 'The work doesn\'t end when you close the adopter\'s door.',
            descriptionPt: 'O trabalho não termina quando você fecha a porta do adotante.',
            icon: '📞',
            order: 6,
            details: [
                {
                    textEs: 'Día 1: ¿Cómo pasó la noche?',
                    textEn: 'Day 1: How did the night go?',
                    textPt: 'Dia 1: Como foi a noite?',
                },
                {
                    textEs: 'Semana 1: ¿Hubo algún problema de adaptación o destrozos?',
                    textEn: 'Week 1: Were there any adaptation issues or damage?',
                    textPt: 'Semana 1: Houve algum problema de adaptação ou estragos?',
                },
                {
                    textEs: 'Mes 1: Pedir foto del carnet de vacunación actualizado o turno de castración.',
                    textEn: 'Month 1: Ask for a photo of the updated vaccination card or spay/neuter appointment.',
                    textPt: 'Mês 1: Peça foto da carteira de vacinação atualizada ou do agendamento da castração.',
                },
                {
                    textEs: '6 meses / 1 año: Saludo protocolar y foto.',
                    textEn: '6 months / 1 year: Protocol greeting and photo.',
                    textPt: '6 meses / 1 ano: Contato protocolar e foto.',
                },
                {
                    textEs: 'Red de apoyo: Dejale claro al adoptante que, ante cualquier problema, te llame a vos antes de regalarlo o abandonarlo.',
                    textEn: 'Support network: Make it clear to the adopter that, in case of any problem, they should call you before giving it away or abandoning it.',
                    textPt: 'Rede de apoio: Deixe claro para o adotante que, diante de qualquer problema, entre em contato com você antes de doar ou abandonar o animal.',
                },
            ],
        },
    },
];

export const FAQ: FaqItem[] = [
    {
        slug: 'que-es-verificar',
        entry: {
            question: '¿Qué es verificar adoptantes?',
            questionEs: '¿Qué es verificar adoptantes?',
            questionEn: 'What is adopter vetting?',
            questionPt: 'O que é verificar adotantes?',
            answerEs: 'La verificación de adoptantes es el proceso de consultar referencias e historial antes de entregar un animal a un nuevo hogar. Permite detectar personas con antecedentes de maltrato o adopciones irresponsables.',
            answerEn: 'Adopter vetting is the process of checking references and history before placing an animal in a new home. It helps detect people with a history of abuse or irresponsible adoptions.',
            answerPt: 'Verificar adotantes é o processo de consultar referências e histórico antes de entregar um animal a um novo lar. Permite detectar pessoas com antecedentes de maus-tratos ou adoções irresponsáveis.',
            order: 1,
        },
    },
    {
        slug: 'como-empiezo',
        entry: {
            question: '¿Cómo empiezo?',
            questionEs: '¿Cómo empiezo a usar la plataforma?',
            questionEn: 'How do I get started?',
            questionPt: 'Como eu começo a usar a plataforma?',
            answerEs: 'Registrate con tu cuenta de Google y empezá a buscar o registrar adoptantes de inmediato. Podés seguir esta guía de 6 fases para un proceso completo.',
            answerEn: 'Sign up with your Google account and start searching or registering adopters right away. You can follow this 6-phase guide for a complete process.',
            answerPt: 'Cadastre-se com sua conta do Google e comece a buscar ou registrar adotantes na hora. Você pode seguir este guia de 6 fases para um processo completo.',
            order: 2,
        },
    },
    {
        slug: 'es-gratis',
        entry: {
            question: '¿Es gratis?',
            questionEs: '¿La plataforma es gratuita?',
            questionEn: 'Is it free?',
            questionPt: 'A plataforma é gratuita?',
            answerEs: 'Sí, la plataforma es completamente gratuita para rescatistas y refugios.',
            answerEn: 'Yes, the platform is completely free for rescuers and shelters.',
            answerPt: 'Sim, a plataforma é totalmente gratuita para resgatistas e abrigos.',
            order: 3,
        },
    },
    {
        slug: 'puedo-devolver',
        entry: {
            question: '¿Qué pasa si el adoptante quiere devolver al animal?',
            questionEs: '¿Qué pasa si el adoptante quiere devolver al animal?',
            questionEn: 'What happens if the adopter wants to return the animal?',
            questionPt: 'O que acontece se o adotante quiser devolver o animal?',
            answerEs: 'Por eso es clave la Fase 6: seguimiento. Dejale claro al adoptante que ante cualquier problema te contacte antes de regalarlo o abandonarlo. El contrato de adopción también puede incluir una cláusula de devolución al rescatista.',
            answerEn: 'That\'s why Phase 6: follow-up is key. Make it clear to the adopter that if there\'s any problem, they should contact you before giving the animal away or abandoning it. The adoption contract can also include a return-to-rescuer clause.',
            answerPt: 'Por isso a Fase 6: acompanhamento é fundamental. Deixe claro para o adotante que, diante de qualquer problema, entre em contato com você antes de doar ou abandonar o animal. O contrato de adoção também pode incluir uma cláusula de devolução ao resgatista.',
            order: 4,
        },
    },
];

export const HERO = {
    titleEs: 'Guía de Adopción Responsable',
    titleEn: 'Responsible Adoption Guide',
    titlePt: 'Guia de Adoção Responsável',
    subtitleEs: '6 fases para garantizar que cada animal llegue al hogar correcto — y se quede ahí',
    subtitleEn: '6 phases to ensure every animal reaches the right home — and stays there',
    subtitlePt: '6 fases para garantir que cada animal chegue ao lar certo — e permaneça nele',
    ctaTextEs: '¿Listo para empezar?',
    ctaTextEn: 'Ready to start?',
    ctaTextPt: 'Pronto para começar?',
    ctaUrl: '/',
};

export const BENEFITS = [
    {
        slug: 'protect',
        entry: {
            icon: '🛡️',
            textEs: 'Protege a los animales de adopciones irresponsables',
            textEn: 'Protect animals from irresponsible adoptions',
            textPt: 'Protege os animais de adoções irresponsáveis',
            order: 1,
        },
    },
    {
        slug: 'trust',
        entry: {
            icon: '🤝',
            textEs: 'Construye confianza en la comunidad de rescate',
            textEn: 'Build trust in the rescue community',
            textPt: 'Constrói confiança na comunidade de resgate',
            order: 2,
        },
    },
    {
        slug: 'history',
        entry: {
            icon: '📋',
            textEs: 'Mantiene un historial compartido entre refugios',
            textEn: 'Maintain shared history across shelters',
            textPt: 'Mantém um histórico compartilhado entre abrigos',
            order: 3,
        },
    },
    {
        slug: 'alert',
        entry: {
            icon: '⚠️',
            textEs: 'Alerta sobre adoptantes con advertencias previas',
            textEn: 'Flag adopters with previous warnings',
            textPt: 'Alerta sobre adotantes com advertências anteriores',
            order: 4,
        },
    },
];

export const LABELS = {
    processHeaderEs: 'Las 6 Fases',
    processHeaderEn: 'The 6 Phases',
    processHeaderPt: 'As 6 Fases',
    stepPrefixEs: 'Fase',
    stepPrefixEn: 'Phase',
    stepPrefixPt: 'Fase',
    whyVetEs: '¿Por qué verificar adoptantes?',
    whyVetEn: 'Why Vet Adopters?',
    whyVetPt: 'Por que verificar adotantes?',
    faqHeaderEs: 'Preguntas Frecuentes',
    faqHeaderEn: 'Frequently Asked Questions',
    faqHeaderPt: 'Perguntas Frequentes',
    ctaButtonEs: 'Empezar a Verificar',
    ctaButtonEn: 'Start Vetting',
    ctaButtonPt: 'Começar a Verificar',
};
